//! Deterministic clock, scheduling, retry, lease, and expiry predicates.
//!
//! This module is deliberately pure.  The application/store layer supplies a
//! canonical timestamp, the persisted attempt snapshot, and any retry or
//! schedule facts; this module never reads a process clock or mutates an
//! attempt.  Equality at a deadline is expiry, and a renewable lease never
//! changes the immutable hard budget measured from `claimed_at`.

use std::fmt;

use super::work_model_v3::WorkSchedule;
use super::{
    Attempt, AttemptId, AttemptPhase, ExpiryReason, Fence, TimestampMs, DEFAULT_HARD_TIME_LIMIT_MS,
    DEFAULT_LEASE_TTL_MS,
};

/// The default deterministic retry policy used by callers that opt into
/// automatic retry.  Retry is still bounded by `max_retries`.
pub const DEFAULT_RETRY_BASE_DELAY_MS: u64 = 1_000;
pub const DEFAULT_RETRY_MAX_DELAY_MS: u64 = 60 * 60 * 1_000;
pub const DEFAULT_MAX_RETRIES: u32 = 8;

/// A restart observation can use a persisted monotonic elapsed interval when
/// one is available.  Without that interval a restarted wall clock is not
/// trusted for writes, even though the persisted timestamp is retained as a
/// conservative floor for read-side expiry.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RestartObservation {
    pub persisted_at: TimestampMs,
    pub monotonic_elapsed_ms: Option<u64>,
}

/// Caller-injected clock evidence.  `observed_at` is never fetched here.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PolicyClock {
    pub observed_at: TimestampMs,
    pub previous_observed_at: Option<TimestampMs>,
    pub restart: Option<RestartObservation>,
}

impl PolicyClock {
    pub const fn at(observed_at: TimestampMs) -> Self {
        Self {
            observed_at,
            previous_observed_at: None,
            restart: None,
        }
    }

    pub const fn after(previous_observed_at: TimestampMs, observed_at: TimestampMs) -> Self {
        Self {
            observed_at,
            previous_observed_at: Some(previous_observed_at),
            restart: None,
        }
    }

    pub const fn restarted(
        observed_at: TimestampMs,
        persisted_at: TimestampMs,
        monotonic_elapsed_ms: Option<u64>,
    ) -> Self {
        Self {
            observed_at,
            previous_observed_at: None,
            restart: Some(RestartObservation {
                persisted_at,
                monotonic_elapsed_ms,
            }),
        }
    }

    /// Resolve a clock sample to the conservative read-side instant and its
    /// mutation authority.  A backward sample cannot resurrect an expired
    /// attempt: the last persisted observation remains the effective floor.
    pub fn resolve(self) -> Result<ClockView, TimePolicyError> {
        let mut effective_at = self.observed_at;
        let mut validity = ClockValidity::Trusted;

        if let Some(previous) = self.previous_observed_at {
            if self.observed_at < previous {
                effective_at = previous;
                validity = ClockValidity::BackwardDiscontinuity {
                    previous,
                    observed: self.observed_at,
                };
            }
        }

        if let Some(restart) = self.restart {
            effective_at = max_timestamp(effective_at, restart.persisted_at);
            match restart.monotonic_elapsed_ms {
                Some(elapsed) => {
                    let monotonic_at = add_timestamp(restart.persisted_at, elapsed)?;
                    effective_at = max_timestamp(effective_at, monotonic_at);
                }
                None => {
                    validity = ClockValidity::UnvalidatedRestart {
                        persisted: restart.persisted_at,
                        observed: self.observed_at,
                    };
                }
            }
        }

        Ok(ClockView {
            observed_at: self.observed_at,
            effective_at,
            validity,
        })
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ClockValidity {
    Trusted,
    BackwardDiscontinuity {
        previous: TimestampMs,
        observed: TimestampMs,
    },
    UnvalidatedRestart {
        persisted: TimestampMs,
        observed: TimestampMs,
    },
}

impl ClockValidity {
    pub const fn allows_mutation(self) -> bool {
        matches!(self, Self::Trusted)
    }

    pub const fn needs_reconciliation(self) -> bool {
        !self.allows_mutation()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ClockView {
    pub observed_at: TimestampMs,
    pub effective_at: TimestampMs,
    pub validity: ClockValidity,
}

/// A claimed attempt's immutable timing fields.  Both deadlines must be
/// strictly after `claimed_at`; a clock at either deadline is nevertheless
/// expired by the `>=` predicates below.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AttemptWindow {
    pub claimed_at: TimestampMs,
    pub lease_deadline: TimestampMs,
    pub hard_deadline: TimestampMs,
}

impl AttemptWindow {
    pub fn new(
        claimed_at: TimestampMs,
        lease_deadline: TimestampMs,
        hard_deadline: TimestampMs,
    ) -> Result<Self, TimePolicyError> {
        if lease_deadline <= claimed_at {
            return Err(TimePolicyError::DeadlineNotAfterClaim {
                kind: DeadlineKind::Lease,
                claimed_at,
                deadline: lease_deadline,
            });
        }
        if hard_deadline <= claimed_at {
            return Err(TimePolicyError::DeadlineNotAfterClaim {
                kind: DeadlineKind::HardBudget,
                claimed_at,
                deadline: hard_deadline,
            });
        }
        Ok(Self {
            claimed_at,
            lease_deadline,
            hard_deadline,
        })
    }

    pub fn from_claim(
        claimed_at: TimestampMs,
        lease_ttl_ms: Option<u64>,
        hard_time_limit_ms: Option<u64>,
    ) -> Result<Self, TimePolicyError> {
        let lease_ttl_ms = lease_ttl_ms.unwrap_or(DEFAULT_LEASE_TTL_MS);
        let hard_time_limit_ms = hard_time_limit_ms.unwrap_or(DEFAULT_HARD_TIME_LIMIT_MS);
        let lease_deadline = add_timestamp(claimed_at, lease_ttl_ms)?;
        let hard_deadline = add_timestamp(claimed_at, hard_time_limit_ms)?;
        Self::new(claimed_at, lease_deadline, hard_deadline)
    }

    pub fn from_attempt(attempt: &Attempt) -> Result<Self, TimePolicyError> {
        Self::new(
            attempt.claimed_at,
            attempt.lease_deadline,
            attempt.max_attempt_deadline,
        )
    }

    pub fn lease_elapsed(self, as_of: TimestampMs) -> bool {
        as_of >= self.lease_deadline
    }

    pub fn hard_budget_elapsed(self, as_of: TimestampMs) -> bool {
        as_of >= self.hard_deadline
    }

    pub fn expiry_reason(self, as_of: TimestampMs) -> Option<ExpiryReason> {
        match (self.lease_elapsed(as_of), self.hard_budget_elapsed(as_of)) {
            (false, false) => None,
            (true, false) => Some(ExpiryReason::LeaseElapsed),
            (false, true) => Some(ExpiryReason::HardBudgetElapsed),
            // When both clocks have elapsed, the earliest deadline is the
            // canonical trigger. Equal deadlines retain the historical
            // hard-budget tie break; an explicit event reason can override
            // that tie through AttemptSnapshot.
            (true, true) if self.lease_deadline < self.hard_deadline => {
                Some(ExpiryReason::LeaseElapsed)
            }
            (true, true) => Some(ExpiryReason::HardBudgetElapsed),
        }
    }

    pub fn future_deadlines(self, as_of: TimestampMs) -> Vec<TimestampMs> {
        [self.lease_deadline, self.hard_deadline]
            .into_iter()
            .filter(|deadline| *deadline > as_of)
            .collect()
    }
}

/// A historical attempt is retained for provenance but does not own the work.
/// A pending recovery obligation is the only historical condition that keeps
/// expiry review visible after the current-attempt pointer is gone.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RecoveryState {
    None,
    Pending,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AttemptSnapshot<'a> {
    pub attempt: &'a Attempt,
    pub current: bool,
    pub recovery: RecoveryState,
    pub retained_expiry_reason: Option<ExpiryReason>,
}

impl<'a> AttemptSnapshot<'a> {
    pub const fn current(attempt: &'a Attempt) -> Self {
        Self {
            attempt,
            current: true,
            recovery: RecoveryState::None,
            retained_expiry_reason: None,
        }
    }

    pub const fn current_with_recovery(attempt: &'a Attempt) -> Self {
        Self {
            attempt,
            current: true,
            recovery: RecoveryState::Pending,
            retained_expiry_reason: None,
        }
    }

    pub const fn historical(attempt: &'a Attempt, recovery: RecoveryState) -> Self {
        Self {
            attempt,
            current: false,
            recovery,
            retained_expiry_reason: None,
        }
    }

    /// Attach the immutable trigger recorded by expiry/recovery persistence.
    /// This is required when a phase-only snapshot no longer contains an
    /// elapsed deadline from which the original trigger can be derived.
    pub const fn with_retained_expiry_reason(self, reason: ExpiryReason) -> Self {
        Self {
            retained_expiry_reason: Some(reason),
            ..self
        }
    }

    fn timing_is_applicable(self) -> bool {
        if self.current {
            matches!(
                self.attempt.phase,
                AttemptPhase::Claimed
                    | AttemptPhase::Accepted
                    | AttemptPhase::Running
                    | AttemptPhase::Verifying
                    | AttemptPhase::ExpiryPending
                    | AttemptPhase::Expired
            )
        } else {
            self.recovery == RecoveryState::Pending
        }
    }

    fn owns_execution(self) -> bool {
        self.current
            && matches!(
                self.attempt.phase,
                AttemptPhase::Claimed
                    | AttemptPhase::Accepted
                    | AttemptPhase::Running
                    | AttemptPhase::Verifying
            )
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuthorityToken {
    pub attempt_id: AttemptId,
    pub fence: Fence,
}

impl AuthorityToken {
    pub const fn new(attempt_id: AttemptId, fence: Fence) -> Self {
        Self { attempt_id, fence }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AuthorityDecision {
    NotRequested,
    Authorized,
    StaleAttempt,
    StaleFence,
    HistoricalAttempt,
    TerminalAttempt,
    LeaseElapsed,
    HardBudgetElapsed,
    ClockDiscontinuity,
    ClockBeforeClaim,
}

impl AuthorityDecision {
    pub const fn is_authorized(self) -> bool {
        matches!(self, Self::Authorized)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AttemptTimeDecision {
    pub current: bool,
    pub execution_owned: bool,
    pub lease_elapsed: bool,
    pub hard_budget_elapsed: bool,
    pub expired: bool,
    pub expiry_reason: Option<ExpiryReason>,
    pub review_required: bool,
    pub authority: AuthorityDecision,
    pub next_reevaluation_at: Option<TimestampMs>,
}

pub fn evaluate_attempt(
    snapshot: AttemptSnapshot<'_>,
    clock: PolicyClock,
    presented: Option<AuthorityToken>,
) -> Result<AttemptTimeDecision, TimePolicyError> {
    let clock = clock.resolve()?;
    let window = AttemptWindow::from_attempt(snapshot.attempt)?;
    let before_claim = clock.effective_at < window.claimed_at;
    let applicable = snapshot.timing_is_applicable();
    let execution_owned = snapshot.owns_execution();
    let lease_elapsed = applicable && window.lease_elapsed(clock.effective_at);
    let hard_budget_elapsed = applicable && window.hard_budget_elapsed(clock.effective_at);
    let phase_requires_review = snapshot.current
        && matches!(
            snapshot.attempt.phase,
            AttemptPhase::ExpiryPending | AttemptPhase::Expired
        );
    let expired = applicable
        && (lease_elapsed
            || hard_budget_elapsed
            || phase_requires_review
            || snapshot.recovery == RecoveryState::Pending);
    let review_required = snapshot.recovery == RecoveryState::Pending || phase_requires_review;

    let expiry_reason = if expired {
        Some(
            snapshot
                .retained_expiry_reason
                .or_else(|| window.expiry_reason(clock.effective_at))
                .ok_or(TimePolicyError::MissingExpiryReason)?,
        )
    } else {
        None
    };

    let authority = match presented {
        None => AuthorityDecision::NotRequested,
        Some(_token) if !snapshot.current => AuthorityDecision::HistoricalAttempt,
        Some(_) if before_claim => AuthorityDecision::ClockBeforeClaim,
        Some(token) if token.attempt_id != snapshot.attempt.attempt_id => {
            AuthorityDecision::StaleAttempt
        }
        Some(token) if token.fence != snapshot.attempt.fence => AuthorityDecision::StaleFence,
        Some(_) if !execution_owned => AuthorityDecision::TerminalAttempt,
        Some(_) if !clock.validity.allows_mutation() => AuthorityDecision::ClockDiscontinuity,
        Some(_) if hard_budget_elapsed => AuthorityDecision::HardBudgetElapsed,
        Some(_) if lease_elapsed => AuthorityDecision::LeaseElapsed,
        Some(_) => AuthorityDecision::Authorized,
    };

    let next_reevaluation_at =
        if applicable && !clock.validity.needs_reconciliation() && !expired && !review_required {
            window
                .future_deadlines(clock.effective_at)
                .into_iter()
                .min()
        } else {
            None
        };

    Ok(AttemptTimeDecision {
        current: snapshot.current,
        execution_owned,
        lease_elapsed,
        hard_budget_elapsed,
        expired,
        expiry_reason,
        review_required,
        authority,
        next_reevaluation_at,
    })
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct LeaseRenewal {
    pub previous_lease_deadline: TimestampMs,
    pub new_lease_deadline: TimestampMs,
    pub hard_deadline: TimestampMs,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RenewalError {
    Authority(AuthorityDecision),
    Time(TimePolicyError),
}

/// Evaluate a renewal without mutating the attempt.  The hard deadline in the
/// returned value is always the original persisted deadline.
pub fn renew_lease(
    snapshot: AttemptSnapshot<'_>,
    token: AuthorityToken,
    clock: PolicyClock,
    lease_ttl_ms: u64,
) -> Result<LeaseRenewal, RenewalError> {
    let decision = evaluate_attempt(snapshot, clock, Some(token)).map_err(RenewalError::Time)?;
    if !decision.authority.is_authorized() {
        return Err(RenewalError::Authority(decision.authority));
    }
    let clock = clock.resolve().map_err(RenewalError::Time)?;
    let window = AttemptWindow::from_attempt(snapshot.attempt).map_err(RenewalError::Time)?;
    let new_lease_deadline =
        add_timestamp(clock.effective_at, lease_ttl_ms).map_err(RenewalError::Time)?;
    if new_lease_deadline <= clock.effective_at {
        return Err(RenewalError::Time(
            TimePolicyError::RenewalDeadlineNotAfterNow {
                as_of: clock.effective_at,
                deadline: new_lease_deadline,
            },
        ));
    }
    if new_lease_deadline < window.lease_deadline {
        return Err(RenewalError::Time(TimePolicyError::RenewalShortensLease {
            previous: window.lease_deadline,
            candidate: new_lease_deadline,
        }));
    }
    Ok(LeaseRenewal {
        previous_lease_deadline: window.lease_deadline,
        new_lease_deadline,
        hard_deadline: window.hard_deadline,
    })
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ScheduleDecision {
    pub eligible: bool,
    pub scheduled: bool,
    pub overdue: bool,
    pub next_change_at: Option<TimestampMs>,
}

pub fn evaluate_schedule(
    schedule: WorkSchedule,
    as_of: TimestampMs,
    terminal: bool,
) -> Result<ScheduleDecision, TimePolicyError> {
    if let (Some(start), Some(end)) = (schedule.target_start_at, schedule.target_end_at) {
        if end <= start {
            return Err(TimePolicyError::InvalidSchedule);
        }
    }

    let scheduled = schedule.not_before_at.is_some_and(|at| as_of < at);
    let eligible = !scheduled;
    let overdue = !terminal && schedule.due_at.is_some_and(|at| as_of >= at);
    let next_change_at = if terminal {
        None
    } else {
        [schedule.not_before_at, schedule.due_at]
            .into_iter()
            .flatten()
            .filter(|at| *at > as_of)
            .min()
    };
    Ok(ScheduleDecision {
        eligible,
        scheduled,
        overdue,
        next_change_at,
    })
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RetryPolicy {
    pub base_delay_ms: u64,
    pub max_delay_ms: u64,
    pub max_retries: u32,
}

impl RetryPolicy {
    pub const fn bounded(base_delay_ms: u64, max_delay_ms: u64, max_retries: u32) -> Self {
        Self {
            base_delay_ms,
            max_delay_ms,
            max_retries,
        }
    }

    pub const fn default() -> Self {
        Self::bounded(
            DEFAULT_RETRY_BASE_DELAY_MS,
            DEFAULT_RETRY_MAX_DELAY_MS,
            DEFAULT_MAX_RETRIES,
        )
    }

    fn validate(self) -> Result<(), TimePolicyError> {
        if self.max_delay_ms < self.base_delay_ms {
            return Err(TimePolicyError::InvalidBackoffBounds);
        }
        Ok(())
    }

    /// Exponential backoff with no random component. `retry_index = 0` is the
    /// first retry. Saturation at `max_delay_ms` is deterministic.
    pub fn delay_for(self, retry_index: u32) -> Result<u64, TimePolicyError> {
        self.validate()?;
        let shift = retry_index.min(63);
        let multiplier = 1_u64
            .checked_shl(shift)
            .ok_or(TimePolicyError::BackoffOverflow)?;
        let uncapped = self
            .base_delay_ms
            .checked_mul(multiplier)
            .unwrap_or(u64::MAX);
        Ok(uncapped.min(self.max_delay_ms))
    }

    pub fn retry_not_before(
        self,
        failed_at: TimestampMs,
        retry_index: u32,
    ) -> Result<TimestampMs, TimePolicyError> {
        add_timestamp(failed_at, self.delay_for(retry_index)?)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RetryInput {
    pub failure_count: u32,
    pub retry_not_before: Option<TimestampMs>,
}

impl RetryInput {
    pub const fn none() -> Self {
        Self {
            failure_count: 0,
            retry_not_before: None,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RetryDecision {
    pub exhausted: bool,
    pub waiting: bool,
    pub eligible: bool,
    pub retry_not_before: Option<TimestampMs>,
    pub next_change_at: Option<TimestampMs>,
}

pub fn evaluate_retry(
    policy: RetryPolicy,
    retry: RetryInput,
    as_of: TimestampMs,
) -> Result<RetryDecision, TimePolicyError> {
    policy.validate()?;
    let exhausted = retry.failure_count >= policy.max_retries;
    let waiting = !exhausted && retry.retry_not_before.is_some_and(|at| as_of < at);
    let eligible = !exhausted && !waiting;
    Ok(RetryDecision {
        exhausted,
        waiting,
        eligible,
        retry_not_before: retry.retry_not_before,
        next_change_at: retry
            .retry_not_before
            .filter(|at| !exhausted && *at > as_of),
    })
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TimePolicyInput<'a> {
    pub clock: PolicyClock,
    pub schedule: WorkSchedule,
    pub terminal: bool,
    pub retry_policy: RetryPolicy,
    pub retry: RetryInput,
    pub attempt: Option<AttemptSnapshot<'a>>,
    pub authority: Option<AuthorityToken>,
    pub exception_valid_until: Option<TimestampMs>,
    pub review_readback_at: Option<TimestampMs>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct TimePolicyDecision {
    pub clock: ClockView,
    pub schedule: ScheduleDecision,
    pub retry: RetryDecision,
    pub attempt: Option<AttemptTimeDecision>,
    pub exception_valid: bool,
    pub overdue: bool,
    pub next_reevaluation_at: Option<TimestampMs>,
}

/// Combine the independent time predicates without allowing one timer to
/// mutate another.  In particular, due/overdue is informational, a retry
/// timer never changes attempt ownership, and a lease renewal never moves the
/// hard deadline.
pub fn evaluate_time_policy(
    input: TimePolicyInput<'_>,
) -> Result<TimePolicyDecision, TimePolicyError> {
    let clock = input.clock.resolve()?;
    let mut schedule = evaluate_schedule(input.schedule, clock.effective_at, input.terminal)?;
    let mut retry = evaluate_retry(input.retry_policy, input.retry, clock.effective_at)?;
    let attempt = input
        .attempt
        .map(|snapshot| evaluate_attempt(snapshot, input.clock, input.authority))
        .transpose()?;
    let expiry_review_active = attempt.is_some_and(|decision| decision.review_required);
    let forward_progress_blocked = clock.validity.needs_reconciliation() || expiry_review_active;
    if forward_progress_blocked {
        schedule.eligible = false;
        schedule.next_change_at = None;
        retry.eligible = false;
        retry.next_change_at = None;
    }
    let exception_valid = input
        .exception_valid_until
        .is_none_or(|until| clock.effective_at < until);

    let mut timers = Vec::new();
    if !forward_progress_blocked {
        timers.extend(schedule.next_change_at);
        timers.extend(retry.next_change_at);
        if let Some(until) = input
            .exception_valid_until
            .filter(|until| *until > clock.effective_at)
        {
            timers.push(until);
        }
        if let Some(readback_at) = input
            .review_readback_at
            .filter(|at| *at > clock.effective_at)
        {
            timers.push(readback_at);
        }
        if let Some(attempt) = attempt {
            timers.extend(attempt.next_reevaluation_at);
        }
    }
    timers.sort();
    timers.dedup();

    Ok(TimePolicyDecision {
        clock,
        schedule,
        retry,
        attempt,
        exception_valid,
        overdue: schedule.overdue,
        next_reevaluation_at: timers.into_iter().next(),
    })
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DeadlineKind {
    Lease,
    HardBudget,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TimePolicyError {
    TimestampOverflow,
    DeadlineNotAfterClaim {
        kind: DeadlineKind,
        claimed_at: TimestampMs,
        deadline: TimestampMs,
    },
    InvalidSchedule,
    InvalidBackoffBounds,
    BackoffOverflow,
    MissingExpiryReason,
    RenewalDeadlineNotAfterNow {
        as_of: TimestampMs,
        deadline: TimestampMs,
    },
    RenewalShortensLease {
        previous: TimestampMs,
        candidate: TimestampMs,
    },
}

impl fmt::Display for TimePolicyError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::TimestampOverflow => formatter.write_str("timestamp arithmetic overflow"),
            Self::DeadlineNotAfterClaim {
                kind,
                claimed_at,
                deadline,
            } => write!(
                formatter,
                "{kind:?} deadline {deadline} is not after claim {claimed_at}"
            ),
            Self::InvalidSchedule => formatter.write_str("target schedule end is not after start"),
            Self::InvalidBackoffBounds => {
                formatter.write_str("backoff maximum is below the base delay")
            }
            Self::BackoffOverflow => formatter.write_str("backoff arithmetic overflow"),
            Self::MissingExpiryReason => {
                formatter.write_str("expiry review has no triggering deadline or retained reason")
            }
            Self::RenewalDeadlineNotAfterNow { as_of, deadline } => write!(
                formatter,
                "renewed lease deadline {deadline} is not after renewal time {as_of}"
            ),
            Self::RenewalShortensLease {
                previous,
                candidate,
            } => write!(
                formatter,
                "renewed lease deadline {candidate} would shorten existing lease {previous}"
            ),
        }
    }
}

impl std::error::Error for TimePolicyError {}

fn max_timestamp(left: TimestampMs, right: TimestampMs) -> TimestampMs {
    if left >= right {
        left
    } else {
        right
    }
}

fn add_timestamp(timestamp: TimestampMs, duration_ms: u64) -> Result<TimestampMs, TimePolicyError> {
    timestamp
        .as_millis()
        .checked_add(duration_ms)
        .map(TimestampMs::from_millis)
        .ok_or(TimePolicyError::TimestampOverflow)
}
