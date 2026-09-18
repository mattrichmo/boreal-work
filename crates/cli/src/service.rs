//! CLI-owned service process and Unix-socket client adapter.
//!
//! The service crate deliberately stays independent of SQLite and the
//! application crate. This module is the composition point for the CLI: the
//! long-lived process owns a store-backed application handler, while client
//! commands retain the same versioned protocol envelope as direct commands.

use super::*;

pub(crate) fn supports(parsed: &ParsedCommand) -> bool {
    let path = &parsed.path;
    // A lower-level handler is not enough to advertise a public service
    // route. Registry gaps remain fail-closed until their DTO and operation
    // contract are complete; explicit --socket must not bypass that status.
    if crate::command_registry::is_unavailable_path(path) {
        return false;
    }
    matches!(
        path.iter()
            .map(String::as_str)
            .collect::<Vec<_>>()
            .as_slice(),
        ["init"]
            | ["status"]
            | ["prime"]
            | ["work", "create"]
            | ["work", "edit"]
            | ["work", "hold", "add"]
            | ["work", "hold", "resolve"]
            | ["work", "dispatch", "set"]
            | ["dep", "add"]
            | ["dep", "remove"]
            | ["dep", "tree"]
            | ["dep", "cycles"]
            | ["cycle", "board"]
            | ["cycle", "report"]
            | ["intake", "list"]
            | ["intake", "show"]
            | ["intake", "bucket"]
            | ["intake", "capture"]
            | ["doctor"]
            | ["work", "claim"]
            | ["work", "accept"]
            | ["work", "heartbeat"]
            | ["work", "renew"]
            | ["work", "release"]
            | ["work", "finish"]
            | ["agent", "start"]
            | ["agent", "status"]
            | ["agent", "guide"]
            | ["agent", "resume"]
            | ["agent", "next"]
            | ["next"]
            | ["agent", "heartbeat"]
            | ["agent", "renew"]
            | ["agent", "release"]
            | ["session", "start"]
            | ["session", "show"]
            | ["session", "end"]
            | ["evidence", "run"]
            | ["operation", "show"]
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
    use boreal_domain::{ActorContext, ActorRole, ReasonCode};
    use boreal_protocol::{schema, Envelope, ProtocolError as WireError, TransportOutcome};
    use boreal_service::{
        ApplicationCommandHandler, ApplicationRequest, ApplicationResponse,
        ConcurrentApplicationCommandHandler, JsonRequest, OperationPhase, RecoveryBackend,
        RecoveryBackendError, RecoveryEntry, ServiceHost, ServiceHostConfig, TransportConfig,
        TransportError, UnixSocketClient, APPLICATION_API_VERSION, APPLICATION_SCHEMA_VERSION,
    };
    use boreal_store::{
        OperationOutcome as StoreOperationOutcome, OperationRecord, ReceiptAttestation,
        ReceiptOutcome, ReceiptRecord,
    };

    const SERVICE_REQUEST_ID: &str = "cli-service-request";

    #[derive(Clone, Debug)]
    struct SqliteRecoveryBackend {
        database: PathBuf,
    }

    impl RecoveryBackend for SqliteRecoveryBackend {
        fn load_incomplete(&self) -> Result<Vec<RecoveryEntry>, RecoveryBackendError> {
            let store = SqliteStore::open(&self.database, SCHEMA)
                .map_err(|error| RecoveryBackendError::new(error.to_string()))?;
            store
                .list_incomplete_evidence_executions()
                .map(|records| {
                    records
                        .into_iter()
                        .map(|record| {
                            RecoveryEntry::new(record.operation_id, OperationPhase::InFlight, None)
                        })
                        .collect()
                })
                .map_err(|error| RecoveryBackendError::new(error.to_string()))
        }

        fn mark_unknown(&self, operation_id: &str) -> Result<(), RecoveryBackendError> {
            let store = SqliteStore::open(&self.database, SCHEMA)
                .map_err(|error| RecoveryBackendError::new(error.to_string()))?;
            store
                .mark_evidence_execution_unknown(operation_id, "service_restart_recovery")
                .map(|_| ())
                .map_err(|error| RecoveryBackendError::new(error.to_string()))
        }
    }

    pub(crate) fn run_service(
        parsed: &ParsedCommand,
        _operation: &str,
    ) -> Result<CliResult, CliError> {
        let socket = parsed
            .options
            .socket
            .as_deref()
            .ok_or_else(|| CliError::invalid("service run requires --socket PATH"))?;
        let _signals = signal::SignalGuard::install().map_err(|error| {
            CliError::with(
                ErrorCode::ServiceUnavailable,
                ApplicationOutcome::Failed,
                format!("cannot install service signal handlers: {error}"),
            )
        })?;
        let db = PathBuf::from(&parsed.options.db);
        let config = ServiceHostConfig::default()
            .with_max_requests(parsed.options.max_requests)
            .map_err(|error| {
                CliError::with(
                    ErrorCode::InvalidArgument,
                    ApplicationOutcome::Rejected,
                    error.to_string(),
                )
            })?;
        let host = bind_service_host(&db, Path::new(socket), config)?;
        let endpoint = host.socket_path().to_string_lossy().into_owned();
        let handle = host.start_concurrent().map_err(|error| {
            CliError::with(
                ErrorCode::ServiceUnavailable,
                ApplicationOutcome::Failed,
                error.to_string(),
            )
        })?;
        // The host sets this flag both when it reaches a natural request
        // limit and when shutdown() is requested. Polling it lets service run
        // preserve --max-requests while still reacting to SIGINT/SIGTERM
        // without moving ownership of the non-cloneable host handle.
        loop {
            if signal::take_pending() != 0 {
                handle.shutdown();
                break;
            }
            if handle.is_shutdown_requested() {
                break;
            }
            thread::sleep(Duration::from_millis(10));
        }
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

    /// Compose the production service boundary around a canonical database
    /// identity. Each bounded dispatch worker opens its own SQLite connection;
    /// `SqliteStore` is intentionally not shared across threads.
    pub(super) fn bind_service_host(
        db: &Path,
        socket: &Path,
        config: ServiceHostConfig,
    ) -> Result<ServiceHost<ConcurrentServiceCommandHandler>, CliError> {
        ensure_db_parent(db)?;
        // Initialize or validate the schema before binding the endpoint. The
        // request workers subsequently open independent connections to this
        // same canonical database.
        drop(SqliteStore::open(db, SCHEMA).map_err(map_store_error)?);
        let canonical_db = fs::canonicalize(db).map_err(|error| {
            CliError::with(
                ErrorCode::ServiceUnavailable,
                ApplicationOutcome::Failed,
                format!("service database identity is unavailable: {error}"),
            )
        })?;
        let gate_root = canonical_db
            .parent()
            .unwrap_or(Path::new("."))
            .join(super::GATE_COMMANDS_DIR);
        let runtime_dir = canonical_db
            .parent()
            .unwrap_or(Path::new("."))
            .join(".boreal-service-runtime");
        let database_identity = format!("database:{}", canonical_db.to_string_lossy());
        let owner_id = format!(
            "process:{}:{}",
            std::process::id(),
            sha256_content_digest(socket.to_string_lossy().as_bytes())
        );
        ServiceHost::bind(
            socket,
            ConcurrentServiceCommandHandler {
                database: canonical_db.clone(),
                gate_root,
            },
            config,
        )
        .map(|host| {
            host.with_project_election(runtime_dir, database_identity, owner_id)
                .with_recovery_backend(SqliteRecoveryBackend {
                    database: canonical_db.clone(),
                })
        })
        .map_err(|error| {
            CliError::with(
                ErrorCode::ServiceUnavailable,
                ApplicationOutcome::Failed,
                error.to_string(),
            )
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
        let response = match client.request(request) {
            Ok(response) => response,
            Err(TransportError::RemoteProtocol(error))
                if recovered_unknown_duplicate(parsed, &error) =>
            {
                // The host journal must reject a second admission for a
                // recovered operation. Read back through a fresh request
                // operation so the caller receives the application's typed
                // Unknown/readback result rather than a generic duplicate
                // protocol error. The original operation remains the durable
                // identity and is never retried or relaunched.
                let readback_operation = format!(
                    "op_service_readback_{}_{}_{}",
                    std::process::id(),
                    now_ms_u64(),
                    OPERATION_COUNTER.fetch_add(1, Ordering::Relaxed)
                );
                let project = project_argument(parsed, 0)?;
                let readback_payload = json!({
                    "api_version": APPLICATION_API_VERSION,
                    "schema_version": APPLICATION_SCHEMA_VERSION,
                    "operation_id": readback_operation,
                    "data": {
                        "command": "operation_show",
                        "project_id": project,
                        "actor_id": parsed.options.actor,
                        "harness_id": parsed.options.harness,
                        "session_id": parsed.options.session,
                        "target_operation_id": operation,
                        "operation_id": readback_operation,
                    },
                });
                let readback_request = JsonRequest::new(
                    format!("{SERVICE_REQUEST_ID}-readback"),
                    readback_payload.to_string(),
                )
                .map_err(|error| {
                    CliError::with(
                        ErrorCode::ProtocolMismatch,
                        ApplicationOutcome::Failed,
                        error.to_string(),
                    )
                })?;
                let mut readback_client =
                    UnixSocketClient::connect(socket, TransportConfig::default()).map_err(
                        |error| {
                            CliError::with(
                                ErrorCode::ServiceUnavailable,
                                ApplicationOutcome::Failed,
                                error.to_string(),
                            )
                        },
                    )?;
                readback_client
                    .request(readback_request)
                    .map_err(|readback_error| {
                        CliError::with(
                            ErrorCode::ServiceUnavailable,
                            ApplicationOutcome::Failed,
                            format!(
                                "recovered operation readback failed after duplicate {:?}: {}",
                                error.message(),
                                readback_error
                            ),
                        )
                    })?
            }
            Err(error) => {
                return Err(CliError::with(
                    ErrorCode::ServiceUnavailable,
                    ApplicationOutcome::Failed,
                    error.to_string(),
                ));
            }
        };
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
            // A durable operation readback deliberately carries an Unknown
            // application outcome together with bounded state data. Preserve
            // that data so the caller can inspect the operation instead of
            // turning a potentially delivered mutation into a generic
            // transport failure. Other error envelopes without data remain
            // ordinary CLI errors.
            if envelope.outcome == ApplicationOutcome::Unknown && envelope.data.is_some() {
                return Ok(CliResult {
                    outcome: envelope.outcome,
                    revision: envelope.revision,
                    data: envelope.data,
                    human: None,
                    as_of: Some(envelope.as_of),
                    next_status_change_at: envelope.next_status_change_at,
                    detail_ref: envelope.detail_ref,
                });
            }
            return Err(CliError::with(error.code, envelope.outcome, error.message));
        }
        Ok(CliResult {
            outcome: envelope.outcome,
            revision: envelope.revision,
            data: envelope.data,
            human: None,
            as_of: Some(envelope.as_of),
            next_status_change_at: envelope.next_status_change_at,
            detail_ref: envelope.detail_ref,
        })
    }

    fn recovered_unknown_duplicate(
        parsed: &ParsedCommand,
        error: &boreal_service::ProtocolError,
    ) -> bool {
        parsed.path == ["evidence".to_owned(), "run".to_owned()]
            && error.code() == boreal_service::ProtocolErrorCode::InvalidField
            && error.message().contains("phase Unknown")
    }

    #[cfg(unix)]
    mod signal {
        use std::{
            io,
            os::raw::c_int,
            sync::atomic::{AtomicI32, Ordering},
        };

        pub(super) const SIGINT: c_int = 2;
        pub(super) const SIGTERM: c_int = 15;
        const SIGNAL_ERROR: usize = usize::MAX;
        static PENDING: AtomicI32 = AtomicI32::new(0);

        // POSIX signal handlers may only perform async-signal-safe work. The
        // handler records the number; run_service performs the host shutdown
        // and join on its ordinary Rust control path.
        unsafe extern "C" {
            fn signal(signal: c_int, handler: usize) -> usize;
        }

        extern "C" fn record(signal_number: c_int) {
            PENDING.store(signal_number, Ordering::SeqCst);
        }

        pub(super) struct SignalGuard {
            previous: [(c_int, usize); 2],
        }

        impl SignalGuard {
            pub(super) fn install() -> io::Result<Self> {
                PENDING.store(0, Ordering::SeqCst);
                let mut previous = [(0, 0); 2];
                for (slot, signal_number) in previous.iter_mut().zip([SIGINT, SIGTERM]) {
                    let handler = unsafe { signal(signal_number, record as usize) };
                    if handler == SIGNAL_ERROR {
                        for (installed, old_handler) in previous.iter().copied() {
                            if installed != 0 {
                                unsafe { signal(installed, old_handler) };
                            }
                        }
                        return Err(io::Error::last_os_error());
                    }
                    *slot = (signal_number, handler);
                }
                Ok(Self { previous })
            }
        }

        impl Drop for SignalGuard {
            fn drop(&mut self) {
                for (signal_number, handler) in self.previous {
                    unsafe { signal(signal_number, handler) };
                }
                PENDING.store(0, Ordering::SeqCst);
            }
        }

        pub(super) fn take_pending() -> c_int {
            PENDING.swap(0, Ordering::SeqCst)
        }
    }

    pub(super) fn request_data(parsed: &ParsedCommand, operation: &str) -> Result<Value, CliError> {
        let path = parsed.path.iter().map(String::as_str).collect::<Vec<_>>();
        let project = if parsed.path == ["doctor".to_owned()] {
            parsed
                .options
                .project
                .clone()
                .or_else(|| parsed.options.positionals.first().cloned())
                .unwrap_or_default()
        } else {
            project_argument(parsed, 0)?
        };
        let mut data = json!({
            "project_id": if project.is_empty() { Value::Null } else { json!(project) },
            "actor_id": parsed.options.actor,
            "harness_id": parsed.options.harness,
            "session_id": parsed.options.session,
        });
        match path.as_slice() {
            ["init"] => {
                data["command"] = json!("create_project");
                data["name"] = json!(project);
                data["description"] = json!("");
                data["actor_role"] = json!(parsed.options.actor_role.as_deref().unwrap_or("agent"));
                data["credential_ref"] = json!("cli");
            }
            ["status"] | ["prime"] | ["agent", "status"] => {
                data["command"] = json!("status");
                data["limit"] = json!(parsed.options.limit.unwrap_or(100));
                data["offset"] = json!(parsed.options.offset.unwrap_or(0));
            }
            ["work", "create"] => {
                let positional_offset = usize::from(parsed.options.project.is_none());
                let work_id = parsed
                    .options
                    .positionals
                    .get(positional_offset)
                    .cloned()
                    .ok_or_else(|| CliError::invalid("missing work identifier"))?;
                let title = parsed
                    .options
                    .positionals
                    .get(positional_offset + 1)
                    .cloned()
                    .ok_or_else(|| CliError::invalid("missing work title"))?;
                data["command"] = json!("create_work");
                data["work_id"] = json!(work_id);
                data["kind"] = json!(parsed.options.kind.as_deref().unwrap_or("task"));
                data["parent_id"] = parsed
                    .options
                    .parent
                    .clone()
                    .map_or(Value::Null, Value::String);
                data["title"] = json!(title);
                data["description"] = json!(parsed.options.description.as_deref().unwrap_or(""));
                data["priority"] = json!(parsed.options.priority.unwrap_or(0));
                data["dispatch"] = json!(parsed.options.dispatch.as_deref().unwrap_or("automatic"));
                data["hold"] = parsed
                    .options
                    .hold
                    .clone()
                    .map_or(Value::Null, Value::String);
                data["profile"] = json!("focused");
            }
            ["work", "edit"] => {
                let offset = usize::from(parsed.options.project.is_none());
                data["command"] = json!("work_edit");
                data["work_id"] =
                    json!(parsed.options.positionals.get(offset).ok_or_else(|| {
                        CliError::invalid("work edit requires a work identifier")
                    })?);
                data["parent_id"] = parsed
                    .options
                    .parent
                    .clone()
                    .map_or(Value::Null, Value::String);
                data["title"] = parsed
                    .options
                    .title
                    .clone()
                    .map_or(Value::Null, Value::String);
                data["description"] = parsed
                    .options
                    .description
                    .clone()
                    .map_or(Value::Null, Value::String);
                data["priority"] = parsed
                    .options
                    .priority
                    .map_or(Value::Null, |value| json!(value));
                data["dispatch_policy"] = parsed
                    .options
                    .dispatch
                    .clone()
                    .map_or(Value::Null, Value::String);
                data["expected_revision"] = parsed
                    .options
                    .expected_revision
                    .map_or(Value::Null, |value| json!(value));
            }
            ["dep", "add"] => {
                let offset = usize::from(parsed.options.project.is_none());
                data["command"] = json!("dependency_add");
                data["prerequisite_id"] =
                    json!(parsed.options.positionals.get(offset).ok_or_else(|| {
                        CliError::invalid("dep add requires a prerequisite work identifier")
                    })?);
                data["dependent_id"] =
                    json!(parsed.options.positionals.get(offset + 1).ok_or_else(|| {
                        CliError::invalid("dep add requires a dependent work identifier")
                    })?);
                data["expected_revision"] = parsed
                    .options
                    .expected_revision
                    .map_or(Value::Null, |value| json!(value));
            }
            ["dep", "remove"] => {
                let offset = usize::from(parsed.options.project.is_none());
                data["command"] = json!("dependency_remove");
                data["prerequisite_id"] =
                    json!(parsed.options.positionals.get(offset).ok_or_else(|| {
                        CliError::invalid("dep remove requires a prerequisite work identifier")
                    })?);
                data["dependent_id"] =
                    json!(parsed.options.positionals.get(offset + 1).ok_or_else(|| {
                        CliError::invalid("dep remove requires a dependent work identifier")
                    })?);
                data["expected_revision"] = parsed
                    .options
                    .expected_revision
                    .map_or(Value::Null, |value| json!(value));
            }
            ["work", "hold", "add"] => {
                let offset = usize::from(parsed.options.project.is_none());
                data["command"] = json!("work_hold_add");
                data["work_id"] =
                    json!(parsed.options.positionals.get(offset).ok_or_else(|| {
                        CliError::invalid("work hold add requires a work identifier")
                    })?);
                data["reason_code"] = json!(parsed
                    .options
                    .reason
                    .clone()
                    .ok_or_else(|| CliError::invalid("work hold add requires --reason"))?);
                data["expected_revision"] = parsed
                    .options
                    .expected_revision
                    .map_or(Value::Null, |value| json!(value));
            }
            ["work", "hold", "resolve"] => {
                let offset = usize::from(parsed.options.project.is_none());
                data["command"] = json!("work_hold_resolve");
                data["work_id"] =
                    json!(parsed.options.positionals.get(offset).ok_or_else(|| {
                        CliError::invalid("work hold resolve requires a work identifier")
                    })?);
                data["hold_id"] =
                    json!(parsed.options.positionals.get(offset + 1).ok_or_else(|| {
                        CliError::invalid("work hold resolve requires a hold identifier")
                    })?);
                data["resolution_reason"] = json!(parsed
                    .options
                    .reason
                    .clone()
                    .ok_or_else(|| CliError::invalid("work hold resolve requires --reason"))?);
                data["expected_revision"] = parsed
                    .options
                    .expected_revision
                    .map_or(Value::Null, |value| json!(value));
            }
            ["work", "dispatch", "set"] => {
                let offset = usize::from(parsed.options.project.is_none());
                data["command"] = json!("work_dispatch_set");
                data["work_id"] =
                    json!(parsed.options.positionals.get(offset).ok_or_else(|| {
                        CliError::invalid("work dispatch set requires a work identifier")
                    })?);
                data["dispatch_policy"] = json!(parsed
                    .options
                    .dispatch
                    .clone()
                    .ok_or_else(|| CliError::invalid("work dispatch set requires --dispatch"))?);
                data["expected_revision"] = parsed
                    .options
                    .expected_revision
                    .map_or(Value::Null, |value| json!(value));
            }
            ["dep", "tree"] | ["dep", "cycles"] => {
                data["command"] = json!(if path[1] == "tree" {
                    "dependency_tree"
                } else {
                    "dependency_cycles"
                });
            }
            ["cycle", "board"] | ["cycle", "report"] => {
                let cycle_index = usize::from(parsed.options.project.is_none());
                data["command"] = json!(if path[1] == "board" {
                    "cycle_board"
                } else {
                    "cycle_report"
                });
                data["cycle_id"] =
                    json!(parsed.options.positionals.get(cycle_index).ok_or_else(|| {
                        CliError::invalid("cycle board/report requires a cycle id")
                    })?);
            }
            ["intake", "list"] | ["intake", "show"] => {
                let intake_index = usize::from(parsed.options.project.is_none());
                data["command"] = json!("intake_read");
                if path[1] == "show" {
                    data["intake_id"] = json!(parsed
                        .options
                        .positionals
                        .get(intake_index)
                        .ok_or_else(|| CliError::invalid("intake show requires an intake id"))?);
                }
            }
            ["intake", "bucket"] => {
                let intake_index = usize::from(parsed.options.project.is_none());
                data["command"] = json!("intake_bucket");
                data["bucket_id"] = json!(parsed
                    .options
                    .positionals
                    .get(intake_index)
                    .ok_or_else(|| CliError::invalid("intake bucket requires a bucket id"))?);
                data["name"] = json!(parsed
                    .options
                    .positionals
                    .get(intake_index + 1)
                    .ok_or_else(|| CliError::invalid("intake bucket requires a bucket name"))?);
            }
            ["intake", "capture"] => {
                let intake_index = usize::from(parsed.options.project.is_none());
                data["command"] = json!("intake_capture");
                data["intake_id"] = json!(parsed
                    .options
                    .positionals
                    .get(intake_index)
                    .ok_or_else(|| CliError::invalid("intake capture requires an intake id"))?);
                data["content"] = json!(parsed
                    .options
                    .positionals
                    .get(intake_index + 1)
                    .ok_or_else(|| CliError::invalid("intake capture requires content"))?);
                data["bucket_id"] = json!(parsed
                    .options
                    .bucket
                    .clone()
                    .ok_or_else(|| CliError::invalid("intake capture requires --bucket"))?);
                data["kind"] = json!(parsed.options.kind.as_deref().unwrap_or("note"));
            }
            ["doctor"] => {
                data["command"] = json!("doctor");
            }
            ["work", "claim"] => {
                data["command"] = json!("claim");
                data["work_id"] = json!(work_argument(parsed, 1)?);
                data["attempt_id"] = json!(parsed
                    .options
                    .attempt
                    .clone()
                    .unwrap_or_else(|| attempt_id_for(operation)));
                data["lease_ttl_ms"] = parsed
                    .options
                    .lease_ttl_ms
                    .map_or(Value::Null, |value| json!(value));
                data["hard_time_limit_ms"] = parsed
                    .options
                    .time_limit_ms
                    .map_or(Value::Null, |value| json!(value));
                data["source_version_id"] = parsed
                    .options
                    .source_version
                    .clone()
                    .map_or(Value::Null, Value::String);
                data["config_identity"] = json!(parsed
                    .options
                    .config_identity
                    .as_deref()
                    .unwrap_or("unknown"));
                data["expected_revision"] = parsed
                    .options
                    .expected_revision
                    .map_or(Value::Null, |value| json!(value));
            }
            ["work", "accept"]
            | ["work", "heartbeat"]
            | ["work", "renew"]
            | ["work", "release"]
            | ["work", "finish"] => {
                let work_index = if parsed.options.project.is_none() {
                    1
                } else {
                    0
                };
                data["work_id"] = json!(work_argument(parsed, work_index)?);
                data["attempt_id"] = json!(parsed
                    .options
                    .attempt
                    .clone()
                    .ok_or_else(|| CliError::invalid("fenced mutation requires --attempt"))?);
                data["fence"] = json!(parsed
                    .options
                    .fence
                    .ok_or_else(|| CliError::invalid("fenced mutation requires --fence"))?);
                data["expected_revision"] = parsed
                    .options
                    .expected_revision
                    .map_or(Value::Null, |value| json!(value));
                data["lease_ttl_ms"] = parsed
                    .options
                    .lease_ttl_ms
                    .map_or(Value::Null, |value| json!(value));
                data["command"] = json!(match path.as_slice() {
                    ["work", "accept"] => "accept",
                    ["work", "heartbeat"] => "heartbeat",
                    ["work", "renew"] => "renew",
                    ["work", "release"] => "release",
                    ["work", "finish"] => "submit",
                    _ => unreachable!(),
                });
                data["reason"] = parsed
                    .options
                    .reason
                    .clone()
                    .map_or(Value::Null, Value::String);
            }
            ["agent", "heartbeat"] | ["agent", "renew"] => {
                data["work_id"] = json!(parsed
                    .options
                    .work
                    .clone()
                    .ok_or_else(|| CliError::invalid("agent lifecycle route requires --work"))?);
                data["attempt_id"] = json!(parsed
                    .options
                    .attempt
                    .clone()
                    .ok_or_else(|| CliError::invalid("fenced mutation requires --attempt"))?);
                data["fence"] = json!(parsed
                    .options
                    .fence
                    .ok_or_else(|| CliError::invalid("fenced mutation requires --fence"))?);
                data["expected_revision"] = parsed
                    .options
                    .expected_revision
                    .map_or(Value::Null, |value| json!(value));
                data["lease_ttl_ms"] = parsed
                    .options
                    .lease_ttl_ms
                    .map_or(Value::Null, |value| json!(value));
                data["command"] = json!(if path[1] == "heartbeat" {
                    "heartbeat"
                } else {
                    "renew"
                });
            }
            ["agent", "guide"] | ["agent", "resume"] | ["agent", "next"] | ["next"] => {
                data["command"] = json!(match path.as_slice() {
                    ["agent", "guide"] => "guide",
                    ["agent", "resume"] => "resume",
                    ["agent", "next"] | ["next"] => "next",
                    _ => unreachable!(),
                });
                data["work_id"] = parsed
                    .options
                    .work
                    .clone()
                    .map_or(Value::Null, Value::String);
                data["attempt_id"] = parsed
                    .options
                    .attempt
                    .clone()
                    .map_or(Value::Null, Value::String);
            }
            ["session", "start"] => {
                data["command"] = json!("session_start");
                data["expected_revision"] = parsed
                    .options
                    .expected_revision
                    .map_or(Value::Null, |value| json!(value));
            }
            ["session", "show"] => {
                data["command"] = json!("session_show");
            }
            ["session", "end"] => {
                data["command"] = json!("session_end");
                data["expected_revision"] = parsed
                    .options
                    .expected_revision
                    .map_or(Value::Null, |value| json!(value));
            }
            ["agent", "start"] => {
                data["command"] = json!("start");
                data["work_id"] = parsed
                    .options
                    .work
                    .clone()
                    .or_else(|| parsed.options.positionals.first().cloned())
                    .map_or(Value::Null, Value::String);
                data["attempt_id"] = parsed
                    .options
                    .attempt
                    .clone()
                    .map_or(Value::Null, Value::String);
                data["fence"] = parsed
                    .options
                    .fence
                    .map_or(Value::Null, |value| json!(value));
                data["lease_ttl_ms"] = parsed
                    .options
                    .lease_ttl_ms
                    .map_or(Value::Null, |value| json!(value));
                data["hard_time_limit_ms"] = parsed
                    .options
                    .time_limit_ms
                    .map_or(Value::Null, |value| json!(value));
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
                data["summary_body"] = json!(read_summary_body(parsed)?);
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
            ["operation", "show"] => {
                let operation_index = usize::from(parsed.options.project.is_none());
                data["command"] = json!("operation_show");
                data["target_operation_id"] = json!(parsed
                    .options
                    .positionals
                    .get(operation_index)
                    .ok_or_else(|| CliError::invalid("missing operation identifier"))?);
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

    /// Thread-safe production adapter for the bounded concurrent host.
    ///
    /// The handler contains only immutable connection metadata. A worker opens
    /// its own SQLite connection and then delegates to the same application
    /// handler used by the request-at-a-time tests and compatibility path.
    pub(super) struct ConcurrentServiceCommandHandler {
        database: PathBuf,
        gate_root: PathBuf,
    }

    impl ConcurrentApplicationCommandHandler for ConcurrentServiceCommandHandler {
        fn handle_concurrent(
            &self,
            request: ApplicationRequest,
        ) -> Result<ApplicationResponse, boreal_service::ProtocolError> {
            let store = SqliteStore::open(&self.database, SCHEMA).map_err(|error| {
                boreal_service::ProtocolError::new(
                    boreal_service::ProtocolErrorCode::InvalidPayload,
                    format!("service database is unavailable: {error}"),
                )
            })?;
            ServiceCommandHandler {
                store,
                gate_root: self.gate_root.clone(),
            }
            .handle(request)
        }
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

    type ServicePayload = (ApplicationOutcome, Option<u64>, Option<Value>);
    type ServiceResult = Result<ServicePayload, CliError>;

    #[derive(Debug, Deserialize)]
    #[serde(deny_unknown_fields)]
    struct CreateProjectRequest {
        command: String,
        #[serde(default)]
        project_id: Option<String>,
        name: String,
        #[serde(default)]
        description: String,
        actor_id: String,
        #[serde(default = "default_actor_role")]
        actor_role: String,
        #[serde(default = "default_credential_ref")]
        credential_ref: String,
        #[serde(default, rename = "harness_id")]
        _harness_id: Option<String>,
        #[serde(default, rename = "session_id")]
        _session_id: Option<String>,
        #[serde(default, rename = "expected_revision")]
        _expected_revision: Option<u64>,
        #[serde(default, rename = "operation_id")]
        _operation_id: Option<String>,
    }

    #[derive(Debug, Deserialize)]
    #[serde(deny_unknown_fields)]
    struct CreateWorkRequest {
        command: String,
        project_id: String,
        #[serde(default)]
        work_id: Option<String>,
        kind: String,
        #[serde(default)]
        parent_id: Option<String>,
        title: String,
        #[serde(default)]
        description: String,
        #[serde(default)]
        priority: u8,
        #[serde(default = "default_dispatch", alias = "dispatch_policy")]
        dispatch: String,
        #[serde(default)]
        hold: Option<String>,
        #[serde(
            default = "default_profile",
            alias = "acceptance_profile",
            alias = "profile_id"
        )]
        profile: String,
        actor_id: String,
        #[serde(default, rename = "harness_id")]
        _harness_id: Option<String>,
        #[serde(default, rename = "session_id")]
        _session_id: Option<String>,
        #[serde(default, rename = "expected_revision")]
        _expected_revision: Option<u64>,
        #[serde(default, rename = "operation_id")]
        _operation_id: Option<String>,
    }

    #[derive(Debug, Deserialize)]
    #[serde(deny_unknown_fields)]
    struct DependencyAddRequest {
        command: String,
        project_id: String,
        prerequisite_id: String,
        dependent_id: String,
        actor_id: String,
        #[serde(default)]
        expected_revision: Option<u64>,
        #[serde(default, rename = "harness_id")]
        _harness_id: Option<String>,
        #[serde(default, rename = "session_id")]
        _session_id: Option<String>,
        #[serde(default, rename = "operation_id")]
        _operation_id: Option<String>,
    }

    fn default_actor_role() -> String {
        "agent".to_owned()
    }

    fn default_credential_ref() -> String {
        "service".to_owned()
    }

    fn default_dispatch() -> String {
        "automatic".to_owned()
    }

    fn default_profile() -> String {
        "focused".to_owned()
    }

    impl ServiceCommandHandler {
        fn dispatch(&mut self, request: &ApplicationRequest, data: &Value) -> ServiceResult {
            match request.command.as_str() {
                "create_project" => self.create_project(data, &request.operation_id),
                "create_work" => self.create_work(data, &request.operation_id),
                "work_edit" => self.work_edit(data, &request.operation_id),
                "dependency_remove" => self.dependency_remove(data, &request.operation_id),
                "work_hold_add" => self.work_hold_add(data, &request.operation_id),
                "work_hold_resolve" => self.work_hold_resolve(data, &request.operation_id),
                "work_dispatch_set" => self.work_dispatch_set(data, &request.operation_id),
                "dependency_add" => self.dependency_add(data, &request.operation_id),
                "dependency_tree" | "dependency_cycles" => {
                    self.dependency_graph(data, request.command.as_str())
                }
                "cycle_board" | "cycle_report" => self.cycle_board(data),
                "intake_list" | "intake_show" => self.intake_read(data),
                "intake_bucket" => self.intake_bucket(data, &request.operation_id),
                "intake_capture" => self.intake_capture(data, &request.operation_id),
                "doctor" => self.doctor(data),
                "status" => self.status(data),
                "claim" => self.claim(data, &request.operation_id),
                "start" => self.start(data, &request.operation_id),
                "guide" => self.guidance(data, "guide"),
                "resume" => self.guidance(data, "resume"),
                "next" => self.guidance(data, "next"),
                "accept" => self.attempt_transition(
                    data,
                    &request.operation_id,
                    super::super::AttemptOperation::Accept,
                ),
                "heartbeat" => self.attempt_transition(
                    data,
                    &request.operation_id,
                    super::super::AttemptOperation::Heartbeat,
                ),
                "renew" => self.attempt_transition(
                    data,
                    &request.operation_id,
                    super::super::AttemptOperation::Renew,
                ),
                "submit" => self.attempt_transition(
                    data,
                    &request.operation_id,
                    super::super::AttemptOperation::Submit,
                ),
                "release" => self.release(data, &request.operation_id),
                "finish_close" => self.finish_close(data, &request.operation_id),
                "evidence_add" => self.evidence_add(data),
                "evidence_run" => self.evidence_run(data, &request.operation_id),
                "operation_show" => self.operation_show(data),
                "session_start" => self.session_start(data, &request.operation_id),
                "session_show" => self.session_show(data),
                "session_end" => self.session_end(data, &request.operation_id),
                command => Err(CliError::with(
                    ErrorCode::UnknownCommandNamespace,
                    ApplicationOutcome::Rejected,
                    format!("service does not implement command {command:?}"),
                )),
            }
        }

        pub(super) fn create_project(&mut self, data: &Value, operation: &str) -> ServiceResult {
            let request: CreateProjectRequest = serde_json::from_value(data.clone())
                .map_err(|error| invalid_service_dto("create_project", error))?;
            if request.command != "create_project" {
                return Err(CliError::invalid(
                    "create_project request command does not match its route",
                ));
            }
            let name = required_trimmed(request.name, "name")?;
            let actor = required_trimmed(request.actor_id, "actor_id")?;
            let actor_role = parse_actor_role(&request.actor_role)?;
            let credential_ref = required_trimmed(request.credential_ref, "credential_ref")?;
            let project_id = match request.project_id {
                Some(project_id) => required_trimmed(project_id, "project_id")?,
                None => generated_subject_id("project", operation),
            };
            let result = WorkApplication::new(&self.store)
                .init_project(
                    &ProjectId::new(project_id.clone()),
                    &actor,
                    actor_role,
                    &credential_ref,
                    &name,
                    &now(),
                    operation,
                )
                .map_err(map_application_error)?;
            Ok((
                if result.changed {
                    ApplicationOutcome::Changed
                } else {
                    ApplicationOutcome::Unchanged
                },
                Some(result.snapshot_revision),
                Some(json!({
                    "project_id": project_id,
                    "name": name,
                    "description": request.description,
                    "replayed": !result.changed,
                })),
            ))
        }

        pub(super) fn create_work(&mut self, data: &Value, operation: &str) -> ServiceResult {
            let request: CreateWorkRequest = serde_json::from_value(data.clone())
                .map_err(|error| invalid_service_dto("create_work", error))?;
            if request.command != "create_work" {
                return Err(CliError::invalid(
                    "create_work request command does not match its route",
                ));
            }
            let project_id = required_trimmed(request.project_id, "project_id")?;
            let actor_id = required_trimmed(request.actor_id, "actor_id")?;
            let title = required_trimmed(request.title, "title")?;
            let work_id = match request.work_id {
                Some(work_id) => required_trimmed(work_id, "work_id")?,
                None => generated_subject_id("work", operation),
            };
            let kind = parse_work_kind(&request.kind)?;
            let dispatch_policy = parse_dispatch_policy(&request.dispatch)?;
            let acceptance_profile = parse_acceptance_profile(&request.profile)?;
            let parent_id = request
                .parent_id
                .map(|parent_id| required_trimmed(parent_id, "parent_id"))
                .transpose()?
                .map(WorkId::new);
            let work = WorkItem {
                id: WorkId::new(work_id.clone()),
                project_id: ProjectId::new(project_id.clone()),
                kind,
                parent_id,
                title,
                description: request.description,
                lifecycle: PersistedLifecycle::Open,
                priority: request.priority,
                dispatch_policy,
                hard_holds: request.hold.into_iter().map(ReasonCode::HardHold).collect(),
                acceptance_profile,
            };
            let result = WorkApplication::new(&self.store)
                .create_work_as(&work, &actor_id, &now(), operation)
                .map_err(map_application_error)?;
            Ok((
                if result.changed {
                    ApplicationOutcome::Changed
                } else {
                    ApplicationOutcome::Unchanged
                },
                Some(result.snapshot_revision),
                Some(json!({
                    "project_id": result.value.project_id,
                    "work_id": result.value.work_id,
                    "kind": result.value.kind,
                    "parent_id": result.value.parent_id,
                    "title": result.value.title,
                    "description": result.value.description,
                    "priority": result.value.priority,
                    "dispatch_policy": result.value.dispatch_policy,
                    "profile": {
                        "id": work.acceptance_profile.id.as_str(),
                        "version": work.acceptance_profile.version,
                    },
                    "replayed": !result.changed,
                })),
            ))
        }

        fn work_edit(&mut self, data: &Value, operation: &str) -> ServiceResult {
            let project = ProjectId::new(string(data, "project_id")?);
            let work_id = string(data, "work_id")?;
            let result = WorkApplication::new(&self.store)
                .edit_work_as(
                    &project,
                    &work_id,
                    &string(data, "actor_id")?,
                    optional_string(data, "parent_id")?.map(Some),
                    optional_string(data, "title")?,
                    optional_string(data, "description")?,
                    optional_u64(data, "priority")?.map(|value| value as u8),
                    optional_string(data, "dispatch_policy")?,
                    optional_u64(data, "expected_revision")?,
                    &now(),
                    operation.to_owned(),
                )
                .map_err(map_application_error)?;
            Ok((
                if result.changed {
                    ApplicationOutcome::Changed
                } else {
                    ApplicationOutcome::Unchanged
                },
                Some(result.snapshot_revision),
                Some(json!({
                    "command": "work_edit",
                    "project_id": project.as_str(),
                    "work_id": result.value.work_id,
                    "title": result.value.title,
                    "description": result.value.description,
                    "priority": result.value.priority,
                    "dispatch_policy": result.value.dispatch_policy,
                    "replayed": !result.changed,
                })),
            ))
        }

        fn dependency_remove(&mut self, data: &Value, operation: &str) -> ServiceResult {
            let project = ProjectId::new(string(data, "project_id")?);
            let result = WorkApplication::new(&self.store)
                .remove_dependency_as(
                    &project,
                    &string(data, "prerequisite_id")?,
                    &string(data, "dependent_id")?,
                    &string(data, "actor_id")?,
                    optional_u64(data, "expected_revision")?,
                    &now(),
                    operation.to_owned(),
                )
                .map_err(map_application_error)?;
            Ok((
                if result.changed {
                    ApplicationOutcome::Changed
                } else {
                    ApplicationOutcome::Unchanged
                },
                Some(result.snapshot_revision),
                Some(
                    json!({"command": "dependency_remove", "project_id": project.as_str(), "replayed": !result.changed}),
                ),
            ))
        }

        fn work_hold_add(&mut self, data: &Value, operation: &str) -> ServiceResult {
            let project = ProjectId::new(string(data, "project_id")?);
            let work_id = string(data, "work_id")?;
            let result = WorkApplication::new(&self.store)
                .add_work_hold_as(
                    &project,
                    &work_id,
                    &string(data, "reason_code")?,
                    &string(data, "actor_id")?,
                    optional_u64(data, "expected_revision")?,
                    &now(),
                    operation.to_owned(),
                )
                .map_err(map_application_error)?;
            Ok((
                if result.changed {
                    ApplicationOutcome::Changed
                } else {
                    ApplicationOutcome::Unchanged
                },
                Some(result.snapshot_revision),
                Some(
                    json!({"command": "work_hold_add", "project_id": project.as_str(), "work_id": work_id, "hard_holds": result.value.hard_holds.iter().map(ReasonCode::stable_code).collect::<Vec<_>>(), "replayed": !result.changed}),
                ),
            ))
        }

        fn work_hold_resolve(&mut self, data: &Value, operation: &str) -> ServiceResult {
            let project = ProjectId::new(string(data, "project_id")?);
            let work_id = string(data, "work_id")?;
            let result = WorkApplication::new(&self.store)
                .resolve_work_hold_as(
                    &project,
                    &work_id,
                    &string(data, "hold_id")?,
                    &string(data, "resolution_reason")?,
                    &string(data, "actor_id")?,
                    optional_u64(data, "expected_revision")?,
                    &now(),
                    operation.to_owned(),
                )
                .map_err(map_application_error)?;
            Ok((
                if result.changed {
                    ApplicationOutcome::Changed
                } else {
                    ApplicationOutcome::Unchanged
                },
                Some(result.snapshot_revision),
                Some(
                    json!({"command": "work_hold_resolve", "project_id": project.as_str(), "work_id": work_id, "hard_holds": result.value.hard_holds.iter().map(ReasonCode::stable_code).collect::<Vec<_>>(), "replayed": !result.changed}),
                ),
            ))
        }

        fn work_dispatch_set(&mut self, data: &Value, operation: &str) -> ServiceResult {
            let project = ProjectId::new(string(data, "project_id")?);
            let work_id = string(data, "work_id")?;
            let result = WorkApplication::new(&self.store)
                .edit_work_as(
                    &project,
                    &work_id,
                    &string(data, "actor_id")?,
                    None,
                    None,
                    None,
                    None,
                    Some(string(data, "dispatch_policy")?),
                    optional_u64(data, "expected_revision")?,
                    &now(),
                    operation.to_owned(),
                )
                .map_err(map_application_error)?;
            Ok((
                if result.changed {
                    ApplicationOutcome::Changed
                } else {
                    ApplicationOutcome::Unchanged
                },
                Some(result.snapshot_revision),
                Some(
                    json!({"command": "work_dispatch_set", "project_id": project.as_str(), "work_id": work_id, "dispatch_policy": result.value.dispatch_policy, "replayed": !result.changed}),
                ),
            ))
        }

        fn dependency_add(&mut self, data: &Value, operation: &str) -> ServiceResult {
            let request: DependencyAddRequest = serde_json::from_value(data.clone())
                .map_err(|error| invalid_service_dto("dependency_add", error))?;
            if request.command != "dependency_add" {
                return Err(CliError::invalid(
                    "dependency_add request command does not match its route",
                ));
            }
            let project = ProjectId::new(required_trimmed(request.project_id, "project_id")?);
            let prerequisite_id = required_trimmed(request.prerequisite_id, "prerequisite_id")?;
            let dependent_id = required_trimmed(request.dependent_id, "dependent_id")?;
            let actor_id = required_trimmed(request.actor_id, "actor_id")?;
            let result = WorkApplication::new(&self.store)
                .add_dependency_as_checked(
                    &project,
                    &prerequisite_id,
                    &dependent_id,
                    &actor_id,
                    request.expected_revision,
                    &now(),
                    operation,
                )
                .map_err(map_dependency_error)?;
            Ok((
                if result.changed {
                    ApplicationOutcome::Changed
                } else {
                    ApplicationOutcome::Unchanged
                },
                Some(result.snapshot_revision),
                Some(json!({
                    "project_id": project.as_str(),
                    "prerequisite_id": prerequisite_id,
                    "dependent_id": dependent_id,
                    "satisfaction_policy": "closed_only",
                    "replayed": !result.changed,
                })),
            ))
        }

        fn dependency_graph(&mut self, data: &Value, command: &str) -> ServiceResult {
            let project = ProjectId::new(string(data, "project_id")?);
            let graph = WorkApplication::new(&self.store)
                .dependency_graph(&project)
                .map_err(map_application_error)?;
            let edges = graph
                .edges
                .iter()
                .map(|edge| {
                    json!({
                        "prerequisite_id": edge.prerequisite_id,
                        "dependent_id": edge.dependent_id,
                    })
                })
                .collect::<Vec<_>>();
            let cycles = graph
                .cycles
                .iter()
                .map(|cycle| json!(cycle))
                .collect::<Vec<_>>();
            Ok((
                ApplicationOutcome::Unchanged,
                Some(graph.revision),
                Some(json!({
                    "command": command,
                    "project_id": graph.project_id.as_str(),
                    "revision": graph.revision,
                    "edges": edges,
                    "cycles": cycles,
                    "cycle_count": graph.cycles.len(),
                })),
            ))
        }

        fn cycle_board(&mut self, data: &Value) -> ServiceResult {
            let project = ProjectId::new(string(data, "project_id")?);
            let cycle_id = string(data, "cycle_id")?;
            let board = WorkApplication::new(&self.store)
                .cycle_board_v3(&project, &cycle_id)
                .map_err(map_application_error)?;
            let assignments = board
                .assignments
                .iter()
                .map(|item| {
                    json!({
                        "assignment_id": item.assignment.assignment_id,
                        "work_id": item.assignment.work_id,
                        "state": item.assignment.state,
                        "activation_policy": item.assignment.activation_policy,
                        "activation_at_utc_ms": item.assignment.activation_at_utc_ms,
                        "work_title": item.work_title,
                        "work_kind": item.work_kind,
                        "work_lifecycle": item.work_lifecycle,
                    })
                })
                .collect::<Vec<_>>();
            Ok((
                ApplicationOutcome::Unchanged,
                Some(board.revision),
                Some(json!({
                    "command": "cycle_board",
                    "project_id": board.project_id.as_str(),
                    "revision": board.revision,
                    "cycle": {
                        "cycle_id": board.cycle.cycle_id,
                        "series_id": board.cycle.series_id,
                        "template_version_id": board.cycle.template_version_id,
                        "slot_ordinal": board.cycle.slot_ordinal,
                        "name": board.cycle.name,
                        "goal": board.cycle.goal,
                        "lifecycle": board.cycle.lifecycle,
                        "scheduled_start_utc_ms": board.cycle.scheduled_start_utc_ms,
                        "scheduled_end_utc_ms": board.cycle.scheduled_end_utc_ms,
                        "scheduled_start_local": board.cycle.scheduled_start_local,
                        "timezone": board.cycle.timezone,
                        "tzdb_identity": board.cycle.tzdb_identity,
                    },
                    "assignments": assignments,
                })),
            ))
        }

        fn intake_read(&mut self, data: &Value) -> ServiceResult {
            let project = ProjectId::new(string(data, "project_id")?);
            let view = WorkApplication::new(&self.store)
                .intake_items_v3(&project)
                .map_err(map_application_error)?;
            let item_id = optional_string(data, "intake_id")?;
            let items = view
                .items
                .iter()
                .filter(|item| item_id.as_deref().is_none_or(|id| id == item.intake_id))
                .map(super::super::intake_item_json)
                .collect::<Vec<_>>();
            if item_id.is_some() && items.is_empty() {
                return Err(CliError::with(
                    ErrorCode::NotFound,
                    ApplicationOutcome::Rejected,
                    "intake item was not found",
                ));
            }
            Ok((
                ApplicationOutcome::Unchanged,
                Some(view.revision),
                Some(json!({
                    "command": "intake_read",
                    "project_id": view.project_id.as_str(),
                    "revision": view.revision,
                    "items": items,
                    "total": view.items.len(),
                })),
            ))
        }

        fn intake_bucket(&mut self, data: &Value, operation: &str) -> ServiceResult {
            let project = ProjectId::new(string(data, "project_id")?);
            let bucket_id = IntakeBucketId::new(string(data, "bucket_id")?);
            let name = string(data, "name")?;
            let actor = string(data, "actor_id")?;
            let session = string(data, "session_id")?;
            let app = WorkApplication::new(&self.store);
            app.ensure_work_model_v3().map_err(map_application_error)?;
            let bucket = IntakeBucket {
                id: bucket_id.clone(),
                project_id: project.clone(),
                name: name.clone(),
                archived: false,
            };
            let revision = app
                .intake_items_v3(&project)
                .map_err(map_application_error)?
                .revision;
            let scope = boreal_application::PlanningScope::new(project.clone(), actor)
                .with_session(session)
                .at_revision(revision);
            let result = app
                .create_intake_bucket_v3(&scope, operation.to_owned(), &bucket, &now())
                .map_err(map_application_error)?;
            Ok((
                if result.changed {
                    ApplicationOutcome::Changed
                } else {
                    ApplicationOutcome::Unchanged
                },
                Some(result.snapshot_revision),
                Some(json!({
                    "command": "intake_bucket",
                    "project_id": project.as_str(),
                    "bucket_id": bucket_id.as_str(),
                    "name": name,
                    "archived": false,
                    "replayed": !result.changed,
                })),
            ))
        }

        fn intake_capture(&mut self, data: &Value, operation: &str) -> ServiceResult {
            let project = ProjectId::new(string(data, "project_id")?);
            let intake_id = IntakeItemId::new(string(data, "intake_id")?);
            let bucket_id = IntakeBucketId::new(string(data, "bucket_id")?);
            let content = string(data, "content")?;
            let kind = parse_intake_kind(&string(data, "kind")?)?;
            let actor = string(data, "actor_id")?;
            let session = string(data, "session_id")?;
            let app = WorkApplication::new(&self.store);
            app.ensure_work_model_v3().map_err(map_application_error)?;
            let captured_at = now();
            let item = IntakeItem {
                id: intake_id.clone(),
                bucket_id: bucket_id.clone(),
                project_id: project.clone(),
                kind,
                lifecycle: IntakeLifecycle::Captured,
                content: content.clone(),
                content_revision: 1,
                content_digest: sha256_content_digest(content.as_bytes()),
                revisit_at: None,
            };
            let revision = app
                .intake_items_v3(&project)
                .map_err(map_application_error)?
                .revision;
            let scope = boreal_application::PlanningScope::new(project.clone(), actor)
                .with_session(session)
                .at_revision(revision);
            let result = app
                .create_intake_item_v3(
                    &scope,
                    operation.to_owned(),
                    &item,
                    &captured_at,
                    &captured_at,
                )
                .map_err(map_application_error)?;
            Ok((
                if result.changed {
                    ApplicationOutcome::Changed
                } else {
                    ApplicationOutcome::Unchanged
                },
                Some(result.snapshot_revision),
                Some(json!({
                    "command": "intake_capture",
                    "project_id": project.as_str(),
                    "intake_id": intake_id.as_str(),
                    "bucket_id": bucket_id.as_str(),
                    "kind": format!("{kind:?}").to_ascii_lowercase(),
                    "lifecycle": "captured",
                    "content_revision": 1,
                    "content_digest": item.content_digest,
                    "replayed": !result.changed,
                })),
            ))
        }

        fn doctor(&mut self, data: &Value) -> ServiceResult {
            let project = optional_string(data, "project_id")?;
            let schema_version = self.store.schema_version().map_err(map_store_error)?;
            let v3_enabled = self
                .store
                .work_model_v3_enabled()
                .map_err(map_store_error)?;
            let revision = project
                .as_deref()
                .map(|project| {
                    self.store
                        .project_revision(project)
                        .map(|revision| revision.0)
                })
                .transpose()
                .map_err(map_store_error)?;
            Ok((
                ApplicationOutcome::Unchanged,
                revision,
                Some(json!({
                    "project_id": project,
                    "checks": {
                        "database_open": "pass",
                        "schema_version": schema_version,
                        "work_model_v3": if v3_enabled { "enabled" } else { "not_enabled" },
                        "sqlite_runtime": self.store.sqlite_runtime_identity().as_json(),
                    },
                    "repair": {
                        "available": false,
                        "reason": "doctor is read-only in the CLI adapter"
                    }
                })),
            ))
        }

        fn guidance(&mut self, data: &Value, route: &str) -> ServiceResult {
            let parsed = parsed_context_command(data, route)?;
            let app = WorkApplication::new(&self.store);
            let result = match route {
                "guide" => super::super::guide_result(&parsed, &app, &self.store),
                "resume" => super::super::resume_result(&parsed, &app, &self.store),
                "next" => super::super::next_result(&parsed, &app, &self.store),
                _ => unreachable!("service guidance route is validated before dispatch"),
            }?;
            Ok((result.outcome, result.revision, result.data))
        }

        fn attempt_transition(
            &mut self,
            data: &Value,
            operation: &str,
            kind: super::super::AttemptOperation,
        ) -> ServiceResult {
            let parsed = parsed_attempt_command(data, kind)?;
            let app = WorkApplication::new(&self.store);
            let adapter = SqliteAttemptAdapter::new(&self.store);
            let result = super::super::attempt_mutation_result(
                &parsed,
                &app,
                &adapter,
                operation,
                &self.store,
                kind,
            )?;
            Ok((result.outcome, result.revision, result.data))
        }

        fn session_start(&mut self, data: &Value, operation: &str) -> ServiceResult {
            let parsed = parsed_context_command(data, "session_start")?;
            let result = super::super::session_start_result(
                &parsed,
                &WorkApplication::new(&self.store),
                operation,
            )?;
            Ok((result.outcome, result.revision, result.data))
        }

        fn session_show(&mut self, data: &Value) -> ServiceResult {
            let parsed = parsed_context_command(data, "session_show")?;
            let result =
                super::super::session_show_result(&parsed, &WorkApplication::new(&self.store))?;
            Ok((result.outcome, result.revision, result.data))
        }

        fn session_end(&mut self, data: &Value, operation: &str) -> ServiceResult {
            let parsed = parsed_context_command(data, "session_end")?;
            let result = super::super::session_end_result(
                &parsed,
                &WorkApplication::new(&self.store),
                operation,
            )?;
            Ok((result.outcome, result.revision, result.data))
        }

        fn status(&self, data: &Value) -> ServiceResult {
            let project = ProjectId::new(string(data, "project_id")?);
            let actor = ActorContext {
                actor_id: ActorId::new(string(data, "actor_id")?),
                role: ActorRole::Agent,
            };
            let limit = optional_u64(data, "limit")?.unwrap_or(100);
            let offset = optional_u64(data, "offset")?.unwrap_or(0);
            let as_of = TimestampMs::from_millis(now_ms_u64());
            let snapshot =
                project_status_from_store(&self.store, &project, &actor, as_of, limit, offset)
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
            // Absolute client clocks are deliberately ignored. The service
            // owns the admission instant and derives both deadlines from
            // bounded duration inputs under the shared attempt policy.
            let claimed_at = TimestampMs::from_millis(now_ms_u64());
            let lease_ttl_ms = optional_u64(data, "lease_ttl_ms")?;
            let hard_time_limit_ms =
                optional_duration(data, "hard_time_limit_ms", "time_limit_ms")?;
            let deadlines = AttemptPolicy::default()
                .deadlines(claimed_at, lease_ttl_ms, hard_time_limit_ms)
                .map_err(|error| map_application_error(ApplicationError::from(error)))?;
            let claim_digest = claim_request_digest(
                data,
                &project,
                &work_id,
                &actor,
                &harness,
                &session,
                lease_ttl_ms,
                hard_time_limit_ms,
            )?;
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
                .claim_with_context(
                    &project,
                    &work_id,
                    &actor,
                    &harness,
                    Some(&session),
                    &string(data, "attempt_id")?,
                    operation,
                    &claim_digest,
                    registered_revision,
                    &stamp(claimed_at.as_millis()),
                    &stamp(deadlines.lease_deadline.as_millis()),
                    &stamp(deadlines.hard_deadline.as_millis()),
                    optional_string(data, "source_version_id")?.as_deref(),
                    data.get("config_identity")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown"),
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
            let actor = string(data, "actor_id")?;
            let harness = string(data, "harness_id")?;
            let session = string(data, "session_id")?;
            let requested_work_id = optional_string(data, "work_id")?;
            let requested_attempt_id = optional_string(data, "attempt_id")?;
            let requested_fence = request_fence(data)?;
            let stored_work_id = self
                .store
                .operation(operation)
                .map_err(map_store_error)?
                .and_then(|record| {
                    serde_json::from_str::<Value>(&record.result_json)
                        .ok()
                        .and_then(|value| {
                            value
                                .get("work_id")
                                .and_then(Value::as_str)
                                .map(str::to_owned)
                        })
                });
            let Some(work_id) = requested_work_id
                .clone()
                .or_else(|| {
                    self.store
                        .current_attempt_for_session(project.as_str(), &session)
                        .ok()
                        .flatten()
                        .filter(|attempt| {
                            attempt.actor_id == actor
                                && attempt.harness_id.as_deref() == Some(harness.as_str())
                        })
                        .map(|attempt| attempt.work_id)
                })
                .or(stored_work_id)
                .or(select_claimable_work(&self.store, &project, &actor)?)
            else {
                return Ok((
                    ApplicationOutcome::Unchanged,
                    Some(
                        self.store
                            .project_revision(project.as_str())
                            .map_err(map_store_error)?
                            .0,
                    ),
                    Some(json!({
                        "phase": "idle",
                        "reason": "no_ready_work",
                        "message": "no resumable or claimable task is available",
                        "next_action": null,
                    })),
                ));
            };
            let request_digest = start_request_digest(
                data,
                &project,
                requested_work_id.as_deref().unwrap_or("<auto>"),
                &actor,
                &harness,
                &session,
                requested_attempt_id.as_deref(),
                requested_fence,
            )?;
            if let Some(replayed) = self.replay_start_operation(
                operation,
                &project,
                &work_id,
                &actor,
                &session,
                requested_attempt_id.as_deref(),
                &request_digest,
            )? {
                return Ok(replayed);
            }
            let outer_started_at = now();
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
                if requested_attempt_id
                    .as_deref()
                    .is_some_and(|attempt_id| current.attempt_id != attempt_id)
                {
                    return Err(CliError::with(
                        ErrorCode::AttemptConflict,
                        ApplicationOutcome::Conflict,
                        "the requested attempt does not match the current attempt",
                    ));
                }
                if requested_fence.is_some_and(|fence| fence != current.fence) {
                    return Err(CliError::with(
                        ErrorCode::StaleFence,
                        ApplicationOutcome::Conflict,
                        "the requested fence does not match the current attempt",
                    ));
                }
                (current.attempt_id, current.fence)
            } else {
                let claim_operation = sub_operation(operation, "claim");
                let mut claim_data = data.clone();
                claim_data["work_id"] = json!(work_id);
                claim_data["attempt_id"] = json!(requested_attempt_id
                    .clone()
                    .unwrap_or_else(|| attempt_id_for(operation)));
                let (_, _, _) = self.claim(&claim_data, &claim_operation)?;
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
            let snapshot = adapter
                .current_attempt(&project, &attempt)
                .map_err(|error| map_application_error(ApplicationError::from(error)))?;
            let mut last = None;
            if snapshot.phase == AttemptPhase::Claimed {
                let accepted = app
                    .accept(
                        &adapter,
                        attempt_request_from_data(
                            data,
                            &project,
                            &work_id,
                            &attempt,
                            Fence::new(fence),
                            &sub_operation(operation, "accept"),
                        )?,
                    )
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
                            &sub_operation(operation, "start"),
                        )?,
                    )
                    .map_err(map_application_error)?;
                last = Some(started);
            }
            let current = adapter
                .current_attempt(&project, &attempt)
                .map_err(|error| map_application_error(ApplicationError::from(error)))?;
            let (outcome, revision) = if let Some(result) = last {
                (
                    if result.changed {
                        ApplicationOutcome::Changed
                    } else {
                        ApplicationOutcome::Unchanged
                    },
                    result.snapshot_revision,
                )
            } else if matches!(
                current.phase,
                AttemptPhase::Running | AttemptPhase::Verifying
            ) {
                (
                    ApplicationOutcome::Unchanged,
                    self.store
                        .project_revision(project.as_str())
                        .map_err(map_store_error)?
                        .0,
                )
            } else {
                return Err(CliError::with(
                    ErrorCode::AttemptConflict,
                    ApplicationOutcome::Conflict,
                    "attempt is not startable or resumable",
                ));
            };
            let result_data = start_result_json(&current, operation);
            self.store
                .append_operation(&OperationRecord {
                    operation_id: operation.to_owned(),
                    project_id: project.as_str().to_owned(),
                    command: "agent_start".to_owned(),
                    actor_id: actor,
                    session_id: Some(session),
                    expected_revision: optional_u64(data, "expected_revision")?,
                    attempt_id: Some(current.attempt_id.as_str().to_owned()),
                    fence: Some(current.fence.get()),
                    request_digest,
                    outcome: if outcome == ApplicationOutcome::Changed {
                        StoreOperationOutcome::Changed
                    } else {
                        StoreOperationOutcome::Unchanged
                    },
                    result_json: result_data.to_string(),
                    revision,
                    created_at: outer_started_at,
                    completed_at: Some(now()),
                })
                .map_err(map_store_error)?;
            Ok((outcome, Some(revision), Some(result_data)))
        }

        #[allow(clippy::too_many_arguments)]
        fn replay_start_operation(
            &self,
            operation: &str,
            project: &ProjectId,
            work_id: &str,
            actor: &str,
            session: &str,
            attempt_id: Option<&str>,
            request_digest: &str,
        ) -> Result<Option<ServicePayload>, CliError> {
            let Some(existing) = self.store.operation(operation).map_err(map_store_error)? else {
                return Ok(None);
            };
            if existing.command != "agent_start"
                || existing.project_id != project.as_str()
                || existing.actor_id != actor
                || existing.session_id.as_deref() != Some(session)
                || attempt_id
                    .is_some_and(|attempt_id| existing.attempt_id.as_deref() != Some(attempt_id))
                || existing.request_digest != request_digest
            {
                return Err(CliError::with(
                    ErrorCode::OperationConflict,
                    ApplicationOutcome::Conflict,
                    "start operation was already used with another command or request",
                ));
            }
            let mut result: Value =
                serde_json::from_str(&existing.result_json).map_err(|error| {
                    CliError::with(
                        ErrorCode::ProtocolMismatch,
                        ApplicationOutcome::Failed,
                        format!("stored start result is invalid: {error}"),
                    )
                })?;
            if result.get("work_id").and_then(Value::as_str) != Some(work_id) {
                return Err(CliError::with(
                    ErrorCode::ProtocolMismatch,
                    ApplicationOutcome::Failed,
                    "stored start result has the wrong work subject",
                ));
            }
            result["replayed"] = json!(true);
            Ok(Some((
                ApplicationOutcome::Unchanged,
                Some(existing.revision),
                Some(result),
            )))
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

        fn operation_show(&mut self, data: &Value) -> ServiceResult {
            let project = string(data, "project_id")?;
            let target_operation = string(data, "target_operation_id")?;
            let parsed = ParsedCommand {
                path: vec!["operation".to_owned(), "show".to_owned()],
                options: CliOptions {
                    positionals: vec![project, target_operation],
                    ..CliOptions::default()
                },
            };
            let result = super::super::operation_show_result(&parsed, &self.store)?;
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
            let receipt_replayed = if receipt.attestation == ExecutorAttestation::BorealWitnessed {
                self.validate_witnessed_receipt_readback(&project, &work_id, &receipt)?;
                true
            } else {
                app.record_receipt(
                    &actor,
                    Some(&session),
                    &receipt,
                    optional_u64(data, "expected_revision")?,
                    TimestampMs::from_millis(now_ms_u64()),
                )
                .map_err(map_application_error)?
                .replayed
            };
            let summary_body = string(data, "summary_body")?;
            if summary_body.is_empty()
                || summary_body.len() as u64 > boreal_store::MAX_SUMMARY_BODY_BYTES
            {
                return Err(CliError::invalid(
                    "finish_close summary_body must contain at most 64 KiB of UTF-8 text",
                ));
            }
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
            let summary = summary_payload(&receipt, &summary_body, operation);
            let summary_result = app
                .record_summary(
                    &actor,
                    Some(&session),
                    &summary,
                    &sub_operation(operation, "summary"),
                    None,
                    TimestampMs::from_millis(now_ms_u64()),
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
                summary_id: Some(summary.summary_id.clone()),
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
                .finalize_close_current(
                    &actor,
                    Some(&session),
                    &intent,
                    None,
                    TimestampMs::from_millis(now_ms_u64()),
                    &sub_operation(operation, "finalize"),
                )
                .map_err(map_application_error)?;
            let diagnostics = finalized.diagnostics.as_ref();
            let outcome = if diagnostics.is_some() {
                ApplicationOutcome::Rejected
            } else {
                ApplicationOutcome::Changed
            };
            Ok((
                outcome,
                Some(finalized.revision),
                Some(json!({
                    "attempt": attempt_mutation_json(&submitted.value),
                    "receipt_id": receipt.receipt_id.as_str(),
                    "receipt_replayed": receipt_replayed,
                    "summary_id": summary.summary_id,
                    "summary_replayed": summary_result.replayed,
                    "close_intent": format!("{:?}", requested.close_intent.state).to_ascii_lowercase(),
                    "close_state": format!("{:?}", finalized.close_intent.state).to_ascii_lowercase(),
                    "close_replayed": finalized.replayed,
                    "gates": diagnostics.map(|value| json!({
                        "missing": value.missing,
                        "gates": value.gates.iter().map(|gate| json!({
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

        /// A `boreal_witnessed` payload is a readback reference, never an
        /// import request. The bounded executor already committed the trusted
        /// receipt and its operation/audit facts. Require exact agreement with
        /// those immutable facts before allowing finish to advance the attempt.
        fn validate_witnessed_receipt_readback(
            &self,
            project: &ProjectId,
            work_id: &str,
            receipt: &ReceiptPayload,
        ) -> Result<(), CliError> {
            receipt
                .validate()
                .map_err(|error| map_application_error(ApplicationError::from(error)))?;
            let invalid = || {
                CliError::with(
                    ErrorCode::ReceiptInvalid,
                    ApplicationOutcome::Rejected,
                    "witnessed receipt does not match its durable execution fact",
                )
            };
            let durable = self
                .store
                .receipt(receipt.receipt_id.as_str())
                .map_err(map_store_error)?
                .ok_or_else(invalid)?;
            let canonical_gate = self
                .store
                .gate_id_for_work(project.as_str(), work_id, receipt.gate_id.as_str())
                .map_err(|_| invalid())?;
            let argv: Vec<String> =
                serde_json::from_str(&durable.argv_json).map_err(|_| invalid())?;
            let subject: Value =
                serde_json::from_str(&durable.subject_json).map_err(|_| invalid())?;
            let coverage: Value =
                serde_json::from_str(&durable.coverage_json).map_err(|_| invalid())?;
            let coverage_kind = format!("{:?}", receipt.coverage.kind);

            if !witnessed_receipt_subject_matches(
                &durable,
                project,
                work_id,
                receipt,
                &canonical_gate,
            ) || durable.executable != receipt.executable
                || argv != receipt.argv
                || durable.cwd != receipt.cwd
                || durable.exit_code != receipt.exit_code
                || durable.started_at != stamp(receipt.started_at.as_millis())
                || durable.ended_at != stamp(receipt.ended_at.as_millis())
                || durable.environment_fingerprint != receipt.environment_fingerprint
                || subject.get("work_id").and_then(Value::as_str) != Some(receipt.work_id.as_str())
                || subject.get("attempt_id").and_then(Value::as_str)
                    != Some(receipt.attempt_id.as_str())
                || subject.get("fence").and_then(Value::as_u64) != Some(receipt.fence.get())
                || subject.get("gate_id").and_then(Value::as_str) != Some(receipt.gate_id.as_str())
                || coverage.get("kind").and_then(Value::as_str) != Some(coverage_kind.as_str())
                || coverage.get("profile_id").and_then(Value::as_str)
                    != Some(receipt.coverage.profile_id.as_str())
                || coverage.get("profile_version").and_then(Value::as_str)
                    != Some(receipt.coverage.profile_version.as_str())
            {
                return Err(invalid());
            }

            let operation = self
                .store
                .read_receipt_operation(project.as_str(), receipt.operation_id.as_str())
                .map_err(|_| invalid())?
                .ok_or_else(invalid)?;
            if operation.receipt != durable {
                return Err(invalid());
            }
            let audit = self
                .store
                .audit_event(receipt.operation_id.as_str())
                .map_err(map_store_error)?
                .ok_or_else(invalid)?;
            if audit.project_id != project.as_str()
                || audit.event_type != "receipt.recorded"
                || audit.subject_type != "receipt"
                || audit.subject_id != receipt.receipt_id.as_str()
                || audit.fence != Some(receipt.fence.get())
            {
                return Err(invalid());
            }
            Ok(())
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
                request_digest: canonical_request_digest(
                    "session.register/v1",
                    json!({
                        "project_id": project.as_str(),
                        "session_id": session,
                        "actor_id": actor,
                        "harness_id": harness,
                        "started_at": started_at.as_millis(),
                    }),
                ),
                expected_project_revision: expected_revision,
                started_at,
            };
            let result = app
                .register_session(&request)
                .map_err(map_application_error)?;
            Ok(Some(result.snapshot_revision))
        }
    }

    fn witnessed_receipt_subject_matches(
        durable: &ReceiptRecord,
        project: &ProjectId,
        work_id: &str,
        receipt: &ReceiptPayload,
        canonical_gate: &str,
    ) -> bool {
        durable.project_id == project.as_str()
            && durable.work_id == work_id
            && durable.work_id == receipt.work_id.as_str()
            && durable.attempt_id == receipt.attempt_id.as_str()
            && durable.fence == receipt.fence.get()
            && durable.operation_id == receipt.operation_id.as_str()
            && durable.gate_id.as_deref() == Some(canonical_gate)
            && durable.source_version_id.as_deref() == Some(receipt.source_snapshot_hash.as_str())
            && durable.config_identity == receipt.config_identity.as_str()
            && durable.output_digest == receipt.output_digest
            && durable.output_ref == receipt.output_ref
            && durable.attestation == ReceiptAttestation::BorealWitnessed
            && match receipt.result {
                ReceiptResult::Passed => durable.result == ReceiptOutcome::Passed,
                ReceiptResult::Failed => durable.result == ReceiptOutcome::Failed,
                ReceiptResult::Stale => durable.result == ReceiptOutcome::Stale,
            }
    }

    pub(super) fn make_envelope(
        operation: &str,
        outcome: ApplicationOutcome,
        revision: Option<u64>,
        data: Option<Value>,
        error: Option<WireError>,
    ) -> Envelope<Value> {
        let as_of = data
            .as_ref()
            .and_then(|value| value.get("as_of"))
            .and_then(Value::as_str)
            .map(str::to_owned)
            .unwrap_or_else(now);
        let error = error.or_else(|| {
            if outcome.is_success() {
                return None;
            }
            let code = crate::outcome_error_code(outcome);
            let mut error = WireError::new(
                code,
                match outcome {
                    ApplicationOutcome::Unknown => {
                        "operation outcome is unknown; read back the durable operation"
                    }
                    ApplicationOutcome::Rejected => "application request was rejected",
                    ApplicationOutcome::Conflict => "application request conflicted",
                    ApplicationOutcome::Busy => "application request is busy",
                    ApplicationOutcome::Failed => "application request failed",
                    ApplicationOutcome::Changed | ApplicationOutcome::Unchanged => {
                        "application request completed"
                    }
                },
                crate::is_retryable(code),
            );
            if outcome == ApplicationOutcome::Unknown {
                error.operation_id = Some(operation.to_owned());
                error.readback_required = Some(true);
            }
            Some(error)
        });
        Envelope {
            api_version: API_VERSION.to_owned(),
            schema_version: schema::ENVELOPE.to_owned(),
            operation_id: operation.to_owned(),
            revision,
            as_of,
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
        let actor_id = string(data, "actor_id")?;
        let harness_id = string(data, "harness_id")?;
        let session_id = string(data, "session_id")?;
        let request_digest = canonical_request_digest(
            "attempt.transition/v1",
            json!({
                "project_id": project.as_str(),
                "work_id": work_id,
                "attempt_id": attempt.as_str(),
                "actor_id": actor_id,
                "harness_id": harness_id,
                "session_id": session_id,
                "fence": fence.get(),
            }),
        );
        Ok(AttemptRequest::new(
            project.clone(),
            WorkId::new(work_id),
            attempt.clone(),
            ActorId::new(actor_id),
            Some(HarnessId::new(harness_id)),
            Some(SessionId::new(session_id)),
            fence,
            OperationId::new(operation),
            request_digest,
            TimestampMs::from_millis(now_ms_u64()),
        ))
    }

    fn start_result_json(snapshot: &AttemptSnapshot, operation: &str) -> Value {
        let mut value = attempt_snapshot_json(snapshot);
        value["work_id"] = json!(snapshot.work_id.as_str());
        value["replayed"] = json!(false);
        value["child_operations"] = json!({
            "claim": sub_operation(operation, "claim"),
            "accept": sub_operation(operation, "accept"),
            "start": sub_operation(operation, "start"),
        });
        value
    }

    #[allow(clippy::too_many_arguments)]
    fn claim_request_digest(
        data: &Value,
        project: &ProjectId,
        work_id: &str,
        actor: &str,
        harness: &str,
        session: &str,
        lease_ttl_ms: Option<u64>,
        hard_time_limit_ms: Option<u64>,
    ) -> Result<String, CliError> {
        Ok(canonical_request_digest(
            "attempt.claim/v1",
            json!({
                "project_id": project.as_str(),
                "work_id": work_id,
                "attempt_id": string(data, "attempt_id")?,
                "actor_id": actor,
                "harness_id": harness,
                "session_id": session,
                "expected_revision": optional_u64(data, "expected_revision")?,
                "lease_ttl_ms": lease_ttl_ms,
                "hard_time_limit_ms": hard_time_limit_ms,
                "source_version_id": optional_string(data, "source_version_id")?,
                "config_identity": data.get("config_identity").and_then(Value::as_str).unwrap_or("unknown"),
            }),
        ))
    }

    #[allow(clippy::too_many_arguments)]
    fn start_request_digest(
        data: &Value,
        project: &ProjectId,
        work_id: &str,
        actor: &str,
        harness: &str,
        session: &str,
        attempt_id: Option<&str>,
        fence: Option<u64>,
    ) -> Result<String, CliError> {
        Ok(canonical_request_digest(
            "agent.start/v1",
            json!({
                "project_id": project.as_str(),
                "work_id": work_id,
                "attempt_id": attempt_id,
                "actor_id": actor,
                "harness_id": harness,
                "session_id": session,
                "fence": fence,
                "expected_revision": optional_u64(data, "expected_revision")?,
                "lease_ttl_ms": optional_u64(data, "lease_ttl_ms")?,
                "hard_time_limit_ms": optional_duration(data, "hard_time_limit_ms", "time_limit_ms")?,
            }),
        ))
    }

    fn select_claimable_work(
        store: &SqliteStore,
        project: &ProjectId,
        actor: &str,
    ) -> Result<Option<String>, CliError> {
        let snapshot = project_status_from_store(
            store,
            project,
            &ActorContext {
                actor_id: ActorId::new(actor.to_owned()),
                role: ActorRole::Agent,
            },
            TimestampMs::from_millis(now_ms_u64()),
            1_000,
            0,
        )
        .map_err(|message| {
            CliError::with(
                ErrorCode::GuidanceUnavailable,
                ApplicationOutcome::Failed,
                message,
            )
        })?;
        Ok(snapshot
            .items
            .into_iter()
            .find(|item| item.work.kind == WorkKind::Task && item.decision.claimable_for_actor)
            .map(|item| item.work.id.as_str().to_owned()))
    }

    fn parsed_context_command(data: &Value, route: &str) -> Result<ParsedCommand, CliError> {
        let path = match route {
            "guide" => vec!["agent".to_owned(), "guide".to_owned()],
            "resume" => vec!["agent".to_owned(), "resume".to_owned()],
            "next" => vec!["agent".to_owned(), "next".to_owned()],
            "session_start" => vec!["session".to_owned(), "start".to_owned()],
            "session_show" => vec!["session".to_owned(), "show".to_owned()],
            "session_end" => vec!["session".to_owned(), "end".to_owned()],
            _ => {
                return Err(CliError::invalid(format!(
                    "unknown service context route: {route}"
                )))
            }
        };
        let mut options = CliOptions {
            project: Some(string(data, "project_id")?),
            actor: string(data, "actor_id")?,
            harness: string(data, "harness_id")?,
            session: string(data, "session_id")?,
            work: optional_string(data, "work_id")?,
            attempt: optional_string(data, "attempt_id")?,
            expected_revision: optional_u64(data, "expected_revision")?,
            ..CliOptions::default()
        };
        options.positionals = Vec::new();
        Ok(ParsedCommand { path, options })
    }

    fn parsed_attempt_command(
        data: &Value,
        _kind: super::super::AttemptOperation,
    ) -> Result<ParsedCommand, CliError> {
        let mut options = CliOptions {
            project: Some(string(data, "project_id")?),
            actor: string(data, "actor_id")?,
            harness: string(data, "harness_id")?,
            session: string(data, "session_id")?,
            work: Some(string(data, "work_id")?),
            attempt: Some(string(data, "attempt_id")?),
            fence: Some(required_u64(data, "fence")?),
            expected_revision: optional_u64(data, "expected_revision")?,
            lease_ttl_ms: optional_u64(data, "lease_ttl_ms")?,
            reason: optional_string(data, "reason")?,
            ..CliOptions::default()
        };
        if options.lease_ttl_ms.is_none() {
            options.lease_ttl_ms = Some(AttemptPolicy::default().default_lease_ttl_ms);
        }
        Ok(ParsedCommand {
            path: vec!["agent".to_owned(), "lifecycle".to_owned()],
            options,
        })
    }

    fn optional_duration(
        data: &Value,
        canonical: &str,
        alias: &str,
    ) -> Result<Option<u64>, CliError> {
        let canonical_value = optional_u64(data, canonical)?;
        let alias_value = optional_u64(data, alias)?;
        if canonical_value.is_some() && alias_value.is_some() && canonical_value != alias_value {
            return Err(CliError::invalid(format!(
                "service fields {canonical} and {alias} disagree"
            )));
        }
        Ok(canonical_value.or(alias_value))
    }

    fn request_fence(data: &Value) -> Result<Option<u64>, CliError> {
        let fence = optional_u64(data, "fence")?;
        let envelope_fence = optional_u64(data, "attempt_fence")?;
        if fence.is_some() && envelope_fence.is_some() && fence != envelope_fence {
            return Err(CliError::invalid(
                "service fields fence and attempt_fence disagree",
            ));
        }
        Ok(fence.or(envelope_fence))
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

    fn invalid_service_dto(command: &str, error: serde_json::Error) -> CliError {
        CliError::invalid(format!("invalid {command} request: {error}"))
    }

    fn required_trimmed(value: String, field: &str) -> Result<String, CliError> {
        let value = value.trim();
        if value.is_empty() {
            Err(CliError::invalid(format!(
                "service request requires {field}"
            )))
        } else {
            Ok(value.to_owned())
        }
    }

    fn generated_subject_id(prefix: &str, operation: &str) -> String {
        let normalized = operation
            .chars()
            .map(|character| {
                if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                    character
                } else {
                    '_'
                }
            })
            .collect::<String>();
        format!("{prefix}_{normalized}")
    }

    fn parse_actor_role(value: &str) -> Result<&str, CliError> {
        match value {
            "agent" | "reviewer" | "operator" | "publisher" => Ok(value),
            _ => Err(CliError::invalid(format!(
                "unknown create_project actor role: {value}"
            ))),
        }
    }

    fn parse_work_kind(value: &str) -> Result<WorkKind, CliError> {
        match value {
            "milestone" => Ok(WorkKind::Milestone),
            "sprint" => Ok(WorkKind::Sprint),
            "task" => Ok(WorkKind::Task),
            _ => Err(CliError::invalid(format!(
                "unknown create_work kind: {value}"
            ))),
        }
    }

    fn parse_dispatch_policy(value: &str) -> Result<DispatchPolicy, CliError> {
        match value {
            "automatic" => Ok(DispatchPolicy::Automatic),
            "operator_only" => Ok(DispatchPolicy::OperatorOnly),
            "paused" => Ok(DispatchPolicy::Paused),
            _ => Err(CliError::invalid(format!(
                "unknown create_work dispatch policy: {value}"
            ))),
        }
    }

    fn parse_acceptance_profile(value: &str) -> Result<AcceptanceProfile, CliError> {
        match value {
            "focused" => Ok(AcceptanceProfile::focused()),
            "reviewed" => Ok(AcceptanceProfile::reviewed()),
            _ => Err(CliError::invalid(format!(
                "unknown create_work acceptance profile: {value}"
            ))),
        }
    }

    fn parse_intake_kind(value: &str) -> Result<IntakeKind, CliError> {
        match value {
            "note" => Ok(IntakeKind::Note),
            "discovery" => Ok(IntakeKind::Discovery),
            "question" => Ok(IntakeKind::Question),
            "revisit" => Ok(IntakeKind::Revisit),
            _ => Err(CliError::invalid(format!("unknown intake kind: {value}"))),
        }
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
    use super::unix::{bind_service_host, request_data, ServiceCommandHandler};
    use super::*;
    use boreal_protocol::Envelope;
    use boreal_service::{
        ApplicationCommandHandler, ApplicationRequest, BusyOutcome, ElectionError, JsonRequest,
        ServiceHost, ServiceHostConfig, ServiceHostError, ServiceHostExit, TransportConfig,
        TransportError, UnixSocketClient, APPLICATION_API_VERSION, APPLICATION_SCHEMA_VERSION,
    };
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
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
                kind: WorkKind::Task,
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

    fn witnessed_finish_fixture(kind: &str) -> (ServiceCommandHandler, Value, PathBuf, String) {
        let root = temp_path(kind);
        let gate_root = root.join("gates");
        fs::create_dir_all(&gate_root).expect("witnessed gate directory creates");
        fs::write(
            gate_root.join("verification.json"),
            serde_json::to_vec(&json!({
                "gate_id": "verification",
                "kind": "verification",
                "executable": "true",
                "argv": ["true"],
                "cwd": ".",
                "source_snapshot_hash": "source-witnessed-finish",
                "config_identity": "config-witnessed-finish",
                "environment_fingerprint": "env-witnessed-finish",
                "observables": [],
                "max_runtime_ms": 1_000,
            }))
            .expect("witnessed gate declaration serializes"),
        )
        .expect("witnessed gate declaration writes");

        let store = seed_store(&root.join("state.sqlite"));
        let mut handler = make_handler_at(store, gate_root);
        handler
            .claim(
                &json!({
                    "command": "claim",
                    "project_id": "service-project",
                    "work_id": "service-work",
                    "actor_id": DEFAULT_ACTOR,
                    "harness_id": DEFAULT_HARNESS,
                    "session_id": "session-witnessed-finish",
                    "attempt_id": "attempt-witnessed-finish",
                    "expected_revision": 2,
                }),
                "op_service_witnessed_claim",
            )
            .expect("witnessed finish claim succeeds");
        handler
            .start(
                &json!({
                    "command": "start",
                    "project_id": "service-project",
                    "work_id": "service-work",
                    "actor_id": DEFAULT_ACTOR,
                    "harness_id": DEFAULT_HARNESS,
                    "session_id": "session-witnessed-finish",
                    "attempt_id": "attempt-witnessed-finish",
                    "fence": 1,
                }),
                "op_service_witnessed_start",
            )
            .expect("witnessed finish attempt starts");
        handler
            .store
            .execute_batch(
                "INSERT INTO source_version
                 (source_version_id, project_id, origin, access_scope, content_digest,
                  media_type, byte_count, captured_at, parser_identity, availability, citation_json)
                 VALUES ('source-witnessed-finish', 'service-project', 'fixture.md', 'project',
                         'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
                         'text/markdown', 1, 'unix-ms:0', 'parser/1', 'available', '[]');
                 UPDATE attempt
                 SET source_version_id = 'source-witnessed-finish',
                     config_identity = 'config-witnessed-finish'
                 WHERE attempt_id = 'attempt-witnessed-finish';",
            )
            .expect("witnessed finish proof context binds");

        let evidence_operation = "op_service_witnessed_evidence".to_owned();
        let evidence = handler
            .evidence_run(
                &json!({
                    "command": "evidence_run",
                    "project_id": "service-project",
                    "work_id": "service-work",
                    "actor_id": DEFAULT_ACTOR,
                    "harness_id": DEFAULT_HARNESS,
                    "session_id": "session-witnessed-finish",
                    "attempt_id": "attempt-witnessed-finish",
                    "fence": 1,
                    "gate_id": "verification",
                }),
                &evidence_operation,
            )
            .expect("witnessed evidence run succeeds");
        assert_eq!(evidence.0, ApplicationOutcome::Changed);
        let receipt_path = evidence.2.as_ref().expect("evidence data")["receipt_path"]
            .as_str()
            .expect("evidence receipt path");
        let receipt: Value = serde_json::from_str(
            &fs::read_to_string(receipt_path).expect("witnessed receipt is readable"),
        )
        .expect("witnessed receipt is JSON");
        let finish = json!({
            "command": "finish_close",
            "project_id": "service-project",
            "work_id": "service-work",
            "actor_id": DEFAULT_ACTOR,
            "harness_id": DEFAULT_HARNESS,
            "session_id": "session-witnessed-finish",
            "attempt_id": "attempt-witnessed-finish",
            "fence": 1,
            "expected_revision": Value::Null,
            "receipt": receipt,
            "summary_body": "Completed the witnessed verification fixture.",
        });
        (handler, finish, root, evidence_operation)
    }

    fn application_envelope(
        handler: &mut ServiceCommandHandler,
        operation_id: &str,
        data: Value,
    ) -> Envelope<Value> {
        let command = data["command"]
            .as_str()
            .expect("test request has a command")
            .to_owned();
        let response = handler
            .handle(ApplicationRequest {
                request_id: format!("request-{operation_id}"),
                api_version: APPLICATION_API_VERSION.to_owned(),
                schema_version: APPLICATION_SCHEMA_VERSION.to_owned(),
                operation_id: operation_id.to_owned(),
                command,
                data: data.to_string(),
            })
            .expect("application handler returns an envelope");
        serde_json::from_str(&response.data).expect("application envelope is valid JSON")
    }

    #[test]
    fn service_supports_project_and_work_creation_cli_routes() {
        let init = ParsedCommand {
            path: vec!["init".to_owned()],
            options: CliOptions::default(),
        };
        let create_work = ParsedCommand {
            path: vec!["work".to_owned(), "create".to_owned()],
            options: CliOptions::default(),
        };
        assert!(supports(&init));
        assert!(supports(&create_work));

        let dependency = ParsedCommand {
            path: vec!["dep".to_owned(), "add".to_owned()],
            options: CliOptions::default(),
        };
        let doctor = ParsedCommand {
            path: vec!["doctor".to_owned()],
            options: CliOptions::default(),
        };
        assert!(supports(&dependency));
        assert!(supports(&doctor));
        for path in [
            vec!["dep".to_owned(), "tree".to_owned()],
            vec!["dep".to_owned(), "cycles".to_owned()],
            vec!["cycle".to_owned(), "board".to_owned()],
            vec!["cycle".to_owned(), "report".to_owned()],
            vec!["intake".to_owned(), "list".to_owned()],
            vec!["intake".to_owned(), "show".to_owned()],
            vec!["intake".to_owned(), "bucket".to_owned()],
            vec!["intake".to_owned(), "capture".to_owned()],
        ] {
            assert!(supports(&ParsedCommand {
                path,
                options: CliOptions::default(),
            }));
        }
    }

    #[test]
    fn planning_service_request_data_preserves_project_and_dependency_context() {
        let options = CliOptions {
            project: Some("project-1".to_owned()),
            positionals: vec!["task-a".to_owned(), "task-b".to_owned()],
            ..CliOptions::default()
        };
        let parsed = ParsedCommand {
            path: vec!["dep".to_owned(), "add".to_owned()],
            options,
        };
        let data = request_data(&parsed, "op_dep_fixture").expect("dependency request builds");
        assert_eq!(data["command"], "dependency_add");
        assert_eq!(data["project_id"], "project-1");
        assert_eq!(data["prerequisite_id"], "task-a");
        assert_eq!(data["dependent_id"], "task-b");

        let board = ParsedCommand {
            path: vec!["cycle".to_owned(), "board".to_owned()],
            options: CliOptions {
                project: Some("project-1".to_owned()),
                positionals: vec!["cycle-1".to_owned()],
                ..CliOptions::default()
            },
        };
        let board_data =
            request_data(&board, "op_cycle_board_fixture").expect("cycle board request builds");
        assert_eq!(board_data["command"], "cycle_board");
        assert_eq!(board_data["project_id"], "project-1");
        assert_eq!(board_data["cycle_id"], "cycle-1");

        let intake = ParsedCommand {
            path: vec!["intake".to_owned(), "show".to_owned()],
            options: CliOptions {
                project: Some("project-1".to_owned()),
                positionals: vec!["intake-1".to_owned()],
                ..CliOptions::default()
            },
        };
        let intake_data =
            request_data(&intake, "op_intake_show_fixture").expect("intake show request builds");
        assert_eq!(intake_data["command"], "intake_read");
        assert_eq!(intake_data["intake_id"], "intake-1");

        let bucket = ParsedCommand {
            path: vec!["intake".to_owned(), "bucket".to_owned()],
            options: CliOptions {
                project: Some("project-1".to_owned()),
                positionals: vec!["inbox".to_owned(), "Inbox".to_owned()],
                ..CliOptions::default()
            },
        };
        let bucket_data = request_data(&bucket, "op_intake_bucket_fixture")
            .expect("intake bucket request builds");
        assert_eq!(bucket_data["command"], "intake_bucket");
        assert_eq!(bucket_data["bucket_id"], "inbox");
        assert_eq!(bucket_data["name"], "Inbox");

        let capture = ParsedCommand {
            path: vec!["intake".to_owned(), "capture".to_owned()],
            options: CliOptions {
                project: Some("project-1".to_owned()),
                bucket: Some("inbox".to_owned()),
                kind: Some("discovery".to_owned()),
                positionals: vec!["intake-1".to_owned(), "a fact".to_owned()],
                ..CliOptions::default()
            },
        };
        let capture_data = request_data(&capture, "op_intake_capture_fixture")
            .expect("intake capture request builds");
        assert_eq!(capture_data["command"], "intake_capture");
        assert_eq!(capture_data["bucket_id"], "inbox");
        assert_eq!(capture_data["kind"], "discovery");

        let doctor = ParsedCommand {
            path: vec!["doctor".to_owned()],
            options: CliOptions::default(),
        };
        let data = request_data(&doctor, "op_doctor_fixture").expect("doctor request builds");
        assert_eq!(data["command"], "doctor");
        assert!(data["project_id"].is_null());
    }

    #[test]
    fn cli_creation_routes_build_authoritative_service_dtos() {
        let init = super::super::parse(&[
            "init".to_owned(),
            "dto-project".to_owned(),
            "--socket".to_owned(),
            "service.sock".to_owned(),
            "--actor".to_owned(),
            "creator".to_owned(),
        ])
        .expect("init parses");
        let init_data = request_data(&init, "op-create-project-dto").expect("init DTO builds");
        assert_eq!(init_data["command"], "create_project");
        assert_eq!(init_data["project_id"], "dto-project");
        assert_eq!(init_data["name"], "dto-project");
        assert_eq!(init_data["actor_id"], "creator");
        assert!(init_data.get("created_at").is_none());

        let create = super::super::parse(&[
            "work".to_owned(),
            "create".to_owned(),
            "dto-project".to_owned(),
            "dto-sprint".to_owned(),
            "DTO sprint".to_owned(),
            "--kind".to_owned(),
            "sprint".to_owned(),
            "--parent".to_owned(),
            "dto-milestone".to_owned(),
            "--description".to_owned(),
            "typed route".to_owned(),
            "--priority".to_owned(),
            "9".to_owned(),
            "--socket".to_owned(),
            "service.sock".to_owned(),
            "--actor".to_owned(),
            "creator".to_owned(),
        ])
        .expect("work create parses");
        let create_data =
            request_data(&create, "op-create-work-dto").expect("work creation DTO builds");
        assert_eq!(create_data["command"], "create_work");
        assert_eq!(create_data["project_id"], "dto-project");
        assert_eq!(create_data["work_id"], "dto-sprint");
        assert_eq!(create_data["kind"], "sprint");
        assert_eq!(create_data["parent_id"], "dto-milestone");
        assert_eq!(create_data["description"], "typed route");
        assert_eq!(create_data["priority"], 9);
        assert_eq!(create_data["dispatch"], "automatic");
        assert_eq!(create_data["profile"], "focused");
        assert!(create_data.get("created_at").is_none());
    }

    #[test]
    fn service_create_routes_preserve_typed_fields_and_replay() {
        let db = temp_path("create-routes.sqlite");
        let store = SqliteStore::open(&db, SCHEMA).expect("temporary schema opens");
        let mut handler = make_handler(store);
        let project_request = json!({
            "command": "create_project",
            "project_id": "created-project",
            "name": "Created project",
            "description": "service-created fixture",
            "actor_id": "creator",
            "actor_role": "operator",
            "credential_ref": "test",
        });
        let created_project = application_envelope(
            &mut handler,
            "op-service-create-project",
            project_request.clone(),
        );
        assert_eq!(created_project.outcome, ApplicationOutcome::Changed);
        assert_eq!(created_project.revision, Some(1));
        assert_eq!(
            created_project.data.as_ref().unwrap()["project_id"],
            "created-project"
        );
        assert_eq!(created_project.data.as_ref().unwrap()["replayed"], false);

        let replayed_project =
            application_envelope(&mut handler, "op-service-create-project", project_request);
        assert_eq!(replayed_project.outcome, ApplicationOutcome::Unchanged);
        assert_eq!(replayed_project.revision, Some(1));
        assert_eq!(replayed_project.data.as_ref().unwrap()["replayed"], true);

        let milestone_request = json!({
            "command": "create_work",
            "project_id": "created-project",
            "work_id": "milestone-created",
            "kind": "milestone",
            "parent_id": null,
            "title": "Created milestone",
            "description": "root work",
            "priority": 4,
            "dispatch": "operator_only",
            "profile": "reviewed",
            "actor_id": "creator",
        });
        let created_work = application_envelope(
            &mut handler,
            "op-service-create-work",
            milestone_request.clone(),
        );
        assert_eq!(created_work.outcome, ApplicationOutcome::Changed);
        assert_eq!(created_work.revision, Some(2));
        let data = created_work.data.as_ref().expect("created work data");
        assert_eq!(data["work_id"], "milestone-created");
        assert_eq!(data["kind"], "milestone");
        assert_eq!(data["description"], "root work");
        assert_eq!(data["priority"], 4);
        assert_eq!(data["dispatch_policy"], "operator_only");
        assert_eq!(data["profile"]["id"], "reviewed");

        let replayed_work =
            application_envelope(&mut handler, "op-service-create-work", milestone_request);
        assert_eq!(replayed_work.outcome, ApplicationOutcome::Unchanged);
        assert_eq!(replayed_work.revision, Some(2));
        assert_eq!(replayed_work.data.as_ref().unwrap()["replayed"], true);

        let snapshot = handler
            .store
            .read_project_status("created-project")
            .expect("created project status reads");
        assert_eq!(snapshot.works.len(), 1);
        assert_eq!(snapshot.works[0].work.priority, 4);
        assert_eq!(
            snapshot.works[0].work.dispatch_policy,
            DispatchPolicy::OperatorOnly
        );
        assert_eq!(
            snapshot.works[0].work.acceptance_profile.id.as_str(),
            "reviewed"
        );
        assert!(snapshot.works[0].work.acceptance_profile.requires_review());
        let _ = fs::remove_file(db);
    }

    #[test]
    fn service_create_work_rejects_unknown_kind_and_missing_parent() {
        let db = temp_path("create-invalid.sqlite");
        let store = SqliteStore::open(&db, SCHEMA).expect("temporary schema opens");
        let mut handler = make_handler(store);
        let project = application_envelope(
            &mut handler,
            "op-service-invalid-project",
            json!({
                "command": "create_project",
                "project_id": "invalid-project",
                "name": "Invalid fixture",
                "actor_id": "creator",
            }),
        );
        assert_eq!(project.outcome, ApplicationOutcome::Changed);

        let invalid_kind = application_envelope(
            &mut handler,
            "op-service-invalid-kind",
            json!({
                "command": "create_work",
                "project_id": "invalid-project",
                "work_id": "unknown-kind",
                "kind": "note",
                "title": "Unknown kind",
                "actor_id": "creator",
            }),
        );
        assert_eq!(invalid_kind.outcome, ApplicationOutcome::Rejected);
        assert_eq!(
            invalid_kind.error.as_ref().unwrap().code,
            ErrorCode::InvalidArgument
        );

        let missing_parent = application_envelope(
            &mut handler,
            "op-service-missing-parent",
            json!({
                "command": "create_work",
                "project_id": "invalid-project",
                "work_id": "orphan-sprint",
                "kind": "sprint",
                "title": "Orphan sprint",
                "actor_id": "creator",
            }),
        );
        assert_eq!(missing_parent.outcome, ApplicationOutcome::Rejected);
        assert_eq!(
            missing_parent.error.as_ref().unwrap().code,
            ErrorCode::InvalidArgument
        );
        assert!(missing_parent
            .error
            .as_ref()
            .unwrap()
            .message
            .contains("require a parent"));
        let _ = fs::remove_file(db);
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
        assert_eq!(
            envelope.as_of,
            envelope.data.as_ref().unwrap()["as_of"],
            "status data and envelope must share one snapshot clock",
        );
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

    #[test]
    fn bounded_service_creates_project_and_work_over_the_real_socket_route() {
        let db = temp_path("cs.sqlite");
        let socket = temp_path("cs.sock");
        let store = SqliteStore::open(&db, SCHEMA).expect("temporary schema opens");
        let host = match ServiceHost::bind(
            &socket,
            make_handler(store),
            ServiceHostConfig::default()
                .with_max_requests(Some(2))
                .expect("positive request bound"),
        ) {
            Ok(host) => host,
            Err(error) if socket_unavailable_in_sandbox(&error.to_string()) => return,
            Err(error) => panic!("service host binds in a temporary directory: {error}"),
        };
        let handle = host.start().expect("service host starts");

        let project = socket_envelope(
            &socket,
            "request-create-project",
            "op_create_project_socket",
            json!({
                "command": "create_project",
                "project_id": "socket-project",
                "name": "Socket project",
                "actor_id": "socket-creator",
            }),
        );
        let Some(project) = project else {
            handle.shutdown();
            let _ = handle.join();
            return;
        };
        assert_eq!(project.outcome, ApplicationOutcome::Changed);
        assert_eq!(
            project.data.as_ref().unwrap()["project_id"],
            "socket-project"
        );

        let work = socket_envelope(
            &socket,
            "request-create-work",
            "op_create_work_socket",
            json!({
                "command": "create_work",
                "project_id": "socket-project",
                "kind": "milestone",
                "title": "Generated identifier work",
                "description": "created across the framed transport",
                "priority": 3,
                "dispatch": "paused",
                "profile": "focused",
                "actor_id": "socket-creator",
            }),
        )
        .expect("socket remains available for create_work");
        assert_eq!(work.outcome, ApplicationOutcome::Changed);
        assert_eq!(work.data.as_ref().unwrap()["priority"], 3);
        assert_eq!(work.data.as_ref().unwrap()["dispatch_policy"], "paused");
        assert_eq!(
            work.data.as_ref().unwrap()["work_id"],
            "work_op_create_work_socket"
        );

        let report = handle.join().expect("bounded service host exits");
        assert_eq!(report.exit(), ServiceHostExit::RequestLimit);
        let _ = fs::remove_file(db);
        let _ = fs::remove_file(socket);
    }

    #[test]
    fn production_composition_keeps_status_responsive_during_slow_evidence() {
        let root = temp_path("production-concurrent");
        fs::create_dir_all(&root).expect("temporary service root creates");
        let db = root.join("boreal.sqlite");
        let socket = PathBuf::from(format!(
            "/tmp/boreal-pc-{}-{}.sock",
            std::process::id(),
            now_ms_u64()
        ));
        let gate_root = root.join(super::GATE_COMMANDS_DIR);
        fs::create_dir_all(&gate_root).expect("gate directory creates");
        fs::write(
            gate_root.join("verification.json"),
            serde_json::to_vec(&json!({
                "gate_id": "verification",
                "kind": "verification",
                "executable": "sleep",
                "argv": ["sleep", "1"],
                "cwd": ".",
                "source_snapshot_hash": "source-production-concurrent",
                "config_identity": "config-production-concurrent",
                "environment_fingerprint": "env-production-concurrent",
                "observables": [],
                "max_runtime_ms": 2_000,
            }))
            .expect("gate declaration serializes"),
        )
        .expect("gate declaration writes");

        let store = seed_store(&db);
        let mut handler = make_handler_at(store, gate_root);
        handler
            .claim(
                &json!({
                    "command": "claim",
                    "project_id": "service-project",
                    "work_id": "service-work",
                    "actor_id": DEFAULT_ACTOR,
                    "harness_id": DEFAULT_HARNESS,
                    "session_id": "session-production-concurrent",
                    "attempt_id": "attempt-production-concurrent",
                    "expected_revision": 2,
                }),
                "op_production_concurrent_claim",
            )
            .expect("evidence fixture claim succeeds");
        handler
            .start(
                &json!({
                    "command": "start",
                    "project_id": "service-project",
                    "work_id": "service-work",
                    "actor_id": DEFAULT_ACTOR,
                    "harness_id": DEFAULT_HARNESS,
                    "session_id": "session-production-concurrent",
                    "attempt_id": "attempt-production-concurrent",
                    "fence": 1,
                }),
                "op_production_concurrent_start",
            )
            .expect("evidence fixture attempt starts");
        handler
            .store
            .execute_batch(
                "INSERT INTO source_version
                 (source_version_id, project_id, origin, access_scope, content_digest,
                  media_type, byte_count, captured_at, parser_identity, availability, citation_json)
                 VALUES ('source-production-concurrent', 'service-project', 'fixture.md', 'project',
                         'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
                         'text/markdown', 1, 'unix-ms:0', 'parser/1', 'available', '[]');
                 UPDATE attempt
                 SET source_version_id = 'source-production-concurrent',
                     config_identity = 'config-production-concurrent'
                 WHERE attempt_id = 'attempt-production-concurrent';",
            )
            .expect("attempt proof context binds");
        drop(handler);

        let host = match bind_service_host(
            &db,
            &socket,
            ServiceHostConfig::default()
                .with_max_requests(Some(2))
                .expect("request bound is valid"),
        ) {
            Ok(host) => host,
            Err(error) if socket_unavailable_in_sandbox(&error.message) => {
                let _ = fs::remove_dir_all(root);
                return;
            }
            Err(error) => panic!("production service composition binds: {error:?}"),
        };
        let running = host
            .start_concurrent()
            .expect("production concurrent service starts");
        let evidence_completed = Arc::new(AtomicBool::new(false));
        let evidence_completed_thread = Arc::clone(&evidence_completed);
        let evidence_socket = socket.clone();
        let evidence = thread::spawn(move || {
            let started = Instant::now();
            let result = socket_envelope(
                &evidence_socket,
                "request-production-evidence",
                "op_production_concurrent_evidence",
                json!({
                    "command": "evidence_run",
                    "project_id": "service-project",
                    "work_id": "service-work",
                    "actor_id": DEFAULT_ACTOR,
                    "harness_id": DEFAULT_HARNESS,
                    "session_id": "session-production-concurrent",
                    "attempt_id": "attempt-production-concurrent",
                    "fence": 1,
                    "gate_id": "verification",
                }),
            );
            evidence_completed_thread.store(true, Ordering::Release);
            (result, started.elapsed())
        });

        let evidence_dir = root.join("evidence");
        let wait_deadline = Instant::now() + Duration::from_secs(2);
        while !evidence_dir.exists() && Instant::now() < wait_deadline {
            thread::sleep(Duration::from_millis(5));
        }
        assert!(evidence_dir.exists(), "slow evidence reached execution");
        assert!(
            !evidence_completed.load(Ordering::Acquire),
            "slow evidence must still be running before status"
        );

        let status_started = Instant::now();
        let status = socket_envelope(
            &socket,
            "request-production-status",
            "op_production_concurrent_status",
            json!({
                "command": "status",
                "project_id": "service-project",
                "actor_id": DEFAULT_ACTOR,
                "harness_id": DEFAULT_HARNESS,
                "session_id": "session-production-concurrent",
                "limit": 10,
                "offset": 0,
            }),
        )
        .expect("status request returns while evidence is running");
        assert_eq!(status.outcome, ApplicationOutcome::Unchanged);
        assert!(
            status_started.elapsed() < Duration::from_millis(500),
            "status should not wait for the one-second evidence command"
        );

        let (evidence_result, evidence_elapsed) = evidence.join().expect("evidence thread joins");
        let evidence_result = evidence_result.expect("evidence response is returned");
        assert_eq!(evidence_result.outcome, ApplicationOutcome::Changed);
        assert!(evidence_elapsed >= Duration::from_millis(900));
        let report = running.join().expect("bounded production host exits");
        assert_eq!(report.exit(), ServiceHostExit::RequestLimit);
        assert_eq!(report.served_requests(), 2);
        let _ = fs::remove_file(socket);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn production_composition_elects_one_owner_for_same_database_across_sockets() {
        let root = temp_path("production-election");
        fs::create_dir_all(&root).expect("temporary service root creates");
        let db = root.join("boreal.sqlite");
        let nonce = now_ms_u64();
        let first_socket = PathBuf::from(format!(
            "/tmp/boreal-pe1-{}-{nonce}.sock",
            std::process::id()
        ));
        let second_socket = PathBuf::from(format!(
            "/tmp/boreal-pe2-{}-{nonce}.sock",
            std::process::id()
        ));
        let first = match bind_service_host(&db, &first_socket, ServiceHostConfig::default()) {
            Ok(host) => host,
            Err(error) if socket_unavailable_in_sandbox(&error.message) => {
                let _ = fs::remove_dir_all(root);
                return;
            }
            Err(error) => panic!("first production service binds: {error:?}"),
        }
        .start_concurrent()
        .expect("first production service wins election");

        let second = bind_service_host(&db, &second_socket, ServiceHostConfig::default())
            .expect("second endpoint binds before election");
        match second.start_concurrent() {
            Err(ServiceHostError::Election(ElectionError::Busy(
                BusyOutcome::ProjectAlreadyOwned { project_id, .. },
            ))) => assert!(project_id.starts_with("database:")),
            other => panic!(
                "expected same-database election conflict, got {}",
                if other.is_ok() {
                    "a running host"
                } else {
                    "another error"
                }
            ),
        }

        first.shutdown();
        first.join().expect("first production service stops");
        let _ = fs::remove_file(first_socket);
        let _ = fs::remove_file(second_socket);
        let _ = fs::remove_dir_all(root);
    }

    fn socket_envelope(
        socket: &Path,
        request_id: &str,
        operation_id: &str,
        data: Value,
    ) -> Option<Envelope<Value>> {
        let payload = json!({
            "api_version": APPLICATION_API_VERSION,
            "schema_version": APPLICATION_SCHEMA_VERSION,
            "operation_id": operation_id,
            "data": data,
        });
        let request = JsonRequest::new(request_id, payload.to_string())
            .expect("socket request is valid JSON");
        let mut client = match UnixSocketClient::connect(socket, TransportConfig::default()) {
            Ok(client) => client,
            Err(TransportError::Io(error))
                if error.kind() == std::io::ErrorKind::PermissionDenied
                    || error.to_string().contains("Operation not permitted") =>
            {
                return None
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
        Some(
            serde_json::from_value(outer["data"].clone())
                .expect("response contains a typed application envelope"),
        )
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
    fn service_claim_uses_its_clock_and_duration_inputs() {
        let db = temp_path("claim-clock.sqlite");
        let store = seed_store(&db);
        let mut handler = make_handler(store);
        let before = now_ms_u64();
        let data = json!({
            "command": "claim",
            "project_id": "service-project",
            "work_id": "service-work",
            "actor_id": DEFAULT_ACTOR,
            "harness_id": DEFAULT_HARNESS,
            "session_id": "session-service-clock",
            "attempt_id": "attempt-service-clock",
            "claimed_at": "unix-ms:1",
            "lease_deadline": "unix-ms:2",
            "hard_deadline": "unix-ms:3",
            "lease_ttl_ms": 5_000,
            "hard_time_limit_ms": 10_000,
            "expected_revision": 2,
        });
        handler
            .claim(&data, "op_service_clock_claim")
            .expect("service-owned claim succeeds");
        let after = now_ms_u64();
        let attempt = handler
            .store
            .current_attempt_for_work("service-project", "service-work")
            .expect("attempt read succeeds")
            .expect("claim persisted its attempt");
        let claimed_at = parse_stamp_ms(&attempt.claimed_at).expect("claimed_at is a stamp");
        let lease_deadline =
            parse_stamp_ms(&attempt.lease_deadline).expect("lease deadline is a stamp");
        let hard_deadline =
            parse_stamp_ms(&attempt.hard_deadline).expect("hard deadline is a stamp");
        assert!((before..=after).contains(&claimed_at));
        assert_ne!(claimed_at, 1, "the forged client clock must be ignored");
        assert_eq!(lease_deadline, claimed_at + 5_000);
        assert_eq!(hard_deadline, claimed_at + 10_000);
        let _ = fs::remove_file(db);
    }

    #[test]
    fn claim_then_cli_start_without_attempt_or_fence_resumes_owned_attempt() {
        let db = temp_path("claim-then-start.sqlite");
        let store = seed_store(&db);
        let mut handler = make_handler(store);
        handler
            .claim(
                &json!({
                    "command": "claim",
                    "project_id": "service-project",
                    "work_id": "service-work",
                    "actor_id": DEFAULT_ACTOR,
                    "harness_id": DEFAULT_HARNESS,
                    "session_id": "session-claim-then-start",
                    "attempt_id": "attempt-claimed-first",
                    "expected_revision": 2,
                }),
                "op_service_claim_first",
            )
            .expect("claim succeeds");

        let parsed = super::super::parse(&[
            "agent".to_owned(),
            "start".to_owned(),
            "service-work".to_owned(),
            "--project".to_owned(),
            "service-project".to_owned(),
            "--session".to_owned(),
            "session-claim-then-start".to_owned(),
            "--socket".to_owned(),
            "service.sock".to_owned(),
        ])
        .expect("agent start parses without explicit attempt context");
        let start_data = request_data(&parsed, "op_service_start_after_claim")
            .expect("start DTO builds without manufacturing an attempt");
        assert!(start_data["attempt_id"].is_null());
        assert!(start_data["fence"].is_null());

        let started = handler
            .start(&start_data, "op_service_start_after_claim")
            .expect("start resolves the caller-owned current attempt");
        assert_eq!(started.0, ApplicationOutcome::Changed);
        let data = started.2.expect("start result data");
        assert_eq!(data["attempt_id"], "attempt-claimed-first");
        assert_eq!(data["fence"], 1);
        assert_eq!(data["phase"], "running");
        let _ = fs::remove_file(db);
    }

    #[test]
    fn service_start_without_work_selects_a_claimable_task() {
        let db = temp_path("goal-less-service-start.sqlite");
        let store = seed_store(&db);
        let mut handler = make_handler(store);
        let data = json!({
            "command": "start",
            "project_id": "service-project",
            "actor_id": DEFAULT_ACTOR,
            "harness_id": DEFAULT_HARNESS,
            "session_id": "session-goal-less-service-start",
            "lease_ttl_ms": 60_000,
            "hard_time_limit_ms": 120_000,
            "expected_revision": 2,
        });

        let started = handler
            .start(&data, "op_goal_less_service_start")
            .expect("service start selects a task");
        assert_eq!(started.0, ApplicationOutcome::Changed);
        let result = started.2.expect("start result data");
        assert_eq!(result["work_id"], "service-work");
        assert_eq!(result["phase"], "running");
        assert_eq!(
            handler
                .store
                .current_attempt_for_work("service-project", "service-work")
                .expect("attempt reads")
                .expect("attempt exists")
                .session_id
                .as_deref(),
            Some("session-goal-less-service-start")
        );
        let _ = fs::remove_file(db);
    }

    #[test]
    fn fresh_service_start_has_typed_children_and_coherent_outer_replay() {
        let db = temp_path("fresh-start.sqlite");
        let store = seed_store(&db);
        let mut handler = make_handler(store);
        let data = json!({
            "command": "start",
            "project_id": "service-project",
            "work_id": "service-work",
            "actor_id": DEFAULT_ACTOR,
            "harness_id": DEFAULT_HARNESS,
            "session_id": "session-fresh-start",
            "lease_ttl_ms": 60_000,
            "hard_time_limit_ms": 120_000,
            "expected_revision": 2,
        });
        let first = handler
            .start(&data, "op_service_fresh_start")
            .expect("fresh start succeeds");
        assert_eq!(first.0, ApplicationOutcome::Changed);
        let first_data = first.2.as_ref().expect("fresh start data");
        assert_eq!(first_data["phase"], "running");
        assert_eq!(first_data["replayed"], false);
        assert_eq!(
            first_data["child_operations"],
            json!({
                "claim": "op_service_fresh_start_claim",
                "accept": "op_service_fresh_start_accept",
                "start": "op_service_fresh_start_start",
            })
        );
        for child in [
            "op_service_fresh_start_claim",
            "op_service_fresh_start_accept",
            "op_service_fresh_start_start",
        ] {
            assert!(handler
                .store
                .operation(child)
                .expect("child operation reads")
                .is_some());
        }
        let outer = handler
            .store
            .operation("op_service_fresh_start")
            .expect("outer operation reads")
            .expect("outer operation persists");
        assert_eq!(outer.command, "agent_start");
        assert_eq!(
            outer.attempt_id.as_deref(),
            Some("attempt_cli_service_fresh_start")
        );

        let replay = handler
            .start(&data, "op_service_fresh_start")
            .expect("outer start replays");
        assert_eq!(replay.0, ApplicationOutcome::Unchanged);
        assert_eq!(replay.1, first.1);
        let replay_data = replay.2.expect("replay data");
        assert_eq!(replay_data["phase"], "running");
        assert_eq!(replay_data["attempt_id"], "attempt_cli_service_fresh_start");
        assert_eq!(replay_data["replayed"], true);
        let _ = fs::remove_file(db);
    }

    #[test]
    fn fresh_service_start_recovers_after_its_claim_child_commits() {
        let db = temp_path("partial-fresh-start.sqlite");
        let store = seed_store(&db);
        let mut handler = make_handler(store);
        let data = json!({
            "command": "start",
            "project_id": "service-project",
            "work_id": "service-work",
            "actor_id": DEFAULT_ACTOR,
            "harness_id": DEFAULT_HARNESS,
            "session_id": "session-partial-start",
            "attempt_id": "attempt-partial-start",
            "lease_ttl_ms": 60_000,
            "hard_time_limit_ms": 120_000,
            "expected_revision": 2,
        });
        handler
            .claim(&data, "op_service_partial_start_claim")
            .expect("claim child commits before simulated crash");
        assert!(handler
            .store
            .operation("op_service_partial_start")
            .expect("outer lookup succeeds")
            .is_none());

        let recovered = handler
            .start(&data, "op_service_partial_start")
            .expect("outer start resumes its own partial claim without a client fence");
        assert_eq!(recovered.0, ApplicationOutcome::Changed);
        assert_eq!(recovered.2.as_ref().unwrap()["phase"], "running");
        assert!(handler
            .store
            .operation("op_service_partial_start")
            .expect("outer lookup succeeds")
            .is_some());
        let _ = fs::remove_file(db);
    }

    #[test]
    fn running_and_verifying_start_resume_requires_full_identity_and_fence() {
        let db = temp_path("start-resume.sqlite");
        let store = seed_store(&db);
        let mut handler = make_handler(store);
        handler
            .start(
                &json!({
                    "command": "start",
                    "project_id": "service-project",
                    "work_id": "service-work",
                    "actor_id": DEFAULT_ACTOR,
                    "harness_id": DEFAULT_HARNESS,
                    "session_id": "session-resume",
                    "attempt_id": "attempt-resume",
                    "expected_revision": 2,
                }),
                "op_service_resume_setup",
            )
            .expect("setup attempt starts");

        let resume = json!({
            "command": "start",
            "project_id": "service-project",
            "work_id": "service-work",
            "actor_id": DEFAULT_ACTOR,
            "harness_id": DEFAULT_HARNESS,
            "session_id": "session-resume",
            "attempt_id": "attempt-resume",
            "fence": 1,
        });
        let running = handler
            .start(&resume, "op_service_resume_running")
            .expect("running attempt resumes unchanged");
        assert_eq!(running.0, ApplicationOutcome::Unchanged);
        assert_eq!(running.2.as_ref().unwrap()["phase"], "running");

        for (operation, field, value, expected_code) in [
            (
                "op_service_resume_wrong_actor",
                "actor_id",
                json!("other-actor"),
                ErrorCode::AttemptConflict,
            ),
            (
                "op_service_resume_wrong_harness",
                "harness_id",
                json!("other-harness"),
                ErrorCode::AttemptConflict,
            ),
            (
                "op_service_resume_wrong_session",
                "session_id",
                json!("other-session"),
                ErrorCode::AttemptConflict,
            ),
            (
                "op_service_resume_wrong_fence",
                "fence",
                json!(2),
                ErrorCode::StaleFence,
            ),
        ] {
            let mut invalid = resume.clone();
            invalid[field] = value;
            let error = handler
                .start(&invalid, operation)
                .expect_err("mismatched resume context is rejected");
            assert_eq!(error.code, expected_code);
        }

        handler
            .store
            .execute_batch(
                "UPDATE attempt SET state = 'verifying' WHERE attempt_id = 'attempt-resume';",
            )
            .expect("fixture enters verifying");
        let verifying = handler
            .start(&resume, "op_service_resume_verifying")
            .expect("verifying attempt resumes unchanged");
        assert_eq!(verifying.0, ApplicationOutcome::Unchanged);
        assert_eq!(verifying.2.as_ref().unwrap()["phase"], "verifying");
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
        handler
            .store
            .execute_batch(
                "UPDATE attempt
                 SET source_version_id = 'source-finish', config_identity = 'config-1'
                 WHERE attempt_id = 'attempt-finish';",
            )
            .expect("attempt proof context binds");
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
            "summary_body": "Completed service finish fixture.",
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
                "attestation": "external_attested",
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
        assert!(!data["gates"]["missing"]
            .as_array()
            .expect("missing gate list")
            .iter()
            .any(|gate| gate.as_str().is_some_and(|id| id.ends_with(":summary"))));
        let _ = fs::remove_file(db);
    }

    #[test]
    fn witnessed_run_finish_reads_back_receipt_and_reaches_closeout_diagnostics() {
        let (mut handler, finish, root, evidence_operation) =
            witnessed_finish_fixture("witnessed-finish-readback");
        let receipt_id = finish["receipt"]["receipt_id"]
            .as_str()
            .expect("finish has a receipt id");
        let durable_before = handler
            .store
            .receipt(receipt_id)
            .expect("receipt read succeeds")
            .expect("witnessed receipt is durable");
        let operation_before = handler
            .store
            .operation(&evidence_operation)
            .expect("operation read succeeds")
            .expect("witnessed operation is durable");
        let audit_before = handler
            .store
            .audit_event(&evidence_operation)
            .expect("audit read succeeds")
            .expect("witnessed audit is durable");

        let result = handler
            .finish_close(&finish, "op_service_witnessed_finish")
            .expect("witnessed readback reaches authoritative close diagnostics");
        assert_eq!(result.0, ApplicationOutcome::Rejected);
        let data = result.2.expect("finish diagnostics");
        assert_eq!(data["receipt_replayed"], true);
        assert_eq!(data["close_state"], "open");
        assert!(!data["gates"]["missing"]
            .as_array()
            .expect("missing gate list")
            .iter()
            .any(|gate| gate.as_str().is_some_and(|id| id.ends_with(":summary"))));

        assert_eq!(
            handler
                .store
                .receipt(receipt_id)
                .expect("receipt reread succeeds")
                .expect("receipt remains durable"),
            durable_before,
            "finish must not insert or alter the witnessed receipt",
        );
        assert_eq!(
            handler
                .store
                .operation(&evidence_operation)
                .expect("operation reread succeeds")
                .expect("operation remains durable"),
            operation_before,
            "finish must not alter the receipt operation",
        );
        assert_eq!(
            handler
                .store
                .audit_event(&evidence_operation)
                .expect("audit reread succeeds")
                .expect("audit remains durable"),
            audit_before,
            "finish must not append or alter the receipt audit fact",
        );
        drop(handler);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn witnessed_finish_rejects_missing_or_mismatched_durable_receipts() {
        let (mut handler, finish, root, _) = witnessed_finish_fixture("witnessed-finish-forgery");
        let mut cases = Vec::new();

        let mut forged = finish.clone();
        forged["receipt"]["receipt_id"] = json!("receipt-missing-witnessed");
        cases.push(("missing receipt", forged));
        let mutations = [
            ("project", "/project_id", json!("another-project")),
            ("work", "/receipt/subject/work_id", json!("another-work")),
            (
                "attempt",
                "/receipt/subject/attempt_id",
                json!("another-attempt"),
            ),
            ("fence", "/receipt/subject/fence", json!(2)),
            ("gate", "/receipt/subject/gate_id", json!("summary")),
            (
                "operation",
                "/receipt/operation_id",
                json!("op_forged_witnessed"),
            ),
            (
                "source",
                "/receipt/source_snapshot_hash",
                json!("source-forged"),
            ),
            ("config", "/receipt/config_identity", json!("config-forged")),
            (
                "output digest",
                "/receipt/output_digest",
                json!("sha256:forged"),
            ),
            (
                "output reference",
                "/receipt/output_ref",
                json!("/tmp/forged-output"),
            ),
            ("result", "/receipt/result", json!("failed")),
        ];
        for (label, pointer, value) in mutations {
            let mut forged = finish.clone();
            *forged.pointer_mut(pointer).expect("fixture pointer exists") = value;
            cases.push((label, forged));
        }

        for (index, (label, forged)) in cases.into_iter().enumerate() {
            let error = handler
                .finish_close(&forged, &format!("op_reject_witnessed_{index}"))
                .expect_err(label);
            assert_eq!(error.code, ErrorCode::ReceiptInvalid, "{label}");
            assert_eq!(error.outcome, ApplicationOutcome::Rejected, "{label}");
        }
        let attempt = handler
            .store
            .current_attempt_for_work("service-project", "service-work")
            .expect("attempt read succeeds")
            .expect("attempt remains current");
        assert_eq!(attempt.phase, AttemptPhase::Running);
        drop(handler);
        let _ = fs::remove_dir_all(root);
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
        handler
            .store
            .execute_batch(
                "UPDATE attempt
                 SET source_version_id = 'source-evidence-failure', config_identity = 'config-evidence-failure'
                 WHERE attempt_id = 'attempt-evidence-failure';",
            )
            .expect("attempt proof context binds");

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
        let summary_path = temp_path("finish-summary.md");
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
                "attestation": "external_attested",
                "result": "passed",
                "retention": null,
            }))
            .expect("finish receipt serializes"),
        )
        .expect("finish receipt writes");
        fs::write(
            &summary_path,
            "Completed work-1 with current verification evidence.\n",
        )
        .expect("finish summary writes");
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
            "--summary".to_owned(),
            summary_path.to_string_lossy().into_owned(),
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
        assert!(data["summary_body"]
            .as_str()
            .is_some_and(|body| body.contains("Completed work-1")));
        let _ = fs::remove_file(receipt_path);
        let _ = fs::remove_file(summary_path);
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
