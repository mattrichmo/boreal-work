use boreal_application::{
    CycleAssignment, CycleAssignmentState, CycleId, CycleInstance, CycleLifecycle, CycleSeries,
    CycleSeriesLifecycle, CycleTemplate, ExecutionMode, FoldPolicy, GapPolicy, IntakeBucket,
    IntakeBucketId, IntakeItem, IntakeItemId, IntakeKind, IntakeLifecycle, IntakePromotion,
    PlanningScope, PromotionId, PromotionTargetKind, SessionEndRequest, SystemTimeZoneDatabase,
    WorkApplication, WorkNode,
};
use boreal_domain::{
    AcceptanceProfile, DispatchPolicy, PersistedLifecycle, ProjectId, SessionId, WorkId, WorkItem,
};
use boreal_store::SqliteStore;

const SCHEMA_V2: &str = include_str!("../../../project/spec/schema-v2.sql");

fn work(
    project_id: &ProjectId,
    id: &str,
    kind: boreal_domain::WorkKind,
    parent_id: Option<&str>,
) -> WorkItem {
    WorkItem {
        id: WorkId::new(id),
        project_id: project_id.clone(),
        kind,
        parent_id: parent_id.map(WorkId::new),
        title: id.to_owned(),
        description: String::new(),
        lifecycle: PersistedLifecycle::Open,
        priority: 0,
        dispatch_policy: DispatchPolicy::Automatic,
        hard_holds: Vec::new(),
        acceptance_profile: AcceptanceProfile::focused(),
    }
}

fn scope(store: &SqliteStore, project_id: &ProjectId) -> PlanningScope {
    PlanningScope::new(project_id.clone(), "agent-1")
        .at_revision(store.project_revision(project_id.as_str()).unwrap().0)
}

#[test]
fn application_v3_migration_and_hierarchy_mutations_are_revision_bound() {
    let store = SqliteStore::open_in_memory(SCHEMA_V2).unwrap();
    let app = WorkApplication::new(&store);
    let project = ProjectId::new("p1");
    app.init_project(
        &project,
        "agent-1",
        "agent",
        "cred",
        "Agent",
        "unix-ms:1",
        "op-init",
    )
    .unwrap();
    app.create_work_as(
        &work(&project, "m1", boreal_domain::WorkKind::Milestone, None),
        "agent-1",
        "unix-ms:2",
        "op-m",
    )
    .unwrap();
    app.create_work_as(
        &work(&project, "s1", boreal_domain::WorkKind::Sprint, Some("m1")),
        "agent-1",
        "unix-ms:3",
        "op-s",
    )
    .unwrap();
    app.create_work_as(
        &work(&project, "t1", boreal_domain::WorkKind::Task, Some("s1")),
        "agent-1",
        "unix-ms:4",
        "op-t",
    )
    .unwrap();

    assert!(app.ensure_work_model_v3().unwrap());
    assert!(!app.ensure_work_model_v3().unwrap());
    assert!(app.work_model_v3_enabled().unwrap());

    let milestone = WorkNode::milestone(project.clone(), WorkId::new("m1"), "M");
    let milestone_scope = scope(&store, &project);
    let created = app
        .create_work_node_v3(&milestone_scope, "op-node-m", &milestone, "unix-ms:4")
        .unwrap();
    let replay = app
        .create_work_node_v3(&milestone_scope, "op-node-m", &milestone, "unix-ms:4")
        .unwrap();
    assert!(created.changed);
    assert!(!replay.changed);
    assert_eq!(created.snapshot_revision, replay.snapshot_revision);
    let task = WorkNode::task(
        project.clone(),
        WorkId::new("t1"),
        ExecutionMode::Direct,
        Some(WorkId::new("m1")),
        "T",
    );
    app.create_work_node_v3(&scope(&store, &project), "op-node-t", &task, "unix-ms:5")
        .unwrap();
    assert_eq!(store.work_nodes_v3("p1").unwrap().len(), 2);

    let stale = PlanningScope::new(project.clone(), "agent-1").at_revision(1);
    assert!(app
        .create_work_node_v3(&stale, "op-stale", &task, "unix-ms:6")
        .is_err());

    let series = CycleSeries {
        id: "series-1".into(),
        project_id: project.clone(),
        name: "Weekly".into(),
        lifecycle: CycleSeriesLifecycle::Active,
        revision: 0,
    };
    let tzdb = SystemTimeZoneDatabase::system();
    let template = CycleTemplate {
        id: "template-1".into(),
        series_id: series.id.clone(),
        version: 1,
        effective_from_slot_ordinal: 0,
        name_pattern: "Cycle {slot}".into(),
        goal_template: "Ship".into(),
        timezone: "UTC".into(),
        recurrence: boreal_domain::work_model_v3::WeeklyRecurrence {
            anchor_local_start: boreal_domain::work_model_v3::LocalDateTime::new(
                boreal_domain::work_model_v3::LocalDate::new(2026, 1, 5),
                boreal_domain::work_model_v3::LocalTime::new(9, 0, 0),
            ),
            interval_weeks: 1,
            weekdays: [1].into_iter().collect(),
            end: boreal_domain::work_model_v3::RecurrenceEnd::Never,
            gap_policy: GapPolicy::NextValid,
            fold_policy: FoldPolicy::EarlierOffset,
        },
    };
    let tzdb_identity = tzdb
        .resolve(
            "UTC",
            template.recurrence.anchor_local_start,
            GapPolicy::NextValid,
            FoldPolicy::EarlierOffset,
        )
        .unwrap()
        .tzdb_identity;
    app.create_cycle_series_v3(
        &scope(&store, &project),
        "op-series",
        &series,
        "UTC",
        &tzdb_identity,
        "unix-ms:7",
    )
    .unwrap();
    app.create_cycle_template_v3(
        &scope(&store, &project),
        "op-template",
        &template,
        "unix-ms:8",
        &tzdb_identity,
    )
    .unwrap();
    let resolution = tzdb
        .resolve(
            "UTC",
            template.recurrence.anchor_local_start,
            GapPolicy::NextValid,
            FoldPolicy::EarlierOffset,
        )
        .unwrap();
    let cycle = CycleInstance {
        id: CycleId::new("cycle-1"),
        project_id: project.clone(),
        series_id: series.id.clone(),
        template_version_id: template.id.clone(),
        slot_ordinal: 0,
        slot_key: "boreal.cycle-slot/1/series-1/0".into(),
        name: "Cycle 0".into(),
        scheduled_start: resolution,
        scheduled_end: None,
    };
    app.create_cycle_instance_v3(
        &scope(&store, &project),
        "op-cycle",
        &cycle,
        "Ship",
        CycleLifecycle::Planned,
        "unix-ms:9",
    )
    .unwrap();
    app.assign_cycle_work_v3(
        &scope(&store, &project),
        "op-assignment",
        &CycleAssignment {
            id: "assignment-1".into(),
            cycle_id: cycle.id.clone(),
            work_id: WorkId::new("t1"),
            project_id: project.clone(),
            state: CycleAssignmentState::Planned,
            activation_policy: boreal_domain::work_model_v3::ActivationPolicy::AtCycleStart,
            activation_at: None,
            predecessor_id: None,
            successor_id: None,
        },
        "unix-ms:10",
    )
    .unwrap();
    assert!(store.cycle_v3("p1", "cycle-1").unwrap().is_some());

    let bucket = IntakeBucket {
        id: IntakeBucketId::new("inbox"),
        project_id: project.clone(),
        name: "Inbox".into(),
        archived: false,
    };
    app.create_intake_bucket_v3(&scope(&store, &project), "op-bucket", &bucket, "unix-ms:11")
        .unwrap();
    let content = "record this discovery".to_owned();
    let item = IntakeItem {
        id: IntakeItemId::new("intake-1"),
        bucket_id: bucket.id.clone(),
        project_id: project.clone(),
        kind: IntakeKind::Discovery,
        lifecycle: IntakeLifecycle::Captured,
        content: content.clone(),
        content_revision: 1,
        content_digest: boreal_application::sha256_content_digest(content.as_bytes()),
        revisit_at: None,
    };
    app.create_intake_item_v3(
        &scope(&store, &project),
        "op-item",
        &item,
        "unix-ms:12",
        "unix-ms:12",
    )
    .unwrap();
    let promotion_scope = scope(&store, &project);
    let promotion = IntakePromotion {
        id: PromotionId::new("promotion-1"),
        project_id: project.clone(),
        intake_id: item.id.clone(),
        intake_revision: item.content_revision,
        intake_digest: item.content_digest.clone(),
        target_kind: PromotionTargetKind::DraftWork,
        target_id: "draft-task".into(),
    };
    let promoted = app
        .promote_intake_v3(&promotion_scope, "op-promote", &promotion, "unix-ms:13")
        .unwrap();
    let promotion_replay = app
        .promote_intake_v3(&promotion_scope, "op-promote", &promotion, "unix-ms:13")
        .unwrap();
    assert!(promoted.changed);
    assert!(!promotion_replay.changed);
    assert_eq!(store.intake_items_v3("p1").unwrap().len(), 1);
}

#[test]
fn session_end_and_operator_recovery_are_explicit_and_scope_checked() {
    let store = SqliteStore::open_in_memory(SCHEMA_V2).unwrap();
    let app = WorkApplication::new(&store);
    let project = ProjectId::new("p-session");
    app.init_project(
        &project,
        "agent-1",
        "agent",
        "cred",
        "Agent",
        "unix-ms:1",
        "op-init",
    )
    .unwrap();
    app.register_session_as(
        &project,
        "agent-1",
        "harness-1",
        "session-1",
        "unix-ms:2",
        "op-session",
    )
    .unwrap();

    let idle_request = SessionEndRequest {
        project_id: project.clone(),
        actor_id: "agent-1".into(),
        session_id: SessionId::new("session-1"),
        operation_id: "op-end-idle".into(),
        confirm_release: false,
    };
    let idle = app.prepare_session_end(&idle_request).unwrap();
    assert!(!idle.requires_release);
    assert!(idle.current_attempt.is_none());

    let work = work(&project, "t1", boreal_domain::WorkKind::Task, None);
    app.create_work_as(&work, "agent-1", "unix-ms:3", "op-work")
        .unwrap();
    let revision = store.project_revision(project.as_str()).unwrap().0;
    app.claim(
        &project,
        work.id.as_str(),
        "agent-1",
        "harness-1",
        Some("session-1"),
        "attempt-1",
        "op-claim",
        "sha256:session-claim",
        Some(revision),
        "2026-01-01T00:00:04Z",
        "2026-01-01T00:01:40Z",
        "2026-01-01T00:03:20Z",
    )
    .unwrap();

    let live_request = SessionEndRequest {
        operation_id: "op-end-live".into(),
        ..idle_request.clone()
    };
    assert!(app.prepare_session_end(&live_request).is_err());
    let confirmed = SessionEndRequest {
        confirm_release: true,
        ..live_request
    };
    let plan = app.prepare_session_end(&confirmed).unwrap();
    assert!(plan.requires_release);
    assert_eq!(
        plan.current_attempt.as_ref().unwrap().attempt_id,
        "attempt-1"
    );

    let recovery = app.assess_operator_recovery(&project).unwrap();
    assert!(recovery.requires_explicit_reconciliation);
    assert!(recovery.incomplete_evidence_executions.is_empty());

    let wrong_actor = SessionEndRequest {
        actor_id: "other-agent".into(),
        ..confirmed
    };
    assert!(app.prepare_session_end(&wrong_actor).is_err());
}
