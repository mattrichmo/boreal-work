use crate::BusyOutcome;
use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
#[cfg(unix)]
use std::os::unix::io::AsRawFd;

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

/// Failure to acquire a local project owner election.
#[derive(Debug)]
pub enum ElectionError {
    InvalidIdentity(&'static str),
    Busy(BusyOutcome),
    Io(io::Error),
}

impl fmt::Display for ElectionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidIdentity(field) => write!(formatter, "{field} must be non-empty and safe"),
            Self::Busy(outcome) => outcome.fmt(formatter),
            Self::Io(error) => error.fmt(formatter),
        }
    }
}

impl std::error::Error for ElectionError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io(error) => Some(error),
            Self::InvalidIdentity(_) | Self::Busy(_) => None,
        }
    }
}

impl From<io::Error> for ElectionError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

/// An elected owner for one project on the local host.
///
/// Unix uses an advisory `flock`, so the OS releases ownership if the process
/// exits unexpectedly. The lock file is intentionally retained: deleting a
/// pathname on release can race a new owner opening it and create two lock
/// files. The runtime directory can safely retain these small identity files.
#[derive(Debug)]
pub struct ProjectElection {
    project_id: String,
    owner_id: String,
    lock_path: PathBuf,
    file: Option<File>,
}

impl ProjectElection {
    pub fn try_acquire(
        runtime_dir: impl AsRef<Path>,
        project_id: impl Into<String>,
        owner_id: impl Into<String>,
    ) -> Result<Self, ElectionError> {
        let project_id = project_id.into();
        let owner_id = owner_id.into();
        validate_identity("project_id", &project_id)?;
        validate_identity("owner_id", &owner_id)?;

        let runtime_dir = runtime_dir.as_ref();
        fs::create_dir_all(runtime_dir)?;
        #[cfg(unix)]
        fs::set_permissions(runtime_dir, fs::Permissions::from_mode(0o700))?;

        let lock_path = runtime_dir.join(lock_file_name(&project_id));
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true);
        #[cfg(unix)]
        options.mode(0o600);
        let file = options.open(&lock_path)?;

        #[cfg(unix)]
        let acquired = acquire_unix_lock(&file)?;
        #[cfg(not(unix))]
        let acquired = acquire_fallback_lock(&lock_path, &file)?;

        if !acquired {
            return Err(ElectionError::Busy(BusyOutcome::ProjectAlreadyOwned {
                project_id,
                owner_id: read_owner_id(&file),
            }));
        }

        write_metadata(&file, &project_id, &owner_id)?;
        Ok(Self {
            project_id,
            owner_id,
            lock_path,
            file: Some(file),
        })
    }

    pub fn project_id(&self) -> &str {
        &self.project_id
    }

    pub fn owner_id(&self) -> &str {
        &self.owner_id
    }

    pub fn lock_path(&self) -> &Path {
        &self.lock_path
    }

    pub fn release(mut self) {
        self.release_inner();
    }

    fn release_inner(&mut self) {
        let Some(file) = self.file.take() else {
            return;
        };
        #[cfg(unix)]
        unsafe {
            let _ = flock(file.as_raw_fd(), LOCK_UN);
        }
        #[cfg(not(unix))]
        {
            let marker = self.lock_path.with_extension("owner");
            drop(file);
            let _ = fs::remove_file(marker);
        }
        #[cfg(unix)]
        drop(file);
    }
}

impl Drop for ProjectElection {
    fn drop(&mut self) {
        self.release_inner();
    }
}

fn validate_identity(field: &'static str, value: &str) -> Result<(), ElectionError> {
    if value.trim().is_empty() || value.chars().any(|character| character.is_control()) {
        return Err(ElectionError::InvalidIdentity(field));
    }
    Ok(())
}

fn lock_file_name(project_id: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(project_id.len() * 2);
    for byte in project_id.bytes() {
        encoded.push(HEX[(byte >> 4) as usize] as char);
        encoded.push(HEX[(byte & 0x0f) as usize] as char);
    }
    if encoded.len() <= 200 {
        format!("boreal-project-{encoded}.lock")
    } else {
        format!(
            "boreal-project-h{:016x}.lock",
            stable_hash(project_id.as_bytes())
        )
    }
}

fn stable_hash(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf29ce484222325, |hash, byte| {
        (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3)
    })
}

fn write_metadata(file: &File, project_id: &str, owner_id: &str) -> io::Result<()> {
    let mut file = file;
    file.set_len(0)?;
    file.seek(SeekFrom::Start(0))?;
    writeln!(file, "project={project_id}")?;
    writeln!(file, "owner={owner_id}")?;
    file.flush()
}

fn read_owner_id(file: &File) -> Option<String> {
    let mut file = file.try_clone().ok()?;
    file.seek(SeekFrom::Start(0)).ok()?;
    let mut contents = String::new();
    file.read_to_string(&mut contents).ok()?;
    contents
        .lines()
        .find_map(|line| line.strip_prefix("owner="))
        .filter(|owner| !owner.is_empty())
        .map(str::to_owned)
}

#[cfg(unix)]
fn acquire_unix_lock(file: &File) -> io::Result<bool> {
    let result = unsafe { flock(file.as_raw_fd(), LOCK_EX | LOCK_NB) };
    if result == 0 {
        Ok(true)
    } else {
        let error = io::Error::last_os_error();
        if error.kind() == io::ErrorKind::WouldBlock {
            Ok(false)
        } else {
            Err(error)
        }
    }
}

#[cfg(not(unix))]
fn acquire_fallback_lock(path: &Path, _file: &File) -> io::Result<bool> {
    // The fallback is only for platforms without the Unix advisory-lock API.
    // Normal release removes the marker; crash recovery on such a platform
    // needs a platform-specific owner implementation before production use.
    let marker = path.with_extension("owner");
    match OpenOptions::new().write(true).create_new(true).open(marker) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => Ok(false),
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Barrier,
    };
    use std::thread;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_runtime_dir() -> PathBuf {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let suffix = NEXT.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!("boreal-service-election-{nonce}-{suffix}"));
        fs::create_dir(&path).unwrap();
        path
    }

    #[test]
    fn one_project_has_one_live_owner_and_releases_cleanly() {
        let runtime = temp_runtime_dir();
        let first = ProjectElection::try_acquire(&runtime, "project-1", "owner-a").unwrap();
        assert_eq!(first.project_id(), "project-1");
        assert_eq!(first.owner_id(), "owner-a");

        let second = ProjectElection::try_acquire(&runtime, "project-1", "owner-b");
        match second {
            Err(ElectionError::Busy(BusyOutcome::ProjectAlreadyOwned {
                project_id,
                owner_id,
            })) => {
                assert_eq!(project_id, "project-1");
                assert_eq!(owner_id.as_deref(), Some("owner-a"));
            }
            other => panic!("expected typed ownership busy result, got {other:?}"),
        }

        let lock_path = first.lock_path().to_owned();
        drop(first);
        let third = ProjectElection::try_acquire(&runtime, "project-1", "owner-c").unwrap();
        assert_eq!(third.lock_path(), lock_path.as_path());
        drop(third);
        fs::remove_dir_all(runtime).unwrap();
    }

    #[test]
    fn concurrent_election_attempts_yield_exactly_one_owner() {
        let runtime = Arc::new(temp_runtime_dir());
        let start = Arc::new(Barrier::new(9));
        let attempts = (0..8)
            .map(|index| {
                let runtime = Arc::clone(&runtime);
                let start = Arc::clone(&start);
                thread::spawn(move || {
                    start.wait();
                    ProjectElection::try_acquire(
                        &*runtime,
                        "same-project",
                        format!("owner-{index}"),
                    )
                })
            })
            .collect::<Vec<_>>();
        start.wait();

        let results = attempts
            .into_iter()
            .map(|attempt| attempt.join().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(
            results
                .iter()
                .filter(|result| matches!(result, Err(ElectionError::Busy(_))))
                .count(),
            7
        );
        drop(results);
        fs::remove_dir_all(&*runtime).unwrap();
    }

    #[test]
    fn invalid_identity_is_rejected_before_election() {
        let runtime = temp_runtime_dir();
        assert!(matches!(
            ProjectElection::try_acquire(&runtime, "", "owner"),
            Err(ElectionError::InvalidIdentity("project_id"))
        ));
        assert!(matches!(
            ProjectElection::try_acquire(&runtime, "project", "bad\nowner"),
            Err(ElectionError::InvalidIdentity("owner_id"))
        ));
        fs::remove_dir_all(runtime).unwrap();
    }
}
