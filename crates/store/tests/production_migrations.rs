#[path = "../src/migrations.rs"]
mod migrations;

use std::ffi::{CStr, CString};
use std::os::raw::{c_char, c_int, c_void};
use std::path::{Path, PathBuf};
use std::ptr;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use boreal_store::{MigrationBackend as StoreMigrationBackend, SqliteStore, StoreError};

use migrations::{
    checksum, MigrationBackend, MigrationDiagnostic, MigrationError, MigrationLedgerEntry,
    MigrationOutcome, MigrationPlan, MigrationRunner, MigrationState, SchemaIdentity,
    MIGRATION_DIAGNOSTIC_TABLE, MIGRATION_LEDGER_TABLE, SCHEMA_IDENTITY_TABLE,
};

const SQLITE_OK: c_int = 0;
const SQLITE_ROW: c_int = 100;
const SQLITE_DONE: c_int = 101;
const SQLITE_OPEN_READWRITE: c_int = 0x0000_0002;
const SQLITE_OPEN_CREATE: c_int = 0x0000_0004;
const SQLITE_OPEN_FULLMUTEX: c_int = 0x0001_0000;

const PRODUCTION_SCHEMA: &str = include_str!("../../../project/spec/schema-production.sql");
const SCHEMA_V2: &str = include_str!("../../../project/spec/schema-v2.sql");
const SCHEMA_V3: &str = include_str!("../../../project/spec/schema-v3.sql");

#[allow(non_camel_case_types)]
type sqlite3 = c_void;
#[allow(non_camel_case_types)]
type sqlite3_stmt = c_void;

#[link(name = "sqlite3")]
unsafe extern "C" {
    fn sqlite3_open_v2(
        filename: *const c_char,
        database: *mut *mut sqlite3,
        flags: c_int,
        vfs: *const c_char,
    ) -> c_int;
    fn sqlite3_close(database: *mut sqlite3) -> c_int;
    fn sqlite3_errmsg(database: *mut sqlite3) -> *const c_char;
    fn sqlite3_exec(
        database: *mut sqlite3,
        sql: *const c_char,
        callback: Option<
            unsafe extern "C" fn(*mut c_void, c_int, *mut *mut c_char, *mut *mut c_char) -> c_int,
        >,
        argument: *mut c_void,
        error: *mut *mut c_char,
    ) -> c_int;
    fn sqlite3_prepare_v2(
        database: *mut sqlite3,
        sql: *const c_char,
        length: c_int,
        statement: *mut *mut sqlite3_stmt,
        tail: *mut *const c_char,
    ) -> c_int;
    fn sqlite3_finalize(statement: *mut sqlite3_stmt) -> c_int;
    fn sqlite3_step(statement: *mut sqlite3_stmt) -> c_int;
    fn sqlite3_column_count(statement: *mut sqlite3_stmt) -> c_int;
    fn sqlite3_column_int64(statement: *mut sqlite3_stmt, index: c_int) -> i64;
    fn sqlite3_column_text(statement: *mut sqlite3_stmt, index: c_int) -> *const u8;
}

struct TestDb {
    database: *mut sqlite3,
    migration_lock: Arc<Mutex<bool>>,
    live_diagnostics: Vec<MigrationDiagnostic>,
    legacy_diagnostics: Vec<MigrationDiagnostic>,
    failure_marker: Option<String>,
}

impl TestDb {
    fn new() -> Self {
        let filename = CString::new(":memory:").expect("static SQLite filename");
        let mut database = ptr::null_mut();
        let result = unsafe {
            sqlite3_open_v2(
                filename.as_ptr(),
                &mut database,
                SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX,
                ptr::null(),
            )
        };
        assert_eq!(result, SQLITE_OK, "SQLite in-memory database opens");
        Self {
            database,
            migration_lock: Arc::new(Mutex::new(false)),
            live_diagnostics: Vec::new(),
            legacy_diagnostics: Vec::new(),
            failure_marker: None,
        }
    }

    fn raw_execute(&self, sql: &str) {
        let sql = CString::new(sql).expect("test SQL contains no NUL");
        let result = unsafe {
            sqlite3_exec(
                self.database,
                sql.as_ptr(),
                None,
                ptr::null_mut(),
                ptr::null_mut(),
            )
        };
        assert_eq!(result, SQLITE_OK, "SQLite setup SQL succeeds: {sql:?}");
    }

    fn error_message(&self) -> String {
        unsafe { CStr::from_ptr(sqlite3_errmsg(self.database)) }
            .to_string_lossy()
            .into_owned()
    }

    fn query_rows(&self, sql: &str) -> Result<Vec<Vec<String>>, String> {
        let sql = CString::new(sql).map_err(|error| error.to_string())?;
        let mut statement = ptr::null_mut();
        let prepare_result = unsafe {
            sqlite3_prepare_v2(
                self.database,
                sql.as_ptr(),
                -1,
                &mut statement,
                ptr::null_mut(),
            )
        };
        if prepare_result != SQLITE_OK {
            return Err(self.error_message());
        }

        let mut rows = Vec::new();
        loop {
            let result = unsafe { sqlite3_step(statement) };
            match result {
                SQLITE_ROW => {
                    let mut row = Vec::new();
                    let column_count = unsafe { sqlite3_column_count(statement) };
                    for index in 0..column_count {
                        let value = unsafe { sqlite3_column_text(statement, index) };
                        if value.is_null() {
                            row.push(String::new());
                        } else {
                            row.push(
                                unsafe { CStr::from_ptr(value.cast()) }
                                    .to_string_lossy()
                                    .into_owned(),
                            );
                        }
                    }
                    rows.push(row);
                }
                SQLITE_DONE => break,
                _ => {
                    unsafe { sqlite3_finalize(statement) };
                    return Err(self.error_message());
                }
            }
        }
        unsafe { sqlite3_finalize(statement) };
        Ok(rows)
    }

    fn scalar_i64(&self, sql: &str) -> i64 {
        let sql = CString::new(sql).expect("test SQL contains no NUL");
        let mut statement = ptr::null_mut();
        let prepare_result = unsafe {
            sqlite3_prepare_v2(
                self.database,
                sql.as_ptr(),
                -1,
                &mut statement,
                ptr::null_mut(),
            )
        };
        assert_eq!(prepare_result, SQLITE_OK, "SQLite scalar prepares: {sql:?}");
        assert_eq!(unsafe { sqlite3_step(statement) }, SQLITE_ROW);
        let value = unsafe { sqlite3_column_int64(statement, 0) };
        unsafe { sqlite3_finalize(statement) };
        value
    }

    fn table_exists(&self, table: &str) -> bool {
        let table = table.replace('\'', "''");
        self.scalar_i64(&format!(
            "SELECT EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '{table}')"
        )) == 1
    }

    fn create_v2_schema(&self) {
        self.raw_execute(
            "CREATE TABLE work_item (id TEXT PRIMARY KEY, title TEXT NOT NULL);
             CREATE TABLE attempt (id TEXT PRIMARY KEY, work_id TEXT NOT NULL, state TEXT NOT NULL);
             INSERT INTO work_item (id, title) VALUES ('w-1', 'legacy work');
             INSERT INTO attempt (id, work_id, state) VALUES ('a-1', 'w-1', 'accepted');
             PRAGMA user_version = 2;",
        );
    }

    fn set_failure_marker(&mut self, marker: Option<&str>) {
        self.failure_marker = marker.map(str::to_owned);
    }

    fn install_running_entry(&self, checksum: &str) {
        self.raw_execute(&format!(
            "CREATE TABLE {MIGRATION_LEDGER_TABLE} (
               migration_id TEXT NOT NULL, attempt INTEGER NOT NULL, from_version INTEGER NOT NULL,
               to_version INTEGER NOT NULL, checksum TEXT NOT NULL, state TEXT NOT NULL,
               diagnostics_json TEXT NOT NULL, failure_message TEXT, started_at TEXT NOT NULL,
               completed_at TEXT, PRIMARY KEY (migration_id, attempt));
             INSERT INTO {MIGRATION_LEDGER_TABLE}
               (migration_id, attempt, from_version, to_version, checksum, state,
                diagnostics_json, started_at)
             VALUES ('work-item-2-to-3', 1, 2, 3, '{checksum}', 'running', '[]', 't0');"
        ));
    }

    fn ledger_state(&self, migration_id: &str, attempt: i64) -> String {
        let rows = self
            .query_rows(&format!(
                "SELECT state FROM {MIGRATION_LEDGER_TABLE}
                 WHERE migration_id = '{migration_id}' AND attempt = {attempt}"
            ))
            .expect("ledger query succeeds");
        rows[0][0].clone()
    }
}

impl Drop for TestDb {
    fn drop(&mut self) {
        if !self.database.is_null() {
            unsafe { sqlite3_close(self.database) };
        }
    }
}

impl MigrationBackend for TestDb {
    type Error = String;

    fn schema_identity(&mut self) -> Result<SchemaIdentity, Self::Error> {
        let version = self.scalar_i64("PRAGMA user_version");
        if version == 0 {
            return Ok(SchemaIdentity::uninitialized());
        }
        if !self.table_exists(SCHEMA_IDENTITY_TABLE) {
            return Ok(SchemaIdentity {
                schema_id: "boreal.sqlite".to_owned(),
                schema_version: version,
                contract_version: format!("boreal.sqlite/{version}"),
                schema_checksum: Some(checksum(format!("legacy schema v{version}").as_bytes())),
            });
        }
        let rows = self.query_rows(&format!(
            "SELECT schema_id, schema_version, contract_version, schema_checksum
             FROM {SCHEMA_IDENTITY_TABLE} WHERE identity_id = 1"
        ))?;
        let row = rows
            .first()
            .ok_or_else(|| "missing schema identity row".to_owned())?;
        Ok(SchemaIdentity {
            schema_id: row[0].clone(),
            schema_version: row[1].parse().map_err(|error| format!("{error}"))?,
            contract_version: row[2].clone(),
            schema_checksum: Some(row[3].clone()),
        })
    }

    fn live_attempt_diagnostics(&mut self) -> Result<Vec<MigrationDiagnostic>, Self::Error> {
        Ok(self.live_diagnostics.clone())
    }

    fn legacy_diagnostics(&mut self) -> Result<Vec<MigrationDiagnostic>, Self::Error> {
        Ok(self.legacy_diagnostics.clone())
    }

    fn try_acquire_migration_lock(&mut self) -> Result<(), Self::Error> {
        let mut held = self
            .migration_lock
            .lock()
            .map_err(|_| "migration lock poisoned".to_owned())?;
        if *held {
            Err("migration lock is held by another service".to_owned())
        } else {
            *held = true;
            Ok(())
        }
    }

    fn release_migration_lock(&mut self) {
        if let Ok(mut held) = self.migration_lock.lock() {
            *held = false;
        }
    }

    fn begin_immediate(&mut self) -> Result<(), Self::Error> {
        self.execute("BEGIN IMMEDIATE")
    }

    fn execute(&mut self, sql: &str) -> Result<(), Self::Error> {
        if self
            .failure_marker
            .as_deref()
            .is_some_and(|marker| sql.contains(marker))
        {
            return Err("injected migration failure".to_owned());
        }
        let sql_c = CString::new(sql).map_err(|error| error.to_string())?;
        let result = unsafe {
            sqlite3_exec(
                self.database,
                sql_c.as_ptr(),
                None,
                ptr::null_mut(),
                ptr::null_mut(),
            )
        };
        if result == SQLITE_OK {
            Ok(())
        } else {
            Err(self.error_message())
        }
    }

    fn read_ledger(&mut self) -> Result<Vec<MigrationLedgerEntry>, Self::Error> {
        if !self.table_exists(MIGRATION_LEDGER_TABLE) {
            return Ok(Vec::new());
        }
        let rows = self.query_rows(&format!(
            "SELECT migration_id, attempt, from_version, to_version, checksum, state,
                    diagnostics_json, failure_message, started_at, completed_at
             FROM {MIGRATION_LEDGER_TABLE} ORDER BY migration_id, attempt"
        ))?;
        rows.into_iter()
            .map(|row| {
                let state = match row[5].as_str() {
                    "running" => MigrationState::Running,
                    "applied" => MigrationState::Applied,
                    "failed" => MigrationState::Failed,
                    value => return Err(format!("unknown migration state {value:?}")),
                };
                Ok(MigrationLedgerEntry {
                    migration_id: row[0].clone(),
                    attempt: row[1].parse().map_err(|error| format!("{error}"))?,
                    from_version: row[2].parse().map_err(|error| format!("{error}"))?,
                    to_version: row[3].parse().map_err(|error| format!("{error}"))?,
                    checksum: row[4].clone(),
                    state,
                    diagnostics_json: row[6].clone(),
                    failure_message: (!row[7].is_empty()).then(|| row[7].clone()),
                    started_at: row[8].clone(),
                    completed_at: (!row[9].is_empty()).then(|| row[9].clone()),
                })
            })
            .collect()
    }

    fn commit(&mut self) -> Result<(), Self::Error> {
        self.execute("COMMIT")
    }

    fn rollback(&mut self) -> Result<(), Self::Error> {
        self.execute("ROLLBACK")
    }

    fn now(&self) -> String {
        "2026-09-22T00:00:00Z".to_owned()
    }

    fn is_busy(&self, error: &Self::Error) -> bool {
        error.contains("lock is held")
    }
}

fn plan() -> MigrationPlan {
    let target_checksum = checksum(b"production schema v3");
    let step = migrations::MigrationStep::new(
        "work-item-2-to-3",
        2,
        3,
        "CREATE TABLE work_item_v3 (id TEXT PRIMARY KEY, title TEXT NOT NULL);
         INSERT INTO work_item_v3 (id, title) SELECT id, title FROM work_item;",
        "CREATE TEMP TABLE migration_precondition_work_item (sentinel INTEGER NOT NULL CHECK (sentinel = 1));
         INSERT INTO migration_precondition_work_item
           SELECT CASE WHEN EXISTS (SELECT 1 FROM work_item) THEN 1 ELSE 0 END;
         DROP TABLE migration_precondition_work_item;",
        "CREATE TEMP TABLE migration_verify_work_item_v3 (sentinel INTEGER NOT NULL CHECK (sentinel = 1));
         INSERT INTO migration_verify_work_item_v3
           SELECT CASE WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'work_item_v3') THEN 1 ELSE 0 END;
         DROP TABLE migration_verify_work_item_v3;",
        target_checksum.clone(),
    )
    .expect("test migration step is valid");
    MigrationPlan::new(
        "boreal.sqlite",
        "boreal.sqlite/3",
        3,
        target_checksum,
        "CREATE TABLE work_item (id TEXT PRIMARY KEY, title TEXT NOT NULL);
         CREATE TABLE attempt (id TEXT PRIMARY KEY, work_id TEXT NOT NULL, state TEXT NOT NULL);
         CREATE TABLE work_item_v3 (id TEXT PRIMARY KEY, title TEXT NOT NULL);
         INSERT INTO work_item (id, title) VALUES ('fresh-1', 'fresh work');
         INSERT INTO attempt (id, work_id, state) VALUES ('fresh-a-1', 'fresh-1', 'planned');
         INSERT INTO work_item_v3 (id, title) VALUES ('fresh-1', 'fresh work');
         PRAGMA user_version = 3;",
        "CREATE TEMP TABLE migration_verify_target (sentinel INTEGER NOT NULL CHECK (sentinel = 1));
         INSERT INTO migration_verify_target
           SELECT CASE WHEN EXISTS (SELECT 1 FROM work_item)
                    AND EXISTS (SELECT 1 FROM attempt)
                    AND EXISTS (SELECT 1 FROM work_item_v3)
                    THEN 1 ELSE 0 END;
         DROP TABLE migration_verify_target;",
        vec![step],
    )
    .with_supported_source_checksum(2, checksum(b"legacy schema v2"))
}

fn temp_database_path(label: &str) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock is after the unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!(
        "boreal-production-migrations-{label}-{}-{stamp}.sqlite",
        std::process::id()
    ))
}

fn remove_sqlite_files(path: &Path) {
    let _ = std::fs::remove_file(path);
    let _ = std::fs::remove_file(path.with_extension("sqlite-wal"));
    let _ = std::fs::remove_file(path.with_extension("sqlite-shm"));
}

fn install_v2_fixture(path: &Path) -> SqliteStore {
    install_v2_fixture_with_schema(path, SCHEMA_V2)
}

fn install_v2_fixture_with_schema(path: &Path, schema: &str) -> SqliteStore {
    let store = SqliteStore::open_for_migration(path).expect("fixture database opens");
    store
        .execute_batch(schema)
        .expect("raw schema-v2 fixture installs");
    store
        .execute_batch(
            "INSERT INTO acceptance_profile
                 (profile_id, version, policy_digest, definition_json, created_at)
             VALUES ('default', 1, 'sha256:policy', '{}', 't0');
             INSERT INTO project
                 (project_id, schema_version, status_contract_version, project_revision,
                  created_at, updated_at)
             VALUES ('p1', 2, 'boreal.work-status/2', 0, 't0', 't0');
             INSERT INTO actor
                 (actor_id, role, credential_ref, display_name, created_at)
             VALUES ('agent-1', 'agent', 'cred-agent', 'Agent', 't0');
             INSERT INTO work_item
                 (work_id, project_id, kind, lifecycle, dispatch_policy,
                  acceptance_profile_id, acceptance_profile_version, title,
                  description, created_at, updated_at)
             VALUES ('task-1', 'p1', 'task', 'open', 'automatic', 'default', 1,
                     'Legacy task', '', 't0', 't0');",
        )
        .expect("legacy rows install");
    store
}

fn historical_schema_v2_without_verifier_admission() -> String {
    SCHEMA_V2.replace(
        "'attempt.expired','evidence.verifier.admitted','expiry.resolved'",
        "'attempt.expired','expiry.resolved'",
    )
}

#[test]
fn historical_v2_audit_event_check_is_repaired_and_preserves_rows() {
    let path = temp_database_path("historical-audit-repair");
    let historical_schema = historical_schema_v2_without_verifier_admission();
    {
        let store = install_v2_fixture_with_schema(&path, &historical_schema);
        store
            .execute_batch(
                "INSERT INTO operation
                    (operation_id, project_id, command, actor_id, session_id,
                     expected_revision, attempt_id, fence, request_digest, outcome,
                     result_json, revision, created_at)
                 VALUES ('legacy-audit', 'p1', 'work.create', 'agent-1', NULL,
                         NULL, NULL, NULL, 'sha256:legacy', 'changed', '{}', 1, 't0');
                 INSERT INTO audit_event
                    (project_id, revision, operation_id, event_type, subject_type,
                     subject_id, actor_id, session_id, fence, as_of, payload_json)
                 VALUES ('p1', 1, 'legacy-audit', 'work.created', 'work', 'task-1',
                         'agent-1', NULL, NULL, 't0', '{}');",
            )
            .expect("historical audit row installs");
        drop(store);
    }

    let error = SqliteStore::open(&path, &historical_schema)
        .expect_err("ordinary open must not accept the incomplete historical contract");
    assert!(matches!(
        error,
        boreal_store::StoreError::Corrupt(message)
            if message.contains("audit_event CHECK")
    ));

    let store = SqliteStore::open_for_migration(&path).expect("historical database reopens");
    store
        .apply_schema(SCHEMA_V2)
        .expect("current v2 schema repairs historical audit constraint");
    assert!(store
        .audit_event("legacy-audit")
        .expect("preserved audit row reads")
        .is_some());

    store
        .execute_batch(
            "INSERT INTO operation
                (operation_id, project_id, command, actor_id, session_id,
                 expected_revision, attempt_id, fence, request_digest, outcome,
                 result_json, revision, created_at)
             VALUES ('verifier-audit', 'p1', 'evidence.verifier', 'agent-1', NULL,
                     NULL, NULL, NULL, 'sha256:verifier', 'busy', '{}', 2, 't1');
             INSERT INTO audit_event
                (project_id, revision, operation_id, event_type, subject_type,
                 subject_id, actor_id, session_id, fence, as_of, payload_json)
             VALUES ('p1', 2, 'verifier-audit', 'evidence.verifier.admitted',
                     'operation', 'verifier-audit', 'agent-1', NULL, NULL, 't1', '{}');",
        )
        .expect("repaired audit table accepts verifier admission");
    assert!(store
        .execute_batch(
            "UPDATE audit_event SET payload_json = 'changed' WHERE operation_id = 'legacy-audit';"
        )
        .is_err());

    drop(store);
    remove_sqlite_files(&path);
}

#[test]
fn historical_v2_audit_repair_rolls_back_with_failed_production_upgrade() {
    let path = temp_database_path("historical-audit-rollback");
    let historical_schema = historical_schema_v2_without_verifier_admission();
    {
        let store = install_v2_fixture_with_schema(&path, &historical_schema);
        store
            .execute_batch(
                "INSERT INTO operation
                    (operation_id, project_id, command, actor_id, session_id,
                     expected_revision, attempt_id, fence, request_digest, outcome,
                     result_json, revision, created_at)
                 VALUES ('rollback-audit', 'p1', 'evidence.verifier', 'agent-1', NULL,
                         NULL, NULL, NULL, 'sha256:rollback', 'busy', '{}', 1, 't0');
                 CREATE TABLE work_model_v3_meta (sentinel TEXT NOT NULL);",
            )
            .expect("rollback fixture installs");
        drop(store);
    }

    assert!(SqliteStore::open(&path, PRODUCTION_SCHEMA).is_err());

    let store = SqliteStore::open_for_migration(&path).expect("failed upgrade reopens");
    assert!(
        store
            .execute_batch(
                "INSERT INTO audit_event
                (project_id, revision, operation_id, event_type, subject_type,
                 subject_id, actor_id, session_id, fence, as_of, payload_json)
             VALUES ('p1', 1, 'rollback-audit', 'evidence.verifier.admitted',
                     'operation', 'rollback-audit', 'agent-1', NULL, NULL, 't1', '{}');",
            )
            .is_err(),
        "failed production upgrade must roll back the audit rebuild"
    );
    assert!(store
        .execute_batch("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'audit_event';")
        .is_ok());

    drop(store);
    remove_sqlite_files(&path);
}

fn install_v3_fixture(path: &Path) -> SqliteStore {
    let store = install_v2_fixture(path);
    store
        .execute_batch(SCHEMA_V3)
        .expect("raw schema-v3 extension installs");
    store
}

fn assert_applied_ledger_entry(
    entry: &boreal_store::MigrationLedgerEntry,
    migration_id: &str,
    from_version: i64,
    to_version: i64,
) {
    assert_eq!(entry.migration_id, migration_id);
    assert_eq!(entry.from_version, from_version);
    assert_eq!(entry.to_version, to_version);
    assert_eq!(entry.state, boreal_store::MigrationState::Applied);
    assert!(entry.checksum.starts_with("sha256:"));
    assert!(entry.completed_at.is_some());
}

#[test]
fn checksum_is_full_sha256_and_step_ledger_has_stable_identity() {
    assert_eq!(
        checksum(b"abc"),
        "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    let step = &plan().steps[0];
    assert_eq!(step.checksum.len(), "sha256:".len() + 64);
    assert_eq!(
        step.checksum,
        checksum(step.canonical_payload_for_test().as_bytes())
    );
}

#[test]
fn fresh_database_is_migrated_and_reopen_is_idempotent() {
    let db = TestDb::new();
    let mut runner = MigrationRunner::new(db, plan()).expect("plan validates");
    assert!(matches!(
        runner.apply().expect("fresh migration succeeds"),
        MigrationOutcome::Fresh {
            target_version: 3,
            ..
        }
    ));
    assert_eq!(runner.backend().scalar_i64("PRAGMA user_version"), 3);
    assert_eq!(
        runner
            .backend()
            .scalar_i64("SELECT COUNT(*) FROM work_item"),
        1
    );
    assert_eq!(
        runner.backend().scalar_i64("SELECT COUNT(*) FROM attempt"),
        1
    );
    assert!(runner.backend().table_exists(SCHEMA_IDENTITY_TABLE));

    let db = runner.into_backend();
    let mut reopen = MigrationRunner::new(db, plan()).expect("plan validates on reopen");
    assert_eq!(
        reopen.apply().expect("reopen succeeds"),
        MigrationOutcome::AlreadyCurrent { version: 3 }
    );
}

#[test]
fn upgrade_preserves_legacy_rows_and_retains_diagnostics() {
    let mut db = TestDb::new();
    db.create_v2_schema();
    db.legacy_diagnostics.push(MigrationDiagnostic::retained(
        "legacy_value_preserved",
        "work_item",
        "w-1",
        "legacy row remains readable",
        "{\"source\":\"v2\"}",
    ));
    let mut runner = MigrationRunner::new(db, plan()).expect("plan validates");
    assert!(matches!(
        runner.apply().expect("upgrade succeeds"),
        MigrationOutcome::Upgraded {
            from_version: 2,
            to_version: 3,
            ..
        }
    ));
    assert_eq!(runner.backend().scalar_i64("PRAGMA user_version"), 3);
    assert_eq!(
        runner
            .backend()
            .scalar_i64("SELECT COUNT(*) FROM work_item WHERE id = 'w-1'"),
        1
    );
    assert_eq!(
        runner
            .backend()
            .scalar_i64("SELECT COUNT(*) FROM attempt WHERE id = 'a-1'"),
        1
    );
    assert_eq!(
        runner.backend().scalar_i64(&format!(
            "SELECT COUNT(*) FROM {MIGRATION_DIAGNOSTIC_TABLE}"
        )),
        1
    );
}

#[test]
fn live_attempt_blocks_without_creating_or_mutating_migration_state() {
    let mut db = TestDb::new();
    db.create_v2_schema();
    db.live_diagnostics.push(MigrationDiagnostic::blocking(
        "live_attempt_blocks_migration",
        "work",
        "w-1",
        "accepted attempt is still live",
    ));
    let mut runner = MigrationRunner::new(db, plan()).expect("plan validates");
    let error = runner.apply().expect_err("live work blocks migration");
    assert!(matches!(error, MigrationError::PreflightBlocked { .. }));
    assert_eq!(runner.backend().scalar_i64("PRAGMA user_version"), 2);
    assert!(!runner.backend().table_exists(MIGRATION_LEDGER_TABLE));
}

#[test]
fn unsupported_newer_schema_is_rejected_before_writes() {
    let db = TestDb::new();
    db.raw_execute("CREATE TABLE unrelated (id INTEGER PRIMARY KEY); PRAGMA user_version = 4;");
    let mut runner = MigrationRunner::new(db, plan()).expect("plan validates");
    let error = runner.apply().expect_err("newer schema is unsupported");
    assert_eq!(
        error,
        MigrationError::UnsupportedNewer {
            found: 4,
            supported: 3
        }
    );
    assert!(!runner.backend().table_exists(MIGRATION_LEDGER_TABLE));
    assert!(!runner.backend().table_exists(SCHEMA_IDENTITY_TABLE));
}

#[test]
fn failed_step_rolls_back_schema_and_retains_failure_for_retry() {
    let mut db = TestDb::new();
    db.create_v2_schema();
    db.set_failure_marker(Some("CREATE TABLE work_item_v3"));
    let mut runner = MigrationRunner::new(db, plan()).expect("plan validates");
    let error = runner
        .apply()
        .expect_err("injected migration failure is reported");
    assert!(matches!(
        error,
        MigrationError::Backend(_) | MigrationError::RecoveryRequired { .. }
    ));
    assert_eq!(runner.backend().scalar_i64("PRAGMA user_version"), 2);
    assert!(!runner.backend().table_exists("work_item_v3"));
    assert_eq!(
        runner.backend().ledger_state("work-item-2-to-3", 1),
        "failed"
    );

    runner.backend_mut().set_failure_marker(None);
    assert!(matches!(
        runner.apply().expect("failed migration can be retried"),
        MigrationOutcome::Upgraded { .. }
    ));
    assert_eq!(runner.backend().scalar_i64("PRAGMA user_version"), 3);
    assert_eq!(
        runner.backend().ledger_state("work-item-2-to-3", 1),
        "failed"
    );
    assert_eq!(
        runner.backend().ledger_state("work-item-2-to-3", 2),
        "applied"
    );
}

#[test]
fn interrupted_running_attempt_is_resumed_without_a_new_attempt() {
    let db = TestDb::new();
    db.create_v2_schema();
    let migration_plan = plan();
    db.install_running_entry(&migration_plan.steps[0].checksum);
    let mut runner = MigrationRunner::new(db, migration_plan).expect("plan validates");
    assert!(matches!(
        runner.apply().expect("running migration resumes"),
        MigrationOutcome::Upgraded { .. }
    ));
    assert_eq!(
        runner.backend().ledger_state("work-item-2-to-3", 1),
        "applied"
    );
    assert_eq!(
        runner
            .backend()
            .scalar_i64("SELECT COUNT(*) FROM boreal_migration_ledger"),
        1
    );
}

#[test]
fn migration_lock_is_exclusionary_and_never_force_broken() {
    let db = TestDb::new();
    let lock = Arc::clone(&db.migration_lock);
    *lock.lock().expect("test lock is healthy") = true;
    let mut runner = MigrationRunner::new(db, plan()).expect("plan validates");
    let error = runner
        .apply()
        .expect_err("held migration lock blocks second service");
    assert!(matches!(error, MigrationError::Busy(_)));
    assert_eq!(runner.backend().scalar_i64("PRAGMA user_version"), 0);
    assert!(*lock.lock().expect("test lock is healthy"));
}

#[test]
fn current_schema_rejects_tampered_ledger_checksum() {
    let db = TestDb::new();
    db.create_v2_schema();
    let mut runner = MigrationRunner::new(db, plan()).expect("plan validates");
    runner.apply().expect("upgrade succeeds");
    runner.backend().raw_execute(&format!(
        "UPDATE {MIGRATION_LEDGER_TABLE} SET checksum = 'sha256:tampered'
         WHERE migration_id = 'work-item-2-to-3' AND attempt = 1"
    ));
    let error = runner.apply().expect_err("tampered ledger is rejected");
    assert!(matches!(error, MigrationError::LedgerMismatch(_)));
}

#[test]
fn integrated_fresh_production_open_reads_identity_checksum_and_bootstrap_ledger() {
    let store = SqliteStore::open_in_memory(PRODUCTION_SCHEMA)
        .expect("canonical production schema opens through SqliteStore");
    let mut adapter = &store;
    let identity = adapter
        .schema_identity()
        .expect("production identity reads back");
    let ledger = adapter.read_ledger().expect("production ledger reads back");

    assert_eq!(identity.schema_id, "boreal.sqlite");
    assert_eq!(identity.schema_version, 3);
    assert_eq!(identity.contract_version, "boreal.work-model/3");
    assert_eq!(
        identity.schema_checksum.as_deref(),
        Some(checksum(PRODUCTION_SCHEMA.as_bytes()).as_str())
    );
    assert_eq!(
        ledger.len(),
        1,
        "fresh production has one exact route entry"
    );
    assert_applied_ledger_entry(&ledger[0], "bootstrap-v3", 0, 3);
    assert_eq!(ledger[0].diagnostics_json, "[]");
}

#[test]
fn integrated_v2_production_open_reads_upgrade_identity_checksum_and_ledger() {
    let path = temp_database_path("integrated-upgrade");
    {
        let store = install_v2_fixture(&path);
        drop(store);
    }

    let store = SqliteStore::open(&path, PRODUCTION_SCHEMA)
        .expect("canonical production open upgrades schema-v2");
    assert_eq!(store.project_for_work("task-1").unwrap(), "p1");
    let mut adapter = &store;
    let identity = adapter
        .schema_identity()
        .expect("upgraded production identity reads back");
    let ledger = adapter
        .read_ledger()
        .expect("upgraded production ledger reads back");

    assert_eq!(identity.schema_version, 3);
    assert_eq!(
        identity.schema_checksum.as_deref(),
        Some(checksum(PRODUCTION_SCHEMA.as_bytes()).as_str())
    );
    assert_eq!(
        ledger.len(),
        1,
        "v2-to-v3 production has one exact route entry"
    );
    assert_applied_ledger_entry(&ledger[0], "work-model-2-to-3", 2, 3);
    drop(store);
    remove_sqlite_files(&path);
}

#[test]
fn integrated_production_open_rejects_unsupported_newer_schema_before_metadata_writes() {
    let path = temp_database_path("newer");
    {
        let store = SqliteStore::open_for_migration(&path).expect("fixture database opens");
        store
            .execute_batch("PRAGMA user_version = 4;")
            .expect("newer-version fixture installs");
    }

    let error = SqliteStore::open(&path, PRODUCTION_SCHEMA)
        .expect_err("canonical production open rejects a newer schema");
    assert_eq!(error, StoreError::UnsupportedSchema { found: 4 });
    remove_sqlite_files(&path);
}

#[test]
fn integrated_canonical_open_rejects_live_attempt_before_v2_repair_or_production_metadata() {
    let path = temp_database_path("live-attempt");
    {
        let store = install_v2_fixture(&path);
        store
            .execute_batch(
                "INSERT INTO attempt
                    (attempt_id, work_id, actor_id, harness_id, fence, current, state,
                     claimed_at, accepted_at, lease_deadline, max_attempt_deadline,
                     config_identity, binary_identity, protocol_version, schema_version)
                 VALUES ('attempt-live', 'task-1', 'agent-1', 'test-harness', 1, 1,
                         'accepted', 't0', 't0', 't2', 't3', 'config', 'binary',
                         'protocol', 2);",
            )
            .expect("live attempt fixture installs");
        drop(store);
    }

    let error = SqliteStore::open(&path, PRODUCTION_SCHEMA)
        .expect_err("canonical production open rejects a live attempt");
    match error {
        StoreError::Conflict(message) => {
            assert!(message.contains("live_attempt_blocks_migration"));
        }
        other => panic!("expected typed live-attempt conflict, found {other:?}"),
    }

    let inspect = SqliteStore::open_for_migration(&path).expect("reopen rejected fixture");
    assert_eq!(inspect.schema_version().unwrap(), 2);
    let mut adapter = &inspect;
    let identity = adapter
        .schema_identity()
        .expect("legacy identity remains readable");
    assert_eq!(identity.schema_version, 2);
    assert_eq!(
        identity.schema_checksum.as_deref(),
        Some(checksum(SCHEMA_V2.as_bytes()).as_str())
    );
    assert!(
        adapter
            .read_ledger()
            .expect("production ledger remains absent")
            .is_empty(),
        "live-attempt rejection happens before production metadata writes"
    );
    drop(inspect);
    remove_sqlite_files(&path);
}

#[test]
fn integrated_production_failure_rolls_back_target_schema_and_retains_failed_ledger() {
    let path = temp_database_path("rollback");
    {
        let store = install_v2_fixture(&path);
        store
            .execute_batch("CREATE TABLE work_model_v3_meta (sentinel TEXT NOT NULL);")
            .expect("conflicting v3 object installs");
        drop(store);
    }

    let error = SqliteStore::open(&path, PRODUCTION_SCHEMA)
        .expect_err("conflicting production migration fails");
    assert!(matches!(
        error,
        StoreError::Invalid(_) | StoreError::Corrupt(_)
    ));

    let inspect = SqliteStore::open_for_migration(&path).expect("reopen failed migration fixture");
    assert_eq!(inspect.schema_version().unwrap(), 2);
    let mut adapter = &inspect;
    let identity = adapter
        .schema_identity()
        .expect("failed migration leaves legacy identity readable");
    assert_eq!(identity.schema_version, 2);
    let ledger = adapter
        .read_ledger()
        .expect("failed production ledger reads back");
    assert_eq!(ledger.len(), 1);
    assert_eq!(ledger[0].migration_id, "work-model-2-to-3");
    assert_eq!(ledger[0].from_version, 2);
    assert_eq!(ledger[0].to_version, 3);
    assert_eq!(ledger[0].state, boreal_store::MigrationState::Failed);
    assert!(ledger[0].failure_message.is_some());
    assert!(ledger[0].completed_at.is_some());
    drop(inspect);
    remove_sqlite_files(&path);
}

#[test]
fn integrated_legacy_v3_reopen_repairs_metadata_identity_and_ledger_without_losing_rows() {
    let path = temp_database_path("legacy-v3");
    {
        let store = install_v3_fixture(&path);
        drop(store);
    }

    let store = SqliteStore::open(&path, PRODUCTION_SCHEMA)
        .expect("canonical reopen repairs legacy v3 production metadata");
    assert_eq!(store.project_for_work("task-1").unwrap(), "p1");
    let mut adapter = &store;
    let identity = adapter
        .schema_identity()
        .expect("repaired legacy-v3 identity reads back");
    let ledger = adapter
        .read_ledger()
        .expect("repaired legacy-v3 ledger reads back");

    assert_eq!(identity.schema_version, 3);
    assert_eq!(identity.contract_version, "boreal.work-model/3");
    assert_eq!(
        identity.schema_checksum.as_deref(),
        Some(checksum(PRODUCTION_SCHEMA.as_bytes()).as_str())
    );
    assert_eq!(ledger.len(), 1);
    assert_applied_ledger_entry(&ledger[0], "bootstrap-v3", 0, 3);

    drop(store);
    remove_sqlite_files(&path);
}

#[test]
fn integrated_legacy_v3_partial_metadata_is_rejected_without_repair() {
    let path = temp_database_path("legacy-v3-partial");
    {
        let store = install_v3_fixture(&path);
        store
            .execute_batch("CREATE TABLE boreal_schema_identity (identity_id INTEGER PRIMARY KEY);")
            .expect("partial production metadata fixture installs");
        drop(store);
    }

    let error = SqliteStore::open(&path, PRODUCTION_SCHEMA)
        .expect_err("canonical reopen rejects partial production metadata");
    match error {
        StoreError::Corrupt(message) => assert!(message.contains("partially provisioned")),
        other => panic!("expected typed partial-metadata corruption, found {other:?}"),
    }

    let inspect = SqliteStore::open_for_migration(&path).expect("reopen partial fixture");
    assert_eq!(inspect.schema_version().unwrap(), 3);
    let mut adapter = &inspect;
    assert!(adapter.read_ledger().unwrap().is_empty());
    drop(inspect);
    remove_sqlite_files(&path);
}

trait CanonicalPayloadForTest {
    fn canonical_payload_for_test(&self) -> String;
}

impl CanonicalPayloadForTest for migrations::MigrationStep {
    fn canonical_payload_for_test(&self) -> String {
        format!(
            "{}\n{}\n{}\n{}\n{}\n{}",
            self.migration_id,
            self.from_version,
            self.to_version,
            migrations::normalize_sql(&self.migration_sql),
            migrations::normalize_sql(&self.precondition_sql),
            migrations::normalize_sql(&self.verify_sql),
        )
    }
}
