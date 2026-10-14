//! Transactional persistence adapters for the additive work-model/3 tables.
//!
//! The v3 model is deliberately kept in a child module so the schema-2
//! lifecycle code remains stable while application adapters are introduced.
//! All mutations below use the same operation/revision/audit boundary as the
//! original store; callers never need to issue raw SQL for hierarchy or
//! intake records.

use super::{
    json_object, AuditEventRecord, MutationResult, OperationOutcome, OperationRecord, SqliteStore,
    StatusRecordDiagnostic, StoreError, SQLITE_ROW,
};
use boreal_domain::work_model_v3::{
    BusinessDate, BusinessSchedule, DirectDependency, ExecutionMode, ExternalWait,
    ExternalWaitAccountable, ExternalWaitCategory, ExternalWaitOutcome, ExternalWaitResolution,
    ExternalWaitState, FoldPolicy, GapPolicy, LocalDate, LocalDateTime, LocalTime,
    ProjectCivilTimeSetting, TimeResolution, WorkNode, WorkScheduleRecord,
};
use boreal_domain::{ActorRole, ProjectId, TimestampMs, WorkId};
use serde_json::json;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct V3MutationContext {
    pub project_id: String,
    pub actor_id: String,
    pub session_id: Option<String>,
    pub operation_id: String,
    pub request_digest: String,
    pub expected_revision: Option<u64>,
    pub now: String,
}

impl V3MutationContext {
    /// Bind every semantic input, not just its object identifier. Observation
    /// timestamps are excluded so a lost-response retry can use a new clock.
    pub(crate) fn with_payload(&self, payload: serde_json::Value) -> Self {
        let mut bound = self.clone();
        bound.request_digest = super::checksum(
            json!({
                "schema": "boreal.planning-request.v1",
                "scope_digest": self.request_digest,
                "project_id": self.project_id,
                "actor_id": self.actor_id,
                "session_id": self.session_id,
                "expected_revision": self.expected_revision,
                "payload": payload,
            })
            .to_string()
            .as_bytes(),
        );
        bound
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkNodeV3Input {
    pub project_id: String,
    pub work_id: String,
    pub decomposition_kind: String,
    pub execution_mode: String,
    pub parent_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Canonical work data and the v3 execution mode, created together so every
/// newly planned milestone/task is immediately available to v3 rollups and
/// cycle assignment.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlannedWorkV3Input {
    pub work: boreal_domain::WorkItem,
    pub execution_mode: String,
    pub planning_contract: Option<super::WorkPlanningContractWrite>,
}

/// Fields accepted by the durable v3 planning edit. `parent_id` is the
/// canonical schema-2 parent (a Sprint for nested Tasks); the store derives
/// the flattened v3 milestone parent in the same transaction.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlanningWorkEditV3Input {
    pub project_id: String,
    pub work_id: String,
    pub parent_id: Option<Option<String>>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub priority: Option<u8>,
    pub dispatch_policy: Option<String>,
    pub execution_mode: Option<String>,
    /// A supplied contract replaces the latest immutable planning snapshot.
    /// Empty arrays are an explicit clear and are still recorded as history.
    pub planning_contract: Option<super::WorkPlanningContractWrite>,
    pub updated_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkNodeV3Record {
    pub project_id: String,
    pub work_id: String,
    pub decomposition_kind: String,
    pub execution_mode: String,
    pub parent_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProjectCivilTimeV1Input {
    pub setting: ProjectCivilTimeSetting,
    pub expected_setting_revision: u64,
}

pub type ProjectCivilTimeV1Record = ProjectCivilTimeSetting;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkScheduleV3Input {
    pub record: WorkScheduleRecord,
    pub expected_schedule_revision: u64,
}

pub type WorkScheduleV3Record = WorkScheduleRecord;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExternalWaitV1Input {
    pub wait: ExternalWait,
    pub expected_wait_revision: u64,
}

pub type ExternalWaitV1Record = ExternalWait;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CycleSeriesV3Input {
    pub project_id: String,
    pub series_id: String,
    pub name: String,
    pub lifecycle: String,
    pub timezone: String,
    pub tzdb_identity: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CycleSeriesV3Record {
    pub project_id: String,
    pub series_id: String,
    pub name: String,
    pub lifecycle: String,
    pub timezone: String,
    pub tzdb_identity: String,
    pub revision: u64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CycleTemplateV3Input {
    pub project_id: String,
    pub template_version_id: String,
    pub series_id: String,
    pub version: u64,
    pub effective_from_slot_ordinal: u64,
    pub interval_weeks: u64,
    pub anchor_local_date: String,
    pub anchor_local_time: String,
    pub anchor_weekday: u8,
    pub recurrence_end_kind: String,
    pub recurrence_end_count: Option<u64>,
    pub recurrence_end_local_date: Option<String>,
    pub name_pattern: String,
    pub goal_template: String,
    pub timezone: String,
    pub tzdb_identity: String,
    pub gap_policy: String,
    pub fold_policy: String,
    pub weekdays: Vec<u8>,
    pub created_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CycleV3Input {
    pub project_id: String,
    pub cycle_id: String,
    pub series_id: String,
    pub template_version_id: String,
    pub slot_ordinal: u64,
    pub name: String,
    pub goal: String,
    pub lifecycle: String,
    pub scheduled_start_utc_ms: i64,
    pub scheduled_end_utc_ms: Option<i64>,
    pub scheduled_start_local: String,
    pub scheduled_start_utc_offset_minutes: i64,
    pub timezone: String,
    pub tzdb_identity: String,
    pub gap_policy: String,
    pub fold_policy: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CycleAssignmentV3Input {
    pub project_id: String,
    pub assignment_id: String,
    pub cycle_id: String,
    pub work_id: String,
    pub state: String,
    pub activation_policy: String,
    pub activation_at_utc_ms: Option<i64>,
    pub predecessor_id: Option<String>,
    pub successor_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// The read projections intentionally reuse the validated write shape.  They
/// are value copies, not mutable references to canonical rows.
pub type CycleV3Record = CycleV3Input;
pub type CycleTemplateV3Record = CycleTemplateV3Input;
pub type CycleAssignmentV3Record = CycleAssignmentV3Input;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntakeBucketV3Input {
    pub project_id: String,
    pub bucket_id: String,
    pub name: String,
    pub archived: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntakeItemV3Input {
    pub project_id: String,
    pub intake_id: String,
    pub bucket_id: String,
    pub kind: String,
    pub lifecycle: String,
    pub content: String,
    pub content_revision: u64,
    pub content_digest: String,
    pub captured_at: String,
    pub updated_at: String,
    pub revisit_at_utc_ms: Option<i64>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntakeItemV3Record {
    pub project_id: String,
    pub intake_id: String,
    pub bucket_id: String,
    pub kind: String,
    pub lifecycle: String,
    pub content: String,
    pub content_revision: u64,
    pub content_digest: String,
    pub captured_at: String,
    pub updated_at: String,
    pub revisit_at_utc_ms: Option<i64>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntakePromotionV3Input {
    pub project_id: String,
    pub promotion_id: String,
    pub intake_id: String,
    pub intake_revision: u64,
    pub intake_digest: String,
    pub target_kind: String,
    pub target_id: String,
    pub actor_id: String,
    pub operation_id: String,
    pub created_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContainerDispositionV3Input {
    pub project_id: String,
    pub disposition_id: String,
    pub container_work_id: String,
    pub descendant_work_id: String,
    pub kind: String,
    pub descendant_revision: u64,
    pub descendant_outcome_digest: String,
    pub replacement_work_id: Option<String>,
    pub reason: Option<String>,
    pub supersedes_id: Option<String>,
    pub created_at: String,
}

impl SqliteStore {
    /// Atomically create a draft work target and attach current intake
    /// provenance under one canonical operation, revision, and audit event.
    pub fn create_work_and_promote_intake_v3(
        &self,
        context: &V3MutationContext,
        input: &IntakePromotionV3Input,
        work: &boreal_domain::WorkItem,
    ) -> Result<MutationResult, StoreError> {
        if input.target_kind != "draft_work"
            || input.target_id != work.id.as_str()
            || input.project_id != work.project_id.as_str()
            || input.project_id != context.project_id
            || input.actor_id != context.actor_id
            || input.operation_id != context.operation_id
        {
            return Err(StoreError::Invalid(
                "work creation and intake promotion identity do not match".into(),
            ));
        }
        let bound = context.with_payload(json!({
            "promotion": {
                "project_id": input.project_id,
                "promotion_id": input.promotion_id,
                "intake_id": input.intake_id,
                "intake_revision": input.intake_revision,
                "intake_digest": input.intake_digest,
                "target_kind": input.target_kind,
                "target_id": input.target_id,
            },
            "work": {
                "work_id": work.id.as_str(),
                "kind": format!("{:?}", work.kind).to_ascii_lowercase(),
                "parent_id": work.parent_id.as_ref().map(|id| id.as_str()),
                "title": work.title,
                "description": work.description,
                "lifecycle": format!("{:?}", work.lifecycle).to_ascii_lowercase(),
                "priority": work.priority,
                "dispatch_policy": format!("{:?}", work.dispatch_policy).to_ascii_lowercase(),
                "hard_holds": work.hard_holds.iter().map(|hold| hold.stable_code()).collect::<Vec<_>>(),
                "acceptance_profile": {
                    "id": work.acceptance_profile.id.as_str(),
                    "version": work.acceptance_profile.version,
                    "gates": work.acceptance_profile.gates.iter().map(|gate| json!({
                        "id": gate.id.as_str(),
                        "kind": format!("{:?}", gate.kind).to_ascii_lowercase(),
                        "required": gate.required,
                        "state": format!("{:?}", gate.state).to_ascii_lowercase(),
                    })).collect::<Vec<_>>(),
                },
            },
            "v3_execution_mode": match work.kind {
                boreal_domain::WorkKind::Milestone => Some("container"),
                boreal_domain::WorkKind::Task => Some("direct"),
                boreal_domain::WorkKind::Sprint => None,
            }
        }));
        let context = &bound;
        self.fact_mutation(
            context,
            "intake.promote.create_work",
            "intake",
            &input.intake_id,
            &[boreal_domain::ActorRole::Operator],
            || {
                if work.lifecycle != boreal_domain::PersistedLifecycle::Draft
                    || work.title.trim().is_empty()
                    || work.title.len() > 512
                    || work.description.len() > 65_536
                {
                    return Err(StoreError::Invalid(
                        "promoted work must be a bounded draft with a non-empty title".into(),
                    ));
                }
                if let Some(parent_id) = &work.parent_id {
                    let parent = self
                        .work(&input.project_id, parent_id.as_str())?
                        .ok_or_else(|| {
                            StoreError::Invalid("work parent is not in this project".into())
                        })?;
                    let compatible = matches!(
                        (parent.kind.as_str(), work.kind),
                        ("milestone", boreal_domain::WorkKind::Sprint)
                            | ("sprint", boreal_domain::WorkKind::Task)
                    );
                    if !compatible {
                        return Err(StoreError::Invalid(
                            "work parent kind is incompatible with the promoted work kind".into(),
                        ));
                    }
                } else if work.kind == boreal_domain::WorkKind::Sprint {
                    return Err(StoreError::Invalid("sprints require a parent".into()));
                }
                let v3_parent = if matches!(
                    work.kind,
                    boreal_domain::WorkKind::Milestone | boreal_domain::WorkKind::Task
                ) {
                    Some(self.v3_parent_for_work(work)?)
                } else {
                    None
                };
                self.create_work_in_transaction(work, &input.created_at)?;
                if let Some(parent_id) = v3_parent {
                    let execution_mode = match work.kind {
                        boreal_domain::WorkKind::Milestone => "container",
                        boreal_domain::WorkKind::Task => "direct",
                        boreal_domain::WorkKind::Sprint => unreachable!("Sprint has no v3 node"),
                    };
                    let mut node = self.prepare(
                        "INSERT INTO work_node_v3
                         (work_id, project_id, decomposition_kind, execution_mode,
                          parent_id, created_at, updated_at)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
                    )?;
                    node.bind_text(1, work.id.as_str())?;
                    node.bind_text(2, work.project_id.as_str())?;
                    node.bind_text(3, work_kind_name(work.kind))?;
                    node.bind_text(4, execution_mode)?;
                    node.bind_optional_text(5, parent_id.as_deref())?;
                    node.bind_text(6, &input.created_at)?;
                    node.run()?;
                }
                let mut statement = self.prepare(
                    "INSERT INTO intake_promotion_v3
                     (promotion_id, project_id, intake_id, intake_revision,
                      intake_digest, target_kind, target_id, actor_id, operation_id,
                      created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, 'draft_work', ?6, ?7, ?8, ?9)",
                )?;
                statement.bind_text(1, &input.promotion_id)?;
                statement.bind_text(2, &input.project_id)?;
                statement.bind_text(3, &input.intake_id)?;
                statement.bind_i64(4, input.intake_revision)?;
                statement.bind_text(5, &input.intake_digest)?;
                statement.bind_text(6, &input.target_id)?;
                statement.bind_text(7, &context.actor_id)?;
                statement.bind_text(8, &context.operation_id)?;
                statement.bind_text(9, &input.created_at)?;
                statement.run()
            },
        )
    }

    pub fn create_work_node_v3(
        &self,
        context: &V3MutationContext,
        input: &WorkNodeV3Input,
    ) -> Result<MutationResult, StoreError> {
        let bound = context.with_payload(json!({"project_id": input.project_id, "work_id": input.work_id, "decomposition_kind": input.decomposition_kind, "execution_mode": input.execution_mode, "parent_id": input.parent_id}));
        let context = &bound;
        ensure_project(&context.project_id, &input.project_id)?;
        self.v3_mutation(
            context,
            "work.node.create",
            "work_node",
            &input.work_id,
            || {
                let work = self
                    .work(&input.project_id, &input.work_id)?
                    .ok_or_else(|| StoreError::NotFound {
                        entity: "work",
                        id: input.work_id.clone(),
                    })?;
                let domain_work = work_item_from_record(&work, work.parent_id.clone())?;
                let expected_parent = self.v3_parent_for_work(&domain_work)?;
                if input.decomposition_kind != work_kind_name(domain_work.kind)
                    || input.parent_id != expected_parent
                {
                    return Err(StoreError::Invalid(
                        "v3 node identity must match its canonical work kind and parent".into(),
                    ));
                }
                if !matches!(input.execution_mode.as_str(), "direct" | "container")
                    || (domain_work.kind == boreal_domain::WorkKind::Milestone
                        && input.execution_mode != "container")
                {
                    return Err(StoreError::Invalid(
                        "invalid execution mode for the canonical work kind".into(),
                    ));
                }
                let mut statement = self.prepare(
                    "INSERT INTO work_node_v3
                 (work_id, project_id, decomposition_kind, execution_mode,
                  parent_id, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                )?;
                statement.bind_text(1, &input.work_id)?;
                statement.bind_text(2, &input.project_id)?;
                statement.bind_text(3, &input.decomposition_kind)?;
                statement.bind_text(4, &input.execution_mode)?;
                statement.bind_optional_text(5, input.parent_id.as_deref())?;
                statement.bind_text(6, &input.created_at)?;
                statement.bind_text(7, &input.updated_at)?;
                statement.run()
            },
        )
    }

    /// Create a canonical schema-2 work row and its additive v3 hierarchy
    /// projection under one operation, revision, journal entry, and audit
    /// event. Schema-2 Sprint remains the adapter parent for nested Tasks; the
    /// v3 node points to that Sprint's Milestone.
    pub fn create_planned_work_v3(
        &self,
        context: &V3MutationContext,
        input: &PlannedWorkV3Input,
    ) -> Result<MutationResult, StoreError> {
        if input.planning_contract.is_some() {
            self.ensure_deliverables_schema()?;
        }
        let work = &input.work;
        let profile = &work.acceptance_profile;
        let bound = context.with_payload(json!({
            "work": {
                "project_id": work.project_id.as_str(),
                "work_id": work.id.as_str(),
                "kind": work_kind_name(work.kind),
                "parent_id": work.parent_id.as_ref().map(|id| id.as_str()),
                "title": work.title,
                "description": work.description,
                "lifecycle": format!("{:?}", work.lifecycle).to_ascii_lowercase(),
                "priority": work.priority,
                "dispatch_policy": format!("{:?}", work.dispatch_policy).to_ascii_lowercase(),
                "hard_holds": work.hard_holds.iter().map(|hold| hold.stable_code()).collect::<Vec<_>>(),
                "acceptance_profile": {
                    "id": profile.id.as_str(),
                    "version": profile.version,
                    "gates": profile.gates.iter().map(|gate| json!({
                        "id": gate.id.as_str(),
                        "kind": format!("{:?}", gate.kind).to_ascii_lowercase(),
                        "required": gate.required,
                        "state": format!("{:?}", gate.state).to_ascii_lowercase(),
                    })).collect::<Vec<_>>(),
                },
            },
            "execution_mode": input.execution_mode,
            "planning_contract": input.planning_contract.as_ref().map(|contract| json!({
                "requirements_json": contract.requirements_json,
                "inputs_json": contract.inputs_json,
            })),
        }));
        let context = &bound;
        ensure_project(&context.project_id, work.project_id.as_str())?;
        self.v3_mutation(
            context,
            "work.create.v3",
            "work_node",
            work.id.as_str(),
            || {
                if !matches!(work.kind, boreal_domain::WorkKind::Milestone | boreal_domain::WorkKind::Task) {
                    return Err(StoreError::Invalid(
                        "work-model/3 creation supports Milestones and Tasks; create legacy Sprint containers through the planning adapter".into(),
                    ));
                }
                if !matches!(input.execution_mode.as_str(), "direct" | "container") {
                    return Err(StoreError::Invalid("invalid work execution mode".into()));
                }
                if work.kind == boreal_domain::WorkKind::Milestone
                    && input.execution_mode != "container"
                {
                    return Err(StoreError::Invalid(
                        "milestones must use container execution mode".into(),
                    ));
                }
                if work.title.trim().is_empty() || work.title.len() > 512 {
                    return Err(StoreError::Invalid(
                        "work title is required and limited to 512 bytes".into(),
                    ));
                }
                let parent_node_id = self.v3_parent_for_work(work)?;
                self.create_work_in_transaction(work, &context.now)?;
                if let Some(node) = self.work_node_v3(work.project_id.as_str(), work.id.as_str())? {
                    // The production schema projects each new work_item via an
                    // AFTER INSERT trigger. Keep the explicit insert for
                    // schema-v3 stores without that compatibility trigger, but
                    // reconcile the generated row here instead of inserting a
                    // duplicate. The trigger's default for Tasks is `direct`;
                    // update it when this request explicitly asks for a
                    // container Task.
                    if node.decomposition_kind != work_kind_name(work.kind)
                        || node.parent_id != parent_node_id
                    {
                        return Err(StoreError::Corrupt(format!(
                            "work-model/3 projection for {}/{} does not match canonical work",
                            work.project_id, work.id
                        )));
                    }
                    if node.execution_mode != input.execution_mode {
                        let mut statement = self.prepare(
                            "UPDATE work_node_v3
                             SET execution_mode = ?1, updated_at = ?2
                             WHERE project_id = ?3 AND work_id = ?4",
                        )?;
                        statement.bind_text(1, &input.execution_mode)?;
                        statement.bind_text(2, &context.now)?;
                        statement.bind_text(3, work.project_id.as_str())?;
                        statement.bind_text(4, work.id.as_str())?;
                        statement.run()?;
                    }
                } else {
                    let mut statement = self.prepare(
                        "INSERT INTO work_node_v3
                         (work_id, project_id, decomposition_kind, execution_mode,
                          parent_id, created_at, updated_at)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
                    )?;
                    statement.bind_text(1, work.id.as_str())?;
                    statement.bind_text(2, work.project_id.as_str())?;
                    statement.bind_text(3, work_kind_name(work.kind))?;
                    statement.bind_text(4, &input.execution_mode)?;
                    statement.bind_optional_text(5, parent_node_id.as_deref())?;
                    statement.bind_text(6, &context.now)?;
                    statement.run()?;
                }
                if let Some(contract) = &input.planning_contract {
                    let session_id = context.session_id.as_deref().ok_or_else(|| {
                        StoreError::Invalid(
                            "planning contract creation requires an enrolled session".into(),
                        )
                    })?;
                    self.insert_planning_contract_in_transaction(
                        work.project_id.as_str(),
                        contract,
                        None,
                        None,
                        &context.actor_id,
                        session_id,
                        &context.operation_id,
                        &context.now,
                    )?;
                }
                Ok(())
            },
        )
    }

    /// Persist a hierarchy edit with its canonical schema-2 data. The v3
    /// parent is derived inside the same transaction; editing a Sprint also
    /// recomputes its child Tasks' flattened Milestone parents before the full
    /// v3 forest is revalidated.
    pub fn edit_planning_work_v3(
        &self,
        context: &V3MutationContext,
        input: &PlanningWorkEditV3Input,
    ) -> Result<MutationResult, StoreError> {
        if input.planning_contract.is_some() {
            self.ensure_deliverables_schema()?;
        }
        let bound = context.with_payload(json!({
            "project_id": input.project_id,
            "work_id": input.work_id,
            "parent_change": match input.parent_id.as_ref() {
                None => json!({"mode": "unchanged"}),
                Some(None) => json!({"mode": "clear"}),
                Some(Some(parent_id)) => json!({"mode": "set", "work_id": parent_id}),
            },
            "title": input.title,
            "description": input.description,
            "priority": input.priority,
            "dispatch_policy": input.dispatch_policy,
            "execution_mode": input.execution_mode,
            "planning_contract": input.planning_contract.as_ref().map(|contract| json!({
                "requirements_json": contract.requirements_json,
                "inputs_json": contract.inputs_json,
            })),
        }));
        let context = &bound;
        ensure_project(&context.project_id, &input.project_id)?;
        let roles: &[boreal_domain::ActorRole] =
            if input.dispatch_policy.is_some() || input.planning_contract.is_some() {
                &[boreal_domain::ActorRole::Operator]
            } else {
                &[
                    boreal_domain::ActorRole::Agent,
                    boreal_domain::ActorRole::Operator,
                ]
            };
        self.fact_mutation(
            context,
            "work.edit.v3",
            "work_node",
            &input.work_id,
            roles,
            || {
                if input.parent_id.is_none()
                    && input.title.is_none()
                    && input.description.is_none()
                    && input.priority.is_none()
                    && input.dispatch_policy.is_none()
                    && input.execution_mode.is_none()
                    && input.planning_contract.is_none()
                {
                    return Err(StoreError::Invalid(
                        "work edit requires at least one changed field".into(),
                    ));
                }
                if input
                    .title
                    .as_deref()
                    .is_some_and(|title| title.trim().is_empty() || title.len() > 512)
                {
                    return Err(StoreError::Invalid(
                        "work title is required and limited to 512 bytes".into(),
                    ));
                }
                if input.description.as_deref().is_some_and(|description| {
                    description.contains('\0') || description.len() > 65_536
                }) {
                    return Err(StoreError::Invalid(
                        "work description contains invalid content or exceeds 65536 bytes".into(),
                    ));
                }
                if input.dispatch_policy.as_deref().is_some_and(|policy| {
                    !matches!(policy, "automatic" | "operator_only" | "paused")
                }) {
                    return Err(StoreError::Invalid("invalid dispatch policy".into()));
                }
                if input
                    .execution_mode
                    .as_deref()
                    .is_some_and(|mode| !matches!(mode, "direct" | "container"))
                {
                    return Err(StoreError::Invalid("invalid work execution mode".into()));
                }
                let current_work =
                    self.work(&input.project_id, &input.work_id)?
                        .ok_or_else(|| StoreError::NotFound {
                            entity: "work",
                            id: input.work_id.clone(),
                        })?;
                if input.planning_contract.is_some()
                    && (current_work.lifecycle != "open"
                        || self.work_has_attempt_history(&input.project_id, &input.work_id)?)
                {
                    return Err(StoreError::Conflict(
                        "planning requirements and inputs cannot be changed after publication, claim, or prior attempt history; create a new revision through the explicit supersession path".into(),
                    ));
                }
                if current_work.kind == "sprint" {
                    if self
                        .work_node_v3(&input.project_id, &input.work_id)?
                        .is_some()
                    {
                        return Err(StoreError::Corrupt(
                            "Sprint unexpectedly has a work-model/3 node".into(),
                        ));
                    }
                    self.edit_sprint_work_v3(input, &current_work)?;
                    self.append_planning_contract_if_present(context, input)?;
                    return Ok(());
                }
                let mut current_node = self
                    .work_node_v3(&input.project_id, &input.work_id)?
                    .ok_or_else(|| StoreError::NotFound {
                        entity: "work_node_v3",
                        id: input.work_id.clone(),
                    })?;
                let target_parent = input
                    .parent_id
                    .clone()
                    .unwrap_or_else(|| current_work.parent_id.clone());
                let target_work = work_item_from_record(&current_work, target_parent.clone())?;
                let parent_node_id = self.v3_parent_for_work(&target_work)?;
                current_node.parent_id = parent_node_id;
                if let Some(mode) = &input.execution_mode {
                    current_node.execution_mode = mode.clone();
                }

                let mut nodes = Vec::new();
                for record in self.work_nodes_v3(&input.project_id)? {
                    let mut work = if record.work_id == input.work_id {
                        current_work.clone()
                    } else {
                        self.work(&input.project_id, &record.work_id)?
                            .ok_or_else(|| {
                                StoreError::Corrupt(format!(
                                    "v3 hierarchy node {} has no canonical work row",
                                    record.work_id
                                ))
                            })?
                    };
                    if record.work_id == input.work_id {
                        work.parent_id = target_parent.clone();
                        if let Some(title) = &input.title {
                            work.title = title.clone();
                        }
                    }
                    let kind = match record.decomposition_kind.as_str() {
                        "milestone" => boreal_domain::work_model_v3::DecompositionKind::Milestone,
                        "task" => boreal_domain::work_model_v3::DecompositionKind::Task,
                        _ => {
                            return Err(StoreError::Corrupt(format!(
                                "v3 hierarchy node {} has an unknown decomposition kind",
                                record.work_id
                            )))
                        }
                    };
                    let execution_mode = if record.work_id == input.work_id {
                        match current_node.execution_mode.as_str() {
                            "direct" => boreal_domain::work_model_v3::ExecutionMode::Direct,
                            "container" => boreal_domain::work_model_v3::ExecutionMode::Container,
                            _ => {
                                return Err(StoreError::Corrupt(
                                    "invalid stored execution mode".into(),
                                ))
                            }
                        }
                    } else {
                        match record.execution_mode.as_str() {
                            "direct" => boreal_domain::work_model_v3::ExecutionMode::Direct,
                            "container" => boreal_domain::work_model_v3::ExecutionMode::Container,
                            _ => {
                                return Err(StoreError::Corrupt(format!(
                                    "v3 hierarchy node {} has an unknown execution mode",
                                    record.work_id
                                )))
                            }
                        }
                    };
                    let parent_id = if record.work_id == input.work_id {
                        current_node
                            .parent_id
                            .clone()
                            .map(boreal_domain::WorkId::new)
                    } else {
                        record.parent_id.clone().map(boreal_domain::WorkId::new)
                    };
                    let expected_kind = match work.kind.as_str() {
                        "milestone" => "milestone",
                        "task" => "task",
                        _ => {
                            return Err(StoreError::Corrupt(format!(
                                "v3 hierarchy node {} disagrees with its canonical work kind",
                                work.work_id
                            )))
                        }
                    };
                    if expected_kind != record.decomposition_kind {
                        return Err(StoreError::Corrupt(format!(
                            "v3 hierarchy node {} disagrees with its canonical work kind",
                            work.work_id
                        )));
                    }
                    let domain_work = work_item_from_record(&work, work.parent_id.clone())?;
                    let expected_parent = self.v3_parent_for_work(&domain_work)?;
                    let actual_parent = if record.work_id == input.work_id {
                        current_node.parent_id.clone()
                    } else {
                        record.parent_id.clone()
                    };
                    if actual_parent != expected_parent {
                        return Err(StoreError::Corrupt(format!(
                            "v3 hierarchy node {} disagrees with its canonical parent",
                            work.work_id
                        )));
                    }
                    nodes.push(boreal_domain::work_model_v3::WorkNode {
                        id: boreal_domain::WorkId::new(record.work_id),
                        project_id: boreal_domain::ProjectId::new(input.project_id.clone()),
                        kind,
                        execution_mode,
                        parent_id,
                        title: work.title,
                    });
                }
                boreal_domain::work_model_v3::validate_decomposition(&nodes)
                    .map_err(|error| StoreError::Invalid(error.to_string()))?;

                if input.parent_id.is_some()
                    || input.title.is_some()
                    || input.description.is_some()
                    || input.priority.is_some()
                    || input.dispatch_policy.is_some()
                {
                    let mut update = self.prepare(
                        "UPDATE work_item
                         SET parent_id = ?1, title = ?2, description = ?3,
                             priority = ?4, dispatch_policy = ?5, updated_at = ?6
                         WHERE project_id = ?7 AND work_id = ?8",
                    )?;
                    update.bind_optional_text(1, target_parent.as_deref())?;
                    update.bind_text(2, input.title.as_deref().unwrap_or(&current_work.title))?;
                    update.bind_text(
                        3,
                        input
                            .description
                            .as_deref()
                            .unwrap_or(&current_work.description),
                    )?;
                    update.bind_i64(
                        4,
                        u64::from(input.priority.unwrap_or(current_work.priority)),
                    )?;
                    update.bind_text(
                        5,
                        input
                            .dispatch_policy
                            .as_deref()
                            .unwrap_or(&current_work.dispatch_policy),
                    )?;
                    update.bind_text(6, &input.updated_at)?;
                    update.bind_text(7, &input.project_id)?;
                    update.bind_text(8, &input.work_id)?;
                    update.run()?;
                }
                let mut update = self.prepare(
                    "UPDATE work_node_v3
                     SET parent_id = ?1, execution_mode = ?2, updated_at = ?3
                     WHERE project_id = ?4 AND work_id = ?5",
                )?;
                update.bind_optional_text(1, current_node.parent_id.as_deref())?;
                update.bind_text(2, &current_node.execution_mode)?;
                update.bind_text(3, &input.updated_at)?;
                update.bind_text(4, &input.project_id)?;
                update.bind_text(5, &input.work_id)?;
                update.run()?;
                self.append_planning_contract_if_present(context, input)
            },
        )
    }

    fn work_has_attempt_history(
        &self,
        project_id: &str,
        work_id: &str,
    ) -> Result<bool, StoreError> {
        let mut row = self.prepare(
            "SELECT 1 FROM attempt a
             JOIN work_item w ON w.work_id=a.work_id
             WHERE w.project_id=?1 AND w.work_id=?2 LIMIT 1",
        )?;
        row.bind_text(1, project_id)?;
        row.bind_text(2, work_id)?;
        Ok(row.step()? == SQLITE_ROW)
    }

    fn append_planning_contract_if_present(
        &self,
        context: &V3MutationContext,
        input: &PlanningWorkEditV3Input,
    ) -> Result<(), StoreError> {
        let Some(contract) = &input.planning_contract else {
            return Ok(());
        };
        let session_id = context.session_id.as_deref().ok_or_else(|| {
            StoreError::Invalid("planning contract edits require an enrolled session".into())
        })?;
        let prior = self.work_planning_contract(&input.project_id, &input.work_id)?;
        let template_id = prior
            .as_ref()
            .and_then(|record| record.template_id.as_deref());
        let template_version = prior.as_ref().and_then(|record| record.template_version);
        self.append_planning_contract_in_transaction(
            &input.project_id,
            contract,
            template_id,
            template_version,
            &context.actor_id,
            session_id,
            &context.operation_id,
            &context.now,
        )?;
        Ok(())
    }

    /// Edit a legacy Sprint through the v3 planning operation. A Sprint has no
    /// v3 node, so moving it must update every projected child Task's flattened
    /// Milestone parent in the same fact-mutation transaction.
    fn edit_sprint_work_v3(
        &self,
        input: &PlanningWorkEditV3Input,
        current_work: &super::WorkRecord,
    ) -> Result<(), StoreError> {
        if input.execution_mode.is_some() {
            return Err(StoreError::Invalid(
                "execution mode cannot be edited on a Sprint container".into(),
            ));
        }
        let target_parent = input
            .parent_id
            .clone()
            .unwrap_or_else(|| current_work.parent_id.clone());
        let target_parent_id = target_parent
            .as_deref()
            .ok_or_else(|| StoreError::Invalid("Sprints require a Milestone parent".into()))?;
        let parent = self
            .work(&input.project_id, target_parent_id)?
            .ok_or_else(|| StoreError::Invalid("Sprint parent is not in this project".into()))?;
        if parent.kind != "milestone" {
            return Err(StoreError::Invalid(
                "Sprint parent must be a Milestone".into(),
            ));
        }
        let parent_node = self
            .work_node_v3(&input.project_id, target_parent_id)?
            .ok_or_else(|| {
                StoreError::Invalid("Sprint parent Milestone is missing its v3 projection".into())
            })?;
        if parent_node.decomposition_kind != "milestone"
            || parent_node.execution_mode != "container"
        {
            return Err(StoreError::Invalid(
                "Sprint parent must be a v3 Milestone container".into(),
            ));
        }
        let sprint = work_item_from_record(current_work, target_parent.clone())?;
        let parent_item = work_item_from_record(&parent, parent.parent_id.clone())?;
        boreal_domain::validate_parent(&sprint, Some(&parent_item))
            .map_err(|error| StoreError::Invalid(error.to_string()))?;

        let mut child_ids = Vec::new();
        let mut children = self.prepare(
            "SELECT work_id FROM work_item
             WHERE project_id = ?1 AND parent_id = ?2 AND kind = 'task'
             ORDER BY work_id",
        )?;
        children.bind_text(1, &input.project_id)?;
        children.bind_text(2, &input.work_id)?;
        while children.step()? == SQLITE_ROW {
            child_ids.push(children.column_text(0)?);
        }
        let moving = target_parent != current_work.parent_id;
        if moving {
            let old_milestone_id = current_work.parent_id.as_deref().ok_or_else(|| {
                StoreError::Corrupt("Sprint has no canonical Milestone parent".into())
            })?;
            for child_id in &child_ids {
                let child_node =
                    self.work_node_v3(&input.project_id, child_id)?
                        .ok_or_else(|| {
                            StoreError::Invalid(format!(
                            "cannot move Sprint while nested Task {child_id} has no v3 projection"
                        ))
                        })?;
                if child_node.decomposition_kind != "task"
                    || child_node.parent_id.as_deref() != Some(old_milestone_id)
                {
                    return Err(StoreError::Corrupt(format!(
                        "nested Task {child_id} does not project under the Sprint's current Milestone"
                    )));
                }
            }
        }

        let mut update_work = self.prepare(
            "UPDATE work_item
             SET parent_id = ?1, title = ?2, description = ?3,
                 priority = ?4, dispatch_policy = ?5, updated_at = ?6
             WHERE project_id = ?7 AND work_id = ?8",
        )?;
        update_work.bind_optional_text(1, target_parent.as_deref())?;
        update_work.bind_text(2, input.title.as_deref().unwrap_or(&current_work.title))?;
        update_work.bind_text(
            3,
            input
                .description
                .as_deref()
                .unwrap_or(&current_work.description),
        )?;
        update_work.bind_i64(
            4,
            u64::from(input.priority.unwrap_or(current_work.priority)),
        )?;
        update_work.bind_text(
            5,
            input
                .dispatch_policy
                .as_deref()
                .unwrap_or(&current_work.dispatch_policy),
        )?;
        update_work.bind_text(6, &input.updated_at)?;
        update_work.bind_text(7, &input.project_id)?;
        update_work.bind_text(8, &input.work_id)?;
        update_work.run()?;

        if moving {
            for child_id in child_ids {
                let mut update_child = self.prepare(
                    "UPDATE work_node_v3
                     SET parent_id = ?1, updated_at = ?2
                     WHERE project_id = ?3 AND work_id = ?4",
                )?;
                update_child.bind_text(1, target_parent_id)?;
                update_child.bind_text(2, &input.updated_at)?;
                update_child.bind_text(3, &input.project_id)?;
                update_child.bind_text(4, &child_id)?;
                update_child.run()?;
            }
        }
        self.validate_work_model_v3_forest(&input.project_id)
    }

    /// Rebuild and validate the current projected forest against canonical
    /// work rows after a multi-row parent change, before the transaction can
    /// commit.
    fn validate_work_model_v3_forest(&self, project_id: &str) -> Result<(), StoreError> {
        let mut nodes = Vec::new();
        for record in self.work_nodes_v3(project_id)? {
            let work = self.work(project_id, &record.work_id)?.ok_or_else(|| {
                StoreError::Corrupt(format!(
                    "v3 hierarchy node {} has no canonical work row",
                    record.work_id
                ))
            })?;
            let kind = match (work.kind.as_str(), record.decomposition_kind.as_str()) {
                ("milestone", "milestone") => {
                    boreal_domain::work_model_v3::DecompositionKind::Milestone
                }
                ("task", "task") => boreal_domain::work_model_v3::DecompositionKind::Task,
                _ => {
                    return Err(StoreError::Corrupt(format!(
                        "v3 hierarchy node {} disagrees with its canonical work kind",
                        record.work_id
                    )))
                }
            };
            let execution_mode = match record.execution_mode.as_str() {
                "direct" => boreal_domain::work_model_v3::ExecutionMode::Direct,
                "container" => boreal_domain::work_model_v3::ExecutionMode::Container,
                _ => {
                    return Err(StoreError::Corrupt(format!(
                        "v3 hierarchy node {} has an unknown execution mode",
                        record.work_id
                    )))
                }
            };
            let domain_work = work_item_from_record(&work, work.parent_id.clone())?;
            let expected_parent = self.v3_parent_for_work(&domain_work)?;
            if record.parent_id != expected_parent {
                return Err(StoreError::Corrupt(format!(
                    "v3 hierarchy node {} disagrees with its canonical parent",
                    record.work_id
                )));
            }
            nodes.push(boreal_domain::work_model_v3::WorkNode {
                id: boreal_domain::WorkId::new(record.work_id),
                project_id: boreal_domain::ProjectId::new(project_id.to_owned()),
                kind,
                execution_mode,
                parent_id: record.parent_id.map(boreal_domain::WorkId::new),
                title: work.title,
            });
        }
        boreal_domain::work_model_v3::validate_decomposition(&nodes)
            .map_err(|error| StoreError::Invalid(error.to_string()))
    }

    /// Resolve the additive parent from the canonical work parent while
    /// checking that the schema-2 and v3 hierarchy contracts agree.
    fn v3_parent_for_work(
        &self,
        work: &boreal_domain::WorkItem,
    ) -> Result<Option<String>, StoreError> {
        let Some(parent_id) = &work.parent_id else {
            boreal_domain::validate_parent(work, None)
                .map_err(|error| StoreError::Invalid(error.to_string()))?;
            return Ok(None);
        };
        let parent = self
            .work(work.project_id.as_str(), parent_id.as_str())?
            .ok_or_else(|| StoreError::Invalid("work parent is not in this project".into()))?;
        let parent_item = work_item_from_record(&parent, parent.parent_id.clone())?;
        boreal_domain::validate_parent(work, Some(&parent_item))
            .map_err(|error| StoreError::Invalid(error.to_string()))?;
        if work.kind != boreal_domain::WorkKind::Task {
            return Err(StoreError::Invalid(
                "milestones cannot have a schema-2 work parent".into(),
            ));
        }
        if parent.kind != "sprint" {
            return Err(StoreError::Invalid(
                "nested tasks require a Sprint work parent".into(),
            ));
        }
        let milestone_id = parent.parent_id.as_deref().ok_or_else(|| {
            StoreError::Invalid("nested task Sprint must belong to a Milestone".into())
        })?;
        let milestone = self
            .work(work.project_id.as_str(), milestone_id)?
            .ok_or_else(|| StoreError::Invalid("Sprint Milestone is missing".into()))?;
        if milestone.kind != "milestone" {
            return Err(StoreError::Invalid(
                "nested task Sprint parent must be a Milestone".into(),
            ));
        }
        let milestone_node = self
            .work_node_v3(work.project_id.as_str(), milestone_id)?
            .ok_or_else(|| {
                StoreError::Invalid(
                    "nested task requires its Milestone to be projected into work-model/3".into(),
                )
            })?;
        if milestone_node.decomposition_kind != "milestone"
            || milestone_node.execution_mode != "container"
        {
            return Err(StoreError::Invalid(
                "nested task parent must be a v3 Milestone container".into(),
            ));
        }
        Ok(Some(milestone_id.to_owned()))
    }

    pub fn work_nodes_v3(&self, project_id: &str) -> Result<Vec<WorkNodeV3Record>, StoreError> {
        let mut statement = self.prepare(
            "SELECT project_id, work_id, decomposition_kind, execution_mode,
                    parent_id, created_at, updated_at
             FROM work_node_v3 WHERE project_id = ?1 ORDER BY work_id",
        )?;
        statement.bind_text(1, project_id)?;
        let mut rows = Vec::new();
        while statement.step()? == SQLITE_ROW {
            rows.push(WorkNodeV3Record {
                project_id: statement.column_text(0)?,
                work_id: statement.column_text(1)?,
                decomposition_kind: statement.column_text(2)?,
                execution_mode: statement.column_text(3)?,
                parent_id: statement.column_optional_text(4)?,
                created_at: statement.column_text(5)?,
                updated_at: statement.column_text(6)?,
            });
        }
        Ok(rows)
    }

    pub fn work_node_v3(
        &self,
        project_id: &str,
        work_id: &str,
    ) -> Result<Option<WorkNodeV3Record>, StoreError> {
        let mut statement = self.prepare(
            "SELECT project_id, work_id, decomposition_kind, execution_mode,
                    parent_id, created_at, updated_at
             FROM work_node_v3 WHERE project_id = ?1 AND work_id = ?2",
        )?;
        statement.bind_text(1, project_id)?;
        statement.bind_text(2, work_id)?;
        if statement.step()? != SQLITE_ROW {
            return Ok(None);
        }
        Ok(Some(WorkNodeV3Record {
            project_id: statement.column_text(0)?,
            work_id: statement.column_text(1)?,
            decomposition_kind: statement.column_text(2)?,
            execution_mode: statement.column_text(3)?,
            parent_id: statement.column_optional_text(4)?,
            created_at: statement.column_text(5)?,
            updated_at: statement.column_text(6)?,
        }))
    }

    /// Return the latest coordinator-owned project civil-time setting. Date-only
    /// business values require this explicit versioned setting; absence is not
    /// replaced with the host timezone.
    pub fn project_civil_time_v1(
        &self,
        project_id: &str,
    ) -> Result<Option<ProjectCivilTimeV1Record>, StoreError> {
        let mut statement = self.prepare(
            "SELECT project_id, setting_revision, timezone, tzdb_identity,
                    changed_by, changed_at_ms
             FROM project_civil_time_v1
             WHERE project_id = ?1
             ORDER BY setting_revision DESC LIMIT 1",
        )?;
        statement.bind_text(1, project_id)?;
        if statement.step()? != SQLITE_ROW {
            return Ok(None);
        }
        let setting = ProjectCivilTimeSetting {
            project_id: ProjectId::new(statement.column_text(0)?),
            revision: statement.column_u64(1)?,
            timezone: statement.column_text(2)?,
            tzdb_identity: statement.column_text(3)?,
            changed_by: statement.column_text(4)?,
            changed_at: TimestampMs::from_millis(statement.column_u64(5)?),
        };
        setting
            .validate()
            .map_err(|error| StoreError::Corrupt(format!("invalid civil-time setting: {error}")))?;
        Ok(Some(setting))
    }

    /// Append the next attributed project timezone setting revision. Only an
    /// Operator may change the source used to interpret date-only business
    /// values; the expected setting and project revisions are checked in the
    /// same transaction as the history row and operation journal.
    pub fn update_project_civil_time_v1(
        &self,
        context: &V3MutationContext,
        input: &ProjectCivilTimeV1Input,
    ) -> Result<MutationResult, StoreError> {
        let setting = &input.setting;
        let bound = context.with_payload(json!({
            "project_id": setting.project_id.as_str(),
            "setting_revision": setting.revision,
            "expected_setting_revision": input.expected_setting_revision,
            "timezone": setting.timezone,
            "tzdb_identity": setting.tzdb_identity,
            "changed_by": setting.changed_by,
            "changed_at_ms": setting.changed_at.as_millis(),
        }));
        ensure_project(&bound.project_id, setting.project_id.as_str())?;
        setting
            .validate()
            .map_err(|error| StoreError::Invalid(error.to_string()))?;
        if setting.changed_by != bound.actor_id
            || input.expected_setting_revision.checked_add(1) != Some(setting.revision)
        {
            return Err(StoreError::Invalid(
                "civil-time setting revision or actor attribution is invalid".into(),
            ));
        }
        self.fact_mutation(
            &bound,
            "project.civil-time.update.v1",
            "project_civil_time",
            &setting.project_id.to_string(),
            &[ActorRole::Operator],
            || {
                let current = self
                    .project_civil_time_v1(setting.project_id.as_str())?
                    .map_or(0, |current| current.revision);
                if current != input.expected_setting_revision {
                    return Err(StoreError::Conflict(format!(
                        "stale civil-time setting revision: expected {}, actual {current}",
                        input.expected_setting_revision
                    )));
                }
                let mut statement = self.prepare(
                    "INSERT INTO project_civil_time_v1
                     (project_id, setting_revision, timezone, tzdb_identity,
                      changed_by, changed_at_ms, created_project_revision,
                      operation_id, request_digest)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                )?;
                statement.bind_text(1, setting.project_id.as_str())?;
                statement.bind_i64(2, setting.revision)?;
                statement.bind_text(3, &setting.timezone)?;
                statement.bind_text(4, &setting.tzdb_identity)?;
                statement.bind_text(5, &setting.changed_by)?;
                statement.bind_i64(6, setting.changed_at.as_millis())?;
                statement.bind_i64(
                    7,
                    bound.expected_revision.ok_or_else(|| {
                        StoreError::Invalid("civil-time update requires project revision".into())
                    })?,
                )?;
                statement.bind_text(8, &bound.operation_id)?;
                statement.bind_text(9, &bound.request_digest)?;
                statement.run()
            },
        )
    }

    pub fn work_schedule_v3(
        &self,
        project_id: &str,
        work_id: &str,
    ) -> Result<Option<WorkScheduleV3Record>, StoreError> {
        let mut statement = self.prepare(
            "SELECT project_id, work_id, schedule_revision, payload_json,
                    civil_time_setting_revision, updated_at_ms
             FROM work_schedule_v3
             WHERE project_id = ?1 AND work_id = ?2
             ORDER BY schedule_revision DESC LIMIT 1",
        )?;
        statement.bind_text(1, project_id)?;
        statement.bind_text(2, work_id)?;
        if statement.step()? != SQLITE_ROW {
            return Ok(None);
        }
        decode_work_schedule_record(
            statement.column_text(0)?,
            statement.column_text(1)?,
            statement.column_u64(2)?,
            &statement.column_text(3)?,
            statement.column_optional_i64(4)?,
            statement.column_u64(5)?,
        )
        .map(Some)
    }

    pub fn work_schedules_v3(
        &self,
        project_id: &str,
    ) -> Result<Vec<WorkScheduleV3Record>, StoreError> {
        let mut statement = self.prepare(
            "SELECT schedule.project_id, schedule.work_id,
                    schedule.schedule_revision, schedule.payload_json,
                    schedule.civil_time_setting_revision, schedule.updated_at_ms
             FROM work_schedule_v3 schedule
             JOIN (
               SELECT project_id, work_id, MAX(schedule_revision) AS schedule_revision
               FROM work_schedule_v3 WHERE project_id = ?1 GROUP BY project_id, work_id
             ) latest USING (project_id, work_id, schedule_revision)
             ORDER BY schedule.work_id",
        )?;
        statement.bind_text(1, project_id)?;
        let mut records = Vec::new();
        while statement.step()? == SQLITE_ROW {
            records.push(decode_work_schedule_record(
                statement.column_text(0)?,
                statement.column_text(1)?,
                statement.column_u64(2)?,
                &statement.column_text(3)?,
                statement.column_optional_i64(4)?,
                statement.column_u64(5)?,
            )?);
        }
        Ok(records)
    }

    /// Return the untouched legacy `work_item.due_at` text only when no
    /// revisioned work-model/3 schedule exists for this exact project/work
    /// pair. A v3 schedule row, including an explicit clear, shadows the
    /// legacy column. The caller must preserve date-only text as a civil date
    /// and must not assume any other legacy representation is an instant
    /// without parsing its explicit zone.
    pub fn legacy_due_at_v3_if_no_schedule(
        &self,
        project_id: &str,
        work_id: &str,
    ) -> Result<Option<String>, StoreError> {
        let mut schedule = self.prepare(
            "SELECT 1 FROM work_schedule_v3
             WHERE project_id = ?1 AND work_id = ?2 LIMIT 1",
        )?;
        schedule.bind_text(1, project_id)?;
        schedule.bind_text(2, work_id)?;
        if schedule.step()? == SQLITE_ROW {
            return Ok(None);
        }

        let mut legacy =
            self.prepare("SELECT due_at FROM work_item WHERE project_id = ?1 AND work_id = ?2")?;
        legacy.bind_text(1, project_id)?;
        legacy.bind_text(2, work_id)?;
        if legacy.step()? != SQLITE_ROW {
            return Ok(None);
        }
        legacy.column_optional_text(0)
    }

    /// Append one full schedule revision. Clear operations use an empty typed
    /// schedule and still advance revision, preserving the prior row.
    pub fn append_work_schedule_v3(
        &self,
        context: &V3MutationContext,
        input: &WorkScheduleV3Input,
    ) -> Result<MutationResult, StoreError> {
        let record = &input.record;
        let payload_json = encode_schedule_payload(record)?;
        let bound = context.with_payload(json!({
            "project_id": record.project_id.as_str(),
            "work_id": record.work_id.as_str(),
            "schedule_revision": record.revision,
            "expected_schedule_revision": input.expected_schedule_revision,
            "civil_time_setting_revision": record.civil_time_setting_revision,
            "payload": serde_json::from_str::<serde_json::Value>(&payload_json)
                .map_err(|error| StoreError::Invalid(error.to_string()))?,
        }));
        ensure_project(&bound.project_id, record.project_id.as_str())?;
        record
            .validate()
            .map_err(|error| StoreError::Invalid(error.to_string()))?;
        if input.expected_schedule_revision.checked_add(1) != Some(record.revision) {
            return Err(StoreError::Invalid(
                "schedule revision is not the next revision".into(),
            ));
        }
        self.fact_mutation(
            &bound,
            "work.schedule.update.v3",
            "work_schedule",
            record.work_id.as_str(),
            &[ActorRole::Operator],
            || {
                let node = self
                    .work_node_v3(record.project_id.as_str(), record.work_id.as_str())?
                    .ok_or_else(|| StoreError::NotFound {
                        entity: "work_node_v3",
                        id: record.work_id.to_string(),
                    })?;
                if !matches!(node.decomposition_kind.as_str(), "task" | "milestone")
                    || !matches!(node.execution_mode.as_str(), "direct" | "container")
                {
                    return Err(StoreError::Corrupt("unknown schedulable work node kind".into()));
                }
                let actual_revision = self
                    .work_schedule_v3(record.project_id.as_str(), record.work_id.as_str())?
                    .map_or(0, |current| current.revision);
                if actual_revision != input.expected_schedule_revision {
                    return Err(StoreError::Conflict(format!(
                        "stale schedule revision: expected {}, actual {actual_revision}",
                        input.expected_schedule_revision
                    )));
                }
                if let Some(setting_revision) = record.civil_time_setting_revision {
                    let current_setting = self.project_civil_time_v1(record.project_id.as_str())?;
                    if current_setting.map(|setting| setting.revision) != Some(setting_revision) {
                        return Err(StoreError::Conflict(
                            "date-only schedule was planned against a stale project civil-time setting".into(),
                        ));
                    }
                }
                let mut statement = self.prepare(
                    "INSERT INTO work_schedule_v3
                     (project_id, work_id, schedule_revision, payload_json,
                      civil_time_setting_revision, updated_at_ms,
                      created_project_revision, operation_id, request_digest)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                )?;
                statement.bind_text(1, record.project_id.as_str())?;
                statement.bind_text(2, record.work_id.as_str())?;
                statement.bind_i64(3, record.revision)?;
                statement.bind_text(4, &payload_json)?;
                statement.bind_optional_i64(5, record.civil_time_setting_revision)?;
                statement.bind_i64(6, record.updated_at.as_millis())?;
                statement.bind_i64(
                    7,
                    bound.expected_revision.ok_or_else(|| {
                        StoreError::Invalid("schedule update requires project revision".into())
                    })?,
                )?;
                statement.bind_text(8, &bound.operation_id)?;
                statement.bind_text(9, &bound.request_digest)?;
                statement.run()
            },
        )
    }

    pub fn external_waits_v1(
        &self,
        project_id: &str,
    ) -> Result<Vec<ExternalWaitV1Record>, StoreError> {
        let mut statement = self.prepare(
            "SELECT wait.project_id, wait.wait_id, wait.wait_revision,
                    wait.payload_json
             FROM external_wait_v1 wait
             JOIN (
               SELECT project_id, wait_id, MAX(wait_revision) AS wait_revision
               FROM external_wait_v1 WHERE project_id = ?1 GROUP BY project_id, wait_id
             ) latest USING (project_id, wait_id, wait_revision)
             ORDER BY wait.wait_id",
        )?;
        statement.bind_text(1, project_id)?;
        let mut waits = Vec::new();
        while statement.step()? == SQLITE_ROW {
            let project_id = statement.column_text(0)?;
            let wait_id = statement.column_text(1)?;
            let revision = statement.column_u64(2)?;
            let payload = statement.column_text(3)?;
            let wait = decode_external_wait(&project_id, &wait_id, revision, &payload)?;
            let persisted_scope = self.external_wait_scope_v1(&project_id, &wait_id, revision)?;
            if wait.affected_work_ids != persisted_scope {
                return Err(StoreError::Corrupt(format!(
                    "external wait {wait_id} payload and immutable scope edges disagree"
                )));
            }
            wait.validate(
                &self.work_nodes_domain_v3(&project_id)?,
                &self.work_dependencies_domain_v3(&project_id)?,
            )
            .map_err(|error| {
                StoreError::Corrupt(format!("invalid external wait {wait_id}: {error}"))
            })?;
            waits.push(wait);
        }
        Ok(waits)
    }

    /// Append a typed external-wait revision and its immutable scope edges.
    /// The wait's state is re-read under the same transaction before a close;
    /// time passage alone never writes a state transition.
    pub fn append_external_wait_v1(
        &self,
        context: &V3MutationContext,
        input: &ExternalWaitV1Input,
    ) -> Result<MutationResult, StoreError> {
        let wait = &input.wait;
        let payload_json = encode_external_wait(wait)?;
        let bound = context.with_payload(json!({
            "project_id": wait.project_id.as_str(),
            "wait_id": wait.id.as_str(),
            "wait_revision": wait.revision,
            "expected_wait_revision": input.expected_wait_revision,
            "payload": serde_json::from_str::<serde_json::Value>(&payload_json)
                .map_err(|error| StoreError::Invalid(error.to_string()))?,
            "affected_work_ids": wait.affected_work_ids.iter().map(WorkId::as_str).collect::<Vec<_>>(),
        }));
        ensure_project(&bound.project_id, wait.project_id.as_str())?;
        if wait.created_by != bound.actor_id && input.expected_wait_revision == 0 {
            return Err(StoreError::Invalid(
                "external-wait creator must be the current actor".into(),
            ));
        }
        if input.expected_wait_revision.checked_add(1) != Some(wait.revision) {
            return Err(StoreError::Invalid(
                "external-wait revision is not the next revision".into(),
            ));
        }
        self.fact_mutation(
            &bound,
            if input.expected_wait_revision == 0 {
                "external-wait.create.v1"
            } else {
                "external-wait.resolve.v1"
            },
            "external_wait",
            wait.id.as_str(),
            &[ActorRole::Operator],
            || {
                let nodes = self.work_nodes_domain_v3(wait.project_id.as_str())?;
                let dependencies = self.work_dependencies_domain_v3(wait.project_id.as_str())?;
                wait.validate(&nodes, &dependencies)
                    .map_err(|error| StoreError::Invalid(error.to_string()))?;
                let current =
                    self.external_wait_v1_by_id(wait.project_id.as_str(), wait.id.as_str())?;
                let actual_revision = current.as_ref().map_or(0, |current| current.revision);
                if actual_revision != input.expected_wait_revision {
                    return Err(StoreError::Conflict(format!(
                        "stale external-wait revision: expected {}, actual {actual_revision}",
                        input.expected_wait_revision
                    )));
                }
                if let Some(current) = current {
                    current.validate(&nodes, &dependencies).map_err(|error| {
                        StoreError::Corrupt(format!("invalid current wait: {error}"))
                    })?;
                    if current.state != ExternalWaitState::Open
                        || !same_external_wait_scope(&current, wait)
                    {
                        return Err(StoreError::Conflict(
                            "external wait is no longer open or its immutable scope changed".into(),
                        ));
                    }
                    let resolution = wait.resolution.as_ref().ok_or_else(|| {
                        StoreError::Invalid("closed wait requires attributed resolution".into())
                    })?;
                    if resolution.recorded_by != bound.actor_id
                        || resolution.recorded_as != ActorRole::Operator
                    {
                        return Err(StoreError::Invalid(
                            "wait resolution must be attributed to the current Operator".into(),
                        ));
                    }
                } else if input.expected_wait_revision != 0
                    || wait.state != ExternalWaitState::Open
                    || wait.resolution.is_some()
                {
                    return Err(StoreError::Conflict("external wait does not exist".into()));
                }
                if let Some(setting_revision) = wait.civil_time_setting_revision {
                    let current_setting = self.project_civil_time_v1(wait.project_id.as_str())?;
                    if current_setting.map(|setting| setting.revision) != Some(setting_revision) {
                        return Err(StoreError::Conflict(
                            "date-only wait was planned against a stale project civil-time setting"
                                .into(),
                        ));
                    }
                }
                let mut insert = self.prepare(
                    "INSERT INTO external_wait_v1
                     (project_id, wait_id, wait_revision, payload_json,
                      created_project_revision, operation_id, request_digest)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                )?;
                insert.bind_text(1, wait.project_id.as_str())?;
                insert.bind_text(2, wait.id.as_str())?;
                insert.bind_i64(3, wait.revision)?;
                insert.bind_text(4, &payload_json)?;
                insert.bind_i64(
                    5,
                    bound.expected_revision.ok_or_else(|| {
                        StoreError::Invalid("wait update requires project revision".into())
                    })?,
                )?;
                insert.bind_text(6, &bound.operation_id)?;
                insert.bind_text(7, &bound.request_digest)?;
                insert.run()?;
                for affected_work_id in &wait.affected_work_ids {
                    let mut edge = self.prepare(
                        "INSERT INTO external_wait_scope_v1
                         (project_id, wait_id, wait_revision, affected_work_id)
                         VALUES (?1, ?2, ?3, ?4)",
                    )?;
                    edge.bind_text(1, wait.project_id.as_str())?;
                    edge.bind_text(2, wait.id.as_str())?;
                    edge.bind_i64(3, wait.revision)?;
                    edge.bind_text(4, affected_work_id.as_str())?;
                    edge.run()?;
                }
                Ok(())
            },
        )
    }

    fn external_wait_v1_by_id(
        &self,
        project_id: &str,
        wait_id: &str,
    ) -> Result<Option<ExternalWaitV1Record>, StoreError> {
        let mut statement = self.prepare(
            "SELECT project_id, wait_id, wait_revision, payload_json
             FROM external_wait_v1
             WHERE project_id = ?1 AND wait_id = ?2
             ORDER BY wait_revision DESC LIMIT 1",
        )?;
        statement.bind_text(1, project_id)?;
        statement.bind_text(2, wait_id)?;
        if statement.step()? != SQLITE_ROW {
            return Ok(None);
        }
        let project_id = statement.column_text(0)?;
        let wait_id = statement.column_text(1)?;
        let revision = statement.column_u64(2)?;
        let payload = statement.column_text(3)?;
        let wait = decode_external_wait(&project_id, &wait_id, revision, &payload)?;
        let persisted_scope = self.external_wait_scope_v1(&project_id, &wait_id, revision)?;
        if wait.affected_work_ids != persisted_scope {
            return Err(StoreError::Corrupt(format!(
                "external wait {wait_id} payload and immutable scope edges disagree"
            )));
        }
        Ok(Some(wait))
    }

    fn external_wait_scope_v1(
        &self,
        project_id: &str,
        wait_id: &str,
        revision: u64,
    ) -> Result<Vec<WorkId>, StoreError> {
        let mut statement = self.prepare(
            "SELECT affected_work_id FROM external_wait_scope_v1
             WHERE project_id = ?1 AND wait_id = ?2 AND wait_revision = ?3
             ORDER BY affected_work_id",
        )?;
        statement.bind_text(1, project_id)?;
        statement.bind_text(2, wait_id)?;
        statement.bind_i64(3, revision)?;
        let mut affected = Vec::new();
        while statement.step()? == SQLITE_ROW {
            affected.push(WorkId::new(statement.column_text(0)?));
        }
        Ok(affected)
    }

    fn work_nodes_domain_v3(&self, project_id: &str) -> Result<Vec<WorkNode>, StoreError> {
        self.work_nodes_v3(project_id)?
            .into_iter()
            .map(|record| {
                let project = ProjectId::new(record.project_id);
                let work_id = WorkId::new(record.work_id);
                let parent_id = record.parent_id.map(WorkId::new);
                let node = match record.decomposition_kind.as_str() {
                    "milestone" if record.execution_mode == "container" => {
                        WorkNode::milestone(project, work_id, "")
                    }
                    "task" => {
                        let mode = match record.execution_mode.as_str() {
                            "direct" => ExecutionMode::Direct,
                            "container" => ExecutionMode::Container,
                            _ => {
                                return Err(StoreError::Corrupt(
                                    "unknown work execution mode".into(),
                                ))
                            }
                        };
                        WorkNode::task(project, work_id, mode, parent_id, "")
                    }
                    _ => return Err(StoreError::Corrupt("unknown v3 decomposition kind".into())),
                };
                Ok(node)
            })
            .collect()
    }

    fn work_dependencies_domain_v3(
        &self,
        project_id: &str,
    ) -> Result<Vec<DirectDependency>, StoreError> {
        let mut statement = self.prepare(
            "SELECT prerequisite_work_id, dependent_work_id
             FROM work_dependency_v3 WHERE project_id = ?1
             ORDER BY prerequisite_work_id, dependent_work_id",
        )?;
        statement.bind_text(1, project_id)?;
        let mut dependencies = Vec::new();
        while statement.step()? == SQLITE_ROW {
            dependencies.push(DirectDependency {
                blocker_id: WorkId::new(statement.column_text(0)?),
                blocked_id: WorkId::new(statement.column_text(1)?),
            });
        }
        Ok(dependencies)
    }

    pub fn create_cycle_series_v3(
        &self,
        context: &V3MutationContext,
        input: &CycleSeriesV3Input,
    ) -> Result<MutationResult, StoreError> {
        let bound = context.with_payload(json!({"project_id": input.project_id, "series_id": input.series_id, "name": input.name, "lifecycle": input.lifecycle, "timezone": input.timezone, "tzdb_identity": input.tzdb_identity}));
        let context = &bound;
        ensure_project(&context.project_id, &input.project_id)?;
        self.v3_mutation(
            context,
            "cycle.series.create",
            "cycle_series",
            &input.series_id,
            || {
                let mut statement = self.prepare(
                    "INSERT INTO cycle_series_v3
                 (series_id, project_id, name, lifecycle, timezone, tzdb_identity,
                  revision, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, ?8)",
                )?;
                statement.bind_text(1, &input.series_id)?;
                statement.bind_text(2, &input.project_id)?;
                statement.bind_text(3, &input.name)?;
                statement.bind_text(4, &input.lifecycle)?;
                statement.bind_text(5, &input.timezone)?;
                statement.bind_text(6, &input.tzdb_identity)?;
                statement.bind_text(7, &input.created_at)?;
                statement.bind_text(8, &input.updated_at)?;
                statement.run()
            },
        )
    }

    pub fn cycle_series_v3(
        &self,
        project_id: &str,
        series_id: &str,
    ) -> Result<Option<CycleSeriesV3Record>, StoreError> {
        let mut statement = self.prepare(
            "SELECT project_id, series_id, name, lifecycle, timezone,
                    tzdb_identity, revision, created_at, updated_at
             FROM cycle_series_v3 WHERE project_id = ?1 AND series_id = ?2",
        )?;
        statement.bind_text(1, project_id)?;
        statement.bind_text(2, series_id)?;
        if statement.step()? != SQLITE_ROW {
            return Ok(None);
        }
        Ok(Some(CycleSeriesV3Record {
            project_id: statement.column_text(0)?,
            series_id: statement.column_text(1)?,
            name: statement.column_text(2)?,
            lifecycle: statement.column_text(3)?,
            timezone: statement.column_text(4)?,
            tzdb_identity: statement.column_text(5)?,
            revision: statement.column_u64(6)?,
            created_at: statement.column_text(7)?,
            updated_at: statement.column_text(8)?,
        }))
    }

    pub fn create_cycle_template_v3(
        &self,
        context: &V3MutationContext,
        input: &CycleTemplateV3Input,
    ) -> Result<MutationResult, StoreError> {
        let bound = context.with_payload(json!({"project_id": input.project_id, "template_version_id": input.template_version_id, "series_id": input.series_id, "version": input.version, "effective_from_slot_ordinal": input.effective_from_slot_ordinal, "interval_weeks": input.interval_weeks, "anchor_local_date": input.anchor_local_date, "anchor_local_time": input.anchor_local_time, "anchor_weekday": input.anchor_weekday, "recurrence_end_kind": input.recurrence_end_kind, "recurrence_end_count": input.recurrence_end_count, "recurrence_end_local_date": input.recurrence_end_local_date, "name_pattern": input.name_pattern, "goal_template": input.goal_template, "timezone": input.timezone, "tzdb_identity": input.tzdb_identity, "gap_policy": input.gap_policy, "fold_policy": input.fold_policy, "weekdays": input.weekdays}));
        let context = &bound;
        ensure_project(&context.project_id, &input.project_id)?;
        self.v3_mutation(
            context,
            "cycle.template.create",
            "cycle_template",
            &input.template_version_id,
            || {
                let mut statement = self.prepare(
                    "INSERT INTO cycle_template_v3
                 (template_version_id, project_id, series_id, version,
                  effective_from_slot_ordinal, interval_weeks, anchor_local_date,
                  anchor_local_time, anchor_weekday, recurrence_end_kind,
                  recurrence_end_count, recurrence_end_local_date, name_pattern,
                  goal_template, timezone, tzdb_identity, gap_policy, fold_policy,
                  created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
                         ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
                )?;
                statement.bind_text(1, &input.template_version_id)?;
                statement.bind_text(2, &input.project_id)?;
                statement.bind_text(3, &input.series_id)?;
                statement.bind_i64(4, input.version)?;
                statement.bind_i64(5, input.effective_from_slot_ordinal)?;
                statement.bind_i64(6, input.interval_weeks)?;
                statement.bind_text(7, &input.anchor_local_date)?;
                statement.bind_text(8, &input.anchor_local_time)?;
                statement.bind_i64(9, u64::from(input.anchor_weekday))?;
                statement.bind_text(10, &input.recurrence_end_kind)?;
                statement.bind_optional_i64(11, input.recurrence_end_count)?;
                statement.bind_optional_text(12, input.recurrence_end_local_date.as_deref())?;
                statement.bind_text(13, &input.name_pattern)?;
                statement.bind_text(14, &input.goal_template)?;
                statement.bind_text(15, &input.timezone)?;
                statement.bind_text(16, &input.tzdb_identity)?;
                statement.bind_text(17, &input.gap_policy)?;
                statement.bind_text(18, &input.fold_policy)?;
                statement.bind_text(19, &input.created_at)?;
                statement.run()?;
                for weekday in &input.weekdays {
                    let mut day = self.prepare(
                        "INSERT INTO cycle_template_weekday_v3
                     (project_id, template_version_id, weekday) VALUES (?1, ?2, ?3)",
                    )?;
                    day.bind_text(1, &input.project_id)?;
                    day.bind_text(2, &input.template_version_id)?;
                    day.bind_i64(3, u64::from(*weekday))?;
                    day.run()?;
                }
                Ok(())
            },
        )
    }

    pub fn cycle_template_v3(
        &self,
        project_id: &str,
        template_version_id: &str,
    ) -> Result<Option<CycleTemplateV3Record>, StoreError> {
        let mut statement = self.prepare(
            "SELECT project_id, template_version_id, series_id, version,
                    effective_from_slot_ordinal, interval_weeks, anchor_local_date,
                    anchor_local_time, anchor_weekday, recurrence_end_kind,
                    recurrence_end_count, recurrence_end_local_date, name_pattern,
                    goal_template, timezone, tzdb_identity, gap_policy, fold_policy,
                    created_at
             FROM cycle_template_v3
             WHERE project_id = ?1 AND template_version_id = ?2",
        )?;
        statement.bind_text(1, project_id)?;
        statement.bind_text(2, template_version_id)?;
        if statement.step()? != SQLITE_ROW {
            return Ok(None);
        }
        let record = CycleTemplateV3Record {
            project_id: statement.column_text(0)?,
            template_version_id: statement.column_text(1)?,
            series_id: statement.column_text(2)?,
            version: statement.column_u64(3)?,
            effective_from_slot_ordinal: statement.column_u64(4)?,
            interval_weeks: statement.column_u64(5)?,
            anchor_local_date: statement.column_text(6)?,
            anchor_local_time: statement.column_text(7)?,
            anchor_weekday: statement.column_u64(8)? as u8,
            recurrence_end_kind: statement.column_text(9)?,
            recurrence_end_count: statement.column_optional_i64(10)?,
            recurrence_end_local_date: statement.column_optional_text(11)?,
            name_pattern: statement.column_text(12)?,
            goal_template: statement.column_text(13)?,
            timezone: statement.column_text(14)?,
            tzdb_identity: statement.column_text(15)?,
            gap_policy: statement.column_text(16)?,
            fold_policy: statement.column_text(17)?,
            weekdays: Vec::new(),
            created_at: statement.column_text(18)?,
        };
        drop(statement);
        let mut weekdays = self.prepare(
            "SELECT weekday FROM cycle_template_weekday_v3
             WHERE project_id = ?1 AND template_version_id = ?2 ORDER BY weekday",
        )?;
        weekdays.bind_text(1, project_id)?;
        weekdays.bind_text(2, template_version_id)?;
        let mut values = Vec::new();
        while weekdays.step()? == SQLITE_ROW {
            values.push(weekdays.column_u64(0)? as u8);
        }
        Ok(Some(CycleTemplateV3Record {
            weekdays: values,
            ..record
        }))
    }

    pub fn create_cycle_v3(
        &self,
        context: &V3MutationContext,
        input: &CycleV3Input,
    ) -> Result<MutationResult, StoreError> {
        let bound = context.with_payload(json!({"project_id": input.project_id, "cycle_id": input.cycle_id, "series_id": input.series_id, "template_version_id": input.template_version_id, "slot_ordinal": input.slot_ordinal, "name": input.name, "goal": input.goal, "lifecycle": input.lifecycle, "scheduled_start_utc_ms": input.scheduled_start_utc_ms, "scheduled_end_utc_ms": input.scheduled_end_utc_ms, "scheduled_start_local": input.scheduled_start_local, "scheduled_start_utc_offset_minutes": input.scheduled_start_utc_offset_minutes, "timezone": input.timezone, "tzdb_identity": input.tzdb_identity, "gap_policy": input.gap_policy, "fold_policy": input.fold_policy}));
        let context = &bound;
        ensure_project(&context.project_id, &input.project_id)?;
        self.v3_mutation(context, "cycle.create", "cycle", &input.cycle_id, || {
            let mut statement = self.prepare(
                "INSERT INTO cycle_v3
                 (cycle_id, project_id, series_id, template_version_id, slot_ordinal,
                  slot_key, name, goal, lifecycle, scheduled_start_utc_ms,
                  scheduled_end_utc_ms, scheduled_start_local,
                  scheduled_start_utc_offset_minutes, timezone, tzdb_identity,
                  gap_policy, fold_policy, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
                         ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
            )?;
            statement.bind_text(1, &input.cycle_id)?;
            statement.bind_text(2, &input.project_id)?;
            statement.bind_text(3, &input.series_id)?;
            statement.bind_text(4, &input.template_version_id)?;
            statement.bind_i64(5, input.slot_ordinal)?;
            statement.bind_text(
                6,
                &format!(
                    "boreal.cycle-slot/1/{}/{}",
                    input.series_id, input.slot_ordinal
                ),
            )?;
            statement.bind_text(7, &input.name)?;
            statement.bind_text(8, &input.goal)?;
            statement.bind_text(9, &input.lifecycle)?;
            statement.bind_signed_i64(10, input.scheduled_start_utc_ms)?;
            bind_optional_signed_i64(&mut statement, 11, input.scheduled_end_utc_ms)?;
            statement.bind_text(12, &input.scheduled_start_local)?;
            statement.bind_signed_i64(13, input.scheduled_start_utc_offset_minutes)?;
            statement.bind_text(14, &input.timezone)?;
            statement.bind_text(15, &input.tzdb_identity)?;
            statement.bind_text(16, &input.gap_policy)?;
            statement.bind_text(17, &input.fold_policy)?;
            statement.bind_text(18, &input.created_at)?;
            statement.bind_text(19, &input.updated_at)?;
            statement.run()
        })
    }

    pub fn cycle_v3(
        &self,
        project_id: &str,
        cycle_id: &str,
    ) -> Result<Option<CycleV3Record>, StoreError> {
        let mut statement = self.prepare(
            "SELECT project_id, cycle_id, series_id, template_version_id,
                    slot_ordinal, name, goal, lifecycle, scheduled_start_utc_ms,
                    scheduled_end_utc_ms, scheduled_start_local,
                    scheduled_start_utc_offset_minutes, timezone, tzdb_identity,
                    gap_policy, fold_policy, created_at, updated_at
             FROM cycle_v3 WHERE project_id = ?1 AND cycle_id = ?2",
        )?;
        statement.bind_text(1, project_id)?;
        statement.bind_text(2, cycle_id)?;
        if statement.step()? != SQLITE_ROW {
            return Ok(None);
        }
        let series_id = statement.column_text(2)?;
        let slot_ordinal = statement.column_u64(4)?;
        Ok(Some(CycleV3Record {
            project_id: statement.column_text(0)?,
            cycle_id: statement.column_text(1)?,
            series_id: series_id.clone(),
            template_version_id: statement.column_text(3)?,
            slot_ordinal,
            name: statement.column_text(5)?,
            goal: statement.column_text(6)?,
            lifecycle: statement.column_text(7)?,
            scheduled_start_utc_ms: statement.column_i64(8)?,
            scheduled_end_utc_ms: statement.column_optional_signed_i64(9)?,
            scheduled_start_local: statement.column_text(10)?,
            scheduled_start_utc_offset_minutes: statement.column_i64(11)?,
            timezone: statement.column_text(12)?,
            tzdb_identity: statement.column_text(13)?,
            gap_policy: statement.column_text(14)?,
            fold_policy: statement.column_text(15)?,
            created_at: statement.column_text(16)?,
            updated_at: statement.column_text(17)?,
        }))
    }

    pub fn assign_cycle_work_v3(
        &self,
        context: &V3MutationContext,
        input: &CycleAssignmentV3Input,
    ) -> Result<MutationResult, StoreError> {
        if input.state != "planned"
            || input.predecessor_id.is_some()
            || input.successor_id.is_some()
        {
            return Err(StoreError::Invalid(
                "new cycle assignments must start planned without lineage; use the carry-over operation to link assignment history".into(),
            ));
        }
        let bound = context.with_payload(json!({"project_id": input.project_id, "assignment_id": input.assignment_id, "cycle_id": input.cycle_id, "work_id": input.work_id, "state": input.state, "activation_policy": input.activation_policy, "activation_at_utc_ms": input.activation_at_utc_ms, "predecessor_id": input.predecessor_id, "successor_id": input.successor_id}));
        let context = &bound;
        ensure_project(&context.project_id, &input.project_id)?;
        self.v3_mutation(
            context,
            "cycle.assignment.create",
            "cycle_assignment",
            &input.assignment_id,
            || {
                let mut statement = self.prepare(
                    "INSERT INTO cycle_assignment_v3
                 (assignment_id, project_id, cycle_id, work_id, state,
                  activation_policy, activation_at_utc_ms, predecessor_id,
                  successor_id, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                )?;
                statement.bind_text(1, &input.assignment_id)?;
                statement.bind_text(2, &input.project_id)?;
                statement.bind_text(3, &input.cycle_id)?;
                statement.bind_text(4, &input.work_id)?;
                statement.bind_text(5, &input.state)?;
                statement.bind_text(6, &input.activation_policy)?;
                bind_optional_signed_i64(&mut statement, 7, input.activation_at_utc_ms)?;
                statement.bind_optional_text(8, input.predecessor_id.as_deref())?;
                statement.bind_optional_text(9, input.successor_id.as_deref())?;
                statement.bind_text(10, &input.created_at)?;
                statement.bind_text(11, &input.updated_at)?;
                statement.run()
            },
        )
    }

    pub fn cycle_assignments_v3(
        &self,
        project_id: &str,
        cycle_id: &str,
    ) -> Result<Vec<CycleAssignmentV3Record>, StoreError> {
        let mut statement = self.prepare(
            "SELECT project_id, assignment_id, cycle_id, work_id, state,
                    activation_policy, activation_at_utc_ms, predecessor_id,
                    successor_id, created_at, updated_at
             FROM cycle_assignment_v3
             WHERE project_id = ?1 AND cycle_id = ?2 ORDER BY assignment_id",
        )?;
        statement.bind_text(1, project_id)?;
        statement.bind_text(2, cycle_id)?;
        let mut rows = Vec::new();
        while statement.step()? == SQLITE_ROW {
            rows.push(CycleAssignmentV3Record {
                project_id: statement.column_text(0)?,
                assignment_id: statement.column_text(1)?,
                cycle_id: statement.column_text(2)?,
                work_id: statement.column_text(3)?,
                state: statement.column_text(4)?,
                activation_policy: statement.column_text(5)?,
                activation_at_utc_ms: statement.column_optional_signed_i64(6)?,
                predecessor_id: statement.column_optional_text(7)?,
                successor_id: statement.column_optional_text(8)?,
                created_at: statement.column_text(9)?,
                updated_at: statement.column_text(10)?,
            });
        }
        Ok(rows)
    }

    /// Read valid cycle assignment rows while retaining a scoped diagnostic
    /// for each malformed sibling. A damaged assignment must not hide the
    /// other rows on the cycle board.
    pub fn cycle_assignments_v3_scoped(
        &self,
        project_id: &str,
        cycle_id: &str,
    ) -> Result<(Vec<CycleAssignmentV3Record>, Vec<StatusRecordDiagnostic>), StoreError> {
        let mut statement = self.prepare(
            "SELECT project_id, assignment_id, cycle_id, work_id, state,
                    activation_policy, activation_at_utc_ms, predecessor_id,
                    successor_id, created_at, updated_at, rowid
             FROM cycle_assignment_v3
             WHERE project_id = ?1 AND cycle_id = ?2 ORDER BY assignment_id",
        )?;
        statement.bind_text(1, project_id)?;
        statement.bind_text(2, cycle_id)?;
        let mut rows = Vec::new();
        let mut diagnostics = Vec::new();
        while statement.step()? == SQLITE_ROW {
            let row_identity = statement.column_i64(11).unwrap_or_default();
            let work_id = statement.column_text(3).ok();
            let assignment_id = statement.column_text(1).ok();
            let record: Result<CycleAssignmentV3Record, StoreError> = (|| {
                Ok(CycleAssignmentV3Record {
                    project_id: statement.column_text(0)?,
                    assignment_id: statement.column_text(1)?,
                    cycle_id: statement.column_text(2)?,
                    work_id: statement.column_text(3)?,
                    state: statement.column_text(4)?,
                    activation_policy: statement.column_text(5)?,
                    activation_at_utc_ms: statement.column_optional_signed_i64(6)?,
                    predecessor_id: statement.column_optional_text(7)?,
                    successor_id: statement.column_optional_text(8)?,
                    created_at: statement.column_text(9)?,
                    updated_at: statement.column_text(10)?,
                })
            })();
            match record {
                Ok(record) => rows.push(record),
                Err(error) => diagnostics.push(StatusRecordDiagnostic {
                    work_id: work_id.unwrap_or_else(|| {
                        assignment_id.map_or_else(
                            || format!("quarantined-assignment-row:{row_identity}"),
                            |id| format!("quarantined-assignment:{id}"),
                        )
                    }),
                    title: None,
                    code: "cycle_assignment_corrupt".to_owned(),
                    detail: error.to_string(),
                }),
            }
        }
        Ok((rows, diagnostics))
    }

    pub fn cycle_assignment_v3_by_id(
        &self,
        project_id: &str,
        assignment_id: &str,
    ) -> Result<Option<CycleAssignmentV3Record>, StoreError> {
        let mut statement = self.prepare(
            "SELECT project_id, assignment_id, cycle_id, work_id, state,
                    activation_policy, activation_at_utc_ms, predecessor_id,
                    successor_id, created_at, updated_at
             FROM cycle_assignment_v3 WHERE project_id=?1 AND assignment_id=?2",
        )?;
        statement.bind_text(1, project_id)?;
        statement.bind_text(2, assignment_id)?;
        if statement.step()? != SQLITE_ROW {
            return Ok(None);
        }
        Ok(Some(CycleAssignmentV3Record {
            project_id: statement.column_text(0)?,
            assignment_id: statement.column_text(1)?,
            cycle_id: statement.column_text(2)?,
            work_id: statement.column_text(3)?,
            state: statement.column_text(4)?,
            activation_policy: statement.column_text(5)?,
            activation_at_utc_ms: statement.column_optional_signed_i64(6)?,
            predecessor_id: statement.column_optional_text(7)?,
            successor_id: statement.column_optional_text(8)?,
            created_at: statement.column_text(9)?,
            updated_at: statement.column_text(10)?,
        }))
    }

    pub fn create_intake_bucket_v3(
        &self,
        context: &V3MutationContext,
        input: &IntakeBucketV3Input,
    ) -> Result<MutationResult, StoreError> {
        let bound = context.with_payload(json!({"project_id": input.project_id, "bucket_id": input.bucket_id, "name": input.name, "archived": input.archived}));
        let context = &bound;
        ensure_project(&context.project_id, &input.project_id)?;
        self.v3_mutation(
            context,
            "intake.bucket.create",
            "intake_bucket",
            &input.bucket_id,
            || {
                let mut statement = self.prepare(
                    "INSERT INTO intake_bucket_v3
                 (bucket_id, project_id, name, archived, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                )?;
                statement.bind_text(1, &input.bucket_id)?;
                statement.bind_text(2, &input.project_id)?;
                statement.bind_text(3, &input.name)?;
                statement.bind_i64(4, u64::from(input.archived))?;
                statement.bind_text(5, &input.created_at)?;
                statement.bind_text(6, &input.updated_at)?;
                statement.run()
            },
        )
    }

    pub fn create_intake_item_v3(
        &self,
        context: &V3MutationContext,
        input: &IntakeItemV3Input,
    ) -> Result<MutationResult, StoreError> {
        let bound = context.with_payload(json!({"project_id": input.project_id, "intake_id": input.intake_id, "bucket_id": input.bucket_id, "kind": input.kind, "lifecycle": input.lifecycle, "content": input.content, "content_revision": input.content_revision, "content_digest": input.content_digest, "revisit_at_utc_ms": input.revisit_at_utc_ms}));
        let context = &bound;
        ensure_project(&context.project_id, &input.project_id)?;
        self.v3_mutation(
            context,
            "intake.item.create",
            "intake_item",
            &input.intake_id,
            || {
                let mut statement = self.prepare(
                    "INSERT INTO intake_item_v3
                 (intake_id, project_id, bucket_id, kind, lifecycle, content,
                  content_revision, content_digest, captured_at, updated_at,
                  revisit_at_utc_ms)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                )?;
                statement.bind_text(1, &input.intake_id)?;
                statement.bind_text(2, &input.project_id)?;
                statement.bind_text(3, &input.bucket_id)?;
                statement.bind_text(4, &input.kind)?;
                statement.bind_text(5, &input.lifecycle)?;
                statement.bind_text(6, &input.content)?;
                statement.bind_i64(7, input.content_revision)?;
                statement.bind_text(8, &input.content_digest)?;
                statement.bind_text(9, &input.captured_at)?;
                statement.bind_text(10, &input.updated_at)?;
                bind_optional_signed_i64(&mut statement, 11, input.revisit_at_utc_ms)?;
                statement.run()
            },
        )
    }

    pub fn intake_items_v3(&self, project_id: &str) -> Result<Vec<IntakeItemV3Record>, StoreError> {
        let mut statement = self.prepare(
            "SELECT project_id, intake_id, bucket_id, kind, lifecycle, content,
                    content_revision, content_digest, captured_at, updated_at,
                    revisit_at_utc_ms
             FROM intake_item_v3 WHERE project_id = ?1 ORDER BY captured_at, intake_id",
        )?;
        statement.bind_text(1, project_id)?;
        let mut rows = Vec::new();
        while statement.step()? == SQLITE_ROW {
            rows.push(IntakeItemV3Record {
                project_id: statement.column_text(0)?,
                intake_id: statement.column_text(1)?,
                bucket_id: statement.column_text(2)?,
                kind: statement.column_text(3)?,
                lifecycle: statement.column_text(4)?,
                content: statement.column_text(5)?,
                content_revision: statement.column_u64(6)?,
                content_digest: statement.column_text(7)?,
                captured_at: statement.column_text(8)?,
                updated_at: statement.column_text(9)?,
                revisit_at_utc_ms: statement.column_optional_signed_i64(10)?,
            });
        }
        Ok(rows)
    }

    pub fn intake_item_v3(
        &self,
        project_id: &str,
        intake_id: &str,
    ) -> Result<Option<IntakeItemV3Record>, StoreError> {
        let mut statement = self.prepare(
            "SELECT project_id, intake_id, bucket_id, kind, lifecycle, content,
                    content_revision, content_digest, captured_at, updated_at,
                    revisit_at_utc_ms
             FROM intake_item_v3 WHERE project_id = ?1 AND intake_id = ?2",
        )?;
        statement.bind_text(1, project_id)?;
        statement.bind_text(2, intake_id)?;
        if statement.step()? != SQLITE_ROW {
            return Ok(None);
        }
        Ok(Some(IntakeItemV3Record {
            project_id: statement.column_text(0)?,
            intake_id: statement.column_text(1)?,
            bucket_id: statement.column_text(2)?,
            kind: statement.column_text(3)?,
            lifecycle: statement.column_text(4)?,
            content: statement.column_text(5)?,
            content_revision: statement.column_u64(6)?,
            content_digest: statement.column_text(7)?,
            captured_at: statement.column_text(8)?,
            updated_at: statement.column_text(9)?,
            revisit_at_utc_ms: statement.column_optional_signed_i64(10)?,
        }))
    }

    pub fn promote_intake_v3(
        &self,
        context: &V3MutationContext,
        input: &IntakePromotionV3Input,
    ) -> Result<MutationResult, StoreError> {
        let bound = context.with_payload(json!({"project_id": input.project_id, "promotion_id": input.promotion_id, "intake_id": input.intake_id, "intake_revision": input.intake_revision, "intake_digest": input.intake_digest, "target_kind": input.target_kind, "target_id": input.target_id, "actor_id": input.actor_id, "operation_id": input.operation_id}));
        let context = &bound;
        ensure_project(&context.project_id, &input.project_id)?;
        ensure_project(&context.actor_id, &input.actor_id)?;
        self.v3_mutation(
            context,
            "intake.promote",
            "intake",
            &input.intake_id,
            || {
                let mut statement = self.prepare(
                    "INSERT INTO intake_promotion_v3
                 (promotion_id, project_id, intake_id, intake_revision,
                  intake_digest, target_kind, target_id, actor_id, operation_id,
                  created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                )?;
                statement.bind_text(1, &input.promotion_id)?;
                statement.bind_text(2, &input.project_id)?;
                statement.bind_text(3, &input.intake_id)?;
                statement.bind_i64(4, input.intake_revision)?;
                statement.bind_text(5, &input.intake_digest)?;
                statement.bind_text(6, &input.target_kind)?;
                statement.bind_text(7, &input.target_id)?;
                statement.bind_text(8, &context.actor_id)?;
                statement.bind_text(9, &input.operation_id)?;
                statement.bind_text(10, &input.created_at)?;
                statement.run()
            },
        )
    }

    pub fn intake_promotions_v3(
        &self,
        project_id: &str,
        intake_id: &str,
    ) -> Result<Vec<IntakePromotionV3Input>, StoreError> {
        let mut statement = self.prepare(
            "SELECT project_id, promotion_id, intake_id, intake_revision,
                    intake_digest, target_kind, target_id, actor_id,
                    operation_id, created_at
             FROM intake_promotion_v3
             WHERE project_id = ?1 AND intake_id = ?2
             ORDER BY created_at, promotion_id",
        )?;
        statement.bind_text(1, project_id)?;
        statement.bind_text(2, intake_id)?;
        let mut rows = Vec::new();
        while statement.step()? == SQLITE_ROW {
            rows.push(IntakePromotionV3Input {
                project_id: statement.column_text(0)?,
                promotion_id: statement.column_text(1)?,
                intake_id: statement.column_text(2)?,
                intake_revision: statement.column_u64(3)?,
                intake_digest: statement.column_text(4)?,
                target_kind: statement.column_text(5)?,
                target_id: statement.column_text(6)?,
                actor_id: statement.column_text(7)?,
                operation_id: statement.column_text(8)?,
                created_at: statement.column_text(9)?,
            });
        }
        Ok(rows)
    }

    pub fn append_container_disposition_v3(
        &self,
        context: &V3MutationContext,
        input: &ContainerDispositionV3Input,
    ) -> Result<MutationResult, StoreError> {
        let bound = context.with_payload(json!({"project_id": input.project_id, "disposition_id": input.disposition_id, "container_work_id": input.container_work_id, "descendant_work_id": input.descendant_work_id, "kind": input.kind, "descendant_revision": input.descendant_revision, "descendant_outcome_digest": input.descendant_outcome_digest, "replacement_work_id": input.replacement_work_id, "reason": input.reason, "supersedes_id": input.supersedes_id}));
        let context = &bound;
        ensure_project(&context.project_id, &input.project_id)?;
        self.v3_mutation(
            context,
            "container.disposition.append",
            "container",
            &input.container_work_id,
            || {
                let mut statement = self.prepare(
                    "INSERT INTO container_disposition_v3
                 (disposition_id, project_id, container_work_id,
                  descendant_work_id, kind, descendant_revision,
                  descendant_outcome_digest, replacement_work_id, reason,
                  supersedes_id, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                )?;
                statement.bind_text(1, &input.disposition_id)?;
                statement.bind_text(2, &input.project_id)?;
                statement.bind_text(3, &input.container_work_id)?;
                statement.bind_text(4, &input.descendant_work_id)?;
                statement.bind_text(5, &input.kind)?;
                statement.bind_i64(6, input.descendant_revision)?;
                statement.bind_text(7, &input.descendant_outcome_digest)?;
                statement.bind_optional_text(8, input.replacement_work_id.as_deref())?;
                statement.bind_optional_text(9, input.reason.as_deref())?;
                statement.bind_optional_text(10, input.supersedes_id.as_deref())?;
                statement.bind_text(11, &input.created_at)?;
                statement.run()
            },
        )
    }

    pub fn current_container_disposition_v3(
        &self,
        project_id: &str,
        container_work_id: &str,
        descendant_work_id: &str,
    ) -> Result<Option<ContainerDispositionV3Input>, StoreError> {
        let mut statement = self.prepare(
            "SELECT project_id, disposition_id, container_work_id,
                    descendant_work_id, kind, descendant_revision,
                    descendant_outcome_digest, replacement_work_id, reason,
                    supersedes_id, created_at
             FROM container_disposition_v3 current
             WHERE current.project_id = ?1
               AND current.container_work_id = ?2
               AND current.descendant_work_id = ?3
               AND NOT EXISTS (
                 SELECT 1 FROM container_disposition_v3 successor
                 WHERE successor.supersedes_id = current.disposition_id
               )",
        )?;
        statement.bind_text(1, project_id)?;
        statement.bind_text(2, container_work_id)?;
        statement.bind_text(3, descendant_work_id)?;
        if statement.step()? != SQLITE_ROW {
            return Ok(None);
        }
        Ok(Some(ContainerDispositionV3Input {
            project_id: statement.column_text(0)?,
            disposition_id: statement.column_text(1)?,
            container_work_id: statement.column_text(2)?,
            descendant_work_id: statement.column_text(3)?,
            kind: statement.column_text(4)?,
            descendant_revision: statement.column_u64(5)?,
            descendant_outcome_digest: statement.column_text(6)?,
            replacement_work_id: statement.column_optional_text(7)?,
            reason: statement.column_optional_text(8)?,
            supersedes_id: statement.column_optional_text(9)?,
            created_at: statement.column_text(10)?,
        }))
    }

    /// Read an immutable disposition by its stable ID, including historical
    /// rows that have since been superseded. This is used to reconstruct the
    /// exact payload for replaying an operation after later dispositions have
    /// advanced the current chain.
    pub fn container_disposition_by_id_v3(
        &self,
        project_id: &str,
        disposition_id: &str,
    ) -> Result<Option<ContainerDispositionV3Input>, StoreError> {
        let mut statement = self.prepare(
            "SELECT project_id, disposition_id, container_work_id,
                    descendant_work_id, kind, descendant_revision,
                    descendant_outcome_digest, replacement_work_id, reason,
                    supersedes_id, created_at
             FROM container_disposition_v3
             WHERE project_id = ?1 AND disposition_id = ?2",
        )?;
        statement.bind_text(1, project_id)?;
        statement.bind_text(2, disposition_id)?;
        if statement.step()? != SQLITE_ROW {
            return Ok(None);
        }
        Ok(Some(ContainerDispositionV3Input {
            project_id: statement.column_text(0)?,
            disposition_id: statement.column_text(1)?,
            container_work_id: statement.column_text(2)?,
            descendant_work_id: statement.column_text(3)?,
            kind: statement.column_text(4)?,
            descendant_revision: statement.column_u64(5)?,
            descendant_outcome_digest: statement.column_text(6)?,
            replacement_work_id: statement.column_optional_text(7)?,
            reason: statement.column_optional_text(8)?,
            supersedes_id: statement.column_optional_text(9)?,
            created_at: statement.column_text(10)?,
        }))
    }

    pub(crate) fn v3_mutation<F>(
        &self,
        context: &V3MutationContext,
        command: &str,
        subject_type: &str,
        subject_id: &str,
        write: F,
    ) -> Result<MutationResult, StoreError>
    where
        F: FnOnce() -> Result<(), StoreError>,
    {
        let planning_roles = [boreal_domain::ActorRole::Operator];
        let ordinary_roles = [
            boreal_domain::ActorRole::Agent,
            boreal_domain::ActorRole::Operator,
        ];
        let roles = if command.starts_with("cycle.") || command.starts_with("container.disposition")
        {
            &planning_roles[..]
        } else {
            &ordinary_roles[..]
        };
        self.fact_mutation(context, command, subject_type, subject_id, roles, write)
    }

    /// Shared canonical fact transaction: role/session, replay, revision, write,
    /// journal and audit. Knowledge and planning cannot develop divergent policy.
    pub(crate) fn fact_mutation<F>(
        &self,
        context: &V3MutationContext,
        command: &str,
        subject_type: &str,
        subject_id: &str,
        roles: &[boreal_domain::ActorRole],
        write: F,
    ) -> Result<MutationResult, StoreError>
    where
        F: FnOnce() -> Result<(), StoreError>,
    {
        if !self.work_model_v3_enabled()? {
            return Err(StoreError::UnsupportedSchema {
                found: self.schema_version()?,
            });
        }
        self.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| {
            let session_id = context.session_id.clone();
            if self.canonical_production {
                let (role, _) = self.principal_authority(&context.project_id, &context.actor_id)?;
                if !roles.contains(&role) {
                    return Err(StoreError::Invalid(
                        "principal role does not permit this canonical mutation".into(),
                    ));
                }
                if context.expected_revision.is_none() || session_id.is_none() {
                    return Err(StoreError::Invalid(
                        "canonical mutations require explicit revision and project session".into(),
                    ));
                }
                self.validate_project_session(
                    &context.project_id,
                    &context.actor_id,
                    session_id
                        .as_deref()
                        .ok_or_else(|| StoreError::Invalid("project session missing".into()))?,
                )?;
            }
            // Classify a known v3 operation's immutable identity before the
            // legacy replay helper, which intentionally collapses any
            // identity mismatch into a generic conflict. Keeping this check
            // first preserves the v3 readback contract (owner/session/revision/
            // subject conflicts remain distinguishable, and a changed digest
            // reports the specific request-digest conflict). An exact replay
            // still goes through the helper below for journal/audit validation.
            if let Some(existing) = self.operation(&context.operation_id)? {
                if existing.project_id != context.project_id || existing.command != command {
                    return Err(StoreError::Conflict(format!(
                        "operation {} was already used with another immutable identity",
                        context.operation_id
                    )));
                }
                ensure_v3_replay_identity(
                    &existing,
                    context,
                    session_id.as_deref(),
                    subject_type,
                    subject_id,
                )?;
                if existing.request_digest != context.request_digest {
                    return Err(StoreError::Conflict(
                        "operation request digest mismatch".to_owned(),
                    ));
                }
            }
            if let Some(existing) = self.preflight_operation_replay(
                &context.project_id,
                &context.operation_id,
                command,
                &context.actor_id,
                session_id.as_deref(),
                context.expected_revision,
                None,
                None,
                &context.request_digest,
                // The compatibility audit vocabulary records these writes
                // against the operation itself. The semantic entity subject
                // is stored in result_json and checked below, so replay must
                // use the same durable audit subject the writer committed.
                "operation",
                &context.operation_id,
            )? {
                if existing.project_id != context.project_id
                    || existing.command != command
                    || existing.request_digest != context.request_digest
                {
                    return Err(StoreError::Conflict(
                        "operation request digest mismatch".to_owned(),
                    ));
                }
                ensure_v3_replay_identity(
                    &existing,
                    context,
                    session_id.as_deref(),
                    subject_type,
                    subject_id,
                )?;
                return Ok(MutationResult {
                    operation_id: context.operation_id.clone(),
                    revision: existing.revision,
                    replayed: true,
                });
            }
            let current = self.project_revision(&context.project_id)?.0;
            super::check_expected_revision(current, context.expected_revision)?;
            write()?;
            let revision = self.bump_revision_in_transaction(&context.project_id)?;
            let payload = json_object(json!({
                "command": command,
                "subject_type": subject_type,
                "subject_id": subject_id,
            }))?;
            self.append_operation_audit_in_transaction(
                OperationRecord {
                    operation_id: context.operation_id.clone(),
                    project_id: context.project_id.clone(),
                    command: command.to_owned(),
                    actor_id: context.actor_id.clone(),
                    session_id: session_id.clone(),
                    expected_revision: context.expected_revision,
                    attempt_id: None,
                    fence: None,
                    request_digest: context.request_digest.clone(),
                    outcome: OperationOutcome::Changed,
                    result_json: payload.clone(),
                    revision: revision.0,
                    created_at: context.now.clone(),
                    completed_at: Some(context.now.clone()),
                },
                AuditEventRecord {
                    project_id: context.project_id.clone(),
                    revision: revision.0,
                    operation_id: context.operation_id.clone(),
                    // The v2 audit CHECK set predates work-model/3. Preserve the
                    // precise v3 command and subject in the immutable payload,
                    // while using a compatible event/subject pair here.
                    event_type: "repair.correction".to_owned(),
                    subject_type: "operation".to_owned(),
                    subject_id: context.operation_id.clone(),
                    actor_id: context.actor_id.clone(),
                    session_id,
                    fence: None,
                    as_of: context.now.clone(),
                    payload_json: payload,
                },
            )?;
            Ok(MutationResult {
                operation_id: context.operation_id.clone(),
                revision: revision.0,
                replayed: false,
            })
        })();
        match result {
            Ok(value) => {
                self.execute_batch("COMMIT")?;
                Ok(value)
            }
            Err(error) => {
                let _ = self.execute_batch("ROLLBACK");
                Err(error)
            }
        }
    }
}

fn encode_schedule_payload(record: &WorkScheduleRecord) -> Result<String, StoreError> {
    let payload = json!({
        "version": 1,
        "not_before": encode_business_date(record.schedule.not_before.as_ref()),
        "due": encode_business_date(record.schedule.due.as_ref()),
        "planned_start": encode_business_date(record.schedule.planned_start.as_ref()),
        "planned_end": encode_business_date(record.schedule.planned_end.as_ref()),
    });
    serde_json::to_string(&payload)
        .map_err(|error| StoreError::Invalid(format!("cannot encode schedule: {error}")))
}

fn encode_external_wait(wait: &ExternalWait) -> Result<String, StoreError> {
    let payload = json!({
        "version": 1,
        "revision": wait.revision,
        "source_work_id": wait.source_work_id.as_str(),
        "affected_work_ids": wait.affected_work_ids.iter().map(WorkId::as_str).collect::<Vec<_>>(),
        "category": external_wait_category_name(wait.category),
        "reason": wait.reason,
        "accountable": encode_accountable(&wait.accountable),
        "expected_decision": wait.expected_decision,
        "expected_output": wait.expected_output,
        "follow_up": encode_business_date(wait.follow_up.as_ref()),
        "civil_time_setting_revision": wait.civil_time_setting_revision,
        "state": external_wait_state_name(wait.state),
        "created_by": wait.created_by,
        "created_at_ms": wait.created_at.as_millis(),
        "resolution": wait.resolution.as_ref().map(encode_resolution),
    });
    serde_json::to_string(&payload)
        .map_err(|error| StoreError::Invalid(format!("cannot encode external wait: {error}")))
}

fn encode_business_date(value: Option<&BusinessDate>) -> serde_json::Value {
    match value {
        None => serde_json::Value::Null,
        Some(BusinessDate::Instant(at)) => json!({"kind":"instant", "at_ms":at.as_millis()}),
        Some(BusinessDate::LocalDate(date)) => json!({
            "kind":"local_date", "year":date.year, "month":date.month, "day":date.day
        }),
        Some(BusinessDate::ResolvedLocal(value)) => json!({
            "kind":"resolved_local",
            "nominal_local": {
                "year": value.nominal_local.date.year,
                "month": value.nominal_local.date.month,
                "day": value.nominal_local.date.day,
                "hour": value.nominal_local.time.hour,
                "minute": value.nominal_local.time.minute,
                "second": value.nominal_local.time.second,
            },
            "utc_instant_ms": value.utc_instant.as_millis(),
            "utc_offset_minutes": value.utc_offset_minutes,
            "timezone": value.timezone,
            "tzdb_identity": value.tzdb_identity,
            "gap_policy": format!("{:?}", value.gap_policy).to_ascii_lowercase(),
            "fold_policy": format!("{:?}", value.fold_policy).to_ascii_lowercase(),
        }),
    }
}

fn encode_accountable(value: &ExternalWaitAccountable) -> serde_json::Value {
    match value {
        ExternalWaitAccountable::Person {
            reference,
            display_name,
        } => json!({"kind":"person", "reference":reference, "display_name":display_name}),
        ExternalWaitAccountable::Role(role) => {
            json!({"kind":"role", "role":actor_role_name(*role)})
        }
        ExternalWaitAccountable::Service {
            reference,
            display_name,
        } => json!({"kind":"service", "reference":reference, "display_name":display_name}),
    }
}

fn encode_resolution(value: &ExternalWaitResolution) -> serde_json::Value {
    json!({
        "outcome": external_wait_outcome_name(value.outcome),
        "detail": value.detail,
        "output_ref": value.output_ref,
        "supplied_by": encode_accountable(&value.supplied_by),
        "recorded_by": value.recorded_by,
        "recorded_as": actor_role_name(value.recorded_as),
        "recorded_at_ms": value.recorded_at.as_millis(),
    })
}

fn decode_work_schedule_record(
    project_id: String,
    work_id: String,
    revision: u64,
    payload_json: &str,
    civil_time_setting_revision: Option<u64>,
    updated_at_ms: u64,
) -> Result<WorkScheduleV3Record, StoreError> {
    let payload = parse_payload(payload_json, "work schedule")?;
    if required_u64(&payload, "version")? != 1 {
        return Err(StoreError::Corrupt(
            "unsupported schedule payload version".into(),
        ));
    }
    let schedule = BusinessSchedule {
        not_before: decode_business_date(required(&payload, "not_before")?)?,
        due: decode_business_date(required(&payload, "due")?)?,
        planned_start: decode_business_date(required(&payload, "planned_start")?)?,
        planned_end: decode_business_date(required(&payload, "planned_end")?)?,
    };
    let record = WorkScheduleRecord {
        project_id: ProjectId::new(project_id),
        work_id: WorkId::new(work_id),
        revision,
        schedule,
        civil_time_setting_revision,
        updated_at: TimestampMs::from_millis(updated_at_ms),
    };
    record
        .validate()
        .map_err(|error| StoreError::Corrupt(format!("invalid persisted schedule: {error}")))?;
    Ok(record)
}

fn decode_external_wait(
    project_id: &str,
    wait_id: &str,
    revision: u64,
    payload_json: &str,
) -> Result<ExternalWaitV1Record, StoreError> {
    let payload = parse_payload(payload_json, "external wait")?;
    if required_u64(&payload, "version")? != 1 || required_u64(&payload, "revision")? != revision {
        return Err(StoreError::Corrupt(
            "unsupported or mismatched external-wait payload revision".into(),
        ));
    }
    let affected = required(&payload, "affected_work_ids")?
        .as_array()
        .ok_or_else(|| StoreError::Corrupt("external-wait scope is not an array".into()))?
        .iter()
        .map(|value| {
            value
                .as_str()
                .map(|value| WorkId::new(value.to_owned()))
                .ok_or_else(|| StoreError::Corrupt("external-wait scope ID is not text".into()))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let state = parse_external_wait_state(required_string(&payload, "state")?)?;
    let resolution = match required(&payload, "resolution")? {
        serde_json::Value::Null => None,
        value => Some(decode_resolution(value)?),
    };
    let wait = ExternalWait {
        id: boreal_domain::work_model_v3::ExternalWaitId::new(wait_id),
        project_id: ProjectId::new(project_id),
        source_work_id: WorkId::new(required_string(&payload, "source_work_id")?),
        affected_work_ids: affected,
        category: parse_external_wait_category(required_string(&payload, "category")?)?,
        reason: required_string(&payload, "reason")?.to_owned(),
        accountable: decode_accountable(required(&payload, "accountable")?)?,
        expected_decision: optional_string(&payload, "expected_decision")?,
        expected_output: optional_string(&payload, "expected_output")?,
        follow_up: decode_business_date(required(&payload, "follow_up")?)?,
        civil_time_setting_revision: optional_u64(&payload, "civil_time_setting_revision")?,
        revision,
        state,
        created_by: required_string(&payload, "created_by")?.to_owned(),
        created_at: TimestampMs::from_millis(required_u64(&payload, "created_at_ms")?),
        resolution,
    };
    Ok(wait)
}

fn decode_business_date(value: &serde_json::Value) -> Result<Option<BusinessDate>, StoreError> {
    if value.is_null() {
        return Ok(None);
    }
    let kind = required_string(value, "kind")?;
    let date = match kind {
        "instant" => BusinessDate::Instant(TimestampMs::from_millis(required_u64(value, "at_ms")?)),
        "local_date" => BusinessDate::LocalDate(LocalDate::new(
            required_i32(value, "year")?,
            required_u8(value, "month")?,
            required_u8(value, "day")?,
        )),
        "resolved_local" => {
            let local = required(value, "nominal_local")?;
            BusinessDate::ResolvedLocal(TimeResolution {
                nominal_local: LocalDateTime::new(
                    LocalDate::new(
                        required_i32(local, "year")?,
                        required_u8(local, "month")?,
                        required_u8(local, "day")?,
                    ),
                    LocalTime::new(
                        required_u8(local, "hour")?,
                        required_u8(local, "minute")?,
                        required_u8(local, "second")?,
                    ),
                ),
                utc_instant: TimestampMs::from_millis(required_u64(value, "utc_instant_ms")?),
                utc_offset_minutes: required_i32(value, "utc_offset_minutes")?,
                timezone: required_string(value, "timezone")?.to_owned(),
                tzdb_identity: required_string(value, "tzdb_identity")?.to_owned(),
                gap_policy: match required_string(value, "gap_policy")? {
                    "nextvalid" => GapPolicy::NextValid,
                    _ => return Err(StoreError::Corrupt("unknown local-time gap policy".into())),
                },
                fold_policy: match required_string(value, "fold_policy")? {
                    "earlieroffset" => FoldPolicy::EarlierOffset,
                    "lateroffset" => FoldPolicy::LaterOffset,
                    _ => return Err(StoreError::Corrupt("unknown local-time fold policy".into())),
                },
            })
        }
        _ => {
            return Err(StoreError::Corrupt(format!(
                "unknown business-date kind {kind:?}"
            )))
        }
    };
    date.validate()
        .map_err(|error| StoreError::Corrupt(format!("invalid business date: {error}")))?;
    Ok(Some(date))
}

fn decode_accountable(value: &serde_json::Value) -> Result<ExternalWaitAccountable, StoreError> {
    match required_string(value, "kind")? {
        "person" => Ok(ExternalWaitAccountable::Person {
            reference: required_string(value, "reference")?.to_owned(),
            display_name: required_string(value, "display_name")?.to_owned(),
        }),
        "service" => Ok(ExternalWaitAccountable::Service {
            reference: required_string(value, "reference")?.to_owned(),
            display_name: required_string(value, "display_name")?.to_owned(),
        }),
        "role" => Ok(ExternalWaitAccountable::Role(parse_actor_role(
            required_string(value, "role")?,
        )?)),
        kind => Err(StoreError::Corrupt(format!(
            "unknown accountable kind {kind:?}"
        ))),
    }
}

fn decode_resolution(value: &serde_json::Value) -> Result<ExternalWaitResolution, StoreError> {
    Ok(ExternalWaitResolution {
        outcome: parse_external_wait_outcome(required_string(value, "outcome")?)?,
        detail: required_string(value, "detail")?.to_owned(),
        output_ref: optional_string(value, "output_ref")?,
        supplied_by: decode_accountable(required(value, "supplied_by")?)?,
        recorded_by: required_string(value, "recorded_by")?.to_owned(),
        recorded_as: parse_actor_role(required_string(value, "recorded_as")?)?,
        recorded_at: TimestampMs::from_millis(required_u64(value, "recorded_at_ms")?),
    })
}

fn parse_payload(payload_json: &str, label: &str) -> Result<serde_json::Value, StoreError> {
    let value = serde_json::from_str::<serde_json::Value>(payload_json).map_err(|error| {
        StoreError::Corrupt(format!("{label} payload is invalid JSON: {error}"))
    })?;
    if !value.is_object() {
        return Err(StoreError::Corrupt(format!(
            "{label} payload is not an object"
        )));
    }
    Ok(value)
}

fn required<'a>(
    value: &'a serde_json::Value,
    key: &str,
) -> Result<&'a serde_json::Value, StoreError> {
    value
        .as_object()
        .and_then(|object| object.get(key))
        .ok_or_else(|| StoreError::Corrupt(format!("payload is missing {key}")))
}

fn required_string<'a>(value: &'a serde_json::Value, key: &str) -> Result<&'a str, StoreError> {
    required(value, key)?
        .as_str()
        .ok_or_else(|| StoreError::Corrupt(format!("payload field {key} is not text")))
}

fn optional_string(value: &serde_json::Value, key: &str) -> Result<Option<String>, StoreError> {
    match required(value, key)? {
        serde_json::Value::Null => Ok(None),
        value => value
            .as_str()
            .map(|value| Some(value.to_owned()))
            .ok_or_else(|| StoreError::Corrupt(format!("payload field {key} is not text or null"))),
    }
}

fn required_u64(value: &serde_json::Value, key: &str) -> Result<u64, StoreError> {
    required(value, key)?.as_u64().ok_or_else(|| {
        StoreError::Corrupt(format!("payload field {key} is not an unsigned integer"))
    })
}

fn optional_u64(value: &serde_json::Value, key: &str) -> Result<Option<u64>, StoreError> {
    match required(value, key)? {
        serde_json::Value::Null => Ok(None),
        value => value.as_u64().map(Some).ok_or_else(|| {
            StoreError::Corrupt(format!(
                "payload field {key} is not an unsigned integer or null"
            ))
        }),
    }
}

fn required_i32(value: &serde_json::Value, key: &str) -> Result<i32, StoreError> {
    required(value, key)?
        .as_i64()
        .and_then(|value| i32::try_from(value).ok())
        .ok_or_else(|| StoreError::Corrupt(format!("payload field {key} is not a 32-bit integer")))
}

fn required_u8(value: &serde_json::Value, key: &str) -> Result<u8, StoreError> {
    required(value, key)?
        .as_u64()
        .and_then(|value| u8::try_from(value).ok())
        .ok_or_else(|| {
            StoreError::Corrupt(format!(
                "payload field {key} is not an 8-bit unsigned integer"
            ))
        })
}

fn external_wait_category_name(value: ExternalWaitCategory) -> &'static str {
    match value {
        ExternalWaitCategory::Decision => "decision",
        ExternalWaitCategory::Approval => "approval",
        ExternalWaitCategory::Information => "information",
        ExternalWaitCategory::Access => "access",
        ExternalWaitCategory::Service => "service",
        ExternalWaitCategory::Other => "other",
    }
}

fn parse_external_wait_category(value: &str) -> Result<ExternalWaitCategory, StoreError> {
    match value {
        "decision" => Ok(ExternalWaitCategory::Decision),
        "approval" => Ok(ExternalWaitCategory::Approval),
        "information" => Ok(ExternalWaitCategory::Information),
        "access" => Ok(ExternalWaitCategory::Access),
        "service" => Ok(ExternalWaitCategory::Service),
        "other" => Ok(ExternalWaitCategory::Other),
        _ => Err(StoreError::Corrupt(format!(
            "unknown external-wait category {value:?}"
        ))),
    }
}

fn external_wait_state_name(value: ExternalWaitState) -> &'static str {
    match value {
        ExternalWaitState::Open => "open",
        ExternalWaitState::Resolved => "resolved",
        ExternalWaitState::Cancelled => "cancelled",
    }
}

fn parse_external_wait_state(value: &str) -> Result<ExternalWaitState, StoreError> {
    match value {
        "open" => Ok(ExternalWaitState::Open),
        "resolved" => Ok(ExternalWaitState::Resolved),
        "cancelled" => Ok(ExternalWaitState::Cancelled),
        _ => Err(StoreError::Corrupt(format!(
            "unknown external-wait state {value:?}"
        ))),
    }
}

fn external_wait_outcome_name(value: ExternalWaitOutcome) -> &'static str {
    match value {
        ExternalWaitOutcome::Approved => "approved",
        ExternalWaitOutcome::Rejected => "rejected",
        ExternalWaitOutcome::DecisionProvided => "decisionprovided",
        ExternalWaitOutcome::OutputProvided => "outputprovided",
        ExternalWaitOutcome::Declined => "declined",
        ExternalWaitOutcome::Unavailable => "unavailable",
        ExternalWaitOutcome::Cancelled => "cancelled",
    }
}

fn parse_external_wait_outcome(value: &str) -> Result<ExternalWaitOutcome, StoreError> {
    match value {
        "approved" => Ok(ExternalWaitOutcome::Approved),
        "rejected" => Ok(ExternalWaitOutcome::Rejected),
        "decisionprovided" => Ok(ExternalWaitOutcome::DecisionProvided),
        "outputprovided" => Ok(ExternalWaitOutcome::OutputProvided),
        "declined" => Ok(ExternalWaitOutcome::Declined),
        "unavailable" => Ok(ExternalWaitOutcome::Unavailable),
        "cancelled" => Ok(ExternalWaitOutcome::Cancelled),
        _ => Err(StoreError::Corrupt(format!(
            "unknown external-wait outcome {value:?}"
        ))),
    }
}

fn actor_role_name(value: ActorRole) -> &'static str {
    match value {
        ActorRole::Agent => "agent",
        ActorRole::Reviewer => "reviewer",
        ActorRole::Operator => "operator",
        ActorRole::Publisher => "publisher",
    }
}

fn parse_actor_role(value: &str) -> Result<ActorRole, StoreError> {
    match value {
        "agent" => Ok(ActorRole::Agent),
        "reviewer" => Ok(ActorRole::Reviewer),
        "operator" => Ok(ActorRole::Operator),
        "publisher" => Ok(ActorRole::Publisher),
        _ => Err(StoreError::Corrupt(format!("unknown actor role {value:?}"))),
    }
}

fn same_external_wait_scope(left: &ExternalWait, right: &ExternalWait) -> bool {
    left.id == right.id
        && left.project_id == right.project_id
        && left.source_work_id == right.source_work_id
        && left.affected_work_ids == right.affected_work_ids
        && left.category == right.category
        && left.reason == right.reason
        && left.accountable == right.accountable
        && left.expected_decision == right.expected_decision
        && left.expected_output == right.expected_output
        && left.follow_up == right.follow_up
        && left.civil_time_setting_revision == right.civil_time_setting_revision
        && left.created_by == right.created_by
        && left.created_at == right.created_at
}

fn work_kind_name(kind: boreal_domain::WorkKind) -> &'static str {
    match kind {
        boreal_domain::WorkKind::Milestone => "milestone",
        boreal_domain::WorkKind::Sprint => "sprint",
        boreal_domain::WorkKind::Task => "task",
    }
}

fn work_item_from_record(
    record: &super::WorkRecord,
    parent_id: Option<String>,
) -> Result<boreal_domain::WorkItem, StoreError> {
    let kind = match record.kind.as_str() {
        "milestone" => boreal_domain::WorkKind::Milestone,
        "sprint" => boreal_domain::WorkKind::Sprint,
        "task" => boreal_domain::WorkKind::Task,
        _ => {
            return Err(StoreError::Corrupt(format!(
                "work {} has an unknown kind",
                record.work_id
            )))
        }
    };
    Ok(boreal_domain::WorkItem::new(
        boreal_domain::ProjectId::new(record.project_id.clone()),
        boreal_domain::WorkId::new(record.work_id.clone()),
        kind,
        parent_id.map(boreal_domain::WorkId::new),
        record.title.clone(),
    ))
}

fn ensure_v3_replay_identity(
    existing: &OperationRecord,
    context: &V3MutationContext,
    session_id: Option<&str>,
    subject_type: &str,
    subject_id: &str,
) -> Result<(), StoreError> {
    if existing.actor_id != context.actor_id {
        return Err(StoreError::WrongOwner {
            expected: existing.actor_id.clone(),
            actual: context.actor_id.clone(),
        });
    }
    if existing.session_id.as_deref() != session_id {
        return Err(StoreError::Conflict(
            "operation ID was reused with a different authenticated session".to_owned(),
        ));
    }
    if existing.expected_revision != context.expected_revision {
        return Err(StoreError::Conflict(
            "operation ID was reused with a different expected revision".to_owned(),
        ));
    }

    let existing_subject = serde_json::from_str::<serde_json::Value>(&existing.result_json)
        .map_err(|error| {
            StoreError::Corrupt(format!("v3 operation result is invalid JSON: {error}"))
        })?
        .as_object()
        .and_then(|payload| {
            Some((
                payload.get("subject_type")?.as_str()?.to_owned(),
                payload.get("subject_id")?.as_str()?.to_owned(),
            ))
        })
        .ok_or_else(|| {
            StoreError::Corrupt(
                "v3 operation result is missing its semantic subject identity".to_owned(),
            )
        })?;
    if existing_subject.0 != subject_type || existing_subject.1 != subject_id {
        return Err(StoreError::WrongSubject {
            expected: format!("{subject_type}/{subject_id}"),
            actual: format!("{}/{}", existing_subject.0, existing_subject.1),
        });
    }
    Ok(())
}

fn ensure_project(expected: &str, actual: &str) -> Result<(), StoreError> {
    if expected == actual {
        Ok(())
    } else {
        Err(StoreError::WrongSubject {
            expected: expected.to_owned(),
            actual: actual.to_owned(),
        })
    }
}

fn bind_optional_signed_i64(
    statement: &mut super::Statement<'_>,
    index: i32,
    value: Option<i64>,
) -> Result<(), StoreError> {
    match value {
        Some(value) => statement.bind_signed_i64(index, value),
        None => statement.bind_null(index),
    }
}

#[cfg(test)]
mod scheduling_codec_tests {
    use super::*;

    fn store_with_schedule_table() -> SqliteStore {
        let store = SqliteStore::open_in_memory(crate::PRODUCTION_SCHEMA_SQL).unwrap();
        store
            .execute_batch(
                "CREATE TABLE work_schedule_v3 (
                   project_id TEXT NOT NULL,
                   work_id TEXT NOT NULL,
                   schedule_revision INTEGER NOT NULL,
                   payload_json TEXT NOT NULL,
                   civil_time_setting_revision INTEGER,
                   updated_at_ms INTEGER NOT NULL,
                   created_project_revision INTEGER NOT NULL,
                   operation_id TEXT NOT NULL,
                   request_digest TEXT NOT NULL,
                   PRIMARY KEY (project_id, work_id, schedule_revision)
                 );",
            )
            .unwrap();
        store
    }

    fn local_date(year: i32, month: u8, day: u8) -> BusinessDate {
        BusinessDate::LocalDate(LocalDate::new(year, month, day))
    }

    fn external_wait() -> ExternalWait {
        ExternalWait {
            id: boreal_domain::work_model_v3::ExternalWaitId::new("wait-1"),
            project_id: ProjectId::new("project-1"),
            source_work_id: WorkId::new("source-1"),
            affected_work_ids: vec![WorkId::new("dependent-1")],
            category: ExternalWaitCategory::Decision,
            reason: "Provider decision required".to_owned(),
            accountable: ExternalWaitAccountable::Service {
                reference: "provider:acme".to_owned(),
                display_name: "Acme provider".to_owned(),
            },
            expected_decision: Some("Approve access".to_owned()),
            expected_output: None,
            follow_up: Some(local_date(2026, 11, 1)),
            civil_time_setting_revision: Some(3),
            revision: 1,
            state: ExternalWaitState::Open,
            created_by: "operator-1".to_owned(),
            created_at: TimestampMs::from_millis(1_800_000_000_000),
            resolution: None,
        }
    }

    #[test]
    fn schedule_codec_round_trips_civil_dates_and_instants() {
        let record = WorkScheduleRecord {
            project_id: ProjectId::new("project-1"),
            work_id: WorkId::new("work-1"),
            revision: 2,
            schedule: BusinessSchedule {
                not_before: Some(local_date(2026, 3, 8)),
                due: Some(BusinessDate::Instant(TimestampMs::from_millis(
                    1_800_000_000_000,
                ))),
                planned_start: Some(local_date(2026, 3, 8)),
                planned_end: Some(local_date(2026, 3, 9)),
            },
            civil_time_setting_revision: Some(4),
            updated_at: TimestampMs::from_millis(1_800_000_000_100),
        };

        let encoded = encode_schedule_payload(&record).unwrap();
        let decoded = decode_work_schedule_record(
            "project-1".to_owned(),
            "work-1".to_owned(),
            2,
            &encoded,
            Some(4),
            1_800_000_000_100,
        )
        .unwrap();

        assert_eq!(decoded, record);
    }

    #[test]
    fn external_wait_codec_round_trips_attributed_resolution() {
        let mut wait = external_wait();
        wait.revision = 2;
        wait.state = ExternalWaitState::Resolved;
        wait.resolution = Some(ExternalWaitResolution {
            outcome: ExternalWaitOutcome::DecisionProvided,
            detail: "Access approved by the provider".to_owned(),
            output_ref: Some("decision:provider-42".to_owned()),
            supplied_by: ExternalWaitAccountable::Person {
                reference: "provider-user:7".to_owned(),
                display_name: "Provider reviewer".to_owned(),
            },
            recorded_by: "operator-2".to_owned(),
            recorded_as: ActorRole::Operator,
            recorded_at: TimestampMs::from_millis(1_800_000_000_200),
        });

        let encoded = encode_external_wait(&wait).unwrap();
        let decoded = decode_external_wait("project-1", "wait-1", 2, &encoded).unwrap();

        assert_eq!(decoded, wait);
    }

    #[test]
    fn external_wait_codec_rejects_unknown_state_and_outcome() {
        let wait = external_wait();
        let encoded = encode_external_wait(&wait).unwrap();
        let mut unknown_state: serde_json::Value = serde_json::from_str(&encoded).unwrap();
        unknown_state["state"] = json!("waiting_for_something_new");
        let unknown_state = serde_json::to_string(&unknown_state).unwrap();
        assert!(matches!(
            decode_external_wait("project-1", "wait-1", 1, &unknown_state),
            Err(StoreError::Corrupt(_))
        ));

        let mut resolved = wait;
        resolved.revision = 2;
        resolved.state = ExternalWaitState::Resolved;
        resolved.resolution = Some(ExternalWaitResolution {
            outcome: ExternalWaitOutcome::Approved,
            detail: "Decision recorded".to_owned(),
            output_ref: None,
            supplied_by: ExternalWaitAccountable::Role(ActorRole::Reviewer),
            recorded_by: "operator-1".to_owned(),
            recorded_as: ActorRole::Operator,
            recorded_at: TimestampMs::from_millis(1_800_000_000_300),
        });
        let encoded = encode_external_wait(&resolved).unwrap();
        let mut unknown_outcome: serde_json::Value = serde_json::from_str(&encoded).unwrap();
        unknown_outcome["resolution"]["outcome"] = json!("accepted_by_magic");
        let unknown_outcome = serde_json::to_string(&unknown_outcome).unwrap();
        assert!(matches!(
            decode_external_wait("project-1", "wait-1", 2, &unknown_outcome),
            Err(StoreError::Corrupt(_))
        ));
    }

    #[test]
    fn legacy_due_at_reader_preserves_raw_date_text_and_project_scope() {
        let store = store_with_schedule_table();
        store.create_project("project-1", "unix-ms:1").unwrap();
        let work = boreal_domain::WorkItem::new(
            ProjectId::new("project-1"),
            WorkId::new("task-1"),
            boreal_domain::WorkKind::Task,
            None,
            "Legacy due date",
        )
        .open();
        store.create_work(&work, "unix-ms:2").unwrap();
        let no_due = boreal_domain::WorkItem::new(
            ProjectId::new("project-1"),
            WorkId::new("task-2"),
            boreal_domain::WorkKind::Task,
            None,
            "No legacy due date",
        )
        .open();
        store.create_work(&no_due, "unix-ms:2").unwrap();
        store
            .execute_batch(
                "UPDATE work_item SET due_at = '2026-11-01'
                 WHERE project_id = 'project-1' AND work_id = 'task-1';",
            )
            .unwrap();

        assert_eq!(
            store
                .legacy_due_at_v3_if_no_schedule("project-1", "task-1")
                .unwrap()
                .as_deref(),
            Some("2026-11-01")
        );
        assert_eq!(
            store
                .legacy_due_at_v3_if_no_schedule("another-project", "task-1")
                .unwrap(),
            None
        );
        assert_eq!(
            store
                .legacy_due_at_v3_if_no_schedule("project-1", "task-2")
                .unwrap(),
            None
        );
    }

    #[test]
    fn explicit_schedule_revision_shadows_legacy_due_at_even_when_cleared() {
        let store = store_with_schedule_table();
        store.create_project("project-1", "unix-ms:1").unwrap();
        let work = boreal_domain::WorkItem::new(
            ProjectId::new("project-1"),
            WorkId::new("task-1"),
            boreal_domain::WorkKind::Task,
            None,
            "Explicitly cleared legacy due date",
        )
        .open();
        store.create_work(&work, "unix-ms:2").unwrap();
        store
            .execute_batch(
                "UPDATE work_item SET due_at = '2026-11-01'
                 WHERE project_id = 'project-1' AND work_id = 'task-1';
                 INSERT INTO work_schedule_v3
                   (project_id, work_id, schedule_revision, payload_json,
                    civil_time_setting_revision, updated_at_ms,
                    created_project_revision, operation_id, request_digest)
                 VALUES ('project-1', 'task-1', 1,
                         '{\"version\":1,\"due\":null}', NULL, 3, 0,
                         'schedule-clear', 'digest');",
            )
            .unwrap();

        assert_eq!(
            store
                .legacy_due_at_v3_if_no_schedule("project-1", "task-1")
                .unwrap(),
            None
        );
    }
}
