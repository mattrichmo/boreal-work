//! Project-scoped recovery inspection and identity-bound reconciliation.
use super::*;
use boreal_protocol::models::WorkActionDescriptorDto;
use boreal_store::recovery::{
    RecoverActionAttemptInput, RecoverActionDescriptorInput, RecoverActionTargetInput,
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum RecoverDispositionDto {
    AdapterAcknowledged,
    ReviewedSafeRecovery,
}

#[derive(Clone, Debug, Deserialize)]
struct RecoverActionFileDto {
    descriptor: WorkActionDescriptorDto,
    disposition: RecoverDispositionDto,
}

#[derive(Clone, Debug, Deserialize)]
struct RecoverActionTargetDto {
    project_id: String,
    work_id: String,
    entity_revision: Option<u64>,
}

#[derive(Clone, Debug, Deserialize)]
struct RecoverActionAttemptDto {
    attempt_id: String,
    fence: u64,
}

#[derive(Clone, Debug, Deserialize)]
struct RecoverActionCommandDto {
    action: String,
    descriptor: WorkActionDescriptorDto,
    disposition: RecoverDispositionDto,
    expected_revision: u64,
    confirmed: bool,
}

pub(super) fn supported(path: &[String]) -> bool {
    path.len() == 2
        && path[0] == "recovery"
        && matches!(path[1].as_str(), "list" | "resolve" | "recover")
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
    if action == "recover" {
        if parsed.options.attempt.is_some() || parsed.options.fence.is_some() {
            return Err(CliError::invalid(
                "recovery recover takes attempt and fence only from the server-issued descriptor",
            ));
        }
        let context = project_context::resolve(parsed)?;
        let path = parsed
            .options
            .input
            .as_deref()
            .ok_or_else(|| CliError::invalid("recovery recover requires --input PATH"))?;
        let path = project_context::confined_path(&context.root, Path::new(path), false)?;
        let input = serde_json::from_slice::<Value>(
            &fs::read(path).map_err(|error| CliError::invalid(error.to_string()))?,
        )
        .map_err(|error| CliError::invalid(format!("recovery input is invalid JSON: {error}")))?;
        let file: RecoverActionFileDto =
            serde_json::from_value(input.clone()).map_err(|error| {
                CliError::invalid(format!("recover descriptor input is invalid: {error}"))
            })?;
        let expected_revision = parsed
            .options
            .expected_revision
            .ok_or_else(|| CliError::invalid("recovery recover requires --expected-revision"))?;
        if !parsed.options.setup.yes {
            return Err(CliError::invalid(
                "recovery recover requires explicit --yes confirmation",
            ));
        }
        if file.descriptor.expected_project_revision != expected_revision {
            return Err(CliError::with(
                ErrorCode::OperationConflict,
                ApplicationOutcome::Rejected,
                "recovery expected revision conflicts with the server descriptor",
            ));
        }
        let value = json!({
            "action": "recover",
            "descriptor": file.descriptor,
            "disposition": file.disposition,
            "expected_revision": expected_revision,
            "confirmed": true,
        });
        let _: RecoverActionCommandDto =
            serde_json::from_value(value.clone()).map_err(|error| {
                CliError::invalid(format!("recover command input is invalid: {error}"))
            })?;
        return Ok(value);
    }
    if action != "resolve" {
        return Err(CliError::invalid(
            "recovery requires `list`, `resolve`, or `recover`",
        ));
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
            Some(_) => {
                return Err(CliError::invalid(
                    "obligation ID conflicts with recovery input",
                ));
            }
            None => input["obligation_id"] = json!(id),
        }
    }
    for (field, selected) in [
        (
            "expected_revision",
            json!(parsed
                .options
                .expected_revision
                .ok_or_else(|| CliError::invalid(
                    "recovery resolve requires --expected-revision"
                ))?),
        ),
        ("confirmed", json!(parsed.options.setup.yes)),
    ] {
        if input
            .get(field)
            .is_some_and(|provided| provided != &selected)
        {
            return Err(CliError::invalid(format!(
                "recovery {field} conflicts with command options"
            )));
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
    let action = value
        .get("action")
        .and_then(Value::as_str)
        .ok_or_else(|| CliError::invalid("recovery action is required"))?;
    match action {
        "list" => {
            let limit = value
                .get("limit")
                .and_then(Value::as_u64)
                .unwrap_or(100)
                .min(500) as u32;
            if limit == 0 {
                return Err(CliError::invalid("recovery page limit must be at least 1"));
            }
            let after_id = value.get("after_id").and_then(Value::as_str);
            let obligations = store
                .list_unresolved_recovery_obligations(project, after_id, limit)
                .map_err(map_store_error)?;
            let revision = store.project_revision(project).map_err(map_store_error)?.0;
            let items = obligations
                .iter()
                .map(|obligation| {
                    json!({
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
                    })
                })
                .collect::<Vec<_>>();
            let returned = items.len();
            let next_after_id = if returned == limit as usize {
                items
                    .last()
                    .and_then(|item| item["obligation_id"].as_str())
                    .map(str::to_owned)
            } else {
                None
            };
            bounded_result(
                Some(
                    json!({"project_id": project, "revision": revision, "items": items,
                "returned": returned, "next_after_id": next_after_id}),
                ),
                Some(revision),
            )
            .map(|mut result| {
                result.outcome = ApplicationOutcome::Unchanged;
                result
            })
        }
        "resolve" => {
            let confirmed = value
                .get("confirmed")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let expected_revision = value.get("expected_revision").and_then(Value::as_u64);
            if !confirmed || expected_revision.is_none() {
                return Err(CliError::invalid(
                    "recovery resolution requires --yes and --expected-revision",
                ));
            }
            require_operator(store, project, actor)?;
            store
                .validate_project_session(project, actor, session)
                .map_err(map_store_error)?;
            let required = |field: &str| {
                value
                    .get(field)
                    .and_then(Value::as_str)
                    .filter(|value| !value.trim().is_empty())
                    .ok_or_else(|| CliError::invalid(format!("recovery input requires {field}")))
            };
            let obligation_id = required("obligation_id")?.to_owned();
            let resolution_id = required("resolution_id")?.to_owned();
            let outcome = required("outcome")?.to_owned();
            let reason = required("reason")?.to_owned();
            let resource_state = required("resource_state")?.to_owned();
            let at = now();
            let request_digest = canonical_request_digest(
                "recovery.resolve/v1",
                json!({
                    "project_id": project, "actor_id": actor, "session_id": session,
                    "obligation_id": obligation_id, "resolution_id": resolution_id,
                    "outcome": outcome, "reason": reason, "resource_state": resource_state,
                    "expected_revision": expected_revision,
                }),
            );
            let context = IdentityStore::new(store)
                .context(project)
                .map_err(|error| {
                    CliError::invalid(format!("project identity is unavailable: {error}"))
                })?;
            let record = WorkApplication::new(store)
                .resolve_attempt_recovery_with_identity(
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
                )
                .map_err(map_application_error)?;
            let revision = store.project_revision(project).map_err(map_store_error)?.0;
            let operation_outcome = store
                .operation(operation)
                .map_err(map_store_error)?
                .map(|record| match record.outcome {
                    StoreOperationOutcome::Changed => ApplicationOutcome::Changed,
                    StoreOperationOutcome::Unchanged => ApplicationOutcome::Unchanged,
                    StoreOperationOutcome::Rejected => ApplicationOutcome::Rejected,
                    StoreOperationOutcome::Conflict => ApplicationOutcome::Conflict,
                    StoreOperationOutcome::Busy => ApplicationOutcome::Busy,
                    StoreOperationOutcome::Failed => ApplicationOutcome::Failed,
                    StoreOperationOutcome::Unknown => ApplicationOutcome::Unknown,
                })
                .unwrap_or(ApplicationOutcome::Unknown);
            bounded_result(
                Some(json!({
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
                })),
                Some(revision),
            )
            .map(|mut result| {
                result.outcome = operation_outcome;
                result
            })
        }
        "recover" => apply_recover(store, project, actor, session, operation, value),
        _ => Err(CliError::invalid("unknown recovery action")),
    }
}

fn apply_recover(
    store: &SqliteStore,
    project: &str,
    actor: &str,
    session: &str,
    operation: &str,
    value: Value,
) -> Result<CliResult, CliError> {
    let dto: RecoverActionCommandDto = serde_json::from_value(value)
        .map_err(|error| CliError::invalid(format!("recover command input is invalid: {error}")))?;
    if dto.action != "recover" || !dto.confirmed {
        return Err(CliError::invalid(
            "recovery recover requires the current Recover action and --yes confirmation",
        ));
    }
    if dto.expected_revision != dto.descriptor.expected_project_revision {
        return Err(CliError::with(
            ErrorCode::OperationConflict,
            ApplicationOutcome::Rejected,
            "recovery expected revision conflicts with the server descriptor",
        ));
    }
    let target: RecoverActionTargetDto = serde_json::from_value(dto.descriptor.target.clone())
        .map_err(|error| CliError::invalid(format!("recover target is invalid: {error}")))?;
    if target.project_id != project {
        return Err(CliError::with(
            ErrorCode::OperationConflict,
            ApplicationOutcome::Rejected,
            "recover descriptor project does not match the selected project",
        ));
    }
    if target.entity_revision.is_none()
        || dto.descriptor.expected_entity_revision.is_none()
        || dto
            .descriptor
            .confirmation
            .as_deref()
            .is_none_or(str::is_empty)
    {
        return Err(CliError::invalid(
            "recover descriptor is incomplete: entity revision and confirmation are required",
        ));
    }
    let attempt_value = dto.descriptor.attempt.clone().unwrap_or(Value::Null);
    let attempt: RecoverActionAttemptDto = serde_json::from_value(attempt_value).map_err(|_| {
        CliError::with(
            ErrorCode::OperationConflict,
            ApplicationOutcome::Rejected,
            "recover descriptor has no current attempt/fence; the expiry route cannot recover an already-released attempt",
        )
    })?;
    if attempt.attempt_id.trim().is_empty() || attempt.fence == 0 {
        return Err(CliError::with(
            ErrorCode::OperationConflict,
            ApplicationOutcome::Rejected,
            "recover descriptor has no current attempt/fence; refresh before submitting expiry",
        ));
    }
    let disposition = match dto.disposition {
        RecoverDispositionDto::AdapterAcknowledged => {
            boreal_application::StopConfirmation::AdapterAcknowledged
        }
        RecoverDispositionDto::ReviewedSafeRecovery => {
            boreal_application::StopConfirmation::ReviewedSafeRecovery
        }
    };
    let descriptor = RecoverActionDescriptorInput {
        action: dto.descriptor.action,
        target: RecoverActionTargetInput {
            project_id: target.project_id,
            work_id: target.work_id,
            entity_revision: target.entity_revision,
        },
        expected_project_revision: dto.descriptor.expected_project_revision,
        expected_entity_revision: dto.descriptor.expected_entity_revision,
        expected_proof_revision: dto.descriptor.expected_proof_revision,
        attempt: Some(RecoverActionAttemptInput {
            attempt_id: attempt.attempt_id,
            fence: attempt.fence,
        }),
        required_roles: dto.descriptor.required_roles,
        required_inputs: dto.descriptor.required_inputs,
        confirmation: dto.descriptor.confirmation,
        read_only: dto.descriptor.read_only,
        recovery: dto.descriptor.recovery,
    };
    let result = WorkApplication::new(store)
        .recover_attempt_action(boreal_application::RecoverActionRequest {
            project_id: ProjectId::new(project),
            work_id: WorkId::new(descriptor.target.work_id.clone()),
            actor_id: ActorId::new(actor),
            session_id: SessionId::new(session),
            operation_id: OperationId::new(operation),
            descriptor,
            confirmed: dto.confirmed,
            disposition,
            at: TimestampMs::from_millis(now_ms_u64()),
        })
        .map_err(map_application_error)?;
    let obligation_id = format!("{operation}:recovery:expired");
    let obligation = store
        .recovery_obligation(project, &obligation_id)
        .map_err(map_store_error)?
        .ok_or_else(|| {
            CliError::unknown_delivery(
                operation,
                "recover operation committed without recovery-obligation readback",
            )
        })?;
    let revision = result.snapshot_revision;
    let data = json!({
        "action": "recover",
        "project_id": project,
        "work_id": obligation.work_id,
        "operation_id": result.operation_id,
        "revision": revision,
        "attempt": {
            "attempt_id": result.value.attempt_id.as_str(),
            "fence": result.value.fence.get(),
            "phase": format!("{:?}", result.value.phase).to_ascii_lowercase(),
        },
        "replayed": result.value.replayed,
        "recovery_obligation": {
            "obligation_id": obligation.obligation_id,
            "attempt_id": obligation.attempt_id,
            "fence": obligation.fence,
            "reason": obligation.reason,
            "state": obligation.state,
            "resource_state": obligation.resource_state,
            "next_action": obligation.next_action,
            "created_at": obligation.created_at,
        },
    });
    bounded_result(Some(data), Some(revision)).map(|mut output| {
        output.outcome = if result.value.replayed {
            ApplicationOutcome::Unchanged
        } else {
            ApplicationOutcome::Changed
        };
        output
    })
}
