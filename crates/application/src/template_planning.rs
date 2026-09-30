//! Versioned work-template validation, rendering, and safe instantiation.
//!
//! Templates describe work inputs only. Every created item still passes
//! through the normal WorkApplication transaction and revision checks.
use boreal_domain::{DispatchPolicy, ProjectId, WorkId, WorkItem, WorkKind};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{BTreeMap, BTreeSet};

pub const WORK_TEMPLATE_SCHEMA_VERSION: u32 = 1;

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
}

fn default_acceptance_profile() -> String {
    "focused".to_owned()
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
        if self.schema_version != WORK_TEMPLATE_SCHEMA_VERSION {
            return Err(TemplateError::Invalid(format!(
                "unsupported template schema version {}; expected {}",
                self.schema_version, WORK_TEMPLATE_SCHEMA_VERSION
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
            "template_version": plan.template_version,
            "works": works.iter().map(|work| json!({"work_id": work.id.as_str(), "kind": format!("{:?}", work.kind), "parent": work.parent_id.as_ref().map(|id| id.as_str()), "title": work.title, "description": work.description, "priority": work.priority, "dispatch": format!("{:?}", work.dispatch_policy),"acceptance_profile":work.acceptance_profile.id.as_str()})).collect::<Vec<_>>(),
            "dependencies":dependencies,"labels":labels
        }),
    );
    app.store_ref()
        .create_work_batch(&boreal_store::WorkBatchCreateRequest {
            project_id: project_id.as_str().to_owned(),
            actor_id: actor_id.to_owned(),
            session_id: session_id.to_owned(),
            expected_project_revision: expected_revision,
            operation_id: operation_id.to_owned(),
            request_digest,
            works,
            dependencies,
            labels,
            created_at: now.to_owned(),
        })
        .map_err(|e| TemplateError::Application(e.to_string()))
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
