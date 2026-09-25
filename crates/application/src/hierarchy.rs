//! Application façade for v3 hierarchy planning and schema capability.
//!
//! The mutation methods keep lifecycle and graph policy in this application
//! boundary.  Row-level adapters are used where the store exposes a v3 seam;
//! planning-only APIs remain explicit for edits and graph operations whose
//! transactional store methods are not available yet.

use boreal_domain::work_model_v3::{
    ActivationPolicy, Cycle, CycleAssignment, CycleAssignmentState, CycleId, CycleInstance, CycleLifecycle,
    CycleSeries, CycleSeriesLifecycle, CycleTemplate, DispositionKind, FoldPolicy, GapPolicy,
    ExecutionMode, IntakeBucket, IntakeItem, IntakeKind, IntakeLifecycle, IntakePromotion,
    PromotionTargetKind,
};
use boreal_domain::decision_inputs::{ContentDigest, EntityIdentity, EntityRevision, ProofRevision};
use boreal_domain::rollups::{
    evaluate_container_rollup, evaluate_cycle_rollup, AcceptedOutcome, ContainerRollup,
    ContainerRollupInput, CycleAssignmentRollupInput, CycleRollup, CycleRollupInput,
    DescendantIntegrity, RollupBlocker, RollupScope, ScopeDisposition, TaskRollupInput,
};
use boreal_domain::{ProjectId, SessionId, TimestampMs, WorkId};
use boreal_store::{
    AttemptRecord, ContainerDispositionV3Input, CycleAssignmentV3Input, CycleSeriesV3Input,
    CycleTemplateV3Input, CycleV3Input, IntakeBucketV3Input, IntakeItemV3Input, IntakeItemV3Record,
    IntakePromotionV3Input, MutationResult, SessionRecord, SessionState, V3MutationContext,
    WorkNodeV3Input,
};
use std::collections::{BTreeMap, BTreeSet};

use crate::planning_v3::{
    plan_cycle_activation, plan_cycle_create, plan_cycle_slot, plan_dependency_change,
    plan_work_edit, plan_work_policy,
};
use crate::{canonical_request_digest, ApplicationError, OperationResult, WorkApplication};

pub use crate::planning_v3::{
    CycleActivationRequest, CycleCreateRequest, CycleSlotRequest, DependencyChange,
    HierarchySnapshot, PlannedOperation, PlanningError, PlanningScope, SystemTimeZoneDatabase,
    WorkEditRequest, WorkPolicyPatch,
};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DependencyGraphView {
    pub project_id: ProjectId,
    pub revision: u64,
    pub edges: Vec<DependencyEdgeView>,
    pub cycles: Vec<Vec<String>>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DependencyEdgeView {
    pub prerequisite_id: String,
    pub dependent_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CycleBoardView {
    pub diagnostics: Vec<boreal_store::StatusRecordDiagnostic>,
    pub project_id: ProjectId,
    pub revision: u64,
    pub cycle: boreal_store::CycleV3Record,
    pub assignments: Vec<CycleBoardAssignment>,
    pub rollup: CycleRollup,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContainerRollupView {
    pub diagnostics: Vec<boreal_store::StatusRecordDiagnostic>,
    pub project_id: ProjectId,
    pub revision: u64,
    pub container: boreal_store::WorkNodeV3Record,
    pub rollup: ContainerRollup,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CycleBoardAssignment {
    pub accepted_closed: bool,
    pub accepted_outcome: Option<boreal_store::acceptance::AcceptedOutcomeRecord>,
    pub assignment: boreal_store::CycleAssignmentV3Record,
    pub work_title: Option<String>,
    pub work_kind: Option<String>,
    pub work_lifecycle: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntakeItemsView {
    pub project_id: ProjectId,
    pub revision: u64,
    pub items: Vec<IntakeItemV3Record>,
}

impl WorkApplication<'_> {
    /// Return the canonical dependency graph and deterministic cycle
    /// diagnostics from one store snapshot. This read model is shared by
    /// CLI, service, and dashboard adapters.
    pub fn dependency_graph(
        &self,
        project_id: &ProjectId,
    ) -> Result<DependencyGraphView, ApplicationError> {
        let snapshot = self.store_ref().read_project_status(project_id.as_str())?;
        let mut edges = snapshot
            .dependencies
            .into_iter()
            .map(|edge| DependencyEdgeView {
                prerequisite_id: edge.prerequisite_id.to_string(),
                dependent_id: edge.dependent_id.to_string(),
            })
            .collect::<Vec<_>>();
        edges.sort_by(|left, right| {
            left.prerequisite_id
                .cmp(&right.prerequisite_id)
                .then_with(|| left.dependent_id.cmp(&right.dependent_id))
        });
        let cycles = find_dependency_cycles(&edges);
        Ok(DependencyGraphView {
            project_id: project_id.clone(),
            revision: snapshot.revision.0,
            edges,
            cycles,
        })
    }

    /// Build a cycle board from persisted v3 assignments and the canonical
    /// v2 work/status snapshot. The board is read-only; lifecycle mutations
    /// remain application/store operations.
    pub fn cycle_board_v3(
        &self,
        project_id: &ProjectId,
        cycle_id: &str,
        actor_id: &str,
        session_id: Option<&str>,
        as_of: TimestampMs,
    ) -> Result<CycleBoardView, ApplicationError> {
        if !self.store_ref().work_model_v3_enabled()? {
            return Err(ApplicationError::Invalid(
                "cycle board requires work-model/3 to be enabled".to_owned(),
            ));
        }
        let snapshot = self.store_ref().cycle_board_snapshot_v3(
            project_id.as_str(),
            cycle_id,
            actor_id,
            session_id,
            as_of,
        )?;
        let revision = snapshot.status.revision.0;
        let mut diagnostics = snapshot.status.diagnostics.clone();
        diagnostics.extend(snapshot.assignment_diagnostics.iter().cloned());
        let mut inputs = Vec::with_capacity(snapshot.status.works.len());
        for row in &snapshot.status.works {
            match crate::status::status_input_from_store_row(row) {
                Ok(input) => inputs.push(input),
                Err(detail) => diagnostics.push(boreal_store::StatusRecordDiagnostic {
                    work_id: row.work.id.to_string(),
                    title: Some(row.work.title.clone()),
                    code: "rollup_facts_unreadable".to_owned(),
                    detail,
                }),
            }
        }
        let known = inputs
            .iter()
            .map(|input| input.work.id.clone())
            .collect::<BTreeSet<_>>();
        let mut dependencies = Vec::new();
        for edge in &snapshot.status.dependencies {
            if known.contains(&edge.prerequisite_id) && known.contains(&edge.dependent_id) {
                dependencies.push(crate::status::DependencyInput {
                    prerequisite_id: edge.prerequisite_id.clone(),
                    dependent_id: edge.dependent_id.clone(),
                    policy: edge.policy,
                });
            } else {
                diagnostics.push(boreal_store::StatusRecordDiagnostic {
                    work_id: edge.dependent_id.to_string(),
                    title: None,
                    code: "rollup_dependency_unreadable".to_owned(),
                    detail: format!("dependency prerequisite {} is unreadable", edge.prerequisite_id),
                });
            }
        }
        let total = inputs.len() as u64;
        let mut projected = BTreeMap::new();
        let mut offset = 0;
        while offset < total || (total == 0 && offset == 0) {
            let limit = total.saturating_sub(offset).min(crate::status::MAX_STATUS_ROWS).max(1);
            let page = crate::status::project_status(
                project_id,
                &snapshot.actor,
                as_of,
                boreal_domain::Revision(revision),
                &inputs,
                &dependencies,
                limit,
                offset,
            )
            .map_err(|error| ApplicationError::Invalid(error.to_string()))?;
            let returned = page.items.len() as u64;
            for item in page.items {
                projected.insert(item.work.id.to_string(), item);
            }
            if total == 0 || returned == 0 {
                break;
            }
            offset += returned;
        }
        let work = snapshot.status
            .works
            .iter()
            .map(|row| (row.work.id.to_string(), row.work.clone()))
            .collect::<BTreeMap<_, _>>();
        let assignments = snapshot.assignments
            .iter()
            .cloned()
            .map(|assignment| {
                let item = work.get(&assignment.work_id);
                let accepted_outcome = snapshot.accepted_outcomes.get(&assignment.work_id).cloned();
                CycleBoardAssignment {
                    accepted_closed: accepted_outcome.is_some(),
                    accepted_outcome,
                    work_title: item.map(|value| value.title.clone()),
                    work_kind: item.map(|value| format!("{:?}", value.kind).to_ascii_lowercase()),
                    work_lifecycle: item
                        .map(|value| format!("{:?}", value.lifecycle).to_ascii_lowercase()),
                    assignment,
                }
            })
            .collect();
        let cycle = cycle_model(&snapshot.cycle)?;
        let node_by_work = snapshot.work_nodes.iter().map(|node| (node.work_id.as_str(), node)).collect::<BTreeMap<_, _>>();
        let input_by_work = inputs.iter().map(|input| (input.work.id.as_str(), input)).collect::<BTreeMap<_, _>>();
        let mut rollup_assignments = Vec::new();
        for assignment in &snapshot.assignments {
            let id = assignment.work_id.as_str();
            let Some(item) = projected.get(id) else {
                let source_row = snapshot.status.works.iter().find(|row| row.work.id.as_str() == id);
                diagnostics.push(boreal_store::StatusRecordDiagnostic {
                    work_id: id.to_owned(),
                    title: work.get(id).map(|work| work.title.clone()),
                    code: "rollup_work_unavailable".to_owned(),
                    detail: "assigned work is missing from the canonical status snapshot".to_owned(),
                });
                // Keep the assignment in the rollup denominator even when its
                // decision facts cannot be projected. The corrupt integrity
                // marker prevents this fallback from ever counting as accepted.
                let Some(row) = source_row else {
                    diagnostics.push(boreal_store::StatusRecordDiagnostic {
                        work_id: id.to_owned(),
                        title: None,
                        code: "rollup_identity_unavailable".to_owned(),
                        detail: "assignment has no decodable work identity".to_owned(),
                    });
                    continue;
                };
                let outcome = snapshot.accepted_outcomes.get(id);
                let identity = EntityIdentity::new(
                    project_id.clone(),
                    WorkId::new(id),
                    EntityRevision::new(row.action_facts.entity_revision.unwrap_or(0)),
                );
                let accepted_outcome = outcome.map(|outcome| AcceptedOutcome::new(
                    EntityIdentity::new(
                        ProjectId::new(outcome.project_id.clone()),
                        WorkId::new(outcome.work_id.clone()),
                        EntityRevision::new(outcome.entity_revision),
                    ),
                    ProofRevision::new(outcome.proof_revision),
                    ContentDigest::new(outcome.summary_digest.clone()),
                ));
                let disposition = match assignment.state.as_str() {
                    "completed" => outcome.map(|outcome| boreal_domain::rollups::ScopeDisposition::AcceptedClosed {
                        entity_revision: EntityRevision::new(outcome.entity_revision),
                        outcome_digest: ContentDigest::new(outcome.summary_digest.clone()),
                    }),
                    "removed" | "carried_over" => snapshot.assignment_reasons.get(&assignment.assignment_id)
                        .map(|reason| boreal_domain::rollups::ScopeDisposition::deferred(reason.clone())),
                    _ => None,
                };
                let mut task = TaskRollupInput::new(
                    identity,
                    ExecutionMode::Direct,
                    row.work.lifecycle,
                    match row.work.lifecycle {
                        boreal_domain::PersistedLifecycle::Draft => boreal_domain::DerivedStatus::Draft,
                        boreal_domain::PersistedLifecycle::Open => boreal_domain::DerivedStatus::Ready,
                        boreal_domain::PersistedLifecycle::Closed => boreal_domain::DerivedStatus::Closed,
                        boreal_domain::PersistedLifecycle::Cancelled => boreal_domain::DerivedStatus::Cancelled,
                    },
                );
                task.accepted_outcome = accepted_outcome;
                task.disposition = disposition;
                task.requires_reconciliation = true;
                task.integrity = DescendantIntegrity::Corrupt {
                    code: "status_projection_unavailable".to_owned(),
                };
                let (assignment_model, assignment_errors) = cycle_assignment_model(assignment);
                for error in &assignment_errors {
                    diagnostics.push(boreal_store::StatusRecordDiagnostic {
                        work_id: id.to_owned(),
                        title: work.get(id).map(|work| work.title.clone()),
                        code: "cycle_assignment_corrupt".to_owned(),
                        detail: error.clone(),
                    });
                }
                if !assignment_errors.is_empty() {
                    task.integrity = DescendantIntegrity::Corrupt {
                        code: "cycle_assignment_corrupt".to_owned(),
                    };
                }
                rollup_assignments.push(CycleAssignmentRollupInput {
                    assignment: assignment_model,
                    task,
                });
                continue;
            };
            let source_input = input_by_work.get(id).copied();
            let node = node_by_work.get(id).copied();
            let (execution_mode, node_integrity) = match node.map(|node| node.execution_mode.as_str()) {
                Some("container") => (ExecutionMode::Container, None),
                Some("direct") => (ExecutionMode::Direct, None),
                Some(value) => (ExecutionMode::Direct, Some(format!("invalid_execution_mode:{value}"))),
                None => (ExecutionMode::Direct, Some("work_node_missing".to_owned())),
            };
            let identity = item.canonical_inputs.as_ref().map(|facts| facts.subject.clone()).or_else(|| {
                source_input.and_then(|input| input.action_facts.as_ref()?.entity_revision.map(|entity_revision| {
                    EntityIdentity::new(project_id.clone(), WorkId::new(id), EntityRevision::new(entity_revision))
                }))
            }).unwrap_or_else(|| EntityIdentity::new(
                project_id.clone(),
                WorkId::new(id),
                EntityRevision::new(0),
            ));
            let stored_outcome = snapshot.accepted_outcomes.get(id);
            let accepted_outcome = stored_outcome.map(|outcome| AcceptedOutcome::new(
                EntityIdentity::new(
                    ProjectId::new(outcome.project_id.clone()),
                    WorkId::new(outcome.work_id.clone()),
                    EntityRevision::new(outcome.entity_revision),
                ),
                ProofRevision::new(outcome.proof_revision),
                ContentDigest::new(outcome.summary_digest.clone()),
            ));
            let disposition = match assignment.state.as_str() {
                "completed" => stored_outcome.map(|outcome| boreal_domain::rollups::ScopeDisposition::AcceptedClosed {
                    entity_revision: EntityRevision::new(outcome.entity_revision),
                    outcome_digest: ContentDigest::new(outcome.summary_digest.clone()),
                }),
                "removed" | "carried_over" => snapshot.assignment_reasons.get(&assignment.assignment_id)
                    .map(|reason| boreal_domain::rollups::ScopeDisposition::deferred(reason.clone())),
                _ => None,
            };
            let canonical_integrity = item.canonical_inputs.as_ref().map(|facts| facts.integrity.level);
            let integrity = if let Some(code) = node_integrity {
                DescendantIntegrity::Corrupt { code }
            } else {
                match canonical_integrity {
                    Some(boreal_domain::decision_inputs::IntegrityLevel::Valid) => DescendantIntegrity::Valid,
                    Some(boreal_domain::decision_inputs::IntegrityLevel::Degraded) => DescendantIntegrity::Degraded { code: "decision_facts_degraded".into() },
                    Some(boreal_domain::decision_inputs::IntegrityLevel::Quarantined) | None => DescendantIntegrity::Corrupt { code: "decision_facts_unavailable".into() },
                }
            };
            let gate_gaps = item.gates.missing.iter().map(|gate| gate.clone().into()).collect();
            let overdue = source_input.and_then(|input| input.schedule).and_then(|schedule| schedule.due_at).is_some_and(|due| as_of >= due);
            let blockers = item.decision.reason_codes.iter().filter_map(|reason| match reason {
                boreal_domain::ReasonCode::HardHold(_)
                | boreal_domain::ReasonCode::PrerequisiteOpen(_)
                | boreal_domain::ReasonCode::AttemptActive
                | boreal_domain::ReasonCode::NotPublished
                | boreal_domain::ReasonCode::GateFailed(_)
                | boreal_domain::ReasonCode::GateMissing(_)
                | boreal_domain::ReasonCode::GateInvalid(_)
                | boreal_domain::ReasonCode::ReviewRejected(_)
                | boreal_domain::ReasonCode::ExpiryReviewRequired
                | boreal_domain::ReasonCode::VerificationRequired
                | boreal_domain::ReasonCode::ReviewRequired
                | boreal_domain::ReasonCode::CloseoutPending
                | boreal_domain::ReasonCode::LeaseElapsed
                | boreal_domain::ReasonCode::HardBudgetElapsed => Some(RollupBlocker::new(WorkId::new(id), reason.stable_code())),
                _ => None,
            }).collect();
            let mut task = TaskRollupInput::new(
                identity,
                execution_mode,
                item.work.lifecycle,
                item.decision.display_status,
            );
            task.claimable_for_actor = item.claimable_for_actor();
            task.active_execution = item.attempt.is_some();
            task.accepted_outcome = accepted_outcome;
            task.disposition = disposition;
            task.requires_reconciliation = true;
            task.gate_gaps = gate_gaps;
            task.overdue = overdue;
            task.blockers = blockers;
            task.integrity = integrity;
            let (assignment_model, assignment_errors) = cycle_assignment_model(assignment);
            for error in &assignment_errors {
                diagnostics.push(boreal_store::StatusRecordDiagnostic {
                    work_id: id.to_owned(),
                    title: work.get(id).map(|work| work.title.clone()),
                    code: "cycle_assignment_corrupt".to_owned(),
                    detail: error.clone(),
                });
            }
            if !assignment_errors.is_empty() {
                task.integrity = DescendantIntegrity::Corrupt {
                    code: "cycle_assignment_corrupt".to_owned(),
                };
            }
            rollup_assignments.push(CycleAssignmentRollupInput {
                assignment: assignment_model,
                task,
            });
        }
        let rollup = evaluate_cycle_rollup(&CycleRollupInput {
            scope: RollupScope::cycle(project_id.clone(), cycle.id.clone(), EntityRevision::new(revision)),
            cycle,
            assignments: rollup_assignments,
            gate_gaps: Vec::new(),
            overdue: false,
            blockers: Vec::new(),
            integration_closeout: None,
        });
        Ok(CycleBoardView {
            project_id: project_id.clone(),
            revision,
            diagnostics,
            cycle: snapshot.cycle,
            assignments,
            rollup,
        })
    }

    /// Evaluate a container from one transaction-bound project snapshot. A
    /// malformed descendant remains in the rollup as corrupt work, while
    /// independently usable descendants retain their own readiness facts.
    pub fn container_rollup_v3(
        &self,
        project_id: &ProjectId,
        container_id: &str,
        actor_id: &str,
        session_id: Option<&str>,
        as_of: TimestampMs,
    ) -> Result<ContainerRollupView, ApplicationError> {
        if !self.store_ref().work_model_v3_enabled()? {
            return Err(ApplicationError::Invalid(
                "container rollup requires work-model/3 to be enabled".to_owned(),
            ));
        }
        let snapshot = self.store_ref().container_rollup_snapshot_v3(
            project_id.as_str(),
            container_id,
            actor_id,
            session_id,
            as_of,
        )?;
        let revision = snapshot.status.revision.0;
        let mut diagnostics = snapshot.status.diagnostics.clone();
        let mut inputs = Vec::with_capacity(snapshot.status.works.len());
        for row in &snapshot.status.works {
            match crate::status::status_input_from_store_row(row) {
                Ok(input) => inputs.push(input),
                Err(detail) => diagnostics.push(boreal_store::StatusRecordDiagnostic {
                    work_id: row.work.id.to_string(),
                    title: Some(row.work.title.clone()),
                    code: "rollup_facts_unreadable".to_owned(),
                    detail,
                }),
            }
        }
        let known = inputs
            .iter()
            .map(|input| input.work.id.clone())
            .collect::<BTreeSet<_>>();
        let mut dependencies = Vec::new();
        for edge in &snapshot.status.dependencies {
            if known.contains(&edge.prerequisite_id) && known.contains(&edge.dependent_id) {
                dependencies.push(crate::status::DependencyInput {
                    prerequisite_id: edge.prerequisite_id.clone(),
                    dependent_id: edge.dependent_id.clone(),
                    policy: edge.policy,
                });
            }
        }
        let total = inputs.len() as u64;
        let mut projected = BTreeMap::new();
        let mut offset = 0;
        loop {
            let limit = total
                .saturating_sub(offset)
                .min(crate::status::MAX_STATUS_ROWS)
                .max(1);
            let page = crate::status::project_status(
                project_id,
                &snapshot.actor,
                as_of,
                boreal_domain::Revision(revision),
                &inputs,
                &dependencies,
                limit,
                offset,
            )
            .map_err(|error| ApplicationError::Invalid(error.to_string()))?;
            let returned = page.items.len() as u64;
            for item in page.items {
                projected.insert(item.work.id.to_string(), item);
            }
            if total == 0 || returned == 0 {
                break;
            }
            offset += returned;
            if offset >= total {
                break;
            }
        }
        let node_by_work = snapshot
            .work_nodes
            .iter()
            .map(|node| (node.work_id.as_str(), node))
            .collect::<BTreeMap<_, _>>();
        let mut descendant_ids = BTreeSet::new();
        let mut frontier = BTreeSet::from([container_id.to_owned()]);
        while !frontier.is_empty() {
            let parents = frontier;
            frontier = BTreeSet::new();
            for node in &snapshot.work_nodes {
                if node.parent_id.as_ref().is_some_and(|parent| parents.contains(parent))
                    && descendant_ids.insert(node.work_id.clone())
                {
                    frontier.insert(node.work_id.clone());
                }
            }
            for row in &snapshot.status.works {
                if row
                    .work
                    .parent_id
                    .as_ref()
                    .is_some_and(|parent| parents.contains(parent.as_str()))
                    && descendant_ids.insert(row.work.id.to_string())
                {
                    frontier.insert(row.work.id.to_string());
                }
            }
        }
        let work_by_id = snapshot
            .status
            .works
            .iter()
            .map(|row| (row.work.id.as_str(), row))
            .collect::<BTreeMap<_, _>>();
        let mut descendants = Vec::with_capacity(descendant_ids.len());
        for id in descendant_ids {
            let source = work_by_id.get(id.as_str()).copied();
            let projected_item = projected.get(&id);
            let node = node_by_work.get(id.as_str()).copied();
            let work = source.map(|row| &row.work);
            let lifecycle = work.map_or(
                boreal_domain::PersistedLifecycle::Open,
                |work| work.lifecycle,
            );
            let revision_for_work = source
                .and_then(|row| row.action_facts.entity_revision)
                .unwrap_or(0);
            let identity = projected_item
                .and_then(|item| item.canonical_inputs.as_ref())
                .map(|facts| facts.subject.clone())
                .unwrap_or_else(|| {
                    EntityIdentity::new(
                        project_id.clone(),
                        WorkId::new(id.clone()),
                        EntityRevision::new(revision_for_work),
                    )
                });
            let (execution_mode, invalid_mode) = match node.map(|node| node.execution_mode.as_str()) {
                Some("container") => (ExecutionMode::Container, None),
                Some("direct") => (ExecutionMode::Direct, None),
                Some(value) => (ExecutionMode::Direct, Some(format!("invalid_execution_mode:{value}"))),
                None => (ExecutionMode::Direct, Some("work_node_missing".to_owned())),
            };
            let status = projected_item.map_or(boreal_domain::DerivedStatus::Blocked, |item| item.decision.display_status);
            let mut task = TaskRollupInput::new(identity.clone(), execution_mode, lifecycle, status);
            task.requires_reconciliation = true;
            task.claimable_for_actor = projected_item.is_some_and(|item| item.claimable_for_actor());
            task.active_execution = projected_item.is_some_and(|item| item.attempt.is_some());
            task.accepted_outcome = snapshot.accepted_outcomes.get(&id).map(|outcome| {
                AcceptedOutcome::new(
                    EntityIdentity::new(
                        ProjectId::new(outcome.project_id.clone()),
                        WorkId::new(outcome.work_id.clone()),
                        EntityRevision::new(outcome.entity_revision),
                    ),
                    ProofRevision::new(outcome.proof_revision),
                    ContentDigest::new(outcome.summary_digest.clone()),
                )
            });
            task.disposition = snapshot.dispositions.get(&id).and_then(|disposition| {
                let reason = disposition.reason.clone().unwrap_or_default();
                match disposition.kind.as_str() {
                    "accepted_closed" => Some(ScopeDisposition::AcceptedClosed {
                        entity_revision: EntityRevision::new(disposition.descendant_revision),
                        outcome_digest: ContentDigest::new(disposition.descendant_outcome_digest.clone()),
                    }),
                    "accepted_cancelled" => Some(ScopeDisposition::AcceptedCancelled {
                        entity_revision: EntityRevision::new(disposition.descendant_revision),
                        outcome_digest: ContentDigest::new(disposition.descendant_outcome_digest.clone()),
                    }),
                    "deferred" => Some(ScopeDisposition::deferred(reason)),
                    "replaced" => disposition.replacement_work_id.as_ref().map(|replacement| {
                        ScopeDisposition::replaced(WorkId::new(replacement.clone()), reason)
                    }),
                    _ => None,
                }
            });
            if let Some(item) = projected_item {
                task.gate_gaps = item.gates.missing.iter().cloned().map(Into::into).collect();
                task.overdue = source
                    .and_then(|row| row.schedule)
                    .and_then(|schedule| schedule.due_at)
                    .is_some_and(|due| as_of >= due);
                task.blockers = item.decision.reason_codes.iter().filter_map(|reason| match reason {
                    boreal_domain::ReasonCode::HardHold(_)
                    | boreal_domain::ReasonCode::PrerequisiteOpen(_)
                    | boreal_domain::ReasonCode::AttemptActive
                    | boreal_domain::ReasonCode::NotPublished
                    | boreal_domain::ReasonCode::GateFailed(_)
                    | boreal_domain::ReasonCode::GateMissing(_)
                    | boreal_domain::ReasonCode::GateInvalid(_)
                    | boreal_domain::ReasonCode::ReviewRejected(_)
                    | boreal_domain::ReasonCode::ExpiryReviewRequired
                    | boreal_domain::ReasonCode::VerificationRequired
                    | boreal_domain::ReasonCode::ReviewRequired
                    | boreal_domain::ReasonCode::CloseoutPending
                    | boreal_domain::ReasonCode::LeaseElapsed
                    | boreal_domain::ReasonCode::HardBudgetElapsed => Some(RollupBlocker::new(WorkId::new(id.clone()), reason.stable_code())),
                    _ => None,
                }).collect();
                task.integrity = match item.canonical_inputs.as_ref().map(|facts| facts.integrity.level) {
                    Some(boreal_domain::decision_inputs::IntegrityLevel::Valid) if invalid_mode.is_none() => DescendantIntegrity::Valid,
                    Some(boreal_domain::decision_inputs::IntegrityLevel::Degraded) => DescendantIntegrity::Degraded { code: "decision_facts_degraded".into() },
                    _ => DescendantIntegrity::Corrupt { code: invalid_mode.unwrap_or_else(|| "decision_facts_unavailable".into()) },
                };
            } else {
                task.integrity = DescendantIntegrity::Corrupt {
                    code: invalid_mode.unwrap_or_else(|| "status_projection_unavailable".to_owned()),
                };
                diagnostics.push(boreal_store::StatusRecordDiagnostic {
                    work_id: id.clone(),
                    title: work.map(|work| work.title.clone()),
                    code: "container_descendant_unreadable".to_owned(),
                    detail: "descendant is absent from the canonical status projection".to_owned(),
                });
            }
            descendants.push(task);
        }
        let container_row = work_by_id.get(container_id).copied();
        let entity_revision = container_row
            .and_then(|row| row.action_facts.entity_revision)
            .unwrap_or(0);
        let mut input = ContainerRollupInput::new(
            RollupScope::container(
                project_id.clone(),
                WorkId::new(container_id),
                EntityRevision::new(entity_revision),
            ),
            descendants,
        );
        if let Some(row) = container_row {
            input.lifecycle = row.work.lifecycle;
            input.summary_present = !row.work.description.trim().is_empty();
        }
        let rollup = evaluate_container_rollup(&input);
        Ok(ContainerRollupView {
            diagnostics,
            project_id: project_id.clone(),
            revision,
            container: snapshot.container,
            rollup,
        })
    }

    pub fn intake_items_v3(
        &self,
        project_id: &ProjectId,
    ) -> Result<IntakeItemsView, ApplicationError> {
        if !self.store_ref().work_model_v3_enabled()? {
            return Err(ApplicationError::Invalid(
                "intake requires work-model/3 to be enabled".to_owned(),
            ));
        }
        let (revision, items) = self.store_ref().intake_snapshot_v3(project_id.as_str())?;
        Ok(IntakeItemsView {
            project_id: project_id.clone(),
            revision,
            items,
        })
    }

    /// Install and verify the additive v3 schema through the store-owned
    /// migration boundary.  Existing schema-2 tables remain untouched.
    pub fn ensure_work_model_v3(&self) -> Result<bool, ApplicationError> {
        if self.store_ref().work_model_v3_enabled()? {
            return Ok(false);
        }
        self.store_ref()
            .apply_work_model_v3(include_str!("../../../project/spec/schema-v3.sql"))?;
        Ok(true)
    }

    pub fn work_model_v3_enabled(&self) -> Result<bool, ApplicationError> {
        Ok(self.store_ref().work_model_v3_enabled()?)
    }

    pub fn create_work_node_v3(
        &self,
        scope: &PlanningScope,
        operation_id: impl Into<String>,
        node: &boreal_domain::work_model_v3::WorkNode,
        now: &str,
    ) -> Result<OperationResult<()>, ApplicationError> {
        ensure_mutation_scope(self.store_ref(), scope)?;
        if node.project_id != scope.project_id {
            return Err(ApplicationError::Planning(PlanningError::ScopeConflict {
                expected: scope.project_id.to_string(),
                actual: node.project_id.to_string(),
            }));
        }
        validate_nonempty("work_id", node.id.as_str())?;
        validate_nonempty("work title", &node.title)?;
        let operation_id = operation_id.into();
        let input = WorkNodeV3Input {
            project_id: node.project_id.to_string(),
            work_id: node.id.to_string(),
            decomposition_kind: match node.kind {
                boreal_domain::work_model_v3::DecompositionKind::Milestone => "milestone",
                boreal_domain::work_model_v3::DecompositionKind::Task => "task",
            }
            .to_owned(),
            execution_mode: match node.execution_mode {
                boreal_domain::work_model_v3::ExecutionMode::Direct => "direct",
                boreal_domain::work_model_v3::ExecutionMode::Container => "container",
            }
            .to_owned(),
            parent_id: node.parent_id.as_ref().map(ToString::to_string),
            created_at: now.to_owned(),
            updated_at: now.to_owned(),
        };
        let mutation = self.store_ref().create_work_node_v3(
            &v3_context(
                scope,
                &operation_id,
                "work.node.create/v3",
                node.id.as_str(),
                now,
            ),
            &input,
        )?;
        Ok(operation_result(operation_id, mutation))
    }

    pub fn create_cycle_series_v3(
        &self,
        scope: &PlanningScope,
        operation_id: impl Into<String>,
        series: &CycleSeries,
        timezone: &str,
        tzdb_identity: &str,
        now: &str,
    ) -> Result<OperationResult<()>, ApplicationError> {
        ensure_mutation_scope(self.store_ref(), scope)?;
        if series.project_id != scope.project_id {
            return Err(ApplicationError::Planning(PlanningError::ScopeConflict {
                expected: scope.project_id.to_string(),
                actual: series.project_id.to_string(),
            }));
        }
        validate_nonempty("cycle series id", series.id.as_str())?;
        validate_nonempty("cycle series name", &series.name)?;
        validate_nonempty("cycle timezone", timezone)?;
        validate_nonempty("tzdb identity", tzdb_identity)?;
        let operation_id = operation_id.into();
        let mutation = self.store_ref().create_cycle_series_v3(
            &v3_context(
                scope,
                &operation_id,
                "cycle.series.create/v3",
                series.id.as_str(),
                now,
            ),
            &CycleSeriesV3Input {
                project_id: series.project_id.to_string(),
                series_id: series.id.to_string(),
                name: series.name.clone(),
                lifecycle: series_lifecycle(series.lifecycle),
                timezone: timezone.to_owned(),
                tzdb_identity: tzdb_identity.to_owned(),
                created_at: now.to_owned(),
                updated_at: now.to_owned(),
            },
        )?;
        Ok(operation_result(operation_id, mutation))
    }

    pub fn create_cycle_template_v3(
        &self,
        scope: &PlanningScope,
        operation_id: impl Into<String>,
        template: &CycleTemplate,
        now: &str,
        tzdb_identity: &str,
    ) -> Result<OperationResult<()>, ApplicationError> {
        ensure_mutation_scope(self.store_ref(), scope)?;
        template
            .validate()
            .map_err(PlanningError::from)
            .map_err(ApplicationError::from)?;
        if tzdb_identity.trim().is_empty() {
            return Err(ApplicationError::Planning(PlanningError::Invalid(
                "cycle template requires a real tzdb identity".to_owned(),
            )));
        }
        let series_row = self
            .store_ref()
            .cycle_series_v3(scope.project_id.as_str(), template.series_id.as_str())?
            .ok_or_else(|| boreal_store::StoreError::NotFound {
                entity: "cycle_series_v3",
                id: template.series_id.to_string(),
            })?;
        if series_row.timezone != template.timezone {
            return Err(ApplicationError::Planning(PlanningError::Invalid(
                "cycle template timezone must match its series".to_owned(),
            )));
        }
        if series_row.tzdb_identity != tzdb_identity {
            return Err(ApplicationError::Planning(PlanningError::Invalid(
                "cycle template tzdb identity must match its series".to_owned(),
            )));
        }
        let operation_id = operation_id.into();
        let recurrence = &template.recurrence;
        let mutation = self.store_ref().create_cycle_template_v3(
            &v3_context(
                scope,
                &operation_id,
                "cycle.template.create/v3",
                template.id.as_str(),
                now,
            ),
            &CycleTemplateV3Input {
                project_id: scope.project_id.to_string(),
                template_version_id: template.id.to_string(),
                series_id: template.series_id.to_string(),
                version: u64::from(template.version),
                effective_from_slot_ordinal: template.effective_from_slot_ordinal,
                interval_weeks: u64::from(recurrence.interval_weeks),
                anchor_local_date: format_local_date(recurrence.anchor_local_start.date),
                anchor_local_time: format_local_time(recurrence.anchor_local_start.time),
                anchor_weekday: recurrence
                    .anchor_local_start
                    .weekday()
                    .map_err(PlanningError::from)
                    .map_err(ApplicationError::from)?,
                recurrence_end_kind: recurrence_end_kind(recurrence.end),
                recurrence_end_count: recurrence_end_count(recurrence.end),
                recurrence_end_local_date: recurrence_end_date(recurrence.end),
                name_pattern: template.name_pattern.clone(),
                goal_template: template.goal_template.clone(),
                timezone: template.timezone.clone(),
                tzdb_identity: tzdb_identity.to_owned(),
                gap_policy: gap_policy(recurrence.gap_policy),
                fold_policy: fold_policy(recurrence.fold_policy),
                weekdays: recurrence.weekdays.iter().copied().collect(),
                created_at: now.to_owned(),
            },
        )?;
        Ok(operation_result(operation_id, mutation))
    }

    pub fn create_cycle_instance_v3(
        &self,
        scope: &PlanningScope,
        operation_id: impl Into<String>,
        cycle: &CycleInstance,
        goal: &str,
        lifecycle: CycleLifecycle,
        now: &str,
    ) -> Result<OperationResult<()>, ApplicationError> {
        ensure_mutation_scope(self.store_ref(), scope)?;
        cycle
            .validate()
            .map_err(PlanningError::from)
            .map_err(ApplicationError::from)?;
        if cycle.project_id != scope.project_id {
            return Err(ApplicationError::Planning(PlanningError::ScopeConflict {
                expected: scope.project_id.to_string(),
                actual: cycle.project_id.to_string(),
            }));
        }
        validate_nonempty("cycle id", cycle.id.as_str())?;
        validate_nonempty("cycle name", &cycle.name)?;
        let operation_id = operation_id.into();
        let start = &cycle.scheduled_start;
        let mutation = self.store_ref().create_cycle_v3(
            &v3_context(
                scope,
                &operation_id,
                "cycle.create/v3",
                cycle.id.as_str(),
                now,
            ),
            &CycleV3Input {
                project_id: cycle.project_id.to_string(),
                cycle_id: cycle.id.to_string(),
                series_id: cycle.series_id.to_string(),
                template_version_id: cycle.template_version_id.to_string(),
                slot_ordinal: cycle.slot_ordinal,
                name: cycle.name.clone(),
                goal: goal.to_owned(),
                lifecycle: cycle_lifecycle(lifecycle),
                scheduled_start_utc_ms: i64::try_from(start.utc_instant.as_millis()).map_err(
                    |_| {
                        ApplicationError::Invalid("cycle timestamp exceeds SQLite range".to_owned())
                    },
                )?,
                scheduled_end_utc_ms: cycle
                    .scheduled_end
                    .as_ref()
                    .map(|end| i64::try_from(end.utc_instant.as_millis()))
                    .transpose()
                    .map_err(|_| {
                        ApplicationError::Invalid("cycle timestamp exceeds SQLite range".to_owned())
                    })?,
                scheduled_start_local: format_local_datetime(start.nominal_local),
                scheduled_start_utc_offset_minutes: i64::from(start.utc_offset_minutes),
                timezone: start.timezone.clone(),
                tzdb_identity: start.tzdb_identity.clone(),
                gap_policy: gap_policy(start.gap_policy),
                fold_policy: fold_policy(start.fold_policy),
                created_at: now.to_owned(),
                updated_at: now.to_owned(),
            },
        )?;
        Ok(operation_result(operation_id, mutation))
    }

    pub fn assign_cycle_work_v3(
        &self,
        scope: &PlanningScope,
        operation_id: impl Into<String>,
        assignment: &CycleAssignment,
        now: &str,
    ) -> Result<OperationResult<()>, ApplicationError> {
        ensure_mutation_scope(self.store_ref(), scope)?;
        if assignment.project_id != scope.project_id {
            return Err(ApplicationError::Planning(PlanningError::ScopeConflict {
                expected: scope.project_id.to_string(),
                actual: assignment.project_id.to_string(),
            }));
        }
        let cycle = self
            .store_ref()
            .cycle_v3(scope.project_id.as_str(), assignment.cycle_id.as_str())?
            .ok_or_else(|| boreal_store::StoreError::NotFound {
                entity: "cycle_v3",
                id: assignment.cycle_id.to_string(),
            })?;
        let work = self
            .store_ref()
            .work_node_v3(scope.project_id.as_str(), assignment.work_id.as_str())?
            .ok_or_else(|| boreal_store::StoreError::NotFound {
                entity: "work_node_v3",
                id: assignment.work_id.to_string(),
            })?;
        if cycle.project_id.as_str() != assignment.project_id.as_str()
            || work.project_id.as_str() != assignment.project_id.as_str()
        {
            return Err(ApplicationError::Planning(PlanningError::ScopeConflict {
                expected: scope.project_id.to_string(),
                actual: assignment.project_id.to_string(),
            }));
        }
        let operation_id = operation_id.into();
        let mutation = self.store_ref().assign_cycle_work_v3(
            &v3_context(
                scope,
                &operation_id,
                "cycle.assignment.create/v3",
                &assignment.id,
                now,
            ),
            &CycleAssignmentV3Input {
                project_id: assignment.project_id.to_string(),
                assignment_id: assignment.id.clone(),
                cycle_id: assignment.cycle_id.to_string(),
                work_id: assignment.work_id.to_string(),
                state: assignment_state(assignment.state),
                activation_policy: activation_policy(assignment.activation_policy),
                activation_at_utc_ms: assignment
                    .activation_at
                    .map(|at| i64::try_from(at.as_millis()))
                    .transpose()
                    .map_err(|_| {
                        ApplicationError::Invalid(
                            "activation timestamp exceeds SQLite range".to_owned(),
                        )
                    })?,
                predecessor_id: assignment.predecessor_id.clone(),
                successor_id: assignment.successor_id.clone(),
                created_at: now.to_owned(),
                updated_at: now.to_owned(),
            },
        )?;
        Ok(operation_result(operation_id, mutation))
    }

    pub fn create_intake_bucket_v3(
        &self,
        scope: &PlanningScope,
        operation_id: impl Into<String>,
        bucket: &IntakeBucket,
        now: &str,
    ) -> Result<OperationResult<()>, ApplicationError> {
        ensure_mutation_scope(self.store_ref(), scope)?;
        if bucket.project_id != scope.project_id {
            return Err(ApplicationError::Planning(PlanningError::ScopeConflict {
                expected: scope.project_id.to_string(),
                actual: bucket.project_id.to_string(),
            }));
        }
        validate_nonempty("intake bucket id", bucket.id.as_str())?;
        validate_nonempty("intake bucket name", &bucket.name)?;
        let operation_id = operation_id.into();
        let mutation = self.store_ref().create_intake_bucket_v3(
            &v3_context(
                scope,
                &operation_id,
                "intake.bucket.create/v3",
                bucket.id.as_str(),
                now,
            ),
            &IntakeBucketV3Input {
                project_id: bucket.project_id.to_string(),
                bucket_id: bucket.id.to_string(),
                name: bucket.name.clone(),
                archived: bucket.archived,
                created_at: now.to_owned(),
                updated_at: now.to_owned(),
            },
        )?;
        Ok(operation_result(operation_id, mutation))
    }

    pub fn create_intake_item_v3(
        &self,
        scope: &PlanningScope,
        operation_id: impl Into<String>,
        item: &IntakeItem,
        captured_at: &str,
        updated_at: &str,
    ) -> Result<OperationResult<()>, ApplicationError> {
        ensure_mutation_scope(self.store_ref(), scope)?;
        if item.project_id != scope.project_id {
            return Err(ApplicationError::Planning(PlanningError::ScopeConflict {
                expected: scope.project_id.to_string(),
                actual: item.project_id.to_string(),
            }));
        }
        validate_nonempty("intake id", item.id.as_str())?;
        if item.content.trim().is_empty() {
            return Err(ApplicationError::Invalid(
                "intake content is required".to_owned(),
            ));
        }
        if item.content_revision == 0 {
            return Err(ApplicationError::Invalid(
                "intake content_revision must be positive".to_owned(),
            ));
        }
        let expected_digest = crate::sha256_content_digest(item.content.as_bytes());
        if item.content_digest != expected_digest {
            return Err(ApplicationError::Planning(PlanningError::Invalid(
                "intake content_digest does not match content".to_owned(),
            )));
        }
        let operation_id = operation_id.into();
        let mutation = self.store_ref().create_intake_item_v3(
            &v3_context(
                scope,
                &operation_id,
                "intake.item.create/v3",
                item.id.as_str(),
                updated_at,
            ),
            &IntakeItemV3Input {
                project_id: item.project_id.to_string(),
                intake_id: item.id.to_string(),
                bucket_id: item.bucket_id.to_string(),
                kind: intake_kind(item.kind),
                lifecycle: intake_lifecycle(item.lifecycle),
                content: item.content.clone(),
                content_revision: item.content_revision,
                content_digest: item.content_digest.clone(),
                captured_at: captured_at.to_owned(),
                updated_at: updated_at.to_owned(),
                revisit_at_utc_ms: item
                    .revisit_at
                    .map(|at| i64::try_from(at.as_millis()))
                    .transpose()
                    .map_err(|_| {
                        ApplicationError::Invalid(
                            "revisit timestamp exceeds SQLite range".to_owned(),
                        )
                    })?,
            },
        )?;
        Ok(operation_result(operation_id, mutation))
    }

    pub fn promote_intake_v3(
        &self,
        scope: &PlanningScope,
        operation_id: impl Into<String>,
        promotion: &IntakePromotion,
        now: &str,
    ) -> Result<OperationResult<()>, ApplicationError> {
        ensure_mutation_scope(self.store_ref(), scope)?;
        if promotion.project_id != scope.project_id {
            return Err(ApplicationError::Planning(PlanningError::ScopeConflict {
                expected: scope.project_id.to_string(),
                actual: promotion.project_id.to_string(),
            }));
        }
        validate_nonempty("promotion id", promotion.id.as_str())?;
        validate_nonempty("promotion target id", &promotion.target_id)?;
        // The store trigger checks the intake revision/digest in the same
        // transaction as the insert. Avoid a mutable pre-read here: a retry
        // must reach the store's replay-first path even if the intake changed
        // after the original promotion committed.
        let operation_id = operation_id.into();
        let mutation = self.store_ref().promote_intake_v3(
            &v3_context(
                scope,
                &operation_id,
                "intake.promote/v3",
                promotion.intake_id.as_str(),
                now,
            ),
            &IntakePromotionV3Input {
                project_id: promotion.project_id.to_string(),
                promotion_id: promotion.id.to_string(),
                intake_id: promotion.intake_id.to_string(),
                intake_revision: promotion.intake_revision,
                intake_digest: promotion.intake_digest.clone(),
                target_kind: promotion_target_kind(promotion.target_kind),
                target_id: promotion.target_id.clone(),
                actor_id: scope.actor_id.clone(),
                operation_id: operation_id.clone(),
                created_at: now.to_owned(),
            },
        )?;
        Ok(operation_result(operation_id, mutation))
    }

    pub fn append_container_disposition_v3(
        &self,
        scope: &PlanningScope,
        operation_id: impl Into<String>,
        disposition: &boreal_domain::work_model_v3::ContainerDisposition,
        now: &str,
    ) -> Result<OperationResult<()>, ApplicationError> {
        ensure_mutation_scope(self.store_ref(), scope)?;
        if disposition.project_id != scope.project_id {
            return Err(ApplicationError::Planning(PlanningError::ScopeConflict {
                expected: scope.project_id.to_string(),
                actual: disposition.project_id.to_string(),
            }));
        }
        validate_disposition_shape(disposition)?;
        let operation_id = operation_id.into();
        let mutation = self.store_ref().append_container_disposition_v3(
            &v3_context(
                scope,
                &operation_id,
                "container.disposition.append/v3",
                disposition.container_id.as_str(),
                now,
            ),
            &ContainerDispositionV3Input {
                project_id: disposition.project_id.to_string(),
                disposition_id: disposition.id.to_string(),
                container_work_id: disposition.container_id.to_string(),
                descendant_work_id: disposition.descendant_id.to_string(),
                kind: disposition_kind(disposition.kind),
                descendant_revision: disposition.descendant_revision,
                descendant_outcome_digest: disposition.descendant_outcome_digest.clone(),
                replacement_work_id: disposition.replacement_id.as_ref().map(ToString::to_string),
                reason: disposition.reason.clone(),
                supersedes_id: disposition.supersedes_id.as_ref().map(ToString::to_string),
                created_at: now.to_owned(),
            },
        )?;
        Ok(operation_result(operation_id, mutation))
    }

    pub fn plan_work_edit(
        &self,
        snapshot: &HierarchySnapshot,
        request: &WorkEditRequest,
    ) -> Result<PlannedOperation<boreal_domain::work_model_v3::WorkNode>, ApplicationError> {
        plan_work_edit(snapshot, request).map_err(ApplicationError::from)
    }

    pub fn plan_dependency_change(
        &self,
        snapshot: &HierarchySnapshot,
        scope: &PlanningScope,
        operation_id: impl Into<String>,
        change: DependencyChange,
    ) -> Result<
        PlannedOperation<Vec<boreal_domain::work_model_v3::DirectDependency>>,
        ApplicationError,
    > {
        plan_dependency_change(snapshot, scope, operation_id, change)
            .map_err(ApplicationError::from)
    }

    pub fn plan_work_policy(
        &self,
        scope: &PlanningScope,
        actual_revision: u64,
        operation_id: impl Into<String>,
        current: &boreal_domain::WorkItem,
        patch: &WorkPolicyPatch,
    ) -> Result<PlannedOperation<boreal_domain::WorkItem>, ApplicationError> {
        plan_work_policy(scope, actual_revision, operation_id, current, patch)
            .map_err(ApplicationError::from)
    }

    pub fn plan_cycle_create(
        &self,
        snapshot: &HierarchySnapshot,
        request: &CycleCreateRequest,
    ) -> Result<PlannedOperation<boreal_domain::work_model_v3::Cycle>, ApplicationError> {
        plan_cycle_create(snapshot, request).map_err(ApplicationError::from)
    }

    pub fn plan_cycle_activation(
        &self,
        snapshot: &HierarchySnapshot,
        request: &CycleActivationRequest,
    ) -> Result<PlannedOperation<boreal_domain::work_model_v3::Cycle>, ApplicationError> {
        plan_cycle_activation(snapshot, request).map_err(ApplicationError::from)
    }

    pub fn plan_cycle_slot(
        &self,
        request: &CycleSlotRequest,
        tzdb: &SystemTimeZoneDatabase,
    ) -> Result<PlannedOperation<boreal_domain::work_model_v3::CycleInstance>, ApplicationError>
    {
        plan_cycle_slot(request, tzdb).map_err(ApplicationError::from)
    }

    /// Prepare a session-end operation without silently releasing live work.
    /// The current store has no session-end transaction yet; the returned plan
    /// tells the service whether a fenced attempt release is required first.
    pub fn prepare_session_end(
        &self,
        request: &SessionEndRequest,
    ) -> Result<SessionEndPlan, ApplicationError> {
        if request.project_id.as_str().trim().is_empty()
            || request.actor_id.trim().is_empty()
            || request.session_id.as_str().trim().is_empty()
        {
            return Err(ApplicationError::Invalid(
                "session end scope is incomplete".to_owned(),
            ));
        }
        let session = self
            .store_ref()
            .session(request.project_id.as_str(), request.session_id.as_str())?
            .ok_or_else(|| boreal_store::StoreError::NotFound {
                entity: "session",
                id: request.session_id.to_string(),
            })?;
        if session.actor_id != request.actor_id {
            return Err(ApplicationError::Planning(PlanningError::ScopeConflict {
                expected: session.actor_id,
                actual: request.actor_id.clone(),
            }));
        }
        let current_attempt = self.store_ref().current_attempt_for_session(
            request.project_id.as_str(),
            request.session_id.as_str(),
        )?;
        if current_attempt.is_some() && !request.confirm_release {
            return Err(ApplicationError::Planning(PlanningError::Invalid(
                "session has live work; confirm fenced release before ending".to_owned(),
            )));
        }
        let requires_release = current_attempt.is_some();
        Ok(SessionEndPlan {
            session,
            current_attempt,
            requires_release,
            operation_id: request.operation_id.clone(),
        })
    }

    /// Read-only restart assessment for operator recovery.  It intentionally
    /// does not mark unknown work safe or force-break a lock.
    pub fn assess_operator_recovery(
        &self,
        project_id: &ProjectId,
    ) -> Result<OperatorRecoveryAssessment, ApplicationError> {
        let incomplete = self
            .store_ref()
            .list_incomplete_evidence_executions()?
            .into_iter()
            .filter(|execution| execution.project_id == project_id.as_str())
            .collect();
        Ok(OperatorRecoveryAssessment {
            project_id: project_id.clone(),
            incomplete_evidence_executions: incomplete,
            requires_explicit_reconciliation: true,
        })
    }
}

fn cycle_model(record: &boreal_store::CycleV3Record) -> Result<Cycle, ApplicationError> {
    let mut cycle = Cycle::new(
        ProjectId::new(record.project_id.clone()),
        CycleId::new(record.cycle_id.clone()),
        record.name.clone(),
    );
    cycle.goal = record.goal.clone();
    cycle.lifecycle = match record.lifecycle.as_str() {
        "planned" => CycleLifecycle::Planned,
        "active" => CycleLifecycle::Active,
        "completed" => CycleLifecycle::Completed,
        "cancelled" => CycleLifecycle::Cancelled,
        value => return Err(ApplicationError::Invalid(format!("unknown cycle lifecycle {value}"))),
    };
    let timestamp = |value: i64| -> Result<TimestampMs, ApplicationError> {
        u64::try_from(value)
            .map(TimestampMs::from_millis)
            .map_err(|_| ApplicationError::Invalid("cycle schedule timestamp is negative".into()))
    };
    cycle.scheduled_start_at = Some(timestamp(record.scheduled_start_utc_ms)?);
    cycle.scheduled_end_at = record.scheduled_end_utc_ms.map(timestamp).transpose()?;
    Ok(cycle)
}

fn cycle_assignment_model(
    record: &boreal_store::CycleAssignmentV3Record,
) -> (CycleAssignment, Vec<String>) {
    let mut diagnostics = Vec::new();
    let state = match record.state.as_str() {
        "planned" => CycleAssignmentState::Planned,
        "committed" => CycleAssignmentState::Committed,
        "removed" => CycleAssignmentState::Removed,
        "completed" => CycleAssignmentState::Completed,
        "carried_over" => CycleAssignmentState::CarriedOver,
        value => {
            diagnostics.push(format!("unknown assignment state {value}"));
            CycleAssignmentState::Planned
        }
    };
    let activation_policy = match record.activation_policy.as_str() {
        "at_cycle_start" => ActivationPolicy::AtCycleStart,
        "immediate" => ActivationPolicy::Immediate,
        "explicit_not_before" => ActivationPolicy::ExplicitNotBefore,
        value => {
            diagnostics.push(format!("unknown activation policy {value}"));
            ActivationPolicy::AtCycleStart
        }
    };
    let activation_at = record.activation_at_utc_ms.and_then(|value| {
        match u64::try_from(value) {
            Ok(value) => Some(TimestampMs::from_millis(value)),
            Err(_) => {
                diagnostics.push("assignment activation timestamp is negative".to_owned());
                None
            }
        }
    });
    (CycleAssignment {
        id: record.assignment_id.clone(),
        cycle_id: CycleId::new(record.cycle_id.clone()),
        work_id: WorkId::new(record.work_id.clone()),
        project_id: ProjectId::new(record.project_id.clone()),
        state,
        activation_policy,
        activation_at,
        predecessor_id: record.predecessor_id.clone(),
        successor_id: record.successor_id.clone(),
    }, diagnostics)
}

fn find_dependency_cycles(edges: &[DependencyEdgeView]) -> Vec<Vec<String>> {
    let mut adjacency = BTreeMap::<String, Vec<String>>::new();
    let mut nodes = BTreeSet::new();
    for edge in edges {
        nodes.insert(edge.prerequisite_id.clone());
        nodes.insert(edge.dependent_id.clone());
        adjacency
            .entry(edge.prerequisite_id.clone())
            .or_default()
            .push(edge.dependent_id.clone());
    }
    for children in adjacency.values_mut() {
        children.sort();
        children.dedup();
    }
    let mut state = BTreeMap::<String, u8>::new();
    let mut stack = Vec::<String>::new();
    let mut found = BTreeSet::<Vec<String>>::new();
    for node in nodes {
        find_dependency_cycles_from(&node, &adjacency, &mut state, &mut stack, &mut found);
    }
    found.into_iter().collect()
}

fn find_dependency_cycles_from(
    node: &str,
    adjacency: &BTreeMap<String, Vec<String>>,
    state: &mut BTreeMap<String, u8>,
    stack: &mut Vec<String>,
    found: &mut BTreeSet<Vec<String>>,
) {
    if state.get(node).copied() == Some(2) {
        return;
    }
    if state.get(node).copied() == Some(1) {
        if let Some(index) = stack.iter().position(|value| value == node) {
            let body = &stack[index..];
            if let Some((offset, _)) = body.iter().enumerate().min_by_key(|(_, value)| *value) {
                let mut canonical = body[offset..].to_vec();
                canonical.extend_from_slice(&body[..offset]);
                canonical.push(canonical[0].clone());
                found.insert(canonical);
            }
        }
        return;
    }
    state.insert(node.to_owned(), 1);
    stack.push(node.to_owned());
    if let Some(children) = adjacency.get(node) {
        for child in children {
            find_dependency_cycles_from(child, adjacency, state, stack, found);
        }
    }
    stack.pop();
    state.insert(node.to_owned(), 2);
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SessionEndRequest {
    pub project_id: ProjectId,
    pub actor_id: String,
    pub session_id: SessionId,
    pub operation_id: String,
    pub confirm_release: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SessionEndPlan {
    pub session: SessionRecord,
    pub current_attempt: Option<AttemptRecord>,
    pub requires_release: bool,
    pub operation_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OperatorRecoveryAssessment {
    pub project_id: ProjectId,
    pub incomplete_evidence_executions: Vec<boreal_store::EvidenceExecutionRecord>,
    pub requires_explicit_reconciliation: bool,
}

fn ensure_mutation_scope(
    store: &boreal_store::SqliteStore,
    scope: &PlanningScope,
) -> Result<(), ApplicationError> {
    scope.validate().map_err(ApplicationError::from)?;
    // The v3 store mutation owns the replay-first, transactional expected
    // revision check.  Do not perform a read-before-write revision check here:
    // a retry must be able to replay after the project revision has advanced.
    if scope.expected_revision.is_none() {
        return Err(ApplicationError::Planning(PlanningError::Invalid(
            "v3 mutations require expected_revision".to_owned(),
        )));
    }
    Ok(())
}

fn v3_context(
    scope: &PlanningScope,
    operation_id: &str,
    command: &str,
    subject_id: &str,
    now: &str,
) -> V3MutationContext {
    V3MutationContext {
        project_id: scope.project_id.to_string(),
        actor_id: scope.actor_id.clone(),
        session_id: scope.session_id.clone(),
        operation_id: operation_id.to_owned(),
        request_digest: canonical_request_digest(
            command,
            serde_json::json!({
                "project_id": scope.project_id.as_str(),
                "actor_id": scope.actor_id,
                "session_id": scope.session_id,
                "subject_id": subject_id,
                "expected_revision": scope.expected_revision,
            }),
        ),
        expected_revision: scope.expected_revision,
        now: now.to_owned(),
    }
}

fn validate_nonempty(field: &'static str, value: &str) -> Result<(), ApplicationError> {
    if value.trim().is_empty() {
        return Err(ApplicationError::Invalid(format!("{field} is required")));
    }
    Ok(())
}

fn validate_disposition_shape(
    disposition: &boreal_domain::work_model_v3::ContainerDisposition,
) -> Result<(), ApplicationError> {
    use boreal_domain::work_model_v3::DispositionKind;

    if disposition.container_id == disposition.descendant_id {
        return Err(ApplicationError::Invalid(
            "container disposition cannot target its container".to_owned(),
        ));
    }
    validate_nonempty(
        "descendant outcome digest",
        &disposition.descendant_outcome_digest,
    )?;
    match disposition.kind {
        DispositionKind::AcceptedClosed | DispositionKind::AcceptedCancelled
            if disposition.replacement_id.is_some() =>
        {
            Err(ApplicationError::Invalid(
                "accepted disposition cannot name a replacement".to_owned(),
            ))
        }
        DispositionKind::Deferred
            if disposition
                .reason
                .as_deref()
                .unwrap_or("")
                .trim()
                .is_empty() =>
        {
            Err(ApplicationError::Invalid(
                "deferred disposition requires a reason".to_owned(),
            ))
        }
        DispositionKind::Deferred if disposition.replacement_id.is_some() => Err(
            ApplicationError::Invalid("deferred disposition cannot name a replacement".to_owned()),
        ),
        DispositionKind::Replaced
            if disposition.replacement_id.is_none()
                || disposition
                    .reason
                    .as_deref()
                    .unwrap_or("")
                    .trim()
                    .is_empty() =>
        {
            Err(ApplicationError::Invalid(
                "replacement disposition requires replacement and reason".to_owned(),
            ))
        }
        _ => Ok(()),
    }
}

fn operation_result(operation_id: String, mutation: MutationResult) -> OperationResult<()> {
    OperationResult {
        operation_id,
        snapshot_revision: mutation.revision,
        changed: !mutation.replayed,
        value: (),
    }
}

fn series_lifecycle(value: CycleSeriesLifecycle) -> String {
    match value {
        CycleSeriesLifecycle::Active => "active",
        CycleSeriesLifecycle::Paused => "paused",
        CycleSeriesLifecycle::Retired => "retired",
    }
    .to_owned()
}

fn cycle_lifecycle(value: CycleLifecycle) -> String {
    match value {
        CycleLifecycle::Planned => "planned",
        CycleLifecycle::Active => "active",
        CycleLifecycle::Completed => "completed",
        CycleLifecycle::Cancelled => "cancelled",
    }
    .to_owned()
}

fn assignment_state(value: CycleAssignmentState) -> String {
    match value {
        CycleAssignmentState::Planned => "planned",
        CycleAssignmentState::Committed => "committed",
        CycleAssignmentState::Removed => "removed",
        CycleAssignmentState::Completed => "completed",
        CycleAssignmentState::CarriedOver => "carried_over",
    }
    .to_owned()
}

fn activation_policy(value: ActivationPolicy) -> String {
    match value {
        ActivationPolicy::AtCycleStart => "at_cycle_start",
        ActivationPolicy::Immediate => "immediate",
        ActivationPolicy::ExplicitNotBefore => "explicit_not_before",
    }
    .to_owned()
}

fn gap_policy(value: GapPolicy) -> String {
    match value {
        GapPolicy::NextValid => "next_valid",
    }
    .to_owned()
}

fn fold_policy(value: FoldPolicy) -> String {
    match value {
        FoldPolicy::EarlierOffset => "earlier_offset",
        FoldPolicy::LaterOffset => "later_offset",
    }
    .to_owned()
}

fn recurrence_end_kind(value: boreal_domain::work_model_v3::RecurrenceEnd) -> String {
    match value {
        boreal_domain::work_model_v3::RecurrenceEnd::Never => "never",
        boreal_domain::work_model_v3::RecurrenceEnd::Count(_) => "count",
        boreal_domain::work_model_v3::RecurrenceEnd::UntilLocalDate(_) => "until_local_date",
    }
    .to_owned()
}

fn recurrence_end_count(value: boreal_domain::work_model_v3::RecurrenceEnd) -> Option<u64> {
    match value {
        boreal_domain::work_model_v3::RecurrenceEnd::Count(count) => Some(count),
        _ => None,
    }
}

fn recurrence_end_date(value: boreal_domain::work_model_v3::RecurrenceEnd) -> Option<String> {
    match value {
        boreal_domain::work_model_v3::RecurrenceEnd::UntilLocalDate(date) => {
            Some(format_local_date(date))
        }
        _ => None,
    }
}

fn format_local_date(date: boreal_domain::work_model_v3::LocalDate) -> String {
    format!("{:04}-{:02}-{:02}", date.year, date.month, date.day)
}

fn format_local_time(time: boreal_domain::work_model_v3::LocalTime) -> String {
    format!("{:02}:{:02}:{:02}", time.hour, time.minute, time.second)
}

fn format_local_datetime(value: boreal_domain::work_model_v3::LocalDateTime) -> String {
    format!(
        "{}T{}",
        format_local_date(value.date),
        format_local_time(value.time)
    )
}

fn intake_kind(value: IntakeKind) -> String {
    match value {
        IntakeKind::Note => "note",
        IntakeKind::Discovery => "discovery",
        IntakeKind::Question => "question",
        IntakeKind::Revisit => "revisit",
    }
    .to_owned()
}

fn intake_lifecycle(value: IntakeLifecycle) -> String {
    match value {
        IntakeLifecycle::Captured => "captured",
        IntakeLifecycle::Triaged => "triaged",
        IntakeLifecycle::Deferred => "deferred",
        IntakeLifecycle::Resolved => "resolved",
        IntakeLifecycle::Archived => "archived",
    }
    .to_owned()
}

fn promotion_target_kind(value: PromotionTargetKind) -> String {
    match value {
        PromotionTargetKind::DraftWork => "draft_work",
        PromotionTargetKind::SourceVersion => "source_version",
        PromotionTargetKind::MemoryDraft => "memory_draft",
    }
    .to_owned()
}

fn disposition_kind(value: DispositionKind) -> String {
    match value {
        DispositionKind::AcceptedClosed => "accepted_closed",
        DispositionKind::AcceptedCancelled => "accepted_cancelled",
        DispositionKind::Deferred => "deferred",
        DispositionKind::Replaced => "replaced",
    }
    .to_owned()
}
