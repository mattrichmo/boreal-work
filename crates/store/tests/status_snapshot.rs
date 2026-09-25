use boreal_domain::{AcceptanceProfile, GateState, WorkItem, WorkKind};
use boreal_store::identity::{DatabaseIdentity, IdentityStore, WorkspaceBinding};
use boreal_store::{GateStateUpdateRequest, SessionRegistrationRequest, SqliteStore, StoreError};

const SCHEMA: &str = include_str!("../../../project/spec/schema-v2.sql");
const PRODUCTION_SCHEMA: &str = include_str!("../../../project/spec/schema-production.sql");

fn store() -> SqliteStore {
    SqliteStore::open_in_memory(SCHEMA).expect("schema opens")
}

fn work(project_id: &str, id: &str) -> WorkItem {
    WorkItem::new(project_id.into(), id.into(), WorkKind::Task, None, id).open()
}

#[test]
fn project_status_read_is_revisioned_and_contains_graph_attempt_and_gates() {
    let store = store();
    store
        .initialize_project(
            "p1",
            "agent-1",
            "agent",
            "credential",
            "Agent",
            "op-init",
            "sha256:op-init",
            "unix-ms:0",
        )
        .unwrap();
    store
        .create_work_operation(
            &work("p1", "w1"),
            "agent-1",
            "op-w1",
            "sha256:op-w1",
            "unix-ms:1",
        )
        .unwrap();
    store
        .create_work_operation(
            &work("p1", "w2"),
            "agent-1",
            "op-w2",
            "sha256:op-w2",
            "unix-ms:2",
        )
        .unwrap();
    store
        .add_dependency_operation(
            "p1",
            "w1",
            "w2",
            "agent-1",
            "op-dependency",
            "sha256:op-dependency",
            "unix-ms:3",
        )
        .unwrap();
    assert_eq!(
        store
            .operation("op-dependency")
            .unwrap()
            .unwrap()
            .expected_revision,
        Some(3)
    );
    store
        .claim_work(
            "p1",
            "w1",
            "agent-1",
            "luna",
            None,
            "attempt-1",
            "op-claim",
            "sha256:op-claim",
            None,
            "unix-ms:0000000000000004",
            "unix-ms:0000000001800004",
            "unix-ms:0000000007200004",
        )
        .unwrap();
    store
        .update_gate_state(GateStateUpdateRequest {
            project_id: "p1".into(),
            work_id: "w2".into(),
            gate_id: store.gate_id_for_work("p1", "w2", "checkpoint").unwrap(),
            state: GateState::Failed,
            actor_id: "agent-1".into(),
            session_id: None,
            operation_id: "op-gate".into(),
            request_digest: "sha256:op-gate".into(),
            expected_project_revision: None,
            updated_at: "unix-ms:5".into(),
        })
        .unwrap();

    let before = store.project_revision("p1").unwrap();
    let snapshot = store.read_project_status("p1").unwrap();
    assert_eq!(snapshot.project_id.as_str(), "p1");
    assert_eq!(snapshot.revision, before);
    assert_eq!(snapshot.total, 2);
    assert_eq!(snapshot.works.len(), 2);
    assert_eq!(snapshot.dependencies.len(), 1);
    assert_eq!(snapshot.dependencies[0].prerequisite_id.as_str(), "w1");
    assert_eq!(snapshot.dependencies[0].dependent_id.as_str(), "w2");

    let w1 = snapshot
        .works
        .iter()
        .find(|row| row.work.id.as_str() == "w1")
        .unwrap();
    assert_eq!(w1.current_attempt.as_ref().unwrap().attempt_id, "attempt-1");
    assert_eq!(w1.gate_diagnostics.gates.len(), 3);

    let w2 = snapshot
        .works
        .iter()
        .find(|row| row.work.id.as_str() == "w2")
        .unwrap();
    assert_eq!(w2.gate_diagnostics.missing.len(), 3);
    assert_eq!(w2.gate_diagnostics.gates[0].state, GateState::Failed);
    assert_eq!(store.project_revision("p1").unwrap(), before);

    assert_eq!(w1.work.acceptance_profile.id.as_str(), "focused");
    assert_eq!(w1.work.acceptance_profile.version, "1");
    assert_eq!(w1.work.acceptance_profile.gates.len(), 3);
    assert_eq!(w1.work.acceptance_profile.gates[0].state, GateState::Open);
    assert_eq!(AcceptanceProfile::focused().gates.len(), 3);
}

#[test]
fn malformed_work_row_is_reported_without_hiding_healthy_rows() {
    let store = store();
    store
        .initialize_project(
            "p1",
            "agent-1",
            "agent",
            "credential",
            "Agent",
            "op-init",
            "sha256:op-init",
            "unix-ms:0",
        )
        .unwrap();
    for (id, operation) in [("healthy", "op-healthy"), ("broken", "op-broken")] {
        store
            .create_work_operation(
                &work("p1", id),
                "agent-1",
                operation,
                &format!("sha256:{operation}"),
                "unix-ms:1",
            )
            .unwrap();
    }
    store
        .execute_batch(
            "DROP TRIGGER work_parent_retype_guard;
             PRAGMA ignore_check_constraints = ON;
             UPDATE work_item SET kind = 'not-a-work-kind' WHERE work_id = 'broken';
             PRAGMA ignore_check_constraints = OFF;",
        )
        .unwrap();

    let snapshot = store.read_project_status("p1").unwrap();
    assert_eq!(snapshot.total, 2);
    assert_eq!(snapshot.works.len(), 1);
    assert_eq!(snapshot.works[0].work.id.as_str(), "healthy");
    assert_eq!(snapshot.diagnostics.len(), 1);
    assert_eq!(snapshot.diagnostics[0].work_id, "broken");
    assert_eq!(snapshot.diagnostics[0].code, "corrupt_record");
}

#[test]
fn canonical_claim_rejects_mismatched_dependency_context_without_writing() {
    let store = SqliteStore::open_in_memory(PRODUCTION_SCHEMA).expect("production schema opens");
    let database =
        DatabaseIdentity::new("status-snapshot-database", 1).expect("database identity is valid");
    IdentityStore::new(&store)
        .install(&database, "unix-ms:1")
        .expect("database identity installs");
    let binding = WorkspaceBinding::new(
        "/tmp/boreal-status-snapshot-paired",
        "/tmp/boreal-status-snapshot-paired",
        "sha256:status-snapshot-paired",
    )
    .expect("workspace binding is valid");
    store
        .initialize_project_with_workspace(
            "p1",
            "operator-1",
            "operator",
            "boreal-key-v1:sha256:status-snapshot-credential",
            "Operator",
            "op-init-paired",
            "sha256:op-init-paired",
            &database,
            &binding,
            "unix-ms:1",
        )
        .expect("identity-bound project initializes");
    store
        .register_session(SessionRegistrationRequest {
            project_id: "p1".into(),
            session_id: "session-1".into(),
            actor_id: "operator-1".into(),
            harness_id: "test".into(),
            operation_id: "op-session-1".into(),
            request_digest: "sha256:op-session-1".into(),
            expected_project_revision: Some(store.project_revision("p1").unwrap().0),
            started_at: "unix-ms:2".into(),
        })
        .expect("project session registers");

    for (work_id, operation_id, at) in [
        ("broken-prerequisite", "op-create-prerequisite", "unix-ms:3"),
        ("dependent", "op-create-dependent", "unix-ms:4"),
    ] {
        let revision = store.project_revision("p1").unwrap().0;
        store
            .create_work_operation_for_session(
                &work("p1", work_id),
                "operator-1",
                Some("session-1"),
                operation_id,
                &format!("sha256:{operation_id}"),
                Some(revision),
                at,
            )
            .expect("canonical work creates");
    }
    store
        .add_dependency_operation_checked(
            "p1",
            "broken-prerequisite",
            "dependent",
            "operator-1",
            "op-dependency-paired",
            "sha256:op-dependency-paired",
            Some(store.project_revision("p1").unwrap().0),
            "unix-ms:5",
        )
        .expect("dependency creates");

    // Preserve the dependency edge while making its endpoint unreadable as a
    // work item. The status snapshot quarantines that endpoint, while the
    // canonical fact reader still observes the persisted edge. Those two
    // representations must not be silently combined for a mutation.
    store
        .execute_batch(
            "DROP TRIGGER work_parent_retype_guard;
             PRAGMA ignore_check_constraints = ON;
             UPDATE work_item SET kind = 'not-a-work-kind'
              WHERE project_id = 'p1' AND work_id = 'broken-prerequisite';
             PRAGMA ignore_check_constraints = OFF;",
        )
        .expect("corrupt endpoint fixture applies");

    let error = store
        .claim_work(
            "p1",
            "dependent",
            "operator-1",
            "test",
            Some("session-1"),
            "attempt-context-mismatch",
            "op-claim-context-mismatch",
            "sha256:op-claim-context-mismatch",
            None,
            "unix-ms:6",
            "unix-ms:100",
            "unix-ms:200",
        )
        .expect_err("canonical claim must reject the mismatched paired context");
    assert!(
        matches!(&error, StoreError::Corrupt(message)
            if message.contains("canonical status/action context validation failed")
                && message.contains("Dependencies")),
        "unexpected canonical decision error: {error:?}"
    );
    assert!(store
        .operation("op-claim-context-mismatch")
        .expect("claim readback succeeds")
        .is_none());
    assert!(matches!(
        store.current_attempt("p1", "attempt-context-mismatch"),
        Err(StoreError::NotFound { .. })
    ));
}
