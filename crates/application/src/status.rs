//! Revisioned, derived work-status read models.
//!
//! The application layer owns projection assembly. Callers provide the
//! canonical rows read from a store at one revision and clock; this module
//! supplies the graph, attempt, gate, and pagination context to the pure
//! domain evaluators and never persists the resulting status.

use boreal_domain::{
    dependency_satisfied, evaluate_rollup, evaluate_status, ActorContext, Attempt, CurrentAttempt,
    DependencyPolicy, DerivedStatus, GateId, GateKind, GateRequirement, GateState, Revision,
    RollupCounts, StatusContext, StatusDecision, TimestampMs, WorkId, WorkItem,
};
use boreal_store::{SqliteStore, StatusWorkRecord};
use std::{collections::BTreeMap, fmt};

pub const STATUS_CONTRACT_VERSION: &str = "boreal.work-status/2";
pub const MAX_STATUS_ROWS: u64 = 1_000;

/// Canonical read inputs for one work item. The store adapter may populate
/// these from its read APIs; the derived fields are intentionally absent.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StatusWorkInput {
    pub work: WorkItem,
    pub retry_not_before: Option<TimestampMs>,
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
pub struct StatusWork {
    pub work: WorkItem,
    pub decision: StatusDecision,
    pub attempt: Option<Attempt>,
    pub gates: GateDiagnostics,
    pub dependency_blockers: Vec<DependencyBlocker>,
}

impl StatusWork {
    pub fn display_status(&self) -> DerivedStatus {
        self.decision.display_status
    }

    pub fn current_attempt(&self) -> Option<&CurrentAttempt> {
        self.decision.current_attempt.as_ref()
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
    pub next_status_change_at: Option<TimestampMs>,
}

impl StatusSnapshot {
    pub fn has_more(&self) -> bool {
        self.offset.saturating_add(self.items.len() as u64) < self.total
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
        let mut decision = evaluate_status(StatusContext {
            work: &input.work,
            prerequisites: &prerequisite_rows,
            current_attempt: input.current_attempt.as_ref(),
            gates: &input.gates,
            actor,
            as_of,
            project_revision,
            retry_not_before: input.retry_not_before,
            affected_dependents: &affected_dependents[index],
        });
        if decision.display_status == DerivedStatus::ExpiredReview
            || input
                .current_attempt
                .as_ref()
                .is_some_and(|attempt| attempt.phase.is_terminal())
        {
            decision.next_status_change_at = None;
        } else if decision.display_status == DerivedStatus::RetryWait {
            if let Some(retry_at) = input.retry_not_before.filter(|retry_at| *retry_at > as_of) {
                decision.next_status_change_at = Some(
                    decision
                        .next_status_change_at
                        .map_or(retry_at, |current| current.min(retry_at)),
                );
            }
        }
        all.push(decision);
    }

    let decisions = all.to_vec();
    let counts = evaluate_rollup(&decisions);
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
                            display_status: all[*prerequisite_index].display_status,
                            satisfies_default: dependency_satisfied(
                                DependencyPolicy::ClosedOnly,
                                &prerequisite.work,
                            ),
                            policy: *policy,
                        }
                    })
                })
                .collect::<Vec<_>>();
            StatusWork {
                work: inputs[index].work.clone(),
                decision: all[index].clone(),
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
    let persisted = store
        .read_project_status(project_id.as_str())
        .map_err(|error| error.to_string())?;
    let inputs = persisted
        .works
        .iter()
        .map(status_input_from_store_row)
        .collect::<Result<Vec<_>, _>>()?;
    let dependencies = persisted
        .dependencies
        .iter()
        .map(|edge| DependencyInput {
            prerequisite_id: edge.prerequisite_id.clone(),
            dependent_id: edge.dependent_id.clone(),
            policy: edge.policy,
        })
        .collect::<Vec<_>>();
    project_status(
        project_id,
        actor,
        as_of,
        Revision(persisted.revision.0),
        &inputs,
        &dependencies,
        limit,
        offset,
    )
    .map_err(|error| error.to_string())
}

fn status_input_from_store_row(row: &StatusWorkRecord) -> Result<StatusWorkInput, String> {
    let mut input = status_input(row.work.clone());
    input.retry_not_before = row
        .retry_not_before
        .as_deref()
        .map(parse_status_timestamp)
        .transpose()?;
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
    input.current_attempt = row
        .current_attempt
        .as_ref()
        .map(attempt_from_store)
        .transpose()?;
    Ok(input)
}

fn attempt_from_store(attempt: &boreal_store::AttemptRecord) -> Result<Attempt, String> {
    Ok(Attempt {
        work_id: attempt.work_id.clone().into(),
        attempt_id: attempt.attempt_id.clone().into(),
        actor_id: attempt.actor_id.clone().into(),
        harness_id: attempt.harness_id.clone().map(Into::into),
        session_id: attempt.session_id.clone().map(Into::into),
        fence: boreal_domain::Fence::new(attempt.fence),
        phase: attempt.phase,
        claimed_at: parse_status_timestamp(&attempt.claimed_at)?,
        accepted_at: attempt
            .accepted_at
            .as_deref()
            .map(parse_status_timestamp)
            .transpose()?,
        lease_deadline: parse_status_timestamp(&attempt.lease_deadline)?,
        max_attempt_deadline: parse_status_timestamp(&attempt.hard_deadline)?,
        deadline_source: boreal_domain::DeadlineSource::Explicit,
        last_heartbeat_at: attempt
            .last_heartbeat_at
            .as_deref()
            .map(parse_status_timestamp)
            .transpose()?,
        last_checkpoint_at: attempt
            .last_checkpoint_at
            .as_deref()
            .map(parse_status_timestamp)
            .transpose()?,
        review_required_after_expiry: attempt.review_required_after_expiry,
    })
}

fn parse_status_timestamp(value: &str) -> Result<TimestampMs, String> {
    value
        .strip_prefix("unix-ms:")
        .and_then(|value| value.parse::<u64>().ok())
        .map(TimestampMs)
        .ok_or_else(|| format!("invalid canonical timestamp: {value}"))
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

    fn work(id: &str) -> WorkItem {
        WorkItem::new("project".into(), id.into(), WorkKind::Task, None, id).open()
    }

    fn input(id: &str) -> StatusWorkInput {
        StatusWorkInput::new(work(id))
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
