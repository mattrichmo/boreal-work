//! Bounded PF-S02-T10/PF-S13-T02 coverage for the production identity/audit
//! boundary.  These tests do not claim application or service integration.

use boreal_store::{
    identity::{DatabaseIdentity, IdentityStore, WorkspaceBinding},
    operations::{OperationBundle, OperationJournal},
    AuditEventRecord, OperationOutcome, OperationRecord, SqliteStore, StoreError,
};

const PRODUCTION_SCHEMA: &str = include_str!("../../../project/spec/schema-production.sql");
const LEGACY_SCHEMA: &str = include_str!("../../../project/spec/schema-v2.sql");

fn operation(project_id: &str, operation_id: &str, actor_id: &str) -> OperationRecord {
    OperationRecord {
        operation_id: operation_id.to_owned(),
        project_id: project_id.to_owned(),
        command: "project.init".to_owned(),
        actor_id: actor_id.to_owned(),
        session_id: None,
        expected_revision: None,
        attempt_id: None,
        fence: None,
        request_digest: format!("sha256:{operation_id}"),
        outcome: OperationOutcome::Changed,
        result_json: r#"{"project_id":"p1"}"#.to_owned(),
        revision: 1,
        created_at: "unix-ms:1".to_owned(),
        completed_at: Some("unix-ms:1".to_owned()),
    }
}

fn audit(operation: &OperationRecord) -> AuditEventRecord {
    AuditEventRecord {
        project_id: operation.project_id.clone(),
        revision: operation.revision,
        operation_id: operation.operation_id.clone(),
        event_type: "work.created".to_owned(),
        subject_type: "project".to_owned(),
        subject_id: operation.project_id.clone(),
        actor_id: operation.actor_id.clone(),
        session_id: operation.session_id.clone(),
        fence: operation.fence,
        as_of: operation.created_at.clone(),
        payload_json: operation.result_json.clone(),
    }
}

fn binding() -> WorkspaceBinding {
    WorkspaceBinding::new(
        "/tmp/boreal-boundary",
        "/tmp/boreal-boundary",
        "sha256:boundary-binding",
    )
    .expect("binding is valid")
}

#[test]
fn unbound_canonical_production_rejects_consequential_operation_writes() {
    let store = SqliteStore::open_in_memory(PRODUCTION_SCHEMA).expect("production schema opens");
    store
        .create_project("p1", "unix-ms:0")
        .expect("project fixture creates");

    let requested = operation("p1", "op-unbound", "agent-1");
    let error = store
        .append_operation(&requested)
        .expect_err("unbound production operation must fail closed");
    assert!(
        matches!(error, StoreError::Conflict(message) if message.contains("requires a workspace identity binding"))
    );
    assert!(!store
        .operation_exists(&requested.operation_id)
        .expect("operation lookup succeeds"));

    let fresh = SqliteStore::open_in_memory(PRODUCTION_SCHEMA).expect("fresh production opens");
    let error = fresh
        .initialize_project(
            "p2",
            "agent-1",
            "agent",
            "credential-1",
            "Agent",
            "op-init-unbound",
            "sha256:op-init-unbound",
            "unix-ms:0",
        )
        .expect_err("unbound production initialization must not bypass identity");
    assert!(
        matches!(error, StoreError::Conflict(message) if message.contains("requires a workspace identity binding"))
    );
    assert!(fresh
        .list_project_ids()
        .expect("project discovery succeeds")
        .is_empty());
    assert!(!fresh
        .operation_exists("op-init-unbound")
        .expect("operation lookup succeeds"));
}

#[test]
fn bound_canonical_production_replay_returns_the_original_outcome() {
    let store = SqliteStore::open_in_memory(PRODUCTION_SCHEMA).expect("production schema opens");
    store
        .create_project("p1", "unix-ms:0")
        .expect("project fixture creates");
    store
        .ensure_actor("agent-1", "agent", "credential-1", "Agent 1", "unix-ms:0")
        .expect("actor fixture creates");
    IdentityStore::new(&store)
        .install(
            &DatabaseIdentity::new("database-boundary", 1).expect("database identity is valid"),
            "unix-ms:1",
        )
        .expect("controlled database identity installs");
    let context = IdentityStore::new(&store)
        .bind_project("p1", &binding(), "unix-ms:1")
        .expect("project binds");
    let original = operation("p1", "op-replay", "agent-1");
    let bundle = OperationBundle::new(original.clone(), Some(audit(&original)));

    store
        .execute_batch("BEGIN IMMEDIATE")
        .expect("transaction begins");
    OperationJournal::new(&store)
        .append_in_transaction_with_identity(&context, &bundle)
        .expect("original operation commits");
    store.execute_batch("COMMIT").expect("transaction commits");

    let replay = store
        .initialize_project(
            "p1",
            "agent-1",
            "agent",
            "credential-1",
            "Agent",
            "op-replay",
            "sha256:op-replay",
            "unix-ms:2",
        )
        .expect("bound initialization replays");
    assert!(replay.replayed);
    assert_eq!(replay.revision, original.revision);
    assert_eq!(store.operation("op-replay").unwrap(), Some(original));
    assert_eq!(
        store.audit_event("op-replay").unwrap().unwrap().event_type,
        "work.created"
    );
}

#[test]
fn initialization_audits_creation_replays_exactly_and_treats_existing_project_as_readback() {
    let store = SqliteStore::open_in_memory(LEGACY_SCHEMA).expect("legacy schema opens");
    let first = store
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
        .expect("initialization commits");
    assert!(!first.replayed);
    assert_eq!(
        store.audit_event("op-init").unwrap().unwrap().event_type,
        "work.created"
    );

    let replay = store
        .initialize_project(
            "p1",
            "agent-1",
            "agent",
            "credential-1",
            "Agent",
            "op-init",
            "sha256:op-init",
            "unix-ms:10",
        )
        .expect("same initialization replays");
    assert!(replay.replayed);
    assert_eq!(replay.revision, first.revision);
    assert_eq!(
        store.audit_event("op-init").unwrap().unwrap().revision,
        first.revision
    );

    let readback = store
        .initialize_project(
            "p1",
            "agent-1",
            "agent",
            "credential-1",
            "Agent",
            "op-existing-project",
            "sha256:op-existing-project",
            "unix-ms:20",
        )
        .expect("existing project is a safe readback");
    assert!(readback.replayed);
    assert_eq!(readback.revision, first.revision);
    assert!(store
        .operation("op-existing-project")
        .expect("operation lookup succeeds")
        .is_none());
    assert!(store
        .audit_event("op-existing-project")
        .expect("audit lookup succeeds")
        .is_none());
}
