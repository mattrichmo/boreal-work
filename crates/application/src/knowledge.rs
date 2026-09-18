//! Application-owned adapters for source, memory, and migration workflows.
//!
//! The lower-level crates intentionally do not know about the application
//! operation protocol. This module supplies that boundary without making the
//! CLI, TUI, or a library crate into a second authority:
//!
//! * source capture uses the source catalog's durable operation record;
//! * memory publication uses the Git manifest and expected-base identity;
//! * migration is validated and staged in memory until a store materializer
//!   is available, and never pretends that staging changed live work.
//!
//! Every result carries a request digest and provenance. A caller can persist
//! that envelope in its operation table and safely reconcile a lost response.
//! This module deliberately performs no direct SQL.

use std::{fmt, path::Path};

use boreal_memory::{
    rebuild_index, Citation as MemoryCitation, Draft, DraftState, IndexError, MemoryError,
    MemoryIndex, PublicationReceipt, PublishError, Publisher, RetrievalQuery, RetrievalResponse,
};
use boreal_migration::{
    content_digest as migration_content_digest, export_json, import_json, import_legacy_json,
    ImportError, ImportReport, ImportVerification, LegacyImportError, LegacyImportPlan,
    MaterializationError, MigrationCounts, MigrationDocument, SourceProvenance, FORMAT,
    FORMAT_VERSION, LEGACY_FORMAT,
};
use boreal_source::{
    Availability, Citation as SourceCitation, RetrievalRequest as SourceRetrievalRequest,
    RetrievalResponse as SourceRetrievalResponse, SourceCaptureReceipt, SourceCaptureRequest,
    SourceCatalog, SourceError, SourceVersion,
};
use serde_json::json;

use boreal_store::{
    SourceVersionRecord, SourceVersionRegistrationInput, SourceVersionRegistrationResult,
    SqliteStore,
};

use crate::{canonical_request_digest, sha256_content_digest};

/// A stable description of how far a knowledge operation reached.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum KnowledgeDurability {
    /// The source catalog recorded the operation and immutable version.
    SourceCatalog,
    /// A reviewed memory entry was committed to the managed Git repository.
    GitCommit,
    /// The operation only produced an in-memory application result.
    InMemory,
    /// The operation produced a validated staging document, but no live store
    /// materializer exists at this boundary yet.
    StagedOnly,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct KnowledgeOperation {
    pub operation_id: String,
    pub request_digest: String,
    pub durability: KnowledgeDurability,
}

#[derive(Clone, Debug, Eq, PartialEq, Default)]
pub struct KnowledgeProvenance {
    pub project_id: Option<String>,
    pub source_version_id: Option<String>,
    pub source_digest: Option<String>,
    pub memory_entry_id: Option<String>,
    pub git_revision: Option<String>,
    pub migration_source_digest: Option<String>,
    pub content_digest: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SourceRegistrationState {
    /// The immutable blob and catalog metadata were committed by the source
    /// catalog's operation-aware capture path.
    CatalogCommitted,
    /// The canonical SQLite source_version adapter is not part of this
    /// vertical. The catalog result remains usable for reconciliation.
    StoreRegistrationPending { reason: String },
    /// The catalog and canonical SQLite source_version row were committed.
    StoreCommitted { revision: u64, replayed: bool },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SourceStoreRegistrationResult {
    pub operation: KnowledgeOperation,
    pub source: SourceVersionRecord,
    pub revision: u64,
    pub replayed: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SourceCaptureInput {
    pub operation_id: String,
    pub project_id: String,
    pub origin: String,
    pub media_type: String,
    pub bytes: Vec<u8>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SourceCaptureResult {
    pub operation: KnowledgeOperation,
    pub provenance: KnowledgeProvenance,
    pub source: SourceVersion,
    pub duplicate: bool,
    pub reused_existing_version: bool,
    pub registration: SourceRegistrationState,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SourceVerificationResult {
    pub source: SourceVersion,
    pub availability: Availability,
    /// Present only when the blob was actually read and verified. A declared
    /// digest is never relabeled as observed proof when the blob is missing.
    pub verified_digest: Option<String>,
    pub byte_count: usize,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SourceCitationResult {
    pub source: SourceVersion,
    pub citation: SourceCitation,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MemoryDraftInput {
    pub operation_id: String,
    pub project_id: String,
    pub entry_id: String,
    pub title: String,
    pub body: String,
    pub citations: Vec<MemoryCitation>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MemoryDraftResult {
    pub operation: KnowledgeOperation,
    pub provenance: KnowledgeProvenance,
    pub draft: Draft,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MemoryReviewInput {
    pub operation_id: String,
    pub reviewer_id: String,
    pub accepted: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MemoryPublishInput {
    pub operation_id: String,
    pub expected_manifest_identity: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReviewedMemory {
    pub operation: KnowledgeOperation,
    pub provenance: KnowledgeProvenance,
    pub draft: Draft,
    pub reviewer_id: String,
    pub accepted: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MemoryPublicationResult {
    pub operation: KnowledgeOperation,
    pub provenance: KnowledgeProvenance,
    pub receipt: PublicationReceipt,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MemorySearchInput {
    pub project_id: String,
    pub text: Option<String>,
    pub entry_id: Option<String>,
    pub source_version_id: Option<String>,
    pub limit: usize,
    pub max_excerpt_bytes: usize,
    pub requested_git_revision: Option<String>,
}

impl Default for MemorySearchInput {
    fn default() -> Self {
        Self {
            project_id: String::new(),
            text: None,
            entry_id: None,
            source_version_id: None,
            limit: 20,
            max_excerpt_bytes: 320,
            requested_git_revision: None,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MemorySearchResult {
    pub operation: KnowledgeOperation,
    pub provenance: KnowledgeProvenance,
    pub response: RetrievalResponse,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MigrationPlanKind {
    Current { report: ImportReport },
    Legacy { plan: LegacyImportPlan },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MigrationDryRunResult {
    pub operation: KnowledgeOperation,
    pub provenance: KnowledgeProvenance,
    pub source: SourceProvenance,
    pub kind: MigrationPlanKind,
    pub ready: bool,
    pub loss_ledger: Vec<boreal_migration::LossLedgerEntry>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MigrationVerificationResult {
    pub operation: KnowledgeOperation,
    pub provenance: KnowledgeProvenance,
    pub source: SourceProvenance,
    pub ready: bool,
    pub document_fingerprint: Option<String>,
    pub counts: Option<MigrationCounts>,
    pub issue_count: usize,
    pub loss_ledger: Vec<boreal_migration::LossLedgerEntry>,
    pub unsupported_capabilities: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MigrationApplyState {
    /// The validated document exists only in the returned staging result.
    StagedOnly,
    /// The source contained unsupported or ambiguous records and therefore
    /// cannot be materialized even into a trusted staging document.
    RequiresReview,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MigrationApplyResult {
    pub operation: KnowledgeOperation,
    pub provenance: KnowledgeProvenance,
    pub source: SourceProvenance,
    pub state: MigrationApplyState,
    pub document: Option<MigrationDocument>,
    pub loss_ledger: Vec<boreal_migration::LossLedgerEntry>,
    /// Explicit rather than implicit: this adapter does not claim to have
    /// applied rows to SQLite.
    pub unsupported_capabilities: Vec<String>,
}

#[derive(Debug)]
pub enum KnowledgeError {
    Source(SourceError),
    Memory(MemoryError),
    Publish(PublishError),
    Index(IndexError),
    MigrationImport(ImportError),
    MigrationLegacy(LegacyImportError),
    MigrationMaterialization(MaterializationError),
    Store(boreal_store::StoreError),
    Invalid(String),
}

impl fmt::Display for KnowledgeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Source(error) => error.fmt(formatter),
            Self::Memory(error) => error.fmt(formatter),
            Self::Publish(error) => error.fmt(formatter),
            Self::Index(error) => error.fmt(formatter),
            Self::MigrationImport(error) => error.fmt(formatter),
            Self::MigrationLegacy(error) => error.fmt(formatter),
            Self::MigrationMaterialization(error) => error.fmt(formatter),
            Self::Store(error) => error.fmt(formatter),
            Self::Invalid(message) => formatter.write_str(message),
        }
    }
}

impl std::error::Error for KnowledgeError {}

impl From<SourceError> for KnowledgeError {
    fn from(error: SourceError) -> Self {
        Self::Source(error)
    }
}

impl From<MemoryError> for KnowledgeError {
    fn from(error: MemoryError) -> Self {
        Self::Memory(error)
    }
}

impl From<PublishError> for KnowledgeError {
    fn from(error: PublishError) -> Self {
        Self::Publish(error)
    }
}

impl From<IndexError> for KnowledgeError {
    fn from(error: IndexError) -> Self {
        Self::Index(error)
    }
}

impl From<ImportError> for KnowledgeError {
    fn from(error: ImportError) -> Self {
        Self::MigrationImport(error)
    }
}

impl From<LegacyImportError> for KnowledgeError {
    fn from(error: LegacyImportError) -> Self {
        Self::MigrationLegacy(error)
    }
}

impl From<MaterializationError> for KnowledgeError {
    fn from(error: MaterializationError) -> Self {
        Self::MigrationMaterialization(error)
    }
}

impl From<boreal_store::StoreError> for KnowledgeError {
    fn from(error: boreal_store::StoreError) -> Self {
        Self::Store(error)
    }
}

/// Application-facing knowledge boundary. It owns no independent canonical
/// state; the source catalog and memory publisher remain the authorities for
/// their respective durable stores.
pub struct KnowledgeApplication<'a> {
    source_catalog: &'a SourceCatalog,
}

impl<'a> KnowledgeApplication<'a> {
    pub fn new(source_catalog: &'a SourceCatalog) -> Self {
        Self { source_catalog }
    }

    pub fn source_catalog(&self) -> &'a SourceCatalog {
        self.source_catalog
    }

    pub fn capture_source(
        &self,
        input: SourceCaptureInput,
    ) -> Result<SourceCaptureResult, KnowledgeError> {
        require_operation(&input.operation_id)?;
        require_project(&input.project_id)?;
        let request_digest = canonical_request_digest(
            "source.capture/v1",
            json!({
                "project_id": input.project_id,
                "origin": input.origin,
                "media_type": input.media_type,
                "content_digest": sha256_content_digest(&input.bytes),
            }),
        );
        let receipt: SourceCaptureReceipt =
            self.source_catalog
                .capture_with_operation(&SourceCaptureRequest::new(
                    input.operation_id.clone(),
                    input.project_id.clone(),
                    input.origin,
                    input.media_type,
                    input.bytes,
                ))?;
        Ok(SourceCaptureResult {
            operation: KnowledgeOperation {
                operation_id: input.operation_id,
                request_digest,
                durability: KnowledgeDurability::SourceCatalog,
            },
            provenance: KnowledgeProvenance {
                project_id: Some(receipt.source_version.project_id.clone()),
                source_version_id: Some(receipt.source_version.source_version_id.clone()),
                source_digest: Some(receipt.source_version.content_digest.clone()),
                ..KnowledgeProvenance::default()
            },
            source: receipt.source_version,
            duplicate: receipt.duplicate,
            reused_existing_version: receipt.reused_existing_version,
            registration: SourceRegistrationState::StoreRegistrationPending {
                reason: "SQLite source_version registration must be committed by the store adapter with this operation identity".to_owned(),
            },
        })
    }

    /// Completes source capture through both authorities.  The catalog must
    /// capture and verify the immutable bytes first; this method then records
    /// only relational metadata in SQLite using the same operation identity.
    /// A retry reads the durable operation and source row instead of inserting
    /// a second version.
    pub fn capture_source_with_store(
        &self,
        store: &SqliteStore,
        input: SourceCaptureInput,
        actor_id: &str,
        captured_at: &str,
    ) -> Result<SourceCaptureResult, KnowledgeError> {
        if actor_id.trim().is_empty() || captured_at.trim().is_empty() {
            return Err(KnowledgeError::Invalid(
                "source registration requires actor and captured_at".to_owned(),
            ));
        }
        let mut result = self.capture_source(input)?;
        let registration = self.register_captured_source(
            store,
            &result.source,
            &result.operation,
            actor_id,
            captured_at,
        )?;
        result.registration = SourceRegistrationState::StoreCommitted {
            revision: registration.revision,
            replayed: registration.replayed,
        };
        Ok(result)
    }

    /// Registers an already captured catalog version in SQLite.  This is
    /// separate so a caller can reconcile a catalog commit after a lost
    /// response without recapturing bytes.
    pub fn register_captured_source(
        &self,
        store: &SqliteStore,
        source: &SourceVersion,
        operation: &KnowledgeOperation,
        actor_id: &str,
        captured_at: &str,
    ) -> Result<SourceStoreRegistrationResult, KnowledgeError> {
        require_operation(&operation.operation_id)?;
        require_project(&source.project_id)?;
        let availability = match source.availability {
            Availability::Available => "available",
            Availability::Missing => "missing",
            Availability::Corrupt => "quarantined",
        };
        let request_digest = canonical_request_digest(
            "source.register/v1",
            json!({
                "project_id": source.project_id,
                "source_version_id": source.source_version_id,
                "origin": source.origin,
                "media_type": source.media_type,
                "byte_count": source.byte_count,
                "content_digest": source.content_digest,
                "parser_identity": source.parser_identity,
                "availability": availability,
                "captured_at": captured_at,
            }),
        );
        let stored: SourceVersionRegistrationResult =
            store.register_source_version(&SourceVersionRegistrationInput {
                operation_id: operation.operation_id.clone(),
                project_id: source.project_id.clone(),
                actor_id: actor_id.to_owned(),
                source_version_id: source.source_version_id.clone(),
                origin: source.origin.clone(),
                access_scope: "project".to_owned(),
                content_digest: source.content_digest.clone(),
                media_type: source.media_type.clone(),
                byte_count: source.byte_count as u64,
                captured_at: captured_at.to_owned(),
                parser_identity: source
                    .parser_identity
                    .clone()
                    .unwrap_or_else(|| boreal_source::DEFAULT_PARSER_IDENTITY.to_owned()),
                availability: availability.to_owned(),
                citation_json: "[]".to_owned(),
                request_digest: request_digest.clone(),
            })?;
        Ok(SourceStoreRegistrationResult {
            operation: KnowledgeOperation {
                operation_id: operation.operation_id.clone(),
                request_digest,
                durability: KnowledgeDurability::SourceCatalog,
            },
            source: stored.source,
            revision: stored.mutation.revision,
            replayed: stored.mutation.replayed,
        })
    }

    pub fn show_source(
        &self,
        project_id: &str,
        source_version_id: &str,
    ) -> Result<SourceVersion, KnowledgeError> {
        require_project(project_id)?;
        self.source_catalog
            .show_version(project_id, source_version_id)
            .map_err(KnowledgeError::from)
    }

    pub fn list_sources(
        &self,
        project_id: Option<&str>,
    ) -> Result<Vec<SourceVersion>, KnowledgeError> {
        if let Some(project_id) = project_id {
            require_project(project_id)?;
        }
        self.source_catalog
            .list_versions(project_id)
            .map_err(KnowledgeError::from)
    }

    pub fn verify_source(
        &self,
        project_id: &str,
        source_version_id: &str,
    ) -> Result<SourceVerificationResult, KnowledgeError> {
        let source = self.show_source(project_id, source_version_id)?;
        let availability = self.source_catalog.availability(&source)?;
        if availability != Availability::Available {
            return Ok(SourceVerificationResult {
                verified_digest: None,
                byte_count: source.byte_count,
                source,
                availability,
            });
        }
        let bytes = self.source_catalog.verify(&source)?;
        Ok(SourceVerificationResult {
            verified_digest: Some(sha256_content_digest(&bytes)),
            byte_count: bytes.len(),
            source,
            availability,
        })
    }

    pub fn cite_source(
        &self,
        project_id: &str,
        source_version_id: &str,
        location: &str,
        excerpt: &[u8],
    ) -> Result<SourceCitationResult, KnowledgeError> {
        let source = self.show_source(project_id, source_version_id)?;
        let citation = self.source_catalog.cite(&source, location, excerpt)?;
        Ok(SourceCitationResult { source, citation })
    }

    pub fn search_sources(
        &self,
        request: SourceRetrievalRequest,
    ) -> Result<SourceRetrievalResponse, KnowledgeError> {
        require_project(&request.project_id)?;
        self.source_catalog
            .retrieve(&request)
            .map_err(KnowledgeError::from)
    }

    pub fn draft_memory(
        &self,
        input: MemoryDraftInput,
    ) -> Result<MemoryDraftResult, KnowledgeError> {
        require_operation(&input.operation_id)?;
        require_project(&input.project_id)?;
        let request_digest = canonical_request_digest(
            "memory.draft/v1",
            json!({
                "project_id": input.project_id,
                "entry_id": input.entry_id,
                "title": input.title,
                "body_digest": sha256_content_digest(input.body.as_bytes()),
                "citations": input.citations.iter().map(|citation| json!({
                    "source_version_id": citation.source_version_id,
                    "location": citation.location,
                })).collect::<Vec<_>>(),
            }),
        );
        let draft = Draft::new(
            &input.project_id,
            &input.entry_id,
            &input.title,
            &input.body,
            input.citations,
        )?;
        Ok(MemoryDraftResult {
            operation: KnowledgeOperation {
                operation_id: input.operation_id,
                request_digest,
                durability: KnowledgeDurability::InMemory,
            },
            provenance: KnowledgeProvenance {
                project_id: Some(draft.project_id.clone()),
                memory_entry_id: Some(draft.entry_id.clone()),
                content_digest: Some(sha256_content_digest(draft.body.as_bytes())),
                ..KnowledgeProvenance::default()
            },
            draft,
        })
    }

    pub fn review_memory(
        &self,
        draft: &MemoryDraftResult,
        input: MemoryReviewInput,
    ) -> Result<ReviewedMemory, KnowledgeError> {
        require_operation(&input.operation_id)?;
        if input.reviewer_id.trim().is_empty() {
            return Err(KnowledgeError::Invalid(
                "memory review requires a reviewer identity".to_owned(),
            ));
        }
        if !matches!(draft.draft.state, DraftState::Draft | DraftState::InReview) {
            return Err(KnowledgeError::Invalid(
                "only a draft or in-review memory entry can be reviewed".to_owned(),
            ));
        }
        let request_digest = canonical_request_digest(
            "memory.review/v1",
            json!({
                "draft_operation_id": draft.operation.operation_id,
                "entry_id": draft.draft.entry_id,
                "content_digest": draft.provenance.content_digest,
                "reviewer_id": input.reviewer_id,
                "accepted": input.accepted,
            }),
        );
        let reviewed = draft.draft.clone().review(input.accepted);
        Ok(ReviewedMemory {
            operation: KnowledgeOperation {
                operation_id: input.operation_id,
                request_digest,
                durability: KnowledgeDurability::InMemory,
            },
            provenance: draft.provenance.clone(),
            draft: reviewed,
            reviewer_id: input.reviewer_id,
            accepted: input.accepted,
        })
    }

    pub fn publish_memory(
        &self,
        publisher: &Publisher,
        reviewed: &ReviewedMemory,
        input: MemoryPublishInput,
    ) -> Result<MemoryPublicationResult, KnowledgeError> {
        require_operation(&input.operation_id)?;
        if !reviewed.accepted || reviewed.draft.state != DraftState::Accepted {
            return Err(KnowledgeError::Invalid(
                "only an accepted memory review may be published".to_owned(),
            ));
        }
        let receipt = publisher.publish_with_expected_base(
            &reviewed.draft,
            &input.operation_id,
            input.expected_manifest_identity.as_deref(),
        )?;
        let mut provenance = reviewed.provenance.clone();
        provenance.git_revision = Some(receipt.git_revision.clone());
        provenance.content_digest = Some(receipt.identity.content_digest.clone());
        Ok(MemoryPublicationResult {
            operation: KnowledgeOperation {
                operation_id: input.operation_id,
                request_digest: canonical_request_digest(
                    "memory.publish/v1",
                    json!({
                        "project_id": reviewed.draft.project_id,
                        "entry_id": reviewed.draft.entry_id,
                        "content_digest": receipt.identity.content_digest,
                        "expected_manifest_identity": input.expected_manifest_identity,
                        "review_operation_id": reviewed.operation.operation_id,
                    }),
                ),
                durability: KnowledgeDurability::GitCommit,
            },
            provenance,
            receipt,
        })
    }

    pub fn search_memory(
        &self,
        root: impl AsRef<Path>,
        input: MemorySearchInput,
    ) -> Result<MemorySearchResult, KnowledgeError> {
        require_project(&input.project_id)?;
        if input.limit == 0 {
            return Err(KnowledgeError::Invalid(
                "memory search limit must be greater than zero".to_owned(),
            ));
        }
        let index = rebuild_index(root, &input.project_id)?;
        let query = memory_query(&input)?;
        let response = index.search(&query)?;
        let request_digest = canonical_request_digest(
            "memory.search/v1",
            json!({
                "project_id": input.project_id,
                "text": input.text,
                "entry_id": input.entry_id,
                "source_version_id": input.source_version_id,
                "limit": input.limit,
                "max_excerpt_bytes": input.max_excerpt_bytes,
                "requested_git_revision": input.requested_git_revision,
            }),
        );
        Ok(MemorySearchResult {
            operation: KnowledgeOperation {
                operation_id: format!("search:{}", &request_digest["sha256:".len()..]),
                request_digest,
                durability: KnowledgeDurability::InMemory,
            },
            provenance: KnowledgeProvenance {
                project_id: Some(response.project_id.clone()),
                git_revision: Some(response.git_revision.clone()),
                ..KnowledgeProvenance::default()
            },
            response,
        })
    }

    pub fn rebuild_memory_index(
        &self,
        root: impl AsRef<Path>,
        project_id: &str,
    ) -> Result<MemoryIndex, KnowledgeError> {
        require_project(project_id)?;
        rebuild_index(root, project_id).map_err(KnowledgeError::from)
    }

    pub fn migration_dry_run(
        &self,
        operation_id: impl Into<String>,
        input: &str,
    ) -> Result<MigrationDryRunResult, KnowledgeError> {
        let operation_id = operation_id.into();
        require_operation(&operation_id)?;
        let source_digest = migration_content_digest(input.as_bytes());
        let (kind, source, ready, loss_ledger, project_id) =
            if input_contains_format(input, LEGACY_FORMAT) {
                let plan = import_legacy_json(input)?;
                let source = plan.provenance.clone();
                let ready = plan.is_ready();
                let loss_ledger = plan.report.loss_ledger();
                let project_id = plan
                    .report
                    .document
                    .as_ref()
                    .map(|document| document.project.id.clone());
                (
                    MigrationPlanKind::Legacy { plan },
                    source,
                    ready,
                    loss_ledger,
                    project_id,
                )
            } else {
                let report = import_json(input)?;
                let project_id = report
                    .document
                    .as_ref()
                    .map(|document| document.project.id.clone());
                let source = SourceProvenance {
                    source_format: FORMAT.to_owned(),
                    source_version: FORMAT_VERSION,
                    source_fingerprint: source_digest.clone(),
                    as_of_ms: None,
                };
                let ready = report.is_lossless() && report.document.is_some();
                let loss_ledger = report.loss_ledger();
                (
                    MigrationPlanKind::Current { report },
                    source,
                    ready,
                    loss_ledger,
                    project_id,
                )
            };
        let request_digest = canonical_request_digest(
            "migration.dry_run/v1",
            json!({
                "source_format": source.source_format,
                "source_version": source.source_version,
                "source_fingerprint": source.source_fingerprint,
            }),
        );
        Ok(MigrationDryRunResult {
            operation: KnowledgeOperation {
                operation_id,
                request_digest,
                durability: KnowledgeDurability::InMemory,
            },
            provenance: KnowledgeProvenance {
                project_id,
                migration_source_digest: Some(source_digest),
                ..KnowledgeProvenance::default()
            },
            source,
            kind,
            ready,
            loss_ledger,
        })
    }

    pub fn verify_migration(
        &self,
        dry_run: &MigrationDryRunResult,
    ) -> Result<MigrationVerificationResult, KnowledgeError> {
        let (document_fingerprint, counts) = match &dry_run.kind {
            MigrationPlanKind::Legacy { plan } if dry_run.ready => {
                let verified: ImportVerification = plan.verify()?;
                (verified.document_fingerprint, Some(verified.counts))
            }
            MigrationPlanKind::Current { report } if dry_run.ready => {
                let document = report.document.as_ref().ok_or_else(|| {
                    KnowledgeError::Invalid("ready migration has no document".to_owned())
                })?;
                let canonical = export_json(document).map_err(|error| {
                    KnowledgeError::Invalid(format!("migration export failed: {error}"))
                })?;
                let round_trip = import_json(&canonical)?;
                if round_trip.document.as_ref() != Some(document) || !round_trip.is_lossless() {
                    return Err(KnowledgeError::Invalid(
                        "migration document did not round-trip losslessly".to_owned(),
                    ));
                }
                (
                    Some(migration_content_digest(canonical.as_bytes())),
                    Some(document.counts()),
                )
            }
            _ => (None, None),
        };
        Ok(MigrationVerificationResult {
            operation: dry_run.operation.clone(),
            provenance: dry_run.provenance.clone(),
            source: dry_run.source.clone(),
            ready: dry_run.ready,
            document_fingerprint,
            counts,
            issue_count: dry_run.loss_ledger.len(),
            loss_ledger: dry_run.loss_ledger.clone(),
            unsupported_capabilities: vec![
                "live_store_materialization_requires_store_adapter".to_owned()
            ],
        })
    }

    pub fn apply_migration(
        &self,
        dry_run: &MigrationDryRunResult,
    ) -> Result<MigrationApplyResult, KnowledgeError> {
        let document = if !dry_run.ready {
            None
        } else {
            match &dry_run.kind {
                MigrationPlanKind::Legacy { plan } => Some(plan.apply()?),
                MigrationPlanKind::Current { report } => report.document.clone(),
            }
        };
        Ok(MigrationApplyResult {
            operation: KnowledgeOperation {
                operation_id: dry_run.operation.operation_id.clone(),
                request_digest: dry_run.operation.request_digest.clone(),
                durability: if document.is_some() {
                    KnowledgeDurability::StagedOnly
                } else {
                    KnowledgeDurability::InMemory
                },
            },
            provenance: dry_run.provenance.clone(),
            source: dry_run.source.clone(),
            state: if document.is_some() {
                MigrationApplyState::StagedOnly
            } else {
                MigrationApplyState::RequiresReview
            },
            document,
            loss_ledger: dry_run.loss_ledger.clone(),
            unsupported_capabilities: vec![
                "live_store_materialization_requires_store_adapter".to_owned()
            ],
        })
    }
}

fn memory_query(input: &MemorySearchInput) -> Result<RetrievalQuery, KnowledgeError> {
    let mut query = RetrievalQuery::new(&input.project_id)?
        .with_limit(input.limit)
        .with_max_excerpt_bytes(input.max_excerpt_bytes);
    if let Some(text) = input.text.as_deref() {
        query = query.with_text(text);
    }
    if let Some(entry_id) = input.entry_id.as_deref() {
        query = query.with_entry_id(entry_id)?;
    }
    if let Some(source_version_id) = input.source_version_id.as_deref() {
        query = query.with_source_version(source_version_id);
    }
    if let Some(revision) = input.requested_git_revision.as_deref() {
        query = query.at_git_revision(revision);
    }
    Ok(query)
}

fn require_operation(operation_id: &str) -> Result<(), KnowledgeError> {
    if operation_id.trim().is_empty() {
        return Err(KnowledgeError::Invalid(
            "knowledge operation_id cannot be empty".to_owned(),
        ));
    }
    Ok(())
}

fn require_project(project_id: &str) -> Result<(), KnowledgeError> {
    if project_id.trim().is_empty() || project_id.chars().any(char::is_whitespace) {
        return Err(KnowledgeError::Invalid(
            "knowledge project_id is empty or contains whitespace".to_owned(),
        ));
    }
    Ok(())
}

fn input_contains_format(input: &str, format: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(input)
        .ok()
        .and_then(|value| {
            value
                .get("format")
                .and_then(serde_json::Value::as_str)
                .map(str::to_owned)
        })
        .is_some_and(|value| value == format)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_empty_operation_and_project_ids() {
        assert!(matches!(
            require_operation(" "),
            Err(KnowledgeError::Invalid(_))
        ));
        assert!(matches!(
            require_project("project id"),
            Err(KnowledgeError::Invalid(_))
        ));
    }

    #[test]
    fn current_migration_format_is_detected_without_heuristic_loss() {
        let input = serde_json::json!({"format": FORMAT, "version": FORMAT_VERSION});
        assert!(!input_contains_format(&input.to_string(), LEGACY_FORMAT));
    }
}
