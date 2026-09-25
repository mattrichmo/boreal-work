//! Canonical, transport-free inputs for the production decision model.
//!
//! This module deliberately stops at the domain boundary.  It does not load
//! rows, inspect a service, execute a verifier, or serialize a response.  An
//! application/store adapter supplies these values and consumes the
//! diagnostics without converting an unknown fact into a safe-looking
//! default.

use std::collections::BTreeSet;
use std::fmt;

use crate::work_model_v3::WorkSchedule;
use crate::{
    ActorId, ActorRole, AttemptId, AttemptPhase, ConfigIdentity, DependencyPolicy, DispatchPolicy,
    GateId, GateKind, GateState, PersistedLifecycle, ProfileId, ProjectId, Revision, SessionId,
    SourceVersionId, TimestampMs, WorkId,
};

macro_rules! string_id {
    ($name:ident) => {
        #[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
        pub struct $name(String);

        impl $name {
            pub fn new(value: impl Into<String>) -> Self {
                Self(value.into())
            }

            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl From<&str> for $name {
            fn from(value: &str) -> Self {
                Self::new(value)
            }
        }

        impl From<String> for $name {
            fn from(value: String) -> Self {
                Self::new(value)
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str(self.as_str())
            }
        }
    };
}

macro_rules! revision_type {
    ($name:ident) => {
        #[derive(Clone, Copy, Debug, Default, Eq, Hash, Ord, PartialEq, PartialOrd)]
        pub struct $name(u64);

        impl $name {
            pub const fn new(value: u64) -> Self {
                Self(value)
            }

            pub const fn get(self) -> u64 {
                self.0
            }

            pub const fn checked_next(self) -> Option<Self> {
                match self.0.checked_add(1) {
                    Some(value) => Some(Self(value)),
                    None => None,
                }
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                self.0.fmt(formatter)
            }
        }
    };
}

// Revision of the canonical work entity used for optimistic edits.
revision_type!(EntityRevision);
// Revision of proof-relevant inputs such as requirements, source, and policy.
revision_type!(ProofRevision);
// Monotonic write fence for one execution attempt.
revision_type!(AttemptFence);

string_id!(DependencyId);
string_id!(HoldId);
string_id!(RequirementId);
string_id!(SubmissionId);
string_id!(ReviewId);
string_id!(RecoveryId);
string_id!(DelegationId);
string_id!(DecisionId);
string_id!(ContentDigest);
string_id!(HoldCode);
string_id!(VerifierPolicyId);

/// The identity of one mutable work entity.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct EntityIdentity {
    pub project_id: ProjectId,
    pub work_id: WorkId,
    pub revision: EntityRevision,
}

impl EntityIdentity {
    pub fn new(project_id: ProjectId, work_id: WorkId, revision: EntityRevision) -> Self {
        Self {
            project_id,
            work_id,
            revision,
        }
    }
}

/// Execution identity is intentionally not interchangeable with any revision.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct AttemptIdentity {
    pub attempt_id: AttemptId,
    pub fence: AttemptFence,
}

impl AttemptIdentity {
    pub fn new(attempt_id: AttemptId, fence: AttemptFence) -> Self {
        Self { attempt_id, fence }
    }
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct ProfileIdentity {
    pub profile_id: ProfileId,
    pub version: String,
    pub digest: ContentDigest,
}

impl ProfileIdentity {
    pub fn new(profile_id: ProfileId, version: impl Into<String>, digest: ContentDigest) -> Self {
        Self {
            profile_id,
            version: version.into(),
            digest,
        }
    }
}

/// All proof-bearing records use this exact subject and policy context.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct ProofIdentity {
    pub entity: EntityIdentity,
    pub proof_revision: ProofRevision,
    pub attempt: Option<AttemptIdentity>,
    /// Unbound only on pre-execution requirements. Evidence, submissions and
    /// reviews always require both identities; absence is never a proof.
    pub source_snapshot: Option<SourceVersionId>,
    pub configuration: Option<ConfigIdentity>,
    pub profile: ProfileIdentity,
    pub policy_version: String,
}

impl ProofIdentity {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        entity: EntityIdentity,
        proof_revision: ProofRevision,
        attempt: Option<AttemptIdentity>,
        source_snapshot: SourceVersionId,
        configuration: ConfigIdentity,
        profile: ProfileIdentity,
        policy_version: impl Into<String>,
    ) -> Self {
        Self {
            entity,
            proof_revision,
            attempt,
            source_snapshot: Some(source_snapshot),
            configuration: Some(configuration),
            profile,
            policy_version: policy_version.into(),
        }
    }
}

impl ProofIdentity {
    /// A pinned requirement generation is real before execution has selected
    /// its source/configuration. This constructor cannot produce evidence.
    pub fn planning(
        entity: EntityIdentity,
        proof_revision: ProofRevision,
        profile: ProfileIdentity,
        policy_version: impl Into<String>,
    ) -> Self {
        Self {
            entity,
            proof_revision,
            attempt: None,
            source_snapshot: None,
            configuration: None,
            profile,
            policy_version: policy_version.into(),
        }
    }

    pub fn is_bound(&self) -> bool {
        self.source_snapshot
            .as_ref()
            .is_some_and(|id| !id.as_str().is_empty())
            && self
                .configuration
                .as_ref()
                .is_some_and(|id| !id.as_str().is_empty())
    }
}

/// Values supplied by the application rather than read from a process-global clock.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct EvaluationClock {
    pub evaluated_at: TimestampMs,
    pub next_change_at: Option<TimestampMs>,
    /// Availability constraints read from the same canonical snapshot.
    pub timing: StatusTimingInput,
}

impl EvaluationClock {
    pub const fn at(evaluated_at: TimestampMs) -> Self {
        Self {
            evaluated_at,
            next_change_at: None,
            timing: StatusTimingInput::empty(),
        }
    }

    pub const fn with_next_change_at(mut self, next_change_at: TimestampMs) -> Self {
        self.next_change_at = Some(next_change_at);
        self
    }

    pub const fn with_status_timing(mut self, timing: StatusTimingInput) -> Self {
        self.timing = timing;
        self
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum FactKind {
    Lifecycle,
    ActorAuthority,
    PinnedRequirements,
    DependencyOutcomes,
    Holds,
    Execution,
    Submission,
    Review,
    Recovery,
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum FactTarget {
    Work,
    Actor(ActorId),
    Requirements,
    Dependencies,
    Holds,
    Attempt(AttemptId),
    Submission(SubmissionId),
    Review(ReviewId),
    Recovery(RecoveryId),
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct FactSubject {
    pub project_id: ProjectId,
    pub work_id: WorkId,
    pub target: FactTarget,
}

impl FactSubject {
    pub fn work(project_id: ProjectId, work_id: WorkId) -> Self {
        Self {
            project_id,
            work_id,
            target: FactTarget::Work,
        }
    }

    pub fn target(project_id: ProjectId, work_id: WorkId, target: FactTarget) -> Self {
        Self {
            project_id,
            work_id,
            target,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AbsenceAllowance {
    Required,
    Allowed,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AbsentDiagnostic {
    pub fact: FactKind,
    pub subject: FactSubject,
    pub allowance: AbsenceAllowance,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum UnreadableReason {
    Corrupt,
    UnsupportedVersion,
    MissingReference,
    PermissionDenied,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UnreadableDiagnostic {
    pub fact: FactKind,
    pub subject: FactSubject,
    pub reason: UnreadableReason,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StaleDiagnostic {
    pub fact: FactKind,
    pub subject: FactSubject,
    pub expected: RevisionMarker,
    pub observed: RevisionMarker,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FailureReason {
    EvaluationFailed,
    ExternalCheckFailed,
    InvalidInput,
    UnknownOutcome,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FailedDiagnostic {
    pub fact: FactKind,
    pub subject: FactSubject,
    pub reason: FailureReason,
}

/// The revision marker is tagged so stale proof and stale ownership cannot be
/// flattened into an untyped integer comparison.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RevisionMarker {
    Snapshot(Revision),
    Entity(EntityRevision),
    Proof(ProofRevision),
    Fence(AttemptFence),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum FactDiagnostic {
    Absent(AbsentDiagnostic),
    Unreadable(UnreadableDiagnostic),
    Stale(StaleDiagnostic),
    Failed(FailedDiagnostic),
}

/// A canonical fact is either present or explicitly classified as unavailable.
/// No state is represented by `None`, `false`, or an inferred default.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Fact<T> {
    Present(T),
    Absent { diagnostic: AbsentDiagnostic },
    Unreadable { diagnostic: UnreadableDiagnostic },
    Stale { diagnostic: StaleDiagnostic },
    Failed { diagnostic: FailedDiagnostic },
}

impl<T> Fact<T> {
    pub fn present(value: T) -> Self {
        Self::Present(value)
    }

    pub fn absent(fact: FactKind, subject: FactSubject) -> Self {
        Self::Absent {
            diagnostic: AbsentDiagnostic {
                fact,
                subject,
                allowance: AbsenceAllowance::Required,
            },
        }
    }

    pub fn optional_absent(fact: FactKind, subject: FactSubject) -> Self {
        Self::Absent {
            diagnostic: AbsentDiagnostic {
                fact,
                subject,
                allowance: AbsenceAllowance::Allowed,
            },
        }
    }

    pub fn unreadable(fact: FactKind, subject: FactSubject, reason: UnreadableReason) -> Self {
        Self::Unreadable {
            diagnostic: UnreadableDiagnostic {
                fact,
                subject,
                reason,
            },
        }
    }

    pub fn stale(
        fact: FactKind,
        subject: FactSubject,
        expected: RevisionMarker,
        observed: RevisionMarker,
    ) -> Self {
        Self::Stale {
            diagnostic: StaleDiagnostic {
                fact,
                subject,
                expected,
                observed,
            },
        }
    }

    pub fn failed(fact: FactKind, subject: FactSubject, reason: FailureReason) -> Self {
        Self::Failed {
            diagnostic: FailedDiagnostic {
                fact,
                subject,
                reason,
            },
        }
    }

    pub fn as_present(&self) -> Option<&T> {
        match self {
            Self::Present(value) => Some(value),
            Self::Absent { .. }
            | Self::Unreadable { .. }
            | Self::Stale { .. }
            | Self::Failed { .. } => None,
        }
    }

    pub fn is_present(&self) -> bool {
        self.as_present().is_some()
    }

    pub fn diagnostic(&self) -> Option<FactDiagnostic> {
        match self {
            Self::Present(_) => None,
            Self::Absent { diagnostic } => Some(FactDiagnostic::Absent(diagnostic.clone())),
            Self::Unreadable { diagnostic } => Some(FactDiagnostic::Unreadable(diagnostic.clone())),
            Self::Stale { diagnostic } => Some(FactDiagnostic::Stale(diagnostic.clone())),
            Self::Failed { diagnostic } => Some(FactDiagnostic::Failed(diagnostic.clone())),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TerminalDecision {
    Closed { decided_at: TimestampMs },
    Cancelled { decided_at: TimestampMs },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LifecycleInput {
    pub identity: EntityIdentity,
    pub lifecycle: PersistedLifecycle,
    pub terminal_decision: Option<TerminalDecision>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PrincipalBinding {
    Authenticated {
        actor_id: ActorId,
    },
    Delegated {
        actor_id: ActorId,
        delegation_id: DelegationId,
        delegator_id: ActorId,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ActorAuthorityInput {
    /// Immutable, credential-backed root; a delegated sibling is not independent.
    pub authority_root: ActorId,
    pub project_id: ProjectId,
    pub role: ActorRole,
    pub principal: PrincipalBinding,
    pub session_id: Option<SessionId>,
}

impl ActorAuthorityInput {
    pub fn actor_id(&self) -> &ActorId {
        match &self.principal {
            PrincipalBinding::Authenticated { actor_id }
            | PrincipalBinding::Delegated { actor_id, .. } => actor_id,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VerifierPolicy {
    pub id: VerifierPolicyId,
    pub version: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReviewRequirementPolicy {
    NotRequired,
    Independent,
    OperatorAllowed,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PinnedRequirement {
    /// A disposition of a failed fact; raw state and receipt remain unchanged.
    pub exception: Option<RequirementExceptionInput>,
    pub id: RequirementId,
    pub gate_id: GateId,
    pub kind: GateKind,
    pub required: bool,
    pub state: GateState,
    pub verifier_policy: VerifierPolicy,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RequirementExceptionInput {
    pub id: DecisionId,
    pub reason: crate::acceptance::ExceptionReason,
    pub comment: String,
    pub actor_role: ActorRole,
    pub entity_revision: EntityRevision,
    pub proof_revision: ProofRevision,
    pub expires_at: Option<TimestampMs>,
    pub revoked: bool,
}

impl RequirementExceptionInput {
    pub fn applies(
        &self,
        raw: GateState,
        entity: EntityRevision,
        proof: ProofRevision,
        at: TimestampMs,
    ) -> bool {
        raw == GateState::Failed
            && self.actor_role == ActorRole::Operator
            && !self.comment.trim().is_empty()
            && !self.revoked
            && self.entity_revision == entity
            && self.proof_revision == proof
            && self.expires_at.is_none_or(|expiry| expiry > at)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PinnedRequirementsInput {
    pub proof: ProofIdentity,
    pub requirements: Vec<PinnedRequirement>,
    pub review_policy: ReviewRequirementPolicy,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DependencyOutcome {
    Open,
    Closed,
    Complete,
    Cancelled,
    Failed,
    Waived,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DependencyWaiver {
    pub decision_id: DecisionId,
    pub edge_revision: EntityRevision,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DependencyOutcomeInput {
    pub id: DependencyId,
    pub predecessor: EntityIdentity,
    pub successor: EntityIdentity,
    pub policy: DependencyPolicy,
    pub outcome: DependencyOutcome,
    pub outcome_revision: EntityRevision,
    pub waiver: Option<DependencyWaiver>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DependencyOutcomesInput {
    pub edges: Vec<DependencyOutcomeInput>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntegrityScope {
    pub project_id: ProjectId,
    pub work_id: WorkId,
    pub target: FactTarget,
}

impl IntegrityScope {
    pub fn work(project_id: ProjectId, work_id: WorkId) -> Self {
        Self {
            project_id,
            work_id,
            target: FactTarget::Work,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum IntegrityLevel {
    Valid,
    Degraded,
    Quarantined,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum IntegrityDiagnosticCode {
    MissingRequired,
    Corrupt,
    Stale,
    Failed,
    Contradictory,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntegrityDiagnostic {
    pub scope: IntegrityScope,
    pub code: IntegrityDiagnosticCode,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntegrityInput {
    pub scope: IntegrityScope,
    pub level: IntegrityLevel,
    pub diagnostics: Vec<IntegrityDiagnostic>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Availability {
    Live,
    Stale,
    Unavailable,
    Incompatible,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum PermittedAction {
    Inspect,
    Claim,
    AcceptAttempt,
    ResumeAttempt,
    AttachEvidence,
    Submit,
    Review,
    Finish,
    Release,
    Recover,
    ResolveHold,
    Repair,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ActionDenialReason {
    RoleDenied,
    IntegrityQuarantined,
    MissingFact,
    StaleEntity,
    StaleProof,
    StaleFence,
    RecoveryRequired,
    PolicyDenied,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DeniedAction {
    pub action: PermittedAction,
    pub reason: ActionDenialReason,
}

/// Action permissions are supplied as domain inputs and are not inferred from
/// service availability.  The application may still deny a requested action
/// after rereading canonical facts in its committing transaction.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PermittedActionsInput {
    pub allowed: BTreeSet<PermittedAction>,
    pub denied: Vec<DeniedAction>,
}

impl PermittedActionsInput {
    pub fn none() -> Self {
        Self {
            allowed: BTreeSet::new(),
            denied: Vec::new(),
        }
    }

    pub fn allowing(actions: impl IntoIterator<Item = PermittedAction>) -> Self {
        Self {
            allowed: actions.into_iter().collect(),
            denied: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExecutionInput {
    pub attempt: AttemptIdentity,
    pub actor_id: ActorId,
    pub session_id: Option<SessionId>,
    pub phase: AttemptPhase,
    pub claimed_at: TimestampMs,
    pub lease_deadline: TimestampMs,
    pub hard_deadline: TimestampMs,
    pub proof: ProofIdentity,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SubmissionState {
    Sealed,
    Superseded,
    Rejected,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SubmissionInput {
    pub actor_id: ActorId,
    pub session_id: SessionId,
    pub authority_root: ActorId,
    pub id: SubmissionId,
    pub proof: ProofIdentity,
    pub summary_digest: ContentDigest,
    pub state: SubmissionState,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReviewOutcome {
    Pending,
    Approved,
    Rejected,
    Returned,
    Revoked,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReviewInput {
    pub reviewer_authority_root: ActorId,
    pub attempt_authority_root: ActorId,
    pub id: ReviewId,
    pub submission_id: SubmissionId,
    pub proof: ProofIdentity,
    pub reviewer_id: ActorId,
    pub attempt_actor_id: ActorId,
    pub outcome: ReviewOutcome,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RecoveryReason {
    Expired,
    StopUnknown,
    ResourceUnknown,
    Failed,
    CancelRequested,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ResourceDisposition {
    ConfirmedStopped,
    Adopted,
    Unknown,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RecoveryInput {
    pub id: RecoveryId,
    pub attempt: AttemptIdentity,
    pub reason: RecoveryReason,
    pub resource: ResourceDisposition,
    pub unresolved: bool,
    pub owner_id: Option<ActorId>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ContradictionCode {
    TerminalDecisionMissing,
    TerminalDecisionMismatch,
    NonTerminalLifecycleHasTerminalDecision,
    SelfDependency,
    WaiverMissing,
    ReviewPolicyMismatch,
    CurrentExecutionIsTerminal,
    DeadlineBeforeClaim,
    AttemptBindingMismatch,
    ProofRevisionMismatch,
    SelfReview,
    RecoveryDispositionMismatch,
    IntegrityLevelMismatch,
    ActionAllowedAndDenied,
    MalformedInput,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DecisionDiagnostic {
    Fact(FactDiagnostic),
    Contradictory {
        fact: FactKind,
        subject: FactSubject,
        code: ContradictionCode,
    },
    IdentityMismatch {
        fact: FactKind,
        subject: FactSubject,
        expected: EntityIdentity,
        observed: EntityIdentity,
    },
    CrossProject {
        fact: FactKind,
        subject: FactSubject,
        observed_project: ProjectId,
    },
    Duplicate {
        fact: FactKind,
        subject: FactSubject,
        key: DuplicateKey,
    },
    Integrity {
        diagnostic: IntegrityDiagnostic,
    },
    ActionConflict {
        action: PermittedAction,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DuplicateKey {
    Requirement(RequirementId),
    Dependency(DependencyId),
    Hold(HoldId),
    Action(PermittedAction),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HoldInput {
    pub id: HoldId,
    pub scope: IntegrityScope,
    pub code: HoldCode,
    pub entity_revision: EntityRevision,
    pub active: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HoldsInput {
    pub holds: Vec<HoldInput>,
}

/// Canonical availability timing read from the same snapshot as the other
/// decision facts. These values must agree with the legacy status context;
/// otherwise that context could omit a scheduling or retry barrier.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct StatusTimingInput {
    pub schedule: Option<WorkSchedule>,
    pub cycle_activation_at: Option<TimestampMs>,
    pub retry_not_before: Option<TimestampMs>,
}

impl StatusTimingInput {
    pub const fn empty() -> Self {
        Self {
            schedule: None,
            cycle_activation_at: None,
            retry_not_before: None,
        }
    }
}

/// The complete pure-decision input envelope.  It contains no transport
/// handles and no implicit clock or current-process lookup.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DecisionInputs {
    pub subject: EntityIdentity,
    pub snapshot_revision: Revision,
    pub clock: EvaluationClock,
    pub availability: Availability,
    /// Canonical dispatch policy used by status and claim authorization.
    /// It must not be inferred from a presentation reason.
    pub dispatch_policy: DispatchPolicy,
    pub lifecycle: Fact<LifecycleInput>,
    pub authority: Fact<ActorAuthorityInput>,
    pub requirements: Fact<PinnedRequirementsInput>,
    pub dependencies: Fact<DependencyOutcomesInput>,
    pub holds: Fact<HoldsInput>,
    pub execution: Fact<ExecutionInput>,
    pub submission: Fact<SubmissionInput>,
    pub review: Fact<ReviewInput>,
    pub recovery: Fact<RecoveryInput>,
    pub integrity: IntegrityInput,
    pub permitted_actions: PermittedActionsInput,
}

impl DecisionInputs {
    /// Return every visible diagnostic, including allowed absence and degraded
    /// integrity.  This is for read/report paths and must not be collapsed into
    /// a boolean success value.
    pub fn diagnostics(&self) -> Vec<DecisionDiagnostic> {
        let mut diagnostics = Vec::new();
        macro_rules! collect_fact {
            ($fact:expr) => {
                if let Some(diagnostic) = $fact.diagnostic() {
                    diagnostics.push(DecisionDiagnostic::Fact(diagnostic));
                }
            };
        }
        collect_fact!(self.lifecycle);
        collect_fact!(self.authority);
        collect_fact!(self.requirements);
        collect_fact!(self.dependencies);
        collect_fact!(self.holds);
        collect_fact!(self.execution);
        collect_fact!(self.submission);
        collect_fact!(self.review);
        collect_fact!(self.recovery);
        diagnostics.extend(
            self.integrity
                .diagnostics
                .iter()
                .cloned()
                .map(|diagnostic| DecisionDiagnostic::Integrity { diagnostic }),
        );
        diagnostics.extend(self.structural_diagnostics());
        diagnostics
    }

    /// Validate facts that are required for a trustworthy decision.  Optional
    /// absence and degraded integrity are returned by [`Self::diagnostics`]
    /// but do not make the input itself undecidable.
    pub fn validate(&self) -> Result<(), Vec<DecisionDiagnostic>> {
        let diagnostics = self
            .diagnostics()
            .into_iter()
            .filter(|diagnostic| self.is_blocking(diagnostic))
            .collect::<Vec<_>>();
        if diagnostics.is_empty() {
            Ok(())
        } else {
            Err(diagnostics)
        }
    }

    pub fn is_decidable(&self) -> bool {
        self.validate().is_ok()
    }

    fn is_blocking(&self, diagnostic: &DecisionDiagnostic) -> bool {
        match diagnostic {
            DecisionDiagnostic::Fact(FactDiagnostic::Absent(item)) => {
                item.allowance == AbsenceAllowance::Required
            }
            DecisionDiagnostic::Integrity { .. } => {
                self.integrity.level == IntegrityLevel::Quarantined
            }
            DecisionDiagnostic::Fact(_)
            | DecisionDiagnostic::Contradictory { .. }
            | DecisionDiagnostic::IdentityMismatch { .. }
            | DecisionDiagnostic::CrossProject { .. }
            | DecisionDiagnostic::Duplicate { .. }
            | DecisionDiagnostic::ActionConflict { .. } => true,
        }
    }

    fn structural_diagnostics(&self) -> Vec<DecisionDiagnostic> {
        let mut diagnostics = Vec::new();
        let work_subject = FactSubject::work(
            self.subject.project_id.clone(),
            self.subject.work_id.clone(),
        );

        if let Some(lifecycle) = self.lifecycle.as_present() {
            if lifecycle.identity != self.subject {
                diagnostics.push(DecisionDiagnostic::IdentityMismatch {
                    fact: FactKind::Lifecycle,
                    subject: work_subject.clone(),
                    expected: self.subject.clone(),
                    observed: lifecycle.identity.clone(),
                });
            }
            match (&lifecycle.lifecycle, &lifecycle.terminal_decision) {
                (PersistedLifecycle::Closed, Some(TerminalDecision::Closed { .. }))
                | (PersistedLifecycle::Cancelled, Some(TerminalDecision::Cancelled { .. }))
                | (PersistedLifecycle::Draft | PersistedLifecycle::Open, None) => {}
                (PersistedLifecycle::Closed | PersistedLifecycle::Cancelled, None) => {
                    diagnostics.push(DecisionDiagnostic::Contradictory {
                        fact: FactKind::Lifecycle,
                        subject: work_subject.clone(),
                        code: ContradictionCode::TerminalDecisionMissing,
                    });
                }
                (PersistedLifecycle::Closed, Some(TerminalDecision::Cancelled { .. }))
                | (PersistedLifecycle::Cancelled, Some(TerminalDecision::Closed { .. })) => {
                    diagnostics.push(DecisionDiagnostic::Contradictory {
                        fact: FactKind::Lifecycle,
                        subject: work_subject.clone(),
                        code: ContradictionCode::TerminalDecisionMismatch,
                    });
                }
                (PersistedLifecycle::Draft | PersistedLifecycle::Open, Some(_)) => {
                    diagnostics.push(DecisionDiagnostic::Contradictory {
                        fact: FactKind::Lifecycle,
                        subject: work_subject.clone(),
                        code: ContradictionCode::NonTerminalLifecycleHasTerminalDecision,
                    });
                }
            }
        }

        if let Some(authority) = self.authority.as_present() {
            if authority.project_id != self.subject.project_id {
                diagnostics.push(DecisionDiagnostic::CrossProject {
                    fact: FactKind::ActorAuthority,
                    subject: FactSubject::target(
                        self.subject.project_id.clone(),
                        self.subject.work_id.clone(),
                        FactTarget::Actor(authority.actor_id().clone()),
                    ),
                    observed_project: authority.project_id.clone(),
                });
            }
        }

        if let Some(requirements) = self.requirements.as_present() {
            self.check_proof_identity(
                &mut diagnostics,
                FactKind::PinnedRequirements,
                &work_subject,
                &requirements.proof,
            );
            let mut ids = BTreeSet::new();
            let mut gate_ids = BTreeSet::new();
            for requirement in &requirements.requirements {
                if !ids.insert(requirement.id.clone()) {
                    diagnostics.push(DecisionDiagnostic::Duplicate {
                        fact: FactKind::PinnedRequirements,
                        subject: FactSubject::target(
                            self.subject.project_id.clone(),
                            self.subject.work_id.clone(),
                            FactTarget::Requirements,
                        ),
                        key: DuplicateKey::Requirement(requirement.id.clone()),
                    });
                }
                if !gate_ids.insert(requirement.gate_id.clone()) {
                    diagnostics.push(DecisionDiagnostic::Contradictory {
                        fact: FactKind::PinnedRequirements,
                        subject: work_subject.clone(),
                        code: ContradictionCode::ReviewPolicyMismatch,
                    });
                }
            }
            let requires_review = requirements
                .requirements
                .iter()
                .any(|requirement| requirement.required && requirement.kind == GateKind::Review);
            if requires_review && requirements.review_policy == ReviewRequirementPolicy::NotRequired
            {
                diagnostics.push(DecisionDiagnostic::Contradictory {
                    fact: FactKind::PinnedRequirements,
                    subject: work_subject.clone(),
                    code: ContradictionCode::ReviewPolicyMismatch,
                });
            }
        }

        if let Some(dependencies) = self.dependencies.as_present() {
            let subject = FactSubject::target(
                self.subject.project_id.clone(),
                self.subject.work_id.clone(),
                FactTarget::Dependencies,
            );
            let mut ids = BTreeSet::new();
            let mut edges = BTreeSet::new();
            for edge in &dependencies.edges {
                if !ids.insert(edge.id.clone()) {
                    diagnostics.push(DecisionDiagnostic::Duplicate {
                        fact: FactKind::DependencyOutcomes,
                        subject: subject.clone(),
                        key: DuplicateKey::Dependency(edge.id.clone()),
                    });
                }
                if !edges.insert((
                    edge.predecessor.work_id.clone(),
                    edge.successor.work_id.clone(),
                )) {
                    diagnostics.push(DecisionDiagnostic::Duplicate {
                        fact: FactKind::DependencyOutcomes,
                        subject: subject.clone(),
                        key: DuplicateKey::Dependency(edge.id.clone()),
                    });
                }
                if edge.successor != self.subject {
                    diagnostics.push(DecisionDiagnostic::IdentityMismatch {
                        fact: FactKind::DependencyOutcomes,
                        subject: subject.clone(),
                        expected: self.subject.clone(),
                        observed: edge.successor.clone(),
                    });
                }
                if edge.predecessor.project_id != self.subject.project_id {
                    diagnostics.push(DecisionDiagnostic::CrossProject {
                        fact: FactKind::DependencyOutcomes,
                        subject: subject.clone(),
                        observed_project: edge.predecessor.project_id.clone(),
                    });
                }
                if edge.predecessor.work_id == edge.successor.work_id {
                    diagnostics.push(DecisionDiagnostic::Contradictory {
                        fact: FactKind::DependencyOutcomes,
                        subject: subject.clone(),
                        code: ContradictionCode::SelfDependency,
                    });
                }
                if edge.outcome == DependencyOutcome::Waived && edge.waiver.is_none() {
                    diagnostics.push(DecisionDiagnostic::Contradictory {
                        fact: FactKind::DependencyOutcomes,
                        subject: subject.clone(),
                        code: ContradictionCode::WaiverMissing,
                    });
                }
                // An exception is an additional decision, not an outcome
                // rewrite. Preserve Open/Failed/Cancelled beside its waiver.
                if edge.waiver.as_ref().is_some_and(|waiver| {
                    waiver.decision_id.as_str().is_empty()
                        || waiver.edge_revision != edge.successor.revision
                }) {
                    diagnostics.push(DecisionDiagnostic::Contradictory {
                        fact: FactKind::DependencyOutcomes,
                        subject: subject.clone(),
                        code: ContradictionCode::WaiverMissing,
                    });
                }
            }
        }

        if let Some(holds) = self.holds.as_present() {
            let subject = FactSubject::target(
                self.subject.project_id.clone(),
                self.subject.work_id.clone(),
                FactTarget::Holds,
            );
            let mut ids = BTreeSet::new();
            for hold in &holds.holds {
                if !ids.insert(hold.id.clone()) {
                    diagnostics.push(DecisionDiagnostic::Duplicate {
                        fact: FactKind::Holds,
                        subject: subject.clone(),
                        key: DuplicateKey::Hold(hold.id.clone()),
                    });
                }
                if hold.scope.project_id != self.subject.project_id
                    || hold.scope.work_id != self.subject.work_id
                {
                    diagnostics.push(DecisionDiagnostic::CrossProject {
                        fact: FactKind::Holds,
                        subject: subject.clone(),
                        observed_project: hold.scope.project_id.clone(),
                    });
                }
            }
        }

        if let Some(execution) = self.execution.as_present() {
            let subject = FactSubject::target(
                self.subject.project_id.clone(),
                self.subject.work_id.clone(),
                FactTarget::Attempt(execution.attempt.attempt_id.clone()),
            );
            self.check_proof_identity(
                &mut diagnostics,
                FactKind::Execution,
                &subject,
                &execution.proof,
            );
            if execution.proof.attempt.as_ref() != Some(&execution.attempt) {
                diagnostics.push(DecisionDiagnostic::Contradictory {
                    fact: FactKind::Execution,
                    subject: subject.clone(),
                    code: ContradictionCode::AttemptBindingMismatch,
                });
            }
            if execution.phase.is_terminal() {
                diagnostics.push(DecisionDiagnostic::Contradictory {
                    fact: FactKind::Execution,
                    subject: subject.clone(),
                    code: ContradictionCode::CurrentExecutionIsTerminal,
                });
            }
            if execution.lease_deadline < execution.claimed_at
                || execution.hard_deadline < execution.claimed_at
            {
                diagnostics.push(DecisionDiagnostic::Contradictory {
                    fact: FactKind::Execution,
                    subject: subject.clone(),
                    code: ContradictionCode::DeadlineBeforeClaim,
                });
            }
            // Execution ownership and the authenticated reader are different
            // facts. Action policy enforces ownership only for owner actions.
            self.check_proof_revision(&mut diagnostics, &execution.proof);
        }

        if let Some(submission) = self.submission.as_present() {
            let subject = FactSubject::target(
                self.subject.project_id.clone(),
                self.subject.work_id.clone(),
                FactTarget::Submission(submission.id.clone()),
            );
            self.check_proof_identity(
                &mut diagnostics,
                FactKind::Submission,
                &subject,
                &submission.proof,
            );
            self.check_proof_revision(&mut diagnostics, &submission.proof);
            if let Some(execution) = self.execution.as_present() {
                if submission.proof.attempt.as_ref() != Some(&execution.attempt) {
                    diagnostics.push(DecisionDiagnostic::Contradictory {
                        fact: FactKind::Submission,
                        subject,
                        code: ContradictionCode::AttemptBindingMismatch,
                    });
                }
            }
        }

        if let Some(review) = self.review.as_present() {
            let subject = FactSubject::target(
                self.subject.project_id.clone(),
                self.subject.work_id.clone(),
                FactTarget::Review(review.id.clone()),
            );
            self.check_proof_identity(&mut diagnostics, FactKind::Review, &subject, &review.proof);
            self.check_proof_revision(&mut diagnostics, &review.proof);
            if review.reviewer_id == review.attempt_actor_id
                || review.reviewer_authority_root == review.attempt_authority_root
            {
                diagnostics.push(DecisionDiagnostic::Contradictory {
                    fact: FactKind::Review,
                    subject,
                    code: ContradictionCode::SelfReview,
                });
            }
            if let Some(submission) = self.submission.as_present() {
                if review.submission_id != submission.id || review.proof != submission.proof {
                    diagnostics.push(DecisionDiagnostic::Contradictory {
                        fact: FactKind::Review,
                        subject: FactSubject::target(
                            self.subject.project_id.clone(),
                            self.subject.work_id.clone(),
                            FactTarget::Review(review.id.clone()),
                        ),
                        code: ContradictionCode::AttemptBindingMismatch,
                    });
                }
            }
        }

        if let Some(recovery) = self.recovery.as_present() {
            let subject = FactSubject::target(
                self.subject.project_id.clone(),
                self.subject.work_id.clone(),
                FactTarget::Recovery(recovery.id.clone()),
            );
            if !recovery.unresolved && recovery.resource == ResourceDisposition::Unknown {
                diagnostics.push(DecisionDiagnostic::Contradictory {
                    fact: FactKind::Recovery,
                    subject,
                    code: ContradictionCode::RecoveryDispositionMismatch,
                });
            }
            if let Some(execution) = self.execution.as_present() {
                if recovery.attempt != execution.attempt {
                    diagnostics.push(DecisionDiagnostic::Contradictory {
                        fact: FactKind::Recovery,
                        subject: FactSubject::target(
                            self.subject.project_id.clone(),
                            self.subject.work_id.clone(),
                            FactTarget::Recovery(recovery.id.clone()),
                        ),
                        code: ContradictionCode::AttemptBindingMismatch,
                    });
                }
            }
        }

        if self.integrity.scope.project_id != self.subject.project_id
            || self.integrity.scope.work_id != self.subject.work_id
        {
            diagnostics.push(DecisionDiagnostic::CrossProject {
                fact: FactKind::Lifecycle,
                subject: work_subject.clone(),
                observed_project: self.integrity.scope.project_id.clone(),
            });
        }
        match (self.integrity.level, self.integrity.diagnostics.is_empty()) {
            (IntegrityLevel::Valid, false) | (IntegrityLevel::Degraded, true) => {
                diagnostics.push(DecisionDiagnostic::Contradictory {
                    fact: FactKind::Lifecycle,
                    subject: work_subject.clone(),
                    code: ContradictionCode::IntegrityLevelMismatch,
                });
            }
            _ => {}
        }

        for denied in &self.permitted_actions.denied {
            if self.permitted_actions.allowed.contains(&denied.action) {
                diagnostics.push(DecisionDiagnostic::ActionConflict {
                    action: denied.action,
                });
            }
        }
        diagnostics
    }

    fn check_proof_identity(
        &self,
        diagnostics: &mut Vec<DecisionDiagnostic>,
        fact: FactKind,
        subject: &FactSubject,
        proof: &ProofIdentity,
    ) {
        // Immutable proof may precede a harmless entity edit. Its independent
        // proof generation, not the current presentation revision, invalidates it.
        if proof.entity.project_id != self.subject.project_id
            || proof.entity.work_id != self.subject.work_id
            || proof.entity.revision > self.subject.revision
        {
            diagnostics.push(DecisionDiagnostic::IdentityMismatch {
                fact,
                subject: subject.clone(),
                expected: self.subject.clone(),
                observed: proof.entity.clone(),
            });
        }
        let planning_only = fact == FactKind::PinnedRequirements
            && self.submission.as_present().is_none()
            && self.review.as_present().is_none()
            && self.execution.as_present().is_none_or(|execution| {
                matches!(
                    execution.phase,
                    AttemptPhase::Claimed | AttemptPhase::Accepted
                )
            });
        let ownership_only = fact == FactKind::Execution
            && self.execution.as_present().is_some_and(|execution| {
                matches!(
                    execution.phase,
                    AttemptPhase::Claimed | AttemptPhase::Accepted
                )
            });
        if (!planning_only && !ownership_only && !proof.is_bound())
            || proof.proof_revision.get() == 0
            || proof.profile.profile_id.as_str().is_empty()
            || proof.profile.version.is_empty()
            || proof.profile.digest.as_str().is_empty()
            || proof.policy_version.is_empty()
        {
            diagnostics.push(DecisionDiagnostic::Contradictory {
                fact,
                subject: subject.clone(),
                code: ContradictionCode::MalformedInput,
            });
        }
    }

    fn check_proof_revision(
        &self,
        diagnostics: &mut Vec<DecisionDiagnostic>,
        proof: &ProofIdentity,
    ) {
        if let Some(requirements) = self.requirements.as_present() {
            if proof.proof_revision != requirements.proof.proof_revision
                || proof.profile != requirements.proof.profile
                || (requirements.proof.is_bound()
                    && (proof.source_snapshot != requirements.proof.source_snapshot
                        || proof.configuration != requirements.proof.configuration))
            {
                diagnostics.push(DecisionDiagnostic::Contradictory {
                    fact: FactKind::PinnedRequirements,
                    subject: FactSubject::work(
                        self.subject.project_id.clone(),
                        self.subject.work_id.clone(),
                    ),
                    code: ContradictionCode::ProofRevisionMismatch,
                });
            }
        }
    }
}
