//! Calendar resolution and cycle mutation facade. Adapters supply typed input;
//! they never authorize a transition or manufacture accepted work.
use crate::{canonical_request_digest, ApplicationError, PlanningScope, WorkApplication};
use boreal_domain::work_model_v3::{
    CloseoutDispositionId, ContainerCloseoutReport, ContainerDisposition, CycleId,
    DecompositionKind, DispositionKind, ExecutionMode, FoldPolicy, GapPolicy, LocalDateTime,
    WorkNode,
};
use boreal_domain::{ProjectId, WorkId};
use boreal_store::cycle_commands::{
    ContainerDispositionV3Request, CycleChangeRequest, OneOffCycleInput,
};
use boreal_store::{CycleV3Input, MutationResult, V3MutationContext};
use serde_json::json;
use std::collections::BTreeMap;

pub struct CycleCreateInput {
    pub cycle_id: String,
    pub name: String,
    pub goal: String,
    pub timezone: String,
    pub start: LocalDateTime,
    pub end: Option<LocalDateTime>,
    pub later_fold: bool,
    pub reason: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContainerDispositionInput {
    pub disposition_id: String,
    pub container_work_id: String,
    pub descendant_work_id: String,
    pub kind: DispositionKind,
    pub expected_descendant_entity_revision: u64,
    pub replacement_work_id: Option<String>,
    pub reason: Option<String>,
    pub supersedes_id: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContainerScopeReadiness {
    pub project_id: ProjectId,
    pub snapshot_revision: u64,
    pub container_work_id: WorkId,
    pub decision: ContainerCloseoutReport,
    /// These facts are not yet persisted for containers in the current schema
    /// projection. Until their owning profile/closeout path is integrated, this
    /// view can report reconciled scope but must not authorize final closure.
    pub closeout_inputs_pending: Vec<&'static str>,
}

impl WorkApplication<'_> {
    pub fn create_planning_cycle(
        &self,
        scope: &PlanningScope,
        operation: &str,
        input: CycleCreateInput,
        now: &str,
    ) -> Result<MutationResult, ApplicationError> {
        scope.validate()?;
        CycleId::parse(&input.cycle_id).map_err(|e| ApplicationError::Invalid(e.to_string()))?;
        let tz = crate::SystemTimeZoneDatabase::system();
        let fold = if input.later_fold {
            FoldPolicy::LaterOffset
        } else {
            FoldPolicy::EarlierOffset
        };
        let start = tz.resolve(&input.timezone, input.start, GapPolicy::NextValid, fold)?;
        let end = input
            .end
            .map(|value| tz.resolve(&input.timezone, value, GapPolicy::NextValid, fold))
            .transpose()?;
        if end
            .as_ref()
            .is_some_and(|end| end.utc_instant <= start.utc_instant)
        {
            return Err(ApplicationError::Invalid(
                "cycle end must follow start".into(),
            ));
        }
        let date = format!(
            "{:04}-{:02}-{:02}",
            input.start.date.year, input.start.date.month, input.start.date.day
        );
        let time = format!(
            "{:02}:{:02}:{:02}",
            input.start.time.hour, input.start.time.minute, input.start.time.second
        );
        let to_i64 = |v: u64| {
            i64::try_from(v).map_err(|_| {
                ApplicationError::Invalid("cycle timestamp exceeds storage range".into())
            })
        };
        let context = cycle_context(scope, operation, now);
        Ok(self.store_ref().create_oneoff_cycle(
            &context,
            &OneOffCycleInput {
                cycle: CycleV3Input {
                    project_id: scope.project_id.to_string(),
                    series_id: format!("{}:{}:series", scope.project_id, input.cycle_id),
                    template_version_id: format!(
                        "{}:{}:template:1",
                        scope.project_id, input.cycle_id
                    ),
                    cycle_id: input.cycle_id,
                    slot_ordinal: 0,
                    name: input.name,
                    goal: input.goal,
                    lifecycle: "planned".into(),
                    scheduled_start_utc_ms: to_i64(start.utc_instant.as_millis())?,
                    scheduled_end_utc_ms: end
                        .map(|e| to_i64(e.utc_instant.as_millis()))
                        .transpose()?,
                    scheduled_start_local: format!("{date}T{time}"),
                    scheduled_start_utc_offset_minutes: i64::from(start.utc_offset_minutes),
                    timezone: input.timezone,
                    tzdb_identity: start.tzdb_identity,
                    gap_policy: "next_valid".into(),
                    fold_policy: if input.later_fold {
                        "later_offset"
                    } else {
                        "earlier_offset"
                    }
                    .into(),
                    created_at: now.into(),
                    updated_at: now.into(),
                },
                anchor_date: date,
                anchor_time: time,
                anchor_weekday: input
                    .start
                    .weekday()
                    .map_err(|e| ApplicationError::Invalid(e.to_string()))?,
            },
            &input.reason,
        )?)
    }
    pub fn change_planning_cycle(
        &self,
        scope: &PlanningScope,
        operation: &str,
        request: &CycleChangeRequest,
        now: &str,
    ) -> Result<MutationResult, ApplicationError> {
        scope.validate()?;
        Ok(self
            .store_ref()
            .change_cycle(&cycle_context(scope, operation, now), request)?)
    }

    pub fn append_planning_disposition(
        &self,
        scope: &PlanningScope,
        operation: &str,
        request: &ContainerDispositionInput,
        now: &str,
    ) -> Result<MutationResult, ApplicationError> {
        scope.validate()?;
        if scope.expected_revision.is_none() {
            return Err(ApplicationError::Invalid(
                "container dispositions require the reviewed project revision".into(),
            ));
        }
        let kind = match request.kind {
            DispositionKind::AcceptedClosed => "accepted_closed",
            DispositionKind::AcceptedCancelled => "accepted_cancelled",
            DispositionKind::Deferred => "deferred",
            DispositionKind::Replaced => "replaced",
        };
        Ok(self.store_ref().append_container_disposition_checked_v3(
            &cycle_context(scope, operation, now),
            &ContainerDispositionV3Request {
                disposition_id: request.disposition_id.clone(),
                container_work_id: request.container_work_id.clone(),
                descendant_work_id: request.descendant_work_id.clone(),
                kind: kind.into(),
                expected_descendant_entity_revision: request.expected_descendant_entity_revision,
                replacement_work_id: request.replacement_work_id.clone(),
                reason: request.reason.clone(),
                supersedes_id: request.supersedes_id.clone(),
            },
        )?)
    }

    /// Return scope reconciliation for a milestone/container from canonical
    /// work nodes, current append-only disposition tips, active holds and
    /// accepted task outcomes. Planning-profile gates and a container summary
    /// are intentionally reported as pending rather than inferred from task
    /// status or execution attempts.
    pub fn container_scope_readiness_v3(
        &self,
        project_id: &ProjectId,
        container_work_id: &str,
    ) -> Result<ContainerScopeReadiness, ApplicationError> {
        if project_id.as_str().trim().is_empty() || container_work_id.trim().is_empty() {
            return Err(ApplicationError::Invalid(
                "project and container IDs are required".into(),
            ));
        }
        let snapshot = self
            .store_ref()
            .container_closeout_snapshot_v3(project_id.as_str(), container_work_id)?;
        let container = to_domain_node(project_id, &snapshot.container)?;
        let descendants = snapshot
            .descendants
            .iter()
            .map(|node| to_domain_node(project_id, node))
            .collect::<Result<Vec<_>, _>>()?;
        let dispositions = snapshot
            .current_dispositions
            .iter()
            .map(|row| {
                Ok(ContainerDisposition {
                    id: CloseoutDispositionId::new(row.disposition_id.clone()),
                    container_id: WorkId::new(row.container_work_id.clone()),
                    descendant_id: WorkId::new(row.descendant_work_id.clone()),
                    project_id: project_id.clone(),
                    kind: parse_disposition_kind(&row.kind)?,
                    descendant_revision: row.descendant_revision,
                    descendant_outcome_digest: row.descendant_outcome_digest.clone(),
                    replacement_id: row.replacement_work_id.clone().map(WorkId::new),
                    reason: row.reason.clone(),
                    supersedes_id: row.supersedes_id.clone().map(CloseoutDispositionId::new),
                })
            })
            .collect::<Result<Vec<_>, ApplicationError>>()?;
        let accepted = snapshot
            .accepted_closed_outcomes
            .iter()
            .cloned()
            .map(WorkId::new)
            .collect();
        let entity_revisions = snapshot
            .entity_revisions
            .iter()
            .map(|(id, revision)| (WorkId::new(id.clone()), *revision))
            .collect::<BTreeMap<_, _>>();
        let decision = boreal_domain::work_model_v3::evaluate_container_closeout(
            &container,
            &descendants,
            &dispositions,
            &entity_revisions,
            &accepted,
            snapshot.unresolved_holds,
            false,
            false,
        )
        .map_err(|error| ApplicationError::Invalid(error.to_string()))?;
        Ok(ContainerScopeReadiness {
            project_id: project_id.clone(),
            snapshot_revision: snapshot.project_revision,
            container_work_id: WorkId::new(container_work_id),
            decision,
            closeout_inputs_pending: vec!["container planning profile", "container summary"],
        })
    }
}

fn to_domain_node(
    project_id: &ProjectId,
    node: &boreal_store::WorkNodeV3Record,
) -> Result<WorkNode, ApplicationError> {
    let kind = match node.decomposition_kind.as_str() {
        "milestone" => DecompositionKind::Milestone,
        "task" => DecompositionKind::Task,
        _ => {
            return Err(ApplicationError::Invalid(format!(
                "unknown planning kind on {}",
                node.work_id
            )))
        }
    };
    let execution_mode = match node.execution_mode.as_str() {
        "direct" => ExecutionMode::Direct,
        "container" => ExecutionMode::Container,
        _ => {
            return Err(ApplicationError::Invalid(format!(
                "unknown execution mode on {}",
                node.work_id
            )))
        }
    };
    Ok(WorkNode {
        id: WorkId::new(node.work_id.clone()),
        project_id: project_id.clone(),
        kind,
        execution_mode,
        parent_id: node.parent_id.clone().map(WorkId::new),
        title: node.work_id.clone(),
    })
}

fn parse_disposition_kind(value: &str) -> Result<DispositionKind, ApplicationError> {
    match value {
        "accepted_closed" => Ok(DispositionKind::AcceptedClosed),
        "accepted_cancelled" => Ok(DispositionKind::AcceptedCancelled),
        "deferred" => Ok(DispositionKind::Deferred),
        "replaced" => Ok(DispositionKind::Replaced),
        _ => Err(ApplicationError::Invalid(
            "stored container disposition kind is corrupt".into(),
        )),
    }
}
fn cycle_context(scope: &PlanningScope, operation: &str, now: &str) -> V3MutationContext {
    V3MutationContext {
        project_id: scope.project_id.to_string(),
        actor_id: scope.actor_id.clone(),
        session_id: scope.session_id.clone(),
        operation_id: operation.into(),
        request_digest: canonical_request_digest(
            "planning/v1",
            json!({"project_id":scope.project_id.as_str(),"actor_id":scope.actor_id,"session_id":scope.session_id,"expected_revision":scope.expected_revision}),
        ),
        expected_revision: scope.expected_revision,
        now: now.into(),
    }
}
