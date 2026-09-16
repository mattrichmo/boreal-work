use boreal_domain::{
    AcceptanceProfile, DispatchPolicy, PersistedLifecycle, ProjectId, WorkId, WorkItem, WorkKind,
};
use boreal_store::{SessionRegistrationRequest, SessionState, SqliteStore, StoreError};

const SCHEMA: &str = include_str!("../../../project/spec/schema-v2.sql");

fn initialized_store(project_id: &str) -> SqliteStore {
    let store = SqliteStore::open_in_memory(SCHEMA).unwrap();
    store
        .initialize_project(
            project_id,
            "agent-1",
            "agent",
            "credential-1",
            "Agent",
            &format!("init-{project_id}"),
            &format!("sha256:init-{project_id}"),
            "unix-ms:0",
        )
        .unwrap();
    store
}

fn registration(project_id: &str) -> SessionRegistrationRequest {
    SessionRegistrationRequest {
        project_id: project_id.to_owned(),
        session_id: "session-1".to_owned(),
        actor_id: "agent-1".to_owned(),
        harness_id: "luna".to_owned(),
        operation_id: format!("session-register-{project_id}"),
        request_digest: format!("sha256:session-register-{project_id}"),
        expected_project_revision: None,
        started_at: "unix-ms:1".to_owned(),
    }
}

#[test]
fn registration_is_revisioned_audited_and_idempotently_replayed() {
    let store = initialized_store("p1");
    let request = registration("p1");

    let first = store.register_session(&request).unwrap();
    assert!(!first.replayed);
    assert_eq!(first.revision, 2);
    assert_eq!(first.session.project_id, "p1");
    assert_eq!(first.session.session_id, "session-1");
    assert_eq!(first.session.actor_id, "agent-1");
    assert_eq!(first.session.harness_id, "luna");
    assert_eq!(first.session.state, SessionState::Active);
    assert_eq!(
        first.session.registration_operation_id.as_deref(),
        Some("session-register-p1")
    );

    let replay = store.register_session(&request).unwrap();
    assert!(replay.replayed);
    assert_eq!(replay.revision, first.revision);
    assert_eq!(replay.session, first.session);
    assert_eq!(store.project_revision("p1").unwrap().0, first.revision);

    let operation = store.operation("session-register-p1").unwrap().unwrap();
    assert_eq!(operation.command, "session.register");
    assert_eq!(operation.session_id.as_deref(), Some("session-1"));
    let audit = store.audit_event("session-register-p1").unwrap().unwrap();
    assert_eq!(audit.event_type, "repair.correction");
    assert_eq!(audit.session_id.as_deref(), Some("session-1"));
    assert!(audit.payload_json.contains("session.registered"));
}

#[test]
fn registration_and_claim_enforce_actor_harness_and_project_scope() {
    let store = initialized_store("p1");
    store
        .ensure_actor("agent-2", "agent", "credential-2", "Agent 2", "unix-ms:0")
        .unwrap();
    let request = registration("p1");
    store.register_session(&request).unwrap();

    let wrong_actor = store
        .session_for_claim("p1", "session-1", "agent-2", "luna")
        .unwrap_err();
    assert!(matches!(wrong_actor, StoreError::WrongOwner { .. }));

    let wrong_harness = store
        .session_for_claim("p1", "session-1", "agent-1", "other-harness")
        .unwrap_err();
    assert!(matches!(wrong_harness, StoreError::WrongOwner { .. }));

    store
        .initialize_project(
            "p2",
            "agent-1",
            "agent",
            "credential-1",
            "Agent",
            "init-p2",
            "sha256:init-p2",
            "unix-ms:0",
        )
        .unwrap();
    let wrong_project = store.session("p2", "session-1").unwrap_err();
    assert!(matches!(wrong_project, StoreError::WrongSubject { .. }));

    let work = WorkItem {
        id: WorkId::new("w1"),
        project_id: ProjectId::new("p1"),
        kind: WorkKind::Task,
        parent_id: None,
        title: "Session-bound claim".to_owned(),
        description: String::new(),
        lifecycle: PersistedLifecycle::Open,
        priority: 0,
        dispatch_policy: DispatchPolicy::Automatic,
        hard_holds: Vec::new(),
        acceptance_profile: AcceptanceProfile::focused(),
    };
    store
        .create_work_operation(&work, "agent-1", "work-w1", "sha256:work-w1", "unix-ms:2")
        .unwrap();

    let mismatch = store.claim_work(
        "p1",
        "w1",
        "agent-1",
        "other-harness",
        Some("session-1"),
        "attempt-bad",
        "claim-bad",
        "sha256:claim-bad",
        None,
        "unix-ms:0000000000000003",
        "unix-ms:0000000001800003",
        "unix-ms:0000000007200003",
    );
    assert!(matches!(mismatch, Err(StoreError::WrongOwner { .. })));

    let claim = store
        .claim_work(
            "p1",
            "w1",
            "agent-1",
            "luna",
            Some("session-1"),
            "attempt-1",
            "claim-1",
            "sha256:claim-1",
            None,
            "unix-ms:0000000000000003",
            "unix-ms:0000000001800003",
            "unix-ms:0000000007200003",
        )
        .unwrap();
    assert!(!claim.replayed);
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
fn claim_rejects_unknown_or_inactive_session_before_writing_attempt() {
    let store = initialized_store("p1");
    let work = WorkItem {
        id: WorkId::new("w1"),
        project_id: ProjectId::new("p1"),
        kind: WorkKind::Task,
        parent_id: None,
        title: "Session validation".to_owned(),
        description: String::new(),
        lifecycle: PersistedLifecycle::Open,
        priority: 0,
        dispatch_policy: DispatchPolicy::Automatic,
        hard_holds: Vec::new(),
        acceptance_profile: AcceptanceProfile::focused(),
    };
    store
        .create_work_operation(&work, "agent-1", "work-w1", "sha256:work-w1", "unix-ms:1")
        .unwrap();

    let missing = store.claim_work(
        "p1",
        "w1",
        "agent-1",
        "luna",
        Some("missing"),
        "a1",
        "c1",
        "sha256:c1",
        None,
        "unix-ms:0000000000000002",
        "unix-ms:0000000001800002",
        "unix-ms:0000000007200002",
    );
    assert!(matches!(
        missing,
        Err(StoreError::NotFound {
            entity: "session",
            ..
        })
    ));
    assert!(store.current_attempt("p1", "a1").is_err());
}
