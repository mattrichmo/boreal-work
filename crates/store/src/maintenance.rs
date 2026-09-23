//! Durable readback for database maintenance effects.
//!
//! Backup and restore touch the filesystem outside the SQLite transaction.
//! This table records the operation before that effect starts, so a crash or
//! lost response remains pending/readback-required rather than being guessed
//! as success.

use super::{SqliteStore, StoreError, SQLITE_ROW};

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS boreal_maintenance_job (
  operation_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (trim(kind) <> ''),
  database_path TEXT NOT NULL CHECK (trim(database_path) <> ''),
  package_path TEXT NOT NULL CHECK (trim(package_path) <> ''),
  request_digest TEXT NOT NULL CHECK (trim(request_digest) <> ''),
  stage TEXT NOT NULL CHECK (stage IN ('registered','running','readback_required','committed','rejected','unknown')),
  result_json TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS boreal_maintenance_job_stage
  ON boreal_maintenance_job(stage, operation_id);
"#;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MaintenanceJobInput {
    pub operation_id: String,
    pub kind: String,
    pub database_path: String,
    pub package_path: String,
    pub request_digest: String,
    pub created_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MaintenanceJobRecord {
    pub operation_id: String,
    pub kind: String,
    pub database_path: String,
    pub package_path: String,
    pub request_digest: String,
    pub stage: String,
    pub result_json: Option<String>,
    pub error_message: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MaintenanceJobRegistration {
    pub job: MaintenanceJobRecord,
    pub replayed: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MaintenanceJobTransition {
    pub operation_id: String,
    pub expected_stage: String,
    pub next_stage: String,
    pub at: String,
    pub result_json: Option<String>,
    pub error_message: Option<String>,
}

pub fn ensure_schema(store: &SqliteStore) -> Result<(), StoreError> {
    store.execute_batch(SCHEMA)
}

impl SqliteStore {
    pub fn ensure_maintenance_job_schema(&self) -> Result<(), StoreError> {
        ensure_schema(self)
    }

    pub fn register_maintenance_job(
        &self,
        input: &MaintenanceJobInput,
    ) -> Result<MaintenanceJobRegistration, StoreError> {
        validate_input(input)?;
        ensure_schema(self)?;
        self.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| {
            if let Some(existing) = self.maintenance_job(&input.operation_id)? {
                if existing.kind != input.kind
                    || existing.database_path != input.database_path
                    || existing.package_path != input.package_path
                    || existing.request_digest != input.request_digest
                {
                    return Err(StoreError::Conflict(
                        "maintenance operation was reused with a different request".to_owned(),
                    ));
                }
                return Ok(MaintenanceJobRegistration {
                    job: existing,
                    replayed: true,
                });
            }
            let mut statement = self.prepare(
                "INSERT INTO boreal_maintenance_job
                 (operation_id,kind,database_path,package_path,request_digest,stage,created_at,updated_at)
                 VALUES (?1,?2,?3,?4,?5,'registered',?6,?6)",
            )?;
            statement.bind_text(1, &input.operation_id)?;
            statement.bind_text(2, &input.kind)?;
            statement.bind_text(3, &input.database_path)?;
            statement.bind_text(4, &input.package_path)?;
            statement.bind_text(5, &input.request_digest)?;
            statement.bind_text(6, &input.created_at)?;
            statement.run()?;
            Ok(MaintenanceJobRegistration {
                job: self.maintenance_job(&input.operation_id)?.ok_or_else(|| {
                    StoreError::Corrupt("maintenance job disappeared after registration".to_owned())
                })?,
                replayed: false,
            })
        })();
        finish(self, result)
    }

    pub fn transition_maintenance_job(
        &self,
        transition: &MaintenanceJobTransition,
    ) -> Result<MaintenanceJobRecord, StoreError> {
        if transition.expected_stage.trim().is_empty()
            || transition.next_stage.trim().is_empty()
            || transition.at.trim().is_empty()
        {
            return Err(StoreError::Invalid(
                "maintenance transition identity is incomplete".to_owned(),
            ));
        }
        if !matches!(
            transition.next_stage.as_str(),
            "running" | "readback_required" | "committed" | "rejected" | "unknown"
        ) {
            return Err(StoreError::Invalid(format!(
                "invalid maintenance stage {}",
                transition.next_stage
            )));
        }
        ensure_schema(self)?;
        self.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| {
            let current = self
                .maintenance_job(&transition.operation_id)?
                .ok_or_else(|| StoreError::NotFound {
                    entity: "maintenance_job",
                    id: transition.operation_id.clone(),
                })?;
            if current.stage != transition.expected_stage {
                if current.stage == transition.next_stage
                    && current.result_json == transition.result_json
                    && current.error_message == transition.error_message
                {
                    return Ok(current);
                }
                return Err(StoreError::Conflict(format!(
                    "maintenance stage changed from {} to {}",
                    transition.expected_stage, current.stage
                )));
            }
            let mut statement = self.prepare(
                "UPDATE boreal_maintenance_job
                 SET stage=?2,result_json=?3,error_message=?4,updated_at=?5
                 WHERE operation_id=?1 AND stage=?6",
            )?;
            statement.bind_text(1, &transition.operation_id)?;
            statement.bind_text(2, &transition.next_stage)?;
            statement.bind_optional_text(3, transition.result_json.as_deref())?;
            statement.bind_optional_text(4, transition.error_message.as_deref())?;
            statement.bind_text(5, &transition.at)?;
            statement.bind_text(6, &transition.expected_stage)?;
            statement.run()?;
            self.maintenance_job(&transition.operation_id)?
                .ok_or_else(|| {
                    StoreError::Corrupt("maintenance job disappeared after transition".to_owned())
                })
        })();
        finish(self, result)
    }

    pub fn maintenance_job(
        &self,
        operation_id: &str,
    ) -> Result<Option<MaintenanceJobRecord>, StoreError> {
        let mut statement = self.prepare(
            "SELECT operation_id,kind,database_path,package_path,request_digest,
                    stage,result_json,error_message,created_at,updated_at
             FROM boreal_maintenance_job WHERE operation_id=?1",
        )?;
        statement.bind_text(1, operation_id)?;
        if statement.step()? != SQLITE_ROW {
            return Ok(None);
        }
        Ok(Some(MaintenanceJobRecord {
            operation_id: statement.column_text(0)?,
            kind: statement.column_text(1)?,
            database_path: statement.column_text(2)?,
            package_path: statement.column_text(3)?,
            request_digest: statement.column_text(4)?,
            stage: statement.column_text(5)?,
            result_json: statement.column_optional_text(6)?,
            error_message: statement.column_optional_text(7)?,
            created_at: statement.column_text(8)?,
            updated_at: statement.column_text(9)?,
        }))
    }
}

fn validate_input(input: &MaintenanceJobInput) -> Result<(), StoreError> {
    for (name, value) in [
        ("operation_id", input.operation_id.as_str()),
        ("kind", input.kind.as_str()),
        ("database_path", input.database_path.as_str()),
        ("package_path", input.package_path.as_str()),
        ("request_digest", input.request_digest.as_str()),
        ("created_at", input.created_at.as_str()),
    ] {
        if value.trim().is_empty() {
            return Err(StoreError::Invalid(format!(
                "maintenance job requires non-empty {name}"
            )));
        }
    }
    Ok(())
}

fn finish<T>(store: &SqliteStore, result: Result<T, StoreError>) -> Result<T, StoreError> {
    match result {
        Ok(value) => {
            store.execute_batch("COMMIT")?;
            Ok(value)
        }
        Err(error) => {
            let _ = store.execute_batch("ROLLBACK");
            Err(error)
        }
    }
}
