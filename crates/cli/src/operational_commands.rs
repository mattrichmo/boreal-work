//! Ownership, backup browsing and diagnostic-only maintenance adapters.
use super::*;
use boreal_store::{MaintenanceJobTransition, V3MutationContext};
pub(crate) fn supported(path: &[String]) -> bool {
    matches!(
        path.iter()
            .map(String::as_str)
            .collect::<Vec<_>>()
            .as_slice(),
        ["reservation", "list"]
            | ["snapshot", "list" | "show"]
            | ["lock", "inspect"]
            | ["storage", "rotate-log"]
    )
}
pub(crate) fn run(
    parsed: &ParsedCommand,
    operation: &str,
    store: &SqliteStore,
) -> Result<CliResult, CliError> {
    let ctx = project_context::resolve(parsed)?;
    project_context::validate_store(&ctx, store)?;
    let limit = parsed.options.limit.unwrap_or(100);
    let offset = parsed.options.offset.unwrap_or(0);
    let data = match parsed
        .path
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>()
        .as_slice()
    {
        ["reservation", "list"] => store
            .reservation_inspection(
                &ctx.project_id,
                parsed
                    .options
                    .extra
                    .get("--owner")
                    .and_then(|v| v.last())
                    .map(String::as_str),
                parsed.options.work.as_deref(),
                parsed
                    .options
                    .extra
                    .get("--status")
                    .and_then(|v| v.last())
                    .map(String::as_str),
                limit,
                offset,
            )
            .map_err(map_store_error)?,
        ["snapshot", "list"] => store
            .backup_history(limit, offset)
            .map_err(map_store_error)?,
        ["snapshot", "show"] => {
            let id = parsed
                .options
                .positionals
                .first()
                .ok_or_else(|| CliError::invalid("snapshot show requires SNAPSHOT_ID"))?;
            let job = store
                .maintenance_job(id)
                .map_err(map_store_error)?
                .ok_or_else(|| {
                    CliError::invalid("snapshot was not found in this project's backup journal")
                })?;
            if job.kind != "backup" || job.stage != "committed" {
                return Err(CliError::invalid(
                    "snapshot is not a committed backup; inspect maintenance show for recovery",
                ));
            }
            let manifest_path = project_context::confined_path(
                &ctx.root,
                &Path::new(&job.package_path).join("manifest.json"),
                false,
            )?;
            let manifest = read_bounded_json(&manifest_path, 4 * 1024 * 1024)?;
            store
                .validate_snapshot_manifest_document(&ctx.project_id, &manifest)
                .map_err(map_store_error)?;
            json!({"snapshot_id":id,"path":job.package_path,"manifest":manifest,"read_only":true,"database_content_revalidated":false})
        }
        ["lock", "inspect"] => lock_inspect(&ctx.root, &ctx.project_id, store)?,
        ["storage", "rotate-log"] => return rotate(parsed, operation, store, &ctx),
        _ => return Err(CliError::invalid("unsupported operational route")),
    };
    Ok(CliResult {
        outcome: ApplicationOutcome::Unchanged,
        revision: Some(
            store
                .project_revision(&ctx.project_id)
                .map_err(map_store_error)?
                .0,
        ),
        data: Some(data),
        ..CliResult::default()
    })
}
fn read_bounded_json(path: &Path, max: u64) -> Result<Value, CliError> {
    use std::io::Read;
    let file = fs::File::open(path).map_err(|e| CliError::invalid(e.to_string()))?;
    let mut bytes = Vec::new();
    file.take(max + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| CliError::invalid(e.to_string()))?;
    if bytes.len() as u64 > max {
        return Err(CliError::invalid("inspection input exceeds its byte bound"));
    }
    serde_json::from_slice(&bytes).map_err(|e| CliError::invalid(e.to_string()))
}
fn lock_inspect(root: &Path, project: &str, store: &SqliteStore) -> Result<Value, CliError> {
    let runtime = project_context::confined_path(root, Path::new(".boreal/runtime"), true)?;
    let mut locks = Vec::new();
    if runtime.is_dir() {
        for entry in fs::read_dir(runtime)
            .map_err(|e| CliError::invalid(e.to_string()))?
            .take(501)
        {
            let entry = entry.map_err(|e| CliError::invalid(e.to_string()))?;
            if entry.path().extension().and_then(|v| v.to_str()) != Some("lock") {
                continue;
            }
            let path = project_context::confined_path(root, &entry.path(), false)?;
            let file = fs::File::open(&path).map_err(|e| CliError::invalid(e.to_string()))?;
            use std::io::Read;
            let mut text = String::new();
            (&file)
                .take(4097)
                .read_to_string(&mut text)
                .map_err(|e| CliError::invalid(e.to_string()))?;
            if text.len() > 4096 {
                return Err(CliError::invalid("ownership metadata exceeds 4 KiB"));
            }
            #[cfg(unix)]
            let activity = {
                use std::os::fd::AsRawFd;
                unsafe extern "C" {
                    fn flock(fd: i32, operation: i32) -> i32;
                }
                let fd = file.as_raw_fd();
                if unsafe { flock(fd, 2 | 4) } == 0 {
                    unsafe { flock(fd, 8) };
                    "inactive"
                } else if matches!(
                    std::io::Error::last_os_error().kind(),
                    std::io::ErrorKind::WouldBlock
                ) {
                    "owned"
                } else {
                    "unknown"
                }
            };
            #[cfg(not(unix))]
            let activity = "unknown";
            locks.push(json!({"path":path,"activity":activity,"metadata":text,"metadata_is_liveness_proof":false}));
        }
    }
    let recovery=store.list_unresolved_recovery_obligations(project,None,100).map_err(map_store_error)?.iter().map(|r|json!({"obligation_id":r.obligation_id,"work_id":r.work_id,"state":r.state,"reason":r.reason,"next_action":r.next_action})).collect::<Vec<_>>();
    Ok(
        json!({"project_id":project,"read_only":true,"locks":locks,"recovery_obligations":recovery,"recovery_limit":100,"live_locks_broken":false,"recovery_command":"bwrk recovery list --json"}),
    )
}
fn rotate(
    parsed: &ParsedCommand,
    operation: &str,
    store: &SqliteStore,
    ctx: &project_context::ProjectContext,
) -> Result<CliResult, CliError> {
    if !parsed.options.setup.yes {
        return Err(CliError::invalid("diagnostic log rotation requires --yes"));
    }
    let input =
        parsed.options.input.as_deref().ok_or_else(|| {
            CliError::invalid("rotate-log requires --input .boreal/logs/NAME.log")
        })?;
    let path = project_context::confined_path(&ctx.root, Path::new(input), true)?;
    if !path.starts_with(ctx.root.join(".boreal/logs"))
        || path.extension().and_then(|v| v.to_str()) != Some("log")
    {
        return Err(CliError::invalid(
            "only diagnostic .log files under .boreal/logs may be rotated",
        ));
    }
    let expected = parsed
        .options
        .expected_revision
        .ok_or_else(|| CliError::invalid("rotate-log requires --expected-revision"))?;
    let max = parsed
        .options
        .extra
        .get("--max-bytes")
        .and_then(|v| v.last())
        .map(|v| v.parse::<u64>())
        .transpose()
        .map_err(|_| CliError::invalid("--max-bytes must be a byte count"))?
        .unwrap_or(0);
    let digest = boreal_application::sha256_content_digest(operation.as_bytes());
    let archive = path.with_file_name(format!(
        "{}.{digest}.archived",
        path.file_name().unwrap().to_string_lossy()
    ));
    let context = V3MutationContext {
        project_id: ctx.project_id.clone(),
        actor_id: parsed.options.actor.clone(),
        session_id: Some(parsed.options.session.clone()),
        operation_id: operation.into(),
        request_digest: boreal_application::canonical_request_digest(
            "storage.rotate-log",
            json!({"input":path,"archive":archive,"max_bytes":max,"expected_revision":expected}),
        ),
        expected_revision: Some(expected),
        now: stamp(now_ms_u64()),
    };
    if store
        .operation(operation)
        .map_err(map_store_error)?
        .is_none()
    {
        let bytes = fs::metadata(&path)
            .map_err(|e| CliError::invalid(e.to_string()))?
            .len();
        if bytes <= max {
            return Ok(CliResult {
                outcome: ApplicationOutcome::Unchanged,
                data: Some(json!({"rotated":false,"reason":"below_max_bytes","size_bytes":bytes})),
                ..CliResult::default()
            });
        }
    }
    let admission = store
        .admit_diagnostic_rotation(
            &context,
            &path.to_string_lossy(),
            &archive.to_string_lossy(),
        )
        .map_err(map_store_error)?;
    let job = store
        .maintenance_job(operation)
        .map_err(map_store_error)?
        .ok_or_else(|| CliError::invalid("rotation admission has no journal"))?;
    if job.stage == "committed" {
        return Ok(CliResult {
            outcome: ApplicationOutcome::Unchanged,
            revision: Some(admission.revision),
            data: job
                .result_json
                .map(|s| serde_json::from_str(&s))
                .transpose()
                .map_err(|e| CliError::invalid(e.to_string()))?,
            ..CliResult::default()
        });
    }
    if admission.replayed {
        return Err(CliError::with(ErrorCode::OperationConflict,ApplicationOutcome::Unknown,"rotation is admitted but incomplete; inspect maintenance show before reconciling the files"));
    }
    let effect = (|| -> Result<Value, std::io::Error> {
        let original_permissions = fs::metadata(&path)?.permissions();
        let reservation = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&archive)?;
        reservation.sync_all()?;
        fs::rename(&path, &archive)?;
        let replacement = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)?;
        replacement.set_permissions(original_permissions)?;
        replacement.sync_all()?;
        Ok(
            json!({"rotated":true,"path":path,"archived_path":archive,"canonical_history_modified":false,"writers_must_reopen":true}),
        )
    })();
    match effect {
        Ok(data) => {
            store
                .transition_maintenance_job(&MaintenanceJobTransition {
                    operation_id: operation.into(),
                    expected_stage: "registered".into(),
                    next_stage: "committed".into(),
                    result_json: Some(data.to_string()),
                    error_message: None,
                    at: stamp(now_ms_u64()),
                })
                .map_err(|e| {
                    CliError::with(
                        ErrorCode::OperationConflict,
                        ApplicationOutcome::Unknown,
                        format!("rotation completed but journal requires readback: {e}"),
                    )
                })?;
            Ok(CliResult {
                outcome: ApplicationOutcome::Changed,
                revision: Some(admission.revision),
                data: Some(data),
                ..CliResult::default()
            })
        }
        Err(e) => Err(CliError::with(
            ErrorCode::OperationConflict,
            ApplicationOutcome::Unknown,
            format!("rotation requires readback: {e}; inspect maintenance show {operation}"),
        )),
    }
}
