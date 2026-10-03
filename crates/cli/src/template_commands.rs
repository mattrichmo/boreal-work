//! Versioned work-template discovery, validation, dry-run, capture, and apply.
use super::*;
use boreal_application::{instantiate_template, TemplateParameter, TemplateWorkItem, WorkTemplate};
use std::collections::BTreeMap;

pub(crate) fn supported(path: &[String]) -> bool {
    path.first()
        .is_some_and(|s| s == "template" || s == "templates")
}

pub(crate) fn run(
    parsed: &ParsedCommand,
    operation: &str,
    store: &SqliteStore,
) -> Result<CliResult, CliError> {
    let action = parsed.path.get(1).map(String::as_str).unwrap_or("list");
    match action {
        "list" => {
            let templates = discover_templates(parsed)?;
            Ok(CliResult {
                outcome: ApplicationOutcome::Unchanged,
                data: Some(json!({"templates": templates})),
                human: Some(format!("{} templates", templates.len())),
                ..CliResult::default()
            })
        }
        "show" => {
            let id = positional(parsed, 0)
                .or_else(|| extra(parsed, "template"))
                .ok_or_else(|| CliError::invalid("template show requires a template id"))?;
            let template = discover_templates(parsed)?
                .into_iter()
                .find(|t| t.id == id)
                .or_else(|| load_template(parsed).ok());
            let Some(template) = template else {
                return Err(CliError::with(
                    ErrorCode::NotFound,
                    ApplicationOutcome::Rejected,
                    format!("template '{id}' was not found"),
                ));
            };
            Ok(CliResult {
                outcome: ApplicationOutcome::Unchanged,
                data: Some(json!({"template": template})),
                ..CliResult::default()
            })
        }
        "validate" => {
            let template = load_template(parsed)?;
            template.validate().map_err(template_error)?;
            Ok(CliResult {
                outcome: ApplicationOutcome::Unchanged,
                data: Some(
                    json!({"valid": true, "template_id": template.id, "version": template.version, "parameters": template.parameters}),
                ),
                ..CliResult::default()
            })
        }
        "run" => run_template(parsed, operation, store),
        "capture" => capture_template(parsed, store),
        _ => Err(CliError::invalid(
            "template supports list, show, validate, run, and capture",
        )),
    }
}

fn run_template(
    parsed: &ParsedCommand,
    operation: &str,
    store: &SqliteStore,
) -> Result<CliResult, CliError> {
    let template = if extra(parsed, "input")
        .or(parsed.options.input.as_deref())
        .is_some()
    {
        load_project_template(parsed)?
    } else {
        let id = positional(parsed, 0)
            .or_else(|| extra(parsed, "template"))
            .ok_or_else(|| {
                CliError::invalid("template run requires a template id or --input PATH")
            })?;
        discover_templates(parsed)?
            .into_iter()
            .find(|t| t.id == id)
            .ok_or_else(|| {
                CliError::with(
                    ErrorCode::NotFound,
                    ApplicationOutcome::Rejected,
                    format!("template '{id}' was not found"),
                )
            })?
    };
    let vars = parsed
        .options
        .extra
        .get("var")
        .or_else(|| parsed.options.extra.get("--var"))
        .into_iter()
        .flatten()
        .map(|pair| {
            let (key, value) = pair
                .split_once('=')
                .ok_or_else(|| CliError::invalid("--var requires NAME=VALUE"))?;
            if key.trim().is_empty() {
                return Err(CliError::invalid("--var name cannot be empty"));
            }
            Ok((key.to_owned(), value.to_owned()))
        })
        .collect::<Result<BTreeMap<_, _>, _>>()?;
    let plan = template.plan(&vars).map_err(template_error)?;
    let apply =
        parsed.options.extra.contains_key("apply") || parsed.options.extra.contains_key("--apply");
    if apply && parsed.options.setup.dry_run {
        return Err(CliError::invalid(
            "--dry-run cannot be combined with --apply",
        ));
    }
    if !apply {
        return Ok(CliResult {
            outcome: ApplicationOutcome::Unchanged,
            data: Some(
                json!({"dry_run": true, "template_id": plan.template_id, "version": plan.template_version, "items": plan.rendered.iter().map(rendered_json).collect::<Vec<_>>()}),
            ),
            ..CliResult::default()
        });
    }
    if !parsed.options.setup.yes {
        return Err(CliError::invalid(
            "template run --apply requires --yes after reviewing the dry-run plan",
        ));
    }
    let project = project_argument(parsed, 0)?;
    let revision = parsed
        .options
        .expected_revision
        .ok_or_else(|| CliError::invalid("template run --apply requires --expected-revision"))?;
    let prefix = extra(parsed, "prefix")
        .or_else(|| extra(parsed, "work"))
        .ok_or_else(|| CliError::invalid("template run --apply requires --prefix ID"))?;
    let project_id = ProjectId::new(project.clone());
    let app = WorkApplication::new(store);
    let created = instantiate_template(
        &app,
        &project_id,
        &plan,
        &parsed.options.actor,
        &parsed.options.session,
        revision,
        prefix,
        &now_ms_u64().to_string(),
        operation,
    )
    .map_err(template_error)?;
    Ok(CliResult {
        outcome: if created.replayed {
            ApplicationOutcome::Unchanged
        } else {
            ApplicationOutcome::Changed
        },
        revision: Some(created.revision),
        data: Some(
            json!({"dry_run":false,"template_id":plan.template_id,"created":created.works.iter().map(|work|{let item=plan.rendered.iter().find(|item|format!("{}-{}",prefix,item.key)==work.work_id);json!({"work_id":work.work_id,"project_id":work.project_id,"kind":work.kind,"parent_id":work.parent_id,"lifecycle":work.lifecycle,"dispatch_policy":work.dispatch_policy,"priority":work.priority,"title":work.title,"description":work.description,"labels":item.map(|i|&i.labels),"dependencies":item.map(|i|&i.dependencies),"acceptance_profile":item.map(|i|&i.acceptance_profile)})}).collect::<Vec<_>>()}),
        ),
        ..CliResult::default()
    })
}

fn capture_template(parsed: &ParsedCommand, store: &SqliteStore) -> Result<CliResult, CliError> {
    let project = project_argument(parsed, 0)?;
    let work = extra(parsed, "work")
        .or(parsed.options.work.as_deref())
        .ok_or_else(|| CliError::invalid("template capture requires --work WORK_ID"))?;
    let page = store
        .list_work(&project, 1000, 0)
        .map_err(map_store_error)?;
    if page.total > page.items.len() as u64 {
        return Err(CliError::invalid(
            "template capture requires a project with at most 1000 work records so hierarchy completeness can be proven",
        ));
    }
    let records: BTreeMap<String, WorkRecord> = page
        .items
        .into_iter()
        .map(|r| (r.work_id.clone(), r))
        .collect();
    let record = records.get(work).cloned().ok_or_else(|| {
        CliError::with(
            ErrorCode::NotFound,
            ApplicationOutcome::Rejected,
            format!("work '{work}' was not found"),
        )
    })?;
    let mut included = std::collections::BTreeSet::new();
    let mut cursor = Some(work.to_owned());
    while let Some(id) = cursor {
        if !included.insert(id.clone()) {
            break;
        }
        cursor = records.get(&id).and_then(|r| r.parent_id.clone());
    }
    let mut frontier = std::collections::BTreeSet::from([work.to_owned()]);
    loop {
        let mut next = std::collections::BTreeSet::new();
        for candidate in records.values() {
            if candidate
                .parent_id
                .as_ref()
                .is_some_and(|parent| frontier.contains(parent))
                && included.insert(candidate.work_id.clone())
            {
                next.insert(candidate.work_id.clone());
            }
        }
        if next.is_empty() {
            break;
        }
        frontier = next;
    }
    if included.len() > 100 {
        return Err(CliError::invalid(
            "captured hierarchy exceeds the 100-item template bound",
        ));
    }
    let status = store
        .read_project_status(&project)
        .map_err(map_store_error)?;
    if status.revision.0 != page.revision.0 {
        return Err(CliError::with(
            ErrorCode::StaleContext,
            ApplicationOutcome::Rejected,
            "project changed while template capture gathered hierarchy and dependencies; refresh capture",
        ));
    }
    let work_items = status
        .works
        .iter()
        .map(|row| (row.work.id.to_string(), &row.work))
        .collect::<BTreeMap<_, _>>();
    let labels_by_work = store
        .project_work_labels(&project)
        .map_err(map_store_error)?;
    if store.project_revision(&project).map_err(map_store_error)?.0 != status.revision.0 {
        return Err(CliError::with(
            ErrorCode::StaleContext,
            ApplicationOutcome::Rejected,
            "project changed while template capture gathered labels; refresh capture",
        ));
    }
    let key_by_id = included
        .iter()
        .map(|id| {
            (
                id.clone(),
                format!(
                    "item-{}",
                    id.to_ascii_lowercase().replace(
                        |c: char| !c.is_ascii_lowercase()
                            && !c.is_ascii_digit()
                            && c != '-'
                            && c != '_',
                        "-"
                    )
                ),
            )
        })
        .collect::<BTreeMap<_, _>>();
    for edge in &status.dependencies {
        let before = edge.prerequisite_id.as_str();
        let after = edge.dependent_id.as_str();
        if included.contains(before) != included.contains(after) {
            return Err(CliError::invalid(format!(
                "cannot capture a partial dependency graph: edge {before} -> {after} leaves the selected hierarchy"
            )));
        }
    }
    if let Some(diagnostic) = status
        .diagnostics
        .iter()
        .find(|diagnostic| included.contains(&diagnostic.work_id))
    {
        return Err(CliError::with(
            ErrorCode::StaleContext,
            ApplicationOutcome::Rejected,
            format!(
                "cannot capture work '{}' with status diagnostic {}",
                diagnostic.work_id, diagnostic.code
            ),
        ));
    }
    let mut items = Vec::with_capacity(included.len());
    for id in &included {
        let row = records.get(id).expect("captured item exists");
        let kind = match row.kind.as_str() {
            "milestone" | "sprint" | "task" => row.kind.clone(),
            value => {
                return Err(CliError::invalid(format!(
                    "cannot capture unsupported work kind '{value}'"
                )));
            }
        };
        let key = format!(
            "item-{}",
            id.to_ascii_lowercase().replace(
                |c: char| !c.is_ascii_lowercase() && !c.is_ascii_digit() && c != '-' && c != '_',
                "-"
            )
        );
        let parent = row
            .parent_id
            .as_ref()
            .filter(|parent| included.contains(*parent))
            .map(|parent| {
                format!(
                    "item-{}",
                    parent.to_ascii_lowercase().replace(
                        |c: char| !c.is_ascii_lowercase()
                            && !c.is_ascii_digit()
                            && c != '-'
                            && c != '_',
                        "-"
                    )
                )
            });
        let work_item = work_items.get(id).ok_or_else(|| {
            CliError::with(
                ErrorCode::StaleContext,
                ApplicationOutcome::Rejected,
                format!("work '{id}' is missing from the canonical status snapshot"),
            )
        })?;
        if work_item.acceptance_profile.version != "1" {
            return Err(CliError::invalid(format!(
                "cannot capture acceptance profile version '{}' for work '{id}'",
                work_item.acceptance_profile.version
            )));
        }
        let acceptance_profile = work_item.acceptance_profile.id.as_str();
        if !matches!(acceptance_profile, "focused" | "reviewed") {
            return Err(CliError::invalid(format!(
                "cannot capture unsupported acceptance profile '{acceptance_profile}' for work '{id}'"
            )));
        }
        let expected_profile = match acceptance_profile {
            "focused" => boreal_domain::AcceptanceProfile::focused(),
            "reviewed" => boreal_domain::AcceptanceProfile::reviewed(),
            _ => unreachable!(),
        };
        if work_item.acceptance_profile != expected_profile {
            return Err(CliError::invalid(format!(
                "cannot capture noncanonical definition of acceptance profile '{acceptance_profile}' for work '{id}'"
            )));
        }
        let dependencies = status
            .dependencies
            .iter()
            .filter(|edge| edge.dependent_id.as_str() == id)
            .filter_map(|edge| key_by_id.get(edge.prerequisite_id.as_str()).cloned())
            .collect::<Vec<_>>();
        let labels = labels_by_work.get(id).cloned().unwrap_or_default();
        items.push(TemplateWorkItem {
            key,
            kind,
            parent,
            title: row.title.clone(),
            description: row.description.clone(),
            priority: row.priority,
            dispatch: row.dispatch_policy.clone(),
            dependencies,
            labels,
            acceptance_profile: acceptance_profile.to_owned(),
        });
    }
    let template = WorkTemplate {
        schema_version: 1,
        id: format!(
            "captured-{}",
            work.to_ascii_lowercase().replace(
                |c: char| !c.is_ascii_lowercase() && !c.is_ascii_digit() && c != '-' && c != '_',
                "-"
            )
        ),
        version: 1,
        title: record.title.clone(),
        description: record.description.clone(),
        parameters: Vec::<TemplateParameter>::new(),
        items,
    };
    template.validate().map_err(template_error)?;
    let output = serde_json::to_vec_pretty(&template)
        .map_err(|e| CliError::invalid(format!("cannot encode template: {e}")))?;
    let path = extra(parsed, "out")
        .ok_or_else(|| CliError::invalid("template capture requires --out PATH"))?;
    let context = project_context::resolve(parsed)?;
    let relative = Path::new(path);
    if !relative.starts_with(".boreal/templates") {
        return Err(CliError::invalid(
            "captured templates must be saved under .boreal/templates",
        ));
    }
    let _safe_path = project_context::confined_path(&context.root, relative, true)?;
    fs::create_dir_all(context.root.join(".boreal/templates"))
        .map_err(|e| CliError::invalid(format!("cannot create project template directory: {e}")))?;
    let path = project_context::confined_path(&context.root, relative, true)?;
    write_new_output(&path, &output)?;
    Ok(CliResult {
        outcome: ApplicationOutcome::Changed,
        data: Some(json!({"template": template, "path": path})),
        ..CliResult::default()
    })
}

fn load_template(parsed: &ParsedCommand) -> Result<WorkTemplate, CliError> {
    let path = extra(parsed, "input")
        .or(parsed.options.input.as_deref())
        .ok_or_else(|| CliError::invalid("template command requires --input PATH"))?;
    let context = project_context::resolve(parsed)?;
    let path = project_context::confined_path(&context.root, Path::new(path), false)?;
    let bytes = read_bounded_file(&path, 1024 * 1024)?;
    serde_json::from_slice::<WorkTemplate>(&bytes)
        .map_err(|e| CliError::invalid(format!("template file is not valid versioned JSON: {e}")))
}
fn load_project_template(parsed: &ParsedCommand) -> Result<WorkTemplate, CliError> {
    let path = extra(parsed, "input")
        .or(parsed.options.input.as_deref())
        .ok_or_else(|| CliError::invalid("template command requires --input PATH"))?;
    let relative = Path::new(path);
    if !relative.starts_with(".boreal/templates") {
        return Err(CliError::invalid(
            "template run input must be under .boreal/templates",
        ));
    }
    let context = project_context::resolve(parsed)?;
    let path = project_context::confined_path(&context.root, relative, false)?;
    let bytes = read_bounded_file(&path, 1024 * 1024)?;
    let template = serde_json::from_slice::<WorkTemplate>(&bytes).map_err(|e| {
        CliError::invalid(format!("template file is not valid versioned JSON: {e}"))
    })?;
    template.validate().map_err(template_error)?;
    Ok(template)
}
fn discover_templates(parsed: &ParsedCommand) -> Result<Vec<WorkTemplate>, CliError> {
    let mut templates = builtins();
    let context = project_context::resolve(parsed)?;
    let directory = context.root.join(".boreal/templates");
    if !directory.exists() {
        return Ok(templates);
    }
    let safe_dir =
        project_context::confined_path(&context.root, Path::new(".boreal/templates"), false)?;
    let entries = fs::read_dir(&safe_dir)
        .map_err(|e| CliError::invalid(format!("cannot read project templates: {e}")))?;
    for entry in entries.take(100) {
        let entry = entry
            .map_err(|e| CliError::invalid(format!("cannot inspect project template: {e}")))?;
        if entry.path().extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let path = project_context::confined_path(&context.root, &entry.path(), false)?;
        let bytes = read_bounded_file(&path, 1024 * 1024)?;
        let template: WorkTemplate = serde_json::from_slice(&bytes)
            .map_err(|e| CliError::invalid(format!("invalid template {}: {e}", path.display())))?;
        template.validate().map_err(template_error)?;
        if templates.iter().any(|item| item.id == template.id) {
            return Err(CliError::invalid(format!(
                "project template id '{}' shadows an existing template",
                template.id
            )));
        }
        templates.push(template);
    }
    templates.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(templates)
}

fn builtins() -> Vec<WorkTemplate> {
    vec![WorkTemplate {
        schema_version: 1,
        id: "project-kickoff".into(),
        version: 1,
        title: "Project kickoff".into(),
        description: "A milestone, a planning sprint, and a reviewed acceptance handoff.".into(),
        parameters: vec![TemplateParameter {
            name: "project".into(),
            description: "Project or initiative name".into(),
            required: true,
            default: None,
        }],
        items: vec![
            TemplateWorkItem {
                key: "milestone".into(),
                kind: "milestone".into(),
                parent: None,
                title: "{{project}} delivery".into(),
                description: "Coordinate the {{project}} delivery.".into(),
                priority: 5,
                dispatch: "operator_only".into(),
                dependencies: vec![], labels: vec!["planning".into()], acceptance_profile: "focused".into(),
            },
            TemplateWorkItem {
                key: "sprint".into(),
                kind: "sprint".into(),
                parent: Some("milestone".into()),
                title: "{{project}} first cycle".into(),
                description: "Plan and launch the first cycle.".into(),
                priority: 5,
                dispatch: "operator_only".into(),
                dependencies: vec![], labels: vec!["planning".into(),"cycle".into()], acceptance_profile: "focused".into(),
            },
            TemplateWorkItem {
                key: "first-task".into(),
                kind: "task".into(),
                parent: Some("sprint".into()),
                title: "Define {{project}} acceptance".into(),
                description:
                    "Write the initial acceptance criteria and identify required evidence.".into(),
                priority: 5,
                dispatch: "automatic".into(),
                dependencies: vec![], labels: vec!["acceptance".into()], acceptance_profile: "reviewed".into(),
            },
            TemplateWorkItem {
                key: "acceptance-review".into(), kind: "task".into(), parent: Some("sprint".into()),
                title: "Review {{project}} acceptance criteria".into(),
                description: "Independently review the acceptance plan after the initial criteria are complete.".into(),
                priority: 4, dispatch: "operator_only".into(), dependencies: vec!["first-task".into()],
                labels: vec!["review".into()], acceptance_profile: "reviewed".into(),
            },
        ],
    }]
}
fn rendered_json(item: &boreal_application::RenderedTemplateItem) -> Value {
    let kind = match item.kind {
        boreal_domain::WorkKind::Milestone => "milestone",
        boreal_domain::WorkKind::Sprint => "sprint",
        boreal_domain::WorkKind::Task => "task",
    };
    let dispatch = match item.dispatch {
        boreal_domain::DispatchPolicy::Automatic => "automatic",
        boreal_domain::DispatchPolicy::OperatorOnly => "operator_only",
        boreal_domain::DispatchPolicy::Paused => "paused",
    };
    json!({"key": item.key, "kind": kind, "parent": item.parent, "dependencies":item.dependencies,"labels":item.labels,"acceptance_profile":item.acceptance_profile,"title": item.title, "description": item.description, "priority": item.priority, "dispatch": dispatch})
}
fn extra<'a>(parsed: &'a ParsedCommand, key: &str) -> Option<&'a str> {
    parsed
        .options
        .extra
        .get(key)
        .or_else(|| parsed.options.extra.get(&format!("--{key}")))
        .and_then(|v| v.last())
        .map(String::as_str)
}
fn positional(parsed: &ParsedCommand, index: usize) -> Option<&str> {
    parsed.options.positionals.get(index).map(String::as_str)
}
fn template_error(error: impl std::fmt::Display) -> CliError {
    CliError::invalid(error.to_string())
}
fn write_new_output(path: &Path, bytes: &[u8]) -> Result<(), CliError> {
    use std::io::Write;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| CliError::invalid(format!("cannot create {}: {e}", path.display())))?;
    file.write_all(bytes)
        .map_err(|e| CliError::invalid(format!("cannot write {}: {e}", path.display())))?;
    Ok(())
}
