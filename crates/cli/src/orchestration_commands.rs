//! Durable orchestration CLI adapter. Runs coordinate canonical claim pulls;
//! process dispatch is opt-in and delegated to a separately journaled runtime;
//! orchestration itself never mutates attempt lifecycle outside the work app.

use super::*;
use boreal_application::OrchestrationApplication;

pub(crate) fn supported(path: &[String]) -> bool {
    path.first()
        .is_some_and(|p| p == "orchestration" || p == "orchestrate")
}

pub(crate) fn run(
    parsed: &ParsedCommand,
    operation: &str,
    store: &SqliteStore,
) -> Result<CliResult, CliError> {
    let app = OrchestrationApplication::new(store).map_err(map_orchestration_error)?;
    let path = parsed
        .path
        .iter()
        .skip(1)
        .map(String::as_str)
        .collect::<Vec<_>>();
    let get = |key: &str| {
        parsed
            .options
            .extra
            .get(&format!("--{key}"))
            .and_then(|v| v.last())
            .map(String::as_str)
    };
    let run_id = get("run").or_else(|| parsed.options.positionals.first().map(String::as_str));
    let project = parsed
        .options
        .project
        .as_deref()
        .ok_or_else(|| CliError::invalid("orchestration commands require --project"))?;
    let data = match path.as_slice() {
        ["pool", "configure"] => {
            return super::orchestration_runtime::configure_pool(parsed, operation, store);
        }
        ["pool", "list"] => return super::orchestration_runtime::list_pools(parsed, store),
        ["pool", "show"] => {
            let id = parsed
                .options
                .positionals
                .first()
                .map(String::as_str)
                .ok_or_else(|| CliError::invalid("orchestrate pool show requires a pool ID"))?;
            return super::orchestration_runtime::show_pool(parsed, store, id);
        }
        ["pool", "remove"] => {
            let id = parsed
                .options
                .positionals
                .first()
                .map(String::as_str)
                .ok_or_else(|| CliError::invalid("orchestrate pool remove requires a pool ID"))?;
            return super::orchestration_runtime::remove_pool(parsed, operation, store, id);
        }
        ["start"] => {
            let name = get("name")
                .or(parsed.options.title.as_deref())
                .unwrap_or("agent run");
            let max_claims = get("max-claims")
                .map(|n| {
                    n.parse::<u64>().map_err(|_| {
                        CliError::invalid("--max-claims must be an integer from 1 to 500")
                    })
                })
                .transpose()?
                .unwrap_or(1);
            if !(1..=500).contains(&max_claims) {
                return Err(CliError::invalid("--max-claims must be from 1 to 500"));
            }
            let selector = json!({"work":parsed.options.work,"source_version":parsed.options.source_version,"config_identity":parsed.options.config_identity,"actor":parsed.options.actor,"session":parsed.options.session,"harness":parsed.options.harness,"max_claims":max_claims});
            let c = context(parsed, operation, "orchestration.start", selector.clone())?;
            let run = app
                .start(&c, name, selector)
                .map_err(map_orchestration_error)?;
            json!({"command":"orchestration start","run":run_json(&run)})
        }
        ["list"] => {
            json!({"runs":app.list(project,parsed.options.limit.unwrap_or(100)).map_err(map_orchestration_error)?.iter().map(run_json).collect::<Vec<_>>()})
        }
        ["show"] => {
            let id =
                run_id.ok_or_else(|| CliError::invalid("orchestration show requires a run ID"))?;
            let run = app.show(project, id).map_err(map_orchestration_error)?;
            json!({"run":run_json(&run),"events":app.events(project,id,parsed.options.limit.unwrap_or(100)).map_err(map_orchestration_error)?})
        }
        ["events"] => {
            let id = run_id
                .ok_or_else(|| CliError::invalid("orchestration events requires a run ID"))?;
            json!({"run_id":id,"events":app.events(project,id,parsed.options.limit.unwrap_or(100)).map_err(map_orchestration_error)?})
        }
        ["progress"] => {
            let id = run_id
                .ok_or_else(|| CliError::invalid("orchestration progress requires a run ID"))?;
            let run = app.show(project, id).map_err(map_orchestration_error)?;
            let project = ProjectId::new(run.project_id.clone());
            let snapshot = boreal_application::project_status_from_store_for_session(
                store,
                &project,
                &boreal_domain::ActorContext {
                    actor_id: ActorId::new(parsed.options.actor.clone()),
                    role: boreal_domain::ActorRole::Agent,
                },
                Some(&parsed.options.session),
                TimestampMs::from_millis(now_ms_u64()),
                parsed.options.limit.unwrap_or(100).clamp(1, 500),
                parsed.options.offset.unwrap_or(0),
            )
            .map_err(|e| {
                CliError::with(ErrorCode::ServiceUnavailable, ApplicationOutcome::Failed, e)
            })?;
            let attempts=snapshot.items.iter().filter_map(|item|item.attempt.as_ref().map(|a|json!({"work_id":a.work_id.as_str(),"attempt_id":a.attempt_id.as_str(),"actor_id":a.actor_id.as_str(),"session_id":a.session_id.as_ref().map(|s|s.as_str()),"phase":format!("{:?}",a.phase).to_ascii_lowercase(),"fence":a.fence.get(),"claimed_at":stamp(a.claimed_at.as_millis()),"accepted_at":a.accepted_at.map(|at|stamp(at.as_millis())),"lease_deadline":stamp(a.lease_deadline.as_millis()),"hard_deadline":stamp(a.max_attempt_deadline.as_millis()),"last_heartbeat_at":a.last_heartbeat_at.map(|at|stamp(at.as_millis())),"last_checkpoint_at":a.last_checkpoint_at.map(|at|stamp(at.as_millis()))}))).collect::<Vec<_>>();
            let work=snapshot.items.iter().map(|item|json!({"work_id":item.work.id.as_str(),"title":item.work.title,"status":format!("{:?}",item.status3_display_status()).to_ascii_lowercase(),"reasons":item.decision.reason_codes.iter().map(|r|r.stable_code()).collect::<Vec<_>>(),"claimable":item.claimable_for_actor(),"attempt_id":item.current_attempt().map(|a|a.attempt_id.as_str())})).collect::<Vec<_>>();
            json!({"run":run_json(&run),"project_revision":snapshot.project_revision.0,"as_of":stamp(snapshot.as_of.as_millis()),"total_work":snapshot.total,"counts":{"ready":snapshot.counts.ready,"claimed":snapshot.counts.claimed,"in_progress":snapshot.counts.in_progress,"blocked":snapshot.counts.blocked,"awaiting_review":snapshot.counts.awaiting_review,"complete":snapshot.counts.complete,"closed":snapshot.counts.closed},"active_attempts":attempts,"work":work,"claim_count":run.claim_count,"max_claims":run.max_claims,"scope":"project-wide","scope_root":null,"offset":snapshot.offset,"returned":snapshot.items.len(),"next_offset":snapshot.next_offset(),"has_more":snapshot.next_offset().is_some(),"claim_owner":"project lifecycle"})
        }
        ["daemon", "status"] => {
            let runtime =
                boreal_application::orchestration_runtime::OrchestrationRuntimeApplication::new(
                    store,
                );
            let worker = runtime
                .worker(project)
                .map_err(super::orchestration_runtime::map_runtime_error)?;
            let active = worker.as_ref().is_some_and(|w| {
                w.state == "running"
                    && parse_stamp_ms(&w.lease_until)
                        .is_some_and(|deadline| deadline > now_ms_u64())
            });
            json!({"project_id":project,"revision":store.project_revision(project).map_err(map_store_error)?.0,"runs":app.list(project,100).map_err(map_orchestration_error)?.iter().map(run_json).collect::<Vec<_>>(),"worker":worker.as_ref().map(|w|json!({"project_id":w.project_id,"owner_id":w.owner_id,"state":w.state,"lease_until":w.lease_until,"heartbeat_at":w.heartbeat_at,"max_workers":w.max_workers,"max_requests":w.max_requests,"requests_completed":w.requests_completed,"revision":w.revision})),"jobs":runtime.jobs(project,100).map_err(super::orchestration_runtime::map_runtime_error)?.iter().map(|j|json!({"job_id":j.job_id,"run_id":j.run_id,"tick_id":j.tick_id,"work_id":j.work_id,"attempt_id":j.attempt_id,"fence":j.fence,"actor_id":j.actor_id,"session_id":j.session_id,"harness_id":j.harness_id,"state":j.state,"pid":j.pid,"started_at":j.started_at,"deadline":j.deadline,"ended_at":j.ended_at,"exit_code":j.exit_code,"result_digest":j.result_digest,"error_message":j.error_message,"revision":j.revision})).collect::<Vec<_>>(),"dispatch":"operator-configured local argv; no shell","scheduler":"opt-in bounded local worker","timer_scheduling":false,"daemon_running":active})
        }
        ["daemon", "run"] => {
            return super::orchestration_runtime::daemon_run(parsed, operation, store);
        }
        ["harness", "configure"] => {
            return super::orchestration_runtime::configure_harness(parsed, operation, store);
        }
        ["harness", "list"] => return super::orchestration_runtime::list_harnesses(parsed, store),
        ["harness", "show"] => {
            let harness = parsed
                .options
                .positionals
                .first()
                .map(String::as_str)
                .or_else(|| get("harness-id"))
                .ok_or_else(|| {
                    CliError::invalid("orchestration harness show requires a harness ID")
                })?;
            return super::orchestration_runtime::show_harness(parsed, store, harness);
        }
        ["harness", "remove"] => {
            return super::orchestration_runtime::remove_harness(parsed, operation, store);
        }
        ["nudge"] => {
            let id =
                run_id.ok_or_else(|| CliError::invalid("orchestration nudge requires a run ID"))?;
            let run = app.show(project, id).map_err(map_orchestration_error)?;
            let c = context(
                parsed,
                operation,
                "orchestration.nudge",
                json!({"run_id":id,"reason":get("reason")}),
            )?;
            store
                .orchestration_record_event(
                    &c,
                    id,
                    "run.nudged",
                    &json!({"reason":parsed.options.reason.as_deref().or_else(||get("reason")).unwrap_or("operator requested a pull cycle")})
                        .to_string(),
                )
                .map_err(map_store_error)?;
            json!({"run_id":id,"state":run.state,"action":"harness_pull_requested","agent_launched":false})
        }
        ["tick"] => tick(
            parsed,
            operation,
            &app,
            store,
            run_id.ok_or_else(|| CliError::invalid("orchestration tick requires a run ID"))?,
        )?,
        ["pause"] | ["resume"] | ["cancel"] | ["fail"] | ["complete"] => {
            let id = run_id
                .ok_or_else(|| CliError::invalid("orchestration transition requires a run ID"))?;
            let current = app.show(project, id).map_err(map_orchestration_error)?;
            let state = path[0];
            let error = if state == "fail" {
                Some(
                    parsed
                        .options
                        .reason
                        .as_deref()
                        .or_else(|| get("reason"))
                        .unwrap_or("operator marked run failed"),
                )
            } else {
                None
            };
            let next = match state {
                "fail" => "failed",
                "resume" => "running",
                "complete" => "completed",
                other => other,
            };
            let c = context(
                parsed,
                operation,
                &format!("orchestration.{next}"),
                json!({"run_id":id,"expected_run_revision":current.revision,"state":next,"error":error}),
            )?;
            let run = app
                .transition(&c, id, current.revision, next, error)
                .map_err(map_orchestration_error)?;
            json!({"run":run_json(&run),"lifecycle_note":if state=="cancel"{"Run intent is cancelled; any current attempt still follows the canonical project release/cancel path."}else{"Orchestration state only; canonical work status and attempt ownership are unchanged."}})
        }
        _ => {
            return Err(CliError::with(
                ErrorCode::NotFound,
                ApplicationOutcome::Rejected,
                format!("unknown orchestration command: {}", path.join(" ")),
            ));
        }
    };
    let revision = Some(store.project_revision(project).map_err(map_store_error)?.0);
    let read_only = matches!(
        path.as_slice(),
        ["list"] | ["show"] | ["events"] | ["progress"] | ["daemon", "status"]
    );
    let idle = data.pointer("/tick/outcome").and_then(Value::as_str) == Some("idle");
    Ok(CliResult {
        outcome: if read_only || idle {
            ApplicationOutcome::Unchanged
        } else {
            ApplicationOutcome::Changed
        },
        revision,
        data: Some(json!({"operation_id":operation,"result":data})),
        human: None,
        ..CliResult::default()
    })
}

fn tick(
    parsed: &ParsedCommand,
    operation: &str,
    app: &OrchestrationApplication<'_>,
    store: &SqliteStore,
    id: &str,
) -> Result<Value, CliError> {
    let project = parsed
        .options
        .project
        .as_deref()
        .ok_or_else(|| CliError::invalid("orchestration tick requires --project"))?;
    let run = app.show(project, id).map_err(map_orchestration_error)?;
    if let Some(record) = app
        .tick_record(project, id, operation)
        .map_err(map_orchestration_error)?
    {
        if record.state == "claimed" {
            return Ok(
                json!({"run_id":id,"outcome":"claimed","tick_id":operation,"claim":record.result_json.and_then(|s|serde_json::from_str::<Value>(&s).ok()),"replayed":true,"agent_launched":false}),
            );
        }
        if record.state == "rejected" {
            return Err(CliError::with(
                ErrorCode::ClaimConflict,
                ApplicationOutcome::Conflict,
                record
                    .result_json
                    .unwrap_or_else(|| "canonical claim was rejected".into()),
            ));
        }
    }
    let mut selector: Value =
        serde_json::from_str(&run.selector_json).map_err(|e| CliError::invalid(e.to_string()))?;
    if run.claim_count >= run.max_claims {
        return Ok(
            json!({"run_id":id,"outcome":"max_claims","claim_count":run.claim_count,"max_claims":run.max_claims}),
        );
    }
    for (field, actual) in [
        ("actor", parsed.options.actor.as_str()),
        ("session", parsed.options.session.as_str()),
        ("harness", parsed.options.harness.as_str()),
    ] {
        if selector[field].as_str() != Some(actual) {
            return Err(CliError::with(
                ErrorCode::PermissionDenied,
                ApplicationOutcome::Rejected,
                format!("tick caller {field} does not match the run's bound identity"),
            ));
        }
    }
    for (field, provided) in [
        ("source_version", parsed.options.source_version.as_deref()),
        ("config_identity", parsed.options.config_identity.as_deref()),
    ] {
        if provided.is_some_and(|value| selector[field].as_str() != Some(value)) {
            return Err(CliError::with(
                ErrorCode::StaleContext,
                ApplicationOutcome::Rejected,
                format!("tick {field} differs from the run's pinned context"),
            ));
        }
    }
    let dispatch_now = parsed.options.extra.contains_key("--dispatch-now");
    // Validate policy, executable, working directory, and bound session before
    // selecting or claiming work, so configuration errors cannot strand claims.
    let dispatch_policy = if dispatch_now {
        if parsed.options.extra.contains_key("--worker-owner") {
            let pool_id = parsed
                .options
                .extra
                .get("--pool")
                .and_then(|v| v.last())
                .ok_or_else(|| CliError::invalid("managed worker tick requires --pool"))?;
            let expected_digest = parsed
                .options
                .extra
                .get("--pool-digest")
                .and_then(|v| v.last())
                .ok_or_else(|| CliError::invalid("managed worker tick requires its pool digest"))?;
            let (pool, digest, _) =
                boreal_application::orchestration_runtime::OrchestrationRuntimeApplication::new(
                    store,
                )
                .worker_pool(project, pool_id)
                .map_err(super::orchestration_runtime::map_runtime_error)?
                .ok_or_else(|| {
                    CliError::with(
                        ErrorCode::StaleContext,
                        ApplicationOutcome::Rejected,
                        "worker pool was revoked before claim",
                    )
                })?;
            if &digest != expected_digest
                || !pool.workers.iter().any(|w| {
                    w.actor_id == parsed.options.actor
                        && w.session_id == parsed.options.session
                        && w.harness_id == parsed.options.harness
                })
            {
                return Err(CliError::with(
                    ErrorCode::StaleContext,
                    ApplicationOutcome::Rejected,
                    "worker pool policy no longer authorizes this identity",
                ));
            }
        }
        Some(super::orchestration_runtime::preflight_policy(
            parsed, store,
        )?)
    } else {
        None
    };
    let tick_context = context(
        parsed,
        operation,
        "orchestration.tick",
        json!({"run_id":id,"expected_run_revision":run.revision}),
    )?;
    let claim_guard = super::orchestration_runtime::runtime_mutation_guard();
    let pinned = app
        .pending_work(project, id)
        .map_err(map_orchestration_error)?;
    let requested = parsed.options.work.clone();
    if pinned
        .as_deref()
        .is_some_and(|work| requested.as_deref().is_some_and(|asked| asked != work))
    {
        return Err(CliError::with(
            ErrorCode::StaleContext,
            ApplicationOutcome::Rejected,
            "this orchestration tick already pinned a different work item; replay its original operation",
        ));
    }
    let (work, tick_run_revision) = if let Some(work) = pinned {
        (work, run.revision)
    } else {
        let work = requested
            .or_else(|| selector["work"].as_str().map(str::to_owned))
            .or_else(|| None);
        let work = match work {
            Some(work) => Some(work),
            None => {
                let project_id = ProjectId::new(project);
                let candidates = WorkApplication::new(store)
                    .claimable_work_candidates(&project_id, &stamp(now_ms_u64()), 50, None)
                    .map_err(map_application_error)?;
                candidates.into_iter().next()
            }
        };
        let Some(work) = work else {
            return Ok(
                json!({"run_id":id,"outcome":"idle","message":"no claimable work","agent_launched":false}),
            );
        };
        let mut select_context = tick_context.clone();
        select_context.operation_id = format!("{operation}:select");
        select_context.request_digest = canonical_request_digest(
            "orchestration.tick.select",
            json!({"base":tick_context.request_digest,"run_id":id,"work_id":work}),
        );
        let selected = app
            .select_work(&select_context, id, run.revision, &work)
            .map_err(map_orchestration_error)?;
        selector = serde_json::from_str(&selected.selector_json)
            .map_err(|e| CliError::invalid(e.to_string()))?;
        (work, selected.revision)
    };
    selector["pending_work"] = json!(work);
    let mut captured = None;
    let app_work = WorkApplication::new(store);
    let adapter = SqliteAttemptAdapter::new(store);
    let project_id = ProjectId::new(project);
    let project_snapshot = app_work
        .list_work(&project_id, 1, 0)
        .map_err(map_application_error)?;
    let mut claim_context = tick_context.clone();
    claim_context.expected_revision = Some(project_snapshot.revision.0);
    let result = app.tick(&claim_context, id, tick_run_revision, operation, &work, |project_id, work, selector| {
            let mut claim = parsed.clone();
            claim.path = vec!["work".into(), "claim".into()];
            claim.options.project = Some(project_id.into());
            claim.options.work = Some(work.to_owned());
            claim.options.source_version = selector["source_version"].as_str().map(str::to_owned);
            claim.options.config_identity = selector["config_identity"].as_str().map(str::to_owned);
            let snapshot=app_work.list_work(&ProjectId::new(project_id),1,0).map_err(|e|boreal_application::TickClaimError::Rejected(e.to_string()))?;
            claim.options.expected_revision=Some(snapshot.revision.0);
            if claim.options.source_version.is_none() || claim.options.config_identity.is_none() {
                return Err(boreal_application::TickClaimError::Rejected("orchestration tick requires a bound --source-version and --config-identity".into()));
            }
            let value = claim_result(
                &claim,
                &app_work,
                &adapter,
                &format!("{operation}:claim"),
                store,
            )
            .map_err(|e|if e.outcome==ApplicationOutcome::Unknown{boreal_application::TickClaimError::Unknown(e.message)}else{boreal_application::TickClaimError::Rejected(e.message)})?;
            let result = value.data.unwrap_or(Value::Null);
            captured = Some(result.clone());
            Ok(result)
        }).map_err(|error|match error { boreal_application::OrchestrationError::ClaimUnknown(message)=>CliError::unknown_delivery(operation,message),other=>map_orchestration_error(other) })?;
    drop(claim_guard);
    let dispatched = if dispatch_now {
        if let Some(claim) = captured.as_ref() {
            let (policy, digest, _policy_revision) =
                dispatch_policy.expect("preflight policy exists");
            Some(super::orchestration_runtime::dispatch_claim(
                parsed, operation, store, id, &work, claim, policy, &digest,
            )?)
        } else {
            None
        }
    } else {
        None
    };
    Ok(
        json!({"run_id":id,"tick":result,"claim":captured,"dispatch":dispatched,"agent_launched":dispatch_now&&dispatched.is_some(),"next":"harness accepts and executes the canonical attempt"}),
    )
}

pub(crate) fn map_orchestration_error(error: boreal_application::OrchestrationError) -> CliError {
    match error {
        boreal_application::OrchestrationError::Store(error) => {
            let (code, outcome) = match &error {
                StoreError::Conflict(_) | StoreError::StaleRevision { .. } => {
                    (ErrorCode::RevisionConflict, ApplicationOutcome::Conflict)
                }
                StoreError::NotFound { .. } => (ErrorCode::NotFound, ApplicationOutcome::Rejected),
                StoreError::Unavailable(_) => {
                    (ErrorCode::ServiceUnavailable, ApplicationOutcome::Failed)
                }
                StoreError::Busy(_) => (ErrorCode::ServiceBusy, ApplicationOutcome::Busy),
                _ => (ErrorCode::InvalidArgument, ApplicationOutcome::Rejected),
            };
            CliError::with(code, outcome, error.to_string())
        }
        boreal_application::OrchestrationError::Claim(message) => CliError::with(
            ErrorCode::ClaimConflict,
            ApplicationOutcome::Conflict,
            message,
        ),
        boreal_application::OrchestrationError::ClaimUnknown(message) => CliError::with(
            ErrorCode::UnknownOutcome,
            ApplicationOutcome::Unknown,
            message,
        ),
        boreal_application::OrchestrationError::Invalid(message) => CliError::invalid(message),
    }
}
fn run_json(run: &boreal_store::OrchestrationRun) -> Value {
    json!({"run_id":run.run_id,"project_id":run.project_id,"name":run.name,"state":run.state,"selector_json":run.selector_json,"run_revision":run.revision,"claim_count":run.claim_count,"max_claims":run.max_claims,"last_error":run.last_error})
}
fn context(
    parsed: &ParsedCommand,
    operation: &str,
    command: &str,
    payload: Value,
) -> Result<boreal_store::V3MutationContext, CliError> {
    let project = parsed
        .options
        .project
        .clone()
        .ok_or_else(|| CliError::invalid(format!("{command} requires --project")))?;
    let expected_revision = parsed
        .options
        .expected_revision
        .ok_or_else(|| CliError::invalid(format!("{command} requires --expected-revision")))?;
    let payload = json!({"command":command,"operation":operation,"payload":payload,"actor":parsed.options.actor,"session":parsed.options.session});
    Ok(boreal_store::V3MutationContext {
        project_id: project,
        actor_id: parsed.options.actor.clone(),
        session_id: Some(parsed.options.session.clone()),
        operation_id: operation.into(),
        request_digest: canonical_request_digest(command, payload),
        expected_revision: Some(expected_revision),
        now: stamp(now_ms_u64()),
    })
}
