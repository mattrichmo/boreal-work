//! Durable external-job registration and side-effect readback.
//!
//! A job is an outbox/readback record, not a process runner.  The application
//! registers it before invoking a verifier, Git, backup, update, or stop
//! adapter; an interrupted response leaves the stage readable and
//! reconcilable instead of being guessed as success or failure.

use super::{
    identity::{IdentityContext, IdentityStore},
    SqliteStore, StoreError,
};

const SQLITE_ROW: i32 = 100;
const JOB_STAGES: &[&str] = &[
    "registered",
    "admitted",
    "running",
    "side_effect_started",
    "side_effect_finished",
    "readback_required",
    "committed",
    "rejected",
    "failed",
    "cancel_requested",
    "reconciled",
];

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExternalJobInput {
    pub job_id: String,
    pub operation_id: String,
    pub project_id: String,
    pub subject_type: String,
    pub subject_id: String,
    pub kind: String,
    pub request_digest: String,
    pub source_identity: Option<String>,
    pub config_identity: Option<String>,
    pub actor_id: String,
    pub session_id: Option<String>,
    pub deadline: Option<String>,
    pub created_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExternalJobRecord {
    pub job_id: String,
    pub operation_id: String,
    pub project_id: String,
    pub subject_type: String,
    pub subject_id: String,
    pub kind: String,
    pub request_digest: String,
    pub stage: String,
    pub side_effect_ref: Option<String>,
    pub source_identity: Option<String>,
    pub config_identity: Option<String>,
    pub actor_id: String,
    pub session_id: Option<String>,
    pub started_at: Option<String>,
    pub deadline: Option<String>,
    pub result_digest: Option<String>,
    pub reconciliation_state: String,
    pub error_message: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExternalJobRegistration {
    pub job: ExternalJobRecord,
    pub replayed: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExternalJobTransitionInput {
    pub project_id: String,
    pub job_id: String,
    pub expected_stage: String,
    pub next_stage: String,
    pub at: String,
    pub side_effect_ref: Option<String>,
    pub result_digest: Option<String>,
    pub error_message: Option<String>,
}

pub fn ensure_external_job_schema(store: &SqliteStore) -> Result<(), StoreError> {
    store.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS boreal_external_job (
          job_id TEXT PRIMARY KEY,
          operation_id TEXT NOT NULL UNIQUE,
          project_id TEXT NOT NULL REFERENCES project(project_id),
          subject_type TEXT NOT NULL CHECK (trim(subject_type) <> ''),
          subject_id TEXT NOT NULL CHECK (trim(subject_id) <> ''),
          kind TEXT NOT NULL CHECK (trim(kind) <> ''),
          request_digest TEXT NOT NULL CHECK (trim(request_digest) <> ''),
          stage TEXT NOT NULL CHECK (stage IN
            ('registered','admitted','running','side_effect_started',
             'side_effect_finished','readback_required','committed','rejected',
             'failed','cancel_requested','reconciled')),
          side_effect_ref TEXT,
          source_identity TEXT,
          config_identity TEXT,
          actor_id TEXT NOT NULL CHECK (trim(actor_id) <> ''),
          session_id TEXT,
          started_at TEXT,
          deadline TEXT,
          result_digest TEXT,
          reconciliation_state TEXT NOT NULL CHECK (trim(reconciliation_state) <> ''),
          error_message TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS boreal_external_job_project_stage
          ON boreal_external_job(project_id, stage, job_id);
        CREATE INDEX IF NOT EXISTS boreal_external_job_readback
          ON boreal_external_job(project_id, operation_id)
          WHERE stage IN ('side_effect_started','side_effect_finished','readback_required');
        CREATE TRIGGER IF NOT EXISTS boreal_external_job_identity_guard
        BEFORE UPDATE OF job_id, operation_id, project_id, subject_type, subject_id,
          kind, request_digest, source_identity, config_identity, actor_id,
          session_id, deadline, created_at ON boreal_external_job
        BEGIN
          SELECT RAISE(ABORT, 'external_job_identity_append_only');
        END;
        "#,
    )
}

impl SqliteStore {
    pub fn ensure_external_job_schema(&self) -> Result<(), StoreError> {
        ensure_external_job_schema(self)
    }

    pub fn register_external_job(
        &self,
        input: &ExternalJobInput,
    ) -> Result<ExternalJobRegistration, StoreError> {
        validate_input(input)?;
        ensure_legacy_external_job_compatibility(self, &input.project_id)?;
        with_transaction(self, || {
            validate_job_subject(self, input)?;
            register_external_job_row(self, input)
        })
    }

    /// Registers an external effect only after proving that the operation is
    /// current in the supplied database lineage and has a matching audit
    /// record. The job is an outbox/readback sidecar; it never creates a
    /// second audit event for the operation.
    pub fn register_external_job_with_identity(
        &self,
        context: &IdentityContext,
        input: &ExternalJobInput,
    ) -> Result<ExternalJobRegistration, StoreError> {
        validate_input(input)?;
        if input.project_id != context.project_id {
            return Err(StoreError::WrongSubject {
                expected: context.project_id.clone(),
                actual: input.project_id.clone(),
            });
        }
        with_transaction(self, || {
            validate_job_authority(self, context, input)?;
            validate_job_subject(self, input)?;
            register_external_job_row(self, input)
        })
    }

    pub fn external_job(
        &self,
        project_id: &str,
        job_id: &str,
    ) -> Result<Option<ExternalJobRecord>, StoreError> {
        ensure_legacy_external_job_compatibility(self, project_id)?;
        self.external_job_row(project_id, job_id)
    }

    fn external_job_row(
        &self,
        project_id: &str,
        job_id: &str,
    ) -> Result<Option<ExternalJobRecord>, StoreError> {
        let mut statement = self.prepare(
            "SELECT job_id, operation_id, project_id, subject_type, subject_id, kind,
                    request_digest, stage, side_effect_ref, source_identity, config_identity,
                    actor_id, session_id, started_at, deadline, result_digest,
                    reconciliation_state, error_message, created_at, updated_at
             FROM boreal_external_job
             WHERE project_id = ?1 AND job_id = ?2",
        )?;
        statement.bind_text(1, project_id)?;
        statement.bind_text(2, job_id)?;
        if statement.step()? != SQLITE_ROW {
            return Ok(None);
        }
        Ok(Some(job_from_statement(&statement)?))
    }

    pub fn list_external_jobs(
        &self,
        project_id: &str,
        after_id: Option<&str>,
        limit: u32,
    ) -> Result<Vec<ExternalJobRecord>, StoreError> {
        ensure_legacy_external_job_compatibility(self, project_id)?;
        let limit = bounded_limit(limit)?;
        let mut statement = self.prepare(
            "SELECT job_id, operation_id, project_id, subject_type, subject_id, kind,
                    request_digest, stage, side_effect_ref, source_identity, config_identity,
                    actor_id, session_id, started_at, deadline, result_digest,
                    reconciliation_state, error_message, created_at, updated_at
             FROM boreal_external_job
             WHERE project_id = ?1
               AND stage NOT IN ('committed','reconciled','rejected','failed')
               AND (?2 IS NULL OR job_id > ?2)
             ORDER BY job_id LIMIT ?3",
        )?;
        statement.bind_text(1, project_id)?;
        statement.bind_optional_text(2, after_id)?;
        statement.bind_i64(3, limit as u64)?;
        let mut jobs = Vec::new();
        while statement.step()? == SQLITE_ROW {
            jobs.push(job_from_statement(&statement)?);
        }
        Ok(jobs)
    }

    pub fn advance_external_job(
        &self,
        input: &ExternalJobTransitionInput,
    ) -> Result<ExternalJobRecord, StoreError> {
        validate_transition_input(input)?;
        ensure_legacy_external_job_compatibility(self, &input.project_id)?;
        with_transaction(self, || advance_external_job_row(self, input))
    }

    /// Advances an external effect only when its original operation and audit
    /// identities still belong to the supplied current project context.
    pub fn advance_external_job_with_identity(
        &self,
        context: &IdentityContext,
        input: &ExternalJobTransitionInput,
    ) -> Result<ExternalJobRecord, StoreError> {
        validate_transition_input(input)?;
        if input.project_id != context.project_id {
            return Err(StoreError::WrongSubject {
                expected: context.project_id.clone(),
                actual: input.project_id.clone(),
            });
        }
        with_transaction(self, || {
            let current = self
                .external_job_row(&input.project_id, &input.job_id)?
                .ok_or_else(|| StoreError::NotFound {
                    entity: "external_job",
                    id: input.job_id.clone(),
                })?;
            validate_existing_job_authority(self, context, &current)?;
            advance_external_job_row(self, input)
        })
    }

    /// Explicit readback marker for the crash window after a side effect but
    /// before its result reached the store. It is deliberately not a success
    /// result and keeps the job eligible for a side-effect identity check.
    pub fn mark_external_job_readback_required(
        &self,
        project_id: &str,
        job_id: &str,
        side_effect_ref: &str,
        at: &str,
    ) -> Result<ExternalJobRecord, StoreError> {
        require_text(side_effect_ref, "external side-effect reference")?;
        let current =
            self.external_job(project_id, job_id)?
                .ok_or_else(|| StoreError::NotFound {
                    entity: "external_job",
                    id: job_id.to_owned(),
                })?;
        if current.stage == "readback_required" {
            return if current.side_effect_ref.as_deref() == Some(side_effect_ref) {
                Ok(current)
            } else {
                Err(StoreError::Conflict(
                    "external readback side-effect identity changed during replay".to_owned(),
                ))
            };
        }
        self.advance_external_job(&ExternalJobTransitionInput {
            project_id: project_id.to_owned(),
            job_id: job_id.to_owned(),
            expected_stage: current.stage,
            next_stage: "readback_required".to_owned(),
            at: at.to_owned(),
            side_effect_ref: Some(side_effect_ref.to_owned()),
            result_digest: None,
            error_message: None,
        })
    }

    pub fn mark_external_job_readback_required_with_identity(
        &self,
        context: &IdentityContext,
        job_id: &str,
        side_effect_ref: &str,
        at: &str,
    ) -> Result<ExternalJobRecord, StoreError> {
        require_text(side_effect_ref, "external side-effect reference")?;
        let current = self
            .external_job_with_identity(context, job_id)?
            .ok_or_else(|| StoreError::NotFound {
                entity: "external_job",
                id: job_id.to_owned(),
            })?;
        if current.stage == "readback_required" {
            return if current.side_effect_ref.as_deref() == Some(side_effect_ref) {
                Ok(current)
            } else {
                Err(StoreError::Conflict(
                    "external readback side-effect identity changed during replay".to_owned(),
                ))
            };
        }
        self.advance_external_job_with_identity(
            context,
            &ExternalJobTransitionInput {
                project_id: context.project_id.clone(),
                job_id: job_id.to_owned(),
                expected_stage: current.stage,
                next_stage: "readback_required".to_owned(),
                at: at.to_owned(),
                side_effect_ref: Some(side_effect_ref.to_owned()),
                result_digest: None,
                error_message: None,
            },
        )
    }

    /// Reads a job only when its operation/audit identity is current in the
    /// supplied database lineage. Unbound compatibility readers must use the
    /// legacy `external_job` method explicitly.
    pub fn external_job_with_identity(
        &self,
        context: &IdentityContext,
        job_id: &str,
    ) -> Result<Option<ExternalJobRecord>, StoreError> {
        IdentityStore::new(self)
            .validate_context(context)
            .map_err(|error| StoreError::Conflict(format!("external job identity: {error}")))?;
        let Some(job) = self.external_job_row(&context.project_id, job_id)? else {
            return Ok(None);
        };
        validate_existing_job_authority(self, context, &job)?;
        Ok(Some(job))
    }

    pub fn external_job_by_operation(
        &self,
        project_id: &str,
        operation_id: &str,
    ) -> Result<Option<ExternalJobRecord>, StoreError> {
        ensure_legacy_external_job_compatibility(self, project_id)?;
        self.external_job_by_operation_row(project_id, operation_id)
    }

    /// Reads an external job by its operation only after validating the
    /// current project/database lineage and the operation's audited subject.
    pub fn external_job_by_operation_with_identity(
        &self,
        context: &IdentityContext,
        operation_id: &str,
    ) -> Result<Option<ExternalJobRecord>, StoreError> {
        IdentityStore::new(self)
            .validate_context(context)
            .map_err(|error| StoreError::Conflict(format!("external job identity: {error}")))?;
        let Some(job) = self.external_job_by_operation_row(&context.project_id, operation_id)?
        else {
            return Ok(None);
        };
        validate_existing_job_authority(self, context, &job)?;
        Ok(Some(job))
    }

    fn external_job_by_operation_row(
        &self,
        project_id: &str,
        operation_id: &str,
    ) -> Result<Option<ExternalJobRecord>, StoreError> {
        let mut statement = self.prepare(
            "SELECT job_id, operation_id, project_id, subject_type, subject_id, kind,
                    request_digest, stage, side_effect_ref, source_identity, config_identity,
                    actor_id, session_id, started_at, deadline, result_digest,
                    reconciliation_state, error_message, created_at, updated_at
             FROM boreal_external_job
             WHERE project_id = ?1 AND operation_id = ?2",
        )?;
        statement.bind_text(1, project_id)?;
        statement.bind_text(2, operation_id)?;
        if statement.step()? != SQLITE_ROW {
            return Ok(None);
        }
        Ok(Some(job_from_statement(&statement)?))
    }
}

fn register_external_job_row(
    store: &SqliteStore,
    input: &ExternalJobInput,
) -> Result<ExternalJobRegistration, StoreError> {
    if let Some(existing) =
        store.external_job_by_operation_row(&input.project_id, &input.operation_id)?
    {
        if !same_request(&existing, input) {
            return Err(StoreError::Conflict(format!(
                "external job operation {} was reused with a different request",
                input.operation_id
            )));
        }
        return Ok(ExternalJobRegistration {
            job: existing,
            replayed: true,
        });
    }
    let mut statement = store.prepare(
        "INSERT INTO boreal_external_job
         (job_id, operation_id, project_id, subject_type, subject_id, kind,
          request_digest, stage, source_identity, config_identity, actor_id,
          session_id, deadline, reconciliation_state, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'registered', ?8, ?9, ?10,
                 ?11, ?12, 'pending', ?13, ?13)",
    )?;
    statement.bind_text(1, &input.job_id)?;
    statement.bind_text(2, &input.operation_id)?;
    statement.bind_text(3, &input.project_id)?;
    statement.bind_text(4, &input.subject_type)?;
    statement.bind_text(5, &input.subject_id)?;
    statement.bind_text(6, &input.kind)?;
    statement.bind_text(7, &input.request_digest)?;
    statement.bind_optional_text(8, input.source_identity.as_deref())?;
    statement.bind_optional_text(9, input.config_identity.as_deref())?;
    statement.bind_text(10, &input.actor_id)?;
    statement.bind_optional_text(11, input.session_id.as_deref())?;
    statement.bind_optional_text(12, input.deadline.as_deref())?;
    statement.bind_text(13, &input.created_at)?;
    statement.run()?;
    let job = store
        .external_job_row(&input.project_id, &input.job_id)?
        .ok_or_else(|| {
            StoreError::Corrupt("external job disappeared after registration".to_owned())
        })?;
    Ok(ExternalJobRegistration {
        job,
        replayed: false,
    })
}

fn advance_external_job_row(
    store: &SqliteStore,
    input: &ExternalJobTransitionInput,
) -> Result<ExternalJobRecord, StoreError> {
    let current = store
        .external_job_row(&input.project_id, &input.job_id)?
        .ok_or_else(|| StoreError::NotFound {
            entity: "external_job",
            id: input.job_id.clone(),
        })?;
    if current.stage != input.expected_stage {
        return Err(StoreError::Conflict(format!(
            "external job stage changed: expected {}, actual {}",
            input.expected_stage, current.stage
        )));
    }
    if let (Some(existing), Some(candidate)) = (
        current.side_effect_ref.as_deref(),
        input.side_effect_ref.as_deref(),
    ) {
        if existing != candidate {
            return Err(StoreError::Conflict(
                "external side-effect identity cannot be changed".to_owned(),
            ));
        }
    }
    if let (Some(existing), Some(candidate)) = (
        current.result_digest.as_deref(),
        input.result_digest.as_deref(),
    ) {
        if existing != candidate {
            return Err(StoreError::Conflict(
                "external result identity cannot be changed".to_owned(),
            ));
        }
    }
    if input.next_stage == "readback_required"
        && current.side_effect_ref.is_none()
        && input.side_effect_ref.is_none()
    {
        return Err(StoreError::Invalid(
            "readback-required job must retain a side-effect reference".to_owned(),
        ));
    }
    if matches!(input.next_stage.as_str(), "committed" | "reconciled")
        && current.result_digest.is_none()
        && input.result_digest.is_none()
    {
        return Err(StoreError::Invalid(
            "terminal external job state requires a result digest".to_owned(),
        ));
    }
    let started_at = if current.started_at.is_some() {
        current.started_at.as_deref()
    } else {
        Some(input.at.as_str())
    };
    let mut update = store.prepare(
        "UPDATE boreal_external_job
         SET stage = ?1, side_effect_ref = COALESCE(?2, side_effect_ref),
             started_at = COALESCE(started_at, ?3),
             result_digest = COALESCE(?4, result_digest),
             error_message = ?5, reconciliation_state = ?6, updated_at = ?7
         WHERE project_id = ?8 AND job_id = ?9 AND stage = ?10",
    )?;
    update.bind_text(1, &input.next_stage)?;
    update.bind_optional_text(2, input.side_effect_ref.as_deref())?;
    update.bind_optional_text(3, started_at)?;
    update.bind_optional_text(4, input.result_digest.as_deref())?;
    update.bind_optional_text(5, input.error_message.as_deref())?;
    update.bind_text(6, reconciliation_state(&input.next_stage))?;
    update.bind_text(7, &input.at)?;
    update.bind_text(8, &input.project_id)?;
    update.bind_text(9, &input.job_id)?;
    update.bind_text(10, &input.expected_stage)?;
    update.run()?;
    store
        .external_job_row(&input.project_id, &input.job_id)?
        .ok_or_else(|| StoreError::Corrupt("external job disappeared after transition".to_owned()))
}

fn validate_transition_input(input: &ExternalJobTransitionInput) -> Result<(), StoreError> {
    require_text(&input.project_id, "job project id")?;
    require_text(&input.job_id, "job id")?;
    require_job_stage(&input.expected_stage)?;
    require_job_stage(&input.next_stage)?;
    require_text(&input.at, "job timestamp")?;
    if !valid_transition(&input.expected_stage, &input.next_stage) {
        return Err(StoreError::Conflict(format!(
            "illegal external job transition: {} -> {}",
            input.expected_stage, input.next_stage
        )));
    }
    Ok(())
}

fn validate_job_subject(store: &SqliteStore, input: &ExternalJobInput) -> Result<(), StoreError> {
    let project = store.project_for_work(&input.subject_id).ok();
    if input.subject_type == "work" && project.as_deref() != Some(input.project_id.as_str()) {
        return Err(StoreError::WrongSubject {
            expected: input.project_id.clone(),
            actual: project.unwrap_or_else(|| "missing work".to_owned()),
        });
    }
    Ok(())
}

fn validate_job_authority(
    store: &SqliteStore,
    context: &IdentityContext,
    input: &ExternalJobInput,
) -> Result<(), StoreError> {
    if input.project_id != context.project_id {
        return Err(StoreError::WrongSubject {
            expected: context.project_id.clone(),
            actual: input.project_id.clone(),
        });
    }
    validate_operation_authority(
        store,
        context,
        &input.operation_id,
        &input.request_digest,
        &input.actor_id,
        input.session_id.as_deref(),
        Some((&input.subject_type, &input.subject_id)),
    )
}

fn validate_existing_job_authority(
    store: &SqliteStore,
    context: &IdentityContext,
    job: &ExternalJobRecord,
) -> Result<(), StoreError> {
    if job.project_id != context.project_id {
        return Err(StoreError::WrongSubject {
            expected: context.project_id.clone(),
            actual: job.project_id.clone(),
        });
    }
    validate_operation_authority(
        store,
        context,
        &job.operation_id,
        &job.request_digest,
        &job.actor_id,
        job.session_id.as_deref(),
        Some((&job.subject_type, &job.subject_id)),
    )
}

fn validate_operation_authority(
    store: &SqliteStore,
    context: &IdentityContext,
    operation_id: &str,
    request_digest: &str,
    actor_id: &str,
    session_id: Option<&str>,
    subject: Option<(&str, &str)>,
) -> Result<(), StoreError> {
    IdentityStore::new(store)
        .validate_context(context)
        .map_err(|error| StoreError::Conflict(format!("external job identity: {error}")))?;
    let readback = IdentityStore::new(store)
        .operation(context, operation_id)
        .map_err(|error| {
            StoreError::Conflict(format!("external job operation identity: {error}"))
        })?;
    let operation = match readback.and_then(|readback| readback.operation) {
        Some(operation) => operation,
        None if store.operation_exists(operation_id)? => {
            return Err(StoreError::Corrupt(
                "external job operation has no current identity readback".to_owned(),
            ));
        }
        None => {
            return Err(StoreError::NotFound {
                entity: "operation",
                id: operation_id.to_owned(),
            });
        }
    };
    if operation.project_id != context.project_id {
        return Err(StoreError::WrongSubject {
            expected: context.project_id.clone(),
            actual: operation.project_id,
        });
    }
    if operation.request_digest != request_digest {
        return Err(StoreError::Conflict(
            "external job request digest differs from its operation".to_owned(),
        ));
    }
    if operation.actor_id != actor_id {
        return Err(StoreError::WrongOwner {
            expected: operation.actor_id,
            actual: actor_id.to_owned(),
        });
    }
    if operation.session_id.as_deref() != session_id {
        return Err(StoreError::Conflict(
            "external job session identity differs from its operation".to_owned(),
        ));
    }
    let audit = store.audit_event(operation_id)?.ok_or_else(|| {
        StoreError::Corrupt("external job operation has no audit event".to_owned())
    })?;
    if audit.project_id != operation.project_id
        || audit.operation_id != operation.operation_id
        || audit.actor_id != operation.actor_id
        || audit.session_id != operation.session_id
        || audit.fence != operation.fence
        || audit.revision != operation.revision
    {
        return Err(StoreError::Corrupt(
            "external job operation and audit identities disagree".to_owned(),
        ));
    }
    if let Some((subject_type, subject_id)) = subject {
        if audit.subject_type != subject_type || audit.subject_id != subject_id {
            return Err(StoreError::WrongSubject {
                expected: format!("{subject_type}/{subject_id}"),
                actual: format!("{}/{}", audit.subject_type, audit.subject_id),
            });
        }
    }
    Ok(())
}

/// The old methods are intentionally retained for schema-v2 fixture callers.
/// They are not a production authority path: canonical production and any
/// project already bound to the additive identity tables must use the
/// `*_with_identity` methods above.
fn ensure_legacy_external_job_compatibility(
    store: &SqliteStore,
    project_id: &str,
) -> Result<(), StoreError> {
    if store.canonical_production
        || (store.identity_tables_installed()? && store.project_identity_is_bound(project_id)?)
    {
        return Err(StoreError::Conflict(
            "external job requires a current project identity and audited operation; use the identity-bound API".to_owned(),
        ));
    }
    Ok(())
}

fn with_transaction<T>(
    store: &SqliteStore,
    body: impl FnOnce() -> Result<T, StoreError>,
) -> Result<T, StoreError> {
    store.execute_batch("BEGIN IMMEDIATE")?;
    match body() {
        Ok(value) => match store.execute_batch("COMMIT") {
            Ok(()) => Ok(value),
            Err(error) => {
                let _ = store.execute_batch("ROLLBACK");
                Err(error)
            }
        },
        Err(error) => {
            let _ = store.execute_batch("ROLLBACK");
            Err(error)
        }
    }
}

fn validate_input(input: &ExternalJobInput) -> Result<(), StoreError> {
    for (value, label) in [
        (&input.job_id, "job id"),
        (&input.operation_id, "operation id"),
        (&input.project_id, "project id"),
        (&input.subject_type, "subject type"),
        (&input.subject_id, "subject id"),
        (&input.kind, "job kind"),
        (&input.request_digest, "request digest"),
        (&input.actor_id, "job actor"),
        (&input.created_at, "creation timestamp"),
    ] {
        require_text(value, label)?;
    }
    Ok(())
}

fn same_request(existing: &ExternalJobRecord, input: &ExternalJobInput) -> bool {
    existing.job_id == input.job_id
        && existing.project_id == input.project_id
        && existing.subject_type == input.subject_type
        && existing.subject_id == input.subject_id
        && existing.kind == input.kind
        && existing.request_digest == input.request_digest
        && existing.source_identity == input.source_identity
        && existing.config_identity == input.config_identity
        && existing.actor_id == input.actor_id
        && existing.session_id == input.session_id
        && existing.deadline == input.deadline
}

fn require_job_stage(value: &str) -> Result<(), StoreError> {
    if JOB_STAGES.contains(&value) {
        Ok(())
    } else {
        Err(StoreError::Invalid(format!(
            "unsupported external job stage: {value}"
        )))
    }
}

fn valid_transition(from: &str, to: &str) -> bool {
    matches!(
        (from, to),
        ("registered", "admitted" | "rejected" | "failed")
            | ("admitted", "running" | "rejected" | "failed")
            | (
                "running",
                "side_effect_started" | "failed" | "cancel_requested"
            )
            | (
                "side_effect_started",
                "side_effect_finished" | "readback_required" | "failed"
            )
            | (
                "side_effect_finished",
                "committed" | "readback_required" | "failed"
            )
            | ("readback_required", "reconciled" | "failed")
            | ("cancel_requested", "reconciled" | "failed")
    )
}

fn reconciliation_state(stage: &str) -> &'static str {
    match stage {
        "committed" | "reconciled" => "resolved",
        "rejected" | "failed" => "terminal",
        "readback_required" => "required",
        _ => "pending",
    }
}

fn require_text(value: &str, label: &str) -> Result<(), StoreError> {
    if value.trim().is_empty() {
        Err(StoreError::Invalid(format!("{label} must not be empty")))
    } else {
        Ok(())
    }
}

fn bounded_limit(value: u32) -> Result<u32, StoreError> {
    if value == 0 || value > 500 {
        Err(StoreError::Invalid(
            "bounded query limit must be between 1 and 500".to_owned(),
        ))
    } else {
        Ok(value)
    }
}

fn job_from_statement(statement: &super::Statement<'_>) -> Result<ExternalJobRecord, StoreError> {
    let stage = statement.column_text(7)?;
    require_job_stage(&stage)?;
    Ok(ExternalJobRecord {
        job_id: statement.column_text(0)?,
        operation_id: statement.column_text(1)?,
        project_id: statement.column_text(2)?,
        subject_type: statement.column_text(3)?,
        subject_id: statement.column_text(4)?,
        kind: statement.column_text(5)?,
        request_digest: statement.column_text(6)?,
        stage,
        side_effect_ref: statement.column_optional_text(8)?,
        source_identity: statement.column_optional_text(9)?,
        config_identity: statement.column_optional_text(10)?,
        actor_id: statement.column_text(11)?,
        session_id: statement.column_optional_text(12)?,
        started_at: statement.column_optional_text(13)?,
        deadline: statement.column_optional_text(14)?,
        result_digest: statement.column_optional_text(15)?,
        reconciliation_state: statement.column_text(16)?,
        error_message: statement.column_optional_text(17)?,
        created_at: statement.column_text(18)?,
        updated_at: statement.column_text(19)?,
    })
}
