use boreal_application::project_status_from_store;
use boreal_domain::{
    ActorContext, ActorRole, DerivedStatus, DispatchPolicy, ReasonCode, TimestampMs, WorkItem,
    WorkKind,
};
use boreal_store::SqliteStore;

const SCHEMA: &str = include_str!("../../../project/spec/schema-v2.sql");

#[test]
fn stored_actor_role_overrides_untrusted_status_context_role() {
    let store = SqliteStore::open_in_memory(SCHEMA).unwrap();
    store
        .initialize_project(
            "p",
            "agent",
            "agent",
            "cred",
            "Agent",
            "init",
            "digest:init",
            "unix-ms:0",
        )
        .unwrap();
    store
        .ensure_actor(
            "operator",
            "operator",
            "cred:operator",
            "Operator",
            "unix-ms:0",
        )
        .unwrap();
    let mut work = WorkItem::new("p".into(), "task".into(), WorkKind::Task, None, "Task").open();
    work.dispatch_policy = DispatchPolicy::OperatorOnly;
    store
        .create_work_operation(&work, "agent", "create", "digest:create", "unix-ms:1")
        .unwrap();
    let spoofed = ActorContext {
        actor_id: "agent".into(),
        role: ActorRole::Operator,
    };
    let agent =
        project_status_from_store(&store, &"p".into(), &spoofed, TimestampMs(10), 100, 0).unwrap();
    assert_eq!(agent.items[0].display_status(), DerivedStatus::Ready);
    assert!(!agent.items[0].decision.claimable_for_actor);
    let operator = ActorContext {
        actor_id: "operator".into(),
        role: ActorRole::Agent,
    };
    let operator =
        project_status_from_store(&store, &"p".into(), &operator, TimestampMs(10), 100, 0).unwrap();
    assert!(operator.items[0].decision.claimable_for_actor);
    assert_eq!(operator.project_revision, agent.project_revision);
    let unknown = ActorContext {
        actor_id: "unregistered".into(),
        role: ActorRole::Operator,
    };
    assert!(
        project_status_from_store(&store, &"p".into(), &unknown, TimestampMs(10), 100, 0).is_err()
    );
}

#[test]
fn store_backed_pause_preserves_dependency_and_timer_reasons() {
    let store = SqliteStore::open_in_memory(SCHEMA).unwrap();
    store
        .initialize_project(
            "p",
            "agent",
            "agent",
            "cred",
            "Agent",
            "init",
            "digest:init",
            "unix-ms:0",
        )
        .unwrap();
    for id in ["upstream", "dependent"] {
        let mut work = WorkItem::new("p".into(), id.into(), WorkKind::Task, None, id).open();
        if id == "dependent" {
            work.dispatch_policy = DispatchPolicy::Paused;
        }
        store
            .create_work_operation(
                &work,
                "agent",
                &format!("create:{id}"),
                &format!("digest:{id}"),
                "unix-ms:1",
            )
            .unwrap();
    }
    store
        .add_dependency_operation(
            "p",
            "upstream",
            "dependent",
            "agent",
            "edge",
            "digest:edge",
            "unix-ms:2",
        )
        .unwrap();
    store
        .execute_batch(
            "UPDATE work_item SET retry_not_before = 'unix-ms:50' WHERE work_id = 'dependent'",
        )
        .unwrap();
    let actor = ActorContext {
        actor_id: "agent".into(),
        role: ActorRole::Agent,
    };
    let snapshot =
        project_status_from_store(&store, &"p".into(), &actor, TimestampMs(10), 100, 0).unwrap();
    let work = snapshot
        .items
        .iter()
        .find(|item| item.work.id.as_str() == "dependent")
        .unwrap();
    assert_eq!(work.display_status(), DerivedStatus::Paused);
    assert_eq!(work.decision.primary_reason, ReasonCode::Paused);
    assert!(work
        .decision
        .reason_codes
        .contains(&ReasonCode::PrerequisiteOpen("upstream".into())));
    assert_eq!(work.decision.next_status_change_at, Some(TimestampMs(50)));
    assert_eq!(snapshot.next_status_change_at, Some(TimestampMs(50)));
}
