use boreal_application::{SessionRegistrationRequest, WorkApplication};
use boreal_domain::{
    AcceptanceProfile, ActorId, DispatchPolicy, HarnessId, OperationId, PersistedLifecycle,
    ProjectId, SessionId, TimestampMs, WorkId, WorkItem, WorkKind,
};
use boreal_store::{SessionState, SqliteStore, StoreError};

const SCHEMA: &str = include_str!("../../../project/spec/schema-v2.sql");

fn work(project_id: &ProjectId) -> WorkItem {
    WorkItem {
        id: WorkId::new("w1"),
        project_id: project_id.clone(),
        kind: WorkKind::Task,
        parent_id: None,
        title: "Session-bound work".to_owned(),
        description: String::new(),
        lifecycle: PersistedLifecycle::Open,
        priority: 0,
        dispatch_policy: DispatchPolicy::Automatic,
        hard_holds: Vec::new(),
        acceptance_profile: AcceptanceProfile::focused(),
    }
}

fn setup() -> (&'static SqliteStore, WorkApplication<'static>) {
    // The store is deliberately leaked only for this small integration-test
    // fixture so the application façade can retain its borrowed contract.
    let store = Box::leak(Box::new(SqliteStore::open_in_memory(SCHEMA).unwrap()));
    let project = ProjectId::new("p1");
    store
        .initialize_project(
            "p1",
            "agent-1",
            "agent",
            "credential-1",
            "Agent",
            "op-init",
            "sha256:op-init",
            "unix-ms:0",
        )
        .unwrap();
    store
        .create_work_operation(
            &work(&project),
            "agent-1",
            "op-work",
            "sha256:op-work",
            "unix-ms:1",
        )
        .unwrap();
    (store, WorkApplication::new(store))
}

#[test]
fn application_registers_replays_and_claims_with_a_durable_session() {
    let (store, app) = setup();
    let request = SessionRegistrationRequest::new(
        ProjectId::new("p1"),
        SessionId::new("session-1"),
        ActorId::new("agent-1"),
        HarnessId::new("luna"),
        OperationId::new("op-session"),
        TimestampMs(2),
    );

    let registered = app.register_session(&request).unwrap();
    assert!(registered.changed);
    assert_eq!(registered.value.state, SessionState::Active);
    assert_eq!(registered.value.project_id, "p1");
    assert_eq!(registered.snapshot_revision, registered.value.revision);

    let replay = app.register_session(&request).unwrap();
    assert!(!replay.changed);
    assert_eq!(replay.snapshot_revision, registered.snapshot_revision);
    assert_eq!(replay.value, registered.value);

    let readback = app
        .session(&ProjectId::new("p1"), &SessionId::new("session-1"))
        .unwrap()
        .unwrap();
    assert_eq!(readback, registered.value);

    let claim = app
        .claim(
            &ProjectId::new("p1"),
            "w1",
            "agent-1",
            "luna",
            Some("session-1"),
            "attempt-1",
            "op-claim",
            "sha256:op-claim",
            None,
            "unix-ms:0000000000000003",
            "unix-ms:0000000001800003",
            "unix-ms:0000000007200003",
        )
        .unwrap();
    assert!(claim.changed);
    assert_eq!(
        store
            .current_attempt("p1", "attempt-1")
            .unwrap()
            .session_id
            .as_deref(),
        Some("session-1")
    );
}

#[test]
fn application_claim_surfaces_session_ownership_errors() {
    let (_store, app) = setup();
    app.register_session_as(
        &ProjectId::new("p1"),
        "agent-1",
        "luna",
        "session-1",
        "unix-ms:2",
        "op-session",
    )
    .unwrap();

    let error = app
        .claim(
            &ProjectId::new("p1"),
            "w1",
            "agent-1",
            "other-harness",
            Some("session-1"),
            "attempt-bad",
            "op-claim-bad",
            "sha256:op-claim-bad",
            None,
            "unix-ms:0000000000000003",
            "unix-ms:0000000001800003",
            "unix-ms:0000000007200003",
        )
        .unwrap_err();
    assert!(matches!(
        error,
        boreal_application::ApplicationError::Store(StoreError::WrongOwner { .. })
    ));
}
