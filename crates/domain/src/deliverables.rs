//! General-work deliverable contracts and attributable, typed proof.
//!
//! These values describe accepted identities and decisions. They do not
//! capture files, execute commands, or grant authority to accept work.

use std::collections::{BTreeMap, BTreeSet};

use crate::{ActorId, ProjectId, SourceVersionId, TimestampMs, WorkId};

pub const MAX_OUTPUT_REQUIREMENTS: usize = 64;
pub const MAX_OUTPUTS_PER_REQUIREMENT: u16 = 100;
pub const MAX_MEDIA_TYPES_PER_REQUIREMENT: usize = 16;
pub const MAX_CRITERIA_PER_REQUIREMENT: usize = 16;

#[derive(Clone, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub struct RequirementKey(String);

impl RequirementKey {
    pub fn parse(value: impl Into<String>) -> Result<Self, DeliverableError> {
        let value = value.into();
        if value.is_empty()
            || value.len() > 64
            || !value.bytes().all(|byte| {
                byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"._-".contains(&byte)
            })
            || !value.as_bytes()[0].is_ascii_lowercase() && !value.as_bytes()[0].is_ascii_digit()
        {
            return Err(DeliverableError::InvalidRequirementKey(value));
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DeliverableType {
    Document,
    Image,
    Data,
    Archive,
    Code,
    Other,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ValidationCriterion {
    MinimumBytes(u64),
    MaximumBytes(u64),
    MinimumImageWidth(u32),
    MinimumImageHeight(u32),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OutputRequirement {
    pub key: RequirementKey,
    pub purpose: String,
    pub required: bool,
    pub deliverable_type: DeliverableType,
    pub allowed_media_types: Vec<String>,
    pub minimum_count: u16,
    pub maximum_count: u16,
    pub criteria: Vec<ValidationCriterion>,
}

impl OutputRequirement {
    pub fn validate(&self) -> Result<(), DeliverableError> {
        if self.purpose.trim().is_empty()
            || self.purpose.len() > 512
            || self.purpose.chars().any(char::is_control)
        {
            return Err(DeliverableError::InvalidRequirement(
                self.key.as_str().to_owned(),
                "purpose must contain 1..=512 bytes".into(),
            ));
        }
        if self.minimum_count > self.maximum_count
            || self.maximum_count == 0
            || self.maximum_count > MAX_OUTPUTS_PER_REQUIREMENT
            || (self.required && self.minimum_count == 0)
        {
            return Err(DeliverableError::InvalidRequirement(
                self.key.as_str().to_owned(),
                "required outputs need a positive minimum; cardinality must be ordered and at most 100".into(),
            ));
        }
        if self.allowed_media_types.is_empty()
            || self.allowed_media_types.len() > MAX_MEDIA_TYPES_PER_REQUIREMENT
        {
            return Err(DeliverableError::InvalidRequirement(
                self.key.as_str().to_owned(),
                "allowed_media_types must contain 1..=16 exact media types".into(),
            ));
        }
        if !self
            .allowed_media_types
            .iter()
            .any(|media_type| media_matches_deliverable_type(self.deliverable_type, media_type))
        {
            return Err(DeliverableError::InvalidRequirement(
                self.key.as_str().to_owned(),
                "allowed media types do not match the declared deliverable type".into(),
            ));
        }
        let mut media_types = BTreeSet::new();
        for media_type in &self.allowed_media_types {
            if !valid_media_type(media_type) || !media_types.insert(media_type.to_ascii_lowercase())
            {
                return Err(DeliverableError::InvalidRequirement(
                    self.key.as_str().to_owned(),
                    format!("invalid or duplicate exact media type {media_type:?}"),
                ));
            }
        }
        if self.criteria.len() > MAX_CRITERIA_PER_REQUIREMENT {
            return Err(DeliverableError::InvalidRequirement(
                self.key.as_str().to_owned(),
                "criteria exceed the bound of 16".into(),
            ));
        }
        let mut seen = BTreeSet::new();
        for criterion in &self.criteria {
            let key = criterion.key();
            if !seen.insert(key) {
                return Err(DeliverableError::InvalidRequirement(
                    self.key.as_str().to_owned(),
                    "criteria cannot contain duplicate rule kinds".into(),
                ));
            }
            if matches!(criterion, ValidationCriterion::MaximumBytes(0)) {
                return Err(DeliverableError::InvalidRequirement(
                    self.key.as_str().to_owned(),
                    "maximum byte count must be positive".into(),
                ));
            }
            if matches!(
                criterion,
                ValidationCriterion::MinimumImageWidth(_)
                    | ValidationCriterion::MinimumImageHeight(_)
            ) && self.deliverable_type != DeliverableType::Image
            {
                return Err(DeliverableError::InvalidRequirement(
                    self.key.as_str().to_owned(),
                    "image dimension criteria require an image deliverable".into(),
                ));
            }
        }
        Ok(())
    }
}

impl ValidationCriterion {
    fn key(&self) -> u8 {
        match self {
            Self::MinimumBytes(_) => 0,
            Self::MaximumBytes(_) => 1,
            Self::MinimumImageWidth(_) => 2,
            Self::MinimumImageHeight(_) => 3,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OutputContract {
    pub project_id: ProjectId,
    pub work_id: WorkId,
    pub revision: u64,
    pub requirements: Vec<OutputRequirement>,
    pub digest: String,
}

impl OutputContract {
    pub fn validate(&self) -> Result<(), DeliverableError> {
        if self.revision == 0 {
            return Err(DeliverableError::InvalidContract(
                "revision must be positive".into(),
            ));
        }
        if self.requirements.len() > MAX_OUTPUT_REQUIREMENTS {
            return Err(DeliverableError::InvalidContract(format!(
                "at most {MAX_OUTPUT_REQUIREMENTS} output requirements are supported"
            )));
        }
        let mut keys = BTreeSet::new();
        for requirement in &self.requirements {
            requirement.validate()?;
            if !keys.insert(requirement.key.clone()) {
                return Err(DeliverableError::DuplicateRequirement(
                    requirement.key.as_str().to_owned(),
                ));
            }
        }
        if self.digest.len() != 71
            || !self.digest.starts_with("sha256:")
            || !self.digest[7..]
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit())
        {
            return Err(DeliverableError::InvalidContract(
                "contract digest must be a nonempty sha256 identity".into(),
            ));
        }
        Ok(())
    }
}

/// Registered rigor names. `focused` and `reviewed` retain their legacy
/// command-proof meaning; the general-work profiles add artifact rules.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RigorProfile {
    pub id: String,
    pub version: u32,
}

impl RigorProfile {
    pub const LIGHTWEIGHT: &'static str = "lightweight";
    pub const DELIVERABLES: &'static str = "deliverables-validated";
    pub const REVIEWED_ARTIFACTS: &'static str = "reviewed-artifacts";
    pub const SOFTWARE_VERIFICATION: &'static str = "software-verification";

    pub fn supported(id: impl Into<String>, version: u32) -> Result<Self, DeliverableError> {
        let id = id.into();
        if version == 0
            || !matches!(
                id.as_str(),
                "lightweight"
                    | "deliverables-validated"
                    | "reviewed-artifacts"
                    | "software-verification"
                    | "focused"
                    | "reviewed"
            )
        {
            return Err(DeliverableError::UnsupportedRigor { id, version });
        }
        // Every profile accepted by this wire contract has a frozen v1
        // meaning. Legacy focused/reviewed profiles retain their existing
        // v1 meanings; a newer version must be registered before selection.
        if version != 1 {
            return Err(DeliverableError::UnsupportedRigor { id, version });
        }
        Ok(Self { id, version })
    }

    pub fn requires_inspection(&self) -> bool {
        matches!(
            self.id.as_str(),
            Self::DELIVERABLES | Self::REVIEWED_ARTIFACTS
        )
    }

    pub fn requires_independent_decision(&self) -> bool {
        matches!(self.id.as_str(), Self::REVIEWED_ARTIFACTS | "reviewed")
    }

    pub fn preserves_legacy_software_proof(&self) -> bool {
        matches!(
            self.id.as_str(),
            Self::SOFTWARE_VERIFICATION | "focused" | "reviewed"
        )
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ArtifactAvailability {
    Available,
    Missing,
    Quarantined,
    Denied,
    Corrupt,
    Unsupported,
}

impl ArtifactAvailability {
    pub const fn is_usable(self) -> bool {
        matches!(self, Self::Available)
    }
}

/// Content-addressed artifact identity. No host path participates in identity.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ArtifactIdentity {
    pub project_id: ProjectId,
    pub source_version_id: SourceVersionId,
    pub content_digest: String,
    pub media_type: String,
    pub byte_count: u64,
    pub availability: ArtifactAvailability,
}

impl ArtifactIdentity {
    pub fn validate(&self) -> Result<(), DeliverableError> {
        if self.content_digest.len() != 71
            || !self.content_digest.starts_with("sha256:")
            || !self.content_digest[7..]
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit())
        {
            return Err(DeliverableError::InvalidArtifact(
                "content digest is not sha256".into(),
            ));
        }
        let source_version_id = self.source_version_id.as_str();
        if source_version_id.trim().is_empty()
            || source_version_id.len() > 255
            || source_version_id.chars().any(char::is_control)
        {
            return Err(DeliverableError::InvalidArtifact(
                "source version identity is invalid".into(),
            ));
        }
        if !valid_media_type(&self.media_type) {
            return Err(DeliverableError::InvalidArtifact(
                "media type is invalid".into(),
            ));
        }
        if self.byte_count > 1_073_741_824 {
            return Err(DeliverableError::InvalidArtifact(
                "artifact exceeds 1 GiB bound".into(),
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProducedArtifact {
    pub artifact_id: String,
    pub requirement_key: RequirementKey,
    pub submission_id: String,
    pub identity: ArtifactIdentity,
    pub producing_work_id: WorkId,
    pub attempt_id: String,
    pub fence: u64,
    pub producer_actor_id: ActorId,
    pub captured_at: TimestampMs,
}

impl ProducedArtifact {
    pub fn validate(&self) -> Result<(), DeliverableError> {
        self.identity.validate()?;
        for (field, value) in [
            ("artifact_id", &self.artifact_id),
            ("submission_id", &self.submission_id),
            ("attempt_id", &self.attempt_id),
        ] {
            if value.trim().is_empty() || value.len() > 255 {
                return Err(DeliverableError::InvalidArtifact(format!(
                    "{field} must contain 1..=255 bytes"
                )));
            }
        }
        if self.fence == 0 {
            return Err(DeliverableError::InvalidArtifact(
                "producer fence must be positive".into(),
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum InputSource {
    CapturedSource {
        source_version_id: SourceVersionId,
    },
    ProducedArtifact {
        producing_work_id: WorkId,
        submission_id: String,
        artifact_id: String,
        source_version_id: SourceVersionId,
    },
}

/// Immutable accepted input. Replacement appends a new binding revision.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AcceptedInput {
    pub project_id: ProjectId,
    pub work_id: WorkId,
    pub revision: u64,
    pub key: String,
    pub role: String,
    pub required: bool,
    pub source: InputSource,
    pub accepted_by: ActorId,
    pub accepted_at: TimestampMs,
}

impl AcceptedInput {
    pub fn validate(&self) -> Result<(), DeliverableError> {
        if self.revision == 0 {
            return Err(DeliverableError::InvalidInput(
                "revision must be positive".into(),
            ));
        }
        validate_bounded_label("input key", &self.key, 64)?;
        validate_bounded_label("input role", &self.role, 128)?;
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InspectorKind {
    Automatic,
    Human,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InspectionOutcome {
    Passed,
    Failed,
    Unavailable,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CriterionObservation {
    pub criterion: String,
    pub outcome: InspectionOutcome,
    pub detail: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ArtifactInspection {
    pub inspection_id: String,
    pub project_id: ProjectId,
    pub work_id: WorkId,
    pub submission_id: String,
    pub artifact_id: String,
    pub artifact_digest: String,
    pub inspector_actor_id: ActorId,
    pub inspector_kind: InspectorKind,
    pub outcome: InspectionOutcome,
    pub criteria: Vec<CriterionObservation>,
    pub inspected_at: TimestampMs,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AcceptanceDecisionKind {
    Approved,
    Rejected,
    NeedsRevision,
}

/// Human acceptance is deliberately separate from command-execution receipts.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ArtifactDecision {
    pub decision_id: String,
    pub project_id: ProjectId,
    pub work_id: WorkId,
    pub submission_id: String,
    pub contract_revision: u64,
    pub input_revision: u64,
    pub proof_revision: u64,
    pub artifact_set_digest: String,
    pub reviewer_actor_id: ActorId,
    pub producer_actor_id: ActorId,
    pub decision: AcceptanceDecisionKind,
    pub reason: String,
    pub decided_at: TimestampMs,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CoverageIssue {
    MissingRequired(String),
    OptionalMissing(String),
    TooMany(String),
    WrongProject(String),
    WrongSubmission(String),
    WrongProducingWork(String),
    UndeclaredRequirement(String),
    WrongDeliverableType(String),
    WrongMediaType(String),
    ArtifactUnavailable(String),
    MissingInspection(String),
    FailedInspection(String),
    StaleSubmission,
    StaleDecision,
    DecisionRequired,
    DecisionRejected,
    ReviewerMustBeIndependent,
    DecisionProducerMismatch,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OutputCoverage {
    pub accepted: bool,
    pub issues: Vec<CoverageIssue>,
    pub covered_requirement_keys: Vec<String>,
}

/// Evaluate one exact immutable submission against one contract and input set.
/// Optional absence is reported but is never a blocking issue.
pub fn evaluate_output_coverage(
    contract: &OutputContract,
    rigor: &RigorProfile,
    submission_id: &str,
    input_revision: u64,
    proof_revision: u64,
    artifacts: &[ProducedArtifact],
    inspections: &[ArtifactInspection],
    decision: Option<&ArtifactDecision>,
    expected_artifact_set_digest: &str,
) -> Result<OutputCoverage, DeliverableError> {
    contract.validate()?;
    if artifacts.len() > MAX_OUTPUT_REQUIREMENTS * usize::from(MAX_OUTPUTS_PER_REQUIREMENT) {
        return Err(DeliverableError::InvalidContract(
            "submission exceeds output bound".into(),
        ));
    }
    let requirements = contract
        .requirements
        .iter()
        .map(|requirement| (requirement.key.as_str(), requirement))
        .collect::<BTreeMap<_, _>>();
    let mut issues = Vec::new();
    let mut covered = BTreeSet::new();
    let mut counts = BTreeMap::<String, usize>::new();
    let mut valid_counts = BTreeMap::<String, usize>::new();

    for artifact in artifacts {
        artifact.validate()?;
        if artifact.submission_id != submission_id {
            issues.push(CoverageIssue::WrongSubmission(artifact.artifact_id.clone()));
            continue;
        }
        if artifact.identity.project_id != contract.project_id {
            issues.push(CoverageIssue::WrongProject(artifact.artifact_id.clone()));
            continue;
        }
        if artifact.producing_work_id != contract.work_id {
            issues.push(CoverageIssue::WrongProducingWork(
                artifact.artifact_id.clone(),
            ));
            continue;
        }
        let Some(requirement) = requirements.get(artifact.requirement_key.as_str()) else {
            issues.push(CoverageIssue::UndeclaredRequirement(
                artifact.requirement_key.as_str().to_owned(),
            ));
            continue;
        };
        *counts
            .entry(artifact.requirement_key.as_str().to_owned())
            .or_default() += 1;
        let matching_media = requirement
            .allowed_media_types
            .iter()
            .any(|media| media.eq_ignore_ascii_case(&artifact.identity.media_type));
        if !media_matches_deliverable_type(
            requirement.deliverable_type,
            &artifact.identity.media_type,
        ) {
            issues.push(CoverageIssue::WrongDeliverableType(
                artifact.artifact_id.clone(),
            ));
            continue;
        }
        if !matching_media {
            issues.push(CoverageIssue::WrongMediaType(artifact.artifact_id.clone()));
            continue;
        }
        if !artifact.identity.availability.is_usable() {
            issues.push(CoverageIssue::ArtifactUnavailable(
                artifact.artifact_id.clone(),
            ));
            continue;
        }
        let applicable_inspection = inspections
            .iter()
            .filter(|inspection| {
                inspection.project_id == contract.project_id
                    && inspection.work_id == contract.work_id
                    && inspection.submission_id == submission_id
                    && inspection.artifact_id == artifact.artifact_id
                    && inspection.artifact_digest == artifact.identity.content_digest
                    && inspection.inspector_kind == InspectorKind::Automatic
            })
            .max_by_key(|inspection| inspection.inspected_at);
        if rigor.requires_inspection() {
            match applicable_inspection {
                None => issues.push(CoverageIssue::MissingInspection(
                    artifact.artifact_id.clone(),
                )),
                Some(inspection) if inspection.outcome != InspectionOutcome::Passed => {
                    issues.push(CoverageIssue::FailedInspection(
                        artifact.artifact_id.clone(),
                    ));
                }
                Some(_) => {}
            }
            if applicable_inspection
                .is_none_or(|inspection| inspection.outcome != InspectionOutcome::Passed)
            {
                continue;
            }
        }
        let mut criteria_passed = true;
        for criterion in &requirement.criteria {
            let passed = match criterion {
                ValidationCriterion::MinimumBytes(minimum) => {
                    artifact.identity.byte_count >= *minimum
                }
                ValidationCriterion::MaximumBytes(maximum) => {
                    artifact.identity.byte_count <= *maximum
                }
                ValidationCriterion::MinimumImageWidth(_)
                | ValidationCriterion::MinimumImageHeight(_) => {
                    let name = criterion_observation_key(criterion);
                    match applicable_inspection.and_then(|inspection| {
                        inspection
                            .criteria
                            .iter()
                            .find(|observation| observation.criterion == name)
                    }) {
                        Some(observation) if observation.outcome == InspectionOutcome::Passed => {
                            true
                        }
                        Some(_) => {
                            issues.push(CoverageIssue::FailedInspection(
                                artifact.artifact_id.clone(),
                            ));
                            false
                        }
                        None => {
                            issues.push(CoverageIssue::MissingInspection(
                                artifact.artifact_id.clone(),
                            ));
                            false
                        }
                    }
                }
            };
            if !passed {
                if !matches!(
                    criterion,
                    ValidationCriterion::MinimumImageWidth(_)
                        | ValidationCriterion::MinimumImageHeight(_)
                ) {
                    issues.push(CoverageIssue::FailedInspection(
                        artifact.artifact_id.clone(),
                    ));
                }
                criteria_passed = false;
            }
        }
        if !criteria_passed {
            continue;
        }
        covered.insert(artifact.requirement_key.as_str().to_owned());
        *valid_counts
            .entry(artifact.requirement_key.as_str().to_owned())
            .or_default() += 1;
    }

    for requirement in &contract.requirements {
        let submitted_count = counts.get(requirement.key.as_str()).copied().unwrap_or(0);
        let valid_count = valid_counts
            .get(requirement.key.as_str())
            .copied()
            .unwrap_or(0);
        if submitted_count > usize::from(requirement.maximum_count) {
            issues.push(CoverageIssue::TooMany(requirement.key.as_str().to_owned()));
        }
        if valid_count < usize::from(requirement.minimum_count) {
            if requirement.required {
                issues.push(CoverageIssue::MissingRequired(
                    requirement.key.as_str().to_owned(),
                ));
            } else {
                issues.push(CoverageIssue::OptionalMissing(
                    requirement.key.as_str().to_owned(),
                ));
            }
        }
    }

    if rigor.requires_independent_decision()
        && artifacts
            .iter()
            .any(|artifact| artifact.submission_id == submission_id)
    {
        match decision {
            None => issues.push(CoverageIssue::DecisionRequired),
            Some(decision)
                if decision.project_id != contract.project_id
                    || decision.work_id != contract.work_id
                    || decision.submission_id != submission_id
                    || decision.contract_revision != contract.revision
                    || decision.input_revision != input_revision
                    || decision.proof_revision != proof_revision
                    || decision.artifact_set_digest != expected_artifact_set_digest =>
            {
                issues.push(CoverageIssue::StaleDecision)
            }
            Some(decision) if decision.reviewer_actor_id == decision.producer_actor_id => {
                issues.push(CoverageIssue::ReviewerMustBeIndependent)
            }
            Some(decision)
                if artifacts
                    .iter()
                    .filter(|artifact| artifact.submission_id == submission_id)
                    .any(|artifact| artifact.producer_actor_id != decision.producer_actor_id) =>
            {
                issues.push(CoverageIssue::DecisionProducerMismatch)
            }
            Some(decision) if decision.decision != AcceptanceDecisionKind::Approved => {
                issues.push(CoverageIssue::DecisionRejected)
            }
            Some(_) => {}
        }
    }

    let accepted = !issues
        .iter()
        .any(|issue| !matches!(issue, CoverageIssue::OptionalMissing(_)));
    Ok(OutputCoverage {
        accepted,
        issues,
        covered_requirement_keys: covered.into_iter().collect(),
    })
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DeliverableError {
    InvalidRequirementKey(String),
    DuplicateRequirement(String),
    InvalidRequirement(String, String),
    InvalidContract(String),
    UnsupportedRigor { id: String, version: u32 },
    InvalidArtifact(String),
    InvalidInput(String),
}

fn valid_media_type(value: &str) -> bool {
    if value.len() > 127 || value.contains('*') || value.contains(';') {
        return false;
    }
    let Some((major, minor)) = value.split_once('/') else {
        return false;
    };
    value.matches('/').count() == 1
        && !major.is_empty()
        && !minor.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"!#$&^_.+-/".contains(&byte))
}

fn media_matches_deliverable_type(deliverable_type: DeliverableType, media_type: &str) -> bool {
    let Some((major, _)) = media_type.split_once('/') else {
        return false;
    };
    match deliverable_type {
        DeliverableType::Image => major.eq_ignore_ascii_case("image"),
        DeliverableType::Archive => major.eq_ignore_ascii_case("application"),
        DeliverableType::Document | DeliverableType::Data | DeliverableType::Code => {
            major.eq_ignore_ascii_case("text") || major.eq_ignore_ascii_case("application")
        }
        DeliverableType::Other => true,
    }
}

fn criterion_observation_key(criterion: &ValidationCriterion) -> String {
    match criterion {
        ValidationCriterion::MinimumBytes(value) => format!("minimum_bytes:{value}"),
        ValidationCriterion::MaximumBytes(value) => format!("maximum_bytes:{value}"),
        ValidationCriterion::MinimumImageWidth(value) => format!("minimum_image_width:{value}"),
        ValidationCriterion::MinimumImageHeight(value) => format!("minimum_image_height:{value}"),
    }
}

fn validate_bounded_label(field: &str, value: &str, max: usize) -> Result<(), DeliverableError> {
    if value.trim().is_empty() || value.len() > max || value.chars().any(char::is_control) {
        return Err(DeliverableError::InvalidInput(format!(
            "{field} must contain 1..={max} non-control bytes"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn requirement(key: &str, required: bool, min: u16) -> OutputRequirement {
        OutputRequirement {
            key: RequirementKey::parse(key).unwrap(),
            purpose: "Approved deliverable".into(),
            required,
            deliverable_type: DeliverableType::Image,
            allowed_media_types: vec!["image/png".into()],
            minimum_count: min,
            maximum_count: 3,
            criteria: vec![ValidationCriterion::MaximumBytes(10_000_000)],
        }
    }

    fn contract(requirements: Vec<OutputRequirement>) -> OutputContract {
        OutputContract {
            project_id: ProjectId::new("p"),
            work_id: WorkId::new("w"),
            revision: 2,
            requirements,
            digest: format!("sha256:{}", "0123456789abcdef".repeat(4)),
        }
    }

    fn artifact(
        id: &str,
        key: &str,
        submission: &str,
        availability: ArtifactAvailability,
    ) -> ProducedArtifact {
        ProducedArtifact {
            artifact_id: id.into(),
            requirement_key: RequirementKey::parse(key).unwrap(),
            submission_id: submission.into(),
            identity: ArtifactIdentity {
                project_id: ProjectId::new("p"),
                source_version_id: SourceVersionId::new(format!("source-{id}")),
                content_digest:
                    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into(),
                media_type: "image/png".into(),
                byte_count: 128,
                availability,
            },
            producing_work_id: WorkId::new("w"),
            attempt_id: "attempt".into(),
            fence: 1,
            producer_actor_id: ActorId::new("producer"),
            captured_at: TimestampMs(10),
        }
    }

    #[test]
    fn empty_contract_keeps_legacy_work_compatible() {
        let value = contract(vec![]);
        assert!(value.validate().is_ok());
        let rigor = RigorProfile::supported("lightweight", 1).unwrap();
        let coverage =
            evaluate_output_coverage(&value, &rigor, "s", 1, 1, &[], &[], None, "set").unwrap();
        assert!(coverage.accepted);
        assert!(coverage.issues.is_empty());
    }

    #[test]
    fn optional_only_work_can_close_without_submission_or_review() {
        let value = contract(vec![requirement("reference", false, 1)]);
        let rigor = RigorProfile::supported("reviewed-artifacts", 1).unwrap();
        let coverage =
            evaluate_output_coverage(&value, &rigor, "s", 0, 2, &[], &[], None, "set").unwrap();
        assert!(coverage.accepted);
        assert_eq!(
            coverage.issues,
            vec![CoverageIssue::OptionalMissing("reference".into())]
        );
    }

    #[test]
    fn optional_absence_is_visible_but_required_multiplicity_blocks() {
        let value = contract(vec![
            requirement("logo", true, 2),
            requirement("notes", false, 1),
        ]);
        let rigor = RigorProfile::supported("lightweight", 1).unwrap();
        let coverage = evaluate_output_coverage(
            &value,
            &rigor,
            "s",
            1,
            2,
            &[artifact("a", "logo", "s", ArtifactAvailability::Available)],
            &[],
            None,
            "set",
        )
        .unwrap();
        assert!(!coverage.accepted);
        assert!(coverage
            .issues
            .contains(&CoverageIssue::MissingRequired("logo".into())));
        assert!(coverage
            .issues
            .contains(&CoverageIssue::OptionalMissing("notes".into())));
    }

    #[test]
    fn unavailable_wrong_format_and_stale_review_do_not_pass() {
        let value = contract(vec![requirement("master", true, 1)]);
        let rigor = RigorProfile::supported("reviewed-artifacts", 1).unwrap();
        let mut item = artifact("a", "master", "s", ArtifactAvailability::Missing);
        item.identity.media_type = "image/jpeg".into();
        let coverage = evaluate_output_coverage(
            &value,
            &rigor,
            "s",
            4,
            3,
            &[item],
            &[],
            Some(&ArtifactDecision {
                decision_id: "d".into(),
                project_id: ProjectId::new("p"),
                work_id: WorkId::new("w"),
                submission_id: "old-submission".into(),
                contract_revision: 1,
                input_revision: 3,
                proof_revision: 2,
                artifact_set_digest: "old".into(),
                reviewer_actor_id: ActorId::new("reviewer"),
                producer_actor_id: ActorId::new("producer"),
                decision: AcceptanceDecisionKind::Approved,
                reason: "looks good".into(),
                decided_at: TimestampMs(20),
            }),
            "set",
        )
        .unwrap();
        assert!(!coverage.accepted);
        assert!(coverage
            .issues
            .contains(&CoverageIssue::WrongMediaType("a".into())));
        assert!(coverage
            .issues
            .contains(&CoverageIssue::MissingRequired("master".into())));
        assert!(coverage.issues.contains(&CoverageIssue::StaleDecision));
    }

    #[test]
    fn criteria_media_and_rigor_names_are_bounded_and_typed() {
        let mut value = requirement("brief", true, 1);
        value.allowed_media_types = vec!["image/*".into()];
        assert!(value.validate().is_err());
        assert!(RigorProfile::supported("my-custom-policy", 1).is_err());
        assert!(RigorProfile::supported("deliverables-validated", 2).is_err());
        assert!(RigorProfile::supported("reviewed", 2).is_err());
        value.allowed_media_types = vec!["image/png/extra".into()];
        assert!(value.validate().is_err());
    }

    #[test]
    fn quarantined_artifacts_remain_unusable_without_becoming_corrupt() {
        assert!(!ArtifactAvailability::Quarantined.is_usable());
        assert_ne!(
            ArtifactAvailability::Quarantined,
            ArtifactAvailability::Corrupt
        );
    }

    #[test]
    fn declared_criteria_and_failed_latest_inspection_block_exact_output() {
        let mut required = requirement("master", true, 1);
        required.criteria = vec![ValidationCriterion::MaximumBytes(64)];
        let value = contract(vec![required]);
        let rigor = RigorProfile::supported("deliverables-validated", 1).unwrap();
        let item = artifact("a", "master", "s", ArtifactAvailability::Available);
        let inspection = ArtifactInspection {
            inspection_id: "inspect-1".into(),
            project_id: ProjectId::new("p"),
            work_id: WorkId::new("w"),
            submission_id: "s".into(),
            artifact_id: "a".into(),
            artifact_digest: item.identity.content_digest.clone(),
            inspector_actor_id: ActorId::new("validator"),
            inspector_kind: InspectorKind::Automatic,
            outcome: InspectionOutcome::Passed,
            criteria: Vec::new(),
            inspected_at: TimestampMs(10),
        };
        let coverage = evaluate_output_coverage(
            &value,
            &rigor,
            "s",
            1,
            2,
            &[item],
            &[inspection],
            None,
            "set",
        )
        .unwrap();
        assert!(!coverage.accepted);
        assert!(coverage
            .issues
            .contains(&CoverageIssue::FailedInspection("a".into())));
    }
}
