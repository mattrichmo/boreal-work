//! Fenced attempt runtime policy and the adapter boundary for lifecycle writes.
//!
//! The store currently exposes only the atomic claim primitive.  This module
//! therefore keeps the P2 lifecycle contract typed and persistence-neutral:
//! adapters receive one command that they must apply atomically, and must
//! recheck the expected phase, fence, deadlines, and operation identity in
//! their transaction.  The policy in this file is pure and is shared by all
//! adapters.

use boreal_domain::{
    ActorId, AttemptId, AttemptPhase, Fence, HarnessId, OperationId, ProjectId, SessionId,
    TimestampMs, WorkId, DEFAULT_HARD_TIME_LIMIT_MS, DEFAULT_LEASE_TTL_MS,
};
use boreal_store::StoreError;

use crate::{ApplicationError, OperationResult, WorkApplication};

pub const DEFAULT_HARD_ATTEMPT_TIME_LIMIT_MS: u64 = DEFAULT_HARD_TIME_LIMIT_MS;
pub const DEFAULT_RENEWABLE_LEASE_TTL_MS: u64 = DEFAULT_LEASE_TTL_MS;

/// A stop acknowledgement or an operator-reviewed safe recovery is required
/// before an expired attempt can be made terminal.  This prevents a late
/// timer from silently handing a shared worktree to a replacement attempt.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StopConfirmation {
    AdapterAcknowledged,
    ReviewedSafeRecovery,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LivenessMetadata {
    pub phase: Option<AttemptPhase>,
    pub tool: Option<String>,
    pub process: Option<String>,
}

impl LivenessMetadata {
    pub fn empty() -> Self {
        Self {
            phase: None,
            tool: None,
            process: None,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AttemptRequest {
    pub project_id: ProjectId,
    pub work_id: WorkId,
    pub attempt_id: AttemptId,
    pub actor_id: ActorId,
    pub harness_id: Option<HarnessId>,
    pub session_id: Option<SessionId>,
    pub fence: Fence,
    pub operation_id: OperationId,
    pub request_digest: String,
    pub at: TimestampMs,
}

impl AttemptRequest {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        project_id: ProjectId,
        work_id: WorkId,
        attempt_id: AttemptId,
        actor_id: ActorId,
        harness_id: Option<HarnessId>,
        session_id: Option<SessionId>,
        fence: Fence,
        operation_id: OperationId,
        request_digest: impl Into<String>,
        at: TimestampMs,
    ) -> Self {
        Self {
            project_id,
            work_id,
            attempt_id,
            actor_id,
            harness_id,
            session_id,
            fence,
            operation_id,
            request_digest: request_digest.into(),
            at,
        }
    }
}

pub type AcceptAttemptRequest = AttemptRequest;
pub type StartAttemptRequest = AttemptRequest;
pub type SubmitAttemptRequest = AttemptRequest;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HeartbeatAttemptRequest {
    pub attempt: AttemptRequest,
    pub liveness: LivenessMetadata,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RenewLeaseAttemptRequest {
    pub attempt: AttemptRequest,
    pub lease_ttl_ms: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EndAttemptRequest {
    pub attempt: AttemptRequest,
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExpireAttemptRequest {
    pub attempt: AttemptRequest,
    pub confirmation: StopConfirmation,
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CancelAttemptRequest {
    pub attempt: AttemptRequest,
    pub confirmation: Option<StopConfirmation>,
    pub reason: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AttemptCommandKind {
    Accept,
    Start,
    Heartbeat,
    RenewLease {
        lease_ttl_ms: u64,
    },
    Submit,
    Release,
    Fail,
    Expire {
        confirmation: StopConfirmation,
    },
    Cancel {
        confirmation: Option<StopConfirmation>,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AttemptCommand {
    pub project_id: ProjectId,
    pub work_id: WorkId,
    pub attempt_id: AttemptId,
    pub actor_id: ActorId,
    pub harness_id: Option<HarnessId>,
    pub session_id: Option<SessionId>,
    pub fence: Fence,
    pub operation_id: OperationId,
    pub request_digest: String,
    pub at: TimestampMs,
    pub expected_phase: AttemptPhase,
    pub expected_lease_deadline: TimestampMs,
    pub expected_hard_deadline: TimestampMs,
    pub kind: AttemptCommandKind,
    pub liveness: Option<LivenessMetadata>,
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AttemptSnapshot {
    pub project_id: ProjectId,
    pub work_id: WorkId,
    pub attempt_id: AttemptId,
    pub actor_id: ActorId,
    pub harness_id: Option<HarnessId>,
    pub session_id: Option<SessionId>,
    pub fence: Fence,
    pub phase: AttemptPhase,
    pub claimed_at: TimestampMs,
    pub accepted_at: Option<TimestampMs>,
    pub lease_deadline: TimestampMs,
    pub hard_deadline: TimestampMs,
    pub current: bool,
}

impl AttemptSnapshot {
    pub fn effective_expiry(&self, at: TimestampMs) -> Option<ExpiryKind> {
        if at >= self.hard_deadline {
            Some(ExpiryKind::HardBudget)
        } else if at >= self.lease_deadline {
            Some(ExpiryKind::Lease)
        } else {
            None
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ExpiryKind {
    Lease,
    HardBudget,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AttemptMutation {
    pub operation_id: OperationId,
    pub request_digest: String,
    pub attempt_id: AttemptId,
    pub fence: Fence,
    pub phase: AttemptPhase,
    pub lease_deadline: TimestampMs,
    pub hard_deadline: TimestampMs,
    pub revision: u64,
    pub changed: bool,
    pub replayed: bool,
}

/// Adapter-facing atomic lifecycle contract.
///
/// `transact_attempt` is one short store transaction: it must re-read the
/// current attempt, reject stale fences and elapsed deadlines, apply the
/// legal transition, persist its audit/operation result, and commit one
/// revision.  An adapter must return the committed result with `replayed` set
/// for a duplicate operation ID.  It must never return success for an unknown
/// outcome.  `read_attempt_operation` exists so a caller can resolve a timeout
/// or disconnect without guessing whether a mutation committed.
pub trait AttemptLifecycleAdapter {
    fn current_attempt(
        &self,
        project_id: &ProjectId,
        attempt_id: &AttemptId,
    ) -> Result<AttemptSnapshot, AttemptAdapterError>;

    fn transact_attempt(
        &self,
        command: AttemptCommand,
    ) -> Result<AttemptMutation, AttemptAdapterError>;

    fn read_attempt_operation(
        &self,
        project_id: &ProjectId,
        operation_id: &OperationId,
    ) -> Result<Option<AttemptMutation>, AttemptAdapterError>;
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AttemptAdapterError {
    Store(StoreError),
    NotFound { entity: &'static str, id: String },
    StaleFence { expected: Fence, current: Fence },
    LeaseExpired,
    Conflict(String),
    Busy(String),
    UnknownOutcome(String),
    Rejected(String),
}

impl std::fmt::Display for AttemptAdapterError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Store(error) => error.fmt(formatter),
            Self::NotFound { entity, id } => write!(formatter, "{entity} not found: {id}"),
            Self::StaleFence { .. } => formatter.write_str("stale_fence"),
            Self::LeaseExpired => formatter.write_str("lease_expired"),
            Self::Conflict(message)
            | Self::Busy(message)
            | Self::UnknownOutcome(message)
            | Self::Rejected(message) => formatter.write_str(message),
        }
    }
}

impl std::error::Error for AttemptAdapterError {}

impl From<StoreError> for AttemptAdapterError {
    fn from(error: StoreError) -> Self {
        Self::Store(error)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AttemptPolicy {
    pub default_lease_ttl_ms: u64,
    pub default_hard_time_limit_ms: u64,
    pub max_lease_ttl_ms: Option<u64>,
}

impl Default for AttemptPolicy {
    fn default() -> Self {
        Self {
            default_lease_ttl_ms: DEFAULT_RENEWABLE_LEASE_TTL_MS,
            default_hard_time_limit_ms: DEFAULT_HARD_ATTEMPT_TIME_LIMIT_MS,
            max_lease_ttl_ms: None,
        }
    }
}

impl AttemptPolicy {
    pub fn deadlines(
        &self,
        claimed_at: TimestampMs,
        lease_ttl_ms: Option<u64>,
        hard_time_limit_ms: Option<u64>,
    ) -> Result<AttemptDeadlines, AttemptPolicyError> {
        let lease_ttl_ms = lease_ttl_ms.unwrap_or(self.default_lease_ttl_ms);
        let hard_time_limit_ms = hard_time_limit_ms.unwrap_or(self.default_hard_time_limit_ms);
        self.validate_lease_ttl(lease_ttl_ms)?;
        if hard_time_limit_ms == 0 {
            return Err(AttemptPolicyError::InvalidDuration {
                field: "hard_time_limit_ms",
            });
        }
        Ok(AttemptDeadlines {
            lease_deadline: claimed_at.checked_add(lease_ttl_ms).map_err(|_| {
                AttemptPolicyError::TimestampOverflow {
                    field: "lease_deadline",
                }
            })?,
            hard_deadline: claimed_at.checked_add(hard_time_limit_ms).map_err(|_| {
                AttemptPolicyError::TimestampOverflow {
                    field: "hard_deadline",
                }
            })?,
        })
    }

    pub fn validate_lease_ttl(&self, lease_ttl_ms: u64) -> Result<(), AttemptPolicyError> {
        if lease_ttl_ms == 0 {
            return Err(AttemptPolicyError::InvalidDuration {
                field: "lease_ttl_ms",
            });
        }
        if self
            .max_lease_ttl_ms
            .is_some_and(|maximum| lease_ttl_ms > maximum)
        {
            return Err(AttemptPolicyError::LeaseTtlTooLong { lease_ttl_ms });
        }
        Ok(())
    }

    fn validate_request(&self, request: &AttemptRequest) -> Result<(), AttemptPolicyError> {
        for (name, value) in [
            ("project_id", request.project_id.as_str()),
            ("work_id", request.work_id.as_str()),
            ("attempt_id", request.attempt_id.as_str()),
            ("actor_id", request.actor_id.as_str()),
            ("operation_id", request.operation_id.as_str()),
        ] {
            if value.is_empty()
                || value.len() > 255
                || value
                    .chars()
                    .any(|character| character.is_control() || character.is_whitespace())
            {
                return Err(AttemptPolicyError::InvalidIdentifier { field: name });
            }
        }
        if let Some(harness_id) = &request.harness_id {
            if harness_id.as_str().is_empty()
                || harness_id.as_str().len() > 255
                || harness_id
                    .as_str()
                    .chars()
                    .any(|character| character.is_control() || character.is_whitespace())
            {
                return Err(AttemptPolicyError::InvalidIdentifier {
                    field: "harness_id",
                });
            }
        }
        if let Some(session_id) = &request.session_id {
            if session_id.as_str().is_empty()
                || session_id.as_str().len() > 255
                || session_id
                    .as_str()
                    .chars()
                    .any(|character| character.is_control() || character.is_whitespace())
            {
                return Err(AttemptPolicyError::InvalidIdentifier {
                    field: "session_id",
                });
            }
        }
        if request.fence.get() == 0 {
            return Err(AttemptPolicyError::InvalidFence);
        }
        if request.request_digest.trim().is_empty() {
            return Err(AttemptPolicyError::MissingRequestDigest);
        }
        Ok(())
    }

    pub fn validate(
        &self,
        snapshot: &AttemptSnapshot,
        request: &AttemptRequest,
        kind: AttemptCommandKind,
    ) -> Result<(), AttemptPolicyError> {
        self.validate_request(request)?;
        if !snapshot.current {
            return Err(AttemptPolicyError::NotCurrent);
        }
        if snapshot.project_id != request.project_id || snapshot.work_id != request.work_id {
            return Err(AttemptPolicyError::WrongSubject);
        }
        if snapshot.attempt_id != request.attempt_id {
            return Err(AttemptPolicyError::WrongSubject);
        }
        if snapshot.actor_id != request.actor_id {
            return Err(AttemptPolicyError::WrongOwner);
        }
        if snapshot.harness_id != request.harness_id
            && !(matches!(kind, AttemptCommandKind::Accept)
                && snapshot.harness_id.is_none()
                && request.harness_id.is_some())
        {
            return Err(AttemptPolicyError::WrongOwner);
        }
        if snapshot.session_id != request.session_id
            && !(matches!(kind, AttemptCommandKind::Accept)
                && snapshot.session_id.is_none()
                && request.session_id.is_some())
        {
            return Err(AttemptPolicyError::WrongOwner);
        }
        if snapshot.fence != request.fence {
            return Err(AttemptPolicyError::StaleFence);
        }

        let expiry = snapshot.effective_expiry(request.at);
        if !matches!(
            kind,
            AttemptCommandKind::Expire { .. } | AttemptCommandKind::Cancel { .. }
        ) && expiry.is_some()
        {
            return Err(match expiry {
                Some(ExpiryKind::Lease) => AttemptPolicyError::LeaseExpired,
                Some(ExpiryKind::HardBudget) => AttemptPolicyError::HardDeadlineElapsed,
                None => unreachable!(),
            });
        }

        match kind {
            AttemptCommandKind::Accept if snapshot.phase == AttemptPhase::Claimed => Ok(()),
            AttemptCommandKind::Start if snapshot.phase == AttemptPhase::Accepted => Ok(()),
            AttemptCommandKind::Heartbeat if snapshot.phase.is_terminal() => {
                Err(AttemptPolicyError::TerminalAttempt)
            }
            AttemptCommandKind::Heartbeat => Ok(()),
            AttemptCommandKind::RenewLease { lease_ttl_ms } if !snapshot.phase.is_terminal() => {
                self.validate_lease_ttl(lease_ttl_ms)
            }
            AttemptCommandKind::Submit if snapshot.phase == AttemptPhase::Running => Ok(()),
            AttemptCommandKind::Release
                if matches!(
                    snapshot.phase,
                    AttemptPhase::Claimed
                        | AttemptPhase::Accepted
                        | AttemptPhase::Running
                        | AttemptPhase::Verifying
                ) =>
            {
                Ok(())
            }
            AttemptCommandKind::Fail
                if matches!(
                    snapshot.phase,
                    AttemptPhase::Running | AttemptPhase::Verifying
                ) =>
            {
                Ok(())
            }
            AttemptCommandKind::Expire { confirmation } => {
                if snapshot.effective_expiry(request.at).is_none()
                    && snapshot.phase != AttemptPhase::ExpiryPending
                {
                    return Err(AttemptPolicyError::NotExpired);
                }
                let _ = confirmation;
                if matches!(
                    snapshot.phase,
                    AttemptPhase::Claimed
                        | AttemptPhase::Accepted
                        | AttemptPhase::Running
                        | AttemptPhase::Verifying
                        | AttemptPhase::ExpiryPending
                ) {
                    Ok(())
                } else {
                    Err(AttemptPolicyError::TerminalAttempt)
                }
            }
            AttemptCommandKind::Cancel { confirmation: None } => {
                Err(AttemptPolicyError::StopConfirmationRequired)
            }
            AttemptCommandKind::Cancel {
                confirmation: Some(_),
            } if matches!(
                snapshot.phase,
                AttemptPhase::Claimed
                    | AttemptPhase::Accepted
                    | AttemptPhase::Running
                    | AttemptPhase::Verifying
                    | AttemptPhase::ExpiryPending
            ) =>
            {
                Ok(())
            }
            _ => Err(AttemptPolicyError::IllegalTransition {
                phase: snapshot.phase,
            }),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AttemptDeadlines {
    pub lease_deadline: TimestampMs,
    pub hard_deadline: TimestampMs,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AttemptPolicyError {
    InvalidIdentifier { field: &'static str },
    InvalidFence,
    MissingRequestDigest,
    InvalidDuration { field: &'static str },
    TimestampOverflow { field: &'static str },
    LeaseTtlTooLong { lease_ttl_ms: u64 },
    WrongSubject,
    WrongOwner,
    NotCurrent,
    StaleFence,
    LeaseExpired,
    HardDeadlineElapsed,
    NotExpired,
    TerminalAttempt,
    StopConfirmationRequired,
    IllegalTransition { phase: AttemptPhase },
    OperationReplayConflict,
}

impl std::fmt::Display for AttemptPolicyError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidIdentifier { field } => write!(formatter, "invalid {field}"),
            Self::InvalidFence => formatter.write_str("fence must be positive"),
            Self::MissingRequestDigest => formatter.write_str("request digest is required"),
            Self::InvalidDuration { field } => write!(formatter, "{field} must be positive"),
            Self::TimestampOverflow { field } => write!(formatter, "{field} overflow"),
            Self::LeaseTtlTooLong { lease_ttl_ms } => {
                write!(formatter, "lease ttl is too long: {lease_ttl_ms}ms")
            }
            Self::WrongSubject => formatter.write_str("attempt subject does not match"),
            Self::WrongOwner => formatter.write_str("attempt owner does not match"),
            Self::NotCurrent => formatter.write_str("attempt is not current"),
            Self::StaleFence => formatter.write_str("stale_fence"),
            Self::LeaseExpired => formatter.write_str("lease_expired"),
            Self::HardDeadlineElapsed => formatter.write_str("hard_deadline_elapsed"),
            Self::NotExpired => formatter.write_str("attempt has not expired"),
            Self::TerminalAttempt => formatter.write_str("attempt is terminal"),
            Self::StopConfirmationRequired => formatter.write_str("stop confirmation is required"),
            Self::IllegalTransition { phase } => {
                write!(formatter, "illegal attempt transition from {phase:?}")
            }
            Self::OperationReplayConflict => formatter.write_str("operation replay conflict"),
        }
    }
}

impl std::error::Error for AttemptPolicyError {}

impl WorkApplication<'_> {
    pub fn accept<A: AttemptLifecycleAdapter>(
        &self,
        adapter: &A,
        request: AcceptAttemptRequest,
    ) -> Result<OperationResult<AttemptMutation>, ApplicationError> {
        self.run_attempt(adapter, request, AttemptCommandKind::Accept, None, None)
    }

    pub fn start<A: AttemptLifecycleAdapter>(
        &self,
        adapter: &A,
        request: StartAttemptRequest,
    ) -> Result<OperationResult<AttemptMutation>, ApplicationError> {
        self.run_attempt(adapter, request, AttemptCommandKind::Start, None, None)
    }

    pub fn heartbeat<A: AttemptLifecycleAdapter>(
        &self,
        adapter: &A,
        request: HeartbeatAttemptRequest,
    ) -> Result<OperationResult<AttemptMutation>, ApplicationError> {
        self.run_attempt(
            adapter,
            request.attempt,
            AttemptCommandKind::Heartbeat,
            Some(request.liveness),
            None,
        )
    }

    pub fn renew_lease<A: AttemptLifecycleAdapter>(
        &self,
        adapter: &A,
        request: RenewLeaseAttemptRequest,
    ) -> Result<OperationResult<AttemptMutation>, ApplicationError> {
        self.run_attempt(
            adapter,
            request.attempt,
            AttemptCommandKind::RenewLease {
                lease_ttl_ms: request.lease_ttl_ms,
            },
            None,
            None,
        )
    }

    pub fn submit<A: AttemptLifecycleAdapter>(
        &self,
        adapter: &A,
        request: SubmitAttemptRequest,
    ) -> Result<OperationResult<AttemptMutation>, ApplicationError> {
        self.run_attempt(adapter, request, AttemptCommandKind::Submit, None, None)
    }

    pub fn release<A: AttemptLifecycleAdapter>(
        &self,
        adapter: &A,
        request: EndAttemptRequest,
    ) -> Result<OperationResult<AttemptMutation>, ApplicationError> {
        self.run_attempt(
            adapter,
            request.attempt,
            AttemptCommandKind::Release,
            None,
            request.reason,
        )
    }

    pub fn fail<A: AttemptLifecycleAdapter>(
        &self,
        adapter: &A,
        request: EndAttemptRequest,
    ) -> Result<OperationResult<AttemptMutation>, ApplicationError> {
        self.run_attempt(
            adapter,
            request.attempt,
            AttemptCommandKind::Fail,
            None,
            request.reason,
        )
    }

    pub fn expire<A: AttemptLifecycleAdapter>(
        &self,
        adapter: &A,
        request: ExpireAttemptRequest,
    ) -> Result<OperationResult<AttemptMutation>, ApplicationError> {
        self.run_attempt(
            adapter,
            request.attempt,
            AttemptCommandKind::Expire {
                confirmation: request.confirmation,
            },
            None,
            request.reason,
        )
    }

    pub fn cancel<A: AttemptLifecycleAdapter>(
        &self,
        adapter: &A,
        request: CancelAttemptRequest,
    ) -> Result<OperationResult<AttemptMutation>, ApplicationError> {
        self.run_attempt(
            adapter,
            request.attempt,
            AttemptCommandKind::Cancel {
                confirmation: request.confirmation,
            },
            None,
            request.reason,
        )
    }

    fn run_attempt<A: AttemptLifecycleAdapter>(
        &self,
        adapter: &A,
        request: AttemptRequest,
        kind: AttemptCommandKind,
        liveness: Option<LivenessMetadata>,
        reason: Option<String>,
    ) -> Result<OperationResult<AttemptMutation>, ApplicationError> {
        let policy = AttemptPolicy::default();
        let replay = adapter.read_attempt_operation(&request.project_id, &request.operation_id)?;
        if let Some(result) = replay {
            if result.request_digest != request.request_digest {
                return Err(AttemptPolicyError::OperationReplayConflict.into());
            }
            return Ok(operation_result(result));
        }

        let snapshot = adapter.current_attempt(&request.project_id, &request.attempt_id)?;
        policy.validate(&snapshot, &request, kind)?;
        let command = AttemptCommand {
            project_id: request.project_id.clone(),
            work_id: request.work_id.clone(),
            attempt_id: request.attempt_id.clone(),
            actor_id: request.actor_id.clone(),
            harness_id: request.harness_id.clone(),
            session_id: request.session_id.clone(),
            fence: request.fence,
            operation_id: request.operation_id.clone(),
            request_digest: request.request_digest.clone(),
            at: request.at,
            expected_phase: snapshot.phase,
            expected_lease_deadline: snapshot.lease_deadline,
            expected_hard_deadline: snapshot.hard_deadline,
            kind,
            liveness,
            reason,
        };
        match adapter.transact_attempt(command) {
            Ok(result) => Ok(operation_result(result)),
            Err(AttemptAdapterError::UnknownOutcome(message)) => {
                let operation_id = request.operation_id.clone();
                match adapter.read_attempt_operation(&request.project_id, &operation_id)? {
                    Some(result) if result.request_digest == request.request_digest => {
                        Ok(operation_result(result))
                    }
                    Some(_) => Err(AttemptPolicyError::OperationReplayConflict.into()),
                    None => Err(AttemptAdapterError::UnknownOutcome(message).into()),
                }
            }
            Err(error) => Err(error.into()),
        }
    }
}

fn operation_result(result: AttemptMutation) -> OperationResult<AttemptMutation> {
    OperationResult {
        operation_id: result.operation_id.as_str().to_owned(),
        snapshot_revision: result.revision,
        changed: result.changed,
        value: result,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use boreal_domain::{AttemptPhase, Fence};
    use std::cell::RefCell;

    fn snapshot(phase: AttemptPhase) -> AttemptSnapshot {
        AttemptSnapshot {
            project_id: ProjectId::new("p1"),
            work_id: WorkId::new("w1"),
            attempt_id: AttemptId::new("a1"),
            actor_id: ActorId::new("agent-1"),
            harness_id: Some(HarnessId::new("luna")),
            session_id: Some(SessionId::new("s1")),
            fence: Fence::new(7),
            phase,
            claimed_at: TimestampMs(0),
            accepted_at: Some(TimestampMs(1)),
            lease_deadline: TimestampMs(30 * 60 * 1_000),
            hard_deadline: TimestampMs(2 * 60 * 60 * 1_000),
            current: true,
        }
    }

    fn request(operation: &str, at: u64) -> AttemptRequest {
        AttemptRequest::new(
            ProjectId::new("p1"),
            WorkId::new("w1"),
            AttemptId::new("a1"),
            ActorId::new("agent-1"),
            Some(HarnessId::new("luna")),
            Some(SessionId::new("s1")),
            Fence::new(7),
            OperationId::new(operation),
            "sha256:req",
            TimestampMs(at),
        )
    }

    #[test]
    fn default_deadlines_keep_two_hour_budget_immutable() {
        let deadlines = AttemptPolicy::default()
            .deadlines(TimestampMs(10_000), Some(30_000), None)
            .unwrap();
        assert_eq!(deadlines.lease_deadline, TimestampMs(40_000));
        assert_eq!(deadlines.hard_deadline, TimestampMs(7_210_000));
        let renewed = TimestampMs(20_000)
            .checked_add(30_000)
            .expect("renewed lease");
        assert_eq!(renewed, TimestampMs(50_000));
        assert_eq!(deadlines.hard_deadline, TimestampMs(7_210_000));
    }

    #[test]
    fn hard_deadline_wins_over_lease_and_blocks_heartbeat() {
        let current = snapshot(AttemptPhase::Running);
        let mut at_deadline = current.clone();
        at_deadline.lease_deadline = TimestampMs(10);
        at_deadline.hard_deadline = TimestampMs(20);
        let request = request("op-heartbeat", 20);
        assert_eq!(
            at_deadline.effective_expiry(request.at),
            Some(ExpiryKind::HardBudget)
        );
        assert_eq!(
            AttemptPolicy::default().validate(
                &at_deadline,
                &request,
                AttemptCommandKind::Heartbeat
            ),
            Err(AttemptPolicyError::HardDeadlineElapsed)
        );
        assert_eq!(current.hard_deadline, TimestampMs(2 * 60 * 60 * 1_000));
    }

    #[test]
    fn stale_fence_and_illegal_phase_are_rejected_before_adapter_call() {
        let mut stale = request("op-stale", 5);
        stale.fence = Fence::new(6);
        assert_eq!(
            AttemptPolicy::default().validate(
                &snapshot(AttemptPhase::Running),
                &stale,
                AttemptCommandKind::Submit
            ),
            Err(AttemptPolicyError::StaleFence)
        );
        assert_eq!(
            AttemptPolicy::default().validate(
                &snapshot(AttemptPhase::Claimed),
                &request("op-start", 5),
                AttemptCommandKind::Start
            ),
            Err(AttemptPolicyError::IllegalTransition {
                phase: AttemptPhase::Claimed
            })
        );
    }

    #[test]
    fn expiry_requires_deadline_but_allows_fenced_stop() {
        let current = snapshot(AttemptPhase::Running);
        let expiry_request = request("op-expire", current.hard_deadline.as_millis());
        assert!(AttemptPolicy::default()
            .validate(
                &current,
                &expiry_request,
                AttemptCommandKind::Expire {
                    confirmation: StopConfirmation::AdapterAcknowledged
                }
            )
            .is_ok());
        assert_eq!(
            AttemptPolicy::default().validate(
                &snapshot(AttemptPhase::Running),
                &request("op-too-early", 5),
                AttemptCommandKind::Expire {
                    confirmation: StopConfirmation::ReviewedSafeRecovery
                }
            ),
            Err(AttemptPolicyError::NotExpired)
        );
    }

    #[derive(Default)]
    struct FakeAdapter {
        current: RefCell<Option<AttemptSnapshot>>,
        commands: RefCell<Vec<AttemptCommand>>,
        replay: RefCell<Option<AttemptMutation>>,
    }

    impl AttemptLifecycleAdapter for FakeAdapter {
        fn current_attempt(
            &self,
            _project_id: &ProjectId,
            _attempt_id: &AttemptId,
        ) -> Result<AttemptSnapshot, AttemptAdapterError> {
            self.current
                .borrow()
                .clone()
                .ok_or_else(|| AttemptAdapterError::NotFound {
                    entity: "attempt",
                    id: "a1".to_owned(),
                })
        }

        fn transact_attempt(
            &self,
            command: AttemptCommand,
        ) -> Result<AttemptMutation, AttemptAdapterError> {
            self.commands.borrow_mut().push(command.clone());
            Ok(AttemptMutation {
                operation_id: command.operation_id,
                request_digest: command.request_digest,
                attempt_id: command.attempt_id,
                fence: command.fence,
                phase: match command.kind {
                    AttemptCommandKind::Accept => AttemptPhase::Accepted,
                    AttemptCommandKind::Start => AttemptPhase::Running,
                    AttemptCommandKind::Submit => AttemptPhase::Verifying,
                    AttemptCommandKind::Release => AttemptPhase::Released,
                    AttemptCommandKind::Fail => AttemptPhase::Failed,
                    AttemptCommandKind::Expire { .. } => AttemptPhase::Expired,
                    AttemptCommandKind::Cancel { .. } => AttemptPhase::Cancelled,
                    AttemptCommandKind::Heartbeat => command.expected_phase,
                    AttemptCommandKind::RenewLease { .. } => command.expected_phase,
                },
                lease_deadline: command.expected_lease_deadline,
                hard_deadline: command.expected_hard_deadline,
                revision: 11,
                changed: true,
                replayed: false,
            })
        }

        fn read_attempt_operation(
            &self,
            _project_id: &ProjectId,
            _operation_id: &OperationId,
        ) -> Result<Option<AttemptMutation>, AttemptAdapterError> {
            Ok(self.replay.borrow().clone())
        }
    }

    #[test]
    fn application_dispatches_typed_command_and_preserves_operation_replay() {
        let store = boreal_store::SqliteStore::open_in_memory(include_str!(
            "../../../project/spec/schema-v2.sql"
        ))
        .unwrap();
        let app = WorkApplication::new(&store);
        let adapter = FakeAdapter {
            current: RefCell::new(Some(snapshot(AttemptPhase::Claimed))),
            ..Default::default()
        };
        let result = app.accept(&adapter, request("op-accept", 5)).unwrap();
        assert!(result.changed);
        assert_eq!(
            adapter.commands.borrow()[0].expected_phase,
            AttemptPhase::Claimed
        );
        assert_eq!(result.value.fence, Fence::new(7));

        let mut replay = result.value.clone();
        replay.changed = false;
        replay.replayed = true;
        *adapter.replay.borrow_mut() = Some(replay);
        let result = app.accept(&adapter, request("op-accept", 5)).unwrap();
        assert!(!result.changed);
        assert_eq!(result.value.operation_id, OperationId::new("op-accept"));
        assert_eq!(adapter.commands.borrow().len(), 1);
    }
}
