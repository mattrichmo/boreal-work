//! SQLite persistence boundary for Boreal v2.
//!
//! This crate owns database setup, transactions, revisions, and immutable
//! persistence primitives. It deliberately does not decide lifecycle status;
//! that belongs to the domain/application layer.

use boreal_domain::work_model_v3::WorkSchedule;
use boreal_domain::{
    AcceptanceProfile, AttemptPhase, BlockingDependency, DependencyPolicy, DispatchPolicy,
    GateKind, GateRequirement, GateState, PersistedLifecycle, ProfileId, ProjectId, ReasonCode,
    Reservation, TimestampMs, WorkId, WorkItem, WorkKind,
};
use serde_json::{json, Value};
use std::borrow::Borrow;
use std::collections::{BTreeMap, BTreeSet};
use std::ffi::{CStr, CString, NulError};
use std::fmt;
use std::fmt::Write as _;
use std::fs;
use std::os::raw::{c_char, c_int, c_void};
use std::path::{Path, PathBuf};
use std::ptr;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use profiles::{PinnedRequirements, ProfileStore, ProfileVersion, RequirementSubjectKind};

pub mod acceptance;
pub mod execution;
pub mod identity;
pub mod jobs;
mod knowledge;
mod migrations;
pub mod operations;
pub mod profiles;
pub mod recovery;
mod status_evaluation;
pub mod transactions;
mod work_model_v3;
pub use knowledge::*;
pub use migrations::{
    checksum, MigrationBackend, MigrationDiagnostic, MigrationError, MigrationLedgerEntry,
    MigrationOutcome, MigrationPlan, MigrationRunner, MigrationState, MigrationStep,
    SchemaIdentity, MIGRATION_DIAGNOSTIC_TABLE, MIGRATION_LEDGER_TABLE, SCHEMA_IDENTITY_TABLE,
};
pub use work_model_v3::*;

pub const SCHEMA_VERSION: i64 = 2;
/// The additive hierarchy/intake extension is versioned independently from
/// the original work-status schema.  The v2 tables remain canonical for
/// compatibility; v3 tables are an opt-in projection until callers request
/// the extension explicitly.
pub const WORK_MODEL_SCHEMA_VERSION: i64 = 3;
pub const STATUS_CONTRACT_VERSION: &str = "boreal.work-status/2";
pub const PRODUCTION_SCHEMA_ID: &str = "boreal.sqlite";
pub const PRODUCTION_SCHEMA_CONTRACT_VERSION: &str = "boreal.work-model/3";
const MISSING_VERIFIER_AUDIT_EVENT: &str =
    "schema version 2 audit_event CHECK is missing evidence.verifier.admitted";
const MISSING_CLOSE_COMPLETED_AUDIT_EVENT: &str =
    "schema version 2 audit_event CHECK is missing close.completed";

const PRODUCTION_SCHEMA_SQL: &str = include_str!("../../../project/spec/schema-production.sql");
const LEGACY_SCHEMA_V2_SQL: &str = include_str!("../../../project/spec/schema-v2.sql");
const WORK_MODEL_SCHEMA_V3_SQL: &str = include_str!("../../../project/spec/schema-v3.sql");
const BACKUP_MANIFEST_FILE: &str = "manifest.json";
const BACKUP_DATABASE_FILE: &str = "database.sqlite";
const BACKUP_FORMAT_VERSION: u64 = 1;
const BACKUP_PACKAGE_KIND: &str = "boreal.sqlite.backup";

const PRODUCTION_EXTERNAL_JOB_IDENTITY_TRIGGER_SQL: &str = r#"
CREATE TRIGGER IF NOT EXISTS boreal_external_job_identity_guard
BEFORE UPDATE OF job_id, operation_id, project_id, subject_type, subject_id,
  kind, request_digest, source_identity, config_identity, actor_id,
  session_id, deadline, created_at ON boreal_external_job
BEGIN SELECT RAISE(ABORT, 'external_job_identity_append_only'); END;
"#;

const PRODUCTION_VERIFY_SQL: &str = r#"
CREATE TEMP TABLE boreal_production_verify (sentinel INTEGER NOT NULL CHECK (sentinel = 1));
INSERT INTO boreal_production_verify
  SELECT CASE WHEN
    (SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'project') = 1
    AND (SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'attempt') = 1
    AND (SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'work_model_v3_meta') = 1
    AND (SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'work_node_v3') = 1
    AND (SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'cycle_v3') = 1
    AND (SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'intake_item_v3') = 1
    AND (SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'container_disposition_v3') = 1
    THEN 1 ELSE 0 END;
DROP TABLE boreal_production_verify;
"#;

const PRODUCTION_METADATA_SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS boreal_migration_ledger (
  migration_id TEXT NOT NULL,
  attempt INTEGER NOT NULL CHECK (attempt > 0),
  from_version INTEGER NOT NULL CHECK (from_version >= 0),
  to_version INTEGER NOT NULL CHECK (to_version > from_version),
  checksum TEXT NOT NULL CHECK (trim(checksum) <> ''),
  state TEXT NOT NULL CHECK (state IN ('running','applied','failed')),
  diagnostics_json TEXT NOT NULL DEFAULT '[]',
  failure_message TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY (migration_id, attempt),
  CHECK (state = 'running' OR completed_at IS NOT NULL),
  CHECK (state <> 'failed' OR failure_message IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS boreal_migration_ledger_latest
  ON boreal_migration_ledger(migration_id, attempt DESC);

CREATE TABLE IF NOT EXISTS boreal_migration_diagnostic (
  diagnostic_id INTEGER PRIMARY KEY AUTOINCREMENT,
  migration_id TEXT NOT NULL,
  attempt INTEGER NOT NULL CHECK (attempt > 0),
  code TEXT NOT NULL CHECK (trim(code) <> ''),
  entity_type TEXT NOT NULL CHECK (trim(entity_type) <> ''),
  entity_id TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL CHECK (trim(message) <> ''),
  blocking INTEGER NOT NULL CHECK (blocking IN (0,1)),
  raw_payload TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE (migration_id, attempt, code, entity_type, entity_id, raw_payload)
);
CREATE INDEX IF NOT EXISTS boreal_migration_diagnostic_subject
  ON boreal_migration_diagnostic(migration_id, entity_type, entity_id);

CREATE TABLE IF NOT EXISTS boreal_schema_identity (
  identity_id INTEGER PRIMARY KEY CHECK (identity_id = 1),
  schema_id TEXT NOT NULL CHECK (trim(schema_id) <> ''),
  schema_version INTEGER NOT NULL CHECK (schema_version >= 0),
  contract_version TEXT NOT NULL CHECK (trim(contract_version) <> ''),
  schema_checksum TEXT NOT NULL CHECK (trim(schema_checksum) <> ''),
  updated_at TEXT NOT NULL
);
"#;

const CREATE_WORK_HOLD_TABLE: &str = r#"
CREATE TABLE IF NOT EXISTS work_hold (
  hold_id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL REFERENCES work_item(work_id),
  reason_code TEXT NOT NULL CHECK (trim(reason_code) <> ''),
  actor_id TEXT REFERENCES actor(actor_id),
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by TEXT REFERENCES actor(actor_id),
  resolution_reason TEXT,
  CHECK (resolved_at IS NULL OR resolved_by IS NOT NULL),
  CHECK (resolved_at IS NULL OR resolution_reason IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS work_hold_active ON work_hold(work_id)
  WHERE resolved_at IS NULL;
"#;

const CREATE_EVIDENCE_EXECUTION_TABLE: &str = r#"
CREATE TABLE IF NOT EXISTS evidence_execution (
  operation_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(project_id),
  work_id TEXT NOT NULL REFERENCES work_item(work_id),
  attempt_id TEXT NOT NULL REFERENCES attempt(attempt_id),
  fence INTEGER NOT NULL CHECK (fence > 0),
  gate_id TEXT NOT NULL REFERENCES gate(gate_id),
  actor_id TEXT NOT NULL REFERENCES actor(actor_id),
  session_id TEXT REFERENCES session(session_id),
  request_digest TEXT NOT NULL,
  artifact_ref TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('admitted','running','exited','receipt_committed','unknown')),
  admitted_at TEXT NOT NULL,
  started_at TEXT,
  exited_at TEXT,
  exit_code INTEGER,
  receipt_id TEXT REFERENCES receipt(receipt_id),
  failure_code TEXT,
  FOREIGN KEY (work_id, fence) REFERENCES attempt(work_id, fence),
  CHECK (state <> 'running' OR started_at IS NOT NULL),
  CHECK (state NOT IN ('exited','receipt_committed') OR exited_at IS NOT NULL),
  CHECK (state <> 'receipt_committed' OR receipt_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS evidence_execution_subject
  ON evidence_execution(work_id, attempt_id, fence, state);
"#;

const REPAIR_SCHEMA_TRIGGERS: &str = r#"
DROP TRIGGER IF EXISTS work_parent_retype_guard;
CREATE TRIGGER work_parent_retype_guard BEFORE UPDATE OF kind ON work_item
WHEN EXISTS (
  SELECT 1 FROM work_item child
  WHERE child.project_id = NEW.project_id
    AND child.parent_id = NEW.work_id
    AND NOT (
      (NEW.kind = 'milestone' AND child.kind = 'sprint')
      OR (NEW.kind = 'sprint' AND child.kind = 'task')
    )
)
BEGIN
  SELECT RAISE(ABORT, 'invalid_parent_kind');
END;

DROP TRIGGER IF EXISTS dependency_no_cycle;
CREATE TRIGGER dependency_no_cycle BEFORE INSERT ON dependency
WHEN EXISTS (
  WITH RECURSIVE reachable(work_id) AS (
    SELECT NEW.dependent_id
    UNION
    SELECT d.dependent_id
    FROM dependency d
    JOIN reachable r ON r.work_id = d.prerequisite_id
    WHERE d.project_id = NEW.project_id
  )
  SELECT 1 FROM reachable WHERE work_id = NEW.prerequisite_id
)
BEGIN
  SELECT RAISE(ABORT, 'dependency_cycle');
END;
"#;

const REPAIR_AUDIT_EVENT_VERIFIER_CHECK: &str = r#"
DROP TRIGGER IF EXISTS audit_append_only_update;
DROP TRIGGER IF EXISTS audit_append_only_delete;
DROP INDEX IF EXISTS audit_revision;
CREATE TABLE audit_event_repair (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES project(project_id),
  revision INTEGER NOT NULL CHECK (revision > 0),
  operation_id TEXT NOT NULL UNIQUE REFERENCES operation(operation_id),
  event_type TEXT NOT NULL CHECK (event_type IN ('work.created','work.published','work.closed','work.blocked','work.paused','work.resumed','work.cancelled','work.reopened','attempt.claimed','attempt.accepted','attempt.started','attempt.submitted','attempt.released','attempt.failed','attempt.expiry_pending','attempt.expired','evidence.verifier.admitted','expiry.resolved','lease.renewed','receipt.recorded','receipt.rejected','review.accepted','review.rejected','close.requested','close.completed','gate.satisfied','hold.resolved','repair.correction','repair.supersession')),
  subject_type TEXT NOT NULL CHECK (subject_type IN ('work','attempt','receipt','review','gate','hold','dependency','summary','operation','project')),
  subject_id TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES actor(actor_id),
  session_id TEXT REFERENCES session(session_id),
  fence INTEGER CHECK (fence IS NULL OR fence > 0),
  as_of TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  UNIQUE (project_id, revision)
);
INSERT INTO audit_event_repair (
  event_id, project_id, revision, operation_id, event_type, subject_type,
  subject_id, actor_id, session_id, fence, as_of, payload_json
)
SELECT event_id, project_id, revision, operation_id, event_type, subject_type,
       subject_id, actor_id, session_id, fence, as_of, payload_json
FROM audit_event;
DROP TABLE audit_event;
ALTER TABLE audit_event_repair RENAME TO audit_event;
CREATE INDEX audit_revision ON audit_event(project_id, revision);
CREATE TRIGGER audit_append_only_update BEFORE UPDATE ON audit_event BEGIN
  SELECT RAISE(ABORT, 'audit_append_only');
END;
CREATE TRIGGER audit_append_only_delete BEFORE DELETE ON audit_event BEGIN
  SELECT RAISE(ABORT, 'audit_append_only');
END;
"#;

const SQLITE_OK: c_int = 0;
const SQLITE_ERROR: c_int = 1;
const SQLITE_BUSY: c_int = 5;
const SQLITE_LOCKED: c_int = 6;
const SQLITE_CONSTRAINT: c_int = 19;
const SQLITE_IOERR: c_int = 10;
const SQLITE_CANTOPEN: c_int = 14;
const SQLITE_NOTADB: c_int = 26;
const SQLITE_ROW: c_int = 100;
const SQLITE_DONE: c_int = 101;
const SQLITE_NULL: c_int = 5;
const SQLITE_OPEN_READWRITE: c_int = 0x0000_0002;
const SQLITE_OPEN_CREATE: c_int = 0x0000_0004;
const SQLITE_OPEN_READONLY: c_int = 0x0000_0001;
const SQLITE_OPEN_FULLMUTEX: c_int = 0x0001_0000;

#[allow(non_camel_case_types)]
type sqlite3 = c_void;
#[allow(non_camel_case_types)]
type sqlite3_stmt = c_void;
#[allow(non_camel_case_types)]
type sqlite3_backup = c_void;
type SqliteDestructor = unsafe extern "C" fn(*mut c_void);

// SQLite is a system library on the supported desktop platforms. Keeping this
// tiny FFI local avoids adding a network-fetched crate to the v2 bootstrap.
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
    fn sqlite3_libversion() -> *const c_char;
    fn sqlite3_sourceid() -> *const c_char;
    fn sqlite3_compileoption_get(index: c_int) -> *const c_char;
    fn sqlite3_busy_timeout(database: *mut sqlite3, milliseconds: c_int) -> c_int;
    fn sqlite3_exec(
        database: *mut sqlite3,
        sql: *const c_char,
        callback: Option<
            unsafe extern "C" fn(*mut c_void, c_int, *mut *mut c_char, *mut *mut c_char) -> c_int,
        >,
        argument: *mut c_void,
        error: *mut *mut c_char,
    ) -> c_int;
    fn sqlite3_free(pointer: *mut c_void);
    fn sqlite3_prepare_v2(
        database: *mut sqlite3,
        sql: *const c_char,
        length: c_int,
        statement: *mut *mut sqlite3_stmt,
        tail: *mut *const c_char,
    ) -> c_int;
    fn sqlite3_finalize(statement: *mut sqlite3_stmt) -> c_int;
    fn sqlite3_step(statement: *mut sqlite3_stmt) -> c_int;
    fn sqlite3_bind_text(
        statement: *mut sqlite3_stmt,
        index: c_int,
        value: *const c_char,
        length: c_int,
        destructor: Option<SqliteDestructor>,
    ) -> c_int;
    fn sqlite3_bind_int64(statement: *mut sqlite3_stmt, index: c_int, value: i64) -> c_int;
    fn sqlite3_bind_null(statement: *mut sqlite3_stmt, index: c_int) -> c_int;
    fn sqlite3_changes(database: *mut sqlite3) -> c_int;
    fn sqlite3_column_int64(statement: *mut sqlite3_stmt, index: c_int) -> i64;
    fn sqlite3_column_type(statement: *mut sqlite3_stmt, index: c_int) -> c_int;
    fn sqlite3_column_text(statement: *mut sqlite3_stmt, index: c_int) -> *const u8;
    fn sqlite3_backup_init(
        destination: *mut sqlite3,
        destination_name: *const c_char,
        source: *mut sqlite3,
        source_name: *const c_char,
    ) -> *mut sqlite3_backup;
    fn sqlite3_backup_step(backup: *mut sqlite3_backup, pages: c_int) -> c_int;
    fn sqlite3_backup_finish(backup: *mut sqlite3_backup) -> c_int;
    fn sqlite3_backup_remaining(backup: *mut sqlite3_backup) -> c_int;
    fn sqlite3_backup_pagecount(backup: *mut sqlite3_backup) -> c_int;
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ConstraintKind {
    ForeignKey,
    Unique,
    AppendOnly,
    SelfReview,
    Check,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum StoreError {
    Unavailable(String),
    Busy(String),
    Invalid(String),
    Conflict(String),
    StaleRevision {
        expected: u64,
        actual: u64,
    },
    StaleFence {
        expected: u64,
        actual: u64,
    },
    LeaseExpired,
    HardDeadlineElapsed,
    NotCurrent {
        attempt_id: String,
    },
    WrongSubject {
        expected: String,
        actual: String,
    },
    WrongOwner {
        expected: String,
        actual: String,
    },
    IllegalTransition {
        from: AttemptPhase,
        operation: &'static str,
    },
    NotExpired,
    StopConfirmationRequired,
    Constraint {
        kind: ConstraintKind,
        message: String,
    },
    NotFound {
        entity: &'static str,
        id: String,
    },
    UnsupportedSchema {
        found: i64,
    },
    Corrupt(String),
}

impl fmt::Display for StoreError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unavailable(message)
            | Self::Busy(message)
            | Self::Invalid(message)
            | Self::Conflict(message)
            | Self::Corrupt(message) => formatter.write_str(message),
            Self::StaleRevision { expected, actual } => {
                write!(
                    formatter,
                    "stale revision: expected {expected}, actual {actual}"
                )
            }
            Self::StaleFence { expected, actual } => {
                write!(
                    formatter,
                    "stale fence: expected {expected}, actual {actual}"
                )
            }
            Self::LeaseExpired => formatter.write_str("lease expired"),
            Self::HardDeadlineElapsed => formatter.write_str("hard attempt deadline elapsed"),
            Self::NotCurrent { attempt_id } => {
                write!(formatter, "attempt is not current: {attempt_id}")
            }
            Self::WrongSubject { expected, actual } => {
                write!(
                    formatter,
                    "attempt subject mismatch: expected {expected}, actual {actual}"
                )
            }
            Self::WrongOwner { expected, actual } => {
                write!(
                    formatter,
                    "attempt owner mismatch: expected {expected}, actual {actual}"
                )
            }
            Self::IllegalTransition { from, operation } => {
                write!(
                    formatter,
                    "illegal attempt transition from {from:?}: {operation}"
                )
            }
            Self::NotExpired => formatter.write_str("attempt has not expired"),
            Self::StopConfirmationRequired => formatter.write_str("stop confirmation is required"),
            Self::Constraint { kind, message } => write!(formatter, "{kind:?}: {message}"),
            Self::NotFound { entity, id } => write!(formatter, "{entity} not found: {id}"),
            Self::UnsupportedSchema { found } => {
                write!(formatter, "unsupported SQLite schema version: {found}")
            }
        }
    }
}

impl std::error::Error for StoreError {}

impl From<NulError> for StoreError {
    fn from(error: NulError) -> Self {
        Self::Invalid(format!("SQLite input contains NUL: {error}"))
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OperationOutcome {
    Changed,
    Unchanged,
    Rejected,
    Conflict,
    Busy,
    Failed,
    Unknown,
}

impl OperationOutcome {
    fn as_str(self) -> &'static str {
        match self {
            Self::Changed => "changed",
            Self::Unchanged => "unchanged",
            Self::Rejected => "rejected",
            Self::Conflict => "conflict",
            Self::Busy => "busy",
            Self::Failed => "failed",
            Self::Unknown => "unknown",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OperationRecord {
    pub operation_id: String,
    pub project_id: String,
    pub command: String,
    pub actor_id: String,
    pub session_id: Option<String>,
    pub expected_revision: Option<u64>,
    pub attempt_id: Option<String>,
    pub fence: Option<u64>,
    pub request_digest: String,
    pub outcome: OperationOutcome,
    pub result_json: String,
    pub revision: u64,
    pub created_at: String,
    pub completed_at: Option<String>,
}

/// A project-scoped operation readback. Evidence executions are durable
/// sidecars and may exist before their parent operation row, so both records
/// are independently checked before being returned.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OperationReadback {
    pub operation: Option<OperationRecord>,
    pub execution: Option<EvidenceExecutionRecord>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuditEventRecord {
    pub project_id: String,
    pub revision: u64,
    pub operation_id: String,
    pub event_type: String,
    pub subject_type: String,
    pub subject_id: String,
    pub actor_id: String,
    pub session_id: Option<String>,
    pub fence: Option<u64>,
    pub as_of: String,
    pub payload_json: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClaimResult {
    pub operation_id: String,
    pub attempt_id: String,
    pub fence: u64,
    pub revision: u64,
    pub replayed: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkRecord {
    pub work_id: String,
    pub project_id: String,
    pub kind: String,
    pub parent_id: Option<String>,
    pub lifecycle: String,
    pub dispatch_policy: String,
    pub priority: u8,
    pub hard_holds: Vec<ReasonCode>,
    pub title: String,
    pub description: String,
}

/// Fields accepted by the revision-checked planning edit mutation. `None`
/// means leave a field unchanged; `Some(None)` clears the parent.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkEditInput {
    pub project_id: String,
    pub work_id: String,
    pub parent_id: Option<Option<String>>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub priority: Option<u8>,
    pub dispatch_policy: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkHoldAddInput {
    pub project_id: String,
    pub work_id: String,
    pub reason_code: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkHoldRecord {
    pub hold_id: String,
    pub work_id: String,
    pub reason_code: String,
    pub actor_id: Option<String>,
    pub created_at: String,
    pub resolved_at: Option<String>,
    pub resolved_by: Option<String>,
    pub resolution_reason: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkPage {
    pub revision: SnapshotRevision,
    pub total: u64,
    pub items: Vec<WorkRecord>,
}

/// Canonical, read-only rows required by the application status projection.
///
/// The store returns all rows under one read transaction. The application can
/// then derive statuses and paginate without losing dependency context or
/// changing the project total reported by the snapshot.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StatusWorkRecord {
    pub work: WorkItem,
    pub retry_not_before: Option<String>,
    /// Canonical work schedule when a persisted schedule projection is
    /// available. Retry timing is deliberately not converted into a work
    /// schedule.
    pub schedule: Option<WorkSchedule>,
    /// Earliest live cycle-assignment activation instant for this work, when
    /// the v3 planning projection provides one.
    pub activation_at: Option<TimestampMs>,
    pub current_attempt: Option<AttemptRecord>,
    pub gate_diagnostics: GateDiagnostics,
}

/// A bounded, read-only diagnostic for a canonical work row that could not be
/// decoded into the domain model. The row is kept out of lifecycle decisions,
/// but remains visible to callers so one bad record cannot hide healthy work.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StatusRecordDiagnostic {
    pub work_id: String,
    pub title: Option<String>,
    pub code: String,
    pub detail: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StatusDependencyRecord {
    pub prerequisite_id: WorkId,
    pub dependent_id: WorkId,
    pub policy: DependencyPolicy,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProjectStatusRead {
    pub project_id: ProjectId,
    pub revision: SnapshotRevision,
    pub total: u64,
    pub works: Vec<StatusWorkRecord>,
    pub diagnostics: Vec<StatusRecordDiagnostic>,
    pub dependencies: Vec<StatusDependencyRecord>,
}

#[derive(Clone, Debug)]
struct StatusGateRow {
    work_id: String,
    gate_id: String,
    profile_id: String,
    profile_version: u64,
    kind: GateKind,
    required: bool,
    state: GateState,
}

#[derive(Default)]
struct StatusGateRead {
    diagnostics: BTreeMap<String, GateDiagnostics>,
    requirement_diagnostics: BTreeMap<String, String>,
}

#[derive(Clone, Debug)]
struct StatusReceiptFact {
    receipt_id: String,
    result: ReceiptOutcome,
    rejection_code: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MutationResult {
    pub operation_id: String,
    pub revision: u64,
    pub replayed: bool,
}

/// Counters captured at the store boundary for one or more operations.
///
/// These are deliberately low-level measurements rather than claims about
/// SQLite's internal lock scheduler. `statements_prepared` counts prepared
/// statements, `batch_calls` counts `sqlite3_exec` batches, `rows_returned`
/// counts rows observed by the Rust adapter, and `text_bytes_read` counts
/// decoded SQLite text bytes. Callers can reset the counters immediately
/// before a read and snapshot them immediately afterward.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct SqliteQueryMetrics {
    pub statements_prepared: u64,
    pub batch_calls: u64,
    pub rows_returned: u64,
    pub text_bytes_read: u64,
}

#[derive(Debug, Default)]
struct SqliteQueryMetricsAtomic {
    statements_prepared: AtomicU64,
    batch_calls: AtomicU64,
    rows_returned: AtomicU64,
    text_bytes_read: AtomicU64,
}

impl SqliteQueryMetricsAtomic {
    fn reset(&self) {
        self.statements_prepared.store(0, Ordering::Relaxed);
        self.batch_calls.store(0, Ordering::Relaxed);
        self.rows_returned.store(0, Ordering::Relaxed);
        self.text_bytes_read.store(0, Ordering::Relaxed);
    }

    fn snapshot(&self) -> SqliteQueryMetrics {
        SqliteQueryMetrics {
            statements_prepared: self.statements_prepared.load(Ordering::Relaxed),
            batch_calls: self.batch_calls.load(Ordering::Relaxed),
            rows_returned: self.rows_returned.load(Ordering::Relaxed),
            text_bytes_read: self.text_bytes_read.load(Ordering::Relaxed),
        }
    }
}

/// Identity of the SQLite library linked by the running process.
///
/// This is runtime data, not the version of the Rust crate. It is intended for
/// `doctor`, `version`, release evidence, and support diagnostics.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SqliteRuntimeIdentity {
    pub libversion: String,
    pub source_id: String,
    pub compile_options: Vec<String>,
}

impl SqliteRuntimeIdentity {
    /// Parses SQLite's `major.minor.patch` version into a comparable tuple.
    pub fn version_tuple(&self) -> Option<(u64, u64, u64)> {
        let mut parts = self.libversion.split('.');
        let major = parts.next()?.parse().ok()?;
        let minor = parts.next()?.parse().ok()?;
        let patch = parts
            .next()
            .and_then(|value| {
                value
                    .split(|character: char| !character.is_ascii_digit())
                    .next()
            })
            .and_then(|value| value.parse().ok())?;
        Some((major, minor, patch))
    }

    pub fn at_least(&self, required: (u64, u64, u64)) -> bool {
        self.version_tuple()
            .is_some_and(|actual| actual >= required)
    }

    pub fn as_json(&self) -> Value {
        json!({
            "libversion": self.libversion,
            "source_id": self.source_id,
            "compile_options": self.compile_options,
        })
    }
}

/// Result of a SQLite online-backup operation.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SqliteBackupReport {
    pub source_page_count: u64,
    pub pages_copied: u64,
    pub busy_retries: u64,
}

/// A validated package-level SQLite backup. The database file is accompanied
/// by a manifest so restore can fail closed on schema, identity, or external
/// artifact mismatches instead of treating a raw file copy as a complete
/// project backup.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SqliteBackupPackageReport {
    pub package_path: PathBuf,
    pub database_path: PathBuf,
    pub manifest_path: PathBuf,
    pub backup: SqliteBackupReport,
    pub project_count: u64,
    pub referenced_blob_count: u64,
    pub published_memory_count: u64,
    pub restore_supported: bool,
}

/// Result of replacing a destination database from a validated backup
/// package. The old destination is retained at `previous_database_path` when
/// one existed, making an interrupted or operator-rejected restore recoverable
/// without reopening the old lineage as current.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SqliteRestorePackageReport {
    pub package_path: PathBuf,
    pub destination_path: PathBuf,
    pub previous_database_path: Option<PathBuf>,
    pub source_database_instance_id: String,
    pub source_restore_epoch: u64,
    pub current_database_instance_id: String,
    pub current_restore_epoch: u64,
    pub backup: SqliteBackupReport,
}

/// The durable session state values accepted by schema v2.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SessionState {
    Active,
    Ended,
    Unknown,
}

/// Registers the actor/harness binding for one project-scoped session.
///
/// Schema v2 intentionally keeps `session` globally keyed and does not add a
/// project column. The registration operation is therefore the authoritative
/// project-scope record for this row.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SessionRegistrationRequest {
    pub project_id: String,
    pub session_id: String,
    pub actor_id: String,
    pub harness_id: String,
    pub operation_id: String,
    pub request_digest: String,
    pub expected_project_revision: Option<u64>,
    pub started_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SessionRecord {
    pub project_id: String,
    pub session_id: String,
    pub actor_id: String,
    pub harness_id: String,
    pub state: SessionState,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub registration_operation_id: Option<String>,
    pub revision: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SessionRegistrationResult {
    pub session: SessionRecord,
    pub revision: u64,
    pub replayed: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SessionEndResult {
    pub session: SessionRecord,
    pub revision: u64,
    pub replayed: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReceiptAttestation {
    BorealWitnessed,
    ExternalAttested,
    SelfReported,
    Unknown,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReceiptOutcome {
    Passed,
    Failed,
    Rejected,
    Unknown,
    Stale,
}

/// Identifies which application boundary admitted a receipt. This is an
/// explicit trust input to the store transaction: imported evidence may never
/// claim Boreal's witnessed identity.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReceiptSubmissionKind {
    ExternalImport,
    WitnessedExecutor,
}

/// Durable lifecycle of one externally executed evidence command.  Receipt
/// operations are intentionally separate: the execution row is written before
/// spawn and becomes `ReceiptCommitted` in the same transaction that accepts
/// the immutable receipt.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EvidenceExecutionState {
    Admitted,
    Running,
    Exited,
    ReceiptCommitted,
    Unknown,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EvidenceExecutionAdmissionRequest {
    pub operation_id: String,
    pub project_id: String,
    pub work_id: String,
    pub attempt_id: String,
    pub fence: u64,
    pub gate_id: String,
    pub actor_id: String,
    pub session_id: Option<String>,
    pub request_digest: String,
    pub artifact_ref: String,
    pub source_version_id: Option<String>,
    pub config_identity: String,
    pub profile_id: String,
    pub profile_version: u64,
    pub admitted_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EvidenceExecutionRecord {
    pub operation_id: String,
    pub project_id: String,
    pub work_id: String,
    pub attempt_id: String,
    pub fence: u64,
    pub gate_id: String,
    pub actor_id: String,
    pub session_id: Option<String>,
    pub request_digest: String,
    pub artifact_ref: String,
    pub state: EvidenceExecutionState,
    pub admitted_at: String,
    pub started_at: Option<String>,
    pub exited_at: Option<String>,
    pub exit_code: Option<i64>,
    pub receipt_id: Option<String>,
    pub failure_code: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EvidenceExecutionAdmissionResult {
    pub execution: EvidenceExecutionRecord,
    pub replayed: bool,
}

/// The authoritative proof context that must still be current when a receipt
/// commits. Callers may validate earlier for useful errors, but this snapshot
/// is always rechecked under the receipt's `BEGIN IMMEDIATE` transaction.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReceiptAcceptanceExpectation {
    pub work_id: String,
    pub attempt_id: String,
    pub fence: u64,
    pub source_version_id: Option<String>,
    pub config_identity: String,
    pub profile_id: String,
    pub profile_version: u64,
    pub gate_id: String,
    pub gate_kind: GateKind,
    pub gate_required: bool,
    pub requires_attestation: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReceiptInsertRequest {
    pub project_id: String,
    pub actor_id: String,
    pub session_id: Option<String>,
    pub expected_project_revision: Option<u64>,
    pub request_digest: String,
    pub receipt_id: String,
    pub work_id: String,
    pub attempt_id: String,
    pub fence: u64,
    pub operation_id: String,
    pub gate_id: Option<String>,
    pub executable: String,
    pub argv_json: String,
    pub cwd: String,
    pub exit_code: i32,
    pub started_at: String,
    pub ended_at: String,
    pub source_version_id: Option<String>,
    pub config_identity: String,
    pub environment_fingerprint: String,
    pub output_digest: Option<String>,
    pub output_ref: Option<String>,
    pub subject_json: String,
    pub coverage_json: String,
    pub attestation: ReceiptAttestation,
    pub submission_kind: ReceiptSubmissionKind,
    pub acceptance: Option<ReceiptAcceptanceExpectation>,
    pub result: ReceiptOutcome,
    pub rejection_code: Option<String>,
    pub created_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReceiptRecord {
    pub receipt_id: String,
    pub project_id: String,
    pub work_id: String,
    pub attempt_id: String,
    pub fence: u64,
    pub operation_id: String,
    pub gate_id: Option<String>,
    pub executable: String,
    pub argv_json: String,
    pub cwd: String,
    pub exit_code: i32,
    pub started_at: String,
    pub ended_at: String,
    pub source_version_id: Option<String>,
    pub config_identity: String,
    pub environment_fingerprint: String,
    pub output_digest: Option<String>,
    pub output_ref: Option<String>,
    pub subject_json: String,
    pub coverage_json: String,
    pub attestation: ReceiptAttestation,
    pub result: ReceiptOutcome,
    pub rejection_code: Option<String>,
    pub created_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReceiptInsertResult {
    pub receipt: ReceiptRecord,
    pub revision: u64,
    pub replayed: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GateRecord {
    pub gate_id: String,
    pub project_id: String,
    pub work_id: String,
    pub profile_id: String,
    pub profile_version: u64,
    pub kind: GateKind,
    pub required: bool,
    pub state: GateState,
    pub subject_ref: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GateDiagnostic {
    pub gate_id: String,
    pub kind: GateKind,
    pub required: bool,
    pub state: GateState,
    pub receipt_id: Option<String>,
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GateDiagnostics {
    pub project_id: String,
    pub work_id: String,
    pub attempt_id: Option<String>,
    pub fence: Option<u64>,
    pub revision: u64,
    pub gates: Vec<GateDiagnostic>,
    pub missing: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GateStateUpdateRequest {
    pub project_id: String,
    pub work_id: String,
    pub gate_id: String,
    pub state: GateState,
    pub actor_id: String,
    pub session_id: Option<String>,
    pub operation_id: String,
    pub request_digest: String,
    pub expected_project_revision: Option<u64>,
    pub updated_at: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReviewDecision {
    Accepted,
    Rejected,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReviewInsertRequest {
    pub project_id: String,
    pub actor_id: String,
    pub session_id: Option<String>,
    pub expected_project_revision: Option<u64>,
    pub review_id: String,
    pub work_id: String,
    pub attempt_id: String,
    pub fence: u64,
    pub gate_id: Option<String>,
    pub reviewer_actor_id: String,
    pub decision: ReviewDecision,
    pub reason: String,
    pub source_version_id: Option<String>,
    pub policy_digest: String,
    pub operation_id: String,
    pub request_digest: String,
    pub created_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReviewRecord {
    pub review_id: String,
    pub project_id: String,
    pub work_id: String,
    pub attempt_id: String,
    pub fence: u64,
    pub gate_id: Option<String>,
    pub reviewer_actor_id: String,
    pub decision: ReviewDecision,
    pub reason: String,
    pub source_version_id: Option<String>,
    pub policy_digest: String,
    pub created_at: String,
}

pub const MAX_SUMMARY_BODY_BYTES: u64 = 64 * 1024;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SummaryInsertRequest {
    pub project_id: String,
    pub actor_id: String,
    pub session_id: Option<String>,
    pub expected_project_revision: Option<u64>,
    pub summary_id: String,
    pub work_id: String,
    pub attempt_id: String,
    pub fence: u64,
    pub source_version_id: String,
    pub config_identity: String,
    pub profile_id: String,
    pub profile_version: u64,
    pub body_digest: String,
    pub body_size: u64,
    pub operation_id: String,
    pub created_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SummaryRecord {
    pub summary_id: String,
    pub project_id: String,
    pub work_id: String,
    pub attempt_id: String,
    pub fence: u64,
    pub subject_ref: String,
    pub source_version_id: String,
    pub config_identity: String,
    pub profile_id: String,
    pub profile_version: u64,
    pub body_digest: String,
    pub body_size: u64,
    pub current: bool,
    pub created_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SummaryInsertResult {
    pub summary: SummaryRecord,
    pub revision: u64,
    pub replayed: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CloseIntentState {
    Open,
    Invalidated,
    Finalized,
    Rejected,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CloseIntentRecord {
    pub close_intent_id: String,
    pub project_id: String,
    pub work_id: String,
    pub attempt_id: String,
    pub fence: u64,
    pub operation_id: String,
    pub source_version_id: Option<String>,
    pub config_identity: String,
    pub profile_id: String,
    pub profile_version: u64,
    pub summary_id: Option<String>,
    pub state: CloseIntentState,
    pub created_at: String,
    pub finalized_at: Option<String>,
    pub invalidated_at: Option<String>,
    pub invalidation_code: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CloseIntentRequest {
    pub project_id: String,
    pub actor_id: String,
    pub session_id: Option<String>,
    pub expected_project_revision: Option<u64>,
    pub close_intent_id: String,
    pub work_id: String,
    pub attempt_id: String,
    pub fence: u64,
    pub operation_id: String,
    pub source_version_id: Option<String>,
    pub config_identity: String,
    pub profile_id: String,
    pub profile_version: u64,
    pub summary_id: Option<String>,
    pub at: String,
    pub request_digest: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CloseIntentResult {
    pub close_intent: CloseIntentRecord,
    pub revision: u64,
    pub replayed: bool,
    pub diagnostics: Option<GateDiagnostics>,
}

pub type ReceiptRequest = ReceiptInsertRequest;
pub type GateUpdateRequest = GateStateUpdateRequest;
pub type ReviewRequest = ReviewInsertRequest;
pub type CloseIntentCreateRequest = CloseIntentRequest;

/// The durable attempt row needed by runtime and status adapters. The store
/// returns this projection rather than exposing SQLite statements to callers.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AttemptRecord {
    pub project_id: String,
    pub work_id: String,
    pub attempt_id: String,
    pub actor_id: String,
    pub harness_id: Option<String>,
    pub session_id: Option<String>,
    pub fence: u64,
    pub current: bool,
    pub phase: AttemptPhase,
    pub claimed_at: String,
    pub accepted_at: Option<String>,
    pub lease_deadline: String,
    pub hard_deadline: String,
    pub last_heartbeat_at: Option<String>,
    pub last_checkpoint_at: Option<String>,
    pub review_required_after_expiry: bool,
    pub stop_requested_at: Option<String>,
    pub stop_acknowledged_at: Option<String>,
    pub terminal_at: Option<String>,
    pub terminal_reason: Option<String>,
    pub source_version_id: Option<String>,
    pub config_identity: String,
    pub binary_identity: String,
    pub protocol_version: String,
    pub schema_version: u64,
}

/// Lifecycle commands accepted by the transactional attempt boundary.
/// Timestamp values use the store's canonical text representation (normally
/// RFC3339 UTC); comparisons are numeric when tests use numeric virtual time.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AttemptMutationKind {
    Accept,
    Start,
    Heartbeat {
        phase: Option<String>,
        tool: Option<String>,
        process: Option<String>,
    },
    RenewLease {
        lease_deadline: String,
    },
    Submit,
    Release,
    Fail,
    Expire {
        stop_confirmed: bool,
    },
    Cancel {
        stop_confirmed: bool,
    },
}

/// A typed, revision/fence-bound request for one attempt mutation.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AttemptMutationRequest {
    pub project_id: String,
    pub work_id: String,
    pub attempt_id: String,
    pub actor_id: String,
    pub harness_id: Option<String>,
    pub session_id: Option<String>,
    pub fence: u64,
    pub operation_id: String,
    pub request_digest: String,
    pub at: String,
    pub expected_project_revision: Option<u64>,
    /// The schema has one project revision cursor, so work revisions are
    /// checked against that same cursor until a per-work revision is added.
    pub expected_work_revision: Option<u64>,
    /// Attempt revisions are represented by the monotonic attempt fence in
    /// schema v2. This optional alias makes that boundary explicit to callers.
    pub expected_attempt_revision: Option<u64>,
    pub expected_phase: Option<AttemptPhase>,
    pub expected_lease_deadline: Option<String>,
    pub expected_hard_deadline: Option<String>,
    pub mutation: AttemptMutationKind,
    pub reason: Option<String>,
}

/// The committed result returned by `apply_attempt_mutation` and operation
/// readback. A replay has the original revision and `replayed = true`.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AttemptMutationResult {
    pub operation_id: String,
    pub request_digest: String,
    pub attempt_id: String,
    pub fence: u64,
    pub phase: AttemptPhase,
    pub lease_deadline: String,
    pub hard_deadline: String,
    pub revision: u64,
    pub changed: bool,
    pub replayed: bool,
}

pub type AttemptMutation = AttemptMutationResult;
pub type CurrentAttempt = AttemptRecord;

/// Names matching the application adapter vocabulary without creating a
/// dependency from this low-level store crate back to application.
pub type AttemptCommand = AttemptMutationRequest;
pub type AttemptCommandKind = AttemptMutationKind;

#[derive(Debug)]
pub struct SqliteStore {
    database: *mut sqlite3,
    database_path: Option<PathBuf>,
    query_metrics: Arc<SqliteQueryMetricsAtomic>,
    migration_transaction: AtomicBool,
    /// True only when this handle was opened through the exact canonical
    /// production schema request.  The legacy schema-v2 fixture still uses
    /// the production migration runner for compatibility, but is explicitly
    /// non-production so existing isolated tests do not need a workspace
    /// binding just to exercise the historical store API.
    canonical_production: bool,
}

unsafe impl Send for SqliteStore {}

impl SqliteStore {
    /// Opens a database through the production migration boundary when the
    /// canonical v2 schema is requested. Existing production v2 databases are
    /// upgraded to the additive v3 work model before callers can mutate them;
    /// established pre-runner v3 databases receive only the explicit,
    /// verified production metadata repair. Noncanonical test/setup SQL keeps
    /// the historical schema behavior and is never treated as production.
    pub fn open(path: impl AsRef<Path>, schema_sql: &str) -> Result<Self, StoreError> {
        let canonical_production = is_canonical_production_schema_request(schema_sql);
        let mut store = Self::open_connection(path, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE)?;
        store.canonical_production = canonical_production;
        if is_production_schema_request(schema_sql) {
            store.ensure_production_schema()?;
        } else {
            match store.schema_version()? {
                0 => store.apply_schema(schema_sql)?,
                SCHEMA_VERSION => store.verify_schema_contract()?,
                WORK_MODEL_SCHEMA_VERSION => store.verify_work_model_v3_contract()?,
                found => return Err(StoreError::UnsupportedSchema { found }),
            }
        }
        Ok(store)
    }

    /// Opens an existing database without claiming that its same-version
    /// schema is complete. This is reserved for an explicit migration/repair
    /// boundary; normal readers and writers must use [`Self::open`], which
    /// fails closed when the contract is incomplete.
    pub fn open_for_migration(path: impl AsRef<Path>) -> Result<Self, StoreError> {
        let store = Self::open_connection(path, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE)?;
        match store.schema_version()? {
            0 | SCHEMA_VERSION | WORK_MODEL_SCHEMA_VERSION => Ok(store),
            found => Err(StoreError::UnsupportedSchema { found }),
        }
    }

    /// Opens an established database for read-only work. This path never
    /// enables WAL or runs schema DDL, so status/readback callers cannot take
    /// a writer lock merely by opening a connection.
    pub fn open_read_only(path: impl AsRef<Path>) -> Result<Self, StoreError> {
        let store = Self::open_connection(path, SQLITE_OPEN_READONLY)?;
        match store.schema_version()? {
            SCHEMA_VERSION => {
                store.verify_schema_contract()?;
                Ok(store)
            }
            WORK_MODEL_SCHEMA_VERSION => {
                store.verify_work_model_v3_contract()?;
                Ok(store)
            }
            0 => Err(StoreError::Invalid(
                "read-only database is not initialized".to_owned(),
            )),
            found => Err(StoreError::UnsupportedSchema { found }),
        }
    }

    fn open_connection(path: impl AsRef<Path>, flags: c_int) -> Result<Self, StoreError> {
        let path = path.as_ref();
        let filename = CString::new(
            path.to_str()
                .ok_or_else(|| StoreError::Invalid("database path is not UTF-8".to_owned()))?,
        )?;
        let mut database = ptr::null_mut();
        let result = unsafe {
            sqlite3_open_v2(
                filename.as_ptr(),
                &mut database,
                flags | SQLITE_OPEN_FULLMUTEX,
                ptr::null(),
            )
        };
        if result != SQLITE_OK {
            let message = database_error(database, result);
            if !database.is_null() {
                unsafe { sqlite3_close(database) };
            }
            return Err(message);
        }

        let store = Self {
            database,
            database_path: (path != Path::new(":memory:")).then(|| path.to_path_buf()),
            query_metrics: Arc::new(SqliteQueryMetricsAtomic::default()),
            migration_transaction: AtomicBool::new(false),
            canonical_production: false,
        };
        unsafe { sqlite3_busy_timeout(store.database, 250) };
        store.execute_batch("PRAGMA foreign_keys = ON;")?;
        if flags & SQLITE_OPEN_READONLY == 0 {
            store.execute_batch("PRAGMA journal_mode = WAL;")?;
        }
        Ok(store)
    }

    pub fn open_in_memory(schema_sql: &str) -> Result<Self, StoreError> {
        Self::open(":memory:", schema_sql)
    }

    /// Reports whether this handle was opened through the exact canonical
    /// production schema boundary.
    pub fn is_canonical_production(&self) -> bool {
        self.canonical_production
    }

    pub fn open_with_schema_file(
        path: impl AsRef<Path>,
        schema_path: impl AsRef<Path>,
    ) -> Result<Self, StoreError> {
        let schema = std::fs::read_to_string(schema_path.as_ref()).map_err(|error| {
            StoreError::Unavailable(format!(
                "cannot read schema {}: {error}",
                schema_path.as_ref().display()
            ))
        })?;
        Self::open(path, &schema)
    }

    /// Runs the ordered production migration plan on this already-open
    /// connection. The runner owns the schema identity/ledger verification;
    /// this method only translates its typed result into the store boundary.
    pub fn migrate_production(&self) -> Result<MigrationOutcome, StoreError> {
        let legacy_v2 = self.schema_version()? == SCHEMA_VERSION;
        let plan = production_migration_plan().map_err(map_migration_error)?;
        if legacy_v2 {
            // The runner's preflight is intentionally retained, but v2 repair
            // must not happen before this connection owns the writer boundary.
            // Otherwise a live attempt (or a concurrent writer entering the
            // gap) could be observed only after repair DDL had committed.
            store_try_acquire_migration_lock(self)?;
            if let Err(error) = production_preflight(self) {
                store_release_migration_lock(self);
                return Err(error);
            }
        }
        let mut runner = match MigrationRunner::new(self, plan).map_err(map_migration_error) {
            Ok(runner) => runner,
            Err(error) => {
                if legacy_v2 {
                    store_release_migration_lock(self);
                }
                return Err(error);
            }
        };
        let result = runner.apply().map_err(map_migration_error);
        if legacy_v2 && self.migration_transaction.load(Ordering::Acquire) {
            store_release_migration_lock(self);
        }
        result
    }

    /// Repairs metadata for a pre-runner schema-v3 database without changing
    /// canonical work, attempt, evidence, or planning rows. The repair is
    /// allowed only after the complete v3 contract verifies and only when all
    /// production metadata tables are absent. A partial or mismatched set is
    /// corruption, not permission to overwrite history.
    pub fn repair_production_schema(&self) -> Result<MigrationOutcome, StoreError> {
        if self.schema_version()? != WORK_MODEL_SCHEMA_VERSION {
            return Err(StoreError::Invalid(
                "production metadata repair requires schema version 3".to_owned(),
            ));
        }
        self.verify_work_model_v3_contract()?;
        let metadata_present = [
            MIGRATION_LEDGER_TABLE,
            MIGRATION_DIAGNOSTIC_TABLE,
            SCHEMA_IDENTITY_TABLE,
        ]
        .map(|table| self.table_exists(table));
        let mut present = 0;
        for result in metadata_present {
            if result? {
                present += 1;
            }
        }
        if present != 0 {
            if present != 3 {
                return Err(StoreError::Corrupt(
                    "production migration metadata is partially provisioned; refusing repair"
                        .to_owned(),
                ));
            }
            self.verify_production_schema_current()?;
            return Ok(MigrationOutcome::AlreadyCurrent {
                version: WORK_MODEL_SCHEMA_VERSION,
            });
        }

        let plan = production_migration_plan().map_err(map_migration_error)?;
        let bootstrap = production_bootstrap_step(&plan).map_err(map_migration_error)?;
        let now = production_now();
        store_try_acquire_migration_lock(self)?;
        if let Err(error) = production_preflight(self) {
            store_release_migration_lock(self);
            return Err(error);
        }
        let result = (|| {
            self.execute_batch(PRODUCTION_EXTERNAL_JOB_IDENTITY_TRIGGER_SQL)?;
            self.execute_batch(PRODUCTION_METADATA_SCHEMA_SQL)?;
            self.execute_batch(&format!(
                "INSERT INTO {SCHEMA_IDENTITY_TABLE}
                 (identity_id, schema_id, schema_version, contract_version,
                  schema_checksum, updated_at)
                 VALUES (1, {}, {}, {}, {}, {});",
                sql_text(PRODUCTION_SCHEMA_ID),
                WORK_MODEL_SCHEMA_VERSION,
                sql_text(PRODUCTION_SCHEMA_CONTRACT_VERSION),
                sql_text(&plan.target_schema_checksum),
                sql_text(&now),
            ))?;
            self.execute_batch(&format!(
                "INSERT INTO {MIGRATION_DIAGNOSTIC_TABLE}
                 (migration_id, attempt, code, entity_type, entity_id,
                  message, blocking, raw_payload, created_at)
                 VALUES ({}, 1, 'production_metadata_repaired', 'database', '',
                         'Reconciled pre-runner schema-v3 metadata without changing canonical rows.',
                         0, '', {});",
                sql_text("repair-production-v3"),
                sql_text(&now),
            ))?;
            self.execute_batch(&format!(
                "INSERT INTO {MIGRATION_LEDGER_TABLE}
                 (migration_id, attempt, from_version, to_version, checksum,
                  state, diagnostics_json, started_at, completed_at)
                 VALUES ({}, 1, 0, {}, {}, 'applied',
                         '[{{\"code\":\"production_metadata_repaired\"}}]', {}, {});",
                sql_text(&bootstrap.migration_id),
                WORK_MODEL_SCHEMA_VERSION,
                sql_text(&bootstrap.checksum),
                sql_text(&now),
                sql_text(&now),
            ))?;
            self.execute_batch(PRODUCTION_VERIFY_SQL)?;
            self.verify_work_model_v3_contract()
        })();
        match result {
            Ok(()) => store_commit(self)?,
            Err(error) => {
                store_release_migration_lock(self);
                return Err(error);
            }
        }
        Ok(MigrationOutcome::AlreadyCurrent {
            version: WORK_MODEL_SCHEMA_VERSION,
        })
    }

    fn ensure_production_schema(&self) -> Result<(), StoreError> {
        match self.schema_version()? {
            0 | SCHEMA_VERSION => {
                self.migrate_production()?;
                self.ensure_additive_store_schema()?;
                Ok(())
            }
            WORK_MODEL_SCHEMA_VERSION => {
                let metadata_present = [
                    MIGRATION_LEDGER_TABLE,
                    MIGRATION_DIAGNOSTIC_TABLE,
                    SCHEMA_IDENTITY_TABLE,
                ]
                .iter()
                .map(|table| self.table_exists(table))
                .collect::<Result<Vec<_>, _>>()?;
                if metadata_present.iter().all(|present| *present) {
                    self.verify_production_schema_current()?;
                } else if metadata_present.iter().all(|present| !*present) {
                    self.repair_production_schema()?;
                } else {
                    return Err(StoreError::Corrupt(
                        "production migration metadata is partially provisioned".to_owned(),
                    ));
                }
                self.ensure_additive_store_schema()?;
                Ok(())
            }
            found => Err(StoreError::UnsupportedSchema { found }),
        }
    }

    /// Installs the additive identity, recovery, and external-job seams at
    /// the canonical production-open boundary. These records must exist
    /// before application code treats operation, attempt, or workspace facts
    /// as authoritative; they are deliberately not installed by individual
    /// lifecycle call sites or test fixtures.
    fn ensure_additive_store_schema(&self) -> Result<(), StoreError> {
        // In-memory stores are also used by focused tests that deliberately
        // install a controlled database identity after opening. Do not claim
        // a generated persistent identity for those ephemeral connections;
        // persistent production paths, or an already identity-bound in-memory
        // connection, still pass through the canonical install boundary.
        let identity_installed = self.table_exists("boreal_database_identity")?;
        let install_identity = || -> Result<(), StoreError> {
            let source = self
                .database_path
                .as_ref()
                .map(|path| path.to_string_lossy().into_owned())
                .unwrap_or_else(|| ":memory:".to_owned());
            let mut encoded = String::new();
            for byte in source.as_bytes() {
                write!(&mut encoded, "{byte:02x}")
                    .expect("writing hexadecimal identity into String cannot fail");
            }
            let identity = identity::DatabaseIdentity::new(format!("boreal-db-{encoded}"), 1)
                .map_err(|error| StoreError::Invalid(error.to_string()))?;
            identity::IdentityStore::new(self)
                .install(&identity, &production_now())
                .map(|_| ())
                .map_err(|error| StoreError::Corrupt(error.to_string()))
        };
        if identity_installed {
            match identity::IdentityStore::new(self).database_identity() {
                Ok(_) => {}
                Err(identity::IdentityError::Invalid { field, message })
                    if field == "database_identity"
                        && message == "database identity is not installed" =>
                {
                    if self.database_path.is_some() {
                        install_identity()?;
                    }
                }
                Err(error) => return Err(StoreError::Corrupt(error.to_string())),
            }
        } else {
            return Err(StoreError::Corrupt(
                "production schema is missing required additive table boreal_database_identity"
                    .to_owned(),
            ));
        }
        self.verify_additive_store_schema_contract()
    }

    /// Verifies the complete additive contract at the production-open
    /// boundary.  Checking only table names is insufficient: a copied or
    /// partially restored database can retain a table while losing the
    /// columns, indexes, or append-only guards that make its records safe to
    /// use.  This method is intentionally read-only; repair belongs to the
    /// ordered migration runner, never to a lifecycle mutation.
    fn verify_additive_store_schema_contract(&self) -> Result<(), StoreError> {
        let required_columns = [
            (
                "boreal_database_identity",
                "identity_id,database_instance_id,restore_epoch,created_at,updated_at",
            ),
            (
                "boreal_project_identity",
                "project_id,database_instance_id,restore_epoch,canonical_root,canonical_worktree,binding_digest,bound_at,updated_at",
            ),
            (
                "boreal_entity_revision",
                "project_id,work_id,entity_revision,proof_revision,updated_at",
            ),
            (
                "boreal_attempt_fence_identity",
                "project_id,work_id,attempt_id,fence,database_instance_id,restore_epoch,revoked,recorded_at",
            ),
            (
                "boreal_operation_identity",
                "operation_id,project_id,database_instance_id,restore_epoch,state,invalidated_at,invalidation_code",
            ),
            (
                "boreal_revision_migration",
                "project_id,work_id,legacy_snapshot_revision,entity_revision,proof_revision,disposition,provenance_json,migrated_at",
            ),
            (
                "boreal_recovery_obligation",
                "obligation_id,project_id,work_id,attempt_id,fence,reason,state,resource_state,owner_actor_id,next_action,created_at,resolved_at,resolved_by,resolution_id",
            ),
            (
                "boreal_recovery_decision",
                "decision_id,obligation_id,project_id,actor_id,outcome,reason,resource_state,created_at",
            ),
            (
                "boreal_resource_reservation",
                "reservation_id,project_id,work_id,attempt_id,fence,resource_key,resource_kind,state,owner_actor_id,created_at,release_requested_at,released_at,release_ack_id",
            ),
            (
                "boreal_resource_release_event",
                "event_id,reservation_id,project_id,state,actor_id,evidence_ref,created_at",
            ),
            (
                "boreal_external_job",
                "job_id,operation_id,project_id,subject_type,subject_id,kind,request_digest,stage,side_effect_ref,source_identity,config_identity,actor_id,session_id,started_at,deadline,result_digest,reconciliation_state,error_message,created_at,updated_at",
            ),
            (
                "boreal_pinned_requirement",
                "project_id,work_id,proof_revision,subject_kind,profile_id,profile_version,profile_digest,provenance_json,declarations_json,resolved_digest,pinned_at",
            ),
            (
                "boreal_pinned_requirement_gate",
                "project_id,work_id,proof_revision,requirement_id,gate_id,kind,required,subject_kind,profile_id,profile_version,profile_digest,provenance_json,declaration_json",
            ),
        ];
        for (table, columns) in required_columns {
            if !self.table_exists(table)? {
                return Err(StoreError::Corrupt(format!(
                    "production schema is missing required additive table {table}"
                )));
            }
            for column in columns.split(',') {
                if !self.table_has_column(table, column)? {
                    return Err(StoreError::Corrupt(format!(
                        "production schema table {table} is missing required column {column}"
                    )));
                }
            }
        }

        for index in [
            "boreal_attempt_fence_subject",
            "boreal_operation_identity_scope",
            "boreal_recovery_unresolved",
            "boreal_recovery_decision_subject",
            "boreal_resource_live_key",
            "boreal_resource_attempt",
            "boreal_resource_release_subject",
            "boreal_external_job_project_stage",
            "boreal_external_job_readback",
            "boreal_pinned_requirement_project",
            "attempt_current_work_owner",
            "attempt_current_session_owner",
        ] {
            if !self.schema_object_exists("index", index)? {
                return Err(StoreError::Corrupt(format!(
                    "production schema is missing required additive index {index}"
                )));
            }
        }
        for trigger in [
            "boreal_recovery_decision_append_only_update",
            "boreal_recovery_decision_append_only_delete",
            "boreal_pinned_requirement_immutable_update",
            "boreal_pinned_requirement_immutable_delete",
            "boreal_pinned_requirement_gate_immutable_update",
            "boreal_pinned_requirement_gate_immutable_delete",
            "boreal_external_job_identity_guard",
        ] {
            if !self.schema_object_exists("trigger", trigger)? {
                return Err(StoreError::Corrupt(format!(
                    "production schema is missing required additive trigger {trigger}"
                )));
            }
        }
        Ok(())
    }

    fn verify_production_schema_current(&self) -> Result<(), StoreError> {
        // The v3 verifier checks the hierarchy extension; the base lifecycle
        // contract remains independently authoritative for operation/audit
        // and evidence semantics.
        self.verify_schema_contract()?;
        self.verify_work_model_v3_contract()?;
        let plan = production_migration_plan().map_err(map_migration_error)?;
        let identity = store_schema_identity(self)?;
        if identity.schema_id != plan.schema_id
            || identity.schema_version != plan.target_version
            || identity.contract_version != plan.contract_version
            || identity.schema_checksum.as_deref() != Some(plan.target_schema_checksum.as_str())
        {
            return Err(StoreError::Corrupt(
                "production schema identity does not match the migration plan".to_owned(),
            ));
        }
        self.execute_batch(PRODUCTION_VERIFY_SQL)?;
        let entries = store_read_ledger(self)?;
        let bootstrap = production_bootstrap_step(&plan).map_err(map_migration_error)?;
        let step = plan
            .steps
            .first()
            .ok_or_else(|| StoreError::Corrupt("production migration plan is empty".to_owned()))?;
        let mut current_entry = false;
        for (migration_id, expected_checksum) in [
            (&bootstrap.migration_id, &bootstrap.checksum),
            (&step.migration_id, &step.checksum),
        ] {
            let Some(latest) = entries
                .iter()
                .filter(|entry| entry.migration_id == *migration_id)
                .max_by_key(|entry| entry.attempt)
            else {
                continue;
            };
            if latest.state == MigrationState::Applied && latest.checksum == *expected_checksum {
                current_entry = true;
            } else {
                return Err(StoreError::Corrupt(format!(
                    "production ledger entry {migration_id} is not the applied plan checksum"
                )));
            }
        }
        if !current_entry {
            return Err(StoreError::Corrupt(
                "production schema is missing an applied migration ledger entry".to_owned(),
            ));
        }
        Ok(())
    }

    /// Returns the identity of the SQLite library linked by this process.
    /// This must be reported alongside release evidence because the store uses
    /// the host library rather than embedding a Rust-managed SQLite runtime.
    pub fn sqlite_runtime_identity(&self) -> SqliteRuntimeIdentity {
        sqlite_runtime_identity()
    }

    /// Clears adapter-level SQL counters. This is intended for benchmark and
    /// diagnostics boundaries; it does not affect SQLite or application state.
    pub fn reset_query_metrics(&self) {
        self.query_metrics.reset();
    }

    /// Snapshots adapter-level SQL counters since the last reset.
    pub fn query_metrics(&self) -> SqliteQueryMetrics {
        self.query_metrics.snapshot()
    }

    /// Copies a live database into a new destination using SQLite's online
    /// backup API. Existing destinations are rejected to avoid an accidental
    /// overwrite; callers should choose a new staging/snapshot path.
    pub fn backup_to(
        &self,
        destination: impl AsRef<Path>,
    ) -> Result<SqliteBackupReport, StoreError> {
        let destination = destination.as_ref();
        if destination == Path::new(":memory:") {
            return Err(StoreError::Invalid(
                "SQLite backup destination must be a filesystem path".to_owned(),
            ));
        }
        if destination.exists() {
            return Err(StoreError::Conflict(format!(
                "SQLite backup destination already exists: {}",
                destination.display()
            )));
        }
        if self
            .database_path
            .as_ref()
            .is_some_and(|source| same_path(source, destination))
        {
            return Err(StoreError::Invalid(
                "SQLite backup destination must differ from the source".to_owned(),
            ));
        }
        let filename = CString::new(
            destination
                .to_str()
                .ok_or_else(|| StoreError::Invalid("backup path is not UTF-8".to_owned()))?,
        )?;
        let mut target = ptr::null_mut();
        let result = unsafe {
            sqlite3_open_v2(
                filename.as_ptr(),
                &mut target,
                SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX,
                ptr::null(),
            )
        };
        if result != SQLITE_OK {
            let error = database_error(target, result);
            if !target.is_null() {
                unsafe { sqlite3_close(target) };
            }
            return Err(error);
        }
        unsafe { sqlite3_busy_timeout(target, 1_000) };
        let report = backup_database(self.database, target).and_then(|report| {
            let journal_mode = CString::new("PRAGMA journal_mode=DELETE;")
                .expect("static SQLite pragma has no NUL");
            let result = unsafe {
                sqlite3_exec(
                    target,
                    journal_mode.as_ptr(),
                    None,
                    ptr::null_mut(),
                    ptr::null_mut(),
                )
            };
            if result == SQLITE_OK {
                Ok(report)
            } else {
                Err(database_error(target, result))
            }
        });
        let close_result = unsafe { sqlite3_close(target) };
        if close_result != SQLITE_OK && report.is_ok() {
            return Err(database_error(self.database, close_result));
        }
        report
    }

    /// Creates a self-describing production backup package. The SQLite file
    /// is copied with the online-backup API, then reopened read-only and
    /// described by a manifest generated from that copied snapshot. This
    /// ordering keeps identity, project bindings, blob references, and memory
    /// publication references on one coherent snapshot boundary.
    pub fn backup_package_to(
        &self,
        destination: impl AsRef<Path>,
    ) -> Result<SqliteBackupPackageReport, StoreError> {
        if !self.canonical_production {
            return Err(StoreError::Invalid(
                "production backup packages require the canonical production schema".to_owned(),
            ));
        }
        if self.database_path.is_none() {
            return Err(StoreError::Invalid(
                "production backup packages require a persistent database path".to_owned(),
            ));
        }
        let destination = destination.as_ref();
        ensure_backup_package_path(destination)?;
        let parent = destination.parent().unwrap_or(Path::new("."));
        fs::create_dir_all(parent).map_err(|error| {
            StoreError::Unavailable(format!(
                "cannot create backup package parent {}: {error}",
                parent.display()
            ))
        })?;
        let staging = backup_staging_path(destination, "package")?;
        fs::create_dir(&staging).map_err(|error| {
            StoreError::Unavailable(format!(
                "cannot create backup staging directory {}: {error}",
                staging.display()
            ))
        })?;
        let result = (|| {
            let database_path = staging.join(BACKUP_DATABASE_FILE);
            let backup = self.backup_to(&database_path).map_err(|error| {
                StoreError::Unavailable(format!("cannot create package SQLite snapshot: {error}"))
            })?;
            let snapshot =
                Self::open_read_only(&database_path).map_err(|error| {
                    StoreError::Unavailable(format!(
                    "cannot reopen package SQLite snapshot {} (exists={}, metadata={:?}): {error}",
                    database_path.display(),
                    database_path.exists(),
                    fs::metadata(&database_path).ok().map(|metadata| metadata.len())
                ))
                })?;
            let manifest = snapshot.backup_manifest()?;
            let manifest_path = staging.join(BACKUP_MANIFEST_FILE);
            let encoded = serde_json::to_vec_pretty(&manifest).map_err(|error| {
                StoreError::Invalid(format!("cannot encode backup manifest: {error}"))
            })?;
            fs::write(&manifest_path, encoded).map_err(|error| {
                StoreError::Unavailable(format!(
                    "cannot write backup manifest {}: {error}",
                    manifest_path.display()
                ))
            })?;
            let project_count = manifest
                .get("projects")
                .and_then(Value::as_array)
                .map_or(0, Vec::len) as u64;
            let referenced_blob_count = manifest
                .get("referenced_blobs")
                .and_then(Value::as_array)
                .map_or(0, Vec::len) as u64;
            let published_memory_count = manifest
                .get("published_memory")
                .and_then(Value::as_array)
                .map_or(0, Vec::len) as u64;
            let restore_supported = referenced_blob_count == 0 && published_memory_count == 0;
            drop(snapshot);
            fs::rename(&staging, destination).map_err(|error| {
                StoreError::Unavailable(format!(
                    "cannot publish backup package {}: {error}",
                    destination.display()
                ))
            })?;
            Ok(SqliteBackupPackageReport {
                package_path: destination.to_path_buf(),
                database_path: destination.join(BACKUP_DATABASE_FILE),
                manifest_path: destination.join(BACKUP_MANIFEST_FILE),
                backup,
                project_count,
                referenced_blob_count,
                published_memory_count,
                restore_supported,
            })
        })();
        if result.is_err() {
            let _ = fs::remove_dir_all(&staging);
        }
        result
    }

    /// Restores a validated production backup package into a database path.
    /// The package is copied into a staging database, validated, and assigned
    /// a new database lineage/restore epoch before the destination is swapped.
    /// A previous destination is retained beside the new database for manual
    /// rollback; it is never silently deleted.
    pub fn restore_package_to(
        package: impl AsRef<Path>,
        destination: impl AsRef<Path>,
    ) -> Result<SqliteRestorePackageReport, StoreError> {
        let package = package.as_ref();
        let destination = destination.as_ref();
        if destination == Path::new(":memory:") {
            return Err(StoreError::Invalid(
                "production restore destination must be a filesystem path".to_owned(),
            ));
        }
        ensure_backup_package_path_exists(package)?;
        reject_symlink(destination)?;
        let manifest_path = package.join(BACKUP_MANIFEST_FILE);
        let database_path = package.join(BACKUP_DATABASE_FILE);
        let manifest = read_backup_manifest(&manifest_path)?;
        validate_backup_manifest(&manifest)?;
        if manifest
            .get("referenced_blobs")
            .and_then(Value::as_array)
            .is_some_and(|values| !values.is_empty())
            || manifest
                .get("published_memory")
                .and_then(Value::as_array)
                .is_some_and(|values| !values.is_empty())
        {
            return Err(StoreError::Conflict(
                "backup package references external blobs or published Git memory; an artifact bundle is required before restore"
                    .to_owned(),
            ));
        }
        let source = Self::open_read_only(&database_path)?;
        source.validate_backup_manifest(&manifest)?;
        let source_identity = manifest_database_identity(&manifest)?;
        let source_runtime = source.sqlite_runtime_identity();
        if !source_runtime.at_least((3, 8, 0)) {
            return Err(StoreError::Invalid(format!(
                "SQLite runtime {} is too old for production restore",
                source_runtime.libversion
            )));
        }

        let parent = destination.parent().unwrap_or(Path::new("."));
        fs::create_dir_all(parent).map_err(|error| {
            StoreError::Unavailable(format!(
                "cannot create restore destination parent {}: {error}",
                parent.display()
            ))
        })?;
        let existing_identity = if destination.exists() {
            let existing = Self::open(destination, PRODUCTION_SCHEMA_SQL)?;
            existing.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")?;
            let identity = identity::IdentityStore::new(&existing)
                .database_identity()
                .map_err(|error| StoreError::Corrupt(error.to_string()))?;
            drop(existing);
            if destination.with_extension("sqlite-wal").exists()
                || destination.with_extension("sqlite-shm").exists()
            {
                return Err(StoreError::Busy(
                    "restore destination still has active SQLite WAL sidecars".to_owned(),
                ));
            }
            Some(identity)
        } else {
            None
        };
        let current_epoch =
            existing_identity
                .as_ref()
                .map_or(source_identity.restore_epoch.get(), |identity| {
                    identity
                        .restore_epoch
                        .get()
                        .max(source_identity.restore_epoch.get())
                });
        let next_epoch = current_epoch
            .checked_add(1)
            .ok_or_else(|| StoreError::Invalid("restore epoch overflow".to_owned()))?;
        let current_database_instance_id = format!(
            "{}-restore-{next_epoch}",
            source_identity.database_instance_id.as_str()
        );
        let staging = backup_staging_path(destination, "restore")?;
        let staging_database = staging.join(BACKUP_DATABASE_FILE);
        fs::create_dir(&staging).map_err(|error| {
            StoreError::Unavailable(format!(
                "cannot create restore staging directory {}: {error}",
                staging.display()
            ))
        })?;
        let result = (|| {
            let backup = source.backup_to(&staging_database)?;
            let restored = Self::open(&staging_database, PRODUCTION_SCHEMA_SQL)?;
            restored.execute_batch("BEGIN IMMEDIATE")?;
            let restore_result = identity::IdentityStore::new(&restored).restore(
                current_database_instance_id.clone(),
                next_epoch,
                &production_now(),
            );
            if let Err(error) = restore_result {
                let _ = restored.execute_batch("ROLLBACK");
                return Err(StoreError::Corrupt(error.to_string()));
            }
            restored.execute_batch("COMMIT")?;
            restored.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")?;
            drop(restored);
            let staged_wal = staging_database.with_extension("sqlite-wal");
            let staged_shm = staging_database.with_extension("sqlite-shm");
            let _ = fs::remove_file(staged_wal);
            let _ = fs::remove_file(staged_shm);

            let previous_database_path = if destination.exists() {
                let previous = restore_previous_path(destination, next_epoch)?;
                fs::rename(destination, &previous).map_err(|error| {
                    StoreError::Unavailable(format!(
                        "cannot retain previous database {}: {error}",
                        previous.display()
                    ))
                })?;
                Some(previous)
            } else {
                None
            };
            if let Err(error) = fs::rename(&staging_database, destination) {
                if let Some(previous) = previous_database_path.as_ref() {
                    let _ = fs::rename(previous, destination);
                }
                return Err(StoreError::Unavailable(format!(
                    "cannot publish restored database {}: {error}",
                    destination.display()
                )));
            }
            let _ = fs::remove_dir_all(&staging);
            Ok(SqliteRestorePackageReport {
                package_path: package.to_path_buf(),
                destination_path: destination.to_path_buf(),
                previous_database_path,
                source_database_instance_id: source_identity.database_instance_id.to_string(),
                source_restore_epoch: source_identity.restore_epoch.get(),
                current_database_instance_id,
                current_restore_epoch: next_epoch,
                backup,
            })
        })();
        if result.is_err() {
            let _ = fs::remove_dir_all(&staging);
        }
        drop(source);
        result
    }

    /// Restores this store from a source database using SQLite's online backup
    /// API. This compatibility helper is intentionally unavailable for
    /// canonical production stores: an in-place restore must be admitted as a
    /// durable external job, validate the source manifest, and advance the
    /// restore epoch before the restored store is exposed. The caller must
    /// ensure that no application transaction is active for legacy fixtures.
    pub fn restore_from(&self, source: impl AsRef<Path>) -> Result<SqliteBackupReport, StoreError> {
        if self.canonical_production {
            return Err(StoreError::Conflict(
                "canonical production restore requires restore_package_to so the destination can be staged, validated, and atomically replaced"
                    .to_owned(),
            ));
        }
        let source = source.as_ref();
        if source == Path::new(":memory:") {
            return Err(StoreError::Invalid(
                "SQLite restore source must be a filesystem path".to_owned(),
            ));
        }
        if self
            .database_path
            .as_ref()
            .is_some_and(|destination| same_path(destination, source))
        {
            return Err(StoreError::Invalid(
                "SQLite restore source must differ from the destination".to_owned(),
            ));
        }
        let filename = CString::new(
            source
                .to_str()
                .ok_or_else(|| StoreError::Invalid("restore path is not UTF-8".to_owned()))?,
        )?;
        let mut input = ptr::null_mut();
        let result = unsafe {
            sqlite3_open_v2(
                filename.as_ptr(),
                &mut input,
                SQLITE_OPEN_READONLY | SQLITE_OPEN_FULLMUTEX,
                ptr::null(),
            )
        };
        if result != SQLITE_OK {
            let error = database_error(input, result);
            if !input.is_null() {
                unsafe { sqlite3_close(input) };
            }
            return Err(error);
        }
        unsafe { sqlite3_busy_timeout(input, 1_000) };
        let destination_name = CString::new("main")?;
        // The source handle is closed after backup_database returns. The
        // destination is this store's already-open connection.
        let report =
            backup_database_from_named(input, self.database, &destination_name, &destination_name);
        let close_result = unsafe { sqlite3_close(input) };
        if close_result != SQLITE_OK && report.is_ok() {
            return Err(database_error(self.database, close_result));
        }
        report
    }

    fn backup_manifest(&self) -> Result<Value, StoreError> {
        let database = identity::IdentityStore::new(self)
            .database_identity()
            .map_err(|error| StoreError::Corrupt(error.to_string()))?;
        let mut projects = Vec::new();
        for project_id in self.list_project_ids()? {
            let binding = identity::IdentityStore::new(self)
                .workspace_binding(&project_id)
                .map_err(|error| StoreError::Conflict(error.to_string()))?;
            projects.push(json!({
                "project_id": project_id,
                "canonical_root": binding.canonical_root(),
                "canonical_worktree": binding.canonical_worktree(),
                "binding_digest": binding.binding_digest(),
            }));
        }

        let mut blobs = Vec::new();
        let mut blob_statement = self.prepare(
            "SELECT blob_digest, byte_count, media_type, path, verified_at, created_at
             FROM blob ORDER BY blob_digest",
        )?;
        while blob_statement.step()? == SQLITE_ROW {
            blobs.push(json!({
                "blob_digest": blob_statement.column_text(0)?,
                "byte_count": blob_statement.column_u64(1)?,
                "media_type": blob_statement.column_text(2)?,
                "path": blob_statement.column_text(3)?,
                "verified_at": blob_statement.column_optional_text(4)?,
                "created_at": blob_statement.column_text(5)?,
            }));
        }

        let mut published_memory = Vec::new();
        let mut memory_statement = self.prepare(
            "SELECT publication_id, project_id, memory_entry_id, manifest_path,
                    git_revision, content_digest, updated_at
             FROM memory_publication
             WHERE state = 'published'
             ORDER BY publication_id",
        )?;
        while memory_statement.step()? == SQLITE_ROW {
            published_memory.push(json!({
                "publication_id": memory_statement.column_text(0)?,
                "project_id": memory_statement.column_text(1)?,
                "memory_entry_id": memory_statement.column_text(2)?,
                "manifest_path": memory_statement.column_text(3)?,
                "git_revision": memory_statement.column_optional_text(4)?,
                "content_digest": memory_statement.column_text(5)?,
                "updated_at": memory_statement.column_text(6)?,
            }));
        }

        Ok(json!({
            "kind": BACKUP_PACKAGE_KIND,
            "format_version": BACKUP_FORMAT_VERSION,
            "schema": {
                "id": PRODUCTION_SCHEMA_ID,
                "version": WORK_MODEL_SCHEMA_VERSION,
                "contract_version": PRODUCTION_SCHEMA_CONTRACT_VERSION,
                "checksum": checksum(PRODUCTION_SCHEMA_SQL.as_bytes()),
            },
            "sqlite_runtime": self.sqlite_runtime_identity().as_json(),
            "database_identity": {
                "database_instance_id": database.database_instance_id.as_str(),
                "restore_epoch": database.restore_epoch.get(),
            },
            "projects": projects,
            "referenced_blobs": blobs,
            "published_memory": published_memory,
            "restore_policy": {
                "external_artifacts_packaged": false,
                "requires_new_restore_epoch": true,
                "retains_previous_database": true,
            },
            "created_at": production_now(),
        }))
    }

    fn validate_backup_manifest(&self, manifest: &Value) -> Result<(), StoreError> {
        validate_backup_manifest(manifest)?;
        let database = identity::IdentityStore::new(self)
            .database_identity()
            .map_err(|error| StoreError::Corrupt(error.to_string()))?;
        let expected_database = manifest_database_identity(manifest)?;
        if database != expected_database {
            return Err(StoreError::Conflict(
                "backup manifest database identity does not match the SQLite snapshot".to_owned(),
            ));
        }
        let manifest_projects = manifest
            .get("projects")
            .and_then(Value::as_array)
            .ok_or_else(|| {
                StoreError::Corrupt("backup manifest projects is not an array".to_owned())
            })?;
        let project_ids = self.list_project_ids()?;
        let mut manifest_ids = manifest_projects
            .iter()
            .map(|project| {
                project
                    .get("project_id")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        StoreError::Corrupt(
                            "backup manifest project is missing project_id".to_owned(),
                        )
                    })
                    .map(str::to_owned)
            })
            .collect::<Result<Vec<_>, _>>()?;
        manifest_ids.sort();
        if manifest_ids != project_ids {
            return Err(StoreError::Conflict(
                "backup manifest project identity set does not match the SQLite snapshot"
                    .to_owned(),
            ));
        }
        for project in manifest_projects {
            let project_id = project
                .get("project_id")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    StoreError::Corrupt("backup manifest project is missing project_id".to_owned())
                })?;
            let binding = identity::IdentityStore::new(self)
                .workspace_binding(project_id)
                .map_err(|error| StoreError::Corrupt(error.to_string()))?;
            let digest = project
                .get("binding_digest")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    StoreError::Corrupt(
                        "backup manifest project is missing binding_digest".to_owned(),
                    )
                })?;
            if digest != binding.binding_digest()
                || project.get("canonical_root").and_then(Value::as_str)
                    != Some(binding.canonical_root())
                || project.get("canonical_worktree").and_then(Value::as_str)
                    != Some(binding.canonical_worktree())
            {
                return Err(StoreError::Conflict(format!(
                    "backup manifest workspace binding does not match project {project_id}"
                )));
            }
        }
        Ok(())
    }

    pub fn create_project(&self, project_id: &str, now: &str) -> Result<(), StoreError> {
        let mut statement = self.prepare(
            "INSERT INTO project
             (project_id, schema_version, status_contract_version, project_revision, created_at, updated_at)
             VALUES (?1, ?2, ?3, 0, ?4, ?4)",
        )?;
        statement.bind_text(1, project_id)?;
        statement.bind_i64(2, SCHEMA_VERSION as u64)?;
        statement.bind_text(3, STATUS_CONTRACT_VERSION)?;
        statement.bind_text(4, now)?;
        statement.run()
    }

    #[allow(clippy::too_many_arguments)]
    pub fn initialize_project(
        &self,
        project_id: &str,
        actor_id: &str,
        actor_role: &str,
        credential_ref: &str,
        display_name: &str,
        operation_id: &str,
        request_digest: &str,
        now: &str,
    ) -> Result<MutationResult, StoreError> {
        self.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| {
            if let Some(existing) = self.preflight_operation_replay(
                project_id,
                operation_id,
                "project.init",
                actor_id,
                None,
                None,
                None,
                None,
                request_digest,
                "project",
                project_id,
            )? {
                return Ok(MutationResult {
                    operation_id: operation_id.to_owned(),
                    revision: existing.revision,
                    replayed: true,
                });
            }
            self.ensure_actor(actor_id, actor_role, credential_ref, display_name, now)?;
            let focused_profile = profile_version_for_work(&AcceptanceProfile::focused(), now)?;
            self.ensure_acceptance_profile(
                &focused_profile.profile_id,
                focused_profile.version,
                &focused_profile.policy_digest,
                &focused_profile.definition_json,
                now,
            )?;
            if self
                .list_project_ids()?
                .iter()
                .any(|existing| existing == project_id)
            {
                let revision = self.project_revision(project_id)?;
                // A project that already exists is a safe readback of the
                // requested initialization state.  Do not manufacture an
                // operation or audit event for a no-op, because there is no
                // committed state transition to describe.  If the caller
                // needs a durable operation, it must use the project-bound
                // mutation boundary with an authenticated context.
                return Ok(MutationResult {
                    operation_id: operation_id.to_owned(),
                    revision: revision.0,
                    replayed: true,
                });
            }
            self.create_project(project_id, now)?;
            let revision = self.bump_revision_in_transaction(project_id)?;
            let payload = json_object(json!({"project_id": project_id}))?;
            self.append_operation_audit_in_transaction(
                OperationRecord {
                    operation_id: operation_id.to_owned(),
                    project_id: project_id.to_owned(),
                    command: "project.init".to_owned(),
                    actor_id: actor_id.to_owned(),
                    session_id: None,
                    expected_revision: None,
                    attempt_id: None,
                    fence: None,
                    request_digest: request_digest.to_owned(),
                    outcome: OperationOutcome::Changed,
                    result_json: payload.clone(),
                    revision: revision.0,
                    created_at: now.to_owned(),
                    completed_at: Some(now.to_owned()),
                },
                AuditEventRecord {
                    project_id: project_id.to_owned(),
                    revision: revision.0,
                    operation_id: operation_id.to_owned(),
                    event_type: "work.created".to_owned(),
                    subject_type: "project".to_owned(),
                    subject_id: project_id.to_owned(),
                    actor_id: actor_id.to_owned(),
                    session_id: None,
                    fence: None,
                    as_of: now.to_owned(),
                    payload_json: payload,
                },
            )?;
            Ok(MutationResult {
                operation_id: operation_id.to_owned(),
                revision: revision.0,
                replayed: false,
            })
        })();
        match result {
            Ok(value) => {
                self.execute_batch("COMMIT")?;
                Ok(value)
            }
            Err(error) => {
                let _ = self.execute_batch("ROLLBACK");
                Err(error)
            }
        }
    }

    /// Initializes a canonical production project and binds its workspace in
    /// the same SQLite transaction as the identity-bound `project.init`
    /// operation and audit event.
    ///
    /// The workspace binding is validated by the application/path boundary;
    /// this method persists it only after the project row exists inside the
    /// caller-owned transaction. A pre-commit error rolls back the project,
    /// binding, operation, and audit rows together. A commit error is
    /// intentionally returned as an ambiguous outcome: callers must resolve
    /// the original operation ID by readback before retrying.
    #[allow(clippy::too_many_arguments)]
    pub fn initialize_project_with_workspace(
        &self,
        project_id: &str,
        actor_id: &str,
        actor_role: &str,
        credential_ref: &str,
        display_name: &str,
        operation_id: &str,
        request_digest: &str,
        database: &identity::DatabaseIdentity,
        binding: &identity::WorkspaceBinding,
        now: &str,
    ) -> Result<MutationResult, StoreError> {
        if !self.canonical_production {
            return Err(StoreError::Invalid(
                "identity-bound project bootstrap requires the canonical production schema"
                    .to_owned(),
            ));
        }
        self.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| {
            let identity = identity::IdentityStore::new(self);
            let current_database = identity
                .database_identity()
                .map_err(|error| StoreError::Conflict(format!("project identity: {error}")))?;
            if current_database != *database {
                return Err(StoreError::Conflict(format!(
                    "project bootstrap database identity changed before commit: expected {}, epoch {}; actual {}, epoch {}",
                    database.database_instance_id,
                    database.restore_epoch,
                    current_database.database_instance_id,
                    current_database.restore_epoch,
                )));
            }

            // An existing operation is only replayable after its project and
            // workspace identity are both visible. An operation row without
            // that binding is a partial legacy bootstrap and is quarantined;
            // this method never repairs it by binding alone.
            if let Some(existing) = self.operation(operation_id)? {
                if existing.project_id != project_id
                    || existing.command != "project.init"
                    || existing.actor_id != actor_id
                    || existing.session_id.is_some()
                    || existing.expected_revision.is_some()
                    || existing.attempt_id.is_some()
                    || existing.fence.is_some()
                    || existing.request_digest != request_digest
                {
                    return Err(StoreError::Conflict(format!(
                        "operation {operation_id} was already used with another immutable bootstrap identity"
                    )));
                }
                let stored_binding = identity.workspace_binding(project_id).map_err(|error| {
                    StoreError::Conflict(format!(
                        "project.init {operation_id} is not replayable: workspace identity is incomplete ({error})"
                    ))
                })?;
                if stored_binding != *binding {
                    return Err(StoreError::Conflict(format!(
                        "operation {operation_id} was already committed for another workspace binding"
                    )));
                }
                let context = identity.context(project_id).map_err(|error| {
                    StoreError::Conflict(format!(
                        "project.init {operation_id} has an invalid identity context: {error}"
                    ))
                })?;
                let replay = operations::OperationJournal::new(self)
                    .replay_in_context(
                        &context,
                        &operations::OperationIdentity::from_record(
                            &existing,
                            Some(("project".to_owned(), project_id.to_owned())),
                        ),
                    )?
                    .ok_or_else(|| {
                        StoreError::Corrupt(format!(
                            "project.init {operation_id} has no identity-bound readback"
                        ))
                    })?;
                return Ok(MutationResult {
                    operation_id: operation_id.to_owned(),
                    revision: replay
                        .operation
                        .as_ref()
                        .map(|operation| operation.revision)
                        .unwrap_or(existing.revision),
                    replayed: true,
                });
            }

            // A project row without the matching operation is not a safe
            // initialization readback. A fresh CLI operation ID may still
            // safely repeat an already-complete init, but only when the
            // existing binding and original identity-bound project.init can
            // both be read back. Do not create a second history.
            match self.project_revision(project_id) {
                Ok(revision) => {
                    let stored_binding = identity.workspace_binding(project_id).map_err(|error| {
                        StoreError::Conflict(format!(
                            "project {project_id} exists without a complete workspace identity: {error}"
                        ))
                    })?;
                    if stored_binding != *binding {
                        return Err(StoreError::Conflict(format!(
                            "project {project_id} is already bound to another workspace"
                        )));
                    }
                    let context = identity.context(project_id).map_err(|error| {
                        StoreError::Conflict(format!(
                            "project {project_id} has an invalid identity context: {error}"
                        ))
                    })?;
                    let mut initialization = self.prepare(
                        "SELECT operation_id
                         FROM operation
                         WHERE project_id = ?1 AND command = 'project.init'
                         ORDER BY revision ASC LIMIT 1",
                    )?;
                    initialization.bind_text(1, project_id)?;
                    if initialization.step()? != SQLITE_ROW {
                        return Err(StoreError::Conflict(format!(
                            "project {project_id} exists without a replayable project.init operation; bootstrap recovery is required"
                        )));
                    }
                    let original_operation_id = initialization.column_text(0)?;
                    identity
                        .operation(&context, &original_operation_id)
                        .map_err(|error| {
                            StoreError::Conflict(format!(
                                "project {project_id} initialization readback is incomplete: {error}"
                            ))
                        })?
                        .ok_or_else(|| {
                            StoreError::Corrupt(format!(
                                "project {project_id} project.init has no identity-bound readback"
                            ))
                        })?;
                    return Ok(MutationResult {
                        operation_id: operation_id.to_owned(),
                        revision: revision.0,
                        replayed: true,
                    });
                }
                Err(StoreError::NotFound { .. }) => {}
                Err(error) => return Err(error),
            }

            self.ensure_actor(actor_id, actor_role, credential_ref, display_name, now)?;
            let focused_profile = profile_version_for_work(&AcceptanceProfile::focused(), now)?;
            self.ensure_acceptance_profile(
                &focused_profile.profile_id,
                focused_profile.version,
                &focused_profile.policy_digest,
                &focused_profile.definition_json,
                now,
            )?;
            self.create_project(project_id, now)?;
            let context = identity
                .bind_project(project_id, binding, now)
                .map_err(|error| StoreError::Conflict(format!("project identity: {error}")))?;
            let payload = json_object(json!({"project_id": project_id}))?;
            let readback = self.append_identity_operation_audit_in_transaction(
                &context,
                OperationRecord {
                    operation_id: operation_id.to_owned(),
                    project_id: project_id.to_owned(),
                    command: "project.init".to_owned(),
                    actor_id: actor_id.to_owned(),
                    session_id: None,
                    expected_revision: None,
                    attempt_id: None,
                    fence: None,
                    request_digest: request_digest.to_owned(),
                    outcome: OperationOutcome::Changed,
                    result_json: payload.clone(),
                    revision: 0,
                    created_at: now.to_owned(),
                    completed_at: Some(now.to_owned()),
                },
                AuditEventRecord {
                    project_id: project_id.to_owned(),
                    revision: 0,
                    operation_id: operation_id.to_owned(),
                    event_type: "work.created".to_owned(),
                    subject_type: "project".to_owned(),
                    subject_id: project_id.to_owned(),
                    actor_id: actor_id.to_owned(),
                    session_id: None,
                    fence: None,
                    as_of: now.to_owned(),
                    payload_json: payload,
                },
            )?;
            Ok(MutationResult {
                operation_id: operation_id.to_owned(),
                revision: readback
                    .operation
                    .as_ref()
                    .map(|operation| operation.revision)
                    .ok_or_else(|| {
                        StoreError::Corrupt(
                            "project.init committed without an operation readback".to_owned(),
                        )
                    })?,
                replayed: false,
            })
        })();
        match result {
            Ok(value) => {
                self.execute_batch("COMMIT")?;
                Ok(value)
            }
            Err(error) => {
                let _ = self.execute_batch("ROLLBACK");
                Err(error)
            }
        }
    }

    /// Registers a durable actor/harness session for a project.
    ///
    /// The session row is inserted before the operation row so that the
    /// operation and audit records can carry the session foreign key. The
    /// whole sequence is protected by the project write transaction, making
    /// registration and its audit trail atomic.
    pub fn register_session(
        &self,
        request: impl Borrow<SessionRegistrationRequest>,
    ) -> Result<SessionRegistrationResult, StoreError> {
        let request = request.borrow();
        validate_session_registration_request(request)?;

        self.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| {
            if let Some(existing) = self.preflight_operation_replay(
                &request.project_id,
                &request.operation_id,
                "session.register",
                &request.actor_id,
                Some(&request.session_id),
                request.expected_project_revision,
                None,
                None,
                &request.request_digest,
                "project",
                &request.project_id,
            )? {
                let session = self
                    .session(&request.project_id, &request.session_id)?
                    .ok_or_else(|| {
                        StoreError::Corrupt(
                            "session registration operation refers to a missing session".to_owned(),
                        )
                    })?;
                return Ok(SessionRegistrationResult {
                    session,
                    revision: existing.revision,
                    replayed: true,
                });
            }

            // These reads also establish the project and actor foreign-key
            // preconditions with typed errors before writing the session row.
            let current_revision = self.project_revision(&request.project_id)?.0;
            check_expected_revision(current_revision, request.expected_project_revision)?;
            self.require_actor(&request.actor_id)?;

            if let Some(existing) = self.raw_session(&request.session_id)? {
                if existing.actor_id != request.actor_id {
                    return Err(StoreError::WrongOwner {
                        expected: request.actor_id.clone(),
                        actual: existing.actor_id,
                    });
                }
                if existing.harness_id != request.harness_id {
                    return Err(StoreError::WrongOwner {
                        expected: request.harness_id.clone(),
                        actual: existing.harness_id,
                    });
                }
                if let Some(scope) = self.session_registration_scope(&request.session_id)? {
                    if scope.project_id != request.project_id {
                        return Err(StoreError::WrongSubject {
                            expected: request.project_id.clone(),
                            actual: scope.project_id,
                        });
                    }
                }
                return Err(StoreError::Conflict(format!(
                    "session {} is already registered; use its original operation",
                    request.session_id
                )));
            }

            let mut session = self.prepare(
                "INSERT INTO session
                 (session_id, actor_id, harness_id, state, started_at, ended_at)
                 VALUES (?1, ?2, ?3, 'active', ?4, NULL)",
            )?;
            session.bind_text(1, &request.session_id)?;
            session.bind_text(2, &request.actor_id)?;
            session.bind_text(3, &request.harness_id)?;
            session.bind_text(4, &request.started_at)?;
            session.run()?;

            let revision = self.bump_revision_in_transaction(&request.project_id)?;
            let payload = json_object(json!({
                "event": "session.registered",
                "session_id": request.session_id,
                "actor_id": request.actor_id,
                "harness_id": request.harness_id,
            }))?;
            self.append_operation_audit_in_transaction(
                OperationRecord {
                    operation_id: request.operation_id.clone(),
                    project_id: request.project_id.clone(),
                    command: "session.register".to_owned(),
                    actor_id: request.actor_id.clone(),
                    session_id: Some(request.session_id.clone()),
                    expected_revision: request.expected_project_revision,
                    attempt_id: None,
                    fence: None,
                    request_digest: request.request_digest.clone(),
                    outcome: OperationOutcome::Changed,
                    result_json: payload.clone(),
                    revision: revision.0,
                    created_at: request.started_at.clone(),
                    completed_at: Some(request.started_at.clone()),
                },
                AuditEventRecord {
                    // The frozen schema does not include a session-specific event
                    // value. Preserve the typed event in the payload while using
                    // the schema's generic correction event as the audit envelope.
                    project_id: request.project_id.clone(),
                    revision: revision.0,
                    operation_id: request.operation_id.clone(),
                    event_type: "repair.correction".to_owned(),
                    subject_type: "project".to_owned(),
                    subject_id: request.project_id.clone(),
                    actor_id: request.actor_id.clone(),
                    session_id: Some(request.session_id.clone()),
                    fence: None,
                    as_of: request.started_at.clone(),
                    payload_json: payload,
                },
            )?;

            let session = self
                .session(&request.project_id, &request.session_id)?
                .ok_or_else(|| {
                    StoreError::Corrupt("registered session was not readable".to_owned())
                })?;
            Ok(SessionRegistrationResult {
                session,
                revision: revision.0,
                replayed: false,
            })
        })();
        match result {
            Ok(value) => {
                self.execute_batch("COMMIT")?;
                Ok(value)
            }
            Err(error) => {
                let _ = self.execute_batch("ROLLBACK");
                Err(error)
            }
        }
    }

    /// Reads a session after checking its registration project scope.
    ///
    /// Legacy fixtures may contain a session row without a registration
    /// operation. Such rows remain readable for compatibility and are scoped
    /// to the caller's project only for this read; newly registered sessions
    /// always carry an operation-backed scope.
    pub fn session(
        &self,
        project_id: &str,
        session_id: &str,
    ) -> Result<Option<SessionRecord>, StoreError> {
        let Some(raw) = self.raw_session(session_id)? else {
            return Ok(None);
        };
        let registration = self.session_registration_scope(session_id)?;
        if let Some(scope) = &registration {
            if scope.project_id != project_id {
                return Err(StoreError::WrongSubject {
                    expected: project_id.to_owned(),
                    actual: scope.project_id.clone(),
                });
            }
        } else {
            // Confirm the compatibility read still refers to a real project.
            self.project_revision(project_id)?;
        }
        Ok(Some(SessionRecord {
            project_id: registration
                .as_ref()
                .map_or_else(|| project_id.to_owned(), |scope| scope.project_id.clone()),
            session_id: session_id.to_owned(),
            actor_id: raw.actor_id,
            harness_id: raw.harness_id,
            state: raw.state,
            started_at: raw.started_at,
            ended_at: raw.ended_at,
            registration_operation_id: registration
                .as_ref()
                .map(|scope| scope.operation_id.clone()),
            revision: registration
                .map_or(self.project_revision(project_id)?.0, |scope| scope.revision),
        }))
    }

    /// Ends an active session only when it owns no current attempt.  Releasing
    /// live work is a separate fenced lifecycle mutation; session shutdown
    /// must never silently transfer or abandon ownership.
    #[allow(clippy::too_many_arguments)]
    pub fn end_session(
        &self,
        project_id: &str,
        session_id: &str,
        actor_id: &str,
        operation_id: &str,
        request_digest: &str,
        expected_project_revision: Option<u64>,
        ended_at: &str,
    ) -> Result<SessionEndResult, StoreError> {
        self.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| {
            if let Some(existing) = self.preflight_operation_replay(
                project_id,
                operation_id,
                "session.end",
                actor_id,
                Some(session_id),
                expected_project_revision,
                None,
                None,
                request_digest,
                "project",
                project_id,
            )? {
                let session = self.session(project_id, session_id)?.ok_or_else(|| {
                    StoreError::Corrupt(
                        "session end operation refers to a missing session".to_owned(),
                    )
                })?;
                return Ok(SessionEndResult {
                    session,
                    revision: existing.revision,
                    replayed: true,
                });
            }

            let session =
                self.session(project_id, session_id)?
                    .ok_or_else(|| StoreError::NotFound {
                        entity: "session",
                        id: session_id.to_owned(),
                    })?;
            if session.actor_id != actor_id {
                return Err(StoreError::WrongOwner {
                    expected: session.actor_id,
                    actual: actor_id.to_owned(),
                });
            }
            if session.state != SessionState::Active {
                return Err(StoreError::Conflict(format!(
                    "session {session_id} is not active"
                )));
            }
            if self
                .current_attempt_for_session(project_id, session_id)?
                .is_some()
            {
                return Err(StoreError::Conflict(
                    "session owns current work; release or finish it before ending".to_owned(),
                ));
            }
            let current_revision = self.project_revision(project_id)?.0;
            check_expected_revision(current_revision, expected_project_revision)?;

            let mut update = self.prepare(
                "UPDATE session SET state = 'ended', ended_at = ?1
                 WHERE session_id = ?2 AND state = 'active'",
            )?;
            update.bind_text(1, ended_at)?;
            update.bind_text(2, session_id)?;
            update.run()?;
            if update.changes()? != 1 {
                return Err(StoreError::Conflict(format!(
                    "session {session_id} changed while ending"
                )));
            }

            let revision = self.bump_revision_in_transaction(project_id)?;
            let payload = json_object(json!({
                "event": "session.ended",
                "session_id": session_id,
                "actor_id": actor_id,
            }))?;
            self.append_operation_audit_in_transaction(
                OperationRecord {
                    operation_id: operation_id.to_owned(),
                    project_id: project_id.to_owned(),
                    command: "session.end".to_owned(),
                    actor_id: actor_id.to_owned(),
                    session_id: Some(session_id.to_owned()),
                    expected_revision: expected_project_revision,
                    attempt_id: None,
                    fence: None,
                    request_digest: request_digest.to_owned(),
                    outcome: OperationOutcome::Changed,
                    result_json: payload.clone(),
                    revision: revision.0,
                    created_at: ended_at.to_owned(),
                    completed_at: Some(ended_at.to_owned()),
                },
                AuditEventRecord {
                    project_id: project_id.to_owned(),
                    revision: revision.0,
                    operation_id: operation_id.to_owned(),
                    event_type: "repair.correction".to_owned(),
                    // Schema-2 audit envelopes predate a `session` subject type;
                    // retain the precise session identity in payload while using
                    // the compatible project subject for the envelope.
                    subject_type: "project".to_owned(),
                    subject_id: project_id.to_owned(),
                    actor_id: actor_id.to_owned(),
                    session_id: Some(session_id.to_owned()),
                    fence: None,
                    as_of: ended_at.to_owned(),
                    payload_json: payload,
                },
            )?;
            let session = self
                .session(project_id, session_id)?
                .ok_or_else(|| StoreError::Corrupt("ended session was not readable".to_owned()))?;
            Ok(SessionEndResult {
                session,
                revision: revision.0,
                replayed: false,
            })
        })();
        match result {
            Ok(value) => {
                self.execute_batch("COMMIT")?;
                Ok(value)
            }
            Err(error) => {
                let _ = self.execute_batch("ROLLBACK");
                Err(error)
            }
        }
    }

    /// Validates the session binding used by a claim and returns its durable
    /// readback. This is intentionally public so application adapters can use
    /// the same ownership checks before accepting a session-bound operation.
    pub fn session_for_claim(
        &self,
        project_id: &str,
        session_id: &str,
        actor_id: &str,
        harness_id: &str,
    ) -> Result<SessionRecord, StoreError> {
        let session =
            self.session(project_id, session_id)?
                .ok_or_else(|| StoreError::NotFound {
                    entity: "session",
                    id: session_id.to_owned(),
                })?;
        if session.actor_id != actor_id {
            return Err(StoreError::WrongOwner {
                expected: actor_id.to_owned(),
                actual: session.actor_id,
            });
        }
        if session.harness_id != harness_id {
            return Err(StoreError::WrongOwner {
                expected: harness_id.to_owned(),
                actual: session.harness_id,
            });
        }
        if session.state != SessionState::Active {
            return Err(StoreError::Conflict(format!(
                "session {} is not active",
                session.session_id
            )));
        }
        Ok(session)
    }

    fn session_for_project_actor(
        &self,
        project_id: &str,
        session_id: &str,
        actor_id: &str,
        harness_id: Option<&str>,
    ) -> Result<SessionRecord, StoreError> {
        let session =
            self.session(project_id, session_id)?
                .ok_or_else(|| StoreError::NotFound {
                    entity: "session",
                    id: session_id.to_owned(),
                })?;
        if session.actor_id != actor_id {
            return Err(StoreError::WrongOwner {
                expected: actor_id.to_owned(),
                actual: session.actor_id,
            });
        }
        if let Some(harness_id) = harness_id {
            if session.harness_id != harness_id {
                return Err(StoreError::WrongOwner {
                    expected: harness_id.to_owned(),
                    actual: session.harness_id,
                });
            }
        }
        Ok(session)
    }

    fn require_actor(&self, actor_id: &str) -> Result<(), StoreError> {
        let mut statement = self.prepare("SELECT 1 FROM actor WHERE actor_id = ?1")?;
        statement.bind_text(1, actor_id)?;
        if statement.step()? == SQLITE_ROW {
            Ok(())
        } else {
            Err(StoreError::NotFound {
                entity: "actor",
                id: actor_id.to_owned(),
            })
        }
    }

    fn raw_session(&self, session_id: &str) -> Result<Option<RawSession>, StoreError> {
        let mut statement = self.prepare(
            "SELECT actor_id, harness_id, state, started_at, ended_at
             FROM session WHERE session_id = ?1",
        )?;
        statement.bind_text(1, session_id)?;
        if statement.step()? != SQLITE_ROW {
            return Ok(None);
        }
        Ok(Some(RawSession {
            actor_id: statement.column_text(0)?,
            harness_id: statement.column_text(1)?,
            state: parse_session_state(&statement.column_text(2)?)?,
            started_at: statement.column_text(3)?,
            ended_at: statement.column_optional_text(4)?,
        }))
    }

    fn session_registration_scope(
        &self,
        session_id: &str,
    ) -> Result<Option<SessionRegistrationScope>, StoreError> {
        let mut statement = self.prepare(
            "SELECT operation_id, project_id, revision
             FROM operation
             WHERE command = 'session.register' AND session_id = ?1
             ORDER BY revision ASC LIMIT 1",
        )?;
        statement.bind_text(1, session_id)?;
        if statement.step()? != SQLITE_ROW {
            return Ok(None);
        }
        Ok(Some(SessionRegistrationScope {
            operation_id: statement.column_text(0)?,
            project_id: statement.column_text(1)?,
            revision: statement.column_u64(2)?,
        }))
    }

    pub fn ensure_actor(
        &self,
        actor_id: &str,
        role: &str,
        credential_ref: &str,
        display_name: &str,
        now: &str,
    ) -> Result<(), StoreError> {
        let mut statement = self.prepare(
            "INSERT INTO actor (actor_id, role, credential_ref, display_name, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(actor_id) DO NOTHING",
        )?;
        statement.bind_text(1, actor_id)?;
        statement.bind_text(2, role)?;
        statement.bind_text(3, credential_ref)?;
        statement.bind_text(4, display_name)?;
        statement.bind_text(5, now)?;
        statement.run()
    }

    pub fn ensure_acceptance_profile(
        &self,
        profile_id: &str,
        version: u64,
        policy_digest: &str,
        definition_json: &str,
        now: &str,
    ) -> Result<(), StoreError> {
        let mut existing = self.prepare(
            "SELECT policy_digest, definition_json
             FROM acceptance_profile
             WHERE profile_id = ?1 AND version = ?2",
        )?;
        existing.bind_text(1, profile_id)?;
        existing.bind_i64(2, version)?;
        if existing.step()? == SQLITE_ROW {
            let existing_digest = existing.column_text(0)?;
            let existing_definition = existing.column_text(1)?;
            if existing_digest == policy_digest && existing_definition == definition_json {
                return Ok(());
            }
            // An empty legacy row is an explicitly non-authoritative
            // placeholder. Replace it only when the caller supplies a
            // complete, immutable definition; never overwrite non-empty
            // profile content.
            if existing_definition == "{}" && definition_json != "{}" {
                let mut repair = self.prepare(
                    "UPDATE acceptance_profile
                     SET policy_digest = ?1, definition_json = ?2, created_at = ?3
                     WHERE profile_id = ?4 AND version = ?5 AND definition_json = '{}'",
                )?;
                repair.bind_text(1, policy_digest)?;
                repair.bind_text(2, definition_json)?;
                repair.bind_text(3, now)?;
                repair.bind_text(4, profile_id)?;
                repair.bind_i64(5, version)?;
                repair.run()?;
                if repair.changes()? == 1 {
                    return Ok(());
                }
                return Err(StoreError::Conflict(format!(
                    "acceptance profile {profile_id} v{version} placeholder changed during reconstruction"
                )));
            }
            // Empty definitions are legacy placeholders, not authoritative
            // profile content. Preserve the row for the explicit quarantine
            // or provenance-backed reconstruction path instead of treating a
            // historical placeholder digest as immutable policy content.
            if existing_definition == "{}" && definition_json == "{}" {
                return Ok(());
            }
            return Err(StoreError::Conflict(format!(
                "acceptance profile {profile_id} v{version} conflicts with immutable content"
            )));
        }
        let mut statement = self.prepare(
            "INSERT INTO acceptance_profile
             (profile_id, version, policy_digest, definition_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
        )?;
        statement.bind_text(1, profile_id)?;
        statement.bind_i64(2, version)?;
        statement.bind_text(3, policy_digest)?;
        statement.bind_text(4, definition_json)?;
        statement.bind_text(5, now)?;
        statement.run()
    }

    pub fn create_work(&self, work: &WorkItem, now: &str) -> Result<(), StoreError> {
        self.execute_batch("BEGIN IMMEDIATE")?;
        let result = self.create_work_in_transaction(work, now);
        finish_transaction(self, result)
    }

    fn create_work_in_transaction(&self, work: &WorkItem, now: &str) -> Result<(), StoreError> {
        let profile_version = profile_version(&work.acceptance_profile.version)?;
        let profile = profile_version_for_work(&work.acceptance_profile, now)?;
        self.ensure_acceptance_profile(
            work.acceptance_profile.id.as_str(),
            profile_version,
            &profile.policy_digest,
            &profile.definition_json,
            now,
        )?;
        let mut statement = self.prepare(
            "INSERT INTO work_item
             (work_id, project_id, kind, parent_id, lifecycle, dispatch_policy,
              priority, acceptance_profile_id, acceptance_profile_version, title, description,
              created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)",
        )?;
        statement.bind_text(1, work.id.as_str())?;
        statement.bind_text(2, work.project_id.as_str())?;
        statement.bind_text(3, work_kind(work.kind))?;
        statement.bind_optional_text(4, work.parent_id.as_ref().map(WorkId::as_str))?;
        statement.bind_text(5, lifecycle(work.lifecycle))?;
        statement.bind_text(6, dispatch_policy(work.dispatch_policy))?;
        statement.bind_i64(7, u64::from(work.priority))?;
        statement.bind_text(8, work.acceptance_profile.id.as_str())?;
        statement.bind_i64(9, profile_version)?;
        statement.bind_text(10, &work.title)?;
        statement.bind_text(11, &work.description)?;
        statement.bind_text(12, now)?;
        statement.run()?;

        let requirements = PinnedRequirements::resolve(
            &profile,
            work.project_id.as_str(),
            work.id.as_str(),
            1,
            match work.kind {
                WorkKind::Task => RequirementSubjectKind::Task,
                WorkKind::Milestone | WorkKind::Sprint => RequirementSubjectKind::Container,
            },
            now,
        )?;
        ProfileStore::new(self).persist_pinned_requirements_in_transaction(&requirements)?;

        for (index, hold) in work.hard_holds.iter().enumerate() {
            let hold_id = format!("{}:hold:{}", work.id, index);
            let mut hold_statement = self.prepare(
                "INSERT INTO work_hold
                 (hold_id, work_id, reason_code, actor_id, created_at)
                 VALUES (?1, ?2, ?3, NULL, ?4)",
            )?;
            hold_statement.bind_text(1, &hold_id)?;
            hold_statement.bind_text(2, work.id.as_str())?;
            hold_statement.bind_text(3, &hold.stable_code())?;
            hold_statement.bind_text(4, now)?;
            hold_statement.run()?;
        }

        for gate in &work.acceptance_profile.gates {
            let mut gate_statement = self.prepare(
                "INSERT INTO gate
                 (gate_id, work_id, profile_id, profile_version, kind, required, state, subject_ref, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'open', '', ?7)",
            )?;
            let normalized_gate_id = format!("{}:{}", work.id, gate.id);
            gate_statement.bind_text(1, &normalized_gate_id)?;
            gate_statement.bind_text(2, work.id.as_str())?;
            gate_statement.bind_text(3, work.acceptance_profile.id.as_str())?;
            gate_statement.bind_i64(4, profile_version)?;
            gate_statement.bind_text(5, gate_kind(gate.kind))?;
            gate_statement.bind_i64(6, u64::from(gate.required))?;
            gate_statement.bind_text(7, now)?;
            gate_statement.run()?;
        }
        Ok(())
    }

    pub fn work(&self, project_id: &str, work_id: &str) -> Result<Option<WorkRecord>, StoreError> {
        let mut statement = self.prepare(
            "SELECT work_id, project_id, kind, parent_id, lifecycle,
                    dispatch_policy, priority, title, description
             FROM work_item
             WHERE project_id = ?1 AND work_id = ?2",
        )?;
        statement.bind_text(1, project_id)?;
        statement.bind_text(2, work_id)?;
        if statement.step()? != SQLITE_ROW {
            return Ok(None);
        }
        Ok(Some(self.work_record_from_statement(&statement)?))
    }

    /// Returns a bounded continuation page of claim candidates. This is an
    /// indexed, keyset-paginated lookup for adapter selection; the canonical
    /// claim transaction still rechecks eligibility under its write lock.
    /// Callers must continue with the returned last ID rather than treating a
    /// first page as an existence boundary. This is a superset: timer/profile
    /// eligibility is evaluated by the domain inside claim, not by lexical SQL
    /// timestamp comparison. Continue after a rejected candidate.
    pub fn claimable_work_candidates(
        &self,
        project_id: &str,
        _now: &str,
        limit: u64,
        after_work_id: Option<&str>,
    ) -> Result<Vec<String>, StoreError> {
        if limit == 0 || limit > 1_000 {
            return Err(StoreError::Invalid(
                "claimable candidate limit must be 1..=1000".to_owned(),
            ));
        }
        let mut statement = self.prepare(
            "SELECT wi.work_id
             FROM work_item wi
             WHERE wi.project_id = ?1
               AND wi.lifecycle = 'open'
               AND wi.kind = 'task'
               AND wi.dispatch_policy = 'automatic'
               AND (?2 IS NULL OR wi.work_id > ?2)
               AND NOT EXISTS (
                 SELECT 1 FROM attempt a
                 WHERE a.work_id = wi.work_id AND a.current = 1
               )
               AND NOT EXISTS (
                 SELECT 1 FROM work_hold h
                 WHERE h.work_id = wi.work_id AND h.resolved_at IS NULL
               )
               AND NOT EXISTS (
                 SELECT 1 FROM dependency d
                 JOIN work_item blocker
                   ON blocker.project_id = d.project_id
                  AND blocker.work_id = d.prerequisite_id
                 WHERE d.project_id = wi.project_id
                   AND d.dependent_id = wi.work_id
                   AND blocker.lifecycle <> 'closed'
               )
               AND NOT EXISTS (
                 SELECT 1 FROM boreal_recovery_obligation r
                 WHERE r.project_id = wi.project_id
                   AND r.work_id = wi.work_id
                   AND r.state = 'unresolved'
               )
             ORDER BY wi.work_id
             LIMIT ?3",
        )?;
        statement.bind_text(1, project_id)?;
        statement.bind_optional_text(2, after_work_id)?;
        statement.bind_i64(3, limit)?;
        let mut ids = Vec::new();
        while statement.step()? == SQLITE_ROW {
            ids.push(statement.column_text(0)?);
        }
        Ok(ids)
    }

    fn has_unresolved_recovery(&self, project_id: &str, work_id: &str) -> Result<bool, StoreError> {
        if !self.table_exists("boreal_recovery_obligation")? {
            return Err(StoreError::Corrupt(
                "production schema is missing recovery obligations".to_owned(),
            ));
        }
        let mut statement = self.prepare(
            "SELECT 1
             FROM boreal_recovery_obligation
             WHERE project_id = ?1 AND work_id = ?2 AND state = 'unresolved'
             LIMIT 1",
        )?;
        statement.bind_text(1, project_id)?;
        statement.bind_text(2, work_id)?;
        Ok(statement.step()? == SQLITE_ROW)
    }

    pub fn work_holds(&self, work_id: &str) -> Result<Vec<WorkHoldRecord>, StoreError> {
        let mut statement = self.prepare(
            "SELECT hold_id, work_id, reason_code, actor_id, created_at,
                    resolved_at, resolved_by, resolution_reason
             FROM work_hold
             WHERE work_id = ?1
             ORDER BY hold_id",
        )?;
        statement.bind_text(1, work_id)?;
        let mut holds = Vec::new();
        while statement.step()? == SQLITE_ROW {
            holds.push(WorkHoldRecord {
                hold_id: statement.column_text(0)?,
                work_id: statement.column_text(1)?,
                reason_code: statement.column_text(2)?,
                actor_id: statement.column_optional_text(3)?,
                created_at: statement.column_text(4)?,
                resolved_at: statement.column_optional_text(5)?,
                resolved_by: statement.column_optional_text(6)?,
                resolution_reason: statement.column_optional_text(7)?,
            });
        }
        Ok(holds)
    }

    fn active_hard_holds(&self, work_id: &str) -> Result<Vec<ReasonCode>, StoreError> {
        let mut statement = self.prepare(
            "SELECT reason_code FROM work_hold
             WHERE work_id = ?1 AND resolved_at IS NULL
             ORDER BY hold_id",
        )?;
        statement.bind_text(1, work_id)?;
        let mut holds = Vec::new();
        while statement.step()? == SQLITE_ROW {
            holds.push(ReasonCode::HardHold(statement.column_text(0)?));
        }
        Ok(holds)
    }

    fn work_record_from_statement(
        &self,
        statement: &Statement<'_>,
    ) -> Result<WorkRecord, StoreError> {
        let work_id = statement.column_text(0)?;
        Ok(WorkRecord {
            work_id: work_id.clone(),
            project_id: statement.column_text(1)?,
            kind: statement.column_text(2)?,
            parent_id: statement.column_optional_text(3)?,
            lifecycle: statement.column_text(4)?,
            dispatch_policy: statement.column_text(5)?,
            priority: u8::try_from(statement.column_u64(6)?).map_err(|_| {
                StoreError::Corrupt(format!("work {work_id} has priority outside u8 range"))
            })?,
            hard_holds: self.active_hard_holds(&work_id)?,
            title: statement.column_text(7)?,
            description: statement.column_text(8)?,
        })
    }

    /// Resolves a profile-facing gate ID to the unique normalized gate row
    /// for one work. Older/manual fixtures may already use an unscoped ID, so
    /// the exact form remains accepted before the namespaced form.
    pub fn gate_id_for_work(
        &self,
        project_id: &str,
        work_id: &str,
        requested_gate_id: &str,
    ) -> Result<String, StoreError> {
        let mut statement = self.prepare(
            "SELECT g.gate_id
             FROM gate g JOIN work_item wi ON wi.work_id = g.work_id
             WHERE wi.project_id = ?1 AND g.work_id = ?2
               AND (g.gate_id = ?3 OR g.gate_id LIKE ?4)
             ORDER BY CASE WHEN g.gate_id = ?3 THEN 0 ELSE 1 END
             LIMIT 1",
        )?;
        let suffix = format!("%:{requested_gate_id}");
        statement.bind_text(1, project_id)?;
        statement.bind_text(2, work_id)?;
        statement.bind_text(3, requested_gate_id)?;
        statement.bind_text(4, &suffix)?;
        match statement.step()? {
            SQLITE_ROW => statement.column_text(0),
            SQLITE_DONE => Err(StoreError::NotFound {
                entity: "gate",
                id: requested_gate_id.to_owned(),
            }),
            _ => unreachable!(),
        }
    }

    pub fn add_dependency(
        &self,
        project_id: &str,
        prerequisite_id: &str,
        dependent_id: &str,
        now: &str,
    ) -> Result<(), StoreError> {
        let expected_revision = self.project_revision(project_id)?.0;
        self.add_dependency_checked(
            project_id,
            prerequisite_id,
            dependent_id,
            expected_revision,
            now,
        )
    }

    /// Adds a dependency only if the project is still at the caller's
    /// observed revision. The legacy convenience method above captures its
    /// revision immediately before entering this same transaction, so there
    /// is no unguarded dependency write path.
    pub fn add_dependency_checked(
        &self,
        project_id: &str,
        prerequisite_id: &str,
        dependent_id: &str,
        expected_revision: u64,
        now: &str,
    ) -> Result<(), StoreError> {
        self.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| {
            check_expected_revision(
                self.project_revision(project_id)?.0,
                Some(expected_revision),
            )?;
            self.add_dependency_in_transaction(project_id, prerequisite_id, dependent_id, now)
        })();
        finish_transaction(self, result)
    }

    fn add_dependency_in_transaction(
        &self,
        project_id: &str,
        prerequisite_id: &str,
        dependent_id: &str,
        now: &str,
    ) -> Result<(), StoreError> {
        if prerequisite_id == dependent_id {
            return Err(StoreError::Conflict(
                "dependency cycle: a work item cannot depend on itself".to_owned(),
            ));
        }
        if self.dependency_would_cycle(project_id, prerequisite_id, dependent_id)? {
            return Err(StoreError::Conflict(format!(
                "dependency cycle: {dependent_id} already reaches {prerequisite_id}"
            )));
        }
        let mut statement = self.prepare(
            "INSERT INTO dependency
             (project_id, prerequisite_id, dependent_id, satisfaction_policy, policy_version, created_at)
             VALUES (?1, ?2, ?3, 'closed_only', 'edge/1', ?4)",
        )?;
        statement.bind_text(1, project_id)?;
        statement.bind_text(2, prerequisite_id)?;
        statement.bind_text(3, dependent_id)?;
        statement.bind_text(4, now)?;
        statement.run()
    }

    fn dependency_would_cycle(
        &self,
        project_id: &str,
        prerequisite_id: &str,
        dependent_id: &str,
    ) -> Result<bool, StoreError> {
        let mut statement = self.prepare(
            "WITH RECURSIVE reachable(work_id) AS (
                 SELECT ?3
                 UNION
                 SELECT d.dependent_id
                 FROM dependency d
                 JOIN reachable r ON r.work_id = d.prerequisite_id
                 WHERE d.project_id = ?1
             )
             SELECT 1 FROM reachable WHERE work_id = ?2 LIMIT 1",
        )?;
        statement.bind_text(1, project_id)?;
        statement.bind_text(2, prerequisite_id)?;
        statement.bind_text(3, dependent_id)?;
        Ok(statement.step()? == SQLITE_ROW)
    }

    pub fn create_work_operation(
        &self,
        work: &WorkItem,
        actor_id: &str,
        operation_id: &str,
        request_digest: &str,
        now: &str,
    ) -> Result<MutationResult, StoreError> {
        self.create_work_operation_checked(work, actor_id, operation_id, request_digest, None, now)
    }

    /// Creates work while enforcing the caller's snapshot revision inside the
    /// write transaction. `None` is retained only for compatibility callers;
    /// new adapters should provide the revision they observed and include it
    /// in their request digest.
    pub fn create_work_operation_checked(
        &self,
        work: &WorkItem,
        actor_id: &str,
        operation_id: &str,
        request_digest: &str,
        expected_project_revision: Option<u64>,
        now: &str,
    ) -> Result<MutationResult, StoreError> {
        self.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| {
            if let Some(existing) = self.preflight_operation_replay(
                work.project_id.as_str(),
                operation_id,
                "work.create",
                actor_id,
                None,
                expected_project_revision,
                None,
                None,
                request_digest,
                "work",
                work.id.as_str(),
            )? {
                return Ok(MutationResult {
                    operation_id: operation_id.to_owned(),
                    revision: existing.revision,
                    replayed: true,
                });
            }
            check_expected_revision(
                self.project_revision(work.project_id.as_str())?.0,
                expected_project_revision,
            )?;
            self.create_work_in_transaction(work, now)?;
            let revision = self.bump_revision_in_transaction(work.project_id.as_str())?;
            let payload = json_object(json!({"work_id": work.id.as_str()}))?;
            let operation = OperationRecord {
                operation_id: operation_id.to_owned(),
                project_id: work.project_id.to_string(),
                command: "work.create".to_owned(),
                actor_id: actor_id.to_owned(),
                session_id: None,
                expected_revision: expected_project_revision,
                attempt_id: None,
                fence: None,
                request_digest: request_digest.to_owned(),
                outcome: OperationOutcome::Changed,
                result_json: payload.clone(),
                revision: revision.0,
                created_at: now.to_owned(),
                completed_at: Some(now.to_owned()),
            };
            let audit = AuditEventRecord {
                project_id: work.project_id.to_string(),
                revision: revision.0,
                operation_id: operation_id.to_owned(),
                event_type: "work.created".to_owned(),
                subject_type: "work".to_owned(),
                subject_id: work.id.to_string(),
                actor_id: actor_id.to_owned(),
                session_id: None,
                fence: None,
                as_of: now.to_owned(),
                payload_json: payload,
            };
            self.append_operation_audit_in_transaction(operation, audit)?;
            Ok(MutationResult {
                operation_id: operation_id.to_owned(),
                revision: revision.0,
                replayed: false,
            })
        })();
        match result {
            Ok(value) => {
                self.execute_batch("COMMIT")?;
                Ok(value)
            }
            Err(error) => {
                let _ = self.execute_batch("ROLLBACK");
                Err(error)
            }
        }
    }

    /// Apply a planning edit to an existing work row. The operation is
    /// admitted before any row changes and the expected project revision is
    /// checked inside the same IMMEDIATE transaction as the update.
    pub fn edit_work_operation(
        &self,
        input: &WorkEditInput,
        actor_id: &str,
        operation_id: &str,
        request_digest: &str,
        expected_revision: u64,
        now: &str,
    ) -> Result<MutationResult, StoreError> {
        self.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| {
            if let Some(existing) = self.preflight_operation_replay(
                &input.project_id,
                operation_id,
                "work.edit",
                actor_id,
                None,
                Some(expected_revision),
                None,
                None,
                request_digest,
                "work",
                &input.work_id,
            )? {
                return Ok(MutationResult {
                    operation_id: existing.operation_id,
                    revision: existing.revision,
                    replayed: true,
                });
            }
            self.require_actor(actor_id)?;
            let actual = self.project_revision(&input.project_id)?.0;
            check_expected_revision(actual, Some(expected_revision))?;
            if self.work(&input.project_id, &input.work_id)?.is_none() {
                return Err(StoreError::NotFound {
                    entity: "work",
                    id: input.work_id.clone(),
                });
            }
            if input.title.as_deref().is_some_and(str::is_empty)
                || input
                    .description
                    .as_deref()
                    .is_some_and(|description| description.contains('\0'))
            {
                return Err(StoreError::Invalid(
                    "work title/description contains invalid content".to_owned(),
                ));
            }
            if input.parent_id.is_none()
                && input.title.is_none()
                && input.description.is_none()
                && input.priority.is_none()
                && input.dispatch_policy.is_none()
            {
                return Err(StoreError::Invalid(
                    "work edit requires at least one changed field".to_owned(),
                ));
            }
            if let Some(dispatch) = &input.dispatch_policy {
                if !matches!(dispatch.as_str(), "automatic" | "operator_only" | "paused") {
                    return Err(StoreError::Invalid("invalid dispatch policy".to_owned()));
                }
            }
            if let Some(title) = &input.title {
                let mut update = self.prepare(
                    "UPDATE work_item SET title = ?1, updated_at = ?2
                     WHERE project_id = ?3 AND work_id = ?4",
                )?;
                update.bind_text(1, title)?;
                update.bind_text(2, now)?;
                update.bind_text(3, &input.project_id)?;
                update.bind_text(4, &input.work_id)?;
                update.run()?;
            }
            if let Some(description) = &input.description {
                let mut update = self.prepare(
                    "UPDATE work_item SET description = ?1, updated_at = ?2
                     WHERE project_id = ?3 AND work_id = ?4",
                )?;
                update.bind_text(1, description)?;
                update.bind_text(2, now)?;
                update.bind_text(3, &input.project_id)?;
                update.bind_text(4, &input.work_id)?;
                update.run()?;
            }
            if let Some(parent_id) = &input.parent_id {
                let mut update = self.prepare(
                    "UPDATE work_item SET parent_id = ?1, updated_at = ?2
                     WHERE project_id = ?3 AND work_id = ?4",
                )?;
                update.bind_optional_text(1, parent_id.as_deref())?;
                update.bind_text(2, now)?;
                update.bind_text(3, &input.project_id)?;
                update.bind_text(4, &input.work_id)?;
                update.run()?;
            }
            if let Some(priority) = input.priority {
                let mut update = self.prepare(
                    "UPDATE work_item SET priority = ?1, updated_at = ?2
                     WHERE project_id = ?3 AND work_id = ?4",
                )?;
                update.bind_i64(1, u64::from(priority))?;
                update.bind_text(2, now)?;
                update.bind_text(3, &input.project_id)?;
                update.bind_text(4, &input.work_id)?;
                update.run()?;
            }
            if let Some(dispatch) = &input.dispatch_policy {
                let mut update = self.prepare(
                    "UPDATE work_item SET dispatch_policy = ?1, updated_at = ?2
                     WHERE project_id = ?3 AND work_id = ?4",
                )?;
                update.bind_text(1, dispatch)?;
                update.bind_text(2, now)?;
                update.bind_text(3, &input.project_id)?;
                update.bind_text(4, &input.work_id)?;
                update.run()?;
            }
            let revision = self.bump_revision_in_transaction(&input.project_id)?;
            let payload = json_object(json!({
                "work_id": input.work_id,
                "fields": {
                    "parent_id": input.parent_id,
                    "title": input.title,
                    "description": input.description,
                    "priority": input.priority,
                    "dispatch_policy": input.dispatch_policy,
                }
            }))?;
            self.append_operation_audit_in_transaction(
                OperationRecord {
                    operation_id: operation_id.to_owned(),
                    project_id: input.project_id.clone(),
                    command: "work.edit".to_owned(),
                    actor_id: actor_id.to_owned(),
                    session_id: None,
                    expected_revision: Some(expected_revision),
                    attempt_id: None,
                    fence: None,
                    request_digest: request_digest.to_owned(),
                    outcome: OperationOutcome::Changed,
                    result_json: payload.clone(),
                    revision: revision.0,
                    created_at: now.to_owned(),
                    completed_at: Some(now.to_owned()),
                },
                AuditEventRecord {
                    project_id: input.project_id.clone(),
                    revision: revision.0,
                    operation_id: operation_id.to_owned(),
                    event_type: "repair.correction".to_owned(),
                    subject_type: "work".to_owned(),
                    subject_id: input.work_id.clone(),
                    actor_id: actor_id.to_owned(),
                    session_id: None,
                    fence: None,
                    as_of: now.to_owned(),
                    payload_json: payload,
                },
            )?;
            Ok(MutationResult {
                operation_id: operation_id.to_owned(),
                revision: revision.0,
                replayed: false,
            })
        })();
        finish_transaction(self, result)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn remove_dependency_operation(
        &self,
        project_id: &str,
        prerequisite_id: &str,
        dependent_id: &str,
        actor_id: &str,
        operation_id: &str,
        request_digest: &str,
        expected_revision: u64,
        now: &str,
    ) -> Result<MutationResult, StoreError> {
        self.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| {
            if let Some(existing) = self.preflight_operation_replay(
                project_id,
                operation_id,
                "dependency.remove",
                actor_id,
                None,
                Some(expected_revision),
                None,
                None,
                request_digest,
                "dependency",
                dependent_id,
            )? {
                return Ok(MutationResult {
                    operation_id: existing.operation_id,
                    revision: existing.revision,
                    replayed: true,
                });
            }
            self.require_actor(actor_id)?;
            let actual = self.project_revision(project_id)?.0;
            check_expected_revision(actual, Some(expected_revision))?;
            let mut delete = self.prepare(
                "DELETE FROM dependency
                 WHERE project_id = ?1 AND prerequisite_id = ?2 AND dependent_id = ?3",
            )?;
            delete.bind_text(1, project_id)?;
            delete.bind_text(2, prerequisite_id)?;
            delete.bind_text(3, dependent_id)?;
            delete.run()?;
            if delete.changes()? != 1 {
                return Err(StoreError::NotFound {
                    entity: "dependency",
                    id: format!("{prerequisite_id}->{dependent_id}"),
                });
            }
            let revision = self.bump_revision_in_transaction(project_id)?;
            let payload = json_object(json!({
                "prerequisite_id": prerequisite_id,
                "dependent_id": dependent_id,
            }))?;
            self.append_operation_audit_in_transaction(
                OperationRecord {
                    operation_id: operation_id.to_owned(),
                    project_id: project_id.to_owned(),
                    command: "dependency.remove".to_owned(),
                    actor_id: actor_id.to_owned(),
                    session_id: None,
                    expected_revision: Some(expected_revision),
                    attempt_id: None,
                    fence: None,
                    request_digest: request_digest.to_owned(),
                    outcome: OperationOutcome::Changed,
                    result_json: payload.clone(),
                    revision: revision.0,
                    created_at: now.to_owned(),
                    completed_at: Some(now.to_owned()),
                },
                AuditEventRecord {
                    project_id: project_id.to_owned(),
                    revision: revision.0,
                    operation_id: operation_id.to_owned(),
                    event_type: "repair.correction".to_owned(),
                    subject_type: "dependency".to_owned(),
                    subject_id: dependent_id.to_owned(),
                    actor_id: actor_id.to_owned(),
                    session_id: None,
                    fence: None,
                    as_of: now.to_owned(),
                    payload_json: payload,
                },
            )?;
            Ok(MutationResult {
                operation_id: operation_id.to_owned(),
                revision: revision.0,
                replayed: false,
            })
        })();
        finish_transaction(self, result)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn add_work_hold_operation(
        &self,
        input: &WorkHoldAddInput,
        actor_id: &str,
        operation_id: &str,
        request_digest: &str,
        expected_revision: u64,
        now: &str,
    ) -> Result<MutationResult, StoreError> {
        self.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| {
            if let Some(existing) = self.preflight_operation_replay(
                &input.project_id,
                operation_id,
                "work.hold.add",
                actor_id,
                None,
                Some(expected_revision),
                None,
                None,
                request_digest,
                "hold",
                &input.work_id,
            )? {
                return Ok(MutationResult {
                    operation_id: existing.operation_id,
                    revision: existing.revision,
                    replayed: true,
                });
            }
            self.require_actor(actor_id)?;
            let actual = self.project_revision(&input.project_id)?.0;
            check_expected_revision(actual, Some(expected_revision))?;
            if self.work(&input.project_id, &input.work_id)?.is_none() {
                return Err(StoreError::NotFound {
                    entity: "work",
                    id: input.work_id.clone(),
                });
            }
            let mut duplicate = self.prepare(
                "SELECT 1 FROM work_hold WHERE work_id = ?1 AND reason_code = ?2 AND resolved_at IS NULL LIMIT 1",
            )?;
            duplicate.bind_text(1, &input.work_id)?;
            duplicate.bind_text(2, &input.reason_code)?;
            if duplicate.step()? == SQLITE_ROW {
                return Err(StoreError::Conflict(
                    "an active hold with this reason already exists".to_owned(),
                ));
            }
            let hold_id = format!("{operation_id}:hold");
            let mut insert = self.prepare(
                "INSERT INTO work_hold (hold_id, work_id, reason_code, actor_id, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
            )?;
            insert.bind_text(1, &hold_id)?;
            insert.bind_text(2, &input.work_id)?;
            insert.bind_text(3, &input.reason_code)?;
            insert.bind_text(4, actor_id)?;
            insert.bind_text(5, now)?;
            insert.run()?;
            let revision = self.bump_revision_in_transaction(&input.project_id)?;
            let payload = json_object(
                json!({"work_id": input.work_id, "hold_id": hold_id, "reason_code": input.reason_code}),
            )?;
            self.append_operation_audit_in_transaction(
                OperationRecord {
                    operation_id: operation_id.to_owned(),
                    project_id: input.project_id.clone(),
                    command: "work.hold.add".to_owned(),
                    actor_id: actor_id.to_owned(),
                    session_id: None,
                    expected_revision: Some(expected_revision),
                    attempt_id: None,
                    fence: None,
                    request_digest: request_digest.to_owned(),
                    outcome: OperationOutcome::Changed,
                    result_json: payload.clone(),
                    revision: revision.0,
                    created_at: now.to_owned(),
                    completed_at: Some(now.to_owned()),
                },
                AuditEventRecord {
                    project_id: input.project_id.clone(),
                    revision: revision.0,
                    operation_id: operation_id.to_owned(),
                    event_type: "repair.correction".to_owned(),
                    subject_type: "hold".to_owned(),
                    subject_id: input.work_id.clone(),
                    actor_id: actor_id.to_owned(),
                    session_id: None,
                    fence: None,
                    as_of: now.to_owned(),
                    payload_json: payload,
                },
            )?;
            Ok(MutationResult {
                operation_id: operation_id.to_owned(),
                revision: revision.0,
                replayed: false,
            })
        })();
        finish_transaction(self, result)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn resolve_work_hold_operation(
        &self,
        project_id: &str,
        work_id: &str,
        hold_id: &str,
        actor_id: &str,
        resolution_reason: &str,
        operation_id: &str,
        request_digest: &str,
        expected_revision: u64,
        now: &str,
    ) -> Result<MutationResult, StoreError> {
        self.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| {
            if let Some(existing) = self.preflight_operation_replay(
                project_id,
                operation_id,
                "work.hold.resolve",
                actor_id,
                None,
                Some(expected_revision),
                None,
                None,
                request_digest,
                "hold",
                hold_id,
            )? {
                return Ok(MutationResult {
                    operation_id: existing.operation_id,
                    revision: existing.revision,
                    replayed: true,
                });
            }
            if self.actor_context(actor_id)?.role != boreal_domain::ActorRole::Operator {
                return Err(StoreError::Conflict(
                    "role_denied: hold resolution requires operator".to_owned(),
                ));
            }
            if self.work(project_id, work_id)?.is_none() {
                return Err(StoreError::NotFound {
                    entity: "project work",
                    id: work_id.to_owned(),
                });
            }
            if resolution_reason.trim().is_empty() {
                return Err(StoreError::Invalid(
                    "hold resolution reason is required".to_owned(),
                ));
            }
            let actual = self.project_revision(project_id)?.0;
            check_expected_revision(actual, Some(expected_revision))?;
            let mut update = self.prepare(
                "UPDATE work_hold SET resolved_at = ?1, resolved_by = ?2, resolution_reason = ?3
                 WHERE hold_id = ?4 AND work_id = ?5 AND resolved_at IS NULL",
            )?;
            update.bind_text(1, now)?;
            update.bind_text(2, actor_id)?;
            update.bind_text(3, resolution_reason)?;
            update.bind_text(4, hold_id)?;
            update.bind_text(5, work_id)?;
            update.run()?;
            if update.changes()? != 1 {
                return Err(StoreError::NotFound {
                    entity: "active work hold",
                    id: hold_id.to_owned(),
                });
            }
            let revision = self.bump_revision_in_transaction(project_id)?;
            let payload = json_object(
                json!({"work_id": work_id, "hold_id": hold_id, "resolution_reason": resolution_reason}),
            )?;
            self.append_operation_audit_in_transaction(
                OperationRecord {
                    operation_id: operation_id.to_owned(),
                    project_id: project_id.to_owned(),
                    command: "work.hold.resolve".to_owned(),
                    actor_id: actor_id.to_owned(),
                    session_id: None,
                    expected_revision: Some(expected_revision),
                    attempt_id: None,
                    fence: None,
                    request_digest: request_digest.to_owned(),
                    outcome: OperationOutcome::Changed,
                    result_json: payload.clone(),
                    revision: revision.0,
                    created_at: now.to_owned(),
                    completed_at: Some(now.to_owned()),
                },
                AuditEventRecord {
                    project_id: project_id.to_owned(),
                    revision: revision.0,
                    operation_id: operation_id.to_owned(),
                    event_type: "hold.resolved".to_owned(),
                    subject_type: "hold".to_owned(),
                    subject_id: hold_id.to_owned(),
                    actor_id: actor_id.to_owned(),
                    session_id: None,
                    fence: None,
                    as_of: now.to_owned(),
                    payload_json: payload,
                },
            )?;
            Ok(MutationResult {
                operation_id: operation_id.to_owned(),
                revision: revision.0,
                replayed: false,
            })
        })();
        finish_transaction(self, result)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn add_dependency_operation(
        &self,
        project_id: &str,
        prerequisite_id: &str,
        dependent_id: &str,
        actor_id: &str,
        operation_id: &str,
        request_digest: &str,
        now: &str,
    ) -> Result<MutationResult, StoreError> {
        // An operation retry must use the revision captured by the original
        // operation.  Re-reading the current project revision here would make
        // an exact retry conflict after the first dependency mutation bumped
        // the revision.  The checked path still performs the authoritative
        // identity, digest, subject, and revision checks inside its write
        // transaction.
        let expected_revision = match self.operation(operation_id)? {
            Some(existing) => existing.expected_revision,
            None => Some(self.project_revision(project_id)?.0),
        };
        self.add_dependency_operation_checked(
            project_id,
            prerequisite_id,
            dependent_id,
            actor_id,
            operation_id,
            request_digest,
            expected_revision,
            now,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn add_dependency_operation_checked(
        &self,
        project_id: &str,
        prerequisite_id: &str,
        dependent_id: &str,
        actor_id: &str,
        operation_id: &str,
        request_digest: &str,
        expected_revision: Option<u64>,
        now: &str,
    ) -> Result<MutationResult, StoreError> {
        self.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| {
            let current_revision = self.project_revision(project_id)?.0;
            let expected_revision = expected_revision.unwrap_or(current_revision);
            if let Some(existing) = self.preflight_operation_replay(
                project_id,
                operation_id,
                "dependency.add",
                actor_id,
                None,
                Some(expected_revision),
                None,
                None,
                request_digest,
                "dependency",
                dependent_id,
            )? {
                return Ok(MutationResult {
                    operation_id: existing.operation_id,
                    revision: existing.revision,
                    replayed: true,
                });
            }
            check_expected_revision(current_revision, Some(expected_revision))?;
            self.add_dependency_in_transaction(project_id, prerequisite_id, dependent_id, now)?;
            let revision = self.bump_revision_in_transaction(project_id)?;
            let payload = json_object(json!({
                "prerequisite_id": prerequisite_id,
                "dependent_id": dependent_id,
            }))?;
            self.append_operation_audit_in_transaction(
                OperationRecord {
                    operation_id: operation_id.to_owned(),
                    project_id: project_id.to_owned(),
                    command: "dependency.add".to_owned(),
                    actor_id: actor_id.to_owned(),
                    session_id: None,
                    expected_revision: Some(expected_revision),
                    attempt_id: None,
                    fence: None,
                    request_digest: request_digest.to_owned(),
                    outcome: OperationOutcome::Changed,
                    result_json: payload.clone(),
                    revision: revision.0,
                    created_at: now.to_owned(),
                    completed_at: Some(now.to_owned()),
                },
                AuditEventRecord {
                    project_id: project_id.to_owned(),
                    revision: revision.0,
                    operation_id: operation_id.to_owned(),
                    event_type: "work.created".to_owned(),
                    subject_type: "dependency".to_owned(),
                    subject_id: dependent_id.to_owned(),
                    actor_id: actor_id.to_owned(),
                    session_id: None,
                    fence: None,
                    as_of: now.to_owned(),
                    payload_json: payload,
                },
            )?;
            Ok(MutationResult {
                operation_id: operation_id.to_owned(),
                revision: revision.0,
                replayed: false,
            })
        })();
        match result {
            Ok(value) => {
                self.execute_batch("COMMIT")?;
                Ok(value)
            }
            Err(error) => {
                let _ = self.execute_batch("ROLLBACK");
                Err(error)
            }
        }
    }

    /// Materializes a bounded page and its unbounded total under one read
    /// revision. The transaction is committed before callers render or encode.
    pub fn list_work(
        &self,
        project_id: &str,
        limit: u64,
        offset: u64,
    ) -> Result<WorkPage, StoreError> {
        if limit == 0 || limit > 1_000 {
            return Err(StoreError::Invalid(
                "work page limit must be 1..=1000".to_owned(),
            ));
        }
        self.execute_batch("BEGIN")?;
        let result = (|| {
            let revision = self.project_revision(project_id)?;
            let mut count = self.prepare("SELECT COUNT(*) FROM work_item WHERE project_id = ?1")?;
            count.bind_text(1, project_id)?;
            let total = match count.step()? {
                SQLITE_ROW => count.column_u64(0)?,
                _ => return Err(StoreError::Corrupt("missing work total".to_owned())),
            };
            let mut rows = self.prepare(
                "SELECT work_id, project_id, kind, parent_id, lifecycle,
                        dispatch_policy, priority, title, description
                 FROM work_item WHERE project_id = ?1
                 ORDER BY work_id LIMIT ?2 OFFSET ?3",
            )?;
            rows.bind_text(1, project_id)?;
            rows.bind_i64(2, limit)?;
            rows.bind_i64(3, offset)?;
            let mut items = Vec::new();
            while rows.step()? == SQLITE_ROW {
                items.push(self.work_record_from_statement(&rows)?);
            }
            Ok(WorkPage {
                revision,
                total,
                items,
            })
        })();
        match result {
            Ok(page) => {
                self.execute_batch("COMMIT")?;
                Ok(page)
            }
            Err(error) => {
                let _ = self.execute_batch("ROLLBACK");
                Err(error)
            }
        }
    }

    /// Reads the complete canonical status input for a project under one
    /// SQLite read transaction. No derived status is persisted here: callers
    /// receive the work graph, current attempt rows, and gate diagnostics and
    /// may apply the application projection and pagination afterward.
    pub fn read_project_status(&self, project_id: &str) -> Result<ProjectStatusRead, StoreError> {
        self.execute_batch("BEGIN")?;
        let result = self.read_project_status_in_transaction(project_id);
        finish_transaction(self, result)
    }

    /// Reports whether the immutable requirement projection is available to a
    /// status read. Canonical production stores must have the complete
    /// migration-installed contract; schema-v2 fixtures may retain the
    /// observed-gate fallback until they opt into the projection.
    fn pinned_requirement_schema_installed_for_read(&self) -> Result<bool, StoreError> {
        if self.canonical_production {
            ProfileStore::new(self).ensure_pinned_requirements_schema()?;
            return Ok(true);
        }
        Ok(self.table_exists("boreal_pinned_requirement")?
            && self.table_exists("boreal_pinned_requirement_gate")?)
    }

    /// Reads the immutable requirement snapshot when the caller is on the
    /// persisted-profile path. A noncanonical schema-v2 fixture without the
    /// additive tables retains its observed-gate compatibility behavior; an
    /// installed but missing/corrupt snapshot is never treated as empty.
    fn current_pinned_requirements_for_policy(
        &self,
        project_id: &str,
        work_id: &str,
    ) -> Result<Option<PinnedRequirements>, StoreError> {
        if !self.pinned_requirement_schema_installed_for_read()? {
            return Ok(None);
        }
        match ProfileStore::new(self).current_pinned_requirements(project_id, work_id) {
            Ok(requirements) => Ok(Some(requirements)),
            Err(StoreError::Corrupt(detail))
                if !self.canonical_production
                    && detail.starts_with("missing pinned requirement revision") =>
            {
                // Explicitly noncanonical schema-v2 fixtures may still use
                // observed gate rows until they opt into immutable pinned
                // requirements. A missing opt-in is compatibility fallback;
                // an existing but malformed snapshot remains quarantined.
                Ok(None)
            }
            Err(error) => Err(error),
        }
    }

    // Used by both read transactions and the canonical claim write transaction.
    // The caller owns the transaction boundary; never open a nested BEGIN here.
    fn read_project_status_in_transaction(
        &self,
        project_id: &str,
    ) -> Result<ProjectStatusRead, StoreError> {
        let revision = self.project_revision(project_id)?;
        let mut count = self.prepare("SELECT COUNT(*) FROM work_item WHERE project_id = ?1")?;
        count.bind_text(1, project_id)?;
        let total = match count.step()? {
            SQLITE_ROW => count.column_u64(0)?,
            _ => return Err(StoreError::Corrupt("missing work total".to_owned())),
        };

        // These two relations are independent of each work row. Fetching
        // them once keeps the canonical read consistent while removing
        // two avoidable N+1 query families from large status snapshots.
        let current_attempts = self.current_attempts_for_project(project_id)?;
        let active_holds = self.active_hard_holds_for_project(project_id)?;
        let gate_read =
            self.status_gate_diagnostics_for_project(project_id, &current_attempts, revision.0)?;
        let gate_diagnostics = gate_read.diagnostics;
        let requirement_diagnostics = gate_read.requirement_diagnostics;
        let mut planning_facts = self.status_planning_facts_for_project(project_id)?;

        let mut rows = self.prepare(
            "SELECT work_id, project_id, kind, parent_id, lifecycle,
                    dispatch_policy, retry_not_before, priority,
                    acceptance_profile_id, acceptance_profile_version,
                    title, description
             FROM work_item WHERE project_id = ?1 ORDER BY work_id",
        )?;
        rows.bind_text(1, project_id)?;
        let mut works = Vec::with_capacity(total as usize);
        let mut record_diagnostics = requirement_diagnostics
            .iter()
            .map(|(work_id, detail)| StatusRecordDiagnostic {
                work_id: work_id.clone(),
                title: None,
                code: "acceptance_requirements_corrupt".to_owned(),
                detail: detail.clone(),
            })
            .collect::<Vec<_>>();
        while rows.step()? == SQLITE_ROW {
            let work_id = rows.column_text(0)?;
            let current_attempt = current_attempts.get(&work_id).cloned();
            let diagnostics =
                gate_diagnostics
                    .get(&work_id)
                    .cloned()
                    .unwrap_or_else(|| GateDiagnostics {
                        project_id: project_id.to_owned(),
                        work_id: work_id.clone(),
                        attempt_id: current_attempt
                            .as_ref()
                            .map(|attempt| attempt.attempt_id.clone()),
                        fence: current_attempt.as_ref().map(|attempt| attempt.fence),
                        revision: revision.0,
                        gates: Vec::new(),
                        missing: Vec::new(),
                    });
            let gates = diagnostics
                .gates
                .iter()
                .map(|gate| GateRequirement {
                    id: gate.gate_id.clone().into(),
                    kind: gate.kind,
                    required: gate.required,
                    state: gate.state,
                })
                .collect();
            let title = rows.column_text(10).ok();
            let work = (|| {
                let (schedule, activation_at) = planning_facts
                    .remove(&work_id)
                    .unwrap_or(Ok((None, None)))?;
                let mut hard_holds = active_holds.get(&work_id).cloned().unwrap_or_default();
                if requirement_diagnostics.contains_key(&work_id) {
                    hard_holds.push(ReasonCode::HardHold("integrity_quarantined".to_owned()));
                }
                let work = WorkItem {
                    id: WorkId::new(work_id.clone()),
                    project_id: ProjectId::new(rows.column_text(1)?),
                    kind: parse_work_kind(&rows.column_text(2)?)?,
                    parent_id: rows.column_optional_text(3)?.map(WorkId::new),
                    title: rows.column_text(10)?,
                    description: rows.column_text(11)?,
                    lifecycle: parse_lifecycle(&rows.column_text(4)?)?,
                    priority: u8::try_from(rows.column_u64(7)?).map_err(|_| {
                        StoreError::Corrupt(format!("work {work_id} has priority outside u8 range"))
                    })?,
                    dispatch_policy: parse_dispatch_policy(&rows.column_text(5)?)?,
                    hard_holds,
                    acceptance_profile: AcceptanceProfile {
                        id: ProfileId::new(rows.column_text(8)?),
                        version: rows.column_u64(9)?.to_string(),
                        gates,
                    },
                };
                Ok::<_, StoreError>((work, schedule, activation_at))
            })();
            match work {
                Ok((work, schedule, activation_at)) => works.push(StatusWorkRecord {
                    work,
                    retry_not_before: rows.column_optional_text(6)?,
                    schedule,
                    activation_at,
                    current_attempt,
                    gate_diagnostics: diagnostics,
                }),
                Err(error) => record_diagnostics.push(StatusRecordDiagnostic {
                    work_id,
                    title,
                    code: "corrupt_record".to_owned(),
                    detail: error.to_string(),
                }),
            }
        }

        let mut dependencies = Vec::new();
        let mut edges = self.prepare(
            "SELECT prerequisite_id, dependent_id, satisfaction_policy
             FROM dependency WHERE project_id = ?1
             ORDER BY prerequisite_id, dependent_id",
        )?;
        edges.bind_text(1, project_id)?;
        while edges.step()? == SQLITE_ROW {
            dependencies.push(StatusDependencyRecord {
                prerequisite_id: WorkId::new(edges.column_text(0)?),
                dependent_id: WorkId::new(edges.column_text(1)?),
                policy: parse_dependency_policy(&edges.column_text(2)?)?,
            });
        }

        let mut snapshot = ProjectStatusRead {
            project_id: ProjectId::new(project_id),
            revision,
            total,
            works,
            diagnostics: record_diagnostics,
            dependencies,
        };
        status_evaluation::diagnose_status_integrity(&mut snapshot);
        Ok(snapshot)
    }

    /// Atomically reserves one eligible task, records its operation and audit
    /// event, and returns the same result when the operation ID is replayed.
    #[allow(clippy::too_many_arguments)]
    pub fn claim_work(
        &self,
        project_id: &str,
        work_id: &str,
        actor_id: &str,
        harness_id: &str,
        session_id: Option<&str>,
        attempt_id: &str,
        operation_id: &str,
        request_digest: &str,
        expected_revision: Option<u64>,
        claimed_at: &str,
        lease_deadline: &str,
        max_attempt_deadline: &str,
    ) -> Result<ClaimResult, StoreError> {
        self.claim_work_with_context(
            project_id,
            work_id,
            actor_id,
            harness_id,
            session_id,
            attempt_id,
            operation_id,
            request_digest,
            expected_revision,
            claimed_at,
            lease_deadline,
            max_attempt_deadline,
            None,
            "unknown",
        )
    }

    /// Claim an eligible work item while freezing the source/configuration
    /// context that later witnessed evidence must match.
    #[allow(clippy::too_many_arguments)]
    pub fn claim_work_with_context(
        &self,
        project_id: &str,
        work_id: &str,
        actor_id: &str,
        harness_id: &str,
        session_id: Option<&str>,
        attempt_id: &str,
        operation_id: &str,
        request_digest: &str,
        expected_revision: Option<u64>,
        claimed_at: &str,
        lease_deadline: &str,
        max_attempt_deadline: &str,
        source_version_id: Option<&str>,
        config_identity: &str,
    ) -> Result<ClaimResult, StoreError> {
        self.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| {
            // Re-read the operation after acquiring the write lock. This closes
            // the race where two retries both observed a missing operation.
            if let Some(existing) = self.preflight_claim_replay(
                project_id,
                operation_id,
                actor_id,
                session_id,
                attempt_id,
                expected_revision,
                request_digest,
            )? {
                return self.replay_claim(
                    project_id,
                    work_id,
                    actor_id,
                    harness_id,
                    session_id,
                    request_digest,
                    &existing,
                );
            }
            let current_revision = self.project_revision(project_id)?.0;
            if let Some(expected) = expected_revision {
                if expected != current_revision {
                    return Err(StoreError::StaleRevision {
                        expected,
                        actual: current_revision,
                    });
                }
            }

            if let Some(session_id) = session_id {
                self.session_for_claim(project_id, session_id, actor_id, harness_id)?;
            }

            if self.has_unresolved_recovery(project_id, work_id)? {
                return Err(StoreError::Conflict(
                    "recovery_required: resolve the prior attempt obligation before claiming"
                        .to_owned(),
                ));
            }

            let claimed_at_ms = status_evaluation::canonical_status_timestamp(claimed_at)?;
            let lease_at_ms = status_evaluation::canonical_status_timestamp(lease_deadline)?;
            let hard_at_ms = status_evaluation::canonical_status_timestamp(max_attempt_deadline)?;
            if lease_at_ms <= claimed_at_ms || hard_at_ms <= claimed_at_ms {
                return Err(StoreError::Invalid(
                    "claim deadlines must be strictly after claimed_at".to_owned(),
                ));
            }
            let decision =
                self.status_decision_in_transaction(project_id, work_id, actor_id, claimed_at_ms)?;
            if !decision.claimable_for_actor {
                return Err(StoreError::Conflict(format!(
                    "not_claimable: {}",
                    decision.primary_reason.stable_code()
                )));
            }

            let fence = self.next_fence(work_id)?;
            let mut attempt = self.prepare(
                "INSERT INTO attempt
                (attempt_id, work_id, actor_id, harness_id, session_id, fence, current, state,
                  claimed_at, lease_deadline, max_attempt_deadline, source_version_id, config_identity,
                  binary_identity, protocol_version, schema_version)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, 'claimed', ?7, ?8, ?9,
                         ?10, ?11, 'unknown', 'boreal.protocol.envelope.v1', 2)",
            )?;
            attempt.bind_text(1, attempt_id)?;
            attempt.bind_text(2, work_id)?;
            attempt.bind_text(3, actor_id)?;
            attempt.bind_text(4, harness_id)?;
            attempt.bind_optional_text(5, session_id)?;
            attempt.bind_i64(6, fence)?;
            attempt.bind_text(7, claimed_at)?;
            attempt.bind_text(8, lease_deadline)?;
            attempt.bind_text(9, max_attempt_deadline)?;
            attempt.bind_optional_text(10, source_version_id)?;
            attempt.bind_text(11, config_identity)?;
            attempt.run()?;

            let reservation_id = format!("reservation:{attempt_id}");
            let mut reservation = self.prepare(
                "INSERT INTO reservation
                 (reservation_id, work_id, attempt_id, fence, state, lease_deadline)
                 VALUES (?1, ?2, ?3, ?4, 'active', ?5)",
            )?;
            reservation.bind_text(1, &reservation_id)?;
            reservation.bind_text(2, work_id)?;
            reservation.bind_text(3, attempt_id)?;
            reservation.bind_i64(4, fence)?;
            reservation.bind_text(5, lease_deadline)?;
            reservation.run()?;

            self.reserve_resource_in_transaction(&recovery::ResourceReservationInput {
                reservation_id: format!("resource:{attempt_id}"),
                project_id: project_id.to_owned(),
                work_id: work_id.to_owned(),
                attempt_id: attempt_id.to_owned(),
                fence,
                resource_key: format!("work:{project_id}:{work_id}"),
                resource_kind: "execution_worktree".to_owned(),
                owner_actor_id: actor_id.to_owned(),
                created_at: claimed_at.to_owned(),
            })?;

            let revision = self.bump_revision_in_transaction(project_id)?;
            let operation = OperationRecord {
                operation_id: operation_id.to_owned(),
                project_id: project_id.to_owned(),
                command: "work.claim".to_owned(),
                actor_id: actor_id.to_owned(),
                session_id: session_id.map(str::to_owned),
                expected_revision,
                attempt_id: Some(attempt_id.to_owned()),
                fence: Some(fence),
                request_digest: request_digest.to_owned(),
                outcome: OperationOutcome::Changed,
                result_json: json_object(json!({
                    "attempt_id": attempt_id,
                    "fence": fence,
                }))?,
                revision: revision.0,
                created_at: claimed_at.to_owned(),
                completed_at: Some(claimed_at.to_owned()),
            };
            let audit = AuditEventRecord {
                project_id: project_id.to_owned(),
                revision: revision.0,
                operation_id: operation_id.to_owned(),
                event_type: "attempt.claimed".to_owned(),
                subject_type: "attempt".to_owned(),
                subject_id: attempt_id.to_owned(),
                actor_id: actor_id.to_owned(),
                session_id: session_id.map(str::to_owned),
                fence: Some(fence),
                as_of: claimed_at.to_owned(),
                payload_json: operation.result_json.clone(),
            };
            self.append_operation_audit_in_transaction(operation, audit)?;
            Ok(ClaimResult {
                operation_id: operation_id.to_owned(),
                attempt_id: attempt_id.to_owned(),
                fence,
                revision: revision.0,
                replayed: false,
            })
        })();
        match result {
            Ok(result) => {
                self.execute_batch("COMMIT")?;
                Ok(result)
            }
            Err(error) => {
                let _ = self.execute_batch("ROLLBACK");
                Err(error)
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn replay_claim(
        &self,
        project_id: &str,
        work_id: &str,
        actor_id: &str,
        harness_id: &str,
        session_id: Option<&str>,
        request_digest: &str,
        operation: &OperationRecord,
    ) -> Result<ClaimResult, StoreError> {
        if operation.project_id != project_id
            || operation.command != "work.claim"
            || operation.request_digest != request_digest
        {
            return Err(StoreError::Conflict(format!(
                "operation {} was already used with another request",
                operation.operation_id
            )));
        }
        let attempt_id = operation.attempt_id.as_deref().ok_or_else(|| {
            StoreError::Corrupt("claim operation has no attempt result".to_owned())
        })?;
        let fence = operation
            .fence
            .ok_or_else(|| StoreError::Corrupt("claim operation has no fence result".to_owned()))?;
        let attempt = self.attempt_record(attempt_id, false)?.ok_or_else(|| {
            StoreError::Corrupt("claim operation refers to missing attempt".to_owned())
        })?;
        if attempt.work_id != work_id {
            return Err(StoreError::WrongSubject {
                expected: work_id.to_owned(),
                actual: attempt.work_id,
            });
        }
        if attempt.actor_id != actor_id {
            return Err(StoreError::WrongOwner {
                expected: actor_id.to_owned(),
                actual: attempt.actor_id,
            });
        }
        if attempt.harness_id.as_deref() != Some(harness_id) {
            return Err(StoreError::WrongOwner {
                expected: harness_id.to_owned(),
                actual: attempt.harness_id.unwrap_or_default(),
            });
        }
        if attempt.session_id.as_deref() != session_id {
            return Err(StoreError::WrongOwner {
                expected: session_id.unwrap_or_default().to_owned(),
                actual: attempt.session_id.unwrap_or_default(),
            });
        }
        if let Some(session_id) = session_id {
            self.session_for_claim(project_id, session_id, actor_id, harness_id)?;
        }
        Ok(ClaimResult {
            operation_id: operation.operation_id.clone(),
            attempt_id: attempt_id.to_owned(),
            fence,
            revision: operation.revision,
            replayed: true,
        })
    }

    /// Reads the current attempt for an attempt ID. Historical attempts are
    /// intentionally not returned by this method: callers must explicitly
    /// choose a historical query before acting on one.
    pub fn current_attempt(
        &self,
        project_id: &str,
        attempt_id: &str,
    ) -> Result<AttemptRecord, StoreError> {
        let attempt =
            self.attempt_record(attempt_id, true)?
                .ok_or_else(|| StoreError::NotFound {
                    entity: "attempt",
                    id: attempt_id.to_owned(),
                })?;
        if attempt.project_id != project_id {
            return Err(StoreError::WrongSubject {
                expected: project_id.to_owned(),
                actual: attempt.project_id,
            });
        }
        Ok(attempt)
    }

    fn current_attempts_for_project(
        &self,
        project_id: &str,
    ) -> Result<BTreeMap<String, AttemptRecord>, StoreError> {
        let mut statement = self.prepare(
            "SELECT wi.project_id, a.work_id, a.attempt_id, a.actor_id,
                    a.harness_id, a.session_id, a.fence, a.current, a.state,
                    a.claimed_at, a.accepted_at, a.lease_deadline,
                    a.max_attempt_deadline, a.last_heartbeat_at,
                    a.last_checkpoint_at, a.review_required_after_expiry,
                    a.stop_requested_at, a.stop_acknowledged_at, a.terminal_at,
                    a.terminal_reason, a.source_version_id, a.config_identity,
                    a.binary_identity, a.protocol_version, a.schema_version
             FROM attempt a JOIN work_item wi ON wi.work_id = a.work_id
             WHERE wi.project_id = ?1 AND a.current = 1
             ORDER BY a.work_id, a.attempt_id",
        )?;
        statement.bind_text(1, project_id)?;
        let mut attempts = BTreeMap::new();
        while statement.step()? == SQLITE_ROW {
            let attempt = self.attempt_from_statement(&statement)?;
            attempts.insert(attempt.work_id.clone(), attempt);
        }
        Ok(attempts)
    }

    fn active_hard_holds_for_project(
        &self,
        project_id: &str,
    ) -> Result<BTreeMap<String, Vec<ReasonCode>>, StoreError> {
        let mut statement = self.prepare(
            "SELECT wh.work_id, wh.reason_code
             FROM work_hold wh JOIN work_item wi ON wi.work_id = wh.work_id
             WHERE wi.project_id = ?1 AND wh.resolved_at IS NULL
             ORDER BY wh.work_id, wh.hold_id",
        )?;
        statement.bind_text(1, project_id)?;
        let mut holds = BTreeMap::new();
        while statement.step()? == SQLITE_ROW {
            holds
                .entry(statement.column_text(0)?)
                .or_insert_with(Vec::new)
                .push(ReasonCode::HardHold(statement.column_text(1)?));
        }
        Ok(holds)
    }

    /// Loads all status gate facts for a project in bounded relation scans.
    /// Persisted gate rows, current-attempt receipts, reviews, and summaries
    /// are fetched in batches; the per-work status loop only combines already
    /// materialized facts. This keeps ordinary status reads from preparing a
    /// gate query for every work item while retaining the attempt/fence proof
    /// rules used by [`gate_diagnostics_at_revision`].
    fn status_gate_diagnostics_for_project(
        &self,
        project_id: &str,
        current_attempts: &BTreeMap<String, AttemptRecord>,
        revision: u64,
    ) -> Result<StatusGateRead, StoreError> {
        let pinned_schema_installed = self.pinned_requirement_schema_installed_for_read()?;
        let mut requirement_diagnostics = BTreeMap::new();
        if self.canonical_production && !pinned_schema_installed {
            return Err(StoreError::Corrupt(
                "canonical production schema is missing pinned requirement tables".to_owned(),
            ));
        }
        let mut gate_rows = Vec::new();
        let gate_query = if pinned_schema_installed {
            "SELECT p.work_id, p.proof_revision, p.subject_kind,
                    p.profile_id, p.profile_version, p.profile_digest,
                    p.provenance_json, p.declarations_json, p.resolved_digest,
                    ap.policy_digest, ap.definition_json
             FROM boreal_pinned_requirement p
             LEFT JOIN acceptance_profile ap
               ON ap.profile_id = p.profile_id
              AND ap.version = p.profile_version
             WHERE p.project_id = ?1
               AND p.proof_revision = (
                 SELECT MAX(current.proof_revision)
                 FROM boreal_pinned_requirement current
                 WHERE current.project_id = p.project_id
                   AND current.work_id = p.work_id
               )
             ORDER BY p.work_id"
        } else {
            "SELECT g.work_id, 0, '', g.profile_id, g.profile_version,
                    '', '', '', '', '', g.kind, g.required, g.state
             FROM gate g JOIN work_item wi ON wi.work_id = g.work_id
             WHERE wi.project_id = ?1
             ORDER BY g.work_id, g.gate_id"
        };
        let mut statement = self.prepare(gate_query)?;
        statement.bind_text(1, project_id)?;
        if pinned_schema_installed {
            let mut requirements = BTreeMap::<String, PinnedRequirements>::new();
            while statement.step()? == SQLITE_ROW {
                let work_id = statement.column_text(0)?;
                let result = (|| {
                    let proof_revision = statement.column_u64(1)?;
                    let subject_kind = match statement.column_text(2)?.as_str() {
                        "task" => RequirementSubjectKind::Task,
                        "container" => RequirementSubjectKind::Container,
                        value => {
                            return Err(StoreError::Corrupt(format!(
                                "unknown pinned requirement subject kind: {value}"
                            )))
                        }
                    };
                    let profile_id = statement.column_text(3)?;
                    let profile_version = statement.column_u64(4)?;
                    let profile_digest = statement.column_text(5)?;
                    let provenance_json = statement.column_text(6)?;
                    let declarations_json = statement.column_text(7)?;
                    let resolved_digest = statement.column_text(8)?;
                    let stored_profile_digest = statement.column_optional_text(9)?.ok_or_else(|| {
                        StoreError::Corrupt(format!(
                            "pinned requirements reference missing acceptance profile {profile_id}/{profile_version}"
                        ))
                    })?;
                    let definition_json = statement.column_optional_text(10)?.ok_or_else(|| {
                        StoreError::Corrupt(format!(
                            "pinned requirements reference missing acceptance profile {profile_id}/{profile_version}"
                        ))
                    })?;
                    if stored_profile_digest != profile_digest {
                        return Err(StoreError::Corrupt(format!(
                            "pinned requirements profile digest drift for {profile_id}/{profile_version}: pinned {profile_digest}, stored {stored_profile_digest}"
                        )));
                    }
                    let profile = ProfileVersion::new(
                        profile_id.clone(),
                        profile_version,
                        stored_profile_digest,
                        definition_json,
                        "persisted",
                    )?;
                    profile.validate_content_digest().map_err(|error| {
                        StoreError::Corrupt(format!(
                            "acceptance profile {profile_id}/{profile_version} content is not immutable: {error}"
                        ))
                    })?;
                    let provenance: Value =
                        serde_json::from_str(&provenance_json).map_err(|_| {
                            StoreError::Corrupt(
                                "pinned requirements provenance is not valid JSON".to_owned(),
                            )
                        })?;
                    let provenance_object = provenance.as_object().ok_or_else(|| {
                        StoreError::Corrupt(
                            "pinned requirements provenance is not an object".to_owned(),
                        )
                    })?;
                    let provenance_profile_id = provenance_object
                        .get("profile_id")
                        .and_then(Value::as_str)
                        .ok_or_else(|| {
                            StoreError::Corrupt(
                                "pinned provenance profile id is invalid".to_owned(),
                            )
                        })?;
                    let provenance_profile_version = provenance_object
                        .get("profile_version")
                        .and_then(Value::as_u64)
                        .ok_or_else(|| {
                            StoreError::Corrupt(
                                "pinned provenance profile version is invalid".to_owned(),
                            )
                        })?;
                    let provenance_profile_digest = provenance_object
                        .get("profile_digest")
                        .and_then(Value::as_str)
                        .ok_or_else(|| {
                            StoreError::Corrupt(
                                "pinned provenance profile digest is invalid".to_owned(),
                            )
                        })?;
                    let resolved_at = provenance_object
                        .get("resolved_at")
                        .and_then(Value::as_str)
                        .ok_or_else(|| {
                            StoreError::Corrupt(
                                "pinned provenance resolved_at is invalid".to_owned(),
                            )
                        })?;
                    let provenance_source = provenance_object
                        .get("source")
                        .and_then(Value::as_str)
                        .ok_or_else(|| {
                            StoreError::Corrupt("pinned provenance source is invalid".to_owned())
                        })?;
                    if provenance_profile_id != profile_id
                        || provenance_profile_version != profile_version
                        || provenance_profile_digest != profile_digest
                        || provenance_source.is_empty()
                        || resolved_at.is_empty()
                    {
                        return Err(StoreError::Corrupt(format!(
                            "pinned requirements provenance drifted for {project_id}/{work_id}"
                        )));
                    }
                    let resolved = PinnedRequirements::resolve(
                        &profile,
                        project_id,
                        &work_id,
                        proof_revision,
                        subject_kind,
                        resolved_at,
                    )?;
                    let persisted_declarations: Value = serde_json::from_str(&declarations_json)
                        .map_err(|_| {
                            StoreError::Corrupt(format!(
                                "pinned requirements declarations are not valid JSON for {work_id}"
                            ))
                        })?;
                    let resolved_document: Value =
                        serde_json::from_str(&resolved.canonical_json()?).map_err(|_| {
                            StoreError::Corrupt(format!(
                                "pinned requirements canonical document is malformed for {work_id}"
                            ))
                        })?;
                    if persisted_declarations
                        != resolved_document
                            .get("requirements")
                            .cloned()
                            .unwrap_or(Value::Null)
                        || resolved_digest != resolved.resolved_digest
                    {
                        return Err(StoreError::Corrupt(format!(
                            "pinned requirement header drifted for {project_id}/{work_id}/revision-{proof_revision}"
                        )));
                    }
                    Ok(resolved)
                })();
                match result {
                    Ok(resolved) => {
                        requirements.insert(work_id, resolved);
                    }
                    Err(StoreError::Corrupt(detail)) => {
                        requirement_diagnostics.insert(work_id, detail);
                    }
                    Err(other) => return Err(other),
                }
            }

            let mut work_ids = self
                .prepare("SELECT work_id FROM work_item WHERE project_id = ?1 ORDER BY work_id")?;
            work_ids.bind_text(1, project_id)?;
            while work_ids.step()? == SQLITE_ROW {
                let work_id = work_ids.column_text(0)?;
                if self.canonical_production
                    && !requirements.contains_key(&work_id)
                    && !requirement_diagnostics.contains_key(&work_id)
                {
                    requirement_diagnostics
                        .insert(work_id, "missing pinned requirement revision".to_owned());
                }
            }

            let mut child_rows = self.prepare(
                "SELECT r.work_id, r.proof_revision, r.requirement_id,
                        r.gate_id, r.kind, r.required, r.subject_kind,
                        r.profile_id, r.profile_version, r.profile_digest,
                        r.provenance_json, r.declaration_json,
                        COALESCE(observed.state, 'open')
                 FROM boreal_pinned_requirement_gate r
                 LEFT JOIN gate observed
                   ON observed.work_id = r.work_id
                  AND observed.gate_id = r.work_id || ':' || r.gate_id
                 WHERE r.project_id = ?1
                   AND r.proof_revision = (
                     SELECT MAX(current.proof_revision)
                     FROM boreal_pinned_requirement current
                     WHERE current.project_id = r.project_id
                       AND current.work_id = r.work_id
                   )
                 ORDER BY r.work_id, r.requirement_id",
            )?;
            child_rows.bind_text(1, project_id)?;
            let mut seen = BTreeMap::<String, BTreeSet<String>>::new();
            while child_rows.step()? == SQLITE_ROW {
                let work_id = child_rows.column_text(0)?;
                let Some(pinned) = requirements.get(&work_id) else {
                    continue;
                };
                let result = (|| {
                    let proof_revision = child_rows.column_u64(1)?;
                    if proof_revision != pinned.proof_revision {
                        return Err(StoreError::Corrupt(format!(
                            "pinned requirement child revision drifted for {work_id}"
                        )));
                    }
                    let requirement_id = child_rows.column_text(2)?;
                    let expected = pinned
                        .declarations
                        .iter()
                        .find(|declaration| declaration.requirement_id == requirement_id)
                        .ok_or_else(|| {
                            StoreError::Corrupt(format!(
                                "pinned requirement child {requirement_id} is not in the immutable header"
                            ))
                        })?;
                    let expected_document: Value = serde_json::from_str(&pinned.canonical_json()?)
                        .map_err(|_| {
                            StoreError::Corrupt(format!(
                                "pinned requirements canonical document is malformed for {work_id}"
                            ))
                        })?;
                    let expected_declaration = expected_document
                        .get("requirements")
                        .and_then(Value::as_array)
                        .and_then(|values| {
                            values.iter().find(|value| {
                                value.get("requirement_id").and_then(Value::as_str)
                                    == Some(requirement_id.as_str())
                            })
                        })
                        .cloned()
                        .ok_or_else(|| {
                            StoreError::Corrupt(format!(
                                "pinned requirement child {requirement_id} is not reconstructable"
                            ))
                        })?;
                    let child_declaration: Value =
                        serde_json::from_str(&child_rows.column_text(11)?).map_err(|_| {
                            StoreError::Corrupt(format!(
                                "pinned requirement {requirement_id} declaration is malformed"
                            ))
                        })?;
                    let child_provenance: Value =
                        serde_json::from_str(&child_rows.column_text(10)?).map_err(|_| {
                            StoreError::Corrupt(format!(
                                "pinned requirement {requirement_id} provenance is malformed"
                            ))
                        })?;
                    let expected_provenance = json!({
                        "profile_id": pinned.provenance.profile_id,
                        "profile_version": pinned.provenance.profile_version,
                        "profile_digest": pinned.provenance.profile_digest,
                        "resolved_at": pinned.provenance.resolved_at,
                        "source": pinned.provenance.source,
                    });
                    let child_required = child_rows.column_i64(5)? == 1;
                    let expected_subject_kind = match pinned.subject_kind {
                        RequirementSubjectKind::Task => "task",
                        RequirementSubjectKind::Container => "container",
                    };
                    if child_declaration != expected_declaration
                        || child_rows.column_text(3)? != expected.gate_id
                        || child_rows.column_text(4)? != expected.kind
                        || child_required != expected.required
                        || child_rows.column_text(6)? != expected_subject_kind
                        || child_rows.column_text(7)? != pinned.profile.profile_id
                        || child_rows.column_u64(8)? != pinned.profile.version
                        || child_rows.column_text(9)? != pinned.profile.policy_digest
                        || child_provenance != expected_provenance
                    {
                        return Err(StoreError::Corrupt(format!(
                            "pinned requirement child {requirement_id} drifted from its immutable header"
                        )));
                    }
                    let gate_id = format!("{work_id}:{}", expected.gate_id);
                    Ok((
                        StatusGateRow {
                            work_id: work_id.clone(),
                            gate_id,
                            profile_id: pinned.profile.profile_id.clone(),
                            profile_version: pinned.profile.version,
                            kind: parse_gate_kind(&child_rows.column_text(4)?)?,
                            required: expected.required,
                            state: parse_gate_state(&child_rows.column_text(12)?)?,
                        },
                        requirement_id,
                    ))
                })();
                match result {
                    Ok((row, requirement_id)) => {
                        seen.entry(work_id.clone())
                            .or_default()
                            .insert(requirement_id);
                        gate_rows.push(row);
                    }
                    Err(StoreError::Corrupt(detail)) => {
                        requirement_diagnostics.insert(work_id, detail);
                    }
                    Err(other) => return Err(other),
                }
            }
            for (work_id, pinned) in &requirements {
                if requirement_diagnostics.contains_key(work_id) {
                    continue;
                }
                let expected = pinned
                    .declarations
                    .iter()
                    .map(|declaration| declaration.requirement_id.as_str())
                    .collect::<BTreeSet<_>>();
                let observed = seen.get(work_id).cloned().unwrap_or_default();
                if expected.len() != observed.len()
                    || expected.iter().any(|id| !observed.contains(*id))
                {
                    let missing = expected
                        .iter()
                        .find(|id| !observed.contains(**id))
                        .copied()
                        .unwrap_or("unknown");
                    requirement_diagnostics.insert(
                        work_id.clone(),
                        format!(
                            "pinned requirement child {missing} is missing from the immutable declaration set"
                        ),
                    );
                }
            }
            if !self.canonical_production {
                let mut legacy_rows = self.prepare(
                    "SELECT g.work_id, g.gate_id, g.profile_id, g.profile_version,
                            g.kind, g.required, g.state
                     FROM gate g JOIN work_item wi ON wi.work_id = g.work_id
                     WHERE wi.project_id = ?1
                       AND NOT EXISTS (
                         SELECT 1
                         FROM boreal_pinned_requirement current
                         WHERE current.project_id = wi.project_id
                           AND current.work_id = wi.work_id
                       )
                     ORDER BY g.work_id, g.gate_id",
                )?;
                legacy_rows.bind_text(1, project_id)?;
                while legacy_rows.step()? == SQLITE_ROW {
                    gate_rows.push(StatusGateRow {
                        work_id: legacy_rows.column_text(0)?,
                        gate_id: legacy_rows.column_text(1)?,
                        profile_id: legacy_rows.column_text(2)?,
                        profile_version: legacy_rows.column_u64(3)?,
                        kind: parse_gate_kind(&legacy_rows.column_text(4)?)?,
                        required: legacy_rows.column_i64(5)? == 1,
                        state: parse_gate_state(&legacy_rows.column_text(6)?)?,
                    });
                }
            }
        } else {
            while statement.step()? == SQLITE_ROW {
                gate_rows.push(StatusGateRow {
                    work_id: statement.column_text(0)?,
                    gate_id: statement.column_text(1)?,
                    profile_id: statement.column_text(3)?,
                    profile_version: statement.column_u64(4)?,
                    kind: parse_gate_kind(&statement.column_text(10)?)?,
                    required: statement.column_i64(11)? == 1,
                    state: parse_gate_state(&statement.column_text(12)?)?,
                });
            }
        }
        gate_rows.retain(|row| !requirement_diagnostics.contains_key(&row.work_id));

        let mut receipts = BTreeMap::<(String, String, u64, String), StatusReceiptFact>::new();
        let mut statement = self.prepare(
            "SELECT r.work_id, r.attempt_id, r.fence, r.gate_id,
                    r.receipt_id, r.result, r.rejection_code
             FROM receipt r
             JOIN work_item wi ON wi.work_id = r.work_id
             JOIN attempt a ON a.work_id = r.work_id
                           AND a.attempt_id = r.attempt_id
                           AND a.fence = r.fence
                           AND a.current = 1
             WHERE wi.project_id = ?1 AND r.gate_id IS NOT NULL
             ORDER BY r.work_id, r.attempt_id, r.fence, r.gate_id,
                      r.ended_at DESC, r.receipt_id DESC",
        )?;
        statement.bind_text(1, project_id)?;
        while statement.step()? == SQLITE_ROW {
            let key = (
                statement.column_text(0)?,
                statement.column_text(1)?,
                statement.column_u64(2)?,
                statement.column_text(3)?,
            );
            receipts.entry(key).or_insert(StatusReceiptFact {
                receipt_id: statement.column_text(4)?,
                result: parse_receipt_outcome(&statement.column_text(5)?)?,
                rejection_code: statement.column_optional_text(6)?,
            });
        }

        let mut reviews = BTreeMap::<(String, String, u64, String), bool>::new();
        let mut statement = self.prepare(
            "SELECT r.work_id, r.attempt_id, r.fence, r.gate_id,
                    r.decision
             FROM review r
             JOIN work_item wi ON wi.work_id = r.work_id
             JOIN attempt a ON a.work_id = r.work_id
                           AND a.attempt_id = r.attempt_id
                           AND a.fence = r.fence
                           AND a.current = 1
             WHERE wi.project_id = ?1 AND r.gate_id IS NOT NULL
             ORDER BY r.work_id, r.attempt_id, r.fence, r.gate_id,
                      r.created_at DESC, r.review_id DESC",
        )?;
        statement.bind_text(1, project_id)?;
        while statement.step()? == SQLITE_ROW {
            let key = (
                statement.column_text(0)?,
                statement.column_text(1)?,
                statement.column_u64(2)?,
                statement.column_text(3)?,
            );
            let accepted =
                parse_review_decision(&statement.column_text(4)?)? == ReviewDecision::Accepted;
            reviews.entry(key).or_insert(accepted);
        }

        let mut summaries = BTreeMap::<String, SummaryRecord>::new();
        let mut statement = self.prepare(
            "SELECT s.summary_id, wi.project_id, s.work_id, s.attempt_id,
                    s.fence, s.subject_ref, s.source_version_id,
                    s.config_identity, s.profile_id, s.profile_version,
                    s.body_digest, s.body_size, s.current, s.created_at
             FROM summary s
             JOIN work_item wi ON wi.work_id = s.work_id
             JOIN attempt a ON a.work_id = s.work_id
                           AND a.attempt_id = s.attempt_id
                           AND a.fence = s.fence
                           AND a.current = 1
             WHERE wi.project_id = ?1 AND s.current = 1
             ORDER BY s.work_id, s.created_at DESC, s.summary_id DESC",
        )?;
        statement.bind_text(1, project_id)?;
        while statement.step()? == SQLITE_ROW {
            let work_id = statement.column_text(2)?;
            summaries
                .entry(work_id)
                .or_insert(summary_from_statement(&statement)?);
        }

        let mut diagnostics = BTreeMap::new();
        for row in gate_rows {
            let (attempt_id, fence) = current_attempts
                .get(&row.work_id)
                .map(|attempt| (Some(attempt.attempt_id.as_str()), Some(attempt.fence)))
                .unwrap_or((None, None));
            let entry = diagnostics
                .entry(row.work_id.clone())
                .or_insert_with(|| GateDiagnostics {
                    project_id: project_id.to_owned(),
                    work_id: row.work_id.clone(),
                    attempt_id: attempt_id.map(str::to_owned),
                    fence,
                    revision,
                    gates: Vec::new(),
                    missing: Vec::new(),
                });

            let (state, receipt_id, reason) = match (attempt_id, fence) {
                (Some(attempt_id), Some(fence)) => {
                    let key = (
                        row.work_id.clone(),
                        attempt_id.to_owned(),
                        fence,
                        row.gate_id.clone(),
                    );
                    if let Some(receipt) = receipts.get(&key) {
                        let state = if receipt.result == ReceiptOutcome::Passed
                            && receipt.rejection_code.is_none()
                        {
                            GateState::Satisfied
                        } else {
                            GateState::Failed
                        };
                        let reason = receipt.rejection_code.clone().or_else(|| {
                            (receipt.result != ReceiptOutcome::Passed)
                                .then(|| receipt_outcome_name(receipt.result).to_owned())
                        });
                        (state, Some(receipt.receipt_id.clone()), reason)
                    } else {
                        let review_key = (
                            row.work_id.clone(),
                            attempt_id.to_owned(),
                            fence,
                            row.gate_id.clone(),
                        );
                        let review_satisfied = row.kind == GateKind::Review
                            && reviews.get(&review_key).copied().unwrap_or(false);
                        let summary_satisfied = row.kind == GateKind::Summary
                            && summaries.get(&row.work_id).is_some_and(|summary| {
                                let Some(attempt) = current_attempts.get(&row.work_id) else {
                                    return false;
                                };
                                summary.attempt_id == attempt_id
                                    && summary.fence == fence
                                    && summary.source_version_id
                                        == attempt.source_version_id.clone().unwrap_or_default()
                                    && summary.config_identity == attempt.config_identity
                                    && summary.profile_id == row.profile_id
                                    && summary.profile_version == row.profile_version
                                    && summary.body_size > 0
                                    && summary.body_size <= MAX_SUMMARY_BODY_BYTES
                                    && valid_sha256_digest(&summary.body_digest)
                            });
                        if review_satisfied || summary_satisfied {
                            (GateState::Satisfied, None, None)
                        } else {
                            (
                                GateState::Open,
                                None,
                                Some("current_proof_missing".to_owned()),
                            )
                        }
                    }
                }
                _ => (row.state, None, None),
            };
            entry.gates.push(GateDiagnostic {
                gate_id: row.gate_id,
                kind: row.kind,
                required: row.required,
                state,
                receipt_id,
                reason,
            });
        }
        for entry in diagnostics.values_mut() {
            entry.missing = entry
                .gates
                .iter()
                .filter(|gate| gate.required && gate.state != GateState::Satisfied)
                .map(|gate| gate.gate_id.clone())
                .collect();
        }
        for work_id in requirement_diagnostics.keys() {
            diagnostics.insert(
                work_id.clone(),
                GateDiagnostics {
                    project_id: project_id.to_owned(),
                    work_id: work_id.clone(),
                    attempt_id: current_attempts
                        .get(work_id)
                        .map(|attempt| attempt.attempt_id.clone()),
                    fence: current_attempts.get(work_id).map(|attempt| attempt.fence),
                    revision,
                    gates: Vec::new(),
                    missing: vec!["requirements_missing".to_owned()],
                },
            );
        }
        Ok(StatusGateRead {
            diagnostics,
            requirement_diagnostics,
        })
    }

    /// Reads the current attempt by its work subject. This is the bounded
    /// query used by status/resume callers that do not yet know the attempt ID.
    pub fn current_attempt_for_work(
        &self,
        project_id: &str,
        work_id: &str,
    ) -> Result<Option<AttemptRecord>, StoreError> {
        let mut statement = self.prepare(
            "SELECT a.attempt_id
             FROM attempt a
             JOIN work_item wi ON wi.work_id = a.work_id
             WHERE wi.project_id = ?1 AND a.work_id = ?2 AND a.current = 1",
        )?;
        statement.bind_text(1, project_id)?;
        statement.bind_text(2, work_id)?;
        match statement.step()? {
            SQLITE_ROW => self.attempt_record(&statement.column_text(0)?, true),
            SQLITE_DONE => Ok(None),
            _ => unreachable!(),
        }
    }

    /// Reads the one current attempt owned by a session in a project. This is
    /// deliberately an exact indexed lookup rather than a bounded work scan.
    pub fn current_attempt_for_session(
        &self,
        project_id: &str,
        session_id: &str,
    ) -> Result<Option<AttemptRecord>, StoreError> {
        let mut statement = self.prepare(
            "SELECT a.attempt_id
             FROM attempt a
             JOIN work_item wi ON wi.work_id = a.work_id
             WHERE wi.project_id = ?1 AND a.session_id = ?2 AND a.current = 1
             LIMIT 1",
        )?;
        statement.bind_text(1, project_id)?;
        statement.bind_text(2, session_id)?;
        match statement.step()? {
            SQLITE_ROW => self.attempt_record(&statement.column_text(0)?, true),
            SQLITE_DONE => Ok(None),
            _ => unreachable!(),
        }
    }

    /// Applies one fenced attempt mutation in a short `BEGIN IMMEDIATE`
    /// transaction. The attempt row, reservation projection, project
    /// revision, operation receipt, and audit event commit or roll back as a
    /// unit.
    pub fn apply_attempt_mutation(
        &self,
        request: impl Borrow<AttemptMutationRequest>,
    ) -> Result<AttemptMutationResult, StoreError> {
        let request = request.borrow();
        self.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| {
            let command = format!("attempt.{}", mutation_name(&request.mutation));
            if let Some(existing) = self.preflight_operation_replay(
                &request.project_id,
                &request.operation_id,
                &command,
                &request.actor_id,
                request.session_id.as_deref(),
                request
                    .expected_project_revision
                    .or(request.expected_work_revision),
                Some(&request.attempt_id),
                Some(request.fence),
                &request.request_digest,
                "attempt",
                &request.attempt_id,
            )? {
                return self.replay_attempt_operation(request, &existing);
            }

            let actual_revision = self.project_revision(&request.project_id)?.0;
            for expected in [
                request.expected_project_revision,
                request.expected_work_revision,
            ]
            .into_iter()
            .flatten()
            {
                if expected != actual_revision {
                    return Err(StoreError::StaleRevision {
                        expected,
                        actual: actual_revision,
                    });
                }
            }
            let current = self
                .attempt_record(&request.attempt_id, false)?
                .ok_or_else(|| StoreError::NotFound {
                    entity: "attempt",
                    id: request.attempt_id.clone(),
                })?;
            self.validate_attempt_subject(request, &current)?;
            if current.fence != request.fence {
                return Err(StoreError::StaleFence {
                    expected: request.fence,
                    actual: current.fence,
                });
            }
            if let Some(expected) = request.expected_attempt_revision {
                if expected != current.fence {
                    return Err(StoreError::StaleFence {
                        expected,
                        actual: current.fence,
                    });
                }
            }
            if !current.current {
                return Err(StoreError::NotCurrent {
                    attempt_id: request.attempt_id.clone(),
                });
            }
            if let Some(expected) = request.expected_phase {
                if expected != current.phase {
                    return Err(StoreError::Conflict(format!(
                        "attempt phase changed: expected {expected:?}, actual {:?}",
                        current.phase
                    )));
                }
            }
            if let Some(expected) = request.expected_lease_deadline.as_deref() {
                if expected != current.lease_deadline {
                    return Err(StoreError::Conflict(format!(
                        "lease deadline changed: expected {expected}, actual {}",
                        current.lease_deadline
                    )));
                }
            }
            if let Some(expected) = request.expected_hard_deadline.as_deref() {
                if expected != current.hard_deadline {
                    return Err(StoreError::Conflict(format!(
                        "hard deadline changed: expected {expected}, actual {}",
                        current.hard_deadline
                    )));
                }
            }

            let permits_expired_time = matches!(
                request.mutation,
                AttemptMutationKind::Expire { .. } | AttemptMutationKind::Cancel { .. }
            );
            if !permits_expired_time {
                if timestamp_cmp(&request.at, &current.hard_deadline) != std::cmp::Ordering::Less {
                    return Err(StoreError::HardDeadlineElapsed);
                }
                if timestamp_cmp(&request.at, &current.lease_deadline) != std::cmp::Ordering::Less {
                    return Err(StoreError::LeaseExpired);
                }
            }

            let (_, event_type) = self.apply_attempt_row(request, &current)?;
            let updated = self
                .attempt_record(&request.attempt_id, false)?
                .ok_or_else(|| {
                    StoreError::Corrupt("attempt disappeared during mutation".to_owned())
                })?;
            if let Some(obligation) = recovery_obligation_for_attempt_mutation(request) {
                self.create_recovery_obligation_in_transaction(&obligation)?;
            }
            let revision = self.bump_revision_in_transaction(&request.project_id)?;
            let result_json = attempt_result_json(
                &request.attempt_id,
                request.fence,
                updated.phase,
                &updated.lease_deadline,
                &updated.hard_deadline,
            )?;
            let operation = OperationRecord {
                operation_id: request.operation_id.clone(),
                project_id: request.project_id.clone(),
                command: format!("attempt.{}", mutation_name(&request.mutation)),
                actor_id: request.actor_id.clone(),
                session_id: request.session_id.clone(),
                expected_revision: request
                    .expected_project_revision
                    .or(request.expected_work_revision),
                attempt_id: Some(request.attempt_id.clone()),
                fence: Some(request.fence),
                request_digest: request.request_digest.clone(),
                outcome: OperationOutcome::Changed,
                result_json: result_json.clone(),
                revision: revision.0,
                created_at: request.at.clone(),
                completed_at: Some(request.at.clone()),
            };
            let audit = AuditEventRecord {
                project_id: request.project_id.clone(),
                revision: revision.0,
                operation_id: request.operation_id.clone(),
                event_type: event_type.to_owned(),
                subject_type: "attempt".to_owned(),
                subject_id: request.attempt_id.clone(),
                actor_id: request.actor_id.clone(),
                session_id: request.session_id.clone(),
                fence: Some(request.fence),
                as_of: request.at.clone(),
                payload_json: audit_payload(
                    &request.mutation,
                    updated.phase,
                    request.reason.as_deref(),
                    &updated.lease_deadline,
                    &updated.hard_deadline,
                )?,
            };
            self.append_operation_audit_in_transaction(operation, audit)?;

            Ok(AttemptMutationResult {
                operation_id: request.operation_id.clone(),
                request_digest: request.request_digest.clone(),
                attempt_id: request.attempt_id.clone(),
                fence: request.fence,
                phase: updated.phase,
                lease_deadline: updated.lease_deadline,
                hard_deadline: updated.hard_deadline,
                revision: revision.0,
                changed: true,
                replayed: false,
            })
        })();
        match result {
            Ok(value) => {
                self.execute_batch("COMMIT")?;
                Ok(value)
            }
            Err(error) => {
                let _ = self.execute_batch("ROLLBACK");
                Err(error)
            }
        }
    }

    /// Alias used by application adapters that call the boundary a
    /// transaction rather than a mutation.
    pub fn transact_attempt(
        &self,
        request: impl Borrow<AttemptCommand>,
    ) -> Result<AttemptMutationResult, StoreError> {
        self.apply_attempt_mutation(request)
    }

    /// Resolves a lifecycle operation after a timeout or disconnected writer.
    pub fn read_attempt_operation(
        &self,
        project_id: &str,
        operation_id: &str,
    ) -> Result<Option<AttemptMutationResult>, StoreError> {
        let Some(operation) = self.operation(operation_id)? else {
            return Ok(None);
        };
        if operation.project_id != project_id {
            return Err(StoreError::WrongSubject {
                expected: project_id.to_owned(),
                actual: operation.project_id,
            });
        }
        self.replay_attempt_operation(
            &AttemptMutationRequest {
                project_id: project_id.to_owned(),
                work_id: String::new(),
                attempt_id: operation.attempt_id.clone().unwrap_or_default(),
                actor_id: operation.actor_id.clone(),
                harness_id: None,
                session_id: operation.session_id.clone(),
                fence: operation.fence.unwrap_or_default(),
                operation_id: operation.operation_id.clone(),
                request_digest: operation.request_digest.clone(),
                at: operation.created_at.clone(),
                expected_project_revision: None,
                expected_work_revision: None,
                expected_attempt_revision: None,
                expected_phase: None,
                expected_lease_deadline: None,
                expected_hard_deadline: None,
                mutation: AttemptMutationKind::Start,
                reason: None,
            },
            &operation,
        )
        .map(Some)
    }

    fn replay_attempt_operation(
        &self,
        request: &AttemptMutationRequest,
        operation: &OperationRecord,
    ) -> Result<AttemptMutationResult, StoreError> {
        if operation.project_id != request.project_id
            || operation.request_digest != request.request_digest
        {
            return Err(StoreError::Conflict(format!(
                "operation {} was already used with another request",
                request.operation_id
            )));
        }
        if let Some(attempt_id) = operation.attempt_id.as_deref() {
            if !request.attempt_id.is_empty() && attempt_id != request.attempt_id {
                return Err(StoreError::Conflict(
                    "operation subject does not match attempt".to_owned(),
                ));
            }
            let attempt = self.attempt_record(attempt_id, false)?.ok_or_else(|| {
                StoreError::Corrupt("attempt operation refers to missing attempt".to_owned())
            })?;
            let phase = parse_phase(&json_string_field(&operation.result_json, "phase")?)?;
            let lease_deadline = json_string_field(&operation.result_json, "lease_deadline")?;
            let hard_deadline = json_string_field(&operation.result_json, "hard_deadline")?;
            let fence = json_u64_field(&operation.result_json, "fence")?;
            return Ok(AttemptMutationResult {
                operation_id: operation.operation_id.clone(),
                request_digest: operation.request_digest.clone(),
                attempt_id: attempt.attempt_id,
                fence,
                phase,
                lease_deadline,
                hard_deadline,
                revision: operation.revision,
                changed: operation.outcome == OperationOutcome::Changed,
                replayed: true,
            });
        }
        Err(StoreError::Corrupt(
            "attempt operation has no attempt result".to_owned(),
        ))
    }

    fn validate_attempt_subject(
        &self,
        request: &AttemptMutationRequest,
        current: &AttemptRecord,
    ) -> Result<(), StoreError> {
        if current.project_id != request.project_id || current.work_id != request.work_id {
            return Err(StoreError::WrongSubject {
                expected: format!("{}/{}", request.project_id, request.work_id),
                actual: format!("{}/{}", current.project_id, current.work_id),
            });
        }
        if current.actor_id != request.actor_id {
            return Err(StoreError::WrongOwner {
                expected: request.actor_id.clone(),
                actual: current.actor_id.clone(),
            });
        }
        let accepting = matches!(request.mutation, AttemptMutationKind::Accept);
        if current.harness_id != request.harness_id
            && !(accepting && current.harness_id.is_none() && request.harness_id.is_some())
        {
            return Err(StoreError::WrongOwner {
                expected: request.harness_id.clone().unwrap_or_default(),
                actual: current.harness_id.clone().unwrap_or_default(),
            });
        }
        if current.session_id != request.session_id
            && !(accepting && current.session_id.is_none() && request.session_id.is_some())
        {
            return Err(StoreError::WrongOwner {
                expected: request.session_id.clone().unwrap_or_default(),
                actual: current.session_id.clone().unwrap_or_default(),
            });
        }
        if let Some(session_id) = request.session_id.as_deref() {
            let session = self.session_for_project_actor(
                &request.project_id,
                session_id,
                &request.actor_id,
                request.harness_id.as_deref(),
            )?;
            if session.state != SessionState::Active {
                return Err(StoreError::Conflict(format!(
                    "session {} is not active",
                    session.session_id
                )));
            }
        }
        Ok(())
    }

    fn apply_attempt_row(
        &self,
        request: &AttemptMutationRequest,
        current: &AttemptRecord,
    ) -> Result<(AttemptPhase, &'static str), StoreError> {
        let operation = mutation_name(&request.mutation);
        let phase = match (&request.mutation, current.phase) {
            (AttemptMutationKind::Accept, AttemptPhase::Claimed) => AttemptPhase::Accepted,
            (AttemptMutationKind::Start, AttemptPhase::Accepted) => AttemptPhase::Running,
            (AttemptMutationKind::Heartbeat { .. }, phase) if !phase.is_terminal() => phase,
            (AttemptMutationKind::RenewLease { lease_deadline }, phase) if !phase.is_terminal() => {
                if timestamp_cmp(lease_deadline, &request.at) != std::cmp::Ordering::Greater {
                    return Err(StoreError::Invalid(
                        "renewed lease deadline must be after mutation time".to_owned(),
                    ));
                }
                if timestamp_cmp(lease_deadline, &current.hard_deadline)
                    == std::cmp::Ordering::Greater
                {
                    return Err(StoreError::Invalid(
                        "renewed lease cannot extend the hard attempt deadline".to_owned(),
                    ));
                }
                phase
            }
            (AttemptMutationKind::Submit, AttemptPhase::Running) => AttemptPhase::Verifying,
            (
                AttemptMutationKind::Release,
                AttemptPhase::Claimed
                | AttemptPhase::Accepted
                | AttemptPhase::Running
                | AttemptPhase::Verifying,
            ) => AttemptPhase::Released,
            (AttemptMutationKind::Fail, AttemptPhase::Running | AttemptPhase::Verifying) => {
                AttemptPhase::Failed
            }
            (
                AttemptMutationKind::Expire { stop_confirmed },
                AttemptPhase::Claimed
                | AttemptPhase::Accepted
                | AttemptPhase::Running
                | AttemptPhase::Verifying
                | AttemptPhase::ExpiryPending,
            ) => {
                if !stop_confirmed {
                    return Err(StoreError::StopConfirmationRequired);
                }
                if current.phase != AttemptPhase::ExpiryPending
                    && timestamp_cmp(&request.at, &current.lease_deadline)
                        == std::cmp::Ordering::Less
                    && timestamp_cmp(&request.at, &current.hard_deadline)
                        == std::cmp::Ordering::Less
                {
                    return Err(StoreError::NotExpired);
                }
                AttemptPhase::Expired
            }
            (
                AttemptMutationKind::Cancel { stop_confirmed },
                AttemptPhase::Claimed
                | AttemptPhase::Accepted
                | AttemptPhase::Running
                | AttemptPhase::Verifying
                | AttemptPhase::ExpiryPending,
            ) => {
                if !stop_confirmed {
                    return Err(StoreError::StopConfirmationRequired);
                }
                AttemptPhase::Cancelled
            }
            _ => {
                return Err(StoreError::IllegalTransition {
                    from: current.phase,
                    operation,
                })
            }
        };

        match &request.mutation {
            AttemptMutationKind::Accept => {
                let mut statement = self.prepare(
                    "UPDATE attempt
                     SET state = 'accepted', accepted_at = ?1,
                         harness_id = COALESCE(harness_id, ?2),
                         session_id = COALESCE(session_id, ?3)
                     WHERE attempt_id = ?4 AND current = 1",
                )?;
                statement.bind_text(1, &request.at)?;
                statement.bind_optional_text(2, request.harness_id.as_deref())?;
                statement.bind_optional_text(3, request.session_id.as_deref())?;
                statement.bind_text(4, &request.attempt_id)?;
                statement.run()?;
            }
            AttemptMutationKind::Start | AttemptMutationKind::Submit => {
                let state = phase_name(phase);
                let mut statement = self.prepare(
                    "UPDATE attempt SET state = ?1 WHERE attempt_id = ?2 AND current = 1",
                )?;
                statement.bind_text(1, state)?;
                statement.bind_text(2, &request.attempt_id)?;
                statement.run()?;
            }
            AttemptMutationKind::Heartbeat { .. } => {
                let mut statement = self.prepare(
                    "UPDATE attempt SET last_heartbeat_at = ?1
                     WHERE attempt_id = ?2 AND current = 1",
                )?;
                statement.bind_text(1, &request.at)?;
                statement.bind_text(2, &request.attempt_id)?;
                statement.run()?;
            }
            AttemptMutationKind::RenewLease { lease_deadline } => {
                let mut statement = self.prepare(
                    "UPDATE attempt SET lease_deadline = ?1
                     WHERE attempt_id = ?2 AND current = 1",
                )?;
                statement.bind_text(1, lease_deadline)?;
                statement.bind_text(2, &request.attempt_id)?;
                statement.run()?;
            }
            AttemptMutationKind::Release
            | AttemptMutationKind::Fail
            | AttemptMutationKind::Expire { .. }
            | AttemptMutationKind::Cancel { .. } => {
                let reason = request.reason.as_deref().unwrap_or(operation);
                let mut statement = self.prepare(
                    "UPDATE attempt
                     SET current = 0, state = ?1, terminal_at = ?2,
                         terminal_reason = ?3
                     WHERE attempt_id = ?4 AND current = 1",
                )?;
                statement.bind_text(1, phase_name(phase))?;
                statement.bind_text(2, &request.at)?;
                statement.bind_text(3, reason)?;
                statement.bind_text(4, &request.attempt_id)?;
                statement.run()?;

                let reservation_state = if phase == AttemptPhase::Expired {
                    "expired"
                } else {
                    "released"
                };
                let mut reservation = self.prepare(
                    "UPDATE reservation
                     SET state = ?1, released_at = ?2
                     WHERE attempt_id = ?3 AND state = 'active'",
                )?;
                reservation.bind_text(1, reservation_state)?;
                reservation.bind_text(2, &request.at)?;
                reservation.bind_text(3, &request.attempt_id)?;
                reservation.run()?;

                // Keep the legacy row as a compatibility projection only.
                // Canonical production reservations enter the durable release
                // protocol and remain release-pending until an owner supplies
                // a real acknowledgement.
                self.request_canonical_resource_release_in_transaction(
                    &request.project_id,
                    &request.attempt_id,
                    request.fence,
                    &request.operation_id,
                    &request.actor_id,
                    &request.at,
                )?;
            }
        }
        Ok((phase, event_type(&request.mutation)))
    }

    fn request_canonical_resource_release_in_transaction(
        &self,
        project_id: &str,
        attempt_id: &str,
        fence: u64,
        operation_id: &str,
        actor_id: &str,
        at: &str,
    ) -> Result<(), StoreError> {
        if !self.table_exists("boreal_resource_reservation")? {
            // Historical schema-v2 fixtures do not have the canonical
            // reservation tables and retain the legacy projection only.
            return Ok(());
        }

        let reservation_id = format!("resource:{attempt_id}");
        if self
            .resource_reservation(project_id, &reservation_id)?
            .is_none()
        {
            if self.canonical_production {
                return Err(StoreError::Corrupt(format!(
                    "canonical attempt {attempt_id} has no resource reservation"
                )));
            }
            return Ok(());
        }
        self.request_resource_release_in_transaction(
            project_id,
            &reservation_id,
            &format!("{operation_id}:resource-release"),
            actor_id,
            &format!("attempt-terminal:{attempt_id}:{fence}"),
            at,
        )?;
        Ok(())
    }

    fn attempt_record(
        &self,
        attempt_id: &str,
        current_only: bool,
    ) -> Result<Option<AttemptRecord>, StoreError> {
        let suffix = if current_only {
            " AND a.current = 1"
        } else {
            ""
        };
        let sql = format!(
            "SELECT wi.project_id, a.work_id, a.attempt_id, a.actor_id,
                    a.harness_id, a.session_id, a.fence, a.current, a.state,
                    a.claimed_at, a.accepted_at, a.lease_deadline,
                    a.max_attempt_deadline, a.last_heartbeat_at,
                    a.last_checkpoint_at, a.review_required_after_expiry,
                    a.stop_requested_at, a.stop_acknowledged_at, a.terminal_at,
                    a.terminal_reason, a.source_version_id, a.config_identity,
                    a.binary_identity, a.protocol_version, a.schema_version
             FROM attempt a JOIN work_item wi ON wi.work_id = a.work_id
             WHERE a.attempt_id = ?1{suffix}"
        );
        let mut statement = self.prepare(&sql)?;
        statement.bind_text(1, attempt_id)?;
        if statement.step()? != SQLITE_ROW {
            return Ok(None);
        }
        Ok(Some(self.attempt_from_statement(&statement)?))
    }

    fn attempt_from_statement(
        &self,
        statement: &Statement<'_>,
    ) -> Result<AttemptRecord, StoreError> {
        Ok(AttemptRecord {
            project_id: statement.column_text(0)?,
            work_id: statement.column_text(1)?,
            attempt_id: statement.column_text(2)?,
            actor_id: statement.column_text(3)?,
            harness_id: statement.column_optional_text(4)?,
            session_id: statement.column_optional_text(5)?,
            fence: statement.column_u64(6)?,
            current: statement.column_i64(7)? == 1,
            phase: parse_phase(&statement.column_text(8)?)?,
            claimed_at: statement.column_text(9)?,
            accepted_at: statement.column_optional_text(10)?,
            lease_deadline: statement.column_text(11)?,
            hard_deadline: statement.column_text(12)?,
            last_heartbeat_at: statement.column_optional_text(13)?,
            last_checkpoint_at: statement.column_optional_text(14)?,
            review_required_after_expiry: statement.column_i64(15)? == 1,
            stop_requested_at: statement.column_optional_text(16)?,
            stop_acknowledged_at: statement.column_optional_text(17)?,
            terminal_at: statement.column_optional_text(18)?,
            terminal_reason: statement.column_optional_text(19)?,
            source_version_id: statement.column_optional_text(20)?,
            config_identity: statement.column_text(21)?,
            binary_identity: statement.column_text(22)?,
            protocol_version: statement.column_text(23)?,
            schema_version: statement.column_u64(24)?,
        })
    }

    fn next_fence(&self, work_id: &str) -> Result<u64, StoreError> {
        let mut statement =
            self.prepare("SELECT COALESCE(MAX(fence), 0) + 1 FROM attempt WHERE work_id = ?1")?;
        statement.bind_text(1, work_id)?;
        match statement.step()? {
            SQLITE_ROW => statement.column_u64(0),
            SQLITE_DONE => Err(StoreError::Corrupt("missing fence result".to_owned())),
            _ => unreachable!(),
        }
    }

    fn bump_revision_in_transaction(
        &self,
        project_id: &str,
    ) -> Result<SnapshotRevision, StoreError> {
        let mut update = self.prepare(
            "UPDATE project SET project_revision = project_revision + 1, updated_at = updated_at
             WHERE project_id = ?1",
        )?;
        update.bind_text(1, project_id)?;
        update.run()?;
        if update.changes()? != 1 {
            return Err(StoreError::NotFound {
                entity: "project",
                id: project_id.to_owned(),
            });
        }
        self.project_revision(project_id)
    }

    /// Applies the schema atomically on a fresh database and performs additive
    /// repairs for the original v2 schema. The public schema version remains
    /// 2 for compatibility; required object/column/index/trigger checks make
    /// same-version drift fail closed instead of being silently accepted.
    pub fn apply_schema(&self, schema_sql: &str) -> Result<(), StoreError> {
        if is_production_schema_request(schema_sql) {
            self.migrate_production()?;
            return Ok(());
        }
        let version = self.schema_version()?;
        match version {
            0 => {
                if schema_requests_work_model_v3(schema_sql) {
                    return Err(StoreError::Invalid(
                        "schema v3 is an additive migration; initialize schema v2 first".to_owned(),
                    ));
                }
                self.execute_batch("BEGIN IMMEDIATE")?;
                let result = (|| {
                    self.execute_batch(schema_sql)?;
                    self.verify_schema_contract()
                })();
                finish_transaction(self, result)
            }
            SCHEMA_VERSION if schema_requests_work_model_v3(schema_sql) => {
                self.apply_work_model_v3(schema_sql)
            }
            SCHEMA_VERSION => {
                self.execute_batch("BEGIN IMMEDIATE")?;
                let result = self.repair_schema_v2();
                match result {
                    Ok(()) => {
                        let result = self.verify_schema_contract();
                        finish_transaction(self, result)
                    }
                    Err(error) => {
                        let _ = self.execute_batch("ROLLBACK");
                        Err(error)
                    }
                }
            }
            WORK_MODEL_SCHEMA_VERSION => self.verify_work_model_v3_contract(),
            found => Err(StoreError::UnsupportedSchema { found }),
        }
    }

    /// Applies the additive work-model/3 migration to a complete schema-2
    /// database.  The store owns the transaction even though the standalone
    /// migration artifact contains BEGIN/COMMIT wrappers, and sets
    /// `user_version` only after all objects have been created.  On any error
    /// we explicitly roll back so a syntax or I/O failure cannot leave a
    /// version-3-labelled partial database behind.
    pub fn apply_work_model_v3(&self, schema_sql: &str) -> Result<(), StoreError> {
        if is_production_schema_request(schema_sql) {
            self.migrate_production()?;
            return Ok(());
        }
        match self.schema_version()? {
            WORK_MODEL_SCHEMA_VERSION => return self.verify_work_model_v3_contract(),
            SCHEMA_VERSION => {}
            found => {
                return Err(StoreError::Invalid(format!(
                    "work-model/3 requires schema version {SCHEMA_VERSION}, found {found}"
                )))
            }
        }
        if !schema_requests_work_model_v3(schema_sql) {
            return Err(StoreError::Invalid(
                "schema text is not the boreal work-model/3 migration".to_owned(),
            ));
        }

        self.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| {
            self.repair_schema_v2()?;
            self.execute_batch(&strip_transaction_wrappers(schema_sql))?;
            self.verify_work_model_v3_contract()
        })();
        finish_transaction(self, result)
    }

    /// Opens a complete v2 base and applies the additive v3 extension.  A
    /// v3 SQL file is intentionally not accepted as a standalone fresh
    /// schema, because it would omit the canonical v2 lifecycle tables.
    pub fn open_with_work_model_v3(
        path: impl AsRef<Path>,
        schema_v2: &str,
        schema_v3: &str,
    ) -> Result<Self, StoreError> {
        let store = Self::open(path, schema_v2)?;
        store.apply_work_model_v3(schema_v3)?;
        Ok(store)
    }

    /// Returns whether the additive hierarchy/intake tables are installed.
    /// This is intentionally separate from the v2 status schema version so
    /// older clients can continue to open and read the base tables.
    pub fn work_model_v3_enabled(&self) -> Result<bool, StoreError> {
        if self.schema_version()? != WORK_MODEL_SCHEMA_VERSION {
            return Ok(false);
        }
        Ok(self.verify_work_model_v3_contract().is_ok())
    }

    /// Downgrades only an empty v3 extension.  Rows are never deleted as an
    /// implicit compatibility action; callers must export/backup populated
    /// v3 facts before choosing a destructive migration explicitly.
    pub fn rollback_work_model_v3(&self) -> Result<(), StoreError> {
        if self.schema_version()? != WORK_MODEL_SCHEMA_VERSION {
            return Err(StoreError::Conflict(
                "work-model/3 is not installed".to_owned(),
            ));
        }
        self.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| {
            for table in [
                "work_node_v3",
                "work_dependency_v3",
                "cycle_series_v3",
                "cycle_template_v3",
                "cycle_template_weekday_v3",
                "cycle_v3",
                "cycle_assignment_v3",
                "intake_bucket_v3",
                "intake_item_v3",
                "intake_promotion_v3",
                "container_disposition_v3",
            ] {
                let mut statement = self.prepare(&format!("SELECT COUNT(*) FROM {table}"))?;
                if statement.step()? == SQLITE_ROW && statement.column_i64(0)? != 0 {
                    return Err(StoreError::Conflict(format!(
                        "cannot roll back work-model/3 with persisted rows in {table}"
                    )));
                }
            }
            for table in [
                "container_disposition_v3",
                "intake_promotion_v3",
                "intake_item_v3",
                "intake_bucket_v3",
                "cycle_assignment_v3",
                "cycle_v3",
                "cycle_template_weekday_v3",
                "cycle_template_v3",
                "cycle_series_v3",
                "work_dependency_v3",
                "work_node_v3",
                "work_model_v3_meta",
            ] {
                self.execute_batch(&format!("DROP TABLE IF EXISTS {table}"))?;
            }
            self.execute_batch("PRAGMA user_version = 2")?;
            self.verify_schema_contract()
        })();
        finish_transaction(self, result)
    }

    fn verify_work_model_v3_contract(&self) -> Result<(), StoreError> {
        if self.schema_version()? != WORK_MODEL_SCHEMA_VERSION {
            return Err(StoreError::Corrupt(
                "work-model/3 database has an unexpected user_version".to_owned(),
            ));
        }
        self.verify_schema_contract()?;
        for table in [
            "work_model_v3_meta",
            "work_node_v3",
            "work_dependency_v3",
            "cycle_series_v3",
            "cycle_template_v3",
            "cycle_template_weekday_v3",
            "cycle_v3",
            "cycle_assignment_v3",
            "intake_bucket_v3",
            "intake_item_v3",
            "intake_promotion_v3",
            "container_disposition_v3",
        ] {
            if !self.table_exists(table)? {
                return Err(StoreError::Corrupt(format!(
                    "work-model/3 is missing required table {table}"
                )));
            }
        }
        for index in [
            "work_dependency_v3_dependent",
            "cycle_assignment_v3_live_work",
            "container_disposition_v3_subject",
            "container_disposition_v3_successor",
        ] {
            if !self.schema_object_exists("index", index)? {
                return Err(StoreError::Corrupt(format!(
                    "work-model/3 is missing required index {index}"
                )));
            }
        }
        for trigger in [
            "work_node_v3_kind_guard",
            "work_node_v3_parent_guard",
            "work_node_v3_no_cycle",
            "work_node_v3_identity_guard",
            "work_node_v3_kind_update_guard",
            "work_node_v3_parent_update_guard",
            "work_node_v3_no_cycle_update",
            "work_dependency_v3_direct_guard",
            "work_dependency_v3_no_cycle",
            "cycle_assignment_v3_direct_guard",
            "cycle_assignment_v3_terminal_guard",
            "intake_item_v3_revision_guard",
            "intake_promotion_v3_current_provenance",
            "intake_promotion_v3_append_only_update",
            "intake_promotion_v3_append_only_delete",
            "container_disposition_v3_subject_guard",
            "container_disposition_v3_chain_guard",
            "container_disposition_v3_append_only_update",
            "container_disposition_v3_append_only_delete",
        ] {
            if !self.schema_object_exists("trigger", trigger)? {
                return Err(StoreError::Corrupt(format!(
                    "work-model/3 is missing required trigger {trigger}"
                )));
            }
        }
        let mut metadata = self.prepare(
            "SELECT schema_id, schema_version, base_schema_version,
                    contract_version
             FROM work_model_v3_meta
             WHERE schema_id = 'boreal.work-model'",
        )?;
        if metadata.step()? != SQLITE_ROW
            || metadata.column_text(0)? != "boreal.work-model"
            || metadata.column_i64(1)? != WORK_MODEL_SCHEMA_VERSION
            || metadata.column_i64(2)? != SCHEMA_VERSION
            || metadata.column_text(3)? != "boreal.work-model/3"
        {
            return Err(StoreError::Corrupt(
                "work-model/3 metadata identity is invalid".to_owned(),
            ));
        }
        Ok(())
    }

    fn repair_schema_v2(&self) -> Result<(), StoreError> {
        if !self.table_exists("work_item")? {
            return Err(StoreError::Corrupt(
                "schema version 2 is missing required table work_item".to_owned(),
            ));
        }
        if !self.table_exists("audit_event")? {
            return Err(StoreError::Corrupt(
                "schema version 2 is missing required table audit_event".to_owned(),
            ));
        }
        if !self.audit_event_accepts("evidence.verifier.admitted")?
            || !self.audit_event_accepts("close.completed")?
        {
            self.execute_batch(REPAIR_AUDIT_EVENT_VERIFIER_CHECK)?;
        }
        if !self.table_has_column("work_item", "priority")? {
            self.execute_batch(
                "ALTER TABLE work_item ADD COLUMN priority INTEGER NOT NULL DEFAULT 0
                 CHECK (priority >= 0 AND priority <= 255)",
            )?;
        }
        self.execute_batch(CREATE_WORK_HOLD_TABLE)?;
        self.execute_batch(CREATE_EVIDENCE_EXECUTION_TABLE)?;
        self.execute_batch(
            "CREATE INDEX IF NOT EXISTS work_item_project_id ON work_item(project_id, work_id);
             CREATE INDEX IF NOT EXISTS attempt_work_current ON attempt(work_id, current, attempt_id);
             CREATE INDEX IF NOT EXISTS attempt_session_current ON attempt(session_id, current, attempt_id);",
        )?;
        self.execute_batch(REPAIR_SCHEMA_TRIGGERS)
    }

    fn execute_migration_sql(&self, sql: &str) -> Result<(), StoreError> {
        // The migration runner stages its ledger row in a short transaction
        // before applying the target schema. Repair the legacy v2 base only
        // when the runner enters that target-schema transaction; doing it in
        // the staging transaction would make a later migration failure leave
        // the repair committed. The explicit apply_schema/apply_work_model_v3
        // paths own their repair transaction directly and do not pass through
        // this marker.
        if self.schema_version()? == SCHEMA_VERSION
            && sql.contains("CREATE TABLE work_model_v3_meta")
        {
            self.repair_schema_v2()?;
        }
        self.execute_batch(sql)
    }

    pub fn schema_version(&self) -> Result<i64, StoreError> {
        self.scalar_i64("PRAGMA user_version")
    }

    pub fn foreign_keys_enabled(&self) -> Result<bool, StoreError> {
        Ok(self.scalar_i64("PRAGMA foreign_keys")? == 1)
    }

    pub fn journal_mode(&self) -> Result<String, StoreError> {
        self.scalar_text("PRAGMA journal_mode")
    }

    /// Runs a migration or test/setup batch. Lifecycle decisions remain outside
    /// this boundary; this method only executes transactional SQL.
    pub fn execute_batch(&self, sql: &str) -> Result<(), StoreError> {
        self.query_metrics
            .batch_calls
            .fetch_add(1, Ordering::Relaxed);
        let sql = CString::new(sql)?;
        let mut error = ptr::null_mut();
        let result = unsafe {
            sqlite3_exec(
                self.database,
                sql.as_ptr(),
                None,
                ptr::null_mut(),
                &mut error,
            )
        };
        if result == SQLITE_OK {
            return Ok(());
        }
        let message = if error.is_null() {
            database_error(self.database, result)
        } else {
            let text = unsafe { CStr::from_ptr(error) }
                .to_string_lossy()
                .into_owned();
            unsafe { sqlite3_free(error.cast()) };
            classify_sqlite_error(result, text)
        };
        Err(message)
    }

    pub fn project_revision(&self, project_id: &str) -> Result<SnapshotRevision, StoreError> {
        let mut statement =
            self.prepare("SELECT project_revision FROM project WHERE project_id = ?1")?;
        statement.bind_text(1, project_id)?;
        match statement.step()? {
            SQLITE_ROW => Ok(SnapshotRevision(statement.column_i64(0)? as u64)),
            SQLITE_DONE => Err(StoreError::NotFound {
                entity: "project",
                id: project_id.to_owned(),
            }),
            _ => unreachable!(),
        }
    }

    /// Returns every project identifier in stable lexical order.
    ///
    /// Project discovery is an adapter concern, but adapters must not reach
    /// through this store boundary with raw SQLite. This deliberately small,
    /// read-only query lets a local launcher distinguish an empty database, a
    /// single-project database, and an ambiguous multi-project database.
    pub fn list_project_ids(&self) -> Result<Vec<String>, StoreError> {
        let mut statement = self.prepare("SELECT project_id FROM project ORDER BY project_id")?;
        let mut project_ids = Vec::new();
        loop {
            match statement.step()? {
                SQLITE_ROW => project_ids.push(statement.column_text(0)?),
                SQLITE_DONE => return Ok(project_ids),
                _ => unreachable!(),
            }
        }
    }

    /// Resolves the owning project for a work subject without exposing a raw
    /// SQLite query to application adapters.
    pub fn project_for_work(&self, work_id: &str) -> Result<String, StoreError> {
        let mut statement = self.prepare("SELECT project_id FROM work_item WHERE work_id = ?1")?;
        statement.bind_text(1, work_id)?;
        match statement.step()? {
            SQLITE_ROW => statement.column_text(0),
            SQLITE_DONE => Err(StoreError::NotFound {
                entity: "work",
                id: work_id.to_owned(),
            }),
            _ => unreachable!(),
        }
    }

    /// Atomically increments and returns the project revision. Callers should
    /// use the returned value for the operation and its audit event.
    pub fn next_revision(&self, project_id: &str) -> Result<SnapshotRevision, StoreError> {
        self.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| {
            let mut update = self.prepare(
                "UPDATE project SET project_revision = project_revision + 1, updated_at = updated_at WHERE project_id = ?1",
            )?;
            update.bind_text(1, project_id)?;
            update.run()?;
            if update.changes()? != 1 {
                return Err(StoreError::NotFound {
                    entity: "project",
                    id: project_id.to_owned(),
                });
            }
            self.project_revision(project_id)
        })();
        match result {
            Ok(revision) => {
                self.execute_batch("COMMIT")?;
                Ok(revision)
            }
            Err(error) => {
                let _ = self.execute_batch("ROLLBACK");
                Err(error)
            }
        }
    }

    pub fn append_operation(&self, operation: &OperationRecord) -> Result<(), StoreError> {
        // Preflight the bound project before inserting so a failed lineage
        // check cannot leave an operation row behind when a legacy caller is
        // not already inside a rollback-owned transaction.
        let identity_context = self.operation_identity_context(&operation.project_id)?;
        let mut statement = self.prepare(
            "INSERT INTO operation (
                operation_id, project_id, command, actor_id, session_id,
                expected_revision, attempt_id, fence, request_digest, outcome,
                result_json, revision, created_at, completed_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        )?;
        statement.bind_text(1, &operation.operation_id)?;
        statement.bind_text(2, &operation.project_id)?;
        statement.bind_text(3, &operation.command)?;
        statement.bind_text(4, &operation.actor_id)?;
        statement.bind_optional_text(5, operation.session_id.as_deref())?;
        statement.bind_optional_i64(6, operation.expected_revision)?;
        statement.bind_optional_text(7, operation.attempt_id.as_deref())?;
        statement.bind_optional_i64(8, operation.fence)?;
        statement.bind_text(9, &operation.request_digest)?;
        statement.bind_text(10, operation.outcome.as_str())?;
        statement.bind_text(11, &operation.result_json)?;
        statement.bind_i64(12, operation.revision)?;
        statement.bind_text(13, &operation.created_at)?;
        statement.bind_optional_text(14, operation.completed_at.as_deref())?;
        statement.run()?;
        // Once a project has an explicit workspace binding, every legacy
        // operation writer also receives the database-lineage identity row.
        // This does not replace the operation+audit bundle requirement, but
        // it prevents direct root call sites from creating unbound operation
        // history on an already-bound production project.
        if let Some(context) = identity_context {
            identity::IdentityStore::new(self)
                .record_operation_context(&context, &operation.operation_id)
                .map_err(|error| StoreError::Conflict(format!("operation identity: {error}")))?;
        }
        Ok(())
    }

    /// Appends a terminal operation and its audit envelope at the caller's
    /// transaction boundary. Production databases must have a bound project
    /// identity before this path is admitted; legacy test schemas retain the
    /// compatibility append only when the identity seam is not installed.
    fn append_operation_audit_in_transaction(
        &self,
        operation: OperationRecord,
        audit: AuditEventRecord,
    ) -> Result<(), StoreError> {
        match self.operation_identity_context(&operation.project_id)? {
            Some(context) => operations::OperationJournal::new(self)
                .append_in_transaction_with_identity(
                    &context,
                    &operations::OperationBundle::new(operation, Some(audit)),
                ),
            None if self.canonical_production => Err(StoreError::Corrupt(
                "canonical production operation requires project identity binding".to_owned(),
            )),
            None => {
                // Noncanonical schema-v2 fixtures retain the historical
                // compatibility boundary. They are not production authority;
                // canonical opens fail closed above when identity is absent.
                self.append_operation(&operation)?;
                self.append_audit_event(&audit)
            }
        }
    }

    /// Admit a root operation at the same identity boundary used by the
    /// operation journal.  The older root methods used a request digest-only
    /// replay check, which allowed an operation ID to be reused with a
    /// different actor, command, session, fence, or subject.  This helper is
    /// deliberately read-only: callers invoke it after opening their caller-
    /// owned transaction and before any semantic row mutation.
    #[allow(clippy::too_many_arguments)]
    fn preflight_operation_replay(
        &self,
        project_id: &str,
        operation_id: &str,
        command: &str,
        actor_id: &str,
        session_id: Option<&str>,
        expected_revision: Option<u64>,
        attempt_id: Option<&str>,
        fence: Option<u64>,
        request_digest: &str,
        subject_type: &str,
        subject_id: &str,
    ) -> Result<Option<OperationRecord>, StoreError> {
        let context = self.operation_identity_context(project_id)?;
        let Some(existing) = self.operation(operation_id)? else {
            return Ok(None);
        };
        if existing.project_id != project_id
            || existing.command != command
            || existing.actor_id != actor_id
            || existing.session_id.as_deref() != session_id
            || existing.expected_revision != expected_revision
            || existing.attempt_id.as_deref() != attempt_id
            || existing.fence != fence
            || existing.request_digest != request_digest
        {
            return Err(StoreError::Conflict(format!(
                "operation {operation_id} was already used with another immutable identity"
            )));
        }

        if let Some(context) = context {
            let identity = operations::OperationIdentity::from_record(
                &existing,
                Some((subject_type.to_owned(), subject_id.to_owned())),
            );
            operations::OperationJournal::new(self)
                .replay_in_context(&context, &identity)?
                .ok_or_else(|| {
                    StoreError::Corrupt(
                        "operation exists but identity-bound replay returned no result".to_owned(),
                    )
                })?;
        } else if let Some(audit) = self.audit_event(operation_id)? {
            if audit.subject_type != subject_type || audit.subject_id != subject_id {
                return Err(StoreError::WrongSubject {
                    expected: format!("{subject_type}/{subject_id}"),
                    actual: format!("{}/{}", audit.subject_type, audit.subject_id),
                });
            }
        }
        Ok(Some(existing))
    }

    #[allow(clippy::too_many_arguments)]
    fn preflight_claim_replay(
        &self,
        project_id: &str,
        operation_id: &str,
        actor_id: &str,
        session_id: Option<&str>,
        attempt_id: &str,
        expected_revision: Option<u64>,
        request_digest: &str,
    ) -> Result<Option<OperationRecord>, StoreError> {
        let context = self.operation_identity_context(project_id)?;
        let Some(existing) = self.operation(operation_id)? else {
            return Ok(None);
        };
        if existing.project_id != project_id
            || existing.command != "work.claim"
            || existing.actor_id != actor_id
            || existing.session_id.as_deref() != session_id
            || existing.expected_revision != expected_revision
            || existing.attempt_id.as_deref() != Some(attempt_id)
            || existing.request_digest != request_digest
        {
            return Err(StoreError::Conflict(format!(
                "operation {operation_id} was already used with another immutable identity"
            )));
        }
        let subject = existing.attempt_id.clone().ok_or_else(|| {
            StoreError::Corrupt("claim operation has no attempt identity".to_owned())
        })?;
        if let Some(context) = context {
            let identity = operations::OperationIdentity::from_record(
                &existing,
                Some(("attempt".to_owned(), subject)),
            );
            operations::OperationJournal::new(self)
                .replay_in_context(&context, &identity)?
                .ok_or_else(|| {
                    StoreError::Corrupt(
                        "claim operation exists but identity-bound replay returned no result"
                            .to_owned(),
                    )
                })?;
        } else if let Some(audit) = self.audit_event(operation_id)? {
            if audit.subject_type != "attempt" || audit.subject_id != subject {
                return Err(StoreError::WrongSubject {
                    expected: format!("attempt/{subject}"),
                    actual: format!("{}/{}", audit.subject_type, audit.subject_id),
                });
            }
        }
        Ok(Some(existing))
    }

    /// Appends an identity-bound operation and audit event inside a caller-owned
    /// transaction. A zero revision allocates the next project revision while
    /// holding that transaction, so adapter-owned composite operations cannot
    /// reuse the semantic mutation's audit revision.
    pub fn append_identity_operation_audit_in_transaction(
        &self,
        context: &identity::IdentityContext,
        mut operation: OperationRecord,
        mut audit: AuditEventRecord,
    ) -> Result<OperationReadback, StoreError> {
        let journal = operations::OperationJournal::new(self);
        let identity = operations::OperationIdentity::from_record(
            &operation,
            Some((audit.subject_type.clone(), audit.subject_id.clone())),
        );
        if let Some(readback) = journal.replay_in_context(context, &identity)? {
            return Ok(readback);
        }
        let revision = if operation.revision == 0 {
            self.bump_revision_in_transaction(&operation.project_id)?.0
        } else {
            operation.revision
        };
        operation.revision = revision;
        if audit.revision == 0 {
            audit.revision = revision;
        }
        if audit.revision != revision {
            return Err(StoreError::Conflict(
                "operation and audit revision identities disagree".to_owned(),
            ));
        }
        journal.append_in_transaction_with_identity(
            context,
            &operations::OperationBundle::new(operation, Some(audit)),
        )?;
        journal
            .replay_in_context(context, &identity)?
            .ok_or_else(|| {
                StoreError::Corrupt("identity-bound operation has no durable readback".to_owned())
            })
    }

    /// Opens the caller-owned identity operation transaction for adapters that
    /// have no semantic rows to include in their own transaction.
    pub fn append_identity_operation_audit(
        &self,
        context: &identity::IdentityContext,
        operation: OperationRecord,
        audit: AuditEventRecord,
    ) -> Result<OperationReadback, StoreError> {
        self.execute_batch("BEGIN IMMEDIATE")?;
        let result = self.append_identity_operation_audit_in_transaction(context, operation, audit);
        match result {
            Ok(value) => {
                self.execute_batch("COMMIT")?;
                Ok(value)
            }
            Err(error) => {
                let _ = self.execute_batch("ROLLBACK");
                Err(error)
            }
        }
    }

    /// Identity-bound audit readback for adapters that must not use an
    /// operation-only lookup.
    pub fn audit_event_in_context(
        &self,
        context: &identity::IdentityContext,
        operation_id: &str,
    ) -> Result<Option<AuditEventRecord>, StoreError> {
        operations::OperationJournal::new(self).audit_event_in_context(context, operation_id)
    }

    /// Identity-bound replay preflight used by composite adapter operations
    /// before they invoke child lifecycle mutations.
    pub fn operation_replay_in_context(
        &self,
        context: &identity::IdentityContext,
        identity: &operations::OperationIdentity,
    ) -> Result<Option<OperationReadback>, StoreError> {
        operations::OperationJournal::new(self).replay_in_context(context, identity)
    }

    fn project_identity_is_bound(&self, project_id: &str) -> Result<bool, StoreError> {
        let mut statement =
            self.prepare("SELECT 1 FROM boreal_project_identity WHERE project_id = ?1 LIMIT 1")?;
        statement.bind_text(1, project_id)?;
        Ok(statement.step()? == SQLITE_ROW)
    }

    fn operation_identity_context(
        &self,
        project_id: &str,
    ) -> Result<Option<identity::IdentityContext>, StoreError> {
        let identity_tables = self.identity_tables_installed()?;
        if self.canonical_production && !identity_tables {
            return Err(StoreError::Corrupt(
                "canonical production schema is missing its identity tables".to_owned(),
            ));
        }
        if !identity_tables || !self.project_identity_is_bound(project_id)? {
            if self.canonical_production {
                return Err(StoreError::Conflict(format!(
                    "production project {project_id} requires a workspace identity binding before consequential operation writes"
                )));
            }
            return Ok(None);
        }
        Ok(Some(
            identity::IdentityStore::new(self)
                .context(project_id)
                .map_err(|error| StoreError::Conflict(format!("operation identity: {error}")))?,
        ))
    }

    fn identity_tables_installed(&self) -> Result<bool, StoreError> {
        Ok(self.table_exists("boreal_database_identity")?
            && self.table_exists("boreal_project_identity")?
            && self.table_exists("boreal_operation_identity")?)
    }

    pub fn operation_exists(&self, operation_id: &str) -> Result<bool, StoreError> {
        let mut statement = self.prepare("SELECT 1 FROM operation WHERE operation_id = ?1")?;
        statement.bind_text(1, operation_id)?;
        Ok(statement.step()? == SQLITE_ROW)
    }

    /// Resolves an operation ID with one bounded row read. This is the readback
    /// primitive callers use after an ambiguous mutation outcome.
    pub fn operation(&self, operation_id: &str) -> Result<Option<OperationRecord>, StoreError> {
        let mut statement = self.prepare(
            "SELECT operation_id, project_id, command, actor_id, session_id,
                    expected_revision, attempt_id, fence, request_digest, outcome,
                    result_json, revision, created_at, completed_at
             FROM operation WHERE operation_id = ?1",
        )?;
        statement.bind_text(1, operation_id)?;
        if statement.step()? != SQLITE_ROW {
            return Ok(None);
        }
        let outcome = match statement.column_text(9)?.as_str() {
            "changed" => OperationOutcome::Changed,
            "unchanged" => OperationOutcome::Unchanged,
            "rejected" => OperationOutcome::Rejected,
            "conflict" => OperationOutcome::Conflict,
            "busy" => OperationOutcome::Busy,
            "failed" => OperationOutcome::Failed,
            "unknown" => OperationOutcome::Unknown,
            value => {
                return Err(StoreError::Corrupt(format!(
                    "unknown operation outcome: {value}"
                )))
            }
        };
        Ok(Some(OperationRecord {
            operation_id: statement.column_text(0)?,
            project_id: statement.column_text(1)?,
            command: statement.column_text(2)?,
            actor_id: statement.column_text(3)?,
            session_id: statement.column_optional_text(4)?,
            expected_revision: statement.column_optional_i64(5)?,
            attempt_id: statement.column_optional_text(6)?,
            fence: statement.column_optional_i64(7)?,
            request_digest: statement.column_text(8)?,
            outcome,
            result_json: statement.column_text(10)?,
            revision: statement.column_u64(11)?,
            created_at: statement.column_text(12)?,
            completed_at: statement.column_optional_text(13)?,
        }))
    }

    /// Reads an operation and/or evidence execution only within the requested
    /// project. This closes the execution-only gap where an admitted sidecar
    /// exists before the parent operation is committed.
    pub fn operation_readback(
        &self,
        project_id: &str,
        operation_id: &str,
    ) -> Result<Option<OperationReadback>, StoreError> {
        let operation = self.operation(operation_id)?;
        let execution = self.evidence_execution(operation_id)?;
        if operation.is_none() && execution.is_none() {
            return Ok(None);
        }
        if let Some(operation) = &operation {
            if operation.project_id != project_id {
                return Err(StoreError::WrongSubject {
                    expected: project_id.to_owned(),
                    actual: operation.project_id.clone(),
                });
            }
        }
        if let Some(execution) = &execution {
            if execution.project_id != project_id {
                return Err(StoreError::WrongSubject {
                    expected: project_id.to_owned(),
                    actual: execution.project_id.clone(),
                });
            }
        }
        if let (Some(operation), Some(execution)) = (&operation, &execution) {
            if operation.project_id != execution.project_id {
                return Err(StoreError::Corrupt(
                    "operation and evidence execution project scopes disagree".to_owned(),
                ));
            }
        }
        Ok(Some(OperationReadback {
            operation,
            execution,
        }))
    }

    pub fn append_audit_event(&self, event: &AuditEventRecord) -> Result<(), StoreError> {
        let identity_context = self.operation_identity_context(&event.project_id)?;
        let operation = self.operation(&event.operation_id)?.ok_or_else(|| {
            StoreError::Corrupt("audit event has no operation outcome".to_owned())
        })?;
        if operation.project_id != event.project_id {
            return Err(StoreError::WrongSubject {
                expected: operation.project_id,
                actual: event.project_id.clone(),
            });
        }
        if operation.actor_id != event.actor_id
            || operation.session_id != event.session_id
            || operation.fence != event.fence
        {
            return Err(StoreError::Conflict(
                "operation and audit actor/session/fence identities disagree".to_owned(),
            ));
        }
        if operation.revision != event.revision {
            return Err(StoreError::Conflict(
                "operation and audit revision identities disagree".to_owned(),
            ));
        }
        if identity_context.is_some() {
            let mut identity = self.prepare(
                "SELECT 1 FROM boreal_operation_identity
                 WHERE operation_id = ?1 AND project_id = ?2 AND state = 'current'",
            )?;
            identity.bind_text(1, &event.operation_id)?;
            identity.bind_text(2, &event.project_id)?;
            if identity.step()? != SQLITE_ROW {
                return Err(StoreError::Corrupt(
                    "identity-bound audit event has no committed operation identity".to_owned(),
                ));
            }
        }
        let mut statement = self.prepare(
            "INSERT INTO audit_event (
                project_id, revision, operation_id, event_type, subject_type,
                subject_id, actor_id, session_id, fence, as_of, payload_json
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        )?;
        statement.bind_text(1, &event.project_id)?;
        statement.bind_i64(2, event.revision)?;
        statement.bind_text(3, &event.operation_id)?;
        statement.bind_text(4, &event.event_type)?;
        statement.bind_text(5, &event.subject_type)?;
        statement.bind_text(6, &event.subject_id)?;
        statement.bind_text(7, &event.actor_id)?;
        statement.bind_optional_text(8, event.session_id.as_deref())?;
        statement.bind_optional_i64(9, event.fence)?;
        statement.bind_text(10, &event.as_of)?;
        statement.bind_text(11, &event.payload_json)?;
        statement.run()
    }

    /// Reads the single audit row associated with an operation. Audit rows are
    /// append-only, so this is also a bounded operation readback primitive.
    pub fn audit_event(&self, operation_id: &str) -> Result<Option<AuditEventRecord>, StoreError> {
        let mut statement = self.prepare(
            "SELECT project_id, revision, operation_id, event_type, subject_type,
                    subject_id, actor_id, session_id, fence, as_of, payload_json
             FROM audit_event WHERE operation_id = ?1",
        )?;
        statement.bind_text(1, operation_id)?;
        if statement.step()? != SQLITE_ROW {
            return Ok(None);
        }
        Ok(Some(AuditEventRecord {
            project_id: statement.column_text(0)?,
            revision: statement.column_u64(1)?,
            operation_id: statement.column_text(2)?,
            event_type: statement.column_text(3)?,
            subject_type: statement.column_text(4)?,
            subject_id: statement.column_text(5)?,
            actor_id: statement.column_text(6)?,
            session_id: statement.column_optional_text(7)?,
            fence: statement.column_optional_i64(8)?,
            as_of: statement.column_text(9)?,
            payload_json: statement.column_text(10)?,
        }))
    }

    /// Durably admits one external evidence command before any process is
    /// launched. Reusing the operation with the same canonical request reads
    /// the existing journal entry; it never grants permission to launch a
    /// second process. Reusing it with different semantics is a conflict.
    pub fn admit_evidence_execution(
        &self,
        request: impl Borrow<EvidenceExecutionAdmissionRequest>,
    ) -> Result<EvidenceExecutionAdmissionResult, StoreError> {
        let request = request.borrow();
        if let Some(existing) = self.evidence_execution(&request.operation_id)? {
            return replay_evidence_execution_admission(request, existing);
        }

        self.execute_batch("BEGIN IMMEDIATE")?;
        let result = self.admit_evidence_execution_in_transaction(request);
        finish_transaction(self, result)
    }

    /// Performs the semantic evidence-admission write without opening or
    /// closing a transaction. Composite adapters use this to commit the
    /// execution identity together with the external-job admission record.
    pub(crate) fn admit_evidence_execution_in_transaction(
        &self,
        request: &EvidenceExecutionAdmissionRequest,
    ) -> Result<EvidenceExecutionAdmissionResult, StoreError> {
        if request.operation_id.is_empty()
            || request.project_id.is_empty()
            || request.work_id.is_empty()
            || request.attempt_id.is_empty()
            || request.gate_id.is_empty()
            || request.actor_id.is_empty()
            || request.request_digest.is_empty()
            || request.artifact_ref.is_empty()
        {
            return Err(StoreError::Invalid(
                "evidence execution admission requires complete identity".to_owned(),
            ));
        }
        if let Some(existing) = self.evidence_execution(&request.operation_id)? {
            return replay_evidence_execution_admission(request, existing);
        }
        let attempt = self
            .attempt_record(&request.attempt_id, true)?
            .ok_or_else(|| StoreError::NotCurrent {
                attempt_id: request.attempt_id.clone(),
            })?;
        if attempt.project_id != request.project_id || attempt.work_id != request.work_id {
            return Err(StoreError::WrongSubject {
                expected: format!("{}/{}", request.project_id, request.work_id),
                actual: format!("{}/{}", attempt.project_id, attempt.work_id),
            });
        }
        if attempt.fence != request.fence {
            return Err(StoreError::StaleFence {
                expected: request.fence,
                actual: attempt.fence,
            });
        }
        if attempt.actor_id != request.actor_id {
            return Err(StoreError::WrongOwner {
                expected: request.actor_id.clone(),
                actual: attempt.actor_id,
            });
        }
        if attempt.session_id != request.session_id {
            return Err(StoreError::WrongOwner {
                expected: request.session_id.clone().unwrap_or_default(),
                actual: attempt.session_id.unwrap_or_default(),
            });
        }
        if attempt.phase != AttemptPhase::Running {
            return Err(StoreError::IllegalTransition {
                from: attempt.phase,
                operation: "admit evidence execution",
            });
        }
        if timestamp_cmp(&request.admitted_at, &attempt.hard_deadline) != std::cmp::Ordering::Less {
            return Err(StoreError::HardDeadlineElapsed);
        }
        if timestamp_cmp(&request.admitted_at, &attempt.lease_deadline) != std::cmp::Ordering::Less
        {
            return Err(StoreError::LeaseExpired);
        }
        if attempt.source_version_id != request.source_version_id
            || attempt.config_identity != request.config_identity
        {
            return Err(StoreError::Conflict(
                "evidence execution context no longer matches the current attempt".to_owned(),
            ));
        }
        let gate = self
            .gate(&request.project_id, &request.work_id, &request.gate_id)?
            .ok_or_else(|| StoreError::NotFound {
                entity: "gate",
                id: request.gate_id.clone(),
            })?;
        if gate.profile_id != request.profile_id || gate.profile_version != request.profile_version
        {
            return Err(StoreError::Conflict(
                "evidence execution policy no longer matches the work profile".to_owned(),
            ));
        }

        let mut statement = self.prepare(
            "INSERT INTO evidence_execution
             (operation_id, project_id, work_id, attempt_id, fence, gate_id,
              actor_id, session_id, request_digest, artifact_ref, state, admitted_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'admitted', ?11)",
        )?;
        statement.bind_text(1, &request.operation_id)?;
        statement.bind_text(2, &request.project_id)?;
        statement.bind_text(3, &request.work_id)?;
        statement.bind_text(4, &request.attempt_id)?;
        statement.bind_i64(5, request.fence)?;
        statement.bind_text(6, &request.gate_id)?;
        statement.bind_text(7, &request.actor_id)?;
        statement.bind_optional_text(8, request.session_id.as_deref())?;
        statement.bind_text(9, &request.request_digest)?;
        statement.bind_text(10, &request.artifact_ref)?;
        statement.bind_text(11, &request.admitted_at)?;
        statement.run()?;
        Ok(EvidenceExecutionAdmissionResult {
            execution: self
                .evidence_execution(&request.operation_id)?
                .ok_or_else(|| {
                    StoreError::Corrupt(
                        "admitted evidence execution could not be read back".to_owned(),
                    )
                })?,
            replayed: false,
        })
    }

    pub fn evidence_execution(
        &self,
        operation_id: &str,
    ) -> Result<Option<EvidenceExecutionRecord>, StoreError> {
        let mut statement = self.prepare(
            "SELECT operation_id, project_id, work_id, attempt_id, fence, gate_id,
                    actor_id, session_id, request_digest, artifact_ref, state,
                    admitted_at, started_at, exited_at, exit_code, receipt_id,
                    failure_code
             FROM evidence_execution WHERE operation_id = ?1",
        )?;
        statement.bind_text(1, operation_id)?;
        if statement.step()? != SQLITE_ROW {
            return Ok(None);
        }
        Ok(Some(evidence_execution_from_statement(&statement)?))
    }

    /// Returns execution admissions whose receipt has not been durably
    /// committed. Service startup uses this bounded identity list to fail
    /// incomplete external work closed as unknown before accepting requests.
    pub fn list_incomplete_evidence_executions(
        &self,
    ) -> Result<Vec<EvidenceExecutionRecord>, StoreError> {
        let mut statement = self.prepare(
            "SELECT operation_id, project_id, work_id, attempt_id, fence, gate_id,
                    actor_id, session_id, request_digest, artifact_ref, state,
                    admitted_at, started_at, exited_at, exit_code, receipt_id,
                    failure_code
             FROM evidence_execution
             WHERE state <> 'receipt_committed'
             ORDER BY admitted_at, operation_id
             LIMIT 10000",
        )?;
        let mut records = Vec::new();
        while statement.step()? == SQLITE_ROW {
            records.push(evidence_execution_from_statement(&statement)?);
        }
        Ok(records)
    }

    pub fn start_evidence_execution(
        &self,
        operation_id: &str,
        started_at: &str,
    ) -> Result<EvidenceExecutionRecord, StoreError> {
        let mut statement = self.prepare(
            "UPDATE evidence_execution SET state = 'running', started_at = ?1
             WHERE operation_id = ?2 AND state = 'admitted'",
        )?;
        statement.bind_text(1, started_at)?;
        statement.bind_text(2, operation_id)?;
        statement.run()?;
        if statement.changes()? != 1 {
            return Err(StoreError::Conflict(format!(
                "evidence execution {operation_id} is not newly admitted"
            )));
        }
        self.evidence_execution(operation_id)?
            .ok_or_else(|| StoreError::Corrupt("started evidence execution disappeared".to_owned()))
    }

    pub fn finish_evidence_execution(
        &self,
        operation_id: &str,
        exited_at: &str,
        exit_code: Option<i32>,
    ) -> Result<EvidenceExecutionRecord, StoreError> {
        let mut statement = self.prepare(
            "UPDATE evidence_execution
             SET state = 'exited', exited_at = ?1, exit_code = ?2
             WHERE operation_id = ?3 AND state = 'running'",
        )?;
        statement.bind_text(1, exited_at)?;
        match exit_code {
            Some(value) => statement.bind_signed_i64(2, i64::from(value))?,
            None => statement.bind_null(2)?,
        }
        statement.bind_text(3, operation_id)?;
        statement.run()?;
        if statement.changes()? != 1 {
            return Err(StoreError::Conflict(format!(
                "evidence execution {operation_id} is not running"
            )));
        }
        self.evidence_execution(operation_id)?.ok_or_else(|| {
            StoreError::Corrupt("finished evidence execution disappeared".to_owned())
        })
    }

    pub fn mark_evidence_execution_unknown(
        &self,
        operation_id: &str,
        failure_code: &str,
    ) -> Result<EvidenceExecutionRecord, StoreError> {
        let mut statement = self.prepare(
            "UPDATE evidence_execution SET state = 'unknown', failure_code = ?1
             WHERE operation_id = ?2
               AND state IN ('admitted','running','exited','unknown')",
        )?;
        statement.bind_text(1, failure_code)?;
        statement.bind_text(2, operation_id)?;
        statement.run()?;
        if statement.changes()? != 1 {
            return Err(StoreError::Conflict(format!(
                "evidence execution {operation_id} is already committed or absent"
            )));
        }
        self.evidence_execution(operation_id)?
            .ok_or_else(|| StoreError::Corrupt("unknown evidence execution disappeared".to_owned()))
    }

    /// Inserts one immutable execution receipt. Subject and fence failures are
    /// themselves retained as rejected/stale receipt facts before the typed
    /// error is returned. A successful retry of the same operation reads back
    /// the original receipt without advancing the project revision.
    pub fn insert_receipt(
        &self,
        request: impl Borrow<ReceiptInsertRequest>,
    ) -> Result<ReceiptInsertResult, StoreError> {
        let request = request.borrow();
        validate_receipt_request(request)?;
        let replay_digest = canonical_receipt_request(request)?;

        self.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| {
            if let Some(existing) = self.preflight_operation_replay(
                &request.project_id,
                &request.operation_id,
                "receipt.insert",
                &request.actor_id,
                request.session_id.as_deref(),
                request.expected_project_revision,
                Some(&request.attempt_id),
                Some(request.fence),
                &replay_digest,
                "receipt",
                &request.receipt_id,
            )? {
                return self
                    .replay_receipt_operation(request, &replay_digest, &existing)
                    .map(|value| (value, None));
            }
            let actual_revision = self.project_revision(&request.project_id)?.0;
            if let Some(expected) = request.expected_project_revision {
                if expected != actual_revision {
                    return Err(StoreError::StaleRevision {
                        expected,
                        actual: actual_revision,
                    });
                }
            }

            let validation_error = self.receipt_acceptance_error(request)?;
            let mut retained = request.clone();
            if let Some(error) = &validation_error {
                // The schema's composite foreign key must remain valid even
                // for a rejected fact. Keep the submitted subject verbatim in
                // subject_json and anchor the retained row to the observed
                // attempt so the failed/stale result remains queryable.
                let current = self
                    .attempt_record(&request.attempt_id, false)?
                    .ok_or_else(|| StoreError::NotFound {
                        entity: "attempt",
                        id: request.attempt_id.clone(),
                    })?;
                retained.work_id = current.work_id;
                retained.attempt_id = current.attempt_id;
                retained.fence = current.fence;
                retained.gate_id = None;
                retained.result = if matches!(error, StoreError::StaleFence { .. }) {
                    ReceiptOutcome::Stale
                } else {
                    ReceiptOutcome::Rejected
                };
                retained.rejection_code = if retained.result == ReceiptOutcome::Rejected {
                    Some(receipt_error_code(error).to_owned())
                } else {
                    None
                };
            }
            self.insert_receipt_row(&retained)?;
            if request.submission_kind == ReceiptSubmissionKind::WitnessedExecutor {
                let mut execution = self.prepare(
                    "UPDATE evidence_execution
                     SET state = 'receipt_committed', receipt_id = ?1
                     WHERE operation_id = ?2 AND state = 'exited'",
                )?;
                execution.bind_text(1, &retained.receipt_id)?;
                execution.bind_text(2, &retained.operation_id)?;
                execution.run()?;
                if validation_error.is_none() && execution.changes()? != 1 {
                    return Err(StoreError::Corrupt(
                        "witnessed receipt committed without an exited execution".to_owned(),
                    ));
                }
            }
            if validation_error.is_none() {
                if let Some(gate_id) = retained.gate_id.as_deref() {
                    self.set_gate_state_row(
                        &retained.project_id,
                        &retained.work_id,
                        gate_id,
                        if retained.result == ReceiptOutcome::Passed {
                            GateState::Satisfied
                        } else {
                            GateState::Failed
                        },
                        &retained.created_at,
                    )?;
                }
            }
            let revision = self.bump_revision_in_transaction(&retained.project_id)?;
            let result_json = receipt_result_json(&retained, revision.0)?;
            self.append_operation_audit_in_transaction(
                OperationRecord {
                    operation_id: retained.operation_id.clone(),
                    project_id: retained.project_id.clone(),
                    command: "receipt.insert".to_owned(),
                    actor_id: retained.actor_id.clone(),
                    session_id: retained.session_id.clone(),
                    expected_revision: retained.expected_project_revision,
                    attempt_id: Some(retained.attempt_id.clone()),
                    fence: Some(retained.fence),
                    request_digest: replay_digest.clone(),
                    outcome: if validation_error.is_some() {
                        OperationOutcome::Rejected
                    } else {
                        OperationOutcome::Changed
                    },
                    result_json: result_json.clone(),
                    revision: revision.0,
                    created_at: retained.created_at.clone(),
                    completed_at: Some(retained.created_at.clone()),
                },
                AuditEventRecord {
                    project_id: retained.project_id.clone(),
                    revision: revision.0,
                    operation_id: retained.operation_id.clone(),
                    event_type: if validation_error.is_some() {
                        "receipt.rejected"
                    } else {
                        "receipt.recorded"
                    }
                    .to_owned(),
                    subject_type: "receipt".to_owned(),
                    subject_id: retained.receipt_id.clone(),
                    actor_id: retained.actor_id.clone(),
                    session_id: retained.session_id.clone(),
                    fence: Some(retained.fence),
                    as_of: retained.created_at.clone(),
                    payload_json: result_json,
                },
            )?;
            Ok((
                ReceiptInsertResult {
                    receipt: receipt_record(&retained),
                    revision: revision.0,
                    replayed: false,
                },
                validation_error,
            ))
        })();
        match result {
            Ok((_value, Some(error))) => {
                self.execute_batch("COMMIT")?;
                Err(error)
            }
            Ok((value, None)) => {
                self.execute_batch("COMMIT")?;
                Ok(value)
            }
            Err(error) => {
                let _ = self.execute_batch("ROLLBACK");
                Err(error)
            }
        }
    }

    pub fn receipt(&self, receipt_id: &str) -> Result<Option<ReceiptRecord>, StoreError> {
        let mut statement = self.prepare(
            "SELECT r.receipt_id, wi.project_id, r.work_id, r.attempt_id, r.fence,
                    r.operation_id, r.gate_id, r.executable, r.argv_json, r.cwd,
                    r.exit_code, r.started_at, r.ended_at, r.source_version_id,
                    r.config_identity, r.environment_fingerprint, r.output_digest,
                    r.output_ref, r.subject_json, r.coverage_json, r.attestation,
                    r.result, r.rejection_code, r.created_at
             FROM receipt r JOIN work_item wi ON wi.work_id = r.work_id
             WHERE r.receipt_id = ?1",
        )?;
        statement.bind_text(1, receipt_id)?;
        if statement.step()? != SQLITE_ROW {
            return Ok(None);
        }
        Ok(Some(receipt_from_statement(&statement)?))
    }

    pub fn record_receipt(
        &self,
        request: impl Borrow<ReceiptInsertRequest>,
    ) -> Result<ReceiptInsertResult, StoreError> {
        self.insert_receipt(request)
    }

    pub fn read_receipt_operation(
        &self,
        project_id: &str,
        operation_id: &str,
    ) -> Result<Option<ReceiptInsertResult>, StoreError> {
        let Some(operation) = self.operation(operation_id)? else {
            return Ok(None);
        };
        if operation.project_id != project_id {
            return Err(StoreError::WrongSubject {
                expected: project_id.to_owned(),
                actual: operation.project_id,
            });
        }
        let receipt_id = json_string_field(&operation.result_json, "receipt_id")?;
        Ok(Some(ReceiptInsertResult {
            receipt: self.receipt(&receipt_id)?.ok_or_else(|| {
                StoreError::Corrupt("receipt operation refers to missing receipt".to_owned())
            })?,
            revision: operation.revision,
            replayed: true,
        }))
    }

    /// Updates a normalized gate and records the change as one revisioned
    /// operation. Receipt and review APIs use the same row helper inside their
    /// own transaction so a single evidence fact produces one revision.
    pub fn update_gate_state(
        &self,
        request: impl Borrow<GateStateUpdateRequest>,
    ) -> Result<MutationResult, StoreError> {
        let request = request.borrow();
        self.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| {
            if let Some(existing) = self.preflight_operation_replay(
                &request.project_id,
                &request.operation_id,
                "gate.update",
                &request.actor_id,
                request.session_id.as_deref(),
                request.expected_project_revision,
                None,
                None,
                &request.request_digest,
                "gate",
                &request.gate_id,
            )? {
                return Ok(MutationResult {
                    operation_id: existing.operation_id,
                    revision: existing.revision,
                    replayed: true,
                });
            }
            check_expected_revision(
                self.project_revision(&request.project_id)?.0,
                request.expected_project_revision,
            )?;
            self.require_gate(&request.project_id, &request.work_id, &request.gate_id)?;
            self.set_gate_state_row(
                &request.project_id,
                &request.work_id,
                &request.gate_id,
                request.state,
                &request.updated_at,
            )?;
            let revision = self.bump_revision_in_transaction(&request.project_id)?;
            let result_json = json_object(json!({
                "gate_id": request.gate_id,
                "state": gate_state_name(request.state),
            }))?;
            self.append_operation_audit_in_transaction(
                OperationRecord {
                    operation_id: request.operation_id.clone(),
                    project_id: request.project_id.clone(),
                    command: "gate.update".to_owned(),
                    actor_id: request.actor_id.clone(),
                    session_id: request.session_id.clone(),
                    expected_revision: request.expected_project_revision,
                    attempt_id: None,
                    fence: None,
                    request_digest: request.request_digest.clone(),
                    outcome: OperationOutcome::Changed,
                    result_json: result_json.clone(),
                    revision: revision.0,
                    created_at: request.updated_at.clone(),
                    completed_at: Some(request.updated_at.clone()),
                },
                AuditEventRecord {
                    project_id: request.project_id.clone(),
                    revision: revision.0,
                    operation_id: request.operation_id.clone(),
                    event_type: if request.state == GateState::Satisfied {
                        "gate.satisfied"
                    } else {
                        "repair.correction"
                    }
                    .to_owned(),
                    subject_type: "gate".to_owned(),
                    subject_id: request.gate_id.clone(),
                    actor_id: request.actor_id.clone(),
                    session_id: request.session_id.clone(),
                    fence: None,
                    as_of: request.updated_at.clone(),
                    payload_json: result_json,
                },
            )?;
            Ok(MutationResult {
                operation_id: request.operation_id.clone(),
                revision: revision.0,
                replayed: false,
            })
        })();
        finish_transaction(self, result)
    }

    pub fn set_gate_state(
        &self,
        request: impl Borrow<GateStateUpdateRequest>,
    ) -> Result<MutationResult, StoreError> {
        self.update_gate_state(request)
    }

    pub fn gate(
        &self,
        project_id: &str,
        work_id: &str,
        gate_id: &str,
    ) -> Result<Option<GateRecord>, StoreError> {
        let mut statement = self.prepare(
            "SELECT g.gate_id, wi.project_id, g.work_id, g.profile_id,
                    g.profile_version, g.kind, g.required, g.state,
                    g.subject_ref, g.updated_at
             FROM gate g JOIN work_item wi ON wi.work_id = g.work_id
             WHERE wi.project_id = ?1 AND g.work_id = ?2 AND g.gate_id = ?3",
        )?;
        statement.bind_text(1, project_id)?;
        statement.bind_text(2, work_id)?;
        statement.bind_text(3, gate_id)?;
        if statement.step()? != SQLITE_ROW {
            return Ok(None);
        }
        Ok(Some(GateRecord {
            gate_id: statement.column_text(0)?,
            project_id: statement.column_text(1)?,
            work_id: statement.column_text(2)?,
            profile_id: statement.column_text(3)?,
            profile_version: statement.column_u64(4)?,
            kind: parse_gate_kind(&statement.column_text(5)?)?,
            required: statement.column_i64(6)? == 1,
            state: parse_gate_state(&statement.column_text(7)?)?,
            subject_ref: statement.column_text(8)?,
            updated_at: statement.column_text(9)?,
        }))
    }

    pub fn gate_diagnostics(
        &self,
        project_id: &str,
        work_id: &str,
        attempt_id: &str,
        fence: u64,
    ) -> Result<GateDiagnostics, StoreError> {
        self.gate_diagnostics_inner(project_id, work_id, Some(attempt_id), Some(fence))
    }

    pub fn gate_diagnostics_for_work(
        &self,
        project_id: &str,
        work_id: &str,
    ) -> Result<GateDiagnostics, StoreError> {
        self.gate_diagnostics_inner(project_id, work_id, None, None)
    }

    pub fn insert_review(
        &self,
        request: impl Borrow<ReviewInsertRequest>,
    ) -> Result<MutationResult, StoreError> {
        let request = request.borrow();
        self.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| {
            if let Some(existing) = self.preflight_operation_replay(
                &request.project_id,
                &request.operation_id,
                "review.insert",
                &request.actor_id,
                request.session_id.as_deref(),
                request.expected_project_revision,
                Some(&request.attempt_id),
                Some(request.fence),
                &request.request_digest,
                "review",
                &request.review_id,
            )? {
                return Ok(MutationResult {
                    operation_id: existing.operation_id,
                    revision: existing.revision,
                    replayed: true,
                });
            }
            check_expected_revision(
                self.project_revision(&request.project_id)?.0,
                request.expected_project_revision,
            )?;
            let attempt = self
                .attempt_record(&request.attempt_id, false)?
                .ok_or_else(|| StoreError::NotFound {
                    entity: "attempt",
                    id: request.attempt_id.clone(),
                })?;
            if attempt.project_id != request.project_id || attempt.work_id != request.work_id {
                return Err(StoreError::WrongSubject {
                    expected: format!("{}/{}", request.project_id, request.work_id),
                    actual: format!("{}/{}", attempt.project_id, attempt.work_id),
                });
            }
            if attempt.fence != request.fence {
                return Err(StoreError::StaleFence {
                    expected: request.fence,
                    actual: attempt.fence,
                });
            }
            let mut statement = self.prepare(
                "INSERT INTO review (
                    review_id, work_id, attempt_id, fence, gate_id, reviewer_actor_id,
                    decision, reason, source_version_id, policy_digest, created_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            )?;
            statement.bind_text(1, &request.review_id)?;
            statement.bind_text(2, &request.work_id)?;
            statement.bind_text(3, &request.attempt_id)?;
            statement.bind_i64(4, request.fence)?;
            statement.bind_optional_text(5, request.gate_id.as_deref())?;
            statement.bind_text(6, &request.reviewer_actor_id)?;
            statement.bind_text(7, review_decision_name(request.decision))?;
            statement.bind_text(8, &request.reason)?;
            statement.bind_optional_text(9, request.source_version_id.as_deref())?;
            statement.bind_text(10, &request.policy_digest)?;
            statement.bind_text(11, &request.created_at)?;
            statement.run()?;
            if let Some(gate_id) = request.gate_id.as_deref() {
                self.set_gate_state_row(
                    &request.project_id,
                    &request.work_id,
                    gate_id,
                    if request.decision == ReviewDecision::Accepted {
                        GateState::Satisfied
                    } else {
                        GateState::Failed
                    },
                    &request.created_at,
                )?;
            }
            let revision = self.bump_revision_in_transaction(&request.project_id)?;
            let result_json = json_object(json!({
                "review_id": request.review_id,
                "decision": review_decision_name(request.decision),
            }))?;
            self.append_operation_audit_in_transaction(
                OperationRecord {
                    operation_id: request.operation_id.clone(),
                    project_id: request.project_id.clone(),
                    command: "review.insert".to_owned(),
                    actor_id: request.actor_id.clone(),
                    session_id: request.session_id.clone(),
                    expected_revision: request.expected_project_revision,
                    attempt_id: Some(request.attempt_id.clone()),
                    fence: Some(request.fence),
                    request_digest: request.request_digest.clone(),
                    outcome: if request.decision == ReviewDecision::Accepted {
                        OperationOutcome::Changed
                    } else {
                        OperationOutcome::Rejected
                    },
                    result_json: result_json.clone(),
                    revision: revision.0,
                    created_at: request.created_at.clone(),
                    completed_at: Some(request.created_at.clone()),
                },
                AuditEventRecord {
                    project_id: request.project_id.clone(),
                    revision: revision.0,
                    operation_id: request.operation_id.clone(),
                    event_type: if request.decision == ReviewDecision::Accepted {
                        "review.accepted"
                    } else {
                        "review.rejected"
                    }
                    .to_owned(),
                    subject_type: "review".to_owned(),
                    subject_id: request.review_id.clone(),
                    actor_id: request.actor_id.clone(),
                    session_id: request.session_id.clone(),
                    fence: Some(request.fence),
                    as_of: request.created_at.clone(),
                    payload_json: result_json,
                },
            )?;
            Ok(MutationResult {
                operation_id: request.operation_id.clone(),
                revision: revision.0,
                replayed: false,
            })
        })();
        finish_transaction(self, result)
    }

    pub fn add_review(
        &self,
        request: impl Borrow<ReviewInsertRequest>,
    ) -> Result<MutationResult, StoreError> {
        self.insert_review(request)
    }

    pub fn review(&self, review_id: &str) -> Result<Option<ReviewRecord>, StoreError> {
        let mut statement = self.prepare(
            "SELECT r.review_id, wi.project_id, r.work_id, r.attempt_id, r.fence,
                    r.gate_id, r.reviewer_actor_id, r.decision, r.reason,
                    r.source_version_id, r.policy_digest, r.created_at
             FROM review r JOIN work_item wi ON wi.work_id = r.work_id
             WHERE r.review_id = ?1",
        )?;
        statement.bind_text(1, review_id)?;
        if statement.step()? != SQLITE_ROW {
            return Ok(None);
        }
        Ok(Some(review_from_statement(&statement)?))
    }

    /// Inserts one immutable summary for the current attempt and atomically
    /// makes it the work item's current summary. Older summaries remain
    /// readable as history. Operation replay is bound to every semantic
    /// request field rather than a caller-provided digest label.
    pub fn insert_summary(
        &self,
        request: impl Borrow<SummaryInsertRequest>,
    ) -> Result<SummaryInsertResult, StoreError> {
        let request = request.borrow();
        validate_summary_request(request)?;
        let replay_digest = canonical_summary_request(request)?;

        self.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| {
            if let Some(existing) = self.preflight_operation_replay(
                &request.project_id,
                &request.operation_id,
                "summary.insert",
                &request.actor_id,
                request.session_id.as_deref(),
                request.expected_project_revision,
                Some(&request.attempt_id),
                Some(request.fence),
                &replay_digest,
                "summary",
                &request.summary_id,
            )? {
                return self.replay_summary_operation(request, &replay_digest, &existing);
            }
            check_expected_revision(
                self.project_revision(&request.project_id)?.0,
                request.expected_project_revision,
            )?;
            self.validate_summary_context(request)?;

            let mut supersede = self.prepare(
                "UPDATE summary SET current = 0
                 WHERE work_id = ?1 AND current = 1",
            )?;
            supersede.bind_text(1, &request.work_id)?;
            supersede.run()?;

            let subject_ref = summary_subject_ref(&request.attempt_id, request.fence);
            let mut statement = self.prepare(
                "INSERT INTO summary (
                    summary_id, work_id, attempt_id, fence, subject_ref,
                    source_version_id, config_identity, profile_id,
                    profile_version, body_digest, body_size, current, created_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 1, ?12)",
            )?;
            statement.bind_text(1, &request.summary_id)?;
            statement.bind_text(2, &request.work_id)?;
            statement.bind_text(3, &request.attempt_id)?;
            statement.bind_i64(4, request.fence)?;
            statement.bind_text(5, &subject_ref)?;
            statement.bind_text(6, &request.source_version_id)?;
            statement.bind_text(7, &request.config_identity)?;
            statement.bind_text(8, &request.profile_id)?;
            statement.bind_i64(9, request.profile_version)?;
            statement.bind_text(10, &request.body_digest)?;
            statement.bind_i64(11, request.body_size)?;
            statement.bind_text(12, &request.created_at)?;
            statement.run()?;

            let revision = self.bump_revision_in_transaction(&request.project_id)?;
            let result_json = summary_result_json(&request.summary_id)?;
            self.append_operation_audit_in_transaction(
                OperationRecord {
                    operation_id: request.operation_id.clone(),
                    project_id: request.project_id.clone(),
                    command: "summary.insert".to_owned(),
                    actor_id: request.actor_id.clone(),
                    session_id: request.session_id.clone(),
                    expected_revision: request.expected_project_revision,
                    attempt_id: Some(request.attempt_id.clone()),
                    fence: Some(request.fence),
                    request_digest: replay_digest,
                    outcome: OperationOutcome::Changed,
                    result_json: result_json.clone(),
                    revision: revision.0,
                    created_at: request.created_at.clone(),
                    completed_at: Some(request.created_at.clone()),
                },
                AuditEventRecord {
                    project_id: request.project_id.clone(),
                    revision: revision.0,
                    operation_id: request.operation_id.clone(),
                    // Schema v2 has no dedicated summary event discriminator;
                    // subject_type/subject_id identify this as the typed summary
                    // fact while the closeout event family remains compatible
                    // with existing v2 databases.
                    event_type: "close.requested".to_owned(),
                    subject_type: "summary".to_owned(),
                    subject_id: request.summary_id.clone(),
                    actor_id: request.actor_id.clone(),
                    session_id: request.session_id.clone(),
                    fence: Some(request.fence),
                    as_of: request.created_at.clone(),
                    payload_json: result_json,
                },
            )?;
            Ok(SummaryInsertResult {
                summary: self
                    .summary(&request.project_id, &request.summary_id)?
                    .ok_or_else(|| {
                        StoreError::Corrupt("summary disappeared after insert".to_owned())
                    })?,
                revision: revision.0,
                replayed: false,
            })
        })();
        finish_transaction(self, result)
    }

    pub fn summary(
        &self,
        project_id: &str,
        summary_id: &str,
    ) -> Result<Option<SummaryRecord>, StoreError> {
        self.summary_where(project_id, "s.summary_id = ?2", summary_id)
    }

    pub fn current_summary(
        &self,
        project_id: &str,
        work_id: &str,
    ) -> Result<Option<SummaryRecord>, StoreError> {
        self.summary_where(project_id, "s.work_id = ?2 AND s.current = 1", work_id)
    }

    pub fn read_summary_operation(
        &self,
        project_id: &str,
        operation_id: &str,
    ) -> Result<Option<SummaryInsertResult>, StoreError> {
        let Some(operation) = self.operation(operation_id)? else {
            return Ok(None);
        };
        if operation.project_id != project_id || operation.command != "summary.insert" {
            return Err(StoreError::WrongSubject {
                expected: project_id.to_owned(),
                actual: operation.project_id,
            });
        }
        let summary_id = json_string_field(&operation.result_json, "summary_id")?;
        Ok(Some(SummaryInsertResult {
            summary: self.summary(project_id, &summary_id)?.ok_or_else(|| {
                StoreError::Corrupt("summary operation refers to missing summary".to_owned())
            })?,
            revision: operation.revision,
            replayed: true,
        }))
    }

    fn summary_where(
        &self,
        project_id: &str,
        predicate: &str,
        value: &str,
    ) -> Result<Option<SummaryRecord>, StoreError> {
        let sql = format!(
            "SELECT s.summary_id, wi.project_id, s.work_id, s.attempt_id, s.fence,
                    s.subject_ref, s.source_version_id, s.config_identity,
                    s.profile_id, s.profile_version, s.body_digest, s.body_size,
                    s.current, s.created_at
             FROM summary s JOIN work_item wi ON wi.work_id = s.work_id
             WHERE wi.project_id = ?1 AND {predicate}"
        );
        let mut statement = self.prepare(&sql)?;
        statement.bind_text(1, project_id)?;
        statement.bind_text(2, value)?;
        if statement.step()? != SQLITE_ROW {
            return Ok(None);
        }
        Ok(Some(summary_from_statement(&statement)?))
    }

    /// Creates the durable proof-gated close intent. Creation is deliberately
    /// separate from finalization: missing gates leave this intent open for a
    /// later receipt or independent review to satisfy.
    pub fn create_close_intent(
        &self,
        request: impl Borrow<CloseIntentRequest>,
    ) -> Result<CloseIntentResult, StoreError> {
        let request = request.borrow();
        self.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| {
            if let Some(existing) = self.preflight_operation_replay(
                &request.project_id,
                &request.operation_id,
                "close.create",
                &request.actor_id,
                request.session_id.as_deref(),
                request.expected_project_revision,
                Some(&request.attempt_id),
                Some(request.fence),
                &request.request_digest,
                "work",
                &request.work_id,
            )? {
                return self.replay_close_operation(request, &existing);
            }
            self.validate_close_subject(request)?;
            check_expected_revision(
                self.project_revision(&request.project_id)?.0,
                request.expected_project_revision,
            )?;
            let mut statement = self.prepare(
                "INSERT INTO close_intent (
                    close_intent_id, work_id, attempt_id, fence, operation_id,
                    source_version_id, config_identity, profile_id, profile_version,
                    summary_id, state, created_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'open', ?11)",
            )?;
            statement.bind_text(1, &request.close_intent_id)?;
            statement.bind_text(2, &request.work_id)?;
            statement.bind_text(3, &request.attempt_id)?;
            statement.bind_i64(4, request.fence)?;
            statement.bind_text(5, &request.operation_id)?;
            statement.bind_optional_text(6, request.source_version_id.as_deref())?;
            statement.bind_text(7, &request.config_identity)?;
            statement.bind_text(8, &request.profile_id)?;
            statement.bind_i64(9, request.profile_version)?;
            statement.bind_optional_text(10, request.summary_id.as_deref())?;
            statement.bind_text(11, &request.at)?;
            statement.run()?;
            let revision = self.bump_revision_in_transaction(&request.project_id)?;
            let result_json = close_intent_result_json(&request.close_intent_id, "open")?;
            self.append_operation_audit_in_transaction(
                OperationRecord {
                    operation_id: request.operation_id.clone(),
                    project_id: request.project_id.clone(),
                    command: "close.create".to_owned(),
                    actor_id: request.actor_id.clone(),
                    session_id: request.session_id.clone(),
                    expected_revision: request.expected_project_revision,
                    attempt_id: Some(request.attempt_id.clone()),
                    fence: Some(request.fence),
                    request_digest: request.request_digest.clone(),
                    outcome: OperationOutcome::Changed,
                    result_json: result_json.clone(),
                    revision: revision.0,
                    created_at: request.at.clone(),
                    completed_at: Some(request.at.clone()),
                },
                AuditEventRecord {
                    project_id: request.project_id.clone(),
                    revision: revision.0,
                    operation_id: request.operation_id.clone(),
                    event_type: "close.requested".to_owned(),
                    subject_type: "work".to_owned(),
                    subject_id: request.work_id.clone(),
                    actor_id: request.actor_id.clone(),
                    session_id: request.session_id.clone(),
                    fence: Some(request.fence),
                    as_of: request.at.clone(),
                    payload_json: result_json,
                },
            )?;
            Ok(CloseIntentResult {
                close_intent: self
                    .close_intent(&request.project_id, &request.close_intent_id)?
                    .ok_or_else(|| {
                        StoreError::Corrupt("close intent disappeared after insert".to_owned())
                    })?,
                revision: revision.0,
                replayed: false,
                diagnostics: None,
            })
        })();
        finish_transaction(self, result)
    }

    pub fn request_close_intent(
        &self,
        request: impl Borrow<CloseIntentRequest>,
    ) -> Result<CloseIntentResult, StoreError> {
        self.create_close_intent(request)
    }

    /// Finalizes a matching intent and closes the work atomically. If gates
    /// are still open, the intent remains open and a rejected operation with
    /// complete diagnostics is durably recorded for replay/readback.
    pub fn finalize_close_intent(
        &self,
        request: impl Borrow<CloseIntentRequest>,
    ) -> Result<CloseIntentResult, StoreError> {
        let request = request.borrow();
        self.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| {
            if let Some(existing) = self.preflight_operation_replay(
                &request.project_id,
                &request.operation_id,
                "close.finalize",
                &request.actor_id,
                request.session_id.as_deref(),
                request.expected_project_revision,
                Some(&request.attempt_id),
                Some(request.fence),
                &request.request_digest,
                "work",
                &request.work_id,
            )? {
                return self.replay_close_operation(request, &existing);
            }
            check_expected_revision(
                self.project_revision(&request.project_id)?.0,
                request.expected_project_revision,
            )?;
            let intent = self
                .close_intent(&request.project_id, &request.close_intent_id)?
                .ok_or_else(|| StoreError::NotFound {
                    entity: "close intent",
                    id: request.close_intent_id.clone(),
                })?;
            validate_close_intent_match(request, &intent)?;
            if intent.state != CloseIntentState::Open {
                return Err(StoreError::Conflict(format!(
                    "close intent is not open: {:?}",
                    intent.state
                )));
            }
            self.validate_close_subject(request)?;
            let mut diagnostics = self.gate_diagnostics(
                &request.project_id,
                &request.work_id,
                &request.attempt_id,
                request.fence,
            )?;
            let attempt = self
                .attempt_record(&request.attempt_id, false)?
                .ok_or_else(|| StoreError::NotFound {
                    entity: "attempt",
                    id: request.attempt_id.clone(),
                })?;
            if !attempt.current || !matches!(attempt.phase, AttemptPhase::Verifying) {
                diagnostics.missing.push("attempt_not_verifying".to_owned());
                diagnostics.missing.sort();
                diagnostics.missing.dedup();
            }
            let summary_required =
                match self.summary_required(&request.project_id, &request.work_id) {
                    Ok(required) => required,
                    Err(StoreError::Corrupt(_)) => {
                        diagnostics.missing.push("requirements_missing".to_owned());
                        false
                    }
                    Err(error) => return Err(error),
                };
            if summary_required && !self.current_summary_matches_close(request, &attempt)? {
                diagnostics.missing.push("summary".to_owned());
                diagnostics.missing.sort();
                diagnostics.missing.dedup();
            }
            diagnostics.missing.sort();
            diagnostics.missing.dedup();
            if !diagnostics.missing.is_empty() {
                let revision = self.bump_revision_in_transaction(&request.project_id)?;
                let result_json =
                    close_rejected_result_json(&request.close_intent_id, &diagnostics.missing)?;
                self.append_operation_audit_in_transaction(
                    OperationRecord {
                        operation_id: request.operation_id.clone(),
                        project_id: request.project_id.clone(),
                        command: "close.finalize".to_owned(),
                        actor_id: request.actor_id.clone(),
                        session_id: request.session_id.clone(),
                        expected_revision: request.expected_project_revision,
                        attempt_id: Some(request.attempt_id.clone()),
                        fence: Some(request.fence),
                        request_digest: request.request_digest.clone(),
                        outcome: OperationOutcome::Rejected,
                        result_json: result_json.clone(),
                        revision: revision.0,
                        created_at: request.at.clone(),
                        completed_at: Some(request.at.clone()),
                    },
                    AuditEventRecord {
                        project_id: request.project_id.clone(),
                        revision: revision.0,
                        operation_id: request.operation_id.clone(),
                        event_type: "close.requested".to_owned(),
                        subject_type: "work".to_owned(),
                        subject_id: request.work_id.clone(),
                        actor_id: request.actor_id.clone(),
                        session_id: request.session_id.clone(),
                        fence: Some(request.fence),
                        as_of: request.at.clone(),
                        payload_json: result_json,
                    },
                )?;
                return Ok(CloseIntentResult {
                    close_intent: intent,
                    revision: revision.0,
                    replayed: false,
                    diagnostics: Some(diagnostics),
                });
            }
            self.finalize_close_rows(request)?;
            let revision = self.bump_revision_in_transaction(&request.project_id)?;
            let result_json = close_intent_result_json(&request.close_intent_id, "finalized")?;
            self.append_operation_audit_in_transaction(
                OperationRecord {
                    operation_id: request.operation_id.clone(),
                    project_id: request.project_id.clone(),
                    command: "close.finalize".to_owned(),
                    actor_id: request.actor_id.clone(),
                    session_id: request.session_id.clone(),
                    expected_revision: request.expected_project_revision,
                    attempt_id: Some(request.attempt_id.clone()),
                    fence: Some(request.fence),
                    request_digest: request.request_digest.clone(),
                    outcome: OperationOutcome::Changed,
                    result_json: result_json.clone(),
                    revision: revision.0,
                    created_at: request.at.clone(),
                    completed_at: Some(request.at.clone()),
                },
                AuditEventRecord {
                    project_id: request.project_id.clone(),
                    revision: revision.0,
                    operation_id: request.operation_id.clone(),
                    event_type: "work.closed".to_owned(),
                    subject_type: "work".to_owned(),
                    subject_id: request.work_id.clone(),
                    actor_id: request.actor_id.clone(),
                    session_id: request.session_id.clone(),
                    fence: Some(request.fence),
                    as_of: request.at.clone(),
                    payload_json: result_json,
                },
            )?;
            Ok(CloseIntentResult {
                close_intent: self
                    .close_intent(&request.project_id, &request.close_intent_id)?
                    .ok_or_else(|| {
                        StoreError::Corrupt(
                            "close intent disappeared after finalization".to_owned(),
                        )
                    })?,
                revision: revision.0,
                replayed: false,
                diagnostics: None,
            })
        })();
        finish_transaction(self, result)
    }

    pub fn reject_close_intent(
        &self,
        request: impl Borrow<CloseIntentRequest>,
        rejection_code: &str,
    ) -> Result<CloseIntentResult, StoreError> {
        let request = request.borrow();
        if rejection_code.is_empty() {
            return Err(StoreError::Invalid(
                "close intent rejection code must not be empty".to_owned(),
            ));
        }
        self.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| {
            if let Some(existing) = self.preflight_operation_replay(
                &request.project_id,
                &request.operation_id,
                "close.reject",
                &request.actor_id,
                request.session_id.as_deref(),
                request.expected_project_revision,
                Some(&request.attempt_id),
                Some(request.fence),
                &request.request_digest,
                "work",
                &request.work_id,
            )? {
                return self.replay_close_operation(request, &existing);
            }
            check_expected_revision(
                self.project_revision(&request.project_id)?.0,
                request.expected_project_revision,
            )?;
            let intent = self
                .close_intent(&request.project_id, &request.close_intent_id)?
                .ok_or_else(|| StoreError::NotFound {
                    entity: "close intent",
                    id: request.close_intent_id.clone(),
                })?;
            validate_close_intent_match(request, &intent)?;
            self.validate_close_subject(request)?;
            let mut update = self.prepare(
                "UPDATE close_intent SET state = 'rejected', invalidation_code = ?1
                 WHERE close_intent_id = ?2 AND state = 'open'",
            )?;
            update.bind_text(1, rejection_code)?;
            update.bind_text(2, &request.close_intent_id)?;
            update.run()?;
            let revision = self.bump_revision_in_transaction(&request.project_id)?;
            let result_json = close_intent_result_json(&request.close_intent_id, "rejected")?;
            self.append_operation_audit_in_transaction(
                OperationRecord {
                    operation_id: request.operation_id.clone(),
                    project_id: request.project_id.clone(),
                    command: "close.reject".to_owned(),
                    actor_id: request.actor_id.clone(),
                    session_id: request.session_id.clone(),
                    expected_revision: request.expected_project_revision,
                    attempt_id: Some(request.attempt_id.clone()),
                    fence: Some(request.fence),
                    request_digest: request.request_digest.clone(),
                    outcome: OperationOutcome::Rejected,
                    result_json: result_json.clone(),
                    revision: revision.0,
                    created_at: request.at.clone(),
                    completed_at: Some(request.at.clone()),
                },
                AuditEventRecord {
                    project_id: request.project_id.clone(),
                    revision: revision.0,
                    operation_id: request.operation_id.clone(),
                    event_type: "repair.correction".to_owned(),
                    subject_type: "work".to_owned(),
                    subject_id: request.work_id.clone(),
                    actor_id: request.actor_id.clone(),
                    session_id: request.session_id.clone(),
                    fence: Some(request.fence),
                    as_of: request.at.clone(),
                    payload_json: json_object(json!({
                        "close_intent_id": request.close_intent_id,
                        "rejection_code": rejection_code,
                    }))?,
                },
            )?;
            Ok(CloseIntentResult {
                close_intent: self
                    .close_intent(&request.project_id, &request.close_intent_id)?
                    .ok_or_else(|| {
                        StoreError::Corrupt("close intent disappeared after rejection".to_owned())
                    })?,
                revision: revision.0,
                replayed: false,
                diagnostics: None,
            })
        })();
        finish_transaction(self, result)
    }

    pub fn close_intent(
        &self,
        project_id: &str,
        close_intent_id: &str,
    ) -> Result<Option<CloseIntentRecord>, StoreError> {
        let mut statement = self.prepare(
            "SELECT ci.close_intent_id, wi.project_id, ci.work_id, ci.attempt_id,
                    ci.fence, ci.operation_id, ci.source_version_id, ci.config_identity,
                    ci.profile_id, ci.profile_version, ci.summary_id, ci.state,
                    ci.created_at, ci.finalized_at, ci.invalidated_at, ci.invalidation_code
             FROM close_intent ci JOIN work_item wi ON wi.work_id = ci.work_id
             WHERE ci.close_intent_id = ?1",
        )?;
        statement.bind_text(1, close_intent_id)?;
        if statement.step()? != SQLITE_ROW {
            return Ok(None);
        }
        if statement.column_text(1)? != project_id {
            return Err(StoreError::WrongSubject {
                expected: project_id.to_owned(),
                actual: statement.column_text(1)?,
            });
        }
        Ok(Some(close_intent_from_statement(&statement)?))
    }

    pub fn read_close_intent(
        &self,
        project_id: &str,
        close_intent_id: &str,
    ) -> Result<Option<CloseIntentRecord>, StoreError> {
        self.close_intent(project_id, close_intent_id)
    }

    pub fn read_close_intent_operation(
        &self,
        project_id: &str,
        operation_id: &str,
    ) -> Result<Option<CloseIntentResult>, StoreError> {
        let Some(operation) = self.operation(operation_id)? else {
            return Ok(None);
        };
        if operation.project_id != project_id {
            return Err(StoreError::WrongSubject {
                expected: project_id.to_owned(),
                actual: operation.project_id,
            });
        }
        let close_intent_id = json_string_field(&operation.result_json, "close_intent_id")?;
        Ok(Some(CloseIntentResult {
            close_intent: self
                .close_intent(project_id, &close_intent_id)?
                .ok_or_else(|| {
                    StoreError::Corrupt("close operation refers to missing close intent".to_owned())
                })?,
            revision: operation.revision,
            replayed: true,
            diagnostics: None,
        }))
    }

    fn validate_summary_context(&self, request: &SummaryInsertRequest) -> Result<(), StoreError> {
        let attempt = self
            .attempt_record(&request.attempt_id, false)?
            .ok_or_else(|| StoreError::NotFound {
                entity: "attempt",
                id: request.attempt_id.clone(),
            })?;
        if attempt.project_id != request.project_id || attempt.work_id != request.work_id {
            return Err(StoreError::WrongSubject {
                expected: format!("{}/{}", request.project_id, request.work_id),
                actual: format!("{}/{}", attempt.project_id, attempt.work_id),
            });
        }
        if attempt.fence != request.fence {
            return Err(StoreError::StaleFence {
                expected: request.fence,
                actual: attempt.fence,
            });
        }
        if !attempt.current {
            return Err(StoreError::NotCurrent {
                attempt_id: attempt.attempt_id,
            });
        }
        if attempt.actor_id != request.actor_id {
            return Err(StoreError::WrongOwner {
                expected: request.actor_id.clone(),
                actual: attempt.actor_id,
            });
        }
        if attempt.session_id != request.session_id {
            return Err(StoreError::WrongOwner {
                expected: request.session_id.clone().unwrap_or_default(),
                actual: attempt.session_id.unwrap_or_default(),
            });
        }
        if attempt.source_version_id.as_deref() != Some(request.source_version_id.as_str()) {
            return Err(StoreError::Invalid(
                "summary source context mismatch".to_owned(),
            ));
        }
        if attempt.config_identity != request.config_identity {
            return Err(StoreError::Invalid(
                "summary config context mismatch".to_owned(),
            ));
        }

        let mut work = self.prepare(
            "SELECT acceptance_profile_id, acceptance_profile_version
             FROM work_item WHERE project_id = ?1 AND work_id = ?2",
        )?;
        work.bind_text(1, &request.project_id)?;
        work.bind_text(2, &request.work_id)?;
        if work.step()? != SQLITE_ROW {
            return Err(StoreError::NotFound {
                entity: "work",
                id: request.work_id.clone(),
            });
        }
        if work.column_text(0)? != request.profile_id
            || work.column_u64(1)? != request.profile_version
        {
            return Err(StoreError::Invalid(
                "summary profile context mismatch".to_owned(),
            ));
        }
        Ok(())
    }

    fn summary_required(&self, project_id: &str, work_id: &str) -> Result<bool, StoreError> {
        if let Some(requirements) =
            self.current_pinned_requirements_for_policy(project_id, work_id)?
        {
            return Ok(requirements.requires_kind("summary"));
        }
        let mut statement = self.prepare(
            "SELECT 1 FROM gate g
             JOIN work_item wi ON wi.work_id = g.work_id
             WHERE wi.project_id = ?1 AND g.work_id = ?2
               AND g.kind = 'summary' AND g.required = 1
             LIMIT 1",
        )?;
        statement.bind_text(1, project_id)?;
        statement.bind_text(2, work_id)?;
        Ok(statement.step()? == SQLITE_ROW)
    }

    fn current_summary_matches_close(
        &self,
        request: &CloseIntentRequest,
        attempt: &AttemptRecord,
    ) -> Result<bool, StoreError> {
        let Some(summary) = self.current_summary(&request.project_id, &request.work_id)? else {
            return Ok(false);
        };
        Ok(summary.attempt_id == request.attempt_id
            && summary.fence == request.fence
            && summary.source_version_id
                == request.source_version_id.as_deref().unwrap_or_default()
            && summary.config_identity == request.config_identity
            && summary.profile_id == request.profile_id
            && summary.profile_version == request.profile_version
            && request
                .summary_id
                .as_ref()
                .is_none_or(|summary_id| summary.summary_id == *summary_id)
            && summary.body_size > 0
            && summary.body_size <= MAX_SUMMARY_BODY_BYTES
            && valid_sha256_digest(&summary.body_digest)
            && attempt.current
            && attempt.actor_id == request.actor_id
            && attempt.session_id == request.session_id
            && attempt.source_version_id == request.source_version_id
            && attempt.config_identity == request.config_identity)
    }

    fn replay_summary_operation(
        &self,
        request: &SummaryInsertRequest,
        replay_digest: &str,
        operation: &OperationRecord,
    ) -> Result<SummaryInsertResult, StoreError> {
        if operation.project_id != request.project_id
            || operation.command != "summary.insert"
            || operation.request_digest != replay_digest
        {
            return Err(StoreError::Conflict(format!(
                "operation {} was already used with another request",
                request.operation_id
            )));
        }
        let summary_id = json_string_field(&operation.result_json, "summary_id")?;
        Ok(SummaryInsertResult {
            summary: self
                .summary(&request.project_id, &summary_id)?
                .ok_or_else(|| {
                    StoreError::Corrupt("summary operation refers to missing summary".to_owned())
                })?,
            revision: operation.revision,
            replayed: true,
        })
    }

    fn receipt_acceptance_error(
        &self,
        request: &ReceiptInsertRequest,
    ) -> Result<Option<StoreError>, StoreError> {
        let attempt = self
            .attempt_record(&request.attempt_id, false)?
            .ok_or_else(|| StoreError::NotFound {
                entity: "attempt",
                id: request.attempt_id.clone(),
            })?;
        if attempt.project_id != request.project_id || attempt.work_id != request.work_id {
            return Ok(Some(StoreError::WrongSubject {
                expected: format!("{}/{}", request.project_id, request.work_id),
                actual: format!("{}/{}", attempt.project_id, attempt.work_id),
            }));
        }
        if attempt.fence != request.fence {
            return Ok(Some(StoreError::StaleFence {
                expected: request.fence,
                actual: attempt.fence,
            }));
        }
        if !attempt.current {
            return Ok(Some(StoreError::NotCurrent {
                attempt_id: attempt.attempt_id,
            }));
        }
        if attempt.actor_id != request.actor_id {
            return Ok(Some(StoreError::WrongOwner {
                expected: request.actor_id.clone(),
                actual: attempt.actor_id,
            }));
        }
        if attempt.session_id != request.session_id {
            return Ok(Some(StoreError::WrongOwner {
                expected: request.session_id.clone().unwrap_or_default(),
                actual: attempt.session_id.unwrap_or_default(),
            }));
        }

        if request.attestation == ReceiptAttestation::BorealWitnessed
            && request.submission_kind != ReceiptSubmissionKind::WitnessedExecutor
        {
            return Ok(Some(receipt_rejected("witnessed_receipt_import_denied")));
        }
        if request.submission_kind == ReceiptSubmissionKind::WitnessedExecutor
            && request.attestation != ReceiptAttestation::BorealWitnessed
        {
            return Ok(Some(receipt_rejected("receipt_attestation_missing")));
        }
        let Some(expected) = request.acceptance.as_ref() else {
            return self.witnessed_execution_acceptance_error(request);
        };
        if request.work_id != expected.work_id
            || request.attempt_id != expected.attempt_id
            || request.gate_id.as_deref() != Some(expected.gate_id.as_str())
        {
            return Ok(Some(StoreError::WrongSubject {
                expected: format!(
                    "{}/{}/{}",
                    expected.work_id, expected.attempt_id, expected.gate_id
                ),
                actual: format!(
                    "{}/{}/{}",
                    request.work_id,
                    request.attempt_id,
                    request.gate_id.as_deref().unwrap_or_default()
                ),
            }));
        }
        if request.fence != expected.fence {
            return Ok(Some(StoreError::StaleFence {
                expected: expected.fence,
                actual: request.fence,
            }));
        }
        if request.source_version_id != expected.source_version_id
            || attempt.source_version_id != expected.source_version_id
        {
            return Ok(Some(receipt_rejected("receipt_source_mismatch")));
        }
        if request.config_identity != expected.config_identity
            || attempt.config_identity != expected.config_identity
        {
            return Ok(Some(receipt_rejected("receipt_config_mismatch")));
        }
        if attempt.work_id != expected.work_id
            || attempt.attempt_id != expected.attempt_id
            || attempt.fence != expected.fence
        {
            return Ok(Some(StoreError::WrongSubject {
                expected: format!("{}/{}", expected.work_id, expected.attempt_id),
                actual: format!("{}/{}", attempt.work_id, attempt.attempt_id),
            }));
        }

        if let Some(requirements) =
            self.current_pinned_requirements_for_policy(&request.project_id, &expected.work_id)?
        {
            let declaration = requirements.declarations.iter().find(|declaration| {
                declaration.gate_id == expected.gate_id
                    || format!("{}:{}", expected.work_id, declaration.gate_id) == expected.gate_id
            });
            let Some(declaration) = declaration else {
                return Ok(Some(receipt_rejected("receipt_subject_mismatch")));
            };
            if requirements.profile.profile_id != expected.profile_id
                || requirements.profile.version != expected.profile_version
                || declaration.kind != gate_kind(expected.gate_kind)
                || declaration.required != expected.gate_required
            {
                return Ok(Some(receipt_rejected("receipt_policy_mismatch")));
            }
        }

        let mut gate = self.prepare(
            "SELECT g.profile_id, g.profile_version, g.kind, g.required,
                    wi.acceptance_profile_id, wi.acceptance_profile_version
             FROM gate g
             JOIN work_item wi ON wi.work_id = g.work_id
             WHERE wi.project_id = ?1 AND g.work_id = ?2 AND g.gate_id = ?3",
        )?;
        gate.bind_text(1, &request.project_id)?;
        gate.bind_text(2, &expected.work_id)?;
        gate.bind_text(3, &expected.gate_id)?;
        if gate.step()? != SQLITE_ROW {
            return Ok(Some(receipt_rejected("receipt_subject_mismatch")));
        }
        let persisted_profile_id = gate.column_text(0)?;
        let persisted_profile_version = gate.column_u64(1)?;
        let persisted_kind = parse_gate_kind(&gate.column_text(2)?)?;
        let persisted_required = gate.column_i64(3)? == 1;
        let work_profile_id = gate.column_text(4)?;
        let work_profile_version = gate.column_u64(5)?;
        if persisted_profile_id != expected.profile_id
            || persisted_profile_version != expected.profile_version
            || work_profile_id != expected.profile_id
            || work_profile_version != expected.profile_version
            || persisted_kind != expected.gate_kind
            || persisted_required != expected.gate_required
        {
            return Ok(Some(receipt_rejected("receipt_policy_mismatch")));
        }
        if expected.requires_attestation
            && request.result == ReceiptOutcome::Passed
            && !matches!(
                request.attestation,
                ReceiptAttestation::BorealWitnessed | ReceiptAttestation::ExternalAttested
            )
        {
            return Ok(Some(receipt_rejected("receipt_attestation_missing")));
        }
        self.witnessed_execution_acceptance_error(request)
    }

    fn witnessed_execution_acceptance_error(
        &self,
        request: &ReceiptInsertRequest,
    ) -> Result<Option<StoreError>, StoreError> {
        if request.submission_kind != ReceiptSubmissionKind::WitnessedExecutor {
            return Ok(None);
        }
        let Some(execution) = self.evidence_execution(&request.operation_id)? else {
            return Ok(Some(receipt_rejected("witnessed_execution_not_admitted")));
        };
        if execution.project_id != request.project_id
            || execution.work_id != request.work_id
            || execution.attempt_id != request.attempt_id
            || execution.fence != request.fence
            || execution.gate_id != request.gate_id.as_deref().unwrap_or_default()
            || execution.actor_id != request.actor_id
            || execution.session_id != request.session_id
        {
            return Ok(Some(receipt_rejected(
                "witnessed_execution_subject_mismatch",
            )));
        }
        if execution.state != EvidenceExecutionState::Exited {
            return Ok(Some(receipt_rejected("witnessed_execution_not_exited")));
        }
        Ok(None)
    }

    fn insert_receipt_row(&self, request: &ReceiptInsertRequest) -> Result<(), StoreError> {
        let mut statement = self.prepare(
            "INSERT INTO receipt (
                receipt_id, work_id, attempt_id, fence, operation_id, gate_id,
                executable, argv_json, cwd, exit_code, started_at, ended_at,
                source_version_id, config_identity, environment_fingerprint,
                output_digest, output_ref, subject_json, coverage_json, attestation,
                result, rejection_code, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
                       ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23)",
        )?;
        statement.bind_text(1, &request.receipt_id)?;
        statement.bind_text(2, &request.work_id)?;
        statement.bind_text(3, &request.attempt_id)?;
        statement.bind_i64(4, request.fence)?;
        statement.bind_text(5, &request.operation_id)?;
        statement.bind_optional_text(6, request.gate_id.as_deref())?;
        statement.bind_text(7, &request.executable)?;
        statement.bind_text(8, &request.argv_json)?;
        statement.bind_text(9, &request.cwd)?;
        statement.bind_signed_i64(10, request.exit_code as i64)?;
        statement.bind_text(11, &request.started_at)?;
        statement.bind_text(12, &request.ended_at)?;
        statement.bind_optional_text(13, request.source_version_id.as_deref())?;
        statement.bind_text(14, &request.config_identity)?;
        statement.bind_text(15, &request.environment_fingerprint)?;
        statement.bind_optional_text(16, request.output_digest.as_deref())?;
        statement.bind_optional_text(17, request.output_ref.as_deref())?;
        statement.bind_text(18, &request.subject_json)?;
        statement.bind_text(19, &request.coverage_json)?;
        statement.bind_text(20, receipt_attestation_name(request.attestation))?;
        statement.bind_text(21, receipt_outcome_name(request.result))?;
        statement.bind_optional_text(22, request.rejection_code.as_deref())?;
        statement.bind_text(23, &request.created_at)?;
        statement.run()
    }

    fn require_gate(
        &self,
        project_id: &str,
        work_id: &str,
        gate_id: &str,
    ) -> Result<(), StoreError> {
        let mut statement = self.prepare(
            "SELECT 1 FROM gate g JOIN work_item wi ON wi.work_id = g.work_id
             WHERE wi.project_id = ?1 AND g.work_id = ?2 AND g.gate_id = ?3",
        )?;
        statement.bind_text(1, project_id)?;
        statement.bind_text(2, work_id)?;
        statement.bind_text(3, gate_id)?;
        if statement.step()? == SQLITE_ROW {
            Ok(())
        } else {
            Err(StoreError::NotFound {
                entity: "gate",
                id: gate_id.to_owned(),
            })
        }
    }

    fn set_gate_state_row(
        &self,
        project_id: &str,
        work_id: &str,
        gate_id: &str,
        state: GateState,
        updated_at: &str,
    ) -> Result<(), StoreError> {
        self.require_gate(project_id, work_id, gate_id)?;
        let mut statement = self.prepare(
            "UPDATE gate SET state = ?1, updated_at = ?2
             WHERE gate_id = ?3 AND work_id = ?4",
        )?;
        statement.bind_text(1, gate_state_name(state))?;
        statement.bind_text(2, updated_at)?;
        statement.bind_text(3, gate_id)?;
        statement.bind_text(4, work_id)?;
        statement.run()
    }

    fn gate_diagnostics_inner(
        &self,
        project_id: &str,
        work_id: &str,
        attempt_id: Option<&str>,
        fence: Option<u64>,
    ) -> Result<GateDiagnostics, StoreError> {
        let revision = self.project_revision(project_id)?.0;
        self.gate_diagnostics_at_revision(project_id, work_id, attempt_id, fence, revision)
    }

    fn gate_diagnostics_at_revision(
        &self,
        project_id: &str,
        work_id: &str,
        attempt_id: Option<&str>,
        fence: Option<u64>,
        revision: u64,
    ) -> Result<GateDiagnostics, StoreError> {
        let pinned_requirements =
            match self.current_pinned_requirements_for_policy(project_id, work_id) {
                Ok(requirements) => requirements,
                Err(StoreError::Corrupt(_)) => {
                    return Ok(GateDiagnostics {
                        project_id: project_id.to_owned(),
                        work_id: work_id.to_owned(),
                        attempt_id: attempt_id.map(str::to_owned),
                        fence,
                        revision,
                        gates: Vec::new(),
                        missing: vec!["requirements_missing".to_owned()],
                    });
                }
                Err(error) => return Err(error),
            };
        let gate_query = if pinned_requirements.is_some() {
            "SELECT p.work_id || ':' || r.gate_id, r.kind, r.required,
                    COALESCE(observed.state, 'open')
             FROM boreal_pinned_requirement p
             JOIN boreal_pinned_requirement_gate r
               ON r.project_id = p.project_id
              AND r.work_id = p.work_id
              AND r.proof_revision = p.proof_revision
             LEFT JOIN gate observed
               ON observed.work_id = p.work_id
              AND observed.gate_id = p.work_id || ':' || r.gate_id
             WHERE p.project_id = ?1 AND p.work_id = ?2
               AND p.proof_revision = (
                 SELECT MAX(current.proof_revision)
                 FROM boreal_pinned_requirement current
                 WHERE current.project_id = p.project_id
                   AND current.work_id = p.work_id
               )
             ORDER BY 1"
        } else {
            "SELECT g.gate_id, g.kind, g.required, g.state
             FROM gate g JOIN work_item wi ON wi.work_id = g.work_id
             WHERE wi.project_id = ?1 AND g.work_id = ?2
             ORDER BY g.gate_id"
        };
        let mut statement = self.prepare(gate_query)?;
        statement.bind_text(1, project_id)?;
        statement.bind_text(2, work_id)?;
        let mut gates = Vec::new();
        while statement.step()? == SQLITE_ROW {
            let gate_id = statement.column_text(0)?;
            let kind = parse_gate_kind(&statement.column_text(1)?)?;
            let required = statement.column_i64(2)? == 1;
            let persisted_state = parse_gate_state(&statement.column_text(3)?)?;
            let (state, receipt_id, reason) =
                if let (Some(attempt_id), Some(fence)) = (attempt_id, fence) {
                    // A work-level gate state is useful as a projection, but it
                    // cannot authorize a new attempt.  For an attempt-scoped
                    // read, derive the answer from proof bound to this exact
                    // attempt/fence (or from a typed summary/review fact).
                    let receipt_id =
                        self.latest_receipt_for_gate(&gate_id, work_id, attempt_id, fence)?;
                    if let Some(receipt_id) = receipt_id.clone() {
                        let receipt = self.receipt(&receipt_id)?.ok_or_else(|| {
                            StoreError::Corrupt(format!(
                                "gate {gate_id} references missing receipt {receipt_id}"
                            ))
                        })?;
                        let state = if receipt.result == ReceiptOutcome::Passed
                            && receipt.rejection_code.is_none()
                        {
                            GateState::Satisfied
                        } else {
                            GateState::Failed
                        };
                        let reason = receipt.rejection_code.or_else(|| {
                            (receipt.result != ReceiptOutcome::Passed)
                                .then(|| receipt_outcome_name(receipt.result).to_owned())
                        });
                        (state, Some(receipt_id), reason)
                    } else if (kind == GateKind::Review
                        && self.current_review_is_accepted(work_id, attempt_id, fence, &gate_id)?)
                        || (kind == GateKind::Summary
                            && self.current_summary_satisfies_gate(
                                project_id, work_id, attempt_id, fence, &gate_id,
                            )?)
                    {
                        (GateState::Satisfied, None, None)
                    } else {
                        (
                            GateState::Open,
                            None,
                            Some("current_proof_missing".to_owned()),
                        )
                    }
                } else {
                    (persisted_state, None, None)
                };
            gates.push(GateDiagnostic {
                gate_id,
                kind,
                required,
                state,
                receipt_id,
                reason,
            });
        }
        let missing = gates
            .iter()
            .filter(|gate| gate.required && gate.state != GateState::Satisfied)
            .map(|gate| gate.gate_id.clone())
            .collect();
        Ok(GateDiagnostics {
            project_id: project_id.to_owned(),
            work_id: work_id.to_owned(),
            attempt_id: attempt_id.map(str::to_owned),
            fence,
            revision,
            gates,
            missing,
        })
    }

    fn current_review_is_accepted(
        &self,
        work_id: &str,
        attempt_id: &str,
        fence: u64,
        gate_id: &str,
    ) -> Result<bool, StoreError> {
        let mut statement = self.prepare(
            "SELECT decision FROM review
             WHERE work_id = ?1 AND attempt_id = ?2 AND fence = ?3 AND gate_id = ?4
             ORDER BY created_at DESC, review_id DESC LIMIT 1",
        )?;
        statement.bind_text(1, work_id)?;
        statement.bind_text(2, attempt_id)?;
        statement.bind_i64(3, fence)?;
        statement.bind_text(4, gate_id)?;
        if statement.step()? != SQLITE_ROW {
            return Ok(false);
        }
        Ok(parse_review_decision(&statement.column_text(0)?)? == ReviewDecision::Accepted)
    }

    fn current_summary_satisfies_gate(
        &self,
        project_id: &str,
        work_id: &str,
        attempt_id: &str,
        fence: u64,
        gate_id: &str,
    ) -> Result<bool, StoreError> {
        let Some(summary) = self.current_summary(project_id, work_id)? else {
            return Ok(false);
        };
        let Some(attempt) = self.attempt_record(attempt_id, false)? else {
            return Ok(false);
        };
        let Some(gate) = self.gate(project_id, work_id, gate_id)? else {
            return Ok(false);
        };
        Ok(summary.attempt_id == attempt_id
            && summary.fence == fence
            && summary.source_version_id == attempt.source_version_id.clone().unwrap_or_default()
            && summary.config_identity == attempt.config_identity
            && summary.profile_id == gate.profile_id
            && summary.profile_version == gate.profile_version
            && summary.body_size > 0
            && summary.body_size <= MAX_SUMMARY_BODY_BYTES
            && valid_sha256_digest(&summary.body_digest))
    }

    fn latest_receipt_for_gate(
        &self,
        gate_id: &str,
        work_id: &str,
        attempt_id: &str,
        fence: u64,
    ) -> Result<Option<String>, StoreError> {
        let mut statement = self.prepare(
            "SELECT receipt_id FROM receipt
             WHERE gate_id = ?1 AND work_id = ?2 AND attempt_id = ?3 AND fence = ?4
             ORDER BY ended_at DESC, receipt_id DESC LIMIT 1",
        )?;
        statement.bind_text(1, gate_id)?;
        statement.bind_text(2, work_id)?;
        statement.bind_text(3, attempt_id)?;
        statement.bind_i64(4, fence)?;
        if statement.step()? == SQLITE_ROW {
            Ok(Some(statement.column_text(0)?))
        } else {
            Ok(None)
        }
    }

    fn validate_close_subject(&self, request: &CloseIntentRequest) -> Result<(), StoreError> {
        let attempt = self
            .attempt_record(&request.attempt_id, false)?
            .ok_or_else(|| StoreError::NotFound {
                entity: "attempt",
                id: request.attempt_id.clone(),
            })?;
        if attempt.project_id != request.project_id || attempt.work_id != request.work_id {
            return Err(StoreError::WrongSubject {
                expected: format!("{}/{}", request.project_id, request.work_id),
                actual: format!("{}/{}", attempt.project_id, attempt.work_id),
            });
        }
        if attempt.fence != request.fence {
            return Err(StoreError::StaleFence {
                expected: request.fence,
                actual: attempt.fence,
            });
        }
        Ok(())
    }

    fn finalize_close_rows(&self, request: &CloseIntentRequest) -> Result<(), StoreError> {
        let mut intent = self.prepare(
            "UPDATE close_intent SET state = 'finalized', finalized_at = ?1
             WHERE close_intent_id = ?2 AND state = 'open'",
        )?;
        intent.bind_text(1, &request.at)?;
        intent.bind_text(2, &request.close_intent_id)?;
        intent.run()?;
        let mut work = self.prepare(
            "UPDATE work_item SET lifecycle = 'closed', updated_at = ?1
             WHERE work_id = ?2 AND lifecycle = 'open'",
        )?;
        work.bind_text(1, &request.at)?;
        work.bind_text(2, &request.work_id)?;
        work.run()?;
        if work.changes()? != 1 {
            return Err(StoreError::Conflict(
                "work is not open for close finalization".to_owned(),
            ));
        }
        let mut attempt = self.prepare(
            "UPDATE attempt SET current = 0, state = 'completed', terminal_at = ?1,
                    terminal_reason = 'close.finalize'
             WHERE attempt_id = ?2 AND current = 1",
        )?;
        attempt.bind_text(1, &request.at)?;
        attempt.bind_text(2, &request.attempt_id)?;
        attempt.run()?;
        if attempt.changes()? != 1 {
            return Err(StoreError::Conflict(
                "attempt is no longer current for close finalization".to_owned(),
            ));
        }
        let mut reservation = self.prepare(
            "UPDATE reservation SET state = 'released', released_at = ?1
             WHERE attempt_id = ?2 AND state = 'active'",
        )?;
        reservation.bind_text(1, &request.at)?;
        reservation.bind_text(2, &request.attempt_id)?;
        reservation.run()?;

        // Closing ends execution ownership, but it does not prove that the
        // physical worktree/resource has been released. Preserve that fact in
        // the canonical release protocol and retain a recovery obligation
        // until the release is acknowledged.
        if self.table_exists("boreal_resource_reservation")? {
            self.request_canonical_resource_release_in_transaction(
                &request.project_id,
                &request.attempt_id,
                request.fence,
                &request.operation_id,
                &request.actor_id,
                &request.at,
            )?;
            self.create_recovery_obligation_in_transaction(&recovery::RecoveryObligationInput {
                obligation_id: format!("{}:recovery:close-finalize", request.operation_id),
                project_id: request.project_id.clone(),
                work_id: request.work_id.clone(),
                attempt_id: Some(request.attempt_id.clone()),
                fence: Some(request.fence),
                reason: "resource_unknown".to_owned(),
                resource_state: "release_pending".to_owned(),
                owner_actor_id: Some(request.actor_id.clone()),
                next_action: "acknowledge resource release before reusing the execution resource"
                    .to_owned(),
                created_at: request.at.clone(),
            })?;
        }
        Ok(())
    }

    fn replay_receipt_operation(
        &self,
        request: &ReceiptInsertRequest,
        replay_digest: &str,
        operation: &OperationRecord,
    ) -> Result<ReceiptInsertResult, StoreError> {
        if operation.project_id != request.project_id
            || operation.command != "receipt.insert"
            || operation.request_digest != replay_digest
        {
            return Err(StoreError::Conflict(format!(
                "operation {} was already used with another request",
                request.operation_id
            )));
        }
        let receipt_id = json_string_field(&operation.result_json, "receipt_id")?;
        let receipt = self.receipt(&receipt_id)?.ok_or_else(|| {
            StoreError::Corrupt("receipt operation refers to missing receipt".to_owned())
        })?;
        if receipt.result == ReceiptOutcome::Rejected {
            return Err(receipt_error_from_code(
                receipt
                    .rejection_code
                    .as_deref()
                    .unwrap_or("receipt_rejected"),
                &receipt,
            ));
        }
        if receipt.result == ReceiptOutcome::Stale {
            return Err(StoreError::StaleFence {
                expected: receipt.fence,
                actual: receipt.fence,
            });
        }
        Ok(ReceiptInsertResult {
            receipt,
            revision: operation.revision,
            replayed: true,
        })
    }

    fn replay_close_operation(
        &self,
        request: &CloseIntentRequest,
        operation: &OperationRecord,
    ) -> Result<CloseIntentResult, StoreError> {
        if operation.project_id != request.project_id
            || operation.request_digest != request.request_digest
        {
            return Err(StoreError::Conflict(format!(
                "operation {} was already used with another request",
                request.operation_id
            )));
        }
        let close_intent_id = json_string_field(&operation.result_json, "close_intent_id")?;
        Ok(CloseIntentResult {
            close_intent: self
                .close_intent(&request.project_id, &close_intent_id)?
                .ok_or_else(|| {
                    StoreError::Corrupt("close operation refers to missing close intent".to_owned())
                })?,
            revision: operation.revision,
            replayed: true,
            diagnostics: None,
        })
    }

    fn verify_schema_contract(&self) -> Result<(), StoreError> {
        for table in [
            "project",
            "actor",
            "session",
            "source_version",
            "acceptance_profile",
            "work_item",
            "dependency",
            "attempt",
            "reservation",
            "work_hold",
            "gate",
            "checkpoint",
            "receipt",
            "evidence_execution",
            "review",
            "summary",
            "close_intent",
            "operation",
            "audit_event",
            "memory_publication",
            "blob",
        ] {
            if !self.table_exists(table)? {
                return Err(StoreError::Corrupt(format!(
                    "schema version 2 is missing required table {table}"
                )));
            }
        }
        for (table, column) in [
            ("work_item", "priority"),
            ("work_item", "parent_id"),
            ("work_item", "acceptance_profile_id"),
            ("attempt", "session_id"),
            ("attempt", "fence"),
            ("operation", "request_digest"),
            ("audit_event", "payload_json"),
            ("work_hold", "reason_code"),
            ("work_hold", "resolved_at"),
            ("evidence_execution", "request_digest"),
            ("evidence_execution", "artifact_ref"),
            ("evidence_execution", "state"),
            ("evidence_execution", "receipt_id"),
        ] {
            if !self.table_has_column(table, column)? {
                return Err(StoreError::Corrupt(format!(
                    "schema version 2 table {table} is missing required column {column}"
                )));
            }
        }
        for index in [
            "work_item_project",
            "work_item_project_id",
            "work_item_parent",
            "dependency_dependent",
            "attempt_current_work",
            "attempt_current_session",
            "attempt_fence",
            "attempt_expiry",
            "work_hold_active",
            "receipt_subject",
            "evidence_execution_subject",
            "audit_revision",
        ] {
            if !self.schema_object_exists("index", index)? {
                return Err(StoreError::Corrupt(format!(
                    "schema version 2 is missing required index {index}"
                )));
            }
        }
        for trigger in [
            "work_parent_kind_guard",
            "work_parent_kind_guard_update",
            "work_parent_retype_guard",
            "dependency_no_cycle",
            "receipt_append_only_update",
            "receipt_append_only_delete",
            "audit_append_only_update",
            "audit_append_only_delete",
            "review_no_self_review",
        ] {
            if !self.schema_object_exists("trigger", trigger)? {
                return Err(StoreError::Corrupt(format!(
                    "schema version 2 is missing required trigger {trigger}"
                )));
            }
        }
        if !self.audit_event_accepts("evidence.verifier.admitted")? {
            return Err(StoreError::Corrupt(MISSING_VERIFIER_AUDIT_EVENT.to_owned()));
        }
        if !self.audit_event_accepts("close.completed")? {
            return Err(StoreError::Corrupt(
                MISSING_CLOSE_COMPLETED_AUDIT_EVENT.to_owned(),
            ));
        }
        Ok(())
    }

    fn audit_event_accepts(&self, event_type: &str) -> Result<bool, StoreError> {
        let mut statement = self.prepare(
            "SELECT sql FROM sqlite_master
             WHERE type = 'table' AND name = 'audit_event'",
        )?;
        if statement.step()? != SQLITE_ROW {
            return Ok(false);
        }
        let definition = statement.column_text(0)?.to_ascii_lowercase();
        Ok(definition.contains(&format!("'{event_type}'").to_ascii_lowercase()))
    }

    fn verify_v2_identity_for_migration(&self) -> Result<(), StoreError> {
        match self.verify_schema_contract() {
            Err(StoreError::Corrupt(message)) if is_repairable_v2_contract_gap(&message) => Ok(()),
            result => result,
        }
    }

    fn schema_object_exists(&self, object_type: &str, name: &str) -> Result<bool, StoreError> {
        let mut statement =
            self.prepare("SELECT 1 FROM sqlite_master WHERE type = ?1 AND name = ?2 LIMIT 1")?;
        statement.bind_text(1, object_type)?;
        statement.bind_text(2, name)?;
        Ok(statement.step()? == SQLITE_ROW)
    }

    fn table_exists(&self, table: &str) -> Result<bool, StoreError> {
        self.schema_object_exists("table", table)
    }

    fn table_has_column(&self, table: &str, column: &str) -> Result<bool, StoreError> {
        let mut statement =
            self.prepare(&format!("PRAGMA table_info({})", quote_identifier(table)))?;
        while statement.step()? == SQLITE_ROW {
            if statement.column_text(1)? == column {
                return Ok(true);
            }
        }
        Ok(false)
    }

    fn prepare(&self, sql: &str) -> Result<Statement<'_>, StoreError> {
        self.query_metrics
            .statements_prepared
            .fetch_add(1, Ordering::Relaxed);
        Statement::new(self, sql)
    }

    fn scalar_i64(&self, sql: &str) -> Result<i64, StoreError> {
        let mut statement = self.prepare(sql)?;
        match statement.step()? {
            SQLITE_ROW => statement.column_i64(0),
            SQLITE_DONE => Err(StoreError::Corrupt(format!(
                "SQLite query returned no value: {sql}"
            ))),
            _ => unreachable!(),
        }
    }

    fn scalar_text(&self, sql: &str) -> Result<String, StoreError> {
        let mut statement = self.prepare(sql)?;
        match statement.step()? {
            SQLITE_ROW => statement.column_text(0),
            SQLITE_DONE => Err(StoreError::Corrupt(format!(
                "SQLite query returned no value: {sql}"
            ))),
            _ => unreachable!(),
        }
    }
}

impl Drop for SqliteStore {
    fn drop(&mut self) {
        if !self.database.is_null() {
            unsafe { sqlite3_close(self.database) };
        }
    }
}

impl MigrationBackend for SqliteStore {
    type Error = StoreError;

    fn schema_identity(&mut self) -> Result<SchemaIdentity, Self::Error> {
        let version = self.schema_version()?;
        if version == 0 {
            return Ok(SchemaIdentity::uninitialized());
        }
        if self.table_exists(SCHEMA_IDENTITY_TABLE)? {
            let mut statement = self.prepare(&format!(
                "SELECT schema_id, schema_version, contract_version, schema_checksum
                 FROM {SCHEMA_IDENTITY_TABLE} WHERE identity_id = 1"
            ))?;
            if statement.step()? != SQLITE_ROW {
                return Err(StoreError::Corrupt(
                    "production schema identity row is missing".to_owned(),
                ));
            }
            return Ok(SchemaIdentity {
                schema_id: statement.column_text(0)?,
                schema_version: statement.column_i64(1)?,
                contract_version: statement.column_text(2)?,
                schema_checksum: Some(statement.column_text(3)?),
            });
        }

        match version {
            SCHEMA_VERSION => {
                self.verify_v2_identity_for_migration()?;
                Ok(SchemaIdentity {
                    schema_id: PRODUCTION_SCHEMA_ID.to_owned(),
                    schema_version: SCHEMA_VERSION,
                    contract_version: "boreal.sqlite/2".to_owned(),
                    schema_checksum: Some(checksum(LEGACY_SCHEMA_V2_SQL.as_bytes())),
                })
            }
            WORK_MODEL_SCHEMA_VERSION => {
                self.verify_work_model_v3_contract()?;
                Ok(SchemaIdentity {
                    schema_id: PRODUCTION_SCHEMA_ID.to_owned(),
                    schema_version: WORK_MODEL_SCHEMA_VERSION,
                    contract_version: PRODUCTION_SCHEMA_CONTRACT_VERSION.to_owned(),
                    schema_checksum: Some(checksum(PRODUCTION_SCHEMA_SQL.as_bytes())),
                })
            }
            found => Ok(SchemaIdentity {
                schema_id: PRODUCTION_SCHEMA_ID.to_owned(),
                schema_version: found,
                contract_version: String::new(),
                schema_checksum: None,
            }),
        }
    }

    fn live_attempt_diagnostics(&mut self) -> Result<Vec<MigrationDiagnostic>, Self::Error> {
        if !self.table_exists("attempt")? {
            return Ok(Vec::new());
        }
        let mut statement = self.prepare(
            "SELECT attempt_id, work_id, state
             FROM attempt
             WHERE state IN ('claimed','accepted','running','verifying','expiry_pending')
             ORDER BY attempt_id",
        )?;
        let mut diagnostics = Vec::new();
        while statement.step()? == SQLITE_ROW {
            let attempt_id = statement.column_text(0)?;
            let work_id = statement.column_text(1)?;
            let state = statement.column_text(2)?;
            diagnostics.push(MigrationDiagnostic {
                code: "live_attempt_blocks_migration".to_owned(),
                entity_type: "attempt".to_owned(),
                entity_id: attempt_id.clone(),
                message: format!(
                    "live attempt {attempt_id} for work {work_id} remains in state {state}"
                ),
                blocking: true,
                raw_payload: Some(format!(
                    "{{\"attempt_id\":{},\"work_id\":{},\"state\":{}}}",
                    json_text(&attempt_id),
                    json_text(&work_id),
                    json_text(&state),
                )),
            });
        }
        Ok(diagnostics)
    }

    fn legacy_diagnostics(&mut self) -> Result<Vec<MigrationDiagnostic>, Self::Error> {
        if self.schema_version()? != SCHEMA_VERSION || !self.table_exists("work_item")? {
            return Ok(Vec::new());
        }
        let mut diagnostics = vec![MigrationDiagnostic::retained(
            "schema_v2_compatibility_source",
            "database",
            "",
            "schema-v2 rows remain the compatibility source for the additive v3 migration",
            format!(
                "{{\"schema_id\":{},\"schema_version\":{}}}",
                json_text(PRODUCTION_SCHEMA_ID),
                SCHEMA_VERSION
            ),
        )];

        let mut sprint_rows = self.prepare(
            "SELECT work_id FROM work_item WHERE kind = 'sprint' ORDER BY work_id LIMIT 10000",
        )?;
        while sprint_rows.step()? == SQLITE_ROW {
            let work_id = sprint_rows.column_text(0)?;
            diagnostics.push(MigrationDiagnostic::retained(
                "legacy_sprint_preserved",
                "work_item",
                work_id.clone(),
                "legacy sprint remains readable as a compatibility subject",
                format!("{{\"work_id\":{}}}", json_text(&work_id)),
            ));
        }

        let mut malformed = self.prepare(
            "SELECT work_id FROM work_item
             WHERE trim(work_id) = '' OR trim(project_id) = ''
             ORDER BY work_id LIMIT 10000",
        )?;
        while malformed.step()? == SQLITE_ROW {
            let work_id = malformed.column_text(0)?;
            diagnostics.push(MigrationDiagnostic::blocking(
                "malformed_legacy_work_item",
                "work_item",
                work_id,
                "legacy work row has an empty identity and cannot be mapped safely",
            ));
        }

        let mut ambiguous = self.prepare(
            "SELECT d.prerequisite_id, d.dependent_id
             FROM dependency d
             JOIN work_item prerequisite
               ON prerequisite.project_id = d.project_id
              AND prerequisite.work_id = d.prerequisite_id
             JOIN work_item dependent
               ON dependent.project_id = d.project_id
              AND dependent.work_id = d.dependent_id
             WHERE prerequisite.kind <> 'task' OR dependent.kind <> 'task'
             ORDER BY d.prerequisite_id, d.dependent_id LIMIT 10000",
        )?;
        while ambiguous.step()? == SQLITE_ROW {
            let prerequisite_id = ambiguous.column_text(0)?;
            let dependent_id = ambiguous.column_text(1)?;
            diagnostics.push(MigrationDiagnostic::blocking(
                "ambiguous_legacy_dependency",
                "dependency",
                format!("{prerequisite_id}->{dependent_id}"),
                "dependency endpoint is not a direct task and requires an explicit disposition",
            ));
        }
        Ok(diagnostics)
    }

    fn try_acquire_migration_lock(&mut self) -> Result<(), Self::Error> {
        store_try_acquire_migration_lock(self)
    }

    fn release_migration_lock(&mut self) {
        if self.migration_transaction.swap(false, Ordering::AcqRel) {
            let _ = self.execute_batch("ROLLBACK");
        }
    }

    fn begin_immediate(&mut self) -> Result<(), Self::Error> {
        if self.migration_transaction.load(Ordering::Acquire) {
            Ok(())
        } else {
            self.execute_batch("BEGIN IMMEDIATE")
        }
    }

    fn execute(&mut self, sql: &str) -> Result<(), Self::Error> {
        self.execute_migration_sql(sql)
    }

    fn read_ledger(&mut self) -> Result<Vec<MigrationLedgerEntry>, Self::Error> {
        if !self.table_exists(MIGRATION_LEDGER_TABLE)? {
            return Ok(Vec::new());
        }
        let mut statement = self.prepare(&format!(
            "SELECT migration_id, attempt, from_version, to_version, checksum, state,
                    diagnostics_json, failure_message, started_at, completed_at
             FROM {MIGRATION_LEDGER_TABLE} ORDER BY migration_id, attempt"
        ))?;
        let mut entries = Vec::new();
        while statement.step()? == SQLITE_ROW {
            let state = match statement.column_text(5)?.as_str() {
                "running" => MigrationState::Running,
                "applied" => MigrationState::Applied,
                "failed" => MigrationState::Failed,
                value => {
                    return Err(StoreError::Corrupt(format!(
                        "unknown migration ledger state {value:?}"
                    )))
                }
            };
            entries.push(MigrationLedgerEntry {
                migration_id: statement.column_text(0)?,
                attempt: statement.column_u64(1)?,
                from_version: statement.column_i64(2)?,
                to_version: statement.column_i64(3)?,
                checksum: statement.column_text(4)?,
                state,
                diagnostics_json: statement.column_text(6)?,
                failure_message: statement.column_optional_text(7)?,
                started_at: statement.column_text(8)?,
                completed_at: statement.column_optional_text(9)?,
            });
        }
        Ok(entries)
    }

    fn commit(&mut self) -> Result<(), Self::Error> {
        let result = self.execute_batch("COMMIT");
        if result.is_ok() {
            self.migration_transaction.store(false, Ordering::Release);
        }
        result
    }

    fn rollback(&mut self) -> Result<(), Self::Error> {
        let result = self.execute_batch("ROLLBACK");
        self.migration_transaction.store(false, Ordering::Release);
        result
    }

    fn now(&self) -> String {
        production_now()
    }

    fn is_busy(&self, error: &Self::Error) -> bool {
        matches!(error, StoreError::Busy(_))
    }
}

impl MigrationBackend for &SqliteStore {
    type Error = StoreError;

    fn schema_identity(&mut self) -> Result<SchemaIdentity, Self::Error> {
        store_schema_identity(self)
    }

    fn live_attempt_diagnostics(&mut self) -> Result<Vec<MigrationDiagnostic>, Self::Error> {
        store_live_attempt_diagnostics(self)
    }

    fn legacy_diagnostics(&mut self) -> Result<Vec<MigrationDiagnostic>, Self::Error> {
        store_legacy_diagnostics(self)
    }

    fn try_acquire_migration_lock(&mut self) -> Result<(), Self::Error> {
        store_try_acquire_migration_lock(self)
    }

    fn release_migration_lock(&mut self) {
        store_release_migration_lock(self)
    }

    fn begin_immediate(&mut self) -> Result<(), Self::Error> {
        store_begin_immediate(self)
    }

    fn execute(&mut self, sql: &str) -> Result<(), Self::Error> {
        (*self).execute_migration_sql(sql)
    }

    fn read_ledger(&mut self) -> Result<Vec<MigrationLedgerEntry>, Self::Error> {
        store_read_ledger(self)
    }

    fn commit(&mut self) -> Result<(), Self::Error> {
        store_commit(self)
    }

    fn rollback(&mut self) -> Result<(), Self::Error> {
        store_rollback(self)
    }

    fn now(&self) -> String {
        production_now()
    }

    fn is_busy(&self, error: &Self::Error) -> bool {
        matches!(error, StoreError::Busy(_))
    }
}

fn store_schema_identity(store: &SqliteStore) -> Result<SchemaIdentity, StoreError> {
    let version = store.schema_version()?;
    if version == 0 {
        return Ok(SchemaIdentity::uninitialized());
    }
    if store.table_exists(SCHEMA_IDENTITY_TABLE)? {
        let mut statement = store.prepare(&format!(
            "SELECT schema_id, schema_version, contract_version, schema_checksum
             FROM {SCHEMA_IDENTITY_TABLE} WHERE identity_id = 1"
        ))?;
        if statement.step()? != SQLITE_ROW {
            return Err(StoreError::Corrupt(
                "production schema identity row is missing".to_owned(),
            ));
        }
        return Ok(SchemaIdentity {
            schema_id: statement.column_text(0)?,
            schema_version: statement.column_i64(1)?,
            contract_version: statement.column_text(2)?,
            schema_checksum: Some(statement.column_text(3)?),
        });
    }

    match version {
        SCHEMA_VERSION => {
            store.verify_v2_identity_for_migration()?;
            Ok(SchemaIdentity {
                schema_id: PRODUCTION_SCHEMA_ID.to_owned(),
                schema_version: SCHEMA_VERSION,
                contract_version: "boreal.sqlite/2".to_owned(),
                schema_checksum: Some(checksum(LEGACY_SCHEMA_V2_SQL.as_bytes())),
            })
        }
        WORK_MODEL_SCHEMA_VERSION => {
            store.verify_work_model_v3_contract()?;
            Ok(SchemaIdentity {
                schema_id: PRODUCTION_SCHEMA_ID.to_owned(),
                schema_version: WORK_MODEL_SCHEMA_VERSION,
                contract_version: PRODUCTION_SCHEMA_CONTRACT_VERSION.to_owned(),
                schema_checksum: Some(checksum(PRODUCTION_SCHEMA_SQL.as_bytes())),
            })
        }
        found => Ok(SchemaIdentity {
            schema_id: PRODUCTION_SCHEMA_ID.to_owned(),
            schema_version: found,
            contract_version: String::new(),
            schema_checksum: None,
        }),
    }
}

fn store_live_attempt_diagnostics(
    store: &SqliteStore,
) -> Result<Vec<MigrationDiagnostic>, StoreError> {
    if !store.table_exists("attempt")? {
        return Ok(Vec::new());
    }
    let mut statement = store.prepare(
        "SELECT attempt_id, work_id, state
         FROM attempt
         WHERE state IN ('claimed','accepted','running','verifying','expiry_pending')
         ORDER BY attempt_id",
    )?;
    let mut diagnostics = Vec::new();
    while statement.step()? == SQLITE_ROW {
        let attempt_id = statement.column_text(0)?;
        let work_id = statement.column_text(1)?;
        let state = statement.column_text(2)?;
        diagnostics.push(MigrationDiagnostic {
            code: "live_attempt_blocks_migration".to_owned(),
            entity_type: "attempt".to_owned(),
            entity_id: attempt_id.clone(),
            message: format!(
                "live attempt {attempt_id} for work {work_id} remains in state {state}"
            ),
            blocking: true,
            raw_payload: Some(format!(
                "{{\"attempt_id\":{},\"work_id\":{},\"state\":{}}}",
                json_text(&attempt_id),
                json_text(&work_id),
                json_text(&state),
            )),
        });
    }
    Ok(diagnostics)
}

fn store_legacy_diagnostics(store: &SqliteStore) -> Result<Vec<MigrationDiagnostic>, StoreError> {
    if store.schema_version()? != SCHEMA_VERSION || !store.table_exists("work_item")? {
        return Ok(Vec::new());
    }
    let mut diagnostics = vec![MigrationDiagnostic::retained(
        "schema_v2_compatibility_source",
        "database",
        "",
        "schema-v2 rows remain the compatibility source for the additive v3 migration",
        format!(
            "{{\"schema_id\":{},\"schema_version\":{}}}",
            json_text(PRODUCTION_SCHEMA_ID),
            SCHEMA_VERSION
        ),
    )];

    let mut sprint_rows = store.prepare(
        "SELECT work_id FROM work_item WHERE kind = 'sprint' ORDER BY work_id LIMIT 10000",
    )?;
    while sprint_rows.step()? == SQLITE_ROW {
        let work_id = sprint_rows.column_text(0)?;
        diagnostics.push(MigrationDiagnostic::retained(
            "legacy_sprint_preserved",
            "work_item",
            work_id.clone(),
            "legacy sprint remains readable as a compatibility subject",
            format!("{{\"work_id\":{}}}", json_text(&work_id)),
        ));
    }

    let mut malformed = store.prepare(
        "SELECT work_id FROM work_item
         WHERE trim(work_id) = '' OR trim(project_id) = ''
         ORDER BY work_id LIMIT 10000",
    )?;
    while malformed.step()? == SQLITE_ROW {
        let work_id = malformed.column_text(0)?;
        diagnostics.push(MigrationDiagnostic::blocking(
            "malformed_legacy_work_item",
            "work_item",
            work_id,
            "legacy work row has an empty identity and cannot be mapped safely",
        ));
    }

    let mut ambiguous = store.prepare(
        "SELECT d.prerequisite_id, d.dependent_id
         FROM dependency d
         JOIN work_item prerequisite
           ON prerequisite.project_id = d.project_id
          AND prerequisite.work_id = d.prerequisite_id
         JOIN work_item dependent
           ON dependent.project_id = d.project_id
          AND dependent.work_id = d.dependent_id
         WHERE prerequisite.kind <> 'task' OR dependent.kind <> 'task'
         ORDER BY d.prerequisite_id, d.dependent_id LIMIT 10000",
    )?;
    while ambiguous.step()? == SQLITE_ROW {
        let prerequisite_id = ambiguous.column_text(0)?;
        let dependent_id = ambiguous.column_text(1)?;
        diagnostics.push(MigrationDiagnostic::blocking(
            "ambiguous_legacy_dependency",
            "dependency",
            format!("{prerequisite_id}->{dependent_id}"),
            "dependency endpoint is not a direct task and requires an explicit disposition",
        ));
    }
    Ok(diagnostics)
}

fn production_preflight(store: &SqliteStore) -> Result<(), StoreError> {
    let mut diagnostics = store_live_attempt_diagnostics(store)?;
    diagnostics.extend(store_legacy_diagnostics(store)?);
    if diagnostics.iter().any(|diagnostic| diagnostic.blocking) {
        return Err(map_migration_error(MigrationError::PreflightBlocked {
            diagnostics,
        }));
    }
    Ok(())
}

fn store_try_acquire_migration_lock(store: &SqliteStore) -> Result<(), StoreError> {
    // A production v2 upgrade acquires this boundary before repairing the
    // legacy schema. The ordered runner then reuses the same connection and
    // transaction rather than opening a window between repair and migration.
    if store.migration_transaction.load(Ordering::Acquire) {
        return Ok(());
    }
    if store
        .migration_transaction
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err(StoreError::Busy(
            "this store connection already owns the migration transaction".to_owned(),
        ));
    }
    if let Err(error) = store.execute_batch("BEGIN IMMEDIATE") {
        store.migration_transaction.store(false, Ordering::Release);
        return Err(error);
    }
    Ok(())
}

fn store_release_migration_lock(store: &SqliteStore) {
    if store.migration_transaction.swap(false, Ordering::AcqRel) {
        let _ = store.execute_batch("ROLLBACK");
    }
}

fn store_begin_immediate(store: &SqliteStore) -> Result<(), StoreError> {
    if store.migration_transaction.load(Ordering::Acquire) {
        Ok(())
    } else {
        store.execute_batch("BEGIN IMMEDIATE")
    }
}

fn store_read_ledger(store: &SqliteStore) -> Result<Vec<MigrationLedgerEntry>, StoreError> {
    if !store.table_exists(MIGRATION_LEDGER_TABLE)? {
        return Ok(Vec::new());
    }
    let mut statement = store.prepare(&format!(
        "SELECT migration_id, attempt, from_version, to_version, checksum, state,
                diagnostics_json, failure_message, started_at, completed_at
         FROM {MIGRATION_LEDGER_TABLE} ORDER BY migration_id, attempt"
    ))?;
    let mut entries = Vec::new();
    while statement.step()? == SQLITE_ROW {
        let state = match statement.column_text(5)?.as_str() {
            "running" => MigrationState::Running,
            "applied" => MigrationState::Applied,
            "failed" => MigrationState::Failed,
            value => {
                return Err(StoreError::Corrupt(format!(
                    "unknown migration ledger state {value:?}"
                )))
            }
        };
        entries.push(MigrationLedgerEntry {
            migration_id: statement.column_text(0)?,
            attempt: statement.column_u64(1)?,
            from_version: statement.column_i64(2)?,
            to_version: statement.column_i64(3)?,
            checksum: statement.column_text(4)?,
            state,
            diagnostics_json: statement.column_text(6)?,
            failure_message: statement.column_optional_text(7)?,
            started_at: statement.column_text(8)?,
            completed_at: statement.column_optional_text(9)?,
        });
    }
    Ok(entries)
}

fn store_commit(store: &SqliteStore) -> Result<(), StoreError> {
    let result = store.execute_batch("COMMIT");
    if result.is_ok() {
        store.migration_transaction.store(false, Ordering::Release);
    }
    result
}

fn store_rollback(store: &SqliteStore) -> Result<(), StoreError> {
    let result = store.execute_batch("ROLLBACK");
    store.migration_transaction.store(false, Ordering::Release);
    result
}

fn production_migration_plan() -> Result<MigrationPlan, MigrationError> {
    let target_checksum = checksum(PRODUCTION_SCHEMA_SQL.as_bytes());
    let step = MigrationStep::new(
        "work-model-2-to-3",
        SCHEMA_VERSION,
        WORK_MODEL_SCHEMA_VERSION,
        format!(
            "{}\n{}",
            runner_schema_sql(WORK_MODEL_SCHEMA_V3_SQL),
            PRODUCTION_EXTERNAL_JOB_IDENTITY_TRIGGER_SQL
        ),
        r#"
CREATE TEMP TABLE boreal_production_precondition (sentinel INTEGER NOT NULL CHECK (sentinel = 1));
INSERT INTO boreal_production_precondition
  SELECT CASE WHEN
    (SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'project') = 1
    AND (SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'work_item') = 1
    AND (SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'attempt') = 1
    THEN 1 ELSE 0 END;
DROP TABLE boreal_production_precondition;
"#,
        PRODUCTION_VERIFY_SQL,
        target_checksum.clone(),
    )?;
    Ok(MigrationPlan::new(
        PRODUCTION_SCHEMA_ID,
        PRODUCTION_SCHEMA_CONTRACT_VERSION,
        WORK_MODEL_SCHEMA_VERSION,
        target_checksum,
        runner_schema_sql(PRODUCTION_SCHEMA_SQL),
        PRODUCTION_VERIFY_SQL,
        vec![step],
    )
    .with_supported_source_checksum(SCHEMA_VERSION, checksum(LEGACY_SCHEMA_V2_SQL.as_bytes())))
}

fn production_bootstrap_step(plan: &MigrationPlan) -> Result<MigrationStep, MigrationError> {
    MigrationStep::new(
        format!("bootstrap-v{}", plan.target_version),
        0,
        plan.target_version,
        plan.fresh_schema_sql.clone(),
        String::new(),
        plan.verify_sql.clone(),
        plan.target_schema_checksum.clone(),
    )
}

fn map_migration_error(error: MigrationError) -> StoreError {
    match error {
        MigrationError::Busy(message) => StoreError::Busy(message),
        MigrationError::UnsupportedNewer { found, .. } => StoreError::UnsupportedSchema { found },
        MigrationError::UnsupportedOlder { found } => StoreError::Invalid(format!(
            "unsupported older production schema version: {found}"
        )),
        MigrationError::PreflightBlocked { diagnostics } => StoreError::Conflict(format!(
            "production migration preflight blocked: {}",
            diagnostics
                .iter()
                .map(|diagnostic| diagnostic.code.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        )),
        MigrationError::Backend(message) => {
            let lower = message.to_ascii_lowercase();
            if lower.contains("busy") || lower.contains("locked") {
                StoreError::Busy(message)
            } else {
                StoreError::Invalid(message)
            }
        }
        other @ (MigrationError::SchemaIdentityMismatch(_)
        | MigrationError::ChecksumMismatch { .. }
        | MigrationError::LedgerMismatch(_)
        | MigrationError::InvariantViolation(_)
        | MigrationError::RecoveryRequired { .. }) => StoreError::Corrupt(other.to_string()),
        MigrationError::InvalidPlan(message) => StoreError::Invalid(message),
    }
}

fn is_production_schema_request(schema_sql: &str) -> bool {
    let requested = schema_sql.trim();
    requested == LEGACY_SCHEMA_V2_SQL.trim() || requested == PRODUCTION_SCHEMA_SQL.trim()
}

fn is_repairable_v2_contract_gap(message: &str) -> bool {
    matches!(
        message,
        "schema version 2 is missing required table work_hold"
            | "schema version 2 is missing required table evidence_execution"
            | "schema version 2 table work_item is missing required column priority"
            | "schema version 2 is missing required index work_item_project_id"
            | "schema version 2 is missing required index attempt_work_current"
            | "schema version 2 is missing required index attempt_session_current"
            | "schema version 2 is missing required index work_hold_active"
            | "schema version 2 is missing required index evidence_execution_subject"
            | "schema version 2 is missing required trigger work_parent_retype_guard"
            | "schema version 2 is missing required trigger dependency_no_cycle"
            | MISSING_VERIFIER_AUDIT_EVENT
            | MISSING_CLOSE_COMPLETED_AUDIT_EVENT
    )
}

fn is_canonical_production_schema_request(schema_sql: &str) -> bool {
    schema_sql.trim() == PRODUCTION_SCHEMA_SQL.trim()
}

fn runner_schema_sql(sql: &str) -> String {
    let mut lines = sql.lines();
    let mut protected = Vec::new();
    while let Some(line) = lines.next() {
        if line.trim() == "BEGIN" {
            if let Some(body) = lines.next() {
                protected.push(format!("{line} {body}"));
                continue;
            }
        }
        protected.push(line.to_owned());
    }
    protected.join("\n")
}

fn sql_text(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn json_text(value: &str) -> String {
    format!(
        "\"{}\"",
        value
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('\n', "\\n")
            .replace('\r', "\\r")
    )
}

fn production_now() -> String {
    let milliseconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    format!("unix-ms:{milliseconds}")
}

#[derive(Clone, Copy, Debug, Default, Eq, Hash, PartialEq)]
pub struct SnapshotRevision(pub u64);

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct Snapshot {
    pub revision: SnapshotRevision,
    pub work_items: Vec<WorkItem>,
    pub dependencies: Vec<BlockingDependency>,
    pub reservations: Vec<Reservation>,
}

pub trait WorkStore {
    fn snapshot(&self) -> Result<Snapshot, StoreError>;
}

impl WorkStore for &SqliteStore {
    fn snapshot(&self) -> Result<Snapshot, StoreError> {
        Err(StoreError::Invalid(
            "snapshot projection is owned by the application layer".to_owned(),
        ))
    }
}

struct Statement<'a> {
    store: &'a SqliteStore,
    statement: *mut sqlite3_stmt,
}

impl<'a> Statement<'a> {
    fn new(store: &'a SqliteStore, sql: &str) -> Result<Self, StoreError> {
        let sql = CString::new(sql)?;
        let mut statement = ptr::null_mut();
        let result = unsafe {
            sqlite3_prepare_v2(
                store.database,
                sql.as_ptr(),
                -1,
                &mut statement,
                ptr::null_mut(),
            )
        };
        if result != SQLITE_OK {
            return Err(database_error(store.database, result));
        }
        Ok(Self { store, statement })
    }

    fn bind_text(&mut self, index: c_int, value: &str) -> Result<(), StoreError> {
        let value = CString::new(value)?;
        let result = unsafe {
            sqlite3_bind_text(
                self.statement,
                index,
                value.as_ptr(),
                -1,
                std::mem::transmute::<isize, Option<SqliteDestructor>>(-1),
            )
        };
        if result == SQLITE_OK {
            Ok(())
        } else {
            Err(database_error(self.store.database, result))
        }
    }

    fn bind_optional_text(&mut self, index: c_int, value: Option<&str>) -> Result<(), StoreError> {
        match value {
            Some(value) => self.bind_text(index, value),
            None => self.bind_null(index),
        }
    }

    fn bind_i64(&mut self, index: c_int, value: u64) -> Result<(), StoreError> {
        if value > i64::MAX as u64 {
            return Err(StoreError::Invalid(format!(
                "integer is too large: {value}"
            )));
        }
        let result = unsafe { sqlite3_bind_int64(self.statement, index, value as i64) };
        if result == SQLITE_OK {
            Ok(())
        } else {
            Err(database_error(self.store.database, result))
        }
    }

    fn bind_signed_i64(&mut self, index: c_int, value: i64) -> Result<(), StoreError> {
        let result = unsafe { sqlite3_bind_int64(self.statement, index, value) };
        if result == SQLITE_OK {
            Ok(())
        } else {
            Err(database_error(self.store.database, result))
        }
    }

    fn bind_optional_i64(&mut self, index: c_int, value: Option<u64>) -> Result<(), StoreError> {
        match value {
            Some(value) => self.bind_i64(index, value),
            None => self.bind_null(index),
        }
    }

    fn bind_null(&mut self, index: c_int) -> Result<(), StoreError> {
        let result = unsafe { sqlite3_bind_null(self.statement, index) };
        if result == SQLITE_OK {
            Ok(())
        } else {
            Err(database_error(self.store.database, result))
        }
    }

    fn step(&mut self) -> Result<c_int, StoreError> {
        let result = unsafe { sqlite3_step(self.statement) };
        match result {
            SQLITE_ROW => {
                self.store
                    .query_metrics
                    .rows_returned
                    .fetch_add(1, Ordering::Relaxed);
                Ok(result)
            }
            SQLITE_DONE => Ok(result),
            _ => Err(database_error(self.store.database, result)),
        }
    }

    fn run(&mut self) -> Result<(), StoreError> {
        if self.step()? == SQLITE_DONE {
            Ok(())
        } else {
            Err(StoreError::Corrupt(
                "write statement returned a row".to_owned(),
            ))
        }
    }

    fn changes(&self) -> Result<c_int, StoreError> {
        Ok(unsafe { sqlite3_changes(self.store.database) })
    }

    fn column_i64(&self, index: c_int) -> Result<i64, StoreError> {
        Ok(unsafe { sqlite3_column_int64(self.statement, index) })
    }

    fn column_u64(&self, index: c_int) -> Result<u64, StoreError> {
        let value = self.column_i64(index)?;
        u64::try_from(value)
            .map_err(|_| StoreError::Corrupt(format!("SQLite returned negative integer: {value}")))
    }

    fn column_optional_i64(&self, index: c_int) -> Result<Option<u64>, StoreError> {
        if unsafe { sqlite3_column_type(self.statement, index) } == SQLITE_NULL {
            Ok(None)
        } else {
            Ok(Some(self.column_u64(index)?))
        }
    }

    fn column_optional_signed_i64(&self, index: c_int) -> Result<Option<i64>, StoreError> {
        if unsafe { sqlite3_column_type(self.statement, index) } == SQLITE_NULL {
            Ok(None)
        } else {
            Ok(Some(self.column_i64(index)?))
        }
    }

    fn column_text(&self, index: c_int) -> Result<String, StoreError> {
        let value = unsafe { sqlite3_column_text(self.statement, index) };
        if value.is_null() {
            return Err(StoreError::Corrupt("SQLite returned NULL text".to_owned()));
        }
        let text = unsafe { CStr::from_ptr(value.cast()) }
            .to_string_lossy()
            .into_owned();
        self.store
            .query_metrics
            .text_bytes_read
            .fetch_add(text.len() as u64, Ordering::Relaxed);
        Ok(text)
    }

    fn column_optional_text(&self, index: c_int) -> Result<Option<String>, StoreError> {
        let value = unsafe { sqlite3_column_text(self.statement, index) };
        if value.is_null() {
            Ok(None)
        } else {
            let text = unsafe { CStr::from_ptr(value.cast()) }
                .to_string_lossy()
                .into_owned();
            self.store
                .query_metrics
                .text_bytes_read
                .fetch_add(text.len() as u64, Ordering::Relaxed);
            Ok(Some(text))
        }
    }
}

impl Drop for Statement<'_> {
    fn drop(&mut self) {
        if !self.statement.is_null() {
            unsafe { sqlite3_finalize(self.statement) };
        }
    }
}

/// Returns the process-wide SQLite runtime identity without opening a
/// database. Adapters use this for `version`, `doctor`, and release gates so
/// a binary cannot hide which host library it links at runtime.
pub fn sqlite_runtime_identity() -> SqliteRuntimeIdentity {
    let libversion = unsafe { sqlite_text_pointer(sqlite3_libversion()) };
    let source_id = unsafe { sqlite_text_pointer(sqlite3_sourceid()) };
    let mut compile_options = Vec::new();
    let mut index = 0;
    loop {
        let option = unsafe { sqlite3_compileoption_get(index) };
        if option.is_null() {
            break;
        }
        compile_options.push(unsafe { sqlite_text_pointer(option) });
        index += 1;
    }
    SqliteRuntimeIdentity {
        libversion,
        source_id,
        compile_options,
    }
}

unsafe fn sqlite_text_pointer(pointer: *const c_char) -> String {
    if pointer.is_null() {
        String::new()
    } else {
        CStr::from_ptr(pointer).to_string_lossy().into_owned()
    }
}

fn normalized_path(path: &Path) -> Option<PathBuf> {
    if path.exists() {
        std::fs::canonicalize(path).ok()
    } else {
        let parent = path.parent()?.canonicalize().ok()?;
        Some(parent.join(path.file_name()?))
    }
}

fn same_path(left: &Path, right: &Path) -> bool {
    normalized_path(left)
        .zip(normalized_path(right))
        .is_some_and(|(a, b)| a == b)
}

fn ensure_backup_package_path(path: &Path) -> Result<(), StoreError> {
    reject_symlink(path)?;
    if path.exists() {
        return Err(StoreError::Conflict(format!(
            "backup package destination already exists: {}",
            path.display()
        )));
    }
    Ok(())
}

fn ensure_backup_package_path_exists(path: &Path) -> Result<(), StoreError> {
    reject_symlink(path)?;
    if !path.is_dir() {
        return Err(StoreError::Invalid(format!(
            "backup package is not a directory: {}",
            path.display()
        )));
    }
    Ok(())
}

fn reject_symlink(path: &Path) -> Result<(), StoreError> {
    if fs::symlink_metadata(path)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err(StoreError::Invalid(format!(
            "backup or restore path must not be a symlink: {}",
            path.display()
        )));
    }
    Ok(())
}

fn backup_staging_path(destination: &Path, label: &str) -> Result<PathBuf, StoreError> {
    let file_name = destination
        .file_name()
        .ok_or_else(|| StoreError::Invalid("backup path must name a file or directory".to_owned()))?
        .to_string_lossy();
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| StoreError::Unavailable(format!("system clock unavailable: {error}")))?
        .as_nanos();
    let staging = destination.parent().unwrap_or(Path::new(".")).join(format!(
        ".{file_name}.{label}.{}.{}.tmp",
        std::process::id(),
        stamp
    ));
    if staging.exists() {
        return Err(StoreError::Conflict(format!(
            "backup staging path already exists: {}",
            staging.display()
        )));
    }
    Ok(staging)
}

fn restore_previous_path(destination: &Path, epoch: u64) -> Result<PathBuf, StoreError> {
    let name = destination
        .file_name()
        .ok_or_else(|| {
            StoreError::Invalid("restore destination must name a database file".to_owned())
        })?
        .to_string_lossy();
    let previous = destination
        .parent()
        .unwrap_or(Path::new("."))
        .join(format!("{name}.pre-restore-{epoch}"));
    if previous.exists() {
        return Err(StoreError::Conflict(format!(
            "previous restore retention path already exists: {}",
            previous.display()
        )));
    }
    Ok(previous)
}

fn read_backup_manifest(path: &Path) -> Result<Value, StoreError> {
    let bytes = fs::read(path).map_err(|error| {
        StoreError::Unavailable(format!(
            "cannot read backup manifest {}: {error}",
            path.display()
        ))
    })?;
    serde_json::from_slice(&bytes)
        .map_err(|error| StoreError::Corrupt(format!("backup manifest is not valid JSON: {error}")))
}

fn validate_backup_manifest(manifest: &Value) -> Result<(), StoreError> {
    if manifest.get("kind").and_then(Value::as_str) != Some(BACKUP_PACKAGE_KIND) {
        return Err(StoreError::Invalid(
            "unsupported Boreal backup package kind".to_owned(),
        ));
    }
    if manifest.get("format_version").and_then(Value::as_u64) != Some(BACKUP_FORMAT_VERSION) {
        return Err(StoreError::Invalid(
            "unsupported Boreal backup package format version".to_owned(),
        ));
    }
    let schema = manifest
        .get("schema")
        .and_then(Value::as_object)
        .ok_or_else(|| StoreError::Corrupt("backup manifest schema is missing".to_owned()))?;
    if schema.get("id").and_then(Value::as_str) != Some(PRODUCTION_SCHEMA_ID)
        || schema.get("version").and_then(Value::as_i64) != Some(WORK_MODEL_SCHEMA_VERSION)
        || schema.get("contract_version").and_then(Value::as_str)
            != Some(PRODUCTION_SCHEMA_CONTRACT_VERSION)
        || schema.get("checksum").and_then(Value::as_str)
            != Some(checksum(PRODUCTION_SCHEMA_SQL.as_bytes()).as_str())
    {
        return Err(StoreError::Conflict(
            "backup package schema identity is incompatible with this binary".to_owned(),
        ));
    }
    let identity = manifest
        .get("database_identity")
        .and_then(Value::as_object)
        .ok_or_else(|| {
            StoreError::Corrupt("backup manifest database_identity is missing".to_owned())
        })?;
    if identity
        .get("database_instance_id")
        .and_then(Value::as_str)
        .is_none()
        || identity
            .get("restore_epoch")
            .and_then(Value::as_u64)
            .is_none()
    {
        return Err(StoreError::Corrupt(
            "backup manifest database identity is incomplete".to_owned(),
        ));
    }
    for key in ["projects", "referenced_blobs", "published_memory"] {
        if !manifest.get(key).is_some_and(Value::is_array) {
            return Err(StoreError::Corrupt(format!(
                "backup manifest {key} is not an array"
            )));
        }
    }
    Ok(())
}

fn manifest_database_identity(manifest: &Value) -> Result<identity::DatabaseIdentity, StoreError> {
    validate_backup_manifest(manifest)?;
    let identity = manifest
        .get("database_identity")
        .and_then(Value::as_object)
        .expect("validated backup manifest has database identity");
    let database_instance_id = identity
        .get("database_instance_id")
        .and_then(Value::as_str)
        .expect("validated backup manifest has database instance id");
    let restore_epoch = identity
        .get("restore_epoch")
        .and_then(Value::as_u64)
        .expect("validated backup manifest has restore epoch");
    identity::DatabaseIdentity::new(database_instance_id, restore_epoch)
        .map_err(|error| StoreError::Corrupt(error.to_string()))
}

fn schema_requests_work_model_v3(schema_sql: &str) -> bool {
    schema_sql.contains("work_model_v3_meta")
        && schema_sql.contains("boreal.work-model/3")
        && schema_sql.contains("PRAGMA user_version = 3")
}

fn strip_transaction_wrappers(sql: &str) -> String {
    let mut lines = sql.lines().collect::<Vec<_>>();
    if let Some(index) = lines.iter().position(|line| {
        matches!(
            line.trim().trim_end_matches(';').trim(),
            "BEGIN IMMEDIATE" | "BEGIN"
        )
    }) {
        lines.remove(index);
    }
    if let Some(index) = lines.iter().rposition(|line| {
        matches!(
            line.trim().trim_end_matches(';').trim(),
            "COMMIT" | "ROLLBACK"
        )
    }) {
        lines.remove(index);
    }
    lines.join("\n")
}

fn backup_database(
    source: *mut sqlite3,
    destination: *mut sqlite3,
) -> Result<SqliteBackupReport, StoreError> {
    let main = CString::new("main").expect("static SQLite database name has no NUL");
    backup_database_from_named(source, destination, &main, &main)
}

fn backup_database_from_named(
    source: *mut sqlite3,
    destination: *mut sqlite3,
    source_name: &CString,
    destination_name: &CString,
) -> Result<SqliteBackupReport, StoreError> {
    let backup = unsafe {
        sqlite3_backup_init(
            destination,
            destination_name.as_ptr(),
            source,
            source_name.as_ptr(),
        )
    };
    if backup.is_null() {
        return Err(database_error(destination, SQLITE_ERROR));
    }

    let mut busy_retries = 0_u64;
    let result = loop {
        let step = unsafe { sqlite3_backup_step(backup, 256) };
        match step {
            SQLITE_DONE => break Ok(()),
            SQLITE_OK => continue,
            SQLITE_BUSY | SQLITE_LOCKED => {
                busy_retries = busy_retries.saturating_add(1);
                if busy_retries > 10_000 {
                    break Err(StoreError::Busy(
                        "SQLite online backup remained busy after 10,000 retries".to_owned(),
                    ));
                }
                std::thread::sleep(Duration::from_millis(1));
            }
            code => break Err(database_error(destination, code)),
        }
    };
    // SQLite reports the source page count once the backup has stepped at
    // least once; before that it may legitimately be zero for a new handle.
    let source_page_count = unsafe { sqlite3_backup_pagecount(backup) };
    let remaining = unsafe { sqlite3_backup_remaining(backup) };
    let finish = unsafe { sqlite3_backup_finish(backup) };
    result?;
    if finish != SQLITE_OK {
        return Err(database_error(destination, finish));
    }
    let total = u64::try_from(source_page_count).unwrap_or(0);
    let remaining = u64::try_from(remaining).unwrap_or(0);
    Ok(SqliteBackupReport {
        source_page_count: total,
        pages_copied: total.saturating_sub(remaining),
        busy_retries,
    })
}

fn finish_transaction<T>(
    store: &SqliteStore,
    result: Result<T, StoreError>,
) -> Result<T, StoreError> {
    match result {
        Ok(value) => {
            store.execute_batch("COMMIT")?;
            Ok(value)
        }
        Err(error) => {
            let _ = store.execute_batch("ROLLBACK");
            Err(error)
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct RawSession {
    actor_id: String,
    harness_id: String,
    state: SessionState,
    started_at: String,
    ended_at: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct SessionRegistrationScope {
    operation_id: String,
    project_id: String,
    revision: u64,
}

fn check_expected_revision(actual: u64, expected: Option<u64>) -> Result<(), StoreError> {
    if let Some(expected) = expected {
        if expected != actual {
            return Err(StoreError::StaleRevision { expected, actual });
        }
    }
    Ok(())
}

fn validate_session_registration_request(
    request: &SessionRegistrationRequest,
) -> Result<(), StoreError> {
    for (field, value) in [
        ("project_id", request.project_id.as_str()),
        ("session_id", request.session_id.as_str()),
        ("actor_id", request.actor_id.as_str()),
        ("harness_id", request.harness_id.as_str()),
        ("operation_id", request.operation_id.as_str()),
        ("request_digest", request.request_digest.as_str()),
        ("started_at", request.started_at.as_str()),
    ] {
        if value.trim().is_empty() {
            return Err(StoreError::Invalid(format!("{field} is required")));
        }
    }
    Ok(())
}

fn validate_receipt_request(request: &ReceiptInsertRequest) -> Result<(), StoreError> {
    if request.fence == 0 {
        return Err(StoreError::Invalid(
            "receipt fence must be positive".to_owned(),
        ));
    }
    if request.result == ReceiptOutcome::Rejected
        && request.rejection_code.as_deref().is_none_or(str::is_empty)
    {
        return Err(StoreError::Invalid(
            "rejected receipt requires a rejection code".to_owned(),
        ));
    }
    if request.result != ReceiptOutcome::Rejected && request.rejection_code.is_some() {
        return Err(StoreError::Invalid(
            "only rejected receipts may have a rejection code".to_owned(),
        ));
    }
    if request.ended_at < request.started_at {
        return Err(StoreError::Invalid(
            "receipt ended_at must not precede started_at".to_owned(),
        ));
    }
    if request.gate_id.is_some() != request.acceptance.is_some() {
        return Err(StoreError::Invalid(
            "receipt gate and acceptance context must be supplied together".to_owned(),
        ));
    }
    if request
        .acceptance
        .as_ref()
        .is_some_and(|expected| expected.fence == 0)
    {
        return Err(StoreError::Invalid(
            "receipt acceptance fence must be positive".to_owned(),
        ));
    }
    Ok(())
}

fn validate_summary_request(request: &SummaryInsertRequest) -> Result<(), StoreError> {
    if request.summary_id.trim().is_empty()
        || request.project_id.trim().is_empty()
        || request.work_id.trim().is_empty()
        || request.attempt_id.trim().is_empty()
        || request.actor_id.trim().is_empty()
        || request.operation_id.trim().is_empty()
    {
        return Err(StoreError::Invalid(
            "summary identifiers must not be empty".to_owned(),
        ));
    }
    if request.fence == 0 {
        return Err(StoreError::Invalid(
            "summary fence must be positive".to_owned(),
        ));
    }
    if request.body_size == 0 || request.body_size > MAX_SUMMARY_BODY_BYTES {
        return Err(StoreError::Invalid(format!(
            "summary body size must be between 1 and {MAX_SUMMARY_BODY_BYTES} bytes"
        )));
    }
    if !valid_sha256_digest(&request.body_digest) {
        return Err(StoreError::Invalid(
            "summary body digest must be a lowercase sha256 digest".to_owned(),
        ));
    }
    if request.source_version_id.trim().is_empty()
        || request.config_identity.trim().is_empty()
        || request.profile_id.trim().is_empty()
        || request.profile_version == 0
        || request.created_at.trim().is_empty()
    {
        return Err(StoreError::Invalid(
            "summary proof context is incomplete".to_owned(),
        ));
    }
    Ok(())
}

fn valid_sha256_digest(value: &str) -> bool {
    value.strip_prefix("sha256:").is_some_and(|digest| {
        digest.len() == 64
            && digest
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    })
}

fn canonical_summary_request(request: &SummaryInsertRequest) -> Result<String, StoreError> {
    serde_json::to_string(&json!({
        "contract": "boreal.summary-insert/1",
        "project_id": request.project_id,
        "actor_id": request.actor_id,
        "session_id": request.session_id,
        "expected_project_revision": request.expected_project_revision,
        "summary_id": request.summary_id,
        "work_id": request.work_id,
        "attempt_id": request.attempt_id,
        "fence": request.fence,
        "source_version_id": request.source_version_id,
        "config_identity": request.config_identity,
        "profile_id": request.profile_id,
        "profile_version": request.profile_version,
        "body_digest": request.body_digest,
        "body_size": request.body_size,
        "operation_id": request.operation_id,
        "created_at": request.created_at,
    }))
    .map_err(|error| StoreError::Invalid(format!("cannot encode summary request: {error}")))
}

fn summary_subject_ref(attempt_id: &str, fence: u64) -> String {
    format!("attempt:{attempt_id}@{fence}")
}

/// Builds the operation identity from every semantic receipt and acceptance
/// field. The caller-provided digest is deliberately excluded: replay safety
/// cannot depend on a label that may omit or misrepresent the payload.
fn canonical_receipt_request(request: &ReceiptInsertRequest) -> Result<String, StoreError> {
    let acceptance = request.acceptance.as_ref().map(|expected| {
        json!({
            "work_id": expected.work_id,
            "attempt_id": expected.attempt_id,
            "fence": expected.fence,
            "source_version_id": expected.source_version_id,
            "config_identity": expected.config_identity,
            "profile_id": expected.profile_id,
            "profile_version": expected.profile_version,
            "gate_id": expected.gate_id,
            "gate_kind": gate_kind(expected.gate_kind),
            "gate_required": expected.gate_required,
            "requires_attestation": expected.requires_attestation,
        })
    });
    serde_json::to_string(&json!({
        "contract": "boreal.receipt-insert/2",
        "project_id": request.project_id,
        "actor_id": request.actor_id,
        "session_id": request.session_id,
        "expected_project_revision": request.expected_project_revision,
        "receipt_id": request.receipt_id,
        "work_id": request.work_id,
        "attempt_id": request.attempt_id,
        "fence": request.fence,
        "operation_id": request.operation_id,
        "gate_id": request.gate_id,
        "executable": request.executable,
        "argv_json": request.argv_json,
        "cwd": request.cwd,
        "exit_code": request.exit_code,
        "started_at": request.started_at,
        "ended_at": request.ended_at,
        "source_version_id": request.source_version_id,
        "config_identity": request.config_identity,
        "environment_fingerprint": request.environment_fingerprint,
        "output_digest": request.output_digest,
        "output_ref": request.output_ref,
        "subject_json": request.subject_json,
        "coverage_json": request.coverage_json,
        "attestation": receipt_attestation_name(request.attestation),
        "submission_kind": receipt_submission_name(request.submission_kind),
        "acceptance": acceptance,
        "result": receipt_outcome_name(request.result),
        "rejection_code": request.rejection_code,
        "created_at": request.created_at,
    }))
    .map_err(|error| StoreError::Invalid(format!("cannot encode receipt request: {error}")))
}

fn receipt_rejected(code: &str) -> StoreError {
    StoreError::Invalid(code.to_owned())
}

fn receipt_record(request: &ReceiptInsertRequest) -> ReceiptRecord {
    ReceiptRecord {
        receipt_id: request.receipt_id.clone(),
        project_id: request.project_id.clone(),
        work_id: request.work_id.clone(),
        attempt_id: request.attempt_id.clone(),
        fence: request.fence,
        operation_id: request.operation_id.clone(),
        gate_id: request.gate_id.clone(),
        executable: request.executable.clone(),
        argv_json: request.argv_json.clone(),
        cwd: request.cwd.clone(),
        exit_code: request.exit_code,
        started_at: request.started_at.clone(),
        ended_at: request.ended_at.clone(),
        source_version_id: request.source_version_id.clone(),
        config_identity: request.config_identity.clone(),
        environment_fingerprint: request.environment_fingerprint.clone(),
        output_digest: request.output_digest.clone(),
        output_ref: request.output_ref.clone(),
        subject_json: request.subject_json.clone(),
        coverage_json: request.coverage_json.clone(),
        attestation: request.attestation,
        result: request.result,
        rejection_code: request.rejection_code.clone(),
        created_at: request.created_at.clone(),
    }
}

fn receipt_from_statement(statement: &Statement<'_>) -> Result<ReceiptRecord, StoreError> {
    Ok(ReceiptRecord {
        receipt_id: statement.column_text(0)?,
        project_id: statement.column_text(1)?,
        work_id: statement.column_text(2)?,
        attempt_id: statement.column_text(3)?,
        fence: statement.column_u64(4)?,
        operation_id: statement.column_text(5)?,
        gate_id: statement.column_optional_text(6)?,
        executable: statement.column_text(7)?,
        argv_json: statement.column_text(8)?,
        cwd: statement.column_text(9)?,
        exit_code: statement.column_i64(10)? as i32,
        started_at: statement.column_text(11)?,
        ended_at: statement.column_text(12)?,
        source_version_id: statement.column_optional_text(13)?,
        config_identity: statement.column_text(14)?,
        environment_fingerprint: statement.column_text(15)?,
        output_digest: statement.column_optional_text(16)?,
        output_ref: statement.column_optional_text(17)?,
        subject_json: statement.column_text(18)?,
        coverage_json: statement.column_text(19)?,
        attestation: parse_receipt_attestation(&statement.column_text(20)?)?,
        result: parse_receipt_outcome(&statement.column_text(21)?)?,
        rejection_code: statement.column_optional_text(22)?,
        created_at: statement.column_text(23)?,
    })
}

fn receipt_result_json(
    request: &ReceiptInsertRequest,
    revision: u64,
) -> Result<String, StoreError> {
    json_object(json!({
        "receipt_id": request.receipt_id,
        "result": receipt_outcome_name(request.result),
        "revision": revision,
    }))
}

fn summary_result_json(summary_id: &str) -> Result<String, StoreError> {
    json_object(json!({
        "summary_id": summary_id,
        "current": true,
    }))
}

fn replay_evidence_execution_admission(
    request: &EvidenceExecutionAdmissionRequest,
    existing: EvidenceExecutionRecord,
) -> Result<EvidenceExecutionAdmissionResult, StoreError> {
    if existing.project_id != request.project_id
        || existing.work_id != request.work_id
        || existing.attempt_id != request.attempt_id
        || existing.fence != request.fence
        || existing.gate_id != request.gate_id
        || existing.actor_id != request.actor_id
        || existing.session_id != request.session_id
        || existing.request_digest != request.request_digest
        || existing.artifact_ref != request.artifact_ref
    {
        return Err(StoreError::Conflict(format!(
            "evidence execution operation {} was already admitted with another request",
            request.operation_id
        )));
    }
    Ok(EvidenceExecutionAdmissionResult {
        execution: existing,
        replayed: true,
    })
}

fn evidence_execution_from_statement(
    statement: &Statement<'_>,
) -> Result<EvidenceExecutionRecord, StoreError> {
    Ok(EvidenceExecutionRecord {
        operation_id: statement.column_text(0)?,
        project_id: statement.column_text(1)?,
        work_id: statement.column_text(2)?,
        attempt_id: statement.column_text(3)?,
        fence: statement.column_u64(4)?,
        gate_id: statement.column_text(5)?,
        actor_id: statement.column_text(6)?,
        session_id: statement.column_optional_text(7)?,
        request_digest: statement.column_text(8)?,
        artifact_ref: statement.column_text(9)?,
        state: parse_evidence_execution_state(&statement.column_text(10)?)?,
        admitted_at: statement.column_text(11)?,
        started_at: statement.column_optional_text(12)?,
        exited_at: statement.column_optional_text(13)?,
        exit_code: statement.column_optional_signed_i64(14)?,
        receipt_id: statement.column_optional_text(15)?,
        failure_code: statement.column_optional_text(16)?,
    })
}

fn parse_evidence_execution_state(value: &str) -> Result<EvidenceExecutionState, StoreError> {
    match value {
        "admitted" => Ok(EvidenceExecutionState::Admitted),
        "running" => Ok(EvidenceExecutionState::Running),
        "exited" => Ok(EvidenceExecutionState::Exited),
        "receipt_committed" => Ok(EvidenceExecutionState::ReceiptCommitted),
        "unknown" => Ok(EvidenceExecutionState::Unknown),
        value => Err(StoreError::Corrupt(format!(
            "unknown evidence execution state: {value}"
        ))),
    }
}

fn receipt_attestation_name(value: ReceiptAttestation) -> &'static str {
    match value {
        ReceiptAttestation::BorealWitnessed => "boreal_witnessed",
        ReceiptAttestation::ExternalAttested => "external_attested",
        ReceiptAttestation::SelfReported => "self_reported",
        ReceiptAttestation::Unknown => "unknown",
    }
}

fn receipt_submission_name(value: ReceiptSubmissionKind) -> &'static str {
    match value {
        ReceiptSubmissionKind::ExternalImport => "external_import",
        ReceiptSubmissionKind::WitnessedExecutor => "witnessed_executor",
    }
}

fn parse_receipt_attestation(value: &str) -> Result<ReceiptAttestation, StoreError> {
    match value {
        "boreal_witnessed" => Ok(ReceiptAttestation::BorealWitnessed),
        "external_attested" => Ok(ReceiptAttestation::ExternalAttested),
        "self_reported" => Ok(ReceiptAttestation::SelfReported),
        "unknown" => Ok(ReceiptAttestation::Unknown),
        value => Err(StoreError::Corrupt(format!(
            "unknown receipt attestation: {value}"
        ))),
    }
}

fn receipt_outcome_name(value: ReceiptOutcome) -> &'static str {
    match value {
        ReceiptOutcome::Passed => "passed",
        ReceiptOutcome::Failed => "failed",
        ReceiptOutcome::Rejected => "rejected",
        ReceiptOutcome::Unknown => "unknown",
        ReceiptOutcome::Stale => "stale",
    }
}

fn parse_receipt_outcome(value: &str) -> Result<ReceiptOutcome, StoreError> {
    match value {
        "passed" => Ok(ReceiptOutcome::Passed),
        "failed" => Ok(ReceiptOutcome::Failed),
        "rejected" => Ok(ReceiptOutcome::Rejected),
        "unknown" => Ok(ReceiptOutcome::Unknown),
        "stale" => Ok(ReceiptOutcome::Stale),
        value => Err(StoreError::Corrupt(format!(
            "unknown receipt result: {value}"
        ))),
    }
}

fn receipt_error_code(error: &StoreError) -> &'static str {
    match error {
        StoreError::WrongSubject { .. } => "receipt_subject_mismatch",
        StoreError::StaleFence { .. } => "stale_fence",
        StoreError::NotCurrent { .. } => "receipt_attempt_not_current",
        StoreError::WrongOwner { .. } => "receipt_owner_mismatch",
        StoreError::Invalid(code)
            if matches!(
                code.as_str(),
                "receipt_source_mismatch"
                    | "receipt_config_mismatch"
                    | "receipt_policy_mismatch"
                    | "receipt_attestation_missing"
                    | "witnessed_receipt_import_denied"
                    | "witnessed_execution_not_admitted"
                    | "witnessed_execution_subject_mismatch"
                    | "witnessed_execution_not_exited"
                    | "receipt_subject_mismatch"
            ) =>
        {
            match code.as_str() {
                "receipt_source_mismatch" => "receipt_source_mismatch",
                "receipt_config_mismatch" => "receipt_config_mismatch",
                "receipt_policy_mismatch" => "receipt_policy_mismatch",
                "receipt_attestation_missing" => "receipt_attestation_missing",
                "witnessed_receipt_import_denied" => "witnessed_receipt_import_denied",
                "witnessed_execution_not_admitted" => "witnessed_execution_not_admitted",
                "witnessed_execution_subject_mismatch" => "witnessed_execution_subject_mismatch",
                "witnessed_execution_not_exited" => "witnessed_execution_not_exited",
                "receipt_subject_mismatch" => "receipt_subject_mismatch",
                _ => unreachable!(),
            }
        }
        _ => "receipt_rejected",
    }
}

fn receipt_error_from_code(code: &str, receipt: &ReceiptRecord) -> StoreError {
    match code {
        "receipt_subject_mismatch" => StoreError::WrongSubject {
            expected: receipt.work_id.clone(),
            actual: receipt.work_id.clone(),
        },
        "stale_fence" => StoreError::StaleFence {
            expected: receipt.fence,
            actual: receipt.fence,
        },
        "receipt_attempt_not_current" => StoreError::NotCurrent {
            attempt_id: receipt.attempt_id.clone(),
        },
        "receipt_owner_mismatch" => StoreError::WrongOwner {
            expected: String::new(),
            actual: String::new(),
        },
        _ => StoreError::Invalid(format!("receipt was retained as rejected: {code}")),
    }
}

fn gate_state_name(value: GateState) -> &'static str {
    match value {
        GateState::Open => "open",
        GateState::Satisfied => "satisfied",
        GateState::Failed => "failed",
    }
}

fn parse_gate_state(value: &str) -> Result<GateState, StoreError> {
    match value {
        "open" => Ok(GateState::Open),
        "satisfied" => Ok(GateState::Satisfied),
        "failed" => Ok(GateState::Failed),
        "waived" => Err(StoreError::Corrupt(
            "waived gate state is outside the typed v2 store API".to_owned(),
        )),
        value => Err(StoreError::Corrupt(format!("unknown gate state: {value}"))),
    }
}

fn parse_gate_kind(value: &str) -> Result<GateKind, StoreError> {
    match value {
        "checkpoint" => Ok(GateKind::Checkpoint),
        "verification" => Ok(GateKind::Verification),
        "review" => Ok(GateKind::Review),
        "operator_approval" => Ok(GateKind::OperatorApproval),
        "summary" => Ok(GateKind::Summary),
        "audit" => Ok(GateKind::Audit),
        value => Err(StoreError::Corrupt(format!("unknown gate kind: {value}"))),
    }
}

fn gate_kind(value: GateKind) -> &'static str {
    match value {
        GateKind::Checkpoint => "checkpoint",
        GateKind::Verification => "verification",
        GateKind::Review => "review",
        GateKind::OperatorApproval => "operator_approval",
        GateKind::Summary => "summary",
        GateKind::Audit => "audit",
    }
}

fn review_decision_name(value: ReviewDecision) -> &'static str {
    match value {
        ReviewDecision::Accepted => "accepted",
        ReviewDecision::Rejected => "rejected",
    }
}

fn parse_review_decision(value: &str) -> Result<ReviewDecision, StoreError> {
    match value {
        "accepted" => Ok(ReviewDecision::Accepted),
        "rejected" => Ok(ReviewDecision::Rejected),
        value => Err(StoreError::Corrupt(format!(
            "unknown review decision: {value}"
        ))),
    }
}

fn review_from_statement(statement: &Statement<'_>) -> Result<ReviewRecord, StoreError> {
    Ok(ReviewRecord {
        review_id: statement.column_text(0)?,
        project_id: statement.column_text(1)?,
        work_id: statement.column_text(2)?,
        attempt_id: statement.column_text(3)?,
        fence: statement.column_u64(4)?,
        gate_id: statement.column_optional_text(5)?,
        reviewer_actor_id: statement.column_text(6)?,
        decision: parse_review_decision(&statement.column_text(7)?)?,
        reason: statement.column_text(8)?,
        source_version_id: statement.column_optional_text(9)?,
        policy_digest: statement.column_text(10)?,
        created_at: statement.column_text(11)?,
    })
}

fn summary_from_statement(statement: &Statement<'_>) -> Result<SummaryRecord, StoreError> {
    Ok(SummaryRecord {
        summary_id: statement.column_text(0)?,
        project_id: statement.column_text(1)?,
        work_id: statement.column_text(2)?,
        attempt_id: statement.column_text(3)?,
        fence: statement.column_u64(4)?,
        subject_ref: statement.column_text(5)?,
        source_version_id: statement.column_text(6)?,
        config_identity: statement.column_text(7)?,
        profile_id: statement.column_text(8)?,
        profile_version: statement.column_u64(9)?,
        body_digest: statement.column_text(10)?,
        body_size: statement.column_u64(11)?,
        current: statement.column_i64(12)? == 1,
        created_at: statement.column_text(13)?,
    })
}

fn parse_close_intent_state(value: &str) -> Result<CloseIntentState, StoreError> {
    match value {
        "open" => Ok(CloseIntentState::Open),
        "invalidated" => Ok(CloseIntentState::Invalidated),
        "finalized" => Ok(CloseIntentState::Finalized),
        "rejected" => Ok(CloseIntentState::Rejected),
        value => Err(StoreError::Corrupt(format!(
            "unknown close intent state: {value}"
        ))),
    }
}

fn close_intent_from_statement(statement: &Statement<'_>) -> Result<CloseIntentRecord, StoreError> {
    Ok(CloseIntentRecord {
        close_intent_id: statement.column_text(0)?,
        project_id: statement.column_text(1)?,
        work_id: statement.column_text(2)?,
        attempt_id: statement.column_text(3)?,
        fence: statement.column_u64(4)?,
        operation_id: statement.column_text(5)?,
        source_version_id: statement.column_optional_text(6)?,
        config_identity: statement.column_text(7)?,
        profile_id: statement.column_text(8)?,
        profile_version: statement.column_u64(9)?,
        summary_id: statement.column_optional_text(10)?,
        state: parse_close_intent_state(&statement.column_text(11)?)?,
        created_at: statement.column_text(12)?,
        finalized_at: statement.column_optional_text(13)?,
        invalidated_at: statement.column_optional_text(14)?,
        invalidation_code: statement.column_optional_text(15)?,
    })
}

fn close_intent_result_json(close_intent_id: &str, state: &str) -> Result<String, StoreError> {
    json_object(json!({
        "close_intent_id": close_intent_id,
        "state": state,
    }))
}

fn close_rejected_result_json(
    close_intent_id: &str,
    missing: &[String],
) -> Result<String, StoreError> {
    json_object(json!({
        "close_intent_id": close_intent_id,
        "state": "open",
        "missing": missing,
    }))
}

fn validate_close_intent_match(
    request: &CloseIntentRequest,
    intent: &CloseIntentRecord,
) -> Result<(), StoreError> {
    if intent.work_id != request.work_id || intent.project_id != request.project_id {
        return Err(StoreError::WrongSubject {
            expected: format!("{}/{}", request.project_id, request.work_id),
            actual: format!("{}/{}", intent.project_id, intent.work_id),
        });
    }
    if intent.attempt_id != request.attempt_id || intent.fence != request.fence {
        return Err(StoreError::StaleFence {
            expected: request.fence,
            actual: intent.fence,
        });
    }
    if intent.source_version_id != request.source_version_id
        || intent.config_identity != request.config_identity
        || intent.profile_id != request.profile_id
        || intent.profile_version != request.profile_version
        || intent.summary_id != request.summary_id
    {
        return Err(StoreError::Conflict(
            "close intent snapshot does not match request".to_owned(),
        ));
    }
    Ok(())
}

fn database_error(database: *mut sqlite3, result: c_int) -> StoreError {
    let message = if database.is_null() {
        format!("SQLite error {result}")
    } else {
        unsafe { CStr::from_ptr(sqlite3_errmsg(database)) }
            .to_string_lossy()
            .into_owned()
    };
    classify_sqlite_error(result, message)
}

fn classify_sqlite_error(result: c_int, message: String) -> StoreError {
    if result == SQLITE_BUSY || result == SQLITE_LOCKED {
        return StoreError::Busy(message);
    }
    if result == SQLITE_CANTOPEN || result == SQLITE_IOERR {
        return StoreError::Unavailable(message);
    }
    if result == SQLITE_NOTADB {
        return StoreError::Corrupt(message);
    }
    if result == SQLITE_CONSTRAINT || message.to_ascii_lowercase().contains("constraint") {
        let lower = message.to_ascii_lowercase();
        let kind = if lower.contains("foreign key") {
            ConstraintKind::ForeignKey
        } else if lower.contains("receipt_append_only") || lower.contains("audit_append_only") {
            ConstraintKind::AppendOnly
        } else if lower.contains("reviewer_cannot_review_own_attempt") {
            ConstraintKind::SelfReview
        } else if lower.contains("unique") {
            ConstraintKind::Unique
        } else {
            ConstraintKind::Check
        };
        return StoreError::Constraint { kind, message };
    }
    if result == SQLITE_ERROR {
        return StoreError::Invalid(message);
    }
    StoreError::Corrupt(message)
}

fn work_kind(kind: boreal_domain::WorkKind) -> &'static str {
    match kind {
        boreal_domain::WorkKind::Milestone => "milestone",
        boreal_domain::WorkKind::Sprint => "sprint",
        boreal_domain::WorkKind::Task => "task",
    }
}

fn lifecycle(lifecycle: boreal_domain::PersistedLifecycle) -> &'static str {
    match lifecycle {
        boreal_domain::PersistedLifecycle::Draft => "draft",
        boreal_domain::PersistedLifecycle::Open => "open",
        boreal_domain::PersistedLifecycle::Closed => "closed",
        boreal_domain::PersistedLifecycle::Cancelled => "cancelled",
    }
}

fn dispatch_policy(policy: boreal_domain::DispatchPolicy) -> &'static str {
    match policy {
        boreal_domain::DispatchPolicy::Automatic => "automatic",
        boreal_domain::DispatchPolicy::OperatorOnly => "operator_only",
        boreal_domain::DispatchPolicy::Paused => "paused",
    }
}

fn parse_work_kind(value: &str) -> Result<WorkKind, StoreError> {
    match value {
        "milestone" => Ok(WorkKind::Milestone),
        "sprint" => Ok(WorkKind::Sprint),
        "task" => Ok(WorkKind::Task),
        value => Err(StoreError::Corrupt(format!("unknown work kind: {value}"))),
    }
}

fn parse_lifecycle(value: &str) -> Result<PersistedLifecycle, StoreError> {
    match value {
        "draft" => Ok(PersistedLifecycle::Draft),
        "open" => Ok(PersistedLifecycle::Open),
        "closed" => Ok(PersistedLifecycle::Closed),
        "cancelled" => Ok(PersistedLifecycle::Cancelled),
        value => Err(StoreError::Corrupt(format!("unknown lifecycle: {value}"))),
    }
}

fn parse_dispatch_policy(value: &str) -> Result<DispatchPolicy, StoreError> {
    match value {
        "automatic" => Ok(DispatchPolicy::Automatic),
        "operator_only" => Ok(DispatchPolicy::OperatorOnly),
        "paused" => Ok(DispatchPolicy::Paused),
        value => Err(StoreError::Corrupt(format!(
            "unknown dispatch policy: {value}"
        ))),
    }
}

fn parse_dependency_policy(value: &str) -> Result<DependencyPolicy, StoreError> {
    match value {
        "closed_only" => Ok(DependencyPolicy::ClosedOnly),
        "explicit_exception" => Err(StoreError::Invalid(
            "explicit dependency exceptions are not representable in the v2 status domain"
                .to_owned(),
        )),
        value => Err(StoreError::Corrupt(format!(
            "unknown dependency policy: {value}"
        ))),
    }
}

fn profile_version(value: &str) -> Result<u64, StoreError> {
    value.parse::<u64>().map_err(|_| {
        StoreError::Invalid(format!(
            "acceptance profile version is not numeric: {value}"
        ))
    })
}

fn profile_version_for_work(
    profile: &AcceptanceProfile,
    now: &str,
) -> Result<ProfileVersion, StoreError> {
    let gates = profile
        .gates
        .iter()
        .map(|gate| {
            json!({
                "id": gate.id.as_str(),
                "kind": gate_kind(gate.kind),
                "required": gate.required,
            })
        })
        .collect::<Vec<_>>();
    let definition_json = json!({
        "gates": gates,
        "review_policy": {"required": profile.requires_review()},
        "subject_rules": {"work_id": "exact"},
        "required_observables": [],
        "verifier_policy": "trusted_registered_verifier",
        "exception_policy": "operator_scoped_additional_decision",
    })
    .to_string();
    let provisional = ProfileVersion::new(
        profile.id.as_str(),
        profile_version(&profile.version)?,
        "sha256:placeholder",
        definition_json.clone(),
        now,
    )?;
    let digest = provisional.computed_digest()?;
    ProfileVersion::from_canonical_definition(
        profile.id.as_str(),
        provisional.version,
        digest,
        definition_json,
        now,
    )
}

fn recovery_obligation_for_attempt_mutation(
    request: &AttemptMutationRequest,
) -> Option<recovery::RecoveryObligationInput> {
    let (reason, next_action) = match request.mutation {
        AttemptMutationKind::Expire { .. } => (
            "expired",
            "confirm the stopped runtime and resolve the expiry obligation before reuse",
        ),
        AttemptMutationKind::Fail => (
            "failed",
            "review the failed attempt and resolve resource disposition before retry",
        ),
        AttemptMutationKind::Release => (
            "resource_unknown",
            "acknowledge resource release before reusing the execution resource",
        ),
        AttemptMutationKind::Cancel { .. } => (
            "cancel_requested",
            "confirm cancellation and resolve resource disposition before replacement",
        ),
        AttemptMutationKind::Accept
        | AttemptMutationKind::Start
        | AttemptMutationKind::Heartbeat { .. }
        | AttemptMutationKind::RenewLease { .. }
        | AttemptMutationKind::Submit => return None,
    };
    Some(recovery::RecoveryObligationInput {
        obligation_id: format!(
            "{}:recovery:{}",
            request.operation_id,
            reason.replace('_', "-")
        ),
        project_id: request.project_id.clone(),
        work_id: request.work_id.clone(),
        attempt_id: Some(request.attempt_id.clone()),
        fence: Some(request.fence),
        reason: reason.to_owned(),
        resource_state: "unknown".to_owned(),
        owner_actor_id: Some(request.actor_id.clone()),
        next_action: next_action.to_owned(),
        created_at: request.at.clone(),
    })
}

fn parse_phase(value: &str) -> Result<AttemptPhase, StoreError> {
    match value {
        "claimed" => Ok(AttemptPhase::Claimed),
        "accepted" => Ok(AttemptPhase::Accepted),
        "running" => Ok(AttemptPhase::Running),
        "verifying" => Ok(AttemptPhase::Verifying),
        "expiry_pending" => Ok(AttemptPhase::ExpiryPending),
        "completed" => Ok(AttemptPhase::Completed),
        "failed" => Ok(AttemptPhase::Failed),
        "released" => Ok(AttemptPhase::Released),
        "expired" => Ok(AttemptPhase::Expired),
        "cancelled" => Ok(AttemptPhase::Cancelled),
        value => Err(StoreError::Corrupt(format!(
            "unknown attempt state: {value}"
        ))),
    }
}

fn parse_session_state(value: &str) -> Result<SessionState, StoreError> {
    match value {
        "active" => Ok(SessionState::Active),
        "ended" => Ok(SessionState::Ended),
        "unknown" => Ok(SessionState::Unknown),
        value => Err(StoreError::Corrupt(format!(
            "unknown session state: {value}"
        ))),
    }
}

fn phase_name(phase: AttemptPhase) -> &'static str {
    match phase {
        AttemptPhase::Claimed => "claimed",
        AttemptPhase::Accepted => "accepted",
        AttemptPhase::Running => "running",
        AttemptPhase::Verifying => "verifying",
        AttemptPhase::ExpiryPending => "expiry_pending",
        AttemptPhase::Completed => "completed",
        AttemptPhase::Failed => "failed",
        AttemptPhase::Released => "released",
        AttemptPhase::Expired => "expired",
        AttemptPhase::Cancelled => "cancelled",
    }
}

fn mutation_name(mutation: &AttemptMutationKind) -> &'static str {
    match mutation {
        AttemptMutationKind::Accept => "accept",
        AttemptMutationKind::Start => "start",
        AttemptMutationKind::Heartbeat { .. } => "heartbeat",
        AttemptMutationKind::RenewLease { .. } => "renew_lease",
        AttemptMutationKind::Submit => "submit",
        AttemptMutationKind::Release => "release",
        AttemptMutationKind::Fail => "fail",
        AttemptMutationKind::Expire { .. } => "expire",
        AttemptMutationKind::Cancel { .. } => "cancel",
    }
}

fn event_type(mutation: &AttemptMutationKind) -> &'static str {
    match mutation {
        AttemptMutationKind::Accept => "attempt.accepted",
        AttemptMutationKind::Start => "attempt.started",
        // Schema v2 intentionally has no noisy heartbeat event. The lease
        // event records the liveness operation in its payload.
        AttemptMutationKind::Heartbeat { .. } | AttemptMutationKind::RenewLease { .. } => {
            "lease.renewed"
        }
        AttemptMutationKind::Submit => "attempt.submitted",
        AttemptMutationKind::Release => "attempt.released",
        AttemptMutationKind::Fail => "attempt.failed",
        AttemptMutationKind::Expire { .. } => "attempt.expired",
        // schema-v2 has a work.cancelled event but no attempt.cancelled event;
        // the audit subject remains the cancelled attempt.
        AttemptMutationKind::Cancel { .. } => "work.cancelled",
    }
}

fn attempt_result_json(
    attempt_id: &str,
    fence: u64,
    phase: AttemptPhase,
    lease_deadline: &str,
    hard_deadline: &str,
) -> Result<String, StoreError> {
    json_object(json!({
        "attempt_id": attempt_id,
        "fence": fence,
        "phase": phase_name(phase),
        "lease_deadline": lease_deadline,
        "hard_deadline": hard_deadline,
    }))
}

fn audit_payload(
    mutation: &AttemptMutationKind,
    phase: AttemptPhase,
    reason: Option<&str>,
    lease_deadline: &str,
    hard_deadline: &str,
) -> Result<String, StoreError> {
    let mut payload = json!({
        "mutation": mutation_name(mutation),
        "phase": phase_name(phase),
        "lease_deadline": lease_deadline,
        "hard_deadline": hard_deadline,
    });
    let object = payload.as_object_mut().ok_or_else(|| {
        StoreError::Corrupt("attempt audit payload is not a JSON object".to_owned())
    })?;
    if let Some(reason) = reason {
        object.insert("reason".to_owned(), json!(reason));
    }
    if let AttemptMutationKind::Heartbeat {
        phase: liveness_phase,
        tool,
        process,
    } = mutation
    {
        if let Some(value) = liveness_phase {
            object.insert("liveness_phase".to_owned(), json!(value));
        }
        if let Some(value) = tool {
            object.insert("tool".to_owned(), json!(value));
        }
        if let Some(value) = process {
            object.insert("process".to_owned(), json!(value));
        }
    }
    json_object(payload)
}

fn json_object(value: Value) -> Result<String, StoreError> {
    serde_json::to_string(&value).map_err(|error| {
        StoreError::Corrupt(format!("cannot serialize store JSON payload: {error}"))
    })
}

fn quote_identifier(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn timestamp_cmp(left: &str, right: &str) -> std::cmp::Ordering {
    match (timestamp_value(left), timestamp_value(right)) {
        (Ok(left), Ok(right)) => left.cmp(&right),
        _ => left.cmp(right),
    }
}

fn timestamp_value(value: &str) -> Result<u128, ()> {
    value
        .strip_prefix("unix-ms:")
        .or_else(|| value.strip_prefix("unix_ms:"))
        .unwrap_or(value)
        .parse::<u128>()
        .map_err(|_| ())
}

fn json_string_field(json: &str, field: &str) -> Result<String, StoreError> {
    let value: Value = serde_json::from_str(json)
        .map_err(|error| StoreError::Corrupt(format!("invalid JSON operation result: {error}")))?;
    value
        .get(field)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| {
            StoreError::Corrupt(format!(
                "attempt operation result is missing string field {field}"
            ))
        })
}

fn json_u64_field(json: &str, field: &str) -> Result<u64, StoreError> {
    let value: Value = serde_json::from_str(json)
        .map_err(|error| StoreError::Corrupt(format!("invalid JSON operation result: {error}")))?;
    value
        .get(field)
        .and_then(Value::as_u64)
        .ok_or_else(|| StoreError::Corrupt(format!("attempt operation result has invalid {field}")))
}
