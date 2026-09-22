use boreal_domain::{
    AcceptanceProfile, DispatchPolicy, PersistedLifecycle, ProjectId, ReasonCode, WorkId, WorkItem,
    WorkKind,
};
use boreal_store::{SqliteStore, StoreError, WORK_MODEL_SCHEMA_VERSION};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Barrier};

const SCHEMA: &str = include_str!("../../../project/spec/schema-v2.sql");

fn remove_sqlite_files(path: &Path) {
    let _ = std::fs::remove_file(path);
    let _ = std::fs::remove_file(path.with_extension("sqlite-wal"));
    let _ = std::fs::remove_file(path.with_extension("sqlite-shm"));
}

fn seed_project(store: &SqliteStore) {
    store
        .execute_batch(
            "INSERT INTO project VALUES ('p1', 2, 'boreal.work-status/2', 0, 't0', 't0');
             INSERT INTO acceptance_profile VALUES ('default', 1, 'sha256:policy', '{}', 't0');",
        )
        .unwrap();
}

fn seed_work(store: &SqliteStore, id: &str, kind: &str, parent_id: Option<&str>) {
    let mut sql = format!(
        "INSERT INTO work_item (
             work_id, project_id, kind, parent_id, lifecycle, dispatch_policy,
             acceptance_profile_id, acceptance_profile_version, title,
             description, created_at, updated_at
         ) VALUES ('{}', 'p1', '{}', {}, 'open', 'automatic', 'default', 1, '{}', '', 't0', 't0')",
        id.replace('\'', "''"),
        kind,
        parent_id.map_or_else(
            || "NULL".to_owned(),
            |value| format!("'{}'", value.replace('\'', "''"))
        ),
        id.replace('\'', "''"),
    );
    sql.push(';');
    store.execute_batch(&sql).unwrap();
}

fn work(id: &str, priority: u8, holds: Vec<ReasonCode>) -> WorkItem {
    WorkItem {
        id: WorkId::new(id),
        project_id: ProjectId::new("p1"),
        kind: WorkKind::Task,
        parent_id: None,
        title: id.to_owned(),
        description: String::new(),
        lifecycle: PersistedLifecycle::Open,
        priority,
        dispatch_policy: DispatchPolicy::Automatic,
        hard_holds: holds,
        acceptance_profile: AcceptanceProfile::focused(),
    }
}

fn legacy_schema() -> String {
    let mut sql = SCHEMA.to_owned();
    sql = sql.replace(
        "  priority INTEGER NOT NULL DEFAULT 0 CHECK (priority >= 0 AND priority <= 255),\n",
        "",
    );
    sql = sql.replace(
        "CREATE INDEX work_item_project_id ON work_item(project_id, work_id);\n",
        "",
    );
    sql = sql.replace(
        "CREATE INDEX attempt_work_current ON attempt(work_id, current, attempt_id);\n",
        "",
    );
    sql = sql.replace(
        "CREATE INDEX attempt_session_current ON attempt(session_id, current, attempt_id);\n",
        "",
    );

    let hold_start = sql.find("CREATE TABLE work_hold").unwrap();
    let hold_end = sql[hold_start..].find("CREATE TABLE gate").unwrap() + hold_start;
    sql.replace_range(hold_start..hold_end, "");

    let execution_start = sql.find("CREATE TABLE evidence_execution").unwrap();
    let execution_end =
        sql[execution_start..].find("CREATE TABLE review").unwrap() + execution_start;
    sql.replace_range(execution_start..execution_end, "");

    for trigger in ["work_parent_retype_guard", "dependency_no_cycle"] {
        let start = sql.find(&format!("CREATE TRIGGER {trigger}")).unwrap();
        let end = sql[start..].find("END;\n").unwrap() + start + "END;\n".len();
        sql.replace_range(start..end, "");
    }
    sql
}

#[test]
fn fresh_schema_rolls_back_all_ddl_when_initialization_fails() {
    let path = std::env::temp_dir().join(format!(
        "boreal-store-{}-atomic-schema.sqlite",
        std::process::id()
    ));
    remove_sqlite_files(&path);

    let broken = "CREATE TABLE partial_schema_marker (id INTEGER);\nTHIS IS INVALID SQL;\nPRAGMA user_version = 2;";
    assert!(SqliteStore::open(&path, broken).is_err());

    let store = SqliteStore::open(&path, SCHEMA).expect("failed schema must be recoverable");
    assert_eq!(store.schema_version().unwrap(), WORK_MODEL_SCHEMA_VERSION);
    assert!(store.work_model_v3_enabled().unwrap());
    drop(store);
    remove_sqlite_files(&path);
}

#[test]
fn legacy_v2_schema_is_repaired_atomically_and_survives_restart() {
    let legacy = legacy_schema();
    let path = std::env::temp_dir().join(format!(
        "boreal-store-{}-legacy-migration.sqlite",
        std::process::id()
    ));
    remove_sqlite_files(&path);
    let store = SqliteStore::open_for_migration(&path).unwrap();
    store.execute_batch(&legacy).unwrap();
    seed_project(&store);
    seed_work(&store, "w1", "task", None);

    store.apply_schema(SCHEMA).unwrap();
    assert_eq!(store.schema_version().unwrap(), WORK_MODEL_SCHEMA_VERSION);
    assert!(store.work_model_v3_enabled().unwrap());
    let item = store.work("p1", "w1").unwrap().unwrap();
    assert_eq!(item.priority, 0);
    assert!(item.hard_holds.is_empty());
    assert!(store.work_holds("w1").unwrap().is_empty());
    assert!(store
        .list_incomplete_evidence_executions()
        .unwrap()
        .is_empty());
    drop(store);

    let store = SqliteStore::open(&path, SCHEMA).unwrap();
    assert_eq!(store.schema_version().unwrap(), WORK_MODEL_SCHEMA_VERSION);
    assert!(store.work_model_v3_enabled().unwrap());
    assert!(store.work("p1", "w1").unwrap().is_some());
    remove_sqlite_files(&path);
}

#[test]
fn canonical_open_repairs_legacy_v2_and_reopens_v3_contract() {
    let legacy = legacy_schema();
    let path = std::env::temp_dir().join(format!(
        "boreal-store-{}-open-no-repair.sqlite",
        std::process::id()
    ));
    remove_sqlite_files(&path);
    let store = SqliteStore::open_for_migration(&path).unwrap();
    store.execute_batch(&legacy).unwrap();
    assert!(store.work_holds("missing").is_err());
    drop(store);
    let store = SqliteStore::open(&path, SCHEMA).expect("production open repairs legacy v2");
    assert_eq!(store.schema_version().unwrap(), WORK_MODEL_SCHEMA_VERSION);
    assert!(store.work_model_v3_enabled().unwrap());
    assert!(store.work_holds("missing").unwrap().is_empty());
    remove_sqlite_files(&path);
}

#[test]
fn same_version_schema_drift_fails_closed_at_open() {
    let path = std::env::temp_dir().join(format!(
        "boreal-store-{}-same-version-drift.sqlite",
        std::process::id()
    ));
    remove_sqlite_files(&path);
    let store = SqliteStore::open_for_migration(&path).unwrap();
    store
        .execute_batch(
            "CREATE TABLE project (
                 project_id TEXT PRIMARY KEY,
                 project_revision INTEGER NOT NULL DEFAULT 0
             );
             PRAGMA user_version = 2;",
        )
        .unwrap();
    drop(store);
    assert!(SqliteStore::open(&path, SCHEMA).is_err());
    remove_sqlite_files(&path);
}

#[test]
fn read_only_open_does_not_run_schema_repair_or_take_write_setup() {
    let path = std::env::temp_dir().join(format!(
        "boreal-store-{}-readonly-open.sqlite",
        std::process::id()
    ));
    remove_sqlite_files(&path);
    {
        let store = SqliteStore::open(&path, SCHEMA).unwrap();
        seed_project(&store);
        seed_work(&store, "w1", "task", None);
    }
    let store = SqliteStore::open_read_only(&path).unwrap();
    store.reset_query_metrics();
    let status = store.read_project_status("p1").unwrap();
    assert_eq!(status.total, 1);
    let metrics = store.query_metrics();
    assert_eq!(metrics.batch_calls, 2, "read path should only begin/commit");
    remove_sqlite_files(&path);
}

#[test]
fn read_only_status_survives_a_held_writer_transaction() {
    let path = std::env::temp_dir().join(format!(
        "boreal-store-{}-readonly-writer.sqlite",
        std::process::id()
    ));
    remove_sqlite_files(&path);
    {
        let store = SqliteStore::open(&path, SCHEMA).unwrap();
        seed_project(&store);
        seed_work(&store, "w1", "task", None);
        store.execute_batch("BEGIN IMMEDIATE").unwrap();
        let reader = SqliteStore::open_read_only(&path).unwrap();
        let status = reader.read_project_status("p1").unwrap();
        assert_eq!(status.total, 1);
        store.execute_batch("ROLLBACK").unwrap();
    }
    remove_sqlite_files(&path);
}

#[test]
fn checked_work_creation_rejects_stale_revision_without_writing() {
    let store = SqliteStore::open_in_memory(SCHEMA).unwrap();
    seed_project(&store);
    store
        .execute_batch(
            "INSERT INTO actor VALUES ('agent-1', 'agent', 'cred-1', 'Agent', 't0');
             INSERT INTO acceptance_profile VALUES ('focused', 1, 'sha256:policy', '{}', 't0');",
        )
        .unwrap();
    let first = work("w-first", 0, Vec::new());
    store
        .create_work_operation_checked(
            &first,
            "agent-1",
            "op-first",
            "sha256:op-first",
            Some(0),
            "t1",
        )
        .unwrap();
    let stale = work("w-stale", 0, Vec::new());
    let error = store
        .create_work_operation_checked(
            &stale,
            "agent-1",
            "op-stale",
            "sha256:op-stale",
            Some(0),
            "t2",
        )
        .unwrap_err();
    assert!(matches!(
        error,
        StoreError::StaleRevision {
            expected: 0,
            actual: 1
        }
    ));
    assert!(store.work("p1", "w-stale").unwrap().is_none());
    assert!(store.operation("op-stale").unwrap().is_none());
}

#[test]
fn status_gate_queries_are_batched_for_large_projects() {
    let store = SqliteStore::open_in_memory(SCHEMA).unwrap();
    seed_project(&store);
    for index in 0..250 {
        seed_work(&store, &format!("w-{index:04}"), "task", None);
    }
    store.reset_query_metrics();
    let status = store.read_project_status("p1").unwrap();
    let metrics = store.query_metrics();
    assert_eq!(status.works.len(), 250);
    assert!(
        metrics.statements_prepared < 20,
        "status prepared {} statements; expected fixed-size relation reads",
        metrics.statements_prepared
    );
}

#[test]
fn claimable_candidates_use_keyset_continuation_beyond_first_page() {
    let store = SqliteStore::open_in_memory(SCHEMA).unwrap();
    seed_project(&store);
    for index in 0..1_101 {
        seed_work(&store, &format!("w-{index:04}"), "task", None);
    }
    let first = store
        .claimable_work_candidates("p1", "t1", 1_000, None)
        .unwrap();
    assert_eq!(first.len(), 1_000);
    let second = store
        .claimable_work_candidates("p1", "t1", 1_000, first.last().map(String::as_str))
        .unwrap();
    assert_eq!(second.len(), 101);
    assert_eq!(second.last().map(String::as_str), Some("w-1100"));
}

#[test]
fn execution_only_operation_readback_is_project_scoped() {
    let store = SqliteStore::open_in_memory(SCHEMA).unwrap();
    seed_project(&store);
    seed_work(&store, "w-exec", "task", None);
    store
        .execute_batch(
            "INSERT INTO actor VALUES ('agent-1', 'agent', 'cred-1', 'Agent', 't0');
             INSERT INTO attempt (
                 attempt_id, work_id, actor_id, harness_id, fence, current, state,
                 claimed_at, accepted_at, lease_deadline, max_attempt_deadline,
                 config_identity, binary_identity, protocol_version, schema_version
             ) VALUES ('attempt-exec', 'w-exec', 'agent-1', 'harness-1', 1, 1,
                       'running', 't0', 't0', 't1', 't2', 'config', 'binary', '2', 2);
             INSERT INTO gate (
                 gate_id, work_id, profile_id, profile_version, kind, required,
                 state, subject_ref, updated_at
             ) VALUES ('w-exec:checkpoint', 'w-exec', 'default', 1,
                       'checkpoint', 1, 'open', '', 't0');
             INSERT INTO evidence_execution (
                 operation_id, project_id, work_id, attempt_id, fence, gate_id,
                 actor_id, request_digest, artifact_ref, state, admitted_at
             ) VALUES ('op-exec', 'p1', 'w-exec', 'attempt-exec', 1,
                       'w-exec:checkpoint', 'agent-1', 'sha256:req', 'artifact-1',
                       'admitted', 't0');",
        )
        .unwrap();
    let readback = store.operation_readback("p1", "op-exec").unwrap().unwrap();
    assert!(readback.operation.is_none());
    assert_eq!(readback.execution.unwrap().project_id, "p1");
    assert!(matches!(
        store.operation_readback("p2", "op-exec"),
        Err(StoreError::WrongSubject { .. })
    ));
}

#[test]
fn priority_and_holds_round_trip_through_status_and_restart() {
    let path = std::env::temp_dir().join(format!(
        "boreal-store-{}-priority-holds.sqlite",
        std::process::id()
    ));
    remove_sqlite_files(&path);
    {
        let store = SqliteStore::open(&path, SCHEMA).unwrap();
        seed_project(&store);
        let item = work(
            "w-held",
            42,
            vec![
                ReasonCode::HardHold("operator_decision_required".to_owned()),
                ReasonCode::HardHold("change_freeze".to_owned()),
            ],
        );
        store.create_work(&item, "t1").unwrap();
        let read = store.work("p1", "w-held").unwrap().unwrap();
        assert_eq!(read.priority, 42);
        assert_eq!(read.hard_holds.len(), 2);
        assert_eq!(store.work_holds("w-held").unwrap().len(), 2);
        let status = store.read_project_status("p1").unwrap();
        let status_item = status
            .works
            .iter()
            .find(|row| row.work.id.as_str() == "w-held")
            .unwrap();
        assert_eq!(status_item.work.priority, 42);
        assert_eq!(status_item.work.hard_holds, read.hard_holds);
    }
    {
        let store = SqliteStore::open(&path, SCHEMA).unwrap();
        let read = store.work("p1", "w-held").unwrap().unwrap();
        assert_eq!(read.priority, 42);
        assert_eq!(read.hard_holds.len(), 2);
        assert_eq!(store.work_holds("w-held").unwrap().len(), 2);
    }
    remove_sqlite_files(&path);
}

#[test]
fn exact_work_and_session_lookups_do_not_depend_on_page_limits() {
    let store = SqliteStore::open_in_memory(SCHEMA).unwrap();
    seed_project(&store);
    for index in 0..1_101 {
        seed_work(&store, &format!("w-{index:04}"), "task", None);
    }
    let page = store.list_work("p1", 100, 0).unwrap();
    assert_eq!(page.total, 1_101);
    assert!(store.work("p1", "w-1100").unwrap().is_some());
    assert!(store.work("p1", "w-1000").unwrap().is_some());
    assert!(store.work("p1", "missing").unwrap().is_none());

    store
        .execute_batch(
            "INSERT INTO actor VALUES ('agent-1', 'agent', 'cred-1', 'Agent', 't0');
             INSERT INTO session VALUES ('session-1', 'agent-1', 'harness-1', 'active', 't0', NULL);
             INSERT INTO attempt (
                 attempt_id, work_id, actor_id, harness_id, session_id, fence,
                 current, state, claimed_at, lease_deadline, max_attempt_deadline,
                 config_identity, binary_identity, protocol_version, schema_version
             ) VALUES ('attempt-1', 'w-1100', 'agent-1', 'harness-1', 'session-1', 1,
                       1, 'claimed', 't0', 't1', 't2', 'config', 'binary', '2', 2);",
        )
        .unwrap();
    assert_eq!(
        store
            .current_attempt_for_session("p1", "session-1")
            .unwrap()
            .unwrap()
            .attempt_id,
        "attempt-1"
    );
}

#[test]
fn dependency_cycles_and_invalid_parent_retyping_are_rejected() {
    let store = SqliteStore::open_in_memory(SCHEMA).unwrap();
    seed_project(&store);
    seed_work(&store, "a", "task", None);
    seed_work(&store, "b", "task", None);
    seed_work(&store, "c", "task", None);
    store.add_dependency("p1", "a", "b", "t1").unwrap();
    store.add_dependency("p1", "b", "c", "t1").unwrap();
    let cycle = store.add_dependency("p1", "c", "a", "t1");
    assert!(matches!(cycle, Err(StoreError::Conflict(_))));

    seed_work(&store, "parent", "milestone", None);
    seed_work(&store, "child", "sprint", Some("parent"));
    let retype = store.execute_batch("UPDATE work_item SET kind = 'task' WHERE work_id = 'parent'");
    assert!(matches!(
        retype,
        Err(StoreError::Constraint {
            message,
            ..
        }) if message.contains("invalid_parent_kind")
    ));
}

#[test]
fn concurrent_opposite_edges_leave_at_most_one_edge() {
    let path = std::env::temp_dir().join(format!(
        "boreal-store-{}-cycle-race.sqlite",
        std::process::id()
    ));
    remove_sqlite_files(&path);
    {
        let store = SqliteStore::open(&path, SCHEMA).unwrap();
        seed_project(&store);
        seed_work(&store, "a", "task", None);
        seed_work(&store, "b", "task", None);
    }

    let barrier = Arc::new(Barrier::new(2));
    let left_path = PathBuf::from(&path);
    let right_path = PathBuf::from(&path);
    let left_barrier = Arc::clone(&barrier);
    let right_barrier = Arc::clone(&barrier);
    let left = std::thread::spawn(move || {
        let store = SqliteStore::open(&left_path, SCHEMA).unwrap();
        left_barrier.wait();
        store.add_dependency("p1", "a", "b", "t1")
    });
    let right = std::thread::spawn(move || {
        let store = SqliteStore::open(&right_path, SCHEMA).unwrap();
        right_barrier.wait();
        store.add_dependency("p1", "b", "a", "t1")
    });
    let left = left.join().unwrap();
    let right = right.join().unwrap();
    assert_eq!(usize::from(left.is_ok()) + usize::from(right.is_ok()), 1);

    let store = SqliteStore::open(&path, SCHEMA).unwrap();
    assert_eq!(
        store.read_project_status("p1").unwrap().dependencies.len(),
        1
    );
    remove_sqlite_files(&path);
}

#[test]
fn operation_and_audit_json_round_trip_adversarial_identifiers() {
    let store = SqliteStore::open_in_memory(SCHEMA).unwrap();
    store
        .initialize_project(
            "p1",
            "agent-1",
            "agent",
            "cred-1",
            "Agent",
            "init-1",
            "sha256:init-1",
            "t0",
        )
        .unwrap();
    let id = "w\"quoted\\slash\n";
    store
        .create_work_operation(
            &work(id, 0, Vec::new()),
            "agent-1",
            "op-json",
            "sha256:op-json",
            "t1",
        )
        .unwrap();
    let operation = store.operation("op-json").unwrap().unwrap();
    let result: serde_json::Value = serde_json::from_str(&operation.result_json).unwrap();
    assert_eq!(result["work_id"].as_str(), Some(id));
    let audit = store.audit_event("op-json").unwrap().unwrap();
    let payload: serde_json::Value = serde_json::from_str(&audit.payload_json).unwrap();
    assert_eq!(payload["work_id"].as_str(), Some(id));
}
