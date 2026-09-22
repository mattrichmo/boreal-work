use boreal_application::{
    ExternalEffectAdapter, ExternalEffectReadback, ExternalEffectRequest, ExternalEffectResolution,
    WorkApplication,
};
use boreal_domain::{
    AcceptanceProfile, DispatchPolicy, PersistedLifecycle, ProjectId, WorkId, WorkItem, WorkKind,
};
use boreal_store::{
    identity::{DatabaseIdentity, IdentityContext, IdentityStore, WorkspaceBinding},
    operations::{OperationBundle, OperationJournal},
    AuditEventRecord, OperationOutcome, OperationRecord, SqliteStore, StoreError,
};

const SCHEMA: &str = include_str!("../../../project/spec/schema-v2.sql");
const PRODUCTION_SCHEMA: &str = include_str!("../../../project/spec/schema-production.sql");

fn work(project_id: &ProjectId) -> WorkItem {
    WorkItem {
        id: WorkId::new("work-external-job"),
        project_id: project_id.clone(),
        kind: WorkKind::Task,
        parent_id: None,
        title: "external job test".to_owned(),
        description: String::new(),
        lifecycle: PersistedLifecycle::Open,
        priority: 0,
        dispatch_policy: DispatchPolicy::Automatic,
        hard_holds: Vec::new(),
        acceptance_profile: AcceptanceProfile::focused(),
    }
}

fn setup() -> (SqliteStore, ProjectId) {
    let store = SqliteStore::open_in_memory(SCHEMA).expect("open store");
    let app = WorkApplication::new(&store);
    let project = ProjectId::new("project-external-job");
    app.init_project(
        &project,
        "agent-1",
        "agent",
        "credential",
        "External jobs",
        "unix-ms:1",
        "op-init-external-job",
    )
    .expect("initialize project");
    app.create_work_as(
        &work(&project),
        "agent-1",
        "unix-ms:2",
        "op-create-external-job",
    )
    .expect("create work");
    (store, project)
}

fn request(project_id: &ProjectId) -> ExternalEffectRequest {
    ExternalEffectRequest {
        job_id: "job-evidence-1".to_owned(),
        operation_id: "op-evidence-1".to_owned(),
        project_id: project_id.as_str().to_owned(),
        subject_type: "work".to_owned(),
        subject_id: "work-external-job".to_owned(),
        kind: "verifier".to_owned(),
        request_digest: "sha256:request-evidence-1".to_owned(),
        source_identity: Some("source-1".to_owned()),
        config_identity: Some("config-1".to_owned()),
        actor_id: "agent-1".to_owned(),
        session_id: Some("session-1".to_owned()),
        deadline: Some("unix-ms:100".to_owned()),
        created_at: "unix-ms:3".to_owned(),
    }
}

fn bound_setup() -> (SqliteStore, IdentityContext, ProjectId) {
    let store = SqliteStore::open_in_memory(PRODUCTION_SCHEMA).expect("open production store");
    let project = ProjectId::new("project-bound-external-job");
    store
        .create_project(project.as_str(), "unix-ms:0")
        .expect("project creates");
    store
        .ensure_actor("agent-1", "agent", "credential", "Agent 1", "unix-ms:0")
        .expect("actor creates");
    IdentityStore::new(&store)
        .install(
            &DatabaseIdentity::new("database-bound-external-job", 1).expect("database identity"),
            "unix-ms:1",
        )
        .expect("identity installs");
    let binding = WorkspaceBinding::new(
        "/tmp/boreal-bound-external-job",
        "/tmp/boreal-bound-external-job",
        "sha256:bound-external-job",
    )
    .expect("workspace binding");
    let context = IdentityStore::new(&store)
        .bind_project(project.as_str(), &binding, "unix-ms:1")
        .expect("project binds");
    let operation = OperationRecord {
        operation_id: "op-bound-external-job".to_owned(),
        project_id: project.as_str().to_owned(),
        command: "external.verify".to_owned(),
        actor_id: "agent-1".to_owned(),
        session_id: None,
        expected_revision: None,
        attempt_id: None,
        fence: None,
        request_digest: "sha256:bound-external-job".to_owned(),
        outcome: OperationOutcome::Changed,
        result_json: r#"{"accepted":false}"#.to_owned(),
        revision: 1,
        created_at: "unix-ms:2".to_owned(),
        completed_at: Some("unix-ms:2".to_owned()),
    };
    let audit = AuditEventRecord {
        project_id: project.as_str().to_owned(),
        revision: 1,
        operation_id: operation.operation_id.clone(),
        event_type: "attempt.started".to_owned(),
        subject_type: "project".to_owned(),
        subject_id: project.as_str().to_owned(),
        actor_id: "agent-1".to_owned(),
        session_id: None,
        fence: None,
        as_of: "unix-ms:2".to_owned(),
        payload_json: operation.result_json.clone(),
    };
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
    (store, context, project)
}

#[test]
fn external_effect_requires_readback_before_reconciliation() {
    let (store, project) = setup();
    let adapter = ExternalEffectAdapter::new(&store);
    let request = request(&project);

    let admitted = adapter.admit(&request).expect("admit job");
    assert!(matches!(admitted, ExternalEffectResolution::Pending(_)));
    assert!(!admitted.is_resolved());

    adapter
        .start(project.as_str(), "job-evidence-1", "unix-ms:4")
        .expect("start job");
    adapter
        .mark_side_effect_started(
            project.as_str(),
            "job-evidence-1",
            "process:verifier-1",
            "unix-ms:5",
        )
        .expect("mark side effect");

    let pending = adapter
        .mark_readback_required(
            project.as_str(),
            "job-evidence-1",
            "process:verifier-1",
            "unix-ms:6",
        )
        .expect("mark readback required");
    assert!(matches!(
        pending,
        ExternalEffectResolution::ReadbackRequired(_)
    ));
    assert!(!pending.is_resolved());

    let readback = adapter
        .readback(
            project.as_str(),
            "op-evidence-1",
            "sha256:request-evidence-1",
        )
        .expect("read back pending job");
    assert!(matches!(
        readback,
        ExternalEffectResolution::ReadbackRequired(_)
    ));

    let reconciled = adapter
        .reconcile_readback(&ExternalEffectReadback {
            project_id: project.as_str().to_owned(),
            job_id: "job-evidence-1".to_owned(),
            operation_id: "op-evidence-1".to_owned(),
            request_digest: "sha256:request-evidence-1".to_owned(),
            side_effect_ref: "process:verifier-1".to_owned(),
            result_digest: "sha256:verified-result-1".to_owned(),
            observed_at: "unix-ms:7".to_owned(),
        })
        .expect("reconcile job");
    assert!(matches!(
        reconciled,
        ExternalEffectResolution::Reconciled(_)
    ));
    assert!(reconciled.is_resolved());
    assert_eq!(
        reconciled.record().side_effect_ref.as_deref(),
        Some("process:verifier-1")
    );
    assert_eq!(
        reconciled.record().result_digest.as_deref(),
        Some("sha256:verified-result-1")
    );
}

#[test]
fn external_effect_replay_preserves_identity_and_rejects_digest_drift() {
    let (store, project) = setup();
    let adapter = ExternalEffectAdapter::new(&store);
    let request = request(&project);
    adapter.admit(&request).expect("admit job");

    let replay = adapter.admit(&request).expect("replay admission");
    assert!(matches!(replay, ExternalEffectResolution::Pending(_)));
    assert_eq!(replay.record().operation_id, request.operation_id);
    assert_eq!(replay.record().request_digest, request.request_digest);

    let drift = adapter.readback(
        project.as_str(),
        &request.operation_id,
        "sha256:wrong-request",
    );
    assert!(matches!(drift, Err(StoreError::Conflict(_))));

    let wrong_project = adapter.readback(
        "other-project",
        &request.operation_id,
        &request.request_digest,
    );
    assert!(matches!(wrong_project, Err(StoreError::NotFound { .. })));
}

#[test]
fn external_effect_cannot_reconcile_without_readback_stage() {
    let (store, project) = setup();
    let adapter = ExternalEffectAdapter::new(&store);
    let request = request(&project);
    adapter.admit(&request).expect("admit job");
    adapter
        .start(project.as_str(), &request.job_id, "unix-ms:4")
        .expect("start job");

    let error = adapter.reconcile_readback(&ExternalEffectReadback {
        project_id: project.as_str().to_owned(),
        job_id: request.job_id.clone(),
        operation_id: request.operation_id.clone(),
        request_digest: request.request_digest.clone(),
        side_effect_ref: "process:verifier-1".to_owned(),
        result_digest: "sha256:premature".to_owned(),
        observed_at: "unix-ms:5".to_owned(),
    });
    assert!(matches!(error, Err(StoreError::Conflict(_))));
}

#[test]
fn external_effect_reconciliation_requires_matching_attributable_identity() {
    let (store, project) = setup();
    let adapter = ExternalEffectAdapter::new(&store);
    let request = request(&project);
    adapter.admit(&request).expect("admit job");
    adapter
        .start(project.as_str(), &request.job_id, "unix-ms:4")
        .expect("start job");
    adapter
        .mark_side_effect_started(
            project.as_str(),
            &request.job_id,
            "process:verifier-1",
            "unix-ms:5",
        )
        .expect("mark side effect");
    adapter
        .mark_readback_required(
            project.as_str(),
            &request.job_id,
            "process:verifier-1",
            "unix-ms:6",
        )
        .expect("mark readback required");

    let wrong_effect = adapter.reconcile_readback(&ExternalEffectReadback {
        project_id: project.as_str().to_owned(),
        job_id: request.job_id.clone(),
        operation_id: request.operation_id.clone(),
        request_digest: request.request_digest.clone(),
        side_effect_ref: "process:other-verifier".to_owned(),
        result_digest: "sha256:verified-result-1".to_owned(),
        observed_at: "unix-ms:7".to_owned(),
    });
    assert!(matches!(wrong_effect, Err(StoreError::Conflict(_))));

    let wrong_operation = adapter.reconcile_readback(&ExternalEffectReadback {
        project_id: project.as_str().to_owned(),
        job_id: request.job_id.clone(),
        operation_id: "op-other".to_owned(),
        request_digest: request.request_digest.clone(),
        side_effect_ref: "process:verifier-1".to_owned(),
        result_digest: "sha256:verified-result-1".to_owned(),
        observed_at: "unix-ms:7".to_owned(),
    });
    assert!(matches!(wrong_operation, Err(StoreError::Conflict(_))));

    let readback = ExternalEffectReadback {
        project_id: project.as_str().to_owned(),
        job_id: request.job_id,
        operation_id: request.operation_id,
        request_digest: request.request_digest,
        side_effect_ref: "process:verifier-1".to_owned(),
        result_digest: "sha256:verified-result-1".to_owned(),
        observed_at: "unix-ms:7".to_owned(),
    };
    let first = adapter
        .reconcile_readback(&readback)
        .expect("reconcile attributable readback");
    let replay = adapter
        .reconcile_readback(&readback)
        .expect("replay attributable readback");
    assert!(first.is_resolved());
    assert_eq!(first, replay);
}

#[test]
fn external_effect_rejects_empty_admission_identity() {
    let (store, project) = setup();
    let adapter = ExternalEffectAdapter::new(&store);
    let mut request = request(&project);
    request.request_digest.clear();
    let error = adapter.admit(&request);
    assert!(matches!(error, Err(StoreError::Invalid(_))));
}

#[test]
fn identity_bound_adapter_uses_current_store_authority() {
    let (store, context, project) = bound_setup();
    let mut request = request(&project);
    request.job_id = "job-bound-external".to_owned();
    request.operation_id = "op-bound-external-job".to_owned();
    request.subject_type = "project".to_owned();
    request.subject_id = project.as_str().to_owned();
    request.session_id = None;
    request.request_digest = "sha256:bound-external-job".to_owned();
    let adapter = ExternalEffectAdapter::new_with_identity(&store, &context);

    let admitted = adapter.admit(&request).expect("identity-bound admit");
    assert!(matches!(admitted, ExternalEffectResolution::Pending(_)));
    adapter
        .start(project.as_str(), &request.job_id, "unix-ms:4")
        .expect("identity-bound start");
    adapter
        .mark_side_effect_started(
            project.as_str(),
            &request.job_id,
            "process:bound-verifier",
            "unix-ms:5",
        )
        .expect("identity-bound side effect");
    let pending = adapter
        .mark_readback_required(
            project.as_str(),
            &request.job_id,
            "process:bound-verifier",
            "unix-ms:6",
        )
        .expect("identity-bound readback marker");
    assert!(matches!(
        pending,
        ExternalEffectResolution::ReadbackRequired(_)
    ));
    assert!(matches!(
        adapter.readback(
            project.as_str(),
            &request.operation_id,
            &request.request_digest,
        ),
        Ok(ExternalEffectResolution::ReadbackRequired(_))
    ));

    let legacy = ExternalEffectAdapter::new(&store);
    assert!(matches!(
        legacy.admit(&request),
        Err(StoreError::Conflict(message)) if message.contains("identity-bound API")
    ));
}
