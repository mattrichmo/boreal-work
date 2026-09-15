//! Typed read-model and evidence DTOs for the v2 protocol.
//!
//! These structs mirror the versioned fixture vocabulary. They intentionally
//! contain no domain or persistence logic; validation of lifecycle policy
//! remains in the domain/application crates.

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct StatusDto {
    pub schema_version: String,
    pub fixture_id: Option<String>,
    pub work_id: String,
    pub display_status: String,
    pub lifecycle: String,
    #[serde(default)]
    pub reason_codes: Vec<String>,
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
}
