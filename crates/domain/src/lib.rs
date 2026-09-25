//! Pure Boreal v2 domain types and invariants.
//!
//! This crate deliberately contains no persistence, serialization, terminal,
//! or process-execution code. Adapters provide canonical rows and consume the
//! decisions produced here.

use std::{fmt, str::FromStr};

use crate::work_model_v3::WorkSchedule;

pub mod acceptance;
pub mod actions;
pub mod completion;
pub mod decision_api;
pub mod decision_inputs;
pub mod dependencies;
pub mod rollups;
pub mod time_policy;

pub use actions::{ActionDecision, ActionDescriptor, ActionKind};
pub use decision_api::{
    evaluate_decision_actions, DecisionActionView, DecisionApiError, DecisionContextMismatch,
};
pub use decision_inputs::{DecisionDiagnostic, DecisionInputs};

/// Version-3 work-model value objects and pure validators.  This module is
/// additive: schema-2 rows and lifecycle APIs remain available until a store
/// migration and capability negotiation are integrated by the owning lanes.
pub mod work_model_v3;

mod status_evaluator;
pub use status_evaluator::{evaluate_canonical_status, evaluate_status};

/// The default immutable attempt budget, measured from `claimed_at`.
pub const DEFAULT_HARD_TIME_LIMIT_MS: u64 = 2 * 60 * 60 * 1_000;
/// The initial renewable ownership lease fixture.
pub const DEFAULT_LEASE_TTL_MS: u64 = 30 * 60 * 1_000;

macro_rules! typed_id {
    ($name:ident) => {
        #[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
        pub struct $name(String);

        impl $name {
            pub fn new(value: impl Into<String>) -> Self {
                Self(value.into())
            }

            pub fn parse(value: impl Into<String>) -> Result<Self, IdentifierError> {
                let value = value.into();
                if value.is_empty()
                    || value.len() > 255
                    || value
                        .chars()
                        .any(|character| character.is_control() || character.is_whitespace())
                {
                    return Err(IdentifierError::invalid(stringify!($name), value));
                }
                Ok(Self(value))
            }

            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl From<String> for $name {
            fn from(value: String) -> Self {
                Self::new(value)
            }
        }

        impl From<&str> for $name {
            fn from(value: &str) -> Self {
                Self::new(value)
            }
        }

        impl FromStr for $name {
            type Err = IdentifierError;

            fn from_str(value: &str) -> Result<Self, Self::Err> {
                Self::parse(value)
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str(self.as_str())
            }
        }
    };
}

typed_id!(ProjectId);
typed_id!(WorkId);
typed_id!(AttemptId);
typed_id!(ActorId);
typed_id!(HarnessId);
typed_id!(SessionId);
typed_id!(OperationId);
typed_id!(GateId);
typed_id!(ReceiptId);
typed_id!(ProfileId);
typed_id!(SourceVersionId);
typed_id!(ConfigIdentity);

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IdentifierError {
    pub type_name: &'static str,
    pub value: String,
}

impl IdentifierError {
    fn invalid(type_name: &'static str, value: String) -> Self {
        Self { type_name, value }
    }
}

impl fmt::Display for IdentifierError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "invalid {} identifier: {:?}",
            self.type_name, self.value
        )
    }
}

impl std::error::Error for IdentifierError {}

/// Milliseconds on the authoritative service/store clock.
#[derive(Clone, Copy, Debug, Default, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct TimestampMs(pub u64);

impl TimestampMs {
    pub const fn from_millis(value: u64) -> Self {
        Self(value)
    }

    pub const fn as_millis(self) -> u64 {
        self.0
    }

    pub fn checked_add(self, duration_ms: u64) -> Result<Self, DomainError> {
        self.0
            .checked_add(duration_ms)
            .map(Self)
            .ok_or(DomainError::TimestampOverflow)
    }
}

impl fmt::Display for TimestampMs {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct Revision(pub u64);

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct Fence(pub u64);

impl Fence {
    pub const fn new(value: u64) -> Self {
        Self(value)
    }

    pub const fn get(self) -> u64 {
        self.0
    }

    pub fn next(self) -> Result<Self, DomainError> {
        self.0
            .checked_add(1)
            .map(Self)
            .ok_or(DomainError::FenceOverflow)
    }
}

impl fmt::Display for Fence {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

/// The only work lifecycle values that may be persisted.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum PersistedLifecycle {
    Draft,
    Open,
    Closed,
    Cancelled,
}

pub type Lifecycle = PersistedLifecycle;

impl PersistedLifecycle {
    pub const fn is_terminal(self) -> bool {
        matches!(self, Self::Closed | Self::Cancelled)
    }
}

/// Human-facing status derived from canonical lifecycle, graph, policy,
/// attempt, gate, and clock inputs. It is never a writable persistence field.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum DerivedStatus {
    Draft,
    Queued,
    Ready,
    Claimed,
    InProgress,
    NeedsVerification,
    AwaitingReview,
    Complete,
    Closed,
    Blocked,
    Paused,
    RetryWait,
    /// Published work whose declared work/cycle activation instant is still
    /// in the future. This is distinct from ordinary prerequisite waiting.
    Scheduled,
    ExpiredReview,
    Cancelled,
}

pub type WorkStatus = DerivedStatus;

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum WorkKind {
    Milestone,
    Sprint,
    Task,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DispatchPolicy {
    Automatic,
    OperatorOnly,
    Paused,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ActorRole {
    Agent,
    Reviewer,
    Operator,
    Publisher,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ActorContext {
    pub actor_id: ActorId,
    pub role: ActorRole,
}

/// A canonical work row. Its effective status is obtained with
/// [`evaluate_status`].
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkItem {
    pub id: WorkId,
    pub project_id: ProjectId,
    pub kind: WorkKind,
    pub parent_id: Option<WorkId>,
    pub title: String,
    pub description: String,
    pub lifecycle: PersistedLifecycle,
    pub priority: u8,
    pub dispatch_policy: DispatchPolicy,
    pub hard_holds: Vec<ReasonCode>,
    pub acceptance_profile: AcceptanceProfile,
}

impl WorkItem {
    pub fn new(
        project_id: ProjectId,
        id: WorkId,
        kind: WorkKind,
        parent_id: Option<WorkId>,
        title: impl Into<String>,
    ) -> Self {
        Self {
            id,
            project_id,
            kind,
            parent_id,
            title: title.into(),
            description: String::new(),
            lifecycle: PersistedLifecycle::Draft,
            priority: 0,
            dispatch_policy: DispatchPolicy::Automatic,
            hard_holds: Vec::new(),
            acceptance_profile: AcceptanceProfile::focused(),
        }
    }

    pub fn open(mut self) -> Self {
        self.lifecycle = PersistedLifecycle::Open;
        self
    }
}

/// Legacy-compatible edge shape. All existing edges use close-only
/// satisfaction; versioned exceptions use [`DependencyEdge`].
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BlockingDependency {
    pub blocker_id: WorkId,
    pub blocked_id: WorkId,
}

impl BlockingDependency {
    pub fn new(blocker_id: WorkId, blocked_id: WorkId) -> Self {
        Self {
            blocker_id,
            blocked_id,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DependencyPolicy {
    /// Only an accepted closed result satisfies the edge.
    ClosedOnly,
}

impl Default for DependencyPolicy {
    fn default() -> Self {
        Self::ClosedOnly
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DependencyEdge {
    pub blocker_id: WorkId,
    pub blocked_id: WorkId,
    pub policy: DependencyPolicy,
}

impl DependencyEdge {
    pub fn close_only(blocker_id: WorkId, blocked_id: WorkId) -> Self {
        Self {
            blocker_id,
            blocked_id,
            policy: DependencyPolicy::ClosedOnly,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Reservation {
    pub work_id: WorkId,
    pub attempt_id: AttemptId,
    pub actor_id: ActorId,
    pub session_id: Option<SessionId>,
    pub harness_id: Option<HarnessId>,
    pub fence: Fence,
    pub lease_deadline: TimestampMs,
}

impl Reservation {
    pub fn from_attempt(attempt: &Attempt) -> Self {
        Self {
            work_id: attempt.work_id.clone(),
            attempt_id: attempt.attempt_id.clone(),
            actor_id: attempt.actor_id.clone(),
            session_id: attempt.session_id.clone(),
            harness_id: attempt.harness_id.clone(),
            fence: attempt.fence,
            lease_deadline: attempt.lease_deadline,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AttemptPhase {
    Claimed,
    Accepted,
    Running,
    Verifying,
    ExpiryPending,
    Completed,
    Failed,
    Released,
    Expired,
    Cancelled,
}

impl AttemptPhase {
    pub const fn is_terminal(self) -> bool {
        matches!(
            self,
            Self::Completed | Self::Failed | Self::Released | Self::Expired | Self::Cancelled
        )
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DeadlineSource {
    DefaultTwoHours,
    Explicit,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ExpiryReason {
    LeaseElapsed,
    HardBudgetElapsed,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Attempt {
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
    pub max_attempt_deadline: TimestampMs,
    pub deadline_source: DeadlineSource,
    pub last_heartbeat_at: Option<TimestampMs>,
    pub last_checkpoint_at: Option<TimestampMs>,
    pub review_required_after_expiry: bool,
}

impl Attempt {
    pub fn claim(
        work_id: WorkId,
        attempt_id: AttemptId,
        actor_id: ActorId,
        fence: Fence,
        claimed_at: TimestampMs,
        lease_ttl_ms: Option<u64>,
        hard_time_limit_ms: Option<u64>,
    ) -> Result<Self, DomainError> {
        let lease_ttl_ms = lease_ttl_ms.unwrap_or(DEFAULT_LEASE_TTL_MS);
        let hard_time_limit_ms = hard_time_limit_ms.unwrap_or(DEFAULT_HARD_TIME_LIMIT_MS);
        let lease_deadline = claimed_at.checked_add(lease_ttl_ms)?;
        let max_attempt_deadline = claimed_at.checked_add(hard_time_limit_ms)?;
        Ok(Self {
            work_id,
            attempt_id,
            actor_id,
            harness_id: None,
            session_id: None,
            fence,
            phase: AttemptPhase::Claimed,
            claimed_at,
            accepted_at: None,
            lease_deadline,
            max_attempt_deadline,
            deadline_source: if hard_time_limit_ms == DEFAULT_HARD_TIME_LIMIT_MS {
                DeadlineSource::DefaultTwoHours
            } else {
                DeadlineSource::Explicit
            },
            last_heartbeat_at: None,
            last_checkpoint_at: None,
            review_required_after_expiry: false,
        })
    }

    pub fn with_identity(mut self, session_id: SessionId, harness_id: HarnessId) -> Self {
        self.session_id = Some(session_id);
        self.harness_id = Some(harness_id);
        self
    }

    pub fn accept(&mut self, at: TimestampMs) -> Result<(), DomainError> {
        transition_attempt(self, AttemptOperation::Accept { at })
    }

    pub fn start(&mut self) -> Result<(), DomainError> {
        transition_attempt(self, AttemptOperation::Start)
    }

    pub fn submit(&mut self) -> Result<(), DomainError> {
        transition_attempt(self, AttemptOperation::Submit)
    }

    pub fn heartbeat(&mut self, at: TimestampMs) -> Result<DeadlineView, DomainError> {
        if self.phase.is_terminal() || at >= self.lease_deadline {
            return Err(DomainError::LeaseExpired);
        }
        self.last_heartbeat_at = Some(at);
        Ok(self.deadlines_at(at))
    }

    pub fn renew_lease(
        &mut self,
        at: TimestampMs,
        lease_ttl_ms: u64,
    ) -> Result<DeadlineView, DomainError> {
        if self.phase.is_terminal() || at >= self.lease_deadline {
            return Err(DomainError::LeaseExpired);
        }
        let candidate = at.checked_add(lease_ttl_ms)?;
        if candidate <= at || candidate < self.lease_deadline {
            return Err(DomainError::InvalidLeaseRenewal);
        }
        self.lease_deadline = candidate;
        Ok(self.deadlines_at(at))
    }

    pub fn deadlines_at(&self, as_of: TimestampMs) -> DeadlineView {
        DeadlineView {
            lease_deadline: self.lease_deadline,
            hard_deadline: self.max_attempt_deadline,
            expiry_reason: self.expiry_reason(as_of),
        }
    }

    pub fn expiry_reason(&self, as_of: TimestampMs) -> Option<ExpiryReason> {
        // Hard-budget expiry wins when both clocks have elapsed.
        if as_of >= self.max_attempt_deadline {
            Some(ExpiryReason::HardBudgetElapsed)
        } else if as_of >= self.lease_deadline {
            Some(ExpiryReason::LeaseElapsed)
        } else {
            None
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DeadlineView {
    pub lease_deadline: TimestampMs,
    pub hard_deadline: TimestampMs,
    pub expiry_reason: Option<ExpiryReason>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AttemptOperation {
    Accept { at: TimestampMs },
    Start,
    Submit,
    RecordReceipt,
    AcceptReview,
    RejectReview,
    Release,
    Fail,
    ExpiryPending,
    Expire,
    Cancel,
}

pub fn transition_attempt(
    attempt: &mut Attempt,
    operation: AttemptOperation,
) -> Result<(), DomainError> {
    let next = match (attempt.phase, operation) {
        (AttemptPhase::Claimed, AttemptOperation::Accept { .. }) => AttemptPhase::Accepted,
        (AttemptPhase::Accepted, AttemptOperation::Start) => AttemptPhase::Running,
        (AttemptPhase::Running, AttemptOperation::Submit) => AttemptPhase::Verifying,
        (AttemptPhase::Verifying, AttemptOperation::RecordReceipt) => AttemptPhase::Verifying,
        (AttemptPhase::Verifying, AttemptOperation::AcceptReview) => AttemptPhase::Completed,
        (AttemptPhase::Verifying, AttemptOperation::RejectReview) => AttemptPhase::Verifying,
        (
            AttemptPhase::Claimed
            | AttemptPhase::Accepted
            | AttemptPhase::Running
            | AttemptPhase::Verifying,
            AttemptOperation::Release,
        ) => AttemptPhase::Released,
        (AttemptPhase::Running | AttemptPhase::Verifying, AttemptOperation::Fail) => {
            AttemptPhase::Failed
        }
        (
            AttemptPhase::Claimed
            | AttemptPhase::Accepted
            | AttemptPhase::Running
            | AttemptPhase::Verifying,
            AttemptOperation::ExpiryPending,
        ) => AttemptPhase::ExpiryPending,
        (AttemptPhase::ExpiryPending, AttemptOperation::Expire) => AttemptPhase::Expired,
        (
            AttemptPhase::Claimed
            | AttemptPhase::Accepted
            | AttemptPhase::Running
            | AttemptPhase::Verifying
            | AttemptPhase::ExpiryPending,
            AttemptOperation::Cancel,
        ) => AttemptPhase::Cancelled,
        (_, operation) => {
            return Err(DomainError::IllegalAttemptTransition {
                from: attempt.phase,
                operation,
            })
        }
    };
    if let AttemptOperation::Accept { at } = operation {
        attempt.accepted_at = Some(at);
    }
    attempt.phase = next;
    Ok(())
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WorkOperation {
    Publish,
    Close,
    Cancel,
    Reopen,
}

pub fn transition_lifecycle(
    lifecycle: PersistedLifecycle,
    operation: WorkOperation,
) -> Result<PersistedLifecycle, DomainError> {
    match (lifecycle, operation) {
        (PersistedLifecycle::Draft, WorkOperation::Publish)
        | (PersistedLifecycle::Open, WorkOperation::Publish) => Ok(PersistedLifecycle::Open),
        (PersistedLifecycle::Open, WorkOperation::Close) => Ok(PersistedLifecycle::Closed),
        (PersistedLifecycle::Draft | PersistedLifecycle::Open, WorkOperation::Cancel) => {
            Ok(PersistedLifecycle::Cancelled)
        }
        (PersistedLifecycle::Closed | PersistedLifecycle::Cancelled, WorkOperation::Reopen) => {
            Ok(PersistedLifecycle::Open)
        }
        (_, operation) => Err(DomainError::IllegalLifecycleTransition {
            from: lifecycle,
            operation,
        }),
    }
}

/// Derived statuses are read-only. This helper gives adapters a single typed
/// rejection for requests that attempt to persist one.
pub fn reject_derived_status_write(status: DerivedStatus) -> Result<(), DomainError> {
    Err(DomainError::DerivedStatusReadOnly { status })
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum GateKind {
    Checkpoint,
    Verification,
    Review,
    OperatorApproval,
    Summary,
    Audit,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum GateState {
    Open,
    Satisfied,
    Failed,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GateRequirement {
    pub id: GateId,
    pub kind: GateKind,
    pub required: bool,
    pub state: GateState,
}

impl GateRequirement {
    pub fn required(id: GateId, kind: GateKind) -> Self {
        Self {
            id,
            kind,
            required: true,
            state: GateState::Open,
        }
    }

    pub fn satisfied(mut self) -> Self {
        self.state = GateState::Satisfied;
        self
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AcceptanceProfile {
    pub id: ProfileId,
    pub version: String,
    pub gates: Vec<GateRequirement>,
}

impl AcceptanceProfile {
    pub fn focused() -> Self {
        Self {
            id: ProfileId::new("focused"),
            version: "1".to_owned(),
            gates: vec![
                GateRequirement::required(GateId::new("checkpoint"), GateKind::Checkpoint),
                GateRequirement::required(GateId::new("verification"), GateKind::Verification),
                GateRequirement::required(GateId::new("summary"), GateKind::Summary),
            ],
        }
    }

    pub fn reviewed() -> Self {
        let mut profile = Self::focused();
        profile.id = ProfileId::new("reviewed");
        profile.gates.push(GateRequirement::required(
            GateId::new("review"),
            GateKind::Review,
        ));
        profile
    }

    pub fn requires_review(&self) -> bool {
        self.gates
            .iter()
            .any(|gate| gate.required && gate.kind == GateKind::Review)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReviewRecord {
    pub reviewer_actor_id: ActorId,
    pub attempt_actor_id: ActorId,
    pub accepted: bool,
}

pub fn validate_independent_review(review: &ReviewRecord) -> Result<(), DomainError> {
    if review.reviewer_actor_id == review.attempt_actor_id {
        Err(DomainError::ReviewerCannotReviewOwnAttempt)
    } else {
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReceiptSubject {
    pub work_id: WorkId,
    pub attempt_id: AttemptId,
    pub fence: Fence,
    pub gate_id: GateId,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReceiptIdentity {
    pub receipt_id: ReceiptId,
    pub operation_id: OperationId,
    pub subject: ReceiptSubject,
    pub source_snapshot: SourceVersionId,
    pub config_identity: ConfigIdentity,
    pub policy_version: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReceiptResult {
    Passed,
    Failed,
    Stale,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Receipt {
    pub identity: ReceiptIdentity,
    pub result: ReceiptResult,
    pub exit_code: i32,
    pub attested: bool,
}

pub fn validate_receipt_subject(
    receipt: &ReceiptIdentity,
    work_id: &WorkId,
    attempt_id: &AttemptId,
    fence: Fence,
) -> Result<(), DomainError> {
    if &receipt.subject.work_id != work_id {
        return Err(DomainError::ReceiptSubjectMismatch);
    }
    if &receipt.subject.attempt_id != attempt_id || receipt.subject.fence != fence {
        return Err(DomainError::StaleFence);
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CloseGap {
    CloseIntentMissing,
    GateUnsatisfied,
    ReviewRequired,
    ReviewRejected,
    StaleFence,
    AttemptNotVerifying,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CloseReadiness {
    ReadyToClose,
    NotReady { gaps: Vec<CloseGap> },
}

pub fn evaluate_close(
    profile: &AcceptanceProfile,
    gates: &[GateRequirement],
    review: Option<&ReviewRecord>,
    close_intent: bool,
    attempt: &Attempt,
    expected_fence: Fence,
) -> CloseReadiness {
    let mut gaps = Vec::new();
    if attempt.fence != expected_fence {
        gaps.push(CloseGap::StaleFence);
    }
    if !matches!(
        attempt.phase,
        AttemptPhase::Verifying | AttemptPhase::Completed
    ) {
        gaps.push(CloseGap::AttemptNotVerifying);
    }
    if !close_intent {
        gaps.push(CloseGap::CloseIntentMissing);
    }
    for required in profile.gates.iter().filter(|gate| gate.required) {
        let state = gates
            .iter()
            .find(|gate| gate.id == required.id)
            .map(|gate| gate.state);
        if state != Some(GateState::Satisfied) {
            if required.kind == GateKind::Review {
                if let Some(review) = review {
                    if validate_independent_review(review).is_err() || !review.accepted {
                        gaps.push(CloseGap::ReviewRejected);
                    } else {
                        continue;
                    }
                } else {
                    gaps.push(CloseGap::ReviewRequired);
                }
            } else {
                gaps.push(CloseGap::GateUnsatisfied);
            }
        }
    }
    gaps.sort_by_key(|gap| *gap as u8);
    gaps.dedup();
    if gaps.is_empty() {
        CloseReadiness::ReadyToClose
    } else {
        CloseReadiness::NotReady { gaps }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ReasonCode {
    TerminalClosed,
    TerminalCancelled,
    ExpiryReviewRequired,
    HardHold(String),
    NotPublished,
    AttemptUnaccepted,
    AttemptActive,
    VerificationRequired,
    ReviewRequired,
    CloseoutPending,
    PrerequisiteOpen(WorkId),
    Paused,
    RetryNotBefore(TimestampMs),
    /// A declared work or cycle activation instant has not arrived.
    ScheduledStart(TimestampMs),
    Eligible,
    OperatorOnly,
    NonExecutableContainer,
    LeaseElapsed,
    HardBudgetElapsed,
    GateOpen(GateId),
    GateFailed(GateId),
    GateMissing(GateId),
    GateInvalid(GateId),
    ReviewRejected(GateId),
    RoleDenied,
    AttemptSubjectMismatch,
    ContainerPlanning,
}

impl ReasonCode {
    pub fn stable_code(&self) -> String {
        match self {
            Self::TerminalClosed => "terminal_closed".to_owned(),
            Self::TerminalCancelled => "terminal_cancelled".to_owned(),
            Self::ExpiryReviewRequired => "expiry_review_required".to_owned(),
            Self::HardHold(reason) => reason.clone(),
            Self::NotPublished => "not_published".to_owned(),
            Self::AttemptUnaccepted => "attempt_unaccepted".to_owned(),
            Self::AttemptActive => "attempt_active".to_owned(),
            Self::VerificationRequired => "verification_required".to_owned(),
            Self::ReviewRequired => "review_required".to_owned(),
            Self::CloseoutPending => "closeout_pending".to_owned(),
            Self::PrerequisiteOpen(id) => format!("prerequisite_open({id})"),
            Self::Paused => "paused".to_owned(),
            Self::RetryNotBefore(at) => format!("retry_not_before({at})"),
            Self::ScheduledStart(at) => format!("scheduled_start({at})"),
            Self::Eligible => "eligible".to_owned(),
            Self::OperatorOnly => "operator_only".to_owned(),
            Self::NonExecutableContainer => "non_executable_container".to_owned(),
            Self::LeaseElapsed => "lease_elapsed".to_owned(),
            Self::HardBudgetElapsed => "hard_budget_elapsed".to_owned(),
            Self::GateOpen(id) => format!("gate_open({id})"),
            Self::GateFailed(id) => format!("gate_failed({id})"),
            Self::GateMissing(id) => format!("gate_missing({id})"),
            Self::GateInvalid(id) => format!("gate_invalid({id})"),
            Self::ReviewRejected(id) => format!("review_rejected({id})"),
            Self::RoleDenied => "role_denied".to_owned(),
            Self::AttemptSubjectMismatch => "attempt_subject_mismatch".to_owned(),
            Self::ContainerPlanning => "container_planning".to_owned(),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DomainAction {
    PublishWork,
    Claim,
    AcceptAttempt,
    ResumeAttempt,
    ProvideEvidence,
    RequestReview,
    FinishClose,
    WaitForPrerequisite,
    ResolveHold,
    ResumePolicy,
    WaitUntil,
    ReviewExpiry,
    RequestOperatorClaim,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CurrentAttempt {
    pub attempt_id: AttemptId,
    pub fence: Fence,
    pub phase: AttemptPhase,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StatusDecision {
    pub work_id: WorkId,
    pub project_revision: Revision,
    pub as_of: TimestampMs,
    pub next_status_change_at: Option<TimestampMs>,
    pub display_status: DerivedStatus,
    /// Chosen by precedence, never inferred from lexical reason ordering.
    pub primary_reason: ReasonCode,
    /// Primary reason first, then unique stable codes in lexical order.
    pub reason_codes: Vec<ReasonCode>,
    pub claimable_for_actor: bool,
    pub next_action: Option<DomainAction>,
    pub current_attempt: Option<CurrentAttempt>,
    pub gate_gaps: Vec<GateId>,
    pub affected_dependents: Vec<WorkId>,
}

/// Exact counts for a bounded parent/dashboard projection. Counts are computed
/// from the same status decisions rendered to the caller, so pagination never
/// turns an active-row limit into a false total.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct RollupCounts {
    pub total: usize,
    pub draft: usize,
    pub queued: usize,
    pub ready: usize,
    pub claimed: usize,
    pub in_progress: usize,
    pub needs_verification: usize,
    pub awaiting_review: usize,
    pub complete: usize,
    pub closed: usize,
    pub blocked: usize,
    pub paused: usize,
    pub retry_wait: usize,
    pub scheduled: usize,
    pub expired_review: usize,
    pub cancelled: usize,
}

impl RollupCounts {
    pub fn record(&mut self, status: DerivedStatus) {
        self.total += 1;
        match status {
            DerivedStatus::Draft => self.draft += 1,
            DerivedStatus::Queued => self.queued += 1,
            DerivedStatus::Ready => self.ready += 1,
            DerivedStatus::Claimed => self.claimed += 1,
            DerivedStatus::InProgress => self.in_progress += 1,
            DerivedStatus::NeedsVerification => self.needs_verification += 1,
            DerivedStatus::AwaitingReview => self.awaiting_review += 1,
            DerivedStatus::Complete => self.complete += 1,
            DerivedStatus::Closed => self.closed += 1,
            DerivedStatus::Blocked => self.blocked += 1,
            DerivedStatus::Paused => self.paused += 1,
            DerivedStatus::RetryWait => self.retry_wait += 1,
            DerivedStatus::Scheduled => self.scheduled += 1,
            DerivedStatus::ExpiredReview => self.expired_review += 1,
            DerivedStatus::Cancelled => self.cancelled += 1,
        }
    }
}

pub fn evaluate_rollup(statuses: &[StatusDecision]) -> RollupCounts {
    let mut counts = RollupCounts::default();
    for status in statuses {
        counts.record(status.display_status);
    }
    counts
}

pub struct StatusContext<'a> {
    pub work: &'a WorkItem,
    pub prerequisites: &'a [WorkItem],
    pub current_attempt: Option<&'a Attempt>,
    pub gates: &'a [GateRequirement],
    pub actor: &'a ActorContext,
    pub as_of: TimestampMs,
    pub project_revision: Revision,
    pub retry_not_before: Option<TimestampMs>,
    /// Optional canonical work schedule. `not_before_at` is a blocking
    /// availability constraint; target start/end remain planning metadata.
    pub schedule: Option<WorkSchedule>,
    /// Resolved cycle/assignment activation instant, when planning has
    /// supplied one. It is a second canonical constraint, not a UI hint.
    pub activation_at: Option<TimestampMs>,
    pub affected_dependents: &'a [WorkId],
}

impl<'a> StatusContext<'a> {
    pub fn new(
        work: &'a WorkItem,
        prerequisites: &'a [WorkItem],
        current_attempt: Option<&'a Attempt>,
        gates: &'a [GateRequirement],
        actor: &'a ActorContext,
        as_of: TimestampMs,
        project_revision: Revision,
    ) -> Self {
        Self {
            work,
            prerequisites,
            current_attempt,
            gates,
            actor,
            as_of,
            project_revision,
            retry_not_before: None,
            schedule: None,
            activation_at: None,
            affected_dependents: &[],
        }
    }

    pub fn with_schedule(mut self, schedule: WorkSchedule) -> Self {
        self.schedule = Some(schedule);
        self
    }

    pub fn with_activation_at(mut self, activation_at: TimestampMs) -> Self {
        self.activation_at = Some(activation_at);
        self
    }
}

/// Validates the schema-2 project containment hierarchy.
/// Root milestones and root tasks are allowed; only task rows are executable.
pub fn validate_parent(child: &WorkItem, parent: Option<&WorkItem>) -> Result<(), DomainError> {
    let Some(parent) = parent else {
        if matches!(child.kind, WorkKind::Milestone | WorkKind::Task) {
            return Ok(());
        }
        return Err(DomainError::ParentRequired {
            child: child.id.clone(),
            kind: child.kind,
        });
    };
    if child.project_id != parent.project_id {
        return Err(DomainError::CrossProjectReference {
            from: child.id.clone(),
            to: parent.id.clone(),
        });
    }
    let valid = matches!(
        (parent.kind, child.kind),
        (WorkKind::Milestone, WorkKind::Sprint) | (WorkKind::Sprint, WorkKind::Task)
    );
    if valid {
        Ok(())
    } else {
        Err(DomainError::InvalidParentKind {
            child: child.kind,
            parent: parent.kind,
        })
    }
}

pub fn validate_hierarchy(items: &[WorkItem]) -> Result<(), DomainError> {
    for child in items {
        let parent = child
            .parent_id
            .as_ref()
            .map(|parent_id| items.iter().find(|item| &item.id == parent_id));
        match parent {
            Some(Some(parent)) => validate_parent(child, Some(parent))?,
            Some(None) => {
                return Err(DomainError::MissingParent {
                    child: child.id.clone(),
                })
            }
            None => validate_parent(child, None)?,
        }
    }
    Ok(())
}

pub fn validate_dependencies(
    items: &[WorkItem],
    dependencies: &[BlockingDependency],
) -> Result<(), DomainError> {
    let edges = dependencies
        .iter()
        .cloned()
        .map(|dependency| DependencyEdge::close_only(dependency.blocker_id, dependency.blocked_id))
        .collect::<Vec<_>>();
    validate_dependency_edges(items, &edges)
}

pub fn validate_dependency_edges(
    items: &[WorkItem],
    dependencies: &[DependencyEdge],
) -> Result<(), DomainError> {
    for dependency in dependencies {
        let Some(blocker) = items.iter().find(|item| item.id == dependency.blocker_id) else {
            return Err(DomainError::MissingWork {
                id: dependency.blocker_id.clone(),
            });
        };
        let Some(blocked) = items.iter().find(|item| item.id == dependency.blocked_id) else {
            return Err(DomainError::MissingWork {
                id: dependency.blocked_id.clone(),
            });
        };
        if blocker.project_id != blocked.project_id {
            return Err(DomainError::CrossProjectReference {
                from: blocker.id.clone(),
                to: blocked.id.clone(),
            });
        }
        if blocker.id == blocked.id
            || reaches(dependencies, &blocked.id, &blocker.id, &mut Vec::new())
        {
            return Err(DomainError::DependencyCycle {
                blocker: blocker.id.clone(),
                blocked: blocked.id.clone(),
            });
        }
    }
    Ok(())
}

fn reaches(
    edges: &[DependencyEdge],
    from: &WorkId,
    target: &WorkId,
    visited: &mut Vec<WorkId>,
) -> bool {
    if from == target {
        return true;
    }
    if visited.iter().any(|id| id == from) {
        return false;
    }
    visited.push(from.clone());
    edges
        .iter()
        .filter(|edge| &edge.blocker_id == from)
        .any(|edge| reaches(edges, &edge.blocked_id, target, visited))
}

pub fn dependency_satisfied(policy: DependencyPolicy, blocker: &WorkItem) -> bool {
    match policy {
        DependencyPolicy::ClosedOnly => blocker.lifecycle == PersistedLifecycle::Closed,
    }
}

pub fn validate_fence(expected: Fence, current: Fence) -> Result<(), DomainError> {
    if expected == current {
        Ok(())
    } else {
        Err(DomainError::StaleFence)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DomainError {
    TimestampOverflow,
    FenceOverflow,
    StaleFence,
    LeaseExpired,
    InvalidLeaseRenewal,
    ReviewerCannotReviewOwnAttempt,
    ReceiptSubjectMismatch,
    DerivedStatusReadOnly {
        status: DerivedStatus,
    },
    IllegalLifecycleTransition {
        from: PersistedLifecycle,
        operation: WorkOperation,
    },
    IllegalAttemptTransition {
        from: AttemptPhase,
        operation: AttemptOperation,
    },
    ParentRequired {
        child: WorkId,
        kind: WorkKind,
    },
    MissingParent {
        child: WorkId,
    },
    MissingWork {
        id: WorkId,
    },
    InvalidParentKind {
        child: WorkKind,
        parent: WorkKind,
    },
    CrossProjectReference {
        from: WorkId,
        to: WorkId,
    },
    DependencyCycle {
        blocker: WorkId,
        blocked: WorkId,
    },
}

impl fmt::Display for DomainError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::TimestampOverflow => formatter.write_str("timestamp overflow"),
            Self::FenceOverflow => formatter.write_str("fence overflow"),
            Self::StaleFence => formatter.write_str("stale_fence"),
            Self::LeaseExpired => formatter.write_str("lease_expired"),
            Self::InvalidLeaseRenewal => formatter.write_str("invalid_lease_renewal"),
            Self::ReviewerCannotReviewOwnAttempt => {
                formatter.write_str("reviewer_cannot_review_own_attempt")
            }
            Self::ReceiptSubjectMismatch => formatter.write_str("receipt_subject_mismatch"),
            Self::DerivedStatusReadOnly { .. } => formatter.write_str("derived_status_read_only"),
            Self::IllegalLifecycleTransition { .. } => {
                formatter.write_str("illegal_lifecycle_transition")
            }
            Self::IllegalAttemptTransition { .. } => {
                formatter.write_str("illegal_attempt_transition")
            }
            Self::ParentRequired { .. } => formatter.write_str("parent_required"),
            Self::MissingParent { .. } => formatter.write_str("missing_parent"),
            Self::MissingWork { .. } => formatter.write_str("missing_work"),
            Self::InvalidParentKind { .. } => formatter.write_str("invalid_parent_kind"),
            Self::CrossProjectReference { .. } => formatter.write_str("cross_project_reference"),
            Self::DependencyCycle { .. } => formatter.write_str("dependency_cycle"),
        }
    }
}

impl std::error::Error for DomainError {}

#[cfg(test)]
mod tests {
    use super::*;

    fn id(value: &str) -> WorkId {
        WorkId::new(value)
    }
    fn project(value: &str) -> ProjectId {
        ProjectId::new(value)
    }
    fn actor(value: &str) -> ActorId {
        ActorId::new(value)
    }

    fn task(name: &str, lifecycle: PersistedLifecycle) -> WorkItem {
        let mut item = WorkItem::new(project("p"), id(name), WorkKind::Task, Some(id("s")), name);
        item.lifecycle = lifecycle;
        item
    }

    fn attempt(
        phase: AttemptPhase,
        claimed_at: u64,
        lease_ttl: Option<u64>,
        hard_limit: Option<u64>,
    ) -> Attempt {
        let mut attempt = Attempt::claim(
            id("task"),
            AttemptId::new("attempt"),
            actor("agent"),
            Fence::new(1),
            TimestampMs::from_millis(claimed_at),
            lease_ttl,
            hard_limit,
        )
        .unwrap();
        attempt.phase = phase;
        attempt
    }

    fn decision(
        work: &WorkItem,
        prerequisites: &[WorkItem],
        current: Option<&Attempt>,
        actor_role: ActorRole,
    ) -> StatusDecision {
        let actor = ActorContext {
            actor_id: actor("viewer"),
            role: actor_role,
        };
        evaluate_status(StatusContext::new(
            work,
            prerequisites,
            current,
            &work.acceptance_profile.gates,
            &actor,
            TimestampMs::from_millis(1_000),
            Revision(9),
        ))
    }

    #[test]
    fn typed_ids_have_stable_parse_and_format() {
        let parsed: WorkId = "task-a".parse().unwrap();
        assert_eq!(parsed.as_str(), "task-a");
        assert_eq!(parsed.to_string(), "task-a");
        assert!(WorkId::parse("task a").is_err());
    }

    #[test]
    fn hierarchy_is_project_local_and_kind_safe() {
        let milestone = WorkItem::new(project("p"), id("m"), WorkKind::Milestone, None, "M");
        let sprint = WorkItem::new(project("p"), id("s"), WorkKind::Sprint, Some(id("m")), "S");
        let task = WorkItem::new(project("p"), id("t"), WorkKind::Task, Some(id("s")), "T");
        assert!(validate_hierarchy(&[milestone.clone(), sprint.clone(), task]).is_ok());
        let bad = WorkItem::new(
            project("other"),
            id("t2"),
            WorkKind::Task,
            Some(id("s")),
            "T2",
        );
        assert!(matches!(
            validate_hierarchy(&[milestone, sprint, bad]),
            Err(DomainError::CrossProjectReference { .. })
        ));
    }

    #[test]
    fn dependency_validation_rejects_cycles_and_only_closed_satisfies() {
        let a = task("a", PersistedLifecycle::Open);
        let b = task("b", PersistedLifecycle::Open);
        let c = task("c", PersistedLifecycle::Closed);
        let edge = DependencyEdge::close_only(id("a"), id("b"));
        assert!(
            validate_dependency_edges(&[a.clone(), b.clone()], std::slice::from_ref(&edge)).is_ok()
        );
        assert!(!dependency_satisfied(DependencyPolicy::ClosedOnly, &a));
        assert!(dependency_satisfied(DependencyPolicy::ClosedOnly, &c));
        let cycle = [edge, DependencyEdge::close_only(id("b"), id("a"))];
        assert!(matches!(
            validate_dependency_edges(&[a, b], &cycle),
            Err(DomainError::DependencyCycle { .. })
        ));
    }

    #[test]
    fn queued_and_blocked_preserve_both_reasons() {
        let upstream = task("upstream", PersistedLifecycle::Open);
        let queued = task("queued", PersistedLifecycle::Open);
        let queued_decision = decision(
            &queued,
            std::slice::from_ref(&upstream),
            None,
            ActorRole::Agent,
        );
        assert_eq!(queued_decision.display_status, DerivedStatus::Queued);
        assert!(!queued_decision.claimable_for_actor);
        assert!(queued_decision
            .reason_codes
            .iter()
            .any(|r| r.stable_code() == "prerequisite_open(upstream)"));

        let mut blocked = queued.clone();
        blocked.hard_holds.push(ReasonCode::HardHold(
            "operator_decision_required".to_owned(),
        ));
        let blocked_decision = decision(
            &blocked,
            std::slice::from_ref(&upstream),
            None,
            ActorRole::Agent,
        );
        assert_eq!(blocked_decision.display_status, DerivedStatus::Blocked);
        assert_eq!(blocked_decision.reason_codes.len(), 2);
        assert!(blocked_decision
            .reason_codes
            .iter()
            .any(|reason| reason.stable_code() == "operator_decision_required"));
        assert!(blocked_decision
            .reason_codes
            .iter()
            .any(|reason| reason.stable_code() == "prerequisite_open(upstream)"));
        assert!(!blocked_decision.claimable_for_actor);
    }

    #[test]
    fn rollup_counts_are_exact_and_independent_of_row_limits() {
        let mut first = decision(
            &task("a", PersistedLifecycle::Open),
            &[],
            None,
            ActorRole::Agent,
        );
        first.display_status = DerivedStatus::Ready;
        let mut second = first.clone();
        second.work_id = id("b");
        second.display_status = DerivedStatus::Blocked;
        let mut third = first.clone();
        third.work_id = id("c");
        third.display_status = DerivedStatus::Closed;
        let counts = evaluate_rollup(&[first, second, third]);
        assert_eq!(counts.total, 3);
        assert_eq!(counts.ready, 1);
        assert_eq!(counts.blocked, 1);
        assert_eq!(counts.closed, 1);
    }

    #[test]
    fn claimed_differs_from_in_progress_until_acceptance_and_start() {
        let work = task("task", PersistedLifecycle::Open);
        let claimed = attempt(AttemptPhase::Claimed, 0, None, None);
        assert_eq!(
            decision(&work, &[], Some(&claimed), ActorRole::Agent).display_status,
            DerivedStatus::Claimed
        );
        let mut running = claimed.clone();
        running.accept(TimestampMs::from_millis(1)).unwrap();
        running.start().unwrap();
        assert_eq!(
            decision(&work, &[], Some(&running), ActorRole::Agent).display_status,
            DerivedStatus::InProgress
        );
    }

    #[test]
    fn complete_is_not_closed_and_requires_close_intent() {
        let work = task("task", PersistedLifecycle::Open);
        let current = attempt(AttemptPhase::Verifying, 0, None, None);
        let gates = work
            .acceptance_profile
            .gates
            .iter()
            .cloned()
            .map(GateRequirement::satisfied)
            .collect::<Vec<_>>();
        let actor = ActorContext {
            actor_id: actor("agent"),
            role: ActorRole::Agent,
        };
        let status = evaluate_status(StatusContext {
            work: &work,
            prerequisites: &[],
            current_attempt: Some(&current),
            gates: &gates,
            actor: &actor,
            as_of: TimestampMs(1),
            project_revision: Revision(1),
            retry_not_before: None,
            schedule: None,
            activation_at: None,
            affected_dependents: &[],
        });
        assert_eq!(status.display_status, DerivedStatus::Complete);
        assert!(
            matches!(evaluate_close(&work.acceptance_profile, &gates, None, false, &current, Fence::new(1)), CloseReadiness::NotReady { gaps } if gaps.contains(&CloseGap::CloseIntentMissing))
        );
        assert_eq!(
            transition_lifecycle(PersistedLifecycle::Open, WorkOperation::Close).unwrap(),
            PersistedLifecycle::Closed
        );
    }

    #[test]
    fn cancellation_and_reopen_are_explicit_lifecycle_transitions() {
        assert_eq!(
            transition_lifecycle(PersistedLifecycle::Open, WorkOperation::Cancel).unwrap(),
            PersistedLifecycle::Cancelled
        );
        assert_eq!(
            transition_lifecycle(PersistedLifecycle::Cancelled, WorkOperation::Reopen).unwrap(),
            PersistedLifecycle::Open
        );
        assert!(transition_lifecycle(PersistedLifecycle::Draft, WorkOperation::Close).is_err());
    }

    #[test]
    fn stale_fence_rejects_receipts_and_mutations() {
        assert_eq!(
            validate_fence(Fence::new(1), Fence::new(2)),
            Err(DomainError::StaleFence)
        );
        let receipt = ReceiptIdentity {
            receipt_id: ReceiptId::new("receipt"),
            operation_id: OperationId::new("op"),
            subject: ReceiptSubject {
                work_id: id("task"),
                attempt_id: AttemptId::new("old"),
                fence: Fence::new(1),
                gate_id: GateId::new("verify"),
            },
            source_snapshot: SourceVersionId::new("source"),
            config_identity: ConfigIdentity::new("config"),
            policy_version: "1".to_owned(),
        };
        assert_eq!(
            validate_receipt_subject(&receipt, &id("task"), &AttemptId::new("new"), Fence::new(2)),
            Err(DomainError::StaleFence)
        );
    }

    #[test]
    fn review_gate_is_conditional_and_self_review_is_rejected() {
        let reviewed = AcceptanceProfile::reviewed();
        let gates = reviewed
            .gates
            .iter()
            .cloned()
            .map(|gate| {
                if gate.kind == GateKind::Review {
                    gate
                } else {
                    gate.satisfied()
                }
            })
            .collect::<Vec<_>>();
        let current = attempt(AttemptPhase::Verifying, 0, None, None);
        let no_review = evaluate_close(&reviewed, &gates, None, true, &current, Fence::new(1));
        assert!(
            matches!(no_review, CloseReadiness::NotReady { gaps } if gaps.contains(&CloseGap::ReviewRequired))
        );
        let independent = ReviewRecord {
            reviewer_actor_id: actor("reviewer"),
            attempt_actor_id: actor("agent"),
            accepted: true,
        };
        assert_eq!(
            evaluate_close(
                &reviewed,
                &gates,
                Some(&independent),
                true,
                &current,
                Fence::new(1)
            ),
            CloseReadiness::ReadyToClose
        );
        let self_review = ReviewRecord {
            reviewer_actor_id: actor("agent"),
            attempt_actor_id: actor("agent"),
            accepted: true,
        };
        assert_eq!(
            validate_independent_review(&self_review),
            Err(DomainError::ReviewerCannotReviewOwnAttempt)
        );
    }

    #[test]
    fn review_free_profile_closes_with_valid_proof_and_intent() {
        let profile = AcceptanceProfile::focused();
        let gates = profile
            .gates
            .iter()
            .cloned()
            .map(GateRequirement::satisfied)
            .collect::<Vec<_>>();
        let current = attempt(AttemptPhase::Verifying, 0, None, None);
        assert_eq!(
            evaluate_close(&profile, &gates, None, true, &current, Fence::new(1)),
            CloseReadiness::ReadyToClose
        );
    }

    #[test]
    fn default_hard_deadline_is_two_hours_and_lease_is_renewable_separately() {
        let mut current = attempt(AttemptPhase::Running, 10_000, Some(30_000), None);
        assert_eq!(current.lease_deadline, TimestampMs(40_000));
        assert_eq!(
            current.max_attempt_deadline,
            TimestampMs(10_000 + DEFAULT_HARD_TIME_LIMIT_MS)
        );
        let before = current.max_attempt_deadline;
        current.heartbeat(TimestampMs(20_000)).unwrap();
        current.renew_lease(TimestampMs(20_000), 30_000).unwrap();
        assert_eq!(current.max_attempt_deadline, before);
        assert_eq!(current.lease_deadline, TimestampMs(50_000));
        assert_eq!(
            current.expiry_reason(TimestampMs(50_000)),
            Some(ExpiryReason::LeaseElapsed)
        );
        assert_eq!(
            current.expiry_reason(TimestampMs(10_000 + DEFAULT_HARD_TIME_LIMIT_MS)),
            Some(ExpiryReason::HardBudgetElapsed)
        );
    }

    #[test]
    fn explicit_hard_deadline_overrides_two_hour_default() {
        let current = attempt(
            AttemptPhase::Running,
            0,
            Some(3 * 60 * 60 * 1_000),
            Some(20 * 60 * 1_000),
        );
        assert_eq!(current.deadline_source, DeadlineSource::Explicit);
        assert_eq!(current.max_attempt_deadline, TimestampMs(20 * 60 * 1_000));
        assert_eq!(
            current.expiry_reason(TimestampMs(20 * 60 * 1_000)),
            Some(ExpiryReason::HardBudgetElapsed)
        );
    }

    #[test]
    fn deadline_equality_is_expired_and_backward_clock_does_not_resurrect_fence() {
        let mut current = attempt(AttemptPhase::Running, 100, Some(50), Some(100));
        assert_eq!(
            current.expiry_reason(TimestampMs(200)),
            Some(ExpiryReason::HardBudgetElapsed)
        );
        transition_attempt(&mut current, AttemptOperation::ExpiryPending).unwrap();
        transition_attempt(&mut current, AttemptOperation::Expire).unwrap();
        assert_eq!(current.phase, AttemptPhase::Expired);
        assert_eq!(current.expiry_reason(TimestampMs(101)), None);
        assert_eq!(
            validate_fence(Fence::new(1), Fence::new(2)),
            Err(DomainError::StaleFence)
        );
    }

    #[test]
    fn illegal_direct_derived_status_write_is_typed() {
        assert!(matches!(
            reject_derived_status_write(DerivedStatus::Closed),
            Err(DomainError::DerivedStatusReadOnly {
                status: DerivedStatus::Closed
            })
        ));
    }
}

pub mod maintenance;
