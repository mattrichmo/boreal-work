use boreal_domain::{AcceptanceProfile, GateState, WorkItem, WorkKind};
use boreal_store::{GateStateUpdateRequest, SqliteStore};

const SCHEMA: &str = include_str!("../../../project/spec/schema-v2.sql");

fn store() -> SqliteStore {
    SqliteStore::open_in_memory(SCHEMA).expect("schema opens")
}

fn work(project_id: &str, id: &str) -> WorkItem {
    WorkItem::new(project_id.into(), id.into(), WorkKind::Milestone, None, id).open()
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
