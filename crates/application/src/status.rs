//! Revisioned, derived work-status read models.
//!
//! The application layer owns projection assembly. Callers provide the
//! canonical rows read from a store at one revision and clock; this module
//! supplies the graph, attempt, gate, and pagination context to the pure
//! domain evaluators and never persists the resulting status.

use boreal_domain::actions::ActionDecision;
use boreal_domain::work_model_v3::WorkSchedule;
use boreal_domain::{
    dependency_satisfied, evaluate_rollup, evaluate_status, ActorContext, Attempt, CurrentAttempt,
    DecisionApiError, DependencyPolicy, DerivedStatus, GateId, GateKind, GateRequirement,
    GateState, ReasonCode, Revision, RollupCounts, StatusContext, StatusDecision, TimestampMs,
    WorkId, WorkItem,
};
use boreal_store::{
    SqliteStore, StatusActionFacts, StatusActionFactsOrigin, StatusRecordDiagnostic,
    StatusWorkRecord,
};
use std::{collections::BTreeMap, fmt};

pub const STATUS_CONTRACT_VERSION: &str = "boreal.work-status/2";
pub const MAX_STATUS_ROWS: u64 = 1_000;
pub const MAX_ATTENTION_QUEUE_ITEMS: usize = 20;

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
    pub action_facts: Option<StatusActionFacts>,
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
            action_facts: None,
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
    /// The store supplied concrete revision/session/integrity observations.
    /// The action set remains absent while proof facts are incomplete.
    FactsRead {
        entity_revision: Option<u64>,
        proof_revision: Option<u64>,
        session_id: Option<String>,
        integrity: &'static str,
        missing_facts: Vec<String>,
    },
}

impl StatusActionContext {
    pub fn state(&self) -> &'static str {
        match self {
            Self::Unavailable { .. } => "unavailable",
            Self::FactsRead { missing_facts, .. } if missing_facts.is_empty() => "available",
            Self::FactsRead { .. } => "partial",
        }
    }

    pub fn missing_facts(&self) -> &[&'static str] {
        match self {
            Self::Unavailable { missing_facts } => missing_facts,
            Self::FactsRead { .. } => &[],
        }
    }

    pub fn missing_fact_names(&self) -> Vec<String> {
        match self {
            Self::Unavailable { missing_facts } => missing_facts
                .iter()
                .map(|value| (*value).to_owned())
                .collect(),
            Self::FactsRead { missing_facts, .. } => missing_facts.clone(),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StatusWork {
    pub canonical_inputs: Option<boreal_domain::decision_inputs::DecisionInputs>,
    pub work: WorkItem,
    pub decision: StatusDecision,
    /// Server-derived action policy for the same snapshot as `decision`.
    /// This is absent for legacy status rows until the store supplies the v3
    /// identity, proof, and authenticated-session facts. Adapters must never
    /// serialize a synthetic denied descriptor set.
    pub actions: Option<ActionDecision>,
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

    /// Legacy status rows still need to support no-goal discovery. Their
    /// readiness hint is not authorization, but it must not be replaced by a
    /// synthetic denial merely because the v3 action context is unavailable.
    /// Once a real action set is present, it is authoritative and fail-closed.
    pub fn claimable_for_actor(&self) -> bool {
        self.actions
            .as_ref()
            .map_or(self.decision.claimable_for_actor, |actions| {
                actions.allows(boreal_domain::actions::ActionKind::Claim)
            })
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StatusSnapshot {
    pub project_actions: Vec<boreal_domain::work_model_v3::ProjectPlanningAction>,
    /// Ordered physical row identities; permits byte-bounded pagination without losing corrupt rows.
    pub page_work_ids: Vec<String>,
    /// Physical rows consumed by this page; several diagnostics may refer to one row.
    pub page_count: u64,
    pub quarantined_count: u64,
    pub project_diagnostics: Vec<StatusRecordDiagnostic>,
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
    /// Service-backed attention queues computed from the complete canonical
    /// project read before pagination. Each queue carries an exact total and a
    /// bounded first page so a dashboard page cannot hide actionable work.
    pub attention_queues: AttentionQueues,
    pub next_status_change_at: Option<TimestampMs>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct AttentionQueues {
    pub review: AttentionQueue,
    pub rejected_review: AttentionQueue,
    pub expiry: AttentionQueue,
    pub failed_execution: AttentionQueue,
    pub operator_holds: AttentionQueue,
    pub damaged_planning: AttentionQueue,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct AttentionQueue {
    pub total: u64,
    pub items: Vec<AttentionQueueItem>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AttentionQueueItem {
    pub work_id: String,
    pub title: String,
    pub display_status: DerivedStatus,
    pub reason_codes: Vec<String>,
}

impl AttentionQueue {
    fn push(&mut self, item: AttentionQueueItem) {
        self.total = self.total.saturating_add(1);
        if self.items.len() < MAX_ATTENTION_QUEUE_ITEMS {
            self.items.push(item);
        }
    }
}

impl StatusSnapshot {
    pub fn has_more(&self) -> bool {
        self.offset.saturating_add(self.page_count) < self.total
    }

    pub fn next_offset(&self) -> Option<u64> {
        self.has_more()
            .then(|| self.offset.saturating_add(self.page_count))
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
    let mut all_actions = Vec::with_capacity(inputs.len());
    let mut all_action_contexts = Vec::with_capacity(inputs.len());
    let mut canonical_decisions_valid = Vec::with_capacity(inputs.len());
    for (index, input) in inputs.iter().enumerate() {
        let prerequisite_rows = prerequisites[index]
            .iter()
            .filter(|(_, policy)| matches!(policy, DependencyPolicy::ClosedOnly))
            .map(|(prerequisite_index, _)| inputs[*prerequisite_index].work.clone())
            .collect::<Vec<_>>();
        let context = StatusContext {
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
        };
        let canonical_inputs = input
            .action_facts
            .as_ref()
            .and_then(|facts| facts.canonical_inputs.as_ref());
        let (decision, actions, action_context, canonical_valid) = match canonical_inputs {
            Some(facts) => match boreal_domain::evaluate_decision_actions(context, facts) {
                Ok(view) => {
                    let invalid_facts = facts.validate().err();
                    let diagnostic = invalid_facts.as_ref().map(|diagnostics| {
                        format!("canonical_decision_invalid_facts:{}", diagnostics.len())
                    });
                    (
                        view.status,
                        Some(view.actions),
                        status_action_context(input, diagnostic.as_deref()),
                        invalid_facts.is_none(),
                    )
                }
                Err(error) => {
                    let diagnostic = decision_api_diagnostic(&error);
                    let safe_recovery = matches!(
                        error,
                        DecisionApiError::ContextMismatch(
                            boreal_domain::DecisionContextMismatch::Dependencies
                        )
                    )
                    .then(|| safe_recovery_actions(facts));
                    (
                        rejected_canonical_decision(
                            &input.work,
                            input.current_attempt.as_ref(),
                            &input.gates,
                            &affected_dependents[index],
                            as_of,
                            project_revision,
                        ),
                        // A damaged dependency projection invalidates ordinary
                        // actions, but identity-bound inspect/repair descriptors
                        // remain useful. Other context mismatches remain fully
                        // unavailable until refreshed.
                        safe_recovery,
                        status_action_context(input, Some(&diagnostic)),
                        false,
                    )
                }
            },
            // Compatibility is permitted only for rows explicitly sourced
            // from the schema-v2 adapter (or pure callers with no store facts).
            // A canonical row whose fact load failed must not be reinterpreted
            // by the legacy evaluator as if its missing authority were benign.
            None => match input.action_facts.as_ref().map(|facts| facts.origin) {
                None | Some(StatusActionFactsOrigin::LegacyCompatibility) => (
                    evaluate_status(context),
                    None,
                    status_action_context(input, None),
                    true,
                ),
                Some(StatusActionFactsOrigin::Canonical | StatusActionFactsOrigin::Unavailable) => {
                    let diagnostic = "canonical_decision_facts_unavailable";
                    (
                        rejected_canonical_decision(
                            &input.work,
                            input.current_attempt.as_ref(),
                            &input.gates,
                            &affected_dependents[index],
                            as_of,
                            project_revision,
                        ),
                        None,
                        status_action_context(input, Some(diagnostic)),
                        false,
                    )
                }
            },
        };
        all.push(decision);
        all_actions.push(actions);
        all_action_contexts.push(action_context);
        canonical_decisions_valid.push(canonical_valid);
    }

    let attention_queues = build_attention_queues(inputs, &all);

    let decisions = all.to_vec();
    let counts = if inputs.iter().any(|input| {
        input
            .action_facts
            .as_ref()
            .is_some_and(|facts| facts.canonical_inputs.is_some())
    }) {
        let healthy =
            inputs
                .iter()
                .zip(decisions.iter())
                .zip(canonical_decisions_valid.iter())
                .filter(|((input, _), canonical_valid)| {
                    input.action_facts.as_ref().is_some_and(|facts| {
                        facts.integrity == boreal_store::StatusIntegrity::Valid
                    }) && **canonical_valid
                })
                .map(|((_, decision), _)| decision.clone())
                .collect::<Vec<_>>();
        evaluate_rollup(&healthy)
    } else {
        status2_rollup(&decisions)
    };
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
                    let canonical = inputs[index].action_facts.as_ref()
                        .and_then(|facts| facts.canonical_inputs.as_ref())
                        .and_then(|facts| facts.dependencies.as_present());
                    let satisfied = canonical.map_or_else(
                        || dependency_satisfied(*policy, &prerequisite.work),
                        |facts| facts.edges.iter().find(|edge| edge.predecessor.work_id == prerequisite.work.id)
                            .is_some_and(|edge| edge.waiver.is_some() || edge.outcome == boreal_domain::decision_inputs::DependencyOutcome::Closed),
                    );
                    (!satisfied).then(|| {
                        DependencyBlocker {
                            work_id: prerequisite.work.id.clone(),
                            display_status: status2_display_status(
                                all[*prerequisite_index].display_status,
                            ),
                            satisfies_default: canonical.map_or_else(
                                || dependency_satisfied(DependencyPolicy::ClosedOnly, &prerequisite.work),
                                |facts| facts.edges.iter().find(|edge| edge.predecessor.work_id == prerequisite.work.id)
                                    .is_some_and(|edge| edge.outcome == boreal_domain::decision_inputs::DependencyOutcome::Closed),
                            ),
                            policy: *policy,
                        }
                    })
                })
                .collect::<Vec<_>>();
            StatusWork {
                canonical_inputs: inputs[index].action_facts.as_ref().and_then(|facts| facts.canonical_inputs.clone()),
                work: inputs[index].work.clone(),
                decision: all[index].clone(),
                actions: all_actions[index].clone(),
                action_context: all_action_contexts[index].clone(),
                attempt: inputs[index].current_attempt.clone(),
                gates: GateDiagnostics::from_input(&inputs[index]),
                dependency_blockers,
            }
        })
        .collect::<Vec<_>>();

    Ok(StatusSnapshot {
        project_actions: Vec::new(),
        page_work_ids: items.iter().map(|item| item.work.id.to_string()).collect(),
        page_count: items.len() as u64,
        quarantined_count: 0,
        project_diagnostics: Vec::new(),
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
        attention_queues,
        next_status_change_at,
    })
}

fn build_attention_queues(
    inputs: &[StatusWorkInput],
    decisions: &[StatusDecision],
) -> AttentionQueues {
    use boreal_domain::decision_inputs::{RecoveryReason, ReviewOutcome};

    let mut queues = AttentionQueues::default();
    for (input, decision) in inputs.iter().zip(decisions) {
        let reasons = decision
            .reason_codes
            .iter()
            .map(|reason| reason.stable_code())
            .collect::<Vec<_>>();
        let item = AttentionQueueItem {
            work_id: input.work.id.to_string(),
            title: input.work.title.clone(),
            display_status: decision.display_status,
            reason_codes: reasons,
        };
        if decision.display_status == DerivedStatus::AwaitingReview {
            queues.review.push(item.clone());
        }
        let canonical = input
            .action_facts
            .as_ref()
            .and_then(|facts| facts.canonical_inputs.as_ref());
        if canonical
            .and_then(|facts| facts.review.as_present())
            .is_some_and(|review| {
                matches!(
                    review.outcome,
                    ReviewOutcome::Rejected | ReviewOutcome::Returned | ReviewOutcome::Revoked
                )
            })
            || decision.reason_codes.iter().any(|reason| {
                matches!(reason, ReasonCode::ReviewRejected(_))
            })
        {
            queues.rejected_review.push(item.clone());
        }
        if decision.display_status == DerivedStatus::ExpiredReview
            || decision.reason_codes.iter().any(|reason| {
                matches!(reason, ReasonCode::ExpiryReviewRequired)
            })
        {
            queues.expiry.push(item.clone());
        }
        if canonical
            .and_then(|facts| facts.recovery.as_present())
            .is_some_and(|recovery| recovery.unresolved && recovery.reason == RecoveryReason::Failed)
        {
            queues.failed_execution.push(item.clone());
        }
        if input.work.hard_holds.iter().any(|hold| matches!(hold, ReasonCode::HardHold(_)))
            || canonical
                .and_then(|facts| facts.holds.as_present())
                .is_some_and(|holds| holds.holds.iter().any(|hold| hold.active))
        {
            queues.operator_holds.push(item);
        }
    }
    queues
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
    project_status_from_store_for_session(store, project_id, actor, None, as_of, limit, offset)
}

#[allow(clippy::too_many_arguments)]
pub fn project_status_from_store_for_session(
    store: &SqliteStore,
    project_id: &boreal_domain::ProjectId,
    actor: &ActorContext,
    session_id: Option<&str>,
    as_of: TimestampMs,
    limit: u64,
    offset: u64,
) -> Result<StatusSnapshot, String> {
    if !(1..=MAX_STATUS_ROWS).contains(&limit) {
        return Err(StatusProjectionError::InvalidPage {
            limit,
            max: MAX_STATUS_ROWS,
        }
        .to_string());
    }
    let (persisted, authorized_actor) = store
        .read_project_status_for_session(
            project_id.as_str(),
            actor.actor_id.as_str(),
            session_id,
            as_of,
        )
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
    // Page physical work identities, not successful decodes or diagnostic count.
    // This preserves one revision and exact totals even when an entire page is damaged.
    let page_ids = persisted
        .ordered_work_ids
        .iter()
        .skip(offset as usize)
        .take(limit as usize)
        .cloned()
        .collect::<std::collections::BTreeSet<_>>();
    let valid_before = persisted
        .ordered_work_ids
        .iter()
        .take(offset as usize)
        .filter(|id| known_work.contains(&WorkId::new((*id).clone())))
        .count() as u64;
    let valid_in_page = page_ids
        .iter()
        .filter(|id| known_work.contains(&WorkId::new((*id).clone())))
        .count() as u64;
    let mut snapshot = project_status(
        project_id,
        &authorized_actor,
        as_of,
        Revision(persisted.revision.0),
        &inputs,
        &dependencies,
        valid_in_page.max(1),
        valid_before,
    )
    .map_err(|error| error.to_string())?;
    if valid_in_page == 0 {
        snapshot.items.clear();
    }
    snapshot.project_actions = boreal_domain::work_model_v3::project_planning_actions(
        project_id,
        &authorized_actor,
        persisted
            .caller_session_id
            .as_ref()
            .map(|value| boreal_domain::SessionId::new(value.clone()))
            .as_ref(),
        snapshot.project_revision,
    );
    snapshot.limit = limit;
    snapshot.offset = offset;
    snapshot.page_work_ids = persisted
        .ordered_work_ids
        .iter()
        .skip(offset as usize)
        .take(limit as usize)
        .cloned()
        .collect();
    snapshot.page_count = page_ids.len() as u64;
    snapshot.total = persisted.total;
    let all_ids = persisted
        .ordered_work_ids
        .iter()
        .collect::<std::collections::BTreeSet<_>>();
    snapshot.quarantined_count = diagnostics
        .iter()
        .filter(|diagnostic| all_ids.contains(&diagnostic.work_id))
        .map(|diagnostic| &diagnostic.work_id)
        .collect::<std::collections::BTreeSet<_>>()
        .len() as u64;
    snapshot.project_diagnostics = diagnostics
        .iter()
        .filter(|diagnostic| !all_ids.contains(&diagnostic.work_id))
        .cloned()
        .collect();
    for diagnostic in &diagnostics {
        if is_planning_diagnostic(&diagnostic.code) {
            snapshot.attention_queues.damaged_planning.push(AttentionQueueItem {
                work_id: diagnostic.work_id.clone(),
                title: diagnostic.title.clone().unwrap_or_default(),
                display_status: DerivedStatus::Blocked,
                reason_codes: vec![format!("integrity:{}", diagnostic.code)],
            });
        }
    }
    snapshot.diagnostics = diagnostics
        .into_iter()
        .filter(|diagnostic| page_ids.contains(&diagnostic.work_id))
        .collect();
    Ok(snapshot)
}

fn is_planning_diagnostic(code: &str) -> bool {
    let code = code.to_ascii_lowercase();
    code.contains("cycle")
        || code.contains("assignment")
        || code.contains("planning")
        || code.contains("dependency")
        || code.contains("corrupt")
}

pub(crate) fn status_input_from_store_row(row: &StatusWorkRecord) -> Result<StatusWorkInput, String> {
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
    input.action_facts = Some(row.action_facts.clone());
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

/// Preserve the store's action-context observations and attach an explicit
/// diagnostic when the canonical status/action pair could not be established.
fn status_action_context(
    input: &StatusWorkInput,
    decision_diagnostic: Option<&str>,
) -> StatusActionContext {
    if let Some(facts) = &input.action_facts {
        let integrity = if decision_diagnostic.is_some() {
            "quarantined"
        } else {
            match facts.integrity {
                boreal_store::StatusIntegrity::Valid => "valid",
                boreal_store::StatusIntegrity::Degraded => "degraded",
                boreal_store::StatusIntegrity::Quarantined => "quarantined",
            }
        };
        let mut missing_facts = facts.missing_facts.clone();
        if let Some(diagnostic) = decision_diagnostic {
            missing_facts.push(diagnostic.to_owned());
        }
        return StatusActionContext::FactsRead {
            entity_revision: facts.entity_revision,
            proof_revision: facts.proof_revision,
            session_id: facts.authenticated_session_id.clone(),
            integrity,
            missing_facts,
        };
    }
    StatusActionContext::Unavailable {
        missing_facts: vec!["entity_revision", "proof_identity", "authenticated_session"],
    }
}

fn decision_api_diagnostic(error: &DecisionApiError) -> String {
    match error {
        DecisionApiError::MissingFact(fact) => {
            format!("canonical_decision_missing_fact:{fact:?}")
        }
        DecisionApiError::InvalidFacts(diagnostics) => {
            format!("canonical_decision_invalid_facts:{}", diagnostics.len())
        }
        DecisionApiError::ContextMismatch(field) => {
            format!("canonical_decision_context_mismatch:{field:?}")
        }
    }
}

fn safe_recovery_actions(facts: &boreal_domain::DecisionInputs) -> ActionDecision {
    use boreal_domain::decision_inputs::{IntegrityDiagnostic, IntegrityDiagnosticCode};

    let mut quarantined = facts.clone();
    quarantined.integrity.level = boreal_domain::decision_inputs::IntegrityLevel::Quarantined;
    if quarantined.integrity.diagnostics.is_empty() {
        quarantined.integrity.diagnostics.push(IntegrityDiagnostic {
            scope: quarantined.integrity.scope.clone(),
            code: IntegrityDiagnosticCode::Corrupt,
        });
    }
    let reasons = [ReasonCode::HardHold(
        "canonical_decision_context_mismatch".to_owned(),
    )];
    boreal_domain::actions::evaluate_actions(&boreal_domain::actions::ActionEvaluationInput::new(
        &quarantined,
        DerivedStatus::Blocked,
        &reasons,
    ))
}

fn rejected_canonical_decision(
    work: &WorkItem,
    attempt: Option<&Attempt>,
    gates: &[GateRequirement],
    affected_dependents: &[WorkId],
    as_of: TimestampMs,
    project_revision: Revision,
) -> StatusDecision {
    let reason = ReasonCode::HardHold("canonical_decision_rejected".to_owned());
    StatusDecision {
        work_id: work.id.clone(),
        project_revision,
        as_of,
        next_status_change_at: None,
        display_status: DerivedStatus::Blocked,
        primary_reason: reason.clone(),
        reason_codes: vec![reason],
        claimable_for_actor: false,
        next_action: None,
        current_attempt: attempt.map(|attempt| CurrentAttempt {
            attempt_id: attempt.attempt_id.clone(),
            fence: attempt.fence,
            phase: attempt.phase,
        }),
        gate_gaps: gates
            .iter()
            .filter(|gate| gate.required && gate.state != GateState::Satisfied)
            .map(|gate| gate.id.clone())
            .collect(),
        affected_dependents: affected_dependents.to_vec(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use boreal_domain::{
        decision_inputs::*, AcceptanceProfile, ActorId, AttemptId, ConfigIdentity, Fence,
        PersistedLifecycle, ProfileId, ReasonCode, SessionId, SourceVersionId, WorkKind,
    };

    fn actor() -> ActorContext {
        ActorContext {
            actor_id: ActorId::new("agent"),
            role: boreal_domain::ActorRole::Agent,
        }
    }

    fn work(id: &str) -> WorkItem {
        WorkItem::new("project".into(), id.into(), WorkKind::Task, None, id).open()
    }

    fn input(id: &str) -> StatusWorkInput {
        StatusWorkInput::new(work(id))
    }

    fn canonical_facts(work_id: &str) -> boreal_domain::DecisionInputs {
        let project_id = boreal_domain::ProjectId::new("project");
        let work_id = WorkId::new(work_id);
        let subject =
            EntityIdentity::new(project_id.clone(), work_id.clone(), EntityRevision::new(7));
        let profile = ProfileIdentity::new(
            ProfileId::new("focused"),
            "1",
            ContentDigest::new("sha256:status-test-profile"),
        );
        let proof = ProofIdentity::new(
            subject.clone(),
            ProofRevision::new(11),
            None,
            SourceVersionId::new("source-1"),
            ConfigIdentity::new("config-1"),
            profile,
            "policy-1",
        );
        let actor_id = ActorId::new("agent");
        let fact_subject = FactSubject::work(project_id.clone(), work_id.clone());
        boreal_domain::DecisionInputs {
            subject: subject.clone(),
            snapshot_revision: Revision(7),
            clock: EvaluationClock::at(TimestampMs(10)),
            availability: Availability::Live,
            dispatch_policy: boreal_domain::DispatchPolicy::Automatic,
            lifecycle: Fact::present(LifecycleInput {
                identity: subject,
                lifecycle: PersistedLifecycle::Open,
                terminal_decision: None,
            }),
            authority: Fact::present(ActorAuthorityInput {
                project_id: project_id.clone(),
                authority_root: actor_id.clone(),
                role: boreal_domain::ActorRole::Agent,
                principal: PrincipalBinding::Authenticated {
                    actor_id: actor_id.clone(),
                },
                session_id: Some(SessionId::new("session-1")),
            }),
            requirements: Fact::present(PinnedRequirementsInput {
                proof,
                requirements: Vec::new(),
                review_policy: ReviewRequirementPolicy::NotRequired,
            }),
            dependencies: Fact::present(DependencyOutcomesInput { edges: Vec::new() }),
            holds: Fact::present(HoldsInput { holds: Vec::new() }),
            execution: Fact::optional_absent(FactKind::Execution, fact_subject.clone()),
            submission: Fact::optional_absent(FactKind::Submission, fact_subject.clone()),
            review: Fact::optional_absent(FactKind::Review, fact_subject.clone()),
            recovery: Fact::optional_absent(FactKind::Recovery, fact_subject),
            integrity: IntegrityInput {
                scope: IntegrityScope::work(project_id, work_id),
                level: IntegrityLevel::Valid,
                diagnostics: Vec::new(),
            },
            permitted_actions: PermittedActionsInput::allowing([
                PermittedAction::Inspect,
                PermittedAction::Claim,
                PermittedAction::Repair,
            ]),
        }
    }

    fn input_with_canonical_facts(id: &str) -> StatusWorkInput {
        let mut input = input(id);
        input.work.acceptance_profile = AcceptanceProfile {
            id: ProfileId::new("focused"),
            version: "1".to_owned(),
            gates: Vec::new(),
        };
        input.gates.clear();
        input.action_facts = Some(StatusActionFacts {
            origin: StatusActionFactsOrigin::Canonical,
            canonical_inputs: Some(canonical_facts(id)),
            entity_revision: Some(7),
            proof_revision: Some(11),
            authenticated_session_id: Some("session-1".to_owned()),
            source_version_id: Some("source-1".to_owned()),
            config_identity: Some("config-1".to_owned()),
            integrity: boreal_store::StatusIntegrity::Valid,
            missing_facts: Vec::new(),
        });
        input
    }

    #[test]
    fn canonical_projection_uses_one_paired_status_and_action_decision() {
        let snapshot = project_status(
            &"project".into(),
            &actor(),
            TimestampMs(10),
            Revision(7),
            &[input_with_canonical_facts("paired")],
            &[],
            10,
            0,
        )
        .unwrap();

        let item = &snapshot.items[0];
        let actions = item.actions.as_ref().expect("paired action descriptors");
        assert_eq!(item.decision.display_status, DerivedStatus::Ready);
        assert_eq!(
            item.decision.claimable_for_actor,
            actions.allows(boreal_domain::actions::ActionKind::Claim)
        );
        assert!(item.claimable_for_actor());
        assert_eq!(item.action_context.state(), "available");
    }

    #[test]
    fn canonical_context_mismatch_is_diagnostic_and_denies_actions_without_legacy_fallback() {
        let mut input = input_with_canonical_facts("mismatch");
        input
            .action_facts
            .as_mut()
            .unwrap()
            .canonical_inputs
            .as_mut()
            .unwrap()
            .snapshot_revision = Revision(8);

        let snapshot = project_status(
            &"project".into(),
            &actor(),
            TimestampMs(10),
            Revision(7),
            &[input],
            &[],
            10,
            0,
        )
        .unwrap();

        let item = &snapshot.items[0];
        assert_eq!(item.decision.display_status, DerivedStatus::Blocked);
        assert_eq!(
            item.decision.primary_reason.stable_code(),
            "canonical_decision_rejected"
        );
        assert!(!item.decision.claimable_for_actor);
        assert!(item.actions.is_none());
        assert_eq!(item.action_context.state(), "partial");
        assert!(matches!(
            &item.action_context,
            StatusActionContext::FactsRead {
                integrity: "quarantined",
                missing_facts,
                ..
            } if missing_facts.iter().any(|fact| fact == "canonical_decision_context_mismatch:ProjectRevision")
        ));
    }

    #[test]
    fn unavailable_canonical_facts_do_not_fall_back_to_legacy_readiness() {
        let mut input = input("unavailable-canonical");
        input.action_facts = Some(StatusActionFacts::unavailable());

        let snapshot = project_status(
            &"project".into(),
            &actor(),
            TimestampMs(10),
            Revision(7),
            &[input],
            &[],
            10,
            0,
        )
        .unwrap();

        let item = &snapshot.items[0];
        assert_eq!(item.decision.display_status, DerivedStatus::Blocked);
        assert!(!item.claimable_for_actor());
        assert!(item.actions.is_none());
        assert!(matches!(
            &item.action_context,
            StatusActionContext::FactsRead {
                integrity: "quarantined",
                missing_facts,
                ..
            } if missing_facts.iter().any(|fact| fact == "canonical_decision_facts_unavailable")
        ));
    }

    #[test]
    fn dependency_context_mismatch_keeps_only_safe_recovery_actions() {
        let mut input = input_with_canonical_facts("dependency-mismatch");
        let operator = ActorContext {
            actor_id: ActorId::new("agent"),
            role: boreal_domain::ActorRole::Operator,
        };
        let facts = input
            .action_facts
            .as_mut()
            .unwrap()
            .canonical_inputs
            .as_mut()
            .unwrap();
        if let Fact::Present(authority) = &mut facts.authority {
            authority.role = boreal_domain::ActorRole::Operator;
        }
        facts.dependencies = Fact::present(DependencyOutcomesInput {
            edges: vec![DependencyOutcomeInput {
                id: DependencyId::new("edge-missing-prerequisite"),
                predecessor: EntityIdentity::new(
                    "project".into(),
                    WorkId::new("unreadable-prerequisite"),
                    EntityRevision::new(1),
                ),
                successor: facts.subject.clone(),
                policy: DependencyPolicy::ClosedOnly,
                outcome: DependencyOutcome::Open,
                outcome_revision: EntityRevision::new(1),
                waiver: None,
            }],
        });

        let snapshot = project_status(
            &"project".into(),
            &operator,
            TimestampMs(10),
            Revision(7),
            &[input],
            &[],
            10,
            0,
        )
        .unwrap();

        let item = &snapshot.items[0];
        let actions = item.actions.as_ref().expect("safe recovery descriptors");
        assert_eq!(item.decision.display_status, DerivedStatus::Blocked);
        assert!(actions.allows(boreal_domain::actions::ActionKind::Inspect));
        assert!(actions.allows(boreal_domain::actions::ActionKind::Repair));
        assert!(!actions.allows(boreal_domain::actions::ActionKind::Claim));
        assert!(!item.claimable_for_actor());
    }

    #[test]
    fn invalid_canonical_facts_are_quarantined_instead_of_split_evaluation() {
        let mut input = input_with_canonical_facts("invalid-facts");
        let operator = ActorContext {
            actor_id: ActorId::new("agent"),
            role: boreal_domain::ActorRole::Operator,
        };
        if let Fact::Present(authority) = &mut input
            .action_facts
            .as_mut()
            .expect("canonical action facts")
            .canonical_inputs
            .as_mut()
            .expect("canonical decision inputs")
            .authority
        {
            authority.role = boreal_domain::ActorRole::Operator;
        }
        input
            .action_facts
            .as_mut()
            .unwrap()
            .canonical_inputs
            .as_mut()
            .unwrap()
            .permitted_actions
            .denied
            .push(DeniedAction {
                action: PermittedAction::Claim,
                reason: ActionDenialReason::PolicyDenied,
            });

        let snapshot = project_status(
            &"project".into(),
            &operator,
            TimestampMs(10),
            Revision(7),
            &[input],
            &[],
            10,
            0,
        )
        .unwrap();

        let item = &snapshot.items[0];
        assert_eq!(item.decision.display_status, DerivedStatus::Blocked);
        assert!(!item.claimable_for_actor());
        let actions = item
            .actions
            .as_ref()
            .expect("safe repair actions remain visible");
        assert!(actions.allows(boreal_domain::actions::ActionKind::Repair));
        assert!(!actions.allows(boreal_domain::actions::ActionKind::Claim));
        assert!(matches!(
            &item.action_context,
            StatusActionContext::FactsRead {
                integrity: "quarantined",
                missing_facts,
                ..
            } if missing_facts.iter().any(|fact| fact == "canonical_decision_invalid_facts:1")
        ));
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
            // This isolated row fixture exercises the status-only compatibility
            // projection. Canonical timing/context consistency is covered by
            // the paired domain API regression.
            action_facts: boreal_store::StatusActionFacts::legacy_compatibility(),
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
    fn legacy_claimability_remains_discovery_hint_when_action_context_is_unavailable() {
        let snapshot = project_status(
            &"project".into(),
            &actor(),
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
        assert!(item.claimable_for_actor());
        assert!(item.actions.is_none());
        assert_eq!(item.action_context.state(), "unavailable");
        assert_eq!(
            item.action_context.missing_facts(),
            &["entity_revision", "proof_identity", "authenticated_session"]
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
