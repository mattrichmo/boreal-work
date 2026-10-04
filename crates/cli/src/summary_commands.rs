//! Durable summary and handoff command handlers.
use super::*;
use boreal_application::{SummaryPayload, SummaryQueries};

pub(crate) fn supported(path: &[String]) -> bool {
    matches!(
        path.first().map(String::as_str),
        Some("summary" | "handoff")
    )
}

pub(crate) fn run(
    parsed: &ParsedCommand,
    operation: &str,
    store: &SqliteStore,
) -> Result<CliResult, CliError> {
    match parsed.path.first().map(String::as_str) {
        Some("summary") => run_summary(parsed, operation, store),
        Some("handoff") => run_handoff(parsed, store),
        _ => Err(CliError::invalid("unknown summary or handoff command")),
    }
}

fn run_summary(
    parsed: &ParsedCommand,
    operation: &str,
    store: &SqliteStore,
) -> Result<CliResult, CliError> {
    let action = parsed.path.get(1).map(String::as_str).unwrap_or("");
    let project = project_argument(parsed, 0)?;
    let queries = SummaryQueries::new(store);
    match action {
        "list" => {
            let work = extra(parsed, "work");
            let limit = parsed.options.limit.unwrap_or(25).clamp(1, 100);
            let offset = parsed.options.offset.unwrap_or(0);
            let page = queries
                .list(&project, work, limit, offset)
                .map_err(map_store_error)?;
            let data = json!({"items": page.items.iter().map(|item| json!({"summary": summary_json(&item.summary), "body": item.body})).collect::<Vec<_>>(), "limit": page.limit, "offset": page.offset, "has_more": page.has_more});
            Ok(CliResult {
                outcome: ApplicationOutcome::Unchanged,
                data: Some(data),
                human: Some(format!("{} summaries", page.items.len())),
                ..CliResult::default()
            })
        }
        "show" | "render" => {
            let id = positional(parsed, 0)
                .or_else(|| extra(parsed, "summary"))
                .ok_or_else(|| CliError::invalid("summary show requires SUMMARY_ID"))?;
            let artifact = queries.show(&project, id).map_err(map_store_error)?;
            if action == "render" {
                let body = artifact.body.ok_or_else(|| {
                    CliError::with(
                        ErrorCode::NotFound,
                        ApplicationOutcome::Rejected,
                        "summary body is unavailable; this summary predates durable body storage",
                    )
                })?;
                if let Some(path) = extra(parsed, "out") {
                    let context = project_context::resolve(parsed)?;
                    let path =
                        project_context::confined_path(&context.root, Path::new(path), true)?;
                    write_new_output(&path, body.as_bytes())?;
                }
                return Ok(CliResult {
                    outcome: ApplicationOutcome::Unchanged,
                    data: Some(
                        json!({"summary_id": artifact.summary.summary_id, "body": body, "written_to": extra(parsed, "out")}),
                    ),
                    human: Some(body),
                    ..CliResult::default()
                });
            }
            Ok(CliResult {
                outcome: ApplicationOutcome::Unchanged,
                data: Some(
                    json!({"summary": summary_json(&artifact.summary), "body": artifact.body}),
                ),
                ..CliResult::default()
            })
        }
        "compose" | "create" => create_or_compose(parsed, operation, store, action == "create"),
        "backfill" => backfill_legacy(parsed, operation, store),
        _ => Err(CliError::invalid(
            "summary supports list, show, render, compose, create, and backfill",
        )),
    }
}

fn create_or_compose(
    parsed: &ParsedCommand,
    operation: &str,
    store: &SqliteStore,
    persist: bool,
) -> Result<CliResult, CliError> {
    let project = project_argument(parsed, 0)?;
    let work = extra(parsed, "work")
        .or(parsed.options.work.as_deref())
        .or_else(|| {
            positional(
                parsed,
                if parsed.options.project.is_some() {
                    0
                } else {
                    1
                },
            )
        })
        .ok_or_else(|| CliError::invalid("summary compose/create requires --work WORK_ID"))?;
    if !persist {
        let briefing = compose_work_brief(parsed, store, &project, work)?;
        return Ok(CliResult {
            outcome: ApplicationOutcome::Unchanged,
            data: Some(json!({"work_id": work, "body": briefing, "persisted": false})),
            human: Some(briefing),
            ..CliResult::default()
        });
    }
    let body = read_summary_body_input(parsed)?;
    let attempt_id =
        parsed.options.attempt.as_deref().ok_or_else(|| {
            CliError::invalid("summary compose/create requires --attempt ATTEMPT_ID")
        })?;
    let fence = parsed
        .options
        .fence
        .ok_or_else(|| CliError::invalid("summary compose/create requires --fence N"))?;
    let attempt = store
        .proof_attempt(&project, attempt_id)
        .map_err(map_store_error)?;
    if attempt.work_id != work || attempt.fence != fence {
        return Err(CliError::with(
            ErrorCode::StaleFence,
            ApplicationOutcome::Rejected,
            "attempt does not match the requested work and fence",
        ));
    }
    if attempt.actor_id != parsed.options.actor
        || attempt.session_id.as_deref() != Some(parsed.options.session.as_str())
    {
        return Err(CliError::with(
            ErrorCode::PermissionDenied,
            ApplicationOutcome::Rejected,
            "summary must be composed by the current attempt owner and session",
        ));
    }
    let source = attempt
        .source_version_id
        .as_deref()
        .ok_or_else(|| CliError::invalid("attempt has no pinned source version"))?;
    let pin = boreal_store::profiles::ProfileStore::new(store)
        .current_pinned_requirements(&project, work)
        .map_err(map_store_error)?;
    let summary_id = extra(parsed, "id").map(str::to_owned).unwrap_or_else(|| {
        format!(
            "summary-{attempt_id}-{}",
            operation.trim_start_matches("op_")
        )
    });
    let payload = SummaryPayload {
        summary_id: summary_id.to_owned(),
        work_id: WorkId::new(work.to_owned()),
        attempt_id: AttemptId::new(attempt_id.to_owned()),
        fence: Fence::new(fence),
        source_snapshot_hash: SourceVersionId::new(source.to_owned()),
        config_identity: ConfigIdentity::new(attempt.config_identity.clone()),
        profile_id: boreal_domain::ProfileId::new(pin.profile.profile_id.clone()),
        profile_version: pin.profile.version.to_string(),
        body_digest: sha256_content_digest(body.as_bytes()),
        body_size: body.len() as u64,
    };
    if parsed.options.expected_revision.is_none() {
        return Err(CliError::invalid(
            "summary create requires --expected-revision",
        ));
    }
    let app = WorkApplication::new(store);
    let result = app
        .record_summary_with_body(
            &project,
            &parsed.options.actor,
            Some(&parsed.options.session),
            &payload,
            &body,
            operation,
            parsed.options.expected_revision,
            TimestampMs::from_millis(now_ms_u64()),
        )
        .map_err(map_application_error)?;
    Ok(CliResult {
        outcome: if result.replayed {
            ApplicationOutcome::Unchanged
        } else {
            ApplicationOutcome::Changed
        },
        revision: Some(result.revision),
        data: Some(json!({"summary": summary_json(&result.summary), "body": body})),
        ..CliResult::default()
    })
}

fn run_handoff(parsed: &ParsedCommand, store: &SqliteStore) -> Result<CliResult, CliError> {
    let action = parsed.path.get(1).map(String::as_str).unwrap_or("compose");
    if !matches!(action, "compose" | "show") {
        return Err(CliError::invalid("handoff supports compose and show"));
    }
    let project = project_argument(parsed, 0)?;
    let work = extra(parsed, "work")
        .or(parsed.options.work.as_deref())
        .ok_or_else(|| CliError::invalid("handoff requires --work WORK_ID"))?;
    let summary = SummaryQueries::new(store)
        .current_for_work(&project, work)
        .map_err(map_store_error)?;
    let (summary_id, attempt_id, fence, body) = if let Some(summary) = summary {
        let body = match summary.body {
            Some(body) => body,
            None => compose_work_brief(parsed, store, &project, work)?,
        };
        (
            Some(summary.summary.summary_id),
            Some(summary.summary.attempt_id),
            Some(summary.summary.fence),
            body,
        )
    } else {
        (
            None,
            None,
            None,
            compose_work_brief(parsed, store, &project, work)?,
        )
    };
    let extra_note = extra(parsed, "note").unwrap_or("");
    let rendered = if extra_note.trim().is_empty() {
        body.clone()
    } else {
        format!("{body}\n\n## Handoff note\n\n{extra_note}")
    };
    let bounded = truncate_utf8(&rendered, 16 * 1024);
    let written_to = if let Some(path) = extra(parsed, "out") {
        let context = project_context::resolve(parsed)?;
        let path = project_context::confined_path(&context.root, Path::new(path), true)?;
        write_new_output(&path, bounded.as_bytes())?;
        Some(path.to_string_lossy().to_string())
    } else {
        None
    };
    Ok(CliResult {
        outcome: ApplicationOutcome::Unchanged,
        data: Some(
            json!({"project_id": project, "work_id": work, "summary_id": summary_id, "attempt_id": attempt_id, "fence": fence, "body": bounded, "written_to": written_to, "truncated": bounded.len() < rendered.len()}),
        ),
        human: Some(bounded.to_owned()),
        ..CliResult::default()
    })
}

fn read_summary_body_input(parsed: &ParsedCommand) -> Result<String, CliError> {
    let file = parsed
        .options
        .input
        .as_deref()
        .or(parsed.options.summary.as_deref())
        .or_else(|| extra(parsed, "input"));
    if extra(parsed, "body").is_some() && file.is_some() {
        return Err(CliError::invalid(
            "summary create requires either --body or --input, not both",
        ));
    }
    if parsed.options.input.is_some() && parsed.options.summary.is_some() {
        return Err(CliError::invalid("choose one summary input file"));
    }
    if let Some(text) = extra(parsed, "body") {
        return Ok(text.to_owned());
    }
    let path = file
        .ok_or_else(|| CliError::invalid("summary create requires --body TEXT or --input PATH"))?;
    read_summary_file(parsed, path)
}
fn read_summary_file(parsed: &ParsedCommand, path: &str) -> Result<String, CliError> {
    let context = project_context::resolve(parsed)?;
    let path = project_context::confined_path(&context.root, Path::new(path), false)?;
    let bytes = read_bounded_file(&path, boreal_store::MAX_SUMMARY_BODY_BYTES)?;
    if bytes.is_empty() {
        return Err(CliError::invalid("summary body must not be empty"));
    }
    String::from_utf8(bytes).map_err(|_| CliError::invalid("summary body must be UTF-8 text"))
}
fn compose_work_brief(
    parsed: &ParsedCommand,
    store: &SqliteStore,
    project: &str,
    work_id: &str,
) -> Result<String, CliError> {
    let revision = store_revision(store, &ProjectId::new(project))?;
    let work = store
        .work(project, work_id)
        .map_err(map_store_error)?
        .ok_or_else(|| {
            CliError::with(
                ErrorCode::NotFound,
                ApplicationOutcome::Rejected,
                format!("work '{work_id}' was not found"),
            )
        })?;
    let status = store
        .read_project_status(project)
        .map_err(map_store_error)?;
    let row = status
        .works
        .iter()
        .find(|row| row.work.id.as_str() == work_id);
    let mut body = format!(
        "# Handoff: {}\n\n- Project: {}\n- Work: {} ({})\n- Lifecycle: {}\n\n## Goal\n\n{}\n\n## Current state\n\n",
        work.title,
        project,
        work_id,
        work.kind,
        work.lifecycle,
        nonempty(&work.description, "No description is recorded.")
    );
    if let Some(row) = row {
        body.push_str(&format!(
            "- Required gates: {}\n- Gate status: {} observed; missing: {}\n",
            row.gate_diagnostics
                .gates
                .iter()
                .filter(|gate| gate.required)
                .count(),
            row.gate_diagnostics.gates.len(),
            if row.gate_diagnostics.missing.is_empty() {
                "none".to_owned()
            } else {
                row.gate_diagnostics.missing.join(", ")
            }
        ));
        if let Some(attempt) = &row.current_attempt {
            body.push_str(&format!("- Current attempt: {} (fence {})\n- Owner: {}\n- Phase: {:?}\n- Source: {}\n- Config: {}\n", attempt.attempt_id, attempt.fence, attempt.actor_id, attempt.phase, attempt.source_version_id.as_deref().unwrap_or("missing"), attempt.config_identity));
        } else {
            body.push_str("- Current attempt: none\n");
        }
        if !row.work.hard_holds.is_empty() {
            body.push_str(&format!(
                "- Holds: {}\n",
                row.work
                    .hard_holds
                    .iter()
                    .map(|hold| hold.stable_code())
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }
    }
    let deps = status
        .dependencies
        .iter()
        .filter(|edge| edge.dependent_id.as_str() == work_id)
        .map(|edge| edge.prerequisite_id.as_str())
        .collect::<Vec<_>>();
    if !deps.is_empty() {
        body.push_str(&format!("- Prerequisites: {}\n", deps.join(", ")));
    }
    body.push_str("\n## Completed work\n\nAdd concrete changes and commit references.\n\n## Verification and evidence\n\nRecord commands, results, and Boreal receipt references.\n\n## Remaining work and risks\n\nIdentify unfinished work or blockers.\n\n## Next action\n\nFollow `bwrk agent guide` and the current trusted directive.\n");
    if let Some(note) = extra(parsed, "note").filter(|note| !note.trim().is_empty()) {
        body.push_str(&format!("\n## Note\n\n{note}\n"));
    }
    if let Some(context) = extra(parsed, "body").filter(|body| !body.trim().is_empty()) {
        body.push_str(&format!("\n## Additional context\n\n{context}\n"));
    }
    if body.len() > boreal_store::MAX_SUMMARY_BODY_BYTES as usize {
        return Err(CliError::invalid(
            "composed briefing exceeds the 64 KiB bound",
        ));
    }
    if store_revision(store, &ProjectId::new(project))? != revision {
        return Err(CliError::with(
            ErrorCode::StaleContext,
            ApplicationOutcome::Rejected,
            "project changed while composing work context; refresh the summary",
        ));
    }
    Ok(body)
}
fn nonempty<'a>(value: &'a str, fallback: &'a str) -> &'a str {
    if value.trim().is_empty() {
        fallback
    } else {
        value
    }
}

fn backfill_legacy(
    parsed: &ParsedCommand,
    operation: &str,
    store: &SqliteStore,
) -> Result<CliResult, CliError> {
    if parsed.path.get(2).is_some_and(|arg| arg == "show") {
        let project = project_argument(parsed, 0)?;
        let import_id = positional(
            parsed,
            if parsed.options.project.is_some() {
                0
            } else {
                1
            },
        )
        .or_else(|| extra(parsed, "subject"))
        .ok_or_else(|| CliError::invalid("summary backfill show requires IMPORT_ID"))?;
        let record = store
            .legacy_summary_backfill(&project, import_id)
            .map_err(map_store_error)?
            .ok_or_else(|| {
                CliError::with(
                    ErrorCode::NotFound,
                    ApplicationOutcome::Rejected,
                    "legacy summary import not found",
                )
            })?;
        return Ok(CliResult {
            outcome: ApplicationOutcome::Unchanged,
            data: Some(json!({"import": backfill_json(&record), "proof_eligible": false})),
            ..CliResult::default()
        });
    }
    if !parsed.options.setup.yes {
        return Err(CliError::invalid(
            "summary backfill requires --yes after reviewing its historical-only disposition",
        ));
    }
    let project = project_argument(parsed, 0)?;
    let path = extra(parsed, "input")
        .or(parsed.options.input.as_deref())
        .ok_or_else(|| CliError::invalid("summary backfill requires --input PATH"))?;
    let context = project_context::resolve(parsed)?;
    let path = project_context::confined_path(&context.root, Path::new(path), false)?;
    let bytes = read_bounded_file(&path, boreal_store::MAX_SUMMARY_BODY_BYTES)?;
    let value: Value = serde_json::from_slice(&bytes)
        .map_err(|e| CliError::invalid(format!("legacy summary must be valid JSON: {e}")))?;
    if !value.is_object() {
        return Err(CliError::invalid("legacy summary must be a JSON object"));
    }
    let legacy_id = extra(parsed, "subject")
        .or_else(|| value.get("summary_id").and_then(Value::as_str))
        .or_else(|| value.get("id").and_then(Value::as_str))
        .ok_or_else(|| CliError::invalid("legacy summary needs an id or --subject"))?;
    let reason = parsed
        .options
        .reason
        .as_deref()
        .filter(|v| !v.trim().is_empty())
        .ok_or_else(|| {
            CliError::invalid(
                "summary backfill requires --reason explaining its historical disposition",
            )
        })?;
    let revision = parsed
        .options
        .expected_revision
        .ok_or_else(|| CliError::invalid("summary backfill requires --expected-revision"))?;
    let session = parsed.options.session.as_str();
    let record_json = serde_json::to_string(&value)
        .map_err(|e| CliError::invalid(format!("cannot canonicalize legacy summary: {e}")))?;
    let result = store
        .backfill_legacy_summary(&boreal_store::LegacySummaryBackfillRequest {
            project_id: project,
            actor_id: parsed.options.actor.clone(),
            session_id: session.to_owned(),
            expected_project_revision: revision,
            operation_id: operation.to_owned(),
            legacy_id: legacy_id.to_owned(),
            reason: reason.to_owned(),
            source_ref: extra(parsed, "source").map(str::to_owned),
            record_json,
            created_at: stamp(now_ms_u64()),
        })
        .map_err(map_store_error)?;
    let revision = store
        .project_revision(&result.project_id)
        .map_err(map_store_error)?
        .0;
    Ok(CliResult {
        outcome: ApplicationOutcome::Changed,
        revision: Some(revision),
        data: Some(json!({"import": backfill_json(&result), "proof_eligible": false})),
        ..CliResult::default()
    })
}

fn backfill_json(r: &boreal_store::LegacySummaryBackfillRecord) -> Value {
    json!({"import_id": r.import_id, "project_id": r.project_id, "legacy_id": r.legacy_id, "actor_id": r.actor_id, "reason": r.reason, "source_ref": r.source_ref, "record": serde_json::from_str::<Value>(&r.record_json).unwrap_or(Value::Null), "created_at": r.created_at})
}
fn summary_json(s: &boreal_store::SummaryRecord) -> Value {
    json!({"summary_id": s.summary_id, "project_id": s.project_id, "work_id": s.work_id, "attempt_id": s.attempt_id, "fence": s.fence, "subject_ref": s.subject_ref, "source_version_id": s.source_version_id, "config_identity": s.config_identity, "profile_id": s.profile_id, "profile_version": s.profile_version, "body_digest": s.body_digest, "body_size": s.body_size, "current": s.current, "created_at": s.created_at})
}
fn extra<'a>(parsed: &'a ParsedCommand, key: &str) -> Option<&'a str> {
    parsed
        .options
        .extra
        .get(key)
        .or_else(|| parsed.options.extra.get(&format!("--{key}")))
        .and_then(|values| values.last())
        .map(String::as_str)
}
fn positional(parsed: &ParsedCommand, index: usize) -> Option<&str> {
    parsed.options.positionals.get(index).map(String::as_str)
}
fn truncate_utf8(value: &str, max: usize) -> &str {
    if value.len() <= max {
        value
    } else {
        let mut end = max;
        while !value.is_char_boundary(end) {
            end -= 1;
        }
        &value[..end]
    }
}
fn write_new_output(path: &Path, bytes: &[u8]) -> Result<(), CliError> {
    use std::io::Write;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| CliError::invalid(format!("cannot create output {}: {e}", path.display())))?;
    file.write_all(bytes)
        .map_err(|e| CliError::invalid(format!("cannot write output {}: {e}", path.display())))?;
    Ok(())
}
