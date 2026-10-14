//! Versioned, content-verified external blob files for production backups.

use serde_json::{json, Value};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use super::{checksum, reject_symlink, StoreError};

pub(super) const FORMAT: &str = "boreal.sqlite.backup-artifacts/1";
pub(super) const PACKAGE_DIRECTORY: &str = "artifacts";
pub(super) const RESTORE_STAGING_DIRECTORY: &str = "restore-artifacts";
const MAX_TOTAL_BYTES: u64 = 512 * 1024 * 1024;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct BlobIssue {
    pub digest: String,
    pub reason: String,
}

impl BlobIssue {
    pub fn as_json(&self) -> Value {
        json!({"blob_digest": self.digest, "reason": self.reason})
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct PackResult {
    pub files: Vec<Value>,
    pub issues: Vec<BlobIssue>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct VerifiedBlob {
    pub digest: String,
    pub bytes: Vec<u8>,
}

/// Copy every readable, digest-matching blob into the new package staging
/// directory. Missing or inconsistent source files are recorded as explicit
/// incomplete-package dispositions so callers never report them restorable.
pub(super) fn package_blobs(
    staging: &Path,
    references: &[Value],
) -> Result<PackResult, StoreError> {
    let mut result = PackResult {
        files: Vec::new(),
        issues: Vec::new(),
    };
    let mut total = 0u64;
    for reference in references {
        let digest = reference
            .get("blob_digest")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let byte_count = reference.get("byte_count").and_then(Value::as_u64);
        let source_path = reference.get("path").and_then(Value::as_str);
        let Some(relative_path) = blob_relative_path(digest) else {
            result.issues.push(BlobIssue {
                digest: digest.to_owned(),
                reason: "invalid_blob_digest".to_owned(),
            });
            continue;
        };
        let Some(byte_count) = byte_count else {
            result.issues.push(BlobIssue {
                digest: digest.to_owned(),
                reason: "invalid_blob_byte_count".to_owned(),
            });
            continue;
        };
        let Some(source_path) = source_path else {
            result.issues.push(BlobIssue {
                digest: digest.to_owned(),
                reason: "missing_blob_source_path".to_owned(),
            });
            continue;
        };
        let source_path = Path::new(source_path);
        reject_symlink(source_path)?;
        let metadata = match fs::symlink_metadata(source_path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                result.issues.push(BlobIssue {
                    digest: digest.to_owned(),
                    reason: "blob_file_missing".to_owned(),
                });
                continue;
            }
            Err(error) => {
                return Err(StoreError::Unavailable(format!(
                    "cannot inspect referenced blob {}: {error}",
                    source_path.display()
                )))
            }
        };
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            result.issues.push(BlobIssue {
                digest: digest.to_owned(),
                reason: "blob_path_not_regular_file".to_owned(),
            });
            continue;
        }
        let next_total = total
            .checked_add(metadata.len())
            .ok_or_else(|| StoreError::Invalid("backup artifact byte count overflow".to_owned()))?;
        if metadata.len() != byte_count || next_total > MAX_TOTAL_BYTES {
            result.issues.push(BlobIssue {
                digest: digest.to_owned(),
                reason: if metadata.len() != byte_count {
                    "blob_byte_count_mismatch".to_owned()
                } else {
                    "artifact_bundle_size_limit_exceeded".to_owned()
                },
            });
            continue;
        }
        let bytes = match fs::read(source_path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                result.issues.push(BlobIssue {
                    digest: digest.to_owned(),
                    reason: "blob_file_missing".to_owned(),
                });
                continue;
            }
            Err(error) => {
                return Err(StoreError::Unavailable(format!(
                    "cannot read referenced blob {}: {error}",
                    source_path.display()
                )))
            }
        };
        if bytes.len() as u64 != byte_count || checksum(&bytes) != digest {
            result.issues.push(BlobIssue {
                digest: digest.to_owned(),
                reason: "blob_digest_or_byte_count_mismatch".to_owned(),
            });
            continue;
        }
        let package_path = staging.join(&relative_path);
        let parent = package_path.parent().expect("blob path has a parent");
        fs::create_dir_all(parent).map_err(|error| {
            StoreError::Unavailable(format!(
                "cannot create backup artifact directory {}: {error}",
                parent.display()
            ))
        })?;
        write_new_file(&package_path, &bytes)?;
        total = next_total;
        result.files.push(json!({
            "blob_digest": digest,
            "byte_count": byte_count,
            "package_path": relative_path,
            "content_digest": checksum(&bytes),
        }));
    }
    Ok(result)
}

/// Validate the complete bundle before a restore creates or replaces a
/// destination. The returned bytes have already passed both the declared
/// bundle checksum and the source blob's content-addressed digest.
pub(super) fn verify_package_blobs(
    package: &Path,
    manifest: &Value,
) -> Result<Vec<VerifiedBlob>, StoreError> {
    let version = manifest
        .get("format_version")
        .and_then(Value::as_u64)
        .ok_or_else(|| StoreError::Corrupt("backup format version is missing".into()))?;
    let references = manifest
        .get("referenced_blobs")
        .and_then(Value::as_array)
        .ok_or_else(|| StoreError::Corrupt("backup referenced_blobs is not an array".into()))?;
    if version == 2 {
        if references.is_empty() {
            return Ok(Vec::new());
        }
        return Err(StoreError::Conflict(
            "legacy backup package references external blobs but contains no artifact bundle"
                .into(),
        ));
    }
    if version != 3 {
        return Err(StoreError::Invalid(
            "unsupported Boreal backup package format version".into(),
        ));
    }
    let bundle = manifest
        .get("artifact_bundle")
        .and_then(Value::as_object)
        .ok_or_else(|| StoreError::Corrupt("backup artifact_bundle is missing".into()))?;
    if bundle.get("format").and_then(Value::as_str) != Some(FORMAT) {
        return Err(StoreError::Invalid(
            "unsupported backup artifact bundle format".into(),
        ));
    }
    let issues = bundle
        .get("unavailable_blobs")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            StoreError::Corrupt("backup artifact bundle unavailable_blobs is missing".into())
        })?;
    if !issues.is_empty() {
        let first = &issues[0];
        return Err(StoreError::Conflict(format!(
            "backup package references external blobs that were not safely packaged: {} ({})",
            first
                .get("blob_digest")
                .and_then(Value::as_str)
                .unwrap_or("unknown digest"),
            first
                .get("reason")
                .and_then(Value::as_str)
                .unwrap_or("unknown disposition")
        )));
    }
    let files = bundle
        .get("blobs")
        .and_then(Value::as_array)
        .ok_or_else(|| StoreError::Corrupt("backup artifact bundle blobs is missing".into()))?;
    if files.len() != references.len() {
        return Err(StoreError::Conflict(
            "backup artifact bundle does not contain every referenced external blob".into(),
        ));
    }
    if !files.is_empty() {
        let artifact_directory = package.join(PACKAGE_DIRECTORY);
        let blob_directory = artifact_directory.join("blobs");
        reject_symlink(&artifact_directory)?;
        reject_symlink(&blob_directory)?;
        for directory in [&artifact_directory, &blob_directory] {
            let metadata = fs::symlink_metadata(directory).map_err(|error| {
                StoreError::Unavailable(format!(
                    "cannot inspect backup artifact directory {}: {error}",
                    directory.display()
                ))
            })?;
            if !metadata.is_dir() || metadata.file_type().is_symlink() {
                return Err(StoreError::Conflict(
                    "backup artifact path is not a regular directory".into(),
                ));
            }
        }
    }
    let mut reference_map = std::collections::BTreeMap::new();
    for reference in references {
        let digest = required_string(reference, "blob_digest")?;
        let byte_count = reference
            .get("byte_count")
            .and_then(Value::as_u64)
            .ok_or_else(|| StoreError::Corrupt("backup blob byte_count is invalid".into()))?;
        if blob_relative_path(digest).is_none()
            || reference_map
                .insert(digest.to_owned(), byte_count)
                .is_some()
        {
            return Err(StoreError::Corrupt(
                "backup blob references contain an invalid or duplicate digest".into(),
            ));
        }
    }
    let sources = manifest
        .get("referenced_sources")
        .and_then(Value::as_array)
        .ok_or_else(|| StoreError::Corrupt("backup referenced_sources is not an array".into()))?;
    for source in sources {
        if source.get("availability").and_then(Value::as_str) != Some("available") {
            continue;
        }
        let digest = required_string(source, "content_digest")?;
        let byte_count = source
            .get("byte_count")
            .and_then(Value::as_u64)
            .ok_or_else(|| StoreError::Corrupt("backup source byte_count is invalid".into()))?;
        if reference_map.get(digest) != Some(&byte_count) {
            return Err(StoreError::Conflict(format!(
                "backup package references available source blob {digest} without a matching external blob artifact"
            )));
        }
    }
    let mut verified = Vec::with_capacity(files.len());
    let mut seen = std::collections::BTreeSet::new();
    let mut total = 0u64;
    for file in files {
        let digest = required_string(file, "blob_digest")?;
        let byte_count = file
            .get("byte_count")
            .and_then(Value::as_u64)
            .ok_or_else(|| StoreError::Corrupt("backup artifact byte_count is invalid".into()))?;
        let package_path = required_string(file, "package_path")?;
        let content_digest = required_string(file, "content_digest")?;
        let expected_bytes = reference_map.get(digest).copied();
        let canonical_path = blob_relative_path(digest).ok_or_else(|| {
            StoreError::Corrupt("backup artifact has an invalid blob digest".into())
        })?;
        let canonical_package_path = canonical_package_path(digest)
            .expect("a validated blob digest has a canonical package path");
        if expected_bytes != Some(byte_count)
            || package_path != canonical_package_path
            || !seen.insert(digest.to_owned())
        {
            return Err(StoreError::Conflict(
                "backup artifact entry does not match its referenced blob metadata".into(),
            ));
        }
        let path = package.join(&canonical_path);
        reject_symlink(&path)?;
        let metadata = fs::symlink_metadata(&path).map_err(|error| {
            StoreError::Unavailable(format!(
                "cannot inspect packaged external blob {}: {error}",
                path.display()
            ))
        })?;
        if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() != byte_count
        {
            return Err(StoreError::Conflict(format!(
                "packaged external blob {digest} has an invalid file type or byte count"
            )));
        }
        total = total
            .checked_add(byte_count)
            .ok_or_else(|| StoreError::Corrupt("backup artifact byte count overflow".into()))?;
        if total > MAX_TOTAL_BYTES {
            return Err(StoreError::Invalid(
                "backup artifact bundle exceeds the supported size limit".into(),
            ));
        }
        let bytes = fs::read(&path).map_err(|error| {
            StoreError::Unavailable(format!(
                "cannot read packaged external blob {}: {error}",
                path.display()
            ))
        })?;
        if checksum(&bytes) != digest || checksum(&bytes) != content_digest {
            return Err(StoreError::Conflict(format!(
                "packaged external blob {digest} failed its integrity check"
            )));
        }
        verified.push(VerifiedBlob {
            digest: digest.to_owned(),
            bytes,
        });
    }
    if seen.len() != reference_map.len() {
        return Err(StoreError::Conflict(
            "backup artifact bundle is missing a referenced external blob".into(),
        ));
    }
    if !seen.is_empty() {
        let blob_directory = package.join(PACKAGE_DIRECTORY).join("blobs");
        let actual = fs::read_dir(&blob_directory)
            .map_err(|error| {
                StoreError::Unavailable(format!(
                    "cannot inspect backup artifact directory {}: {error}",
                    blob_directory.display()
                ))
            })?
            .map(|entry| {
                entry
                    .map(|entry| entry.file_name())
                    .map_err(|error| StoreError::Unavailable(error.to_string()))
            })
            .collect::<Result<std::collections::BTreeSet<_>, _>>()?;
        let expected = seen
            .iter()
            .map(|digest| {
                blob_relative_path(digest)
                    .expect("verified digest has a canonical path")
                    .file_name()
                    .expect("canonical path has a filename")
                    .to_owned()
            })
            .collect::<std::collections::BTreeSet<_>>();
        if actual != expected {
            return Err(StoreError::Conflict(
                "backup artifact directory contains unexpected files".into(),
            ));
        }
    }
    Ok(verified)
}

pub(super) fn materialize_blobs(root: &Path, blobs: &[VerifiedBlob]) -> Result<(), StoreError> {
    if blobs.is_empty() {
        return Ok(());
    }
    reject_symlink(root)?;
    fs::create_dir_all(root).map_err(|error| {
        StoreError::Unavailable(format!(
            "cannot create restore artifact staging directory {}: {error}",
            root.display()
        ))
    })?;
    for blob in blobs {
        let relative = blob_relative_path(&blob.digest)
            .ok_or_else(|| StoreError::Corrupt("verified artifact digest became invalid".into()))?;
        let target = root.join(relative.file_name().expect("canonical path has a filename"));
        write_new_file(&target, &blob.bytes)?;
    }
    Ok(())
}

pub(super) fn verify_materialized_blobs(
    root: &Path,
    blobs: &[VerifiedBlob],
) -> Result<(), StoreError> {
    if blobs.is_empty() {
        return Ok(());
    }
    reject_symlink(root)?;
    let metadata = fs::symlink_metadata(root).map_err(|error| {
        StoreError::Unavailable(format!(
            "cannot inspect restored artifact directory {}: {error}",
            root.display()
        ))
    })?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(StoreError::Conflict(
            "restored artifact root is not a regular directory".into(),
        ));
    }
    let root_entries = fs::read_dir(root)
        .map_err(|error| {
            StoreError::Unavailable(format!(
                "cannot inspect restored artifact root {}: {error}",
                root.display()
            ))
        })?
        .map(|entry| {
            entry
                .map(|entry| entry.file_name())
                .map_err(|error| StoreError::Unavailable(error.to_string()))
        })
        .collect::<Result<std::collections::BTreeSet<_>, _>>()?;
    if root_entries != [std::ffi::OsString::from("blobs")].into_iter().collect() {
        return Err(StoreError::Conflict(
            "restored artifact root contains unexpected entries".into(),
        ));
    }
    let blob_directory = root.join("blobs");
    reject_symlink(&blob_directory)?;
    let blob_directory_metadata = fs::symlink_metadata(&blob_directory).map_err(|error| {
        StoreError::Unavailable(format!(
            "cannot inspect restored blob directory {}: {error}",
            blob_directory.display()
        ))
    })?;
    if !blob_directory_metadata.is_dir() || blob_directory_metadata.file_type().is_symlink() {
        return Err(StoreError::Conflict(
            "restored artifact blob path is not a regular directory".into(),
        ));
    }
    let mut expected = std::collections::BTreeSet::new();
    for blob in blobs {
        let relative = blob_relative_path(&blob.digest)
            .ok_or_else(|| StoreError::Corrupt("verified artifact digest became invalid".into()))?;
        let name = relative.file_name().expect("canonical path has a filename");
        expected.insert(name.to_owned());
        let path = blob_directory.join(name);
        reject_symlink(&path)?;
        let bytes = fs::read(&path).map_err(|error| {
            StoreError::Unavailable(format!(
                "cannot read restored external blob {}: {error}",
                path.display()
            ))
        })?;
        if bytes != blob.bytes || checksum(&bytes) != blob.digest {
            return Err(StoreError::Conflict(format!(
                "restored external blob {} failed its integrity check",
                blob.digest
            )));
        }
    }
    let actual = fs::read_dir(&blob_directory)
        .map_err(|error| {
            StoreError::Unavailable(format!(
                "cannot inspect restored blob directory {}: {error}",
                blob_directory.display()
            ))
        })?
        .map(|entry| {
            entry
                .map(|entry| entry.file_name())
                .map_err(|error| StoreError::Unavailable(error.to_string()))
        })
        .collect::<Result<std::collections::BTreeSet<_>, _>>()?;
    if actual != expected {
        return Err(StoreError::Conflict(
            "restored artifact directory contains unexpected blob files".into(),
        ));
    }
    Ok(())
}

pub(super) fn canonical_package_path(digest: &str) -> Option<String> {
    blob_relative_path(digest).map(|path| path.to_string_lossy().replace('\\', "/"))
}

fn blob_relative_path(digest: &str) -> Option<PathBuf> {
    let hex = digest.strip_prefix("sha256:")?;
    if hex.len() != 64
        || !hex
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return None;
    }
    Some(PathBuf::from(PACKAGE_DIRECTORY).join("blobs").join(hex))
}

fn required_string<'a>(value: &'a Value, key: &str) -> Result<&'a str, StoreError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| StoreError::Corrupt(format!("backup artifact {key} is missing")))
}

fn write_new_file(path: &Path, bytes: &[u8]) -> Result<(), StoreError> {
    reject_symlink(path)?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| {
            StoreError::Unavailable(format!(
                "cannot create backup artifact file {}: {error}",
                path.display()
            ))
        })?;
    file.write_all(bytes).map_err(|error| {
        StoreError::Unavailable(format!(
            "cannot write backup artifact file {}: {error}",
            path.display()
        ))
    })?;
    file.sync_all().map_err(|error| {
        StoreError::Unavailable(format!(
            "cannot sync backup artifact file {}: {error}",
            path.display()
        ))
    })
}
