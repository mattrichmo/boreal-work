//! Application policy for non-work intake and typed promotion.
//!
//! Intake is intentionally not represented as `WorkItem`.  These commands
//! preserve immutable content revisions and return plans for the store/source
//! adapters.  A promotion is valid only against the exact current revision and
//! digest; an adapter must make the plan and target creation one durable
//! operation or return a replayable unknown outcome.

use std::collections::BTreeSet;

use boreal_domain::work_model_v3::{
    validate_container_dispositions, validate_direct_dependencies, validate_promotion,
    BusinessDate, BusinessDateBoundary, BusinessSchedule, BusinessTimeContext,
    ContainerDisposition, DirectDependency, ExternalWait, ExternalWaitId, ExternalWaitOutcome,
    ExternalWaitResolution, ExternalWaitState, FoldPolicy, GapPolicy, IntakeBucket, IntakeBucketId,
    IntakeItem, IntakeItemId, IntakeKind, IntakeLifecycle, IntakePromotion, LocalDate, LocalTime,
    ModelError, ProjectCivilTimeSetting, PromotionId, PromotionTargetKind, WorkNode,
    WorkScheduleRecord,
};
use boreal_domain::{ActorRole, ProjectId, TimestampMs, WorkId};
use serde_json::json;

use crate::planning_v3::{PlannedOperation, PlanningError, PlanningScope, SystemTimeZoneDatabase};
use crate::{canonical_request_digest, ApplicationError, WorkApplication};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntakeSnapshot {
    pub project_id: ProjectId,
    pub revision: u64,
    pub buckets: Vec<IntakeBucket>,
    pub items: Vec<IntakeItem>,
    pub promotions: Vec<IntakePromotion>,
    pub dispositions: Vec<ContainerDisposition>,
}

impl IntakeSnapshot {
    fn scope(&self, scope: &PlanningScope) -> Result<(), PlanningError> {
        scope.validate()?;
        if scope.project_id != self.project_id {
            return Err(PlanningError::ScopeConflict {
                expected: self.project_id.to_string(),
                actual: scope.project_id.to_string(),
            });
        }
        scope.require_revision(self.revision)
    }

    fn bucket(&self, id: &IntakeBucketId) -> Result<&IntakeBucket, PlanningError> {
        self.buckets
            .iter()
            .find(|bucket| &bucket.id == id)
            .ok_or_else(|| PlanningError::Invalid(format!("intake bucket not found: {id}")))
    }

    fn item(&self, id: &IntakeItemId) -> Result<&IntakeItem, PlanningError> {
        self.items
            .iter()
            .find(|item| &item.id == id)
            .ok_or_else(|| PlanningError::Invalid(format!("intake item not found: {id}")))
    }
}

/// One revisioned read of schedules and external waits with the dependency
/// graph they affect. The store adapter supplies this from the canonical
/// transaction snapshot; it is not a second source of lifecycle truth.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SchedulingSnapshot {
    pub project_id: ProjectId,
    pub revision: u64,
    pub project_civil_time: Option<ProjectCivilTimeSetting>,
    pub nodes: Vec<WorkNode>,
    pub dependencies: Vec<DirectDependency>,
    pub schedules: Vec<WorkScheduleRecord>,
    pub external_waits: Vec<ExternalWait>,
}

impl SchedulingSnapshot {
    fn scope(&self, scope: &PlanningScope) -> Result<(), PlanningError> {
        scope.validate()?;
        if scope.project_id != self.project_id {
            return Err(PlanningError::ScopeConflict {
                expected: self.project_id.to_string(),
                actual: scope.project_id.to_string(),
            });
        }
        scope.require_revision(self.revision)?;
        if let Some(setting) = &self.project_civil_time {
            setting.validate()?;
            if setting.project_id != self.project_id {
                return Err(PlanningError::ScopeConflict {
                    expected: self.project_id.to_string(),
                    actual: setting.project_id.to_string(),
                });
            }
        }
        validate_direct_dependencies(&self.nodes, &self.dependencies)?;
        let mut scheduled_work = BTreeSet::new();
        for schedule in &self.schedules {
            if schedule.project_id != self.project_id
                || !self.nodes.iter().any(|node| node.id == schedule.work_id)
                || schedule.revision == 0
                || !scheduled_work.insert(schedule.work_id.clone())
            {
                return Err(PlanningError::Invalid(
                    "schedule snapshot contains an invalid or duplicate work record".to_owned(),
                ));
            }
            schedule.validate()?;
        }
        let mut wait_ids = BTreeSet::new();
        for wait in &self.external_waits {
            if wait.project_id != self.project_id || !wait_ids.insert(wait.id.clone()) {
                return Err(PlanningError::Invalid(
                    "external-wait snapshot contains a wrong-project or duplicate record"
                        .to_owned(),
                ));
            }
            wait.validate(&self.nodes, &self.dependencies)?;
        }
        Ok(())
    }

    fn schedule(&self, work_id: &WorkId) -> Result<Option<&WorkScheduleRecord>, PlanningError> {
        if !self.nodes.iter().any(|node| &node.id == work_id) {
            return Err(PlanningError::Invalid(format!(
                "work node not found: {work_id}"
            )));
        }
        Ok(self
            .schedules
            .iter()
            .find(|record| &record.work_id == work_id))
    }

    fn external_wait(&self, wait_id: &ExternalWaitId) -> Result<&ExternalWait, PlanningError> {
        self.external_waits
            .iter()
            .find(|wait| &wait.id == wait_id)
            .ok_or_else(|| PlanningError::Invalid(format!("external wait not found: {wait_id}")))
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkScheduleUpdateRequest {
    pub scope: PlanningScope,
    pub operation_id: String,
    pub work_id: WorkId,
    pub expected_schedule_revision: u64,
    /// Replacing all four optional fields makes clear/set semantics explicit.
    /// An empty schedule is a durable clear with a new revision.
    pub schedule: BusinessSchedule,
    pub updated_at: TimestampMs,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProjectCivilTimeUpdateRequest {
    pub scope: PlanningScope,
    pub operation_id: String,
    pub expected_setting_revision: u64,
    pub timezone: String,
    pub tzdb_identity: String,
    pub updated_at: TimestampMs,
}

/// Plan an attributable project timezone revision after checking the exact
/// installed TZif identity selected by the time adapter.
pub fn plan_project_civil_time_update(
    snapshot: &SchedulingSnapshot,
    request: &ProjectCivilTimeUpdateRequest,
    timezone_database: &SystemTimeZoneDatabase,
) -> Result<PlannedOperation<ProjectCivilTimeSetting>, PlanningError> {
    snapshot.scope(&request.scope)?;
    let actual_revision = snapshot
        .project_civil_time
        .as_ref()
        .map_or(0, |setting| setting.revision);
    if actual_revision != request.expected_setting_revision {
        return Err(PlanningError::RevisionConflict {
            expected: request.expected_setting_revision,
            actual: actual_revision,
        });
    }
    let revision = actual_revision
        .checked_add(1)
        .ok_or_else(|| PlanningError::Invalid("civil-time setting revision overflow".into()))?;
    let setting = ProjectCivilTimeSetting {
        project_id: snapshot.project_id.clone(),
        revision,
        timezone: request.timezone.clone(),
        tzdb_identity: request.tzdb_identity.clone(),
        changed_by: request.scope.actor_id.clone(),
        changed_at: request.updated_at,
    };
    setting.validate()?;
    let zone_identity = timezone_database.resolve(
        &setting.timezone,
        boreal_domain::work_model_v3::LocalDateTime::new(
            LocalDate::new(1970, 1, 1),
            LocalTime::new(0, 0, 0),
        ),
        GapPolicy::NextValid,
        FoldPolicy::EarlierOffset,
    )?;
    if zone_identity.tzdb_identity != setting.tzdb_identity {
        return Err(PlanningError::TimeZoneParse(
            "project civil-time setting tzdb identity does not match the selected zone".into(),
        ));
    }
    let digest = canonical_request_digest(
        "project.civil-time.update/v1",
        json!({
            "project_id": request.scope.project_id.as_str(),
            "actor_id": request.scope.actor_id,
            "session_id": request.scope.session_id,
            "expected_setting_revision": request.expected_setting_revision,
            "setting_revision": setting.revision,
            "timezone": setting.timezone,
            "tzdb_identity": setting.tzdb_identity,
            "expected_project_revision": snapshot.revision,
        }),
    );
    Ok(PlannedOperation {
        operation_id: request.operation_id.clone(),
        request_digest: digest,
        project_id: request.scope.project_id.clone(),
        actor_id: request.scope.actor_id.clone(),
        session_id: request.scope.session_id.clone(),
        expected_revision: snapshot.revision,
        value: setting,
    })
}

pub fn plan_work_schedule_update(
    snapshot: &SchedulingSnapshot,
    request: &WorkScheduleUpdateRequest,
) -> Result<PlannedOperation<WorkScheduleRecord>, PlanningError> {
    snapshot.scope(&request.scope)?;
    let existing = snapshot.schedule(&request.work_id)?;
    let actual_revision = existing.map_or(0, |record| record.revision);
    if actual_revision != request.expected_schedule_revision {
        return Err(PlanningError::RevisionConflict {
            expected: request.expected_schedule_revision,
            actual: actual_revision,
        });
    }
    request.schedule.validate()?;
    let civil_time_setting_revision = if schedule_uses_local_date(&request.schedule) {
        Some(
            snapshot
                .project_civil_time
                .as_ref()
                .ok_or_else(|| {
                    PlanningError::Invalid(
                        "date-only schedule requires a configured project civil-time setting"
                            .to_owned(),
                    )
                })?
                .revision,
        )
    } else {
        None
    };
    let next_revision = actual_revision
        .checked_add(1)
        .ok_or_else(|| PlanningError::Invalid("schedule revision overflow".to_owned()))?;
    let value = WorkScheduleRecord {
        project_id: snapshot.project_id.clone(),
        work_id: request.work_id.clone(),
        revision: next_revision,
        schedule: request.schedule.clone(),
        civil_time_setting_revision,
        updated_at: request.updated_at,
    };
    value.validate()?;
    let digest = canonical_request_digest(
        "work.schedule.update/v3",
        json!({
            "project_id": request.scope.project_id.as_str(),
            "actor_id": request.scope.actor_id,
            "session_id": request.scope.session_id,
            "work_id": request.work_id.as_str(),
            "expected_schedule_revision": request.expected_schedule_revision,
            "next_schedule_revision": next_revision,
            "civil_time_setting_revision": value.civil_time_setting_revision,
            "schedule": business_schedule_payload(&value.schedule),
            "expected_project_revision": snapshot.revision,
        }),
    );
    Ok(PlannedOperation {
        operation_id: request.operation_id.clone(),
        request_digest: digest,
        project_id: request.scope.project_id.clone(),
        actor_id: request.scope.actor_id.clone(),
        session_id: request.scope.session_id.clone(),
        expected_revision: snapshot.revision,
        value,
    })
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExternalWaitCreateRequest {
    pub scope: PlanningScope,
    pub operation_id: String,
    pub wait: ExternalWait,
}

pub fn plan_external_wait_create(
    snapshot: &SchedulingSnapshot,
    request: &ExternalWaitCreateRequest,
) -> Result<PlannedOperation<ExternalWait>, PlanningError> {
    snapshot.scope(&request.scope)?;
    if request.wait.revision != 1
        || request.wait.state != ExternalWaitState::Open
        || request.wait.resolution.is_some()
        || request.wait.created_by != request.scope.actor_id
    {
        return Err(PlanningError::Invalid(
            "new external waits must be open, revision 1, unresolved, and attributed to the current actor".to_owned(),
        ));
    }
    if request.wait.project_id != snapshot.project_id {
        return Err(PlanningError::ScopeConflict {
            expected: snapshot.project_id.to_string(),
            actual: request.wait.project_id.to_string(),
        });
    }
    let mut value = request.wait.clone();
    let has_date_follow_up = value
        .follow_up
        .as_ref()
        .is_some_and(|follow_up| matches!(follow_up, BusinessDate::LocalDate(_)));
    if has_date_follow_up {
        let setting_revision = snapshot
            .project_civil_time
            .as_ref()
            .ok_or_else(|| {
                PlanningError::Invalid(
                    "date-only follow-up requires a configured project civil-time setting"
                        .to_owned(),
                )
            })?
            .revision;
        if value
            .civil_time_setting_revision
            .is_some_and(|revision| revision != setting_revision)
        {
            return Err(PlanningError::RevisionConflict {
                expected: value.civil_time_setting_revision.unwrap_or_default(),
                actual: setting_revision,
            });
        }
        value.civil_time_setting_revision = Some(setting_revision);
    } else {
        value.civil_time_setting_revision = None;
    }
    if snapshot
        .external_waits
        .iter()
        .any(|wait| wait.id == value.id)
    {
        return Err(PlanningError::Invalid(
            "external wait ID already exists".to_owned(),
        ));
    }
    value.validate(&snapshot.nodes, &snapshot.dependencies)?;
    let digest = canonical_request_digest(
        "external-wait.create/v1",
        external_wait_payload(&value, &request.scope),
    );
    Ok(PlannedOperation {
        operation_id: request.operation_id.clone(),
        request_digest: digest,
        project_id: request.scope.project_id.clone(),
        actor_id: request.scope.actor_id.clone(),
        session_id: request.scope.session_id.clone(),
        expected_revision: snapshot.revision,
        value,
    })
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExternalWaitResolutionRequest {
    pub scope: PlanningScope,
    pub operation_id: String,
    pub wait_id: ExternalWaitId,
    pub expected_wait_revision: u64,
    pub next_state: ExternalWaitState,
    pub resolution: ExternalWaitResolution,
}

pub fn plan_external_wait_resolution(
    snapshot: &SchedulingSnapshot,
    request: &ExternalWaitResolutionRequest,
) -> Result<PlannedOperation<ExternalWait>, PlanningError> {
    snapshot.scope(&request.scope)?;
    let current = snapshot.external_wait(&request.wait_id)?;
    if current.revision != request.expected_wait_revision {
        return Err(PlanningError::RevisionConflict {
            expected: request.expected_wait_revision,
            actual: current.revision,
        });
    }
    if current.state != ExternalWaitState::Open {
        return Err(PlanningError::Invalid(
            "only an open external wait can be resolved or cancelled".to_owned(),
        ));
    }
    if request.resolution.recorded_by != request.scope.actor_id {
        return Err(PlanningError::Invalid(
            "resolution must be attributed to the current project actor".to_owned(),
        ));
    }
    if request.resolution.recorded_as != ActorRole::Operator {
        return Err(PlanningError::Invalid(
            "external waits may be resolved or cancelled only by an Operator".to_owned(),
        ));
    }
    if !matches!(
        request.next_state,
        ExternalWaitState::Resolved | ExternalWaitState::Cancelled
    ) {
        return Err(PlanningError::Invalid(
            "wait transition must resolve or explicitly cancel the obligation".to_owned(),
        ));
    }
    if (request.next_state == ExternalWaitState::Cancelled)
        != (request.resolution.outcome == ExternalWaitOutcome::Cancelled)
    {
        return Err(PlanningError::Invalid(
            "wait state and resolution outcome disagree".to_owned(),
        ));
    }
    request.resolution.validate()?;
    let next = current.close(request.next_state, request.resolution.clone())?;
    next.validate(&snapshot.nodes, &snapshot.dependencies)?;
    let digest = canonical_request_digest(
        "external-wait.resolve/v1",
        json!({
            "project_id": request.scope.project_id.as_str(),
            "actor_id": request.scope.actor_id,
            "session_id": request.scope.session_id,
            "wait_id": request.wait_id.as_str(),
            "expected_wait_revision": request.expected_wait_revision,
            "next_state": format!("{:?}", next.state).to_ascii_lowercase(),
            "outcome": format!("{:?}", request.resolution.outcome).to_ascii_lowercase(),
            "detail": request.resolution.detail,
            "output_ref": request.resolution.output_ref,
            "supplied_by": accountable_payload(&request.resolution.supplied_by),
            "recorded_by": request.resolution.recorded_by,
            "recorded_as": format!("{:?}", request.resolution.recorded_as).to_ascii_lowercase(),
            "recorded_at_ms": request.resolution.recorded_at.as_millis(),
            "expected_project_revision": snapshot.revision,
        }),
    );
    Ok(PlannedOperation {
        operation_id: request.operation_id.clone(),
        request_digest: digest,
        project_id: request.scope.project_id.clone(),
        actor_id: request.scope.actor_id.clone(),
        session_id: request.scope.session_id.clone(),
        expected_revision: snapshot.revision,
        value: next,
    })
}

fn external_wait_payload(wait: &ExternalWait, scope: &PlanningScope) -> serde_json::Value {
    json!({
        "project_id": scope.project_id.as_str(),
        "actor_id": scope.actor_id,
        "session_id": scope.session_id,
        "wait_id": wait.id.as_str(),
        "source_work_id": wait.source_work_id.as_str(),
        "affected_work_ids": wait.affected_work_ids.iter().map(WorkId::as_str).collect::<Vec<_>>(),
        "category": format!("{:?}", wait.category).to_ascii_lowercase(),
        "reason": wait.reason,
        "accountable": accountable_payload(&wait.accountable),
        "expected_decision": wait.expected_decision,
        "expected_output": wait.expected_output,
        "follow_up": business_date_payload(wait.follow_up.as_ref()),
        "civil_time_setting_revision": wait.civil_time_setting_revision,
        "created_by": wait.created_by,
        "created_at_ms": wait.created_at.as_millis(),
    })
}

fn business_schedule_payload(schedule: &BusinessSchedule) -> serde_json::Value {
    json!({
        "not_before": business_date_payload(schedule.not_before.as_ref()),
        "due": business_date_payload(schedule.due.as_ref()),
        "planned_start": business_date_payload(schedule.planned_start.as_ref()),
        "planned_end": business_date_payload(schedule.planned_end.as_ref()),
    })
}

fn schedule_uses_local_date(schedule: &BusinessSchedule) -> bool {
    [
        schedule.not_before.as_ref(),
        schedule.due.as_ref(),
        schedule.planned_start.as_ref(),
        schedule.planned_end.as_ref(),
    ]
    .into_iter()
    .flatten()
    .any(|value| matches!(value, BusinessDate::LocalDate(_)))
}

fn business_date_payload(value: Option<&BusinessDate>) -> serde_json::Value {
    match value {
        None => serde_json::Value::Null,
        Some(BusinessDate::Instant(at)) => json!({
            "kind": "instant",
            "at_ms": at.as_millis(),
        }),
        Some(BusinessDate::LocalDate(date)) => json!({
            "kind": "local_date",
            "year": date.year,
            "month": date.month,
            "day": date.day,
        }),
        Some(BusinessDate::ResolvedLocal(resolution)) => json!({
            "kind": "resolved_local",
            "nominal_local": {
                "year": resolution.nominal_local.date.year,
                "month": resolution.nominal_local.date.month,
                "day": resolution.nominal_local.date.day,
                "hour": resolution.nominal_local.time.hour,
                "minute": resolution.nominal_local.time.minute,
                "second": resolution.nominal_local.time.second,
            },
            "utc_instant_ms": resolution.utc_instant.as_millis(),
            "utc_offset_minutes": resolution.utc_offset_minutes,
            "timezone": resolution.timezone,
            "tzdb_identity": resolution.tzdb_identity,
            "gap_policy": format!("{:?}", resolution.gap_policy).to_ascii_lowercase(),
            "fold_policy": format!("{:?}", resolution.fold_policy).to_ascii_lowercase(),
        }),
    }
}

/// Resolve a typed boundary for a timer using the project's selected IANA
/// zone. The context identity is checked against the exact TZif file used for
/// resolution, and local midnight follows S05's next-valid / earlier-offset
/// civil-time policy.
pub fn resolve_business_date_boundary(
    boundary: BusinessDateBoundary,
    context: &BusinessTimeContext,
    timezone_database: &SystemTimeZoneDatabase,
) -> Result<TimestampMs, PlanningError> {
    context.validate()?;
    match boundary {
        BusinessDateBoundary::Instant(at) => Ok(at),
        BusinessDateBoundary::LocalDateStart(date) => {
            let resolution = timezone_database.resolve(
                &context.timezone,
                boreal_domain::work_model_v3::LocalDateTime::new(date, LocalTime::new(0, 0, 0)),
                GapPolicy::NextValid,
                FoldPolicy::EarlierOffset,
            )?;
            if resolution.tzdb_identity != context.tzdb_identity {
                return Err(PlanningError::TimeZoneParse(
                    "project civil-time context uses a different tzdb identity".to_owned(),
                ));
            }
            Ok(resolution.utc_instant)
        }
    }
}

/// Confirm that the supplied project civil date actually contains `as_of` in
/// the selected zone and that both local midnight resolutions use the
/// context's tzdb identity. Status adapters should call this before domain
/// evaluation so an unknown project timezone cannot yield a safe default.
pub fn validate_project_civil_time_context(
    setting: &ProjectCivilTimeSetting,
    context: &BusinessTimeContext,
    timezone_database: &SystemTimeZoneDatabase,
) -> Result<(), PlanningError> {
    setting.validate()?;
    context.validate()?;
    if setting.project_id != context.project_id
        || setting.revision != context.setting_revision
        || setting.timezone != context.timezone
        || setting.tzdb_identity != context.tzdb_identity
    {
        return Err(PlanningError::Invalid(
            "business-time context does not match the current project civil-time setting"
                .to_owned(),
        ));
    }
    let start = resolve_business_date_boundary(
        BusinessDateBoundary::LocalDateStart(context.civil_date),
        context,
        timezone_database,
    )?;
    let following_date = context.civil_date.add_days(1)?;
    let end = resolve_business_date_boundary(
        BusinessDateBoundary::LocalDateStart(following_date),
        context,
        timezone_database,
    )?;
    if context.as_of < start || context.as_of >= end || end <= start {
        return Err(PlanningError::Invalid(
            "project civil date does not contain the observed instant".to_owned(),
        ));
    }
    Ok(())
}

/// Resolve all applicable business schedule changes and return the earliest
/// future absolute timer boundary. Date-only boundaries are resolved using
/// project time, including daylight-saving gaps and folds.
pub fn next_business_schedule_change(
    record: &WorkScheduleRecord,
    setting: &ProjectCivilTimeSetting,
    context: &BusinessTimeContext,
    terminal: bool,
    timezone_database: &SystemTimeZoneDatabase,
) -> Result<Option<TimestampMs>, PlanningError> {
    validate_project_civil_time_context(setting, context, timezone_database)?;
    if record.project_id != setting.project_id {
        return Err(PlanningError::Invalid(
            "schedule and project civil-time setting belong to different projects".into(),
        ));
    }
    let view = record.evaluate(context, terminal)?;
    view.next_changes
        .into_iter()
        .map(|boundary| resolve_business_date_boundary(boundary, context, timezone_database))
        .filter_map(|result| match result {
            Ok(at) if at > context.as_of => Some(Ok(at)),
            Ok(_) => None,
            Err(error) => Some(Err(error)),
        })
        .collect::<Result<Vec<_>, _>>()
        .map(|values| values.into_iter().min())
}

fn accountable_payload(
    accountable: &boreal_domain::work_model_v3::ExternalWaitAccountable,
) -> serde_json::Value {
    use boreal_domain::work_model_v3::ExternalWaitAccountable as Party;
    match accountable {
        Party::Person {
            reference,
            display_name,
        } => json!({
            "kind": "person", "reference": reference, "display_name": display_name
        }),
        Party::Role(role) => json!({
            "kind": "role", "role": format!("{:?}", role).to_ascii_lowercase()
        }),
        Party::Service {
            reference,
            display_name,
        } => json!({
            "kind": "service", "reference": reference, "display_name": display_name
        }),
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntakeCaptureRequest {
    pub scope: PlanningScope,
    pub operation_id: String,
    pub bucket_id: IntakeBucketId,
    pub intake_id: IntakeItemId,
    pub kind: IntakeKind,
    pub content: String,
    pub captured_at: TimestampMs,
    pub revisit_at: Option<TimestampMs>,
}

pub fn plan_intake_capture(
    snapshot: &IntakeSnapshot,
    request: &IntakeCaptureRequest,
) -> Result<PlannedOperation<IntakeItem>, PlanningError> {
    snapshot.scope(&request.scope)?;
    let bucket = snapshot.bucket(&request.bucket_id)?;
    if bucket.archived {
        return Err(PlanningError::Invalid(
            "cannot capture into an archived bucket".to_owned(),
        ));
    }
    if request.content.trim().is_empty() {
        return Err(PlanningError::Invalid(
            "intake content cannot be empty".to_owned(),
        ));
    }
    if snapshot
        .items
        .iter()
        .any(|item| item.id == request.intake_id)
    {
        return Err(PlanningError::Invalid(
            "intake ID already exists".to_owned(),
        ));
    }
    let item = IntakeItem {
        id: request.intake_id.clone(),
        bucket_id: request.bucket_id.clone(),
        project_id: request.scope.project_id.clone(),
        kind: request.kind,
        lifecycle: IntakeLifecycle::Captured,
        content: request.content.clone(),
        content_revision: 1,
        content_digest: crate::sha256_content_digest(request.content.as_bytes()),
        revisit_at: request.revisit_at,
    };
    let digest = canonical_request_digest(
        "intake.capture/v3",
        json!({
            "project_id": request.scope.project_id.as_str(),
            "actor_id": request.scope.actor_id,
            "session_id": request.scope.session_id,
            "bucket_id": request.bucket_id.as_str(),
            "intake_id": request.intake_id.as_str(),
            "kind": format!("{:?}", request.kind).to_ascii_lowercase(),
            "content_digest": item.content_digest,
            "captured_at": request.captured_at.as_millis(),
            "revisit_at": request.revisit_at.map(TimestampMs::as_millis),
            "expected_revision": snapshot.revision,
        }),
    );
    Ok(PlannedOperation {
        operation_id: request.operation_id.clone(),
        request_digest: digest,
        project_id: request.scope.project_id.clone(),
        actor_id: request.scope.actor_id.clone(),
        session_id: request.scope.session_id.clone(),
        expected_revision: snapshot.revision,
        value: item,
    })
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntakeUpdateRequest {
    pub scope: PlanningScope,
    pub operation_id: String,
    pub intake_id: IntakeItemId,
    pub expected_content_revision: u64,
    pub content: Option<String>,
    pub lifecycle: Option<IntakeLifecycle>,
    pub revisit_at: Option<Option<TimestampMs>>,
}

pub fn plan_intake_update(
    snapshot: &IntakeSnapshot,
    request: &IntakeUpdateRequest,
) -> Result<PlannedOperation<IntakeItem>, PlanningError> {
    snapshot.scope(&request.scope)?;
    let mut item = snapshot.item(&request.intake_id)?.clone();
    if item.content_revision != request.expected_content_revision {
        return Err(PlanningError::RevisionConflict {
            expected: request.expected_content_revision,
            actual: item.content_revision,
        });
    }
    if let Some(content) = &request.content {
        if content.trim().is_empty() {
            return Err(PlanningError::Invalid(
                "intake content cannot be empty".to_owned(),
            ));
        }
        item.content = content.clone();
        item.content_revision = item
            .content_revision
            .checked_add(1)
            .ok_or_else(|| PlanningError::Invalid("intake revision overflow".to_owned()))?;
        item.content_digest = crate::sha256_content_digest(content.as_bytes());
    }
    if let Some(revisit_at) = request.revisit_at {
        item.revisit_at = revisit_at;
    }
    if let Some(lifecycle) = request.lifecycle {
        item.transition(lifecycle)?;
    }
    if item.lifecycle == IntakeLifecycle::Deferred && item.revisit_at.is_none() {
        return Err(PlanningError::Domain(ModelError::DeferredWithoutRevisit));
    }
    let digest = canonical_request_digest(
        "intake.update/v3",
        json!({
            "project_id": request.scope.project_id.as_str(),
            "actor_id": request.scope.actor_id,
            "intake_id": request.intake_id.as_str(),
            "expected_content_revision": request.expected_content_revision,
            "new_content_digest": item.content_digest,
            "lifecycle": format!("{:?}", item.lifecycle).to_ascii_lowercase(),
            "revisit_at": item.revisit_at.map(TimestampMs::as_millis),
            "expected_snapshot_revision": snapshot.revision,
        }),
    );
    Ok(PlannedOperation {
        operation_id: request.operation_id.clone(),
        request_digest: digest,
        project_id: request.scope.project_id.clone(),
        actor_id: request.scope.actor_id.clone(),
        session_id: request.scope.session_id.clone(),
        expected_revision: snapshot.revision,
        value: item,
    })
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntakePromotionRequest {
    pub scope: PlanningScope,
    pub operation_id: String,
    pub promotion_id: PromotionId,
    pub intake_id: IntakeItemId,
    pub target_kind: PromotionTargetKind,
    pub target_id: String,
}

pub fn plan_intake_promotion(
    snapshot: &IntakeSnapshot,
    request: &IntakePromotionRequest,
) -> Result<PlannedOperation<IntakePromotion>, PlanningError> {
    snapshot.scope(&request.scope)?;
    let item = snapshot.item(&request.intake_id)?;
    let promotion = IntakePromotion {
        id: request.promotion_id.clone(),
        project_id: request.scope.project_id.clone(),
        intake_id: request.intake_id.clone(),
        intake_revision: item.content_revision,
        intake_digest: item.content_digest.clone(),
        target_kind: request.target_kind,
        target_id: request.target_id.clone(),
    };
    validate_promotion(item, &promotion)?;
    if snapshot
        .promotions
        .iter()
        .any(|existing| existing == &promotion)
    {
        return Err(PlanningError::Invalid(
            "promotion already exists; replay its operation".to_owned(),
        ));
    }
    let digest = canonical_request_digest(
        "intake.promote/v3",
        json!({
            "project_id": request.scope.project_id.as_str(),
            "actor_id": request.scope.actor_id,
            "intake_id": request.intake_id.as_str(),
            "intake_revision": item.content_revision,
            "intake_digest": item.content_digest,
            "target_kind": format!("{:?}", request.target_kind).to_ascii_lowercase(),
            "target_id": request.target_id,
            "expected_snapshot_revision": snapshot.revision,
        }),
    );
    Ok(PlannedOperation {
        operation_id: request.operation_id.clone(),
        request_digest: digest,
        project_id: request.scope.project_id.clone(),
        actor_id: request.scope.actor_id.clone(),
        session_id: request.scope.session_id.clone(),
        expected_revision: snapshot.revision,
        value: promotion,
    })
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DispositionRequest {
    pub scope: PlanningScope,
    pub operation_id: String,
    pub disposition: ContainerDisposition,
    pub container: WorkNode,
    pub descendants: Vec<WorkNode>,
    pub current: Vec<ContainerDisposition>,
}

pub fn plan_disposition(
    request: &DispositionRequest,
) -> Result<PlannedOperation<ContainerDisposition>, PlanningError> {
    request.scope.validate()?;
    let expected_revision = request.scope.expected_revision.ok_or_else(|| {
        PlanningError::Invalid("v3 disposition requires expected_revision".to_owned())
    })?;
    if request.disposition.project_id != request.scope.project_id
        || request.container.project_id != request.scope.project_id
    {
        return Err(PlanningError::ScopeConflict {
            expected: request.scope.project_id.to_string(),
            actual: request.disposition.project_id.to_string(),
        });
    }
    let mut all = request.current.clone();
    all.push(request.disposition.clone());
    validate_container_dispositions(&request.container, &request.descendants, &all)?;
    let digest = canonical_request_digest(
        "container.disposition/v3",
        json!({
            "project_id": request.scope.project_id.as_str(),
            "actor_id": request.scope.actor_id,
            "container_id": request.disposition.container_id.as_str(),
            "descendant_id": request.disposition.descendant_id.as_str(),
            "kind": format!("{:?}", request.disposition.kind).to_ascii_lowercase(),
            "descendant_revision": request.disposition.descendant_revision,
            "descendant_outcome_digest": request.disposition.descendant_outcome_digest,
            "supersedes_id": request.disposition.supersedes_id.as_ref().map(ToString::to_string),
            "expected_snapshot_revision": request.scope.expected_revision,
        }),
    );
    Ok(PlannedOperation {
        operation_id: request.operation_id.clone(),
        request_digest: digest,
        project_id: request.scope.project_id.clone(),
        actor_id: request.scope.actor_id.clone(),
        session_id: request.scope.session_id.clone(),
        expected_revision,
        value: request.disposition.clone(),
    })
}

impl WorkApplication<'_> {
    pub fn plan_intake_capture(
        &self,
        snapshot: &IntakeSnapshot,
        request: &IntakeCaptureRequest,
    ) -> Result<PlannedOperation<IntakeItem>, ApplicationError> {
        plan_intake_capture(snapshot, request).map_err(ApplicationError::from)
    }

    pub fn plan_intake_update(
        &self,
        snapshot: &IntakeSnapshot,
        request: &IntakeUpdateRequest,
    ) -> Result<PlannedOperation<IntakeItem>, ApplicationError> {
        plan_intake_update(snapshot, request).map_err(ApplicationError::from)
    }

    pub fn plan_intake_promotion(
        &self,
        snapshot: &IntakeSnapshot,
        request: &IntakePromotionRequest,
    ) -> Result<PlannedOperation<IntakePromotion>, ApplicationError> {
        plan_intake_promotion(snapshot, request).map_err(ApplicationError::from)
    }

    pub fn plan_work_schedule_update(
        &self,
        snapshot: &SchedulingSnapshot,
        request: &WorkScheduleUpdateRequest,
    ) -> Result<PlannedOperation<WorkScheduleRecord>, ApplicationError> {
        plan_work_schedule_update(snapshot, request).map_err(ApplicationError::from)
    }

    pub fn plan_external_wait_create(
        &self,
        snapshot: &SchedulingSnapshot,
        request: &ExternalWaitCreateRequest,
    ) -> Result<PlannedOperation<ExternalWait>, ApplicationError> {
        plan_external_wait_create(snapshot, request).map_err(ApplicationError::from)
    }

    pub fn plan_external_wait_resolution(
        &self,
        snapshot: &SchedulingSnapshot,
        request: &ExternalWaitResolutionRequest,
    ) -> Result<PlannedOperation<ExternalWait>, ApplicationError> {
        plan_external_wait_resolution(snapshot, request).map_err(ApplicationError::from)
    }

    pub fn plan_container_disposition(
        &self,
        request: &DispositionRequest,
    ) -> Result<PlannedOperation<ContainerDisposition>, ApplicationError> {
        plan_disposition(request).map_err(ApplicationError::from)
    }
}

/// A compact application-side target descriptor used by source/memory
/// adapters.  The actual target creation remains owned by those crates; this
/// contract carries the immutable intake provenance they must retain.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PromotionTarget {
    pub project_id: ProjectId,
    pub intake_id: IntakeItemId,
    pub intake_revision: u64,
    pub intake_digest: String,
    pub target_kind: PromotionTargetKind,
    pub target_id: String,
}

impl From<&IntakePromotion> for PromotionTarget {
    fn from(promotion: &IntakePromotion) -> Self {
        Self {
            project_id: promotion.project_id.clone(),
            intake_id: promotion.intake_id.clone(),
            intake_revision: promotion.intake_revision,
            intake_digest: promotion.intake_digest.clone(),
            target_kind: promotion.target_kind,
            target_id: promotion.target_id.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use boreal_domain::work_model_v3::{
        DispositionKind, ExecutionMode, ExternalWaitAccountable, ExternalWaitCategory,
        IntakeStatus, LocalDate,
    };
    use boreal_domain::WorkId;

    fn snapshot() -> IntakeSnapshot {
        IntakeSnapshot {
            project_id: ProjectId::new("p1"),
            revision: 3,
            buckets: vec![IntakeBucket {
                id: IntakeBucketId::new("inbox"),
                project_id: ProjectId::new("p1"),
                name: "Inbox".into(),
                archived: false,
            }],
            items: Vec::new(),
            promotions: Vec::new(),
            dispositions: Vec::new(),
        }
    }

    fn scope() -> PlanningScope {
        PlanningScope::new(ProjectId::new("p1"), "operator").at_revision(3)
    }

    fn scheduling_snapshot() -> SchedulingSnapshot {
        let project = ProjectId::new("p1");
        SchedulingSnapshot {
            project_id: project.clone(),
            revision: 3,
            project_civil_time: Some(ProjectCivilTimeSetting {
                project_id: project.clone(),
                revision: 1,
                timezone: "Etc/UTC".into(),
                tzdb_identity: "tzdb-test".into(),
                changed_by: "operator".into(),
                changed_at: TimestampMs::from_millis(1),
            }),
            nodes: vec![
                WorkNode::task(
                    project.clone(),
                    WorkId::new("source"),
                    ExecutionMode::Direct,
                    None,
                    "Decision",
                ),
                WorkNode::task(
                    project.clone(),
                    WorkId::new("dependent"),
                    ExecutionMode::Direct,
                    None,
                    "Dependent",
                ),
                WorkNode::task(
                    project.clone(),
                    WorkId::new("unrelated"),
                    ExecutionMode::Direct,
                    None,
                    "Unrelated",
                ),
            ],
            dependencies: vec![DirectDependency {
                blocker_id: WorkId::new("source"),
                blocked_id: WorkId::new("dependent"),
            }],
            schedules: Vec::new(),
            external_waits: Vec::new(),
        }
    }

    fn open_wait() -> ExternalWait {
        ExternalWait {
            id: ExternalWaitId::new("wait-1"),
            project_id: ProjectId::new("p1"),
            source_work_id: WorkId::new("source"),
            affected_work_ids: vec![WorkId::new("dependent")],
            category: ExternalWaitCategory::Decision,
            reason: "Need the customer decision".into(),
            accountable: ExternalWaitAccountable::Person {
                reference: "person:customer-1".into(),
                display_name: "Customer contact".into(),
            },
            expected_decision: Some("Choose a delivery option".into()),
            expected_output: None,
            follow_up: Some(BusinessDate::Instant(TimestampMs::from_millis(100))),
            civil_time_setting_revision: None,
            revision: 1,
            state: ExternalWaitState::Open,
            created_by: "operator".into(),
            created_at: TimestampMs::from_millis(10),
            resolution: None,
        }
    }

    #[test]
    fn capture_update_and_revisit_status_are_revision_bound() {
        let request = IntakeCaptureRequest {
            scope: scope(),
            operation_id: "capture".into(),
            bucket_id: IntakeBucketId::new("inbox"),
            intake_id: IntakeItemId::new("i1"),
            kind: IntakeKind::Revisit,
            content: "check DST".into(),
            captured_at: TimestampMs::from_millis(10),
            revisit_at: None,
        };
        let item = plan_intake_capture(&snapshot(), &request).unwrap().value;
        assert_eq!(
            item.status_at(TimestampMs::from_millis(10)),
            IntakeStatus::Inbox
        );
        let mut state = snapshot();
        state.items.push(item);
        let update = IntakeUpdateRequest {
            scope: scope(),
            operation_id: "update".into(),
            intake_id: IntakeItemId::new("i1"),
            expected_content_revision: 1,
            content: Some("check DST twice".into()),
            lifecycle: Some(IntakeLifecycle::Deferred),
            revisit_at: Some(Some(TimestampMs::from_millis(100))),
        };
        let updated = plan_intake_update(&state, &update).unwrap().value;
        assert_eq!(updated.content_revision, 2);
        assert_eq!(
            updated.status_at(TimestampMs::from_millis(100)),
            IntakeStatus::RevisitDue
        );
        state.items[0] = updated;
        let stale = IntakeUpdateRequest {
            expected_content_revision: 1,
            ..update
        };
        assert!(matches!(
            plan_intake_update(&state, &stale),
            Err(PlanningError::RevisionConflict { .. })
        ));
    }

    #[test]
    fn promotion_binds_current_content_and_disposition_is_append_only() {
        let mut state = snapshot();
        let capture = IntakeCaptureRequest {
            scope: scope(),
            operation_id: "capture".into(),
            bucket_id: IntakeBucketId::new("inbox"),
            intake_id: IntakeItemId::new("i1"),
            kind: IntakeKind::Discovery,
            content: "found a thing".into(),
            captured_at: TimestampMs::from_millis(10),
            revisit_at: None,
        };
        state
            .items
            .push(plan_intake_capture(&state, &capture).unwrap().value);
        let promotion = IntakePromotionRequest {
            scope: scope(),
            operation_id: "promote".into(),
            promotion_id: PromotionId::new("p1"),
            intake_id: IntakeItemId::new("i1"),
            target_kind: PromotionTargetKind::DraftWork,
            target_id: "w1".into(),
        };
        let planned = plan_intake_promotion(&state, &promotion).unwrap();
        assert_eq!(planned.value.intake_revision, 1);
        state.promotions.push(planned.value.clone());
        assert!(plan_intake_promotion(&state, &promotion).is_err());

        let container = WorkNode::milestone(ProjectId::new("p1"), WorkId::new("m"), "M");
        let child = WorkNode::task(
            ProjectId::new("p1"),
            WorkId::new("t"),
            ExecutionMode::Direct,
            Some(WorkId::new("m")),
            "T",
        );
        let disposition = ContainerDisposition {
            id: boreal_domain::work_model_v3::CloseoutDispositionId::new("d1"),
            container_id: WorkId::new("m"),
            descendant_id: WorkId::new("t"),
            project_id: ProjectId::new("p1"),
            kind: DispositionKind::AcceptedClosed,
            descendant_revision: 3,
            descendant_outcome_digest: "sha256:outcome".into(),
            replacement_id: None,
            reason: None,
            supersedes_id: None,
        };
        let request = DispositionRequest {
            scope: scope(),
            operation_id: "dispose".into(),
            disposition,
            container,
            descendants: vec![child],
            current: Vec::new(),
        };
        assert!(plan_disposition(&request).is_ok());
    }

    #[test]
    fn disposition_requires_reason_for_defer_or_replace() {
        let container = WorkNode::milestone(ProjectId::new("p1"), WorkId::new("m"), "M");
        let child = WorkNode::task(
            ProjectId::new("p1"),
            WorkId::new("t"),
            ExecutionMode::Direct,
            Some(WorkId::new("m")),
            "T",
        );
        let disposition = ContainerDisposition {
            id: boreal_domain::work_model_v3::CloseoutDispositionId::new("d1"),
            container_id: WorkId::new("m"),
            descendant_id: WorkId::new("t"),
            project_id: ProjectId::new("p1"),
            kind: DispositionKind::Deferred,
            descendant_revision: 3,
            descendant_outcome_digest: "sha256:outcome".into(),
            replacement_id: None,
            reason: None,
            supersedes_id: None,
        };
        let request = DispositionRequest {
            scope: scope(),
            operation_id: "dispose".into(),
            disposition,
            container,
            descendants: vec![child],
            current: Vec::new(),
        };
        assert!(matches!(
            plan_disposition(&request),
            Err(PlanningError::Domain(_))
        ));
    }

    #[test]
    fn schedule_updates_are_revision_bound_and_clear_without_erasing_history() {
        let mut state = scheduling_snapshot();
        let request = WorkScheduleUpdateRequest {
            scope: scope(),
            operation_id: "schedule-1".into(),
            work_id: WorkId::new("dependent"),
            expected_schedule_revision: 0,
            schedule: BusinessSchedule {
                not_before: Some(BusinessDate::Instant(TimestampMs::from_millis(50))),
                due: Some(BusinessDate::Instant(TimestampMs::from_millis(100))),
                planned_start: Some(BusinessDate::Instant(TimestampMs::from_millis(60))),
                planned_end: Some(BusinessDate::Instant(TimestampMs::from_millis(90))),
            },
            updated_at: TimestampMs::from_millis(20),
        };
        let planned = plan_work_schedule_update(&state, &request).unwrap();
        assert_eq!(planned.expected_revision, 3);
        assert_eq!(planned.value.revision, 1);
        assert_eq!(
            planned.value.schedule.due,
            Some(BusinessDate::Instant(TimestampMs::from_millis(100)))
        );
        assert_eq!(
            planned.request_digest,
            plan_work_schedule_update(&state, &request)
                .unwrap()
                .request_digest
        );
        state.schedules.push(planned.value);

        let clear = WorkScheduleUpdateRequest {
            operation_id: "schedule-2".into(),
            expected_schedule_revision: 1,
            schedule: BusinessSchedule::empty(),
            updated_at: TimestampMs::from_millis(30),
            ..request.clone()
        };
        let cleared = plan_work_schedule_update(&state, &clear).unwrap().value;
        assert_eq!(cleared.revision, 2);
        assert_eq!(cleared.schedule, BusinessSchedule::empty());
        assert!(matches!(
            plan_work_schedule_update(
                &state,
                &WorkScheduleUpdateRequest {
                    expected_schedule_revision: 0,
                    ..clear
                }
            ),
            Err(PlanningError::RevisionConflict { .. })
        ));
    }

    #[test]
    fn date_only_schedule_and_wait_bind_the_current_project_time_setting() {
        let state = scheduling_snapshot();
        let schedule = plan_work_schedule_update(
            &state,
            &WorkScheduleUpdateRequest {
                scope: scope(),
                operation_id: "schedule-date".into(),
                work_id: WorkId::new("dependent"),
                expected_schedule_revision: 0,
                schedule: BusinessSchedule {
                    due: Some(BusinessDate::LocalDate(LocalDate::new(2026, 10, 14))),
                    ..BusinessSchedule::empty()
                },
                updated_at: TimestampMs::from_millis(5),
            },
        )
        .unwrap();
        assert_eq!(schedule.value.civil_time_setting_revision, Some(1));

        let mut wait = open_wait();
        wait.follow_up = Some(BusinessDate::LocalDate(LocalDate::new(2026, 10, 15)));
        let created = plan_external_wait_create(
            &state,
            &ExternalWaitCreateRequest {
                scope: scope(),
                operation_id: "wait-date".into(),
                wait,
            },
        )
        .unwrap();
        assert_eq!(created.value.civil_time_setting_revision, Some(1));
    }

    #[test]
    fn project_civil_time_setting_changes_are_revision_bound_and_zone_checked() {
        let state = scheduling_snapshot();
        let timezone_database = SystemTimeZoneDatabase::system();
        let zone_identity = timezone_database
            .resolve(
                "America/New_York",
                boreal_domain::work_model_v3::LocalDateTime::new(
                    LocalDate::new(2026, 1, 1),
                    LocalTime::new(0, 0, 0),
                ),
                GapPolicy::NextValid,
                FoldPolicy::EarlierOffset,
            )
            .unwrap()
            .tzdb_identity;
        let request = ProjectCivilTimeUpdateRequest {
            scope: scope(),
            operation_id: "civil-time-2".into(),
            expected_setting_revision: 1,
            timezone: "America/New_York".into(),
            tzdb_identity: zone_identity,
            updated_at: TimestampMs::from_millis(6),
        };
        let planned = plan_project_civil_time_update(&state, &request, &timezone_database).unwrap();
        assert_eq!(planned.value.revision, 2);
        assert_eq!(planned.value.changed_by, "operator");
        assert!(matches!(
            plan_project_civil_time_update(
                &state,
                &ProjectCivilTimeUpdateRequest {
                    expected_setting_revision: 0,
                    ..request
                },
                &timezone_database
            ),
            Err(PlanningError::RevisionConflict { .. })
        ));
    }

    #[test]
    fn project_local_midnight_resolves_with_project_zone_and_matching_tzdb() {
        let timezone_database = SystemTimeZoneDatabase::system();
        let date = LocalDate::new(2026, 3, 8);
        let local_midnight =
            boreal_domain::work_model_v3::LocalDateTime::new(date, LocalTime::new(0, 0, 0));
        let expected = timezone_database
            .resolve(
                "America/Los_Angeles",
                local_midnight,
                GapPolicy::NextValid,
                FoldPolicy::EarlierOffset,
            )
            .unwrap();
        let setting = ProjectCivilTimeSetting {
            project_id: ProjectId::new("p1"),
            revision: 2,
            timezone: "America/Los_Angeles".into(),
            tzdb_identity: expected.tzdb_identity.clone(),
            changed_by: "operator".into(),
            changed_at: expected.utc_instant,
        };
        let context = BusinessTimeContext {
            project_id: setting.project_id.clone(),
            setting_revision: setting.revision,
            as_of: TimestampMs::from_millis(expected.utc_instant.as_millis().saturating_add(1_000)),
            civil_date: date,
            timezone: setting.timezone.clone(),
            tzdb_identity: setting.tzdb_identity.clone(),
        };
        validate_project_civil_time_context(&setting, &context, &timezone_database).unwrap();
        let resolved = resolve_business_date_boundary(
            BusinessDateBoundary::LocalDateStart(date),
            &context,
            &timezone_database,
        )
        .unwrap();
        assert_eq!(resolved, expected.utc_instant);

        let wrong_context = BusinessTimeContext {
            tzdb_identity: "stale-tzdb-identity".into(),
            ..context
        };
        assert!(matches!(
            validate_project_civil_time_context(&setting, &wrong_context, &timezone_database),
            Err(PlanningError::Invalid(_))
        ));
    }

    #[test]
    fn date_only_due_timer_covers_due_today_and_overdue_carry_over() {
        let timezone_database = SystemTimeZoneDatabase::system();
        let due_date = LocalDate::new(2026, 3, 8);
        let due_midnight = timezone_database
            .resolve(
                "America/Los_Angeles",
                boreal_domain::work_model_v3::LocalDateTime::new(due_date, LocalTime::new(0, 0, 0)),
                GapPolicy::NextValid,
                FoldPolicy::EarlierOffset,
            )
            .unwrap();
        let setting = ProjectCivilTimeSetting {
            project_id: ProjectId::new("p1"),
            revision: 1,
            timezone: "America/Los_Angeles".into(),
            tzdb_identity: due_midnight.tzdb_identity.clone(),
            changed_by: "operator".into(),
            changed_at: due_midnight.utc_instant,
        };
        let due_day_end = timezone_database
            .resolve(
                "America/Los_Angeles",
                boreal_domain::work_model_v3::LocalDateTime::new(
                    due_date.add_days(1).unwrap(),
                    LocalTime::new(0, 0, 0),
                ),
                GapPolicy::NextValid,
                FoldPolicy::EarlierOffset,
            )
            .unwrap();
        let before_due_instant = timezone_database
            .resolve(
                "America/Los_Angeles",
                boreal_domain::work_model_v3::LocalDateTime::new(
                    due_date.add_days(-1).unwrap(),
                    LocalTime::new(12, 0, 0),
                ),
                GapPolicy::NextValid,
                FoldPolicy::EarlierOffset,
            )
            .unwrap();
        let record = WorkScheduleRecord {
            project_id: setting.project_id.clone(),
            work_id: WorkId::new("task"),
            revision: 1,
            schedule: BusinessSchedule {
                due: Some(BusinessDate::LocalDate(due_date)),
                ..BusinessSchedule::empty()
            },
            civil_time_setting_revision: Some(1),
            updated_at: due_midnight.utc_instant,
        };
        let before_due = setting
            .context(
                before_due_instant.utc_instant,
                due_date.add_days(-1).unwrap(),
            )
            .unwrap();
        assert_eq!(
            next_business_schedule_change(
                &record,
                &setting,
                &before_due,
                false,
                &timezone_database,
            )
            .unwrap(),
            Some(due_midnight.utc_instant)
        );

        let on_due_date = setting
            .context(
                TimestampMs::from_millis(due_midnight.utc_instant.as_millis() + 1_000),
                due_date,
            )
            .unwrap();
        assert_eq!(
            next_business_schedule_change(
                &record,
                &setting,
                &on_due_date,
                false,
                &timezone_database,
            )
            .unwrap(),
            Some(due_day_end.utc_instant)
        );
        assert_eq!(
            next_business_schedule_change(
                &record,
                &setting,
                &on_due_date,
                true,
                &timezone_database,
            )
            .unwrap(),
            None
        );
    }

    #[test]
    fn midnight_gap_starts_the_project_date_at_the_next_valid_local_time() {
        let timezone_database = SystemTimeZoneDatabase::system();
        let date = LocalDate::new(2018, 11, 4);
        let expected = timezone_database
            .resolve(
                "America/Sao_Paulo",
                boreal_domain::work_model_v3::LocalDateTime::new(date, LocalTime::new(0, 0, 0)),
                GapPolicy::NextValid,
                FoldPolicy::EarlierOffset,
            )
            .unwrap();
        assert_eq!(expected.nominal_local.time, LocalTime::new(0, 0, 0));
        assert_eq!(expected.gap_policy, GapPolicy::NextValid);
        let setting = ProjectCivilTimeSetting {
            project_id: ProjectId::new("p1"),
            revision: 3,
            timezone: "America/Sao_Paulo".into(),
            tzdb_identity: expected.tzdb_identity.clone(),
            changed_by: "operator".into(),
            changed_at: expected.utc_instant,
        };
        let context = BusinessTimeContext {
            project_id: setting.project_id.clone(),
            setting_revision: setting.revision,
            as_of: TimestampMs::from_millis(
                expected.utc_instant.as_millis().saturating_add(60_000),
            ),
            civil_date: date,
            timezone: setting.timezone.clone(),
            tzdb_identity: setting.tzdb_identity.clone(),
        };
        validate_project_civil_time_context(&setting, &context, &timezone_database).unwrap();
        assert_eq!(
            resolve_business_date_boundary(
                BusinessDateBoundary::LocalDateStart(date),
                &context,
                &timezone_database,
            )
            .unwrap(),
            expected.utc_instant
        );
    }

    #[test]
    fn project_zone_resolution_preserves_dst_gap_and_fold_policy() {
        let timezone_database = SystemTimeZoneDatabase::system();
        let gap = timezone_database
            .resolve(
                "America/New_York",
                boreal_domain::work_model_v3::LocalDateTime::new(
                    LocalDate::new(2024, 3, 10),
                    LocalTime::new(2, 30, 0),
                ),
                GapPolicy::NextValid,
                FoldPolicy::EarlierOffset,
            )
            .unwrap();
        assert_eq!(gap.nominal_local.time, LocalTime::new(2, 30, 0));
        assert_eq!(gap.gap_policy, GapPolicy::NextValid);

        let folded_local = boreal_domain::work_model_v3::LocalDateTime::new(
            LocalDate::new(2024, 11, 3),
            LocalTime::new(1, 30, 0),
        );
        let earlier = timezone_database
            .resolve(
                "America/New_York",
                folded_local,
                GapPolicy::NextValid,
                FoldPolicy::EarlierOffset,
            )
            .unwrap();
        let later = timezone_database
            .resolve(
                "America/New_York",
                folded_local,
                GapPolicy::NextValid,
                FoldPolicy::LaterOffset,
            )
            .unwrap();
        assert_eq!(
            later.utc_instant.as_millis() - earlier.utc_instant.as_millis(),
            3_600_000
        );
        assert_eq!(earlier.fold_policy, FoldPolicy::EarlierOffset);
        assert_eq!(later.fold_policy, FoldPolicy::LaterOffset);
    }

    #[test]
    fn external_wait_plans_bind_scope_attribution_revision_and_resolution() {
        let mut state = scheduling_snapshot();
        let create = ExternalWaitCreateRequest {
            scope: scope(),
            operation_id: "wait-create".into(),
            wait: open_wait(),
        };
        let created = plan_external_wait_create(&state, &create).unwrap();
        assert_eq!(created.value.affected_work_ids, [WorkId::new("dependent")]);
        assert_eq!(created.value.created_by, "operator");
        assert_eq!(created.expected_revision, 3);
        state.external_waits.push(created.value);

        let resolution = ExternalWaitResolution {
            outcome: ExternalWaitOutcome::Approved,
            detail: "Customer approved option A".into(),
            output_ref: Some("source-version:approval-1".into()),
            supplied_by: open_wait().accountable,
            recorded_by: "operator".into(),
            recorded_as: ActorRole::Operator,
            recorded_at: TimestampMs::from_millis(200),
        };
        let request = ExternalWaitResolutionRequest {
            scope: scope(),
            operation_id: "wait-resolve".into(),
            wait_id: ExternalWaitId::new("wait-1"),
            expected_wait_revision: 1,
            next_state: ExternalWaitState::Resolved,
            resolution,
        };
        let resolved = plan_external_wait_resolution(&state, &request).unwrap();
        assert_eq!(resolved.value.revision, 2);
        assert_eq!(resolved.value.state, ExternalWaitState::Resolved);
        assert!(!resolved.value.blocks_work(&WorkId::new("dependent")));
        assert_eq!(
            resolved.value.resolution.as_ref().unwrap().recorded_by,
            "operator"
        );
        state.external_waits[0] = resolved.value;
        assert!(matches!(
            plan_external_wait_resolution(&state, &request),
            Err(PlanningError::RevisionConflict { .. })
        ));
    }

    #[test]
    fn external_wait_rejects_unrelated_blockers_and_non_operator_resolution() {
        let state = scheduling_snapshot();
        let mut unrelated = open_wait();
        unrelated.affected_work_ids = vec![WorkId::new("unrelated")];
        assert!(matches!(
            plan_external_wait_create(
                &state,
                &ExternalWaitCreateRequest {
                    scope: scope(),
                    operation_id: "wait-create".into(),
                    wait: unrelated,
                }
            ),
            Err(PlanningError::Domain(ModelError::InvalidExternalWait(_)))
        ));

        let mut state = state;
        state.external_waits.push(open_wait());
        let request = ExternalWaitResolutionRequest {
            scope: scope(),
            operation_id: "wait-resolve".into(),
            wait_id: ExternalWaitId::new("wait-1"),
            expected_wait_revision: 1,
            next_state: ExternalWaitState::Resolved,
            resolution: ExternalWaitResolution {
                outcome: ExternalWaitOutcome::Approved,
                detail: "Approved".into(),
                output_ref: None,
                supplied_by: open_wait().accountable,
                recorded_by: "operator".into(),
                recorded_as: ActorRole::Agent,
                recorded_at: TimestampMs::from_millis(200),
            },
        };
        assert!(matches!(
            plan_external_wait_resolution(&state, &request),
            Err(PlanningError::Invalid(_))
        ));
    }
}
