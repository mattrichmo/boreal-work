//! Versioned request vocabulary for the installation-wide manager service.

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const REQUEST_SCHEMA: &str = "boreal.global.request.v1";
pub const SNAPSHOT_SCHEMA_VERSION: u32 = 2;
pub const DETAIL_PAGE_COMMAND: &str = "detail page";
pub const LINKED_PAGE_COMMAND: &str = "linked page";
pub const LINKED_JOB_SHOW_COMMAND: &str = "linked job show";

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

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GlobalLinkedPageRequest {
    pub project_id: String,
    pub identity: String,
    #[serde(default)]
    pub limit: Option<u32>,
    #[serde(default)]
    pub offset: Option<u64>,
}

/// `refreshing` responses carry a job id; completed responses carry a page.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GlobalLinkedPageResponse {
    pub management_project_id: String,
    pub project_id: String,
    pub path: Option<String>,
    pub availability: String,
    #[serde(default)]
    pub job_id: Option<String>,
    #[serde(default)]
    pub revision: Option<u64>,
    #[serde(default)]
    pub as_of: Option<String>,
    #[serde(default)]
    pub counts: Option<Value>,
    #[serde(default)]
    pub items: Vec<Value>,
    #[serde(default)]
    pub items_total: Option<u64>,
    #[serde(default)]
    pub total: Option<u64>,
    #[serde(default)]
    pub items_has_more: Option<bool>,
    #[serde(default)]
    pub items_limit: Option<u64>,
    #[serde(default)]
    pub items_offset: Option<u64>,
    pub limit: u32,
    pub offset: u64,
    pub has_more: Option<bool>,
    #[serde(default)]
    pub next_offset: Option<u64>,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GlobalTriageChange {
    pub item_id: String,
    pub project_id: Option<String>,
    pub parent_id: Option<String>,
    pub status_id: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GlobalTriageRequest {
    pub changes: Vec<GlobalTriageChange>,
    #[serde(default)]
    pub expected_revision: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GlobalNoteLinkRequest {
    pub note_id: String,
    pub item_id: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GlobalLinkedJobShowRequest {
    pub job_id: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GlobalLinkedJobState {
    Refreshing,
    Complete,
    Failed,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GlobalLinkedJobShowResponse {
    pub job_id: String,
    pub state: GlobalLinkedJobState,
    #[serde(default)]
    pub page: Option<GlobalLinkedPageResponse>,
    #[serde(default)]
    pub error: Option<String>,
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

impl GlobalManagerRequest {
    /// Validates payloads whose shape belongs to the versioned service contract.
    pub fn validate(&self) -> Result<(), String> {
        if self.api_version.trim().is_empty()
            || self.operation_id.trim().is_empty()
            || self.command.trim().is_empty()
        {
            return Err("api_version, operation_id, and command are required".into());
        }
        if self.command == LINKED_PAGE_COMMAND {
            let request: GlobalLinkedPageRequest = serde_json::from_value(self.payload.clone())
                .map_err(|error| format!("invalid linked page request: {error}"))?;
            if request.project_id.trim().is_empty() || request.identity.trim().is_empty() {
                return Err("linked page requires project_id and identity".into());
            }
            if request
                .limit
                .is_some_and(|limit| !(1..=50).contains(&limit))
            {
                return Err("linked page limit must be from 1 to 50".into());
            }
        } else if self.command == LINKED_JOB_SHOW_COMMAND {
            let request: GlobalLinkedJobShowRequest = serde_json::from_value(self.payload.clone())
                .map_err(|error| format!("invalid linked job request: {error}"))?;
            if request.job_id.trim().is_empty() {
                return Err("linked job show requires job_id".into());
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn request(command: &str, payload: Value) -> GlobalManagerRequest {
        GlobalManagerRequest {
            api_version: "2".into(),
            schema_version: REQUEST_SCHEMA.into(),
            operation_id: "op_test".into(),
            command: command.into(),
            payload,
        }
    }

    #[test]
    fn linked_page_and_poll_payloads_are_versioned_and_bounded() {
        assert!(request(
            LINKED_PAGE_COMMAND,
            json!({"project_id":"p","identity":"workspace","limit":50,"offset":100})
        )
        .validate()
        .is_ok());
        assert!(request(
            LINKED_PAGE_COMMAND,
            json!({"project_id":"p","identity":"workspace","limit":51})
        )
        .validate()
        .is_err());
        assert!(
            request(LINKED_JOB_SHOW_COMMAND, json!({"job_id":"linked-job-1"}))
                .validate()
                .is_ok()
        );
        assert!(request(LINKED_JOB_SHOW_COMMAND, json!({"job_id":" "}))
            .validate()
            .is_err());
    }
}
