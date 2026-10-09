use std::{
    fmt, fs,
    path::Path,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};

use boreal_protocol::{
    global_manager::{
        GlobalDetailPageRequest, GlobalManagerRequest, DETAIL_PAGE_COMMAND, REQUEST_SCHEMA,
    },
    ApplicationOutcome, Envelope, ProtocolError, TransportOutcome, API_VERSION,
};
use boreal_service::{JsonRequest, TransportConfig, UnixSocketClient};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::Semaphore;

use crate::{
    config::{McpConfig, SCOPE_GLOBAL_READ, SCOPE_PROJECT_READ, SCOPE_PROJECT_WRITE},
    AuthenticatedPrincipal, MAX_SERVICE_FRAME_BYTES, MAX_TOOL_OUTPUT_BYTES,
};

const PROJECT_API_VERSION: &str = "2";
const PROJECT_SCHEMA_VERSION: &str = "boreal.protocol.envelope.v1";
const MAX_IDENTIFIER_BYTES: usize = 128;
const MAX_TEXT_BYTES: usize = 4096;
const MAX_PAGE_LIMIT: u32 = 50;
const MAX_PAGE_OFFSET: u64 = 100_000;
const MAX_OUTSTANDING_BACKEND_CALLS: usize = 32;

static READ_OPERATION_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone)]
pub enum AdapterError {
    PermissionDenied {
        scope: &'static str,
    },
    InvalidInput {
        field: &'static str,
        reason: &'static str,
    },
    ServiceUnavailable,
    UnknownOutcome {
        operation_id: String,
    },
    ProtocolMismatch,
    Application {
        operation_id: String,
        outcome: ApplicationOutcome,
        error: ProtocolError,
        revision: Option<u64>,
    },
    OutputTooLarge {
        bytes: usize,
    },
    BackendBusy,
}

impl fmt::Display for AdapterError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::PermissionDenied { scope } => write!(f, "permission denied; requires {scope}"),
            Self::InvalidInput { field, reason } => write!(f, "invalid {field}: {reason}"),
            Self::ServiceUnavailable => f.write_str("the configured Boreal local service is unavailable"),
            Self::UnknownOutcome { operation_id } => write!(
                f,
                "write outcome is unknown for {operation_id}; use operation_status with this same operation ID before retrying"
            ),
            Self::ProtocolMismatch => f.write_str("Boreal service response did not match the configured protocol version"),
            Self::Application { operation_id, outcome, error, revision } => write!(
                f,
                "Boreal rejected operation {operation_id} ({outcome:?}, {:?}, revision {:?}): {}",
                error.code, revision, error.message
            ),
            Self::OutputTooLarge { bytes } => write!(
                f,
                "Boreal response is {bytes} bytes; the MCP inline limit is {MAX_TOOL_OUTPUT_BYTES} bytes"
            ),
            Self::BackendBusy => f.write_str("Boreal MCP backend is at its bounded concurrency limit; retry shortly"),
        }
    }
}

impl std::error::Error for AdapterError {}

#[derive(Clone)]
pub struct BorealBackend {
    config: Arc<McpConfig>,
    permits: Arc<Semaphore>,
}

impl BorealBackend {
    pub fn new(config: Arc<McpConfig>) -> Self {
        Self {
            config,
            permits: Arc::new(Semaphore::new(MAX_OUTSTANDING_BACKEND_CALLS)),
        }
    }

    /// Reports local socket reachability for the operator CLI. It does not
    /// send credentials or enumerate any data and returns no socket paths.
    pub fn endpoint_status(config: &McpConfig) -> Value {
        let global = config
            .global
            .as_ref()
            .map(|endpoint| socket_reachable(&endpoint.socket));
        let projects = config
            .projects
            .iter()
            .map(|(project_id, endpoint)| {
                (
                    project_id.clone(),
                    Value::Bool(socket_reachable(&endpoint.socket)),
                )
            })
            .collect::<serde_json::Map<_, _>>();
        json!({ "global_socket_reachable": global, "project_sockets_reachable": projects })
    }

    pub fn capabilities(&self, principal: &AuthenticatedPrincipal) -> Value {
        let global_read = principal.has_scope(SCOPE_GLOBAL_READ) && self.config.global.is_some();
        let project_read = principal.has_scope(SCOPE_PROJECT_READ);
        let project_write = principal.has_scope(SCOPE_PROJECT_WRITE);
        json!({
            "mcp_protocol_version": crate::MCP_PROTOCOL_VERSION,
            "boreal_api_version": API_VERSION,
            "boreal_schema_version": boreal_protocol::schema::ENVELOPE,
            "transport": ["stdio", "streamable_http"],
            "global": {
                "available": global_read,
                "tools": if global_read { vec!["global_page"] } else { Vec::<&str>::new() },
                "write_tools": [],
                "send": "unavailable: no actor-aware Global service mutation contract is wired"
            },
            "projects": principal.project_ids.iter().filter(|project_id| self.config.projects.contains_key(*project_id)).map(|project_id| json!({
                "project_id": project_id,
                "read_available": project_read,
                "write_available": project_write,
                "tools": project_tool_names(project_read, project_write),
            })).collect::<Vec<_>>(),
            "unavailable": [
                "source and memory content reads await the digest-verified bounded-read service contract",
                "artifact body reads are not exposed",
                "Global writes, Send, and machine administration are not exposed"
            ],
        })
    }

    pub async fn project_status(
        &self,
        principal: &AuthenticatedPrincipal,
        project_id: String,
        limit: u32,
        offset: u64,
    ) -> Result<Value, AdapterError> {
        let project_id = self.authorize_project(principal, &project_id, SCOPE_PROJECT_READ)?;
        if !(1..=MAX_PAGE_LIMIT).contains(&limit) {
            return Err(AdapterError::InvalidInput {
                field: "limit",
                reason: "must be from 1 to 50",
            });
        }
        if offset > MAX_PAGE_OFFSET {
            return Err(AdapterError::InvalidInput {
                field: "offset",
                reason: "must be at most 100000",
            });
        }
        let operation_id = next_read_operation_id();
        let mut data = self.project_common(principal, &project_id, &operation_id)?;
        data["command"] = json!("status");
        data["limit"] = json!(limit);
        data["offset"] = json!(offset);
        self.project_call(&project_id, operation_id, data, false)
            .await
    }

    pub async fn project_work_show(
        &self,
        principal: &AuthenticatedPrincipal,
        project_id: String,
        work_id: String,
    ) -> Result<Value, AdapterError> {
        let project_id = self.authorize_project(principal, &project_id, SCOPE_PROJECT_READ)?;
        validate_identifier(&work_id, "work_id")?;
        let operation_id = next_read_operation_id();
        let mut data = self.project_common(principal, &project_id, &operation_id)?;
        data["command"] = json!("work_show");
        data["work_id"] = json!(work_id);
        self.project_call(&project_id, operation_id, data, false)
            .await
    }

    pub async fn project_source_list(
        &self,
        principal: &AuthenticatedPrincipal,
        project_id: String,
        limit: u32,
        offset: u64,
    ) -> Result<Value, AdapterError> {
        let project_id = self.authorize_project(principal, &project_id, SCOPE_PROJECT_READ)?;
        if !(1..=MAX_PAGE_LIMIT).contains(&limit) {
            return Err(AdapterError::InvalidInput {
                field: "limit",
                reason: "must be from 1 to 50",
            });
        }
        if offset > MAX_PAGE_OFFSET {
            return Err(AdapterError::InvalidInput {
                field: "offset",
                reason: "must be at most 100000",
            });
        }
        let operation_id = next_read_operation_id();
        let mut data = self.project_common(principal, &project_id, &operation_id)?;
        data["command"] = json!("source_list");
        data["limit"] = json!(limit);
        data["offset"] = json!(offset);
        self.project_call(&project_id, operation_id, data, false)
            .await
    }

    pub async fn project_operation_status(
        &self,
        principal: &AuthenticatedPrincipal,
        project_id: String,
        target_operation_id: String,
    ) -> Result<Value, AdapterError> {
        let project_id = self.authorize_project(principal, &project_id, SCOPE_PROJECT_READ)?;
        validate_operation_id(&target_operation_id)?;
        let operation_id = next_read_operation_id();
        let mut data = self.project_common(principal, &project_id, &operation_id)?;
        data["command"] = json!("operation_show");
        data["target_operation_id"] = json!(target_operation_id);
        self.project_call(&project_id, operation_id, data, false)
            .await
    }

    pub async fn project_work_edit(
        &self,
        principal: &AuthenticatedPrincipal,
        input: WorkEditInput,
    ) -> Result<Value, AdapterError> {
        let project_id =
            self.authorize_project(principal, &input.project_id, SCOPE_PROJECT_WRITE)?;
        validate_identifier(&input.work_id, "work_id")?;
        validate_operation_id(&input.operation_id)?;
        if input.expected_revision == 0 {
            return Err(AdapterError::InvalidInput {
                field: "expected_revision",
                reason: "must be a positive committed revision",
            });
        }
        if input
            .title
            .as_ref()
            .is_some_and(|value| value.trim().is_empty() || value.len() > MAX_TEXT_BYTES)
            || input
                .description
                .as_ref()
                .is_some_and(|value| value.len() > MAX_TEXT_BYTES)
        {
            return Err(AdapterError::InvalidInput {
                field: "title or description",
                reason: "title must be non-empty and text is limited to 4096 bytes",
            });
        }
        if input.title.is_none()
            && input.description.is_none()
            && input.parent_id.is_none()
            && input.priority.is_none()
            && input.dispatch_policy.is_none()
        {
            return Err(AdapterError::InvalidInput {
                field: "changes",
                reason: "at least one work field must be supplied",
            });
        }
        if let Some(parent_id) = input.parent_id.as_deref() {
            validate_identifier(parent_id, "parent_id")?;
        }
        if input
            .dispatch_policy
            .as_deref()
            .is_some_and(|value| !matches!(value, "automatic" | "operator_only" | "paused"))
        {
            return Err(AdapterError::InvalidInput {
                field: "dispatch_policy",
                reason: "must be automatic, operator_only, or paused",
            });
        }
        let operation_id = input.operation_id.clone();
        let mut data = self.project_common(principal, &project_id, &operation_id)?;
        data["command"] = json!("work_edit");
        data["work_id"] = json!(input.work_id);
        data["expected_revision"] = json!(input.expected_revision);
        data["title"] = input.title.map_or(Value::Null, Value::String);
        data["description"] = input.description.map_or(Value::Null, Value::String);
        data["parent_id"] = input.parent_id.map_or(Value::Null, Value::String);
        data["priority"] = input.priority.map_or(Value::Null, |value| json!(value));
        data["dispatch_policy"] = input.dispatch_policy.map_or(Value::Null, Value::String);
        self.project_call(&project_id, operation_id, data, true)
            .await
    }

    pub async fn project_work_claim(
        &self,
        principal: &AuthenticatedPrincipal,
        input: WorkClaimInput,
    ) -> Result<Value, AdapterError> {
        let project_id =
            self.authorize_project(principal, &input.project_id, SCOPE_PROJECT_WRITE)?;
        validate_identifier(&input.work_id, "work_id")?;
        validate_identifier(&input.attempt_id, "attempt_id")?;
        validate_identifier(&input.session_id, "session_id")?;
        validate_external_identity(&input.source_version_id, "source_version_id")?;
        validate_external_identity(&input.config_identity, "config_identity")?;
        validate_operation_id(&input.operation_id)?;
        if input.expected_revision == 0 {
            return Err(AdapterError::InvalidInput {
                field: "expected_revision",
                reason: "must be a positive committed revision",
            });
        }
        if input
            .lease_ttl_ms
            .is_some_and(|value| !(5_000..=3_600_000).contains(&value))
        {
            return Err(AdapterError::InvalidInput {
                field: "lease_ttl_ms",
                reason: "must be from 5000 to 3600000",
            });
        }
        if input
            .time_limit_ms
            .is_some_and(|value| !(30_000..=86_400_000).contains(&value))
        {
            return Err(AdapterError::InvalidInput {
                field: "time_limit_ms",
                reason: "must be from 30000 to 86400000",
            });
        }
        let operation_id = input.operation_id.clone();
        let mut data = self.project_common(principal, &project_id, &operation_id)?;
        data["command"] = json!("claim");
        data["work_id"] = json!(input.work_id);
        data["attempt_id"] = json!(input.attempt_id);
        data["session_id"] = json!(input.session_id);
        data["source_version_id"] = json!(input.source_version_id);
        data["config_identity"] = json!(input.config_identity);
        data["expected_revision"] = json!(input.expected_revision);
        if let Some(value) = input.lease_ttl_ms {
            data["lease_ttl_ms"] = json!(value);
        }
        if let Some(value) = input.time_limit_ms {
            data["time_limit_ms"] = json!(value);
        }
        self.project_call(&project_id, operation_id, data, true)
            .await
    }

    pub async fn global_page(
        &self,
        principal: &AuthenticatedPrincipal,
        collection: String,
        query: Option<String>,
        limit: u32,
        offset: u64,
    ) -> Result<Value, AdapterError> {
        self.authorize_global(principal)?;
        if !matches!(collection.as_str(), "projects" | "items" | "notes") {
            return Err(AdapterError::InvalidInput {
                field: "collection",
                reason: "must be projects, items, or notes",
            });
        }
        if !(1..=MAX_PAGE_LIMIT).contains(&limit) {
            return Err(AdapterError::InvalidInput {
                field: "limit",
                reason: "must be from 1 to 50",
            });
        }
        if offset > MAX_PAGE_OFFSET {
            return Err(AdapterError::InvalidInput {
                field: "offset",
                reason: "must be at most 100000",
            });
        }
        if query.as_ref().is_some_and(|value| value.len() > 256) {
            return Err(AdapterError::InvalidInput {
                field: "query",
                reason: "must be at most 256 bytes",
            });
        }
        let request_id = next_read_operation_id();
        let payload = GlobalDetailPageRequest {
            collection,
            project_id: None,
            query,
            kind: None,
            include_archived: false,
            limit: Some(limit),
            offset: Some(offset),
        };
        let request = GlobalManagerRequest {
            api_version: API_VERSION.into(),
            schema_version: REQUEST_SCHEMA.into(),
            operation_id: request_id.clone(),
            command: DETAIL_PAGE_COMMAND.into(),
            payload: serde_json::to_value(payload).map_err(|_| AdapterError::ProtocolMismatch)?,
        };
        request.validate().map_err(|_| AdapterError::InvalidInput {
            field: "Global request",
            reason: "does not satisfy the versioned Global service contract",
        })?;
        let encoded =
            serde_json::to_string(&request).map_err(|_| AdapterError::ProtocolMismatch)?;
        let response = self.global_call(encoded, request_id.clone()).await?;
        let size = serde_json::to_vec(&response)
            .map_err(|_| AdapterError::ProtocolMismatch)?
            .len();
        if size > MAX_TOOL_OUTPUT_BYTES {
            return Err(AdapterError::OutputTooLarge { bytes: size });
        }
        Ok(response)
    }

    fn authorize_project(
        &self,
        principal: &AuthenticatedPrincipal,
        project_id: &str,
        required_scope: &'static str,
    ) -> Result<String, AdapterError> {
        validate_identifier(project_id, "project_id")?;
        if !principal.has_scope(required_scope) || !principal.project_ids.contains(project_id) {
            return Err(AdapterError::PermissionDenied {
                scope: required_scope,
            });
        }
        if !self.config.projects.contains_key(project_id) {
            return Err(AdapterError::PermissionDenied {
                scope: required_scope,
            });
        }
        Ok(project_id.to_owned())
    }

    fn authorize_global(&self, principal: &AuthenticatedPrincipal) -> Result<(), AdapterError> {
        if !principal.has_scope(SCOPE_GLOBAL_READ) || self.config.global.is_none() {
            return Err(AdapterError::PermissionDenied {
                scope: SCOPE_GLOBAL_READ,
            });
        }
        Ok(())
    }

    fn project_common(
        &self,
        principal: &AuthenticatedPrincipal,
        project_id: &str,
        operation_id: &str,
    ) -> Result<Value, AdapterError> {
        let endpoint = self
            .config
            .projects
            .get(project_id)
            .ok_or(AdapterError::ServiceUnavailable)?;
        let env_name = endpoint
            .credential_env_by_actor
            .get(&principal.actor_id)
            .ok_or(AdapterError::PermissionDenied {
                scope: SCOPE_PROJECT_READ,
            })?;
        let credential = std::env::var(env_name).map_err(|_| AdapterError::ServiceUnavailable)?;
        if credential.is_empty() || credential.len() > 4096 {
            return Err(AdapterError::ServiceUnavailable);
        }
        Ok(json!({
            "project_id": project_id,
            "actor_id": principal.actor_id,
            "credential_ref": credential,
            "harness_id": "mcp",
            "session_id": format!("mcp-{}", principal.actor_id),
            "operation_id": operation_id,
        }))
    }

    async fn project_call(
        &self,
        project_id: &str,
        operation_id: String,
        data: Value,
        write: bool,
    ) -> Result<Value, AdapterError> {
        let endpoint = self
            .config
            .projects
            .get(project_id)
            .ok_or(AdapterError::ServiceUnavailable)?
            .clone();
        let permits = self.permits.clone();
        let project_id = project_id.to_owned();
        let payload = json!({
            "api_version": PROJECT_API_VERSION,
            "schema_version": PROJECT_SCHEMA_VERSION,
            "operation_id": operation_id,
            "data": data,
        });
        let encoded =
            serde_json::to_string(&payload).map_err(|_| AdapterError::ProtocolMismatch)?;
        let op = payload["operation_id"].as_str().unwrap().to_owned();
        let op_for_task = op.clone();
        let permit = permits
            .try_acquire_owned()
            .map_err(|_| AdapterError::BackendBusy)?;
        let result = tokio::task::spawn_blocking(move || {
            let _permit = permit;
            call_project_socket(&endpoint.socket, &project_id, &op_for_task, &encoded, write)
        })
        .await
        .map_err(|_| {
            if write {
                AdapterError::UnknownOutcome {
                    operation_id: op.clone(),
                }
            } else {
                AdapterError::ServiceUnavailable
            }
        })?;
        result
    }

    async fn global_call(
        &self,
        encoded: String,
        operation_id: String,
    ) -> Result<Value, AdapterError> {
        let endpoint = self
            .config
            .global
            .clone()
            .ok_or(AdapterError::ServiceUnavailable)?;
        let permits = self.permits.clone();
        let permit = permits
            .try_acquire_owned()
            .map_err(|_| AdapterError::BackendBusy)?;
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            call_global_socket(&endpoint.socket, &operation_id, &encoded)
        })
        .await
        .map_err(|_| AdapterError::ServiceUnavailable)?
    }
}

#[cfg(unix)]
fn socket_reachable(socket: &Path) -> bool {
    use std::os::unix::net::UnixStream;
    validate_private_socket(socket).is_ok() && UnixStream::connect(socket).is_ok()
}

#[cfg(not(unix))]
fn socket_reachable(_socket: &Path) -> bool {
    false
}

#[derive(Clone, Debug, Deserialize, Serialize, rmcp::schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct WorkEditInput {
    pub project_id: String,
    pub work_id: String,
    /// Stable Boreal operation identity; repeat the same ID after an uncertain result.
    pub operation_id: String,
    pub expected_revision: u64,
    pub title: Option<String>,
    pub description: Option<String>,
    pub parent_id: Option<String>,
    pub priority: Option<u8>,
    pub dispatch_policy: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, rmcp::schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct WorkClaimInput {
    pub project_id: String,
    pub work_id: String,
    /// Stable Boreal operation identity. It is independent of the MCP request ID.
    pub operation_id: String,
    pub attempt_id: String,
    pub session_id: String,
    pub source_version_id: String,
    pub config_identity: String,
    pub expected_revision: u64,
    pub lease_ttl_ms: Option<u64>,
    pub time_limit_ms: Option<u64>,
}

#[cfg(unix)]
fn call_project_socket(
    socket: &Path,
    project_id: &str,
    operation_id: &str,
    payload: &str,
    write: bool,
) -> Result<Value, AdapterError> {
    validate_private_socket(socket)?;
    if payload.len() > MAX_SERVICE_FRAME_BYTES {
        return Err(AdapterError::InvalidInput {
            field: "request",
            reason: "service frame exceeds configured size",
        });
    }
    let request = JsonRequest::new("mcp-project-call", payload)
        .map_err(|_| AdapterError::ProtocolMismatch)?;
    let config = TransportConfig::new(MAX_SERVICE_FRAME_BYTES)
        .map_err(|_| AdapterError::ProtocolMismatch)?
        .with_read_timeout(Some(Duration::from_secs(15)))
        .with_write_timeout(Some(Duration::from_secs(5)));
    let mut client = UnixSocketClient::connect(socket, config.clone())
        .map_err(|_| AdapterError::ServiceUnavailable)?;
    let response = client.request(request).map_err(|_| {
        if write {
            AdapterError::UnknownOutcome {
                operation_id: operation_id.into(),
            }
        } else {
            AdapterError::ServiceUnavailable
        }
    })?;
    let Some(body) = response.payload() else {
        return Err(if write {
            AdapterError::UnknownOutcome {
                operation_id: operation_id.into(),
            }
        } else {
            AdapterError::ProtocolMismatch
        });
    };
    if body.len() > MAX_SERVICE_FRAME_BYTES {
        return Err(AdapterError::OutputTooLarge { bytes: body.len() });
    }
    let transport: ProjectTransportResponse = serde_json::from_str(body).map_err(|_| {
        if write {
            AdapterError::UnknownOutcome {
                operation_id: operation_id.into(),
            }
        } else {
            AdapterError::ProtocolMismatch
        }
    })?;
    if transport.api_version != PROJECT_API_VERSION
        || transport.schema_version != PROJECT_SCHEMA_VERSION
        || transport.operation_id != operation_id
    {
        return Err(if write {
            AdapterError::UnknownOutcome {
                operation_id: operation_id.into(),
            }
        } else {
            AdapterError::ProtocolMismatch
        });
    }
    let envelope: Envelope<Value> = serde_json::from_str(&transport.data).map_err(|_| {
        if write {
            AdapterError::UnknownOutcome {
                operation_id: operation_id.into(),
            }
        } else {
            AdapterError::ProtocolMismatch
        }
    })?;
    envelope.validate().map_err(|_| {
        if write {
            AdapterError::UnknownOutcome {
                operation_id: operation_id.into(),
            }
        } else {
            AdapterError::ProtocolMismatch
        }
    })?;
    if envelope.operation_id != operation_id
        || envelope.transport != TransportOutcome::Ok
        || envelope.api_version != API_VERSION
    {
        return Err(if write {
            AdapterError::UnknownOutcome {
                operation_id: operation_id.into(),
            }
        } else {
            AdapterError::ProtocolMismatch
        });
    }
    Ok(envelope_value(envelope, project_id)?)
}

#[cfg(not(unix))]
fn call_project_socket(
    _socket: &Path,
    _project_id: &str,
    _operation_id: &str,
    _payload: &str,
    _write: bool,
) -> Result<Value, AdapterError> {
    Err(AdapterError::ServiceUnavailable)
}

#[cfg(unix)]
fn call_global_socket(
    socket: &Path,
    operation_id: &str,
    payload: &str,
) -> Result<Value, AdapterError> {
    validate_private_socket(socket)?;
    if payload.len() > MAX_SERVICE_FRAME_BYTES {
        return Err(AdapterError::InvalidInput {
            field: "request",
            reason: "service frame exceeds configured size",
        });
    }
    let request =
        JsonRequest::new("mcp-global-call", payload).map_err(|_| AdapterError::ProtocolMismatch)?;
    let config = TransportConfig::new(MAX_SERVICE_FRAME_BYTES)
        .map_err(|_| AdapterError::ProtocolMismatch)?
        .with_read_timeout(Some(Duration::from_secs(15)))
        .with_write_timeout(Some(Duration::from_secs(5)));
    let mut client =
        UnixSocketClient::connect(socket, config).map_err(|_| AdapterError::ServiceUnavailable)?;
    let response = client
        .request(request)
        .map_err(|_| AdapterError::ServiceUnavailable)?;
    let body = response.payload().ok_or(AdapterError::ProtocolMismatch)?;
    if body.len() > MAX_SERVICE_FRAME_BYTES {
        return Err(AdapterError::OutputTooLarge { bytes: body.len() });
    }
    let envelope: Envelope<Value> =
        serde_json::from_str(body).map_err(|_| AdapterError::ProtocolMismatch)?;
    envelope
        .validate()
        .map_err(|_| AdapterError::ProtocolMismatch)?;
    if envelope.operation_id != operation_id || envelope.api_version != API_VERSION {
        return Err(AdapterError::ProtocolMismatch);
    }
    envelope_value(envelope, "global")
}

#[cfg(not(unix))]
fn call_global_socket(
    _socket: &Path,
    _operation_id: &str,
    _payload: &str,
) -> Result<Value, AdapterError> {
    Err(AdapterError::ServiceUnavailable)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ProjectTransportResponse {
    api_version: String,
    schema_version: String,
    operation_id: String,
    data: String,
}

fn envelope_value(envelope: Envelope<Value>, _scope: &str) -> Result<Value, AdapterError> {
    if !envelope.outcome.is_success() {
        return Err(AdapterError::Application {
            operation_id: envelope.operation_id,
            outcome: envelope.outcome,
            error: envelope.error.ok_or(AdapterError::ProtocolMismatch)?,
            revision: envelope.revision,
        });
    }
    let value = json!({
        "api_version": envelope.api_version,
        "schema_version": envelope.schema_version,
        "operation_id": envelope.operation_id,
        "revision": envelope.revision,
        "outcome": envelope.outcome,
        "data": envelope.data,
    });
    let size = serde_json::to_vec(&value)
        .map_err(|_| AdapterError::ProtocolMismatch)?
        .len();
    if size > MAX_TOOL_OUTPUT_BYTES {
        return Err(AdapterError::OutputTooLarge { bytes: size });
    }
    Ok(value)
}

#[cfg(unix)]
fn validate_private_socket(socket: &Path) -> Result<(), AdapterError> {
    use std::os::unix::fs::{FileTypeExt, MetadataExt};
    unsafe extern "C" {
        fn geteuid() -> u32;
    }
    let metadata = fs::symlink_metadata(socket).map_err(|_| AdapterError::ServiceUnavailable)?;
    if metadata.file_type().is_symlink()
        || !metadata.file_type().is_socket()
        || metadata.uid() != unsafe { geteuid() }
        || metadata.mode() & 0o077 != 0
    {
        return Err(AdapterError::ServiceUnavailable);
    }
    let parent = socket.parent().ok_or(AdapterError::ServiceUnavailable)?;
    let parent_metadata =
        fs::symlink_metadata(parent).map_err(|_| AdapterError::ServiceUnavailable)?;
    if parent_metadata.file_type().is_symlink()
        || !parent_metadata.is_dir()
        || parent_metadata.uid() != unsafe { geteuid() }
        || parent_metadata.mode() & 0o077 != 0
    {
        return Err(AdapterError::ServiceUnavailable);
    }
    Ok(())
}

#[cfg(not(unix))]
fn validate_private_socket(_socket: &Path) -> Result<(), AdapterError> {
    Err(AdapterError::ServiceUnavailable)
}

fn validate_identifier(value: &str, field: &'static str) -> Result<(), AdapterError> {
    let valid = !value.is_empty()
        && value.len() <= MAX_IDENTIFIER_BYTES
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'));
    if valid {
        Ok(())
    } else {
        Err(AdapterError::InvalidInput {
            field,
            reason:
                "must contain only ASCII letters, digits, '.', '_' or '-' and be at most 128 bytes",
        })
    }
}

fn validate_external_identity(value: &str, field: &'static str) -> Result<(), AdapterError> {
    if !value.trim().is_empty() && value.len() <= 4096 && !value.chars().any(char::is_control) {
        Ok(())
    } else {
        Err(AdapterError::InvalidInput {
            field,
            reason: "must be non-empty, contain no control characters, and be at most 4096 bytes",
        })
    }
}

fn validate_operation_id(value: &str) -> Result<(), AdapterError> {
    let valid = value.strip_prefix("op_").is_some_and(|tail| {
        !tail.is_empty()
            && tail.len() <= MAX_IDENTIFIER_BYTES
            && tail
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
    });
    if valid {
        Ok(())
    } else {
        Err(AdapterError::InvalidInput {
            field: "operation_id",
            reason: "must start with 'op_' and use safe identifier characters",
        })
    }
}

fn next_read_operation_id() -> String {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let sequence = READ_OPERATION_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!(
        "op_mcp_read_{}_{}_{}",
        std::process::id(),
        timestamp,
        sequence
    )
}

fn project_tool_names(read: bool, write: bool) -> Vec<&'static str> {
    let mut result = Vec::new();
    if read {
        result.extend([
            "project_status",
            "project_work_show",
            "project_source_list",
            "operation_status",
        ]);
    }
    if write {
        result.extend(["project_work_edit", "project_work_claim"]);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{GlobalEndpoint, Policy, ProjectEndpoint};
    use std::{
        collections::{BTreeMap, BTreeSet},
        path::PathBuf,
    };

    fn test_backend() -> (BorealBackend, AuthenticatedPrincipal) {
        let config = Arc::new(McpConfig {
            version: 1,
            global: Some(GlobalEndpoint {
                socket: PathBuf::from("/tmp/global.sock"),
            }),
            projects: BTreeMap::from([(
                "project-a".into(),
                ProjectEndpoint {
                    socket: PathBuf::from("/tmp/project-a.sock"),
                    credential_env_by_actor: BTreeMap::from([(
                        "agent-a".into(),
                        "BOREAL_MCP_TEST_PROJECT_CREDENTIAL".into(),
                    )]),
                },
            )]),
            principals: BTreeMap::new(),
            stdio_profiles: BTreeMap::new(),
            http: None,
        });
        let policy = Policy {
            actor_id: "agent-a".into(),
            projects: BTreeSet::from(["project-a".into()]),
            scopes: BTreeSet::from([SCOPE_PROJECT_READ.into(), SCOPE_PROJECT_WRITE.into()]),
        };
        let principal = AuthenticatedPrincipal::from_stdio_policy("test", &policy, &config);
        (BorealBackend::new(config), principal)
    }

    #[tokio::test]
    async fn project_selection_is_explicit_and_scoped_before_socket_access() {
        let (backend, principal) = test_backend();
        let error = backend
            .project_work_show(&principal, "project-b".into(), "work-1".into())
            .await
            .unwrap_err();
        assert!(matches!(error, AdapterError::PermissionDenied { .. }));
        let error = backend
            .project_status(&principal, "project-a".into(), 51, 0)
            .await
            .unwrap_err();
        assert!(matches!(
            error,
            AdapterError::InvalidInput { field: "limit", .. }
        ));
    }

    #[tokio::test]
    async fn unsupported_global_mutation_cannot_be_dispatched() {
        let (backend, principal) = test_backend();
        assert_eq!(
            backend.capabilities(&principal)["global"]["write_tools"],
            json!([])
        );
        assert!(
            backend.capabilities(&principal)["unavailable"]
                .as_array()
                .unwrap()
                .len()
                >= 3
        );
    }

    #[test]
    fn generated_read_operations_are_durable_operation_ids_not_request_ids() {
        let first = next_read_operation_id();
        let second = next_read_operation_id();
        assert_ne!(first, second);
        assert!(first.starts_with("op_mcp_read_"));
    }

    #[test]
    fn claim_source_and_configuration_identities_preserve_service_contract_values() {
        assert!(validate_external_identity("sha256:abc123/config-v2", "config_identity").is_ok());
        assert!(validate_external_identity("", "source_version_id").is_err());
        assert!(validate_external_identity("source\nversion", "source_version_id").is_err());
    }
}
