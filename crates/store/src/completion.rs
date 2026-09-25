//! Revision-bound completion transactions. No client status or actor role is
//! trusted; canonical facts and server action policy are reread under the lock.
use super::*;
use boreal_domain::completion::CompletionKind;
use boreal_domain::decision_inputs::{EntityRevision, ProofRevision};
use serde_json::json;
use std::time::{SystemTime, UNIX_EPOCH};

fn authoritative_completion_time() -> Result<String, StoreError> {
    let elapsed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| {
            StoreError::Unavailable(format!(
                "system clock is before UNIX_EPOCH; completion mutation refused: {error}"
            ))
        })?;
    let milliseconds = i64::try_from(elapsed.as_millis()).map_err(|_| {
        StoreError::Unavailable("system clock is outside the supported timestamp range".into())
    })?;
    Ok(format!("unix-ms:{milliseconds}"))
}

/// Stable per-command audit names carried in the result payload. The current
/// append-only audit schema has a narrower event-type allowlist; these names
/// preserve the specific action until that schema can register first-class
/// event types.
fn completion_audit_action(kind: CompletionKind) -> &'static str {
    match kind {
        CompletionKind::Checkpoint => "attempt.checkpoint",
        CompletionKind::Approve => "review.approved",
        CompletionKind::Reject => "review.rejected",
        CompletionKind::Return => "review.returned",
        CompletionKind::RevokeReview => "review.revoked",
        CompletionKind::GateException => "gate.exception_granted",
        CompletionKind::WaiveDependency => "dependency.waived",
        CompletionKind::RevokeException => "exception.revoked",
        CompletionKind::Reopen => "work.reopened",
        CompletionKind::Cancel => "work.cancelled",
        CompletionKind::Retry => "work.retry_requested",
        CompletionKind::Publish => "work.published",
    }
}

#[derive(Clone, Debug)]
pub struct CompletionMutationRequest {
    pub project_id: String,
    pub work_id: String,
    pub actor_id: String,
    pub session_id: String,
    pub operation_id: String,
    pub kind: CompletionKind,
    pub expected_revision: u64,
    pub expected_entity_revision: u64,
    pub expected_proof_revision: u64,
    pub submission_id: Option<String>,
    pub target_id: Option<String>,
    pub predecessor_revision: Option<u64>,
    pub exception_reason: Option<String>,
    pub reason: String,
    pub expires_at_ms: Option<u64>,
    pub confirmed: bool,
    pub at: String,
}

impl CompletionMutationRequest {
    fn digest(&self) -> String {
        checksum(
            json!({"command":self.kind.command(),"project":self.project_id,
            "work":self.work_id,"actor":self.actor_id,"session":self.session_id,
            "revision":self.expected_revision,"entity_revision":self.expected_entity_revision,
            "proof_revision":self.expected_proof_revision,"submission":self.submission_id,
            "target":self.target_id,"predecessor_revision":self.predecessor_revision,
            "exception_reason":self.exception_reason,"reason":self.reason,
            "expires_at_ms":self.expires_at_ms,"confirmed":self.confirmed})
            .to_string()
            .as_bytes(),
        )
    }
    fn target(&self) -> Result<&str, StoreError> {
        self.target_id
            .as_deref()
            .filter(|v| !v.trim().is_empty())
            .ok_or_else(|| StoreError::Invalid("an exact target_id is required".into()))
    }
}

impl SqliteStore {
    pub(crate) fn current_gate_exception(
        &self,
        project: &str,
        work: &str,
        gate: &str,
        generation: u64,
    ) -> Result<Option<boreal_domain::decision_inputs::RequirementExceptionInput>, StoreError> {
        let mut row = self.prepare("SELECT e.exception_id,e.reason,p.role,e.subject_revision,e.proof_revision,e.expires_at_ms,EXISTS(SELECT 1 FROM boreal_exception_revocation r WHERE r.exception_id=e.exception_id) FROM boreal_policy_exception e JOIN boreal_principal p ON p.project_id=e.project_id AND p.actor_id=e.actor_id WHERE e.project_id=?1 AND e.work_id=?2 AND e.target_id=?3 AND e.kind='gate' AND e.proof_revision=?4 ORDER BY e.rowid DESC LIMIT 1")?;
        row.bind_text(1, project)?;
        row.bind_text(2, work)?;
        row.bind_text(3, gate)?;
        row.bind_i64(4, generation)?;
        if row.step()? != SQLITE_ROW {
            return Ok(None);
        }
        let reason: serde_json::Value = serde_json::from_str(&row.column_text(1)?)
            .map_err(|_| StoreError::Corrupt("exception reason is not a typed record".into()))?;
        let kind = reason
            .get("kind")
            .and_then(serde_json::Value::as_str)
            .and_then(boreal_domain::completion::exception_reason)
            .ok_or_else(|| StoreError::Corrupt("exception reason kind is unknown".into()))?;
        let comment = reason
            .get("comment")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| StoreError::Corrupt("exception comment is missing".into()))?;
        let role = match row.column_text(2)?.as_str() {
            "operator" => boreal_domain::ActorRole::Operator,
            "reviewer" => boreal_domain::ActorRole::Reviewer,
            "agent" => boreal_domain::ActorRole::Agent,
            "publisher" => boreal_domain::ActorRole::Publisher,
            _ => {
                return Err(StoreError::Corrupt(
                    "exception principal role is invalid".into(),
                ))
            }
        };
        Ok(Some(
            boreal_domain::decision_inputs::RequirementExceptionInput {
                id: row.column_text(0)?.into(),
                reason: kind,
                comment: comment.into(),
                actor_role: role,
                entity_revision: EntityRevision::new(row.column_u64(3)?),
                proof_revision: ProofRevision::new(row.column_u64(4)?),
                expires_at: row.column_optional_i64(5)?.map(boreal_domain::TimestampMs),
                revoked: row.column_bool(6)?,
            },
        ))
    }

    pub(crate) fn apply_gate_exception_diagnostics(
        &self,
        diagnostics: &mut GateDiagnostics,
        at: boreal_domain::TimestampMs,
    ) -> Result<Vec<String>, StoreError> {
        let (entity, proof) = self.proof_cursor(&diagnostics.project_id, &diagnostics.work_id)?;
        let mut applied = Vec::new();
        for gate in &diagnostics.gates {
            if let Some(exception) = self.current_gate_exception(
                &diagnostics.project_id,
                &diagnostics.work_id,
                &gate.gate_id,
                proof,
            )? {
                if exception.applies(
                    gate.state,
                    EntityRevision::new(entity),
                    ProofRevision::new(proof),
                    at,
                ) {
                    diagnostics.missing.retain(|id| id != &gate.gate_id);
                    applied.push(exception.id.to_string());
                }
            }
        }
        Ok(applied)
    }

    pub fn apply_completion_command(
        &self,
        request: &CompletionMutationRequest,
    ) -> Result<MutationResult, StoreError> {
        if !self.canonical_production {
            return Err(StoreError::Invalid(
                "completion commands require canonical persistence".into(),
            ));
        }
        self.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| {
            let digest = request.digest();
            let prior_checkpoint = if request.kind == CompletionKind::Checkpoint {
                self.operation(&request.operation_id)?
            } else {
                None
            };
            let prior_checkpoint_audit = if prior_checkpoint.is_some() {
                self.audit_event(&request.operation_id)?
            } else {
                None
            };
            let replay_attempt_id = prior_checkpoint
                .as_ref()
                .and_then(|operation| operation.attempt_id.as_deref());
            let replay_fence = prior_checkpoint
                .as_ref()
                .and_then(|operation| operation.fence);
            let replay_subject_type = prior_checkpoint_audit
                .as_ref()
                .map(|audit| audit.subject_type.as_str())
                .unwrap_or("work");
            let replay_subject_id = prior_checkpoint_audit
                .as_ref()
                .map(|audit| audit.subject_id.as_str())
                .unwrap_or(&request.work_id);
            if let Some(prior) = self.preflight_operation_replay(
                &request.project_id,
                &request.operation_id,
                request.kind.command(),
                &request.actor_id,
                Some(&request.session_id),
                Some(request.expected_revision),
                replay_attempt_id,
                replay_fence,
                &digest,
                replay_subject_type,
                replay_subject_id,
            )? {
                return Ok(MutationResult {
                    operation_id: prior.operation_id,
                    revision: prior.revision,
                    replayed: true,
                });
            }
            // The caller timestamp is intentionally excluded from the request
            // digest, but it must never authorize a production mutation. Sample
            // trusted time only after obtaining BEGIN IMMEDIATE so a request
            // queued behind another writer cannot cross an expiry boundary
            // using a stale pre-lock timestamp.
            let at = authoritative_completion_time()?;
            if !request.confirmed || request.reason.trim().is_empty() {
                return Err(StoreError::Invalid(
                    "completion mutations require explicit confirmation and a non-empty reason"
                        .into(),
                ));
            }
            self.validate_project_session(
                &request.project_id,
                &request.actor_id,
                &request.session_id,
            )?;
            check_expected_revision(
                self.project_revision(&request.project_id)?.0,
                Some(request.expected_revision),
            )?;
            let (entity_revision, proof_revision) =
                self.proof_cursor(&request.project_id, &request.work_id)?;
            if entity_revision != request.expected_entity_revision
                || proof_revision != request.expected_proof_revision
            {
                return Err(StoreError::Conflict(
                    "stale entity/proof revision; refresh the server action".into(),
                ));
            }
            let at_ms = status_evaluation::canonical_status_timestamp(&at)?;
            self.authorize_work_action_in_transaction(
                &request.project_id,
                &request.work_id,
                &request.actor_id,
                Some(&request.session_id),
                at_ms,
                request.kind.action(),
            )?;
            let mut snapshot = self.read_project_status_in_transaction(&request.project_id)?;
            self.populate_status_action_facts_for_session(
                &mut snapshot,
                &request.actor_id,
                Some(&request.session_id),
                at_ms,
            )?;
            let facts = snapshot
                .works
                .iter()
                .find(|row| row.work.id.as_str() == request.work_id)
                .and_then(|row| row.action_facts.canonical_inputs.clone())
                .ok_or_else(|| {
                    StoreError::Corrupt(
                        "canonical action facts are unavailable for this scope".into(),
                    )
                })?;
            let mut impact = Vec::new();
            let mut checkpoint_identity = None;
            match request.kind {
                CompletionKind::Checkpoint => {
                    let execution = facts.execution.as_present().ok_or_else(|| {
                        StoreError::Conflict("checkpoint requires a current execution".into())
                    })?;
                    let attempt_id = execution.attempt.attempt_id.as_str().to_owned();
                    let fence = execution.attempt.fence.get();
                    let mut update=self.prepare("UPDATE attempt SET last_checkpoint_at=?1 WHERE attempt_id=?2 AND work_id=?3 AND fence=?4 AND current=1")?;
                    update.bind_text(1, &at)?;
                    update.bind_text(2, &attempt_id)?;
                    update.bind_text(3, &request.work_id)?;
                    update.bind_i64(4, fence)?;
                    update.run()?;
                    if update.changes()? != 1 {
                        return Err(StoreError::Conflict(
                            "checkpoint attempt/fence is no longer current".into(),
                        ));
                    }
                    checkpoint_identity = Some((attempt_id, fence));
                    // The checkpoint is progress history, not a passing gate receipt.
                    // Its structured reason and exact proof context remain in the operation/audit below.
                }
                CompletionKind::Approve
                | CompletionKind::Reject
                | CompletionKind::Return
                | CompletionKind::RevokeReview => {
                    self.commit_review_decision(request, &at)?;
                    if request.kind == CompletionKind::RevokeReview {
                        impact = self.invalidate_completion_outcomes(request, &at)?;
                    }
                }
                CompletionKind::GateException | CompletionKind::WaiveDependency => {
                    self.commit_policy_exception(request, &at)?
                }
                CompletionKind::RevokeException => {
                    let mut subject = self.prepare("SELECT work_id FROM boreal_policy_exception WHERE project_id=?1 AND exception_id=?2")?;
                    subject.bind_text(1, &request.project_id)?;
                    subject.bind_text(2, request.target()?)?;
                    if subject.step()? != SQLITE_ROW || subject.column_text(0)? != request.work_id {
                        return Err(StoreError::Conflict(
                            "exception target is not in this work scope".into(),
                        ));
                    }
                    let mut insert = self.prepare("INSERT INTO boreal_exception_revocation(exception_id,actor_id,operation_id,reason,revoked_at) VALUES (?1,?2,?3,?4,?5)")?;
                    insert.bind_text(1, request.target()?)?;
                    insert.bind_text(2, &request.actor_id)?;
                    insert.bind_text(3, &request.operation_id)?;
                    insert.bind_text(4, &request.reason)?;
                    insert.bind_text(5, &at)?;
                    insert.run()?;
                    impact = self.invalidate_completion_outcomes(request, &at)?;
                }
                CompletionKind::Reopen
                | CompletionKind::Retry
                | CompletionKind::Cancel
                | CompletionKind::Publish => {
                    let mut live =
                        self.prepare("SELECT 1 FROM attempt WHERE work_id=?1 AND current=1")?;
                    live.bind_text(1, &request.work_id)?;
                    if live.step()? == SQLITE_ROW {
                        return Err(StoreError::Conflict("stop and reconcile the fenced execution before changing work lifecycle".into()));
                    }
                    if matches!(request.kind, CompletionKind::Reopen | CompletionKind::Retry) {
                        let mut obligations = self.prepare("SELECT 1 FROM boreal_recovery_obligation WHERE project_id=?1 AND work_id=?2 AND state='unresolved'")?;
                        obligations.bind_text(1, &request.project_id)?;
                        obligations.bind_text(2, &request.work_id)?;
                        if obligations.step()? == SQLITE_ROW {
                            return Err(StoreError::Conflict(
                                "unresolved recovery cannot be cleared by reopen/retry".into(),
                            ));
                        }
                        impact = self.invalidate_completion_outcomes(request, &at)?;
                    }
                    let lifecycle = if request.kind == CompletionKind::Cancel {
                        "cancelled"
                    } else {
                        "open"
                    };
                    let mut update = self.prepare("UPDATE work_item SET lifecycle=?3,retry_not_before=NULL,updated_at=?4 WHERE project_id=?1 AND work_id=?2")?;
                    update.bind_text(1, &request.project_id)?;
                    update.bind_text(2, &request.work_id)?;
                    update.bind_text(3, lifecycle)?;
                    update.bind_text(4, &at)?;
                    update.run()?;
                    let next =
                        if matches!(request.kind, CompletionKind::Reopen | CompletionKind::Retry) {
                            self.begin_completion_generation(request, &at)?
                        } else {
                            proof_revision
                        };
                    let name = match request.kind {
                        CompletionKind::Reopen => "reopened",
                        CompletionKind::Retry => "retried",
                        CompletionKind::Cancel => "cancelled",
                        _ => "published",
                    };
                    let mut history = self.prepare("INSERT INTO boreal_work_transition(operation_id,project_id,work_id,transition,prior_proof_revision,next_proof_revision,reason,actor_id,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)")?;
                    history.bind_text(1, &request.operation_id)?;
                    history.bind_text(2, &request.project_id)?;
                    history.bind_text(3, &request.work_id)?;
                    history.bind_text(4, name)?;
                    history.bind_i64(5, proof_revision)?;
                    history.bind_i64(6, next)?;
                    history.bind_text(7, &request.reason)?;
                    history.bind_text(8, &request.actor_id)?;
                    history.bind_text(9, &at)?;
                    history.run()?;
                }
            }
            let revision = self.bump_revision_in_transaction(&request.project_id)?.0;
            let (entity, proof) = self.proof_cursor(&request.project_id, &request.work_id)?;
            let payload = json!({"project_id":request.project_id,"work_id":request.work_id,"command":request.kind.command(),
                "event_name":completion_audit_action(request.kind),
                "entity_revision":entity,"proof_revision":proof,"operation_id":request.operation_id,"target_id":request.target_id,
                "submission_id":request.submission_id,"reason":request.reason,"affected_dependents":impact,
                "attempt_id":checkpoint_identity.as_ref().map(|(attempt_id, _)| attempt_id),
                "fence":checkpoint_identity.as_ref().map(|(_, fence)| fence)}).to_string();
            let event = match request.kind {
                // The stored audit schema currently rejects this event type
                // despite listing it in SQLite's CHECK. Keep the registered
                // envelope and persist the precise action name in payload.
                CompletionKind::Checkpoint => "repair.correction",
                CompletionKind::Approve => "review.accepted",
                CompletionKind::Reject => "review.rejected",
                // The frozen audit vocabulary has no review.revoked value.
                // A revocation supersedes the previously accepted decision;
                // command and target remain explicit in the payload.
                CompletionKind::RevokeReview => "repair.supersession",
                CompletionKind::Return => "repair.correction",
                CompletionKind::Reopen | CompletionKind::Retry => "work.reopened",
                CompletionKind::Cancel => "work.cancelled",
                CompletionKind::Publish => "work.published",
                _ => "repair.correction",
            };
            let (attempt_id, fence) = checkpoint_identity
                .as_ref()
                .map(|(attempt_id, fence)| (Some(attempt_id.clone()), Some(*fence)))
                .unwrap_or((None, None));
            let (subject_type, subject_id) = checkpoint_identity
                .as_ref()
                .map(|(attempt_id, _)| ("attempt", attempt_id.clone()))
                .unwrap_or(("work", request.work_id.clone()));
            self.append_operation_audit_in_transaction(
                OperationRecord {
                    operation_id: request.operation_id.clone(),
                    project_id: request.project_id.clone(),
                    command: request.kind.command().into(),
                    actor_id: request.actor_id.clone(),
                    session_id: Some(request.session_id.clone()),
                    expected_revision: Some(request.expected_revision),
                    attempt_id,
                    fence,
                    request_digest: digest,
                    outcome: OperationOutcome::Changed,
                    result_json: payload.clone(),
                    revision,
                    created_at: at.clone(),
                    completed_at: Some(at.clone()),
                },
                AuditEventRecord {
                    project_id: request.project_id.clone(),
                    revision,
                    operation_id: request.operation_id.clone(),
                    event_type: event.into(),
                    subject_type: subject_type.into(),
                    subject_id,
                    actor_id: request.actor_id.clone(),
                    session_id: Some(request.session_id.clone()),
                    fence: checkpoint_identity.as_ref().map(|(_, fence)| *fence),
                    as_of: at,
                    payload_json: payload,
                },
            )?;
            Ok(MutationResult {
                operation_id: request.operation_id.clone(),
                revision,
                replayed: false,
            })
        })();
        finish_transaction(self, result)
    }

    fn commit_review_decision(
        &self,
        request: &CompletionMutationRequest,
        at: &str,
    ) -> Result<(), StoreError> {
        let sealed = self
            .current_submission(
                &request.project_id,
                &request.work_id,
                request.expected_proof_revision,
            )?
            .ok_or_else(|| StoreError::Conflict("review requires a sealed submission".into()))?;
        if request.submission_id.as_deref() != Some(sealed.submission_id.as_str()) {
            return Err(StoreError::Conflict(
                "review requires the exact current submission_id".into(),
            ));
        }
        let attempt = self
            .attempt_record(&sealed.attempt_id, false)?
            .ok_or_else(|| StoreError::Corrupt("submission attempt is missing".into()))?;
        let (_, caller_root) = self.principal_authority(&request.project_id, &request.actor_id)?;
        if caller_root == self.recorded_principal_root(&request.project_id, &attempt.actor_id)? {
            return Err(StoreError::Conflict(
                "reviewer shares the submitted result's authority root".into(),
            ));
        }
        let pin = profiles::ProfileStore::new(self)
            .current_pinned_requirements(&request.project_id, &request.work_id)?;
        let target = request.target()?;
        let gate = pin
            .declarations
            .iter()
            .find(|gate| {
                gate.kind == "review"
                    && (gate.gate_id == target
                        || format!("{}:{}", request.work_id, gate.gate_id) == target)
            })
            .ok_or_else(|| {
                StoreError::Conflict("review target is not a pinned review requirement".into())
            })?;
        if self.submission_receipts(&attempt)? != sealed.receipt_ids {
            return Err(StoreError::Conflict(
                "proof changed after sealing; seal a new result before review".into(),
            ));
        }
        let gate_id = format!("{}:{}", request.work_id, gate.gate_id);
        if request.kind == CompletionKind::RevokeReview {
            let mut previous = self.prepare("SELECT outcome,reviewer_actor_id FROM boreal_review_event WHERE project_id=?1 AND submission_id=?2 AND gate_id=?3 ORDER BY rowid DESC LIMIT 1")?;
            previous.bind_text(1, &request.project_id)?;
            previous.bind_text(2, &sealed.submission_id)?;
            previous.bind_text(3, &gate_id)?;
            if previous.step()? != SQLITE_ROW || previous.column_text(0)? != "approved" {
                return Err(StoreError::Conflict(
                    "only an approved current review can be revoked".into(),
                ));
            }
            if self
                .project_actor_context(&request.project_id, &request.actor_id)?
                .role
                != boreal_domain::ActorRole::Operator
                && previous.column_text(1)? != request.actor_id
            {
                return Err(StoreError::Conflict(
                    "review revocation requires its reviewer or an independent operator".into(),
                ));
            }
        }
        let outcome = match request.kind {
            CompletionKind::Approve => "approved",
            CompletionKind::Reject => "rejected",
            CompletionKind::Return => "returned",
            _ => "revoked",
        };
        let mut event = self.prepare("INSERT INTO boreal_review_event(review_event_id,project_id,work_id,submission_id,gate_id,reviewer_actor_id,outcome,reason,operation_id,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)")?;
        event.bind_text(1, &format!("review:{}", request.operation_id))?;
        event.bind_text(2, &request.project_id)?;
        event.bind_text(3, &request.work_id)?;
        event.bind_text(4, &sealed.submission_id)?;
        event.bind_text(5, &gate_id)?;
        event.bind_text(6, &request.actor_id)?;
        event.bind_text(7, outcome)?;
        event.bind_text(8, &request.reason)?;
        event.bind_text(9, &request.operation_id)?;
        event.bind_text(10, at)?;
        event.run()
    }

    fn commit_policy_exception(
        &self,
        request: &CompletionMutationRequest,
        at: &str,
    ) -> Result<(), StoreError> {
        let code = request
            .exception_reason
            .as_deref()
            .and_then(boreal_domain::completion::exception_reason)
            .ok_or_else(|| StoreError::Invalid("a typed exception_reason is required".into()))?;
        let now = status_evaluation::canonical_status_timestamp(at)?.0;
        if request.expires_at_ms.is_some_and(|at| at <= now) {
            return Err(StoreError::Invalid(
                "exception expiry must be in the future".into(),
            ));
        }
        let target = request.target()?;
        let dependency = request.kind == CompletionKind::WaiveDependency;
        let target_id;
        if dependency {
            let mut edge = self.prepare("SELECT 1 FROM dependency WHERE project_id=?1 AND prerequisite_id=?2 AND dependent_id=?3")?;
            edge.bind_text(1, &request.project_id)?;
            edge.bind_text(2, target)?;
            edge.bind_text(3, &request.work_id)?;
            if edge.step()? != SQLITE_ROW {
                return Err(StoreError::Conflict(
                    "waiver requires the exact existing dependency edge".into(),
                ));
            }
            if request.predecessor_revision
                != Some(self.proof_cursor(&request.project_id, target)?.0)
            {
                return Err(StoreError::Conflict(
                    "waiver predecessor revision is stale or missing".into(),
                ));
            }
            target_id = format!("{target}->{}", request.work_id);
        } else {
            let pin = profiles::ProfileStore::new(self)
                .current_pinned_requirements(&request.project_id, &request.work_id)?;
            let gate = pin
                .declarations
                .iter()
                .find(|gate| {
                    gate.gate_id == target
                        || format!("{}:{}", request.work_id, gate.gate_id) == target
                })
                .ok_or_else(|| {
                    StoreError::Conflict("exception requires a pinned requirement target".into())
                })?;
            if gate.exception_policy != "operator_scoped_additional_decision" {
                return Err(StoreError::Conflict(
                    "the immutable profile does not permit this exception".into(),
                ));
            }
            target_id = format!("{}:{}", request.work_id, gate.gate_id);
            let sealed = self
                .current_submission(
                    &request.project_id,
                    &request.work_id,
                    request.expected_proof_revision,
                )?
                .ok_or_else(|| {
                    StoreError::Conflict(
                        "a gate exception requires an actual submitted result".into(),
                    )
                })?;
            let diagnostics = self.gate_diagnostics(
                &request.project_id,
                &request.work_id,
                &sealed.attempt_id,
                sealed.fence,
            )?;
            if !diagnostics.gates.iter().any(|observed| {
                observed.gate_id == target_id && observed.state == GateState::Failed
            }) {
                return Err(StoreError::Conflict(
                    "an exception can disposition a failed fact, not fabricate missing proof"
                        .into(),
                ));
            }
        }
        let mut insert = self.prepare("INSERT INTO boreal_policy_exception(exception_id,project_id,work_id,kind,target_id,predecessor_id,proof_revision,subject_revision,predecessor_revision,actor_id,reason,expires_at_ms,operation_id,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)")?;
        insert.bind_text(1, &format!("exception:{}", request.operation_id))?;
        insert.bind_text(2, &request.project_id)?;
        insert.bind_text(3, &request.work_id)?;
        insert.bind_text(4, if dependency { "dependency" } else { "gate" })?;
        insert.bind_text(5, &target_id)?;
        insert.bind_optional_text(6, dependency.then_some(target))?;
        insert.bind_i64(7, request.expected_proof_revision)?;
        insert.bind_i64(8, request.expected_entity_revision)?;
        insert.bind_optional_i64(9, request.predecessor_revision)?;
        insert.bind_text(10, &request.actor_id)?;
        insert.bind_text(
            11,
            &json!({"kind":code.code(),"comment":request.reason}).to_string(),
        )?;
        insert.bind_optional_i64(12, request.expires_at_ms)?;
        insert.bind_text(13, &request.operation_id)?;
        insert.bind_text(14, at)?;
        insert.run()
    }

    fn begin_completion_generation(
        &self,
        request: &CompletionMutationRequest,
        at: &str,
    ) -> Result<u64, StoreError> {
        let pin = profiles::ProfileStore::new(self)
            .current_pinned_requirements(&request.project_id, &request.work_id)?;
        let mut profile = self.prepare("SELECT definition_json,created_at FROM acceptance_profile WHERE profile_id=?1 AND version=?2")?;
        profile.bind_text(1, &pin.profile.profile_id)?;
        profile.bind_i64(2, pin.profile.version)?;
        if profile.step()? != SQLITE_ROW {
            return Err(StoreError::Corrupt("pinned profile disappeared".into()));
        }
        let next = request
            .expected_proof_revision
            .checked_add(1)
            .ok_or_else(|| StoreError::Conflict("proof revision exhausted".into()))?;
        let profile = profiles::ProfileVersion::from_canonical_definition(
            &pin.profile.profile_id,
            pin.profile.version,
            &pin.profile.policy_digest,
            profile.column_text(0)?,
            profile.column_text(1)?,
        )?;
        let fresh = profiles::PinnedRequirements::resolve(
            &profile,
            &request.project_id,
            &request.work_id,
            next,
            pin.subject_kind,
            at,
        )?;
        profiles::ProfileStore::new(self).persist_pinned_requirements_in_transaction(&fresh)?;
        let mut cursor = self.prepare("UPDATE boreal_entity_revision SET proof_revision=?3,updated_at=?4 WHERE project_id=?1 AND work_id=?2")?;
        cursor.bind_text(1, &request.project_id)?;
        cursor.bind_text(2, &request.work_id)?;
        cursor.bind_i64(3, next)?;
        cursor.bind_text(4, at)?;
        cursor.run()?;
        // Gate observations, receipts, summaries, reviews and dependency edges
        // remain unchanged. Only the current proof-generation pointer advances.
        let mut impacts = self.prepare("INSERT INTO boreal_reopen_impact(operation_id,project_id,work_id,dependent_id,prior_proof_revision,next_proof_revision,created_at) WITH RECURSIVE downstream(id) AS (SELECT dependent_id FROM dependency WHERE project_id=?1 AND prerequisite_id=?2 UNION SELECT d.dependent_id FROM dependency d JOIN downstream t ON d.prerequisite_id=t.id WHERE d.project_id=?1) SELECT ?3,?1,?2,id,?4,?5,?6 FROM downstream")?;
        impacts.bind_text(1, &request.project_id)?;
        impacts.bind_text(2, &request.work_id)?;
        impacts.bind_text(3, &request.operation_id)?;
        impacts.bind_i64(4, request.expected_proof_revision)?;
        impacts.bind_i64(5, next)?;
        impacts.bind_text(6, at)?;
        impacts.run()?;
        Ok(next)
    }

    fn invalidate_completion_outcomes(
        &self,
        request: &CompletionMutationRequest,
        at: &str,
    ) -> Result<Vec<String>, StoreError> {
        let mut invalidation = self.prepare("INSERT INTO boreal_outcome_invalidation(outcome_id,operation_id,reason,invalidated_at) SELECT outcome_id,?3,?4,?5 FROM boreal_accepted_outcome WHERE project_id=?1 AND work_id=?2 AND NOT EXISTS (SELECT 1 FROM boreal_outcome_invalidation i WHERE i.outcome_id=boreal_accepted_outcome.outcome_id)")?;
        invalidation.bind_text(1, &request.project_id)?;
        invalidation.bind_text(2, &request.work_id)?;
        invalidation.bind_text(3, &request.operation_id)?;
        invalidation.bind_text(4, &request.reason)?;
        invalidation.bind_text(5, at)?;
        invalidation.run()?;
        let mut descendants = self.prepare("WITH RECURSIVE downstream(id) AS (SELECT dependent_id FROM dependency WHERE project_id=?1 AND prerequisite_id=?2 UNION SELECT d.dependent_id FROM dependency d JOIN downstream t ON d.prerequisite_id=t.id WHERE d.project_id=?1) SELECT id FROM downstream ORDER BY id")?;
        descendants.bind_text(1, &request.project_id)?;
        descendants.bind_text(2, &request.work_id)?;
        let mut result = Vec::new();
        while descendants.step()? == SQLITE_ROW {
            result.push(descendants.column_text(0)?);
        }
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::completion_audit_action;
    use boreal_domain::completion::CompletionKind;
    use std::collections::BTreeSet;

    #[test]
    fn completion_commands_keep_distinct_audit_action_names() {
        let kinds = [
            CompletionKind::Checkpoint,
            CompletionKind::Approve,
            CompletionKind::Reject,
            CompletionKind::Return,
            CompletionKind::RevokeReview,
            CompletionKind::GateException,
            CompletionKind::WaiveDependency,
            CompletionKind::RevokeException,
            CompletionKind::Reopen,
            CompletionKind::Cancel,
            CompletionKind::Retry,
            CompletionKind::Publish,
        ];
        let names = kinds
            .into_iter()
            .map(completion_audit_action)
            .collect::<BTreeSet<_>>();
        assert_eq!(names.len(), kinds.len());
        assert_eq!(
            completion_audit_action(CompletionKind::Reject),
            "review.rejected"
        );
        assert_eq!(
            completion_audit_action(CompletionKind::RevokeReview),
            "review.revoked"
        );
        assert_eq!(
            completion_audit_action(CompletionKind::GateException),
            "gate.exception_granted"
        );
        assert_eq!(
            completion_audit_action(CompletionKind::WaiveDependency),
            "dependency.waived"
        );
    }
}
