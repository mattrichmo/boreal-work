//! Immutable, project-scoped source intake primitives.
//!
//! The catalog deliberately keeps source metadata separate from blob storage.
//! A source version is inserted only after its content-addressed blob has been
//! durably written and verified. Blob availability is checked again when a
//! version is read, so missing and tampered evidence remains visible.

pub mod workspace_snapshot;

use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    fmt,
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex, MutexGuard,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

#[cfg(unix)]
use std::os::fd::AsRawFd;

use serde::{Deserialize, Serialize};

pub const DEFAULT_MAX_CITATION_BYTES: usize = 64 * 1024;
pub const DEFAULT_MAX_LOCATION_BYTES: usize = 4 * 1024;
pub const DEFAULT_PARSER_IDENTITY: &str = "plain-text-lines/v1";
pub const DEFAULT_MAX_PARSE_BYTES: usize = 4 * 1024 * 1024;
pub const DEFAULT_MAX_PARSE_CHUNKS: usize = 100_000;
pub const DEFAULT_MAX_CHUNK_BYTES: usize = 16 * 1024;
pub const DEFAULT_MAX_RETRIEVAL_EXCERPT_BYTES: usize = 4 * 1024;
/// Default bound for an artifact returned inline or materialized by a client.
/// Larger inputs remain capturable/searchable by an explicitly configured
/// adapter, but are never expanded into an unbounded context response.
pub const DEFAULT_MAX_ARTIFACT_BYTES: usize = 16 * 1024 * 1024;
pub const SOURCE_BUNDLE_FORMAT_V1: &str = "boreal.source.bundle.v1";
/// Exported source bundles are intentionally bounded so backup/restore cannot
/// turn a catalog with unexpectedly large blobs into an unbounded allocation.
pub const MAX_SOURCE_BUNDLE_BYTES: usize = 512 * 1024 * 1024;
const MAX_SOURCE_BUNDLE_METADATA_BYTES: usize = 64 * 1024 * 1024;
const SOURCE_BUNDLE_MAGIC: &[u8] = b"boreal.source.bundle.v1\0";
pub const MAX_ARTIFACT_RELATIONSHIPS: usize = 100_000;
pub const MAX_ARTIFACT_PROVENANCE_FIELD_BYTES: usize = 4 * 1024;
const CATALOG_LOCK_WAIT: Duration = Duration::from_secs(10);
/// Canonical content identity shared with the migration boundary.
pub const DIGEST_ALGORITHM: &str = "sha256";

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum Availability {
    Available,
    Missing,
    Corrupt,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct SourceVersion {
    pub project_id: String,
    pub source_version_id: String,
    pub origin: String,
    pub media_type: String,
    pub byte_count: usize,
    pub content_digest: String,
    pub availability: Availability,
    pub parser_identity: Option<String>,
}

/// Immutable identity for source and generated artifact bytes. The digest is
/// always checked against the catalog record before bytes are returned.
#[derive(Clone, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
pub struct SourceIdentity {
    pub project_id: String,
    pub source_version_id: String,
    pub content_digest: String,
}

impl SourceIdentity {
    pub fn from_version(version: &SourceVersion) -> Self {
        Self {
            project_id: version.project_id.clone(),
            source_version_id: version.source_version_id.clone(),
            content_digest: version.content_digest.clone(),
        }
    }
}

/// Relationship labels describe what a captured byte version is used for;
/// they do not assert review, acceptance, publication, or deployment.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum ArtifactRole {
    InputSource,
    ProducedDeliverable,
    ValidationEvidence,
    AcceptedSubmission,
    HandoffSummary,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum ArtifactScope {
    Project,
    Private,
}

/// Identity of the work result that produced an artifact. `result_id` is an
/// immutable result/submission identity, never a path or current work status.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ArtifactProducer {
    pub work_id: String,
    pub attempt_id: String,
    pub result_id: String,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub struct ArtifactRightsProvenance {
    pub attribution: Option<String>,
    pub rights_statement: Option<String>,
    pub license: Option<String>,
}

/// A durable, path-free association between a work/result and an exact source
/// version. Rights and origin metadata remain reviewable alongside the bytes.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ArtifactRelationship {
    pub relationship_id: String,
    pub source: SourceIdentity,
    pub role: ArtifactRole,
    pub scope: ArtifactScope,
    pub requirement_key: Option<String>,
    pub produced_by: Option<ArtifactProducer>,
    pub rights: ArtifactRightsProvenance,
    pub operation_id: String,
    pub artifact_revision: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ArtifactRelationshipInput {
    pub relationship_id: String,
    pub source: SourceIdentity,
    pub role: ArtifactRole,
    pub scope: ArtifactScope,
    pub requirement_key: Option<String>,
    pub produced_by: Option<ArtifactProducer>,
    pub rights: ArtifactRightsProvenance,
    pub operation_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ArtifactRelationshipReceipt {
    pub relationship: ArtifactRelationship,
    pub duplicate: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SourceReadback {
    pub identity: SourceIdentity,
    pub media_type: String,
    pub byte_count: usize,
    pub bytes: Vec<u8>,
}

/// Versioned, project-scoped backup payload. `bytes` is a deterministic
/// binary envelope containing catalog metadata and verified content blobs.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct SourceCatalogBundle {
    pub format: String,
    pub project_id: String,
    pub bytes: Vec<u8>,
}

/// Authoritative counts returned after an idempotent source-bundle restore.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct SourceBundleReadback {
    pub format: String,
    pub project_id: String,
    pub source_versions: usize,
    pub artifact_relationships: usize,
    pub capture_operations: usize,
    pub artifact_operations: usize,
    pub blobs: usize,
    pub bytes: usize,
    pub duplicate: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MaterializationReceipt {
    pub identity: SourceIdentity,
    /// Relative to the caller-authorized root; never used as durable identity.
    pub relative_path: String,
    pub byte_count: usize,
    pub already_present: bool,
}

/// A complete source registration/capture intent.  The operation ID is owned
/// by the application boundary and is stable across retries.  The catalog
/// records the request fingerprint together with the resulting immutable
/// source version so a retry cannot silently change its origin, media type, or
/// bytes.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SourceCaptureRequest {
    pub operation_id: String,
    pub project_id: String,
    pub origin: String,
    pub media_type: String,
    pub bytes: Vec<u8>,
}

impl SourceCaptureRequest {
    pub fn new(
        operation_id: impl Into<String>,
        project_id: impl Into<String>,
        origin: impl Into<String>,
        media_type: impl Into<String>,
        bytes: impl Into<Vec<u8>>,
    ) -> Self {
        Self {
            operation_id: operation_id.into(),
            project_id: project_id.into(),
            origin: origin.into(),
            media_type: media_type.into(),
            bytes: bytes.into(),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SourceCaptureReceipt {
    pub operation_id: String,
    pub source_version: SourceVersion,
    /// True only when this exact operation was previously durably recorded.
    pub duplicate: bool,
    /// True when a new operation reused an already captured immutable byte
    /// version.  This is distinct from retry replay and remains explicit to
    /// the application adapter.
    pub reused_existing_version: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct Citation {
    pub source_version_id: String,
    pub location: String,
    pub excerpt_digest: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum ParseState {
    Indexed,
    Failed,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ParseWarning {
    pub code: String,
    pub message: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ParserLimits {
    pub max_source_bytes: usize,
    pub max_chunks: usize,
    pub max_chunk_bytes: usize,
}

impl Default for ParserLimits {
    fn default() -> Self {
        Self {
            max_source_bytes: DEFAULT_MAX_PARSE_BYTES,
            max_chunks: DEFAULT_MAX_PARSE_CHUNKS,
            max_chunk_bytes: DEFAULT_MAX_CHUNK_BYTES,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ParseReport {
    pub project_id: String,
    pub source_version_id: String,
    pub parser_identity: String,
    pub state: ParseState,
    pub output_digest: Option<String>,
    pub chunk_count: usize,
    pub warnings: Vec<ParseWarning>,
    pub error: Option<String>,
    pub index_revision: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RetrievalRequest {
    pub project_id: String,
    pub query: String,
    pub limit: usize,
    pub max_excerpt_bytes: usize,
}

impl RetrievalRequest {
    pub fn new(project_id: impl Into<String>, query: impl Into<String>) -> Self {
        Self {
            project_id: project_id.into(),
            query: query.into(),
            limit: 20,
            max_excerpt_bytes: DEFAULT_MAX_RETRIEVAL_EXCERPT_BYTES,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RetrievalLayer {
    RawSource,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RetrievalHit {
    pub source_version_id: String,
    pub origin: String,
    pub location: String,
    pub excerpt: String,
    pub excerpt_digest: String,
    pub score: usize,
    pub layer: RetrievalLayer,
    pub index_revision: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RetrievalResponse {
    pub project_id: String,
    pub query: String,
    pub hits: Vec<RetrievalHit>,
    pub source_revision: u64,
    pub index_revision: u64,
    pub lag: usize,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum FindingKind {
    MissingBlob,
    CorruptBlob,
    Unindexed,
    ParserFailed,
    StaleParser,
    OrphanIndex,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntegrityFinding {
    pub project_id: String,
    pub source_version_id: Option<String>,
    pub kind: FindingKind,
    pub detail: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IndexStatus {
    pub source_revision: u64,
    pub index_revision: u64,
    pub lag: usize,
    pub indexed_versions: usize,
    pub failed_versions: usize,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DoctorReport {
    pub project_id: Option<String>,
    pub status: IndexStatus,
    pub findings: Vec<IntegrityFinding>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RepairReport {
    pub project_id: Option<String>,
    pub attempted: usize,
    pub repaired: usize,
    pub unchanged: usize,
    pub skipped_unavailable: usize,
    pub failed: usize,
    pub orphan_indexes_removed: usize,
    pub status: IndexStatus,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CitationLimits {
    pub max_excerpt_bytes: usize,
    pub max_location_bytes: usize,
}

impl Default for CitationLimits {
    fn default() -> Self {
        Self {
            max_excerpt_bytes: DEFAULT_MAX_CITATION_BYTES,
            max_location_bytes: DEFAULT_MAX_LOCATION_BYTES,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SourceError {
    ScopeViolation,
    EmptyOrigin,
    EmptyMediaType,
    DigestMismatch,
    MissingBlob,
    StaleParser,
    InvalidCitation,
    CitationTooLarge,
    ExcerptNotFound,
    InvalidRetrievalQuery,
    EmptyParser,
    EmptyOperation,
    OperationConflict,
    SourceMetadataConflict,
    ArtifactTooLarge { actual: usize, limit: usize },
    InvalidArtifactIdentity,
    InvalidArtifactRelationship,
    ArtifactRelationshipConflict,
    TooManyArtifactRelationships,
    InvalidMaterializationPath,
    MaterializedArtifactConflict,
    InvalidBundle(String),
    BundleConflict,
    BundleTooLarge { actual: usize, limit: usize },
    Storage(String),
}

impl fmt::Display for SourceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ScopeViolation => f.write_str("source is outside the project scope"),
            Self::EmptyOrigin => f.write_str("source project or origin is empty"),
            Self::EmptyMediaType => f.write_str("source media type is empty"),
            Self::DigestMismatch => f.write_str("blob digest or size verification failed"),
            Self::MissingBlob => f.write_str("source blob is unavailable"),
            Self::StaleParser => f.write_str("parser result targets a different source version"),
            Self::InvalidCitation => f.write_str("citation is invalid for the source version"),
            Self::CitationTooLarge => {
                f.write_str("citation exceeds the configured verification bound")
            }
            Self::ExcerptNotFound => {
                f.write_str("citation excerpt is not present in the source blob")
            }
            Self::InvalidRetrievalQuery => f.write_str("retrieval query or bound is invalid"),
            Self::EmptyParser => f.write_str("parser identity is empty"),
            Self::EmptyOperation => f.write_str("source operation identity is empty"),
            Self::OperationConflict => {
                f.write_str("source operation was already used for different input")
            }
            Self::SourceMetadataConflict => {
                f.write_str("existing source version has different immutable metadata")
            }
            Self::ArtifactTooLarge { actual, limit } => write!(
                f,
                "artifact is {actual} bytes, above the configured {limit} byte bound"
            ),
            Self::InvalidArtifactIdentity => {
                f.write_str("artifact source identity is invalid or has a different digest")
            }
            Self::InvalidArtifactRelationship => {
                f.write_str("artifact relationship metadata is invalid or incomplete")
            }
            Self::ArtifactRelationshipConflict => {
                f.write_str("artifact relationship identity was reused for different metadata")
            }
            Self::TooManyArtifactRelationships => {
                f.write_str("artifact relationship limit has been reached")
            }
            Self::InvalidMaterializationPath => {
                f.write_str("artifact destination must remain below the permitted root")
            }
            Self::MaterializedArtifactConflict => {
                f.write_str("artifact destination already contains different bytes")
            }
            Self::InvalidBundle(message) => write!(f, "source backup bundle is invalid: {message}"),
            Self::BundleConflict => {
                f.write_str("source backup restore conflicts with existing project metadata")
            }
            Self::BundleTooLarge { actual, limit } => write!(
                f,
                "source backup bundle is {actual} bytes, above the configured {limit} byte bound"
            ),
            Self::Storage(message) => write!(f, "blob storage error: {message}"),
        }
    }
}
impl std::error::Error for SourceError {}

/// The narrow storage boundary used by [`SourceCatalog`]. Implementations
/// must not make a blob visible from `put` until digest and size checks pass.
pub trait BlobStore: Send + Sync {
    fn put(&self, digest: &str, bytes: &[u8]) -> Result<(), SourceError>;
    fn read_verified(&self, digest: &str, byte_count: usize) -> Result<Vec<u8>, SourceError>;
}

impl<T: BlobStore + ?Sized> BlobStore for Arc<T> {
    fn put(&self, digest: &str, bytes: &[u8]) -> Result<(), SourceError> {
        (**self).put(digest, bytes)
    }

    fn read_verified(&self, digest: &str, byte_count: usize) -> Result<Vec<u8>, SourceError> {
        (**self).read_verified(digest, byte_count)
    }
}

#[derive(Default)]
struct MemoryBlobStore {
    blobs: Mutex<HashMap<String, Vec<u8>>>,
}

impl BlobStore for MemoryBlobStore {
    fn put(&self, expected_digest: &str, bytes: &[u8]) -> Result<(), SourceError> {
        verify_input(expected_digest, bytes)?;
        let mut blobs = lock(&self.blobs)?;
        if let Some(existing) = blobs.get(expected_digest) {
            verify_bytes(expected_digest, existing.len(), existing)?;
            return Ok(());
        }
        blobs.insert(expected_digest.to_owned(), bytes.to_vec());
        Ok(())
    }

    fn read_verified(
        &self,
        expected_digest: &str,
        byte_count: usize,
    ) -> Result<Vec<u8>, SourceError> {
        let blobs = lock(&self.blobs)?;
        let bytes = blobs.get(expected_digest).ok_or(SourceError::MissingBlob)?;
        verify_bytes(expected_digest, byte_count, bytes)?;
        Ok(bytes.clone())
    }
}

/// A filesystem-backed content-addressed blob store.
///
/// Objects are stored below `<root>/blobs/` using their SHA-256 digest. A
/// temporary file is created in the same directory, flushed and synced, and
/// atomically renamed into place. Existing objects are never overwritten.
pub struct FilesystemBlobStore {
    root: PathBuf,
    write_lock: Mutex<()>,
}

impl FilesystemBlobStore {
    pub fn new(root: impl AsRef<Path>) -> Self {
        Self {
            root: root.as_ref().to_path_buf(),
            write_lock: Mutex::new(()),
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn blob_path(&self, digest: &str) -> Result<PathBuf, SourceError> {
        let hex = digest_hex(digest).ok_or(SourceError::ScopeViolation)?;
        let blob_dir = self.root.join("blobs");
        reject_symlink(&self.root)?;
        reject_symlink(&blob_dir)?;
        let path = blob_dir.join(hex);
        reject_symlink(&path)?;
        Ok(path)
    }
}

static TEMP_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);

impl BlobStore for FilesystemBlobStore {
    fn put(&self, expected_digest: &str, bytes: &[u8]) -> Result<(), SourceError> {
        verify_input(expected_digest, bytes)?;
        let _write_guard = lock(&self.write_lock)?;
        let blob_dir = self.root.join("blobs");
        reject_symlink(&self.root)?;
        reject_symlink(&blob_dir)?;
        fs::create_dir_all(&blob_dir).map_err(storage_error)?;
        let final_path = self.blob_path(expected_digest)?;

        if final_path.exists() {
            return verify_file(&final_path, expected_digest, bytes.len());
        }

        let counter = TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
        let temp_path = blob_dir.join(format!(
            ".{}.{}.{}.tmp",
            digest_hex(expected_digest).expect("validated digest"),
            std::process::id(),
            counter
        ));

        let result = write_temp_and_install(&temp_path, &final_path, expected_digest, bytes);
        if result.is_err() {
            let _ = fs::remove_file(&temp_path);
        }
        result
    }

    fn read_verified(
        &self,
        expected_digest: &str,
        byte_count: usize,
    ) -> Result<Vec<u8>, SourceError> {
        let path = self.blob_path(expected_digest)?;
        let bytes = match fs::read(path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return Err(SourceError::MissingBlob)
            }
            Err(error) => return Err(storage_error(error)),
        };
        verify_bytes(expected_digest, byte_count, &bytes)?;
        Ok(bytes)
    }
}

fn write_temp_and_install(
    temp_path: &Path,
    final_path: &Path,
    expected_digest: &str,
    bytes: &[u8],
) -> Result<(), SourceError> {
    reject_symlink(final_path)?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(temp_path)
        .map_err(storage_error)?;
    file.write_all(bytes).map_err(storage_error)?;
    file.flush().map_err(storage_error)?;
    file.sync_all().map_err(storage_error)?;
    drop(file);

    let written = fs::read(temp_path).map_err(storage_error)?;
    verify_bytes(expected_digest, bytes.len(), &written)?;
    fs::rename(temp_path, final_path).map_err(storage_error)?;
    sync_directory(
        final_path
            .parent()
            .ok_or_else(|| SourceError::Storage("blob path has no parent".to_owned()))?,
    )
}

#[derive(Clone, Default)]
struct CatalogState {
    versions: HashMap<(String, String), SourceVersion>,
    artifact_relationships: HashMap<(String, String), ArtifactRelationship>,
    parse_records: HashMap<(String, String), ParseRecord>,
    indexes: HashMap<(String, String), IndexedSource>,
    capture_operations: HashMap<String, CaptureOperationRecord>,
    artifact_operations: HashMap<String, ArtifactOperationRecord>,
    source_revision: u64,
    index_revision: u64,
    artifact_revision: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct CaptureOperationRecord {
    request_digest: String,
    project_id: String,
    source_version_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct ArtifactOperationRecord {
    request_digest: String,
    project_id: String,
    relationship_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct ParseRecord {
    parser_identity: String,
    input_digest: String,
    state: ParseState,
    output_digest: Option<String>,
    chunk_count: usize,
    warnings: Vec<ParseWarning>,
    error: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct IndexedSource {
    parser_identity: String,
    input_digest: String,
    output_digest: String,
    chunks: Vec<IndexedChunk>,
    postings: BTreeMap<String, Vec<usize>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct IndexedChunk {
    location: String,
    text: String,
    excerpt_digest: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct ParsedIndex {
    output_digest: String,
    chunks: Vec<IndexedChunk>,
    postings: BTreeMap<String, Vec<usize>>,
    warnings: Vec<ParseWarning>,
}

#[derive(Serialize, Deserialize)]
struct PersistedCatalogState {
    versions: Vec<SourceVersion>,
    #[serde(default)]
    artifact_relationships: Vec<ArtifactRelationship>,
    parse_records: Vec<PersistedParseRecord>,
    indexes: Vec<PersistedIndexedSource>,
    #[serde(default)]
    capture_operations: Vec<PersistedCaptureOperation>,
    #[serde(default)]
    artifact_operations: Vec<PersistedArtifactOperation>,
    source_revision: u64,
    index_revision: u64,
    #[serde(default)]
    artifact_revision: u64,
}

#[derive(Serialize, Deserialize)]
struct SourceBundleMetadata {
    format: String,
    project_id: String,
    catalog: PersistedCatalogState,
}

struct SourceBundleBlob {
    digest: String,
    bytes: Vec<u8>,
}

#[derive(Serialize, Deserialize)]
struct PersistedParseRecord {
    project_id: String,
    source_version_id: String,
    record: ParseRecord,
}

#[derive(Serialize, Deserialize)]
struct PersistedIndexedSource {
    project_id: String,
    source_version_id: String,
    indexed: IndexedSource,
}

#[derive(Serialize, Deserialize)]
struct PersistedCaptureOperation {
    operation_id: String,
    record: CaptureOperationRecord,
}

#[derive(Serialize, Deserialize)]
struct PersistedArtifactOperation {
    operation_id: String,
    record: ArtifactOperationRecord,
}

pub struct SourceCatalog {
    blobs: Arc<dyn BlobStore>,
    state: Mutex<CatalogState>,
    /// Serializes metadata mutations within one catalog instance. The state
    /// snapshot is persisted only after the mutation, so this guard also lets
    /// us roll back in-memory metadata if an atomic catalog replacement fails.
    mutation_lock: Mutex<()>,
    citation_limits: CitationLimits,
    state_file: Option<PathBuf>,
    mutation_lock_file: Option<PathBuf>,
}

impl Default for SourceCatalog {
    fn default() -> Self {
        Self::with_blob_store(MemoryBlobStore::default())
    }
}

impl SourceCatalog {
    pub fn with_blob_store<S>(store: S) -> Self
    where
        S: BlobStore + 'static,
    {
        Self {
            blobs: Arc::new(store),
            state: Mutex::new(CatalogState::default()),
            mutation_lock: Mutex::new(()),
            citation_limits: CitationLimits::default(),
            state_file: None,
            mutation_lock_file: None,
        }
    }

    pub fn with_filesystem(root: impl AsRef<Path>) -> Self {
        Self::with_blob_store(FilesystemBlobStore::new(root))
    }

    /// Creates a filesystem-backed catalog whose metadata and derived index
    /// survive process restarts. Blob bytes remain content-addressed files;
    /// the catalog snapshot is replaced atomically after each successful
    /// metadata/index mutation.
    pub fn with_persistent_filesystem(root: impl AsRef<Path>) -> Result<Self, SourceError> {
        let root = root.as_ref().to_path_buf();
        reject_symlink(&root)?;
        let state_file = root.join("catalog.json");
        reject_symlink(&state_file)?;
        let state = if state_file.exists() {
            let bytes = fs::read(&state_file).map_err(storage_error)?;
            restore_catalog_state(&bytes)?
        } else {
            CatalogState::default()
        };
        Ok(Self {
            blobs: Arc::new(FilesystemBlobStore::new(&root)),
            state: Mutex::new(state),
            mutation_lock: Mutex::new(()),
            citation_limits: CitationLimits::default(),
            state_file: Some(state_file),
            mutation_lock_file: Some(root.join("catalog.lock")),
        })
    }

    pub fn with_citation_limits(mut self, limits: CitationLimits) -> Self {
        self.citation_limits = limits;
        self
    }

    pub fn capture(
        &self,
        project_id: &str,
        origin: &str,
        bytes: &[u8],
        media_type: &str,
    ) -> Result<SourceVersion, SourceError> {
        let _mutation_guard = lock(&self.mutation_lock)?;
        let _catalog_lock = self.acquire_persistent_lock()?;
        self.reload_persistent_state()?;
        let before = lock(&self.state)?.clone();
        let (version, inserted) =
            self.capture_version_locked(project_id, origin, bytes, media_type)?;
        if !inserted {
            return Ok(version);
        }
        if let Err(error) = self.persist_state() {
            *lock(&self.state)? = before;
            return Err(error);
        }
        Ok(version)
    }

    /// Capture a source through a durable, retryable operation boundary.
    /// Registration metadata, verified blob visibility, and the source-version
    /// reference are committed to one catalog snapshot.  A retry with the same
    /// operation and canonical request returns the original version without a
    /// second logical source operation; a changed request is rejected.
    pub fn capture_with_operation(
        &self,
        request: &SourceCaptureRequest,
    ) -> Result<SourceCaptureReceipt, SourceError> {
        let _mutation_guard = lock(&self.mutation_lock)?;
        let _catalog_lock = self.acquire_persistent_lock()?;
        self.reload_persistent_state()?;
        validate_operation_id(&request.operation_id)?;
        let request_digest = capture_request_digest(request);

        let existing_operation = lock(&self.state)?
            .capture_operations
            .get(&request.operation_id)
            .cloned();
        if let Some(record) = existing_operation {
            if record.request_digest != request_digest {
                return Err(SourceError::OperationConflict);
            }
            let version = lock(&self.state)?
                .versions
                .get(&(record.project_id.clone(), record.source_version_id.clone()))
                .cloned()
                .ok_or_else(|| {
                    SourceError::Storage(
                        "capture operation references a missing source version".to_owned(),
                    )
                })?;
            self.blobs.put(&version.content_digest, &request.bytes)?;
            return Ok(SourceCaptureReceipt {
                operation_id: request.operation_id.clone(),
                source_version: self.current_snapshot(version)?,
                duplicate: true,
                reused_existing_version: false,
            });
        }

        let before = lock(&self.state)?.clone();
        let (version, inserted) = self.capture_version_locked(
            &request.project_id,
            &request.origin,
            &request.bytes,
            &request.media_type,
        )?;
        lock(&self.state)?.capture_operations.insert(
            request.operation_id.clone(),
            CaptureOperationRecord {
                request_digest,
                project_id: version.project_id.clone(),
                source_version_id: version.source_version_id.clone(),
            },
        );
        if let Err(error) = self.persist_state() {
            *lock(&self.state)? = before;
            return Err(error);
        }
        Ok(SourceCaptureReceipt {
            operation_id: request.operation_id.clone(),
            source_version: version,
            duplicate: false,
            reused_existing_version: !inserted,
        })
    }

    /// Exact project/version lookup for application adapters.  Presentation
    /// pagination must never be used as an existence check.
    pub fn show_version(
        &self,
        project_id: &str,
        source_version_id: &str,
    ) -> Result<SourceVersion, SourceError> {
        validate_project_id(project_id)?;
        if source_version_id.trim().is_empty() {
            return Err(SourceError::ScopeViolation);
        }
        let version = lock(&self.state)?
            .versions
            .get(&(project_id.to_owned(), source_version_id.to_owned()))
            .cloned()
            .ok_or(SourceError::ScopeViolation)?;
        self.current_snapshot(version)
    }

    pub fn verify(&self, version: &SourceVersion) -> Result<Vec<u8>, SourceError> {
        let stored = self.authorized_version(version)?;
        self.blobs
            .read_verified(&stored.content_digest, stored.byte_count)
    }

    /// Read one exact immutable byte version. Callers must provide all three
    /// identity fields; a source ID alone is not enough to resolve an artifact
    /// after a handoff or restore.
    pub fn read_identity_bounded(
        &self,
        identity: &SourceIdentity,
        max_bytes: usize,
    ) -> Result<SourceReadback, SourceError> {
        let _mutation_guard = lock(&self.mutation_lock)?;
        self.reload_persistent_state()?;
        self.read_identity_locked(identity, max_bytes)
    }

    fn read_identity_locked(
        &self,
        identity: &SourceIdentity,
        max_bytes: usize,
    ) -> Result<SourceReadback, SourceError> {
        if max_bytes == 0 || max_bytes > DEFAULT_MAX_ARTIFACT_BYTES {
            return Err(SourceError::InvalidArtifactIdentity);
        }
        validate_project_id(&identity.project_id)?;
        if identity.source_version_id.trim().is_empty()
            || digest_hex(&identity.content_digest).is_none()
        {
            return Err(SourceError::InvalidArtifactIdentity);
        }
        // The caller has refreshed the atomic catalog snapshot under this
        // instance's mutation guard, so concurrent local mutations cannot be
        // overwritten by an older disk snapshot during readback.
        let version = lock(&self.state)?
            .versions
            .get(&(
                identity.project_id.clone(),
                identity.source_version_id.clone(),
            ))
            .cloned()
            .ok_or(SourceError::ScopeViolation)?;
        if version.content_digest != identity.content_digest {
            return Err(SourceError::InvalidArtifactIdentity);
        }
        if version.byte_count > max_bytes {
            return Err(SourceError::ArtifactTooLarge {
                actual: version.byte_count,
                limit: max_bytes,
            });
        }
        let bytes = self
            .blobs
            .read_verified(&version.content_digest, version.byte_count)?;
        if bytes.len() != version.byte_count || content_digest(&bytes) != identity.content_digest {
            return Err(SourceError::DigestMismatch);
        }
        Ok(SourceReadback {
            identity: SourceIdentity::from_version(&version),
            media_type: version.media_type,
            byte_count: bytes.len(),
            bytes,
        })
    }

    /// Record non-authoritative artifact lineage after verifying the exact
    /// bytes. The source catalog records role and provenance; acceptance and
    /// publication remain decisions of the work application/store.
    pub fn record_artifact_relationship(
        &self,
        input: ArtifactRelationshipInput,
    ) -> Result<ArtifactRelationshipReceipt, SourceError> {
        validate_artifact_relationship(&input)?;
        let request_digest = artifact_relationship_digest(&input)?;
        let _mutation_guard = lock(&self.mutation_lock)?;
        let _catalog_lock = self.acquire_persistent_lock()?;
        self.reload_persistent_state()?;

        let prior_operation = lock(&self.state)?
            .artifact_operations
            .get(&input.operation_id)
            .cloned();
        if let Some(existing) = prior_operation {
            if existing.request_digest != request_digest
                || existing.project_id != input.source.project_id
                || existing.relationship_id != input.relationship_id
            {
                return Err(SourceError::OperationConflict);
            }
            let relationship = lock(&self.state)?
                .artifact_relationships
                .get(&(existing.project_id, existing.relationship_id))
                .cloned()
                .ok_or_else(|| {
                    SourceError::Storage(
                        "artifact operation references a missing relationship".to_owned(),
                    )
                })?;
            self.read_identity_locked(&input.source, DEFAULT_MAX_ARTIFACT_BYTES)?;
            return Ok(ArtifactRelationshipReceipt {
                relationship,
                duplicate: true,
            });
        }

        let key = (
            input.source.project_id.clone(),
            input.relationship_id.clone(),
        );
        if lock(&self.state)?.artifact_relationships.contains_key(&key) {
            return Err(SourceError::ArtifactRelationshipConflict);
        }

        self.read_identity_locked(&input.source, DEFAULT_MAX_ARTIFACT_BYTES)?;
        let before = lock(&self.state)?.clone();
        let relationship = {
            let mut state = lock(&self.state)?;
            if state.artifact_relationships.len() >= MAX_ARTIFACT_RELATIONSHIPS {
                return Err(SourceError::TooManyArtifactRelationships);
            }
            state.artifact_revision = state.artifact_revision.saturating_add(1);
            let relationship = ArtifactRelationship {
                relationship_id: input.relationship_id.clone(),
                source: input.source.clone(),
                role: input.role,
                scope: input.scope,
                requirement_key: input.requirement_key.clone(),
                produced_by: input.produced_by.clone(),
                rights: input.rights.clone(),
                operation_id: input.operation_id.clone(),
                artifact_revision: state.artifact_revision,
            };
            state
                .artifact_relationships
                .insert(key, relationship.clone());
            state.artifact_operations.insert(
                input.operation_id.clone(),
                ArtifactOperationRecord {
                    request_digest,
                    project_id: input.source.project_id.clone(),
                    relationship_id: input.relationship_id.clone(),
                },
            );
            relationship
        };
        if let Err(error) = self.persist_state() {
            *lock(&self.state)? = before;
            return Err(error);
        }
        Ok(ArtifactRelationshipReceipt {
            relationship,
            duplicate: false,
        })
    }

    /// Exact relationship lookup avoids scanning a project's complete
    /// artifact history when an adapter already has the stable identity.
    pub fn show_artifact_relationship(
        &self,
        project_id: &str,
        relationship_id: &str,
    ) -> Result<Option<ArtifactRelationship>, SourceError> {
        validate_project_id(project_id)?;
        if !valid_artifact_key(relationship_id) {
            return Err(SourceError::InvalidArtifactRelationship);
        }
        let _mutation_guard = lock(&self.mutation_lock)?;
        self.reload_persistent_state()?;
        Ok(lock(&self.state)?
            .artifact_relationships
            .get(&(project_id.to_owned(), relationship_id.to_owned()))
            .cloned())
    }

    /// Verify and materialize bytes under an explicitly permitted root. The
    /// stored relationship never includes the local root or the caller's
    /// absolute destination path.
    pub fn materialize_identity(
        &self,
        identity: &SourceIdentity,
        permitted_root: &Path,
        relative_path: &Path,
        max_bytes: usize,
    ) -> Result<MaterializationReceipt, SourceError> {
        let readback = self.read_identity_bounded(identity, max_bytes)?;
        validate_relative_materialization_path(relative_path)?;
        let root = checked_materialization_root(permitted_root)?;
        let destination = ensure_materialization_parent(&root, relative_path)?;
        let relative = relative_path
            .components()
            .map(|component| component.as_os_str().to_string_lossy())
            .collect::<Vec<_>>()
            .join("/");

        match fs::symlink_metadata(&destination) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
                return Err(SourceError::InvalidMaterializationPath)
            }
            Ok(_) => {
                let existing = fs::read(&destination).map_err(storage_error)?;
                if existing.len() != readback.byte_count
                    || content_digest(&existing) != identity.content_digest
                {
                    return Err(SourceError::MaterializedArtifactConflict);
                }
                return Ok(MaterializationReceipt {
                    identity: identity.clone(),
                    relative_path: relative,
                    byte_count: readback.byte_count,
                    already_present: true,
                });
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(storage_error(error)),
        }

        let parent = destination
            .parent()
            .ok_or(SourceError::InvalidMaterializationPath)?;
        let temp = parent.join(format!(
            ".boreal-artifact-{}-{unique}.tmp",
            std::process::id(),
            unique = unique_stamp()
        ));
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(storage_error)?;
        let write_result = (|| {
            file.write_all(&readback.bytes).map_err(storage_error)?;
            file.sync_all().map_err(storage_error)?;
            let verified = fs::read(&temp).map_err(storage_error)?;
            verify_bytes(&identity.content_digest, readback.byte_count, &verified)?;
            fs::hard_link(&temp, &destination).map_err(|error| {
                if error.kind() == io::ErrorKind::AlreadyExists {
                    SourceError::MaterializedArtifactConflict
                } else {
                    storage_error(error)
                }
            })?;
            fs::remove_file(&temp).map_err(storage_error)?;
            sync_directory(parent)?;
            Ok::<(), SourceError>(())
        })();
        if let Err(error) = write_result {
            let _ = fs::remove_file(&temp);
            return Err(error);
        }
        Ok(MaterializationReceipt {
            identity: identity.clone(),
            relative_path: relative,
            byte_count: readback.byte_count,
            already_present: false,
        })
    }

    pub fn availability(&self, version: &SourceVersion) -> Result<Availability, SourceError> {
        let stored = self.authorized_version(version)?;
        Ok(
            match self
                .blobs
                .read_verified(&stored.content_digest, stored.byte_count)
            {
                Ok(_) => Availability::Available,
                Err(SourceError::MissingBlob) => Availability::Missing,
                Err(SourceError::DigestMismatch | SourceError::Storage(_)) => Availability::Corrupt,
                Err(error) => return Err(error),
            },
        )
    }

    pub fn cite(
        &self,
        version: &SourceVersion,
        location: &str,
        excerpt: &[u8],
    ) -> Result<Citation, SourceError> {
        self.validate_citation_bounds(location, excerpt)?;
        let bytes = self.verify(version)?;
        if !contains_subslice(&bytes, excerpt) {
            return Err(SourceError::ExcerptNotFound);
        }
        Ok(Citation {
            source_version_id: version.source_version_id.clone(),
            location: location.to_owned(),
            excerpt_digest: content_digest(excerpt),
        })
    }

    pub fn verify_citation(
        &self,
        version: &SourceVersion,
        citation: &Citation,
        excerpt: &[u8],
    ) -> Result<(), SourceError> {
        self.validate_citation_bounds(&citation.location, excerpt)?;
        if citation.source_version_id != version.source_version_id
            || citation.excerpt_digest != content_digest(excerpt)
        {
            return Err(SourceError::InvalidCitation);
        }
        let bytes = self.verify(version)?;
        if !contains_subslice(&bytes, excerpt) {
            return Err(SourceError::ExcerptNotFound);
        }
        Ok(())
    }

    pub fn record_parser(
        &self,
        version: &SourceVersion,
        parser: &str,
        input_version_id: &str,
    ) -> Result<SourceVersion, SourceError> {
        let _mutation_guard = lock(&self.mutation_lock)?;
        let _catalog_lock = self.acquire_persistent_lock()?;
        self.reload_persistent_state()?;
        if parser.trim().is_empty() {
            return Err(SourceError::EmptyParser);
        }
        if version.source_version_id != input_version_id {
            return Err(SourceError::StaleParser);
        }
        self.authorized_version(version)?;
        let key = (
            version.project_id.clone(),
            version.source_version_id.clone(),
        );
        let mut state = lock(&self.state)?;
        let before = state.clone();
        let updated = state
            .versions
            .get_mut(&key)
            .ok_or(SourceError::ScopeViolation)?;
        updated.parser_identity = Some(parser.to_owned());
        let result = updated.clone();
        drop(state);
        if let Err(error) = self.persist_state() {
            *lock(&self.state)? = before;
            return Err(error);
        }
        Ok(result)
    }

    /// Parse a verified source and atomically publish its rebuildable index.
    ///
    /// Parsing is deliberately plain-text and line-oriented in this first
    /// slice. It never interprets embedded commands or prompts as anything
    /// other than source data. A parser failure is retained in the catalog as
    /// a report rather than being mistaken for an empty successful index.
    pub fn parse_and_index(
        &self,
        version: &SourceVersion,
        parser: &str,
    ) -> Result<ParseReport, SourceError> {
        self.parse_and_index_with_limits(version, parser, ParserLimits::default())
    }

    pub fn parse_and_index_with_limits(
        &self,
        version: &SourceVersion,
        parser: &str,
        limits: ParserLimits,
    ) -> Result<ParseReport, SourceError> {
        let _mutation_guard = lock(&self.mutation_lock)?;
        let _catalog_lock = self.acquire_persistent_lock()?;
        self.reload_persistent_state()?;
        let before = lock(&self.state)?.clone();
        let report = self.parse_and_index_state_locked(version, parser, limits)?;
        if let Err(error) = self.persist_state() {
            *lock(&self.state)? = before;
            return Err(error);
        }
        Ok(report)
    }

    /// Update one derived index while the caller owns the catalog mutation
    /// boundary. This deliberately does not persist; a repair/rebuild must
    /// compose all derived-row changes into one durable snapshot.
    fn parse_and_index_state_locked(
        &self,
        version: &SourceVersion,
        parser: &str,
        limits: ParserLimits,
    ) -> Result<ParseReport, SourceError> {
        if parser.trim().is_empty() {
            return Err(SourceError::EmptyParser);
        }
        if limits.max_source_bytes == 0 || limits.max_chunks == 0 || limits.max_chunk_bytes == 0 {
            return Err(SourceError::InvalidRetrievalQuery);
        }
        let stored = self.authorized_version(version)?;
        let bytes = self
            .blobs
            .read_verified(&stored.content_digest, stored.byte_count)?;
        let parsed = parse_bytes(&bytes, &stored.media_type, limits);
        let key = (stored.project_id.clone(), stored.source_version_id.clone());
        let mut state = lock(&self.state)?;
        let current = state
            .versions
            .get_mut(&key)
            .ok_or(SourceError::ScopeViolation)?;
        current.parser_identity = Some(parser.to_owned());

        let report = match parsed {
            Ok(parsed) => {
                let unchanged = state.indexes.get(&key).is_some_and(|indexed| {
                    indexed.parser_identity == parser
                        && indexed.input_digest == stored.content_digest
                        && indexed.output_digest == parsed.output_digest
                });
                if !unchanged {
                    state.index_revision = state.index_revision.saturating_add(1);
                    state.indexes.insert(
                        key.clone(),
                        IndexedSource {
                            parser_identity: parser.to_owned(),
                            input_digest: stored.content_digest.clone(),
                            output_digest: parsed.output_digest.clone(),
                            chunks: parsed.chunks.clone(),
                            postings: parsed.postings.clone(),
                        },
                    );
                }
                let record = ParseRecord {
                    parser_identity: parser.to_owned(),
                    input_digest: stored.content_digest,
                    state: ParseState::Indexed,
                    output_digest: Some(parsed.output_digest.clone()),
                    chunk_count: parsed.chunks.len(),
                    warnings: parsed.warnings.clone(),
                    error: None,
                };
                state.parse_records.insert(key, record);
                ParseReport {
                    project_id: stored.project_id,
                    source_version_id: stored.source_version_id,
                    parser_identity: parser.to_owned(),
                    state: ParseState::Indexed,
                    output_digest: Some(parsed.output_digest),
                    chunk_count: parsed.chunks.len(),
                    warnings: parsed.warnings,
                    error: None,
                    index_revision: state.index_revision,
                }
            }
            Err(error) => {
                let changed = state.indexes.remove(&key).is_some();
                if changed {
                    state.index_revision = state.index_revision.saturating_add(1);
                }
                let error = error.to_owned();
                state.parse_records.insert(
                    key,
                    ParseRecord {
                        parser_identity: parser.to_owned(),
                        input_digest: stored.content_digest,
                        state: ParseState::Failed,
                        output_digest: None,
                        chunk_count: 0,
                        warnings: Vec::new(),
                        error: Some(error.clone()),
                    },
                );
                ParseReport {
                    project_id: stored.project_id,
                    source_version_id: stored.source_version_id,
                    parser_identity: parser.to_owned(),
                    state: ParseState::Failed,
                    output_digest: None,
                    chunk_count: 0,
                    warnings: Vec::new(),
                    error: Some(error),
                    index_revision: state.index_revision,
                }
            }
        };
        Ok(report)
    }

    pub fn index_status(&self, project_id: Option<&str>) -> Result<IndexStatus, SourceError> {
        validate_optional_project(project_id)?;
        let state = lock(&self.state)?;
        Ok(index_status_locked(&state, project_id))
    }

    pub fn retrieve(&self, request: &RetrievalRequest) -> Result<RetrievalResponse, SourceError> {
        validate_project_id(&request.project_id)?;
        if request.limit == 0 || request.max_excerpt_bytes == 0 {
            return Err(SourceError::InvalidRetrievalQuery);
        }
        let terms = normalized_terms(&request.query);
        if terms.is_empty() {
            return Err(SourceError::InvalidRetrievalQuery);
        }
        let (source_revision, index_revision, lag, mut candidates) = {
            let state = lock(&self.state)?;
            let status = index_status_locked(&state, Some(&request.project_id));
            let mut candidates = Vec::new();
            for ((project_id, source_version_id), indexed) in &state.indexes {
                if project_id != &request.project_id {
                    continue;
                }
                let Some(version) = state
                    .versions
                    .get(&(project_id.clone(), source_version_id.clone()))
                else {
                    continue;
                };
                if version.parser_identity.as_deref() != Some(indexed.parser_identity.as_str())
                    || version.content_digest != indexed.input_digest
                {
                    continue;
                }
                let mut matching = false;
                for (ordinal, chunk) in indexed.chunks.iter().enumerate() {
                    let score = terms
                        .iter()
                        .filter(|term| {
                            indexed
                                .postings
                                .get(*term)
                                .is_some_and(|ordinals| ordinals.contains(&ordinal))
                        })
                        .count();
                    if score > 0 {
                        matching = true;
                        candidates.push((
                            score,
                            source_version_id.clone(),
                            version.origin.clone(),
                            chunk.clone(),
                        ));
                    }
                }
                // An index is derived data. Verify the canonical blob only if
                // this version contributes a hit; unrelated damaged history
                // must not make an otherwise valid scoped query unreadable.
                if matching {
                    self.blobs
                        .read_verified(&version.content_digest, version.byte_count)?;
                }
            }
            (
                state.source_revision,
                status.index_revision,
                status.lag,
                candidates,
            )
        };

        let mut hits = Vec::new();
        candidates.sort_by(|left, right| {
            right
                .0
                .cmp(&left.0)
                .then_with(|| left.1.cmp(&right.1))
                .then_with(|| left.3.location.cmp(&right.3.location))
        });
        for (score, source_version_id, origin, chunk) in candidates {
            if hits.len() == request.limit {
                break;
            }
            let excerpt = truncate_utf8(&chunk.text, request.max_excerpt_bytes);
            if excerpt.is_empty() {
                continue;
            }
            let excerpt_digest = if excerpt.len() == chunk.text.len() {
                chunk.excerpt_digest.clone()
            } else {
                content_digest(excerpt.as_bytes())
            };
            hits.push(RetrievalHit {
                source_version_id,
                origin,
                location: chunk.location,
                excerpt_digest,
                excerpt: excerpt.to_owned(),
                score,
                layer: RetrievalLayer::RawSource,
                index_revision,
            });
        }
        Ok(RetrievalResponse {
            project_id: request.project_id.clone(),
            query: request.query.clone(),
            hits,
            source_revision,
            index_revision,
            lag,
        })
    }

    pub fn doctor(&self, project_id: Option<&str>) -> Result<DoctorReport, SourceError> {
        validate_optional_project(project_id)?;
        let versions = self.versions_for(project_id)?;
        let state = lock(&self.state)?;
        let mut findings = Vec::new();
        let mut keys = BTreeSet::new();
        for version in versions {
            let key = (
                version.project_id.clone(),
                version.source_version_id.clone(),
            );
            keys.insert(key.clone());
            let availability = match self
                .blobs
                .read_verified(&version.content_digest, version.byte_count)
            {
                Ok(_) => Availability::Available,
                Err(SourceError::MissingBlob) => Availability::Missing,
                Err(SourceError::DigestMismatch | SourceError::Storage(_)) => Availability::Corrupt,
                Err(error) => return Err(error),
            };
            if availability != Availability::Available {
                findings.push(IntegrityFinding {
                    project_id: version.project_id.clone(),
                    source_version_id: Some(version.source_version_id.clone()),
                    kind: match availability {
                        Availability::Missing => FindingKind::MissingBlob,
                        Availability::Corrupt => FindingKind::CorruptBlob,
                        Availability::Available => unreachable!(),
                    },
                    detail: format!("source blob is {availability:?}"),
                });
            }
            match state.indexes.get(&key) {
                None => {
                    let (kind, detail) = match state.parse_records.get(&key) {
                        Some(record) if record.state == ParseState::Failed => (
                            FindingKind::ParserFailed,
                            format!(
                                "{} (parser={}, input={}, chunks={}, warnings={})",
                                record
                                    .error
                                    .clone()
                                    .unwrap_or_else(|| "parser failed".to_owned()),
                                record.parser_identity,
                                record.input_digest,
                                record.chunk_count,
                                record.warnings.len()
                            ),
                        ),
                        _ => (
                            FindingKind::Unindexed,
                            "source has no current derived index".to_owned(),
                        ),
                    };
                    findings.push(IntegrityFinding {
                        project_id: version.project_id.clone(),
                        source_version_id: Some(version.source_version_id.clone()),
                        kind,
                        detail,
                    });
                }
                Some(indexed)
                    if version.parser_identity.as_deref()
                        != Some(indexed.parser_identity.as_str())
                        || version.content_digest != indexed.input_digest
                        || state.parse_records.get(&key).is_some_and(|record| {
                            record.state != ParseState::Indexed
                                || record.parser_identity != indexed.parser_identity
                                || record.input_digest != indexed.input_digest
                                || record.output_digest.as_deref()
                                    != Some(indexed.output_digest.as_str())
                        }) =>
                {
                    findings.push(IntegrityFinding {
                        project_id: version.project_id.clone(),
                        source_version_id: Some(version.source_version_id.clone()),
                        kind: FindingKind::StaleParser,
                        detail: "derived output does not match current parser or source digest"
                            .to_owned(),
                    });
                }
                Some(_) => {}
            }
        }
        for key in state.indexes.keys() {
            if project_id.is_none_or(|project| key.0 == project) && !keys.contains(key) {
                findings.push(IntegrityFinding {
                    project_id: key.0.clone(),
                    source_version_id: Some(key.1.clone()),
                    kind: FindingKind::OrphanIndex,
                    detail: "derived index has no source metadata".to_owned(),
                });
            }
        }
        findings.sort_by(|left, right| {
            left.project_id
                .cmp(&right.project_id)
                .then_with(|| left.source_version_id.cmp(&right.source_version_id))
                .then_with(|| format!("{:?}", left.kind).cmp(&format!("{:?}", right.kind)))
        });
        Ok(DoctorReport {
            project_id: project_id.map(str::to_owned),
            status: index_status_locked(&state, project_id),
            findings,
        })
    }

    /// Repair all rebuildable derived state in scope. Missing or corrupt
    /// canonical blobs are reported and left untouched; repair never invents
    /// source bytes or erases failed parse records.
    pub fn repair(&self, project_id: Option<&str>) -> Result<RepairReport, SourceError> {
        validate_optional_project(project_id)?;
        let _mutation_guard = lock(&self.mutation_lock)?;
        let _catalog_lock = self.acquire_persistent_lock()?;
        self.reload_persistent_state()?;
        self.repair_locked(project_id, false)
    }

    fn repair_locked(
        &self,
        project_id: Option<&str>,
        reset_indexes: bool,
    ) -> Result<RepairReport, SourceError> {
        let before = lock(&self.state)?.clone();
        let versions = self.versions_for(project_id)?;
        let version_keys: BTreeSet<_> = versions
            .iter()
            .map(|version| {
                (
                    version.project_id.clone(),
                    version.source_version_id.clone(),
                )
            })
            .collect();
        let mut report = RepairReport {
            project_id: project_id.map(str::to_owned),
            attempted: 0,
            repaired: 0,
            unchanged: 0,
            skipped_unavailable: 0,
            failed: 0,
            orphan_indexes_removed: 0,
            status: IndexStatus {
                source_revision: 0,
                index_revision: 0,
                lag: 0,
                indexed_versions: 0,
                failed_versions: 0,
            },
        };

        if reset_indexes {
            let mut state = lock(&self.state)?;
            let keys: Vec<_> = state
                .indexes
                .keys()
                .filter(|key| project_id.is_none_or(|project| key.0 == project))
                .cloned()
                .collect();
            if !keys.is_empty() {
                for key in keys {
                    state.indexes.remove(&key);
                }
                state.index_revision = state.index_revision.saturating_add(1);
            }
        }

        for version in versions {
            let available = match self.availability(&version) {
                Ok(availability) => availability == Availability::Available,
                Err(error) => {
                    *lock(&self.state)? = before;
                    return Err(error);
                }
            };
            if !available {
                report.skipped_unavailable += 1;
                continue;
            }
            let parser = version
                .parser_identity
                .as_deref()
                .unwrap_or(DEFAULT_PARSER_IDENTITY);
            let before_index = lock(&self.state)?.index_revision;
            let had_current = {
                let state = lock(&self.state)?;
                let key = (
                    version.project_id.clone(),
                    version.source_version_id.clone(),
                );
                state.indexes.get(&key).is_some_and(|indexed| {
                    indexed.parser_identity == parser
                        && indexed.input_digest == version.content_digest
                })
            };
            report.attempted += 1;
            let parsed = match self.parse_and_index_state_locked(
                &version,
                parser,
                ParserLimits::default(),
            ) {
                Ok(parsed) => parsed,
                Err(error) => {
                    *lock(&self.state)? = before;
                    return Err(error);
                }
            };
            if parsed.state == ParseState::Failed {
                report.failed += 1;
            } else if had_current && before_index == parsed.index_revision {
                report.unchanged += 1;
            } else {
                report.repaired += 1;
            }
        }
        let mut state = lock(&self.state)?;
        let orphans: Vec<_> = state
            .indexes
            .keys()
            .filter(|key| {
                project_id.is_none_or(|project| key.0 == project) && !version_keys.contains(*key)
            })
            .cloned()
            .collect();
        if !orphans.is_empty() {
            for key in &orphans {
                state.indexes.remove(key);
            }
            state.index_revision = state.index_revision.saturating_add(1);
            report.orphan_indexes_removed = orphans.len();
        }
        report.status = index_status_locked(&state, project_id);
        drop(state);
        if let Err(error) = self.persist_state() {
            *lock(&self.state)? = before;
            return Err(error);
        }
        Ok(report)
    }

    /// Drop and rebuild only derived index rows. Canonical source metadata,
    /// blobs, and failed parse history remain intact.
    pub fn rebuild_index(&self, project_id: Option<&str>) -> Result<RepairReport, SourceError> {
        validate_optional_project(project_id)?;
        let _mutation_guard = lock(&self.mutation_lock)?;
        let _catalog_lock = self.acquire_persistent_lock()?;
        self.reload_persistent_state()?;
        self.repair_locked(project_id, true)
    }

    pub fn list_versions(
        &self,
        project_id: Option<&str>,
    ) -> Result<Vec<SourceVersion>, SourceError> {
        self.versions_for(project_id)
    }

    /// Export one project's canonical source provenance and the exact bytes it
    /// references. Rebuildable search indexes are deliberately omitted.
    pub fn export_bundle(&self, project_id: &str) -> Result<SourceCatalogBundle, SourceError> {
        validate_project_id(project_id)?;
        let _mutation_guard = lock(&self.mutation_lock)?;
        let _catalog_lock = self.acquire_persistent_lock()?;
        self.reload_persistent_state()?;

        let state = lock(&self.state)?.clone();
        let project_state = project_state(&state, project_id);
        let mut persisted = persisted_state(&project_state);
        persisted.indexes.clear();
        for version in &mut persisted.versions {
            // Export has just verified the backing bytes, so the portable
            // snapshot records their actual restorable state.
            version.availability = Availability::Available;
        }
        let metadata = SourceBundleMetadata {
            format: SOURCE_BUNDLE_FORMAT_V1.to_owned(),
            project_id: project_id.to_owned(),
            catalog: persisted,
        };
        let metadata_bytes = serde_json::to_vec(&metadata).map_err(|error| {
            SourceError::Storage(format!(
                "source bundle metadata serialization failed: {error}"
            ))
        })?;
        if metadata_bytes.len() > MAX_SOURCE_BUNDLE_METADATA_BYTES {
            return Err(SourceError::BundleTooLarge {
                actual: metadata_bytes.len(),
                limit: MAX_SOURCE_BUNDLE_METADATA_BYTES,
            });
        }

        let mut versions = project_state.versions.values().cloned().collect::<Vec<_>>();
        versions.sort_by(|left, right| left.content_digest.cmp(&right.content_digest));
        let mut blobs = Vec::new();
        let mut seen = BTreeSet::new();
        let mut total_bytes = SOURCE_BUNDLE_MAGIC.len() + 8 + metadata_bytes.len() + 4;
        for version in versions {
            if !seen.insert(version.content_digest.clone()) {
                continue;
            }
            let bytes = self
                .blobs
                .read_verified(&version.content_digest, version.byte_count)?;
            let record_size = 2usize
                .checked_add(version.content_digest.len())
                .and_then(|size| size.checked_add(8))
                .and_then(|size| size.checked_add(bytes.len()))
                .ok_or(SourceError::BundleTooLarge {
                    actual: usize::MAX,
                    limit: MAX_SOURCE_BUNDLE_BYTES,
                })?;
            total_bytes =
                total_bytes
                    .checked_add(record_size)
                    .ok_or(SourceError::BundleTooLarge {
                        actual: usize::MAX,
                        limit: MAX_SOURCE_BUNDLE_BYTES,
                    })?;
            if total_bytes > MAX_SOURCE_BUNDLE_BYTES {
                return Err(SourceError::BundleTooLarge {
                    actual: total_bytes,
                    limit: MAX_SOURCE_BUNDLE_BYTES,
                });
            }
            blobs.push(SourceBundleBlob {
                digest: version.content_digest,
                bytes,
            });
        }
        let bytes = encode_source_bundle(&metadata_bytes, &blobs)?;
        Ok(SourceCatalogBundle {
            format: SOURCE_BUNDLE_FORMAT_V1.to_owned(),
            project_id: project_id.to_owned(),
            bytes,
        })
    }

    /// Restore a bundle into the requested project scope. Existing metadata is
    /// accepted only when it is identical; blobs are always digest-verified.
    pub fn restore_bundle(
        &self,
        bundle: &SourceCatalogBundle,
        expected_project_id: &str,
    ) -> Result<SourceBundleReadback, SourceError> {
        validate_project_id(expected_project_id)?;
        if bundle.format != SOURCE_BUNDLE_FORMAT_V1 || bundle.project_id != expected_project_id {
            return Err(SourceError::InvalidBundle(
                "bundle format or project scope does not match the request".to_owned(),
            ));
        }
        if bundle.bytes.len() > MAX_SOURCE_BUNDLE_BYTES {
            return Err(SourceError::BundleTooLarge {
                actual: bundle.bytes.len(),
                limit: MAX_SOURCE_BUNDLE_BYTES,
            });
        }
        let (metadata, blobs, total_blob_bytes) = decode_source_bundle(&bundle.bytes)?;
        if metadata.format != SOURCE_BUNDLE_FORMAT_V1
            || metadata.project_id != expected_project_id
            || !metadata.catalog.indexes.is_empty()
        {
            return Err(SourceError::InvalidBundle(
                "catalog metadata format, project scope, or derived-index policy is invalid"
                    .to_owned(),
            ));
        }
        let imported =
            restore_catalog_state(&serde_json::to_vec(&metadata.catalog).map_err(|error| {
                SourceError::InvalidBundle(format!("catalog metadata cannot be encoded: {error}"))
            })?)
            .map_err(|error| SourceError::InvalidBundle(error.to_string()))?;
        validate_bundle_project_state(&imported, expected_project_id)?;
        validate_bundle_blobs(&imported, &blobs)?;

        let _mutation_guard = lock(&self.mutation_lock)?;
        let _catalog_lock = self.acquire_persistent_lock()?;
        self.reload_persistent_state()?;
        let mut state = lock(&self.state)?;
        let existing = project_state(&state, expected_project_id);
        let imported_normalized = project_metadata_bytes(&imported, expected_project_id)?;
        if project_scope_is_populated(&existing) {
            if project_metadata_bytes(&existing, expected_project_id)? != imported_normalized {
                return Err(SourceError::BundleConflict);
            }
            drop(state);
            for blob in &blobs {
                self.blobs
                    .read_verified(&blob.digest, blob.bytes.len())
                    .map(|stored| {
                        if stored == blob.bytes {
                            Ok(())
                        } else {
                            Err(SourceError::DigestMismatch)
                        }
                    })??;
            }
            return Ok(bundle_readback(
                expected_project_id,
                &imported,
                blobs.len(),
                total_blob_bytes,
                true,
            ));
        }

        // Operation IDs are catalog-wide. Refuse to overwrite another
        // project's idempotency record even though source rows are scoped.
        if imported
            .capture_operations
            .keys()
            .any(|operation_id| state.capture_operations.contains_key(operation_id))
            || imported
                .artifact_operations
                .keys()
                .any(|operation_id| state.artifact_operations.contains_key(operation_id))
        {
            return Err(SourceError::OperationConflict);
        }
        for blob in &blobs {
            self.blobs.put(&blob.digest, &blob.bytes)?;
        }

        let before = state.clone();
        merge_project_state(&mut state, imported);
        drop(state);
        if let Err(error) = self.persist_state() {
            *lock(&self.state)? = before;
            return Err(error);
        }
        Ok(bundle_readback(
            expected_project_id,
            &restore_catalog_state(&serde_json::to_vec(&metadata.catalog).map_err(|error| {
                SourceError::InvalidBundle(format!("catalog metadata cannot be encoded: {error}"))
            })?)?,
            blobs.len(),
            total_blob_bytes,
            false,
        ))
    }

    pub fn version_count(&self) -> Result<usize, SourceError> {
        Ok(lock(&self.state)?.versions.len())
    }

    fn versions_for(&self, project_id: Option<&str>) -> Result<Vec<SourceVersion>, SourceError> {
        validate_optional_project(project_id)?;
        let state = lock(&self.state)?;
        let mut versions: Vec<_> = state
            .versions
            .values()
            .filter(|version| project_id.is_none_or(|project| version.project_id == project))
            .cloned()
            .collect();
        versions.sort_by(|left, right| {
            left.project_id
                .cmp(&right.project_id)
                .then_with(|| left.source_version_id.cmp(&right.source_version_id))
        });
        Ok(versions)
    }

    fn capture_version_locked(
        &self,
        project_id: &str,
        origin: &str,
        bytes: &[u8],
        media_type: &str,
    ) -> Result<(SourceVersion, bool), SourceError> {
        validate_project_id(project_id)?;
        validate_origin(origin)?;
        if media_type.trim().is_empty() {
            return Err(SourceError::EmptyMediaType);
        }

        let content_digest = content_digest(bytes);
        let source_version_id = format!("sv_{project_id}_{content_digest}");
        let key = (project_id.to_owned(), source_version_id.clone());
        let existing = {
            let state = lock(&self.state)?;
            state.versions.get(&key).cloned()
        };
        if let Some(existing) = existing {
            if existing.origin != origin
                || existing.media_type != media_type
                || existing.byte_count != bytes.len()
                || existing.content_digest != content_digest
            {
                return Err(SourceError::SourceMetadataConflict);
            }
            // A retried registration can repair an orphaned/missing blob from
            // the caller's exact bytes, while a digest mismatch remains an
            // explicit corruption error from the blob store.
            self.blobs.put(&content_digest, bytes)?;
            return Ok((self.current_snapshot(existing)?, false));
        }

        // The version is not made visible until the adapter has verified the
        // complete object on disk (or in the fallback memory adapter).
        self.blobs.put(&content_digest, bytes)?;
        let version = SourceVersion {
            project_id: project_id.to_owned(),
            source_version_id,
            origin: origin.to_owned(),
            media_type: media_type.to_owned(),
            byte_count: bytes.len(),
            content_digest,
            availability: Availability::Available,
            parser_identity: None,
        };
        let mut state = lock(&self.state)?;
        state.versions.insert(key, version.clone());
        state.source_revision = state.source_revision.saturating_add(1);
        Ok((version, true))
    }

    fn acquire_persistent_lock(&self) -> Result<Option<PersistentCatalogLock>, SourceError> {
        self.mutation_lock_file
            .as_deref()
            .map(PersistentCatalogLock::acquire)
            .transpose()
    }

    fn reload_persistent_state(&self) -> Result<(), SourceError> {
        let Some(path) = &self.state_file else {
            return Ok(());
        };
        if !path.exists() {
            return Ok(());
        }
        let bytes = fs::read(path).map_err(storage_error)?;
        *lock(&self.state)? = restore_catalog_state(&bytes)?;
        Ok(())
    }

    fn authorized_version(&self, version: &SourceVersion) -> Result<SourceVersion, SourceError> {
        validate_project_id(&version.project_id)?;
        let key = (
            version.project_id.clone(),
            version.source_version_id.clone(),
        );
        let state = lock(&self.state)?;
        let stored = state
            .versions
            .get(&key)
            .ok_or(SourceError::ScopeViolation)?;
        if version.project_id != stored.project_id
            || version.source_version_id != stored.source_version_id
        {
            return Err(SourceError::ScopeViolation);
        }
        if version.origin != stored.origin
            || version.media_type != stored.media_type
            || version.byte_count != stored.byte_count
            || version.content_digest != stored.content_digest
        {
            return Err(SourceError::DigestMismatch);
        }
        Ok(stored.clone())
    }

    fn current_snapshot(&self, mut version: SourceVersion) -> Result<SourceVersion, SourceError> {
        version.availability = self.availability(&version)?;
        Ok(version)
    }

    fn persist_state(&self) -> Result<(), SourceError> {
        let Some(path) = &self.state_file else {
            return Ok(());
        };
        let state = lock(&self.state)?.clone();
        let persisted = persisted_state(&state);
        let bytes = serde_json::to_vec(&persisted).map_err(|error| {
            SourceError::Storage(format!("catalog serialization failed: {error}"))
        })?;
        let parent = path
            .parent()
            .ok_or_else(|| SourceError::Storage("catalog path has no parent".to_owned()))?;
        if parent.exists() {
            reject_symlink(parent)?;
        } else {
            fs::create_dir_all(parent).map_err(storage_error)?;
        }
        if path.exists() {
            reject_symlink(path)?;
        }
        let counter = TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
        let temp = parent.join(format!(".catalog.{}.{}.tmp", std::process::id(), counter));
        let result = (|| {
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temp)
                .map_err(storage_error)?;
            file.write_all(&bytes).map_err(storage_error)?;
            file.flush().map_err(storage_error)?;
            file.sync_all().map_err(storage_error)?;
            fs::rename(&temp, path).map_err(storage_error)?;
            sync_directory(parent)
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temp);
        }
        result
    }

    fn validate_citation_bounds(&self, location: &str, excerpt: &[u8]) -> Result<(), SourceError> {
        if location.trim().is_empty() || location.as_bytes().contains(&0) || excerpt.is_empty() {
            return Err(SourceError::InvalidCitation);
        }
        if location.len() > self.citation_limits.max_location_bytes
            || excerpt.len() > self.citation_limits.max_excerpt_bytes
        {
            return Err(SourceError::CitationTooLarge);
        }
        Ok(())
    }
}

fn lock<T>(mutex: &Mutex<T>) -> Result<MutexGuard<'_, T>, SourceError> {
    mutex
        .lock()
        .map_err(|_| SourceError::Storage("mutex was poisoned".to_owned()))
}

struct PersistentCatalogLock {
    path: PathBuf,
    owner: String,
    _file: File,
}

impl PersistentCatalogLock {
    fn acquire(path: &Path) -> Result<Self, SourceError> {
        reject_symlink(path)?;
        let deadline = Instant::now() + CATALOG_LOCK_WAIT;
        let owner = format!("pid={}\ntoken={}\n", std::process::id(), unique_stamp());
        let mut file = None;
        while Instant::now() < deadline {
            match OpenOptions::new().write(true).create_new(true).open(path) {
                Ok(value) => {
                    file = Some(value);
                    break;
                }
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                    // A lock is recoverable only when its owner PID is
                    // definitively gone. Unknown or permission-denied owner
                    // state stays busy; no live lock is force-broken.
                    if try_reap_dead_catalog_lock(path) {
                        continue;
                    }
                    std::thread::sleep(Duration::from_millis(2));
                }
                Err(error) => return Err(storage_error(error)),
            }
        }
        let mut file = file.ok_or_else(|| {
            SourceError::Storage("source catalog lock is busy; retry after the owner exits".into())
        })?;
        lock_file_exclusive(&file).map_err(storage_error)?;
        if let Err(error) = file
            .write_all(owner.as_bytes())
            .and_then(|_| file.sync_all())
        {
            remove_owned_catalog_lock(path, &owner);
            return Err(storage_error(error));
        }
        Ok(Self {
            path: path.to_path_buf(),
            owner,
            _file: file,
        })
    }
}

impl Drop for PersistentCatalogLock {
    fn drop(&mut self) {
        remove_owned_catalog_lock(&self.path, &self.owner);
    }
}

#[cfg(test)]
fn catalog_lock_owner_is_definitely_dead(path: &Path) -> bool {
    let Ok(contents) = fs::read_to_string(path) else {
        return false;
    };
    catalog_lock_owner_contents_is_definitely_dead(&contents)
}

fn catalog_lock_owner_contents_is_definitely_dead(contents: &str) -> bool {
    let mut pid = None;
    let mut token = None;
    for line in contents.lines() {
        let Some((key, value)) = line.split_once('=') else {
            return false;
        };
        match key {
            "pid" if pid.is_none() => {
                let Ok(value) = value.parse::<u32>() else {
                    return false;
                };
                pid = Some(value);
            }
            "token" if token.is_none() && !value.is_empty() => token = Some(value),
            _ => return false,
        }
    }
    match (pid, token) {
        (Some(pid), Some(_)) => process_is_definitely_dead(pid),
        _ => false,
    }
}

/// Reap a stale lock only after taking an advisory lock on the exact inode
/// that was inspected. Writers hold this advisory lock until their catalog
/// mutation ends, so a compliant reaper cannot unlink a replacement lock.
fn try_reap_dead_catalog_lock(path: &Path) -> bool {
    let mut file = match OpenOptions::new().read(true).write(true).open(path) {
        Ok(file) => file,
        Err(_) => return false,
    };
    match try_lock_file_exclusive(&file) {
        Ok(true) => {}
        Ok(false) | Err(_) => return false,
    }
    let mut contents = String::new();
    if file.read_to_string(&mut contents).is_err()
        || !catalog_lock_owner_contents_is_definitely_dead(&contents)
    {
        return false;
    }
    fs::remove_file(path).is_ok()
}

#[cfg(unix)]
unsafe extern "C" {
    fn flock(file_descriptor: i32, operation: i32) -> i32;
}

#[cfg(unix)]
fn lock_file_exclusive(file: &File) -> io::Result<()> {
    const LOCK_EX: i32 = 2;
    let result = unsafe { flock(file.as_raw_fd(), LOCK_EX) };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(not(unix))]
fn lock_file_exclusive(_file: &File) -> io::Result<()> {
    Ok(())
}

#[cfg(unix)]
fn try_lock_file_exclusive(file: &File) -> io::Result<bool> {
    const LOCK_EX: i32 = 2;
    const LOCK_NB: i32 = 4;
    let result = unsafe { flock(file.as_raw_fd(), LOCK_EX | LOCK_NB) };
    if result == 0 {
        return Ok(true);
    }
    match io::Error::last_os_error().raw_os_error() {
        Some(11) | Some(35) => Ok(false),
        _ => Err(io::Error::last_os_error()),
    }
}

#[cfg(not(unix))]
fn try_lock_file_exclusive(_file: &File) -> io::Result<bool> {
    Ok(true)
}

fn remove_owned_catalog_lock(path: &Path, expected: &str) {
    if fs::read_to_string(path).ok().as_deref() == Some(expected) {
        let _ = fs::remove_file(path);
    }
}

#[cfg(unix)]
fn process_is_definitely_dead(pid: u32) -> bool {
    unsafe extern "C" {
        fn kill(pid: i32, signal: i32) -> i32;
    }
    if pid == 0 || pid > i32::MAX as u32 {
        return false;
    }
    if unsafe { kill(pid as i32, 0) } == 0 {
        return false;
    }
    std::io::Error::last_os_error().raw_os_error() == Some(3)
}

#[cfg(not(unix))]
fn process_is_definitely_dead(_pid: u32) -> bool {
    false
}

fn unique_stamp() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}

fn project_state(state: &CatalogState, project_id: &str) -> CatalogState {
    let mut project = CatalogState {
        versions: state.versions.clone(),
        artifact_relationships: state.artifact_relationships.clone(),
        parse_records: state.parse_records.clone(),
        indexes: state.indexes.clone(),
        capture_operations: state.capture_operations.clone(),
        artifact_operations: state.artifact_operations.clone(),
        source_revision: state.source_revision,
        index_revision: state.index_revision,
        artifact_revision: state.artifact_revision,
    };
    project.versions.retain(|(owner, _), _| owner == project_id);
    project
        .artifact_relationships
        .retain(|(owner, _), _| owner == project_id);
    project
        .parse_records
        .retain(|(owner, _), _| owner == project_id);
    project.indexes.retain(|(owner, _), _| owner == project_id);
    project
        .capture_operations
        .retain(|_, record| record.project_id == project_id);
    project
        .artifact_operations
        .retain(|_, record| record.project_id == project_id);
    project
}

fn project_scope_is_populated(state: &CatalogState) -> bool {
    !state.versions.is_empty()
        || !state.artifact_relationships.is_empty()
        || !state.parse_records.is_empty()
        || !state.indexes.is_empty()
        || !state.capture_operations.is_empty()
        || !state.artifact_operations.is_empty()
}

fn project_metadata_bytes(state: &CatalogState, project_id: &str) -> Result<Vec<u8>, SourceError> {
    let mut persisted = persisted_state(&project_state(state, project_id));
    persisted.indexes.clear();
    persisted.source_revision = 0;
    persisted.index_revision = 0;
    persisted.artifact_revision = 0;
    for version in &mut persisted.versions {
        version.availability = Availability::Available;
    }
    serde_json::to_vec(&persisted)
        .map_err(|error| SourceError::Storage(format!("catalog serialization failed: {error}")))
}

fn merge_project_state(target: &mut CatalogState, imported: CatalogState) {
    target.versions.extend(imported.versions);
    target
        .artifact_relationships
        .extend(imported.artifact_relationships);
    target.parse_records.extend(imported.parse_records);
    target.indexes.extend(imported.indexes);
    target
        .capture_operations
        .extend(imported.capture_operations);
    target
        .artifact_operations
        .extend(imported.artifact_operations);
    target.source_revision = target.source_revision.max(imported.source_revision);
    target.index_revision = target.index_revision.max(imported.index_revision);
    target.artifact_revision = target.artifact_revision.max(imported.artifact_revision);
}

fn validate_bundle_project_state(
    state: &CatalogState,
    project_id: &str,
) -> Result<(), SourceError> {
    if state.versions.values().any(|version| {
        version.project_id != project_id
            || validate_project_id(&version.project_id).is_err()
            || validate_origin(&version.origin).is_err()
            || version.media_type.trim().is_empty()
            || digest_hex(&version.content_digest).is_none()
            || version.source_version_id
                != format!("sv_{}_{}", version.project_id, version.content_digest)
    }) || state
        .artifact_relationships
        .values()
        .any(|relationship| relationship.source.project_id != project_id)
        || state
            .parse_records
            .keys()
            .any(|(owner, _)| owner != project_id)
        || state.indexes.keys().any(|(owner, _)| owner != project_id)
        || state
            .capture_operations
            .values()
            .any(|record| record.project_id != project_id)
        || state
            .artifact_operations
            .values()
            .any(|record| record.project_id != project_id)
    {
        return Err(SourceError::InvalidBundle(
            "catalog contains an invalid or cross-project identity".to_owned(),
        ));
    }
    Ok(())
}

fn validate_bundle_blobs(
    state: &CatalogState,
    blobs: &[SourceBundleBlob],
) -> Result<(), SourceError> {
    let expected = state
        .versions
        .values()
        .map(|version| (version.content_digest.clone(), version.byte_count))
        .collect::<BTreeMap<_, _>>();
    if expected.len() != blobs.len() {
        return Err(SourceError::InvalidBundle(
            "blob set does not match the catalog source versions".to_owned(),
        ));
    }
    for blob in blobs {
        if expected.get(&blob.digest) != Some(&blob.bytes.len())
            || content_digest(&blob.bytes) != blob.digest
        {
            return Err(SourceError::InvalidBundle(
                "blob digest or declared size does not match catalog metadata".to_owned(),
            ));
        }
    }
    Ok(())
}

fn bundle_readback(
    project_id: &str,
    state: &CatalogState,
    blobs: usize,
    bytes: usize,
    duplicate: bool,
) -> SourceBundleReadback {
    SourceBundleReadback {
        format: SOURCE_BUNDLE_FORMAT_V1.to_owned(),
        project_id: project_id.to_owned(),
        source_versions: state.versions.len(),
        artifact_relationships: state.artifact_relationships.len(),
        capture_operations: state.capture_operations.len(),
        artifact_operations: state.artifact_operations.len(),
        blobs,
        bytes,
        duplicate,
    }
}

fn encode_source_bundle(
    metadata: &[u8],
    blobs: &[SourceBundleBlob],
) -> Result<Vec<u8>, SourceError> {
    if metadata.len() > MAX_SOURCE_BUNDLE_METADATA_BYTES || blobs.len() > u32::MAX as usize {
        return Err(SourceError::BundleTooLarge {
            actual: metadata.len(),
            limit: MAX_SOURCE_BUNDLE_METADATA_BYTES,
        });
    }
    let mut output = Vec::new();
    output.extend_from_slice(SOURCE_BUNDLE_MAGIC);
    output.extend_from_slice(&(metadata.len() as u64).to_be_bytes());
    output.extend_from_slice(metadata);
    output.extend_from_slice(content_digest(metadata).as_bytes());
    output.extend_from_slice(&(blobs.len() as u32).to_be_bytes());
    for blob in blobs {
        if blob.digest.len() > u16::MAX as usize {
            return Err(SourceError::InvalidBundle(
                "digest field is too long".to_owned(),
            ));
        }
        output.extend_from_slice(&(blob.digest.len() as u16).to_be_bytes());
        output.extend_from_slice(blob.digest.as_bytes());
        output.extend_from_slice(&(blob.bytes.len() as u64).to_be_bytes());
        output.extend_from_slice(&blob.bytes);
        if output.len() > MAX_SOURCE_BUNDLE_BYTES {
            return Err(SourceError::BundleTooLarge {
                actual: output.len(),
                limit: MAX_SOURCE_BUNDLE_BYTES,
            });
        }
    }
    Ok(output)
}

fn decode_source_bundle(
    bytes: &[u8],
) -> Result<(SourceBundleMetadata, Vec<SourceBundleBlob>, usize), SourceError> {
    if bytes.len() > MAX_SOURCE_BUNDLE_BYTES {
        return Err(SourceError::BundleTooLarge {
            actual: bytes.len(),
            limit: MAX_SOURCE_BUNDLE_BYTES,
        });
    }
    let mut cursor = 0usize;
    if take_bundle_bytes(bytes, &mut cursor, SOURCE_BUNDLE_MAGIC.len())? != SOURCE_BUNDLE_MAGIC {
        return Err(SourceError::InvalidBundle(
            "unknown bundle signature".to_owned(),
        ));
    }
    let metadata_len = take_bundle_u64(bytes, &mut cursor)?;
    let metadata_len = usize::try_from(metadata_len).map_err(|_| {
        SourceError::InvalidBundle("metadata length overflows this platform".into())
    })?;
    if metadata_len > MAX_SOURCE_BUNDLE_METADATA_BYTES {
        return Err(SourceError::BundleTooLarge {
            actual: metadata_len,
            limit: MAX_SOURCE_BUNDLE_METADATA_BYTES,
        });
    }
    let metadata_bytes = take_bundle_bytes(bytes, &mut cursor, metadata_len)?;
    let metadata_digest = take_bundle_bytes(bytes, &mut cursor, "sha256:".len() + 64)?;
    if metadata_digest != content_digest(metadata_bytes).as_bytes() {
        return Err(SourceError::InvalidBundle(
            "catalog metadata checksum failed".to_owned(),
        ));
    }
    let metadata: SourceBundleMetadata =
        serde_json::from_slice(metadata_bytes).map_err(|error| {
            SourceError::InvalidBundle(format!("catalog metadata is invalid: {error}"))
        })?;
    let count = take_bundle_u32(bytes, &mut cursor)? as usize;
    if count > 1_000_000 {
        return Err(SourceError::InvalidBundle(
            "blob count exceeds the supported limit".into(),
        ));
    }
    let mut blobs = Vec::with_capacity(count);
    let mut last_digest = None::<String>;
    let mut total_blob_bytes = 0usize;
    for _ in 0..count {
        let digest_len = take_bundle_u16(bytes, &mut cursor)? as usize;
        let digest = std::str::from_utf8(take_bundle_bytes(bytes, &mut cursor, digest_len)?)
            .map_err(|_| SourceError::InvalidBundle("blob digest is not UTF-8".into()))?
            .to_owned();
        if digest_hex(&digest).is_none() || last_digest.as_ref().is_some_and(|last| last >= &digest)
        {
            return Err(SourceError::InvalidBundle(
                "blob digests are invalid, duplicated, or not sorted".to_owned(),
            ));
        }
        let length = take_bundle_u64(bytes, &mut cursor)?;
        let length = usize::try_from(length).map_err(|_| {
            SourceError::InvalidBundle("blob length overflows this platform".into())
        })?;
        let blob_bytes = take_bundle_bytes(bytes, &mut cursor, length)?.to_vec();
        total_blob_bytes = total_blob_bytes.checked_add(length).ok_or_else(|| {
            SourceError::InvalidBundle("total blob length overflows this platform".into())
        })?;
        if content_digest(&blob_bytes) != digest {
            return Err(SourceError::InvalidBundle(
                "blob checksum failed".to_owned(),
            ));
        }
        last_digest = Some(digest.clone());
        blobs.push(SourceBundleBlob {
            digest,
            bytes: blob_bytes,
        });
    }
    if cursor != bytes.len() {
        return Err(SourceError::InvalidBundle(
            "bundle contains trailing bytes".to_owned(),
        ));
    }
    Ok((metadata, blobs, total_blob_bytes))
}

fn take_bundle_bytes<'a>(
    bytes: &'a [u8],
    cursor: &mut usize,
    count: usize,
) -> Result<&'a [u8], SourceError> {
    let end = cursor
        .checked_add(count)
        .ok_or_else(|| SourceError::InvalidBundle("bundle offset overflow".into()))?;
    let value = bytes
        .get(*cursor..end)
        .ok_or_else(|| SourceError::InvalidBundle("bundle is truncated".into()))?;
    *cursor = end;
    Ok(value)
}

fn take_bundle_u16(bytes: &[u8], cursor: &mut usize) -> Result<u16, SourceError> {
    Ok(u16::from_be_bytes(
        take_bundle_bytes(bytes, cursor, 2)?
            .try_into()
            .expect("fixed-width bundle read"),
    ))
}

fn take_bundle_u32(bytes: &[u8], cursor: &mut usize) -> Result<u32, SourceError> {
    Ok(u32::from_be_bytes(
        take_bundle_bytes(bytes, cursor, 4)?
            .try_into()
            .expect("fixed-width bundle read"),
    ))
}

fn take_bundle_u64(bytes: &[u8], cursor: &mut usize) -> Result<u64, SourceError> {
    Ok(u64::from_be_bytes(
        take_bundle_bytes(bytes, cursor, 8)?
            .try_into()
            .expect("fixed-width bundle read"),
    ))
}

fn persisted_state(state: &CatalogState) -> PersistedCatalogState {
    let mut versions = state.versions.values().cloned().collect::<Vec<_>>();
    versions.sort_by(|left, right| {
        left.project_id
            .cmp(&right.project_id)
            .then_with(|| left.source_version_id.cmp(&right.source_version_id))
    });
    let mut parse_records = state
        .parse_records
        .iter()
        .map(
            |((project_id, source_version_id), record)| PersistedParseRecord {
                project_id: project_id.clone(),
                source_version_id: source_version_id.clone(),
                record: record.clone(),
            },
        )
        .collect::<Vec<_>>();
    parse_records.sort_by(|left, right| {
        left.project_id
            .cmp(&right.project_id)
            .then_with(|| left.source_version_id.cmp(&right.source_version_id))
    });
    let mut indexes = state
        .indexes
        .iter()
        .map(
            |((project_id, source_version_id), indexed)| PersistedIndexedSource {
                project_id: project_id.clone(),
                source_version_id: source_version_id.clone(),
                indexed: indexed.clone(),
            },
        )
        .collect::<Vec<_>>();
    indexes.sort_by(|left, right| {
        left.project_id
            .cmp(&right.project_id)
            .then_with(|| left.source_version_id.cmp(&right.source_version_id))
    });
    let mut artifact_relationships = state
        .artifact_relationships
        .values()
        .cloned()
        .collect::<Vec<_>>();
    artifact_relationships.sort_by(|left, right| {
        left.source
            .project_id
            .cmp(&right.source.project_id)
            .then_with(|| left.relationship_id.cmp(&right.relationship_id))
    });
    PersistedCatalogState {
        versions,
        artifact_relationships,
        parse_records,
        indexes,
        capture_operations: {
            let mut operations = state
                .capture_operations
                .iter()
                .map(|(operation_id, record)| PersistedCaptureOperation {
                    operation_id: operation_id.clone(),
                    record: record.clone(),
                })
                .collect::<Vec<_>>();
            operations.sort_by(|left, right| left.operation_id.cmp(&right.operation_id));
            operations
        },
        artifact_operations: {
            let mut operations = state
                .artifact_operations
                .iter()
                .map(|(operation_id, record)| PersistedArtifactOperation {
                    operation_id: operation_id.clone(),
                    record: record.clone(),
                })
                .collect::<Vec<_>>();
            operations.sort_by(|left, right| left.operation_id.cmp(&right.operation_id));
            operations
        },
        source_revision: state.source_revision,
        index_revision: state.index_revision,
        artifact_revision: state.artifact_revision,
    }
}

fn restore_catalog_state(bytes: &[u8]) -> Result<CatalogState, SourceError> {
    let persisted: PersistedCatalogState = serde_json::from_slice(bytes)
        .map_err(|error| SourceError::Storage(format!("catalog metadata is invalid: {error}")))?;
    if persisted.artifact_relationships.len() > MAX_ARTIFACT_RELATIONSHIPS {
        return Err(SourceError::Storage(
            "catalog metadata exceeds the artifact relationship limit".to_owned(),
        ));
    }
    let mut state = CatalogState {
        versions: HashMap::new(),
        artifact_relationships: HashMap::new(),
        parse_records: HashMap::new(),
        indexes: HashMap::new(),
        capture_operations: HashMap::new(),
        artifact_operations: HashMap::new(),
        source_revision: persisted.source_revision,
        index_revision: persisted.index_revision,
        artifact_revision: persisted.artifact_revision,
    };
    for version in persisted.versions {
        let key = (
            version.project_id.clone(),
            version.source_version_id.clone(),
        );
        if state.versions.insert(key, version).is_some() {
            return Err(SourceError::Storage(
                "catalog metadata contains duplicate source versions".to_owned(),
            ));
        }
    }
    for relationship in persisted.artifact_relationships {
        let input = relationship_input(&relationship);
        validate_artifact_relationship(&input).map_err(|_| {
            SourceError::Storage("catalog metadata has an invalid artifact relationship".to_owned())
        })?;
        let source = state
            .versions
            .get(&(
                relationship.source.project_id.clone(),
                relationship.source.source_version_id.clone(),
            ))
            .ok_or_else(|| {
                SourceError::Storage(
                    "artifact relationship references a missing source version".to_owned(),
                )
            })?;
        if source.content_digest != relationship.source.content_digest
            || relationship.artifact_revision == 0
            || relationship.artifact_revision > state.artifact_revision
        {
            return Err(SourceError::Storage(
                "artifact relationship identity or revision is inconsistent".to_owned(),
            ));
        }
        let key = (
            relationship.source.project_id.clone(),
            relationship.relationship_id.clone(),
        );
        if state
            .artifact_relationships
            .insert(key, relationship)
            .is_some()
        {
            return Err(SourceError::Storage(
                "catalog metadata contains duplicate artifact relationships".to_owned(),
            ));
        }
    }
    for entry in persisted.parse_records {
        let key = (entry.project_id, entry.source_version_id);
        if state.parse_records.insert(key, entry.record).is_some() {
            return Err(SourceError::Storage(
                "catalog metadata contains duplicate parse records".to_owned(),
            ));
        }
    }
    for entry in persisted.indexes {
        let key = (entry.project_id, entry.source_version_id);
        if state.indexes.insert(key, entry.indexed).is_some() {
            return Err(SourceError::Storage(
                "catalog metadata contains duplicate indexes".to_owned(),
            ));
        }
    }
    for entry in persisted.capture_operations {
        if state
            .capture_operations
            .insert(entry.operation_id, entry.record)
            .is_some()
        {
            return Err(SourceError::Storage(
                "catalog metadata contains duplicate capture operations".to_owned(),
            ));
        }
    }
    for entry in persisted.artifact_operations {
        let relationship = state
            .artifact_relationships
            .get(&(
                entry.record.project_id.clone(),
                entry.record.relationship_id.clone(),
            ))
            .ok_or_else(|| {
                SourceError::Storage(
                    "artifact operation references a missing relationship".to_owned(),
                )
            })?;
        let input = relationship_input(relationship);
        if relationship.operation_id != entry.operation_id
            || artifact_relationship_digest(&input)? != entry.record.request_digest
        {
            return Err(SourceError::Storage(
                "artifact operation identity does not match its relationship".to_owned(),
            ));
        }
        if state
            .artifact_operations
            .insert(entry.operation_id, entry.record)
            .is_some()
        {
            return Err(SourceError::Storage(
                "catalog metadata contains duplicate artifact operations".to_owned(),
            ));
        }
    }
    Ok(state)
}

fn relationship_input(relationship: &ArtifactRelationship) -> ArtifactRelationshipInput {
    ArtifactRelationshipInput {
        relationship_id: relationship.relationship_id.clone(),
        source: relationship.source.clone(),
        role: relationship.role,
        scope: relationship.scope,
        requirement_key: relationship.requirement_key.clone(),
        produced_by: relationship.produced_by.clone(),
        rights: relationship.rights.clone(),
        operation_id: relationship.operation_id.clone(),
    }
}

fn validate_optional_project(project_id: Option<&str>) -> Result<(), SourceError> {
    if let Some(project_id) = project_id {
        validate_project_id(project_id)?;
    }
    Ok(())
}

fn validate_operation_id(operation_id: &str) -> Result<(), SourceError> {
    if operation_id.trim().is_empty() || operation_id.as_bytes().contains(&0) {
        return Err(SourceError::EmptyOperation);
    }
    Ok(())
}

fn artifact_relationship_digest(input: &ArtifactRelationshipInput) -> Result<String, SourceError> {
    let bytes = serde_json::to_vec(input).map_err(|error| {
        SourceError::Storage(format!("artifact metadata encoding failed: {error}"))
    })?;
    Ok(content_digest(&bytes))
}

fn validate_artifact_relationship(input: &ArtifactRelationshipInput) -> Result<(), SourceError> {
    validate_project_id(&input.source.project_id)?;
    if !valid_artifact_segment(&input.source.source_version_id)
        || digest_hex(&input.source.content_digest).is_none()
        || !valid_artifact_key(&input.relationship_id)
        || input
            .requirement_key
            .as_deref()
            .is_some_and(|key| !valid_artifact_key(key))
    {
        return Err(SourceError::InvalidArtifactRelationship);
    }
    validate_operation_id(&input.operation_id)?;
    match (input.role, input.produced_by.as_ref()) {
        (
            ArtifactRole::ProducedDeliverable
            | ArtifactRole::ValidationEvidence
            | ArtifactRole::AcceptedSubmission
            | ArtifactRole::HandoffSummary,
            None,
        ) => return Err(SourceError::InvalidArtifactRelationship),
        (_, Some(producer))
            if !valid_provenance_id(&producer.work_id)
                || !valid_provenance_id(&producer.attempt_id)
                || !valid_provenance_id(&producer.result_id) =>
        {
            return Err(SourceError::InvalidArtifactRelationship)
        }
        _ => {}
    }
    for value in [
        input.rights.attribution.as_deref(),
        input.rights.rights_statement.as_deref(),
        input.rights.license.as_deref(),
    ]
    .into_iter()
    .flatten()
    {
        if value.len() > MAX_ARTIFACT_PROVENANCE_FIELD_BYTES || value.as_bytes().contains(&0) {
            return Err(SourceError::InvalidArtifactRelationship);
        }
    }
    Ok(())
}

/// Producer IDs are opaque application identities. They are bounded and
/// NUL-free but are never used as paths or filesystem components.
fn valid_provenance_id(value: &str) -> bool {
    !value.trim().is_empty()
        && value.len() <= MAX_ARTIFACT_PROVENANCE_FIELD_BYTES
        && !value.as_bytes().contains(&0)
}

fn valid_artifact_segment(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value != "."
        && value != ".."
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.' | b':'))
}

fn valid_artifact_key(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'_' | b'-' | b'.')
        })
        && value.as_bytes()[0].is_ascii_lowercase()
}

fn validate_relative_materialization_path(path: &Path) -> Result<(), SourceError> {
    if path.as_os_str().is_empty()
        || path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(SourceError::InvalidMaterializationPath);
    }
    Ok(())
}

fn checked_materialization_root(root: &Path) -> Result<PathBuf, SourceError> {
    let metadata = fs::symlink_metadata(root).map_err(storage_error)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(SourceError::InvalidMaterializationPath);
    }
    fs::canonicalize(root).map_err(storage_error)
}

fn ensure_materialization_parent(root: &Path, relative: &Path) -> Result<PathBuf, SourceError> {
    let components = relative.components().collect::<Vec<_>>();
    let (filename, parents) = components
        .split_last()
        .ok_or(SourceError::InvalidMaterializationPath)?;
    let mut current = root.to_path_buf();
    for component in parents {
        let Component::Normal(name) = component else {
            return Err(SourceError::InvalidMaterializationPath);
        };
        current.push(name);
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
                return Err(SourceError::InvalidMaterializationPath)
            }
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                fs::create_dir(&current).map_err(storage_error)?;
            }
            Err(error) => return Err(storage_error(error)),
        }
        if fs::canonicalize(&current)
            .map_err(storage_error)?
            .strip_prefix(root)
            .is_err()
        {
            return Err(SourceError::InvalidMaterializationPath);
        }
    }
    let Component::Normal(filename) = filename else {
        return Err(SourceError::InvalidMaterializationPath);
    };
    current.push(filename);
    Ok(current)
}

fn capture_request_digest(request: &SourceCaptureRequest) -> String {
    let mut canonical = Vec::new();
    for field in [
        request.project_id.as_str(),
        request.origin.as_str(),
        request.media_type.as_str(),
        &content_digest(&request.bytes),
    ] {
        canonical.extend_from_slice(field.len().to_string().as_bytes());
        canonical.push(b':');
        canonical.extend_from_slice(field.as_bytes());
        canonical.push(0);
    }
    content_digest(&canonical)
}

fn parse_bytes(
    bytes: &[u8],
    _media_type: &str,
    limits: ParserLimits,
) -> Result<ParsedIndex, String> {
    if bytes.len() > limits.max_source_bytes {
        return Err(format!(
            "source exceeds parser byte bound ({}/{} bytes)",
            bytes.len(),
            limits.max_source_bytes
        ));
    }
    let text = std::str::from_utf8(bytes).map_err(|_| "source is not valid UTF-8".to_owned())?;
    let mut chunks = Vec::new();
    let mut postings: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    let mut warnings = Vec::new();
    for (line_index, segment) in text.split_inclusive('\n').enumerate() {
        let line_number = line_index + 1;
        let line = segment.trim_end_matches(['\n', '\r']);
        if line.trim().is_empty() {
            continue;
        }
        if line.len() > limits.max_chunk_bytes {
            return Err(format!(
                "line {line_number} exceeds parser chunk bound ({}/{} bytes)",
                line.len(),
                limits.max_chunk_bytes
            ));
        }
        if chunks.len() == limits.max_chunks {
            return Err(format!(
                "source exceeds parser chunk bound ({}/{})",
                chunks.len() + 1,
                limits.max_chunks
            ));
        }
        let chunk = IndexedChunk {
            location: format!("line:{line_number}"),
            text: line.to_owned(),
            excerpt_digest: content_digest(line.as_bytes()),
        };
        let ordinal = chunks.len();
        for term in normalized_terms(line) {
            postings.entry(term).or_default().push(ordinal);
        }
        chunks.push(chunk);
    }
    if chunks.is_empty() {
        warnings.push(ParseWarning {
            code: "empty_text".to_owned(),
            message: "source contains no non-empty text lines".to_owned(),
        });
    }
    let mut canonical = Vec::new();
    for chunk in &chunks {
        canonical.extend_from_slice(chunk.location.as_bytes());
        canonical.push(0);
        canonical.extend_from_slice(chunk.text.as_bytes());
        canonical.push(0);
    }
    Ok(ParsedIndex {
        output_digest: content_digest(&canonical),
        chunks,
        postings,
        warnings,
    })
}

fn normalized_terms(text: &str) -> Vec<String> {
    let mut terms = BTreeSet::new();
    let mut current = String::new();
    for character in text.chars() {
        if character.is_alphanumeric() || character == '_' {
            for lower in character.to_lowercase() {
                current.push(lower);
            }
        } else if !current.is_empty() {
            terms.insert(std::mem::take(&mut current));
        }
    }
    if !current.is_empty() {
        terms.insert(current);
    }
    terms.into_iter().collect()
}

fn truncate_utf8(text: &str, max_bytes: usize) -> &str {
    if text.len() <= max_bytes {
        return text;
    }
    let mut end = max_bytes;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

fn index_status_locked(state: &CatalogState, project_id: Option<&str>) -> IndexStatus {
    let mut indexed_versions = 0;
    let mut failed_versions = 0;
    let mut lag = 0;
    for (key, version) in &state.versions {
        if project_id.is_some_and(|project| key.0 != project) {
            continue;
        }
        let current = state.indexes.get(key).is_some_and(|indexed| {
            version.parser_identity.as_deref() == Some(indexed.parser_identity.as_str())
                && version.content_digest == indexed.input_digest
        });
        if current {
            indexed_versions += 1;
        } else {
            lag += 1;
        }
        if state
            .parse_records
            .get(key)
            .is_some_and(|record| record.state == ParseState::Failed)
        {
            failed_versions += 1;
        }
    }
    IndexStatus {
        source_revision: state.source_revision,
        index_revision: state.index_revision,
        lag,
        indexed_versions,
        failed_versions,
    }
}

fn storage_error(error: io::Error) -> SourceError {
    SourceError::Storage(error.to_string())
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> Result<(), SourceError> {
    OpenOptions::new()
        .read(true)
        .open(path)
        .map_err(storage_error)?
        .sync_all()
        .map_err(storage_error)
}

#[cfg(not(unix))]
fn sync_directory(_path: &Path) -> Result<(), SourceError> {
    // Windows does not provide the same directory fsync contract through the
    // standard library. The file itself is flushed and atomically renamed;
    // callers still receive explicit errors from either operation.
    Ok(())
}

fn reject_symlink(path: &Path) -> Result<(), SourceError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => Err(SourceError::ScopeViolation),
        Ok(_) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(storage_error(error)),
    }
}

fn validate_project_id(project_id: &str) -> Result<(), SourceError> {
    if project_id.is_empty() {
        return Err(SourceError::EmptyOrigin);
    }
    if project_id.as_bytes().contains(&0)
        || project_id.contains('/')
        || project_id.contains('\\')
        || project_id == "."
        || project_id == ".."
    {
        return Err(SourceError::ScopeViolation);
    }
    Ok(())
}

fn validate_origin(origin: &str) -> Result<(), SourceError> {
    if origin.is_empty() {
        return Err(SourceError::EmptyOrigin);
    }
    if origin.as_bytes().contains(&0) || origin.contains('\\') {
        return Err(SourceError::ScopeViolation);
    }
    for component in Path::new(origin).components() {
        if matches!(
            component,
            Component::Prefix(_) | Component::RootDir | Component::ParentDir
        ) {
            return Err(SourceError::ScopeViolation);
        }
    }
    Ok(())
}

fn verify_input(expected_digest: &str, bytes: &[u8]) -> Result<(), SourceError> {
    if digest_hex(expected_digest).is_none() {
        return Err(SourceError::DigestMismatch);
    }
    verify_bytes(expected_digest, bytes.len(), bytes)
}

fn verify_bytes(
    expected_digest: &str,
    expected_size: usize,
    bytes: &[u8],
) -> Result<(), SourceError> {
    if bytes.len() != expected_size || content_digest(bytes) != expected_digest {
        return Err(SourceError::DigestMismatch);
    }
    Ok(())
}

fn verify_file(
    path: &Path,
    expected_digest: &str,
    expected_size: usize,
) -> Result<(), SourceError> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Err(SourceError::MissingBlob)
        }
        Err(error) => return Err(storage_error(error)),
    };
    verify_bytes(expected_digest, expected_size, &bytes)
}

fn digest_hex(digest: &str) -> Option<&str> {
    let hex = digest.strip_prefix("sha256:")?;
    (hex.len() == 64 && hex.bytes().all(|byte| byte.is_ascii_hexdigit())).then_some(hex)
}

fn contains_subslice(haystack: &[u8], needle: &[u8]) -> bool {
    !needle.is_empty()
        && haystack
            .windows(needle.len())
            .any(|window| window == needle)
}

/// Return the stable content address used by the source blob store.
pub fn content_digest(bytes: &[u8]) -> String {
    let mut state = [
        0x6a09e667_u32,
        0xbb67ae85,
        0x3c6ef372,
        0xa54ff53a,
        0x510e527f,
        0x9b05688c,
        0x1f83d9ab,
        0x5be0cd19,
    ];
    let bit_length = (bytes.len() as u64).wrapping_mul(8);
    let padded_len = (bytes.len() + 9).div_ceil(64) * 64;
    let mut padded = Vec::with_capacity(padded_len);
    padded.extend_from_slice(bytes);
    padded.push(0x80);
    padded.resize(padded_len - 8, 0);
    padded.extend_from_slice(&bit_length.to_be_bytes());

    for chunk in padded.as_chunks::<64>().0 {
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
    hex.push_str(DIGEST_ALGORITHM);
    hex.push(':');
    for word in state {
        hex.push_str(&format!("{word:08x}"));
    }
    hex
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

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "boreal-source-{label}-{}-{}",
            std::process::id(),
            unique_stamp()
        ))
    }

    fn producer() -> ArtifactProducer {
        ArtifactProducer {
            work_id: "work-7".into(),
            attempt_id: "attempt-2".into(),
            result_id: "result-9".into(),
        }
    }

    fn relationship_input(identity: SourceIdentity) -> ArtifactRelationshipInput {
        ArtifactRelationshipInput {
            relationship_id: "relationship-9".into(),
            source: identity,
            role: ArtifactRole::ProducedDeliverable,
            scope: ArtifactScope::Project,
            requirement_key: Some("logo_final".into()),
            produced_by: Some(producer()),
            rights: ArtifactRightsProvenance {
                attribution: Some("Created by the project worker".into()),
                rights_statement: Some("Project-owned output".into()),
                license: None,
            },
            operation_id: "op_artifact_relation_9".into(),
        }
    }

    #[test]
    fn sha256_matches_known_vectors() {
        assert_eq!(
            content_digest(b"abc"),
            "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn citation_requires_a_bounded_excerpt_from_the_blob() {
        let catalog = SourceCatalog::default();
        let version = catalog
            .capture("p1", "docs/a.md", b"hello", "text/markdown")
            .unwrap();
        let citation = catalog.cite(&version, "line:1", b"ell").unwrap();
        catalog
            .verify_citation(&version, &citation, b"ell")
            .unwrap();
        assert_eq!(
            catalog.cite(&version, "line:1", b"missing"),
            Err(SourceError::ExcerptNotFound)
        );
        let oversized = vec![b'x'; DEFAULT_MAX_CITATION_BYTES + 1];
        assert_eq!(
            catalog.cite(&version, "line:1", &oversized),
            Err(SourceError::CitationTooLarge)
        );
    }

    #[test]
    fn artifact_readback_checks_project_version_digest_and_inline_bound() {
        let catalog = SourceCatalog::default();
        let version = catalog
            .capture("p1", "assets/logo.bin", b"\0\x01\xff", "image/png")
            .unwrap();
        let identity = SourceIdentity::from_version(&version);
        let readback = catalog
            .read_identity_bounded(&identity, DEFAULT_MAX_ARTIFACT_BYTES)
            .unwrap();
        assert_eq!(readback.bytes, b"\0\x01\xff");
        assert_eq!(readback.media_type, "image/png");
        assert_eq!(
            catalog.read_identity_bounded(&identity, 2),
            Err(SourceError::ArtifactTooLarge {
                actual: 3,
                limit: 2,
            })
        );

        let mut wrong_digest = identity.clone();
        wrong_digest.content_digest = content_digest(b"different");
        assert_eq!(
            catalog.read_identity_bounded(&wrong_digest, 10),
            Err(SourceError::InvalidArtifactIdentity)
        );
        let mut wrong_project = identity;
        wrong_project.project_id = "p2".into();
        assert_eq!(
            catalog.read_identity_bounded(&wrong_project, 10),
            Err(SourceError::ScopeViolation)
        );
    }

    #[test]
    fn artifact_relationship_and_bytes_survive_restart_and_root_relocation() {
        let tree = temp_path("relocation");
        let original_source = tree.join("temporary/source");
        let input_file = tree.join("caller-temp/logo.bin");
        let relocated_source = tree.join("restored/source");
        let destination_root = tree.join("allowed-output");
        fs::create_dir_all(input_file.parent().unwrap()).unwrap();
        fs::write(&input_file, b"\x89PNG\r\n\x1a\ncreative asset bytes").unwrap();
        let bytes = fs::read(&input_file).unwrap();
        fs::create_dir_all(&original_source).unwrap();

        let identity = {
            let catalog = SourceCatalog::with_persistent_filesystem(&original_source).unwrap();
            let capture = catalog
                .capture_with_operation(&SourceCaptureRequest::new(
                    "op_capture_logo",
                    "project-a",
                    "assets/logo.png",
                    "image/png",
                    bytes.clone(),
                ))
                .unwrap();
            let identity = SourceIdentity::from_version(&capture.source_version);
            let relationship = catalog
                .record_artifact_relationship(relationship_input(identity.clone()))
                .unwrap();
            assert!(!relationship.duplicate);
            assert_eq!(
                relationship.relationship.role,
                ArtifactRole::ProducedDeliverable
            );
            assert_eq!(
                relationship
                    .relationship
                    .produced_by
                    .as_ref()
                    .unwrap()
                    .result_id,
                "result-9"
            );
            let retry = catalog
                .record_artifact_relationship(relationship_input(identity.clone()))
                .unwrap();
            assert!(retry.duplicate);
            assert_eq!(
                catalog
                    .show_artifact_relationship("project-a", "relationship-9")
                    .unwrap()
                    .unwrap(),
                relationship.relationship
            );
            identity
        };
        fs::remove_file(&input_file).unwrap();

        fs::create_dir_all(&relocated_source).unwrap();
        let original_catalog = SourceCatalog::with_persistent_filesystem(&original_source).unwrap();
        let blob_path = FilesystemBlobStore::new(&original_source)
            .blob_path(&identity.content_digest)
            .unwrap();
        let relocated_blob = FilesystemBlobStore::new(&relocated_source)
            .blob_path(&identity.content_digest)
            .unwrap();
        fs::create_dir_all(relocated_blob.parent().unwrap()).unwrap();
        fs::copy(&blob_path, &relocated_blob).unwrap();
        fs::copy(
            original_source.join("catalog.json"),
            relocated_source.join("catalog.json"),
        )
        .unwrap();
        drop(original_catalog);

        let relocated = SourceCatalog::with_persistent_filesystem(&relocated_source).unwrap();
        fs::create_dir_all(&destination_root).unwrap();
        let relationship = relocated
            .show_artifact_relationship("project-a", "relationship-9")
            .unwrap();
        assert_eq!(relationship.unwrap().source, identity);
        let readback = relocated
            .read_identity_bounded(&identity, DEFAULT_MAX_ARTIFACT_BYTES)
            .unwrap();
        assert_eq!(readback.bytes, bytes);
        let receipt = relocated
            .materialize_identity(
                &identity,
                &destination_root,
                Path::new("deliverables/logo.png"),
                DEFAULT_MAX_ARTIFACT_BYTES,
            )
            .unwrap();
        assert_eq!(receipt.relative_path, "deliverables/logo.png");
        assert!(!receipt.already_present);
        let retry = relocated
            .materialize_identity(
                &identity,
                &destination_root,
                Path::new("deliverables/logo.png"),
                DEFAULT_MAX_ARTIFACT_BYTES,
            )
            .unwrap();
        assert!(retry.already_present);
        let materialized = fs::read(destination_root.join("deliverables/logo.png")).unwrap();
        assert_eq!(materialized.len(), readback.byte_count);
        assert_eq!(content_digest(&materialized), identity.content_digest);

        let _ = fs::remove_dir_all(tree);
    }

    #[test]
    fn materialization_rejects_traversal_and_different_existing_bytes() {
        let catalog = SourceCatalog::default();
        let version = catalog
            .capture("p1", "assets/a.bin", b"asset", "application/octet-stream")
            .unwrap();
        let identity = SourceIdentity::from_version(&version);
        let root = temp_path("materialize");
        fs::create_dir_all(&root).unwrap();
        assert_eq!(
            catalog.materialize_identity(&identity, &root, Path::new("../outside.bin"), 100,),
            Err(SourceError::InvalidMaterializationPath)
        );
        fs::write(root.join("asset.bin"), b"other").unwrap();
        assert_eq!(
            catalog.materialize_identity(&identity, &root, Path::new("asset.bin"), 100,),
            Err(SourceError::MaterializedArtifactConflict)
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn malformed_catalog_lock_is_not_proven_stale() {
        let path = std::env::temp_dir().join(format!(
            "boreal-source-malformed-lock-{}-{}",
            std::process::id(),
            unique_stamp()
        ));
        fs::write(&path, b"pid=2147483647\n").unwrap();
        assert!(!catalog_lock_owner_is_definitely_dead(&path));
        let _ = fs::remove_file(path);
    }
}
