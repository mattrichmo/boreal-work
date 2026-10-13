//! Physical backup packages for the installation-wide Global database.
//!
//! A package contains a SQLite online-backup snapshot plus a manifest derived
//! from that copied snapshot. The Global database is reopened read-only for
//! validation; this path never runs schema initialization or migrations.

use super::{GlobalManagerStore, GLOBAL_SCHEMA_ID, GLOBAL_SCHEMA_VERSION};
use crate::{SqliteBackupReport, SqliteStore, StoreError, SQLITE_ROW};
use serde_json::{json, Value};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

const PACKAGE_KIND: &str = "boreal.global.backup";
const PACKAGE_FORMAT_VERSION: u64 = 1;
const DATABASE_FILE: &str = "database.sqlite";
const MANIFEST_FILE: &str = "manifest.json";
const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GlobalBackupProducer {
    pub name: String,
    pub version: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GlobalBackupSqliteRuntime {
    pub libversion: String,
    pub source_id: String,
    pub compile_options: Vec<String>,
}

/// The stable, self-describing metadata stored beside a Global database copy.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GlobalBackupManifest {
    pub kind: String,
    pub format_version: u64,
    pub source_schema_id: String,
    pub source_schema_version: u64,
    pub database_id: String,
    pub revision: u64,
    pub database_bytes: u64,
    pub database_checksum: String,
    pub created_at: String,
    pub producer: GlobalBackupProducer,
    pub sqlite_runtime: GlobalBackupSqliteRuntime,
}

impl GlobalBackupManifest {
    pub fn as_json(&self) -> Value {
        json!({
            "kind": self.kind,
            "format_version": self.format_version,
            "source_schema_id": self.source_schema_id,
            "source_schema_version": self.source_schema_version,
            "database_id": self.database_id,
            "revision": self.revision,
            "database_bytes": self.database_bytes,
            "database_checksum": self.database_checksum,
            "created_at": self.created_at,
            "producer": {
                "name": self.producer.name,
                "version": self.producer.version,
            },
            "sqlite_runtime": {
                "libversion": self.sqlite_runtime.libversion,
                "source_id": self.sqlite_runtime.source_id,
                "compile_options": self.sqlite_runtime.compile_options,
            },
        })
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GlobalBackupPackageReport {
    pub package_path: PathBuf,
    pub database_path: PathBuf,
    pub manifest_path: PathBuf,
    pub backup: SqliteBackupReport,
    pub manifest: GlobalBackupManifest,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GlobalBackupInspection {
    pub package_path: PathBuf,
    pub database_path: PathBuf,
    pub manifest_path: PathBuf,
    pub manifest: GlobalBackupManifest,
}

/// Validates the public manifest contract without opening or modifying a DB.
pub fn validate_global_backup_manifest(
    document: &Value,
) -> Result<GlobalBackupManifest, StoreError> {
    let required_text = |field: &str| -> Result<String, StoreError> {
        document
            .get(field)
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(str::to_owned)
            .ok_or_else(|| {
                StoreError::Corrupt(format!(
                    "Global backup manifest {field} is missing or empty"
                ))
            })
    };
    if required_text("kind")? != PACKAGE_KIND {
        return Err(StoreError::Invalid(
            "unsupported Global backup package kind".into(),
        ));
    }
    let format_version = document
        .get("format_version")
        .and_then(Value::as_u64)
        .ok_or_else(|| StoreError::Corrupt("Global backup format_version is invalid".into()))?;
    if format_version != PACKAGE_FORMAT_VERSION {
        return Err(StoreError::Invalid(format!(
            "unsupported Global backup format version {format_version}"
        )));
    }
    let source_schema_id = required_text("source_schema_id")?;
    let source_schema_version = document
        .get("source_schema_version")
        .and_then(Value::as_u64)
        .ok_or_else(|| {
            StoreError::Corrupt("Global backup source_schema_version is invalid".into())
        })?;
    if source_schema_id != GLOBAL_SCHEMA_ID || source_schema_version != GLOBAL_SCHEMA_VERSION {
        return Err(StoreError::Invalid(format!(
            "unsupported Global backup schema {source_schema_id}/{source_schema_version}"
        )));
    }
    let database_id = required_text("database_id")?;
    if !is_database_id(&database_id) {
        return Err(StoreError::Corrupt(
            "Global backup database_id is malformed".into(),
        ));
    }
    let revision = document
        .get("revision")
        .and_then(Value::as_u64)
        .ok_or_else(|| StoreError::Corrupt("Global backup revision is invalid".into()))?;
    let database_bytes = document
        .get("database_bytes")
        .and_then(Value::as_u64)
        .filter(|bytes| *bytes > 0)
        .ok_or_else(|| StoreError::Corrupt("Global backup database_bytes is invalid".into()))?;
    let database_checksum = required_text("database_checksum")?;
    if !is_sha256_digest(&database_checksum) {
        return Err(StoreError::Corrupt(
            "Global backup database_checksum is malformed".into(),
        ));
    }
    let created_at = required_text("created_at")?;

    let producer = document
        .get("producer")
        .and_then(Value::as_object)
        .ok_or_else(|| StoreError::Corrupt("Global backup producer is missing".into()))?;
    let producer_name = producer
        .get("name")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| StoreError::Corrupt("Global backup producer.name is invalid".into()))?;
    let producer_version = producer
        .get("version")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| StoreError::Corrupt("Global backup producer.version is invalid".into()))?;

    let runtime = document
        .get("sqlite_runtime")
        .and_then(Value::as_object)
        .ok_or_else(|| StoreError::Corrupt("Global backup sqlite_runtime is missing".into()))?;
    let libversion = runtime
        .get("libversion")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            StoreError::Corrupt("Global backup sqlite_runtime.libversion is invalid".into())
        })?;
    let source_id = runtime
        .get("source_id")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            StoreError::Corrupt("Global backup sqlite_runtime.source_id is invalid".into())
        })?;
    let compile_options = runtime
        .get("compile_options")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            StoreError::Corrupt("Global backup sqlite_runtime.compile_options is invalid".into())
        })?
        .iter()
        .map(|option| {
            option.as_str().map(str::to_owned).ok_or_else(|| {
                StoreError::Corrupt(
                    "Global backup sqlite_runtime.compile_options contains a non-string".into(),
                )
            })
        })
        .collect::<Result<Vec<_>, _>>()?;

    Ok(GlobalBackupManifest {
        kind: PACKAGE_KIND.to_owned(),
        format_version,
        source_schema_id,
        source_schema_version,
        database_id,
        revision,
        database_bytes,
        database_checksum,
        created_at,
        producer: GlobalBackupProducer {
            name: producer_name.to_owned(),
            version: producer_version.to_owned(),
        },
        sqlite_runtime: GlobalBackupSqliteRuntime {
            libversion: libversion.to_owned(),
            source_id: source_id.to_owned(),
            compile_options,
        },
    })
}

impl GlobalManagerStore {
    /// Creates and atomically publishes a validated Global physical backup.
    /// The DB file is copied through SQLite's online-backup API, including
    /// committed WAL contents, then the copied DB and generated manifest are
    /// independently reopened and checked before the package is published.
    pub fn backup_package_to(
        &self,
        destination: impl AsRef<Path>,
    ) -> Result<GlobalBackupPackageReport, StoreError> {
        let destination = destination.as_ref();
        ensure_package_destination(destination)?;
        let parent = nonempty_parent(destination);
        fs::create_dir_all(parent).map_err(|error| {
            StoreError::Unavailable(format!(
                "cannot create Global backup parent {}: {error}",
                parent.display()
            ))
        })?;
        let staging = staging_path(destination)?;
        fs::create_dir(&staging).map_err(|error| {
            StoreError::Unavailable(format!(
                "cannot create Global backup staging directory {}: {error}",
                staging.display()
            ))
        })?;

        let result = (|| {
            let database_path = staging.join(DATABASE_FILE);
            let backup = self.inner.backup_to(&database_path)?;
            let manifest = build_manifest(&database_path)?;
            let manifest_document = manifest.as_json();
            // Validate what will be written, not just the in-memory builder.
            validate_global_backup_manifest(&manifest_document)?;
            write_manifest(&staging.join(MANIFEST_FILE), &manifest_document)?;

            // Re-read both artifacts together and validate all cross-file and
            // Global history invariants before the package becomes visible.
            let inspection = inspect_global_backup_package(&staging)?;
            fs::rename(&staging, destination).map_err(|error| {
                StoreError::Unavailable(format!(
                    "cannot publish Global backup package {}: {error}",
                    destination.display()
                ))
            })?;
            Ok(GlobalBackupPackageReport {
                package_path: destination.to_path_buf(),
                database_path: destination.join(DATABASE_FILE),
                manifest_path: destination.join(MANIFEST_FILE),
                backup,
                manifest: inspection.manifest,
            })
        })();
        if result.is_err() {
            let _ = fs::remove_dir_all(&staging);
        }
        result
    }

    /// Inspects a package without migrating or changing its database.
    pub fn inspect_backup_package(
        package: impl AsRef<Path>,
    ) -> Result<GlobalBackupInspection, StoreError> {
        inspect_global_backup_package(package)
    }
}

/// Opens a package without migration and verifies its manifest, SQLite file,
/// Global identity, state, operation/audit sequence, and revision history.
pub fn inspect_global_backup_package(
    package: impl AsRef<Path>,
) -> Result<GlobalBackupInspection, StoreError> {
    let package_path = package.as_ref();
    reject_symlink(package_path)?;
    if !package_path.is_dir() {
        return Err(StoreError::Invalid(format!(
            "Global backup package is not a directory: {}",
            package_path.display()
        )));
    }
    let database_path = package_path.join(DATABASE_FILE);
    let manifest_path = package_path.join(MANIFEST_FILE);
    reject_symlink(&database_path)?;
    reject_symlink(&manifest_path)?;
    for suffix in ["-wal", "-shm"] {
        let sidecar = append_suffix(&database_path, suffix);
        reject_symlink(&sidecar)?;
        if sidecar.exists() {
            return Err(StoreError::Corrupt(format!(
                "Global backup package contains an unmanifested SQLite sidecar: {}",
                sidecar.display()
            )));
        }
    }

    let manifest_document = read_manifest(&manifest_path)?;
    let manifest = validate_global_backup_manifest(&manifest_document)?;
    let metadata = fs::metadata(&database_path).map_err(|error| {
        StoreError::Unavailable(format!(
            "cannot inspect Global backup database {}: {error}",
            database_path.display()
        ))
    })?;
    if !metadata.is_file() || metadata.len() != manifest.database_bytes {
        return Err(StoreError::Corrupt(
            "Global backup database byte count does not match its manifest".into(),
        ));
    }
    let contents = fs::read(&database_path).map_err(|error| {
        StoreError::Unavailable(format!(
            "cannot read Global backup database {}: {error}",
            database_path.display()
        ))
    })?;
    if crate::checksum(&contents) != manifest.database_checksum {
        return Err(StoreError::Corrupt(
            "Global backup database checksum does not match its manifest".into(),
        ));
    }

    let database = open_global_snapshot_read_only(&database_path)?;
    let actual = validate_global_snapshot(&database)?;
    if actual.schema_id != manifest.source_schema_id
        || actual.schema_version != manifest.source_schema_version
        || actual.database_id != manifest.database_id
        || actual.revision != manifest.revision
    {
        return Err(StoreError::Corrupt(
            "Global backup manifest identity does not match its SQLite snapshot".into(),
        ));
    }
    drop(database);

    Ok(GlobalBackupInspection {
        package_path: package_path.to_path_buf(),
        database_path,
        manifest_path,
        manifest,
    })
}

struct SnapshotIdentity {
    schema_id: String,
    schema_version: u64,
    database_id: String,
    revision: u64,
}

fn build_manifest(database_path: &Path) -> Result<GlobalBackupManifest, StoreError> {
    let database = open_global_snapshot_read_only(database_path)?;
    let identity = validate_global_snapshot(&database)?;
    drop(database);
    let metadata = fs::metadata(database_path).map_err(|error| {
        StoreError::Unavailable(format!(
            "cannot inspect Global backup database {}: {error}",
            database_path.display()
        ))
    })?;
    let contents = fs::read(database_path).map_err(|error| {
        StoreError::Unavailable(format!(
            "cannot read Global backup database {}: {error}",
            database_path.display()
        ))
    })?;
    let runtime = crate::sqlite_runtime_identity();
    Ok(GlobalBackupManifest {
        kind: PACKAGE_KIND.to_owned(),
        format_version: PACKAGE_FORMAT_VERSION,
        source_schema_id: identity.schema_id,
        source_schema_version: identity.schema_version,
        database_id: identity.database_id,
        revision: identity.revision,
        database_bytes: metadata.len(),
        database_checksum: crate::checksum(&contents),
        created_at: super::now(),
        producer: GlobalBackupProducer {
            name: env!("CARGO_PKG_NAME").to_owned(),
            version: env!("CARGO_PKG_VERSION").to_owned(),
        },
        sqlite_runtime: GlobalBackupSqliteRuntime {
            libversion: runtime.libversion,
            source_id: runtime.source_id,
            compile_options: runtime.compile_options,
        },
    })
}

fn open_global_snapshot_read_only(path: &Path) -> Result<SqliteStore, StoreError> {
    SqliteStore::open_connection(path, crate::SQLITE_OPEN_READONLY)
}

fn validate_global_snapshot(database: &SqliteStore) -> Result<SnapshotIdentity, StoreError> {
    validate_integrity(database)?;
    for table in [
        "global_schema",
        "global_manager_state",
        "global_operation",
        "global_audit",
        "global_revision_snapshot",
    ] {
        if !table_exists(database, table)? {
            return Err(StoreError::Corrupt(format!(
                "Global backup database is missing required table {table}"
            )));
        }
    }

    if row_count(database, "global_schema")? != 1 {
        return Err(StoreError::Corrupt(
            "Global backup must contain exactly one schema singleton".into(),
        ));
    }
    let mut schema = database.prepare(
        "SELECT schema_id,schema_version,database_id,revision FROM global_schema WHERE singleton=1",
    )?;
    if schema.step()? != SQLITE_ROW {
        return Err(StoreError::Corrupt(
            "Global backup schema singleton is missing".into(),
        ));
    }
    let identity = SnapshotIdentity {
        schema_id: schema.column_text(0)?,
        schema_version: schema.column_u64(1)?,
        database_id: schema.column_text(2)?,
        revision: schema.column_u64(3)?,
    };
    if schema.step()? != crate::SQLITE_DONE {
        return Err(StoreError::Corrupt(
            "Global backup has duplicate schema singletons".into(),
        ));
    }
    if identity.schema_id != GLOBAL_SCHEMA_ID
        || identity.schema_version != GLOBAL_SCHEMA_VERSION
        || !is_database_id(&identity.database_id)
    {
        return Err(StoreError::Invalid(
            "Global backup SQLite schema identity is unsupported".into(),
        ));
    }

    if row_count(database, "global_manager_state")? != 1 {
        return Err(StoreError::Corrupt(
            "Global backup must contain exactly one state singleton".into(),
        ));
    }
    let mut state_query =
        database.prepare("SELECT state_json FROM global_manager_state WHERE singleton=1")?;
    if state_query.step()? != SQLITE_ROW {
        return Err(StoreError::Corrupt(
            "Global backup state singleton is missing".into(),
        ));
    }
    let state_json = state_query.column_text(0)?;
    if state_query.step()? != crate::SQLITE_DONE {
        return Err(StoreError::Corrupt(
            "Global backup has duplicate state singletons".into(),
        ));
    }
    let current_state: Value = serde_json::from_str(&state_json).map_err(|error| {
        StoreError::Corrupt(format!("Global backup state JSON is invalid: {error}"))
    })?;
    validate_state_shape(&current_state)?;

    validate_operations_and_audit(database, identity.revision)?;
    validate_revision_history(database, identity.revision, &current_state)?;
    Ok(identity)
}

fn validate_integrity(database: &SqliteStore) -> Result<(), StoreError> {
    let mut check = database.prepare("PRAGMA integrity_check")?;
    let mut rows = 0_u64;
    while check.step()? == SQLITE_ROW {
        rows = rows.saturating_add(1);
        if check.column_text(0)? != "ok" {
            return Err(StoreError::Corrupt(
                "Global backup SQLite integrity_check failed".into(),
            ));
        }
    }
    if rows != 1 {
        return Err(StoreError::Corrupt(
            "Global backup SQLite integrity_check returned an invalid result".into(),
        ));
    }
    let mut foreign_keys = database.prepare("PRAGMA foreign_key_check")?;
    if foreign_keys.step()? == SQLITE_ROW {
        return Err(StoreError::Corrupt(
            "Global backup SQLite foreign_key_check failed".into(),
        ));
    }
    Ok(())
}

fn validate_state_shape(state: &Value) -> Result<(), StoreError> {
    let object = state
        .as_object()
        .ok_or_else(|| StoreError::Corrupt("Global backup state must be an object".into()))?;
    for field in [
        "projects",
        "items",
        "notes",
        "statuses",
        "relationships",
        "associations",
        "status_history",
        "imported_history",
    ] {
        if !object.get(field).is_some_and(Value::is_array) {
            return Err(StoreError::Corrupt(format!(
                "Global backup state field {field} must be an array"
            )));
        }
    }
    if object
        .get("note_links")
        .is_some_and(|value| !value.is_array())
    {
        return Err(StoreError::Corrupt(
            "Global backup state field note_links must be an array".into(),
        ));
    }
    Ok(())
}

fn validate_operations_and_audit(database: &SqliteStore, revision: u64) -> Result<(), StoreError> {
    let operation_count = row_count(database, "global_operation")?;
    let audit_count = row_count(database, "global_audit")?;
    if operation_count != revision || audit_count != revision {
        return Err(StoreError::Corrupt(
            "Global operation and audit counts do not match the database revision".into(),
        ));
    }

    let mut rows = database.prepare(
        r#"SELECT o.revision,o.operation_id,o.request_digest,o.result_json,
                  a.revision,a.operation_id,a.request_digest,a.command,a.before_digest,a.after_digest,a.created_at
           FROM global_operation o LEFT JOIN global_audit a ON a.operation_id=o.operation_id
           ORDER BY o.revision"#,
    )?;
    let mut expected_revision = 1_u64;
    while rows.step()? == SQLITE_ROW {
        let operation_revision = rows.column_u64(0)?;
        let operation_id = rows.column_text(1)?;
        let request_digest = rows.column_text(2)?;
        let result_json = rows.column_text(3)?;
        let audit_revision = rows.column_optional_i64(4)?.ok_or_else(|| {
            StoreError::Corrupt("Global operation is missing its audit event".into())
        })?;
        let audit_operation_id = rows.column_optional_text(5)?.ok_or_else(|| {
            StoreError::Corrupt("Global operation is missing its audit identity".into())
        })?;
        let audit_request_digest = rows.column_optional_text(6)?.ok_or_else(|| {
            StoreError::Corrupt("Global operation is missing its audit digest".into())
        })?;
        let command = rows.column_optional_text(7)?.ok_or_else(|| {
            StoreError::Corrupt("Global operation is missing its audit command".into())
        })?;
        let before_digest = rows.column_optional_text(8)?.ok_or_else(|| {
            StoreError::Corrupt("Global operation is missing its audit before digest".into())
        })?;
        let after_digest = rows.column_optional_text(9)?.ok_or_else(|| {
            StoreError::Corrupt("Global operation is missing its audit after digest".into())
        })?;
        let created_at = rows.column_optional_text(10)?.ok_or_else(|| {
            StoreError::Corrupt("Global operation is missing its audit timestamp".into())
        })?;
        if operation_revision != expected_revision
            || audit_revision != operation_revision
            || audit_operation_id != operation_id
            || audit_request_digest != request_digest
            || command.trim().is_empty()
            || before_digest.trim().is_empty()
            || after_digest.trim().is_empty()
            || created_at.trim().is_empty()
        {
            return Err(StoreError::Corrupt(
                "Global operation and audit history is inconsistent".into(),
            ));
        }
        if operation_id.trim().is_empty() || request_digest.trim().is_empty() {
            return Err(StoreError::Corrupt(
                "Global operation identity or digest is empty".into(),
            ));
        }
        serde_json::from_str::<Value>(&result_json).map_err(|error| {
            StoreError::Corrupt(format!("Global operation result JSON is invalid: {error}"))
        })?;
        expected_revision = expected_revision
            .checked_add(1)
            .ok_or_else(|| StoreError::Corrupt("Global operation revision overflow".into()))?;
    }
    if expected_revision != revision.saturating_add(1) {
        return Err(StoreError::Corrupt(
            "Global operation revisions are not contiguous".into(),
        ));
    }
    Ok(())
}

fn validate_revision_history(
    database: &SqliteStore,
    revision: u64,
    current_state: &Value,
) -> Result<(), StoreError> {
    let mut rows = database
        .prepare("SELECT revision,state_json FROM global_revision_snapshot ORDER BY revision")?;
    let mut expected_revision = 0_u64;
    let mut current_revision_present = false;
    while rows.step()? == SQLITE_ROW {
        let history_revision = rows.column_u64(0)?;
        let history_json = rows.column_text(1)?;
        if history_revision != expected_revision || history_revision > revision {
            return Err(StoreError::Corrupt(
                "Global revision history is not contiguous".into(),
            ));
        }
        let history_state: Value = serde_json::from_str(&history_json).map_err(|error| {
            StoreError::Corrupt(format!("Global revision history JSON is invalid: {error}"))
        })?;
        validate_state_shape(&history_state)?;
        if history_revision == revision {
            current_revision_present = true;
            if &history_state != current_state {
                return Err(StoreError::Corrupt(
                    "Global current revision snapshot differs from current state".into(),
                ));
            }
        }
        expected_revision = expected_revision
            .checked_add(1)
            .ok_or_else(|| StoreError::Corrupt("Global history revision overflow".into()))?;
    }
    let minimum_history_count = revision.max(1);
    if expected_revision < minimum_history_count
        || expected_revision > revision.saturating_add(1)
        || (revision == 0 && !current_revision_present)
    {
        return Err(StoreError::Corrupt(
            "Global revision history does not cover the committed revision range".into(),
        ));
    }
    Ok(())
}

fn row_count(database: &SqliteStore, table: &str) -> Result<u64, StoreError> {
    // All call sites use constants above, never user-controlled identifiers.
    let mut query = database.prepare(&format!("SELECT COUNT(*) FROM {table}"))?;
    if query.step()? != SQLITE_ROW {
        return Err(StoreError::Corrupt(format!(
            "Global backup {table} row count returned no result"
        )));
    }
    query.column_u64(0)
}

fn table_exists(database: &SqliteStore, table: &str) -> Result<bool, StoreError> {
    let mut query =
        database.prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1")?;
    query.bind_text(1, table)?;
    if query.step()? != SQLITE_ROW {
        return Err(StoreError::Corrupt(
            "Global backup table inspection returned no result".into(),
        ));
    }
    Ok(query.column_u64(0)? == 1)
}

fn read_manifest(path: &Path) -> Result<Value, StoreError> {
    let metadata = fs::metadata(path).map_err(|error| {
        StoreError::Unavailable(format!(
            "cannot inspect Global backup manifest {}: {error}",
            path.display()
        ))
    })?;
    if !metadata.is_file() || metadata.len() > MAX_MANIFEST_BYTES {
        return Err(StoreError::Invalid(
            "Global backup manifest is not a bounded regular file".into(),
        ));
    }
    let bytes = fs::read(path).map_err(|error| {
        StoreError::Unavailable(format!(
            "cannot read Global backup manifest {}: {error}",
            path.display()
        ))
    })?;
    serde_json::from_slice(&bytes).map_err(|error| {
        StoreError::Corrupt(format!("Global backup manifest JSON is invalid: {error}"))
    })
}

fn write_manifest(path: &Path, document: &Value) -> Result<(), StoreError> {
    let encoded = serde_json::to_vec_pretty(document).map_err(|error| {
        StoreError::Invalid(format!("cannot encode Global backup manifest: {error}"))
    })?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| {
            StoreError::Unavailable(format!(
                "cannot create Global backup manifest {}: {error}",
                path.display()
            ))
        })?;
    file.write_all(&encoded).map_err(|error| {
        StoreError::Unavailable(format!(
            "cannot write Global backup manifest {}: {error}",
            path.display()
        ))
    })?;
    file.sync_all().map_err(|error| {
        StoreError::Unavailable(format!(
            "cannot sync Global backup manifest {}: {error}",
            path.display()
        ))
    })
}

fn ensure_package_destination(path: &Path) -> Result<(), StoreError> {
    if path == Path::new(":memory:") || path.file_name().is_none() {
        return Err(StoreError::Invalid(
            "Global backup destination must name a package directory".into(),
        ));
    }
    reject_symlink(path)?;
    if path.exists() {
        return Err(StoreError::Conflict(format!(
            "Global backup package destination already exists: {}",
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
            "Global backup path must not be a symlink: {}",
            path.display()
        )));
    }
    Ok(())
}

fn staging_path(destination: &Path) -> Result<PathBuf, StoreError> {
    let file_name = destination
        .file_name()
        .ok_or_else(|| StoreError::Invalid("Global backup path must name a directory".into()))?
        .to_string_lossy();
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| StoreError::Unavailable(format!("system clock unavailable: {error}")))?
        .as_nanos();
    let staging = nonempty_parent(destination).join(format!(
        ".{file_name}.global-backup.{}.{}.tmp",
        std::process::id(),
        timestamp
    ));
    if staging.exists() {
        return Err(StoreError::Conflict(format!(
            "Global backup staging path already exists: {}",
            staging.display()
        )));
    }
    Ok(staging)
}

fn nonempty_parent(path: &Path) -> &Path {
    path.parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or(Path::new("."))
}

fn append_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut value = path.as_os_str().to_os_string();
    value.push(suffix);
    PathBuf::from(value)
}

fn is_database_id(value: &str) -> bool {
    value.len() == 32
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn is_sha256_digest(value: &str) -> bool {
    value.strip_prefix("sha256:").is_some_and(|hex| {
        hex.len() == 64
            && hex
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    })
}
