//! Global registry lifecycle and fresh, advisory cross-project discovery.
use super::*;
use boreal_application::GlobalManagerApplication;

pub(crate) fn supported(path: &[String]) -> bool {
    matches!(
        path.iter()
            .map(String::as_str)
            .collect::<Vec<_>>()
            .as_slice(),
        ["registry", "set-state" | "pause" | "resume" | "doctor"] | ["global", "next"]
    )
}
pub(crate) fn run(parsed: &ParsedCommand, operation: &str) -> Result<CliResult, CliError> {
    let database = global_commands::global_db_path()?;
    if !database.is_file() {
        return Err(CliError::invalid(
            "global registry is not initialized; run bwrk global init",
        ));
    }
    let app =
        GlobalManagerApplication::open(database).map_err(|e| CliError::invalid(e.to_string()))?;
    let mut changed = false;
    let replayed = match app.execute(
        "operation show",
        &json!({"operation_id":operation}),
        operation,
    ) {
        Ok(_) => true,
        Err(boreal_application::GlobalManagerError::NotFound(_)) => false,
        Err(e) => return Err(CliError::invalid(e.to_string())),
    };
    let data = if matches!(
        parsed.path.last().map(String::as_str),
        Some("pause" | "resume" | "set-state")
    ) {
        if !parsed.options.setup.yes {
            return Err(CliError::invalid(
                "registry lifecycle changes require --yes",
            ));
        }
        let expected = parsed.options.expected_revision.ok_or_else(|| {
            CliError::invalid("registry lifecycle changes require --expected-revision")
        })?;
        let project = parsed.options.positionals.first().ok_or_else(|| {
            CliError::invalid("registry lifecycle requires a management project ID")
        })?;
        let state = match parsed.path.last().map(String::as_str) {
            Some("pause") => "paused",
            Some("resume") => "linked",
            _ => parsed
                .options
                .extra
                .get("--state")
                .and_then(|v| v.last())
                .map(String::as_str)
                .ok_or_else(|| CliError::invalid("registry set-state requires --state"))?,
        };
        changed = true;
        app.execute(
            "project registry-state",
            &json!({"project_id":project,"state":state,"expected_revision":expected}),
            operation,
        )
        .map_err(|e| CliError::invalid(e.to_string()))?
    } else {
        let snapshot = app
            .execute("snapshot", &json!({}), operation)
            .map_err(|e| CliError::invalid(e.to_string()))?;
        let projects = snapshot["projects"].as_array().cloned().unwrap_or_default();
        let links = snapshot["associations"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        let mut checks = Vec::new();
        let mut candidates = Vec::new();
        let mut seen = std::collections::BTreeSet::new();
        for link in links.iter().filter(|l| l["kind"] == "folder") {
            let path = link["path"].as_str().unwrap_or("");
            checks.push(json!({"management_project_id":link["project_id"],"path":path,"state":if Path::new(path).is_absolute()&&Path::new(path).is_dir(){"valid"}else{"unavailable"},"kind":"folder"}));
        }
        for link in links.iter().filter(|l| l["kind"] == "workspace") {
            let identity = link["identity"].as_str().unwrap_or("");
            let path = link["path"].as_str().unwrap_or("");
            let parent = projects.iter().find(|p| p["id"] == link["project_id"]);
            let eligible = parent.is_some_and(|p| {
                p["archived"] != true
                    && !matches!(
                        p["lifecycle"].as_str(),
                        Some("on_hold" | "completed" | "cancelled")
                    )
            });
            let checked = global_commands::validate_workspace(path).and_then(|(id, root)| {
                if id != identity {
                    return Err(CliError::invalid("linked workspace identity changed"));
                }
                Ok(root)
            });
            let root = match checked {
                Ok(root) => root,
                Err(e) => {
                    checks.push(json!({"management_project_id":link["project_id"],"workspace_id":identity,"path":path,"state":"unavailable","reason":e.message}));
                    continue;
                }
            };
            let unique = seen.insert(identity.to_owned());
            checks.push(json!({"management_project_id":link["project_id"],"workspace_id":identity,"path":root,"state":if unique{"valid"}else{"duplicate_association"},"participates":eligible}));
            if parsed.path == ["global", "next"] && eligible && unique {
                let result = fresh_candidate(parsed, &root, identity);
                match result{Ok(mut row)=>{row["management_project_id"]=link["project_id"].clone();row["management_priority"]=parent.and_then(|p|p.get("priority")).cloned().unwrap_or(json!(0));if row.get("work_id").is_some(){candidates.push(row);}},Err(e)=>checks.push(json!({"workspace_id":identity,"path":root,"state":"read_failed","reason":e.message}))}
            }
        }
        candidates.sort_by(|a, b| {
            b["priority"]
                .as_u64()
                .cmp(&a["priority"].as_u64())
                .then_with(|| {
                    b["management_priority"]
                        .as_u64()
                        .cmp(&a["management_priority"].as_u64())
                })
                .then_with(|| a["workspace_id"].as_str().cmp(&b["workspace_id"].as_str()))
                .then_with(|| a["work_id"].as_str().cmp(&b["work_id"].as_str()))
        });
        let limit = parsed.options.limit.unwrap_or(25);
        if !(1..=100).contains(&limit) {
            return Err(CliError::invalid("global discovery limit must be 1..100"));
        }
        let total = candidates.len();
        candidates.truncate(limit as usize);
        json!({"revision":snapshot["revision"],"read_only":true,"advisory":true,"freshness":"live_project_revision","checks":checks,"passed":checks.iter().all(|c|c["state"]=="valid"),"candidate_count":total,"selected":candidates.first(),"candidates":candidates,"note":"Run prime from the returned working_directory to authenticate and obtain current trusted guidance; no work was claimed."})
    };
    Ok(CliResult {
        outcome: if parsed.path == ["registry", "doctor"] && data["passed"] == false {
            ApplicationOutcome::Rejected
        } else if changed && !replayed {
            ApplicationOutcome::Changed
        } else {
            ApplicationOutcome::Unchanged
        },
        revision: Some(
            app.revision()
                .map_err(|e| CliError::invalid(e.to_string()))?,
        ),
        data: Some(data),
        ..CliResult::default()
    })
}
fn fresh_candidate(parsed: &ParsedCommand, root: &str, project: &str) -> Result<Value, CliError> {
    let mut local = parsed.clone();
    local.options.project = Some(project.to_owned());
    local.options.db = ".boreal/boreal.sqlite".into();
    local.options.setup.project_root = Some(root.to_owned());
    local.options.socket = None;
    let ctx = project_context::resolve_from(&local, Path::new(root))?;
    let store =
        SqliteStore::open_read_only_for_diagnostics(&ctx.database).map_err(map_store_error)?;
    project_context::validate_store(&ctx, &store)?;
    let metadata: Value = serde_json::from_slice(
        &fs::read(ctx.root.join(".boreal/project.json"))
            .map_err(|e| CliError::invalid(e.to_string()))?,
    )
    .map_err(|e| CliError::invalid(e.to_string()))?;
    let actor = metadata["operator_actor"]
        .as_str()
        .ok_or_else(|| CliError::invalid("workspace has no registered local operator"))?;
    let role = store
        .principal_authority(project, actor)
        .map_err(map_store_error)?
        .0;
    let snapshot = boreal_application::discover_work(
        &store,
        &ProjectId::new(project),
        &boreal_domain::ActorContext {
            actor_id: ActorId::new(actor),
            role,
        },
        None,
        TimestampMs::from_millis(now_ms_u64()),
    )
    .map_err(CliError::invalid)?;
    let Some(item) = snapshot
        .items
        .iter()
        .find(|item| item.claimable_for_actor())
    else {
        return Ok(
            json!({"workspace_id":project,"project_revision":snapshot.revision.0,"state":"idle_or_blocked"}),
        );
    };
    Ok(
        json!({"workspace_id":project,"working_directory":ctx.root,"project_revision":snapshot.revision.0,"as_of":stamp(now_ms_u64()),"work_id":item.work.id.as_str(),"title":item.work.title,"priority":item.work.priority,"safe_argv":["bwrk","prime","--project",project,"--json"],"authority":"advisory_snapshot_only"}),
    )
}
