//! Versioned request vocabulary for the installation-wide manager service.

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const REQUEST_SCHEMA: &str = "boreal.global.request.v1";
pub const SNAPSHOT_SCHEMA_VERSION: u32 = 2;
pub const DETAIL_PAGE_COMMAND: &str = "detail page";
pub const LINKED_PAGE_COMMAND: &str = "linked page";

/// Deterministic page request for full-state global collections. Search is
/// evaluated before pagination against the complete collection at one revision.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GlobalDetailPageRequest {
    pub collection: String,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub query: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub include_archived: bool,
    #[serde(default)]
    pub limit: Option<u32>,
    #[serde(default)]
    pub offset: Option<u64>,
}

/// Common page envelope; collection specific rows remain versioned DTO values.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GlobalPage<T> {
    pub rows: Vec<T>,
    pub total: u64,
    pub limit: u32,
    pub offset: u64,
    pub has_more: bool,
    pub next_offset: Option<u64>,
    pub revision: u64,
}

/// Inner payload carried by the standard length-prefixed Unix request frame.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GlobalManagerRequest {
    pub api_version: String,
    pub schema_version: String,
    pub operation_id: String,
    pub command: String,
    #[serde(default)]
    pub payload: Value,
}
