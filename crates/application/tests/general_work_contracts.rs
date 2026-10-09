//! Synthetic end-to-end coverage for general-work persistence and readback.

use boreal_application::{
    AcceptInputSetRequest, AttemptRequest, CreateExternalWaitRequest,
    ResolveExternalWaitRequest, SetWorkContractRequest, SqliteAttemptAdapter,
    SubmitOutputArtifactsRequest, WorkApplication,
};
use boreal_domain::deliverables::{
    AcceptedInput, AcceptanceDecisionKind, ArtifactAvailability, ArtifactDecision,
    ArtifactIdentity, ArtifactInspection as Inspection, DeliverableType, InputSource,
    InspectionOutcome, InspectorKind, OutputRequirement, ProducedArtifact, RequirementKey,
    RigorProfile,
};
use boreal_domain::external_waits::{
    AccountableParty, BusinessDate, BusinessMoment, CivilDate, ExternalWait,
    ExternalWaitState,
};
use boreal_domain::{
    AcceptanceProfile, ActorId, AttemptId, DispatchPolicy, Fence, HarnessId,
    OperationId, PersistedLifecycle, ProjectId, SourceVersionId, TimestampMs, WorkId, WorkItem,
    WorkKind,
};
use boreal_store::{SourceVersionRegistrationInput, SqliteStore};

const SCHEMA_V2: &str = include_str!("../../../project/spec/schema-v2.sql");
const SCHEMA_V3: &str = include_str!("../../../project/spec/schema-v3.sql");

fn scope(store: &SqliteStore, actor_id: &str) -> boreal_application::PlanningScope {
    let mut scope = boreal_application::PlanningScope::new(ProjectId::new("p1"), actor_id);
    scope.expected_revision = Some(store.project_revision("p1").unwrap().0);
    scope
}

fn register_source(store: &SqliteStore, source_id: &str, actor_id: &str, digest_byte: char) {
    let operation_id = format!("op-source-{source_id}");
    store
        .register_source_version(&SourceVersionRegistrationInput {
            operation_id: operation_id.clone(),
            project_id: "p1".into(),
            actor_id: actor_id.into(),
            source_version_id: source_id.into(),
            origin: "synthetic-general-work-fixture".into(),
            access_scope: "project".into(),
            content_digest: format!("sha256:{}", digest_byte.to_string().repeat(64)),
            media_type: "text/plain".into(),
            byte_count: 128,
            captured_at: "unix-ms:1".into(),
            parser_identity: "test-fixture/1".into(),
            availability: "available".into(),
            citation_json: "[]".into(),
            request_digest: format!("sha256:{operation_id}"),
        })
        .expect("synthetic source registers");
}

fn attempt_request(operation_id: &str, at: u64) -> AttemptRequest {
    AttemptRequest::new(
        ProjectId::new("p1"),
        WorkId::new("w1"),
        AttemptId::new("a1"),
        ActorId::new("agent-1"),
        Some(HarnessId::new("test-harness")),
        None,
        Fence::new(1),
        OperationId::new(operation_id),
        format!("sha256:{operation_id}"),
        TimestampMs(at),
    )
}

#[test]
fn contracts_lineage_review_wait_and_close_readback_are_revision_bound() {
    let store = SqliteStore::open_with_work_model_v3(":memory:", SCHEMA_V2, SCHEMA_V3)
        .expect("synthetic v3 schema opens");
    store
        .ensure_general_work_schema()
        .expect("general-work feature schema installs");
    let app = WorkApplication::new(&store);
    let project = ProjectId::new("p1");
    app.init_project(
        &project,
        "operator-1",
        "operator",
        "fixture-credential",
        "Fixture operator",
        "unix-ms:0",
        "op-init",
    )
    .expect("synthetic project initializes");
    store
        .ensure_actor("agent-1", "agent", "fixture-agent", "Fixture agent", "unix-ms:0")
        .expect("synthetic agent registers");
    store
        .ensure_actor(
            "reviewer-1",
            "reviewer",
            "fixture-reviewer",
            "Fixture reviewer",
            "unix-ms:0",
        )
        .expect("synthetic reviewer registers");
    let work = WorkItem {
        id: WorkId::new("w1"),
        project_id: project.clone(),
        kind: WorkKind::Task,
        parent_id: None,
        title: "Synthetic brief review".into(),
        description: "No external providers or real data".into(),
        lifecycle: PersistedLifecycle::Open,
        priority: 0,
        dispatch_policy: DispatchPolicy::Automatic,
        hard_holds: Vec::new(),
        acceptance_profile: AcceptanceProfile::focused(),
    };
    store.create_work(&work, "unix-ms:0").expect("fixture work creates");
    register_source(&store, "input-src", "operator-1", 'b');

    let requirement = OutputRequirement {
        key: RequirementKey::parse("brief").unwrap(),
        purpose: "Reviewed brief output".into(),
        required: true,
        deliverable_type: DeliverableType::Document,
        allowed_media_types: vec!["text/plain".into()],
        minimum_count: 1,
        maximum_count: 1,
        criteria: Vec::new(),
    };
    let contract_request = SetWorkContractRequest {
        scope: scope(&store, "operator-1"),
        operation_id: "op-contract".into(),
        work_id: "w1".into(),
        expected_contract_revision: 0,
        new_contract_revision: 1,
        rigor: RigorProfile::supported("reviewed-artifacts", 1).unwrap(),
        requirements: vec![requirement],
        amendment_reason: Some("declare required brief output on open work".into()),
        now: "unix-ms:1".into(),
    };
    assert!(app
        .set_work_contract_v1(&contract_request)
        .unwrap()
        .changed);
    assert!(!app
        .set_work_contract_v1(&contract_request)
        .unwrap()
        .changed);
    assert_eq!(
        store
            .work_contract_v1("p1", "w1", None)
            .unwrap()
            .unwrap()
            .contract_revision,
        1
    );

    let accepted_input = AcceptedInput {
        project_id: project.clone(),
        work_id: WorkId::new("w1"),
        revision: 1,
        key: "brief-source".into(),
        role: "approved brief".into(),
        required: true,
        source: InputSource::CapturedSource {
            source_version_id: SourceVersionId::new("input-src"),
        },
        accepted_by: ActorId::new("operator-1"),
        accepted_at: TimestampMs(2),
    };
    let input_request = AcceptInputSetRequest {
        scope: scope(&store, "operator-1"),
        operation_id: "op-inputs".into(),
        work_id: "w1".into(),
        expected_contract_revision: 1,
        expected_input_revision: 0,
        new_input_revision: 1,
        inputs: vec![accepted_input],
        amendment_reason: Some("accept the brief source for this open work".into()),
        now: "unix-ms:2".into(),
    };
    assert!(app.accept_input_set_v1(&input_request).unwrap().changed);
    assert!(!app.accept_input_set_v1(&input_request).unwrap().changed);
    let inputs = store
        .accepted_input_set_v1("p1", "w1", Some(1))
        .unwrap()
        .unwrap();
    assert_eq!(inputs.bindings.len(), 1);
    assert_eq!(inputs.bindings[0].source_version_id, "input-src");

    let stale_input_request = AcceptInputSetRequest {
        scope: scope(&store, "operator-1"),
        operation_id: "op-stale-inputs".into(),
        work_id: "w1".into(),
        expected_contract_revision: 1,
        expected_input_revision: 0,
        new_input_revision: 2,
        inputs: Vec::new(),
        amendment_reason: None,
        now: "unix-ms:3".into(),
    };
    assert!(app.accept_input_set_v1(&stale_input_request).is_err());
    assert!(!store.operation_exists("op-stale-inputs").unwrap());

    app.claim(
        &project,
        "w1",
        "agent-1",
        "test-harness",
        None,
        "a1",
        "op-claim",
        "sha256:op-claim",
        None,
        "unix-ms:10",
        "unix-ms:1800010",
        "unix-ms:7200010",
    )
    .expect("enrolled fixture agent claims work");
    let adapter = SqliteAttemptAdapter::new(&store);
    app.accept(&adapter, attempt_request("op-accept", 11))
        .expect("agent accepts attempt");
    app.start(&adapter, attempt_request("op-start", 12))
        .expect("agent starts attempt");
    register_source(&store, "output-src", "agent-1", 'c');

    let current_revision = store.project_revision("p1").unwrap().0;
    let before_submission = store
        .output_acceptance_v1("p1", "w1", current_revision)
        .unwrap()
        .unwrap();
    let digest = format!("sha256:{}", "c".repeat(64));
    let artifact = ProducedArtifact {
        artifact_id: "brief-v1".into(),
        requirement_key: RequirementKey::parse("brief").unwrap(),
        submission_id: "submission-1".into(),
        identity: ArtifactIdentity {
            project_id: project.clone(),
            source_version_id: SourceVersionId::new("output-src"),
            content_digest: digest.clone(),
            media_type: "text/plain".into(),
            byte_count: 128,
            availability: ArtifactAvailability::Available,
        },
        producing_work_id: WorkId::new("w1"),
        attempt_id: "a1".into(),
        fence: 1,
        producer_actor_id: ActorId::new("agent-1"),
        captured_at: TimestampMs(13),
    };
    let output_request = SubmitOutputArtifactsRequest {
        scope: scope(&store, "agent-1"),
        operation_id: "op-output".into(),
        work_id: "w1".into(),
        submission_id: "submission-1".into(),
        attempt_id: "a1".into(),
        fence: 1,
        proof_revision: before_submission.proof_revision,
        contract_revision: 1,
        input_revision: 1,
        artifacts: vec![artifact],
        now: "unix-ms:13".into(),
    };
    let output = app.submit_output_artifacts_v1(&output_request).unwrap();
    assert!(output.changed);
    assert!(!app
        .submit_output_artifacts_v1(&output_request)
        .unwrap()
        .changed);
    assert_eq!(output.value.artifacts[0].content_digest, digest);

    let stale_decision = ArtifactDecision {
        decision_id: "decision-stale".into(),
        project_id: project.clone(),
        work_id: WorkId::new("w1"),
        submission_id: "submission-1".into(),
        contract_revision: 1,
        input_revision: 0,
        proof_revision: output.value.proof_revision,
        artifact_set_digest: output.value.artifact_set_digest.clone(),
        reviewer_actor_id: ActorId::new("reviewer-1"),
        producer_actor_id: ActorId::new("agent-1"),
        decision: AcceptanceDecisionKind::Approved,
        reason: "stale revision regression".into(),
        decided_at: TimestampMs(14),
    };
    let stale_result = app.record_artifact_decision_v1(
        &scope(&store, "reviewer-1"),
        "op-stale-decision",
        &stale_decision,
        "unix-ms:14",
    );
    assert!(stale_result.is_err());
    assert!(!store.operation_exists("op-stale-decision").unwrap());

    let inspection = Inspection {
        inspection_id: "inspection-1".into(),
        project_id: project.clone(),
        work_id: WorkId::new("w1"),
        submission_id: "submission-1".into(),
        artifact_id: "brief-v1".into(),
        artifact_digest: digest,
        inspector_actor_id: ActorId::new("reviewer-1"),
        inspector_kind: InspectorKind::Human,
        outcome: InspectionOutcome::Passed,
        criteria: Vec::new(),
        inspected_at: TimestampMs(15),
    };
    let inspection_scope = scope(&store, "reviewer-1");
    assert!(app
        .record_artifact_inspection_v1(
            &inspection_scope,
            "op-inspection",
            &inspection,
            "unix-ms:15",
        )
        .unwrap()
        .changed);
    assert!(!app
        .record_artifact_inspection_v1(
            &inspection_scope,
            "op-inspection",
            &inspection,
            "unix-ms:15",
        )
        .unwrap()
        .changed);
    let evidence = store
        .artifact_evidence_v1("p1", "w1", "submission-1")
        .unwrap()
        .unwrap();
    assert_eq!(evidence.inspections[0].inspector_kind, "human");
    assert_eq!(evidence.inspections[0].inspector_actor_id, "reviewer-1");

    let decision = ArtifactDecision {
        decision_id: "decision-1".into(),
        project_id: project.clone(),
        work_id: WorkId::new("w1"),
        submission_id: "submission-1".into(),
        contract_revision: 1,
        input_revision: 1,
        proof_revision: output.value.proof_revision,
        artifact_set_digest: output.value.artifact_set_digest.clone(),
        reviewer_actor_id: ActorId::new("reviewer-1"),
        producer_actor_id: ActorId::new("agent-1"),
        decision: AcceptanceDecisionKind::Approved,
        reason: "synthetic reviewer accepted exact output".into(),
        decided_at: TimestampMs(16),
    };
    let decision_scope = scope(&store, "reviewer-1");
    assert!(app
        .record_artifact_decision_v1(
            &decision_scope,
            "op-decision",
            &decision,
            "unix-ms:16",
        )
        .unwrap()
        .changed);
    assert!(!app
        .record_artifact_decision_v1(
            &decision_scope,
            "op-decision",
            &decision,
            "unix-ms:16",
        )
        .unwrap()
        .changed);
    let acceptance_revision = store.project_revision("p1").unwrap().0;
    let accepted_output = store
        .output_acceptance_v1("p1", "w1", acceptance_revision)
        .unwrap()
        .unwrap();
    assert!(accepted_output.coverage.accepted);

    assert!(store
        .execute_batch(
            "UPDATE boreal_work_contract_v1
                SET rigor_profile_id='lightweight'
              WHERE project_id='p1' AND work_id='w1' AND contract_revision=1"
        )
        .is_err());
    assert!(store
        .execute_batch(
            "UPDATE boreal_work_accepted_input_v1
                SET role='rewritten'
              WHERE project_id='p1' AND work_id='w1' AND input_revision=1"
        )
        .is_err());

    let wait = ExternalWait {
        wait_id: "wait-review".into(),
        project_id: project.clone(),
        work_id: WorkId::new("w1"),
        category: "customer-decision".into(),
        reason: "Await final synthetic brief approval".into(),
        accountable: AccountableParty::PersonOrRole {
            reference: "reviewer-1".into(),
        },
        expected_decision_or_output: "Approval result".into(),
        follow_up: Some(BusinessMoment::Date(
            BusinessDate::new(CivilDate::parse("2026-10-09").unwrap(), "UTC").unwrap(),
        )),
        created_by: ActorId::new("agent-1"),
        created_at: TimestampMs(17),
        state: ExternalWaitState::Open,
        resolution: None,
        cancellation: None,
    };
    let wait_request = CreateExternalWaitRequest {
        scope: scope(&store, "agent-1"),
        operation_id: "op-wait".into(),
        wait,
        now: "unix-ms:17".into(),
    };
    assert!(app.create_external_wait_v1(&wait_request).unwrap().changed);
    assert!(!app.create_external_wait_v1(&wait_request).unwrap().changed);
    assert!(store.active_external_wait_blocks_work_v1("p1", "w1").unwrap());
    assert!(store
        .general_work_close_gaps_v1("p1", "w1", Some("a1"), Some(1))
        .unwrap()
        .contains(&"external_wait:wait-review".to_owned()));
    let open_wait = store
        .external_waits_v1("p1", Some("w1"), false)
        .unwrap()
        .remove(0);
    assert!(open_wait.follow_up_json.as_deref().unwrap().contains("UTC"));

    let wait_revision = store.project_revision("p1").unwrap().0;
    let resolve_request = ResolveExternalWaitRequest {
        scope: scope(&store, "reviewer-1"),
        operation_id: "op-resolve-wait".into(),
        work_id: "w1".into(),
        wait_id: "wait-review".into(),
        state: ExternalWaitState::Resolved,
        result: Some("Approved brief".into()),
        rationale: "Recorded the synthetic decision".into(),
        now: "unix-ms:18".into(),
    };
    assert!(app
        .resolve_external_wait_v1(&resolve_request)
        .unwrap()
        .changed);
    assert!(!app
        .resolve_external_wait_v1(&resolve_request)
        .unwrap()
        .changed);
    assert!(matches!(
        app.external_wait_list_v1(
            &project,
            Some("w1"),
            true,
            wait_revision,
            TimestampMs(18),
        ),
        Err(boreal_application::ApplicationError::Store(
            boreal_store::StoreError::StaleRevision { .. }
        ))
    ));
    assert!(!store.active_external_wait_blocks_work_v1("p1", "w1").unwrap());
    assert!(store
        .general_work_close_gaps_v1("p1", "w1", Some("a1"), Some(1))
        .unwrap()
        .is_empty());
    let status = store.read_project_status("p1").unwrap();
    let status_work = status
        .works
        .iter()
        .find(|row| row.work.id.as_str() == "w1")
        .expect("work remains visible in status");
    assert_eq!(status_work.work.lifecycle, PersistedLifecycle::Open);
}
