use boreal_application::{
    evaluate_acceptance, AcceptanceDefinition, AcceptanceGateDefinition, AttemptSnapshot,
    CloseIntent, CloseoutInput, CommandSpec, EvidenceErrorCode, ExecutorAttestation,
    ReceiptCoverage, ReceiptExpectation, ReceiptExpectationBase, ReceiptPayload, WorkApplication,
};
use boreal_domain::Fence;
use boreal_domain::{
    AcceptanceProfile, ActorId, AttemptId, AttemptPhase, ConfigIdentity, DispatchPolicy, GateId,
    GateKind, PersistedLifecycle, ProfileId, ProjectId, ReceiptResult, SourceVersionId,
    TimestampMs, WorkId, WorkItem, WorkKind,
};
use boreal_store::{ReceiptOutcome, SqliteStore as Store};

const SCHEMA: &str = include_str!("../../../project/spec/schema-v2.sql");

fn setup() -> (&'static Store, WorkApplication<'static>) {
    let store = Box::leak(Box::new(Store::open_in_memory(SCHEMA).unwrap()));
    let app = WorkApplication::new(store);
    let project = ProjectId::new("proof-project");
    app.init_project(
        &project,
        "agent-1",
        "agent",
        "credential-1",
        "Proof boundary",
        "unix-ms:0",
        "op-init-proof",
    )
    .unwrap();
    app.create_work(
        &WorkItem {
            id: WorkId::new("work-1"),
            project_id: project.clone(),
            kind: WorkKind::Task,
            parent_id: None,
            title: "Proof boundary work".to_owned(),
            description: String::new(),
            lifecycle: PersistedLifecycle::Open,
            priority: 0,
            dispatch_policy: DispatchPolicy::Automatic,
            hard_holds: Vec::new(),
            acceptance_profile: AcceptanceProfile::focused(),
        },
        "unix-ms:0",
        "op-work-proof",
    )
    .unwrap();
    store
        .execute_batch(
            "INSERT INTO source_version
             (source_version_id, project_id, origin, access_scope, content_digest,
              media_type, byte_count, captured_at, parser_identity, availability, citation_json)
             VALUES ('source-1', 'proof-project', 'fixture.md', 'project',
                     'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                     'text/markdown', 1, 'unix-ms:0', 'parser/1', 'available', '[]');",
        )
        .unwrap();
    app.claim(
        &project,
        "work-1",
        "agent-1",
        "harness-1",
        None,
        "attempt-1",
        "op-claim-proof",
        "sha256:claim-proof",
        None,
        "unix-ms:1",
        "unix-ms:1800001",
        "unix-ms:7200001",
    )
    .unwrap();
    // The current store claim API does not accept source/config context. Keep
    // this test fixture explicit until the store exposes an atomic claim
    // context binding seam.
    store
        .execute_batch(
            "UPDATE attempt
             SET source_version_id = 'source-1', config_identity = 'config-1'
             WHERE attempt_id = 'attempt-1';",
        )
        .unwrap();
    (store, app)
}

fn receipt(
    gate_id: &str,
    kind: GateKind,
    result: ReceiptResult,
    attestation: ExecutorAttestation,
) -> ReceiptPayload {
    ReceiptPayload {
        schema_version: boreal_application::RECEIPT_SCHEMA_VERSION.to_owned(),
        receipt_id: format!("receipt-{gate_id}").into(),
        operation_id: format!("operation-{gate_id}").into(),
        work_id: WorkId::new("work-1"),
        attempt_id: AttemptId::new("attempt-1"),
        fence: Fence::new(1),
        gate_id: GateId::new(gate_id),
        executable: "./check".to_owned(),
        argv: vec!["./check".to_owned(), "--json".to_owned()],
        cwd: "/workspace".to_owned(),
        exit_code: if result == ReceiptResult::Passed {
            0
        } else {
            2
        },
        started_at: TimestampMs(10),
        ended_at: TimestampMs(11),
        source_snapshot_hash: SourceVersionId::new("source-1"),
        config_identity: ConfigIdentity::new("config-1"),
        environment_fingerprint: "env-1".to_owned(),
        output_digest: Some("sha256:output".to_owned()),
        output_ref: None,
        coverage: ReceiptCoverage {
            kind,
            profile_id: ProfileId::new("focused"),
            profile_version: "1".to_owned(),
            observables: Vec::new(),
        },
        attestation,
        result,
    }
}

fn expectation() -> ReceiptExpectation {
    ReceiptExpectation {
        work_id: WorkId::new("work-1"),
        attempt_id: AttemptId::new("attempt-1"),
        fence: Fence::new(1),
        source_snapshot_hash: SourceVersionId::new("source-1"),
        config_identity: ConfigIdentity::new("config-1"),
        profile_id: ProfileId::new("focused"),
        profile_version: "1".to_owned(),
        gate: AcceptanceGateDefinition::required(
            GateId::new("verification"),
            GateKind::Verification,
        )
        .with_command(CommandSpec::new(
            "./check",
            vec!["./check".to_owned(), "--json".to_owned()],
        )),
    }
}

fn error_code(error: boreal_application::ApplicationError) -> Option<EvidenceErrorCode> {
    match error {
        boreal_application::ApplicationError::Evidence(error) => Some(error.code()),
        _ => None,
    }
}

#[test]
fn imported_receipts_require_current_subject_and_context() {
    let (_store, _app) = setup();
    let expected = expectation();

    let mut wrong_subject = receipt(
        "verification",
        GateKind::Verification,
        ReceiptResult::Passed,
        ExecutorAttestation::ExternalAttested,
    );
    wrong_subject.work_id = WorkId::new("other-work");
    assert_eq!(
        wrong_subject.validate_for(&expected).unwrap_err().code(),
        EvidenceErrorCode::ReceiptSubjectMismatch
    );

    let mut stale = receipt(
        "verification",
        GateKind::Verification,
        ReceiptResult::Passed,
        ExecutorAttestation::ExternalAttested,
    );
    stale.fence = Fence::new(2);
    assert_eq!(
        stale.validate_for(&expected).unwrap_err().code(),
        EvidenceErrorCode::StaleFence
    );

    let mut changed_source = receipt(
        "verification",
        GateKind::Verification,
        ReceiptResult::Passed,
        ExecutorAttestation::ExternalAttested,
    );
    changed_source.source_snapshot_hash = SourceVersionId::new("source-2");
    assert_eq!(
        changed_source.validate_for(&expected).unwrap_err().code(),
        EvidenceErrorCode::ReceiptSourceMismatch
    );

    let mut changed_config = receipt(
        "verification",
        GateKind::Verification,
        ReceiptResult::Passed,
        ExecutorAttestation::ExternalAttested,
    );
    changed_config.config_identity = ConfigIdentity::new("config-2");
    assert_eq!(
        changed_config.validate_for(&expected).unwrap_err().code(),
        EvidenceErrorCode::ReceiptConfigMismatch
    );

    let mut changed_profile = receipt(
        "verification",
        GateKind::Verification,
        ReceiptResult::Passed,
        ExecutorAttestation::ExternalAttested,
    );
    changed_profile.coverage.profile_id = ProfileId::new("reviewed");
    assert_eq!(
        changed_profile.validate_for(&expected).unwrap_err().code(),
        EvidenceErrorCode::ReceiptPolicyMismatch
    );
}

#[test]
fn imported_witness_label_is_rejected_but_failed_evidence_is_retained() {
    let (store, app) = setup();
    let forged = receipt(
        "verification",
        GateKind::Verification,
        ReceiptResult::Passed,
        ExecutorAttestation::BorealWitnessed,
    );
    assert_eq!(
        error_code(
            app.record_receipt("agent-1", None, &forged, None, TimestampMs(12))
                .unwrap_err()
        ),
        Some(EvidenceErrorCode::WitnessedReceiptImportDenied)
    );

    let failed = receipt(
        "verification",
        GateKind::Verification,
        ReceiptResult::Failed,
        ExecutorAttestation::SelfReported,
    );
    let inserted = app
        .record_receipt("agent-1", None, &failed, None, TimestampMs(12))
        .unwrap();
    assert_eq!(inserted.receipt.result, ReceiptOutcome::Failed);
    assert_eq!(
        store.receipt("receipt-verification").unwrap().unwrap(),
        inserted.receipt
    );
}

#[test]
fn untrusted_pass_is_retained_as_rejected_and_cannot_satisfy_current_proof() {
    let (store, app) = setup();
    let imported = receipt(
        "verification",
        GateKind::Verification,
        ReceiptResult::Passed,
        ExecutorAttestation::SelfReported,
    );
    let inserted = app
        .record_receipt("agent-1", None, &imported, None, TimestampMs(12))
        .unwrap();
    assert_eq!(inserted.receipt.result, ReceiptOutcome::Rejected);
    assert_eq!(
        inserted.receipt.rejection_code.as_deref(),
        Some("receipt_attestation_missing")
    );
    let current = app
        .evaluate_current_acceptance(
            "proof-project",
            &WorkId::new("work-1"),
            &AttemptId::new("attempt-1"),
            Fence::new(1),
            &AcceptanceDefinition::focused(),
        )
        .unwrap();
    assert_eq!(
        current
            .gates
            .iter()
            .find(|gate| gate.gate_id == GateId::new("verification"))
            .unwrap()
            .state,
        boreal_domain::GateState::Failed
    );
    assert_eq!(
        store
            .receipt("receipt-verification")
            .unwrap()
            .unwrap()
            .result,
        ReceiptOutcome::Rejected
    );
}

#[test]
fn public_receipt_facade_conflicts_when_an_operation_payload_changes() {
    let (_store, app) = setup();
    let original = receipt(
        "verification",
        GateKind::Verification,
        ReceiptResult::Passed,
        ExecutorAttestation::ExternalAttested,
    );
    let inserted = app
        .record_receipt("agent-1", None, &original, None, TimestampMs(12))
        .unwrap();
    assert!(!inserted.replayed);
    assert!(
        app.record_receipt("agent-1", None, &original, None, TimestampMs(12))
            .unwrap()
            .replayed
    );

    let mut changed = original;
    changed.output_digest = Some("sha256:changed-output".to_owned());
    assert!(matches!(
        app.record_receipt("agent-1", None, &changed, None, TimestampMs(12)),
        Err(boreal_application::ApplicationError::Store(
            boreal_store::StoreError::Conflict(_)
        ))
    ));
}

#[test]
fn old_attempt_proof_does_not_satisfy_a_new_attempt() {
    let definition = AcceptanceDefinition::focused();
    let old = receipt(
        "verification",
        GateKind::Verification,
        ReceiptResult::Passed,
        ExecutorAttestation::ExternalAttested,
    );
    let evaluation = evaluate_acceptance(
        &definition,
        &[old],
        &ReceiptExpectationBase {
            work_id: WorkId::new("work-1"),
            attempt_id: AttemptId::new("attempt-2"),
            fence: Fence::new(2),
            source_snapshot_hash: SourceVersionId::new("source-1"),
            config_identity: ConfigIdentity::new("config-1"),
        },
    )
    .unwrap();
    let verification = evaluation
        .gates
        .iter()
        .find(|gate| gate.gate_id == GateId::new("verification"))
        .unwrap();
    assert_eq!(verification.state, boreal_domain::GateState::Failed);
    assert_eq!(verification.reason, Some(EvidenceErrorCode::StaleFence));
}

#[test]
fn closeout_requires_typed_current_summary() {
    let definition = AcceptanceDefinition::focused();
    let receipts = definition
        .gates
        .iter()
        .map(|gate| {
            receipt(
                gate.id.as_str(),
                gate.kind,
                ReceiptResult::Passed,
                ExecutorAttestation::ExternalAttested,
            )
        })
        .collect();
    let input = CloseoutInput {
        definition: definition.clone(),
        work_id: WorkId::new("work-1"),
        attempt: AttemptSnapshot {
            project_id: ProjectId::new("proof-project"),
            work_id: WorkId::new("work-1"),
            attempt_id: AttemptId::new("attempt-1"),
            actor_id: ActorId::new("agent-1"),
            harness_id: None,
            session_id: None,
            fence: Fence::new(1),
            phase: AttemptPhase::Verifying,
            claimed_at: TimestampMs(1),
            accepted_at: Some(TimestampMs(2)),
            lease_deadline: TimestampMs(100),
            hard_deadline: TimestampMs(200),
            current: true,
        },
        expected_fence: Fence::new(1),
        source_snapshot_hash: SourceVersionId::new("source-1"),
        config_identity: ConfigIdentity::new("config-1"),
        policy_version: "1".to_owned(),
        receipts,
        gates: Vec::new(),
        review: None,
        summary: None,
        close_intent: Some(CloseIntent {
            work_id: WorkId::new("work-1"),
            attempt_id: AttemptId::new("attempt-1"),
            fence: Fence::new(1),
            source_snapshot_hash: SourceVersionId::new("source-1"),
            config_identity: ConfigIdentity::new("config-1"),
            profile_id: definition.id,
            profile_version: "1".to_owned(),
            summary_id: None,
        }),
    };
    let readiness = boreal_application::evaluate_close_readiness(&input).unwrap();
    assert!(readiness
        .gaps
        .contains(&boreal_application::CloseoutGap::SummaryMissing));
    assert!(!readiness.is_ready());
}
