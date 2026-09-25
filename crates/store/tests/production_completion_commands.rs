//! Focused production-store regressions for completion mutations.

use boreal_domain::{
    completion::CompletionKind, AttemptPhase, DispatchPolicy, PersistedLifecycle, TimestampMs,
    WorkId, WorkItem, WorkKind,
};
use boreal_store::{
    completion::CompletionMutationRequest,
    identity::{DatabaseIdentity, IdentityStore, WorkspaceBinding},
    AttemptMutationKind, AttemptMutationRequest, SessionRegistrationRequest,
    SourceVersionRegistrationInput, SqliteStore,
};
use std::time::{SystemTime, UNIX_EPOCH};

const PRODUCTION_SCHEMA: &str = include_str!("../../../project/spec/schema-production.sql");

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("test clock is after UNIX_EPOCH")
        .as_millis() as u64
}

fn timestamp(value: u64) -> String {
    format!("unix-ms:{value}")
}

fn initialized_store() -> SqliteStore {
    let store = SqliteStore::open_in_memory(PRODUCTION_SCHEMA).expect("production schema opens");
    let database =
        DatabaseIdentity::new("completion-command-test-db", 1).expect("database identity is valid");
    IdentityStore::new(&store)
        .install(&database, "unix-ms:0")
        .expect("database identity installs");
    let binding = WorkspaceBinding::new(
        "/tmp/boreal-production-completion",
        "/tmp/boreal-production-completion",
        "sha256:completion-test-binding",
    )
    .expect("workspace binding is valid");
    store
        .initialize_project_with_workspace(
            "p1",
            "operator-1",
            "operator",
            "boreal-key-v1:sha256:completion-test-credential",
            "Operator",
            "op-project-init",
            "sha256:op-project-init",
            &database,
            &binding,
            "unix-ms:0",
        )
        .expect("identity-bound project initializes");

    let revision = store
        .project_revision("p1")
        .expect("project revision reads")
        .0;
    store
        .register_session(SessionRegistrationRequest {
            project_id: "p1".into(),
            session_id: "session-1".into(),
            actor_id: "operator-1".into(),
            harness_id: "test-harness".into(),
            operation_id: "op-session-register".into(),
            request_digest: "sha256:op-session-register".into(),
            expected_project_revision: Some(revision),
            started_at: "unix-ms:0".into(),
        })
        .expect("project session registers");

    let mut work = WorkItem::new(
        "p1".into(),
        WorkId::new("w1"),
        WorkKind::Task,
        None,
        "Checkpoint regression",
    );
    work.lifecycle = PersistedLifecycle::Open;
    work.dispatch_policy = DispatchPolicy::OperatorOnly;
    let revision = store
        .project_revision("p1")
        .expect("project revision reads")
        .0;
    store
        .create_work_operation_for_session(
            &work,
            "operator-1",
            Some("session-1"),
            "op-work-create",
            "sha256:op-work-create",
            Some(revision),
            "unix-ms:1",
        )
        .expect("work creates under project session");
    store
}

fn running_attempt(store: &SqliteStore, expired_lease: bool) -> (String, u64, u64) {
    store
        .register_source_version(&SourceVersionRegistrationInput {
            operation_id: "op-source-register".into(),
            project_id: "p1".into(),
            actor_id: "operator-1".into(),
            source_version_id: "source-1".into(),
            origin: "fixture-source".into(),
            access_scope: "project".into(),
            content_digest: format!("sha256:{}", "a".repeat(64)),
            media_type: "text/plain".into(),
            byte_count: 1,
            captured_at: "unix-ms:0".into(),
            parser_identity: "test-parser/1".into(),
            availability: "available".into(),
            citation_json: "[]".into(),
            request_digest: "sha256:op-source-register".into(),
        })
        .expect("source version registers through the public store API");
    let actual_now = now_ms();
    let claimed_at = if expired_lease {
        actual_now - 120_000
    } else {
        actual_now
    };
    let lease_deadline = if expired_lease {
        actual_now - 60_000
    } else {
        actual_now + 3_600_000
    };
    let hard_deadline = actual_now + 7_200_000;
    let claim = store
        .claim_work_with_context(
            "p1",
            "w1",
            "operator-1",
            "test-harness",
            Some("session-1"),
            "attempt-1",
            "op-claim",
            "sha256:op-claim",
            Some(store.project_revision("p1").unwrap().0),
            &timestamp(claimed_at),
            &timestamp(lease_deadline),
            &timestamp(hard_deadline),
            Some("source-1"),
            "config-1",
        )
        .expect("eligible task claims");

    for (operation_id, at, expected_phase, mutation) in [
        (
            "op-accept",
            claimed_at + 10,
            AttemptPhase::Claimed,
            AttemptMutationKind::Accept,
        ),
        (
            "op-start",
            claimed_at + 20,
            AttemptPhase::Accepted,
            AttemptMutationKind::Start,
        ),
    ] {
        store
            .apply_attempt_mutation(AttemptMutationRequest {
                project_id: "p1".into(),
                work_id: "w1".into(),
                attempt_id: claim.attempt_id.clone(),
                actor_id: "operator-1".into(),
                harness_id: Some("test-harness".into()),
                session_id: Some("session-1".into()),
                fence: claim.fence,
                operation_id: operation_id.into(),
                request_digest: format!("sha256:{operation_id}"),
                at: timestamp(at),
                expected_project_revision: None,
                expected_work_revision: None,
                expected_attempt_revision: Some(claim.fence),
                expected_phase: Some(expected_phase),
                expected_lease_deadline: None,
                expected_hard_deadline: None,
                mutation,
                reason: None,
            })
            .expect("attempt advances through accepted execution");
    }
    (claim.attempt_id, claim.fence, claimed_at)
}

fn checkpoint_request(
    store: &SqliteStore,
    operation_id: &str,
    request_at: String,
) -> CompletionMutationRequest {
    let (snapshot, _) = store
        .read_project_status_for_session(
            "p1",
            "operator-1",
            Some("session-1"),
            TimestampMs(now_ms()),
        )
        .expect("canonical status/action facts read");
    let facts = snapshot
        .works
        .iter()
        .find(|row| row.work.id.as_str() == "w1")
        .expect("work is in snapshot")
        .action_facts
        .clone();
    CompletionMutationRequest {
        project_id: "p1".into(),
        work_id: "w1".into(),
        actor_id: "operator-1".into(),
        session_id: "session-1".into(),
        operation_id: operation_id.into(),
        kind: CompletionKind::Checkpoint,
        expected_revision: snapshot.revision.0,
        expected_entity_revision: facts.entity_revision.expect("entity revision exists"),
        expected_proof_revision: facts.proof_revision.expect("proof revision exists"),
        submission_id: None,
        target_id: None,
        predecessor_revision: None,
        exception_reason: None,
        reason: "record checkpoint boundary".into(),
        expires_at_ms: None,
        confirmed: true,
        at: request_at,
    }
}

#[test]
fn stale_prelock_timestamp_cannot_checkpoint_after_lease_expiry() {
    let store = initialized_store();
    let (_, _, claimed_at) = running_attempt(&store, true);
    let stale_at = timestamp(claimed_at + 30_000); // before the stored lease deadline
    let request = checkpoint_request(&store, "op-expired-checkpoint", stale_at);

    let error = store
        .apply_completion_command(&request)
        .expect_err("production time must observe the expired lease");
    assert!(error.to_string().contains("action_denied"), "{error}");
    assert!(!store
        .operation_exists("op-expired-checkpoint")
        .expect("operation readback succeeds"));
    let snapshot = store.read_project_status("p1").expect("status rereads");
    let attempt = snapshot.works[0]
        .current_attempt
        .as_ref()
        .expect("expired current attempt remains visible");
    assert!(attempt.last_checkpoint_at.is_none());
}

#[test]
fn checkpoint_readback_records_exact_attempt_and_fence_and_replays_idempotently() {
    let store = initialized_store();
    let (attempt_id, fence, _) = running_attempt(&store, false);
    let request = checkpoint_request(&store, "op-checkpoint-identity", timestamp(now_ms()));

    let committed = store
        .apply_completion_command(&request)
        .expect("checkpoint commits");
    assert!(!committed.replayed);

    let operation = store
        .operation("op-checkpoint-identity")
        .expect("operation reads")
        .expect("operation exists");
    assert_eq!(operation.attempt_id.as_deref(), Some(attempt_id.as_str()));
    assert_eq!(operation.fence, Some(fence));
    let payload: serde_json::Value =
        serde_json::from_str(&operation.result_json).expect("checkpoint payload is JSON");
    assert_eq!(payload["attempt_id"], attempt_id);
    assert_eq!(payload["fence"], fence);

    let audit = store
        .audit_event("op-checkpoint-identity")
        .expect("audit reads")
        .expect("audit event exists");
    assert_eq!(audit.subject_type, "attempt");
    assert_eq!(audit.subject_id, attempt_id);
    assert_eq!(audit.fence, Some(fence));
    assert_eq!(audit.as_of, operation.created_at);
    let audit_payload: serde_json::Value =
        serde_json::from_str(&audit.payload_json).expect("audit payload is JSON");
    assert_eq!(audit_payload["attempt_id"], attempt_id);
    assert_eq!(audit_payload["fence"], fence);
    assert_eq!(audit_payload["event_name"], "attempt.checkpoint");

    let mut replay_request = request;
    replay_request.at = "unix-ms:1".into();
    let replay = store
        .apply_completion_command(&replay_request)
        .expect("same operation payload replays despite caller timestamp drift");
    assert!(replay.replayed);
    assert_eq!(replay.revision, committed.revision);
    assert_eq!(store.project_revision("p1").unwrap().0, committed.revision);
}
