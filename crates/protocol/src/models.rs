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
            "unavailable"
        );
        assert_eq!(
            fixture["v4_optional_contracts"]["typed_output_inspection"]["status"],
            "unavailable"
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
