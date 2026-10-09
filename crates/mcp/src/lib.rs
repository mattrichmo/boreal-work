//! MCP adapter over Boreal's existing versioned Unix-socket services.
//!
//! The adapter owns transport, authentication, scope filtering, and bounded
//! input/output only. It never opens Boreal databases or implements work
//! lifecycle transitions.

mod auth;
mod backend;
mod config;
mod server;

pub use auth::{AuthError, AuthenticatedPrincipal, OAuthIntrospector};
pub use backend::{AdapterError, BorealBackend};
pub use config::{
    ConfigError, GlobalEndpoint, HttpConfig, IntrospectionConfig, McpConfig, Policy,
    ProjectEndpoint, TlsConfig,
};
pub use server::{build_http_router, run_stdio, serve_http, BorealMcpServer};

pub const MCP_PROTOCOL_VERSION: &str = "2026-07-28";
pub const MCP_SDK_VERSION: &str = "3.5.1";
pub const MAX_TOOL_INPUT_BYTES: usize = 16 * 1024;
pub const MAX_TOOL_OUTPUT_BYTES: usize = 64 * 1024;
pub const MAX_SERVICE_FRAME_BYTES: usize = 128 * 1024;
pub const MAX_HTTP_BODY_BYTES: usize = 64 * 1024;
