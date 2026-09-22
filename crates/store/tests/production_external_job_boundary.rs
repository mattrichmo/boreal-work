//! Focused store-side authority checks for PF-S02-T11 corrective attempt 7.
//!
//! These tests cover the real SQLite job seam only. They do not claim
//! application, service, or external-process integration.

use boreal_store::{
    identity::{DatabaseIdentity, IdentityContext, IdentityStore, WorkspaceBinding},
    jobs::{ExternalJobInput, ExternalJobTransitionInput},
    operations::{OperationBundle, OperationJournal},
    AuditEventRecord, OperationOutcome, OperationRecord, SqliteStore, StoreError,
};

const PRODUCTION_SCHEMA: &str = include_str!("../../../project/spec/schema-production.sql");
const LEGACY_SCHEMA: &str = include_str!("../../../project/spec/schema-v2.sql");

fn binding() -> WorkspaceBinding {
    WorkspaceBinding::new(
        "/tmp/boreal-job-boundary",
        "/tmp/boreal-job-boundary",
        "sha256:job-boundary",
    )
    .expect("valid binding")
}

fn operation(subject_type: &str, subject_id: &str) -> (OperationRecord, AuditEventRecord) {
    let operation = OperationRecord {
        operation_id: "op-job-1".to_owned(),
        project_id: "p1".to_owned(),
        command: "external.verify".to_owned(),
        actor_id: "agent-1".to_owned(),
        session_id: Some("session-1".to_owned()),
        expected_revision: None,
        attempt_id: None,
        fence: None,
        request_digest: "sha256:job-request".to_owned(),
        outcome: OperationOutcome::Changed,
        result_json: r#"{"accepted":false}"#.to_owned(),
        revision: 1,
        created_at: "unix-ms:1".to_owned(),
        completed_at: Some("unix-ms:1".to_owned()),
    };
    let audit = AuditEventRecord {
        project_id: operation.project_id.clone(),
        revision: operation.revision,
        operation_id: operation.operation_id.clone(),
        event_type: "attempt.started".to_owned(),
        subject_type: subject_type.to_owned(),
        subject_id: subject_id.to_owned(),
        actor_id: operation.actor_id.clone(),
        session_id: operation.session_id.clone(),
        fence: operation.fence,
        as_of: operation.created_at.clone(),
        payload_json: operation.result_json.clone(),
    };
    (operation, audit)
}

fn bound_store(audit_subject: (&str, &str)) -> (SqliteStore, IdentityContext) {
    let store = SqliteStore::open_in_memory(PRODUCTION_SCHEMA).expect("production opens");
    store
        .create_project("p1", "unix-ms:0")
        .expect("project creates");
    store
        .ensure_actor("agent-1", "agent", "credential-1", "Agent 1", "unix-ms:0")
        .expect("actor creates");
    store
        .execute_batch(
            "INSERT INTO session
               (session_id, actor_id, harness_id, state, started_at, ended_at)
             VALUES ('session-1', 'agent-1', 'production-test', 'active', 'unix-ms:0', NULL)",
        )
        .expect("session creates");
    store
        .ensure_external_job_schema()
        .expect("job schema installs");
    IdentityStore::new(&store)
        .install(
            &DatabaseIdentity::new("database-job-1", 1).expect("database identity"),
            "unix-ms:1",
        )
        .expect("identity installs");
    let context = IdentityStore::new(&store)
        .bind_project("p1", &binding(), "unix-ms:1")
        .expect("project binds");
    let (operation, audit) = operation(audit_subject.0, audit_subject.1);
    store
        .execute_batch("BEGIN IMMEDIATE")
        .expect("transaction begins");
    OperationJournal::new(&store)
        .append_in_transaction_with_identity(
            &context,
            &OperationBundle::new(operation, Some(audit)),
        )
        .expect("operation and audit commit");
    store.execute_batch("COMMIT").expect("transaction commits");
    (store, context)
}

fn job_input(job_id: &str) -> ExternalJobInput {
    ExternalJobInput {
        job_id: job_id.to_owned(),
        operation_id: "op-job-1".to_owned(),
        project_id: "p1".to_owned(),
        subject_type: "project".to_owned(),
        subject_id: "p1".to_owned(),
        kind: "verify".to_owned(),
        request_digest: "sha256:job-request".to_owned(),
        source_identity: Some("sha256:source".to_owned()),
        config_identity: Some("sha256:config".to_owned()),
        actor_id: "agent-1".to_owned(),
        session_id: Some("session-1".to_owned()),
        deadline: Some("unix-ms:100".to_owned()),
        created_at: "unix-ms:2".to_owned(),
    }
}

fn transition(
    context: &IdentityContext,
    expected_stage: &str,
    next_stage: &str,
) -> ExternalJobTransitionInput {
    ExternalJobTransitionInput {
        project_id: context.project_id.clone(),
        job_id: "job-1".to_owned(),
        expected_stage: expected_stage.to_owned(),
        next_stage: next_stage.to_owned(),
        at: "unix-ms:3".to_owned(),
        side_effect_ref: None,
        result_digest: None,
        error_message: None,
    }
}

#[test]
fn bound_registration_replay_transition_and_identity_readback_are_attributable() {
    let (store, context) = bound_store(("project", "p1"));
    let first = store
        .register_external_job_with_identity(&context, &job_input("job-1"))
        .expect("bound registration");
    assert!(!first.replayed);

    let replay = store
        .register_external_job_with_identity(&context, &job_input("job-1"))
        .expect("identical replay");
    assert!(replay.replayed);
    assert_eq!(replay.job, first.job);

    for (from, to) in [
        ("registered", "admitted"),
        ("admitted", "running"),
        ("running", "side_effect_started"),
    ] {
        store
            .advance_external_job_with_identity(&context, &transition(&context, from, to))
            .expect("bound transition");
    }
    let marked = store
        .mark_external_job_readback_required_with_identity(
            &context,
            "job-1",
            "effect-1",
            "unix-ms:4",
        )
        .expect("readback marker");
    assert_eq!(marked.reconciliation_state, "required");
    assert!(!marked.stage.eq("committed"));
    assert_eq!(
        store
            .external_job_with_identity(&context, "job-1")
            .expect("identity readback")
            .expect("job exists")
            .side_effect_ref,
        Some("effect-1".to_owned())
    );
    assert!(matches!(
        store.external_job("p1", "job-1"),
        Err(StoreError::Conflict(message)) if message.contains("identity-bound API")
    ));
}

#[test]
fn legacy_methods_reject_canonical_unbound_and_bound_stores() {
    let store = SqliteStore::open_in_memory(PRODUCTION_SCHEMA).expect("production opens");
    store
        .create_project("p1", "unix-ms:0")
        .expect("project creates");
    store
        .ensure_external_job_schema()
        .expect("job schema installs");
    let error = store
        .register_external_job(&job_input("job-unbound"))
        .expect_err("canonical legacy registration must reject");
    assert!(
        matches!(error, StoreError::Conflict(message) if message.contains("identity-bound API"))
    );

    let (bound, _) = bound_store(("project", "p1"));
    assert!(matches!(
        bound.list_external_jobs("p1", None, 10),
        Err(StoreError::Conflict(message)) if message.contains("identity-bound API")
    ));

    let legacy = SqliteStore::open_in_memory(LEGACY_SCHEMA).expect("legacy opens");
    legacy
        .create_project("p1", "unix-ms:0")
        .expect("legacy project creates");
    legacy
        .ensure_external_job_schema()
        .expect("legacy job schema installs");
    assert!(
        !legacy
            .register_external_job(&job_input("job-legacy"))
            .expect("legacy registration")
            .replayed
    );
}

#[test]
fn registration_rejects_operation_audit_subject_actor_session_and_digest_drift_atomically() {
    let (store, context) = bound_store(("project", "other-project"));
    let error = store
        .register_external_job_with_identity(&context, &job_input("job-subject"))
        .expect_err("audit subject mismatch must reject");
    assert!(matches!(error, StoreError::WrongSubject { .. }));
    assert!(store
        .external_job_with_identity(&context, "job-subject")
        .expect("readback succeeds")
        .is_none());

    let (store, context) = bound_store(("project", "p1"));
    let mut actor_drift = job_input("job-actor");
    actor_drift.actor_id = "agent-2".to_owned();
    assert!(matches!(
        store.register_external_job_with_identity(&context, &actor_drift),
        Err(StoreError::WrongOwner { .. })
    ));
    let mut session_drift = job_input("job-session");
    session_drift.session_id = Some("session-2".to_owned());
    assert!(matches!(
        store.register_external_job_with_identity(&context, &session_drift),
        Err(StoreError::Conflict(message)) if message.contains("session identity")
    ));
    let mut digest_drift = job_input("job-digest");
    digest_drift.request_digest = "sha256:other-request".to_owned();
    assert!(matches!(
        store.register_external_job_with_identity(&context, &digest_drift),
        Err(StoreError::Conflict(message)) if message.contains("request digest")
    ));
    assert!(store
        .external_job_with_identity(&context, "job-actor")
        .expect("readback succeeds")
        .is_none());
}

#[test]
fn stale_lineage_and_transition_failure_roll_back_without_fabricating_progress() {
    let (store, context) = bound_store(("project", "p1"));
    store
        .register_external_job_with_identity(&context, &job_input("job-1"))
        .expect("registration");
    let error = store
        .advance_external_job_with_identity(
            &context,
            &transition(&context, "registered", "committed"),
        )
        .expect_err("illegal transition must reject");
    assert!(
        matches!(error, StoreError::Conflict(message) if message.contains("illegal external job transition"))
    );
    assert_eq!(
        store
            .external_job_with_identity(&context, "job-1")
            .expect("readback")
            .expect("job exists")
            .stage,
        "registered"
    );

    IdentityStore::new(&store)
        .restore("database-job-2", 2, "unix-ms:9")
        .expect("lineage advances");
    assert!(matches!(
        store.external_job_with_identity(&context, "job-1"),
        Err(StoreError::Conflict(message)) if message.contains("identity")
    ));
}
