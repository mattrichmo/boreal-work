//! Combined PF-S02-T10 production-store integration checks.
//!
//! These cases intentionally cross the opener, immutable requirement seam,
//! operation identity boundary and durable resource-release protocol. They do
//! not claim application, service, verifier, release or platform behavior.

use boreal_store::{
    identity::{DatabaseIdentity, IdentityStore, WorkspaceBinding},
    operations::{OperationBundle, OperationJournal},
    profiles::{PinnedRequirements, ProfileStore, ProfileVersion, RequirementSubjectKind},
    AuditEventRecord, OperationOutcome, OperationRecord, SqliteStore, StoreError,
};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const PRODUCTION_SCHEMA: &str = include_str!("../../../project/spec/schema-production.sql");
const SCHEMA_V2: &str = include_str!("../../../project/spec/schema-v2.sql");

fn temp_path(label: &str) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock is after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!(
        "boreal-production-integration-{label}-{}-{stamp}.sqlite",
        std::process::id()
    ))
}

fn remove_sqlite_files(path: &Path) {
    let _ = std::fs::remove_file(path);
    let _ = std::fs::remove_file(path.with_extension("sqlite-wal"));
    let _ = std::fs::remove_file(path.with_extension("sqlite-shm"));
}

fn profile(id: &str, version: u64) -> ProfileVersion {
    let definition = format!(
        r#"{{"required_observables":["exit_status"],"gates":[{{"id":"verification","kind":"verification","required":true}}],"review_policy":{{"required":false}},"subject_rules":{{"work_id":"exact"}},"profile":"{id}"}}"#
    );
    let provisional = ProfileVersion::new(id, version, "sha256:placeholder", &definition, "t0")
        .expect("profile definition parses");
    let digest = provisional
        .computed_digest()
        .expect("profile digest computes");
    ProfileVersion::from_canonical_definition(id, version, digest, definition, "t0")
        .expect("profile is canonical")
}

fn profiled_work(store: &SqliteStore) -> PinnedRequirements {
    store
        .create_project("p1", "unix-ms:0")
        .expect("project creates");
    let profile = profile("production", 1);
    ProfileStore::new(store)
        .register(&profile)
        .expect("profile registers");
    store
        .execute_batch(
            "INSERT INTO work_item
               (work_id, project_id, kind, lifecycle, dispatch_policy,
                acceptance_profile_id, acceptance_profile_version, title,
                description, created_at, updated_at)
             VALUES ('w1', 'p1', 'task', 'open', 'automatic', 'production', 1,
                     'Production integration work', '', 'unix-ms:0', 'unix-ms:0');
             INSERT INTO gate
               (gate_id, work_id, profile_id, profile_version, kind, required,
                state, subject_ref, updated_at)
             VALUES ('verification', 'w1', 'production', 1, 'verification', 1,
                     'open', '', 'unix-ms:0');",
        )
        .expect("work and observation insert");
    let requirements = PinnedRequirements::resolve(
        &profile,
        "p1",
        "w1",
        1,
        RequirementSubjectKind::Task,
        "unix-ms:1",
    )
    .expect("requirements resolve");
    assert_eq!(
        ProfileStore::new(store)
            .persist_pinned_requirements(&requirements)
            .expect("requirements persist"),
        boreal_store::profiles::PinnedRequirementsOutcome::Inserted
    );
    requirements
}

fn bound_store() -> (SqliteStore, boreal_store::identity::IdentityContext) {
    let store = SqliteStore::open_in_memory(PRODUCTION_SCHEMA).expect("production opens");
    store
        .create_project("p1", "unix-ms:0")
        .expect("project creates");
    store
        .ensure_actor("agent-1", "agent", "credential-1", "Agent", "unix-ms:0")
        .expect("actor creates");
    let identities = IdentityStore::new(&store);
    identities
        .install(
            &DatabaseIdentity::new("database-integration", 1).expect("database identity"),
            "unix-ms:1",
        )
        .expect("database identity installs");
    let binding = WorkspaceBinding::new(
        "/tmp/boreal-production-integration",
        "/tmp/boreal-production-integration",
        "sha256:integration-binding",
    )
    .expect("workspace binding");
    let context = identities
        .bind_project("p1", &binding, "unix-ms:1")
        .expect("project binds");
    (store, context)
}

fn operation(operation_id: &str, project_id: &str) -> OperationRecord {
    OperationRecord {
        operation_id: operation_id.to_owned(),
        project_id: project_id.to_owned(),
        command: "work.block".to_owned(),
        actor_id: "agent-1".to_owned(),
        session_id: None,
        expected_revision: None,
        attempt_id: None,
        fence: None,
        request_digest: format!("sha256:{operation_id}"),
        outcome: OperationOutcome::Changed,
        result_json: r#"{"reason":"integration test"}"#.to_owned(),
        revision: 1,
        created_at: "unix-ms:2".to_owned(),
        completed_at: Some("unix-ms:2".to_owned()),
    }
}

fn audit(operation: &OperationRecord) -> AuditEventRecord {
    AuditEventRecord {
        project_id: operation.project_id.clone(),
        revision: operation.revision,
        operation_id: operation.operation_id.clone(),
        event_type: "work.blocked".to_owned(),
        subject_type: "work".to_owned(),
        subject_id: "w1".to_owned(),
        actor_id: operation.actor_id.clone(),
        session_id: operation.session_id.clone(),
        fence: operation.fence,
        as_of: operation.created_at.clone(),
        payload_json: operation.result_json.clone(),
    }
}

#[test]
fn fresh_upgrade_and_reopen_use_the_ordered_production_schema() {
    let fresh = SqliteStore::open_in_memory(PRODUCTION_SCHEMA).expect("fresh production opens");
    assert!(fresh.work_model_v3_enabled().expect("v3 contract verifies"));
    ProfileStore::new(&fresh)
        .ensure_pinned_requirements_schema()
        .expect("pinned requirement schema is registered by opener");

    let path = temp_path("upgrade");
    let legacy = SqliteStore::open(&path, SCHEMA_V2).expect("legacy schema opens");
    legacy
        .initialize_project(
            "legacy-project",
            "agent-1",
            "agent",
            "credential-1",
            "Agent",
            "legacy-init",
            "sha256:legacy-init",
            "unix-ms:0",
        )
        .expect("legacy project initializes");
    drop(legacy);

    let upgraded = SqliteStore::open(&path, PRODUCTION_SCHEMA).expect("legacy upgrades");
    assert!(upgraded.work_model_v3_enabled().expect("upgrade verifies"));
    ProfileStore::new(&upgraded)
        .ensure_pinned_requirements_schema()
        .expect("upgrade retains pinned requirement schema");
    drop(upgraded);

    // A second opener and a read-only reopen must verify the existing ledger;
    // neither path is allowed to perform ad-hoc pinned-table DDL.
    let reopened = SqliteStore::open(&path, PRODUCTION_SCHEMA).expect("reopen verifies");
    let read_only = SqliteStore::open_read_only(&path).expect("read-only reopen verifies");
    assert_eq!(reopened.schema_version().expect("schema version"), 3);
    assert_eq!(read_only.schema_version().expect("read-only version"), 3);
    drop(read_only);
    drop(reopened);
    remove_sqlite_files(&path);
}

#[test]
fn deleted_observations_do_not_delete_requirements_and_profile_drift_quarantines() {
    let store = SqliteStore::open_in_memory(PRODUCTION_SCHEMA).expect("production opens");
    let requirements = profiled_work(&store);
    store
        .execute_batch("DELETE FROM gate WHERE work_id = 'w1';")
        .expect("observation deletion succeeds");
    let read = ProfileStore::new(&store)
        .read_pinned_requirements("p1", "w1", 1)
        .expect("requirements remain readable after observation deletion")
        .expect("requirements exist");
    assert_eq!(read, requirements);

    store
        .execute_batch(
            "UPDATE acceptance_profile
             SET policy_digest = 'sha256:drifted'
             WHERE profile_id = 'production' AND version = 1;",
        )
        .expect("test drift writes");
    assert!(matches!(
        ProfileStore::new(&store).read_pinned_requirements("p1", "w1", 1),
        Err(StoreError::Corrupt(message)) if message.contains("digest")
    ));
}

#[test]
fn exact_identity_replay_is_single_effect_and_rollback_leaves_no_rows() {
    let (store, context) = bound_store();
    let original = operation("op-integrated", "p1");
    let bundle = OperationBundle::new(original.clone(), Some(audit(&original)));
    let first = store
        .append_identity_operation_audit(&context, original.clone(), audit(&original))
        .expect("operation commits");
    let replay = store
        .append_identity_operation_audit(&context, original.clone(), audit(&original))
        .expect("exact replay reads back");
    assert_eq!(first, replay);
    assert_eq!(store.operation("op-integrated").unwrap(), Some(original));
    assert!(store.audit_event("op-integrated").unwrap().is_some());

    let mut rollback = operation("op-rollback", "p1");
    rollback.revision = 2;
    let rollback_audit = audit(&rollback);
    store
        .execute_batch("BEGIN IMMEDIATE")
        .expect("rollback transaction begins");
    OperationJournal::new(&store)
        .append_in_transaction_with_identity(
            &context,
            &OperationBundle::new(rollback.clone(), Some(rollback_audit)),
        )
        .expect("rollback operation writes before rollback");
    store.execute_batch("ROLLBACK").expect("rollback succeeds");
    assert!(store.operation("op-rollback").unwrap().is_none());
    assert!(store.audit_event("op-rollback").unwrap().is_none());

    let mut foreign = bundle.operation;
    foreign.project_id = "p2".to_owned();
    assert!(matches!(
        store.append_identity_operation_audit(&context, foreign.clone(), audit(&foreign)),
        Err(StoreError::WrongSubject { .. }) | Err(StoreError::Conflict(_))
    ));
}

#[test]
fn canonical_release_requires_durable_request_and_acknowledgement() {
    let store = SqliteStore::open_in_memory(PRODUCTION_SCHEMA).expect("production opens");
    store
        .create_project("p1", "unix-ms:0")
        .expect("project creates");
    store
        .ensure_actor("agent-1", "agent", "credential-1", "Agent", "unix-ms:0")
        .expect("actor creates");
    let profile = profile("focused", 1);
    ProfileStore::new(&store)
        .register(&profile)
        .expect("profile registers");
    store
        .execute_batch(
            "INSERT INTO work_item
               (work_id, project_id, kind, lifecycle, dispatch_policy,
                acceptance_profile_id, acceptance_profile_version, title,
                description, created_at, updated_at)
             VALUES ('w1', 'p1', 'task', 'open', 'automatic', 'focused', 1,
                     'Resource work', '', 'unix-ms:0', 'unix-ms:0');
             INSERT INTO attempt
               (attempt_id, work_id, actor_id, harness_id, session_id, fence,
                current, state, claimed_at, lease_deadline, max_attempt_deadline,
                accepted_at, review_required_after_expiry, config_identity, binary_identity,
                protocol_version, schema_version)
             VALUES ('a1', 'w1', 'agent-1', 'harness', NULL, 1, 1, 'running',
                     'unix-ms:0', 'unix-ms:1', 'unix-ms:2000', 'unix-ms:4000', 1, 'config',
                     'binary', 'boreal.protocol.envelope.v1', 2);
             INSERT INTO boreal_resource_reservation
               (reservation_id, project_id, work_id, attempt_id, fence,
                resource_key, resource_kind, state, owner_actor_id, created_at)
             VALUES ('resource:a1', 'p1', 'w1', 'a1', 1, 'work:p1:w1',
                     'execution_worktree', 'active', 'agent-1', 'unix-ms:0');",
        )
        .expect("canonical resource fixture inserts");

    let pending = store
        .request_resource_release(
            "p1",
            "resource:a1",
            "release-1",
            "agent-1",
            "attempt-terminal:a1:1",
            "unix-ms:1000",
        )
        .expect("release request persists");
    assert_eq!(pending.state, "release_pending");
    assert_eq!(store.list_live_resources("p1", None, 10).unwrap().len(), 1);

    let released = store
        .acknowledge_resource_release(
            "p1",
            "resource:a1",
            "ack-1",
            "agent-1",
            "runtime-stopped:a1:1",
            "unix-ms:1100",
        )
        .expect("release acknowledgement persists");
    assert_eq!(released.state, "released");
    assert!(store
        .list_live_resources("p1", None, 10)
        .unwrap()
        .is_empty());
}
