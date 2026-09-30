//! Reviewable duplicate and compaction commands plus the memory scaffold alias.
use super::*;
use boreal_application::{KnowledgeMaintenanceApplication, canonical_request_digest};
use boreal_store::V3MutationContext;

pub(crate) fn supported(path: &[String]) -> bool {
    matches!(path,[a,b] if (a=="duplicate"&&b=="scan") || (a=="merge"&&matches!(b.as_str(),"plan"|"apply"|"show")) || (a=="compact"&&matches!(b.as_str(),"analyze"|"apply"|"show")) || (a=="vault"&&b=="init") || (a=="memory"&&b=="init"))
}

pub(crate) fn run(
    parsed: &ParsedCommand,
    operation: &str,
    store: &SqliteStore,
) -> Result<CliResult, CliError> {
    if parsed.path == ["vault", "init"] || parsed.path == ["memory", "init"] {
        return init_memory(parsed);
    }
    let project = project_argument(parsed, 0)?;
    let app = KnowledgeMaintenanceApplication::new(store);
    match parsed.path.as_slice() {
        [_, action] if action == "scan" => {
            let limit = parsed.options.limit.unwrap_or(1000);
            let value = app
                .duplicate_scan(&project, limit)
                .map_err(maintenance_error)?;
            let context = project_context::resolve(parsed)?;
            let mut value = value;
            let memory_root =
                project_context::confined_path(&context.root, Path::new("memory"), true)?;
            let manifest_exists = if !memory_root.exists() {
                false
            } else {
                if !memory_root.is_dir() {
                    return Err(CliError::invalid(
                        "project memory root exists but is not a directory",
                    ));
                }
                let manifest =
                    project_context::confined_path(&memory_root, Path::new("manifest.json"), true)?;
                match fs::symlink_metadata(&manifest) {
                    Ok(metadata) if metadata.is_file() => true,
                    Ok(_) => {
                        return Err(CliError::invalid(
                            "published memory manifest path exists but is not a regular file",
                        ));
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
                    Err(error) => {
                        return Err(CliError::invalid(format!(
                            "cannot inspect published memory manifest: {error}"
                        )));
                    }
                }
            };
            if manifest_exists {
                let root = boreal_memory::MemoryRoot::new(memory_root.clone()).map_err(|e| {
                    CliError::invalid(format!("published memory root is invalid: {e}"))
                })?;
                let imported = boreal_memory::Publisher::deferred(root)
                    .reimport(&project)
                    .map_err(|e| {
                        CliError::invalid(format!(
                            "published memory manifest cannot be validated: {e}"
                        ))
                    })?;
                if imported.entries.len() as u64 > limit {
                    return Err(CliError::invalid(format!(
                        "published memory has more than the requested {limit} entries; increase --limit for a complete duplicate scan"
                    )));
                }
                let mut by_digest = std::collections::BTreeMap::<String, Vec<Value>>::new();
                let entry_count = imported.entries.len();
                for entry in imported.entries {
                    by_digest.entry(entry.content_digest.clone()).or_default().push(json!({"id":entry.memory_entry_id,"title":entry.manifest_path,"content_digest":entry.content_digest,"authority":"published_git","git_revision":imported.git_revision,"manifest_identity":imported.manifest_identity}));
                }
                let mut groups = value["groups"].as_array().cloned().unwrap_or_default();
                for (digest, members) in by_digest {
                    if members.len() > 1 {
                        groups.push(json!({"kind":"published_memory","identity_digest":digest,"members":members}));
                    }
                }
                groups.sort_by(|a, b| {
                    a["kind"].as_str().cmp(&b["kind"].as_str()).then(
                        a["identity_digest"]
                            .as_str()
                            .cmp(&b["identity_digest"].as_str()),
                    )
                });
                value["groups"] = json!(groups);
                value["published_git_memory"] = json!({"scanned":true,"git_revision":imported.git_revision,"manifest_identity":imported.manifest_identity,"entry_count":entry_count});
            } else {
                value["published_git_memory"] =
                    json!({"scanned":false,"reason":"no published memory manifest exists"});
            }
            let revision = value["revision"].as_u64();
            let mut result = bounded_result(Some(value), revision)?;
            result.outcome = ApplicationOutcome::Unchanged;
            Ok(result)
        }
        [a, b] if a == "merge" && b == "plan" => {
            let input = input_object(parsed)?;
            if field(&input, "source_kind")? == "published_memory" {
                let source_id = field(&input, "source_id")?;
                let canonical_id = field(&input, "canonical_id")?;
                if field(&input, "canonical_kind")? != "published_memory" {
                    return Err(CliError::invalid("published memory can only be consolidated with another published memory entry"));
                }
                let (report, _) = published_memory_snapshot(parsed, &project)?;
                let source = published_entry(&report, source_id)?;
                let canonical = published_entry(&report, canonical_id)?;
                if source_id == canonical_id { return Err(CliError::invalid("merge source and canonical item must differ")); }
                let revision = store.project_revision(&project).map_err(map_store_error)?.0;
                let digest = published_plan_digest("merge", &project, revision, &report, source_id, &source.content_digest, canonical_id, Some(&canonical.content_digest));
                let mut citations = source.source_citations.clone(); citations.extend(canonical.source_citations.clone()); citations.sort(); citations.dedup();
                let mut result = bounded_result(Some(json!({"schema":"boreal.maintenance.merge-plan.v1","project_id":project,"revision":revision,"plan_digest":digest,"source":{"kind":"published_memory","id":source_id,"content_digest":source.content_digest},"canonical":{"kind":"published_memory","id":canonical_id,"content_digest":canonical.content_digest},"source_citations":citations,"git_revision":report.git_revision,"manifest_identity":report.manifest_identity,"effect":"prepare a new cited memory draft pending independent review and normal Git publication; both original entries remain unchanged","proof_transfer":false})), Some(revision))?;
                result.outcome = ApplicationOutcome::Unchanged;
                return Ok(result);
            }
            let plan = app
                .merge_plan(
                    &project,
                    field(&input, "source_kind")?,
                    field(&input, "source_id")?,
                    field(&input, "canonical_kind")?,
                    field(&input, "canonical_id")?,
                )
                .map_err(maintenance_error)?;
            let data = json!({"schema":"boreal.maintenance.merge-plan.v1","project_id":project,"revision":plan.revision,"plan_digest":plan.plan_digest,"source":{"kind":plan.source_kind,"id":plan.source_id,"content_digest":plan.source_digest},"canonical":{"kind":plan.canonical_kind,"id":plan.canonical_id,"content_digest":plan.canonical_digest},"effect":"append-only alias/supersession lineage; source remains visible and existing references are unchanged","proof_transfer":false});
            let mut result = bounded_result(Some(data), Some(plan.revision))?;
            result.outcome = ApplicationOutcome::Unchanged;
            Ok(result)
        }
        [a, b] if (a == "merge" || a == "compact") && b == "show" => {
            let input = input_object(parsed)?;
            let value = app
                .maintenance_annotations(
                    &project,
                    field(&input, "source_kind")?,
                    field(&input, "source_id")?,
                    parsed.options.limit.unwrap_or(20),
                    parsed.options.offset.unwrap_or(0),
                )
                .map_err(maintenance_error)?;
            let revision = value["revision"].as_u64();
            let mut result = bounded_result(Some(value), revision)?;
            result.outcome = ApplicationOutcome::Unchanged;
            Ok(result)
        }
        [a, b] if a == "merge" && b == "apply" => {
            require_confirmation(parsed, "merge apply")?;
            let expected = expected_revision(parsed)?;
            let input = input_object(parsed)?;
            let plan_digest = extra_one(parsed, "--plan")?.ok_or_else(|| {
                CliError::invalid("merge apply requires --plan PLAN_DIGEST from merge plan")
            })?;
            let source_kind = field(&input, "source_kind")?;
            let source_id = field(&input, "source_id")?;
            let canonical_kind = field(&input, "canonical_kind")?;
            let canonical_id = field(&input, "canonical_id")?;
            if source_kind == "published_memory" {
                if canonical_kind != "published_memory" { return Err(CliError::invalid("published memory can only be consolidated with another published memory entry")); }
                return apply_published_memory(parsed, store, operation, &project, &input, &plan_digest, expected, source_id, canonical_id, true);
            }
            let payload = json!({"project":project,"source_kind":source_kind,"source_id":source_id,"canonical_kind":canonical_kind,"canonical_id":canonical_id,"plan_digest":plan_digest,"expected_revision":expected});
            let context = context(
                parsed,
                operation,
                &project,
                expected,
                "maintenance.merge.apply",
                payload,
            );
            let applied = app
                .apply_merge(
                    &context,
                    &plan_digest,
                    source_kind,
                    source_id,
                    canonical_kind,
                    canonical_id,
                )
                .map_err(maintenance_error)?;
            let mut result = bounded_result(Some(applied.value), Some(applied.snapshot_revision))?;
            result.outcome = if applied.changed {
                ApplicationOutcome::Changed
            } else {
                ApplicationOutcome::Unchanged
            };
            Ok(result)
        }
        [a, b] if a == "compact" && b == "analyze" => {
            let limit = parsed.options.limit.unwrap_or(1000);
            let minimum = extra_one(parsed, "--minimum-bytes")?
                .map(|v| {
                    v.parse::<usize>()
                        .map_err(|_| CliError::invalid("--minimum-bytes must be an integer"))
                })
                .transpose()?
                .unwrap_or(2048);
            let mut value = app
                .compact_analyze(&project, limit, minimum)
                .map_err(maintenance_error)?;
            let (report, memory_root) = published_memory_snapshot_optional(parsed, &project)?;
            let revision = store.project_revision(&project).map_err(map_store_error)?.0;
            if report.as_ref().is_some_and(|report| report.entries.len() as u64 > limit) {
                return Err(CliError::invalid(format!("published memory has more than the requested {limit} entries; increase --limit for a complete compaction analysis")));
            }
            let candidates = report.as_ref().map(|report| report.entries.iter().filter_map(|entry| {
                let note_path = memory_root.as_ref()?.join(&entry.manifest_path);
                let bytes = fs::read(note_path).ok()?.len();
                if bytes < minimum { return None; }
                let source = published_plan_digest("compact", &project, revision, report, &entry.memory_entry_id, &entry.content_digest, "", None);
                Some(json!({"kind":"published_memory","id":entry.memory_entry_id,"source_revision":revision,"source_digest":entry.content_digest,"bytes":bytes,"plan_digest":source,"source_citations":entry.source_citations,"git_revision":report.git_revision,"manifest_identity":report.manifest_identity,"summary_required_from_operator":true,"original_preserved":true}))
            }).collect::<Vec<_>>()).unwrap_or_default();
            let mut existing = value["candidates"].as_array().cloned().unwrap_or_default();
            existing.extend(candidates);
            value["candidates"] = json!(existing);
            value["published_git_memory"] = match report { Some(report) => json!({"git_revision":report.git_revision,"manifest_identity":report.manifest_identity,"entries":report.entries.len()}), None => json!({"scanned":false,"reason":"no published memory manifest exists"}) };
            let revision = value["revision"].as_u64();
            let mut result = bounded_result(Some(value), revision)?;
            result.outcome = ApplicationOutcome::Unchanged;
            Ok(result)
        }
        [a, b] if a == "compact" && b == "apply" => {
            require_confirmation(parsed, "compact apply")?;
            let expected = expected_revision(parsed)?;
            let input = input_object(parsed)?;
            let plan_digest = extra_one(parsed, "--plan")?.ok_or_else(|| {
                CliError::invalid("compact apply requires --plan PLAN_DIGEST from compact analyze")
            })?;
            let source_kind = field(&input, "source_kind")?;
            let source_id = field(&input, "source_id")?;
            if source_kind == "published_memory" {
                return apply_published_memory(parsed, store, operation, &project, &input, &plan_digest, expected, source_id, "", false);
            }
            let source_revision = input
                .get("source_revision")
                .and_then(Value::as_u64)
                .ok_or_else(|| CliError::invalid("input requires integer source_revision"))?;
            let source_digest = field(&input, "source_digest")?;
            let summary = field(&input, "summary")?;
            let payload = json!({"project":project,"source_kind":source_kind,"source_id":source_id,"source_revision":source_revision,"source_digest":source_digest,"summary":summary,"plan_digest":plan_digest,"expected_revision":expected});
            let context = context(
                parsed,
                operation,
                &project,
                expected,
                "maintenance.compact.apply",
                payload,
            );
            let applied = app
                .apply_compaction(
                    &context,
                    &plan_digest,
                    source_kind,
                    source_id,
                    source_revision,
                    source_digest,
                    summary,
                )
                .map_err(maintenance_error)?;
            let mut result = bounded_result(Some(applied.value), Some(applied.snapshot_revision))?;
            result.outcome = if applied.changed {
                ApplicationOutcome::Changed
            } else {
                ApplicationOutcome::Unchanged
            };
            Ok(result)
        }
        _ => Err(CliError::invalid(
            "unsupported knowledge maintenance command",
        )),
    }
}

fn context(
    parsed: &ParsedCommand,
    operation: &str,
    project: &str,
    expected: u64,
    command: &str,
    payload: Value,
) -> V3MutationContext {
    V3MutationContext {
        project_id: project.into(),
        actor_id: parsed.options.actor.clone(),
        session_id: Some(parsed.options.session.clone()),
        operation_id: operation.into(),
        request_digest: canonical_request_digest(command, payload),
        expected_revision: Some(expected),
        now: stamp(now_ms_u64()),
    }
}

fn published_memory_snapshot(
    parsed: &ParsedCommand,
    project: &str,
) -> Result<(boreal_memory::ImportReport, PathBuf), CliError> {
    let context = project_context::resolve(parsed)?;
    let memory_root = project_context::confined_path(&context.root, Path::new("memory"), true)?;
    if !memory_root.is_dir() {
        return Err(CliError::invalid("no published memory manifest exists"));
    }
    let root = boreal_memory::MemoryRoot::new(memory_root.clone())
        .map_err(|e| CliError::invalid(format!("published memory root is invalid: {e}")))?;
    let report = boreal_memory::Publisher::deferred(root)
        .reimport(project)
        .map_err(|e| CliError::invalid(format!("published memory manifest cannot be validated: {e}")))?;
    Ok((report, memory_root))
}

fn published_memory_snapshot_optional(
    parsed: &ParsedCommand,
    project: &str,
) -> Result<(Option<boreal_memory::ImportReport>, Option<PathBuf>), CliError> {
    let context = project_context::resolve(parsed)?;
    let memory_root = project_context::confined_path(&context.root, Path::new("memory"), true)?;
    if !memory_root.exists() { return Ok((None, None)); }
    if !memory_root.is_dir() { return Err(CliError::invalid("project memory root exists but is not a directory")); }
    let manifest = project_context::confined_path(&memory_root, Path::new("manifest.json"), true)?;
    if !manifest.exists() { return Ok((None, Some(memory_root))); }
    let root = boreal_memory::MemoryRoot::new(&memory_root)
        .map_err(|e| CliError::invalid(format!("published memory root is invalid: {e}")))?;
    boreal_memory::Publisher::deferred(root).reimport(project)
        .map(|report| (Some(report), Some(memory_root))).map_err(|e| CliError::invalid(format!("published memory manifest cannot be validated: {e}")))
}

fn published_entry<'a>(
    report: &'a boreal_memory::ImportReport,
    id: &str,
) -> Result<&'a boreal_memory::ImportedEntry, CliError> {
    report.entries.iter().find(|entry| entry.memory_entry_id == id)
        .ok_or_else(|| CliError::invalid(format!("published memory entry {id} was not found in the validated manifest")))
}

fn published_plan_digest(
    action: &str,
    project: &str,
    revision: u64,
    report: &boreal_memory::ImportReport,
    source_id: &str,
    source_digest: &str,
    canonical_id: &str,
    canonical_digest: Option<&str>,
) -> String {
    canonical_request_digest("maintenance.published_memory.plan.v1", json!({
        "action":action,"project_id":project,"revision":revision,
        "git_revision":report.git_revision,"manifest_identity":report.manifest_identity,
        "source_id":source_id,"source_digest":source_digest,
        "canonical_id":canonical_id,"canonical_digest":canonical_digest
    }))
}

fn apply_published_memory(
    parsed: &ParsedCommand,
    store: &SqliteStore,
    operation: &str,
    project: &str,
    input: &Value,
    plan_digest: &str,
    expected: u64,
    source_id: &str,
    canonical_id: &str,
    merging: bool,
) -> Result<CliResult, CliError> {
    require_operator(store,project,&parsed.options.actor)?;
    store.validate_project_session(project,&parsed.options.actor,&parsed.options.session).map_err(map_store_error)?;
    let intent=boreal_application::canonical_request_digest("maintenance.published.intent",json!({"input":input,"plan":plan_digest,"expected_revision":expected,"source_id":source_id,"canonical_id":canonical_id,"merging":merging,"actor":parsed.options.actor,"session":parsed.options.session}));
    let desired = if merging { field(input, "merged_body")? } else { field(input, "summary")? };
    let entry_id = input.get("memory_entry_id").and_then(Value::as_str).map(str::to_owned)
        .unwrap_or_else(|| format!("maintenance-{}", &canonical_request_digest("maintenance.entry", json!({"operation":operation,"plan":plan_digest}))[..20]));
    let draft_id = format!("maintenance-draft-{}", &canonical_request_digest("maintenance.draft", json!({"operation":operation,"plan":plan_digest}))[..20]);
    let title = input.get("title").and_then(Value::as_str).filter(|s| !s.trim().is_empty())
        .unwrap_or("Consolidated memory");
    if let Some(existing) = store.memory_draft(project, &draft_id).map_err(map_store_error)? {
        let supplied_ids = input.get("source_citations").and_then(Value::as_array)
            .ok_or_else(|| CliError::invalid("published memory apply requires source_citations from its plan"))?;
        let ids = supplied_ids.iter().map(|v| v.as_str().ok_or_else(|| CliError::invalid("source_citations must contain strings"))).collect::<Result<Vec<_>, _>>()?;
        let mut endpoints = vec![format!("{}@{}", source_id, field(input, "git_revision")?)];
        if merging { endpoints.push(format!("{}@{}", canonical_id, field(input, "git_revision")?)); }
        let expected_body = format!("Supersedes published memory: {}\nMaintenance intent: {}\n\n{}", endpoints.join(", "), intent, desired);
        let stored_citations: Value = serde_json::from_str(&existing.citations_json).map_err(|e| CliError::invalid(e.to_string()))?;
        let expected_citations = ids.iter().map(|id| json!({"source_version_id":id,"location":format!("published memory entry {} at Git revision {}", source_id, field(input, "git_revision").unwrap_or("") )})).collect::<Vec<_>>();
        if existing.actor_id != parsed.options.actor || existing.project_revision != expected.checked_add(1).ok_or_else(||CliError::invalid("revision overflow"))? || existing.entry_id != entry_id || existing.title != title || existing.body != expected_body || stored_citations != json!(expected_citations) {
            return Err(CliError::invalid("operation ID was replayed with different published-memory maintenance content"));
        }
        let review_reason = input.get("review_reason").and_then(Value::as_str).filter(|s| !s.trim().is_empty())
            .unwrap_or("Review the operator-authored consolidation and cited source set before publication.");
        let data = json!({"state":"draft_prepared","publication_state":"inspect_memory_show_and_publication_readback","draft_id":draft_id,"entry_id":entry_id,"draft_operation_id":operation,"draft_revision":existing.project_revision,"plan_digest":plan_digest,"originals_preserved":true,"replayed":true,
            "review":{"requires_independent_reviewer_credentials":true,"draft_id":draft_id,"project_id":project,"expected_revision_at_response":draft_revision,"safe_argv":["bwrk","memory","review",draft_id,"--project",project,"--input","review.json","--expected-revision",draft_revision.to_string(),"--yes","--json"],"command":"bwrk memory review <project> <draft_id> --input review.json --expected-revision <current-revision> --yes","input":{"kind":"review","decision":"approved","reason":review_reason}},
            "publish":{"project_id":project,"review_id_from":"review_result.review_id","command":"bwrk memory publish <project> <review_id> --input publish.json --expected-revision <review-revision> --yes","input":{"kind":"publish","expected_manifest_identity":field(input,"manifest_identity")?},"requires_independent_approved_review":true}});
        let mut response = bounded_result(Some(data), Some(existing.project_revision))?;
        response.outcome = ApplicationOutcome::Unchanged;
        return Ok(response);
    }
    let (report, _) = published_memory_snapshot(parsed, project)?;
    let revision = store.project_revision(project).map_err(map_store_error)?.0;
    if revision != expected {
        return Err(CliError::invalid("project revision changed; rebuild the maintenance plan"));
    }
    let source = published_entry(&report, source_id)?;
    let source_revision = input.get("source_revision").and_then(Value::as_u64).unwrap_or(revision);
    if source_revision != expected {
        return Err(CliError::invalid("published memory plan revision is stale; analyze again"));
    }
    let supplied_manifest = field(input, "manifest_identity")?;
    let supplied_git = field(input, "git_revision")?;
    let supplied_source_digest = field(input, "source_digest")?;
    let canonical = if merging { Some(published_entry(&report, canonical_id)?) } else { None };
    let canonical_digest = if let Some(entry) = canonical { Some(entry.content_digest.as_str()) } else { None };
    if let Some(entry) = canonical {
        if input.get("canonical_digest").and_then(Value::as_str) != Some(entry.content_digest.as_str()) {
            return Err(CliError::invalid("published canonical entry changed; build a fresh plan"));
        }
    }
    if supplied_manifest != report.manifest_identity || supplied_git != report.git_revision
        || supplied_source_digest != source.content_digest
    {
        return Err(CliError::invalid("published memory manifest or source changed; build a fresh plan"));
    }
    let fresh_plan = published_plan_digest(if merging { "merge" } else { "compact" }, project, revision, &report,
        source_id, &source.content_digest, if merging { canonical_id } else { "" }, canonical_digest);
    if fresh_plan != plan_digest || input.get("plan_digest").and_then(Value::as_str).is_some_and(|x| x != plan_digest) {
        return Err(CliError::invalid("published memory plan identity differs; build a fresh plan"));
    }
    if desired.trim().is_empty() || desired.len() > 65_536 {
        return Err(CliError::invalid("consolidated memory body must contain 1..65536 bytes"));
    }
    let mut ids = source.source_citations.clone();
    if let Some(entry) = canonical { ids.extend(entry.source_citations.clone()); }
    ids.sort(); ids.dedup();
    let planned_ids = input.get("source_citations").and_then(Value::as_array)
        .ok_or_else(|| CliError::invalid("published memory apply requires source_citations from its plan"))?
        .iter().map(|value| value.as_str().map(str::to_owned).ok_or_else(|| CliError::invalid("source_citations must contain strings")))
        .collect::<Result<Vec<_>, _>>()?;
    if planned_ids != ids { return Err(CliError::invalid("published memory source citations changed; build a fresh plan")); }
    if ids.is_empty() { return Err(CliError::invalid("published memory entries have no registered source citations")); }
    let mut endpoints = vec![format!("{}@{}", source_id, report.git_revision)];
    if merging { endpoints.push(format!("{}@{}", canonical_id, report.git_revision)); }
    let body = format!("Supersedes published memory: {}\nMaintenance intent: {}\n\n{}", endpoints.join(", "), intent, desired);
    let citations = ids.into_iter().map(|source_version_id| json!({
        "source_version_id":source_version_id,
        "location":format!("published memory entry {} at Git revision {}", source_id, report.git_revision)
    })).collect::<Vec<_>>();
    let value = json!({"expected_revision":expected,"confirmed":true,"change":{"kind":"draft","draft_id":draft_id,"entry_id":entry_id,"title":title,"body":body,"citations":citations}});
    let draft = super::memory_commands::apply(store, project, &parsed.options.actor, &parsed.options.session, operation, value)?;
    let draft_revision = draft.revision.unwrap_or(expected + 1);
    let review_reason = input.get("review_reason").and_then(Value::as_str).filter(|s| !s.trim().is_empty())
        .unwrap_or("Review the operator-authored consolidation and cited source set before publication.");
    let result = json!({
        "state":"awaiting_independent_review","published":false,"draft_id":draft_id,"entry_id":entry_id,
        "draft_operation_id":operation,"draft_revision":draft_revision,"plan_digest":plan_digest,
        "source":{"id":source_id,"content_digest":source.content_digest},
        "canonical":canonical.map(|entry|json!({"id":entry.memory_entry_id,"content_digest":entry.content_digest})),
        "git_revision":report.git_revision,"manifest_identity":report.manifest_identity,
        "originals_preserved":true,"source_citations_preserved":true,
        "review":{"command":"bwrk memory review <project> <draft_id> --input review.json --expected-revision <current-revision> --yes","input":{"kind":"review","decision":"approved","reason":review_reason}},
        "publish":{"command":"bwrk memory publish <project> <review_id> --input publish.json --expected-revision <review-revision> --yes","input":{"kind":"publish","expected_manifest_identity":report.manifest_identity},"requires_independent_approved_review":true}
    });
    let mut response = bounded_result(Some(result), Some(draft_revision))?;
    response.outcome = draft.outcome;
    Ok(response)
}

fn require_confirmation(parsed: &ParsedCommand, command: &str) -> Result<(), CliError> {
    if !parsed.options.setup.yes {
        Err(CliError::invalid(format!(
            "{command} changes project state and requires --yes"
        )))
    } else {
        Ok(())
    }
}
fn expected_revision(parsed: &ParsedCommand) -> Result<u64, CliError> {
    parsed.options.expected_revision.ok_or_else(|| {
        CliError::invalid(
            "mutation requires --expected-revision from the immediately preceding plan/analyze",
        )
    })
}
fn extra_one(parsed: &ParsedCommand, key: &str) -> Result<Option<String>, CliError> {
    let Some(values) = parsed.options.extra.get(key) else {
        return Ok(None);
    };
    if values.len() != 1 {
        return Err(CliError::invalid(format!("{key} may be provided once")));
    }
    Ok(values.first().cloned())
}
fn maintenance_error(error: impl std::fmt::Display) -> CliError {
    CliError::invalid(error.to_string())
}
fn input_object(parsed: &ParsedCommand) -> Result<Value, CliError> {
    let path = parsed
        .options
        .input
        .as_deref()
        .ok_or_else(|| CliError::invalid("command requires --input JSON file"))?;
    let context = project_context::resolve(parsed)?;
    let path = project_context::confined_path(&context.root, Path::new(path), false)?;
    let value: Value =
        serde_json::from_slice(&fs::read(path).map_err(|e| CliError::invalid(e.to_string()))?)
            .map_err(|e| CliError::invalid(e.to_string()))?;
    if !value.is_object() {
        return Err(CliError::invalid("input must be a JSON object"));
    }
    Ok(value)
}
fn field<'a>(value: &'a Value, name: &str) -> Result<&'a str, CliError> {
    value
        .get(name)
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| CliError::invalid(format!("input requires non-empty string {name}")))
}

fn init_memory(parsed: &ParsedCommand) -> Result<CliResult, CliError> {
    let project = project_context::resolve(parsed)?;
    let root = project_context::confined_path(&project.root, Path::new("memory"), true)?;
    let notes = project_context::confined_path(&project.root, Path::new("memory/notes"), true)?;
    let index = project_context::confined_path(&project.root, Path::new("memory/index.md"), true)?;
    let contents = "# Boreal Project Memory\n\nReviewed, source-cited project knowledge is published under notes/ with manifest.json. Use `bwrk memory draft`, `review`, and `publish`; reconcile publication readback after interrupted writes. Raw sources and live work remain in the local `.boreal/` store.\n";
    fs::create_dir_all(&notes)
        .map_err(|e| CliError::invalid(format!("cannot initialize memory directory: {e}")))?;
    let mut created = false;
    match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&index)
    {
        Ok(mut file) => {
            file.write_all(contents.as_bytes())
                .map_err(|e| CliError::invalid(format!("cannot write memory index: {e}")))?;
            file.sync_all()
                .map_err(|e| CliError::invalid(format!("cannot sync memory index: {e}")))?;
            created = true;
        }
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            if !index.is_file() {
                return Err(CliError::invalid(
                    "memory/index.md already exists but is not a regular file",
                ));
            }
        }
        Err(e) => {
            return Err(CliError::invalid(format!(
                "cannot create memory index: {e}"
            )));
        }
    }
    #[cfg(unix)]
    if created {
        for directory in [&notes, &root, &project.root] {
            fs::File::open(directory)
                .and_then(|handle| handle.sync_all())
                .map_err(|e| {
                    CliError::invalid(format!("cannot sync memory scaffold directory: {e}"))
                })?;
        }
    }
    let data = json!({"schema":"boreal.memory.init.v1","project_id":project.project_id,"memory_root":root,"notes_directory":notes,"index":index,"created":created,"idempotent":true,"published_manifest":"created on first verified memory publication"});
    let mut result = bounded_result(Some(data), None)?;
    result.outcome = if created {
        ApplicationOutcome::Changed
    } else {
        ApplicationOutcome::Unchanged
    };
    Ok(result)
}
