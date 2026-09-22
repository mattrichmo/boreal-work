use boreal_application::{
    AttemptAdapterError, AttemptCommand, AttemptCommandKind, AttemptLifecycleAdapter,
    AttemptMutation, AttemptRequest, AttemptSnapshot, EndAttemptRequest, ExternalEffectAdapter,
    ExternalEffectObservation, ExternalEffectReadback, ExternalEffectRequest,
    ExternalEffectResolution, SqliteAttemptAdapter, WorkApplication,
};
use boreal_domain::{
    AcceptanceProfile, ActorId, AttemptId, AttemptPhase, DispatchPolicy, Fence, HarnessId,
    OperationId, PersistedLifecycle, ProjectId, TimestampMs, WorkId, WorkItem, WorkKind,
};
use boreal_store::{
    identity::{DatabaseIdentity, IdentityContext, IdentityStore, WorkspaceBinding},
    operations::{OperationBundle, OperationJournal},
    recovery::{
        IdentityBoundRecoveryResolutionInput, RecoveryObligationInput, RecoveryResolutionInput,
    },
    AuditEventRecord, OperationOutcome, OperationRecord, SqliteStore, StoreError,
};
use std::{
    fs,
    path::Path,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Barrier,
    },
    time::{SystemTime, UNIX_EPOCH},
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
    bound_setup_with_store(
        SqliteStore::open_in_memory(PRODUCTION_SCHEMA).expect("open production store"),
    )
}

fn bound_setup_with_store(store: SqliteStore) -> (SqliteStore, IdentityContext, ProjectId) {
    let project = ProjectId::new("project-bound-external-job");
    store
        .create_project(project.as_str(), "unix-ms:0")
        .expect("project creates");
    store
        .ensure_actor("agent-1", "agent", "credential", "Agent 1", "unix-ms:0")
        .expect("actor creates");
    let identities = IdentityStore::new(&store);
    if identities.database_identity().is_err() {
        identities
            .install(
                &DatabaseIdentity::new("database-bound-external-job", 1)
                    .expect("database identity"),
                "unix-ms:1",
            )
            .expect("identity installs");
    }
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

fn bound_request(project: &ProjectId) -> ExternalEffectRequest {
    let mut request = request(project);
    request.job_id = "job-bound-external".to_owned();
    request.operation_id = "op-bound-external-job".to_owned();
    request.subject_type = "project".to_owned();
    request.subject_id = project.as_str().to_owned();
    request.session_id = None;
    request.request_digest = "sha256:bound-external-job".to_owned();
    request
}

struct TerminalAdapter {
    snapshot: AttemptSnapshot,
}

impl AttemptLifecycleAdapter for TerminalAdapter {
    fn current_attempt(
        &self,
        _project_id: &ProjectId,
        _attempt_id: &AttemptId,
    ) -> Result<AttemptSnapshot, AttemptAdapterError> {
        Ok(self.snapshot.clone())
    }

    fn transact_attempt(
        &self,
        command: AttemptCommand,
    ) -> Result<AttemptMutation, AttemptAdapterError> {
        Ok(AttemptMutation {
            operation_id: command.operation_id,
            request_digest: command.request_digest,
            attempt_id: command.attempt_id,
            fence: command.fence,
            phase: AttemptPhase::Released,
            lease_deadline: command.expected_lease_deadline,
            hard_deadline: command.expected_hard_deadline,
            revision: 1,
            changed: true,
            replayed: false,
        })
    }

    fn read_attempt_operation(
        &self,
        _project_id: &ProjectId,
        _operation_id: &OperationId,
    ) -> Result<Option<AttemptMutation>, AttemptAdapterError> {
        Ok(None)
    }
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
    let request = bound_request(&project);
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

#[test]
fn terminal_release_uses_canonical_identity_bound_recovery() {
    let store = SqliteStore::open_in_memory(PRODUCTION_SCHEMA).expect("open terminal store");
    let project = ProjectId::new("project-terminal-release");
    store
        .create_project(project.as_str(), "unix-ms:0")
        .expect("terminal project creates");
    store
        .ensure_actor("agent-1", "agent", "credential", "Agent 1", "unix-ms:0")
        .expect("terminal actor creates");
    let identities = IdentityStore::new(&store);
    identities
        .install(
            &DatabaseIdentity::new("database-terminal-release", 1)
                .expect("terminal database identity"),
            "unix-ms:1",
        )
        .expect("terminal identity installs");
    let context = IdentityStore::new(&store)
        .bind_project(
            project.as_str(),
            &WorkspaceBinding::new(
                "/tmp/boreal-terminal-release",
                "/tmp/boreal-terminal-release",
                "sha256:terminal-release",
            )
            .expect("terminal workspace binding"),
            "unix-ms:1",
        )
        .expect("terminal project binds");
    let app = WorkApplication::new(&store);
    app.create_work_as(
        &work(&project),
        "agent-1",
        "unix-ms:2",
        "op-create-terminal-release",
    )
    .expect("create terminal-release work");
    app.claim(
        &project,
        "work-external-job",
        "agent-1",
        "harness-terminal",
        None,
        "attempt-terminal-release",
        "op-claim-terminal-release",
        "sha256:claim-terminal-release",
        None,
        "unix-ms:1000",
        "unix-ms:1800000",
        "unix-ms:7200000",
    )
    .expect("claim terminal-release attempt");

    let adapter = SqliteAttemptAdapter::new(&store);
    let terminal = app
        .release(
            &adapter,
            EndAttemptRequest {
                attempt: AttemptRequest::new(
                    project.clone(),
                    WorkId::new("work-external-job"),
                    AttemptId::new("attempt-terminal-release"),
                    ActorId::new("agent-1"),
                    Some(HarnessId::new("harness-terminal")),
                    None,
                    Fence::new(1),
                    OperationId::new("op-terminal-release"),
                    "sha256:terminal-release",
                    TimestampMs(2000),
                ),
                reason: Some("terminal release regression".to_owned()),
            },
        )
        .expect("terminal release is recorded with canonical recovery");
    assert_eq!(terminal.value.phase, boreal_domain::AttemptPhase::Released);

    let reservation = store
        .resource_reservation(&project.to_string(), "resource:attempt-terminal-release")
        .expect("canonical resource reads")
        .expect("canonical resource exists");
    assert_eq!(reservation.state, "release_pending");

    let recovery = app
        .attempt_recovery_readback(
            &project,
            &OperationId::new("op-terminal-release"),
            AttemptCommandKind::Release,
        )
        .expect("terminal recovery reads back");
    assert!(recovery.is_readback_required());

    let resolution = IdentityBoundRecoveryResolutionInput {
        context: context.clone(),
        operation_id: "op-resolve-terminal-release".to_owned(),
        request_digest: "sha256:resolve-terminal-release".to_owned(),
        expected_project_revision: None,
        session_id: None,
        resolution: RecoveryResolutionInput {
            project_id: project.to_string(),
            obligation_id: "op-terminal-release:recovery:resource-unknown".to_owned(),
            resolution_id: "resolution-terminal-release".to_owned(),
            actor_id: "agent-1".to_owned(),
            outcome: "resource_released".to_owned(),
            reason: "terminal resource release was read back".to_owned(),
            resource_state: "released".to_owned(),
            at: "unix-ms:3000".to_owned(),
        },
    };
    let resolved = app
        .resolve_attempt_recovery_with_identity(&resolution)
        .expect("identity-bound recovery acknowledges canonical release");
    assert_eq!(resolved.state, "resolved");
    assert_eq!(
        store
            .resource_reservation(&project.to_string(), "resource:attempt-terminal-release")
            .expect("released resource reads")
            .expect("released resource exists")
            .state,
        "released"
    );

    let replay = app
        .resolve_attempt_recovery_with_identity(&resolution)
        .expect("same recovery operation replays");
    assert_eq!(replay.resolution_id, resolved.resolution_id);

    let mut foreign = resolution;
    foreign.resolution.project_id = "foreign-project".to_owned();
    assert!(matches!(
        app.resolve_attempt_recovery_with_identity(&foreign),
        Err(boreal_application::ApplicationError::Store(
            StoreError::WrongSubject { .. }
        ))
    ));
}

#[test]
fn terminal_release_fallback_fails_closed_without_canonical_store_mutation() {
    let store = SqliteStore::open_in_memory(PRODUCTION_SCHEMA).expect("open fallback store");
    let project = ProjectId::new("project-terminal-fallback");
    store
        .create_project(project.as_str(), "unix-ms:0")
        .expect("fallback project creates");
    store
        .ensure_actor("agent-1", "agent", "credential", "Agent 1", "unix-ms:0")
        .expect("fallback actor creates");
    IdentityStore::new(&store)
        .install(
            &DatabaseIdentity::new("database-terminal-fallback", 1)
                .expect("fallback database identity"),
            "unix-ms:1",
        )
        .expect("fallback identity installs");
    let _context = IdentityStore::new(&store)
        .bind_project(
            project.as_str(),
            &WorkspaceBinding::new(
                "/tmp/boreal-terminal-fallback",
                "/tmp/boreal-terminal-fallback",
                "sha256:terminal-fallback",
            )
            .expect("fallback workspace binding"),
            "unix-ms:1",
        )
        .expect("fallback project binds");
    let app = WorkApplication::new(&store);
    app.create_work_as(
        &work(&project),
        "agent-1",
        "unix-ms:2",
        "op-create-terminal-fallback",
    )
    .expect("create fallback work");
    app.claim(
        &project,
        "work-external-job",
        "agent-1",
        "harness-terminal",
        None,
        "attempt-terminal-fallback",
        "op-claim-terminal-fallback",
        "sha256:claim-terminal-fallback",
        None,
        "unix-ms:1000",
        "unix-ms:1800000",
        "unix-ms:7200000",
    )
    .expect("claim fallback attempt");
    store
        .create_recovery_obligation(&RecoveryObligationInput {
            obligation_id: "op-terminal-fallback:recovery:resource-unknown".to_owned(),
            project_id: project.as_str().to_owned(),
            work_id: "work-external-job".to_owned(),
            attempt_id: Some("attempt-terminal-fallback".to_owned()),
            fence: Some(1),
            reason: "resource_unknown".to_owned(),
            resource_state: "unknown".to_owned(),
            owner_actor_id: Some("agent-1".to_owned()),
            next_action: "acknowledge terminal resource release".to_owned(),
            created_at: "unix-ms:2000".to_owned(),
        })
        .expect("fallback recovery obligation creates");

    let adapter = TerminalAdapter {
        snapshot: AttemptSnapshot {
            project_id: project.clone(),
            work_id: WorkId::new("work-external-job"),
            attempt_id: AttemptId::new("attempt-terminal-fallback"),
            actor_id: ActorId::new("agent-1"),
            harness_id: Some(HarnessId::new("harness-terminal")),
            session_id: None,
            fence: Fence::new(1),
            phase: AttemptPhase::Running,
            claimed_at: TimestampMs(1000),
            accepted_at: Some(TimestampMs(1001)),
            lease_deadline: TimestampMs(1800000),
            hard_deadline: TimestampMs(7200000),
            current: true,
        },
    };
    let release_result = app.release(
        &adapter,
        EndAttemptRequest {
            attempt: AttemptRequest::new(
                project.clone(),
                WorkId::new("work-external-job"),
                AttemptId::new("attempt-terminal-fallback"),
                ActorId::new("agent-1"),
                Some(HarnessId::new("harness-terminal")),
                None,
                Fence::new(1),
                OperationId::new("op-terminal-fallback"),
                "sha256:terminal-fallback",
                TimestampMs(2000),
            ),
            reason: Some("fallback terminal release".to_owned()),
        },
    );
    assert!(matches!(
        release_result,
        Err(boreal_application::ApplicationError::AttemptAdapter(
            AttemptAdapterError::UnknownOutcome(message)
        )) if message.contains("canonical terminal resource release was not durably admitted")
    ));
    assert_eq!(
        store
            .resource_reservation(project.as_str(), "resource:attempt-terminal-fallback")
            .expect("fallback resource reads")
            .expect("fallback resource exists")
            .state,
        "active"
    );
}

#[test]
fn external_effect_execute_admits_before_external_work_and_reconciles() {
    let (store, project) = setup();
    let adapter = ExternalEffectAdapter::new(&store);
    let mut request = request(&project);
    request.job_id = "job-execute-verifier".to_owned();
    request.operation_id = "op-execute-verifier".to_owned();

    let outcome = adapter
        .execute(&request, "unix-ms:4", |running| {
            assert_eq!(running.stage, "running");
            assert_eq!(running.operation_id, request.operation_id);
            assert_eq!(running.project_id, request.project_id);
            Ok(ExternalEffectObservation::Reconciled {
                side_effect_ref: "process:execute-verifier".to_owned(),
                result_digest: "sha256:execute-result".to_owned(),
                observed_at: "unix-ms:7".to_owned(),
            })
        })
        .expect("execute and reconcile verifier job");

    assert!(matches!(outcome, ExternalEffectResolution::Reconciled(_)));
    assert!(outcome.is_resolved());
    assert_eq!(
        outcome.record().side_effect_ref.as_deref(),
        Some("process:execute-verifier")
    );
}

#[test]
fn external_effect_execute_pending_remains_unresolved_for_readback() {
    let (store, project) = setup();
    let adapter = ExternalEffectAdapter::new(&store);
    let mut request = request(&project);
    request.job_id = "job-pending-verifier".to_owned();
    request.operation_id = "op-pending-verifier".to_owned();

    let outcome = adapter
        .execute(&request, "unix-ms:4", |_| {
            Ok(ExternalEffectObservation::Pending)
        })
        .expect("leave verifier job pending");

    assert!(outcome.is_pending());
    assert!(!outcome.is_resolved());
    assert!(matches!(
        adapter
            .readback(
                &request.project_id,
                &request.operation_id,
                &request.request_digest,
            )
            .expect("read back pending verifier job"),
        ExternalEffectResolution::Pending(_)
    ));
}

#[test]
fn external_effect_replay_does_not_invoke_running_side_effect_twice() {
    use std::cell::Cell;

    let (store, project) = setup();
    let adapter = ExternalEffectAdapter::new(&store);
    let mut request = request(&project);
    request.job_id = "job-replay-running".to_owned();
    request.operation_id = "op-replay-running".to_owned();
    let callback_count = Cell::new(0);

    let first = adapter
        .execute(&request, "unix-ms:4", |_| {
            callback_count.set(callback_count.get() + 1);
            Ok(ExternalEffectObservation::Pending)
        })
        .expect("start the first external effect");
    assert!(first.is_pending());
    assert_eq!(first.record().stage, "running");

    let replay = adapter
        .execute(&request, "unix-ms:5", |_| {
            callback_count.set(callback_count.get() + 1);
            Ok(ExternalEffectObservation::Pending)
        })
        .expect("read back the running external effect");
    assert!(replay.is_pending());
    assert_eq!(replay.record().stage, "running");
    assert_eq!(callback_count.get(), 1);
}

#[test]
fn external_effect_competing_callers_invoke_only_the_winning_callback() {
    let path = std::env::temp_dir().join(format!(
        "boreal-t11-external-race-{}-{}.db",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos()
    ));

    let seed = SqliteStore::open(&path, SCHEMA).expect("open race seed store");
    let app = WorkApplication::new(&seed);
    let project = ProjectId::new("project-external-race");
    app.init_project(
        &project,
        "agent-1",
        "agent",
        "credential",
        "External race",
        "unix-ms:1",
        "op-init-external-race",
    )
    .expect("initialize race project");
    app.create_work_as(
        &WorkItem {
            id: WorkId::new("work-external-race"),
            project_id: project.clone(),
            kind: WorkKind::Task,
            parent_id: None,
            title: "external race test".to_owned(),
            description: String::new(),
            lifecycle: PersistedLifecycle::Open,
            priority: 0,
            dispatch_policy: DispatchPolicy::Automatic,
            hard_holds: Vec::new(),
            acceptance_profile: AcceptanceProfile::focused(),
        },
        "agent-1",
        "unix-ms:2",
        "op-create-external-race",
    )
    .expect("create race work");
    let mut request = request(&project);
    request.job_id = "job-external-race".to_owned();
    request.operation_id = "op-external-race".to_owned();
    request.subject_id = "work-external-race".to_owned();
    ExternalEffectAdapter::new(&seed)
        .admit(&request)
        .expect("admit race job before competing starts");
    drop(seed);

    let left_store = SqliteStore::open(&path, SCHEMA).expect("open left race store");
    let right_store = SqliteStore::open(&path, SCHEMA).expect("open right race store");
    let barrier = Arc::new(Barrier::new(2));
    let callback_count = Arc::new(AtomicUsize::new(0));

    let (left, right) = std::thread::scope(|scope| {
        let left_barrier = Arc::clone(&barrier);
        let left_count = Arc::clone(&callback_count);
        let left_request = request.clone();
        let left_handle = scope.spawn(move || {
            let adapter = ExternalEffectAdapter::new(&left_store);
            left_barrier.wait();
            adapter.execute(&left_request, "unix-ms:4", |_| {
                left_count.fetch_add(1, Ordering::SeqCst);
                Ok(ExternalEffectObservation::Pending)
            })
        });

        let right_barrier = Arc::clone(&barrier);
        let right_count = Arc::clone(&callback_count);
        let right_request = request.clone();
        let right_handle = scope.spawn(move || {
            let adapter = ExternalEffectAdapter::new(&right_store);
            right_barrier.wait();
            adapter.execute(&right_request, "unix-ms:4", |_| {
                right_count.fetch_add(1, Ordering::SeqCst);
                Ok(ExternalEffectObservation::Pending)
            })
        });

        (
            left_handle.join().expect("left competing caller completes"),
            right_handle
                .join()
                .expect("right competing caller completes"),
        )
    });

    for outcome in [left, right] {
        let outcome = outcome.expect("competing caller reads durable running state");
        assert!(outcome.is_pending());
        assert_eq!(outcome.record().stage, "running");
    }
    assert_eq!(callback_count.load(Ordering::SeqCst), 1);

    let _ = fs::remove_file(&path);
    let _ = fs::remove_file(path.with_extension("db-wal"));
    let _ = fs::remove_file(path.with_extension("db-shm"));
}

#[test]
fn external_effect_execute_rejects_without_claiming_external_success() {
    let (store, project) = setup();
    let adapter = ExternalEffectAdapter::new(&store);
    let mut request = request(&project);
    request.job_id = "job-rejected-verifier".to_owned();
    request.operation_id = "op-rejected-verifier".to_owned();

    let admitted = adapter.admit(&request).expect("admit verifier job");
    assert!(matches!(admitted, ExternalEffectResolution::Pending(_)));
    let outcome = adapter
        .reject(
            &request.project_id,
            &request.job_id,
            "unix-ms:5",
            "verifier policy denied execution",
        )
        .expect("record rejected verifier job");

    assert!(outcome.is_rejected());
    assert!(!outcome.is_resolved());
    assert_eq!(
        outcome.record().error_message.as_deref(),
        Some("verifier policy denied execution")
    );
}

#[test]
fn external_effect_restart_preserves_running_job_for_readback() {
    let path = std::env::temp_dir().join(format!(
        "boreal-t11-external-restart-{}-{}.db",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos()
    ));
    let (store, context, project) = bound_setup_with_store(
        SqliteStore::open(&path, PRODUCTION_SCHEMA).expect("open restart store"),
    );
    let request = bound_request(&project);
    {
        let adapter = ExternalEffectAdapter::new_with_identity(&store, &context);
        adapter.admit(&request).expect("register durable job");
        adapter
            .start(project.as_str(), &request.job_id, "unix-ms:4")
            .expect("start durable job");
    }
    drop(store);

    let reopened = SqliteStore::open(&path, PRODUCTION_SCHEMA).expect("reopen restart store");
    let reopened_context = IdentityStore::new(&reopened)
        .context(project.as_str())
        .expect("read identity after restart");
    let restarted = ExternalEffectAdapter::new_with_identity(&reopened, &reopened_context);
    let readback = restarted
        .readback(
            project.as_str(),
            &request.operation_id,
            &request.request_digest,
        )
        .expect("read back running job after restart");
    assert!(readback.is_pending());
    assert_eq!(readback.record().stage, "running");

    drop(reopened);
    for suffix in ["", "-wal", "-shm"] {
        let candidate = if suffix.is_empty() {
            path.clone()
        } else {
            Path::new(&format!("{}{}", path.display(), suffix)).to_path_buf()
        };
        let _ = fs::remove_file(candidate);
    }
}
