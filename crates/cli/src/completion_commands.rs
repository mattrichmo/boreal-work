//! Shared direct/service adapter for server-owned completion transactions.
use super::*;
use boreal_domain::completion::CompletionKind;
use boreal_protocol::models::CompletionCommandDto;

pub(super) fn kind(path: &[String]) -> Option<CompletionKind> {
    CompletionKind::parse(&path.join("."))
}

pub(super) fn payload(parsed: &ParsedCommand) -> Result<Value, CliError> {
    let context = project_context::resolve(parsed)?;
    let mut value = if let Some(input) = parsed.options.input.as_deref() {
        let path = project_context::confined_path(&context.root, Path::new(input), false)?;
        serde_json::from_slice::<Value>(
            &fs::read(path).map_err(|e| CliError::invalid(e.to_string()))?,
        )
        .map_err(|e| CliError::invalid(format!("completion input is invalid JSON: {e}")))?
    } else {
        json!({})
    };
    if !value.is_object() {
        return Err(CliError::invalid("completion input must be an object"));
    }
    let command =
        kind(&parsed.path).ok_or_else(|| CliError::invalid("unknown completion command"))?;
    let work = parsed
        .options
        .work
        .clone()
        .or_else(|| parsed.options.positionals.first().cloned())
        .or_else(|| {
            value
                .get("work_id")
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .ok_or_else(|| CliError::invalid("completion requires --work or work_id"))?;
    for (field, selected) in [
        ("kind", json!(command.command())),
        ("work_id", json!(work)),
        (
            "expected_revision",
            json!(parsed
                .options
                .expected_revision
                .ok_or_else(|| CliError::invalid("completion requires --expected-revision"))?),
        ),
        (
            "reason",
            json!(parsed
                .options
                .reason
                .as_deref()
                .ok_or_else(|| CliError::invalid("completion requires --reason"))?),
        ),
        ("confirmed", json!(parsed.options.setup.yes)),
    ] {
        if value
            .get(field)
            .is_some_and(|provided| provided != &selected)
        {
            return Err(CliError::invalid(format!(
                "completion {field} conflicts with the explicit command"
            )));
        }
        value[field] = selected;
    }
    // Validate the exact public DTO before any store mutation.
    let _: CompletionCommandDto =
        serde_json::from_value(value.clone()).map_err(|e| CliError::invalid(e.to_string()))?;
    Ok(value)
}

pub(super) fn apply(
    store: &SqliteStore,
    project: &str,
    actor: &str,
    session: &str,
    operation: &str,
    value: Value,
) -> Result<CliResult, CliError> {
    let dto: CompletionCommandDto =
        serde_json::from_value(value).map_err(|e| CliError::invalid(e.to_string()))?;
    let command = CompletionKind::parse(&dto.kind)
        .ok_or_else(|| CliError::invalid("unknown completion kind"))?;
    let result = WorkApplication::new(store)
        .complete(&boreal_application::CompletionMutationRequest {
            project_id: project.into(),
            work_id: dto.work_id.clone(),
            actor_id: actor.into(),
            session_id: session.into(),
            operation_id: operation.into(),
            kind: command,
            expected_revision: dto.expected_revision,
            expected_entity_revision: dto.expected_entity_revision,
            expected_proof_revision: dto.expected_proof_revision,
            submission_id: dto.submission_id,
            target_id: dto.target_id,
            predecessor_revision: dto.predecessor_revision,
            exception_reason: dto.exception_reason,
            reason: dto.reason,
            expires_at_ms: dto.expires_at_ms,
            confirmed: dto.confirmed,
            at: now(),
        })
        .map_err(map_application_error)?;
    let operation_record = store
        .operation(operation)
        .map_err(map_store_error)?
        .ok_or_else(|| CliError::invalid("completion committed without readable operation"))?;
    let data: Value = serde_json::from_str(&operation_record.result_json)
        .map_err(|e| CliError::invalid(e.to_string()))?;
    Ok(CliResult {
        outcome: if result.replayed {
            ApplicationOutcome::Unchanged
        } else {
            ApplicationOutcome::Changed
        },
        revision: Some(result.revision),
        data: Some(data),
        ..CliResult::default()
    })
}

pub(super) fn run(
    parsed: &ParsedCommand,
    operation: &str,
    store: &SqliteStore,
) -> Result<CliResult, CliError> {
    apply(
        store,
        &project_argument(parsed, 0)?,
        &parsed.options.actor,
        &parsed.options.session,
        operation,
        payload(parsed)?,
    )
}
