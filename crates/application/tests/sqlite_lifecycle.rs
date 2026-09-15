use boreal_application::{
    AttemptRequest, EndAttemptRequest, ExecutorAttestation, HeartbeatAttemptRequest,
    LivenessMetadata, ReceiptCoverage, ReceiptPayload, RenewLeaseAttemptRequest,
    SqliteAttemptAdapter, WorkApplication,
};
use boreal_domain::{
    AcceptanceProfile, ActorId, AttemptId, ConfigIdentity, DispatchPolicy, Fence, GateId, GateKind,
    HarnessId, OperationId, PersistedLifecycle, ProfileId, ProjectId, ReceiptResult,
    SourceVersionId, TimestampMs, WorkId, WorkItem, WorkKind,
};
use boreal_store::SqliteStore;

const SCHEMA: &str = include_str!("../../../project/spec/schema-v2.sql");

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
        attestation: ExecutorAttestation::BorealWitnessed,
        result: ReceiptResult::Passed,
    }
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
            kind: WorkKind::Milestone,
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
    let store = SqliteStore::open_in_memory(SCHEMA).unwrap();
    let app = WorkApplication::new(&store);
    let project = ProjectId::new("p-close");
    app.init_project(
        &project,
        "agent-1",
        "agent",
        "cred",
        "Agent",
        "unix-ms:0",
        "op-init-close",
    )
    .unwrap();
    app.create_work(
        &WorkItem {
            id: WorkId::new("w-close"),
            project_id: project.clone(),
            kind: WorkKind::Milestone,
            parent_id: None,
            title: "Closeout".to_owned(),
            description: String::new(),
            lifecycle: PersistedLifecycle::Open,
            priority: 0,
            dispatch_policy: DispatchPolicy::Automatic,
            hard_holds: Vec::new(),
            acceptance_profile: AcceptanceProfile::focused(),
        },
        "unix-ms:0",
        "op-work-close",
    )
    .unwrap();
    app.claim(
        &project,
        "w-close",
        "agent-1",
        "luna",
        None,
        "a-close",
        "op-claim-close",
        "sha256:claim-close",
        None,
        "unix-ms:0",
        "unix-ms:1800000",
        "unix-ms:7200000",
    )
    .unwrap();
    let adapter = SqliteAttemptAdapter::new(&store);
    app.accept(
        &adapter,
        request_for("p-close", "w-close", "a-close", "op-accept-close", 1),
    )
    .unwrap();
    app.start(
        &adapter,
        request_for("p-close", "w-close", "a-close", "op-start-close", 2),
    )
    .unwrap();
    app.submit(
        &adapter,
        request_for("p-close", "w-close", "a-close", "op-submit-close", 3),
    )
    .unwrap();
    store
        .execute_batch(
            "INSERT INTO source_version
         (source_version_id, project_id, origin, access_scope, content_digest,
          media_type, byte_count, captured_at, parser_identity, availability, citation_json)
         VALUES ('source-1', 'p-close', 'fixture.md', 'project',
                 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                 'text/markdown', 1, 'unix-ms:0', 'parser/1', 'available', '[]');",
        )
        .unwrap();

    for (gate, kind, operation) in [
        ("checkpoint", GateKind::Checkpoint, "op-receipt-checkpoint"),
        (
            "verification",
            GateKind::Verification,
            "op-receipt-verification",
        ),
        ("summary", GateKind::Summary, "op-receipt-summary"),
    ] {
        app.record_receipt(
            "agent-1",
            None,
            &passed_receipt(gate, kind, operation),
            None,
            TimestampMs(4),
        )
        .unwrap();
    }
    let intent = boreal_application::CloseIntent {
        work_id: WorkId::new("w-close"),
        attempt_id: AttemptId::new("a-close"),
        fence: Fence::new(1),
        source_snapshot_hash: SourceVersionId::new("source-1"),
        config_identity: ConfigIdentity::new("config-1"),
        profile_id: ProfileId::new("focused"),
        profile_version: "1".to_owned(),
        summary_id: None,
    };
    app.request_close("agent-1", None, &intent, None, TimestampMs(5))
        .unwrap();
    let finalized = app
        .finalize_close("agent-1", None, &intent, None, TimestampMs(6))
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
                    kind: WorkKind::Milestone,
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
