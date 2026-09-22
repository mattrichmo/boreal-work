# R-SERVICE-ELECTION — crates/service/src/election.rs

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `crates/service/src/election.rs:L1–L333`  
**File SHA-256:** `923fc572a91d24b68644c7baf7e9052cfe06ef767f4dbd67d145b40d6c5a7b10`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Single service election and lock ownership; never force-break a live lock.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,333p' 'crates/service/src/election.rs'
```

## Exact baseline excerpt

````text
    1 | use crate::BusyOutcome;
    2 | use std::fmt;
    3 | use std::fs::{self, File, OpenOptions};
    4 | use std::io::{self, Read, Seek, SeekFrom, Write};
    5 | use std::path::{Path, PathBuf};
    6 | 
    7 | #[cfg(unix)]
    8 | use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
    9 | #[cfg(unix)]
   10 | use std::os::unix::io::AsRawFd;
   11 | 
   12 | #[cfg(unix)]
   13 | const LOCK_EX: i32 = 2;
   14 | #[cfg(unix)]
   15 | const LOCK_NB: i32 = 4;
   16 | #[cfg(unix)]
   17 | const LOCK_UN: i32 = 8;
   18 | 
   19 | #[cfg(unix)]
   20 | unsafe extern "C" {
   21 |     fn flock(fd: i32, operation: i32) -> i32;
   22 | }
   23 | 
   24 | /// Failure to acquire a local project owner election.
   25 | #[derive(Debug)]
   26 | pub enum ElectionError {
   27 |     InvalidIdentity(&'static str),
   28 |     Busy(BusyOutcome),
   29 |     Io(io::Error),
   30 | }
   31 | 
   32 | impl fmt::Display for ElectionError {
   33 |     fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
   34 |         match self {
   35 |             Self::InvalidIdentity(field) => write!(formatter, "{field} must be non-empty and safe"),
   36 |             Self::Busy(outcome) => outcome.fmt(formatter),
   37 |             Self::Io(error) => error.fmt(formatter),
   38 |         }
   39 |     }
   40 | }
   41 | 
   42 | impl std::error::Error for ElectionError {
   43 |     fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
   44 |         match self {
   45 |             Self::Io(error) => Some(error),
   46 |             Self::InvalidIdentity(_) | Self::Busy(_) => None,
   47 |         }
   48 |     }
   49 | }
   50 | 
   51 | impl From<io::Error> for ElectionError {
   52 |     fn from(error: io::Error) -> Self {
   53 |         Self::Io(error)
   54 |     }
   55 | }
   56 | 
   57 | /// An elected owner for one project on the local host.
   58 | ///
   59 | /// Unix uses an advisory `flock`, so the OS releases ownership if the process
   60 | /// exits unexpectedly. The lock file is intentionally retained: deleting a
   61 | /// pathname on release can race a new owner opening it and create two lock
   62 | /// files. The runtime directory can safely retain these small identity files.
   63 | #[derive(Debug)]
   64 | pub struct ProjectElection {
   65 |     project_id: String,
   66 |     owner_id: String,
   67 |     lock_path: PathBuf,
   68 |     file: Option<File>,
   69 | }
   70 | 
   71 | impl ProjectElection {
   72 |     pub fn try_acquire(
   73 |         runtime_dir: impl AsRef<Path>,
   74 |         project_id: impl Into<String>,
   75 |         owner_id: impl Into<String>,
   76 |     ) -> Result<Self, ElectionError> {
   77 |         let project_id = project_id.into();
   78 |         let owner_id = owner_id.into();
   79 |         validate_identity("project_id", &project_id)?;
   80 |         validate_identity("owner_id", &owner_id)?;
   81 | 
   82 |         let runtime_dir = runtime_dir.as_ref();
   83 |         fs::create_dir_all(runtime_dir)?;
   84 |         #[cfg(unix)]
   85 |         fs::set_permissions(runtime_dir, fs::Permissions::from_mode(0o700))?;
   86 | 
   87 |         let lock_path = runtime_dir.join(lock_file_name(&project_id));
   88 |         let mut options = OpenOptions::new();
   89 |         options.read(true).write(true).create(true);
   90 |         #[cfg(unix)]
   91 |         options.mode(0o600);
   92 |         let file = options.open(&lock_path)?;
   93 | 
   94 |         #[cfg(unix)]
   95 |         let acquired = acquire_unix_lock(&file)?;
   96 |         #[cfg(not(unix))]
   97 |         let acquired = acquire_fallback_lock(&lock_path, &file)?;
   98 | 
   99 |         if !acquired {
  100 |             return Err(ElectionError::Busy(BusyOutcome::ProjectAlreadyOwned {
  101 |                 project_id,
  102 |                 owner_id: read_owner_id(&file),
  103 |             }));
  104 |         }
  105 | 
  106 |         write_metadata(&file, &project_id, &owner_id)?;
  107 |         Ok(Self {
  108 |             project_id,
  109 |             owner_id,
  110 |             lock_path,
  111 |             file: Some(file),
  112 |         })
  113 |     }
  114 | 
  115 |     pub fn project_id(&self) -> &str {
  116 |         &self.project_id
  117 |     }
  118 | 
  119 |     pub fn owner_id(&self) -> &str {
  120 |         &self.owner_id
  121 |     }
  122 | 
  123 |     pub fn lock_path(&self) -> &Path {
  124 |         &self.lock_path
  125 |     }
  126 | 
  127 |     pub fn release(mut self) {
  128 |         self.release_inner();
  129 |     }
  130 | 
  131 |     fn release_inner(&mut self) {
  132 |         let Some(file) = self.file.take() else {
  133 |             return;
  134 |         };
  135 |         #[cfg(unix)]
  136 |         unsafe {
  137 |             let _ = flock(file.as_raw_fd(), LOCK_UN);
  138 |         }
  139 |         #[cfg(not(unix))]
  140 |         {
  141 |             let marker = self.lock_path.with_extension("owner");
  142 |             drop(file);
  143 |             let _ = fs::remove_file(marker);
  144 |         }
  145 |         #[cfg(unix)]
  146 |         drop(file);
  147 |     }
  148 | }
  149 | 
  150 | impl Drop for ProjectElection {
  151 |     fn drop(&mut self) {
  152 |         self.release_inner();
  153 |     }
  154 | }
  155 | 
  156 | fn validate_identity(field: &'static str, value: &str) -> Result<(), ElectionError> {
  157 |     if value.trim().is_empty() || value.chars().any(|character| character.is_control()) {
  158 |         return Err(ElectionError::InvalidIdentity(field));
  159 |     }
  160 |     Ok(())
  161 | }
  162 | 
  163 | fn lock_file_name(project_id: &str) -> String {
  164 |     const HEX: &[u8; 16] = b"0123456789abcdef";
  165 |     let mut encoded = String::with_capacity(project_id.len() * 2);
  166 |     for byte in project_id.bytes() {
  167 |         encoded.push(HEX[(byte >> 4) as usize] as char);
  168 |         encoded.push(HEX[(byte & 0x0f) as usize] as char);
  169 |     }
  170 |     if encoded.len() <= 200 {
  171 |         format!("boreal-project-{encoded}.lock")
  172 |     } else {
  173 |         format!(
  174 |             "boreal-project-h{:016x}.lock",
  175 |             stable_hash(project_id.as_bytes())
  176 |         )
  177 |     }
  178 | }
  179 | 
  180 | fn stable_hash(bytes: &[u8]) -> u64 {
  181 |     bytes.iter().fold(0xcbf29ce484222325, |hash, byte| {
  182 |         (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3)
  183 |     })
  184 | }
  185 | 
  186 | fn write_metadata(file: &File, project_id: &str, owner_id: &str) -> io::Result<()> {
  187 |     let mut file = file;
  188 |     file.set_len(0)?;
  189 |     file.seek(SeekFrom::Start(0))?;
  190 |     writeln!(file, "project={project_id}")?;
  191 |     writeln!(file, "owner={owner_id}")?;
  192 |     file.flush()
  193 | }
  194 | 
  195 | fn read_owner_id(file: &File) -> Option<String> {
  196 |     let mut file = file.try_clone().ok()?;
  197 |     file.seek(SeekFrom::Start(0)).ok()?;
  198 |     let mut contents = String::new();
  199 |     file.read_to_string(&mut contents).ok()?;
  200 |     contents
  201 |         .lines()
  202 |         .find_map(|line| line.strip_prefix("owner="))
  203 |         .filter(|owner| !owner.is_empty())
  204 |         .map(str::to_owned)
  205 | }
  206 | 
  207 | #[cfg(unix)]
  208 | fn acquire_unix_lock(file: &File) -> io::Result<bool> {
  209 |     let result = unsafe { flock(file.as_raw_fd(), LOCK_EX | LOCK_NB) };
  210 |     if result == 0 {
  211 |         Ok(true)
  212 |     } else {
  213 |         let error = io::Error::last_os_error();
  214 |         if error.kind() == io::ErrorKind::WouldBlock {
  215 |             Ok(false)
  216 |         } else {
  217 |             Err(error)
  218 |         }
  219 |     }
  220 | }
  221 | 
  222 | #[cfg(not(unix))]
  223 | fn acquire_fallback_lock(path: &Path, _file: &File) -> io::Result<bool> {
  224 |     // The fallback is only for platforms without the Unix advisory-lock API.
  225 |     // Normal release removes the marker; crash recovery on such a platform
  226 |     // needs a platform-specific owner implementation before production use.
  227 |     let marker = path.with_extension("owner");
  228 |     match OpenOptions::new().write(true).create_new(true).open(marker) {
  229 |         Ok(_) => Ok(true),
  230 |         Err(error) if error.kind() == io::ErrorKind::AlreadyExists => Ok(false),
  231 |         Err(error) => Err(error),
  232 |     }
  233 | }
  234 | 
  235 | #[cfg(test)]
  236 | mod tests {
  237 |     use super::*;
  238 |     use std::sync::{
  239 |         atomic::{AtomicU64, Ordering},
  240 |         Arc, Barrier,
  241 |     };
  242 |     use std::thread;
  243 |     use std::time::{SystemTime, UNIX_EPOCH};
  244 | 
  245 |     fn temp_runtime_dir() -> PathBuf {
  246 |         static NEXT: AtomicU64 = AtomicU64::new(0);
  247 |         let nonce = SystemTime::now()
  248 |             .duration_since(UNIX_EPOCH)
  249 |             .unwrap()
  250 |             .as_nanos();
  251 |         let suffix = NEXT.fetch_add(1, Ordering::Relaxed);
  252 |         let path = std::env::temp_dir().join(format!("boreal-service-election-{nonce}-{suffix}"));
  253 |         fs::create_dir(&path).unwrap();
  254 |         path
  255 |     }
  256 | 
  257 |     #[test]
  258 |     fn one_project_has_one_live_owner_and_releases_cleanly() {
  259 |         let runtime = temp_runtime_dir();
  260 |         let first = ProjectElection::try_acquire(&runtime, "project-1", "owner-a").unwrap();
  261 |         assert_eq!(first.project_id(), "project-1");
  262 |         assert_eq!(first.owner_id(), "owner-a");
  263 | 
  264 |         let second = ProjectElection::try_acquire(&runtime, "project-1", "owner-b");
  265 |         match second {
  266 |             Err(ElectionError::Busy(BusyOutcome::ProjectAlreadyOwned {
  267 |                 project_id,
  268 |                 owner_id,
  269 |             })) => {
  270 |                 assert_eq!(project_id, "project-1");
  271 |                 assert_eq!(owner_id.as_deref(), Some("owner-a"));
  272 |             }
  273 |             other => panic!("expected typed ownership busy result, got {other:?}"),
  274 |         }
  275 | 
  276 |         let lock_path = first.lock_path().to_owned();
  277 |         drop(first);
  278 |         let third = ProjectElection::try_acquire(&runtime, "project-1", "owner-c").unwrap();
  279 |         assert_eq!(third.lock_path(), lock_path.as_path());
  280 |         drop(third);
  281 |         fs::remove_dir_all(runtime).unwrap();
  282 |     }
  283 | 
  284 |     #[test]
  285 |     fn concurrent_election_attempts_yield_exactly_one_owner() {
  286 |         let runtime = Arc::new(temp_runtime_dir());
  287 |         let start = Arc::new(Barrier::new(9));
  288 |         let attempts = (0..8)
  289 |             .map(|index| {
  290 |                 let runtime = Arc::clone(&runtime);
  291 |                 let start = Arc::clone(&start);
  292 |                 thread::spawn(move || {
  293 |                     start.wait();
  294 |                     ProjectElection::try_acquire(
  295 |                         &*runtime,
  296 |                         "same-project",
  297 |                         format!("owner-{index}"),
  298 |                     )
  299 |                 })
  300 |             })
  301 |             .collect::<Vec<_>>();
  302 |         start.wait();
  303 | 
  304 |         let results = attempts
  305 |             .into_iter()
  306 |             .map(|attempt| attempt.join().unwrap())
  307 |             .collect::<Vec<_>>();
  308 |         assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
  309 |         assert_eq!(
  310 |             results
  311 |                 .iter()
  312 |                 .filter(|result| matches!(result, Err(ElectionError::Busy(_))))
  313 |                 .count(),
  314 |             7
  315 |         );
  316 |         drop(results);
  317 |         fs::remove_dir_all(&*runtime).unwrap();
  318 |     }
  319 | 
  320 |     #[test]
  321 |     fn invalid_identity_is_rejected_before_election() {
  322 |         let runtime = temp_runtime_dir();
  323 |         assert!(matches!(
  324 |             ProjectElection::try_acquire(&runtime, "", "owner"),
  325 |             Err(ElectionError::InvalidIdentity("project_id"))
  326 |         ));
  327 |         assert!(matches!(
  328 |             ProjectElection::try_acquire(&runtime, "project", "bad\nowner"),
  329 |             Err(ElectionError::InvalidIdentity("owner_id"))
  330 |         ));
  331 |         fs::remove_dir_all(runtime).unwrap();
  332 |     }
  333 | }
````
