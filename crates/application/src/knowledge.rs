//! Application-owned adapters for source, memory, and migration workflows.
//!
//! The lower-level crates intentionally do not know about the application
//! operation protocol. This module supplies that boundary without making the
//! CLI, TUI, or a library crate into a second authority:
//!
//! * source capture uses the source catalog's durable operation record;
//! * memory publication uses the Git manifest and expected-base identity;
//! * migration preserves the original import as an immutable source, then
//!   applies safe draft/open work and closed-only dependency rows through one
//!   store-owned transaction. Historical attempts and proof remain archived
//!   and do not gain v2 authority.
//!
//! Every result carries a request digest and provenance. A caller can persist
//! that envelope in its operation table and safely reconcile a lost response.
//! This module deliberately performs no direct SQL.

use std::{collections::BTreeSet, fmt, path::Path};

use boreal_memory::{
    rebuild_index, Citation as MemoryCitation, Draft, DraftState, IndexError, MemoryError,
    MemoryIndex, PublicationJobAcquisition, PublicationJobOutcome, PublicationJobPort,
    PublicationJobReadback, PublicationJobRecord, PublicationJobRequest, PublicationJobState,
    PublicationReceipt, PublicationState, PublishError, Publisher, RetrievalQuery,
    RetrievalResponse,
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
use serde_json::{json, Value};

use boreal_store::{
    identity::IdentityContext,
    jobs::{ExternalJobInput, ExternalJobRecord},
    SourceVersionRecord, SourceVersionRegistrationInput, SourceVersionRegistrationResult,
    SqliteStore,
};

use crate::{
    canonical_request_digest, sha256_content_digest, ExternalEffectAcquisition,
    ExternalEffectAdapter, ExternalEffectReadback, ExternalEffectRequest, ExternalEffectResolution,
    ExternalJobKind,
};

/// A stable description of how far a knowledge operation reached.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum KnowledgeDurability {
    /// The source catalog recorded the operation and immutable version.
    SourceCatalog,
    /// A reviewed memory entry was committed to the managed Git repository.
    GitCommit,
    /// The immutable draft/review or publication admission is persisted in SQLite.
    CanonicalStore,
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
    pub actor_id: String,
    pub session_id: Option<String>,
    pub deadline: Option<String>,
    pub created_at: String,
    pub started_at: String,
    pub observed_at: String,
    pub source_identity: Option<String>,
    pub config_identity: Option<String>,
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
    pub state: MemoryPublicationState,
    pub job: PublicationJobRecord,
    pub receipt: Option<PublicationReceipt>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MemoryPublicationState {
    Pending,
    ReadbackRequired,
    Reconciled,
    Rejected,
    Failed,
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
    /// The safe work graph was applied atomically and the raw import remains
    /// available as a registered immutable project source.
    Applied,
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
    pub source_version_id: Option<String>,
    pub revision: Option<u64>,
    pub replayed: bool,
    pub imported_work_count: usize,
    pub imported_dependency_count: usize,
    pub drafted_terminal_work_ids: Vec<String>,
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
        self.register_captured_source_inner(store, source, operation, actor_id, captured_at, None)
    }

    pub fn register_captured_source_at_revision(
        &self,
        store: &SqliteStore,
        source: &SourceVersion,
        operation: &KnowledgeOperation,
        actor_id: &str,
        captured_at: &str,
        expected_revision: u64,
    ) -> Result<SourceStoreRegistrationResult, KnowledgeError> {
        self.register_captured_source_inner(
            store,
            source,
            operation,
            actor_id,
            captured_at,
            Some(expected_revision),
        )
    }

    fn register_captured_source_inner(
        &self,
        store: &SqliteStore,
        source: &SourceVersion,
        operation: &KnowledgeOperation,
        actor_id: &str,
        captured_at: &str,
        expected_revision: Option<u64>,
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
        let registration_input = SourceVersionRegistrationInput {
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
            };
        let stored: SourceVersionRegistrationResult = match expected_revision {
            Some(expected) => store
                .register_source_version_at_revision(&registration_input, expected)?,
            None => store.register_source_version(&registration_input)?,
        };
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
        store: &SqliteStore,
        identity: &IdentityContext,
        publisher: &Publisher,
        reviewed: &ReviewedMemory,
        input: MemoryPublishInput,
    ) -> Result<MemoryPublicationResult, KnowledgeError> {
        require_operation(&input.operation_id)?;
        if identity.project_id != reviewed.draft.project_id {
            return Err(KnowledgeError::Invalid(
                "memory publication identity does not match the reviewed project".to_owned(),
            ));
        }
        if !reviewed.accepted || reviewed.draft.state != DraftState::Accepted {
            return Err(KnowledgeError::Invalid(
                "only an accepted memory review may be published".to_owned(),
            ));
        }
        let mut expected_identity =
            publisher.publication_request_identity(&reviewed.draft, &input.operation_id)?;
        if let Some((manifest, content)) =
            store.memory_publication_plan(&identity.project_id, &input.operation_id)?
        {
            expected_identity.manifest_identity = manifest;
            expected_identity.content_digest = content;
        }
        if store.is_canonical_production() {
            let (stored, decision) = store
                .approved_memory_draft(&identity.project_id, &reviewed.operation.operation_id)?;
            if stored.entry_id != reviewed.draft.entry_id
                || stored.title != reviewed.draft.title
                || stored.body != reviewed.draft.body
                || decision.actor_id != reviewed.reviewer_id
                || stored.citations_json != citations_json(&reviewed.draft.citations).to_string()
            {
                return Err(KnowledgeError::Invalid(
                    "supplied memory result differs from durable reviewed content".into(),
                ));
            }
            store.validate_memory_publication_binding(
                &identity.project_id,
                &input.operation_id,
                &reviewed.operation.operation_id,
                &publisher.root().path().to_string_lossy(),
                input.expected_manifest_identity.as_deref(),
            )?;
        }
        let memory_root_identity = publisher.root().path().to_string_lossy().into_owned();
        let source_identity = input.source_identity.clone().or_else(|| {
            reviewed
                .provenance
                .source_version_id
                .clone()
                .or_else(|| reviewed.provenance.source_digest.clone())
        });
        let request_digest = canonical_request_digest(
            "memory.publish/v2",
            json!({
                "project_id": reviewed.draft.project_id,
                "entry_id": reviewed.draft.entry_id,
                "content_digest": expected_identity.content_digest,
                "manifest_identity": expected_identity.manifest_identity,
                "memory_root_identity": memory_root_identity,
                "expected_manifest_identity": input.expected_manifest_identity,
                "review_operation_id": reviewed.operation.operation_id,
                "expected_revision": store.operation(&input.operation_id)?.and_then(|operation|operation.expected_revision),
                "actor_id": input.actor_id,
                "session_id": input.session_id,
                "deadline": input.deadline,
                "source_identity": source_identity,
                "config_identity": input.config_identity,
            }),
        );
        let request = PublicationJobRequest {
            project_id: reviewed.draft.project_id.clone(),
            operation_id: input.operation_id.clone(),
            request_digest: request_digest.clone(),
            entry_id: reviewed.draft.entry_id.clone(),
            content_digest: expected_identity.content_digest.clone(),
            manifest_identity: expected_identity.manifest_identity.clone(),
            memory_root_identity,
            actor_id: input.actor_id.clone(),
            session_id: input.session_id.clone(),
            source_identity,
            config_identity: input.config_identity.clone(),
            deadline: input.deadline.clone(),
            created_at: input.created_at.clone(),
        };
        let duplicate = store
            .external_job_by_operation_with_identity(identity, &input.operation_id)?
            .is_some();
        let jobs = StorePublicationJobPort::new(store, identity, input.observed_at.clone());
        let outcome = publisher
            .publish_with_durable_job(
                &jobs,
                &request,
                &input.started_at,
                &input.observed_at,
                &reviewed.draft,
                input.expected_manifest_identity.as_deref(),
            )
            .map_err(KnowledgeError::Invalid)?;
        let job = outcome.record().clone();
        let mut provenance = reviewed.provenance.clone();
        provenance.content_digest = Some(request.content_digest.clone());
        if let Some(git_revision) = job.git_revision.clone() {
            provenance.git_revision = Some(git_revision);
        }
        let (state, receipt) = match outcome {
            PublicationJobOutcome::Reconciled(record) => {
                let git_revision = record.git_revision.clone().ok_or_else(|| {
                    KnowledgeError::Invalid(
                        "reconciled memory publication has no Git revision".to_owned(),
                    )
                })?;
                let receipt = PublicationReceipt {
                    state: PublicationState::Published,
                    identity: boreal_memory::PublicationIdentity {
                        project_id: request.project_id.clone(),
                        entry_id: request.entry_id.clone(),
                        content_digest: request.content_digest.clone(),
                        operation_id: request.operation_id.clone(),
                        manifest_identity: request.manifest_identity.clone(),
                    },
                    git_revision,
                    duplicate,
                };
                (MemoryPublicationState::Reconciled, Some(receipt))
            }
            PublicationJobOutcome::Pending(_) => (MemoryPublicationState::Pending, None),
            PublicationJobOutcome::ReadbackRequired(_) => {
                (MemoryPublicationState::ReadbackRequired, None)
            }
            PublicationJobOutcome::Rejected(_) => (MemoryPublicationState::Rejected, None),
            PublicationJobOutcome::Failed(_) => (MemoryPublicationState::Failed, None),
        };
        Ok(MemoryPublicationResult {
            operation: KnowledgeOperation {
                operation_id: input.operation_id,
                request_digest,
                durability: if state == MemoryPublicationState::Reconciled {
                    KnowledgeDurability::GitCommit
                } else {
                    KnowledgeDurability::InMemory
                },
            },
            provenance,
            state,
            job,
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
            source_version_id: None,
            revision: None,
            replayed: false,
            imported_work_count: 0,
            imported_dependency_count: 0,
            drafted_terminal_work_ids: Vec::new(),
            unsupported_capabilities: vec![
                "live_store_materialization_requires_store_adapter".to_owned()
            ],
        })
    }

    /// Captures a source migration document, then atomically imports its safe
    /// work graph into the selected project. Historical attempts, evidence,
    /// and terminal outcomes remain in the immutable source document and are
    /// never promoted into accepted v2 proof.
    pub fn apply_migration_to_store(
        &self,
        store: &SqliteStore,
        project_id: &str,
        actor_id: &str,
        operation_id: &str,
        expected_project_revision: u64,
        input: &str,
        now: &str,
    ) -> Result<MigrationApplyResult, KnowledgeError> {
        require_project(project_id)?;
        require_operation(operation_id)?;
        if actor_id.trim().is_empty() || now.trim().is_empty() {
            return Err(KnowledgeError::Invalid(
                "migration apply requires actor and timestamp".to_owned(),
            ));
        }
        let (role, _) = store
            .principal_authority(project_id, actor_id)
            .map_err(KnowledgeError::Store)?;
        if role != boreal_domain::ActorRole::Operator {
            return Err(KnowledgeError::Invalid(
                "migration apply requires project operator authority".to_owned(),
            ));
        }

        let dry_run = self.migration_dry_run(format!("{operation_id}:plan"), input)?;
        if !dry_run.ready {
            return Ok(self.apply_migration(&dry_run)?);
        }
        let mut document = match &dry_run.kind {
            MigrationPlanKind::Legacy { plan } => plan.apply().map_err(|error| {
                KnowledgeError::Invalid(format!("legacy migration materialization failed: {error}"))
            })?,
            MigrationPlanKind::Current { report } => report.document.clone().ok_or_else(|| {
                KnowledgeError::Invalid("ready migration has no document".to_owned())
            })?,
        };
        document = document.canonicalized();
        document.validate().map_err(|error| {
            KnowledgeError::Invalid(format!("migration document is invalid: {error}"))
        })?;
        if document.project.id != project_id {
            return Err(KnowledgeError::Invalid(
                "migration source project must match the selected project".to_owned(),
            ));
        }
        let verification = self.verify_migration(&dry_run)?;
        if !verification.ready || verification.document_fingerprint.is_none() {
            return Err(KnowledgeError::Invalid(
                "migration verification did not produce a durable document identity".to_owned(),
            ));
        }

        let existing_operation = store.operation(operation_id).map_err(KnowledgeError::Store)?;
        if existing_operation.as_ref().is_some_and(|operation| {
            operation.command != "migration.apply"
                || operation.project_id != project_id
                || operation.actor_id != actor_id
        }) {
            return Err(KnowledgeError::Invalid(
                "migration operation ID is already bound to another command or project".into(),
            ));
        }
        let capture_operation_id = format!("{operation_id}:source");
        let existing_capture_operation = store
            .operation(&capture_operation_id)
            .map_err(KnowledgeError::Store)?;
        if existing_capture_operation.as_ref().is_some_and(|operation| {
            operation.command != "source.register"
                || operation.project_id != project_id
                || operation.actor_id != actor_id
        }) {
            return Err(KnowledgeError::Invalid(
                "migration source operation ID is already bound to another request".into(),
            ));
        }
        let revision_before_capture = store
            .project_revision(project_id)
            .map_err(KnowledgeError::Store)?
            .0;
        let expected_before_capture = if existing_operation.is_none() {
            existing_capture_operation
                .as_ref()
                .map(|operation| operation.revision)
                .unwrap_or(expected_project_revision)
        } else {
            revision_before_capture
        };
        if existing_operation.is_none() && revision_before_capture != expected_before_capture {
            return Err(KnowledgeError::Store(boreal_store::StoreError::StaleRevision {
                expected: expected_before_capture,
                actual: revision_before_capture,
            }));
        }
        let capture = self.capture_source(SourceCaptureInput {
            operation_id: capture_operation_id,
            project_id: project_id.to_owned(),
            origin: format!("legacy-migration:{}", dry_run.source.source_format),
            media_type: "application/json".to_owned(),
            bytes: input.as_bytes().to_vec(),
        })?;
        let captured_at = store
            .source_version(project_id, &capture.source.source_version_id)
            .map_err(KnowledgeError::Store)?
            .map_or_else(|| now.to_owned(), |source| source.captured_at);
        let source_registration = self.register_captured_source(
            store,
            &capture.source,
            &capture.operation,
            actor_id,
            &captured_at,
        )?;

        let source_operation = store
            .operation(&capture.operation.operation_id)
            .map_err(KnowledgeError::Store)?
            .ok_or_else(|| {
                KnowledgeError::Invalid(
                    "migration source registration has no operation readback".to_owned(),
                )
            })?;
        let expected_revision = if let Some(revision) = existing_operation
            .as_ref()
            .and_then(|operation| operation.expected_revision)
        {
            revision
        } else if existing_capture_operation.is_some() {
            source_operation.revision
        } else {
            let expected_after_source = expected_before_capture
                .checked_add(u64::from(
                    source_operation.outcome == boreal_store::OperationOutcome::Changed,
                ))
                .ok_or_else(|| {
                    KnowledgeError::Invalid("project revision overflow during migration".into())
                })?;
            if source_registration.revision != expected_after_source {
                return Err(KnowledgeError::Store(boreal_store::StoreError::StaleRevision {
                    expected: expected_after_source,
                    actual: source_registration.revision,
                }));
            }
            expected_after_source
        };

        let mut drafted_terminal_work_ids = Vec::new();
        let mut work_items = document
            .work
            .iter()
            .map(|record| {
                use boreal_domain::{PersistedLifecycle, WorkKind as DomainWorkKind};
                let kind = match record.kind {
                    boreal_migration::WorkKind::Milestone => DomainWorkKind::Milestone,
                    boreal_migration::WorkKind::Sprint => DomainWorkKind::Sprint,
                    boreal_migration::WorkKind::Task => DomainWorkKind::Task,
                };
                let lifecycle = match record.lifecycle {
                    boreal_migration::Lifecycle::Draft => PersistedLifecycle::Draft,
                    boreal_migration::Lifecycle::Open => PersistedLifecycle::Open,
                    boreal_migration::Lifecycle::Closed
                    | boreal_migration::Lifecycle::Cancelled => {
                        drafted_terminal_work_ids.push(record.id.clone());
                        PersistedLifecycle::Draft
                    }
                };
                let mut work = boreal_domain::WorkItem::new(
                    boreal_domain::ProjectId::new(project_id),
                    boreal_domain::WorkId::new(record.id.clone()),
                    kind,
                    record
                        .parent_id
                        .as_ref()
                        .map(|parent| boreal_domain::WorkId::new(parent.clone())),
                    record.title.clone(),
                );
                work.description = record.description.clone();
                work.lifecycle = lifecycle;
                Ok::<_, KnowledgeError>(work)
            })
            .collect::<Result<Vec<_>, _>>()?;
        work_items = order_imported_work(work_items)?;
        let dependencies = document
            .dependencies
            .iter()
            .map(|dependency| {
                (dependency.from_work_id.clone(), dependency.to_work_id.clone())
            })
            .collect::<Vec<_>>();
        let request_digest = canonical_request_digest(
            "migration.apply/v1",
            json!({
                "project_id": project_id,
                "actor_id": actor_id,
                "source_version_id": capture.source.source_version_id,
                "source_document_fingerprint": verification.document_fingerprint,
                "expected_project_revision": expected_revision,
                "client_expected_project_revision": expected_project_revision,
                "work_ids": work_items.iter().map(|work| work.id.as_str()).collect::<Vec<_>>(),
                "dependencies": dependencies,
                "drafted_terminal_work_ids": drafted_terminal_work_ids,
            }),
        );
        let mutation = store
            .apply_migration_work_graph(&boreal_store::MigrationWorkImportInput {
                project_id: project_id.to_owned(),
                actor_id: actor_id.to_owned(),
                operation_id: operation_id.to_owned(),
                request_digest: request_digest.clone(),
                expected_project_revision: expected_revision,
                source_version_id: capture.source.source_version_id.clone(),
                work_items,
                dependencies: dependencies.clone(),
                created_at: now.to_owned(),
            })
            .map_err(KnowledgeError::Store)?;
        Ok(MigrationApplyResult {
            operation: KnowledgeOperation {
                operation_id: operation_id.to_owned(),
                request_digest,
                durability: KnowledgeDurability::CanonicalStore,
            },
            provenance: KnowledgeProvenance {
                project_id: Some(project_id.to_owned()),
                migration_source_digest: Some(dry_run.source.source_fingerprint.clone()),
                ..KnowledgeProvenance::default()
            },
            source: dry_run.source,
            state: MigrationApplyState::Applied,
            document: Some(document.clone()),
            loss_ledger: dry_run.loss_ledger,
            source_version_id: Some(capture.source.source_version_id),
            revision: Some(mutation.revision),
            replayed: mutation.replayed,
            imported_work_count: document.work.len(),
            imported_dependency_count: dependencies.len(),
            drafted_terminal_work_ids,
            unsupported_capabilities: vec![
                "historical attempts, receipts, reviews, and summaries remain archived as source and are not active v2 evidence".to_owned(),
            ],
        })
    }
}

/// Store-backed implementation of the memory crate's publication port.
///
/// The memory crate owns the Git callback, while this adapter owns the
/// identity-bound durable admission/readback record.  Keeping this bridge in
/// the application crate prevents a publication caller from selecting the
/// legacy store API or invoking Git before the external job is admitted.
struct StorePublicationJobPort<'a> {
    store: &'a SqliteStore,
    identity: &'a IdentityContext,
    adapter: ExternalEffectAdapter<'a>,
    observed_at: String,
}

impl<'a> StorePublicationJobPort<'a> {
    fn new(store: &'a SqliteStore, identity: &'a IdentityContext, observed_at: String) -> Self {
        Self {
            store,
            identity,
            adapter: ExternalEffectAdapter::new_with_identity(store, identity),
            observed_at,
        }
    }

    fn external_request(request: &PublicationJobRequest) -> ExternalEffectRequest {
        ExternalEffectRequest {
            job_id: request.operation_id.clone(),
            operation_id: request.operation_id.clone(),
            project_id: request.project_id.clone(),
            subject_type: "project".to_owned(),
            subject_id: request.project_id.clone(),
            kind: ExternalJobKind::MemoryPublication.as_str().to_owned(),
            request_digest: request.request_digest.clone(),
            source_identity: request.source_identity.clone(),
            config_identity: request.config_identity.clone(),
            actor_id: request.actor_id.clone(),
            session_id: request.session_id.clone(),
            deadline: request.deadline.clone(),
            created_at: request.created_at.clone(),
        }
    }

    fn store_input(request: &PublicationJobRequest) -> ExternalJobInput {
        let external = Self::external_request(request);
        ExternalJobInput {
            job_id: external.job_id,
            operation_id: external.operation_id,
            project_id: external.project_id,
            subject_type: external.subject_type,
            subject_id: external.subject_id,
            kind: external.kind,
            request_digest: external.request_digest,
            source_identity: external.source_identity,
            config_identity: external.config_identity,
            actor_id: external.actor_id,
            session_id: external.session_id,
            deadline: external.deadline,
            created_at: external.created_at,
        }
    }

    fn record(
        &self,
        request: &PublicationJobRequest,
        record: &ExternalJobRecord,
    ) -> Result<PublicationJobRecord, String> {
        let external = Self::external_request(request);
        if record.job_id != external.job_id
            || record.operation_id != external.operation_id
            || record.project_id != external.project_id
            || record.subject_type != external.subject_type
            || record.subject_id != external.subject_id
            || record.kind != external.kind
            || record.request_digest != external.request_digest
            || record.source_identity != external.source_identity
            || record.config_identity != external.config_identity
            || record.actor_id != external.actor_id
            || record.session_id != external.session_id
            || record.deadline != external.deadline
        {
            return Err(
                "memory publication external-job identity does not match the request".to_owned(),
            );
        }
        let state = match record.stage.as_str() {
            "registered" => PublicationJobState::Registered,
            "admitted" => PublicationJobState::Admitted,
            "running" => PublicationJobState::Running,
            "side_effect_started" => PublicationJobState::SideEffectStarted,
            "side_effect_finished" => PublicationJobState::SideEffectFinished,
            "readback_required" => PublicationJobState::ReadbackRequired,
            "committed" => PublicationJobState::Committed,
            "reconciled" => PublicationJobState::Reconciled,
            "rejected" => PublicationJobState::Rejected,
            "failed" => PublicationJobState::Failed,
            "cancel_requested" => PublicationJobState::CancelRequested,
            other => return Err(format!("unsupported memory publication job stage: {other}")),
        };
        let git_revision = record
            .side_effect_ref
            .as_deref()
            .and_then(|reference| reference.strip_prefix("git:"))
            .map(str::to_owned);
        Ok(PublicationJobRecord {
            project_id: request.project_id.clone(),
            operation_id: request.operation_id.clone(),
            request_digest: request.request_digest.clone(),
            entry_id: request.entry_id.clone(),
            content_digest: request.content_digest.clone(),
            manifest_identity: request.manifest_identity.clone(),
            memory_root_identity: request.memory_root_identity.clone(),
            state,
            side_effect_ref: record.side_effect_ref.clone(),
            git_revision,
            result_digest: record.result_digest.clone(),
            error: record.error_message.clone(),
        })
    }

    fn resolution_record(
        &self,
        request: &PublicationJobRequest,
        resolution: &ExternalEffectResolution,
    ) -> Result<PublicationJobRecord, String> {
        self.record(request, resolution.record())
    }

    fn store_error(error: boreal_store::StoreError) -> String {
        error.to_string()
    }
}

impl PublicationJobPort for StorePublicationJobPort<'_> {
    fn register(&self, request: &PublicationJobRequest) -> Result<PublicationJobRecord, String> {
        let registration = self
            .store
            .register_external_job_with_identity(self.identity, &Self::store_input(request))
            .map_err(Self::store_error)?;
        let record = self.record(request, &registration.job)?;
        if record.state == PublicationJobState::Registered {
            self.adapter
                .admit(&Self::external_request(request))
                .map_err(Self::store_error)?;
        }
        Ok(record)
    }

    fn acquire(
        &self,
        request: &PublicationJobRequest,
        started_at: &str,
    ) -> Result<PublicationJobAcquisition, String> {
        match self
            .adapter
            .start_acquisition(&request.project_id, &request.operation_id, started_at)
            .map_err(Self::store_error)?
        {
            ExternalEffectAcquisition::Won(record) => Ok(PublicationJobAcquisition::Won(
                self.record(request, &record)?,
            )),
            ExternalEffectAcquisition::AlreadyRunning(record) => Ok(
                PublicationJobAcquisition::AlreadyRunning(self.record(request, &record)?),
            ),
            ExternalEffectAcquisition::Pending(record) => Ok(PublicationJobAcquisition::Pending(
                self.record(request, &record)?,
            )),
            ExternalEffectAcquisition::Terminal(resolution) => Ok(
                PublicationJobAcquisition::Terminal(self.resolution_record(request, &resolution)?),
            ),
            ExternalEffectAcquisition::Conflict { current, reason } => {
                Ok(PublicationJobAcquisition::Conflict {
                    current: current
                        .as_ref()
                        .map(|record| self.record(request, record))
                        .transpose()?,
                    reason,
                })
            }
        }
    }

    fn mark_readback_required(
        &self,
        request: &PublicationJobRequest,
        side_effect_ref: &str,
    ) -> Result<PublicationJobRecord, String> {
        self.adapter
            .mark_side_effect_started(
                &request.project_id,
                &request.operation_id,
                side_effect_ref,
                &self.observed_at,
            )
            .map_err(Self::store_error)?;
        let resolution = self
            .adapter
            .mark_readback_required(
                &request.project_id,
                &request.operation_id,
                side_effect_ref,
                &self.observed_at,
            )
            .map_err(Self::store_error)?;
        self.resolution_record(request, &resolution)
    }

    fn readback(&self, request: &PublicationJobRequest) -> Result<PublicationJobRecord, String> {
        let resolution = self
            .adapter
            .readback(
                &request.project_id,
                &request.operation_id,
                &request.request_digest,
            )
            .map_err(Self::store_error)?;
        self.resolution_record(request, &resolution)
    }

    fn reconcile(
        &self,
        request: &PublicationJobRequest,
        readback: &PublicationJobReadback,
    ) -> Result<PublicationJobRecord, String> {
        self.adapter
            .mark_side_effect_started(
                &request.project_id,
                &request.operation_id,
                &readback.side_effect_ref,
                &readback.observed_at,
            )
            .map_err(Self::store_error)?;
        self.adapter
            .mark_readback_required(
                &request.project_id,
                &request.operation_id,
                &readback.side_effect_ref,
                &readback.observed_at,
            )
            .map_err(Self::store_error)?;
        let resolution = self
            .adapter
            .reconcile_readback(&ExternalEffectReadback {
                project_id: readback.project_id.clone(),
                job_id: request.operation_id.clone(),
                operation_id: readback.operation_id.clone(),
                request_digest: readback.request_digest.clone(),
                side_effect_ref: readback.side_effect_ref.clone(),
                result_digest: readback.result_digest.clone(),
                observed_at: readback.observed_at.clone(),
            })
            .map_err(Self::store_error)?;
        self.resolution_record(request, &resolution)
    }

    fn reject(
        &self,
        request: &PublicationJobRequest,
        reason: &str,
    ) -> Result<PublicationJobRecord, String> {
        let resolution = self
            .adapter
            .reject(
                &request.project_id,
                &request.operation_id,
                &self.observed_at,
                reason,
            )
            .map_err(Self::store_error)?;
        self.resolution_record(request, &resolution)
    }

    fn fail(
        &self,
        request: &PublicationJobRequest,
        side_effect_ref: Option<&str>,
        reason: &str,
    ) -> Result<PublicationJobRecord, String> {
        if let Some(side_effect_ref) = side_effect_ref {
            self.adapter
                .mark_side_effect_started(
                    &request.project_id,
                    &request.operation_id,
                    side_effect_ref,
                    &self.observed_at,
                )
                .map_err(Self::store_error)?;
        }
        let resolution = self
            .adapter
            .fail(
                &request.project_id,
                &request.operation_id,
                &self.observed_at,
                reason,
            )
            .map_err(Self::store_error)?;
        self.resolution_record(request, &resolution)
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

fn order_imported_work(
    mut pending: Vec<boreal_domain::WorkItem>,
) -> Result<Vec<boreal_domain::WorkItem>, KnowledgeError> {
    let mut ordered = Vec::with_capacity(pending.len());
    let mut created = BTreeSet::new();
    while !pending.is_empty() {
        let mut deferred = Vec::new();
        let mut made_progress = false;
        for work in pending {
            let parent_ready = work
                .parent_id
                .as_ref()
                .is_none_or(|parent| created.contains(parent.as_str()));
            if parent_ready {
                created.insert(work.id.as_str().to_owned());
                ordered.push(work);
                made_progress = true;
            } else {
                deferred.push(work);
            }
        }
        if !made_progress {
            return Err(KnowledgeError::Invalid(
                "migration work hierarchy has no resolvable parent order".to_owned(),
            ));
        }
        pending = deferred;
    }
    Ok(ordered)
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

fn citations_json(citations: &[boreal_memory::Citation]) -> Value {
    json!(citations
        .iter()
        .map(|c| json!({"source_version_id":c.source_version_id,"location":c.location}))
        .collect::<Vec<_>>())
}
fn stored_draft(record: &boreal_store::memory::MemoryDraftRecord) -> Result<Draft, KnowledgeError> {
    let values: Value = serde_json::from_str(&record.citations_json)
        .map_err(|e| KnowledgeError::Invalid(e.to_string()))?;
    let digest=sha256_content_digest(json!({"draft_id":record.draft_id,"entry_id":record.entry_id,"title":record.title,"body":record.body,"citations":values}).to_string().as_bytes());
    if digest != record.content_digest {
        return Err(KnowledgeError::Invalid(
            "stored memory content digest differs".into(),
        ));
    }

    let values = values
        .as_array()
        .ok_or_else(|| KnowledgeError::Invalid("stored citations are not an array".into()))?;
    let citations = values
        .iter()
        .map(|value| {
            Ok(boreal_memory::Citation {
                source_version_id: value
                    .get("source_version_id")
                    .and_then(Value::as_str)
                    .ok_or_else(|| KnowledgeError::Invalid("citation source missing".into()))?
                    .into(),
                location: value
                    .get("location")
                    .and_then(Value::as_str)
                    .ok_or_else(|| KnowledgeError::Invalid("citation location missing".into()))?
                    .into(),
            })
        })
        .collect::<Result<Vec<_>, KnowledgeError>>()?;
    Ok(Draft::new(
        &record.project_id,
        &record.entry_id,
        &record.title,
        &record.body,
        citations,
    )?)
}
impl KnowledgeApplication<'_> {
    pub fn persist_memory_draft(
        &self,
        store: &SqliteStore,
        context: &boreal_store::V3MutationContext,
        draft_id: &str,
        input: MemoryDraftInput,
    ) -> Result<boreal_store::MutationResult, KnowledgeError> {
        if input.project_id != context.project_id || input.operation_id != context.operation_id {
            return Err(KnowledgeError::Invalid(
                "memory draft context mismatch".into(),
            ));
        }
        let draft = self.draft_memory(input)?.draft;
        for citation in &draft.citations {
            let verification =
                self.verify_source(&draft.project_id, &citation.source_version_id)?;
            if verification.verified_digest.is_none() {
                return Err(KnowledgeError::Invalid(
                    "citation source bytes are unavailable or damaged".into(),
                ));
            }
        }
        let citations = citations_json(&draft.citations);
        let content_digest=sha256_content_digest(json!({"draft_id":draft_id,"entry_id":draft.entry_id,"title":draft.title,"body":draft.body,"citations":citations}).to_string().as_bytes());
        Ok(store.record_memory_draft(
            context,
            &boreal_store::memory::MemoryDraftRecord {
                project_id: context.project_id.clone(),
                draft_id: draft_id.into(),
                entry_id: draft.entry_id,
                title: draft.title,
                body: draft.body,
                citations_json: citations.to_string(),
                content_digest,
                actor_id: context.actor_id.clone(),
                project_revision: 0,
            },
        )?)
    }
    pub fn publish_durable_memory(
        &self,
        store: &SqliteStore,
        identity: &IdentityContext,
        context: &boreal_store::V3MutationContext,
        root: impl AsRef<Path>,
        review_id: &str,
        expected_manifest: &str,
    ) -> Result<MemoryPublicationResult, KnowledgeError> {
        let (record, review) = store.approved_memory_draft(&identity.project_id, review_id)?;
        let draft = stored_draft(&record)?.review(true);
        for citation in &draft.citations {
            if self
                .verify_source(&draft.project_id, &citation.source_version_id)?
                .verified_digest
                .is_none()
            {
                return Err(KnowledgeError::Invalid(
                    "publication source verification failed".into(),
                ));
            }
        }
        let root = boreal_memory::MemoryRoot::new(root.as_ref())?;
        let binding = boreal_store::identity::IdentityStore::new(store)
            .workspace_binding(&identity.project_id)
            .map_err(|e| KnowledgeError::Invalid(e.to_string()))?;
        if !root.path().starts_with(binding.canonical_root()) {
            return Err(KnowledgeError::Invalid(
                "publication root escaped its workspace".into(),
            ));
        }
        let publisher = Publisher::deferred(root);
        let mut planned = publisher.publication_request_identity(&draft, &context.operation_id)?;
        if let Some((manifest, content)) =
            store.memory_publication_plan(&identity.project_id, &context.operation_id)?
        {
            planned.manifest_identity = manifest;
            planned.content_digest = content;
        }
        let memory_root = publisher.root().path().to_string_lossy().into_owned();
        let source_identity = None::<String>;
        let config_identity = None::<String>;
        let digest = canonical_request_digest(
            "memory.publish/v2",
            json!({
            "project_id":identity.project_id,"entry_id":draft.entry_id,"content_digest":planned.content_digest,
            "manifest_identity":planned.manifest_identity,"memory_root_identity":memory_root,
            "expected_manifest_identity":expected_manifest,"review_operation_id":review_id,"expected_revision":context.expected_revision,
            "actor_id":context.actor_id,"session_id":context.session_id,"deadline":null,"source_identity":source_identity,"config_identity":config_identity}),
        );
        let mut admission = context.clone();
        admission.request_digest = digest;
        let job = ExternalJobInput {
            job_id: context.operation_id.clone(),
            operation_id: context.operation_id.clone(),
            project_id: identity.project_id.clone(),
            subject_type: "project".into(),
            subject_id: identity.project_id.clone(),
            kind: ExternalJobKind::MemoryPublication.as_str().into(),
            request_digest: admission.request_digest.clone(),
            source_identity: None,
            config_identity: None,
            actor_id: context.actor_id.clone(),
            session_id: context.session_id.clone(),
            deadline: None,
            created_at: context.now.clone(),
        };
        store.admit_memory_publication(
            &admission,
            identity,
            review_id,
            &memory_root,
            Some(expected_manifest),
            &planned.manifest_identity,
            &planned.content_digest,
            &job,
        )?;
        let reviewed = ReviewedMemory {
            operation: KnowledgeOperation {
                operation_id: review.review_id,
                request_digest: record.content_digest.clone(),
                durability: KnowledgeDurability::CanonicalStore,
            },
            provenance: KnowledgeProvenance {
                project_id: Some(identity.project_id.clone()),
                memory_entry_id: Some(record.entry_id),
                content_digest: Some(record.content_digest),
                ..Default::default()
            },
            draft,
            reviewer_id: review.actor_id,
            accepted: true,
        };
        self.publish_memory(
            store,
            identity,
            &publisher,
            &reviewed,
            MemoryPublishInput {
                operation_id: context.operation_id.clone(),
                expected_manifest_identity: Some(expected_manifest.into()),
                actor_id: context.actor_id.clone(),
                session_id: context.session_id.clone(),
                deadline: None,
                created_at: context.now.clone(),
                started_at: context.now.clone(),
                observed_at: context.now.clone(),
                source_identity: None,
                config_identity: None,
            },
        )
    }
}

fn validate_publication_root(
    store: &SqliteStore,
    identity: &IdentityContext,
    root: &Path,
) -> Result<(), KnowledgeError> {
    let binding = boreal_store::identity::IdentityStore::new(store)
        .workspace_binding(&identity.project_id)
        .map_err(|error| KnowledgeError::Invalid(error.to_string()))?;
    let workspace = std::fs::canonicalize(binding.canonical_root())
        .map_err(|error| KnowledgeError::Invalid(error.to_string()))?;
    let expected = workspace.join("memory");
    if root != expected
        || root
            .components()
            .any(|part| matches!(part, std::path::Component::ParentDir))
    {
        return Err(KnowledgeError::Invalid(
            "publication readback must use this project's memory root".into(),
        ));
    }
    if root.exists()
        && (std::fs::symlink_metadata(root)
            .map_err(|error| KnowledgeError::Invalid(error.to_string()))?
            .file_type()
            .is_symlink()
            || std::fs::canonicalize(root)
                .map_err(|error| KnowledgeError::Invalid(error.to_string()))?
                != expected)
    {
        return Err(KnowledgeError::Invalid(
            "memory root is not a confined directory".into(),
        ));
    }
    Ok(())
}

impl KnowledgeApplication<'_> {
    pub fn read_memory_publication(
        &self,
        store: &SqliteStore,
        identity: &IdentityContext,
        root: impl AsRef<Path>,
        operation: &str,
    ) -> Result<Value, KnowledgeError> {
        let job = store
            .external_job_by_operation_with_identity(identity, operation)?
            .ok_or_else(|| KnowledgeError::Invalid("publication operation missing".into()))?;
        if job.kind != ExternalJobKind::MemoryPublication.as_str() {
            return Err(KnowledgeError::Invalid(
                "operation is not a memory publication".into(),
            ));
        }
        validate_publication_root(store, identity, root.as_ref())?;
        let publisher = Publisher::deferred(boreal_memory::MemoryRoot::new(root.as_ref())?);
        let observation = publisher.publication_readback(operation)?;
        let recovery = observation.recovery();
        let expected = store.memory_publication_plan(&identity.project_id, operation)?;
        // The committed manifest identity binds the publication plan, while
        // the commit itself and planned content digest must also agree with
        // the terminal SQLite job before we call the two stores reconciled.
        let git_matches_plan = observation.is_resolved()
            && recovery.is_some_and(|readback| {
                expected.as_ref().is_some_and(|(manifest, _)| {
                    readback.manifest_identity.as_ref() == Some(manifest)
                        && readback
                            .git_revision
                            .as_deref()
                            .is_some_and(|revision| !revision.is_empty())
                })
            });
        let verified_git_revision = recovery.and_then(|readback| readback.git_revision.as_deref());
        let expected_side_effect_ref =
            verified_git_revision.map(|revision| format!("git:{revision}"));
        let database_effect_matches = expected
            .as_ref()
            .zip(expected_side_effect_ref.as_deref())
            .is_some_and(|((_, planned_content_digest), side_effect_ref)| {
                job.side_effect_ref.as_deref() == Some(side_effect_ref)
                    && job.result_digest.as_deref() == Some(planned_content_digest.as_str())
            });
        let git_state = match (&observation, git_matches_plan) {
            (boreal_memory::PublicationReadback::NoPublication, _) => "no_commit",
            (boreal_memory::PublicationReadback::ReadbackRequired(_), _) => "unresolved",
            (boreal_memory::PublicationReadback::Reconciled(_), true) => "verified_commit",
            (boreal_memory::PublicationReadback::Reconciled(_), false) => "identity_conflict",
        };
        let database_has_unresolved_effect = matches!(
            job.stage.as_str(),
            "side_effect_started" | "side_effect_finished" | "readback_required"
        );
        let database_terminal = matches!(job.stage.as_str(), "committed" | "reconciled");
        let reconciliation_state = if git_matches_plan {
            if database_terminal {
                if database_effect_matches {
                    "reconciled"
                } else {
                    "database_git_conflict"
                }
            } else if matches!(job.stage.as_str(), "failed" | "rejected") {
                "conflict"
            } else {
                "git_committed_db_pending"
            }
        } else if matches!(
            &observation,
            boreal_memory::PublicationReadback::Reconciled(_)
        ) {
            "identity_conflict"
        } else if matches!(
            &observation,
            boreal_memory::PublicationReadback::ReadbackRequired(_)
        ) {
            "git_readback_required"
        } else if database_has_unresolved_effect || database_terminal {
            "database_effect_unverified"
        } else if matches!(
            job.stage.as_str(),
            "registered" | "admitted" | "running" | "cancel_requested"
        ) {
            "publication_pending"
        } else {
            "not_published"
        };
        Ok(
            json!({"project_id":identity.project_id,"operation_id":operation,"stage":job.stage,"request_digest":job.request_digest,
            "database_state":job.stage,"database_reconciliation_state":job.reconciliation_state,
            "git_state":git_state,"reconciliation_state":reconciliation_state,
            "readback_required":!(git_matches_plan && database_terminal && database_effect_matches),
            "git_verified":git_matches_plan,"database_effect_matches":database_effect_matches,
            "verified_git_revision":if git_matches_plan{verified_git_revision}else{None},
            "git_observation":format!("{:?}",observation),
            "error":if git_matches_plan && database_terminal && !database_effect_matches {
                Some("terminal database publication reference or content digest conflicts with verified Git".to_owned())
            } else { job.error_message }}),
        )
    }
}

impl KnowledgeApplication<'_> {
    pub fn review_durable_memory(
        &self,
        store: &SqliteStore,
        context: &boreal_store::V3MutationContext,
        draft_id: &str,
        decision: &str,
        reason: &str,
    ) -> Result<boreal_store::MutationResult, KnowledgeError> {
        let record = store
            .memory_draft(&context.project_id, draft_id)?
            .ok_or_else(|| KnowledgeError::Invalid("memory draft missing".into()))?;
        stored_draft(&record)?;
        Ok(store.record_memory_review(context, draft_id, decision, reason)?)
    }
    pub fn reconcile_memory_publication(
        &self,
        store: &SqliteStore,
        identity: &IdentityContext,
        context: &boreal_store::V3MutationContext,
        root: impl AsRef<Path>,
        original_operation: &str,
    ) -> Result<boreal_store::MutationResult, KnowledgeError> {
        validate_publication_root(store, identity, root.as_ref())?;
        let publisher = Publisher::deferred(boreal_memory::MemoryRoot::new(root.as_ref())?);
        let observation = publisher.publication_readback(original_operation)?;
        if !observation.is_resolved() {
            return Err(KnowledgeError::Invalid(
                "Git publication outcome remains unknown; no result was recorded".into(),
            ));
        }
        let recovery = observation
            .recovery()
            .ok_or_else(|| KnowledgeError::Invalid("verified Git readback missing".into()))?;
        if recovery.operation_id.as_deref() != Some(original_operation) {
            return Err(KnowledgeError::Invalid(
                "Git operation identity differs".into(),
            ));
        }
        let manifest = recovery
            .manifest_identity
            .as_deref()
            .ok_or_else(|| KnowledgeError::Invalid("verified manifest missing".into()))?;
        let git = recovery
            .git_revision
            .as_deref()
            .ok_or_else(|| KnowledgeError::Invalid("verified commit missing".into()))?;
        Ok(store.reconcile_memory_publication(
            context,
            identity,
            original_operation,
            manifest,
            git,
        )?)
    }
}
