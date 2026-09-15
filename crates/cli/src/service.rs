//! CLI-owned service process and Unix-socket client adapter.
//!
//! The service crate deliberately stays independent of SQLite and the
//! application crate. This module is the composition point for the CLI: the
//! long-lived process owns a store-backed application handler, while client
//! commands retain the same versioned protocol envelope as direct commands.

use super::*;

pub(crate) fn supports(parsed: &ParsedCommand) -> bool {
    let path = &parsed.path;
    matches!(
        path.iter()
            .map(String::as_str)
            .collect::<Vec<_>>()
            .as_slice(),
        ["status"]
            | ["work", "claim"]
            | ["agent", "start"]
            | ["agent", "release"]
            | ["evidence", "run"]
    ) || (path == &["agent".to_owned(), "finish".to_owned()]
        && (parsed.options.release || (parsed.options.close && parsed.options.receipt.is_some())))
        || (path == &["evidence".to_owned(), "add".to_owned()] && parsed.options.receipt.is_some())
}

#[cfg(not(unix))]
pub(crate) fn run_service(
    _parsed: &ParsedCommand,
    _operation: &str,
) -> Result<CliResult, CliError> {
    Err(CliError::with(
        ErrorCode::UnsupportedPlatform,
        ApplicationOutcome::Failed,
        "the local service requires Unix-domain sockets",
    ))
}

#[cfg(not(unix))]
pub(crate) fn request(_parsed: &ParsedCommand, _operation: &str) -> Result<CliResult, CliError> {
    Err(CliError::with(
        ErrorCode::UnsupportedPlatform,
        ApplicationOutcome::Failed,
        "the local service requires Unix-domain sockets",
    ))
}

#[cfg(unix)]
mod unix {
    use super::*;
    use boreal_application::{project_status_from_store, AttemptLifecycleAdapter, AttemptSnapshot};
    use boreal_domain::{ActorContext, ActorRole};
    use boreal_protocol::{schema, Envelope, ProtocolError as WireError, TransportOutcome};
    use boreal_service::{
        ApplicationCommandHandler, ApplicationRequest, ApplicationResponse, JsonRequest,
        ServiceHost, ServiceHostConfig, TransportConfig, UnixSocketClient, APPLICATION_API_VERSION,
        APPLICATION_SCHEMA_VERSION,
    };

    const SERVICE_REQUEST_ID: &str = "cli-service-request";

    pub(crate) fn run_service(
        parsed: &ParsedCommand,
        _operation: &str,
    ) -> Result<CliResult, CliError> {
        let socket = parsed
            .options
            .socket
            .as_deref()
            .ok_or_else(|| CliError::invalid("service run requires --socket PATH"))?;
        let db = PathBuf::from(&parsed.options.db);
        ensure_db_parent(&db)?;
        let store = SqliteStore::open(&db, SCHEMA).map_err(map_store_error)?;
        let config = ServiceHostConfig::default()
            .with_max_requests(parsed.options.max_requests)
            .map_err(|error| {
                CliError::with(
                    ErrorCode::InvalidArgument,
                    ApplicationOutcome::Rejected,
                    error.to_string(),
                )
            })?;
        let gate_root = db
            .parent()
            .unwrap_or(std::path::Path::new("."))
            .join(super::GATE_COMMANDS_DIR);
        let host = ServiceHost::bind(socket, ServiceCommandHandler { store, gate_root }, config)
            .map_err(|error| {
                CliError::with(
                    ErrorCode::ServiceUnavailable,
                    ApplicationOutcome::Failed,
                    error.to_string(),
                )
            })?;
        let endpoint = host.socket_path().to_string_lossy().into_owned();
        let handle = host.start().map_err(|error| {
            CliError::with(
                ErrorCode::ServiceUnavailable,
                ApplicationOutcome::Failed,
                error.to_string(),
            )
        })?;
        let report = handle.join().map_err(|error| {
            CliError::with(
                ErrorCode::ServiceUnavailable,
                ApplicationOutcome::Failed,
                error.to_string(),
            )
        })?;
        Ok(CliResult {
            outcome: ApplicationOutcome::Unchanged,
            revision: None,
            data: Some(json!({
                "service": "stopped",
                "socket": endpoint,
                "served_requests": report.served_requests(),
                "recoverable_errors": report.recoverable_errors(),
                "recovered_operations": report.recovery().queued.len()
                    + report.recovery().unknown.len(),
            })),
        })
    }

    pub(crate) fn request(parsed: &ParsedCommand, operation: &str) -> Result<CliResult, CliError> {
        let socket = parsed
            .options
            .socket
            .as_deref()
            .ok_or_else(|| CliError::invalid("service routing requires --socket PATH"))?;
        let data = request_data(parsed, operation)?;
        let payload = json!({
            "api_version": APPLICATION_API_VERSION,
            "schema_version": APPLICATION_SCHEMA_VERSION,
            "operation_id": operation,
            "data": data,
        });
        let request =
            JsonRequest::new(SERVICE_REQUEST_ID, payload.to_string()).map_err(|error| {
                CliError::with(
                    ErrorCode::ProtocolMismatch,
                    ApplicationOutcome::Failed,
                    error.to_string(),
                )
            })?;
        let mut client =
            UnixSocketClient::connect(socket, TransportConfig::default()).map_err(|error| {
                CliError::with(
                    ErrorCode::ServiceUnavailable,
                    ApplicationOutcome::Failed,
                    error.to_string(),
                )
            })?;
        let response = client.request(request).map_err(|error| {
            CliError::with(
                ErrorCode::ServiceUnavailable,
                ApplicationOutcome::Failed,
                error.to_string(),
            )
        })?;
        let payload = response.payload().ok_or_else(|| {
            CliError::with(
                ErrorCode::ProtocolMismatch,
                ApplicationOutcome::Failed,
                "service response did not contain a payload",
            )
        })?;
        let outer: Value = serde_json::from_str(payload).map_err(|error| {
            CliError::with(
                ErrorCode::ProtocolMismatch,
                ApplicationOutcome::Failed,
                format!("invalid service response: {error}"),
            )
        })?;
        if outer.get("api_version").and_then(Value::as_str) != Some(APPLICATION_API_VERSION)
            || outer.get("schema_version").and_then(Value::as_str)
                != Some(APPLICATION_SCHEMA_VERSION)
        {
            return Err(CliError::with(
                ErrorCode::ProtocolMismatch,
                ApplicationOutcome::Failed,
                "service response version does not match the CLI",
            ));
        }
        let envelope: Envelope<Value> =
            serde_json::from_value(outer.get("data").cloned().ok_or_else(|| {
                CliError::with(
                    ErrorCode::ProtocolMismatch,
                    ApplicationOutcome::Failed,
                    "service response omitted its application envelope",
                )
            })?)
            .map_err(|error| {
                CliError::with(
                    ErrorCode::ProtocolMismatch,
                    ApplicationOutcome::Failed,
                    format!("invalid application envelope from service: {error}"),
                )
            })?;
        envelope.validate().map_err(|error| {
            CliError::with(
                ErrorCode::ProtocolMismatch,
                ApplicationOutcome::Failed,
                error.to_string(),
            )
        })?;
        if let Some(error) = envelope.error {
            return Err(CliError::with(error.code, envelope.outcome, error.message));
        }
        Ok(CliResult {
            outcome: envelope.outcome,
            revision: envelope.revision,
            data: envelope.data,
        })
    }

    pub(super) fn request_data(parsed: &ParsedCommand, operation: &str) -> Result<Value, CliError> {
        let path = parsed.path.iter().map(String::as_str).collect::<Vec<_>>();
        let project = project_argument(parsed, 0)?;
        let mut data = json!({
            "project_id": project,
            "actor_id": parsed.options.actor,
            "harness_id": parsed.options.harness,
            "session_id": parsed.options.session,
        });
        match path.as_slice() {
            ["status"] => {
                data["command"] = json!("status");
                data["limit"] = json!(parsed.options.limit.unwrap_or(100));
                data["offset"] = json!(parsed.options.offset.unwrap_or(0));
            }
            ["work", "claim"] => {
                data["command"] = json!("claim");
                data["work_id"] = json!(work_argument(parsed, 1)?);
                let at = now_ms_u64();
                let deadlines = AttemptPolicy::default()
                    .deadlines(
                        TimestampMs::from_millis(at),
                        parsed.options.lease_ttl_ms,
                        parsed.options.time_limit_ms,
                    )
                    .map_err(|error| CliError::invalid(error.to_string()))?;
                data["attempt_id"] = json!(parsed
                    .options
                    .attempt
                    .clone()
                    .unwrap_or_else(|| attempt_id_for(operation)));
                data["claimed_at"] = json!(stamp(at));
                data["lease_deadline"] = json!(stamp(deadlines.lease_deadline.as_millis()));
                data["hard_deadline"] = json!(stamp(deadlines.hard_deadline.as_millis()));
                data["expected_revision"] = parsed
                    .options
                    .expected_revision
                    .map_or(Value::Null, |value| json!(value));
            }
            ["agent", "start"] => {
                data["command"] = json!("start");
                data["work_id"] = json!(work_argument(parsed, 0)?);
                let at = now_ms_u64();
                let deadlines = AttemptPolicy::default()
                    .deadlines(
                        TimestampMs::from_millis(at),
                        parsed.options.lease_ttl_ms,
                        parsed.options.time_limit_ms,
                    )
                    .map_err(|error| CliError::invalid(error.to_string()))?;
                data["attempt_id"] = json!(parsed
                    .options
                    .attempt
                    .clone()
                    .unwrap_or_else(|| attempt_id_for(operation)));
                data["claimed_at"] = json!(stamp(at));
                data["lease_deadline"] = json!(stamp(deadlines.lease_deadline.as_millis()));
                data["hard_deadline"] = json!(stamp(deadlines.hard_deadline.as_millis()));
                data["expected_revision"] = parsed
                    .options
                    .expected_revision
                    .map_or(Value::Null, |value| json!(value));
            }
            ["agent", "release"] | ["agent", "finish"]
                if path[1] == "release" || parsed.options.release =>
            {
                data["command"] = json!("release");
                data["work_id"] = json!(work_argument(parsed, 0)?);
                data["attempt_id"] = json!(parsed
                    .options
                    .attempt
                    .clone()
                    .ok_or_else(|| CliError::invalid("fenced mutation requires --attempt"))?);
                data["fence"] = json!(parsed
                    .options
                    .fence
                    .ok_or_else(|| CliError::invalid("fenced mutation requires --fence"))?);
                data["reason"] = parsed
                    .options
                    .reason
                    .clone()
                    .map_or(Value::Null, Value::String);
            }
            ["agent", "finish"] if parsed.options.close => {
                data["command"] = json!("finish_close");
                data["work_id"] = json!(work_argument(parsed, 0)?);
                data["attempt_id"] = json!(parsed
                    .options
                    .attempt
                    .clone()
                    .ok_or_else(|| CliError::invalid("agent finish --close requires --attempt"))?);
                data["fence"] = json!(parsed
                    .options
                    .fence
                    .ok_or_else(|| CliError::invalid("agent finish --close requires --fence"))?);
                data["expected_revision"] = parsed
                    .options
                    .expected_revision
                    .map_or(Value::Null, |value| json!(value));
                data["receipt"] = receipt_dto_value(parsed)?;
            }
            ["evidence", "add"] if parsed.options.receipt.is_some() => {
                data["command"] = json!("evidence_add");
                data["expected_revision"] = parsed
                    .options
                    .expected_revision
                    .map_or(Value::Null, |value| json!(value));
                data["receipt"] = receipt_dto_value(parsed)?;
            }
            ["evidence", "run"] => {
                data["command"] = json!("evidence_run");
                data["work_id"] = json!(work_argument(parsed, 0)?);
                data["gate_id"] = json!(parsed
                    .options
                    .gate
                    .clone()
                    .ok_or_else(|| CliError::invalid("evidence run requires --gate"))?);
                data["attempt_id"] = parsed
                    .options
                    .attempt
                    .clone()
                    .map_or(Value::Null, Value::String);
                data["fence"] = parsed
                    .options
                    .fence
                    .map_or(Value::Null, |value| json!(value));
                data["expected_revision"] = parsed
                    .options
                    .expected_revision
                    .map_or(Value::Null, |value| json!(value));
            }
            _ => {
                return Err(CliError::invalid(
                    "this command is not available through the local service",
                ))
            }
        }
        data["operation_id"] = json!(operation);
        Ok(data)
    }

    pub(super) struct ServiceCommandHandler {
        pub(super) store: SqliteStore,
        pub(super) gate_root: PathBuf,
    }

    impl ApplicationCommandHandler for ServiceCommandHandler {
        fn handle(
            &mut self,
            request: ApplicationRequest,
        ) -> Result<ApplicationResponse, boreal_service::ProtocolError> {
            let data: Value = serde_json::from_str(&request.data).map_err(|error| {
                boreal_service::ProtocolError::new(
                    boreal_service::ProtocolErrorCode::InvalidPayload,
                    error.to_string(),
                )
            })?;
            let result = self.dispatch(&request, &data);
            let envelope = match result {
                Ok((outcome, revision, value)) => {
                    make_envelope(&request.operation_id, outcome, revision, value, None)
                }
                Err(error) => make_envelope(
                    &request.operation_id,
                    error.outcome,
                    None,
                    None,
                    Some(WireError::new(
                        error.code,
                        error.message,
                        is_retryable(error.code),
                    )),
                ),
            };
            Ok(ApplicationResponse {
                api_version: APPLICATION_API_VERSION.to_owned(),
                schema_version: APPLICATION_SCHEMA_VERSION.to_owned(),
                operation_id: request.operation_id,
                data: serde_json::to_string(&envelope).map_err(|error| {
                    boreal_service::ProtocolError::new(
                        boreal_service::ProtocolErrorCode::InvalidPayload,
                        error.to_string(),
                    )
                })?,
            })
        }
    }

    type ServiceResult = Result<(ApplicationOutcome, Option<u64>, Option<Value>), CliError>;

    impl ServiceCommandHandler {
        fn dispatch(&mut self, request: &ApplicationRequest, data: &Value) -> ServiceResult {
            match request.command.as_str() {
                "status" => self.status(data),
                "claim" => self.claim(data, &request.operation_id),
                "start" => self.start(data, &request.operation_id),
                "release" => self.release(data, &request.operation_id),
                "finish_close" => self.finish_close(data, &request.operation_id),
                "evidence_add" => self.evidence_add(data),
                "evidence_run" => self.evidence_run(data, &request.operation_id),
                command => Err(CliError::with(
                    ErrorCode::UnknownCommandNamespace,
                    ApplicationOutcome::Rejected,
                    format!("service does not implement command {command:?}"),
                )),
            }
        }

        fn status(&self, data: &Value) -> ServiceResult {
            let project = ProjectId::new(string(data, "project_id")?);
            let actor = ActorContext {
                actor_id: ActorId::new(string(data, "actor_id")?),
                role: ActorRole::Agent,
            };
            let limit = optional_u64(data, "limit")?.unwrap_or(100);
            let offset = optional_u64(data, "offset")?.unwrap_or(0);
            let snapshot = project_status_from_store(
                &self.store,
                &project,
                &actor,
                TimestampMs::from_millis(now_ms_u64()),
                limit,
                offset,
            )
            .map_err(|message| {
                CliError::with(
                    ErrorCode::ServiceUnavailable,
                    ApplicationOutcome::Failed,
                    message,
                )
            })?;
            let items = snapshot
                .items
                .iter()
                .map(|item| {
                    json!({
                        "work_id": item.work.id.as_str(),
                        "title": item.work.title,
                        "display_status": format_status(item.display_status()),
                        "claimable_for_actor": item.decision.claimable_for_actor,
                        "reason_codes": item.decision.reason_codes.iter().map(|reason| format!("{reason:?}")).collect::<Vec<_>>(),
                        "attempt_id": item.attempt.as_ref().map(|attempt| attempt.attempt_id.as_str()),
                        "fence": item.attempt.as_ref().map(|attempt| attempt.fence.get()),
                    })
                })
                .collect::<Vec<_>>();
            Ok((
                ApplicationOutcome::Unchanged,
                Some(snapshot.project_revision.0),
                Some(json!({
                    "command": "status",
                    "contract_version": snapshot.contract_version,
                    "project_id": snapshot.project_id.as_str(),
                    "project_revision": snapshot.project_revision.0,
                    "as_of": stamp(snapshot.as_of.as_millis()),
                    "limit": snapshot.limit,
                    "offset": snapshot.offset,
                    "total": snapshot.total,
                    "has_more": snapshot.has_more(),
                    "next_offset": snapshot.next_offset(),
                    "counts": {
                        "total": snapshot.counts.total,
                        "ready": snapshot.counts.ready,
                        "queued": snapshot.counts.queued,
                        "blocked": snapshot.counts.blocked,
                        "in_progress": snapshot.counts.in_progress,
                        "closed": snapshot.counts.closed,
                    },
                    "items": items,
                })),
            ))
        }

        pub(super) fn claim(&mut self, data: &Value, operation: &str) -> ServiceResult {
            let project = ProjectId::new(string(data, "project_id")?);
            let work_id = string(data, "work_id")?;
            let actor = string(data, "actor_id")?;
            let harness = string(data, "harness_id")?;
            let session = string(data, "session_id")?;
            let claimed_at = TimestampMs::from_millis(parse_timestamp(data, "claimed_at")?);
            let app = WorkApplication::new(&self.store);
            // Resolve the project/work FK path before attempting session
            // registration. Actor FK validation remains inside the atomic
            // registration transaction, before its session insert.
            app.show_work(&project, &work_id)
                .map_err(map_application_error)?;
            let registered_revision = self.register_session(
                &project,
                &actor,
                &harness,
                &session,
                operation,
                claimed_at,
                optional_u64(data, "expected_revision")?,
            )?;
            let result = app
                .claim(
                    &project,
                    &work_id,
                    &actor,
                    &harness,
                    Some(&session),
                    &string(data, "attempt_id")?,
                    operation,
                    &format!("sha256:{operation}"),
                    registered_revision,
                    &string(data, "claimed_at")?,
                    &string(data, "lease_deadline")?,
                    &string(data, "hard_deadline")?,
                )
                .map_err(map_application_error)?;
            let adapter = SqliteAttemptAdapter::new(&self.store);
            let snapshot = adapter
                .current_attempt(&project, &AttemptId::new(result.value.attempt_id.clone()))
                .map_err(|error| map_application_error(ApplicationError::from(error)))?;
            Ok((
                if result.changed {
                    ApplicationOutcome::Changed
                } else {
                    ApplicationOutcome::Unchanged
                },
                Some(result.snapshot_revision),
                Some(json!({
                    "attempt_id": result.value.attempt_id,
                    "fence": result.value.fence,
                    "phase": "claimed",
                    "lease_deadline": stamp(snapshot.lease_deadline.as_millis()),
                    "hard_deadline": stamp(snapshot.hard_deadline.as_millis()),
                    "session_id": snapshot.session_id.as_ref().map(|value| value.as_str()),
                    "replayed": result.value.replayed,
                })),
            ))
        }

        pub(super) fn start(&mut self, data: &Value, operation: &str) -> ServiceResult {
            let project = ProjectId::new(string(data, "project_id")?);
            let work_id = string(data, "work_id")?;
            let actor = string(data, "actor_id")?;
            let harness = string(data, "harness_id")?;
            let session = string(data, "session_id")?;
            let current = self
                .store
                .current_attempt_for_work(project.as_str(), &work_id)
                .map_err(map_store_error)?;
            let (attempt_id, fence) = if let Some(current) = current {
                if current.actor_id != actor
                    || current.harness_id.as_deref() != Some(harness.as_str())
                    || current.session_id.as_deref() != Some(session.as_str())
                {
                    return Err(CliError::with(
                        ErrorCode::AttemptConflict,
                        ApplicationOutcome::Conflict,
                        "the current attempt is owned by another actor, harness, or session",
                    ));
                }
                (current.attempt_id, current.fence)
            } else {
                let (_, _, _) = self.claim(data, operation)?;
                let claimed = self
                    .store
                    .current_attempt_for_work(project.as_str(), &work_id)
                    .map_err(map_store_error)?
                    .ok_or_else(|| {
                        CliError::with(
                            ErrorCode::UnknownOutcome,
                            ApplicationOutcome::Unknown,
                            "claim did not persist an attempt",
                        )
                    })?;
                (claimed.attempt_id, claimed.fence)
            };
            let app = WorkApplication::new(&self.store);
            let adapter = SqliteAttemptAdapter::new(&self.store);
            let attempt = AttemptId::new(attempt_id);
            let request = attempt_request_from_data(
                data,
                &project,
                &work_id,
                &attempt,
                Fence::new(fence),
                &sub_operation(operation, "start"),
            )?;
            let snapshot = adapter
                .current_attempt(&project, &attempt)
                .map_err(|error| map_application_error(ApplicationError::from(error)))?;
            let mut last = None;
            if snapshot.phase == AttemptPhase::Claimed {
                let accepted = app
                    .accept(&adapter, request.clone())
                    .map_err(map_application_error)?;
                last = Some(accepted);
            }
            let current = adapter
                .current_attempt(&project, &attempt)
                .map_err(|error| map_application_error(ApplicationError::from(error)))?;
            if current.phase == AttemptPhase::Accepted {
                let started = app
                    .start(
                        &adapter,
                        attempt_request_from_data(
                            data,
                            &project,
                            &work_id,
                            &attempt,
                            Fence::new(fence),
                            operation,
                        )?,
                    )
                    .map_err(map_application_error)?;
                last = Some(started);
            }
            let current = adapter
                .current_attempt(&project, &attempt)
                .map_err(|error| map_application_error(ApplicationError::from(error)))?;
            let result = last.ok_or_else(|| {
                CliError::with(
                    ErrorCode::AttemptConflict,
                    ApplicationOutcome::Conflict,
                    "attempt is not startable",
                )
            })?;
            Ok((
                if result.changed {
                    ApplicationOutcome::Changed
                } else {
                    ApplicationOutcome::Unchanged
                },
                Some(result.snapshot_revision),
                Some(attempt_snapshot_json(&current)),
            ))
        }

        fn release(&mut self, data: &Value, operation: &str) -> ServiceResult {
            let project = ProjectId::new(string(data, "project_id")?);
            let work_id = string(data, "work_id")?;
            let attempt = AttemptId::new(string(data, "attempt_id")?);
            let fence = Fence::new(required_u64(data, "fence")?);
            let app = WorkApplication::new(&self.store);
            let adapter = SqliteAttemptAdapter::new(&self.store);
            let result = app
                .release(
                    &adapter,
                    EndAttemptRequest {
                        attempt: attempt_request_from_data(
                            data, &project, &work_id, &attempt, fence, operation,
                        )?,
                        reason: optional_string(data, "reason")?,
                    },
                )
                .map_err(map_application_error)?;
            Ok((
                if result.changed {
                    ApplicationOutcome::Changed
                } else {
                    ApplicationOutcome::Unchanged
                },
                Some(result.snapshot_revision),
                Some(attempt_mutation_json(&result.value)),
            ))
        }

        fn evidence_add(&mut self, data: &Value) -> ServiceResult {
            let dto: boreal_protocol::models::ReceiptDto =
                serde_json::from_value(data.get("receipt").cloned().ok_or_else(|| {
                    CliError::invalid("service evidence_add requires a receipt payload")
                })?)
                .map_err(|error| {
                    CliError::with(
                        ErrorCode::ReceiptInvalid,
                        ApplicationOutcome::Rejected,
                        error.to_string(),
                    )
                })?;
            let receipt = super::super::receipt_from_dto(dto)?;
            let result = WorkApplication::new(&self.store)
                .record_receipt(
                    &string(data, "actor_id")?,
                    None,
                    &receipt,
                    optional_u64(data, "expected_revision")?,
                    TimestampMs::from_millis(now_ms_u64()),
                )
                .map_err(map_application_error)?;
            Ok((
                if result.replayed {
                    ApplicationOutcome::Unchanged
                } else {
                    ApplicationOutcome::Changed
                },
                Some(result.revision),
                Some(json!({
                    "receipt_id": result.receipt.receipt_id,
                    "operation_id": result.receipt.operation_id,
                    "result": format!("{:?}", result.receipt.result).to_ascii_lowercase(),
                    "replayed": result.replayed,
                })),
            ))
        }

        pub(super) fn evidence_run(&mut self, data: &Value, operation: &str) -> ServiceResult {
            let parsed = ParsedCommand {
                path: vec!["evidence".to_owned(), "run".to_owned()],
                options: CliOptions {
                    project: Some(string(data, "project_id")?),
                    actor: string(data, "actor_id")?,
                    harness: string(data, "harness_id")?,
                    session: string(data, "session_id")?,
                    work: Some(string(data, "work_id")?),
                    gate: Some(string(data, "gate_id")?),
                    attempt: optional_string(data, "attempt_id")?,
                    fence: optional_u64(data, "fence")?,
                    expected_revision: optional_u64(data, "expected_revision")?,
                    operation_id: Some(operation.to_owned()),
                    ..CliOptions::default()
                },
            };
            let adapter = SqliteAttemptAdapter::new(&self.store);
            let result = super::super::evidence_run_result(
                &parsed,
                &WorkApplication::new(&self.store),
                &adapter,
                &self.store,
                operation,
                &self.gate_root,
            )?;
            Ok((result.outcome, result.revision, result.data))
        }

        pub(super) fn finish_close(&mut self, data: &Value, operation: &str) -> ServiceResult {
            let project = ProjectId::new(string(data, "project_id")?);
            let work_id = string(data, "work_id")?;
            let attempt = AttemptId::new(string(data, "attempt_id")?);
            let fence = Fence::new(required_u64(data, "fence")?);
            let actor = string(data, "actor_id")?;
            let session = string(data, "session_id")?;
            let dto: boreal_protocol::models::ReceiptDto =
                serde_json::from_value(data.get("receipt").cloned().ok_or_else(|| {
                    CliError::invalid("service finish_close requires a receipt payload")
                })?)
                .map_err(|error| {
                    CliError::with(
                        ErrorCode::ReceiptInvalid,
                        ApplicationOutcome::Rejected,
                        error.to_string(),
                    )
                })?;
            let receipt = super::super::receipt_from_dto(dto)?;
            if receipt.work_id != WorkId::new(work_id.clone()) {
                return Err(CliError::with(
                    ErrorCode::ReceiptInvalid,
                    ApplicationOutcome::Rejected,
                    "receipt work_id does not match the finish target",
                ));
            }
            if receipt.attempt_id != attempt || receipt.fence != fence {
                return Err(CliError::with(
                    ErrorCode::ReceiptInvalid,
                    ApplicationOutcome::Rejected,
                    "receipt attempt or fence does not match the finish target",
                ));
            }
            let app = WorkApplication::new(&self.store);
            let receipt_result = app
                .record_receipt(
                    &actor,
                    Some(&session),
                    &receipt,
                    optional_u64(data, "expected_revision")?,
                    TimestampMs::from_millis(now_ms_u64()),
                )
                .map_err(map_application_error)?;
            let adapter = SqliteAttemptAdapter::new(&self.store);
            let submitted = app
                .submit(
                    &adapter,
                    attempt_request_from_data(
                        data,
                        &project,
                        &work_id,
                        &attempt,
                        fence,
                        &sub_operation(operation, "submit"),
                    )?,
                )
                .map_err(map_application_error)?;
            let intent = boreal_application::CloseIntent {
                work_id: receipt.work_id.clone(),
                attempt_id: receipt.attempt_id.clone(),
                fence: receipt.fence,
                source_snapshot_hash: receipt.source_snapshot_hash.clone(),
                config_identity: receipt.config_identity.clone(),
                profile_id: receipt.coverage.profile_id.clone(),
                profile_version: receipt.coverage.profile_version.clone(),
                summary_id: None,
            };
            let requested = app
                .request_close(
                    &actor,
                    Some(&session),
                    &intent,
                    None,
                    TimestampMs::from_millis(now_ms_u64()),
                )
                .map_err(map_application_error)?;
            let finalized = app
                .finalize_close(
                    &actor,
                    Some(&session),
                    &intent,
                    None,
                    TimestampMs::from_millis(now_ms_u64()),
                )
                .map_err(map_application_error)?;
            let outcome =
                if finalized.close_intent.state == boreal_store::CloseIntentState::Finalized {
                    ApplicationOutcome::Changed
                } else {
                    ApplicationOutcome::Rejected
                };
            Ok((
                outcome,
                Some(finalized.revision),
                Some(json!({
                    "attempt": attempt_mutation_json(&submitted.value),
                    "receipt_id": receipt.receipt_id.as_str(),
                    "receipt_replayed": receipt_result.replayed,
                    "close_intent": format!("{:?}", requested.close_intent.state).to_ascii_lowercase(),
                    "close_state": format!("{:?}", finalized.close_intent.state).to_ascii_lowercase(),
                    "close_replayed": finalized.replayed,
                    "gates": finalized.diagnostics.map(|diagnostics| json!({
                        "missing": diagnostics.missing,
                        "gates": diagnostics.gates.into_iter().map(|gate| json!({
                            "gate_id": gate.gate_id,
                            "kind": format!("{:?}", gate.kind).to_ascii_lowercase(),
                            "required": gate.required,
                            "state": format!("{:?}", gate.state).to_ascii_lowercase(),
                            "receipt_id": gate.receipt_id,
                            "reason": gate.reason,
                        })).collect::<Vec<_>>(),
                    })),
                })),
            ))
        }

        #[allow(clippy::too_many_arguments)]
        fn register_session(
            &self,
            project: &ProjectId,
            actor: &str,
            harness: &str,
            session: &str,
            operation: &str,
            started_at: TimestampMs,
            expected_revision: Option<u64>,
        ) -> Result<Option<u64>, CliError> {
            let app = WorkApplication::new(&self.store);
            let request = SessionRegistrationRequest {
                project_id: project.clone(),
                session_id: SessionId::new(session),
                actor_id: ActorId::new(actor),
                harness_id: HarnessId::new(harness),
                operation_id: OperationId::new(sub_operation(operation, "session")),
                request_digest: format!("sha256:{operation}_session"),
                expected_project_revision: expected_revision,
                started_at,
            };
            let result = app
                .register_session(&request)
                .map_err(map_application_error)?;
            Ok(Some(result.snapshot_revision))
        }
    }

    fn make_envelope(
        operation: &str,
        outcome: ApplicationOutcome,
        revision: Option<u64>,
        data: Option<Value>,
        error: Option<WireError>,
    ) -> Envelope<Value> {
        Envelope {
            api_version: API_VERSION.to_owned(),
            schema_version: schema::ENVELOPE.to_owned(),
            operation_id: operation.to_owned(),
            revision,
            as_of: now(),
            next_status_change_at: None,
            transport: TransportOutcome::Ok,
            outcome,
            data,
            detail_ref: None,
            error,
        }
    }

    fn attempt_request_from_data(
        data: &Value,
        project: &ProjectId,
        work_id: &str,
        attempt: &AttemptId,
        fence: Fence,
        operation: &str,
    ) -> Result<AttemptRequest, CliError> {
        Ok(AttemptRequest::new(
            project.clone(),
            WorkId::new(work_id),
            attempt.clone(),
            ActorId::new(string(data, "actor_id")?),
            Some(HarnessId::new(string(data, "harness_id")?)),
            Some(SessionId::new(string(data, "session_id")?)),
            fence,
            OperationId::new(operation),
            format!("sha256:{operation}"),
            TimestampMs::from_millis(now_ms_u64()),
        ))
    }

    fn attempt_snapshot_json(snapshot: &AttemptSnapshot) -> Value {
        json!({
            "attempt_id": snapshot.attempt_id.as_str(),
            "fence": snapshot.fence.get(),
            "phase": format_status(snapshot.phase),
            "lease_deadline": stamp(snapshot.lease_deadline.as_millis()),
            "hard_deadline": stamp(snapshot.hard_deadline.as_millis()),
            "session_id": snapshot.session_id.as_ref().map(|value| value.as_str()),
            "current": snapshot.current,
        })
    }

    fn attempt_mutation_json(mutation: &boreal_application::AttemptMutation) -> Value {
        json!({
            "attempt_id": mutation.attempt_id.as_str(),
            "fence": mutation.fence.get(),
            "phase": format_status(mutation.phase),
            "lease_deadline": stamp(mutation.lease_deadline.as_millis()),
            "hard_deadline": stamp(mutation.hard_deadline.as_millis()),
            "current": false,
            "replayed": mutation.replayed,
        })
    }

    fn format_status<T: std::fmt::Debug>(status: T) -> String {
        format!("{status:?}").to_ascii_lowercase()
    }

    fn string(data: &Value, field: &str) -> Result<String, CliError> {
        data.get(field)
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(ToOwned::to_owned)
            .ok_or_else(|| CliError::invalid(format!("service request requires {field}")))
    }

    fn optional_string(data: &Value, field: &str) -> Result<Option<String>, CliError> {
        match data.get(field) {
            None | Some(Value::Null) => Ok(None),
            Some(value) => value
                .as_str()
                .map(|value| Some(value.to_owned()))
                .ok_or_else(|| {
                    CliError::invalid(format!("service field {field} must be a string"))
                }),
        }
    }

    fn required_u64(data: &Value, field: &str) -> Result<u64, CliError> {
        data.get(field)
            .and_then(Value::as_u64)
            .filter(|value| *value > 0)
            .ok_or_else(|| CliError::invalid(format!("service request requires positive {field}")))
    }

    fn optional_u64(data: &Value, field: &str) -> Result<Option<u64>, CliError> {
        match data.get(field) {
            None | Some(Value::Null) => Ok(None),
            Some(value) => value.as_u64().map(Some).ok_or_else(|| {
                CliError::invalid(format!("service field {field} must be an integer"))
            }),
        }
    }

    fn parse_timestamp(data: &Value, field: &str) -> Result<u64, CliError> {
        parse_stamp_ms(&string(data, field)?)
            .ok_or_else(|| CliError::invalid(format!("service field {field} must use unix-ms:N")))
    }

    fn receipt_dto_value(parsed: &ParsedCommand) -> Result<Value, CliError> {
        let path = parsed
            .options
            .receipt
            .as_deref()
            .ok_or_else(|| CliError::invalid("evidence add requires --receipt PATH"))?;
        let text = fs::read_to_string(path).map_err(|error| {
            CliError::with(
                ErrorCode::ReceiptInvalid,
                ApplicationOutcome::Rejected,
                error.to_string(),
            )
        })?;
        if text.len() > super::super::MAX_JSON_BYTES {
            return Err(CliError::with(
                ErrorCode::ReceiptInvalid,
                ApplicationOutcome::Rejected,
                "receipt JSON exceeds the inline protocol bound",
            ));
        }
        let dto: boreal_protocol::models::ReceiptDto =
            serde_json::from_str(&text).map_err(|error| {
                CliError::with(
                    ErrorCode::ReceiptInvalid,
                    ApplicationOutcome::Rejected,
                    error.to_string(),
                )
            })?;
        // Match the direct command's DTO-to-domain checks before crossing the
        // socket; the service repeats them before persistence.
        super::super::receipt_from_dto(dto.clone())?;
        serde_json::to_value(dto).map_err(|error| {
            CliError::with(
                ErrorCode::ReceiptInvalid,
                ApplicationOutcome::Rejected,
                error.to_string(),
            )
        })
    }
}

#[cfg(unix)]
#[allow(dead_code, unused_imports)]
mod tests {
    use super::unix::ServiceCommandHandler;
    use super::*;
    use boreal_protocol::Envelope;
    use boreal_service::{
        JsonRequest, ServiceHost, ServiceHostConfig, ServiceHostExit, TransportConfig,
        TransportError, UnixSocketClient, APPLICATION_API_VERSION, APPLICATION_SCHEMA_VERSION,
    };

    fn temp_path(kind: &str) -> PathBuf {
        env::temp_dir().join(format!(
            "boreal-cli-service-{}-{}-{kind}",
            std::process::id(),
            now_ms_u64()
        ))
    }

    fn seed_store(path: &Path) -> SqliteStore {
        let store = SqliteStore::open(path, SCHEMA).expect("temporary schema opens");
        let project = ProjectId::new("service-project");
        let app = WorkApplication::new(&store);
        app.init_project(
            &project,
            DEFAULT_ACTOR,
            "agent",
            "cli",
            "CLI service test",
            "unix-ms:1",
            "op_service_init",
        )
        .expect("project initializes");
        app.create_work_as(
            &WorkItem {
                id: WorkId::new("service-work"),
                project_id: project,
                kind: WorkKind::Milestone,
                parent_id: None,
                title: "Service work".to_owned(),
                description: String::new(),
                lifecycle: PersistedLifecycle::Open,
                priority: 0,
                dispatch_policy: DispatchPolicy::Automatic,
                hard_holds: Vec::new(),
                acceptance_profile: AcceptanceProfile::focused(),
            },
            DEFAULT_ACTOR,
            "unix-ms:1",
            "op_service_work",
        )
        .expect("work creates");
        store
    }

    fn make_handler(store: SqliteStore) -> ServiceCommandHandler {
        make_handler_at(store, PathBuf::from(".boreal/gates"))
    }

    fn make_handler_at(store: SqliteStore, gate_root: PathBuf) -> ServiceCommandHandler {
        ServiceCommandHandler { store, gate_root }
    }

    #[test]
    fn bounded_service_request_returns_a_versioned_status_envelope() {
        let db = temp_path("status.sqlite");
        let socket = temp_path("status.sock");
        let store = seed_store(&db);
        let host = match ServiceHost::bind(
            &socket,
            make_handler(store),
            ServiceHostConfig::default()
                .with_max_requests(Some(1))
                .expect("positive request bound"),
        ) {
            Ok(host) => host,
            Err(error) if socket_unavailable_in_sandbox(&error.to_string()) => return,
            Err(error) => panic!("service host binds in a temporary directory: {error}"),
        };
        let handle = host.start().expect("service host starts");
        let payload = json!({
            "api_version": APPLICATION_API_VERSION,
            "schema_version": APPLICATION_SCHEMA_VERSION,
            "operation_id": "op_cli_status_test",
            "data": {
                "command": "status",
                "project_id": "service-project",
                "actor_id": DEFAULT_ACTOR,
                "harness_id": DEFAULT_HARNESS,
                "session_id": DEFAULT_SESSION,
                "limit": 10,
                "offset": 0,
            }
        });
        let request = JsonRequest::new("request-status", payload.to_string())
            .expect("status request is valid JSON");
        let mut client = match UnixSocketClient::connect(&socket, TransportConfig::default()) {
            Ok(client) => client,
            Err(TransportError::Io(error))
                if error.kind() == std::io::ErrorKind::PermissionDenied
                    || error.to_string().contains("Operation not permitted") =>
            {
                return
            }
            Err(error) => panic!("service client connects in a temporary directory: {error}"),
        };
        let response = client.request(request).expect("service returns a response");
        let outer: Value = serde_json::from_str(
            response
                .payload()
                .expect("response contains an outer application payload"),
        )
        .expect("outer payload is JSON");
        assert_eq!(outer["operation_id"], "op_cli_status_test");
        let envelope: Envelope<Value> = serde_json::from_value(outer["data"].clone())
            .expect("response contains the typed CLI envelope");
        envelope.validate().expect("response envelope validates");
        assert_eq!(envelope.outcome, ApplicationOutcome::Unchanged);
        assert_eq!(envelope.data.as_ref().unwrap()["total"], 1);
        assert_eq!(
            envelope.data.as_ref().unwrap()["items"][0]["work_id"],
            "service-work"
        );
        let report = handle.join().expect("bounded service host exits");
        assert_eq!(report.exit(), ServiceHostExit::RequestLimit);
        let _ = fs::remove_file(db);
        let _ = fs::remove_file(socket);
    }

    fn socket_unavailable_in_sandbox(message: &str) -> bool {
        message.contains("Permission denied") || message.contains("Operation not permitted")
    }

    #[test]
    fn service_claim_registers_and_binds_the_session_first() {
        let db = temp_path("claim.sqlite");
        let store = seed_store(&db);
        let mut handler = make_handler(store);
        let data = json!({
            "command": "claim",
            "project_id": "service-project",
            "work_id": "service-work",
            "actor_id": DEFAULT_ACTOR,
            "harness_id": DEFAULT_HARNESS,
            "session_id": "session-deterministic",
            "attempt_id": "attempt-deterministic",
            "claimed_at": "unix-ms:1000",
            "lease_deadline": "unix-ms:2000",
            "hard_deadline": "unix-ms:3000",
            "expected_revision": 2,
        });
        let result = handler
            .claim(&data, "op_cli_claim_deterministic")
            .expect("session-bound claim succeeds");
        assert_eq!(result.0, ApplicationOutcome::Changed);
        let session = handler
            .store
            .session("service-project", "session-deterministic")
            .expect("session read succeeds")
            .expect("claim registered its session");
        assert_eq!(session.actor_id, DEFAULT_ACTOR);
        assert_eq!(session.harness_id, DEFAULT_HARNESS);
        let attempt = handler
            .store
            .current_attempt_for_work("service-project", "service-work")
            .expect("attempt read succeeds")
            .expect("claim persisted its attempt");
        assert_eq!(attempt.session_id.as_deref(), Some("session-deterministic"));
        assert_eq!(attempt.actor_id, DEFAULT_ACTOR);
        let _ = fs::remove_file(db);
    }

    #[test]
    fn service_finish_close_persists_receipt_and_retains_gate_diagnostics() {
        let db = temp_path("finish.sqlite");
        let store = seed_store(&db);
        let mut handler = make_handler(store);
        let now = now_ms_u64();
        let claim = json!({
            "command": "claim",
            "project_id": "service-project",
            "work_id": "service-work",
            "actor_id": DEFAULT_ACTOR,
            "harness_id": DEFAULT_HARNESS,
            "session_id": "session-finish",
            "attempt_id": "attempt-finish",
            "claimed_at": stamp(now),
            "lease_deadline": stamp(now + 60_000),
            "hard_deadline": stamp(now + 120_000),
            "expected_revision": 2,
        });
        handler
            .claim(&claim, "op_service_finish_claim")
            .expect("service claim succeeds");
        let start = json!({
            "command": "start",
            "project_id": "service-project",
            "work_id": "service-work",
            "actor_id": DEFAULT_ACTOR,
            "harness_id": DEFAULT_HARNESS,
            "session_id": "session-finish",
            "attempt_id": "attempt-finish",
            "fence": 1,
        });
        handler
            .start(&start, "op_service_finish_start")
            .expect("service start succeeds");
        handler
            .store
            .execute_batch(
                "INSERT INTO source_version
                 (source_version_id, project_id, origin, access_scope, content_digest,
                  media_type, byte_count, captured_at, parser_identity, availability, citation_json)
                 VALUES ('source-finish', 'service-project', 'fixture.md', 'project',
                         'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                         'text/markdown', 1, 'unix-ms:0', 'parser/1', 'available', '[]');",
            )
            .expect("source snapshot registers");
        let finish = json!({
            "command": "finish_close",
            "project_id": "service-project",
            "work_id": "service-work",
            "actor_id": DEFAULT_ACTOR,
            "harness_id": DEFAULT_HARNESS,
            "session_id": "session-finish",
            "attempt_id": "attempt-finish",
            "fence": 1,
            "expected_revision": Value::Null,
            "receipt": {
                "schema_version": "boreal.receipt.v1",
                "receipt_id": "receipt-service-finish",
                "operation_id": "op-receipt-service-finish",
                "subject": {"work_id": "service-work", "attempt_id": "attempt-finish", "fence": 1, "gate_id": "verification"},
                "executable": "printf",
                "argv": ["printf", "ok"],
                "cwd": ".",
                "exit_code": 0,
                "started_at": "unix-ms:1",
                "ended_at": "unix-ms:2",
                "source_snapshot_hash": "source-finish",
                "config_identity": "config-1",
                "environment_fingerprint": "env-1",
                "output_digest": "digest-1",
                "output_ref": null,
                "coverage": {"kind": "verification", "profile_id": "focused", "profile_version": "1"},
                "attestation": "boreal_witnessed",
                "result": "passed",
                "retention": null,
            }
        });
        let result = handler
            .finish_close(&finish, "op_service_finish_close")
            .expect("service finish close returns a bounded gate result");
        assert_eq!(result.0, ApplicationOutcome::Rejected);
        let data = result.2.expect("finish close data");
        assert_eq!(data["receipt_replayed"], false);
        assert_eq!(data["close_state"], "open");
        assert!(data["gates"]["missing"]
            .as_array()
            .expect("missing gate list")
            .iter()
            .any(|gate| gate.as_str().is_some_and(|id| id.ends_with(":checkpoint"))));
        assert!(data["gates"]["missing"]
            .as_array()
            .expect("missing gate list")
            .iter()
            .any(|gate| gate.as_str().is_some_and(|id| id.ends_with(":summary"))));
        let _ = fs::remove_file(db);
    }

    #[test]
    fn service_evidence_run_retains_failure_and_replays_the_receipt() {
        let db = temp_path("evidence-failure.sqlite");
        let gate_root = temp_path("evidence-failure-gates");
        fs::create_dir_all(&gate_root).expect("gate directory creates");
        fs::write(
            gate_root.join("verification.json"),
            serde_json::to_vec(&json!({
                "gate_id": "verification",
                "kind": "verification",
                "executable": "false",
                "argv": ["false"],
                "cwd": ".",
                "source_snapshot_hash": "source-evidence-failure",
                "config_identity": "config-evidence-failure",
                "environment_fingerprint": "env-evidence-failure",
                "observables": [],
                "max_runtime_ms": 30,
            }))
            .expect("gate declaration serializes"),
        )
        .expect("gate declaration writes");

        let store = seed_store(&db);
        let mut handler = make_handler_at(store, gate_root.clone());
        let now = now_ms_u64();
        handler
            .claim(
                &json!({
                    "command": "claim",
                    "project_id": "service-project",
                    "work_id": "service-work",
                    "actor_id": DEFAULT_ACTOR,
                    "harness_id": DEFAULT_HARNESS,
                    "session_id": "session-evidence-failure",
                    "attempt_id": "attempt-evidence-failure",
                    "claimed_at": stamp(now),
                    "lease_deadline": stamp(now + 60_000),
                    "hard_deadline": stamp(now + 120_000),
                    "expected_revision": 2,
                }),
                "op_service_evidence_claim",
            )
            .expect("evidence claim succeeds");
        handler
            .start(
                &json!({
                    "command": "start",
                    "project_id": "service-project",
                    "work_id": "service-work",
                    "actor_id": DEFAULT_ACTOR,
                    "harness_id": DEFAULT_HARNESS,
                    "session_id": "session-evidence-failure",
                    "attempt_id": "attempt-evidence-failure",
                    "fence": 1,
                }),
                "op_service_evidence_start",
            )
            .expect("evidence attempt starts");
        handler
            .store
            .execute_batch(
                "INSERT INTO source_version
                 (source_version_id, project_id, origin, access_scope, content_digest,
                  media_type, byte_count, captured_at, parser_identity, availability, citation_json)
                 VALUES ('source-evidence-failure', 'service-project', 'fixture.md', 'project',
                         'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
                         'text/markdown', 1, 'unix-ms:0', 'parser/1', 'available', '[]');",
            )
            .expect("source snapshot registers");

        let request = json!({
            "command": "evidence_run",
            "project_id": "service-project",
            "work_id": "service-work",
            "actor_id": DEFAULT_ACTOR,
            "harness_id": DEFAULT_HARNESS,
            "session_id": "session-evidence-failure",
            "attempt_id": "attempt-evidence-failure",
            "fence": 1,
            "gate_id": "verification",
        });
        let first = handler
            .evidence_run(&request, "op_service_evidence_failure")
            .expect("failed gate is retained as evidence");
        assert_eq!(first.0, ApplicationOutcome::Changed);
        assert_eq!(first.2.as_ref().unwrap()["result"], "failed");
        assert_eq!(first.2.as_ref().unwrap()["execution_outcome"], "failed");
        assert_eq!(first.2.as_ref().unwrap()["replayed"], false);

        let replay = handler
            .evidence_run(&request, "op_service_evidence_failure")
            .expect("same failed gate operation replays");
        assert_eq!(replay.0, ApplicationOutcome::Unchanged);
        assert_eq!(replay.2.as_ref().unwrap()["result"], "failed");
        assert_eq!(replay.2.as_ref().unwrap()["replayed"], true);

        let _ = fs::remove_file(db);
        let _ = fs::remove_dir_all(gate_root);
    }

    #[test]
    fn finish_release_routes_to_the_existing_fenced_release_command() {
        let parsed = parse(&[
            "agent".to_owned(),
            "finish".to_owned(),
            "work-1".to_owned(),
            "--release".to_owned(),
            "--project".to_owned(),
            "project-1".to_owned(),
            "--attempt".to_owned(),
            "attempt-1".to_owned(),
            "--fence".to_owned(),
            "3".to_owned(),
            "--socket".to_owned(),
            "/tmp/boreal.sock".to_owned(),
        ])
        .expect("finish release parses");
        assert!(super::supports(&parsed));
        let data = super::unix::request_data(&parsed, "op_finish_release")
            .expect("finish release has a service payload");
        assert_eq!(data["command"], "release");
        assert_eq!(data["work_id"], "work-1");
        assert_eq!(data["attempt_id"], "attempt-1");
        assert_eq!(data["fence"], 3);
    }

    #[test]
    fn finish_close_routes_a_bounded_receipt_close_payload() {
        let receipt_path = temp_path("finish-receipt.json");
        fs::write(
            &receipt_path,
            serde_json::to_vec(&json!({
                "schema_version": "boreal.receipt.v1",
                "receipt_id": "receipt-finish-service",
                "operation_id": "op-finish-receipt-service",
                "subject": {"work_id": "work-1", "attempt_id": "attempt-1", "fence": 3, "gate_id": "verification"},
                "executable": "printf",
                "argv": ["printf", "ok"],
                "cwd": ".",
                "exit_code": 0,
                "started_at": "unix-ms:1",
                "ended_at": "unix-ms:2",
                "source_snapshot_hash": "source-1",
                "config_identity": "config-1",
                "environment_fingerprint": "env-1",
                "output_digest": "digest-1",
                "output_ref": null,
                "coverage": {"kind": "verification", "profile_id": "focused", "profile_version": "1"},
                "attestation": "boreal_witnessed",
                "result": "passed",
                "retention": null,
            }))
            .expect("finish receipt serializes"),
        )
        .expect("finish receipt writes");
        let parsed = parse(&[
            "agent".to_owned(),
            "finish".to_owned(),
            "work-1".to_owned(),
            "--close".to_owned(),
            "--project".to_owned(),
            "project-1".to_owned(),
            "--session".to_owned(),
            "session-1".to_owned(),
            "--attempt".to_owned(),
            "attempt-1".to_owned(),
            "--fence".to_owned(),
            "3".to_owned(),
            "--receipt".to_owned(),
            receipt_path.to_string_lossy().into_owned(),
            "--socket".to_owned(),
            "/tmp/boreal.sock".to_owned(),
        ])
        .expect("finish close parses");
        assert!(super::supports(&parsed));
        let data = super::unix::request_data(&parsed, "op_finish_close")
            .expect("finish close has a service payload");
        assert_eq!(data["command"], "finish_close");
        assert_eq!(data["work_id"], "work-1");
        assert_eq!(data["attempt_id"], "attempt-1");
        assert_eq!(data["fence"], 3);
        assert_eq!(data["receipt"]["subject"]["gate_id"], "verification");
        let _ = fs::remove_file(receipt_path);
    }

    #[test]
    fn evidence_add_routes_only_with_receipt_and_sends_bounded_structured_payload() {
        let receipt_path = temp_path("receipt.json");
        fs::write(
            &receipt_path,
            serde_json::to_vec(&json!({
                "schema_version": "boreal.receipt.v1",
                "receipt_id": "receipt-service",
                "operation_id": "op-receipt-service",
                "subject": {"work_id": "work-1", "attempt_id": "attempt-1", "fence": 1, "gate_id": "checkpoint"},
                "executable": "printf",
                "argv": ["printf", "ok"],
                "cwd": ".",
                "exit_code": 0,
                "started_at": "unix-ms:1",
                "ended_at": "unix-ms:2",
                "source_snapshot_hash": "source-1",
                "config_identity": "config-1",
                "environment_fingerprint": "env-1",
                "output_digest": "digest-1",
                "output_ref": null,
                "coverage": {"kind": "checkpoint", "profile_id": "focused", "profile_version": "1"},
                "attestation": "self_reported",
                "result": "passed"
            }))
            .expect("receipt serializes"),
        )
        .expect("receipt writes");
        let receipt_path = receipt_path.to_string_lossy().into_owned();
        let parsed = parse(&[
            "evidence".to_owned(),
            "add".to_owned(),
            "--project".to_owned(),
            "project-1".to_owned(),
            "--work".to_owned(),
            "work-1".to_owned(),
            "--gate".to_owned(),
            "checkpoint".to_owned(),
            "--receipt".to_owned(),
            receipt_path.as_str().to_owned(),
        ])
        .expect("evidence add with receipt parses");
        assert!(super::supports(&parsed));
        let mut without_receipt = parsed.clone();
        without_receipt.options.receipt = None;
        assert!(!super::supports(&without_receipt));
        let data = super::unix::request_data(&parsed, "op-evidence-service")
            .expect("evidence add has a service payload");
        assert_eq!(data["command"], "evidence_add");
        assert!(data["receipt"].is_object());
        assert_eq!(data["receipt"]["receipt_id"], "receipt-service");
        assert!(!data.to_string().contains(&receipt_path));
        let _ = fs::remove_file(receipt_path);
    }
}

#[cfg(unix)]
pub(crate) use unix::{request, run_service};
