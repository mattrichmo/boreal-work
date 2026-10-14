use boreal_application::{
    AcceptanceDefinition, AttemptRequest, EndAttemptRequest, ExecutorAttestation,
    HeartbeatAttemptRequest, LivenessMetadata, ReceiptCoverage, ReceiptPayload,
    RenewLeaseAttemptRequest, SqliteAttemptAdapter, SummaryPayload, WorkApplication,
};
use boreal_domain::{
    AcceptanceProfile, ActorId, ActorRole, AttemptId, ConfigIdentity, DispatchPolicy, Fence, GateId,
    GateKind, HarnessId, OperationId, PersistedLifecycle, ProfileId, ProjectId, ReceiptResult,
    SourceVersionId, TimestampMs, WorkId, WorkItem, WorkKind,
};
use boreal_store::{
    SqliteStore,
    acceptance::{AcceptanceStore, FinalResultBindingRequest},
    identity::{DatabaseIdentity, IdentityStore, WorkspaceBinding},
    principals::PrincipalGrantRequest,
    recovery::{IdentityBoundRecoveryResolutionInput, RecoveryResolutionInput},
};

const SCHEMA: &str = include_str!("../../../project/spec/schema-v2.sql");
const PRODUCTION_SCHEMA: &str = include_str!("../../../project/spec/schema-production.sql");

fn request(operation_id: &str, at: u64) -> AttemptRequest {
    AttemptRequest::new(
        ProjectId::new("p1"),
        WorkId::new("w1"),
        AttemptId::new("a1"),
        ActorId::new("agent-1"),
        Some(HarnessId::new("luna")),
        None,
        Fence::new(1),
        OperationId::new(operation_id),
        format!("sha256:{operation_id}"),
        TimestampMs(at),
    )
}

fn passed_receipt(gate_id: &str, gate_kind: GateKind, operation_id: &str) -> ReceiptPayload {
    ReceiptPayload {
        schema_version: "boreal.receipt.v1".to_owned(),
        receipt_id: boreal_domain::ReceiptId::new(format!("receipt-{gate_id}")),
        operation_id: OperationId::new(operation_id),
        work_id: WorkId::new("w-close"),
        attempt_id: AttemptId::new("a-close"),
        fence: Fence::new(1),
        gate_id: GateId::new(gate_id),
        executable: "./check".to_owned(),
        argv: vec!["./check".to_owned(), "--json".to_owned()],
        cwd: "/workspace".to_owned(),
        exit_code: 0,
        started_at: TimestampMs(10),
        ended_at: TimestampMs(11),
        source_snapshot_hash: SourceVersionId::new("source-1"),
        config_identity: ConfigIdentity::new("config-1"),
        environment_fingerprint: "env-1".to_owned(),
        output_digest: Some("output-1".to_owned()),
        output_ref: None,
        coverage: ReceiptCoverage {
            kind: gate_kind,
            profile_id: ProfileId::new("focused"),
            profile_version: "1".to_owned(),
            observables: Vec::new(),
        },
        // This fixture represents imported, externally attested evidence.
        // Trusted Boreal-witnessed receipts are only admitted through the
        // bounded executor path, not the JSON import façade.
        attestation: ExecutorAttestation::ExternalAttested,
        result: ReceiptResult::Passed,
    }
}

#[test]
fn checked_work_creation_uses_snapshot_revision_in_application_boundary() {
    let store = SqliteStore::open_in_memory(SCHEMA).unwrap();
    let app = WorkApplication::new(&store);
    let project = ProjectId::new("p-create-check");
    app.init_project(
        &project,
        "agent-1",
        "agent",
        "cred",
        "Agent",
        "unix-ms:0",
        "op-init-create-check",
    )
    .unwrap();
    let revision = store.project_revision(project.as_str()).unwrap().0;
    let work = WorkItem::new(
        project.clone(),
        WorkId::new("w-create-check"),
        WorkKind::Task,
        None,
        "checked create",
    )
    .open();
    app.create_work_as_checked(
        &work,
        "agent-1",
        Some(revision),
        "unix-ms:1",
        "op-create-check",
    )
    .unwrap();
    let stale = WorkItem::new(
        project.clone(),
        WorkId::new("w-create-stale"),
        WorkKind::Task,
        None,
        "stale create",
    )
    .open();
    assert!(matches!(
        app.create_work_as_checked(
            &stale,
            "agent-1",
            Some(revision),
            "unix-ms:2",
            "op-create-stale",
        ),
        Err(boreal_application::ApplicationError::Store(
            boreal_store::StoreError::StaleRevision { .. }
        ))
    ));
    assert!(store
        .work(project.as_str(), "w-create-stale")
        .unwrap()
        .is_none());
}

#[test]
fn sqlite_adapter_persists_fenced_lifecycle_and_replays() {
    let store = SqliteStore::open_in_memory(SCHEMA).unwrap();
    let app = WorkApplication::new(&store);
    let project = ProjectId::new("p1");
    app.init_project(
        &project,
        "agent-1",
        "agent",
        "cred",
        "Agent",
        "unix-ms:0",
        "op_init",
    )
    .unwrap();
    app.create_work(
        &WorkItem {
            id: WorkId::new("w1"),
            project_id: project.clone(),
            kind: WorkKind::Task,
            parent_id: None,
            title: "Lifecycle".to_owned(),
            description: String::new(),
            lifecycle: PersistedLifecycle::Open,
            priority: 0,
            dispatch_policy: DispatchPolicy::Automatic,
            hard_holds: Vec::new(),
            acceptance_profile: AcceptanceProfile::focused(),
        },
        "unix-ms:0",
        "op_work",
    )
    .unwrap();
    app.claim(
        &project,
        "w1",
        "agent-1",
        "luna",
        None,
        "a1",
        "op_claim",
        "sha256:op_claim",
        None,
        "unix-ms:0",
        "unix-ms:1800000",
        "unix-ms:7200000",
    )
    .unwrap();

    let adapter = SqliteAttemptAdapter::new(&store);
    let accepted = app.accept(&adapter, request("op_accept", 1)).unwrap();
    assert_eq!(accepted.value.phase, boreal_domain::AttemptPhase::Accepted);
    let replay = app.accept(&adapter, request("op_accept", 1)).unwrap();
    assert!(!replay.changed);
    assert!(replay.value.replayed);

    app.start(&adapter, request("op_start", 2)).unwrap();
    app.heartbeat(
        &adapter,
        HeartbeatAttemptRequest {
            attempt: request("op_heartbeat", 3),
            liveness: LivenessMetadata::empty(),
        },
    )
    .unwrap();
    app.renew_lease(
        &adapter,
        RenewLeaseAttemptRequest {
            attempt: request("op_renew", 4),
            lease_ttl_ms: 1000,
        },
    )
    .unwrap();
    let submitted = app.submit(&adapter, request("op_submit", 5)).unwrap();
    assert_eq!(
        submitted.value.phase,
        boreal_domain::AttemptPhase::Verifying
    );
    let released = app
        .release(
            &adapter,
            EndAttemptRequest {
                attempt: request("op_release", 6),
                reason: Some("done".to_owned()),
            },
        )
        .unwrap();
    assert_eq!(released.value.phase, boreal_domain::AttemptPhase::Released);
    assert!(store.current_attempt("p1", "a1").is_err());

    let stale = request("op_stale", 7);
    assert!(app.start(&adapter, stale).is_err());
}

#[test]
fn accepted_receipts_drive_durable_proof_gated_closeout() {
    let store = SqliteStore::open_in_memory(PRODUCTION_SCHEMA).unwrap();
    let app = WorkApplication::new(&store);
    let project = ProjectId::new("p-close");
    store.create_project("p-close", "unix-ms:0").unwrap();
    IdentityStore::new(&store)
        .install(
            &DatabaseIdentity::new("sqlite-lifecycle-database", 1).unwrap(),
            "unix-ms:1",
        )
        .unwrap();
    IdentityStore::new(&store)
        .bind_project(
            "p-close",
            &WorkspaceBinding::new(
                "/tmp/sqlite-lifecycle",
                "/tmp/sqlite-lifecycle",
                "sha256:sqlite-lifecycle-workspace",
            )
            .unwrap(),
            "unix-ms:1",
        )
        .unwrap();
    store
        .bootstrap_project_principal(&PrincipalGrantRequest {
            project_id: "p-close".to_owned(),
            actor_id: "close-operator".to_owned(),
            session_id: None,
            principal_actor_id: "close-operator".to_owned(),
            role: ActorRole::Operator,
            independent: true,
            credential: format!("bwrk1_{}", "a".repeat(64)),
            expires_at_ms: None,
            display_name: "Closeout operator".to_owned(),
            reason: "bootstrap sqlite lifecycle closeout fixture".to_owned(),
            expected_revision: store.project_revision("p-close").unwrap().0,
            operation_id: "op-close-bootstrap".to_owned(),
            at: "unix-ms:2".to_owned(),
        })
        .unwrap();
    store
        .grant_principal(&PrincipalGrantRequest {
            project_id: "p-close".to_owned(),
            actor_id: "close-operator".to_owned(),
            session_id: None,
            principal_actor_id: "agent-1".to_owned(),
            role: ActorRole::Agent,
            independent: false,
            credential: format!("bwrk1_{}", "b".repeat(64)),
            expires_at_ms: None,
            display_name: "Closeout agent".to_owned(),
            reason: "grant closeout fixture agent".to_owned(),
            expected_revision: store.project_revision("p-close").unwrap().0,
            operation_id: "op-close-agent-grant".to_owned(),
            at: "unix-ms:2".to_owned(),
        })
        .unwrap();
    app.register_session_as(
        &project,
        "close-operator",
        "luna",
        "close-operator-session",
        "unix-ms:3",
        "op-close-operator-session",
    )
    .unwrap();
    app.register_session_as(
        &project,
        "agent-1",
        "luna",
        "close-agent-session",
        "unix-ms:3",
        "op-close-agent-session",
    )
    .unwrap();
    app.create_work_as_session_checked(
        &WorkItem {
            id: WorkId::new("w-close"),
            project_id: project.clone(),
            kind: WorkKind::Task,
            parent_id: None,
            title: "Closeout".to_owned(),
            description: String::new(),
            lifecycle: PersistedLifecycle::Open,
            priority: 0,
            dispatch_policy: DispatchPolicy::Automatic,
            hard_holds: Vec::new(),
            acceptance_profile: AcceptanceProfile::focused(),
        },
        "close-operator",
        "close-operator-session",
        Some(store.project_revision("p-close").unwrap().0),
        "unix-ms:4",
        "op-work-close",
    )
    .unwrap();
    store
        .execute_batch(
            "INSERT INTO source_version
             (source_version_id, project_id, origin, access_scope, content_digest,
              media_type, byte_count, captured_at, parser_identity, availability, citation_json)
             VALUES ('source-1', 'p-close', 'fixture.md', 'project',
                     'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                     'text/markdown', 1, 'unix-ms:5', 'parser/1', 'available', '[]');",
        )
        .unwrap();
    app.claim_with_context(
        &project,
        "w-close",
        "agent-1",
        "luna",
        Some("close-agent-session"),
        "a-close",
        "op-claim-close",
        "sha256:claim-close",
        None,
        "unix-ms:10",
        "unix-ms:1800010",
        "unix-ms:7200010",
        Some("source-1"),
        "config-1",
    )
    .unwrap();
    let adapter = SqliteAttemptAdapter::new(&store);
    app.accept(
        &adapter,
        request_for_session(
            "p-close",
            "w-close",
            "a-close",
            "close-agent-session",
            "op-accept-close",
            11,
        ),
    )
    .unwrap();
    app.start(
        &adapter,
        request_for_session(
            "p-close",
            "w-close",
            "a-close",
            "close-agent-session",
            "op-start-close",
            12,
        ),
    )
    .unwrap();

    let result_digest =
        "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    store
        .execute_batch(&format!(
            "INSERT INTO source_version
             (source_version_id, project_id, origin, access_scope, content_digest,
              media_type, byte_count, captured_at, parser_identity, availability, citation_json)
             VALUES ('source-result', 'p-close', 'result.md', 'project', '{result_digest}',
                     'text/markdown', 1, 'unix-ms:12', 'parser/1', 'available', '[]');"
        ))
        .unwrap();
    let (entity_revision, proof_revision) = store.work_revisions("p-close", "w-close").unwrap();
    AcceptanceStore::new(&store)
        .bind_final_result(&FinalResultBindingRequest {
            project_id: "p-close".to_owned(),
            work_id: "w-close".to_owned(),
            actor_id: "agent-1".to_owned(),
            session_id: "close-agent-session".to_owned(),
            attempt_id: "a-close".to_owned(),
            fence: 1,
            expected_project_revision: store.project_revision("p-close").unwrap().0,
            expected_entity_revision: entity_revision,
            expected_proof_revision: proof_revision,
            source_version_id: "source-result".to_owned(),
            content_digest: result_digest.to_owned(),
            operation_id: "op-final-result-close".to_owned(),
            at: "unix-ms:13".to_owned(),
        })
        .unwrap();
    let summary = SummaryPayload {
        summary_id: "summary-close".to_owned(),
        work_id: WorkId::new("w-close"),
        attempt_id: AttemptId::new("a-close"),
        fence: Fence::new(1),
        source_snapshot_hash: SourceVersionId::new("source-result"),
        config_identity: ConfigIdentity::new("config-1"),
        profile_id: ProfileId::new("focused"),
        profile_version: "1".to_owned(),
        body_digest: boreal_application::sha256_content_digest(b"x"),
        body_size: 1,
    };
    let first_insert = app
        .record_summary(
            "agent-1",
            Some("close-agent-session"),
            &summary,
            "op-summary-close",
            None,
            TimestampMs(14),
        )
        .unwrap();
    app.record_summary_with_body(
        "p-close",
        "agent-1",
        Some("close-agent-session"),
        &summary,
        "x",
        "op-summary-close",
        None,
        TimestampMs(15),
    )
    .unwrap();
    let summary_readback = app
        .read_summary_artifact("p-close", "summary-close")
        .unwrap();
    assert_eq!(summary_readback.summary.source_version_id, "source-result");
    assert_eq!(summary_readback.body.as_deref(), Some("x"));
    app.submit(
        &adapter,
        request_for_session(
            "p-close",
            "w-close",
            "a-close",
            "close-agent-session",
            "op-submit-close",
            16,
        ),
    )
    .unwrap();

    let receipts: Vec<_> = [
        ("checkpoint", GateKind::Checkpoint, "op-receipt-checkpoint"),
        (
            "verification",
            GateKind::Verification,
            "op-receipt-verification",
        ),
        ("summary", GateKind::Summary, "op-receipt-summary"),
    ]
    .into_iter()
    .map(|(gate, kind, operation)| {
        let mut receipt = passed_receipt(gate, kind, operation);
        receipt.source_snapshot_hash = SourceVersionId::new("source-result");
        receipt
    })
    .collect();
    for receipt in &receipts {
        app.record_receipt(
            "agent-1",
            Some("close-agent-session"),
            receipt,
            None,
            TimestampMs(17),
        )
        .unwrap();
    }
    let intent = boreal_application::CloseIntent {
        work_id: WorkId::new("w-close"),
        attempt_id: AttemptId::new("a-close"),
        fence: Fence::new(1),
        source_snapshot_hash: SourceVersionId::new("source-result"),
        config_identity: ConfigIdentity::new("config-1"),
        profile_id: ProfileId::new("focused"),
        profile_version: "1".to_owned(),
        summary_id: Some("summary-close".to_owned()),
    };
    let close_request = app.request_close(
        "agent-1",
        Some("close-agent-session"),
        &intent,
        None,
        TimestampMs(18),
    )
    .unwrap();
    let recovery_obligation_id = format!(
        "{}:recovery:submission",
        close_request.close_intent.operation_id
    );
    let pending_recovery = store
        .recovery_obligation("p-close", &recovery_obligation_id)
        .unwrap()
        .expect("submission records pending resource release");
    assert_eq!(pending_recovery.state, "unresolved");
    assert_eq!(pending_recovery.resource_state, "release_pending");
    let recovery_resolution = IdentityBoundRecoveryResolutionInput {
        context: IdentityStore::new(&store).context("p-close").unwrap(),
        operation_id: "op-close-release-ack".to_owned(),
        request_digest: "sha256:close-release-ack".to_owned(),
        expected_project_revision: Some(store.project_revision("p-close").unwrap().0),
        session_id: Some("close-agent-session".to_owned()),
        resolution: RecoveryResolutionInput {
            project_id: "p-close".to_owned(),
            obligation_id: recovery_obligation_id,
            resolution_id: "resolve-close-release".to_owned(),
            actor_id: "agent-1".to_owned(),
            outcome: "resource_released".to_owned(),
            reason: "test harness confirmed the submitted attempt process had stopped".to_owned(),
            resource_state: "released".to_owned(),
            at: "unix-ms:18".to_owned(),
        },
    };
    let resolved_recovery = app
        .resolve_attempt_recovery_with_identity(&recovery_resolution)
        .unwrap();
    assert_eq!(resolved_recovery.state, "resolved");
    assert_eq!(resolved_recovery.resource_state, "released");
    let closeout = boreal_application::CloseoutInput {
        definition: AcceptanceDefinition::focused(),
        work_id: WorkId::new("w-close"),
        attempt: boreal_application::AttemptSnapshot {
            project_id: ProjectId::new("p-close"),
            work_id: WorkId::new("w-close"),
            attempt_id: AttemptId::new("a-close"),
            actor_id: ActorId::new("agent-1"),
            harness_id: Some(HarnessId::new("luna")),
            session_id: Some(boreal_domain::SessionId::new("close-agent-session")),
            fence: Fence::new(1),
            phase: boreal_domain::AttemptPhase::Verifying,
            claimed_at: TimestampMs(10),
            accepted_at: Some(TimestampMs(11)),
            lease_deadline: TimestampMs(1_800_010),
            hard_deadline: TimestampMs(7_200_010),
            current: true,
        },
        expected_fence: Fence::new(1),
        source_snapshot_hash: SourceVersionId::new("source-result"),
        config_identity: ConfigIdentity::new("config-1"),
        policy_version: "1".to_owned(),
        receipts,
        gates: Vec::new(),
        review: None,
        summary: Some(summary.clone()),
        close_intent: Some(intent.clone()),
    };
    let replay = app
        .record_summary(
            "agent-1",
            Some("close-agent-session"),
            &summary,
            "op-summary-close",
            None,
            TimestampMs(19),
        )
        .unwrap();
    let replay_with_body = app
        .record_summary_with_body(
            "p-close",
            "agent-1",
            Some("close-agent-session"),
            &summary,
            "x",
            "op-summary-close",
            None,
            TimestampMs(20),
        )
        .unwrap();
    assert!(!first_insert.replayed);
    assert!(replay.replayed);
    assert!(replay_with_body.replayed);
    let finalized = app
        .finalize_close_checked(
            "agent-1",
            Some("close-agent-session"),
            &closeout,
            None,
            TimestampMs(21),
        )
        .unwrap();
    assert_eq!(
        finalized.close_intent.state,
        boreal_store::CloseIntentState::Finalized
    );
    assert_eq!(
        store.list_work("p-close", 10, 0).unwrap().items[0].lifecycle,
        "closed"
    );
}

fn request_for(
    project: &str,
    work: &str,
    attempt: &str,
    operation: &str,
    at: u64,
) -> AttemptRequest {
    AttemptRequest::new(
        ProjectId::new(project),
        WorkId::new(work),
        AttemptId::new(attempt),
        ActorId::new("agent-1"),
        Some(HarnessId::new("luna")),
        None,
        Fence::new(1),
        OperationId::new(operation),
        format!("sha256:{operation}"),
        TimestampMs(at),
    )
}

fn request_for_session(
    project: &str,
    work: &str,
    attempt: &str,
    session: &str,
    operation: &str,
    at: u64,
) -> AttemptRequest {
    let mut request = request_for(project, work, attempt, operation, at);
    request.session_id = Some(boreal_domain::SessionId::new(session));
    request
}

#[test]
fn acceptance_gates_are_namespaced_per_work() {
    let store = SqliteStore::open_in_memory(SCHEMA).unwrap();
    store
        .execute_batch(
            "INSERT INTO project
             (project_id, schema_version, status_contract_version, project_revision, created_at, updated_at)
             VALUES ('p-gates', 2, 'boreal.work-status/2', 0, 'unix-ms:0', 'unix-ms:0');",
        )
        .unwrap();
    for work_id in ["w-a", "w-b"] {
        store
            .create_work(
                &WorkItem {
                    id: WorkId::new(work_id),
                    project_id: ProjectId::new("p-gates"),
                    kind: WorkKind::Task,
                    parent_id: None,
                    title: work_id.to_owned(),
                    description: String::new(),
                    lifecycle: PersistedLifecycle::Open,
                    priority: 0,
                    dispatch_policy: DispatchPolicy::Automatic,
                    hard_holds: Vec::new(),
                    acceptance_profile: AcceptanceProfile::focused(),
                },
                "unix-ms:0",
            )
            .unwrap();
    }
    assert_eq!(
        store
            .gate("p-gates", "w-a", "w-a:checkpoint")
            .unwrap()
            .unwrap()
            .work_id,
        "w-a"
    );
    assert_eq!(
        store
            .gate("p-gates", "w-b", "w-b:checkpoint")
            .unwrap()
            .unwrap()
            .work_id,
        "w-b"
    );
}
