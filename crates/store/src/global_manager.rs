//! Independent installation-wide global-manager persistence.
//!
//! A single serialized state row keeps this extension's unrelated record
//! families in one atomic revision boundary. Operation receipts and audit
//! events are separate append-only tables and commit with each state update.

use super::{SQLITE_ROW, SqliteStore, StoreError};
use serde_json::{Value, json};
use std::path::Path;
const GLOBAL_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS global_manager_state (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  state_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS global_operation (
  operation_id TEXT PRIMARY KEY,
  request_digest TEXT NOT NULL,
  revision INTEGER NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS global_revision_snapshot (
  revision INTEGER PRIMARY KEY,
  state_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS global_audit (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  revision INTEGER NOT NULL UNIQUE,
  operation_id TEXT NOT NULL,
  command TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  before_digest TEXT NOT NULL,
  after_digest TEXT NOT NULL,
  created_at TEXT NOT NULL
);
"#;

const EMPTY_STATE: &str = r#"{"projects":[],"items":[],"notes":[],"statuses":[{"project_id":null,"status_id":"todo","label":"To do","category":"open","position":0},{"project_id":null,"status_id":"doing","label":"Doing","category":"active","position":1},{"project_id":null,"status_id":"waiting","label":"Waiting","category":"waiting","position":2},{"project_id":null,"status_id":"blocked","label":"Blocked","category":"blocked","position":3},{"project_id":null,"status_id":"done","label":"Done","category":"completed","position":4},{"project_id":null,"status_id":"cancelled","label":"Cancelled","category":"cancelled","position":5}],"relationships":[],"associations":[],"status_history":[],"imported_history":[]}"#;

/// A connection to the separate installation-wide SQLite database.
pub struct GlobalManagerStore {
    inner: SqliteStore,
}

#[derive(Clone, Debug, PartialEq)]
pub struct GlobalAuditRecord {
    pub operation_id: String,
    pub revision: u64,
    pub command: String,
    pub created_at: String,
    pub request_digest: String,
    pub result: Value,
}

impl GlobalManagerStore {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, StoreError> {
        let path: std::path::PathBuf = path.as_ref().to_path_buf();
        let started = std::time::Instant::now();
        loop {
            match Self::open_once(&path) {
                Ok(store) => return Ok(store),
                Err(StoreError::Busy(_))
                    if started.elapsed() < std::time::Duration::from_secs(5) =>
                {
                    std::thread::sleep(std::time::Duration::from_millis(25))
                }
                Err(error) => return Err(error),
            }
        }
    }

    fn open_once(path: impl AsRef<Path>) -> Result<Self, StoreError> {
        let path: std::path::PathBuf = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                StoreError::Unavailable(format!("cannot create global data directory: {e}"))
            })?;
        }
        let inner = open_connection_with_retry(&path)?;
        let mut objects = inner.prepare(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
        )?;
        if objects.step()? != SQLITE_ROW {
            return Err(StoreError::Corrupt(
                "global schema inspection returned no row".into(),
            ));
        }
        let count = objects.column_i64(0)?;
        drop(objects);
        if count == 0 {
            inner.execute_batch("BEGIN IMMEDIATE")?;
            let mut now_has_objects = inner.prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")?;
            now_has_objects.step()?;
            let appeared = now_has_objects.column_i64(0)? > 0;
            drop(now_has_objects);
            if appeared {
                inner.execute_batch("ROLLBACK")?;
                return Self::open(path);
            }
            let setup = (|| {
                inner.execute_batch("CREATE TABLE global_schema(singleton INTEGER PRIMARY KEY CHECK(singleton=1),schema_id TEXT NOT NULL,schema_version INTEGER NOT NULL,database_id TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0);")?;
                inner.execute_batch(GLOBAL_SCHEMA)?;
                let mut q = inner.prepare("INSERT INTO global_schema VALUES(1,'boreal.global',2,lower(hex(randomblob(16))),0)")?;
                q.run()?;
                let mut q = inner.prepare("INSERT INTO global_manager_state VALUES(1,?1)")?;
                q.bind_text(1, EMPTY_STATE)?;
                q.run()?;
                let mut q =
                    inner.prepare("INSERT INTO global_revision_snapshot VALUES(0,?1,?2)")?;
                q.bind_text(1, EMPTY_STATE)?;
                q.bind_text(2, &now())?;
                q.run()?;
                Ok::<_, StoreError>(())
            })();
            match setup {
                Ok(()) => inner.execute_batch("COMMIT")?,
                Err(e) => {
                    let _ = inner.execute_batch("ROLLBACK");
                    return Err(e);
                }
            }
        } else {
            let mut identity = inner
                .prepare("SELECT schema_id,schema_version FROM global_schema WHERE singleton=1")?;
            if identity.step()? != SQLITE_ROW {
                return Err(StoreError::Invalid(
                    "database is not a supported Boreal global database; it was left unchanged"
                        .into(),
                ));
            }
            let schema_id = identity.column_text(0)?;
            let version = identity.column_i64(1)?;
            drop(identity);
            if schema_id != "boreal.global" || version > 2 || version < 1 {
                return Err(StoreError::Invalid(
                    "database is not a supported Boreal global database; it was left unchanged"
                        .into(),
                ));
            }
            inner.execute_batch("BEGIN IMMEDIATE")?;
            let setup = (|| {
                inner.execute_batch(GLOBAL_SCHEMA)?;
                let mut exists = inner.prepare("SELECT COUNT(*) FROM global_manager_state")?;
                exists.step()?;
                let state_exists = exists.column_i64(0)? != 0;
                drop(exists);
                if !state_exists {
                    let legacy = migrate_legacy_state(&inner)?;
                    let encoded = serde_json::to_string(&legacy)
                        .map_err(|e| StoreError::Corrupt(e.to_string()))?;
                    let mut insert =
                        inner.prepare("INSERT INTO global_manager_state VALUES(1,?1)")?;
                    insert.bind_text(1, &encoded)?;
                    insert.run()?;
                }
                let mut current=inner.prepare("SELECT revision,state_json FROM global_schema CROSS JOIN global_manager_state WHERE global_schema.singleton=1 AND global_manager_state.singleton=1")?;
                current.step()?;
                let current_revision = current.column_u64(0)?;
                let current_state = current.column_text(1)?;
                drop(current);
                let mut history = inner
                    .prepare("INSERT OR IGNORE INTO global_revision_snapshot VALUES(?1,?2,?3)")?;
                history.bind_i64(1, current_revision)?;
                history.bind_text(2, &current_state)?;
                history.bind_text(3, &now())?;
                history.run()?;
                let mut version_update =
                    inner.prepare("UPDATE global_schema SET schema_version=2 WHERE singleton=1")?;
                version_update.run()?;
                Ok::<_, StoreError>(())
            })();
            match setup {
                Ok(()) => inner.execute_batch("COMMIT")?,
                Err(e) => {
                    let _ = inner.execute_batch("ROLLBACK");
                    return Err(e);
                }
            }
        }
        Ok(Self { inner })
    }

    pub fn revision(&self) -> Result<u64, StoreError> {
        self.scalar("SELECT revision FROM global_schema WHERE singleton=1")
    }

    /// Reads the serialized global snapshot. Decoding and selecting application
    /// views belongs to the application layer.
    pub fn state(&self) -> Result<Value, StoreError> {
        self.load_state()
    }

    /// Returns state and revision from one SQLite statement snapshot.
    pub fn snapshot(&self) -> Result<(Value, u64), StoreError> {
        let mut q = self.inner.prepare("SELECT s.state_json,g.revision FROM global_manager_state s CROSS JOIN global_schema g WHERE s.singleton=1 AND g.singleton=1")?;
        if q.step()? != SQLITE_ROW {
            return Err(StoreError::Corrupt(
                "global snapshot rows are missing".into(),
            ));
        }
        let state = serde_json::from_str(&q.column_text(0)?)
            .map_err(|e| StoreError::Corrupt(e.to_string()))?;
        let revision = q.column_u64(1)?;
        Ok((state, revision))
    }

    pub fn revision_history(&self) -> Result<Vec<Value>, StoreError> {
        let mut q = self.inner.prepare(
            "SELECT revision,state_json,created_at FROM global_revision_snapshot ORDER BY revision",
        )?;
        let mut history = Vec::new();
        while q.step()? == SQLITE_ROW {
            let state = serde_json::from_str::<Value>(&q.column_text(1)?)
                .map_err(|e| StoreError::Corrupt(e.to_string()))?;
            history.push(json!({"revision":q.column_u64(0)?,"snapshot":state,"created_at":q.column_text(2)?}));
        }
        Ok(history)
    }

    pub fn export_bundle(&self) -> Result<(Value, u64, Vec<Value>), StoreError> {
        self.inner.execute_batch("BEGIN")?;
        let bundle = (|| {
            let (state, revision) = self.snapshot()?;
            let history = self.revision_history()?;
            Ok((state, revision, history))
        })();
        match bundle {
            Ok(value) => {
                self.inner.execute_batch("COMMIT")?;
                Ok(value)
            }
            Err(error) => {
                let _ = self.inner.execute_batch("ROLLBACK");
                Err(error)
            }
        }
    }

    pub fn operation_result(&self, operation_id: &str) -> Result<Option<Value>, StoreError> {
        let mut q=self.inner.prepare("SELECT request_digest,revision,result_json,created_at FROM global_operation WHERE operation_id=?1")?;
        q.bind_text(1, operation_id)?;
        if q.step()? != SQLITE_ROW {
            return Ok(None);
        }
        let result = serde_json::from_str::<Value>(&q.column_text(2)?)
            .map_err(|e| StoreError::Corrupt(e.to_string()))?;
        Ok(Some(
            json!({"operation_id":operation_id,"request_digest":q.column_text(0)?,"revision":q.column_u64(1)?,"result":result,"created_at":q.column_text(3)?}),
        ))
    }

    /// Returns a bounded page of committed operations with their result
    /// payloads. Full revision snapshots remain available only through the
    /// explicit backup/export bundle.
    pub fn activity(
        &self,
        project_id: Option<&str>,
        entity_id: Option<&str>,
        limit: u64,
        offset: u64,
    ) -> Result<(Vec<GlobalAuditRecord>, u64), StoreError> {
        if !(1..=200).contains(&limit) {
            return Err(StoreError::Invalid(
                "global activity limit must be from 1 to 200".into(),
            ));
        }
        let filters = " WHERE (?1 IS NULL OR COALESCE(json_extract(o.result_json,'$.project_id'),json_extract(o.result_json,'$.id'))=?1) AND (?2 IS NULL OR COALESCE(json_extract(o.result_json,'$.id'),json_extract(o.result_json,'$.item_id'),json_extract(o.result_json,'$.note_id'),json_extract(o.result_json,'$.source_id'),json_extract(o.result_json,'$.target_id'))=?2)";
        let mut count = self.inner.prepare(&format!(
            "SELECT COUNT(*) FROM global_audit a JOIN global_operation o USING(operation_id){filters}"
        ))?;
        count.bind_optional_text(1, project_id)?;
        count.bind_optional_text(2, entity_id)?;
        if count.step()? != SQLITE_ROW {
            return Err(StoreError::Corrupt(
                "global activity count returned no row".into(),
            ));
        }
        let total = count.column_u64(0)?;
        drop(count);
        let mut rows = self.inner.prepare(&format!(
            "SELECT a.operation_id,a.revision,a.command,a.created_at,o.request_digest,o.result_json FROM global_audit a JOIN global_operation o USING(operation_id){filters} ORDER BY a.revision DESC LIMIT ?3 OFFSET ?4"
        ))?;
        rows.bind_optional_text(1, project_id)?;
        rows.bind_optional_text(2, entity_id)?;
        rows.bind_i64(3, limit)?;
        rows.bind_i64(4, offset)?;
        let mut records = Vec::new();
        while rows.step()? == SQLITE_ROW {
            records.push(GlobalAuditRecord {
                operation_id: rows.column_text(0)?,
                revision: rows.column_u64(1)?,
                command: rows.column_text(2)?,
                created_at: rows.column_text(3)?,
                request_digest: rows.column_text(4)?,
                result: serde_json::from_str(&rows.column_text(5)?)
                    .map_err(|error| StoreError::Corrupt(error.to_string()))?,
            });
        }
        Ok((records, total))
    }

    /// Runs one application-supplied state transition inside the global write
    /// boundary. The closure must be pure and must not perform external I/O.
    pub fn mutate<F>(
        &self,
        command: &str,
        payload: &Value,
        operation: &str,
        transition: F,
    ) -> Result<Value, StoreError>
    where
        F: FnOnce(Value, u64) -> Result<(Value, Value), StoreError>,
    {
        if operation.trim().is_empty() {
            return Err(StoreError::Invalid("operation id is required".into()));
        }
        let digest = request_digest(command, payload);
        self.inner.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| {
            if let Some((old_digest, result)) = self.operation(operation)? {
                if old_digest != digest {
                    return Err(StoreError::Conflict(
                        "operation id was already used with different input".into(),
                    ));
                }
                return Ok(result);
            }
            let expected = payload.get("expected_revision").and_then(Value::as_u64);
            let revision = self.revision()?;
            if let Some(expected) = expected {
                if revision != expected {
                    return Err(StoreError::StaleRevision {
                        expected,
                        actual: revision,
                    });
                }
            }
            let before = self.load_state()?;
            let next = revision
                .checked_add(1)
                .ok_or_else(|| StoreError::Corrupt("global revision overflow".into()))?;
            let (state, value) = transition(before.clone(), next)?;
            let before_json =
                serde_json::to_string(&before).map_err(|e| StoreError::Corrupt(e.to_string()))?;
            let mut history = self
                .inner
                .prepare("INSERT OR IGNORE INTO global_revision_snapshot VALUES(?1,?2,?3)")?;
            history.bind_i64(1, revision)?;
            history.bind_text(2, &before_json)?;
            history.bind_text(3, &now())?;
            history.run()?;
            let encoded =
                serde_json::to_string(&state).map_err(|e| StoreError::Corrupt(e.to_string()))?;
            let mut update = self
                .inner
                .prepare("UPDATE global_manager_state SET state_json=?1 WHERE singleton=1")?;
            update.bind_text(1, &encoded)?;
            update.run()?;
            let mut bump = self
                .inner
                .prepare("UPDATE global_schema SET revision=?1 WHERE singleton=1")?;
            bump.bind_i64(1, next)?;
            bump.run()?;
            let result = with_revision(value, next);
            let result_json =
                serde_json::to_string(&result).map_err(|e| StoreError::Corrupt(e.to_string()))?;
            let now = now();
            let mut audit=self.inner.prepare("INSERT INTO global_audit(revision,operation_id,command,request_digest,before_digest,after_digest,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7)")?;
            audit.bind_i64(1, next)?;
            audit.bind_text(2, operation)?;
            audit.bind_text(3, command)?;
            audit.bind_text(4, &digest)?;
            audit.bind_text(5, &request_digest("snapshot", &before))?;
            audit.bind_text(6, &request_digest("snapshot", &state))?;
            audit.bind_text(7, &now)?;
            audit.run()?;
            let mut receipt=self.inner.prepare("INSERT INTO global_operation(operation_id,request_digest,revision,result_json,created_at) VALUES(?1,?2,?3,?4,?5)")?;
            receipt.bind_text(1, operation)?;
            receipt.bind_text(2, &digest)?;
            receipt.bind_i64(3, next)?;
            receipt.bind_text(4, &result_json)?;
            receipt.bind_text(5, &now)?;
            receipt.run()?;
            Ok(result)
        })();
        match result {
            Ok(value) => {
                self.inner.execute_batch("COMMIT")?;
                Ok(value)
            }
            Err(error) => {
                let _ = self.inner.execute_batch("ROLLBACK");
                Err(error)
            }
        }
    }

    fn load_state(&self) -> Result<Value, StoreError> {
        let mut q = self
            .inner
            .prepare("SELECT state_json FROM global_manager_state WHERE singleton=1")?;
        if q.step()? != SQLITE_ROW {
            return Err(StoreError::Corrupt(
                "global manager state row is missing".into(),
            ));
        }
        serde_json::from_str(&q.column_text(0)?)
            .map_err(|e| StoreError::Corrupt(format!("global manager state is invalid: {e}")))
    }

    fn operation(&self, id: &str) -> Result<Option<(String, Value)>, StoreError> {
        let mut q = self.inner.prepare(
            "SELECT request_digest,result_json FROM global_operation WHERE operation_id=?1",
        )?;
        q.bind_text(1, id)?;
        if q.step()? != SQLITE_ROW {
            return Ok(None);
        }
        let digest = q.column_text(0)?;
        let result = serde_json::from_str(&q.column_text(1)?)
            .map_err(|e| StoreError::Corrupt(e.to_string()))?;
        Ok(Some((digest, result)))
    }
    fn scalar(&self, sql: &str) -> Result<u64, StoreError> {
        let mut q = self.inner.prepare(sql)?;
        if q.step()? != SQLITE_ROW {
            return Err(StoreError::Corrupt(
                "global scalar query returned no row".into(),
            ));
        }
        q.column_u64(0)
    }
}

fn migrate_legacy_state(db: &SqliteStore) -> Result<Value, StoreError> {
    let mut state = serde_json::from_str::<Value>(EMPTY_STATE).unwrap();
    // Version-one experimental tables are retained and copied into the
    // canonical snapshot so an upgrade does not discard existing records.
    if table_exists(db, "management_project")? {
        let mut q=db.prepare("SELECT project_id,name,description,archived,created_at,updated_at FROM management_project ORDER BY project_id")?;
        while q.step()? == SQLITE_ROW {
            state["projects"].as_array_mut().unwrap().push(json!({"id":q.column_text(0)?,"name":q.column_text(1)?,"description":q.column_text(2)?,"labels":[],"priority":0,"lifecycle":"planned","health":"unknown","archived":q.column_bool(3)?,"created_at":q.column_text(4)?,"updated_at":q.column_text(5)?}));
        }
    }
    if table_exists(db, "management_item")? {
        let mut q=db.prepare("SELECT item_id,project_id,parent_id,title,details,status,priority,due_at,archived,created_at,updated_at,position FROM management_item ORDER BY item_id")?;
        while q.step()? == SQLITE_ROW {
            let status = q.column_text(5)?;
            state["items"].as_array_mut().unwrap().push(json!({"id":q.column_text(0)?,"project_id":q.column_optional_text(1)?,"parent_id":q.column_optional_text(2)?,"kind":if q.column_optional_text(2)?.is_some(){"subtask"}else{"task"},"title":q.column_text(3)?,"description":q.column_text(4)?,"labels":[],"status_id":status,"priority":q.column_i64(6)?,"due_at":q.column_optional_text(7)?,"archived":q.column_bool(8)?,"created_at":q.column_text(9)?,"updated_at":q.column_text(10)?,"position":q.column_i64(11)?}));
        }
    }
    if table_exists(db, "global_note")? {
        let mut q=db.prepare("SELECT note_id,project_id,title,body,archived,created_at,updated_at FROM global_note ORDER BY note_id")?;
        while q.step()? == SQLITE_ROW {
            state["notes"].as_array_mut().unwrap().push(json!({"id":q.column_text(0)?,"project_id":q.column_optional_text(1)?,"title":q.column_text(2)?,"body":q.column_text(3)?,"archived":q.column_bool(4)?,"created_at":q.column_text(5)?,"updated_at":q.column_text(6)?}));
        }
    }
    if table_exists(db, "project_association")? {
        let mut q=db.prepare("SELECT project_id,kind,identity,path,updated_at FROM project_association ORDER BY project_id,kind,identity")?;
        while q.step()? == SQLITE_ROW {
            state["associations"].as_array_mut().unwrap().push(json!({"project_id":q.column_text(0)?,"kind":q.column_text(1)?,"identity":q.column_text(2)?,"path":q.column_optional_text(3)?,"updated_at":q.column_text(4)?}));
        }
    }
    let project_ids: Vec<String> = state["projects"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|p| p["id"].as_str().map(str::to_owned))
        .collect();
    for pid in project_ids {
        for (sid, label, cat, pos) in [
            ("todo", "To do", "open", 0),
            ("doing", "Doing", "active", 1),
            ("waiting", "Waiting", "waiting", 2),
            ("blocked", "Blocked", "blocked", 3),
            ("done", "Done", "completed", 4),
            ("cancelled", "Cancelled", "cancelled", 5),
        ] {
            state["statuses"].as_array_mut().unwrap().push(json!({"project_id":pid,"status_id":sid,"label":label,"category":cat,"position":pos}));
        }
    }
    let statuses: Vec<(Option<String>, String)> = state["items"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|item| {
            Some((
                item["project_id"].as_str().map(str::to_owned),
                item["status_id"].as_str()?.to_owned(),
            ))
        })
        .collect();
    for (pid, sid) in statuses {
        if state["statuses"].as_array().unwrap().iter().any(|status| {
            status["project_id"].as_str() == pid.as_deref() && status["status_id"] == sid
        }) {
            continue;
        }
        let (category, position) = match sid.as_str() {
            "done" | "complete" | "completed" => ("completed", 4),
            "doing" | "in_progress" | "active" => ("active", 1),
            "waiting" | "waiting_on" => ("waiting", 2),
            "blocked" => ("blocked", 3),
            "cancelled" | "canceled" => ("cancelled", 5),
            _ => ("open", 0),
        };
        state["statuses"].as_array_mut().unwrap().push(json!({"project_id":pid,"status_id":sid,"label":sid,"category":category,"position":position}));
    }
    Ok(state)
}

fn table_exists(db: &SqliteStore, name: &str) -> Result<bool, StoreError> {
    let mut q = db.prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1")?;
    q.bind_text(1, name)?;
    q.step()?;
    Ok(q.column_i64(0)? > 0)
}

fn open_connection_with_retry(path: &Path) -> Result<SqliteStore, StoreError> {
    let started = std::time::Instant::now();
    loop {
        match SqliteStore::open_connection(
            path,
            super::SQLITE_OPEN_READWRITE | super::SQLITE_OPEN_CREATE,
        ) {
            Ok(store) => return Ok(store),
            Err(error @ StoreError::Busy(_))
                if started.elapsed() < std::time::Duration::from_secs(5) =>
            {
                std::thread::sleep(std::time::Duration::from_millis(25));
                let _ = error;
            }
            Err(error) => return Err(error),
        }
    }
}

fn request_digest(command: &str, payload: &Value) -> String {
    super::checksum(
        format!(
            "{command}
{payload}"
        )
        .as_bytes(),
    )
}
fn now() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string()
}
fn with_revision(mut value: Value, revision: u64) -> Value {
    if !value.is_object() {
        value = json!({"value":value});
    }
    value["revision"] = json!(revision);
    value
}
