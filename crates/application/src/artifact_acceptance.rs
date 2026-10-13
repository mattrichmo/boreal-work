//! Typed result binding for non-executable deliverables.
//!
//! This use case reads exact immutable source versions, evaluates only the
//! bounded deterministic criteria declared by the current planning snapshot,
//! records source lineage, then asks the canonical store to bind those facts
//! to the current fenced attempt. It never manufactures a command receipt or
//! treats inspection as human approval.

use boreal_source::{
    ArtifactProducer, ArtifactRelationshipInput, ArtifactRightsProvenance, ArtifactRole,
    ArtifactScope, Availability as SourceAvailability, SourceCatalog, SourceError, SourceIdentity,
    DEFAULT_MAX_ARTIFACT_BYTES,
};
use boreal_store::{
    acceptance::{
        AcceptanceArtifactInspection, AcceptanceCriterionResult, AcceptanceResultBindRequest,
        AcceptanceResultRecord, AcceptanceStore, ArtifactDecisionRecord,
        ArtifactInspectionAvailability, CompletionAttestationInput, MAX_ACCEPTANCE_RESULT_OUTPUTS,
    },
    profiles::{registered_acceptance_profile, RegisteredAcceptanceMode},
};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

use crate::{ApplicationError, OperationResult, WorkApplication};

pub const ARTIFACT_ACCEPTANCE_SCHEMA: &str = "boreal.artifact_acceptance/1";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProducedArtifactInput {
    pub requirement_key: String,
    pub source: SourceIdentity,
    pub relationship_id: String,
    pub rights: ArtifactRightsProvenance,
}

/// An immutable result binding request. Entity/proof/contract revisions are
/// expected-value fences; actor/session and attempt/fence remain authoritative
/// store checks rather than caller assertions.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ArtifactAcceptanceRequest {
    pub project_id: String,
    pub work_id: String,
    pub actor_id: String,
    pub session_id: String,
    pub attempt_id: String,
    pub fence: u64,
    pub expected_project_revision: u64,
    pub expected_entity_revision: u64,
    pub expected_proof_revision: u64,
    pub result_id: String,
    pub contract_revision: u64,
    pub outputs: Vec<ProducedArtifactInput>,
    pub attestation: Option<CompletionAttestationInput>,
    pub operation_id: String,
    pub at: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ArtifactAcceptanceResult {
    pub result: AcceptanceResultRecord,
    pub source_relationship_ids: Vec<String>,
    /// The result committed successfully, but these source-catalog links need
    /// retry/readback. Replaying the same operation id is safe and repairs them.
    pub lineage_pending: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ArtifactLineageReadback {
    pub source_relationship_ids: Vec<String>,
    pub lineage_pending: Vec<String>,
}

impl WorkApplication<'_> {
    /// Inspect and bind one immutable producer result before verification.
    /// Source relationships are idempotent by operation id; the canonical
    /// SQLite result binding is the acceptance authority.
    pub fn bind_artifact_result(
        &self,
        catalog: &SourceCatalog,
        request: &ArtifactAcceptanceRequest,
    ) -> Result<OperationResult<ArtifactAcceptanceResult>, ApplicationError> {
        validate_request(request)?;
        let store = self.store_ref();
        let pin = boreal_store::profiles::ProfileStore::new(store)
            .current_pinned_requirements(&request.project_id, &request.work_id)?;
        let profile = registered_acceptance_profile(&pin.profile.profile_id, pin.profile.version)?
            .ok_or_else(|| {
                ApplicationError::Invalid(
                    "artifact result binding requires a registered general-work acceptance profile"
                        .into(),
                )
            })?;
        let contract = store.work_planning_contract(&request.project_id, &request.work_id)?;
        let (contract_revision, requirements) = match contract {
            Some(contract) => {
                let requirements = parse_requirements(&contract.requirements_json)?;
                (contract.contract_revision, requirements)
            }
            None => (0, Vec::new()),
        };
        if request.contract_revision != contract_revision {
            return Err(ApplicationError::Invalid(format!(
                "planning contract changed: expected revision {}, current revision {contract_revision}",
                request.contract_revision
            )));
        }
        validate_profile_contract(profile.mode, &requirements)?;

        let requirement_map: BTreeMap<&str, &Value> = requirements
            .iter()
            .map(|requirement| {
                let key = requirement["key"].as_str().ok_or_else(|| {
                    ApplicationError::Invalid("deliverable requirement has no key".into())
                })?;
                Ok((key, requirement))
            })
            .collect::<Result<_, ApplicationError>>()?;
        let mut source_ids = BTreeSet::new();
        let mut relationship_ids = BTreeSet::new();
        let mut output_facts = Vec::with_capacity(request.outputs.len());
        for output in &request.outputs {
            if output.source.project_id != request.project_id
                || !source_ids.insert(output.source.source_version_id.as_str())
                || !relationship_ids.insert(output.relationship_id.as_str())
            {
                return Err(ApplicationError::Invalid(
                    "produced artifacts must use unique relationship and exact version identities in the current project".into(),
                ));
            }
            let requirement = requirement_map
                .get(output.requirement_key.as_str())
                .ok_or_else(|| {
                    ApplicationError::Invalid(format!(
                        "artifact output references undeclared requirement {}",
                        output.requirement_key
                    ))
                })?;
            let (source_identity, media_type, byte_count, availability, criteria) = match catalog
                .read_identity_bounded(&output.source, DEFAULT_MAX_ARTIFACT_BYTES)
            {
                Ok(readback) => (
                    readback.identity,
                    readback.media_type,
                    readback.byte_count as u64,
                    ArtifactInspectionAvailability::Available,
                    inspect_criteria(requirement, &readback.bytes)?,
                ),
                Err(read_error) => {
                    let version = catalog
                        .show_version(&output.source.project_id, &output.source.source_version_id)
                        .map_err(|error| {
                            ApplicationError::Invalid(format!(
                                "produced artifact {} is unavailable: {error}",
                                output.source.source_version_id
                            ))
                        })?;
                    validate_source_version_identity(&output.source, &version)?;
                    let availability = inspection_availability(&version.availability, &read_error)?;
                    let reason = match availability {
                        ArtifactInspectionAvailability::Missing => "unavailable:missing",
                        ArtifactInspectionAvailability::Corrupt => "unavailable:corrupt",
                        ArtifactInspectionAvailability::TooLarge => "unavailable:too_large",
                        ArtifactInspectionAvailability::Available => {
                            return Err(ApplicationError::Invalid(format!(
                                "artifact {} could not be inspected despite being available",
                                output.source.source_version_id
                            )))
                        }
                    };
                    (
                        SourceIdentity::from_version(&version),
                        version.media_type,
                        version.byte_count as u64,
                        availability,
                        unavailable_criteria(requirement, reason)?,
                    )
                }
            };
            let media_type_allowed = media_type_is_allowed(requirement, &media_type);
            output_facts.push(AcceptanceArtifactInspection {
                requirement_key: output.requirement_key.clone(),
                relationship_id: output.relationship_id.clone(),
                attribution: output.rights.attribution.clone(),
                rights_statement: output.rights.rights_statement.clone(),
                license: output.rights.license.clone(),
                source_version_id: source_identity.source_version_id.clone(),
                content_digest: source_identity.content_digest.clone(),
                media_type,
                availability,
                media_type_allowed,
                byte_count,
                criteria,
            });
        }
        let bind = AcceptanceResultBindRequest {
            project_id: request.project_id.clone(),
            work_id: request.work_id.clone(),
            actor_id: request.actor_id.clone(),
            session_id: request.session_id.clone(),
            attempt_id: request.attempt_id.clone(),
            fence: request.fence,
            expected_project_revision: request.expected_project_revision,
            expected_entity_revision: request.expected_entity_revision,
            expected_proof_revision: request.expected_proof_revision,
            result_id: request.result_id.clone(),
            contract_revision: request.contract_revision,
            outputs: output_facts,
            attestation: request.attestation.clone(),
            operation_id: request.operation_id.clone(),
            at: request.at.clone(),
        };
        let record = AcceptanceStore::new(store).bind_result(&bind)?;
        let lineage = write_result_lineage(catalog, &record);
        Ok(OperationResult {
            operation_id: request.operation_id.clone(),
            snapshot_revision: record.project_revision,
            changed: !record.replayed,
            value: ArtifactAcceptanceResult {
                result: record,
                source_relationship_ids: lineage.source_relationship_ids,
                lineage_pending: lineage.lineage_pending,
            },
        })
    }

    pub fn artifact_result_for_attempt(
        &self,
        project_id: &str,
        work_id: &str,
        attempt_id: &str,
        fence: u64,
    ) -> Result<Option<AcceptanceResultRecord>, ApplicationError> {
        Ok(AcceptanceStore::new(self.store_ref())
            .result_for_attempt(project_id, work_id, attempt_id, fence)?)
    }

    pub fn artifact_result_for_operation(
        &self,
        project_id: &str,
        operation_id: &str,
    ) -> Result<Option<AcceptanceResultRecord>, ApplicationError> {
        Ok(
            AcceptanceStore::new(self.store_ref())
                .result_for_operation(project_id, operation_id)?,
        )
    }

    pub fn artifact_decision_for_submission(
        &self,
        project_id: &str,
        submission_id: &str,
    ) -> Result<Option<ArtifactDecisionRecord>, ApplicationError> {
        Ok(AcceptanceStore::new(self.store_ref()).artifact_decision(project_id, submission_id)?)
    }

    /// Rebuilds the source-catalog projection from the durable acceptance
    /// result, including rights provenance, after a restart or partial cross-
    /// store write. Repeating this call is idempotent.
    pub fn reconcile_artifact_lineage(
        &self,
        catalog: &SourceCatalog,
        project_id: &str,
        operation_id: &str,
    ) -> Result<ArtifactLineageReadback, ApplicationError> {
        let record = AcceptanceStore::new(self.store_ref())
            .result_for_operation(project_id, operation_id)?
            .ok_or_else(|| {
                ApplicationError::Invalid(format!(
                    "acceptance operation {operation_id} has no durable result to reconcile"
                ))
            })?;
        Ok(write_result_lineage(catalog, &record))
    }
}

fn validate_request(request: &ArtifactAcceptanceRequest) -> Result<(), ApplicationError> {
    if request.project_id.trim().is_empty()
        || request.work_id.trim().is_empty()
        || request.actor_id.trim().is_empty()
        || request.session_id.trim().is_empty()
        || request.attempt_id.trim().is_empty()
        || request.result_id.trim().is_empty()
        || request.operation_id.trim().is_empty()
        || request.fence == 0
        || request.expected_project_revision == 0
        || request.expected_proof_revision == 0
        || request.outputs.len() > MAX_ACCEPTANCE_RESULT_OUTPUTS
    {
        return Err(ApplicationError::Invalid(
            "artifact acceptance request has incomplete identity, revisions, or too many outputs"
                .into(),
        ));
    }
    for output in &request.outputs {
        if !valid_relationship_id(&output.relationship_id) {
            return Err(ApplicationError::Invalid(
                "artifact relationship id must be a lowercase key of at most 64 characters".into(),
            ));
        }
        for provenance in [
            output.rights.attribution.as_deref(),
            output.rights.rights_statement.as_deref(),
            output.rights.license.as_deref(),
        ]
        .into_iter()
        .flatten()
        {
            if provenance.len() > 4096 || provenance.as_bytes().contains(&0) {
                return Err(ApplicationError::Invalid(
                    "artifact rights provenance exceeds the 4096 byte bound".into(),
                ));
            }
        }
    }
    if let Some(attestation) = &request.attestation {
        if attestation.statement.trim().is_empty() || attestation.statement.len() > 4096 {
            return Err(ApplicationError::Invalid(
                "completion attestation must contain 1..=4096 bytes".into(),
            ));
        }
    }
    Ok(())
}

fn valid_relationship_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value.as_bytes()[0].is_ascii_lowercase()
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'_' | b'-' | b'.')
        })
}

fn write_result_lineage(
    catalog: &SourceCatalog,
    result: &AcceptanceResultRecord,
) -> ArtifactLineageReadback {
    let mut readback = ArtifactLineageReadback {
        source_relationship_ids: Vec::with_capacity(result.outputs.len()),
        lineage_pending: Vec::new(),
    };
    for output in &result.outputs {
        if output.availability != ArtifactInspectionAvailability::Available {
            readback.lineage_pending.push(format!(
                "{}: source bytes are {} and no verified lineage link was recorded",
                output.source_version_id,
                output.availability.as_str()
            ));
            continue;
        }
        let source = SourceIdentity {
            project_id: result.project_id.clone(),
            source_version_id: output.source_version_id.clone(),
            content_digest: output.content_digest.clone(),
        };
        let relationship_operation = relationship_operation_id(
            &result.project_id,
            &result.work_id,
            &result.attempt_id,
            &result.operation_id,
            &output.relationship_id,
        );
        match catalog.record_artifact_relationship(ArtifactRelationshipInput {
            relationship_id: output.relationship_id.clone(),
            source,
            role: ArtifactRole::ProducedDeliverable,
            scope: ArtifactScope::Project,
            requirement_key: Some(output.requirement_key.clone()),
            produced_by: Some(ArtifactProducer {
                work_id: result.work_id.clone(),
                attempt_id: result.attempt_id.clone(),
                result_id: result.result_id.clone(),
            }),
            rights: ArtifactRightsProvenance {
                attribution: output.attribution.clone(),
                rights_statement: output.rights_statement.clone(),
                license: output.license.clone(),
            },
            operation_id: relationship_operation,
        }) {
            Ok(_) => readback
                .source_relationship_ids
                .push(output.relationship_id.clone()),
            Err(error) => readback.lineage_pending.push(format!(
                "{}: committed acceptance result needs lineage readback: {error}",
                output.source_version_id
            )),
        }
    }
    readback
}

fn inspection_availability(
    source_availability: &SourceAvailability,
    read_error: &SourceError,
) -> Result<ArtifactInspectionAvailability, ApplicationError> {
    let availability = match source_availability {
        SourceAvailability::Missing => ArtifactInspectionAvailability::Missing,
        SourceAvailability::Corrupt => ArtifactInspectionAvailability::Corrupt,
        SourceAvailability::Available => match read_error {
            SourceError::ArtifactTooLarge { .. } => ArtifactInspectionAvailability::TooLarge,
            SourceError::MissingBlob => ArtifactInspectionAvailability::Missing,
            SourceError::DigestMismatch | SourceError::Storage(_) => {
                ArtifactInspectionAvailability::Corrupt
            }
            other => {
                return Err(ApplicationError::Invalid(format!(
                    "artifact read failed without an attributable availability state: {other}"
                )))
            }
        },
    };
    Ok(availability)
}

fn validate_source_version_identity(
    expected: &SourceIdentity,
    actual: &boreal_source::SourceVersion,
) -> Result<(), ApplicationError> {
    if actual.project_id != expected.project_id
        || actual.source_version_id != expected.source_version_id
        || actual.content_digest != expected.content_digest
    {
        return Err(ApplicationError::Invalid(format!(
            "produced artifact {} has a stale or forged source identity",
            expected.source_version_id
        )));
    }
    Ok(())
}

fn relationship_operation_id(
    project_id: &str,
    work_id: &str,
    attempt_id: &str,
    acceptance_operation_id: &str,
    relationship_id: &str,
) -> String {
    let identity = format!(
        "{project_id}\0{work_id}\0{attempt_id}\0{acceptance_operation_id}\0{relationship_id}"
    );
    let digest = crate::sha256_content_digest(identity.as_bytes());
    format!("artifact-link-{}", &digest[7..39])
}

fn parse_requirements(requirements_json: &str) -> Result<Vec<Value>, ApplicationError> {
    let requirements: Value = serde_json::from_str(requirements_json).map_err(|error| {
        ApplicationError::Invalid(format!("invalid deliverable contract: {error}"))
    })?;
    let rows = requirements.as_array().ok_or_else(|| {
        ApplicationError::Invalid("deliverable requirements must be an array".into())
    })?;
    Ok(rows.clone())
}

fn inspect_criteria(
    requirement: &Value,
    bytes: &[u8],
) -> Result<Vec<AcceptanceCriterionResult>, ApplicationError> {
    let criteria = requirement["criteria"]
        .as_array()
        .ok_or_else(|| ApplicationError::Invalid("deliverable criteria must be an array".into()))?;
    criteria
        .iter()
        .map(|criterion| {
            let kind = criterion["kind"].as_str().ok_or_else(|| {
                ApplicationError::Invalid("deliverable criterion kind is missing".into())
            })?;
            match kind {
                "min_bytes" | "max_bytes" => {
                    let threshold = criterion["value"].as_u64().ok_or_else(|| {
                        ApplicationError::Invalid("byte criterion has no bounded value".into())
                    })?;
                    let passed = if kind == "min_bytes" {
                        (bytes.len() as u64) >= threshold
                    } else {
                        (bytes.len() as u64) <= threshold
                    };
                    Ok(AcceptanceCriterionResult {
                        criterion_id: kind.to_owned(),
                        passed,
                        observed: bytes.len().to_string(),
                    })
                }
                "json_document" => {
                    let valid_json = serde_json::from_slice::<Value>(bytes).is_ok();
                    Ok(AcceptanceCriterionResult {
                        criterion_id: kind.to_owned(),
                        passed: valid_json,
                        observed: if valid_json {
                            "valid_json".into()
                        } else {
                            "invalid_json".into()
                        },
                    })
                }
                "text_contains" => {
                    let text = criterion["text"].as_str().ok_or_else(|| {
                        ApplicationError::Invalid("text criterion has no text".into())
                    })?;
                    let content = std::str::from_utf8(bytes);
                    let passed = content.is_ok_and(|content| content.contains(text));
                    Ok(AcceptanceCriterionResult {
                        criterion_id: format!("text_contains:{text}"),
                        passed,
                        observed: if content.is_ok() {
                            if passed { "matched" } else { "not_found" }.into()
                        } else {
                            "not_utf8".into()
                        },
                    })
                }
                _ => Err(ApplicationError::Invalid(format!(
                    "unknown deterministic deliverable criterion {kind}"
                ))),
            }
        })
        .collect()
}

fn unavailable_criteria(
    requirement: &Value,
    reason: &str,
) -> Result<Vec<AcceptanceCriterionResult>, ApplicationError> {
    let criteria = requirement["criteria"]
        .as_array()
        .ok_or_else(|| ApplicationError::Invalid("deliverable criteria must be an array".into()))?;
    criteria
        .iter()
        .map(|criterion| {
            let kind = criterion["kind"].as_str().ok_or_else(|| {
                ApplicationError::Invalid("deliverable criterion kind is missing".into())
            })?;
            let criterion_id = match kind {
                "min_bytes" | "max_bytes" | "json_document" => kind.to_owned(),
                "text_contains" => {
                    let text = criterion["text"].as_str().ok_or_else(|| {
                        ApplicationError::Invalid("text criterion has no text".into())
                    })?;
                    format!("text_contains:{text}")
                }
                _ => {
                    return Err(ApplicationError::Invalid(format!(
                        "unknown deterministic deliverable criterion {kind}"
                    )))
                }
            };
            Ok(AcceptanceCriterionResult {
                criterion_id,
                passed: false,
                observed: reason.to_owned(),
            })
        })
        .collect()
}

fn validate_profile_contract(
    mode: RegisteredAcceptanceMode,
    requirements: &[Value],
) -> Result<(), ApplicationError> {
    let required_count = requirements
        .iter()
        .filter(|requirement| requirement["required"].as_bool() == Some(true))
        .count();
    match mode {
        RegisteredAcceptanceMode::GeneralAttestation if required_count > 0 => {
            Err(ApplicationError::Invalid(
                "acceptance_profile_requires_validated_deliverables: general-attestation/1 cannot satisfy required outputs".into(),
            ))
        }
        RegisteredAcceptanceMode::GeneralAttestation => Ok(()),
        _ if required_count == 0 => Err(ApplicationError::Invalid(
            "validated-deliverables/1 and reviewed-artifacts/1 require a required output contract".into(),
        )),
        _ => Ok(()),
    }
}

fn media_type_is_allowed(requirement: &Value, actual: &str) -> bool {
    requirement["allowed_media_types"]
        .as_array()
        .is_some_and(|media_types| {
            media_types.is_empty()
                || media_types.iter().any(|media| {
                    media
                        .as_str()
                        .is_some_and(|declared| declared_media_type_matches(declared, actual))
                })
        })
}

fn declared_media_type_matches(declared: &str, actual: &str) -> bool {
    if declared == actual {
        return true;
    }

    let Some(declared_type) = declared.strip_suffix("/*") else {
        return false;
    };
    if declared_type.is_empty() || declared_type.contains('/') {
        return false;
    }

    let Some((actual_type, actual_subtype)) = actual.split_once('/') else {
        return false;
    };
    actual_type == declared_type
        && !actual_subtype.is_empty()
        && actual_subtype != "*"
        && !actual_subtype.contains('/')
}

#[cfg(test)]
mod tests {
    use super::*;
    use boreal_domain::{
        AcceptanceProfile, ActorRole, AttemptPhase, DispatchPolicy, GateId, GateKind,
        GateRequirement, PersistedLifecycle, ProfileId, WorkId, WorkItem, WorkKind,
    };
    use boreal_store::acceptance::AcceptanceCriterionResult;
    use boreal_store::{
        identity::{DatabaseIdentity, IdentityStore, WorkspaceBinding},
        principals::PrincipalGrantRequest,
        AttemptMutationKind, AttemptMutationRequest, SessionRegistrationRequest,
        SourceVersionRegistrationInput, SqliteStore,
    };

    #[test]
    fn inspector_reports_byte_json_and_text_results_without_exposing_contents() {
        let requirement = serde_json::json!({
            "criteria": [
                {"kind":"min_bytes", "value":4},
                {"kind":"json_document"},
                {"kind":"text_contains", "text":"hello"}
            ]
        });
        let facts = inspect_criteria(&requirement, br#"{"message":"hello"}"#).unwrap();
        assert_eq!(
            facts,
            vec![
                AcceptanceCriterionResult {
                    criterion_id: "min_bytes".into(),
                    passed: true,
                    observed: "19".into(),
                },
                AcceptanceCriterionResult {
                    criterion_id: "json_document".into(),
                    passed: true,
                    observed: "valid_json".into(),
                },
                AcceptanceCriterionResult {
                    criterion_id: "text_contains:hello".into(),
                    passed: true,
                    observed: "matched".into(),
                },
            ]
        );
        assert!(facts.iter().all(|fact| !fact.observed.contains("hello")));
    }

    #[test]
    fn general_attestation_profile_does_not_cover_required_outputs() {
        let requirements = vec![serde_json::json!({
            "key":"report",
            "required":true,
            "min_count":1,
            "max_count":1,
            "allowed_media_types":["text/plain"],
            "criteria":[]
        })];
        let error =
            validate_profile_contract(RegisteredAcceptanceMode::GeneralAttestation, &requirements)
                .unwrap_err();
        assert!(error
            .to_string()
            .contains("acceptance_profile_requires_validated_deliverables"));
    }

    #[test]
    fn media_type_matching_accepts_exact_and_declared_type_wildcards_only() {
        let image_requirement = serde_json::json!({"allowed_media_types":["image/*"]});
        assert!(media_type_is_allowed(&image_requirement, "image/png"));
        assert!(!media_type_is_allowed(
            &image_requirement,
            "application/pdf"
        ));
        assert!(!media_type_is_allowed(&image_requirement, "image/"));
        assert!(!media_type_is_allowed(
            &image_requirement,
            "image/png/extra"
        ));

        let exact_requirement = serde_json::json!({"allowed_media_types":["image/png"]});
        assert!(media_type_is_allowed(&exact_requirement, "image/png"));
        assert!(!media_type_is_allowed(&exact_requirement, "image/jpeg"));

        let unrestricted_requirement = serde_json::json!({"allowed_media_types":[]});
        assert!(media_type_is_allowed(
            &unrestricted_requirement,
            "application/pdf"
        ));
    }

    #[test]
    fn failed_criterion_is_computed_from_bytes_and_cannot_be_asserted_passed() {
        let requirement = serde_json::json!({
            "criteria": [
                {"kind":"min_bytes", "value":100},
                {"kind":"json_document"},
                {"kind":"text_contains", "text":"approved"}
            ]
        });
        let facts = inspect_criteria(&requirement, b"bad")
            .expect("criteria can be deterministically evaluated");
        assert!(facts.iter().all(|fact| !fact.passed));
        assert_eq!(facts[0].observed, "3");
        assert_eq!(facts[1].observed, "invalid_json");
        assert_eq!(facts[2].observed, "not_found");
    }

    #[test]
    fn oversize_criterion_is_an_explicit_failed_inspection() {
        let requirement = serde_json::json!({
            "criteria": [
                {"kind":"min_bytes", "value":1},
                {"kind":"json_document"}
            ]
        });
        let facts = unavailable_criteria(&requirement, "unavailable:artifact_too_large")
            .expect("typed criteria ids should be preserved");
        assert!(facts.iter().all(|fact| !fact.passed));
        assert!(facts
            .iter()
            .all(|fact| fact.observed == "unavailable:artifact_too_large"));
    }

    #[test]
    fn stale_caller_digest_is_rejected_but_catalog_digest_mismatch_is_corrupt() {
        let version = boreal_source::SourceVersion {
            project_id: "p1".into(),
            source_version_id: "source-1".into(),
            origin: "test".into(),
            media_type: "text/plain".into(),
            byte_count: 3,
            content_digest: "sha256:canonical".into(),
            availability: SourceAvailability::Available,
            parser_identity: None,
        };
        let forged = SourceIdentity {
            project_id: "p1".into(),
            source_version_id: "source-1".into(),
            content_digest: "sha256:other".into(),
        };
        assert!(validate_source_version_identity(&forged, &version).is_err());
        assert_eq!(
            inspection_availability(&SourceAvailability::Corrupt, &SourceError::DigestMismatch)
                .unwrap(),
            ArtifactInspectionAvailability::Corrupt
        );
    }

    #[test]
    fn application_binds_inspected_failed_artifact_with_replay_and_durable_readback() {
        let store = SqliteStore::open_in_memory(include_str!(
            "../../../project/spec/schema-production.sql"
        ))
        .unwrap();
        let database = DatabaseIdentity::new("app-artifact-acceptance", 1).unwrap();
        IdentityStore::new(&store)
            .install(&database, "unix-ms:0")
            .unwrap();
        let workspace = WorkspaceBinding::new(
            "/tmp/boreal-app-artifact-acceptance",
            "/tmp/boreal-app-artifact-acceptance",
            "sha256:app-artifact-acceptance-binding",
        )
        .unwrap();
        store
            .initialize_project_with_workspace(
                "p1",
                "operator-1",
                "operator",
                "boreal-key-v1:sha256:app-artifact-acceptance-credential",
                "Operator",
                "op-app-project-init",
                "sha256:op-app-project-init",
                &database,
                &workspace,
                "unix-ms:0",
            )
            .unwrap();
        let revision = store.project_revision("p1").unwrap().0;
        store
            .grant_principal(&PrincipalGrantRequest {
                project_id: "p1".into(),
                actor_id: "operator-1".into(),
                session_id: None,
                principal_actor_id: "agent-1".into(),
                role: ActorRole::Agent,
                independent: false,
                credential: format!("bwrk1_{}", "e".repeat(64)),
                expires_at_ms: None,
                display_name: "Artifact acceptance agent".into(),
                reason: "application integration fixture".into(),
                expected_revision: revision,
                operation_id: "op-app-agent-grant".into(),
                at: "unix-ms:0".into(),
            })
            .unwrap();
        let revision = store.project_revision("p1").unwrap().0;
        store
            .register_session(SessionRegistrationRequest {
                project_id: "p1".into(),
                session_id: "operator-session".into(),
                actor_id: "operator-1".into(),
                harness_id: "test-harness".into(),
                operation_id: "op-app-operator-session".into(),
                request_digest: "sha256:op-app-operator-session".into(),
                expected_project_revision: Some(revision),
                started_at: "unix-ms:0".into(),
            })
            .unwrap();
        let revision = store.project_revision("p1").unwrap().0;
        store
            .register_session(SessionRegistrationRequest {
                project_id: "p1".into(),
                session_id: "agent-session".into(),
                actor_id: "agent-1".into(),
                harness_id: "test-harness".into(),
                operation_id: "op-app-agent-session".into(),
                request_digest: "sha256:op-app-agent-session".into(),
                expected_project_revision: Some(revision),
                started_at: "unix-ms:0".into(),
            })
            .unwrap();

        let catalog = SourceCatalog::default();
        let bytes = b"short report";
        let version = catalog
            .capture("p1", "report.png", bytes, "image/png")
            .unwrap();
        store
            .register_source_version(&SourceVersionRegistrationInput {
                operation_id: "op-app-source-register".into(),
                project_id: "p1".into(),
                actor_id: "operator-1".into(),
                source_version_id: version.source_version_id.clone(),
                origin: "report.png".into(),
                access_scope: "project".into(),
                content_digest: version.content_digest.clone(),
                media_type: version.media_type.clone(),
                byte_count: version.byte_count as u64,
                captured_at: "unix-ms:1".into(),
                parser_identity: "test-parser/1".into(),
                availability: "available".into(),
                citation_json: "[]".into(),
                request_digest: "sha256:op-app-source-register".into(),
            })
            .unwrap();
        let mut work = WorkItem::new(
            "p1".into(),
            WorkId::new("pilot-report"),
            WorkKind::Task,
            None,
            "Inspect a report artifact",
        );
        work.lifecycle = PersistedLifecycle::Open;
        work.dispatch_policy = DispatchPolicy::Automatic;
        work.acceptance_profile = AcceptanceProfile {
            id: ProfileId::new("validated-deliverables"),
            version: "1".into(),
            gates: vec![GateRequirement::required(
                GateId::new("summary"),
                GateKind::Summary,
            )],
        };
        store
            .create_work_operation_for_session(
                &work,
                "operator-1",
                Some("operator-session"),
                "op-app-work-create",
                "sha256:op-app-work-create",
                Some(store.project_revision("p1").unwrap().0),
                "unix-ms:2",
            )
            .unwrap();
        store.ensure_deliverables_schema().unwrap();
        store
            .execute_batch(
                "BEGIN IMMEDIATE;
                 INSERT INTO work_planning_contract_v1
                   (project_id,work_id,contract_revision,template_id,template_version,
                    requirements_json,inputs_json,actor_id,session_id,operation_id,created_at)
                 VALUES
                   ('p1','pilot-report',1,NULL,NULL,
                    '[{\"key\":\"report\",\"purpose\":\"Provide the requested report\",\"required\":true,\"deliverable_type\":\"report\",\"allowed_media_types\":[\"image/*\"],\"min_count\":1,\"max_count\":1,\"criteria\":[{\"kind\":\"min_bytes\",\"value\":100}]}]',
                    '[]','operator-1','operator-session','op-app-contract','unix-ms:3');
                 COMMIT;",
            )
            .unwrap();
        let claimed = store
            .claim_work_with_context(
                "p1",
                "pilot-report",
                "agent-1",
                "test-harness",
                Some("agent-session"),
                "attempt-app-artifact",
                "op-app-claim",
                "sha256:op-app-claim",
                Some(store.project_revision("p1").unwrap().0),
                "unix-ms:10",
                "unix-ms:5000",
                "unix-ms:9000",
                Some(&version.source_version_id),
                "config-1",
            )
            .unwrap();
        for (operation_id, expected_phase, mutation, at) in [
            (
                "op-app-attempt-accept",
                AttemptPhase::Claimed,
                AttemptMutationKind::Accept,
                "unix-ms:20",
            ),
            (
                "op-app-attempt-start",
                AttemptPhase::Accepted,
                AttemptMutationKind::Start,
                "unix-ms:30",
            ),
        ] {
            store
                .apply_attempt_mutation(AttemptMutationRequest {
                    project_id: "p1".into(),
                    work_id: "pilot-report".into(),
                    attempt_id: claimed.attempt_id.clone(),
                    actor_id: "agent-1".into(),
                    harness_id: Some("test-harness".into()),
                    session_id: Some("agent-session".into()),
                    fence: claimed.fence,
                    operation_id: operation_id.into(),
                    request_digest: format!("sha256:{operation_id}"),
                    at: at.into(),
                    expected_project_revision: None,
                    expected_work_revision: None,
                    expected_attempt_revision: Some(claimed.fence),
                    expected_phase: Some(expected_phase),
                    expected_lease_deadline: None,
                    expected_hard_deadline: None,
                    mutation,
                    reason: None,
                })
                .unwrap();
        }
        let (entity_revision, proof_revision) = store.work_revisions("p1", "pilot-report").unwrap();
        let request = ArtifactAcceptanceRequest {
            project_id: "p1".into(),
            work_id: "pilot-report".into(),
            actor_id: "agent-1".into(),
            session_id: "agent-session".into(),
            attempt_id: claimed.attempt_id,
            fence: claimed.fence,
            expected_project_revision: store.project_revision("p1").unwrap().0,
            expected_entity_revision: entity_revision,
            expected_proof_revision: proof_revision,
            result_id: "result-app-inspection".into(),
            contract_revision: 1,
            outputs: vec![ProducedArtifactInput {
                requirement_key: "report".into(),
                source: SourceIdentity::from_version(&version),
                relationship_id: "report-v1".into(),
                rights: ArtifactRightsProvenance {
                    attribution: Some("agent-1".into()),
                    rights_statement: Some("created for this project".into()),
                    license: None,
                },
            }],
            attestation: None,
            operation_id: "op-app-bind-result".into(),
            at: "unix-ms:40".into(),
        };
        let app = WorkApplication::new(&store);
        let first = app.bind_artifact_result(&catalog, &request).unwrap();
        assert!(first.changed);
        assert_eq!(first.value.result.outputs[0].media_type, "image/png");
        assert!(first.value.result.outputs[0].media_type_allowed);
        assert!(!first.value.result.outputs[0].criteria[0].passed);
        assert_eq!(
            first.value.result.outputs[0].criteria[0].observed,
            bytes.len().to_string()
        );
        assert!(first.value.lineage_pending.is_empty());
        let replay = app.bind_artifact_result(&catalog, &request).unwrap();
        assert!(!replay.changed);
        assert!(replay.value.result.replayed);
        assert_eq!(
            replay.value.result.result_digest,
            first.value.result.result_digest
        );
        assert_eq!(
            app.artifact_result_for_operation("p1", "op-app-bind-result")
                .unwrap()
                .unwrap(),
            first.value.result
        );
        assert!(catalog
            .show_artifact_relationship("p1", "report-v1")
            .unwrap()
            .is_some());

        let mut forged = request.clone();
        forged.result_id = "result-forged-source".into();
        forged.operation_id = "op-app-forged-source".into();
        forged.outputs[0].source.content_digest = format!("sha256:{}", "f".repeat(64));
        let error = app
            .bind_artifact_result(&catalog, &forged)
            .unwrap_err()
            .to_string();
        assert!(error.contains("stale or forged source identity"));
        assert!(app
            .artifact_result_for_operation("p1", "op-app-forged-source")
            .unwrap()
            .is_none());
    }
}
