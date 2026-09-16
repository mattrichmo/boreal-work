use boreal_domain::{
    AttemptPhase, GateState, PersistedLifecycle, ProjectId, WorkId, WorkItem, WorkKind,
};
use boreal_store::{
    AttemptMutationKind, AttemptMutationRequest, AuditEventRecord, CloseIntentRequest,
    ConstraintKind, EvidenceExecutionAdmissionRequest, GateStateUpdateRequest, OperationOutcome,
    OperationRecord, ReceiptAcceptanceExpectation, ReceiptAttestation, ReceiptInsertRequest,
    ReceiptOutcome, ReceiptSubmissionKind, ReviewDecision, ReviewInsertRequest, SnapshotRevision,
    SqliteStore, StoreError, SCHEMA_VERSION,
};

const SCHEMA: &str = include_str!("../../../project/spec/schema-v2.sql");

fn store() -> SqliteStore {
    SqliteStore::open_in_memory(SCHEMA).expect("schema opens")
}

fn base(store: &SqliteStore) {
    store
        .execute_batch(
            "
            INSERT INTO project VALUES ('p1', 2, 'boreal.work-status/2', 0, 't0', 't0');
            INSERT INTO project VALUES ('p2', 2, 'boreal.work-status/2', 0, 't0', 't0');
            INSERT INTO actor VALUES ('agent-1', 'agent', 'cred-agent', 'Agent', 't0');
            INSERT INTO actor VALUES ('reviewer-1', 'reviewer', 'cred-reviewer', 'Reviewer', 't0');
            INSERT INTO session VALUES ('s1', 'agent-1', 'luna', 'active', 't0', NULL);
            INSERT INTO acceptance_profile VALUES ('default', 1, 'sha256:policy', '{}', 't0');
            INSERT INTO work_item (
                work_id, project_id, kind, parent_id, lifecycle, dispatch_policy,
                acceptance_profile_id, acceptance_profile_version, title,
                description, created_at, updated_at
            ) VALUES ('w1', 'p1', 'task', NULL, 'open', 'automatic', 'default', 1,
                      'Work 1', '', 't0', 't0');
            INSERT INTO work_item (
                work_id, project_id, kind, parent_id, lifecycle, dispatch_policy,
                acceptance_profile_id, acceptance_profile_version, title,
                description, created_at, updated_at
            ) VALUES ('w2', 'p2', 'task', NULL, 'open', 'automatic', 'default', 1,
                      'Work 2', '', 't0', 't0');
            ",
        )
        .expect("base records insert");
}

fn attempt(store: &SqliteStore, id: &str, work: &str, session: &str, fence: u64) {
    store
        .execute_batch(&format!(
            "INSERT INTO attempt (
                attempt_id, work_id, actor_id, harness_id, session_id, fence,
                current, state, claimed_at, accepted_at, lease_deadline,
                max_attempt_deadline, review_required_after_expiry,
                config_identity, binary_identity, protocol_version, schema_version
            ) VALUES ('{id}', '{work}', 'agent-1', 'luna', '{session}', {fence},
                      1, 'claimed', 't0', NULL, 't1', 't2', 1,
                      'config', 'binary', '2', 2);"
        ))
        .expect("attempt insert");
}

fn remove_sqlite_files(path: &std::path::Path) {
    let _ = std::fs::remove_file(path);
    let _ = std::fs::remove_file(path.with_extension("sqlite-wal"));
    let _ = std::fs::remove_file(path.with_extension("sqlite-shm"));
}

fn mutation(
    attempt_id: &str,
    work_id: &str,
    fence: u64,
    operation_id: &str,
    at: &str,
    phase: AttemptPhase,
    kind: AttemptMutationKind,
) -> AttemptMutationRequest {
    AttemptMutationRequest {
        project_id: "p1".into(),
        work_id: work_id.into(),
        attempt_id: attempt_id.into(),
        actor_id: "agent-1".into(),
        harness_id: Some("luna".into()),
        session_id: Some("s1".into()),
        fence,
        operation_id: operation_id.into(),
        request_digest: format!("sha256:{operation_id}"),
        at: at.into(),
        expected_project_revision: None,
        expected_work_revision: None,
        expected_attempt_revision: None,
        expected_phase: Some(phase),
        expected_lease_deadline: None,
        expected_hard_deadline: None,
        mutation: kind,
        reason: None,
    }
}

fn receipt_request(
    receipt_id: &str,
    work_id: &str,
    fence: u64,
    operation_id: &str,
    gate_id: Option<&str>,
    result: ReceiptOutcome,
) -> ReceiptInsertRequest {
    ReceiptInsertRequest {
        project_id: "p1".into(),
        actor_id: "agent-1".into(),
        session_id: Some("s1".into()),
        expected_project_revision: None,
        request_digest: format!("sha256:{operation_id}"),
        receipt_id: receipt_id.into(),
        work_id: work_id.into(),
        attempt_id: "a1".into(),
        fence,
        operation_id: operation_id.into(),
        gate_id: gate_id.map(str::to_owned),
        executable: "cargo".into(),
        argv_json: "[\"cargo\",\"test\"]".into(),
        cwd: ".".into(),
        exit_code: if result == ReceiptOutcome::Passed {
            0
        } else {
            1
        },
        started_at: "t0".into(),
        ended_at: "t1".into(),
        source_version_id: None,
        config_identity: "config".into(),
        environment_fingerprint: "env".into(),
        output_digest: Some("sha256:output".into()),
        output_ref: None,
        subject_json: format!("{{\"work_id\":\"{work_id}\"}}"),
        coverage_json: "{}".into(),
        attestation: ReceiptAttestation::BorealWitnessed,
        submission_kind: ReceiptSubmissionKind::WitnessedExecutor,
        acceptance: gate_id.map(|gate_id| ReceiptAcceptanceExpectation {
            work_id: work_id.into(),
            attempt_id: "a1".into(),
            fence,
            source_version_id: None,
            config_identity: "config".into(),
            profile_id: "default".into(),
            profile_version: 1,
            gate_id: gate_id.into(),
            gate_kind: boreal_domain::GateKind::Verification,
            gate_required: true,
            requires_attestation: true,
        }),
        result,
        rejection_code: None,
        created_at: "t1".into(),
    }
}

fn admit_execution(store: &SqliteStore, request: &ReceiptInsertRequest) {
    store
        .execute_batch(&format!(
            "UPDATE attempt SET state = 'running', accepted_at = COALESCE(accepted_at, 't0')
             WHERE attempt_id = '{}'",
            request.attempt_id.replace('\'', "''")
        ))
        .unwrap();
    let acceptance = request.acceptance.as_ref().unwrap();
    store
        .admit_evidence_execution(EvidenceExecutionAdmissionRequest {
            operation_id: request.operation_id.clone(),
            project_id: request.project_id.clone(),
            work_id: request.work_id.clone(),
            attempt_id: request.attempt_id.clone(),
            fence: request.fence,
            gate_id: request.gate_id.clone().unwrap(),
            actor_id: request.actor_id.clone(),
            session_id: request.session_id.clone(),
            request_digest: format!("sha256:execution:{}", request.operation_id),
            artifact_ref: format!("artifact:execution:{}", request.operation_id),
            source_version_id: request.source_version_id.clone(),
            config_identity: request.config_identity.clone(),
            profile_id: acceptance.profile_id.clone(),
            profile_version: acceptance.profile_version,
            admitted_at: "t0".into(),
        })
        .unwrap();
    store
        .start_evidence_execution(&request.operation_id, "t0")
        .unwrap();
    store
        .finish_evidence_execution(&request.operation_id, "t0", Some(request.exit_code))
        .unwrap();
}

fn review_request(operation_id: &str, reviewer_actor_id: &str) -> ReviewInsertRequest {
    ReviewInsertRequest {
        project_id: "p1".into(),
        actor_id: reviewer_actor_id.into(),
        session_id: None,
        expected_project_revision: None,
        review_id: format!("review-{operation_id}"),
        work_id: "w1".into(),
        attempt_id: "a1".into(),
        fence: 1,
        gate_id: Some("review".into()),
        reviewer_actor_id: reviewer_actor_id.into(),
        decision: ReviewDecision::Accepted,
        reason: "independently checked".into(),
        source_version_id: None,
        policy_digest: "sha256:policy".into(),
        operation_id: operation_id.into(),
        request_digest: format!("sha256:{operation_id}"),
        created_at: "t1".into(),
    }
}

fn close_request(operation_id: &str, close_intent_id: &str) -> CloseIntentRequest {
    CloseIntentRequest {
        project_id: "p1".into(),
        actor_id: "agent-1".into(),
        session_id: Some("s1".into()),
        expected_project_revision: None,
        close_intent_id: close_intent_id.into(),
        work_id: "w1".into(),
        attempt_id: "a1".into(),
        fence: 1,
        operation_id: operation_id.into(),
        source_version_id: None,
        config_identity: "config".into(),
        profile_id: "default".into(),
        profile_version: 1,
        summary_id: None,
        at: "t2".into(),
        request_digest: format!("sha256:{operation_id}"),
    }
}

#[test]
fn fresh_schema_enables_foreign_keys_and_wal_for_file_databases() {
    let path =
        std::env::temp_dir().join(format!("boreal-store-{}-fresh.sqlite", std::process::id()));
    remove_sqlite_files(&path);
    let store = SqliteStore::open(&path, SCHEMA).expect("file schema opens");
    assert_eq!(store.schema_version().unwrap(), SCHEMA_VERSION);
    assert!(store.foreign_keys_enabled().unwrap());
    assert_eq!(store.journal_mode().unwrap(), "wal");
    drop(store);
    remove_sqlite_files(&path);
}

#[test]
fn schema_version_is_idempotent_on_reopen() {
    let path = std::env::temp_dir().join(format!(
        "boreal-store-{}-version.sqlite",
        std::process::id()
    ));
    remove_sqlite_files(&path);
    {
        let store = SqliteStore::open(&path, SCHEMA).unwrap();
        assert_eq!(store.schema_version().unwrap(), 2);
    }
    let store = SqliteStore::open(&path, "SELECT 1;").unwrap();
    assert_eq!(store.schema_version().unwrap(), 2);
    drop(store);
    remove_sqlite_files(&path);
}

#[test]
fn foreign_key_rejects_cross_project_parent_and_dependency() {
    let store = store();
    base(&store);
    let parent_error = store
        .execute_batch("UPDATE work_item SET parent_id = 'w2' WHERE work_id = 'w1'")
        .unwrap_err();
    assert!(matches!(
        parent_error,
        StoreError::Constraint {
            kind: ConstraintKind::ForeignKey,
            ..
        }
    ));

    let dependency_error = store
        .execute_batch(
            "INSERT INTO dependency (project_id, prerequisite_id, dependent_id, created_at)
             VALUES ('p1', 'w2', 'w1', 't0')",
        )
        .unwrap_err();
    assert!(matches!(
        dependency_error,
        StoreError::Constraint {
            kind: ConstraintKind::ForeignKey,
            ..
        }
    ));
}

#[test]
fn duplicate_current_attempt_and_session_are_rejected() {
    let store = store();
    base(&store);
    attempt(&store, "a1", "w1", "s1", 1);
    let work_error = store
        .execute_batch(
            "INSERT INTO attempt (
                attempt_id, work_id, actor_id, harness_id, session_id, fence,
                current, state, claimed_at, lease_deadline, max_attempt_deadline,
                config_identity, binary_identity, protocol_version, schema_version
             ) VALUES ('a2', 'w1', 'agent-1', 'luna', NULL, 2, 1, 'claimed', 't0', 't1', 't2', 'c', 'b', '2', 2)",
        )
        .unwrap_err();
    assert!(matches!(
        work_error,
        StoreError::Constraint {
            kind: ConstraintKind::Unique,
            ..
        }
    ));

    let session_error = store
        .execute_batch(
            "INSERT INTO work_item (
                work_id, project_id, kind, lifecycle, dispatch_policy,
                acceptance_profile_id, acceptance_profile_version, title,
                description, created_at, updated_at
             ) VALUES ('w3', 'p1', 'task', 'open', 'automatic', 'default', 1, 'Work 3', '', 't0', 't0');
             INSERT INTO attempt (
                attempt_id, work_id, actor_id, harness_id, session_id, fence,
                current, state, claimed_at, lease_deadline, max_attempt_deadline,
                config_identity, binary_identity, protocol_version, schema_version
             ) VALUES ('a3', 'w3', 'agent-1', 'luna', 's1', 1, 1, 'claimed', 't0', 't1', 't2', 'c', 'b', '2', 2)",
        )
        .unwrap_err();
    assert!(matches!(
        session_error,
        StoreError::Constraint {
            kind: ConstraintKind::Unique,
            ..
        }
    ));
}

#[test]
fn duplicate_normalized_gates_are_rejected() {
    let store = store();
    base(&store);
    store
        .execute_batch(
            "INSERT INTO gate (gate_id, work_id, profile_id, profile_version, kind, subject_ref, updated_at)
             VALUES ('g1', 'w1', 'default', 1, 'verification', '', 't0')",
        )
        .unwrap();
    let error = store
        .execute_batch(
            "INSERT INTO gate (gate_id, work_id, profile_id, profile_version, kind, subject_ref, updated_at)
             VALUES ('g2', 'w1', 'default', 1, 'verification', '', 't0')",
        )
        .unwrap_err();
    assert!(matches!(
        error,
        StoreError::Constraint {
            kind: ConstraintKind::Unique,
            ..
        }
    ));
}

#[test]
fn receipts_and_audit_events_are_append_only() {
    let store = store();
    base(&store);
    attempt(&store, "a1", "w1", "s1", 1);
    store
        .execute_batch(
            "INSERT INTO operation VALUES ('op1', 'p1', 'claim', 'agent-1', 's1', NULL, 'a1', 1, 'sha256:req', 'changed', '{}', 1, 't0', 't0');
             INSERT INTO audit_event (project_id, revision, operation_id, event_type, subject_type, subject_id, actor_id, session_id, fence, as_of, payload_json)
             VALUES ('p1', 1, 'op1', 'attempt.claimed', 'attempt', 'a1', 'agent-1', 's1', 1, 't0', '{}');
             INSERT INTO receipt (
                receipt_id, work_id, attempt_id, fence, operation_id, executable,
                argv_json, cwd, exit_code, started_at, ended_at, config_identity,
                environment_fingerprint, subject_json, coverage_json, attestation, result, created_at
             ) VALUES ('r1', 'w1', 'a1', 1, 'op-receipt', 'true', '[]', '.', 0, 't0', 't1', 'c', 'e', '{}', '{}', 'boreal_witnessed', 'passed', 't1')",
        )
        .unwrap();

    let receipt_error = store
        .execute_batch("UPDATE receipt SET cwd = '/tmp' WHERE receipt_id = 'r1'")
        .unwrap_err();
    assert!(matches!(
        receipt_error,
        StoreError::Constraint {
            kind: ConstraintKind::AppendOnly,
            ..
        }
    ));
    let audit_error = store
        .execute_batch("DELETE FROM audit_event WHERE event_id = 1")
        .unwrap_err();
    assert!(matches!(
        audit_error,
        StoreError::Constraint {
            kind: ConstraintKind::AppendOnly,
            ..
        }
    ));
}

#[test]
fn self_review_is_rejected_by_trigger() {
    let store = store();
    base(&store);
    attempt(&store, "a1", "w1", "s1", 1);
    let error = store
        .execute_batch(
            "INSERT INTO review (
                review_id, work_id, attempt_id, fence, reviewer_actor_id,
                decision, reason, policy_digest, created_at
             ) VALUES ('rv1', 'w1', 'a1', 1, 'agent-1', 'accepted', 'self', 'sha256:p', 't0')",
        )
        .unwrap_err();
    assert!(matches!(
        error,
        StoreError::Constraint {
            kind: ConstraintKind::SelfReview,
            ..
        }
    ));
}

#[test]
fn revision_operation_and_audit_primitives_round_trip() {
    let store = store();
    base(&store);
    assert_eq!(store.project_revision("p1").unwrap(), SnapshotRevision(0));
    let revision = store.next_revision("p1").unwrap();
    assert_eq!(revision, SnapshotRevision(1));

    store
        .append_operation(&OperationRecord {
            operation_id: "op1".into(),
            project_id: "p1".into(),
            command: "work create".into(),
            actor_id: "agent-1".into(),
            session_id: Some("s1".into()),
            expected_revision: Some(0),
            attempt_id: None,
            fence: None,
            request_digest: "sha256:req".into(),
            outcome: OperationOutcome::Changed,
            result_json: "{}".into(),
            revision: revision.0,
            created_at: "t0".into(),
            completed_at: Some("t1".into()),
        })
        .unwrap();
    assert!(store.operation_exists("op1").unwrap());
    let stored = store.operation("op1").unwrap().unwrap();
    assert_eq!(stored.operation_id, "op1");
    assert_eq!(stored.outcome, OperationOutcome::Changed);
    assert_eq!(stored.revision, 1);

    store
        .append_audit_event(&AuditEventRecord {
            project_id: "p1".into(),
            revision: revision.0,
            operation_id: "op1".into(),
            event_type: "work.created".into(),
            subject_type: "work".into(),
            subject_id: "w1".into(),
            actor_id: "agent-1".into(),
            session_id: Some("s1".into()),
            fence: None,
            as_of: "t1".into(),
            payload_json: "{}".into(),
        })
        .unwrap();
    assert!(store.operation_exists("op1").unwrap());
}

#[test]
fn atomic_claim_has_one_winner_and_replays_by_operation_id() {
    let store = store();
    store.create_project("p1", "2026-01-01T00:00:00Z").unwrap();
    store
        .ensure_actor("agent-1", "agent", "cred-agent", "Agent", "t0")
        .unwrap();
    store
        .ensure_acceptance_profile("focused", 1, "sha256:policy", "{}", "t0")
        .unwrap();
    let work = WorkItem {
        id: WorkId::new("w1"),
        project_id: ProjectId::new("p1"),
        kind: WorkKind::Task,
        parent_id: None,
        title: "Claimable".into(),
        description: String::new(),
        lifecycle: PersistedLifecycle::Open,
        priority: 0,
        dispatch_policy: boreal_domain::DispatchPolicy::Automatic,
        hard_holds: Vec::new(),
        acceptance_profile: boreal_domain::AcceptanceProfile::focused(),
    };
    store.create_work(&work, "2026-01-01T00:00:00Z").unwrap();

    let winner = store
        .claim_work(
            "p1",
            "w1",
            "agent-1",
            "luna",
            None,
            "a1",
            "op1",
            "sha256:req",
            Some(0),
            "2026-01-01T00:00:00Z",
            "2026-01-01T00:30:00Z",
            "2026-01-01T02:00:00Z",
        )
        .unwrap();
    assert_eq!(winner.fence, 1);
    assert!(!winner.replayed);
    assert_eq!(store.project_revision("p1").unwrap().0, 1);

    let replay = store
        .claim_work(
            "p1",
            "w1",
            "agent-1",
            "luna",
            None,
            "a1",
            "op1",
            "sha256:req",
            Some(0),
            "2026-01-01T00:00:00Z",
            "2026-01-01T00:30:00Z",
            "2026-01-01T02:00:00Z",
        )
        .unwrap();
    assert!(replay.replayed);
    assert_eq!(replay.attempt_id, winner.attempt_id);

    let loser = store.claim_work(
        "p1",
        "w1",
        "agent-1",
        "luna",
        None,
        "a2",
        "op2",
        "sha256:req2",
        Some(1),
        "2026-01-01T00:00:01Z",
        "2026-01-01T00:30:01Z",
        "2026-01-01T02:00:01Z",
    );
    assert!(matches!(loser, Err(StoreError::Conflict(_))));
    assert_eq!(store.project_revision("p1").unwrap().0, 1);
}

#[test]
fn revisioned_work_reads_keep_total_separate_from_page_limit() {
    let store = store();
    base(&store);
    let page = store.list_work("p1", 1, 0).unwrap();
    assert_eq!(page.revision, SnapshotRevision(0));
    assert_eq!(page.total, 1);
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.items[0].work_id, "w1");
    assert!(matches!(
        store.list_work("p1", 0, 0),
        Err(StoreError::Invalid(_))
    ));
}

#[test]
fn current_attempt_lifecycle_persists_each_mutation_and_replays_atomically() {
    let store = store();
    base(&store);
    attempt(&store, "a1", "w1", "s1", 1);

    let mut accept = mutation(
        "a1",
        "w1",
        1,
        "op-accept",
        "t0",
        AttemptPhase::Claimed,
        AttemptMutationKind::Accept,
    );
    accept.expected_project_revision = Some(0);
    let accepted = store.apply_attempt_mutation(&accept).unwrap();
    assert_eq!(accepted.phase, AttemptPhase::Accepted);
    assert_eq!(accepted.revision, 1);
    let audit = store.audit_event("op-accept").unwrap().unwrap();
    assert_eq!(audit.event_type, "attempt.accepted");
    assert_eq!(audit.revision, accepted.revision);

    let replay = store.apply_attempt_mutation(&accept).unwrap();
    assert!(replay.replayed);
    assert_eq!(replay.revision, accepted.revision);
    assert_eq!(store.project_revision("p1").unwrap().0, 1);

    let started = store
        .apply_attempt_mutation(mutation(
            "a1",
            "w1",
            1,
            "op-start",
            "t0",
            AttemptPhase::Accepted,
            AttemptMutationKind::Start,
        ))
        .unwrap();
    assert_eq!(started.phase, AttemptPhase::Running);

    let heartbeat = store
        .apply_attempt_mutation(mutation(
            "a1",
            "w1",
            1,
            "op-heartbeat",
            "t0",
            AttemptPhase::Running,
            AttemptMutationKind::Heartbeat {
                phase: Some("tool".into()),
                tool: Some("cargo test".into()),
                process: Some("123".into()),
            },
        ))
        .unwrap();
    assert_eq!(heartbeat.phase, AttemptPhase::Running);
    assert_eq!(
        store
            .audit_event("op-heartbeat")
            .unwrap()
            .unwrap()
            .event_type,
        "lease.renewed"
    );
    assert_eq!(
        store.current_attempt("p1", "a1").unwrap().last_heartbeat_at,
        Some("t0".into())
    );

    let mut renew = mutation(
        "a1",
        "w1",
        1,
        "op-renew",
        "t0",
        AttemptPhase::Running,
        AttemptMutationKind::RenewLease {
            lease_deadline: "t1".into(),
        },
    );
    renew.expected_lease_deadline = Some("t0".into());
    // A stale lease expectation is rejected before the deadline is changed.
    let renewed = store.apply_attempt_mutation(&renew);
    assert!(matches!(renewed, Err(StoreError::Conflict(_))));
    // The fixture's original lease is t1, so the failed request above did not
    // write anything; remove the expectation to exercise the successful path.
    renew.expected_lease_deadline = None;
    let renewed = store.apply_attempt_mutation(&renew).unwrap();
    assert_eq!(renewed.lease_deadline, "t1");

    let submitted = store
        .apply_attempt_mutation(mutation(
            "a1",
            "w1",
            1,
            "op-submit",
            "t0",
            AttemptPhase::Running,
            AttemptMutationKind::Submit,
        ))
        .unwrap();
    assert_eq!(submitted.phase, AttemptPhase::Verifying);

    let mut release = mutation(
        "a1",
        "w1",
        1,
        "op-release",
        "t0",
        AttemptPhase::Verifying,
        AttemptMutationKind::Release,
    );
    release.reason = Some("test release".into());
    let released = store.apply_attempt_mutation(&release).unwrap();
    assert_eq!(released.phase, AttemptPhase::Released);
    assert!(matches!(
        store.current_attempt("p1", "a1"),
        Err(StoreError::NotFound { .. })
    ));
}

#[test]
fn fail_is_a_terminal_fenced_mutation_and_keeps_the_attempt_in_history() {
    let store = store();
    base(&store);
    attempt(&store, "a1", "w1", "s1", 1);

    store
        .apply_attempt_mutation(mutation(
            "a1",
            "w1",
            1,
            "op-accept-fail",
            "t0",
            AttemptPhase::Claimed,
            AttemptMutationKind::Accept,
        ))
        .unwrap();
    store
        .apply_attempt_mutation(mutation(
            "a1",
            "w1",
            1,
            "op-start-fail",
            "t0",
            AttemptPhase::Accepted,
            AttemptMutationKind::Start,
        ))
        .unwrap();
    let mut fail = mutation(
        "a1",
        "w1",
        1,
        "op-fail",
        "t0",
        AttemptPhase::Running,
        AttemptMutationKind::Fail,
    );
    fail.reason = Some("tool failed".into());
    let result = store.apply_attempt_mutation(&fail).unwrap();
    assert_eq!(result.phase, AttemptPhase::Failed);
    assert_eq!(
        store.audit_event("op-fail").unwrap().unwrap().event_type,
        "attempt.failed"
    );
    assert!(matches!(
        store.current_attempt("p1", "a1"),
        Err(StoreError::NotFound { .. })
    ));
}

#[test]
fn unix_millisecond_timestamps_are_compared_by_value() {
    let store = store();
    base(&store);
    store
        .execute_batch(
            "INSERT INTO attempt (
                attempt_id, work_id, actor_id, harness_id, session_id, fence,
                current, state, claimed_at, lease_deadline, max_attempt_deadline,
                config_identity, binary_identity, protocol_version, schema_version
             ) VALUES ('a1', 'w1', 'agent-1', 'luna', 's1', 1, 1, 'claimed',
                       'unix-ms:0', 'unix-ms:1800000', 'unix-ms:7200000',
                       'config', 'binary', '2', 2)",
        )
        .unwrap();

    let result = store
        .apply_attempt_mutation(mutation(
            "a1",
            "w1",
            1,
            "op-unix-renew",
            "unix-ms:2",
            AttemptPhase::Claimed,
            AttemptMutationKind::RenewLease {
                lease_deadline: "unix-ms:3600000".into(),
            },
        ))
        .unwrap();
    assert_eq!(result.lease_deadline, "unix-ms:3600000");
}

#[test]
fn lifecycle_rejects_stale_revision_fence_and_wrong_owner_without_writes() {
    let store = store();
    base(&store);
    attempt(&store, "a1", "w1", "s1", 1);

    let mut stale_revision = mutation(
        "a1",
        "w1",
        1,
        "op-stale-revision",
        "t0",
        AttemptPhase::Claimed,
        AttemptMutationKind::Accept,
    );
    stale_revision.expected_project_revision = Some(1);
    assert!(matches!(
        store.apply_attempt_mutation(&stale_revision),
        Err(StoreError::StaleRevision {
            expected: 1,
            actual: 0
        })
    ));

    let mut stale_fence = mutation(
        "a1",
        "w1",
        9,
        "op-stale-fence",
        "t0",
        AttemptPhase::Claimed,
        AttemptMutationKind::Accept,
    );
    stale_fence.expected_attempt_revision = Some(9);
    assert!(matches!(
        store.apply_attempt_mutation(&stale_fence),
        Err(StoreError::StaleFence {
            expected: 9,
            actual: 1
        })
    ));

    let mut wrong_owner = mutation(
        "a1",
        "w1",
        1,
        "op-wrong-owner",
        "t0",
        AttemptPhase::Claimed,
        AttemptMutationKind::Accept,
    );
    wrong_owner.actor_id = "agent-2".into();
    assert!(matches!(
        store.apply_attempt_mutation(&wrong_owner),
        Err(StoreError::WrongOwner { .. })
    ));
    assert_eq!(store.project_revision("p1").unwrap().0, 0);
    assert_eq!(
        store.current_attempt("p1", "a1").unwrap().phase,
        AttemptPhase::Claimed
    );
}

#[test]
fn expiry_and_cancel_are_fenced_and_release_the_reservation() {
    let store = store();
    base(&store);
    attempt(&store, "a1", "w1", "s1", 1);

    let not_expired = mutation(
        "a1",
        "w1",
        1,
        "op-too-early",
        "t0",
        AttemptPhase::Claimed,
        AttemptMutationKind::Expire {
            stop_confirmed: true,
        },
    );
    assert!(matches!(
        store.apply_attempt_mutation(&not_expired),
        Err(StoreError::NotExpired)
    ));

    let expired = mutation(
        "a1",
        "w1",
        1,
        "op-expire",
        "t2",
        AttemptPhase::Claimed,
        AttemptMutationKind::Expire {
            stop_confirmed: true,
        },
    );
    let expired = store.apply_attempt_mutation(&expired).unwrap();
    assert_eq!(expired.phase, AttemptPhase::Expired);
    assert!(store
        .current_attempt_for_work("p1", "w1")
        .unwrap()
        .is_none());

    // A replacement claim is possible only after the expired attempt becomes
    // historical, and it receives the next monotonic fence.
    let replacement = store
        .claim_work(
            "p1",
            "w1",
            "agent-1",
            "luna",
            Some("s1"),
            "a2",
            "op-claim-2",
            "sha256:claim-2",
            Some(1),
            "t3",
            "t4",
            "t5",
        )
        .unwrap();
    assert_eq!(replacement.fence, 2);

    let cancelled = mutation(
        "a2",
        "w1",
        2,
        "op-cancel",
        "t3",
        AttemptPhase::Claimed,
        AttemptMutationKind::Cancel {
            stop_confirmed: true,
        },
    );
    let cancelled = store.apply_attempt_mutation(&cancelled).unwrap();
    assert_eq!(cancelled.phase, AttemptPhase::Cancelled);
    assert_eq!(
        store.audit_event("op-cancel").unwrap().unwrap().event_type,
        "work.cancelled"
    );
    assert!(store
        .current_attempt_for_work("p1", "w1")
        .unwrap()
        .is_none());
}

#[test]
fn receipt_subject_and_fence_failures_are_retained_as_historical_facts() {
    let store = store();
    base(&store);
    attempt(&store, "a1", "w1", "s1", 1);

    let wrong_subject = receipt_request(
        "r-wrong-subject",
        "w2",
        1,
        "op-wrong-subject",
        None,
        ReceiptOutcome::Passed,
    );
    assert!(matches!(
        store.insert_receipt(&wrong_subject),
        Err(StoreError::WrongSubject { .. })
    ));
    assert_eq!(
        store.receipt("r-wrong-subject").unwrap().unwrap().result,
        ReceiptOutcome::Rejected
    );

    let stale = receipt_request(
        "r-stale-fence",
        "w1",
        9,
        "op-stale-fence-receipt",
        None,
        ReceiptOutcome::Passed,
    );
    assert!(matches!(
        store.insert_receipt(&stale),
        Err(StoreError::StaleFence { .. })
    ));
    assert_eq!(
        store.receipt("r-stale-fence").unwrap().unwrap().result,
        ReceiptOutcome::Stale
    );
    assert_eq!(store.project_revision("p1").unwrap().0, 2);
    assert_eq!(
        store
            .audit_event("op-stale-fence-receipt")
            .unwrap()
            .unwrap()
            .event_type,
        "receipt.rejected"
    );
}

fn proof_store() -> SqliteStore {
    let store = store();
    base(&store);
    store
        .execute_batch(
            "INSERT INTO source_version
             (source_version_id, project_id, origin, access_scope, content_digest,
              media_type, byte_count, captured_at, parser_identity, availability, citation_json)
             VALUES ('source-1', 'p1', 'one', 'project', 'sha256:one',
                     'text/plain', 1, 't0', 'parser/1', 'available', '[]');
             INSERT INTO source_version
             (source_version_id, project_id, origin, access_scope, content_digest,
              media_type, byte_count, captured_at, parser_identity, availability, citation_json)
             VALUES ('source-2', 'p1', 'two', 'project', 'sha256:two',
                     'text/plain', 1, 't0', 'parser/1', 'available', '[]');
             INSERT INTO gate
             (gate_id, work_id, profile_id, profile_version, kind, required, subject_ref, updated_at)
             VALUES ('verification', 'w1', 'default', 1, 'verification', 1, '', 't0');",
        )
        .unwrap();
    attempt(&store, "a1", "w1", "s1", 1);
    store
        .execute_batch("UPDATE attempt SET source_version_id = 'source-1' WHERE attempt_id = 'a1'")
        .unwrap();
    store
}

fn proof_receipt(receipt_id: &str, operation_id: &str) -> ReceiptInsertRequest {
    let mut request = receipt_request(
        receipt_id,
        "w1",
        1,
        operation_id,
        Some("verification"),
        ReceiptOutcome::Passed,
    );
    request.source_version_id = Some("source-1".into());
    request.acceptance.as_mut().unwrap().source_version_id = Some("source-1".into());
    request
}

#[test]
fn receipt_commit_rechecks_current_source_config_and_profile_context() {
    for (case, mutation, expected_code) in [
        (
            "old-attempt",
            "UPDATE attempt SET current = 0, state = 'released', terminal_at = 't1', terminal_reason = 'test' WHERE attempt_id = 'a1'",
            "receipt_attempt_not_current",
        ),
        (
            "source",
            "UPDATE attempt SET source_version_id = 'source-2' WHERE attempt_id = 'a1'",
            "receipt_source_mismatch",
        ),
        (
            "config",
            "UPDATE attempt SET config_identity = 'changed' WHERE attempt_id = 'a1'",
            "receipt_config_mismatch",
        ),
        (
            "profile",
            "INSERT INTO acceptance_profile VALUES ('changed', 1, 'sha256:changed', '{}', 't0'); UPDATE work_item SET acceptance_profile_id = 'changed' WHERE work_id = 'w1'",
            "receipt_policy_mismatch",
        ),
    ] {
        let store = proof_store();
        let request = proof_receipt(&format!("receipt-{case}"), &format!("operation-{case}"));
        admit_execution(&store, &request);
        store.execute_batch(mutation).unwrap();
        assert!(store.insert_receipt(&request).is_err(), "{case} must reject");
        let retained = store.receipt(&request.receipt_id).unwrap().unwrap();
        assert_eq!(retained.result, ReceiptOutcome::Rejected, "{case}");
        assert_eq!(retained.rejection_code.as_deref(), Some(expected_code), "{case}");
        assert_ne!(
            store
                .gate("p1", "w1", "verification")
                .unwrap()
                .unwrap()
                .state,
            GateState::Satisfied,
            "{case} must not satisfy the gate"
        );
    }
}

#[test]
fn receipt_commit_rejects_wrong_gate_and_forged_witness_without_satisfaction() {
    let store = proof_store();
    let mut wrong_gate = proof_receipt("receipt-wrong-gate", "operation-wrong-gate");
    wrong_gate.gate_id = Some("other-gate".into());
    wrong_gate.acceptance.as_mut().unwrap().gate_id = "other-gate".into();
    assert!(store.insert_receipt(&wrong_gate).is_err());
    assert_eq!(
        store
            .receipt("receipt-wrong-gate")
            .unwrap()
            .unwrap()
            .rejection_code
            .as_deref(),
        Some("receipt_subject_mismatch")
    );

    let mut forged = proof_receipt("receipt-forged", "operation-forged");
    forged.submission_kind = ReceiptSubmissionKind::ExternalImport;
    assert!(store.insert_receipt(&forged).is_err());
    assert_eq!(
        store
            .receipt("receipt-forged")
            .unwrap()
            .unwrap()
            .rejection_code
            .as_deref(),
        Some("witnessed_receipt_import_denied")
    );
    assert_ne!(
        store
            .gate("p1", "w1", "verification")
            .unwrap()
            .unwrap()
            .state,
        GateState::Satisfied
    );
}

#[test]
fn receipt_replay_binds_the_complete_canonical_request() {
    let store = proof_store();
    let request = proof_receipt("receipt-replay", "operation-replay");
    admit_execution(&store, &request);
    store.insert_receipt(&request).unwrap();
    assert_eq!(
        store
            .evidence_execution(&request.operation_id)
            .unwrap()
            .unwrap()
            .state,
        boreal_store::EvidenceExecutionState::ReceiptCommitted
    );
    assert!(store.insert_receipt(&request).unwrap().replayed);

    let mut changed = request.clone();
    changed.output_digest = Some("sha256:different".into());
    assert!(matches!(
        store.insert_receipt(&changed),
        Err(StoreError::Conflict(_))
    ));
}

#[test]
fn witnessed_receipt_requires_durable_exited_execution() {
    let store = proof_store();
    let request = proof_receipt("receipt-no-admission", "operation-no-admission");
    assert!(store.insert_receipt(&request).is_err());
    let retained = store.receipt(&request.receipt_id).unwrap().unwrap();
    assert_eq!(retained.result, ReceiptOutcome::Rejected);
    assert_eq!(
        retained.rejection_code.as_deref(),
        Some("witnessed_execution_not_admitted")
    );
    assert_ne!(
        store
            .gate("p1", "w1", "verification")
            .unwrap()
            .unwrap()
            .state,
        GateState::Satisfied
    );
}

#[test]
fn failed_receipt_is_retained_and_explained_by_gate_diagnostics() {
    let store = store();
    base(&store);
    attempt(&store, "a1", "w1", "s1", 1);
    store
        .execute_batch(
            "INSERT INTO gate (gate_id, work_id, profile_id, profile_version, kind, subject_ref, updated_at)
             VALUES ('verification', 'w1', 'default', 1, 'verification', '', 't0')",
        )
        .unwrap();

    let request = receipt_request(
        "r-failed",
        "w1",
        1,
        "op-failed-receipt",
        Some("verification"),
        ReceiptOutcome::Failed,
    );
    admit_execution(&store, &request);
    let result = store.insert_receipt(request).unwrap();
    assert!(!result.replayed);
    assert_eq!(result.receipt.result, ReceiptOutcome::Failed);
    assert_eq!(store.receipt("r-failed").unwrap().unwrap().exit_code, 1);

    let diagnostics = store.gate_diagnostics("p1", "w1", "a1", 1).unwrap();
    assert_eq!(diagnostics.missing, vec!["verification"]);
    assert_eq!(diagnostics.gates[0].receipt_id.as_deref(), Some("r-failed"));
    assert_eq!(diagnostics.gates[0].reason.as_deref(), Some("failed"));
}

#[test]
fn gate_updates_are_revisioned_and_diagnostics_list_only_required_gaps() {
    let store = store();
    base(&store);
    store
        .execute_batch(
            "INSERT INTO gate (gate_id, work_id, profile_id, profile_version, kind, subject_ref, updated_at)
             VALUES ('checkpoint', 'w1', 'default', 1, 'checkpoint', '', 't0');
             INSERT INTO gate (gate_id, work_id, profile_id, profile_version, kind, subject_ref, updated_at)
             VALUES ('verification', 'w1', 'default', 1, 'verification', '', 't0')",
        )
        .unwrap();
    let update = store
        .update_gate_state(&GateStateUpdateRequest {
            project_id: "p1".into(),
            work_id: "w1".into(),
            gate_id: "verification".into(),
            state: GateState::Satisfied,
            actor_id: "agent-1".into(),
            session_id: Some("s1".into()),
            operation_id: "op-gate-satisfied".into(),
            request_digest: "sha256:gate".into(),
            expected_project_revision: Some(0),
            updated_at: "t1".into(),
        })
        .unwrap();
    assert_eq!(update.revision, 1);
    assert_eq!(
        store
            .gate("p1", "w1", "verification")
            .unwrap()
            .unwrap()
            .state,
        GateState::Satisfied
    );
    let diagnostics = store.gate_diagnostics_for_work("p1", "w1").unwrap();
    assert_eq!(diagnostics.missing, vec!["checkpoint"]);
}

#[test]
fn independent_review_satisfies_review_gate_and_self_review_uses_trigger() {
    let store = store();
    base(&store);
    attempt(&store, "a1", "w1", "s1", 1);
    store
        .execute_batch(
            "INSERT INTO gate (gate_id, work_id, profile_id, profile_version, kind, subject_ref, updated_at)
             VALUES ('review', 'w1', 'default', 1, 'review', '', 't0')",
        )
        .unwrap();

    let accepted = store
        .insert_review(review_request("op-review", "reviewer-1"))
        .unwrap();
    assert_eq!(accepted.revision, 1);
    assert_eq!(
        store.review("review-op-review").unwrap().unwrap().decision,
        ReviewDecision::Accepted
    );
    assert_eq!(
        store.gate("p1", "w1", "review").unwrap().unwrap().state,
        GateState::Satisfied
    );
    assert_eq!(
        store.audit_event("op-review").unwrap().unwrap().event_type,
        "review.accepted"
    );

    let self_review = review_request("op-self-review", "agent-1");
    assert!(matches!(
        store.insert_review(&self_review),
        Err(StoreError::Constraint {
            kind: ConstraintKind::SelfReview,
            ..
        })
    ));
    assert!(store.review("review-op-self-review").unwrap().is_none());
}

#[test]
fn close_intent_is_idempotent_readable_and_rejects_then_finalizes_with_audit() {
    let store = store();
    base(&store);
    attempt(&store, "a1", "w1", "s1", 1);
    store
        .execute_batch(
            "INSERT INTO gate (gate_id, work_id, profile_id, profile_version, kind, subject_ref, updated_at)
             VALUES ('verification', 'w1', 'default', 1, 'verification', '', 't0')",
        )
        .unwrap();
    store
        .apply_attempt_mutation(mutation(
            "a1",
            "w1",
            1,
            "op-close-accept",
            "t0",
            AttemptPhase::Claimed,
            AttemptMutationKind::Accept,
        ))
        .unwrap();
    store
        .apply_attempt_mutation(mutation(
            "a1",
            "w1",
            1,
            "op-close-start",
            "t0",
            AttemptPhase::Accepted,
            AttemptMutationKind::Start,
        ))
        .unwrap();
    store
        .apply_attempt_mutation(mutation(
            "a1",
            "w1",
            1,
            "op-close-submit",
            "t0",
            AttemptPhase::Running,
            AttemptMutationKind::Submit,
        ))
        .unwrap();

    let create = close_request("op-close-create", "ci-1");
    let created = store.create_close_intent(&create).unwrap();
    let replay = store.create_close_intent(&create).unwrap();
    assert!(replay.replayed);
    assert_eq!(replay.revision, created.revision);
    assert_eq!(
        store
            .read_close_intent_operation("p1", "op-close-create")
            .unwrap()
            .unwrap()
            .close_intent
            .state,
        boreal_store::CloseIntentState::Open
    );

    let rejected = store
        .finalize_close_intent(close_request("op-close-first-finalize", "ci-1"))
        .unwrap();
    assert_eq!(
        rejected.close_intent.state,
        boreal_store::CloseIntentState::Open
    );
    assert_eq!(rejected.diagnostics.unwrap().missing, vec!["verification"]);
    assert_eq!(
        store
            .operation("op-close-first-finalize")
            .unwrap()
            .unwrap()
            .outcome,
        OperationOutcome::Rejected
    );

    // A work-level gate projection cannot satisfy a current attempt by
    // itself. Record proof bound to this exact attempt/fence instead.
    let mut proof = receipt_request(
        "receipt-close-verification",
        "w1",
        1,
        "op-close-gate",
        Some("verification"),
        ReceiptOutcome::Passed,
    );
    proof.attestation = ReceiptAttestation::ExternalAttested;
    proof.submission_kind = ReceiptSubmissionKind::ExternalImport;
    store.insert_receipt(proof).unwrap();
    let finalized = store
        .finalize_close_intent(close_request("op-close-finalize", "ci-1"))
        .unwrap();
    assert_eq!(
        finalized.close_intent.state,
        boreal_store::CloseIntentState::Finalized
    );
    assert_eq!(
        store.list_work("p1", 10, 0).unwrap().items[0].lifecycle,
        "closed"
    );
    assert_eq!(
        store
            .audit_event("op-close-finalize")
            .unwrap()
            .unwrap()
            .event_type,
        "work.closed"
    );
    let replay = store
        .finalize_close_intent(close_request("op-close-finalize", "ci-1"))
        .unwrap();
    assert!(replay.replayed);
    assert_eq!(replay.revision, finalized.revision);
}
