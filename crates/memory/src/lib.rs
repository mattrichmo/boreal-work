//! Project-scoped cited drafts and Git-authoritative memory publication.
//!
//! This crate deliberately has no persistence or serialization dependencies.

use std::{
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::{Component, Path, PathBuf},
    process::Command,
    thread,
    time::{SystemTime, UNIX_EPOCH},
};

pub const MANIFEST_SCHEMA_VERSION: &str = "boreal.memory_manifest.v1";
pub const ENTRY_SCHEMA_VERSION: &str = "boreal.memory_entry.v1";
pub const INDEX_SCHEMA_VERSION: &str = "boreal.memory_index.v1";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Citation {
    pub source_version_id: String,
    pub location: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DraftState {
    Draft,
    InReview,
    Accepted,
    Rejected,
    Published,
}

impl DraftState {
    fn as_str(self) -> &'static str {
        match self {
            Self::Draft => "draft",
            Self::InReview => "in_review",
            Self::Accepted => "accepted",
            Self::Rejected => "rejected",
            Self::Published => "published",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Draft {
    pub project_id: String,
    pub entry_id: String,
    pub title: String,
    pub body: String,
    pub citations: Vec<Citation>,
    pub state: DraftState,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MemoryError {
    MissingCitation,
    EmptyIdentity,
    InvalidPath,
    InvalidManifest(String),
    Io(String),
}

impl std::fmt::Display for MemoryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MissingCitation => f.write_str("memory draft has no source citations"),
            Self::EmptyIdentity => f.write_str("memory identity is empty or unsafe"),
            Self::InvalidPath => f.write_str("memory path is outside the managed memory root"),
            Self::InvalidManifest(message) => write!(f, "invalid memory manifest: {}", message),
            Self::Io(message) => write!(f, "memory I/O failed: {}", message),
        }
    }
}

impl std::error::Error for MemoryError {}

impl From<io::Error> for MemoryError {
    fn from(error: io::Error) -> Self {
        Self::Io(error.to_string())
    }
}

impl Draft {
    pub fn new(
        project_id: &str,
        entry_id: &str,
        title: &str,
        body: &str,
        citations: Vec<Citation>,
    ) -> Result<Self, MemoryError> {
        validate_segment(project_id)?;
        validate_segment(entry_id)?;
        if citations.is_empty() {
            return Err(MemoryError::MissingCitation);
        }
        if citations
            .iter()
            .any(|citation| citation.source_version_id.is_empty() || citation.location.is_empty())
        {
            return Err(MemoryError::MissingCitation);
        }
        Ok(Self {
            project_id: project_id.to_owned(),
            entry_id: entry_id.to_owned(),
            title: title.to_owned(),
            body: body.to_owned(),
            citations,
            state: DraftState::Draft,
        })
    }

    pub fn review(mut self, accepted: bool) -> Self {
        self.state = if accepted {
            DraftState::Accepted
        } else {
            DraftState::Rejected
        };
        self
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PublicationIdentity {
    pub project_id: String,
    pub entry_id: String,
    pub content_digest: String,
    pub operation_id: String,
    pub manifest_identity: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PublicationState {
    Publishing,
    Published,
    Failed,
    Conflict,
}

impl PublicationState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Publishing => "publishing",
            Self::Published => "published",
            Self::Failed => "failed",
            Self::Conflict => "conflict",
        }
    }
}

/// The only filesystem area a Publisher may change.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MemoryRoot {
    path: PathBuf,
}

impl MemoryRoot {
    pub fn new(path: impl Into<PathBuf>) -> Result<Self, MemoryError> {
        let path = path.into();
        validate_root_path(&path)?;
        if fs::symlink_metadata(&path)
            .map(|metadata| metadata.file_type().is_symlink())
            .unwrap_or(false)
        {
            return Err(MemoryError::InvalidPath);
        }
        Ok(Self {
            path: canonicalize_with_existing_parent(&path)?,
        })
    }

    pub fn for_project(project_root: impl AsRef<Path>) -> Result<Self, MemoryError> {
        let project_root = project_root.as_ref();
        if project_root.as_os_str().is_empty() || has_parent_component(project_root) {
            return Err(MemoryError::InvalidPath);
        }
        Self::new(project_root.join(".boreal-memory"))
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn manifest_path(&self) -> PathBuf {
        self.path.join("manifest.json")
    }

    fn lock_path(&self) -> PathBuf {
        let name = self
            .path
            .file_name()
            .map(|value| value.to_string_lossy().into_owned())
            .unwrap_or_else(|| "memory".into());
        self.path
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join(format!("{}.publication.lock", name))
    }

    pub fn entry_path(&self, entry_id: &str) -> Result<PathBuf, MemoryError> {
        validate_segment(entry_id)?;
        self.checked_child(Path::new("notes").join(format!("{}.md", entry_id)))
    }

    fn checked_child(&self, relative: PathBuf) -> Result<PathBuf, MemoryError> {
        if relative.is_absolute() || has_parent_component(&relative) {
            return Err(MemoryError::InvalidPath);
        }
        let path = self.path.join(relative);
        reject_symlink(&self.path)?;
        if let Some(parent) = path.parent() {
            reject_symlink(parent)?;
        }
        if path.exists() {
            reject_symlink(&path)?;
        }
        Ok(path)
    }

    fn prepare(&self) -> Result<(), MemoryError> {
        validate_root_path(&self.path)?;
        if self.path.exists() {
            reject_symlink(&self.path)?;
        } else {
            fs::create_dir_all(&self.path)?;
        }
        let notes = self.path.join("notes");
        if notes.exists() {
            reject_symlink(&notes)?;
        } else {
            fs::create_dir(&notes)?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ManifestEntry {
    pub memory_entry_id: String,
    pub project_id: String,
    pub state: PublicationState,
    pub content_digest: String,
    pub source_citations: Vec<String>,
    pub manifest_path: String,
    pub operation_id: String,
    pub provenance_preserved: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PublicationManifest {
    pub project_id: String,
    pub operation_id: String,
    pub manifest_identity: String,
    pub entries: Vec<ManifestEntry>,
}

impl PublicationManifest {
    pub fn new(
        project_id: &str,
        operation_id: &str,
        entry: ManifestEntry,
    ) -> Result<Self, MemoryError> {
        validate_segment(project_id)?;
        validate_segment(operation_id)?;
        if entry.project_id != project_id || entry.state != PublicationState::Published {
            return Err(MemoryError::InvalidManifest(
                "entry project or state does not match manifest".into(),
            ));
        }
        Self::with_entries(project_id, operation_id, vec![entry])
    }

    pub fn with_entries(
        project_id: &str,
        operation_id: &str,
        entries: Vec<ManifestEntry>,
    ) -> Result<Self, MemoryError> {
        validate_segment(project_id)?;
        validate_segment(operation_id)?;
        if entries.is_empty() {
            return Err(MemoryError::InvalidManifest(
                "manifest has no entries".into(),
            ));
        }
        let mut ids = Vec::with_capacity(entries.len());
        for entry in &entries {
            if entry.project_id != project_id || entry.state != PublicationState::Published {
                return Err(MemoryError::InvalidManifest(
                    "entry project or state does not match manifest".into(),
                ));
            }
            if ids.iter().any(|id| id == &entry.memory_entry_id) {
                return Err(MemoryError::InvalidManifest(
                    "manifest contains duplicate entry identities".into(),
                ));
            }
            ids.push(entry.memory_entry_id.clone());
        }
        Ok(Self {
            project_id: project_id.to_owned(),
            operation_id: operation_id.to_owned(),
            manifest_identity: String::new(),
            entries,
        })
    }

    /// Merge one reviewed publication into this manifest. Existing entries are
    /// replaced by identity so an update creates a new Git revision without
    /// dropping any other published entry.
    pub fn merge_entry(
        &self,
        operation_id: &str,
        entry: ManifestEntry,
    ) -> Result<Self, MemoryError> {
        validate_segment(operation_id)?;
        validate_manifest_entry(&self.project_id, &entry)?;
        let mut entries = self.entries.clone();
        if let Some(existing) = entries
            .iter_mut()
            .find(|existing| existing.memory_entry_id == entry.memory_entry_id)
        {
            *existing = entry;
        } else {
            entries.push(entry);
        }
        Self::with_entries(&self.project_id, operation_id, entries)
    }

    pub fn identity(&self) -> String {
        digest(canonical_manifest_without_identity(self).as_bytes())
    }
}

pub fn render_markdown(draft: &Draft) -> Result<String, MemoryError> {
    render_markdown_as(draft, draft.state.as_str())
}

fn render_published_markdown(draft: &Draft) -> Result<String, MemoryError> {
    render_markdown_as(draft, PublicationState::Published.as_str())
}

fn render_markdown_as(draft: &Draft, state: &str) -> Result<String, MemoryError> {
    validate_segment(&draft.project_id)?;
    validate_segment(&draft.entry_id)?;
    if draft.citations.is_empty() {
        return Err(MemoryError::MissingCitation);
    }
    let mut citations = draft.citations.clone();
    citations.sort_by(|left, right| {
        left.source_version_id
            .cmp(&right.source_version_id)
            .then_with(|| left.location.cmp(&right.location))
    });
    let source_lines = citations
        .iter()
        .map(|citation| format!("- {} ({})", citation.source_version_id, citation.location))
        .collect::<Vec<_>>()
        .join("\n");
    Ok(format!(
        "---\nschema_version: {}\nproject_id: {}\nentry_id: {}\nstate: {}\n---\n\n# {}\n\n{}\n\n## Sources\n{}\n",
        ENTRY_SCHEMA_VERSION, draft.project_id, draft.entry_id, state, draft.title, draft.body,
        source_lines
    ))
}

pub fn render_manifest(manifest: &PublicationManifest) -> String {
    let identity = manifest.identity();
    let mut output = canonical_manifest_without_identity(manifest);
    output.push_str(&format!(
        ",\"manifest_identity\":{}",
        json_string(&identity)
    ));
    output.push('}');
    output
}

pub fn publication_identity(
    draft: &Draft,
    operation_id: &str,
) -> Result<PublicationIdentity, MemoryError> {
    validate_segment(operation_id)?;
    let content = render_published_markdown(draft)?;
    let content_digest = digest(content.as_bytes());
    let entry = manifest_entry(
        draft,
        operation_id,
        content_digest.clone(),
        PublicationState::Published,
    );
    let manifest = PublicationManifest::new(&draft.project_id, operation_id, entry)?;
    Ok(PublicationIdentity {
        project_id: draft.project_id.clone(),
        entry_id: draft.entry_id.clone(),
        content_digest,
        operation_id: operation_id.to_owned(),
        manifest_identity: manifest.identity(),
    })
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PublicationReceipt {
    pub state: PublicationState,
    pub identity: PublicationIdentity,
    pub git_revision: String,
    pub duplicate: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PublishError {
    DraftNotAccepted,
    InvalidInput(MemoryError),
    Io(String),
    Git(String),
    Conflict(String),
}

impl PublishError {
    pub fn state(&self) -> PublicationState {
        match self {
            Self::Conflict(_) => PublicationState::Conflict,
            _ => PublicationState::Failed,
        }
    }
}

impl std::fmt::Display for PublishError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::DraftNotAccepted => f.write_str("only an accepted cited draft may be published"),
            Self::InvalidInput(error) => error.fmt(f),
            Self::Io(message) => write!(f, "publication I/O failed: {}", message),
            Self::Git(message) => write!(f, "git publication failed: {}", message),
            Self::Conflict(message) => write!(f, "memory publication conflict: {}", message),
        }
    }
}

impl std::error::Error for PublishError {}

impl From<MemoryError> for PublishError {
    fn from(error: MemoryError) -> Self {
        Self::InvalidInput(error)
    }
}

/// A stateless publisher. Identity is persisted in the committed manifest, so
/// retrying with the same operation is safe after this value is dropped.
#[derive(Clone, Debug)]
pub struct Publisher {
    root: MemoryRoot,
}

impl Publisher {
    pub fn new(root: MemoryRoot) -> Result<Self, PublishError> {
        // Construction may create the managed directories and initialize the
        // Git repository. Those are publication-root mutations too, so they
        // must use the same cross-process exclusion as `publish`; otherwise
        // concurrent constructors can race inside `create_dir` or `git init`.
        let _publication_lock = PublicationLock::acquire(&root)?;
        root.prepare().map_err(io_publish)?;
        ensure_git_repository(root.path())?;
        Ok(Self { root })
    }

    pub fn root(&self) -> &MemoryRoot {
        &self.root
    }

    pub fn publish(
        &self,
        draft: &Draft,
        operation_id: &str,
    ) -> Result<PublicationReceipt, PublishError> {
        self.publish_with_expected_base(draft, operation_id, None)
    }

    /// Publish against an optional expected manifest identity. `None` keeps
    /// the convenience behavior of accepting the current base; `Some("")`
    /// explicitly means that the root must not have a manifest. A non-empty
    /// value must equal the current canonical manifest identity.
    pub fn publish_with_expected_base(
        &self,
        draft: &Draft,
        operation_id: &str,
        expected_manifest_identity: Option<&str>,
    ) -> Result<PublicationReceipt, PublishError> {
        let _publication_lock = PublicationLock::acquire(&self.root)?;
        if draft.state != DraftState::Accepted {
            return Err(PublishError::DraftNotAccepted);
        }
        self.root.prepare().map_err(io_publish)?;
        ensure_git_repository(self.root.path())?;
        validate_segment(operation_id)?;
        let markdown = render_published_markdown(draft)?;
        let content_digest = digest(markdown.as_bytes());
        let entry = manifest_entry(
            draft,
            operation_id,
            content_digest.clone(),
            PublicationState::Published,
        );
        let note_path = self.root.entry_path(&draft.entry_id).map_err(io_publish)?;
        let manifest_path = self.root.manifest_path();
        cleanup_publication_temps(self.root.path(), &note_path, &manifest_path)
            .map_err(io_publish_io)?;
        if let Some(receipt) = replay_committed_publication(&self.root, &entry)? {
            let status = git_output(
                self.root.path(),
                &["status", "--porcelain", "--untracked-files=all"],
            )?;
            if !status.trim().is_empty() {
                return Err(PublishError::Conflict(
                    "managed memory root has uncommitted changes".into(),
                ));
            }
            return Ok(receipt);
        }
        let current = read_worktree_manifest(&self.root)?;
        let current_identity = current.as_ref().map(PublicationManifest::identity);
        if let Some(expected) = expected_manifest_identity {
            let actual = current_identity.as_deref().unwrap_or_default();
            if actual != expected {
                return Err(PublishError::Conflict(format!(
                    "publication base changed: expected {}, found {}",
                    if expected.is_empty() {
                        "<empty>"
                    } else {
                        expected
                    },
                    if actual.is_empty() { "<empty>" } else { actual },
                )));
            }
        }

        let existing_entry = current.as_ref().and_then(|manifest| {
            manifest
                .entries
                .iter()
                .find(|candidate| candidate.memory_entry_id == entry.memory_entry_id)
        });
        let retrying_existing = existing_entry.is_some_and(|existing| {
            existing.operation_id == entry.operation_id
                && manifest_entries_equivalent(existing, &entry)
        });
        if let Some(existing) = existing_entry {
            if existing.operation_id == entry.operation_id && !retrying_existing {
                return Err(PublishError::Conflict(
                    "publication operation was already used for different entry content".into(),
                ));
            }
        }
        let manifest = match current.as_ref() {
            Some(current) if retrying_existing => current.clone(),
            Some(current) => current.merge_entry(operation_id, entry.clone())?,
            None => PublicationManifest::new(&draft.project_id, operation_id, entry.clone())?,
        };
        let identity = PublicationIdentity {
            project_id: draft.project_id.clone(),
            entry_id: draft.entry_id.clone(),
            content_digest,
            operation_id: operation_id.to_owned(),
            manifest_identity: manifest.identity(),
        };
        let manifest_text = render_manifest(&manifest);

        let status = git_output(
            self.root.path(),
            &["status", "--porcelain", "--untracked-files=all"],
        )?;
        let note_name = format!("notes/{}.md", draft.entry_id);
        let files_match = manifest_path.exists()
            && note_path.exists()
            && fs::read_to_string(&manifest_path).map_err(io_publish_io)? == manifest_text
            && fs::read_to_string(&note_path).map_err(io_publish_io)? == markdown;
        let status_is_clean = status.trim().is_empty();
        let exact_interrupted_publication =
            !status_is_clean && files_match && status_only_managed(&status, &note_name);
        if !status_is_clean && !exact_interrupted_publication {
            return Err(PublishError::Conflict(
                "managed memory root has uncommitted changes".into(),
            ));
        }
        if files_match && status_is_clean {
            let revision = git_output(self.root.path(), &["rev-parse", "HEAD"])?;
            return Ok(PublicationReceipt {
                state: PublicationState::Published,
                identity,
                git_revision: revision.trim().to_owned(),
                duplicate: true,
            });
        }
        let note_matches = note_path.exists()
            && fs::read_to_string(&note_path).map_err(io_publish_io)? == markdown;
        let replacing_existing_entry = existing_entry.is_some()
            && existing_entry.is_some_and(|existing| existing.operation_id != operation_id);
        if note_path.exists() && !note_matches && !replacing_existing_entry {
            return Err(PublishError::Conflict(
                "existing memory note does not match the requested publication".into(),
            ));
        }

        if !files_match {
            atomic_write(&note_path, markdown.as_bytes()).map_err(io_publish_io)?;
            atomic_write(&manifest_path, manifest_text.as_bytes()).map_err(io_publish_io)?;
        }
        git_output(
            self.root.path(),
            &["add", "--", "manifest.json", note_name.as_str()],
        )?;
        let staged = git_output(self.root.path(), &["diff", "--cached", "--name-only"])?;
        let expected = format!("manifest.json\n{}\n", note_name);
        if staged != expected {
            return Err(PublishError::Conflict(
                "Git staging contained files outside the publication set".into(),
            ));
        }
        git_output_with_config(
            self.root.path(),
            &[
                "commit",
                "-m",
                &format!("Publish memory {}", draft.entry_id),
            ],
        )?;
        let revision = git_output(self.root.path(), &["rev-parse", "HEAD"])?
            .trim()
            .to_owned();
        if git_output(
            self.root.path(),
            &["show", &format!("{}:manifest.json", revision)],
        )? != manifest_text
            || git_output(
                self.root.path(),
                &["show", &format!("{}:{}", revision, note_name)],
            )? != markdown
        {
            return Err(PublishError::Git(
                "committed files failed publication read-back".into(),
            ));
        }
        Ok(PublicationReceipt {
            state: PublicationState::Published,
            identity,
            git_revision: revision,
            duplicate: false,
        })
    }

    pub fn reimport(&self, project_id: &str) -> Result<ImportReport, ImportError> {
        let status = git_output(
            self.root.path(),
            &["status", "--porcelain", "--untracked-files=all"],
        )
        .map_err(|error| ImportError::Git(error.to_string()))?;
        if !status.trim().is_empty() {
            return Err(ImportError::Git(
                "cannot reimport an uncommitted memory checkout".into(),
            ));
        }
        let mut report = validate_import(self.root.path(), project_id)?;
        report.git_revision = git_checked_out_revision(self.root.path())?;
        Ok(report)
    }
}

/// Cross-process publication exclusion. The lock lives beside the managed
/// Git repository so it can never appear as a staged memory file. We do not
/// remove a lock owned by another process: a stale lock is an explicit
/// operator/recovery condition rather than a reason to risk concurrent Git
/// writes.
struct PublicationLock {
    path: PathBuf,
}

impl PublicationLock {
    fn acquire(root: &MemoryRoot) -> Result<Self, PublishError> {
        let path = root.lock_path();
        let mut file = None;
        for _ in 0..5_000 {
            match OpenOptions::new().write(true).create_new(true).open(&path) {
                Ok(value) => {
                    file = Some(value);
                    break;
                }
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                    thread::sleep(std::time::Duration::from_millis(2));
                }
                Err(error) => return Err(PublishError::Io(error.to_string())),
            }
        }
        let mut file = file.ok_or_else(|| {
            PublishError::Conflict(
                "another publication owns the memory root lock; retry after it exits".into(),
            )
        })?;
        let owner = format!("pid={}\n", std::process::id());
        if let Err(error) = file
            .write_all(owner.as_bytes())
            .and_then(|_| file.sync_all())
        {
            let _ = fs::remove_file(&path);
            return Err(PublishError::Io(error.to_string()));
        }
        Ok(Self { path })
    }
}

impl Drop for PublicationLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

fn read_worktree_manifest(root: &MemoryRoot) -> Result<Option<PublicationManifest>, PublishError> {
    let path = root.manifest_path();
    if !path.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(&path).map_err(io_publish_io)?;
    parse_existing_manifest(&text).map(Some)
}

fn parse_existing_manifest(text: &str) -> Result<PublicationManifest, PublishError> {
    let parsed = parse_manifest(text).map_err(|error| {
        PublishError::Conflict(format!("existing manifest is invalid: {error}"))
    })?;
    let manifest = parsed.into_manifest().map_err(|error| {
        PublishError::Conflict(format!("existing manifest is invalid: {error}"))
    })?;
    for entry in &manifest.entries {
        validate_manifest_entry(&manifest.project_id, entry).map_err(|error| {
            PublishError::Conflict(format!("existing manifest is invalid: {error}"))
        })?;
    }
    if manifest.identity() != manifest.manifest_identity {
        return Err(PublishError::Conflict(
            "existing manifest identity does not match its canonical content".into(),
        ));
    }
    Ok(manifest)
}

/// Resolve an already committed operation before considering a new mutation.
/// The manifest's top-level operation identifies the commit produced for that
/// logical publication; entry operation fields alone persist into later
/// manifests and therefore cannot identify the original receipt.
fn replay_committed_publication(
    root: &MemoryRoot,
    requested: &ManifestEntry,
) -> Result<Option<PublicationReceipt>, PublishError> {
    let commit_count = git_output(root.path(), &["rev-list", "--all", "--count"])?;
    if commit_count.trim() == "0" {
        return Ok(None);
    }
    let revisions = git_output(
        root.path(),
        &[
            "log",
            "--reverse",
            "--format=%H",
            "HEAD",
            "--",
            "manifest.json",
        ],
    )?;
    let mut replay = None;
    for revision in revisions.lines().filter(|revision| !revision.is_empty()) {
        let text = git_output(root.path(), &["show", &format!("{revision}:manifest.json")])?;
        let manifest = parse_existing_manifest(&text)?;
        if manifest.operation_id != requested.operation_id {
            continue;
        }
        let exact_entry = manifest.entries.iter().any(|entry| {
            entry.operation_id == requested.operation_id
                && manifest_entries_equivalent(entry, requested)
        });
        if !exact_entry {
            return Err(PublishError::Conflict(
                "publication operation was already used for different entry content".into(),
            ));
        }
        if replay.is_some() {
            return Err(PublishError::Conflict(
                "publication operation resolves to more than one committed manifest".into(),
            ));
        }
        replay = Some(PublicationReceipt {
            state: PublicationState::Published,
            identity: PublicationIdentity {
                project_id: requested.project_id.clone(),
                entry_id: requested.memory_entry_id.clone(),
                content_digest: requested.content_digest.clone(),
                operation_id: requested.operation_id.clone(),
                manifest_identity: manifest.manifest_identity,
            },
            git_revision: revision.to_owned(),
            duplicate: true,
        });
    }
    Ok(replay)
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ImportedEntry {
    pub memory_entry_id: String,
    pub project_id: String,
    pub content_digest: String,
    pub source_citations: Vec<String>,
    pub manifest_path: String,
    pub operation_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ImportReport {
    pub project_id: String,
    pub manifest_identity: String,
    pub git_revision: String,
    pub entries: Vec<ImportedEntry>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ImportError {
    InvalidPath,
    Io(String),
    Git(String),
    InvalidManifest(String),
    ScopeViolation,
    MissingEntry(String),
    DigestMismatch(String),
}

impl std::fmt::Display for ImportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidPath => f.write_str("import path is outside the managed memory root"),
            Self::Io(message) => write!(f, "memory import I/O failed: {}", message),
            Self::Git(message) => write!(f, "memory import Git check failed: {}", message),
            Self::InvalidManifest(message) => write!(f, "invalid memory manifest: {}", message),
            Self::ScopeViolation => f.write_str("memory manifest project scope does not match"),
            Self::MissingEntry(entry) => write!(f, "manifest entry file is missing: {}", entry),
            Self::DigestMismatch(entry) => {
                write!(f, "memory entry digest does not match: {}", entry)
            }
        }
    }
}

impl std::error::Error for ImportError {}

pub fn validate_import(
    root: impl AsRef<Path>,
    project_id: &str,
) -> Result<ImportReport, ImportError> {
    validate_segment(project_id).map_err(|_| ImportError::InvalidPath)?;
    let root =
        MemoryRoot::new(root.as_ref().to_path_buf()).map_err(|_| ImportError::InvalidPath)?;
    let manifest_text = fs::read_to_string(root.manifest_path()).map_err(import_io)?;
    let parsed = parse_manifest(&manifest_text)?;
    if parsed.project_id != project_id {
        return Err(ImportError::ScopeViolation);
    }
    if parsed.entries.is_empty() {
        return Err(ImportError::InvalidManifest(
            "manifest has no entries".into(),
        ));
    }
    if parsed.identity() != parsed.manifest_identity {
        return Err(ImportError::InvalidManifest(
            "manifest identity does not match canonical content".into(),
        ));
    }
    let mut ids = Vec::new();
    let mut entries = Vec::new();
    for entry in parsed.entries {
        validate_segment(&entry.memory_entry_id).map_err(|_| ImportError::InvalidPath)?;
        if entry.project_id != project_id
            || entry.state != PublicationState::Published
            || !entry.provenance_preserved
        {
            return Err(ImportError::ScopeViolation);
        }
        if ids.iter().any(|id: &String| id == &entry.memory_entry_id) {
            return Err(ImportError::InvalidManifest(
                "duplicate entry identity".into(),
            ));
        }
        ids.push(entry.memory_entry_id.clone());
        let expected_path = format!("notes/{}.md", entry.memory_entry_id);
        let relative = Path::new(&entry.manifest_path);
        if entry.manifest_path != expected_path
            || relative.is_absolute()
            || has_parent_component(relative)
        {
            return Err(ImportError::InvalidPath);
        }
        let note = root
            .checked_child(relative.to_path_buf())
            .map_err(|_| ImportError::InvalidPath)?;
        if !note.is_file() {
            return Err(ImportError::MissingEntry(entry.memory_entry_id));
        }
        let bytes = fs::read(&note).map_err(import_io)?;
        if digest(&bytes) != entry.content_digest {
            return Err(ImportError::DigestMismatch(entry.memory_entry_id));
        }
        validate_note(&bytes, &entry)?;
        entries.push(ImportedEntry {
            memory_entry_id: entry.memory_entry_id,
            project_id: entry.project_id,
            content_digest: entry.content_digest,
            source_citations: entry.source_citations,
            manifest_path: entry.manifest_path,
            operation_id: entry.operation_id,
        });
    }
    Ok(ImportReport {
        project_id: parsed.project_id,
        manifest_identity: parsed.manifest_identity,
        git_revision: String::new(),
        entries,
    })
}

pub fn validate_fresh_clone(
    root: impl AsRef<Path>,
    project_id: &str,
) -> Result<ImportReport, ImportError> {
    validate_import(root, project_id)
}

/// The authority of a retrieval result.  The first release deliberately
/// exposes only committed Git memory from this crate; operational drafts and
/// raw source intake need an application/store adapter before they can be
/// mixed into retrieval.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MemoryAuthority {
    PublishedGit,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SourceTrust {
    ImmutableVersionCitation,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RetrievalQuery {
    pub project_id: String,
    pub entry_id: Option<String>,
    pub text: Option<String>,
    pub source_version_id: Option<String>,
    pub limit: usize,
    pub max_excerpt_bytes: usize,
    pub requested_git_revision: Option<String>,
}

impl RetrievalQuery {
    pub fn new(project_id: &str) -> Result<Self, MemoryError> {
        validate_segment(project_id)?;
        Ok(Self {
            project_id: project_id.to_owned(),
            entry_id: None,
            text: None,
            source_version_id: None,
            limit: 20,
            max_excerpt_bytes: 320,
            requested_git_revision: None,
        })
    }

    pub fn with_entry_id(mut self, entry_id: &str) -> Result<Self, MemoryError> {
        validate_segment(entry_id)?;
        self.entry_id = Some(entry_id.to_owned());
        Ok(self)
    }

    pub fn with_text(mut self, text: &str) -> Self {
        self.text = Some(text.to_owned());
        self
    }

    pub fn with_source_version(mut self, source_version_id: &str) -> Self {
        self.source_version_id = Some(source_version_id.to_owned());
        self
    }

    pub fn with_limit(mut self, limit: usize) -> Self {
        self.limit = limit;
        self
    }

    pub fn with_max_excerpt_bytes(mut self, bytes: usize) -> Self {
        self.max_excerpt_bytes = bytes;
        self
    }

    pub fn at_git_revision(mut self, revision: &str) -> Self {
        self.requested_git_revision = Some(revision.to_owned());
        self
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MemoryHit {
    pub entry_id: String,
    pub project_id: String,
    pub title: String,
    pub excerpt: String,
    pub citations: Vec<Citation>,
    pub content_digest: String,
    pub git_revision: String,
    pub index_revision: String,
    pub authority: MemoryAuthority,
    pub source_trust: SourceTrust,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RetrievalResponse {
    pub project_id: String,
    pub hits: Vec<MemoryHit>,
    pub git_revision: String,
    pub index_revision: String,
    pub lag: IndexLag,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum IndexLag {
    Current,
    Behind {
        indexed_git_revision: String,
        requested_git_revision: String,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum IndexError {
    Import(ImportError),
    InvalidNote(String),
    InvalidQuery(String),
}

impl std::fmt::Display for IndexError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Import(error) => error.fmt(f),
            Self::InvalidNote(message) => write!(f, "invalid indexed memory note: {}", message),
            Self::InvalidQuery(message) => write!(f, "invalid memory retrieval query: {}", message),
        }
    }
}

impl std::error::Error for IndexError {}

impl From<ImportError> for IndexError {
    fn from(error: ImportError) -> Self {
        Self::Import(error)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct IndexedEntry {
    entry_id: String,
    project_id: String,
    title: String,
    body: String,
    citations: Vec<Citation>,
    content_digest: String,
}

/// A rebuildable, deterministic projection of one validated Git revision.
/// It is intentionally in-memory: SQLite owns the durable index in the full
/// application, while this package supplies the projection and safe rebuild
/// behavior without introducing a second authority.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MemoryIndex {
    project_id: String,
    git_revision: String,
    index_revision: String,
    entries: Vec<IndexedEntry>,
}

impl MemoryIndex {
    pub fn project_id(&self) -> &str {
        &self.project_id
    }

    pub fn git_revision(&self) -> &str {
        &self.git_revision
    }

    pub fn index_revision(&self) -> &str {
        &self.index_revision
    }

    pub fn entry_count(&self) -> usize {
        self.entries.len()
    }

    pub fn search(&self, query: &RetrievalQuery) -> Result<RetrievalResponse, IndexError> {
        if query.project_id != self.project_id {
            return Err(IndexError::InvalidQuery(
                "retrieval cannot cross project scope".into(),
            ));
        }
        if query.limit == 0 {
            return Ok(self.response(query, Vec::new()));
        }
        if query.max_excerpt_bytes == 0 {
            return Err(IndexError::InvalidQuery(
                "max excerpt bytes must be greater than zero".into(),
            ));
        }
        if query
            .entry_id
            .as_deref()
            .is_some_and(|entry_id| validate_segment(entry_id).is_err())
        {
            return Err(IndexError::InvalidQuery("entry ID is unsafe".into()));
        }
        let terms = query
            .text
            .as_deref()
            .unwrap_or_default()
            .split_whitespace()
            .map(str::to_lowercase)
            .collect::<Vec<_>>();
        let source_filter = query.source_version_id.as_deref();
        let mut scored = self
            .entries
            .iter()
            .filter_map(|entry| {
                if query
                    .entry_id
                    .as_deref()
                    .is_some_and(|id| id != entry.entry_id)
                    || source_filter.is_some_and(|source| {
                        !entry
                            .citations
                            .iter()
                            .any(|citation| citation.source_version_id == source)
                    })
                {
                    return None;
                }
                let haystack = format!("{} {}", entry.title, entry.body).to_lowercase();
                let score = terms
                    .iter()
                    .map(|term| haystack.matches(term).count())
                    .sum::<usize>();
                if !terms.is_empty() && score == 0 {
                    return None;
                }
                let exact_boost = usize::from(query.entry_id.as_deref() == Some(&entry.entry_id));
                Some((score, exact_boost, entry))
            })
            .collect::<Vec<_>>();
        scored.sort_by(|left, right| {
            right
                .0
                .cmp(&left.0)
                .then_with(|| right.1.cmp(&left.1))
                .then_with(|| left.2.entry_id.cmp(&right.2.entry_id))
        });
        let hits = scored
            .into_iter()
            .take(query.limit)
            .map(|(_, _, entry)| self.hit(entry, query.max_excerpt_bytes))
            .collect();
        Ok(self.response(query, hits))
    }

    fn hit(&self, entry: &IndexedEntry, max_excerpt_bytes: usize) -> MemoryHit {
        MemoryHit {
            entry_id: entry.entry_id.clone(),
            project_id: entry.project_id.clone(),
            title: entry.title.clone(),
            excerpt: bounded_excerpt(&entry.body, max_excerpt_bytes),
            citations: entry.citations.clone(),
            content_digest: entry.content_digest.clone(),
            git_revision: self.git_revision.clone(),
            index_revision: self.index_revision.clone(),
            authority: MemoryAuthority::PublishedGit,
            source_trust: SourceTrust::ImmutableVersionCitation,
        }
    }

    fn response(&self, query: &RetrievalQuery, hits: Vec<MemoryHit>) -> RetrievalResponse {
        let lag = query
            .requested_git_revision
            .as_deref()
            .filter(|revision| *revision != self.git_revision)
            .map(|requested_git_revision| IndexLag::Behind {
                indexed_git_revision: self.git_revision.clone(),
                requested_git_revision: requested_git_revision.to_owned(),
            })
            .unwrap_or(IndexLag::Current);
        RetrievalResponse {
            project_id: self.project_id.clone(),
            hits,
            git_revision: self.git_revision.clone(),
            index_revision: self.index_revision.clone(),
            lag,
        }
    }

    /// Retain at most `policy.max_entries` entries in the derived projection.
    /// Published Git files are never deleted by this method.
    pub fn retained(&self, policy: RetentionPolicy) -> MemoryIndex {
        let mut retained = self.clone();
        retained.entries.truncate(policy.max_entries);
        retained.index_revision = index_revision(
            &retained.project_id,
            &retained.git_revision,
            &retained.entries,
        );
        retained
    }
}

pub fn rebuild_index(root: impl AsRef<Path>, project_id: &str) -> Result<MemoryIndex, IndexError> {
    validate_segment(project_id)
        .map_err(|_| IndexError::InvalidQuery("unsafe project ID".into()))?;
    let root = MemoryRoot::new(root.as_ref().to_path_buf())
        .map_err(|_| IndexError::Import(ImportError::InvalidPath))?;
    let report = validate_import(&root.path, project_id)?;
    let mut entries = report
        .entries
        .iter()
        .map(|entry| {
            let note_path = root
                .checked_child(PathBuf::from(&entry.manifest_path))
                .map_err(|_| IndexError::Import(ImportError::InvalidPath))?;
            let bytes = fs::read(note_path)
                .map_err(|error| IndexError::Import(ImportError::Io(error.to_string())))?;
            parse_indexed_entry(&bytes, entry)
        })
        .collect::<Result<Vec<_>, _>>()?;
    entries.sort_by(|left, right| left.entry_id.cmp(&right.entry_id));
    let git_revision = git_checked_out_revision(&root.path).map_err(IndexError::Import)?;
    let index_revision = index_revision(project_id, &git_revision, &entries);
    Ok(MemoryIndex {
        project_id: project_id.to_owned(),
        git_revision,
        index_revision,
        entries,
    })
}

fn index_revision(project_id: &str, git_revision: &str, entries: &[IndexedEntry]) -> String {
    let mut canonical = format!(
        "{}\n{}\n{}\n",
        INDEX_SCHEMA_VERSION, project_id, git_revision
    );
    for entry in entries {
        canonical.push_str(&entry.entry_id);
        canonical.push('\n');
        canonical.push_str(&entry.content_digest);
        canonical.push('\n');
    }
    format!("{}:{}", INDEX_SCHEMA_VERSION, digest(canonical.as_bytes()))
}

fn parse_indexed_entry(
    bytes: &[u8],
    manifest_entry: &ImportedEntry,
) -> Result<IndexedEntry, IndexError> {
    let text = std::str::from_utf8(bytes)
        .map_err(|_| IndexError::InvalidNote(manifest_entry.memory_entry_id.clone()))?;
    let title = text
        .lines()
        .find_map(|line| line.strip_prefix("# "))
        .filter(|title| !title.is_empty())
        .ok_or_else(|| IndexError::InvalidNote(manifest_entry.memory_entry_id.clone()))?;
    let body = text
        .split_once("\n\n# ")
        .and_then(|(_, rest)| rest.split_once("\n\n## Sources"))
        .map(|(body, _)| body.split_once("\n\n").map_or(body, |(_, body)| body))
        .unwrap_or_default()
        .trim()
        .to_owned();
    let citations = text
        .lines()
        .skip_while(|line| *line != "## Sources")
        .skip(1)
        .filter_map(parse_rendered_citation)
        .collect::<Vec<_>>();
    if citations.is_empty() {
        return Err(IndexError::InvalidNote(
            manifest_entry.memory_entry_id.clone(),
        ));
    }
    Ok(IndexedEntry {
        entry_id: manifest_entry.memory_entry_id.clone(),
        project_id: manifest_entry.project_id.clone(),
        title: title.to_owned(),
        body,
        citations,
        content_digest: manifest_entry.content_digest.clone(),
    })
}

fn parse_rendered_citation(line: &str) -> Option<Citation> {
    let value = line.strip_prefix("- ")?;
    let (source_version_id, location) = value.rsplit_once(" (")?;
    let location = location.strip_suffix(')')?;
    if source_version_id.is_empty() || location.is_empty() {
        return None;
    }
    Some(Citation {
        source_version_id: source_version_id.to_owned(),
        location: location.to_owned(),
    })
}

fn bounded_excerpt(body: &str, max_bytes: usize) -> String {
    if body.len() <= max_bytes {
        return body.to_owned();
    }
    let suffix = "…";
    if max_bytes <= suffix.len() {
        let mut end = max_bytes;
        while !body.is_char_boundary(end) {
            end -= 1;
        }
        return body[..end].to_owned();
    }
    let mut end = max_bytes - suffix.len();
    while !body.is_char_boundary(end) {
        end -= 1;
    }
    let mut excerpt = body[..end].trim_end().to_owned();
    excerpt.push_str(suffix);
    excerpt
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RetentionPolicy {
    pub max_entries: usize,
}

impl RetentionPolicy {
    pub fn keep_all() -> Self {
        Self {
            max_entries: usize::MAX,
        }
    }

    pub fn keep_at_most(max_entries: usize) -> Self {
        Self { max_entries }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FindingSeverity {
    Warning,
    Error,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum FindingCode {
    InvalidRoot,
    MissingManifest,
    InvalidManifest,
    ManifestIdentityMismatch,
    ScopeViolation,
    MissingEntry,
    EntryDigestMismatch,
    EntryInvalid,
    OrphanedEntry,
    UncommittedChanges,
    GitUnavailable,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DoctorFinding {
    pub code: FindingCode,
    pub severity: FindingSeverity,
    pub entry_id: Option<String>,
    pub detail: String,
    pub repairable_by_rebuild: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DoctorReport {
    pub project_id: String,
    pub git_revision: Option<String>,
    pub findings: Vec<DoctorFinding>,
}

impl DoctorReport {
    pub fn is_healthy(&self) -> bool {
        self.findings.is_empty()
    }

    pub fn has_errors(&self) -> bool {
        self.findings
            .iter()
            .any(|finding| finding.severity == FindingSeverity::Error)
    }

    pub fn rebuildable(&self) -> bool {
        !self.has_errors()
            && self
                .findings
                .iter()
                .all(|finding| finding.repairable_by_rebuild)
    }
}

pub struct MemoryDoctor;

impl MemoryDoctor {
    /// Read-only diagnostics.  Canonical manifest or note corruption is
    /// surfaced as an error; it is never silently reconstructed from a
    /// potentially tampered working tree.
    pub fn inspect(root: impl AsRef<Path>, project_id: &str) -> DoctorReport {
        let mut report = DoctorReport {
            project_id: project_id.to_owned(),
            git_revision: None,
            findings: Vec::new(),
        };
        let root = match MemoryRoot::new(root.as_ref().to_path_buf()) {
            Ok(root) => root,
            Err(error) => {
                report.findings.push(DoctorFinding {
                    code: FindingCode::InvalidRoot,
                    severity: FindingSeverity::Error,
                    entry_id: None,
                    detail: error.to_string(),
                    repairable_by_rebuild: false,
                });
                return report;
            }
        };
        match git_checked_out_revision(&root.path) {
            Ok(revision) => report.git_revision = Some(revision),
            Err(error) => report.findings.push(DoctorFinding {
                code: FindingCode::GitUnavailable,
                severity: FindingSeverity::Error,
                entry_id: None,
                detail: error.to_string(),
                repairable_by_rebuild: false,
            }),
        }
        if let Ok(status) = git_status(&root.path) {
            if !status.trim().is_empty() {
                report.findings.push(DoctorFinding {
                    code: FindingCode::UncommittedChanges,
                    severity: FindingSeverity::Warning,
                    entry_id: None,
                    detail: "memory checkout has uncommitted changes".into(),
                    repairable_by_rebuild: false,
                });
            }
        }
        let manifest_text = match fs::read_to_string(root.manifest_path()) {
            Ok(text) => text,
            Err(error) => {
                report.findings.push(DoctorFinding {
                    code: FindingCode::MissingManifest,
                    severity: FindingSeverity::Error,
                    entry_id: None,
                    detail: error.to_string(),
                    repairable_by_rebuild: false,
                });
                return report;
            }
        };
        let parsed = match parse_manifest(&manifest_text) {
            Ok(parsed) => parsed,
            Err(error) => {
                report.findings.push(DoctorFinding {
                    code: FindingCode::InvalidManifest,
                    severity: FindingSeverity::Error,
                    entry_id: None,
                    detail: error.to_string(),
                    repairable_by_rebuild: false,
                });
                return report;
            }
        };
        if parsed.project_id != project_id {
            report.findings.push(DoctorFinding {
                code: FindingCode::ScopeViolation,
                severity: FindingSeverity::Error,
                entry_id: None,
                detail: format!("manifest belongs to project {}", parsed.project_id),
                repairable_by_rebuild: false,
            });
        }
        if parsed.identity() != parsed.manifest_identity {
            report.findings.push(DoctorFinding {
                code: FindingCode::ManifestIdentityMismatch,
                severity: FindingSeverity::Error,
                entry_id: None,
                detail: "manifest identity does not match canonical fields".into(),
                repairable_by_rebuild: false,
            });
        }
        let mut expected = Vec::new();
        for entry in &parsed.entries {
            expected.push(format!("{}.md", entry.memory_entry_id));
            let path = match root.checked_child(PathBuf::from(&entry.manifest_path)) {
                Ok(path) => path,
                Err(error) => {
                    report.findings.push(DoctorFinding {
                        code: FindingCode::InvalidManifest,
                        severity: FindingSeverity::Error,
                        entry_id: Some(entry.memory_entry_id.clone()),
                        detail: error.to_string(),
                        repairable_by_rebuild: false,
                    });
                    continue;
                }
            };
            match fs::read(&path) {
                Ok(bytes) if digest(&bytes) != entry.content_digest => {
                    report.findings.push(DoctorFinding {
                        code: FindingCode::EntryDigestMismatch,
                        severity: FindingSeverity::Error,
                        entry_id: Some(entry.memory_entry_id.clone()),
                        detail: "note bytes do not match the manifest digest".into(),
                        repairable_by_rebuild: false,
                    })
                }
                Ok(bytes) if validate_note(&bytes, entry).is_err() => {
                    report.findings.push(DoctorFinding {
                        code: FindingCode::EntryInvalid,
                        severity: FindingSeverity::Error,
                        entry_id: Some(entry.memory_entry_id.clone()),
                        detail: "note frontmatter or citations are invalid".into(),
                        repairable_by_rebuild: false,
                    })
                }
                Ok(_) => {}
                Err(error) if error.kind() == io::ErrorKind::NotFound => {
                    report.findings.push(DoctorFinding {
                        code: FindingCode::MissingEntry,
                        severity: FindingSeverity::Error,
                        entry_id: Some(entry.memory_entry_id.clone()),
                        detail: "manifest entry file is missing".into(),
                        repairable_by_rebuild: false,
                    })
                }
                Err(error) => report.findings.push(DoctorFinding {
                    code: FindingCode::EntryInvalid,
                    severity: FindingSeverity::Error,
                    entry_id: Some(entry.memory_entry_id.clone()),
                    detail: error.to_string(),
                    repairable_by_rebuild: false,
                }),
            }
        }
        let notes = root.path.join("notes");
        if let Ok(entries) = fs::read_dir(notes) {
            for entry in entries.flatten() {
                let file_name = entry.file_name().to_string_lossy().into_owned();
                if file_name.ends_with(".md") && !expected.iter().any(|name| name == &file_name) {
                    report.findings.push(DoctorFinding {
                        code: FindingCode::OrphanedEntry,
                        severity: FindingSeverity::Warning,
                        entry_id: file_name.strip_suffix(".md").map(str::to_owned),
                        detail: "note is not referenced by the manifest".into(),
                        repairable_by_rebuild: false,
                    });
                }
            }
        }
        report.findings.sort_by(|left, right| {
            left.code
                .cmp(&right.code)
                .then_with(|| left.entry_id.cmp(&right.entry_id))
        });
        report
    }

    /// Rebuild only the derived index.  A canonical manifest or note finding
    /// prevents repair, which makes a second run a safe no-op after callers
    /// have resolved the underlying Git revision.
    pub fn repair_index(
        root: impl AsRef<Path>,
        project_id: &str,
    ) -> Result<MemoryIndex, IndexError> {
        rebuild_index(root, project_id)
    }
}

fn git_status(root: &Path) -> Result<String, ImportError> {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(["status", "--porcelain", "--untracked-files=all"])
        .output()
        .map_err(|error| ImportError::Git(error.to_string()))?;
    if !output.status.success() {
        return Err(ImportError::Git(
            String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn validate_note(bytes: &[u8], entry: &ManifestEntry) -> Result<(), ImportError> {
    let text = std::str::from_utf8(bytes)
        .map_err(|_| ImportError::InvalidManifest("entry is not UTF-8 Markdown".into()))?;
    let required = [
        format!("schema_version: {}", ENTRY_SCHEMA_VERSION),
        format!("project_id: {}", entry.project_id),
        format!("entry_id: {}", entry.memory_entry_id),
        "state: published".to_owned(),
        "## Sources".to_owned(),
    ];
    if !text.starts_with("---\n") || required.iter().any(|line| !text.contains(line)) {
        return Err(ImportError::InvalidManifest(format!(
            "entry {} has invalid frontmatter",
            entry.memory_entry_id
        )));
    }
    let mut rendered_citations = text
        .lines()
        .skip_while(|line| *line != "## Sources")
        .skip(1)
        .filter_map(parse_rendered_citation)
        .map(|citation| citation.source_version_id)
        .collect::<Vec<_>>();
    rendered_citations.sort();
    rendered_citations.dedup();
    let mut manifest_citations = entry.source_citations.clone();
    manifest_citations.sort();
    manifest_citations.dedup();
    if rendered_citations != manifest_citations {
        return Err(ImportError::InvalidManifest(format!(
            "entry {} citations do not match the manifest",
            entry.memory_entry_id
        )));
    }
    Ok(())
}

fn manifest_entry(
    draft: &Draft,
    operation_id: &str,
    content_digest: String,
    state: PublicationState,
) -> ManifestEntry {
    let mut source_citations = draft
        .citations
        .iter()
        .map(|citation| citation.source_version_id.clone())
        .collect::<Vec<_>>();
    source_citations.sort();
    source_citations.dedup();
    ManifestEntry {
        memory_entry_id: draft.entry_id.clone(),
        project_id: draft.project_id.clone(),
        state,
        content_digest,
        source_citations,
        manifest_path: format!("notes/{}.md", draft.entry_id),
        operation_id: operation_id.to_owned(),
        provenance_preserved: true,
    }
}

fn validate_manifest_entry(project_id: &str, entry: &ManifestEntry) -> Result<(), MemoryError> {
    validate_segment(&entry.memory_entry_id)?;
    validate_segment(&entry.project_id)?;
    validate_segment(&entry.operation_id)?;
    if entry.project_id != project_id {
        return Err(MemoryError::InvalidManifest(
            "entry project does not match manifest".into(),
        ));
    }
    if entry.state != PublicationState::Published || !entry.provenance_preserved {
        return Err(MemoryError::InvalidManifest(
            "published manifest entries must preserve provenance".into(),
        ));
    }
    let expected_path = format!("notes/{}.md", entry.memory_entry_id);
    let path = Path::new(&entry.manifest_path);
    if entry.manifest_path != expected_path || path.is_absolute() || has_parent_component(path) {
        return Err(MemoryError::InvalidPath);
    }
    if entry.source_citations.is_empty()
        || entry
            .source_citations
            .iter()
            .any(|citation| citation.is_empty())
    {
        return Err(MemoryError::MissingCitation);
    }
    Ok(())
}

fn manifest_entries_equivalent(left: &ManifestEntry, right: &ManifestEntry) -> bool {
    if left.memory_entry_id != right.memory_entry_id
        || left.project_id != right.project_id
        || left.state != right.state
        || left.content_digest != right.content_digest
        || left.manifest_path != right.manifest_path
        || left.operation_id != right.operation_id
        || left.provenance_preserved != right.provenance_preserved
    {
        return false;
    }
    let mut left_citations = left.source_citations.clone();
    let mut right_citations = right.source_citations.clone();
    left_citations.sort();
    left_citations.dedup();
    right_citations.sort();
    right_citations.dedup();
    left_citations == right_citations
}

fn canonical_manifest_without_identity(manifest: &PublicationManifest) -> String {
    let mut entries = manifest.entries.clone();
    entries.sort_by(|left, right| left.memory_entry_id.cmp(&right.memory_entry_id));
    let rendered_entries = entries
        .iter()
        .map(|entry| {
            let mut citations = entry.source_citations.clone();
            citations.sort();
            citations.dedup();
            let citations = citations
                .iter()
                .map(|citation| json_string(citation))
                .collect::<Vec<_>>()
                .join(",");
            format!(
                "{{\"memory_entry_id\":{},\"project_id\":{},\"state\":{},\"content_digest\":{},\"source_citations\":[{}],\"manifest_path\":{},\"operation_id\":{},\"provenance_preserved\":{}}}",
                json_string(&entry.memory_entry_id),
                json_string(&entry.project_id),
                json_string(entry.state.as_str()),
                json_string(&entry.content_digest),
                citations,
                json_string(&entry.manifest_path),
                json_string(&entry.operation_id),
                entry.provenance_preserved
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    format!(
        "{{\"schema_version\":{},\"project_id\":{},\"operation_id\":{},\"entries\":[{}]",
        json_string(MANIFEST_SCHEMA_VERSION),
        json_string(&manifest.project_id),
        json_string(&manifest.operation_id),
        rendered_entries
    )
}

fn atomic_write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::other("missing parent"))?;
    fs::create_dir_all(parent)?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let name = path.file_name().unwrap().to_string_lossy();
    let temp = parent.join(format!(".{}.tmp-{}-{}", name, std::process::id(), stamp));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)?;
    let result = (|| {
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&temp, path)?;
        if let Ok(directory) = File::open(parent) {
            let _ = directory.sync_all();
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

/// Remove only abandoned temp files created by this publisher.  A process
/// crash after syncing a temp file but before rename must not turn a retry
/// into an unrelated dirty-worktree conflict.
fn cleanup_publication_temps(
    root: &Path,
    note_path: &Path,
    manifest_path: &Path,
) -> io::Result<()> {
    let manifest_prefix = format!(
        ".{}.tmp-",
        manifest_path.file_name().unwrap().to_string_lossy()
    );
    let note_prefix = format!(".{}.tmp-", note_path.file_name().unwrap().to_string_lossy());
    let note_parent = note_path
        .parent()
        .ok_or_else(|| io::Error::other("note path has no parent"))?;

    for (directory, prefix) in [(root, manifest_prefix), (note_parent, note_prefix)] {
        if !directory.is_dir() {
            continue;
        }
        for entry in fs::read_dir(directory)? {
            let entry = entry?;
            let file_name = entry.file_name();
            if file_name.to_string_lossy().starts_with(&prefix) && entry.file_type()?.is_file() {
                fs::remove_file(entry.path())?;
            }
        }
    }
    Ok(())
}

fn validate_root_path(path: &Path) -> Result<(), MemoryError> {
    if path.as_os_str().is_empty()
        || path.is_file()
        || has_parent_component(path)
        || path == Path::new("/")
        || path == Path::new(".")
    {
        return Err(MemoryError::InvalidPath);
    }
    Ok(())
}

fn canonicalize_with_existing_parent(path: &Path) -> Result<PathBuf, MemoryError> {
    let mut missing = Vec::new();
    let mut current = path.to_path_buf();
    while !current.exists() {
        let name = current.file_name().ok_or(MemoryError::InvalidPath)?;
        missing.push(name.to_owned());
        current.pop();
    }
    let mut canonical = fs::canonicalize(current)?;
    for component in missing.iter().rev() {
        canonical.push(component);
    }
    Ok(canonical)
}

fn validate_segment(value: &str) -> Result<(), MemoryError> {
    if value.is_empty() {
        return Err(MemoryError::EmptyIdentity);
    }
    if value == "."
        || value == ".."
        || value.len() > 255
        || value.chars().any(|character| {
            character.is_control()
                || character.is_whitespace()
                || character == '/'
                || character == '\\'
        })
    {
        return Err(MemoryError::InvalidPath);
    }
    Ok(())
}

fn has_parent_component(path: &Path) -> bool {
    path.components()
        .any(|component| matches!(component, Component::ParentDir))
}

fn reject_symlink(path: &Path) -> Result<(), MemoryError> {
    if fs::symlink_metadata(path)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err(MemoryError::InvalidPath);
    }
    Ok(())
}

fn json_string(value: &str) -> String {
    let mut output = String::with_capacity(value.len() + 2);
    output.push('"');
    for character in value.chars() {
        match character {
            '"' => output.push_str("\\\""),
            '\\' => output.push_str("\\\\"),
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '\t' => output.push_str("\\t"),
            character if character.is_control() => {
                output.push_str(&format!("\\u{:04x}", character as u32))
            }
            character => output.push(character),
        }
    }
    output.push('"');
    output
}

/// Stable content identity used by manifests, notes, and derived indexes.
///
/// This small dependency-free interface is intentionally kept local until the
/// workspace can provide one shared digest crate without changing the
/// bootstrap lockfile. It uses the same `sha256:<lowercase-hex>` identity
/// shape as the source and protocol contracts; FNV is not suitable for
/// provenance or publication identities.
pub fn content_digest(bytes: &[u8]) -> String {
    let mut state = [
        0x6a09e667_u32,
        0xbb67ae85_u32,
        0x3c6ef372_u32,
        0xa54ff53a_u32,
        0x510e527f_u32,
        0x9b05688c_u32,
        0x1f83d9ab_u32,
        0x5be0cd19_u32,
    ];
    let bit_length = (bytes.len() as u64).wrapping_mul(8);
    let padded_len = (bytes.len() + 9).div_ceil(64) * 64;
    let mut padded = Vec::with_capacity(padded_len);
    padded.extend_from_slice(bytes);
    padded.push(0x80);
    padded.resize(padded_len - 8, 0);
    padded.extend_from_slice(&bit_length.to_be_bytes());

    for chunk in padded.chunks_exact(64) {
        let mut words = [0_u32; 64];
        for (index, word) in words[..16].iter_mut().enumerate() {
            let offset = index * 4;
            *word = u32::from_be_bytes([
                chunk[offset],
                chunk[offset + 1],
                chunk[offset + 2],
                chunk[offset + 3],
            ]);
        }
        for index in 16..64 {
            let s0 = words[index - 15].rotate_right(7)
                ^ words[index - 15].rotate_right(18)
                ^ (words[index - 15] >> 3);
            let s1 = words[index - 2].rotate_right(17)
                ^ words[index - 2].rotate_right(19)
                ^ (words[index - 2] >> 10);
            words[index] = words[index - 16]
                .wrapping_add(s0)
                .wrapping_add(words[index - 7])
                .wrapping_add(s1);
        }

        let mut working = state;
        for (index, constant) in SHA256_ROUND_CONSTANTS.iter().enumerate() {
            let s1 = working[4].rotate_right(6)
                ^ working[4].rotate_right(11)
                ^ working[4].rotate_right(25);
            let choice = (working[4] & working[5]) ^ ((!working[4]) & working[6]);
            let temp1 = working[7]
                .wrapping_add(s1)
                .wrapping_add(choice)
                .wrapping_add(*constant)
                .wrapping_add(words[index]);
            let s0 = working[0].rotate_right(2)
                ^ working[0].rotate_right(13)
                ^ working[0].rotate_right(22);
            let majority =
                (working[0] & working[1]) ^ (working[0] & working[2]) ^ (working[1] & working[2]);
            let temp2 = s0.wrapping_add(majority);
            working[7] = working[6];
            working[6] = working[5];
            working[5] = working[4];
            working[4] = working[3].wrapping_add(temp1);
            working[3] = working[2];
            working[2] = working[1];
            working[1] = working[0];
            working[0] = temp1.wrapping_add(temp2);
        }
        for index in 0..8 {
            state[index] = state[index].wrapping_add(working[index]);
        }
    }

    let mut hex = String::with_capacity(71);
    hex.push_str("sha256:");
    for word in state {
        hex.push_str(&format!("{word:08x}"));
    }
    hex
}

fn digest(bytes: &[u8]) -> String {
    content_digest(bytes)
}

const SHA256_ROUND_CONSTANTS: [u32; 64] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

fn io_publish(error: MemoryError) -> PublishError {
    PublishError::Io(error.to_string())
}

fn io_publish_io(error: io::Error) -> PublishError {
    PublishError::Io(error.to_string())
}

fn status_only_managed(status: &str, note_name: &str) -> bool {
    status.lines().all(|line| {
        let path = line.get(3..).map(str::trim).unwrap_or_default();
        path == "manifest.json" || path == note_name
    })
}

fn import_io(error: io::Error) -> ImportError {
    ImportError::Io(error.to_string())
}

fn ensure_git_repository(root: &Path) -> Result<(), PublishError> {
    if root.join(".git").exists() {
        git_output(root, &["rev-parse", "--is-inside-work-tree"])?;
    } else {
        git_output(root, &["init", "--quiet"])?;
    }
    Ok(())
}

fn git_checked_out_revision(root: &Path) -> Result<String, ImportError> {
    git_output(root, &["rev-parse", "HEAD"])
        .map(|value| value.trim().to_owned())
        .map_err(|error| ImportError::Git(error.to_string()))
}

fn git_output(root: &Path, args: &[&str]) -> Result<String, PublishError> {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .map_err(|error| PublishError::Git(error.to_string()))?;
    if !output.status.success() {
        return Err(PublishError::Git(
            String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn git_output_with_config(root: &Path, args: &[&str]) -> Result<String, PublishError> {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .arg("-c")
        .arg("user.name=Boreal Memory Publisher")
        .arg("-c")
        .arg("user.email=boreal-memory@localhost")
        .args(args)
        .output()
        .map_err(|error| PublishError::Git(error.to_string()))?;
    if !output.status.success() {
        return Err(PublishError::Git(
            String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

// The parser accepts the compact JSON emitted above and is intentionally
// strict about strings, arrays, objects, and booleans.
#[derive(Clone, Debug)]
enum JsonValue {
    Object(Vec<(String, JsonValue)>),
    Array(Vec<JsonValue>),
    String(String),
    Bool(bool),
}

struct JsonParser<'a> {
    bytes: &'a [u8],
    position: usize,
}

impl<'a> JsonParser<'a> {
    fn new(text: &'a str) -> Self {
        Self {
            bytes: text.as_bytes(),
            position: 0,
        }
    }

    fn parse_value(&mut self) -> Result<JsonValue, ImportError> {
        self.skip_space();
        match self.bytes.get(self.position) {
            Some(b'{') => self.parse_object(),
            Some(b'[') => self.parse_array(),
            Some(b'"') => self.parse_string().map(JsonValue::String),
            Some(b't') if self.take_literal(b"true") => Ok(JsonValue::Bool(true)),
            Some(b'f') if self.take_literal(b"false") => Ok(JsonValue::Bool(false)),
            _ => Err(ImportError::InvalidManifest("invalid JSON value".into())),
        }
    }

    fn parse_object(&mut self) -> Result<JsonValue, ImportError> {
        self.position += 1;
        let mut values = Vec::new();
        loop {
            self.skip_space();
            if self.consume(b'}') {
                return Ok(JsonValue::Object(values));
            }
            let key = self.parse_string()?;
            self.skip_space();
            if !self.consume(b':') {
                return Err(ImportError::InvalidManifest("missing object colon".into()));
            }
            values.push((key, self.parse_value()?));
            self.skip_space();
            if self.consume(b'}') {
                return Ok(JsonValue::Object(values));
            }
            if !self.consume(b',') {
                return Err(ImportError::InvalidManifest("missing object comma".into()));
            }
        }
    }

    fn parse_array(&mut self) -> Result<JsonValue, ImportError> {
        self.position += 1;
        let mut values = Vec::new();
        loop {
            self.skip_space();
            if self.consume(b']') {
                return Ok(JsonValue::Array(values));
            }
            values.push(self.parse_value()?);
            self.skip_space();
            if self.consume(b']') {
                return Ok(JsonValue::Array(values));
            }
            if !self.consume(b',') {
                return Err(ImportError::InvalidManifest("missing array comma".into()));
            }
        }
    }

    fn parse_string(&mut self) -> Result<String, ImportError> {
        if !self.consume(b'"') {
            return Err(ImportError::InvalidManifest("expected JSON string".into()));
        }
        let mut result = String::new();
        while let Some(byte) = self.bytes.get(self.position).copied() {
            self.position += 1;
            match byte {
                b'"' => return Ok(result),
                b'\\' => {
                    let escaped = self.bytes.get(self.position).copied().ok_or_else(|| {
                        ImportError::InvalidManifest("unterminated JSON escape".into())
                    })?;
                    self.position += 1;
                    match escaped {
                        b'"' => result.push('"'),
                        b'\\' => result.push('\\'),
                        b'n' => result.push('\n'),
                        b'r' => result.push('\r'),
                        b't' => result.push('\t'),
                        b'u' => {
                            let code_point = self.take_hex_code_point()?;
                            let character = char::from_u32(code_point).ok_or_else(|| {
                                ImportError::InvalidManifest(
                                    "invalid Unicode escape in JSON string".into(),
                                )
                            })?;
                            result.push(character);
                        }
                        _ => {
                            return Err(ImportError::InvalidManifest(
                                "unsupported JSON escape".into(),
                            ))
                        }
                    }
                }
                byte if byte.is_ascii_control() => {
                    return Err(ImportError::InvalidManifest(
                        "control byte in JSON string".into(),
                    ))
                }
                _byte => {
                    let start = self.position - 1;
                    let remaining = &self.bytes[start..];
                    let character = std::str::from_utf8(remaining)
                        .map_err(|_| {
                            ImportError::InvalidManifest("invalid UTF-8 in JSON string".into())
                        })?
                        .chars()
                        .next()
                        .ok_or_else(|| {
                            ImportError::InvalidManifest("invalid JSON string".into())
                        })?;
                    self.position = start + character.len_utf8();
                    result.push(character);
                }
            }
        }
        Err(ImportError::InvalidManifest(
            "unterminated JSON string".into(),
        ))
    }

    fn take_literal(&mut self, literal: &[u8]) -> bool {
        if self.bytes.get(self.position..self.position + literal.len()) == Some(literal) {
            self.position += literal.len();
            true
        } else {
            false
        }
    }

    fn take_hex_code_point(&mut self) -> Result<u32, ImportError> {
        let mut value = 0_u32;
        for _ in 0..4 {
            let byte =
                self.bytes.get(self.position).copied().ok_or_else(|| {
                    ImportError::InvalidManifest("truncated Unicode escape".into())
                })?;
            self.position += 1;
            let digit = match byte {
                b'0'..=b'9' => u32::from(byte - b'0'),
                b'a'..=b'f' => u32::from(byte - b'a' + 10),
                b'A'..=b'F' => u32::from(byte - b'A' + 10),
                _ => {
                    return Err(ImportError::InvalidManifest(
                        "invalid Unicode escape".into(),
                    ))
                }
            };
            value = (value << 4) | digit;
        }
        Ok(value)
    }

    fn consume(&mut self, expected: u8) -> bool {
        if self.bytes.get(self.position) == Some(&expected) {
            self.position += 1;
            true
        } else {
            false
        }
    }

    fn skip_space(&mut self) {
        while self
            .bytes
            .get(self.position)
            .is_some_and(u8::is_ascii_whitespace)
        {
            self.position += 1;
        }
    }
}

#[derive(Clone, Debug)]
struct ParsedManifest {
    project_id: String,
    operation_id: String,
    manifest_identity: String,
    entries: Vec<ManifestEntry>,
}

fn parse_manifest(text: &str) -> Result<ParsedManifest, ImportError> {
    let mut parser = JsonParser::new(text);
    let value = parser.parse_value()?;
    parser.skip_space();
    if parser.position != parser.bytes.len() {
        return Err(ImportError::InvalidManifest("trailing JSON content".into()));
    }
    let object = as_object(&value)?;
    if required_string(object, "schema_version")? != MANIFEST_SCHEMA_VERSION {
        return Err(ImportError::InvalidManifest(
            "unsupported schema version".into(),
        ));
    }
    let project_id = required_string(object, "project_id")?;
    validate_segment(&project_id).map_err(|_| ImportError::InvalidPath)?;
    let operation_id = required_string(object, "operation_id")?;
    validate_segment(&operation_id).map_err(|_| ImportError::InvalidPath)?;
    let entries = match required_value(object, "entries")? {
        JsonValue::Array(values) => values
            .iter()
            .map(parse_manifest_entry)
            .collect::<Result<Vec<_>, _>>()?,
        _ => {
            return Err(ImportError::InvalidManifest(
                "entries is not an array".into(),
            ))
        }
    };
    Ok(ParsedManifest {
        project_id,
        operation_id,
        manifest_identity: required_string(object, "manifest_identity")?,
        entries,
    })
}

impl ParsedManifest {
    fn into_manifest(self) -> Result<PublicationManifest, MemoryError> {
        let mut manifest =
            PublicationManifest::with_entries(&self.project_id, &self.operation_id, self.entries)?;
        manifest.manifest_identity = self.manifest_identity;
        Ok(manifest)
    }

    fn identity(&self) -> String {
        PublicationManifest {
            project_id: self.project_id.clone(),
            operation_id: self.operation_id.clone(),
            manifest_identity: self.manifest_identity.clone(),
            entries: self.entries.clone(),
        }
        .identity()
    }
}

fn parse_manifest_entry(value: &JsonValue) -> Result<ManifestEntry, ImportError> {
    let object = as_object(value)?;
    let memory_entry_id = required_string(object, "memory_entry_id")?;
    let project_id = required_string(object, "project_id")?;
    let state = match required_string(object, "state")?.as_str() {
        "published" => PublicationState::Published,
        "publishing" => PublicationState::Publishing,
        "failed" => PublicationState::Failed,
        "conflict" => PublicationState::Conflict,
        _ => {
            return Err(ImportError::InvalidManifest(
                "unknown publication state".into(),
            ))
        }
    };
    let content_digest = required_string(object, "content_digest")?;
    let source_citations = match required_value(object, "source_citations")? {
        JsonValue::Array(values) => values
            .iter()
            .map(|value| match value {
                JsonValue::String(value) if !value.is_empty() => Ok(value.clone()),
                _ => Err(ImportError::InvalidManifest(
                    "invalid source citation".into(),
                )),
            })
            .collect::<Result<Vec<_>, _>>()?,
        _ => {
            return Err(ImportError::InvalidManifest(
                "source citations are not an array".into(),
            ))
        }
    };
    let manifest_path = required_string(object, "manifest_path")?;
    let operation_id = required_string(object, "operation_id")?;
    let provenance_preserved = match required_value(object, "provenance_preserved")? {
        JsonValue::Bool(value) => *value,
        _ => {
            return Err(ImportError::InvalidManifest(
                "provenance flag is not boolean".into(),
            ))
        }
    };
    validate_segment(&memory_entry_id).map_err(|_| ImportError::InvalidPath)?;
    validate_segment(&operation_id).map_err(|_| ImportError::InvalidPath)?;
    Ok(ManifestEntry {
        memory_entry_id,
        project_id,
        state,
        content_digest,
        source_citations,
        manifest_path,
        operation_id,
        provenance_preserved,
    })
}

fn as_object(value: &JsonValue) -> Result<&[(String, JsonValue)], ImportError> {
    match value {
        JsonValue::Object(values) => Ok(values),
        _ => Err(ImportError::InvalidManifest(
            "manifest is not an object".into(),
        )),
    }
}

fn required_value<'a>(
    object: &'a [(String, JsonValue)],
    key: &str,
) -> Result<&'a JsonValue, ImportError> {
    object
        .iter()
        .find(|(candidate, _)| candidate == key)
        .map(|(_, value)| value)
        .ok_or_else(|| ImportError::InvalidManifest(format!("missing field {}", key)))
}

fn required_string(object: &[(String, JsonValue)], key: &str) -> Result<String, ImportError> {
    match required_value(object, key)? {
        JsonValue::String(value) => Ok(value.clone()),
        _ => Err(ImportError::InvalidManifest(format!(
            "field {} is not a string",
            key
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn draft() -> Draft {
        Draft::new(
            "p1",
            "entry-1",
            "Title",
            "Body",
            vec![Citation {
                source_version_id: "sv_1".into(),
                location: "line:1".into(),
            }],
        )
        .unwrap()
    }

    #[test]
    fn drafts_need_citations_and_are_not_published_by_rendering() {
        assert!(matches!(
            Draft::new("p1", "e", "t", "b", vec![]),
            Err(MemoryError::MissingCitation)
        ));
        let draft = draft();
        assert!(render_markdown(&draft).unwrap().contains("state: draft"));
        assert!(!render_markdown(&draft).unwrap().contains("attempt"));
        assert_eq!(draft.state, DraftState::Draft);
    }

    #[test]
    fn publication_identity_is_stable_and_review_is_explicit() {
        let draft = draft().review(true);
        let one = publication_identity(&draft, "op_1").unwrap();
        let two = publication_identity(&draft, "op_1").unwrap();
        assert_eq!(one, two);
        assert_eq!(draft.state, DraftState::Accepted);
    }

    #[test]
    fn manifest_and_markdown_are_canonical() {
        let mut draft = draft().review(true);
        draft.citations.push(Citation {
            source_version_id: "sv_0".into(),
            location: "line:2".into(),
        });
        let markdown = render_markdown(&draft).unwrap();
        assert!(markdown.find("sv_0").unwrap() < markdown.find("sv_1").unwrap());
        let identity = publication_identity(&draft, "op_1").unwrap();
        assert!(!identity.manifest_identity.is_empty());
    }
}
