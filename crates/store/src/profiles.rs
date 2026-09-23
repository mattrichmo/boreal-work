//! Immutable acceptance-profile and pinned-requirement contracts.
//!
//! This module owns the storage-facing data contract for profile definitions
//! and resolved requirements.  Observed gate rows are deliberately separate:
//! deleting an observation cannot delete, or reduce, the requirement set.
//! The `SqliteStore` root remains the transaction/schema integration owner.

use super::{checksum, SqliteStore, StoreError, SQLITE_ROW};
use serde_json::{Map, Value};
use std::collections::{BTreeMap, BTreeSet};

pub const ACCEPTANCE_CONTRACT: &str = "boreal.acceptance/2";

#[derive(Clone, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub struct ProfileKey {
    pub profile_id: String,
    pub version: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProfileIdentity {
    pub profile_id: String,
    pub version: u64,
    pub policy_digest: String,
}

impl ProfileIdentity {
    pub fn key(&self) -> ProfileKey {
        ProfileKey {
            profile_id: self.profile_id.clone(),
            version: self.version,
        }
    }

    pub fn matches(&self, other: &Self) -> bool {
        self == other
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProfileVersion {
    pub profile_id: String,
    pub version: u64,
    pub policy_digest: String,
    pub definition_json: String,
    pub created_at: String,
}

impl ProfileVersion {
    pub fn new(
        profile_id: impl Into<String>,
        version: u64,
        policy_digest: impl Into<String>,
        definition_json: impl Into<String>,
        created_at: impl Into<String>,
    ) -> Result<Self, StoreError> {
        let definition_json = canonical_json(&definition_json.into()).map_err(|_| {
            StoreError::Invalid("acceptance profile definition is not JSON".to_owned())
        })?;
        let profile = Self {
            profile_id: profile_id.into(),
            version,
            policy_digest: policy_digest.into(),
            definition_json,
            created_at: created_at.into(),
        };
        profile.validate_shape()?;
        Ok(profile)
    }

    /// Constructs a profile whose digest is verified against canonical JSON.
    pub fn from_canonical_definition(
        profile_id: impl Into<String>,
        version: u64,
        policy_digest: impl Into<String>,
        definition_json: impl Into<String>,
        created_at: impl Into<String>,
    ) -> Result<Self, StoreError> {
        let profile = Self::new(
            profile_id,
            version,
            policy_digest,
            definition_json,
            created_at,
        )?;
        profile.validate_content_digest()?;
        Ok(profile)
    }

    pub fn identity(&self) -> ProfileIdentity {
        ProfileIdentity {
            profile_id: self.profile_id.clone(),
            version: self.version,
            policy_digest: self.policy_digest.clone(),
        }
    }

    pub fn definition_json(&self) -> &str {
        &self.definition_json
    }

    pub fn canonical_definition(&self) -> Result<String, StoreError> {
        canonical_json(&self.definition_json)
    }

    pub fn computed_digest(&self) -> Result<String, StoreError> {
        Ok(checksum(self.canonical_definition()?.as_bytes()))
    }

    pub fn validate_content_digest(&self) -> Result<(), StoreError> {
        let computed = self.computed_digest()?;
        if self.policy_digest != computed {
            return Err(StoreError::Conflict(format!(
                "acceptance profile {} version {} digest drift: stored {}, computed {}",
                self.profile_id, self.version, self.policy_digest, computed
            )));
        }
        Ok(())
    }

    fn validate_shape(&self) -> Result<(), StoreError> {
        if self.profile_id.trim().is_empty() {
            return Err(StoreError::Invalid(
                "acceptance profile id is required".to_owned(),
            ));
        }
        if self.version == 0 {
            return Err(StoreError::Invalid(
                "acceptance profile version must be positive".to_owned(),
            ));
        }
        if !self.policy_digest.starts_with("sha256:") || self.policy_digest.len() <= "sha256:".len()
        {
            return Err(StoreError::Invalid(
                "acceptance profile digest must be a non-empty sha256 value".to_owned(),
            ));
        }
        if self.definition_json.trim().is_empty() {
            return Err(StoreError::Invalid(
                "acceptance profile definition is required".to_owned(),
            ));
        }
        let definition = serde_json::from_str::<Value>(&self.definition_json).map_err(|_| {
            StoreError::Invalid("acceptance profile definition is not JSON".to_owned())
        })?;
        if !definition.is_object() {
            return Err(StoreError::Invalid(
                "acceptance profile definition must be an object".to_owned(),
            ));
        }
        if self.created_at.trim().is_empty() {
            return Err(StoreError::Invalid(
                "acceptance profile created_at is required".to_owned(),
            ));
        }
        Ok(())
    }
}

/// A profile definition's subject is explicit so milestone/container
/// requirements cannot be mistaken for executable task requirements.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RequirementSubjectKind {
    Task,
    Container,
}

impl RequirementSubjectKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Task => "task",
            Self::Container => "container",
        }
    }

    fn parse(value: &str) -> Result<Self, StoreError> {
        match value {
            "task" => Ok(Self::Task),
            "container" => Ok(Self::Container),
            other => Err(StoreError::Corrupt(format!(
                "unknown pinned requirement subject kind: {other}"
            ))),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RequirementProvenance {
    pub profile_id: String,
    pub profile_version: u64,
    pub profile_digest: String,
    pub resolved_at: String,
    pub source: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GateRequirementDeclaration {
    pub requirement_id: String,
    pub gate_id: String,
    pub kind: String,
    pub required: bool,
    pub verifier_policy: String,
    pub subject_rules: Value,
    pub observable_rules: Vec<String>,
    pub review_policy: Value,
    pub exception_policy: String,
}

impl GateRequirementDeclaration {
    fn from_json(value: &Value, profile: &Value, index: usize) -> Result<Self, StoreError> {
        let object = value.as_object().ok_or_else(|| {
            StoreError::Invalid(format!("acceptance profile gate {index} is not an object"))
        })?;
        let gate_id = required_string(object, "id", &format!("gate {index} id"))?;
        let kind = required_string(object, "kind", &format!("gate {gate_id} kind"))?;
        let required = match object.get("required") {
            None => true,
            Some(Value::Bool(required)) => *required,
            Some(_) => {
                return Err(StoreError::Invalid(format!(
                    "acceptance profile gate {gate_id} required flag is not boolean"
                )))
            }
        };
        let verifier_policy = profile
            .get("verifier_policy")
            .and_then(Value::as_str)
            .unwrap_or("trusted_registered_verifier")
            .to_owned();
        let subject_rules = profile
            .get("subject_rules")
            .cloned()
            .unwrap_or_else(|| Value::Object(Map::new()));
        let observable_rules = match profile.get("required_observables") {
            None => Vec::new(),
            Some(Value::Array(values)) => values
                .iter()
                .map(|value| {
                    value.as_str().map(str::to_owned).ok_or_else(|| {
                        StoreError::Invalid(format!(
                            "acceptance profile gate {gate_id} required observable is not a string"
                        ))
                    })
                })
                .collect::<Result<Vec<_>, _>>()?,
            Some(_) => {
                return Err(StoreError::Invalid(
                    "acceptance profile required_observables is not an array".to_owned(),
                ))
            }
        };
        let review_policy = profile
            .get("review_policy")
            .cloned()
            .unwrap_or_else(|| Value::Object(Map::new()));
        let exception_policy = profile
            .get("exception_policy")
            .and_then(Value::as_str)
            .unwrap_or("operator_scoped_additional_decision")
            .to_owned();
        Ok(Self {
            requirement_id: format!("{gate_id}@{kind}"),
            gate_id,
            kind,
            required,
            verifier_policy,
            subject_rules,
            observable_rules,
            review_policy,
            exception_policy,
        })
    }

    fn canonical_value(&self) -> Value {
        serde_json::json!({
            "requirement_id": self.requirement_id,
            "gate_id": self.gate_id,
            "kind": self.kind,
            "required": self.required,
            "verifier_policy": self.verifier_policy,
            "subject_rules": self.subject_rules,
            "observable_rules": self.observable_rules,
            "review_policy": self.review_policy,
            "exception_policy": self.exception_policy,
        })
    }

    fn from_persisted_value(value: &Value, index: usize) -> Result<Self, StoreError> {
        let object = value.as_object().ok_or_else(|| {
            StoreError::Corrupt(format!(
                "persisted pinned requirement {index} is not an object"
            ))
        })?;
        let requirement_id = required_string(object, "requirement_id", "pinned requirement id")?;
        let gate_id = required_string(object, "gate_id", "pinned requirement gate id")?;
        let kind = required_string(object, "kind", "pinned requirement kind")?;
        let required = object
            .get("required")
            .and_then(Value::as_bool)
            .ok_or_else(|| {
                StoreError::Corrupt(format!(
                    "persisted pinned requirement {requirement_id} has no boolean required flag"
                ))
            })?;
        let verifier_policy = required_string(
            object,
            "verifier_policy",
            "pinned requirement verifier policy",
        )?;
        let subject_rules = object.get("subject_rules").cloned().ok_or_else(|| {
            StoreError::Corrupt("pinned requirement subject rules missing".to_owned())
        })?;
        let observable_rules = object
            .get("observable_rules")
            .and_then(Value::as_array)
            .ok_or_else(|| {
                StoreError::Corrupt("pinned requirement observable rules missing".to_owned())
            })?
            .iter()
            .map(|value| {
                value.as_str().map(str::to_owned).ok_or_else(|| {
                    StoreError::Corrupt(
                        "pinned requirement observable rule is not a string".to_owned(),
                    )
                })
            })
            .collect::<Result<Vec<_>, _>>()?;
        let review_policy = object.get("review_policy").cloned().ok_or_else(|| {
            StoreError::Corrupt("pinned requirement review policy missing".to_owned())
        })?;
        let exception_policy = required_string(
            object,
            "exception_policy",
            "pinned requirement exception policy",
        )?;
        Ok(Self {
            requirement_id,
            gate_id,
            kind,
            required,
            verifier_policy,
            subject_rules,
            observable_rules,
            review_policy,
            exception_policy,
        })
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PinnedRequirements {
    pub project_id: String,
    pub work_id: String,
    pub proof_revision: u64,
    pub subject_kind: RequirementSubjectKind,
    pub profile: ProfileIdentity,
    pub provenance: RequirementProvenance,
    pub declarations: Vec<GateRequirementDeclaration>,
    pub resolved_digest: String,
}

impl PinnedRequirements {
    pub fn resolve(
        profile: &ProfileVersion,
        project_id: impl Into<String>,
        work_id: impl Into<String>,
        proof_revision: u64,
        subject_kind: RequirementSubjectKind,
        resolved_at: impl Into<String>,
    ) -> Result<Self, StoreError> {
        profile.validate_content_digest()?;
        if proof_revision == 0 {
            return Err(StoreError::Invalid(
                "pinned requirements proof revision must be positive".to_owned(),
            ));
        }
        let document: Value = serde_json::from_str(&profile.definition_json).map_err(|_| {
            StoreError::Invalid("acceptance profile definition is not JSON".to_owned())
        })?;
        let profile_object = document.as_object().ok_or_else(|| {
            StoreError::Invalid("acceptance profile definition must be an object".to_owned())
        })?;
        let gates = profile_object
            .get("gates")
            .and_then(Value::as_array)
            .ok_or_else(|| {
                StoreError::Invalid("acceptance profile definition has no gates array".to_owned())
            })?;
        let mut declarations = Vec::with_capacity(gates.len());
        let mut ids = BTreeSet::new();
        for (index, gate) in gates.iter().enumerate() {
            let declaration = GateRequirementDeclaration::from_json(gate, &document, index)?;
            if !ids.insert(declaration.requirement_id.clone()) {
                return Err(StoreError::Conflict(format!(
                    "duplicate acceptance requirement {}",
                    declaration.requirement_id
                )));
            }
            declarations.push(declaration);
        }
        let project_id = project_id.into();
        let work_id = work_id.into();
        if project_id.trim().is_empty() || work_id.trim().is_empty() {
            return Err(StoreError::Invalid(
                "pinned requirements require project and work identities".to_owned(),
            ));
        }
        let provenance = RequirementProvenance {
            profile_id: profile.profile_id.clone(),
            profile_version: profile.version,
            profile_digest: profile.policy_digest.clone(),
            resolved_at: resolved_at.into(),
            source: format!("profile:{}/{}", profile.profile_id, profile.version),
        };
        if provenance.resolved_at.trim().is_empty() {
            return Err(StoreError::Invalid(
                "pinned requirements resolution time is required".to_owned(),
            ));
        }
        let mut result = Self {
            project_id,
            work_id,
            proof_revision,
            subject_kind,
            profile: profile.identity(),
            provenance,
            declarations,
            resolved_digest: String::new(),
        };
        result.resolved_digest = checksum(result.canonical_json()?.as_bytes());
        Ok(result)
    }

    pub fn canonical_json(&self) -> Result<String, StoreError> {
        let declarations: Vec<Value> = self
            .declarations
            .iter()
            .map(GateRequirementDeclaration::canonical_value)
            .collect();
        Ok(canonical_value(&serde_json::json!({
            "contract": ACCEPTANCE_CONTRACT,
            "project_id": self.project_id,
            "work_id": self.work_id,
            "proof_revision": self.proof_revision,
            "subject_kind": self.subject_kind.as_str(),
            "profile": {
                "id": self.profile.profile_id,
                "version": self.profile.version,
                "digest": self.profile.policy_digest,
            },
            "provenance": {
                "source": self.provenance.source,
                "resolved_at": self.provenance.resolved_at,
            },
            "requirements": declarations,
        })))
    }

    pub fn required_ids(&self) -> BTreeSet<String> {
        self.declarations
            .iter()
            .filter(|declaration| declaration.required)
            .map(|declaration| declaration.requirement_id.clone())
            .collect()
    }

    /// Returns the immutable declarations that can block acceptance.
    ///
    /// This is intentionally derived from the pinned declaration snapshot,
    /// never from observed `gate` or `receipt` rows.  Closeout and status
    /// callers can therefore distinguish “the observation is missing” from
    /// “the requirement does not exist.”
    pub fn required_declarations(&self) -> impl Iterator<Item = &GateRequirementDeclaration> {
        self.declarations
            .iter()
            .filter(|declaration| declaration.required)
    }

    /// Returns whether a required declaration of the supplied kind exists.
    /// The caller should use this against a persisted snapshot, not a live
    /// projection of observed gate rows.
    pub fn requires_kind(&self, kind: &str) -> bool {
        self.required_declarations()
            .any(|declaration| declaration.kind == kind)
    }

    fn validate_for_persistence(&self) -> Result<(), StoreError> {
        if self.project_id.trim().is_empty() || self.work_id.trim().is_empty() {
            return Err(StoreError::Invalid(
                "pinned requirements require project and work identities".to_owned(),
            ));
        }
        if self.proof_revision == 0 {
            return Err(StoreError::Invalid(
                "pinned requirements proof revision must be positive".to_owned(),
            ));
        }
        if self.profile.profile_id.trim().is_empty()
            || self.profile.version == 0
            || !self.profile.policy_digest.starts_with("sha256:")
            || self.profile.policy_digest.len() <= "sha256:".len()
        {
            return Err(StoreError::Invalid(
                "pinned requirements profile identity is incomplete".to_owned(),
            ));
        }
        if self.provenance.profile_id != self.profile.profile_id
            || self.provenance.profile_version != self.profile.version
            || self.provenance.profile_digest != self.profile.policy_digest
            || self.provenance.source.trim().is_empty()
            || self.provenance.resolved_at.trim().is_empty()
        {
            return Err(StoreError::Conflict(
                "pinned requirements provenance does not match profile identity".to_owned(),
            ));
        }
        let mut ids = BTreeSet::new();
        for declaration in &self.declarations {
            if declaration.requirement_id.trim().is_empty()
                || declaration.gate_id.trim().is_empty()
                || declaration.kind.trim().is_empty()
            {
                return Err(StoreError::Invalid(
                    "pinned requirement declarations require stable gate identities".to_owned(),
                ));
            }
            if !ids.insert(declaration.requirement_id.clone()) {
                return Err(StoreError::Conflict(format!(
                    "duplicate pinned requirement {}",
                    declaration.requirement_id
                )));
            }
        }
        let canonical = self.canonical_json()?;
        let computed = checksum(canonical.as_bytes());
        if self.resolved_digest != computed {
            return Err(StoreError::Conflict(format!(
                "pinned requirements digest drift: stored {}, computed {computed}",
                self.resolved_digest
            )));
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn from_stored_row(
        project_id: String,
        work_id: String,
        proof_revision: u64,
        subject_kind: String,
        profile_id: String,
        profile_version: u64,
        profile_digest: String,
        provenance_json: String,
        declarations_json: String,
        resolved_digest: String,
    ) -> Result<Self, StoreError> {
        let provenance: Value = serde_json::from_str(&provenance_json).map_err(|_| {
            StoreError::Corrupt("pinned requirements provenance is not valid JSON".to_owned())
        })?;
        let provenance_object = provenance.as_object().ok_or_else(|| {
            StoreError::Corrupt("pinned requirements provenance is not an object".to_owned())
        })?;
        let provenance_profile_id = required_string(
            provenance_object,
            "profile_id",
            "pinned provenance profile id",
        )?;
        let provenance_profile_version = provenance_object
            .get("profile_version")
            .and_then(Value::as_u64)
            .ok_or_else(|| {
                StoreError::Corrupt("pinned provenance profile version is invalid".to_owned())
            })?;
        let provenance_profile_digest = required_string(
            provenance_object,
            "profile_digest",
            "pinned provenance profile digest",
        )?;
        let source = required_string(provenance_object, "source", "pinned provenance source")?;
        let resolved_at = required_string(
            provenance_object,
            "resolved_at",
            "pinned provenance resolved_at",
        )?;
        let declarations: Value = serde_json::from_str(&declarations_json).map_err(|_| {
            StoreError::Corrupt("pinned requirements declarations are not valid JSON".to_owned())
        })?;
        let declarations = declarations
            .as_array()
            .ok_or_else(|| {
                StoreError::Corrupt("pinned requirements declarations are not an array".to_owned())
            })?
            .iter()
            .enumerate()
            .map(|(index, value)| GateRequirementDeclaration::from_persisted_value(value, index))
            .collect::<Result<Vec<_>, _>>()?;
        let requirements = Self {
            project_id,
            work_id,
            proof_revision,
            subject_kind: RequirementSubjectKind::parse(&subject_kind)?,
            profile: ProfileIdentity {
                profile_id: profile_id.clone(),
                version: profile_version,
                policy_digest: profile_digest.clone(),
            },
            provenance: RequirementProvenance {
                profile_id: provenance_profile_id,
                profile_version: provenance_profile_version,
                profile_digest: provenance_profile_digest,
                resolved_at,
                source,
            },
            declarations,
            resolved_digest,
        };
        requirements.validate_for_persistence()?;
        Ok(requirements)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GateObservation {
    pub requirement_id: String,
    pub profile_id: String,
    pub profile_version: u64,
    pub profile_digest: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RequirementFinding {
    MissingRequiredObservation { requirement_id: String },
    ObservationProfileDrift { requirement_id: String },
    UnexpectedObservation { requirement_id: String },
    LegacyDefinitionQuarantined,
}

/// Compare observations with the pinned requirement declaration set. The
/// declaration set is the authority; observations are only evidence.
pub fn audit_observations(
    requirements: &PinnedRequirements,
    observations: &[GateObservation],
) -> Vec<RequirementFinding> {
    let declared: BTreeSet<_> = requirements
        .declarations
        .iter()
        .map(|declaration| declaration.requirement_id.as_str())
        .collect();
    let mut findings = Vec::new();
    let mut observed = BTreeSet::new();
    for observation in observations {
        if !declared.contains(observation.requirement_id.as_str()) {
            findings.push(RequirementFinding::UnexpectedObservation {
                requirement_id: observation.requirement_id.clone(),
            });
            continue;
        }
        observed.insert(observation.requirement_id.as_str());
        if observation.profile_id != requirements.profile.profile_id
            || observation.profile_version != requirements.profile.version
            || observation.profile_digest != requirements.profile.policy_digest
        {
            findings.push(RequirementFinding::ObservationProfileDrift {
                requirement_id: observation.requirement_id.clone(),
            });
        }
    }
    for requirement_id in requirements.required_ids() {
        if !observed.contains(requirement_id.as_str()) {
            findings.push(RequirementFinding::MissingRequiredObservation { requirement_id });
        }
    }
    findings.sort_by(|left, right| format!("{left:?}").cmp(&format!("{right:?}")));
    findings
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum LegacyDefinitionDisposition {
    Reconstructed { canonical_digest: String },
    Quarantined { code: &'static str },
}

/// Empty legacy definitions are never silently treated as a zero-gate profile.
/// They are reconstructable only when an authoritative definition is supplied.
pub fn classify_legacy_definition(
    persisted_definition_json: &str,
    authoritative_definition_json: Option<&str>,
) -> Result<LegacyDefinitionDisposition, StoreError> {
    let persisted = canonical_json(persisted_definition_json)?;
    if persisted != "{}" {
        return Ok(LegacyDefinitionDisposition::Reconstructed {
            canonical_digest: checksum(persisted.as_bytes()),
        });
    }
    let Some(authoritative) = authoritative_definition_json else {
        return Ok(LegacyDefinitionDisposition::Quarantined {
            code: "legacy_profile_definition_missing",
        });
    };
    let canonical = canonical_json(authoritative)?;
    if canonical == "{}" {
        return Ok(LegacyDefinitionDisposition::Quarantined {
            code: "legacy_profile_definition_ambiguous",
        });
    }
    Ok(LegacyDefinitionDisposition::Reconstructed {
        canonical_digest: checksum(canonical.as_bytes()),
    })
}

/// Deterministic in-memory registry used by the store boundary and its
/// focused contract tests. The coordinator must connect this conflict check
/// to the root transaction and durable `acceptance_profile` table.
#[derive(Default)]
pub struct ProfileRegistry {
    versions: BTreeMap<ProfileKey, ProfileVersion>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RegistrationOutcome {
    Inserted,
    Unchanged,
}

impl ProfileRegistry {
    pub fn register(&mut self, profile: ProfileVersion) -> Result<RegistrationOutcome, StoreError> {
        profile.validate_content_digest()?;
        let key = profile.identity().key();
        match self.versions.get(&key) {
            None => {
                self.versions.insert(key, profile);
                Ok(RegistrationOutcome::Inserted)
            }
            Some(existing) => {
                let same_definition =
                    existing.canonical_definition()? == profile.canonical_definition()?;
                if existing.policy_digest == profile.policy_digest && same_definition {
                    Ok(RegistrationOutcome::Unchanged)
                } else {
                    Err(StoreError::Conflict(format!(
                        "acceptance profile {}/{} conflicts with stored digest {}",
                        existing.profile_id, existing.version, existing.policy_digest
                    )))
                }
            }
        }
    }

    pub fn get(&self, profile_id: &str, version: u64) -> Option<&ProfileVersion> {
        self.versions.get(&ProfileKey {
            profile_id: profile_id.to_owned(),
            version,
        })
    }
}

pub struct ProfileStore<'a> {
    store: &'a SqliteStore,
}

/// Compatibility DDL retained only for explicitly noncanonical schema-v2 test
/// fixtures. Canonical production opens install these objects through the
/// ordered migration boundary in `schema-production.sql`; profile reads and
/// production writes never execute this batch.
const PINNED_REQUIREMENTS_SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS boreal_pinned_requirement (
  project_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  proof_revision INTEGER NOT NULL CHECK (proof_revision > 0),
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('task','container')),
  profile_id TEXT NOT NULL CHECK (trim(profile_id) <> ''),
  profile_version INTEGER NOT NULL CHECK (profile_version > 0),
  profile_digest TEXT NOT NULL CHECK (trim(profile_digest) <> ''),
  provenance_json TEXT NOT NULL CHECK (trim(provenance_json) <> ''),
  declarations_json TEXT NOT NULL CHECK (trim(declarations_json) <> ''),
  resolved_digest TEXT NOT NULL CHECK (trim(resolved_digest) <> ''),
  pinned_at TEXT NOT NULL CHECK (trim(pinned_at) <> ''),
  PRIMARY KEY (project_id, work_id, proof_revision),
  UNIQUE (project_id, work_id, proof_revision, resolved_digest),
  FOREIGN KEY (project_id, work_id)
    REFERENCES work_item(project_id, work_id)
);

CREATE TABLE IF NOT EXISTS boreal_pinned_requirement_gate (
  project_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  proof_revision INTEGER NOT NULL CHECK (proof_revision > 0),
  requirement_id TEXT NOT NULL CHECK (trim(requirement_id) <> ''),
  gate_id TEXT NOT NULL CHECK (trim(gate_id) <> ''),
  kind TEXT NOT NULL CHECK (trim(kind) <> ''),
  required INTEGER NOT NULL CHECK (required IN (0, 1)),
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('task','container')),
  profile_id TEXT NOT NULL CHECK (trim(profile_id) <> ''),
  profile_version INTEGER NOT NULL CHECK (profile_version > 0),
  profile_digest TEXT NOT NULL CHECK (trim(profile_digest) <> ''),
  provenance_json TEXT NOT NULL CHECK (trim(provenance_json) <> ''),
  declaration_json TEXT NOT NULL CHECK (trim(declaration_json) <> ''),
  PRIMARY KEY (project_id, work_id, proof_revision, requirement_id),
  UNIQUE (project_id, work_id, proof_revision, gate_id, kind),
  FOREIGN KEY (project_id, work_id, proof_revision)
    REFERENCES boreal_pinned_requirement(project_id, work_id, proof_revision)
);

CREATE INDEX IF NOT EXISTS boreal_pinned_requirement_project
  ON boreal_pinned_requirement(project_id, work_id, proof_revision);

CREATE TRIGGER IF NOT EXISTS boreal_pinned_requirement_immutable_update
  BEFORE UPDATE ON boreal_pinned_requirement
BEGIN
  SELECT RAISE(ABORT, 'pinned_requirement_immutable');
END;
CREATE TRIGGER IF NOT EXISTS boreal_pinned_requirement_immutable_delete
  BEFORE DELETE ON boreal_pinned_requirement
BEGIN
  SELECT RAISE(ABORT, 'pinned_requirement_immutable');
END;
CREATE TRIGGER IF NOT EXISTS boreal_pinned_requirement_gate_immutable_update
  BEFORE UPDATE ON boreal_pinned_requirement_gate
BEGIN
  SELECT RAISE(ABORT, 'pinned_requirement_gate_immutable');
END;
CREATE TRIGGER IF NOT EXISTS boreal_pinned_requirement_gate_immutable_delete
  BEFORE DELETE ON boreal_pinned_requirement_gate
BEGIN
  SELECT RAISE(ABORT, 'pinned_requirement_gate_immutable');
END;
"#;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PinnedRequirementsOutcome {
    Inserted,
    Unchanged,
}

impl<'a> ProfileStore<'a> {
    pub const fn new(store: &'a SqliteStore) -> Self {
        Self { store }
    }

    /// Verifies that the ordered production opener installed the immutable
    /// requirement schema. This method is intentionally read-only: a status
    /// read must never create tables or triggers as a side effect.
    pub fn ensure_pinned_requirements_schema(&self) -> Result<(), StoreError> {
        self.require_pinned_requirements_schema()
    }

    fn ensure_pinned_requirements_schema_for_write(&self) -> Result<(), StoreError> {
        let installed = self.pinned_requirements_schema_installed()?;
        if !installed {
            if self.store.canonical_production {
                return Err(StoreError::Corrupt(
                    "canonical production schema is missing pinned requirement tables".to_owned(),
                ));
            }
            // Noncanonical schema-v2 callers are compatibility fixtures only.
            // They may opt into the additive seam on first write, but all
            // subsequent reads still verify the complete schema without DDL.
            self.store.execute_batch(PINNED_REQUIREMENTS_SCHEMA_SQL)?;
        }
        self.require_pinned_requirements_schema()
    }

    fn require_pinned_requirements_schema(&self) -> Result<(), StoreError> {
        if !self.pinned_requirements_schema_installed()? {
            return Err(StoreError::Corrupt(
                "pinned requirement schema is not installed through the production opener"
                    .to_owned(),
            ));
        }
        Ok(())
    }

    fn pinned_requirements_schema_installed(&self) -> Result<bool, StoreError> {
        for table in [
            "boreal_pinned_requirement",
            "boreal_pinned_requirement_gate",
        ] {
            if !self.store.table_exists(table)? {
                return Ok(false);
            }
        }
        for index in ["boreal_pinned_requirement_project"] {
            if !self.store.schema_object_exists("index", index)? {
                return Ok(false);
            }
        }
        for trigger in [
            "boreal_pinned_requirement_immutable_update",
            "boreal_pinned_requirement_immutable_delete",
            "boreal_pinned_requirement_gate_immutable_update",
            "boreal_pinned_requirement_gate_immutable_delete",
        ] {
            if !self.store.schema_object_exists("trigger", trigger)? {
                return Ok(false);
            }
        }
        Ok(true)
    }

    /// Compatibility registration for existing callers. Validate the complete
    /// immutable profile before delegating to the root's transaction-owned
    /// profile persistence and legacy reconstruction boundary.
    pub fn register(&self, profile: &ProfileVersion) -> Result<(), StoreError> {
        self.validate_for_immutable_registration(profile)?;
        self.store.ensure_acceptance_profile(
            &profile.profile_id,
            profile.version,
            &profile.policy_digest,
            &profile.definition_json,
            &profile.created_at,
        )
    }

    pub fn validate_for_immutable_registration(
        &self,
        profile: &ProfileVersion,
    ) -> Result<(), StoreError> {
        profile.validate_content_digest()?;
        if profile.canonical_definition()? == "{}" {
            return Err(StoreError::Conflict(format!(
                "acceptance profile {}/{} has no authoritative definition",
                profile.profile_id, profile.version
            )));
        }
        Ok(())
    }

    /// Persists one immutable requirement snapshot for a project/work proof
    /// revision. Repeating the exact snapshot is idempotent; a different
    /// profile, declaration set, or provenance for the same scope is a
    /// conflict and cannot overwrite history.
    pub fn persist_pinned_requirements(
        &self,
        requirements: &PinnedRequirements,
    ) -> Result<PinnedRequirementsOutcome, StoreError> {
        self.store.execute_batch("BEGIN IMMEDIATE")?;
        let result = self.persist_pinned_requirements_in_transaction(requirements);
        super::finish_transaction(self.store, result)
    }

    /// Persists a requirement snapshot inside a caller-owned semantic
    /// mutation transaction. The work row, declaration snapshot, and any
    /// operation/audit bundle can therefore commit or roll back together.
    pub fn persist_pinned_requirements_in_transaction(
        &self,
        requirements: &PinnedRequirements,
    ) -> Result<PinnedRequirementsOutcome, StoreError> {
        requirements.validate_for_persistence()?;
        self.ensure_pinned_requirements_schema_for_write()?;
        let declarations_json = canonical_value(&Value::Array(
            requirements
                .declarations
                .iter()
                .map(GateRequirementDeclaration::canonical_value)
                .collect(),
        ));
        let provenance_json = canonical_value(&serde_json::json!({
            "profile_id": requirements.provenance.profile_id,
            "profile_version": requirements.provenance.profile_version,
            "profile_digest": requirements.provenance.profile_digest,
            "resolved_at": requirements.provenance.resolved_at,
            "source": requirements.provenance.source,
        }));

        if let Some(existing) = self.read_pinned_requirements_inner(
            &requirements.project_id,
            &requirements.work_id,
            requirements.proof_revision,
        )? {
            if existing == *requirements {
                return Ok(PinnedRequirementsOutcome::Unchanged);
            }
            return Err(StoreError::Conflict(format!(
                "pinned requirements conflict for {}/{}/revision-{}",
                requirements.project_id, requirements.work_id, requirements.proof_revision
            )));
        }
        self.validate_persisted_profile(&requirements.profile)?;

        let mut header = self.store.prepare(
            "INSERT INTO boreal_pinned_requirement
                 (project_id, work_id, proof_revision, subject_kind, profile_id,
                  profile_version, profile_digest, provenance_json, declarations_json,
                  resolved_digest, pinned_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        )?;
        header.bind_text(1, &requirements.project_id)?;
        header.bind_text(2, &requirements.work_id)?;
        header.bind_i64(3, requirements.proof_revision)?;
        header.bind_text(4, requirements.subject_kind.as_str())?;
        header.bind_text(5, &requirements.profile.profile_id)?;
        header.bind_i64(6, requirements.profile.version)?;
        header.bind_text(7, &requirements.profile.policy_digest)?;
        header.bind_text(8, &provenance_json)?;
        header.bind_text(9, &declarations_json)?;
        header.bind_text(10, &requirements.resolved_digest)?;
        header.bind_text(11, &requirements.provenance.resolved_at)?;
        header.run()?;

        for declaration in &requirements.declarations {
            let declaration_json = canonical_value(&declaration.canonical_value());
            let mut gate = self.store.prepare(
                "INSERT INTO boreal_pinned_requirement_gate
                     (project_id, work_id, proof_revision, requirement_id, gate_id, kind,
                      required, subject_kind, profile_id, profile_version, profile_digest,
                      provenance_json, declaration_json)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            )?;
            gate.bind_text(1, &requirements.project_id)?;
            gate.bind_text(2, &requirements.work_id)?;
            gate.bind_i64(3, requirements.proof_revision)?;
            gate.bind_text(4, &declaration.requirement_id)?;
            gate.bind_text(5, &declaration.gate_id)?;
            gate.bind_text(6, &declaration.kind)?;
            gate.bind_i64(7, u64::from(declaration.required))?;
            gate.bind_text(8, requirements.subject_kind.as_str())?;
            gate.bind_text(9, &requirements.profile.profile_id)?;
            gate.bind_i64(10, requirements.profile.version)?;
            gate.bind_text(11, &requirements.profile.policy_digest)?;
            gate.bind_text(12, &provenance_json)?;
            gate.bind_text(13, &declaration_json)?;
            gate.run()?;
        }
        Ok(PinnedRequirementsOutcome::Inserted)
    }

    /// Reads the immutable requirement snapshot independently of observed gate
    /// rows. A missing/deleted observation therefore remains an observation
    /// finding against the same durable declaration set.
    pub fn read_pinned_requirements(
        &self,
        project_id: &str,
        work_id: &str,
        proof_revision: u64,
    ) -> Result<Option<PinnedRequirements>, StoreError> {
        self.ensure_pinned_requirements_schema()?;
        self.read_pinned_requirements_inner(project_id, work_id, proof_revision)
    }

    /// Reads the latest immutable requirement snapshot for a work item.
    ///
    /// A missing snapshot is a corruption/repair condition, not an empty
    /// requirement set.  This is the API shared closeout/status integration
    /// should use when it needs the current declaration set.
    pub fn current_pinned_requirements(
        &self,
        project_id: &str,
        work_id: &str,
    ) -> Result<PinnedRequirements, StoreError> {
        self.ensure_pinned_requirements_schema()?;
        let mut statement = self.store.prepare(
            "SELECT MAX(proof_revision)
             FROM boreal_pinned_requirement
             WHERE project_id = ?1 AND work_id = ?2",
        )?;
        statement.bind_text(1, project_id)?;
        statement.bind_text(2, work_id)?;
        if statement.step()? != SQLITE_ROW {
            return Err(StoreError::Corrupt(format!(
                "missing pinned requirement revision for {project_id}/{work_id}"
            )));
        }
        let revision = statement
            .column_optional_i64(0)?
            .filter(|value| *value > 0)
            .ok_or_else(|| {
                StoreError::Corrupt(format!(
                    "missing pinned requirement revision for {project_id}/{work_id}"
                ))
            })?;
        self.read_pinned_requirements_inner(project_id, work_id, revision)?
            .ok_or_else(|| {
                StoreError::Corrupt(format!(
                    "pinned requirement revision {revision} disappeared for {project_id}/{work_id}"
                ))
            })
    }

    /// Returns required declarations from the latest persisted snapshot.
    /// This deliberately has no “none means no gates” fallback.
    pub fn current_required_declarations(
        &self,
        project_id: &str,
        work_id: &str,
    ) -> Result<Vec<GateRequirementDeclaration>, StoreError> {
        let requirements = self.current_pinned_requirements(project_id, work_id)?;
        Ok(requirements.required_declarations().cloned().collect())
    }

    fn read_pinned_requirements_inner(
        &self,
        project_id: &str,
        work_id: &str,
        proof_revision: u64,
    ) -> Result<Option<PinnedRequirements>, StoreError> {
        let mut statement = self.store.prepare(
            "SELECT project_id, work_id, proof_revision, subject_kind, profile_id,
                    profile_version, profile_digest, provenance_json, declarations_json,
                    resolved_digest
             FROM boreal_pinned_requirement
             WHERE project_id = ?1 AND work_id = ?2 AND proof_revision = ?3",
        )?;
        statement.bind_text(1, project_id)?;
        statement.bind_text(2, work_id)?;
        statement.bind_i64(3, proof_revision)?;
        if statement.step()? != SQLITE_ROW {
            return Ok(None);
        }
        let requirements = PinnedRequirements::from_stored_row(
            statement.column_text(0)?,
            statement.column_text(1)?,
            statement.column_u64(2)?,
            statement.column_text(3)?,
            statement.column_text(4)?,
            statement.column_u64(5)?,
            statement.column_text(6)?,
            statement.column_text(7)?,
            statement.column_text(8)?,
            statement.column_text(9)?,
        )?;
        self.validate_persisted_profile(&requirements.profile)?;
        self.validate_pinned_requirement_children(&requirements)?;
        Ok(Some(requirements))
    }

    fn validate_persisted_profile(&self, identity: &ProfileIdentity) -> Result<(), StoreError> {
        let mut statement = self.store.prepare(
            "SELECT policy_digest, definition_json
             FROM acceptance_profile
             WHERE profile_id = ?1 AND version = ?2",
        )?;
        statement.bind_text(1, &identity.profile_id)?;
        statement.bind_i64(2, identity.version)?;
        if statement.step()? != SQLITE_ROW {
            return Err(StoreError::Corrupt(format!(
                "pinned requirements reference missing acceptance profile {}/{}",
                identity.profile_id, identity.version
            )));
        }
        let stored_digest = statement.column_text(0)?;
        let stored_definition = statement.column_text(1)?;
        let profile = ProfileVersion::new(
            identity.profile_id.clone(),
            identity.version,
            stored_digest,
            stored_definition,
            "persisted",
        )
        .map_err(|error| {
            StoreError::Corrupt(format!("acceptance profile is malformed: {error}"))
        })?;
        if profile.canonical_definition()? == "{}" {
            return Err(StoreError::Corrupt(format!(
                "acceptance profile {}/{} is quarantined: legacy definition is empty",
                identity.profile_id, identity.version
            )));
        }
        profile.validate_content_digest().map_err(|error| {
            StoreError::Corrupt(format!(
                "acceptance profile {}/{} content is not immutable: {error}",
                identity.profile_id, identity.version
            ))
        })?;
        if profile.policy_digest != identity.policy_digest {
            return Err(StoreError::Corrupt(format!(
                "pinned requirements profile digest drift for {}/{}: pinned {}, stored {}",
                identity.profile_id,
                identity.version,
                identity.policy_digest,
                profile.policy_digest
            )));
        }
        Ok(())
    }

    fn validate_pinned_requirement_children(
        &self,
        requirements: &PinnedRequirements,
    ) -> Result<(), StoreError> {
        let expected: BTreeMap<_, _> = requirements
            .declarations
            .iter()
            .map(|declaration| (declaration.requirement_id.clone(), declaration))
            .collect();
        let expected_provenance = canonical_value(&serde_json::json!({
            "profile_id": requirements.provenance.profile_id,
            "profile_version": requirements.provenance.profile_version,
            "profile_digest": requirements.provenance.profile_digest,
            "resolved_at": requirements.provenance.resolved_at,
            "source": requirements.provenance.source,
        }));
        let mut seen = BTreeSet::new();
        let mut statement = self.store.prepare(
            "SELECT requirement_id, gate_id, kind, required, subject_kind,
                    profile_id, profile_version, profile_digest, provenance_json,
                    declaration_json
             FROM boreal_pinned_requirement_gate
             WHERE project_id = ?1 AND work_id = ?2 AND proof_revision = ?3
             ORDER BY requirement_id",
        )?;
        statement.bind_text(1, &requirements.project_id)?;
        statement.bind_text(2, &requirements.work_id)?;
        statement.bind_i64(3, requirements.proof_revision)?;
        while statement.step()? == SQLITE_ROW {
            let requirement_id = statement.column_text(0)?;
            let expected_declaration = *expected.get(&requirement_id).ok_or_else(|| {
                StoreError::Corrupt(format!(
                    "pinned requirement child {requirement_id} is not in the immutable header"
                ))
            })?;
            let child_subject = statement.column_text(4)?;
            let child_profile_id = statement.column_text(5)?;
            let child_profile_version = statement.column_u64(6)?;
            let child_profile_digest = statement.column_text(7)?;
            let child_provenance = canonical_json(&statement.column_text(8)?).map_err(|error| {
                StoreError::Corrupt(format!(
                    "pinned requirement {requirement_id} provenance is malformed: {error}"
                ))
            })?;
            let child_declaration: Value = serde_json::from_str(&statement.column_text(9)?)
                .map_err(|_| {
                    StoreError::Corrupt(format!(
                        "pinned requirement {requirement_id} declaration is malformed"
                    ))
                })?;
            let child_declaration =
                GateRequirementDeclaration::from_persisted_value(&child_declaration, 0)?;
            if !seen.insert(requirement_id.clone())
                || child_declaration != *expected_declaration
                || statement.column_text(1)? != expected_declaration.gate_id
                || statement.column_text(2)? != expected_declaration.kind
                || (statement.column_i64(3)? == 1) != expected_declaration.required
                || child_subject != requirements.subject_kind.as_str()
                || child_profile_id != requirements.profile.profile_id
                || child_profile_version != requirements.profile.version
                || child_profile_digest != requirements.profile.policy_digest
                || child_provenance != expected_provenance
            {
                return Err(StoreError::Corrupt(format!(
                    "pinned requirement child {requirement_id} drifted from its immutable header"
                )));
            }
        }
        if seen.len() != expected.len() {
            let missing = expected
                .keys()
                .find(|requirement_id| !seen.contains(*requirement_id))
                .cloned()
                .unwrap_or_else(|| "unknown".to_owned());
            return Err(StoreError::Corrupt(format!(
                "pinned requirement child {missing} is missing from the immutable declaration set"
            )));
        }
        Ok(())
    }
}

fn required_string(
    object: &Map<String, Value>,
    key: &str,
    label: &str,
) -> Result<String, StoreError> {
    object
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_owned)
        .ok_or_else(|| StoreError::Invalid(format!("{label} is required")))
}

fn canonical_json(json: &str) -> Result<String, StoreError> {
    let value: Value = serde_json::from_str(json)
        .map_err(|_| StoreError::Invalid("JSON definition is not valid".to_owned()))?;
    Ok(canonical_value(&value))
}

fn canonical_value(value: &Value) -> String {
    match value {
        Value::Null => "null".to_owned(),
        Value::Bool(value) => value.to_string(),
        Value::Number(value) => value.to_string(),
        Value::String(value) => serde_json::to_string(value).expect("JSON string is serializable"),
        Value::Array(values) => format!(
            "[{}]",
            values
                .iter()
                .map(canonical_value)
                .collect::<Vec<_>>()
                .join(",")
        ),
        Value::Object(values) => {
            let mut entries: Vec<_> = values.iter().collect();
            entries.sort_by(|left, right| left.0.cmp(right.0));
            format!(
                "{{{}}}",
                entries
                    .into_iter()
                    .map(|(key, value)| format!(
                        "{}:{}",
                        serde_json::to_string(key).expect("JSON key is serializable"),
                        canonical_value(value)
                    ))
                    .collect::<Vec<_>>()
                    .join(",")
            )
        }
    }
}
