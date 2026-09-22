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
use boreal_store::{
    identity::{IdentityContext, IdentityStore},
    recovery::{
        IdentityBoundRecoveryResolutionInput, RecoveryObligationRecord, RecoveryResolutionInput,
        ResourceReservationRecord,
    },
    SqliteStore, StoreError,
};

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

/// Durable recovery is deliberately a readback state machine. An unresolved
/// obligation is never reported as a successful release or expiry.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AttemptRecoveryResolution {
    Pending(RecoveryObligationRecord),
    ReadbackRequired(RecoveryObligationRecord),
    Reconciled(RecoveryObligationRecord),
    Rejected(RecoveryObligationRecord),
}

impl AttemptRecoveryResolution {
    pub fn record(&self) -> &RecoveryObligationRecord {
        match self {
            Self::Pending(record)
            | Self::ReadbackRequired(record)
            | Self::Reconciled(record)
            | Self::Rejected(record) => record,
        }
    }

    pub const fn is_resolved(&self) -> bool {
        matches!(self, Self::Reconciled(_))
    }

    pub const fn is_readback_required(&self) -> bool {
        matches!(self, Self::ReadbackRequired(_))
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RecoveryResolveRequest {
    pub project_id: String,
    pub obligation_id: String,
    pub operation_id: String,
    pub request_digest: String,
    pub resolution_id: String,
    pub actor_id: String,
    pub outcome: String,
    pub reason: String,
    pub resource_state: String,
    pub at: String,
    pub expected_project_revision: Option<u64>,
    pub session_id: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResourceReleaseRequest {
    pub project_id: String,
    pub reservation_id: String,
    pub event_id: String,
    pub actor_id: String,
    pub evidence_ref: String,
    pub at: String,
}

/// Store-backed adapter for expiry, stop, and resource recovery. The
/// identity-bound constructor is the production path; the unbound constructor
/// remains useful for isolated schema fixtures and intentionally cannot repair
/// a project identity boundary.
pub struct AttemptRecoveryAdapter<'a> {
    store: &'a SqliteStore,
    identity: Option<&'a IdentityContext>,
}

impl<'a> AttemptRecoveryAdapter<'a> {
    pub const fn new(store: &'a SqliteStore) -> Self {
        Self {
            store,
            identity: None,
        }
    }

    pub const fn new_with_identity(store: &'a SqliteStore, identity: &'a IdentityContext) -> Self {
        Self {
            store,
            identity: Some(identity),
        }
    }

    pub fn readback(
        &self,
        project_id: &str,
        obligation_id: &str,
    ) -> Result<AttemptRecoveryResolution, StoreError> {
        self.validate_project(project_id)?;
        let record = self
            .store
            .recovery_obligation(project_id, obligation_id)?
            .ok_or_else(|| StoreError::NotFound {
                entity: "recovery_obligation",
                id: obligation_id.to_owned(),
            })?;
        Ok(recovery_resolution(record))
    }

    pub fn resolve(
        &self,
        request: &RecoveryResolveRequest,
    ) -> Result<AttemptRecoveryResolution, StoreError> {
        self.validate_project(&request.project_id)?;
        if self.identity.is_none() && request.resource_state == "released" {
            return Err(StoreError::Conflict(
                "released recovery resolution requires an authenticated identity-bound resource acknowledgement"
                    .to_owned(),
            ));
        }
        let input = RecoveryResolutionInput {
            project_id: request.project_id.clone(),
            obligation_id: request.obligation_id.clone(),
            resolution_id: request.resolution_id.clone(),
            actor_id: request.actor_id.clone(),
            outcome: request.outcome.clone(),
            reason: request.reason.clone(),
            resource_state: request.resource_state.clone(),
            at: request.at.clone(),
        };
        let record = if let Some(identity) = self.identity {
            let result = self.store.resolve_recovery_obligation_with_identity(
                &IdentityBoundRecoveryResolutionInput {
                    context: identity.clone(),
                    operation_id: request.operation_id.clone(),
                    request_digest: request.request_digest.clone(),
                    expected_project_revision: request.expected_project_revision,
                    session_id: request.session_id.clone(),
                    resolution: input,
                },
            )?;
            result.obligation
        } else {
            self.store.resolve_recovery_obligation(&input)?
        };
        Ok(recovery_resolution(record))
    }

    pub fn request_resource_release(
        &self,
        request: &ResourceReleaseRequest,
    ) -> Result<ResourceReservationRecord, StoreError> {
        self.validate_project(&request.project_id)?;
        self.store.request_resource_release(
            &request.project_id,
            &request.reservation_id,
            &request.event_id,
            &request.actor_id,
            &request.evidence_ref,
            &request.at,
        )
    }

    pub fn acknowledge_resource_release(
        &self,
        request: &ResourceReleaseRequest,
    ) -> Result<ResourceReservationRecord, StoreError> {
        self.validate_project(&request.project_id)?;
        self.store.acknowledge_resource_release(
            &request.project_id,
            &request.reservation_id,
            &request.event_id,
            &request.actor_id,
            &request.evidence_ref,
            &request.at,
        )
    }

    fn validate_project(&self, project_id: &str) -> Result<(), StoreError> {
        if project_id.trim().is_empty() {
            return Err(StoreError::Invalid(
                "recovery project id must not be empty".to_owned(),
            ));
        }
        if let Some(identity) = self.identity {
            let current = IdentityStore::new(self.store)
                .context(&identity.project_id)
                .map_err(|error| StoreError::Conflict(format!("recovery identity: {error}")))?;
            if current != *identity {
                return Err(StoreError::Conflict(
                    "recovery identity context is stale".to_owned(),
                ));
            }
            if identity.project_id != project_id {
                return Err(StoreError::WrongSubject {
                    expected: identity.project_id.clone(),
                    actual: project_id.to_owned(),
                });
            }
        }
        Ok(())
    }
}

pub fn recovery_obligation_id(operation_id: &str, kind: AttemptCommandKind) -> Option<String> {
    let reason = match kind {
        AttemptCommandKind::Expire { .. } => "expired",
        AttemptCommandKind::Fail => "failed",
        AttemptCommandKind::Release => "resource_unknown",
        AttemptCommandKind::Cancel { .. } => "cancel_requested",
        AttemptCommandKind::Accept
        | AttemptCommandKind::Start
        | AttemptCommandKind::Heartbeat
        | AttemptCommandKind::RenewLease { .. }
        | AttemptCommandKind::Submit => return None,
    };
    Some(format!(
        "{}:recovery:{}",
        operation_id,
        reason.replace('_', "-")
    ))
}

fn recovery_resolution(record: RecoveryObligationRecord) -> AttemptRecoveryResolution {
    match record.state.as_str() {
        "resolved" => AttemptRecoveryResolution::Reconciled(record),
        "superseded" => AttemptRecoveryResolution::Rejected(record),
        _ if record.resource_state == "unknown" || record.resource_state == "release_pending" => {
            AttemptRecoveryResolution::ReadbackRequired(record)
        }
        _ => AttemptRecoveryResolution::Pending(record),
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

    /// Read the recovery obligation created by the canonical store for a
    /// terminal attempt. This is deliberately a separate readback API: a
    /// terminal lifecycle mutation is not evidence that its process or
    /// resources are safe to reuse.
    pub fn attempt_recovery_readback(
        &self,
        project_id: &ProjectId,
        operation_id: &OperationId,
        kind: AttemptCommandKind,
    ) -> Result<AttemptRecoveryResolution, ApplicationError> {
        let obligation_id =
            recovery_obligation_id(operation_id.as_str(), kind).ok_or_else(|| {
                ApplicationError::Invalid("attempt command has no recovery obligation".to_owned())
            })?;
        AttemptRecoveryAdapter::new(self.store)
            .readback(project_id.as_str(), &obligation_id)
            .map_err(ApplicationError::from)
    }

    /// Resolve a terminal-attempt recovery obligation through the production
    /// identity boundary. The adapter's identity-bound store path keeps the
    /// operation, request digest, project lineage, recovery fence, audit
    /// event, and resource acknowledgement in the same authoritative flow.
    ///
    /// The identity-bound store envelope is the public input boundary.
    /// Callers must not fall back to the legacy project-id-only store
    /// resolution for `released` outcomes.
    pub fn resolve_attempt_recovery_with_identity(
        &self,
        input: &IdentityBoundRecoveryResolutionInput,
    ) -> Result<RecoveryObligationRecord, ApplicationError> {
        let request = RecoveryResolveRequest {
            project_id: input.resolution.project_id.clone(),
            obligation_id: input.resolution.obligation_id.clone(),
            operation_id: input.operation_id.clone(),
            request_digest: input.request_digest.clone(),
            resolution_id: input.resolution.resolution_id.clone(),
            actor_id: input.resolution.actor_id.clone(),
            outcome: input.resolution.outcome.clone(),
            reason: input.resolution.reason.clone(),
            resource_state: input.resolution.resource_state.clone(),
            at: input.resolution.at.clone(),
            expected_project_revision: input.expected_project_revision,
            session_id: input.session_id.clone(),
        };
        AttemptRecoveryAdapter::new_with_identity(self.store, &input.context)
            .resolve(&request)
            .map(|resolution| resolution.record().clone())
            .map_err(ApplicationError::from)
    }

    /// Request physical resource release while retaining the project/database
    /// identity check. A request only moves a canonical reservation to
    /// `release_pending`; it never makes the resource reusable by itself.
    #[allow(clippy::too_many_arguments)]
    pub fn request_resource_release_with_identity(
        &self,
        identity: &IdentityContext,
        project_id: &str,
        reservation_id: &str,
        event_id: &str,
        actor_id: &str,
        evidence_ref: &str,
        at: &str,
    ) -> Result<ResourceReservationRecord, ApplicationError> {
        let request = ResourceReleaseRequest {
            project_id: project_id.to_owned(),
            reservation_id: reservation_id.to_owned(),
            event_id: event_id.to_owned(),
            actor_id: actor_id.to_owned(),
            evidence_ref: evidence_ref.to_owned(),
            at: at.to_owned(),
        };
        AttemptRecoveryAdapter::new_with_identity(self.store, identity)
            .request_resource_release(&request)
            .map_err(ApplicationError::from)
    }

    /// Acknowledge the exact pending release through the identity-bound
    /// adapter. The store verifies the reservation subject, pending event,
    /// evidence, and idempotent acknowledgement before making it reusable.
    #[allow(clippy::too_many_arguments)]
    pub fn acknowledge_resource_release_with_identity(
        &self,
        identity: &IdentityContext,
        project_id: &str,
        reservation_id: &str,
        event_id: &str,
        actor_id: &str,
        evidence_ref: &str,
        at: &str,
    ) -> Result<ResourceReservationRecord, ApplicationError> {
        let request = ResourceReleaseRequest {
            project_id: project_id.to_owned(),
            reservation_id: reservation_id.to_owned(),
            event_id: event_id.to_owned(),
            actor_id: actor_id.to_owned(),
            evidence_ref: evidence_ref.to_owned(),
            at: at.to_owned(),
        };
        AttemptRecoveryAdapter::new_with_identity(self.store, identity)
            .acknowledge_resource_release(&request)
            .map_err(ApplicationError::from)
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
            Ok(result) => {
                if recovery_obligation_id(request.operation_id.as_str(), kind).is_some() {
                    self.request_terminal_resource_readback(&request, kind)?;
                }
                Ok(operation_result(result))
            }
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

    fn request_terminal_resource_readback(
        &self,
        request: &AttemptRequest,
        kind: AttemptCommandKind,
    ) -> Result<(), ApplicationError> {
        let Some(obligation_id) = recovery_obligation_id(request.operation_id.as_str(), kind)
        else {
            return Ok(());
        };
        if self
            .store
            .recovery_obligation(request.project_id.as_str(), &obligation_id)?
            .is_none()
        {
            // Non-store test adapters may implement the lifecycle contract
            // without a durable recovery sidecar. Do not synthesize one here;
            // the canonical adapter/store integration remains the authority.
            return Ok(());
        }

        let resources = self
            .store
            .list_live_resources(request.project_id.as_str(), None, 500)?;
        for resource in resources.into_iter().filter(|resource| {
            resource.attempt_id == request.attempt_id.as_str()
                && resource.fence == request.fence.get()
                && matches!(resource.state.as_str(), "active" | "unknown")
        }) {
            let release_request = ResourceReleaseRequest {
                project_id: request.project_id.as_str().to_owned(),
                reservation_id: resource.reservation_id.clone(),
                event_id: format!(
                    "{}:resource-release-request:{}",
                    request.operation_id, resource.reservation_id
                ),
                actor_id: request.actor_id.as_str().to_owned(),
                // This is the durable request identity, not a claim that the
                // physical resource has already been released.
                evidence_ref: request.operation_id.as_str().to_owned(),
                at: format!("unix-ms:{}", request.at.as_millis()),
            };
            AttemptRecoveryAdapter::new(self.store)
                .request_resource_release(&release_request)
                .map_err(|error| {
                    ApplicationError::AttemptAdapter(AttemptAdapterError::UnknownOutcome(
                        format!(
                            "attempt mutation committed but resource release request readback is unknown: {error}"
                        ),
                    ))
                })?;
        }
        Ok(())
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
    use boreal_domain::{
        AcceptanceProfile, AttemptPhase, DispatchPolicy, Fence, PersistedLifecycle, WorkItem,
        WorkKind,
    };
    use boreal_store::{
        identity::{DatabaseIdentity, IdentityStore, WorkspaceBinding},
        recovery::RecoveryObligationInput,
        SqliteStore,
    };
    use std::cell::RefCell;

    const PRODUCTION_SCHEMA: &str = include_str!("../../../project/spec/schema-production.sql");

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

    fn recovery_record(state: &str, resource_state: &str) -> RecoveryObligationRecord {
        RecoveryObligationRecord {
            obligation_id: "op-expire:recovery:expired".to_owned(),
            project_id: "p1".to_owned(),
            work_id: "w1".to_owned(),
            attempt_id: Some("a1".to_owned()),
            fence: Some(7),
            reason: "expired".to_owned(),
            state: state.to_owned(),
            resource_state: resource_state.to_owned(),
            owner_actor_id: Some("agent-1".to_owned()),
            next_action: "read back stopped runtime".to_owned(),
            created_at: "unix-ms:20".to_owned(),
            resolved_at: (state == "resolved").then(|| "unix-ms:21".to_owned()),
            resolved_by: (state == "resolved").then(|| "agent-1".to_owned()),
            resolution_id: (state == "resolved").then(|| "resolution-1".to_owned()),
        }
    }

    #[test]
    fn recovery_mapping_keeps_expiry_and_resource_disposition_unresolved() {
        assert_eq!(
            recovery_obligation_id(
                "op-expire",
                AttemptCommandKind::Expire {
                    confirmation: StopConfirmation::AdapterAcknowledged,
                }
            ),
            Some("op-expire:recovery:expired".to_owned())
        );
        assert_eq!(
            recovery_obligation_id("op-release", AttemptCommandKind::Release),
            Some("op-release:recovery:resource-unknown".to_owned())
        );
        assert_eq!(
            recovery_obligation_id("op-submit", AttemptCommandKind::Submit),
            None
        );

        let unresolved = recovery_resolution(recovery_record("unresolved", "unknown"));
        assert!(unresolved.is_readback_required());
        assert!(!unresolved.is_resolved());

        let resolved = recovery_resolution(recovery_record("resolved", "released"));
        assert!(resolved.is_resolved());
        assert!(!resolved.is_readback_required());

        let superseded = recovery_resolution(recovery_record("superseded", "unknown"));
        assert!(!superseded.is_resolved());
        assert!(!superseded.is_readback_required());
    }

    fn test_identity(store: &SqliteStore, project_id: &str) -> IdentityContext {
        IdentityStore::new(store)
            .install(
                &DatabaseIdentity::new("runtime-test-database", 1)
                    .expect("database identity is valid"),
                "unix-ms:1",
            )
            .expect("database identity installs");
        IdentityStore::new(store)
            .bind_project(
                project_id,
                &WorkspaceBinding::new(
                    "/tmp/boreal-runtime-test",
                    "/tmp/boreal-runtime-test",
                    "sha256:runtime-test-binding",
                )
                .expect("workspace binding is valid"),
                "unix-ms:2",
            )
            .expect("project identity binds")
    }

    #[test]
    fn identity_bound_recovery_entry_point_replays_and_rejects_unbound_release() {
        let store = SqliteStore::open_in_memory(PRODUCTION_SCHEMA).expect("production schema");
        let project = ProjectId::new("runtime-recovery-project");
        store
            .create_project(project.as_str(), "unix-ms:1")
            .expect("project creates");
        store
            .ensure_actor(
                "runtime-actor",
                "agent",
                "credential-runtime",
                "Runtime actor",
                "unix-ms:1",
            )
            .expect("actor creates");
        let identity = test_identity(&store, project.as_str());
        let app = WorkApplication::new(&store);
        app.create_work_as(
            &WorkItem {
                id: WorkId::new("runtime-recovery-work"),
                project_id: project.clone(),
                kind: WorkKind::Task,
                parent_id: None,
                title: "runtime recovery work".to_owned(),
                description: String::new(),
                lifecycle: PersistedLifecycle::Open,
                priority: 0,
                dispatch_policy: DispatchPolicy::Automatic,
                hard_holds: Vec::new(),
                acceptance_profile: AcceptanceProfile::focused(),
            },
            "runtime-actor",
            "unix-ms:3",
            "op-runtime-recovery-work",
        )
        .expect("work creates");
        store
            .create_recovery_obligation(&RecoveryObligationInput {
                obligation_id: "op-runtime-recovery:recovery:expired".to_owned(),
                project_id: project.as_str().to_owned(),
                work_id: "runtime-recovery-work".to_owned(),
                attempt_id: None,
                fence: None,
                reason: "expired".to_owned(),
                resource_state: "unknown".to_owned(),
                owner_actor_id: Some("runtime-actor".to_owned()),
                next_action: "read back the stopped runtime".to_owned(),
                created_at: "unix-ms:4".to_owned(),
            })
            .expect("recovery obligation creates");

        let request = RecoveryResolveRequest {
            project_id: project.as_str().to_owned(),
            obligation_id: "op-runtime-recovery:recovery:expired".to_owned(),
            operation_id: "op-runtime-recovery-resolve".to_owned(),
            request_digest: "sha256:op-runtime-recovery-resolve".to_owned(),
            resolution_id: "runtime-recovery-resolution".to_owned(),
            actor_id: "runtime-actor".to_owned(),
            outcome: "runtime_stopped".to_owned(),
            reason: "the expired runtime was observed stopped".to_owned(),
            resource_state: "unknown".to_owned(),
            at: "unix-ms:5".to_owned(),
            expected_project_revision: None,
            session_id: None,
        };
        let input = IdentityBoundRecoveryResolutionInput {
            context: identity.clone(),
            operation_id: request.operation_id.clone(),
            request_digest: request.request_digest.clone(),
            expected_project_revision: request.expected_project_revision,
            session_id: request.session_id.clone(),
            resolution: RecoveryResolutionInput {
                project_id: request.project_id.clone(),
                obligation_id: request.obligation_id.clone(),
                resolution_id: request.resolution_id.clone(),
                actor_id: request.actor_id.clone(),
                outcome: request.outcome.clone(),
                reason: request.reason.clone(),
                resource_state: request.resource_state.clone(),
                at: request.at.clone(),
            },
        };
        let resolved = app
            .resolve_attempt_recovery_with_identity(&input)
            .expect("identity-bound recovery resolves");
        assert_eq!(resolved.state, "resolved");
        let replay = app
            .resolve_attempt_recovery_with_identity(&input)
            .expect("same recovery operation replays");
        assert_eq!(
            replay.resolution_id.as_deref(),
            Some("runtime-recovery-resolution")
        );

        let mut released = request.clone();
        released.resource_state = "released".to_owned();
        let unbound = AttemptRecoveryAdapter::new(&store).resolve(&released);
        assert!(matches!(
            unbound,
            Err(StoreError::Conflict(message)) if message.contains("authenticated identity-bound")
        ));

        let mut foreign = input;
        foreign.resolution.project_id = "foreign-project".to_owned();
        let foreign_result = app.resolve_attempt_recovery_with_identity(&foreign);
        assert!(matches!(
            foreign_result,
            Err(ApplicationError::Store(StoreError::WrongSubject { .. }))
        ));
    }

    #[test]
    fn identity_bound_resource_acknowledgement_is_idempotent_and_project_scoped() {
        let store = SqliteStore::open_in_memory(PRODUCTION_SCHEMA).expect("production schema");
        let app = WorkApplication::new(&store);
        let project = ProjectId::new("runtime-resource-project");
        store
            .create_project(project.as_str(), "unix-ms:1")
            .expect("project creates");
        store
            .ensure_actor(
                "runtime-owner",
                "agent",
                "credential-owner",
                "Runtime owner",
                "unix-ms:1",
            )
            .expect("actor creates");
        let identity = test_identity(&store, project.as_str());
        app.create_work_as(
            &WorkItem {
                id: WorkId::new("runtime-resource-work"),
                project_id: project.clone(),
                kind: WorkKind::Task,
                parent_id: None,
                title: "runtime resource work".to_owned(),
                description: String::new(),
                lifecycle: PersistedLifecycle::Open,
                priority: 0,
                dispatch_policy: DispatchPolicy::Automatic,
                hard_holds: Vec::new(),
                acceptance_profile: AcceptanceProfile::focused(),
            },
            "runtime-owner",
            "unix-ms:2",
            "op-runtime-resource-work",
        )
        .expect("work creates");
        app.claim(
            &project,
            "runtime-resource-work",
            "runtime-owner",
            "runtime-harness",
            None,
            "runtime-resource-attempt",
            "op-runtime-resource-claim",
            "sha256:op-runtime-resource-claim",
            None,
            "unix-ms:1000",
            "unix-ms:1100",
            "unix-ms:1200",
        )
        .expect("attempt claims");

        let release_request = ResourceReleaseRequest {
            project_id: project.as_str().to_owned(),
            reservation_id: "resource:runtime-resource-attempt".to_owned(),
            event_id: "runtime-resource-release-request".to_owned(),
            actor_id: "runtime-owner".to_owned(),
            evidence_ref: "runtime-stop-evidence".to_owned(),
            at: "unix-ms:4".to_owned(),
        };
        let pending = app
            .request_resource_release_with_identity(
                &identity,
                &release_request.project_id,
                &release_request.reservation_id,
                &release_request.event_id,
                &release_request.actor_id,
                &release_request.evidence_ref,
                &release_request.at,
            )
            .expect("identity-bound release request records pending state");
        assert_eq!(pending.state, "release_pending");

        let acknowledgement = ResourceReleaseRequest {
            event_id: "runtime-resource-release-ack".to_owned(),
            ..release_request.clone()
        };
        let released = app
            .acknowledge_resource_release_with_identity(
                &identity,
                &acknowledgement.project_id,
                &acknowledgement.reservation_id,
                &acknowledgement.event_id,
                &acknowledgement.actor_id,
                &acknowledgement.evidence_ref,
                &acknowledgement.at,
            )
            .expect("identity-bound release acknowledgement commits");
        assert_eq!(released.state, "released");
        let replay = app
            .acknowledge_resource_release_with_identity(
                &identity,
                &acknowledgement.project_id,
                &acknowledgement.reservation_id,
                &acknowledgement.event_id,
                &acknowledgement.actor_id,
                &acknowledgement.evidence_ref,
                &acknowledgement.at,
            )
            .expect("same acknowledgement replays idempotently");
        assert_eq!(
            replay.release_ack_id.as_deref(),
            Some("runtime-resource-release-ack")
        );

        let mut foreign = acknowledgement;
        foreign.project_id = "foreign-project".to_owned();
        let foreign_result = app.acknowledge_resource_release_with_identity(
            &identity,
            &foreign.project_id,
            &foreign.reservation_id,
            &foreign.event_id,
            &foreign.actor_id,
            &foreign.evidence_ref,
            &foreign.at,
        );
        assert!(matches!(
            foreign_result,
            Err(ApplicationError::Store(StoreError::WrongSubject { .. }))
        ));
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
