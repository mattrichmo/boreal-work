//! Optional work output requirements and exact-version input references.
//!
//! These are planning contracts only. They do not contain artifact bytes,
//! availability, storage locators, or acceptance decisions.

use crate::{AttemptId, ProjectId, SourceVersionId, WorkId};
use std::collections::BTreeSet;

pub const MAX_DELIVERABLE_REQUIREMENTS: usize = 64;
pub const MAX_REQUIREMENT_MEDIA_TYPES: usize = 32;
pub const MAX_REQUIREMENT_CRITERIA: usize = 32;
pub const MAX_REQUIREMENT_CARDINALITY: u32 = 100;
pub const MAX_INPUT_ARTIFACT_REFS: usize = 100;
pub const MAX_CRITERION_BYTES: u64 = 1_073_741_824;

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum DeliverableType {
    Code,
    Document,
    Image,
    Dataset,
    Report,
    Archive,
    Other,
}

impl DeliverableType {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Code => "code",
            Self::Document => "document",
            Self::Image => "image",
            Self::Dataset => "dataset",
            Self::Report => "report",
            Self::Archive => "archive",
            Self::Other => "other",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DeliverableRequirement {
    pub key: String,
    pub purpose: String,
    pub required: bool,
    pub deliverable_type: DeliverableType,
    /// Lowercase exact media types or `type/*` ranges.
    pub allowed_media_types: Vec<String>,
    pub min_count: u32,
    pub max_count: u32,
    pub criteria: Vec<DeliverableCriterion>,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub enum DeliverableCriterion {
    NonEmpty,
    MinBytes(u64),
    MaxBytes(u64),
    DigestPresent,
    JsonDocument,
    TextContains(String),
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum InputArtifactRole {
    Context,
    AcceptedInput,
    Reference,
}

impl InputArtifactRole {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Context => "context",
            Self::AcceptedInput => "accepted_input",
            Self::Reference => "reference",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum InputArtifactScope {
    Project,
    Private,
}

impl InputArtifactScope {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Project => "project",
            Self::Private => "private",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ArtifactProductionIdentity {
    pub work_id: WorkId,
    pub attempt_id: AttemptId,
    pub result_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AcceptedResultIdentity {
    pub producer: ArtifactProductionIdentity,
    pub decision_id: String,
    pub submission_id: String,
    pub artifact_set_digest: String,
}

/// A planning relationship to one immutable, project-scoped source version.
/// The source/artifact layer remains responsible for bytes and availability.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InputArtifactRef {
    /// `None` is retained only for pre-v2 templates that predate keyed inputs.
    pub input_key: Option<String>,
    pub required: bool,
    pub project_id: ProjectId,
    pub source_version_id: SourceVersionId,
    pub content_digest: String,
    pub media_type: Option<String>,
    pub byte_count: Option<u64>,
    pub availability: Option<String>,
    pub role: InputArtifactRole,
    pub scope: InputArtifactScope,
    pub produced_by: Option<ArtifactProductionIdentity>,
    pub accepted_result: Option<AcceptedResultIdentity>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DeliverableValidationError(pub String);

impl std::fmt::Display for DeliverableValidationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for DeliverableValidationError {}

/// Validate one normalized requirement declaration.
pub fn validate_deliverable_requirement(
    requirement: &DeliverableRequirement,
) -> Result<(), DeliverableValidationError> {
    if !valid_key(&requirement.key) {
        return Err(DeliverableValidationError(format!(
            "deliverable requirement key '{}' must be a lowercase identifier of 1..64 characters",
            requirement.key
        )));
    }
    if requirement.purpose.trim().is_empty()
        || requirement.purpose.len() > 4096
        || requirement.purpose.contains('\0')
    {
        return Err(DeliverableValidationError(format!(
            "purpose for deliverable requirement '{}' must contain 1..4096 bytes",
            requirement.key
        )));
    }
    if requirement.min_count > requirement.max_count
        || requirement.max_count > MAX_REQUIREMENT_CARDINALITY
        || (requirement.required && requirement.min_count == 0)
        || (!requirement.required && requirement.min_count != 0)
    {
        return Err(DeliverableValidationError(format!(
            "cardinality for '{}' must be 0..={} and required must agree with a positive minimum",
            requirement.key, MAX_REQUIREMENT_CARDINALITY
        )));
    }
    if requirement.allowed_media_types.len() > MAX_REQUIREMENT_MEDIA_TYPES {
        return Err(DeliverableValidationError(format!(
            "requirement '{}' has more than {} media types",
            requirement.key, MAX_REQUIREMENT_MEDIA_TYPES
        )));
    }
    let mut media_types = BTreeSet::new();
    for media_type in &requirement.allowed_media_types {
        if !valid_media_type(media_type) || !media_types.insert(media_type) {
            return Err(DeliverableValidationError(format!(
                "media types for '{}' must be unique lowercase MIME types or type/* ranges",
                requirement.key
            )));
        }
    }
    if requirement.criteria.len() > MAX_REQUIREMENT_CRITERIA {
        return Err(DeliverableValidationError(format!(
            "requirement '{}' has more than {} validation criteria",
            requirement.key, MAX_REQUIREMENT_CRITERIA
        )));
    }
    let mut min_bytes = None;
    let mut max_bytes = None;
    let mut criteria = BTreeSet::new();
    for criterion in &requirement.criteria {
        match criterion {
            DeliverableCriterion::NonEmpty | DeliverableCriterion::DigestPresent => {}
            DeliverableCriterion::MinBytes(value) if *value <= MAX_CRITERION_BYTES => {
                min_bytes = Some(*value);
            }
            DeliverableCriterion::MaxBytes(value)
                if *value > 0 && *value <= MAX_CRITERION_BYTES =>
            {
                max_bytes = Some(*value);
            }
            DeliverableCriterion::JsonDocument => {}
            DeliverableCriterion::TextContains(text)
                if !text.trim().is_empty()
                    && text.len() <= 256
                    && !text.chars().any(char::is_control) => {}
            _ => {
                return Err(DeliverableValidationError(format!(
                    "validation criterion for '{}' is empty or outside its bound",
                    requirement.key
                )))
            }
        }
        // `TextContains` values can be arbitrarily useful but are not useful
        // duplicated. The other variants have a single canonical instance.
        let duplicate = match criterion {
            DeliverableCriterion::NonEmpty => !criteria.insert("non-empty".into()),
            DeliverableCriterion::TextContains(text) => !criteria.insert(format!("text:{text}")),
            DeliverableCriterion::MinBytes(_) => !criteria.insert("min-bytes".into()),
            DeliverableCriterion::MaxBytes(_) => !criteria.insert("max-bytes".into()),
            DeliverableCriterion::DigestPresent => !criteria.insert("digest-present".into()),
            DeliverableCriterion::JsonDocument => !criteria.insert("json-document".into()),
        };
        if duplicate {
            return Err(DeliverableValidationError(format!(
                "validation criteria for '{}' must be unique",
                requirement.key
            )));
        }
    }
    if min_bytes
        .zip(max_bytes)
        .is_some_and(|(minimum, maximum)| minimum > maximum)
    {
        return Err(DeliverableValidationError(format!(
            "minimum byte criterion exceeds maximum for '{}'",
            requirement.key
        )));
    }
    Ok(())
}

pub fn validate_deliverable_requirements(
    requirements: &[DeliverableRequirement],
) -> Result<(), DeliverableValidationError> {
    if requirements.len() > MAX_DELIVERABLE_REQUIREMENTS {
        return Err(DeliverableValidationError(format!(
            "a work item may have at most {MAX_DELIVERABLE_REQUIREMENTS} deliverable requirements"
        )));
    }
    let mut keys = BTreeSet::new();
    for requirement in requirements {
        validate_deliverable_requirement(requirement)?;
        if !keys.insert(requirement.key.as_str()) {
            return Err(DeliverableValidationError(format!(
                "duplicate deliverable requirement key '{}'",
                requirement.key
            )));
        }
    }
    Ok(())
}

pub fn validate_input_artifact_ref(
    input: &InputArtifactRef,
    expected_project: &ProjectId,
) -> Result<(), DeliverableValidationError> {
    if input
        .input_key
        .as_deref()
        .is_some_and(|key| !valid_key(key))
        || (input.input_key.is_none() && input.required)
    {
        return Err(DeliverableValidationError(
            "input references require a stable key when marked required".into(),
        ));
    }
    if &input.project_id != expected_project {
        return Err(DeliverableValidationError(format!(
            "input source {} belongs to project {}, not {}",
            input.source_version_id, input.project_id, expected_project
        )));
    }
    if input.source_version_id.as_str().trim().is_empty()
        || input.content_digest.trim().is_empty()
        || input.content_digest.len() > 255
    {
        return Err(DeliverableValidationError(
            "input reference requires an immutable source version and content digest".into(),
        ));
    }
    if input.produced_by.as_ref().is_some_and(|identity| {
        identity.work_id.as_str().trim().is_empty()
            || identity.attempt_id.as_str().trim().is_empty()
            || identity.result_id.trim().is_empty()
            || identity.result_id.len() > 255
    }) {
        return Err(DeliverableValidationError(
            "input producer provenance requires both work and attempt identities".into(),
        ));
    }
    if let Some(accepted) = &input.accepted_result {
        if input.role != InputArtifactRole::AcceptedInput
            || input.produced_by.as_ref() != Some(&accepted.producer)
            || accepted.decision_id.trim().is_empty()
            || accepted.decision_id.len() > 255
            || accepted.submission_id.trim().is_empty()
            || accepted.submission_id.len() > 255
            || accepted.artifact_set_digest.trim().is_empty()
            || accepted.artifact_set_digest.len() > 255
        {
            return Err(DeliverableValidationError(
                "accepted input provenance must match its producer and include decision, submission, and artifact-set identities".into(),
            ));
        }
    }
    if input
        .media_type
        .as_deref()
        .is_some_and(|value| !valid_media_type(value))
        || input.availability.as_deref().is_some_and(|value| {
            value.trim().is_empty() || value.len() > 64 || value.contains('\0')
        })
        || input.media_type.is_some() != input.byte_count.is_some()
        || input.media_type.is_some() != input.availability.is_some()
    {
        return Err(DeliverableValidationError(
            "input artifact metadata is outside its bound".into(),
        ));
    }
    Ok(())
}

pub fn validate_input_artifact_refs(
    inputs: &[InputArtifactRef],
    expected_project: &ProjectId,
) -> Result<(), DeliverableValidationError> {
    if inputs.len() > MAX_INPUT_ARTIFACT_REFS {
        return Err(DeliverableValidationError(format!(
            "a work item may have at most {MAX_INPUT_ARTIFACT_REFS} input references"
        )));
    }
    let mut keys = BTreeSet::new();
    let mut legacy_identities = BTreeSet::new();
    for input in inputs {
        validate_input_artifact_ref(input, expected_project)?;
        if let Some(key) = input.input_key.as_deref() {
            if !keys.insert(key) {
                return Err(DeliverableValidationError(format!(
                    "duplicate input key '{key}'"
                )));
            }
        } else if !legacy_identities.insert((input.source_version_id.as_str(), input.role.as_str()))
        {
            return Err(DeliverableValidationError(
                "legacy input references must not duplicate a source and role".into(),
            ));
        }
    }
    Ok(())
}

fn valid_key(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'-' | b'_' | b'.')
        })
}

fn valid_media_type(value: &str) -> bool {
    if value.is_empty() || value.len() > 127 || value != value.to_ascii_lowercase() {
        return false;
    }
    let Some((kind, subtype)) = value.split_once('/') else {
        return false;
    };
    !kind.is_empty()
        && !subtype.is_empty()
        && kind.bytes().all(media_token_byte)
        && (subtype == "*" || subtype.bytes().all(media_token_byte))
}

fn media_token_byte(byte: u8) -> bool {
    byte.is_ascii_lowercase()
        || byte.is_ascii_digit()
        || matches!(
            byte,
            b'!' | b'#' | b'$' | b'&' | b'^' | b'_' | b'.' | b'+' | b'-'
        )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn requirement(required: bool, min_count: u32, max_count: u32) -> DeliverableRequirement {
        DeliverableRequirement {
            key: "final-report".into(),
            purpose: "Provide the reviewed report".into(),
            required,
            deliverable_type: DeliverableType::Report,
            allowed_media_types: vec!["application/pdf".into()],
            min_count,
            max_count,
            criteria: vec![DeliverableCriterion::MaxBytes(4_000_000)],
        }
    }

    #[test]
    fn accepts_optional_empty_and_required_multiplicity_contracts() {
        assert!(validate_deliverable_requirements(&[]).is_ok());
        assert!(validate_deliverable_requirement(&requirement(false, 0, 2)).is_ok());
        assert!(validate_deliverable_requirement(&requirement(true, 2, 3)).is_ok());
    }

    #[test]
    fn rejects_unbounded_or_contradictory_requirement_declarations() {
        assert!(validate_deliverable_requirement(&requirement(true, 0, 1)).is_err());
        assert!(validate_deliverable_requirement(&requirement(false, 1, 1)).is_err());
        assert!(validate_deliverable_requirement(&requirement(true, 3, 2)).is_err());
        let mut invalid = requirement(true, 1, 1);
        invalid.criteria = vec![
            DeliverableCriterion::MinBytes(20),
            DeliverableCriterion::MaxBytes(10),
        ];
        assert!(validate_deliverable_requirement(&invalid).is_err());
    }

    #[test]
    fn exact_input_identity_is_project_scoped_and_requires_digest() {
        let project = ProjectId::new("p1");
        let input = InputArtifactRef {
            input_key: Some("approved-source".into()),
            required: true,
            project_id: project.clone(),
            source_version_id: SourceVersionId::new("source-v7"),
            content_digest: "sha256:abc".into(),
            media_type: Some("text/plain".into()),
            byte_count: Some(10),
            availability: Some("available".into()),
            role: InputArtifactRole::AcceptedInput,
            scope: InputArtifactScope::Project,
            produced_by: Some(ArtifactProductionIdentity {
                work_id: WorkId::new("producer"),
                attempt_id: AttemptId::new("attempt-1"),
                result_id: "result-1".into(),
            }),
            accepted_result: Some(AcceptedResultIdentity {
                producer: ArtifactProductionIdentity {
                    work_id: WorkId::new("producer"),
                    attempt_id: AttemptId::new("attempt-1"),
                    result_id: "result-1".into(),
                },
                decision_id: "decision-1".into(),
                submission_id: "submission-1".into(),
                artifact_set_digest: "sha256:result".into(),
            }),
        };
        assert!(validate_input_artifact_ref(&input, &project).is_ok());
        assert!(validate_input_artifact_ref(&input, &ProjectId::new("other")).is_err());
        let mut incomplete_metadata = input.clone();
        incomplete_metadata.byte_count = None;
        assert!(validate_input_artifact_ref(&incomplete_metadata, &project).is_err());
        let duplicate = input.clone();
        assert!(validate_input_artifact_refs(&[input, duplicate], &project).is_err());
    }
}
