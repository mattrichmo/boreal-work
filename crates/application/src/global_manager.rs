//! Application boundary for the installation-wide global manager.

use boreal_domain::global_manager::{ManagementItemKind, StatusCategory};
use boreal_store::global_manager::{
    GlobalBackupPackageReport, GlobalDatabaseInspection, GlobalManagerStore, GlobalRestoreReport,
};
use boreal_store::StoreError;
use serde_json::{json, Value};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

static GLOBAL_ID_COUNTER: AtomicU64 = AtomicU64::new(1);
const GLOBAL_PATH_MAX_BYTES: usize = 4096;
const INTERACTIVE_RESPONSE_MAX_BYTES: usize = 900 * 1024;

#[derive(Debug)]
pub enum GlobalManagerError {
    Store(StoreError),
    Invalid(String),
    NotFound(String),
    Conflict(String),
    Busy(String),
}
impl std::fmt::Display for GlobalManagerError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Store(e) => e.fmt(f),
            Self::Invalid(e) | Self::NotFound(e) | Self::Conflict(e) | Self::Busy(e) => {
                f.write_str(e)
            }
        }
    }
}
impl std::error::Error for GlobalManagerError {}
impl From<StoreError> for GlobalManagerError {
    fn from(e: StoreError) -> Self {
        match e {
            StoreError::Busy(s) => Self::Busy(s),
            StoreError::Conflict(s) => Self::Conflict(s),
            StoreError::StaleRevision { expected, actual } => Self::Conflict(format!(
                "stale revision: expected {expected}, actual {actual}"
            )),
            StoreError::NotFound { .. } => Self::NotFound(e.to_string()),
            StoreError::Invalid(s) => {
                if s.contains("not found") {
                    Self::NotFound(s)
                } else if s.contains("revision conflict") {
                    Self::Conflict(s)
                } else {
                    Self::Invalid(s)
                }
            }
            other => Self::Store(other),
        }
    }
}

/// Global application use cases. Every write is committed by one store
/// operation carrying its revision, audit row and durable replay receipt.
pub struct GlobalManagerApplication {
    store: GlobalManagerStore,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResolvedWorkspaceIdentity {
    pub project_id: String,
    pub path: String,
}

impl GlobalManagerApplication {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, GlobalManagerError> {
        Ok(Self {
            store: GlobalManagerStore::open(path)?,
        })
    }
    pub fn revision(&self) -> Result<u64, GlobalManagerError> {
        Ok(self.store.revision()?)
    }

    /// Create a validated physical Global SQLite backup. The result contains
    /// bounded artifact metadata; database bytes remain on the local filesystem.
    pub fn backup_package_to(
        &self,
        destination: impl AsRef<Path>,
    ) -> Result<GlobalBackupPackageReport, GlobalManagerError> {
        Ok(self.store.backup_package_to(destination)?)
    }

    /// Back up an existing Global database without opening it through a
    /// first-open schema migration. Installers use this entry point before
    /// publishing a package that may migrate the invoking user's database.
    pub fn backup_database_package_to(
        database_path: impl AsRef<Path>,
        destination: impl AsRef<Path>,
    ) -> Result<GlobalBackupPackageReport, GlobalManagerError> {
        Ok(GlobalManagerStore::backup_database_package_to(
            database_path,
            destination,
        )?)
    }

    pub fn inspect_database(
        database_path: impl AsRef<Path>,
    ) -> Result<GlobalDatabaseInspection, GlobalManagerError> {
        Ok(GlobalManagerStore::inspect_database(database_path)?)
    }

    pub fn inspect_backup_package(
        package_path: impl AsRef<Path>,
    ) -> Result<GlobalBackupPackageReport, GlobalManagerError> {
        Ok(GlobalManagerStore::inspect_backup_package(package_path)?)
    }

    /// Restore a physical Global backup through the store's exclusive
    /// maintenance boundary and retained-previous-database path.
    pub fn restore_backup(
        database_path: impl AsRef<Path>,
        package_path: impl AsRef<Path>,
        operation_id: &str,
    ) -> Result<GlobalRestoreReport, GlobalManagerError> {
        Ok(GlobalManagerStore::restore_package_to(
            database_path,
            package_path,
            operation_id,
        )?)
    }

    /// Executes one logical global operation. The caller supplies a stable
    /// idempotency key and payloads use snake_case fields.
    pub fn execute(
        &self,
        command: &str,
        payload: &Value,
        operation: &str,
    ) -> Result<Value, GlobalManagerError> {
        if command == "project link" {
            return Err(GlobalManagerError::Invalid(
                "project link requires validation through the versioned project service".into(),
            ));
        }
        self.execute_resolved(command, payload, operation)
    }

    /// Validates a linked workspace through a caller-provided versioned
    /// project-service resolver. The client cannot supply its own durable
    /// identity; only the resolver result is persisted.
    pub fn execute_with_workspace_resolver<F>(
        &self,
        command: &str,
        payload: &Value,
        operation: &str,
        resolver: F,
    ) -> Result<Value, GlobalManagerError>
    where
        F: FnOnce(&str) -> Result<ResolvedWorkspaceIdentity, String>,
    {
        if command != "project link" {
            return self.execute(command, payload, operation);
        }
        let path = string(payload, "path")?;
        let resolved = resolver(path).map_err(GlobalManagerError::Invalid)?;
        let mut trusted = payload.clone();
        trusted["identity"] = json!(resolved.project_id);
        trusted["path"] = json!(resolved.path);
        self.execute_resolved(command, &trusted, operation)
    }

    fn execute_resolved(
        &self,
        command: &str,
        payload: &Value,
        operation: &str,
    ) -> Result<Value, GlobalManagerError> {
        if is_mutation(command) {
            boreal_domain::global_manager::validate_identifier(operation)
                .map_err(|error| GlobalManagerError::Invalid(error.to_string()))?;
        }
        let mut prepared = payload.clone();
        if command == "import" {
            let has_expected_revision = prepared
                .get("expected_revision")
                .and_then(Value::as_u64)
                .is_some();
            // Empty-manager imports historically default to revision zero. Do
            // this before readback so retries hash exactly the committed request.
            if prepared
                .get("expected_revision")
                .and_then(Value::as_u64)
                .is_none()
            {
                prepared["expected_revision"] = json!(0);
            }
            if let Some(result) = self.store.replay_result(command, &prepared, operation)? {
                return Ok(result);
            }
            let state = self.store.state()?;
            let nonempty = ["projects", "items", "notes"]
                .iter()
                .any(|key| state[*key].as_array().is_some_and(|rows| !rows.is_empty()));
            if nonempty && prepared.get("replace").and_then(Value::as_bool) != Some(true) {
                return Err(GlobalManagerError::Invalid(
                    "import into a non-empty manager requires replace:true".into(),
                ));
            }
            if nonempty && !has_expected_revision {
                return Err(GlobalManagerError::Invalid(
                    "replacement import requires expected_revision".into(),
                ));
            }
        }
        self.validate(command, &prepared)?;
        if is_mutation(command) {
            let result =
                self.store
                    .mutate(command, &prepared, operation, |mut state, revision| {
                        let value = apply_mutation(command, &prepared, &mut state, revision)?;
                        Ok((state, value))
                    })?;
            Ok(result)
        } else {
            self.read(command, payload)
        }
    }

    fn read(&self, command: &str, payload: &Value) -> Result<Value, GlobalManagerError> {
        if command == "operation show" {
            return self
                .store
                .operation_result(required_string(payload, "operation_id")?)?
                .ok_or_else(|| GlobalManagerError::NotFound("global operation not found".into()));
        }
        if command == "history" {
            let limit = payload.get("limit").and_then(Value::as_u64).unwrap_or(50);
            let offset = payload.get("offset").and_then(Value::as_u64).unwrap_or(0);
            let project_id = payload.get("project_id").and_then(Value::as_str);
            let entity_id = payload.get("entity_id").and_then(Value::as_str);
            let (records, total, current_revision) = self
                .store
                .activity_snapshot(project_id, entity_id, limit, offset)?;
            let events = records
                .into_iter()
                .map(|record| {
                    let result = &record.result;
                    let entity_kind = record.command.split_whitespace().next().map(str::to_owned);
                    let entity_id = ["id", "item_id", "note_id", "source_id"]
                        .iter()
                        .find_map(|key| result.get(*key).and_then(Value::as_str))
                        .map(str::to_owned);
                    let title = ["name", "title", "label"]
                        .iter()
                        .find_map(|key| result.get(*key).and_then(Value::as_str))
                        .map(str::to_owned);
                    let subject = title
                        .as_deref()
                        .or(entity_id.as_deref())
                        .unwrap_or("record")
                        .to_owned();
                    let verb = match record.command.as_str() {
                        "project add" | "todo add" | "task add" | "subtask add" | "milestone add" | "note add" | "workflow status add" | "relationship add" => "Created",
                        "project archive" | "todo archive" | "task archive" | "milestone archive" | "note archive" => "Archived",
                        "project unarchive" | "todo unarchive" | "task unarchive" | "milestone unarchive" | "unarchive" | "note unarchive" => "Restored",
                        "todo complete" => "Completed",
                        "todo reopen" => "Reopened",
                        "todo move" => "Moved",
                        "todo reorder" => "Reordered",
                        "project link" | "project attach-folder" => "Linked",
                        "project unlink" | "relationship remove" => "Removed",
                        _ => "Updated",
                    };
                    let event = boreal_domain::global_manager::GlobalActivityEvent {
                        operation_id: record.operation_id,
                        revision: record.revision,
                        command: record.command,
                        entity_kind,
                        entity_id,
                        project_id: result.get("project_id").and_then(Value::as_str).map(str::to_owned),
                        source_id: result.get("source_id").and_then(Value::as_str).map(str::to_owned),
                        target_id: result.get("target_id").and_then(Value::as_str).map(str::to_owned),
                        title: title.map(|value| bound_text(&value,512)),
                        summary: bound_text(&format!("{verb} {subject}"),512),
                        created_at: record.created_at,
                    };
                    json!({"operation_id":event.operation_id,"revision":event.revision,"command":event.command,"entity_kind":event.entity_kind,"entity_id":event.entity_id,"project_id":event.project_id,"source_id":event.source_id,"target_id":event.target_id,"title":event.title,"summary":event.summary,"created_at":event.created_at})
                })
                .collect::<Vec<_>>();
            let next_offset = offset.saturating_add(events.len() as u64);
            return Ok(
                json!({"events":events,"current_revision":current_revision,"total":total,"limit":limit,"offset":offset,"has_more":next_offset < total,"next_offset":if next_offset < total {json!(next_offset)} else {Value::Null}}),
            );
        }
        if command == "detail page" {
            if !payload
                .get("collection")
                .and_then(Value::as_str)
                .is_some_and(|name| {
                    [
                        "projects",
                        "items",
                        "notes",
                        "statuses",
                        "relationships",
                        "note_links",
                        "associations",
                        "status_history",
                        "imported_history",
                    ]
                    .contains(&name)
                })
            {
                return Err(GlobalManagerError::Invalid(
                    "unsupported detail collection".into(),
                ));
            }
            if payload
                .get("limit")
                .is_some_and(|v| v.as_u64().is_none_or(|n| !(1..=200).contains(&n)))
            {
                return Err(GlobalManagerError::Invalid(
                    "detail page limit must be from 1 to 200".into(),
                ));
            }
            if payload.get("offset").is_some_and(|v| v.as_u64().is_none()) {
                return Err(GlobalManagerError::Invalid(
                    "detail page offset must be a non-negative integer".into(),
                ));
            }
            if payload.get("query").is_some_and(|v| !v.is_string()) {
                return Err(GlobalManagerError::Invalid(
                    "detail page query must be a string".into(),
                ));
            }
        }
        if command == "export" {
            let (mut state, revision, history) = self.store.export_bundle()?;
            state["schema_version"] = json!(2);
            state["revision"] = json!(revision);
            state["revision_history"] = json!(history);
            return Ok(state);
        }
        let (mut state, revision) = if matches!(command, "snapshot" | "detail page") {
            self.store.snapshot()?
        } else {
            (self.store.state()?, self.store.revision()?)
        };
        match command {
            "snapshot" => {
                state["schema_version"] = serde_json::json!(2);
                state["revision"] = serde_json::json!(revision);
                let attention = attention_summary(&state);
                let mut totals = serde_json::Map::new();
                let archived_projects = state
                    .get("projects")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter(|row| row.get("archived").and_then(Value::as_bool) == Some(true))
                    .filter_map(|row| row.get("id").and_then(Value::as_str).map(str::to_owned))
                    .collect::<std::collections::BTreeSet<_>>();
                for key in [
                    "projects",
                    "items",
                    "notes",
                    "statuses",
                    "relationships",
                    "note_links",
                    "associations",
                    "status_history",
                    "imported_history",
                ] {
                    let rows = state.get(key).and_then(Value::as_array).map_or(0, Vec::len);
                    totals.insert(key.to_owned(), json!(rows));
                    if let Some(all) = state.get_mut(key).and_then(Value::as_array_mut) {
                        if matches!(key, "items" | "notes") {
                            all.retain(|row| {
                                row.get("project_id")
                                    .and_then(Value::as_str)
                                    .is_none_or(|owner| !archived_projects.contains(owner))
                            });
                        }
                        all.truncate(100);
                    }
                }
                if let Some(notes) = state.get_mut("notes").and_then(Value::as_array_mut) {
                    for note in notes {
                        if let Some(object) = note.as_object_mut() {
                            object.remove("body");
                        }
                    }
                }
                if let Some(items) = state.get_mut("items").and_then(Value::as_array_mut) {
                    for item in items {
                        if let Some(object) = item.as_object_mut() {
                            object.remove("description");
                        }
                    }
                }
                bound_summary_text(&mut state, 512);
                state.as_object_mut().unwrap().remove("imported_history");
                state["totals"] = Value::Object(totals);
                state["snapshot_limit"] = json!(100);
                state["attention"] = attention;
                state["activity"] = self.read("history", &json!({"limit":50,"offset":0}))?;
                let mut payload_truncated = false;
                while serde_json::to_vec(&state)
                    .map(|bytes| bytes.len() > INTERACTIVE_RESPONSE_MAX_BYTES)
                    .unwrap_or(true)
                {
                    let mut reduced = false;
                    for key in [
                        "projects",
                        "items",
                        "notes",
                        "statuses",
                        "relationships",
                        "note_links",
                        "associations",
                        "status_history",
                    ] {
                        if let Some(rows) = state.get_mut(key).and_then(Value::as_array_mut) {
                            if !rows.is_empty() {
                                rows.truncate(rows.len() / 2);
                                reduced = true;
                            }
                        }
                    }
                    if let Some(events) = state
                        .pointer_mut("/activity/events")
                        .and_then(Value::as_array_mut)
                    {
                        if !events.is_empty() {
                            events.truncate(events.len() / 2);
                            reduced = true;
                        }
                    }
                    payload_truncated = true;
                    if !reduced {
                        return Err(GlobalManagerError::Invalid(
                            "global summary exceeds the interactive response size limit".into(),
                        ));
                    }
                }
                if payload_truncated {
                    state["payload_truncated"] = json!(true);
                }
                Ok(state)
            }
            "detail page" => {
                let collection = required_string(payload, "collection")?;
                if ![
                    "projects",
                    "items",
                    "notes",
                    "statuses",
                    "relationships",
                    "note_links",
                    "associations",
                    "status_history",
                    "imported_history",
                ]
                .contains(&collection)
                {
                    return Err(GlobalManagerError::Invalid(
                        "unsupported detail collection".into(),
                    ));
                }
                let limit = payload
                    .get("limit")
                    .and_then(Value::as_u64)
                    .unwrap_or(50)
                    .clamp(1, 200) as usize;
                let offset = payload.get("offset").and_then(Value::as_u64).unwrap_or(0) as usize;
                let project_id = payload.get("project_id").and_then(Value::as_str);
                let kind = payload.get("kind").and_then(Value::as_str);
                let query = payload
                    .get("query")
                    .and_then(Value::as_str)
                    .map(str::to_lowercase);
                let include_archived = payload
                    .get("include_archived")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                let source = state
                    .get(collection)
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
                let archived_projects = state
                    .get("projects")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter(|row| row.get("archived").and_then(Value::as_bool) == Some(true))
                    .filter_map(|row| row.get("id").and_then(Value::as_str).map(str::to_owned))
                    .collect::<std::collections::BTreeSet<_>>();
                let item_projects = state
                    .get("items")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(|item| {
                        Some((
                            item.get("id")?.as_str()?.to_owned(),
                            item.get("project_id")
                                .and_then(Value::as_str)
                                .map(str::to_owned),
                        ))
                    })
                    .collect::<std::collections::BTreeMap<_, _>>();
                let note_projects = arr(&state, "notes")
                    .iter()
                    .filter_map(|note| {
                        Some((
                            note.get("id")?.as_str()?.to_owned(),
                            note.get("project_id")
                                .and_then(Value::as_str)
                                .map(str::to_owned),
                        ))
                    })
                    .collect::<std::collections::BTreeMap<_, _>>();
                let rows = source
                    .into_iter()
                    .filter(|row| {
                        let owner = if collection == "projects" {
                            row.get("id").and_then(Value::as_str)
                        } else {
                            row.get("project_id").and_then(Value::as_str).or_else(|| {
                                row.get("management_project_id").and_then(Value::as_str)
                            })
                        }
                        .map(str::to_owned)
                        .or_else(|| {
                            let item_id = if matches!(collection, "status_history" | "note_links") {
                                row.get("item_id").and_then(Value::as_str)
                            } else if collection == "relationships" {
                                row.get("source_id").and_then(Value::as_str)
                            } else {
                                None
                            };
                            if collection == "note_links" {
                                row.get("note_id")
                                    .and_then(Value::as_str)
                                    .and_then(|id| note_projects.get(id).cloned().flatten())
                            } else {
                                item_id.and_then(|id| item_projects.get(id).cloned().flatten())
                            }
                        });
                        let scoped_match = if collection == "status_history" {
                            project_id.is_none_or(|requested| {
                                ["from_workflow_owner_id", "workflow_owner_id"]
                                    .iter()
                                    .filter_map(|field| row.get(*field).and_then(Value::as_str))
                                    .any(|owner| owner == requested)
                                    || owner.as_deref() == Some(requested)
                            })
                        } else {
                            project_id.is_none() || owner.as_deref() == project_id
                        };
                        scoped_match
                            && (kind.is_none() || row.get("kind").and_then(Value::as_str) == kind)
                            && query.as_ref().is_none_or(|q| {
                                detail_row_matches_query(&state, collection, row, q)
                            })
                            && (include_archived
                                || row.get("archived").and_then(Value::as_bool) != Some(true))
                            && (include_archived
                                || !owner
                                    .as_deref()
                                    .is_some_and(|owner| archived_projects.contains(owner)))
                    })
                    .collect::<Vec<_>>();
                let total = rows.len();
                let mut page = rows
                    .into_iter()
                    .skip(offset)
                    .take(limit)
                    .map(|mut row| {
                        if let Some(object) = row.as_object_mut() {
                            match collection {
                                "notes" => {
                                    object.remove("body");
                                }
                                "items" => {
                                    object.remove("description");
                                }
                                "projects" => {
                                    object.remove("description");
                                }
                                // Prior imported database images are available to restore/export
                                // flows but can be portfolio-sized. Keep their revision metadata
                                // browsable without putting nested full states in an interactive page.
                                "imported_history" => {
                                    object.remove("snapshot");
                                }
                                _ => {}
                            }
                        }
                        row
                    })
                    .collect::<Vec<_>>();
                let mut page_value = Value::Array(std::mem::take(&mut page));
                bound_summary_text(&mut page_value, 512);
                let mut page = page_value.as_array().cloned().unwrap_or_default();
                while page.len() > 1
                    && serde_json::to_vec(&json!({"collection":collection,"rows":&page,"total":total,"limit":limit,"offset":offset,"revision":revision}))
                        .map(|bytes| bytes.len() > INTERACTIVE_RESPONSE_MAX_BYTES)
                        .unwrap_or(true)
                {
                    page.truncate((page.len() / 2).max(1));
                }
                if serde_json::to_vec(&json!({"collection":collection,"rows":&page,"total":total,"limit":limit,"offset":offset,"revision":revision}))
                    .map(|bytes| bytes.len() > INTERACTIVE_RESPONSE_MAX_BYTES)
                    .unwrap_or(true)
                {
                    return Err(GlobalManagerError::Invalid(
                        "a detail record exceeds the interactive response size limit".into(),
                    ));
                }
                let next = offset.saturating_add(page.len());
                Ok(
                    json!({"collection":collection,"rows":page,"total":total,"limit":limit,"offset":offset,"has_more":next < total,"next_offset":if next < total {json!(next)} else {Value::Null},"revision":revision}),
                )
            }
            "project list" => Ok(filter_project_list(&state["projects"], payload)),
            "project show" => Ok(one_from(
                &state,
                "projects",
                "id",
                required_string(payload, "project_id")?,
            )?),
            "todo list" | "task list" | "milestone list" => {
                Ok(filter_item_list(&state["items"], payload, command))
            }
            "todo show" | "task show" | "milestone show" => {
                let mut item =
                    one_from(&state, "items", "id", required_string(payload, "item_id")?)?;
                let item_id = item["id"].as_str().unwrap_or_default();
                let links = arr(&state, "note_links")
                    .iter()
                    .filter(|link| link["item_id"] == item_id)
                    .filter_map(|link| {
                        let note_id = link["note_id"].as_str()?;
                        arr(&state, "notes")
                            .iter()
                            .find(|note| note["id"] == note_id)
                            .map(compact_note_link)
                    })
                    .collect::<Vec<_>>();
                item["linked_notes"] = json!(links);
                Ok(item)
            }
            "workflow status list" => Ok(filtered_statuses(&state["statuses"], payload)),
            "relationship list" => Ok(filter_project_list(&state["relationships"], payload)),
            "association show" => {
                let project_id = required_string(payload, "project_id")?;
                let kind = required_string(payload, "kind")?;
                let identity = required_string(payload, "identity")?;
                arr(&state, "associations")
                    .iter()
                    .find(|row| {
                        row["project_id"] == project_id
                            && row["kind"] == kind
                            && row["identity"] == identity
                    })
                    .cloned()
                    .ok_or_else(|| {
                        GlobalManagerError::NotFound("project association not found".into())
                    })
            }
            "note link list" => Ok(filter_project_list(&state["note_links"], payload)),
            "note list" => Ok(filter_project_list(&state["notes"], payload)),
            "note show" => {
                let mut note =
                    one_from(&state, "notes", "id", required_string(payload, "note_id")?)?;
                let note_id = note["id"].as_str().unwrap_or_default();
                let links = arr(&state, "note_links")
                    .iter()
                    .filter(|link| link["note_id"] == note_id)
                    .filter_map(|link| {
                        let item_id = link["item_id"].as_str()?;
                        arr(&state, "items")
                            .iter()
                            .find(|item| item["id"] == item_id)
                            .map(|item| compact_item_link(&state, item))
                    })
                    .collect::<Vec<_>>();
                note["linked_items"] = json!(links);
                Ok(note)
            }
            _ => Err(GlobalManagerError::Invalid(format!(
                "unsupported global command: {command}"
            ))),
        }
    }

    fn validate(&self, command: &str, p: &Value) -> Result<(), GlobalManagerError> {
        if command.trim().is_empty() {
            return Err(GlobalManagerError::Invalid(
                "global command is required".into(),
            ));
        }
        if p.get("expected_revision")
            .is_some_and(|value| value.as_u64().is_none())
        {
            return Err(GlobalManagerError::Invalid(
                "expected_revision must be a non-negative integer".into(),
            ));
        }
        let string_fields: &[&str] = match command {
            "project add" => &["project_id", "description", "folder"],
            "project edit" => &["project_id", "name", "description", "lifecycle", "health"],
            "todo add" => &["item_id", "title", "description", "kind", "status_id"],
            "task add" | "subtask add" | "milestone add" => {
                &["item_id", "title", "description", "status_id"]
            }
            "todo edit" | "task edit" | "subtask edit" | "milestone edit" => {
                &["item_id", "title", "description", "status_id"]
            }
            "workflow status edit" => &["label", "category"],
            "note edit" => &["title", "body"],
            "relationship add" => &["kind"],
            _ => &[],
        };
        for field in string_fields {
            if p.get(*field).is_some_and(|value| !value.is_string()) {
                return Err(GlobalManagerError::Invalid(format!(
                    "{field} must be a string"
                )));
            }
        }
        for field in ["folder", "path"] {
            if p.get(field)
                .and_then(Value::as_str)
                .is_some_and(|value| value.len() > GLOBAL_PATH_MAX_BYTES)
            {
                return Err(GlobalManagerError::Invalid(format!(
                    "{field} exceeds the {GLOBAL_PATH_MAX_BYTES}-byte limit"
                )));
            }
        }
        if matches!(
            command,
            "todo add"
                | "task add"
                | "subtask add"
                | "milestone add"
                | "todo edit"
                | "task edit"
                | "subtask edit"
                | "milestone edit"
        ) {
            for field in ["project_id", "parent_id"] {
                if let Some(value) = p.get(field) {
                    if !value.is_null() && !value.is_string() {
                        return Err(GlobalManagerError::Invalid(format!(
                            "{field} must be a string or null"
                        )));
                    }
                    if let Some(id) = value.as_str() {
                        boreal_domain::global_manager::validate_identifier(id)
                            .map_err(|error| GlobalManagerError::Invalid(error.to_string()))?;
                    }
                }
            }
        }
        if command == "history" {
            if p.get("limit")
                .is_some_and(|v| v.as_u64().is_none_or(|limit| !(1..=200).contains(&limit)))
            {
                return Err(GlobalManagerError::Invalid(
                    "global activity limit must be from 1 to 200".into(),
                ));
            }
            if p.get("offset").is_some_and(|v| v.as_u64().is_none()) {
                return Err(GlobalManagerError::Invalid(
                    "global activity offset must be a non-negative integer".into(),
                ));
            }
            for key in ["project_id", "entity_id"] {
                if let Some(value) = p.get(key).and_then(Value::as_str) {
                    boreal_domain::global_manager::validate_identifier(value)
                        .map_err(|error| GlobalManagerError::Invalid(error.to_string()))?;
                }
                if p.get(key)
                    .is_some_and(|value| !value.is_null() && !value.is_string())
                {
                    return Err(GlobalManagerError::Invalid(format!(
                        "{key} must be a string"
                    )));
                }
            }
        }
        if command == "todo reorder" {
            string(p, "item_id")?;
            if !matches!(
                p.get("direction").and_then(Value::as_str),
                Some("up" | "down")
            ) {
                return Err(GlobalManagerError::Invalid(
                    "todo reorder direction must be up or down".into(),
                ));
            }
        }
        if command == "workflow status add" {
            let id = string(p, "status_id")?;
            let label = string(p, "label")?;
            let category = string(p, "category")?;
            let category = StatusCategory::try_from(category)
                .map_err(|e| GlobalManagerError::Invalid(e.to_string()))?;
            boreal_domain::global_manager::WorkflowStatus {
                id: id.to_owned(),
                label: label.to_owned(),
                category,
                position: p.get("position").and_then(Value::as_i64).unwrap_or(0),
            }
            .validate()
            .map_err(|e| GlobalManagerError::Invalid(e.to_string()))?;
        }
        if command == "project add" {
            string(p, "name")?;
            if let Some(id) = p.get("project_id").and_then(Value::as_str) {
                boreal_domain::global_manager::validate_identifier(id)
                    .map_err(|e| GlobalManagerError::Invalid(e.to_string()))?;
            }
            if p.get("priority")
                .and_then(Value::as_u64)
                .is_some_and(|v| v > 255)
            {
                return Err(GlobalManagerError::Invalid(
                    "project priority must be from 0 to 255".into(),
                ));
            }
            if p.get("priority").is_some() && p.get("priority").and_then(Value::as_u64).is_none() {
                return Err(GlobalManagerError::Invalid(
                    "project priority must be an integer from 0 to 255".into(),
                ));
            }
            if let Some(labels) = p.get("labels") {
                validate_labels(labels).map_err(|e| GlobalManagerError::Invalid(e.to_string()))?;
            }
            if p.get("folder")
                .and_then(Value::as_str)
                .is_some_and(|v| v.trim().is_empty())
            {
                return Err(GlobalManagerError::Invalid(
                    "folder path is required when supplied".into(),
                ));
            }
        }
        if command == "relationship add"
            && !["depends_on", "blocks", "related"].contains(
                &p.get("kind")
                    .and_then(Value::as_str)
                    .unwrap_or("depends_on"),
            )
        {
            return Err(GlobalManagerError::Invalid(
                "relationship kind must be depends_on, blocks, or related".into(),
            ));
        }
        if command == "note edit"
            && p.get("title")
                .and_then(Value::as_str)
                .is_some_and(|v| v.trim().is_empty())
        {
            return Err(GlobalManagerError::Invalid("note title is required".into()));
        }
        if command == "note edit"
            && p.get("body")
                .and_then(Value::as_str)
                .is_some_and(|v| v.trim().is_empty())
        {
            return Err(GlobalManagerError::Invalid("note body is required".into()));
        }
        if matches!(command, "note link add" | "note link remove") {
            for field in ["note_id", "item_id"] {
                let value = string(p, field)?;
                boreal_domain::global_manager::validate_identifier(value)
                    .map_err(|e| GlobalManagerError::Invalid(e.to_string()))?;
            }
            boreal_domain::global_manager::ManagementNoteLink {
                note_id: string(p, "note_id")?.to_owned(),
                item_id: string(p, "item_id")?.to_owned(),
                project_id: None,
            }
            .validate()
            .map_err(|e| GlobalManagerError::Invalid(e.to_string()))?;
        }
        if command == "todo bulk triage" {
            if p.get("expected_revision").and_then(Value::as_u64).is_none() {
                return Err(GlobalManagerError::Invalid(
                    "bulk triage requires expected_revision".into(),
                ));
            }
            let changes = p
                .get("changes")
                .and_then(Value::as_array)
                .ok_or_else(|| GlobalManagerError::Invalid("changes must be an array".into()))?;
            if changes.is_empty() || changes.len() > 200 {
                return Err(GlobalManagerError::Invalid(
                    "bulk triage requires 1 to 200 changes".into(),
                ));
            }
            let mut ids = std::collections::BTreeSet::new();
            for change in changes {
                let item_id = change
                    .get("item_id")
                    .and_then(Value::as_str)
                    .filter(|v| !v.trim().is_empty())
                    .ok_or_else(|| {
                        GlobalManagerError::Invalid("each triage change requires item_id".into())
                    })?;
                boreal_domain::global_manager::validate_identifier(item_id)
                    .map_err(|e| GlobalManagerError::Invalid(e.to_string()))?;
                if !ids.insert(item_id) {
                    return Err(GlobalManagerError::Invalid(
                        "bulk triage contains a duplicate item_id".into(),
                    ));
                }
                for field in ["project_id", "parent_id"] {
                    if change
                        .get(field)
                        .is_none_or(|v| !(v.is_null() || v.as_str().is_some()))
                    {
                        return Err(GlobalManagerError::Invalid(format!(
                            "each triage change requires {field} as a string or null"
                        )));
                    }
                    if let Some(value) = change.get(field).and_then(Value::as_str) {
                        boreal_domain::global_manager::validate_identifier(value)
                            .map_err(|e| GlobalManagerError::Invalid(e.to_string()))?;
                    }
                }
                let status = change
                    .get("status_id")
                    .and_then(Value::as_str)
                    .filter(|v| !v.trim().is_empty())
                    .ok_or_else(|| {
                        GlobalManagerError::Invalid("each triage change requires status_id".into())
                    })?;
                boreal_domain::global_manager::validate_identifier(status)
                    .map_err(|e| GlobalManagerError::Invalid(e.to_string()))?;
            }
        }
        if command == "association show" {
            for field in ["project_id", "kind", "identity"] {
                let value = string(p, field)?;
                if value.trim().is_empty() {
                    return Err(GlobalManagerError::Invalid(format!("{field} is required")));
                }
            }
        }
        if command == "project link" {
            boreal_domain::global_manager::validate_identifier(string(p, "identity")?)
                .map_err(|e| GlobalManagerError::Invalid(e.to_string()))?;
            if string(p, "path")?.trim().is_empty() {
                return Err(GlobalManagerError::Invalid(
                    "workspace path is required".into(),
                ));
            }
        }
        if matches!(
            command,
            "todo add" | "task add" | "subtask add" | "milestone add"
        ) {
            let title = string(p, "title")?;
            let kind = match command {
                "subtask add" => "subtask",
                "milestone add" => "milestone",
                "task add" => "task",
                _ => p.get("kind").and_then(Value::as_str).unwrap_or("task"),
            };
            let kind = ManagementItemKind::try_from(kind)
                .map_err(|e| GlobalManagerError::Invalid(e.to_string()))?;
            let item = boreal_domain::global_manager::ManagementItem {
                id: p
                    .get("item_id")
                    .and_then(Value::as_str)
                    .unwrap_or("pending-id")
                    .to_owned(),
                project_id: p
                    .get("project_id")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                parent_id: p
                    .get("parent_id")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                kind,
                title: title.to_owned(),
                description: p
                    .get("description")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_owned(),
                status_id: p
                    .get("status_id")
                    .and_then(Value::as_str)
                    .unwrap_or("todo")
                    .to_owned(),
                priority: p
                    .get("priority")
                    .and_then(Value::as_u64)
                    .unwrap_or(0)
                    .min(255) as u8,
                due_at: p.get("due_at").and_then(Value::as_str).map(str::to_owned),
                follow_up_at: p
                    .get("follow_up_at")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                archived: false,
                position: p.get("position").and_then(Value::as_i64).unwrap_or(0),
            };
            item.validate()
                .map_err(|e| GlobalManagerError::Invalid(e.to_string()))?;
            if p.get("priority")
                .and_then(Value::as_u64)
                .is_some_and(|v| v > 255)
            {
                return Err(GlobalManagerError::Invalid(
                    "priority must be from 0 to 255".into(),
                ));
            }
            if let Some(labels) = p.get("labels") {
                validate_labels(labels).map_err(|e| GlobalManagerError::Invalid(e.to_string()))?;
            }
            if p.get("due_at")
                .is_some_and(|v| !v.is_null() && v.as_str().is_none())
            {
                return Err(GlobalManagerError::Invalid(
                    "due_at must be a string or null".into(),
                ));
            }
            if p.get("due_at")
                .and_then(Value::as_str)
                .is_some_and(|v| v.len() > 128 || utc_date_from_iso(v).is_none())
            {
                return Err(GlobalManagerError::Invalid(
                    "due_at must be YYYY-MM-DD or an ISO timestamp with Z or an explicit offset"
                        .into(),
                ));
            }
            if p.get("follow_up_at")
                .is_some_and(|v| !v.is_null() && v.as_str().is_none())
            {
                return Err(GlobalManagerError::Invalid(
                    "follow_up_at must be a string or null".into(),
                ));
            }
            if p.get("follow_up_at")
                .and_then(Value::as_str)
                .is_some_and(|v| v.len() > 128 || utc_date_from_iso(v).is_none())
            {
                return Err(GlobalManagerError::Invalid("follow_up_at must be YYYY-MM-DD or an ISO timestamp with Z or an explicit offset".into()));
            }
        }
        if command == "workflow status edit" {
            if let Some(category) = p.get("category").and_then(Value::as_str) {
                StatusCategory::try_from(category)
                    .map_err(|e| GlobalManagerError::Invalid(e.to_string()))?;
            }
        }
        if command == "project attach-folder" && string(p, "path")?.trim().is_empty() {
            return Err(GlobalManagerError::Invalid(
                "folder path is required".into(),
            ));
        }
        if matches!(
            command,
            "todo add" | "task add" | "subtask add" | "milestone add" | "todo edit"
        ) {
            if p.get("priority").is_some() && p.get("priority").and_then(Value::as_u64).is_none() {
                return Err(GlobalManagerError::Invalid(
                    "priority must be an integer from 0 to 255".into(),
                ));
            }
            if let Some(id) = p.get("item_id").and_then(Value::as_str) {
                boreal_domain::global_manager::validate_identifier(id)
                    .map_err(|e| GlobalManagerError::Invalid(e.to_string()))?;
            }
            if let Some(status) = p.get("status_id").and_then(Value::as_str) {
                boreal_domain::global_manager::validate_identifier(status)
                    .map_err(|e| GlobalManagerError::Invalid(e.to_string()))?;
            }
        }
        if command == "project edit" {
            if let Some(labels) = p.get("labels") {
                validate_labels(labels).map_err(|e| GlobalManagerError::Invalid(e.to_string()))?;
            }
            if p.get("priority")
                .and_then(Value::as_u64)
                .is_some_and(|v| v > 255)
            {
                return Err(GlobalManagerError::Invalid(
                    "project priority must be from 0 to 255".into(),
                ));
            }
            if p.get("priority").is_some() && p.get("priority").and_then(Value::as_u64).is_none() {
                return Err(GlobalManagerError::Invalid(
                    "project priority must be an integer from 0 to 255".into(),
                ));
            }
        }
        if command == "todo edit" {
            if let Some(labels) = p.get("labels") {
                validate_labels(labels).map_err(|e| GlobalManagerError::Invalid(e.to_string()))?;
            }
            if p.get("priority")
                .and_then(Value::as_u64)
                .is_some_and(|v| v > 255)
            {
                return Err(GlobalManagerError::Invalid(
                    "priority must be from 0 to 255".into(),
                ));
            }
            if p.get("due_at")
                .is_some_and(|v| !v.is_null() && v.as_str().is_none())
            {
                return Err(GlobalManagerError::Invalid(
                    "due_at must be a string or null".into(),
                ));
            }
            if p.get("due_at")
                .and_then(Value::as_str)
                .is_some_and(|v| v.len() > 128 || utc_date_from_iso(v).is_none())
            {
                return Err(GlobalManagerError::Invalid(
                    "due_at must be YYYY-MM-DD or an ISO timestamp with Z or an explicit offset"
                        .into(),
                ));
            }
            if p.get("follow_up_at")
                .is_some_and(|v| !v.is_null() && v.as_str().is_none())
            {
                return Err(GlobalManagerError::Invalid(
                    "follow_up_at must be a string or null".into(),
                ));
            }
            if p.get("follow_up_at")
                .and_then(Value::as_str)
                .is_some_and(|v| v.len() > 128 || utc_date_from_iso(v).is_none())
            {
                return Err(GlobalManagerError::Invalid("follow_up_at must be YYYY-MM-DD or an ISO timestamp with Z or an explicit offset".into()));
            }
        }
        Ok(())
    }
}

fn string<'a>(v: &'a Value, key: &str) -> Result<&'a str, GlobalManagerError> {
    v.get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| GlobalManagerError::Invalid(format!("{key} is required")))
}

fn is_mutation(command: &str) -> bool {
    !matches!(
        command,
        "snapshot"
            | "project list"
            | "project show"
            | "todo list"
            | "todo show"
            | "task list"
            | "task show"
            | "milestone list"
            | "milestone show"
            | "workflow status list"
            | "relationship list"
            | "association show"
            | "note link list"
            | "note list"
            | "note show"
            | "export"
            | "history"
            | "detail page"
            | "operation show"
    )
}
fn id<'a>(p: &'a Value, key: &str) -> Result<&'a str, StoreError> {
    p.get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| StoreError::Invalid(format!("{key} is required")))
}
fn now() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string()
}
fn new_id(prefix: &str) -> String {
    format!(
        "{prefix}-{}-{}-{}",
        std::process::id(),
        now(),
        GLOBAL_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}
fn arr_mut<'a>(s: &'a mut Value, key: &str) -> &'a mut Vec<Value> {
    s[key]
        .as_array_mut()
        .expect("canonical global state arrays exist")
}
fn arr<'a>(s: &'a Value, key: &str) -> &'a Vec<Value> {
    s[key]
        .as_array()
        .expect("canonical global state arrays exist")
}
fn required_string<'a>(p: &'a Value, key: &str) -> Result<&'a str, StoreError> {
    id(p, key)
}
fn project_exists(s: &Value, pid: &str) -> bool {
    arr(s, "projects").iter().any(|p| p["id"] == pid)
}
fn item_exists(s: &Value, id: &str) -> bool {
    arr(s, "items").iter().any(|i| i["id"] == id)
}

fn apply_mutation(
    command: &str,
    p: &Value,
    s: &mut Value,
    revision: u64,
) -> Result<Value, StoreError> {
    let timestamp = now();
    if command == "todo bulk triage" {
        return apply_bulk_triage(p, s, revision, &timestamp);
    }
    match command {
        "project add" => {
            let name = required_string(p, "name")?.trim();
            if name.is_empty() {
                return Err(StoreError::Invalid("project name is required".into()));
            }
            let pid = p
                .get("project_id")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .unwrap_or_else(|| new_id("project"));
            if project_exists(s, &pid) {
                return Err(StoreError::Invalid("project already exists".into()));
            }
            let value = json!({"id":pid,"name":name,"description":p.get("description").and_then(Value::as_str).unwrap_or(""),"labels":p.get("labels").cloned().unwrap_or(json!([])),"priority":p.get("priority").and_then(Value::as_u64).unwrap_or(0),"lifecycle":"planned","health":"unknown","archived":false,"created_at":timestamp,"updated_at":timestamp});
            arr_mut(s, "projects").push(value.clone());
            if let Some(folder) = p.get("folder").and_then(Value::as_str) {
                arr_mut(s, "associations").push(json!({"project_id":pid,"kind":"folder","identity":folder,"path":folder,"updated_at":timestamp}));
            }
            for (sid, label, cat, pos) in [
                ("todo", "To do", "open", 0),
                ("doing", "Doing", "active", 1),
                ("waiting", "Waiting", "waiting", 2),
                ("blocked", "Blocked", "blocked", 3),
                ("done", "Done", "completed", 4),
                ("cancelled", "Cancelled", "cancelled", 5),
            ] {
                arr_mut(s,"statuses").push(json!({"project_id":pid,"status_id":sid,"label":label,"category":cat,"position":pos}));
            }
            Ok(value)
        }
        "project edit" => {
            let pid = required_string(p, "project_id")?;
            let row = arr_mut(s, "projects")
                .iter_mut()
                .find(|r| r["id"] == pid)
                .ok_or_else(|| StoreError::Invalid("management project not found".into()))?;
            if let Some(v) = p.get("name").and_then(Value::as_str) {
                if v.trim().is_empty() {
                    return Err(StoreError::Invalid("project name is required".into()));
                }
                row["name"] = json!(v.trim());
            }
            if let Some(v) = p.get("description").and_then(Value::as_str) {
                row["description"] = json!(v);
            }
            if let Some(v) = p.get("labels") {
                row["labels"] = v.clone();
            }
            if let Some(v) = p.get("priority").and_then(Value::as_u64) {
                row["priority"] = json!(v);
            }
            if let Some(v) = p.get("lifecycle").and_then(Value::as_str) {
                if !["planned", "active", "on_hold", "completed", "cancelled"].contains(&v) {
                    return Err(StoreError::Invalid(
                        "invalid management project lifecycle".into(),
                    ));
                }
                row["lifecycle"] = json!(v);
            }
            if let Some(v) = p.get("health").and_then(Value::as_str) {
                if !["unknown", "on_track", "at_risk", "blocked", "healthy"].contains(&v) {
                    return Err(StoreError::Invalid(
                        "invalid management project health".into(),
                    ));
                }
                row["health"] = json!(v);
            }
            row["updated_at"] = json!(timestamp);
            Ok(row.clone())
        }
        "project registry-state" => {
            let pid = required_string(p, "project_id")?;
            let state = required_string(p, "state")?;
            let row = arr_mut(s, "projects")
                .iter_mut()
                .find(|row| row["id"] == pid)
                .ok_or_else(|| StoreError::Invalid("management project not found".into()))?;
            let lifecycle = row["lifecycle"].as_str().unwrap_or("planned");
            match state {
                "paused" if row["archived"]!=true && matches!(lifecycle,"planned"|"active"|"on_hold") => { if lifecycle!="on_hold" {row["registry_resume_lifecycle"]=json!(lifecycle);} row["lifecycle"]=json!("on_hold"); }
                "linked" if row["archived"]!=true && matches!(lifecycle,"planned"|"active"|"on_hold") => { let resumed=row["registry_resume_lifecycle"].as_str().filter(|s|matches!(*s,"planned"|"active")).unwrap_or("active").to_owned(); row["lifecycle"]=json!(resumed); row.as_object_mut().unwrap().remove("registry_resume_lifecycle"); }
                "archived" => { row["archived"]=json!(true); }
                "missing" => return Err(StoreError::Invalid("missing is derived from workspace diagnostics, not an authored lifecycle".into())),
                _ => return Err(StoreError::Conflict("registry transition requires an unarchived nonterminal management project; use explicit unarchive/reopen controls".into())),
            }
            row["updated_at"] = json!(timestamp);
            Ok(row.clone())
        }
        "project archive" | "project unarchive" => {
            let pid = required_string(p, "project_id")?;
            let row = arr_mut(s, "projects")
                .iter_mut()
                .find(|r| r["id"] == pid)
                .ok_or_else(|| StoreError::Invalid("management project not found".into()))?;
            row["archived"] = json!(command == "project archive");
            row["updated_at"] = json!(timestamp);
            Ok(row.clone())
        }
        "project attach-folder" | "project link" => {
            let pid = required_string(p, "project_id")?;
            if !project_exists(s, pid) {
                return Err(StoreError::Invalid("management project not found".into()));
            }
            let (kind, identity, path) = if command == "project attach-folder" {
                (
                    "folder",
                    p.get("path")
                        .and_then(Value::as_str)
                        .ok_or_else(|| StoreError::Invalid("path is required".into()))?,
                    p.get("path").and_then(Value::as_str),
                )
            } else {
                (
                    "workspace",
                    required_string(p, "identity")?,
                    p.get("path").and_then(Value::as_str),
                )
            };
            let record = json!({"project_id":pid,"kind":kind,"identity":identity,"path":path,"updated_at":timestamp});
            let rows = arr_mut(s, "associations");
            if let Some(row) = rows
                .iter_mut()
                .find(|r| r["project_id"] == pid && r["kind"] == kind && r["identity"] == identity)
            {
                *row = record.clone();
            } else {
                rows.push(record.clone());
            }
            Ok(record)
        }
        "project unlink" => {
            let pid = required_string(p, "project_id")?;
            let kind = required_string(p, "kind")?;
            let identity = required_string(p, "identity")?;
            let rows = arr_mut(s, "associations");
            let n = rows.len();
            rows.retain(|r| {
                !(r["project_id"] == pid && r["kind"] == kind && r["identity"] == identity)
            });
            if rows.len() == n {
                return Err(StoreError::Invalid("project association not found".into()));
            }
            Ok(json!({"project_id":pid,"kind":kind,"identity":identity,"removed":true}))
        }
        "todo add" | "task add" | "subtask add" | "milestone add" => {
            let title = required_string(p, "title")?.trim();
            if title.is_empty() {
                return Err(StoreError::Invalid("item title is required".into()));
            }
            let project_id = p.get("project_id").and_then(Value::as_str);
            if let Some(pid) = project_id {
                if !project_exists(s, pid) {
                    return Err(StoreError::Invalid("management project not found".into()));
                }
            }
            let kind = match command {
                "subtask add" => "subtask",
                "milestone add" => "milestone",
                "task add" => "task",
                _ => p.get("kind").and_then(Value::as_str).unwrap_or("task"),
            };
            let kind = ManagementItemKind::try_from(kind)
                .map_err(|e| StoreError::Invalid(e.to_string()))?;
            let parent = p.get("parent_id").and_then(Value::as_str);
            let parent_kind = parent
                .map(|parent_id| {
                    let parent_record = arr(s, "items")
                        .iter()
                        .find(|r| r["id"] == parent_id)
                        .ok_or_else(|| StoreError::Invalid("parent item not found".into()))?;
                    if parent_record["project_id"].as_str() != project_id {
                        return Err(StoreError::Invalid(
                            "parent and child must belong to the same management project".into(),
                        ));
                    }
                    ManagementItemKind::try_from(parent_record["kind"].as_str().unwrap_or("task"))
                        .map_err(|e| StoreError::Invalid(e.to_string()))
                })
                .transpose()?;
            boreal_domain::global_manager::validate_item_parent(kind, parent_kind)
                .map_err(|e| StoreError::Invalid(e.to_string()))?;
            let status = p.get("status_id").and_then(Value::as_str).unwrap_or("todo");
            validate_status(s, project_id, status)?;
            let iid = p
                .get("item_id")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .unwrap_or_else(|| new_id("item"));
            let priority = p.get("priority").and_then(Value::as_u64).unwrap_or(0);
            if priority > 255 {
                return Err(StoreError::Invalid("priority must be from 0 to 255".into()));
            }
            let value = json!({"id":iid,"project_id":project_id,"parent_id":parent,"kind":kind.as_str(),"title":title,"description":p.get("description").and_then(Value::as_str).unwrap_or(""),"labels":p.get("labels").cloned().unwrap_or(json!([])),"status_id":status,"priority":priority,"due_at":p.get("due_at").cloned().unwrap_or(Value::Null),"follow_up_at":p.get("follow_up_at").cloned().unwrap_or(Value::Null),"archived":false,"position":p.get("position").and_then(Value::as_i64).unwrap_or(0),"created_at":timestamp,"updated_at":timestamp});
            arr_mut(s, "items").push(value.clone());
            let status_record = arr(s, "statuses")
                .iter()
                .find(|row| row["status_id"] == status && row["project_id"].as_str() == project_id)
                .cloned()
                .unwrap_or(Value::Null);
            arr_mut(s, "status_history").push(json!({"item_id":iid,"workflow_owner_id":project_id,"from_workflow_owner_id":project_id,"from_status_id":null,"from_status_label":null,"from_status_category":null,"to_status_id":status,"to_status_label":status_record["label"],"to_status_category":status_record["category"],"revision":revision,"changed_at":timestamp}));
            Ok(value)
        }
        "todo reorder" => {
            let iid = required_string(p, "item_id")?;
            let direction = required_string(p, "direction")?;
            let target_snapshot = arr(s, "items")
                .iter()
                .find(|row| row["id"] == iid)
                .cloned()
                .ok_or_else(|| StoreError::Invalid("management item not found".into()))?;
            if target_snapshot["archived"].as_bool() == Some(true) {
                return Err(StoreError::Invalid(
                    "archived items cannot be reordered".into(),
                ));
            }
            let project_id = target_snapshot["project_id"].clone();
            let parent_id = target_snapshot["parent_id"].clone();
            let status_id = target_snapshot["status_id"].clone();
            let mut siblings = arr(s, "items")
                .iter()
                .filter(|row| {
                    row["archived"].as_bool() != Some(true)
                        && row["project_id"] == project_id
                        && row["parent_id"] == parent_id
                        && row["status_id"] == status_id
                })
                .map(|row| {
                    (
                        row["position"].as_i64().unwrap_or(0),
                        row["id"].as_str().unwrap_or_default().to_owned(),
                    )
                })
                .collect::<Vec<_>>();
            siblings.sort_by(|left, right| left.0.cmp(&right.0).then_with(|| left.1.cmp(&right.1)));
            let current = siblings
                .iter()
                .position(|(_, id)| id == iid)
                .ok_or_else(|| StoreError::Invalid("management item is not reorderable".into()))?;
            let adjacent = match direction {
                "up" => current.checked_sub(1),
                "down" if current + 1 < siblings.len() => Some(current + 1),
                "down" => None,
                _ => {
                    return Err(StoreError::Invalid(
                        "todo reorder direction must be up or down".into(),
                    ));
                }
            };
            if let Some(adjacent) = adjacent {
                siblings.swap(current, adjacent);
                for (position, (_, id)) in siblings.iter().enumerate() {
                    if let Some(row) = arr_mut(s, "items")
                        .iter_mut()
                        .find(|row| row["id"] == id.as_str())
                    {
                        row["position"] = json!(position as i64);
                        row["updated_at"] = json!(timestamp);
                    }
                }
            }
            let mut result = arr(s, "items")
                .iter()
                .find(|row| row["id"] == iid)
                .cloned()
                .ok_or_else(|| StoreError::Invalid("management item not found".into()))?;
            result["moved"] = json!(adjacent.is_some());
            result["ordered_ids"] = json!(siblings.iter().map(|(_, id)| id).collect::<Vec<_>>());
            result["revision"] = json!(revision);
            Ok(result)
        }
        "todo edit"
        | "task edit"
        | "milestone edit"
        | "todo move"
        | "todo complete"
        | "todo reopen"
        | "todo archive"
        | "todo unarchive"
        | "unarchive"
        | "task archive"
        | "task unarchive"
        | "milestone archive"
        | "milestone unarchive" => {
            let iid = required_string(p, "item_id")?;
            let item_snapshot = arr(s, "items")
                .iter()
                .find(|r| r["id"] == iid)
                .cloned()
                .ok_or_else(|| StoreError::Invalid("management item not found".into()))?;
            let project_id = item_snapshot["project_id"].as_str().map(str::to_owned);
            if let Some(v) = p.get("project_id").and_then(Value::as_str) {
                if !project_exists(s, v) {
                    return Err(StoreError::Invalid("management project not found".into()));
                }
            }
            if let Some(v) = p.get("parent_id") {
                if !v.is_null() && v.as_str().is_some_and(|x| !item_exists(s, x)) {
                    return Err(StoreError::Invalid("parent item not found".into()));
                }
            }
            let new_owner = match p.get("project_id") {
                Some(Value::Null) => None,
                Some(v) => v.as_str().map(str::to_owned),
                None => project_id.clone(),
            };
            let selected_status = p
                .get("status_id")
                .and_then(Value::as_str)
                .unwrap_or_else(|| item_snapshot["status_id"].as_str().unwrap_or(""));
            validate_status(s, new_owner.as_deref(), selected_status)?;
            if new_owner != project_id
                && arr(s, "items").iter().any(|child| {
                    child["parent_id"] == iid
                        && child["project_id"].as_str().map(str::to_owned) != new_owner
                })
            {
                return Err(StoreError::Invalid(
                    "moving an item would separate it from its children".into(),
                ));
            }
            if new_owner != project_id
                && arr(s, "relationships").iter().any(|edge| {
                    if edge["source_id"] != iid && edge["target_id"] != iid {
                        return false;
                    }
                    let other_id = if edge["source_id"] == iid {
                        edge["target_id"].as_str()
                    } else {
                        edge["source_id"].as_str()
                    };
                    arr(s, "items")
                        .iter()
                        .find(|item| item["id"].as_str() == other_id)
                        .is_some_and(|other| {
                            other["project_id"].as_str().map(str::to_owned) != new_owner
                        })
                })
            {
                return Err(StoreError::Invalid(
                    "moving an item would split a relationship; move both endpoints atomically"
                        .into(),
                ));
            }
            if new_owner != project_id
                && arr(s, "note_links").iter().any(|link| {
                    if link["item_id"] != iid {
                        return false;
                    }
                    let note_id = link["note_id"].as_str();
                    arr(s, "notes")
                        .iter()
                        .find(|note| note["id"].as_str() == note_id)
                        .is_some_and(|note| {
                            note["project_id"].as_str().map(str::to_owned) != new_owner
                        })
                })
            {
                return Err(StoreError::Invalid(
                    "moving an item would split a note link; move or unlink the note atomically"
                        .into(),
                ));
            }
            if new_owner != project_id
                && arr(s, "status_history").iter().any(|entry| {
                    entry["item_id"] == iid
                        && (entry.get("workflow_owner_id").is_none()
                            || entry.get("from_workflow_owner_id").is_none())
                })
            {
                return Err(StoreError::Invalid("item transfer is unsafe because historical workflow identity cannot be preserved".into()));
            }
            let new_parent = match p.get("parent_id") {
                Some(Value::Null) => None,
                Some(v) => v.as_str().map(str::to_owned),
                None => item_snapshot["parent_id"].as_str().map(str::to_owned),
            };
            let item_kind =
                ManagementItemKind::try_from(item_snapshot["kind"].as_str().unwrap_or("task"))
                    .map_err(|e| StoreError::Invalid(e.to_string()))?;
            let parent_kind = if let Some(parent_id) = new_parent.as_deref() {
                let parent_record = arr(s, "items")
                    .iter()
                    .find(|r| r["id"] == parent_id)
                    .ok_or_else(|| StoreError::Invalid("parent item not found".into()))?;
                if parent_record["project_id"].as_str().map(str::to_owned) != new_owner {
                    return Err(StoreError::Invalid(
                        "parent and child must belong to the same management project".into(),
                    ));
                }
                let mut cursor = Some(parent_id.to_owned());
                let mut visited = std::collections::BTreeSet::new();
                while let Some(id) = cursor {
                    if id == iid {
                        return Err(StoreError::Invalid(
                            "item hierarchy cannot contain a cycle".into(),
                        ));
                    }
                    if !visited.insert(id.clone()) {
                        break;
                    }
                    cursor = arr(s, "items")
                        .iter()
                        .find(|r| r["id"] == id)
                        .and_then(|r| r["parent_id"].as_str())
                        .map(str::to_owned);
                }
                Some(
                    ManagementItemKind::try_from(parent_record["kind"].as_str().unwrap_or("task"))
                        .map_err(|e| StoreError::Invalid(e.to_string()))?,
                )
            } else {
                None
            };
            boreal_domain::global_manager::validate_item_parent(item_kind, parent_kind)
                .map_err(|e| StoreError::Invalid(e.to_string()))?;
            let completion_status = if command == "todo complete" {
                Some(status_for_category(s, project_id.as_deref(), "completed")?)
            } else {
                None
            };
            let reopen_status = if command == "todo reopen" {
                Some(status_for_category(s, project_id.as_deref(), "open")?)
            } else {
                None
            };
            let rows = arr_mut(s, "items");
            let row = rows
                .iter_mut()
                .find(|r| r["id"] == iid)
                .ok_or_else(|| StoreError::Invalid("management item not found".into()))?;
            let old_status = item_snapshot["status_id"]
                .as_str()
                .unwrap_or_default()
                .to_owned();
            if command.ends_with(" archive") {
                row["archived"] = json!(true);
            } else if matches!(
                command,
                "todo unarchive" | "task unarchive" | "milestone unarchive" | "unarchive"
            ) {
                row["archived"] = json!(false);
            } else if command == "todo complete" {
                row["status_id"] = json!(completion_status.unwrap());
            } else if command == "todo reopen" {
                row["status_id"] = json!(reopen_status.unwrap());
            } else {
                if let Some(v) = p.get("title").and_then(Value::as_str) {
                    if v.trim().is_empty() {
                        return Err(StoreError::Invalid("item title is required".into()));
                    }
                    row["title"] = json!(v.trim());
                }
                if let Some(v) = p.get("description").and_then(Value::as_str) {
                    row["description"] = json!(v);
                }
                if let Some(v) = p.get("labels") {
                    row["labels"] = v.clone();
                }
                if let Some(v) = p.get("status_id").and_then(Value::as_str) {
                    row["status_id"] = json!(v);
                }
                if let Some(v) = p.get("priority").and_then(Value::as_u64) {
                    if v > 255 {
                        return Err(StoreError::Invalid("priority must be from 0 to 255".into()));
                    }
                    row["priority"] = json!(v);
                }
                if let Some(v) = p.get("due_at") {
                    row["due_at"] = v.clone();
                }
                if let Some(v) = p.get("follow_up_at") {
                    row["follow_up_at"] = v.clone();
                }
                if let Some(v) = p.get("position").and_then(Value::as_i64) {
                    row["position"] = json!(v);
                }
                if let Some(v) = p.get("project_id") {
                    row["project_id"] = v.clone();
                }
                if let Some(v) = p.get("parent_id") {
                    row["parent_id"] = v.clone();
                }
            }
            row["updated_at"] = json!(timestamp);
            let value = row.clone();
            let new_status = value["status_id"].as_str().unwrap_or_default();
            let old_owner = item_snapshot["project_id"].as_str();
            if old_status != new_status || old_owner != new_owner.as_deref() {
                let old_record = arr(s, "statuses")
                    .iter()
                    .find(|record| {
                        record["project_id"].as_str() == old_owner
                            && record["status_id"] == old_status
                    })
                    .cloned()
                    .unwrap_or(Value::Null);
                let status_record = arr(s, "statuses")
                    .iter()
                    .find(|record| {
                        record["project_id"].as_str() == new_owner.as_deref()
                            && record["status_id"] == new_status
                    })
                    .cloned()
                    .unwrap_or(Value::Null);
                arr_mut(s,"status_history").push(json!({"item_id":iid,"workflow_owner_id":new_owner,"from_workflow_owner_id":old_owner,"from_status_id":old_status,"from_status_label":old_record["label"],"from_status_category":old_record["category"],"to_status_id":new_status,"to_status_label":status_record["label"],"to_status_category":status_record["category"],"revision":revision,"changed_at":timestamp}));
            }
            Ok(value)
        }
        "workflow status add" => {
            let pid = required_string(p, "project_id")?;
            if !project_exists(s, pid) {
                return Err(StoreError::Invalid("management project not found".into()));
            }
            let sid = required_string(p, "status_id")?;
            let label = required_string(p, "label")?.trim();
            let cat = required_string(p, "category")?;
            if ![
                "open",
                "active",
                "waiting",
                "blocked",
                "completed",
                "cancelled",
            ]
            .contains(&cat)
            {
                return Err(StoreError::Invalid("invalid workflow category".into()));
            }
            if arr(s, "statuses")
                .iter()
                .any(|r| r["project_id"] == pid && r["status_id"] == sid)
            {
                return Err(StoreError::Invalid("workflow status already exists".into()));
            }
            let value = json!({"project_id":pid,"status_id":sid,"label":label,"category":cat,"position":p.get("position").and_then(Value::as_i64).unwrap_or(0)});
            arr_mut(s, "statuses").push(value.clone());
            Ok(value)
        }
        "workflow status edit" => {
            let pid = required_string(p, "project_id")?;
            let sid = required_string(p, "status_id")?;
            let rows = arr_mut(s, "statuses");
            let row = rows
                .iter_mut()
                .find(|r| r["project_id"] == pid && r["status_id"] == sid)
                .ok_or_else(|| StoreError::Invalid("workflow status not found".into()))?;
            if let Some(v) = p.get("label").and_then(Value::as_str) {
                if v.trim().is_empty() {
                    return Err(StoreError::Invalid(
                        "workflow status label is required".into(),
                    ));
                }
                row["label"] = json!(v.trim());
            }
            if let Some(v) = p.get("category").and_then(Value::as_str) {
                if ![
                    "open",
                    "active",
                    "waiting",
                    "blocked",
                    "completed",
                    "cancelled",
                ]
                .contains(&v)
                {
                    return Err(StoreError::Invalid("invalid workflow category".into()));
                }
                row["category"] = json!(v);
            }
            if let Some(v) = p.get("position").and_then(Value::as_i64) {
                row["position"] = json!(v);
            }
            Ok(row.clone())
        }
        "relationship add" => {
            let source = required_string(p, "source_id")?;
            let target = required_string(p, "target_id")?;
            let kind = p
                .get("kind")
                .and_then(Value::as_str)
                .unwrap_or("depends_on");
            if source == target {
                return Err(StoreError::Invalid(
                    "relationship cannot target itself".into(),
                ));
            }
            let left = arr(s, "items")
                .iter()
                .find(|r| r["id"] == source)
                .ok_or_else(|| StoreError::Invalid("relationship item not found".into()))?;
            let right = arr(s, "items")
                .iter()
                .find(|r| r["id"] == target)
                .ok_or_else(|| StoreError::Invalid("relationship item not found".into()))?;
            if left["project_id"] != right["project_id"] {
                return Err(StoreError::Invalid(
                    "relationships cannot cross management projects".into(),
                ));
            }
            let project_id = left["project_id"].clone();
            if kind == "depends_on" || kind == "blocks" {
                let edges: Vec<(String, String)> = arr(s, "relationships")
                    .iter()
                    .filter_map(|e| {
                        dependency_edge(
                            e["source_id"].as_str()?,
                            e["target_id"].as_str()?,
                            e["kind"].as_str()?,
                        )
                    })
                    .collect();
                let (prerequisite, dependent) = dependency_edge(source, target, kind).unwrap();
                boreal_domain::global_manager::validate_dependency(
                    &prerequisite,
                    &dependent,
                    &edges,
                )
                .map_err(|e| StoreError::Invalid(e.to_string()))?;
            }
            let value =
                json!({"project_id":project_id,"source_id":source,"target_id":target,"kind":kind});
            if !arr(s, "relationships").contains(&value) {
                arr_mut(s, "relationships").push(value.clone());
            }
            Ok(value)
        }
        "note link add" | "note link remove" => {
            let note_id = required_string(p, "note_id")?;
            let item_id = required_string(p, "item_id")?;
            let note = arr(s, "notes")
                .iter()
                .find(|row| row["id"] == note_id)
                .ok_or_else(|| StoreError::Invalid("note not found".into()))?;
            let item = arr(s, "items")
                .iter()
                .find(|row| row["id"] == item_id)
                .ok_or_else(|| StoreError::Invalid("management item not found".into()))?;
            if note["project_id"] != item["project_id"] {
                return Err(StoreError::Invalid(
                    "notes and linked items must belong to the same management project".into(),
                ));
            }
            let owner = note["project_id"].clone();
            let link = json!({"note_id":note_id,"item_id":item_id,"project_id":owner});
            if command == "note link add" {
                if !arr(s, "note_links")
                    .iter()
                    .any(|row| row["note_id"] == note_id && row["item_id"] == item_id)
                {
                    arr_mut(s, "note_links").push(link.clone());
                }
                Ok(link)
            } else {
                let links = arr_mut(s, "note_links");
                let count = links.len();
                links.retain(|row| !(row["note_id"] == note_id && row["item_id"] == item_id));
                if count == links.len() {
                    return Err(StoreError::Invalid("note link not found".into()));
                }
                Ok(json!({"removed":true,"note_id":note_id,"item_id":item_id,"project_id":owner}))
            }
        }
        "relationship remove" => {
            let source = required_string(p, "source_id")?;
            let target = required_string(p, "target_id")?;
            let kind = p
                .get("kind")
                .and_then(Value::as_str)
                .unwrap_or("depends_on");
            let rows = arr_mut(s, "relationships");
            let n = rows.len();
            rows.retain(|r| {
                !(r["source_id"] == source && r["target_id"] == target && r["kind"] == kind)
            });
            if rows.len() == n {
                return Err(StoreError::Invalid("relationship not found".into()));
            }
            let project_id = arr(s, "items")
                .iter()
                .find(|r| r["id"] == source)
                .and_then(|r| r["project_id"].as_str())
                .map(str::to_owned);
            Ok(
                json!({"removed":true,"project_id":project_id,"source_id":source,"target_id":target,"kind":kind}),
            )
        }
        "note add" => {
            let title = required_string(p, "title")?;
            let body = required_string(p, "body")?;
            let project = p.get("project_id").and_then(Value::as_str);
            if let Some(pid) = project {
                if !project_exists(s, pid) {
                    return Err(StoreError::Invalid("management project not found".into()));
                }
            }
            let id = p
                .get("note_id")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .unwrap_or_else(|| new_id("note"));
            let v = json!({"id":id,"project_id":project,"title":title,"body":body,"archived":false,"created_at":timestamp,"updated_at":timestamp});
            arr_mut(s, "notes").push(v.clone());
            Ok(v)
        }
        "note edit" | "note archive" | "note unarchive" => {
            let nid = required_string(p, "note_id")?;
            let row = arr_mut(s, "notes")
                .iter_mut()
                .find(|r| r["id"] == nid)
                .ok_or_else(|| StoreError::Invalid("note not found".into()))?;
            if command == "note archive" {
                row["archived"] = json!(true);
            } else if command == "note unarchive" {
                row["archived"] = json!(false);
            } else {
                if let Some(v) = p.get("title").and_then(Value::as_str) {
                    row["title"] = json!(v);
                }
                if let Some(v) = p.get("body").and_then(Value::as_str) {
                    row["body"] = json!(v);
                }
            }
            row["updated_at"] = json!(timestamp);
            Ok(row.clone())
        }
        "import" => {
            let incoming = p.get("snapshot").unwrap_or(p);
            for key in [
                "projects",
                "items",
                "notes",
                "statuses",
                "relationships",
                "associations",
            ] {
                if !incoming.get(key).is_some_and(Value::is_array) {
                    return Err(StoreError::Invalid(format!(
                        "import snapshot requires {key} array"
                    )));
                }
            }
            if !incoming.get("status_history").is_some_and(Value::is_array) {
                return Err(StoreError::Invalid(
                    "import snapshot requires status_history array".into(),
                ));
            }
            if incoming
                .get("revision_history")
                .is_some_and(|v| !v.is_array())
                || incoming
                    .get("imported_history")
                    .is_some_and(|v| !v.is_array())
            {
                return Err(StoreError::Invalid(
                    "import revision history must be arrays".into(),
                ));
            }
            if incoming.get("schema_version").and_then(Value::as_u64) != Some(2) {
                return Err(StoreError::Invalid(
                    "unsupported global backup schema version".into(),
                ));
            }
            let serialized_size = serde_json::to_vec(incoming)
                .map_err(|error| StoreError::Invalid(error.to_string()))?
                .len();
            if serialized_size > 64 * 1024 * 1024 {
                return Err(StoreError::Invalid(
                    "global backup exceeds the 64 MiB import limit".into(),
                ));
            }
            validate_import_snapshot(incoming)?;
            let mut history_entries = 0usize;
            validate_import_history(incoming, 0, &mut history_entries)?;
            let mut imported_history = incoming
                .get("imported_history")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            for entry in incoming
                .get("revision_history")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                if !entry.get("revision").and_then(Value::as_u64).is_some()
                    || !entry.get("snapshot").is_some_and(Value::is_object)
                {
                    return Err(StoreError::Invalid(
                        "invalid global revision history entry".into(),
                    ));
                }
                imported_history.push(json!({"source_revision":entry["revision"],"snapshot":entry["snapshot"],"created_at":entry["created_at"].clone(),"imported":true}));
            }
            *s = json!({"projects":incoming["projects"],"items":incoming["items"],"notes":incoming["notes"],"statuses":incoming["statuses"],"relationships":incoming["relationships"],"note_links":incoming.get("note_links").cloned().unwrap_or(json!([])),"associations":incoming["associations"],"status_history":incoming["status_history"],"imported_history":imported_history});
            Ok(
                json!({"imported":true,"counts":{"projects":arr(s,"projects").len(),"items":arr(s,"items").len(),"notes":arr(s,"notes").len()}}),
            )
        }
        _ => Err(StoreError::Invalid(format!(
            "unsupported global command: {command}"
        ))),
    }
}

fn apply_bulk_triage(
    p: &Value,
    state: &mut Value,
    revision: u64,
    timestamp: &str,
) -> Result<Value, StoreError> {
    let changes = p["changes"]
        .as_array()
        .ok_or_else(|| StoreError::Invalid("changes must be an array".into()))?;
    let before = arr(state, "items").clone();
    let mut updated_ids = Vec::with_capacity(changes.len());
    for change in changes {
        let item_id = required_string(change, "item_id")?;
        let old = before
            .iter()
            .find(|item| item["id"] == item_id)
            .cloned()
            .ok_or_else(|| StoreError::Invalid(format!("management item {item_id} not found")))?;
        let project_id = change["project_id"].as_str().map(str::to_owned);
        if let Some(project_id) = project_id.as_deref() {
            if !project_exists(state, project_id) {
                return Err(StoreError::Invalid(format!(
                    "management project {project_id} not found"
                )));
            }
        }
        let parent_id = change["parent_id"].as_str().map(str::to_owned);
        let status_id = required_string(change, "status_id")?;
        validate_status(state, project_id.as_deref(), status_id)?;
        if project_id != old["project_id"].as_str().map(str::to_owned)
            && arr(state, "status_history").iter().any(|entry| {
                entry["item_id"] == item_id
                    && (entry.get("workflow_owner_id").is_none()
                        || entry.get("from_workflow_owner_id").is_none())
            })
        {
            return Err(StoreError::Invalid(format!("item {item_id} cannot be transferred because historical workflow identity is missing")));
        }
        let row = arr_mut(state, "items")
            .iter_mut()
            .find(|item| item["id"] == item_id)
            .unwrap();
        row["project_id"] = project_id.clone().map_or(Value::Null, |value| json!(value));
        row["parent_id"] = parent_id.clone().map_or(Value::Null, |value| json!(value));
        row["status_id"] = json!(status_id);
        row["updated_at"] = json!(timestamp);
        updated_ids.push(item_id.to_owned());
        let old_status = old["status_id"].as_str().unwrap_or_default();
        let old_owner = old["project_id"].as_str();
        if old_status != status_id || old_owner != project_id.as_deref() {
            let from = status_record(state, old_owner, old_status);
            let to = status_record(state, project_id.as_deref(), status_id);
            arr_mut(state, "status_history").push(json!({"item_id":item_id,"workflow_owner_id":project_id,"from_workflow_owner_id":old_owner,"from_status_id":old_status,"from_status_label":from["label"],"from_status_category":from["category"],"to_status_id":status_id,"to_status_label":to["label"],"to_status_category":to["category"],"revision":revision,"changed_at":timestamp}));
        }
    }
    let items = arr(state, "items").clone();
    for item in &items {
        let item_id = item["id"]
            .as_str()
            .ok_or_else(|| StoreError::Invalid("item id missing".into()))?;
        let project_id = item["project_id"].as_str();
        validate_status(
            state,
            project_id,
            item["status_id"].as_str().unwrap_or_default(),
        )?;
        if let Some(parent_id) = item["parent_id"].as_str() {
            let parent = items
                .iter()
                .find(|candidate| candidate["id"] == parent_id)
                .ok_or_else(|| StoreError::Invalid(format!("parent item {parent_id} not found")))?;
            if parent["project_id"].as_str() != project_id {
                return Err(StoreError::Invalid(
                    "parent and child must belong to the same management project".into(),
                ));
            }
            let child_kind = ManagementItemKind::try_from(item["kind"].as_str().unwrap_or("task"))
                .map_err(|e| StoreError::Invalid(e.to_string()))?;
            let parent_kind =
                ManagementItemKind::try_from(parent["kind"].as_str().unwrap_or("task"))
                    .map_err(|e| StoreError::Invalid(e.to_string()))?;
            boreal_domain::global_manager::validate_item_parent(child_kind, Some(parent_kind))
                .map_err(|e| StoreError::Invalid(e.to_string()))?;
            let mut cursor = Some(parent_id.to_owned());
            let mut seen = std::collections::BTreeSet::new();
            while let Some(id) = cursor {
                if id == item_id {
                    return Err(StoreError::Invalid(
                        "item hierarchy cannot contain a cycle".into(),
                    ));
                }
                if !seen.insert(id.clone()) {
                    break;
                }
                cursor = items
                    .iter()
                    .find(|candidate| candidate["id"] == id)
                    .and_then(|candidate| candidate["parent_id"].as_str())
                    .map(str::to_owned);
            }
        }
    }
    for edge in arr(state, "relationships") {
        let source = items
            .iter()
            .find(|item| item["id"] == edge["source_id"])
            .ok_or_else(|| StoreError::Invalid("relationship source item missing".into()))?;
        let target = items
            .iter()
            .find(|item| item["id"] == edge["target_id"])
            .ok_or_else(|| StoreError::Invalid("relationship target item missing".into()))?;
        if source["project_id"] != target["project_id"] {
            return Err(StoreError::Invalid(
                "bulk triage would split a relationship; map both endpoints to one project".into(),
            ));
        }
    }
    let owners = items
        .iter()
        .map(|item| {
            (
                item["id"].as_str().unwrap_or_default().to_owned(),
                item["project_id"].clone(),
            )
        })
        .collect::<std::collections::HashMap<_, _>>();
    for edge in arr_mut(state, "relationships") {
        if let Some(owner) = owners.get(edge["source_id"].as_str().unwrap_or_default()) {
            edge["project_id"] = owner.clone();
        }
    }
    for link in arr(state, "note_links") {
        let note = arr(state, "notes")
            .iter()
            .find(|row| row["id"] == link["note_id"])
            .ok_or_else(|| StoreError::Invalid("note link note missing".into()))?;
        let item = items
            .iter()
            .find(|row| row["id"] == link["item_id"])
            .ok_or_else(|| StoreError::Invalid("note link item missing".into()))?;
        if note["project_id"] != item["project_id"] {
            return Err(StoreError::Invalid(
                "bulk triage would split a note link; keep linked records in one project".into(),
            ));
        }
    }
    let changed = updated_ids
        .into_iter()
        .filter_map(|id| items.iter().find(|item| item["id"] == id).cloned())
        .collect::<Vec<_>>();
    let mut result = json!({"changed":changed.len(),"items":changed,"item_id":changed.first().and_then(|item| item["id"].as_str()),"item_ids":changed.iter().filter_map(|item| item["id"].as_str()).collect::<Vec<_>>()});
    if let Some(first) = changed.first() {
        if changed
            .iter()
            .all(|item| item["project_id"] == first["project_id"])
        {
            result["project_id"] = first["project_id"].clone();
        }
    }
    Ok(result)
}

fn status_record(state: &Value, owner: Option<&str>, status_id: &str) -> Value {
    arr(state, "statuses")
        .iter()
        .find(|row| row["project_id"].as_str() == owner && row["status_id"] == status_id)
        .cloned()
        .unwrap_or(Value::Null)
}

fn validate_status(s: &Value, project: Option<&str>, status: &str) -> Result<(), StoreError> {
    if !arr(s, "statuses")
        .iter()
        .any(|r| r["status_id"] == status && r["project_id"].as_str() == project)
    {
        return Err(StoreError::Invalid(format!(
            "unknown workflow status {status} for project {:?}",
            project
        )));
    }
    Ok(())
}
fn status_for_category(
    s: &Value,
    project: Option<&str>,
    category: &str,
) -> Result<String, StoreError> {
    arr(s, "statuses")
        .iter()
        .find(|r| r["project_id"].as_str() == project && r["category"] == category)
        .and_then(|r| r["status_id"].as_str())
        .map(str::to_owned)
        .ok_or_else(|| {
            StoreError::Invalid(format!(
                "no workflow status has category {category:?} for project {project:?}"
            ))
        })
}

fn attention_summary(state: &Value) -> Value {
    let today = utc_today();
    let archived = arr(state, "projects")
        .iter()
        .filter(|p| p["archived"] == true)
        .filter_map(|p| p["id"].as_str())
        .collect::<std::collections::BTreeSet<_>>();
    let categories = arr(state, "statuses");
    let mut portfolio = [0_u64; 5];
    let mut projects = arr(state, "projects").iter().filter_map(|project| {
        let id = project["id"].as_str()?;
        Some((id.to_owned(), json!({"open":0,"waiting":0,"overdue":0,"unscheduled":0,"due_today":0,"next_action":null,"next_milestone":null})))
    }).collect::<serde_json::Map<_, _>>();
    for item in arr(state, "items") {
        if item["archived"] == true
            || item["project_id"]
                .as_str()
                .is_some_and(|id| archived.contains(id))
        {
            continue;
        }
        let owner = item["project_id"].as_str().unwrap_or("personal");
        let category = categories
            .iter()
            .find(|s| {
                s["project_id"].as_str() == item["project_id"].as_str()
                    && s["status_id"] == item["status_id"]
            })
            .and_then(|s| s["category"].as_str())
            .unwrap_or("open");
        if matches!(category, "completed" | "cancelled") {
            continue;
        }
        let due = item["due_at"].as_str().and_then(utc_date_from_iso);
        let counts = projects.entry(owner.to_owned()).or_insert_with(
            || json!({"open":0,"waiting":0,"overdue":0,"unscheduled":0,"due_today":0}),
        );
        let mut inc = |idx: usize, key: &str| {
            portfolio[idx] += 1;
            counts[key] = json!(counts[key].as_u64().unwrap_or(0) + 1);
        };
        inc(0, "open");
        if category == "waiting" {
            inc(1, "waiting");
        }
        match due.as_deref() {
            Some(d) if d < today.as_str() => inc(2, "overdue"),
            None => inc(3, "unscheduled"),
            Some(d) if d == today => inc(4, "due_today"),
            _ => {}
        }
    }
    for (project_id, summary) in projects.iter_mut() {
        if archived.contains(project_id.as_str()) {
            continue;
        }
        let mut active_items = arr(state, "items")
            .iter()
            .filter(|item| {
                item["project_id"] == project_id.as_str()
                    && item["archived"] != true
                    && !matches!(item_category(state, item), "completed" | "cancelled")
            })
            .collect::<Vec<_>>();
        let mut actions = active_items
            .iter()
            .copied()
            .filter(|item| {
                matches!(item["kind"].as_str(), Some("task" | "subtask"))
                    && matches!(item_category(state, item), "open" | "active")
            })
            .collect::<Vec<_>>();
        actions.sort_by(|left, right| {
            let due_key = |item: &Value| {
                item["due_at"]
                    .as_str()
                    .and_then(utc_date_from_iso)
                    .unwrap_or_else(|| "9999-99-99".into())
            };
            due_key(left)
                .cmp(&due_key(right))
                .then_with(|| {
                    right["priority"]
                        .as_u64()
                        .unwrap_or(0)
                        .cmp(&left["priority"].as_u64().unwrap_or(0))
                })
                .then_with(|| {
                    left["position"]
                        .as_i64()
                        .unwrap_or(0)
                        .cmp(&right["position"].as_i64().unwrap_or(0))
                })
                .then_with(|| left["id"].as_str().cmp(&right["id"].as_str()))
        });
        if let Some(item) = actions.first() {
            let status_id = item["status_id"].as_str().unwrap_or_default();
            let label = arr(state, "statuses")
                .iter()
                .find(|status| {
                    status["project_id"].as_str() == Some(project_id)
                        && status["status_id"] == status_id
                })
                .and_then(|status| status["label"].as_str())
                .unwrap_or(status_id);
            summary["next_action"] = json!({"item_id":item["id"],"title":bound_text(item["title"].as_str().unwrap_or_default(),160),"due_at":item["due_at"],"priority":item["priority"],"status_id":status_id,"status_label":label,"kind":item["kind"]});
        }
        let mut milestones = active_items
            .drain(..)
            .filter(|item| item["kind"] == "milestone")
            .collect::<Vec<_>>();
        milestones.sort_by(|left, right| {
            let due_key = |item: &Value| {
                item["due_at"]
                    .as_str()
                    .and_then(utc_date_from_iso)
                    .unwrap_or_else(|| "9999-99-99".into())
            };
            due_key(left)
                .cmp(&due_key(right))
                .then_with(|| {
                    left["position"]
                        .as_i64()
                        .unwrap_or(0)
                        .cmp(&right["position"].as_i64().unwrap_or(0))
                })
                .then_with(|| left["id"].as_str().cmp(&right["id"].as_str()))
        });
        if let Some(milestone) = milestones.first() {
            let children = arr(state, "items")
                .iter()
                .filter(|child| {
                    child["parent_id"] == milestone["id"]
                        && child["project_id"] == project_id.as_str()
                        && child["archived"] != true
                })
                .collect::<Vec<_>>();
            let completed = children
                .iter()
                .filter(|child| item_category(state, child) == "completed")
                .count();
            summary["next_milestone"] = json!({"item_id":milestone["id"],"title":bound_text(milestone["title"].as_str().unwrap_or_default(),160),"due_at":milestone["due_at"],"completed_children":completed,"total_children":children.len()});
        }
    }
    json!({"portfolio":{"open":portfolio[0],"waiting":portfolio[1],"overdue":portfolio[2],"unscheduled":portfolio[3],"due_today":portfolio[4]},"projects":projects})
}

fn item_category<'a>(state: &'a Value, item: &Value) -> &'a str {
    arr(state, "statuses")
        .iter()
        .find(|status| {
            status["project_id"] == item["project_id"] && status["status_id"] == item["status_id"]
        })
        .and_then(|status| status["category"].as_str())
        .unwrap_or("open")
}

fn detail_row_matches_query(state: &Value, collection: &str, row: &Value, query: &str) -> bool {
    let mut searchable = Vec::<String>::new();
    let mut add = |value: &Value| match value {
        Value::String(text) => searchable.push(text.to_lowercase()),
        Value::Array(values) => searchable.extend(
            values
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_lowercase),
        ),
        _ => {}
    };
    for field in [
        "title",
        "name",
        "body",
        "description",
        "status_id",
        "label",
        "category",
        "kind",
        "path",
        "identity",
        "lifecycle",
        "health",
        "summary",
        "source_id",
        "target_id",
        "due_at",
        "follow_up_at",
        "from_status_label",
        "from_status_id",
        "from_status_category",
        "to_status_label",
        "to_status_id",
        "to_status_category",
    ] {
        if let Some(value) = row.get(field) {
            add(value);
        }
    }
    if let Some(labels) = row.get("labels") {
        add(labels);
    }
    if collection == "items" {
        if let (Some(owner), Some(status_id)) = (
            row.get("project_id").and_then(Value::as_str),
            row.get("status_id").and_then(Value::as_str),
        ) {
            if let Some(status) = arr(state, "statuses").iter().find(|status| {
                status["project_id"].as_str() == Some(owner)
                    && status["status_id"].as_str() == Some(status_id)
            }) {
                add(&status["label"]);
                add(&status["category"]);
            }
        }
    }
    let owners = [
        row.get("project_id").and_then(Value::as_str),
        row.get("workflow_owner_id").and_then(Value::as_str),
        row.get("from_workflow_owner_id").and_then(Value::as_str),
        row.get("management_project_id").and_then(Value::as_str),
    ];
    for owner in owners.into_iter().flatten() {
        if let Some(project) = arr(state, "projects")
            .iter()
            .find(|project| project["id"].as_str() == Some(owner))
        {
            for field in ["name", "lifecycle", "health"] {
                add(&project[field]);
            }
            add(&project["labels"]);
        }
    }
    searchable.iter().any(|text| text.contains(query))
}

fn bound_summary_text(value: &mut Value, maximum_bytes: usize) {
    match value {
        Value::Array(rows) => {
            rows.truncate(200);
            for row in rows {
                if let Some(text) = row.as_str() {
                    *row = json!(bound_text(text, maximum_bytes.min(128)));
                } else {
                    bound_summary_text(row, maximum_bytes);
                }
            }
        }
        Value::Object(fields) => {
            let essential = [
                "id",
                "project_id",
                "parent_id",
                "item_id",
                "note_id",
                "source_id",
                "target_id",
                "workflow_owner_id",
                "from_workflow_owner_id",
                "status_id",
                "from_status_id",
                "to_status_id",
                "operation_id",
                "path",
                "identity",
            ];
            let mut keys = fields.keys().cloned().collect::<Vec<_>>();
            for key in &keys {
                if key.len() > 128 && !essential.contains(&key.as_str()) {
                    fields.remove(key);
                }
            }
            keys = fields.keys().cloned().collect();
            while keys.len() > 64 {
                let removable = keys
                    .iter()
                    .rev()
                    .find(|key| !essential.contains(&key.as_str()))
                    .cloned()
                    .or_else(|| keys.last().cloned());
                let Some(key) = removable else { break };
                fields.remove(&key);
                keys.retain(|candidate| candidate != &key);
            }
            for (key, field) in fields.iter_mut() {
                if key == "labels" {
                    if let Value::Array(labels) = field {
                        labels.truncate(32);
                        for label in labels {
                            if let Some(text) = label.as_str() {
                                *label = json!(bound_text(text, maximum_bytes.min(128)));
                            }
                        }
                    }
                } else if let Some(text) = field.as_str() {
                    if !essential.contains(&key.as_str()) {
                        *field = json!(bound_text(text, maximum_bytes.min(256)));
                    }
                } else if field.is_array() || field.is_object() {
                    bound_summary_text(field, maximum_bytes);
                }
            }
        }
        _ => {}
    }
}

fn bound_text(value: &str, maximum_bytes: usize) -> String {
    if value.len() <= maximum_bytes {
        return value.to_owned();
    }
    let mut end = maximum_bytes.saturating_sub(3);
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", &value[..end])
}

fn utc_today() -> String {
    let days = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
        / 86_400;
    civil_from_days(days)
}

fn utc_date_from_iso(value: &str) -> Option<String> {
    if value.len() < 10
        || value.as_bytes().get(4) != Some(&b'-')
        || value.as_bytes().get(7) != Some(&b'-')
    {
        return None;
    }
    let year = value.get(0..4)?.parse::<i64>().ok()?;
    let month = value.get(5..7)?.parse::<i64>().ok()?;
    let day = value.get(8..10)?.parse::<i64>().ok()?;
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let days = days_from_civil(year, month, day);
    if civil_from_days(days) != format!("{year:04}-{month:02}-{day:02}") {
        return None;
    }
    if value.len() == 10 {
        return Some(value.to_owned());
    }
    if value.as_bytes().get(10) != Some(&b'T') {
        return None;
    }
    let rest = &value[11..];
    let (time, offset_seconds) = if let Some(time) = rest.strip_suffix('Z') {
        (time, 0_i64)
    } else {
        let split = rest
            .char_indices()
            .skip(1)
            .find(|(_, ch)| *ch == '+' || *ch == '-')?
            .0;
        let (time, offset) = rest.split_at(split);
        if offset.len() != 6 || offset.as_bytes().get(3) != Some(&b':') {
            return None;
        }
        let hours = offset.get(1..3)?.parse::<i64>().ok()?;
        let minutes = offset.get(4..6)?.parse::<i64>().ok()?;
        if hours > 23 || minutes > 59 {
            return None;
        }
        let amount = hours * 3600 + minutes * 60;
        (
            time,
            if offset.starts_with('-') {
                -amount
            } else {
                amount
            },
        )
    };
    let clock = time.split('.').next()?;
    let mut parts = clock.split(':');
    let hour = parts.next()?.parse::<i64>().ok()?;
    let minute = parts.next()?.parse::<i64>().ok()?;
    let second = parts.next()?.parse::<i64>().ok()?;
    if parts.next().is_some() || hour > 23 || minute > 59 || second > 59 {
        return None;
    }
    let utc_seconds = days * 86_400 + hour * 3600 + minute * 60 + second - offset_seconds;
    Some(civil_from_days(utc_seconds.div_euclid(86_400)))
}

fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = year - i64::from(month <= 2);
    let era = year.div_euclid(400);
    let yoe = year - era * 400;
    let mp = month + if month > 2 { -3 } else { 9 };
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn civil_from_days(days: i64) -> String {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let mut year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    year += i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}")
}

fn validate_import_history(
    snapshot: &Value,
    depth: usize,
    entry_count: &mut usize,
) -> Result<(), StoreError> {
    if depth > 8 {
        return Err(StoreError::Invalid(
            "global backup revision history exceeds the maximum nesting depth of 8".into(),
        ));
    }
    let error = |message: &str| StoreError::Invalid(format!("invalid global backup: {message}"));
    for key in ["revision_history", "imported_history"] {
        if snapshot.get(key).is_some_and(|value| !value.is_array()) {
            return Err(error("nested revision history must be arrays"));
        }
        for entry in snapshot
            .get(key)
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            *entry_count = entry_count.saturating_add(1);
            if *entry_count > 10_000 {
                return Err(StoreError::Invalid(
                    "global backup contains more than 10000 revision history entries".into(),
                ));
            }
            if key == "revision_history" && !entry.get("revision").and_then(Value::as_u64).is_some()
            {
                return Err(error("invalid global revision history entry"));
            }
            let child = entry
                .get("snapshot")
                .filter(|value| value.is_object())
                .ok_or_else(|| error("revision history snapshot must be an object"))?;
            validate_import_snapshot(child)?;
            validate_import_history(child, depth + 1, entry_count)?;
        }
    }
    Ok(())
}

fn validate_import_snapshot(snapshot: &Value) -> Result<(), StoreError> {
    let error = |message: &str| StoreError::Invalid(format!("invalid global backup: {message}"));
    for key in [
        "projects",
        "items",
        "notes",
        "statuses",
        "relationships",
        "associations",
        "status_history",
    ] {
        if !snapshot.get(key).is_some_and(Value::is_array) {
            return Err(error(&format!("{key} must be an array")));
        }
    }
    let projects = arr(snapshot, "projects");
    let mut project_ids = std::collections::BTreeSet::new();
    for project in projects {
        let id = project["id"]
            .as_str()
            .filter(|v| !v.trim().is_empty())
            .ok_or_else(|| error("project id missing"))?;
        if !project_ids.insert(id.to_owned()) {
            return Err(error("duplicate project id"));
        }
        boreal_domain::global_manager::validate_identifier(id)
            .map_err(|_| error("invalid project id"))?;
        if project["name"].as_str().is_none_or(|v| v.trim().is_empty()) {
            return Err(error("project name missing"));
        }
        validate_labels(&project["labels"])?;
        if !["planned", "active", "on_hold", "completed", "cancelled"]
            .contains(&project["lifecycle"].as_str().unwrap_or(""))
        {
            return Err(error("invalid project lifecycle"));
        }
        if !["unknown", "on_track", "at_risk", "blocked", "healthy"]
            .contains(&project["health"].as_str().unwrap_or(""))
        {
            return Err(error("invalid project health"));
        }
        if project["priority"].as_u64().is_some_and(|v| v > 255) {
            return Err(error("project priority exceeds 255"));
        }
    }
    let statuses = arr(snapshot, "statuses");
    let mut status_ids = std::collections::BTreeSet::new();
    for status in statuses {
        let sid = status["status_id"]
            .as_str()
            .ok_or_else(|| error("workflow status id missing"))?;
        boreal_domain::global_manager::validate_identifier(sid)
            .map_err(|_| error("invalid workflow status id"))?;
        let owner = status["project_id"].as_str().map(str::to_owned);
        if owner.as_ref().is_some_and(|id| !project_ids.contains(id)) {
            return Err(error("workflow owner project missing"));
        }
        StatusCategory::try_from(
            status["category"]
                .as_str()
                .ok_or_else(|| error("workflow category missing"))?,
        )
        .map_err(|_| error("unknown workflow category"))?;
        if status["label"].as_str().is_none_or(|v| v.trim().is_empty()) {
            return Err(error("workflow status label missing"));
        }
        if !status_ids.insert((owner, sid.to_owned())) {
            return Err(error("duplicate workflow status id"));
        }
    }
    let items = arr(snapshot, "items");
    let mut items_by_id = std::collections::BTreeMap::new();
    for item in items {
        let id = item["id"]
            .as_str()
            .filter(|v| !v.trim().is_empty())
            .ok_or_else(|| error("item id missing"))?;
        boreal_domain::global_manager::validate_identifier(id)
            .map_err(|_| error("invalid item id"))?;
        if items_by_id.insert(id.to_owned(), item).is_some() {
            return Err(error("duplicate item id"));
        }
        let owner = item["project_id"].as_str().map(str::to_owned);
        if owner.as_ref().is_some_and(|id| !project_ids.contains(id)) {
            return Err(error("item owner project missing"));
        }
        let status = item["status_id"]
            .as_str()
            .ok_or_else(|| error("item status missing"))?;
        if !status_ids.contains(&(owner.clone(), status.to_owned())) {
            return Err(error("item workflow status missing"));
        }
        let kind = ManagementItemKind::try_from(
            item["kind"]
                .as_str()
                .ok_or_else(|| error("item kind missing"))?,
        )
        .map_err(|_| error("unknown item kind"))?;
        if item["title"].as_str().is_none_or(|v| v.trim().is_empty()) {
            return Err(error("item title missing"));
        }
        validate_labels(&item["labels"])?;
        if item["priority"].as_u64().is_some_and(|v| v > 255) {
            return Err(error("item priority exceeds 255"));
        }
        for field in ["due_at", "follow_up_at"] {
            if item
                .get(field)
                .is_some_and(|value| !value.is_null() && value.as_str().is_none())
            {
                return Err(error("item dates must be strings or null"));
            }
            if item
                .get(field)
                .and_then(Value::as_str)
                .is_some_and(|value| value.len() > 128 || utc_date_from_iso(value).is_none())
            {
                return Err(error("item date is not a bounded ISO date or timestamp"));
            }
        }
        if kind == ManagementItemKind::Subtask && item["parent_id"].as_str().is_none() {
            return Err(error("subtask parent missing"));
        }
    }
    for item in items {
        let kind = ManagementItemKind::try_from(item["kind"].as_str().unwrap_or(""))
            .map_err(|_| error("unknown item kind"))?;
        let parent_id = item["parent_id"].as_str();
        let parent = if let Some(parent_id) = parent_id {
            let parent = items_by_id
                .get(parent_id)
                .ok_or_else(|| error("item parent missing"))?;
            if parent["project_id"].as_str() != item["project_id"].as_str() {
                return Err(error("parent belongs to another project"));
            }
            Some(
                ManagementItemKind::try_from(parent["kind"].as_str().unwrap_or(""))
                    .map_err(|_| error("unknown parent kind"))?,
            )
        } else {
            None
        };
        boreal_domain::global_manager::validate_item_parent(kind, parent)
            .map_err(|_| error("invalid parent/child kind"))?;
        let mut cursor = parent_id;
        let mut seen = std::collections::BTreeSet::new();
        while let Some(id) = cursor {
            if id == item["id"].as_str().unwrap_or("") {
                return Err(error("item hierarchy contains a cycle"));
            }
            if !seen.insert(id) {
                break;
            }
            cursor = items_by_id.get(id).and_then(|r| r["parent_id"].as_str());
        }
    }
    let notes = arr(snapshot, "notes");
    let mut note_ids = std::collections::BTreeSet::new();
    for note in notes {
        let id = note["id"]
            .as_str()
            .filter(|v| !v.trim().is_empty())
            .ok_or_else(|| error("note id missing"))?;
        boreal_domain::global_manager::validate_identifier(id)
            .map_err(|_| error("invalid note id"))?;
        if !note_ids.insert(id) {
            return Err(error("duplicate note id"));
        }
        if note["project_id"]
            .as_str()
            .is_some_and(|id| !project_ids.contains(id))
        {
            return Err(error("note owner project missing"));
        }
        if note["title"].as_str().is_none_or(|v| v.trim().is_empty()) {
            return Err(error("note title missing"));
        }
    }
    if snapshot
        .get("note_links")
        .is_some_and(|value| !value.is_array())
    {
        return Err(error("note_links must be an array"));
    }
    let mut note_link_keys = std::collections::BTreeSet::new();
    for link in snapshot
        .get("note_links")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let note_id = link["note_id"]
            .as_str()
            .ok_or_else(|| error("note link note_id missing"))?;
        let item_id = link["item_id"]
            .as_str()
            .ok_or_else(|| error("note link item_id missing"))?;
        let note = notes
            .iter()
            .find(|row| row["id"] == note_id)
            .ok_or_else(|| error("note link note missing"))?;
        let item = items_by_id
            .get(item_id)
            .ok_or_else(|| error("note link item missing"))?;
        if note["project_id"] != item["project_id"] {
            return Err(error("note link crosses management projects"));
        }
        if !note_link_keys.insert((note_id.to_owned(), item_id.to_owned())) {
            return Err(error("duplicate note link"));
        }
    }
    for association in arr(snapshot, "associations") {
        if association["project_id"]
            .as_str()
            .is_none_or(|id| !project_ids.contains(id))
        {
            return Err(error("association project missing"));
        }
        if !["folder", "workspace"].contains(&association["kind"].as_str().unwrap_or("")) {
            return Err(error("invalid association kind"));
        }
        if association["identity"]
            .as_str()
            .is_none_or(|v| v.trim().is_empty())
        {
            return Err(error("association identity missing"));
        }
        let identity = association["identity"].as_str().unwrap_or_default();
        let kind = association["kind"].as_str().unwrap_or_default();
        if identity.len() > GLOBAL_PATH_MAX_BYTES {
            return Err(error(&format!(
                "association identity exceeds the {GLOBAL_PATH_MAX_BYTES}-byte limit"
            )));
        }
        if kind == "workspace"
            && boreal_domain::global_manager::validate_identifier(identity).is_err()
        {
            return Err(error("workspace association identity is invalid"));
        }
        if association
            .get("path")
            .is_some_and(|v| !v.is_null() && v.as_str().is_none())
        {
            return Err(error("association path must be a string or null"));
        }
        if association["path"]
            .as_str()
            .is_some_and(|path| path.len() > GLOBAL_PATH_MAX_BYTES)
        {
            return Err(error(&format!(
                "association path exceeds the {GLOBAL_PATH_MAX_BYTES}-byte limit"
            )));
        }
    }
    let mut dependency_edges = Vec::new();
    for relationship in arr(snapshot, "relationships") {
        let source = relationship["source_id"]
            .as_str()
            .ok_or_else(|| error("relationship source missing"))?;
        let target = relationship["target_id"]
            .as_str()
            .ok_or_else(|| error("relationship target missing"))?;
        let left = items_by_id
            .get(source)
            .ok_or_else(|| error("relationship source item missing"))?;
        let right = items_by_id
            .get(target)
            .ok_or_else(|| error("relationship target item missing"))?;
        if left["project_id"] != right["project_id"] {
            return Err(error("relationship crosses management projects"));
        }
        match relationship["kind"].as_str().unwrap_or("") {
            "depends_on" | "blocks" => dependency_edges.push(
                dependency_edge(source, target, relationship["kind"].as_str().unwrap()).unwrap(),
            ),
            "related" => {}
            _ => return Err(error("unknown relationship kind")),
        }
    }
    boreal_domain::global_manager::validate_dependency_graph(&dependency_edges)
        .map_err(|_| error("dependency cycle"))?;
    for transition in arr(snapshot, "status_history") {
        if transition["item_id"]
            .as_str()
            .is_none_or(|id| !items_by_id.contains_key(id))
        {
            return Err(error("status history item missing"));
        }
        let item = items_by_id[transition["item_id"].as_str().unwrap()];
        let validate_owner = |field: &str| -> Result<Option<Option<String>>, StoreError> {
            let Some(value) = transition.get(field) else {
                return Ok(None);
            };
            if value.is_null() {
                return Ok(Some(None));
            }
            let owner = value
                .as_str()
                .ok_or_else(|| error("status history workflow owner must be a string or null"))?;
            boreal_domain::global_manager::validate_identifier(owner)
                .map_err(|_| error("invalid status history workflow owner"))?;
            Ok(Some(Some(owner.to_owned())))
        };
        let to_owner_field = validate_owner("workflow_owner_id")?;
        let from_owner_field = validate_owner("from_workflow_owner_id")?;
        let current_owner = item["project_id"].as_str().map(str::to_owned);
        let to_owner = to_owner_field
            .clone()
            .unwrap_or_else(|| current_owner.clone());
        let from_owner = from_owner_field.clone().unwrap_or_else(|| to_owner.clone());
        let validate_side = |prefix: &str,
                             nullable: bool,
                             owner: &Option<String>,
                             has_owner_metadata: bool|
         -> Result<(), StoreError> {
            let id_key = format!("{prefix}_status_id");
            let label_key = format!("{prefix}_status_label");
            let category_key = format!("{prefix}_status_category");
            let id = transition.get(&id_key).and_then(Value::as_str);
            if nullable && id.is_none() {
                if transition
                    .get(&id_key)
                    .is_some_and(|value| !value.is_null())
                    || transition
                        .get(&label_key)
                        .is_some_and(|value| !value.is_null())
                    || transition
                        .get(&category_key)
                        .is_some_and(|value| !value.is_null())
                {
                    return Err(error("incomplete null status history side"));
                }
                return Ok(());
            }
            let id = id.ok_or_else(|| error("status history status id missing"))?;
            boreal_domain::global_manager::validate_identifier(id)
                .map_err(|_| error("invalid status history status id"))?;
            let registered = status_ids.contains(&(owner.clone(), id.to_owned()));
            let source_owner_missing = prefix == "from"
                && !has_owner_metadata
                && transition.get("workflow_owner_id").is_some();
            let historical = has_owner_metadata || !registered || source_owner_missing;
            if historical {
                let label = transition.get(&label_key).and_then(Value::as_str);
                let category = transition.get(&category_key).and_then(Value::as_str);
                if !label.is_some_and(|value| !value.trim().is_empty())
                    || category.is_none_or(|value| StatusCategory::try_from(value).is_err())
                {
                    return Err(error("status history side lacks valid label/category"));
                }
            }
            Ok(())
        };
        validate_side("from", true, &from_owner, from_owner_field.is_some())?;
        validate_side("to", false, &to_owner, to_owner_field.is_some())?;
    }
    Ok(())
}

/// Convert user-facing relationship direction to prerequisite → dependent.
/// “A blocks B” and “B depends on A” therefore describe the same edge.
fn dependency_edge(source: &str, target: &str, kind: &str) -> Option<(String, String)> {
    match kind {
        "blocks" => Some((source.to_owned(), target.to_owned())),
        "depends_on" => Some((target.to_owned(), source.to_owned())),
        _ => None,
    }
}

fn validate_labels(labels: &Value) -> Result<(), StoreError> {
    if !labels.is_array()
        || labels.as_array().is_some_and(|values| {
            values
                .iter()
                .any(|v| v.as_str().is_none_or(|s| s.trim().is_empty()))
        })
    {
        return Err(StoreError::Invalid(
            "labels must be an array of non-empty strings".into(),
        ));
    }
    Ok(())
}
fn filter_project_list(rows: &Value, p: &Value) -> Value {
    let pid = p.get("project_id").and_then(Value::as_str);
    let include = p
        .get("include_archived")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    Value::Array(
        rows.as_array()
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter(|r| {
                pid.is_none_or(|v| r["project_id"] == v || r["id"] == v)
                    && (include || r["archived"] != true)
            })
            .collect(),
    )
}
fn filter_item_list(rows: &Value, p: &Value, command: &str) -> Value {
    let mut result = filter_project_list(rows, p);
    if let Some(a) = result.as_array_mut() {
        a.retain(|r| match command {
            "task list" => r["kind"] == "task" || r["kind"] == "subtask",
            "milestone list" => r["kind"] == "milestone",
            _ => true,
        });
        a.sort_by_key(|r| r["position"].as_i64().unwrap_or(0));
    }
    result
}
fn filtered_statuses(rows: &Value, p: &Value) -> Value {
    let pid = p.get("project_id").and_then(Value::as_str);
    Value::Array(
        rows.as_array()
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter(|r| pid.is_none_or(|v| r["project_id"] == v))
            .collect(),
    )
}
fn one_from(s: &Value, array: &str, key: &str, value: &str) -> Result<Value, StoreError> {
    arr(s, array)
        .iter()
        .find(|r| r[key] == value)
        .cloned()
        .map(Ok)
        .unwrap_or_else(|| {
            Err(StoreError::Invalid(format!(
                "{} not found",
                array.trim_end_matches('s')
            )))
        })
}

fn compact_item_link(state: &Value, item: &Value) -> Value {
    let owner = item["project_id"].as_str();
    let status_id = item["status_id"].as_str().unwrap_or_default();
    let status_label = arr(state, "statuses")
        .iter()
        .find(|status| status["project_id"].as_str() == owner && status["status_id"] == status_id)
        .and_then(|status| status["label"].as_str())
        .unwrap_or(status_id);
    json!({"id":item["id"],"project_id":item["project_id"],"parent_id":item["parent_id"],"kind":item["kind"],"title":bound_text(item["title"].as_str().unwrap_or_default(),160),"status_id":status_id,"status_label":status_label,"priority":item["priority"],"due_at":item["due_at"],"follow_up_at":item["follow_up_at"],"archived":item["archived"]})
}

fn compact_note_link(note: &Value) -> Value {
    json!({"id":note["id"],"project_id":note["project_id"],"title":bound_text(note["title"].as_str().unwrap_or_default(),160),"archived":note["archived"],"updated_at":note["updated_at"]})
}

#[cfg(test)]
mod global_date_tests {
    use super::utc_date_from_iso;

    #[test]
    fn date_only_is_stable_and_instants_cross_utc_midnight_by_offset() {
        assert_eq!(utc_date_from_iso("2026-01-02"), Some("2026-01-02".into()));
        assert_eq!(
            utc_date_from_iso("2026-01-02T00:30:00+01:00"),
            Some("2026-01-01".into())
        );
        assert_eq!(
            utc_date_from_iso("2026-01-01T23:30:00-01:00"),
            Some("2026-01-02".into())
        );
        assert_eq!(utc_date_from_iso("2026-02-30"), None);
        assert_eq!(utc_date_from_iso("2026-01-02T00:30:00"), None);
    }
}
