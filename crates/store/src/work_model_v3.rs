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
        let roles = if command.starts_with("cycle.")
            || command.starts_with("container.disposition")
        {
            &planning_roles[..]
        } else {
            &ordinary_roles[..]
        };
        self.fact_mutation(
            context,
            command,
            subject_type,
            subject_id,
            roles,
            write,
        )
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
