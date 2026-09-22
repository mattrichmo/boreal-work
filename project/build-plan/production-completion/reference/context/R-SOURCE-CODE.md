# R-SOURCE-CODE — crates/source/src/lib.rs

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `crates/source/src/lib.rs:L1–L300`  
**File SHA-256:** `46eaffb8713bdabcb41f029a95feb5f44b9d1846b54a455868702b742d1889c7`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Versioned source intake/index implementations; inspect referenced retrieval and parser tests for supported kinds.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,300p' 'crates/source/src/lib.rs'
```

## Exact baseline excerpt

````text
    1 | //! Immutable, project-scoped source intake primitives.
    2 | //!
    3 | //! The catalog deliberately keeps source metadata separate from blob storage.
    4 | //! A source version is inserted only after its content-addressed blob has been
    5 | //! durably written and verified. Blob availability is checked again when a
    6 | //! version is read, so missing and tampered evidence remains visible.
    7 | 
    8 | use std::{
    9 |     collections::{BTreeMap, BTreeSet, HashMap},
   10 |     fmt,
   11 |     fs::{self, File, OpenOptions},
   12 |     io::{self, Read, Write},
   13 |     path::{Component, Path, PathBuf},
   14 |     sync::{
   15 |         atomic::{AtomicU64, Ordering},
   16 |         Arc, Mutex, MutexGuard,
   17 |     },
   18 |     time::{Duration, Instant, SystemTime, UNIX_EPOCH},
   19 | };
   20 | 
   21 | #[cfg(unix)]
   22 | use std::os::fd::AsRawFd;
   23 | 
   24 | use serde::{Deserialize, Serialize};
   25 | 
   26 | pub const DEFAULT_MAX_CITATION_BYTES: usize = 64 * 1024;
   27 | pub const DEFAULT_MAX_LOCATION_BYTES: usize = 4 * 1024;
   28 | pub const DEFAULT_PARSER_IDENTITY: &str = "plain-text-lines/v1";
   29 | pub const DEFAULT_MAX_PARSE_BYTES: usize = 4 * 1024 * 1024;
   30 | pub const DEFAULT_MAX_PARSE_CHUNKS: usize = 100_000;
   31 | pub const DEFAULT_MAX_CHUNK_BYTES: usize = 16 * 1024;
   32 | pub const DEFAULT_MAX_RETRIEVAL_EXCERPT_BYTES: usize = 4 * 1024;
   33 | const CATALOG_LOCK_WAIT: Duration = Duration::from_secs(10);
   34 | /// Canonical content identity shared with the migration boundary.
   35 | pub const DIGEST_ALGORITHM: &str = "sha256";
   36 | 
   37 | #[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
   38 | pub enum Availability {
   39 |     Available,
   40 |     Missing,
   41 |     Corrupt,
   42 | }
   43 | 
   44 | #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
   45 | pub struct SourceVersion {
   46 |     pub project_id: String,
   47 |     pub source_version_id: String,
   48 |     pub origin: String,
   49 |     pub media_type: String,
   50 |     pub byte_count: usize,
   51 |     pub content_digest: String,
   52 |     pub availability: Availability,
   53 |     pub parser_identity: Option<String>,
   54 | }
   55 | 
   56 | /// A complete source registration/capture intent.  The operation ID is owned
   57 | /// by the application boundary and is stable across retries.  The catalog
   58 | /// records the request fingerprint together with the resulting immutable
   59 | /// source version so a retry cannot silently change its origin, media type, or
   60 | /// bytes.
   61 | #[derive(Clone, Debug, Eq, PartialEq)]
   62 | pub struct SourceCaptureRequest {
   63 |     pub operation_id: String,
   64 |     pub project_id: String,
   65 |     pub origin: String,
   66 |     pub media_type: String,
   67 |     pub bytes: Vec<u8>,
   68 | }
   69 | 
   70 | impl SourceCaptureRequest {
   71 |     pub fn new(
   72 |         operation_id: impl Into<String>,
   73 |         project_id: impl Into<String>,
   74 |         origin: impl Into<String>,
   75 |         media_type: impl Into<String>,
   76 |         bytes: impl Into<Vec<u8>>,
   77 |     ) -> Self {
   78 |         Self {
   79 |             operation_id: operation_id.into(),
   80 |             project_id: project_id.into(),
   81 |             origin: origin.into(),
   82 |             media_type: media_type.into(),
   83 |             bytes: bytes.into(),
   84 |         }
   85 |     }
   86 | }
   87 | 
   88 | #[derive(Clone, Debug, Eq, PartialEq)]
   89 | pub struct SourceCaptureReceipt {
   90 |     pub operation_id: String,
   91 |     pub source_version: SourceVersion,
   92 |     /// True only when this exact operation was previously durably recorded.
   93 |     pub duplicate: bool,
   94 |     /// True when a new operation reused an already captured immutable byte
   95 |     /// version.  This is distinct from retry replay and remains explicit to
   96 |     /// the application adapter.
   97 |     pub reused_existing_version: bool,
   98 | }
   99 | 
  100 | #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
  101 | pub struct Citation {
  102 |     pub source_version_id: String,
  103 |     pub location: String,
  104 |     pub excerpt_digest: String,
  105 | }
  106 | 
  107 | #[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
  108 | pub enum ParseState {
  109 |     Indexed,
  110 |     Failed,
  111 | }
  112 | 
  113 | #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
  114 | pub struct ParseWarning {
  115 |     pub code: String,
  116 |     pub message: String,
  117 | }
  118 | 
  119 | #[derive(Clone, Copy, Debug, Eq, PartialEq)]
  120 | pub struct ParserLimits {
  121 |     pub max_source_bytes: usize,
  122 |     pub max_chunks: usize,
  123 |     pub max_chunk_bytes: usize,
  124 | }
  125 | 
  126 | impl Default for ParserLimits {
  127 |     fn default() -> Self {
  128 |         Self {
  129 |             max_source_bytes: DEFAULT_MAX_PARSE_BYTES,
  130 |             max_chunks: DEFAULT_MAX_PARSE_CHUNKS,
  131 |             max_chunk_bytes: DEFAULT_MAX_CHUNK_BYTES,
  132 |         }
  133 |     }
  134 | }
  135 | 
  136 | #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
  137 | pub struct ParseReport {
  138 |     pub project_id: String,
  139 |     pub source_version_id: String,
  140 |     pub parser_identity: String,
  141 |     pub state: ParseState,
  142 |     pub output_digest: Option<String>,
  143 |     pub chunk_count: usize,
  144 |     pub warnings: Vec<ParseWarning>,
  145 |     pub error: Option<String>,
  146 |     pub index_revision: u64,
  147 | }
  148 | 
  149 | #[derive(Clone, Debug, Eq, PartialEq)]
  150 | pub struct RetrievalRequest {
  151 |     pub project_id: String,
  152 |     pub query: String,
  153 |     pub limit: usize,
  154 |     pub max_excerpt_bytes: usize,
  155 | }
  156 | 
  157 | impl RetrievalRequest {
  158 |     pub fn new(project_id: impl Into<String>, query: impl Into<String>) -> Self {
  159 |         Self {
  160 |             project_id: project_id.into(),
  161 |             query: query.into(),
  162 |             limit: 20,
  163 |             max_excerpt_bytes: DEFAULT_MAX_RETRIEVAL_EXCERPT_BYTES,
  164 |         }
  165 |     }
  166 | }
  167 | 
  168 | #[derive(Clone, Copy, Debug, Eq, PartialEq)]
  169 | pub enum RetrievalLayer {
  170 |     RawSource,
  171 | }
  172 | 
  173 | #[derive(Clone, Debug, Eq, PartialEq)]
  174 | pub struct RetrievalHit {
  175 |     pub source_version_id: String,
  176 |     pub origin: String,
  177 |     pub location: String,
  178 |     pub excerpt: String,
  179 |     pub excerpt_digest: String,
  180 |     pub score: usize,
  181 |     pub layer: RetrievalLayer,
  182 |     pub index_revision: u64,
  183 | }
  184 | 
  185 | #[derive(Clone, Debug, Eq, PartialEq)]
  186 | pub struct RetrievalResponse {
  187 |     pub project_id: String,
  188 |     pub query: String,
  189 |     pub hits: Vec<RetrievalHit>,
  190 |     pub source_revision: u64,
  191 |     pub index_revision: u64,
  192 |     pub lag: usize,
  193 | }
  194 | 
  195 | #[derive(Clone, Debug, Eq, PartialEq)]
  196 | pub enum FindingKind {
  197 |     MissingBlob,
  198 |     CorruptBlob,
  199 |     Unindexed,
  200 |     ParserFailed,
  201 |     StaleParser,
  202 |     OrphanIndex,
  203 | }
  204 | 
  205 | #[derive(Clone, Debug, Eq, PartialEq)]
  206 | pub struct IntegrityFinding {
  207 |     pub project_id: String,
  208 |     pub source_version_id: Option<String>,
  209 |     pub kind: FindingKind,
  210 |     pub detail: String,
  211 | }
  212 | 
  213 | #[derive(Clone, Debug, Eq, PartialEq)]
  214 | pub struct IndexStatus {
  215 |     pub source_revision: u64,
  216 |     pub index_revision: u64,
  217 |     pub lag: usize,
  218 |     pub indexed_versions: usize,
  219 |     pub failed_versions: usize,
  220 | }
  221 | 
  222 | #[derive(Clone, Debug, Eq, PartialEq)]
  223 | pub struct DoctorReport {
  224 |     pub project_id: Option<String>,
  225 |     pub status: IndexStatus,
  226 |     pub findings: Vec<IntegrityFinding>,
  227 | }
  228 | 
  229 | #[derive(Clone, Debug, Eq, PartialEq)]
  230 | pub struct RepairReport {
  231 |     pub project_id: Option<String>,
  232 |     pub attempted: usize,
  233 |     pub repaired: usize,
  234 |     pub unchanged: usize,
  235 |     pub skipped_unavailable: usize,
  236 |     pub failed: usize,
  237 |     pub orphan_indexes_removed: usize,
  238 |     pub status: IndexStatus,
  239 | }
  240 | 
  241 | #[derive(Clone, Copy, Debug, Eq, PartialEq)]
  242 | pub struct CitationLimits {
  243 |     pub max_excerpt_bytes: usize,
  244 |     pub max_location_bytes: usize,
  245 | }
  246 | 
  247 | impl Default for CitationLimits {
  248 |     fn default() -> Self {
  249 |         Self {
  250 |             max_excerpt_bytes: DEFAULT_MAX_CITATION_BYTES,
  251 |             max_location_bytes: DEFAULT_MAX_LOCATION_BYTES,
  252 |         }
  253 |     }
  254 | }
  255 | 
  256 | #[derive(Clone, Debug, Eq, PartialEq)]
  257 | pub enum SourceError {
  258 |     ScopeViolation,
  259 |     EmptyOrigin,
  260 |     EmptyMediaType,
  261 |     DigestMismatch,
  262 |     MissingBlob,
  263 |     StaleParser,
  264 |     InvalidCitation,
  265 |     CitationTooLarge,
  266 |     ExcerptNotFound,
  267 |     InvalidRetrievalQuery,
  268 |     EmptyParser,
  269 |     EmptyOperation,
  270 |     OperationConflict,
  271 |     SourceMetadataConflict,
  272 |     Storage(String),
  273 | }
  274 | 
  275 | impl fmt::Display for SourceError {
  276 |     fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
  277 |         match self {
  278 |             Self::ScopeViolation => f.write_str("source is outside the project scope"),
  279 |             Self::EmptyOrigin => f.write_str("source project or origin is empty"),
  280 |             Self::EmptyMediaType => f.write_str("source media type is empty"),
  281 |             Self::DigestMismatch => f.write_str("blob digest or size verification failed"),
  282 |             Self::MissingBlob => f.write_str("source blob is unavailable"),
  283 |             Self::StaleParser => f.write_str("parser result targets a different source version"),
  284 |             Self::InvalidCitation => f.write_str("citation is invalid for the source version"),
  285 |             Self::CitationTooLarge => {
  286 |                 f.write_str("citation exceeds the configured verification bound")
  287 |             }
  288 |             Self::ExcerptNotFound => {
  289 |                 f.write_str("citation excerpt is not present in the source blob")
  290 |             }
  291 |             Self::InvalidRetrievalQuery => f.write_str("retrieval query or bound is invalid"),
  292 |             Self::EmptyParser => f.write_str("parser identity is empty"),
  293 |             Self::EmptyOperation => f.write_str("source operation identity is empty"),
  294 |             Self::OperationConflict => {
  295 |                 f.write_str("source operation was already used for different input")
  296 |             }
  297 |             Self::SourceMetadataConflict => {
  298 |                 f.write_str("existing source version has different immutable metadata")
  299 |             }
  300 |             Self::Storage(message) => write!(f, "blob storage error: {message}"),
````
