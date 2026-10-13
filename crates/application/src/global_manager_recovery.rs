//! Application use cases for validated physical Global database backups.
//!
//! A physical backup contains private management notes and the complete
//! revision history. It is deliberately separate from the logical Global
//! export/import transfer format.

use crate::{sha256_content_digest, GlobalManagerError};
use boreal_store::global_manager::{
    GlobalBackupManifest, GlobalMaintenanceGuard, GlobalMaintenanceKind, GlobalManagerStore,
};
use std::path::{Component, Path, PathBuf};

const BACKUP_DIRECTORY: &str = "backups";
const MAX_PATH_BYTES: usize = 4096;
const OPERATION_ID_MAX_BYTES: usize = 512;

/// Private content classes present in a physical database image.
pub const GLOBAL_BACKUP_CONTENTS: &str = "private management notes and complete revision history";

/// Acquires the shared Global maintenance boundary for restore, schema
/// migration, or machine-update work. The returned guard must stay alive until
/// the complete maintenance operation and any durable readback have finished.
pub fn acquire_global_maintenance(
    database_path: impl AsRef<Path>,
    operation_id: &str,
    kind: GlobalMaintenanceKind,
) -> Result<GlobalMaintenanceGuard, GlobalManagerError> {
    Ok(GlobalMaintenanceGuard::acquire_exclusive(
        database_path,
        operation_id,
        kind,
    )?)
}

/// Opens the active or staged Global database under an already-held exclusive
/// maintenance guard. The store shares the guard's OS lock handle, preventing
/// connection use from outliving maintenance admission accidentally.
pub fn open_global_under_maintenance(
    database_path: impl AsRef<Path>,
    guard: &GlobalMaintenanceGuard,
) -> Result<GlobalManagerStore, GlobalManagerError> {
    Ok(GlobalManagerStore::open_under_maintenance(
        database_path,
        guard,
    )?)
}

/// Bounded metadata for a physical backup that has passed package validation.
/// Database bytes are written only to the local package directory.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GlobalBackupMetadata {
    pub operation_id: String,
    pub package_path: PathBuf,
    pub schema_id: String,
    pub schema_version: u64,
    pub database_id: String,
    pub revision: u64,
    pub database_bytes: u64,
    pub database_checksum: String,
    pub created_at: String,
    pub validated: bool,
    pub idempotent_readback: bool,
}

/// Bounded readback for a completed physical Global restore.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GlobalRestoreMetadata {
    pub operation_id: String,
    pub package_path: PathBuf,
    pub database_path: PathBuf,
    pub source_database_id: String,
    pub database_id: String,
    pub revision: u64,
    pub previous_database_path: Option<PathBuf>,
    pub validated: bool,
    pub idempotent_readback: bool,
}

/// Restores a validated physical Global backup through a private staging DB.
/// Validation happens before maintenance admission touches the live database.
pub fn restore_global_backup(
    database_path: impl AsRef<Path>,
    package_path: impl AsRef<Path>,
    operation_id: &str,
) -> Result<GlobalRestoreMetadata, GlobalManagerError> {
    validate_operation_id(operation_id)?;
    let database_path = database_path.as_ref();
    let package_path = package_path.as_ref();
    validate_path(database_path, "Global database path")?;
    validate_path(package_path, "Global backup package path")?;

    GlobalManagerStore::inspect_backup_package(package_path)?;
    let guard = GlobalMaintenanceGuard::acquire_exclusive(
        database_path,
        operation_id,
        GlobalMaintenanceKind::Restore,
    )?;
    let report = boreal_store::global_manager::restore_global_backup_package(
        database_path,
        package_path,
        operation_id,
        &guard,
    )?;
    Ok(GlobalRestoreMetadata {
        operation_id: report.operation_id,
        package_path: report.package_path,
        database_path: report.database_path,
        source_database_id: report.source_database_id,
        database_id: report.database_id,
        revision: report.revision,
        previous_database_path: report.previous_database_path,
        validated: true,
        idempotent_readback: report.idempotent_readback,
    })
}

/// Creates a validated physical backup under the database's private `backups`
/// directory. A default destination is stable for the supplied operation ID,
/// so a retried request can read back the already-published package.
pub fn create_global_backup(
    database_path: impl AsRef<Path>,
    requested_destination: Option<&Path>,
    operation_id: &str,
) -> Result<GlobalBackupMetadata, GlobalManagerError> {
    validate_operation_id(operation_id)?;
    let database_path = database_path.as_ref();
    validate_path(database_path, "Global database path")?;
    let (database_root, backup_root) = ensure_private_backup_root(database_path)?;
    let (destination, is_default) =
        resolve_destination(&backup_root, requested_destination, operation_id)?;

    if is_default && destination.exists() {
        let existing = GlobalManagerStore::inspect_backup_package(&destination)?;
        return Ok(metadata_from_manifest(
            operation_id,
            existing.package_path,
            existing.manifest,
            true,
        ));
    }
    if destination.exists() {
        return Err(GlobalManagerError::Conflict(format!(
            "Global backup package destination already exists: {}",
            destination.display()
        )));
    }

    // Re-check after creating the private backup area. The physical package
    // writer publishes only after the copied SQLite image and manifest pass
    // validation.
    let canonical_database_root = std::fs::canonicalize(&database_root).map_err(|error| {
        GlobalManagerError::Invalid(format!(
            "cannot resolve Global database directory {}: {error}",
            database_root.display()
        ))
    })?;
    if !backup_root.starts_with(&canonical_database_root) {
        return Err(GlobalManagerError::Invalid(
            "Global backup destination escaped the private data root".into(),
        ));
    }

    let store = GlobalManagerStore::open(database_path)?;
    let report = store.backup_package_to(&destination)?;
    Ok(metadata_from_manifest(
        operation_id,
        report.package_path,
        report.manifest,
        false,
    ))
}

fn metadata_from_manifest(
    operation_id: &str,
    package_path: PathBuf,
    manifest: GlobalBackupManifest,
    idempotent_readback: bool,
) -> GlobalBackupMetadata {
    GlobalBackupMetadata {
        operation_id: operation_id.to_owned(),
        package_path,
        schema_id: manifest.source_schema_id,
        schema_version: manifest.source_schema_version,
        database_id: manifest.database_id,
        revision: manifest.revision,
        database_bytes: manifest.database_bytes,
        database_checksum: manifest.database_checksum,
        created_at: manifest.created_at,
        validated: true,
        idempotent_readback,
    }
}

fn validate_operation_id(operation_id: &str) -> Result<(), GlobalManagerError> {
    let valid_tail = operation_id.strip_prefix("op_").is_some_and(|tail| {
        !tail.is_empty()
            && tail
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
    });
    if !valid_tail || operation_id.len() > OPERATION_ID_MAX_BYTES {
        return Err(GlobalManagerError::Invalid(
            "Global backup operation ID must use the op_ prefix, contain only ASCII letters, digits, '.', '_' or '-', and be at most 512 bytes".into(),
        ));
    }
    Ok(())
}

fn validate_path(path: &Path, label: &str) -> Result<(), GlobalManagerError> {
    if path
        .to_str()
        .is_none_or(|value| value.is_empty() || value.len() > MAX_PATH_BYTES)
    {
        return Err(GlobalManagerError::Invalid(format!(
            "{label} must be valid UTF-8, non-empty and at most {MAX_PATH_BYTES} bytes"
        )));
    }
    Ok(())
}

fn ensure_private_backup_root(
    database_path: &Path,
) -> Result<(PathBuf, PathBuf), GlobalManagerError> {
    let database_root = database_path
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .ok_or_else(|| {
            GlobalManagerError::Invalid("Global database path must have a parent directory".into())
        })?;
    std::fs::create_dir_all(database_root).map_err(|error| {
        GlobalManagerError::Invalid(format!(
            "cannot create Global database directory {}: {error}",
            database_root.display()
        ))
    })?;
    let database_root = std::fs::canonicalize(database_root).map_err(|error| {
        GlobalManagerError::Invalid(format!(
            "cannot resolve Global database directory {}: {error}",
            database_root.display()
        ))
    })?;

    let backup_root = database_root.join(BACKUP_DIRECTORY);
    match std::fs::symlink_metadata(&backup_root) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return Err(GlobalManagerError::Invalid(
                "Global backup directory must not be a symlink".into(),
            ));
        }
        Ok(metadata) if !metadata.is_dir() => {
            return Err(GlobalManagerError::Invalid(
                "Global backup directory must be a directory".into(),
            ));
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            std::fs::create_dir(&backup_root).map_err(|error| {
                GlobalManagerError::Invalid(format!(
                    "cannot create Global backup directory {}: {error}",
                    backup_root.display()
                ))
            })?;
        }
        Err(error) => {
            return Err(GlobalManagerError::Invalid(format!(
                "cannot inspect Global backup directory {}: {error}",
                backup_root.display()
            )));
        }
    }
    secure_directory(&backup_root, "Global backup directory")?;
    let canonical_backup_root = std::fs::canonicalize(&backup_root).map_err(|error| {
        GlobalManagerError::Invalid(format!(
            "cannot resolve Global backup directory {}: {error}",
            backup_root.display()
        ))
    })?;
    if !canonical_backup_root.starts_with(&database_root) {
        return Err(GlobalManagerError::Invalid(
            "Global backup directory escaped the private data root".into(),
        ));
    }
    Ok((database_root, canonical_backup_root))
}

fn secure_directory(path: &Path, label: &str) -> Result<(), GlobalManagerError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700)).map_err(
            |error| {
                GlobalManagerError::Invalid(format!(
                    "cannot secure {label} {}: {error}",
                    path.display()
                ))
            },
        )?;
        let mode = std::fs::metadata(path)
            .map_err(|error| {
                GlobalManagerError::Invalid(format!(
                    "cannot inspect {label} {}: {error}",
                    path.display()
                ))
            })?
            .mode();
        if mode & 0o077 != 0 {
            return Err(GlobalManagerError::Invalid(format!(
                "{label} must be private (mode 0700): {}",
                path.display()
            )));
        }
    }
    #[cfg(not(unix))]
    let _ = (path, label);
    Ok(())
}

fn resolve_destination(
    backup_root: &Path,
    requested_destination: Option<&Path>,
    operation_id: &str,
) -> Result<(PathBuf, bool), GlobalManagerError> {
    let (candidate, is_default) = match requested_destination {
        Some(requested) => {
            validate_path(requested, "Global backup destination")?;
            if requested
                .components()
                .any(|component| component == Component::ParentDir)
            {
                return Err(GlobalManagerError::Invalid(
                    "Global backup destination cannot contain parent-directory traversal".into(),
                ));
            }
            let candidate = if requested.is_absolute() {
                requested.to_path_buf()
            } else {
                backup_root.join(requested)
            };
            if !candidate.starts_with(backup_root) {
                return Err(GlobalManagerError::Invalid(format!(
                    "Global backup destination must stay inside {}",
                    backup_root.display()
                )));
            }
            (candidate, false)
        }
        None => (default_destination(backup_root, operation_id), true),
    };

    let relative = candidate.strip_prefix(backup_root).map_err(|_| {
        GlobalManagerError::Invalid("Global backup destination escaped its private root".into())
    })?;
    let mut components = relative.components().peekable();
    let mut parent = backup_root.to_path_buf();
    let mut file_name = None;
    while let Some(component) = components.next() {
        let Component::Normal(part) = component else {
            return Err(GlobalManagerError::Invalid(
                "Global backup destination must be a relative package path".into(),
            ));
        };
        if components.peek().is_some() {
            parent.push(part);
            ensure_private_child_directory(&parent, backup_root)?;
        } else {
            file_name = Some(part.to_os_string());
        }
    }
    let file_name = file_name.ok_or_else(|| {
        GlobalManagerError::Invalid("Global backup destination must name a package".into())
    })?;
    let parent = std::fs::canonicalize(&parent).map_err(|error| {
        GlobalManagerError::Invalid(format!(
            "cannot resolve Global backup destination directory {}: {error}",
            parent.display()
        ))
    })?;
    if !parent.starts_with(backup_root) {
        return Err(GlobalManagerError::Invalid(
            "Global backup destination escaped its private root".into(),
        ));
    }
    let destination = parent.join(file_name);
    validate_path(&destination, "Global backup destination")?;
    Ok((destination, is_default))
}

fn default_destination(backup_root: &Path, operation_id: &str) -> PathBuf {
    let digest = sha256_content_digest(operation_id.as_bytes());
    let digest = digest.strip_prefix("sha256:").unwrap_or(&digest);
    backup_root.join(format!("global-{digest}.global-backup"))
}

fn ensure_private_child_directory(
    path: &Path,
    backup_root: &Path,
) -> Result<(), GlobalManagerError> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return Err(GlobalManagerError::Invalid(
                "Global backup destination cannot traverse a symlink".into(),
            ));
        }
        Ok(metadata) if !metadata.is_dir() => {
            return Err(GlobalManagerError::Invalid(
                "Global backup destination parent must be a directory".into(),
            ));
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            std::fs::create_dir(path).map_err(|error| {
                GlobalManagerError::Invalid(format!(
                    "cannot create Global backup destination directory {}: {error}",
                    path.display()
                ))
            })?;
        }
        Err(error) => {
            return Err(GlobalManagerError::Invalid(format!(
                "cannot inspect Global backup destination directory {}: {error}",
                path.display()
            )));
        }
    }
    secure_directory(path, "Global backup destination directory")?;
    let canonical = std::fs::canonicalize(path).map_err(|error| {
        GlobalManagerError::Invalid(format!(
            "cannot resolve Global backup destination directory {}: {error}",
            path.display()
        ))
    })?;
    if !canonical.starts_with(backup_root) {
        return Err(GlobalManagerError::Invalid(
            "Global backup destination escaped its private root".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[cfg(unix)]
    #[test]
    fn maintenance_admission_blocks_ordinary_open_and_authorizes_readback() {
        let root = test_root("maintenance-admission");
        let database = root.join("global.sqlite");
        let guard = acquire_global_maintenance(
            &database,
            "op_restore_test",
            GlobalMaintenanceKind::Restore,
        )
        .unwrap();

        let error = GlobalManagerStore::open(&database).err().unwrap();
        assert!(matches!(error, boreal_store::StoreError::Busy(_)));
        assert!(error.to_string().contains("op_restore_test"));

        let staged_database = guard.staging_database_path().unwrap();
        let staged = open_global_under_maintenance(&staged_database, &guard).unwrap();
        assert_eq!(staged.revision().unwrap(), 0);
        drop(staged);

        let unrelated_database = root.join("unrelated.sqlite");
        let error = open_global_under_maintenance(&unrelated_database, &guard)
            .err()
            .unwrap();
        assert!(matches!(error, GlobalManagerError::Invalid(_)));
        assert!(!unrelated_database.exists());

        drop(guard);
        let resumed = GlobalManagerStore::open(&database).unwrap();
        assert_eq!(resumed.revision().unwrap(), 0);
        drop(resumed);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn creates_validated_private_backup_and_reads_back_same_operation() {
        let root = test_root("backup-api");
        let database = root.join("global.sqlite");
        let first = create_global_backup(&database, None, "op_backup_1").unwrap();
        assert!(first.validated);
        assert!(!first.idempotent_readback);
        let backup_root = std::fs::canonicalize(root.join(BACKUP_DIRECTORY)).unwrap();
        assert!(first.package_path.starts_with(backup_root));
        assert!(first.database_bytes > 0);
        assert!(first.database_checksum.starts_with("sha256:"));

        let replay = create_global_backup(&database, None, "op_backup_1").unwrap();
        assert!(replay.validated);
        assert!(replay.idempotent_readback);
        assert_eq!(replay.package_path, first.package_path);
        assert_eq!(replay.database_checksum, first.database_checksum);

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(root.join(BACKUP_DIRECTORY))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o700
            );
        }
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn restores_physical_backup_with_fresh_identity_and_idempotent_readback() {
        let root = test_root("restore-api");
        let source_path = root.join("source.sqlite");
        let database_path = root.join("global.sqlite");
        let package_path = root.join("restore.global-backup");

        let source = GlobalManagerStore::open(&source_path).unwrap();
        let package = source.backup_package_to(&package_path).unwrap();
        drop(source);
        let active = GlobalManagerStore::open(&database_path).unwrap();
        drop(active);

        let first =
            restore_global_backup(&database_path, &package_path, "op_restore_api_1").unwrap();
        assert!(first.validated);
        assert!(!first.idempotent_readback);
        assert_eq!(first.source_database_id, package.manifest.database_id);
        assert_ne!(first.database_id, first.source_database_id);
        assert!(first.previous_database_path.as_ref().unwrap().exists());

        let replay =
            restore_global_backup(&database_path, &package_path, "op_restore_api_1").unwrap();
        assert!(replay.idempotent_readback);
        assert_eq!(replay.database_id, first.database_id);
        assert_eq!(replay.previous_database_path, first.previous_database_path);

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_backup_paths_outside_private_root_and_parent_traversal() {
        let root = test_root("backup-path");
        let database = root.join("global.sqlite");
        let outside = root.with_extension("outside.global-backup");
        assert!(create_global_backup(&database, None, "invalid-operation").is_err());
        assert!(create_global_backup(&database, Some(&outside), "op_backup_path_1").is_err());
        assert!(create_global_backup(
            &database,
            Some(Path::new("../escape.global-backup")),
            "op_backup_path_2"
        )
        .is_err());
        assert!(!outside.exists());
        let _ = std::fs::remove_dir_all(root);
    }

    fn test_root(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "boreal-global-{label}-{}-{nonce}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        path
    }
}
