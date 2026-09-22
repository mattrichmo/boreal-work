# R-APP-KNOWLEDGE — crates/application/src/knowledge.rs

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `crates/application/src/knowledge.rs:L1–L260`  
**File SHA-256:** `c277aec754f38fb0896712f4d171dbb85313847c067eb6800795fbb4926e9c39`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Application source/memory intake and query routes; preserve project scoping and transactional provenance.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,260p' 'crates/application/src/knowledge.rs'
```

## Exact baseline excerpt

````text
    1 | //! Application-owned adapters for source, memory, and migration workflows.
    2 | //!
    3 | //! The lower-level crates intentionally do not know about the application
    4 | //! operation protocol. This module supplies that boundary without making the
    5 | //! CLI, TUI, or a library crate into a second authority:
    6 | //!
    7 | //! * source capture uses the source catalog's durable operation record;
    8 | //! * memory publication uses the Git manifest and expected-base identity;
    9 | //! * migration is validated and staged in memory until a store materializer
   10 | //!   is available, and never pretends that staging changed live work.
   11 | //!
   12 | //! Every result carries a request digest and provenance. A caller can persist
   13 | //! that envelope in its operation table and safely reconcile a lost response.
   14 | //! This module deliberately performs no direct SQL.
   15 | 
   16 | use std::{fmt, path::Path};
   17 | 
   18 | use boreal_memory::{
   19 |     rebuild_index, Citation as MemoryCitation, Draft, DraftState, IndexError, MemoryError,
   20 |     MemoryIndex, PublicationReceipt, PublishError, Publisher, RetrievalQuery, RetrievalResponse,
   21 | };
   22 | use boreal_migration::{
   23 |     content_digest as migration_content_digest, export_json, import_json, import_legacy_json,
   24 |     ImportError, ImportReport, ImportVerification, LegacyImportError, LegacyImportPlan,
   25 |     MaterializationError, MigrationCounts, MigrationDocument, SourceProvenance, FORMAT,
   26 |     FORMAT_VERSION, LEGACY_FORMAT,
   27 | };
   28 | use boreal_source::{
   29 |     Availability, Citation as SourceCitation, RetrievalRequest as SourceRetrievalRequest,
   30 |     RetrievalResponse as SourceRetrievalResponse, SourceCaptureReceipt, SourceCaptureRequest,
   31 |     SourceCatalog, SourceError, SourceVersion,
   32 | };
   33 | use serde_json::json;
   34 | 
   35 | use boreal_store::{
   36 |     SourceVersionRecord, SourceVersionRegistrationInput, SourceVersionRegistrationResult,
   37 |     SqliteStore,
   38 | };
   39 | 
   40 | use crate::{canonical_request_digest, sha256_content_digest};
   41 | 
   42 | /// A stable description of how far a knowledge operation reached.
   43 | #[derive(Clone, Copy, Debug, Eq, PartialEq)]
   44 | pub enum KnowledgeDurability {
   45 |     /// The source catalog recorded the operation and immutable version.
   46 |     SourceCatalog,
   47 |     /// A reviewed memory entry was committed to the managed Git repository.
   48 |     GitCommit,
   49 |     /// The operation only produced an in-memory application result.
   50 |     InMemory,
   51 |     /// The operation produced a validated staging document, but no live store
   52 |     /// materializer exists at this boundary yet.
   53 |     StagedOnly,
   54 | }
   55 | 
   56 | #[derive(Clone, Debug, Eq, PartialEq)]
   57 | pub struct KnowledgeOperation {
   58 |     pub operation_id: String,
   59 |     pub request_digest: String,
   60 |     pub durability: KnowledgeDurability,
   61 | }
   62 | 
   63 | #[derive(Clone, Debug, Eq, PartialEq, Default)]
   64 | pub struct KnowledgeProvenance {
   65 |     pub project_id: Option<String>,
   66 |     pub source_version_id: Option<String>,
   67 |     pub source_digest: Option<String>,
   68 |     pub memory_entry_id: Option<String>,
   69 |     pub git_revision: Option<String>,
   70 |     pub migration_source_digest: Option<String>,
   71 |     pub content_digest: Option<String>,
   72 | }
   73 | 
   74 | #[derive(Clone, Debug, Eq, PartialEq)]
   75 | pub enum SourceRegistrationState {
   76 |     /// The immutable blob and catalog metadata were committed by the source
   77 |     /// catalog's operation-aware capture path.
   78 |     CatalogCommitted,
   79 |     /// The canonical SQLite source_version adapter is not part of this
   80 |     /// vertical. The catalog result remains usable for reconciliation.
   81 |     StoreRegistrationPending { reason: String },
   82 |     /// The catalog and canonical SQLite source_version row were committed.
   83 |     StoreCommitted { revision: u64, replayed: bool },
   84 | }
   85 | 
   86 | #[derive(Clone, Debug, Eq, PartialEq)]
   87 | pub struct SourceStoreRegistrationResult {
   88 |     pub operation: KnowledgeOperation,
   89 |     pub source: SourceVersionRecord,
   90 |     pub revision: u64,
   91 |     pub replayed: bool,
   92 | }
   93 | 
   94 | #[derive(Clone, Debug, Eq, PartialEq)]
   95 | pub struct SourceCaptureInput {
   96 |     pub operation_id: String,
   97 |     pub project_id: String,
   98 |     pub origin: String,
   99 |     pub media_type: String,
  100 |     pub bytes: Vec<u8>,
  101 | }
  102 | 
  103 | #[derive(Clone, Debug, Eq, PartialEq)]
  104 | pub struct SourceCaptureResult {
  105 |     pub operation: KnowledgeOperation,
  106 |     pub provenance: KnowledgeProvenance,
  107 |     pub source: SourceVersion,
  108 |     pub duplicate: bool,
  109 |     pub reused_existing_version: bool,
  110 |     pub registration: SourceRegistrationState,
  111 | }
  112 | 
  113 | #[derive(Clone, Debug, Eq, PartialEq)]
  114 | pub struct SourceVerificationResult {
  115 |     pub source: SourceVersion,
  116 |     pub availability: Availability,
  117 |     /// Present only when the blob was actually read and verified. A declared
  118 |     /// digest is never relabeled as observed proof when the blob is missing.
  119 |     pub verified_digest: Option<String>,
  120 |     pub byte_count: usize,
  121 | }
  122 | 
  123 | #[derive(Clone, Debug, Eq, PartialEq)]
  124 | pub struct SourceCitationResult {
  125 |     pub source: SourceVersion,
  126 |     pub citation: SourceCitation,
  127 | }
  128 | 
  129 | #[derive(Clone, Debug, Eq, PartialEq)]
  130 | pub struct MemoryDraftInput {
  131 |     pub operation_id: String,
  132 |     pub project_id: String,
  133 |     pub entry_id: String,
  134 |     pub title: String,
  135 |     pub body: String,
  136 |     pub citations: Vec<MemoryCitation>,
  137 | }
  138 | 
  139 | #[derive(Clone, Debug, Eq, PartialEq)]
  140 | pub struct MemoryDraftResult {
  141 |     pub operation: KnowledgeOperation,
  142 |     pub provenance: KnowledgeProvenance,
  143 |     pub draft: Draft,
  144 | }
  145 | 
  146 | #[derive(Clone, Debug, Eq, PartialEq)]
  147 | pub struct MemoryReviewInput {
  148 |     pub operation_id: String,
  149 |     pub reviewer_id: String,
  150 |     pub accepted: bool,
  151 | }
  152 | 
  153 | #[derive(Clone, Debug, Eq, PartialEq)]
  154 | pub struct MemoryPublishInput {
  155 |     pub operation_id: String,
  156 |     pub expected_manifest_identity: Option<String>,
  157 | }
  158 | 
  159 | #[derive(Clone, Debug, Eq, PartialEq)]
  160 | pub struct ReviewedMemory {
  161 |     pub operation: KnowledgeOperation,
  162 |     pub provenance: KnowledgeProvenance,
  163 |     pub draft: Draft,
  164 |     pub reviewer_id: String,
  165 |     pub accepted: bool,
  166 | }
  167 | 
  168 | #[derive(Clone, Debug, Eq, PartialEq)]
  169 | pub struct MemoryPublicationResult {
  170 |     pub operation: KnowledgeOperation,
  171 |     pub provenance: KnowledgeProvenance,
  172 |     pub receipt: PublicationReceipt,
  173 | }
  174 | 
  175 | #[derive(Clone, Debug, Eq, PartialEq)]
  176 | pub struct MemorySearchInput {
  177 |     pub project_id: String,
  178 |     pub text: Option<String>,
  179 |     pub entry_id: Option<String>,
  180 |     pub source_version_id: Option<String>,
  181 |     pub limit: usize,
  182 |     pub max_excerpt_bytes: usize,
  183 |     pub requested_git_revision: Option<String>,
  184 | }
  185 | 
  186 | impl Default for MemorySearchInput {
  187 |     fn default() -> Self {
  188 |         Self {
  189 |             project_id: String::new(),
  190 |             text: None,
  191 |             entry_id: None,
  192 |             source_version_id: None,
  193 |             limit: 20,
  194 |             max_excerpt_bytes: 320,
  195 |             requested_git_revision: None,
  196 |         }
  197 |     }
  198 | }
  199 | 
  200 | #[derive(Clone, Debug, Eq, PartialEq)]
  201 | pub struct MemorySearchResult {
  202 |     pub operation: KnowledgeOperation,
  203 |     pub provenance: KnowledgeProvenance,
  204 |     pub response: RetrievalResponse,
  205 | }
  206 | 
  207 | #[derive(Clone, Debug, Eq, PartialEq)]
  208 | pub enum MigrationPlanKind {
  209 |     Current { report: ImportReport },
  210 |     Legacy { plan: LegacyImportPlan },
  211 | }
  212 | 
  213 | #[derive(Clone, Debug, Eq, PartialEq)]
  214 | pub struct MigrationDryRunResult {
  215 |     pub operation: KnowledgeOperation,
  216 |     pub provenance: KnowledgeProvenance,
  217 |     pub source: SourceProvenance,
  218 |     pub kind: MigrationPlanKind,
  219 |     pub ready: bool,
  220 |     pub loss_ledger: Vec<boreal_migration::LossLedgerEntry>,
  221 | }
  222 | 
  223 | #[derive(Clone, Debug, Eq, PartialEq)]
  224 | pub struct MigrationVerificationResult {
  225 |     pub operation: KnowledgeOperation,
  226 |     pub provenance: KnowledgeProvenance,
  227 |     pub source: SourceProvenance,
  228 |     pub ready: bool,
  229 |     pub document_fingerprint: Option<String>,
  230 |     pub counts: Option<MigrationCounts>,
  231 |     pub issue_count: usize,
  232 |     pub loss_ledger: Vec<boreal_migration::LossLedgerEntry>,
  233 |     pub unsupported_capabilities: Vec<String>,
  234 | }
  235 | 
  236 | #[derive(Clone, Debug, Eq, PartialEq)]
  237 | pub enum MigrationApplyState {
  238 |     /// The validated document exists only in the returned staging result.
  239 |     StagedOnly,
  240 |     /// The source contained unsupported or ambiguous records and therefore
  241 |     /// cannot be materialized even into a trusted staging document.
  242 |     RequiresReview,
  243 | }
  244 | 
  245 | #[derive(Clone, Debug, Eq, PartialEq)]
  246 | pub struct MigrationApplyResult {
  247 |     pub operation: KnowledgeOperation,
  248 |     pub provenance: KnowledgeProvenance,
  249 |     pub source: SourceProvenance,
  250 |     pub state: MigrationApplyState,
  251 |     pub document: Option<MigrationDocument>,
  252 |     pub loss_ledger: Vec<boreal_migration::LossLedgerEntry>,
  253 |     /// Explicit rather than implicit: this adapter does not claim to have
  254 |     /// applied rows to SQLite.
  255 |     pub unsupported_capabilities: Vec<String>,
  256 | }
  257 | 
  258 | #[derive(Debug)]
  259 | pub enum KnowledgeError {
  260 |     Source(SourceError),
````
