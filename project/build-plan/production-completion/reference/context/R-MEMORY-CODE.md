# R-MEMORY-CODE — crates/memory/src/lib.rs

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `crates/memory/src/lib.rs:L1–L300`  
**File SHA-256:** `f0a149a7c0cb93154df2c40134d5472aa437eef3ede06d11854ee9b48d1bf13b`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Git publisher/reimport primitives; preserve pending/failed jobs and human edits.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,300p' 'crates/memory/src/lib.rs'
```

## Exact baseline excerpt

````text
    1 | //! Project-scoped cited drafts and Git-authoritative memory publication.
    2 | //!
    3 | //! This crate deliberately has no persistence or serialization dependencies.
    4 | 
    5 | use std::{
    6 |     collections::BTreeMap,
    7 |     fs::{self, File, OpenOptions},
    8 |     io::{self, Read, Write},
    9 |     path::{Component, Path, PathBuf},
   10 |     process::{Child, Command, Stdio},
   11 |     thread,
   12 |     time::{Duration, Instant, SystemTime, UNIX_EPOCH},
   13 | };
   14 | 
   15 | #[cfg(unix)]
   16 | use std::os::{fd::AsRawFd, unix::process::CommandExt};
   17 | 
   18 | #[cfg(unix)]
   19 | unsafe extern "C" {
   20 |     fn flock(file_descriptor: i32, operation: i32) -> i32;
   21 |     fn kill(pid: i32, signal: i32) -> i32;
   22 |     fn setpgid(pid: i32, process_group: i32) -> i32;
   23 | }
   24 | 
   25 | pub const MANIFEST_SCHEMA_VERSION: &str = "boreal.memory_manifest.v1";
   26 | pub const ENTRY_SCHEMA_VERSION: &str = "boreal.memory_entry.v1";
   27 | pub const INDEX_SCHEMA_VERSION: &str = "boreal.memory_index.v1";
   28 | const GIT_COMMAND_TIMEOUT: Duration = Duration::from_secs(5);
   29 | const GIT_OUTPUT_LIMIT: usize = 1024 * 1024;
   30 | const LOCK_WAIT: Duration = Duration::from_secs(10);
   31 | 
   32 | #[derive(Clone, Debug, Eq, PartialEq)]
   33 | pub struct Citation {
   34 |     pub source_version_id: String,
   35 |     pub location: String,
   36 | }
   37 | 
   38 | #[derive(Clone, Copy, Debug, Eq, PartialEq)]
   39 | pub enum DraftState {
   40 |     Draft,
   41 |     InReview,
   42 |     Accepted,
   43 |     Rejected,
   44 |     Published,
   45 | }
   46 | 
   47 | impl DraftState {
   48 |     fn as_str(self) -> &'static str {
   49 |         match self {
   50 |             Self::Draft => "draft",
   51 |             Self::InReview => "in_review",
   52 |             Self::Accepted => "accepted",
   53 |             Self::Rejected => "rejected",
   54 |             Self::Published => "published",
   55 |         }
   56 |     }
   57 | }
   58 | 
   59 | #[derive(Clone, Debug, Eq, PartialEq)]
   60 | pub struct Draft {
   61 |     pub project_id: String,
   62 |     pub entry_id: String,
   63 |     pub title: String,
   64 |     pub body: String,
   65 |     pub citations: Vec<Citation>,
   66 |     pub state: DraftState,
   67 | }
   68 | 
   69 | #[derive(Clone, Debug, Eq, PartialEq)]
   70 | pub enum MemoryError {
   71 |     MissingCitation,
   72 |     EmptyIdentity,
   73 |     InvalidPath,
   74 |     InvalidManifest(String),
   75 |     Io(String),
   76 | }
   77 | 
   78 | impl std::fmt::Display for MemoryError {
   79 |     fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
   80 |         match self {
   81 |             Self::MissingCitation => f.write_str("memory draft has no source citations"),
   82 |             Self::EmptyIdentity => f.write_str("memory identity is empty or unsafe"),
   83 |             Self::InvalidPath => f.write_str("memory path is outside the managed memory root"),
   84 |             Self::InvalidManifest(message) => write!(f, "invalid memory manifest: {}", message),
   85 |             Self::Io(message) => write!(f, "memory I/O failed: {}", message),
   86 |         }
   87 |     }
   88 | }
   89 | 
   90 | impl std::error::Error for MemoryError {}
   91 | 
   92 | impl From<io::Error> for MemoryError {
   93 |     fn from(error: io::Error) -> Self {
   94 |         Self::Io(error.to_string())
   95 |     }
   96 | }
   97 | 
   98 | impl Draft {
   99 |     pub fn new(
  100 |         project_id: &str,
  101 |         entry_id: &str,
  102 |         title: &str,
  103 |         body: &str,
  104 |         citations: Vec<Citation>,
  105 |     ) -> Result<Self, MemoryError> {
  106 |         validate_segment(project_id)?;
  107 |         validate_segment(entry_id)?;
  108 |         if citations.is_empty() {
  109 |             return Err(MemoryError::MissingCitation);
  110 |         }
  111 |         if citations
  112 |             .iter()
  113 |             .any(|citation| citation.source_version_id.is_empty() || citation.location.is_empty())
  114 |         {
  115 |             return Err(MemoryError::MissingCitation);
  116 |         }
  117 |         Ok(Self {
  118 |             project_id: project_id.to_owned(),
  119 |             entry_id: entry_id.to_owned(),
  120 |             title: title.to_owned(),
  121 |             body: body.to_owned(),
  122 |             citations,
  123 |             state: DraftState::Draft,
  124 |         })
  125 |     }
  126 | 
  127 |     pub fn review(mut self, accepted: bool) -> Self {
  128 |         self.state = if accepted {
  129 |             DraftState::Accepted
  130 |         } else {
  131 |             DraftState::Rejected
  132 |         };
  133 |         self
  134 |     }
  135 | }
  136 | 
  137 | #[derive(Clone, Debug, Eq, PartialEq)]
  138 | pub struct PublicationIdentity {
  139 |     pub project_id: String,
  140 |     pub entry_id: String,
  141 |     pub content_digest: String,
  142 |     pub operation_id: String,
  143 |     pub manifest_identity: String,
  144 | }
  145 | 
  146 | #[derive(Clone, Copy, Debug, Eq, PartialEq)]
  147 | pub enum PublicationState {
  148 |     Publishing,
  149 |     Published,
  150 |     Failed,
  151 |     Conflict,
  152 | }
  153 | 
  154 | impl PublicationState {
  155 |     pub fn as_str(self) -> &'static str {
  156 |         match self {
  157 |             Self::Publishing => "publishing",
  158 |             Self::Published => "published",
  159 |             Self::Failed => "failed",
  160 |             Self::Conflict => "conflict",
  161 |         }
  162 |     }
  163 | }
  164 | 
  165 | /// The only filesystem area a Publisher may change.
  166 | #[derive(Clone, Debug, Eq, PartialEq)]
  167 | pub struct MemoryRoot {
  168 |     path: PathBuf,
  169 | }
  170 | 
  171 | impl MemoryRoot {
  172 |     pub fn new(path: impl Into<PathBuf>) -> Result<Self, MemoryError> {
  173 |         let path = path.into();
  174 |         validate_root_path(&path)?;
  175 |         if fs::symlink_metadata(&path)
  176 |             .map(|metadata| metadata.file_type().is_symlink())
  177 |             .unwrap_or(false)
  178 |         {
  179 |             return Err(MemoryError::InvalidPath);
  180 |         }
  181 |         Ok(Self {
  182 |             path: canonicalize_with_existing_parent(&path)?,
  183 |         })
  184 |     }
  185 | 
  186 |     pub fn for_project(project_root: impl AsRef<Path>) -> Result<Self, MemoryError> {
  187 |         let project_root = project_root.as_ref();
  188 |         if project_root.as_os_str().is_empty() || has_parent_component(project_root) {
  189 |             return Err(MemoryError::InvalidPath);
  190 |         }
  191 |         Self::new(project_root.join(".boreal-memory"))
  192 |     }
  193 | 
  194 |     pub fn path(&self) -> &Path {
  195 |         &self.path
  196 |     }
  197 | 
  198 |     pub fn manifest_path(&self) -> PathBuf {
  199 |         self.path.join("manifest.json")
  200 |     }
  201 | 
  202 |     fn checked_manifest_path(&self) -> Result<PathBuf, MemoryError> {
  203 |         self.checked_child(PathBuf::from("manifest.json"))
  204 |     }
  205 | 
  206 |     fn lock_path(&self) -> PathBuf {
  207 |         let name = self
  208 |             .path
  209 |             .file_name()
  210 |             .map(|value| value.to_string_lossy().into_owned())
  211 |             .unwrap_or_else(|| "memory".into());
  212 |         self.path
  213 |             .parent()
  214 |             .unwrap_or_else(|| Path::new("."))
  215 |             .join(format!("{}.publication.lock", name))
  216 |     }
  217 | 
  218 |     pub fn entry_path(&self, entry_id: &str) -> Result<PathBuf, MemoryError> {
  219 |         validate_segment(entry_id)?;
  220 |         self.checked_child(Path::new("notes").join(format!("{}.md", entry_id)))
  221 |     }
  222 | 
  223 |     fn checked_child(&self, relative: PathBuf) -> Result<PathBuf, MemoryError> {
  224 |         if relative.is_absolute() || has_parent_component(&relative) {
  225 |             return Err(MemoryError::InvalidPath);
  226 |         }
  227 |         let path = self.path.join(relative);
  228 |         reject_symlink(&self.path)?;
  229 |         if let Some(parent) = path.parent() {
  230 |             reject_symlink(parent)?;
  231 |         }
  232 |         if path.exists() {
  233 |             reject_symlink(&path)?;
  234 |         }
  235 |         Ok(path)
  236 |     }
  237 | 
  238 |     fn prepare(&self) -> Result<(), MemoryError> {
  239 |         validate_root_path(&self.path)?;
  240 |         if self.path.exists() {
  241 |             reject_symlink(&self.path)?;
  242 |         } else {
  243 |             fs::create_dir_all(&self.path)?;
  244 |         }
  245 |         let notes = self.path.join("notes");
  246 |         if notes.exists() {
  247 |             reject_symlink(&notes)?;
  248 |         } else {
  249 |             fs::create_dir(&notes)?;
  250 |         }
  251 |         Ok(())
  252 |     }
  253 | }
  254 | 
  255 | #[derive(Clone, Debug, Eq, PartialEq)]
  256 | pub struct ManifestEntry {
  257 |     pub memory_entry_id: String,
  258 |     pub project_id: String,
  259 |     pub state: PublicationState,
  260 |     pub content_digest: String,
  261 |     pub source_citations: Vec<String>,
  262 |     pub manifest_path: String,
  263 |     pub operation_id: String,
  264 |     pub provenance_preserved: bool,
  265 | }
  266 | 
  267 | #[derive(Clone, Debug, Eq, PartialEq)]
  268 | pub struct PublicationManifest {
  269 |     pub project_id: String,
  270 |     pub operation_id: String,
  271 |     pub manifest_identity: String,
  272 |     pub entries: Vec<ManifestEntry>,
  273 | }
  274 | 
  275 | impl PublicationManifest {
  276 |     pub fn new(
  277 |         project_id: &str,
  278 |         operation_id: &str,
  279 |         entry: ManifestEntry,
  280 |     ) -> Result<Self, MemoryError> {
  281 |         validate_segment(project_id)?;
  282 |         validate_segment(operation_id)?;
  283 |         if entry.project_id != project_id || entry.state != PublicationState::Published {
  284 |             return Err(MemoryError::InvalidManifest(
  285 |                 "entry project or state does not match manifest".into(),
  286 |             ));
  287 |         }
  288 |         Self::with_entries(project_id, operation_id, vec![entry])
  289 |     }
  290 | 
  291 |     pub fn with_entries(
  292 |         project_id: &str,
  293 |         operation_id: &str,
  294 |         entries: Vec<ManifestEntry>,
  295 |     ) -> Result<Self, MemoryError> {
  296 |         validate_segment(project_id)?;
  297 |         validate_segment(operation_id)?;
  298 |         if entries.is_empty() {
  299 |             return Err(MemoryError::InvalidManifest(
  300 |                 "manifest has no entries".into(),
````
