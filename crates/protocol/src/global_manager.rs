//! Versioned request vocabulary for the installation-wide manager service.

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const REQUEST_SCHEMA: &str = "boreal.global.request.v1";
pub const SNAPSHOT_SCHEMA_VERSION: u32 = 2;
pub const DETAIL_PAGE_COMMAND: &str = "detail page";
pub const ATTENTION_PAGE_COMMAND: &str = "attention page";
pub const LINKED_PAGE_COMMAND: &str = "linked page";
pub const LINKED_JOB_SHOW_COMMAND: &str = "linked job show";

/// Application-resolved system time context shared by Global clients. This is
/// refreshed with each snapshot/read and is never persisted as policy.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GlobalCivilTimeContext {
    pub observed_at_unix_ms: u64,
    pub timezone: String,
    pub system_civil_date: String,
    pub tzdb_identity: String,
}

/// Deterministic page request for full-state global collections. Search is
/// evaluated before pagination against the complete collection at one revision.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GlobalDetailPageRequest {
    pub collection: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub query: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(default)]
    pub include_archived: bool,
    #[serde(default)]
    pub limit: Option<u32>,
    #[serde(default)]
    pub offset: Option<u64>,
    /// Revision returned by the preceding page. A mismatch requires a fresh
    /// snapshot before continuing an offset cursor.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_revision: Option<u64>,
}

/// Deterministic, revision-bound page request for per-project attention.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GlobalAttentionPageRequest {
    #[serde(default)]
    pub limit: Option<u32>,
    #[serde(default)]
    pub offset: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_revision: Option<u64>,
}

/// One project's bounded summary in a complete attention page.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GlobalProjectAttention {
    pub project_id: String,
    pub attention: Value,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub collection: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub civil_time: Option<GlobalCivilTimeContext>,
    /// True when the caller's expected revision no longer matches the
    /// current snapshot; discard the cursor and resnapshot.
    #[serde(default)]
    pub resnapshot_required: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requested_revision: Option<u64>,
}

pub type GlobalAttentionPageResponse = GlobalPage<GlobalProjectAttention>;
pub type GlobalDetailPageResponse = GlobalPage<Value>;

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
        } else if self.command == DETAIL_PAGE_COMMAND {
            let request: GlobalDetailPageRequest = serde_json::from_value(self.payload.clone())
                .map_err(|error| format!("invalid detail page request: {error}"))?;
            const COLLECTIONS: &[&str] = &[
                "projects",
                "items",
                "notes",
                "statuses",
                "relationships",
                "note_links",
                "associations",
                "status_history",
                "imported_history",
            ];
            if !COLLECTIONS.contains(&request.collection.as_str()) {
                return Err("unsupported detail collection".into());
            }
            if request
                .project_id
                .as_deref()
                .is_some_and(|value| value.trim().is_empty())
            {
                return Err("detail page project_id must not be empty".into());
            }
            if request
                .limit
                .is_some_and(|limit| !(1..=200).contains(&limit))
            {
                return Err("detail page limit must be from 1 to 200".into());
            }
            if request.offset.unwrap_or(0) > 0 && request.expected_revision.is_none() {
                return Err(
                    "detail page continuation requires expected_revision; resnapshot before continuing"
                        .into(),
                );
            }
        } else if self.command == ATTENTION_PAGE_COMMAND {
            let request: GlobalAttentionPageRequest = serde_json::from_value(self.payload.clone())
                .map_err(|error| format!("invalid attention page request: {error}"))?;
            if request
                .limit
                .is_some_and(|limit| !(1..=200).contains(&limit))
            {
                return Err("attention page limit must be from 1 to 200".into());
            }
            if request.offset.unwrap_or(0) > 0 && request.expected_revision.is_none() {
                return Err(
                    "attention page continuation requires expected_revision; resnapshot before continuing"
                        .into(),
                );
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

    #[test]
    fn absent_global_detail_page_filters_are_omitted_from_the_wire_payload() {
        let payload = serde_json::to_value(GlobalDetailPageRequest {
            collection: "items".into(),
            project_id: None,
            query: None,
            kind: None,
            include_archived: false,
            limit: Some(20),
            offset: Some(0),
            expected_revision: Some(12),
        })
        .expect("global detail page request serializes");

        assert_eq!(payload["collection"], "items");
        assert!(payload.get("project_id").is_none());
        assert!(payload.get("query").is_none());
        assert!(payload.get("kind").is_none());
        assert!(request(DETAIL_PAGE_COMMAND, payload).validate().is_ok());
    }

    #[test]
    fn attention_pages_are_versioned_and_bounded() {
        assert!(request(
            ATTENTION_PAGE_COMMAND,
            json!({"limit":200,"offset":400,"expected_revision":12})
        )
        .validate()
        .is_ok());
        assert!(request(ATTENTION_PAGE_COMMAND, json!({"limit":201}))
            .validate()
            .is_err());
        assert!(
            request(ATTENTION_PAGE_COMMAND, json!({"expected_revision":-1}))
                .validate()
                .is_err()
        );
        assert!(request(ATTENTION_PAGE_COMMAND, json!({"offset":1}))
            .validate()
            .is_err());
        assert!(request(
            DETAIL_PAGE_COMMAND,
            json!({"collection":"projects","offset":1})
        )
        .validate()
        .is_err());
    }

    #[test]
    fn paged_read_responses_decode_the_exact_revision_and_civil_time() {
        let payload = json!({
            "rows": [{"project_id":"project-1","attention":{"open":2}}],
            "total": 1,
            "limit": 50,
            "offset": 0,
            "has_more": false,
            "next_offset": null,
            "revision": 12,
            "resnapshot_required": false,
            "requested_revision": 12,
            "civil_time": {
                "observed_at_unix_ms": 1000,
                "timezone": "Etc/UTC",
                "system_civil_date": "1970-01-01",
                "tzdb_identity": "test-tzdb"
            }
        });
        let response: GlobalAttentionPageResponse = serde_json::from_value(payload)
            .expect("attention page matches the versioned response contract");
        assert_eq!(response.revision, 12);
        assert_eq!(response.requested_revision, Some(12));
        assert_eq!(response.rows[0].project_id, "project-1");
        assert_eq!(
            response
                .civil_time
                .as_ref()
                .map(|context| context.system_civil_date.as_str()),
            Some("1970-01-01")
        );

        let detail_payload = json!({
            "collection": "projects",
            "rows": [{"id":"project-1"}],
            "total": 1,
            "limit": 50,
            "offset": 0,
            "has_more": false,
            "next_offset": null,
            "revision": 12,
            "resnapshot_required": false,
            "requested_revision": null,
            "civil_time": {
                "observed_at_unix_ms": 1000,
                "timezone": "Etc/UTC",
                "system_civil_date": "1970-01-01",
                "tzdb_identity": "test-tzdb"
            }
        });
        let detail: GlobalDetailPageResponse = serde_json::from_value(detail_payload)
            .expect("detail page matches the versioned response contract");
        assert_eq!(detail.collection.as_deref(), Some("projects"));
        assert_eq!(detail.revision, 12);
    }
}
