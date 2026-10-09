use std::{borrow::Cow, path::PathBuf, sync::Arc};

use axum::{
    body::Body,
    extract::{DefaultBodyLimit, Request, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use rmcp::{
    handler::server::wrapper::Parameters,
    model::{
        CacheScope, CallToolResult, ContentBlock, ErrorCode, ErrorData, Implementation,
        ListToolsResult, PaginatedRequestParams, ProtocolVersion, ServerCapabilities, ServerConfig,
    },
    service::{RequestContext, RoleServer},
    tool, tool_handler, tool_router, ServerHandler, ServiceExt,
};
use serde::Deserialize;
use serde_json::{json, Value};
use tower::limit::ConcurrencyLimitLayer;
use tracing::{info, warn};

use crate::{
    auth::{AuthError, AuthenticatedPrincipal, OAuthIntrospector},
    backend::{AdapterError, BorealBackend, WorkClaimInput, WorkEditInput},
    config::{HttpConfig, McpConfig, SCOPE_GLOBAL_READ, SCOPE_PROJECT_READ, SCOPE_PROJECT_WRITE},
    MAX_HTTP_BODY_BYTES, MAX_TOOL_INPUT_BYTES, MAX_TOOL_OUTPUT_BYTES,
};

const HTTP_ENDPOINT: &str = "/mcp";
const OAUTH_RESOURCE_METADATA_ROOT: &str = "/.well-known/oauth-protected-resource";
const OAUTH_RESOURCE_METADATA_MCP: &str = "/.well-known/oauth-protected-resource/mcp";

#[derive(Clone)]
struct HttpAuthState {
    http: HttpConfig,
    introspector: OAuthIntrospector,
}

#[derive(Clone)]
pub struct BorealMcpServer {
    backend: BorealBackend,
    fixed_principal: Option<AuthenticatedPrincipal>,
    #[allow(dead_code)] // Read by rmcp's generated #[tool_handler] implementation.
    tool_router: rmcp::handler::server::tool::ToolRouter<Self>,
}

#[tool_router]
impl BorealMcpServer {
    fn http(_config: Arc<McpConfig>, backend: BorealBackend) -> Self {
        Self {
            backend,
            fixed_principal: None,
            tool_router: Self::tool_router(),
        }
    }

    fn stdio(config: Arc<McpConfig>, profile_name: &str) -> Result<Self, String> {
        let policy = config
            .stdio_profiles
            .get(profile_name)
            .ok_or_else(|| format!("stdio profile {profile_name:?} is not configured"))?;
        let principal = AuthenticatedPrincipal::from_stdio_policy(
            format!("stdio:{profile_name}"),
            policy,
            &config,
        );
        Ok(Self {
            backend: BorealBackend::new(config.clone()),
            fixed_principal: Some(principal),
            tool_router: Self::tool_router(),
        })
    }

    fn principal(
        &self,
        context: &RequestContext<RoleServer>,
    ) -> Result<AuthenticatedPrincipal, AdapterError> {
        if let Some(principal) = &self.fixed_principal {
            return Ok(principal.clone());
        }
        let parts = context.extensions.get::<http::request::Parts>().ok_or(
            AdapterError::PermissionDenied {
                scope: "authenticated HTTP principal",
            },
        )?;
        parts
            .extensions
            .get::<AuthenticatedPrincipal>()
            .cloned()
            .ok_or(AdapterError::PermissionDenied {
                scope: "authenticated HTTP principal",
            })
    }

    fn success(value: Value) -> CallToolResult {
        match serde_json::to_string(&value) {
            Ok(encoded) => CallToolResult::success(vec![ContentBlock::text(encoded)]),
            Err(_) => tool_error(AdapterError::ProtocolMismatch),
        }
    }

    fn finish<T: Into<Value>>(
        &self,
        principal: Result<AuthenticatedPrincipal, AdapterError>,
        tool: &'static str,
        required_scope: &'static str,
        operation_id: Option<&str>,
        result: Result<T, AdapterError>,
    ) -> CallToolResult {
        match (principal, result) {
            (Ok(principal), Ok(value)) => {
                info!(
                    principal = %principal.subject,
                    actor = %principal.actor_id,
                    scope = required_scope,
                    operation_id = operation_id.unwrap_or("read"),
                    tool,
                    outcome = "success",
                    "Boreal MCP tool completed"
                );
                Self::success(value.into())
            }
            (Err(error), _) | (_, Err(error)) => {
                warn!(
                    tool,
                    scope = required_scope,
                    operation_id = operation_id.unwrap_or("read"),
                    outcome = "error",
                    "Boreal MCP tool did not complete"
                );
                tool_error(error)
            }
        }
    }

    fn scope_project(
        principal: &AuthenticatedPrincipal,
        project_id: &str,
        required: &'static str,
    ) -> Result<(), AdapterError> {
        if !principal.has_scope(required) || !principal.project_ids.contains(project_id) {
            return Err(AdapterError::PermissionDenied { scope: required });
        }
        Ok(())
    }

    fn check_input<T: serde::Serialize>(value: &T) -> Result<(), AdapterError> {
        let bytes = serde_json::to_vec(value).map_err(|_| AdapterError::ProtocolMismatch)?;
        if bytes.len() > MAX_TOOL_INPUT_BYTES {
            return Err(AdapterError::InvalidInput {
                field: "arguments",
                reason: "encoded tool arguments exceed 16 KiB",
            });
        }
        Ok(())
    }

    #[tool(
        name = "boreal_capabilities",
        description = "Discover this connection's allowed Global and explicitly bound Project scopes. Does not enumerate unbound projects.",
        annotations(
            read_only_hint = true,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn boreal_capabilities(&self, context: RequestContext<RoleServer>) -> CallToolResult {
        let principal = self.principal(&context);
        match principal {
            Ok(principal) => {
                let data = self.backend.capabilities(&principal);
                self.finish(
                    Ok(principal),
                    "boreal_capabilities",
                    "authenticated",
                    None,
                    Ok(data),
                )
            }
            Err(error) => tool_error(error),
        }
    }

    #[tool(
        name = "global_page",
        description = "Read one bounded page of Global projects, items, or notes. Global is this Boreal installation's portfolio and requires an explicit Global read grant.",
        annotations(
            read_only_hint = true,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn global_page(
        &self,
        Parameters(input): Parameters<GlobalPageInput>,
        context: RequestContext<RoleServer>,
    ) -> CallToolResult {
        let principal = self.principal(&context);
        if let Err(error) = Self::check_input(&input) {
            return tool_error(error);
        }
        let result = match &principal {
            Ok(principal) => {
                self.backend
                    .global_page(
                        principal,
                        input.collection.clone(),
                        input.query.clone(),
                        input.limit.unwrap_or(20),
                        input.offset.unwrap_or(0),
                    )
                    .await
            }
            Err(error) => Err(error.clone()),
        };
        self.finish(principal, "global_page", SCOPE_GLOBAL_READ, None, result)
    }

    #[tool(
        name = "project_status",
        description = "Read a bounded revision-consistent status page from one explicitly selected Project workspace.",
        annotations(
            read_only_hint = true,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn project_status(
        &self,
        Parameters(input): Parameters<ProjectPageInput>,
        context: RequestContext<RoleServer>,
    ) -> CallToolResult {
        let principal = self.principal(&context);
        if let Err(error) = Self::check_input(&input) {
            return tool_error(error);
        }
        let result = match &principal {
            Ok(principal) => {
                self.backend
                    .project_status(
                        principal,
                        input.project_id.clone(),
                        input.limit.unwrap_or(20),
                        input.offset.unwrap_or(0),
                    )
                    .await
            }
            Err(error) => Err(error.clone()),
        };
        self.finish(
            principal,
            "project_status",
            SCOPE_PROJECT_READ,
            None,
            result,
        )
    }

    #[tool(
        name = "project_work_show",
        description = "Read one work item from an explicitly selected Project workspace.",
        annotations(
            read_only_hint = true,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn project_work_show(
        &self,
        Parameters(input): Parameters<ProjectWorkShowInput>,
        context: RequestContext<RoleServer>,
    ) -> CallToolResult {
        let principal = self.principal(&context);
        if let Err(error) = Self::check_input(&input) {
            return tool_error(error);
        }
        let result = match &principal {
            Ok(principal) => {
                self.backend
                    .project_work_show(principal, input.project_id.clone(), input.work_id.clone())
                    .await
            }
            Err(error) => Err(error.clone()),
        };
        self.finish(
            principal,
            "project_work_show",
            SCOPE_PROJECT_READ,
            None,
            result,
        )
    }

    #[tool(
        name = "project_source_list",
        description = "List bounded source metadata from an explicitly selected Project. Does not return source bodies or arbitrary file paths.",
        annotations(
            read_only_hint = true,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn project_source_list(
        &self,
        Parameters(input): Parameters<ProjectPageInput>,
        context: RequestContext<RoleServer>,
    ) -> CallToolResult {
        let principal = self.principal(&context);
        if let Err(error) = Self::check_input(&input) {
            return tool_error(error);
        }
        let result = match &principal {
            Ok(principal) => {
                self.backend
                    .project_source_list(
                        principal,
                        input.project_id.clone(),
                        input.limit.unwrap_or(20),
                        input.offset.unwrap_or(0),
                    )
                    .await
            }
            Err(error) => Err(error.clone()),
        };
        self.finish(
            principal,
            "project_source_list",
            SCOPE_PROJECT_READ,
            None,
            result,
        )
    }

    #[tool(
        name = "operation_status",
        description = "Read back one original durable operation outcome after a timeout or lost response. It does not retry the operation.",
        annotations(
            read_only_hint = true,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn operation_status(
        &self,
        Parameters(input): Parameters<OperationStatusInput>,
        context: RequestContext<RoleServer>,
    ) -> CallToolResult {
        let principal = self.principal(&context);
        if let Err(error) = Self::check_input(&input) {
            return tool_error(error);
        }
        let result = match &principal {
            Ok(principal) => {
                self.backend
                    .project_operation_status(
                        principal,
                        input.project_id.clone(),
                        input.operation_id.clone(),
                    )
                    .await
            }
            Err(error) => Err(error.clone()),
        };
        self.finish(
            principal,
            "operation_status",
            SCOPE_PROJECT_READ,
            Some(&input.operation_id),
            result,
        )
    }

    #[tool(
        name = "project_work_edit",
        description = "Edit an existing work item using its expected project revision and a durable operation ID. A stale revision returns a conflict.",
        annotations(
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn project_work_edit(
        &self,
        Parameters(input): Parameters<WorkEditInput>,
        context: RequestContext<RoleServer>,
    ) -> CallToolResult {
        let principal = self.principal(&context);
        if let Err(error) = Self::check_input(&input) {
            return tool_error(error);
        }
        if let Ok(principal) = &principal {
            if let Err(error) =
                Self::scope_project(principal, &input.project_id, SCOPE_PROJECT_WRITE)
            {
                return tool_error(error);
            }
        }
        let operation_id = input.operation_id.clone();
        let result = match &principal {
            Ok(principal) => self.backend.project_work_edit(principal, input).await,
            Err(error) => Err(error.clone()),
        };
        self.finish(
            principal,
            "project_work_edit",
            SCOPE_PROJECT_WRITE,
            Some(&operation_id),
            result,
        )
    }

    #[tool(
        name = "project_work_claim",
        description = "Claim one eligible Project task through the existing attempt service. Requires project grant, source/config identity, expected revision, attempt/session IDs, and a durable operation ID.",
        annotations(
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn project_work_claim(
        &self,
        Parameters(input): Parameters<WorkClaimInput>,
        context: RequestContext<RoleServer>,
    ) -> CallToolResult {
        let principal = self.principal(&context);
        if let Err(error) = Self::check_input(&input) {
            return tool_error(error);
        }
        if let Ok(principal) = &principal {
            if let Err(error) =
                Self::scope_project(principal, &input.project_id, SCOPE_PROJECT_WRITE)
            {
                return tool_error(error);
            }
        }
        let operation_id = input.operation_id.clone();
        let result = match &principal {
            Ok(principal) => self.backend.project_work_claim(principal, input).await,
            Err(error) => Err(error.clone()),
        };
        self.finish(
            principal,
            "project_work_claim",
            SCOPE_PROJECT_WRITE,
            Some(&operation_id),
            result,
        )
    }
}

#[tool_handler]
impl ServerHandler for BorealMcpServer {
    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        let principal = self
            .principal(&context)
            .map_err(|error| ErrorData::new(ErrorCode::INVALID_REQUEST, error.to_string(), None))?;
        let capabilities = self.backend.capabilities(&principal);
        let mut available = std::collections::BTreeSet::from(["boreal_capabilities".to_owned()]);
        if let Some(global_tools) = capabilities["global"]["tools"].as_array() {
            available.extend(
                global_tools
                    .iter()
                    .filter_map(Value::as_str)
                    .map(ToOwned::to_owned),
            );
        }
        if let Some(projects) = capabilities["projects"].as_array() {
            for project in projects {
                if let Some(tools) = project["tools"].as_array() {
                    available.extend(
                        tools
                            .iter()
                            .filter_map(Value::as_str)
                            .map(ToOwned::to_owned),
                    );
                }
            }
        }
        let tools = self
            .tool_router
            .list_all()
            .into_iter()
            .filter(|tool| available.contains(tool.name.as_ref()))
            .collect();
        Ok(ListToolsResult::with_all_items(tools)
            .with_ttl_ms(0)
            .with_cache_scope(CacheScope::Private))
    }

    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new(
                "boreal-mcp",
                env!("CARGO_PKG_VERSION"),
            ))
            .with_instructions(
                "Boreal MCP uses explicit Global and Project scopes. All writes use the existing Boreal services, expected revisions, and durable operation IDs.",
            )
    }

    fn supported_protocol_versions(&self) -> Cow<'static, [ProtocolVersion]> {
        Cow::Borrowed(&[ProtocolVersion::V_2026_07_28])
    }
}

#[derive(Clone, Debug, Deserialize, serde::Serialize, rmcp::schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
struct GlobalPageInput {
    collection: String,
    query: Option<String>,
    limit: Option<u32>,
    offset: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, serde::Serialize, rmcp::schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
struct ProjectPageInput {
    project_id: String,
    limit: Option<u32>,
    offset: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, serde::Serialize, rmcp::schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
struct ProjectWorkShowInput {
    project_id: String,
    work_id: String,
}

#[derive(Clone, Debug, Deserialize, serde::Serialize, rmcp::schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
struct OperationStatusInput {
    project_id: String,
    /// Exact durable Boreal operation ID to read back.
    operation_id: String,
}

fn tool_error(error: AdapterError) -> CallToolResult {
    let data = match &error {
        AdapterError::UnknownOutcome {
            operation_id,
            readback,
            protocol_error,
        } => json!({
            "error": "unknown_outcome",
            "outcome": "unknown",
            "message": error.to_string(),
            "operation_id": operation_id,
            "recovery_tool": "operation_status",
            "readback": readback,
            "readback_required": protocol_error
                .as_ref()
                .and_then(|error| error.readback_required),
            "recovery": protocol_error
                .as_ref()
                .and_then(|error| error.recovery.as_ref()),
        }),
        AdapterError::Application {
            operation_id,
            outcome,
            error: protocol_error,
            revision,
        } => json!({
            "error": "application_rejected",
            "outcome": outcome,
            "code": protocol_error.code,
            "message": protocol_error.message,
            "retryable": protocol_error.retryable,
            "operation_id": operation_id,
            "expected_revision": protocol_error.expected_revision,
            "observed_revision": protocol_error.observed_revision.or(*revision),
        }),
        _ => json!({"error": "boreal_mcp", "message": error.to_string()}),
    };
    let mut text =
        serde_json::to_string(&data).unwrap_or_else(|_| "{\"error\":\"boreal_mcp\"}".to_owned());
    if text.len() > MAX_TOOL_OUTPUT_BYTES {
        text = match &error {
            AdapterError::UnknownOutcome { operation_id, .. } => serde_json::to_string(&json!({
                "error": "unknown_outcome",
                "outcome": "unknown",
                "message": "the service response included oversized recovery data; read the operation status before retrying",
                "operation_id": operation_id,
                "recovery_tool": "operation_status",
                "readback": null,
                "readback_omitted": true,
                "readback_required": true,
            }))
            .unwrap_or_else(|_| "{\"error\":\"unknown_outcome\"}".to_owned()),
            _ => "{\"error\":\"boreal_mcp\",\"message\":\"Boreal MCP error details exceeded the inline output limit\"}"
                .to_owned(),
        };
    }
    CallToolResult::error(vec![ContentBlock::text(text)])
}

pub async fn run_stdio(config: McpConfig, profile_name: &str) -> Result<(), String> {
    config.validate().map_err(|error| error.to_string())?;
    let config = Arc::new(config);
    let server = BorealMcpServer::stdio(config, profile_name)?;
    let transport = rmcp::transport::io::stdio();
    let running = server
        .serve(transport)
        .await
        .map_err(|error| format!("cannot start MCP stdio transport: {error}"))?;
    let result = running
        .waiting()
        .await
        .map_err(|error| format!("MCP stdio transport ended unexpectedly: {error}"))?;
    tracing::info!(?result, "Boreal MCP stdio server stopped");
    Ok(())
}

pub fn build_http_router(config: McpConfig) -> Result<Router, String> {
    config.validate().map_err(|error| error.to_string())?;
    let config = Arc::new(config);
    let http = config
        .http
        .clone()
        .ok_or_else(|| "HTTP transport is not configured".to_owned())?;
    let introspector = OAuthIntrospector::from_config(&config, &http)
        .map_err(|error| format!("cannot initialize OAuth introspection: {error}"))?;
    Ok(build_http_router_with_introspector(
        config,
        http,
        introspector,
    ))
}

fn build_http_router_with_introspector(
    config: Arc<McpConfig>,
    http: HttpConfig,
    introspector: OAuthIntrospector,
) -> Router {
    let backend = BorealBackend::new(config.clone());
    let auth_state = HttpAuthState {
        http: http.clone(),
        introspector,
    };
    let service_config =
        rmcp::transport::streamable_http_server::StreamableHttpServerConfig::default()
            .with_legacy_session_mode(false)
            .with_stateless_protocol_metadata_required(true)
            .with_json_response(true)
            .with_max_request_body_bytes(MAX_HTTP_BODY_BYTES)
            .with_allowed_hosts(http_hosts(&http))
            .with_allowed_origins(http.allowed_origins.clone())
            .enforce_origin_validation();
    let server_config = config.clone();
    let service_backend = backend.clone();
    let service = rmcp::transport::streamable_http_server::StreamableHttpService::new(
        move || {
            Ok(BorealMcpServer::http(
                server_config.clone(),
                service_backend.clone(),
            ))
        },
        rmcp::transport::streamable_http_server::session::local::LocalSessionManager::default()
            .into(),
        service_config,
    );
    Router::new()
        .route(HTTP_ENDPOINT, axum::routing::any_service(service))
        .route(OAUTH_RESOURCE_METADATA_ROOT, get(resource_metadata))
        .route(OAUTH_RESOURCE_METADATA_MCP, get(resource_metadata))
        .with_state(auth_state.clone())
        .layer(DefaultBodyLimit::max(MAX_HTTP_BODY_BYTES))
        .layer(ConcurrencyLimitLayer::new(64))
        .layer(middleware::from_fn_with_state(
            auth_state,
            authenticate_http,
        ))
}

pub async fn serve_http(config: McpConfig) -> Result<(), String> {
    let http = config
        .http
        .clone()
        .ok_or_else(|| "HTTP transport is not configured".to_owned())?;
    let router = build_http_router(config)?;
    let address = http.bind;
    if let Some(tls) = http.tls {
        let (certificate, private_key) = read_tls_identity(&tls.certificate, &tls.private_key)?;
        let tls_config = axum_server::tls_rustls::RustlsConfig::from_pem(certificate, private_key)
            .await
            .map_err(|error| format!("cannot load MCP TLS identity: {error}"))?;
        info!(%address, "Boreal MCP Streamable HTTP listening with TLS");
        axum_server::bind_rustls(address, tls_config)
            .serve(router.into_make_service())
            .await
            .map_err(|error| format!("Boreal MCP HTTP listener failed: {error}"))?;
    } else {
        if !address.ip().is_loopback() {
            return Err("refusing to start a non-loopback listener without TLS".into());
        }
        let listener = tokio::net::TcpListener::bind(address)
            .await
            .map_err(|error| format!("cannot bind MCP loopback listener: {error}"))?;
        info!(%address, "Boreal MCP Streamable HTTP listening on loopback with OAuth bearer auth");
        axum::serve(listener, router)
            .with_graceful_shutdown(async {
                let _ = tokio::signal::ctrl_c().await;
            })
            .await
            .map_err(|error| format!("Boreal MCP HTTP listener failed: {error}"))?;
    }
    Ok(())
}

async fn authenticate_http(
    State(state): State<HttpAuthState>,
    mut request: Request<Body>,
    next: Next,
) -> Response {
    if let Err(status) = validate_host_origin(request.headers(), &state.http) {
        return (status, "request Host or Origin is not allowed").into_response();
    }
    let path = request.uri().path();
    if matches!(
        path,
        OAUTH_RESOURCE_METADATA_ROOT | OAUTH_RESOURCE_METADATA_MCP
    ) {
        return next.run(request).await;
    }
    if path != HTTP_ENDPOINT {
        return StatusCode::NOT_FOUND.into_response();
    }
    let Some(token) = bearer_token(request.headers()) else {
        return unauthorized(&state.http);
    };
    match state.introspector.authenticate_token(token).await {
        Ok(principal) => {
            request.extensions_mut().insert(principal);
            next.run(request).await
        }
        Err(AuthError::Unauthorized) => unauthorized(&state.http),
        Err(AuthError::Unavailable | AuthError::Misconfigured) => (
            StatusCode::SERVICE_UNAVAILABLE,
            "OAuth authorization is temporarily unavailable",
        )
            .into_response(),
    }
}

async fn resource_metadata(State(state): State<HttpAuthState>) -> Json<Value> {
    Json(json!({
        "resource": state.http.resource_uri,
        "authorization_servers": state.http.authorization_servers,
        "scopes_supported": [SCOPE_GLOBAL_READ, SCOPE_PROJECT_READ, SCOPE_PROJECT_WRITE],
        "bearer_methods_supported": ["header"],
    }))
}

fn unauthorized(http: &HttpConfig) -> Response {
    let mut metadata = http.resource_uri.clone();
    metadata.set_path(OAUTH_RESOURCE_METADATA_MCP);
    metadata.set_query(None);
    let challenge = format!("Bearer resource_metadata=\"{}\"", metadata);
    let mut response = (
        StatusCode::UNAUTHORIZED,
        "valid OAuth bearer token required",
    )
        .into_response();
    if let Ok(value) = HeaderValue::from_str(&challenge) {
        response
            .headers_mut()
            .insert(header::WWW_AUTHENTICATE, value);
    }
    response
}

fn bearer_token(headers: &HeaderMap) -> Option<&str> {
    let value = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    let (scheme, token) = value.split_once(' ')?;
    if !scheme.eq_ignore_ascii_case("Bearer")
        || token.is_empty()
        || token.len() > 4096
        || token.contains(char::is_whitespace)
    {
        return None;
    }
    Some(token)
}

fn validate_host_origin(headers: &HeaderMap, http: &HttpConfig) -> Result<(), StatusCode> {
    let host = headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .ok_or(StatusCode::FORBIDDEN)?;
    if !host_is_allowed(host, http) {
        return Err(StatusCode::FORBIDDEN);
    }
    if let Some(origin) = headers.get(header::ORIGIN) {
        let origin = origin.to_str().map_err(|_| StatusCode::FORBIDDEN)?;
        if !http.allowed_origins.iter().any(|allowed| allowed == origin) {
            return Err(StatusCode::FORBIDDEN);
        }
    }
    Ok(())
}

fn host_is_allowed(host: &str, http: &HttpConfig) -> bool {
    if !http.allowed_hosts.is_empty() {
        return http
            .allowed_hosts
            .iter()
            .any(|allowed| allowed.eq_ignore_ascii_case(host));
    }
    let Ok(authority) = http::uri::Authority::try_from(host) else {
        return false;
    };
    matches!(
        authority
            .host()
            .trim_matches(['[', ']'])
            .to_ascii_lowercase()
            .as_str(),
        "localhost" | "127.0.0.1" | "::1"
    )
}

fn http_hosts(http: &HttpConfig) -> Vec<String> {
    if http.allowed_hosts.is_empty() {
        vec!["localhost".into(), "127.0.0.1".into(), "[::1]".into()]
    } else {
        http.allowed_hosts.clone()
    }
}

#[cfg(unix)]
fn read_tls_identity(
    certificate: &PathBuf,
    private_key: &PathBuf,
) -> Result<(Vec<u8>, Vec<u8>), String> {
    use std::{
        io::Read,
        os::unix::fs::{MetadataExt, OpenOptionsExt},
    };
    unsafe extern "C" {
        fn geteuid() -> u32;
    }
    let read_checked = |path: &PathBuf, private: bool| -> Result<Vec<u8>, String> {
        let file = std::fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK)
            .open(path)
            .map_err(|_| {
                format!(
                    "TLS {} file is unavailable",
                    if private {
                        "private-key"
                    } else {
                        "certificate"
                    }
                )
            })?;
        let metadata = file
            .metadata()
            .map_err(|_| "TLS identity file metadata is unavailable")?;
        let private_mode_invalid = private && metadata.mode() & 0o777 != 0o600;
        if !metadata.is_file()
            || metadata.uid() != unsafe { geteuid() }
            || metadata.mode() & 0o022 != 0
            || private_mode_invalid
        {
            return Err(format!(
                "TLS {} file must be owner-owned, regular and private{}",
                if private {
                    "private-key"
                } else {
                    "certificate"
                },
                if private {
                    " (mode 0600)"
                } else {
                    " (not group/world writable)"
                },
            ));
        }
        if metadata.len() > 1024 * 1024 {
            return Err("TLS identity file exceeds the 1 MiB size limit".into());
        }
        let mut bytes = Vec::with_capacity(metadata.len() as usize);
        file.take(1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "cannot read TLS identity file")?;
        if bytes.len() > 1024 * 1024 {
            return Err("TLS identity file exceeds the 1 MiB size limit".into());
        }
        Ok(bytes)
    };
    Ok((
        read_checked(certificate, false)?,
        read_checked(private_key, true)?,
    ))
}

#[cfg(not(unix))]
fn read_tls_identity(
    _certificate: &PathBuf,
    _private_key: &PathBuf,
) -> Result<(Vec<u8>, Vec<u8>), String> {
    Err("TLS file ownership validation requires a supported Unix host".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{GlobalEndpoint, IntrospectionConfig, Policy, ProjectEndpoint, TlsConfig};
    use std::{
        collections::{BTreeMap, BTreeSet},
        net::SocketAddr,
        path::PathBuf,
    };
    use url::Url;

    #[derive(Clone)]
    struct SyntheticProviderConfig {
        resource_uri: String,
        issuer: String,
    }

    fn http_config() -> HttpConfig {
        HttpConfig {
            bind: "127.0.0.1:8765".parse::<SocketAddr>().unwrap(),
            resource_uri: Url::parse("http://127.0.0.1:8765/mcp").unwrap(),
            authorization_servers: vec![Url::parse("http://127.0.0.1:9999/issuer").unwrap()],
            introspection: IntrospectionConfig {
                endpoint: Url::parse("http://127.0.0.1:9999/introspect").unwrap(),
                issuer: Url::parse("http://127.0.0.1:9999/issuer").unwrap(),
                client_id: "boreal-mcp-test".into(),
                client_secret_env: "BOREAL_MCP_TEST_SECRET".into(),
                max_token_lifetime_seconds: 600,
            },
            tls: None,
            allowed_hosts: vec!["127.0.0.1:8765".into()],
            allowed_origins: vec!["https://client.example.test".into()],
        }
    }

    fn config(http: HttpConfig) -> McpConfig {
        McpConfig {
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
                        "BOREAL_AGENT_A".into(),
                    )]),
                },
            )]),
            principals: BTreeMap::from([(
                "alice".into(),
                Policy {
                    actor_id: "agent-a".into(),
                    projects: BTreeSet::from(["project-a".into()]),
                    scopes: BTreeSet::from([SCOPE_PROJECT_READ.into()]),
                },
            )]),
            stdio_profiles: BTreeMap::new(),
            http: Some(http),
        }
    }

    async fn synthetic_introspection(
        State(provider_config): State<SyntheticProviderConfig>,
        headers: HeaderMap,
        axum::Form(fields): axum::Form<std::collections::HashMap<String, String>>,
    ) -> Response {
        if headers
            .get(header::AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            != Some("Basic Ym9yZWFsLW1jcC10ZXN0OnN5bnRoZXRpYy1zZWNyZXQ=")
        {
            return StatusCode::UNAUTHORIZED.into_response();
        }
        let token = fields.get("token").map(String::as_str).unwrap_or_default();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        Json(json!({
            "active": token == "synthetic-valid",
            "sub": "alice",
            "iss": provider_config.issuer,
            "aud": [provider_config.resource_uri],
            "exp": now + 300,
            "scope": "boreal:project:read"
        }))
        .into_response()
    }

    async fn post_mcp(
        client: &reqwest::Client,
        endpoint: &str,
        token: &str,
        body: Value,
    ) -> reqwest::Response {
        let method = body["method"].as_str().unwrap_or_default();
        let mut request = client
            .post(endpoint)
            .bearer_auth(token)
            .header(header::ACCEPT, "application/json, text/event-stream")
            .header(header::CONTENT_TYPE, "application/json")
            .header("mcp-protocol-version", crate::MCP_PROTOCOL_VERSION)
            .header("mcp-method", method)
            .body(serde_json::to_vec(&body).unwrap());
        if let Some(name) = body["params"]["name"].as_str() {
            request = request.header("mcp-name", name);
        }
        request.send().await.unwrap()
    }

    fn client_meta() -> Value {
        json!({
            "io.modelcontextprotocol/protocolVersion": crate::MCP_PROTOCOL_VERSION,
            "io.modelcontextprotocol/clientInfo": {"name":"synthetic-client","version":"1"},
            "io.modelcontextprotocol/clientCapabilities": {}
        })
    }

    #[tokio::test]
    async fn http_auth_and_project_allowlist_are_enforced_with_synthetic_credentials() {
        use std::{collections::BTreeSet, path::PathBuf};
        let mcp_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let mcp_addr = mcp_listener.local_addr().unwrap();
        let resource_uri = format!("http://{mcp_addr}/mcp");
        let provider_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let provider_addr = provider_listener.local_addr().unwrap();
        let issuer = format!("http://{provider_addr}/issuer");
        let provider = Router::new()
            .route("/introspect", axum::routing::post(synthetic_introspection))
            .with_state(SyntheticProviderConfig {
                resource_uri: resource_uri.clone(),
                issuer: issuer.clone(),
            });
        let provider_task =
            tokio::spawn(async move { axum::serve(provider_listener, provider).await.unwrap() });
        let mut http = http_config();
        http.bind = mcp_addr;
        http.resource_uri = Url::parse(&resource_uri).unwrap();
        http.authorization_servers = vec![Url::parse(&issuer).unwrap()];
        http.introspection.endpoint =
            Url::parse(&format!("http://{provider_addr}/introspect")).unwrap();
        http.introspection.issuer = Url::parse(&issuer).unwrap();
        http.allowed_hosts = vec![mcp_addr.to_string()];
        let config = McpConfig {
            version: 1,
            global: Some(GlobalEndpoint {
                socket: PathBuf::from("/tmp/global.sock"),
            }),
            projects: BTreeMap::from([(
                "project-a".into(),
                ProjectEndpoint {
                    socket: PathBuf::from("/tmp/absent-project-a.sock"),
                    credential_env_by_actor: BTreeMap::from([(
                        "agent-a".into(),
                        "BOREAL_MCP_SYNTHETIC_PROJECT_CREDENTIAL".into(),
                    )]),
                },
            )]),
            principals: BTreeMap::from([(
                "alice".into(),
                Policy {
                    actor_id: "agent-a".into(),
                    projects: BTreeSet::from(["project-a".into()]),
                    scopes: BTreeSet::from([SCOPE_PROJECT_READ.into()]),
                },
            )]),
            stdio_profiles: BTreeMap::new(),
            http: Some(http.clone()),
        };
        config.validate().unwrap();
        let introspector =
            OAuthIntrospector::with_secret(&config, &http, "synthetic-secret".into()).unwrap();
        let router = build_http_router_with_introspector(Arc::new(config), http, introspector);
        let mcp_task =
            tokio::spawn(async move { axum::serve(mcp_listener, router).await.unwrap() });
        let endpoint = format!("http://{mcp_addr}/mcp");
        let client = reqwest::Client::new();

        let missing = client.post(&endpoint).send().await.unwrap();
        assert_eq!(missing.status(), StatusCode::UNAUTHORIZED);

        let hostile_origin = client
            .post(&endpoint)
            .header(header::ORIGIN, "https://attacker.example")
            .send()
            .await
            .unwrap();
        assert_eq!(hostile_origin.status(), StatusCode::FORBIDDEN);

        let hostile_host = client
            .post(&endpoint)
            .header(header::HOST, "attacker.example")
            .send()
            .await
            .unwrap();
        assert_eq!(hostile_host.status(), StatusCode::FORBIDDEN);

        let revoked = post_mcp(&client, &endpoint, "synthetic-revoked", json!({"jsonrpc":"2.0","id":1,"method":"server/discover","params":{"_meta":client_meta()}})).await;
        assert_eq!(revoked.status(), StatusCode::UNAUTHORIZED);

        let initialized = post_mcp(&client, &endpoint, "synthetic-valid", json!({"jsonrpc":"2.0","id":1,"method":"server/discover","params":{"_meta":client_meta()}})).await;
        let initialized_status = initialized.status();
        let initialized_body = initialized.text().await.unwrap();
        assert_eq!(initialized_status, StatusCode::OK, "{initialized_body}");
        assert!(
            initialized_body.contains("boreal-mcp")
                && initialized_body.contains(crate::MCP_PROTOCOL_VERSION),
            "{initialized_body}"
        );

        let listed = post_mcp(
            &client,
            &endpoint,
            "synthetic-valid",
            json!({"jsonrpc":"2.0","id":4,"method":"tools/list","params":{"_meta":client_meta()}}),
        )
        .await;
        assert_eq!(listed.status(), StatusCode::OK);
        let listed_body = listed.text().await.unwrap();
        assert!(listed_body.contains("project_work_show"), "{listed_body}");
        assert!(listed_body.contains("boreal_capabilities"), "{listed_body}");
        assert!(!listed_body.contains("global_page"), "{listed_body}");
        assert!(!listed_body.contains("project_work_edit"), "{listed_body}");

        let denied = post_mcp(&client, &endpoint, "synthetic-valid", json!({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"_meta":client_meta(),"name":"project_work_show","arguments":{"project_id":"project-b","work_id":"work-1"}}})).await;
        assert_eq!(denied.status(), StatusCode::OK);
        let denied_body = denied.text().await.unwrap();
        assert!(denied_body.contains("permission denied"), "{denied_body}");

        let allowed_binding = post_mcp(&client, &endpoint, "synthetic-valid", json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"_meta":client_meta(),"name":"project_work_show","arguments":{"project_id":"project-a","work_id":"work-1"}}})).await;
        assert_eq!(allowed_binding.status(), StatusCode::OK);
        let allowed_body = allowed_binding.text().await.unwrap();
        assert!(
            allowed_body.contains("configured Boreal local service is unavailable"),
            "{allowed_body}"
        );
        assert!(
            !allowed_body.contains("permission denied"),
            "{allowed_body}"
        );

        mcp_task.abort();
        provider_task.abort();
    }

    #[test]
    fn metadata_url_targets_the_required_protected_resource_document() {
        let mut metadata = http_config().resource_uri;
        metadata.set_path(OAUTH_RESOURCE_METADATA_MCP);
        metadata.set_query(None);
        assert_eq!(
            metadata.as_str(),
            "http://127.0.0.1:8765/.well-known/oauth-protected-resource/mcp"
        );
    }

    #[test]
    fn remote_bind_requires_tls_and_host_allowlist() {
        let mut http = http_config();
        http.bind = "0.0.0.0:8765".parse().unwrap();
        http.resource_uri = Url::parse("https://mcp.example.test/mcp").unwrap();
        http.introspection.endpoint = Url::parse("https://auth.example.test/introspect").unwrap();
        http.introspection.issuer = Url::parse("https://auth.example.test/").unwrap();
        http.authorization_servers = vec![Url::parse("https://auth.example.test/").unwrap()];
        http.allowed_hosts = vec!["mcp.example.test:8765".into()];
        assert!(config(http.clone())
            .validate()
            .unwrap_err()
            .to_string()
            .contains("TLS"));
        http.tls = Some(TlsConfig {
            certificate: PathBuf::from("/tmp/cert.pem"),
            private_key: PathBuf::from("/tmp/key.pem"),
        });
        assert!(config(http.clone()).validate().is_ok());
        http.allowed_hosts.clear();
        assert!(config(http)
            .validate()
            .unwrap_err()
            .to_string()
            .contains("Host allowlist"));
    }

    #[test]
    fn bearer_header_parser_rejects_malformed_values() {
        let mut headers = HeaderMap::new();
        assert!(bearer_token(&headers).is_none());
        headers.insert(
            header::AUTHORIZATION,
            HeaderValue::from_static("Basic dGVzdA=="),
        );
        assert!(bearer_token(&headers).is_none());
        headers.insert(
            header::AUTHORIZATION,
            HeaderValue::from_static("Bearer token-a"),
        );
        assert_eq!(bearer_token(&headers), Some("token-a"));
    }

    #[test]
    fn host_and_origin_are_checked_before_token_introspection() {
        let mut headers = HeaderMap::new();
        headers.insert(header::HOST, HeaderValue::from_static("attacker.example"));
        headers.insert(
            header::ORIGIN,
            HeaderValue::from_static("https://client.example.test"),
        );
        assert_eq!(
            validate_host_origin(&headers, &http_config()),
            Err(StatusCode::FORBIDDEN)
        );
        headers.insert(header::HOST, HeaderValue::from_static("127.0.0.1:8765"));
        headers.insert(
            header::ORIGIN,
            HeaderValue::from_static("https://evil.example"),
        );
        assert_eq!(
            validate_host_origin(&headers, &http_config()),
            Err(StatusCode::FORBIDDEN)
        );
        headers.remove(header::ORIGIN);
        assert!(validate_host_origin(&headers, &http_config()).is_ok());
    }

    #[test]
    fn loopback_default_host_allowlist_does_not_accept_arbitrary_hosts() {
        let mut http = http_config();
        http.allowed_hosts.clear();
        let mut headers = HeaderMap::new();
        headers.insert(header::HOST, HeaderValue::from_static("127.0.0.1:8765"));
        assert!(validate_host_origin(&headers, &http).is_ok());
        headers.insert(header::HOST, HeaderValue::from_static("attacker.example"));
        assert_eq!(
            validate_host_origin(&headers, &http),
            Err(StatusCode::FORBIDDEN)
        );
    }

    #[test]
    fn unknown_tool_error_keeps_operation_readback_and_recovery_guidance() {
        let mut protocol_error = boreal_protocol::ProtocolError::new(
            boreal_protocol::ErrorCode::UnknownOutcome,
            "the write committed but its final response was unavailable",
            true,
        );
        protocol_error.readback_required = Some(true);
        protocol_error.recovery = Some(boreal_protocol::RecoveryAction {
            action: "read_operation_status".into(),
            safe_argv: vec!["bwrk".into(), "operation".into(), "show".into()],
        });
        let result = tool_error(AdapterError::UnknownOutcome {
            operation_id: "op_uncertain_write".into(),
            readback: Some(json!({"operation": {"state": "committed"}})),
            protocol_error: Some(protocol_error),
        });

        assert_eq!(result.is_error, Some(true));
        let ContentBlock::Text(content) = &result.content[0] else {
            panic!("error content is not text");
        };
        let data: Value = serde_json::from_str(&content.text).unwrap();
        assert_eq!(data["error"], "unknown_outcome");
        assert_eq!(data["outcome"], "unknown");
        assert_eq!(data["operation_id"], "op_uncertain_write");
        assert_eq!(data["recovery_tool"], "operation_status");
        assert_eq!(data["readback"]["operation"]["state"], "committed");
        assert_eq!(data["readback_required"], true);
        assert_eq!(data["recovery"]["action"], "read_operation_status");
    }

    #[test]
    fn oversized_unknown_readback_is_bounded_without_losing_recovery_identity() {
        let result = tool_error(AdapterError::UnknownOutcome {
            operation_id: "op_large_uncertain_write".into(),
            readback: Some(json!({"body": "x".repeat(MAX_TOOL_OUTPUT_BYTES)})),
            protocol_error: None,
        });
        let ContentBlock::Text(content) = &result.content[0] else {
            panic!("error content is not text");
        };
        assert!(content.text.len() <= MAX_TOOL_OUTPUT_BYTES);
        let data: Value = serde_json::from_str(&content.text).unwrap();
        assert_eq!(data["error"], "unknown_outcome");
        assert_eq!(data["outcome"], "unknown");
        assert_eq!(data["operation_id"], "op_large_uncertain_write");
        assert_eq!(data["recovery_tool"], "operation_status");
        assert_eq!(data["readback_omitted"], true);
    }
}
