//! OS-owned admission boundary for physical Global database maintenance.
//!
//! Normal Global stores retain a shared advisory lock for the lifetime of
//! their SQLite connection. Restore and migration take the same lock
//! exclusively, so a live service is reported as busy and is never evicted.

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use crate::StoreError;

#[cfg(unix)]
use std::os::unix::{fs::OpenOptionsExt, io::AsRawFd};

#[cfg(unix)]
const LOCK_SH: i32 = 1;
#[cfg(unix)]
const LOCK_EX: i32 = 2;
#[cfg(unix)]
const LOCK_NB: i32 = 4;
#[cfg(unix)]
const LOCK_UN: i32 = 8;

#[cfg(unix)]
unsafe extern "C" {
    fn flock(fd: i32, operation: i32) -> i32;
}

/// A held shared Global-use lock or exclusive maintenance lock.
#[derive(Debug)]
pub struct GlobalMaintenanceGuard {
    file: File,
    exclusive: bool,
    operation_id: Option<String>,
}

impl GlobalMaintenanceGuard {
    /// Acquire ordinary-use admission. The lock is held until the store closes.
    pub fn try_shared(database_path: impl AsRef<Path>) -> Result<Self, StoreError> {
        Self::acquire(database_path.as_ref(), false, None)
    }

    /// Acquire exclusive maintenance admission and publish its operation ID.
    pub fn try_exclusive(
        database_path: impl AsRef<Path>,
        operation_id: &str,
    ) -> Result<Self, StoreError> {
        if operation_id.trim().is_empty() || operation_id.chars().any(char::is_control) {
            return Err(StoreError::Invalid(
                "Global maintenance operation ID must be non-empty and safe".into(),
            ));
        }
        Self::acquire(database_path.as_ref(), true, Some(operation_id.to_owned()))
    }

    pub fn operation_id(&self) -> Option<&str> {
        self.operation_id.as_deref()
    }

    /// Downgrade a completed maintenance owner to ordinary-use admission
    /// without exposing a gap in which another writer could replace the DB.
    pub fn downgrade_to_shared(&mut self) -> Result<(), StoreError> {
        if !self.exclusive {
            return Ok(());
        }
        self.file.set_len(0).map_err(|error| {
            StoreError::Unavailable(format!("cannot clear Global maintenance metadata: {error}"))
        })?;
        self.file.sync_all().map_err(|error| {
            StoreError::Unavailable(format!("cannot sync Global maintenance metadata: {error}"))
        })?;
        #[cfg(unix)]
        if unsafe { flock(self.file.as_raw_fd(), LOCK_SH) } != 0 {
            let error = std::io::Error::last_os_error();
            return Err(StoreError::Unavailable(format!(
                "cannot release Global maintenance admission: {error}"
            )));
        }
        #[cfg(not(unix))]
        return Err(StoreError::Unavailable(
            "Global maintenance admission requires an OS advisory lock on this platform".into(),
        ));
        self.exclusive = false;
        self.operation_id = None;
        Ok(())
    }

    pub fn lock_path_for(database_path: impl AsRef<Path>) -> PathBuf {
        database_path
            .as_ref()
            .parent()
            .unwrap_or(Path::new("."))
            .join(".global-maintenance.lock")
    }

    fn acquire(
        database_path: &Path,
        exclusive: bool,
        operation_id: Option<String>,
    ) -> Result<Self, StoreError> {
        let lock_path = Self::lock_path_for(database_path);
        let parent = lock_path.parent().unwrap_or(Path::new("."));
        fs::create_dir_all(parent).map_err(|error| {
            StoreError::Unavailable(format!(
                "cannot create Global maintenance directory {}: {error}",
                parent.display()
            ))
        })?;
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true);
        #[cfg(unix)]
        options.mode(0o600);
        let file = options.open(&lock_path).map_err(|error| {
            StoreError::Unavailable(format!(
                "cannot open Global maintenance lock {}: {error}",
                lock_path.display()
            ))
        })?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&lock_path, fs::Permissions::from_mode(0o600)).map_err(
                |error| {
                    StoreError::Unavailable(format!(
                        "cannot secure Global maintenance lock {}: {error}",
                        lock_path.display()
                    ))
                },
            )?;
            let mode = if exclusive { LOCK_EX } else { LOCK_SH };
            if unsafe { flock(file.as_raw_fd(), mode | LOCK_NB) } != 0 {
                let error = std::io::Error::last_os_error();
                if error.kind() == std::io::ErrorKind::WouldBlock {
                    return Err(StoreError::Busy(busy_message(&file, exclusive)));
                }
                return Err(StoreError::Unavailable(format!(
                    "cannot acquire Global maintenance lock {}: {error}",
                    lock_path.display()
                )));
            }
        }
        #[cfg(not(unix))]
        {
            let _ = (exclusive, operation_id.as_deref());
            return Err(StoreError::Unavailable(
                "Global maintenance admission requires an OS advisory lock on this platform".into(),
            ));
        }

        let mut guard = Self {
            file,
            exclusive,
            operation_id,
        };
        if guard.exclusive {
            guard.write_owner_metadata()?;
        }
        Ok(guard)
    }

    fn write_owner_metadata(&mut self) -> Result<(), StoreError> {
        let operation_id = self.operation_id.as_deref().unwrap_or_default();
        let metadata = format!("operation_id={operation_id}\n");
        self.file.set_len(0).map_err(|error| {
            StoreError::Unavailable(format!("cannot prepare Global maintenance lock: {error}"))
        })?;
        self.file.seek(SeekFrom::Start(0)).map_err(|error| {
            StoreError::Unavailable(format!("cannot write Global maintenance lock: {error}"))
        })?;
        self.file.write_all(metadata.as_bytes()).map_err(|error| {
            StoreError::Unavailable(format!("cannot write Global maintenance lock: {error}"))
        })?;
        self.file.sync_all().map_err(|error| {
            StoreError::Unavailable(format!("cannot sync Global maintenance lock: {error}"))
        })
    }
}

impl Drop for GlobalMaintenanceGuard {
    fn drop(&mut self) {
        if self.exclusive {
            let _ = self.file.set_len(0);
            let _ = self.file.sync_all();
        }
        #[cfg(unix)]
        unsafe {
            let _ = flock(self.file.as_raw_fd(), LOCK_UN);
        }
    }
}

fn busy_message(file: &File, requesting_exclusive: bool) -> String {
    let mut clone = match file.try_clone() {
        Ok(clone) => clone,
        Err(_) => return "Global database is held by an active reader or writer".into(),
    };
    if clone.seek(SeekFrom::Start(0)).is_err() {
        return "Global database is held by an active reader or writer".into();
    }
    let mut contents = String::new();
    if clone.read_to_string(&mut contents).is_ok() {
        if let Some(operation_id) = contents
            .lines()
            .find_map(|line| line.strip_prefix("operation_id="))
            .filter(|value| !value.trim().is_empty())
        {
            return format!(
                "Global maintenance operation {operation_id} already owns the database"
            );
        }
    }
    if requesting_exclusive {
        "Global database has active readers or writers; maintenance was not started".into()
    } else {
        "Global maintenance is active; retry after its operation completes".into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn root() -> PathBuf {
        std::env::temp_dir().join(format!(
            "boreal-global-maintenance-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[cfg(unix)]
    #[test]
    fn exclusive_maintenance_reports_operation_without_breaking_shared_owner() {
        let root = root();
        fs::create_dir_all(&root).unwrap();
        let database = root.join("global.sqlite");
        let ordinary = GlobalMaintenanceGuard::try_shared(&database).unwrap();
        let error = GlobalMaintenanceGuard::try_exclusive(&database, "restore-17")
            .expect_err("active ordinary owner must block maintenance");
        assert!(
            matches!(error, StoreError::Busy(message) if message.contains("active readers or writers"))
        );
        drop(ordinary);

        let maintenance = GlobalMaintenanceGuard::try_exclusive(&database, "restore-17").unwrap();
        assert_eq!(maintenance.operation_id(), Some("restore-17"));
        let error = GlobalMaintenanceGuard::try_shared(&database)
            .expect_err("ordinary store open must wait for maintenance");
        assert!(matches!(error, StoreError::Busy(message) if message.contains("restore-17")));
        drop(maintenance);
        assert!(GlobalMaintenanceGuard::try_shared(&database).is_ok());
        let _ = fs::remove_dir_all(root);
    }
}
