//! CLI adapter for the installation-wide personal manager.
//!
//! Global state has its own root and schema. These commands never infer or
//! open a project database from the current working directory.

use super::*;
use boreal_application::{
    create_global_backup, restore_global_backup, GlobalManagerApplication, GlobalManagerError,
    ResolvedWorkspaceIdentity, GLOBAL_BACKUP_CONTENTS,
};

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
            let capture_title = payload["title"].clone();
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
            if let Some(follow_up_at) = value("follow-up-at") {
                payload["follow_up_at"] = json!(follow_up_at);
            }
            if let Some(labels) = value("labels") {
                payload["labels"] = parse_labels(&labels)?;
            }
            let explicit_capture = parsed.options.project.is_none()
                && description().is_none()
                && value("parent").is_none()
                && parsed.options.priority.is_none()
                && value("due-at").is_none()
                && value("due").is_none()
                && value("follow-up-at").is_none()
                && value("labels").is_none();
            if value("source-ref").is_some() && !explicit_capture {
                return Err(CliError::invalid(
                    "global todo --source-ref requires an unstructured personal capture",
                ));
            }
            if explicit_capture {
                payload["capture_text"] = capture_title;
                if let Some(source_ref) = value("source-ref") {
                    payload["source_ref"] = json!(source_ref);
                }
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
            let filter = value("filter");
            let paged = filter.is_some()
                || parsed.options.limit.is_some()
                || parsed.options.offset.is_some();
            if paged {
                payload["filter"] = match filter.as_deref() {
                    Some(raw) => json!(parse_daily_filter(raw)?),
                    None => Value::Null,
                };
                payload["limit"] = json!(parsed.options.limit.unwrap_or(100));
                payload["offset"] = json!(parsed.options.offset.unwrap_or(0));
                "todo daily list".to_owned()
            } else {
                "todo list".to_owned()
            }
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
            if let Some(follow_up_at) = value("follow-up-at") {
                payload["follow_up_at"] = json!(follow_up_at);
            }
            if let Some(project) = parsed.options.project.clone() {
                payload["project_id"] = json!(project);
            }
            if let Some(parent) = value("parent") {
                payload["parent_id"] = json!(parent);
            }
            if options.contains_key("--clear-parent") {
                payload["parent_id"] = Value::Null;
            }
            if let Some(status) = value("status") {
                payload["status_id"] = json!(status);
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
            if let Some(follow_up_at) = value("follow-up-at") {
                payload["follow_up_at"] = json!(follow_up_at);
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
            if let Some(follow_up_at) = value("follow-up-at") {
                payload["follow_up_at"] = json!(follow_up_at);
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
        ["note", "link", "add"] | ["note", "link", "remove"] => {
            payload["note_id"] = json!(required(positional(0), "note link requires a note ID")?);
            payload["item_id"] = json!(required(positional(1), "note link requires an item ID")?);
            format!("note link {}", route[2])
        }
        ["note", "link", "list"] => {
            if let Some(project) = parsed.options.project.clone() {
                payload["project_id"] = json!(project);
            }
            "note link list".to_owned()
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
        ["linked", "show"] | ["linked", "page"] => {
            payload["project_id"] = json!(required(
                positional(0),
                "global linked show requires a management project ID"
            )?);
            payload["identity"] = json!(required(
                positional(1),
                "global linked show requires a linked workspace project ID"
            )?);
            if route[1] == "page" {
                if let Some(limit) = parsed.options.limit {
                    payload["limit"] = json!(limit);
                }
                if let Some(offset) = parsed.options.offset {
                    payload["offset"] = json!(offset);
                }
            }
            format!("linked {}", route[1])
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
        ["backup"] => {
            if let Some(destination) = value("out") {
                payload["path"] = json!(destination);
            }
            "backup".to_owned()
        }
        ["restore"] => {
            if !parsed.options.setup.yes {
                return Err(CliError::invalid(
                    "global restore requires --yes to confirm replacing the active database",
                ));
            }
            payload["path"] = json!(required(
                positional(0),
                "global restore requires a physical backup package path"
            )?);
            "restore".to_owned()
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
                format!("cannot read Global import document {}: {error}", source),
            )
        })?;
        let snapshot: Value = serde_json::from_slice(&bytes).map_err(|error| {
            CliError::invalid(format!("Global export document is invalid JSON: {error}"))
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
    if command == "export" && data.get("exported") != Some(&Value::Bool(true)) {
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

const GLOBAL_DETAIL_PAGE_SIZE: u64 = 200;
pub(crate) const GLOBAL_DISCOVERY_ROW_LIMIT: usize = 1000;

/// A bounded, revision-checked read over a detail-page collection. Global
/// summaries intentionally cap their arrays, so discovery and diagnostics
/// must use this read path when they need to account for every association.
pub(crate) struct GlobalDetailRead {
    pub(crate) rows: Vec<Value>,
    pub(crate) total: u64,
    pub(crate) revision: Option<u64>,
    pub(crate) observed_revision: Option<u64>,
    pub(crate) complete: bool,
    pub(crate) stale: bool,
    pub(crate) reason: Option<&'static str>,
}

pub(crate) fn read_global_detail_pages(
    app: &GlobalManagerApplication,
    collection: &str,
    operation: &str,
    row_limit: usize,
    include_archived: bool,
) -> Result<GlobalDetailRead, CliError> {
    if row_limit == 0 {
        return Err(CliError::invalid(
            "global detail read limit must be greater than zero",
        ));
    }

    let mut rows = Vec::new();
    let mut offset = 0u64;
    let mut revision = None;
    let mut observed_revision = None;
    let mut total = None;
    let mut reason = None;
    let mut stale = false;

    loop {
        let payload = json!({
            "collection": collection,
            "limit": GLOBAL_DETAIL_PAGE_SIZE,
            "offset": offset,
            "include_archived": include_archived,
        });
        let page = app
            .execute(
                "detail page",
                &payload,
                &format!("{operation}-detail-{collection}-{offset}"),
            )
            .map_err(global_error)?;
        let page_revision = page
            .get("revision")
            .and_then(Value::as_u64)
            .ok_or_else(|| CliError::invalid("global detail page omitted its revision"))?;
        if let Some(expected) = revision {
            if page_revision != expected {
                observed_revision = Some(page_revision);
                stale = true;
                reason = Some("global_revision_changed_during_enumeration");
                break;
            }
        } else {
            revision = Some(page_revision);
        }

        let page_total = page
            .get("total")
            .and_then(Value::as_u64)
            .ok_or_else(|| CliError::invalid("global detail page omitted its total"))?;
        if let Some(expected) = total {
            if page_total != expected {
                stale = true;
                reason = Some("global_total_changed_during_enumeration");
                break;
            }
        } else {
            total = Some(page_total);
        }

        let page_rows = page
            .get("rows")
            .and_then(Value::as_array)
            .ok_or_else(|| CliError::invalid("global detail page omitted its rows"))?;
        let remaining = row_limit.saturating_sub(rows.len());
        rows.extend(page_rows.iter().take(remaining).cloned());
        let has_more = page
            .get("has_more")
            .and_then(Value::as_bool)
            .ok_or_else(|| CliError::invalid("global detail page omitted has_more"))?;
        if rows.len() >= row_limit && page_total > rows.len() as u64 {
            reason = Some("configured_global_detail_limit_reached");
            break;
        }
        if !has_more {
            if rows.len() as u64 != page_total {
                reason = Some("global_detail_page_coverage_incomplete");
            }
            break;
        }
        if rows.len() >= row_limit {
            reason = Some("configured_global_detail_limit_reached");
            break;
        }
        let next_offset = page
            .get("next_offset")
            .and_then(Value::as_u64)
            .filter(|next| *next > offset && *next <= page_total);
        let Some(next_offset) = next_offset else {
            stale = true;
            reason = Some("global_detail_page_did_not_advance");
            break;
        };
        if page_rows.is_empty() {
            stale = true;
            reason = Some("global_detail_page_did_not_advance");
            break;
        }
        offset = next_offset;
    }

    let total = total.unwrap_or(0);
    let complete = !stale && reason.is_none() && rows.len() as u64 == total;
    if !complete && reason.is_none() {
        reason = Some("configured_global_detail_limit_reached");
    }
    Ok(GlobalDetailRead {
        rows,
        total,
        revision,
        observed_revision,
        complete,
        stale,
        reason,
    })
}

pub(crate) fn execute_request(
    command: &str,
    payload: &Value,
    operation: &str,
) -> Result<Value, CliError> {
    let path = ensure_global_root()?;
    if command == "backup" {
        let destination = match payload.get("path") {
            None => None,
            Some(Value::String(path)) => Some(Path::new(path)),
            Some(_) => return Err(CliError::invalid("Global backup path must be a string")),
        };
        let metadata = create_global_backup(&path, destination, operation).map_err(global_error)?;
        return Ok(json!({
            "operation_id": metadata.operation_id,
            "path": metadata.package_path.to_string_lossy(),
            "schema_id": metadata.schema_id,
            "schema_version": metadata.schema_version,
            "database_id": metadata.database_id,
            "revision": metadata.revision,
            "database_bytes": metadata.database_bytes,
            "database_checksum": metadata.database_checksum,
            "created_at": metadata.created_at,
            "validated": metadata.validated,
            "idempotent_readback": metadata.idempotent_readback,
            "contents": GLOBAL_BACKUP_CONTENTS,
        }));
    }
    if command == "restore" {
        let package = payload
            .get("path")
            .and_then(Value::as_str)
            .ok_or_else(|| CliError::invalid("Global restore package path must be a string"))?;
        let metadata =
            restore_global_backup(&path, Path::new(package), operation).map_err(global_error)?;
        return Ok(json!({
            "operation_id": metadata.operation_id,
            "path": metadata.database_path.to_string_lossy(),
            "package_path": metadata.package_path.to_string_lossy(),
            "source_database_id": metadata.source_database_id,
            "database_id": metadata.database_id,
            "revision": metadata.revision,
            "previous_database_path": metadata.previous_database_path.map(|path| path.to_string_lossy().into_owned()),
            "validated": metadata.validated,
            "idempotent_readback": metadata.idempotent_readback,
        }));
    }
    let app = GlobalManagerApplication::open(path).map_err(global_error)?;
    if command == "todo daily list" {
        return execute_daily_todo_list(&app, payload, operation);
    }
    if command == "export" {
        let data = app
            .execute(command, payload, operation)
            .map_err(global_error)?;
        if let Some(destination) = payload.get("path").and_then(Value::as_str) {
            write_export_path(destination, &data)?;
            let mut counts = serde_json::Map::new();
            for key in [
                "projects",
                "items",
                "notes",
                "statuses",
                "relationships",
                "note_links",
                "associations",
            ] {
                counts.insert(
                    key.to_owned(),
                    json!(data.get(key).and_then(Value::as_array).map_or(0, Vec::len)),
                );
            }
            return Ok(
                json!({"exported":true,"path":destination,"revision":data["revision"],"counts":counts}),
            );
        }
        return Ok(data);
    }
    if command == "linked job show" {
        let job_id = payload
            .get("job_id")
            .and_then(Value::as_str)
            .ok_or_else(|| CliError::invalid("linked job show requires job_id"))?;
        return linked_detail_job(job_id);
    }
    if command == "linked show" || command == "linked page" {
        let management_project_id = payload
            .get("project_id")
            .and_then(Value::as_str)
            .ok_or_else(|| CliError::invalid("linked show requires project_id"))?;
        let identity = payload
            .get("identity")
            .and_then(Value::as_str)
            .ok_or_else(|| CliError::invalid("linked show requires identity"))?;
        let association = app
            .execute(
                "association show",
                &json!({"project_id":management_project_id,"kind":"workspace","identity":identity}),
                &format!("{operation}-linked-show"),
            )
            .map_err(global_error)?;
        let stored_path = association
            .get("path")
            .and_then(Value::as_str)
            .ok_or_else(|| CliError::invalid("linked workspace association has no path"))?;
        let workspace_project_id = association
            .get("workspace_project_id")
            .and_then(Value::as_str)
            .unwrap_or(identity);
        let binding_key = association
            .get("workspace_binding_key")
            .and_then(Value::as_str)
            .unwrap_or("");
        let limit = payload
            .get("limit")
            .and_then(Value::as_u64)
            .unwrap_or(50)
            .clamp(1, 50);
        let offset = payload.get("offset").and_then(Value::as_u64).unwrap_or(0);
        let mut detail = linked_detail_page(
            management_project_id,
            workspace_project_id,
            binding_key,
            stored_path,
            limit,
            offset,
        )?;
        if let Some(total) = detail.get("items_total").and_then(Value::as_u64) {
            detail["total"] = json!(total);
        }
        return Ok(detail);
    }
    let mut result = app
        .execute_with_workspace_resolver(command, payload, operation, |path| {
            validate_workspace_binding(path).map_err(|error| error.message)
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
        result["linked_projects"] = json!(snapshot
            .get("linked_projects")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter(|row| row.get("management_project_id").and_then(Value::as_str) == Some(id))
            .collect::<Vec<_>>());
    }
    Ok(result)
}

const GLOBAL_DAILY_PAGE_SIZE: u64 = 200;

#[derive(Default)]
struct GlobalDailyPageRead {
    total: u64,
    revision: Option<u64>,
    civil_time: Option<Value>,
}

fn global_civil_time_identity(value: &Value) -> Result<(String, String, String), CliError> {
    Ok((
        value
            .get("system_civil_date")
            .and_then(Value::as_str)
            .ok_or_else(|| CliError::invalid("global daily page omitted its civil date"))?
            .to_owned(),
        value
            .get("timezone")
            .and_then(Value::as_str)
            .ok_or_else(|| CliError::invalid("global daily page omitted its timezone"))?
            .to_owned(),
        value
            .get("tzdb_identity")
            .and_then(Value::as_str)
            .ok_or_else(|| CliError::invalid("global daily page omitted its timezone identity"))?
            .to_owned(),
    ))
}

fn visit_global_detail_pages(
    app: &GlobalManagerApplication,
    collection: &str,
    operation: &str,
    project_id: Option<&str>,
    include_archived: bool,
    expected_revision: Option<u64>,
    require_stable_civil_time: bool,
    mut visit: impl FnMut(&Value) -> Result<(), CliError>,
) -> Result<GlobalDailyPageRead, CliError> {
    let mut read = GlobalDailyPageRead::default();
    let mut offset = 0_u64;
    let mut expected_total = None;
    let mut expected_revision = expected_revision;
    let mut civil_identity: Option<(String, String, String)> = None;

    loop {
        let mut payload = json!({
            "collection": collection,
            "limit": GLOBAL_DAILY_PAGE_SIZE,
            "offset": offset,
            "include_archived": include_archived,
        });
        if let Some(project_id) = project_id {
            payload["project_id"] = json!(project_id);
        }
        if let Some(expected_revision) = expected_revision {
            payload["expected_revision"] = json!(expected_revision);
        }
        let page = app
            .execute(
                "detail page",
                &payload,
                &format!("{operation}-daily-{collection}-{offset}"),
            )
            .map_err(global_error)?;
        let page_revision = page
            .get("revision")
            .and_then(Value::as_u64)
            .ok_or_else(|| CliError::invalid("global daily page omitted its revision"))?;
        if page.get("resnapshot_required").and_then(Value::as_bool) == Some(true)
            || expected_revision.is_some_and(|expected| expected != page_revision)
        {
            return Err(CliError::with(
                ErrorCode::RevisionConflict,
                ApplicationOutcome::Conflict,
                format!("Global revision changed while reading {collection}; rerun the command"),
            ));
        }
        if let Some(previous) = read.revision {
            if previous != page_revision {
                return Err(CliError::with(
                    ErrorCode::RevisionConflict,
                    ApplicationOutcome::Conflict,
                    format!(
                        "Global revision changed while reading {collection}; rerun the command"
                    ),
                ));
            }
        } else {
            read.revision = Some(page_revision);
        }
        expected_revision = Some(page_revision);

        let page_offset = page
            .get("offset")
            .and_then(Value::as_u64)
            .ok_or_else(|| CliError::invalid("global daily page omitted its offset"))?;
        if page_offset != offset {
            return Err(CliError::invalid(
                "global daily page returned an unexpected offset",
            ));
        }
        let page_total = page
            .get("total")
            .and_then(Value::as_u64)
            .ok_or_else(|| CliError::invalid("global daily page omitted its total"))?;
        if expected_total.is_some_and(|total| total != page_total) {
            return Err(CliError::with(
                ErrorCode::RevisionConflict,
                ApplicationOutcome::Conflict,
                format!("Global {collection} total changed within one revision"),
            ));
        }
        expected_total = Some(page_total);
        read.total = page_total;

        let civil_time = page.get("civil_time").filter(|value| value.is_object());
        if require_stable_civil_time {
            let civil_time = civil_time.ok_or_else(|| {
                CliError::invalid("global daily page omitted application civil-time policy")
            })?;
            let identity = global_civil_time_identity(civil_time)?;
            if civil_identity
                .as_ref()
                .is_some_and(|expected| expected != &identity)
            {
                return Err(CliError::with(
                    ErrorCode::RevisionConflict,
                    ApplicationOutcome::Conflict,
                    "system civil-time context changed while reading Global items; rerun the command",
                ));
            }
            civil_identity = Some(identity);
        }
        if read.civil_time.is_none() {
            read.civil_time = civil_time.cloned();
        }

        let rows = page
            .get("rows")
            .and_then(Value::as_array)
            .ok_or_else(|| CliError::invalid("global daily page omitted its rows"))?;
        if rows.len() as u64 > GLOBAL_DAILY_PAGE_SIZE {
            return Err(CliError::invalid(
                "global daily page exceeded the requested row bound",
            ));
        }
        for row in rows {
            visit(row)?;
        }
        let next_offset = page.get("next_offset").and_then(Value::as_u64);
        let has_more = page
            .get("has_more")
            .and_then(Value::as_bool)
            .ok_or_else(|| CliError::invalid("global daily page omitted has_more"))?;
        match (has_more, next_offset) {
            (false, None) if offset.saturating_add(rows.len() as u64) == page_total => break,
            (true, Some(next))
                if !rows.is_empty()
                    && next == offset.saturating_add(rows.len() as u64)
                    && next > offset
                    && next < page_total =>
            {
                offset = next;
            }
            _ => {
                return Err(CliError::invalid(
                    "global daily page returned an invalid continuation cursor",
                ));
            }
        }
    }
    Ok(read)
}

fn execute_daily_todo_list(
    app: &GlobalManagerApplication,
    payload: &Value,
    operation: &str,
) -> Result<Value, CliError> {
    let filter = match payload.get("filter") {
        Some(Value::String(raw)) => Some(parse_daily_filter(raw)?),
        Some(Value::Null) | None => None,
        Some(_) => return Err(CliError::invalid("daily filter must be a string or null")),
    };
    let limit = payload.get("limit").and_then(Value::as_u64).unwrap_or(100);
    if !(1..=100).contains(&limit) {
        return Err(CliError::invalid(
            "global todo page limit must be from 1 to 100",
        ));
    }
    let offset = payload.get("offset").and_then(Value::as_u64).unwrap_or(0);
    if payload
        .get("offset")
        .is_some_and(|value| value.as_u64().is_none())
    {
        return Err(CliError::invalid(
            "global todo page offset must be a non-negative integer",
        ));
    }
    let project_id = match payload.get("project_id") {
        Some(Value::String(project_id)) if !project_id.trim().is_empty() => {
            Some(project_id.as_str())
        }
        Some(Value::String(_)) => {
            return Err(CliError::invalid("project_id must not be empty"));
        }
        Some(Value::Null) | None => None,
        Some(_) => return Err(CliError::invalid("project_id must be a string or null")),
    };
    let include_archived = payload
        .get("include_archived")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    let mut statuses = std::collections::BTreeMap::<(Option<String>, String), String>::new();
    let status_read = if filter.is_some() {
        Some(visit_global_detail_pages(
            app,
            "statuses",
            operation,
            project_id,
            include_archived,
            None,
            true,
            |status| {
                let status_id = status
                    .get("status_id")
                    .and_then(Value::as_str)
                    .ok_or_else(|| CliError::invalid("Global status omitted its ID"))?;
                let owner = status
                    .get("project_id")
                    .and_then(Value::as_str)
                    .map(str::to_owned);
                let category = status
                    .get("category")
                    .and_then(Value::as_str)
                    .unwrap_or("open");
                statuses.insert((owner, status_id.to_owned()), category.to_owned());
                Ok(())
            },
        )?)
    } else {
        None
    };
    let expected_revision = status_read.as_ref().and_then(|read| read.revision);
    let mut matching_total = 0_u64;
    let mut matching_rows = Vec::new();
    let item_read = visit_global_detail_pages(
        app,
        "items",
        operation,
        project_id,
        include_archived,
        expected_revision,
        filter.is_some(),
        |item| {
            let status_category = item
                .get("status_id")
                .and_then(Value::as_str)
                .and_then(|status_id| {
                    let owner = item
                        .get("project_id")
                        .and_then(Value::as_str)
                        .map(str::to_owned);
                    statuses.get(&(owner, status_id.to_owned()))
                })
                .map(String::as_str);
            let is_open = !matches!(status_category, Some("completed" | "cancelled"));
            let filter_match = match filter {
                None => true,
                Some(filter) => {
                    let flags = item
                        .get("daily_classification")
                        .and_then(|classification| classification.get("filters"))
                        .and_then(Value::as_object)
                        .ok_or_else(|| {
                            CliError::invalid(
                                "Global item omitted application daily-classification flags",
                            )
                        })?;
                    flags.get(filter).and_then(Value::as_bool) == Some(true)
                }
            };
            if filter_match && (filter.is_none() || is_open) {
                if matching_total >= offset && matching_rows.len() < limit as usize {
                    matching_rows.push(item.clone());
                }
                matching_total = matching_total.saturating_add(1);
            }
            Ok(())
        },
    )?;
    if status_read
        .as_ref()
        .is_some_and(|status| status.revision != item_read.revision)
    {
        return Err(CliError::with(
            ErrorCode::RevisionConflict,
            ApplicationOutcome::Conflict,
            "Global revision changed between status and item reads; rerun the command",
        ));
    }
    if let (Some(status_time), Some(item_time)) = (
        status_read
            .as_ref()
            .and_then(|read| read.civil_time.as_ref()),
        item_read.civil_time.as_ref(),
    ) {
        if global_civil_time_identity(status_time)? != global_civil_time_identity(item_time)? {
            return Err(CliError::with(
                ErrorCode::RevisionConflict,
                ApplicationOutcome::Conflict,
                "system civil-time context changed while reading Global items; rerun the command",
            ));
        }
    }
    let has_more = offset.saturating_add(matching_rows.len() as u64) < matching_total;
    let next_offset = has_more.then(|| offset.saturating_add(matching_rows.len() as u64));
    let filter_name = filter.map(|value| match value {
        "all_open" => "all-open",
        other => other,
    });
    Ok(json!({
        "collection": "items",
        "filter": filter_name,
        "rows": matching_rows,
        "total": matching_total,
        "source_total": item_read.total,
        "limit": limit,
        "offset": offset,
        "has_more": has_more,
        "next_offset": next_offset,
        "revision": item_read.revision,
        "civil_time": item_read.civil_time.or_else(|| status_read.and_then(|read| read.civil_time)),
    }))
}

pub(crate) fn write_export(
    options: &std::collections::BTreeMap<String, Vec<String>>,
    data: &Value,
) -> Result<(), CliError> {
    let Some(path) = options.get("--out").and_then(|values| values.last()) else {
        return Ok(());
    };
    write_export_path(path, data)
}

fn write_export_path(path: &str, data: &Value) -> Result<(), CliError> {
    let path = PathBuf::from(path);
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|error| {
                CliError::invalid(format!("cannot create export directory: {error}"))
            })?;
        }
    }
    let database = fs::canonicalize(global_db_path()?).map_err(|error| {
        CliError::invalid(format!("cannot resolve canonical global database: {error}"))
    })?;
    let absolute = if path.is_absolute() {
        path.clone()
    } else {
        env::current_dir()
            .map_err(|error| CliError::invalid(format!("cannot resolve export path: {error}")))?
            .join(&path)
    };
    let parent = absolute.parent().unwrap_or(Path::new("."));
    let canonical_parent = fs::canonicalize(parent)
        .map_err(|error| CliError::invalid(format!("cannot resolve export directory: {error}")))?;
    let destination = canonical_parent.join(
        absolute
            .file_name()
            .ok_or_else(|| CliError::invalid("global export destination must name a file"))?,
    );
    let canonical_destination =
        fs::canonicalize(&destination).unwrap_or_else(|_| destination.clone());
    if canonical_destination == database {
        return Err(CliError::invalid(
            "global export destination cannot replace the canonical SQLite database",
        ));
    }
    let encoded = serde_json::to_vec_pretty(data)
        .map_err(|error| CliError::invalid(format!("cannot encode global export: {error}")))?;
    let file_name = destination.file_name().unwrap().to_string_lossy();
    let (temp, mut file) = (0..16)
        .find_map(|_| {
            let nonce = LINKED_JOB_COUNTER.fetch_add(1, Ordering::Relaxed);
            let candidate =
                canonical_parent.join(format!(".{file_name}.{}.{}.tmp", std::process::id(), nonce));
            let mut options = fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            options.open(&candidate).ok().map(|file| (candidate, file))
        })
        .ok_or_else(|| {
            CliError::with(
                ErrorCode::ServiceUnavailable,
                ApplicationOutcome::Failed,
                "cannot create a unique private global export temp file",
            )
        })?;
    use std::io::Write;
    let write_result = file.write_all(&encoded).and_then(|_| file.sync_all());
    drop(file);
    if let Err(error) = write_result {
        let _ = fs::remove_file(&temp);
        return Err(CliError::with(
            ErrorCode::ServiceUnavailable,
            ApplicationOutcome::Failed,
            format!("cannot write global export: {error}"),
        ));
    }
    fs::rename(&temp, &destination).map_err(|error| {
        let _ = fs::remove_file(&temp);
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

/// A backup does not mutate canonical Global state, but it publishes a local
/// artifact and therefore needs unknown-delivery handling if the service
/// response is lost.
pub(crate) fn may_have_delivery_effect(command: &str) -> bool {
    is_mutation(command) || command == "backup"
}

fn is_mutation(command: &str) -> bool {
    !matches!(
        command,
        "snapshot"
            | "project list"
            | "project show"
            | "todo list"
            | "todo daily list"
            | "todo show"
            | "note list"
            | "note link list"
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
            | "linked page"
            | "linked job show"
            | "backup"
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

fn parse_daily_filter(raw: &str) -> Result<&'static str, CliError> {
    match raw {
        "today" => Ok("today"),
        "overdue" => Ok("overdue"),
        "waiting" => Ok("waiting"),
        "unscheduled" => Ok("unscheduled"),
        "all-open" | "all_open" => Ok("all_open"),
        _ => Err(CliError::invalid(
            "--filter must be today, overdue, waiting, unscheduled, or all-open",
        )),
    }
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
    #[serde(default)]
    operator_session: Option<String>,
}

pub(crate) fn validate_workspace(input: &str) -> Result<(String, String), CliError> {
    let workspace = validate_workspace_details(input)?;
    Ok((
        workspace.project_id,
        workspace.root.to_string_lossy().into_owned(),
    ))
}

struct ValidatedWorkspace {
    project_id: String,
    root: PathBuf,
    operator_actor: Option<String>,
    operator_session: Option<String>,
    database_instance_id: String,
    restore_epoch: u64,
    workspace_binding_digest: String,
    store: SqliteStore,
}

impl ValidatedWorkspace {
    fn resolved_identity(&self) -> ResolvedWorkspaceIdentity {
        ResolvedWorkspaceIdentity {
            project_id: self.project_id.clone(),
            path: self.root.to_string_lossy().into_owned(),
            database_instance_id: self.database_instance_id.clone(),
            restore_epoch: self.restore_epoch,
            workspace_binding_digest: self.workspace_binding_digest.clone(),
        }
    }

    fn physical_binding_key(&self) -> String {
        self.resolved_identity().physical_binding_key()
    }
}

pub(crate) fn validate_workspace_binding(
    input: &str,
) -> Result<ResolvedWorkspaceIdentity, CliError> {
    Ok(validate_workspace_details(input)?.resolved_identity())
}

/// Reads one fresh advisory candidate from the same validated store whose
/// physical binding is compared with the persisted link identity.
pub(crate) fn fresh_linked_candidate(
    root: &str,
    expected_project: &str,
    expected_binding_key: &str,
) -> Result<Value, CliError> {
    let workspace = validate_workspace_details(root)?;
    if expected_binding_key.is_empty()
        || workspace.project_id != expected_project
        || workspace.physical_binding_key() != expected_binding_key
    {
        return Err(CliError::invalid(
            "linked workspace physical identity changed",
        ));
    }
    let actor = workspace
        .operator_actor
        .as_deref()
        .ok_or_else(|| CliError::invalid("workspace has no registered local operator"))?;
    let session = workspace
        .operator_session
        .as_deref()
        .ok_or_else(|| CliError::invalid("workspace has no registered local operator session"))?;
    validate_linked_operator_session(&workspace.store, expected_project, actor, session)?;
    let role = workspace
        .store
        .principal_authority(expected_project, actor)
        .map_err(map_store_error)?
        .0;
    let snapshot = boreal_application::discover_work(
        &workspace.store,
        &ProjectId::new(expected_project),
        &boreal_domain::ActorContext {
            actor_id: ActorId::new(actor),
            role,
        },
        Some(session),
        TimestampMs::from_millis(now_ms_u64()),
    )
    .map_err(CliError::invalid)?;
    validate_linked_operator_session(&workspace.store, expected_project, actor, session)?;
    let current_revision = workspace
        .store
        .project_revision(expected_project)
        .map_err(map_store_error)?
        .0;
    if current_revision != snapshot.revision.0 {
        return Err(CliError::invalid(
            "workspace changed during advisory discovery",
        ));
    }
    let Some(item) = snapshot
        .items
        .iter()
        .find(|item| item.claimable_for_actor())
    else {
        return Ok(json!({
            "workspace_id": expected_project,
            "project_revision": snapshot.revision.0,
            "state": "idle_or_blocked"
        }));
    };
    Ok(json!({
        "workspace_id": expected_project,
        "working_directory": workspace.root,
        "project_revision": snapshot.revision.0,
        "as_of": stamp(now_ms_u64()),
        "work_id": item.work.id.as_str(),
        "title": item.work.title,
        "priority": item.work.priority,
        "safe_argv": ["bwrk", "prime", "--project", expected_project, "--json"],
        "authority": "advisory_snapshot_only"
    }))
}

fn validate_linked_operator_session(
    store: &SqliteStore,
    project: &str,
    actor: &str,
    session_id: &str,
) -> Result<(), CliError> {
    let session = store
        .session(project, session_id)
        .map_err(map_store_error)?
        .ok_or_else(|| CliError::invalid("workspace operator session does not exist"))?;
    if session.registration_operation_id.is_none() || session.project_id != project {
        return Err(CliError::invalid(
            "workspace operator session is not bound to this project",
        ));
    }
    if session.actor_id != actor {
        return Err(CliError::invalid(
            "workspace operator session is bound to a different actor",
        ));
    }
    if session.state != boreal_store::SessionState::Active {
        return Err(CliError::invalid(
            "workspace operator session is not active",
        ));
    }
    store
        .validate_project_session(project, actor, session_id)
        .map_err(map_store_error)
}

fn validate_workspace_details(input: &str) -> Result<ValidatedWorkspace, CliError> {
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
    let database_identity = identities.database_identity().map_err(app_error)?;
    let identity = identities
        .context(&metadata.project_id)
        .map_err(app_error)?;
    let binding = identities
        .workspace_binding(&metadata.project_id)
        .map_err(app_error)?;
    if identity.database_instance_id != database_identity.database_instance_id
        || identity.restore_epoch != database_identity.restore_epoch
        || identity.workspace_binding_digest != binding.binding_digest()
    {
        return Err(CliError::with(
            ErrorCode::OperationConflict,
            ApplicationOutcome::Rejected,
            "workspace identity does not match its database",
        ));
    }
    Ok(ValidatedWorkspace {
        project_id: metadata.project_id,
        root,
        operator_actor: metadata
            .operator_actor
            .filter(|actor| !actor.trim().is_empty()),
        operator_session: metadata
            .operator_session
            .filter(|session| !session.trim().is_empty()),
        database_instance_id: database_identity.database_instance_id.to_string(),
        restore_epoch: database_identity.restore_epoch.get(),
        workspace_binding_digest: binding.binding_digest().to_owned(),
        store,
    })
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

const LINKED_POOL_WORKERS: usize = 8;
const LINKED_POOL_QUEUE: usize = 64;
const LINKED_REFRESH_BUDGET: std::time::Duration = std::time::Duration::from_millis(75);
const LINKED_JOB_BUDGET: std::time::Duration = std::time::Duration::from_secs(3);
const LINKED_DETAIL_RETENTION: std::time::Duration = std::time::Duration::from_secs(300);
const LINKED_DETAIL_RESULT_CAPACITY: usize = 128;
static LINKED_JOB_COUNTER: AtomicU64 = AtomicU64::new(1);

struct LinkedRefreshJob {
    key: LinkedRollupKey,
    workspace_project_id: String,
    binding_key: String,
    path: String,
    queued_at: Instant,
    deadline: Instant,
    kind: LinkedRefreshKind,
}

enum LinkedRefreshKind {
    Rollup,
    Detail {
        management_project_id: String,
        limit: u64,
        offset: u64,
        job_id: String,
    },
    #[cfg(test)]
    Block {
        job_id: String,
        started: std::sync::mpsc::Sender<()>,
        release: std::sync::mpsc::Receiver<()>,
        fail: bool,
    },
    #[cfg(test)]
    BlockRollup {
        started: std::sync::mpsc::Sender<()>,
        release: std::sync::mpsc::Receiver<()>,
    },
}

type LinkedRollupKey = (String, String, String);
type LinkedDetailKey = (String, String, String, String, u64, u64);

#[derive(Debug)]
pub(crate) enum LinkedWorkspaceReadError {
    IdentityMismatch(String),
    Unavailable(String),
}

impl LinkedWorkspaceReadError {
    fn message(&self) -> &str {
        match self {
            Self::IdentityMismatch(message) | Self::Unavailable(message) => message,
        }
    }
}

struct LinkedDetailRecord {
    key: LinkedDetailKey,
    page: Option<Value>,
    error: Option<String>,
    pool_wait_ms: Option<u64>,
    refresh_duration_ms: Option<u64>,
    changed_at: Instant,
}

#[derive(Default)]
struct LinkedRefreshState {
    pending: std::collections::HashSet<LinkedRollupKey>,
    rows: std::collections::HashMap<LinkedRollupKey, Value>,
    details: std::collections::HashMap<String, LinkedDetailRecord>,
}

struct LinkedRefreshPool {
    sender: std::sync::mpsc::SyncSender<LinkedRefreshJob>,
    state: std::sync::Arc<std::sync::Mutex<LinkedRefreshState>>,
    changed: std::sync::Arc<std::sync::Condvar>,
}

static LINKED_REFRESH_POOL: std::sync::OnceLock<LinkedRefreshPool> = std::sync::OnceLock::new();

fn preserve_linked_sample_on_error(
    previous: Option<Value>,
    failure: Value,
    now_ms: u64,
    pool_wait_ms: u64,
    refresh_duration_ms: u64,
) -> Value {
    if failure["availability"] != "unavailable" {
        return failure;
    }
    let Some(mut previous) =
        previous.filter(|row| matches!(row["availability"].as_str(), Some("available" | "stale")))
    else {
        return failure;
    };
    let sampled_at = previous["_sampled_at_ms"].as_u64().unwrap_or(now_ms);
    previous["availability"] = json!("stale");
    previous["sample_age_ms"] = json!(now_ms.saturating_sub(sampled_at));
    previous["pool_wait_ms"] = json!(pool_wait_ms);
    previous["refresh_duration_ms"] = json!(refresh_duration_ms);
    previous["error"] = failure["error"].clone();
    previous
}

fn linked_refresh_pool() -> &'static LinkedRefreshPool {
    LINKED_REFRESH_POOL.get_or_init(new_linked_refresh_pool)
}

fn new_linked_refresh_pool() -> LinkedRefreshPool {
    let (sender, receiver) = std::sync::mpsc::sync_channel::<LinkedRefreshJob>(LINKED_POOL_QUEUE);
    let receiver = std::sync::Arc::new(std::sync::Mutex::new(receiver));
    let state = std::sync::Arc::new(std::sync::Mutex::new(LinkedRefreshState::default()));
    let changed = std::sync::Arc::new(std::sync::Condvar::new());
    let pool = LinkedRefreshPool {
        sender,
        state: state.clone(),
        changed: changed.clone(),
    };
    for _ in 0..LINKED_POOL_WORKERS {
        let receiver = receiver.clone();
        let state = state.clone();
        let changed = changed.clone();
        std::thread::spawn(move || {
            loop {
                let job = match receiver
                    .lock()
                    .expect("linked job receiver poisoned")
                    .recv()
                {
                    Ok(job) => job,
                    Err(_) => break,
                };
                let queued_at = job.queued_at;
                let deadline = job.deadline;
                match job.kind {
                    LinkedRefreshKind::Rollup => {
                        let started = Instant::now();
                        let pool_wait_ms =
                            started.saturating_duration_since(queued_at).as_millis() as u64;
                        let result = linked_workspace_rollup(
                            &job.workspace_project_id,
                            &job.binding_key,
                            &job.path,
                            deadline,
                        );
                        let now = now_ms_u64();
                        let refresh_duration_ms = started.elapsed().as_millis() as u64;
                        let identity_mismatch =
                            matches!(&result, Err(LinkedWorkspaceReadError::IdentityMismatch(_)));
                        let row = match result {
                            Ok(value) => {
                                json!({"project_id":job.workspace_project_id,"path":job.path,"availability":"available","revision":value["revision"],"as_of":value["as_of"],"sample_age_ms":now.saturating_sub(value["as_of_ms"].as_u64().unwrap_or(now)),"_sampled_at_ms":value["as_of_ms"],"pool_wait_ms":pool_wait_ms,"refresh_duration_ms":refresh_duration_ms,"counts":value["counts"],"error":null})
                            }
                            Err(error) => {
                                json!({"project_id":job.workspace_project_id,"path":job.path,"availability":"unavailable","revision":null,"as_of":null,"sample_age_ms":null,"pool_wait_ms":pool_wait_ms,"refresh_duration_ms":refresh_duration_ms,"counts":null,"error":error.message()})
                            }
                        };
                        let mut state = state.lock().expect("linked cache poisoned");
                        state.pending.remove(&job.key);
                        let row = if identity_mismatch {
                            row
                        } else {
                            preserve_linked_sample_on_error(
                                state.rows.get(&job.key).cloned(),
                                row,
                                now,
                                pool_wait_ms,
                                refresh_duration_ms,
                            )
                        };
                        state.rows.insert(job.key, row);
                        changed.notify_all();
                    }
                    #[cfg(test)]
                    LinkedRefreshKind::BlockRollup {
                        started: signal,
                        release,
                    } => {
                        let started = Instant::now();
                        let pool_wait_ms =
                            started.saturating_duration_since(queued_at).as_millis() as u64;
                        let _ = signal.send(());
                        let _ = release.recv();
                        let result = if Instant::now() >= deadline {
                            Err("linked workspace read deadline expired".to_owned())
                        } else {
                            Ok(
                                json!({"revision":9,"as_of":"test","as_of_ms":now_ms_u64(),"counts":{"total":9}}),
                            )
                        };
                        let now = now_ms_u64();
                        let refresh_duration_ms = started.elapsed().as_millis() as u64;
                        let row = match result {
                            Ok(value) => {
                                json!({"project_id":job.key.1,"path":job.path,"availability":"available","revision":value["revision"],"as_of":value["as_of"],"sample_age_ms":now.saturating_sub(value["as_of_ms"].as_u64().unwrap_or(now)),"_sampled_at_ms":value["as_of_ms"],"pool_wait_ms":pool_wait_ms,"refresh_duration_ms":refresh_duration_ms,"counts":value["counts"],"error":null})
                            }
                            Err(error) => {
                                json!({"project_id":job.key.1,"path":job.path,"availability":"unavailable","revision":null,"as_of":null,"sample_age_ms":null,"pool_wait_ms":pool_wait_ms,"refresh_duration_ms":refresh_duration_ms,"counts":null,"error":error})
                            }
                        };
                        let mut state = state.lock().expect("linked cache poisoned");
                        state.pending.remove(&job.key);
                        let row = preserve_linked_sample_on_error(
                            state.rows.get(&job.key).cloned(),
                            row,
                            now,
                            pool_wait_ms,
                            refresh_duration_ms,
                        );
                        state.rows.insert(job.key, row);
                        changed.notify_all();
                    }
                    LinkedRefreshKind::Detail {
                        management_project_id,
                        limit,
                        offset,
                        job_id,
                    } => {
                        let started = Instant::now();
                        let pool_wait_ms =
                            started.saturating_duration_since(queued_at).as_millis() as u64;
                        let result = linked_workspace_detail(
                            &management_project_id,
                            &job.workspace_project_id,
                            &job.binding_key,
                            &job.path,
                            limit,
                            offset,
                            deadline,
                        )
                        .map(|mut page| {
                            let items = page
                                .get("items")
                                .and_then(Value::as_array)
                                .cloned()
                                .unwrap_or_default();
                            let total =
                                page.get("items_total").and_then(Value::as_u64).unwrap_or(0);
                            let next = offset.saturating_add(items.len() as u64);
                            page["limit"] = json!(limit);
                            page["offset"] = json!(offset);
                            page["has_more"] = json!(next < total);
                            page["next_offset"] = if next < total {
                                json!(next)
                            } else {
                                Value::Null
                            };
                            page["job_id"] = Value::Null;
                            page["pool_wait_ms"] = json!(pool_wait_ms);
                            page["refresh_duration_ms"] =
                                json!(started.elapsed().as_millis() as u64);
                            page
                        });
                        let refresh_duration_ms = started.elapsed().as_millis() as u64;
                        let mut state = state.lock().expect("linked cache poisoned");
                        if let Some(record) = state.details.get_mut(&job_id) {
                            match result {
                                Ok(page) => {
                                    record.page = Some(page);
                                    record.error = None;
                                }
                                Err(error) => {
                                    record.error = Some(error.message().to_owned());
                                    record.page = None;
                                }
                            }
                            record.pool_wait_ms = Some(pool_wait_ms);
                            record.refresh_duration_ms = Some(refresh_duration_ms);
                            record.changed_at = Instant::now();
                        }
                        changed.notify_all();
                    }
                    #[cfg(test)]
                    LinkedRefreshKind::Block {
                        job_id,
                        started,
                        release,
                        fail,
                    } => {
                        let _ = started.send(());
                        let _ = release.recv();
                        let mut state = state.lock().expect("linked cache poisoned");
                        if let Some(record) = state.details.get_mut(&job_id) {
                            if fail {
                                record.error = Some("synthetic detail failure".into());
                            } else {
                                record.page = Some(
                                    json!({"availability":"available","items":[],"items_total":0,"total":0,"revision":7,"as_of":"test","job_id":null}),
                                );
                            }
                            record.pool_wait_ms = Some(
                                Instant::now()
                                    .saturating_duration_since(queued_at)
                                    .as_millis() as u64,
                            );
                            record.refresh_duration_ms = Some(0);
                            record.changed_at = Instant::now();
                        }
                        changed.notify_all();
                    }
                }
            }
        });
    }
    pool
}

fn prune_linked_detail_results(state: &mut LinkedRefreshState, now: Instant) {
    state.details.retain(|_, record| {
        (record.page.is_none() && record.error.is_none())
            || now.saturating_duration_since(record.changed_at) <= LINKED_DETAIL_RETENTION
    });
    let mut finished = state
        .details
        .iter()
        .filter(|(_, record)| record.page.is_some() || record.error.is_some())
        .map(|(id, record)| (id.clone(), record.changed_at))
        .collect::<Vec<_>>();
    if finished.len() > LINKED_DETAIL_RESULT_CAPACITY {
        finished.sort_by_key(|(_, changed_at)| *changed_at);
        for (id, _) in finished.into_iter().take(
            state
                .details
                .len()
                .saturating_sub(LINKED_DETAIL_RESULT_CAPACITY),
        ) {
            state.details.remove(&id);
        }
    }
}

fn schedule_linked_detail(
    pool: &LinkedRefreshPool,
    key: LinkedDetailKey,
    management_project_id: String,
    path: String,
) -> Result<String, CliError> {
    let mut state = pool.state.lock().expect("linked cache poisoned");
    prune_linked_detail_results(&mut state, Instant::now());
    if let Some((job_id, _)) = state
        .details
        .iter()
        .find(|(_, record)| record.key == key && record.page.is_none() && record.error.is_none())
    {
        return Ok(job_id.clone());
    }
    let job_id = format!(
        "linked-job-{}-{}",
        std::process::id(),
        LINKED_JOB_COUNTER.fetch_add(1, Ordering::Relaxed)
    );
    let (project_id, identity, binding_key, _, limit, offset) = key.clone();
    let queued_at = Instant::now();
    state.details.insert(
        job_id.clone(),
        LinkedDetailRecord {
            key: key.clone(),
            page: None,
            error: None,
            pool_wait_ms: None,
            refresh_duration_ms: None,
            changed_at: queued_at,
        },
    );
    let job = LinkedRefreshJob {
        key: (project_id, identity.clone(), binding_key.clone()),
        workspace_project_id: identity,
        binding_key,
        path,
        queued_at,
        deadline: queued_at + LINKED_JOB_BUDGET,
        kind: LinkedRefreshKind::Detail {
            management_project_id,
            limit,
            offset,
            job_id: job_id.clone(),
        },
    };
    if pool.sender.try_send(job).is_err() {
        state.details.remove(&job_id);
        return Err(CliError::with(
            ErrorCode::ServiceUnavailable,
            ApplicationOutcome::Failed,
            "linked detail worker queue is full; retry the page request",
        ));
    }
    Ok(job_id)
}

fn linked_detail_page(
    management_project_id: &str,
    identity: &str,
    binding_key: &str,
    path: &str,
    limit: u64,
    offset: u64,
) -> Result<Value, CliError> {
    let pool = linked_refresh_pool();
    let key = (
        management_project_id.to_owned(),
        identity.to_owned(),
        binding_key.to_owned(),
        path.to_owned(),
        limit,
        offset,
    );
    let job_id =
        schedule_linked_detail(pool, key, management_project_id.to_owned(), path.to_owned())?;
    let deadline = Instant::now() + LINKED_REFRESH_BUDGET;
    let mut state = pool.state.lock().expect("linked cache poisoned");
    while state
        .details
        .get(&job_id)
        .is_some_and(|record| record.page.is_none() && record.error.is_none())
        && Instant::now() < deadline
    {
        let (next, timeout) = pool
            .changed
            .wait_timeout(state, deadline.saturating_duration_since(Instant::now()))
            .expect("linked cache poisoned");
        state = next;
        if timeout.timed_out() {
            break;
        }
    }
    let record = state.details.get(&job_id).ok_or_else(|| {
        CliError::with(
            ErrorCode::NotFound,
            ApplicationOutcome::Rejected,
            "linked detail job expired",
        )
    })?;
    if let Some(page) = &record.page {
        return Ok(page.clone());
    }
    let error = record.error.clone();
    Ok(
        json!({"management_project_id":management_project_id,"project_id":identity,"path":path,"availability":if error.is_some(){"unavailable"}else{"refreshing"},"job_id":job_id,"revision":null,"as_of":null,"counts":null,"items":[],"items_total":null,"items_has_more":null,"limit":limit,"offset":offset,"has_more":null,"next_offset":null,"error":error}),
    )
}

fn linked_detail_job(job_id: &str) -> Result<Value, CliError> {
    linked_detail_job_from_pool(linked_refresh_pool(), job_id)
}

fn linked_detail_job_from_pool(pool: &LinkedRefreshPool, job_id: &str) -> Result<Value, CliError> {
    let mut state = pool.state.lock().expect("linked cache poisoned");
    prune_linked_detail_results(&mut state, Instant::now());
    let record = state.details.get(job_id).ok_or_else(|| {
        CliError::with(
            ErrorCode::NotFound,
            ApplicationOutcome::Rejected,
            "linked detail job was not found or has expired",
        )
    })?;
    if let Some(error) = &record.error {
        return Ok(
            json!({"job_id":job_id,"state":"failed","page":null,"error":error,"pool_wait_ms":record.pool_wait_ms,"refresh_duration_ms":record.refresh_duration_ms}),
        );
    }
    if let Some(page) = &record.page {
        return Ok(
            json!({"job_id":job_id,"state":"complete","page":page,"error":null,"pool_wait_ms":record.pool_wait_ms,"refresh_duration_ms":record.refresh_duration_ms}),
        );
    }
    Ok(
        json!({"job_id":job_id,"state":"refreshing","page":null,"error":null,"pool_wait_ms":null,"refresh_duration_ms":null}),
    )
}

fn enrich_snapshot(snapshot: &mut Value) {
    enrich_snapshot_with_pool(snapshot, linked_refresh_pool());
}

fn enrich_snapshot_with_pool(snapshot: &mut Value, pool: &LinkedRefreshPool) {
    let associations = snapshot
        .get("associations")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let sources = associations
        .iter()
        .filter(|item| item.get("kind").and_then(Value::as_str) == Some("workspace"))
        .cloned()
        .collect::<Vec<_>>();
    let mut keys = std::collections::HashSet::new();
    let mut requests = Vec::with_capacity(sources.len());
    for association in &sources {
        let management_project_id = association
            .get("project_id")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned();
        let identity = association
            .get("workspace_project_id")
            .and_then(Value::as_str)
            .or_else(|| association.get("identity").and_then(Value::as_str))
            .unwrap_or("")
            .to_owned();
        let binding_key = association
            .get("workspace_binding_key")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned();
        let path = association
            .get("path")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned();
        let key = (
            management_project_id.clone(),
            identity.clone(),
            binding_key.clone(),
        );
        keys.insert(key.clone());
        requests.push((key, management_project_id, identity, binding_key, path));
    }
    let now = Instant::now();
    let deadline = now + LINKED_REFRESH_BUDGET;
    {
        let mut state = pool.state.lock().expect("linked cache poisoned");
        state.rows.retain(|key, _| keys.contains(key));
        state.pending.retain(|key| keys.contains(key));
        for (key, _, workspace_project_id, binding_key, path) in &requests {
            if state.pending.insert(key.clone()) {
                let queued_at = Instant::now();
                match pool.sender.try_send(LinkedRefreshJob {
                    key: key.clone(),
                    workspace_project_id: workspace_project_id.clone(),
                    binding_key: binding_key.clone(),
                    path: path.clone(),
                    queued_at,
                    deadline: queued_at + LINKED_JOB_BUDGET,
                    kind: LinkedRefreshKind::Rollup,
                }) {
                    Ok(()) => {}
                    Err(error) => {
                        state.pending.remove(key);
                        let message = match error {
                            std::sync::mpsc::TrySendError::Full(_) => {
                                "linked refresh worker queue is full"
                            }
                            std::sync::mpsc::TrySendError::Disconnected(_) => {
                                "linked refresh workers are unavailable"
                            }
                        };
                        let failure = json!({"project_id":workspace_project_id,"path":path,"availability":"unavailable","revision":null,"as_of":null,"sample_age_ms":null,"pool_wait_ms":0,"refresh_duration_ms":0,"counts":null,"error":message});
                        let stale = preserve_linked_sample_on_error(
                            state.rows.get(key).cloned(),
                            failure,
                            now_ms_u64(),
                            0,
                            0,
                        );
                        state.rows.insert(key.clone(), stale);
                    }
                }
            }
        }
        while state.pending.iter().any(|key| keys.contains(key)) && Instant::now() < deadline {
            let wait = deadline.saturating_duration_since(Instant::now());
            let (next, timeout) = pool
                .changed
                .wait_timeout(state, wait)
                .expect("linked cache poisoned");
            state = next;
            if timeout.timed_out() {
                break;
            }
        }
    }
    let state = pool.state.lock().expect("linked cache poisoned");
    let linked = requests.into_iter().map(|(key,management_project_id,identity,_binding_key,path)| {
        let pending = state.pending.contains(&key);
        let mut row = state.rows.get(&key).cloned().unwrap_or_else(|| json!({"project_id":identity,"path":path,"availability":"unavailable","revision":null,"as_of":null,"sample_age_ms":null,"pool_wait_ms":null,"refresh_duration_ms":null,"counts":null,"error":"linked workspace has not produced a sample"}));
        if let Some(sampled_at) = row.get("_sampled_at_ms").and_then(Value::as_u64) {
            row["sample_age_ms"] = json!(now_ms_u64().saturating_sub(sampled_at));
            if let Some(object) = row.as_object_mut() {
                object.remove("_sampled_at_ms");
            }
        }
        row["management_project_id"] = json!(management_project_id);
        if pending {
            row["availability"] = json!(if state.rows.get(&key).is_some_and(|v| matches!(v["availability"].as_str(), Some("available" | "stale"))) { "stale" } else { "refreshing" });
            row["error"] = json!("refresh is still running");
        }
        row
    }).collect::<Vec<_>>();
    snapshot["linked_projects"] = json!(linked);
}

fn linked_workspace_rollup(
    workspace_project_id: &str,
    binding_key: &str,
    path: &str,
    deadline: Instant,
) -> Result<Value, LinkedWorkspaceReadError> {
    let result = (|| -> Result<Value, LinkedWorkspaceReadError> {
        if Instant::now() >= deadline {
            return Err(LinkedWorkspaceReadError::Unavailable(
                "linked workspace read deadline expired".into(),
            ));
        }
        let workspace = validate_workspace_details(path)
            .map_err(|error| LinkedWorkspaceReadError::Unavailable(error.message))?;
        if binding_key.is_empty()
            || workspace.project_id != workspace_project_id
            || workspace.physical_binding_key() != binding_key
        {
            return Err(LinkedWorkspaceReadError::IdentityMismatch(
                "linked workspace physical identity changed".into(),
            ));
        }
        let operator_actor = workspace.operator_actor.as_deref().ok_or_else(|| {
            LinkedWorkspaceReadError::Unavailable(
                "workspace metadata does not record a local operator actor".to_owned(),
            )
        })?;
        if Instant::now() >= deadline {
            return Err(LinkedWorkspaceReadError::Unavailable(
                "linked workspace read deadline expired".into(),
            ));
        }
        let snapshot = boreal_application::project_status_from_store_for_session(
            &workspace.store,
            &ProjectId::new(workspace_project_id),
            &boreal_domain::ActorContext {
                actor_id: ActorId::new(operator_actor),
                role: boreal_domain::ActorRole::Operator,
            },
            None,
            TimestampMs::from_millis(now_ms_u64()),
            1,
            0,
        )
        .map_err(|error| LinkedWorkspaceReadError::Unavailable(error.to_string()))?;
        if Instant::now() >= deadline {
            return Err(LinkedWorkspaceReadError::Unavailable(
                "linked workspace read deadline expired".into(),
            ));
        }
        let counts = &snapshot.counts;
        Ok(
            json!({"revision":snapshot.project_revision.0,"as_of":stamp(snapshot.as_of.as_millis()),"as_of_ms":snapshot.as_of.as_millis(),"counts":{"total":snapshot.total,"draft":counts.draft,"queued":counts.queued,"ready":counts.ready,"claimed":counts.claimed,"in_progress":counts.in_progress,"needs_verification":counts.needs_verification,"awaiting_review":counts.awaiting_review,"complete":counts.complete,"closed":counts.closed,"blocked":counts.blocked,"paused":counts.paused,"retry_wait":counts.retry_wait,"expired_review":counts.expired_review,"cancelled":counts.cancelled,"scheduled":counts.scheduled}}),
        )
    })();
    result
}

fn linked_workspace_detail(
    management_project_id: &str,
    workspace_project_id: &str,
    binding_key: &str,
    path: &str,
    limit: u64,
    offset: u64,
    deadline: Instant,
) -> Result<Value, LinkedWorkspaceReadError> {
    let result = {
        let result = (|| -> Result<Value, LinkedWorkspaceReadError> {
            if Instant::now() >= deadline {
                return Err(LinkedWorkspaceReadError::Unavailable(
                    "linked workspace read deadline expired".into(),
                ));
            }
            let workspace = validate_workspace_details(path)
                .map_err(|error| LinkedWorkspaceReadError::Unavailable(error.message))?;
            if binding_key.is_empty()
                || workspace.project_id != workspace_project_id
                || workspace.physical_binding_key() != binding_key
            {
                return Err(LinkedWorkspaceReadError::IdentityMismatch(
                    "linked workspace physical identity changed".into(),
                ));
            }
            let operator_actor = workspace.operator_actor.as_deref().ok_or_else(|| {
                LinkedWorkspaceReadError::Unavailable(
                    "workspace metadata does not record a local operator actor".to_owned(),
                )
            })?;
            if Instant::now() >= deadline {
                return Err(LinkedWorkspaceReadError::Unavailable(
                    "linked workspace read deadline expired".into(),
                ));
            }
            let snapshot = boreal_application::project_status_from_store_for_session(
                &workspace.store,
                &ProjectId::new(workspace_project_id),
                &boreal_domain::ActorContext {
                    actor_id: ActorId::new(operator_actor),
                    role: boreal_domain::ActorRole::Operator,
                },
                None,
                TimestampMs::from_millis(now_ms_u64()),
                limit,
                offset,
            )
            .map_err(|error| LinkedWorkspaceReadError::Unavailable(error.to_string()))?;
            if Instant::now() >= deadline {
                return Err(LinkedWorkspaceReadError::Unavailable(
                    "linked workspace read deadline expired".into(),
                ));
            }
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
                "project_id": workspace_project_id,
                "path": workspace.root,
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
                "items_has_more": offset.saturating_add(items_count) < snapshot.total,
                "items_limit": limit,
                "items_offset": offset,
            }))
        })();
        result
    };
    let _ = (
        management_project_id,
        workspace_project_id,
        binding_key,
        path,
    );
    result
}

#[cfg(test)]
mod daily_filter_tests {
    use super::*;

    #[test]
    fn todo_add_marks_only_unstructured_personal_capture() {
        let mut options = CliOptions::default();
        options
            .extra
            .insert("--title".to_owned(), vec!["  Café\n".to_owned()]);
        let parsed = ParsedCommand {
            path: vec!["global".to_owned(), "todo".to_owned(), "add".to_owned()],
            options,
        };
        let (command, payload) = build_command(&parsed).unwrap();
        assert_eq!(command, "todo add");
        assert_eq!(payload["capture_text"], "  Café\n");

        let mut options = CliOptions::default();
        options
            .extra
            .insert("--title".to_owned(), vec!["Project task".to_owned()]);
        options.project = Some("project-1".to_owned());
        let parsed = ParsedCommand {
            path: vec!["global".to_owned(), "todo".to_owned(), "add".to_owned()],
            options,
        };
        let (_, payload) = build_command(&parsed).unwrap();
        assert_eq!(payload["project_id"], "project-1");
        assert!(payload.get("capture_text").is_none());
    }

    fn seed_daily_items(app: &GlobalManagerApplication) -> String {
        let project_id = "daily-filter-project";
        app.execute(
            "project add",
            &json!({"project_id":project_id,"name":"Daily filter test"}),
            "daily-filter-project-add",
        )
        .unwrap();
        let today = boreal_application::GlobalCivilTimeContext::system()
            .unwrap()
            .system_civil_date;
        let items = [
            (
                "daily-item-today",
                "Due today",
                json!({"due_at":today,"status_id":"todo"}),
            ),
            (
                "daily-item-overdue",
                "Overdue",
                json!({"due_at":"2000-01-01","status_id":"todo"}),
            ),
            (
                "daily-item-unscheduled",
                "Unscheduled",
                json!({"follow_up_at":"2099-01-01","status_id":"todo"}),
            ),
            (
                "daily-item-waiting",
                "Waiting",
                json!({"follow_up_at":"2099-01-01","status_id":"waiting"}),
            ),
            (
                "daily-item-completed",
                "Completed",
                json!({"due_at":today,"status_id":"done"}),
            ),
        ];
        for (item_id, title, fields) in items {
            let mut payload = json!({
                "item_id": item_id,
                "project_id": project_id,
                "title": title,
            });
            for (key, value) in fields.as_object().unwrap() {
                payload[key] = value.clone();
            }
            app.execute("todo add", &payload, &format!("daily-filter-{item_id}"))
                .unwrap();
        }
        project_id.to_owned()
    }

    #[test]
    fn daily_filter_grammar_builds_a_bounded_classified_read() {
        let mut options = CliOptions::default();
        options
            .extra
            .insert("--filter".to_owned(), vec!["all-open".to_owned()]);
        options.limit = Some(2);
        options.offset = Some(3);
        let parsed = ParsedCommand {
            path: vec!["global".to_owned(), "todo".to_owned(), "list".to_owned()],
            options,
        };

        let (command, payload) = build_command(&parsed).unwrap();
        assert_eq!(command, "todo daily list");
        assert_eq!(payload["filter"], "all_open");
        assert_eq!(payload["limit"], 2);
        assert_eq!(payload["offset"], 3);
        assert!(!mutation(&command));
        assert!(!may_have_delivery_effect(&command));

        let mut options = CliOptions::default();
        options
            .extra
            .insert("--filter".to_owned(), vec!["next-week".to_owned()]);
        let parsed = ParsedCommand {
            path: vec!["global".to_owned(), "todo".to_owned(), "list".to_owned()],
            options,
        };
        assert!(build_command(&parsed)
            .unwrap_err()
            .message
            .contains("--filter must be today"));
    }

    #[test]
    fn daily_filters_use_application_classification_and_report_true_page_totals() {
        let root = std::env::temp_dir().join(format!(
            "boreal-global-daily-filter-{}-{}",
            std::process::id(),
            now_ms_u64()
        ));
        fs::create_dir_all(&root).unwrap();
        let app = GlobalManagerApplication::open(root.join("global.sqlite")).unwrap();
        seed_daily_items(&app);

        let today = execute_daily_todo_list(
            &app,
            &json!({"filter":"today","limit":10,"offset":0}),
            "daily-filter-today-read",
        )
        .unwrap();
        assert_eq!(today["total"], 1);
        assert_eq!(today["rows"][0]["id"], "daily-item-today");
        assert_eq!(
            today["rows"][0]["daily_classification"]["filters"]["today"],
            true
        );
        assert!(today["civil_time"]["system_civil_date"].is_string());

        let overdue = execute_daily_todo_list(
            &app,
            &json!({"filter":"overdue","limit":10,"offset":0}),
            "daily-filter-overdue-read",
        )
        .unwrap();
        assert_eq!(overdue["total"], 1);
        assert_eq!(overdue["rows"][0]["id"], "daily-item-overdue");

        let waiting = execute_daily_todo_list(
            &app,
            &json!({"filter":"waiting","limit":10,"offset":0}),
            "daily-filter-waiting-read",
        )
        .unwrap();
        assert_eq!(waiting["total"], 1);
        assert_eq!(waiting["rows"][0]["id"], "daily-item-waiting");

        let unscheduled = execute_daily_todo_list(
            &app,
            &json!({"filter":"unscheduled","limit":10,"offset":0}),
            "daily-filter-unscheduled-read",
        )
        .unwrap();
        assert_eq!(unscheduled["total"], 2);
        assert!(unscheduled["rows"]
            .as_array()
            .unwrap()
            .iter()
            .any(|row| row["id"] == "daily-item-unscheduled"));

        let first = execute_daily_todo_list(
            &app,
            &json!({"filter":"all_open","limit":2,"offset":0}),
            "daily-filter-page-one",
        )
        .unwrap();
        assert_eq!(first["source_total"], 5);
        assert_eq!(first["total"], 4);
        assert_eq!(first["rows"].as_array().unwrap().len(), 2);
        assert_eq!(first["has_more"], true);
        assert_eq!(first["next_offset"], 2);

        let second = execute_daily_todo_list(
            &app,
            &json!({"filter":"all_open","limit":2,"offset":2}),
            "daily-filter-page-two",
        )
        .unwrap();
        assert_eq!(second["total"], 4);
        assert_eq!(second["rows"].as_array().unwrap().len(), 2);
        assert_eq!(second["has_more"], false);
        assert_eq!(second["next_offset"], Value::Null);

        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn daily_filter_uses_the_public_global_service_socket_route() {
        use std::ffi::OsString;
        use std::os::unix::fs::PermissionsExt;

        struct GlobalRootGuard(Option<OsString>);
        impl GlobalRootGuard {
            fn set(path: &Path) -> Self {
                let previous = env::var_os("BOREAL_GLOBAL_ROOT");
                env::set_var("BOREAL_GLOBAL_ROOT", path);
                Self(previous)
            }
        }
        impl Drop for GlobalRootGuard {
            fn drop(&mut self) {
                if let Some(previous) = self.0.take() {
                    env::set_var("BOREAL_GLOBAL_ROOT", previous);
                } else {
                    env::remove_var("BOREAL_GLOBAL_ROOT");
                }
            }
        }

        let root = PathBuf::from("/tmp").join(format!(
            "boreal-global-daily-service-{}-{}",
            std::process::id(),
            now_ms_u64()
        ));
        fs::create_dir_all(&root).unwrap();
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
        let _root_guard = GlobalRootGuard::set(&root);
        let app = GlobalManagerApplication::open(root.join("global.sqlite")).unwrap();
        seed_daily_items(&app);

        let socket = root.join("global.sock");
        let mut service_options = CliOptions::default();
        service_options.socket = Some(socket.to_string_lossy().into_owned());
        service_options.max_requests = Some(1);
        let service = ParsedCommand {
            path: vec!["global".to_owned(), "service".to_owned(), "run".to_owned()],
            options: service_options,
        };
        let server = std::thread::spawn(move || {
            crate::global_service::run_service(&service, "daily-service-run")
        });
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
        while !socket.exists() && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        if !socket.exists() {
            let server_result = server.join().unwrap();
            panic!("Global service socket did not start: {server_result:?}");
        }

        let mut request_options = CliOptions::default();
        request_options.socket = Some(socket.to_string_lossy().into_owned());
        request_options
            .extra
            .insert("--filter".to_owned(), vec!["overdue".to_owned()]);
        request_options.limit = Some(1);
        let request = ParsedCommand {
            path: vec!["global".to_owned(), "todo".to_owned(), "list".to_owned()],
            options: request_options,
        };
        let response =
            crate::global_service::request(&request, "op_global_daily_service_read").unwrap();
        let server_result = server.join().unwrap();
        assert!(
            server_result.is_ok(),
            "Global service failed: {server_result:?}"
        );
        let data = response.data.unwrap();
        assert_eq!(data["total"], 1);
        assert_eq!(data["rows"][0]["id"], "daily-item-overdue");

        let _ = fs::remove_dir_all(root);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    #[test]
    fn physical_backup_has_its_own_command_and_output_path() {
        let mut options = CliOptions::default();
        options
            .extra
            .insert("--out".to_owned(), vec!["private-copy".to_owned()]);
        let parsed = ParsedCommand {
            path: vec!["global".to_owned(), "backup".to_owned()],
            options,
        };
        let (command, payload) = build_command(&parsed).unwrap();
        assert_eq!(command, "backup");
        assert_eq!(payload, json!({"path":"private-copy"}));
        assert!(!mutation(&command));
        assert!(may_have_delivery_effect(&command));

        let export = ParsedCommand {
            path: vec!["global".to_owned(), "export".to_owned()],
            options: parsed.options,
        };
        let (command, payload) = build_command(&export).unwrap();
        assert_eq!(command, "export");
        assert_eq!(payload, json!({"path":"private-copy"}));
    }

    #[test]
    fn physical_restore_requires_package_path_and_explicit_confirmation() {
        let parsed = ParsedCommand {
            path: vec!["global".to_owned(), "restore".to_owned()],
            options: CliOptions::default(),
        };
        assert!(
            build_command(&parsed)
                .unwrap_err()
                .message
                .contains("requires --yes")
        );

        let mut options = CliOptions::default();
        options.setup.yes = true;
        let missing_package = ParsedCommand {
            path: vec!["global".to_owned(), "restore".to_owned()],
            options: options.clone(),
        };
        assert!(
            build_command(&missing_package)
                .unwrap_err()
                .message
                .contains("package path")
        );

        options.positionals.push("backup.global-backup".to_owned());
        let parsed = ParsedCommand {
            path: vec!["global".to_owned(), "restore".to_owned()],
            options,
        };
        let (command, payload) = build_command(&parsed).unwrap();
        assert_eq!(command, "restore");
        assert_eq!(payload, json!({"path":"backup.global-backup"}));
        assert!(mutation(&command));
    }

    #[test]
    fn global_detail_reads_pass_summary_cap_and_mark_the_configured_limit_partial() {
        let root = std::env::temp_dir().join(format!(
            "boreal-global-detail-pages-{}-{}",
            std::process::id(),
            now_ms_u64()
        ));
        fs::create_dir_all(&root).unwrap();
        let app = GlobalManagerApplication::open(root.join("global.sqlite")).unwrap();

        for index in 0..105 {
            let project_id = format!("management-{index:03}");
            let operation = format!("detail-project-{index:03}");
            app.execute(
                "project add",
                &json!({"project_id":project_id,"name":format!("Management {index}")}),
                &operation,
            )
            .unwrap();
            app.execute_with_workspace_resolver(
                "project link",
                &json!({"project_id":project_id,"path":format!("/workspace/{index}")}),
                &format!("detail-link-{index:03}"),
                |path| {
                    Ok(ResolvedWorkspaceIdentity {
                        project_id: format!("workspace-{index:03}"),
                        path: path.to_owned(),
                        database_instance_id: format!("database-{index:03}"),
                        restore_epoch: 1,
                        workspace_binding_digest: format!("sha256:{index:064x}"),
                    })
                },
            )
            .unwrap();
        }

        let summary = app
            .execute("snapshot", &json!({}), "detail-summary-check")
            .unwrap();
        assert_eq!(summary["associations"].as_array().unwrap().len(), 100);

        let complete =
            read_global_detail_pages(&app, "associations", "detail-complete", 1000, false).unwrap();
        assert!(complete.complete);
        assert!(!complete.stale);
        assert_eq!(complete.total, 105);
        assert_eq!(complete.rows.len(), 105);
        let complete_projects =
            read_global_detail_pages(&app, "projects", "detail-projects", 1000, true).unwrap();
        assert!(complete_projects.complete);
        assert_eq!(complete_projects.total, 105);
        assert_eq!(complete_projects.rows.len(), 105);

        let partial =
            read_global_detail_pages(&app, "associations", "detail-partial", 100, false).unwrap();
        assert!(!partial.complete);
        assert!(!partial.stale);
        assert_eq!(partial.total, 105);
        assert_eq!(partial.rows.len(), 100);
        assert_eq!(
            partial.reason,
            Some("configured_global_detail_limit_reached")
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn linked_failure_keeps_last_good_counts_and_updates_sample_age() {
        let previous = json!({"availability":"available","counts":{"open":4},"revision":8,"as_of":"2026-09-30T00:00:00Z","_sampled_at_ms":1000,"sample_age_ms":0,"error":null});
        let failure = json!({"availability":"unavailable","error":"workspace database is busy"});
        let stale = preserve_linked_sample_on_error(Some(previous), failure, 7250, 12, 31);
        assert_eq!(stale["availability"], "stale");
        assert_eq!(stale["counts"]["open"], 4);
        assert_eq!(stale["revision"], 8);
        assert_eq!(stale["sample_age_ms"], 6250);
        assert_eq!(stale["pool_wait_ms"], 12);
        assert_eq!(stale["refresh_duration_ms"], 31);
        assert_eq!(stale["error"], "workspace database is busy");
    }

    #[test]
    fn replacement_database_at_same_path_invalidates_linked_reads_and_global_next() {
        fn argv(values: &[&str]) -> Vec<String> {
            values.iter().map(|value| (*value).to_owned()).collect()
        }
        fn invoke(root: &Path, operation: &str, values: &[&str]) -> CliResult {
            crate::run_with_operation_at(&argv(values), operation, Some(root))
                .unwrap_or_else(|error| panic!("{values:?} failed: {}", error.message))
        }

        let root = std::env::temp_dir().join(format!(
            "boreal-global-link-binding-{}-{}",
            std::process::id(),
            now_ms_u64()
        ));
        let workspace_root = root.join("workspace");
        fs::create_dir_all(&workspace_root).unwrap();
        let global_root = root.join("global");
        fs::create_dir_all(&global_root).unwrap();
        let workspace_id = "same-logical-project";
        let setup_root = workspace_root.to_string_lossy().into_owned();
        invoke(
            &workspace_root,
            "binding-init",
            &[
                "init",
                "--project",
                workspace_id,
                "--project-root",
                &setup_root,
                "--yes",
                "--agents",
                "codex",
                "--json",
            ],
        );
        let metadata_path = workspace_root.join(".boreal/project.json");
        let mut metadata: Value =
            serde_json::from_slice(&fs::read(&metadata_path).unwrap()).unwrap();
        let operator = metadata["operator_actor"].as_str().unwrap().to_owned();
        let operator_session = metadata["operator_session"].as_str().unwrap().to_owned();
        let workspace_db = workspace_root.join(".boreal/boreal.sqlite");
        let db = workspace_db.to_string_lossy().into_owned();

        let operator_session_start = invoke(
            &workspace_root,
            "binding-operator-session",
            &[
                "session",
                "start",
                "--project",
                workspace_id,
                "--session",
                &operator_session,
                "--harness",
                "link-identity-test",
                "--actor",
                &operator,
                "--db",
                &db,
                "--json",
            ],
        );
        let enrollment = invoke(
            &workspace_root,
            "binding-agent-key",
            &[
                "auth",
                "key",
                "--actor",
                "candidate-agent",
                "--db",
                &db,
                "--json",
            ],
        );
        let enrollment_path = enrollment.data.as_ref().unwrap()["enrollment_path"]
            .as_str()
            .unwrap()
            .to_owned();
        let operator_revision = operator_session_start.revision.unwrap().to_string();
        let _grant = invoke(
            &workspace_root,
            "binding-agent-grant",
            &[
                "auth",
                "grant",
                "--input",
                &enrollment_path,
                "--expected-revision",
                &operator_revision,
                "--reason",
                "Disposable link identity regression",
                "--yes",
                "--actor",
                &operator,
                "--session",
                &operator_session,
                "--db",
                &db,
                "--json",
            ],
        );
        let agent_session = "candidate-session";
        let agent_session_start = invoke(
            &workspace_root,
            "binding-agent-session",
            &[
                "session",
                "start",
                "--project",
                workspace_id,
                "--session",
                agent_session,
                "--harness",
                "link-identity-test",
                "--actor",
                "candidate-agent",
                "--db",
                &db,
                "--json",
            ],
        );
        let agent_revision = agent_session_start.revision.unwrap().to_string();
        invoke(
            &workspace_root,
            "binding-work-create",
            &[
                "work",
                "create",
                workspace_id,
                "replacement-candidate",
                "Replacement candidate",
                "--kind",
                "task",
                "--dispatch",
                "automatic",
                "--actor",
                "candidate-agent",
                "--session",
                agent_session,
                "--expected-revision",
                &agent_revision,
                "--db",
                &db,
                "--json",
            ],
        );

        metadata["operator_actor"] = json!("candidate-agent");
        metadata["operator_session"] = json!(agent_session);
        fs::write(
            &metadata_path,
            serde_json::to_vec_pretty(&metadata).unwrap(),
        )
        .unwrap();

        let app = GlobalManagerApplication::open(global_root.join("global.sqlite")).unwrap();
        app.execute(
            "project add",
            &json!({"project_id":"management-project","name":"Management project"}),
            "binding-management-project",
        )
        .unwrap();
        let workspace_path = workspace_root.to_string_lossy().into_owned();
        app.execute_with_workspace_resolver(
            "project link",
            &json!({"project_id":"management-project","path":workspace_path}),
            "binding-link-project",
            |path| validate_workspace_binding(path).map_err(|error| error.message),
        )
        .unwrap();
        let association = app
            .execute(
                "association show",
                &json!({"project_id":"management-project","kind":"workspace","identity":workspace_id}),
                "binding-link-show",
            )
            .unwrap();
        let binding_key = association["workspace_binding_key"]
            .as_str()
            .unwrap()
            .to_owned();

        let next_command = ParsedCommand {
            path: vec!["global".to_owned(), "next".to_owned()],
            options: CliOptions::default(),
        };
        let before =
            crate::global_discovery::run_with_app(&next_command, "binding-next-before", &app)
                .unwrap()
                .data
                .unwrap();
        assert_eq!(before["selected"]["work_id"], "replacement-candidate");

        let mut snapshot = json!({"associations":[association.clone()]});
        let pool = new_linked_refresh_pool();
        let linked_key = (
            "management-project".to_owned(),
            workspace_id.to_owned(),
            binding_key.clone(),
        );
        let wait_for_rollup = || {
            let deadline = Instant::now() + Duration::from_secs(5);
            let mut state = pool.state.lock().unwrap();
            while state.pending.contains(&linked_key) && Instant::now() < deadline {
                let (next, timeout) = pool
                    .changed
                    .wait_timeout(state, deadline.saturating_duration_since(Instant::now()))
                    .unwrap();
                state = next;
                if timeout.timed_out() {
                    break;
                }
            }
            assert!(
                !state.pending.contains(&linked_key),
                "linked workspace rollup worker did not finish before the test deadline"
            );
            state.rows.get(&linked_key).cloned().unwrap()
        };
        enrich_snapshot_with_pool(&mut snapshot, &pool);
        let initial_rollup = wait_for_rollup();
        assert_eq!(initial_rollup["availability"], "available");
        assert_eq!(initial_rollup["counts"]["total"], 1);
        let detail = linked_workspace_detail(
            "management-project",
            workspace_id,
            &binding_key,
            &workspace_path,
            10,
            0,
            Instant::now() + LINKED_JOB_BUDGET,
        )
        .unwrap();
        assert_eq!(detail["availability"], "available");
        assert_eq!(detail["items"][0]["work_id"], "replacement-candidate");

        let original_store = SqliteStore::open_read_only_for_diagnostics(&workspace_db).unwrap();
        let original_identity = IdentityStore::new(&original_store)
            .database_identity()
            .unwrap();
        let replacement_db = root.join("replacement.sqlite");
        original_store.backup_to(&replacement_db).unwrap();
        drop(original_store);

        let replacement_store = SqliteStore::open(&replacement_db, PRODUCTION_SCHEMA).unwrap();
        IdentityStore::new(&replacement_store)
            .restore(
                format!("replacement-{}", original_identity.database_instance_id),
                original_identity.restore_epoch.get() + 1,
                &now_timestamp(),
            )
            .unwrap();
        replacement_store
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
            .unwrap();
        drop(replacement_store);
        for path in [
            workspace_db.with_extension("sqlite-wal"),
            workspace_db.with_extension("sqlite-shm"),
        ] {
            let _ = fs::remove_file(path);
        }
        let displaced_db = root.join("original.sqlite");
        fs::rename(&workspace_db, &displaced_db).unwrap();
        fs::rename(&replacement_db, &workspace_db).unwrap();

        assert!(matches!(
            linked_workspace_rollup(
                workspace_id,
                &binding_key,
                &workspace_path,
                Instant::now() + LINKED_JOB_BUDGET,
            ),
            Err(LinkedWorkspaceReadError::IdentityMismatch(_))
        ));
        assert!(matches!(
            linked_workspace_detail(
                "management-project",
                workspace_id,
                &binding_key,
                &workspace_path,
                10,
                0,
                Instant::now() + LINKED_JOB_BUDGET,
            ),
            Err(LinkedWorkspaceReadError::IdentityMismatch(_))
        ));

        let mut replaced_snapshot = json!({"associations":[association]});
        enrich_snapshot_with_pool(&mut replaced_snapshot, &pool);
        let replaced_rollup = wait_for_rollup();
        assert_eq!(
            replaced_rollup["availability"],
            "unavailable"
        );
        assert!(replaced_rollup["counts"].is_null());

        let after =
            crate::global_discovery::run_with_app(&next_command, "binding-next-after", &app)
                .unwrap()
                .data
                .unwrap();
        assert_eq!(after["selected"], Value::Null);
        assert_eq!(after["coverage"]["state"], "partial");
        assert_eq!(after["passed"], false);
        assert!(after["checks"].as_array().unwrap().iter().any(|check| {
            check["workspace_id"] == workspace_id && check["state"] == "unavailable"
        }));

        drop(app);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn global_path_uses_explicit_root_independent_of_cwd() {
        assert!(global_db_path().is_ok());
    }

    fn blocked_detail(
        pool: &LinkedRefreshPool,
        job_id: &str,
        key: LinkedDetailKey,
        fail: bool,
    ) -> mpsc::Sender<()> {
        let (started, started_rx) = mpsc::channel();
        let (release, release_rx) = mpsc::channel();
        pool.state.lock().unwrap().details.insert(
            job_id.to_owned(),
            LinkedDetailRecord {
                key: key.clone(),
                page: None,
                error: None,
                pool_wait_ms: None,
                refresh_duration_ms: None,
                changed_at: Instant::now(),
            },
        );
        let queued_at = Instant::now();
        pool.sender
            .try_send(LinkedRefreshJob {
                key: (key.0.clone(), key.1.clone(), key.2.clone()),
                workspace_project_id: key.1.clone(),
                binding_key: key.2.clone(),
                path: "synthetic".into(),
                queued_at,
                deadline: queued_at + LINKED_JOB_BUDGET,
                kind: LinkedRefreshKind::Block {
                    job_id: job_id.to_owned(),
                    started,
                    release: release_rx,
                    fail,
                },
            })
            .unwrap();
        started_rx.recv_timeout(Duration::from_secs(1)).unwrap();
        release
    }

    #[test]
    fn linked_detail_jobs_dedupe_poll_complete_and_fail_without_blocking_snapshots() {
        let pool = new_linked_refresh_pool();
        let key = (
            "management-a".into(),
            "workspace-a".into(),
            "binding-a".into(),
            "synthetic".into(),
            20,
            0,
        );
        let release = blocked_detail(&pool, "job-complete", key.clone(), false);
        assert_eq!(
            linked_detail_job_from_pool(&pool, "job-complete").unwrap()["state"],
            "refreshing"
        );
        assert_eq!(
            schedule_linked_detail(&pool, key.clone(), key.0.clone(), "synthetic".into()).unwrap(),
            "job-complete"
        );

        let start = Instant::now();
        let mut snapshot = json!({"associations":[{"project_id":"management-healthy","kind":"workspace","identity":"workspace-healthy","path":"/missing/healthy/workspace"}]});
        enrich_snapshot_with_pool(&mut snapshot, &pool);
        assert!(start.elapsed() < Duration::from_millis(500));
        assert_eq!(snapshot["linked_projects"].as_array().unwrap().len(), 1);

        release.send(()).unwrap();
        let deadline = Instant::now() + Duration::from_secs(1);
        loop {
            let status = linked_detail_job_from_pool(&pool, "job-complete").unwrap();
            if status["state"] == "complete" {
                assert_eq!(status["page"]["revision"], 7);
                assert!(status["pool_wait_ms"].is_number());
                assert!(status["refresh_duration_ms"].is_number());
                break;
            }
            assert!(Instant::now() < deadline, "detail job did not complete");
            std::thread::sleep(Duration::from_millis(5));
        }

        let refreshed =
            schedule_linked_detail(&pool, key.clone(), key.0.clone(), "synthetic".into()).unwrap();
        assert_ne!(refreshed, "job-complete");
        let changed_path_key = (
            key.0.clone(),
            key.1.clone(),
            key.2.clone(),
            "updated-path".into(),
            key.4,
            key.5,
        );
        let changed_path = schedule_linked_detail(
            &pool,
            changed_path_key,
            key.0.clone(),
            "updated-path".into(),
        )
        .unwrap();
        assert_ne!(changed_path, refreshed);

        let fail_key = (
            "management-b".into(),
            "workspace-b".into(),
            "binding-b".into(),
            "synthetic".into(),
            20,
            20,
        );
        let fail_release = blocked_detail(&pool, "job-failed", fail_key, true);
        assert_eq!(
            linked_detail_job_from_pool(&pool, "job-failed").unwrap()["state"],
            "refreshing"
        );
        fail_release.send(()).unwrap();
        let deadline = Instant::now() + Duration::from_secs(1);
        loop {
            let status = linked_detail_job_from_pool(&pool, "job-failed").unwrap();
            if status["state"] == "failed" {
                assert_eq!(status["error"], "synthetic detail failure");
                break;
            }
            assert!(
                Instant::now() < deadline,
                "failed detail result was not published"
            );
            std::thread::sleep(Duration::from_millis(5));
        }
    }

    #[test]
    fn linked_detail_queue_rejects_saturation_and_result_cache_is_bounded() {
        let (sender, receiver) = mpsc::sync_channel(0);
        let _receiver = receiver;
        let pool = LinkedRefreshPool {
            sender,
            state: std::sync::Arc::new(std::sync::Mutex::new(LinkedRefreshState::default())),
            changed: std::sync::Arc::new(std::sync::Condvar::new()),
        };
        let error = schedule_linked_detail(
            &pool,
            (
                "p".into(),
                "i".into(),
                "binding".into(),
                "path".into(),
                10,
                0,
            ),
            "p".into(),
            "path".into(),
        )
        .unwrap_err();
        assert!(error.message.contains("queue is full"));

        let mut state = LinkedRefreshState::default();
        for index in 0..LINKED_DETAIL_RESULT_CAPACITY + 12 {
            state.details.insert(
                format!("job-{index}"),
                LinkedDetailRecord {
                    key: (
                        format!("p-{index}"),
                        format!("i-{index}"),
                        format!("binding-{index}"),
                        format!("path-{index}"),
                        10,
                        0,
                    ),
                    page: Some(json!({"items":[]})),
                    error: None,
                    pool_wait_ms: Some(0),
                    refresh_duration_ms: Some(0),
                    changed_at: Instant::now(),
                },
            );
        }
        prune_linked_detail_results(&mut state, Instant::now());
        assert_eq!(state.details.len(), LINKED_DETAIL_RESULT_CAPACITY);
    }

    #[test]
    fn linked_rollup_discards_a_late_success_and_keeps_the_last_good_sample_stale() {
        let pool = new_linked_refresh_pool();
        let key = (
            "management-late".to_owned(),
            "workspace-late".to_owned(),
            "binding-late".to_owned(),
        );
        let sampled_at = now_ms_u64().saturating_sub(100);
        {
            let mut state = pool.state.lock().unwrap();
            state.pending.insert(key.clone());
            state.rows.insert(
                key.clone(),
                json!({"project_id":"workspace-late","path":"synthetic","availability":"available","revision":5,"as_of":"sampled","sample_age_ms":100,"_sampled_at_ms":sampled_at,"counts":{"total":9},"error":null}),
            );
        }
        let (started, started_rx) = mpsc::channel();
        let (release, release_rx) = mpsc::channel();
        let queued_at = Instant::now();
        pool.sender
            .try_send(LinkedRefreshJob {
                key: key.clone(),
                workspace_project_id: key.1.clone(),
                binding_key: key.2.clone(),
                path: "synthetic".into(),
                queued_at,
                deadline: queued_at + Duration::from_millis(30),
                kind: LinkedRefreshKind::BlockRollup {
                    started,
                    release: release_rx,
                },
            })
            .unwrap();
        started_rx.recv_timeout(Duration::from_secs(1)).unwrap();

        let mut snapshot = json!({"associations":[{"project_id":"management-late","kind":"workspace","identity":"workspace-late","workspace_project_id":"workspace-late","workspace_binding_key":"binding-late","path":"synthetic"}]});
        enrich_snapshot_with_pool(&mut snapshot, &pool);
        let presented = &snapshot["linked_projects"][0];
        assert_eq!(presented["availability"], "stale");
        assert_eq!(presented["counts"]["total"], 9);

        std::thread::sleep(Duration::from_millis(40));
        release.send(()).unwrap();
        let completion_deadline = Instant::now() + Duration::from_secs(1);
        loop {
            let state = pool.state.lock().unwrap();
            if !state.pending.contains(&key) {
                let row = state.rows.get(&key).unwrap();
                assert_eq!(row["availability"], "stale");
                assert_eq!(row["counts"]["total"], 9);
                assert_eq!(row["revision"], 5);
                assert_eq!(row["error"], "linked workspace read deadline expired");
                assert!(row["refresh_duration_ms"].as_u64().unwrap() >= 40);
                break;
            }
            drop(state);
            assert!(
                Instant::now() < completion_deadline,
                "late worker did not finish"
            );
            std::thread::sleep(Duration::from_millis(5));
        }
    }

    #[test]
    fn linked_worker_and_queue_saturation_leave_global_mutations_available_and_measure_wait() {
        let pool = new_linked_refresh_pool();
        let mut blocker_releases = Vec::new();
        for index in 0..LINKED_POOL_WORKERS {
            let key = (
                format!("blocker-{index}"),
                format!("workspace-{index}"),
                format!("binding-{index}"),
            );
            let (started, started_rx) = mpsc::channel();
            let (release, release_rx) = mpsc::channel();
            let queued_at = Instant::now();
            pool.state.lock().unwrap().pending.insert(key.clone());
            pool.sender
                .try_send(LinkedRefreshJob {
                    key,
                    workspace_project_id: format!("workspace-{index}"),
                    binding_key: format!("binding-{index}"),
                    path: "synthetic".into(),
                    queued_at,
                    deadline: queued_at + Duration::from_secs(10),
                    kind: LinkedRefreshKind::BlockRollup {
                        started,
                        release: release_rx,
                    },
                })
                .unwrap();
            started_rx.recv_timeout(Duration::from_secs(1)).unwrap();
            blocker_releases.push(release);
        }

        let associations = (0..LINKED_POOL_WORKERS + LINKED_POOL_QUEUE + 8)
            .map(|index| {
                json!({"project_id":format!("management-{index:03}"),"kind":"workspace","identity":format!("linked-{index:03}"),"path":"/missing/synthetic/workspace"})
            })
            .collect::<Vec<_>>();
        let first_key = (
            "management-000".to_owned(),
            "linked-000".to_owned(),
            String::new(),
        );
        pool.state.lock().unwrap().rows.insert(
            first_key,
            json!({"project_id":"linked-000","path":"/missing/synthetic/workspace","availability":"available","revision":3,"as_of":"last-good","sample_age_ms":0,"_sampled_at_ms":now_ms_u64(),"counts":{"total":1},"error":null}),
        );
        let mut snapshot = json!({"associations":associations});
        let refresh_started = Instant::now();
        enrich_snapshot_with_pool(&mut snapshot, &pool);
        let snapshot_elapsed_ms = refresh_started.elapsed().as_millis() as u64;
        let rows = snapshot["linked_projects"].as_array().unwrap();
        assert_eq!(rows.len(), LINKED_POOL_WORKERS + LINKED_POOL_QUEUE + 8);
        assert!(
            snapshot_elapsed_ms < 500,
            "snapshot took {snapshot_elapsed_ms} ms"
        );
        assert_eq!(rows[0]["availability"], "stale");
        assert_eq!(rows[0]["counts"]["total"], 1);
        assert!(
            rows.iter()
                .any(|row| row["error"] == "linked refresh worker queue is full")
        );

        let root = std::env::temp_dir().join(format!(
            "boreal-global-linked-saturation-{}-{}",
            std::process::id(),
            now_ms_u64()
        ));
        fs::create_dir_all(&root).unwrap();
        let app = GlobalManagerApplication::open(root.join("global.sqlite")).unwrap();
        let mutation_started = Instant::now();
        app.execute(
            "todo add",
            &json!({"title":"Global todo under linked saturation"}),
            "linked-saturation-todo",
        )
        .unwrap();
        app.execute(
            "note add",
            &json!({"title":"Global note under linked saturation","body":"The linked queue is busy."}),
            "linked-saturation-note",
        )
        .unwrap();
        let mutation_elapsed_ms = mutation_started.elapsed().as_millis() as u64;
        assert!(
            mutation_elapsed_ms < 1_000,
            "Global mutations took {mutation_elapsed_ms} ms"
        );
        let _ = fs::remove_dir_all(root);

        for release in blocker_releases {
            release.send(()).unwrap();
        }
        let keys = rows
            .iter()
            .map(|row| {
                (
                    row["management_project_id"].as_str().unwrap().to_owned(),
                    row["project_id"].as_str().unwrap().to_owned(),
                    String::new(),
                )
            })
            .collect::<std::collections::HashSet<_>>();
        let drain_deadline = Instant::now() + Duration::from_secs(2);
        loop {
            let state = pool.state.lock().unwrap();
            if !state.pending.iter().any(|key| keys.contains(key)) {
                let measured_wait = state
                    .rows
                    .iter()
                    .filter(|(key, _)| keys.contains(*key))
                    .filter_map(|(_, row)| row["pool_wait_ms"].as_u64())
                    .max()
                    .unwrap_or(0);
                assert!(measured_wait > 0, "pool wait was not measured");
                assert!(
                    state
                        .rows
                        .iter()
                        .filter(|(key, _)| keys.contains(*key))
                        .any(|(_, row)| row["refresh_duration_ms"].as_u64().is_some())
                );
                break;
            }
            drop(state);
            assert!(
                Instant::now() < drain_deadline,
                "saturated linked queue did not drain"
            );
            std::thread::sleep(Duration::from_millis(5));
        }
    }
}
