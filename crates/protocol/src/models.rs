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
    /// Civil-time schedule classifications from the canonical status decision.
    #[serde(default)]
    pub due_today: bool,
    #[serde(default)]
    pub overdue: bool,
    /// Open external waits that currently block this work item.
    #[serde(default)]
    pub blocking_external_wait_ids: Vec<String>,
    /// Open external waits whose local follow-up date has arrived.
    #[serde(default)]
    pub follow_up_due_wait_ids: Vec<String>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operator_request: Option<GuidanceOperatorRequestDto>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action_descriptor: Option<AgentActionDescriptorDto>,
    pub provenance: GuidanceProvenanceDto,
    pub selection_key: String,
}

/// Typed input value categories for a trusted, revision-bound guided action.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentActionInputValueTypeDto {
    UnsignedInteger,
    Identifier,
    SourceVersion,
    ConfigIdentity,
    Boolean,
    Text,
    EvidencePayload,
    ReviewDecision,
    RecoveryDisposition,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentActionRoleDto {
    Agent,
    Reviewer,
    Operator,
    Publisher,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct AgentActionTargetDto {
    pub project_id: String,
    pub work_id: String,
    pub entity_revision: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct AgentActionAttemptDto {
    pub attempt_id: String,
    pub fence: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct AgentActionInputDto {
    pub kind: String,
    pub value_type: AgentActionInputValueTypeDto,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GuidanceTransportDto {
    DirectCli,
    UnixSocketService,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct GuidanceTransportContextDto {
    pub endpoint_id: String,
    pub request_id: String,
    pub operation_id: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GuidanceOperatorRequestKindDto {
    CaptureProjectSource,
}

/// Typed operator input required before an agent can safely claim work.
/// This is guidance only; the public source workflow still enforces capture
/// authorization and project revision checks.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct GuidanceOperatorRequestDto {
    pub schema_version: String,
    pub kind: GuidanceOperatorRequestKindDto,
    pub required_role: AgentActionRoleDto,
    pub project_id: String,
    pub work_id: String,
    pub expected_project_revision: u64,
    pub required_inputs: Vec<AgentActionInputDto>,
    pub instruction: String,
}

/// Full server-produced action descriptor carried alongside agent guidance.
/// It is advisory context; the application rechecks authorization and every
/// revision when an action request is submitted.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct AgentActionDescriptorDto {
    pub schema_version: String,
    pub action: String,
    pub target: AgentActionTargetDto,
    pub expected_project_revision: u64,
    pub expected_entity_revision: u64,
    pub expected_proof_revision: Option<u64>,
    pub attempt: Option<AgentActionAttemptDto>,
    pub required_roles: Vec<AgentActionRoleDto>,
    pub required_inputs: Vec<AgentActionInputDto>,
    pub confirmation: Option<String>,
    pub read_only: bool,
    pub recovery: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct GuidanceContextDto {
    pub mode: String,
    pub project_id: String,
    pub actor_id: String,
    pub harness_id: Option<String>,
    pub session_id: Option<String>,
    pub project_revision: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transport: Option<GuidanceTransportDto>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transport_context: Option<GuidanceTransportContextDto>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operator_request: Option<GuidanceOperatorRequestDto>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action_descriptor: Option<AgentActionDescriptorDto>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context: Option<GuidanceContextDto>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provenance: Option<GuidanceProvenanceDto>,
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

pub const CLOSE_READINESS_READBACK_SCHEMA_VERSION: &str = "boreal.close_readiness_readback.v1";

/// One gate evaluated from the canonical close-readiness snapshot.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloseReadinessGateDto {
    pub gate_id: String,
    pub state: String,
    #[serde(default)]
    pub reason_code: Option<String>,
}

/// One exact blocker returned by the application-owned close-readiness
/// evaluation. Gate IDs are present only for gate-specific gaps.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloseReadinessGapDto {
    pub gap_code: String,
    #[serde(default)]
    pub gate_id: Option<String>,
}

/// Atomic close-readiness readback. Project, work, current attempt/fence and
/// revision are returned from one application snapshot, never caller facts.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloseReadinessReadbackDto {
    pub schema_version: String,
    pub project_revision: u64,
    pub work_id: String,
    #[serde(default)]
    pub current_attempt_id: Option<String>,
    #[serde(default)]
    pub current_fence: Option<u64>,
    pub ready: bool,
    pub gates: Vec<CloseReadinessGateDto>,
    pub gaps: Vec<CloseReadinessGapDto>,
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

    fn assert_versioned_dto_round_trip<T>(dto: &T, schema_version: &str)
    where
        T: serde::Serialize + serde::de::DeserializeOwned + Eq + std::fmt::Debug,
    {
        let encoded = serde_json::to_value(dto).unwrap();
        assert_eq!(encoded["schema_version"], schema_version);
        assert_eq!(serde_json::from_value::<T>(encoded.clone()).unwrap(), *dto);
        let mut unknown = encoded;
        unknown["unexpected_field"] = serde_json::json!(true);
        assert!(serde_json::from_value::<T>(unknown).is_err());
    }

    #[test]
    fn close_readiness_readback_is_versioned_strict_and_round_trips_exact_gaps() {
        let readback = CloseReadinessReadbackDto {
            schema_version: CLOSE_READINESS_READBACK_SCHEMA_VERSION.to_owned(),
            project_revision: 17,
            work_id: "work-1".to_owned(),
            current_attempt_id: Some("attempt-2".to_owned()),
            current_fence: Some(3),
            ready: false,
            gates: vec![CloseReadinessGateDto {
                gate_id: "verify".to_owned(),
                state: "open".to_owned(),
                reason_code: Some("receipt_missing".to_owned()),
            }],
            gaps: vec![
                CloseReadinessGapDto {
                    gap_code: "gate_unsatisfied".to_owned(),
                    gate_id: Some("verify".to_owned()),
                },
                CloseReadinessGapDto {
                    gap_code: "summary_missing".to_owned(),
                    gate_id: None,
                },
            ],
        };
        assert_versioned_dto_round_trip(&readback, CLOSE_READINESS_READBACK_SCHEMA_VERSION);

        let mut nested_unknown = serde_json::to_value(readback).unwrap();
        nested_unknown["gaps"][0]["caller_supplied"] = serde_json::json!(true);
        assert!(serde_json::from_value::<CloseReadinessReadbackDto>(nested_unknown).is_err());
    }

    #[test]
    fn source_and_intake_route_dtos_are_versioned_strict_and_round_trip() {
        let source_lookup = SourceVersionLookupDto {
            schema_version: SOURCE_LOOKUP_SCHEMA_VERSION.to_owned(),
            source_version_id: "source-version-1".to_owned(),
        };
        assert_versioned_dto_round_trip(&source_lookup, SOURCE_LOOKUP_SCHEMA_VERSION);

        let source_show = SourceShowReadbackDto {
            schema_version: SOURCE_SHOW_READBACK_SCHEMA_VERSION.to_owned(),
            source: SourceVersionMetadataDto {
                source_version_id: "source-version-1".to_owned(),
                origin: "file:brief.md".to_owned(),
                media_type: "text/markdown".to_owned(),
                byte_count: 9,
                content_digest: "sha256:abc".to_owned(),
                availability: SourceAvailabilityDto::Available,
                parser_identity: None,
            },
            sqlite_registration: Some(SourceVersionRegistrationDto {
                source_version_id: "source-version-1".to_owned(),
                origin: "file:brief.md".to_owned(),
                access_scope: "project".to_owned(),
                content_digest: "sha256:abc".to_owned(),
                media_type: "text/markdown".to_owned(),
                byte_count: 9,
                captured_at: "unix-ms:1".to_owned(),
                parser_identity: "boreal.source/1".to_owned(),
                availability: "available".to_owned(),
            }),
        };
        assert_versioned_dto_round_trip(&source_show, SOURCE_SHOW_READBACK_SCHEMA_VERSION);

        let source_verify = SourceVerifyReadbackDto {
            schema_version: SOURCE_VERIFY_READBACK_SCHEMA_VERSION.to_owned(),
            source_version_id: "source-version-1".to_owned(),
            availability: SourceAvailabilityDto::Available,
            verified_digest: Some("sha256:abc".to_owned()),
            byte_count: 9,
            verified: true,
        };
        assert_versioned_dto_round_trip(&source_verify, SOURCE_VERIFY_READBACK_SCHEMA_VERSION);

        let bucket_request = IntakeBucketCreateDto {
            schema_version: INTAKE_BUCKET_CREATE_SCHEMA_VERSION.to_owned(),
            expected_revision: 4,
            bucket_id: "inbox".to_owned(),
            name: "Inbox".to_owned(),
        };
        assert_versioned_dto_round_trip(&bucket_request, INTAKE_BUCKET_CREATE_SCHEMA_VERSION);
        let bucket_readback = IntakeBucketReadbackDto {
            schema_version: INTAKE_BUCKET_READBACK_SCHEMA_VERSION.to_owned(),
            bucket_id: "inbox".to_owned(),
            name: "Inbox".to_owned(),
            archived: false,
            replayed: true,
        };
        assert_versioned_dto_round_trip(&bucket_readback, INTAKE_BUCKET_READBACK_SCHEMA_VERSION);

        let capture_request = IntakeCaptureDto {
            schema_version: INTAKE_CAPTURE_SCHEMA_VERSION.to_owned(),
            expected_revision: 5,
            intake_id: "intake-1".to_owned(),
            bucket_id: "inbox".to_owned(),
            kind: IntakeKindDto::Question,
            content: "Which review criteria apply?".to_owned(),
        };
        assert_versioned_dto_round_trip(&capture_request, INTAKE_CAPTURE_SCHEMA_VERSION);
        let capture_readback = IntakeCaptureReadbackDto {
            schema_version: INTAKE_CAPTURE_READBACK_SCHEMA_VERSION.to_owned(),
            intake_id: "intake-1".to_owned(),
            bucket_id: "inbox".to_owned(),
            kind: IntakeKindDto::Question,
            lifecycle: "captured".to_owned(),
            content_revision: 1,
            content_digest: "sha256:def".to_owned(),
            replayed: false,
        };
        assert_versioned_dto_round_trip(&capture_readback, INTAKE_CAPTURE_READBACK_SCHEMA_VERSION);

        let final_result_request = FinalResultCaptureRequestDto {
            schema_version: FINAL_RESULT_CAPTURE_SCHEMA_VERSION.to_owned(),
            work_id: "work-1".to_owned(),
            attempt_id: "attempt-1".to_owned(),
            fence: 3,
            expected_project_revision: 12,
            expected_entity_revision: 4,
            expected_proof_revision: 6,
            source_version_id: "result-source-1".to_owned(),
            content_digest: "sha256:fed".to_owned(),
        };
        assert_versioned_dto_round_trip(&final_result_request, FINAL_RESULT_CAPTURE_SCHEMA_VERSION);
        let final_result_readback = FinalResultCaptureReadbackDto {
            schema_version: FINAL_RESULT_CAPTURE_READBACK_SCHEMA_VERSION.to_owned(),
            binding_id: "binding-1".to_owned(),
            work_id: "work-1".to_owned(),
            attempt_id: "attempt-1".to_owned(),
            fence: 3,
            source_version_id: "result-source-1".to_owned(),
            content_digest: "sha256:fed".to_owned(),
            config_identity: "config-1".to_owned(),
            profile_id: "focused".to_owned(),
            profile_version: 1,
            profile_digest: "sha256:profile".to_owned(),
            entity_revision: 4,
            prior_proof_revision: 5,
            proof_revision: 6,
            request_digest: "sha256:request".to_owned(),
            project_revision: 12,
            created_at: "unix-ms:10".to_owned(),
            lineage_pending: Some("relationship repair pending".to_owned()),
            replayed: false,
        };
        assert_versioned_dto_round_trip(
            &final_result_readback,
            FINAL_RESULT_CAPTURE_READBACK_SCHEMA_VERSION,
        );

        let artifact_request = ArtifactResultBindRequestDto {
            schema_version: ARTIFACT_RESULT_BIND_SCHEMA_VERSION.to_owned(),
            work_id: "work-report".to_owned(),
            attempt_id: "attempt-7".to_owned(),
            fence: 7,
            expected_project_revision: 23,
            expected_entity_revision: 8,
            expected_proof_revision: 11,
            result_id: "result-report".to_owned(),
            contract_revision: 2,
            outputs: vec![ArtifactResultOutputRequestDto {
                requirement_key: "report".to_owned(),
                source: ArtifactResultSourceIdentityDto {
                    project_id: "project-demo".to_owned(),
                    source_version_id: "source-report".to_owned(),
                    content_digest: "sha256:report".to_owned(),
                },
                relationship_id: "report-v1".to_owned(),
                rights: ArtifactResultRightsDto {
                    attribution: Some("agent-1".to_owned()),
                    rights_statement: Some("created for this project".to_owned()),
                    license: None,
                },
            }],
            attestation: Some(ArtifactResultAttestationDto {
                statement: "The report is complete.".to_owned(),
            }),
        };
        assert_versioned_dto_round_trip(&artifact_request, ARTIFACT_RESULT_BIND_SCHEMA_VERSION);

        let artifact_record = ArtifactResultRecordDto {
            result_id: "result-report".to_owned(),
            project_id: "project-demo".to_owned(),
            work_id: "work-report".to_owned(),
            attempt_id: "attempt-7".to_owned(),
            fence: 7,
            entity_revision: 8,
            proof_revision: 12,
            actor_id: "agent-1".to_owned(),
            session_id: "session-1".to_owned(),
            source_version_id: "source-claim".to_owned(),
            config_identity: "config-1".to_owned(),
            profile_id: "validated-deliverables".to_owned(),
            profile_version: 1,
            profile_digest: "sha256:profile".to_owned(),
            contract_revision: 2,
            result_digest: "sha256:result".to_owned(),
            outputs: vec![ArtifactResultOutputReadbackDto {
                requirement_key: "report".to_owned(),
                relationship_id: "report-v1".to_owned(),
                rights: ArtifactResultRightsDto {
                    attribution: Some("agent-1".to_owned()),
                    rights_statement: Some("created for this project".to_owned()),
                    license: None,
                },
                source: ArtifactResultSourceIdentityDto {
                    project_id: "project-demo".to_owned(),
                    source_version_id: "source-report".to_owned(),
                    content_digest: "sha256:report".to_owned(),
                },
                media_type: "text/plain".to_owned(),
                availability: ArtifactResultAvailabilityDto::Available,
                media_type_allowed: true,
                byte_count: 128,
                criteria: vec![ArtifactResultCriterionDto {
                    criterion_id: "min_bytes".to_owned(),
                    passed: true,
                    observed: "128".to_owned(),
                }],
            }],
            attestation: Some(ArtifactResultAttestationDto {
                statement: "The report is complete.".to_owned(),
            }),
            operation_id: "op-result-bind".to_owned(),
            request_digest: "sha256:request".to_owned(),
            project_revision: 24,
            created_at: "unix-ms:123".to_owned(),
            replayed: false,
        };
        let bind_readback = ArtifactResultBindReadbackDto {
            schema_version: ARTIFACT_RESULT_BIND_READBACK_SCHEMA_VERSION.to_owned(),
            result: artifact_record.clone(),
            source_relationship_ids: vec!["report-v1".to_owned()],
            lineage_pending: vec![],
        };
        assert_versioned_dto_round_trip(
            &bind_readback,
            ARTIFACT_RESULT_BIND_READBACK_SCHEMA_VERSION,
        );
        let artifact_readback = ArtifactResultReadbackDto {
            schema_version: ARTIFACT_RESULT_READBACK_SCHEMA_VERSION.to_owned(),
            result: artifact_record,
        };
        assert_versioned_dto_round_trip(
            &artifact_readback,
            ARTIFACT_RESULT_READBACK_SCHEMA_VERSION,
        );

        let mut request_with_host_path = serde_json::to_value(artifact_request).unwrap();
        request_with_host_path["outputs"][0]["source"]["catalog_root"] =
            serde_json::json!("/host/local/path");
        assert!(
            serde_json::from_value::<ArtifactResultBindRequestDto>(request_with_host_path).is_err()
        );
        let mut readback_with_unknown = serde_json::to_value(artifact_readback).unwrap();
        readback_with_unknown["result"]["outputs"][0]["inspection_claim"] =
            serde_json::json!("caller supplied");
        assert!(
            serde_json::from_value::<ArtifactResultReadbackDto>(readback_with_unknown).is_err()
        );
    }

    #[test]
    fn fixture_dtos_round_trip_without_losing_versioned_fields() {
        let status: StatusDto = serde_json::from_str(include_str!(
            "../../../project/spec/protocol/status-dto.json"
        ))
        .unwrap();
        assert_eq!(status.schema_version, "boreal.status.v1");
        assert_eq!(status.display_status, "blocked");
        assert!(!status.due_today);
        assert!(!status.overdue);
        assert!(status.blocking_external_wait_ids.is_empty());
        assert!(status.follow_up_due_wait_ids.is_empty());

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
    fn status_facts_default_for_legacy_payloads_and_round_trip_additively() {
        let mut legacy: serde_json::Value = serde_json::from_str(include_str!(
            "../../../project/spec/protocol/status-dto.json"
        ))
        .unwrap();
        let decoded: StatusDto = serde_json::from_value(legacy.clone()).unwrap();
        assert!(!decoded.due_today);
        assert!(!decoded.overdue);
        assert!(decoded.blocking_external_wait_ids.is_empty());
        assert!(decoded.follow_up_due_wait_ids.is_empty());

        legacy["due_today"] = serde_json::json!(true);
        legacy["overdue"] = serde_json::json!(true);
        legacy["blocking_external_wait_ids"] = serde_json::json!(["wait-1", "wait-2"]);
        legacy["follow_up_due_wait_ids"] = serde_json::json!(["wait-2"]);
        let decoded: StatusDto = serde_json::from_value(legacy).unwrap();
        assert!(decoded.due_today);
        assert!(decoded.overdue);
        assert_eq!(decoded.blocking_external_wait_ids, ["wait-1", "wait-2"]);
        assert_eq!(decoded.follow_up_due_wait_ids, ["wait-2"]);

        let encoded = serde_json::to_value(decoded).unwrap();
        assert_eq!(encoded["due_today"], true);
        assert_eq!(encoded["overdue"], true);
        assert_eq!(
            encoded["blocking_external_wait_ids"],
            serde_json::json!(["wait-1", "wait-2"])
        );
        assert_eq!(
            encoded["follow_up_due_wait_ids"],
            serde_json::json!(["wait-2"])
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
        assert!(!guide.next_action.as_ref().unwrap().shell);
        assert_eq!(
            guide
                .context
                .transport_context
                .as_ref()
                .unwrap()
                .request_id,
            guide
                .context
                .transport_context
                .as_ref()
                .unwrap()
                .operation_id
        );
        assert!(guide.action_descriptor.is_none());
        assert!(serde_json::to_value(&guide)
            .unwrap()
            .get("action_descriptor")
            .is_none());
    }

    #[test]
    fn guide_and_next_round_trip_versioned_action_descriptors_additively() {
        let descriptor = AgentActionDescriptorDto {
            schema_version: "boreal.agent_action_descriptor.v1".to_owned(),
            action: "checkpoint".to_owned(),
            target: AgentActionTargetDto {
                project_id: "project-1".to_owned(),
                work_id: "work-1".to_owned(),
                entity_revision: 5,
            },
            expected_project_revision: 11,
            expected_entity_revision: 5,
            expected_proof_revision: Some(3),
            attempt: Some(AgentActionAttemptDto {
                attempt_id: "attempt-1".to_owned(),
                fence: 7,
            }),
            required_roles: vec![AgentActionRoleDto::Agent],
            required_inputs: vec![
                AgentActionInputDto {
                    kind: "expected_project_revision".to_owned(),
                    value_type: AgentActionInputValueTypeDto::UnsignedInteger,
                },
                AgentActionInputDto {
                    kind: "source_version".to_owned(),
                    value_type: AgentActionInputValueTypeDto::SourceVersion,
                },
                AgentActionInputDto {
                    kind: "config_identity".to_owned(),
                    value_type: AgentActionInputValueTypeDto::ConfigIdentity,
                },
            ],
            confirmation: Some("Record this checkpoint?".to_owned()),
            read_only: false,
            recovery: false,
        };

        let guide_envelope: crate::Envelope<serde_json::Value> = serde_json::from_str(
            include_str!("../../../project/spec/protocol/guide-dto.json"),
        )
        .unwrap();
        let mut guide: AgentGuideDto =
            serde_json::from_value(guide_envelope.data.unwrap()).unwrap();
        assert!(guide.action_descriptor.is_none());
        guide.action_descriptor = Some(descriptor.clone());
        let guide_data = serde_json::to_value(&guide).unwrap();
        assert_eq!(
            guide_data["action_descriptor"]["schema_version"],
            "boreal.agent_action_descriptor.v1"
        );
        assert_eq!(
            guide_data["action_descriptor"]["required_inputs"][0]["value_type"],
            "unsigned_integer"
        );
        let decoded_guide: AgentGuideDto = serde_json::from_value(guide_data).unwrap();
        assert_eq!(decoded_guide.action_descriptor, Some(descriptor.clone()));

        let next_envelope: crate::Envelope<serde_json::Value> =
            serde_json::from_str(include_str!("../../../project/spec/protocol/next-dto.json"))
                .unwrap();
        let mut next: AgentNextDto = serde_json::from_value(next_envelope.data.unwrap()).unwrap();
        assert!(next.action_descriptor.is_none());
        assert_eq!(
            next.context.as_ref().unwrap().transport,
            Some(GuidanceTransportDto::UnixSocketService)
        );
        let transport_context = next
            .context
            .as_ref()
            .unwrap()
            .transport_context
            .as_ref()
            .unwrap();
        assert_eq!(transport_context.endpoint_id, "service:sha256:fixture-endpoint");
        assert_eq!(
            transport_context.request_id,
            transport_context.operation_id
        );
        assert_eq!(
            next.provenance.as_ref().unwrap().source_snapshot_hash,
            "unbound"
        );
        assert!(serde_json::to_value(&next)
            .unwrap()
            .get("action_descriptor")
            .is_none());
        next.action_descriptor = Some(descriptor.clone());
        let next_data = serde_json::to_value(&next).unwrap();
        assert_eq!(
            next_data["action_descriptor"]["target"]["entity_revision"],
            5
        );
        assert_eq!(
            next_data["action_descriptor"]["required_inputs"][1]["value_type"],
            "source_version"
        );
        assert_eq!(
            next_data["action_descriptor"]["required_inputs"][2]["value_type"],
            "config_identity"
        );
        assert_eq!(
            serde_json::from_value::<AgentNextDto>(next_data)
                .unwrap()
                .action_descriptor,
            Some(descriptor)
        );
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
    fn bw_s12_capability_fixture_negotiates_only_advertised_v2_features() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../project/spec/workflows/capabilities.json.fixture"
        ))
        .unwrap();
        let offer: crate::CapabilitySet =
            serde_json::from_value(fixture["protocol_offer"].clone()).unwrap();
        let peer: crate::CapabilitySet =
            serde_json::from_value(fixture["peer_offer"].clone()).unwrap();
        let negotiated = offer.negotiate(&peer).unwrap();
        assert_eq!(negotiated.api_version, "2");
        assert_eq!(negotiated.schema_version, "boreal.protocol.envelope.v1");
        assert!(negotiated.capabilities.is_empty());
        assert_eq!(
            fixture["contract_status"]["optional_v4_capabilities"],
            "unavailable"
        );
    }

    #[test]
    fn bw_s12_cli_contract_indexes_the_five_external_fixtures() {
        let contract: serde_json::Value =
            serde_json::from_str(include_str!("../../../project/spec/cli-contract.json")).unwrap();
        let fixtures = &contract["bw_s12_t01_callable_contract"]["fixtures"];
        let expected = [
            "workflows/capabilities.json.fixture",
            "workflows/identity.json.fixture",
            "workflows/general-work.json.fixture",
            "workflows/artifacts-acceptance.json.fixture",
            "workflows/operations.json.fixture",
        ];
        let declared = fixtures
            .as_object()
            .unwrap()
            .values()
            .map(|value| value.as_str().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(declared.len(), expected.len());
        for path in expected {
            assert!(declared.contains(&path));
        }
    }

    #[test]
    fn bw_s12_identity_fixture_keeps_project_session_attempt_and_proof_bound() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../project/spec/workflows/identity.json.fixture"
        ))
        .unwrap();
        let context: RouteContextDto =
            serde_json::from_value(fixture["route_context"].clone()).unwrap();
        let attempt: AttemptDto = serde_json::from_value(fixture["attempt"].clone()).unwrap();
        let proof: ReceiptSubjectDto =
            serde_json::from_value(fixture["proof_subject"].clone()).unwrap();
        assert_eq!(context.project_id, "project_demo");
        assert_eq!(context.actor_id, "actor_agent_01");
        assert_eq!(context.session_id.as_deref(), Some("session_agent_01"));
        assert_eq!(context.expected_revision, Some(42));
        assert_eq!(attempt.fence, 7);
        assert_eq!(attempt.attempt_id, proof.attempt_id);
        assert_eq!(attempt.fence, proof.fence);
        assert_eq!(attempt.session_id.as_deref(), context.session_id.as_deref());
    }

    #[test]
    fn bw_s12_general_work_fixture_marks_untyped_v4_fields_unavailable() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../project/spec/workflows/general-work.json.fixture"
        ))
        .unwrap();
        let create = &fixture["create_work_service_data"];
        let edit = &fixture["work_edit_service_data"];
        assert_eq!(create["command"], "create_work");
        assert_eq!(create["profile"], "focused");
        assert_eq!(create["profile_version"], "1");
        assert_eq!(create["expected_revision"], 42);
        assert_eq!(edit["work_id"], "work_task_01");
        assert_eq!(edit["expected_revision"], 42);
        assert_eq!(
            fixture["claim_input_binding"]["source_version_id"],
            "source_version_01"
        );
        assert_eq!(
            fixture["v4_optional_contracts"]["deliverable_requirements"]["status"],
            "unavailable"
        );
        assert_eq!(
            fixture["v4_optional_contracts"]["accepted_input_schema"]["status"],
            "partial"
        );
        assert_eq!(
            fixture["v4_optional_contracts"]["output_submission_and_inspection"]["status"],
            "unavailable"
        );
        assert!(create.get("deliverable_requirements").is_none());
        assert!(create.get("accepted_inputs").is_none());
    }

    #[test]
    fn bw_s12_artifact_fixture_decodes_receipt_and_human_review_contracts() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../project/spec/workflows/artifacts-acceptance.json.fixture"
        ))
        .unwrap();
        let receipt: ReceiptDto = serde_json::from_value(fixture["receipt"].clone()).unwrap();
        let review: CompletionCommandDto =
            serde_json::from_value(fixture["human_acceptance"]["request"].clone()).unwrap();
        let source = fixture["source_version"].as_object().unwrap();
        let mut source_fields = source.keys().map(String::as_str).collect::<Vec<_>>();
        source_fields.sort_unstable();
        assert_eq!(
            source_fields,
            [
                "availability",
                "byte_count",
                "content_digest",
                "media_type",
                "origin",
                "parser_identity",
                "project_id",
                "source_version_id",
            ]
        );
        assert_eq!(
            receipt.subject.attempt_id,
            "attempt_01J8V2ATTEMPT00000000001"
        );
        assert_eq!(receipt.subject.fence, 7);
        assert_eq!(receipt.result, "passed");
        assert_eq!(review.kind, "review.approve");
        assert_eq!(review.expected_entity_revision, 12);
        assert_eq!(review.expected_proof_revision, 9);
        assert_eq!(
            fixture["human_acceptance"]["contract_status"],
            "implemented"
        );
        assert_eq!(
            fixture["v4_optional_contracts"]["generic_deliverable_submission_identity"]["status"],
            "partial"
        );
        assert_eq!(
            fixture["v4_optional_contracts"]["generic_deliverable_submission_identity"]
                ["schema_status"],
            "typed_artifact_result_binding_only"
        );
        assert_eq!(
            fixture["v4_optional_contracts"]["typed_output_inspection"]["status"],
            "implemented"
        );
    }

    #[test]
    fn bw_s12_contract_only_general_work_schemas_decode_and_reject_unknown_fields() {
        let general: serde_json::Value = serde_json::from_str(include_str!(
            "../../../project/spec/workflows/general-work.json.fixture"
        ))
        .unwrap();
        let schemas = &general["contract_only_schemas"];
        let requirement: DeliverableRequirementDto =
            serde_json::from_value(schemas["deliverable_requirement"].clone()).unwrap();
        let input_bundle: AcceptedInputBundleDto =
            serde_json::from_value(schemas["accepted_input_bundle"].clone()).unwrap();
        assert_eq!(
            requirement.schema_version,
            DELIVERABLE_REQUIREMENT_SCHEMA_VERSION
        );
        assert_eq!(requirement.min_count, 1);
        assert_eq!(requirement.max_count, 1);
        assert_eq!(
            input_bundle.schema_version,
            ACCEPTED_INPUT_BUNDLE_SCHEMA_VERSION
        );
        assert_eq!(input_bundle.bindings[0].role, AcceptedInputRoleDto::Brief);
        assert_eq!(
            input_bundle.bindings[0].access_scope,
            ArtifactAccessScopeDto::AcceptedResultOnly
        );

        let requirement_v2: DeliverableRequirementV2Dto =
            serde_json::from_value(schemas["deliverable_requirement_v2"].clone()).unwrap();
        let input_bundle_v2: AcceptedInputBundleV2Dto =
            serde_json::from_value(schemas["accepted_input_bundle_v2"].clone()).unwrap();
        assert_eq!(
            requirement_v2.schema_version,
            DELIVERABLE_REQUIREMENT_V2_SCHEMA_VERSION
        );
        assert_eq!(
            requirement_v2.deliverable_type,
            DeliverableTypeDto::Document
        );
        assert!(matches!(
            requirement_v2.criteria[2],
            DeliverableCriterionV2Dto::TextContains { ref text } if text == "Approved brief"
        ));
        assert_eq!(
            input_bundle_v2.schema_version,
            ACCEPTED_INPUT_BUNDLE_V2_SCHEMA_VERSION
        );
        assert_eq!(
            input_bundle_v2.bindings[0].role,
            InputArtifactRoleV2Dto::AcceptedInput
        );
        assert_eq!(
            input_bundle_v2.bindings[0].access_scope,
            InputArtifactScopeV2Dto::Project
        );
        assert_eq!(
            input_bundle_v2.bindings[0]
                .produced_by
                .as_ref()
                .unwrap()
                .attempt_id,
            "attempt_01J8V2ATTEMPT00000000001"
        );
        assert_eq!(
            input_bundle_v2.bindings[0]
                .accepted_result
                .as_ref()
                .unwrap()
                .producer
                .result_id,
            "result_logo_master_01"
        );

        let artifacts: serde_json::Value = serde_json::from_str(include_str!(
            "../../../project/spec/workflows/artifacts-acceptance.json.fixture"
        ))
        .unwrap();
        let schemas = &artifacts["contract_only_schemas"];
        let submission: ArtifactSubmissionDto =
            serde_json::from_value(schemas["artifact_submission"].clone()).unwrap();
        let inspection: ArtifactInspectionFactDto =
            serde_json::from_value(schemas["artifact_inspection"].clone()).unwrap();
        let request: ArtifactAcceptanceRequestDto =
            serde_json::from_value(schemas["acceptance_request"].clone()).unwrap();
        let readback: ArtifactAcceptanceReadbackDto =
            serde_json::from_value(schemas["acceptance_readback"].clone()).unwrap();
        assert_eq!(
            submission.schema_version,
            ARTIFACT_SUBMISSION_SCHEMA_VERSION
        );
        assert_eq!(submission.fence, 7);
        assert_eq!(
            inspection.schema_version,
            ARTIFACT_INSPECTION_SCHEMA_VERSION
        );
        assert_eq!(inspection.outcome, ArtifactCheckOutcomeDto::Passed);
        assert_eq!(request.schema_version, ARTIFACT_ACCEPTANCE_SCHEMA_VERSION);
        assert_eq!(request.decision, ArtifactAcceptanceDecisionDto::Approved);
        assert_eq!(readback.actor_role, "reviewer");
        assert!(readback.reviewer_independent);
        assert_eq!(schemas["callable"], false);

        for (name, mut payload) in [
            (
                "requirement",
                general["contract_only_schemas"]["deliverable_requirement"].clone(),
            ),
            (
                "submission",
                artifacts["contract_only_schemas"]["artifact_submission"].clone(),
            ),
            (
                "inspection",
                artifacts["contract_only_schemas"]["artifact_inspection"].clone(),
            ),
            (
                "acceptance request",
                artifacts["contract_only_schemas"]["acceptance_request"].clone(),
            ),
            (
                "acceptance readback",
                artifacts["contract_only_schemas"]["acceptance_readback"].clone(),
            ),
        ] {
            payload["unexpected_client_field"] = serde_json::json!("not accepted");
            let result = match name {
                "requirement" => serde_json::from_value::<DeliverableRequirementDto>(payload)
                    .map(|_| ())
                    .map_err(|error| error.to_string()),
                "submission" => serde_json::from_value::<ArtifactSubmissionDto>(payload)
                    .map(|_| ())
                    .map_err(|error| error.to_string()),
                "inspection" => serde_json::from_value::<ArtifactInspectionFactDto>(payload)
                    .map(|_| ())
                    .map_err(|error| error.to_string()),
                "acceptance request" => {
                    serde_json::from_value::<ArtifactAcceptanceRequestDto>(payload)
                        .map(|_| ())
                        .map_err(|error| error.to_string())
                }
                _ => serde_json::from_value::<ArtifactAcceptanceReadbackDto>(payload)
                    .map(|_| ())
                    .map_err(|error| error.to_string()),
            };
            assert!(
                result.is_err(),
                "unknown fields must fail closed for {name}"
            );
        }

        let mut requirement_v2_with_unknown =
            general["contract_only_schemas"]["deliverable_requirement_v2"].clone();
        requirement_v2_with_unknown["unexpected_client_field"] = serde_json::json!(true);
        assert!(
            serde_json::from_value::<DeliverableRequirementV2Dto>(requirement_v2_with_unknown)
                .is_err()
        );
        let mut input_bundle_v2_with_unknown =
            general["contract_only_schemas"]["accepted_input_bundle_v2"].clone();
        input_bundle_v2_with_unknown["bindings"][0]["unexpected_client_field"] =
            serde_json::json!(true);
        assert!(
            serde_json::from_value::<AcceptedInputBundleV2Dto>(input_bundle_v2_with_unknown)
                .is_err()
        );
    }

    #[test]
    fn bw_s12_operation_fixture_validates_envelopes_readback_and_offset_page() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../project/spec/workflows/operations.json.fixture"
        ))
        .unwrap();
        assert_eq!(
            fixture["operation_show_request"]["target_operation_id"],
            "op_create_work_01"
        );
        assert_eq!(fixture["readback_data"]["readback_required"], false);
        let page = &fixture["status_page_pagination_excerpt"];
        assert_eq!(page["complete_response"], false);
        assert_eq!(page["limit"], 4);
        assert_eq!(page["offset"], 0);
        assert_eq!(page["returned_rows"], 4);
        assert_eq!(page["has_more"], true);
        assert_eq!(page["next_offset"], 4);

        let outcomes = fixture["typed_outcomes"].as_array().unwrap();
        let envelopes = outcomes
            .iter()
            .cloned()
            .map(|value| {
                let envelope: crate::Envelope<serde_json::Value> =
                    serde_json::from_value(value).unwrap();
                envelope.validate().unwrap();
                envelope
            })
            .collect::<Vec<_>>();
        assert_eq!(envelopes.len(), 7);
        assert_eq!(envelopes[0].outcome, crate::ApplicationOutcome::Changed);
        assert_eq!(envelopes[1].outcome, crate::ApplicationOutcome::Unchanged);
        assert_eq!(envelopes[2].outcome, crate::ApplicationOutcome::Rejected);
        assert_eq!(envelopes[3].outcome, crate::ApplicationOutcome::Conflict);
        assert_eq!(envelopes[4].outcome, crate::ApplicationOutcome::Busy);
        assert_eq!(envelopes[5].outcome, crate::ApplicationOutcome::Failed);
        assert_eq!(envelopes[6].outcome, crate::ApplicationOutcome::Unknown);
        assert_eq!(
            envelopes[6].error.as_ref().unwrap().readback_required,
            Some(true)
        );
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

/// Contract-only general-work schemas frozen by BW-S12-T01. These values are
/// deliberately not advertised as callable routes until the owning S12 task
/// implements and wires the corresponding application operation.
pub const DELIVERABLE_REQUIREMENT_SCHEMA_VERSION: &str = "boreal.deliverable_requirement.v1";
pub const ACCEPTED_INPUT_BUNDLE_SCHEMA_VERSION: &str = "boreal.accepted_input_bundle.v1";
pub const DELIVERABLE_REQUIREMENT_V2_SCHEMA_VERSION: &str = "boreal.deliverable_requirement.v2";
pub const ACCEPTED_INPUT_BUNDLE_V2_SCHEMA_VERSION: &str = "boreal.accepted_input_bundle.v2";
pub const ARTIFACT_SUBMISSION_SCHEMA_VERSION: &str = "boreal.artifact_submission.v1";
pub const ARTIFACT_INSPECTION_SCHEMA_VERSION: &str = "boreal.artifact_inspection.v1";
pub const ARTIFACT_ACCEPTANCE_SCHEMA_VERSION: &str = "boreal.artifact_acceptance.v1";

/// A small, typed set of structural checks. Passing these checks says nothing
/// about subjective quality, authorship, legal rights, or human approval.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum DeliverableCriterionDto {
    NonEmpty,
    MinimumBytes { value: u64 },
    MaximumBytes { value: u64 },
    DigestPresent,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeliverableRequirementDto {
    pub schema_version: String,
    pub requirement_key: String,
    pub purpose: String,
    pub required: bool,
    pub allowed_media_types: Vec<String>,
    pub min_count: u32,
    pub max_count: u32,
    pub criteria: Vec<DeliverableCriterionDto>,
}

/// Content identity is project-scoped and digest/version bound. The path or
/// display name used to locate bytes is intentionally not part of identity.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArtifactVersionIdentityDto {
    pub project_id: String,
    pub source_version_id: String,
    pub content_digest: String,
    pub media_type: String,
    pub byte_count: u64,
    pub availability: String,
}

pub const SOURCE_LOOKUP_SCHEMA_VERSION: &str = "boreal.source_lookup.v1";
pub const SOURCE_SHOW_READBACK_SCHEMA_VERSION: &str = "boreal.source_show_readback.v1";
pub const SOURCE_VERIFY_READBACK_SCHEMA_VERSION: &str = "boreal.source_verify_readback.v1";

/// Lookup identity for exact source-version inspection. Project and caller
/// identity are supplied by the authenticated application envelope.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SourceVersionLookupDto {
    pub schema_version: String,
    pub source_version_id: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceAvailabilityDto {
    Available,
    Missing,
    Corrupt,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SourceVersionMetadataDto {
    pub source_version_id: String,
    pub origin: String,
    pub media_type: String,
    pub byte_count: u64,
    pub content_digest: String,
    pub availability: SourceAvailabilityDto,
    #[serde(default)]
    pub parser_identity: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SourceVersionRegistrationDto {
    pub source_version_id: String,
    pub origin: String,
    pub access_scope: String,
    pub content_digest: String,
    pub media_type: String,
    pub byte_count: u64,
    pub captured_at: String,
    pub parser_identity: String,
    pub availability: String,
}

/// Host-independent source metadata and its optional canonical registration.
/// Local catalog paths are intentionally not part of the protocol result.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SourceShowReadbackDto {
    pub schema_version: String,
    pub source: SourceVersionMetadataDto,
    #[serde(default)]
    pub sqlite_registration: Option<SourceVersionRegistrationDto>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SourceVerifyReadbackDto {
    pub schema_version: String,
    pub source_version_id: String,
    pub availability: SourceAvailabilityDto,
    #[serde(default)]
    pub verified_digest: Option<String>,
    pub byte_count: u64,
    pub verified: bool,
}

pub const FINAL_RESULT_CAPTURE_SCHEMA_VERSION: &str = "boreal.final_result_capture.v1";
pub const FINAL_RESULT_CAPTURE_READBACK_SCHEMA_VERSION: &str =
    "boreal.final_result_capture_readback.v1";

/// Revision-bound binding of one captured source to a proof generation.
/// Project, actor, session, operation, and trusted time come from the
/// authenticated service envelope/server.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FinalResultCaptureRequestDto {
    pub schema_version: String,
    pub work_id: String,
    pub attempt_id: String,
    pub fence: u64,
    pub expected_project_revision: u64,
    pub expected_entity_revision: u64,
    pub expected_proof_revision: u64,
    pub source_version_id: String,
    pub content_digest: String,
}

/// Authoritative final-result binding readback. Project, actor, session and
/// operation identity are carried by the authenticated service envelope.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FinalResultCaptureReadbackDto {
    pub schema_version: String,
    pub binding_id: String,
    pub work_id: String,
    pub attempt_id: String,
    pub fence: u64,
    pub source_version_id: String,
    pub content_digest: String,
    pub config_identity: String,
    pub profile_id: String,
    pub profile_version: u64,
    pub profile_digest: String,
    pub entity_revision: u64,
    pub prior_proof_revision: u64,
    pub proof_revision: u64,
    pub request_digest: String,
    pub project_revision: u64,
    pub created_at: String,
    #[serde(default)]
    pub lineage_pending: Option<String>,
    pub replayed: bool,
}

pub const ARTIFACT_RESULT_BIND_SCHEMA_VERSION: &str = "boreal.artifact_result_bind.v1";
pub const ARTIFACT_RESULT_BIND_READBACK_SCHEMA_VERSION: &str =
    "boreal.artifact_result_bind_readback.v1";
pub const ARTIFACT_RESULT_READBACK_SCHEMA_VERSION: &str = "boreal.artifact_result_readback.v1";

/// Exact project-scoped source identity asserted by a result producer. The
/// application revalidates these fields against the source catalog; callers
/// cannot provide inspection facts or host-local paths here.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArtifactResultSourceIdentityDto {
    pub project_id: String,
    pub source_version_id: String,
    pub content_digest: String,
}

/// Optional provenance attached to a produced output relationship.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArtifactResultRightsDto {
    #[serde(default)]
    pub attribution: Option<String>,
    #[serde(default)]
    pub rights_statement: Option<String>,
    #[serde(default)]
    pub license: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArtifactResultOutputRequestDto {
    pub requirement_key: String,
    pub source: ArtifactResultSourceIdentityDto,
    pub relationship_id: String,
    pub rights: ArtifactResultRightsDto,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArtifactResultAttestationDto {
    pub statement: String,
}

/// Request to inspect exact source versions and bind their deterministic
/// inspection facts to one fenced attempt. Project, actor, session, operation,
/// and trusted time are supplied by the authenticated service envelope.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArtifactResultBindRequestDto {
    pub schema_version: String,
    pub work_id: String,
    pub attempt_id: String,
    pub fence: u64,
    pub expected_project_revision: u64,
    pub expected_entity_revision: u64,
    pub expected_proof_revision: u64,
    pub result_id: String,
    pub contract_revision: u64,
    pub outputs: Vec<ArtifactResultOutputRequestDto>,
    #[serde(default)]
    pub attestation: Option<ArtifactResultAttestationDto>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArtifactResultAvailabilityDto {
    Available,
    Missing,
    Corrupt,
    TooLarge,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArtifactResultCriterionDto {
    pub criterion_id: String,
    pub passed: bool,
    pub observed: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArtifactResultOutputReadbackDto {
    pub requirement_key: String,
    pub relationship_id: String,
    pub rights: ArtifactResultRightsDto,
    pub source: ArtifactResultSourceIdentityDto,
    pub media_type: String,
    pub availability: ArtifactResultAvailabilityDto,
    pub media_type_allowed: bool,
    pub byte_count: u64,
    pub criteria: Vec<ArtifactResultCriterionDto>,
}

/// Canonical immutable acceptance-result record returned by bind and bounded
/// read operations. Actor/session/operation/time values are server-owned.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArtifactResultRecordDto {
    pub result_id: String,
    pub project_id: String,
    pub work_id: String,
    pub attempt_id: String,
    pub fence: u64,
    pub entity_revision: u64,
    pub proof_revision: u64,
    pub actor_id: String,
    pub session_id: String,
    pub source_version_id: String,
    pub config_identity: String,
    pub profile_id: String,
    pub profile_version: u64,
    pub profile_digest: String,
    pub contract_revision: u64,
    pub result_digest: String,
    pub outputs: Vec<ArtifactResultOutputReadbackDto>,
    #[serde(default)]
    pub attestation: Option<ArtifactResultAttestationDto>,
    pub operation_id: String,
    pub request_digest: String,
    pub project_revision: u64,
    pub created_at: String,
    pub replayed: bool,
}

/// Result-binding response adds the catalog lineage work performed by the
/// application to the canonical immutable record.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArtifactResultBindReadbackDto {
    pub schema_version: String,
    pub result: ArtifactResultRecordDto,
    pub source_relationship_ids: Vec<String>,
    pub lineage_pending: Vec<String>,
}

/// Bounded attempt-fence and operation readback for one canonical result.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArtifactResultReadbackDto {
    pub schema_version: String,
    pub result: ArtifactResultRecordDto,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AcceptedInputRoleDto {
    Brief,
    Reference,
    Source,
    AcceptedOutput,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArtifactAccessScopeDto {
    ProjectScoped,
    AcceptedResultOnly,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AcceptedInputBindingDto {
    pub input_key: String,
    pub role: AcceptedInputRoleDto,
    pub required: bool,
    pub access_scope: ArtifactAccessScopeDto,
    pub artifact: ArtifactVersionIdentityDto,
    #[serde(default)]
    pub accepted_result: Option<AcceptedResultIdentityDto>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AcceptedResultIdentityDto {
    pub producer_work_id: String,
    pub decision_id: String,
    pub submission_id: String,
    pub artifact_set_digest: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AcceptedInputBundleDto {
    pub schema_version: String,
    pub project_id: String,
    pub work_id: String,
    pub bindings: Vec<AcceptedInputBindingDto>,
    pub bundle_digest: String,
}

/// V2 preserves the semantic deliverable category and all bounded criteria
/// represented by the domain requirement. V1 remains frozen for older clients.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeliverableTypeDto {
    Code,
    Document,
    Image,
    Dataset,
    Report,
    Archive,
    Other,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum DeliverableCriterionV2Dto {
    NonEmpty,
    MinimumBytes { value: u64 },
    MaximumBytes { value: u64 },
    DigestPresent,
    JsonDocument,
    TextContains { text: String },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeliverableRequirementV2Dto {
    pub schema_version: String,
    pub requirement_key: String,
    pub purpose: String,
    pub required: bool,
    pub deliverable_type: DeliverableTypeDto,
    pub allowed_media_types: Vec<String>,
    pub min_count: u32,
    pub max_count: u32,
    pub criteria: Vec<DeliverableCriterionV2Dto>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InputArtifactRoleV2Dto {
    Context,
    AcceptedInput,
    Reference,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InputArtifactScopeV2Dto {
    Project,
    Private,
}

/// Exact producer identity required to bind an input to its originating work
/// attempt and immutable result, independently of any accepted decision.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArtifactProductionIdentityDto {
    pub work_id: String,
    pub attempt_id: String,
    pub result_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AcceptedResultIdentityV2Dto {
    pub producer: ArtifactProductionIdentityDto,
    pub decision_id: String,
    pub submission_id: String,
    pub artifact_set_digest: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AcceptedInputBindingV2Dto {
    pub input_key: String,
    pub role: InputArtifactRoleV2Dto,
    pub required: bool,
    pub access_scope: InputArtifactScopeV2Dto,
    pub artifact: ArtifactVersionIdentityDto,
    #[serde(default)]
    pub produced_by: Option<ArtifactProductionIdentityDto>,
    #[serde(default)]
    pub accepted_result: Option<AcceptedResultIdentityV2Dto>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AcceptedInputBundleV2Dto {
    pub schema_version: String,
    pub project_id: String,
    pub work_id: String,
    pub bindings: Vec<AcceptedInputBindingV2Dto>,
    pub bundle_digest: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArtifactSubmissionDto {
    pub schema_version: String,
    pub submission_id: String,
    pub project_id: String,
    pub work_id: String,
    pub attempt_id: String,
    pub fence: u64,
    pub requirement_revision: u64,
    pub profile_id: String,
    pub profile_version: String,
    pub requirement_key: String,
    pub artifacts: Vec<ArtifactVersionIdentityDto>,
    pub artifact_set_digest: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArtifactCheckOutcomeDto {
    Passed,
    Failed,
    Inconclusive,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArtifactInspectionCheckDto {
    pub criterion_id: String,
    pub outcome: ArtifactCheckOutcomeDto,
    #[serde(default)]
    pub reason_code: Option<String>,
}

/// An attributable, automated observation over exact submitted bytes; this
/// must never be serialized or treated as a command execution receipt.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArtifactInspectionFactDto {
    pub schema_version: String,
    pub inspection_id: String,
    pub submission_id: String,
    pub artifact_set_digest: String,
    pub requirement_revision: u64,
    pub validator_id: String,
    pub validator_version: String,
    pub outcome: ArtifactCheckOutcomeDto,
    pub observed_artifact_count: u32,
    pub checks: Vec<ArtifactInspectionCheckDto>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArtifactAcceptanceDecisionDto {
    Approved,
    Rejected,
    ReturnForRevision,
    Revoked,
}

/// A request binds a human decision to current immutable revisions. Actor and
/// role are omitted because the authenticated service session supplies them.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArtifactAcceptanceRequestDto {
    pub schema_version: String,
    pub work_id: String,
    pub expected_project_revision: u64,
    pub expected_work_revision: u64,
    pub expected_requirement_revision: u64,
    pub expected_proof_revision: u64,
    pub submission_id: String,
    pub artifact_set_digest: String,
    pub decision: ArtifactAcceptanceDecisionDto,
    pub reason: String,
}

/// Authoritative acceptance readback. Actor, role and time are server-derived
/// and the record names the exact submission reviewed.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArtifactAcceptanceReadbackDto {
    pub schema_version: String,
    pub decision_id: String,
    pub work_id: String,
    pub submission_id: String,
    pub artifact_set_digest: String,
    pub requirement_revision: u64,
    pub decision: ArtifactAcceptanceDecisionDto,
    pub actor_id: String,
    pub actor_role: String,
    pub reviewer_independent: bool,
    pub decided_at: String,
    pub reason: String,
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

/// Versioned payload schemas for the project-owned Intake delivery service
/// routes. The outer application envelope supplies project, actor, session,
/// credential, and operation identity; these DTOs contain only the frozen
/// delivery intent and its stable logical lookup identity.
pub const INTAKE_DELIVERY_RECEIVE_SCHEMA_VERSION: &str = "boreal.intake_delivery.receive.v1";
pub const INTAKE_DELIVERY_READBACK_SCHEMA_VERSION: &str = "boreal.intake_delivery.readback.v1";

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IntakeDeliveryOriginDto {
    pub kind: String,
    pub item_id: String,
    pub digest: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IntakeDeliveryPayloadDto {
    pub bucket_id: String,
    pub kind: String,
    pub content: String,
    #[serde(default)]
    pub revisit_at_utc_ms: Option<u64>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IntakeDeliveryReceiveDto {
    pub schema_version: String,
    pub expected_revision: u64,
    pub delivery_key: String,
    pub origin: IntakeDeliveryOriginDto,
    pub intake_id: String,
    pub payload: IntakeDeliveryPayloadDto,
    pub payload_digest: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IntakeDeliveryReadbackRequestDto {
    pub schema_version: String,
    pub delivery_key: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IntakeDeliveryReadbackStateDto {
    Received,
    Absent,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IntakeDeliveryReceiptDto {
    pub project_id: String,
    pub delivery_key: String,
    pub intake_id: String,
    pub origin_kind: String,
    pub origin_item_id: String,
    pub origin_digest: String,
    pub payload_digest: String,
    pub created_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IntakeDeliveryItemDto {
    pub project_id: String,
    pub intake_id: String,
    pub bucket_id: String,
    pub kind: String,
    pub lifecycle: String,
    pub content: String,
    pub content_revision: u64,
    pub content_digest: String,
    pub captured_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub revisit_at_utc_ms: Option<i64>,
}

/// Authoritative lookup response. A successful `Absent` response is distinct
/// from authorization, transport, and unknown-outcome failures in the outer
/// service envelope. Canonical service responses also include `_scope`, the
/// server-read ProjectReadbackScope for the physical activation.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IntakeDeliveryReadbackDto {
    pub schema_version: String,
    pub project_id: String,
    pub project_revision: u64,
    pub state: IntakeDeliveryReadbackStateDto,
    #[serde(default)]
    pub receipt: Option<IntakeDeliveryReceiptDto>,
    #[serde(default)]
    pub intake: Option<IntakeDeliveryItemDto>,
}

pub const INTAKE_BUCKET_CREATE_SCHEMA_VERSION: &str = "boreal.intake_bucket_create.v1";
pub const INTAKE_BUCKET_READBACK_SCHEMA_VERSION: &str = "boreal.intake_bucket_readback.v1";
pub const INTAKE_CAPTURE_SCHEMA_VERSION: &str = "boreal.intake_capture.v1";
pub const INTAKE_CAPTURE_READBACK_SCHEMA_VERSION: &str = "boreal.intake_capture_readback.v1";
pub const INTAKE_LIST_SCHEMA_VERSION: &str = "boreal.intake_list.v1";
pub const INTAKE_LIST_READBACK_SCHEMA_VERSION: &str = "boreal.intake_list_readback.v1";
pub const INTAKE_DISPOSITION_SCHEMA_VERSION: &str = "boreal.intake_disposition.v1";
pub const INTAKE_DISPOSITION_READBACK_SCHEMA_VERSION: &str =
    "boreal.intake_disposition_readback.v1";
pub const INTAKE_PROMOTE_SCHEMA_VERSION: &str = "boreal.intake_promote.v1";
pub const INTAKE_PROMOTE_READBACK_SCHEMA_VERSION: &str = "boreal.intake_promote_readback.v1";

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IntakeKindDto {
    Note,
    Discovery,
    Question,
    Revisit,
}

/// Revision-bound request to create a project Intake bucket. Project and
/// actor/session/operation identity are supplied by the authenticated route.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IntakeBucketCreateDto {
    pub schema_version: String,
    pub expected_revision: u64,
    pub bucket_id: String,
    pub name: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IntakeBucketReadbackDto {
    pub schema_version: String,
    pub bucket_id: String,
    pub name: String,
    pub archived: bool,
    pub replayed: bool,
}

/// Revision-bound Intake capture. The service supplies the capture time and
/// derives the immutable content digest from the supplied content.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IntakeCaptureDto {
    pub schema_version: String,
    pub expected_revision: u64,
    pub intake_id: String,
    pub bucket_id: String,
    pub kind: IntakeKindDto,
    pub content: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IntakeCaptureReadbackDto {
    pub schema_version: String,
    pub intake_id: String,
    pub bucket_id: String,
    pub kind: IntakeKindDto,
    pub lifecycle: String,
    pub content_revision: u64,
    pub content_digest: String,
    pub replayed: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IntakeListRequestDto {
    pub schema_version: String,
    pub limit: u64,
    pub offset: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IntakeListItemDto {
    pub project_id: String,
    pub intake_id: String,
    pub bucket_id: String,
    pub kind: String,
    pub lifecycle: String,
    pub content: String,
    pub content_revision: u64,
    pub content_digest: String,
    pub captured_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub revisit_at_utc_ms: Option<i64>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IntakeListReadbackDto {
    pub schema_version: String,
    pub project_id: String,
    pub project_revision: u64,
    pub total: u64,
    pub offset: u64,
    pub limit: u64,
    pub has_more: bool,
    pub items: Vec<IntakeListItemDto>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IntakeLifecycleDto {
    Captured,
    Triaged,
    Deferred,
    Resolved,
    Archived,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IntakeDispositionRequestDto {
    pub schema_version: String,
    pub expected_project_revision: u64,
    pub expected_content_revision: u64,
    pub intake_id: String,
    pub lifecycle: IntakeLifecycleDto,
    #[serde(default)]
    pub revisit_at_utc_ms: Option<i64>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IntakeDispositionReadbackDto {
    pub schema_version: String,
    pub project_id: String,
    pub intake_id: String,
    pub lifecycle: IntakeLifecycleDto,
    pub content_revision: u64,
    pub revisit_at_utc_ms: Option<i64>,
    pub replayed: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IntakePromotionTargetKindDto {
    DraftWork,
    SourceVersion,
    MemoryDraft,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IntakePromoteRequestDto {
    pub schema_version: String,
    pub expected_project_revision: u64,
    pub expected_content_revision: u64,
    pub intake_id: String,
    pub target_kind: IntakePromotionTargetKindDto,
    pub target_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IntakePromoteReadbackDto {
    pub schema_version: String,
    pub project_id: String,
    pub intake_id: String,
    pub promotion_id: String,
    pub target_kind: IntakePromotionTargetKindDto,
    pub target_id: String,
    pub content_revision: u64,
    pub replayed: bool,
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

// S13 date and external-wait command boundary. These DTOs intentionally keep
// actor, session, operation and trusted observation time in the authenticated
// CLI/service envelope rather than accepting them from request JSON.
pub const PROJECT_CIVIL_TIME_UPDATE_SCHEMA_VERSION: &str = "boreal.project_civil_time_update.v1";
pub const PROJECT_CIVIL_TIME_READBACK_SCHEMA_VERSION: &str =
    "boreal.project_civil_time_readback.v1";
pub const WORK_SCHEDULE_UPDATE_SCHEMA_VERSION: &str = "boreal.work_schedule_update.v1";
pub const WORK_SCHEDULE_READBACK_SCHEMA_VERSION: &str = "boreal.work_schedule_readback.v1";
pub const EXTERNAL_WAIT_CREATE_SCHEMA_VERSION: &str = "boreal.external_wait_create.v1";
pub const EXTERNAL_WAIT_RESOLVE_SCHEMA_VERSION: &str = "boreal.external_wait_resolve.v1";
pub const EXTERNAL_WAIT_READBACK_SCHEMA_VERSION: &str = "boreal.external_wait_readback.v1";
pub const EXTERNAL_WAIT_LIST_SCHEMA_VERSION: &str = "boreal.external_wait_list.v1";
pub const EXTERNAL_WAIT_LIST_READBACK_SCHEMA_VERSION: &str =
    "boreal.external_wait_list_readback.v1";

/// A required JSON key whose value may explicitly be `null`. Serde rejects a
/// missing key because this wrapper itself has no default implementation.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct RequiredNullableDto<T>(pub Option<T>);

fn deserialize_required_nullable<'de, D, T>(
    deserializer: D,
) -> Result<RequiredNullableDto<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(RequiredNullableDto)
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProjectCivilTimeUpdateDto {
    pub schema_version: String,
    pub expected_project_revision: u64,
    pub expected_setting_revision: u64,
    pub timezone: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProjectCivilTimeSettingDto {
    pub setting_revision: u64,
    pub timezone: String,
    pub tzdb_identity: String,
    pub changed_by: String,
    pub changed_at_ms: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProjectCivilTimeReadbackDto {
    pub schema_version: String,
    pub project_revision: u64,
    pub setting: Option<ProjectCivilTimeSettingDto>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProjectCivilTimeMutationReadbackDto {
    pub schema_version: String,
    pub operation_id: String,
    pub replayed: bool,
    pub project_revision: u64,
    pub setting: ProjectCivilTimeSettingDto,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum BusinessDateDto {
    Instant {
        at_ms: u64,
    },
    LocalDate {
        year: i32,
        month: u8,
        day: u8,
    },
    ResolvedLocal {
        nominal_local: LocalDateTimeDto,
        utc_instant_ms: u64,
        utc_offset_minutes: i32,
        timezone: String,
        tzdb_identity: String,
        gap_policy: GapPolicyDto,
        fold_policy: FoldPolicyDto,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GapPolicyDto {
    NextValid,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FoldPolicyDto {
    EarlierOffset,
    LaterOffset,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BusinessScheduleUpdateDto {
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub not_before: RequiredNullableDto<BusinessDateDto>,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub due: RequiredNullableDto<BusinessDateDto>,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub planned_start: RequiredNullableDto<BusinessDateDto>,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub planned_end: RequiredNullableDto<BusinessDateDto>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BusinessScheduleDto {
    pub not_before: Option<BusinessDateDto>,
    pub due: Option<BusinessDateDto>,
    pub planned_start: Option<BusinessDateDto>,
    pub planned_end: Option<BusinessDateDto>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkScheduleUpdateDto {
    pub schema_version: String,
    pub expected_project_revision: u64,
    pub expected_schedule_revision: u64,
    pub schedule: BusinessScheduleUpdateDto,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkScheduleReadbackDto {
    pub schema_version: String,
    pub project_revision: u64,
    pub work_id: String,
    pub schedule_revision: u64,
    /// `None` means no revisioned schedule exists. A present schedule with
    /// four null fields is a durable clear at a positive revision.
    pub schedule: Option<BusinessScheduleDto>,
    pub legacy_due_at: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkScheduleMutationReadbackDto {
    pub schema_version: String,
    pub operation_id: String,
    pub replayed: bool,
    pub project_revision: u64,
    pub work_id: String,
    pub schedule_revision: u64,
    pub schedule: BusinessScheduleDto,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExternalWaitCategoryDto {
    Decision,
    Approval,
    Information,
    Access,
    Service,
    Other,
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
pub enum ExternalWaitOutcomeDto {
    Approved,
    Rejected,
    DecisionProvided,
    OutputProvided,
    Declined,
    Unavailable,
    Cancelled,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExternalWaitRoleDto {
    Agent,
    Operator,
    Reviewer,
    Publisher,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ExternalWaitAccountableDto {
    Person {
        reference: String,
        display_name: String,
    },
    Role {
        role: ExternalWaitRoleDto,
    },
    Service {
        reference: String,
        display_name: String,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExternalWaitResolutionDto {
    pub outcome: ExternalWaitOutcomeDto,
    pub detail: String,
    pub output_ref: Option<String>,
    pub supplied_by: ExternalWaitAccountableDto,
    pub recorded_by: String,
    pub recorded_as: ExternalWaitRoleDto,
    pub recorded_at_ms: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExternalWaitDto {
    pub wait_id: String,
    pub source_work_id: String,
    pub affected_work_ids: Vec<String>,
    pub category: ExternalWaitCategoryDto,
    pub reason: String,
    pub accountable: ExternalWaitAccountableDto,
    pub expected_decision: Option<String>,
    pub expected_output: Option<String>,
    pub follow_up: Option<BusinessDateDto>,
    pub civil_time_setting_revision: Option<u64>,
    pub wait_revision: u64,
    pub state: ExternalWaitStateDto,
    pub created_by: String,
    pub created_at_ms: u64,
    pub resolution: Option<ExternalWaitResolutionDto>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExternalWaitCreateDto {
    pub schema_version: String,
    pub expected_project_revision: u64,
    pub expected_wait_revision: u64,
    pub wait_id: String,
    pub source_work_id: String,
    pub affected_work_ids: Vec<String>,
    pub category: ExternalWaitCategoryDto,
    pub reason: String,
    pub accountable: ExternalWaitAccountableDto,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub expected_decision: RequiredNullableDto<String>,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub expected_output: RequiredNullableDto<String>,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub follow_up: RequiredNullableDto<BusinessDateDto>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExternalWaitResolveDto {
    pub schema_version: String,
    pub expected_project_revision: u64,
    pub expected_wait_revision: u64,
    pub wait_id: String,
    pub next_state: ExternalWaitStateDto,
    pub outcome: ExternalWaitOutcomeDto,
    pub detail: String,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub output_ref: RequiredNullableDto<String>,
    pub supplied_by: ExternalWaitAccountableDto,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExternalWaitReadbackDto {
    pub schema_version: String,
    pub project_revision: u64,
    pub waits: Vec<ExternalWaitDto>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExternalWaitListRequestDto {
    pub schema_version: String,
    pub limit: u64,
    pub offset: u64,
    #[serde(default)]
    pub expected_project_revision: Option<u64>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExternalWaitListReadbackDto {
    pub schema_version: String,
    pub project_revision: u64,
    pub total: u64,
    pub offset: u64,
    pub limit: u64,
    pub has_more: bool,
    pub waits: Vec<ExternalWaitDto>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExternalWaitMutationReadbackDto {
    pub schema_version: String,
    pub operation_id: String,
    pub replayed: bool,
    pub project_revision: u64,
    pub wait: ExternalWaitDto,
}

#[cfg(test)]
mod scheduling_dto_tests {
    use super::*;

    #[test]
    fn schedule_mutations_require_every_explicit_nullable_field() {
        let request = serde_json::json!({
            "schema_version": WORK_SCHEDULE_UPDATE_SCHEMA_VERSION,
            "expected_project_revision": 12,
            "expected_schedule_revision": 0,
            "schedule": {
                "not_before": null,
                "due": {"kind": "local_date", "year": 2026, "month": 10, "day": 14},
                "planned_start": null,
                "planned_end": null
            }
        });
        let decoded: WorkScheduleUpdateDto = serde_json::from_value(request.clone()).unwrap();
        assert_eq!(
            decoded.schedule.due.0,
            Some(BusinessDateDto::LocalDate {
                year: 2026,
                month: 10,
                day: 14,
            })
        );
        assert_eq!(serde_json::to_value(decoded).unwrap(), request);

        let mut missing_clear = request.clone();
        missing_clear["schedule"]
            .as_object_mut()
            .unwrap()
            .remove("planned_end");
        assert!(serde_json::from_value::<WorkScheduleUpdateDto>(missing_clear).is_err());

        let mut unknown = request;
        unknown["schedule"]["extra"] = serde_json::json!(true);
        assert!(serde_json::from_value::<WorkScheduleUpdateDto>(unknown).is_err());
    }

    #[test]
    fn wait_mutations_reject_unknown_keys_and_missing_nullable_values() {
        let request = serde_json::json!({
            "schema_version": EXTERNAL_WAIT_CREATE_SCHEMA_VERSION,
            "expected_project_revision": 7,
            "expected_wait_revision": 0,
            "wait_id": "wait_01",
            "source_work_id": "work_01",
            "affected_work_ids": ["work_01"],
            "category": "decision",
            "reason": "Need a decision",
            "accountable": {"kind": "person", "reference": "person_01", "display_name": "Owner"},
            "expected_decision": "Choose one option",
            "expected_output": null,
            "follow_up": null
        });
        let decoded: ExternalWaitCreateDto = serde_json::from_value(request.clone()).unwrap();
        assert_eq!(decoded.expected_output.0, None);
        assert_eq!(serde_json::to_value(decoded).unwrap(), request);

        let mut missing_nullable = request.clone();
        missing_nullable
            .as_object_mut()
            .unwrap()
            .remove("follow_up");
        assert!(serde_json::from_value::<ExternalWaitCreateDto>(missing_nullable).is_err());

        let mut unknown = request;
        unknown["untrusted_actor_id"] = serde_json::json!("operator");
        assert!(serde_json::from_value::<ExternalWaitCreateDto>(unknown).is_err());
    }
}
