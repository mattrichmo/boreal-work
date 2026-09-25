//! Real-SQLite coverage for PF-S02-T03 identity and revision boundaries.
//!
//! The test target is authored against the coordinator-registered
//! `boreal_store::identity` module.  The worker is not permitted to edit the
//! protected store root, so the registration remains an explicit integration
//! request in the task handoff.

use boreal_store::identity::{
    AttemptFence, DatabaseIdentity, EntityRevision, IdentityError, IdentityStore, ProofRevision,
    RestoreEpoch, WorkspaceBinding,
};
use boreal_store::SqliteStore;

const SCHEMA: &str = include_str!("../../../project/spec/schema-v2.sql");

fn store() -> SqliteStore {
    // Keep the schema semantically identical while avoiding the exact canonical
    // schema-v2 text that triggers the store's automatic production migration.
    // This fixture exercises IdentityStore::install's raw legacy-v2 migration.
    let legacy_schema = format!("{SCHEMA}\n-- identity migration fixture\n");
    SqliteStore::open_in_memory(&legacy_schema).expect("schema opens")
}

fn binding(project: &str) -> WorkspaceBinding {
    WorkspaceBinding::new(
        format!("/tmp/boreal/{project}"),
        format!("/tmp/boreal/{project}/worktree"),
        format!("sha256:binding-{project}"),
    )
    .expect("canonical binding")
}

fn write_transaction<T>(
    store: &SqliteStore,
    body: impl FnOnce() -> Result<T, IdentityError>,
) -> Result<T, IdentityError> {
    store
        .execute_batch("BEGIN IMMEDIATE")
        .expect("test write transaction begins");
    match body() {
        Ok(value) => {
            store
                .execute_batch("COMMIT")
                .expect("test write transaction commits");
            Ok(value)
        }
        Err(error) => {
            store
                .execute_batch("ROLLBACK")
                .expect("test write transaction rolls back");
            Err(error)
        }
    }
}

fn initialized_store() -> (&'static SqliteStore, IdentityStore<'static>) {
    // The store is leaked only for the test helper's shared adapter lifetime;
    // each test owns its disposable in-memory database for the process.
    let store = Box::leak(Box::new(store()));
    store
        .initialize_project(
            "p1",
            "agent-1",
            "agent",
            "cred-agent-1",
            "Agent 1",
            "op-init-p1",
            "sha256:init-p1",
            "unix-ms:0",
        )
        .expect("p1 initializes");
    store
        .initialize_project(
            "p2",
            "agent-2",
            "agent",
            "cred-agent-2",
            "Agent 2",
            "op-init-p2",
            "sha256:init-p2",
            "unix-ms:0",
        )
        .expect("p2 initializes");
    store
        .execute_batch(
            "
            INSERT INTO work_item
              (work_id, project_id, kind, lifecycle, dispatch_policy,
               acceptance_profile_id, acceptance_profile_version, title,
               description, created_at, updated_at)
            VALUES
              ('w1', 'p1', 'task', 'open', 'automatic', 'focused', 1,
               'Project one task', '', 'unix-ms:0', 'unix-ms:0'),
              ('w2', 'p2', 'task', 'open', 'automatic', 'focused', 1,
               'Project two task', '', 'unix-ms:0', 'unix-ms:0');

            INSERT INTO attempt
              (attempt_id, work_id, actor_id, harness_id, session_id, fence,
               current, state, claimed_at, accepted_at, lease_deadline,
               max_attempt_deadline, review_required_after_expiry,
               config_identity, binary_identity, protocol_version, schema_version)
            VALUES
              ('a1', 'w1', 'agent-1', 'harness-1', NULL, 1, 1, 'running',
               'unix-ms:0', 'unix-ms:0', 'unix-ms:2000', 'unix-ms:4000', 1,
               'config-1', 'binary-1', 'boreal.protocol/2', 2),
              ('a2', 'w2', 'agent-2', 'harness-2', NULL, 1, 1, 'running',
               'unix-ms:0', 'unix-ms:0', 'unix-ms:2000', 'unix-ms:4000', 1,
               'config-2', 'binary-2', 'boreal.protocol/2', 2);

            INSERT INTO operation
              (operation_id, project_id, command, actor_id, session_id,
               expected_revision, attempt_id, fence, request_digest, outcome,
               result_json, revision, created_at, completed_at)
            VALUES ('op-pending', 'p1', 'external.pending', 'agent-1', NULL,
                    NULL, NULL, NULL, 'sha256:pending', 'unknown', '{}', 1,
                    'unix-ms:0', NULL);
            ",
        )
        .expect("fixture rows insert");
    let identities = IdentityStore::new(store);
    let report = write_transaction(store, || {
        identities.install(
            &DatabaseIdentity::new("db-1", 1).expect("database identity"),
            "unix-ms:1",
        )
    })
    .expect("identity migration installs");
    assert_eq!(report.entity_rows_migrated, 2);
    assert_eq!(report.fence_rows_migrated, 2);
    assert_eq!(report.operation_rows_migrated, 3);
    assert_eq!(report.ambiguous_operations_invalidated, 1);
    write_transaction(store, || {
        identities.bind_project("p1", &binding("p1"), "unix-ms:2")
    })
    .expect("p1 binds");
    write_transaction(store, || {
        identities.bind_project("p2", &binding("p2"), "unix-ms:2")
    })
    .expect("p2 binds");
    (store, identities)
}

#[test]
fn migration_persists_binding_and_splits_conflated_revision() {
    let (store, identities) = initialized_store();
    let database = identities.database_identity().expect("database identity");
    assert_eq!(database.database_instance_id.as_str(), "db-1");
    assert_eq!(database.restore_epoch, RestoreEpoch::new(1).unwrap());

    let context = identities.context("p1").expect("project context");
    let workspace = identities
        .workspace_binding("p1")
        .expect("workspace binding");
    assert_eq!(workspace.canonical_root(), "/tmp/boreal/p1");
    assert_eq!(workspace.canonical_worktree(), "/tmp/boreal/p1/worktree");
    assert_eq!(workspace.binding_digest(), "sha256:binding-p1");
    let revisions = identities.revisions(&context, "w1").expect("revisions");
    assert_eq!(revisions.project_snapshot.0, 1);
    assert_eq!(revisions.entity, EntityRevision::new(1));
    assert_eq!(revisions.proof, ProofRevision::new(1));
    assert_eq!(identities.context("p2").unwrap().project_id, "p2");

    // The migration is explicitly additive and retains the operation row;
    // only its ambiguous context is fenced until a coordinator re-registers it.
    assert!(matches!(
        identities.operation(&context, "op-pending"),
        Err(IdentityError::OperationInvalidated { .. })
    ));
    assert!(store.operation("op-pending").unwrap().is_some());
}

#[test]
fn heartbeat_does_not_invalidate_unrelated_entity_or_proof() {
    let (store, identities) = initialized_store();
    let context = identities.context("p1").expect("project context");
    let unrelated_context = identities.context("p2").expect("unrelated context");
    let before = identities
        .revisions(&context, "w1")
        .expect("before revisions");
    let unrelated_before = identities
        .revisions(&unrelated_context, "w2")
        .expect("unrelated before revisions");

    write_transaction(store, || {
        identities.heartbeat(
            &context,
            "w1",
            "a1",
            AttemptFence::new(1).unwrap(),
            "unix-ms:1000",
        )
    })
    .expect("heartbeat commits");

    let after = identities
        .revisions(&context, "w1")
        .expect("after revisions");
    let unrelated_after = identities
        .revisions(&unrelated_context, "w2")
        .expect("unrelated after revisions");
    assert_eq!(after, before, "liveness is not a semantic revision");
    assert_eq!(unrelated_after, unrelated_before);
    assert_eq!(
        store.project_revision("p1").unwrap().0,
        before.project_snapshot.0
    );
    assert_eq!(
        store
            .current_attempt("p1", "a1")
            .unwrap()
            .last_heartbeat_at
            .as_deref(),
        Some("unix-ms:1000")
    );
}

#[test]
fn wrong_project_and_wrong_epoch_are_typed_without_foreign_leakage() {
    let (_store, identities) = initialized_store();
    let foreign_context = identities.context("p2").expect("p2 context");
    let foreign = write_transaction(_store, || {
        identities.heartbeat(
            &foreign_context,
            "w1",
            "a1",
            AttemptFence::new(1).unwrap(),
            "unix-ms:1000",
        )
    })
    .expect_err("foreign work must be isolated");
    assert!(matches!(
        foreign,
        IdentityError::ForeignSubject {
            project_id,
            subject: "work",
            id
        } if project_id == "p2" && id == "w1"
    ));

    let mut stale_epoch = identities.context("p1").expect("p1 context");
    stale_epoch.restore_epoch = RestoreEpoch::new(2).unwrap();
    let error = write_transaction(_store, || {
        identities.heartbeat(
            &stale_epoch,
            "w1",
            "a1",
            AttemptFence::new(1).unwrap(),
            "unix-ms:1000",
        )
    })
    .expect_err("wrong epoch must reject");
    assert!(matches!(
        error,
        IdentityError::RestoreEpochConflict {
            expected,
            actual
        } if expected == RestoreEpoch::new(2).unwrap() && actual == RestoreEpoch::new(1).unwrap()
    ));
}

#[test]
fn stale_entity_proof_and_fence_values_are_independent() {
    let (_store, identities) = initialized_store();
    let context = identities.context("p1").expect("project context");
    let initial = identities
        .revisions(&context, "w1")
        .expect("initial revisions");

    let advanced = write_transaction(_store, || {
        identities.advance_entity(&context, "w1", initial.entity, true, "unix-ms:10")
    })
    .expect("entity mutation");
    assert_eq!(advanced.entity, EntityRevision::new(2));
    assert_eq!(advanced.proof, ProofRevision::new(2));

    let entity_error = write_transaction(_store, || {
        identities.advance_entity(&context, "w1", initial.entity, false, "unix-ms:11")
    })
    .expect_err("stale entity must reject");
    assert!(matches!(
        entity_error,
        IdentityError::StaleEntity { expected, actual }
            if expected == initial.entity && actual == EntityRevision::new(2)
    ));

    let proof_error = write_transaction(_store, || {
        identities.advance_proof(&context, "w1", initial.proof, "unix-ms:12")
    })
    .expect_err("stale proof must reject");
    assert!(matches!(
        proof_error,
        IdentityError::StaleProof { expected, actual }
            if expected == initial.proof && actual == ProofRevision::new(2)
    ));

    let fence_error = write_transaction(_store, || {
        identities.heartbeat(
            &context,
            "w1",
            "a1",
            AttemptFence::new(2).unwrap(),
            "unix-ms:13",
        )
    })
    .expect_err("stale fence must reject independently");
    assert!(matches!(
        fence_error,
        IdentityError::StaleFence { expected, actual }
            if expected == AttemptFence::new(2).unwrap() && actual == AttemptFence::new(1).unwrap()
    ));
}

#[test]
fn restore_invalidates_operations_and_execution_authority() {
    let (_store, identities) = initialized_store();
    let old_context = identities.context("p1").expect("old context");
    let restored = write_transaction(_store, || identities.restore("db-2", 2, "unix-ms:20"))
        .expect("restore identity advances");
    assert_eq!(
        restored.previous.restore_epoch,
        RestoreEpoch::new(1).unwrap()
    );
    assert_eq!(
        restored.current.restore_epoch,
        RestoreEpoch::new(2).unwrap()
    );
    assert_eq!(restored.revoked_fences, 2);
    assert!(restored.invalidated_operations >= 2);

    let old_epoch = write_transaction(_store, || {
        identities.heartbeat(
            &old_context,
            "w1",
            "a1",
            AttemptFence::new(1).unwrap(),
            "unix-ms:21",
        )
    })
    .expect_err("old epoch cannot write after restore");
    assert!(matches!(
        old_epoch,
        IdentityError::DatabaseInstanceConflict { .. } | IdentityError::RestoreEpochConflict { .. }
    ));

    let current = identities.context("p1").expect("current context");
    let revoked = write_transaction(_store, || {
        identities.heartbeat(
            &current,
            "w1",
            "a1",
            AttemptFence::new(1).unwrap(),
            "unix-ms:22",
        )
    })
    .expect_err("restored database cannot revive old fence");
    assert!(matches!(
        revoked,
        IdentityError::FenceRevoked {
            fence,
            epoch
        } if fence == AttemptFence::new(1).unwrap() && epoch == RestoreEpoch::new(2).unwrap()
    ));
    assert!(matches!(
        identities.operation(&current, "op-init-p1"),
        Err(IdentityError::OperationInvalidated { .. })
    ));
    assert!(matches!(
        write_transaction(_store, || {
            identities.record_operation_context(&current, "op-init-p1")
        }),
        Err(IdentityError::OperationInvalidated { .. })
    ));
}

#[test]
fn foreign_composite_pairing_and_checked_conversions_fail_closed() {
    let (store, identities) = initialized_store();
    let p2 = identities.context("p2").expect("p2 context");
    let error = write_transaction(store, || {
        identities.record_attempt_fence(
            &p2,
            "w1",
            "a1",
            AttemptFence::new(1).unwrap(),
            "unix-ms:30",
        )
    })
    .expect_err("foreign project/work/attempt pairing must reject");
    assert!(matches!(
        error,
        IdentityError::ForeignSubject {
            project_id,
            subject: "work",
            id
        } if project_id == "p2" && id == "w1"
    ));

    assert!(matches!(
        EntityRevision::try_from(-1),
        Err(IdentityError::Invalid { field, .. }) if field == "entity_revision"
    ));
    assert!(matches!(
        AttemptFence::try_from(0),
        Err(IdentityError::Invalid { field, .. }) if field == "attempt_fence"
    ));
    assert!(matches!(
        i64::try_from(EntityRevision::new(u64::MAX)),
        Err(IdentityError::Invalid { field, .. }) if field == "entity_revision"
    ));

    let foreign_composite = store
        .execute_batch(
            "INSERT INTO boreal_attempt_fence_identity
               (project_id, work_id, attempt_id, fence,
                database_instance_id, restore_epoch, revoked, recorded_at)
             VALUES ('p2', 'w1', 'a1', 1, 'db-1', 1, 0, 'unix-ms:31')",
        )
        .expect_err("composite project/work FK must reject foreign pairing");
    assert!(matches!(
        foreign_composite,
        boreal_store::StoreError::Constraint { .. }
    ));
}
