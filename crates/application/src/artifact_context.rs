//! Bounded, identity-based project context over the existing source catalog.
//!
//! Store adapters implement `ArtifactContextReadPort` with planning and
//! accepted-result snapshots. This use case verifies every referenced byte
//! version through the source layer and never interprets source text as
//! instructions or decides that an output is accepted.

use std::{fmt, path::Path};

use boreal_source::{
    ArtifactProducer, ArtifactRightsProvenance, ArtifactRole, ArtifactScope, SourceCatalog,
    SourceError, SourceIdentity,
};
use boreal_store::{SqliteStore, StoreError};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub const ARTIFACT_CONTEXT_SCHEMA: &str = "boreal.artifact_context.v2";
pub const MAX_CONTEXT_PACK_BYTES: usize = 256 * 1024;
pub const MAX_CONTEXT_ENTRIES: usize = 100;
pub const MAX_CONTEXT_CITATIONS: usize = 100;
pub const MAX_CONTEXT_REQUIREMENTS: usize = 64;
pub const MAX_CONTEXT_CONSUMERS: usize = 100;
pub const MAX_CONTEXT_CONSUMER_OFFSET: usize = 1_000_000;
pub const MAX_CONTEXT_PREVIEW_BYTES: usize = 8 * 1024;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct RequirementContext {
    pub requirement_key: String,
    pub purpose: String,
    pub required: bool,
    pub deliverable_type: String,
    pub allowed_media_types: Vec<String>,
    pub min_count: u32,
    pub max_count: u32,
    pub contract_revision: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum ReferenceState {
    Current,
    Accepted,
    Superseded,
    Archived,
}

/// A bounded planning reference. The exact content digest is mandatory even
/// when the source itself is currently unavailable.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ArtifactContextReference {
    pub reference_id: String,
    pub source: SourceIdentity,
    pub role: ArtifactRole,
    pub scope: ArtifactScope,
    pub required: bool,
    pub requirement_key: Option<String>,
    pub produced_by: Option<ArtifactProducer>,
    pub rights: ArtifactRightsProvenance,
    pub state: ReferenceState,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct CitationContextReference {
    /// `None` is retained for a citation whose database source row vanished;
    /// the application returns it as an explicit missing citation.
    pub source: Option<SourceIdentity>,
    pub scope: ArtifactScope,
    pub location: String,
    pub authority: String,
    pub trust: String,
    pub state: ReferenceState,
    /// Database availability is an upper bound. The source catalog still
    /// verifies exact bytes before the pack reports an available citation.
    pub registered_availability: ArtifactAvailability,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct CitationContextEntry {
    pub source: Option<SourceIdentity>,
    pub scope: ArtifactScope,
    pub location: Option<String>,
    pub authority: Option<String>,
    pub trust: Option<String>,
    pub state: ReferenceState,
    pub availability: ArtifactAvailability,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ArtifactConsumerReference {
    pub work_id: String,
    pub reference_id: String,
    pub contract_revision: u64,
    pub source: SourceIdentity,
    pub role: ArtifactRole,
    pub scope: ArtifactScope,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ArtifactConsumerImpact {
    pub work_id: Option<String>,
    pub reference_id: Option<String>,
    pub contract_revision: Option<u64>,
    pub scope: ArtifactScope,
    pub availability: ArtifactAvailability,
    /// `None` means access was denied and the consumer identity was redacted.
    pub requires_revalidation: Option<bool>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ArtifactConsumerImpactPage {
    pub project_id: String,
    pub source: SourceIdentity,
    pub replacement: Option<SourceIdentity>,
    pub observed_revision: u64,
    pub consumers: Vec<ArtifactConsumerImpact>,
    pub omitted_count: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlanningContextSnapshot {
    pub project_id: String,
    pub work_id: String,
    pub observed_revision: u64,
    pub contract_revision: Option<u64>,
    pub requirements: RevisionedContextRows<RequirementContext>,
    pub inputs: RevisionedContextRows<ArtifactContextReference>,
}

/// An adapter applies the requested limit before it materializes rows. The
/// omitted count distinguishes a complete empty result from a bounded page.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RevisionedContextRows<T> {
    pub observed_revision: u64,
    pub items: Vec<T>,
    pub omitted_count: u64,
}

/// The work store owns these reads. Implementations must return a single
/// revision-consistent planning snapshot and exact accepted result identities.
/// Every limit is applied by the adapter/store query before rows are loaded.
pub trait ArtifactContextReadPort {
    fn planning_context(
        &self,
        project_id: &str,
        work_id: &str,
        max_requirements: usize,
        max_inputs: usize,
    ) -> Result<PlanningContextSnapshot, ArtifactContextError>;

    fn accepted_results(
        &self,
        project_id: &str,
        work_id: &str,
        expected_revision: u64,
        limit: usize,
    ) -> Result<RevisionedContextRows<ArtifactContextReference>, ArtifactContextError>;

    fn citations(
        &self,
        project_id: &str,
        work_id: &str,
        expected_revision: u64,
        limit: usize,
    ) -> Result<RevisionedContextRows<CitationContextReference>, ArtifactContextError>;

    fn consumers_referencing_source(
        &self,
        project_id: &str,
        source: &SourceIdentity,
        expected_revision: u64,
        limit: usize,
        offset: usize,
    ) -> Result<RevisionedContextRows<ArtifactConsumerReference>, ArtifactContextError>;

    /// Authorization is resolved against the authenticated adapter context,
    /// never from a caller-controlled request flag.
    fn scope_authorized(
        &self,
        project_id: &str,
        work_id: Option<&str>,
        scope: ArtifactScope,
    ) -> Result<bool, ArtifactContextError>;
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum ArtifactAvailability {
    Available,
    Missing,
    Corrupt,
    AccessDenied,
    Stale,
    Superseded,
    Archived,
    TooLarge,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ArtifactContextEntry {
    pub reference_id: String,
    pub source: Option<SourceIdentity>,
    pub role: ArtifactRole,
    pub scope: ArtifactScope,
    pub required: bool,
    pub requirement_key: Option<String>,
    pub produced_by: Option<ArtifactProducer>,
    pub rights: Option<ArtifactRightsProvenance>,
    pub state: ReferenceState,
    pub availability: ArtifactAvailability,
    pub media_type: Option<String>,
    pub byte_count: Option<usize>,
    pub origin: Option<String>,
    /// Only bounded UTF-8 previews of text media are included. Binary bytes
    /// remain available through the exact-identity read/materialize API.
    pub text_preview: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ArtifactContextPack {
    pub schema: String,
    pub project_id: String,
    pub work_id: String,
    pub observed_revision: u64,
    pub contract_revision: Option<u64>,
    pub requirements: Vec<RequirementContext>,
    pub entries: Vec<ArtifactContextEntry>,
    pub citations: Vec<CitationContextEntry>,
    pub omitted_requirements: u64,
    pub omitted_artifacts: u64,
    pub omitted_citations: u64,
    pub preview_bytes: usize,
    pub serialized_bytes: usize,
    pub truncated: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ArtifactContextRequest {
    pub project_id: String,
    pub work_id: String,
    pub max_bytes: usize,
    pub max_entries: usize,
    pub max_citations: usize,
    pub max_source_read_bytes: usize,
    pub max_preview_bytes: usize,
}

impl ArtifactContextRequest {
    pub fn new(project_id: impl Into<String>, work_id: impl Into<String>) -> Self {
        Self {
            project_id: project_id.into(),
            work_id: work_id.into(),
            max_bytes: 64 * 1024,
            max_entries: 50,
            max_citations: 50,
            max_source_read_bytes: 1024 * 1024,
            max_preview_bytes: 2 * 1024,
        }
    }
}

#[derive(Debug)]
pub enum ArtifactContextError {
    InvalidRequest(String),
    Port(String),
    Source(SourceError),
    BudgetExceeded,
    SnapshotChanged { expected: u64, actual: u64 },
    AccessDenied,
    ReferenceUnavailable(ArtifactAvailability),
}

impl fmt::Display for ArtifactContextError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidRequest(message) => {
                write!(formatter, "invalid artifact context: {message}")
            }
            Self::Port(message) => write!(formatter, "artifact context read failed: {message}"),
            Self::Source(error) => write!(formatter, "artifact source read failed: {error}"),
            Self::BudgetExceeded => formatter.write_str("artifact context exceeds its byte budget"),
            Self::SnapshotChanged { expected, actual } => write!(
                formatter,
                "artifact context changed during read (expected revision {expected}, received {actual})"
            ),
            Self::AccessDenied => formatter.write_str("artifact context access denied"),
            Self::ReferenceUnavailable(state) => {
                write!(formatter, "artifact reference is {state:?}")
            }
        }
    }
}

impl std::error::Error for ArtifactContextError {}

impl From<SourceError> for ArtifactContextError {
    fn from(error: SourceError) -> Self {
        Self::Source(error)
    }
}

/// Store-backed implementation of the bounded context port. The bound
/// project comes from the authenticated adapter, while the supplied policy
/// resolves work and private-scope access from that same authenticated
/// context. Neither host paths nor caller-provided authorization flags are
/// persisted or accepted here.
pub struct StoreArtifactContextReadPort<'a, A> {
    store: &'a SqliteStore,
    project_id: String,
    scope_authorizer: A,
}

impl<'a, A> StoreArtifactContextReadPort<'a, A>
where
    A: Fn(&str, Option<&str>, ArtifactScope) -> Result<bool, String>,
{
    pub fn new(store: &'a SqliteStore, project_id: impl Into<String>, scope_authorizer: A) -> Self {
        Self {
            store,
            project_id: project_id.into(),
            scope_authorizer,
        }
    }

    fn require_project(&self, project_id: &str) -> Result<(), ArtifactContextError> {
        if project_id == self.project_id {
            Ok(())
        } else {
            Err(ArtifactContextError::AccessDenied)
        }
    }

    fn current_revision(&self, project_id: &str) -> Result<u64, ArtifactContextError> {
        self.require_project(project_id)?;
        self.store
            .project_revision(project_id)
            .map(|revision| revision.0)
            .map_err(map_store_error)
    }

    fn require_authorized(
        &self,
        project_id: &str,
        work_id: Option<&str>,
        scope: ArtifactScope,
    ) -> Result<(), ArtifactContextError> {
        if project_id != self.project_id
            || !(self.scope_authorizer)(project_id, work_id, scope)
                .map_err(ArtifactContextError::Port)?
        {
            return Err(ArtifactContextError::AccessDenied);
        }
        Ok(())
    }
}

impl<A> ArtifactContextReadPort for StoreArtifactContextReadPort<'_, A>
where
    A: Fn(&str, Option<&str>, ArtifactScope) -> Result<bool, String>,
{
    fn planning_context(
        &self,
        project_id: &str,
        work_id: &str,
        max_requirements: usize,
        max_inputs: usize,
    ) -> Result<PlanningContextSnapshot, ArtifactContextError> {
        self.require_project(project_id)?;
        self.require_authorized(project_id, Some(work_id), ArtifactScope::Project)?;
        if max_requirements == 0
            || max_requirements > MAX_CONTEXT_REQUIREMENTS
            || max_inputs == 0
            || max_inputs > MAX_CONTEXT_ENTRIES
        {
            return Err(ArtifactContextError::InvalidRequest(
                "planning page is outside its size bounds".into(),
            ));
        }
        let snapshot = self
            .store
            .work_planning_contract_snapshot(project_id, work_id)
            .map_err(map_store_error)?;
        let (contract_revision, requirements, inputs) = match snapshot.contract {
            Some(contract) => {
                if contract.project_id != project_id || contract.work_id != work_id {
                    return Err(ArtifactContextError::Port(
                        "planning contract identity differs from its query".into(),
                    ));
                }
                let requirements =
                    parse_requirements(&contract.requirements_json, contract.contract_revision)?;
                let inputs = parse_input_references(
                    project_id,
                    work_id,
                    contract.contract_revision,
                    &contract.inputs_json,
                )?;
                (Some(contract.contract_revision), requirements, inputs)
            }
            None => (None, Vec::new(), Vec::new()),
        };
        let omitted_requirements = requirements.len().saturating_sub(max_requirements) as u64;
        let omitted_inputs = inputs.len().saturating_sub(max_inputs) as u64;
        Ok(PlanningContextSnapshot {
            project_id: project_id.to_owned(),
            work_id: work_id.to_owned(),
            observed_revision: snapshot.project_revision,
            contract_revision,
            requirements: RevisionedContextRows {
                observed_revision: snapshot.project_revision,
                items: requirements.into_iter().take(max_requirements).collect(),
                omitted_count: omitted_requirements,
            },
            inputs: RevisionedContextRows {
                observed_revision: snapshot.project_revision,
                items: inputs.into_iter().take(max_inputs).collect(),
                omitted_count: omitted_inputs,
            },
        })
    }

    fn accepted_results(
        &self,
        project_id: &str,
        work_id: &str,
        expected_revision: u64,
        limit: usize,
    ) -> Result<RevisionedContextRows<ArtifactContextReference>, ArtifactContextError> {
        self.require_project(project_id)?;
        self.require_authorized(project_id, Some(work_id), ArtifactScope::Project)?;
        if limit == 0 || limit > MAX_CONTEXT_ENTRIES {
            return Err(ArtifactContextError::InvalidRequest(
                "accepted-result page is outside its size bounds".into(),
            ));
        }
        ensure_revision(expected_revision, self.current_revision(project_id)?)?;
        let snapshot = self
            .store
            .work_planning_contract_snapshot(project_id, work_id)
            .map_err(map_store_error)?;
        ensure_revision(expected_revision, snapshot.project_revision)?;
        let requirements = snapshot
            .contract
            .as_ref()
            .map(|contract| {
                parse_requirements(&contract.requirements_json, contract.contract_revision)
            })
            .transpose()?
            .unwrap_or_default();
        let required_by_key = requirements
            .into_iter()
            .map(|requirement| (requirement.requirement_key, requirement.required))
            .collect::<std::collections::BTreeMap<_, _>>();

        let mut accepted = Vec::new();
        let mut omitted_count = 0u64;
        if let Some(outcome) = self
            .store
            .current_accepted_outcome(project_id, work_id)
            .map_err(map_store_error)?
        {
            if outcome.project_id != project_id || outcome.work_id != work_id {
                return Err(ArtifactContextError::Port(
                    "accepted outcome identity differs from its query".into(),
                ));
            }
            let submission = self
                .store
                .current_submission(project_id, work_id, outcome.proof_revision)
                .map_err(map_store_error)?
                .ok_or_else(|| {
                    ArtifactContextError::Port(
                        "accepted outcome has no current immutable submission".into(),
                    )
                })?;
            if submission.project_id != project_id
                || submission.work_id != work_id
                || submission.proof_revision != outcome.proof_revision
            {
                return Err(ArtifactContextError::Port(
                    "accepted submission identity differs from its outcome".into(),
                ));
            }
            if let Some(result) = self
                .store
                .current_acceptance_result(
                    project_id,
                    work_id,
                    &submission.attempt_id,
                    submission.fence,
                )
                .map_err(map_store_error)?
            {
                if result.project_id != project_id
                    || result.work_id != work_id
                    || result.attempt_id != submission.attempt_id
                    || result.fence != submission.fence
                    || result.proof_revision != outcome.proof_revision
                {
                    return Err(ArtifactContextError::Port(
                        "typed result does not match the accepted submission".into(),
                    ));
                }
                omitted_count = result.outputs.len().saturating_sub(limit) as u64;
                for output in result.outputs.iter().take(limit) {
                    let source = SourceIdentity {
                        project_id: project_id.to_owned(),
                        source_version_id: output.source_version_id.clone(),
                        content_digest: output.content_digest.clone(),
                    };
                    let producer = ArtifactProducer {
                        work_id: work_id.to_owned(),
                        attempt_id: submission.attempt_id.clone(),
                        result_id: result.result_id.clone(),
                    };
                    let reference_id = stable_reference_id(
                        "accepted",
                        json!({
                            "project_id": project_id,
                            "work_id": work_id,
                            "attempt_id": submission.attempt_id,
                            "result_id": result.result_id,
                            "relationship_id": output.relationship_id,
                            "source_version_id": output.source_version_id,
                            "content_digest": output.content_digest,
                        }),
                    );
                    accepted.push(ArtifactContextReference {
                        reference_id,
                        source,
                        role: ArtifactRole::AcceptedSubmission,
                        scope: ArtifactScope::Project,
                        required: required_by_key
                            .get(&output.requirement_key)
                            .copied()
                            .unwrap_or(false),
                        requirement_key: Some(output.requirement_key.clone()),
                        produced_by: Some(producer),
                        rights: ArtifactRightsProvenance {
                            attribution: output.attribution.clone(),
                            rights_statement: output.rights_statement.clone(),
                            license: output.license.clone(),
                        },
                        state: ReferenceState::Accepted,
                    });
                }
            }
        }
        let observed_revision = self.current_revision(project_id)?;
        ensure_revision(expected_revision, observed_revision)?;
        Ok(RevisionedContextRows {
            observed_revision,
            items: accepted,
            omitted_count,
        })
    }

    fn citations(
        &self,
        project_id: &str,
        _work_id: &str,
        expected_revision: u64,
        limit: usize,
    ) -> Result<RevisionedContextRows<CitationContextReference>, ArtifactContextError> {
        self.require_project(project_id)?;
        self.require_authorized(project_id, Some(_work_id), ArtifactScope::Project)?;
        if limit > MAX_CONTEXT_CITATIONS {
            return Err(ArtifactContextError::InvalidRequest(
                "citation page is outside its size bounds".into(),
            ));
        }
        ensure_revision(expected_revision, self.current_revision(project_id)?)?;
        let snapshot = self
            .store
            .knowledge_context_snapshot(project_id, 100, 0, Some(expected_revision))
            .map_err(map_store_error)?;
        let mut rows = Vec::new();
        let mut omitted_count = 0u64;
        let mut scanned_full_page = false;
        let claims = snapshot
            .get("claims")
            .and_then(Value::as_array)
            .ok_or_else(|| ArtifactContextError::Port("claim context is malformed".into()))?;
        scanned_full_page |= claims.len() == 100;
        for claim in claims {
            let claim_id = json_text(claim, "id", "claim id")?;
            let source_version_id = json_text(claim, "source_version_id", "claim source")?;
            let location = json_text(claim, "citation_location", "claim citation")?;
            push_citation_spec(
                &mut rows,
                &mut omitted_count,
                limit,
                source_version_id,
                location,
                "knowledge_claim".into(),
                "recorded".into(),
                if self
                    .store
                    .knowledge_claim_superseded(project_id, claim_id)
                    .map_err(map_store_error)?
                {
                    ReferenceState::Superseded
                } else {
                    ReferenceState::Current
                },
            );
        }
        let memory = snapshot
            .get("memory")
            .and_then(Value::as_array)
            .ok_or_else(|| ArtifactContextError::Port("memory context is malformed".into()))?;
        scanned_full_page |= memory.len() == 100;
        for draft in memory {
            let citations = draft
                .get("citations")
                .and_then(Value::as_array)
                .ok_or_else(|| {
                    ArtifactContextError::Port("memory citations are malformed".into())
                })?;
            for citation in citations {
                let source_version_id = json_text(citation, "source_version_id", "memory source")?;
                let location = json_text(citation, "location", "memory citation")?;
                push_citation_spec(
                    &mut rows,
                    &mut omitted_count,
                    limit,
                    source_version_id,
                    location,
                    "memory_draft".into(),
                    "recorded".into(),
                    ReferenceState::Current,
                );
            }
        }
        // The store snapshot itself is capped at 100 rows per knowledge kind.
        // Preserve a nonzero truncation signal if that fixed scan bound was
        // reached, even when every returned row fit the caller's citation cap.
        if scanned_full_page {
            omitted_count = omitted_count.saturating_add(1);
        }
        let mut citations = Vec::with_capacity(rows.len());
        for CitationSpec {
            source_version_id,
            location,
            authority,
            trust,
            state,
        } in rows
        {
            let citation = match self
                .store
                .source_version(project_id, &source_version_id)
                .map_err(map_store_error)?
            {
                Some(source) if source.project_id == project_id => {
                    let (scope, registered_availability) = match source.access_scope.as_str() {
                        "project" => (
                            ArtifactScope::Project,
                            registered_availability(&source.availability),
                        ),
                        "private" => (
                            ArtifactScope::Private,
                            registered_availability(&source.availability),
                        ),
                        _ => (ArtifactScope::Private, ArtifactAvailability::AccessDenied),
                    };
                    let identity_valid = valid_digest(&source.content_digest);
                    CitationContextReference {
                        source: identity_valid.then(|| SourceIdentity {
                            project_id: project_id.to_owned(),
                            source_version_id: source.source_version_id,
                            content_digest: source.content_digest,
                        }),
                        scope,
                        location,
                        authority,
                        trust,
                        state,
                        registered_availability: if identity_valid {
                            registered_availability
                        } else {
                            ArtifactAvailability::Corrupt
                        },
                    }
                }
                _ => CitationContextReference {
                    source: None,
                    // Unknown source scope is private by default; its locator
                    // will be redacted unless the authenticated policy allows it.
                    scope: ArtifactScope::Private,
                    location,
                    authority,
                    trust,
                    state,
                    registered_availability: ArtifactAvailability::Missing,
                },
            };
            citations.push(citation);
        }
        let observed_revision = self.current_revision(project_id)?;
        ensure_revision(expected_revision, observed_revision)?;
        Ok(RevisionedContextRows {
            observed_revision,
            items: citations,
            omitted_count,
        })
    }

    fn consumers_referencing_source(
        &self,
        project_id: &str,
        source: &SourceIdentity,
        expected_revision: u64,
        limit: usize,
        offset: usize,
    ) -> Result<RevisionedContextRows<ArtifactConsumerReference>, ArtifactContextError> {
        self.require_project(project_id)?;
        self.require_authorized(project_id, None, ArtifactScope::Project)?;
        validate_identity(project_id, source)?;
        if limit == 0 || limit > MAX_CONTEXT_CONSUMERS || offset > MAX_CONTEXT_CONSUMER_OFFSET {
            return Err(ArtifactContextError::InvalidRequest(
                "consumer page is outside its size bounds".into(),
            ));
        }
        let page = self
            .store
            .planning_contracts_referencing_source(
                project_id,
                &source.source_version_id,
                &source.content_digest,
                Some(expected_revision),
                limit as u64,
                offset as u64,
            )
            .map_err(map_store_error)?;
        ensure_revision(expected_revision, page.project_revision)?;
        let mut consumers = Vec::new();
        for contract in &page.contracts {
            if contract.project_id != project_id {
                return Err(ArtifactContextError::Port(
                    "consumer contract escaped its project".into(),
                ));
            }
            for input in parse_input_references(
                project_id,
                &contract.work_id,
                contract.contract_revision,
                &contract.inputs_json,
            )? {
                if input.source == *source {
                    consumers.push(ArtifactConsumerReference {
                        work_id: contract.work_id.clone(),
                        reference_id: input.reference_id,
                        contract_revision: contract.contract_revision,
                        source: input.source,
                        role: input.role,
                        scope: input.scope,
                    });
                }
            }
        }
        if consumers.len() > limit {
            return Err(ArtifactContextError::Port(
                "source consumer query exceeded its page bound".into(),
            ));
        }
        let returned_count = consumers.len() as u64;
        let observed_revision = self.current_revision(project_id)?;
        ensure_revision(expected_revision, observed_revision)?;
        Ok(RevisionedContextRows {
            observed_revision,
            items: consumers,
            omitted_count: page.total.saturating_sub(offset as u64 + returned_count),
        })
    }

    fn scope_authorized(
        &self,
        project_id: &str,
        work_id: Option<&str>,
        scope: ArtifactScope,
    ) -> Result<bool, ArtifactContextError> {
        if project_id != self.project_id {
            return Ok(false);
        }
        (self.scope_authorizer)(project_id, work_id, scope).map_err(ArtifactContextError::Port)
    }
}

#[derive(Deserialize)]
struct StoredRequirement {
    key: String,
    purpose: String,
    required: bool,
    deliverable_type: String,
    #[serde(default)]
    allowed_media_types: Vec<String>,
    min_count: u32,
    max_count: u32,
}

#[derive(Deserialize)]
struct StoredInputReference {
    project_id: String,
    source_version_id: String,
    content_digest: String,
    role: String,
    scope: String,
    produced_by: Option<StoredProducer>,
}

#[derive(Deserialize)]
struct StoredProducer {
    work_id: String,
    attempt_id: String,
    result_id: String,
}

#[derive(Clone)]
struct CitationSpec {
    source_version_id: String,
    location: String,
    authority: String,
    trust: String,
    state: ReferenceState,
}

fn map_store_error(error: StoreError) -> ArtifactContextError {
    match error {
        StoreError::StaleRevision { expected, actual } => {
            ArtifactContextError::SnapshotChanged { expected, actual }
        }
        error => ArtifactContextError::Port(error.to_string()),
    }
}

fn parse_requirements(
    json_text: &str,
    contract_revision: u64,
) -> Result<Vec<RequirementContext>, ArtifactContextError> {
    let stored = serde_json::from_str::<Vec<StoredRequirement>>(json_text).map_err(|error| {
        ArtifactContextError::Port(format!("invalid planning requirements: {error}"))
    })?;
    Ok(stored
        .into_iter()
        .map(|requirement| RequirementContext {
            requirement_key: requirement.key,
            purpose: requirement.purpose,
            required: requirement.required,
            deliverable_type: requirement.deliverable_type,
            allowed_media_types: requirement.allowed_media_types,
            min_count: requirement.min_count,
            max_count: requirement.max_count,
            contract_revision,
        })
        .collect())
}

fn parse_input_references(
    project_id: &str,
    work_id: &str,
    contract_revision: u64,
    json_text: &str,
) -> Result<Vec<ArtifactContextReference>, ArtifactContextError> {
    let stored = serde_json::from_str::<Vec<StoredInputReference>>(json_text)
        .map_err(|error| ArtifactContextError::Port(format!("invalid planning inputs: {error}")))?;
    stored
        .into_iter()
        .map(|input| {
            if input.project_id != project_id {
                return Err(ArtifactContextError::Port(
                    "planning input escaped its project".into(),
                ));
            }
            let role = match input.role.as_str() {
                "context" | "accepted_input" | "reference" => ArtifactRole::InputSource,
                _ => {
                    return Err(ArtifactContextError::Port(
                        "planning input has an unknown role".into(),
                    ));
                }
            };
            let scope = match input.scope.as_str() {
                "project" => ArtifactScope::Project,
                "private" => ArtifactScope::Private,
                _ => {
                    return Err(ArtifactContextError::Port(
                        "planning input has an unknown scope".into(),
                    ));
                }
            };
            let source = SourceIdentity {
                project_id: input.project_id,
                source_version_id: input.source_version_id,
                content_digest: input.content_digest,
            };
            validate_identity(project_id, &source)?;
            let producer = input.produced_by.map(|producer| ArtifactProducer {
                work_id: producer.work_id,
                attempt_id: producer.attempt_id,
                result_id: producer.result_id,
            });
            if producer.as_ref().is_some_and(|producer| {
                producer.work_id.trim().is_empty()
                    || producer.attempt_id.trim().is_empty()
                    || producer.result_id.trim().is_empty()
            }) {
                return Err(ArtifactContextError::Port(
                    "planning producer identity is incomplete".into(),
                ));
            }
            let state = if input.role == "accepted_input" {
                ReferenceState::Accepted
            } else {
                ReferenceState::Current
            };
            let reference_id = stable_reference_id(
                "input",
                json!({
                    "project_id": project_id,
                    "work_id": work_id,
                    "contract_revision": contract_revision,
                    "source_version_id": source.source_version_id,
                    "content_digest": source.content_digest,
                    "role": input.role,
                    "scope": input.scope,
                    "produced_by": producer,
                }),
            );
            Ok(ArtifactContextReference {
                reference_id,
                source,
                role,
                scope,
                required: false,
                requirement_key: None,
                produced_by: producer,
                rights: ArtifactRightsProvenance::default(),
                state,
            })
        })
        .collect()
}

fn stable_reference_id(kind: &str, stable_identity: Value) -> String {
    let digest = crate::sha256_content_digest(
        &serde_json::to_vec(&stable_identity).expect("JSON values always serialize"),
    );
    format!("{kind}-{}", &digest[7..39])
}

fn json_text<'a>(
    value: &'a Value,
    field: &str,
    label: &str,
) -> Result<&'a str, ArtifactContextError> {
    value
        .get(field)
        .and_then(Value::as_str)
        .filter(|text| !text.trim().is_empty())
        .ok_or_else(|| ArtifactContextError::Port(format!("{label} is missing")))
}

fn push_citation_spec(
    rows: &mut Vec<CitationSpec>,
    omitted_count: &mut u64,
    limit: usize,
    source_version_id: &str,
    location: &str,
    authority: String,
    trust: String,
    state: ReferenceState,
) {
    if rows.len() < limit {
        rows.push(CitationSpec {
            source_version_id: source_version_id.to_owned(),
            location: location.to_owned(),
            authority,
            trust,
            state,
        });
    } else {
        *omitted_count = omitted_count.saturating_add(1);
    }
}

fn registered_availability(value: &str) -> ArtifactAvailability {
    match value {
        "available" => ArtifactAvailability::Available,
        "missing" => ArtifactAvailability::Missing,
        "quarantined" => ArtifactAvailability::Corrupt,
        _ => ArtifactAvailability::Corrupt,
    }
}

pub struct ArtifactContextApplication<'a, P> {
    catalog: &'a SourceCatalog,
    port: &'a P,
}

impl<'a, P: ArtifactContextReadPort> ArtifactContextApplication<'a, P> {
    pub fn new(catalog: &'a SourceCatalog, port: &'a P) -> Self {
        Self { catalog, port }
    }

    pub fn read_artifact(
        &self,
        project_id: &str,
        work_id: &str,
        reference: &ArtifactContextReference,
        max_bytes: usize,
    ) -> Result<boreal_source::SourceReadback, ArtifactContextError> {
        self.authorize_reference(project_id, work_id, reference)?;
        ensure_reference_readable(reference)?;
        self.catalog
            .read_identity_bounded(&reference.source, max_bytes)
            .map_err(ArtifactContextError::Source)
    }

    pub fn materialize_artifact(
        &self,
        project_id: &str,
        work_id: &str,
        reference: &ArtifactContextReference,
        permitted_root: &Path,
        relative_path: &Path,
        max_bytes: usize,
    ) -> Result<boreal_source::MaterializationReceipt, ArtifactContextError> {
        self.authorize_reference(project_id, work_id, reference)?;
        ensure_reference_readable(reference)?;
        self.catalog
            .materialize_identity(&reference.source, permitted_root, relative_path, max_bytes)
            .map_err(ArtifactContextError::Source)
    }

    /// Lists consumers pinned to the exact older identity. A replacement is
    /// only disclosed as a proposed version; consumers are never retargeted.
    pub fn consumers_for_changed_source(
        &self,
        project_id: &str,
        source: &SourceIdentity,
        replacement: Option<&SourceIdentity>,
        expected_revision: u64,
        limit: usize,
        offset: usize,
    ) -> Result<ArtifactConsumerImpactPage, ArtifactContextError> {
        validate_identity(project_id, source)?;
        if replacement.is_some_and(|new_identity| {
            new_identity.project_id != project_id
                || new_identity == source
                || !valid_identity_fields(new_identity)
        }) {
            return Err(ArtifactContextError::InvalidRequest(
                "replacement identity must be a different exact version in this project".into(),
            ));
        }
        if limit == 0 || limit > MAX_CONTEXT_CONSUMERS || offset > MAX_CONTEXT_CONSUMER_OFFSET {
            return Err(ArtifactContextError::InvalidRequest(
                "consumer page is outside its size bounds".into(),
            ));
        }
        if !self
            .port
            .scope_authorized(project_id, None, ArtifactScope::Project)?
        {
            return Err(ArtifactContextError::AccessDenied);
        }
        let rows = self.port.consumers_referencing_source(
            project_id,
            source,
            expected_revision,
            limit,
            offset,
        )?;
        ensure_revision(expected_revision, rows.observed_revision)?;
        if rows.items.len() > limit {
            return Err(ArtifactContextError::InvalidRequest(
                "consumer adapter exceeded its requested row bound".into(),
            ));
        }
        let mut consumers = Vec::with_capacity(rows.items.len());
        for row in rows.items {
            if row.source != *source
                || row.work_id.is_empty()
                || row.work_id.len() > 4 * 1024
                || row.reference_id.is_empty()
                || row.reference_id.len() > 128
            {
                return Err(ArtifactContextError::InvalidRequest(
                    "consumer adapter returned an invalid identity".into(),
                ));
            }
            if !self
                .port
                .scope_authorized(project_id, Some(&row.work_id), row.scope)?
            {
                consumers.push(ArtifactConsumerImpact {
                    work_id: None,
                    reference_id: None,
                    contract_revision: None,
                    scope: row.scope,
                    availability: ArtifactAvailability::AccessDenied,
                    requires_revalidation: None,
                });
            } else {
                consumers.push(ArtifactConsumerImpact {
                    work_id: Some(row.work_id),
                    reference_id: Some(row.reference_id),
                    contract_revision: Some(row.contract_revision),
                    scope: row.scope,
                    availability: if replacement.is_some() {
                        ArtifactAvailability::Stale
                    } else {
                        ArtifactAvailability::Available
                    },
                    requires_revalidation: Some(replacement.is_some()),
                });
            }
        }
        Ok(ArtifactConsumerImpactPage {
            project_id: project_id.to_owned(),
            source: source.clone(),
            replacement: replacement.cloned(),
            observed_revision: rows.observed_revision,
            consumers,
            omitted_count: rows.omitted_count,
        })
    }

    fn authorize_reference(
        &self,
        project_id: &str,
        work_id: &str,
        reference: &ArtifactContextReference,
    ) -> Result<(), ArtifactContextError> {
        if reference.source.project_id != project_id {
            return Err(ArtifactContextError::InvalidRequest(
                "artifact identity is outside the requested project".into(),
            ));
        }
        if !self
            .port
            .scope_authorized(project_id, Some(work_id), reference.scope)?
        {
            return Err(ArtifactContextError::AccessDenied);
        }
        Ok(())
    }

    pub fn pack(
        &self,
        request: &ArtifactContextRequest,
    ) -> Result<ArtifactContextPack, ArtifactContextError> {
        validate_request(request)?;
        if !self.port.scope_authorized(
            &request.project_id,
            Some(&request.work_id),
            ArtifactScope::Project,
        )? {
            return Err(ArtifactContextError::AccessDenied);
        }
        let planning = self.port.planning_context(
            &request.project_id,
            &request.work_id,
            MAX_CONTEXT_REQUIREMENTS,
            request.max_entries,
        )?;
        if planning.project_id != request.project_id || planning.work_id != request.work_id {
            return Err(ArtifactContextError::InvalidRequest(
                "planning read returned a different project or work identity".into(),
            ));
        }
        ensure_revision(
            planning.observed_revision,
            planning.requirements.observed_revision,
        )?;
        ensure_revision(
            planning.observed_revision,
            planning.inputs.observed_revision,
        )?;
        if planning.requirements.items.len() > MAX_CONTEXT_REQUIREMENTS
            || planning.inputs.items.len() > request.max_entries
        {
            return Err(ArtifactContextError::InvalidRequest(
                "planning adapter exceeded its requested row bound".into(),
            ));
        }
        validate_requirements(&planning.requirements.items)?;
        let accepted = self.port.accepted_results(
            &request.project_id,
            &request.work_id,
            planning.observed_revision,
            request.max_entries,
        )?;
        ensure_revision(planning.observed_revision, accepted.observed_revision)?;
        if accepted.items.len() > request.max_entries {
            return Err(ArtifactContextError::InvalidRequest(
                "accepted-result adapter exceeded its requested row bound".into(),
            ));
        }
        let citations = self.port.citations(
            &request.project_id,
            &request.work_id,
            planning.observed_revision,
            request.max_citations,
        )?;
        ensure_revision(planning.observed_revision, citations.observed_revision)?;
        if citations.items.len() > request.max_citations {
            return Err(ArtifactContextError::InvalidRequest(
                "citation adapter exceeded its requested row bound".into(),
            ));
        }
        let mut references = accepted.items;
        references.extend(planning.inputs.items);
        validate_references(&request.project_id, &references)?;
        let omitted_from_pack = references.len().saturating_sub(request.max_entries) as u64;
        let omitted_artifacts = planning
            .inputs
            .omitted_count
            .saturating_add(accepted.omitted_count)
            .saturating_add(omitted_from_pack);
        let truncated = omitted_artifacts > 0
            || planning.requirements.omitted_count > 0
            || citations.omitted_count > 0;
        references.truncate(request.max_entries);
        let private_scope_authorized = if references
            .iter()
            .any(|reference| reference.scope == ArtifactScope::Private)
        {
            self.port.scope_authorized(
                &request.project_id,
                Some(&request.work_id),
                ArtifactScope::Private,
            )?
        } else {
            false
        };

        let mut entries = Vec::with_capacity(references.len());
        for reference in references {
            entries.push(self.resolve_reference(request, reference, private_scope_authorized));
        }
        validate_citations(&request.project_id, &citations.items)?;
        let mut citation_entries = Vec::with_capacity(citations.items.len());
        for citation in citations.items {
            citation_entries.push(self.resolve_citation(request, citation)?);
        }
        let mut pack = ArtifactContextPack {
            schema: ARTIFACT_CONTEXT_SCHEMA.into(),
            project_id: request.project_id.clone(),
            work_id: request.work_id.clone(),
            observed_revision: planning.observed_revision,
            contract_revision: planning.contract_revision,
            requirements: planning.requirements.items,
            entries,
            citations: citation_entries,
            omitted_requirements: planning.requirements.omitted_count,
            omitted_artifacts,
            omitted_citations: citations.omitted_count,
            preview_bytes: 0,
            serialized_bytes: 0,
            truncated,
        };
        fit_pack_to_budget(&mut pack, request.max_bytes)?;
        Ok(pack)
    }

    fn resolve_citation(
        &self,
        request: &ArtifactContextRequest,
        citation: CitationContextReference,
    ) -> Result<CitationContextEntry, ArtifactContextError> {
        let denied = !self.port.scope_authorized(
            &request.project_id,
            Some(&request.work_id),
            citation.scope,
        )?;
        if denied {
            return Ok(CitationContextEntry {
                source: None,
                scope: citation.scope,
                location: None,
                authority: None,
                trust: None,
                state: citation.state,
                availability: ArtifactAvailability::AccessDenied,
            });
        }

        let mut entry = CitationContextEntry {
            source: citation.source.clone(),
            scope: citation.scope,
            location: Some(citation.location),
            authority: Some(citation.authority),
            trust: Some(citation.trust),
            state: citation.state,
            availability: citation.registered_availability,
        };
        if citation.state == ReferenceState::Superseded {
            entry.availability = ArtifactAvailability::Superseded;
            return Ok(entry);
        }
        if citation.state == ReferenceState::Archived {
            entry.availability = ArtifactAvailability::Archived;
            return Ok(entry);
        }
        if citation.registered_availability != ArtifactAvailability::Available {
            return Ok(entry);
        }
        let Some(source) = citation.source else {
            entry.availability = ArtifactAvailability::Missing;
            return Ok(entry);
        };
        match self
            .catalog
            .read_identity_bounded(&source, request.max_source_read_bytes)
        {
            Ok(_) => entry.availability = ArtifactAvailability::Available,
            Err(SourceError::MissingBlob | SourceError::ScopeViolation) => {
                entry.availability = ArtifactAvailability::Missing;
            }
            Err(SourceError::DigestMismatch) => {
                entry.availability = ArtifactAvailability::Corrupt;
            }
            Err(SourceError::InvalidArtifactIdentity) => {
                entry.availability = ArtifactAvailability::Stale;
            }
            Err(SourceError::ArtifactTooLarge { .. }) => {
                entry.availability = ArtifactAvailability::TooLarge;
            }
            Err(_) => entry.availability = ArtifactAvailability::Corrupt,
        }
        Ok(entry)
    }

    fn resolve_reference(
        &self,
        request: &ArtifactContextRequest,
        reference: ArtifactContextReference,
        private_scope_authorized: bool,
    ) -> ArtifactContextEntry {
        let mut entry = ArtifactContextEntry {
            reference_id: reference.reference_id.clone(),
            source: Some(reference.source.clone()),
            role: reference.role,
            scope: reference.scope,
            required: reference.required,
            requirement_key: reference.requirement_key.clone(),
            produced_by: reference.produced_by.clone(),
            rights: Some(reference.rights.clone()),
            state: reference.state,
            availability: match reference.state {
                ReferenceState::Superseded => ArtifactAvailability::Superseded,
                ReferenceState::Archived => ArtifactAvailability::Archived,
                ReferenceState::Current | ReferenceState::Accepted => ArtifactAvailability::Missing,
            },
            media_type: None,
            byte_count: None,
            origin: None,
            text_preview: None,
        };
        if reference.scope == ArtifactScope::Private && !private_scope_authorized {
            entry.availability = ArtifactAvailability::AccessDenied;
            entry.source = None;
            entry.rights = None;
            entry.reference_id = "access-denied".into();
            entry.requirement_key = None;
            entry.produced_by = None;
            return entry;
        }
        if reference.state == ReferenceState::Superseded {
            return entry;
        }
        if reference.state == ReferenceState::Archived {
            return entry;
        }
        match self
            .catalog
            .read_identity_bounded(&reference.source, request.max_source_read_bytes)
        {
            Ok(readback) => {
                entry.availability = ArtifactAvailability::Available;
                entry.media_type = Some(readback.media_type.clone());
                entry.byte_count = Some(readback.byte_count);
                if is_text_media_type(&readback.media_type) {
                    if let Ok(text) = std::str::from_utf8(&readback.bytes) {
                        entry.text_preview =
                            Some(truncate_utf8(text, request.max_preview_bytes).to_owned());
                    }
                }
            }
            Err(SourceError::MissingBlob | SourceError::ScopeViolation) => {
                entry.availability = ArtifactAvailability::Missing;
            }
            Err(SourceError::DigestMismatch) => {
                entry.availability = ArtifactAvailability::Corrupt;
            }
            Err(SourceError::InvalidArtifactIdentity) => {
                entry.availability = ArtifactAvailability::Stale;
            }
            Err(SourceError::ArtifactTooLarge { .. }) => {
                entry.availability = ArtifactAvailability::TooLarge;
            }
            Err(_) => {
                entry.availability = ArtifactAvailability::Corrupt;
            }
        }
        entry
    }
}

fn validate_request(request: &ArtifactContextRequest) -> Result<(), ArtifactContextError> {
    if request.project_id.trim().is_empty()
        || request.work_id.trim().is_empty()
        || request.max_bytes < 1024
        || request.max_bytes > MAX_CONTEXT_PACK_BYTES
        || request.max_entries == 0
        || request.max_entries > MAX_CONTEXT_ENTRIES
        || request.max_citations > MAX_CONTEXT_CITATIONS
        || request.max_source_read_bytes == 0
        || request.max_source_read_bytes > boreal_source::DEFAULT_MAX_ARTIFACT_BYTES
        || request.max_preview_bytes > MAX_CONTEXT_PREVIEW_BYTES
    {
        return Err(ArtifactContextError::InvalidRequest(
            "identity or size bounds are outside the supported range".into(),
        ));
    }
    Ok(())
}

fn ensure_revision(expected: u64, actual: u64) -> Result<(), ArtifactContextError> {
    if expected == actual {
        Ok(())
    } else {
        Err(ArtifactContextError::SnapshotChanged { expected, actual })
    }
}

fn ensure_reference_readable(
    reference: &ArtifactContextReference,
) -> Result<(), ArtifactContextError> {
    match reference.state {
        ReferenceState::Current | ReferenceState::Accepted => Ok(()),
        ReferenceState::Superseded => Err(ArtifactContextError::ReferenceUnavailable(
            ArtifactAvailability::Superseded,
        )),
        ReferenceState::Archived => Err(ArtifactContextError::ReferenceUnavailable(
            ArtifactAvailability::Archived,
        )),
    }
}

fn validate_references(
    project_id: &str,
    references: &[ArtifactContextReference],
) -> Result<(), ArtifactContextError> {
    if references.len() > MAX_CONTEXT_ENTRIES * 2 {
        return Err(ArtifactContextError::InvalidRequest(
            "artifact reference count exceeds its source bound".into(),
        ));
    }
    for reference in references {
        if reference.source.project_id != project_id
            || reference.source.source_version_id.is_empty()
            || reference.source.source_version_id.len() > 512
            || !valid_digest(&reference.source.content_digest)
            || reference.reference_id.trim().is_empty()
            || reference.reference_id.len() > 128
            || reference
                .requirement_key
                .as_deref()
                .is_some_and(|key| key.is_empty() || key.len() > 64)
            || reference.produced_by.as_ref().is_some_and(|producer| {
                producer.work_id.is_empty()
                    || producer.work_id.len() > 4 * 1024
                    || producer.attempt_id.is_empty()
                    || producer.attempt_id.len() > 4 * 1024
                    || producer.result_id.is_empty()
                    || producer.result_id.len() > 4 * 1024
            })
            || [
                reference.rights.attribution.as_deref(),
                reference.rights.rights_statement.as_deref(),
                reference.rights.license.as_deref(),
            ]
            .into_iter()
            .flatten()
            .any(|value| value.len() > boreal_source::MAX_ARTIFACT_PROVENANCE_FIELD_BYTES)
        {
            return Err(ArtifactContextError::InvalidRequest(
                "artifact reference is outside the requested project or bounds".into(),
            ));
        }
    }
    Ok(())
}

fn validate_requirements(requirements: &[RequirementContext]) -> Result<(), ArtifactContextError> {
    if requirements.iter().any(|requirement| {
        requirement.requirement_key.is_empty()
            || requirement.requirement_key.len() > 64
            || requirement.purpose.len() > 512
            || requirement.deliverable_type.len() > 128
            || requirement.allowed_media_types.len() > 16
            || requirement
                .allowed_media_types
                .iter()
                .any(|media_type| media_type.is_empty() || media_type.len() > 128)
            || requirement.min_count > requirement.max_count
    }) {
        return Err(ArtifactContextError::InvalidRequest(
            "planning requirement fields exceed their context bounds".into(),
        ));
    }
    Ok(())
}

fn validate_citations(
    project_id: &str,
    citations: &[CitationContextReference],
) -> Result<(), ArtifactContextError> {
    for citation in citations {
        if citation.source.as_ref().is_some_and(|source| {
            source.project_id != project_id
                || source.source_version_id.is_empty()
                || source.source_version_id.len() > 512
                || !valid_digest(&source.content_digest)
        }) || citation.location.is_empty()
            || citation.location.len() > 4 * 1024
            || citation.authority.len() > 128
            || citation.trust.len() > 128
        {
            return Err(ArtifactContextError::InvalidRequest(
                "citation is outside the requested project or bounds".into(),
            ));
        }
    }
    Ok(())
}

fn valid_digest(value: &str) -> bool {
    value.strip_prefix("sha256:").is_some_and(|hex| {
        hex.len() == 64
            && hex
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    })
}

fn valid_identity_fields(identity: &SourceIdentity) -> bool {
    !identity.project_id.trim().is_empty()
        && !identity.source_version_id.is_empty()
        && identity.source_version_id.len() <= 512
        && valid_digest(&identity.content_digest)
}

fn validate_identity(
    project_id: &str,
    identity: &SourceIdentity,
) -> Result<(), ArtifactContextError> {
    if identity.project_id != project_id || !valid_identity_fields(identity) {
        return Err(ArtifactContextError::InvalidRequest(
            "source identity is outside the project or its identity bounds".into(),
        ));
    }
    Ok(())
}

fn fit_pack_to_budget(
    pack: &mut ArtifactContextPack,
    max_bytes: usize,
) -> Result<(), ArtifactContextError> {
    loop {
        pack.preview_bytes = pack
            .entries
            .iter()
            .filter_map(|entry| entry.text_preview.as_ref())
            .map(String::len)
            .sum();
        pack.serialized_bytes = 0;
        let encoded = serde_json::to_vec(pack)
            .map_err(|error| ArtifactContextError::InvalidRequest(error.to_string()))?;
        pack.serialized_bytes = encoded.len();
        let final_size = serde_json::to_vec(pack)
            .map_err(|error| ArtifactContextError::InvalidRequest(error.to_string()))?
            .len();
        if final_size <= max_bytes {
            pack.serialized_bytes = final_size;
            return Ok(());
        }
        if let Some(entry) = pack.entries.iter_mut().rev().find(|entry| {
            entry
                .text_preview
                .as_ref()
                .is_some_and(|text| !text.is_empty())
        }) {
            if let Some(text) = entry.text_preview.as_mut() {
                let new_length = text.len() / 2;
                *text = truncate_utf8(text, new_length).to_owned();
            }
            pack.truncated = true;
            continue;
        }
        if !pack.entries.is_empty() {
            pack.entries.pop();
            pack.omitted_artifacts = pack.omitted_artifacts.saturating_add(1);
            pack.truncated = true;
            continue;
        }
        if !pack.citations.is_empty() {
            pack.citations.pop();
            pack.omitted_citations = pack.omitted_citations.saturating_add(1);
            pack.truncated = true;
            continue;
        }
        return Err(ArtifactContextError::BudgetExceeded);
    }
}

fn is_text_media_type(media_type: &str) -> bool {
    media_type.starts_with("text/")
        || matches!(
            media_type,
            "application/json" | "application/xml" | "application/yaml"
        )
}

fn truncate_utf8(value: &str, max_bytes: usize) -> &str {
    if value.len() <= max_bytes {
        return value;
    }
    let mut end = max_bytes;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    &value[..end]
}

#[cfg(test)]
mod tests {
    use super::*;
    use boreal_store::{
        SessionRegistrationRequest, SourceVersionRegistrationInput, WorkBatchCreateRequest,
        WorkPlanningContractWrite,
    };
    use std::collections::BTreeMap;

    struct MockPort {
        planning: PlanningContextSnapshot,
        accepted: RevisionedContextRows<ArtifactContextReference>,
        citations: RevisionedContextRows<CitationContextReference>,
        consumers: RevisionedContextRows<ArtifactConsumerReference>,
        private_authorized: bool,
    }

    impl ArtifactContextReadPort for MockPort {
        fn planning_context(
            &self,
            _project_id: &str,
            _work_id: &str,
            max_requirements: usize,
            max_inputs: usize,
        ) -> Result<PlanningContextSnapshot, ArtifactContextError> {
            assert!(self.planning.requirements.items.len() <= max_requirements);
            assert!(self.planning.inputs.items.len() <= max_inputs);
            Ok(self.planning.clone())
        }

        fn accepted_results(
            &self,
            _project_id: &str,
            _work_id: &str,
            _expected_revision: u64,
            limit: usize,
        ) -> Result<RevisionedContextRows<ArtifactContextReference>, ArtifactContextError> {
            assert!(self.accepted.items.len() <= limit);
            Ok(self.accepted.clone())
        }

        fn citations(
            &self,
            _project_id: &str,
            _work_id: &str,
            _expected_revision: u64,
            limit: usize,
        ) -> Result<RevisionedContextRows<CitationContextReference>, ArtifactContextError> {
            assert!(self.citations.items.len() <= limit);
            Ok(self.citations.clone())
        }

        fn consumers_referencing_source(
            &self,
            _project_id: &str,
            _source: &SourceIdentity,
            _expected_revision: u64,
            limit: usize,
            _offset: usize,
        ) -> Result<RevisionedContextRows<ArtifactConsumerReference>, ArtifactContextError>
        {
            assert!(self.consumers.items.len() <= limit);
            Ok(self.consumers.clone())
        }

        fn scope_authorized(
            &self,
            _project_id: &str,
            _work_id: Option<&str>,
            scope: ArtifactScope,
        ) -> Result<bool, ArtifactContextError> {
            Ok(scope == ArtifactScope::Project || self.private_authorized)
        }
    }

    fn rows<T>(items: Vec<T>, omitted_count: u64) -> RevisionedContextRows<T> {
        RevisionedContextRows {
            observed_revision: 9,
            items,
            omitted_count,
        }
    }

    fn reference(
        identity: SourceIdentity,
        role: ArtifactRole,
        scope: ArtifactScope,
        producer: Option<ArtifactProducer>,
        state: ReferenceState,
    ) -> ArtifactContextReference {
        ArtifactContextReference {
            reference_id: format!("reference-{}", role as u8),
            source: identity,
            role,
            scope,
            required: true,
            requirement_key: Some("primary".into()),
            produced_by: producer,
            rights: ArtifactRightsProvenance::default(),
            state,
        }
    }

    fn citation(
        source: Option<SourceIdentity>,
        scope: ArtifactScope,
        registered_availability: ArtifactAvailability,
    ) -> CitationContextReference {
        CitationContextReference {
            source,
            scope,
            location: "page:2".into(),
            authority: "knowledge_claim".into(),
            trust: "recorded".into(),
            state: ReferenceState::Current,
            registered_availability,
        }
    }

    fn snapshot(inputs: Vec<ArtifactContextReference>) -> PlanningContextSnapshot {
        PlanningContextSnapshot {
            project_id: "project-a".into(),
            work_id: "work-a".into(),
            observed_revision: 9,
            contract_revision: Some(3),
            requirements: rows(
                vec![RequirementContext {
                    requirement_key: "primary".into(),
                    purpose: "Create the requested output".into(),
                    required: true,
                    deliverable_type: "file".into(),
                    allowed_media_types: vec!["text/plain".into()],
                    min_count: 1,
                    max_count: 1,
                    contract_revision: 3,
                }],
                0,
            ),
            inputs: rows(inputs, 0),
        }
    }

    fn artifact_catalog() -> (SourceCatalog, SourceIdentity) {
        let catalog = SourceCatalog::default();
        let version = catalog
            .capture("project-a", "brief.txt", b"accepted brief", "text/plain")
            .unwrap();
        (catalog, SourceIdentity::from_version(&version))
    }

    #[test]
    fn context_pack_reads_exact_bytes_and_reports_revisions_and_bounds() {
        let (catalog, identity) = artifact_catalog();
        let port = MockPort {
            planning: snapshot(vec![reference(
                identity,
                ArtifactRole::InputSource,
                ArtifactScope::Project,
                None,
                ReferenceState::Current,
            )]),
            accepted: rows(Vec::new(), 0),
            citations: rows(Vec::new(), 0),
            consumers: rows(Vec::new(), 0),
            private_authorized: false,
        };
        let pack = ArtifactContextApplication::new(&catalog, &port)
            .pack(&ArtifactContextRequest::new("project-a", "work-a"))
            .unwrap();
        assert_eq!(pack.observed_revision, 9);
        assert_eq!(pack.contract_revision, Some(3));
        assert_eq!(
            pack.entries[0].availability,
            ArtifactAvailability::Available
        );
        assert_eq!(
            pack.entries[0].text_preview.as_deref(),
            Some("accepted brief")
        );
        assert_eq!(
            pack.serialized_bytes,
            serde_json::to_vec(&pack).unwrap().len()
        );
    }

    #[test]
    fn context_pack_redacts_private_metadata_when_scope_is_denied() {
        let (catalog, identity) = artifact_catalog();
        let port = MockPort {
            planning: snapshot(vec![reference(
                identity,
                ArtifactRole::InputSource,
                ArtifactScope::Private,
                None,
                ReferenceState::Archived,
            )]),
            accepted: rows(Vec::new(), 0),
            citations: rows(Vec::new(), 0),
            consumers: rows(Vec::new(), 0),
            private_authorized: false,
        };
        let pack = ArtifactContextApplication::new(&catalog, &port)
            .pack(&ArtifactContextRequest::new("project-a", "work-a"))
            .unwrap();
        let entry = &pack.entries[0];
        assert_eq!(entry.availability, ArtifactAvailability::AccessDenied);
        assert!(entry.source.is_none());
        assert_eq!(entry.reference_id, "access-denied");
    }

    #[test]
    fn context_pack_redacts_denied_private_citations() {
        let (catalog, identity) = artifact_catalog();
        let port = MockPort {
            planning: snapshot(Vec::new()),
            accepted: rows(Vec::new(), 0),
            citations: rows(
                vec![citation(
                    Some(identity),
                    ArtifactScope::Private,
                    ArtifactAvailability::Available,
                )],
                0,
            ),
            consumers: rows(Vec::new(), 0),
            private_authorized: false,
        };
        let pack = ArtifactContextApplication::new(&catalog, &port)
            .pack(&ArtifactContextRequest::new("project-a", "work-a"))
            .unwrap();
        let citation = &pack.citations[0];
        assert_eq!(citation.availability, ArtifactAvailability::AccessDenied);
        assert_eq!(citation.scope, ArtifactScope::Private);
        assert!(citation.source.is_none());
        assert!(citation.location.is_none());
        assert!(citation.authority.is_none());
        assert!(citation.trust.is_none());
    }

    #[test]
    fn context_pack_reports_missing_citation_bytes_explicitly() {
        let catalog = SourceCatalog::default();
        let identity = SourceIdentity {
            project_id: "project-a".into(),
            source_version_id: "missing-version".into(),
            content_digest: format!("sha256:{}", "b".repeat(64)),
        };
        let port = MockPort {
            planning: snapshot(Vec::new()),
            accepted: rows(Vec::new(), 0),
            citations: rows(
                vec![citation(
                    Some(identity.clone()),
                    ArtifactScope::Project,
                    ArtifactAvailability::Available,
                )],
                0,
            ),
            consumers: rows(Vec::new(), 0),
            private_authorized: false,
        };
        let pack = ArtifactContextApplication::new(&catalog, &port)
            .pack(&ArtifactContextRequest::new("project-a", "work-a"))
            .unwrap();
        assert_eq!(pack.citations[0].source, Some(identity));
        assert_eq!(
            pack.citations[0].availability,
            ArtifactAvailability::Missing
        );
        assert_eq!(pack.citations[0].location.as_deref(), Some("page:2"));
    }

    #[test]
    fn store_adapter_reads_exact_planning_identity_and_bounded_consumers() {
        // Open the supported v2 database input so the migration boundary
        // installs the production tables without requiring operator identity
        // setup for this read-adapter fixture.
        let store =
            SqliteStore::open_in_memory(include_str!("../../../project/spec/schema-v2.sql"))
                .unwrap();
        store.ensure_deliverables_schema().unwrap();
        store.ensure_knowledge_parity_schema().unwrap();
        store
            .install_feature_schema("agent_tools", 1, boreal_store::AGENT_TOOLS_SCHEMA)
            .unwrap();
        store
            .initialize_project(
                "project-a",
                "planner",
                "operator",
                "planner-credential",
                "Planner",
                "initialize-context-project",
                "sha256:initialize-context-project",
                "unix-ms:0",
            )
            .unwrap();
        let revision = store.project_revision("project-a").unwrap().0;
        store
            .register_session(SessionRegistrationRequest {
                project_id: "project-a".into(),
                session_id: "planner-session".into(),
                actor_id: "planner".into(),
                harness_id: "artifact-context-test".into(),
                operation_id: "register-context-session".into(),
                request_digest: "sha256:register-context-session".into(),
                expected_project_revision: Some(revision),
                started_at: "unix-ms:0".into(),
            })
            .unwrap();
        let digest = format!("sha256:{}", "a".repeat(64));
        store
            .register_source_version(&SourceVersionRegistrationInput {
                operation_id: "register-context-source".into(),
                project_id: "project-a".into(),
                actor_id: "planner".into(),
                source_version_id: "source-a".into(),
                origin: "/private/tmp/source-a.txt".into(),
                access_scope: "project".into(),
                content_digest: digest.clone(),
                media_type: "text/plain".into(),
                byte_count: 7,
                captured_at: "unix-ms:0".into(),
                parser_identity: "test-parser".into(),
                availability: "available".into(),
                citation_json: "[]".into(),
                request_digest: crate::sha256_content_digest(b"register-context-source"),
            })
            .unwrap();
        let expected_revision = store.project_revision("project-a").unwrap().0;
        let input_json = serde_json::to_string(&json!([{
            "project_id": "project-a",
            "source_version_id": "source-a",
            "content_digest": digest,
            "role": "context",
            "scope": "project",
            "produced_by": null,
        }]))
        .unwrap();
        let mut work = boreal_domain::WorkItem::new(
            "project-a".into(),
            "batch-task".into(),
            boreal_domain::WorkKind::Task,
            None,
            "Context fixture",
        );
        work.description = "".into();
        store
            .create_work_batch(&WorkBatchCreateRequest {
                project_id: "project-a".into(),
                actor_id: "planner".into(),
                session_id: "planner-session".into(),
                expected_project_revision: expected_revision,
                operation_id: "create-context-work".into(),
                request_digest: crate::sha256_content_digest(b"create-context-work"),
                template_id: "context-fixture".into(),
                template_version: 1,
                id_prefix: "batch".into(),
                works: vec![work],
                planning_contracts: vec![WorkPlanningContractWrite {
                    work_id: "batch-task".into(),
                    requirements_json: "[]".into(),
                    inputs_json: input_json,
                }],
                dependencies: Vec::new(),
                labels: BTreeMap::new(),
                created_at: "unix-ms:1".into(),
            })
            .unwrap();
        let port =
            StoreArtifactContextReadPort::new(&store, "project-a", |project_id, work_id, scope| {
                Ok(project_id == "project-a"
                    && work_id.is_none_or(|work_id| work_id == "batch-task")
                    && scope == ArtifactScope::Project)
            });
        let planning = port
            .planning_context("project-a", "batch-task", 4, 4)
            .unwrap();
        assert_eq!(planning.inputs.items.len(), 1);
        assert_eq!(
            planning.inputs.items[0].source.source_version_id,
            "source-a"
        );
        assert_eq!(planning.inputs.items[0].state, ReferenceState::Current);
        assert!(!planning.inputs.items[0]
            .reference_id
            .contains("source-a.txt"));
        let source = planning.inputs.items[0].source.clone();
        let consumers = port
            .consumers_referencing_source("project-a", &source, planning.observed_revision, 4, 0)
            .unwrap();
        assert_eq!(consumers.items.len(), 1);
        assert_eq!(consumers.items[0].work_id, "batch-task");
        assert_eq!(consumers.items[0].source, source);
    }

    #[test]
    fn context_pack_prioritizes_accepted_results_and_counts_omissions() {
        let (catalog, input_identity) = artifact_catalog();
        let version = catalog
            .capture(
                "project-a",
                "output.bin",
                &[0, 1, 2],
                "application/octet-stream",
            )
            .unwrap();
        let accepted = reference(
            SourceIdentity::from_version(&version),
            ArtifactRole::AcceptedSubmission,
            ArtifactScope::Project,
            Some(ArtifactProducer {
                work_id: "producer".into(),
                attempt_id: "attempt".into(),
                result_id: "result".into(),
            }),
            ReferenceState::Accepted,
        );
        let port = MockPort {
            planning: snapshot(vec![reference(
                input_identity,
                ArtifactRole::InputSource,
                ArtifactScope::Project,
                None,
                ReferenceState::Current,
            )]),
            accepted: rows(vec![accepted], 2),
            citations: rows(Vec::new(), 0),
            consumers: rows(Vec::new(), 0),
            private_authorized: false,
        };
        let mut request = ArtifactContextRequest::new("project-a", "work-a");
        request.max_entries = 1;
        let pack = ArtifactContextApplication::new(&catalog, &port)
            .pack(&request)
            .unwrap();
        assert_eq!(pack.entries.len(), 1);
        assert_eq!(pack.entries[0].role, ArtifactRole::AcceptedSubmission);
        assert_eq!(pack.entries[0].state, ReferenceState::Accepted);
        assert_eq!(pack.entries[0].text_preview, None);
        assert!(pack.omitted_artifacts >= 3);
        assert!(pack.truncated);
    }

    #[test]
    fn context_pack_rejects_mixed_project_revisions() {
        let (catalog, _) = artifact_catalog();
        let mut planning = snapshot(Vec::new());
        planning.inputs.observed_revision = 8;
        let port = MockPort {
            planning,
            accepted: rows(Vec::new(), 0),
            citations: rows(Vec::new(), 0),
            consumers: rows(Vec::new(), 0),
            private_authorized: false,
        };
        let error = ArtifactContextApplication::new(&catalog, &port)
            .pack(&ArtifactContextRequest::new("project-a", "work-a"))
            .unwrap_err();
        assert!(matches!(
            error,
            ArtifactContextError::SnapshotChanged { .. }
        ));
    }

    #[test]
    fn changed_source_keeps_consumers_pinned_and_marks_revalidation() {
        let (catalog, source) = artifact_catalog();
        let replacement_version = catalog
            .capture("project-a", "brief.txt", b"revised brief", "text/plain")
            .unwrap();
        let replacement = SourceIdentity::from_version(&replacement_version);
        let port = MockPort {
            planning: snapshot(Vec::new()),
            accepted: rows(Vec::new(), 0),
            citations: rows(Vec::new(), 0),
            consumers: rows(
                vec![
                    ArtifactConsumerReference {
                        work_id: "logo-work".into(),
                        reference_id: "brief-input".into(),
                        contract_revision: 4,
                        source: source.clone(),
                        role: ArtifactRole::InputSource,
                        scope: ArtifactScope::Project,
                    },
                    ArtifactConsumerReference {
                        work_id: "private-work".into(),
                        reference_id: "private-input".into(),
                        contract_revision: 7,
                        source: source.clone(),
                        role: ArtifactRole::InputSource,
                        scope: ArtifactScope::Private,
                    },
                ],
                3,
            ),
            private_authorized: false,
        };
        let page = ArtifactContextApplication::new(&catalog, &port)
            .consumers_for_changed_source("project-a", &source, Some(&replacement), 9, 20, 0)
            .unwrap();
        assert_eq!(page.source, source);
        assert_eq!(page.replacement, Some(replacement));
        assert_eq!(page.omitted_count, 3);
        assert_eq!(page.consumers[0].work_id.as_deref(), Some("logo-work"));
        assert_eq!(page.consumers[0].requires_revalidation, Some(true));
        assert_eq!(page.consumers[0].availability, ArtifactAvailability::Stale);
        assert_eq!(
            page.consumers[1].availability,
            ArtifactAvailability::AccessDenied
        );
        assert_eq!(page.consumers[1].work_id, None);
        assert_eq!(page.consumers[1].requires_revalidation, None);
    }
}
