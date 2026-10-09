//! Typed read-model and evidence DTOs for the v2 protocol.
//!
//! These structs mirror the versioned fixture vocabulary. They intentionally
//! contain no domain or persistence logic; validation of lifecycle policy
//! remains in the domain/application crates.

use serde::{Deserialize, Serialize};

/// Common project/actor context carried by planning and operator routes.
///
/// The application owns authorization and revision checks; this DTO only
/// freezes the wire vocabulary shared by the CLI, service, and TUI adapters.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub struct RouteContextDto {
    pub project_id: String,
    pub actor_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub harness_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_revision: Option<u64>,
    /// Additive operation identity for revisioned general-work mutations.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operation_id: Option<String>,
}

/// Read-only, versioned workflow package metadata exposed by the application
/// adapter. Workflow assets guide agents; they do not authorize lifecycle
/// transitions or carry project state.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct WorkflowInputDto {
    pub name: String,
    #[serde(rename = "type")]
    pub input_type: String,
    pub source: String,
    pub validation: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct WorkflowCriterionDto {
    pub id: String,
    #[serde(rename = "type")]
    pub criterion_type: String,
    pub required: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct WorkflowAssetDto {
    #[serde(default)]
    pub required_server_actions: Vec<String>,
    pub reference: String,
    pub kind: String,
    pub title: String,
    pub allowed_commands: Vec<String>,
    pub typed_inputs: Vec<WorkflowInputDto>,
    pub finish_criteria: Vec<WorkflowCriterionDto>,
    pub next_refs: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct WorkflowPackageDto {
    #[serde(default)]
    pub trusted: bool,
    pub schema_version: String,
    pub package_id: String,
    pub package_version: String,
    pub asset_identity: String,
    pub assets: Vec<WorkflowAssetDto>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct WorkflowShowDto {
    pub package: WorkflowPackageDto,
    pub asset: WorkflowAssetDto,
}

/// Versioned payload for the public dependency-add route.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct DependencyAddDto {
    pub project_id: String,
    pub prerequisite_id: String,
    pub dependent_id: String,
    pub actor_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_revision: Option<u64>,
}

/// Bounded read-only operator diagnostic request.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub struct DoctorDto {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub actor_id: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct StatusDto {
    pub schema_version: String,
    pub fixture_id: Option<String>,
    pub work_id: String,
    pub display_status: String,
    pub lifecycle: String,
    #[serde(default)]
    pub reason_codes: Vec<String>,
    /// Additive M02 field; absent in pre-M02 readers/fixtures.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub primary_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub diagnostics: Vec<StatusDiagnosticDto>,
    pub claimable_for_actor: bool,
    pub next_action: Option<NextActionDto>,
    pub attempt: Option<AttemptDto>,
    #[serde(default)]
    pub gates: GateSummaryDto,
    #[serde(default)]
    pub dependency: DependencyDto,
    pub as_of: String,
    pub next_status_change_at: Option<String>,
}

/// Bounded record-level read diagnostic. A diagnostic is not lifecycle state
/// and must never be used as permission to mutate the underlying record.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct StatusDiagnosticDto {
    pub work_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub code: String,
    pub detail: String,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub struct GateSummaryDto {
    #[serde(default)]
    pub open: Vec<GateDto>,
    #[serde(default)]
    pub satisfied: Vec<GateDto>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct GateDto {
    pub gate_id: String,
    pub kind: String,
    pub required: bool,
    pub state: String,
    #[serde(default)]
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub struct DependencyDto {
    #[serde(default)]
    pub prerequisites: Vec<PrerequisiteDto>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct PrerequisiteDto {
    pub work_id: String,
    pub display_status: String,
    pub satisfies_default: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct AttemptDto {
    pub attempt_id: String,
    pub fence: u64,
    pub phase: String,
    pub actor_id: Option<String>,
    pub harness_id: Option<String>,
    pub session_id: Option<String>,
    pub lease_deadline: Option<String>,
    pub hard_deadline: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct NextActionDto {
    pub directive_id: String,
    pub severity: String,
    pub title: String,
    pub instruction: String,
    pub subject: SubjectDto,
    #[serde(default)]
    pub safe_argv: Vec<String>,
    pub cwd: String,
    pub runner: String,
    pub shell: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct SubjectDto {
    #[serde(rename = "type")]
    pub subject_type: String,
    pub id: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ListDto {
    pub schema_version: String,
    pub fixture_id: Option<String>,
    pub kind: String,
    #[serde(default)]
    pub items: Vec<ListItemDto>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub diagnostics: Vec<StatusDiagnosticDto>,
    pub page: PageDto,
    pub counts: CountsDto,
    pub source_revision: u64,
    pub as_of: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ListItemDto {
    pub work_id: String,
    pub title: String,
    pub display_status: String,
    #[serde(default)]
    pub reason_codes: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct PageDto {
    pub limit: u64,
    pub returned: u64,
    pub has_more: bool,
    pub next_cursor: Option<String>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub struct CountsDto {
    pub matched: u64,
    pub queued: u64,
    pub ready: u64,
    pub blocked: u64,
    pub in_progress: u64,
    pub expired_review: u64,
    pub closed: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct AgentGuideDto {
    pub kind: String,
    pub guide_schema_version: String,
    pub context: GuidanceContextDto,
    pub status: GuidanceStatusDto,
    #[serde(default)]
    pub requirements: Vec<RequirementDto>,
    pub next_action: Option<NextActionDto>,
    pub provenance: GuidanceProvenanceDto,
    pub selection_key: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct GuidanceContextDto {
    pub mode: String,
    pub project_id: String,
    pub actor_id: String,
    pub harness_id: Option<String>,
    pub session_id: Option<String>,
    pub project_revision: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct GuidanceStatusDto {
    pub state: String,
    pub display_status: String,
    pub work_id: Option<String>,
    pub attempt_id: Option<String>,
    pub fence: Option<u64>,
    pub summary: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct RequirementDto {
    pub id: String,
    pub kind: String,
    pub severity: String,
    pub state: String,
    pub reason: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct GuidanceProvenanceDto {
    pub registry_version: String,
    pub registry_path: String,
    pub source_snapshot_hash: String,
    pub config_identity: String,
    #[serde(default)]
    pub gap_codes: Vec<String>,
    #[serde(default)]
    pub workflow_refs: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct AgentNextDto {
    pub kind: String,
    pub next_schema_version: String,
    pub mode: String,
    pub selection: String,
    pub status: NextStatusDto,
    pub reason: NextReasonDto,
    pub next_action: Option<NextActionDto>,
    #[serde(default)]
    pub context_refs: Vec<ContextRefDto>,
    pub no_goal: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct NextStatusDto {
    pub display_status: String,
    pub work_id: Option<String>,
    #[serde(default)]
    pub reason_codes: Vec<String>,
    pub claimable_for_actor: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct NextReasonDto {
    pub code: String,
    pub message: String,
    pub selection_key: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ContextRefDto {
    #[serde(rename = "type")]
    pub reference_type: String,
    pub id: String,
    pub revision: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ReceiptDto {
    pub schema_version: String,
    pub fixture_id: Option<String>,
    pub receipt_id: String,
    pub operation_id: String,
    pub subject: ReceiptSubjectDto,
    pub executable: String,
    pub argv: Vec<String>,
    pub cwd: String,
    pub exit_code: i32,
    pub started_at: String,
    pub ended_at: String,
    pub source_snapshot_hash: String,
    pub config_identity: String,
    pub environment_fingerprint: String,
    pub output_digest: String,
    pub output_ref: Option<String>,
    pub coverage: CoverageDto,
    pub attestation: String,
    pub result: String,
    pub retention: Option<String>,
}

/// Additive general-work contract vocabulary. The command receipt DTO above
/// stays unchanged: artifact inspection and human decisions never fabricate
/// executable, argv, exit-code, or trusted-runner fields.
pub const GENERAL_WORK_CONTRACT_VERSION: &str = "boreal.general-work/1";

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct GeneralWorkMutationContextDto {
    pub project_id: String,
    pub actor_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub harness_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub expected_project_revision: u64,
    pub operation_id: String,
}

/// Common mutation readback. `value` is the immutable created/read identity
/// when the operation has one, or JSON null for a fact-only mutation.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct GeneralWorkMutationResultDto<T> {
    pub schema_version: String,
    pub operation_id: String,
    pub project_revision: u64,
    pub changed: bool,
    pub value: T,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct OutputRequirementDto {
    pub requirement_key: String,
    pub purpose: String,
    pub required: bool,
    pub deliverable_type: DeliverableTypeDto,
    pub allowed_media_types: Vec<String>,
    pub minimum_count: u16,
    pub maximum_count: u16,
    #[serde(default)]
    pub criteria: Vec<ValidationCriterionDto>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeliverableTypeDto {
    Document,
    Image,
    Data,
    Archive,
    Code,
    Other,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArtifactAvailabilityDto {
    Available,
    Missing,
    Quarantined,
    Denied,
    Corrupt,
    Unsupported,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArtifactInspectionOutcomeDto {
    Passed,
    Failed,
    Unavailable,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArtifactInspectorKindDto {
    Automatic,
    Human,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArtifactDecisionKindDto {
    Approved,
    Rejected,
    NeedsRevision,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExternalWaitStateDto {
    Open,
    Resolved,
    Cancelled,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AccountableKindDto {
    PersonOrRole,
    ExternalService,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum ValidationCriterionDto {
    MinimumBytes(u64),
    MaximumBytes(u64),
    MinimumImageWidth(u32),
    MinimumImageHeight(u32),
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct RequirementSetDto {
    pub schema_version: String,
    pub context: GeneralWorkMutationContextDto,
    pub work_id: String,
    /// Current contract generation the caller expects to amend.
    pub expected_contract_revision: u64,
    pub new_contract_revision: u64,
    pub rigor_profile_id: String,
    pub rigor_profile_version: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub amendment_reason: Option<String>,
    #[serde(default)]
    pub requirements: Vec<OutputRequirementDto>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct WorkContractRevisionDto {
    pub schema_version: String,
    pub project_id: String,
    pub work_id: String,
    pub contract_revision: u64,
    pub proof_revision: u64,
    pub rigor_profile_id: String,
    pub rigor_profile_version: u32,
    pub requirements: Vec<OutputRequirementDto>,
    pub requirements_digest: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub amendment_reason: Option<String>,
    pub actor_id: String,
    pub operation_id: String,
    pub project_revision: u64,
    pub created_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct InputArtifactRefDto {
    pub source_version_id: String,
    pub content_digest: String,
    pub media_type: String,
    pub byte_count: u64,
    pub availability: ArtifactAvailabilityDto,
    pub access_scope: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub producing_work_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub producing_submission_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub producing_artifact_id: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct AcceptedInputDto {
    pub input_key: String,
    pub role: String,
    pub required: bool,
    pub artifact: InputArtifactRefDto,
    pub accepted_by: String,
    pub accepted_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct AcceptedInputSetDto {
    pub schema_version: String,
    pub context: GeneralWorkMutationContextDto,
    pub work_id: String,
    pub expected_contract_revision: u64,
    pub expected_input_revision: u64,
    pub new_input_revision: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub amendment_reason: Option<String>,
    #[serde(default)]
    pub inputs: Vec<AcceptedInputBindingDto>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct AcceptedInputSetReadDto {
    pub schema_version: String,
    pub project_id: String,
    pub work_id: String,
    pub input_revision: u64,
    pub contract_revision: u64,
    pub proof_revision: u64,
    pub bindings_digest: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub amendment_reason: Option<String>,
    pub actor_id: String,
    pub operation_id: String,
    pub project_revision: u64,
    pub created_at: String,
    #[serde(default)]
    pub inputs: Vec<AcceptedInputDto>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct AcceptedInputBindingDto {
    pub input_key: String,
    pub role: String,
    pub required: bool,
    pub source_version_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub producing_work_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub producing_submission_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub producing_artifact_id: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ProducedArtifactDto {
    pub artifact_id: String,
    pub requirement_key: String,
    pub source_version_id: String,
    pub content_digest: String,
    pub media_type: String,
    pub byte_count: u64,
    pub availability: ArtifactAvailabilityDto,
    pub access_scope: String,
    pub producer_actor_id: String,
    pub producing_work_id: String,
    pub attempt_id: String,
    pub fence: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct OutputSubmissionDto {
    pub schema_version: String,
    pub project_id: String,
    pub work_id: String,
    pub submission_id: String,
    pub attempt_id: String,
    pub fence: u64,
    pub proof_revision: u64,
    pub contract_revision: u64,
    pub input_revision: u64,
    pub rigor_profile_id: String,
    pub rigor_profile_version: u32,
    pub producer_actor_id: String,
    #[serde(default)]
    pub artifacts: Vec<ProducedArtifactDto>,
    pub artifact_set_digest: String,
    pub submitted_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ProducedArtifactRefDto {
    pub artifact_id: String,
    pub requirement_key: String,
    pub source_version_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct OutputSubmissionCommandDto {
    pub schema_version: String,
    pub context: GeneralWorkMutationContextDto,
    pub work_id: String,
    pub submission_id: String,
    pub attempt_id: String,
    pub fence: u64,
    pub proof_revision: u64,
    pub contract_revision: u64,
    pub input_revision: u64,
    #[serde(default)]
    pub artifacts: Vec<ProducedArtifactRefDto>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct CriterionObservationDto {
    pub criterion: String,
    pub outcome: ArtifactInspectionOutcomeDto,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ArtifactInspectionDto {
    pub schema_version: String,
    pub inspection_id: String,
    pub project_id: String,
    pub work_id: String,
    pub submission_id: String,
    pub artifact_id: String,
    pub artifact_digest: String,
    pub inspector_actor_id: String,
    /// `automatic` or `human`; neither value implies the other.
    pub inspector_kind: ArtifactInspectorKindDto,
    pub outcome: ArtifactInspectionOutcomeDto,
    #[serde(default)]
    pub criteria: Vec<CriterionObservationDto>,
    pub inspected_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ArtifactInspectionCommandDto {
    pub schema_version: String,
    pub context: GeneralWorkMutationContextDto,
    pub inspection_id: String,
    pub work_id: String,
    pub submission_id: String,
    pub artifact_id: String,
    pub artifact_digest: String,
    pub inspector_kind: ArtifactInspectorKindDto,
    pub outcome: ArtifactInspectionOutcomeDto,
    #[serde(default)]
    pub criteria: Vec<CriterionObservationDto>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ArtifactAcceptanceDecisionDto {
    pub schema_version: String,
    pub decision_id: String,
    pub project_id: String,
    pub work_id: String,
    pub submission_id: String,
    pub contract_revision: u64,
    pub input_revision: u64,
    pub proof_revision: u64,
    pub artifact_set_digest: String,
    pub reviewer_actor_id: String,
    pub decision: ArtifactDecisionKindDto,
    pub reason: String,
    pub decided_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ArtifactEvidenceListDto {
    pub schema_version: String,
    pub project_id: String,
    pub work_id: String,
    pub submission_id: String,
    #[serde(default)]
    pub inspections: Vec<ArtifactInspectionDto>,
    #[serde(default)]
    pub decisions: Vec<ArtifactAcceptanceDecisionDto>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ArtifactAcceptanceDecisionCommandDto {
    pub schema_version: String,
    pub context: GeneralWorkMutationContextDto,
    pub decision_id: String,
    pub work_id: String,
    pub submission_id: String,
    pub contract_revision: u64,
    pub input_revision: u64,
    pub proof_revision: u64,
    pub artifact_set_digest: String,
    pub decision: ArtifactDecisionKindDto,
    pub reason: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct OutputCoverageDto {
    pub schema_version: String,
    pub project_id: String,
    pub work_id: String,
    pub source_revision: u64,
    pub submission_id: Option<String>,
    pub artifact_set_digest: Option<String>,
    pub contract_revision: u64,
    pub input_revision: u64,
    pub proof_revision: u64,
    pub rigor_profile_id: String,
    pub outputs_accepted: bool,
    #[serde(default)]
    pub covered_requirement_keys: Vec<String>,
    #[serde(default)]
    pub missing_required: Vec<String>,
    #[serde(default)]
    pub missing_optional: Vec<String>,
    #[serde(default)]
    pub stale_or_rejected_evidence: Vec<String>,
    #[serde(default)]
    pub safe_next_operations: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum BusinessMomentDto {
    Instant { at_utc_ms: u64 },
    DateOnly { date: String, timezone: String },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ExternalWaitDto {
    pub schema_version: String,
    pub wait_id: String,
    pub project_id: String,
    pub work_id: String,
    pub category: String,
    pub reason: String,
    pub accountable_kind: AccountableKindDto,
    pub accountable_ref: String,
    pub expected_decision_or_output: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub follow_up: Option<BusinessMomentDto>,
    pub state: ExternalWaitStateDto,
    pub created_by: String,
    pub created_at: String,
    pub resolution: Option<ExternalWaitResolutionDto>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cancellation: Option<ExternalWaitCancellationDto>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ExternalWaitResolutionDto {
    pub actor_id: String,
    pub resolved_at: String,
    pub result: String,
    pub rationale: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ExternalWaitCancellationDto {
    pub actor_id: String,
    pub cancelled_at: String,
    pub reason: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ExternalWaitCreateDto {
    pub schema_version: String,
    pub context: GeneralWorkMutationContextDto,
    pub wait_id: String,
    pub work_id: String,
    pub category: String,
    pub reason: String,
    pub accountable_kind: AccountableKindDto,
    pub accountable_ref: String,
    pub expected_decision_or_output: String,
    pub follow_up: Option<BusinessMomentDto>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ExternalWaitResolveDto {
    pub schema_version: String,
    pub context: GeneralWorkMutationContextDto,
    pub work_id: String,
    pub wait_id: String,
    pub state: ExternalWaitStateDto,
    pub result: Option<String>,
    pub rationale: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ExternalWaitListDto {
    pub schema_version: String,
    pub project_id: String,
    pub source_revision: u64,
    #[serde(default)]
    pub waits: Vec<ExternalWaitDto>,
    #[serde(default)]
    pub blocked_work_ids: Vec<String>,
    #[serde(default)]
    pub due_follow_up_ids: Vec<String>,
    #[serde(default)]
    pub overdue_follow_up_ids: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ReceiptSubjectDto {
    pub work_id: String,
    pub attempt_id: String,
    pub fence: u64,
    pub gate_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct CoverageDto {
    pub kind: String,
    pub profile_id: String,
    pub profile_version: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct GateDiagnosticsDto {
    pub schema_version: String,
    pub fixture_id: Option<String>,
    pub work_id: String,
    pub profile: AcceptanceProfileDto,
    pub gates: Vec<GateDiagnosticDto>,
    pub close_intent: CloseIntentDto,
    pub result: String,
    pub error: Option<GateErrorDto>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct AcceptanceProfileDto {
    pub id: String,
    pub version: String,
    pub review_gate: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct GateDiagnosticDto {
    pub gate_id: String,
    pub kind: String,
    pub required: bool,
    pub state: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct CloseIntentDto {
    pub state: String,
    pub valid: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct GateErrorDto {
    pub code: String,
    pub missing: Vec<String>,
    pub reviewer_role: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct NotificationDto {
    pub schema_version: String,
    pub event: String,
    pub project_id: String,
    pub revision: u64,
    pub subject_type: String,
    pub subject_id: String,
    pub as_of: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fixture_dtos_round_trip_without_losing_versioned_fields() {
        let status: StatusDto = serde_json::from_str(include_str!(
            "../../../project/spec/protocol/status-dto.json"
        ))
        .unwrap();
        assert_eq!(status.schema_version, "boreal.status.v1");
        assert_eq!(status.display_status, "blocked");

        let receipt: ReceiptDto = serde_json::from_str(include_str!(
            "../../../project/spec/protocol/receipt-success.json"
        ))
        .unwrap();
        assert_eq!(receipt.result, "passed");
        assert_eq!(
            serde_json::to_value(receipt).unwrap()["subject"]["fence"],
            1
        );
    }

    #[test]
    fn guidance_fixture_decodes_as_envelope_data() {
        let envelope: crate::Envelope<serde_json::Value> = serde_json::from_str(include_str!(
            "../../../project/spec/protocol/guide-dto.json"
        ))
        .unwrap();
        let guide: AgentGuideDto = serde_json::from_value(envelope.data.unwrap()).unwrap();
        assert_eq!(guide.kind, "agent_guide");
        assert!(!guide.next_action.unwrap().shell);
    }

    #[test]
    fn planning_route_dtos_round_trip_with_optional_context() {
        let dependency = DependencyAddDto {
            project_id: "project-1".to_owned(),
            prerequisite_id: "task-a".to_owned(),
            dependent_id: "task-b".to_owned(),
            actor_id: "agent-1".to_owned(),
            expected_revision: Some(7),
        };
        let encoded = serde_json::to_value(&dependency).unwrap();
        let decoded: DependencyAddDto = serde_json::from_value(encoded).unwrap();
        assert_eq!(decoded, dependency);

        let doctor: DoctorDto = serde_json::from_value(serde_json::json!({
            "project_id": "project-1"
        }))
        .unwrap();
        assert_eq!(doctor.project_id.as_deref(), Some("project-1"));
        assert_eq!(doctor.actor_id, None);
    }

    #[test]
    fn general_work_wire_types_are_additive_and_reject_unknown_enum_values() {
        let mut value = serde_json::json!({
            "requirement_key":"logo.master",
            "purpose":"Approved master asset",
            "required":true,
            "deliverable_type":"image",
            "allowed_media_types":["image/png"],
            "minimum_count":1,
            "maximum_count":2,
            "criteria":[{"kind":"maximum_bytes","value":5000000}],
            "future_field":{"added":"later"}
        });
        let requirement: OutputRequirementDto = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(requirement.deliverable_type, DeliverableTypeDto::Image);
        assert_eq!(requirement.minimum_count, 1);

        value["deliverable_type"] = serde_json::json!("unknown_asset_kind");
        assert!(serde_json::from_value::<OutputRequirementDto>(value).is_err());

        let mut decision = serde_json::json!({
            "schema_version":"boreal.general-work/1",
            "decision_id":"decision-1",
            "project_id":"project-1",
            "work_id":"work-1",
            "submission_id":"submission-1",
            "contract_revision":2,
            "input_revision":3,
            "proof_revision":4,
            "artifact_set_digest":"sha256:abc",
            "reviewer_actor_id":"reviewer-1",
            "decision":"approved",
            "reason":"checked exact output",
            "decided_at":"unix-ms:10"
        });
        let parsed: ArtifactAcceptanceDecisionDto =
            serde_json::from_value(decision.clone()).unwrap();
        assert_eq!(parsed.proof_revision, 4);
        decision["proof_revision"] = serde_json::json!(5);
        assert_eq!(
            serde_json::from_value::<ArtifactAcceptanceDecisionDto>(decision)
                .unwrap()
                .proof_revision,
            5
        );

        let command_context: GeneralWorkMutationContextDto =
            serde_json::from_value(serde_json::json!({
                "project_id":"project-1",
                "actor_id":"operator-1",
                "harness_id":null,
                "session_id":"session-1",
                "expected_project_revision":9,
                "operation_id":"op-1"
            }))
            .unwrap();
        assert_eq!(command_context.expected_project_revision, 9);
        assert_eq!(command_context.operation_id, "op-1");
        assert!(
            serde_json::from_value::<GeneralWorkMutationContextDto>(serde_json::json!({
                "project_id":"project-1",
                "actor_id":"operator-1",
                "session_id":"session-1",
                "expected_project_revision":9
            }))
            .is_err()
        );

        let input_set: AcceptedInputSetDto = serde_json::from_value(serde_json::json!({
            "schema_version":"boreal.general-work/1",
            "context":{
                "project_id":"project-1","actor_id":"operator-1",
                "expected_project_revision":9,"operation_id":"op-input"
            },
            "work_id":"work-1","expected_contract_revision":1,
            "expected_input_revision":0,"new_input_revision":1,
            "inputs":[{
                "input_key":"brief","role":"creative brief","required":true,
                "source_version_id":"source-v2","accepted_by":"forged-client-value"
            }]
        }))
        .unwrap();
        assert_eq!(input_set.inputs[0].source_version_id, "source-v2");
        let encoded = serde_json::to_value(input_set).unwrap();
        assert!(encoded["inputs"][0].get("accepted_by").is_none());

        let date: BusinessMomentDto = serde_json::from_value(serde_json::json!({
            "kind":"date_only","date":"2026-10-09","timezone":"America/Regina"
        }))
        .unwrap();
        assert!(matches!(date, BusinessMomentDto::DateOnly { .. }));
    }
}

/// Explicit optimistic binding for immutable completion decisions. Caller and
/// project identity belong to the authenticated envelope, never this payload.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CompletionCommandDto {
    pub kind: String,
    pub work_id: String,
    pub expected_revision: u64,
    pub expected_entity_revision: u64,
    pub expected_proof_revision: u64,
    #[serde(default)]
    pub submission_id: Option<String>,
    #[serde(default)]
    pub target_id: Option<String>,
    #[serde(default)]
    pub predecessor_revision: Option<u64>,
    #[serde(default)]
    pub exception_reason: Option<String>,
    pub reason: String,
    #[serde(default)]
    pub expires_at_ms: Option<u64>,
    pub confirmed: bool,
}

/// Server-read identity boundary for cached snapshots and operation readback.
#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProjectReadbackScope {
    pub project_id: String,
    pub database_instance_id: String,
    pub restore_epoch: u64,
    pub workspace_binding_digest: String,
}

/// Local wall-clock input is resolved by the application against its actual
/// TZif bytes. Clients cannot supply an invented UTC offset or tzdb identity.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LocalDateTimeDto {
    pub year: i32,
    pub month: u8,
    pub day: u8,
    pub hour: u8,
    pub minute: u8,
    #[serde(default)]
    pub second: u8,
}
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum CycleOperationDto {
    Create {
        cycle_id: String,
        name: String,
        #[serde(default)]
        goal: String,
        timezone: String,
        start: LocalDateTimeDto,
        end: Option<LocalDateTimeDto>,
        #[serde(default)]
        later_fold: bool,
    },
    Activate {
        cycle_id: String,
    },
    Close {
        cycle_id: String,
    },
    Cancel {
        cycle_id: String,
    },
    Assign {
        cycle_id: String,
        assignment_id: String,
        work_id: String,
    },
    Commit {
        cycle_id: String,
        assignment_id: String,
    },
    Remove {
        cycle_id: String,
        assignment_id: String,
    },
    CarryOver {
        cycle_id: String,
        assignment_id: String,
        successor_cycle_id: String,
        successor_assignment_id: String,
    },
    MapLegacy {
        cycle_id: String,
        work_id: String,
    },
}
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CycleCommandDto {
    pub expected_revision: u64,
    pub reason: String,
    pub confirmed: bool,
    pub change: CycleOperationDto,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MemoryCitationDto {
    pub source_version_id: String,
    pub location: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum MemoryOperationDto {
    Draft {
        draft_id: String,
        entry_id: String,
        title: String,
        body: String,
        citations: Vec<MemoryCitationDto>,
    },
    Review {
        draft_id: String,
        decision: String,
        reason: String,
    },
    Publish {
        review_id: String,
        expected_manifest_identity: String,
    },
    Show {
        draft_id: String,
    },
    Search {
        text: Option<String>,
        entry_id: Option<String>,
        source_version_id: Option<String>,
        requested_git_revision: Option<String>,
        limit: Option<usize>,
    },
    Readback {
        operation_id: String,
    },
    Reconcile {
        operation_id: String,
    },
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MemoryCommandDto {
    pub expected_revision: Option<u64>,
    pub confirmed: bool,
    pub change: MemoryOperationDto,
}

/// Versioned facts accompany actions; clients must not interpret diagnostic states as permission.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum CanonicalFactDto {
    Present { value: serde_json::Value },
    Absent { diagnostic: serde_json::Value },
    Unreadable { diagnostic: serde_json::Value },
    Stale { diagnostic: serde_json::Value },
    Failed { diagnostic: serde_json::Value },
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CanonicalDecisionFactsDto {
    pub schema_version: String,
    pub subject: serde_json::Value,
    pub snapshot_revision: u64,
    pub clock: serde_json::Value,
    pub availability: String,
    pub lifecycle: CanonicalFactDto,
    pub authority: CanonicalFactDto,
    pub requirements: CanonicalFactDto,
    pub dependencies: CanonicalFactDto,
    pub holds: CanonicalFactDto,
    pub execution: CanonicalFactDto,
    pub submission: CanonicalFactDto,
    pub review: CanonicalFactDto,
    pub recovery: CanonicalFactDto,
    pub integrity: serde_json::Value,
    pub permitted_actions_input: serde_json::Value,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct WorkActionDescriptorDto {
    pub action: String,
    pub target: serde_json::Value,
    pub expected_project_revision: u64,
    pub expected_entity_revision: Option<u64>,
    pub expected_proof_revision: Option<u64>,
    pub attempt: Option<serde_json::Value>,
    pub required_roles: Vec<String>,
    pub required_inputs: Vec<String>,
    pub confirmation: Option<String>,
    pub read_only: bool,
    pub recovery: bool,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DeniedWorkActionDto {
    pub descriptor: WorkActionDescriptorDto,
    pub reason: serde_json::Value,
    pub reason_code: String,
    pub recovery: Vec<String>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct WorkActionDecisionDto {
    pub allowed: Vec<WorkActionDescriptorDto>,
    pub denied: Vec<DeniedWorkActionDto>,
}
