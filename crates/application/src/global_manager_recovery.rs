//! Application use cases for validated physical Global database backups.
//!
//! A physical backup contains private management notes and the complete
//! revision history. It is deliberately separate from the logical Global
//! export/import transfer format.

use crate::{sha256_content_digest, GlobalManagerError};
use boreal_store::global_manager::{GlobalBackupManifest, GlobalManagerStore};
use std::path::{Component, Path, PathBuf};

const BACKUP_DIRECTORY: &str = "backups";
const MAX_PATH_BYTES: usize = 4096;
const OPERATION_ID_MAX_BYTES: usize = 512;

/// Private content classes present in a physical database image.
pub const GLOBAL_BACKUP_CONTENTS: &str = "private management notes and complete revision history";

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
