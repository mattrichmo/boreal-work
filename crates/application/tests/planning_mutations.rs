use boreal_application::WorkApplication;
use boreal_domain::{
    AcceptanceProfile, DispatchPolicy, PersistedLifecycle, ProjectId, WorkId, WorkItem, WorkKind,
};
use boreal_store::SqliteStore;

const SCHEMA: &str = include_str!("../../../project/spec/schema-v2.sql");

fn work(project: &ProjectId, id: &str) -> WorkItem {
    WorkItem {
        id: WorkId::new(id),
        project_id: project.clone(),
        kind: WorkKind::Task,
        parent_id: None,
        title: id.to_owned(),
        description: String::new(),
        lifecycle: PersistedLifecycle::Open,
        priority: 0,
        dispatch_policy: DispatchPolicy::Automatic,
        hard_holds: Vec::new(),
        acceptance_profile: AcceptanceProfile::focused(),
    }
}

#[test]
fn planning_mutations_are_revision_checked_audited_and_replayable() {
    let store = SqliteStore::open_in_memory(SCHEMA).unwrap();
    let app = WorkApplication::new(&store);
    let project = ProjectId::new("planning");
    app.init_project(
        &project, "operator", "operator", "test", "Operator", "t1", "op-init",
    )
    .unwrap();
    app.create_work_as(&work(&project, "a"), "operator", "t2", "op-a")
        .unwrap();
    app.create_work_as(&work(&project, "b"), "operator", "t3", "op-b")
        .unwrap();

    let revision = store.project_revision("planning").unwrap().0;
    let edited = app
        .edit_work_as(
            &project,
            "a",
            "operator",
            None,
            Some("renamed".to_owned()),
            Some("updated".to_owned()),
            Some(7),
            Some("operator_only".to_owned()),
            Some(revision),
            "t4",
            "op-edit",
        )
        .unwrap();
    assert!(edited.changed);
    assert_eq!(edited.value.title, "renamed");
    assert_eq!(edited.value.priority, 7);

    let hold_revision = edited.snapshot_revision;
    let held = app
        .add_work_hold_as(
            &project,
            "a",
            "review",
            "operator",
            Some(hold_revision),
            "t5",
            "op-hold",
        )
        .unwrap();
    assert_eq!(held.value.hard_holds.len(), 1);
    let hold = store
        .work_holds("a")
        .unwrap()
        .into_iter()
        .find(|row| row.resolved_at.is_none())
        .unwrap();

    let dependency_revision = held.snapshot_revision;
    let added = app
        .add_dependency_as(&project, "a", "b", "operator", "t6", "op-dependency")
        .unwrap();
    let removed = app
        .remove_dependency_as(
            &project,
            "a",
            "b",
            "operator",
            Some(added.snapshot_revision),
            "t7",
            "op-remove",
        )
        .unwrap();
    assert!(removed.changed);
    assert!(app.dependency_graph(&project).unwrap().edges.is_empty());

    let resolved = app
        .resolve_work_hold_as(
            &project,
            "a",
            &hold.hold_id,
            "review complete",
            "operator",
            Some(removed.snapshot_revision),
            "t8",
            "op-resolve",
        )
        .unwrap();
    assert!(resolved.value.hard_holds.is_empty());
    assert!(store.audit_event("op-edit").unwrap().is_some());
    assert!(store.audit_event("op-remove").unwrap().is_some());

    let replay = app
        .edit_work_as(
            &project,
            "a",
            "operator",
            None,
            Some("renamed".to_owned()),
            Some("updated".to_owned()),
            Some(7),
            Some("operator_only".to_owned()),
            Some(revision),
            "t4",
            "op-edit",
        )
        .unwrap();
    assert!(!replay.changed);
    assert!(app
        .edit_work_as(
            &project,
            "a",
            "operator",
            None,
            Some("stale".to_owned()),
            None,
            None,
            None,
            Some(revision),
            "t9",
            "op-stale"
        )
        .is_err());
    assert_eq!(dependency_revision + 1, added.snapshot_revision);
}
