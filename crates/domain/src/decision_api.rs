//! Bound public status/action evaluation over one canonical snapshot.
//!
//! Legacy evaluators remain available for compatibility, but new projection
//! callers should use this paired API so action policy is always evaluated
//! from the status and reasons produced from the same facts.

use crate::{
    actions::{evaluate_actions, ActionDecision, ActionEvaluationInput},
    decision_inputs::{DecisionDiagnostic, DecisionInputs, FactKind},
    evaluate_canonical_status, Attempt, GateRequirement, StatusContext, StatusDecision,
};

/// A typed field whose independently supplied projection context disagreed
/// with the canonical snapshot.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DecisionContextMismatch {
    Subject,
    ProjectRevision,
    Clock,
    Lifecycle,
    Actor,
    AcceptanceProfile,
    GateRequirements,
    Dependencies,
    Execution,
    DispatchPolicy,
    Timing,
}

/// The status and action descriptors derived together from one validated
/// projection context.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DecisionActionView {
    pub status: StatusDecision,
    pub actions: ActionDecision,
}

/// Failure to bind caller-provided status context to its canonical facts.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DecisionApiError {
    MissingFact(FactKind),
    InvalidFacts(Vec<DecisionDiagnostic>),
    ContextMismatch(DecisionContextMismatch),
}

impl std::fmt::Display for DecisionApiError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MissingFact(fact) => write!(formatter, "canonical decision is missing {fact:?}"),
            Self::InvalidFacts(_) => formatter.write_str("canonical decision facts are invalid"),
            Self::ContextMismatch(field) => {
                write!(formatter, "decision context mismatch: {field:?}")
            }
        }
    }
}

impl std::error::Error for DecisionApiError {}

/// Evaluate status and all action descriptors as a single public decision.
///
/// The legacy status context carries some facts in a separate representation
/// from `DecisionInputs`. This function refuses to combine those values when
/// their subject, revision, clock, lifecycle, actor, profile, gates,
/// dependencies, dispatch policy, timing constraints, or current attempt
/// disagree. Application transactions must still reread these facts before
/// committing any requested mutation.
pub fn evaluate_decision_actions(
    context: StatusContext<'_>,
    facts: &DecisionInputs,
) -> Result<DecisionActionView, DecisionApiError> {
    validate_context(&context, facts)?;

    let mut status = evaluate_canonical_status(context, facts);
    let actions = evaluate_actions(&ActionEvaluationInput::new(
        facts,
        status.display_status,
        &status.reason_codes,
    ));
    // This legacy convenience bit must agree with the explicit action set.
    // The action descriptors are authoritative when integrity/availability
    // narrows forward progress without changing the product status label.
    status.claimable_for_actor = actions.allows(crate::actions::ActionKind::Claim);
    Ok(DecisionActionView { status, actions })
}

fn validate_context(
    context: &StatusContext<'_>,
    facts: &DecisionInputs,
) -> Result<(), DecisionApiError> {
    if context.work.project_id != facts.subject.project_id
        || context.work.id != facts.subject.work_id
    {
        return Err(mismatch(DecisionContextMismatch::Subject));
    }
    if context.project_revision != facts.snapshot_revision {
        return Err(mismatch(DecisionContextMismatch::ProjectRevision));
    }
    if context.as_of != facts.clock.evaluated_at {
        return Err(mismatch(DecisionContextMismatch::Clock));
    }
    if context.work.dispatch_policy != facts.dispatch_policy {
        return Err(mismatch(DecisionContextMismatch::DispatchPolicy));
    }
    if context.schedule != facts.clock.timing.schedule
        || context.activation_at != facts.clock.timing.cycle_activation_at
        || context.retry_not_before != facts.clock.timing.retry_not_before
    {
        return Err(mismatch(DecisionContextMismatch::Timing));
    }

    let lifecycle = facts
        .lifecycle
        .as_present()
        .ok_or(DecisionApiError::MissingFact(FactKind::Lifecycle))?;
    if lifecycle.identity != facts.subject || lifecycle.lifecycle != context.work.lifecycle {
        return Err(mismatch(DecisionContextMismatch::Lifecycle));
    }

    let authority = facts
        .authority
        .as_present()
        .ok_or(DecisionApiError::MissingFact(FactKind::ActorAuthority))?;
    if authority.project_id != facts.subject.project_id
        || authority.actor_id() != &context.actor.actor_id
        || authority.role != context.actor.role
    {
        return Err(mismatch(DecisionContextMismatch::Actor));
    }

    let requirements = facts
        .requirements
        .as_present()
        .ok_or(DecisionApiError::MissingFact(FactKind::PinnedRequirements))?;
    if requirements.proof.profile.profile_id != context.work.acceptance_profile.id
        || requirements.proof.profile.version != context.work.acceptance_profile.version
    {
        return Err(mismatch(DecisionContextMismatch::AcceptanceProfile));
    }

    let declared = requirements
        .requirements
        .iter()
        .map(|requirement| GateRequirement {
            id: requirement.gate_id.clone(),
            kind: requirement.kind,
            required: requirement.required,
            state: requirement.state,
        })
        .collect::<Vec<_>>();
    if !same_gates(&declared, &context.work.acceptance_profile.gates)
        || !same_gates(&declared, context.gates)
    {
        return Err(mismatch(DecisionContextMismatch::GateRequirements));
    }

    if let Some(dependencies) = facts.dependencies.as_present() {
        let mut expected = dependencies
            .edges
            .iter()
            .map(|edge| {
                (
                    edge.predecessor.project_id.clone(),
                    edge.predecessor.work_id.clone(),
                )
            })
            .collect::<Vec<_>>();
        let mut observed = context
            .prerequisites
            .iter()
            .map(|work| (work.project_id.clone(), work.id.clone()))
            .collect::<Vec<_>>();
        expected.sort();
        observed.sort();
        if expected != observed {
            return Err(mismatch(DecisionContextMismatch::Dependencies));
        }
    } else if !context.prerequisites.is_empty() {
        return Err(mismatch(DecisionContextMismatch::Dependencies));
    }

    if !same_current_attempt(context.current_attempt, facts, &facts.subject.work_id) {
        return Err(mismatch(DecisionContextMismatch::Execution));
    }

    // Keep a paired read available for degraded or structurally inconsistent
    // snapshots. Status evaluation surfaces their integrity state, and the
    // action evaluator denies unsafe mutations while retaining safe recovery
    // descriptors such as Inspect and Repair.
    Ok(())
}

fn mismatch(field: DecisionContextMismatch) -> DecisionApiError {
    DecisionApiError::ContextMismatch(field)
}

fn same_gates(left: &[GateRequirement], right: &[GateRequirement]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    let mut left = left.iter().collect::<Vec<_>>();
    let mut right = right.iter().collect::<Vec<_>>();
    left.sort_by(|a, b| a.id.cmp(&b.id));
    right.sort_by(|a, b| a.id.cmp(&b.id));
    left.iter().zip(right).all(|(left, right)| *left == right)
}

fn same_current_attempt(
    attempt: Option<&Attempt>,
    facts: &DecisionInputs,
    work_id: &crate::WorkId,
) -> bool {
    match (attempt, facts.execution.as_present()) {
        (None, None) => true,
        (Some(attempt), Some(execution)) => {
            attempt.work_id == *work_id
                && attempt.attempt_id == execution.attempt.attempt_id
                && attempt.fence.get() == execution.attempt.fence.get()
                && attempt.actor_id == execution.actor_id
                && attempt.session_id == execution.session_id
                && attempt.phase == execution.phase
                && attempt.claimed_at == execution.claimed_at
                && attempt.lease_deadline == execution.lease_deadline
                && attempt.max_attempt_deadline == execution.hard_deadline
        }
        _ => false,
    }
}
