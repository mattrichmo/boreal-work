//! Versioned request vocabulary for the installation-wide manager service.

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const REQUEST_SCHEMA: &str = "boreal.global.request.v1";
pub const SNAPSHOT_SCHEMA_VERSION: u32 = 2;

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
