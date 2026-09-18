use boreal_application::{project_status_from_store, WorkApplication};
use boreal_domain::{
    AcceptanceProfile, ActorContext, ActorId, ActorRole, DispatchPolicy, PersistedLifecycle,
    ProjectId, TimestampMs, WorkId, WorkItem, WorkKind,
};
use boreal_store::{SqliteStore, StoreError};

const SCHEMA: &str = include_str!("../../../project/spec/schema-v2.sql");

fn work(project_id: &ProjectId, work_id: &str) -> WorkItem {
    WorkItem {
        id: WorkId::new(work_id),
        project_id: project_id.clone(),
        kind: WorkKind::Task,
        parent_id: None,
        title: work_id.to_owned(),
        description: String::new(),
        lifecycle: PersistedLifecycle::Open,
        priority: 0,
        dispatch_policy: DispatchPolicy::Automatic,
        hard_holds: Vec::new(),
        acceptance_profile: AcceptanceProfile::focused(),
    }
}

fn init(app: &WorkApplication<'_>, project_id: &ProjectId) {
    app.init_project(
        project_id,
        "agent-1",
        "agent",
        "credential",
        "Agent",
        "unix-ms:0",
        "op-init",
    )
    .unwrap();
}

#[test]
fn application_consumers_preserve_deep_pages_and_candidate_continuations() {
    let store = SqliteStore::open_in_memory(SCHEMA).unwrap();
    let app = WorkApplication::new(&store);
    let project = ProjectId::new("p-page");
    init(&app, &project);

    for index in 0..1_001 {
        let id = format!("w-{index:04}");
        app.create_work_as(
            &work(&project, &id),
            "agent-1",
            &format!("unix-ms:{}", index + 1),
            format!("op-{id}"),
        )
        .unwrap();
    }

    let first = app
        .claimable_work_candidates(&project, "unix-ms:2000", 1_000, None)
        .unwrap();
    assert_eq!(first.len(), 1_000);
    let second = app
        .claimable_work_candidates(
            &project,
            "unix-ms:2000",
            1_000,
            first.last().map(String::as_str),
        )
        .unwrap();
    assert_eq!(second, vec!["w-1000"]);

    let actor = ActorContext {
        actor_id: ActorId::new("status-reader"),
        role: ActorRole::Agent,
    };
    let page =
        project_status_from_store(&store, &project, &actor, TimestampMs(2_000), 1, 1_000).unwrap();
    assert_eq!(page.total, 1_001);
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.items[0].work.id.as_str(), "w-1000");
}

#[test]
fn application_operation_readback_enforces_project_scope_for_execution_only_rows() {
    let store = SqliteStore::open_in_memory(SCHEMA).unwrap();
    let app = WorkApplication::new(&store);
    let project = ProjectId::new("p-readback");
    init(&app, &project);
    app.create_work_as(&work(&project, "w-exec"), "agent-1", "unix-ms:1", "op-work")
        .unwrap();
    let gate_id = store
        .gate_id_for_work(project.as_str(), "w-exec", "checkpoint")
        .unwrap();
    store
        .execute_batch(&format!(
            "INSERT INTO attempt (
                     attempt_id, work_id, actor_id, harness_id, fence, current, state,
                     claimed_at, accepted_at, lease_deadline, max_attempt_deadline,
                     config_identity, binary_identity, protocol_version, schema_version
                 ) VALUES ('attempt-exec', 'w-exec', 'agent-1', 'harness-1', 1, 1,
                           'running', 'unix-ms:1', 'unix-ms:1', 'unix-ms:2', 'unix-ms:3',
                           'config', 'binary', 'boreal.protocol.envelope.v1', 2);
                 INSERT INTO evidence_execution (
                     operation_id, project_id, work_id, attempt_id, fence, gate_id,
                     actor_id, request_digest, artifact_ref, state, admitted_at
                 ) VALUES ('op-exec', 'p-readback', 'w-exec', 'attempt-exec', 1,
                           '{gate_id}', 'agent-1', 'sha256:req', 'artifact-1',
                           'admitted', 'unix-ms:1');"
        ))
        .unwrap();

    let readback = app
        .operation_readback(&project, "op-exec")
        .unwrap()
        .unwrap();
    assert!(readback.operation.is_none());
    assert_eq!(
        readback.execution.as_ref().unwrap().project_id,
        "p-readback"
    );

    let wrong_project = app.operation_readback(&ProjectId::new("other"), "op-exec");
    assert!(matches!(
        wrong_project,
        Err(boreal_application::ApplicationError::Store(
            StoreError::WrongSubject { .. }
        ))
    ));
}
