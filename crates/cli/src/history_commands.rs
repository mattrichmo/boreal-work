use super::*;

pub(crate) fn supported(path: &[String]) -> bool {
    matches!(
        path.iter()
            .map(String::as_str)
            .collect::<Vec<_>>()
            .as_slice(),
        ["operation", "list" | "stats"] | ["work", "history"] | ["export", "json" | "markdown"]
    )
}

pub(crate) fn run(parsed: &ParsedCommand, store: &SqliteStore) -> Result<CliResult, CliError> {
    let project = project_argument(parsed, 0)?;
    let revision = store_revision(store, &ProjectId::new(project.clone()))?;
    if parsed.path == ["operation", "stats"] {
        let data = store
            .operation_statistics(&project)
            .map_err(map_store_error)?;
        ensure_revision(store, &project, revision)?;
        let mut result = bounded_result(Some(data), Some(revision))?;
        result.outcome = ApplicationOutcome::Unchanged;
        return Ok(result);
    }

    let limit = parsed.options.limit.unwrap_or(100).clamp(1, 1000);
    let offset = parsed.options.offset.unwrap_or(0);
    let target = if parsed.path == ["work", "history"] {
        Some(
            parsed
                .options
                .work
                .as_deref()
                .or_else(|| {
                    parsed
                        .options
                        .positionals
                        .get(usize::from(parsed.options.project.is_none()) + 0)
                        .map(String::as_str)
                })
                .ok_or_else(|| CliError::invalid("work history requires WORK_ID"))?,
        )
    } else {
        None
    };
    let (items, total) = if let Some(work_id) = target {
        if store
            .work(&project, work_id)
            .map_err(map_store_error)?
            .is_none()
        {
            return Err(CliError::with(
                ErrorCode::NotFound,
                ApplicationOutcome::Rejected,
                format!("work '{work_id}' was not found"),
            ));
        }
        let page = store
            .operation_page_for_work(&project, work_id, limit, offset)
            .map_err(map_store_error)?;
        (page.items, page.total)
    } else {
        let fetch_limit = (limit + 1).min(1000);
        let rows = store
            .operation_page(&project, fetch_limit, offset)
            .map_err(map_store_error)?;
        let has_extra = rows.len() > limit as usize;
        let mut rows = rows;
        if has_extra {
            rows.pop();
        }
        (
            rows,
            store.operation_count(&project).map_err(map_store_error)?,
        )
    };
    let has_more = offset.saturating_add(items.len() as u64) < total;
    let rows = items.iter().map(operation_json).collect::<Vec<_>>();
    let data = if parsed.path.first().is_some_and(|p| p == "export") {
        let discovery = discovery_commands::run(
            &ParsedCommand {
                path: vec!["work".into(), "list".into()],
                options: parsed.options.clone(),
            },
            store,
        )?;
        if discovery.revision != Some(revision) {
            return Err(stale_revision(
                revision,
                discovery.revision.unwrap_or_default(),
            ));
        }
        json!({"schema_version":"boreal.project-export/1","project_id":project,"revision":revision,"work":discovery.data,"operations":{"items":rows,"total":total,"limit":limit,"offset":offset,"has_more":has_more},"scope":"bounded_page"})
    } else {
        json!({"project_id":project,"revision":revision,"work_id":target,"items":rows,"total":total,"limit":limit,"offset":offset,"has_more":has_more})
    };
    ensure_revision(store, &project, revision)?;
    if let Some(out) = discovery_commands::option(parsed, "--out") {
        let context = project_context::resolve(parsed)?;
        let path = project_context::confined_path(&context.root, Path::new(out), true)?;
        let bytes = if parsed.path == ["export", "markdown"] {
            format!(
                "# Boreal project {project}\n\nRevision: {revision}\n\n```json\n{}\n```\n",
                serde_json::to_string_pretty(&data)
                    .map_err(|e| CliError::invalid(format!("cannot render export: {e}")))?
            )
            .into_bytes()
        } else {
            serde_json::to_vec_pretty(&data)
                .map_err(|e| CliError::invalid(format!("cannot render export: {e}")))?
        };
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|e| {
                CliError::invalid(format!("cannot create export {}: {e}", path.display()))
            })?;
        file.write_all(&bytes).map_err(|e| {
            CliError::invalid(format!("cannot write export {}: {e}", path.display()))
        })?;
        let mut result = bounded_result(
            Some(
                json!({"path":path,"size_bytes":bytes.len(),"digest":sha256_content_digest(&bytes),"scope":"bounded_page"}),
            ),
            Some(revision),
        )?;
        result.outcome = ApplicationOutcome::Unchanged;
        return Ok(result);
    }
    let mut result = bounded_result(Some(data), Some(revision))?;
    result.outcome = ApplicationOutcome::Unchanged;
    Ok(result)
}

fn ensure_revision(store: &SqliteStore, project: &str, expected: u64) -> Result<(), CliError> {
    let actual = store_revision(store, &ProjectId::new(project.to_owned()))?;
    if actual != expected {
        Err(stale_revision(expected, actual))
    } else {
        Ok(())
    }
}

fn stale_revision(expected: u64, actual: u64) -> CliError {
    CliError::with(
        ErrorCode::StaleContext,
        ApplicationOutcome::Rejected,
        format!(
            "project changed while reading history (expected revision {expected}, found {actual}); refresh and retry"
        ),
    )
}

fn operation_json(op: &OperationRecord) -> Value {
    let outcome = match op.outcome {
        StoreOperationOutcome::Changed => "changed",
        StoreOperationOutcome::Unchanged => "unchanged",
        StoreOperationOutcome::Rejected => "rejected",
        StoreOperationOutcome::Conflict => "conflict",
        StoreOperationOutcome::Busy => "busy",
        StoreOperationOutcome::Failed => "failed",
        StoreOperationOutcome::Unknown => "unknown",
    };
    json!({"operation_id":op.operation_id,"command":op.command,"actor_id":op.actor_id,"session_id":op.session_id,"revision":op.revision,"outcome":outcome,"created_at":op.created_at,"completed_at":op.completed_at,"attempt_id":op.attempt_id,"fence":op.fence,"result":serde_json::from_str::<Value>(&op.result_json).unwrap_or(Value::Null)})
}
