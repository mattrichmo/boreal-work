//! Durable recovery and resource-ownership records.
//!
//! This module is intentionally a store seam.  The coordinator must register
//! it from the canonical root and invoke `ensure_recovery_schema` from the
//! production migration/open path before these records can authorize a
//! lifecycle operation.  It never clears an attempt or decides that a task is
//! ready; it preserves the recovery fact that the application must evaluate.

use super::{
    identity::{IdentityContext, IdentityStore},
    operations::{OperationBundle, OperationIdentity, OperationJournal},
    AuditEventRecord, OperationOutcome, OperationReadback, OperationRecord, SqliteStore,
    StoreError,
};

const SQLITE_ROW: i32 = 100;

const RECOVERY_REASONS: &[&str] = &[
    "expired",
    "stop_unknown",
    "resource_unknown",
    "failed",
    "cancel_requested",
];
const RECOVERY_STATES: &[&str] = &["unresolved", "resolved", "superseded"];
const RESOURCE_STATES: &[&str] = &["active", "release_pending", "unknown", "released"];

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RecoveryObligationInput {
    pub obligation_id: String,
    pub project_id: String,
    pub work_id: String,
    pub attempt_id: Option<String>,
    pub fence: Option<u64>,
    pub reason: String,
    pub resource_state: String,
    pub owner_actor_id: Option<String>,
    pub next_action: String,
    pub created_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RecoveryObligationRecord {
    pub obligation_id: String,
    pub project_id: String,
    pub work_id: String,
    pub attempt_id: Option<String>,
    pub fence: Option<u64>,
    pub reason: String,
    pub state: String,
    pub resource_state: String,
    pub owner_actor_id: Option<String>,
    pub next_action: String,
    pub created_at: String,
    pub resolved_at: Option<String>,
    pub resolved_by: Option<String>,
    pub resolution_id: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RecoveryDecisionInput {
    pub decision_id: String,
    pub obligation_id: String,
    pub project_id: String,
    pub actor_id: String,
    pub outcome: String,
    pub reason: String,
    pub resource_state: String,
    pub created_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RecoveryDecisionRecord {
    pub decision_id: String,
    pub obligation_id: String,
    pub project_id: String,
    pub actor_id: String,
    pub outcome: String,
    pub reason: String,
    pub resource_state: String,
    pub created_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RecoveryResolutionInput {
    pub project_id: String,
    pub obligation_id: String,
    pub resolution_id: String,
    pub actor_id: String,
    pub outcome: String,
    pub reason: String,
    pub resource_state: String,
    pub at: String,
}

/// Identity and concurrency envelope for the production recovery mutation.
///
/// The older [`RecoveryResolutionInput`] remains available for compatibility
/// with the pre-operation-journal store seam. New application callers should
/// use this envelope so the resolution, operation, audit event, and project
/// revision share one transaction and one database lineage context.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IdentityBoundRecoveryResolutionInput {
    pub context: IdentityContext,
    pub operation_id: String,
    pub request_digest: String,
    pub expected_project_revision: Option<u64>,
    pub session_id: Option<String>,
    pub resolution: RecoveryResolutionInput,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RecoveryResolutionResult {
    pub obligation: RecoveryObligationRecord,
    pub operation: OperationReadback,
    pub replayed: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResourceReservationInput {
    pub reservation_id: String,
    pub project_id: String,
    pub work_id: String,
    pub attempt_id: String,
    pub fence: u64,
    pub resource_key: String,
    pub resource_kind: String,
    pub owner_actor_id: String,
    pub created_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResourceReservationRecord {
    pub reservation_id: String,
    pub project_id: String,
    pub work_id: String,
    pub attempt_id: String,
    pub fence: u64,
    pub resource_key: String,
    pub resource_kind: String,
    pub state: String,
    pub owner_actor_id: String,
    pub created_at: String,
    pub release_requested_at: Option<String>,
    pub released_at: Option<String>,
    pub release_ack_id: Option<String>,
}

/// The task's additive schema seam.  The integration steward must call this
/// from the ordered production migration/open path.  Existing duplicate live
/// attempts or sessions deliberately make the unique-index creation fail
/// closed; no data is silently repaired here.
pub fn ensure_recovery_schema(store: &SqliteStore) -> Result<(), StoreError> {
    store.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS boreal_recovery_obligation (
          obligation_id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES project(project_id),
          work_id TEXT NOT NULL REFERENCES work_item(work_id),
          attempt_id TEXT REFERENCES attempt(attempt_id),
          fence INTEGER CHECK (fence IS NULL OR fence > 0),
          reason TEXT NOT NULL CHECK (reason IN
            ('expired','stop_unknown','resource_unknown','failed','cancel_requested')),
          state TEXT NOT NULL CHECK (state IN ('unresolved','resolved','superseded')),
          resource_state TEXT NOT NULL CHECK
            (resource_state IN ('active','release_pending','unknown','released')),
          owner_actor_id TEXT,
          next_action TEXT NOT NULL CHECK (trim(next_action) <> ''),
          created_at TEXT NOT NULL,
          resolved_at TEXT,
          resolved_by TEXT,
          resolution_id TEXT,
          CHECK (state = 'unresolved' OR
                 (resolved_at IS NOT NULL AND resolved_by IS NOT NULL AND resolution_id IS NOT NULL)),
          CHECK (attempt_id IS NOT NULL OR fence IS NULL)
        );
        CREATE INDEX IF NOT EXISTS boreal_recovery_unresolved
          ON boreal_recovery_obligation(project_id, obligation_id)
          WHERE state = 'unresolved';

        CREATE TABLE IF NOT EXISTS boreal_recovery_decision (
          decision_id TEXT PRIMARY KEY,
          obligation_id TEXT NOT NULL REFERENCES boreal_recovery_obligation(obligation_id),
          project_id TEXT NOT NULL REFERENCES project(project_id),
          actor_id TEXT NOT NULL,
          outcome TEXT NOT NULL CHECK (trim(outcome) <> ''),
          reason TEXT NOT NULL CHECK (trim(reason) <> ''),
          resource_state TEXT NOT NULL CHECK
            (resource_state IN ('active','release_pending','unknown','released')),
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS boreal_recovery_decision_subject
          ON boreal_recovery_decision(project_id, obligation_id, created_at, decision_id);

        CREATE TABLE IF NOT EXISTS boreal_resource_reservation (
          reservation_id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES project(project_id),
          work_id TEXT NOT NULL REFERENCES work_item(work_id),
          attempt_id TEXT NOT NULL REFERENCES attempt(attempt_id),
          fence INTEGER NOT NULL CHECK (fence > 0),
          resource_key TEXT NOT NULL CHECK (trim(resource_key) <> ''),
          resource_kind TEXT NOT NULL CHECK (trim(resource_kind) <> ''),
          state TEXT NOT NULL CHECK
            (state IN ('active','release_pending','unknown','released')),
          owner_actor_id TEXT NOT NULL CHECK (trim(owner_actor_id) <> ''),
          created_at TEXT NOT NULL,
          release_requested_at TEXT,
          released_at TEXT,
          release_ack_id TEXT,
          CHECK (state = 'active' OR release_requested_at IS NOT NULL),
          CHECK (state <> 'released' OR (released_at IS NOT NULL AND release_ack_id IS NOT NULL))
        );
        CREATE UNIQUE INDEX IF NOT EXISTS boreal_resource_live_key
          ON boreal_resource_reservation(project_id, resource_key)
          WHERE state IN ('active','release_pending','unknown');
        CREATE INDEX IF NOT EXISTS boreal_resource_attempt
          ON boreal_resource_reservation(project_id, attempt_id, fence);

        CREATE TABLE IF NOT EXISTS boreal_resource_release_event (
          event_id TEXT PRIMARY KEY,
          reservation_id TEXT NOT NULL REFERENCES boreal_resource_reservation(reservation_id),
          project_id TEXT NOT NULL REFERENCES project(project_id),
          state TEXT NOT NULL CHECK (state IN ('requested','acknowledged')),
          actor_id TEXT NOT NULL,
          evidence_ref TEXT NOT NULL CHECK (trim(evidence_ref) <> ''),
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS boreal_resource_release_subject
          ON boreal_resource_release_event(project_id, reservation_id, created_at, event_id);

        DROP TRIGGER IF EXISTS boreal_recovery_decision_append_only_update;
        CREATE TRIGGER boreal_recovery_decision_append_only_update
          BEFORE UPDATE ON boreal_recovery_decision
        BEGIN
          SELECT RAISE(ABORT, 'recovery_decision_append_only');
        END;
        DROP TRIGGER IF EXISTS boreal_recovery_decision_append_only_delete;
        CREATE TRIGGER boreal_recovery_decision_append_only_delete
          BEFORE DELETE ON boreal_recovery_decision
        BEGIN
          SELECT RAISE(ABORT, 'recovery_decision_append_only');
        END;

        CREATE UNIQUE INDEX IF NOT EXISTS attempt_current_work_owner
          ON attempt(work_id) WHERE current = 1;
        CREATE UNIQUE INDEX IF NOT EXISTS attempt_current_session_owner
          ON attempt(session_id) WHERE current = 1 AND session_id IS NOT NULL;
        "#,
    )
}

impl SqliteStore {
    /// Registers the additive recovery tables and database-level ownership
    /// constraints. The coordinator should invoke this in schema setup, not
    /// lazily after a lifecycle mutation has already been admitted.
    pub fn ensure_recovery_schema(&self) -> Result<(), StoreError> {
        ensure_recovery_schema(self)
    }

    pub fn create_recovery_obligation(
        &self,
        input: &RecoveryObligationInput,
    ) -> Result<RecoveryObligationRecord, StoreError> {
        validate_obligation_input(input)?;
        let expected_project = self.project_for_work(&input.work_id)?;
        if expected_project != input.project_id {
            return Err(StoreError::WrongSubject {
                expected: input.project_id.clone(),
                actual: expected_project,
            });
        }
        if let Some(attempt_id) = &input.attempt_id {
            let attempt =
                self.attempt_record(attempt_id, false)?
                    .ok_or_else(|| StoreError::NotFound {
                        entity: "attempt",
                        id: attempt_id.clone(),
                    })?;
            if attempt.project_id != input.project_id || attempt.work_id != input.work_id {
                return Err(StoreError::WrongSubject {
                    expected: format!("{}/{}", input.project_id, input.work_id),
                    actual: format!("{}/{}", attempt.project_id, attempt.work_id),
                });
            }
            if input.fence != Some(attempt.fence) {
                return Err(StoreError::StaleFence {
                    expected: input.fence.unwrap_or_default(),
                    actual: attempt.fence,
                });
            }
        }
        with_transaction(self, || {
            self.create_recovery_obligation_in_transaction(input)
        })
    }

    /// Inserts a recovery obligation without opening a nested transaction.
    /// Lifecycle mutations use this form while their attempt, operation,
    /// audit and revision rows are already inside one `BEGIN IMMEDIATE`.
    pub(crate) fn create_recovery_obligation_in_transaction(
        &self,
        input: &RecoveryObligationInput,
    ) -> Result<RecoveryObligationRecord, StoreError> {
        validate_obligation_input(input)?;
        let expected_project = self.project_for_work(&input.work_id)?;
        if expected_project != input.project_id {
            return Err(StoreError::WrongSubject {
                expected: input.project_id.clone(),
                actual: expected_project,
            });
        }
        if let Some(attempt_id) = &input.attempt_id {
            let attempt =
                self.attempt_record(attempt_id, false)?
                    .ok_or_else(|| StoreError::NotFound {
                        entity: "attempt",
                        id: attempt_id.clone(),
                    })?;
            if attempt.project_id != input.project_id || attempt.work_id != input.work_id {
                return Err(StoreError::WrongSubject {
                    expected: format!("{}/{}", input.project_id, input.work_id),
                    actual: format!("{}/{}", attempt.project_id, attempt.work_id),
                });
            }
            if input.fence != Some(attempt.fence) {
                return Err(StoreError::StaleFence {
                    expected: input.fence.unwrap_or_default(),
                    actual: attempt.fence,
                });
            }
        }
        let mut statement = self.prepare(
            "INSERT INTO boreal_recovery_obligation
             (obligation_id, project_id, work_id, attempt_id, fence, reason, state,
              resource_state, owner_actor_id, next_action, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'unresolved', ?7, ?8, ?9, ?10)",
        )?;
        statement.bind_text(1, &input.obligation_id)?;
        statement.bind_text(2, &input.project_id)?;
        statement.bind_text(3, &input.work_id)?;
        statement.bind_optional_text(4, input.attempt_id.as_deref())?;
        statement.bind_optional_i64(5, input.fence)?;
        statement.bind_text(6, &input.reason)?;
        statement.bind_text(7, &input.resource_state)?;
        statement.bind_optional_text(8, input.owner_actor_id.as_deref())?;
        statement.bind_text(9, &input.next_action)?;
        statement.bind_text(10, &input.created_at)?;
        statement.run()?;
        self.recovery_obligation(&input.project_id, &input.obligation_id)?
            .ok_or_else(|| {
                StoreError::Corrupt("recovery obligation disappeared after insert".to_owned())
            })
    }

    pub fn recovery_obligation(
        &self,
        project_id: &str,
        obligation_id: &str,
    ) -> Result<Option<RecoveryObligationRecord>, StoreError> {
        let mut statement = self.prepare(
            "SELECT obligation_id, project_id, work_id, attempt_id, fence, reason, state,
                    resource_state, owner_actor_id, next_action, created_at, resolved_at,
                    resolved_by, resolution_id
             FROM boreal_recovery_obligation
             WHERE project_id = ?1 AND obligation_id = ?2",
        )?;
        statement.bind_text(1, project_id)?;
        statement.bind_text(2, obligation_id)?;
        if statement.step()? != SQLITE_ROW {
            return Ok(None);
        }
        Ok(Some(recovery_from_statement(&statement)?))
    }

    pub fn list_unresolved_recovery_obligations(
        &self,
        project_id: &str,
        after_id: Option<&str>,
        limit: u32,
    ) -> Result<Vec<RecoveryObligationRecord>, StoreError> {
        let limit = bounded_limit(limit)?;
        let mut statement = self.prepare(
            "SELECT obligation_id, project_id, work_id, attempt_id, fence, reason, state,
                    resource_state, owner_actor_id, next_action, created_at, resolved_at,
                    resolved_by, resolution_id
             FROM boreal_recovery_obligation
             WHERE project_id = ?1 AND state = 'unresolved'
               AND (?2 IS NULL OR obligation_id > ?2)
             ORDER BY obligation_id LIMIT ?3",
        )?;
        statement.bind_text(1, project_id)?;
        statement.bind_optional_text(2, after_id)?;
        statement.bind_i64(3, limit as u64)?;
        let mut records = Vec::new();
        while statement.step()? == SQLITE_ROW {
            records.push(recovery_from_statement(&statement)?);
        }
        Ok(records)
    }

    pub fn resolve_recovery_obligation(
        &self,
        input: &RecoveryResolutionInput,
    ) -> Result<RecoveryObligationRecord, StoreError> {
        for value in [
            input.resolution_id.as_str(),
            input.actor_id.as_str(),
            input.outcome.as_str(),
            input.reason.as_str(),
            input.at.as_str(),
        ] {
            require_text(value, "recovery resolution")?;
        }
        require_resource_state(&input.resource_state)?;
        with_transaction(self, || {
            let current = self
                .recovery_obligation(&input.project_id, &input.obligation_id)?
                .ok_or_else(|| StoreError::NotFound {
                    entity: "recovery_obligation",
                    id: input.obligation_id.clone(),
                })?;
            if current.state != "unresolved" {
                return Err(StoreError::Conflict(format!(
                    "recovery obligation is already {}: {}",
                    current.state, input.obligation_id
                )));
            }
            let mut decision = self.prepare(
                "INSERT INTO boreal_recovery_decision
                 (decision_id, obligation_id, project_id, actor_id, outcome, reason,
                  resource_state, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            )?;
            decision.bind_text(1, &input.resolution_id)?;
            decision.bind_text(2, &input.obligation_id)?;
            decision.bind_text(3, &input.project_id)?;
            decision.bind_text(4, &input.actor_id)?;
            decision.bind_text(5, &input.outcome)?;
            decision.bind_text(6, &input.reason)?;
            decision.bind_text(7, &input.resource_state)?;
            decision.bind_text(8, &input.at)?;
            decision.run()?;

            let mut update = self.prepare(
                "UPDATE boreal_recovery_obligation
                 SET state = 'resolved', resource_state = ?1, resolved_at = ?2,
                     resolved_by = ?3, resolution_id = ?4
                 WHERE project_id = ?5 AND obligation_id = ?6 AND state = 'unresolved'",
            )?;
            update.bind_text(1, &input.resource_state)?;
            update.bind_text(2, &input.at)?;
            update.bind_text(3, &input.actor_id)?;
            update.bind_text(4, &input.resolution_id)?;
            update.bind_text(5, &input.project_id)?;
            update.bind_text(6, &input.obligation_id)?;
            update.run()?;
            self.recovery_obligation(&input.project_id, &input.obligation_id)?
                .ok_or_else(|| {
                    StoreError::Corrupt("resolved recovery obligation disappeared".to_owned())
                })
        })
    }

    /// Resolves one obligation through the production operation boundary.
    ///
    /// The obligation's attempt/fence is re-read while the write transaction
    /// is held. A project revision precondition is checked before the revision
    /// bump, and the decision, resolved obligation, operation identity, and
    /// audit event commit or roll back together. Reusing the same operation ID
    /// and request identity returns the durable result without inserting a
    /// second decision or advancing the project revision.
    pub fn resolve_recovery_obligation_with_identity(
        &self,
        input: &IdentityBoundRecoveryResolutionInput,
    ) -> Result<RecoveryResolutionResult, StoreError> {
        validate_identity_bound_resolution(input)?;
        IdentityStore::new(self)
            .validate_context(&input.context)
            .map_err(|error| StoreError::Conflict(format!("recovery identity: {error}")))?;
        if input.context.project_id != input.resolution.project_id {
            return Err(StoreError::WrongSubject {
                expected: input.context.project_id.clone(),
                actual: input.resolution.project_id.clone(),
            });
        }

        with_transaction(self, || {
            let current = self
                .recovery_obligation(
                    &input.resolution.project_id,
                    &input.resolution.obligation_id,
                )?
                .ok_or_else(|| StoreError::NotFound {
                    entity: "recovery_obligation",
                    id: input.resolution.obligation_id.clone(),
                })?;
            validate_recovery_attempt_fence(self, &current)?;

            let operation_identity = recovery_operation_identity(input, &current);
            let journal = OperationJournal::new(self);
            if let Some(operation) =
                journal.replay_in_context(&input.context, &operation_identity)?
            {
                if current.state == "resolved"
                    && current.resolution_id.as_deref()
                        == Some(input.resolution.resolution_id.as_str())
                {
                    return Ok(RecoveryResolutionResult {
                        obligation: current,
                        operation,
                        replayed: true,
                    });
                }
                return Err(StoreError::Conflict(format!(
                    "recovery operation {} does not match the obligation state",
                    input.operation_id
                )));
            }
            if current.state != "unresolved" {
                return Err(StoreError::Conflict(format!(
                    "recovery obligation is already {}: {}",
                    current.state, input.resolution.obligation_id
                )));
            }

            let actual_revision = self.project_revision(&input.resolution.project_id)?.0;
            super::check_expected_revision(actual_revision, input.expected_project_revision)?;
            let revision = self.bump_revision_in_transaction(&input.resolution.project_id)?;

            let mut decision = self.prepare(
                "INSERT INTO boreal_recovery_decision
                 (decision_id, obligation_id, project_id, actor_id, outcome, reason,
                  resource_state, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            )?;
            decision.bind_text(1, &input.resolution.resolution_id)?;
            decision.bind_text(2, &input.resolution.obligation_id)?;
            decision.bind_text(3, &input.resolution.project_id)?;
            decision.bind_text(4, &input.resolution.actor_id)?;
            decision.bind_text(5, &input.resolution.outcome)?;
            decision.bind_text(6, &input.resolution.reason)?;
            decision.bind_text(7, &input.resolution.resource_state)?;
            decision.bind_text(8, &input.resolution.at)?;
            decision.run()?;

            let mut update = self.prepare(
                "UPDATE boreal_recovery_obligation
                 SET state = 'resolved', resource_state = ?1, resolved_at = ?2,
                     resolved_by = ?3, resolution_id = ?4
                 WHERE project_id = ?5 AND obligation_id = ?6 AND state = 'unresolved'",
            )?;
            update.bind_text(1, &input.resolution.resource_state)?;
            update.bind_text(2, &input.resolution.at)?;
            update.bind_text(3, &input.resolution.actor_id)?;
            update.bind_text(4, &input.resolution.resolution_id)?;
            update.bind_text(5, &input.resolution.project_id)?;
            update.bind_text(6, &input.resolution.obligation_id)?;
            update.run()?;
            if update.changes()? != 1 {
                return Err(StoreError::Conflict(
                    "recovery obligation changed during resolution".to_owned(),
                ));
            }

            let operation = OperationRecord {
                operation_id: input.operation_id.clone(),
                project_id: input.resolution.project_id.clone(),
                command: "recovery.resolve".to_owned(),
                actor_id: input.resolution.actor_id.clone(),
                session_id: input.session_id.clone(),
                expected_revision: input.expected_project_revision,
                attempt_id: current.attempt_id.clone(),
                fence: current.fence,
                request_digest: input.request_digest.clone(),
                outcome: OperationOutcome::Changed,
                result_json: resolution_result_json(input, revision.0),
                revision: revision.0,
                created_at: input.resolution.at.clone(),
                completed_at: Some(input.resolution.at.clone()),
            };
            let audit = AuditEventRecord {
                project_id: input.resolution.project_id.clone(),
                revision: revision.0,
                operation_id: input.operation_id.clone(),
                event_type: recovery_resolution_event_type(&current.reason).to_owned(),
                subject_type: "operation".to_owned(),
                subject_id: input.operation_id.clone(),
                actor_id: input.resolution.actor_id.clone(),
                session_id: input.session_id.clone(),
                fence: current.fence,
                as_of: input.resolution.at.clone(),
                payload_json: resolution_result_json(input, revision.0),
            };
            journal.append_in_transaction_with_identity(
                &input.context,
                &OperationBundle::new(operation, Some(audit)),
            )?;

            let obligation = self
                .recovery_obligation(
                    &input.resolution.project_id,
                    &input.resolution.obligation_id,
                )?
                .ok_or_else(|| {
                    StoreError::Corrupt("resolved recovery obligation disappeared".to_owned())
                })?;
            let operation = journal
                .replay_in_context(&input.context, &operation_identity)?
                .ok_or_else(|| {
                    StoreError::Corrupt("recovery operation disappeared after append".to_owned())
                })?;
            Ok(RecoveryResolutionResult {
                obligation,
                operation,
                replayed: false,
            })
        })
    }

    pub fn recovery_decisions(
        &self,
        project_id: &str,
        obligation_id: &str,
        limit: u32,
    ) -> Result<Vec<RecoveryDecisionRecord>, StoreError> {
        let limit = bounded_limit(limit)?;
        let mut statement = self.prepare(
            "SELECT decision_id, obligation_id, project_id, actor_id, outcome, reason,
                    resource_state, created_at
             FROM boreal_recovery_decision
             WHERE project_id = ?1 AND obligation_id = ?2
             ORDER BY created_at, decision_id LIMIT ?3",
        )?;
        statement.bind_text(1, project_id)?;
        statement.bind_text(2, obligation_id)?;
        statement.bind_i64(3, limit as u64)?;
        let mut records = Vec::new();
        while statement.step()? == SQLITE_ROW {
            records.push(RecoveryDecisionRecord {
                decision_id: statement.column_text(0)?,
                obligation_id: statement.column_text(1)?,
                project_id: statement.column_text(2)?,
                actor_id: statement.column_text(3)?,
                outcome: statement.column_text(4)?,
                reason: statement.column_text(5)?,
                resource_state: statement.column_text(6)?,
                created_at: statement.column_text(7)?,
            });
        }
        Ok(records)
    }

    pub fn reserve_resource(
        &self,
        input: &ResourceReservationInput,
    ) -> Result<ResourceReservationRecord, StoreError> {
        validate_resource_reservation_subject(self, input)?;
        with_transaction(self, || self.reserve_resource_in_transaction(input))
    }

    /// Inserts the durable resource reservation inside a caller-owned
    /// lifecycle transaction. Claim uses this form so attempt ownership and
    /// resource ownership cannot commit independently.
    pub(crate) fn reserve_resource_in_transaction(
        &self,
        input: &ResourceReservationInput,
    ) -> Result<ResourceReservationRecord, StoreError> {
        validate_resource_reservation_subject(self, input)?;
        let mut statement = self.prepare(
            "INSERT INTO boreal_resource_reservation
             (reservation_id, project_id, work_id, attempt_id, fence, resource_key,
              resource_kind, state, owner_actor_id, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'active', ?8, ?9)",
        )?;
        statement.bind_text(1, &input.reservation_id)?;
        statement.bind_text(2, &input.project_id)?;
        statement.bind_text(3, &input.work_id)?;
        statement.bind_text(4, &input.attempt_id)?;
        statement.bind_i64(5, input.fence)?;
        statement.bind_text(6, &input.resource_key)?;
        statement.bind_text(7, &input.resource_kind)?;
        statement.bind_text(8, &input.owner_actor_id)?;
        statement.bind_text(9, &input.created_at)?;
        statement.run()?;
        self.resource_reservation(&input.project_id, &input.reservation_id)?
            .ok_or_else(|| {
                StoreError::Corrupt("resource reservation disappeared after insert".to_owned())
            })
    }

    pub fn resource_reservation(
        &self,
        project_id: &str,
        reservation_id: &str,
    ) -> Result<Option<ResourceReservationRecord>, StoreError> {
        let mut statement = self.prepare(
            "SELECT reservation_id, project_id, work_id, attempt_id, fence, resource_key,
                    resource_kind, state, owner_actor_id, created_at,
                    release_requested_at, released_at, release_ack_id
             FROM boreal_resource_reservation
             WHERE project_id = ?1 AND reservation_id = ?2",
        )?;
        statement.bind_text(1, project_id)?;
        statement.bind_text(2, reservation_id)?;
        if statement.step()? != SQLITE_ROW {
            return Ok(None);
        }
        Ok(Some(resource_from_statement(&statement)?))
    }

    pub fn request_resource_release(
        &self,
        project_id: &str,
        reservation_id: &str,
        event_id: &str,
        actor_id: &str,
        evidence_ref: &str,
        at: &str,
    ) -> Result<ResourceReservationRecord, StoreError> {
        for (value, label) in [
            (event_id, "release event"),
            (actor_id, "release actor"),
            (evidence_ref, "release evidence"),
            (at, "release timestamp"),
        ] {
            require_text(value, label)?;
        }
        with_transaction(self, || {
            self.request_resource_release_in_transaction(
                project_id,
                reservation_id,
                event_id,
                actor_id,
                evidence_ref,
                at,
            )
        })
    }

    pub(crate) fn request_resource_release_in_transaction(
        &self,
        project_id: &str,
        reservation_id: &str,
        event_id: &str,
        actor_id: &str,
        evidence_ref: &str,
        at: &str,
    ) -> Result<ResourceReservationRecord, StoreError> {
        let current = self
            .resource_reservation(project_id, reservation_id)?
            .ok_or_else(|| StoreError::NotFound {
                entity: "resource_reservation",
                id: reservation_id.to_owned(),
            })?;
        if current.state == "released" {
            return Err(StoreError::Conflict(
                "released resource cannot be released again".to_owned(),
            ));
        }
        if current.state == "release_pending" {
            return if self.release_event_matches(
                project_id,
                reservation_id,
                event_id,
                "requested",
                actor_id,
                evidence_ref,
            )? {
                Ok(current)
            } else {
                Err(StoreError::Conflict(
                    "resource release is already pending with another request".to_owned(),
                ))
            };
        }
        self.insert_release_event(&ResourceReleaseEventInput {
            event_id,
            project_id,
            reservation_id,
            state: "requested",
            actor_id,
            evidence_ref,
            at,
        })?;
        let mut update = self.prepare(
            "UPDATE boreal_resource_reservation
             SET state = 'release_pending', release_requested_at = ?1
             WHERE project_id = ?2 AND reservation_id = ?3
               AND state IN ('active','unknown')",
        )?;
        update.bind_text(1, at)?;
        update.bind_text(2, project_id)?;
        update.bind_text(3, reservation_id)?;
        update.run()?;
        self.resource_reservation(project_id, reservation_id)?
            .ok_or_else(|| {
                StoreError::Corrupt(
                    "resource reservation disappeared after release request".to_owned(),
                )
            })
    }

    pub fn acknowledge_resource_release(
        &self,
        project_id: &str,
        reservation_id: &str,
        ack_id: &str,
        actor_id: &str,
        evidence_ref: &str,
        at: &str,
    ) -> Result<ResourceReservationRecord, StoreError> {
        for (value, label) in [
            (ack_id, "release acknowledgement"),
            (actor_id, "release actor"),
            (evidence_ref, "release evidence"),
            (at, "release timestamp"),
        ] {
            require_text(value, label)?;
        }
        with_transaction(self, || {
            self.acknowledge_resource_release_in_transaction(
                project_id,
                reservation_id,
                ack_id,
                actor_id,
                evidence_ref,
                at,
            )
        })
    }

    pub(crate) fn acknowledge_resource_release_in_transaction(
        &self,
        project_id: &str,
        reservation_id: &str,
        ack_id: &str,
        actor_id: &str,
        evidence_ref: &str,
        at: &str,
    ) -> Result<ResourceReservationRecord, StoreError> {
        let current = self
            .resource_reservation(project_id, reservation_id)?
            .ok_or_else(|| StoreError::NotFound {
                entity: "resource_reservation",
                id: reservation_id.to_owned(),
            })?;
        if current.state == "released" {
            return if self.release_event_matches(
                project_id,
                reservation_id,
                ack_id,
                "acknowledged",
                actor_id,
                evidence_ref,
            )? {
                Ok(current)
            } else {
                Err(StoreError::Conflict(
                    "released resource has a different acknowledgement".to_owned(),
                ))
            };
        }
        if current.state != "release_pending" {
            return Err(StoreError::Conflict(format!(
                "resource release requires release_pending, got {}",
                current.state
            )));
        }
        self.insert_release_event(&ResourceReleaseEventInput {
            event_id: ack_id,
            project_id,
            reservation_id,
            state: "acknowledged",
            actor_id,
            evidence_ref,
            at,
        })?;
        let mut update = self.prepare(
            "UPDATE boreal_resource_reservation
             SET state = 'released', released_at = ?1, release_ack_id = ?2
             WHERE project_id = ?3 AND reservation_id = ?4 AND state = 'release_pending'",
        )?;
        update.bind_text(1, at)?;
        update.bind_text(2, ack_id)?;
        update.bind_text(3, project_id)?;
        update.bind_text(4, reservation_id)?;
        update.run()?;
        self.resource_reservation(project_id, reservation_id)?
            .ok_or_else(|| {
                StoreError::Corrupt(
                    "resource reservation disappeared after acknowledgement".to_owned(),
                )
            })
    }

    pub fn list_live_resources(
        &self,
        project_id: &str,
        after_id: Option<&str>,
        limit: u32,
    ) -> Result<Vec<ResourceReservationRecord>, StoreError> {
        let limit = bounded_limit(limit)?;
        let mut statement = self.prepare(
            "SELECT reservation_id, project_id, work_id, attempt_id, fence, resource_key,
                    resource_kind, state, owner_actor_id, created_at,
                    release_requested_at, released_at, release_ack_id
             FROM boreal_resource_reservation
             WHERE project_id = ?1 AND state IN ('active','release_pending','unknown')
               AND (?2 IS NULL OR reservation_id > ?2)
             ORDER BY reservation_id LIMIT ?3",
        )?;
        statement.bind_text(1, project_id)?;
        statement.bind_optional_text(2, after_id)?;
        statement.bind_i64(3, limit as u64)?;
        let mut records = Vec::new();
        while statement.step()? == SQLITE_ROW {
            records.push(resource_from_statement(&statement)?);
        }
        Ok(records)
    }

    fn insert_release_event(
        &self,
        input: &ResourceReleaseEventInput<'_>,
    ) -> Result<(), StoreError> {
        let mut statement = self.prepare(
            "INSERT INTO boreal_resource_release_event
             (event_id, reservation_id, project_id, state, actor_id, evidence_ref, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )?;
        statement.bind_text(1, input.event_id)?;
        statement.bind_text(2, input.reservation_id)?;
        statement.bind_text(3, input.project_id)?;
        statement.bind_text(4, input.state)?;
        statement.bind_text(5, input.actor_id)?;
        statement.bind_text(6, input.evidence_ref)?;
        statement.bind_text(7, input.at)?;
        statement.run()
    }

    fn release_event_matches(
        &self,
        project_id: &str,
        reservation_id: &str,
        event_id: &str,
        state: &str,
        actor_id: &str,
        evidence_ref: &str,
    ) -> Result<bool, StoreError> {
        let mut statement = self.prepare(
            "SELECT reservation_id, project_id, state, actor_id, evidence_ref
             FROM boreal_resource_release_event
             WHERE event_id = ?1",
        )?;
        statement.bind_text(1, event_id)?;
        if statement.step()? != SQLITE_ROW {
            return Ok(false);
        }
        Ok(statement.column_text(0)? == reservation_id
            && statement.column_text(1)? == project_id
            && statement.column_text(2)? == state
            && statement.column_text(3)? == actor_id
            && statement.column_text(4)? == evidence_ref)
    }
}

struct ResourceReleaseEventInput<'a> {
    event_id: &'a str,
    project_id: &'a str,
    reservation_id: &'a str,
    state: &'a str,
    actor_id: &'a str,
    evidence_ref: &'a str,
    at: &'a str,
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

fn validate_identity_bound_resolution(
    input: &IdentityBoundRecoveryResolutionInput,
) -> Result<(), StoreError> {
    for (value, label) in [
        (&input.operation_id, "recovery operation id"),
        (&input.request_digest, "recovery request digest"),
    ] {
        require_text(value, label)?;
    }
    for value in [
        input.resolution.project_id.as_str(),
        input.resolution.obligation_id.as_str(),
        input.resolution.resolution_id.as_str(),
        input.resolution.actor_id.as_str(),
        input.resolution.outcome.as_str(),
        input.resolution.reason.as_str(),
        input.resolution.at.as_str(),
    ] {
        require_text(value, "identity-bound recovery resolution")?;
    }
    require_resource_state(&input.resolution.resource_state)
}

fn validate_recovery_attempt_fence(
    store: &SqliteStore,
    obligation: &RecoveryObligationRecord,
) -> Result<(), StoreError> {
    match (&obligation.attempt_id, obligation.fence) {
        (Some(attempt_id), Some(fence)) => {
            let attempt = store.attempt_record(attempt_id, false)?.ok_or_else(|| {
                StoreError::Corrupt(format!(
                    "recovery obligation {} references missing attempt {}",
                    obligation.obligation_id, attempt_id
                ))
            })?;
            if attempt.project_id != obligation.project_id || attempt.work_id != obligation.work_id
            {
                return Err(StoreError::WrongSubject {
                    expected: format!("{}/{}", obligation.project_id, obligation.work_id),
                    actual: format!("{}/{}", attempt.project_id, attempt.work_id),
                });
            }
            if attempt.fence != fence {
                return Err(StoreError::StaleFence {
                    expected: fence,
                    actual: attempt.fence,
                });
            }
            Ok(())
        }
        (None, None) => Ok(()),
        _ => Err(StoreError::Corrupt(format!(
            "recovery obligation {} has an incomplete attempt fence identity",
            obligation.obligation_id
        ))),
    }
}

fn recovery_operation_identity(
    input: &IdentityBoundRecoveryResolutionInput,
    obligation: &RecoveryObligationRecord,
) -> OperationIdentity {
    OperationIdentity {
        operation_id: input.operation_id.clone(),
        project_id: input.resolution.project_id.clone(),
        command: "recovery.resolve".to_owned(),
        actor_id: input.resolution.actor_id.clone(),
        session_id: input.session_id.clone(),
        expected_revision: input.expected_project_revision,
        attempt_id: obligation.attempt_id.clone(),
        fence: obligation.fence,
        request_digest: input.request_digest.clone(),
        subject: Some(("operation".to_owned(), input.operation_id.clone())),
    }
}

fn resolution_result_json(input: &IdentityBoundRecoveryResolutionInput, revision: u64) -> String {
    serde_json::json!({
        "obligation_id": input.resolution.obligation_id,
        "resolution_id": input.resolution.resolution_id,
        "outcome": input.resolution.outcome,
        "resource_state": input.resolution.resource_state,
        "reason": input.resolution.reason,
        "revision": revision,
    })
    .to_string()
}

fn recovery_resolution_event_type(reason: &str) -> &'static str {
    if reason == "expired" {
        "expiry.resolved"
    } else {
        "repair.correction"
    }
}

fn validate_obligation_input(input: &RecoveryObligationInput) -> Result<(), StoreError> {
    for (value, label) in [
        (&input.obligation_id, "obligation id"),
        (&input.project_id, "project id"),
        (&input.work_id, "work id"),
        (&input.reason, "recovery reason"),
        (&input.resource_state, "resource state"),
        (&input.next_action, "next action"),
        (&input.created_at, "creation timestamp"),
    ] {
        require_text(value, label)?;
    }
    if !RECOVERY_REASONS.contains(&input.reason.as_str()) {
        return Err(StoreError::Invalid(format!(
            "unsupported recovery reason: {}",
            input.reason
        )));
    }
    require_resource_state(&input.resource_state)
}

fn validate_resource_input(input: &ResourceReservationInput) -> Result<(), StoreError> {
    for (value, label) in [
        (&input.reservation_id, "reservation id"),
        (&input.project_id, "project id"),
        (&input.work_id, "work id"),
        (&input.attempt_id, "attempt id"),
        (&input.resource_key, "resource key"),
        (&input.resource_kind, "resource kind"),
        (&input.owner_actor_id, "resource owner"),
        (&input.created_at, "creation timestamp"),
    ] {
        require_text(value, label)?;
    }
    if input.fence == 0 {
        return Err(StoreError::Invalid(
            "resource fence must be positive".to_owned(),
        ));
    }
    Ok(())
}

fn validate_resource_reservation_subject(
    store: &SqliteStore,
    input: &ResourceReservationInput,
) -> Result<(), StoreError> {
    validate_resource_input(input)?;
    let expected_project = store.project_for_work(&input.work_id)?;
    if expected_project != input.project_id {
        return Err(StoreError::WrongSubject {
            expected: input.project_id.clone(),
            actual: expected_project,
        });
    }
    let attempt = store
        .attempt_record(&input.attempt_id, false)?
        .ok_or_else(|| StoreError::NotFound {
            entity: "attempt",
            id: input.attempt_id.clone(),
        })?;
    if attempt.project_id != input.project_id
        || attempt.work_id != input.work_id
        || attempt.fence != input.fence
    {
        return Err(StoreError::WrongSubject {
            expected: format!("{}/{}/{}", input.project_id, input.work_id, input.fence),
            actual: format!("{}/{}/{}", attempt.project_id, attempt.work_id, attempt.fence),
        });
    }
    if !attempt.current {
        return Err(StoreError::NotCurrent {
            attempt_id: input.attempt_id.clone(),
        });
    }
    Ok(())
}

fn require_resource_state(value: &str) -> Result<(), StoreError> {
    if RESOURCE_STATES.contains(&value) {
        Ok(())
    } else {
        Err(StoreError::Invalid(format!(
            "unsupported resource state: {value}"
        )))
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

fn recovery_from_statement(
    statement: &super::Statement<'_>,
) -> Result<RecoveryObligationRecord, StoreError> {
    let state = statement.column_text(6)?;
    if !RECOVERY_STATES.contains(&state.as_str()) {
        return Err(StoreError::Corrupt(format!(
            "unknown recovery state: {state}"
        )));
    }
    Ok(RecoveryObligationRecord {
        obligation_id: statement.column_text(0)?,
        project_id: statement.column_text(1)?,
        work_id: statement.column_text(2)?,
        attempt_id: statement.column_optional_text(3)?,
        fence: statement.column_optional_i64(4)?,
        reason: statement.column_text(5)?,
        state,
        resource_state: statement.column_text(7)?,
        owner_actor_id: statement.column_optional_text(8)?,
        next_action: statement.column_text(9)?,
        created_at: statement.column_text(10)?,
        resolved_at: statement.column_optional_text(11)?,
        resolved_by: statement.column_optional_text(12)?,
        resolution_id: statement.column_optional_text(13)?,
    })
}

fn resource_from_statement(
    statement: &super::Statement<'_>,
) -> Result<ResourceReservationRecord, StoreError> {
    let state = statement.column_text(7)?;
    if !RESOURCE_STATES.contains(&state.as_str()) {
        return Err(StoreError::Corrupt(format!(
            "unknown resource state: {state}"
        )));
    }
    Ok(ResourceReservationRecord {
        reservation_id: statement.column_text(0)?,
        project_id: statement.column_text(1)?,
        work_id: statement.column_text(2)?,
        attempt_id: statement.column_text(3)?,
        fence: statement.column_u64(4)?,
        resource_key: statement.column_text(5)?,
        resource_kind: statement.column_text(6)?,
        state,
        owner_actor_id: statement.column_text(8)?,
        created_at: statement.column_text(9)?,
        release_requested_at: statement.column_optional_text(10)?,
        released_at: statement.column_optional_text(11)?,
        release_ack_id: statement.column_optional_text(12)?,
    })
}
