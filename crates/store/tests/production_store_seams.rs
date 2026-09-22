//! Focused coverage for the bounded PF-S02-T02 store seams.
//!
//! All behavior assertions execute against the real public `boreal_store`
//! module exports and the schema-v2 SQLite adapter.  The transaction seam is
//! intentionally exercised through its non-owning root-mutation adapter so a
//! nested `BEGIN IMMEDIATE` path would fail this target.

use boreal_domain::{GateKind, GateState};
use boreal_store::{
    acceptance, execution, operations, profiles, transactions, EvidenceExecutionAdmissionRequest,
    GateStateUpdateRequest, SqliteStore, StoreError,
};

const SCHEMA: &str = include_str!("../../../project/spec/schema-v2.sql");

fn store() -> SqliteStore {
    SqliteStore::open_in_memory(SCHEMA).expect("schema opens")
}

fn initialized_store() -> SqliteStore {
    let store = store();
    store
        .initialize_project(
            "p1",
            "agent-1",
            "agent",
            "cred-agent",
            "Agent",
            "op-init",
            "sha256:op-init",
            "unix-ms:0",
        )
        .expect("project initializes");
    store
}

fn execution_store() -> SqliteStore {
    let store = initialized_store();
    store
        .execute_batch(
            "
            INSERT INTO session
              (session_id, actor_id, harness_id, state, started_at, ended_at)
            VALUES ('s1', 'agent-1', 'test-harness', 'active', 'unix-ms:0', NULL);
            INSERT INTO work_item
              (work_id, project_id, kind, lifecycle, dispatch_policy,
               acceptance_profile_id, acceptance_profile_version, title,
               description, created_at, updated_at)
            VALUES ('w1', 'p1', 'task', 'open', 'automatic',
                    'focused', 1, 'Seam work', '', 'unix-ms:0', 'unix-ms:0');
            INSERT INTO gate
              (gate_id, work_id, profile_id, profile_version, kind, required,
               state, subject_ref, updated_at)
            VALUES ('verification', 'w1', 'focused', 1, 'verification', 1,
                    'open', '', 'unix-ms:0');
            INSERT INTO attempt
              (attempt_id, work_id, actor_id, harness_id, session_id, fence,
               current, state, claimed_at, accepted_at, lease_deadline,
               max_attempt_deadline, review_required_after_expiry,
               config_identity, binary_identity, protocol_version, schema_version)
            VALUES ('a1', 'w1', 'agent-1', 'test-harness', 's1', 1,
                    1, 'running', 'unix-ms:0', 'unix-ms:0', 'unix-ms:2000',
                    'unix-ms:4000', 1, 'config-1', 'binary-1',
                    'boreal.protocol.envelope.v1', 2);
            ",
        )
        .expect("execution fixture inserts");
    store
}

fn gate_update_request(
    operation_id: &str,
    expected_project_revision: Option<u64>,
) -> GateStateUpdateRequest {
    GateStateUpdateRequest {
        project_id: "p1".to_owned(),
        work_id: "w1".to_owned(),
        gate_id: "verification".to_owned(),
        state: GateState::Satisfied,
        actor_id: "agent-1".to_owned(),
        session_id: Some("s1".to_owned()),
        operation_id: operation_id.to_owned(),
        request_digest: format!("sha256:{operation_id}"),
        expected_project_revision,
        updated_at: "unix-ms:1000".to_owned(),
    }
}

#[test]
fn qualified_root_adapter_delegates_to_one_root_mutation_boundary() {
    let store = execution_store();
    let initial = store.project_revision("p1").expect("initial revision").0;
    assert_eq!(initial, 1);

    let request = gate_update_request("op-gate", Some(initial));
    let result = transactions::with_root_mutation(&store, "p1", |root| root.update_gate(&request))
        .expect("root mutation commits");
    assert_eq!(result.revision, initial + 1);
    assert_eq!(
        store.project_revision("p1").unwrap().0,
        initial + 1,
        "the root mutation owns exactly one revision bump"
    );
    assert_eq!(
        acceptance::AcceptanceStore::new(&store)
            .gate("p1", "w1", "verification")
            .unwrap()
            .unwrap()
            .state,
        GateState::Satisfied
    );

    // A stale root mutation must take the root rollback path without leaving
    // a revision or gate change behind.  If the adapter opened a second
    // transaction, the first mutation above would have failed with a nested
    // BEGIN error before reaching this assertion.
    let stale = gate_update_request("op-gate-stale", Some(initial));
    let error =
        transactions::with_root_mutation(&store, "p1", |root| root.update_gate(&stale).map(|_| ()))
            .expect_err("stale root mutation rejects");
    assert_eq!(
        error,
        StoreError::StaleRevision {
            expected: initial,
            actual: initial + 1,
        }
    );
    assert_eq!(store.project_revision("p1").unwrap().0, initial + 1);
    assert_eq!(
        acceptance::AcceptanceStore::new(&store)
            .gate("p1", "w1", "verification")
            .unwrap()
            .unwrap()
            .state,
        GateState::Satisfied
    );
}

#[test]
fn profile_seam_validates_identity_and_definition_before_registration() {
    let store = initialized_store();
    let profile = profiles::ProfileVersion::new(
        "seam-profile",
        1,
        "sha256:04937b08e17caa0326307286452067bee4354acde865e7890753f8ad8a88bd4a",
        r#"{"gates":[{"kind":"verification","required":true}]}"#,
        "unix-ms:1",
    )
    .expect("valid profile");
    assert_eq!(profile.identity().profile_id, "seam-profile");
    profiles::ProfileStore::new(&store)
        .register(&profile)
        .expect("profile registers");

    let invalid = profiles::ProfileVersion::new("bad", 1, "sha256:bad", "not-json", "unix-ms:1")
        .expect_err("invalid profile JSON is rejected at the seam");
    assert!(matches!(invalid, StoreError::Invalid(message) if message.contains("not JSON")));

    let same = profile.identity();
    assert!(same.matches(&profile.identity()));
    assert!(!same.matches(&profiles::ProfileIdentity {
        profile_id: "seam-profile".to_owned(),
        version: 2,
        policy_digest: "sha256:04937b08e17caa0326307286452067bee4354acde865e7890753f8ad8a88bd4a"
            .to_owned(),
    }));
}

#[test]
fn operation_journal_appends_and_scopes_readback_to_the_project() {
    let store = execution_store();
    let request = gate_update_request("op-seam", Some(1));
    transactions::with_root_mutation(&store, "p1", |root| root.update_gate(&request))
        .expect("root operation bundle commits");

    let journal = operations::OperationJournal::new(&store);
    let readback = journal
        .readback("p1", "op-seam")
        .expect("operation readback")
        .expect("operation exists");
    assert_eq!(readback.operation.as_ref().unwrap().operation_id, "op-seam");
    assert_eq!(
        journal
            .audit_event("op-seam")
            .expect("audit readback")
            .unwrap()
            .event_type,
        "gate.satisfied"
    );

    store
        .initialize_project(
            "p2",
            "agent-2",
            "agent",
            "cred-agent-2",
            "Agent 2",
            "op-init-2",
            "sha256:op-init-2",
            "unix-ms:0",
        )
        .expect("second project initializes");
    assert!(matches!(
        journal.readback("p2", "op-seam"),
        Err(StoreError::WrongSubject { .. })
    ));
}

#[test]
fn execution_seam_preserves_admission_replay_and_lifecycle_states() {
    let store = execution_store();
    let request = EvidenceExecutionAdmissionRequest {
        operation_id: "op-exec".to_owned(),
        project_id: "p1".to_owned(),
        work_id: "w1".to_owned(),
        attempt_id: "a1".to_owned(),
        fence: 1,
        gate_id: "verification".to_owned(),
        actor_id: "agent-1".to_owned(),
        session_id: Some("s1".to_owned()),
        request_digest: "sha256:exec-request".to_owned(),
        artifact_ref: "artifact:exec".to_owned(),
        source_version_id: None,
        config_identity: "config-1".to_owned(),
        profile_id: "focused".to_owned(),
        profile_version: 1,
        admitted_at: "unix-ms:1000".to_owned(),
    };
    let executions = execution::ExecutionStore::new(&store);
    let admitted = executions.admit(&request).expect("execution admits");
    assert!(!admitted.replayed);
    assert_eq!(
        execution::ExecutionIdentity::from(&admitted.execution),
        execution::ExecutionIdentity {
            operation_id: "op-exec".to_owned(),
            project_id: "p1".to_owned(),
            work_id: "w1".to_owned(),
            attempt_id: "a1".to_owned(),
            fence: 1,
            artifact_ref: "artifact:exec".to_owned(),
        }
    );
    assert!(
        executions
            .admit(&request)
            .expect("execution replay")
            .replayed
    );

    assert_eq!(
        executions.start("op-exec", "unix-ms:1100").unwrap().state,
        boreal_store::EvidenceExecutionState::Running
    );
    let finished = executions
        .finish("op-exec", "unix-ms:1200", Some(0))
        .expect("execution finishes");
    assert_eq!(finished.state, boreal_store::EvidenceExecutionState::Exited);
    assert_eq!(finished.exit_code, Some(0));
    let unknown = executions
        .mark_unknown("op-exec", "readback_required")
        .expect("execution can be retained as unknown");
    assert_eq!(unknown.state, boreal_store::EvidenceExecutionState::Unknown);
    assert_eq!(unknown.failure_code.as_deref(), Some("readback_required"));
    assert_eq!(executions.incomplete().unwrap().len(), 1);
}

#[test]
fn acceptance_seam_reads_pinned_gate_and_exact_binding() {
    let store = execution_store();
    let acceptance = acceptance::AcceptanceStore::new(&store);
    let gate = acceptance
        .gate("p1", "w1", "verification")
        .expect("gate reads")
        .expect("gate exists");
    assert_eq!(gate.kind, GateKind::Verification);
    assert!(gate.required);
    let diagnostics = acceptance
        .diagnostics("p1", "w1", "a1", 1)
        .expect("gate diagnostics read");
    assert_eq!(diagnostics.missing, vec!["verification".to_owned()]);

    let binding = acceptance::AcceptanceBinding {
        project_id: "p1".to_owned(),
        work_id: "w1".to_owned(),
        attempt_id: "a1".to_owned(),
        fence: 1,
        source_version_id: None,
        config_identity: "config-1".to_owned(),
        profile_id: "focused".to_owned(),
        profile_version: 1,
    };
    assert!(binding.matches(&binding.clone()));
    let mut changed = binding.clone();
    changed.fence = 2;
    assert!(!binding.matches(&changed));
}
