//! Dependency-free local Unix-socket transport.
//!
//! Frames are prefixed by a four-byte, big-endian body length. The body is a
//! small JSON envelope containing a request ID and either a JSON payload or a
//! typed protocol error. The payload is kept as JSON text so this adapter does
//! not need to know about the versioned application protocol.

use std::fmt;
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

#[cfg(unix)]
use std::os::unix::net::{UnixListener, UnixStream};

/// Default maximum encoded JSON body size, excluding the four-byte prefix.
pub const DEFAULT_MAX_FRAME_SIZE: usize = 1024 * 1024;

/// A read or write operation used in timeout errors.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum IoOperation {
    Read,
    Write,
}

impl fmt::Display for IoOperation {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Read => formatter.write_str("read"),
            Self::Write => formatter.write_str("write"),
        }
    }
}

/// Transport settings shared by a local client and server.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TransportConfig {
    /// Maximum JSON body size, excluding the length prefix.
    pub max_frame_size: usize,
    /// Optional timeout applied to socket reads.
    pub read_timeout: Option<Duration>,
    /// Optional timeout applied to socket writes.
    pub write_timeout: Option<Duration>,
}

impl Default for TransportConfig {
    fn default() -> Self {
        Self {
            max_frame_size: DEFAULT_MAX_FRAME_SIZE,
            read_timeout: None,
            write_timeout: None,
        }
    }
}

impl TransportConfig {
    /// Construct settings with a specific frame bound.
    pub fn new(max_frame_size: usize) -> Result<Self, TransportConfigError> {
        let config = Self {
            max_frame_size,
            ..Self::default()
        };
        config.validate()?;
        Ok(config)
    }

    /// Set the maximum encoded JSON body size.
    pub fn with_max_frame_size(mut self, max_frame_size: usize) -> Self {
        self.max_frame_size = max_frame_size;
        self
    }

    /// Set the socket read timeout.
    pub fn with_read_timeout(mut self, read_timeout: Option<Duration>) -> Self {
        self.read_timeout = read_timeout;
        self
    }

    /// Set the socket write timeout.
    pub fn with_write_timeout(mut self, write_timeout: Option<Duration>) -> Self {
        self.write_timeout = write_timeout;
        self
    }

    /// Validate settings before opening a socket.
    pub fn validate(&self) -> Result<(), TransportConfigError> {
        if self.max_frame_size == 0 {
            return Err(TransportConfigError::ZeroFrameSize);
        }
        if self.max_frame_size > u32::MAX as usize {
            return Err(TransportConfigError::FrameSizeExceedsPrefix);
        }
        if self.read_timeout == Some(Duration::ZERO) {
            return Err(TransportConfigError::ZeroTimeout(IoOperation::Read));
        }
        if self.write_timeout == Some(Duration::ZERO) {
            return Err(TransportConfigError::ZeroTimeout(IoOperation::Write));
        }
        Ok(())
    }
}

/// Invalid transport settings.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TransportConfigError {
    ZeroFrameSize,
    FrameSizeExceedsPrefix,
    ZeroTimeout(IoOperation),
}

impl fmt::Display for TransportConfigError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ZeroFrameSize => formatter.write_str("maximum frame size must be positive"),
            Self::FrameSizeExceedsPrefix => {
                formatter.write_str("maximum frame size does not fit the length prefix")
            }
            Self::ZeroTimeout(operation) => {
                write!(formatter, "{operation} timeout must be positive")
            }
        }
    }
}

impl std::error::Error for TransportConfigError {}

/// Stable categories for malformed or rejected JSON envelopes.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProtocolErrorCode {
    InvalidJson,
    InvalidEnvelope,
    MissingField,
    DuplicateField,
    UnknownField,
    InvalidField,
    InvalidPayload,
    Busy,
    UnknownErrorCode,
}

impl ProtocolErrorCode {
    fn as_str(self) -> &'static str {
        match self {
            Self::InvalidJson => "invalid_json",
            Self::InvalidEnvelope => "invalid_envelope",
            Self::MissingField => "missing_field",
            Self::DuplicateField => "duplicate_field",
            Self::UnknownField => "unknown_field",
            Self::InvalidField => "invalid_field",
            Self::InvalidPayload => "invalid_payload",
            Self::Busy => "busy",
            Self::UnknownErrorCode => "unknown_error_code",
        }
    }

    fn from_str(value: &str) -> Option<Self> {
        Some(match value {
            "invalid_json" => Self::InvalidJson,
            "invalid_envelope" => Self::InvalidEnvelope,
            "missing_field" => Self::MissingField,
            "duplicate_field" => Self::DuplicateField,
            "unknown_field" => Self::UnknownField,
            "invalid_field" => Self::InvalidField,
            "invalid_payload" => Self::InvalidPayload,
            "busy" => Self::Busy,
            "unknown_error_code" => Self::UnknownErrorCode,
            _ => return None,
        })
    }
}

impl fmt::Display for ProtocolErrorCode {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

/// A protocol error that can be returned by the local service.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProtocolError {
    code: ProtocolErrorCode,
    message: String,
    busy: Option<crate::BusyOutcome>,
}

impl ProtocolError {
    pub fn new(code: ProtocolErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            busy: None,
        }
    }

    pub fn with_busy(outcome: crate::BusyOutcome) -> Self {
        Self {
            code: ProtocolErrorCode::Busy,
            message: outcome.to_string(),
            busy: Some(outcome),
        }
    }

    pub fn code(&self) -> ProtocolErrorCode {
        self.code
    }

    pub fn message(&self) -> &str {
        &self.message
    }

    pub fn busy_outcome(&self) -> Option<&crate::BusyOutcome> {
        self.busy.as_ref()
    }
}

impl fmt::Display for ProtocolError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "protocol error ({}): {}",
            self.code, self.message
        )
    }
}

impl std::error::Error for ProtocolError {}

/// A JSON request envelope.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct JsonRequest {
    request_id: String,
    payload: String,
}

impl JsonRequest {
    /// Create a request from a correlation ID and a complete JSON value.
    pub fn new(
        request_id: impl Into<String>,
        payload: impl Into<String>,
    ) -> Result<Self, ProtocolError> {
        let request_id = request_id.into();
        let payload = payload.into();
        validate_request_id(&request_id)?;
        validate_json(payload.as_bytes())
            .map_err(|message| ProtocolError::new(ProtocolErrorCode::InvalidPayload, message))?;
        Ok(Self {
            request_id,
            payload,
        })
    }

    pub fn request_id(&self) -> &str {
        &self.request_id
    }

    pub fn payload(&self) -> &str {
        &self.payload
    }

    pub fn into_payload(self) -> String {
        self.payload
    }
}

/// A JSON response envelope. A response contains either `payload` or `error`.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct JsonResponse {
    request_id: String,
    payload: Option<String>,
    error: Option<ProtocolError>,
}

impl JsonResponse {
    /// Create a successful response from a complete JSON value.
    pub fn success(
        request_id: impl Into<String>,
        payload: impl Into<String>,
    ) -> Result<Self, ProtocolError> {
        let request_id = request_id.into();
        let payload = payload.into();
        validate_request_id(&request_id)?;
        validate_json(payload.as_bytes())
            .map_err(|message| ProtocolError::new(ProtocolErrorCode::InvalidPayload, message))?;
        Ok(Self {
            request_id,
            payload: Some(payload),
            error: None,
        })
    }

    pub fn failure(
        request_id: impl Into<String>,
        error: ProtocolError,
    ) -> Result<Self, ProtocolError> {
        let request_id = request_id.into();
        validate_request_id(&request_id)?;
        Ok(Self {
            request_id,
            payload: None,
            error: Some(error),
        })
    }

    pub fn request_id(&self) -> &str {
        &self.request_id
    }

    pub fn payload(&self) -> Option<&str> {
        self.payload.as_deref()
    }

    pub fn error(&self) -> Option<&ProtocolError> {
        self.error.as_ref()
    }
}

/// Errors observed while using the local transport.
#[derive(Debug)]
pub enum TransportError {
    Config(TransportConfigError),
    Accept(io::Error),
    Io(io::Error),
    Timeout(IoOperation),
    UnexpectedEof,
    FrameTooLarge { size: usize, maximum: usize },
    Protocol(ProtocolError),
    RemoteProtocol(ProtocolError),
    CorrelationMismatch { expected: String, actual: String },
}

impl fmt::Display for TransportError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Config(error) => error.fmt(formatter),
            Self::Accept(error) => write!(formatter, "accept failed: {error}"),
            Self::Io(error) => error.fmt(formatter),
            Self::Timeout(operation) => write!(formatter, "{operation} timed out"),
            Self::UnexpectedEof => {
                formatter.write_str("socket closed before a complete frame arrived")
            }
            Self::FrameTooLarge { size, maximum } => {
                write!(
                    formatter,
                    "frame body is {size} bytes; maximum is {maximum}"
                )
            }
            Self::Protocol(error) => error.fmt(formatter),
            Self::RemoteProtocol(error) => write!(formatter, "remote {error}"),
            Self::CorrelationMismatch { expected, actual } => write!(
                formatter,
                "response correlation mismatch: expected {expected:?}, got {actual:?}"
            ),
        }
    }
}

impl std::error::Error for TransportError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Config(error) => Some(error),
            Self::Accept(error) => Some(error),
            Self::Io(error) => Some(error),
            Self::Protocol(error) | Self::RemoteProtocol(error) => Some(error),
            Self::Timeout(_)
            | Self::UnexpectedEof
            | Self::FrameTooLarge { .. }
            | Self::CorrelationMismatch { .. } => None,
        }
    }
}

impl From<io::Error> for TransportError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

/// A client for one or more request/response exchanges over a Unix socket.
#[cfg(unix)]
pub struct UnixSocketClient {
    stream: UnixStream,
    config: TransportConfig,
}

#[cfg(unix)]
impl UnixSocketClient {
    pub fn connect(
        path: impl AsRef<Path>,
        config: TransportConfig,
    ) -> Result<Self, TransportError> {
        config.validate().map_err(TransportError::Config)?;
        let path = path.as_ref();
        require_absolute_socket_path(path)?;
        let stream = UnixStream::connect(path).map_err(map_io(IoOperation::Read))?;
        configure_stream(&stream, &config)?;
        Ok(Self { stream, config })
    }

    /// Send one request and return only a response with the same request ID.
    pub fn request(&mut self, request: JsonRequest) -> Result<JsonResponse, TransportError> {
        write_frame(&mut self.stream, &self.config, &encode_request(&request))?;
        let response = read_response(&mut self.stream, &self.config)?;
        if response.request_id() != request.request_id() {
            return Err(TransportError::CorrelationMismatch {
                expected: request.request_id().to_owned(),
                actual: response.request_id().to_owned(),
            });
        }
        if let Some(error) = response.error().cloned() {
            return Err(TransportError::RemoteProtocol(error));
        }
        Ok(response)
    }
}

/// A small request-at-a-time Unix socket server.
#[cfg(unix)]
pub struct UnixSocketServer {
    listener: UnixListener,
    socket_path: PathBuf,
    config: TransportConfig,
}

/// One accepted client connection detached from the listener.
///
/// The host uses this handoff to read a bounded request on the acceptor and
/// then queue application execution on a worker. Keeping the stream with the
/// request preserves correlation and lets a worker write the response without
/// holding up unrelated accepts.
#[cfg(unix)]
pub(crate) struct UnixSocketConnection {
    stream: UnixStream,
    config: TransportConfig,
}

#[cfg(unix)]
impl UnixSocketServer {
    pub fn bind(path: impl AsRef<Path>, config: TransportConfig) -> Result<Self, TransportError> {
        config.validate().map_err(TransportError::Config)?;
        let socket_path = path.as_ref().to_owned();
        require_absolute_socket_path(&socket_path)?;
        let listener = UnixListener::bind(&socket_path).map_err(map_io(IoOperation::Read))?;
        // Unix socket permissions are established by the process umask and
        // the private runtime directory. macOS rejects chmod(2) on a live
        // socket with EPERM, so do not turn a successfully bound endpoint
        // into a failed service merely because its mode cannot be rewritten.
        Ok(Self {
            listener,
            socket_path,
            config,
        })
    }

    pub fn socket_path(&self) -> &Path {
        &self.socket_path
    }

    /// Configure whether `accept` should return immediately when no client is
    /// waiting. A long-lived host uses nonblocking accepts so its shutdown
    /// signal can be observed without closing the listener from another
    /// thread.
    pub fn set_nonblocking(&self, nonblocking: bool) -> Result<(), TransportError> {
        self.listener
            .set_nonblocking(nonblocking)
            .map_err(map_io(IoOperation::Read))
    }

    /// Accept one client without dispatching its application request.
    pub(crate) fn try_accept(&self) -> Result<Option<UnixSocketConnection>, TransportError> {
        let (stream, _) = match self.listener.accept() {
            Ok(connection) => connection,
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => return Ok(None),
            Err(error) => return Err(TransportError::Accept(error)),
        };
        configure_stream(&stream, &self.config)?;
        Ok(Some(UnixSocketConnection {
            stream,
            config: self.config.clone(),
        }))
    }

    /// Accept one client, dispatch one request, and write one response.
    pub fn serve_once<F>(&self, handler: F) -> Result<(), TransportError>
    where
        F: FnOnce(JsonRequest) -> Result<JsonResponse, ProtocolError>,
    {
        match self.try_serve_once(handler)? {
            ServeOnceOutcome::Served => Ok(()),
            ServeOnceOutcome::WouldBlock => Err(TransportError::Timeout(IoOperation::Read)),
        }
    }

    /// Try to accept and dispatch one client without blocking at the listener.
    ///
    /// The listener must have been placed in nonblocking mode with
    /// [`Self::set_nonblocking`]. On a blocking listener this behaves like
    /// [`Self::serve_once`].
    pub fn try_serve_once<F>(&self, handler: F) -> Result<ServeOnceOutcome, TransportError>
    where
        F: FnOnce(JsonRequest) -> Result<JsonResponse, ProtocolError>,
    {
        let Some(mut connection) = self.try_accept()? else {
            return Ok(ServeOnceOutcome::WouldBlock);
        };
        let request = connection.read_request()?;
        let response = match handler(request.clone()) {
            Ok(response) => response,
            Err(error) => JsonResponse::failure(request.request_id(), error)
                .map_err(TransportError::Protocol)?,
        };
        connection.write_response(&response)?;
        Ok(ServeOnceOutcome::Served)
    }
}

#[cfg(unix)]
impl UnixSocketConnection {
    pub(crate) fn read_request(&mut self) -> Result<JsonRequest, TransportError> {
        let body = read_frame(&mut self.stream, &self.config)?;
        decode_request(&body).map_err(TransportError::Protocol)
    }

    pub(crate) fn write_response(mut self, response: &JsonResponse) -> Result<(), TransportError> {
        write_frame(&mut self.stream, &self.config, &encode_response(response))
    }

    pub(crate) fn write_protocol_error(
        self,
        request_id: &str,
        error: ProtocolError,
    ) -> Result<(), TransportError> {
        let response = JsonResponse::failure(request_id.to_owned(), error)
            .map_err(TransportError::Protocol)?;
        self.write_response(&response)
    }
}

#[cfg(unix)]
fn require_absolute_socket_path(path: &Path) -> Result<(), TransportError> {
    if path.is_absolute() {
        Ok(())
    } else {
        Err(TransportError::Io(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Unix socket path must be absolute",
        )))
    }
}

/// Result of a nonblocking server accept attempt.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ServeOnceOutcome {
    Served,
    WouldBlock,
}

#[cfg(unix)]
impl Drop for UnixSocketServer {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.socket_path);
    }
}

#[cfg(unix)]
fn configure_stream(stream: &UnixStream, config: &TransportConfig) -> Result<(), TransportError> {
    // A listener used by the host is nonblocking so its shutdown signal can
    // be observed. On macOS an accepted stream may retain that mode; restore
    // blocking behavior before the bounded read/write timeouts are applied so
    // a client that has connected but has not written its frame yet is not
    // mistaken for a malformed or empty request.
    stream
        .set_nonblocking(false)
        .map_err(map_io(IoOperation::Read))?;
    stream
        .set_read_timeout(config.read_timeout)
        .map_err(map_io(IoOperation::Read))?;
    stream
        .set_write_timeout(config.write_timeout)
        .map_err(map_io(IoOperation::Write))?;
    Ok(())
}

fn map_io(operation: IoOperation) -> impl FnOnce(io::Error) -> TransportError {
    move |error| match error.kind() {
        io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock => TransportError::Timeout(operation),
        _ => TransportError::Io(error),
    }
}

fn write_frame<W: Write>(
    writer: &mut W,
    config: &TransportConfig,
    body: &str,
) -> Result<(), TransportError> {
    let size = body.len();
    ensure_frame_size(size, config)?;
    writer
        .write_all(&(size as u32).to_be_bytes())
        .map_err(map_io(IoOperation::Write))?;
    writer
        .write_all(body.as_bytes())
        .map_err(map_io(IoOperation::Write))?;
    writer.flush().map_err(map_io(IoOperation::Write))
}

fn read_frame<R: Read>(reader: &mut R, config: &TransportConfig) -> Result<String, TransportError> {
    let mut prefix = [0; 4];
    reader.read_exact(&mut prefix).map_err(map_read_error)?;
    let size = u32::from_be_bytes(prefix) as usize;
    ensure_frame_size(size, config)?;
    let mut body = vec![0; size];
    reader.read_exact(&mut body).map_err(map_read_error)?;
    String::from_utf8(body).map_err(|_| {
        TransportError::Protocol(ProtocolError::new(
            ProtocolErrorCode::InvalidJson,
            "frame body is not UTF-8",
        ))
    })
}

fn map_read_error(error: io::Error) -> TransportError {
    if error.kind() == io::ErrorKind::UnexpectedEof {
        TransportError::UnexpectedEof
    } else {
        map_io(IoOperation::Read)(error)
    }
}

fn ensure_frame_size(size: usize, config: &TransportConfig) -> Result<(), TransportError> {
    if size > config.max_frame_size {
        return Err(TransportError::FrameTooLarge {
            size,
            maximum: config.max_frame_size,
        });
    }
    Ok(())
}

#[cfg(unix)]
fn read_response<R: Read>(
    reader: &mut R,
    config: &TransportConfig,
) -> Result<JsonResponse, TransportError> {
    let body = read_frame(reader, config)?;
    decode_response(&body).map_err(TransportError::Protocol)
}

fn encode_request(request: &JsonRequest) -> String {
    format!(
        "{{\"request_id\":{},\"payload\":{}}}",
        quote_json_string(request.request_id()),
        request.payload()
    )
}

pub(crate) fn quote_json_string_value(value: &str) -> String {
    quote_json_string(value)
}

fn encode_response(response: &JsonResponse) -> String {
    let mut encoded = format!(
        "{{\"request_id\":{}",
        quote_json_string(response.request_id())
    );
    if let Some(payload) = response.payload() {
        encoded.push_str(",\"payload\":");
        encoded.push_str(payload);
    } else if let Some(error) = response.error() {
        encoded.push_str(",\"error\":{");
        encoded.push_str("\"code\":");
        encoded.push_str(&quote_json_string(error.code.as_str()));
        encoded.push_str(",\"message\":");
        encoded.push_str(&quote_json_string(&error.message));
        if let Some(busy) = error.busy_outcome() {
            encoded.push_str(",\"busy\":");
            encoded.push_str(&encode_busy_outcome(busy));
        }
        encoded.push('}');
    }
    encoded.push('}');
    encoded
}

fn decode_request(body: &str) -> Result<JsonRequest, ProtocolError> {
    let fields = parse_envelope(body.as_bytes())?;
    reject_unknown_fields(&fields, &["request_id", "payload"])?;
    let request_id = required_string(&fields, "request_id")?;
    let payload = required_raw_value(&fields, "payload")?;
    JsonRequest::new(request_id, payload)
        .map_err(|error| ProtocolError::new(ProtocolErrorCode::InvalidEnvelope, error.to_string()))
}

fn decode_response(body: &str) -> Result<JsonResponse, ProtocolError> {
    let fields = parse_envelope(body.as_bytes())?;
    reject_unknown_fields(&fields, &["request_id", "payload", "error"])?;
    let request_id = required_string(&fields, "request_id")?;
    let payload = fields.iter().find(|field| field.name == "payload");
    let error = fields.iter().find(|field| field.name == "error");
    match (payload, error) {
        (Some(_), Some(_)) => Err(ProtocolError::new(
            ProtocolErrorCode::InvalidEnvelope,
            "response cannot contain both payload and error",
        )),
        (Some(payload), None) => {
            JsonResponse::success(request_id, payload.value).map_err(|error| {
                ProtocolError::new(ProtocolErrorCode::InvalidEnvelope, error.to_string())
            })
        }
        (None, Some(error)) => {
            let error_fields = parse_envelope(error.value.as_bytes())?;
            reject_unknown_fields(&error_fields, &["code", "message", "busy"])?;
            let code = required_string(&error_fields, "code")?;
            let code = ProtocolErrorCode::from_str(&code).ok_or_else(|| {
                ProtocolError::new(
                    ProtocolErrorCode::UnknownErrorCode,
                    "unknown protocol error code",
                )
            })?;
            let message = required_string(&error_fields, "message")?;
            let busy = error_fields
                .iter()
                .find(|field| field.name == "busy")
                .map(|field| decode_busy_outcome(field.value))
                .transpose()?;
            let error = match busy {
                Some(busy) => ProtocolError::with_busy(busy),
                None => ProtocolError::new(code, message),
            };
            JsonResponse::failure(request_id, error).map_err(|error| {
                ProtocolError::new(ProtocolErrorCode::InvalidEnvelope, error.to_string())
            })
        }
        (None, None) => Err(ProtocolError::new(
            ProtocolErrorCode::MissingField,
            "response requires payload or error",
        )),
    }
}

fn encode_busy_outcome(outcome: &crate::BusyOutcome) -> String {
    match outcome {
        crate::BusyOutcome::WriterQueueFull {
            capacity,
            depth,
            retry_after_ms,
        } => format!(
            "{{\"kind\":\"writer_queue_full\",\"capacity\":{capacity},\"depth\":{depth},\"retry_after_ms\":{retry_after_ms}}}"
        ),
        crate::BusyOutcome::ReadPoolFull {
            capacity,
            depth,
            retry_after_ms,
        } => format!(
            "{{\"kind\":\"read_pool_full\",\"capacity\":{capacity},\"depth\":{depth},\"retry_after_ms\":{retry_after_ms}}}"
        ),
        crate::BusyOutcome::DispatchQueueFull {
            capacity,
            depth,
            retry_after_ms,
        } => format!(
            "{{\"kind\":\"dispatch_queue_full\",\"capacity\":{capacity},\"depth\":{depth},\"retry_after_ms\":{retry_after_ms}}}"
        ),
        crate::BusyOutcome::ProjectAlreadyOwned {
            project_id,
            owner_id,
        } => format!(
            "{{\"kind\":\"project_already_owned\",\"project_id\":{},\"owner_id\":{}}}",
            quote_json_string(project_id),
            owner_id
                .as_deref()
                .map(quote_json_string)
                .unwrap_or_else(|| "null".to_owned())
        ),
    }
}

fn decode_busy_outcome(raw: &str) -> Result<crate::BusyOutcome, ProtocolError> {
    let fields = parse_envelope(raw.as_bytes())?;
    let kind = required_string(&fields, "kind")?;
    match kind.as_str() {
        "writer_queue_full" => Ok(crate::BusyOutcome::WriterQueueFull {
            capacity: required_usize(&fields, "capacity")?,
            depth: required_usize(&fields, "depth")?,
            retry_after_ms: required_u64(&fields, "retry_after_ms")?,
        }),
        "read_pool_full" => Ok(crate::BusyOutcome::ReadPoolFull {
            capacity: required_usize(&fields, "capacity")?,
            depth: required_usize(&fields, "depth")?,
            retry_after_ms: required_u64(&fields, "retry_after_ms")?,
        }),
        "dispatch_queue_full" => Ok(crate::BusyOutcome::DispatchQueueFull {
            capacity: required_usize(&fields, "capacity")?,
            depth: required_usize(&fields, "depth")?,
            retry_after_ms: required_u64(&fields, "retry_after_ms")?,
        }),
        "project_already_owned" => {
            let owner = fields
                .iter()
                .find(|field| field.name == "owner_id")
                .ok_or_else(|| {
                    ProtocolError::new(ProtocolErrorCode::MissingField, "missing \"owner_id\"")
                })?;
            let owner_id = if owner.value == "null" {
                None
            } else {
                Some(parse_json_string_value(owner.value)?)
            };
            Ok(crate::BusyOutcome::ProjectAlreadyOwned {
                project_id: required_string(&fields, "project_id")?,
                owner_id,
            })
        }
        _ => Err(ProtocolError::new(
            ProtocolErrorCode::InvalidField,
            "unknown busy outcome kind",
        )),
    }
}

fn required_u64(fields: &[Field<'_>], name: &str) -> Result<u64, ProtocolError> {
    let value = required_raw_value(fields, name)?;
    value.parse::<u64>().map_err(|_| {
        ProtocolError::new(
            ProtocolErrorCode::InvalidField,
            format!("field {name:?} must be a non-negative integer"),
        )
    })
}

fn required_usize(fields: &[Field<'_>], name: &str) -> Result<usize, ProtocolError> {
    required_u64(fields, name)?.try_into().map_err(|_| {
        ProtocolError::new(
            ProtocolErrorCode::InvalidField,
            format!("field {name:?} is too large"),
        )
    })
}

fn validate_request_id(request_id: &str) -> Result<(), ProtocolError> {
    if request_id.is_empty() || request_id.chars().any(char::is_control) {
        return Err(ProtocolError::new(
            ProtocolErrorCode::InvalidField,
            "request_id must be non-empty and contain no control characters",
        ));
    }
    Ok(())
}

fn quote_json_string(value: &str) -> String {
    let mut quoted = String::with_capacity(value.len() + 2);
    quoted.push('"');
    for character in value.chars() {
        match character {
            '"' => quoted.push_str("\\\""),
            '\\' => quoted.push_str("\\\\"),
            '\n' => quoted.push_str("\\n"),
            '\r' => quoted.push_str("\\r"),
            '\t' => quoted.push_str("\\t"),
            '\u{08}' => quoted.push_str("\\b"),
            '\u{0c}' => quoted.push_str("\\f"),
            character if character.is_control() => {
                use std::fmt::Write as _;
                write!(quoted, "\\u{:04x}", character as u32)
                    .expect("writing to String cannot fail");
            }
            character => quoted.push(character),
        }
    }
    quoted.push('"');
    quoted
}

#[derive(Debug)]
struct Field<'a> {
    name: String,
    value: &'a str,
}

fn parse_envelope(body: &[u8]) -> Result<Vec<Field<'_>>, ProtocolError> {
    let mut cursor = 0;
    skip_whitespace(body, &mut cursor);
    if body.get(cursor) != Some(&b'{') {
        return Err(invalid_json("envelope must be a JSON object"));
    }
    cursor += 1;
    let mut fields = Vec::new();
    skip_whitespace(body, &mut cursor);
    if body.get(cursor) == Some(&b'}') {
        cursor += 1;
    } else {
        loop {
            skip_whitespace(body, &mut cursor);
            let (name, after_name) = parse_string(body, cursor)?;
            cursor = after_name;
            skip_whitespace(body, &mut cursor);
            expect_byte(body, &mut cursor, b':')?;
            skip_whitespace(body, &mut cursor);
            let value_start = cursor;
            cursor = parse_value(body, cursor)?;
            let value = std::str::from_utf8(&body[value_start..cursor])
                .map_err(|_| invalid_json("envelope contains non-UTF-8 JSON"))?;
            if fields.iter().any(|field: &Field<'_>| field.name == name) {
                return Err(ProtocolError::new(
                    ProtocolErrorCode::DuplicateField,
                    format!("field {name:?} appears more than once"),
                ));
            }
            fields.push(Field { name, value });
            skip_whitespace(body, &mut cursor);
            match body.get(cursor) {
                Some(b',') => cursor += 1,
                Some(b'}') => {
                    cursor += 1;
                    break;
                }
                _ => return Err(invalid_json("object fields must be comma-separated")),
            }
        }
    }
    skip_whitespace(body, &mut cursor);
    if cursor != body.len() {
        return Err(invalid_json("trailing data after JSON envelope"));
    }
    Ok(fields)
}

pub(crate) fn parse_json_object_fields(body: &str) -> Result<Vec<(String, String)>, ProtocolError> {
    parse_envelope(body.as_bytes()).map(|fields| {
        fields
            .into_iter()
            .map(|field| (field.name, field.value.to_owned()))
            .collect()
    })
}

pub(crate) fn parse_json_string_value(raw: &str) -> Result<String, ProtocolError> {
    let (value, end) = parse_string(raw.as_bytes(), 0)?;
    if end != raw.len() {
        return Err(ProtocolError::new(
            ProtocolErrorCode::InvalidField,
            "field must be a JSON string",
        ));
    }
    Ok(value)
}

fn reject_unknown_fields(fields: &[Field<'_>], allowed: &[&str]) -> Result<(), ProtocolError> {
    if let Some(field) = fields
        .iter()
        .find(|field| !allowed.contains(&field.name.as_str()))
    {
        return Err(ProtocolError::new(
            ProtocolErrorCode::UnknownField,
            format!("unknown envelope field {:?}", field.name),
        ));
    }
    Ok(())
}

fn required_string(fields: &[Field<'_>], name: &str) -> Result<String, ProtocolError> {
    let field = fields
        .iter()
        .find(|field| field.name == name)
        .ok_or_else(|| {
            ProtocolError::new(ProtocolErrorCode::MissingField, format!("missing {name:?}"))
        })?;
    let (value, end) = parse_string(field.value.as_bytes(), 0)?;
    if end != field.value.len() {
        return Err(ProtocolError::new(
            ProtocolErrorCode::InvalidField,
            format!("field {name:?} must be a JSON string"),
        ));
    }
    Ok(value)
}

fn required_raw_value<'a>(fields: &'a [Field<'a>], name: &str) -> Result<&'a str, ProtocolError> {
    fields
        .iter()
        .find(|field| field.name == name)
        .map(|field| field.value)
        .ok_or_else(|| {
            ProtocolError::new(ProtocolErrorCode::MissingField, format!("missing {name:?}"))
        })
}

fn validate_json(value: &[u8]) -> Result<(), String> {
    let mut cursor = 0;
    cursor = parse_value(value, cursor).map_err(|error| error.message)?;
    skip_whitespace(value, &mut cursor);
    if cursor == value.len() {
        Ok(())
    } else {
        Err("trailing data after JSON value".to_owned())
    }
}

fn invalid_json(message: impl Into<String>) -> ProtocolError {
    ProtocolError::new(ProtocolErrorCode::InvalidJson, message)
}

fn expect_byte(value: &[u8], cursor: &mut usize, expected: u8) -> Result<(), ProtocolError> {
    if value.get(*cursor) == Some(&expected) {
        *cursor += 1;
        Ok(())
    } else {
        Err(invalid_json(format!("expected {:?}", expected as char)))
    }
}

fn skip_whitespace(value: &[u8], cursor: &mut usize) {
    while value
        .get(*cursor)
        .is_some_and(|byte| matches!(byte, b' ' | b'\n' | b'\r' | b'\t'))
    {
        *cursor += 1;
    }
}

fn parse_value(value: &[u8], mut cursor: usize) -> Result<usize, ProtocolError> {
    skip_whitespace(value, &mut cursor);
    match value.get(cursor).copied() {
        Some(b'"') => parse_string(value, cursor).map(|(_, end)| end),
        Some(b'{') => parse_object_value(value, cursor),
        Some(b'[') => parse_array_value(value, cursor),
        Some(b't') => parse_literal(value, cursor, b"true"),
        Some(b'f') => parse_literal(value, cursor, b"false"),
        Some(b'n') => parse_literal(value, cursor, b"null"),
        Some(b'-' | b'0'..=b'9') => parse_number(value, cursor),
        _ => Err(invalid_json("expected a JSON value")),
    }
}

fn parse_object_value(value: &[u8], mut cursor: usize) -> Result<usize, ProtocolError> {
    cursor += 1;
    skip_whitespace(value, &mut cursor);
    if value.get(cursor) == Some(&b'}') {
        return Ok(cursor + 1);
    }
    loop {
        skip_whitespace(value, &mut cursor);
        let (_, after_name) = parse_string(value, cursor)?;
        cursor = after_name;
        skip_whitespace(value, &mut cursor);
        expect_byte(value, &mut cursor, b':')?;
        cursor = parse_value(value, cursor)?;
        skip_whitespace(value, &mut cursor);
        match value.get(cursor) {
            Some(b',') => cursor += 1,
            Some(b'}') => return Ok(cursor + 1),
            _ => return Err(invalid_json("object fields must be comma-separated")),
        }
    }
}

fn parse_array_value(value: &[u8], mut cursor: usize) -> Result<usize, ProtocolError> {
    cursor += 1;
    skip_whitespace(value, &mut cursor);
    if value.get(cursor) == Some(&b']') {
        return Ok(cursor + 1);
    }
    loop {
        cursor = parse_value(value, cursor)?;
        skip_whitespace(value, &mut cursor);
        match value.get(cursor) {
            Some(b',') => cursor += 1,
            Some(b']') => return Ok(cursor + 1),
            _ => return Err(invalid_json("array values must be comma-separated")),
        }
    }
}

fn parse_literal(value: &[u8], cursor: usize, literal: &[u8]) -> Result<usize, ProtocolError> {
    if value.get(cursor..cursor + literal.len()) == Some(literal) {
        Ok(cursor + literal.len())
    } else {
        Err(invalid_json("invalid JSON literal"))
    }
}

fn parse_number(value: &[u8], mut cursor: usize) -> Result<usize, ProtocolError> {
    if value.get(cursor) == Some(&b'-') {
        cursor += 1;
    }
    match value.get(cursor) {
        Some(b'0') => cursor += 1,
        Some(b'1'..=b'9') => {
            cursor += 1;
            while value.get(cursor).is_some_and(u8::is_ascii_digit) {
                cursor += 1;
            }
        }
        _ => return Err(invalid_json("invalid JSON number")),
    }
    if value.get(cursor) == Some(&b'.') {
        cursor += 1;
        let start = cursor;
        while value.get(cursor).is_some_and(u8::is_ascii_digit) {
            cursor += 1;
        }
        if cursor == start {
            return Err(invalid_json("JSON number fraction needs digits"));
        }
    }
    if value
        .get(cursor)
        .is_some_and(|byte| matches!(byte, b'e' | b'E'))
    {
        cursor += 1;
        if value
            .get(cursor)
            .is_some_and(|byte| matches!(byte, b'+' | b'-'))
        {
            cursor += 1;
        }
        let start = cursor;
        while value.get(cursor).is_some_and(u8::is_ascii_digit) {
            cursor += 1;
        }
        if cursor == start {
            return Err(invalid_json("JSON number exponent needs digits"));
        }
    }
    Ok(cursor)
}

fn parse_string(value: &[u8], mut cursor: usize) -> Result<(String, usize), ProtocolError> {
    if value.get(cursor) != Some(&b'"') {
        return Err(invalid_json("expected a JSON string"));
    }
    cursor += 1;
    let mut decoded = String::new();
    let mut segment_start = cursor;
    while cursor < value.len() {
        match value[cursor] {
            b'"' => {
                append_utf8_segment(&mut decoded, &value[segment_start..cursor])?;
                return Ok((decoded, cursor + 1));
            }
            b'\\' => {
                append_utf8_segment(&mut decoded, &value[segment_start..cursor])?;
                cursor += 1;
                let escape = *value
                    .get(cursor)
                    .ok_or_else(|| invalid_json("unfinished JSON escape"))?;
                match escape {
                    b'"' | b'\\' | b'/' => decoded.push(escape as char),
                    b'b' => decoded.push('\u{08}'),
                    b'f' => decoded.push('\u{0c}'),
                    b'n' => decoded.push('\n'),
                    b'r' => decoded.push('\r'),
                    b't' => decoded.push('\t'),
                    b'u' => {
                        let code = parse_hex_quad(value, cursor + 1)?;
                        let character = char::from_u32(code)
                            .ok_or_else(|| invalid_json("invalid Unicode escape"))?;
                        decoded.push(character);
                        cursor += 4;
                    }
                    _ => return Err(invalid_json("unknown JSON escape")),
                }
                cursor += 1;
                segment_start = cursor;
            }
            byte if byte < 0x20 => return Err(invalid_json("unescaped control in JSON string")),
            _ => cursor += 1,
        }
    }
    Err(invalid_json("unterminated JSON string"))
}

fn append_utf8_segment(output: &mut String, segment: &[u8]) -> Result<(), ProtocolError> {
    let segment = std::str::from_utf8(segment).map_err(|_| invalid_json("invalid UTF-8 string"))?;
    output.push_str(segment);
    Ok(())
}

fn parse_hex_quad(value: &[u8], start: usize) -> Result<u32, ProtocolError> {
    let mut code = 0;
    for byte in value
        .get(start..start + 4)
        .ok_or_else(|| invalid_json("short Unicode escape"))?
    {
        code = code * 16
            + u32::from(match byte {
                b'0'..=b'9' => byte - b'0',
                b'a'..=b'f' => byte - b'a' + 10,
                b'A'..=b'F' => byte - b'A' + 10,
                _ => return Err(invalid_json("invalid Unicode escape")),
            });
    }
    Ok(code)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::thread;
    use std::time::{SystemTime, UNIX_EPOCH};

    static SOCKET_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn temp_socket_path() -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock is after Unix epoch")
            .as_nanos();
        let counter = SOCKET_COUNTER.fetch_add(1, Ordering::Relaxed);
        // The managed macOS test sandbox may deny Unix-domain sockets below
        // its per-process temp directory; /private/tmp is the documented
        // writable local runtime area.
        PathBuf::from(format!(
            "/private/tmp/boreal-service-transport-{}-{nonce}-{counter}.sock",
            std::process::id()
        ))
    }

    #[cfg(unix)]
    #[test]
    fn in_process_server_client_round_trip_preserves_request_correlation() {
        let socket_path = temp_socket_path();
        let server = match UnixSocketServer::bind(&socket_path, TransportConfig::default()) {
            Ok(server) => server,
            Err(TransportError::Io(error)) if error.kind() == io::ErrorKind::PermissionDenied => {
                return
            }
            Err(error) => panic!("server bind failed: {error}"),
        };
        let mut client = match UnixSocketClient::connect(&socket_path, TransportConfig::default()) {
            Ok(client) => client,
            Err(TransportError::Io(error)) if error.kind() == io::ErrorKind::PermissionDenied => {
                return
            }
            Err(error) => panic!("client connect failed: {error}"),
        };
        let server_thread = thread::spawn(move || {
            server.serve_once(|request| {
                assert_eq!(request.request_id(), "request-7");
                assert_eq!(request.payload(), r#"{"op":"ping"}"#);
                JsonResponse::success(request.request_id(), r#"{"ok":true}"#)
            })
        });

        let response = client
            .request(JsonRequest::new("request-7", r#"{"op":"ping"}"#).unwrap())
            .unwrap();
        assert_eq!(response.request_id(), "request-7");
        assert_eq!(response.payload(), Some(r#"{"ok":true}"#));
        server_thread.join().unwrap().unwrap();
        assert!(!socket_path.exists());
    }

    #[cfg(unix)]
    #[test]
    fn mismatched_response_id_is_a_typed_transport_error() {
        let socket_path = temp_socket_path();
        let server = match UnixSocketServer::bind(&socket_path, TransportConfig::default()) {
            Ok(server) => server,
            Err(TransportError::Io(error)) if error.kind() == io::ErrorKind::PermissionDenied => {
                return
            }
            Err(error) => panic!("server bind failed: {error}"),
        };
        let mut client = match UnixSocketClient::connect(&socket_path, TransportConfig::default()) {
            Ok(client) => client,
            Err(TransportError::Io(error)) if error.kind() == io::ErrorKind::PermissionDenied => {
                return
            }
            Err(error) => panic!("client connect failed: {error}"),
        };
        let server_thread = thread::spawn(move || {
            server.serve_once(|_| JsonResponse::success("other-request", "null"))
        });
        let error = client
            .request(JsonRequest::new("request-1", "null").unwrap())
            .unwrap_err();
        assert!(matches!(
            error,
            TransportError::CorrelationMismatch { expected, actual }
                if expected == "request-1" && actual == "other-request"
        ));
        server_thread.join().unwrap().unwrap();
    }

    #[test]
    fn config_and_payload_bounds_are_checked_without_external_crates() {
        assert_eq!(
            TransportConfig::new(0),
            Err(TransportConfigError::ZeroFrameSize)
        );
        let error = JsonRequest::new("request-1", "not-json").unwrap_err();
        assert_eq!(error.code(), ProtocolErrorCode::InvalidPayload);

        let config = TransportConfig::default().with_max_frame_size(4);
        let mut output = Vec::new();
        let error = write_frame(&mut output, &config, "12345").unwrap_err();
        assert!(matches!(
            error,
            TransportError::FrameTooLarge {
                size: 5,
                maximum: 4
            }
        ));
    }

    #[cfg(unix)]
    #[test]
    fn relative_socket_paths_are_rejected_before_bind() {
        match UnixSocketServer::bind("boreal-relative.sock", TransportConfig::default()) {
            Err(TransportError::Io(error)) => {
                assert_eq!(error.kind(), io::ErrorKind::InvalidInput)
            }
            Err(error) => panic!("unexpected relative path error: {error}"),
            Ok(_) => panic!("relative socket path was accepted"),
        }
    }

    #[cfg(unix)]
    #[test]
    fn handler_protocol_errors_are_returned_as_remote_protocol_errors() {
        let socket_path = temp_socket_path();
        let server = match UnixSocketServer::bind(&socket_path, TransportConfig::default()) {
            Ok(server) => server,
            Err(TransportError::Io(error)) if error.kind() == io::ErrorKind::PermissionDenied => {
                return
            }
            Err(error) => panic!("server bind failed: {error}"),
        };
        let mut client = match UnixSocketClient::connect(&socket_path, TransportConfig::default()) {
            Ok(client) => client,
            Err(TransportError::Io(error)) if error.kind() == io::ErrorKind::PermissionDenied => {
                return
            }
            Err(error) => panic!("client connect failed: {error}"),
        };
        let server_thread = thread::spawn(move || {
            server.serve_once(|_| {
                Err(ProtocolError::new(
                    ProtocolErrorCode::InvalidField,
                    "request is not supported",
                ))
            })
        });
        let error = client
            .request(JsonRequest::new("request-2", "null").unwrap())
            .unwrap_err();
        assert!(matches!(
            error,
            TransportError::RemoteProtocol(error)
                if error.code() == ProtocolErrorCode::InvalidField
                    && error.message() == "request is not supported"
        ));
        server_thread.join().unwrap().unwrap();
        let _ = fs::remove_file(socket_path);
    }
}
