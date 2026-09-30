use super::*;
pub(crate) fn supported(path: &[String]) -> bool {
    path.first().is_some_and(|p| p == "directives") || path == ["work", "labels", "set"]
}
pub(crate) fn run(
    parsed: &ParsedCommand,
    operation: &str,
    store: &SqliteStore,
) -> Result<CliResult, CliError> {
    let project = project_argument(parsed, 0)?;
    if parsed.path == ["work", "labels", "set"] {
        let work = work_argument(parsed, usize::from(parsed.options.project.is_none()))?;
        if !parsed.options.extra.contains_key("--labels")
            && !parsed.options.extra.contains_key("--label")
        {
            return Err(CliError::invalid(
                "labels set requires --labels or --label; use an explicit empty value to clear labels",
            ));
        }
        let labels = parsed
            .options
            .extra
            .get("--labels")
            .into_iter()
            .flatten()
            .chain(parsed.options.extra.get("--label").into_iter().flatten())
            .flat_map(|v| v.split(','))
            .map(|v| v.trim().to_ascii_lowercase())
            .filter(|v| !v.is_empty())
            .collect::<Vec<_>>();
        let mut labels = labels;
        labels.sort();
        labels.dedup();
        let revision = parsed
            .options
            .expected_revision
            .ok_or_else(|| CliError::invalid("labels set requires --expected-revision"))?;
        let context = boreal_application::knowledge_operation_context(
            &project,
            &parsed.options.actor,
            &parsed.options.session,
            operation,
            revision,
            &now(),
        );
        let result = boreal_application::update_work_labels(store, &context, &work, &labels)
            .map_err(map_store_error)?;
        return bounded_result(
            Some(json!({"work_id":work,"labels":labels,"replayed":result.replayed})),
            Some(result.revision),
        )
        .map(|mut value| {
            if result.replayed {
                value.outcome = ApplicationOutcome::Unchanged;
            }
            value
        });
    }
    let path = parsed.path.iter().map(String::as_str).collect::<Vec<_>>();
    match path.as_slice() {
        ["directives", "list"] => {
            require_positionals(parsed, 0, "directives list accepts no positional arguments")?;
            reject_work(parsed, "directives list")?;
            let directives = boreal_application::TRUSTED_DIRECTIVES
                .iter()
                .map(|(id, text)| json!({"id":id,"instruction":text,"shell":false,"runner":"boreal_cli"}))
                .collect::<Vec<_>>();
            let mut result = bounded_result(
                Some(
                    json!({"registry_id":"boreal.agent.directive.registry.v1","version":1,"trusted":true,"directives":directives}),
                ),
                None,
            )?;
            result.outcome = ApplicationOutcome::Unchanged;
            Ok(result)
        }
        ["directives", "show" | "explain"] => {
            require_positionals(parsed, 1, "directives show/explain requires DIRECTIVE_ID")?;
            reject_work(parsed, "directives show/explain")?;
            let id = &parsed.options.positionals[project_offset(parsed)];
            let (_, text) = boreal_application::TRUSTED_DIRECTIVES
                .iter()
                .find(|(known, _)| *known == id)
                .ok_or_else(|| {
                    CliError::with(
                        ErrorCode::NotFound,
                        ApplicationOutcome::Rejected,
                        "unknown trusted directive",
                    )
                })?;
            let mut result = bounded_result(
                Some(
                    json!({"id":id,"instruction":text,"authority":"current application action descriptors","acknowledgement":"records awareness; never satisfies an evidence gate"}),
                ),
                None,
            )?;
            result.outcome = ApplicationOutcome::Unchanged;
            Ok(result)
        }
        ["directives", "compile" | "render"] => {
            require_positionals(
                parsed,
                0,
                "directives compile/render accepts only --work WORK_ID",
            )?;
            guide_result(parsed, &WorkApplication::new(store), store)
        }
        ["directives", "ack", "create"] => {
            require_positionals(parsed, 1, "directives ack create requires DIRECTIVE_ID")?;
            let id = &parsed.options.positionals[project_offset(parsed)];
            require_trusted_directive(id)?;
            let revision = parsed.options.expected_revision.ok_or_else(|| {
                CliError::invalid("ack requires --expected-revision from compiled guide")
            })?;
            let ctx = boreal_application::knowledge_operation_context(
                &project,
                &parsed.options.actor,
                &parsed.options.session,
                operation,
                revision,
                &now(),
            );
            let result = boreal_application::acknowledge_trusted_directive(
                store,
                &ctx,
                id,
                parsed.options.work.as_deref(),
            )
            .map_err(map_store_error)?;
            bounded_result(
                Some(json!({"ack_id":operation,"directive_id":id,"replayed":result.replayed})),
                Some(result.revision),
            )
            .map(|mut value| {
                if result.replayed {
                    value.outcome = ApplicationOutcome::Unchanged;
                }
                value
            })
        }
        ["directives", "ack", "list"] => {
            if parsed.options.positionals.len() < project_offset(parsed)
                || parsed.options.positionals.len() > project_offset(parsed) + 1
            {
                return Err(CliError::invalid(
                    "directives ack list accepts at most one DIRECTIVE_ID",
                ));
            }
            let directive = parsed
                .options
                .positionals
                .get(project_offset(parsed))
                .map(String::as_str);
            if let Some(id) = directive {
                require_trusted_directive(id)?;
            }
            let work = parsed.options.work.as_deref();
            if let Some(work) = work {
                if store
                    .work(&project, work)
                    .map_err(map_store_error)?
                    .is_none()
                {
                    return Err(CliError::with(
                        ErrorCode::NotFound,
                        ApplicationOutcome::Rejected,
                        "work not found in this project",
                    ));
                }
            }
            let limit = parsed.options.limit.unwrap_or(100).clamp(1, 1000) as usize;
            let offset = parsed.options.offset.unwrap_or(0) as usize;
            let revision = store_revision(store, &ProjectId::new(project.clone()))?;
            let mut items = Vec::with_capacity(limit);
            let mut total = 0usize;
            let mut page_offset = 0u64;
            loop {
                let page = store
                    .directive_ack_page(&project, 1000, page_offset)
                    .map_err(map_store_error)?;
                if page.is_empty() {
                    break;
                }
                let count = page.len();
                for row in page {
                    if directive.is_none_or(|id| row["directive_id"].as_str() == Some(id))
                        && work.is_none_or(|id| row["work_id"].as_str() == Some(id))
                    {
                        if total >= offset && items.len() < limit {
                            items.push(row);
                        }
                        total = total.saturating_add(1);
                    }
                }
                if count < 1000 {
                    break;
                }
                page_offset = page_offset
                    .checked_add(count as u64)
                    .ok_or_else(|| CliError::invalid("acknowledgement page offset overflow"))?;
            }
            let actual = store_revision(store, &ProjectId::new(project.clone()))?;
            if actual != revision {
                return Err(CliError::with(
                    ErrorCode::StaleContext,
                    ApplicationOutcome::Rejected,
                    format!(
                        "project changed while reading directive acknowledgements (expected revision {revision}, found {actual}); retry"
                    ),
                ));
            }
            let mut result = bounded_result(
                Some(
                    json!({"project_id":project,"items":items,"total":total,"limit":limit,"offset":offset,"has_more":offset.saturating_add(items.len()) < total}),
                ),
                Some(revision),
            )?;
            result.outcome = ApplicationOutcome::Unchanged;
            Ok(result)
        }
        ["directives", "ack", "show"] => {
            require_positionals(parsed, 1, "directives ack show requires ACK_ID")?;
            reject_work(parsed, "directives ack show")?;
            let revision = store_revision(store, &ProjectId::new(project.clone()))?;
            let id = &parsed.options.positionals[project_offset(parsed)];
            let value = store
                .directive_ack_show(&project, id)
                .map_err(map_store_error)?
                .ok_or_else(|| {
                    CliError::with(
                        ErrorCode::NotFound,
                        ApplicationOutcome::Rejected,
                        "acknowledgement not found",
                    )
                })?;
            let actual = store_revision(store, &ProjectId::new(project.clone()))?;
            if actual != revision {
                return Err(CliError::with(
                    ErrorCode::StaleContext,
                    ApplicationOutcome::Rejected,
                    format!(
                        "project changed while reading directive acknowledgement (expected revision {revision}, found {actual}); retry"
                    ),
                ));
            }
            let mut result = bounded_result(Some(value), Some(revision))?;
            result.outcome = ApplicationOutcome::Unchanged;
            Ok(result)
        }
        _ => Err(CliError::invalid("unsupported directive route")),
    }
}

fn project_offset(parsed: &ParsedCommand) -> usize {
    usize::from(parsed.options.project.is_none())
}
fn require_positionals(
    parsed: &ParsedCommand,
    count: usize,
    message: &str,
) -> Result<(), CliError> {
    if parsed.options.positionals.len() != project_offset(parsed) + count {
        return Err(CliError::invalid(message));
    }
    Ok(())
}
fn reject_work(parsed: &ParsedCommand, command: &str) -> Result<(), CliError> {
    if parsed.options.work.is_some() {
        return Err(CliError::invalid(format!(
            "{command} does not accept --work"
        )));
    }
    Ok(())
}
fn require_trusted_directive(id: &str) -> Result<(), CliError> {
    if boreal_application::TRUSTED_DIRECTIVES
        .iter()
        .any(|(known, _)| *known == id)
    {
        Ok(())
    } else {
        Err(CliError::with(
            ErrorCode::NotFound,
            ApplicationOutcome::Rejected,
            "unknown trusted directive",
        ))
    }
}
