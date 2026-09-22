//! Focused PF-S02-T07 checks for durable operation identity and audit safety.
//!
//! These tests exercise the real SQLite store and caller-owned transaction
//! boundary. They do not claim service, crash/restart, or release evidence.

use boreal_store::{
    identity::{DatabaseIdentity, IdentityContext, IdentityStore, WorkspaceBinding},
    operations::{OperationBundle, OperationIdentity, OperationJournal, OperationRegistration},
    AuditEventRecord, OperationOutcome, OperationRecord, SqliteStore, StoreError,
};

const SCHEMA: &str = include_str!("../../../project/spec/schema-v2.sql");

fn initialized_store() -> (SqliteStore, boreal_store::identity::IdentityContext) {
    let store = SqliteStore::open_in_memory(SCHEMA).expect("schema opens");
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
        .expect("project initializes");
    store
        .execute_batch(
            "INSERT INTO session
               (session_id, actor_id, harness_id, state, started_at, ended_at)
             VALUES ('session-1', 'agent-1', 'production-test', 'active', 'unix-ms:0', NULL)",
        )
        .expect("session inserts");
    let identities = IdentityStore::new(&store);
    identities
        .install(
            &DatabaseIdentity::new("database-1", 1).expect("valid database identity"),
            "unix-ms:1",
        )
        .expect("identity tables install");
    let binding = WorkspaceBinding::new("/tmp/boreal-p1", "/tmp/boreal-p1", "sha256:binding-1")
        .expect("valid binding");
    let context = identities
        .bind_project("p1", &binding, "unix-ms:2")
        .expect("project binds");
    (store, context)
}

fn dependency_store() -> SqliteStore {
    let (store, _context) = initialized_store();
    store
        .execute_batch(
            "INSERT INTO work_item
               (work_id, project_id, kind, lifecycle, dispatch_policy,
                acceptance_profile_id, acceptance_profile_version, title,
                description, created_at, updated_at)
             VALUES
               ('prerequisite', 'p1', 'task', 'open', 'automatic',
                'focused', 1, 'Prerequisite', '', 'unix-ms:3', 'unix-ms:3'),
               ('dependent', 'p1', 'task', 'open', 'automatic',
                'focused', 1, 'Dependent', '', 'unix-ms:3', 'unix-ms:3')",
        )
        .expect("dependency targets insert");
    store
}

fn operation(
    operation_id: &str,
    outcome: OperationOutcome,
    revision: u64,
    actor_id: &str,
    request_digest: &str,
    completed_at: Option<&str>,
) -> OperationRecord {
    OperationRecord {
        operation_id: operation_id.to_owned(),
        project_id: "p1".to_owned(),
        command: "work.block".to_owned(),
        actor_id: actor_id.to_owned(),
        session_id: Some("session-1".to_owned()),
        expected_revision: Some(1),
        attempt_id: None,
        fence: None,
        request_digest: request_digest.to_owned(),
        outcome,
        result_json: r#"{"reason":"operator hold"}"#.to_owned(),
        revision,
        created_at: "unix-ms:10".to_owned(),
        completed_at: completed_at.map(str::to_owned),
    }
}

fn audit(operation_id: &str, revision: u64, actor_id: &str, payload: &str) -> AuditEventRecord {
    AuditEventRecord {
        project_id: "p1".to_owned(),
        revision,
        operation_id: operation_id.to_owned(),
        event_type: "work.blocked".to_owned(),
        subject_type: "work".to_owned(),
        subject_id: "work-1".to_owned(),
        actor_id: actor_id.to_owned(),
        session_id: Some("session-1".to_owned()),
        fence: None,
        as_of: "unix-ms:10".to_owned(),
        payload_json: payload.to_owned(),
    }
}

fn commit_bundle(
    store: &SqliteStore,
    context: &boreal_store::identity::IdentityContext,
    bundle: &OperationBundle,
) -> Result<(), StoreError> {
    store.execute_batch("BEGIN IMMEDIATE")?;
    let result = OperationJournal::new(store).append_in_transaction_with_identity(context, bundle);
    match result {
        Ok(()) => store.execute_batch("COMMIT"),
        Err(error) => {
            let _ = store.execute_batch("ROLLBACK");
            Err(error)
        }
    }
}

fn register_or_replay(
    store: &SqliteStore,
    context: &boreal_store::identity::IdentityContext,
    bundle: &OperationBundle,
) -> Result<OperationRegistration, StoreError> {
    store.execute_batch("BEGIN IMMEDIATE")?;
    let result = OperationJournal::new(store)
        .register_or_replay_in_transaction_with_identity(context, bundle);
    match result {
        Ok(result) => {
            store.execute_batch("COMMIT")?;
            Ok(result)
        }
        Err(error) => {
            let _ = store.execute_batch("ROLLBACK");
            Err(error)
        }
    }
}

#[test]
fn crash_after_commit_before_response_replays_one_operation_and_audit() {
    let (store, context) = initialized_store();
    let bundle = OperationBundle::new(
        operation(
            "op-replay",
            OperationOutcome::Changed,
            2,
            "agent-1",
            "sha256:request-1",
            Some("unix-ms:11"),
        ),
        Some(audit(
            "op-replay",
            2,
            "agent-1",
            r#"{"message":"blocked","token":"do-not-store"}"#,
        )),
    );
    commit_bundle(&store, &context, &bundle).expect("bundle commits");

    let journal = OperationJournal::new(&store);
    let identity = OperationIdentity::from_record(
        &bundle.operation,
        Some(("work".to_owned(), "work-1".to_owned())),
    );
    let readback = journal
        .replay_in_context(&context, &identity)
        .expect("replay reads the original row")
        .expect("operation exists");
    assert_eq!(
        readback.operation.as_ref().unwrap().outcome,
        OperationOutcome::Changed
    );
    assert_eq!(
        journal
            .audit_event("op-replay")
            .unwrap()
            .unwrap()
            .payload_json,
        r#"{"message":"blocked","token":"[REDACTED]"}"#
    );

    IdentityStore::new(&store)
        .restore("database-2", 2, "unix-ms:12")
        .expect("restore advances database epoch");
    assert!(matches!(
        journal.replay_in_context(&context, &identity),
        Err(StoreError::Conflict(message)) if message.contains("operation identity")
    ));
}

#[test]
fn dependency_add_convenience_retry_uses_original_expected_revision() {
    let store = dependency_store();

    let first = store
        .add_dependency_operation(
            "p1",
            "prerequisite",
            "dependent",
            "agent-1",
            "op-dependency-replay",
            "sha256:dependency-replay",
            "unix-ms:4",
        )
        .expect("dependency add commits");
    assert!(!first.replayed);
    assert_eq!(first.revision, 2);
    assert_eq!(store.project_revision("p1").unwrap().0, 2);

    let replay = store
        .add_dependency_operation(
            "p1",
            "prerequisite",
            "dependent",
            "agent-1",
            "op-dependency-replay",
            "sha256:dependency-replay",
            "unix-ms:5",
        )
        .expect("exact dependency retry replays");
    assert!(replay.replayed);
    assert_eq!(replay.operation_id, first.operation_id);
    assert_eq!(replay.revision, first.revision);
    assert_eq!(
        store
            .operation("op-dependency-replay")
            .unwrap()
            .unwrap()
            .expected_revision,
        Some(1)
    );
    assert_eq!(store.project_revision("p1").unwrap().0, 2);
    assert!(store.audit_event("op-dependency-replay").unwrap().is_some());
}

#[test]
fn dependency_add_convenience_retry_rejects_changed_payload() {
    let store = dependency_store();
    store
        .add_dependency_operation(
            "p1",
            "prerequisite",
            "dependent",
            "agent-1",
            "op-dependency-payload",
            "sha256:dependency-original",
            "unix-ms:4",
        )
        .expect("dependency add commits");

    let error = store
        .add_dependency_operation(
            "p1",
            "prerequisite",
            "dependent",
            "agent-1",
            "op-dependency-payload",
            "sha256:dependency-changed",
            "unix-ms:5",
        )
        .expect_err("changed payload cannot reuse operation ID");
    assert!(matches!(
        error,
        StoreError::Conflict(message)
            if message.contains("another immutable identity")
    ));
    assert_eq!(store.project_revision("p1").unwrap().0, 2);
    assert_eq!(
        store
            .operation("op-dependency-payload")
            .unwrap()
            .unwrap()
            .request_digest,
        "sha256:dependency-original"
    );
    assert!(store
        .audit_event("op-dependency-payload")
        .unwrap()
        .is_some());
}

#[test]
fn changed_actor_payload_or_subject_cannot_reuse_operation_id() {
    let (store, context) = initialized_store();
    let bundle = OperationBundle::new(
        operation(
            "op-identity",
            OperationOutcome::Rejected,
            2,
            "agent-1",
            "sha256:request-identity",
            Some("unix-ms:11"),
        ),
        Some(audit("op-identity", 2, "agent-1", r#"{"reason":"hold"}"#)),
    );
    commit_bundle(&store, &context, &bundle).expect("bundle commits");
    let journal = OperationJournal::new(&store);

    let mut changed_actor = OperationIdentity::from_record(&bundle.operation, None);
    changed_actor.actor_id = "agent-2".to_owned();
    assert!(matches!(
        journal.replay_in_context(&context, &changed_actor),
        Err(StoreError::Conflict(message)) if message.contains("different immutable identity")
    ));

    let mut changed_payload = OperationIdentity::from_record(&bundle.operation, None);
    changed_payload.request_digest = "sha256:request-other".to_owned();
    assert!(matches!(
        journal.replay_in_context(&context, &changed_payload),
        Err(StoreError::Conflict(message)) if message.contains("different immutable identity")
    ));

    let changed_subject = OperationIdentity::from_record(
        &bundle.operation,
        Some(("work".to_owned(), "other-work".to_owned())),
    );
    assert!(matches!(
        journal.replay_in_context(&context, &changed_subject),
        Err(StoreError::WrongSubject { .. })
    ));
}

#[test]
fn pending_unknown_is_distinct_from_terminal_outcomes() {
    let (store, context) = initialized_store();
    let bundle = OperationBundle::new(
        operation(
            "op-unknown",
            OperationOutcome::Unknown,
            2,
            "agent-1",
            "sha256:request-unknown",
            None,
        ),
        Some({
            let mut event = audit("op-unknown", 2, "agent-1", r#"{"state":"unknown"}"#);
            event.event_type = "attempt.expiry_pending".to_owned();
            event
        }),
    );
    commit_bundle(&store, &context, &bundle).expect("unknown operation commits");
    let readback = OperationJournal::new(&store)
        .readback("p1", "op-unknown")
        .unwrap()
        .unwrap();
    assert_eq!(
        readback.operation.unwrap().outcome,
        OperationOutcome::Unknown
    );
}

#[test]
fn audit_failure_rolls_back_operation_and_identity() {
    let (store, context) = initialized_store();
    let mut invalid_event = audit("op-atomic", 2, "agent-1", r#"{"reason":"x"}"#);
    invalid_event.event_type = "not-a-schema-event".to_owned();
    let bundle = OperationBundle::new(
        operation(
            "op-atomic",
            OperationOutcome::Changed,
            2,
            "agent-1",
            "sha256:request-atomic",
            Some("unix-ms:11"),
        ),
        Some(invalid_event),
    );
    assert!(commit_bundle(&store, &context, &bundle).is_err());
    assert!(OperationJournal::new(&store)
        .readback("p1", "op-atomic")
        .unwrap()
        .is_none());
    assert!(IdentityStore::new(&store)
        .operation(&context, "op-atomic")
        .unwrap()
        .is_none());
}

#[test]
fn semantic_mutation_and_audit_persistence_failure_roll_back_together() {
    let (store, context) = initialized_store();
    store
        .execute_batch(
            "INSERT INTO work_item
               (work_id, project_id, kind, lifecycle, dispatch_policy,
                acceptance_profile_id, acceptance_profile_version, title,
                description, created_at, updated_at)
             VALUES ('work-audit-atomic', 'p1', 'task', 'open', 'automatic',
                     'focused', 1, 'Atomic audit target', '', 'unix-ms:0', 'unix-ms:0')",
        )
        .expect("target inserts");

    let original = OperationBundle::new(
        operation(
            "op-audit-revision",
            OperationOutcome::Changed,
            2,
            "agent-1",
            "sha256:audit-revision",
            Some("unix-ms:11"),
        ),
        Some(audit(
            "op-audit-revision",
            2,
            "agent-1",
            r#"{"state":"original"}"#,
        )),
    );
    commit_bundle(&store, &context, &original).expect("original operation commits");

    let before = store
        .work("p1", "work-audit-atomic")
        .expect("target reads")
        .expect("target exists")
        .dispatch_policy;
    let failed = OperationBundle::new(
        operation(
            "op-audit-conflict",
            OperationOutcome::Changed,
            2,
            "agent-1",
            "sha256:audit-conflict",
            Some("unix-ms:12"),
        ),
        Some(audit(
            "op-audit-conflict",
            2,
            "agent-1",
            r#"{"state":"conflicts with the original audit revision"}"#,
        )),
    );

    store
        .execute_batch("BEGIN IMMEDIATE")
        .expect("transaction begins");
    store
        .execute_batch(
            "UPDATE work_item
             SET dispatch_policy = 'paused', updated_at = 'unix-ms:12'
             WHERE project_id = 'p1' AND work_id = 'work-audit-atomic'",
        )
        .expect("semantic mutation is staged");
    let error = OperationJournal::new(&store)
        .append_in_transaction_with_identity(&context, &failed)
        .expect_err("duplicate audit revision must fail the bundle");
    assert!(matches!(error, StoreError::Constraint { .. }));
    store
        .execute_batch("ROLLBACK")
        .expect("failed bundle rolls back its caller-owned transaction");

    assert_eq!(
        store
            .work("p1", "work-audit-atomic")
            .expect("target rereads")
            .expect("target remains")
            .dispatch_policy,
        before
    );
    assert!(!store
        .operation_exists("op-audit-conflict")
        .expect("failed operation is absent"));
    assert!(IdentityStore::new(&store)
        .operation(&context, "op-audit-conflict")
        .expect("failed identity readback")
        .is_none());
    assert_eq!(
        store
            .audit_event("op-audit-revision")
            .expect("original audit reads")
            .expect("original audit remains")
            .payload_json,
        r#"{"state":"original"}"#
    );
}

#[test]
fn rejected_action_is_recorded_without_target_mutation() {
    let (store, context) = initialized_store();
    store
        .execute_batch(
            "INSERT INTO work_item
               (work_id, project_id, kind, lifecycle, dispatch_policy,
                acceptance_profile_id, acceptance_profile_version, title,
                description, created_at, updated_at)
             VALUES ('work-rejected', 'p1', 'task', 'open', 'automatic',
                     'focused', 1, 'Rejected target', '', 'unix-ms:0', 'unix-ms:0')",
        )
        .expect("target inserts");
    let before = store.work("p1", "work-rejected").unwrap().unwrap();
    let bundle = OperationBundle::new(
        operation(
            "op-rejected-recorded",
            OperationOutcome::Rejected,
            2,
            "agent-1",
            "sha256:rejected-recorded",
            Some("unix-ms:11"),
        ),
        Some(audit(
            "op-rejected-recorded",
            2,
            "agent-1",
            r#"{"reason":"operator_required","mutated":false}"#,
        )),
    );

    assert_eq!(
        register_or_replay(&store, &context, &bundle)
            .expect("rejected disposition commits")
            .clone(),
        OperationRegistration::Committed
    );
    let after = store.work("p1", "work-rejected").unwrap().unwrap();
    assert_eq!(after.lifecycle, before.lifecycle);
    assert_eq!(after.dispatch_policy, before.dispatch_policy);
    assert_eq!(
        store
            .operation("op-rejected-recorded")
            .unwrap()
            .unwrap()
            .outcome,
        OperationOutcome::Rejected
    );
    assert!(store.audit_event("op-rejected-recorded").unwrap().is_some());
}

#[test]
fn rejected_operation_requires_audit_and_does_not_mutate_target() {
    let (store, _context) = initialized_store();
    store
        .execute_batch(
            "INSERT INTO work_item
               (work_id, project_id, kind, lifecycle, dispatch_policy,
                acceptance_profile_id, acceptance_profile_version, title,
                description, created_at, updated_at)
             VALUES ('work-1', 'p1', 'task', 'open', 'automatic',
                     'focused', 1, 'Unchanged', '', 'unix-ms:0', 'unix-ms:0')",
        )
        .expect("target inserts");
    let before = store.work("p1", "work-1").unwrap().unwrap().lifecycle;
    let missing_audit = OperationBundle::new(
        operation(
            "op-rejected",
            OperationOutcome::Rejected,
            2,
            "agent-1",
            "sha256:request-rejected",
            Some("unix-ms:11"),
        ),
        None,
    );
    let error = OperationJournal::new(&store)
        .append_in_transaction(&missing_audit)
        .expect_err("terminal rejection without audit must fail closed");
    assert!(matches!(error, StoreError::Invalid(message) if message.contains("audit event")));
    assert_eq!(
        store.work("p1", "work-1").unwrap().unwrap().lifecycle,
        before
    );
    assert!(!store.operation_exists("op-rejected").unwrap());
}

#[test]
fn malformed_audit_payload_is_rejected_before_durable_write() {
    let (store, context) = initialized_store();
    let bundle = OperationBundle::new(
        operation(
            "op-malformed",
            OperationOutcome::Changed,
            2,
            "agent-1",
            "sha256:request-malformed",
            Some("unix-ms:11"),
        ),
        Some(audit("op-malformed", 2, "agent-1", "not-json")),
    );
    let error = commit_bundle(&store, &context, &bundle)
        .expect_err("malformed audit payload must fail closed");
    assert!(matches!(error, StoreError::Invalid(message) if message.contains("valid JSON")));
    assert!(!store.operation_exists("op-malformed").unwrap());
}

#[test]
fn identity_context_is_required_before_operation_write() {
    let store = SqliteStore::open_in_memory(SCHEMA).expect("schema opens");
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
        .expect("project initializes");
    let database = DatabaseIdentity::new("database-not-installed", 1).unwrap();
    let context = IdentityContext {
        project_id: "p1".to_owned(),
        database_instance_id: database.database_instance_id,
        restore_epoch: database.restore_epoch,
        workspace_binding_digest: "sha256:binding-1".to_owned(),
    };
    let bundle = OperationBundle::new(
        operation(
            "op-no-identity",
            OperationOutcome::Changed,
            2,
            "agent-1",
            "sha256:request-no-identity",
            Some("unix-ms:11"),
        ),
        Some(audit(
            "op-no-identity",
            2,
            "agent-1",
            r#"{"reason":"identity missing"}"#,
        )),
    );

    let error = commit_bundle(&store, &context, &bundle)
        .expect_err("an uninstalled identity context must fail closed");
    assert!(
        matches!(error, StoreError::Conflict(message) if message.contains("operation identity"))
    );
    assert!(!store.operation_exists("op-no-identity").unwrap());
}

#[test]
fn identity_context_mismatch_is_preflighted_without_a_partial_bundle() {
    let (store, context) = initialized_store();
    let foreign_database = DatabaseIdentity::new("database-foreign", 1).unwrap();
    let foreign_context = IdentityContext {
        project_id: context.project_id.clone(),
        database_instance_id: foreign_database.database_instance_id,
        restore_epoch: context.restore_epoch,
        workspace_binding_digest: context.workspace_binding_digest.clone(),
    };
    let bundle = OperationBundle::new(
        operation(
            "op-foreign-context",
            OperationOutcome::Changed,
            2,
            "agent-1",
            "sha256:request-foreign-context",
            Some("unix-ms:11"),
        ),
        Some(audit(
            "op-foreign-context",
            2,
            "agent-1",
            r#"{"reason":"foreign context"}"#,
        )),
    );

    let error = commit_bundle(&store, &foreign_context, &bundle)
        .expect_err("a foreign database identity must fail closed");
    assert!(
        matches!(error, StoreError::Conflict(message) if message.contains("database instance conflict"))
    );
    assert!(!store.operation_exists("op-foreign-context").unwrap());
}

#[test]
fn audit_session_and_fence_must_match_operation_identity() {
    let (store, context) = initialized_store();
    let mut mismatched_audit = audit(
        "op-mismatched-audit",
        2,
        "agent-1",
        r#"{"reason":"mismatch"}"#,
    );
    mismatched_audit.session_id = Some("other-session".to_owned());
    mismatched_audit.fence = Some(7);
    let bundle = OperationBundle::new(
        operation(
            "op-mismatched-audit",
            OperationOutcome::Changed,
            2,
            "agent-1",
            "sha256:request-mismatched-audit",
            Some("unix-ms:11"),
        ),
        Some(mismatched_audit),
    );

    let error = commit_bundle(&store, &context, &bundle)
        .expect_err("audit identity must match its operation");
    assert!(
        matches!(error, StoreError::Conflict(message) if message.contains("session identities"))
    );
    assert!(!store.operation_exists("op-mismatched-audit").unwrap());

    let mut fence_mismatch = audit(
        "op-mismatched-fence",
        2,
        "agent-1",
        r#"{"reason":"fence mismatch"}"#,
    );
    fence_mismatch.fence = Some(7);
    let fence_bundle = OperationBundle::new(
        operation(
            "op-mismatched-fence",
            OperationOutcome::Changed,
            2,
            "agent-1",
            "sha256:request-mismatched-fence",
            Some("unix-ms:11"),
        ),
        Some(fence_mismatch),
    );
    let error = commit_bundle(&store, &context, &fence_bundle)
        .expect_err("audit fence must match its operation");
    assert!(matches!(error, StoreError::Conflict(message) if message.contains("fence identities")));
    assert!(!store.operation_exists("op-mismatched-fence").unwrap());
}

#[test]
fn identity_bound_terminal_operation_requires_audit() {
    let (store, context) = initialized_store();
    let bundle = OperationBundle::new(
        operation(
            "op-terminal-without-audit",
            OperationOutcome::Rejected,
            2,
            "agent-1",
            "sha256:request-terminal-without-audit",
            Some("unix-ms:11"),
        ),
        None,
    );

    let error = commit_bundle(&store, &context, &bundle)
        .expect_err("terminal identity-bound operations require audit");
    assert!(matches!(error, StoreError::Invalid(message) if message.contains("audit event")));
    assert!(!store.operation_exists("op-terminal-without-audit").unwrap());
}

#[test]
fn register_or_replay_returns_one_bounded_original_outcome() {
    let (store, context) = initialized_store();
    let mut first_operation = operation(
        "op-idempotent",
        OperationOutcome::Changed,
        2,
        "agent-1",
        "sha256:request-idempotent",
        Some("unix-ms:11"),
    );
    first_operation.result_json = r#"{"message":"committed","token":"never-store"}"#.to_owned();
    let first = OperationBundle::new(
        first_operation.clone(),
        Some(audit(
            "op-idempotent",
            2,
            "agent-1",
            r#"{"message":"committed","api-key":"never-store"}"#,
        )),
    );
    assert_eq!(
        register_or_replay(&store, &context, &first).expect("first registration commits"),
        OperationRegistration::Committed
    );

    let mut retry_operation = first_operation;
    retry_operation.result_json = r#"{"message":"different local rendering"}"#.to_owned();
    let retry = OperationBundle::new(
        retry_operation,
        Some(audit(
            "op-idempotent",
            2,
            "agent-1",
            r#"{"message":"different local rendering"}"#,
        )),
    );
    let result = register_or_replay(&store, &context, &retry)
        .expect("an exact request digest replays the committed outcome");
    let OperationRegistration::Replayed(readback) = result else {
        panic!("expected a replay, not a second commit");
    };
    let stored_operation = readback.operation.expect("operation readback");
    assert_eq!(stored_operation.outcome, OperationOutcome::Changed);
    assert!(!stored_operation.result_json.contains("never-store"));
    assert!(stored_operation.result_json.contains("[REDACTED]"));
    let stored_audit = OperationJournal::new(&store)
        .audit_event("op-idempotent")
        .expect("audit readback")
        .expect("one audit row");
    assert!(stored_audit.payload_json.contains("[REDACTED]"));
    assert_eq!(
        store
            .operation("op-idempotent")
            .expect("operation readback")
            .expect("original operation remains")
            .request_digest,
        "sha256:request-idempotent"
    );
    assert_eq!(
        store
            .audit_event("op-idempotent")
            .expect("audit readback")
            .expect("original audit remains")
            .payload_json,
        r#"{"api-key":"[REDACTED]","message":"committed"}"#
    );
}

#[test]
fn exact_duplicate_payload_replays_without_a_second_audit_event() {
    let (store, context) = initialized_store();
    let bundle = OperationBundle::new(
        operation(
            "op-duplicate-payload",
            OperationOutcome::Changed,
            2,
            "agent-1",
            "sha256:duplicate-payload",
            Some("unix-ms:11"),
        ),
        Some(audit(
            "op-duplicate-payload",
            2,
            "agent-1",
            r#"{"result":"same request"}"#,
        )),
    );

    assert_eq!(
        register_or_replay(&store, &context, &bundle).expect("first request commits"),
        OperationRegistration::Committed
    );
    let original = store
        .operation("op-duplicate-payload")
        .unwrap()
        .expect("operation exists");
    let original_audit = store
        .audit_event("op-duplicate-payload")
        .unwrap()
        .expect("audit exists");

    let replay =
        register_or_replay(&store, &context, &bundle).expect("exact duplicate payload replays");
    let OperationRegistration::Replayed(readback) = replay else {
        panic!("expected exact duplicate to replay");
    };
    assert_eq!(readback.operation, Some(original.clone()));
    assert_eq!(
        store
            .audit_event_in_context(&context, "op-duplicate-payload")
            .unwrap(),
        Some(original_audit)
    );
    assert_eq!(
        store
            .operation("op-duplicate-payload")
            .unwrap()
            .expect("operation remains")
            .request_digest,
        original.request_digest
    );
}

#[test]
fn register_or_replay_rejects_digest_conflict_without_a_second_outcome() {
    let (store, context) = initialized_store();
    let first = OperationBundle::new(
        operation(
            "op-digest-conflict",
            OperationOutcome::Rejected,
            2,
            "agent-1",
            "sha256:request-original",
            Some("unix-ms:11"),
        ),
        Some(audit(
            "op-digest-conflict",
            2,
            "agent-1",
            r#"{"reason":"original"}"#,
        )),
    );
    register_or_replay(&store, &context, &first).expect("first registration commits");

    let mut conflicting_operation = first.operation.clone();
    conflicting_operation.request_digest = "sha256:request-changed".to_owned();
    let conflicting = OperationBundle::new(
        conflicting_operation,
        Some(audit(
            "op-digest-conflict",
            2,
            "agent-1",
            r#"{"reason":"changed"}"#,
        )),
    );
    let error = register_or_replay(&store, &context, &conflicting)
        .expect_err("changed request digest must conflict");
    assert!(
        matches!(error, StoreError::Conflict(message) if message.contains("immutable identity"))
    );
    assert_eq!(
        store
            .operation("op-digest-conflict")
            .unwrap()
            .unwrap()
            .request_digest,
        "sha256:request-original"
    );
    assert_eq!(
        store
            .audit_event("op-digest-conflict")
            .unwrap()
            .unwrap()
            .payload_json,
        r#"{"reason":"original"}"#
    );
}

#[test]
fn register_or_replay_rejects_actor_and_project_boundary_crossing() {
    let (store, context) = initialized_store();
    let first = OperationBundle::new(
        operation(
            "op-boundary",
            OperationOutcome::Rejected,
            2,
            "agent-1",
            "sha256:boundary",
            Some("unix-ms:11"),
        ),
        Some(audit(
            "op-boundary",
            2,
            "agent-1",
            r#"{"reason":"boundary"}"#,
        )),
    );
    register_or_replay(&store, &context, &first).expect("first boundary operation commits");

    let mut actor_changed = first.operation.clone();
    actor_changed.actor_id = "agent-2".to_owned();
    let mut actor_audit = first.audit.clone().unwrap();
    actor_audit.actor_id = "agent-2".to_owned();
    let error = register_or_replay(
        &store,
        &context,
        &OperationBundle::new(actor_changed, Some(actor_audit)),
    )
    .expect_err("actor change must conflict");
    assert!(
        matches!(error, StoreError::Conflict(message) if message.contains("immutable identity"))
    );

    store
        .ensure_actor("agent-2", "agent", "credential-2", "Agent 2", "unix-ms:20")
        .expect("foreign actor creates");
    store
        .create_project("p2", "unix-ms:20")
        .expect("foreign project creates");
    let foreign_context = IdentityStore::new(&store)
        .bind_project(
            "p2",
            &WorkspaceBinding::new("/tmp/boreal-p2", "/tmp/boreal-p2", "sha256:binding-p2")
                .expect("foreign binding is valid"),
            "unix-ms:21",
        )
        .expect("foreign project binds");
    let mut foreign_operation = first.operation.clone();
    foreign_operation.project_id = "p2".to_owned();
    foreign_operation.actor_id = "agent-2".to_owned();
    let mut foreign_audit = first.audit.unwrap();
    foreign_audit.project_id = "p2".to_owned();
    foreign_audit.actor_id = "agent-2".to_owned();
    let error = register_or_replay(
        &store,
        &foreign_context,
        &OperationBundle::new(foreign_operation, Some(foreign_audit)),
    )
    .expect_err("project boundary crossing must not read or reuse p1 operation");
    assert!(
        matches!(error, StoreError::Conflict(message) if message.contains("operation identity"))
    );
    assert!(matches!(
        OperationJournal::new(&store).readback_in_context(&foreign_context, "op-boundary"),
        Err(StoreError::Conflict(message)) if message.contains("operation identity")
    ));
    assert!(OperationJournal::new(&store)
        .audit_event_in_context(&context, "op-boundary")
        .unwrap()
        .is_some());
}

#[test]
fn context_readback_preserves_unknown_and_pending_distinction() {
    let (store, context) = initialized_store();
    for (revision, operation_id, outcome) in [
        (2, "op-busy-readback", OperationOutcome::Busy),
        (3, "op-unknown-readback", OperationOutcome::Unknown),
    ] {
        let bundle = OperationBundle::new(
            operation(
                operation_id,
                outcome,
                revision,
                "agent-1",
                &format!("sha256:{operation_id}"),
                None,
            ),
            Some(audit(
                operation_id,
                revision,
                "agent-1",
                r#"{"state":"readback-required"}"#,
            )),
        );
        register_or_replay(&store, &context, &bundle).expect("pending operation commits");
    }

    let journal = OperationJournal::new(&store);
    assert_eq!(
        journal
            .readback_in_context(&context, "op-busy-readback")
            .unwrap()
            .unwrap()
            .operation
            .unwrap()
            .outcome,
        OperationOutcome::Busy
    );
    assert_eq!(
        journal
            .readback_in_context(&context, "op-unknown-readback")
            .unwrap()
            .unwrap()
            .operation
            .unwrap()
            .outcome,
        OperationOutcome::Unknown
    );
    assert!(journal
        .readback_in_context(&context, "missing-operation")
        .unwrap()
        .is_none());
}

#[test]
fn audit_redaction_bounds_depth_and_separator_variants() {
    let payload = serde_json::json!({
        "api-key": "secret",
        "items": (0..300).collect::<Vec<_>>(),
        "nested": (0..40)
            .map(|value| serde_json::json!({"level": value}))
            .collect::<Vec<_>>(),
    })
    .to_string();
    let redacted = boreal_store::operations::audit::redacted_payload(&payload)
        .expect("large valid payload remains bounded JSON");
    assert!(redacted.len() <= 16 * 1024);
    assert!(redacted.contains("[REDACTED]"));
    assert!(redacted.contains("TRUNCATED"));
    assert!(!redacted.contains("secret"));
}

#[test]
fn invalid_optional_identity_fields_fail_before_any_write() {
    let (store, context) = initialized_store();
    let mut invalid = operation(
        "op-invalid-identity",
        OperationOutcome::Changed,
        2,
        "agent-1",
        "sha256:invalid-identity",
        Some("unix-ms:11"),
    );
    invalid.session_id = Some(String::new());
    let bundle = OperationBundle::new(
        invalid,
        Some(audit(
            "op-invalid-identity",
            2,
            "agent-1",
            r#"{"reason":"invalid"}"#,
        )),
    );
    let error = register_or_replay(&store, &context, &bundle)
        .expect_err("empty optional identity must be rejected");
    assert!(matches!(error, StoreError::Invalid(message) if message.contains("session_id")));
    assert!(!store.operation_exists("op-invalid-identity").unwrap());
}
