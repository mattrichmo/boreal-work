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
    let mut result_revision = None;
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
        let limit = parsed.options.limit.unwrap_or(25);
        if !(1..=100).contains(&limit) {
            return Err(CliError::invalid("global discovery limit must be 1..100"));
        }

        // Summary snapshots intentionally cap each collection at 100 rows.
        // Read the full bounded detail pages and require one stable Global
        // revision across both collections and the final readback.
        let projects = global_commands::read_global_detail_pages(
            &app,
            "projects",
            operation,
            global_commands::GLOBAL_DISCOVERY_ROW_LIMIT,
            true,
        )?;
        let associations = global_commands::read_global_detail_pages(
            &app,
            "associations",
            operation,
            global_commands::GLOBAL_DISCOVERY_ROW_LIMIT,
            false,
        )?;
        let page_final_revision = app
            .revision()
            .map_err(|error| CliError::invalid(error.to_string()))?;
        let revision_matches = projects.revision == associations.revision
            && projects.revision == Some(page_final_revision)
            && !projects.stale
            && !associations.stale;
        let mut stale = !revision_matches;
        let mut registry_complete = projects.complete && associations.complete && revision_matches;
        let mut reason = if stale {
            projects
                .reason
                .or(associations.reason)
                .or(Some("global_revision_changed_during_enumeration"))
        } else {
            projects.reason.or(associations.reason)
        };
        let project_by_id = projects
            .rows
            .iter()
            .filter_map(|project| {
                project
                    .get("id")
                    .and_then(Value::as_str)
                    .map(|id| (id.to_owned(), project.clone()))
            })
            .collect::<std::collections::BTreeMap<_, _>>();
        let mut checks = Vec::new();
        let mut candidates = Vec::new();
        let mut seen_associations = std::collections::BTreeSet::new();
        let mut seen_candidates = std::collections::BTreeSet::new();
        let mut candidate_coverage_complete = registry_complete;

        if !stale {
            for link in associations
                .rows
                .iter()
                .filter(|link| link["kind"] == "folder")
            {
                let path = link["path"].as_str().unwrap_or("");
                checks.push(json!({
                    "management_project_id":link["project_id"],
                    "path":path,
                    "state":if Path::new(path).is_absolute() && Path::new(path).is_dir() { "valid" } else { "unavailable" },
                    "kind":"folder"
                }));
            }
            for link in associations
                .rows
                .iter()
                .filter(|link| link["kind"] == "workspace")
            {
                let identity = link["identity"].as_str().unwrap_or("");
                let path = link["path"].as_str().unwrap_or("");
                let management_project_id = link["project_id"].as_str().unwrap_or("");
                let parent = project_by_id.get(management_project_id);
                let Some(parent) = parent else {
                    checks.push(json!({
                        "management_project_id":link["project_id"],
                        "workspace_id":identity,
                        "path":path,
                        "state":"unavailable",
                        "reason":"management project is absent from the bounded registry read"
                    }));
                    candidate_coverage_complete = false;
                    if reason.is_none() {
                        reason = Some("management_project_missing_from_registry_read");
                    }
                    continue;
                };
                let eligible = parent["archived"] != true
                    && !matches!(
                        parent["lifecycle"].as_str(),
                        Some("on_hold" | "completed" | "cancelled")
                    );
                let checked = global_commands::validate_workspace(path).and_then(|(id, root)| {
                    if id != identity {
                        return Err(CliError::invalid("linked workspace identity changed"));
                    }
                    Ok(root)
                });
                let root = match checked {
                    Ok(root) => root,
                    Err(error) => {
                        checks.push(json!({
                            "management_project_id":link["project_id"],
                            "workspace_id":identity,
                            "path":path,
                            "state":"unavailable",
                            "reason":error.message
                        }));
                        if parsed.path == ["global", "next"] && eligible {
                            candidate_coverage_complete = false;
                            if reason.is_none() {
                                reason = Some("eligible_workspace_unavailable");
                            }
                        }
                        continue;
                    }
                };
                let unique = seen_associations.insert(identity.to_owned());
                checks.push(json!({
                    "management_project_id":link["project_id"],
                    "workspace_id":identity,
                    "path":root,
                    "state":if unique { "valid" } else { "duplicate_association" },
                    "participates":eligible
                }));
                if parsed.path == ["global", "next"] && eligible {
                    if !unique {
                        candidate_coverage_complete = false;
                        if reason.is_none() {
                            reason = Some("duplicate_eligible_workspace_association");
                        }
                    }
                    if seen_candidates.insert(identity.to_owned()) {
                        match fresh_candidate(parsed, &root, identity) {
                            Ok(mut row) => {
                                row["management_project_id"] = link["project_id"].clone();
                                row["management_priority"] =
                                    parent.get("priority").cloned().unwrap_or(json!(0));
                                if row.get("work_id").is_some() {
                                    candidates.push(row);
                                }
                            }
                            Err(error) => {
                                checks.push(json!({
                                    "workspace_id":identity,
                                    "path":root,
                                    "state":"read_failed",
                                    "reason":error.message
                                }));
                                candidate_coverage_complete = false;
                                if reason.is_none() {
                                    reason = Some("eligible_workspace_read_failed");
                                }
                            }
                        }
                    }
                }
            }
        } else {
            candidate_coverage_complete = false;
        }

        // Workspace validation and advisory discovery happen after Global
        // pages are read. Recheck the registry revision so an unlink or
        // lifecycle change during those reads cannot be presented as current.
        let final_revision = app
            .revision()
            .map_err(|error| CliError::invalid(error.to_string()))?;
        result_revision = Some(final_revision);
        if !stale && projects.revision != Some(final_revision) {
            stale = true;
            registry_complete = false;
            candidate_coverage_complete = false;
            reason = Some("global_revision_changed_during_workspace_validation");
            candidates.clear();
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
        let candidate_count = candidates.len();
        let candidates_have_more = candidate_count > limit as usize;
        candidates.truncate(limit as usize);
        let candidate_coverage_complete = if parsed.path == ["global", "next"] {
            candidate_coverage_complete
        } else {
            registry_complete
        };
        if candidate_coverage_complete {
            reason = None;
        }
        let coverage_state = if stale {
            "stale"
        } else if candidate_coverage_complete {
            "complete"
        } else {
            "partial"
        };
        let selected = if parsed.path == ["global", "next"] && candidate_coverage_complete {
            candidates.first().cloned().unwrap_or(Value::Null)
        } else {
            Value::Null
        };
        let passed = !stale
            && registry_complete
            && candidate_coverage_complete
            && checks.iter().all(|check| check["state"] == "valid");
        json!({
            "revision":projects.revision,
            "project_revision":projects.revision,
            "association_revision":associations.revision,
            "observed_revision":if stale {
                json!({
                    "projects":projects.observed_revision,
                    "associations":associations.observed_revision,
                    "current":final_revision
                })
            } else {
                Value::Null
            },
            "read_only":true,
            "advisory":true,
            "freshness":"live_project_revision",
            "global_freshness":if stale { "stale" } else { "revision_consistent" },
            "partial":!candidate_coverage_complete,
            "coverage":{
                "state":coverage_state,
                "complete":candidate_coverage_complete,
                "registry_complete":registry_complete,
                "associations":{"read":associations.rows.len(),"total":associations.total,"limit":global_commands::GLOBAL_DISCOVERY_ROW_LIMIT},
                "projects":{"read":projects.rows.len(),"total":projects.total,"limit":global_commands::GLOBAL_DISCOVERY_ROW_LIMIT},
                "reason":reason
            },
            "checks":checks,
            "passed":passed,
            "candidate_count":candidate_count,
            "candidate_count_is_lower_bound":!candidate_coverage_complete,
            "candidate_list_has_more":candidates_have_more,
            "selected":selected,
            "candidates":candidates,
            "note":"Run prime from a returned working_directory to authenticate and obtain current trusted guidance; no work was claimed. A null selected value with partial coverage does not establish that no eligible work exists."
        })
    };
    Ok(CliResult {
        outcome: if parsed.path == ["registry", "doctor"] && data["passed"] == false {
            ApplicationOutcome::Rejected
        } else if changed && !replayed {
            ApplicationOutcome::Changed
        } else {
            ApplicationOutcome::Unchanged
        },
        revision: Some(match result_revision {
            Some(revision) => revision,
            None => app
                .revision()
                .map_err(|error| CliError::invalid(error.to_string()))?,
        }),
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
    let metadata: Value = serde_json::from_slice(&{
        use std::io::Read;
        let path =
            project_context::confined_path(&ctx.root, Path::new(".boreal/project.json"), false)?;
        let mut bytes = Vec::new();
        fs::File::open(path)
            .map_err(|e| CliError::invalid(e.to_string()))?
            .take(65537)
            .read_to_end(&mut bytes)
            .map_err(|e| CliError::invalid(e.to_string()))?;
        if bytes.len() > 65536 {
            return Err(CliError::invalid("project metadata exceeds 64 KiB"));
        }
        bytes
    })
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
