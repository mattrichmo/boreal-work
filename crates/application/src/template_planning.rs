//! Versioned work-template validation, rendering, and safe instantiation.
//!
//! Templates describe work inputs only. Every created item still passes
//! through the normal WorkApplication transaction and revision checks.
use boreal_domain::{
    validate_deliverable_requirements, validate_input_artifact_ref, ArtifactProductionIdentity,
    AttemptId, DeliverableCriterion, DeliverableRequirement, DeliverableType, DispatchPolicy,
    InputArtifactRef, InputArtifactRole, InputArtifactScope, ProjectId, SourceVersionId, WorkId,
    WorkItem, WorkKind,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

pub const WORK_TEMPLATE_SCHEMA_VERSION: u32 = 2;
pub const MIN_SUPPORTED_TEMPLATE_SCHEMA_VERSION: u32 = 1;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct WorkTemplate {
    pub schema_version: u32,
    pub id: String,
    pub version: u32,
    pub title: String,
    pub description: String,
    pub parameters: Vec<TemplateParameter>,
    pub items: Vec<TemplateWorkItem>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct TemplateParameter {
    pub name: String,
    pub description: String,
    pub required: bool,
    pub default: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct TemplateWorkItem {
    pub key: String,
    pub kind: String,
    pub parent: Option<String>,
    pub title: String,
    pub description: String,
    pub priority: u8,
    pub dispatch: String,
    /// Keys of prerequisite items. Edges are close-only.
    #[serde(default)]
    pub dependencies: Vec<String>,
    #[serde(default)]
    pub labels: Vec<String>,
    /// `focused` (default) or `reviewed` acceptance requirements.
    #[serde(default = "default_acceptance_profile")]
    pub acceptance_profile: String,
    /// Optional output declarations. Missing values in schema-1 templates
    /// remain empty, preserving the previous behavior.
    #[serde(default)]
    pub deliverables: Vec<TemplateDeliverableRequirement>,
    /// Exact immutable source-version references used as context or input.
    #[serde(default)]
    pub inputs: Vec<TemplateInputArtifactRef>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TemplateDeliverableRequirement {
    pub key: String,
    pub purpose: String,
    pub required: bool,
    pub deliverable_type: TemplateDeliverableType,
    #[serde(default)]
    pub allowed_media_types: Vec<String>,
    pub min_count: u32,
    pub max_count: u32,
    #[serde(default)]
    pub criteria: Vec<TemplateDeliverableCriterion>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TemplateDeliverableType {
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
pub enum TemplateDeliverableCriterion {
    MinBytes { value: u64 },
    MaxBytes { value: u64 },
    JsonDocument,
    TextContains { text: String },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TemplateInputArtifactRef {
    pub project_id: String,
    pub source_version_id: String,
    pub content_digest: String,
    pub role: TemplateInputArtifactRole,
    pub scope: TemplateInputArtifactScope,
    #[serde(default)]
    pub produced_by: Option<TemplateArtifactProductionIdentity>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TemplateInputArtifactRole {
    Context,
    AcceptedInput,
    Reference,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TemplateInputArtifactScope {
    Project,
    Private,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TemplateArtifactProductionIdentity {
    pub work_id: String,
    pub attempt_id: String,
    pub result_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TemplatePlan {
    pub template_id: String,
    pub template_version: u32,
    pub rendered: Vec<RenderedTemplateItem>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RenderedTemplateItem {
    pub key: String,
    pub kind: WorkKind,
    pub parent: Option<String>,
    pub title: String,
    pub description: String,
    pub priority: u8,
    pub dispatch: DispatchPolicy,
    pub dependencies: Vec<String>,
    pub labels: Vec<String>,
    pub acceptance_profile: String,
    pub deliverables: Vec<DeliverableRequirement>,
    pub inputs: Vec<InputArtifactRef>,
}

fn default_acceptance_profile() -> String {
    "focused".to_owned()
}

impl TemplateDeliverableRequirement {
    fn to_domain(&self) -> Result<DeliverableRequirement, TemplateError> {
        let deliverable_type = match self.deliverable_type {
            TemplateDeliverableType::Code => DeliverableType::Code,
            TemplateDeliverableType::Document => DeliverableType::Document,
            TemplateDeliverableType::Image => DeliverableType::Image,
            TemplateDeliverableType::Dataset => DeliverableType::Dataset,
            TemplateDeliverableType::Report => DeliverableType::Report,
            TemplateDeliverableType::Archive => DeliverableType::Archive,
            TemplateDeliverableType::Other => DeliverableType::Other,
        };
        let criteria = self
            .criteria
            .iter()
            .map(|criterion| match criterion {
                TemplateDeliverableCriterion::MinBytes { value } => {
                    DeliverableCriterion::MinBytes(*value)
                }
                TemplateDeliverableCriterion::MaxBytes { value } => {
                    DeliverableCriterion::MaxBytes(*value)
                }
                TemplateDeliverableCriterion::JsonDocument => DeliverableCriterion::JsonDocument,
                TemplateDeliverableCriterion::TextContains { text } => {
                    DeliverableCriterion::TextContains(text.clone())
                }
            })
            .collect();
        Ok(DeliverableRequirement {
            key: self.key.clone(),
            purpose: self.purpose.clone(),
            required: self.required,
            deliverable_type,
            allowed_media_types: self.allowed_media_types.clone(),
            min_count: self.min_count,
            max_count: self.max_count,
            criteria,
        })
    }
}

impl TemplateInputArtifactRef {
    fn to_domain(&self) -> Result<InputArtifactRef, TemplateError> {
        let project_id = ProjectId::parse(self.project_id.clone())
            .map_err(|error| TemplateError::Invalid(error.to_string()))?;
        let source_version_id = SourceVersionId::parse(self.source_version_id.clone())
            .map_err(|error| TemplateError::Invalid(error.to_string()))?;
        let role = match self.role {
            TemplateInputArtifactRole::Context => InputArtifactRole::Context,
            TemplateInputArtifactRole::AcceptedInput => InputArtifactRole::AcceptedInput,
            TemplateInputArtifactRole::Reference => InputArtifactRole::Reference,
        };
        let scope = match self.scope {
            TemplateInputArtifactScope::Project => InputArtifactScope::Project,
            TemplateInputArtifactScope::Private => InputArtifactScope::Private,
        };
        let produced_by = self
            .produced_by
            .as_ref()
            .map(|identity| {
                Ok(ArtifactProductionIdentity {
                    work_id: WorkId::parse(identity.work_id.clone())
                        .map_err(|error| TemplateError::Invalid(error.to_string()))?,
                    attempt_id: AttemptId::parse(identity.attempt_id.clone())
                        .map_err(|error| TemplateError::Invalid(error.to_string()))?,
                    result_id: identity.result_id.clone(),
                })
            })
            .transpose()?;
        Ok(InputArtifactRef {
            project_id,
            source_version_id,
            content_digest: self.content_digest.clone(),
            role,
            scope,
            produced_by,
        })
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TemplateError {
    Invalid(String),
    MissingParameter(String),
    UnknownParameter(String),
    Application(String),
}

impl std::fmt::Display for TemplateError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Invalid(message) | Self::Application(message) => f.write_str(message),
            Self::MissingParameter(name) => {
                write!(f, "required template parameter '{name}' is missing")
            }
            Self::UnknownParameter(name) => write!(f, "unknown template parameter '{name}'"),
        }
    }
}
impl std::error::Error for TemplateError {}

impl WorkTemplate {
    pub fn validate(&self) -> Result<(), TemplateError> {
        if !(MIN_SUPPORTED_TEMPLATE_SCHEMA_VERSION..=WORK_TEMPLATE_SCHEMA_VERSION)
            .contains(&self.schema_version)
        {
            return Err(TemplateError::Invalid(format!(
                "unsupported template schema version {}; supported versions are {}..={}",
                self.schema_version,
                MIN_SUPPORTED_TEMPLATE_SCHEMA_VERSION,
                WORK_TEMPLATE_SCHEMA_VERSION
            )));
        }
        if self.id.trim().is_empty()
            || self.version == 0
            || self.title.trim().is_empty()
            || self.items.is_empty()
        {
            return Err(TemplateError::Invalid(
                "template requires an id, positive version, title, and at least one item".into(),
            ));
        }
        let mut params = BTreeSet::new();
        for parameter in &self.parameters {
            if !valid_identifier(&parameter.name) || !params.insert(parameter.name.as_str()) {
                return Err(TemplateError::Invalid(format!(
                    "invalid or duplicate parameter '{}'; use unique lowercase identifiers",
                    parameter.name
                )));
            }
        }
        let mut keys = BTreeSet::new();
        for item in &self.items {
            if !valid_identifier(&item.key) || !keys.insert(item.key.as_str()) {
                return Err(TemplateError::Invalid(format!(
                    "invalid or duplicate item key '{}'",
                    item.key
                )));
            }
            parse_kind(&item.kind)?;
            parse_dispatch(&item.dispatch)?;
            if item.priority > 9 {
                return Err(TemplateError::Invalid(format!(
                    "priority for '{}' must be between 0 and 9",
                    item.key
                )));
            }
            if !matches!(item.acceptance_profile.as_str(), "focused" | "reviewed") {
                return Err(TemplateError::Invalid(format!(
                    "unsupported acceptance profile '{}' for '{}'",
                    item.acceptance_profile, item.key
                )));
            }
            if self.schema_version == 1
                && (!item.deliverables.is_empty() || !item.inputs.is_empty())
            {
                return Err(TemplateError::Invalid(format!(
                    "template schema 1 item '{}' cannot declare deliverables or input references; use schema 2",
                    item.key
                )));
            }
            let deliverables = item
                .deliverables
                .iter()
                .map(TemplateDeliverableRequirement::to_domain)
                .collect::<Result<Vec<_>, _>>()?;
            validate_deliverable_requirements(&deliverables).map_err(|error| {
                TemplateError::Invalid(format!("invalid deliverables for '{}': {error}", item.key))
            })?;
            let input_refs = item
                .inputs
                .iter()
                .map(TemplateInputArtifactRef::to_domain)
                .collect::<Result<Vec<_>, _>>()?;
            for input in &input_refs {
                validate_input_artifact_ref(input, &input.project_id).map_err(|error| {
                    TemplateError::Invalid(format!("invalid input for '{}': {error}", item.key))
                })?;
            }
            let mut labels = BTreeSet::new();
            if item.labels.len() > 64
                || item.labels.iter().any(|label| {
                    let label = label.trim().to_ascii_lowercase();
                    label.is_empty()
                        || label.len() > 64
                        || !label.bytes().all(|b| {
                            b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'/')
                        })
                        || !labels.insert(label)
                })
            {
                return Err(TemplateError::Invalid(format!(
                    "labels for '{}' must be unique normalized tokens of 1..64 ASCII letters, digits, -, _, . or /",
                    item.key
                )));
            }
            let mut dependencies = BTreeSet::new();
            if item.dependencies.len() > 100
                || item
                    .dependencies
                    .iter()
                    .any(|key| key == &item.key || !dependencies.insert(key.as_str()))
            {
                return Err(TemplateError::Invalid(format!(
                    "dependencies for '{}' must be unique non-self item keys",
                    item.key
                )));
            }
        }
        for item in &self.items {
            if let Some(parent) = &item.parent {
                if !keys.contains(parent.as_str()) || parent == &item.key {
                    return Err(TemplateError::Invalid(format!(
                        "item '{}' references an unknown or self parent '{parent}'",
                        item.key
                    )));
                }
            }
            for dependency in &item.dependencies {
                if !keys.contains(dependency.as_str()) {
                    return Err(TemplateError::Invalid(format!(
                        "item '{}' references unknown prerequisite '{dependency}'",
                        item.key
                    )));
                }
            }
            if parse_kind(&item.kind)? == WorkKind::Sprint && item.parent.is_none() {
                return Err(TemplateError::Invalid(format!(
                    "sprint '{}' must have a parent item",
                    item.key
                )));
            }
        }
        detect_template_cycles(&self.items)?;
        detect_dependency_cycles(&self.items)?;
        validate_placeholders(self, &params)?;
        Ok(())
    }

    pub fn plan(&self, supplied: &BTreeMap<String, String>) -> Result<TemplatePlan, TemplateError> {
        self.validate()?;
        let declarations: BTreeMap<&str, &TemplateParameter> = self
            .parameters
            .iter()
            .map(|p| (p.name.as_str(), p))
            .collect();
        for key in supplied.keys() {
            if !declarations.contains_key(key.as_str()) {
                return Err(TemplateError::UnknownParameter(key.clone()));
            }
        }
        let mut values = BTreeMap::new();
        for parameter in &self.parameters {
            let value = supplied.get(&parameter.name).or(parameter.default.as_ref());
            match value {
                Some(value) if !value.trim().is_empty() => {
                    values.insert(parameter.name.as_str(), value.as_str());
                }
                _ if parameter.required => {
                    return Err(TemplateError::MissingParameter(parameter.name.clone()));
                }
                _ => {}
            }
        }
        let rendered = self
            .items
            .iter()
            .map(|item| {
                Ok(RenderedTemplateItem {
                    key: item.key.clone(),
                    kind: parse_kind(&item.kind)?,
                    parent: item.parent.clone(),
                    title: substitute(&item.title, &values)?,
                    description: substitute(&item.description, &values)?,
                    priority: item.priority,
                    dispatch: parse_dispatch(&item.dispatch)?,
                    dependencies: item.dependencies.clone(),
                    labels: item
                        .labels
                        .iter()
                        .map(|label| label.trim().to_ascii_lowercase())
                        .collect(),
                    acceptance_profile: item.acceptance_profile.clone(),
                    deliverables: item
                        .deliverables
                        .iter()
                        .map(TemplateDeliverableRequirement::to_domain)
                        .collect::<Result<Vec<_>, _>>()?,
                    inputs: item
                        .inputs
                        .iter()
                        .map(TemplateInputArtifactRef::to_domain)
                        .collect::<Result<Vec<_>, _>>()?,
                })
            })
            .collect::<Result<Vec<_>, TemplateError>>()?;
        Ok(TemplatePlan {
            template_id: self.id.clone(),
            template_version: self.version,
            rendered,
        })
    }
}

/// Instantiates a prevalidated dry-run plan using one canonical batch
/// transaction, preserving all-or-nothing work, dependency, and label writes.
#[expect(
    clippy::too_many_arguments,
    reason = "preserves the existing public dry-run-to-instantiate API used by the CLI"
)]
pub fn instantiate_template(
    app: &crate::WorkApplication<'_>,
    project_id: &ProjectId,
    plan: &TemplatePlan,
    actor_id: &str,
    session_id: &str,
    expected_revision: u64,
    id_prefix: &str,
    now: &str,
    operation_id: &str,
) -> Result<boreal_store::WorkBatchCreateResult, TemplateError> {
    validate_rendered_plan(plan, project_id)?;
    if actor_id.trim().is_empty()
        || session_id.trim().is_empty()
        || !valid_identifier(id_prefix)
        || operation_id.trim().is_empty()
    {
        return Err(TemplateError::Invalid(
            "actor, session, operation id, and a lowercase id prefix are required".into(),
        ));
    }
    let ordered = order_items(&plan.rendered)?;
    let mut ids = BTreeMap::<String, WorkId>::new();
    let mut works = Vec::with_capacity(ordered.len());
    for item in ordered {
        let id = WorkId::new(format!("{id_prefix}-{}", item.key));
        let parent_id = item
            .parent
            .as_ref()
            .map(|key| {
                ids.get(key).cloned().ok_or_else(|| {
                    TemplateError::Invalid(format!("parent '{key}' has not been created"))
                })
            })
            .transpose()?;
        let mut work = WorkItem::new(
            project_id.clone(),
            id.clone(),
            item.kind,
            parent_id,
            item.title,
        );
        work.description = item.description;
        work.priority = item.priority;
        work.dispatch_policy = item.dispatch;
        work.acceptance_profile = match item.acceptance_profile.as_str() {
            "focused" => boreal_domain::AcceptanceProfile::focused(),
            "reviewed" => boreal_domain::AcceptanceProfile::reviewed(),
            other => {
                return Err(TemplateError::Invalid(format!(
                    "unsupported acceptance profile '{other}'"
                )));
            }
        };
        ids.insert(item.key, id);
        works.push(work);
    }
    let dependencies = ordered_dependencies(&plan.rendered, &ids)?;
    let labels = plan
        .rendered
        .iter()
        .filter(|item| !item.labels.is_empty())
        .map(|item| {
            let id = ids
                .get(&item.key)
                .expect("work ID was assigned")
                .as_str()
                .to_owned();
            (id, item.labels.clone())
        })
        .collect::<BTreeMap<_, _>>();
    let request_digest = crate::canonical_request_digest(
        "template.instantiate/v1",
        json!({
            "project_id": project_id.as_str(), "actor_id": actor_id, "session_id": session_id,
            "expected_revision": expected_revision, "template_id": plan.template_id,
            "template_version": plan.template_version, "id_prefix": id_prefix,
            "works": works.iter().map(|work| json!({"work_id": work.id.as_str(), "kind": format!("{:?}", work.kind), "parent": work.parent_id.as_ref().map(|id| id.as_str()), "title": work.title, "description": work.description, "priority": work.priority, "dispatch": format!("{:?}", work.dispatch_policy),"acceptance_profile":work.acceptance_profile.id.as_str()})).collect::<Vec<_>>(),
            "dependencies":dependencies,"labels":labels,
            "planning_contracts": plan.rendered.iter().map(|item|json!({"key":item.key,"deliverables":item.deliverables.iter().map(deliverable_json).collect::<Vec<_>>(),"inputs":item.inputs.iter().map(input_reference_json).collect::<Vec<_>>()})).collect::<Vec<_>>()
        }),
    );
    let planning_contracts = plan
        .rendered
        .iter()
        .map(|item| {
            let work_id = ids
                .get(&item.key)
                .expect("work ID was assigned")
                .as_str()
                .to_owned();
            Ok(boreal_store::WorkPlanningContractWrite {
                work_id,
                requirements_json: serde_json::to_string(
                    &item
                        .deliverables
                        .iter()
                        .map(deliverable_json)
                        .collect::<Vec<_>>(),
                )
                .map_err(|error| TemplateError::Invalid(error.to_string()))?,
                inputs_json: serde_json::to_string(
                    &item
                        .inputs
                        .iter()
                        .map(input_reference_json)
                        .collect::<Vec<_>>(),
                )
                .map_err(|error| TemplateError::Invalid(error.to_string()))?,
            })
        })
        .collect::<Result<Vec<_>, TemplateError>>()?;
    app.store_ref()
        .create_work_batch(&boreal_store::WorkBatchCreateRequest {
            project_id: project_id.as_str().to_owned(),
            actor_id: actor_id.to_owned(),
            session_id: session_id.to_owned(),
            expected_project_revision: expected_revision,
            operation_id: operation_id.to_owned(),
            request_digest,
            template_id: plan.template_id.clone(),
            template_version: u64::from(plan.template_version),
            id_prefix: id_prefix.to_owned(),
            works,
            planning_contracts,
            dependencies,
            labels,
            created_at: now.to_owned(),
        })
        .map_err(|e| TemplateError::Application(e.to_string()))
}

/// Revision-bound amendment of a previously ledgered template prefix. The
/// whole desired template is submitted so the store can prove that no item
/// key disappeared and compare every extant draft against its ledger snapshot.
#[expect(
    clippy::too_many_arguments,
    reason = "matches the revision-checked template adapter inputs"
)]
pub fn amend_template_prefix(
    app: &crate::WorkApplication<'_>,
    project_id: &ProjectId,
    plan: &TemplatePlan,
    actor_id: &str,
    session_id: &str,
    expected_revision: u64,
    expected_template_version: u64,
    id_prefix: &str,
    now: &str,
    operation_id: &str,
) -> Result<boreal_store::TemplatePrefixAmendResult, TemplateError> {
    validate_rendered_plan(plan, project_id)?;
    if actor_id.trim().is_empty()
        || session_id.trim().is_empty()
        || operation_id.trim().is_empty()
        || !valid_identifier(id_prefix)
        || u64::from(plan.template_version) <= expected_template_version
    {
        return Err(TemplateError::Invalid(
            "amendment requires actor, session, operation id, prefix, and a newer template version"
                .into(),
        ));
    }
    let ordered = order_items(&plan.rendered)?;
    let mut ids = BTreeMap::<String, WorkId>::new();
    let mut works = Vec::with_capacity(ordered.len());
    for item in ordered {
        let id = WorkId::new(format!("{id_prefix}-{}", item.key));
        let parent_id = item
            .parent
            .as_ref()
            .map(|key| {
                ids.get(key).cloned().ok_or_else(|| {
                    TemplateError::Invalid(format!("parent '{key}' has not been ordered"))
                })
            })
            .transpose()?;
        let mut work = WorkItem::new(
            project_id.clone(),
            id.clone(),
            item.kind,
            parent_id,
            item.title,
        );
        work.description = item.description;
        work.priority = item.priority;
        work.dispatch_policy = item.dispatch;
        work.acceptance_profile = match item.acceptance_profile.as_str() {
            "focused" => boreal_domain::AcceptanceProfile::focused(),
            "reviewed" => boreal_domain::AcceptanceProfile::reviewed(),
            other => {
                return Err(TemplateError::Invalid(format!(
                    "unsupported acceptance profile '{other}'"
                )));
            }
        };
        ids.insert(item.key, id);
        works.push(work);
    }
    let dependencies = ordered_dependencies(&plan.rendered, &ids)?;
    let labels = plan
        .rendered
        .iter()
        .filter(|item| !item.labels.is_empty())
        .map(|item| {
            let id = ids.get(&item.key).expect("work ID was assigned");
            (id.as_str().to_owned(), item.labels.clone())
        })
        .collect::<BTreeMap<_, _>>();
    let planning_contracts = plan
        .rendered
        .iter()
        .map(|item| {
            let work_id = ids.get(&item.key).expect("work ID was assigned");
            Ok(boreal_store::WorkPlanningContractWrite {
                work_id: work_id.as_str().to_owned(),
                requirements_json: serde_json::to_string(
                    &item
                        .deliverables
                        .iter()
                        .map(deliverable_json)
                        .collect::<Vec<_>>(),
                )
                .map_err(|error| TemplateError::Invalid(error.to_string()))?,
                inputs_json: serde_json::to_string(
                    &item
                        .inputs
                        .iter()
                        .map(input_reference_json)
                        .collect::<Vec<_>>(),
                )
                .map_err(|error| TemplateError::Invalid(error.to_string()))?,
            })
        })
        .collect::<Result<Vec<_>, TemplateError>>()?;
    let request_digest = crate::canonical_request_digest(
        "template.prefix.amend/v1",
        json!({
            "project_id": project_id.as_str(),
            "actor_id": actor_id,
            "session_id": session_id,
            "expected_revision": expected_revision,
            "expected_template_version": expected_template_version,
            "template_id": plan.template_id,
            "template_version": plan.template_version,
            "id_prefix": id_prefix,
            "works": works.iter().map(|work| json!({
                "work_id": work.id.as_str(),
                "kind": format!("{:?}", work.kind),
                "parent": work.parent_id.as_ref().map(|parent| parent.as_str()),
                "title": work.title,
                "description": work.description,
                "priority": work.priority,
                "dispatch": format!("{:?}", work.dispatch_policy),
                "acceptance_profile": work.acceptance_profile.id.as_str(),
            })).collect::<Vec<_>>(),
            "dependencies": dependencies,
            "labels": labels,
            "planning_contracts": plan.rendered.iter().map(|item| json!({
                "key": item.key,
                "deliverables": item.deliverables.iter().map(deliverable_json).collect::<Vec<_>>(),
                "inputs": item.inputs.iter().map(input_reference_json).collect::<Vec<_>>(),
            })).collect::<Vec<_>>(),
        }),
    );
    app.store_ref()
        .amend_template_prefix(&boreal_store::TemplatePrefixAmendRequest {
            project_id: project_id.as_str().to_owned(),
            actor_id: actor_id.to_owned(),
            session_id: session_id.to_owned(),
            expected_project_revision: expected_revision,
            expected_template_version,
            operation_id: operation_id.to_owned(),
            request_digest,
            template_id: plan.template_id.clone(),
            template_version: u64::from(plan.template_version),
            id_prefix: id_prefix.to_owned(),
            works,
            planning_contracts,
            dependencies,
            labels,
            created_at: now.to_owned(),
        })
        .map_err(|error| TemplateError::Application(error.to_string()))
}

fn validate_rendered_plan(
    plan: &TemplatePlan,
    project_id: &ProjectId,
) -> Result<(), TemplateError> {
    if plan.template_id.trim().is_empty()
        || plan.template_version == 0
        || plan.rendered.is_empty()
        || plan.rendered.len() > 100
    {
        return Err(TemplateError::Invalid(
            "rendered template plan requires an id, positive version, and 1-100 items".into(),
        ));
    }
    let mut keys = BTreeSet::new();
    let mut template_items = Vec::with_capacity(plan.rendered.len());
    for item in &plan.rendered {
        if !valid_identifier(&item.key)
            || !keys.insert(item.key.as_str())
            || item.title.trim().is_empty()
            || item.title.contains('\0')
            || item.description.trim().is_empty()
            || item.description.contains('\0')
            || item.priority > 9
            || !matches!(item.acceptance_profile.as_str(), "focused" | "reviewed")
        {
            return Err(TemplateError::Invalid(format!(
                "rendered item '{}' has invalid identity or planning fields",
                item.key
            )));
        }
        validate_deliverable_requirements(&item.deliverables).map_err(|error| {
            TemplateError::Invalid(format!("invalid deliverables for '{}': {error}", item.key))
        })?;
        for input in &item.inputs {
            validate_input_artifact_ref(input, project_id).map_err(|error| {
                TemplateError::Invalid(format!("invalid input for '{}': {error}", item.key))
            })?;
        }
        if item.labels.len() > 64 {
            return Err(TemplateError::Invalid(format!(
                "labels for '{}' exceed the 64-label bound",
                item.key
            )));
        }
        let mut labels = BTreeSet::new();
        if item.labels.iter().any(|label| {
            label.is_empty()
                || label.len() > 64
                || !label.bytes().all(|byte| {
                    byte.is_ascii_lowercase()
                        || byte.is_ascii_digit()
                        || matches!(byte, b'-' | b'_' | b'.' | b'/')
                })
                || !labels.insert(label.as_str())
        }) {
            return Err(TemplateError::Invalid(format!(
                "labels for '{}' must be unique normalized tokens",
                item.key
            )));
        }
        if item.dependencies.len() > 100 {
            return Err(TemplateError::Invalid(format!(
                "dependencies for '{}' exceed the 100-edge bound",
                item.key
            )));
        }
        let kind = match item.kind {
            WorkKind::Milestone => "milestone",
            WorkKind::Sprint => "sprint",
            WorkKind::Task => "task",
        };
        let dispatch = match item.dispatch {
            DispatchPolicy::Automatic => "automatic",
            DispatchPolicy::OperatorOnly => "operator_only",
            DispatchPolicy::Paused => "paused",
        };
        template_items.push(TemplateWorkItem {
            key: item.key.clone(),
            kind: kind.into(),
            parent: item.parent.clone(),
            title: item.title.clone(),
            description: item.description.clone(),
            priority: item.priority,
            dispatch: dispatch.into(),
            dependencies: item.dependencies.clone(),
            labels: item.labels.clone(),
            acceptance_profile: item.acceptance_profile.clone(),
            deliverables: Vec::new(),
            inputs: Vec::new(),
        });
    }
    for item in &plan.rendered {
        if item
            .parent
            .as_ref()
            .is_some_and(|parent| !keys.contains(parent.as_str()))
            || item
                .dependencies
                .iter()
                .any(|dependency| dependency == &item.key || !keys.contains(dependency.as_str()))
            || (item.kind == WorkKind::Sprint && item.parent.is_none())
        {
            return Err(TemplateError::Invalid(format!(
                "rendered item '{}' references an invalid parent or dependency",
                item.key
            )));
        }
        let mut dependencies = BTreeSet::new();
        if item
            .dependencies
            .iter()
            .any(|dependency| !dependencies.insert(dependency.as_str()))
        {
            return Err(TemplateError::Invalid(format!(
                "dependencies for '{}' must be unique",
                item.key
            )));
        }
    }
    detect_template_cycles(&template_items)?;
    detect_dependency_cycles(&template_items)?;
    Ok(())
}

fn deliverable_json(requirement: &DeliverableRequirement) -> Value {
    let criteria = requirement
        .criteria
        .iter()
        .map(|criterion| match criterion {
            DeliverableCriterion::MinBytes(value) => json!({"kind":"min_bytes","value":value}),
            DeliverableCriterion::MaxBytes(value) => json!({"kind":"max_bytes","value":value}),
            DeliverableCriterion::JsonDocument => json!({"kind":"json_document"}),
            DeliverableCriterion::TextContains(text) => {
                json!({"kind":"text_contains","text":text})
            }
        })
        .collect::<Vec<_>>();
    json!({
        "key": requirement.key,
        "purpose": requirement.purpose,
        "required": requirement.required,
        "deliverable_type": requirement.deliverable_type.as_str(),
        "allowed_media_types": requirement.allowed_media_types,
        "min_count": requirement.min_count,
        "max_count": requirement.max_count,
        "criteria": criteria,
    })
}

fn input_reference_json(input: &InputArtifactRef) -> Value {
    json!({
        "project_id": input.project_id.as_str(),
        "source_version_id": input.source_version_id.as_str(),
        "content_digest": input.content_digest,
        "role": input.role.as_str(),
        "scope": input.scope.as_str(),
        "produced_by": input.produced_by.as_ref().map(|producer|json!({
            "work_id":producer.work_id.as_str(),
            "attempt_id":producer.attempt_id.as_str(),
            "result_id":producer.result_id,
        })),
    })
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 48
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
}
fn parse_kind(value: &str) -> Result<WorkKind, TemplateError> {
    match value {
        "milestone" => Ok(WorkKind::Milestone),
        "sprint" => Ok(WorkKind::Sprint),
        "task" => Ok(WorkKind::Task),
        _ => Err(TemplateError::Invalid(format!(
            "unsupported work kind '{value}'"
        ))),
    }
}
fn parse_dispatch(value: &str) -> Result<DispatchPolicy, TemplateError> {
    match value {
        "automatic" => Ok(DispatchPolicy::Automatic),
        "operator_only" => Ok(DispatchPolicy::OperatorOnly),
        "paused" => Ok(DispatchPolicy::Paused),
        _ => Err(TemplateError::Invalid(format!(
            "unsupported dispatch policy '{value}'"
        ))),
    }
}
fn validate_placeholders(
    template: &WorkTemplate,
    params: &BTreeSet<&str>,
) -> Result<(), TemplateError> {
    for text in std::iter::once(&template.title)
        .chain(std::iter::once(&template.description))
        .chain(
            template
                .items
                .iter()
                .flat_map(|i| [&i.title, &i.description]),
        )
    {
        let mut rest = text.as_str();
        while let Some(start) = rest.find("{{") {
            rest = &rest[start + 2..];
            let end = rest.find("}}").ok_or_else(|| {
                TemplateError::Invalid("unterminated parameter placeholder".into())
            })?;
            let name = rest[..end].trim();
            if !params.contains(name) {
                return Err(TemplateError::Invalid(format!(
                    "placeholder '{name}' has no declared parameter"
                )));
            }
            rest = &rest[end + 2..];
        }
        if rest.contains("}}") {
            return Err(TemplateError::Invalid(
                "unmatched parameter closing braces".into(),
            ));
        }
    }
    Ok(())
}
fn substitute(text: &str, values: &BTreeMap<&str, &str>) -> Result<String, TemplateError> {
    let mut output = String::new();
    let mut rest = text;
    while let Some(start) = rest.find("{{") {
        output.push_str(&rest[..start]);
        rest = &rest[start + 2..];
        let end = rest
            .find("}}")
            .ok_or_else(|| TemplateError::Invalid("unterminated parameter placeholder".into()))?;
        let name = rest[..end].trim();
        let value = values
            .get(name)
            .ok_or_else(|| TemplateError::MissingParameter(name.to_owned()))?;
        output.push_str(value);
        rest = &rest[end + 2..];
    }
    output.push_str(rest);
    if output.trim().is_empty() {
        return Err(TemplateError::Invalid(
            "rendered work title/description must not be empty".into(),
        ));
    }
    Ok(output)
}
fn detect_template_cycles(items: &[TemplateWorkItem]) -> Result<(), TemplateError> {
    let mut done = BTreeSet::new();
    for item in items {
        let mut chain = BTreeSet::new();
        let mut current = Some(item.key.as_str());
        while let Some(key) = current {
            if !chain.insert(key) {
                return Err(TemplateError::Invalid(format!(
                    "template parent cycle includes '{key}'"
                )));
            }
            if done.contains(key) {
                break;
            }
            current = items
                .iter()
                .find(|candidate| candidate.key == key)
                .and_then(|candidate| candidate.parent.as_deref());
        }
        done.extend(chain);
    }
    Ok(())
}
fn detect_dependency_cycles(items: &[TemplateWorkItem]) -> Result<(), TemplateError> {
    let mut remaining = items
        .iter()
        .map(|item| (item.key.as_str(), item.dependencies.len()))
        .collect::<BTreeMap<_, _>>();
    let mut ready = remaining
        .iter()
        .filter(|(_, count)| **count == 0)
        .map(|(key, _)| *key)
        .collect::<Vec<_>>();
    let mut consumed = 0usize;
    while let Some(key) = ready.pop() {
        consumed += 1;
        for item in items
            .iter()
            .filter(|item| item.dependencies.iter().any(|dependency| dependency == key))
        {
            let count = remaining
                .get_mut(item.key.as_str())
                .expect("known template item");
            *count -= 1;
            if *count == 0 {
                ready.push(item.key.as_str());
            }
        }
    }
    if consumed == items.len() {
        Ok(())
    } else {
        let cycle = remaining
            .into_iter()
            .find(|(_, count)| *count > 0)
            .map(|(key, _)| key)
            .unwrap_or("unknown");
        Err(TemplateError::Invalid(format!(
            "template dependency cycle includes '{cycle}'"
        )))
    }
}
fn ordered_dependencies(
    items: &[RenderedTemplateItem],
    ids: &BTreeMap<String, WorkId>,
) -> Result<Vec<(String, String)>, TemplateError> {
    let mut edges = Vec::new();
    for item in items {
        let dependent = ids.get(&item.key).ok_or_else(|| {
            TemplateError::Invalid(format!("missing generated ID for '{}'", item.key))
        })?;
        for prerequisite in &item.dependencies {
            let prerequisite_id = ids.get(prerequisite).ok_or_else(|| {
                TemplateError::Invalid(format!("dependency '{prerequisite}' has no generated ID"))
            })?;
            edges.push((
                prerequisite_id.as_str().to_owned(),
                dependent.as_str().to_owned(),
            ));
        }
    }
    Ok(edges)
}
fn order_items(items: &[RenderedTemplateItem]) -> Result<Vec<RenderedTemplateItem>, TemplateError> {
    let mut pending = items.to_vec();
    let mut added = BTreeSet::new();
    let mut ordered = Vec::with_capacity(items.len());
    while !pending.is_empty() {
        let ready = pending.iter().position(|item| {
            item.parent
                .as_ref()
                .is_none_or(|parent| added.contains(parent))
        });
        let Some(index) = ready else {
            return Err(TemplateError::Invalid(
                "template parent graph cannot be ordered".into(),
            ));
        };
        let item = pending.remove(index);
        added.insert(item.key.clone());
        ordered.push(item);
    }
    Ok(ordered)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCHEMA: &str = include_str!("../../../project/spec/schema-v2.sql");

    fn item(key: &str, title: &str) -> TemplateWorkItem {
        TemplateWorkItem {
            key: key.into(),
            kind: "task".into(),
            parent: None,
            title: title.into(),
            description: "Task details".into(),
            priority: 1,
            dispatch: "automatic".into(),
            dependencies: Vec::new(),
            labels: Vec::new(),
            acceptance_profile: "focused".into(),
            deliverables: Vec::new(),
            inputs: Vec::new(),
        }
    }

    fn template(version: u32, items: Vec<TemplateWorkItem>) -> WorkTemplate {
        WorkTemplate {
            schema_version: WORK_TEMPLATE_SCHEMA_VERSION,
            id: "release-checklist".into(),
            version,
            title: "Release checklist".into(),
            description: "Template details".into(),
            parameters: Vec::new(),
            items,
        }
    }

    #[test]
    fn app_amends_a_revision_bound_prefix_and_rejects_removal_atomically() {
        let store = boreal_store::SqliteStore::open_in_memory(SCHEMA).unwrap();
        store
            .install_feature_schema("agent_tools", 1, boreal_store::AGENT_TOOLS_SCHEMA)
            .unwrap();
        let app = crate::WorkApplication::new(&store);
        let project = ProjectId::new("planning-test");
        app.init_project(
            &project,
            "planner",
            "operator",
            "planner-credential",
            "Planner",
            "unix-ms:1",
            "operation-init",
        )
        .unwrap();
        app.register_session_as(
            &project,
            "planner",
            "test-harness",
            "planner-session",
            "unix-ms:2",
            "operation-session",
        )
        .unwrap();
        let initial = template(1, vec![item("prepare", "Prepare")])
            .plan(&BTreeMap::new())
            .unwrap();
        let before_create = store.project_revision("planning-test").unwrap().0;
        let created = instantiate_template(
            &app,
            &project,
            &initial,
            "planner",
            "planner-session",
            before_create,
            "release",
            "unix-ms:2",
            "operation-create",
        )
        .unwrap();
        assert_eq!(created.revision, before_create + 1);

        let amended = template(
            2,
            vec![
                item("prepare", "Prepare the release"),
                item("verify", "Verify"),
            ],
        )
        .plan(&BTreeMap::new())
        .unwrap();
        let changed = amend_template_prefix(
            &app,
            &project,
            &amended,
            "planner",
            "planner-session",
            created.revision,
            1,
            "release",
            "unix-ms:3",
            "operation-amend",
        )
        .unwrap();
        assert_eq!(changed.revision, created.revision + 1);
        assert_eq!(changed.works.len(), 2);
        assert_eq!(
            store
                .work("planning-test", "release-prepare")
                .unwrap()
                .unwrap()
                .title,
            "Prepare the release"
        );
        let contract = app
            .work_planning_contract(&project, &WorkId::new("release-prepare"))
            .unwrap();
        assert_eq!(contract.revision, changed.revision);
        assert_eq!(contract.contract.unwrap().template_version, Some(2));

        let replay = amend_template_prefix(
            &app,
            &project,
            &amended,
            "planner",
            "planner-session",
            created.revision,
            1,
            "release",
            "unix-ms:30",
            "operation-amend",
        )
        .unwrap();
        assert!(replay.replayed);

        let colliding_plan = template(
            3,
            vec![
                item("prepare", "Prepare the release"),
                item("verify", "Verify"),
                item("collision", "Collision"),
            ],
        )
        .plan(&BTreeMap::new())
        .unwrap();
        let stale = amend_template_prefix(
            &app,
            &project,
            &colliding_plan,
            "planner",
            "planner-session",
            created.revision,
            2,
            "release",
            "unix-ms:31",
            "operation-stale",
        )
        .unwrap_err();
        assert!(stale.to_string().contains("revision"));
        assert_eq!(
            store.project_revision("planning-test").unwrap().0,
            changed.revision
        );

        let unrelated = WorkItem::new(
            project.clone(),
            WorkId::new("release-collision"),
            WorkKind::Task,
            None,
            "Unrelated work",
        );
        store.create_work(&unrelated, "unix-ms:32").unwrap();
        let collision = amend_template_prefix(
            &app,
            &project,
            &colliding_plan,
            "planner",
            "planner-session",
            changed.revision,
            2,
            "release",
            "unix-ms:33",
            "operation-collision",
        )
        .unwrap_err();
        assert!(collision.to_string().contains("already exists"));
        assert_eq!(
            store.project_revision("planning-test").unwrap().0,
            changed.revision
        );

        let removal = template(3, vec![item("prepare", "Prepare the release")])
            .plan(&BTreeMap::new())
            .unwrap();
        let error = amend_template_prefix(
            &app,
            &project,
            &removal,
            "planner",
            "planner-session",
            changed.revision,
            2,
            "release",
            "unix-ms:4",
            "operation-remove",
        )
        .unwrap_err();
        assert!(error.to_string().contains("cannot remove"));
        assert_eq!(
            store.project_revision("planning-test").unwrap().0,
            changed.revision
        );
        assert_eq!(
            store
                .work_template_prefix("planning-test", "release")
                .unwrap()
                .unwrap()
                .template_version,
            2
        );
    }

    #[test]
    fn schema_one_templates_without_planning_fields_still_plan_empty_contracts() {
        let template: WorkTemplate = serde_json::from_value(json!({
            "schema_version": 1,
            "id": "legacy-checklist",
            "version": 1,
            "title": "Legacy checklist",
            "description": "Legacy template",
            "parameters": [],
            "items": [{
                "key": "check",
                "kind": "task",
                "parent": null,
                "title": "Check",
                "description": "Perform the check",
                "priority": 1,
                "dispatch": "automatic"
            }]
        }))
        .unwrap();
        let plan = template.plan(&BTreeMap::new()).unwrap();
        assert!(plan.rendered[0].deliverables.is_empty());
        assert!(plan.rendered[0].inputs.is_empty());
    }
}
