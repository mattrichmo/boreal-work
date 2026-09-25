//! Project-scoped recovery inspection and identity-bound reconciliation.
use super::*;

pub(super) fn supported(path: &[String]) -> bool {
    path.len() == 2 && path[0] == "recovery" && matches!(path[1].as_str(), "list" | "resolve")
}

pub(super) fn payload(parsed: &ParsedCommand) -> Result<Value, CliError> {
    let action = parsed.path.get(1).map(String::as_str).unwrap_or_default();
    let target_index = usize::from(parsed.options.project.is_none());
    if action == "list" {
        return Ok(json!({
            "action": "list",
            "limit": parsed.options.limit.unwrap_or(100),
            "after_id": parsed.options.positionals.get(target_index),
        }));
    }
    if action != "resolve" {
        return Err(CliError::invalid("recovery requires `list` or `resolve`"));
    }
    let context = project_context::resolve(parsed)?;
    let mut input = if let Some(path) = parsed.options.input.as_deref() {
        let path = project_context::confined_path(&context.root, Path::new(path), false)?;
        serde_json::from_slice::<Value>(
            &fs::read(path).map_err(|error| CliError::invalid(error.to_string()))?,
        )
        .map_err(|error| CliError::invalid(format!("recovery input is invalid JSON: {error}")))?
    } else {
        return Err(CliError::invalid("recovery resolve requires --input PATH"));
    };
    if !input.is_object() {
        return Err(CliError::invalid("recovery input must be an object"));
    }
    if let Some(id) = parsed.options.positionals.get(target_index) {
        match input.get("obligation_id") {
            Some(Value::String(existing)) if existing == id => {}
            Some(_) => return Err(CliError::invalid("obligation ID conflicts with recovery input")),
            None => input["obligation_id"] = json!(id),
        }
    }
    for (field, selected) in [
        ("expected_revision", json!(parsed.options.expected_revision.ok_or_else(|| CliError::invalid("recovery resolve requires --expected-revision"))?)),
        ("confirmed", json!(parsed.options.setup.yes)),
    ] {
        if input.get(field).is_some_and(|provided| provided != &selected) {
            return Err(CliError::invalid(format!("recovery {field} conflicts with command options")));
        }
        input[field] = selected;
    }
    input["action"] = json!("resolve");
    Ok(input)
}

pub(super) fn run(
    parsed: &ParsedCommand,
    operation: &str,
    store: &SqliteStore,
) -> Result<CliResult, CliError> {
    let context = project_context::resolve(parsed)?;
    project_context::validate_store(&context, store)?;
    let project = project_argument(parsed, 0)?;
    if project != context.project_id {
        return Err(CliError::with(
            ErrorCode::OperationConflict,
            ApplicationOutcome::Rejected,
            "recovery project does not match the selected workspace",
        ));
    }
    apply(
        store,
        &project,
        &parsed.options.actor,
        &parsed.options.session,
        operation,
        payload(parsed)?,
    )
}

pub(super) fn apply(
    store: &SqliteStore,
    project: &str,
    actor: &str,
    session: &str,
    operation: &str,
    value: Value,
) -> Result<CliResult, CliError> {
    let action = value.get("action").and_then(Value::as_str)
        .ok_or_else(|| CliError::invalid("recovery action is required"))?;
    match action {
        "list" => {
            let limit = value.get("limit").and_then(Value::as_u64).unwrap_or(100).min(500) as u32;
            if limit == 0 {
                return Err(CliError::invalid("recovery page limit must be at least 1"));
            }
            let after_id = value.get("after_id").and_then(Value::as_str);
            let obligations = store.list_unresolved_recovery_obligations(project, after_id, limit)
                .map_err(map_store_error)?;
            let revision = store.project_revision(project).map_err(map_store_error)?.0;
            let items = obligations.iter().map(|obligation| json!({
                "obligation_id": obligation.obligation_id,
                "project_id": obligation.project_id,
                "work_id": obligation.work_id,
                "attempt_id": obligation.attempt_id,
                "fence": obligation.fence,
                "reason": obligation.reason,
                "state": obligation.state,
                "resource_state": obligation.resource_state,
                "owner_actor_id": obligation.owner_actor_id,
                "next_action": obligation.next_action,
                "created_at": obligation.created_at,
            })).collect::<Vec<_>>();
            let returned = items.len();
            let next_after_id = if returned == limit as usize {
                items.last().and_then(|item| item["obligation_id"].as_str()).map(str::to_owned)
            } else {
                None
            };
            bounded_result(Some(json!({"project_id": project, "revision": revision, "items": items,
                "returned": returned, "next_after_id": next_after_id})), Some(revision))
                .map(|mut result| { result.outcome = ApplicationOutcome::Unchanged; result })
        }
        "resolve" => {
            let confirmed = value.get("confirmed").and_then(Value::as_bool).unwrap_or(false);
            let expected_revision = value.get("expected_revision").and_then(Value::as_u64);
            if !confirmed || expected_revision.is_none() {
                return Err(CliError::invalid("recovery resolution requires --yes and --expected-revision"));
            }
            require_operator(store, project, actor)?;
            store.validate_project_session(project, actor, session).map_err(map_store_error)?;
            let required = |field: &str| value.get(field).and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| CliError::invalid(format!("recovery input requires {field}")));
            let obligation_id = required("obligation_id")?.to_owned();
            let resolution_id = required("resolution_id")?.to_owned();
            let outcome = required("outcome")?.to_owned();
            let reason = required("reason")?.to_owned();
            let resource_state = required("resource_state")?.to_owned();
            let at = now();
            let request_digest = canonical_request_digest("recovery.resolve/v1", json!({
                "project_id": project, "actor_id": actor, "session_id": session,
                "obligation_id": obligation_id, "resolution_id": resolution_id,
                "outcome": outcome, "reason": reason, "resource_state": resource_state,
                "expected_revision": expected_revision,
            }));
            let context = IdentityStore::new(store).context(project)
                .map_err(|error| CliError::invalid(format!("project identity is unavailable: {error}")))?;
            let record = WorkApplication::new(store).resolve_attempt_recovery_with_identity(
                &boreal_store::recovery::IdentityBoundRecoveryResolutionInput {
                    context,
                    operation_id: operation.to_owned(),
                    request_digest,
                    expected_project_revision: expected_revision,
                    session_id: Some(session.to_owned()),
                    resolution: boreal_store::recovery::RecoveryResolutionInput {
                        project_id: project.to_owned(),
                        obligation_id,
                        resolution_id,
                        actor_id: actor.to_owned(),
                        outcome,
                        reason,
                        resource_state,
                        at,
                    },
                },
            ).map_err(map_application_error)?;
            let revision = store.project_revision(project).map_err(map_store_error)?.0;
            let operation_outcome = store.operation(operation).map_err(map_store_error)?
                .map(|record| match record.outcome {
                    StoreOperationOutcome::Changed => ApplicationOutcome::Changed,
                    StoreOperationOutcome::Unchanged => ApplicationOutcome::Unchanged,
                    StoreOperationOutcome::Rejected => ApplicationOutcome::Rejected,
                    StoreOperationOutcome::Conflict => ApplicationOutcome::Conflict,
                    StoreOperationOutcome::Busy => ApplicationOutcome::Busy,
                    StoreOperationOutcome::Failed => ApplicationOutcome::Failed,
                    StoreOperationOutcome::Unknown => ApplicationOutcome::Unknown,
                }).unwrap_or(ApplicationOutcome::Unknown);
            bounded_result(Some(json!({
                "project_id": project,
                "revision": revision,
                "operation_id": operation,
                "obligation": {
                    "obligation_id": record.obligation_id,
                    "work_id": record.work_id,
                    "attempt_id": record.attempt_id,
                    "fence": record.fence,
                    "reason": record.reason,
                    "state": record.state,
                    "resource_state": record.resource_state,
                    "resolved_at": record.resolved_at,
                    "resolved_by": record.resolved_by,
                    "resolution_id": record.resolution_id,
                },
                "readback_required": record.state != "resolved",
            })), Some(revision)).map(|mut result| { result.outcome = operation_outcome; result })
        }
        _ => Err(CliError::invalid("unknown recovery action")),
    }
}
