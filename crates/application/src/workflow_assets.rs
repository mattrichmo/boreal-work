//! Embedded, versioned workflow assets.
//!
//! Workflow files are guidance and routing data.  This module validates their
//! package boundary once and exposes only the requested asset; lifecycle
//! decisions remain in the application/domain layer.

use serde_json::Value;
use std::fmt;

const PACKAGE: &str = include_str!("../../../project/spec/workflows/package.json");
const EMBEDDED_ASSETS: &[&str] = &[
    include_str!("../../../project/spec/workflows/route.json"),
    include_str!("../../../project/spec/workflows/context.json"),
    include_str!("../../../project/spec/workflows/plan.json"),
    include_str!("../../../project/spec/workflows/claim.json"),
    include_str!("../../../project/spec/workflows/finish.json"),
    include_str!("../../../project/spec/workflows/review.json"),
    include_str!("../../../project/spec/workflows/audit.json"),
    include_str!("../../../project/spec/workflows/handoff.json"),
    include_str!("../../../project/spec/workflows/health.json"),
    include_str!("../../../project/spec/workflows/memory.json"),
];

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkflowInput {
    pub name: String,
    pub input_type: String,
    pub source: String,
    pub validation: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkflowCriterion {
    pub id: String,
    pub criterion_type: String,
    pub required: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkflowAsset {
    pub reference: String,
    pub kind: String,
    pub title: String,
    pub allowed_commands: Vec<String>,
    pub typed_inputs: Vec<WorkflowInput>,
    pub finish_criteria: Vec<WorkflowCriterion>,
    pub next_refs: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkflowRegistry {
    schema_version: String,
    package_id: String,
    package_version: String,
    asset_identity: String,
    assets: Vec<WorkflowAsset>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum WorkflowAssetError {
    InvalidJson(String),
    MissingField(&'static str),
    InvalidField(String),
    DuplicateReference(String),
    UnknownReference(String),
}

impl fmt::Display for WorkflowAssetError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidJson(message) => {
                write!(formatter, "invalid workflow package JSON: {message}")
            }
            Self::MissingField(field) => write!(formatter, "workflow package is missing {field}"),
            Self::InvalidField(message) => formatter.write_str(message),
            Self::DuplicateReference(reference) => {
                write!(formatter, "duplicate workflow reference: {reference}")
            }
            Self::UnknownReference(reference) => {
                write!(formatter, "unknown workflow reference: {reference}")
            }
        }
    }
}

impl std::error::Error for WorkflowAssetError {}

impl WorkflowRegistry {
    pub fn embedded() -> Result<Self, WorkflowAssetError> {
        Self::from_package_and_assets(PACKAGE, EMBEDDED_ASSETS)
    }

    pub fn from_package_json(package_json: &str) -> Result<Self, WorkflowAssetError> {
        let value: Value = serde_json::from_str(package_json)
            .map_err(|error| WorkflowAssetError::InvalidJson(error.to_string()))?;
        Self::from_package_value(value, None)
    }

    fn from_package_and_assets(
        package_json: &str,
        asset_json: &[&str],
    ) -> Result<Self, WorkflowAssetError> {
        let package = serde_json::from_str(package_json)
            .map_err(|error| WorkflowAssetError::InvalidJson(error.to_string()))?;
        let assets = asset_json
            .iter()
            .map(|asset| {
                serde_json::from_str(asset)
                    .map_err(|error| WorkflowAssetError::InvalidJson(error.to_string()))
            })
            .collect::<Result<Vec<Value>, WorkflowAssetError>>()?;
        Self::from_package_value(package, Some(assets))
    }

    fn from_package_value(
        value: Value,
        embedded_assets: Option<Vec<Value>>,
    ) -> Result<Self, WorkflowAssetError> {
        let object = value.as_object().ok_or_else(|| {
            WorkflowAssetError::InvalidField("workflow package must be an object".to_owned())
        })?;
        let schema_version = require_string(object, "schema_version")?;
        let package_id = require_string(object, "package_id")?;
        let package_version = require_string(object, "package_version")?;
        let asset_identity = require_string(object, "asset_identity")?;
        if object.get("state_authority").and_then(Value::as_str) != Some("boreal.application.v2") {
            return Err(WorkflowAssetError::InvalidField(
                "workflow package state_authority must be boreal.application.v2".to_owned(),
            ));
        }
        let package_assets = object
            .get("assets")
            .and_then(Value::as_array)
            .ok_or(WorkflowAssetError::MissingField("assets"))?
            .to_owned();
        let assets = match embedded_assets {
            Some(values) => values
                .iter()
                .map(parse_asset)
                .collect::<Result<Vec<_>, _>>()?,
            None => package_assets
                .iter()
                .map(parse_asset)
                .collect::<Result<Vec<_>, _>>()?,
        };
        if assets.len() != package_assets.len() {
            return Err(WorkflowAssetError::InvalidField(
                "workflow package asset metadata does not match embedded assets".to_owned(),
            ));
        }
        for (metadata, asset) in package_assets.iter().zip(&assets) {
            let reference = metadata
                .get("ref")
                .and_then(Value::as_str)
                .ok_or(WorkflowAssetError::MissingField("ref"))?;
            let kind = metadata
                .get("kind")
                .and_then(Value::as_str)
                .ok_or(WorkflowAssetError::MissingField("kind"))?;
            if reference != asset.reference || kind != asset.kind {
                return Err(WorkflowAssetError::InvalidField(format!(
                    "workflow package identity does not match asset {reference}"
                )));
            }
        }
        let registry = Self {
            schema_version,
            package_id,
            package_version,
            asset_identity,
            assets,
        };
        registry.validate_references()?;
        Ok(registry)
    }

    pub fn package_id(&self) -> &str {
        &self.package_id
    }

    pub fn schema_version(&self) -> &str {
        &self.schema_version
    }

    pub fn package_version(&self) -> &str {
        &self.package_version
    }

    pub fn asset_identity(&self) -> &str {
        &self.asset_identity
    }

    pub fn assets(&self) -> &[WorkflowAsset] {
        &self.assets
    }

    pub fn get(&self, reference: &str) -> Result<&WorkflowAsset, WorkflowAssetError> {
        self.assets
            .iter()
            .find(|asset| asset.reference == reference)
            .ok_or_else(|| WorkflowAssetError::UnknownReference(reference.to_owned()))
    }

    fn validate_references(&self) -> Result<(), WorkflowAssetError> {
        for (index, asset) in self.assets.iter().enumerate() {
            if self
                .assets
                .iter()
                .take(index)
                .any(|other| other.reference == asset.reference)
            {
                return Err(WorkflowAssetError::DuplicateReference(
                    asset.reference.clone(),
                ));
            }
        }
        for asset in &self.assets {
            for reference in &asset.next_refs {
                if !self
                    .assets
                    .iter()
                    .any(|candidate| candidate.reference == *reference)
                {
                    return Err(WorkflowAssetError::UnknownReference(reference.clone()));
                }
            }
        }
        Ok(())
    }
}

fn parse_asset(value: &Value) -> Result<WorkflowAsset, WorkflowAssetError> {
    let object = value.as_object().ok_or_else(|| {
        WorkflowAssetError::InvalidField("workflow asset must be an object".to_owned())
    })?;
    let reference = require_string(object, "ref")?;
    let kind = require_string(object, "kind")?;
    let title = require_string(object, "title")?;
    let allowed_commands = string_array(object, "allowed_commands")?;
    if allowed_commands
        .iter()
        .any(|command| command.trim().is_empty())
    {
        return Err(WorkflowAssetError::InvalidField(format!(
            "workflow {reference} has an empty allowed command"
        )));
    }
    let typed_inputs = object
        .get("typed_inputs")
        .and_then(Value::as_array)
        .ok_or(WorkflowAssetError::MissingField("typed_inputs"))?
        .iter()
        .map(|input| {
            let input = input.as_object().ok_or_else(|| {
                WorkflowAssetError::InvalidField(format!(
                    "workflow {reference} input must be an object"
                ))
            })?;
            Ok(WorkflowInput {
                name: require_string(input, "name")?,
                input_type: require_string(input, "type")?,
                source: require_string(input, "source")?,
                validation: require_string(input, "validation")?,
            })
        })
        .collect::<Result<Vec<_>, WorkflowAssetError>>()?;
    let finish_criteria = object
        .get("finish_criteria")
        .and_then(Value::as_array)
        .ok_or(WorkflowAssetError::MissingField("finish_criteria"))?
        .iter()
        .map(|criterion| {
            let criterion = criterion.as_object().ok_or_else(|| {
                WorkflowAssetError::InvalidField(format!(
                    "workflow {reference} criterion must be an object"
                ))
            })?;
            let id = require_string(criterion, "id")?;
            let criterion_type = require_string(criterion, "type")?;
            let required = criterion
                .get("required")
                .and_then(Value::as_bool)
                .ok_or_else(|| {
                    WorkflowAssetError::InvalidField(format!(
                        "workflow {reference} criterion {id} must declare required"
                    ))
                })?;
            Ok(WorkflowCriterion {
                id,
                criterion_type,
                required,
            })
        })
        .collect::<Result<Vec<_>, WorkflowAssetError>>()?;
    let next_refs = string_array(object, "next_refs")?;
    Ok(WorkflowAsset {
        reference,
        kind,
        title,
        allowed_commands,
        typed_inputs,
        finish_criteria,
        next_refs,
    })
}

fn require_string(
    object: &serde_json::Map<String, Value>,
    name: &'static str,
) -> Result<String, WorkflowAssetError> {
    object
        .get(name)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(ToOwned::to_owned)
        .ok_or(WorkflowAssetError::MissingField(name))
}

fn string_array(
    object: &serde_json::Map<String, Value>,
    name: &'static str,
) -> Result<Vec<String>, WorkflowAssetError> {
    object
        .get(name)
        .and_then(Value::as_array)
        .ok_or(WorkflowAssetError::MissingField(name))?
        .iter()
        .map(|item| {
            item.as_str()
                .filter(|value| !value.trim().is_empty())
                .map(ToOwned::to_owned)
                .ok_or_else(|| {
                    WorkflowAssetError::InvalidField(format!("{name} must contain strings"))
                })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_package_is_versioned_and_resolves_all_assets() {
        let registry = WorkflowRegistry::embedded().unwrap();
        assert_eq!(registry.package_id(), "boreal.core-workflows");
        assert_eq!(registry.package_version(), "1.0.0");
        assert_eq!(registry.assets().len(), 10);
        let claim = registry.get("boreal.workflow.claim.v1").unwrap();
        assert!(claim
            .typed_inputs
            .iter()
            .any(|input| input.name == "time_limit"));
        assert!(!claim.finish_criteria.is_empty());
    }

    #[test]
    fn unknown_next_reference_fails_closed() {
        let package = r#"{
          "schema_version":"boreal.workflow_package.v1",
          "package_id":"test",
          "package_version":"1",
          "asset_identity":"sha256:test",
          "state_authority":"boreal.application.v2",
          "assets":[{
            "ref":"boreal.workflow.one.v1","kind":"test","title":"Test",
            "allowed_commands":["bwrk next --json"],"typed_inputs":[{"name":"x","type":"id","source":"request","validation":"bounded"}],
            "finish_criteria":[{"id":"done","type":"proof","required":true}],"next_refs":["boreal.workflow.missing.v1"]
          }]
        }"#;
        assert!(matches!(
            WorkflowRegistry::from_package_json(package),
            Err(WorkflowAssetError::UnknownReference(reference)) if reference == "boreal.workflow.missing.v1"
        ));
    }

    #[test]
    fn missing_required_criterion_field_is_rejected() {
        let package = r#"{
          "schema_version":"boreal.workflow_package.v1",
          "package_id":"test","package_version":"1","asset_identity":"sha256:test",
          "state_authority":"boreal.application.v2",
          "assets":[{"ref":"boreal.workflow.one.v1","kind":"test","title":"Test",
            "allowed_commands":["bwrk next --json"],"typed_inputs":[],
            "finish_criteria":[{"id":"done","type":"proof"}],"next_refs":[]}]
        }"#;
        assert!(WorkflowRegistry::from_package_json(package).is_err());
    }
}
