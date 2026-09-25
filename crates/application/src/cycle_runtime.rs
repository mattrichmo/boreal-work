//! Calendar resolution and cycle mutation facade. Adapters supply typed input;
//! they never authorize a transition or manufacture accepted work.
use crate::{canonical_request_digest, ApplicationError, PlanningScope, WorkApplication};
use boreal_domain::work_model_v3::{CycleId, FoldPolicy, GapPolicy, LocalDateTime};
use boreal_store::cycle_commands::{CycleChangeRequest, OneOffCycleInput};
use boreal_store::{CycleV3Input, MutationResult, V3MutationContext};
use serde_json::json;

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

    /// Reconcile a live cycle commitment as deferred without changing the
    /// task's lifecycle or implying that its acceptance requirements passed.
    pub fn defer_planning_cycle_assignment(
        &self,
        scope: &PlanningScope,
        operation: &str,
        cycle_id: &str,
        assignment_id: &str,
        reason: &str,
        confirmed: bool,
        now: &str,
    ) -> Result<MutationResult, ApplicationError> {
        scope.validate()?;
        let request = CycleChangeRequest {
            cycle_id: cycle_id.into(),
            change: "defer".into(),
            assignment_id: Some(assignment_id.into()),
            work_id: None,
            successor_cycle_id: None,
            successor_assignment_id: None,
            reason: reason.into(),
            confirmed,
        };
        Ok(self
            .store_ref()
            .change_cycle(&cycle_context(scope, operation, now), &request)?)
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
