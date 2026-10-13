//! Process-safe admission for Global database access and maintenance.
//!
//! The persistent lock file is never unlinked. On supported Unix targets its
//! advisory `flock` is the ownership authority: kernel cleanup releases it
//! when a process exits, so no PID liveness probe or force-break path exists.
//! The adjacent owner record is advisory metadata used only to name a live
//! exclusive owner when admission is busy.

use super::super::StoreError;
use std::fs::{self, File, OpenOptions};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

const LOCK_FILE: &str = ".global-maintenance.lock";
const OWNER_FILE: &str = ".global-maintenance.owner.json";
const OWNER_TEMP_FILE: &str = ".global-maintenance.owner.tmp";
const CONTROL_DIRECTORY: &str = ".global-maintenance";
const STAGING_DIRECTORY: &str = "staging";
const STAGED_DATABASE_FILE: &str = "global.sqlite";
const OWNER_FORMAT: &str = "boreal.global-maintenance-owner/1";
const OPERATION_ID_MAX_BYTES: usize = 512;
const BOOTSTRAP_UNKNOWN_OWNER_GRACE: Duration = Duration::from_millis(250);

/// The fixed set of maintenance operations which may exclude ordinary Global
/// readers and writers.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum GlobalMaintenanceKind {
    Restore,
    Migration,
    MachineUpdate,
}

impl GlobalMaintenanceKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Restore => "restore",
            Self::Migration => "migration",
            Self::MachineUpdate => "machine_update",
        }
    }
}

#[derive(Clone, Debug)]
pub struct GlobalMaintenanceGuard {
    inner: Arc<AdmissionInner>,
}

#[derive(Debug)]
struct AdmissionInner {
    _lock_file: File,
    /// Exact database path protected by the keyed OS lock.
    database_path: PathBuf,
    /// A private child directory for the lock and advisory owner record.
    control_root: PathBuf,
    mode: AdmissionMode,
    owner: Option<OwnerRecord>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum AdmissionMode {
    Shared,
    Exclusive,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct OwnerRecord {
    operation_id: String,
    kind: String,
}

impl GlobalMaintenanceGuard {
    /// Acquires ordinary Global access without waiting. The returned guard
    /// must remain alive for the full lifetime of the database connection.
    pub fn acquire_shared(
        database_path: impl AsRef<Path>,
        attempted_operation_id: &str,
    ) -> Result<Self, StoreError> {
        validate_operation_id(attempted_operation_id)?;
        let root = global_database_root(database_path.as_ref())?;
        let canonical_database_path = database_path_in_root(&root, database_path.as_ref())?;
        let control_root = ensure_private_root(&root, database_path.as_ref())?;
        let lock_file = open_lock_file(&control_root)?;
        acquire_os_lock(&lock_file, AdmissionMode::Shared).map_err(|error| {
            admission_busy(
                &control_root,
                attempted_operation_id,
                "ordinary Global access",
                error,
            )
        })?;
        clear_owner_record(&control_root)?;
        Ok(Self {
            inner: Arc::new(AdmissionInner {
                _lock_file: lock_file,
                database_path: canonical_database_path,
                control_root,
                mode: AdmissionMode::Shared,
                owner: None,
            }),
        })
    }

    /// Acquires exclusive, operation-identified maintenance admission without
    /// waiting. The OS lock is authoritative; the owner record is written only
    /// after exclusive ownership has been obtained.
    pub fn acquire_exclusive(
        database_path: impl AsRef<Path>,
        operation_id: &str,
        kind: GlobalMaintenanceKind,
    ) -> Result<Self, StoreError> {
        validate_operation_id(operation_id)?;
        let root = global_database_root(database_path.as_ref())?;
        let canonical_database_path = database_path_in_root(&root, database_path.as_ref())?;
        let control_root = ensure_private_root(&root, database_path.as_ref())?;
        let lock_file = open_lock_file(&control_root)?;
        acquire_os_lock(&lock_file, AdmissionMode::Exclusive).map_err(|error| {
            admission_busy(&control_root, operation_id, "Global maintenance", error)
        })?;
        Self::publish_exclusive_owner(
            canonical_database_path,
            control_root,
            lock_file,
            operation_id,
            kind,
        )
    }

    /// Acquires migration admission, waiting only while another live migration
    /// owns the same database. Other owner kinds and unknown ownership remain
    /// fail-fast Busy results.
    pub(super) fn acquire_migration(
        database_path: impl AsRef<Path>,
        operation_id: &str,
        retry_window: Duration,
        retry_unknown_during_bootstrap: bool,
    ) -> Result<Option<Self>, StoreError> {
        validate_operation_id(operation_id)?;
        let root = global_database_root(database_path.as_ref())?;
        let canonical_database_path = database_path_in_root(&root, database_path.as_ref())?;
        let control_root = ensure_private_root(&root, database_path.as_ref())?;
        let lock_file = open_lock_file(&control_root)?;
        let started = Instant::now();
        let mut observed_migration_owner = false;
        loop {
            match acquire_os_lock(&lock_file, AdmissionMode::Exclusive) {
                Ok(()) => {
                    return Self::publish_exclusive_owner(
                        canonical_database_path,
                        control_root,
                        lock_file,
                        operation_id,
                        GlobalMaintenanceKind::Migration,
                    )
                    .map(Some);
                }
                Err(error) => {
                    if error.kind() != std::io::ErrorKind::WouldBlock {
                        return Err(admission_busy(
                            &control_root,
                            operation_id,
                            "Global maintenance",
                            error,
                        ));
                    }
                    match read_owner_record(&control_root) {
                        Ok(owner) if owner.kind == GlobalMaintenanceKind::Migration.as_str() => {
                            observed_migration_owner = true;
                            if started.elapsed() < retry_window {
                                let remaining = retry_window.saturating_sub(started.elapsed());
                                std::thread::sleep(Duration::from_millis(10).min(remaining));
                                continue;
                            }
                            return Err(admission_busy(
                                &control_root,
                                operation_id,
                                "Global maintenance",
                                error,
                            ));
                        }
                        Err(_)
                            if retry_unknown_during_bootstrap
                                && started.elapsed() < BOOTSTRAP_UNKNOWN_OWNER_GRACE =>
                        {
                            let remaining =
                                BOOTSTRAP_UNKNOWN_OWNER_GRACE.saturating_sub(started.elapsed());
                            std::thread::sleep(Duration::from_millis(10).min(remaining));
                        }
                        _ if observed_migration_owner => return Ok(None),
                        _ => {
                            return Err(admission_busy(
                                &control_root,
                                operation_id,
                                "Global maintenance",
                                error,
                            ));
                        }
                    }
                }
            }
        }
    }

    fn publish_exclusive_owner(
        database_path: PathBuf,
        control_root: PathBuf,
        lock_file: File,
        operation_id: &str,
        kind: GlobalMaintenanceKind,
    ) -> Result<Self, StoreError> {
        let owner = OwnerRecord {
            operation_id: operation_id.to_owned(),
            kind: kind.as_str().to_owned(),
        };
        if let Err(error) = publish_owner_record(&control_root, &owner) {
            // The descriptor is dropped on this path, releasing the OS lock.
            return Err(error);
        }
        Ok(Self {
            inner: Arc::new(AdmissionInner {
                _lock_file: lock_file,
                database_path,
                control_root,
                mode: AdmissionMode::Exclusive,
                owner: Some(owner),
            }),
        })
    }

    /// Returns the durable operation identity when this guard owns exclusive
    /// maintenance admission.
    pub fn operation_id(&self) -> Option<String> {
        if self.inner.mode != AdmissionMode::Exclusive {
            return None;
        }
        self.inner
            .owner
            .as_ref()
            .map(|owner| owner.operation_id.clone())
    }

    /// Returns whether this guard owns the exact database admission or its
    /// single operation-scoped staging database.
    pub fn is_exclusive_for(&self, database_path: impl AsRef<Path>) -> bool {
        if self.inner.mode != AdmissionMode::Exclusive {
            return false;
        }
        let requested = database_path.as_ref();
        let Ok(root) = global_database_root(requested) else {
            return false;
        };
        let Ok(requested) = database_path_in_root(&root, requested) else {
            return false;
        };
        if requested == self.inner.database_path {
            return true;
        }
        let Some(owner) = &self.inner.owner else {
            return false;
        };
        let expected_staging_database = self
            .inner
            .control_root
            .join(STAGING_DIRECTORY)
            .join(&owner.operation_id)
            .join(STAGED_DATABASE_FILE);
        requested == expected_staging_database
    }

    /// Creates the private, operation-scoped staging directory and returns its
    /// one authorized database path. The active database's keyed lock is not
    /// widened to other database files under the same Global parent.
    pub fn staging_database_path(&self) -> Result<PathBuf, StoreError> {
        let owner = self.inner.owner.as_ref().ok_or_else(|| {
            StoreError::Invalid(
                "Global staging path requires exclusive maintenance admission".into(),
            )
        })?;
        let staging_root = self.inner.control_root.join(STAGING_DIRECTORY);
        ensure_private_directory(&staging_root)?;
        let operation_root = staging_root.join(&owner.operation_id);
        ensure_private_directory(&operation_root)?;
        Ok(operation_root.join(STAGED_DATABASE_FILE))
    }

    pub(super) fn clone_exclusive_for_database(
        &self,
        database_path: impl AsRef<Path>,
    ) -> Result<Self, StoreError> {
        if !self.is_exclusive_for(database_path) {
            return Err(StoreError::Invalid(
                "Global store maintenance open requires an exclusive guard for the same database root".into(),
            ));
        }
        Ok(self.clone())
    }
}

impl Drop for AdmissionInner {
    fn drop(&mut self) {
        if self.mode == AdmissionMode::Exclusive {
            // Do not remove metadata belonging to any owner other than this
            // guard. Failure here is harmless: the kernel lock is released as
            // the file closes, and the next successful shared admission clears
            // stale advisory metadata before proceeding.
            if let Some(owner) = &self.owner {
                let _ = remove_owner_record_if_matches(&self.control_root, &owner);
            }
        }
    }
}

fn validate_operation_id(operation_id: &str) -> Result<(), StoreError> {
    if operation_id.is_empty()
        || operation_id.len() > OPERATION_ID_MAX_BYTES
        || !operation_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-' | b':'))
    {
        return Err(StoreError::Invalid(format!(
            "Global admission operation identity must be 1..={OPERATION_ID_MAX_BYTES} ASCII letters, digits, '.', '_', '-', or ':'"
        )));
    }
    Ok(())
}

fn global_database_root(database_path: &Path) -> Result<PathBuf, StoreError> {
    let root = database_path
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .ok_or_else(|| {
            StoreError::Invalid("Global database path must have a parent directory".into())
        })?;
    fs::create_dir_all(root).map_err(|error| {
        StoreError::Unavailable(format!(
            "cannot create Global admission directory {}: {error}",
            root.display()
        ))
    })?;
    let root = fs::canonicalize(root).map_err(|error| {
        StoreError::Unavailable(format!(
            "cannot resolve Global admission directory {}: {error}",
            root.display()
        ))
    })?;
    if !root.is_dir() {
        return Err(StoreError::Invalid(
            "Global admission root must be a directory".into(),
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(&root)
            .map_err(|error| {
                StoreError::Unavailable(format!(
                    "cannot inspect Global database root {}: {error}",
                    root.display()
                ))
            })?
            .permissions()
            .mode();
        // A sticky shared temporary directory is safe for an owned child
        // directory; a non-sticky directory writable by others is not.
        if mode & 0o022 != 0 && mode & 0o1000 == 0 {
            return Err(StoreError::Invalid(format!(
                "Global database root must not be writable by other users: {}",
                root.display()
            )));
        }
    }
    Ok(root)
}

fn database_path_in_root(root: &Path, database_path: &Path) -> Result<PathBuf, StoreError> {
    let file_name = database_path.file_name().ok_or_else(|| {
        StoreError::Invalid("Global database path must include a file name".into())
    })?;
    Ok(root.join(file_name))
}

fn ensure_private_root(root: &Path, database_path: &Path) -> Result<PathBuf, StoreError> {
    let directory = root.join(CONTROL_DIRECTORY);
    ensure_private_directory(&directory)?;
    let mut path = directory;
    let key = database_lock_key(database_path)?;
    for component in key.components() {
        path.push(component);
        ensure_private_directory(&path)?;
    }
    let control_root = fs::canonicalize(&path).map_err(|error| {
        StoreError::Unavailable(format!(
            "cannot resolve private Global admission directory {}: {error}",
            path.display()
        ))
    })?;
    if !control_root.starts_with(root) {
        return Err(StoreError::Invalid(
            "Global admission directory must remain beneath the Global database root".into(),
        ));
    }
    Ok(control_root)
}

fn ensure_private_directory(path: &Path) -> Result<(), StoreError> {
    let created = match create_private_directory(&path) {
        Ok(()) => true,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => false,
        Err(error) => {
            return Err(StoreError::Unavailable(format!(
                "cannot create private Global admission directory {}: {error}",
                path.display()
            )));
        }
    };
    let metadata = fs::symlink_metadata(&path).map_err(|error| {
        StoreError::Unavailable(format!(
            "cannot inspect private Global admission directory {}: {error}",
            path.display()
        ))
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(StoreError::Invalid(format!(
            "Global admission directory must be a regular directory: {}",
            path.display()
        )));
    }
    #[cfg(unix)]
    if created {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).map_err(|error| {
            StoreError::Unavailable(format!(
                "cannot secure private Global admission directory {}: {error}",
                path.display()
            ))
        })?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(&path)
            .map_err(|error| {
                StoreError::Unavailable(format!(
                    "cannot inspect private Global admission directory {}: {error}",
                    path.display()
                ))
            })?
            .permissions()
            .mode();
        if mode & 0o077 != 0 {
            return Err(StoreError::Invalid(format!(
                "Global admission directory must be private (mode 0700): {}",
                path.display()
            )));
        }
    }
    Ok(())
}

fn database_lock_key(database_path: &Path) -> Result<PathBuf, StoreError> {
    let name = database_path.file_name().ok_or_else(|| {
        StoreError::Invalid("Global database path must include a file name".into())
    })?;
    #[cfg(unix)]
    let bytes: Vec<u8> = {
        use std::os::unix::ffi::OsStrExt;
        name.as_bytes().to_vec()
    };
    #[cfg(not(unix))]
    let bytes = name.to_string_lossy().as_bytes().to_vec();
    if bytes.is_empty() {
        return Err(StoreError::Invalid(
            "Global database path must include a file name".into(),
        ));
    }
    let encoded = bytes
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let mut key = PathBuf::new();
    for component in encoded.as_bytes().chunks(200) {
        key.push(std::str::from_utf8(component).map_err(|error| {
            StoreError::Invalid(format!("Global database lock key is invalid: {error}"))
        })?);
    }
    Ok(key)
}

#[cfg(unix)]
fn create_private_directory(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::DirBuilderExt;
    let mut builder = fs::DirBuilder::new();
    builder.mode(0o700);
    builder.create(path)
}

#[cfg(not(unix))]
fn create_private_directory(path: &Path) -> std::io::Result<()> {
    fs::create_dir(path)
}

fn open_lock_file(root: &Path) -> Result<File, StoreError> {
    let path = root.join(LOCK_FILE);
    match fs::symlink_metadata(&path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            return Err(StoreError::Invalid(format!(
                "Global admission lock must be a regular non-symlink file: {}",
                path.display()
            )));
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(StoreError::Unavailable(format!(
                "cannot inspect Global admission lock {}: {error}",
                path.display()
            )));
        }
    }
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options.open(&path).map_err(|error| {
        StoreError::Unavailable(format!(
            "cannot open Global admission lock {}: {error}",
            path.display()
        ))
    })?;
    let metadata = file.metadata().map_err(|error| {
        StoreError::Unavailable(format!(
            "cannot inspect opened Global admission lock {}: {error}",
            path.display()
        ))
    })?;
    if !metadata.is_file() {
        return Err(StoreError::Invalid(format!(
            "Global admission lock must be a regular file: {}",
            path.display()
        )));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(fs::Permissions::from_mode(0o600))
            .map_err(|error| {
                StoreError::Unavailable(format!(
                    "cannot secure Global admission lock {}: {error}",
                    path.display()
                ))
            })?;
    }
    Ok(file)
}

#[cfg(unix)]
fn acquire_os_lock(file: &File, mode: AdmissionMode) -> std::io::Result<()> {
    use std::os::fd::AsRawFd;
    use std::os::raw::c_int;

    const LOCK_SH: c_int = 1;
    const LOCK_EX: c_int = 2;
    const LOCK_NB: c_int = 4;

    unsafe extern "C" {
        fn flock(fd: c_int, operation: c_int) -> c_int;
    }

    let operation = match mode {
        AdmissionMode::Shared => LOCK_SH,
        AdmissionMode::Exclusive => LOCK_EX,
    } | LOCK_NB;
    // SAFETY: `file` owns a valid descriptor for the duration of this call;
    // flock does not retain or mutate the Rust handle.
    let result = unsafe { flock(file.as_raw_fd(), operation) };
    if result == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(not(unix))]
fn acquire_os_lock(_file: &File, _mode: AdmissionMode) -> std::io::Result<()> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "Global OS-backed maintenance admission is supported on Unix platforms only",
    ))
}

fn admission_busy(
    root: &Path,
    attempted_operation_id: &str,
    purpose: &str,
    error: std::io::Error,
) -> StoreError {
    if error.kind() != std::io::ErrorKind::WouldBlock {
        return StoreError::Unavailable(format!(
            "cannot acquire {purpose} admission for operation {attempted_operation_id}: {error}"
        ));
    }
    match read_owner_record(root) {
        Ok(owner) => StoreError::Busy(format!(
            "Global admission is busy for operation {attempted_operation_id}; operation {} ({}) owns maintenance admission",
            owner.operation_id, owner.kind
        )),
        Err(_) => StoreError::Busy(format!(
            "Global admission is busy for operation {attempted_operation_id}; active owner identity is unknown"
        )),
    }
}

fn owner_path(root: &Path) -> PathBuf {
    root.join(OWNER_FILE)
}

fn read_owner_record(root: &Path) -> Result<OwnerRecord, StoreError> {
    let path = owner_path(root);
    match fs::symlink_metadata(&path) {
        Ok(_) => read_owner_record_at(&path),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            // The OS lock is acquired before the atomic rename publishes the
            // final record. A valid temporary record names that owner during
            // the short publication window.
            read_owner_record_at(&root.join(OWNER_TEMP_FILE))
        }
        Err(error) => Err(StoreError::Invalid(format!(
            "cannot inspect Global maintenance owner metadata {}: {error}",
            path.display()
        ))),
    }
}

fn read_owner_record_at(path: &Path) -> Result<OwnerRecord, StoreError> {
    match fs::symlink_metadata(&path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            return Err(StoreError::Invalid(format!(
                "Global maintenance owner metadata must be a regular non-symlink file: {}",
                path.display()
            )));
        }
        Ok(_) => {}
        Err(error) => {
            return Err(StoreError::Invalid(format!(
                "cannot inspect Global maintenance owner metadata {}: {error}",
                path.display()
            )));
        }
    }
    let mut file = File::open(path).map_err(|error| {
        StoreError::Invalid(format!(
            "cannot read Global maintenance owner metadata {}: {error}",
            path.display()
        ))
    })?;
    let mut encoded = String::new();
    file.read_to_string(&mut encoded).map_err(|error| {
        StoreError::Invalid(format!(
            "cannot read Global maintenance owner metadata {}: {error}",
            path.display()
        ))
    })?;
    let value: serde_json::Value = serde_json::from_str(&encoded).map_err(|error| {
        StoreError::Invalid(format!(
            "Global maintenance owner metadata is invalid: {error}"
        ))
    })?;
    if value.get("format").and_then(serde_json::Value::as_str) != Some(OWNER_FORMAT) {
        return Err(StoreError::Invalid(
            "Global maintenance owner metadata format is unsupported".into(),
        ));
    }
    let operation_id = value
        .get("operation_id")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| {
            StoreError::Invalid("Global maintenance owner operation ID is missing".into())
        })?;
    validate_operation_id(operation_id)?;
    let kind = value
        .get("kind")
        .and_then(serde_json::Value::as_str)
        .filter(|kind| matches!(*kind, "restore" | "migration" | "machine_update"))
        .ok_or_else(|| {
            StoreError::Invalid("Global maintenance owner kind is unsupported".into())
        })?;
    Ok(OwnerRecord {
        operation_id: operation_id.to_owned(),
        kind: kind.to_owned(),
    })
}

fn publish_owner_record(root: &Path, owner: &OwnerRecord) -> Result<(), StoreError> {
    let temporary = root.join(OWNER_TEMP_FILE);
    let destination = owner_path(root);
    for path in [&temporary, &destination] {
        match fs::symlink_metadata(path) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
                return Err(StoreError::Invalid(format!(
                    "Global maintenance metadata must be a regular non-symlink file: {}",
                    path.display()
                )));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(StoreError::Unavailable(format!(
                    "cannot inspect Global maintenance metadata {}: {error}",
                    path.display()
                )));
            }
        }
    }
    let encoded = serde_json::json!({
        "format": OWNER_FORMAT,
        "operation_id": owner.operation_id,
        "kind": owner.kind,
    });
    let mut options = OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temporary).map_err(|error| {
        StoreError::Unavailable(format!(
            "cannot create Global maintenance owner metadata {}: {error}",
            temporary.display()
        ))
    })?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(fs::Permissions::from_mode(0o600))
            .map_err(|error| {
                StoreError::Unavailable(format!(
                    "cannot secure Global maintenance owner metadata: {error}"
                ))
            })?;
    }
    serde_json::to_writer(&mut file, &encoded)
        .map_err(|error| StoreError::Unavailable(error.to_string()))?;
    file.sync_all().map_err(|error| {
        StoreError::Unavailable(format!(
            "cannot persist Global maintenance owner metadata: {error}"
        ))
    })?;
    drop(file);
    fs::rename(&temporary, &destination).map_err(|error| {
        StoreError::Unavailable(format!(
            "cannot publish Global maintenance owner metadata: {error}"
        ))
    })?;
    File::open(root)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| {
            StoreError::Unavailable(format!(
                "cannot persist Global maintenance owner directory entry: {error}"
            ))
        })?;
    Ok(())
}

fn clear_owner_record(root: &Path) -> Result<(), StoreError> {
    for path in [owner_path(root), root.join(OWNER_TEMP_FILE)] {
        match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
                return Err(StoreError::Invalid(format!(
                    "Global maintenance owner metadata must be a regular non-symlink file: {}",
                    path.display()
                )));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => {
                return Err(StoreError::Unavailable(format!(
                    "cannot inspect Global maintenance owner metadata {}: {error}",
                    path.display()
                )));
            }
        }
        if let Err(error) = fs::remove_file(&path) {
            if error.kind() != std::io::ErrorKind::NotFound {
                return Err(StoreError::Unavailable(format!(
                    "cannot clear stale Global maintenance metadata: {error}"
                )));
            }
        }
    }
    Ok(())
}

fn remove_owner_record_if_matches(root: &Path, expected: &OwnerRecord) -> Result<(), StoreError> {
    if read_owner_record(root).ok().as_ref() != Some(expected) {
        return Ok(());
    }
    match fs::remove_file(owner_path(root)) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(StoreError::Unavailable(format!(
            "cannot remove Global maintenance owner metadata: {error}"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_ROOT: AtomicU64 = AtomicU64::new(1);

    fn database_path(label: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "boreal-global-maintenance-{label}-{}-{}",
            std::process::id(),
            NEXT_ROOT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&root).unwrap();
        root.join("global.sqlite")
    }

    fn remove_root(database_path: &Path) {
        if let Some(root) = database_path.parent() {
            let _ = fs::remove_dir_all(root);
        }
    }

    #[cfg(unix)]
    #[test]
    fn maintenance_owner_is_named_and_never_force_broken() {
        let database = database_path("owner");
        let maintenance = GlobalMaintenanceGuard::acquire_exclusive(
            &database,
            "op_restore_one",
            GlobalMaintenanceKind::Restore,
        )
        .unwrap();

        let error = GlobalMaintenanceGuard::acquire_shared(&database, "op_read_one").unwrap_err();
        assert!(matches!(error, StoreError::Busy(_)));
        assert!(error.to_string().contains("op_restore_one"));
        assert!(error.to_string().contains("restore"));
        assert_eq!(
            maintenance.operation_id().as_deref(),
            Some("op_restore_one")
        );

        drop(maintenance);
        let ordinary = GlobalMaintenanceGuard::acquire_shared(&database, "op_read_two").unwrap();
        assert!(ordinary.inner.mode == AdmissionMode::Shared);
        drop(ordinary);
        remove_root(&database);
    }

    #[cfg(unix)]
    #[test]
    fn ordinary_access_is_shared_and_maintenance_waits_without_breaking_it() {
        let database = database_path("shared");
        let first = GlobalMaintenanceGuard::acquire_shared(&database, "open_one").unwrap();
        let second = GlobalMaintenanceGuard::acquire_shared(&database, "open_two").unwrap();
        let error = GlobalMaintenanceGuard::acquire_exclusive(
            &database,
            "op_migrate_one",
            GlobalMaintenanceKind::Migration,
        )
        .unwrap_err();
        assert!(matches!(error, StoreError::Busy(_)));
        assert!(error.to_string().contains("op_migrate_one"));
        assert!(error.to_string().contains("unknown"));
        assert!(matches!(
            GlobalMaintenanceGuard::acquire_migration(
                &database,
                "op_migrate_waiter",
                Duration::from_secs(1),
                false,
            ),
            Err(StoreError::Busy(_))
        ));

        drop(first);
        assert!(matches!(
            GlobalMaintenanceGuard::acquire_exclusive(
                &database,
                "op_migrate_two",
                GlobalMaintenanceKind::Migration
            ),
            Err(StoreError::Busy(_))
        ));
        drop(second);
        let maintenance = GlobalMaintenanceGuard::acquire_exclusive(
            &database,
            "op_migrate_three",
            GlobalMaintenanceKind::Migration,
        )
        .unwrap();
        assert_eq!(
            maintenance.operation_id().as_deref(),
            Some("op_migrate_three")
        );
        drop(maintenance);
        remove_root(&database);
    }

    #[cfg(unix)]
    #[test]
    fn migration_admission_waits_only_for_a_live_migration_owner() {
        let database = database_path("migration-contention");
        let owner = GlobalMaintenanceGuard::acquire_exclusive(
            &database,
            "op_migration_owner",
            GlobalMaintenanceKind::Migration,
        )
        .unwrap();
        let waiter_database = database.clone();
        let waiter = std::thread::spawn(move || {
            GlobalMaintenanceGuard::acquire_migration(
                waiter_database,
                "op_migration_waiter",
                Duration::from_secs(1),
                false,
            )
        });
        std::thread::sleep(Duration::from_millis(40));
        drop(owner);
        let acquired = waiter.join().unwrap().unwrap().unwrap();
        assert_eq!(
            acquired.operation_id().as_deref(),
            Some("op_migration_waiter")
        );
        drop(acquired);
        remove_root(&database);
    }

    #[cfg(unix)]
    #[test]
    fn stale_or_unknown_owner_metadata_never_substitutes_for_os_ownership() {
        let database = database_path("stale");
        let root =
            ensure_private_root(&global_database_root(&database).unwrap(), &database).unwrap();
        fs::write(
            owner_path(&root),
            r#"{"format":"boreal.global-maintenance-owner/1","operation_id":"op_stale","kind":"restore"}"#,
        )
        .unwrap();
        fs::write(
            root.join(OWNER_TEMP_FILE),
            r#"{"format":"boreal.global-maintenance-owner/1","operation_id":"op_stale_tmp","kind":"migration"}"#,
        )
        .unwrap();

        let ordinary =
            GlobalMaintenanceGuard::acquire_shared(&database, "open_after_crash").unwrap();
        assert!(!owner_path(&root).exists());
        assert!(!root.join(OWNER_TEMP_FILE).exists());
        assert!(matches!(
            GlobalMaintenanceGuard::acquire_exclusive(
                &database,
                "op_after_crash",
                GlobalMaintenanceKind::Restore
            ),
            Err(StoreError::Busy(_))
        ));
        drop(ordinary);

        let owner = GlobalMaintenanceGuard::acquire_exclusive(
            &database,
            "op_current",
            GlobalMaintenanceKind::Restore,
        )
        .unwrap();
        fs::write(owner_path(&root), b"unreadable owner metadata").unwrap();
        let error =
            GlobalMaintenanceGuard::acquire_shared(&database, "open_unknown_owner").unwrap_err();
        assert!(matches!(error, StoreError::Busy(_)));
        assert!(error.to_string().contains("unknown"));
        drop(owner);
        remove_root(&database);
    }

    #[cfg(unix)]
    #[test]
    fn malformed_or_symlink_owner_metadata_fails_closed_on_contention() {
        let database = database_path("unknown-owner");
        let root =
            ensure_private_root(&global_database_root(&database).unwrap(), &database).unwrap();
        let ordinary = GlobalMaintenanceGuard::acquire_shared(&database, "open_active").unwrap();
        let external = database.with_extension("external-owner");
        fs::write(&external, b"must not be read as trusted metadata").unwrap();
        std::os::unix::fs::symlink(&external, owner_path(&root)).unwrap();

        let error = GlobalMaintenanceGuard::acquire_exclusive(
            &database,
            "op_restore_unknown_owner",
            GlobalMaintenanceKind::Restore,
        )
        .unwrap_err();
        assert!(matches!(error, StoreError::Busy(_)));
        assert!(error.to_string().contains("unknown"));
        assert!(owner_path(&root).is_symlink());

        drop(ordinary);
        let still_fails_closed =
            GlobalMaintenanceGuard::acquire_shared(&database, "open_symlink").unwrap_err();
        assert!(matches!(still_fails_closed, StoreError::Invalid(_)));
        let _ = fs::remove_file(&external);
        remove_root(&database);
    }

    #[cfg(unix)]
    #[test]
    fn non_private_admission_directory_fails_closed() {
        use std::os::unix::fs::PermissionsExt;

        let database = database_path("permissions");
        let root =
            ensure_private_root(&global_database_root(&database).unwrap(), &database).unwrap();
        fs::set_permissions(&root, fs::Permissions::from_mode(0o755)).unwrap();

        let error = GlobalMaintenanceGuard::acquire_shared(&database, "open_untrusted_directory")
            .unwrap_err();
        assert!(matches!(error, StoreError::Invalid(_)));
        assert!(error.to_string().contains("must be private"));
        remove_root(&database);
    }
}
