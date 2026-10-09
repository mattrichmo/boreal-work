//! Independent installation-wide global-manager persistence.
//!
//! A single serialized state row keeps this extension's unrelated record
//! families in one atomic revision boundary. Operation receipts and audit
//! events are separate append-only tables and commit with each state update.

use super::global_maintenance::GlobalMaintenanceGuard;
use super::{SqliteStore, StoreError, SQLITE_ROW};
use serde_json::{json, Value};
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static GLOBAL_PACKAGE_COUNTER: AtomicU64 = AtomicU64::new(0);
const GLOBAL_BACKUP_MANIFEST: &str = "manifest.json";
const GLOBAL_BACKUP_DATABASE: &str = "global.sqlite";
const GLOBAL_BACKUP_KIND: &str = "boreal.global.backup";
const GLOBAL_BACKUP_FORMAT: u64 = 1;
// Schema 1 is the only predecessor supported by this recovery bridge. A
// future schema transition must first publish a bridge from the immediately
// previous supported version; unknown and too-old schemas are never guessed.
const MIN_GLOBAL_BRIDGE_SCHEMA: u64 = 1;
const CURRENT_GLOBAL_SCHEMA: u64 = 2;
const GLOBAL_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS global_manager_state (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  state_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS global_operation (
  operation_id TEXT PRIMARY KEY,
  request_digest TEXT NOT NULL,
  revision INTEGER NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS global_revision_snapshot (
  revision INTEGER PRIMARY KEY,
  state_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS global_audit (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  revision INTEGER NOT NULL UNIQUE,
  operation_id TEXT NOT NULL,
  command TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  before_digest TEXT NOT NULL,
  after_digest TEXT NOT NULL,
  created_at TEXT NOT NULL
);
"#;

const EMPTY_STATE: &str = r#"{"projects":[],"items":[],"notes":[],"statuses":[{"project_id":null,"status_id":"todo","label":"To do","category":"open","position":0},{"project_id":null,"status_id":"doing","label":"Doing","category":"active","position":1},{"project_id":null,"status_id":"waiting","label":"Waiting","category":"waiting","position":2},{"project_id":null,"status_id":"blocked","label":"Blocked","category":"blocked","position":3},{"project_id":null,"status_id":"done","label":"Done","category":"completed","position":4},{"project_id":null,"status_id":"cancelled","label":"Cancelled","category":"cancelled","position":5}],"relationships":[],"note_links":[],"associations":[],"status_history":[],"imported_history":[]}"#;

/// A connection to the separate installation-wide SQLite database.
pub struct GlobalManagerStore {
    inner: SqliteStore,
    _admission: Option<GlobalMaintenanceGuard>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct GlobalBackupPackageReport {
    pub package_path: PathBuf,
    pub database_path: PathBuf,
    pub manifest_path: PathBuf,
    pub database_id: String,
    pub schema_version: u64,
    pub revision: u64,
    pub byte_count: u64,
    pub database_checksum: String,
    pub manifest_checksum: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct GlobalRestoreReport {
    pub package_path: PathBuf,
    pub database_path: PathBuf,
    pub previous_database_path: Option<PathBuf>,
    pub source_database_id: String,
    pub source_revision: u64,
    pub current_database_id: String,
    pub current_revision: u64,
    pub manifest_checksum: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GlobalDatabaseInspection {
    pub database_id: String,
    pub schema_version: u64,
    pub revision: u64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct GlobalAuditRecord {
    pub operation_id: String,
    pub revision: u64,
    pub command: String,
    pub created_at: String,
    pub request_digest: String,
    pub result: Value,
}

impl GlobalManagerStore {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, StoreError> {
        let path: std::path::PathBuf = path.as_ref().to_path_buf();
        let discovered_schema = database_schema_version(&path)?;
        if let Some(found) = discovered_schema
            .filter(|version| !(MIN_GLOBAL_BRIDGE_SCHEMA..=CURRENT_GLOBAL_SCHEMA).contains(version))
        {
            return Err(StoreError::Invalid(format!(
                "Global schema {found} is outside the supported recovery bridge; database was left unchanged"
            )));
        }
        // A schema transition is a database-wide maintenance operation. Take
        // exclusive admission before creating the recovery package or
        // running the migration, then downgrade the same OS lock for the
        // returned store so there is no replacement race between the two.
        if database_schema_version(&path)? == Some(1) {
            let mut admission =
                GlobalMaintenanceGuard::try_exclusive(&path, "global-schema-v1-to-v2")?;
            let current_schema = database_schema_version(&path)?;
            if let Some(found) = current_schema.filter(|version| {
                !(MIN_GLOBAL_BRIDGE_SCHEMA..=CURRENT_GLOBAL_SCHEMA).contains(version)
            }) {
                return Err(StoreError::Invalid(format!(
                    "Global schema {found} is outside the supported recovery bridge; database was left unchanged"
                )));
            }
            if current_schema == Some(1) {
                Self::ensure_pre_migration_backup(&path)?;
                let mut store = Self::open_once(&path)?;
                admission.downgrade_to_shared()?;
                store._admission = Some(admission);
                return Ok(store);
            }
        }
        let admission = GlobalMaintenanceGuard::try_shared(&path)?;
        if let Some(found) = database_schema_version(&path)?
            .filter(|version| !(MIN_GLOBAL_BRIDGE_SCHEMA..=CURRENT_GLOBAL_SCHEMA).contains(version))
        {
            return Err(StoreError::Invalid(format!(
                "Global schema {found} is outside the supported recovery bridge; database was left unchanged"
            )));
        }
        let started = std::time::Instant::now();
        loop {
            match Self::open_once(&path) {
                Ok(mut store) => {
                    store._admission = Some(admission);
                    return Ok(store);
                }
                Err(StoreError::Busy(_))
                    if started.elapsed() < std::time::Duration::from_secs(5) =>
                {
                    std::thread::sleep(std::time::Duration::from_millis(25))
                }
                Err(error) => return Err(error),
            }
        }
    }

    fn ensure_pre_migration_backup(path: &Path) -> Result<(), StoreError> {
        let source = Self::open_snapshot(path)?;
        let metadata = source.validate_invariants()?;
        if metadata.schema_version != 1 {
            return Ok(());
        }
        let parent = path.parent().unwrap_or(Path::new("."));
        let recovery_base = parent.join(".boreal-recovery");
        ensure_private_directory(&recovery_base)?;
        let recovery_root = recovery_base.join("global-migrations");
        ensure_private_directory(&recovery_root)?;
        let destination = recovery_root.join(format!(
            "schema-{}-{}-revision-{}",
            metadata.schema_version,
            safe_filename_component(&metadata.database_id),
            metadata.revision
        ));
        if destination.exists() {
            let (manifest, _) = Self::validate_backup_package(&destination)?;
            if manifest["schema"]["version"].as_u64() != Some(metadata.schema_version)
                || manifest["database_id"].as_str() != Some(metadata.database_id.as_str())
                || manifest["revision"].as_u64() != Some(metadata.revision)
            {
                return Err(StoreError::Conflict(
                    "existing pre-migration Global recovery package does not match the source database".into(),
                ));
            }
            return Ok(());
        }
        source.backup_package_to(destination)?;
        Ok(())
    }

    /// Back up an existing Global database without opening it through the
    /// schema migration path. This is used by installers before first-open
    /// migrations. Ordinary application backup continues to use its open
    /// store and the same package validator.
    pub fn backup_database_package_to(
        database_path: impl AsRef<Path>,
        destination: impl AsRef<Path>,
    ) -> Result<GlobalBackupPackageReport, StoreError> {
        let database_path = database_path.as_ref();
        reject_package_symlink(database_path)?;
        if !database_path.is_file() {
            return Err(StoreError::NotFound {
                entity: "Global database".into(),
                id: database_path.display().to_string(),
            });
        }
        let _admission = GlobalMaintenanceGuard::try_shared(database_path)?;
        let snapshot = Self::open_snapshot(database_path)?;
        snapshot.backup_package_to(destination)
    }

    pub fn inspect_backup_package(
        package_path: impl AsRef<Path>,
    ) -> Result<GlobalBackupPackageReport, StoreError> {
        let package_path = package_path.as_ref();
        let (manifest, manifest_checksum) = Self::validate_backup_package(package_path)?;
        let package_path = fs::canonicalize(package_path).map_err(|error| {
            StoreError::Unavailable(format!("cannot resolve Global backup package: {error}"))
        })?;
        Ok(GlobalBackupPackageReport {
            database_path: package_path.join(GLOBAL_BACKUP_DATABASE),
            manifest_path: package_path.join(GLOBAL_BACKUP_MANIFEST),
            package_path,
            database_id: manifest["database_id"]
                .as_str()
                .unwrap_or_default()
                .to_owned(),
            schema_version: manifest["schema"]["version"].as_u64().unwrap_or_default(),
            revision: manifest["revision"].as_u64().unwrap_or_default(),
            byte_count: manifest["database"]["byte_count"]
                .as_u64()
                .unwrap_or_default(),
            database_checksum: manifest["database"]["sha256"]
                .as_str()
                .unwrap_or_default()
                .to_owned(),
            manifest_checksum,
        })
    }

    /// Read a Global schema identity and its invariant report without
    /// triggering any schema migration.
    pub fn inspect_database(
        database_path: impl AsRef<Path>,
    ) -> Result<GlobalDatabaseInspection, StoreError> {
        let database_path = database_path.as_ref();
        reject_package_symlink(database_path)?;
        if !database_path.is_file() {
            return Err(StoreError::NotFound {
                entity: "Global database".into(),
                id: database_path.display().to_string(),
            });
        }
        let _admission = GlobalMaintenanceGuard::try_shared(database_path)?;
        let snapshot = Self::open_snapshot(database_path)?;
        let metadata = snapshot.validate_invariants()?;
        Ok(GlobalDatabaseInspection {
            database_id: metadata.database_id,
            schema_version: metadata.schema_version,
            revision: metadata.revision,
        })
    }

    fn open_once(path: impl AsRef<Path>) -> Result<Self, StoreError> {
        let path: std::path::PathBuf = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                StoreError::Unavailable(format!("cannot create global data directory: {e}"))
            })?;
        }
        let inner = open_connection_with_retry(&path)?;
        let mut objects = inner.prepare(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
        )?;
        if objects.step()? != SQLITE_ROW {
            return Err(StoreError::Corrupt(
                "global schema inspection returned no row".into(),
            ));
        }
        let count = objects.column_i64(0)?;
        drop(objects);
        if count == 0 {
            inner.execute_batch("BEGIN IMMEDIATE")?;
            let mut now_has_objects = inner.prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")?;
            now_has_objects.step()?;
            let appeared = now_has_objects.column_i64(0)? > 0;
            drop(now_has_objects);
            if appeared {
                inner.execute_batch("ROLLBACK")?;
                return Self::open(path);
            }
            let setup = (|| {
                inner.execute_batch("CREATE TABLE global_schema(singleton INTEGER PRIMARY KEY CHECK(singleton=1),schema_id TEXT NOT NULL,schema_version INTEGER NOT NULL,database_id TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0);")?;
                inner.execute_batch(GLOBAL_SCHEMA)?;
                let mut q = inner.prepare("INSERT INTO global_schema VALUES(1,'boreal.global',2,lower(hex(randomblob(16))),0)")?;
                q.run()?;
                let mut q = inner.prepare("INSERT INTO global_manager_state VALUES(1,?1)")?;
                q.bind_text(1, EMPTY_STATE)?;
                q.run()?;
                let mut q =
                    inner.prepare("INSERT INTO global_revision_snapshot VALUES(0,?1,?2)")?;
                q.bind_text(1, EMPTY_STATE)?;
                q.bind_text(2, &now())?;
                q.run()?;
                Ok::<_, StoreError>(())
            })();
            match setup {
                Ok(()) => inner.execute_batch("COMMIT")?,
                Err(e) => {
                    let _ = inner.execute_batch("ROLLBACK");
                    return Err(e);
                }
            }
        } else {
            let mut identity = inner
                .prepare("SELECT schema_id,schema_version FROM global_schema WHERE singleton=1")?;
            if identity.step()? != SQLITE_ROW {
                return Err(StoreError::Invalid(
                    "database is not a supported Boreal global database; it was left unchanged"
                        .into(),
                ));
            }
            let schema_id = identity.column_text(0)?;
            let version = identity.column_i64(1)?;
            drop(identity);
            if schema_id != "boreal.global"
                || version < MIN_GLOBAL_BRIDGE_SCHEMA as i64
                || version > CURRENT_GLOBAL_SCHEMA as i64
            {
                return Err(StoreError::Invalid(
                    "database is not a supported Boreal global database; it was left unchanged"
                        .into(),
                ));
            }
            inner.execute_batch("BEGIN IMMEDIATE")?;
            let setup = (|| {
                inner.execute_batch(GLOBAL_SCHEMA)?;
                let mut exists = inner.prepare("SELECT COUNT(*) FROM global_manager_state")?;
                exists.step()?;
                let state_exists = exists.column_i64(0)? != 0;
                drop(exists);
                if !state_exists {
                    let legacy = migrate_legacy_state(&inner)?;
                    let encoded = serde_json::to_string(&legacy)
                        .map_err(|e| StoreError::Corrupt(e.to_string()))?;
                    let mut insert =
                        inner.prepare("INSERT INTO global_manager_state VALUES(1,?1)")?;
                    insert.bind_text(1, &encoded)?;
                    insert.run()?;
                }
                let mut current=inner.prepare("SELECT revision,state_json FROM global_schema CROSS JOIN global_manager_state WHERE global_schema.singleton=1 AND global_manager_state.singleton=1")?;
                current.step()?;
                let current_revision = current.column_u64(0)?;
                let current_state = current.column_text(1)?;
                drop(current);
                let mut history = inner
                    .prepare("INSERT OR IGNORE INTO global_revision_snapshot VALUES(?1,?2,?3)")?;
                history.bind_i64(1, current_revision)?;
                history.bind_text(2, &current_state)?;
                history.bind_text(3, &now())?;
                history.run()?;
                let mut version_update =
                    inner.prepare("UPDATE global_schema SET schema_version=2 WHERE singleton=1")?;
                version_update.run()?;
                Ok::<_, StoreError>(())
            })();
            match setup {
                Ok(()) => inner.execute_batch("COMMIT")?,
                Err(e) => {
                    let _ = inner.execute_batch("ROLLBACK");
                    return Err(e);
                }
            }
        }
        Ok(Self {
            inner,
            _admission: None,
        })
    }

    pub fn revision(&self) -> Result<u64, StoreError> {
        self.scalar("SELECT revision FROM global_schema WHERE singleton=1")
    }

    /// Create a validated, private physical SQLite backup package. This uses
    /// SQLite's online backup API, so a Global database in WAL mode is copied
    /// from a coherent snapshot while ordinary writers remain admitted.
    pub fn backup_package_to(
        &self,
        destination: impl AsRef<Path>,
    ) -> Result<GlobalBackupPackageReport, StoreError> {
        self.inner.database_path().ok_or_else(|| {
            StoreError::Invalid("Global physical backups require a persistent database".into())
        })?;
        let destination = destination.as_ref();
        ensure_package_destination(destination)?;
        let parent = destination.parent().unwrap_or(Path::new("."));
        fs::create_dir_all(parent).map_err(|error| {
            StoreError::Unavailable(format!(
                "cannot create Global backup parent {}: {error}",
                parent.display()
            ))
        })?;
        self.validate_invariants()?;
        let staging = unique_package_staging(destination)?;
        create_private_dir(&staging)?;
        let result = (|| {
            let database_path = staging.join(GLOBAL_BACKUP_DATABASE);
            self.inner.backup_to(&database_path)?;
            set_private_file_permissions(&database_path)?;
            sync_file(&database_path)?;
            let snapshot = Self::open_snapshot(&database_path)?;
            let metadata = snapshot.validate_invariants()?;
            let bytes = fs::read(&database_path).map_err(|error| {
                StoreError::Unavailable(format!(
                    "cannot read Global backup database {}: {error}",
                    database_path.display()
                ))
            })?;
            let database_checksum = super::checksum(&bytes);
            let manifest = json!({
                "kind": GLOBAL_BACKUP_KIND,
                "format_version": GLOBAL_BACKUP_FORMAT,
                "schema": {"id": "boreal.global", "version": metadata.schema_version},
                "database_id": metadata.database_id,
                "revision": metadata.revision,
                "database": {
                    "file": GLOBAL_BACKUP_DATABASE,
                    "byte_count": bytes.len() as u64,
                    "sha256": database_checksum,
                },
                "producer": {"package": "boreal-store", "version": env!("CARGO_PKG_VERSION")},
                "sqlite_runtime": super::sqlite_runtime_identity().as_json(),
                "private_data": true,
                "contains_revision_history": true,
            });
            let manifest_path = staging.join(GLOBAL_BACKUP_MANIFEST);
            let manifest_bytes = serde_json::to_vec_pretty(&manifest).map_err(|error| {
                StoreError::Corrupt(format!("cannot encode Global backup manifest: {error}"))
            })?;
            write_private_file(&manifest_path, &manifest_bytes)?;
            drop(snapshot);
            let (checked_manifest, manifest_checksum) = Self::validate_backup_package(&staging)?;
            let _ = checked_manifest;
            sync_directory(&staging)?;
            fs::rename(&staging, destination).map_err(|error| {
                StoreError::Unavailable(format!(
                    "cannot publish Global backup package {}: {error}",
                    destination.display()
                ))
            })?;
            sync_directory(parent)?;
            Ok(GlobalBackupPackageReport {
                package_path: destination.to_path_buf(),
                database_path: destination.join(GLOBAL_BACKUP_DATABASE),
                manifest_path: destination.join(GLOBAL_BACKUP_MANIFEST),
                database_id: metadata.database_id,
                schema_version: metadata.schema_version,
                revision: metadata.revision,
                byte_count: bytes.len() as u64,
                database_checksum,
                manifest_checksum,
            })
        })();
        if result.is_err() {
            let _ = fs::remove_dir_all(&staging);
        }
        result
    }

    /// Restore a validated Global package while holding exclusive OS
    /// admission. The source identity is retained as provenance; the active
    /// database receives a fresh physical identity. The prior database is
    /// retained beside the active file and an atomic journal makes activation
    /// resumable after interruption.
    pub fn restore_package_to(
        database_path: impl AsRef<Path>,
        package_path: impl AsRef<Path>,
        operation_id: &str,
    ) -> Result<GlobalRestoreReport, StoreError> {
        Self::restore_package_to_with_hook(
            database_path.as_ref(),
            package_path.as_ref(),
            operation_id,
            |_| Ok(()),
        )
    }

    fn restore_package_to_with_hook<F>(
        database_path: &Path,
        package_path: &Path,
        operation_id: &str,
        after_sqlite_quiescence: F,
    ) -> Result<GlobalRestoreReport, StoreError>
    where
        F: FnOnce(&Path) -> Result<(), StoreError>,
    {
        reject_package_symlink(database_path)?;
        let _maintenance = GlobalMaintenanceGuard::try_exclusive(database_path, operation_id)?;
        let initial_active_metadata = if database_path.exists() {
            Some(Self::open_snapshot(database_path)?.validate_invariants()?)
        } else {
            None
        };
        let (manifest, manifest_checksum) = Self::validate_backup_package(package_path)?;
        let parent = database_path.parent().unwrap_or(Path::new("."));
        fs::create_dir_all(parent).map_err(|error| {
            StoreError::Unavailable(format!(
                "cannot create Global restore parent {}: {error}",
                parent.display()
            ))
        })?;
        let package_path = fs::canonicalize(package_path).map_err(|error| {
            StoreError::Unavailable(format!("cannot resolve Global restore package: {error}"))
        })?;
        let database_path = absolute_path(database_path)?;
        let source_database_id = manifest["database_id"]
            .as_str()
            .ok_or_else(|| StoreError::Corrupt("Global backup database_id is missing".into()))?
            .to_owned();
        let source_revision = manifest["revision"]
            .as_u64()
            .ok_or_else(|| StoreError::Corrupt("Global backup revision is missing".into()))?;
        let digest = manifest["database"]["sha256"]
            .as_str()
            .ok_or_else(|| StoreError::Corrupt("Global backup digest is missing".into()))?
            .to_owned();
        let operation_hash = super::checksum(operation_id.as_bytes()).replace(':', "-");
        let stage_dir = parent.join(format!(".global-restore-{operation_hash}"));
        let stage_database = stage_dir.join(GLOBAL_BACKUP_DATABASE);
        let previous_database = parent.join(format!("global.sqlite.pre-restore-{operation_hash}"));
        let journal_path = parent.join(".global-restore.json");
        let mut journal = read_or_create_restore_journal(
            &journal_path,
            operation_id,
            &package_path,
            &database_path,
            &stage_dir,
            &previous_database,
            &source_database_id,
            source_revision,
            &digest,
        )?;
        let active_id = journal["active_database_id"]
            .as_str()
            .ok_or_else(|| {
                StoreError::Corrupt("Global restore journal has no active identity".into())
            })?
            .to_owned();
        if journal["stage"].as_str() == Some("complete") && database_path.exists() {
            let active = Self::open_snapshot(&database_path)?;
            let metadata = active.validate_invariants()?;
            if metadata.database_id == active_id {
                return Ok(GlobalRestoreReport {
                    package_path,
                    database_path,
                    previous_database_path: previous_database.exists().then_some(previous_database),
                    source_database_id,
                    source_revision,
                    current_database_id: active_id,
                    current_revision: metadata.revision,
                    manifest_checksum,
                });
            }
        }

        if !stage_dir.exists() {
            create_private_dir(&stage_dir)?;
        } else if !stage_dir.is_dir() {
            return Err(StoreError::Conflict(
                "Global restore staging path is not a directory".into(),
            ));
        }
        if !stage_database.exists() {
            fs::copy(package_path.join(GLOBAL_BACKUP_DATABASE), &stage_database).map_err(
                |error| {
                    StoreError::Unavailable(format!(
                        "cannot stage Global restore database: {error}"
                    ))
                },
            )?;
            set_private_file_permissions(&stage_database)?;
            sync_file(&stage_database)?;
        }
        let staged = Self::open_snapshot_rw(&stage_database)?;
        let staged_metadata = staged.validate_invariants()?;
        if staged_metadata.database_id == source_database_id {
            staged.inner.execute_batch("BEGIN IMMEDIATE")?;
            let update = (|| {
                let mut set_identity = staged
                    .inner
                    .prepare("UPDATE global_schema SET database_id=?1 WHERE singleton=1")?;
                set_identity.bind_text(1, &active_id)?;
                set_identity.run()?;
                Ok::<_, StoreError>(())
            })();
            if let Err(error) = update {
                let _ = staged.inner.execute_batch("ROLLBACK");
                return Err(error);
            }
            staged.inner.execute_batch("COMMIT")?;
        } else if staged_metadata.database_id != active_id {
            return Err(StoreError::Conflict(
                "staged Global restore identity does not match its recovery journal".into(),
            ));
        }
        checkpoint_for_activation(&staged.inner)?;
        drop(staged);
        journal["stage"] = json!("staged");
        write_json_atomic(&journal_path, &journal)?;

        let mut prior_database_guard = None;
        if database_path.exists() && !previous_database.exists() {
            let current_metadata = Self::open_snapshot(&database_path)?.validate_invariants()?;
            if current_metadata.database_id == active_id {
                // An earlier activation completed before its journal update.
                // Keep the already-active restore in place on replay.
            } else {
                let expected = initial_active_metadata.as_ref().ok_or_else(|| {
                    StoreError::Busy(
                        "Global database appeared while restore was being prepared".into(),
                    )
                })?;
                if &current_metadata != expected {
                    return Err(StoreError::Busy(
                        "Global database changed while restore was being prepared; retry after the writer completes".into(),
                    ));
                }
                let live = checkpoint_file_for_activation(&database_path)?;
                let locked_metadata = live.validate_invariants()?;
                if &locked_metadata != expected {
                    return Err(StoreError::Busy(
                        "Global database changed during restore quiescence; retry after the writer completes".into(),
                    ));
                }
                after_sqlite_quiescence(&database_path)?;
                fs::rename(&database_path, &previous_database).map_err(|error| {
                    StoreError::Unavailable(format!(
                        "cannot retain previous Global database {}: {error}",
                        previous_database.display()
                    ))
                })?;
                sync_directory(parent)?;
                journal["stage"] = json!("previous_retained");
                write_json_atomic(&journal_path, &journal)?;
                prior_database_guard = Some(live);
            }
        } else if database_path.exists() {
            let current_metadata = Self::open_snapshot(&database_path)?.validate_invariants()?;
            if current_metadata.database_id != active_id {
                return Err(StoreError::Conflict(
                    "an unexpected Global database occupies the restore destination".into(),
                ));
            }
        } else if initial_active_metadata.is_some() && !previous_database.exists() {
            return Err(StoreError::Busy(
                "Global database disappeared while restore was being prepared".into(),
            ));
        }

        if !database_path.exists() {
            activate_staged_database_without_replacing(&stage_database, &database_path)?;
            sync_directory(parent)?;
        }
        let activated = Self::open_snapshot(&database_path)?;
        let activated_metadata = activated.validate_invariants()?;
        if activated_metadata.database_id != active_id {
            return Err(StoreError::Conflict(
                "activated Global database identity does not match its restore journal".into(),
            ));
        }
        drop(activated);
        drop(prior_database_guard);
        journal["stage"] = json!("complete");
        write_json_atomic(&journal_path, &journal)?;
        let _ = fs::remove_dir_all(&stage_dir);
        Ok(GlobalRestoreReport {
            package_path,
            database_path,
            previous_database_path: previous_database.exists().then_some(previous_database),
            source_database_id,
            source_revision,
            current_database_id: active_id,
            current_revision: activated_metadata.revision,
            manifest_checksum,
        })
    }

    fn open_snapshot(path: &Path) -> Result<Self, StoreError> {
        let inner = SqliteStore::open_connection(path, super::SQLITE_OPEN_READONLY)?;
        Ok(Self {
            inner,
            _admission: None,
        })
    }

    fn open_snapshot_rw(path: &Path) -> Result<Self, StoreError> {
        let inner = SqliteStore::open_connection(path, super::SQLITE_OPEN_READWRITE)?;
        Ok(Self {
            inner,
            _admission: None,
        })
    }

    fn validate_invariants(&self) -> Result<GlobalDatabaseMetadata, StoreError> {
        let mut integrity = self.inner.prepare("PRAGMA quick_check(1)")?;
        if integrity.step()? != SQLITE_ROW || integrity.column_text(0)? != "ok" {
            return Err(StoreError::Corrupt(
                "Global database failed SQLite quick_check".into(),
            ));
        }
        drop(integrity);
        let mut schema = self.inner.prepare(
            "SELECT schema_id,schema_version,database_id,revision FROM global_schema WHERE singleton=1",
        )?;
        if schema.step()? != SQLITE_ROW {
            return Err(StoreError::Corrupt(
                "Global schema singleton is missing".into(),
            ));
        }
        let schema_id = schema.column_text(0)?;
        let schema_version = schema.column_u64(1)?;
        let database_id = schema.column_text(2)?;
        let revision = schema.column_u64(3)?;
        if schema_id != "boreal.global"
            || !(MIN_GLOBAL_BRIDGE_SCHEMA..=CURRENT_GLOBAL_SCHEMA).contains(&schema_version)
            || database_id.trim().is_empty()
        {
            return Err(StoreError::Conflict(
                "Global database schema identity is unsupported".into(),
            ));
        }
        drop(schema);
        // Schema 1 predates the current singleton state, revision-history,
        // operation and audit tables. It is still a supported recovery
        // source, but receives the checks available before that contract was
        // introduced: SQLite integrity and its canonical identity row.
        if schema_version == 1 {
            return Ok(GlobalDatabaseMetadata {
                schema_version,
                database_id,
                revision,
            });
        }
        let state = self.load_state()?;
        let object = state
            .as_object()
            .ok_or_else(|| StoreError::Corrupt("Global state is not an object".into()))?;
        for key in [
            "projects",
            "items",
            "notes",
            "statuses",
            "relationships",
            "note_links",
            "associations",
            "status_history",
            "imported_history",
        ] {
            if !object.get(key).is_some_and(Value::is_array) {
                return Err(StoreError::Corrupt(format!(
                    "Global state field {key} is not an array"
                )));
            }
        }
        let mut snapshots = self.inner.prepare(
            "SELECT revision,state_json FROM global_revision_snapshot ORDER BY revision",
        )?;
        while snapshots.step()? == SQLITE_ROW {
            if snapshots.column_u64(0)? > revision {
                return Err(StoreError::Corrupt(
                    "Global revision history is ahead of the active revision".into(),
                ));
            }
            let value: Value =
                serde_json::from_str(&snapshots.column_text(1)?).map_err(|error| {
                    StoreError::Corrupt(format!("Global revision snapshot is invalid: {error}"))
                })?;
            if !value.is_object() {
                return Err(StoreError::Corrupt(
                    "Global revision snapshot is not an object".into(),
                ));
            }
        }
        drop(snapshots);
        let mut audit = self.inner.prepare(
            "SELECT (SELECT COUNT(*) FROM global_operation), (SELECT COUNT(*) FROM global_audit),\
                    (SELECT COUNT(*) FROM global_operation o LEFT JOIN global_audit a ON a.operation_id=o.operation_id WHERE a.operation_id IS NULL),\
                    (SELECT COUNT(*) FROM global_audit a LEFT JOIN global_operation o ON o.operation_id=a.operation_id WHERE o.operation_id IS NULL),\
                    (SELECT COUNT(*) FROM global_audit WHERE revision>?1)",
        )?;
        audit.bind_i64(1, revision)?;
        if audit.step()? != SQLITE_ROW
            || audit.column_u64(0)? != audit.column_u64(1)?
            || audit.column_u64(2)? != 0
            || audit.column_u64(3)? != 0
            || audit.column_u64(4)? != 0
        {
            return Err(StoreError::Corrupt(
                "Global operation, audit, or revision history is inconsistent".into(),
            ));
        }
        Ok(GlobalDatabaseMetadata {
            schema_version,
            database_id,
            revision,
        })
    }

    fn validate_backup_package(package: &Path) -> Result<(Value, String), StoreError> {
        reject_package_symlink(package)?;
        if !package.is_dir() {
            return Err(StoreError::Invalid(
                "Global backup package must be a directory".into(),
            ));
        }
        let manifest_path = package.join(GLOBAL_BACKUP_MANIFEST);
        let database_path = package.join(GLOBAL_BACKUP_DATABASE);
        reject_package_symlink(&manifest_path)?;
        reject_package_symlink(&database_path)?;
        let manifest_bytes = fs::read(&manifest_path).map_err(|error| {
            StoreError::Unavailable(format!("cannot read Global backup manifest: {error}"))
        })?;
        let manifest: Value = serde_json::from_slice(&manifest_bytes).map_err(|error| {
            StoreError::Corrupt(format!("Global backup manifest is invalid: {error}"))
        })?;
        if manifest["kind"].as_str() != Some(GLOBAL_BACKUP_KIND)
            || manifest["format_version"].as_u64() != Some(GLOBAL_BACKUP_FORMAT)
            || manifest["schema"]["id"].as_str() != Some("boreal.global")
            || manifest["database"]["file"].as_str() != Some(GLOBAL_BACKUP_DATABASE)
            || manifest["private_data"].as_bool() != Some(true)
            || manifest["contains_revision_history"].as_bool() != Some(true)
        {
            return Err(StoreError::Conflict(
                "Global backup package identity is unsupported".into(),
            ));
        }
        let bytes = fs::read(&database_path).map_err(|error| {
            StoreError::Unavailable(format!("cannot read Global backup database: {error}"))
        })?;
        let actual_digest = super::checksum(&bytes);
        if manifest["database"]["byte_count"].as_u64() != Some(bytes.len() as u64)
            || manifest["database"]["sha256"].as_str() != Some(actual_digest.as_str())
        {
            return Err(StoreError::Conflict(
                "Global backup database size or checksum does not match its manifest".into(),
            ));
        }
        let snapshot = Self::open_snapshot(&database_path)?;
        let metadata = snapshot.validate_invariants()?;
        if manifest["schema"]["version"].as_u64() != Some(metadata.schema_version)
            || manifest["database_id"].as_str() != Some(metadata.database_id.as_str())
            || manifest["revision"].as_u64() != Some(metadata.revision)
        {
            return Err(StoreError::Conflict(
                "Global backup manifest does not describe its database".into(),
            ));
        }
        drop(snapshot);
        Ok((manifest, super::checksum(&manifest_bytes)))
    }

    /// Reads the serialized global snapshot. Decoding and selecting application
    /// views belongs to the application layer.
    pub fn state(&self) -> Result<Value, StoreError> {
        self.load_state()
    }

    /// Revision snapshots deliberately remain lossless and unpruned. Their
    /// storage grows with state size times mutation count; any retention change
    /// must first provide an independently verified, restorable archival path.
    /// This helper reports serialized history bytes for operational measurement.
    pub fn revision_history_bytes(&self) -> Result<u64, StoreError> {
        let mut query = self.inner.prepare(
            "SELECT COALESCE(SUM(length(CAST(state_json AS BLOB))),0) FROM global_revision_snapshot",
        )?;
        if query.step()? != SQLITE_ROW {
            return Err(StoreError::Corrupt(
                "global revision history size returned no row".into(),
            ));
        }
        query.column_u64(0)
    }

    /// Returns state and revision from one SQLite statement snapshot.
    pub fn snapshot(&self) -> Result<(Value, u64), StoreError> {
        let mut q = self.inner.prepare("SELECT s.state_json,g.revision FROM global_manager_state s CROSS JOIN global_schema g WHERE s.singleton=1 AND g.singleton=1")?;
        if q.step()? != SQLITE_ROW {
            return Err(StoreError::Corrupt(
                "global snapshot rows are missing".into(),
            ));
        }
        let mut state = serde_json::from_str(&q.column_text(0)?)
            .map_err(|e| StoreError::Corrupt(e.to_string()))?;
        ensure_compatible_state(&mut state)?;
        let revision = q.column_u64(1)?;
        Ok((state, revision))
    }

    pub fn revision_history(&self) -> Result<Vec<Value>, StoreError> {
        let mut q = self.inner.prepare(
            "SELECT revision,state_json,created_at FROM global_revision_snapshot ORDER BY revision",
        )?;
        let mut history = Vec::new();
        while q.step()? == SQLITE_ROW {
            let mut state = serde_json::from_str::<Value>(&q.column_text(1)?)
                .map_err(|e| StoreError::Corrupt(e.to_string()))?;
            ensure_compatible_state(&mut state)?;
            history.push(json!({"revision":q.column_u64(0)?,"snapshot":state,"created_at":q.column_text(2)?}));
        }
        Ok(history)
    }

    pub fn export_bundle(&self) -> Result<(Value, u64, Vec<Value>), StoreError> {
        self.inner.execute_batch("BEGIN")?;
        let bundle = (|| {
            let (state, revision) = self.snapshot()?;
            let history = self.revision_history()?;
            Ok((state, revision, history))
        })();
        match bundle {
            Ok(value) => {
                self.inner.execute_batch("COMMIT")?;
                Ok(value)
            }
            Err(error) => {
                let _ = self.inner.execute_batch("ROLLBACK");
                Err(error)
            }
        }
    }

    pub fn operation_result(&self, operation_id: &str) -> Result<Option<Value>, StoreError> {
        let mut q=self.inner.prepare("SELECT request_digest,revision,result_json,created_at FROM global_operation WHERE operation_id=?1")?;
        q.bind_text(1, operation_id)?;
        if q.step()? != SQLITE_ROW {
            return Ok(None);
        }
        let result = serde_json::from_str::<Value>(&q.column_text(2)?)
            .map_err(|e| StoreError::Corrupt(e.to_string()))?;
        Ok(Some(
            json!({"operation_id":operation_id,"request_digest":q.column_text(0)?,"revision":q.column_u64(1)?,"result":result,"created_at":q.column_text(3)?}),
        ))
    }

    /// Returns the prior result for an idempotency key, rejecting reuse with
    /// a different request before application policy checks can mask replay.
    pub fn replay_result(
        &self,
        command: &str,
        payload: &Value,
        operation_id: &str,
    ) -> Result<Option<Value>, StoreError> {
        if operation_id.trim().is_empty() {
            return Err(StoreError::Invalid("operation id is required".into()));
        }
        let digest = request_digest(command, payload);
        match self.operation(operation_id)? {
            Some((old_digest, result)) if old_digest == digest => Ok(Some(result)),
            Some(_) => Err(StoreError::Conflict(
                "operation id was already used with different input".into(),
            )),
            None => Ok(None),
        }
    }

    /// Returns a bounded page of committed operations with their result
    /// payloads. Full revision snapshots remain available only through the
    /// explicit backup/export bundle.
    pub fn activity(
        &self,
        project_id: Option<&str>,
        entity_id: Option<&str>,
        limit: u64,
        offset: u64,
    ) -> Result<(Vec<GlobalAuditRecord>, u64), StoreError> {
        if !(1..=200).contains(&limit) {
            return Err(StoreError::Invalid(
                "global activity limit must be from 1 to 200".into(),
            ));
        }
        let filters = " WHERE (?1 IS NULL OR COALESCE(json_extract(o.result_json,'$.project_id'),json_extract(o.result_json,'$.id'))=?1) AND (?2 IS NULL OR json_extract(o.result_json,'$.id')=?2 OR json_extract(o.result_json,'$.item_id')=?2 OR json_extract(o.result_json,'$.note_id')=?2 OR json_extract(o.result_json,'$.source_id')=?2 OR json_extract(o.result_json,'$.target_id')=?2)";
        let mut count = self.inner.prepare(&format!(
            "SELECT COUNT(*) FROM global_audit a JOIN global_operation o USING(operation_id){filters}"
        ))?;
        count.bind_optional_text(1, project_id)?;
        count.bind_optional_text(2, entity_id)?;
        if count.step()? != SQLITE_ROW {
            return Err(StoreError::Corrupt(
                "global activity count returned no row".into(),
            ));
        }
        let total = count.column_u64(0)?;
        drop(count);
        let mut rows = self.inner.prepare(&format!(
            "SELECT a.operation_id,a.revision,a.command,a.created_at,o.request_digest,o.result_json FROM global_audit a JOIN global_operation o USING(operation_id){filters} ORDER BY a.revision DESC LIMIT ?3 OFFSET ?4"
        ))?;
        rows.bind_optional_text(1, project_id)?;
        rows.bind_optional_text(2, entity_id)?;
        rows.bind_i64(3, limit)?;
        rows.bind_i64(4, offset)?;
        let mut records = Vec::new();
        while rows.step()? == SQLITE_ROW {
            records.push(GlobalAuditRecord {
                operation_id: rows.column_text(0)?,
                revision: rows.column_u64(1)?,
                command: rows.column_text(2)?,
                created_at: rows.column_text(3)?,
                request_digest: rows.column_text(4)?,
                result: serde_json::from_str(&rows.column_text(5)?)
                    .map_err(|error| StoreError::Corrupt(error.to_string()))?,
            });
        }
        Ok((records, total))
    }

    /// Reads the activity page, total and current revision from one SQLite
    /// read transaction so concurrent mutations cannot make them disagree.
    pub fn activity_snapshot(
        &self,
        project_id: Option<&str>,
        entity_id: Option<&str>,
        limit: u64,
        offset: u64,
    ) -> Result<(Vec<GlobalAuditRecord>, u64, u64), StoreError> {
        self.inner.execute_batch("BEGIN")?;
        let result = (|| {
            let (rows, total) = self.activity(project_id, entity_id, limit, offset)?;
            let revision = self.revision()?;
            Ok((rows, total, revision))
        })();
        match result {
            Ok(value) => {
                self.inner.execute_batch("COMMIT")?;
                Ok(value)
            }
            Err(error) => {
                let _ = self.inner.execute_batch("ROLLBACK");
                Err(error)
            }
        }
    }

    /// Runs one application-supplied state transition inside the global write
    /// boundary. The closure must be pure and must not perform external I/O.
    pub fn mutate<F>(
        &self,
        command: &str,
        payload: &Value,
        operation: &str,
        transition: F,
    ) -> Result<Value, StoreError>
    where
        F: FnOnce(Value, u64) -> Result<(Value, Value), StoreError>,
    {
        if operation.trim().is_empty() {
            return Err(StoreError::Invalid("operation id is required".into()));
        }
        let digest = request_digest(command, payload);
        self.inner.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| {
            if let Some((old_digest, result)) = self.operation(operation)? {
                if old_digest != digest {
                    return Err(StoreError::Conflict(
                        "operation id was already used with different input".into(),
                    ));
                }
                return Ok(result);
            }
            let expected = payload.get("expected_revision").and_then(Value::as_u64);
            let revision = self.revision()?;
            if let Some(expected) = expected {
                if revision != expected {
                    return Err(StoreError::StaleRevision {
                        expected,
                        actual: revision,
                    });
                }
            }
            let before = self.load_state()?;
            let next = revision
                .checked_add(1)
                .ok_or_else(|| StoreError::Corrupt("global revision overflow".into()))?;
            let (state, value) = transition(before.clone(), next)?;
            let before_json =
                serde_json::to_string(&before).map_err(|e| StoreError::Corrupt(e.to_string()))?;
            let mut history = self
                .inner
                .prepare("INSERT OR IGNORE INTO global_revision_snapshot VALUES(?1,?2,?3)")?;
            history.bind_i64(1, revision)?;
            history.bind_text(2, &before_json)?;
            history.bind_text(3, &now())?;
            history.run()?;
            let encoded =
                serde_json::to_string(&state).map_err(|e| StoreError::Corrupt(e.to_string()))?;
            let mut update = self
                .inner
                .prepare("UPDATE global_manager_state SET state_json=?1 WHERE singleton=1")?;
            update.bind_text(1, &encoded)?;
            update.run()?;
            let mut bump = self
                .inner
                .prepare("UPDATE global_schema SET revision=?1 WHERE singleton=1")?;
            bump.bind_i64(1, next)?;
            bump.run()?;
            let result = with_revision(value, next);
            let result_json =
                serde_json::to_string(&result).map_err(|e| StoreError::Corrupt(e.to_string()))?;
            let now = now();
            let mut audit=self.inner.prepare("INSERT INTO global_audit(revision,operation_id,command,request_digest,before_digest,after_digest,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7)")?;
            audit.bind_i64(1, next)?;
            audit.bind_text(2, operation)?;
            audit.bind_text(3, command)?;
            audit.bind_text(4, &digest)?;
            audit.bind_text(5, &request_digest("snapshot", &before))?;
            audit.bind_text(6, &request_digest("snapshot", &state))?;
            audit.bind_text(7, &now)?;
            audit.run()?;
            let mut receipt=self.inner.prepare("INSERT INTO global_operation(operation_id,request_digest,revision,result_json,created_at) VALUES(?1,?2,?3,?4,?5)")?;
            receipt.bind_text(1, operation)?;
            receipt.bind_text(2, &digest)?;
            receipt.bind_i64(3, next)?;
            receipt.bind_text(4, &result_json)?;
            receipt.bind_text(5, &now)?;
            receipt.run()?;
            Ok(result)
        })();
        match result {
            Ok(value) => {
                self.inner.execute_batch("COMMIT")?;
                Ok(value)
            }
            Err(error) => {
                let _ = self.inner.execute_batch("ROLLBACK");
                Err(error)
            }
        }
    }

    fn load_state(&self) -> Result<Value, StoreError> {
        let mut q = self
            .inner
            .prepare("SELECT state_json FROM global_manager_state WHERE singleton=1")?;
        if q.step()? != SQLITE_ROW {
            return Err(StoreError::Corrupt(
                "global manager state row is missing".into(),
            ));
        }
        let mut state = serde_json::from_str(&q.column_text(0)?)
            .map_err(|e| StoreError::Corrupt(format!("global manager state is invalid: {e}")))?;
        ensure_compatible_state(&mut state)?;
        Ok(state)
    }

    fn operation(&self, id: &str) -> Result<Option<(String, Value)>, StoreError> {
        let mut q = self.inner.prepare(
            "SELECT request_digest,result_json FROM global_operation WHERE operation_id=?1",
        )?;
        q.bind_text(1, id)?;
        if q.step()? != SQLITE_ROW {
            return Ok(None);
        }
        let digest = q.column_text(0)?;
        let result = serde_json::from_str(&q.column_text(1)?)
            .map_err(|e| StoreError::Corrupt(e.to_string()))?;
        Ok(Some((digest, result)))
    }
    fn scalar(&self, sql: &str) -> Result<u64, StoreError> {
        let mut q = self.inner.prepare(sql)?;
        if q.step()? != SQLITE_ROW {
            return Err(StoreError::Corrupt(
                "global scalar query returned no row".into(),
            ));
        }
        q.column_u64(0)
    }
}

fn migrate_legacy_state(db: &SqliteStore) -> Result<Value, StoreError> {
    let mut state = serde_json::from_str::<Value>(EMPTY_STATE).unwrap();
    // Version-one experimental tables are retained and copied into the
    // canonical snapshot so an upgrade does not discard existing records.
    if table_exists(db, "management_project")? {
        let mut q=db.prepare("SELECT project_id,name,description,archived,created_at,updated_at FROM management_project ORDER BY project_id")?;
        while q.step()? == SQLITE_ROW {
            state["projects"].as_array_mut().unwrap().push(json!({"id":q.column_text(0)?,"name":q.column_text(1)?,"description":q.column_text(2)?,"labels":[],"priority":0,"lifecycle":"planned","health":"unknown","archived":q.column_bool(3)?,"created_at":q.column_text(4)?,"updated_at":q.column_text(5)?}));
        }
    }
    if table_exists(db, "management_item")? {
        let mut q=db.prepare("SELECT item_id,project_id,parent_id,title,details,status,priority,due_at,archived,created_at,updated_at,position FROM management_item ORDER BY item_id")?;
        while q.step()? == SQLITE_ROW {
            let status = q.column_text(5)?;
            state["items"].as_array_mut().unwrap().push(json!({"id":q.column_text(0)?,"project_id":q.column_optional_text(1)?,"parent_id":q.column_optional_text(2)?,"kind":if q.column_optional_text(2)?.is_some(){"subtask"}else{"task"},"title":q.column_text(3)?,"description":q.column_text(4)?,"labels":[],"status_id":status,"priority":q.column_i64(6)?,"due_at":q.column_optional_text(7)?,"archived":q.column_bool(8)?,"created_at":q.column_text(9)?,"updated_at":q.column_text(10)?,"position":q.column_i64(11)?}));
        }
    }
    if table_exists(db, "global_note")? {
        let mut q=db.prepare("SELECT note_id,project_id,title,body,archived,created_at,updated_at FROM global_note ORDER BY note_id")?;
        while q.step()? == SQLITE_ROW {
            state["notes"].as_array_mut().unwrap().push(json!({"id":q.column_text(0)?,"project_id":q.column_optional_text(1)?,"title":q.column_text(2)?,"body":q.column_text(3)?,"archived":q.column_bool(4)?,"created_at":q.column_text(5)?,"updated_at":q.column_text(6)?}));
        }
    }
    if table_exists(db, "project_association")? {
        let mut q=db.prepare("SELECT project_id,kind,identity,path,updated_at FROM project_association ORDER BY project_id,kind,identity")?;
        while q.step()? == SQLITE_ROW {
            state["associations"].as_array_mut().unwrap().push(json!({"project_id":q.column_text(0)?,"kind":q.column_text(1)?,"identity":q.column_text(2)?,"path":q.column_optional_text(3)?,"updated_at":q.column_text(4)?}));
        }
    }
    let project_ids: Vec<String> = state["projects"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|p| p["id"].as_str().map(str::to_owned))
        .collect();
    for pid in project_ids {
        for (sid, label, cat, pos) in [
            ("todo", "To do", "open", 0),
            ("doing", "Doing", "active", 1),
            ("waiting", "Waiting", "waiting", 2),
            ("blocked", "Blocked", "blocked", 3),
            ("done", "Done", "completed", 4),
            ("cancelled", "Cancelled", "cancelled", 5),
        ] {
            state["statuses"].as_array_mut().unwrap().push(json!({"project_id":pid,"status_id":sid,"label":label,"category":cat,"position":pos}));
        }
    }
    let statuses: Vec<(Option<String>, String)> = state["items"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|item| {
            Some((
                item["project_id"].as_str().map(str::to_owned),
                item["status_id"].as_str()?.to_owned(),
            ))
        })
        .collect();
    for (pid, sid) in statuses {
        if state["statuses"].as_array().unwrap().iter().any(|status| {
            status["project_id"].as_str() == pid.as_deref() && status["status_id"] == sid
        }) {
            continue;
        }
        let (category, position) = match sid.as_str() {
            "done" | "complete" | "completed" => ("completed", 4),
            "doing" | "in_progress" | "active" => ("active", 1),
            "waiting" | "waiting_on" => ("waiting", 2),
            "blocked" => ("blocked", 3),
            "cancelled" | "canceled" => ("cancelled", 5),
            _ => ("open", 0),
        };
        state["statuses"].as_array_mut().unwrap().push(json!({"project_id":pid,"status_id":sid,"label":sid,"category":category,"position":position}));
    }
    Ok(state)
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct GlobalDatabaseMetadata {
    schema_version: u64,
    database_id: String,
    revision: u64,
}

fn ensure_package_destination(path: &Path) -> Result<(), StoreError> {
    reject_package_symlink(path)?;
    if path.exists() {
        return Err(StoreError::Conflict(format!(
            "Global backup destination already exists: {}",
            path.display()
        )));
    }
    Ok(())
}

fn database_schema_version(path: &Path) -> Result<Option<u64>, StoreError> {
    if !path.is_file() {
        return Ok(None);
    }
    let inner = SqliteStore::open_connection(path, super::SQLITE_OPEN_READONLY)?;
    let mut objects = inner.prepare(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )?;
    if objects.step()? != SQLITE_ROW {
        return Err(StoreError::Corrupt(
            "Global schema preflight returned no database object count".into(),
        ));
    }
    if objects.column_i64(0)? == 0 {
        return Ok(None);
    }
    drop(objects);
    let has_global_schema = {
        let mut exists = inner.prepare(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='global_schema'",
        )?;
        if exists.step()? != SQLITE_ROW {
            return Err(StoreError::Corrupt(
                "Global schema preflight could not inspect the schema table".into(),
            ));
        }
        exists.column_i64(0)? != 0
    };
    if !has_global_schema {
        return Err(StoreError::Invalid(
            "database has no Global schema identity; it was left unchanged".into(),
        ));
    }
    let mut version =
        inner.prepare("SELECT schema_id,schema_version FROM global_schema WHERE singleton=1")?;
    if version.step()? != SQLITE_ROW {
        return Err(StoreError::Invalid(
            "Global schema identity row is missing; database was left unchanged".into(),
        ));
    }
    let schema_id = version.column_text(0)?;
    let schema_version = version.column_u64(1)?;
    if schema_id != "boreal.global" {
        return Err(StoreError::Invalid(
            "database has an unsupported Global schema identity; it was left unchanged".into(),
        ));
    }
    Ok(Some(schema_version))
}

fn safe_filename_component(value: &str) -> String {
    value
        .chars()
        .take(80)
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '-'
            }
        })
        .collect()
}

fn ensure_private_directory(path: &Path) -> Result<(), StoreError> {
    fs::create_dir_all(path).map_err(|error| {
        StoreError::Unavailable(format!(
            "cannot create private directory {}: {error}",
            path.display()
        ))
    })?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|error| {
            StoreError::Unavailable(format!(
                "cannot secure private directory {}: {error}",
                path.display()
            ))
        })?;
    }
    Ok(())
}

fn reject_package_symlink(path: &Path) -> Result<(), StoreError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() {
                Err(StoreError::Invalid(format!(
                    "Global backup or restore path must not be a symlink: {}",
                    path.display()
                )))
            } else {
                Ok(())
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(StoreError::Unavailable(format!(
            "cannot inspect Global backup or restore path {}: {error}",
            path.display()
        ))),
    }
}

#[cfg(test)]
mod recovery_tests {
    use super::*;

    fn root(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "boreal-global-{}-{}-{}",
            label,
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock after epoch")
                .as_nanos()
        ))
    }

    #[test]
    fn interrupted_restore_after_retaining_previous_database_resumes_same_identity() {
        let root = root("restore-resume");
        fs::create_dir_all(&root).unwrap();
        let database = root.join("global.sqlite");
        let package = root.join("backup");
        let initial = GlobalManagerStore::open(&database).unwrap();
        initial
            .mutate("fixture", &json!({}), "source", |mut state, _| {
                state["projects"] = json!([{"id":"source-project","name":"Source"}]);
                Ok((state, json!({})))
            })
            .unwrap();
        let backup = initial.backup_package_to(&package).unwrap();
        initial
            .mutate("fixture", &json!({}), "active", |mut state, _| {
                state["projects"] = json!([{"id":"active-project","name":"Active"}]);
                Ok((state, json!({})))
            })
            .unwrap();
        drop(initial);

        let operation_id = "restore-interrupted";
        let operation_hash = super::super::checksum(operation_id.as_bytes()).replace(':', "-");
        let stage_dir = root.join(format!(".global-restore-{operation_hash}"));
        let stage_database = stage_dir.join(GLOBAL_BACKUP_DATABASE);
        let previous_database = root.join(format!("global.sqlite.pre-restore-{operation_hash}"));
        let journal_path = root.join(".global-restore.json");
        create_private_dir(&stage_dir).unwrap();
        fs::copy(package.join(GLOBAL_BACKUP_DATABASE), &stage_database).unwrap();

        let mut journal = read_or_create_restore_journal(
            &journal_path,
            operation_id,
            &fs::canonicalize(&package).unwrap(),
            &fs::canonicalize(&root).unwrap().join("global.sqlite"),
            &stage_dir,
            &previous_database,
            &backup.database_id,
            backup.revision,
            &backup.database_checksum,
        )
        .unwrap();
        let active_id = journal["active_database_id"].as_str().unwrap().to_owned();
        let staged = GlobalManagerStore::open_snapshot_rw(&stage_database).unwrap();
        staged.inner.execute_batch("BEGIN IMMEDIATE").unwrap();
        let mut update = staged
            .inner
            .prepare("UPDATE global_schema SET database_id=?1 WHERE singleton=1")
            .unwrap();
        update.bind_text(1, &active_id).unwrap();
        update.run().unwrap();
        drop(update);
        staged.inner.execute_batch("COMMIT").unwrap();
        checkpoint_for_activation(&staged.inner).unwrap();
        drop(staged);

        let previous_guard = checkpoint_file_for_activation(&database).unwrap();
        fs::rename(&database, &previous_database).unwrap();
        sync_directory(&root).unwrap();
        drop(previous_guard);
        journal["stage"] = json!("previous_retained");
        write_json_atomic(&journal_path, &journal).unwrap();

        let conflicting = GlobalManagerStore::restore_package_to(
            &database,
            &package,
            "restore-another-operation",
        )
        .expect_err("a different operation cannot take over an unfinished restore");
        assert!(
            matches!(conflicting, StoreError::Conflict(message) if message.contains("unfinished Global restore"))
        );

        let restored = GlobalManagerStore::restore_package_to(&database, &package, operation_id)
            .expect("recovery should activate the already-staged identity");
        assert_eq!(restored.current_database_id, active_id);
        assert_eq!(restored.source_database_id, backup.database_id);
        assert_eq!(restored.current_revision, backup.revision);
        assert!(previous_database.exists());
        assert_eq!(
            GlobalManagerStore::open(&database)
                .unwrap()
                .state()
                .unwrap()["projects"][0]["id"],
            "source-project"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn legacy_global_writer_cannot_commit_between_checkpoint_and_database_swap() {
        let root = root("legacy-writer-swap-race");
        fs::create_dir_all(&root).unwrap();
        let database = root.join("global.sqlite");
        let package = root.join("backup");

        let store = GlobalManagerStore::open(&database).unwrap();
        store
            .mutate("fixture", &json!({}), "source", |mut state, _| {
                state["projects"] = json!([{"id":"source-project","name":"Source"}]);
                Ok((state, json!({})))
            })
            .unwrap();
        let backup = store.backup_package_to(&package).unwrap();
        store
            .mutate("fixture", &json!({}), "active", |mut state, _| {
                state["projects"] = json!([{"id":"active-project","name":"Active"}]);
                Ok((state, json!({})))
            })
            .unwrap();
        drop(store);

        let restored = GlobalManagerStore::restore_package_to_with_hook(
            &database,
            &package,
            "restore-legacy-writer-race",
            |live_database| {
                let legacy_write = legacy_project_write(live_database, "racing-project");
                assert!(
                    legacy_write.is_err(),
                    "a pre-maintenance Global writer must not commit in the checkpoint-to-swap window"
                );
                Ok(())
            },
        )
        .expect("restore proceeds after SQLite rejects the legacy writer");
        assert_eq!(restored.source_database_id, backup.database_id);
        assert_ne!(restored.current_database_id, backup.database_id);

        let active = GlobalManagerStore::open(&database).unwrap();
        let projects = active.state().unwrap()["projects"].clone();
        assert_eq!(projects[0]["id"], "source-project");
        assert!(!projects
            .as_array()
            .unwrap()
            .iter()
            .any(|project| project["id"] == "racing-project"));
        drop(active);

        let previous = GlobalManagerStore::open(restored.previous_database_path.unwrap()).unwrap();
        let previous_projects = previous.state().unwrap()["projects"].clone();
        assert_eq!(previous_projects[0]["id"], "active-project");
        assert!(!previous_projects
            .as_array()
            .unwrap()
            .iter()
            .any(|project| project["id"] == "racing-project"));
        drop(previous);
        let _ = fs::remove_dir_all(root);
    }

    fn legacy_project_write(database: &Path, project_id: &str) -> Result<(), StoreError> {
        let legacy = SqliteStore::open_connection(
            database,
            super::super::SQLITE_OPEN_READWRITE | super::super::SQLITE_OPEN_CREATE,
        )?;
        legacy.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| {
            let mut query =
                legacy.prepare("SELECT state_json FROM global_manager_state WHERE singleton=1")?;
            if query.step()? != SQLITE_ROW {
                return Err(StoreError::Corrupt(
                    "legacy Global state row is missing".into(),
                ));
            }
            let mut state: Value = serde_json::from_str(&query.column_text(0)?)
                .map_err(|error| StoreError::Corrupt(error.to_string()))?;
            drop(query);
            state["projects"]
                .as_array_mut()
                .ok_or_else(|| StoreError::Corrupt("Global projects are not an array".into()))?
                .push(json!({"id": project_id, "name": project_id}));
            let encoded = serde_json::to_string(&state)
                .map_err(|error| StoreError::Corrupt(error.to_string()))?;
            let mut update = legacy
                .prepare("UPDATE global_manager_state SET state_json=?1 WHERE singleton=1")?;
            update.bind_text(1, &encoded)?;
            update.run()?;
            legacy
                .execute_batch("UPDATE global_schema SET revision=revision+1 WHERE singleton=1")?;
            Ok(())
        })();
        if let Err(error) = result {
            let _ = legacy.execute_batch("ROLLBACK");
            return Err(error);
        }
        legacy.execute_batch("COMMIT")
    }

    #[test]
    fn first_v1_open_publishes_verified_private_recovery_package_before_migration() {
        let root = root("migration-backup");
        fs::create_dir_all(&root).unwrap();
        let database = root.join("global.sqlite");
        let legacy = SqliteStore::open_connection(
            &database,
            super::super::SQLITE_OPEN_READWRITE | super::super::SQLITE_OPEN_CREATE,
        )
        .unwrap();
        legacy
            .execute_batch("CREATE TABLE global_schema(singleton INTEGER PRIMARY KEY CHECK(singleton=1),schema_id TEXT NOT NULL,schema_version INTEGER NOT NULL,database_id TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0); INSERT INTO global_schema VALUES(1,'boreal.global',1,'legacy-id',7);")
            .unwrap();
        drop(legacy);

        let opened = GlobalManagerStore::open(&database)
            .expect("v1 database receives bridge backup before migration");
        assert_eq!(
            GlobalManagerStore::inspect_database(&database)
                .unwrap()
                .schema_version,
            2
        );
        assert_eq!(opened.revision().unwrap(), 7);
        drop(opened);

        let package = root.join(".boreal-recovery/global-migrations/schema-1-legacy-id-revision-7");
        let report = GlobalManagerStore::inspect_backup_package(&package).unwrap();
        assert_eq!(report.schema_version, 1);
        assert_eq!(report.database_id, "legacy-id");
        assert_eq!(report.revision, 7);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&package).unwrap().permissions().mode() & 0o777,
                0o700
            );
            assert_eq!(
                fs::metadata(report.database_path)
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn unsupported_future_schema_is_rejected_without_changing_database_bytes() {
        let root = root("future-schema");
        fs::create_dir_all(&root).unwrap();
        let database = root.join("global.sqlite");
        let unsupported = SqliteStore::open_connection(
            &database,
            super::super::SQLITE_OPEN_READWRITE | super::super::SQLITE_OPEN_CREATE,
        )
        .unwrap();
        unsupported
            .execute_batch("CREATE TABLE global_schema(singleton INTEGER PRIMARY KEY CHECK(singleton=1),schema_id TEXT NOT NULL,schema_version INTEGER NOT NULL,database_id TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0); INSERT INTO global_schema VALUES(1,'boreal.global',3,'future-id',0);")
            .unwrap();
        drop(unsupported);
        let original = fs::read(&database).unwrap();

        let error = GlobalManagerStore::open(&database)
            .err()
            .expect("future schema must fail before writable SQLite open");
        assert!(
            matches!(error, StoreError::Invalid(message) if message.contains("left unchanged"))
        );
        assert_eq!(fs::read(&database).unwrap(), original);
        let _ = fs::remove_dir_all(root);
    }
}

fn unique_package_staging(destination: &Path) -> Result<PathBuf, StoreError> {
    let name = destination
        .file_name()
        .ok_or_else(|| StoreError::Invalid("Global backup path must name a directory".into()))?
        .to_string_lossy();
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| StoreError::Unavailable(format!("system clock unavailable: {error}")))?
        .as_nanos();
    let sequence = GLOBAL_PACKAGE_COUNTER.fetch_add(1, Ordering::Relaxed);
    Ok(destination.parent().unwrap_or(Path::new(".")).join(format!(
        ".{name}.global-backup.{}.{}.{}.tmp",
        std::process::id(),
        stamp,
        sequence
    )))
}

fn create_private_dir(path: &Path) -> Result<(), StoreError> {
    let mut builder = fs::DirBuilder::new();
    builder.recursive(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(path).map_err(|error| {
        StoreError::Unavailable(format!(
            "cannot create private directory {}: {error}",
            path.display()
        ))
    })
}

fn set_private_file_permissions(path: &Path) -> Result<(), StoreError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(|error| {
            StoreError::Unavailable(format!(
                "cannot secure private file {}: {error}",
                path.display()
            ))
        })?;
    }
    Ok(())
}

fn write_private_file(path: &Path, bytes: &[u8]) -> Result<(), StoreError> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path).map_err(|error| {
        StoreError::Unavailable(format!(
            "cannot create private file {}: {error}",
            path.display()
        ))
    })?;
    file.write_all(bytes).map_err(|error| {
        StoreError::Unavailable(format!(
            "cannot write private file {}: {error}",
            path.display()
        ))
    })?;
    file.sync_all().map_err(|error| {
        StoreError::Unavailable(format!(
            "cannot sync private file {}: {error}",
            path.display()
        ))
    })
}

fn write_json_atomic(path: &Path, value: &Value) -> Result<(), StoreError> {
    let parent = path.parent().unwrap_or(Path::new("."));
    let stamp = GLOBAL_PACKAGE_COUNTER.fetch_add(1, Ordering::Relaxed);
    let temp = parent.join(format!(
        ".global-restore-journal.{}.{}.tmp",
        std::process::id(),
        stamp
    ));
    let encoded = serde_json::to_vec_pretty(value).map_err(|error| {
        StoreError::Corrupt(format!("cannot encode Global restore journal: {error}"))
    })?;
    write_private_file(&temp, &encoded)?;
    fs::rename(&temp, path).map_err(|error| {
        let _ = fs::remove_file(&temp);
        StoreError::Unavailable(format!("cannot replace Global restore journal: {error}"))
    })?;
    sync_directory(parent)
}

fn read_or_create_restore_journal(
    path: &Path,
    operation_id: &str,
    package_path: &Path,
    database_path: &Path,
    stage_dir: &Path,
    previous_database: &Path,
    source_database_id: &str,
    source_revision: u64,
    database_digest: &str,
) -> Result<Value, StoreError> {
    reject_package_symlink(path)?;
    if path.exists() {
        let bytes = fs::read(path).map_err(|error| {
            StoreError::Unavailable(format!("cannot read Global restore journal: {error}"))
        })?;
        let current: Value = serde_json::from_slice(&bytes).map_err(|error| {
            StoreError::Corrupt(format!("Global restore journal is invalid: {error}"))
        })?;
        let complete = current["stage"].as_str() == Some("complete");
        let same_operation = current["operation_id"].as_str() == Some(operation_id);
        let same_target = current["package_path"].as_str()
            == Some(package_path.to_string_lossy().as_ref())
            && current["database_path"].as_str() == Some(database_path.to_string_lossy().as_ref())
            && current["database_digest"].as_str() == Some(database_digest);
        if same_target && same_operation {
            return Ok(current);
        }
        if !complete {
            return Err(StoreError::Conflict(
                "an unfinished Global restore must be reconciled before another restore can start"
                    .into(),
            ));
        }
    }
    let journal = json!({
        "kind": "boreal.global.restore",
        "operation_id": operation_id,
        "package_path": package_path,
        "database_path": database_path,
        "staging_directory": stage_dir,
        "previous_database_path": previous_database,
        "source_database_id": source_database_id,
        "source_revision": source_revision,
        "database_digest": database_digest,
        "active_database_id": crate::identity::fresh_database_instance_id().as_str(),
        "stage": "prepared",
    });
    write_json_atomic(path, &journal)?;
    Ok(journal)
}

fn absolute_path(path: &Path) -> Result<PathBuf, StoreError> {
    let parent = path.parent().unwrap_or(Path::new("."));
    let canonical_parent = fs::canonicalize(parent).map_err(|error| {
        StoreError::Unavailable(format!("cannot resolve Global database directory: {error}"))
    })?;
    let name = path
        .file_name()
        .ok_or_else(|| StoreError::Invalid("Global database path must name a file".into()))?;
    Ok(canonical_parent.join(name))
}

fn checkpoint_for_activation(database: &SqliteStore) -> Result<(), StoreError> {
    let mut checkpoint = database.prepare("PRAGMA wal_checkpoint(TRUNCATE)")?;
    if checkpoint.step()? != SQLITE_ROW {
        return Err(StoreError::Corrupt(
            "Global restore checkpoint returned no status".into(),
        ));
    }
    let busy = checkpoint.column_i64(0)?;
    let log_frames = checkpoint.column_i64(1)?;
    let checkpointed_frames = checkpoint.column_i64(2)?;
    drop(checkpoint);
    if busy != 0 || (log_frames >= 0 && checkpointed_frames < log_frames) {
        return Err(StoreError::Busy(
            "Global database has an active SQLite reader or writer".into(),
        ));
    }
    database.execute_batch("PRAGMA journal_mode=DELETE")?;
    if !database.journal_mode()?.eq_ignore_ascii_case("delete") {
        return Err(StoreError::Busy(
            "Global database is still open during restore activation".into(),
        ));
    }
    Ok(())
}

fn checkpoint_file_for_activation(path: &Path) -> Result<GlobalManagerStore, StoreError> {
    let database = GlobalManagerStore {
        inner: SqliteStore::open_connection(path, super::SQLITE_OPEN_READWRITE)?,
        _admission: None,
    };
    checkpoint_for_activation(&database.inner)?;
    // Keep SQLite's exclusive database lock across the filesystem swap. The
    // Global advisory lock is not honored by pre-maintenance binaries.
    database.inner.execute_batch("BEGIN EXCLUSIVE")?;
    if !database
        .inner
        .journal_mode()?
        .eq_ignore_ascii_case("delete")
    {
        return Err(StoreError::Busy(
            "Global journal mode changed during restore quiescence".into(),
        ));
    }
    let file_name = path
        .file_name()
        .ok_or_else(|| StoreError::Invalid("Global database path must name a file".into()))?;
    for suffix in ["-wal", "-shm"] {
        let mut sidecar = file_name.to_os_string();
        sidecar.push(suffix);
        let sidecar = path.parent().unwrap_or(Path::new(".")).join(sidecar);
        match fs::symlink_metadata(&sidecar) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(StoreError::Invalid(
                    "Global restore sidecar must not be a symlink".into(),
                ));
            }
            Ok(metadata) if metadata.len() == 0 => fs::remove_file(&sidecar).map_err(|error| {
                StoreError::Unavailable(format!(
                    "cannot remove empty Global restore sidecar: {error}"
                ))
            })?,
            Ok(_) => {
                return Err(StoreError::Busy(
                    "Global WAL sidecar remains active during restore".into(),
                ))
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(StoreError::Unavailable(format!(
                    "cannot inspect Global restore sidecar: {error}"
                )))
            }
        }
    }
    Ok(database)
}

fn activate_staged_database_without_replacing(
    staged_database: &Path,
    database_path: &Path,
) -> Result<(), StoreError> {
    fs::hard_link(staged_database, database_path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::AlreadyExists {
            StoreError::Busy(
                "Global database appeared during restore activation; it was left untouched".into(),
            )
        } else {
            StoreError::Unavailable(format!(
                "cannot activate staged Global database {}: {error}",
                database_path.display()
            ))
        }
    })?;
    fs::remove_file(staged_database).map_err(|error| {
        StoreError::Unavailable(format!(
            "cannot remove staged Global database link {}: {error}",
            staged_database.display()
        ))
    })
}

fn sync_file(path: &Path) -> Result<(), StoreError> {
    File::open(path)
        .and_then(|file| file.sync_all())
        .map_err(|error| {
            StoreError::Unavailable(format!("cannot sync {}: {error}", path.display()))
        })
}

fn sync_directory(path: &Path) -> Result<(), StoreError> {
    File::open(path)
        .and_then(|file| file.sync_all())
        .map_err(|error| {
            StoreError::Unavailable(format!("cannot sync directory {}: {error}", path.display()))
        })
}

fn table_exists(db: &SqliteStore, name: &str) -> Result<bool, StoreError> {
    let mut q = db.prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1")?;
    q.bind_text(1, name)?;
    q.step()?;
    Ok(q.column_i64(0)? > 0)
}

fn open_connection_with_retry(path: &Path) -> Result<SqliteStore, StoreError> {
    let started = std::time::Instant::now();
    loop {
        match SqliteStore::open_connection(
            path,
            super::SQLITE_OPEN_READWRITE | super::SQLITE_OPEN_CREATE,
        ) {
            Ok(store) => return Ok(store),
            Err(error @ StoreError::Busy(_))
                if started.elapsed() < std::time::Duration::from_secs(5) =>
            {
                std::thread::sleep(std::time::Duration::from_millis(25));
                let _ = error;
            }
            Err(error) => return Err(error),
        }
    }
}

fn request_digest(command: &str, payload: &Value) -> String {
    super::checksum(
        format!(
            "{command}
{payload}"
        )
        .as_bytes(),
    )
}

fn ensure_compatible_state(state: &mut Value) -> Result<(), StoreError> {
    let object = state
        .as_object_mut()
        .ok_or_else(|| StoreError::Corrupt("global manager state must be an object".into()))?;
    match object.get("note_links") {
        None => {
            object.insert("note_links".into(), json!([]));
        }
        Some(Value::Array(_)) => {}
        Some(_) => {
            return Err(StoreError::Corrupt(
                "global manager note_links must be an array".into(),
            ));
        }
    }
    Ok(())
}

fn now() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string()
}
fn with_revision(mut value: Value, revision: u64) -> Value {
    if !value.is_object() {
        value = json!({"value":value});
    }
    value["revision"] = json!(revision);
    value
}
