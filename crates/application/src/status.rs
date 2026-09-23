//! Revisioned, derived work-status read models.
//!
//! The application layer owns projection assembly. Callers provide the
//! canonical rows read from a store at one revision and clock; this module
//! supplies the graph, attempt, gate, and pagination context to the pure
//! domain evaluators and never persists the resulting status.

use boreal_domain::work_model_v3::WorkSchedule;
use boreal_domain::{
    actions::{evaluate_actions, ActionDecision, ActionEvaluationInput},
    decision_inputs::{
        ActorAuthorityInput, Availability, DecisionInputs, EntityIdentity, EntityRevision,
        EvaluationClock, Fact, FactKind, FactSubject, HoldId, HoldInput, HoldsInput,
        IntegrityInput, IntegrityLevel, IntegrityScope, LifecycleInput, PermittedAction,
        PermittedActionsInput, PrincipalBinding, TerminalDecision,
    },
};
use boreal_domain::{
    dependency_satisfied, evaluate_rollup, evaluate_status, ActorContext, Attempt, CurrentAttempt,
    DependencyPolicy, DerivedStatus, GateId, GateKind, GateRequirement, GateState, Revision,
    RollupCounts, StatusContext, StatusDecision, TimestampMs, WorkId, WorkItem,
};
use boreal_store::{SqliteStore, StatusRecordDiagnostic, StatusWorkRecord};
use std::{collections::BTreeMap, fmt};

pub const STATUS_CONTRACT_VERSION: &str = "boreal.work-status/2";
pub const MAX_STATUS_ROWS: u64 = 1_000;

/// Canonical read inputs for one work item. The store adapter may populate
/// these from its read APIs; the derived fields are intentionally absent.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StatusWorkInput {
    pub work: WorkItem,
    pub retry_not_before: Option<TimestampMs>,
    /// Canonical calendar availability. This is never inferred from retry
    /// timing or from a presentation-layer field.
    pub schedule: Option<WorkSchedule>,
    /// Canonical cycle/assignment activation resolved by the store.
    pub activation_at: Option<TimestampMs>,
    pub current_attempt: Option<Attempt>,
    pub gates: Vec<GateRequirement>,
    pub gate_reasons: Vec<GateReason>,
}

impl StatusWorkInput {
    pub fn new(work: WorkItem) -> Self {
        let gates = work.acceptance_profile.gates.clone();
        Self {
            work,
            retry_not_before: None,
            schedule: None,
            activation_at: None,
            current_attempt: None,
            gates,
            gate_reasons: Vec::new(),
        }
    }
}

/// A retained reason attached to a gate read from the store, such as a failed
/// or rejected receipt. The domain evaluator still decides whether the gate
/// is a gap; this type only preserves diagnostic detail for clients.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GateReason {
    pub gate_id: GateId,
    pub receipt_id: Option<String>,
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DependencyInput {
    pub prerequisite_id: WorkId,
    pub dependent_id: WorkId,
    pub policy: DependencyPolicy,
}

impl DependencyInput {
    pub fn close_only(prerequisite_id: WorkId, dependent_id: WorkId) -> Self {
        Self {
            prerequisite_id,
            dependent_id,
            policy: DependencyPolicy::ClosedOnly,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DependencyBlocker {
    pub work_id: WorkId,
    pub display_status: DerivedStatus,
    pub satisfies_default: bool,
    pub policy: DependencyPolicy,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GateDiagnostic {
    pub gate_id: GateId,
    pub kind: GateKind,
    pub required: bool,
    pub state: GateState,
    pub receipt_id: Option<String>,
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GateDiagnostics {
    pub gates: Vec<GateDiagnostic>,
    pub missing: Vec<GateId>,
}

impl GateDiagnostics {
    fn from_input(input: &StatusWorkInput) -> Self {
        let mut gates = input
            .gates
            .iter()
            .map(|gate| {
                let detail = input
                    .gate_reasons
                    .iter()
                    .find(|detail| detail.gate_id == gate.id);
                GateDiagnostic {
                    gate_id: gate.id.clone(),
                    kind: gate.kind,
                    required: gate.required,
                    state: gate.state,
                    receipt_id: detail.and_then(|detail| detail.receipt_id.clone()),
                    reason: detail.and_then(|detail| detail.reason.clone()),
                }
            })
            .collect::<Vec<_>>();
        gates.sort_by(|left, right| left.gate_id.cmp(&right.gate_id));
        let missing = gates
            .iter()
            .filter(|gate| gate.required && gate.state != GateState::Satisfied)
            .map(|gate| gate.gate_id.clone())
            .collect();
        Self { gates, missing }
    }

    pub fn open(&self) -> Vec<&GateDiagnostic> {
        self.gates
            .iter()
            .filter(|gate| gate.state != GateState::Satisfied)
            .collect()
    }

    pub fn satisfied(&self) -> Vec<&GateDiagnostic> {
        self.gates
            .iter()
            .filter(|gate| gate.state == GateState::Satisfied)
            .collect()
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum StatusActionContext {
    /// The legacy status read does not yet carry the v3 identity/proof facts
    /// needed to authorize a mutating action.  This is deliberately distinct
    /// from a normal policy denial so clients can explain the unavailable
    /// action context and avoid presenting fabricated proof metadata.
    Unavailable { missing_facts: Vec<&'static str> },
}

impl StatusActionContext {
    pub fn state(&self) -> &'static str {
        "unavailable"
    }

    pub fn missing_facts(&self) -> &[&'static str] {
        match self {
            Self::Unavailable { missing_facts } => missing_facts,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StatusWork {
    pub work: WorkItem,
    pub decision: StatusDecision,
    /// Server-derived action policy for the same snapshot as `decision`.
    /// Adapters serialize this value; clients must not reconstruct action
    /// availability from display status or gate labels.
    pub actions: ActionDecision,
    pub action_context: StatusActionContext,
    pub attempt: Option<Attempt>,
    pub gates: GateDiagnostics,
    pub dependency_blockers: Vec<DependencyBlocker>,
}

impl StatusWork {
    /// Status/3 value retained in the domain decision for newer adapters.
    pub fn status3_display_status(&self) -> DerivedStatus {
        self.decision.display_status
    }

    /// Compatibility status exposed by this status/2 application read model.
    /// Scheduled work is queued for older consumers, but its typed
    /// `scheduled_start` reason and non-claimable action remain intact.
    pub fn display_status(&self) -> DerivedStatus {
        status2_display_status(self.decision.display_status)
    }

    pub fn current_attempt(&self) -> Option<&CurrentAttempt> {
        self.decision.current_attempt.as_ref()
    }

    /// Claimability exposed by the application contract is the canonical
    /// action decision, not the legacy status evaluator's independent hint.
    /// This closes the Operator/Agent mismatch at the adapter boundary while
    /// leaving the pure status policy unchanged.
    pub fn claimable_for_actor(&self) -> bool {
        self.actions
            .allows(boreal_domain::actions::ActionKind::Claim)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StatusSnapshot {
    pub contract_version: &'static str,
    pub project_id: boreal_domain::ProjectId,
    pub project_revision: Revision,
    pub as_of: TimestampMs,
    pub limit: u64,
    pub offset: u64,
    pub total: u64,
    pub counts: RollupCounts,
    pub items: Vec<StatusWork>,
    pub diagnostics: Vec<StatusRecordDiagnostic>,
    pub next_status_change_at: Option<TimestampMs>,
}

impl StatusSnapshot {
    pub fn has_more(&self) -> bool {
        self.offset
            .saturating_add(self.items.len() as u64)
            .saturating_add(self.diagnostics.len() as u64)
            < self.total
    }

    pub fn next_offset(&self) -> Option<u64> {
        self.has_more()
            .then(|| self.offset.saturating_add(self.items.len() as u64))
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum StatusProjectionError {
    InvalidPage { limit: u64, max: u64 },
    DuplicateWork(WorkId),
    WrongProject { work: WorkId },
    MissingWork(WorkId),
    WrongDependencyProject { dependent: WorkId },
}

impl fmt::Display for StatusProjectionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidPage { limit, max } => {
                write!(
                    formatter,
                    "status page limit must be 1..={max}, got {limit}"
                )
            }
            Self::DuplicateWork(work) => write!(formatter, "duplicate work row: {work}"),
            Self::WrongProject { work } => {
                write!(formatter, "work belongs to another project: {work}")
            }
            Self::MissingWork(work) => {
                write!(formatter, "dependency references missing work: {work}")
            }
            Self::WrongDependencyProject { dependent } => {
                write!(
                    formatter,
                    "dependency belongs to another project: {dependent}"
                )
            }
        }
    }
}

impl std::error::Error for StatusProjectionError {}

/// Materialize a complete revisioned status snapshot, then apply pagination.
/// Rollup counts and the snapshot timer are deliberately calculated before
/// pagination so a small page never reports a false project total.
#[allow(clippy::too_many_arguments)]
pub fn project_status(
    project_id: &boreal_domain::ProjectId,
    actor: &ActorContext,
    as_of: TimestampMs,
    project_revision: Revision,
    inputs: &[StatusWorkInput],
    dependencies: &[DependencyInput],
    limit: u64,
    offset: u64,
) -> Result<StatusSnapshot, StatusProjectionError> {
    if !(1..=MAX_STATUS_ROWS).contains(&limit) {
        return Err(StatusProjectionError::InvalidPage {
            limit,
            max: MAX_STATUS_ROWS,
        });
    }

    let mut by_id = BTreeMap::new();
    for (index, input) in inputs.iter().enumerate() {
        if &input.work.project_id != project_id {
            return Err(StatusProjectionError::WrongProject {
                work: input.work.id.clone(),
            });
        }
        if by_id.insert(input.work.id.clone(), index).is_some() {
            return Err(StatusProjectionError::DuplicateWork(input.work.id.clone()));
        }
    }

    let mut prerequisites = vec![Vec::<(usize, DependencyPolicy)>::new(); inputs.len()];
    let mut affected_dependents = vec![Vec::<WorkId>::new(); inputs.len()];
    for dependency in dependencies {
        let Some(&dependent_index) = by_id.get(&dependency.dependent_id) else {
            return Err(StatusProjectionError::MissingWork(
                dependency.dependent_id.clone(),
            ));
        };
        let Some(&prerequisite_index) = by_id.get(&dependency.prerequisite_id) else {
            return Err(StatusProjectionError::MissingWork(
                dependency.prerequisite_id.clone(),
            ));
        };
        if inputs[dependent_index].work.project_id != *project_id
            || inputs[prerequisite_index].work.project_id != *project_id
        {
            return Err(StatusProjectionError::WrongDependencyProject {
                dependent: dependency.dependent_id.clone(),
            });
        }
        prerequisites[dependent_index].push((prerequisite_index, dependency.policy));
        affected_dependents[prerequisite_index].push(dependency.dependent_id.clone());
    }
    for dependents in &mut affected_dependents {
        dependents.sort();
        dependents.dedup();
    }

    let mut all = Vec::with_capacity(inputs.len());
    for (index, input) in inputs.iter().enumerate() {
        let prerequisite_rows = prerequisites[index]
            .iter()
            .filter(|(_, policy)| matches!(policy, DependencyPolicy::ClosedOnly))
            .map(|(prerequisite_index, _)| inputs[*prerequisite_index].work.clone())
            .collect::<Vec<_>>();
        let decision = evaluate_status(StatusContext {
            work: &input.work,
            prerequisites: &prerequisite_rows,
            current_attempt: input.current_attempt.as_ref(),
            gates: &input.gates,
            actor,
            as_of,
            project_revision,
            retry_not_before: input.retry_not_before,
            schedule: input.schedule,
            activation_at: input.activation_at,
            affected_dependents: &affected_dependents[index],
        });
        all.push(decision);
    }

    let decisions = all.to_vec();
    let counts = status2_rollup(&decisions);
    let next_status_change_at = decisions
        .iter()
        .filter_map(|decision| decision.next_status_change_at)
        .min();

    let mut order = (0..inputs.len()).collect::<Vec<_>>();
    order.sort_by(|left, right| inputs[*left].work.id.cmp(&inputs[*right].work.id));
    let total = order.len() as u64;
    let items = order
        .into_iter()
        .skip(offset as usize)
        .take(limit as usize)
        .map(|index| {
            let dependency_blockers = prerequisites[index]
                .iter()
                .filter_map(|(prerequisite_index, policy)| {
                    let prerequisite = &inputs[*prerequisite_index];
                    (!dependency_satisfied(*policy, &prerequisite.work)).then(|| {
                        DependencyBlocker {
                            work_id: prerequisite.work.id.clone(),
                            display_status: status2_display_status(
                                all[*prerequisite_index].display_status,
                            ),
                            satisfies_default: dependency_satisfied(
                                DependencyPolicy::ClosedOnly,
                                &prerequisite.work,
                            ),
                            policy: *policy,
                        }
                    })
                })
                .collect::<Vec<_>>();
            let (action_context, actions) =
                status_actions(&inputs[index], actor, project_revision, as_of, &all[index]);
            StatusWork {
                work: inputs[index].work.clone(),
                decision: all[index].clone(),
                actions,
                action_context,
                attempt: inputs[index].current_attempt.clone(),
                gates: GateDiagnostics::from_input(&inputs[index]),
                dependency_blockers,
            }
        })
        .collect::<Vec<_>>();

    Ok(StatusSnapshot {
        contract_version: STATUS_CONTRACT_VERSION,
        project_id: project_id.clone(),
        project_revision,
        as_of,
        limit,
        offset,
        total,
        counts,
        items,
        diagnostics: Vec::new(),
        next_status_change_at,
    })
}

pub use project_status as project_status_snapshot;

/// Convenience constructor for callers that have only a work item and want
/// its declared acceptance profile to supply the initial gate rows.
pub fn status_input(work: WorkItem) -> StatusWorkInput {
    StatusWorkInput::new(work)
}

/// Assemble the application projection from one store-owned, revisioned read.
/// The store supplies canonical rows; this function performs only pure
/// derivation and pagination, so status reads never write or advance a clock.
pub fn project_status_from_store(
    store: &SqliteStore,
    project_id: &boreal_domain::ProjectId,
    actor: &ActorContext,
    as_of: TimestampMs,
    limit: u64,
    offset: u64,
) -> Result<StatusSnapshot, String> {
    let (persisted, authorized_actor) = store
        .read_project_status_for_actor(project_id.as_str(), actor.actor_id.as_str())
        .map_err(|error| error.to_string())?;
    let mut diagnostics = persisted.diagnostics.clone();
    let mut inputs = Vec::with_capacity(persisted.works.len());
    for row in &persisted.works {
        match status_input_from_store_row(row) {
            Ok(input) => inputs.push(input),
            Err(detail) => diagnostics.push(StatusRecordDiagnostic {
                work_id: row.work.id.to_string(),
                title: Some(row.work.title.clone()),
                code: "corrupt_record".to_owned(),
                detail,
            }),
        }
    }
    let known_work = inputs
        .iter()
        .map(|input| input.work.id.clone())
        .collect::<std::collections::BTreeSet<_>>();
    let dependencies = persisted
        .dependencies
        .iter()
        .filter_map(|edge| {
            if known_work.contains(&edge.prerequisite_id)
                && known_work.contains(&edge.dependent_id)
            {
                Some(DependencyInput {
                    prerequisite_id: edge.prerequisite_id.clone(),
                    dependent_id: edge.dependent_id.clone(),
                    policy: edge.policy,
                })
            } else {
                diagnostics.push(StatusRecordDiagnostic {
                    work_id: edge.dependent_id.to_string(),
                    title: None,
                    code: "orphaned_dependency".to_owned(),
                    detail: format!(
                        "dependency references a work record that could not be read (prerequisite {})",
                        edge.prerequisite_id
                    ),
                });
                None
            }
        })
        .collect::<Vec<_>>();
    let mut snapshot = project_status(
        project_id,
        &authorized_actor,
        as_of,
        Revision(persisted.revision.0),
        &inputs,
        &dependencies,
        limit,
        offset,
    )
    .map_err(|error| error.to_string())?;
    snapshot.total = persisted.total;
    snapshot.diagnostics = diagnostics;
    Ok(snapshot)
}

fn status_input_from_store_row(row: &StatusWorkRecord) -> Result<StatusWorkInput, String> {
    let mut input = status_input(row.work.clone());
    input.retry_not_before = row
        .status_retry_not_before()
        .map_err(|error| error.to_string())?;
    input.schedule = row.schedule;
    input.activation_at = row.activation_at;
    input.gates = row
        .gate_diagnostics
        .gates
        .iter()
        .map(|gate| GateRequirement {
            id: gate.gate_id.clone().into(),
            kind: gate.kind,
            required: gate.required,
            state: gate.state,
        })
        .collect();
    input.gate_reasons = row
        .gate_diagnostics
        .gates
        .iter()
        .filter(|gate| gate.receipt_id.is_some() || gate.reason.is_some())
        .map(|gate| GateReason {
            gate_id: gate.gate_id.clone().into(),
            receipt_id: gate.receipt_id.clone(),
            reason: gate.reason.clone(),
        })
        .collect();
    input.current_attempt = row.status_attempt().map_err(|error| error.to_string())?;
    Ok(input)
}

fn status2_display_status(status: DerivedStatus) -> DerivedStatus {
    match status {
        DerivedStatus::Scheduled => DerivedStatus::Queued,
        other => other,
    }
}

fn status2_rollup(decisions: &[StatusDecision]) -> RollupCounts {
    let mut counts = evaluate_rollup(decisions);
    counts.queued = counts.queued.saturating_add(counts.scheduled);
    counts.scheduled = 0;
    counts
}

/// Bridge the legacy status rows into the domain-owned action evaluator.
///
/// The v2 status store currently exposes a project snapshot but not the
/// separate entity/proof identity rows required by the production action
/// contract.  This adapter therefore carries the known actor, lifecycle,
/// holds and snapshot revision, while explicitly marking identity/proof facts
/// unavailable.  It never invents a passing receipt or
/// approval.  Once the identity read model is exposed by the store, this
/// function is the single replacement point for those optional facts.
fn status_actions(
    input: &StatusWorkInput,
    actor: &ActorContext,
    project_revision: Revision,
    as_of: TimestampMs,
    decision: &StatusDecision,
) -> (StatusActionContext, ActionDecision) {
    let subject = EntityIdentity::new(
        input.work.project_id.clone(),
        input.work.id.clone(),
        // The domain value is required to construct a quarantined input, but
        // this sentinel is never serialized or used to authorize a mutation.
        // The real entity cursor must come from the store identity seam.
        EntityRevision::new(0),
    );
    let fact_subject = FactSubject::work(input.work.project_id.clone(), input.work.id.clone());
    let lifecycle = match input.work.lifecycle {
        boreal_domain::PersistedLifecycle::Closed => {
            Some(TerminalDecision::Closed { decided_at: as_of })
        }
        boreal_domain::PersistedLifecycle::Cancelled => {
            Some(TerminalDecision::Cancelled { decided_at: as_of })
        }
        boreal_domain::PersistedLifecycle::Draft | boreal_domain::PersistedLifecycle::Open => None,
    };
    let holds = input
        .work
        .hard_holds
        .iter()
        .enumerate()
        .map(|(index, reason)| HoldInput {
            id: HoldId::new(format!("{}:status-hold:{index}", input.work.id)),
            scope: IntegrityScope::work(input.work.project_id.clone(), input.work.id.clone()),
            code: boreal_domain::decision_inputs::HoldCode::new(reason.stable_code()),
            entity_revision: subject.revision,
            active: true,
        })
        .collect();
    let facts = DecisionInputs {
        subject: subject.clone(),
        snapshot_revision: project_revision,
        clock: EvaluationClock::at(as_of),
        // This is a quarantined compatibility evaluation.  The domain
        // evaluator is still the only action policy, but its mutating result
        // must fail closed until the store supplies the missing v3 facts.
        availability: Availability::Unavailable,
        lifecycle: Fact::present(LifecycleInput {
            identity: subject.clone(),
            lifecycle: input.work.lifecycle,
            terminal_decision: lifecycle,
        }),
        authority: Fact::present(ActorAuthorityInput {
            project_id: input.work.project_id.clone(),
            role: actor.role,
            principal: PrincipalBinding::Authenticated {
                actor_id: actor.actor_id.clone(),
            },
            session_id: None,
        }),
        // The status projection already contains gate observations, but it
        // does not yet carry the immutable proof identity required by the v3
        // action model.  Keep this fact explicitly absent until the store
        // identity seam supplies it.
        requirements: Fact::optional_absent(FactKind::PinnedRequirements, fact_subject.clone()),
        dependencies: Fact::present(boreal_domain::decision_inputs::DependencyOutcomesInput {
            edges: Vec::new(),
        }),
        holds: Fact::present(HoldsInput { holds }),
        execution: Fact::optional_absent(FactKind::Execution, fact_subject.clone()),
        submission: Fact::optional_absent(FactKind::Submission, fact_subject.clone()),
        review: Fact::optional_absent(FactKind::Review, fact_subject.clone()),
        recovery: Fact::optional_absent(FactKind::Recovery, fact_subject),
        integrity: IntegrityInput {
            scope: IntegrityScope::work(input.work.project_id.clone(), input.work.id.clone()),
            level: IntegrityLevel::Degraded,
            diagnostics: Vec::new(),
        },
        permitted_actions: PermittedActionsInput::allowing([
            PermittedAction::Inspect,
            PermittedAction::Claim,
            PermittedAction::AcceptAttempt,
            PermittedAction::ResumeAttempt,
            PermittedAction::AttachEvidence,
            PermittedAction::Submit,
            PermittedAction::Review,
            PermittedAction::Finish,
            PermittedAction::Release,
            PermittedAction::Recover,
            PermittedAction::ResolveHold,
            PermittedAction::Repair,
        ]),
    };
    let context = StatusActionContext::Unavailable {
        missing_facts: vec!["entity_revision", "proof_identity", "authenticated_session"],
    };
    let actions = evaluate_actions(&ActionEvaluationInput::new(
        &facts,
        decision.display_status,
        &decision.reason_codes,
    ));
    (context, actions)
}

#[cfg(test)]
mod tests {
    use super::*;
    use boreal_domain::{AcceptanceProfile, ActorId, AttemptId, Fence, ReasonCode, WorkKind};

    fn actor() -> ActorContext {
        ActorContext {
            actor_id: ActorId::new("agent"),
            role: boreal_domain::ActorRole::Agent,
        }
    }

    fn operator() -> ActorContext {
        ActorContext {
            actor_id: ActorId::new("operator"),
            role: boreal_domain::ActorRole::Operator,
        }
    }

    fn work(id: &str) -> WorkItem {
        WorkItem::new("project".into(), id.into(), WorkKind::Task, None, id).open()
    }

    fn input(id: &str) -> StatusWorkInput {
        StatusWorkInput::new(work(id))
    }

    #[test]
    fn scheduled_domain_decision_maps_to_queued_for_status_two() {
        let mut scheduled = input("scheduled");
        scheduled.schedule = Some(WorkSchedule {
            not_before_at: Some(TimestampMs(100)),
            due_at: None,
            target_start_at: None,
            target_end_at: None,
        });
        scheduled.activation_at = Some(TimestampMs(120));

        let before_start = project_status(
            &"project".into(),
            &actor(),
            TimestampMs(50),
            Revision(7),
            &[scheduled.clone()],
            &[],
            10,
            0,
        )
        .unwrap();
        let before = &before_start.items[0];
        assert_eq!(before.status3_display_status(), DerivedStatus::Scheduled);
        assert_eq!(before.display_status(), DerivedStatus::Queued);
        assert_eq!(
            before.decision.primary_reason.stable_code(),
            "scheduled_start(100)"
        );
        assert!(!before.decision.claimable_for_actor);
        assert_eq!(before_start.counts.queued, 1);
        assert_eq!(before_start.counts.scheduled, 0);
        assert_eq!(before_start.next_status_change_at, Some(TimestampMs(100)));

        let at_work_start = project_status(
            &"project".into(),
            &actor(),
            TimestampMs(100),
            Revision(7),
            &[scheduled],
            &[],
            10,
            0,
        )
        .unwrap();
        let at = &at_work_start.items[0];
        assert_eq!(at.status3_display_status(), DerivedStatus::Scheduled);
        assert_eq!(at.display_status(), DerivedStatus::Queued);
        assert_eq!(
            at.decision.primary_reason.stable_code(),
            "scheduled_start(120)"
        );
        assert!(!at.decision.claimable_for_actor);
        assert_eq!(at_work_start.next_status_change_at, Some(TimestampMs(120)));
    }

    #[test]
    fn store_row_planning_facts_reach_the_domain_context() {
        let work_item = work("stored-scheduled");
        let gate_rows = work_item
            .acceptance_profile
            .gates
            .iter()
            .map(|gate| boreal_store::GateDiagnostic {
                gate_id: gate.id.to_string(),
                kind: gate.kind,
                required: gate.required,
                state: GateState::Open,
                receipt_id: None,
                reason: None,
            })
            .collect();
        let row = StatusWorkRecord {
            work: work_item,
            retry_not_before: None,
            schedule: Some(WorkSchedule {
                not_before_at: Some(TimestampMs(80)),
                due_at: None,
                target_start_at: None,
                target_end_at: None,
            }),
            activation_at: Some(TimestampMs(120)),
            current_attempt: None,
            gate_diagnostics: boreal_store::GateDiagnostics {
                project_id: "project".to_owned(),
                work_id: "stored-scheduled".to_owned(),
                attempt_id: None,
                fence: None,
                revision: 3,
                gates: gate_rows,
                missing: Vec::new(),
            },
        };
        let input = status_input_from_store_row(&row).expect("canonical planning facts decode");
        assert_eq!(input.schedule, row.schedule);
        assert_eq!(input.activation_at, row.activation_at);

        let snapshot = project_status(
            &"project".into(),
            &actor(),
            TimestampMs(10),
            Revision(3),
            &[input],
            &[],
            10,
            0,
        )
        .unwrap();
        assert_eq!(
            snapshot.items[0].decision.primary_reason.stable_code(),
            "scheduled_start(80)"
        );
        assert!(!snapshot.items[0].decision.claimable_for_actor);
    }

    #[test]
    fn queued_and_blocked_remain_distinct() {
        let mut held = input("blocked");
        held.work
            .hard_holds
            .push(ReasonCode::HardHold("repair".into()));
        let snapshot = project_status(
            &"project".into(),
            &actor(),
            TimestampMs(10),
            Revision(7),
            &[input("ready"), held, input("upstream")],
            &[DependencyInput::close_only(
                "upstream".into(),
                "ready".into(),
            )],
            10,
            0,
        )
        .unwrap();
        assert_eq!(snapshot.counts.queued, 1);
        assert_eq!(snapshot.counts.blocked, 1);
        let queued = snapshot
            .items
            .iter()
            .find(|item| item.work.id.as_str() == "ready")
            .unwrap();
        assert_eq!(queued.display_status(), DerivedStatus::Queued);
        assert_eq!(queued.dependency_blockers[0].work_id.as_str(), "upstream");
    }

    #[test]
    fn public_claimability_uses_the_canonical_action_decision() {
        let snapshot = project_status(
            &"project".into(),
            &operator(),
            TimestampMs(10),
            Revision(7),
            &[input("ordinary")],
            &[],
            10,
            0,
        )
        .unwrap();
        let item = &snapshot.items[0];
        assert_eq!(item.decision.display_status, DerivedStatus::Ready);
        assert!(item.decision.claimable_for_actor);
        assert!(!item.claimable_for_actor());
        assert!(!item
            .actions
            .allows(boreal_domain::actions::ActionKind::Claim));
        assert_eq!(
            item.actions
                .denial(boreal_domain::actions::ActionKind::Claim)
                .expect("operator denial")
                .reason
                .stable_code(),
            "availability_unavailable"
        );
    }

    #[test]
    fn attempt_phases_map_to_claimed_and_in_progress() {
        let claimed = Attempt::claim(
            "claimed".into(),
            AttemptId::new("a-claimed"),
            "agent".into(),
            Fence::new(1),
            TimestampMs(0),
            Some(100),
            Some(1_000),
        )
        .unwrap();
        let mut running = Attempt::claim(
            "running".into(),
            AttemptId::new("a-running"),
            "agent".into(),
            Fence::new(1),
            TimestampMs(0),
            Some(100),
            Some(1_000),
        )
        .unwrap();
        running.accept(TimestampMs(1)).unwrap();
        running.start().unwrap();
        let mut claimed_input = input("claimed");
        claimed_input.current_attempt = Some(claimed);
        let mut running_input = input("running");
        running_input.current_attempt = Some(running);
        let snapshot = project_status(
            &"project".into(),
            &actor(),
            TimestampMs(10),
            Revision(2),
            &[claimed_input, running_input],
            &[],
            10,
            0,
        )
        .unwrap();
        assert_eq!(snapshot.counts.claimed, 1);
        assert_eq!(snapshot.counts.in_progress, 1);
        assert_eq!(
            snapshot.items[0].current_attempt().unwrap().fence,
            Fence::new(1)
        );
    }

    #[test]
    fn expired_attempt_and_gate_diagnostics_are_retained() {
        let mut expired = input("expired");
        expired.current_attempt = Some(
            Attempt::claim(
                "expired".into(),
                AttemptId::new("a-expired"),
                "agent".into(),
                Fence::new(3),
                TimestampMs(0),
                Some(10),
                Some(100),
            )
            .unwrap(),
        );
        expired.gate_reasons.push(GateReason {
            gate_id: GateId::new("checkpoint"),
            receipt_id: Some("receipt-1".into()),
            reason: Some("failed".into()),
        });
        let snapshot = project_status(
            &"project".into(),
            &actor(),
            TimestampMs(10),
            Revision(4),
            &[expired],
            &[],
            10,
            0,
        )
        .unwrap();
        let item = &snapshot.items[0];
        assert_eq!(item.display_status(), DerivedStatus::ExpiredReview);
        assert_eq!(
            item.decision.reason_codes[0],
            ReasonCode::ExpiryReviewRequired
        );
        assert_eq!(item.gates.gates[0].receipt_id.as_deref(), Some("receipt-1"));
        assert_eq!(item.gates.gates[0].reason.as_deref(), Some("failed"));
        assert_eq!(snapshot.next_status_change_at, None);
    }

    #[test]
    fn counts_cover_all_rows_when_page_is_bounded_and_timer_is_next() {
        let mut retry = input("retry");
        retry.retry_not_before = Some(TimestampMs(50));
        let snapshot = project_status(
            &"project".into(),
            &actor(),
            TimestampMs(10),
            Revision(9),
            &[input("a"), retry, input("c")],
            &[],
            1,
            1,
        )
        .unwrap();
        assert_eq!(snapshot.items.len(), 1);
        assert_eq!(snapshot.total, 3);
        assert_eq!(snapshot.counts.total, 3);
        assert_eq!(snapshot.counts.ready, 2);
        assert_eq!(snapshot.next_status_change_at, Some(TimestampMs(50)));
        assert!(snapshot.has_more());
        assert_eq!(snapshot.next_offset(), Some(2));
    }

    #[test]
    fn reviewed_gates_become_awaiting_review_and_open_gate_is_diagnostic() {
        let mut reviewed = work("reviewed");
        reviewed.acceptance_profile = AcceptanceProfile::reviewed();
        let mut item = StatusWorkInput::new(reviewed);
        for gate in &mut item.gates {
            if gate.kind != GateKind::Review {
                gate.state = GateState::Satisfied;
            }
        }
        let mut attempt = Attempt::claim(
            "reviewed".into(),
            AttemptId::new("a-reviewed"),
            "agent".into(),
            Fence::new(1),
            TimestampMs(0),
            Some(1_000),
            Some(2_000),
        )
        .unwrap();
        attempt.accept(TimestampMs(1)).unwrap();
        attempt.start().unwrap();
        attempt.submit().unwrap();
        item.current_attempt = Some(attempt);
        let snapshot = project_status(
            &"project".into(),
            &actor(),
            TimestampMs(2),
            Revision(11),
            &[item],
            &[],
            10,
            0,
        )
        .unwrap();
        assert_eq!(
            snapshot.items[0].display_status(),
            DerivedStatus::AwaitingReview
        );
        assert_eq!(snapshot.items[0].gates.missing, vec![GateId::new("review")]);
    }
}
