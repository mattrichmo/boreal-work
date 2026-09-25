//! Canonical acceptance persistence and immutable submission binding.
//!
//! This module exposes the canonical gate and diagnostic reads required by
//! later acceptance work.  It keeps requirements/observations in the
//! application/domain boundary and does not make a SQL status decision.

use super::{
    CloseIntentRequest, CloseIntentResult, GateDiagnostics, GateRecord, GateStateUpdateRequest,
    MutationResult, ReceiptInsertRequest, ReceiptInsertResult, ReceiptRecord, ReviewInsertRequest,
    ReviewRecord, SqliteStore, StoreError, SummaryInsertRequest, SummaryInsertResult,
    SummaryRecord,
};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AcceptanceBinding {
    pub project_id: String,
    pub work_id: String,
    pub attempt_id: String,
    pub fence: u64,
    pub source_version_id: Option<String>,
    pub config_identity: String,
    pub profile_id: String,
    pub profile_version: u64,
}

impl AcceptanceBinding {
    pub fn matches(&self, other: &Self) -> bool {
        self == other
    }
}

pub struct AcceptanceStore<'a> {
    store: &'a SqliteStore,
}

impl<'a> AcceptanceStore<'a> {
    pub const fn new(store: &'a SqliteStore) -> Self {
        Self { store }
    }

    pub fn gate(
        &self,
        project_id: &str,
        work_id: &str,
        gate_id: &str,
    ) -> Result<Option<GateRecord>, StoreError> {
        self.store.gate(project_id, work_id, gate_id)
    }

    pub fn diagnostics(
        &self,
        project_id: &str,
        work_id: &str,
        attempt_id: &str,
        fence: u64,
    ) -> Result<GateDiagnostics, StoreError> {
        self.store
            .gate_diagnostics(project_id, work_id, attempt_id, fence)
    }

    pub fn record_receipt(
        &self,
        request: &ReceiptInsertRequest,
    ) -> Result<ReceiptInsertResult, StoreError> {
        self.store.insert_receipt(request)
    }

    pub fn receipt(&self, receipt_id: &str) -> Result<Option<ReceiptRecord>, StoreError> {
        self.store.receipt(receipt_id)
    }

    pub fn update_gate(
        &self,
        request: &GateStateUpdateRequest,
    ) -> Result<MutationResult, StoreError> {
        self.store.update_gate_state(request)
    }

    pub fn record_review(
        &self,
        request: &ReviewInsertRequest,
    ) -> Result<MutationResult, StoreError> {
        self.store.insert_review(request)
    }

    pub fn review(&self, review_id: &str) -> Result<Option<ReviewRecord>, StoreError> {
        self.store.review(review_id)
    }

    pub fn record_summary(
        &self,
        request: &SummaryInsertRequest,
    ) -> Result<SummaryInsertResult, StoreError> {
        self.store.insert_summary(request)
    }

    pub fn summary(
        &self,
        project_id: &str,
        summary_id: &str,
    ) -> Result<Option<SummaryRecord>, StoreError> {
        self.store.summary(project_id, summary_id)
    }

    pub fn open_close(
        &self,
        request: &CloseIntentRequest,
    ) -> Result<CloseIntentResult, StoreError> {
        self.store.create_close_intent(request)
    }

    pub fn finalize_close(
        &self,
        request: &CloseIntentRequest,
    ) -> Result<CloseIntentResult, StoreError> {
        self.store.finalize_close_intent(request)
    }

    pub fn reject_close(
        &self,
        request: &CloseIntentRequest,
        rejection_code: &str,
    ) -> Result<CloseIntentResult, StoreError> {
        self.store.reject_close_intent(request, rejection_code)
    }
}

/// An immutable result candidate. Execution ownership is deliberately not
/// represented by this record; reviews bind this exact source/configuration,
/// summary and ordered receipt set, not whichever attempt happens to be live.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SubmissionRecord {
    pub submission_id: String,
    pub project_id: String,
    pub work_id: String,
    pub attempt_id: String,
    pub fence: u64,
    pub entity_revision: u64,
    pub proof_revision: u64,
    pub source_version_id: String,
    pub config_identity: String,
    pub profile_id: String,
    pub profile_version: u64,
    pub profile_digest: String,
    pub summary_id: String,
    pub summary_digest: String,
    pub receipt_ids: Vec<String>,
    pub sealed_at: String,
}

/// Exact current accepted-close binding for projections that must distinguish
/// a lifecycle label from an accepted result. The summary digest is the
/// immutable digest captured in the sealed submission.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AcceptedOutcomeRecord {
    pub outcome_id: String,
    pub project_id: String,
    pub work_id: String,
    pub entity_revision: u64,
    pub proof_revision: u64,
    pub summary_digest: String,
    pub accepted_at: String,
}

impl SubmissionRecord {
    pub fn proof_identity(&self) -> boreal_domain::decision_inputs::ProofIdentity {
        use boreal_domain::decision_inputs::*;
        ProofIdentity::new(
            EntityIdentity::new(
                self.project_id.clone().into(),
                self.work_id.clone().into(),
                EntityRevision::new(self.entity_revision),
            ),
            ProofRevision::new(self.proof_revision),
            Some(AttemptIdentity::new(
                self.attempt_id.clone().into(),
                AttemptFence::new(self.fence),
            )),
            self.source_version_id.clone().into(),
            self.config_identity.clone().into(),
            ProfileIdentity::new(
                self.profile_id.clone().into(),
                self.profile_version.to_string(),
                self.profile_digest.clone().into(),
            ),
            "boreal.acceptance/1",
        )
    }
}

impl SqliteStore {
    pub fn current_submission(
        &self,
        project_id: &str,
        work_id: &str,
        proof_revision: u64,
    ) -> Result<Option<SubmissionRecord>, StoreError> {
        let mut row = self.prepare(
            "SELECT submission_id, project_id, work_id, attempt_id, fence,
                    entity_revision, proof_revision, source_version_id, config_identity,
                    profile_id, profile_version, profile_digest, summary_id,
                    summary_digest, receipt_ids_json, sealed_at
             FROM boreal_submission WHERE project_id = ?1 AND work_id = ?2 AND proof_revision = ?3
             ORDER BY rowid DESC LIMIT 1",
        )?;
        row.bind_text(1, project_id)?;
        row.bind_text(2, work_id)?;
        row.bind_i64(3, proof_revision)?;
        if row.step()? != super::SQLITE_ROW {
            return Ok(None);
        }
        let receipt_ids: Vec<String> = serde_json::from_str(&row.column_text(14)?)
            .map_err(|error| StoreError::Corrupt(format!("invalid sealed receipts: {error}")))?;
        let mut unique = std::collections::BTreeSet::new();
        if receipt_ids
            .iter()
            .any(|id| id.is_empty() || !unique.insert(id))
        {
            return Err(StoreError::Corrupt(
                "duplicate/empty sealed receipt identity".into(),
            ));
        }
        Ok(Some(SubmissionRecord {
            submission_id: row.column_text(0)?,
            project_id: row.column_text(1)?,
            work_id: row.column_text(2)?,
            attempt_id: row.column_text(3)?,
            fence: row.column_u64(4)?,
            entity_revision: row.column_u64(5)?,
            proof_revision: row.column_u64(6)?,
            source_version_id: row.column_text(7)?,
            config_identity: row.column_text(8)?,
            profile_id: row.column_text(9)?,
            profile_version: row.column_u64(10)?,
            profile_digest: row.column_text(11)?,
            summary_id: row.column_text(12)?,
            summary_digest: row.column_text(13)?,
            receipt_ids,
            sealed_at: row.column_text(15)?,
        }))
    }

    pub(crate) fn proof_cursor(
        &self,
        project_id: &str,
        work_id: &str,
    ) -> Result<(u64, u64), StoreError> {
        let mut row = self.prepare("SELECT entity_revision, proof_revision FROM boreal_entity_revision WHERE project_id = ?1 AND work_id = ?2")?;
        row.bind_text(1, project_id)?;
        row.bind_text(2, work_id)?;
        if row.step()? != super::SQLITE_ROW {
            return Err(StoreError::Corrupt("missing work revision cursor".into()));
        }
        Ok((row.column_u64(0)?, row.column_u64(1)?))
    }

    /// Records every submitted fact, including failed evidence, rather than
    /// selecting only successful receipts and erasing the unsuccessful ones.
    pub(crate) fn submission_receipts(
        &self,
        attempt: &super::AttemptRecord,
    ) -> Result<Vec<String>, StoreError> {
        let mut rows = self.prepare(
            "SELECT receipt_id FROM receipt WHERE work_id = ?1 AND attempt_id = ?2 AND fence = ?3
             AND source_version_id = ?4 AND config_identity = ?5 ORDER BY rowid",
        )?;
        rows.bind_text(1, &attempt.work_id)?;
        rows.bind_text(2, &attempt.attempt_id)?;
        rows.bind_i64(3, attempt.fence)?;
        rows.bind_optional_text(4, attempt.source_version_id.as_deref())?;
        rows.bind_text(5, &attempt.config_identity)?;
        let mut ids = Vec::new();
        while rows.step()? == super::SQLITE_ROW {
            ids.push(rows.column_text(0)?);
        }
        Ok(ids)
    }

    pub(crate) fn seal_submission_in_transaction(
        &self,
        project_id: &str,
        work_id: &str,
        attempt_id: &str,
        fence: u64,
        summary_id: &str,
        at: &str,
    ) -> Result<SubmissionRecord, StoreError> {
        let attempt =
            self.attempt_record(attempt_id, false)?
                .ok_or_else(|| StoreError::NotFound {
                    entity: "attempt",
                    id: attempt_id.into(),
                })?;
        if attempt.project_id != project_id || attempt.work_id != work_id || attempt.fence != fence
        {
            return Err(StoreError::Conflict(
                "submission attempt scope/fence mismatch".into(),
            ));
        }
        self.require_open_proof_subject(&attempt)?;
        if !matches!(
            attempt.phase,
            boreal_domain::AttemptPhase::Running | boreal_domain::AttemptPhase::Verifying
        ) && !self.attempt_has_current_submission(&attempt)?
        {
            return Err(StoreError::Conflict(
                "submission requires a running or verifying attempt".into(),
            ));
        }
        let source = attempt
            .source_version_id
            .as_deref()
            .filter(|id| !id.is_empty())
            .ok_or_else(|| {
                StoreError::Invalid("submission requires a genuine source snapshot".into())
            })?;
        if attempt.config_identity.trim().is_empty() {
            return Err(StoreError::Invalid(
                "submission configuration is unbound".into(),
            ));
        }
        let summary =
            self.summary(project_id, summary_id)?
                .ok_or_else(|| StoreError::NotFound {
                    entity: "summary",
                    id: summary_id.into(),
                })?;
        let pin =
            super::ProfileStore::new(self).current_pinned_requirements(project_id, work_id)?;
        let (entity_revision, proof_revision) = self.proof_cursor(project_id, work_id)?;
        if pin.proof_revision != proof_revision
            || !summary.current
            || summary.work_id != work_id
            || summary.attempt_id != attempt_id
            || summary.fence != fence
            || summary.source_version_id != source
            || summary.config_identity != attempt.config_identity
            || summary.profile_id != pin.profile.profile_id
            || summary.profile_version != pin.profile.version
            || !super::valid_sha256_digest(&summary.body_digest)
        {
            return Err(StoreError::Conflict(
                "summary does not bind the current exact proof context".into(),
            ));
        }
        let receipts = self.submission_receipts(&attempt)?;
        // Repeating sealing is a readback, not a new approval generation.
        if let Some(existing) = self.current_submission(project_id, work_id, proof_revision)? {
            if existing.summary_id == summary_id
                && existing.receipt_ids == receipts
                && existing.attempt_id == attempt_id
                && existing.fence == fence
            {
                return Ok(existing);
            }
        }
        let receipt_json = serde_json::to_string(&receipts)
            .map_err(|error| StoreError::Invalid(error.to_string()))?;
        let identity = serde_json::json!([
            project_id,
            work_id,
            attempt_id,
            fence,
            proof_revision,
            summary_id,
            &receipts
        ])
        .to_string();
        let id = format!("submission:{}", super::checksum(identity.as_bytes()));
        let mut insert = self.prepare(
            "INSERT INTO boreal_submission (submission_id, project_id, work_id, attempt_id, fence,
             entity_revision, proof_revision, source_version_id, config_identity, profile_id, profile_version,
             profile_digest, summary_id, summary_digest, receipt_ids_json, sealed_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)",
        )?;
        insert.bind_text(1, &id)?;
        insert.bind_text(2, project_id)?;
        insert.bind_text(3, work_id)?;
        insert.bind_text(4, attempt_id)?;
        insert.bind_i64(5, fence)?;
        insert.bind_i64(6, entity_revision)?;
        insert.bind_i64(7, proof_revision)?;
        insert.bind_text(8, source)?;
        insert.bind_text(9, &attempt.config_identity)?;
        insert.bind_text(10, &pin.profile.profile_id)?;
        insert.bind_i64(11, pin.profile.version)?;
        insert.bind_text(12, &pin.profile.policy_digest)?;
        insert.bind_text(13, summary_id)?;
        insert.bind_text(14, &summary.body_digest)?;
        insert.bind_text(15, &receipt_json)?;
        insert.bind_text(16, at)?;
        insert.run()?;
        self.current_submission(project_id, work_id, proof_revision)?
            .ok_or_else(|| StoreError::Corrupt("sealed submission disappeared".into()))
    }

    pub fn has_accepted_outcome(
        &self,
        project_id: &str,
        work_id: &str,
    ) -> Result<bool, StoreError> {
        let mut row = self.prepare(
            "SELECT 1 FROM boreal_accepted_outcome o
             JOIN work_item w ON w.project_id = o.project_id AND w.work_id = o.work_id
             JOIN boreal_entity_revision e ON e.project_id = o.project_id AND e.work_id = o.work_id
             JOIN boreal_submission s ON s.submission_id = o.submission_id AND s.project_id = o.project_id AND s.work_id = o.work_id
             JOIN close_intent c ON c.close_intent_id = o.close_intent_id AND c.work_id = o.work_id AND c.state = 'finalized'
             WHERE o.project_id = ?1 AND o.work_id = ?2 AND w.lifecycle = 'closed'
             AND e.proof_revision = o.proof_revision AND s.proof_revision = o.proof_revision
             AND NOT EXISTS (SELECT 1 FROM boreal_outcome_invalidation i WHERE i.outcome_id = o.outcome_id) LIMIT 1",
        )?;
        row.bind_text(1, project_id)?;
        row.bind_text(2, work_id)?;
        Ok(row.step()? == super::SQLITE_ROW)
    }

    pub fn current_accepted_outcome(
        &self,
        project_id: &str,
        work_id: &str,
    ) -> Result<Option<AcceptedOutcomeRecord>, StoreError> {
        let mut row = self.prepare(
            "SELECT o.outcome_id,o.project_id,o.work_id,e.entity_revision,
                    o.proof_revision,s.summary_digest,o.accepted_at
             FROM boreal_accepted_outcome o
             JOIN work_item w ON w.project_id=o.project_id AND w.work_id=o.work_id
             JOIN boreal_entity_revision e ON e.project_id=o.project_id AND e.work_id=o.work_id
             JOIN boreal_submission s ON s.submission_id=o.submission_id
               AND s.project_id=o.project_id AND s.work_id=o.work_id
             JOIN close_intent c ON c.close_intent_id=o.close_intent_id
               AND c.work_id=o.work_id AND c.state='finalized'
             WHERE o.project_id=?1 AND o.work_id=?2 AND w.lifecycle='closed'
               AND e.proof_revision=o.proof_revision
               AND s.proof_revision=o.proof_revision
               AND NOT EXISTS (
                 SELECT 1 FROM boreal_outcome_invalidation i
                 WHERE i.outcome_id=o.outcome_id
               )
             ORDER BY o.accepted_at DESC,o.outcome_id DESC LIMIT 1",
        )?;
        row.bind_text(1, project_id)?;
        row.bind_text(2, work_id)?;
        if row.step()? != super::SQLITE_ROW {
            return Ok(None);
        }
        Ok(Some(AcceptedOutcomeRecord {
            outcome_id: row.column_text(0)?,
            project_id: row.column_text(1)?,
            work_id: row.column_text(2)?,
            entity_revision: row.column_u64(3)?,
            proof_revision: row.column_u64(4)?,
            summary_digest: row.column_text(5)?,
            accepted_at: row.column_text(6)?,
        }))
    }

    pub(crate) fn record_accepted_outcome_in_transaction(
        &self,
        request: &CloseIntentRequest,
    ) -> Result<(), StoreError> {
        let (_, proof_revision) = self.proof_cursor(&request.project_id, &request.work_id)?;
        let submission = self
            .current_submission(&request.project_id, &request.work_id, proof_revision)?
            .ok_or_else(|| StoreError::Conflict("close requires an immutable submission".into()))?;
        if submission.attempt_id != request.attempt_id || submission.fence != request.fence {
            return Err(StoreError::Conflict(
                "close submission attempt/fence mismatch".into(),
            ));
        }
        let mut row = self.prepare(
            "INSERT INTO boreal_accepted_outcome (outcome_id, project_id, work_id, submission_id,
             close_intent_id, proof_revision, operation_id, accepted_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        )?;
        row.bind_text(1, &format!("accepted:{}", request.close_intent_id))?;
        row.bind_text(2, &request.project_id)?;
        row.bind_text(3, &request.work_id)?;
        row.bind_text(4, &submission.submission_id)?;
        row.bind_text(5, &request.close_intent_id)?;
        row.bind_i64(6, proof_revision)?;
        row.bind_text(7, &request.operation_id)?;
        row.bind_text(8, &request.at)?;
        row.run()
    }

    pub(crate) fn active_dependency_waiver(
        &self,
        project_id: &str,
        work_id: &str,
        predecessor_id: &str,
        proof_revision: u64,
        entity_revision: u64,
        predecessor_revision: u64,
        as_of: boreal_domain::TimestampMs,
    ) -> Result<Option<String>, StoreError> {
        let mut row = self.prepare(
            "SELECT e.exception_id FROM boreal_policy_exception e
             WHERE e.project_id=?1 AND e.work_id=?2 AND e.kind='dependency' AND e.predecessor_id=?3
             AND e.proof_revision=?4 AND e.subject_revision=?5 AND e.predecessor_revision=?6
             AND e.target_id = e.predecessor_id || '->' || e.work_id
             AND (e.expires_at_ms IS NULL OR e.expires_at_ms>?7)
             AND NOT EXISTS (SELECT 1 FROM boreal_exception_revocation r WHERE r.exception_id=e.exception_id)
             ORDER BY e.rowid DESC LIMIT 1",
        )?;
        row.bind_text(1, project_id)?;
        row.bind_text(2, work_id)?;
        row.bind_text(3, predecessor_id)?;
        row.bind_i64(4, proof_revision)?;
        row.bind_i64(5, entity_revision)?;
        row.bind_i64(6, predecessor_revision)?;
        row.bind_i64(7, as_of.0)?;
        if row.step()? == super::SQLITE_ROW {
            Ok(Some(row.column_text(0)?))
        } else {
            Ok(None)
        }
    }
}

impl SqliteStore {
    /// Historical submitted proof is readable without reviving its execution
    /// lease. This is not an execution-ownership admission primitive.
    pub fn proof_attempt(
        &self,
        project_id: &str,
        attempt_id: &str,
    ) -> Result<super::AttemptRecord, StoreError> {
        let attempt =
            self.attempt_record(attempt_id, false)?
                .ok_or_else(|| StoreError::NotFound {
                    entity: "attempt",
                    id: attempt_id.to_owned(),
                })?;
        if attempt.project_id != project_id {
            return Err(StoreError::WrongSubject {
                expected: project_id.to_owned(),
                actual: attempt.project_id,
            });
        }
        if !attempt.current && !self.attempt_has_current_submission(&attempt)? {
            return Err(StoreError::NotCurrent {
                attempt_id: attempt_id.to_owned(),
            });
        }
        Ok(attempt)
    }

    pub fn work_revisions(
        &self,
        project_id: &str,
        work_id: &str,
    ) -> Result<(u64, u64), StoreError> {
        self.proof_cursor(project_id, work_id)
    }

    pub(crate) fn require_open_proof_subject(
        &self,
        attempt: &super::AttemptRecord,
    ) -> Result<(), StoreError> {
        let mut row =
            self.prepare("SELECT lifecycle FROM work_item WHERE project_id=?1 AND work_id=?2")?;
        row.bind_text(1, &attempt.project_id)?;
        row.bind_text(2, &attempt.work_id)?;
        if row.step()? != super::SQLITE_ROW || row.column_text(0)? != "open" {
            return Err(StoreError::Conflict(
                "proof mutation requires an open work subject; reopen explicitly first".into(),
            ));
        }
        Ok(())
    }

    pub(crate) fn attempt_has_current_submission(
        &self,
        attempt: &super::AttemptRecord,
    ) -> Result<bool, StoreError> {
        if !self.is_canonical_production()
            || attempt.phase != boreal_domain::AttemptPhase::Completed
        {
            return Ok(false);
        }
        let (_, generation) = self.proof_cursor(&attempt.project_id, &attempt.work_id)?;
        Ok(self
            .current_submission(&attempt.project_id, &attempt.work_id, generation)?
            .is_some_and(|s| s.attempt_id == attempt.attempt_id && s.fence == attempt.fence))
    }

    /// Ends execution ownership atomically with submission, retaining an
    /// independent resource-release obligation. Review never consumes a lease.
    pub(crate) fn end_execution_for_submission_in_transaction(
        &self,
        request: &CloseIntentRequest,
    ) -> Result<(), StoreError> {
        let attempt = self.proof_attempt(&request.project_id, &request.attempt_id)?;
        self.require_open_proof_subject(&attempt)?;
        if attempt.actor_id != request.actor_id
            || attempt.session_id != request.session_id
            || attempt.work_id != request.work_id
            || attempt.fence != request.fence
        {
            return Err(StoreError::Conflict(
                "submission ownership, session or fence changed".into(),
            ));
        }
        if self.attempt_has_current_submission(&attempt)? {
            return Ok(());
        }
        if !attempt.current
            || !matches!(
                attempt.phase,
                boreal_domain::AttemptPhase::Running | boreal_domain::AttemptPhase::Verifying
            )
        {
            return Err(StoreError::Conflict(
                "submission requires the current executing attempt".into(),
            ));
        }
        if super::timestamp_cmp(&request.at, &attempt.hard_deadline) != std::cmp::Ordering::Less {
            return Err(StoreError::HardDeadlineElapsed);
        }
        if super::timestamp_cmp(&request.at, &attempt.lease_deadline) != std::cmp::Ordering::Less {
            return Err(StoreError::LeaseExpired);
        }
        let mut row = self.prepare("UPDATE attempt SET current=0, state='completed', terminal_at=?1, terminal_reason='result.submitted' WHERE attempt_id=?2 AND current=1 AND fence=?3")?;
        row.bind_text(1, &request.at)?;
        row.bind_text(2, &request.attempt_id)?;
        row.bind_i64(3, request.fence)?;
        row.run()?;
        if row.changes()? != 1 {
            return Err(StoreError::Conflict(
                "submission execution fence changed".into(),
            ));
        }
        let mut row = self.prepare("UPDATE reservation SET state='released', released_at=?1 WHERE attempt_id=?2 AND state='active'")?;
        row.bind_text(1, &request.at)?;
        row.bind_text(2, &request.attempt_id)?;
        row.run()?;
        self.request_canonical_resource_release_in_transaction(
            &request.project_id,
            &request.attempt_id,
            request.fence,
            &request.operation_id,
            &request.actor_id,
            &request.at,
        )?;
        self.create_recovery_obligation_in_transaction(
            &super::recovery::RecoveryObligationInput {
                obligation_id: format!("{}:recovery:submission", request.operation_id),
                project_id: request.project_id.clone(),
                work_id: request.work_id.clone(),
                attempt_id: Some(request.attempt_id.clone()),
                fence: Some(request.fence),
                reason: "resource_unknown".into(),
                resource_state: "release_pending".into(),
                owner_actor_id: Some(request.actor_id.clone()),
                next_action: "acknowledge physical resource release before reuse".into(),
                created_at: request.at.clone(),
            },
        )?;
        Ok(())
    }

    pub(crate) fn record_review_event_in_transaction(
        &self,
        request: &ReviewInsertRequest,
        attempt: &super::AttemptRecord,
    ) -> Result<(), StoreError> {
        use boreal_domain::ActorRole;
        self.require_open_proof_subject(attempt)?;
        if request.actor_id != request.reviewer_actor_id
            || request.reviewer_actor_id == attempt.actor_id
            || request.reason.trim().is_empty()
            || !matches!(
                self.project_actor_context(&request.project_id, &request.actor_id)?
                    .role,
                ActorRole::Reviewer | ActorRole::Operator
            )
        {
            return Err(StoreError::Conflict(
                "review requires an independent reviewer principal and nonempty reason".into(),
            ));
        }
        if self
            .principal_authority(&request.project_id, &request.actor_id)?
            .1
            == self.recorded_principal_root(&request.project_id, &attempt.actor_id)?
        {
            return Err(StoreError::Conflict(
                "reviewer shares the submitting authority root".into(),
            ));
        }
        let (_, generation) = self.proof_cursor(&request.project_id, &request.work_id)?;
        let sealed = self
            .current_submission(&request.project_id, &request.work_id, generation)?
            .ok_or_else(|| {
                StoreError::Conflict("review requires an immutable submission".into())
            })?;
        if sealed.attempt_id != request.attempt_id
            || sealed.fence != request.fence
            || request.source_version_id.as_deref() != Some(sealed.source_version_id.as_str())
            || request.policy_digest != sealed.profile_digest
        {
            return Err(StoreError::Conflict(
                "review does not bind the exact submitted proof and profile digest".into(),
            ));
        }
        let gate_id = request.gate_id.as_deref().ok_or_else(|| {
            StoreError::Invalid("review requires an explicit pinned review gate".into())
        })?;
        let pin = super::ProfileStore::new(self)
            .current_pinned_requirements(&request.project_id, &request.work_id)?;
        if !pin.declarations.iter().any(|g| {
            g.kind == "review"
                && (g.gate_id == gate_id || format!("{}:{}", request.work_id, g.gate_id) == gate_id)
        }) {
            return Err(StoreError::Conflict(
                "review gate is not in the pinned acceptance profile".into(),
            ));
        }
        let mut row = self.prepare("INSERT INTO boreal_review_event(review_event_id,project_id,work_id,submission_id,gate_id,reviewer_actor_id,outcome,reason,operation_id,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)")?;
        row.bind_text(1, &request.review_id)?;
        row.bind_text(2, &request.project_id)?;
        row.bind_text(3, &request.work_id)?;
        row.bind_text(4, &sealed.submission_id)?;
        row.bind_text(5, gate_id)?;
        row.bind_text(6, &request.actor_id)?;
        row.bind_text(
            7,
            if request.decision == super::ReviewDecision::Accepted {
                "approved"
            } else {
                "rejected"
            },
        )?;
        row.bind_text(8, &request.reason)?;
        row.bind_text(9, &request.operation_id)?;
        row.bind_text(10, &request.created_at)?;
        row.run()
    }

    pub(crate) fn validate_submission_for_close(
        &self,
        request: &CloseIntentRequest,
        attempt: &super::AttemptRecord,
    ) -> Result<(), StoreError> {
        let (_, generation) = self.proof_cursor(&request.project_id, &request.work_id)?;
        let sealed = self
            .current_submission(&request.project_id, &request.work_id, generation)?
            .ok_or_else(|| StoreError::Conflict("close requires an immutable submission".into()))?;
        if sealed.attempt_id != request.attempt_id
            || sealed.fence != request.fence
            || request.source_version_id.as_deref() != Some(sealed.source_version_id.as_str())
            || sealed.config_identity != request.config_identity
            || sealed.profile_id != request.profile_id
            || sealed.profile_version != request.profile_version
            || request.summary_id.as_deref() != Some(sealed.summary_id.as_str())
            || self.submission_receipts(attempt)? != sealed.receipt_ids
        {
            return Err(StoreError::Conflict(
                "submitted proof changed; seal a new candidate before closing".into(),
            ));
        }
        let pin = super::ProfileStore::new(self)
            .current_pinned_requirements(&request.project_id, &request.work_id)?;
        for gate in pin
            .declarations
            .iter()
            .filter(|g| g.required && g.kind == "review")
        {
            let mut row = self.prepare("SELECT outcome FROM boreal_review_event WHERE project_id=?1 AND work_id=?2 AND submission_id=?3 AND (gate_id=?4 OR gate_id=?5) ORDER BY rowid DESC LIMIT 1")?;
            row.bind_text(1, &request.project_id)?;
            row.bind_text(2, &request.work_id)?;
            row.bind_text(3, &sealed.submission_id)?;
            row.bind_text(4, &gate.gate_id)?;
            row.bind_text(5, &format!("{}:{}", request.work_id, gate.gate_id))?;
            let review_outcome = if row.step()? == super::SQLITE_ROW {
                Some(row.column_text(0)?)
            } else {
                None
            };
            if review_outcome.as_deref() != Some("approved") {
                let (entity, proof) = self.proof_cursor(&request.project_id, &request.work_id)?;
                let exception = self.current_gate_exception(
                    &request.project_id,
                    &request.work_id,
                    &format!("{}:{}", request.work_id, gate.gate_id),
                    proof,
                )?;
                let failed = matches!(
                    review_outcome.as_deref(),
                    Some("rejected" | "returned" | "revoked")
                );
                let now = super::status_evaluation::canonical_status_timestamp(&request.at)?;
                if !failed
                    || !exception.is_some_and(|exception| {
                        exception.applies(
                            super::GateState::Failed,
                            boreal_domain::decision_inputs::EntityRevision::new(entity),
                            boreal_domain::decision_inputs::ProofRevision::new(proof),
                            now,
                        )
                    })
                {
                    return Err(StoreError::Conflict("independent approval or an explicit disposition of the failed review is required".into()));
                }
            }
        }
        Ok(())
    }
}
