//! Versioned Unix-socket transport for the installation-wide manager.

use super::*;
use boreal_protocol::{
    global_manager::{GlobalManagerRequest, REQUEST_SCHEMA},
    schema, Envelope, ProtocolError,
};
#[cfg(unix)]
use boreal_service::{
    JsonRequest, JsonResponse, TransportConfig, UnixSocketClient, UnixSocketServer,
};
use std::time::Duration;
#[cfg(unix)]
use std::{
    os::unix::{fs::PermissionsExt, net::UnixStream},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

static REQUEST_COUNTER: AtomicU64 = AtomicU64::new(0);

pub(crate) fn supports(parsed: &ParsedCommand) -> bool {
    global_commands::supported(&parsed.path)
}

#[cfg(unix)]
pub(crate) fn run_service(parsed: &ParsedCommand, _operation: &str) -> Result<CliResult, CliError> {
    let socket = parsed
        .options
        .socket
        .as_deref()
        .ok_or_else(|| CliError::invalid("global service run requires --socket PATH"))?;
    let socket = PathBuf::from(socket);
    if !socket.is_absolute() {
        return Err(CliError::invalid(
            "global service socket path must be absolute",
        ));
    }
    let _database = global_commands::ensure_global_root()?;
    let socket_parent = socket
        .parent()
        .ok_or_else(|| CliError::invalid("global service socket needs a parent directory"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        let mut builder = fs::DirBuilder::new();
        builder.recursive(true).mode(0o700);
        builder.create(socket_parent).map_err(|error| {
            CliError::invalid(format!(
                "cannot create global service socket directory: {error}"
            ))
        })?;
    }
    let socket_parent = fs::canonicalize(socket_parent).map_err(transport_error)?;
    if fs::metadata(&socket_parent)
        .map_err(transport_error)?
        .permissions()
        .mode()
        & 0o077
        != 0
    {
        return Err(CliError::invalid(
            "global service socket directory must be private (mode 0700)",
        ));
    }
    let socket = socket_parent.join(
        socket
            .file_name()
            .ok_or_else(|| CliError::invalid("invalid global service socket path"))?,
    );
    remove_stale_socket(&socket)?;
    let config = TransportConfig::default()
        .with_read_timeout(Some(Duration::from_millis(500)))
        .with_write_timeout(Some(Duration::from_secs(2)));
    let server = UnixSocketServer::bind(&socket, config).map_err(transport_error)?;
    #[cfg(unix)]
    fs::set_permissions(&socket, fs::Permissions::from_mode(0o600)).map_err(transport_error)?;
    server.set_nonblocking(true).map_err(transport_error)?;
    let signals = signal::SignalGuard::install().map_err(transport_error)?;
    let stopping = Arc::new(AtomicBool::new(false));
    let mut served = 0usize;
    let maximum = parsed.options.max_requests.unwrap_or(usize::MAX);
    while served < maximum && !stopping.load(Ordering::SeqCst) && signal::take_pending() == 0 {
        let stop_flag = stopping.clone();
        match server.try_serve_once(|request| dispatch_request(request, &stop_flag)) {
            Ok(boreal_service::ServeOnceOutcome::Served) => served += 1,
            Ok(boreal_service::ServeOnceOutcome::WouldBlock) => {
                thread::sleep(Duration::from_millis(20))
            }
            Err(boreal_service::TransportError::Accept(error)) => {
                return Err(transport_error(boreal_service::TransportError::Accept(
                    error,
                )));
            }
            // Every other failure occurs after accept and belongs to one
            // connection. Dropping that connection keeps the listener alive;
            // a response-write failure may follow a committed mutation, so
            // its durable operation receipt remains the only recovery path.
            Err(_) => continue,
        }
    }
    drop(signals);
    Ok(CliResult {
        outcome: ApplicationOutcome::Unchanged,
        data: Some(json!({"service":"stopped","socket":socket,"served_requests":served})),
        ..CliResult::default()
    })
}

#[cfg(not(unix))]
pub(crate) fn run_service(
    _parsed: &ParsedCommand,
    _operation: &str,
) -> Result<CliResult, CliError> {
    Err(CliError::with(
        ErrorCode::UnsupportedPlatform,
        ApplicationOutcome::Failed,
        "the global local service requires Unix-domain sockets",
    ))
}

#[cfg(unix)]
pub(crate) fn request(parsed: &ParsedCommand, operation: &str) -> Result<CliResult, CliError> {
    let socket = parsed
        .options
        .socket
        .as_deref()
        .ok_or_else(|| CliError::invalid("global service routing requires --socket"))?;
    let (command, payload) = global_commands::build_command(parsed)?;
    if command == "export" && !parsed.options.extra.contains_key("--out") {
        return Err(CliError::invalid(
            "global export through the service requires --out PATH so the backup can bypass interactive frame limits",
        ));
    }
    if command == "export" && parsed.options.extra.contains_key("--out") {
        // Backup payloads may exceed the interactive frame limit. Read and
        // write the consistent bundle through the same application/store
        // boundary, then return only bounded metadata to the CLI caller.
        let data = global_commands::execute_request(&command, &payload, operation)?;
        return Ok(CliResult {
            outcome: ApplicationOutcome::Unchanged,
            revision: data.get("revision").and_then(Value::as_u64),
            data: Some(data),
            as_of: Some(global_now_timestamp()),
            ..CliResult::default()
        });
    }
    if command == "import" {
        // Restore files can exceed the frame bound too. The CLI has already
        // validated the file and replacement intent; apply it through the
        // application/store boundary and return its bounded count summary.
        let data = global_commands::execute_request(&command, &payload, operation)?;
        return Ok(CliResult {
            outcome: ApplicationOutcome::Changed,
            data: Some(data),
            as_of: Some(global_now_timestamp()),
            ..CliResult::default()
        });
    }
    let body = json!({"api_version":API_VERSION,"schema_version":REQUEST_SCHEMA,"operation_id":operation,"command":command,"payload":payload});
    let unique_id = format!(
        "global-{}-{}",
        operation
            .chars()
            .filter(|value| value.is_ascii_alphanumeric() || *value == '-' || *value == '_')
            .take(48)
            .collect::<String>(),
        REQUEST_COUNTER.fetch_add(1, Ordering::Relaxed)
    );
    let request = JsonRequest::new(unique_id.clone(), body.to_string()).map_err(protocol_error)?;
    let config = TransportConfig::default()
        .with_read_timeout(Some(Duration::from_secs(3)))
        .with_write_timeout(Some(Duration::from_secs(3)));
    let mut client = UnixSocketClient::connect(socket, config).map_err(transport_error)?;
    let response = client.request(request).map_err(|error| {
        if global_commands::mutation(&command) {
            CliError::unknown_delivery(
                operation,
                format!("global service delivery is uncertain: {error}"),
            )
        } else {
            transport_error(error)
        }
    })?;
    if response.request_id() != unique_id {
        return Err(uncertain_response(
            global_commands::mutation(&command),
            operation,
            "global service response correlation did not match request",
        ));
    }
    let body = response.payload().ok_or_else(|| {
        uncertain_response(
            global_commands::mutation(&command),
            operation,
            "global service returned no response payload",
        )
    })?;
    let envelope: Envelope<Value> = serde_json::from_str(body).map_err(|error| {
        uncertain_response(
            global_commands::mutation(&command),
            operation,
            format!("invalid global service envelope: {error}"),
        )
    })?;
    envelope.validate().map_err(|error| {
        uncertain_response(
            global_commands::mutation(&command),
            operation,
            error.to_string(),
        )
    })?;
    if envelope.operation_id != operation {
        return Err(uncertain_response(
            global_commands::mutation(&command),
            operation,
            "global service operation ID did not match request",
        ));
    }
    if let Some(error) = envelope.error {
        return Err(CliError::from_envelope(
            error,
            envelope.outcome,
            Some(operation),
            Some(envelope.as_of),
            envelope.next_status_change_at,
            envelope.detail_ref,
        ));
    }
    let result = CliResult {
        outcome: envelope.outcome,
        revision: envelope.revision,
        data: envelope.data,
        as_of: Some(envelope.as_of),
        next_status_change_at: envelope.next_status_change_at,
        detail_ref: envelope.detail_ref,
        human: None,
    };
    if command == "export"
        && result.data.as_ref().and_then(|v| v.get("exported")) != Some(&Value::Bool(true))
    {
        if let Some(data) = result.data.as_ref() {
            global_commands::write_export(&parsed.options.extra, data)?;
        }
    }
    Ok(result)
}

#[cfg(not(unix))]
pub(crate) fn request(_parsed: &ParsedCommand, _operation: &str) -> Result<CliResult, CliError> {
    Err(CliError::with(
        ErrorCode::UnsupportedPlatform,
        ApplicationOutcome::Failed,
        "the global local service requires Unix-domain sockets",
    ))
}

#[cfg(unix)]
fn dispatch_request(
    request: JsonRequest,
    stopping: &AtomicBool,
) -> Result<JsonResponse, boreal_service::ProtocolError> {
    let request_id = request.request_id().to_owned();
    let parsed =
        serde_json::from_str::<GlobalManagerRequest>(request.payload()).map_err(|error| {
            boreal_service::ProtocolError::new(
                boreal_service::ProtocolErrorCode::InvalidPayload,
                format!("invalid global request: {error}"),
            )
        })?;
    if parsed.api_version != API_VERSION || parsed.schema_version != REQUEST_SCHEMA {
        let response = envelope_failure(
            &parsed.operation_id,
            ErrorCode::ProtocolMismatch,
            "global API or request schema version is unsupported",
        );
        return JsonResponse::success(
            request_id,
            serde_json::to_string(&response).unwrap_or_else(|_| "{}".to_owned()),
        )
        .map_err(|error| boreal_service::ProtocolError::new(error.code(), error.message()));
    }
    if parsed.operation_id.trim().is_empty() || parsed.command.trim().is_empty() {
        let response = envelope_failure(
            &parsed.operation_id,
            ErrorCode::InvalidArgument,
            "operation_id and command are required",
        );
        return JsonResponse::success(
            request_id,
            serde_json::to_string(&response).unwrap_or_else(|_| "{}".to_owned()),
        )
        .map_err(|error| boreal_service::ProtocolError::new(error.code(), error.message()));
    }
    if let Err(message) = parsed.validate() {
        let response = envelope_failure(&parsed.operation_id, ErrorCode::InvalidArgument, &message);
        return JsonResponse::success(
            request_id,
            serde_json::to_string(&response).unwrap_or_else(|_| "{}".to_owned()),
        )
        .map_err(|error| boreal_service::ProtocolError::new(error.code(), error.message()));
    }
    let result = if parsed.command == "service shutdown" {
        stopping.store(true, Ordering::SeqCst);
        Ok(json!({"stopping":true}))
    } else if parsed.command == "export"
        && parsed.payload.get("path").and_then(Value::as_str).is_none()
    {
        Err(CliError::invalid(
            "global export through the service requires a destination path",
        ))
    } else {
        global_commands::execute_request(&parsed.command, &parsed.payload, &parsed.operation_id)
    };
    let envelope = match result {
        Ok(data) => Envelope {
            api_version: API_VERSION.to_owned(),
            schema_version: schema::ENVELOPE.to_owned(),
            operation_id: parsed.operation_id,
            revision: data.get("revision").and_then(Value::as_u64),
            as_of: global_now_timestamp(),
            next_status_change_at: None,
            transport: TransportOutcome::Ok,
            outcome: if global_commands::mutation(&parsed.command) {
                ApplicationOutcome::Changed
            } else {
                ApplicationOutcome::Unchanged
            },
            data: Some(data),
            detail_ref: None,
            error: None,
        },
        Err(error) => envelope_from_cli_error(&parsed.operation_id, error),
    };
    JsonResponse::success(
        request_id,
        serde_json::to_string(&envelope).unwrap_or_else(|_| "{}".to_owned()),
    )
    .map_err(|error| boreal_service::ProtocolError::new(error.code(), error.message()))
}

#[cfg(unix)]
mod signal {
    use std::{
        io,
        os::raw::c_int,
        sync::atomic::{AtomicI32, Ordering},
    };
    const SIGINT: c_int = 2;
    const SIGTERM: c_int = 15;
    const SIGNAL_ERROR: usize = usize::MAX;
    static PENDING: AtomicI32 = AtomicI32::new(0);
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
            for (slot, number) in previous.iter_mut().zip([SIGINT, SIGTERM]) {
                let handler = unsafe { signal(number, record as usize) };
                if handler == SIGNAL_ERROR {
                    return Err(io::Error::last_os_error());
                }
                *slot = (number, handler);
            }
            Ok(Self { previous })
        }
    }
    impl Drop for SignalGuard {
        fn drop(&mut self) {
            for (number, handler) in self.previous {
                unsafe { signal(number, handler) };
            }
            PENDING.store(0, Ordering::SeqCst);
        }
    }
    pub(super) fn take_pending() -> c_int {
        PENDING.swap(0, Ordering::SeqCst)
    }
}

fn envelope_failure(operation: &str, code: ErrorCode, message: &str) -> Envelope<Value> {
    Envelope {
        api_version: API_VERSION.to_owned(),
        schema_version: schema::ENVELOPE.to_owned(),
        operation_id: if operation.trim().is_empty() {
            "op_global_invalid".to_owned()
        } else {
            operation.to_owned()
        },
        revision: None,
        as_of: global_now_timestamp(),
        next_status_change_at: None,
        transport: TransportOutcome::Ok,
        outcome: ApplicationOutcome::Rejected,
        data: None,
        detail_ref: None,
        error: Some(ProtocolError::new(code, message, false)),
    }
}

fn envelope_from_cli_error(operation: &str, error: CliError) -> Envelope<Value> {
    Envelope {
        api_version: API_VERSION.to_owned(),
        schema_version: schema::ENVELOPE.to_owned(),
        operation_id: if operation.trim().is_empty() {
            "op_global_invalid".to_owned()
        } else {
            operation.to_owned()
        },
        revision: None,
        as_of: global_now_timestamp(),
        next_status_change_at: error.next_status_change_at.clone(),
        transport: error.transport,
        outcome: error.outcome,
        data: None,
        detail_ref: error.detail_ref,
        error: Some(
            error
                .protocol_error
                .unwrap_or_else(|| ProtocolError::new(error.code, error.message, false)),
        ),
    }
}

fn uncertain_response(mutation: bool, operation: &str, message: impl Into<String>) -> CliError {
    if mutation {
        CliError::unknown_delivery(operation, message)
    } else {
        CliError::with(
            ErrorCode::ProtocolMismatch,
            ApplicationOutcome::Failed,
            message,
        )
    }
}

fn global_now_timestamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string()
}

#[cfg(unix)]
fn remove_stale_socket(path: &Path) -> Result<(), CliError> {
    use std::os::unix::fs::FileTypeExt;
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(CliError::with(
                ErrorCode::ServiceUnavailable,
                ApplicationOutcome::Failed,
                error.to_string(),
            ));
        }
    };
    if !metadata.file_type().is_socket() {
        return Err(CliError::with(
            ErrorCode::ServiceBusy,
            ApplicationOutcome::Busy,
            format!("global service socket path is occupied: {}", path.display()),
        ));
    }
    match UnixStream::connect(path) {
        Ok(_) => Err(CliError::with(
            ErrorCode::ServiceBusy,
            ApplicationOutcome::Busy,
            format!("global service is already running at {}", path.display()),
        )),
        Err(error)
            if matches!(
                error.kind(),
                std::io::ErrorKind::ConnectionRefused | std::io::ErrorKind::NotFound
            ) =>
        {
            fs::remove_file(path).map_err(|error| {
                CliError::with(
                    ErrorCode::ServiceUnavailable,
                    ApplicationOutcome::Failed,
                    format!("cannot remove stale global socket: {error}"),
                )
            })
        }
        Err(error) => Err(CliError::with(
            ErrorCode::ServiceUnavailable,
            ApplicationOutcome::Failed,
            format!("cannot verify global service socket: {error}"),
        )),
    }
}

fn protocol_error(error: boreal_service::ProtocolError) -> CliError {
    CliError::with(
        ErrorCode::ProtocolMismatch,
        ApplicationOutcome::Failed,
        error.message().to_owned(),
    )
}

fn transport_error(error: impl std::fmt::Display) -> CliError {
    CliError::with(
        ErrorCode::ServiceUnavailable,
        ApplicationOutcome::Failed,
        error.to_string(),
    )
}
