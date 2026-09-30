use super::*;
use std::collections::{BTreeMap, BTreeSet};

pub(crate) fn option<'a>(parsed: &'a ParsedCommand, key: &str) -> Option<&'a str> {
    parsed
        .options
        .extra
        .get(key)
        .and_then(|values| values.last())
        .map(String::as_str)
}
fn snapshot(
    parsed: &ParsedCommand,
    store: &SqliteStore,
) -> Result<boreal_application::DiscoverySnapshot, CliError> {
    boreal_application::discover_work(
        store,
        &ProjectId::new(project_argument(parsed, 0)?),
        &boreal_domain::ActorContext {
            actor_id: ActorId::new(parsed.options.actor.clone()),
            role: boreal_domain::ActorRole::Agent,
        },
        Some(&parsed.options.session),
        TimestampMs::from_millis(now_ms_u64()),
    )
    .map_err(|message| {
        CliError::with(
            ErrorCode::StaleContext,
            ApplicationOutcome::Rejected,
            message,
        )
    })
}
/// Select the first ready task using exactly the same full-snapshot filters
/// as the discovery queue. Shared by guide/next so filters cannot silently
/// fall back to a different, unfiltered candidate.
pub(crate) fn select_ready_work(
    parsed: &ParsedCommand,
    store: &SqliteStore,
) -> Result<Option<String>, CliError> {
    let project = project_argument(parsed, 0)?;
    let snapshot = snapshot(parsed, store)?;
    let parents: BTreeMap<_, _> = snapshot
        .items
        .iter()
        .map(|i| {
            (
                i.work.id.to_string(),
                i.work.parent_id.as_ref().map(ToString::to_string),
            )
        })
        .collect();
    let container = option(parsed, "--container").or(parsed.options.parent.as_deref());
    if let Some(id) = container {
        if !parents.contains_key(id) {
            return Err(CliError::with(
                ErrorCode::NotFound,
                ApplicationOutcome::Rejected,
                "container does not exist in this project",
            ));
        }
    }
    let labels = store
        .project_work_labels(&project)
        .map_err(map_store_error)?;
    ensure_revision(store, &project, snapshot.revision.0)?;
    let requested = parsed
        .options
        .extra
        .get("--label")
        .into_iter()
        .flatten()
        .chain(parsed.options.extra.get("--labels").into_iter().flatten())
        .flat_map(|v| v.split(','))
        .map(|v| v.trim().to_ascii_lowercase())
        .filter(|v| !v.is_empty())
        .collect::<BTreeSet<_>>();
    let status_filter = option(parsed, "--status");
    let query = option(parsed, "--query");
    for item in snapshot.items {
        if item.work.kind != WorkKind::Task || !item.claimable_for_actor() {
            continue;
        }
        let lifecycle = lifecycle_name(item.work.lifecycle);
        let status = status_name(item.status3_display_status());
        if status_filter
            .is_some_and(|filter| !filter.split(',').any(|f| f == status || f == lifecycle))
        {
            continue;
        }
        if parsed
            .options
            .kind
            .as_deref()
            .is_some_and(|kind| kind != work_kind_name(item.work.kind))
        {
            continue;
        }
        let work_labels = labels
            .get(item.work.id.as_str())
            .cloned()
            .unwrap_or_default();
        if !requested.is_empty()
            && !requested
                .iter()
                .all(|label| work_labels.iter().any(|value| value == label))
        {
            continue;
        }
        if query.is_some_and(|q| {
            !format!(
                "{} {} {}",
                item.work.id, item.work.title, item.work.description
            )
            .to_lowercase()
            .contains(&q.to_lowercase())
        }) {
            continue;
        }
        if let Some(container) = container {
            let mut ancestor = item.work.parent_id.as_ref().map(ToString::to_string);
            let mut seen = BTreeSet::new();
            let mut inside = false;
            while let Some(id) = ancestor {
                if id == container {
                    inside = true;
                    break;
                }
                if !seen.insert(id.clone()) {
                    break;
                }
                ancestor = parents.get(&id).cloned().flatten();
            }
            if !inside {
                continue;
            }
        }
        return Ok(Some(item.work.id.to_string()));
    }
    Ok(None)
}
pub(crate) fn supported(path: &[String]) -> bool {
    matches!(
        path.iter()
            .map(String::as_str)
            .collect::<Vec<_>>()
            .as_slice(),
        [
            "work",
            "list" | "ready" | "recent-closed" | "review-candidates" | "parallel" | "next"
        ] | ["prime"]
    )
}
pub(crate) fn run(parsed: &ParsedCommand, store: &SqliteStore) -> Result<CliResult, CliError> {
    if parsed.path == ["prime"] {
        return prime(parsed, store);
    }
    if parsed.path == ["work", "next"] {
        return next_result(parsed, &WorkApplication::new(store), store);
    }
    let snapshot = snapshot(parsed, store)?;
    let parents: BTreeMap<_, _> = snapshot
        .items
        .iter()
        .map(|i| {
            (
                i.work.id.to_string(),
                i.work.parent_id.as_ref().map(ToString::to_string),
            )
        })
        .collect();
    let container = option(parsed, "--container").or(parsed.options.parent.as_deref());
    if let Some(id) = container {
        if !parents.contains_key(id) {
            return Err(CliError::with(
                ErrorCode::NotFound,
                ApplicationOutcome::Rejected,
                "container does not exist in this project",
            ));
        }
    }
    let ready = parsed.path == ["work", "ready"]
        || parsed.path == ["work", "parallel"]
        || option(parsed, "--ready").is_some();
    let closed = parsed.path == ["work", "recent-closed"] || option(parsed, "--closed").is_some();
    let review = parsed.path == ["work", "review-candidates"];
    let all = option(parsed, "--all").is_some() || option(parsed, "--status").is_some();
    let labels = store
        .project_work_labels(&project_argument(parsed, 0)?)
        .map_err(map_store_error)?;
    let requested_labels = parsed
        .options
        .extra
        .get("--label")
        .into_iter()
        .flatten()
        .chain(parsed.options.extra.get("--labels").into_iter().flatten())
        .flat_map(|v| v.split(','))
        .map(|v| v.trim().to_ascii_lowercase())
        .filter(|v| !v.is_empty())
        .collect::<BTreeSet<_>>();
    let mut selected = Vec::new();
    for item in snapshot.items {
        let lifecycle = lifecycle_name(item.work.lifecycle);
        let status = status_name(item.status3_display_status());
        if ready && !(item.work.kind == WorkKind::Task && item.claimable_for_actor()) {
            continue;
        }
        if closed && lifecycle != "closed" {
            continue;
        }
        if !closed && !all && matches!(lifecycle, "closed" | "cancelled") {
            continue;
        }
        if option(parsed, "--status")
            .is_some_and(|filter| !filter.split(',').any(|f| f == status || f == lifecycle))
        {
            continue;
        }
        if parsed
            .options
            .kind
            .as_deref()
            .is_some_and(|k| k != work_kind_name(item.work.kind))
        {
            continue;
        }
        if review
            && !item
                .actions
                .as_ref()
                .is_some_and(|a| a.allows(boreal_domain::actions::ActionKind::Review))
            && !item.gates.gates.iter().any(|gate| {
                gate.required
                    && gate.kind == boreal_domain::GateKind::Review
                    && gate.state != boreal_domain::GateState::Satisfied
            })
        {
            continue;
        }
        let mut lineage = Vec::new();
        let mut ancestor = item.work.parent_id.as_ref().map(ToString::to_string);
        let mut seen = BTreeSet::new();
        while let Some(id) = ancestor {
            if !seen.insert(id.clone()) {
                break;
            }
            lineage.push(id.clone());
            ancestor = parents.get(&id).cloned().flatten();
        }
        if container.is_some_and(|c| !lineage.iter().any(|id| id == c)) {
            continue;
        }
        if option(parsed, "--query").is_some_and(|q| {
            !format!(
                "{} {} {}",
                item.work.id, item.work.title, item.work.description
            )
            .to_lowercase()
            .contains(&q.to_lowercase())
        }) {
            continue;
        }
        let work_labels = labels
            .get(item.work.id.as_str())
            .cloned()
            .unwrap_or_default();
        if !requested_labels.is_empty()
            && !requested_labels
                .iter()
                .all(|label| work_labels.iter().any(|actual| actual == label))
        {
            continue;
        }
        selected.push(json!({"work_id":item.work.id.as_str(),"kind":work_kind_name(item.work.kind),"lifecycle":lifecycle,"display_status":status,"dispatch_policy":format!("{:?}",item.work.dispatch_policy).to_lowercase(),"title":item.work.title,"description":item.work.description,"priority":item.work.priority,"labels":work_labels,"parent_id":item.work.parent_id.as_ref().map(ToString::to_string),"lineage":lineage,"claimable_for_actor":item.claimable_for_actor(),"reason_codes":item.decision.reason_codes.iter().map(|r|r.stable_code()).collect::<Vec<_>>(),"dependency_blockers":item.dependency_blockers.iter().map(|b|format!("{b:?}")).collect::<Vec<_>>() }));
    }
    if closed {
        let ranks = store
            .recent_closed_ranks(&project_argument(parsed, 0)?)
            .map_err(map_store_error)?;
        selected.sort_by_key(|item| {
            std::cmp::Reverse(
                ranks
                    .get(item["work_id"].as_str().unwrap_or_default())
                    .copied()
                    .unwrap_or_default(),
            )
        });
    }
    ensure_revision(store, &project_argument(parsed, 0)?, snapshot.revision.0)?;
    let total = selected.len();
    let offset = parsed.options.offset.unwrap_or(0) as usize;
    let limit = parsed.options.limit.unwrap_or(100).clamp(1, 1000) as usize;
    let items = selected
        .into_iter()
        .skip(offset)
        .take(limit)
        .collect::<Vec<_>>();
    let mut result = bounded_result(
        Some(
            json!({"project_id":project_argument(parsed,0)?,"revision":snapshot.revision.0,"total":total,"offset":offset,"limit":limit,"items":items,"selection":"actor_specific_conditional_status"}),
        ),
        Some(snapshot.revision.0),
    )?;
    result.outcome = ApplicationOutcome::Unchanged;
    if !parsed.options.json {
        let mut out = format!(
            "{} matching work items (revision {})\n",
            total, snapshot.revision.0
        );
        for row in &items {
            out.push_str(&format!(
                "{:<24} {:<14} {}\n",
                row["work_id"].as_str().unwrap_or(""),
                row["display_status"].as_str().unwrap_or(""),
                row["title"].as_str().unwrap_or("")
            ));
        }
        result.human = Some(out);
    }
    Ok(result)
}
fn prime(parsed: &ParsedCommand, store: &SqliteStore) -> Result<CliResult, CliError> {
    let status = status_result(parsed, store)?;
    let guide = guide_result(parsed, &WorkApplication::new(store), store)?;
    if status.revision.is_some() && guide.revision.is_some() && status.revision != guide.revision {
        return Err(CliError::with(
            ErrorCode::StaleContext,
            ApplicationOutcome::Rejected,
            "project changed while prime gathered status and guide; refresh the brief",
        ));
    }
    let context = project_context::resolve(parsed)?;
    let registry = WorkflowRegistry::embedded().map_err(|e| CliError::invalid(e.to_string()))?;
    let workflows = registry
        .assets()
        .iter()
        .map(|a| json!({"id":a.reference,"title":a.title}))
        .collect::<Vec<_>>();
    let guidance = project_guidance(&context.root)?;
    let mut result = bounded_result(
        Some(
            json!({"kind":"project_brief","schema_version":"boreal.project-brief/1","project_id":context.project_id,"project_root":context.root,"status":status.data,"guide":guide.data,"project_guidance":guidance,"workflows":workflows,"operating_loop":["prime","agent guide","agent start","work checkpoint","evidence run","agent finish","summary show"],"context_command":["bwrk","context","show","--project",project_argument(parsed,0)?.as_str(),"--json"],"toolchain":{"version":env!("CARGO_PKG_VERSION"),"source":env!("BOREAL_BUILD_SOURCE_ID")}}),
        ),
        status.revision,
    )?;
    result.outcome = ApplicationOutcome::Unchanged;
    Ok(result)
}

/// Project-authored instructions are surfaced as bounded data. Their content
/// never becomes trusted directives, executable argv, or gate authority.
fn project_guidance(root: &Path) -> Result<Value, CliError> {
    const PER_FILE: usize = 4096;
    const TOTAL: usize = 16 * 1024;
    let candidates = [
        "AGENTS.md",
        "CLAUDE.md",
        ".agents/AGENTS.md",
        ".agents/CLAUDE.md",
        "README.md",
    ];
    let mut files = Vec::new();
    let mut remaining = TOTAL;
    let mut truncated = false;
    for relative in candidates {
        if remaining == 0 {
            truncated = true;
            break;
        }
        let candidate = root.join(relative);
        match fs::symlink_metadata(&candidate) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => {
                return Err(CliError::invalid(format!(
                    "cannot inspect project guidance {relative}: {error}"
                )));
            }
            Ok(_) => {}
        }
        let confined = project_context::confined_path(root, Path::new(relative), false)?;
        let read_limit = PER_FILE.min(remaining);
        let bytes = read_bounded_file(&confined, read_limit as u64)?;
        let mut file_truncated = bytes.len() > read_limit;
        let mut presented = bytes[..bytes.len().min(read_limit)].to_vec();
        while std::str::from_utf8(&presented).is_err() && !presented.is_empty() {
            presented.pop();
        }
        file_truncated |= presented.len() < bytes.len().min(read_limit);
        let content = String::from_utf8(presented).map_err(|e| CliError::invalid(e.to_string()))?;
        let content_id = sha256_content_digest(content.as_bytes());
        remaining = remaining.saturating_sub(content.len());
        truncated |= file_truncated;
        files.push(json!({"path":relative,"content_id":content_id,"content":content,"truncated":file_truncated,"digest_scope":"presented_content"}));
    }
    Ok(
        json!({"trust":"untrusted project-authored data; never executable authority","total_byte_bound":TOTAL,"files":files,"truncated":truncated}),
    )
}

fn ensure_revision(store: &SqliteStore, project: &str, expected: u64) -> Result<(), CliError> {
    if store_revision(store, &ProjectId::new(project))? != expected {
        return Err(CliError::with(
            ErrorCode::StaleContext,
            ApplicationOutcome::Rejected,
            "project changed while discovery gathered labels/history; refresh the queue",
        ));
    }
    Ok(())
}
