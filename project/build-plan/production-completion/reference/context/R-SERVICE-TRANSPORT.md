# R-SERVICE-TRANSPORT — crates/service/src/transport.rs

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `crates/service/src/transport.rs:L1–L280`  
**File SHA-256:** `f5cbc930d9c51efabfbcced0e6c1eabfef50ea8a26704eefad059efee6e78003`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Framing, local sockets, limits and interruption behavior; do not substitute fixture-controller success.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,280p' 'crates/service/src/transport.rs'
```

## Exact baseline excerpt

````text
    1 | //! Dependency-free local Unix-socket transport.
    2 | //!
    3 | //! Frames are prefixed by a four-byte, big-endian body length. The body is a
    4 | //! small JSON envelope containing a request ID and either a JSON payload or a
    5 | //! typed protocol error. The payload is kept as JSON text so this adapter does
    6 | //! not need to know about the versioned application protocol.
    7 | 
    8 | use std::fmt;
    9 | use std::fs;
   10 | use std::io::{self, Read, Write};
   11 | use std::path::{Path, PathBuf};
   12 | use std::time::Duration;
   13 | 
   14 | #[cfg(unix)]
   15 | use std::net::Shutdown;
   16 | #[cfg(unix)]
   17 | use std::os::unix::net::{UnixListener, UnixStream};
   18 | 
   19 | /// Default maximum encoded JSON body size, excluding the four-byte prefix.
   20 | pub const DEFAULT_MAX_FRAME_SIZE: usize = 1024 * 1024;
   21 | /// Fallback used by clients that receive the compatibility `None` timeout
   22 | /// configuration. Callers can still provide a shorter command-specific
   23 | /// timeout explicitly; no production client is allowed to wait forever.
   24 | pub const DEFAULT_CLIENT_IO_TIMEOUT: Duration = Duration::from_secs(30);
   25 | 
   26 | /// A read or write operation used in timeout errors.
   27 | #[derive(Clone, Copy, Debug, Eq, PartialEq)]
   28 | pub enum IoOperation {
   29 |     Read,
   30 |     Write,
   31 | }
   32 | 
   33 | impl fmt::Display for IoOperation {
   34 |     fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
   35 |         match self {
   36 |             Self::Read => formatter.write_str("read"),
   37 |             Self::Write => formatter.write_str("write"),
   38 |         }
   39 |     }
   40 | }
   41 | 
   42 | /// Transport settings shared by a local client and server.
   43 | #[derive(Clone, Debug, Eq, PartialEq)]
   44 | pub struct TransportConfig {
   45 |     /// Maximum JSON body size, excluding the length prefix.
   46 |     pub max_frame_size: usize,
   47 |     /// Optional timeout applied to socket reads.
   48 |     pub read_timeout: Option<Duration>,
   49 |     /// Optional timeout applied to socket writes.
   50 |     pub write_timeout: Option<Duration>,
   51 | }
   52 | 
   53 | impl Default for TransportConfig {
   54 |     fn default() -> Self {
   55 |         Self {
   56 |             max_frame_size: DEFAULT_MAX_FRAME_SIZE,
   57 |             read_timeout: None,
   58 |             write_timeout: None,
   59 |         }
   60 |     }
   61 | }
   62 | 
   63 | impl TransportConfig {
   64 |     /// Construct settings with a specific frame bound.
   65 |     pub fn new(max_frame_size: usize) -> Result<Self, TransportConfigError> {
   66 |         let config = Self {
   67 |             max_frame_size,
   68 |             ..Self::default()
   69 |         };
   70 |         config.validate()?;
   71 |         Ok(config)
   72 |     }
   73 | 
   74 |     /// Set the maximum encoded JSON body size.
   75 |     pub fn with_max_frame_size(mut self, max_frame_size: usize) -> Self {
   76 |         self.max_frame_size = max_frame_size;
   77 |         self
   78 |     }
   79 | 
   80 |     /// Set the socket read timeout.
   81 |     pub fn with_read_timeout(mut self, read_timeout: Option<Duration>) -> Self {
   82 |         self.read_timeout = read_timeout;
   83 |         self
   84 |     }
   85 | 
   86 |     /// Set the socket write timeout.
   87 |     pub fn with_write_timeout(mut self, write_timeout: Option<Duration>) -> Self {
   88 |         self.write_timeout = write_timeout;
   89 |         self
   90 |     }
   91 | 
   92 |     /// Validate settings before opening a socket.
   93 |     pub fn validate(&self) -> Result<(), TransportConfigError> {
   94 |         if self.max_frame_size == 0 {
   95 |             return Err(TransportConfigError::ZeroFrameSize);
   96 |         }
   97 |         if self.max_frame_size > u32::MAX as usize {
   98 |             return Err(TransportConfigError::FrameSizeExceedsPrefix);
   99 |         }
  100 |         if self.read_timeout == Some(Duration::ZERO) {
  101 |             return Err(TransportConfigError::ZeroTimeout(IoOperation::Read));
  102 |         }
  103 |         if self.write_timeout == Some(Duration::ZERO) {
  104 |             return Err(TransportConfigError::ZeroTimeout(IoOperation::Write));
  105 |         }
  106 |         Ok(())
  107 |     }
  108 | }
  109 | 
  110 | /// Invalid transport settings.
  111 | #[derive(Clone, Copy, Debug, Eq, PartialEq)]
  112 | pub enum TransportConfigError {
  113 |     ZeroFrameSize,
  114 |     FrameSizeExceedsPrefix,
  115 |     ZeroTimeout(IoOperation),
  116 | }
  117 | 
  118 | impl fmt::Display for TransportConfigError {
  119 |     fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
  120 |         match self {
  121 |             Self::ZeroFrameSize => formatter.write_str("maximum frame size must be positive"),
  122 |             Self::FrameSizeExceedsPrefix => {
  123 |                 formatter.write_str("maximum frame size does not fit the length prefix")
  124 |             }
  125 |             Self::ZeroTimeout(operation) => {
  126 |                 write!(formatter, "{operation} timeout must be positive")
  127 |             }
  128 |         }
  129 |     }
  130 | }
  131 | 
  132 | impl std::error::Error for TransportConfigError {}
  133 | 
  134 | /// Stable categories for malformed or rejected JSON envelopes.
  135 | #[derive(Clone, Copy, Debug, Eq, PartialEq)]
  136 | pub enum ProtocolErrorCode {
  137 |     InvalidJson,
  138 |     InvalidEnvelope,
  139 |     MissingField,
  140 |     DuplicateField,
  141 |     UnknownField,
  142 |     InvalidField,
  143 |     InvalidPayload,
  144 |     Busy,
  145 |     UnknownErrorCode,
  146 | }
  147 | 
  148 | impl ProtocolErrorCode {
  149 |     fn as_str(self) -> &'static str {
  150 |         match self {
  151 |             Self::InvalidJson => "invalid_json",
  152 |             Self::InvalidEnvelope => "invalid_envelope",
  153 |             Self::MissingField => "missing_field",
  154 |             Self::DuplicateField => "duplicate_field",
  155 |             Self::UnknownField => "unknown_field",
  156 |             Self::InvalidField => "invalid_field",
  157 |             Self::InvalidPayload => "invalid_payload",
  158 |             Self::Busy => "busy",
  159 |             Self::UnknownErrorCode => "unknown_error_code",
  160 |         }
  161 |     }
  162 | 
  163 |     fn from_str(value: &str) -> Option<Self> {
  164 |         Some(match value {
  165 |             "invalid_json" => Self::InvalidJson,
  166 |             "invalid_envelope" => Self::InvalidEnvelope,
  167 |             "missing_field" => Self::MissingField,
  168 |             "duplicate_field" => Self::DuplicateField,
  169 |             "unknown_field" => Self::UnknownField,
  170 |             "invalid_field" => Self::InvalidField,
  171 |             "invalid_payload" => Self::InvalidPayload,
  172 |             "busy" => Self::Busy,
  173 |             "unknown_error_code" => Self::UnknownErrorCode,
  174 |             _ => return None,
  175 |         })
  176 |     }
  177 | }
  178 | 
  179 | impl fmt::Display for ProtocolErrorCode {
  180 |     fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
  181 |         formatter.write_str(self.as_str())
  182 |     }
  183 | }
  184 | 
  185 | /// A protocol error that can be returned by the local service.
  186 | #[derive(Clone, Debug, Eq, PartialEq)]
  187 | pub struct ProtocolError {
  188 |     code: ProtocolErrorCode,
  189 |     message: String,
  190 |     busy: Option<crate::BusyOutcome>,
  191 | }
  192 | 
  193 | impl ProtocolError {
  194 |     pub fn new(code: ProtocolErrorCode, message: impl Into<String>) -> Self {
  195 |         Self {
  196 |             code,
  197 |             message: message.into(),
  198 |             busy: None,
  199 |         }
  200 |     }
  201 | 
  202 |     pub fn with_busy(outcome: crate::BusyOutcome) -> Self {
  203 |         Self {
  204 |             code: ProtocolErrorCode::Busy,
  205 |             message: outcome.to_string(),
  206 |             busy: Some(outcome),
  207 |         }
  208 |     }
  209 | 
  210 |     pub fn code(&self) -> ProtocolErrorCode {
  211 |         self.code
  212 |     }
  213 | 
  214 |     pub fn message(&self) -> &str {
  215 |         &self.message
  216 |     }
  217 | 
  218 |     pub fn busy_outcome(&self) -> Option<&crate::BusyOutcome> {
  219 |         self.busy.as_ref()
  220 |     }
  221 | }
  222 | 
  223 | impl fmt::Display for ProtocolError {
  224 |     fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
  225 |         write!(
  226 |             formatter,
  227 |             "protocol error ({}): {}",
  228 |             self.code, self.message
  229 |         )
  230 |     }
  231 | }
  232 | 
  233 | impl std::error::Error for ProtocolError {}
  234 | 
  235 | /// A JSON request envelope.
  236 | #[derive(Clone, Debug, Eq, PartialEq)]
  237 | pub struct JsonRequest {
  238 |     request_id: String,
  239 |     payload: String,
  240 | }
  241 | 
  242 | impl JsonRequest {
  243 |     /// Create a request from a correlation ID and a complete JSON value.
  244 |     pub fn new(
  245 |         request_id: impl Into<String>,
  246 |         payload: impl Into<String>,
  247 |     ) -> Result<Self, ProtocolError> {
  248 |         let request_id = request_id.into();
  249 |         let payload = payload.into();
  250 |         validate_request_id(&request_id)?;
  251 |         validate_json(payload.as_bytes())
  252 |             .map_err(|message| ProtocolError::new(ProtocolErrorCode::InvalidPayload, message))?;
  253 |         Ok(Self {
  254 |             request_id,
  255 |             payload,
  256 |         })
  257 |     }
  258 | 
  259 |     pub fn request_id(&self) -> &str {
  260 |         &self.request_id
  261 |     }
  262 | 
  263 |     pub fn payload(&self) -> &str {
  264 |         &self.payload
  265 |     }
  266 | 
  267 |     pub fn into_payload(self) -> String {
  268 |         self.payload
  269 |     }
  270 | }
  271 | 
  272 | /// A JSON response envelope. A response contains either `payload` or `error`.
  273 | #[derive(Clone, Debug, Eq, PartialEq)]
  274 | pub struct JsonResponse {
  275 |     request_id: String,
  276 |     payload: Option<String>,
  277 |     error: Option<ProtocolError>,
  278 | }
  279 | 
  280 | impl JsonResponse {
````
