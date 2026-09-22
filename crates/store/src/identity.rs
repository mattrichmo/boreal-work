//! Durable project/database identity and separated revision boundaries.
//!
//! This module is intentionally a store seam.  It owns the additive identity
//! records while callers remain responsible for the encompassing SQLite
//! transaction, authentication, lifecycle policy, and service transport.
//! The coordinator must register this module from `lib.rs` and invoke
//! [`IdentityStore::install`] from the canonical production-open path before
//! treating the identity records as authoritative.

use std::convert::TryFrom;
use std::fmt;
use std::path::{Component, Path};

use super::{SnapshotRevision, SqliteStore, Statement, StoreError, SQLITE_DONE, SQLITE_ROW};

const IDENTITY_SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS boreal_database_identity (
  identity_id INTEGER PRIMARY KEY CHECK (identity_id = 1),
  database_instance_id TEXT NOT NULL CHECK (trim(database_instance_id) <> ''),
  restore_epoch INTEGER NOT NULL CHECK (restore_epoch > 0),
  created_at TEXT NOT NULL CHECK (trim(created_at) <> ''),
  updated_at TEXT NOT NULL CHECK (trim(updated_at) <> '')
);

CREATE TABLE IF NOT EXISTS boreal_project_identity (
  project_id TEXT PRIMARY KEY REFERENCES project(project_id),
  database_instance_id TEXT NOT NULL CHECK (trim(database_instance_id) <> ''),
  restore_epoch INTEGER NOT NULL CHECK (restore_epoch > 0),
  canonical_root TEXT NOT NULL CHECK (trim(canonical_root) <> ''),
  canonical_worktree TEXT NOT NULL CHECK (trim(canonical_worktree) <> ''),
  binding_digest TEXT NOT NULL CHECK (trim(binding_digest) <> ''),
  bound_at TEXT NOT NULL CHECK (trim(bound_at) <> ''),
  updated_at TEXT NOT NULL CHECK (trim(updated_at) <> '')
);

CREATE TABLE IF NOT EXISTS boreal_entity_revision (
  project_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  entity_revision INTEGER NOT NULL CHECK (entity_revision >= 0),
  proof_revision INTEGER NOT NULL CHECK (proof_revision >= 0),
  updated_at TEXT NOT NULL CHECK (trim(updated_at) <> ''),
  PRIMARY KEY (project_id, work_id),
  FOREIGN KEY (project_id, work_id)
    REFERENCES work_item(project_id, work_id)
);

CREATE TABLE IF NOT EXISTS boreal_attempt_fence_identity (
  project_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL REFERENCES attempt(attempt_id),
  fence INTEGER NOT NULL CHECK (fence > 0),
  database_instance_id TEXT NOT NULL CHECK (trim(database_instance_id) <> ''),
  restore_epoch INTEGER NOT NULL CHECK (restore_epoch > 0),
  revoked INTEGER NOT NULL DEFAULT 0 CHECK (revoked IN (0, 1)),
  recorded_at TEXT NOT NULL CHECK (trim(recorded_at) <> ''),
  PRIMARY KEY (project_id, attempt_id, fence),
  UNIQUE (project_id, work_id, fence),
  FOREIGN KEY (project_id, work_id)
    REFERENCES work_item(project_id, work_id),
  FOREIGN KEY (work_id, fence)
    REFERENCES attempt(work_id, fence)
);

CREATE TABLE IF NOT EXISTS boreal_operation_identity (
  operation_id TEXT PRIMARY KEY REFERENCES operation(operation_id),
  project_id TEXT NOT NULL REFERENCES project(project_id),
  database_instance_id TEXT NOT NULL CHECK (trim(database_instance_id) <> ''),
  restore_epoch INTEGER NOT NULL CHECK (restore_epoch > 0),
  state TEXT NOT NULL CHECK (state IN ('current', 'invalidated')),
  invalidated_at TEXT,
  invalidation_code TEXT,
  CHECK ((state = 'current') = (invalidated_at IS NULL AND invalidation_code IS NULL)),
  CHECK (state = 'invalidated' OR invalidated_at IS NULL)
);

CREATE TABLE IF NOT EXISTS boreal_revision_migration (
  project_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  legacy_snapshot_revision INTEGER NOT NULL CHECK (legacy_snapshot_revision >= 0),
  entity_revision INTEGER NOT NULL CHECK (entity_revision >= 0),
  proof_revision INTEGER NOT NULL CHECK (proof_revision >= 0),
  disposition TEXT NOT NULL CHECK (trim(disposition) <> ''),
  provenance_json TEXT NOT NULL CHECK (trim(provenance_json) <> ''),
  migrated_at TEXT NOT NULL CHECK (trim(migrated_at) <> ''),
  PRIMARY KEY (project_id, work_id),
  FOREIGN KEY (project_id, work_id)
    REFERENCES work_item(project_id, work_id)
);

CREATE INDEX IF NOT EXISTS boreal_attempt_fence_subject
  ON boreal_attempt_fence_identity(project_id, work_id, attempt_id, fence);
CREATE INDEX IF NOT EXISTS boreal_operation_identity_scope
  ON boreal_operation_identity(project_id, restore_epoch, state);
"#;

/// A stable opaque database lineage identity.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct DatabaseInstanceId(String);

impl DatabaseInstanceId {
    pub fn new(value: impl Into<String>) -> Result<Self, IdentityError> {
        let value = value.into();
        validate_opaque("database_instance_id", &value)?;
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for DatabaseInstanceId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

/// A strictly positive database lineage epoch.  Restore/replacement must
/// advance this value; it is never inferred from a project snapshot revision.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct RestoreEpoch(u64);

impl RestoreEpoch {
    pub const fn new(value: u64) -> Option<Self> {
        if value == 0 {
            None
        } else {
            Some(Self(value))
        }
    }

    pub const fn get(self) -> u64 {
        self.0
    }
}

impl fmt::Display for RestoreEpoch {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

/// A validated, already-canonical workspace binding supplied by the
/// application/path boundary.  The store deliberately does not resolve
/// symlinks or consult the filesystem while holding a database transaction.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct WorkspaceBinding {
    canonical_root: String,
    canonical_worktree: String,
    binding_digest: String,
}

impl WorkspaceBinding {
    pub fn new(
        canonical_root: impl Into<String>,
        canonical_worktree: impl Into<String>,
        binding_digest: impl Into<String>,
    ) -> Result<Self, IdentityError> {
        let canonical_root = canonical_root.into();
        let canonical_worktree = canonical_worktree.into();
        let binding_digest = binding_digest.into();
        validate_canonical_path("canonical_root", &canonical_root)?;
        validate_canonical_path("canonical_worktree", &canonical_worktree)?;
        if !Path::new(&canonical_worktree).starts_with(Path::new(&canonical_root)) {
            return Err(IdentityError::Invalid {
                field: "canonical_worktree".to_owned(),
                message: "workspace worktree must be inside canonical root".to_owned(),
            });
        }
        if !binding_digest.starts_with("sha256:") || binding_digest.len() <= "sha256:".len() {
            return Err(IdentityError::Invalid {
                field: "binding_digest".to_owned(),
                message: "workspace binding digest must be a non-empty sha256 value".to_owned(),
            });
        }
        Ok(Self {
            canonical_root,
            canonical_worktree,
            binding_digest,
        })
    }

    pub fn canonical_root(&self) -> &str {
        &self.canonical_root
    }

    pub fn canonical_worktree(&self) -> &str {
        &self.canonical_worktree
    }

    pub fn binding_digest(&self) -> &str {
        &self.binding_digest
    }
}

/// The database identity requested during first installation.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DatabaseIdentity {
    pub database_instance_id: DatabaseInstanceId,
    pub restore_epoch: RestoreEpoch,
}

impl DatabaseIdentity {
    pub fn new(
        database_instance_id: impl Into<String>,
        restore_epoch: u64,
    ) -> Result<Self, IdentityError> {
        Ok(Self {
            database_instance_id: DatabaseInstanceId::new(database_instance_id)?,
            restore_epoch: RestoreEpoch::new(restore_epoch).ok_or_else(|| {
                IdentityError::Invalid {
                    field: "restore_epoch".to_owned(),
                    message: "restore epoch must be positive".to_owned(),
                }
            })?,
        })
    }
}

/// Project/database/workspace context carried by a store mutation.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IdentityContext {
    pub project_id: String,
    pub database_instance_id: DatabaseInstanceId,
    pub restore_epoch: RestoreEpoch,
    pub workspace_binding_digest: String,
}

/// The separated cursors used by the storage boundary.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RevisionIdentities {
    pub project_snapshot: SnapshotRevision,
    pub entity: EntityRevision,
    pub proof: ProofRevision,
}

/// Optimistic revision of one mutable work entity.
#[derive(Clone, Copy, Debug, Default, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct EntityRevision(u64);

impl EntityRevision {
    pub const fn new(value: u64) -> Self {
        Self(value)
    }

    pub const fn get(self) -> u64 {
        self.0
    }

    fn checked_next(self) -> Result<Self, IdentityError> {
        self.0
            .checked_add(1)
            .map(Self)
            .ok_or_else(|| IdentityError::Invalid {
                field: "entity_revision".to_owned(),
                message: "entity revision overflow".to_owned(),
            })
    }
}

impl fmt::Display for EntityRevision {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

/// Revision of proof-relevant inputs and closeout context.
#[derive(Clone, Copy, Debug, Default, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct ProofRevision(u64);

impl ProofRevision {
    pub const fn new(value: u64) -> Self {
        Self(value)
    }

    pub const fn get(self) -> u64 {
        self.0
    }

    fn checked_next(self) -> Result<Self, IdentityError> {
        self.0
            .checked_add(1)
            .map(Self)
            .ok_or_else(|| IdentityError::Invalid {
                field: "proof_revision".to_owned(),
                message: "proof revision overflow".to_owned(),
            })
    }
}

impl fmt::Display for ProofRevision {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

/// Monotonic execution-write fence.  Unlike entity/proof revisions, fence
/// values authorize one attempt owner and are revoked on replacement/restore.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct AttemptFence(u64);

impl AttemptFence {
    pub const fn new(value: u64) -> Option<Self> {
        if value == 0 {
            None
        } else {
            Some(Self(value))
        }
    }

    pub const fn get(self) -> u64 {
        self.0
    }
}

impl fmt::Display for AttemptFence {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

/// Typed conflicts returned by the identity boundary.  Foreign probes do not
/// include the foreign project's stored ID or rows; stale same-project reads
/// do include the current relevant cursor for resnapshot/retry guidance.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum IdentityError {
    Store(StoreError),
    Invalid {
        field: String,
        message: String,
    },
    ProjectNotFound {
        project_id: String,
    },
    WorkNotFound {
        project_id: String,
        work_id: String,
    },
    ForeignSubject {
        project_id: String,
        subject: &'static str,
        id: String,
    },
    DatabaseInstanceConflict {
        expected: DatabaseInstanceId,
        actual: DatabaseInstanceId,
    },
    RestoreEpochConflict {
        expected: RestoreEpoch,
        actual: RestoreEpoch,
    },
    WorkspaceConflict {
        project_id: String,
    },
    StaleEntity {
        expected: EntityRevision,
        actual: EntityRevision,
    },
    StaleProof {
        expected: ProofRevision,
        actual: ProofRevision,
    },
    StaleFence {
        expected: AttemptFence,
        actual: AttemptFence,
    },
    FenceRevoked {
        fence: AttemptFence,
        epoch: RestoreEpoch,
    },
    OperationInvalidated {
        operation_id: String,
        epoch: RestoreEpoch,
    },
    RestoreEpochRegression {
        current: RestoreEpoch,
        requested: RestoreEpoch,
    },
}

impl fmt::Display for IdentityError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Store(error) => error.fmt(formatter),
            Self::Invalid { field, message } => write!(formatter, "invalid {field}: {message}"),
            Self::ProjectNotFound { project_id } => {
                write!(formatter, "project not found: {project_id}")
            }
            Self::WorkNotFound {
                project_id,
                work_id,
            } => {
                write!(
                    formatter,
                    "work not found in project {project_id}: {work_id}"
                )
            }
            Self::ForeignSubject {
                project_id,
                subject,
                id,
            } => write!(
                formatter,
                "{subject} {id} is not addressable in project {project_id}"
            ),
            Self::DatabaseInstanceConflict { expected, actual } => write!(
                formatter,
                "database instance conflict: expected {expected}, actual {actual}"
            ),
            Self::RestoreEpochConflict { expected, actual } => write!(
                formatter,
                "restore epoch conflict: expected {expected}, actual {actual}"
            ),
            Self::WorkspaceConflict { project_id } => {
                write!(
                    formatter,
                    "workspace binding conflict for project {project_id}"
                )
            }
            Self::StaleEntity { expected, actual } => {
                write!(
                    formatter,
                    "stale entity revision: expected {expected}, actual {actual}"
                )
            }
            Self::StaleProof { expected, actual } => {
                write!(
                    formatter,
                    "stale proof revision: expected {expected}, actual {actual}"
                )
            }
            Self::StaleFence { expected, actual } => {
                write!(
                    formatter,
                    "stale attempt fence: expected {expected}, actual {actual}"
                )
            }
            Self::FenceRevoked { fence, epoch } => {
                write!(
                    formatter,
                    "attempt fence {fence} revoked at restore epoch {epoch}"
                )
            }
            Self::OperationInvalidated {
                operation_id,
                epoch,
            } => write!(
                formatter,
                "operation {operation_id} invalidated by restore epoch {epoch}"
            ),
            Self::RestoreEpochRegression { current, requested } => write!(
                formatter,
                "restore epoch must advance: current {current}, requested {requested}"
            ),
        }
    }
}

impl std::error::Error for IdentityError {}

impl From<StoreError> for IdentityError {
    fn from(error: StoreError) -> Self {
        Self::Store(error)
    }
}

/// Result of the additive identity migration/repair.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct IdentityMigrationReport {
    pub entity_rows_migrated: u64,
    pub fence_rows_migrated: u64,
    pub operation_rows_migrated: u64,
    pub ambiguous_operations_invalidated: u64,
}

/// Result of a restore-epoch transition.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RestoreResult {
    pub previous: DatabaseIdentity,
    pub current: DatabaseIdentity,
    pub invalidated_operations: u64,
    pub revoked_fences: u64,
}

/// Store-owned identity/revision adapter. It never exposes the root SQLite
/// handle and requires the caller-owned root transaction for each mutation.
/// Read methods may be used outside a write transaction.
pub struct IdentityStore<'a> {
    store: &'a SqliteStore,
}

impl<'a> IdentityStore<'a> {
    pub const fn new(store: &'a SqliteStore) -> Self {
        Self { store }
    }

    /// Installs the additive identity tables and migrates old conflated
    /// project revisions into per-work entity/proof identities.  Existing
    /// terminal operation history is retained; pending/unknown legacy
    /// operation contexts are explicitly invalidated.
    pub fn install(
        &self,
        database: &DatabaseIdentity,
        now: &str,
    ) -> Result<IdentityMigrationReport, IdentityError> {
        require_text("now", now)?;
        self.store.execute_batch(IDENTITY_SCHEMA_SQL)?;
        self.ensure_database_identity(database, now)?;
        let entity_rows_migrated = self.migrate_entity_revisions(now)?;
        let fence_rows_migrated = self.migrate_fence_identities(now, database)?;
        let (operations, invalidated) = self.migrate_operation_identities(now, database)?;
        Ok(IdentityMigrationReport {
            entity_rows_migrated,
            fence_rows_migrated,
            operation_rows_migrated: operations,
            ambiguous_operations_invalidated: invalidated,
        })
    }

    pub fn database_identity(&self) -> Result<DatabaseIdentity, IdentityError> {
        let mut statement = Statement::new(
            self.store,
            "SELECT database_instance_id, restore_epoch
             FROM boreal_database_identity WHERE identity_id = 1",
        )?;
        if statement.step()? != SQLITE_ROW {
            return Err(IdentityError::Invalid {
                field: "database_identity".to_owned(),
                message: "database identity is not installed".to_owned(),
            });
        }
        Ok(DatabaseIdentity {
            database_instance_id: DatabaseInstanceId::new(statement.column_text(0)?)?,
            restore_epoch: restore_epoch_from_sql(statement.column_i64(1)?)?,
        })
    }

    /// Binds one existing project to an already validated canonical workspace.
    /// Rebinding to a different root/digest is explicit and never silent.
    pub fn bind_project(
        &self,
        project_id: &str,
        binding: &WorkspaceBinding,
        now: &str,
    ) -> Result<IdentityContext, IdentityError> {
        require_text("project_id", project_id)?;
        require_text("now", now)?;
        self.store
            .project_revision(project_id)
            .map_err(|error| match error {
                StoreError::NotFound { .. } => IdentityError::ProjectNotFound {
                    project_id: project_id.to_owned(),
                },
                other => other.into(),
            })?;
        let database = self.database_identity()?;

        let existing = self.project_identity_row(project_id)?;
        if let Some((existing_database, existing_epoch, existing_binding)) = existing {
            if existing_database != database.database_instance_id
                || existing_epoch != database.restore_epoch
                || existing_binding != *binding
            {
                return Err(IdentityError::WorkspaceConflict {
                    project_id: project_id.to_owned(),
                });
            }
        } else {
            let mut insert = Statement::new(
                self.store,
                "INSERT INTO boreal_project_identity
                   (project_id, database_instance_id, restore_epoch,
                    canonical_root, canonical_worktree, binding_digest,
                    bound_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
            )?;
            insert.bind_text(1, project_id)?;
            insert.bind_text(2, database.database_instance_id.as_str())?;
            insert.bind_i64(3, database.restore_epoch.get())?;
            insert.bind_text(4, binding.canonical_root())?;
            insert.bind_text(5, binding.canonical_worktree())?;
            insert.bind_text(6, binding.binding_digest())?;
            insert.bind_text(7, now)?;
            insert.run()?;
        }
        Ok(IdentityContext {
            project_id: project_id.to_owned(),
            database_instance_id: database.database_instance_id,
            restore_epoch: database.restore_epoch,
            workspace_binding_digest: binding.binding_digest().to_owned(),
        })
    }

    pub fn context(&self, project_id: &str) -> Result<IdentityContext, IdentityError> {
        let database = self.database_identity()?;
        let (stored_database, stored_epoch, binding) = self
            .project_identity_row(project_id)?
            .ok_or_else(|| IdentityError::ProjectNotFound {
                project_id: project_id.to_owned(),
            })?;
        if stored_database != database.database_instance_id
            || stored_epoch != database.restore_epoch
        {
            return Err(IdentityError::RestoreEpochConflict {
                expected: stored_epoch,
                actual: database.restore_epoch,
            });
        }
        Ok(IdentityContext {
            project_id: project_id.to_owned(),
            database_instance_id: database.database_instance_id,
            restore_epoch: database.restore_epoch,
            workspace_binding_digest: binding.binding_digest().to_owned(),
        })
    }

    /// Validates that a caller-supplied context still names the installed
    /// database lineage and project binding.  This is intentionally a
    /// read-only preflight for transaction-owned mutation helpers: callers
    /// can fail before inserting an operation row, while the mutation path
    /// may still re-check the context immediately before committing.
    pub(crate) fn validate_context(&self, context: &IdentityContext) -> Result<(), IdentityError> {
        self.verify_context(context)
    }

    pub fn workspace_binding(&self, project_id: &str) -> Result<WorkspaceBinding, IdentityError> {
        self.project_identity_row(project_id)?
            .map(|(_, _, binding)| binding)
            .ok_or_else(|| IdentityError::ProjectNotFound {
                project_id: project_id.to_owned(),
            })
    }

    pub fn revisions(
        &self,
        context: &IdentityContext,
        work_id: &str,
    ) -> Result<RevisionIdentities, IdentityError> {
        self.verify_context(context)?;
        self.ensure_work_scope(context, work_id)?;
        let mut statement = Statement::new(
            self.store,
            "SELECT p.project_revision, e.entity_revision, e.proof_revision
             FROM project p
             JOIN boreal_entity_revision e ON e.project_id = p.project_id
                                           AND e.work_id = ?2
             WHERE p.project_id = ?1",
        )?;
        statement.bind_text(1, &context.project_id)?;
        statement.bind_text(2, work_id)?;
        if statement.step()? != SQLITE_ROW {
            return Err(IdentityError::WorkNotFound {
                project_id: context.project_id.clone(),
                work_id: work_id.to_owned(),
            });
        }
        Ok(RevisionIdentities {
            project_snapshot: snapshot_revision_from_sql(statement.column_i64(0)?)?,
            entity: entity_revision_from_sql(statement.column_i64(1)?)?,
            proof: proof_revision_from_sql(statement.column_i64(2)?)?,
        })
    }

    /// Advances the mutable entity cursor.  `proof_relevant` controls whether
    /// the proof cursor is advanced with it; the project snapshot advances for
    /// every committed semantic mutation.
    pub fn advance_entity(
        &self,
        context: &IdentityContext,
        work_id: &str,
        expected: EntityRevision,
        proof_relevant: bool,
        now: &str,
    ) -> Result<RevisionIdentities, IdentityError> {
        require_text("now", now)?;
        self.verify_context(context)?;
        self.ensure_work_scope(context, work_id)?;
        let current = self.read_revision_pair(context, work_id)?;
        if current.entity != expected {
            return Err(IdentityError::StaleEntity {
                expected,
                actual: current.entity,
            });
        }
        let entity = expected.checked_next()?;
        let proof = if proof_relevant {
            current.proof.checked_next()?
        } else {
            current.proof
        };
        let mut update = Statement::new(
            self.store,
            "UPDATE boreal_entity_revision
             SET entity_revision = ?1, proof_revision = ?2, updated_at = ?3
             WHERE project_id = ?4 AND work_id = ?5",
        )?;
        update.bind_i64(1, entity.get())?;
        update.bind_i64(2, proof.get())?;
        update.bind_text(3, now)?;
        update.bind_text(4, &context.project_id)?;
        update.bind_text(5, work_id)?;
        update.run()?;
        if update.changes()? != 1 {
            return Err(IdentityError::WorkNotFound {
                project_id: context.project_id.clone(),
                work_id: work_id.to_owned(),
            });
        }
        let snapshot = self
            .store
            .bump_revision_in_transaction(&context.project_id)?;
        Ok(RevisionIdentities {
            project_snapshot: snapshot,
            entity,
            proof,
        })
    }

    /// Advances only proof-relevant context, retaining the entity revision.
    pub fn advance_proof(
        &self,
        context: &IdentityContext,
        work_id: &str,
        expected: ProofRevision,
        now: &str,
    ) -> Result<RevisionIdentities, IdentityError> {
        require_text("now", now)?;
        self.verify_context(context)?;
        self.ensure_work_scope(context, work_id)?;
        let current = self.read_revision_pair(context, work_id)?;
        if current.proof != expected {
            return Err(IdentityError::StaleProof {
                expected,
                actual: current.proof,
            });
        }
        let proof = expected.checked_next()?;
        let mut update = Statement::new(
            self.store,
            "UPDATE boreal_entity_revision
             SET proof_revision = ?1, updated_at = ?2
             WHERE project_id = ?3 AND work_id = ?4",
        )?;
        update.bind_i64(1, proof.get())?;
        update.bind_text(2, now)?;
        update.bind_text(3, &context.project_id)?;
        update.bind_text(4, work_id)?;
        update.run()?;
        if update.changes()? != 1 {
            return Err(IdentityError::WorkNotFound {
                project_id: context.project_id.clone(),
                work_id: work_id.to_owned(),
            });
        }
        let snapshot = self
            .store
            .bump_revision_in_transaction(&context.project_id)?;
        Ok(RevisionIdentities {
            project_snapshot: snapshot,
            entity: current.entity,
            proof,
        })
    }

    /// Records one attempt/fence identity after the canonical attempt row has
    /// been created by the root claim path.
    pub fn record_attempt_fence(
        &self,
        context: &IdentityContext,
        work_id: &str,
        attempt_id: &str,
        fence: AttemptFence,
        now: &str,
    ) -> Result<(), IdentityError> {
        require_text("attempt_id", attempt_id)?;
        require_text("now", now)?;
        self.verify_context(context)?;
        self.ensure_work_scope(context, work_id)?;
        let actual = self.attempt_subject(context, work_id, attempt_id)?;
        if actual.fence != fence {
            return Err(IdentityError::StaleFence {
                expected: fence,
                actual: actual.fence,
            });
        }
        let mut insert = Statement::new(
            self.store,
            "INSERT OR IGNORE INTO boreal_attempt_fence_identity
               (project_id, work_id, attempt_id, fence,
                database_instance_id, restore_epoch, revoked, recorded_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7)",
        )?;
        insert.bind_text(1, &context.project_id)?;
        insert.bind_text(2, work_id)?;
        insert.bind_text(3, attempt_id)?;
        insert.bind_i64(4, fence.get())?;
        insert.bind_text(5, context.database_instance_id.as_str())?;
        insert.bind_i64(6, context.restore_epoch.get())?;
        insert.bind_text(7, now)?;
        insert.run().map_err(IdentityError::from)
    }

    /// Updates liveness only.  It never advances project/entity/proof cursors.
    pub fn heartbeat(
        &self,
        context: &IdentityContext,
        work_id: &str,
        attempt_id: &str,
        fence: AttemptFence,
        at: &str,
    ) -> Result<(), IdentityError> {
        require_text("at", at)?;
        self.verify_context(context)?;
        self.ensure_work_scope(context, work_id)?;
        let actual = self.attempt_subject(context, work_id, attempt_id)?;
        if actual.fence != fence {
            return Err(IdentityError::StaleFence {
                expected: fence,
                actual: actual.fence,
            });
        }
        self.verify_fence_identity(context, work_id, attempt_id, fence)?;
        if !actual.current {
            return Err(IdentityError::FenceRevoked {
                fence,
                epoch: context.restore_epoch,
            });
        }
        let mut update = Statement::new(
            self.store,
            "UPDATE attempt SET last_heartbeat_at = ?1
             WHERE attempt_id = ?2 AND work_id = ?3 AND fence = ?4 AND current = 1",
        )?;
        update.bind_text(1, at)?;
        update.bind_text(2, attempt_id)?;
        update.bind_text(3, work_id)?;
        update.bind_i64(4, fence.get())?;
        update.run()?;
        if update.changes()? != 1 {
            return Err(IdentityError::StaleFence {
                expected: fence,
                actual: actual.fence,
            });
        }
        Ok(())
    }

    /// Registers an operation row with the current database epoch.  The root
    /// mutation must call this in the same transaction as the operation row.
    pub fn record_operation_context(
        &self,
        context: &IdentityContext,
        operation_id: &str,
    ) -> Result<(), IdentityError> {
        require_text("operation_id", operation_id)?;
        self.verify_context(context)?;
        let mut operation = Statement::new(
            self.store,
            "SELECT project_id FROM operation WHERE operation_id = ?1",
        )?;
        operation.bind_text(1, operation_id)?;
        if operation.step()? != SQLITE_ROW {
            return Err(IdentityError::OperationInvalidated {
                operation_id: operation_id.to_owned(),
                epoch: context.restore_epoch,
            });
        }
        if operation.column_text(0)? != context.project_id {
            return Err(IdentityError::ForeignSubject {
                project_id: context.project_id.clone(),
                subject: "operation",
                id: operation_id.to_owned(),
            });
        }
        let mut existing = Statement::new(
            self.store,
            "SELECT project_id, database_instance_id, restore_epoch, state
             FROM boreal_operation_identity WHERE operation_id = ?1",
        )?;
        existing.bind_text(1, operation_id)?;
        if existing.step()? == SQLITE_ROW {
            let stored_project = existing.column_text(0)?;
            if stored_project != context.project_id {
                return Err(IdentityError::ForeignSubject {
                    project_id: context.project_id.clone(),
                    subject: "operation",
                    id: operation_id.to_owned(),
                });
            }
            let stored_database = DatabaseInstanceId::new(existing.column_text(1)?)?;
            let stored_epoch = restore_epoch_from_sql(existing.column_i64(2)?)?;
            if stored_database != context.database_instance_id {
                return Err(IdentityError::DatabaseInstanceConflict {
                    expected: context.database_instance_id.clone(),
                    actual: stored_database,
                });
            }
            if stored_epoch != context.restore_epoch {
                return Err(IdentityError::RestoreEpochConflict {
                    expected: context.restore_epoch,
                    actual: stored_epoch,
                });
            }
            if existing.column_text(3)? == "invalidated" {
                return Err(IdentityError::OperationInvalidated {
                    operation_id: operation_id.to_owned(),
                    epoch: stored_epoch,
                });
            }
            return Ok(());
        }
        let mut insert = Statement::new(
            self.store,
            "INSERT INTO boreal_operation_identity
               (operation_id, project_id, database_instance_id, restore_epoch,
                state, invalidated_at, invalidation_code)
             VALUES (?1, ?2, ?3, ?4, 'current', NULL, NULL)",
        )?;
        insert.bind_text(1, operation_id)?;
        insert.bind_text(2, &context.project_id)?;
        insert.bind_text(3, context.database_instance_id.as_str())?;
        insert.bind_i64(4, context.restore_epoch.get())?;
        insert.run().map_err(IdentityError::from)
    }

    /// Reads an operation only if its project/epoch identity remains current.
    pub fn operation(
        &self,
        context: &IdentityContext,
        operation_id: &str,
    ) -> Result<Option<super::OperationReadback>, IdentityError> {
        require_text("operation_id", operation_id)?;
        self.verify_context(context)?;
        let mut identity = Statement::new(
            self.store,
            "SELECT project_id, database_instance_id, restore_epoch, state
             FROM boreal_operation_identity WHERE operation_id = ?1",
        )?;
        identity.bind_text(1, operation_id)?;
        if identity.step()? != SQLITE_ROW {
            return Ok(None);
        }
        let project_id = identity.column_text(0)?;
        if project_id != context.project_id {
            return Err(IdentityError::ForeignSubject {
                project_id: context.project_id.clone(),
                subject: "operation",
                id: operation_id.to_owned(),
            });
        }
        let database_instance_id = DatabaseInstanceId::new(identity.column_text(1)?)?;
        let epoch = restore_epoch_from_sql(identity.column_i64(2)?)?;
        if database_instance_id != context.database_instance_id {
            return Err(IdentityError::DatabaseInstanceConflict {
                expected: context.database_instance_id.clone(),
                actual: database_instance_id,
            });
        }
        if epoch != context.restore_epoch {
            return Err(IdentityError::RestoreEpochConflict {
                expected: context.restore_epoch,
                actual: epoch,
            });
        }
        if identity.column_text(3)? == "invalidated" {
            return Err(IdentityError::OperationInvalidated {
                operation_id: operation_id.to_owned(),
                epoch,
            });
        }
        self.store
            .operation_readback(&context.project_id, operation_id)
            .map_err(IdentityError::from)
    }

    /// Advances the database lineage and revokes every old operation/fence
    /// context without deleting historical rows.
    pub fn restore(
        &self,
        database_instance_id: impl Into<String>,
        restore_epoch: u64,
        now: &str,
    ) -> Result<RestoreResult, IdentityError> {
        require_text("now", now)?;
        let requested = DatabaseIdentity::new(database_instance_id, restore_epoch)?;
        let previous = self.database_identity()?;
        if requested.restore_epoch <= previous.restore_epoch {
            return Err(IdentityError::RestoreEpochRegression {
                current: previous.restore_epoch,
                requested: requested.restore_epoch,
            });
        }
        let mut update_database = Statement::new(
            self.store,
            "UPDATE boreal_database_identity
             SET database_instance_id = ?1, restore_epoch = ?2, updated_at = ?3
             WHERE identity_id = 1",
        )?;
        update_database.bind_text(1, requested.database_instance_id.as_str())?;
        update_database.bind_i64(2, requested.restore_epoch.get())?;
        update_database.bind_text(3, now)?;
        update_database.run()?;
        if update_database.changes()? != 1 {
            return Err(IdentityError::Invalid {
                field: "database_identity".to_owned(),
                message: "database identity row disappeared during restore".to_owned(),
            });
        }

        let mut projects = Statement::new(
            self.store,
            "UPDATE boreal_project_identity
             SET database_instance_id = ?1, restore_epoch = ?2, updated_at = ?3",
        )?;
        projects.bind_text(1, requested.database_instance_id.as_str())?;
        projects.bind_i64(2, requested.restore_epoch.get())?;
        projects.bind_text(3, now)?;
        projects.run()?;

        let mut operations = Statement::new(
            self.store,
            "UPDATE boreal_operation_identity
             SET database_instance_id = ?1, restore_epoch = ?2,
                 state = 'invalidated', invalidated_at = ?3,
                 invalidation_code = 'restore_epoch_changed'
             WHERE state = 'current'",
        )?;
        operations.bind_text(1, requested.database_instance_id.as_str())?;
        operations.bind_i64(2, requested.restore_epoch.get())?;
        operations.bind_text(3, now)?;
        operations.run()?;
        let invalidated_operations =
            checked_change_count(operations.changes()?, "invalidated_operations")?;

        let mut fences = Statement::new(
            self.store,
            "UPDATE boreal_attempt_fence_identity
             SET database_instance_id = ?1, restore_epoch = ?2, revoked = 1
             WHERE revoked = 0",
        )?;
        fences.bind_text(1, requested.database_instance_id.as_str())?;
        fences.bind_i64(2, requested.restore_epoch.get())?;
        fences.run()?;
        let revoked_fences = checked_change_count(fences.changes()?, "revoked_fences")?;
        Ok(RestoreResult {
            previous,
            current: requested,
            invalidated_operations,
            revoked_fences,
        })
    }

    fn ensure_database_identity(
        &self,
        requested: &DatabaseIdentity,
        now: &str,
    ) -> Result<(), IdentityError> {
        let mut select = Statement::new(
            self.store,
            "SELECT database_instance_id, restore_epoch
             FROM boreal_database_identity WHERE identity_id = 1",
        )?;
        if select.step()? == SQLITE_ROW {
            let actual = DatabaseIdentity {
                database_instance_id: DatabaseInstanceId::new(select.column_text(0)?)?,
                restore_epoch: restore_epoch_from_sql(select.column_i64(1)?)?,
            };
            if actual != *requested {
                if actual.database_instance_id != requested.database_instance_id {
                    return Err(IdentityError::DatabaseInstanceConflict {
                        expected: requested.database_instance_id.clone(),
                        actual: actual.database_instance_id,
                    });
                }
                return Err(IdentityError::RestoreEpochConflict {
                    expected: requested.restore_epoch,
                    actual: actual.restore_epoch,
                });
            }
            return Ok(());
        }
        let mut insert = Statement::new(
            self.store,
            "INSERT INTO boreal_database_identity
               (identity_id, database_instance_id, restore_epoch, created_at, updated_at)
             VALUES (1, ?1, ?2, ?3, ?3)",
        )?;
        insert.bind_text(1, requested.database_instance_id.as_str())?;
        insert.bind_i64(2, requested.restore_epoch.get())?;
        insert.bind_text(3, now)?;
        insert.run().map_err(IdentityError::from)
    }

    fn project_identity_row(
        &self,
        project_id: &str,
    ) -> Result<Option<(DatabaseInstanceId, RestoreEpoch, WorkspaceBinding)>, IdentityError> {
        let mut statement = Statement::new(
            self.store,
            "SELECT database_instance_id, restore_epoch,
                    canonical_root, canonical_worktree, binding_digest
             FROM boreal_project_identity WHERE project_id = ?1",
        )?;
        statement.bind_text(1, project_id)?;
        if statement.step()? != SQLITE_ROW {
            return Ok(None);
        }
        Ok(Some((
            DatabaseInstanceId::new(statement.column_text(0)?)?,
            restore_epoch_from_sql(statement.column_i64(1)?)?,
            WorkspaceBinding::new(
                statement.column_text(2)?,
                statement.column_text(3)?,
                statement.column_text(4)?,
            )?,
        )))
    }

    fn verify_context(&self, context: &IdentityContext) -> Result<(), IdentityError> {
        require_text("project_id", &context.project_id)?;
        let database = self.database_identity()?;
        if context.database_instance_id != database.database_instance_id {
            return Err(IdentityError::DatabaseInstanceConflict {
                expected: context.database_instance_id.clone(),
                actual: database.database_instance_id,
            });
        }
        if context.restore_epoch != database.restore_epoch {
            return Err(IdentityError::RestoreEpochConflict {
                expected: context.restore_epoch,
                actual: database.restore_epoch,
            });
        }
        let (project_database, project_epoch, binding) = self
            .project_identity_row(&context.project_id)?
            .ok_or_else(|| IdentityError::ProjectNotFound {
                project_id: context.project_id.clone(),
            })?;
        if project_database != context.database_instance_id {
            return Err(IdentityError::DatabaseInstanceConflict {
                expected: context.database_instance_id.clone(),
                actual: project_database,
            });
        }
        if project_epoch != context.restore_epoch {
            return Err(IdentityError::RestoreEpochConflict {
                expected: context.restore_epoch,
                actual: project_epoch,
            });
        }
        if binding.binding_digest() != context.workspace_binding_digest {
            return Err(IdentityError::WorkspaceConflict {
                project_id: context.project_id.clone(),
            });
        }
        Ok(())
    }

    fn ensure_work_scope(
        &self,
        context: &IdentityContext,
        work_id: &str,
    ) -> Result<(), IdentityError> {
        let mut statement = Statement::new(
            self.store,
            "SELECT project_id FROM work_item WHERE work_id = ?1",
        )?;
        statement.bind_text(1, work_id)?;
        match statement.step()? {
            SQLITE_ROW => {
                if statement.column_text(0)? != context.project_id {
                    return Err(IdentityError::ForeignSubject {
                        project_id: context.project_id.clone(),
                        subject: "work",
                        id: work_id.to_owned(),
                    });
                }
                Ok(())
            }
            SQLITE_DONE => Err(IdentityError::WorkNotFound {
                project_id: context.project_id.clone(),
                work_id: work_id.to_owned(),
            }),
            _ => unreachable!(),
        }
    }

    fn read_revision_pair(
        &self,
        context: &IdentityContext,
        work_id: &str,
    ) -> Result<RevisionIdentities, IdentityError> {
        let mut statement = Statement::new(
            self.store,
            "SELECT p.project_revision, e.entity_revision, e.proof_revision
             FROM project p
             JOIN boreal_entity_revision e ON e.project_id = p.project_id
                                           AND e.work_id = ?2
             WHERE p.project_id = ?1",
        )?;
        statement.bind_text(1, &context.project_id)?;
        statement.bind_text(2, work_id)?;
        if statement.step()? != SQLITE_ROW {
            return Err(IdentityError::WorkNotFound {
                project_id: context.project_id.clone(),
                work_id: work_id.to_owned(),
            });
        }
        Ok(RevisionIdentities {
            project_snapshot: snapshot_revision_from_sql(statement.column_i64(0)?)?,
            entity: entity_revision_from_sql(statement.column_i64(1)?)?,
            proof: proof_revision_from_sql(statement.column_i64(2)?)?,
        })
    }

    fn attempt_subject(
        &self,
        context: &IdentityContext,
        work_id: &str,
        attempt_id: &str,
    ) -> Result<AttemptSubject, IdentityError> {
        let mut statement = Statement::new(
            self.store,
            "SELECT a.fence, a.current
             FROM attempt a
             JOIN work_item w ON w.work_id = a.work_id
             WHERE w.project_id = ?1 AND a.work_id = ?2 AND a.attempt_id = ?3",
        )?;
        statement.bind_text(1, &context.project_id)?;
        statement.bind_text(2, work_id)?;
        statement.bind_text(3, attempt_id)?;
        if statement.step()? != SQLITE_ROW {
            return Err(IdentityError::ForeignSubject {
                project_id: context.project_id.clone(),
                subject: "attempt",
                id: attempt_id.to_owned(),
            });
        }
        Ok(AttemptSubject {
            fence: attempt_fence_from_sql(statement.column_i64(0)?)?,
            current: statement.column_i64(1)? == 1,
        })
    }

    fn verify_fence_identity(
        &self,
        context: &IdentityContext,
        work_id: &str,
        attempt_id: &str,
        fence: AttemptFence,
    ) -> Result<(), IdentityError> {
        let mut statement = Statement::new(
            self.store,
            "SELECT database_instance_id, restore_epoch, revoked
             FROM boreal_attempt_fence_identity
             WHERE project_id = ?1 AND work_id = ?2
               AND attempt_id = ?3 AND fence = ?4",
        )?;
        statement.bind_text(1, &context.project_id)?;
        statement.bind_text(2, work_id)?;
        statement.bind_text(3, attempt_id)?;
        statement.bind_i64(4, fence.get())?;
        if statement.step()? != SQLITE_ROW {
            return Err(IdentityError::FenceRevoked {
                fence,
                epoch: context.restore_epoch,
            });
        }
        let database = DatabaseInstanceId::new(statement.column_text(0)?)?;
        let epoch = restore_epoch_from_sql(statement.column_i64(1)?)?;
        if database != context.database_instance_id || epoch != context.restore_epoch {
            return Err(IdentityError::FenceRevoked {
                fence,
                epoch: context.restore_epoch,
            });
        }
        if statement.column_i64(2)? != 0 {
            return Err(IdentityError::FenceRevoked {
                fence,
                epoch: context.restore_epoch,
            });
        }
        Ok(())
    }

    fn migrate_entity_revisions(&self, now: &str) -> Result<u64, IdentityError> {
        let mut rows = Statement::new(
            self.store,
            "SELECT w.project_id, w.work_id, p.project_revision
             FROM work_item w JOIN project p ON p.project_id = w.project_id
             ORDER BY w.project_id, w.work_id",
        )?;
        let mut migrated = 0_u64;
        while rows.step()? == SQLITE_ROW {
            let project_id = rows.column_text(0)?;
            let work_id = rows.column_text(1)?;
            let legacy = snapshot_revision_from_sql(rows.column_i64(2)?)?;
            let mut entity = Statement::new(
                self.store,
                "INSERT OR IGNORE INTO boreal_entity_revision
                   (project_id, work_id, entity_revision, proof_revision, updated_at)
                 VALUES (?1, ?2, ?3, ?3, ?4)",
            )?;
            entity.bind_text(1, &project_id)?;
            entity.bind_text(2, &work_id)?;
            entity.bind_i64(3, legacy.0)?;
            entity.bind_text(4, now)?;
            entity.run()?;
            migrated = migrated.saturating_add(checked_change_count(
                entity.changes()?,
                "entity_rows_migrated",
            )?);

            let mut provenance = Statement::new(
                self.store,
                "INSERT OR IGNORE INTO boreal_revision_migration
                   (project_id, work_id, legacy_snapshot_revision,
                    entity_revision, proof_revision, disposition,
                    provenance_json, migrated_at)
                 VALUES (?1, ?2, ?3, ?3, ?3, 'split_from_project_revision', ?4, ?5)",
            )?;
            provenance.bind_text(1, &project_id)?;
            provenance.bind_text(2, &work_id)?;
            provenance.bind_i64(3, legacy.0)?;
            provenance.bind_text(
                4,
                &format!(
                    "{{\"source\":\"project.project_revision\",\"legacy_revision\":{}}}",
                    legacy.0
                ),
            )?;
            provenance.bind_text(5, now)?;
            provenance.run()?;
        }
        Ok(migrated)
    }

    fn migrate_fence_identities(
        &self,
        now: &str,
        database: &DatabaseIdentity,
    ) -> Result<u64, IdentityError> {
        let mut rows = Statement::new(
            self.store,
            "SELECT w.project_id, a.work_id, a.attempt_id, a.fence
             FROM attempt a JOIN work_item w ON w.work_id = a.work_id
             ORDER BY w.project_id, a.attempt_id",
        )?;
        let mut migrated = 0_u64;
        while rows.step()? == SQLITE_ROW {
            let mut insert = Statement::new(
                self.store,
                "INSERT OR IGNORE INTO boreal_attempt_fence_identity
                   (project_id, work_id, attempt_id, fence,
                    database_instance_id, restore_epoch, revoked, recorded_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7)",
            )?;
            insert.bind_text(1, &rows.column_text(0)?)?;
            insert.bind_text(2, &rows.column_text(1)?)?;
            insert.bind_text(3, &rows.column_text(2)?)?;
            insert.bind_i64(4, attempt_fence_from_sql(rows.column_i64(3)?)?.get())?;
            insert.bind_text(5, database.database_instance_id.as_str())?;
            insert.bind_i64(6, database.restore_epoch.get())?;
            insert.bind_text(7, now)?;
            insert.run()?;
            migrated = migrated.saturating_add(checked_change_count(
                insert.changes()?,
                "fence_rows_migrated",
            )?);
        }
        Ok(migrated)
    }

    fn migrate_operation_identities(
        &self,
        now: &str,
        database: &DatabaseIdentity,
    ) -> Result<(u64, u64), IdentityError> {
        let mut rows = Statement::new(
            self.store,
            "SELECT operation_id, project_id, outcome, completed_at
             FROM operation ORDER BY operation_id",
        )?;
        let mut migrated = 0_u64;
        let mut invalidated = 0_u64;
        while rows.step()? == SQLITE_ROW {
            let operation_id = rows.column_text(0)?;
            let project_id = rows.column_text(1)?;
            let outcome = rows.column_text(2)?;
            let completed = rows.column_optional_text(3)?;
            let ambiguous = completed.is_none() || matches!(outcome.as_str(), "busy" | "unknown");
            let mut insert = Statement::new(
                self.store,
                "INSERT OR IGNORE INTO boreal_operation_identity
                   (operation_id, project_id, database_instance_id, restore_epoch,
                    state, invalidated_at, invalidation_code)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            )?;
            insert.bind_text(1, &operation_id)?;
            insert.bind_text(2, &project_id)?;
            insert.bind_text(3, database.database_instance_id.as_str())?;
            insert.bind_i64(4, database.restore_epoch.get())?;
            insert.bind_text(5, if ambiguous { "invalidated" } else { "current" })?;
            insert.bind_optional_text(6, ambiguous.then_some(now))?;
            insert.bind_optional_text(7, ambiguous.then_some("legacy_conflated_revision"))?;
            insert.run()?;
            let inserted = checked_change_count(insert.changes()?, "operation_rows_migrated")?;
            migrated = migrated.saturating_add(inserted);
            if inserted == 1 && ambiguous {
                invalidated = invalidated.saturating_add(1);
            }
        }
        Ok((migrated, invalidated))
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct AttemptSubject {
    fence: AttemptFence,
    current: bool,
}

fn require_text(field: &str, value: &str) -> Result<(), IdentityError> {
    if value.trim().is_empty() || value.contains('\0') {
        return Err(IdentityError::Invalid {
            field: field.to_owned(),
            message: "value must be non-empty and NUL-free".to_owned(),
        });
    }
    Ok(())
}

fn validate_opaque(field: &str, value: &str) -> Result<(), IdentityError> {
    require_text(field, value)?;
    if value
        .chars()
        .any(|character| character.is_control() || character.is_whitespace())
    {
        return Err(IdentityError::Invalid {
            field: field.to_owned(),
            message: "opaque identity contains whitespace or control characters".to_owned(),
        });
    }
    Ok(())
}

fn validate_canonical_path(field: &str, value: &str) -> Result<(), IdentityError> {
    require_text(field, value)?;
    let path = Path::new(value);
    if !path.is_absolute()
        || path
            .components()
            .any(|component| matches!(component, Component::CurDir | Component::ParentDir))
    {
        return Err(IdentityError::Invalid {
            field: field.to_owned(),
            message: "path must be absolute and already canonical".to_owned(),
        });
    }
    Ok(())
}

fn snapshot_revision_from_sql(value: i64) -> Result<SnapshotRevision, IdentityError> {
    Ok(SnapshotRevision(checked_u64("project_snapshot", value)?))
}

fn entity_revision_from_sql(value: i64) -> Result<EntityRevision, IdentityError> {
    Ok(EntityRevision(checked_u64("entity_revision", value)?))
}

fn proof_revision_from_sql(value: i64) -> Result<ProofRevision, IdentityError> {
    Ok(ProofRevision(checked_u64("proof_revision", value)?))
}

fn attempt_fence_from_sql(value: i64) -> Result<AttemptFence, IdentityError> {
    AttemptFence::new(checked_u64("attempt_fence", value)?).ok_or_else(|| IdentityError::Invalid {
        field: "attempt_fence".to_owned(),
        message: "attempt fence must be positive".to_owned(),
    })
}

fn restore_epoch_from_sql(value: i64) -> Result<RestoreEpoch, IdentityError> {
    RestoreEpoch::new(checked_u64("restore_epoch", value)?).ok_or_else(|| IdentityError::Invalid {
        field: "restore_epoch".to_owned(),
        message: "restore epoch must be positive".to_owned(),
    })
}

fn checked_u64(field: &str, value: i64) -> Result<u64, IdentityError> {
    u64::try_from(value).map_err(|_| IdentityError::Invalid {
        field: field.to_owned(),
        message: format!("SQLite value must be non-negative: {value}"),
    })
}

fn checked_change_count(value: i32, field: &str) -> Result<u64, IdentityError> {
    u64::try_from(value).map_err(|_| IdentityError::Invalid {
        field: field.to_owned(),
        message: "SQLite change count was negative".to_owned(),
    })
}

impl TryFrom<i64> for EntityRevision {
    type Error = IdentityError;

    fn try_from(value: i64) -> Result<Self, Self::Error> {
        entity_revision_from_sql(value)
    }
}

impl TryFrom<EntityRevision> for i64 {
    type Error = IdentityError;

    fn try_from(value: EntityRevision) -> Result<Self, Self::Error> {
        i64::try_from(value.0).map_err(|_| IdentityError::Invalid {
            field: "entity_revision".to_owned(),
            message: format!("revision is too large for SQLite: {}", value.0),
        })
    }
}

impl TryFrom<i64> for ProofRevision {
    type Error = IdentityError;

    fn try_from(value: i64) -> Result<Self, Self::Error> {
        proof_revision_from_sql(value)
    }
}

impl TryFrom<ProofRevision> for i64 {
    type Error = IdentityError;

    fn try_from(value: ProofRevision) -> Result<Self, Self::Error> {
        i64::try_from(value.0).map_err(|_| IdentityError::Invalid {
            field: "proof_revision".to_owned(),
            message: format!("revision is too large for SQLite: {}", value.0),
        })
    }
}

impl TryFrom<i64> for AttemptFence {
    type Error = IdentityError;

    fn try_from(value: i64) -> Result<Self, Self::Error> {
        attempt_fence_from_sql(value)
    }
}

impl TryFrom<AttemptFence> for i64 {
    type Error = IdentityError;

    fn try_from(value: AttemptFence) -> Result<Self, Self::Error> {
        i64::try_from(value.0).map_err(|_| IdentityError::Invalid {
            field: "attempt_fence".to_owned(),
            message: format!("fence is too large for SQLite: {}", value.0),
        })
    }
}

impl TryFrom<i64> for RestoreEpoch {
    type Error = IdentityError;

    fn try_from(value: i64) -> Result<Self, Self::Error> {
        restore_epoch_from_sql(value)
    }
}

impl TryFrom<RestoreEpoch> for i64 {
    type Error = IdentityError;

    fn try_from(value: RestoreEpoch) -> Result<Self, Self::Error> {
        i64::try_from(value.0).map_err(|_| IdentityError::Invalid {
            field: "restore_epoch".to_owned(),
            message: format!("epoch is too large for SQLite: {}", value.0),
        })
    }
}
