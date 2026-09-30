//! Transport/input adapter only. Calendar and lifecycle policy stays in Rust
//! application/domain; all writes pass the transactional planning boundary.
use super::*;
use boreal_protocol::models::{CycleCommandDto, CycleOperationDto, LocalDateTimeDto};

pub(super) fn kind(path: &[String]) -> Option<&'static str> {
    if path.len() != 2 || !matches!(path[0].as_str(), "cycle" | "sprint") {
        return None;
    }
    Some(match path[1].as_str() {
        "create" => "create",
        "activate" => "activate",
        "close" => "close",
        "cancel" => "cancel",
        "assign" => "assign",
        "commit" => "commit",
        "remove" => "remove",
        "carry-over" => "carry_over",
        "map-legacy" => "map_legacy",
        _ => return None,
    })
}
pub(super) fn read_kind(path: &[String]) -> Option<&'static str> {
    if path.len() != 2 || !matches!(path[0].as_str(), "cycle" | "sprint") {
        return None;
    }
    Some(match path[1].as_str() {
        "list" => "list",
        "board" => "board",
        "report" => "report",
        _ => return None,
    })
}
pub(super) fn payload(parsed: &ParsedCommand) -> Result<Value, CliError> {
    let context = project_context::resolve(parsed)?;
    let mut change = if let Some(file) = parsed.options.input.as_deref() {
        let file = project_context::confined_path(&context.root, Path::new(file), false)?;
        serde_json::from_slice::<Value>(
            &fs::read(file).map_err(|e| CliError::invalid(e.to_string()))?,
        )
        .map_err(|e| CliError::invalid(e.to_string()))?
    } else {
        json!({})
    };
    if !change.is_object() {
        return Err(CliError::invalid("cycle input must be an object"));
    }
    let selected = kind(&parsed.path).ok_or_else(|| CliError::invalid("unknown cycle command"))?;
    if change.get("kind").is_some_and(|v| v != selected) {
        return Err(CliError::invalid("cycle input kind conflicts with command"));
    }
    change["kind"] = json!(selected);
    if let Some(id) = parsed.options.positionals.first() {
        if change.get("cycle_id").is_some_and(|v| v != id) {
            return Err(CliError::invalid("cycle identifier conflicts with input"));
        }
        change["cycle_id"] = json!(id);
    }
    let value = json!({"expected_revision":parsed.options.expected_revision.ok_or_else(||CliError::invalid("cycle changes require --expected-revision"))?,
        "reason":parsed.options.reason.as_deref().ok_or_else(||CliError::invalid("cycle changes require --reason"))?,"confirmed":parsed.options.setup.yes,"change":change});
    let _: CycleCommandDto =
        serde_json::from_value(value.clone()).map_err(|e| CliError::invalid(e.to_string()))?;
    Ok(value)
}
fn local(value: LocalDateTimeDto) -> boreal_domain::work_model_v3::LocalDateTime {
    use boreal_domain::work_model_v3::{LocalDate, LocalDateTime, LocalTime};
    LocalDateTime::new(
        LocalDate::new(value.year, value.month, value.day),
        LocalTime::new(value.hour, value.minute, value.second),
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
    let dto: CycleCommandDto =
        serde_json::from_value(value).map_err(|e| CliError::invalid(e.to_string()))?;
    if !dto.confirmed || dto.reason.trim().is_empty() {
        return Err(CliError::invalid(
            "cycle change requires confirmation and a reason",
        ));
    }
    let scope = boreal_application::PlanningScope::new(ProjectId::new(project), actor)
        .with_session(session)
        .at_revision(dto.expected_revision);
    let app = WorkApplication::new(store);
    let at = now();
    let result = match dto.change {
        CycleOperationDto::Create {
            cycle_id,
            name,
            goal,
            timezone,
            start,
            end,
            later_fold,
        } => app.create_planning_cycle(
            &scope,
            operation,
            boreal_application::cycle_runtime::CycleCreateInput {
                cycle_id,
                name,
                goal,
                timezone,
                start: local(start),
                end: end.map(local),
                later_fold,
                reason: dto.reason,
            },
            &at,
        ),
        other => {
            let (
                cycle_id,
                change,
                assignment_id,
                work_id,
                successor_cycle_id,
                successor_assignment_id,
            ) = match other {
                CycleOperationDto::Activate { cycle_id } => {
                    (cycle_id, "activate", None, None, None, None)
                }
                CycleOperationDto::Close { cycle_id } => {
                    (cycle_id, "close", None, None, None, None)
                }
                CycleOperationDto::Cancel { cycle_id } => {
                    (cycle_id, "cancel", None, None, None, None)
                }
                CycleOperationDto::Assign {
                    cycle_id,
                    assignment_id,
                    work_id,
                } => (
                    cycle_id,
                    "assign",
                    Some(assignment_id),
                    Some(work_id),
                    None,
                    None,
                ),
                CycleOperationDto::Commit {
                    cycle_id,
                    assignment_id,
                } => (cycle_id, "commit", Some(assignment_id), None, None, None),
                CycleOperationDto::Remove {
                    cycle_id,
                    assignment_id,
                } => (cycle_id, "remove", Some(assignment_id), None, None, None),
                CycleOperationDto::CarryOver {
                    cycle_id,
                    assignment_id,
                    successor_cycle_id,
                    successor_assignment_id,
                } => (
                    cycle_id,
                    "carry_over",
                    Some(assignment_id),
                    None,
                    Some(successor_cycle_id),
                    Some(successor_assignment_id),
                ),
                CycleOperationDto::MapLegacy { cycle_id, work_id } => {
                    (cycle_id, "map_legacy", None, Some(work_id), None, None)
                }
                CycleOperationDto::Create { .. } => unreachable!("create handled above"),
            };
            app.change_planning_cycle(
                &scope,
                operation,
                &boreal_store::cycle_commands::CycleChangeRequest {
                    cycle_id,
                    change: change.into(),
                    assignment_id,
                    work_id,
                    successor_cycle_id,
                    successor_assignment_id,
                    reason: dto.reason,
                    confirmed: dto.confirmed,
                },
                &at,
            )
        }
    }
    .map_err(map_application_error)?;
    let record = store
        .operation(operation)
        .map_err(map_store_error)?
        .ok_or_else(|| CliError::invalid("cycle operation readback missing"))?;
    let data: Value =
        serde_json::from_str(&record.result_json).map_err(|e| CliError::invalid(e.to_string()))?;
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
pub(super) fn read(parsed: &ParsedCommand, store: &SqliteStore) -> Result<CliResult, CliError> {
    if read_kind(&parsed.path) == Some("list") {
        let value = store
            .cycle_list_snapshot_v3(
                &project_argument(parsed, 0)?,
                parsed.options.limit.unwrap_or(50),
                parsed.options.offset.unwrap_or(0),
            )
            .map_err(map_store_error)?;
        let revision = value.get("revision").and_then(Value::as_u64);
        return bounded_result(Some(value), revision);
    }
    cycle_board_result(parsed, &WorkApplication::new(store))
}
