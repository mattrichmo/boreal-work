//! Opt-in local harness process adapter. The process is launched only after a
//! canonical claim has committed; no shell or long-lived database transaction
//! is involved. Configuration is operator-owned, project-confined JSON.
use super::orchestration_commands::map_orchestration_error;
use super::*;
use boreal_application::orchestration_runtime::{HarnessPolicy, OrchestrationRuntimeApplication};
use boreal_application::{
    AcceptAttemptRequest, AttemptLifecycleAdapter, AttemptRequest, EndAttemptRequest,
    RenewLeaseAttemptRequest,
};
use boreal_store::V3MutationContext;
use std::io::Read;
#[cfg(unix)]
use std::os::unix::process::CommandExt;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};
static RUNTIME_STOP_REQUESTED: AtomicBool = AtomicBool::new(false);
pub(crate) static RUNTIME_MUTATION_LOCK: Mutex<()> = Mutex::new(());

pub(crate) struct DispatchClaimInput<'a> {
    pub(crate) operation: &'a str,
    pub(crate) work_id: &'a str,
    pub(crate) run_id: &'a str,
    pub(crate) claim: &'a Value,
    pub(crate) policy: HarnessPolicy,
    pub(crate) policy_digest: &'a str,
}

type WorkerSlot = (
    boreal_application::orchestration_runtime::WorkerIdentity,
    Option<(String, thread::JoinHandle<Result<CliResult, CliError>>)>,
);

pub(crate) fn runtime_mutation_guard() -> MutexGuard<'static, ()> {
    RUNTIME_MUTATION_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}
#[cfg(unix)]
extern "C" fn runtime_signal_handler(_: i32) {
    RUNTIME_STOP_REQUESTED.store(true, Ordering::SeqCst);
}
#[cfg(unix)]
fn install_runtime_signal_handlers() {
    unsafe extern "C" {
        fn signal(sig: i32, handler: usize) -> usize;
    }
    unsafe {
        let handler = runtime_signal_handler as *const () as usize;
        let _ = signal(2, handler);
        let _ = signal(15, handler);
    }
}

pub(crate) fn dispatch_claim(
    parsed: &ParsedCommand,
    store: &SqliteStore,
    dispatch: DispatchClaimInput<'_>,
) -> Result<Value, CliError> {
    let DispatchClaimInput {
        operation,
        work_id,
        run_id,
        claim,
        policy,
        policy_digest,
    } = dispatch;
    let context = project_context::resolve(parsed)?;
    let workspace = context
        .root
        .canonicalize()
        .map_err(|e| CliError::invalid(e.to_string()))?;
    let mut policy = policy;
    policy.cwd = policy.cwd.canonicalize().map_err(|e| {
        CliError::invalid(format!(
            "configured harness working directory is unavailable: {e}"
        ))
    })?;
    policy
        .validate(&workspace)
        .map_err(|e| CliError::invalid(e.to_string()))?;
    let project = ProjectId::new(context.project_id.clone());
    let attempt_id = claim
        .get("attempt_id")
        .and_then(Value::as_str)
        .ok_or_else(|| CliError::invalid("canonical claim did not return attempt_id"))?;
    let fence = claim
        .get("fence")
        .and_then(Value::as_u64)
        .ok_or_else(|| CliError::invalid("canonical claim did not return fence"))?;
    let adapter = SqliteAttemptAdapter::new(store);
    let attempt = adapter
        .current_attempt(&project, &AttemptId::new(attempt_id))
        .map_err(|e| map_application_error(ApplicationError::from(e)))?;
    if attempt.actor_id.as_str() != parsed.options.actor
        || attempt.session_id.as_ref().map(|s| s.as_str()) != Some(parsed.options.session.as_str())
        || attempt.harness_id.as_ref().map(|h| h.as_str()) != Some(parsed.options.harness.as_str())
        || attempt.fence.get() != fence
        || attempt.work_id.as_str() != work_id
    {
        return Err(CliError::with(
            ErrorCode::PermissionDenied,
            ApplicationOutcome::Rejected,
            "canonical attempt identity does not match the configured worker",
        ));
    }
    let launch_guard = runtime_mutation_guard();
    let current_policy = OrchestrationRuntimeApplication::new(store)
        .policy(&context.project_id, &parsed.options.harness)
        .map_err(map_runtime_error)?;
    if current_policy.as_ref().map(|p| p.1.as_str()) != Some(policy_digest) {
        if attempt.current && attempt.fence.get() == fence {
            let request = AttemptRequest::new(
                project.clone(),
                WorkId::new(work_id),
                AttemptId::new(attempt_id),
                ActorId::new(parsed.options.actor.clone()),
                Some(HarnessId::new(parsed.options.harness.clone())),
                Some(SessionId::new(parsed.options.session.clone())),
                Fence::new(fence),
                OperationId::new(format!("{operation}:prelaunch-policy-stale")),
                canonical_request_digest(
                    "orchestration.process.prelaunch-release",
                    json!({"attempt":attempt_id,"fence":fence}),
                ),
                TimestampMs::from_millis(now_ms_u64()),
            );
            let end = EndAttemptRequest {
                attempt: request,
                reason: Some(
                    "harness policy changed after claim; dispatch was not launched".into(),
                ),
            };
            let _ = WorkApplication::new(store).release(&adapter, end);
        }
        return Err(CliError::with(
            ErrorCode::StaleContext,
            ApplicationOutcome::Rejected,
            "harness policy changed after preflight; canonical claim was released without launch",
        ));
    }
    let runtime = OrchestrationRuntimeApplication::new(store);
    runtime
        .verify_bound_session(
            &context.project_id,
            &parsed.options.actor,
            &parsed.options.session,
            &parsed.options.harness,
        )
        .map_err(|e| {
            CliError::with(
                ErrorCode::PermissionDenied,
                ApplicationOutcome::Rejected,
                e.to_string(),
            )
        })?;
    let job_id = format!("dispatch-{operation}");
    let deadline = stamp(attempt.hard_deadline.as_millis());
    let job = boreal_store::orchestration_runtime::OrchestrationProcessJob {
        job_id: job_id.clone(),
        project_id: context.project_id.clone(),
        run_id: run_id.to_owned(),
        tick_id: operation.into(),
        work_id: work_id.into(),
        attempt_id: attempt_id.into(),
        fence,
        actor_id: parsed.options.actor.clone(),
        session_id: parsed.options.session.clone(),
        harness_id: parsed.options.harness.clone(),
        state: "starting".into(),
        pid: None,
        started_at: stamp(now_ms_u64()),
        deadline: deadline.clone(),
        ended_at: None,
        exit_code: None,
        result_digest: None,
        error_message: None,
        revision: 1,
    };
    let job_context = runtime_context(
        parsed,
        store,
        &format!("{operation}:process-start"),
        "orchestration.process.start",
        json!({"job_id":job_id,"run_id":job.run_id,"work_id":work_id,"attempt_id":attempt_id,"fence":fence,"harness":policy.harness_id,"deadline":deadline}),
    )?;
    runtime
        .register_process(&job_context, &job)
        .map_err(map_runtime_error)?;
    let request = AttemptRequest::new(
        project.clone(),
        WorkId::new(work_id),
        AttemptId::new(attempt_id),
        ActorId::new(parsed.options.actor.clone()),
        Some(HarnessId::new(parsed.options.harness.clone())),
        Some(SessionId::new(parsed.options.session.clone())),
        Fence::new(fence),
        OperationId::new(format!("{operation}:accept")),
        canonical_request_digest(
            "orchestration.process.accept",
            json!({"operation":operation,"attempt":attempt_id,"fence":fence}),
        ),
        TimestampMs::from_millis(now_ms_u64()),
    );
    let accepted = WorkApplication::new(store)
        .accept(
            &adapter,
            AcceptAttemptRequest::new(
                request.project_id,
                request.work_id,
                request.attempt_id,
                request.actor_id,
                request.harness_id,
                request.session_id,
                request.fence,
                request.operation_id,
                request.request_digest,
                request.at,
            ),
        )
        .map_err(|error| {
            let c = runtime_context(
                parsed,
                store,
                &format!("{operation}:accept-failed"),
                "orchestration.process.accept-failed",
                json!({"job_id":job_id,"error":error.to_string()}),
            );
            if let Ok(c) = c {
                let _ = runtime.transition_process(
                    &c,
                    &job_id,
                    1,
                    "failed",
                    None,
                    None,
                    None,
                    Some("canonical attempt acceptance failed"),
                );
            }
            map_application_error(error)
        })?;
    let current = adapter
        .current_attempt(&project, &AttemptId::new(attempt_id))
        .map_err(|e| map_application_error(ApplicationError::from(e)))?;
    if !current.current
        || current.fence.get() != fence
        || current.phase != boreal_domain::AttemptPhase::Accepted
    {
        return Err(CliError::with(
            ErrorCode::AttemptConflict,
            ApplicationOutcome::Conflict,
            "attempt ownership changed before worker launch",
        ));
    }
    let start_request = AttemptRequest::new(
        project.clone(),
        WorkId::new(work_id),
        AttemptId::new(attempt_id),
        ActorId::new(parsed.options.actor.clone()),
        Some(HarnessId::new(parsed.options.harness.clone())),
        Some(SessionId::new(parsed.options.session.clone())),
        Fence::new(fence),
        OperationId::new(format!("{operation}:start")),
        canonical_request_digest(
            "orchestration.process.start",
            json!({"attempt":attempt_id,"fence":fence}),
        ),
        TimestampMs::from_millis(now_ms_u64()),
    );
    WorkApplication::new(store)
        .start(
            &adapter,
            AcceptAttemptRequest::new(
                start_request.project_id,
                start_request.work_id,
                start_request.attempt_id,
                start_request.actor_id,
                start_request.harness_id,
                start_request.session_id,
                start_request.fence,
                start_request.operation_id,
                start_request.request_digest,
                start_request.at,
            ),
        )
        .map_err(map_application_error)?;
    // Revalidate identity, fence, and operator policy at the last boundary
    // before spawn. If this readback is uncertain, leave a durable marker and
    // never guess that dispatch happened.
    let launch_check = (|| -> Result<(), CliError> {
        runtime
            .verify_bound_session(
                &context.project_id,
                &parsed.options.actor,
                &parsed.options.session,
                &parsed.options.harness,
            )
            .map_err(map_runtime_error)?;
        let fresh = adapter
            .current_attempt(&project, &AttemptId::new(attempt_id))
            .map_err(|e| map_application_error(ApplicationError::from(e)))?;
        if !fresh.current
            || fresh.fence.get() != fence
            || fresh.phase != boreal_domain::AttemptPhase::Running
        {
            return Err(CliError::with(
                ErrorCode::AttemptConflict,
                ApplicationOutcome::Conflict,
                "attempt ownership changed immediately before harness spawn",
            ));
        }
        let current_policy = runtime
            .policy(&context.project_id, &parsed.options.harness)
            .map_err(map_runtime_error)?;
        if current_policy.as_ref().map(|p| p.1.as_str()) != Some(policy_digest) {
            return Err(CliError::with(
                ErrorCode::StaleContext,
                ApplicationOutcome::Rejected,
                "harness policy changed immediately before spawn",
            ));
        }
        policy.validate(&workspace).map_err(map_runtime_error)?;
        Ok(())
    })();
    if let Err(error) = launch_check {
        if let Ok(c) = runtime_context(
            parsed,
            store,
            &format!("{operation}:prelaunch-readback"),
            "orchestration.process.prelaunch-readback",
            json!({"job_id":job_id,"error":error.message}),
        ) {
            let _ = runtime.transition_process(&c, &job_id, 1, "readback_required", None, None, None, Some("prelaunch authorization or ownership changed; external launch was not attempted"));
        }
        return Err(error);
    }
    let mut child = Command::new(&policy.executable);
    #[cfg(unix)]
    child.process_group(0);
    child
        .env_clear()
        .current_dir(&policy.cwd)
        .args(policy.args.iter().map(|arg| {
            expand_arg(
                arg,
                &context.project_id,
                work_id,
                attempt_id,
                &parsed.options.actor,
                &parsed.options.session,
                fence,
            )
        }))
        .env("BOREAL_PROJECT_ID", &context.project_id)
        .env("BOREAL_WORK_ID", work_id)
        .env("BOREAL_ATTEMPT_ID", attempt_id)
        .env("BOREAL_ATTEMPT_FENCE", fence.to_string())
        .env("BOREAL_ACTOR_ID", &parsed.options.actor)
        .env("BOREAL_SESSION_ID", &parsed.options.session)
        .env("BOREAL_HARNESS_ID", &policy.harness_id)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (name, value) in &policy.environment {
        child.env(name, value);
    }
    let started = Instant::now();
    let mut process = match child.spawn() {
        Ok(child) => child,
        Err(e) => {
            let c = runtime_context(
                parsed,
                store,
                &format!("{operation}:process-failed-to-start"),
                "orchestration.process.failed",
                json!({"job_id":job_id,"error":e.to_string()}),
            )?;
            let _ = runtime.transition_process(
                &c,
                &job_id,
                1,
                "failed",
                None,
                None,
                None,
                Some("configured harness failed to spawn"),
            );
            if let Ok(current) = adapter.current_attempt(&project, &AttemptId::new(attempt_id)) {
                if current.current && current.fence.get() == fence {
                    let request = AttemptRequest::new(
                        project.clone(),
                        WorkId::new(work_id),
                        AttemptId::new(attempt_id),
                        ActorId::new(parsed.options.actor.clone()),
                        Some(HarnessId::new(parsed.options.harness.clone())),
                        Some(SessionId::new(parsed.options.session.clone())),
                        Fence::new(fence),
                        OperationId::new(format!("{operation}:spawn-failed-end")),
                        canonical_request_digest(
                            "orchestration.process.spawn-failed",
                            json!({"attempt":attempt_id,"fence":fence}),
                        ),
                        TimestampMs::from_millis(now_ms_u64()),
                    );
                    let _ = WorkApplication::new(store).fail(
                        &adapter,
                        EndAttemptRequest {
                            attempt: request,
                            reason: Some("configured harness failed to spawn".into()),
                        },
                    );
                }
            }
            return Err(CliError::with(
                ErrorCode::ServiceUnavailable,
                ApplicationOutcome::Failed,
                format!("configured harness failed to spawn: {e}"),
            ));
        }
    };
    let pid = process.id();
    let running_context = match runtime_context(
        parsed,
        store,
        &format!("{operation}:process-running"),
        "orchestration.process.running",
        json!({"job_id":job_id,"pid":pid}),
    ) {
        Ok(context) => context,
        Err(error) => {
            terminate_process_group(pid, &mut process);
            return Err(error);
        }
    };
    if let Err(e) = runtime.transition_process(
        &running_context,
        &job_id,
        1,
        "running",
        Some(pid as u64),
        None,
        None,
        None,
    ) {
        terminate_process_group(pid, &mut process);
        if let (Ok(Some(job)), Ok(c)) = (
            store.orchestration_process_job(&context.project_id, &job_id),
            runtime_context(
                parsed,
                store,
                &format!("{operation}:process-running-readback"),
                "orchestration.process.readback",
                json!({"job_id":job_id,"pid":pid,"error":e.to_string()}),
            ),
        ) {
            let _ = runtime.transition_process(
                &c,
                &job_id,
                job.revision,
                "readback_required",
                Some(pid as u64),
                None,
                None,
                Some("child was stopped after process-start journal transition failed"),
            );
        }
        return Err(map_runtime_error(e));
    }
    drop(launch_guard);
    let mut stdout = match process.stdout.take() {
        Some(pipe) => pipe,
        None => {
            terminate_process_group(pid, &mut process);
            return Err(CliError::invalid("child stdout pipe unavailable"));
        }
    };
    let mut stderr = match process.stderr.take() {
        Some(pipe) => pipe,
        None => {
            terminate_process_group(pid, &mut process);
            return Err(CliError::invalid("child stderr pipe unavailable"));
        }
    };
    let cap = policy.output_cap_bytes as usize;
    let (out_sender, out_receiver) = std::sync::mpsc::sync_channel(1);
    let (err_sender, err_receiver) = std::sync::mpsc::sync_channel(1);
    thread::spawn(move || {
        let _ = out_sender.send(read_capped(&mut stdout, cap));
    });
    thread::spawn(move || {
        let _ = err_sender.send(read_capped(&mut stderr, cap));
    });
    let mut timed_out = false;
    let mut last_heartbeat = Instant::now();
    let mut cancelled = false;
    let mut worker_error: Option<CliError> = None;
    let status = loop {
        if RUNTIME_STOP_REQUESTED.load(Ordering::SeqCst) {
            cancelled = true;
            terminate_process_group(pid, &mut process);
            break process.wait().ok();
        }
        match process.try_wait() {
            Ok(Some(status)) => break Some(status),
            Err(error) => {
                worker_error = Some(CliError::with(
                    ErrorCode::ServiceUnavailable,
                    ApplicationOutcome::Unknown,
                    format!("process status readback failed: {error}"),
                ));
                terminate_process_group(pid, &mut process);
                break process.wait().ok();
            }
            _ => {}
        }
        if started.elapsed() >= Duration::from_millis(policy.timeout_ms) {
            timed_out = true;
            terminate_process_group(pid, &mut process);
            break process.wait().ok();
        }
        if last_heartbeat.elapsed() >= Duration::from_secs(20) {
            let live = match boreal_application::OrchestrationApplication::new(store)
                .and_then(|a| a.show(&context.project_id, run_id))
            {
                Ok(run) => run,
                Err(error) => {
                    worker_error = Some(map_orchestration_error(error));
                    terminate_process_group(pid, &mut process);
                    break process.wait().ok();
                }
            };
            if live.state == "cancelled" {
                cancelled = true;
                terminate_process_group(pid, &mut process);
                break process.wait().ok();
            }
            let current = match adapter.current_attempt(&project, &AttemptId::new(attempt_id)) {
                Ok(current) => current,
                Err(error) => {
                    worker_error = Some(map_application_error(ApplicationError::from(error)));
                    terminate_process_group(pid, &mut process);
                    break process.wait().ok();
                }
            };
            if !current.current || current.fence.get() != fence {
                cancelled = true;
                terminate_process_group(pid, &mut process);
                break process.wait().ok();
            }
            let attempt_guard = runtime_mutation_guard();
            let beat = AttemptRequest::new(
                project.clone(),
                WorkId::new(work_id),
                AttemptId::new(attempt_id),
                ActorId::new(parsed.options.actor.clone()),
                Some(HarnessId::new(parsed.options.harness.clone())),
                Some(SessionId::new(parsed.options.session.clone())),
                Fence::new(fence),
                OperationId::new(format!("{operation}:heartbeat:{}", now_ms_u64())),
                canonical_request_digest(
                    "orchestration.process.heartbeat",
                    json!({"attempt":attempt_id,"fence":fence}),
                ),
                TimestampMs::from_millis(now_ms_u64()),
            );
            if let Err(error) = WorkApplication::new(store).renew_lease(
                &adapter,
                RenewLeaseAttemptRequest {
                    attempt: beat,
                    lease_ttl_ms: 60_000,
                },
            ) {
                worker_error = Some(map_application_error(error));
                terminate_process_group(pid, &mut process);
                break process.wait().ok();
            }
            drop(attempt_guard);
            if let Some(owner) = parsed
                .options
                .extra
                .get("--worker-owner")
                .and_then(|v| v.last())
            {
                let worker = match runtime.worker(&context.project_id) {
                    Ok(Some(worker)) => worker,
                    Ok(None) => {
                        worker_error = Some(CliError::unknown_delivery(
                            operation,
                            "worker lease disappeared during child execution",
                        ));
                        terminate_process_group(pid, &mut process);
                        break process.wait().ok();
                    }
                    Err(error) => {
                        worker_error = Some(map_runtime_error(error));
                        terminate_process_group(pid, &mut process);
                        break process.wait().ok();
                    }
                };
                if worker.owner_id != *owner || worker.state != "running" {
                    cancelled = true;
                    terminate_process_group(pid, &mut process);
                    break process.wait().ok();
                }
            }
            last_heartbeat = Instant::now();
        }
        thread::sleep(Duration::from_millis(250));
    };
    terminate_process_group(pid, &mut process);
    let output_read = Duration::from_secs(3);
    let out = out_receiver.recv_timeout(output_read).ok();
    let err = err_receiver.recv_timeout(output_read).ok();
    if out.is_none() || err.is_none() {
        worker_error = Some(CliError::unknown_delivery(
            operation,
            "harness output pipes did not close after process-group shutdown; durable readback is required",
        ));
    }
    let output = [out.unwrap_or_default(), err.unwrap_or_default()].concat();
    let result_digest = boreal_store::checksum(&output);
    let (state, error) = if worker_error.is_some() {
        (
            "readback_required",
            Some("runtime stopped after an uncertain canonical readback"),
        )
    } else if cancelled {
        ("cancelled", Some("run cancelled or attempt fence changed"))
    } else if timed_out {
        ("failed", Some("configured harness timed out"))
    } else if status.as_ref().is_some_and(|s| s.success()) {
        ("succeeded", None)
    } else {
        ("failed", Some("configured harness exited unsuccessfully"))
    };
    let finish_guard = runtime_mutation_guard();
    let current_job = store
        .orchestration_process_job(&context.project_id, &job_id)
        .map_err(map_store_error)?
        .ok_or_else(|| CliError::invalid("durable process job disappeared"))?;
    let finish_context = runtime_context(
        parsed,
        store,
        &format!("{operation}:process-finish"),
        "orchestration.process.finish",
        json!({"job_id":job_id,"state":state,"exit_code":status.as_ref().and_then(|s|s.code()),"result_digest":result_digest,"error":error}),
    )?;
    runtime
        .transition_process(
            &finish_context,
            &job_id,
            current_job.revision,
            state,
            Some(pid as u64),
            status.as_ref().and_then(|s| s.code()).map(i64::from),
            Some(&result_digest),
            error,
        )
        .map_err(map_runtime_error)?;
    if let Some(error) = worker_error {
        drop(finish_guard);
        return Err(error);
    }
    if state == "cancelled" || state == "failed" {
        let ended = adapter
            .current_attempt(&project, &AttemptId::new(attempt_id))
            .map_err(|e| map_application_error(ApplicationError::from(e)))?;
        if ended.current && ended.fence.get() == fence {
            let end = AttemptRequest::new(
                project.clone(),
                WorkId::new(work_id),
                AttemptId::new(attempt_id),
                ActorId::new(parsed.options.actor.clone()),
                Some(HarnessId::new(parsed.options.harness.clone())),
                Some(SessionId::new(parsed.options.session.clone())),
                Fence::new(fence),
                OperationId::new(format!("{operation}:end")),
                canonical_request_digest(
                    "orchestration.process.end",
                    json!({"attempt":attempt_id,"fence":fence,"state":state}),
                ),
                TimestampMs::from_millis(now_ms_u64()),
            );
            let request = EndAttemptRequest {
                attempt: end,
                reason: Some(error.unwrap_or("configured harness ended").to_owned()),
            };
            if state == "cancelled" {
                WorkApplication::new(store)
                    .release(&adapter, request)
                    .map_err(map_application_error)?;
            } else {
                WorkApplication::new(store)
                    .fail(&adapter, request)
                    .map_err(map_application_error)?;
            }
        }
    }
    drop(finish_guard);
    Ok(
        json!({"attempt_id":attempt_id,"fence":fence,"accepted_revision":accepted.snapshot_revision,"job_id":job_id,"state":state,"exit_code":status.as_ref().and_then(|s|s.code()),"result_digest":result_digest,"output_bytes":output.len(),"output_truncated":output.len()>=cap,"agent_launched":true,"attempt_completion":"requires canonical evidence and finish"}),
    )
}
#[cfg(unix)]
fn terminate_process_group(pid: u32, child: &mut std::process::Child) {
    unsafe extern "C" {
        fn kill(pid: i32, sig: i32) -> i32;
    }
    unsafe {
        let _ = kill(-(pid as i32), 9);
    }
    let _ = child.kill();
    let _ = child.wait();
}
#[cfg(not(unix))]
fn terminate_process_group(_pid: u32, child: &mut std::process::Child) {
    let _ = child.kill();
    let _ = child.wait();
}
fn expand_arg(
    arg: &str,
    project: &str,
    work: &str,
    attempt: &str,
    actor: &str,
    session: &str,
    fence: u64,
) -> String {
    arg.replace("{project}", project)
        .replace("{work}", work)
        .replace("{attempt}", attempt)
        .replace("{actor}", actor)
        .replace("{session}", session)
        .replace("{fence}", &fence.to_string())
}
fn read_capped(reader: &mut impl Read, cap: usize) -> Vec<u8> {
    let mut result = Vec::new();
    let mut buffer = [0u8; 8192];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                let remaining = cap.saturating_sub(result.len());
                result.extend_from_slice(&buffer[..n.min(remaining)]);
            }
        }
    }
    result
}
fn runtime_context(
    parsed: &ParsedCommand,
    store: &SqliteStore,
    operation: &str,
    command: &str,
    payload: Value,
) -> Result<V3MutationContext, CliError> {
    let project = parsed
        .options
        .project
        .clone()
        .ok_or_else(|| CliError::invalid("runtime requires --project"))?;
    let revision = store_revision(store, &ProjectId::new(project.clone()))?;
    Ok(V3MutationContext {
        project_id: project,
        actor_id: parsed.options.actor.clone(),
        session_id: Some(parsed.options.session.clone()),
        operation_id: operation.to_owned(),
        request_digest: canonical_request_digest(
            command,
            json!({"operation":operation,"payload":payload,"actor":parsed.options.actor,"session":parsed.options.session}),
        ),
        expected_revision: Some(revision),
        now: stamp(now_ms_u64()),
    })
}
pub(crate) fn map_runtime_error(
    error: boreal_application::orchestration_runtime::RuntimeError,
) -> CliError {
    match error {
        boreal_application::orchestration_runtime::RuntimeError::Store(e) => map_store_error(e),
        boreal_application::orchestration_runtime::RuntimeError::Identity(e) => {
            CliError::with(ErrorCode::PermissionDenied, ApplicationOutcome::Rejected, e)
        }
        boreal_application::orchestration_runtime::RuntimeError::Invalid(e) => CliError::invalid(e),
    }
}

/// Runs a bounded opt-in pool. Each worker is bound to one distinct active
/// actor/session/harness triple; the durable project lease fences coordinators.
pub(crate) fn daemon_run(
    parsed: &ParsedCommand,
    operation: &str,
    store: &SqliteStore,
) -> Result<CliResult, CliError> {
    RUNTIME_STOP_REQUESTED.store(false, Ordering::SeqCst);
    #[cfg(unix)]
    install_runtime_signal_handlers();
    let project = parsed
        .options
        .project
        .clone()
        .ok_or_else(|| CliError::invalid("daemon run requires --project"))?;
    let worker_pool_id = parsed
        .options
        .extra
        .get("--pool")
        .and_then(|v| v.last())
        .cloned()
        .ok_or_else(|| CliError::invalid("daemon run requires --pool ID"))?;
    let caller = credentials::authenticate(parsed, store)?;
    if caller.role != boreal_domain::ActorRole::Operator {
        return Err(CliError::with(
            ErrorCode::PermissionDenied,
            ApplicationOutcome::Rejected,
            "daemon run requires an authenticated project operator",
        ));
    }
    let (pool, pool_digest, _pool_revision) = OrchestrationRuntimeApplication::new(store)
        .worker_pool(&project, &worker_pool_id)
        .map_err(map_runtime_error)?
        .ok_or_else(|| {
            CliError::with(
                ErrorCode::NotFound,
                ApplicationOutcome::Rejected,
                format!("no active operator-registered worker pool {worker_pool_id}"),
            )
        })?;
    validate_pool_members(
        &project_context::resolve(parsed)?.root,
        &project,
        store,
        &pool,
    )?;
    if parsed.options.dispatch_workers == Some(0) {
        return Err(CliError::invalid(
            "--workers must be from 1 to the configured pool size",
        ));
    }
    let workers = parsed
        .options
        .dispatch_workers
        .unwrap_or(pool.workers.len())
        .max(1) as u64;
    if workers > pool.workers.len() as u64 || workers > 32 {
        return Err(CliError::invalid(format!(
            "--workers must be from 1 to {} for this pool",
            pool.workers.len().min(32)
        )));
    }
    let max_requests = parsed.options.max_requests.unwrap_or(1) as u64;
    if !(1..=10_000).contains(&max_requests) {
        return Err(CliError::invalid("--max-requests must be from 1 to 10000"));
    }
    let expected = parsed
        .options
        .expected_revision
        .ok_or_else(|| CliError::invalid("daemon run requires --expected-revision"))?;
    let actual = store_revision(store, &ProjectId::new(project.clone()))?;
    if expected != actual {
        return Err(CliError::with(
            ErrorCode::RevisionConflict,
            ApplicationOutcome::Conflict,
            format!("expected project revision {expected}, found {actual}"),
        ));
    }
    let owner = format!(
        "{}:{}:{}",
        parsed.options.actor,
        std::process::id(),
        operation
    );
    let app = OrchestrationRuntimeApplication::new(store);
    let now = now_ms_u64();
    let acquire = runtime_context(
        parsed,
        store,
        &format!("{operation}:acquire"),
        "orchestration.daemon.acquire",
        json!({"owner":owner,"workers":workers,"max_requests":max_requests}),
    )?;
    let lease = stamp(now.saturating_add(60_000));
    app.acquire(&acquire, &owner, &lease, workers, max_requests)
        .map_err(map_runtime_error)?;
    // Recover process rows left active by an expired worker lease as unknown;
    // never re-dispatch a possibly live harness after a coordinator crash.
    loop {
        let active = app.active_jobs(&project, 1000).map_err(map_runtime_error)?;
        if active.is_empty() {
            break;
        }
        for old in active {
            let c = runtime_context(
                parsed,
                store,
                &format!("{operation}:recover:{}", old.job_id),
                "orchestration.process.recover",
                json!({"job_id":old.job_id,"state":"uncertain"}),
            )?;
            app.transition_process(&c, &old.job_id, old.revision, "uncertain", old.pid, None, None, Some("worker restart requires harness liveness readback; automatic redispatch is disabled")).map_err(map_runtime_error)?;
        }
    }
    let mut requests = 0u64;
    let mut completed = 0u64;
    let mut completed_unreported = 0u64;
    let mut claims = 0u64;
    let mut idle_polls = 0u64;
    let mut last = None;
    let mut lease_heartbeat = Instant::now();
    let db_path = store
        .database_path()
        .ok_or_else(|| {
            CliError::invalid("parallel local workers require a file-backed project database")
        })?
        .to_path_buf();
    let mut slots: Vec<WorkerSlot> = pool
        .workers
        .into_iter()
        .take(workers as usize)
        .map(|identity| (identity, None))
        .collect();
    loop {
        let mut did_work = false;
        for (_, active) in &mut slots {
            if active
                .as_ref()
                .is_some_and(|(_, handle)| handle.is_finished())
            {
                let (run_id, handle) = active.take().expect("finished worker handle exists");
                completed = completed.saturating_add(1);
                completed_unreported = completed_unreported.saturating_add(1);
                did_work = true;
                match handle.join() {
                    Ok(Ok(result)) => {
                        last = result.data;
                        let claimed = last
                            .as_ref()
                            .and_then(|v| v.pointer("/result/tick/outcome"))
                            .and_then(Value::as_str)
                            == Some("claimed");
                        if claimed {
                            claims = claims.saturating_add(1);
                        }
                    }
                    Ok(Err(error))
                        if error.outcome == ApplicationOutcome::Unknown
                            || error.outcome == ApplicationOutcome::Conflict =>
                    {
                        RUNTIME_STOP_REQUESTED.store(true, Ordering::SeqCst);
                        last = Some(
                            json!({"outcome":"needs_readback","run_id":run_id,"error":error.message}),
                        );
                    }
                    Ok(Err(error)) => {
                        last =
                            Some(json!({"outcome":"failed","run_id":run_id,"error":error.message}));
                    }
                    Err(_) => {
                        RUNTIME_STOP_REQUESTED.store(true, Ordering::SeqCst);
                        last = Some(
                            json!({"outcome":"needs_readback","run_id":run_id,"error":"worker thread panicked; inspect durable process job"}),
                        );
                    }
                }
            }
        }
        if !RUNTIME_STOP_REQUESTED.load(Ordering::SeqCst) {
            match OrchestrationRuntimeApplication::new(store).worker_pool(&project, &worker_pool_id)
            {
                Ok(Some((_, digest, _))) if digest == pool_digest => {}
                Ok(_) => {
                    RUNTIME_STOP_REQUESTED.store(true, Ordering::SeqCst);
                    last = Some(
                        json!({"outcome":"stopping","reason":"worker pool was revoked or changed"}),
                    );
                }
                Err(error) => {
                    RUNTIME_STOP_REQUESTED.store(true, Ordering::SeqCst);
                    last = Some(
                        json!({"outcome":"stopping","reason":map_runtime_error(error).message}),
                    );
                }
            }
        }
        let can_schedule =
            requests < max_requests && !RUNTIME_STOP_REQUESTED.load(Ordering::SeqCst);
        if can_schedule {
            let current_operator = match credentials::authenticate(parsed, store) {
                Ok(p) => p,
                Err(e) => {
                    RUNTIME_STOP_REQUESTED.store(true, Ordering::SeqCst);
                    last = Some(
                        json!({"outcome":"stopping","reason":"coordinator credential was revoked","detail":e.message}),
                    );
                    continue;
                }
            };
            if current_operator.role != boreal_domain::ActorRole::Operator {
                RUNTIME_STOP_REQUESTED.store(true, Ordering::SeqCst);
                last = Some(
                    json!({"outcome":"stopping","reason":"coordinator lost operator authority"}),
                );
                continue;
            }
            // Scan the complete project run set with a stable keyset cursor.
            // A fixed newest-N prefix can starve pool identities whose runs
            // sort behind unrelated orchestration traffic.
            let runs = match (|| {
                let app = boreal_application::OrchestrationApplication::new(store)?;
                let mut all = Vec::new();
                let mut cursor = String::new();
                loop {
                    let page = app.list_after(&project, &cursor, 500)?;
                    if page.is_empty() {
                        break;
                    }
                    cursor = page.last().expect("non-empty page").run_id.clone();
                    let done = page.len() < 500;
                    all.extend(page);
                    if done {
                        break;
                    }
                }
                Ok::<_, boreal_application::OrchestrationError>(all)
            })() {
                Ok(runs) => runs,
                Err(error) => {
                    RUNTIME_STOP_REQUESTED.store(true, Ordering::SeqCst);
                    last = Some(
                        json!({"outcome":"stopping","error":map_orchestration_error(error).message}),
                    );
                    continue;
                }
            };
            let mut scheduled = std::collections::BTreeSet::new();
            for run in runs
                .into_iter()
                .filter(|r| r.state == "queued" || r.state == "running")
            {
                if requests >= max_requests || RUNTIME_STOP_REQUESTED.load(Ordering::SeqCst) {
                    break;
                }
                let selector: Value = match serde_json::from_str(&run.selector_json) {
                    Ok(v) => v,
                    Err(e) => {
                        RUNTIME_STOP_REQUESTED.store(true, Ordering::SeqCst);
                        last = Some(
                            json!({"outcome":"needs_readback","run_id":run.run_id,"error":e.to_string()}),
                        );
                        continue;
                    }
                };
                let actor = selector["actor"].as_str().unwrap_or("");
                let session = selector["session"].as_str().unwrap_or("");
                let harness = selector["harness"].as_str().unwrap_or("");
                let Some(slot_index) = slots.iter().position(|(identity, active)| {
                    active.is_none()
                        && identity.actor_id == actor
                        && identity.session_id == session
                        && identity.harness_id == harness
                }) else {
                    continue;
                };
                if !scheduled.insert(run.run_id.clone()) {
                    continue;
                }
                let identity = slots[slot_index].0.clone();
                let mut tick = parsed.clone();
                tick.path = vec!["orchestration".into(), "tick".into()];
                tick.options.positionals = vec![run.run_id.clone()];
                tick.options.actor = identity.actor_id.clone();
                tick.options.session = identity.session_id.clone();
                tick.options.harness = identity.harness_id.clone();
                tick.options.source_version =
                    selector["source_version"].as_str().map(str::to_owned);
                tick.options.config_identity =
                    selector["config_identity"].as_str().map(str::to_owned);
                tick.options.work = selector["work"].as_str().map(str::to_owned);
                tick.options
                    .extra
                    .insert("--dispatch-now".into(), vec!["true".into()]);
                tick.options
                    .extra
                    .insert("--worker-owner".into(), vec![owner.clone()]);
                tick.options
                    .extra
                    .insert("--pool".into(), vec![worker_pool_id.clone()]);
                tick.options
                    .extra
                    .insert("--pool-digest".into(), vec![pool_digest.clone()]);
                let tick_op = format!("{operation}:worker:{}", requests.saturating_add(1));
                requests = requests.saturating_add(1);
                let database = db_path.clone();
                let project_for_worker = project.clone();
                let pool_id_for_worker = worker_pool_id.clone();
                let pool_digest_for_worker = pool_digest.clone();
                let handle = thread::spawn(move || -> Result<CliResult, CliError> {
                    let worker_store =
                        SqliteStore::open(&database, PRODUCTION_SCHEMA).map_err(map_store_error)?;
                    let registered = OrchestrationRuntimeApplication::new(&worker_store)
                        .worker_pool(&project_for_worker, &pool_id_for_worker)
                        .map_err(map_runtime_error)?;
                    let Some((registered_policy, registered_digest, _)) = registered else {
                        return Err(CliError::with(
                            ErrorCode::StaleContext,
                            ApplicationOutcome::Rejected,
                            "worker pool was revoked before dispatch",
                        ));
                    };
                    if registered_digest != pool_digest_for_worker
                        || !registered_policy.workers.iter().any(|candidate| {
                            candidate.actor_id == tick.options.actor
                                && candidate.session_id == tick.options.session
                                && candidate.harness_id == tick.options.harness
                        })
                    {
                        return Err(CliError::with(
                            ErrorCode::StaleContext,
                            ApplicationOutcome::Rejected,
                            "worker identity or pool policy changed before dispatch",
                        ));
                    }
                    // Each worker proves the private local credential for its
                    // allowlisted identity before entering the canonical claim path.
                    credentials::authenticate(&tick, &worker_store)?;
                    validate_pool_members(
                        &project_context::resolve(&tick)?.root,
                        &project_for_worker,
                        &worker_store,
                        &registered_policy,
                    )?;
                    tick.options.expected_revision = Some(store_revision(
                        &worker_store,
                        &ProjectId::new(project_for_worker),
                    )?);
                    let result =
                        super::orchestration_commands::run(&tick, &tick_op, &worker_store)?;
                    Ok(result)
                });
                slots[slot_index].1 = Some((run.run_id, handle));
                did_work = true;
            }
        }
        if completed_unreported > 0 || lease_heartbeat.elapsed() >= Duration::from_secs(15) {
            let heartbeat_guard = runtime_mutation_guard();
            let heartbeat_result = (|| -> Result<(), CliError> {
                let revision = store_revision(store, &ProjectId::new(project.clone()))?;
                let mut beat = parsed.clone();
                beat.options.expected_revision = Some(revision);
                let c = runtime_context(
                    &beat,
                    store,
                    &format!("{operation}:heartbeat:{}:{}", completed, now_ms_u64()),
                    "orchestration.daemon.heartbeat",
                    json!({"owner":owner,"requests":requests,"completed":completed_unreported,"claims":claims}),
                )?;
                app.heartbeat(
                    &c,
                    &owner,
                    &stamp(now_ms_u64().saturating_add(60_000)),
                    completed_unreported,
                )
                .map_err(map_runtime_error)?;
                Ok(())
            })();
            drop(heartbeat_guard);
            match heartbeat_result {
                Ok(()) => {
                    completed_unreported = 0;
                    lease_heartbeat = Instant::now();
                }
                Err(error) => {
                    RUNTIME_STOP_REQUESTED.store(true, Ordering::SeqCst);
                    last = Some(json!({"outcome":"needs_readback","error":error.message}));
                }
            }
        }
        let active_count = slots.iter().filter(|(_, active)| active.is_some()).count();
        if active_count == 0 && (!can_schedule || !did_work) {
            idle_polls = idle_polls.saturating_add(1);
            thread::sleep(Duration::from_secs(1));
        } else if did_work {
            idle_polls = 0
        } else {
            thread::sleep(Duration::from_millis(250));
        }
        let scheduling_finished = requests >= max_requests
            || idle_polls >= 60
            || RUNTIME_STOP_REQUESTED.load(Ordering::SeqCst);
        if scheduling_finished && active_count == 0 {
            break;
        }
    }
    let c = runtime_context(
        parsed,
        store,
        &format!("{operation}:stop"),
        "orchestration.daemon.stop",
        json!({"owner":owner,"requests":requests,"claims":claims}),
    )?;
    app.stop(&c, &owner).map_err(map_runtime_error)?;
    Ok(CliResult {
        outcome: ApplicationOutcome::Changed,
        revision: Some(store_revision(store, &ProjectId::new(project))?),
        data: Some(
            json!({"owner_id":owner,"state":"stopped","requests_completed":completed,"requests_scheduled":requests,"claims":claims,"max_requests":max_requests,"workers":workers,"idle_poll_limit":60,"last":last,"dispatch":"local configured argv; no shell"}),
        ),
        ..CliResult::default()
    })
}

pub(crate) fn preflight_policy(
    parsed: &ParsedCommand,
    store: &SqliteStore,
) -> Result<(HarnessPolicy, String, u64), CliError> {
    let ctx = project_context::resolve(parsed)?;
    let workspace = ctx
        .root
        .canonicalize()
        .map_err(|e| CliError::invalid(e.to_string()))?;
    let (mut policy, digest, revision) = OrchestrationRuntimeApplication::new(store)
        .policy(&ctx.project_id, &parsed.options.harness)
        .map_err(map_runtime_error)?
        .ok_or_else(|| {
            CliError::with(
                ErrorCode::NotFound,
                ApplicationOutcome::Rejected,
                "no active operator-registered policy matches the run harness",
            )
        })?;
    if policy.harness_id != parsed.options.harness {
        return Err(CliError::invalid(
            "stored harness policy identity does not match the requested harness",
        ));
    }
    policy.cwd = policy.cwd.canonicalize().map_err(|e| {
        CliError::invalid(format!(
            "configured harness working directory is unavailable: {e}"
        ))
    })?;
    policy
        .validate(&workspace)
        .map_err(|e| CliError::invalid(e.to_string()))?;
    let meta = fs::symlink_metadata(&policy.executable).map_err(|e| {
        CliError::invalid(format!("configured executable metadata unavailable: {e}"))
    })?;
    if meta.file_type().is_symlink() {
        return Err(CliError::invalid(
            "configured harness executable may not be a symlink",
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if meta.permissions().mode() & 0o111 == 0 {
            return Err(CliError::invalid(
                "configured harness executable is not executable",
            ));
        }
    }
    OrchestrationRuntimeApplication::new(store)
        .verify_bound_session(
            &ctx.project_id,
            &parsed.options.actor,
            &parsed.options.session,
            &parsed.options.harness,
        )
        .map_err(map_runtime_error)?;
    Ok((policy, digest, revision))
}
fn pool_operator(
    parsed: &ParsedCommand,
    store: &SqliteStore,
) -> Result<project_context::ProjectContext, CliError> {
    let ctx = project_context::resolve(parsed)?;
    let principal = credentials::authenticate(parsed, store)?;
    if principal.role != boreal_domain::ActorRole::Operator {
        return Err(CliError::with(
            ErrorCode::PermissionDenied,
            ApplicationOutcome::Rejected,
            "worker-pool management requires an authenticated project operator",
        ));
    }
    Ok(ctx)
}
fn validate_pool_members(
    root: &Path,
    project: &str,
    store: &SqliteStore,
    policy: &boreal_application::orchestration_runtime::WorkerPoolPolicy,
) -> Result<(), CliError> {
    policy.validate().map_err(map_runtime_error)?;
    let runtime = OrchestrationRuntimeApplication::new(store);
    for identity in &policy.workers {
        let secret = credentials::load(root, project, &identity.actor_id)?;
        let principal = store
            .authenticate_principal(project, &secret, TimestampMs::from_millis(now_ms_u64()))
            .map_err(|_| {
                CliError::with(
                    ErrorCode::PermissionDenied,
                    ApplicationOutcome::Rejected,
                    format!(
                        "worker pool credential is invalid for actor {}",
                        identity.actor_id
                    ),
                )
            })?;
        if principal.actor_id != identity.actor_id
            || !matches!(
                principal.role,
                boreal_domain::ActorRole::Agent | boreal_domain::ActorRole::Operator
            )
        {
            return Err(CliError::with(
                ErrorCode::PermissionDenied,
                ApplicationOutcome::Rejected,
                format!(
                    "worker pool actor {} lacks agent claim authority",
                    identity.actor_id
                ),
            ));
        }
        runtime
            .verify_bound_session(
                project,
                &identity.actor_id,
                &identity.session_id,
                &identity.harness_id,
            )
            .map_err(map_runtime_error)?;
        if runtime
            .policy(project, &identity.harness_id)
            .map_err(map_runtime_error)?
            .is_none()
        {
            return Err(CliError::with(
                ErrorCode::NotFound,
                ApplicationOutcome::Rejected,
                format!(
                    "worker pool harness {} has no active operator policy",
                    identity.harness_id
                ),
            ));
        }
    }
    Ok(())
}
pub(crate) fn configure_pool(
    parsed: &ParsedCommand,
    operation: &str,
    store: &SqliteStore,
) -> Result<CliResult, CliError> {
    if !parsed.options.setup.yes {
        return Err(CliError::invalid(
            "pool configure writes operator-authorized worker identities; inspect input and pass --yes",
        ));
    }
    let expected = parsed
        .options
        .expected_revision
        .ok_or_else(|| CliError::invalid("pool configure requires --expected-revision"))?;
    let pool_id = parsed
        .options
        .positionals
        .first()
        .map(String::as_str)
        .ok_or_else(|| CliError::invalid("pool configure requires a pool ID"))?;
    if pool_id.trim().is_empty() || pool_id.len() > 128 || pool_id.chars().any(char::is_control) {
        return Err(CliError::invalid(
            "pool ID must be 1 to 128 printable bytes",
        ));
    }
    let ctx = pool_operator(parsed, store)?;
    let input = parsed
        .options
        .input
        .as_deref()
        .ok_or_else(|| CliError::invalid("pool configure requires --input PATH"))?;
    let path = project_context::confined_path(&ctx.root, Path::new(input), false)?;
    let metadata = fs::metadata(&path).map_err(|e| CliError::invalid(e.to_string()))?;
    if metadata.len() > 32 * 1024 {
        return Err(CliError::invalid("worker pool JSON exceeds 32 KiB"));
    }
    let bytes = fs::read(&path).map_err(|e| CliError::invalid(e.to_string()))?;
    let policy: boreal_application::orchestration_runtime::WorkerPoolPolicy =
        serde_json::from_slice(&bytes)
            .map_err(|e| CliError::invalid(format!("invalid worker pool JSON: {e}")))?;
    validate_pool_members(&ctx.root, &ctx.project_id, store, &policy)?;
    let c = V3MutationContext {
        project_id: ctx.project_id.clone(),
        actor_id: parsed.options.actor.clone(),
        session_id: Some(parsed.options.session.clone()),
        operation_id: operation.into(),
        request_digest: canonical_request_digest(
            "orchestration.worker-pool.configure",
            json!({"pool_id":pool_id,"policy":policy,"input_digest":boreal_store::checksum(&bytes)}),
        ),
        expected_revision: Some(expected),
        now: stamp(now_ms_u64()),
    };
    let (digest, replayed) = OrchestrationRuntimeApplication::new(store)
        .configure_pool(&c, pool_id, &policy)
        .map_err(map_runtime_error)?;
    Ok(CliResult {
        outcome: if replayed {
            ApplicationOutcome::Unchanged
        } else {
            ApplicationOutcome::Changed
        },
        revision: Some(store_revision(
            store,
            &ProjectId::new(ctx.project_id.clone()),
        )?),
        data: Some(
            json!({"pool_id":pool_id,"state":"active","workers":policy.workers.len(),"policy_digest":digest,"replayed":replayed}),
        ),
        ..CliResult::default()
    })
}
pub(crate) fn list_pools(
    parsed: &ParsedCommand,
    store: &SqliteStore,
) -> Result<CliResult, CliError> {
    let ctx = pool_operator(parsed, store)?;
    let pools = OrchestrationRuntimeApplication::new(store)
        .worker_pools(&ctx.project_id)
        .map_err(map_runtime_error)?;
    let data=pools.iter().map(|p|->Result<Value,CliError>{let policy:boreal_application::orchestration_runtime::WorkerPoolPolicy=serde_json::from_str(&p.policy_json).map_err(|e|CliError::invalid(format!("worker pool {} is corrupt: {e}",p.pool_id)))?;Ok(json!({"pool_id":p.pool_id,"state":p.state,"policy_revision":p.policy_revision,"policy_digest":p.policy_digest,"workers":policy.workers.len()}))}).collect::<Result<Vec<_>,_>>()?;
    Ok(CliResult {
        outcome: ApplicationOutcome::Unchanged,
        revision: Some(store_revision(
            store,
            &ProjectId::new(ctx.project_id.clone()),
        )?),
        data: Some(json!({"pools":data})),
        ..CliResult::default()
    })
}
pub(crate) fn show_pool(
    parsed: &ParsedCommand,
    store: &SqliteStore,
    pool_id: &str,
) -> Result<CliResult, CliError> {
    let ctx = pool_operator(parsed, store)?;
    let before = store_revision(store, &ProjectId::new(ctx.project_id.clone()))?;
    let record = OrchestrationRuntimeApplication::new(store)
        .worker_pool_record(&ctx.project_id, pool_id)
        .map_err(map_runtime_error)?
        .ok_or_else(|| {
            CliError::with(
                ErrorCode::NotFound,
                ApplicationOutcome::Rejected,
                format!("worker pool {pool_id} was not found"),
            )
        })?;
    let policy: boreal_application::orchestration_runtime::WorkerPoolPolicy =
        serde_json::from_str(&record.policy_json).map_err(|e| CliError::invalid(e.to_string()))?;
    let after = store_revision(store, &ProjectId::new(ctx.project_id.clone()))?;
    if before != after {
        return Err(CliError::with(
            ErrorCode::StaleContext,
            ApplicationOutcome::Conflict,
            "project revision changed while reading worker pool",
        ));
    }
    Ok(CliResult {
        outcome: ApplicationOutcome::Unchanged,
        revision: Some(after),
        data: Some(
            json!({"pool_id":record.pool_id,"state":record.state,"policy_revision":record.policy_revision,"policy_digest":record.policy_digest,"project_revision":record.project_revision,"created_at":record.created_at,"updated_by":record.actor_id,"operation_id":record.operation_id,"policy":policy}),
        ),
        ..CliResult::default()
    })
}
pub(crate) fn remove_pool(
    parsed: &ParsedCommand,
    operation: &str,
    store: &SqliteStore,
    pool_id: &str,
) -> Result<CliResult, CliError> {
    if !parsed.options.setup.yes {
        return Err(CliError::invalid("pool remove requires --yes"));
    }
    let expected = parsed
        .options
        .expected_revision
        .ok_or_else(|| CliError::invalid("pool remove requires --expected-revision"))?;
    let ctx = pool_operator(parsed, store)?;
    let c = V3MutationContext {
        project_id: ctx.project_id.clone(),
        actor_id: parsed.options.actor.clone(),
        session_id: Some(parsed.options.session.clone()),
        operation_id: operation.into(),
        request_digest: canonical_request_digest(
            "orchestration.worker-pool.revoke",
            json!({"pool_id":pool_id}),
        ),
        expected_revision: Some(expected),
        now: stamp(now_ms_u64()),
    };
    let replayed = OrchestrationRuntimeApplication::new(store)
        .revoke_pool(&c, pool_id)
        .map_err(map_runtime_error)?;
    Ok(CliResult {
        outcome: if replayed {
            ApplicationOutcome::Unchanged
        } else {
            ApplicationOutcome::Changed
        },
        revision: Some(store_revision(
            store,
            &ProjectId::new(ctx.project_id.clone()),
        )?),
        data: Some(json!({"pool_id":pool_id,"state":"revoked","replayed":replayed})),
        ..CliResult::default()
    })
}
pub(crate) fn configure_harness(
    parsed: &ParsedCommand,
    operation: &str,
    store: &SqliteStore,
) -> Result<CliResult, CliError> {
    if !parsed.options.setup.yes {
        return Err(CliError::invalid(
            "harness configure writes trusted dispatch policy; review input and pass --yes",
        ));
    }
    let expected = parsed
        .options
        .expected_revision
        .ok_or_else(|| CliError::invalid("harness configure requires --expected-revision"))?;
    let ctx = project_context::resolve(parsed)?;
    let input = parsed
        .options
        .input
        .as_deref()
        .ok_or_else(|| CliError::invalid("harness configure requires --input PATH"))?;
    let path = project_context::confined_path(&ctx.root, Path::new(input), false)?;
    let metadata = fs::metadata(&path).map_err(|e| CliError::invalid(e.to_string()))?;
    if metadata.len() > 32 * 1024 {
        return Err(CliError::invalid("harness policy input exceeds 32 KiB"));
    }
    let bytes = fs::read(&path).map_err(|e| CliError::invalid(e.to_string()))?;
    let mut policy: HarnessPolicy = serde_json::from_slice(&bytes)
        .map_err(|e| CliError::invalid(format!("invalid harness policy JSON: {e}")))?;
    let workspace = ctx
        .root
        .canonicalize()
        .map_err(|e| CliError::invalid(e.to_string()))?;
    policy.cwd = if policy.cwd.is_absolute() {
        policy
            .cwd
            .canonicalize()
            .map_err(|e| CliError::invalid(e.to_string()))?
    } else {
        workspace
            .join(&policy.cwd)
            .canonicalize()
            .map_err(|e| CliError::invalid(e.to_string()))?
    };
    policy
        .validate(&workspace)
        .map_err(|e| CliError::invalid(e.to_string()))?;
    let c = V3MutationContext {
        project_id: ctx.project_id.clone(),
        actor_id: parsed.options.actor.clone(),
        session_id: Some(parsed.options.session.clone()),
        operation_id: operation.into(),
        request_digest: canonical_request_digest(
            "orchestration.harness.configure",
            json!({"policy":policy,"input_digest":boreal_store::checksum(&bytes)}),
        ),
        expected_revision: Some(expected),
        now: stamp(now_ms_u64()),
    };
    let (digest, replayed) = OrchestrationRuntimeApplication::new(store)
        .configure_policy(&c, &policy)
        .map_err(map_runtime_error)?;
    let revision = store
        .project_revision(&ctx.project_id)
        .map_err(map_store_error)?
        .0;
    Ok(CliResult {
        outcome: if replayed {
            ApplicationOutcome::Unchanged
        } else {
            ApplicationOutcome::Changed
        },
        revision: Some(revision),
        data: Some(
            json!({"configured":policy.harness_id,"policy_digest":digest,"policy_revision":OrchestrationRuntimeApplication::new(store).policy(&ctx.project_id,&policy.harness_id).map_err(map_runtime_error)?.map(|p|p.2),"shell":false,"replayed":replayed}),
        ),
        ..CliResult::default()
    })
}
pub(crate) fn list_harnesses(
    parsed: &ParsedCommand,
    store: &SqliteStore,
) -> Result<CliResult, CliError> {
    let project = parsed
        .options
        .project
        .as_deref()
        .ok_or_else(|| CliError::invalid("harness list requires --project"))?;
    let policies = OrchestrationRuntimeApplication::new(store)
        .policies(project)
        .map_err(map_runtime_error)?;
    let data=policies.iter().map(|record|->Result<Value,CliError>{let policy:HarnessPolicy=serde_json::from_str(&record.policy_json).map_err(|e|CliError::invalid(format!("stored harness policy {} is corrupt: {e}",record.harness_id)))?;Ok(json!({"harness_id":record.harness_id,"state":record.state,"policy_revision":record.policy_revision,"policy_digest":record.policy_digest,"executable":policy.executable,"cwd":policy.cwd,"argv":policy.args,"environment_names":policy.environment.iter().map(|(name,_)|name).collect::<Vec<_>>(),"timeout_ms":policy.timeout_ms,"output_cap_bytes":policy.output_cap_bytes}))}).collect::<Result<Vec<_>,_>>()?;
    Ok(CliResult {
        outcome: ApplicationOutcome::Unchanged,
        revision: Some(store_revision(store, &ProjectId::new(project))?),
        data: Some(json!({"harnesses":data})),
        ..CliResult::default()
    })
}
pub(crate) fn show_harness(
    parsed: &ParsedCommand,
    store: &SqliteStore,
    harness: &str,
) -> Result<CliResult, CliError> {
    let project = parsed
        .options
        .project
        .as_deref()
        .ok_or_else(|| CliError::invalid("harness show requires --project"))?;
    let revision_before = store_revision(store, &ProjectId::new(project))?;
    let records = OrchestrationRuntimeApplication::new(store)
        .policies(project)
        .map_err(map_runtime_error)?;
    let record = records
        .into_iter()
        .find(|record| record.harness_id == harness)
        .ok_or_else(|| {
            CliError::with(
                ErrorCode::NotFound,
                ApplicationOutcome::Rejected,
                format!("harness policy {harness} was not found"),
            )
        })?;
    let policy: HarnessPolicy = serde_json::from_str(&record.policy_json).map_err(|e| {
        CliError::invalid(format!("stored harness policy {harness} is corrupt: {e}"))
    })?;
    if policy.harness_id != record.harness_id {
        return Err(CliError::invalid(
            "stored harness policy identity does not match its registry key",
        ));
    }
    let revision_after = store_revision(store, &ProjectId::new(project))?;
    if revision_before != revision_after {
        return Err(CliError::with(
            ErrorCode::StaleContext,
            ApplicationOutcome::Conflict,
            "project revision changed while reading harness policy; retry show",
        ));
    }
    Ok(CliResult {
        outcome: ApplicationOutcome::Unchanged,
        revision: Some(revision_after),
        data: Some(
            json!({"harness_id":record.harness_id,"state":record.state,"policy_revision":record.policy_revision,"policy_digest":record.policy_digest,"project_revision":record.project_revision,"created_at":record.created_at,"updated_by":record.actor_id,"operation_id":record.operation_id,"policy":policy}),
        ),
        ..CliResult::default()
    })
}
pub(crate) fn remove_harness(
    parsed: &ParsedCommand,
    operation: &str,
    store: &SqliteStore,
) -> Result<CliResult, CliError> {
    if !parsed.options.setup.yes {
        return Err(CliError::invalid(
            "harness remove changes trusted dispatch policy; pass --yes",
        ));
    }
    let id = parsed
        .options
        .positionals
        .first()
        .or_else(|| {
            parsed
                .options
                .extra
                .get("--harness-id")
                .and_then(|v| v.last())
        })
        .ok_or_else(|| CliError::invalid("harness remove requires a harness ID"))?;
    let expected = parsed
        .options
        .expected_revision
        .ok_or_else(|| CliError::invalid("harness remove requires --expected-revision"))?;
    let project = parsed
        .options
        .project
        .clone()
        .ok_or_else(|| CliError::invalid("harness remove requires --project"))?;
    let c = V3MutationContext {
        project_id: project.clone(),
        actor_id: parsed.options.actor.clone(),
        session_id: Some(parsed.options.session.clone()),
        operation_id: operation.into(),
        request_digest: canonical_request_digest(
            "orchestration.harness.revoke",
            json!({"harness_id":id}),
        ),
        expected_revision: Some(expected),
        now: stamp(now_ms_u64()),
    };
    let replayed = OrchestrationRuntimeApplication::new(store)
        .revoke_policy(&c, id)
        .map_err(map_runtime_error)?;
    Ok(CliResult {
        outcome: if replayed {
            ApplicationOutcome::Unchanged
        } else {
            ApplicationOutcome::Changed
        },
        revision: Some(store_revision(store, &ProjectId::new(project))?),
        data: Some(json!({"revoked":id,"active":false,"replayed":replayed})),
        ..CliResult::default()
    })
}
