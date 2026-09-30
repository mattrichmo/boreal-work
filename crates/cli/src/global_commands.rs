//! CLI adapter for the installation-wide personal manager.
//!
//! Global state has its own root and schema. These commands never infer or
//! open a project database from the current working directory.

use super::*;
use boreal_application::{GlobalManagerApplication, GlobalManagerError, ResolvedWorkspaceIdentity};

pub(crate) fn supported(path: &[String]) -> bool {
    path.first().is_some_and(|value| value == "global")
        && path != ["global", "service", "run"]
        && path != ["global", "dashboard"]
}

pub(crate) fn global_db_path() -> Result<PathBuf, CliError> {
    if let Some(root) = env::var_os("BOREAL_GLOBAL_ROOT") {
        let root = PathBuf::from(root);
        if !root.is_absolute() || root.as_os_str().is_empty() {
            return Err(CliError::invalid(
                "BOREAL_GLOBAL_ROOT must be a non-empty absolute directory",
            ));
        }
        return Ok(root.join("global.sqlite"));
    }
    // Retain the short-lived development override while the installer moves
    // to the public BOREAL_GLOBAL_ROOT name.
    if let Some(root) = env::var_os("BOREAL_GLOBAL_DATA_DIR") {
        let root = PathBuf::from(root);
        if !root.is_absolute() || root.as_os_str().is_empty() {
            return Err(CliError::invalid(
                "BOREAL_GLOBAL_DATA_DIR must be a non-empty absolute directory",
            ));
        }
        return Ok(root.join("global.sqlite"));
    }
    #[cfg(target_os = "macos")]
    if let Some(home) = env::var_os("HOME") {
        let home = PathBuf::from(home);
        if !home.is_absolute() {
            return Err(CliError::invalid(
                "HOME must be a non-empty absolute directory",
            ));
        }
        return Ok(home.join("Library/Application Support/Boreal/global.sqlite"));
    }
    if let Some(root) = env::var_os("XDG_STATE_HOME") {
        let root = PathBuf::from(root);
        if !root.is_absolute() {
            return Err(CliError::invalid("XDG_STATE_HOME must be absolute"));
        }
        return Ok(root.join("boreal/global.sqlite"));
    }
    let home = env::var_os("HOME").ok_or_else(|| {
        CliError::with(
            ErrorCode::ServiceUnavailable,
            ApplicationOutcome::Failed,
            "cannot resolve the user data directory: HOME is unavailable",
        )
    })?;
    let home = PathBuf::from(home);
    if !home.is_absolute() {
        return Err(CliError::invalid(
            "HOME must be a non-empty absolute directory",
        ));
    }
    Ok(home.join(".local/state/boreal/global.sqlite"))
}

pub(crate) fn ensure_global_root() -> Result<PathBuf, CliError> {
    let database = global_db_path()?;
    let parent = database.parent().unwrap_or(Path::new("."));
    #[cfg(unix)]
    {
        use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
        let mut builder = fs::DirBuilder::new();
        builder.recursive(true).mode(0o700);
        builder.create(parent).map_err(|error| {
            CliError::with(
                ErrorCode::ServiceUnavailable,
                ApplicationOutcome::Failed,
                format!(
                    "cannot create global data directory {}: {error}",
                    parent.display()
                ),
            )
        })?;
        fs::set_permissions(parent, fs::Permissions::from_mode(0o700)).map_err(|error| {
            CliError::with(
                ErrorCode::ServiceUnavailable,
                ApplicationOutcome::Failed,
                format!(
                    "cannot secure global data directory {}: {error}",
                    parent.display()
                ),
            )
        })?;
    }
    #[cfg(not(unix))]
    fs::create_dir_all(parent).map_err(|error| {
        CliError::with(
            ErrorCode::ServiceUnavailable,
            ApplicationOutcome::Failed,
            format!(
                "cannot create global data directory {}: {error}",
                parent.display()
            ),
        )
    })?;
    Ok(database)
}

pub(crate) fn build_command(parsed: &ParsedCommand) -> Result<(String, Value), CliError> {
    let route = parsed
        .path
        .iter()
        .skip(1)
        .map(String::as_str)
        .collect::<Vec<_>>();
    let options = &parsed.options.extra;
    let value = |name: &str| -> Option<String> {
        options
            .get(&format!("--{name}"))
            .and_then(|values| values.last())
            .cloned()
    };
    let title = || value("title").or_else(|| parsed.options.title.clone());
    let description = || value("description").or_else(|| parsed.options.description.clone());
    let positional = |index: usize| parsed.options.positionals.get(index).cloned();
    let mut payload = json!({});
    let command = match route.as_slice() {
        ["bootstrap"] | ["init"] => "snapshot".to_owned(),
        ["status"] | ["snapshot"] => "snapshot".to_owned(),
        ["project", "add"] => {
            payload["name"] = json!(required(
                value("name"),
                "global project add requires --name"
            )?);
            if let Some(description) = description() {
                payload["description"] = json!(description);
            }
            if let Some(folder) = value("folder") {
                payload["folder"] = json!(normalize_folder_path(&folder)?);
            }
            if let Some(labels) = value("labels") {
                payload["labels"] = parse_labels(&labels)?;
            }
            if let Some(priority) = parsed.options.priority {
                payload["priority"] = json!(priority);
            }
            "project add".to_owned()
        }
        ["project", "list"] => "project list".to_owned(),
        ["project", "show"] => {
            payload["project_id"] = json!(required(
                positional(0),
                "global project show requires a project ID"
            )?);
            "project show".to_owned()
        }
        ["project", "edit"] => {
            payload["project_id"] = json!(required(
                positional(0),
                "global project edit requires a project ID"
            )?);
            if let Some(name) = value("name") {
                payload["name"] = json!(name);
            }
            if let Some(description) = description() {
                payload["description"] = json!(description);
            }
            if let Some(labels) = value("labels") {
                payload["labels"] = parse_labels(&labels)?;
            }
            if let Some(priority) = parsed.options.priority {
                payload["priority"] = json!(priority);
            }
            if let Some(lifecycle) = value("lifecycle") {
                payload["lifecycle"] = json!(lifecycle);
            }
            if let Some(health) = value("health") {
                payload["health"] = json!(health);
            }
            "project edit".to_owned()
        }
        ["project", "archive"] => {
            payload["project_id"] = json!(required(
                positional(0),
                "global project archive requires a project ID"
            )?);
            "project archive".to_owned()
        }
        ["project", "unarchive"] => {
            payload["project_id"] = json!(required(
                positional(0),
                "global project unarchive requires a project ID"
            )?);
            "project unarchive".to_owned()
        }
        ["project", "attach-folder"] => {
            payload["project_id"] = json!(required(
                positional(0),
                "global project attach-folder requires a project ID"
            )?);
            let folder = required(
                value("folder"),
                "global project attach-folder requires --folder",
            )?;
            payload["path"] = json!(normalize_folder_path(&folder)?);
            "project attach-folder".to_owned()
        }
        ["project", "link"] => {
            payload["project_id"] = json!(required(
                positional(0),
                "global project link requires a project ID"
            )?);
            let workspace = required(
                value("workspace"),
                "global project link requires --workspace",
            )?;
            payload["path"] = json!(workspace);
            "project link".to_owned()
        }
        ["project", "unlink"] => {
            payload["project_id"] = json!(required(
                positional(0),
                "global project unlink requires a project ID"
            )?);
            if let Some(workspace) = value("workspace") {
                let (identity, _) = validate_workspace(&workspace)?;
                payload["kind"] = json!("workspace");
                payload["identity"] = json!(identity);
            } else if let Some(folder) = value("folder") {
                let path = normalize_folder_path(&folder)?;
                payload["kind"] = json!("folder");
                payload["identity"] = json!(path);
            } else {
                return Err(CliError::invalid(
                    "global project unlink requires --workspace or --folder",
                ));
            }
            "project unlink".to_owned()
        }
        ["todo", "add"] => {
            payload["title"] = json!(required(
                title().or_else(|| positional(0)),
                "global todo add requires --title"
            )?);
            if let Some(project) = parsed.options.project.clone() {
                payload["project_id"] = json!(project);
            }
            if let Some(description) = description() {
                payload["description"] = json!(description);
            }
            if let Some(parent) = value("parent") {
                payload["parent_id"] = json!(parent);
            }
            if let Some(priority) = parsed.options.priority {
                payload["priority"] = json!(priority);
            }
            if let Some(due_at) = value("due-at").or_else(|| value("due")) {
                payload["due_at"] = json!(due_at);
            }
            if let Some(labels) = value("labels") {
                payload["labels"] = parse_labels(&labels)?;
            }
            "todo add".to_owned()
        }
        ["todo", "list"] => {
            if let Some(project) = parsed.options.project.clone() {
                payload["project_id"] = json!(project);
            }
            if options.contains_key("--include-archived") {
                payload["include_archived"] = json!(true);
            }
            "todo list".to_owned()
        }
        ["todo", "show"] => {
            payload["item_id"] = json!(required(
                positional(0),
                "global todo show requires an item ID"
            )?);
            "todo show".to_owned()
        }
        ["todo", "edit"] => {
            payload["item_id"] = json!(required(
                positional(0),
                "global todo edit requires an item ID"
            )?);
            if let Some(title) = title() {
                payload["title"] = json!(title);
            }
            if let Some(description) = description() {
                payload["description"] = json!(description);
            }
            if let Some(labels) = value("labels") {
                payload["labels"] = parse_labels(&labels)?;
            }
            if let Some(priority) = parsed.options.priority {
                payload["priority"] = json!(priority);
            }
            if let Some(due_at) = value("due-at").or_else(|| value("due")) {
                payload["due_at"] = json!(due_at);
            }
            "todo edit".to_owned()
        }
        ["todo", "move"] => {
            payload["item_id"] = json!(required(
                positional(0),
                "global todo move requires an item ID"
            )?);
            payload["status_id"] = json!(required(
                value("status"),
                "global todo move requires --status"
            )?);
            "todo move".to_owned()
        }
        ["todo", "reorder"] => {
            payload["item_id"] = json!(required(
                positional(0),
                "global todo reorder requires an item ID"
            )?);
            payload["direction"] = json!(required(
                value("direction"),
                "global todo reorder requires --direction up|down"
            )?);
            "todo reorder".to_owned()
        }
        ["todo", "complete"] | ["todo", "reopen"] | ["todo", "archive"] | ["todo", "unarchive"] => {
            payload["item_id"] = json!(required(
                positional(0),
                "global todo action requires an item ID"
            )?);
            format!("todo {}", route[1])
        }
        ["task", "add"] | ["subtask", "add"] | ["milestone", "add"] => {
            payload["title"] = json!(required(
                title().or_else(|| positional(0)),
                "item creation requires --title"
            )?);
            if let Some(project) = parsed.options.project.clone() {
                payload["project_id"] = json!(project);
            }
            if let Some(parent) = value("parent") {
                payload["parent_id"] = json!(parent);
            }
            if let Some(description) = description() {
                payload["description"] = json!(description);
            }
            if let Some(priority) = parsed.options.priority {
                payload["priority"] = json!(priority);
            }
            if let Some(due_at) = value("due-at").or_else(|| value("due")) {
                payload["due_at"] = json!(due_at);
            }
            if let Some(labels) = value("labels") {
                payload["labels"] = parse_labels(&labels)?;
            }
            if let Some(position) = value("position") {
                payload["position"] = json!(parse_position(&position)?);
            }
            if route[0] == "subtask" {
                payload["parent_id"] = json!(required(
                    value("parent"),
                    "global subtask add requires --parent"
                )?);
            }
            format!("{} add", route[0])
        }
        ["workflow", "status", "add"] => {
            payload["project_id"] = json!(required(
                parsed.options.project.clone().or_else(|| value("project")),
                "workflow status add requires --project"
            )?);
            payload["status_id"] = json!(required(
                value("status-id").or_else(|| value("id")),
                "workflow status add requires --status-id"
            )?);
            payload["label"] = json!(required(
                value("label").or_else(|| value("name")),
                "workflow status add requires --label"
            )?);
            if let Some(category) = value("category") {
                payload["category"] = json!(category);
            }
            if let Some(position) = value("position") {
                payload["position"] = json!(parse_position(&position)?);
            }
            "workflow status add".to_owned()
        }
        ["workflow", "status", "edit"] => {
            payload["project_id"] = json!(required(
                parsed.options.project.clone().or_else(|| value("project")),
                "workflow status edit requires --project"
            )?);
            payload["status_id"] = json!(required(
                value("status-id").or_else(|| value("id")),
                "workflow status edit requires --status-id"
            )?);
            if let Some(label) = value("label") {
                payload["label"] = json!(label);
            }
            if let Some(category) = value("category") {
                payload["category"] = json!(category);
            }
            if let Some(position) = value("position") {
                payload["position"] = json!(parse_position(&position)?);
            }
            "workflow status edit".to_owned()
        }
        ["workflow", "status", "list"] => {
            payload["project_id"] = json!(required(
                parsed.options.project.clone().or_else(|| value("project")),
                "workflow status list requires --project"
            )?);
            "workflow status list".to_owned()
        }
        ["relationship", "add"] => {
            payload["source_id"] = json!(required(
                value("source").or_else(|| positional(0)),
                "relationship add requires --source"
            )?);
            payload["target_id"] = json!(required(
                value("target").or_else(|| positional(1)),
                "relationship add requires --target"
            )?);
            if let Some(kind) = parsed.options.kind.clone() {
                payload["kind"] = json!(kind);
            }
            "relationship add".to_owned()
        }
        ["relationship", "remove"] => {
            payload["source_id"] = json!(required(
                value("source").or_else(|| positional(0)),
                "relationship remove requires --source"
            )?);
            payload["target_id"] = json!(required(
                value("target").or_else(|| positional(1)),
                "relationship remove requires --target"
            )?);
            if let Some(kind) = parsed.options.kind.clone() {
                payload["kind"] = json!(kind);
            }
            "relationship remove".to_owned()
        }
        ["relationship", "list"] => {
            if let Some(project) = parsed.options.project.clone() {
                payload["project_id"] = json!(project);
            }
            "relationship list".to_owned()
        }
        ["task", "list"] | ["milestone", "list"] => {
            if let Some(project) = parsed.options.project.clone() {
                payload["project_id"] = json!(project);
            }
            format!("{} list", route[0])
        }
        ["task", "show"] | ["milestone", "show"] => {
            payload["item_id"] = json!(required(positional(0), "item show requires an item ID")?);
            format!("{} show", route[0])
        }
        ["task", "edit"] | ["milestone", "edit"] => {
            payload["item_id"] = json!(required(positional(0), "item edit requires an item ID")?);
            if let Some(title) = title() {
                payload["title"] = json!(title);
            }
            if let Some(description) = description() {
                payload["description"] = json!(description);
            }
            if let Some(status) = value("status") {
                payload["status_id"] = json!(status);
            }
            if let Some(priority) = parsed.options.priority {
                payload["priority"] = json!(priority);
            }
            if let Some(due_at) = value("due-at").or_else(|| value("due")) {
                payload["due_at"] = json!(due_at);
            }
            if let Some(labels) = value("labels") {
                payload["labels"] = parse_labels(&labels)?;
            }
            if let Some(position) = value("position") {
                payload["position"] = json!(parse_position(&position)?);
            }
            format!("{} edit", route[0])
        }
        ["task", "archive"] | ["milestone", "archive"] => {
            payload["item_id"] =
                json!(required(positional(0), "item archive requires an item ID")?);
            format!("{} archive", route[0])
        }
        ["task", "unarchive"] | ["milestone", "unarchive"] => {
            payload["item_id"] = json!(required(
                positional(0),
                "item unarchive requires an item ID"
            )?);
            format!("{} unarchive", route[0])
        }
        ["note", "add"] => {
            payload["title"] = json!(required(title(), "global note add requires --title")?);
            payload["body"] = json!(required(value("body"), "global note add requires --body")?);
            if let Some(project) = parsed.options.project.clone() {
                payload["project_id"] = json!(project);
            }
            "note add".to_owned()
        }
        ["note", "list"] => {
            if let Some(project) = parsed.options.project.clone() {
                payload["project_id"] = json!(project);
            }
            "note list".to_owned()
        }
        ["note", "show"] => {
            payload["note_id"] = json!(required(
                positional(0),
                "global note show requires a note ID"
            )?);
            "note show".to_owned()
        }
        ["note", "edit"] => {
            payload["note_id"] = json!(required(
                positional(0),
                "global note edit requires a note ID"
            )?);
            if let Some(title) = title() {
                payload["title"] = json!(title);
            }
            if let Some(body) = value("body") {
                payload["body"] = json!(body);
            }
            "note edit".to_owned()
        }
        ["note", "archive"] => {
            payload["note_id"] = json!(required(
                positional(0),
                "global note archive requires a note ID"
            )?);
            "note archive".to_owned()
        }
        ["note", "unarchive"] => {
            payload["note_id"] = json!(required(
                positional(0),
                "global note unarchive requires a note ID"
            )?);
            "note unarchive".to_owned()
        }
        ["linked", "show"] => {
            payload["project_id"] = json!(required(
                positional(0),
                "global linked show requires a management project ID"
            )?);
            payload["identity"] = json!(required(
                positional(1),
                "global linked show requires a linked workspace project ID"
            )?);
            "linked show".to_owned()
        }
        ["history"] => {
            if let Some(limit) = parsed.options.limit {
                payload["limit"] = json!(limit);
            }
            if let Some(offset) = parsed.options.offset {
                payload["offset"] = json!(offset);
            }
            if let Some(project_id) = parsed.options.project.clone().or_else(|| value("project")) {
                payload["project_id"] = json!(project_id);
            }
            if let Some(entity_id) = value("entity").or_else(|| value("item")) {
                payload["entity_id"] = json!(entity_id);
            }
            "history".to_owned()
        }
        ["operation", "show"] => {
            payload["operation_id"] = json!(required(
                positional(0),
                "global operation show requires an operation ID"
            )?);
            "operation show".to_owned()
        }
        ["export"] => {
            if let Some(out) = value("out") {
                payload["path"] = json!(out);
            }
            "export".to_owned()
        }
        ["import"] => {
            payload["input_path"] = json!(required(
                parsed.options.input.clone(),
                "global import requires --input"
            )?);
            "import".to_owned()
        }
        _ => {
            return Err(CliError::with(
                ErrorCode::NotFound,
                ApplicationOutcome::Rejected,
                format!("unsupported global command: {}", route.join(" ")),
            ));
        }
    };
    if command == "import" {
        let source = payload
            .get("input_path")
            .and_then(Value::as_str)
            .ok_or_else(|| CliError::invalid("global import requires --input"))?;
        let bytes = fs::read(source).map_err(|error| {
            CliError::with(
                ErrorCode::NotFound,
                ApplicationOutcome::Rejected,
                format!("cannot read global backup {}: {error}", source),
            )
        })?;
        let snapshot: Value = serde_json::from_slice(&bytes).map_err(|error| {
            CliError::invalid(format!("global backup is invalid JSON: {error}"))
        })?;
        let app = GlobalManagerApplication::open(ensure_global_root()?).map_err(global_error)?;
        let current = app
            .execute("snapshot", &json!({}), "op_global_import_preflight")
            .map_err(global_error)?;
        let occupied = ["projects", "items", "notes"].iter().any(|key| {
            current
                .get(*key)
                .and_then(Value::as_array)
                .is_some_and(|rows| !rows.is_empty())
        });
        if occupied
            && !(options.contains_key("--replace")
                && parsed.options.setup.yes
                && parsed.options.expected_revision.is_some())
        {
            return Err(CliError::invalid(
                "replacing nonempty global data requires --replace --yes --expected-revision N",
            ));
        }
        payload = json!({"snapshot":snapshot,"replace":occupied});
    }
    if let Some(expected_revision) = parsed.options.expected_revision {
        payload["expected_revision"] = json!(expected_revision);
    }
    Ok((command, payload))
}

pub(crate) fn run(parsed: &ParsedCommand, operation: &str) -> Result<CliResult, CliError> {
    let path = ensure_global_root()?;
    let route = parsed
        .path
        .iter()
        .skip(1)
        .map(String::as_str)
        .collect::<Vec<_>>();
    if matches!(route.as_slice(), ["bootstrap"] | ["init"]) {
        let app = GlobalManagerApplication::open(&path).map_err(global_error)?;
        let data = json!({"database": path, "provisioned": true, "revision": app.revision().map_err(global_error)?});
        return Ok(result(parsed, operation, data, false));
    }
    let (command, payload) = build_command(parsed)?;
    let data = execute_request(&command, &payload, operation)?;
    if command == "export" {
        write_export(&parsed.options.extra, &data)?;
    }
    let changed = is_mutation(&command);
    let revision = data
        .get("revision")
        .and_then(Value::as_u64)
        .or_else(|| GlobalManagerApplication::open(&path).ok()?.revision().ok());
    Ok(CliResult {
        outcome: if changed {
            ApplicationOutcome::Changed
        } else {
            ApplicationOutcome::Unchanged
        },
        revision,
        data: Some(data),
        human: None,
        as_of: Some(now_timestamp()),
        next_status_change_at: None,
        detail_ref: None,
    })
}

pub(crate) fn snapshot_data(operation: &str) -> Result<Value, CliError> {
    let path = ensure_global_root()?;
    let app = GlobalManagerApplication::open(path).map_err(global_error)?;
    let mut data = app
        .execute("snapshot", &json!({}), operation)
        .map_err(global_error)?;
    enrich_snapshot(&mut data);
    Ok(data)
}

pub(crate) fn execute_request(
    command: &str,
    payload: &Value,
    operation: &str,
) -> Result<Value, CliError> {
    let path = ensure_global_root()?;
    let app = GlobalManagerApplication::open(path).map_err(global_error)?;
    if command == "linked show" {
        let management_project_id = payload
            .get("project_id")
            .and_then(Value::as_str)
            .ok_or_else(|| CliError::invalid("linked show requires project_id"))?;
        let identity = payload
            .get("identity")
            .and_then(Value::as_str)
            .ok_or_else(|| CliError::invalid("linked show requires identity"))?;
        let snapshot = app
            .execute("snapshot", &json!({}), &format!("{operation}-linked-show"))
            .map_err(global_error)?;
        let association = snapshot
            .get("associations")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .find(|row| {
                row.get("project_id").and_then(Value::as_str) == Some(management_project_id)
                    && row.get("kind").and_then(Value::as_str) == Some("workspace")
                    && row.get("identity").and_then(Value::as_str) == Some(identity)
            })
            .ok_or_else(|| {
                CliError::with(
                    ErrorCode::NotFound,
                    ApplicationOutcome::Rejected,
                    "the linked workspace is not associated with that management project",
                )
            })?;
        let stored_path = association
            .get("path")
            .and_then(Value::as_str)
            .ok_or_else(|| CliError::invalid("linked workspace association has no path"))?;
        return linked_workspace_detail(
            management_project_id,
            identity,
            stored_path,
            Instant::now() + Duration::from_secs(2),
        )
        .map_err(|error| {
            CliError::with(
                ErrorCode::ServiceUnavailable,
                ApplicationOutcome::Failed,
                format!("linked workspace is unavailable: {error}"),
            )
        });
    }
    let mut result = app
        .execute_with_workspace_resolver(command, payload, operation, |path| {
            let (project_id, path) = validate_workspace(path).map_err(|error| error.message)?;
            Ok(ResolvedWorkspaceIdentity { project_id, path })
        })
        .map_err(global_error)?;
    if command == "snapshot" {
        enrich_snapshot(&mut result);
    }
    if command == "project show" {
        let mut snapshot = app
            .execute("snapshot", &json!({}), &format!("{operation}-rollup"))
            .map_err(global_error)?;
        enrich_snapshot(&mut snapshot);
        let id = payload
            .get("project_id")
            .and_then(Value::as_str)
            .unwrap_or_default();
        result["linked_projects"] = json!(
            snapshot
                .get("linked_projects")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter(|row| row.get("management_project_id").and_then(Value::as_str) == Some(id))
                .collect::<Vec<_>>()
        );
    }
    Ok(result)
}

pub(crate) fn write_export(
    options: &std::collections::BTreeMap<String, Vec<String>>,
    data: &Value,
) -> Result<(), CliError> {
    let Some(path) = options.get("--out").and_then(|values| values.last()) else {
        return Ok(());
    };
    let path = PathBuf::from(path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            CliError::invalid(format!("cannot create export directory: {error}"))
        })?;
    }
    let temp = path.with_extension(format!(
        "{}.tmp",
        path.extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("json")
    ));
    let encoded = serde_json::to_vec_pretty(data)
        .map_err(|error| CliError::invalid(format!("cannot encode global export: {error}")))?;
    fs::write(&temp, encoded).map_err(|error| {
        CliError::with(
            ErrorCode::ServiceUnavailable,
            ApplicationOutcome::Failed,
            format!("cannot write global export: {error}"),
        )
    })?;
    fs::rename(&temp, &path).map_err(|error| {
        CliError::with(
            ErrorCode::ServiceUnavailable,
            ApplicationOutcome::Failed,
            format!("cannot install global export: {error}"),
        )
    })?;
    Ok(())
}

pub(crate) fn mutation(command: &str) -> bool {
    is_mutation(command)
}

fn is_mutation(command: &str) -> bool {
    !matches!(
        command,
        "snapshot"
            | "project list"
            | "project show"
            | "todo list"
            | "todo show"
            | "note list"
            | "note show"
            | "workflow status list"
            | "relationship list"
            | "task list"
            | "task show"
            | "milestone list"
            | "milestone show"
            | "history"
            | "operation show"
            | "linked show"
            | "export"
    )
}

fn parse_labels(raw: &str) -> Result<Value, CliError> {
    let labels = if raw.trim_start().starts_with('[') {
        let value: Value = serde_json::from_str(raw)
            .map_err(|error| CliError::invalid(format!("invalid --labels JSON: {error}")))?;
        value
            .as_array()
            .cloned()
            .ok_or_else(|| CliError::invalid("--labels JSON must be an array of strings"))?
    } else {
        raw.split(',')
            .map(str::trim)
            .filter(|label| !label.is_empty())
            .map(|label| json!(label))
            .collect()
    };
    if labels
        .iter()
        .any(|label| !label.as_str().is_some_and(|s| !s.trim().is_empty()))
    {
        return Err(CliError::invalid("--labels must contain non-empty strings"));
    }
    Ok(json!(labels))
}

fn parse_position(raw: &str) -> Result<i64, CliError> {
    raw.parse::<i64>()
        .map_err(|_| CliError::invalid("--position must be an integer"))
}

fn result(_parsed: &ParsedCommand, _operation: &str, data: Value, changed: bool) -> CliResult {
    CliResult {
        outcome: if changed {
            ApplicationOutcome::Changed
        } else {
            ApplicationOutcome::Unchanged
        },
        revision: data.get("revision").and_then(Value::as_u64),
        data: Some(data),
        as_of: Some(now_timestamp()),
        ..CliResult::default()
    }
}

fn app_error(error: impl std::fmt::Display) -> CliError {
    CliError::with(
        ErrorCode::InvalidArgument,
        ApplicationOutcome::Rejected,
        error.to_string(),
    )
}

fn global_error(error: GlobalManagerError) -> CliError {
    match error {
        GlobalManagerError::Invalid(message) => CliError::with(
            ErrorCode::InvalidArgument,
            ApplicationOutcome::Rejected,
            message,
        ),
        GlobalManagerError::NotFound(message) => {
            CliError::with(ErrorCode::NotFound, ApplicationOutcome::Rejected, message)
        }
        GlobalManagerError::Conflict(message) => CliError::with(
            ErrorCode::RevisionConflict,
            ApplicationOutcome::Conflict,
            message,
        ),
        GlobalManagerError::Busy(message) => {
            CliError::with(ErrorCode::ServiceBusy, ApplicationOutcome::Busy, message)
        }
        GlobalManagerError::Store(error) => CliError::with(
            ErrorCode::ServiceUnavailable,
            ApplicationOutcome::Failed,
            error.to_string(),
        ),
    }
}

fn required(value: Option<String>, message: &str) -> Result<String, CliError> {
    value
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| CliError::invalid(message))
}

fn now_timestamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string()
}

pub(crate) fn global_now_timestamp() -> String {
    now_timestamp()
}

#[derive(Deserialize)]
struct WorkspaceMetadata {
    project_id: String,
    project_root: PathBuf,
    database: PathBuf,
    #[serde(default)]
    operator_actor: Option<String>,
}

pub(crate) fn validate_workspace(input: &str) -> Result<(String, String), CliError> {
    let root = fs::canonicalize(input).map_err(|error| {
        CliError::with(
            ErrorCode::NotFound,
            ApplicationOutcome::Rejected,
            format!("workspace folder is unavailable: {error}"),
        )
    })?;
    let metadata_path = root.join(".boreal/project.json");
    let bytes = fs::read(&metadata_path).map_err(|error| {
        CliError::with(
            ErrorCode::NotFound,
            ApplicationOutcome::Rejected,
            format!("folder is not an initialized Boreal workspace: {error}"),
        )
    })?;
    let metadata: WorkspaceMetadata = serde_json::from_slice(&bytes).map_err(|error| {
        CliError::invalid(format!("invalid Boreal workspace metadata: {error}"))
    })?;
    let declared_root = fs::canonicalize(&metadata.project_root).map_err(|error| {
        CliError::invalid(format!("workspace metadata root is unavailable: {error}"))
    })?;
    if declared_root != root {
        return Err(CliError::with(
            ErrorCode::OperationConflict,
            ApplicationOutcome::Rejected,
            "workspace metadata points at a different folder",
        ));
    }
    let database = if metadata.database.is_absolute() {
        metadata.database.clone()
    } else {
        root.join(&metadata.database)
    };
    let database = fs::canonicalize(&database).map_err(|error| {
        CliError::invalid(format!("workspace database is unavailable: {error}"))
    })?;
    if !database.starts_with(&root) {
        return Err(CliError::with(
            ErrorCode::OperationConflict,
            ApplicationOutcome::Rejected,
            "workspace database lies outside its folder",
        ));
    }
    let store = SqliteStore::open_read_only_for_diagnostics(&database).map_err(map_store_error)?;
    let context = project_context::ProjectContext {
        project_id: metadata.project_id.clone(),
        root: root.clone(),
        database: database.clone(),
    };
    project_context::validate_store(&context, &store)?;
    let identities = IdentityStore::new(&store);
    let database_identity = identities
        .database_identity()
        .map_err(|error| app_error(error))?;
    let identity = identities
        .context(&metadata.project_id)
        .map_err(|error| app_error(error))?;
    if identity.database_instance_id != database_identity.database_instance_id {
        return Err(CliError::with(
            ErrorCode::OperationConflict,
            ApplicationOutcome::Rejected,
            "workspace identity does not match its database",
        ));
    }
    Ok((metadata.project_id, root.to_string_lossy().into_owned()))
}

fn normalize_folder_path(input: &str) -> Result<String, CliError> {
    let path = PathBuf::from(input);
    let absolute = if path.is_absolute() {
        path
    } else {
        env::current_dir()
            .map_err(|error| CliError::invalid(error.to_string()))?
            .join(path)
    };
    let canonical = fs::canonicalize(&absolute).map_err(|error| {
        CliError::with(
            ErrorCode::NotFound,
            ApplicationOutcome::Rejected,
            format!("folder is unavailable: {error}"),
        )
    })?;
    if !canonical.is_dir() {
        return Err(CliError::invalid(
            "folder association must name a directory",
        ));
    }
    Ok(canonical.to_string_lossy().into_owned())
}

fn enrich_snapshot(snapshot: &mut Value) {
    let associations = snapshot
        .get("associations")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut linked = Vec::new();
    let deadline = Instant::now() + Duration::from_secs(2);
    for association in associations
        .iter()
        .filter(|item| item.get("kind").and_then(Value::as_str) == Some("workspace"))
    {
        let management_project_id = association
            .get("project_id")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned();
        let identity = association
            .get("identity")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned();
        let path = association
            .get("path")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned();
        let result = linked_workspace_rollup(&identity, &path, deadline);
        linked.push(match result {
            Ok(value) => json!({"management_project_id":management_project_id,"project_id":identity,"path":path,"availability":"available","revision":value["revision"],"as_of":value["as_of"],"counts":value["counts"],"error":null}),
            Err(error) => json!({"management_project_id":management_project_id,"project_id":identity,"path":path,"availability":"unavailable","revision":null,"as_of":null,"counts":null,"error":error}),
        });
    }
    snapshot["linked_projects"] = json!(linked);
}

fn linked_workspace_rollup(identity: &str, path: &str, deadline: Instant) -> Result<Value, String> {
    let identity = identity.to_owned();
    let path = path.to_owned();
    let (sender, receiver) = std::sync::mpsc::channel();
    thread::spawn(move || {
        let result = (|| -> Result<Value, String> {
            let (validated_id, root) = validate_workspace(&path).map_err(|error| error.message)?;
            if validated_id != identity {
                return Err("linked project identity does not match workspace metadata".into());
            }
            let root = PathBuf::from(root);
            let metadata: WorkspaceMetadata = serde_json::from_slice(
                &fs::read(root.join(".boreal/project.json")).map_err(|error| error.to_string())?,
            )
            .map_err(|error| error.to_string())?;
            let operator_actor = metadata
                .operator_actor
                .as_deref()
                .filter(|actor| !actor.trim().is_empty())
                .ok_or_else(|| {
                    "workspace metadata does not record a local operator actor".to_owned()
                })?;
            let database = fs::canonicalize(if metadata.database.is_absolute() {
                metadata.database
            } else {
                root.join(metadata.database)
            })
            .map_err(|error| error.to_string())?;
            let store = SqliteStore::open_read_only_for_diagnostics(database)
                .map_err(|error| error.to_string())?;
            let snapshot = boreal_application::project_status_from_store_for_session(
                &store,
                &ProjectId::new(&identity),
                &boreal_domain::ActorContext {
                    actor_id: ActorId::new(operator_actor),
                    role: boreal_domain::ActorRole::Operator,
                },
                None,
                TimestampMs::from_millis(now_ms_u64()),
                1,
                0,
            )
            .map_err(|error| error.to_string())?;
            let counts = &snapshot.counts;
            Ok(
                json!({"revision":snapshot.project_revision.0,"as_of":stamp(snapshot.as_of.as_millis()),"counts":{"total":snapshot.total,"draft":counts.draft,"queued":counts.queued,"ready":counts.ready,"claimed":counts.claimed,"in_progress":counts.in_progress,"needs_verification":counts.needs_verification,"awaiting_review":counts.awaiting_review,"complete":counts.complete,"closed":counts.closed,"blocked":counts.blocked,"paused":counts.paused,"retry_wait":counts.retry_wait,"expired_review":counts.expired_review,"cancelled":counts.cancelled,"scheduled":counts.scheduled}}),
            )
        })();
        let _ = sender.send(result);
    });
    receiver
        .recv_timeout(deadline.saturating_duration_since(Instant::now()))
        .map_err(|_| "workspace rollup timed out".to_owned())?
}

fn linked_workspace_detail(
    management_project_id: &str,
    identity: &str,
    path: &str,
    deadline: Instant,
) -> Result<Value, String> {
    let management_project_id = management_project_id.to_owned();
    let identity = identity.to_owned();
    let path = path.to_owned();
    let (sender, receiver) = std::sync::mpsc::channel();
    thread::spawn(move || {
        let result = (|| -> Result<Value, String> {
            let (validated_id, root) = validate_workspace(&path).map_err(|error| error.message)?;
            if validated_id != identity {
                return Err("linked project identity does not match workspace metadata".into());
            }
            let root = PathBuf::from(root);
            let metadata: WorkspaceMetadata = serde_json::from_slice(
                &fs::read(root.join(".boreal/project.json")).map_err(|error| error.to_string())?,
            )
            .map_err(|error| error.to_string())?;
            let operator_actor = metadata
                .operator_actor
                .as_deref()
                .filter(|actor| !actor.trim().is_empty())
                .ok_or_else(|| {
                    "workspace metadata does not record a local operator actor".to_owned()
                })?;
            let database = fs::canonicalize(if metadata.database.is_absolute() {
                metadata.database
            } else {
                root.join(metadata.database)
            })
            .map_err(|error| error.to_string())?;
            let store = SqliteStore::open_read_only_for_diagnostics(database)
                .map_err(|error| error.to_string())?;
            let snapshot = boreal_application::project_status_from_store_for_session(
                &store,
                &ProjectId::new(&identity),
                &boreal_domain::ActorContext {
                    actor_id: ActorId::new(operator_actor),
                    role: boreal_domain::ActorRole::Operator,
                },
                None,
                TimestampMs::from_millis(now_ms_u64()),
                50,
                0,
            )
            .map_err(|error| error.to_string())?;
            let counts = &snapshot.counts;
            let items = snapshot.items.iter().map(|row| {
                let work = &row.work;
                json!({
                    "work_id": work.id.as_str(),
                    "project_id": work.project_id.as_str(),
                    "title": work.title,
                    "kind": format!("{:?}", work.kind).to_lowercase(),
                    "parent_id": work.parent_id.as_ref().map(|parent| parent.as_str()),
                    "lifecycle": format!("{:?}", work.lifecycle).to_lowercase(),
                    "display_status": format!("{:?}", row.status3_display_status()).to_lowercase(),
                    "status": format!("{:?}", row.display_status()).to_lowercase(),
                    "priority": work.priority,
                    "reason_codes": row.decision.reason_codes.iter().map(|reason| format!("{reason:?}")).collect::<Vec<_>>(),
                })
            }).collect::<Vec<_>>();
            let items_count = items.len() as u64;
            Ok(json!({
                "management_project_id": management_project_id,
                "project_id": identity,
                "path": root,
                "availability": "available",
                "revision": snapshot.project_revision.0,
                "as_of": stamp(snapshot.as_of.as_millis()),
                "counts": {
                    "total": snapshot.total, "draft": counts.draft, "queued": counts.queued,
                    "ready": counts.ready, "claimed": counts.claimed, "in_progress": counts.in_progress,
                    "needs_verification": counts.needs_verification, "awaiting_review": counts.awaiting_review,
                    "complete": counts.complete, "closed": counts.closed, "blocked": counts.blocked,
                    "paused": counts.paused, "retry_wait": counts.retry_wait, "expired_review": counts.expired_review,
                    "cancelled": counts.cancelled, "scheduled": counts.scheduled
                },
                "items": items,
                "items_total": snapshot.total,
                "items_has_more": snapshot.total > items_count,
                "items_limit": 50,
            }))
        })();
        let _ = sender.send(result);
    });
    receiver
        .recv_timeout(deadline.saturating_duration_since(Instant::now()))
        .map_err(|_| "workspace detail timed out".to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn global_path_uses_explicit_root_independent_of_cwd() {
        assert!(global_db_path().is_ok());
    }
}
