use boreal_application::{cycle_runtime::CycleCreateInput, PlanningScope, WorkApplication};
use boreal_domain::{
    AcceptanceProfile, DispatchPolicy, PersistedLifecycle, ProjectId, WorkId, WorkItem, WorkKind,
};
use boreal_store::{cycle_commands::CycleChangeRequest, SqliteStore};

const SCHEMA_V2: &str = include_str!("../../../project/spec/schema-v2.sql");

fn scope(store: &SqliteStore, project: &ProjectId) -> PlanningScope {
    PlanningScope::new(project.clone(), "planner")
        .at_revision(store.project_revision(project.as_str()).unwrap().0)
}

fn cycle_change(
    cycle_id: &str,
    change: &str,
    assignment_id: Option<&str>,
    work_id: Option<&str>,
    reason: &str,
    confirmed: bool,
) -> CycleChangeRequest {
    CycleChangeRequest {
        cycle_id: cycle_id.into(),
        change: change.into(),
        assignment_id: assignment_id.map(str::to_owned),
        work_id: work_id.map(str::to_owned),
        successor_cycle_id: None,
        successor_assignment_id: None,
        reason: reason.into(),
        confirmed,
    }
}

#[test]
fn explicit_deferral_reconciles_cycle_scope_without_accepting_the_task() {
    let store = SqliteStore::open_in_memory(SCHEMA_V2).unwrap();
    let app = WorkApplication::new(&store);
    let project = ProjectId::new("p-cycle-readiness");
    app.init_project(
        &project,
        "planner",
        "agent",
        "cred-planner",
        "Planner",
        "unix-ms:1",
        "op-init",
    )
    .unwrap();
    app.create_work_as(
        &WorkItem {
            id: WorkId::new("task-1"),
            project_id: project.clone(),
            kind: WorkKind::Task,
            parent_id: None,
            title: "Task to defer".into(),
            description: String::new(),
            lifecycle: PersistedLifecycle::Open,
            priority: 0,
            dispatch_policy: DispatchPolicy::Automatic,
            hard_holds: Vec::new(),
            acceptance_profile: AcceptanceProfile::focused(),
        },
        "planner",
        "unix-ms:2",
        "op-task",
    )
    .unwrap();
    app.ensure_work_model_v3().unwrap();
    assert!(store
        .work_node_v3("p-cycle-readiness", "task-1")
        .unwrap()
        .is_some());

    app.create_planning_cycle(
        &scope(&store, &project),
        "op-cycle",
        CycleCreateInput {
            cycle_id: "cycle-1".into(),
            name: "Cycle 1".into(),
            goal: "Deliver the planned work".into(),
            timezone: "UTC".into(),
            start: boreal_domain::work_model_v3::LocalDateTime::new(
                boreal_domain::work_model_v3::LocalDate::new(2026, 9, 23),
                boreal_domain::work_model_v3::LocalTime::new(9, 0, 0),
            ),
            end: None,
            later_fold: false,
            reason: "Create planning window".into(),
        },
        "unix-ms:4",
    )
    .unwrap();

    app.change_planning_cycle(
        &scope(&store, &project),
        "op-assign",
        &cycle_change(
            "cycle-1",
            "assign",
            Some("assignment-1"),
            Some("task-1"),
            "Commit task to cycle",
            true,
        ),
        "unix-ms:5",
    )
    .unwrap();
    app.change_planning_cycle(
        &scope(&store, &project),
        "op-activate",
        &cycle_change("cycle-1", "activate", None, None, "Start cycle", true),
        "unix-ms:6",
    )
    .unwrap();

    // A live assignment is not silently treated as reconciled scope.
    assert!(app
        .change_planning_cycle(
            &scope(&store, &project),
            "op-close-too-early",
            &cycle_change("cycle-1", "close", None, None, "Close cycle", true),
            "unix-ms:6",
        )
        .is_err());
    assert_eq!(
        store
            .cycle_assignments_v3("p-cycle-readiness", "cycle-1")
            .unwrap()[0]
            .state,
        "planned"
    );

    // Deferral is explicit and audited, but it is not task acceptance.
    assert!(app
        .defer_planning_cycle_assignment(
            &scope(&store, &project),
            "op-defer-unconfirmed",
            "cycle-1",
            "assignment-1",
            "Wait for an external dependency",
            false,
            "unix-ms:7",
        )
        .is_err());
    app.defer_planning_cycle_assignment(
        &scope(&store, &project),
        "op-defer",
        "cycle-1",
        "assignment-1",
        "Wait for an external dependency",
        true,
        "unix-ms:8",
    )
    .unwrap();
    assert_eq!(
        store
            .cycle_assignments_v3("p-cycle-readiness", "cycle-1")
            .unwrap()[0]
            .state,
        "removed"
    );

    app.change_planning_cycle(
        &scope(&store, &project),
        "op-close-after-deferral",
        &cycle_change(
            "cycle-1",
            "close",
            None,
            None,
            "Close reconciled cycle",
            true,
        ),
        "unix-ms:9",
    )
    .unwrap();
    assert_eq!(
        store
            .cycle_v3("p-cycle-readiness", "cycle-1")
            .unwrap()
            .unwrap()
            .lifecycle,
        "completed"
    );
    assert_eq!(
        store
            .read_project_status("p-cycle-readiness")
            .unwrap()
            .works[0]
            .work
            .lifecycle,
        PersistedLifecycle::Open
    );
}
