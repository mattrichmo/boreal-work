//! Deterministic, bounded snapshots for witnessed gate execution.
//!
//! Snapshots are content-addressed by the source catalog. The format stores
//! only regular files and rejects links, traversal paths, and oversized input.

use std::{
    collections::BTreeSet,
    fs,
    io,
    path::{Component, Path, PathBuf},
};

const MAGIC: &[u8; 8] = b"BWSNAP01";
const MAX_FILES: usize = 100_000;
pub const DEFAULT_MAX_SNAPSHOT_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Debug)]
struct Entry {
    path: String,
    bytes: Vec<u8>,
    mode: u32,
}

/// Capture a workspace into a stable archive. The caller must confine and
/// authorize `root` before calling this function.
pub fn pack(root: &Path, max_bytes: u64) -> io::Result<Vec<u8>> {
    let root = root.canonicalize()?;
    if !root.is_dir() {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "snapshot root is not a directory"));
    }
    let mut entries = Vec::new();
    let mut total_bytes = 12u64;
    visit(&root, &root, false, &mut entries, &mut total_bytes, max_bytes)?;
    entries.sort_by(|left, right| left.path.cmp(&right.path));
    if entries.len() > MAX_FILES {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "workspace snapshot has too many files"));
    }
    let mut output = Vec::new();
    output.extend_from_slice(MAGIC);
    output.extend_from_slice(&(entries.len() as u32).to_be_bytes());
    let mut total = output.len() as u64;
    for entry in entries {
        let path = entry.path.as_bytes();
        if path.len() > u32::MAX as usize {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "workspace path is too long"));
        }
        total = total
            .saturating_add(4)
            .saturating_add(8)
            .saturating_add(4)
            .saturating_add(path.len() as u64)
            .saturating_add(entry.bytes.len() as u64);
        if total > max_bytes {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "workspace snapshot exceeds its size bound"));
        }
        output.extend_from_slice(&(path.len() as u32).to_be_bytes());
        output.extend_from_slice(&(entry.bytes.len() as u64).to_be_bytes());
        output.extend_from_slice(&entry.mode.to_be_bytes());
        output.extend_from_slice(path);
        output.extend_from_slice(&entry.bytes);
    }
    Ok(output)
}

/// Reconstruct a verified source blob into a fresh destination directory.
/// The source catalog verifies the outer content digest before this parser is
/// called; every archive path is still independently validated here.
pub fn unpack(bytes: &[u8], destination: &Path, max_bytes: u64) -> io::Result<usize> {
    if bytes.len() as u64 > max_bytes || bytes.len() < 12 || &bytes[..8] != MAGIC {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "invalid or oversized workspace snapshot"));
    }
    let count = u32::from_be_bytes(bytes[8..12].try_into().expect("four bytes")) as usize;
    if count > MAX_FILES {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "workspace snapshot has too many files"));
    }
    if destination.exists() {
        return Err(io::Error::new(io::ErrorKind::AlreadyExists, "snapshot destination already exists"));
    }
    fs::create_dir_all(destination)?;
    let mut cursor = 12usize;
    let mut paths = BTreeSet::new();
    for _ in 0..count {
        let path_len = take_u32(bytes, &mut cursor)? as usize;
        let content_len = usize::try_from(take_u64(bytes, &mut cursor)?)
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "snapshot file is too large"))?;
        let mode = take_u32(bytes, &mut cursor)? & 0o777;
        let path_end = cursor.checked_add(path_len).ok_or_else(invalid_archive)?;
        let path = std::str::from_utf8(bytes.get(cursor..path_end).ok_or_else(invalid_archive)?)
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "snapshot path is not UTF-8"))?;
        validate_relative_path(path)?;
        if !paths.insert(path.to_owned()) {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "workspace snapshot contains a duplicate path"));
        }
        cursor = path_end;
        let content_end = cursor.checked_add(content_len).ok_or_else(invalid_archive)?;
        let content = bytes.get(cursor..content_end).ok_or_else(invalid_archive)?;
        let relative = Path::new(path);
        let output = destination.join(relative);
        if !output.starts_with(destination) || output.exists() {
            return Err(invalid_archive());
        }
        let parent = output.parent().ok_or_else(invalid_archive)?;
        fs::create_dir_all(parent)?;
        fs::write(&output, content)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(output, fs::Permissions::from_mode(mode))?;
        }
        cursor = content_end;
    }
    if cursor != bytes.len() {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "workspace snapshot has trailing bytes"));
    }
    Ok(count)
}

fn visit(
    root: &Path,
    directory: &Path,
    in_boreal: bool,
    entries: &mut Vec<Entry>,
    total_bytes: &mut u64,
    max_bytes: u64,
) -> io::Result<()> {
    let directory_before = fs::symlink_metadata(directory)?;
    if !directory_before.is_dir() || directory_before.file_type().is_symlink() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "workspace directory changed while snapshotting",
        ));
    }
    let mut children = fs::read_dir(directory)?.collect::<Result<Vec<_>, _>>()?;
    children.sort_by_key(|entry| entry.file_name());
    for child in children {
        let name = child.file_name();
        let name = name.to_str().ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidData, "workspace path is not UTF-8")
        })?;
        if excluded(name) {
            continue;
        }
        if in_boreal && name != "gates" {
            continue;
        }
        let kind = child.file_type()?;
        if kind.is_symlink() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("workspace snapshot refuses symlink: {}", child.path().display()),
            ));
        }
        if kind.is_dir() {
            visit(
                root,
                &child.path(),
                name == ".boreal",
                entries,
                total_bytes,
                max_bytes,
            )?;
            continue;
        }
        if !kind.is_file() {
            continue;
        }
        let path = child.path();
        let relative = path.strip_prefix(root).map_err(|_| invalid_archive())?;
        let relative = relative.to_str().ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidData, "workspace path is not UTF-8")
        })?;
        let archive_path = if cfg!(windows) {
            relative.replace('\\', "/")
        } else {
            relative.to_owned()
        };
        validate_relative_path(&archive_path)?;
        let before = fs::symlink_metadata(&path)?;
        if !before.is_file() || before.file_type().is_symlink() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("workspace file changed while snapshotting: {}", path.display()),
            ));
        }
        let projected_size = (*total_bytes)
            .saturating_add(16)
            .saturating_add(archive_path.len() as u64)
            .saturating_add(before.len());
        if projected_size > max_bytes {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "workspace snapshot exceeds its size bound"));
        }
        let bytes = fs::read(&path)?;
        let after = fs::symlink_metadata(&path)?;
        if !stable_metadata(&before, &after) || bytes.len() as u64 != after.len() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("workspace file changed while snapshotting: {}", path.display()),
            ));
        }
        #[cfg(unix)]
        let mode = {
            use std::os::unix::fs::PermissionsExt;
            fs::metadata(path)?.permissions().mode() & 0o777
        };
        #[cfg(not(unix))]
        let mode = 0o644;
        *total_bytes = projected_size;
        if *total_bytes > max_bytes {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "workspace snapshot exceeds its size bound"));
        }
        entries.push(Entry { path: archive_path, bytes, mode });
        if entries.len() > MAX_FILES {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "workspace snapshot has too many files"));
        }
    }
    let directory_after = fs::symlink_metadata(directory)?;
    if !stable_metadata(&directory_before, &directory_after) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("workspace directory changed while snapshotting: {}", directory.display()),
        ));
    }
    Ok(())
}

fn stable_metadata(before: &fs::Metadata, after: &fs::Metadata) -> bool {
    if before.len() != after.len() || before.modified().ok() != after.modified().ok() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        before.dev() == after.dev()
            && before.ino() == after.ino()
            && before.mtime() == after.mtime()
            && before.mtime_nsec() == after.mtime_nsec()
            && before.ctime() == after.ctime()
            && before.ctime_nsec() == after.ctime_nsec()
    }
    #[cfg(not(unix))]
    {
        true
    }
}

fn excluded(name: &str) -> bool {
    name == ".env"
        || name == ".envrc"
        || name.starts_with(".secret")
        || name.starts_with(".env.")
        || matches!(
        name,
        ".git"
            | "target"
            | "node_modules"
            | "dist"
            | "coverage"
            | "__pycache__"
            | ".pytest_cache"
            | ".mypy_cache"
            | ".DS_Store"
            | "node-compile-cache"
            | ".aws"
            | ".ssh"
            | ".kube"
            | ".config"
            | ".netrc"
            | ".npmrc"
            | ".pypirc"
            | "credentials"
            | "secrets"
        )
}

fn validate_relative_path(path: &str) -> io::Result<PathBuf> {
    if path.is_empty() || path.contains('\\') || path.contains('\0') {
        return Err(invalid_archive());
    }
    let candidate = Path::new(path);
    if candidate.is_absolute()
        || candidate
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(invalid_archive());
    }
    Ok(candidate.to_path_buf())
}

fn take_u32(bytes: &[u8], cursor: &mut usize) -> io::Result<u32> {
    let end = cursor.checked_add(4).ok_or_else(invalid_archive)?;
    let value = u32::from_be_bytes(bytes.get(*cursor..end).ok_or_else(invalid_archive)?.try_into().expect("four bytes"));
    *cursor = end;
    Ok(value)
}

fn take_u64(bytes: &[u8], cursor: &mut usize) -> io::Result<u64> {
    let end = cursor.checked_add(8).ok_or_else(invalid_archive)?;
    let value = u64::from_be_bytes(bytes.get(*cursor..end).ok_or_else(invalid_archive)?.try_into().expect("eight bytes"));
    *cursor = end;
    Ok(value)
}

fn invalid_archive() -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, "invalid workspace snapshot archive")
}
