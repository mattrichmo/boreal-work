use boreal_application::{
    AcceptanceGateDefinition, EvidenceRunRequest, ExecutorAttestation, FinalResultCaptureRequest,
    ReceiptExpectation, WorkApplication,
};
use boreal_domain::{
    AcceptanceProfile, ActorRole, AttemptId, ConfigIdentity, DispatchPolicy, Fence, GateId,
    GateKind, OperationId, PersistedLifecycle, ProfileId, ProjectId, ReceiptId, SourceVersionId,
    TimestampMs, WorkId, WorkItem, WorkKind,
};
use boreal_source::{SourceCatalog, SourceVersion};
use boreal_store::{
    acceptance::{AcceptanceStore, FinalResultBindingRequest},
    identity::{DatabaseIdentity, IdentityStore, WorkspaceBinding},
    principals::PrincipalGrantRequest,
    EvidenceExecutionAdmissionRequest, SqliteStore,
};

const PRODUCTION_SCHEMA: &str = include_str!("../../../project/spec/schema-production.sql");
const PROJECT_ID: &str = "final-result-project";
const WORK_ID: &str = "final-result-work";
const AGENT_ID: &str = "final-result-agent";
const AGENT_SESSION: &str = "final-result-agent-session";
const OPERATOR_ID: &str = "final-result-operator";
const OPERATOR_SESSION: &str = "final-result-operator-session";

fn register_source(store: &SqliteStore, version: &SourceVersion, captured_at: &str) {
    store
        .execute_batch(&format!(
            "INSERT INTO source_version
             (source_version_id, project_id, origin, access_scope, content_digest,
              media_type, byte_count, captured_at, parser_identity, availability, citation_json)
             VALUES ('{}', '{}', '{}', 'project', '{}', 'text/plain', {}, '{}',
                     'final-result-test/1', 'available', '[]');",
            version.source_version_id,
            version.project_id,
            version.origin,
            version.content_digest,
            version.byte_count,
            captured_at,
        ))
        .expect("register captured source metadata");
}

fn setup() -> (
    &'static SqliteStore,
    WorkApplication<'static>,
    SourceCatalog,
    SourceVersion,
) {
    let store: &'static SqliteStore = Box::leak(Box::new(
        SqliteStore::open_in_memory(PRODUCTION_SCHEMA).expect("open production schema"),
    ));
    let app = WorkApplication::new(store);
    let project = ProjectId::new(PROJECT_ID);
    store
        .create_project(PROJECT_ID, "unix-ms:0")
        .expect("create project");
    IdentityStore::new(store)
        .install(
            &DatabaseIdentity::new("final-result-database", 1).expect("database identity"),
            "unix-ms:1",
        )
        .expect("install database identity");
    IdentityStore::new(store)
        .bind_project(
            PROJECT_ID,
            &WorkspaceBinding::new(
                "/tmp/final-result-workspace",
                "/tmp/final-result-workspace",
                "sha256:final-result-workspace",
            )
            .expect("workspace binding"),
            "unix-ms:1",
        )
        .expect("bind project workspace");
    store
        .bootstrap_project_principal(&PrincipalGrantRequest {
            project_id: PROJECT_ID.to_owned(),
            actor_id: OPERATOR_ID.to_owned(),
            session_id: None,
            principal_actor_id: OPERATOR_ID.to_owned(),
            role: ActorRole::Operator,
            independent: true,
            credential: format!("bwrk1_{}", "a".repeat(64)),
            expires_at_ms: None,
            display_name: "Final result operator".to_owned(),
            reason: "create final-result application test principal".to_owned(),
            expected_revision: store.project_revision(PROJECT_ID).unwrap().0,
            operation_id: "op-final-result-operator".to_owned(),
            at: "unix-ms:2".to_owned(),
        })
        .expect("bootstrap operator");
    store
        .grant_principal(&PrincipalGrantRequest {
            project_id: PROJECT_ID.to_owned(),
            actor_id: OPERATOR_ID.to_owned(),
            session_id: None,
            principal_actor_id: AGENT_ID.to_owned(),
            role: ActorRole::Agent,
            independent: false,
            credential: format!("bwrk1_{}", "b".repeat(64)),
            expires_at_ms: None,
            display_name: "Final result agent".to_owned(),
            reason: "grant final-result test execution principal".to_owned(),
            expected_revision: store.project_revision(PROJECT_ID).unwrap().0,
            operation_id: "op-final-result-agent".to_owned(),
            at: "unix-ms:2".to_owned(),
        })
        .expect("grant agent");
    app.register_session_as(
        &project,
        OPERATOR_ID,
        "final-result-harness",
        OPERATOR_SESSION,
        "unix-ms:3",
        "op-final-result-operator-session",
    )
    .expect("register operator session");
    app.register_session_as(
        &project,
        AGENT_ID,
        "final-result-harness",
        AGENT_SESSION,
        "unix-ms:3",
        "op-final-result-agent-session",
    )
    .expect("register agent session");
    app.create_work_as_session_checked(
        &WorkItem {
            id: WorkId::new(WORK_ID),
            project_id: project.clone(),
            kind: WorkKind::Task,
            parent_id: None,
            title: "Bind a changed result".to_owned(),
            description: String::new(),
            lifecycle: PersistedLifecycle::Open,
            priority: 0,
            dispatch_policy: DispatchPolicy::Automatic,
            hard_holds: Vec::new(),
            acceptance_profile: AcceptanceProfile::focused(),
        },
        OPERATOR_ID,
        OPERATOR_SESSION,
        Some(store.project_revision(PROJECT_ID).unwrap().0),
        "unix-ms:4",
        "op-final-result-work",
    )
    .expect("create focused work");

    let catalog = SourceCatalog::default();
    let input = catalog
        .capture(PROJECT_ID, "input.txt", b"original source", "text/plain")
        .expect("capture claim input");
    register_source(store, &input, "unix-ms:5");
    app.claim_with_context(
        &project,
        WORK_ID,
        AGENT_ID,
        "final-result-harness",
        Some(AGENT_SESSION),
        "final-result-attempt",
        "op-final-result-claim",
        "sha256:final-result-claim",
        Some(store.project_revision(PROJECT_ID).unwrap().0),
        "unix-ms:1000",
        "unix-ms:2000",
        "unix-ms:3000",
        Some(&input.source_version_id),
        "config-final-result",
    )
    .expect("claim work with immutable input source");
    store
        .execute_batch(
            "UPDATE attempt SET state='running', accepted_at='unix-ms:1001'
             WHERE attempt_id='final-result-attempt';",
        )
        .expect("start claimed attempt");
    (store, app, catalog, input)
}

fn capture_request(
    store: &SqliteStore,
    source: &SourceVersion,
    operation_id: &str,
) -> FinalResultCaptureRequest {
    let identity = IdentityStore::new(store)
        .context(PROJECT_ID)
        .expect("read project identity context");
    let revisions = IdentityStore::new(store)
        .revisions(&identity, WORK_ID)
        .unwrap();
    FinalResultCaptureRequest {
        project_id: PROJECT_ID.to_owned(),
        work_id: WORK_ID.to_owned(),
        actor_id: AGENT_ID.to_owned(),
        session_id: AGENT_SESSION.to_owned(),
        attempt_id: "final-result-attempt".to_owned(),
        fence: 1,
        expected_project_revision: store.project_revision(PROJECT_ID).unwrap().0,
        expected_entity_revision: revisions.entity.get(),
        expected_proof_revision: revisions.proof.get(),
        source_version_id: source.source_version_id.clone(),
        content_digest: source.content_digest.clone(),
        operation_id: operation_id.to_owned(),
        at: "unix-ms:1100".to_owned(),
    }
}

#[test]
fn final_result_requires_changed_source_and_replays_exact_binding() {
    let (store, app, catalog, input) = setup();
    let before = app
        .read_close_readiness(PROJECT_ID, WORK_ID)
        .expect("read readiness before result binding");
    assert!(before
        .gaps
        .iter()
        .any(|gap| gap.code() == "gate_unsatisfied"));

    let unchanged = capture_request(&store, &input, "op-final-result-unchanged");
    assert!(matches!(
        app.bind_final_result(&catalog, &unchanged),
        Err(boreal_application::ApplicationError::Store(
            boreal_store::StoreError::Conflict(message)
        )) if message.contains("different source identity and content digest")
    ));
    let same_digest = SourceVersion {
        source_version_id: "final-result-same-digest".to_owned(),
        origin: "duplicate-input.txt".to_owned(),
        ..input.clone()
    };
    register_source(&store, &same_digest, "unix-ms:1001");
    let same_digest = capture_request(&store, &same_digest, "op-final-result-same-digest");
    assert!(matches!(
        AcceptanceStore::new(&store).bind_final_result(&FinalResultBindingRequest {
            project_id: same_digest.project_id.clone(),
            work_id: same_digest.work_id.clone(),
            actor_id: same_digest.actor_id.clone(),
            session_id: same_digest.session_id.clone(),
            attempt_id: same_digest.attempt_id.clone(),
            fence: same_digest.fence,
            expected_project_revision: same_digest.expected_project_revision,
            expected_entity_revision: same_digest.expected_entity_revision,
            expected_proof_revision: same_digest.expected_proof_revision,
            source_version_id: same_digest.source_version_id.clone(),
            content_digest: same_digest.content_digest.clone(),
            operation_id: same_digest.operation_id.clone(),
            at: same_digest.at.clone(),
        }),
        Err(boreal_store::StoreError::Conflict(message))
            if message.contains("different source identity and content digest")
    ));

    let output = catalog
        .capture(PROJECT_ID, "output.txt", b"changed result", "text/plain")
        .expect("capture changed result");
    register_source(&store, &output, "unix-ms:1002");
    let request = capture_request(&store, &output, "op-final-result-bind");
    let mut wrong_owner = request.clone();
    wrong_owner.actor_id = OPERATOR_ID.to_owned();
    wrong_owner.session_id = OPERATOR_SESSION.to_owned();
    wrong_owner.operation_id = "op-final-result-wrong-owner".to_owned();
    assert!(app.bind_final_result(&catalog, &wrong_owner).is_err());
    let mut wrong_fence = request.clone();
    wrong_fence.fence += 1;
    wrong_fence.operation_id = "op-final-result-wrong-fence".to_owned();
    assert!(app.bind_final_result(&catalog, &wrong_fence).is_err());

    let first = app
        .bind_final_result(&catalog, &request)
        .expect("bind changed result");
    assert!(first.changed);
    assert_eq!(
        first.value.binding.prior_proof_revision + 1,
        first.value.binding.proof_revision
    );
    assert_eq!(
        first.value.binding.source_version_id,
        output.source_version_id
    );
    assert!(first.value.lineage_pending.is_none());

    let replay = app
        .bind_final_result(&catalog, &request)
        .expect("read back exact binding replay");
    assert!(!replay.changed);
    assert!(replay.value.binding.replayed);
    let mut replayed_binding = first.value.binding.clone();
    replayed_binding.replayed = true;
    assert_eq!(replay.value.binding, replayed_binding);
}

#[test]
fn final_result_requires_a_known_claim_input_source() {
    let (store, app, catalog, _) = setup();
    let output = catalog
        .capture(PROJECT_ID, "output.txt", b"changed result", "text/plain")
        .expect("capture changed result");
    register_source(&store, &output, "unix-ms:1002");
    store
        .execute_batch(
            "UPDATE attempt SET source_version_id=NULL
             WHERE attempt_id='final-result-attempt';",
        )
        .expect("remove claim input source from fixture");

    let request = capture_request(&store, &output, "op-final-result-missing-input");
    let result = app.bind_final_result(&catalog, &request);
    assert!(result.is_err(), "missing claim input must fail closed");
    assert!(app
        .read_final_result_for_operation(PROJECT_ID, "op-final-result-missing-input")
        .expect("read failed operation")
        .is_none());
}

#[test]
fn verifier_admission_uses_bound_output_and_preserves_claim_input_identity() {
    let (store, app, catalog, input) = setup();
    let output = catalog
        .capture(PROJECT_ID, "output.txt", b"changed result", "text/plain")
        .expect("capture changed result");
    register_source(&store, &output, "unix-ms:1002");
    let bind = capture_request(&store, &output, "op-final-result-admission-bind");
    app.bind_final_result(&catalog, &bind)
        .expect("bind changed result");

    let evidence_request = |operation_id: &str, source_version_id: &str| EvidenceRunRequest {
        receipt_id: ReceiptId::new(format!("receipt-{operation_id}")),
        operation_id: OperationId::new(operation_id),
        gate_policy_identity: format!("sha256:{}", "2".repeat(64)),
        expectation: ReceiptExpectation {
            work_id: WorkId::new(WORK_ID),
            attempt_id: AttemptId::new("final-result-attempt"),
            fence: Fence::new(1),
            source_snapshot_hash: SourceVersionId::new(source_version_id),
            config_identity: ConfigIdentity::new("config-final-result"),
            profile_id: ProfileId::new("focused"),
            profile_version: "1".to_owned(),
            gate: AcceptanceGateDefinition::required(
                GateId::new("verification"),
                GateKind::Verification,
            ),
        },
        cwd: "/tmp/final-result-workspace".to_owned(),
        environment_fingerprint: "final-result-env".to_owned(),
        attestation: ExecutorAttestation::BorealWitnessed,
    };

    let claim_input_request = evidence_request("op-verifier-claim-input", &input.source_version_id);
    assert!(app
        .admit_witnessed_execution(
            AGENT_ID,
            Some(AGENT_SESSION),
            &claim_input_request,
            "final-result-artifact",
            TimestampMs(1200),
        )
        .is_err());
    assert!(store
        .operation("verifier:op-verifier-claim-input")
        .expect("read rejected verifier journal")
        .is_none());

    let request = evidence_request("op-verifier-final-result", &output.source_version_id);
    let admitted = app
        .admit_witnessed_execution(
            AGENT_ID,
            Some(AGENT_SESSION),
            &request,
            "final-result-artifact",
            TimestampMs(1200),
        )
        .expect("admit verifier against bound output");
    assert!(!admitted.replayed);
    assert_eq!(
        admitted.execution.state,
        boreal_store::EvidenceExecutionState::Admitted
    );
    let replay = app
        .admit_witnessed_execution(
            AGENT_ID,
            Some(AGENT_SESSION),
            &request,
            "final-result-artifact",
            TimestampMs(1200),
        )
        .expect("read back exact verifier admission");
    assert!(replay.replayed);
    assert_eq!(replay.execution, admitted.execution);
    let identity = IdentityStore::new(&store)
        .context(PROJECT_ID)
        .expect("read project identity context");
    let external_job = store
        .external_job_with_identity(&identity, "verifier:op-verifier-final-result")
        .expect("read verifier external job")
        .expect("persist verifier external job");
    assert_eq!(
        external_job.source_identity.as_deref(),
        Some(output.source_version_id.as_str())
    );

    let attempt = store
        .proof_attempt(PROJECT_ID, "final-result-attempt")
        .expect("read attempt after admission");
    assert_eq!(
        attempt.source_version_id.as_deref(),
        Some(input.source_version_id.as_str())
    );
}

#[test]
fn store_keeps_legacy_unbound_verification_admission_on_claim_input() {
    let (store, _app, _catalog, input) = setup();
    let requirements = boreal_store::profiles::ProfileStore::new(&store)
        .current_pinned_requirements(PROJECT_ID, WORK_ID)
        .expect("read current profile pin");
    let gate_id = store
        .gate_id_for_work(PROJECT_ID, WORK_ID, "verification")
        .expect("resolve verification gate");
    let request = EvidenceExecutionAdmissionRequest {
        operation_id: "op-verifier-unbound-legacy".to_owned(),
        project_id: PROJECT_ID.to_owned(),
        work_id: WORK_ID.to_owned(),
        attempt_id: "final-result-attempt".to_owned(),
        fence: 1,
        gate_id: gate_id.as_str().to_owned(),
        actor_id: AGENT_ID.to_owned(),
        session_id: Some(AGENT_SESSION.to_owned()),
        request_digest: "sha256:legacy-verifier-request".to_owned(),
        artifact_ref: "legacy-artifact".to_owned(),
        source_version_id: Some(input.source_version_id.clone()),
        config_identity: "config-final-result".to_owned(),
        profile_id: requirements.profile.profile_id,
        profile_version: requirements.profile.version,
        admitted_at: "unix-ms:1200".to_owned(),
    };

    let admitted = store
        .admit_evidence_execution(&request)
        .expect("admit legacy unbound verifier against claim input");
    assert!(!admitted.replayed);
    let attempt = store
        .proof_attempt(PROJECT_ID, "final-result-attempt")
        .expect("read attempt after legacy admission");
    assert_eq!(
        attempt.source_version_id.as_deref(),
        Some(input.source_version_id.as_str())
    );
}
