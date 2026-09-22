//! Ordered, fail-closed SQLite migration mechanics.
//!
//! This module deliberately owns the migration protocol, not the SQLite
//! connection.  `SqliteStore` integration is a coordinator-owned root-file
//! change: the adapter implements [`MigrationBackend`] using the store's
//! existing transaction/statement boundary and service-election lock.
//!
//! A migration has two durable phases.  A `running` ledger row is committed
//! before the schema transaction starts, so an interrupted process is
//! observable and retryable.  DDL, invariant checks, schema identity, the
//! version marker, diagnostics, and the `applied` ledger state then commit in
//! one transaction.  A failure rolls that transaction back and records a
//! retained `failed` attempt without ever advertising the new version.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt::{self, Display, Formatter};

pub const MIGRATION_LEDGER_TABLE: &str = "boreal_migration_ledger";
pub const MIGRATION_DIAGNOSTIC_TABLE: &str = "boreal_migration_diagnostic";
pub const SCHEMA_IDENTITY_TABLE: &str = "boreal_schema_identity";

const LEDGER_SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS boreal_migration_ledger (
  migration_id TEXT NOT NULL,
  attempt INTEGER NOT NULL CHECK (attempt > 0),
  from_version INTEGER NOT NULL CHECK (from_version >= 0),
  to_version INTEGER NOT NULL CHECK (to_version > from_version),
  checksum TEXT NOT NULL CHECK (trim(checksum) <> ''),
  state TEXT NOT NULL CHECK (state IN ('running','applied','failed')),
  diagnostics_json TEXT NOT NULL DEFAULT '[]',
  failure_message TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY (migration_id, attempt),
  CHECK (state = 'running' OR completed_at IS NOT NULL),
  CHECK (state <> 'failed' OR failure_message IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS boreal_migration_ledger_latest
  ON boreal_migration_ledger(migration_id, attempt DESC);
"#;

const DIAGNOSTIC_SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS boreal_migration_diagnostic (
  diagnostic_id INTEGER PRIMARY KEY AUTOINCREMENT,
  migration_id TEXT NOT NULL,
  attempt INTEGER NOT NULL CHECK (attempt > 0),
  code TEXT NOT NULL CHECK (trim(code) <> ''),
  entity_type TEXT NOT NULL CHECK (trim(entity_type) <> ''),
  entity_id TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL CHECK (trim(message) <> ''),
  blocking INTEGER NOT NULL CHECK (blocking IN (0,1)),
  raw_payload TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE (migration_id, attempt, code, entity_type, entity_id, raw_payload)
);
CREATE INDEX IF NOT EXISTS boreal_migration_diagnostic_subject
  ON boreal_migration_diagnostic(migration_id, entity_type, entity_id);
"#;

const IDENTITY_SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS boreal_schema_identity (
  identity_id INTEGER PRIMARY KEY CHECK (identity_id = 1),
  schema_id TEXT NOT NULL CHECK (trim(schema_id) <> ''),
  schema_version INTEGER NOT NULL CHECK (schema_version >= 0),
  contract_version TEXT NOT NULL CHECK (trim(contract_version) <> ''),
  schema_checksum TEXT NOT NULL CHECK (trim(schema_checksum) <> ''),
  updated_at TEXT NOT NULL
);
"#;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SchemaIdentity {
    pub schema_id: String,
    pub schema_version: i64,
    pub contract_version: String,
    pub schema_checksum: Option<String>,
}

impl SchemaIdentity {
    pub fn uninitialized() -> Self {
        Self {
            schema_id: String::new(),
            schema_version: 0,
            contract_version: String::new(),
            schema_checksum: None,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MigrationDiagnostic {
    pub code: String,
    pub entity_type: String,
    pub entity_id: String,
    pub message: String,
    pub blocking: bool,
    pub raw_payload: Option<String>,
}

impl MigrationDiagnostic {
    pub fn blocking(
        code: impl Into<String>,
        entity_type: impl Into<String>,
        entity_id: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            code: code.into(),
            entity_type: entity_type.into(),
            entity_id: entity_id.into(),
            message: message.into(),
            blocking: true,
            raw_payload: None,
        }
    }

    pub fn retained(
        code: impl Into<String>,
        entity_type: impl Into<String>,
        entity_id: impl Into<String>,
        message: impl Into<String>,
        raw_payload: impl Into<String>,
    ) -> Self {
        Self {
            code: code.into(),
            entity_type: entity_type.into(),
            entity_id: entity_id.into(),
            message: message.into(),
            blocking: false,
            raw_payload: Some(raw_payload.into()),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MigrationState {
    Running,
    Applied,
    Failed,
}

#[allow(dead_code)]
impl MigrationState {
    fn as_sql(self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::Applied => "applied",
            Self::Failed => "failed",
        }
    }

    fn parse(value: &str) -> Result<Self, MigrationError> {
        match value {
            "running" => Ok(Self::Running),
            "applied" => Ok(Self::Applied),
            "failed" => Ok(Self::Failed),
            other => Err(MigrationError::LedgerMismatch(format!(
                "unknown migration ledger state {other:?}"
            ))),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MigrationLedgerEntry {
    pub migration_id: String,
    pub attempt: u64,
    pub from_version: i64,
    pub to_version: i64,
    pub checksum: String,
    pub state: MigrationState,
    pub diagnostics_json: String,
    pub failure_message: Option<String>,
    pub started_at: String,
    pub completed_at: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MigrationStep {
    pub migration_id: String,
    pub from_version: i64,
    pub to_version: i64,
    pub migration_sql: String,
    pub precondition_sql: String,
    pub verify_sql: String,
    pub result_schema_checksum: String,
    pub checksum: String,
}

impl MigrationStep {
    pub fn new(
        migration_id: impl Into<String>,
        from_version: i64,
        to_version: i64,
        migration_sql: impl Into<String>,
        precondition_sql: impl Into<String>,
        verify_sql: impl Into<String>,
        result_schema_checksum: impl Into<String>,
    ) -> Result<Self, MigrationError> {
        if from_version < 0 || to_version <= from_version {
            return Err(MigrationError::InvalidPlan(format!(
                "migration versions must increase: {from_version} -> {to_version}"
            )));
        }
        let step = Self {
            migration_id: migration_id.into(),
            from_version,
            to_version,
            migration_sql: migration_sql.into(),
            precondition_sql: precondition_sql.into(),
            verify_sql: verify_sql.into(),
            result_schema_checksum: result_schema_checksum.into(),
            checksum: String::new(),
        };
        let checksum = checksum(step.canonical_payload().as_bytes());
        Ok(Self { checksum, ..step })
    }

    fn canonical_payload(&self) -> String {
        format!(
            "{}\n{}\n{}\n{}\n{}\n{}",
            self.migration_id,
            self.from_version,
            self.to_version,
            normalize_sql(&self.migration_sql),
            normalize_sql(&self.precondition_sql),
            normalize_sql(&self.verify_sql),
        )
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MigrationPlan {
    pub schema_id: String,
    pub contract_version: String,
    pub target_version: i64,
    pub target_schema_checksum: String,
    pub fresh_schema_sql: String,
    pub verify_sql: String,
    pub steps: Vec<MigrationStep>,
    pub supported_source_checksums: BTreeMap<i64, BTreeSet<String>>,
}

impl MigrationPlan {
    pub fn new(
        schema_id: impl Into<String>,
        contract_version: impl Into<String>,
        target_version: i64,
        target_schema_checksum: impl Into<String>,
        fresh_schema_sql: impl Into<String>,
        verify_sql: impl Into<String>,
        steps: Vec<MigrationStep>,
    ) -> Self {
        Self {
            schema_id: schema_id.into(),
            contract_version: contract_version.into(),
            target_version,
            target_schema_checksum: target_schema_checksum.into(),
            fresh_schema_sql: fresh_schema_sql.into(),
            verify_sql: verify_sql.into(),
            steps,
            supported_source_checksums: BTreeMap::new(),
        }
    }

    pub fn with_supported_source_checksum(
        mut self,
        version: i64,
        source_checksum: impl Into<String>,
    ) -> Self {
        self.supported_source_checksums
            .entry(version)
            .or_default()
            .insert(source_checksum.into());
        self
    }

    pub fn validate(&self) -> Result<(), MigrationError> {
        if self.schema_id.trim().is_empty()
            || self.contract_version.trim().is_empty()
            || self.target_schema_checksum.trim().is_empty()
            || self.target_version <= 0
        {
            return Err(MigrationError::InvalidPlan(
                "schema identity and target version are required".to_owned(),
            ));
        }
        if self.fresh_schema_sql.trim().is_empty() {
            return Err(MigrationError::InvalidPlan(
                "fresh schema SQL is required".to_owned(),
            ));
        }
        let mut ids = BTreeSet::new();
        let mut previous_to = None;
        for step in &self.steps {
            if step.migration_id.trim().is_empty() || !ids.insert(&step.migration_id) {
                return Err(MigrationError::InvalidPlan(format!(
                    "duplicate or empty migration ID: {}",
                    step.migration_id
                )));
            }
            if step.checksum != checksum(step.canonical_payload().as_bytes()) {
                return Err(MigrationError::ChecksumMismatch {
                    migration_id: step.migration_id.clone(),
                    expected: checksum(step.canonical_payload().as_bytes()),
                    actual: step.checksum.clone(),
                });
            }
            if let Some(previous_to) = previous_to {
                if step.from_version != previous_to {
                    return Err(MigrationError::InvalidPlan(format!(
                        "migration order has a gap: previous ended at {previous_to}, next starts at {}",
                        step.from_version
                    )));
                }
            }
            previous_to = Some(step.to_version);
        }
        if !self.steps.is_empty() && previous_to != Some(self.target_version) {
            return Err(MigrationError::InvalidPlan(format!(
                "migration chain ends at {:?}, target is {}",
                previous_to, self.target_version
            )));
        }
        Ok(())
    }

    fn step_from(&self, version: i64) -> Option<MigrationStep> {
        self.steps
            .iter()
            .find(|step| step.from_version == version)
            .cloned()
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MigrationOutcome {
    Fresh {
        target_version: i64,
        diagnostics: Vec<MigrationDiagnostic>,
    },
    Upgraded {
        from_version: i64,
        to_version: i64,
        migrations: Vec<String>,
        diagnostics: Vec<MigrationDiagnostic>,
    },
    AlreadyCurrent {
        version: i64,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MigrationError {
    Busy(String),
    UnsupportedNewer {
        found: i64,
        supported: i64,
    },
    UnsupportedOlder {
        found: i64,
    },
    SchemaIdentityMismatch(String),
    ChecksumMismatch {
        migration_id: String,
        expected: String,
        actual: String,
    },
    PreflightBlocked {
        diagnostics: Vec<MigrationDiagnostic>,
    },
    LedgerMismatch(String),
    InvariantViolation(String),
    InvalidPlan(String),
    Backend(String),
    RecoveryRequired {
        original: String,
        recovery: String,
    },
}

impl Display for MigrationError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        match self {
            Self::Busy(message) => write!(formatter, "migration busy: {message}"),
            Self::UnsupportedNewer { found, supported } => write!(
                formatter,
                "database schema version {found} is newer than supported version {supported}"
            ),
            Self::UnsupportedOlder { found } => {
                write!(formatter, "database schema version {found} has no ordered migration")
            }
            Self::SchemaIdentityMismatch(message)
            | Self::LedgerMismatch(message)
            | Self::InvariantViolation(message)
            | Self::InvalidPlan(message)
            | Self::Backend(message) => formatter.write_str(message),
            Self::ChecksumMismatch {
                migration_id,
                expected,
                actual,
            } => write!(
                formatter,
                "migration checksum mismatch for {migration_id}: expected {expected}, actual {actual}"
            ),
            Self::PreflightBlocked { diagnostics } => write!(
                formatter,
                "migration preflight blocked by {} diagnostic(s): {}",
                diagnostics.len(),
                diagnostics
                    .first()
                    .map(|diagnostic| diagnostic.code.as_str())
                    .unwrap_or("unknown")
            ),
            Self::RecoveryRequired { original, recovery } => write!(
                formatter,
                "migration failed ({original}); failure retention also failed ({recovery})"
            ),
        }
    }
}

impl std::error::Error for MigrationError {}

/// The narrow adapter boundary required from the existing `SqliteStore`.
/// Implementations must use the store's existing SQLite connection, must not
/// force-remove a live service/maintenance lock, and must make `begin_immediate`
/// fail with `is_busy` when another writer owns the database.
pub trait MigrationBackend {
    type Error: Display;

    fn schema_identity(&mut self) -> Result<SchemaIdentity, Self::Error>;
    fn live_attempt_diagnostics(&mut self) -> Result<Vec<MigrationDiagnostic>, Self::Error>;
    fn legacy_diagnostics(&mut self) -> Result<Vec<MigrationDiagnostic>, Self::Error>;
    fn try_acquire_migration_lock(&mut self) -> Result<(), Self::Error>;
    fn release_migration_lock(&mut self);
    fn begin_immediate(&mut self) -> Result<(), Self::Error>;
    fn execute(&mut self, sql: &str) -> Result<(), Self::Error>;
    fn read_ledger(&mut self) -> Result<Vec<MigrationLedgerEntry>, Self::Error>;
    fn commit(&mut self) -> Result<(), Self::Error>;
    fn rollback(&mut self) -> Result<(), Self::Error>;
    fn now(&self) -> String;

    fn is_busy(&self, _error: &Self::Error) -> bool {
        false
    }
}

pub struct MigrationRunner<B> {
    backend: B,
    plan: MigrationPlan,
}

impl<B: MigrationBackend> MigrationRunner<B> {
    pub fn new(backend: B, plan: MigrationPlan) -> Result<Self, MigrationError> {
        plan.validate()?;
        Ok(Self { backend, plan })
    }

    pub fn backend(&self) -> &B {
        &self.backend
    }

    pub fn backend_mut(&mut self) -> &mut B {
        &mut self.backend
    }

    pub fn into_backend(self) -> B {
        self.backend
    }

    pub fn apply(&mut self) -> Result<MigrationOutcome, MigrationError> {
        let identity = self.read_and_validate_identity()?;
        let diagnostics = self.preflight()?;

        if identity.schema_version == self.plan.target_version {
            self.verify_current(&identity)?;
            return Ok(MigrationOutcome::AlreadyCurrent {
                version: identity.schema_version,
            });
        }

        self.acquire_lock()?;
        let result = if identity.schema_version == 0 {
            self.apply_fresh(diagnostics)
        } else {
            self.apply_upgrade(identity.schema_version, diagnostics)
        };
        self.backend.release_migration_lock();
        result
    }

    fn read_and_validate_identity(&mut self) -> Result<SchemaIdentity, MigrationError> {
        let identity = self
            .backend
            .schema_identity()
            .map_err(|error| MigrationError::Backend(error.to_string()))?;
        if identity.schema_version > self.plan.target_version {
            return Err(MigrationError::UnsupportedNewer {
                found: identity.schema_version,
                supported: self.plan.target_version,
            });
        }
        if identity.schema_version == 0 {
            return Ok(identity);
        }
        if identity.schema_id != self.plan.schema_id {
            return Err(MigrationError::SchemaIdentityMismatch(format!(
                "expected schema {}, found {}",
                self.plan.schema_id, identity.schema_id
            )));
        }
        if let Some(accepted) = self
            .plan
            .supported_source_checksums
            .get(&identity.schema_version)
        {
            let actual = identity.schema_checksum.as_deref().unwrap_or("");
            if !accepted.contains(actual) {
                return Err(MigrationError::SchemaIdentityMismatch(format!(
                    "schema {} has an unrecognized checksum for version {}: {actual}",
                    identity.schema_id, identity.schema_version
                )));
            }
        }
        if identity.schema_version == self.plan.target_version {
            self.ensure_target_identity(&identity)?;
        }
        Ok(identity)
    }

    fn ensure_target_identity(&self, identity: &SchemaIdentity) -> Result<(), MigrationError> {
        if identity.contract_version != self.plan.contract_version {
            return Err(MigrationError::SchemaIdentityMismatch(format!(
                "expected contract {}, found {}",
                self.plan.contract_version, identity.contract_version
            )));
        }
        if identity.schema_checksum.as_deref() != Some(self.plan.target_schema_checksum.as_str()) {
            return Err(MigrationError::SchemaIdentityMismatch(format!(
                "expected target schema checksum {}, found {:?}",
                self.plan.target_schema_checksum, identity.schema_checksum
            )));
        }
        Ok(())
    }

    fn preflight(&mut self) -> Result<Vec<MigrationDiagnostic>, MigrationError> {
        let mut live = self
            .backend
            .live_attempt_diagnostics()
            .map_err(|error| MigrationError::Backend(error.to_string()))?;
        if live.iter().any(|diagnostic| diagnostic.blocking) {
            return Err(MigrationError::PreflightBlocked { diagnostics: live });
        }
        let mut legacy = self
            .backend
            .legacy_diagnostics()
            .map_err(|error| MigrationError::Backend(error.to_string()))?;
        let mut all = Vec::with_capacity(live.len() + legacy.len());
        all.append(&mut live);
        all.append(&mut legacy);
        if all.iter().any(|diagnostic| diagnostic.blocking) {
            return Err(MigrationError::PreflightBlocked { diagnostics: all });
        }
        Ok(all)
    }

    fn acquire_lock(&mut self) -> Result<(), MigrationError> {
        self.backend.try_acquire_migration_lock().map_err(|error| {
            if self.backend.is_busy(&error) {
                MigrationError::Busy(error.to_string())
            } else {
                MigrationError::Backend(error.to_string())
            }
        })
    }

    fn apply_fresh(
        &mut self,
        diagnostics: Vec<MigrationDiagnostic>,
    ) -> Result<MigrationOutcome, MigrationError> {
        let step = self.bootstrap_step()?;
        let attempt = self.stage_step(&step, &diagnostics)?;
        self.apply_staged_step(&step, attempt, &diagnostics)?;
        Ok(MigrationOutcome::Fresh {
            target_version: self.plan.target_version,
            diagnostics,
        })
    }

    fn apply_upgrade(
        &mut self,
        from_version: i64,
        diagnostics: Vec<MigrationDiagnostic>,
    ) -> Result<MigrationOutcome, MigrationError> {
        let mut current = from_version;
        let mut applied = Vec::new();
        while current < self.plan.target_version {
            let step = self
                .plan
                .step_from(current)
                .ok_or(MigrationError::UnsupportedOlder { found: current })?;
            let attempt = self.stage_step(&step, &diagnostics)?;
            self.apply_staged_step(&step, attempt, &diagnostics)?;
            current = step.to_version;
            applied.push(step.migration_id);
        }
        let identity = self
            .backend
            .schema_identity()
            .map_err(|error| MigrationError::Backend(error.to_string()))?;
        self.ensure_target_identity(&identity)?;
        Ok(MigrationOutcome::Upgraded {
            from_version,
            to_version: current,
            migrations: applied,
            diagnostics,
        })
    }

    fn stage_step(
        &mut self,
        step: &MigrationStep,
        diagnostics: &[MigrationDiagnostic],
    ) -> Result<u64, MigrationError> {
        self.backend
            .begin_immediate()
            .map_err(|error| self.map_backend_error(error))?;
        let result = (|| {
            self.backend
                .execute(LEDGER_SCHEMA_SQL)
                .map_err(|error| self.map_backend_error(error))?;
            self.backend
                .execute(DIAGNOSTIC_SCHEMA_SQL)
                .map_err(|error| self.map_backend_error(error))?;
            let live = self
                .backend
                .live_attempt_diagnostics()
                .map_err(|error| MigrationError::Backend(error.to_string()))?;
            if live.iter().any(|diagnostic| diagnostic.blocking) {
                return Err(MigrationError::PreflightBlocked { diagnostics: live });
            }
            let entries = self
                .backend
                .read_ledger()
                .map_err(|error| MigrationError::Backend(error.to_string()))?;
            let latest = latest_entry(&entries, &step.migration_id);
            match latest {
                Some(entry) if entry.checksum != step.checksum => {
                    Err(MigrationError::ChecksumMismatch {
                        migration_id: step.migration_id.clone(),
                        expected: step.checksum.clone(),
                        actual: entry.checksum.clone(),
                    })
                }
                Some(entry)
                    if entry.state == MigrationState::Running
                        && entry.from_version == step.from_version
                        && entry.to_version == step.to_version =>
                {
                    Ok(entry.attempt)
                }
                Some(entry) if entry.state == MigrationState::Running => {
                    Err(MigrationError::LedgerMismatch(format!(
                        "migration {} has a running attempt for {} -> {}, expected {} -> {}",
                        step.migration_id,
                        entry.from_version,
                        entry.to_version,
                        step.from_version,
                        step.to_version
                    )))
                }
                Some(entry) if entry.state == MigrationState::Applied => {
                    Err(MigrationError::LedgerMismatch(format!(
                        "migration {} is marked applied while schema remains at {}",
                        step.migration_id, step.from_version
                    )))
                }
                _ => {
                    let attempt = latest.map_or(1, |entry| entry.attempt + 1);
                    let diagnostics_json = diagnostics_json(diagnostics);
                    let started_at = self.backend.now();
                    self.backend
                        .execute(&format!(
                            "INSERT INTO {MIGRATION_LEDGER_TABLE}
                             (migration_id, attempt, from_version, to_version, checksum,
                              state, diagnostics_json, started_at)
                             VALUES ({}, {attempt}, {}, {}, {}, 'running', {}, {});",
                            sql_text(&step.migration_id),
                            step.from_version,
                            step.to_version,
                            sql_text(&step.checksum),
                            sql_text(&diagnostics_json),
                            sql_text(&started_at),
                        ))
                        .map_err(|error| self.map_backend_error(error))?;
                    Ok(attempt)
                }
            }
        })();
        match result {
            Ok(attempt) => {
                self.backend
                    .commit()
                    .map_err(|error| self.map_backend_error(error))?;
                Ok(attempt)
            }
            Err(error) => {
                let _ = self.backend.rollback();
                Err(error)
            }
        }
    }

    fn apply_staged_step(
        &mut self,
        step: &MigrationStep,
        attempt: u64,
        diagnostics: &[MigrationDiagnostic],
    ) -> Result<(), MigrationError> {
        self.backend
            .begin_immediate()
            .map_err(|error| self.map_backend_error(error))?;
        let result = (|| {
            self.backend
                .execute(LEDGER_SCHEMA_SQL)
                .map_err(|error| self.map_backend_error(error))?;
            self.backend
                .execute(DIAGNOSTIC_SCHEMA_SQL)
                .map_err(|error| self.map_backend_error(error))?;
            let live = self
                .backend
                .live_attempt_diagnostics()
                .map_err(|error| MigrationError::Backend(error.to_string()))?;
            if live.iter().any(|diagnostic| diagnostic.blocking) {
                return Err(MigrationError::PreflightBlocked { diagnostics: live });
            }
            let identity = self
                .backend
                .schema_identity()
                .map_err(|error| MigrationError::Backend(error.to_string()))?;
            if identity.schema_version != step.from_version {
                return Err(MigrationError::InvariantViolation(format!(
                    "migration {} expected version {}, found {}",
                    step.migration_id, step.from_version, identity.schema_version
                )));
            }
            if !step.precondition_sql.trim().is_empty() {
                self.backend
                    .execute(&normalize_sql(&step.precondition_sql))
                    .map_err(|error| self.map_backend_error(error))?;
            }
            self.backend
                .execute(&normalize_sql(&step.migration_sql))
                .map_err(|error| self.map_backend_error(error))?;
            if !step.verify_sql.trim().is_empty() {
                self.backend
                    .execute(&normalize_sql(&step.verify_sql))
                    .map_err(|error| self.map_backend_error(error))?;
            }
            self.backend
                .execute(IDENTITY_SCHEMA_SQL)
                .map_err(|error| self.map_backend_error(error))?;
            let updated_at = self.backend.now();
            self.backend
                .execute(&format!(
                    "INSERT INTO {SCHEMA_IDENTITY_TABLE}
                     (identity_id, schema_id, schema_version, contract_version,
                      schema_checksum, updated_at)
                     VALUES (1, {}, {}, {}, {}, {})
                     ON CONFLICT(identity_id) DO UPDATE SET
                       schema_id = excluded.schema_id,
                       schema_version = excluded.schema_version,
                       contract_version = excluded.contract_version,
                       schema_checksum = excluded.schema_checksum,
                       updated_at = excluded.updated_at;",
                    sql_text(&self.plan.schema_id),
                    step.to_version,
                    sql_text(&self.plan.contract_version),
                    sql_text(&step.result_schema_checksum),
                    sql_text(&updated_at),
                ))
                .map_err(|error| self.map_backend_error(error))?;
            self.backend
                .execute(&format!("PRAGMA user_version = {}", step.to_version))
                .map_err(|error| self.map_backend_error(error))?;
            let after = self
                .backend
                .schema_identity()
                .map_err(|error| MigrationError::Backend(error.to_string()))?;
            if after.schema_version != step.to_version {
                return Err(MigrationError::InvariantViolation(format!(
                    "migration {} did not advance schema version",
                    step.migration_id
                )));
            }
            for diagnostic in diagnostics {
                let created_at = self.backend.now();
                self.backend
                    .execute(&format!(
                        "INSERT OR IGNORE INTO {MIGRATION_DIAGNOSTIC_TABLE}
                         (migration_id, attempt, code, entity_type, entity_id,
                          message, blocking, raw_payload, created_at)
                         VALUES ({}, {}, {}, {}, {}, {}, {}, {}, {});",
                        sql_text(&step.migration_id),
                        attempt,
                        sql_text(&diagnostic.code),
                        sql_text(&diagnostic.entity_type),
                        sql_text(&diagnostic.entity_id),
                        sql_text(&diagnostic.message),
                        if diagnostic.blocking { 1 } else { 0 },
                        sql_text(diagnostic.raw_payload.as_deref().unwrap_or("")),
                        sql_text(&created_at),
                    ))
                    .map_err(|error| self.map_backend_error(error))?;
            }
            let completed_at = self.backend.now();
            self.backend
                .execute(&format!(
                    "UPDATE {MIGRATION_LEDGER_TABLE}
                     SET state = 'applied', completed_at = {}, failure_message = NULL
                     WHERE migration_id = {} AND attempt = {} AND checksum = {};",
                    sql_text(&completed_at),
                    sql_text(&step.migration_id),
                    attempt,
                    sql_text(&step.checksum),
                ))
                .map_err(|error| self.map_backend_error(error))?;
            Ok(())
        })();
        match result {
            Ok(()) => self
                .backend
                .commit()
                .map_err(|error| self.map_backend_error(error)),
            Err(error) => {
                let _ = self.backend.rollback();
                let original = error.to_string();
                match self.record_failure(step, attempt, &original) {
                    Ok(()) => Err(error),
                    Err(recovery) => Err(MigrationError::RecoveryRequired {
                        original,
                        recovery: recovery.to_string(),
                    }),
                }
            }
        }
    }

    fn record_failure(
        &mut self,
        step: &MigrationStep,
        attempt: u64,
        message: &str,
    ) -> Result<(), MigrationError> {
        self.backend
            .begin_immediate()
            .map_err(|error| self.map_backend_error(error))?;
        let completed_at = self.backend.now();
        let result = self
            .backend
            .execute(&format!(
                "UPDATE {MIGRATION_LEDGER_TABLE}
                 SET state = 'failed', failure_message = {}, completed_at = {}
                 WHERE migration_id = {} AND attempt = {};",
                sql_text(message),
                sql_text(&completed_at),
                sql_text(&step.migration_id),
                attempt,
            ))
            .map_err(|error| self.map_backend_error(error));
        match result {
            Ok(()) => self
                .backend
                .commit()
                .map_err(|error| self.map_backend_error(error)),
            Err(error) => {
                let _ = self.backend.rollback();
                Err(error)
            }
        }
    }

    fn verify_current(&mut self, identity: &SchemaIdentity) -> Result<(), MigrationError> {
        self.ensure_target_identity(identity)?;
        if !self.plan.verify_sql.trim().is_empty() {
            self.backend
                .execute(&normalize_sql(&self.plan.verify_sql))
                .map_err(|error| MigrationError::Backend(error.to_string()))?;
        }
        let entries = self
            .backend
            .read_ledger()
            .map_err(|error| MigrationError::Backend(error.to_string()))?;

        let bootstrap = self.bootstrap_step()?;
        if let Some(entry) = latest_entry(&entries, &bootstrap.migration_id) {
            if entry.state == MigrationState::Applied && entry.checksum == bootstrap.checksum {
                return Ok(());
            }
            return Err(MigrationError::LedgerMismatch(format!(
                "current schema has a non-applied or mismatched bootstrap ledger entry {}",
                bootstrap.migration_id
            )));
        }

        for step in &self.plan.steps {
            let Some(entry) = latest_entry(&entries, &step.migration_id) else {
                return Err(MigrationError::LedgerMismatch(format!(
                    "current schema is missing applied ledger entry {}",
                    step.migration_id
                )));
            };
            if entry.state != MigrationState::Applied || entry.checksum != step.checksum {
                return Err(MigrationError::LedgerMismatch(format!(
                    "current schema has non-applied or mismatched ledger entry {}",
                    step.migration_id
                )));
            }
        }
        Ok(())
    }

    fn bootstrap_step(&self) -> Result<MigrationStep, MigrationError> {
        MigrationStep::new(
            format!("bootstrap-v{}", self.plan.target_version),
            0,
            self.plan.target_version,
            self.plan.fresh_schema_sql.clone(),
            String::new(),
            self.plan.verify_sql.clone(),
            self.plan.target_schema_checksum.clone(),
        )
    }

    fn map_backend_error<E: Display>(&self, error: E) -> MigrationError {
        MigrationError::Backend(error.to_string())
    }
}

fn latest_entry<'a>(
    entries: &'a [MigrationLedgerEntry],
    migration_id: &str,
) -> Option<&'a MigrationLedgerEntry> {
    entries
        .iter()
        .filter(|entry| entry.migration_id == migration_id)
        .max_by_key(|entry| entry.attempt)
}

fn sql_text(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

pub fn normalize_sql(sql: &str) -> String {
    sql.lines()
        .filter(|line| {
            let trimmed = line.trim().trim_end_matches(';').trim();
            let upper = trimmed.to_ascii_uppercase();
            !matches!(
                upper.as_str(),
                "BEGIN" | "BEGIN IMMEDIATE" | "COMMIT" | "ROLLBACK"
            ) && !upper.starts_with("PRAGMA USER_VERSION =")
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn diagnostics_json(diagnostics: &[MigrationDiagnostic]) -> String {
    let values = diagnostics
        .iter()
        .map(|diagnostic| {
            format!(
                "{{\"code\":{},\"entity_type\":{},\"entity_id\":{},\"message\":{},\"blocking\":{},\"raw_payload\":{}}}",
                json_text(&diagnostic.code),
                json_text(&diagnostic.entity_type),
                json_text(&diagnostic.entity_id),
                json_text(&diagnostic.message),
                if diagnostic.blocking { "true" } else { "false" },
                json_text(diagnostic.raw_payload.as_deref().unwrap_or("")),
            )
        })
        .collect::<Vec<_>>();
    format!("[{}]", values.join(","))
}

fn json_text(value: &str) -> String {
    let mut output = String::with_capacity(value.len() + 2);
    output.push('"');
    for character in value.chars() {
        match character {
            '"' => output.push_str("\\\""),
            '\\' => output.push_str("\\\\"),
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '\t' => output.push_str("\\t"),
            character if character.is_control() => {
                output.push_str(&format!("\\u{:04x}", character as u32));
            }
            character => output.push(character),
        }
    }
    output.push('"');
    output
}

pub fn checksum(bytes: &[u8]) -> String {
    use std::fmt::Write as _;

    let digest = sha256_bytes(bytes);
    let mut encoded = String::with_capacity(64);
    for byte in digest {
        write!(&mut encoded, "{byte:02x}").expect("writing to a String cannot fail");
    }
    format!("sha256:{encoded}")
}

// Small dependency-free SHA-256 implementation.  The store deliberately
// keeps SQLite dependency-light, but migration identity still needs a stable
// cryptographic digest rather than a process-random hash.
fn sha256_bytes(input: &[u8]) -> [u8; 32] {
    const INITIAL: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19,
    ];
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];
    let mut state = INITIAL;
    let bit_len = (input.len() as u64).wrapping_mul(8);
    let mut padded = input.to_vec();
    padded.push(0x80);
    while padded.len() % 64 != 56 {
        padded.push(0);
    }
    padded.extend_from_slice(&bit_len.to_be_bytes());
    for chunk in padded.chunks_exact(64) {
        let mut words = [0u32; 64];
        for (index, bytes) in chunk.chunks_exact(4).take(16).enumerate() {
            words[index] = u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
        }
        for index in 16..64 {
            let s0 = words[index - 15].rotate_right(7)
                ^ words[index - 15].rotate_right(18)
                ^ (words[index - 15] >> 3);
            let s1 = words[index - 2].rotate_right(17)
                ^ words[index - 2].rotate_right(19)
                ^ (words[index - 2] >> 10);
            words[index] = words[index - 16]
                .wrapping_add(s0)
                .wrapping_add(words[index - 7])
                .wrapping_add(s1);
        }
        let mut working = state;
        for index in 0..64 {
            let s1 = working[4].rotate_right(6)
                ^ working[4].rotate_right(11)
                ^ working[4].rotate_right(25);
            let ch = (working[4] & working[5]) ^ ((!working[4]) & working[6]);
            let temp1 = working[7]
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[index])
                .wrapping_add(words[index]);
            let s0 = working[0].rotate_right(2)
                ^ working[0].rotate_right(13)
                ^ working[0].rotate_right(22);
            let maj =
                (working[0] & working[1]) ^ (working[0] & working[2]) ^ (working[1] & working[2]);
            let temp2 = s0.wrapping_add(maj);
            working[7] = working[6];
            working[6] = working[5];
            working[5] = working[4];
            working[4] = working[3].wrapping_add(temp1);
            working[3] = working[2];
            working[2] = working[1];
            working[1] = working[0];
            working[0] = temp1.wrapping_add(temp2);
        }
        for index in 0..8 {
            state[index] = state[index].wrapping_add(working[index]);
        }
    }
    let mut result = [0u8; 32];
    for (index, word) in state.iter().enumerate() {
        result[index * 4..index * 4 + 4].copy_from_slice(&word.to_be_bytes());
    }
    result
}
