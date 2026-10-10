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
    config::{
        McpConfig, SCOPE_GLOBAL_READ, SCOPE_PROJECT_EVIDENCE_WRITE, SCOPE_PROJECT_FINISH_CLOSE,
        SCOPE_PROJECT_READ, SCOPE_PROJECT_WRITE,
    },
    AuthenticatedPrincipal, MAX_SERVICE_FRAME_BYTES, MAX_TOOL_INPUT_BYTES, MAX_TOOL_OUTPUT_BYTES,
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
        readback: Option<Value>,
        protocol_error: Option<ProtocolError>,
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
            Self::UnknownOutcome {
                operation_id,
                protocol_error,
                ..
            } => write!(
                f,
                "write outcome is unknown for {operation_id}; {}; use operation_status with this same operation ID before retrying",
                protocol_error.as_ref().map_or("the service could not confirm its result", |error| error.message.as_str())
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
        // These operations depend on operation readback for safe recovery.
        // Report them only when the authenticated token has both the narrow
        // write grant and the Project read grant used by that recovery path.
        let evidence_write = project_read && principal.has_scope(SCOPE_PROJECT_EVIDENCE_WRITE);
        let finish_close = project_read && principal.has_scope(SCOPE_PROJECT_FINISH_CLOSE);
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
                "evidence_write_available": evidence_write,
                "finish_close_available": finish_close,
                "tools": project_tool_names(project_read, project_write, evidence_write, finish_close),
            })).collect::<Vec<_>>(),
            "unavailable": [
                "source and memory content reads await the digest-verified bounded-read service contract",
                "artifact body reads are not exposed",
                "Global writes and Send are not exposed",
                "evidence execution, review decisions, operator hold resolution, and machine administration are not exposed"
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

    pub async fn project_review_list(
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
        data["command"] = json!("review_list");
        data["limit"] = json!(limit);
        data["offset"] = json!(offset);
        self.project_call(&project_id, operation_id, data, false)
            .await
    }

    pub async fn project_review_show(
        &self,
        principal: &AuthenticatedPrincipal,
        project_id: String,
        review_id: String,
    ) -> Result<Value, AdapterError> {
        let project_id = self.authorize_project(principal, &project_id, SCOPE_PROJECT_READ)?;
        validate_identifier(&review_id, "review_id")?;
        let operation_id = next_read_operation_id();
        let mut data = self.project_common(principal, &project_id, &operation_id)?;
        data["command"] = json!("review_show");
        data["review_id"] = json!(review_id);
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
            .map_err(|error| match error {
                AdapterError::Application {
                    outcome,
                    error,
                    revision,
                    ..
                } => AdapterError::Application {
                    operation_id: target_operation_id,
                    outcome,
                    error,
                    revision,
                },
                other => other,
            })
    }

    /// Call the existing Project guide/next/resume service routes for a stable,
    /// client-selected session identity. The service still binds the actor from
    /// the authenticated principal and validates all attempt ownership.
    pub async fn project_agent_context(
        &self,
        principal: &AuthenticatedPrincipal,
        input: ProjectAgentContextInput,
        command: &'static str,
    ) -> Result<Value, AdapterError> {
        let project_id =
            self.authorize_project(principal, &input.project_id, SCOPE_PROJECT_READ)?;
        if !matches!(command, "guide" | "next" | "resume") {
            return Err(AdapterError::ProtocolMismatch);
        }
        validate_identifier(&input.session_id, "session_id")?;
        if let Some(work_id) = input.work_id.as_deref() {
            validate_identifier(work_id, "work_id")?;
        }
        if let Some(attempt_id) = input.attempt_id.as_deref() {
            validate_identifier(attempt_id, "attempt_id")?;
        }
        let operation_id = next_read_operation_id();
        let mut data = self.project_common_for_session(
            principal,
            &project_id,
            &operation_id,
            &input.session_id,
        )?;
        data["command"] = json!(command);
        data["work_id"] = input.work_id.map_or(Value::Null, Value::String);
        data["attempt_id"] = input.attempt_id.map_or(Value::Null, Value::String);
        self.project_call(&project_id, operation_id, data, false)
            .await
    }

    /// Register a caller's stable Project session through Boreal's existing
    /// session service command. The session ID is an audit label, not proof of
    /// the authenticated actor.
    pub async fn project_session_start(
        &self,
        principal: &AuthenticatedPrincipal,
        input: ProjectSessionStartInput,
    ) -> Result<Value, AdapterError> {
        let project_id =
            self.authorize_project(principal, &input.project_id, SCOPE_PROJECT_WRITE)?;
        validate_identifier(&input.session_id, "session_id")?;
        validate_operation_id(&input.operation_id)?;
        if input.expected_revision == 0 {
            return Err(AdapterError::InvalidInput {
                field: "expected_revision",
                reason: "must be a positive committed revision",
            });
        }
        let operation_id = input.operation_id.clone();
        let mut data = self.project_common_for_session(
            principal,
            &project_id,
            &operation_id,
            &input.session_id,
        )?;
        data["command"] = json!("session_start");
        data["expected_revision"] = json!(input.expected_revision);
        self.project_call(&project_id, operation_id, data, true)
            .await
    }

    /// End the caller's server-bound session through Boreal's existing
    /// session contract. This records the boundary; it does not invent or
    /// publish a handoff summary.
    pub async fn project_session_end(
        &self,
        principal: &AuthenticatedPrincipal,
        input: ProjectSessionEndInput,
    ) -> Result<Value, AdapterError> {
        let project_id =
            self.authorize_project(principal, &input.project_id, SCOPE_PROJECT_WRITE)?;
        validate_identifier(&input.session_id, "session_id")?;
        validate_operation_id(&input.operation_id)?;
        if input.expected_revision == 0 {
            return Err(AdapterError::InvalidInput {
                field: "expected_revision",
                reason: "must be a positive committed revision",
            });
        }
        let operation_id = input.operation_id.clone();
        let mut data = self.project_common_for_session(
            principal,
            &project_id,
            &operation_id,
            &input.session_id,
        )?;
        data["command"] = json!("session_end");
        data["expected_revision"] = json!(input.expected_revision);
        self.project_call(&project_id, operation_id, data, true)
            .await
    }

    /// Create a work item through the existing Project application command.
    /// The server supplies the actor and harness from the authenticated policy.
    pub async fn project_work_create(
        &self,
        principal: &AuthenticatedPrincipal,
        input: WorkCreateInput,
    ) -> Result<Value, AdapterError> {
        let project_id =
            self.authorize_project(principal, &input.project_id, SCOPE_PROJECT_WRITE)?;
        validate_identifier(&input.session_id, "session_id")?;
        if let Some(work_id) = input.work_id.as_deref() {
            validate_identifier(work_id, "work_id")?;
        }
        if let Some(parent_id) = input.parent_id.as_deref() {
            validate_identifier(parent_id, "parent_id")?;
        }
        if !matches!(input.kind.as_str(), "milestone" | "sprint" | "task") {
            return Err(AdapterError::InvalidInput {
                field: "kind",
                reason: "must be milestone, sprint, or task",
            });
        }
        if input.title.trim().is_empty() || input.title.len() > MAX_TEXT_BYTES {
            return Err(AdapterError::InvalidInput {
                field: "title",
                reason: "must be non-empty and at most 4096 bytes",
            });
        }
        if input.description.len() > MAX_TEXT_BYTES {
            return Err(AdapterError::InvalidInput {
                field: "description",
                reason: "must be at most 4096 bytes",
            });
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
        if input
            .hold
            .as_deref()
            .is_some_and(|value| validate_external_identity(value, "hold").is_err())
        {
            return Err(AdapterError::InvalidInput {
                field: "hold",
                reason: "must be a bounded non-empty identifier without control characters",
            });
        }
        if input
            .profile
            .as_deref()
            .is_some_and(|value| !matches!(value, "focused" | "reviewed"))
        {
            return Err(AdapterError::InvalidInput {
                field: "profile",
                reason: "must be focused or reviewed",
            });
        }
        validate_operation_id(&input.operation_id)?;
        if input.expected_revision == 0 {
            return Err(AdapterError::InvalidInput {
                field: "expected_revision",
                reason: "must be a positive committed revision",
            });
        }
        let operation_id = input.operation_id.clone();
        let mut data = self.project_common_for_session(
            principal,
            &project_id,
            &operation_id,
            &input.session_id,
        )?;
        data["command"] = json!("create_work");
        data["work_id"] = input.work_id.map_or(Value::Null, Value::String);
        data["kind"] = json!(input.kind);
        data["parent_id"] = input.parent_id.map_or(Value::Null, Value::String);
        data["title"] = json!(input.title);
        data["description"] = json!(input.description);
        data["priority"] = json!(input.priority);
        data["dispatch"] = json!(input.dispatch_policy.unwrap_or_else(|| "automatic".into()));
        data["hold"] = input.hold.map_or(Value::Null, Value::String);
        data["profile"] = json!(input.profile.unwrap_or_else(|| "focused".into()));
        data["profile_version"] = json!("1");
        data["expected_revision"] = json!(input.expected_revision);
        self.project_call(&project_id, operation_id, data, true)
            .await
    }

    /// Record a bounded, reason-coded wait using Boreal's existing work hold
    /// contract. Resolving an operator-owned hold is not exposed here.
    pub async fn project_work_wait(
        &self,
        principal: &AuthenticatedPrincipal,
        input: WorkWaitInput,
    ) -> Result<Value, AdapterError> {
        let project_id =
            self.authorize_project(principal, &input.project_id, SCOPE_PROJECT_WRITE)?;
        validate_identifier(&input.work_id, "work_id")?;
        validate_external_identity(&input.reason_code, "reason_code")?;
        validate_operation_id(&input.operation_id)?;
        if input.expected_revision == 0 {
            return Err(AdapterError::InvalidInput {
                field: "expected_revision",
                reason: "must be a positive committed revision",
            });
        }
        let operation_id = input.operation_id.clone();
        let mut data = self.project_common(principal, &project_id, &operation_id)?;
        data["command"] = json!("work_hold_add");
        data["work_id"] = json!(input.work_id);
        data["reason_code"] = json!(input.reason_code);
        data["expected_revision"] = json!(input.expected_revision);
        self.project_call(&project_id, operation_id, data, true)
            .await
    }

    /// Start or resume one task through the existing atomic agent.start route.
    /// A caller supplies only a stable session label and source/configuration
    /// identities from the current guide; actor and project authority remain
    /// server-bound.
    pub async fn project_agent_start(
        &self,
        principal: &AuthenticatedPrincipal,
        input: AgentStartInput,
    ) -> Result<Value, AdapterError> {
        let project_id =
            self.authorize_project(principal, &input.project_id, SCOPE_PROJECT_WRITE)?;
        validate_identifier(&input.session_id, "session_id")?;
        if let Some(work_id) = input.work_id.as_deref() {
            validate_identifier(work_id, "work_id")?;
        }
        if let Some(attempt_id) = input.attempt_id.as_deref() {
            validate_identifier(attempt_id, "attempt_id")?;
        }
        if input.fence.is_some_and(|fence| fence == 0)
            || input.attempt_id.is_some() != input.fence.is_some()
        {
            return Err(AdapterError::InvalidInput {
                field: "attempt_id or fence",
                reason: "attempt_id and a positive fence must be supplied together",
            });
        }
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
        let mut data = self.project_common_for_session(
            principal,
            &project_id,
            &operation_id,
            &input.session_id,
        )?;
        data["command"] = json!("start");
        data["work_id"] = input.work_id.map_or(Value::Null, Value::String);
        data["attempt_id"] = input.attempt_id.map_or(Value::Null, Value::String);
        data["fence"] = input.fence.map_or(Value::Null, |value| json!(value));
        data["source_version_id"] = json!(input.source_version_id);
        data["config_identity"] = json!(input.config_identity);
        data["expected_revision"] = json!(input.expected_revision);
        data["lease_ttl_ms"] = input.lease_ttl_ms.map_or(Value::Null, |value| json!(value));
        data["hard_time_limit_ms"] = input
            .time_limit_ms
            .map_or(Value::Null, |value| json!(value));
        self.project_call(&project_id, operation_id, data, true)
            .await
    }

    /// Record progress through Boreal's typed CompletionCommandDto route.
    pub async fn project_work_checkpoint(
        &self,
        principal: &AuthenticatedPrincipal,
        input: WorkCheckpointInput,
    ) -> Result<Value, AdapterError> {
        let project_id =
            self.authorize_project(principal, &input.project_id, SCOPE_PROJECT_WRITE)?;
        validate_identifier(&input.session_id, "session_id")?;
        validate_identifier(&input.work_id, "work_id")?;
        validate_operation_id(&input.operation_id)?;
        if input.expected_revision == 0 {
            return Err(AdapterError::InvalidInput {
                field: "expected_revision",
                reason: "must be a positive committed revision",
            });
        }
        if input.reason.trim().is_empty() || input.reason.len() > MAX_TEXT_BYTES {
            return Err(AdapterError::InvalidInput {
                field: "reason",
                reason: "must be non-empty and at most 4096 bytes",
            });
        }
        let operation_id = input.operation_id.clone();
        let mut data = self.project_common_for_session(
            principal,
            &project_id,
            &operation_id,
            &input.session_id,
        )?;
        data["command"] = json!("completion");
        data["completion"] = json!({
            "kind": "work.checkpoint",
            "work_id": input.work_id,
            "expected_revision": input.expected_revision,
            "expected_entity_revision": input.expected_entity_revision,
            "expected_proof_revision": input.expected_proof_revision,
            "reason": input.reason,
            "confirmed": input.confirmed,
        });
        self.project_call(&project_id, operation_id, data, true)
            .await
    }

    /// Record an imported receipt through Boreal's existing evidence service.
    /// The MCP operation ID must match the receipt's durable operation ID so
    /// operation_status can reconcile a lost response without duplication.
    pub async fn project_evidence_add(
        &self,
        principal: &AuthenticatedPrincipal,
        input: ProjectEvidenceAddInput,
    ) -> Result<Value, AdapterError> {
        let project_id =
            self.authorize_project(principal, &input.project_id, SCOPE_PROJECT_READ)?;
        self.authorize_project(principal, &project_id, SCOPE_PROJECT_EVIDENCE_WRITE)?;
        validate_identifier(&input.session_id, "session_id")?;
        validate_operation_id(&input.operation_id)?;
        if input.expected_revision == 0 {
            return Err(AdapterError::InvalidInput {
                field: "expected_revision",
                reason: "must be a positive committed revision",
            });
        }
        let receipt = receipt_dto_from_value(&input.receipt)?;
        if receipt.operation_id != input.operation_id {
            return Err(AdapterError::InvalidInput {
                field: "operation_id",
                reason: "must match receipt.operation_id for durable readback",
            });
        }
        match self
            .project_operation_status(principal, project_id.clone(), input.operation_id.clone())
            .await
        {
            Ok(readback) => {
                let operation = &readback["data"]["operation"];
                if operation["operation_id"] != input.operation_id
                    || operation["command"] != "receipt.insert"
                    || operation["project_id"] != project_id
                    || operation["actor_id"] != principal.actor_id
                    || operation["session_id"] != input.session_id
                    || operation["attempt_id"] != receipt.subject.attempt_id
                    || operation["fence"] != receipt.subject.fence
                {
                    return Err(AdapterError::Application {
                        operation_id: input.operation_id,
                        outcome: ApplicationOutcome::Conflict,
                        error: ProtocolError::new(
                            boreal_protocol::ErrorCode::ClaimConflict,
                            "durable receipt operation ID is already bound to another operation or actor context",
                            false,
                        ),
                        revision: readback["revision"].as_u64(),
                    });
                }
                let stored_receipt: boreal_protocol::models::ReceiptDto =
                    serde_json::from_value(readback["data"]["receipt"].clone())
                        .map_err(|_| AdapterError::ProtocolMismatch)?;
                if stored_receipt != receipt {
                    return Err(AdapterError::Application {
                        operation_id: input.operation_id,
                        outcome: ApplicationOutcome::Conflict,
                        error: ProtocolError::new(
                            boreal_protocol::ErrorCode::ClaimConflict,
                            "durable receipt operation ID is already bound to another receipt or actor context",
                            false,
                        ),
                        revision: readback["revision"].as_u64(),
                    });
                }
                let stored_result = readback["data"]["receipt"]["result"].clone();
                return Ok(json!({
                    "api_version": API_VERSION,
                    "schema_version": boreal_protocol::schema::ENVELOPE,
                    "operation_id": input.operation_id,
                    "revision": readback["revision"],
                    "outcome": "unchanged",
                    "data": {
                        "receipt_id": receipt.receipt_id.as_str(),
                        "operation_id": receipt.operation_id.as_str(),
                        "result": stored_result,
                        "replayed": true,
                    }
                }));
            }
            Err(AdapterError::Application { error, .. })
                if error.code == boreal_protocol::ErrorCode::NotFound => {}
            Err(error) => return Err(error),
        }
        let operation_id = input.operation_id.clone();
        let mut data = self.project_common_for_session(
            principal,
            &project_id,
            &operation_id,
            &input.session_id,
        )?;
        data["command"] = json!("evidence_add");
        data["expected_revision"] = json!(input.expected_revision);
        data["receipt"] =
            serde_json::to_value(receipt).map_err(|_| AdapterError::ProtocolMismatch)?;
        self.project_call(&project_id, operation_id, data, true)
            .await
    }

    /// Submit a typed receipt and summary through Boreal's atomic finish-close
    /// service route. The server performs receipt, fence, gate, and closeout
    /// validation; this adapter never launches verifier work.
    pub async fn project_finish_close(
        &self,
        principal: &AuthenticatedPrincipal,
        input: ProjectFinishCloseInput,
    ) -> Result<Value, AdapterError> {
        let project_id =
            self.authorize_project(principal, &input.project_id, SCOPE_PROJECT_READ)?;
        self.authorize_project(principal, &project_id, SCOPE_PROJECT_FINISH_CLOSE)?;
        validate_identifier(&input.session_id, "session_id")?;
        validate_identifier(&input.work_id, "work_id")?;
        validate_identifier(&input.attempt_id, "attempt_id")?;
        validate_operation_id(&input.operation_id)?;
        if input.fence == 0 || input.expected_revision == 0 {
            return Err(AdapterError::InvalidInput {
                field: "fence or expected_revision",
                reason: "fence and expected_revision must be positive",
            });
        }
        if input.summary_body.is_empty() || input.summary_body.len() > MAX_TOOL_INPUT_BYTES {
            return Err(AdapterError::InvalidInput {
                field: "summary_body",
                reason: "must be non-empty and fit within the 16 KiB MCP request bound",
            });
        }
        let receipt = receipt_dto_from_value(&input.receipt)?;
        let operation_id = input.operation_id.clone();
        let mut data = self.project_common_for_session(
            principal,
            &project_id,
            &operation_id,
            &input.session_id,
        )?;
        data["command"] = json!("finish_close");
        data["work_id"] = json!(input.work_id);
        data["attempt_id"] = json!(input.attempt_id);
        data["fence"] = json!(input.fence);
        data["expected_revision"] = json!(input.expected_revision);
        data["summary_body"] = json!(input.summary_body);
        data["receipt"] =
            serde_json::to_value(receipt).map_err(|_| AdapterError::ProtocolMismatch)?;
        self.project_call(&project_id, operation_id, data, true)
            .await
    }

    /// Submit an attempt for downstream verification or explicitly release it.
    /// Final acceptance/review decisions are not exposed by this adapter.
    pub async fn project_attempt_transition(
        &self,
        principal: &AuthenticatedPrincipal,
        input: AttemptTransitionInput,
        command: &'static str,
    ) -> Result<Value, AdapterError> {
        let project_id =
            self.authorize_project(principal, &input.project_id, SCOPE_PROJECT_WRITE)?;
        validate_identifier(&input.session_id, "session_id")?;
        validate_identifier(&input.work_id, "work_id")?;
        validate_identifier(&input.attempt_id, "attempt_id")?;
        validate_operation_id(&input.operation_id)?;
        if input.fence == 0 || input.expected_revision == 0 {
            return Err(AdapterError::InvalidInput {
                field: "fence or expected_revision",
                reason: "fence and expected_revision must be positive",
            });
        }
        if matches!(command, "release" | "submit")
            && input
                .reason
                .as_ref()
                .is_some_and(|reason| reason.len() > MAX_TEXT_BYTES)
        {
            return Err(AdapterError::InvalidInput {
                field: "reason",
                reason: "must be at most 4096 bytes",
            });
        }
        if !matches!(command, "submit" | "release" | "heartbeat" | "renew") {
            return Err(AdapterError::ProtocolMismatch);
        }
        if matches!(command, "heartbeat" | "renew")
            && input
                .lease_ttl_ms
                .is_some_and(|value| !(5_000..=3_600_000).contains(&value))
        {
            return Err(AdapterError::InvalidInput {
                field: "lease_ttl_ms",
                reason: "must be from 5000 to 3600000",
            });
        }
        if command == "renew" && input.lease_ttl_ms.is_none() {
            return Err(AdapterError::InvalidInput {
                field: "lease_ttl_ms",
                reason: "is required for lease renewal",
            });
        }
        let operation_id = input.operation_id.clone();
        let mut data = self.project_common_for_session(
            principal,
            &project_id,
            &operation_id,
            &input.session_id,
        )?;
        data["command"] = json!(command);
        data["work_id"] = json!(input.work_id);
        data["attempt_id"] = json!(input.attempt_id);
        data["fence"] = json!(input.fence);
        data["expected_revision"] = json!(input.expected_revision);
        data["reason"] = input.reason.map_or(Value::Null, Value::String);
        data["lease_ttl_ms"] = input.lease_ttl_ms.map_or(Value::Null, |value| json!(value));
        self.project_call(&project_id, operation_id, data, true)
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
        let request_digest = boreal_application::canonical_request_digest(
            "attempt.claim/v1",
            json!({
                "project_id": project_id,
                "work_id": input.work_id,
                "attempt_id": input.attempt_id,
                "actor_id": principal.actor_id,
                "harness_id": "mcp",
                "session_id": input.session_id,
                "expected_revision": input.expected_revision,
                "lease_ttl_ms": input.lease_ttl_ms,
                "hard_time_limit_ms": input.time_limit_ms,
                "source_version_id": input.source_version_id,
                "config_identity": input.config_identity,
            }),
        );
        match self
            .project_operation_status(principal, project_id.clone(), input.operation_id.clone())
            .await
        {
            Ok(status) => {
                let operation = &status["data"]["operation"];
                if !operation.is_null() {
                    return self.claim_operation_replay(
                        principal,
                        &input,
                        &request_digest,
                        operation,
                    );
                }
            }
            Err(AdapterError::UnknownOutcome {
                readback: Some(readback),
                ..
            }) if readback["operation"].is_null() => {}
            Err(AdapterError::Application { error, .. })
                if error.code == boreal_protocol::ErrorCode::NotFound => {}
            Err(AdapterError::UnknownOutcome {
                readback: Some(readback),
                ..
            }) if !readback["operation"].is_null() => {
                return self.claim_operation_replay(
                    principal,
                    &input,
                    &request_digest,
                    &readback["operation"],
                );
            }
            Err(error) => return Err(error),
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
        match self
            .project_call(&project_id, operation_id, data, true)
            .await
        {
            Err(error @ AdapterError::Application { .. })
                if matches!(
                    &error,
                    AdapterError::Application { error, .. }
                        if error.code == boreal_protocol::ErrorCode::ClaimConflict
                ) =>
            {
                match self
                    .project_operation_status(
                        principal,
                        project_id.clone(),
                        input.operation_id.clone(),
                    )
                    .await
                {
                    Ok(status) if !status["data"]["operation"].is_null() => self
                        .claim_operation_replay(
                            principal,
                            &input,
                            &request_digest,
                            &status["data"]["operation"],
                        ),
                    _ => Err(error),
                }
            }
            result => result,
        }
    }

    fn claim_operation_replay(
        &self,
        principal: &AuthenticatedPrincipal,
        input: &WorkClaimInput,
        request_digest: &str,
        operation: &Value,
    ) -> Result<Value, AdapterError> {
        let matches_request = operation["operation_id"] == input.operation_id
            && operation["project_id"] == input.project_id
            && operation["command"] == "work.claim"
            && operation["actor_id"] == principal.actor_id
            && operation["session_id"] == input.session_id
            && operation["attempt_id"] == input.attempt_id
            && operation["request_digest"] == request_digest
            && operation["result"]["attempt_id"] == input.attempt_id
            && operation["fence"] == operation["result"]["fence"];
        if !matches_request {
            return Err(AdapterError::Application {
                operation_id: input.operation_id.clone(),
                outcome: ApplicationOutcome::Conflict,
                error: ProtocolError::new(
                    boreal_protocol::ErrorCode::ClaimConflict,
                    "durable operation ID is already bound to another immutable claim request",
                    false,
                ),
                revision: operation["revision"].as_u64(),
            });
        }
        if !matches!(operation["outcome"].as_str(), Some("changed" | "unchanged")) {
            return Err(AdapterError::UnknownOutcome {
                operation_id: input.operation_id.clone(),
                readback: Some(operation.clone()),
                protocol_error: None,
            });
        }
        let mut result = operation["result"].clone();
        let Some(result_object) = result.as_object_mut() else {
            return Err(AdapterError::ProtocolMismatch);
        };
        result_object.insert("replayed".into(), json!(true));
        Ok(json!({
            "api_version": API_VERSION,
            "schema_version": boreal_protocol::schema::ENVELOPE,
            "operation_id": input.operation_id,
            "revision": operation["revision"],
            "outcome": "unchanged",
            "data": result,
        }))
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
        let session_id = format!("mcp-{}", principal.actor_id);
        self.project_common_for_session(principal, project_id, operation_id, &session_id)
    }

    fn project_common_for_session(
        &self,
        principal: &AuthenticatedPrincipal,
        project_id: &str,
        operation_id: &str,
        session_id: &str,
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
            "session_id": session_id,
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
                    readback: None,
                    protocol_error: None,
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

#[derive(Clone, Debug, Deserialize, Serialize, rmcp::schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ProjectAgentContextInput {
    pub project_id: String,
    /// Stable per-agent execution identity, not an authorization credential.
    pub session_id: String,
    pub work_id: Option<String>,
    pub attempt_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, rmcp::schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct AgentStartInput {
    pub project_id: String,
    /// Reuse this ID for resume; choose a distinct ID for concurrent workers.
    pub session_id: String,
    /// Omit to let Boreal's authoritative selector choose ready work.
    pub work_id: Option<String>,
    pub attempt_id: Option<String>,
    pub fence: Option<u64>,
    /// Copy the active source and configuration identities from the guide.
    pub source_version_id: String,
    pub config_identity: String,
    pub expected_revision: u64,
    pub operation_id: String,
    pub lease_ttl_ms: Option<u64>,
    pub time_limit_ms: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Serialize, rmcp::schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct WorkCheckpointInput {
    pub project_id: String,
    pub session_id: String,
    pub work_id: String,
    pub expected_revision: u64,
    pub expected_entity_revision: u64,
    pub expected_proof_revision: u64,
    pub reason: String,
    pub confirmed: bool,
    pub operation_id: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, rmcp::schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ProjectEvidenceAddInput {
    pub project_id: String,
    /// Stable Project session associated with the authenticated actor.
    pub session_id: String,
    pub expected_revision: u64,
    /// Must match receipt.operation_id so durable readback uses the same key.
    pub operation_id: String,
    /// Versioned Boreal ReceiptDto; Boreal owns semantic validation and retention.
    pub receipt: Value,
}

#[derive(Clone, Debug, Deserialize, Serialize, rmcp::schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ProjectFinishCloseInput {
    pub project_id: String,
    pub session_id: String,
    pub work_id: String,
    pub attempt_id: String,
    pub fence: u64,
    pub expected_revision: u64,
    /// Reuse this durable close operation ID for operation_status after a timeout.
    pub operation_id: String,
    /// Versioned Boreal ReceiptDto; Boreal validates it against the exact close subject.
    pub receipt: Value,
    /// Inline summary body; MCP does not accept paths or fetch references.
    pub summary_body: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, rmcp::schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct AttemptTransitionInput {
    pub project_id: String,
    pub session_id: String,
    pub work_id: String,
    pub attempt_id: String,
    pub fence: u64,
    pub expected_revision: u64,
    pub operation_id: String,
    pub reason: Option<String>,
    pub lease_ttl_ms: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Serialize, rmcp::schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ProjectSessionStartInput {
    pub project_id: String,
    /// Stable execution label, not an authorization credential.
    pub session_id: String,
    pub expected_revision: u64,
    pub operation_id: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, rmcp::schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ProjectSessionEndInput {
    pub project_id: String,
    /// End only the session associated with the authenticated actor.
    pub session_id: String,
    pub expected_revision: u64,
    pub operation_id: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, rmcp::schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct WorkCreateInput {
    pub project_id: String,
    pub session_id: String,
    pub work_id: Option<String>,
    pub kind: String,
    pub parent_id: Option<String>,
    pub title: String,
    pub description: String,
    pub priority: u8,
    pub dispatch_policy: Option<String>,
    pub hold: Option<String>,
    pub profile: Option<String>,
    pub expected_revision: u64,
    pub operation_id: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, rmcp::schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct WorkWaitInput {
    pub project_id: String,
    pub work_id: String,
    pub reason_code: String,
    pub expected_revision: u64,
    pub operation_id: String,
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
                readback: None,
                protocol_error: None,
            }
        } else {
            AdapterError::ServiceUnavailable
        }
    })?;
    let Some(body) = response.payload() else {
        return Err(if write {
            AdapterError::UnknownOutcome {
                operation_id: operation_id.into(),
                readback: None,
                protocol_error: None,
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
                readback: None,
                protocol_error: None,
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
                readback: None,
                protocol_error: None,
            }
        } else {
            AdapterError::ProtocolMismatch
        });
    }
    let envelope: Envelope<Value> = serde_json::from_value(transport.data).map_err(|_| {
        if write {
            AdapterError::UnknownOutcome {
                operation_id: operation_id.into(),
                readback: None,
                protocol_error: None,
            }
        } else {
            AdapterError::ProtocolMismatch
        }
    })?;
    envelope.validate().map_err(|_| {
        if write {
            AdapterError::UnknownOutcome {
                operation_id: operation_id.into(),
                readback: None,
                protocol_error: None,
            }
        } else {
            AdapterError::ProtocolMismatch
        }
    })?;
    if envelope.operation_id != operation_id
        || envelope.api_version != API_VERSION
        || (envelope.transport != TransportOutcome::Ok
            && envelope.outcome != ApplicationOutcome::Unknown)
    {
        return Err(if write {
            AdapterError::UnknownOutcome {
                operation_id: operation_id.into(),
                readback: None,
                protocol_error: None,
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
    data: Value,
}

fn envelope_value(envelope: Envelope<Value>, _scope: &str) -> Result<Value, AdapterError> {
    if envelope.outcome == ApplicationOutcome::Unknown {
        return Err(AdapterError::UnknownOutcome {
            operation_id: envelope.operation_id,
            readback: envelope.data,
            protocol_error: Some(envelope.error.ok_or(AdapterError::ProtocolMismatch)?),
        });
    }
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

fn project_tool_names(
    read: bool,
    write: bool,
    evidence_write: bool,
    finish_close: bool,
) -> Vec<&'static str> {
    let mut result = Vec::new();
    if read {
        result.extend([
            "project_status",
            "project_work_show",
            "project_source_list",
            "operation_status",
            "project_agent_guide",
            "project_agent_next",
            "project_agent_resume",
            "project_review_list",
            "project_review_show",
        ]);
    }
    if write {
        result.extend([
            "project_work_edit",
            "project_work_claim",
            "project_session_start",
            "project_session_end",
            "project_work_create",
            "project_work_wait",
            "project_agent_start",
            "project_work_checkpoint",
            "project_attempt_submit",
            "project_attempt_release",
            "project_attempt_heartbeat",
            "project_attempt_renew",
        ]);
    }
    if evidence_write {
        result.push("project_evidence_add");
    }
    if finish_close {
        result.push("project_finish_close");
    }
    result
}

fn receipt_dto_from_value(
    value: &Value,
) -> Result<boreal_protocol::models::ReceiptDto, AdapterError> {
    if !value.is_object() {
        return Err(AdapterError::InvalidInput {
            field: "receipt",
            reason: "must be a Boreal receipt object",
        });
    }
    let encoded = serde_json::to_vec(value).map_err(|_| AdapterError::ProtocolMismatch)?;
    if encoded.len() > MAX_TOOL_INPUT_BYTES {
        return Err(AdapterError::InvalidInput {
            field: "receipt",
            reason: "exceeds the 16 KiB MCP input bound",
        });
    }
    serde_json::from_value(value.clone()).map_err(|_| AdapterError::InvalidInput {
        field: "receipt",
        reason: "does not match the versioned Boreal ReceiptDto",
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{GlobalEndpoint, Policy, ProjectEndpoint};
    use std::{
        collections::{BTreeMap, BTreeSet},
        fs,
        path::{Path, PathBuf},
        process::{Child, Command, Stdio},
        thread,
        time::{Duration, SystemTime, UNIX_EPOCH},
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

    #[tokio::test]
    async fn evidence_and_finish_are_default_denied_and_not_inherited_from_work_write() {
        let (backend, principal) = test_backend();
        let capabilities = backend.capabilities(&principal);
        let project_tools = capabilities["projects"][0]["tools"].as_array().unwrap();
        assert!(!project_tools
            .iter()
            .any(|tool| tool == "project_evidence_add"));
        assert!(!project_tools
            .iter()
            .any(|tool| tool == "project_finish_close"));

        let evidence_denied = backend
            .project_evidence_add(
                &principal,
                ProjectEvidenceAddInput {
                    project_id: "project-a".into(),
                    session_id: "session-a".into(),
                    expected_revision: 1,
                    operation_id: "op_receipt_denied".into(),
                    receipt: json!({}),
                },
            )
            .await
            .unwrap_err();
        assert!(matches!(
            evidence_denied,
            AdapterError::PermissionDenied {
                scope: SCOPE_PROJECT_EVIDENCE_WRITE
            }
        ));

        let finish_denied = backend
            .project_finish_close(
                &principal,
                ProjectFinishCloseInput {
                    project_id: "project-a".into(),
                    session_id: "session-a".into(),
                    work_id: "work-a".into(),
                    attempt_id: "attempt-a".into(),
                    fence: 1,
                    expected_revision: 1,
                    operation_id: "op_finish_denied".into(),
                    receipt: json!({}),
                    summary_body: "synthetic denied close".into(),
                },
            )
            .await
            .unwrap_err();
        assert!(matches!(
            finish_denied,
            AdapterError::PermissionDenied {
                scope: SCOPE_PROJECT_FINISH_CLOSE
            }
        ));

        let mut write_without_read = principal.clone();
        write_without_read.scopes.remove(SCOPE_PROJECT_READ);
        write_without_read
            .scopes
            .insert(SCOPE_PROJECT_EVIDENCE_WRITE.into());
        write_without_read
            .scopes
            .insert(SCOPE_PROJECT_FINISH_CLOSE.into());
        let restricted_capabilities = backend.capabilities(&write_without_read);
        let restricted_tools = restricted_capabilities["projects"][0]["tools"]
            .as_array()
            .unwrap();
        assert!(!restricted_tools
            .iter()
            .any(|tool| tool == "project_evidence_add"));
        assert!(!restricted_tools
            .iter()
            .any(|tool| tool == "project_finish_close"));

        let evidence_without_read = backend
            .project_evidence_add(
                &write_without_read,
                ProjectEvidenceAddInput {
                    project_id: "project-a".into(),
                    session_id: "session-a".into(),
                    expected_revision: 1,
                    operation_id: "op_evidence_without_read".into(),
                    receipt: json!({}),
                },
            )
            .await
            .unwrap_err();
        assert!(matches!(
            evidence_without_read,
            AdapterError::PermissionDenied {
                scope: SCOPE_PROJECT_READ
            }
        ));

        let finish_without_read = backend
            .project_finish_close(
                &write_without_read,
                ProjectFinishCloseInput {
                    project_id: "project-a".into(),
                    session_id: "session-a".into(),
                    work_id: "work-a".into(),
                    attempt_id: "attempt-a".into(),
                    fence: 1,
                    expected_revision: 1,
                    operation_id: "op_finish_without_read".into(),
                    receipt: json!({}),
                    summary_body: "synthetic denied close".into(),
                },
            )
            .await
            .unwrap_err();
        assert!(matches!(
            finish_without_read,
            AdapterError::PermissionDenied {
                scope: SCOPE_PROJECT_READ
            }
        ));

        let mut explicitly_granted = principal;
        explicitly_granted
            .scopes
            .insert(SCOPE_PROJECT_EVIDENCE_WRITE.into());
        explicitly_granted
            .scopes
            .insert(SCOPE_PROJECT_FINISH_CLOSE.into());
        let granted_capabilities = backend.capabilities(&explicitly_granted);
        let tools = granted_capabilities["projects"][0]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect::<BTreeSet<_>>();
        assert!(tools.contains("project_evidence_add"));
        assert!(tools.contains("project_finish_close"));
    }

    #[tokio::test]
    async fn evidence_receipt_operation_must_match_for_durable_readback() {
        let (backend, mut principal) = test_backend();
        principal.scopes.insert(SCOPE_PROJECT_EVIDENCE_WRITE.into());
        let error = backend
            .project_evidence_add(
                &principal,
                ProjectEvidenceAddInput {
                    project_id: "project-a".into(),
                    session_id: "session-a".into(),
                    expected_revision: 1,
                    operation_id: "op_mcp_receipt_outer".into(),
                    receipt: json!({
                        "schema_version": "boreal.receipt.v1",
                        "receipt_id": "receipt-mismatch",
                        "operation_id": "op_mcp_receipt_inner",
                        "subject": {
                            "work_id": "work-a",
                            "attempt_id": "attempt-a",
                            "fence": 1,
                            "gate_id": "verification"
                        },
                        "executable": "synthetic-check",
                        "argv": [],
                        "cwd": ".",
                        "exit_code": 0,
                        "started_at": "unix-ms:1",
                        "ended_at": "unix-ms:2",
                        "source_snapshot_hash": "source-v1",
                        "config_identity": "config-v1",
                        "environment_fingerprint": "synthetic-env-v1",
                        "output_digest": "sha256:synthetic",
                        "output_ref": null,
                        "coverage": {
                            "kind": "verification",
                            "profile_id": "focused",
                            "profile_version": "1"
                        },
                        "attestation": "external_attested",
                        "result": "passed",
                        "retention": null
                    }),
                },
            )
            .await
            .unwrap_err();
        assert!(matches!(
            error,
            AdapterError::InvalidInput {
                field: "operation_id",
                ..
            }
        ));
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

    #[test]
    fn project_transport_data_is_the_authoritative_json_envelope_value() {
        let transport: ProjectTransportResponse = serde_json::from_value(json!({
            "api_version": PROJECT_API_VERSION,
            "schema_version": PROJECT_SCHEMA_VERSION,
            "operation_id": "op_project_status",
            "data": {
                "api_version": API_VERSION,
                "schema_version": boreal_protocol::schema::ENVELOPE,
                "operation_id": "op_project_status",
                "revision": 7,
                "as_of": "2026-10-09T00:00:00Z",
                "next_status_change_at": null,
                "transport": "ok",
                "outcome": "changed",
                "data": {"project_id": "project-a"},
                "detail_ref": null,
                "error": null
            }
        }))
        .expect("service returns the envelope as a JSON object");

        let envelope: Envelope<Value> = serde_json::from_value(transport.data)
            .expect("nested envelope parses without a string round trip");
        envelope.validate().expect("nested envelope is valid");
        assert_eq!(envelope.operation_id, "op_project_status");
        assert_eq!(envelope.data.unwrap()["project_id"], "project-a");
    }

    #[test]
    fn unknown_envelope_keeps_readback_and_service_recovery_guidance() {
        let mut error = ProtocolError::new(
            boreal_protocol::ErrorCode::UnknownOutcome,
            "commit completed but the response was lost",
            true,
        );
        error.readback_required = Some(true);
        error.operation_preserved = Some(true);
        let envelope = Envelope {
            api_version: API_VERSION.into(),
            schema_version: boreal_protocol::schema::ENVELOPE.into(),
            operation_id: "op_uncertain_write".into(),
            revision: Some(11),
            as_of: "2026-10-09T00:00:00Z".into(),
            next_status_change_at: None,
            transport: TransportOutcome::Error,
            outcome: ApplicationOutcome::Unknown,
            data: Some(json!({"committed": true, "receipt": "receipt-11"})),
            detail_ref: None,
            error: Some(error),
        };

        match envelope_value(envelope, "project-a").unwrap_err() {
            AdapterError::UnknownOutcome {
                operation_id,
                readback,
                protocol_error,
            } => {
                assert_eq!(operation_id, "op_uncertain_write");
                assert_eq!(readback.unwrap()["receipt"], "receipt-11");
                let protocol_error = protocol_error.unwrap();
                assert_eq!(protocol_error.readback_required, Some(true));
                assert_eq!(protocol_error.operation_preserved, Some(true));
                assert!(protocol_error.message.contains("response was lost"));
            }
            other => panic!("unknown result was misclassified: {other}"),
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    #[ignore = "requires a freshly built bwrk binary; run the documented daemon regression command"]
    async fn project_work_journey_and_lost_reply_reconcile_with_real_daemon() {
        use std::{
            io::{Read, Write},
            os::unix::{
                fs::PermissionsExt,
                net::{UnixListener, UnixStream},
            },
        };

        struct TempRoot(PathBuf);
        impl Drop for TempRoot {
            fn drop(&mut self) {
                let _ = fs::remove_dir_all(&self.0);
            }
        }

        struct ChildGuard(Child);
        impl Drop for ChildGuard {
            fn drop(&mut self) {
                if self.0.try_wait().ok().flatten().is_none() {
                    let _ = self.0.kill();
                    let _ = self.0.wait();
                }
            }
        }

        struct EnvGuard {
            name: String,
            previous: Option<std::ffi::OsString>,
        }
        impl Drop for EnvGuard {
            fn drop(&mut self) {
                if let Some(value) = self.previous.take() {
                    std::env::set_var(&self.name, value);
                } else {
                    std::env::remove_var(&self.name);
                }
            }
        }

        fn cli_binary() -> PathBuf {
            std::env::var_os("BWRK_BIN")
                .map(PathBuf::from)
                .unwrap_or_else(|| {
                    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/debug/bwrk")
                })
        }

        fn run_cli(binary: &Path, root: &Path, args: &[&str], db: &Path) -> serde_json::Value {
            let output = Command::new(binary)
                .current_dir(root)
                .args(args)
                .arg("--db")
                .arg(db)
                .arg("--json")
                .output()
                .expect("disposable bwrk command launches");
            assert!(
                output.status.success(),
                "disposable bwrk command failed: stdout={} stderr={}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            serde_json::from_slice(&output.stdout).expect("disposable bwrk command returns JSON")
        }

        let binary = cli_binary();
        assert!(
            binary.is_file(),
            "build boreal-cli and set BWRK_BIN to its bwrk binary before running this test: {}",
            binary.display()
        );
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock is after epoch")
            .as_nanos();
        let root = TempRoot(
            std::env::temp_dir().join(format!("boreal-mcp-daemon-{}-{nonce}", std::process::id())),
        );
        fs::create_dir_all(&root.0).expect("temporary project root is created");
        let db = root.0.join(".boreal/boreal.sqlite");
        let socket = root.0.join(".boreal/mcp-project.sock");
        let project_id = "mcp-daemon-project";
        let actor_id = "mcp-daemon-operator";
        let worker_id = "mcp-daemon-worker";
        let target_operation_id = "op_mcp_daemon_session";
        run_cli(
            &binary,
            &root.0,
            &[
                "init",
                "--project",
                project_id,
                "--actor",
                actor_id,
                "--operation-id",
                "op_mcp_daemon_init",
            ],
            &db,
        );
        let session_result = run_cli(
            &binary,
            &root.0,
            &[
                "session",
                "start",
                "--project",
                project_id,
                "--actor",
                actor_id,
                "--harness",
                "mcp",
                "--session",
                "mcp-daemon-session",
                "--operation-id",
                target_operation_id,
            ],
            &db,
        );

        let session_revision = session_result["revision"]
            .as_u64()
            .expect("session registration returns a revision");
        let source_path = root.0.join("mcp-source.txt");
        fs::write(&source_path, "synthetic MCP daemon source\n")
            .expect("synthetic source file is created");
        let source_result = run_cli(
            &binary,
            &root.0,
            &[
                "source",
                "add",
                project_id,
                "--input",
                source_path.to_str().expect("temp source path is UTF-8"),
                "--origin",
                "synthetic-mcp-test",
                "--actor",
                actor_id,
                "--harness",
                "mcp",
                "--session",
                "mcp-daemon-session",
                "--expected-revision",
                &session_revision.to_string(),
                "--operation-id",
                "op_mcp_daemon_source_add",
            ],
            &db,
        );
        let source_version_id = source_result["data"]["source"]["source_version_id"]
            .as_str()
            .or_else(|| source_result["data"]["source_version_id"].as_str())
            .expect("source registration returns its immutable version ID")
            .to_owned();
        let enrollment = run_cli(
            &binary,
            &root.0,
            &[
                "auth",
                "key",
                "--project",
                project_id,
                "--actor",
                worker_id,
                "--actor-role",
                "agent",
            ],
            &db,
        );
        let enrollment_path = enrollment["data"]["enrollment_path"]
            .as_str()
            .expect("auth key returns the private synthetic enrollment path");
        let _grant = run_cli(
            &binary,
            &root.0,
            &[
                "auth",
                "grant",
                "--project",
                project_id,
                "--actor",
                actor_id,
                "--input",
                enrollment_path,
                "--expected-revision",
                &source_result["revision"].as_u64().unwrap().to_string(),
                "--reason",
                "disposable MCP integration fixture",
                "--yes",
                "--operation-id",
                "op_mcp_daemon_worker_grant",
            ],
            &db,
        );
        let credential = fs::read_dir(root.0.join(".boreal/credentials"))
            .expect("project credential directory exists")
            .filter_map(Result::ok)
            .map(|entry| fs::read(entry.path()).expect("project credential file reads"))
            .filter_map(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
            .find(|file| file["actor_id"] == actor_id)
            .and_then(|file| file["credential"].as_str().map(str::to_owned))
            .expect("project setup created a local actor credential");
        let worker_credential = fs::read_dir(root.0.join(".boreal/credentials"))
            .expect("project credential directory exists")
            .filter_map(Result::ok)
            .map(|entry| fs::read(entry.path()).expect("project credential file reads"))
            .filter_map(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
            .find(|file| file["actor_id"] == worker_id)
            .and_then(|file| file["credential"].as_str().map(str::to_owned))
            .expect("auth key created a local worker credential");
        let credential_env = format!("BOREAL_MCP_DAEMON_CREDENTIAL_{}", std::process::id());
        let worker_credential_env =
            format!("BOREAL_MCP_DAEMON_WORKER_CREDENTIAL_{}", std::process::id());
        let env_guard = EnvGuard {
            name: credential_env.clone(),
            previous: std::env::var_os(&credential_env),
        };
        let _worker_env_guard = EnvGuard {
            name: worker_credential_env.clone(),
            previous: std::env::var_os(&worker_credential_env),
        };
        std::env::set_var(&credential_env, credential);
        std::env::set_var(&worker_credential_env, worker_credential);

        let mut service = ChildGuard(
            Command::new(&binary)
                .current_dir(&root.0)
                .args(["service", "run", "--db"])
                .arg(&db)
                .args(["--socket"])
                .arg(&socket)
                .args(["--json"])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .expect("disposable Project daemon starts"),
        );
        let mut ready = false;
        for _ in 0..200 {
            if socket.exists() && UnixStream::connect(&socket).is_ok() {
                ready = true;
                break;
            }
            if service
                .0
                .try_wait()
                .expect("daemon process status reads")
                .is_some()
            {
                break;
            }
            thread::sleep(Duration::from_millis(10));
        }
        assert!(ready, "disposable Project daemon did not bind its socket");

        let credential_name = credential_env.clone();
        let config = Arc::new(McpConfig {
            version: 1,
            global: None,
            projects: BTreeMap::from([(
                project_id.into(),
                ProjectEndpoint {
                    socket: socket.clone(),
                    credential_env_by_actor: BTreeMap::from([
                        (actor_id.into(), credential_name),
                        (worker_id.into(), worker_credential_env.clone()),
                    ]),
                },
            )]),
            principals: BTreeMap::new(),
            stdio_profiles: BTreeMap::new(),
            http: None,
        });
        config.validate().expect("synthetic MCP binding is valid");
        let policy = Policy {
            actor_id: actor_id.into(),
            projects: BTreeSet::from([project_id.into()]),
            scopes: BTreeSet::from([SCOPE_PROJECT_READ.into(), SCOPE_PROJECT_WRITE.into()]),
        };
        let principal = AuthenticatedPrincipal::from_stdio_policy("test-agent", &policy, &config);
        let backend = BorealBackend::new(config);
        let worker_policy = Policy {
            actor_id: worker_id.into(),
            projects: BTreeSet::from([project_id.into()]),
            scopes: BTreeSet::from([SCOPE_PROJECT_READ.into(), SCOPE_PROJECT_WRITE.into()]),
        };
        let worker_principal = AuthenticatedPrincipal::from_stdio_policy(
            "test-worker",
            &worker_policy,
            &backend.config,
        );

        let status = backend
            .project_status(&principal, project_id.into(), 10, 0)
            .await
            .expect("MCP Project status reads the real daemon envelope");
        assert_eq!(status["outcome"], "unchanged");
        assert!(status["data"].is_object());

        let session = backend
            .project_session_start(
                &principal,
                ProjectSessionStartInput {
                    project_id: project_id.into(),
                    session_id: "mcp-create-session".into(),
                    expected_revision: status["revision"].as_u64().unwrap(),
                    operation_id: "op_mcp_create_session".into(),
                },
            )
            .await
            .expect("MCP registers a server-bound Project session");
        assert_eq!(session["outcome"], "changed");

        let created = backend
            .project_work_create(
                &principal,
                WorkCreateInput {
                    project_id: project_id.into(),
                    session_id: "mcp-create-session".into(),
                    work_id: Some("mcp-tool-work".into()),
                    kind: "task".into(),
                    parent_id: None,
                    title: "Task created through MCP".into(),
                    description: "synthetic daemon integration fixture".into(),
                    priority: 2,
                    dispatch_policy: Some("automatic".into()),
                    hold: None,
                    profile: Some("focused".into()),
                    expected_revision: session["revision"].as_u64().unwrap(),
                    operation_id: "op_mcp_work_create".into(),
                },
            )
            .await
            .expect("MCP creates work through the existing Project service");
        assert_eq!(created["outcome"], "changed");
        assert_eq!(created["data"]["work_id"], "mcp-tool-work");

        let wait_work = backend
            .project_work_create(
                &principal,
                WorkCreateInput {
                    project_id: project_id.into(),
                    session_id: "mcp-create-session".into(),
                    work_id: Some("mcp-wait-work".into()),
                    kind: "task".into(),
                    parent_id: None,
                    title: "Task waiting on external input".into(),
                    description: "synthetic wait fixture".into(),
                    priority: 1,
                    dispatch_policy: Some("operator_only".into()),
                    hold: None,
                    profile: Some("focused".into()),
                    expected_revision: created["revision"].as_u64().unwrap(),
                    operation_id: "op_mcp_wait_task_create".into(),
                },
            )
            .await
            .expect("MCP creates a separate wait fixture");
        let wait_recorded = backend
            .project_work_wait(
                &principal,
                WorkWaitInput {
                    project_id: project_id.into(),
                    work_id: "mcp-wait-work".into(),
                    reason_code: "external_input_required".into(),
                    expected_revision: wait_work["revision"].as_u64().unwrap(),
                    operation_id: "op_mcp_wait_record".into(),
                },
            )
            .await
            .expect("MCP records a reason-coded Project wait through Boreal");
        assert_eq!(wait_recorded["outcome"], "changed");
        assert_eq!(
            wait_recorded["data"]["hard_holds"],
            json!(["external_input_required"])
        );

        let edit = WorkEditInput {
            project_id: project_id.into(),
            work_id: "mcp-tool-work".into(),
            operation_id: "op_mcp_work_edit".into(),
            expected_revision: wait_recorded["revision"].as_u64().unwrap(),
            title: Some("Edited once through MCP".into()),
            description: None,
            parent_id: None,
            priority: None,
            dispatch_policy: None,
        };
        let first_edit = backend
            .project_work_edit(&principal, edit.clone())
            .await
            .expect("MCP edits through the existing revisioned service");
        assert_eq!(first_edit["outcome"], "changed");
        assert_eq!(first_edit["data"]["title"], "Edited once through MCP");

        let replayed_edit = backend
            .project_work_edit(&principal, edit.clone())
            .await
            .expect("same operation ID safely replays the edit");
        assert_eq!(replayed_edit["outcome"], "unchanged");

        let stale_edit = WorkEditInput {
            operation_id: "op_mcp_stale_work_edit".into(),
            title: Some("This stale edit must not win".into()),
            ..edit
        };
        match backend.project_work_edit(&principal, stale_edit).await {
            Err(AdapterError::Application { outcome, error, .. }) => {
                assert_eq!(outcome, ApplicationOutcome::Conflict);
                assert_eq!(error.code, boreal_protocol::ErrorCode::StaleRevision);
            }
            other => panic!("stale edit was not returned as a revision conflict: {other:?}"),
        }

        let operation = backend
            .project_operation_status(&principal, project_id.into(), target_operation_id.into())
            .await
            .expect("MCP operation status reads the real daemon envelope");
        assert_eq!(operation["outcome"], "changed");
        assert_eq!(
            operation["data"]["operation"]["operation_id"],
            target_operation_id
        );

        let current = backend
            .project_status(&principal, project_id.into(), 10, 0)
            .await
            .expect("current revision reads before claim");
        let claim = WorkClaimInput {
            project_id: project_id.into(),
            work_id: "mcp-tool-work".into(),
            operation_id: "op_mcp_work_claim".into(),
            attempt_id: "mcp-tool-attempt".into(),
            session_id: "mcp-worker-session".into(),
            source_version_id: source_version_id.clone(),
            config_identity: "mcp-test-config-v1".into(),
            expected_revision: current["revision"].as_u64().unwrap(),
            lease_ttl_ms: Some(60_000),
            time_limit_ms: Some(300_000),
        };
        let claimed = backend
            .project_work_claim(&worker_principal, claim.clone())
            .await
            .expect("MCP claims eligible work through Boreal");
        assert_eq!(claimed["outcome"], "changed");
        assert_eq!(claimed["data"]["attempt_id"], "mcp-tool-attempt");
        let replayed_claim = backend
            .project_work_claim(&worker_principal, claim.clone())
            .await
            .expect("exact claim retry reads back the durable result");
        assert_eq!(replayed_claim["outcome"], "unchanged");
        assert_eq!(replayed_claim["data"]["replayed"], true);
        assert_eq!(replayed_claim["data"]["attempt_id"], "mcp-tool-attempt");
        let mismatched_claim = WorkClaimInput {
            config_identity: "different-config/v1".into(),
            ..claim
        };
        match backend
            .project_work_claim(&worker_principal, mismatched_claim)
            .await
        {
            Err(AdapterError::Application { outcome, error, .. }) => {
                assert_eq!(outcome, ApplicationOutcome::Conflict);
                assert_eq!(error.code, boreal_protocol::ErrorCode::ClaimConflict);
                assert!(error.message.contains("another immutable claim request"));
            }
            other => panic!("operation ID reuse with changed payload was not rejected: {other:?}"),
        }
        let claim_readback = backend
            .project_operation_status(
                &worker_principal,
                project_id.into(),
                "op_mcp_work_claim".into(),
            )
            .await
            .expect("claim status reads back the first durable outcome");
        assert_eq!(
            claim_readback["data"]["operation"]["attempt_id"],
            "mcp-tool-attempt"
        );

        let attempt_context = backend
            .project_agent_context(
                &worker_principal,
                ProjectAgentContextInput {
                    project_id: project_id.into(),
                    session_id: "mcp-worker-session".into(),
                    work_id: Some("mcp-tool-work".into()),
                    attempt_id: Some("mcp-tool-attempt".into()),
                },
                "guide",
            )
            .await
            .expect("MCP guide reads the claimed attempt context");
        assert!(attempt_context["data"].is_object());

        let start = AgentStartInput {
            project_id: project_id.into(),
            session_id: "mcp-worker-session".into(),
            work_id: Some("mcp-tool-work".into()),
            attempt_id: Some("mcp-tool-attempt".into()),
            fence: claimed["data"]["fence"].as_u64(),
            source_version_id: source_version_id.clone(),
            config_identity: "mcp-test-config-v1".into(),
            expected_revision: claimed["revision"].as_u64().unwrap(),
            operation_id: "op_mcp_agent_start".into(),
            lease_ttl_ms: None,
            time_limit_ms: None,
        };
        let started = backend
            .project_agent_start(&worker_principal, start.clone())
            .await
            .expect("MCP starts the claimed attempt through Boreal's atomic route");
        assert_eq!(started["outcome"], "changed");
        assert_eq!(started["data"]["phase"], "running");
        let replayed_start = backend
            .project_agent_start(&worker_principal, start)
            .await
            .expect("same start operation safely reads back its outcome");
        assert_eq!(replayed_start["outcome"], "unchanged");
        assert_eq!(replayed_start["data"]["attempt_id"], "mcp-tool-attempt");

        let submitted = backend
            .project_attempt_transition(
                &worker_principal,
                AttemptTransitionInput {
                    project_id: project_id.into(),
                    session_id: "mcp-worker-session".into(),
                    work_id: "mcp-tool-work".into(),
                    attempt_id: "mcp-tool-attempt".into(),
                    fence: claimed["data"]["fence"].as_u64().unwrap(),
                    expected_revision: started["revision"].as_u64().unwrap(),
                    operation_id: "op_mcp_attempt_submit".into(),
                    reason: Some("ready for downstream verification".into()),
                    lease_ttl_ms: None,
                },
                "submit",
            )
            .await
            .expect("MCP submits the active attempt for downstream verification");
        assert_eq!(submitted["outcome"], "changed");
        assert_eq!(submitted["data"]["phase"], "verifying");

        let external_receipt = |receipt_id: &str, operation_id: &str| {
            json!({
                "schema_version": "boreal.receipt.v1",
                "receipt_id": receipt_id,
                "operation_id": operation_id,
                "subject": {
                    "work_id": "mcp-tool-work",
                    "attempt_id": "mcp-tool-attempt",
                    "fence": claimed["data"]["fence"],
                    "gate_id": "verification"
                },
                "executable": "synthetic-check",
                "argv": ["synthetic-check"],
                "cwd": ".",
                "exit_code": 0,
                "started_at": "unix-ms:1",
                "ended_at": "unix-ms:2",
                "source_snapshot_hash": source_version_id,
                "config_identity": "mcp-test-config-v1",
                "environment_fingerprint": "synthetic-env-v1",
                "output_digest": "sha256:synthetic-mcp-proof",
                "output_ref": null,
                "coverage": {
                    "kind": "verification",
                    "profile_id": "focused",
                    "profile_version": "1"
                },
                "attestation": "external_attested",
                "result": "passed",
                "retention": null
            })
        };
        let evidence_policy = Policy {
            actor_id: worker_id.into(),
            projects: BTreeSet::from([project_id.into()]),
            scopes: BTreeSet::from([
                SCOPE_PROJECT_READ.into(),
                SCOPE_PROJECT_EVIDENCE_WRITE.into(),
            ]),
        };
        let evidence_principal = AuthenticatedPrincipal::from_stdio_policy(
            "test-evidence-writer",
            &evidence_policy,
            &backend.config,
        );
        let evidence_capabilities = backend.capabilities(&evidence_principal);
        let evidence_tool_list = evidence_capabilities["projects"][0]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect::<BTreeSet<_>>();
        assert!(evidence_tool_list.contains("project_evidence_add"));
        assert!(!evidence_tool_list.contains("project_work_edit"));
        assert!(!evidence_tool_list.contains("project_finish_close"));

        let evidence_input = ProjectEvidenceAddInput {
            project_id: project_id.into(),
            session_id: "mcp-worker-session".into(),
            expected_revision: submitted["revision"].as_u64().unwrap(),
            operation_id: "op_mcp_evidence_add".into(),
            receipt: external_receipt("receipt-mcp-evidence", "op_mcp_evidence_add"),
        };
        let evidence_added = backend
            .project_evidence_add(&evidence_principal, evidence_input.clone())
            .await
            .expect("explicit evidence grant imports a typed synthetic receipt");
        assert_eq!(evidence_added["outcome"], "changed");
        assert_eq!(evidence_added["data"]["receipt_id"], "receipt-mcp-evidence");
        let evidence_replayed = backend
            .project_evidence_add(&evidence_principal, evidence_input.clone())
            .await
            .expect("exact receipt operation replays without creating another receipt");
        assert_eq!(evidence_replayed["outcome"], "unchanged");
        assert_eq!(evidence_replayed["data"]["replayed"], true);

        let mut changed_receipt = evidence_input.receipt.clone();
        changed_receipt["output_digest"] = json!("sha256:changed-payload");
        let changed_input = ProjectEvidenceAddInput {
            receipt: changed_receipt,
            ..evidence_input.clone()
        };
        match backend
            .project_evidence_add(&evidence_principal, changed_input)
            .await
        {
            Err(AdapterError::Application { outcome, .. }) => {
                assert_eq!(outcome, ApplicationOutcome::Conflict);
            }
            other => {
                panic!("receipt operation ID reuse with changed content was accepted: {other:?}")
            }
        }

        let stale_input = ProjectEvidenceAddInput {
            expected_revision: submitted["revision"].as_u64().unwrap(),
            operation_id: "op_mcp_stale_evidence".into(),
            receipt: external_receipt("receipt-mcp-stale", "op_mcp_stale_evidence"),
            ..evidence_input.clone()
        };
        match backend
            .project_evidence_add(&evidence_principal, stale_input)
            .await
        {
            Err(AdapterError::Application { outcome, error, .. }) => {
                assert_eq!(outcome, ApplicationOutcome::Conflict);
                assert_eq!(error.code, boreal_protocol::ErrorCode::StaleRevision);
            }
            other => panic!("stale receipt revision was not returned as a conflict: {other:?}"),
        }
        let evidence_readback = backend
            .project_operation_status(
                &evidence_principal,
                project_id.into(),
                "op_mcp_evidence_add".into(),
            )
            .await
            .expect("receipt mutation remains queryable by its durable operation ID");
        assert_eq!(
            evidence_readback["data"]["operation"]["operation_id"],
            "op_mcp_evidence_add"
        );

        let finish_policy = Policy {
            actor_id: worker_id.into(),
            projects: BTreeSet::from([project_id.into()]),
            scopes: BTreeSet::from([SCOPE_PROJECT_READ.into(), SCOPE_PROJECT_FINISH_CLOSE.into()]),
        };
        let finish_principal = AuthenticatedPrincipal::from_stdio_policy(
            "test-finish-closer",
            &finish_policy,
            &backend.config,
        );
        let finish_capabilities = backend.capabilities(&finish_principal);
        let finish_tool_list = finish_capabilities["projects"][0]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect::<BTreeSet<_>>();
        assert!(finish_tool_list.contains("project_finish_close"));
        assert!(!finish_tool_list.contains("project_work_edit"));
        assert!(!finish_tool_list.contains("project_evidence_add"));

        let current_before_finish = backend
            .project_status(&principal, project_id.into(), 10, 0)
            .await
            .expect("current revision is read before finish-close");
        let finish_input = ProjectFinishCloseInput {
            project_id: project_id.into(),
            session_id: "mcp-worker-session".into(),
            work_id: "mcp-tool-work".into(),
            attempt_id: "mcp-tool-attempt".into(),
            fence: claimed["data"]["fence"].as_u64().unwrap(),
            expected_revision: current_before_finish["revision"].as_u64().unwrap(),
            operation_id: "op_mcp_finish_close".into(),
            receipt: external_receipt("receipt-mcp-finish", "op_mcp_finish_receipt"),
            summary_body: "Synthetic finish-close summary; no verifier was run by MCP.".into(),
        };

        // A disposable same-tree proxy commits the finish through the real
        // Project daemon, then drops only the MCP client's response. The
        // original durable operation ID is available for reconciliation.
        let finish_proxy_socket = root.0.join(".boreal/mcp-finish-proxy.sock");
        let finish_proxy_listener = UnixListener::bind(&finish_proxy_socket)
            .expect("temporary finish response-loss proxy binds");
        fs::set_permissions(&finish_proxy_socket, fs::Permissions::from_mode(0o600))
            .expect("finish proxy socket is owner-only");
        let finish_upstream_socket = socket.clone();
        let finish_proxy_thread = thread::spawn(move || {
            for request_number in 0..2 {
                let (mut downstream, _) = finish_proxy_listener
                    .accept()
                    .expect("finish proxy accepts MCP call");
                let mut prefix = [0_u8; 4];
                downstream
                    .read_exact(&mut prefix)
                    .expect("finish MCP request frame length arrives");
                let mut request_body = vec![0; u32::from_be_bytes(prefix) as usize];
                downstream
                    .read_exact(&mut request_body)
                    .expect("finish MCP request body arrives");
                let mut upstream = UnixStream::connect(&finish_upstream_socket)
                    .expect("finish proxy reaches the disposable daemon");
                upstream.write_all(&prefix).expect("upstream frame starts");
                upstream
                    .write_all(&request_body)
                    .expect("upstream receives exact finish request");
                let mut response_prefix = [0_u8; 4];
                upstream
                    .read_exact(&mut response_prefix)
                    .expect("real daemon completes and returns finish response");
                let mut response_body = vec![0; u32::from_be_bytes(response_prefix) as usize];
                upstream
                    .read_exact(&mut response_body)
                    .expect("real daemon finish response body arrives");
                if request_number == 1 {
                    downstream
                        .write_all(&response_prefix)
                        .expect("finish operation readback length forwards");
                    downstream
                        .write_all(&response_body)
                        .expect("finish operation readback body forwards");
                }
            }
        });
        let finish_proxy_config = Arc::new(McpConfig {
            version: 1,
            global: None,
            projects: BTreeMap::from([(
                project_id.into(),
                ProjectEndpoint {
                    socket: finish_proxy_socket,
                    credential_env_by_actor: BTreeMap::from([(
                        worker_id.into(),
                        worker_credential_env.clone(),
                    )]),
                },
            )]),
            principals: BTreeMap::new(),
            stdio_profiles: BTreeMap::new(),
            http: None,
        });
        finish_proxy_config
            .validate()
            .expect("finish response-loss proxy binding is valid");
        let finish_proxy_backend = BorealBackend::new(finish_proxy_config);
        let finish_lost = finish_proxy_backend
            .project_finish_close(&finish_principal, finish_input.clone())
            .await
            .expect_err("dropped finish response is reported as an unknown outcome");
        assert!(matches!(
            finish_lost,
            AdapterError::UnknownOutcome { ref operation_id, .. }
                if operation_id == "op_mcp_finish_close"
        ));
        let finish_readback = finish_proxy_backend
            .project_operation_status(
                &finish_principal,
                project_id.into(),
                "op_mcp_finish_close".into(),
            )
            .await
            .expect_err("readback returns Boreal's durable missing-gate rejection");
        match finish_readback {
            AdapterError::Application { outcome, error, .. } => {
                assert_eq!(outcome, ApplicationOutcome::Rejected, "{error:?}");
            }
            other => panic!("finish operation readback was not an application result: {other:?}"),
        }
        finish_proxy_thread
            .join()
            .expect("finish proxy forwards the request and its readback");

        match backend
            .project_finish_close(&finish_principal, finish_input.clone())
            .await
        {
            Err(AdapterError::Application { outcome, .. }) => {
                // The fixture does not claim a checkpoint receipt. Boreal
                // retains its authoritative gate rejection and finish result.
                assert_eq!(outcome, ApplicationOutcome::Rejected);
            }
            other => panic!("finish-close replay did not retain the authoritative missing-gate result: {other:?}"),
        }
        let changed_finish = ProjectFinishCloseInput {
            summary_body: "A different summary cannot reuse the close operation ID.".into(),
            ..finish_input
        };
        match backend
            .project_finish_close(&finish_principal, changed_finish)
            .await
        {
            Err(AdapterError::Application { outcome, .. }) => {
                assert_eq!(outcome, ApplicationOutcome::Conflict);
            }
            other => {
                panic!("changed finish-close payload reused a durable operation ID: {other:?}")
            }
        }

        let post_start = backend
            .project_status(&principal, project_id.into(), 10, 0)
            .await
            .expect("post-start revision is available for the recovery write");

        // This same-tree Unix proxy lets the real service commit a write while
        // dropping only its response to the MCP backend, then forwards exact
        // operation readback normally on the next connection.
        let proxy_socket = root.0.join(".boreal/mcp-project-proxy.sock");
        let proxy_listener = UnixListener::bind(&proxy_socket)
            .expect("temporary owner-only MCP response-loss proxy binds");
        fs::set_permissions(&proxy_socket, fs::Permissions::from_mode(0o600))
            .expect("proxy socket is owner-only");
        let upstream_socket = socket.clone();
        let proxy_thread = thread::spawn(move || {
            for request_number in 0..2 {
                let (mut downstream, _) = proxy_listener.accept().expect("proxy accepts MCP call");
                let mut prefix = [0_u8; 4];
                downstream
                    .read_exact(&mut prefix)
                    .expect("MCP request frame length arrives");
                let mut request_body = vec![0; u32::from_be_bytes(prefix) as usize];
                downstream
                    .read_exact(&mut request_body)
                    .expect("MCP request body arrives");
                let mut upstream = UnixStream::connect(&upstream_socket)
                    .expect("proxy forwards to the real disposable daemon");
                upstream.write_all(&prefix).expect("upstream frame starts");
                upstream
                    .write_all(&request_body)
                    .expect("upstream receives exact MCP payload");
                let mut response_prefix = [0_u8; 4];
                upstream
                    .read_exact(&mut response_prefix)
                    .expect("real daemon completed and returned a response");
                let mut response_body = vec![0; u32::from_be_bytes(response_prefix) as usize];
                upstream
                    .read_exact(&mut response_body)
                    .expect("real daemon response body arrives");
                if request_number == 1 {
                    downstream
                        .write_all(&response_prefix)
                        .expect("operation readback response length forwards");
                    downstream
                        .write_all(&response_body)
                        .expect("operation readback response forwards");
                }
            }
        });
        let proxy_config = Arc::new(McpConfig {
            version: 1,
            global: None,
            projects: BTreeMap::from([(
                project_id.into(),
                ProjectEndpoint {
                    socket: proxy_socket,
                    credential_env_by_actor: BTreeMap::from([
                        (actor_id.into(), credential_env),
                        (worker_id.into(), worker_credential_env),
                    ]),
                },
            )]),
            principals: BTreeMap::new(),
            stdio_profiles: BTreeMap::new(),
            http: None,
        });
        proxy_config
            .validate()
            .expect("temporary proxy binding is valid");
        let proxy_backend = BorealBackend::new(proxy_config);
        let uncertain_operation = "op_mcp_lost_reply_edit";
        let lost_reply = proxy_backend
            .project_work_edit(
                &principal,
                WorkEditInput {
                    project_id: project_id.into(),
                    work_id: "mcp-tool-work".into(),
                    operation_id: uncertain_operation.into(),
                    expected_revision: post_start["revision"].as_u64().unwrap(),
                    title: Some("Committed despite a lost response".into()),
                    description: None,
                    parent_id: None,
                    priority: None,
                    dispatch_policy: None,
                },
            )
            .await
            .unwrap_err();
        assert!(matches!(
            lost_reply,
            AdapterError::UnknownOutcome { ref operation_id, .. }
                if operation_id == uncertain_operation
        ));
        let recovery = proxy_backend
            .project_operation_status(&principal, project_id.into(), uncertain_operation.into())
            .await
            .expect("same operation ID reads back the committed write");
        assert_eq!(
            recovery["data"]["operation"]["operation_id"],
            uncertain_operation
        );
        proxy_thread.join().expect("proxy forwards both operations");
        drop(service);
        drop(env_guard);
        drop(_worker_env_guard);
    }
}
