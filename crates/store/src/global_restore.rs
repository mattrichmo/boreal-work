//! Staged physical restore for the installation-wide Global database.
//!
//! Restore owns the existing Global maintenance admission for the complete
//! activation and readback. All files used to recover an interrupted rename
//! live in the guard's private operation-scoped staging directory.

use super::{
    GlobalBackupInspection, GlobalBackupManifest, GlobalManagerStore, GLOBAL_SCHEMA_ID,
    GLOBAL_SCHEMA_VERSION,
};
use crate::{SqliteStore, StoreError, SQLITE_OPEN_READONLY, SQLITE_ROW};
use serde_json::{json, Value};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

const JOURNAL_FILE: &str = "restore-journal.json";
const JOURNAL_TEMP_FILE: &str = "restore-journal.tmp";
const INCOMING_PACKAGE_DIR: &str = "incoming-package";
const RESTORE_JOURNAL_FORMAT: &str = "boreal.global-restore/1";

/// Durable readback returned by an activated Global restore.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GlobalRestoreReport {
    pub operation_id: String,
    pub database_path: PathBuf,
    pub package_path: PathBuf,
    pub source_database_id: String,
    pub database_id: String,
    pub revision: u64,
    pub previous_database_path: Option<PathBuf>,
    pub idempotent_readback: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct DatabaseIdentity {
    schema_id: String,
    schema_version: u64,
    database_id: String,
    revision: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct RestoreJournal {
    operation_id: String,
    database_path: PathBuf,
    package_path: PathBuf,
    source_database_id: String,
    source_revision: u64,
    source_checksum: String,
    target_database_id: String,
    previous_database_id: Option<String>,
    previous_revision: Option<u64>,
    phase: String,
}

impl RestoreJournal {
    fn as_json(&self) -> Value {
        json!({
            "format": RESTORE_JOURNAL_FORMAT,
            "operation_id": self.operation_id,
            "database_path": self.database_path.to_string_lossy(),
            "package_path": self.package_path.to_string_lossy(),
            "source_database_id": self.source_database_id,
            "source_revision": self.source_revision,
            "source_checksum": self.source_checksum,
            "target_database_id": self.target_database_id,
            "previous_database_id": self.previous_database_id,
            "previous_revision": self.previous_revision,
            "phase": self.phase,
        })
    }

    fn parse(bytes: &[u8]) -> Result<Self, StoreError> {
        let value: Value = serde_json::from_slice(bytes).map_err(|error| {
            StoreError::Corrupt(format!("Global restore journal JSON is invalid: {error}"))
        })?;
        let field = |name: &str| -> Result<&str, StoreError> {
            value
                .get(name)
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    StoreError::Corrupt(format!("Global restore journal {name} is missing"))
                })
        };
        if field("format")? != RESTORE_JOURNAL_FORMAT {
            return Err(StoreError::Corrupt(
                "Global restore journal format is unsupported".into(),
            ));
        }
        let optional_id = match value.get("previous_database_id") {
            None | Some(Value::Null) => None,
            Some(Value::String(id)) if !id.is_empty() => Some(id.clone()),
            Some(_) => {
                return Err(StoreError::Corrupt(
                    "Global restore journal previous_database_id is invalid".into(),
                ));
            }
        };
        let optional_revision = match value.get("previous_revision") {
            None | Some(Value::Null) => None,
            Some(Value::Number(revision)) => Some(revision.as_u64().ok_or_else(|| {
                StoreError::Corrupt("Global restore journal previous_revision is invalid".into())
            })?),
            Some(_) => {
                return Err(StoreError::Corrupt(
                    "Global restore journal previous_revision is invalid".into(),
                ));
            }
        };
        if optional_id.is_some() != optional_revision.is_some() {
            return Err(StoreError::Corrupt(
                "Global restore journal previous identity is incomplete".into(),
            ));
        }
        let journal = Self {
            operation_id: field("operation_id")?.to_owned(),
            database_path: PathBuf::from(field("database_path")?),
            package_path: PathBuf::from(field("package_path")?),
            source_database_id: field("source_database_id")?.to_owned(),
            source_revision: value
                .get("source_revision")
                .and_then(Value::as_u64)
                .ok_or_else(|| {
                    StoreError::Corrupt("Global restore journal source_revision is invalid".into())
                })?,
            source_checksum: field("source_checksum")?.to_owned(),
            target_database_id: field("target_database_id")?.to_owned(),
            previous_database_id: optional_id,
            previous_revision: optional_revision,
            phase: field("phase")?.to_owned(),
        };
        if !matches!(
            journal.phase.as_str(),
            "intent" | "staged_ready" | "previous_retained" | "activated" | "committed"
        ) || !is_database_id(&journal.source_database_id)
            || !is_database_id(&journal.target_database_id)
            || journal.source_database_id == journal.target_database_id
            || journal
                .previous_database_id
                .as_deref()
                .is_some_and(|id| !is_database_id(id))
            || journal.previous_database_id.as_deref() == Some(journal.target_database_id.as_str())
            || !is_sha256_digest(&journal.source_checksum)
        {
            return Err(StoreError::Corrupt(
                "Global restore journal contains invalid identity or phase data".into(),
            ));
        }
        Ok(journal)
    }
}

/// Restores a validated physical backup while the matching exclusive Global
/// maintenance guard is held. The package is validated again here so its
/// bytes and manifest cannot drift between application preflight and staging.
pub fn restore_global_backup_package(
    database_path: impl AsRef<Path>,
    package_path: impl AsRef<Path>,
    operation_id: &str,
    guard: &super::GlobalMaintenanceGuard,
) -> Result<GlobalRestoreReport, StoreError> {
    restore_global_backup_package_with_interruption(
        database_path.as_ref(),
        package_path.as_ref(),
        operation_id,
        guard,
        false,
    )
}

fn restore_global_backup_package_with_interruption(
    requested_database_path: &Path,
    requested_package_path: &Path,
    operation_id: &str,
    guard: &super::GlobalMaintenanceGuard,
    interrupt_after_activation: bool,
) -> Result<GlobalRestoreReport, StoreError> {
    validate_operation_id(operation_id)?;
    if guard.operation_id().as_deref() != Some(operation_id) {
        return Err(StoreError::Invalid(
            "Global restore operation ID does not match maintenance owner".into(),
        ));
    }
    let database_path = canonical_database_path(requested_database_path)?;
    if !guard.is_exclusive_for(&database_path) {
        return Err(StoreError::Invalid(
            "Global restore requires exclusive admission for the active database".into(),
        ));
    }

    // Validate the caller's package before opening or changing the active DB.
    let inspection = super::inspect_global_backup_package(requested_package_path)?;
    let package_path = fs::canonicalize(&inspection.package_path).map_err(|error| {
        StoreError::Unavailable(format!(
            "cannot resolve Global backup package {}: {error}",
            inspection.package_path.display()
        ))
    })?;
    let expected_package = RestorePackageIdentity::from_inspection(&inspection, package_path)?;

    reject_symlink_if_present(&database_path, "Global database")?;
    let staged_database_path = guard.staging_database_path()?;
    let operation_root = staged_database_path.parent().ok_or_else(|| {
        StoreError::Invalid("Global restore staging path has no operation directory".into())
    })?;
    let journal_path = operation_root.join(JOURNAL_FILE);
    let journal_temp_path = operation_root.join(JOURNAL_TEMP_FILE);
    let previous_path = operation_root.join("previous.sqlite");
    let incoming_path = operation_root.join(INCOMING_PACKAGE_DIR);
    reject_symlink_if_present(operation_root, "Global restore operation directory")?;
    reject_symlink_if_present(&journal_path, "Global restore journal")?;
    reject_symlink_if_present(&journal_temp_path, "Global restore journal temporary file")?;
    reject_symlink_if_present(&previous_path, "retained previous Global database")?;
    reject_symlink_if_present(&incoming_path, "Global restore incoming package")?;
    reject_sqlite_sidecars(&staged_database_path)?;

    let mut journal = if path_present(&journal_path)? {
        let journal = read_journal(&journal_path)?;
        if journal.operation_id != operation_id
            || journal.database_path != database_path
            || journal.package_path != expected_package.package_path
            || journal.source_database_id != expected_package.manifest.database_id
            || journal.source_revision != expected_package.manifest.revision
            || journal.source_checksum != expected_package.manifest.database_checksum
        {
            return Err(StoreError::Conflict(
                "Global restore operation ID is already bound to another package or database"
                    .into(),
            ));
        }
        if path_present(&journal_temp_path)? {
            fs::remove_file(&journal_temp_path).map_err(|error| {
                io_unavailable(
                    "cannot remove stale Global restore journal temporary file",
                    error,
                )
            })?;
        }
        journal
    } else {
        // A journal is durable before any staging or retention side effect.
        // Therefore leftovers without one cannot be trusted as an interrupted
        // activation and are preserved for operator inspection.
        if path_present(&staged_database_path)?
            || path_present(&previous_path)?
            || path_present(&incoming_path)?
        {
            return Err(StoreError::Conflict(
                "Global restore has unjournaled operation files; no files were changed".into(),
            ));
        }
        if path_present(&journal_temp_path)? {
            fs::remove_file(&journal_temp_path).map_err(|error| {
                io_unavailable("cannot remove incomplete Global restore journal", error)
            })?;
        }
        let previous = match read_database_identity_if_present(&database_path)? {
            Some(identity) => Some(identity),
            None => {
                ensure_no_sqlite_sidecars(&database_path)?;
                None
            }
        };
        let target_database_id = fresh_database_id(
            &expected_package.manifest.database_id,
            previous
                .as_ref()
                .map(|identity| identity.database_id.as_str()),
        )?;
        let journal = RestoreJournal {
            operation_id: operation_id.to_owned(),
            database_path: database_path.clone(),
            package_path: expected_package.package_path.clone(),
            source_database_id: expected_package.manifest.database_id.clone(),
            source_revision: expected_package.manifest.revision,
            source_checksum: expected_package.manifest.database_checksum.clone(),
            target_database_id,
            previous_database_id: previous
                .as_ref()
                .map(|identity| identity.database_id.clone()),
            previous_revision: previous.as_ref().map(|identity| identity.revision),
            phase: "intent".into(),
        };
        write_journal(&journal_path, &journal, true)?;
        journal
    };

    // The target may already be live if a prior process stopped after rename.
    if let Some(active) = read_database_identity_if_present(&database_path)? {
        if active.database_id == journal.target_database_id {
            if matches!(journal.phase.as_str(), "intent" | "staged_ready") {
                return Err(StoreError::Conflict(
                    "Global restore activated before its durable admission phase; outcome is uncertain".into(),
                ));
            }
            return finish_activated_restore(
                &database_path,
                &expected_package,
                &journal_path,
                &mut journal,
                guard,
                true,
            );
        }
        if journal.phase == "activated" || journal.phase == "committed" {
            return Err(StoreError::Conflict(
                "Global restore journal says activated but active database identity differs".into(),
            ));
        }
        if journal.previous_database_id.as_deref() != Some(active.database_id.as_str())
            || journal.previous_revision != Some(active.revision)
        {
            return Err(StoreError::Conflict(
                "Global database changed after restore admission; active data was left untouched"
                    .into(),
            ));
        }
    } else if journal.previous_database_id.is_some() {
        return Err(StoreError::Conflict(
            "Global database disappeared during restore; retained data was left untouched".into(),
        ));
    }

    if journal.phase == "intent" {
        stage_validated_package(
            &expected_package,
            &staged_database_path,
            &incoming_path,
            &journal.target_database_id,
            guard,
        )?;
        journal.phase = "staged_ready".into();
        write_journal(&journal_path, &journal, false)?;
    } else if journal.phase == "staged_ready" || journal.phase == "previous_retained" {
        verify_staged_database(
            &staged_database_path,
            &journal.target_database_id,
            &expected_package,
        )?;
    } else {
        return Err(StoreError::Corrupt(
            "Global restore journal phase cannot be resumed".into(),
        ));
    }

    if journal.phase == "staged_ready" {
        retain_previous_database(&database_path, &previous_path, &journal)?;
        journal.phase = "previous_retained".into();
        write_journal(&journal_path, &journal, false)?;
    } else {
        verify_previous_database(&previous_path, &journal)?;
    }

    prepare_active_database_for_atomic_replace(&database_path, &journal)?;
    verify_staged_database(
        &staged_database_path,
        &journal.target_database_id,
        &expected_package,
    )?;
    activate_staged_database(&staged_database_path, &database_path)?;
    sync_directory(operation_root)?;
    sync_directory(
        database_path
            .parent()
            .expect("canonical database has parent"),
    )?;

    if interrupt_after_activation {
        return Err(StoreError::Unavailable(
            "simulated interruption after Global restore activation".into(),
        ));
    }
    journal.phase = "activated".into();
    write_journal(&journal_path, &journal, false)?;
    finish_activated_restore(
        &database_path,
        &expected_package,
        &journal_path,
        &mut journal,
        guard,
        false,
    )
}

#[derive(Clone)]
struct RestorePackageIdentity {
    package_path: PathBuf,
    manifest: GlobalBackupManifest,
    inspection: GlobalBackupInspection,
    snapshot: Value,
    history: Vec<Value>,
}

impl RestorePackageIdentity {
    fn from_inspection(
        inspection: &GlobalBackupInspection,
        package_path: PathBuf,
    ) -> Result<Self, StoreError> {
        let database =
            SqliteStore::open_connection(&inspection.database_path, SQLITE_OPEN_READONLY)?;
        let (snapshot, _, history) = read_snapshot_and_history(&database)?;
        Ok(Self {
            package_path,
            manifest: inspection.manifest.clone(),
            inspection: inspection.clone(),
            snapshot,
            history,
        })
    }
}

fn stage_validated_package(
    package: &RestorePackageIdentity,
    staged_database_path: &Path,
    incoming_path: &Path,
    target_database_id: &str,
    guard: &super::GlobalMaintenanceGuard,
) -> Result<(), StoreError> {
    // The durable journal is already at `intent`, so any stage files here are
    // incomplete non-live work from an interrupted copy. Rebuild that exact
    // operation's stage from the revalidated package.
    if path_present(incoming_path)? {
        reject_symlink_if_present(incoming_path, "Global restore incoming package")?;
        fs::remove_dir_all(incoming_path).map_err(|error| {
            io_unavailable("cannot clear interrupted Global package staging", error)
        })?;
    }
    if path_present(staged_database_path)? {
        reject_symlink_if_present(staged_database_path, "staged Global database")?;
        fs::remove_file(staged_database_path).map_err(|error| {
            io_unavailable("cannot clear interrupted staged Global database", error)
        })?;
    }
    remove_sqlite_sidecars(staged_database_path)?;
    fs::create_dir(incoming_path).map_err(|error| {
        io_unavailable(
            "cannot create private Global restore package staging directory",
            error,
        )
    })?;
    set_private_directory_permissions(incoming_path)?;
    let incoming_database = incoming_path.join("database.sqlite");
    let incoming_manifest = incoming_path.join("manifest.json");
    fs::copy(&package.inspection.database_path, &incoming_database)
        .map_err(|error| io_unavailable("cannot stage Global backup database", error))?;
    fs::copy(&package.inspection.manifest_path, &incoming_manifest)
        .map_err(|error| io_unavailable("cannot stage Global backup manifest", error))?;
    set_private_file_permissions(&incoming_database)?;
    set_private_file_permissions(&incoming_manifest)?;
    sync_file(&incoming_database)?;
    sync_file(&incoming_manifest)?;
    sync_directory(incoming_path)?;
    let staged_inspection = super::inspect_global_backup_package(incoming_path)?;
    if staged_inspection.manifest != package.manifest {
        return Err(StoreError::Conflict(
            "Global backup package changed while it was being staged".into(),
        ));
    }

    fs::rename(&incoming_database, staged_database_path)
        .map_err(|error| io_unavailable("cannot publish staged Global database image", error))?;
    fs::remove_file(&incoming_manifest)
        .map_err(|error| io_unavailable("cannot remove staged Global backup manifest", error))?;
    fs::remove_dir(incoming_path)
        .map_err(|error| io_unavailable("cannot close staged Global package directory", error))?;

    let staged = GlobalManagerStore::open_under_maintenance(staged_database_path, guard)?;
    staged.inner.execute_batch("BEGIN IMMEDIATE")?;
    let update = (|| {
        let mut database = staged.inner.prepare(
            "SELECT schema_id,schema_version,database_id,revision FROM global_schema WHERE singleton=1",
        )?;
        if database.step()? != SQLITE_ROW {
            return Err(StoreError::Corrupt(
                "staged Global database identity row is missing".into(),
            ));
        }
        let source_id = database.column_text(2)?;
        let source_revision = database.column_u64(3)?;
        drop(database);
        if source_id != package.manifest.database_id || source_revision != package.manifest.revision
        {
            return Err(StoreError::Conflict(
                "staged Global database does not match its validated backup".into(),
            ));
        }
        let mut update = staged
            .inner
            .prepare("UPDATE global_schema SET database_id=?1 WHERE singleton=1")?;
        update.bind_text(1, target_database_id)?;
        update.run()?;
        Ok::<(), StoreError>(())
    })();
    if let Err(error) = update {
        let _ = staged.inner.execute_batch("ROLLBACK");
        return Err(error);
    }
    staged.inner.execute_batch("COMMIT")?;
    checkpoint_and_close_database(&staged.inner, staged_database_path)?;
    drop(staged);
    remove_sqlite_sidecars(staged_database_path)?;
    sync_file(staged_database_path)?;
    sync_directory(
        staged_database_path
            .parent()
            .expect("staging database has parent"),
    )?;
    verify_staged_database(staged_database_path, target_database_id, package)?;
    Ok(())
}

fn verify_staged_database(
    staged_database_path: &Path,
    target_database_id: &str,
    package: &RestorePackageIdentity,
) -> Result<(), StoreError> {
    reject_symlink_if_present(staged_database_path, "staged Global database")?;
    reject_sqlite_sidecars(staged_database_path)?;
    let staged = SqliteStore::open_connection(staged_database_path, SQLITE_OPEN_READONLY)?;
    let identity = read_connection_identity(&staged)?;
    if identity.schema_id != GLOBAL_SCHEMA_ID
        || identity.schema_version != GLOBAL_SCHEMA_VERSION
        || identity.database_id != target_database_id
        || identity.revision != package.manifest.revision
    {
        return Err(StoreError::Corrupt(
            "staged Global database identity does not match restore journal".into(),
        ));
    }
    let (snapshot, revision, history) = read_snapshot_and_history(&staged)?;
    if revision != package.manifest.revision
        || snapshot != package.snapshot
        || history != package.history
    {
        return Err(StoreError::Corrupt(
            "staged Global database state or revision history changed during restore".into(),
        ));
    }
    Ok(())
}

fn retain_previous_database(
    database_path: &Path,
    previous_path: &Path,
    journal: &RestoreJournal,
) -> Result<(), StoreError> {
    let Some(expected_id) = journal.previous_database_id.as_deref() else {
        if path_present(database_path)? || path_present(previous_path)? {
            return Err(StoreError::Conflict(
                "unexpected Global database appeared during package-only restore".into(),
            ));
        }
        return Ok(());
    };
    if path_present(previous_path)? {
        return verify_previous_database(previous_path, journal);
    }
    let active = read_database_identity(database_path)?;
    if active.database_id != expected_id || Some(active.revision) != journal.previous_revision {
        return Err(StoreError::Conflict(
            "Global database changed before retention; active data was left untouched".into(),
        ));
    }
    let source = SqliteStore::open_connection(database_path, crate::SQLITE_OPEN_READWRITE)?;
    source.backup_to(previous_path)?;
    set_private_file_permissions(previous_path)?;
    sync_file(previous_path)?;
    verify_previous_database(previous_path, journal)?;
    sync_directory(
        previous_path
            .parent()
            .expect("previous database has parent"),
    )?;
    Ok(())
}

fn verify_previous_database(
    previous_path: &Path,
    journal: &RestoreJournal,
) -> Result<(), StoreError> {
    let Some(expected_id) = journal.previous_database_id.as_deref() else {
        if path_present(previous_path)? {
            return Err(StoreError::Conflict(
                "unexpected retained database exists for package-only restore".into(),
            ));
        }
        return Ok(());
    };
    let previous = read_database_identity(previous_path)?;
    if previous.database_id != expected_id || Some(previous.revision) != journal.previous_revision {
        return Err(StoreError::Corrupt(
            "retained previous Global database does not match restore journal".into(),
        ));
    }
    Ok(())
}

fn prepare_active_database_for_atomic_replace(
    database_path: &Path,
    journal: &RestoreJournal,
) -> Result<(), StoreError> {
    if journal.previous_database_id.is_none() {
        if path_present(database_path)? {
            return Err(StoreError::Conflict(
                "Global database appeared during package-only restore".into(),
            ));
        }
        ensure_no_sqlite_sidecars(database_path)?;
        return Ok(());
    }
    let active = read_database_identity(database_path)?;
    if active.database_id != journal.previous_database_id.as_deref().unwrap_or_default()
        || Some(active.revision) != journal.previous_revision
    {
        return Err(StoreError::Conflict(
            "Global database identity changed before activation".into(),
        ));
    }
    let database = SqliteStore::open_connection(database_path, crate::SQLITE_OPEN_READWRITE)?;
    checkpoint_and_close_database(&database, database_path)?;
    drop(database);
    remove_sqlite_sidecars(database_path)?;
    Ok(())
}

fn checkpoint_and_close_database(
    database: &SqliteStore,
    database_path: &Path,
) -> Result<(), StoreError> {
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
            "Global restore database has an active SQLite reader or writer".into(),
        ));
    }
    database.execute_batch("PRAGMA journal_mode=DELETE")?;
    if !database.journal_mode()?.eq_ignore_ascii_case("delete") {
        return Err(StoreError::Busy(
            "Global restore database is still in use by another SQLite connection".into(),
        ));
    }
    let _ = database_path;
    Ok(())
}

fn activate_staged_database(
    staged_database_path: &Path,
    database_path: &Path,
) -> Result<(), StoreError> {
    #[cfg(not(unix))]
    {
        let _ = (staged_database_path, database_path);
        return Err(StoreError::Unavailable(
            "atomic Global restore activation is supported only on Unix".into(),
        ));
    }
    #[cfg(unix)]
    {
        fs::rename(staged_database_path, database_path).map_err(|error| {
            io_unavailable("cannot atomically activate restored Global database", error)
        })
    }
}

fn finish_activated_restore(
    database_path: &Path,
    package: &RestorePackageIdentity,
    journal_path: &Path,
    journal: &mut RestoreJournal,
    guard: &super::GlobalMaintenanceGuard,
    idempotent_readback: bool,
) -> Result<GlobalRestoreReport, StoreError> {
    if !matches!(
        journal.phase.as_str(),
        "previous_retained" | "activated" | "committed"
    ) {
        return Err(StoreError::Conflict(
            "Global restore journal does not authorize activated readback".into(),
        ));
    }
    let previous_path = journal_path
        .parent()
        .expect("journal has parent")
        .join("previous.sqlite");
    verify_previous_database(&previous_path, journal)?;
    let active = GlobalManagerStore::open_under_maintenance(database_path, guard)?;
    let identity = read_store_identity(&active)?;
    if identity.database_id != journal.target_database_id
        || identity.revision != journal.source_revision
        || identity.schema_id != GLOBAL_SCHEMA_ID
        || identity.schema_version != GLOBAL_SCHEMA_VERSION
    {
        return Err(StoreError::Corrupt(
            "activated Global database does not match restore journal".into(),
        ));
    }
    let (snapshot, revision) = active.snapshot()?;
    let history = active.revision_history()?;
    if revision != package.manifest.revision
        || snapshot != package.snapshot
        || history != package.history
    {
        return Err(StoreError::Corrupt(
            "activated Global database failed durable readback".into(),
        ));
    }
    drop(active);

    if journal.phase != "committed" {
        journal.phase = "committed".into();
        write_journal(journal_path, journal, false)?;
    }
    let previous_database_path = journal.previous_database_id.as_ref().map(|_| previous_path);
    Ok(GlobalRestoreReport {
        operation_id: journal.operation_id.clone(),
        database_path: database_path.to_path_buf(),
        package_path: package.package_path.clone(),
        source_database_id: journal.source_database_id.clone(),
        database_id: journal.target_database_id.clone(),
        revision: journal.source_revision,
        previous_database_path,
        idempotent_readback,
    })
}

fn read_store_identity(store: &GlobalManagerStore) -> Result<DatabaseIdentity, StoreError> {
    read_connection_identity(&store.inner)
}

fn read_snapshot_and_history(
    database: &SqliteStore,
) -> Result<(Value, u64, Vec<Value>), StoreError> {
    let mut current = database.prepare(
        "SELECT s.state_json,g.revision FROM global_manager_state s CROSS JOIN global_schema g WHERE s.singleton=1 AND g.singleton=1",
    )?;
    if current.step()? != SQLITE_ROW {
        return Err(StoreError::Corrupt(
            "Global snapshot rows are missing".into(),
        ));
    }
    let mut state: Value = serde_json::from_str(&current.column_text(0)?).map_err(|error| {
        StoreError::Corrupt(format!("Global snapshot JSON is invalid: {error}"))
    })?;
    super::ensure_compatible_state(&mut state)?;
    let revision = current.column_u64(1)?;
    drop(current);

    let mut rows = database.prepare(
        "SELECT revision,state_json,created_at FROM global_revision_snapshot ORDER BY revision",
    )?;
    let mut history = Vec::new();
    while rows.step()? == SQLITE_ROW {
        let mut snapshot: Value = serde_json::from_str(&rows.column_text(1)?).map_err(|error| {
            StoreError::Corrupt(format!("Global revision snapshot is invalid: {error}"))
        })?;
        super::ensure_compatible_state(&mut snapshot)?;
        history.push(json!({
            "revision": rows.column_u64(0)?,
            "snapshot": snapshot,
            "created_at": rows.column_text(2)?,
        }));
    }
    Ok((state, revision, history))
}

fn read_database_identity(path: &Path) -> Result<DatabaseIdentity, StoreError> {
    reject_sqlite_sidecars(path)?;
    let database = SqliteStore::open_connection(path, SQLITE_OPEN_READONLY)?;
    read_connection_identity(&database)
}

fn read_database_identity_if_present(path: &Path) -> Result<Option<DatabaseIdentity>, StoreError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            Err(StoreError::Invalid(format!(
                "Global database must be a regular non-symlink file: {}",
                path.display()
            )))
        }
        Ok(_) => read_database_identity(path).map(Some),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(io_unavailable("cannot inspect Global database", error)),
    }
}

fn path_present(path: &Path) -> Result<bool, StoreError> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(io_unavailable("cannot inspect Global restore path", error)),
    }
}

fn read_connection_identity(database: &SqliteStore) -> Result<DatabaseIdentity, StoreError> {
    let mut query = database.prepare(
        "SELECT schema_id,schema_version,database_id,revision FROM global_schema WHERE singleton=1",
    )?;
    if query.step()? != SQLITE_ROW {
        return Err(StoreError::Corrupt(
            "Global database identity row is missing".into(),
        ));
    }
    let schema_id = query.column_text(0)?;
    let schema_version = query.column_u64(1)?;
    let database_id = query.column_text(2)?;
    let revision = query.column_u64(3)?;
    if schema_id != GLOBAL_SCHEMA_ID
        || !(1..=GLOBAL_SCHEMA_VERSION).contains(&schema_version)
        || !is_database_id(&database_id)
    {
        return Err(StoreError::Invalid(
            "database is not a supported Boreal Global database; it was left unchanged".into(),
        ));
    }
    Ok(DatabaseIdentity {
        schema_id,
        schema_version,
        database_id,
        revision,
    })
}

fn canonical_database_path(path: &Path) -> Result<PathBuf, StoreError> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or_else(|| {
            StoreError::Invalid("Global database path must have a parent directory".into())
        })?;
    fs::create_dir_all(parent)
        .map_err(|error| io_unavailable("cannot create Global database directory", error))?;
    let parent = fs::canonicalize(parent)
        .map_err(|error| io_unavailable("cannot resolve Global database directory", error))?;
    let name = path.file_name().ok_or_else(|| {
        StoreError::Invalid("Global database path must include a file name".into())
    })?;
    Ok(parent.join(name))
}

fn read_journal(path: &Path) -> Result<RestoreJournal, StoreError> {
    let metadata = fs::metadata(path)
        .map_err(|error| io_unavailable("cannot inspect Global restore journal", error))?;
    if !metadata.is_file() || metadata.len() > 64 * 1024 {
        return Err(StoreError::Corrupt(
            "Global restore journal is not a bounded regular file".into(),
        ));
    }
    let bytes = fs::read(path)
        .map_err(|error| io_unavailable("cannot read Global restore journal", error))?;
    RestoreJournal::parse(&bytes)
}

fn write_journal(path: &Path, journal: &RestoreJournal, create: bool) -> Result<(), StoreError> {
    let parent = path.parent().expect("journal path has parent");
    let temporary = parent.join(JOURNAL_TEMP_FILE);
    reject_symlink_if_present(&temporary, "Global restore journal temporary file")?;
    if path_present(&temporary)? {
        fs::remove_file(&temporary).map_err(|error| {
            io_unavailable(
                "cannot remove stale Global restore journal temporary file",
                error,
            )
        })?;
    }
    let bytes = serde_json::to_vec(&journal.as_json()).map_err(|error| {
        StoreError::Invalid(format!("cannot encode Global restore journal: {error}"))
    })?;
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    let mut file = options
        .open(&temporary)
        .map_err(|error| io_unavailable("cannot create Global restore journal", error))?;
    set_private_file_permissions(&temporary)?;
    file.write_all(&bytes)
        .map_err(|error| io_unavailable("cannot write Global restore journal", error))?;
    file.sync_all()
        .map_err(|error| io_unavailable("cannot sync Global restore journal", error))?;
    drop(file);
    if create && path_present(path)? {
        return Err(StoreError::Conflict(
            "Global restore journal already exists".into(),
        ));
    }
    fs::rename(&temporary, path)
        .map_err(|error| io_unavailable("cannot publish Global restore journal", error))?;
    sync_directory(parent)
}

fn fresh_database_id(source_id: &str, previous_id: Option<&str>) -> Result<String, StoreError> {
    #[cfg(unix)]
    {
        let mut random = File::open("/dev/urandom")
            .map_err(|error| io_unavailable("cannot open system random source", error))?;
        loop {
            let mut bytes = [0_u8; 16];
            random
                .read_exact(&mut bytes)
                .map_err(|error| io_unavailable("cannot read system random source", error))?;
            let mut id = String::with_capacity(32);
            for byte in bytes {
                use std::fmt::Write as _;
                write!(&mut id, "{byte:02x}").expect("writing to String cannot fail");
            }
            if id != source_id && Some(id.as_str()) != previous_id {
                return Ok(id);
            }
        }
    }
    #[cfg(not(unix))]
    {
        let _ = (source_id, previous_id);
        Err(StoreError::Unavailable(
            "fresh Global restore identities are supported only on Unix".into(),
        ))
    }
}

fn validate_operation_id(operation_id: &str) -> Result<(), StoreError> {
    if operation_id.is_empty()
        || operation_id.len() > 512
        || !operation_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-' | b':'))
    {
        return Err(StoreError::Invalid(
            "Global restore operation identity must be 1..=512 ASCII letters, digits, '.', '_', '-', or ':'".into(),
        ));
    }
    Ok(())
}

fn is_database_id(id: &str) -> bool {
    id.len() == 32
        && id
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn is_sha256_digest(digest: &str) -> bool {
    digest.strip_prefix("sha256:").is_some_and(|hex| {
        hex.len() == 64
            && hex
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    })
}

fn reject_symlink_if_present(path: &Path, label: &str) -> Result<(), StoreError> {
    match fs::symlink_metadata(path) {
        Ok(metadata)
            if metadata.file_type().is_symlink() || !metadata.is_file() && !metadata.is_dir() =>
        {
            Err(StoreError::Invalid(format!(
                "{label} must not be a symlink or special file: {}",
                path.display()
            )))
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(io_unavailable("cannot inspect Global restore path", error)),
    }
}

fn reject_sqlite_sidecars(database_path: &Path) -> Result<(), StoreError> {
    for suffix in ["-wal", "-shm", "-journal"] {
        let path = append_suffix(database_path, suffix);
        match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
                return Err(StoreError::Invalid(format!(
                    "Global restore SQLite sidecar must be a regular non-symlink file: {}",
                    path.display()
                )));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(io_unavailable(
                    "cannot inspect Global SQLite sidecar",
                    error,
                ))
            }
        }
    }
    Ok(())
}

fn remove_sqlite_sidecars(database_path: &Path) -> Result<(), StoreError> {
    reject_sqlite_sidecars(database_path)?;
    for suffix in ["-wal", "-shm", "-journal"] {
        let path = append_suffix(database_path, suffix);
        match fs::remove_file(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(io_unavailable(
                    "cannot remove checkpointed Global SQLite sidecar",
                    error,
                ))
            }
        }
    }
    Ok(())
}

fn ensure_no_sqlite_sidecars(database_path: &Path) -> Result<(), StoreError> {
    reject_sqlite_sidecars(database_path)?;
    for suffix in ["-wal", "-shm", "-journal"] {
        let path = append_suffix(database_path, suffix);
        match fs::symlink_metadata(&path) {
            Ok(_) => {
                return Err(StoreError::Conflict(format!(
                    "Global database is absent but an unowned SQLite sidecar remains: {}",
                    path.display()
                )));
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(io_unavailable(
                    "cannot inspect Global SQLite sidecar",
                    error,
                ))
            }
        }
    }
    Ok(())
}

fn append_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut value = path.as_os_str().to_os_string();
    value.push(suffix);
    PathBuf::from(value)
}

fn set_private_file_permissions(path: &Path) -> Result<(), StoreError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))
            .map_err(|error| io_unavailable("cannot secure Global restore file", error))?;
    }
    Ok(())
}

fn set_private_directory_permissions(path: &Path) -> Result<(), StoreError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|error| io_unavailable("cannot secure Global restore directory", error))?;
    }
    Ok(())
}

fn sync_file(path: &Path) -> Result<(), StoreError> {
    File::open(path)
        .and_then(|file| file.sync_all())
        .map_err(|error| io_unavailable("cannot sync Global restore file", error))
}

fn sync_directory(path: &Path) -> Result<(), StoreError> {
    #[cfg(unix)]
    {
        File::open(path)
            .and_then(|file| file.sync_all())
            .map_err(|error| io_unavailable("cannot sync Global restore directory", error))
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        Ok(())
    }
}

fn io_unavailable(context: &str, error: std::io::Error) -> StoreError {
    StoreError::Unavailable(format!("{context}: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    #[cfg(unix)]
    fn interrupted_activation_is_read_back_and_keeps_the_previous_database() {
        let root = test_root("interrupted-activation");
        let source_path = root.join("source.sqlite");
        let active_path = root.join("global.sqlite");
        let package_path = root.join("restore.global-backup");

        let source = GlobalManagerStore::open(&source_path).unwrap();
        add_project(&source, "restored-project", "Restored source");
        let package = source.backup_package_to(&package_path).unwrap();
        let source_state = source.snapshot().unwrap();
        let source_history = source.revision_history().unwrap();
        drop(source);

        let active = GlobalManagerStore::open(&active_path).unwrap();
        add_project(&active, "retained-project", "Prior active state");
        let previous_identity = read_store_identity(&active).unwrap();
        let previous_state = active.snapshot().unwrap();
        drop(active);

        let operation_id = "op_restore_interrupted_test";
        let guard = super::super::GlobalMaintenanceGuard::acquire_exclusive(
            &active_path,
            operation_id,
            super::super::GlobalMaintenanceKind::Restore,
        )
        .unwrap();
        let interrupted = restore_global_backup_package_with_interruption(
            &active_path,
            &package_path,
            operation_id,
            &guard,
            true,
        )
        .unwrap_err();
        assert!(interrupted.to_string().contains("simulated interruption"));

        let error = GlobalManagerStore::open(&active_path).err().unwrap();
        assert!(matches!(error, StoreError::Busy(_)));
        assert!(error.to_string().contains(operation_id));

        let report =
            restore_global_backup_package(&active_path, &package_path, operation_id, &guard)
                .unwrap();
        assert!(report.idempotent_readback);
        assert_ne!(report.database_id, package.manifest.database_id);
        assert_eq!(report.source_database_id, package.manifest.database_id);
        assert_eq!(report.revision, package.manifest.revision);
        let previous_path = report.previous_database_path.clone().unwrap();
        assert!(previous_path.exists());
        assert_eq!(
            read_database_identity(&previous_path).unwrap(),
            previous_identity
        );
        let previous_database =
            SqliteStore::open_connection(&previous_path, SQLITE_OPEN_READONLY).unwrap();
        assert_eq!(
            read_snapshot_and_history(&previous_database).unwrap().0,
            previous_state.0
        );

        let restored = GlobalManagerStore::open_under_maintenance(&active_path, &guard).unwrap();
        assert_eq!(restored.snapshot().unwrap(), source_state);
        assert_eq!(restored.revision_history().unwrap(), source_history);
        assert_eq!(
            read_store_identity(&restored).unwrap().database_id,
            report.database_id
        );
        drop(restored);
        drop(guard);

        let reopened = GlobalManagerStore::open(&active_path).unwrap();
        assert_eq!(reopened.snapshot().unwrap(), source_state);
        assert_eq!(reopened.revision_history().unwrap(), source_history);
        drop(reopened);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    #[cfg(unix)]
    fn invalid_package_does_not_change_the_active_global_database() {
        let root = test_root("invalid-package");
        let active_path = root.join("global.sqlite");
        let active = GlobalManagerStore::open(&active_path).unwrap();
        add_project(&active, "keep", "Keep current data");
        let before_identity = read_store_identity(&active).unwrap();
        let before_snapshot = active.snapshot().unwrap();
        drop(active);

        let bad_package = root.join("bad.global-backup");
        fs::create_dir(&bad_package).unwrap();
        fs::write(bad_package.join("manifest.json"), b"{}").unwrap();
        fs::write(bad_package.join("database.sqlite"), b"not sqlite").unwrap();
        let operation_id = "op_restore_invalid_test";
        let guard = super::super::GlobalMaintenanceGuard::acquire_exclusive(
            &active_path,
            operation_id,
            super::super::GlobalMaintenanceKind::Restore,
        )
        .unwrap();
        assert!(
            restore_global_backup_package(&active_path, &bad_package, operation_id, &guard)
                .is_err()
        );
        assert_eq!(
            read_database_identity(&active_path).unwrap(),
            before_identity
        );
        drop(guard);
        let current = GlobalManagerStore::open(&active_path).unwrap();
        assert_eq!(current.snapshot().unwrap(), before_snapshot);
        drop(current);
        let _ = fs::remove_dir_all(root);
    }

    fn add_project(store: &GlobalManagerStore, id: &str, name: &str) {
        store
            .mutate(
                "project add",
                &json!({"id":id}),
                &format!("test-add-{id}"),
                |mut state, revision| {
                    state["projects"]
                        .as_array_mut()
                        .unwrap()
                        .push(json!({"id":id,"name":name}));
                    Ok((state, json!({"project_id":id,"revision":revision})))
                },
            )
            .unwrap();
    }

    fn test_root(label: &str) -> PathBuf {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "boreal-global-restore-{label}-{}-{timestamp}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        root
    }
}
