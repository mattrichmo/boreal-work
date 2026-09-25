//! Deterministic, domain-owned action descriptors and authorization decisions.
//!
//! The application supplies one canonical [`DecisionInputs`] snapshot and the
//! typed status/reasons produced from that snapshot.  This module never reads
//! a status string, clock, store, credential, or process.  It is therefore
//! safe for read projections and mutation transactions to call the same
//! policy, with the latter additionally presenting the descriptor revisions
//! and fence inside its committing transaction.

use crate::{
    decision_inputs::{
        ActorAuthorityInput, AttemptIdentity, Availability, DecisionInputs, EntityIdentity,
        EntityRevision, Fact, HoldCode, HoldInput, IntegrityLevel, PermittedAction,
        PrincipalBinding, ProofRevision, ReviewOutcome, SubmissionState,
    },
    ActorId, ActorRole, AttemptPhase, DerivedStatus, ReasonCode, Revision,
};

/// The versioned action vocabulary exposed to read projections and mutation
/// transactions.  The order is the stable descriptor order.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum ActionKind {
    Inspect,
    ReadHistory,
    ReadOperation,
    Export,
    Publish,
    Claim,
    AcceptAttempt,
    StartAttempt,
    Checkpoint,
    AttachEvidence,
    Submit,
    RequestReview,
    Review,
    FinishClose,
    Close,
    Stop,
    Release,
    PausePolicy,
    ResumePolicy,
    Cancel,
    Reopen,
    Retry,
    RevokeReview,
    RevokeException,
    ResolveHold,
    WaiveDependency,
    ForceGate,
    Recover,
    ReconcileResource,
    Repair,
}

const ALL_ACTIONS: [ActionKind; 30] = [
    ActionKind::Inspect,
    ActionKind::ReadHistory,
    ActionKind::ReadOperation,
    ActionKind::Export,
    ActionKind::Publish,
    ActionKind::Claim,
    ActionKind::AcceptAttempt,
    ActionKind::StartAttempt,
    ActionKind::Checkpoint,
    ActionKind::AttachEvidence,
    ActionKind::Submit,
    ActionKind::RequestReview,
    ActionKind::Review,
    ActionKind::FinishClose,
    ActionKind::Close,
    ActionKind::Stop,
    ActionKind::Release,
    ActionKind::PausePolicy,
    ActionKind::ResumePolicy,
    ActionKind::Cancel,
    ActionKind::Reopen,
    ActionKind::Retry,
    ActionKind::RevokeReview,
    ActionKind::RevokeException,
    ActionKind::ResolveHold,
    ActionKind::WaiveDependency,
    ActionKind::ForceGate,
    ActionKind::Recover,
    ActionKind::ReconcileResource,
    ActionKind::Repair,
];

/// Return the canonical action order used by descriptors and decisions.
pub const fn all_action_kinds() -> &'static [ActionKind] {
    &ALL_ACTIONS
}

/// Inputs that a client must bind before submitting an action request.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum ActionInputKind {
    ExpectedProjectRevision,
    ExpectedEntityRevision,
    ExpectedProofRevision,
    AttemptId,
    Fence,
    SessionId,
    OperationId,
    Confirmation,
    Reason,
    Comment,
    Evidence,
    Summary,
    ReviewDecision,
    RecoveryDisposition,
}

/// Server-produced action metadata.  The target and expected revisions are
/// part of the descriptor so a mutation cannot treat a stale UI affordance as
/// authorization.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ActionDescriptor {
    pub action: ActionKind,
    pub target: EntityIdentity,
    pub expected_project_revision: Revision,
    pub expected_entity_revision: EntityRevision,
    pub expected_proof_revision: Option<ProofRevision>,
    pub attempt: Option<AttemptIdentity>,
    pub required_roles: Vec<ActorRole>,
    pub required_inputs: Vec<ActionInputKind>,
    pub confirmation: Option<&'static str>,
    pub read_only: bool,
    pub recovery: bool,
}

impl ActionDescriptor {
    /// Build the exact request context represented by this descriptor.
    pub fn request(&self) -> ActionRequest {
        ActionRequest {
            action: self.action,
            target: self.target.clone(),
            expected_project_revision: self.expected_project_revision,
            expected_proof_revision: self.expected_proof_revision,
            attempt: self.attempt.clone(),
        }
    }
}

/// The caller-presented optimistic and fenced context for one action.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ActionRequest {
    pub action: ActionKind,
    pub target: EntityIdentity,
    pub expected_project_revision: Revision,
    pub expected_proof_revision: Option<ProofRevision>,
    pub attempt: Option<AttemptIdentity>,
}

/// Stable typed causes for action denial.  Display messages belong to an
/// adapter; these variants are the policy/protocol boundary.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ActionDenialReason {
    Unauthenticated,
    ScopeMismatch,
    InvalidFacts,
    AvailabilityUnavailable(Availability),
    IntegrityQuarantined,
    IntegrityDegraded,
    RoleDenied {
        required: Vec<ActorRole>,
        observed: ActorRole,
    },
    DelegationInvalid,
    PolicyDenied,
    StatusDenied(DerivedStatus),
    HoldActive(HoldCode),
    StaleSnapshot {
        expected: Revision,
        observed: Revision,
    },
    StaleEntity {
        expected: EntityRevision,
        observed: EntityRevision,
    },
    StaleProof {
        expected: Option<ProofRevision>,
        observed: Option<ProofRevision>,
    },
    MissingAttempt,
    StaleFence {
        expected: Option<AttemptIdentity>,
        observed: Option<AttemptIdentity>,
    },
    AttemptOwnerMismatch,
    AttemptPhaseDenied(AttemptPhase),
    MissingSubmission,
    ReviewNotIndependent,
    RecoveryRequired,
    NoActiveHold,
    ActionNotApplicable,
}

impl ActionDenialReason {
    /// Stable machine-facing code.  Fields remain available for structured
    /// diagnostics and recovery routing.
    pub const fn stable_code(&self) -> &'static str {
        match self {
            Self::Unauthenticated => "unauthenticated",
            Self::ScopeMismatch => "scope_mismatch",
            Self::InvalidFacts => "invalid_facts",
            Self::AvailabilityUnavailable(_) => "availability_unavailable",
            Self::IntegrityQuarantined => "integrity_quarantined",
            Self::IntegrityDegraded => "integrity_degraded",
            Self::RoleDenied { .. } => "role_denied",
            Self::DelegationInvalid => "delegation_invalid",
            Self::PolicyDenied => "policy_denied",
            Self::StatusDenied(_) => "status_denied",
            Self::HoldActive(_) => "hold_active",
            Self::StaleSnapshot { .. } => "stale_snapshot",
            Self::StaleEntity { .. } => "stale_entity",
            Self::StaleProof { .. } => "stale_proof",
            Self::MissingAttempt => "attempt_missing",
            Self::StaleFence { .. } => "stale_fence",
            Self::AttemptOwnerMismatch => "attempt_owner_mismatch",
            Self::AttemptPhaseDenied(_) => "attempt_phase_denied",
            Self::MissingSubmission => "submission_missing",
            Self::ReviewNotIndependent => "review_not_independent",
            Self::RecoveryRequired => "recovery_required",
            Self::NoActiveHold => "hold_missing",
            Self::ActionNotApplicable => "action_not_applicable",
        }
    }
}

/// An action that was denied together with safe, typed next routes.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DeniedAction {
    pub descriptor: ActionDescriptor,
    pub reason: ActionDenialReason,
    pub recovery: Vec<ActionKind>,
}

/// One authorized action decision.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ActionAuthorization {
    Allowed(ActionDescriptor),
    Denied(DeniedAction),
}

/// All descriptors for one canonical snapshot, partitioned deterministically
/// into allowed and denied actions.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ActionDecision {
    pub allowed: Vec<ActionDescriptor>,
    pub denied: Vec<DeniedAction>,
}

impl ActionDecision {
    pub fn allows(&self, action: ActionKind) -> bool {
        self.allowed
            .iter()
            .any(|descriptor| descriptor.action == action)
    }

    pub fn denial(&self, action: ActionKind) -> Option<&DeniedAction> {
        self.denied
            .iter()
            .find(|denied| denied.descriptor.action == action)
    }
}

/// Typed status/reason context supplied by the canonical evaluator.  The
/// action policy consumes this value and never reconstructs it from prose or a
/// protocol display label.
#[derive(Clone, Copy, Debug)]
pub struct ActionEvaluationInput<'a> {
    pub facts: &'a DecisionInputs,
    pub status: DerivedStatus,
    pub reasons: &'a [ReasonCode],
}

impl<'a> ActionEvaluationInput<'a> {
    pub const fn new(
        facts: &'a DecisionInputs,
        status: DerivedStatus,
        reasons: &'a [ReasonCode],
    ) -> Self {
        Self {
            facts,
            status,
            reasons,
        }
    }
}

/// Evaluate one requested action.  Mutation transactions should call this
/// after rereading the same canonical facts represented by the descriptor.
pub fn evaluate_action(
    input: &ActionEvaluationInput<'_>,
    request: &ActionRequest,
) -> ActionAuthorization {
    let descriptor = descriptor(input, request.action);
    match deny_reason(input, &descriptor, request) {
        Some(reason) => ActionAuthorization::Denied(DeniedAction {
            recovery: recovery_routes(input, request.action, &reason),
            descriptor,
            reason,
        }),
        None => ActionAuthorization::Allowed(descriptor),
    }
}

/// Evaluate every action in the stable vocabulary.  Both the read projection
/// and the mutation path use [`evaluate_action`] as their shared policy.
pub fn evaluate_actions(input: &ActionEvaluationInput<'_>) -> ActionDecision {
    let mut decision = ActionDecision {
        allowed: Vec::new(),
        denied: Vec::new(),
    };
    for action in all_action_kinds() {
        let descriptor = descriptor(input, *action);
        let authorization = evaluate_action(input, &descriptor.request());
        match authorization {
            ActionAuthorization::Allowed(descriptor) => decision.allowed.push(descriptor),
            ActionAuthorization::Denied(denied) => decision.denied.push(denied),
        }
    }
    decision
}

fn descriptor(input: &ActionEvaluationInput<'_>, action: ActionKind) -> ActionDescriptor {
    let expected_proof_revision = current_proof_revision(input.facts);
    let attempt = current_attempt(input.facts);
    let confirmation = confirmation_for(action);
    let mut required_inputs = vec![
        ActionInputKind::ExpectedProjectRevision,
        ActionInputKind::ExpectedEntityRevision,
    ];
    if action_requires_proof(action) && expected_proof_revision.is_some() {
        required_inputs.push(ActionInputKind::ExpectedProofRevision);
    }
    if action_requires_attempt(action) {
        required_inputs.extend([ActionInputKind::AttemptId, ActionInputKind::Fence]);
    }
    if !is_read_only(action) {
        required_inputs.push(ActionInputKind::OperationId);
    }
    if action_requires_session(action) {
        required_inputs.push(ActionInputKind::SessionId);
    }
    if confirmation_for(action).is_some() {
        required_inputs.push(ActionInputKind::Confirmation);
        if matches!(
            action,
            ActionKind::Cancel
                | ActionKind::Reopen
                | ActionKind::Retry
                | ActionKind::RevokeReview
                | ActionKind::RevokeException
                | ActionKind::WaiveDependency
                | ActionKind::ForceGate
                | ActionKind::ResolveHold
        ) {
            required_inputs.push(ActionInputKind::Reason);
            required_inputs.push(ActionInputKind::Comment);
        }
    }
    if matches!(action, ActionKind::AttachEvidence | ActionKind::Submit) {
        required_inputs.push(ActionInputKind::Evidence);
    }
    if matches!(action, ActionKind::FinishClose | ActionKind::Close) {
        required_inputs.push(ActionInputKind::Summary);
    }
    if matches!(action, ActionKind::Review) {
        required_inputs.push(ActionInputKind::ReviewDecision);
    }
    if matches!(action, ActionKind::Recover | ActionKind::ReconcileResource) {
        required_inputs.push(ActionInputKind::RecoveryDisposition);
    }
    required_inputs.sort();
    required_inputs.dedup();

    ActionDescriptor {
        action,
        target: input.facts.subject.clone(),
        expected_project_revision: input.facts.snapshot_revision,
        expected_entity_revision: input.facts.subject.revision,
        expected_proof_revision,
        attempt,
        required_roles: required_roles(input, action),
        required_inputs,
        confirmation,
        read_only: is_read_only(action),
        recovery: is_recovery_action(action),
    }
}

fn deny_reason(
    input: &ActionEvaluationInput<'_>,
    descriptor: &ActionDescriptor,
    request: &ActionRequest,
) -> Option<ActionDenialReason> {
    let facts = input.facts;
    let authority = match authority(facts) {
        Ok(authority) => authority,
        Err(reason) => return Some(reason),
    };

    if request.action != descriptor.action
        || request.target.project_id != facts.subject.project_id
        || request.target.work_id != facts.subject.work_id
    {
        return Some(ActionDenialReason::ScopeMismatch);
    }
    if request.target.revision != facts.subject.revision {
        return Some(ActionDenialReason::StaleEntity {
            expected: facts.subject.revision,
            observed: request.target.revision,
        });
    }
    if request.expected_project_revision != facts.snapshot_revision {
        return Some(ActionDenialReason::StaleSnapshot {
            expected: facts.snapshot_revision,
            observed: request.expected_project_revision,
        });
    }
    if request.expected_proof_revision != descriptor.expected_proof_revision
        && action_requires_proof(request.action)
    {
        return Some(ActionDenialReason::StaleProof {
            expected: descriptor.expected_proof_revision,
            observed: request.expected_proof_revision,
        });
    }
    if action_requires_attempt(request.action) && request.attempt != descriptor.attempt {
        if descriptor.attempt.is_none() {
            return Some(ActionDenialReason::MissingAttempt);
        }
        return Some(ActionDenialReason::StaleFence {
            expected: descriptor.attempt.clone(),
            observed: request.attempt.clone(),
        });
    }

    let facts_valid = facts.validate().is_ok();
    let read_only = descriptor.read_only;
    if facts.availability != Availability::Live && !read_only {
        return Some(ActionDenialReason::AvailabilityUnavailable(
            facts.availability,
        ));
    }
    if facts.integrity.level == IntegrityLevel::Quarantined
        && !read_only
        && !matches!(request.action, ActionKind::Repair | ActionKind::Recover)
    {
        return Some(ActionDenialReason::IntegrityQuarantined);
    }
    if facts.integrity.level == IntegrityLevel::Degraded
        && !read_only
        && !is_recovery_action(request.action)
    {
        return Some(ActionDenialReason::IntegrityDegraded);
    }
    if !facts_valid && !read_only && request.action != ActionKind::Repair {
        return Some(ActionDenialReason::InvalidFacts);
    }

    let roles = &descriptor.required_roles;
    if !roles.is_empty() && !roles.contains(&authority.role) {
        return Some(ActionDenialReason::RoleDenied {
            required: roles.clone(),
            observed: authority.role,
        });
    }
    if matches!(
        authority.principal,
        PrincipalBinding::Delegated {
            ref actor_id,
            ref delegation_id,
            ref delegator_id,
        } if actor_id.as_str().is_empty()
            || delegation_id.as_str().is_empty()
            || delegator_id.as_str().is_empty()
    ) {
        return Some(ActionDenialReason::DelegationInvalid);
    }

    if matches!(
        request.action,
        ActionKind::StartAttempt
            | ActionKind::Checkpoint
            | ActionKind::AttachEvidence
            | ActionKind::Submit
    ) && !facts
        .execution
        .as_present()
        .is_some_and(|execution| execution.proof.is_bound())
        && !(request.action == ActionKind::AttachEvidence
            && facts
                .submission
                .as_present()
                .is_some_and(|submission| submission.proof.is_bound()))
    {
        return Some(ActionDenialReason::InvalidFacts);
    }

    if requires_attempt_owner(request.action) {
        let owner_session = facts
            .execution
            .as_present()
            .and_then(|execution| execution.session_id.as_ref())
            .or_else(|| {
                facts
                    .submission
                    .as_present()
                    .map(|submission| &submission.session_id)
            });
        if owner_session.is_some_and(|session| authority.session_id.as_ref() != Some(session)) {
            return Some(ActionDenialReason::AttemptOwnerMismatch);
        }
    }
    if action_requires_session(request.action) && authority.session_id.is_none() {
        return Some(ActionDenialReason::PolicyDenied);
    }

    if requires_attempt_owner(request.action)
        && current_attempt_actor(facts).is_none_or(|actor| actor != authority.actor_id())
    {
        return Some(ActionDenialReason::AttemptOwnerMismatch);
    }

    if let Some(reason) = hold_denial(input, request.action) {
        return Some(reason);
    }

    if let Some(policy_action) = mapped_permission(request.action) {
        if !facts.permitted_actions.allowed.contains(&policy_action)
            || facts
                .permitted_actions
                .denied
                .iter()
                .any(|denied| denied.action == policy_action)
        {
            return Some(ActionDenialReason::PolicyDenied);
        }
    }

    status_denial(input, request.action, authority.actor_id())
}

fn authority(facts: &DecisionInputs) -> Result<&ActorAuthorityInput, ActionDenialReason> {
    let authority = match &facts.authority {
        Fact::Present(authority) => authority,
        Fact::Absent { .. }
        | Fact::Unreadable { .. }
        | Fact::Stale { .. }
        | Fact::Failed { .. } => return Err(ActionDenialReason::Unauthenticated),
    };
    if authority.project_id != facts.subject.project_id || authority.actor_id().as_str().is_empty()
    {
        return Err(ActionDenialReason::ScopeMismatch);
    }
    Ok(authority)
}

fn current_proof_revision(facts: &DecisionInputs) -> Option<ProofRevision> {
    facts
        .requirements
        .as_present()
        .map(|requirements| requirements.proof.proof_revision)
        .or_else(|| {
            facts
                .execution
                .as_present()
                .map(|execution| execution.proof.proof_revision)
        })
        .or_else(|| {
            facts
                .submission
                .as_present()
                .map(|submission| submission.proof.proof_revision)
        })
        .or_else(|| {
            facts
                .review
                .as_present()
                .map(|review| review.proof.proof_revision)
        })
}

fn current_attempt(facts: &DecisionInputs) -> Option<AttemptIdentity> {
    facts
        .execution
        .as_present()
        .map(|execution| execution.attempt.clone())
        .or_else(|| {
            facts
                .submission
                .as_present()
                .and_then(|submission| submission.proof.attempt.clone())
        })
        .or_else(|| {
            facts
                .review
                .as_present()
                .and_then(|review| review.proof.attempt.clone())
        })
        .or_else(|| {
            facts
                .recovery
                .as_present()
                .map(|recovery| recovery.attempt.clone())
        })
}

fn current_attempt_actor(facts: &DecisionInputs) -> Option<&ActorId> {
    facts
        .execution
        .as_present()
        .map(|execution| &execution.actor_id)
        .or_else(|| {
            facts
                .submission
                .as_present()
                .map(|submission| &submission.actor_id)
        })
}

fn active_hold(facts: &DecisionInputs) -> Result<Option<&HoldInput>, ActionDenialReason> {
    let Some(holds) = facts.holds.as_present() else {
        return Ok(None);
    };
    let mut selected = None;
    for hold in &holds.holds {
        if hold.scope.project_id != facts.subject.project_id
            || hold.scope.work_id != facts.subject.work_id
        {
            return Err(ActionDenialReason::ScopeMismatch);
        }
        if hold.active && hold.entity_revision != facts.subject.revision {
            return Err(ActionDenialReason::StaleEntity {
                expected: facts.subject.revision,
                observed: hold.entity_revision,
            });
        }
        if hold.active
            && selected.is_none_or(|current: &HoldInput| {
                (&hold.id, &hold.code, hold.entity_revision)
                    < (&current.id, &current.code, current.entity_revision)
            })
        {
            selected = Some(hold);
        }
    }
    Ok(selected)
}

fn hold_denial(
    input: &ActionEvaluationInput<'_>,
    action: ActionKind,
) -> Option<ActionDenialReason> {
    let hold = match active_hold(input.facts) {
        Ok(hold) => hold,
        Err(reason) => return Some(reason),
    }?;
    if matches!(
        action,
        ActionKind::Inspect
            | ActionKind::ReadHistory
            | ActionKind::ReadOperation
            | ActionKind::Export
            | ActionKind::Stop
            | ActionKind::Release
            | ActionKind::Recover
            | ActionKind::ReconcileResource
            | ActionKind::ResolveHold
            | ActionKind::Repair
            | ActionKind::Review
            | ActionKind::RevokeReview
            | ActionKind::RevokeException
            | ActionKind::WaiveDependency
            | ActionKind::ForceGate
    ) {
        None
    } else {
        Some(ActionDenialReason::HoldActive(hold.code.clone()))
    }
}

fn status_denial(
    input: &ActionEvaluationInput<'_>,
    action: ActionKind,
    actor_id: &ActorId,
) -> Option<ActionDenialReason> {
    let facts = input.facts;
    let attempt = facts.execution.as_present();
    let status = input.status;
    match action {
        ActionKind::Inspect
        | ActionKind::ReadHistory
        | ActionKind::ReadOperation
        | ActionKind::Export => None,
        ActionKind::Publish if status == DerivedStatus::Draft => None,
        ActionKind::Publish => Some(ActionDenialReason::StatusDenied(status)),
        ActionKind::Claim if facts.dispatch_policy == crate::DispatchPolicy::Paused => {
            Some(ActionDenialReason::PolicyDenied)
        }
        ActionKind::Claim if status == DerivedStatus::Ready => None,
        ActionKind::Claim => Some(ActionDenialReason::StatusDenied(status)),
        ActionKind::AcceptAttempt => match attempt {
            Some(attempt) if attempt.phase == AttemptPhase::Claimed => None,
            Some(attempt) => Some(ActionDenialReason::AttemptPhaseDenied(attempt.phase)),
            None => Some(ActionDenialReason::MissingAttempt),
        },
        ActionKind::StartAttempt => match attempt {
            Some(attempt) if attempt.phase == AttemptPhase::Accepted => None,
            Some(attempt) => Some(ActionDenialReason::AttemptPhaseDenied(attempt.phase)),
            None => Some(ActionDenialReason::MissingAttempt),
        },
        ActionKind::AttachEvidence
            if facts.submission.as_present().is_some()
                && matches!(
                    status,
                    DerivedStatus::NeedsVerification
                        | DerivedStatus::AwaitingReview
                        | DerivedStatus::Blocked
                ) =>
        {
            None
        }
        ActionKind::Checkpoint | ActionKind::AttachEvidence => match attempt {
            Some(attempt)
                if matches!(
                    attempt.phase,
                    AttemptPhase::Running | AttemptPhase::Verifying
                ) && matches!(
                    status,
                    DerivedStatus::InProgress | DerivedStatus::NeedsVerification
                ) =>
            {
                None
            }
            Some(attempt) => Some(ActionDenialReason::AttemptPhaseDenied(attempt.phase)),
            None => Some(ActionDenialReason::MissingAttempt),
        },
        ActionKind::Submit => match attempt {
            Some(attempt) if attempt.phase == AttemptPhase::Running => None,
            Some(attempt) => Some(ActionDenialReason::AttemptPhaseDenied(attempt.phase)),
            None => Some(ActionDenialReason::MissingAttempt),
        },
        ActionKind::RequestReview
            if status == DerivedStatus::AwaitingReview
                && facts.submission.as_present().is_some() =>
        {
            None
        }
        ActionKind::RequestReview if facts.submission.as_present().is_none() => {
            Some(ActionDenialReason::MissingSubmission)
        }
        ActionKind::RequestReview => Some(ActionDenialReason::StatusDenied(status)),
        ActionKind::Review
            if matches!(
                status,
                DerivedStatus::AwaitingReview | DerivedStatus::Blocked
            ) && facts.submission.as_present().is_some() =>
        {
            if current_attempt_actor(facts).is_some_and(|owner| owner == actor_id)
                || facts.submission.as_present().is_some_and(|submission| {
                    facts.authority.as_present().is_some_and(|authority| {
                        authority.authority_root == submission.authority_root
                    })
                })
                || facts
                    .review
                    .as_present()
                    .is_some_and(|review| review.attempt_actor_id == *actor_id)
            {
                Some(ActionDenialReason::ReviewNotIndependent)
            } else {
                None
            }
        }
        ActionKind::Review => Some(ActionDenialReason::StatusDenied(status)),
        ActionKind::FinishClose
            if matches!(
                status,
                DerivedStatus::InProgress
                    | DerivedStatus::NeedsVerification
                    | DerivedStatus::AwaitingReview
                    | DerivedStatus::Complete
                    | DerivedStatus::Blocked
            ) && (status != DerivedStatus::Blocked
                || (!facts.review.as_present().is_some_and(|review| {
                    matches!(
                        review.outcome,
                        ReviewOutcome::Rejected | ReviewOutcome::Returned | ReviewOutcome::Revoked
                    )
                }) && (facts.execution.as_present().is_some_and(|attempt| {
                    matches!(
                        attempt.phase,
                        AttemptPhase::Running | AttemptPhase::Verifying
                    )
                }) || facts
                    .submission
                    .as_present()
                    .is_some_and(|submission| submission.state == SubmissionState::Sealed)))) =>
        {
            None
        }
        ActionKind::FinishClose => Some(ActionDenialReason::StatusDenied(status)),
        ActionKind::Close
            if status == DerivedStatus::Complete && facts.submission.as_present().is_some() =>
        {
            None
        }
        ActionKind::Close if status == DerivedStatus::Complete => {
            Some(ActionDenialReason::MissingSubmission)
        }
        ActionKind::Close => Some(ActionDenialReason::StatusDenied(status)),
        ActionKind::Stop if attempt.is_some() || unresolved_recovery(facts) => None,
        ActionKind::Stop => Some(ActionDenialReason::RecoveryRequired),
        ActionKind::Release if attempt.is_some() => None,
        ActionKind::Release => Some(ActionDenialReason::MissingAttempt),
        ActionKind::PausePolicy
            if !matches!(status, DerivedStatus::Closed | DerivedStatus::Cancelled) =>
        {
            None
        }
        ActionKind::PausePolicy => Some(ActionDenialReason::StatusDenied(status)),
        ActionKind::ResumePolicy
            if matches!(status, DerivedStatus::Paused | DerivedStatus::RetryWait) =>
        {
            None
        }
        ActionKind::ResumePolicy => Some(ActionDenialReason::StatusDenied(status)),
        ActionKind::Cancel
            if !matches!(status, DerivedStatus::Closed | DerivedStatus::Cancelled) =>
        {
            None
        }
        ActionKind::Cancel => Some(ActionDenialReason::StatusDenied(status)),
        ActionKind::Reopen
            if matches!(status, DerivedStatus::Closed | DerivedStatus::Cancelled) =>
        {
            None
        }
        ActionKind::Reopen => Some(ActionDenialReason::StatusDenied(status)),
        ActionKind::Retry
            if !matches!(
                status,
                DerivedStatus::Closed | DerivedStatus::Cancelled | DerivedStatus::Draft
            ) && facts.execution.as_present().is_none()
                && !unresolved_recovery(facts) =>
        {
            None
        }
        ActionKind::Retry => Some(ActionDenialReason::RecoveryRequired),
        ActionKind::RevokeReview
            if facts.submission.as_present().is_some() && facts.review.as_present().is_some() =>
        {
            if facts.submission.as_present().is_some_and(|submission| {
                facts
                    .authority
                    .as_present()
                    .is_some_and(|authority| authority.authority_root == submission.authority_root)
            }) {
                Some(ActionDenialReason::ReviewNotIndependent)
            } else {
                None
            }
        }
        ActionKind::RevokeReview => Some(ActionDenialReason::MissingSubmission),
        ActionKind::RevokeException if facts.requirements.as_present().is_some() => None,
        ActionKind::RevokeException => Some(ActionDenialReason::InvalidFacts),
        ActionKind::ResolveHold if active_hold(facts).ok().flatten().is_some() => None,
        ActionKind::ResolveHold => Some(ActionDenialReason::NoActiveHold),
        ActionKind::WaiveDependency
            if matches!(status, DerivedStatus::Queued | DerivedStatus::Blocked)
                && facts.dependencies.as_present().is_some() =>
        {
            None
        }
        ActionKind::WaiveDependency => Some(ActionDenialReason::StatusDenied(status)),
        ActionKind::ForceGate
            if matches!(
                status,
                DerivedStatus::Blocked | DerivedStatus::NeedsVerification
            ) && facts.requirements.as_present().is_some() =>
        {
            None
        }
        ActionKind::ForceGate => Some(ActionDenialReason::StatusDenied(status)),
        ActionKind::Recover
            if status == DerivedStatus::ExpiredReview || unresolved_recovery(facts) =>
        {
            None
        }
        ActionKind::Recover => Some(ActionDenialReason::RecoveryRequired),
        ActionKind::ReconcileResource if facts.recovery.as_present().is_some() => None,
        ActionKind::ReconcileResource => Some(ActionDenialReason::RecoveryRequired),
        ActionKind::Repair
            if facts.integrity.level != IntegrityLevel::Valid || facts.validate().is_err() =>
        {
            None
        }
        ActionKind::Repair => Some(ActionDenialReason::ActionNotApplicable),
    }
}

fn unresolved_recovery(facts: &DecisionInputs) -> bool {
    facts
        .recovery
        .as_present()
        .is_some_and(|recovery| recovery.unresolved)
}

fn required_roles(input: &ActionEvaluationInput<'_>, action: ActionKind) -> Vec<ActorRole> {
    match action {
        ActionKind::Inspect
        | ActionKind::ReadHistory
        | ActionKind::ReadOperation
        | ActionKind::Export => Vec::new(),
        ActionKind::Publish => vec![ActorRole::Publisher, ActorRole::Operator],
        ActionKind::Claim if input.facts.dispatch_policy == crate::DispatchPolicy::OperatorOnly => {
            vec![ActorRole::Operator]
        }
        // Claim authority is bound to canonical dispatch policy, not a reason
        // label that could be stale or independently constructed.
        ActionKind::Claim => vec![ActorRole::Agent],
        ActionKind::AcceptAttempt
        | ActionKind::StartAttempt
        | ActionKind::Checkpoint
        | ActionKind::AttachEvidence
        | ActionKind::Submit
        | ActionKind::RequestReview
        | ActionKind::FinishClose
        | ActionKind::Close => vec![ActorRole::Agent, ActorRole::Operator],
        ActionKind::Review | ActionKind::RevokeReview => {
            vec![ActorRole::Reviewer, ActorRole::Operator]
        }
        ActionKind::Stop | ActionKind::Release | ActionKind::Recover => {
            vec![ActorRole::Agent, ActorRole::Operator]
        }
        ActionKind::PausePolicy
        | ActionKind::ResumePolicy
        | ActionKind::Cancel
        | ActionKind::Reopen
        | ActionKind::Retry
        | ActionKind::RevokeException
        | ActionKind::ResolveHold
        | ActionKind::WaiveDependency
        | ActionKind::ForceGate
        | ActionKind::ReconcileResource
        | ActionKind::Repair => vec![ActorRole::Operator],
    }
}

fn mapped_permission(action: ActionKind) -> Option<PermittedAction> {
    Some(match action {
        ActionKind::Inspect
        | ActionKind::ReadHistory
        | ActionKind::ReadOperation
        | ActionKind::Export => PermittedAction::Inspect,
        ActionKind::Claim => PermittedAction::Claim,
        ActionKind::AcceptAttempt => PermittedAction::AcceptAttempt,
        ActionKind::StartAttempt => PermittedAction::ResumeAttempt,
        ActionKind::Checkpoint | ActionKind::AttachEvidence => PermittedAction::AttachEvidence,
        ActionKind::Submit => PermittedAction::Submit,
        ActionKind::RequestReview | ActionKind::Review | ActionKind::RevokeReview => {
            PermittedAction::Review
        }
        ActionKind::FinishClose | ActionKind::Close => PermittedAction::Finish,
        ActionKind::Release => PermittedAction::Release,
        ActionKind::Stop | ActionKind::Recover | ActionKind::ReconcileResource => {
            PermittedAction::Recover
        }
        ActionKind::ResolveHold => PermittedAction::ResolveHold,
        ActionKind::Repair => PermittedAction::Repair,
        ActionKind::Publish
        | ActionKind::PausePolicy
        | ActionKind::ResumePolicy
        | ActionKind::Cancel
        | ActionKind::Reopen
        | ActionKind::Retry
        | ActionKind::RevokeException
        | ActionKind::WaiveDependency
        | ActionKind::ForceGate => return None,
    })
}

fn is_read_only(action: ActionKind) -> bool {
    matches!(
        action,
        ActionKind::Inspect
            | ActionKind::ReadHistory
            | ActionKind::ReadOperation
            | ActionKind::Export
    )
}

fn is_recovery_action(action: ActionKind) -> bool {
    matches!(
        action,
        ActionKind::Stop
            | ActionKind::Release
            | ActionKind::ResolveHold
            | ActionKind::Recover
            | ActionKind::ReconcileResource
            | ActionKind::Repair
            | ActionKind::Review
            | ActionKind::RevokeReview
            | ActionKind::RevokeException
            | ActionKind::WaiveDependency
            | ActionKind::ForceGate
    )
}

fn action_requires_attempt(action: ActionKind) -> bool {
    matches!(
        action,
        ActionKind::AcceptAttempt
            | ActionKind::StartAttempt
            | ActionKind::Checkpoint
            | ActionKind::AttachEvidence
            | ActionKind::Submit
            | ActionKind::RequestReview
            | ActionKind::Review
            | ActionKind::FinishClose
            | ActionKind::Close
            | ActionKind::Stop
            | ActionKind::Release
            | ActionKind::Recover
            | ActionKind::ReconcileResource
    )
}

fn action_requires_proof(action: ActionKind) -> bool {
    matches!(
        action,
        ActionKind::Checkpoint
            | ActionKind::AttachEvidence
            | ActionKind::Submit
            | ActionKind::RequestReview
            | ActionKind::Review
            | ActionKind::FinishClose
            | ActionKind::Close
            | ActionKind::ForceGate
            | ActionKind::RevokeReview
            | ActionKind::RevokeException
            | ActionKind::Retry
            | ActionKind::Reopen
            | ActionKind::WaiveDependency
    )
}

fn action_requires_session(action: ActionKind) -> bool {
    // Every consequential work action is committed through a project-scoped
    // session at the store boundary. Keep read-only discovery available to
    // callers without one, but never advertise a mutation the transaction
    // will reject for missing authenticated session context.
    !is_read_only(action)
}

fn requires_attempt_owner(action: ActionKind) -> bool {
    matches!(
        action,
        ActionKind::AcceptAttempt
            | ActionKind::StartAttempt
            | ActionKind::Checkpoint
            | ActionKind::AttachEvidence
            | ActionKind::Submit
            | ActionKind::RequestReview
            | ActionKind::FinishClose
            | ActionKind::Close
            | ActionKind::Stop
            | ActionKind::Release
    )
}

fn confirmation_for(action: ActionKind) -> Option<&'static str> {
    Some(match action {
        ActionKind::Publish => "Publish this work for execution?",
        ActionKind::FinishClose => "Submit the close intent for this exact proof context?",
        ActionKind::Close => "Finalize accepted closeout for this exact proof context?",
        ActionKind::Stop => "Request a safe stop and retain recovery history?",
        ActionKind::Release => "Release the current attempt without asserting success?",
        ActionKind::PausePolicy => "Pause dispatch for this work item?",
        ActionKind::ResumePolicy => "Resume the previously configured dispatch policy?",
        ActionKind::Cancel => "Cancel this work item with an audited reason?",
        ActionKind::Reopen => "Reopen this terminal work item with an audited reason?",
        ActionKind::Retry => "Begin a new proof generation, preserving all prior results?",
        ActionKind::RevokeReview => "Revoke this exact review and invalidate its accepted outcome?",
        ActionKind::RevokeException => "Revoke this exception without deleting its history?",
        ActionKind::ResolveHold => "Resolve the named hold with an audited reason?",
        ActionKind::WaiveDependency => "Record a scoped dependency waiver?",
        ActionKind::ForceGate => "Record a scoped gate exception without altering evidence?",
        ActionKind::Recover => "Record or resolve the safe recovery disposition?",
        ActionKind::ReconcileResource => "Reconcile the external resource disposition?",
        ActionKind::Repair => "Repair or rebuild the affected projection?",
        _ => return None,
    })
}

fn recovery_routes(
    input: &ActionEvaluationInput<'_>,
    action: ActionKind,
    reason: &ActionDenialReason,
) -> Vec<ActionKind> {
    let mut routes = Vec::new();
    match reason {
        ActionDenialReason::StaleSnapshot { .. }
        | ActionDenialReason::StaleEntity { .. }
        | ActionDenialReason::StaleProof { .. }
        | ActionDenialReason::StaleFence { .. } => {
            routes.extend([ActionKind::Inspect, ActionKind::ReadOperation]);
        }
        ActionDenialReason::AvailabilityUnavailable(_) => {
            routes.extend([ActionKind::Inspect, ActionKind::ReadOperation]);
        }
        ActionDenialReason::IntegrityQuarantined
        | ActionDenialReason::IntegrityDegraded
        | ActionDenialReason::InvalidFacts => {
            routes.extend([ActionKind::Inspect, ActionKind::Export, ActionKind::Repair]);
        }
        ActionDenialReason::HoldActive(_) => {
            routes.extend([ActionKind::Inspect, ActionKind::ResolveHold]);
            if current_attempt(input.facts).is_some() {
                routes.push(ActionKind::Stop);
            }
        }
        ActionDenialReason::StatusDenied(DerivedStatus::Blocked)
        | ActionDenialReason::StatusDenied(DerivedStatus::ExpiredReview)
        | ActionDenialReason::RecoveryRequired => {
            routes.extend([
                ActionKind::Inspect,
                ActionKind::ReadHistory,
                ActionKind::Recover,
            ]);
            if current_attempt(input.facts).is_some() {
                routes.push(ActionKind::Stop);
            }
        }
        ActionDenialReason::RoleDenied { .. } | ActionDenialReason::Unauthenticated => {
            routes.extend([ActionKind::Inspect, ActionKind::ReadHistory]);
        }
        ActionDenialReason::MissingSubmission => {
            routes.extend([ActionKind::Inspect, ActionKind::AttachEvidence]);
        }
        ActionDenialReason::AttemptPhaseDenied(_) => {
            routes.extend([ActionKind::Inspect, ActionKind::ReadHistory]);
        }
        ActionDenialReason::ReviewNotIndependent => {
            routes.extend([ActionKind::Inspect, ActionKind::RequestReview]);
        }
        ActionDenialReason::NoActiveHold => routes.push(ActionKind::Inspect),
        ActionDenialReason::PolicyDenied
        | ActionDenialReason::ScopeMismatch
        | ActionDenialReason::DelegationInvalid
        | ActionDenialReason::ActionNotApplicable
        | ActionDenialReason::MissingAttempt
        | ActionDenialReason::AttemptOwnerMismatch
        | ActionDenialReason::StatusDenied(_) => {}
    }
    if action != ActionKind::Inspect && is_read_only(action) {
        routes.push(ActionKind::Inspect);
    }
    routes.sort();
    routes.dedup();
    routes
}
