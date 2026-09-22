//! Executable coverage for the additive `boreal.work-model/3` schema artifact.
//!
//! These tests exercise schema-v3.sql through both the store migration
//! boundary and direct SQL constraint fixtures.  The v2 tables remain
//! compatible while the store validates the complete v3 extension.

use boreal_store::{
    AuditEventRecord, ContainerDispositionV3Input, CycleAssignmentV3Input, CycleSeriesV3Input,
    CycleTemplateV3Input, CycleV3Input, IntakeBucketV3Input, IntakeItemV3Input,
    IntakePromotionV3Input, OperationOutcome, OperationRecord, SessionRegistrationRequest,
    SqliteStore, StoreError, V3MutationContext, WorkNodeV3Input,
};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const SCHEMA_V2: &str = include_str!("../../../project/spec/schema-v2.sql");
const SCHEMA_V3: &str = include_str!("../../../project/spec/schema-v3.sql");

fn temp_path(label: &str) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock before unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!(
        "boreal-schema-v3-{label}-{}-{stamp}.sqlite",
        std::process::id()
    ))
}

fn remove_sqlite_files(path: &Path) {
    let _ = std::fs::remove_file(path);
    let _ = std::fs::remove_file(path.with_extension("sqlite-wal"));
    let _ = std::fs::remove_file(path.with_extension("sqlite-shm"));
}

fn open_v2_fixture(path: impl AsRef<Path>) -> SqliteStore {
    let store = SqliteStore::open_for_migration(path).expect("migration fixture opens");
    store
        .execute_batch(SCHEMA_V2)
        .expect("raw schema-v2 fixture applies");
    assert_eq!(store.schema_version().unwrap(), 2);
    store
}

fn historical_schema_v2() -> String {
    let historical = SCHEMA_V2.replace(
        "'attempt.expired','evidence.verifier.admitted','expiry.resolved'",
        "'attempt.expired','expiry.resolved'",
    );
    assert_ne!(
        historical, SCHEMA_V2,
        "fixture must represent the prior v2 schema"
    );
    historical
}

fn seed_audit_subject(store: &SqliteStore) {
    store
        .execute_batch(
            "INSERT INTO project VALUES ('migration-project', 2, 'boreal.work-status/2', 0, 't0', 't0');
             INSERT INTO actor VALUES ('migration-actor', 'agent', 'credential', 'Migration actor', 't0');",
        )
        .expect("migration audit subject seeds");
}

fn append_verifier_audit(store: &SqliteStore, operation_id: &str) -> Result<(), StoreError> {
    let operation = OperationRecord {
        operation_id: operation_id.to_owned(),
        project_id: "migration-project".to_owned(),
        command: "evidence.verifier".to_owned(),
        actor_id: "migration-actor".to_owned(),
        session_id: None,
        expected_revision: None,
        attempt_id: None,
        fence: None,
        request_digest: format!("sha256:{operation_id}"),
        outcome: OperationOutcome::Changed,
        result_json: "{}".to_owned(),
        revision: 1,
        created_at: "t1".to_owned(),
        completed_at: Some("t1".to_owned()),
    };
    store.append_operation(&operation)?;
    store.append_audit_event(&AuditEventRecord {
        project_id: operation.project_id,
        revision: operation.revision,
        operation_id: operation.operation_id,
        event_type: "evidence.verifier.admitted".to_owned(),
        subject_type: "project".to_owned(),
        subject_id: "migration-project".to_owned(),
        actor_id: operation.actor_id,
        session_id: operation.session_id,
        fence: operation.fence,
        as_of: "t1".to_owned(),
        payload_json: "{}".to_owned(),
    })
}

#[test]
fn historical_v2_audit_check_is_repaired_before_production_migration() {
    let path = temp_path("historical-audit");
    remove_sqlite_files(&path);
    let store = SqliteStore::open_for_migration(&path).expect("migration fixture opens");
    store
        .execute_batch(&historical_schema_v2())
        .expect("historical schema-v2 fixture applies");
    seed_audit_subject(&store);
    assert_eq!(store.schema_version().unwrap(), 2);

    store
        .migrate_production()
        .expect("historical v2 migrates with the repaired audit contract");
    assert_eq!(store.schema_version().unwrap(), 3);
    append_verifier_audit(&store, "migration-verifier-event")
        .expect("repaired audit check accepts verifier admission");
    assert_eq!(
        store
            .audit_event("migration-verifier-event")
            .unwrap()
            .unwrap()
            .event_type,
        "evidence.verifier.admitted"
    );
    drop(store);
    remove_sqlite_files(&path);
}

#[test]
fn historical_v2_audit_repair_rolls_back_with_a_failed_migration() {
    let store = SqliteStore::open_for_migration(":memory:").expect("migration fixture opens");
    store
        .execute_batch(&historical_schema_v2())
        .expect("historical schema-v2 fixture applies");
    seed_audit_subject(&store);
    let broken = SCHEMA_V3.replace(
        "CREATE TABLE cycle_v3",
        "THIS IS INVALID SQL;\nCREATE TABLE cycle_v3",
    );

    assert!(store.apply_work_model_v3(&broken).is_err());
    assert_eq!(store.schema_version().unwrap(), 2);
    let error = append_verifier_audit(&store, "rolled-back-verifier-event")
        .expect_err("rolled-back repair must not make the old check appear upgraded");
    assert!(matches!(error, StoreError::Constraint { .. }), "{error:?}");
}

fn store_v3() -> SqliteStore {
    let store = open_v2_fixture(":memory:");
    store
        .execute_batch(SCHEMA_V3)
        .expect("schema-v3 additive migration applies");
    assert_eq!(store.schema_version().unwrap(), 3);
    store
}

#[test]
fn runtime_applies_and_reopens_v3_while_accepting_schema2_openers() {
    let path = temp_path("reopen");
    remove_sqlite_files(&path);
    {
        let store = open_v2_fixture(&path);
        assert_eq!(store.schema_version().unwrap(), 2);
        store
            .apply_schema(SCHEMA_V3)
            .expect("runtime applies the additive v3 migration");
        assert_eq!(store.schema_version().unwrap(), 3);
        assert!(store.work_model_v3_enabled().unwrap());
    }
    {
        // A schema-2 client can still reopen/read the database.  It sees the
        // installed extension but does not need to understand its tables.
        let reopened = SqliteStore::open(&path, SCHEMA_V2).expect("schema-v2 opener reopens v3");
        assert_eq!(reopened.schema_version().unwrap(), 3);
        assert!(reopened.work_model_v3_enabled().unwrap());
    }
    remove_sqlite_files(&path);
}

#[test]
fn failed_v3_migration_rolls_back_without_a_partial_v3_schema() {
    let path = temp_path("rollback");
    remove_sqlite_files(&path);
    let store = open_v2_fixture(&path);
    let broken = SCHEMA_V3.replace(
        "CREATE TABLE cycle_v3",
        "THIS IS INVALID SQL;\nCREATE TABLE cycle_v3",
    );
    assert!(store.apply_schema(&broken).is_err());
    assert_eq!(store.schema_version().unwrap(), 2);
    assert!(!store.work_model_v3_enabled().unwrap());
    assert!(store
        .execute_batch("SELECT 1 FROM work_model_v3_meta")
        .is_err());
    drop(store);
    remove_sqlite_files(&path);
}

#[test]
fn store_v3_mutations_use_revisions_audit_and_typed_replay() {
    let store = store_v3();
    seed_base(&store);
    seed_nodes(&store);
    let context = |operation_id: &str, request_digest: &str| V3MutationContext {
        project_id: "p1".to_owned(),
        actor_id: "agent-1".to_owned(),
        operation_id: operation_id.to_owned(),
        request_digest: request_digest.to_owned(),
        expected_revision: None,
        now: "t1".to_owned(),
    };

    let node = WorkNodeV3Input {
        project_id: "p1".to_owned(),
        work_id: "direct-a".to_owned(),
        decomposition_kind: "task".to_owned(),
        execution_mode: "direct".to_owned(),
        parent_id: Some("container-1".to_owned()),
        created_at: "t1".to_owned(),
        updated_at: "t1".to_owned(),
    };
    let first = store
        .create_work_node_v3(&context("op-node", "sha256:node"), &node)
        .expect_err("duplicate node should fail after the transaction boundary");
    assert!(matches!(first, StoreError::Constraint { .. }));

    let series = CycleSeriesV3Input {
        project_id: "p1".to_owned(),
        series_id: "series-api".to_owned(),
        name: "API cycle".to_owned(),
        lifecycle: "active".to_owned(),
        timezone: "America/Regina".to_owned(),
        tzdb_identity: "tzdb-test".to_owned(),
        created_at: "t1".to_owned(),
        updated_at: "t1".to_owned(),
    };
    let created = store
        .create_cycle_series_v3(&context("op-series", "sha256:series"), &series)
        .expect("series mutation is accepted");
    assert!(!created.replayed);
    assert_eq!(created.revision, 1);
    assert_eq!(
        store
            .cycle_series_v3("p1", "series-api")
            .unwrap()
            .unwrap()
            .name,
        "API cycle"
    );

    let replay = store
        .create_cycle_series_v3(&context("op-series", "sha256:series"), &series)
        .expect("same operation replays");
    assert!(replay.replayed);
    assert_eq!(replay.revision, created.revision);
    let changed = store.create_cycle_series_v3(&context("op-series", "sha256:changed"), &series);
    assert!(matches!(
        changed,
        Err(StoreError::Conflict(message)) if message == "operation request digest mismatch"
    ));

    let template = CycleTemplateV3Input {
        project_id: "p1".to_owned(),
        template_version_id: "template-api".to_owned(),
        series_id: "series-api".to_owned(),
        version: 1,
        effective_from_slot_ordinal: 0,
        interval_weeks: 1,
        anchor_local_date: "2026-09-21".to_owned(),
        anchor_local_time: "09:00:00".to_owned(),
        anchor_weekday: 1,
        recurrence_end_kind: "never".to_owned(),
        recurrence_end_count: None,
        recurrence_end_local_date: None,
        name_pattern: "Cycle {slot}".to_owned(),
        goal_template: "Ship".to_owned(),
        timezone: "America/Regina".to_owned(),
        tzdb_identity: "tzdb-test".to_owned(),
        gap_policy: "next_valid".to_owned(),
        fold_policy: "earlier_offset".to_owned(),
        weekdays: vec![1],
        created_at: "t1".to_owned(),
    };
    store
        .create_cycle_template_v3(&context("op-template", "sha256:template"), &template)
        .expect("template mutation is accepted");
    let cycle = CycleV3Input {
        project_id: "p1".to_owned(),
        cycle_id: "cycle-api".to_owned(),
        series_id: "series-api".to_owned(),
        template_version_id: "template-api".to_owned(),
        slot_ordinal: 0,
        name: "Cycle 0".to_owned(),
        goal: "Ship".to_owned(),
        lifecycle: "planned".to_owned(),
        scheduled_start_utc_ms: 1_790_000_000_000,
        scheduled_end_utc_ms: Some(1_790_003_600_000),
        scheduled_start_local: "2026-09-21T09:00:00".to_owned(),
        scheduled_start_utc_offset_minutes: -360,
        timezone: "America/Regina".to_owned(),
        tzdb_identity: "tzdb-test".to_owned(),
        gap_policy: "next_valid".to_owned(),
        fold_policy: "earlier_offset".to_owned(),
        created_at: "t1".to_owned(),
        updated_at: "t1".to_owned(),
    };
    store
        .create_cycle_v3(&context("op-cycle", "sha256:cycle"), &cycle)
        .expect("cycle mutation is accepted");
    store
        .assign_cycle_work_v3(
            &context("op-assignment", "sha256:assignment"),
            &CycleAssignmentV3Input {
                project_id: "p1".to_owned(),
                assignment_id: "assignment-api".to_owned(),
                cycle_id: "cycle-api".to_owned(),
                work_id: "direct-a".to_owned(),
                state: "planned".to_owned(),
                activation_policy: "at_cycle_start".to_owned(),
                activation_at_utc_ms: None,
                predecessor_id: None,
                successor_id: None,
                created_at: "t1".to_owned(),
                updated_at: "t1".to_owned(),
            },
        )
        .expect("assignment mutation is accepted");
    assert_eq!(
        store.cycle_assignments_v3("p1", "cycle-api").unwrap().len(),
        1
    );

    store
        .create_intake_bucket_v3(
            &context("op-bucket", "sha256:bucket"),
            &IntakeBucketV3Input {
                project_id: "p1".to_owned(),
                bucket_id: "bucket-api".to_owned(),
                name: "Inbox".to_owned(),
                archived: false,
                created_at: "t1".to_owned(),
                updated_at: "t1".to_owned(),
            },
        )
        .expect("bucket mutation is accepted");
    store
        .create_intake_item_v3(
            &context("op-intake", "sha256:intake"),
            &IntakeItemV3Input {
                project_id: "p1".to_owned(),
                intake_id: "intake-api".to_owned(),
                bucket_id: "bucket-api".to_owned(),
                kind: "discovery".to_owned(),
                lifecycle: "captured".to_owned(),
                content: "A useful discovery".to_owned(),
                content_revision: 1,
                content_digest: "sha256:intake".to_owned(),
                captured_at: "t1".to_owned(),
                updated_at: "t1".to_owned(),
                revisit_at_utc_ms: None,
            },
        )
        .expect("intake mutation is accepted");
    assert_eq!(
        store
            .intake_item_v3("p1", "intake-api")
            .unwrap()
            .unwrap()
            .content_revision,
        1
    );
    store
        .promote_intake_v3(
            &context("op-promotion", "sha256:promotion"),
            &IntakePromotionV3Input {
                project_id: "p1".to_owned(),
                promotion_id: "promotion-api".to_owned(),
                intake_id: "intake-api".to_owned(),
                intake_revision: 1,
                intake_digest: "sha256:intake".to_owned(),
                target_kind: "draft_work".to_owned(),
                target_id: "draft-api".to_owned(),
                actor_id: "agent-1".to_owned(),
                operation_id: "promotion-child-op".to_owned(),
                created_at: "t1".to_owned(),
            },
        )
        .expect("promotion mutation is accepted");

    let disposition = ContainerDispositionV3Input {
        project_id: "p1".to_owned(),
        disposition_id: "disposition-api".to_owned(),
        container_work_id: "container-1".to_owned(),
        descendant_work_id: "direct-a".to_owned(),
        kind: "accepted_closed".to_owned(),
        descendant_revision: 1,
        descendant_outcome_digest: "sha256:outcome".to_owned(),
        replacement_work_id: None,
        reason: None,
        supersedes_id: None,
        created_at: "t1".to_owned(),
    };
    store
        .append_container_disposition_v3(
            &context("op-disposition", "sha256:disposition"),
            &disposition,
        )
        .expect("disposition mutation is accepted");
}

#[test]
fn v3_replay_requires_actor_session_subject_and_revision_identity() {
    let store = store_v3();
    seed_base(&store);
    store
        .ensure_actor("agent-2", "agent", "credential-agent-2", "Agent 2", "t0")
        .expect("second actor fixture inserts");
    store
        .register_session(SessionRegistrationRequest {
            project_id: "p1".to_owned(),
            session_id: "session-1".to_owned(),
            actor_id: "agent-1".to_owned(),
            harness_id: "test".to_owned(),
            operation_id: "session-register-1".to_owned(),
            request_digest: "sha256:session-register-1".to_owned(),
            expected_project_revision: None,
            started_at: "t1".to_owned(),
        })
        .expect("authenticated session registers");

    let context = |actor_id: &str, expected_revision: Option<u64>| V3MutationContext {
        project_id: "p1".to_owned(),
        actor_id: actor_id.to_owned(),
        operation_id: "op-identity".to_owned(),
        request_digest: "sha256:identity".to_owned(),
        expected_revision,
        now: "t2".to_owned(),
    };
    let series = CycleSeriesV3Input {
        project_id: "p1".to_owned(),
        series_id: "series-identity".to_owned(),
        name: "Identity cycle".to_owned(),
        lifecycle: "active".to_owned(),
        timezone: "America/Regina".to_owned(),
        tzdb_identity: "tzdb-test".to_owned(),
        created_at: "t2".to_owned(),
        updated_at: "t2".to_owned(),
    };

    let first = store
        .create_cycle_series_v3(&context("agent-1", Some(1)), &series)
        .expect("initial v3 mutation commits");
    assert!(!first.replayed);
    let replay = store
        .create_cycle_series_v3(&context("agent-1", Some(1)), &series)
        .expect("exact v3 identity replays");
    assert!(replay.replayed);
    assert_eq!(replay.revision, first.revision);
    let operation = store.operation("op-identity").unwrap().unwrap();
    assert_eq!(operation.actor_id, "agent-1");
    assert_eq!(operation.session_id.as_deref(), Some("session-1"));
    assert_eq!(operation.expected_revision, Some(1));
    assert_eq!(
        store
            .audit_event("op-identity")
            .unwrap()
            .unwrap()
            .session_id
            .as_deref(),
        Some("session-1")
    );
    assert_eq!(store.project_revision("p1").unwrap().0, first.revision);

    let actor_drift = store.create_cycle_series_v3(&context("agent-2", Some(1)), &series);
    assert!(matches!(actor_drift, Err(StoreError::WrongOwner { .. })));

    let revision_drift = store.create_cycle_series_v3(&context("agent-1", Some(0)), &series);
    assert!(matches!(revision_drift, Err(StoreError::Conflict(_))));

    let mut target_drift = series.clone();
    target_drift.series_id = "series-other".to_owned();
    let target_drift = store.create_cycle_series_v3(&context("agent-1", Some(1)), &target_drift);
    assert!(matches!(target_drift, Err(StoreError::WrongSubject { .. })));

    store
        .end_session(
            "p1",
            "session-1",
            "agent-1",
            "session-end-1",
            "sha256:session-end-1",
            None,
            "t3",
        )
        .expect("original session ends");
    store
        .register_session(SessionRegistrationRequest {
            project_id: "p1".to_owned(),
            session_id: "session-2".to_owned(),
            actor_id: "agent-1".to_owned(),
            harness_id: "test".to_owned(),
            operation_id: "session-register-2".to_owned(),
            request_digest: "sha256:session-register-2".to_owned(),
            expected_project_revision: None,
            started_at: "t4".to_owned(),
        })
        .expect("replacement session registers");
    let session_drift = store.create_cycle_series_v3(&context("agent-1", Some(1)), &series);
    assert!(matches!(session_drift, Err(StoreError::Conflict(_))));
}

#[test]
fn populated_v3_extension_refuses_destructive_rollback_but_empty_one_downgrades() {
    let store = store_v3();
    seed_base(&store);
    seed_nodes(&store);
    let error = store.rollback_work_model_v3().unwrap_err();
    assert!(matches!(error, StoreError::Conflict(_)));

    let empty = store_v3();
    empty
        .rollback_work_model_v3()
        .expect("empty extension can safely downgrade");
    assert_eq!(empty.schema_version().unwrap(), 2);
    assert!(!empty.work_model_v3_enabled().unwrap());
}

#[test]
fn online_backup_preserves_the_v3_extension_and_schema2_rows() {
    let source_path = temp_path("v3-backup-source");
    let backup_path = temp_path("v3-backup-copy");
    remove_sqlite_files(&source_path);
    remove_sqlite_files(&backup_path);
    {
        let source = open_v2_fixture(&source_path);
        source
            .apply_schema(SCHEMA_V3)
            .expect("v2 base plus v3 extension opens");
        seed_base(&source);
        seed_nodes(&source);
        source.backup_to(&backup_path).expect("v3 backup succeeds");
    }
    let backup = SqliteStore::open(&backup_path, SCHEMA_V2).expect("v2-compatible reopen");
    assert_eq!(backup.schema_version().unwrap(), 3);
    assert!(backup.work_model_v3_enabled().unwrap());
    assert!(backup.work("p1", "direct-a").unwrap().is_some());
    assert!(backup.work_node_v3("p1", "direct-a").unwrap().is_some());
    drop(backup);
    remove_sqlite_files(&source_path);
    remove_sqlite_files(&backup_path);
}

fn seed_base(store: &SqliteStore) {
    store
        .execute_batch(
            "
            INSERT INTO project VALUES ('p1', 2, 'boreal.work-status/2', 0, 't0', 't0');
            INSERT INTO actor VALUES ('agent-1', 'agent', 'cred-agent', 'Agent', 't0');
            INSERT INTO acceptance_profile VALUES ('default', 1, 'sha256:policy', '{}', 't0');
            INSERT INTO work_item (
                work_id, project_id, kind, parent_id, lifecycle, dispatch_policy,
                acceptance_profile_id, acceptance_profile_version, title,
                description, created_at, updated_at
            ) VALUES
              ('milestone-1', 'p1', 'milestone', NULL, 'open', 'automatic',
               'default', 1, 'Milestone', '', 't0', 't0'),
              ('container-1', 'p1', 'task', NULL, 'open', 'automatic',
               'default', 1, 'Container 1', '', 't0', 't0'),
              ('container-2', 'p1', 'task', NULL, 'open', 'automatic',
               'default', 1, 'Container 2', '', 't0', 't0'),
              ('direct-a', 'p1', 'task', NULL, 'open', 'automatic',
               'default', 1, 'Direct A', '', 't0', 't0'),
              ('direct-b', 'p1', 'task', NULL, 'open', 'automatic',
               'default', 1, 'Direct B', '', 't0', 't0'),
              ('legacy-sprint', 'p1', 'sprint', NULL, 'open', 'automatic',
               'default', 1, 'Legacy Sprint', '', 't0', 't0');
            ",
        )
        .expect("schema-v2 fixture data inserts");
}

fn seed_nodes(store: &SqliteStore) {
    store
        .execute_batch(
            "
            INSERT INTO work_node_v3
                (work_id, project_id, decomposition_kind, execution_mode,
                 parent_id, created_at, updated_at)
            VALUES
              ('milestone-1', 'p1', 'milestone', 'container', NULL, 't0', 't0'),
              ('container-1', 'p1', 'task', 'container', 'milestone-1', 't0', 't0'),
              ('container-2', 'p1', 'task', 'container', 'container-1', 't0', 't0'),
              ('direct-a', 'p1', 'task', 'direct', 'container-1', 't0', 't0'),
              ('direct-b', 'p1', 'task', 'direct', 'container-2', 't0', 't0');
            ",
        )
        .expect("v3 nodes insert");
}

fn reject(store: &SqliteStore, sql: &str, expected_message: &str) {
    let error = store
        .execute_batch(sql)
        .expect_err("statement should violate a v3 invariant");
    let rendered = error.to_string();
    assert!(
        rendered.contains(expected_message),
        "expected {expected_message:?} in {rendered:?} ({error:?})"
    );
}

#[test]
fn schema_v3_is_a_versioned_additive_extension_of_schema_v2() {
    let store = store_v3();
    seed_base(&store);

    // The original v2 tables and their semantics remain available.  In
    // particular, v2 dependency rows are not silently reinterpreted as the
    // stricter v3 direct-task graph.
    store
        .execute_batch(
            "INSERT INTO dependency (
                 project_id, prerequisite_id, dependent_id, created_at
             ) VALUES ('p1', 'milestone-1', 'direct-a', 't0');",
        )
        .expect("schema-v2 dependency semantics remain intact");

    store
        .execute_batch(
            "INSERT INTO work_model_v3_meta
                 (schema_id, schema_version, base_schema_version,
                  contract_version, created_at)
             VALUES ('another', 3, 2, 'boreal.work-model/3', 't0');",
        )
        .expect_err("the v3 metadata identity is singleton and fixed");
    assert_eq!(store.schema_version().unwrap(), 3);
    assert!(store.work("p1", "milestone-1").unwrap().is_some());
}

#[test]
fn hierarchy_separates_cycles_and_rejects_sprint_or_direct_task_children() {
    let store = store_v3();
    seed_base(&store);
    seed_nodes(&store);

    reject(
        &store,
        "INSERT INTO work_node_v3
             (work_id, project_id, decomposition_kind, execution_mode,
              parent_id, created_at, updated_at)
         VALUES ('legacy-sprint', 'p1', 'task', 'direct', NULL, 't0', 't0');",
        "work_node_v3_kind_mismatch",
    );

    reject(
        &store,
        "INSERT INTO work_node_v3
             (work_id, project_id, decomposition_kind, execution_mode,
              parent_id, created_at, updated_at)
         VALUES ('direct-child', 'p1', 'task', 'direct', 'direct-a', 't0', 't0');",
        "work_node_v3_invalid_parent",
    );
    reject(
        &store,
        "UPDATE work_node_v3
         SET parent_id = 'container-2' WHERE work_id = 'container-1';",
        "work_node_v3_hierarchy_cycle",
    );
    reject(
        &store,
        "UPDATE work_node_v3
         SET execution_mode = 'direct' WHERE work_id = 'container-1';",
        "work_node_v3_invalid_retype",
    );

    store
        .execute_batch(
            "INSERT INTO cycle_series_v3
                 (series_id, project_id, name, lifecycle, timezone,
                  tzdb_identity, created_at, updated_at)
             VALUES ('series-1', 'p1', 'Weekly delivery', 'active',
                     'America/Regina', 'tzdb-2026a', 't0', 't0');
             INSERT INTO cycle_template_v3
                 (template_version_id, project_id, series_id, version,
                  effective_from_slot_ordinal, interval_weeks,
                  anchor_local_date, anchor_local_time, anchor_weekday,
                  recurrence_end_kind, recurrence_end_count,
                  recurrence_end_local_date, name_pattern, goal_template,
                  timezone, tzdb_identity, gap_policy, fold_policy, created_at)
             VALUES ('template-1', 'p1', 'series-1', 1, 0, 1,
                     '2026-09-21', '09:00:00', 1, 'never', NULL, NULL,
                     'Cycle {slot}', 'Ship the slice', 'America/Regina',
                     'tzdb-2026a', 'next_valid', 'earlier_offset', 't0');
             INSERT INTO cycle_template_weekday_v3
                 (project_id, template_version_id, weekday)
             VALUES ('p1', 'template-1', 1), ('p1', 'template-1', 3);
             INSERT INTO cycle_v3
                 (cycle_id, project_id, series_id, template_version_id,
                  slot_ordinal, slot_key, name, lifecycle,
                  scheduled_start_utc_ms, scheduled_end_utc_ms,
                  scheduled_start_local, scheduled_start_utc_offset_minutes,
                  timezone, tzdb_identity, gap_policy, fold_policy,
                  created_at, updated_at)
             VALUES ('cycle-1', 'p1', 'series-1', 'template-1', 7,
                     'boreal.cycle-slot/1/series-1/7', 'Cycle 7', 'planned',
                     1790000000000, 1790043200000, '2026-09-21T09:00:00',
                     -360, 'America/Regina', 'tzdb-2026a', 'next_valid',
                     'earlier_offset', 't0', 't0');
             INSERT INTO cycle_assignment_v3
                 (assignment_id, project_id, cycle_id, work_id, state,
                  activation_policy, activation_at_utc_ms, created_at, updated_at)
             VALUES ('assignment-1', 'p1', 'cycle-1', 'direct-a', 'planned',
                     'at_cycle_start', NULL, 't0', 't0');",
        )
        .expect("cycle recurrence and direct assignment insert");

    reject(
        &store,
        "INSERT INTO cycle_v3
             (cycle_id, project_id, series_id, template_version_id,
              slot_ordinal, slot_key, name, lifecycle,
              scheduled_start_utc_ms, scheduled_end_utc_ms,
              scheduled_start_local, scheduled_start_utc_offset_minutes,
              timezone, tzdb_identity, gap_policy, fold_policy,
              created_at, updated_at)
         VALUES ('cycle-bad-slot', 'p1', 'series-1', 'template-1', 8,
                 'not-a-slot', 'Bad', 'planned', 1790000000000, NULL,
                 '2026-09-28T09:00:00', -360, 'America/Regina', 'tzdb-2026a',
                 'next_valid', 'earlier_offset', 't0', 't0');",
        "CHECK constraint failed",
    );

    reject(
        &store,
        "INSERT INTO cycle_assignment_v3
             (assignment_id, project_id, cycle_id, work_id, state,
              activation_policy, activation_at_utc_ms, created_at, updated_at)
         VALUES ('assignment-container', 'p1', 'cycle-1', 'container-1',
                 'planned', 'at_cycle_start', NULL, 't0', 't0');",
        "cycle_assignment_v3_requires_direct_task",
    );
}

#[test]
fn direct_task_dependencies_are_separate_and_dag_safe() {
    let store = store_v3();
    seed_base(&store);
    seed_nodes(&store);

    store
        .execute_batch(
            "INSERT INTO work_dependency_v3
                 (project_id, prerequisite_work_id, dependent_work_id, created_at)
             VALUES ('p1', 'direct-a', 'direct-b', 't0');",
        )
        .expect("direct-task edge inserts");

    reject(
        &store,
        "INSERT INTO work_dependency_v3
             (project_id, prerequisite_work_id, dependent_work_id, created_at)
         VALUES ('p1', 'container-1', 'direct-b', 't0');",
        "work_dependency_v3_requires_direct_tasks",
    );
    reject(
        &store,
        "INSERT INTO work_dependency_v3
             (project_id, prerequisite_work_id, dependent_work_id, created_at)
         VALUES ('p1', 'direct-b', 'direct-a', 't0');",
        "work_dependency_v3_cycle",
    );

    reject(
        &store,
        "INSERT INTO work_dependency_v3
             (project_id, prerequisite_work_id, dependent_work_id, policy,
              exception_reason, approved_by, created_at)
         VALUES ('p1', 'direct-a', 'direct-b', 'explicit_exception',
                 'missing approval', NULL, 't0');",
        "CHECK constraint failed",
    );
}

#[test]
fn recurrence_fields_capture_resolved_timezone_and_template_identity() {
    let store = store_v3();
    seed_base(&store);
    seed_nodes(&store);

    store
        .execute_batch(
            "INSERT INTO cycle_series_v3
                 (series_id, project_id, name, lifecycle, timezone,
                  tzdb_identity, created_at, updated_at)
             VALUES ('series-2', 'p1', 'Biweekly review', 'active',
                     'America/New_York', 'tzdb-2026a', 't0', 't0');
             INSERT INTO cycle_template_v3
                 (template_version_id, project_id, series_id, version,
                  effective_from_slot_ordinal, interval_weeks,
                  anchor_local_date, anchor_local_time, anchor_weekday,
                  recurrence_end_kind, recurrence_end_count,
                  recurrence_end_local_date, name_pattern, goal_template,
                  timezone, tzdb_identity, gap_policy, fold_policy, created_at)
             VALUES ('template-2', 'p1', 'series-2', 4, 12, 2,
                     '2026-09-27', '23:59:00', 7, 'count', 8, NULL,
                     'Review {slot}', 'Review outcomes', 'America/New_York',
                     'tzdb-2026a', 'next_valid', 'later_offset', 't0');
             INSERT INTO cycle_template_weekday_v3
                 (project_id, template_version_id, weekday)
             VALUES ('p1', 'template-2', 7);
             INSERT INTO cycle_v3
                 (cycle_id, project_id, series_id, template_version_id,
                  slot_ordinal, slot_key, name, goal, lifecycle,
                  scheduled_start_utc_ms, scheduled_end_utc_ms,
                  scheduled_start_local, scheduled_start_utc_offset_minutes,
                  timezone, tzdb_identity, gap_policy, fold_policy,
                  created_at, updated_at)
             VALUES ('cycle-2', 'p1', 'series-2', 'template-2', 12,
                     'boreal.cycle-slot/1/series-2/12', 'Review 12',
                     'Review outcomes', 'planned', 1790000000000,
                     1790000060000, '2026-09-27T23:59:00', -240,
                     'America/New_York', 'tzdb-2026a', 'next_valid', 'later_offset',
                     't0', 't0');",
        )
        .expect("biweekly recurrence fixture inserts");

    reject(
        &store,
        "INSERT INTO cycle_template_v3
             (template_version_id, project_id, series_id, version,
              effective_from_slot_ordinal, interval_weeks,
              anchor_local_date, anchor_local_time, anchor_weekday,
              recurrence_end_kind, recurrence_end_count,
              recurrence_end_local_date, name_pattern, goal_template,
              timezone, tzdb_identity, gap_policy, fold_policy, created_at)
         VALUES ('template-bad', 'p1', 'series-2', 5, 13, 0,
                 '2026-09-27', '23:59:00', 7, 'count', 0, NULL, 'Bad', '',
                 'America/New_York', 'tzdb-2026a', 'next_valid',
                 'later_offset', 't0');",
        "CHECK constraint failed",
    );
}

#[test]
fn intake_promotion_binds_content_revision_and_digest() {
    let store = store_v3();
    seed_base(&store);

    store
        .execute_batch(
            "INSERT INTO intake_bucket_v3
                 (bucket_id, project_id, name, created_at, updated_at)
             VALUES ('bucket-1', 'p1', 'Inbox', 't0', 't0');
             INSERT INTO intake_item_v3
                 (intake_id, project_id, bucket_id, kind, lifecycle, content,
                  content_revision, content_digest, captured_at, updated_at)
             VALUES ('intake-1', 'p1', 'bucket-1', 'discovery', 'captured',
                     'Found a reproducible edge case', 1, 'sha256:intake-a',
                     't0', 't0');
             INSERT INTO intake_promotion_v3
                 (promotion_id, project_id, intake_id, intake_revision,
                  intake_digest, target_kind, target_id, actor_id,
                  operation_id, created_at)
             VALUES ('promotion-1', 'p1', 'intake-1', 1, 'sha256:intake-a',
                     'draft_work', 'draft-1', 'agent-1', 'op-1', 't0');",
        )
        .expect("matching promotion provenance inserts");

    reject(
        &store,
        "INSERT INTO intake_promotion_v3
             (promotion_id, project_id, intake_id, intake_revision,
              intake_digest, target_kind, target_id, actor_id,
              operation_id, created_at)
         VALUES ('promotion-stale', 'p1', 'intake-1', 2, 'sha256:intake-b',
                 'memory_draft', 'memory-1', 'agent-1', 'op-stale', 't0');",
        "intake_promotion_v3_stale_provenance",
    );
    reject(
        &store,
        "INSERT INTO intake_item_v3
             (intake_id, project_id, bucket_id, kind, lifecycle, content,
              content_revision, content_digest, captured_at, updated_at)
         VALUES ('intake-deferred', 'p1', 'bucket-1', 'revisit', 'deferred',
                 'Come back later', 1, 'sha256:later', 't0', 't0');",
        "CHECK constraint failed",
    );

    store
        .execute_batch(
            "UPDATE intake_item_v3
             SET content = 'Found a narrower edge case',
                 content_revision = 2,
                 content_digest = 'sha256:intake-b',
                 updated_at = 't1'
             WHERE intake_id = 'intake-1';",
        )
        .expect("content revision advances with a new digest");

    reject(
        &store,
        "INSERT INTO intake_promotion_v3
             (promotion_id, project_id, intake_id, intake_revision,
              intake_digest, target_kind, target_id, actor_id,
              operation_id, created_at)
         VALUES ('promotion-old', 'p1', 'intake-1', 1, 'sha256:intake-a',
                 'source_version', 'source-1', 'agent-1', 'op-old', 't1');",
        "intake_promotion_v3_stale_provenance",
    );

    reject(
        &store,
        "UPDATE intake_item_v3
         SET content = 'Untracked edit', content_revision = 4,
             content_digest = 'sha256:intake-c'
         WHERE intake_id = 'intake-1';",
        "intake_item_v3_revision_digest_mismatch",
    );

    store
        .execute_batch(
            "INSERT INTO intake_promotion_v3
                 (promotion_id, project_id, intake_id, intake_revision,
                  intake_digest, target_kind, target_id, actor_id,
                  operation_id, created_at)
             VALUES ('promotion-2', 'p1', 'intake-1', 2, 'sha256:intake-b',
                     'memory_draft', 'memory-1', 'agent-1', 'op-2', 't1');",
        )
        .expect("new promotion binds the new content revision");

    reject(
        &store,
        "DELETE FROM intake_promotion_v3 WHERE promotion_id = 'promotion-1';",
        "intake_promotion_v3_append_only",
    );
}

#[test]
fn container_dispositions_are_append_only_chain_tips() {
    let store = store_v3();
    seed_base(&store);
    seed_nodes(&store);

    store
        .execute_batch(
            "INSERT INTO container_disposition_v3
                 (disposition_id, project_id, container_work_id,
                  descendant_work_id, kind, descendant_revision,
                  descendant_outcome_digest, created_at)
             VALUES ('disposition-1', 'p1', 'container-1', 'direct-a',
                     'accepted_closed', 7, 'sha256:outcome-a', 't0');",
        )
        .expect("initial disposition inserts");

    reject(
        &store,
        "UPDATE container_disposition_v3
         SET kind = 'deferred' WHERE disposition_id = 'disposition-1';",
        "container_disposition_v3_append_only",
    );
    reject(
        &store,
        "DELETE FROM container_disposition_v3
         WHERE disposition_id = 'disposition-1';",
        "container_disposition_v3_append_only",
    );
    reject(
        &store,
        "INSERT INTO container_disposition_v3
             (disposition_id, project_id, container_work_id,
              descendant_work_id, kind, descendant_revision,
              descendant_outcome_digest, created_at)
         VALUES ('disposition-duplicate', 'p1', 'container-1', 'direct-a',
                 'accepted_cancelled', 8, 'sha256:outcome-b', 't1');",
        "container_disposition_v3_current_exists",
    );

    store
        .execute_batch(
            "INSERT INTO container_disposition_v3
                 (disposition_id, project_id, container_work_id,
                  descendant_work_id, kind, descendant_revision,
                  descendant_outcome_digest, replacement_work_id, reason,
                  supersedes_id, created_at)
             VALUES ('disposition-2', 'p1', 'container-1', 'direct-a',
                     'replaced', 9, 'sha256:outcome-c', 'direct-b',
                     'replacement approved', 'disposition-1', 't2');",
        )
        .expect("replacement disposition supersedes the current tip");

    reject(
        &store,
        "INSERT INTO container_disposition_v3
             (disposition_id, project_id, container_work_id,
              descendant_work_id, kind, descendant_revision,
              descendant_outcome_digest, supersedes_id, created_at)
         VALUES ('disposition-3', 'p1', 'container-1', 'direct-a',
                 'accepted_closed', 10, 'sha256:outcome-d',
                 'disposition-1', 't3');",
        "container_disposition_v3_invalid_supersedes",
    );
    reject(
        &store,
        "INSERT INTO container_disposition_v3
             (disposition_id, project_id, container_work_id,
              descendant_work_id, kind, descendant_revision,
              descendant_outcome_digest, created_at)
         VALUES ('disposition-outside', 'p1', 'container-2', 'direct-a',
                 'accepted_closed', 1, 'sha256:outside', 't3');",
        "container_disposition_v3_invalid_subject",
    );
    reject(
        &store,
        "INSERT INTO container_disposition_v3
             (disposition_id, project_id, container_work_id,
              descendant_work_id, kind, descendant_revision,
              descendant_outcome_digest, replacement_work_id, created_at)
         VALUES ('disposition-bad-shape', 'p1', 'container-1', 'direct-b',
                 'accepted_closed', 1, 'sha256:bad', 'direct-a', 't3');",
        "CHECK constraint failed",
    );
}
