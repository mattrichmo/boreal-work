//! Durable application façade for receipts, reviews, and proof-gated closeout.

use boreal_domain::{
    ActorId, AttemptId, ConfigIdentity, Fence, GateId, GateKind, ProfileId, ReceiptId,
    ReceiptResult, SourceVersionId, TimestampMs, WorkId,
};
use boreal_store::{
    CloseIntentRequest, CloseIntentResult, EvidenceExecutionAdmissionRequest,
    EvidenceExecutionAdmissionResult, EvidenceExecutionRecord, ReceiptAcceptanceExpectation,
    ReceiptAttestation, ReceiptInsertRequest, ReceiptInsertResult, ReceiptOutcome, ReceiptRecord,
    ReceiptSubmissionKind, ReviewDecision as StoreReviewDecision, ReviewInsertRequest, StoreError,
    SummaryInsertRequest, SummaryInsertResult,
};
use serde_json::{json, Value};

use crate::{
    canonical_request_digest, validate_review_decision, AcceptanceDefinition, AcceptanceEvaluation,
    AcceptanceGateDefinition, ApplicationError, CloseIntent, CloseoutInput, EvidenceErrorCode,
    EvidenceRunRequest, EvidenceRunResult, ReceiptExpectation, ReceiptExpectationBase,
    ReceiptPayload, ReviewDecision, ReviewDecisionRequest, SqliteStore, SummaryPayload,
    WorkApplication,
};

impl WorkApplication<'_> {
    pub fn record_receipt(
        &self,
        actor_id: &str,
        session_id: Option<&str>,
        receipt: &ReceiptPayload,
        expected_project_revision: Option<u64>,
        now: TimestampMs,
    ) -> Result<ReceiptInsertResult, ApplicationError> {
        if receipt.attestation == crate::ExecutorAttestation::BorealWitnessed {
            return Err(ApplicationError::Evidence(
                crate::EvidenceValidationError::new(
                    EvidenceErrorCode::WitnessedReceiptImportDenied,
                ),
            ));
        }
        let expected = self.current_receipt_expectation(receipt, actor_id, session_id)?;
        receipt
            .validate_for_import(&expected)
            .map_err(ApplicationError::from)?;

        // An imported/self-reported passing payload is retained as a rejected
        // fact. It is never allowed to satisfy a gate merely because its JSON
        // says `result: passed` or names an observable. External attestation is
        // the only imported form that may remain eligible for acceptance.
        let (result, rejection_code) =
            if receipt.result == ReceiptResult::Passed && !receipt.attestation.is_gate_trusted() {
                (
                    ReceiptOutcome::Rejected,
                    Some(EvidenceErrorCode::ReceiptAttestationMissing.as_str()),
                )
            } else {
                (receipt_outcome(receipt.result), None)
            };
        self.insert_receipt(
            actor_id,
            session_id,
            receipt,
            &expected,
            ReceiptSubmissionKind::ExternalImport,
            expected_project_revision,
            now,
            result,
            rejection_code,
        )
    }

    /// Reserve one witnessed execution before the adapter creates artifacts or
    /// launches a process. A replay returns the existing journal record and is
    /// deliberately not permission to run the command again.
    pub fn admit_witnessed_execution(
        &self,
        actor_id: &str,
        session_id: Option<&str>,
        request: &EvidenceRunRequest,
        artifact_ref: &str,
        now: TimestampMs,
    ) -> Result<EvidenceExecutionAdmissionResult, ApplicationError> {
        let project_id = self.project_for_work(request.expectation.work_id.as_str())?;
        let gate_id = self.store().gate_id_for_work(
            &project_id,
            request.expectation.work_id.as_str(),
            request.expectation.gate.id.as_str(),
        )?;
        let profile_version = request.expectation.profile_version.parse().map_err(|_| {
            ApplicationError::Evidence(crate::EvidenceValidationError::new(
                EvidenceErrorCode::ReceiptPolicyMismatch,
            ))
        })?;
        let request_digest = canonical_request_digest(
            "evidence.execution.admit/v1",
            json!({
                "operation_id": request.operation_id.as_str(),
                "receipt_id": request.receipt_id.as_str(),
                "project_id": project_id.as_str(),
                "work_id": request.expectation.work_id.as_str(),
                "attempt_id": request.expectation.attempt_id.as_str(),
                "fence": request.expectation.fence.get(),
                "gate_id": gate_id.as_str(),
                "source_version_id": request.expectation.source_snapshot_hash.as_str(),
                "config_identity": request.expectation.config_identity.as_str(),
                "profile_id": request.expectation.profile_id.as_str(),
                "profile_version": request.expectation.profile_version,
                "gate_kind": format!("{:?}", request.expectation.gate.kind),
                "gate_required": request.expectation.gate.required,
                "requires_attestation": request.expectation.gate.requires_attestation,
                "required_observables": request.expectation.gate.required_observables,
                "command": request.expectation.gate.command.as_ref().map(|command| json!({
                    "executable": command.executable,
                    "argv": command.argv,
                })),
                "cwd": request.cwd,
                "environment_fingerprint": request.environment_fingerprint,
                "artifact_ref": artifact_ref,
            }),
        );
        Ok(self
            .store()
            .admit_evidence_execution(EvidenceExecutionAdmissionRequest {
                operation_id: request.operation_id.as_str().to_owned(),
                project_id,
                work_id: request.expectation.work_id.as_str().to_owned(),
                attempt_id: request.expectation.attempt_id.as_str().to_owned(),
                fence: request.expectation.fence.get(),
                gate_id,
                actor_id: actor_id.to_owned(),
                session_id: session_id.map(str::to_owned),
                request_digest,
                artifact_ref: artifact_ref.to_owned(),
                source_version_id: Some(
                    request.expectation.source_snapshot_hash.as_str().to_owned(),
                ),
                config_identity: request.expectation.config_identity.as_str().to_owned(),
                profile_id: request.expectation.profile_id.as_str().to_owned(),
                profile_version,
                admitted_at: stamp(now),
            })?)
    }

    pub fn start_witnessed_execution(
        &self,
        operation_id: &str,
        now: TimestampMs,
    ) -> Result<EvidenceExecutionRecord, ApplicationError> {
        Ok(self
            .store()
            .start_evidence_execution(operation_id, &stamp(now))?)
    }

    pub fn finish_witnessed_execution(
        &self,
        operation_id: &str,
        exit_code: Option<i32>,
        now: TimestampMs,
    ) -> Result<EvidenceExecutionRecord, ApplicationError> {
        Ok(self
            .store()
            .finish_evidence_execution(operation_id, &stamp(now), exit_code)?)
    }

    pub fn mark_witnessed_execution_unknown(
        &self,
        operation_id: &str,
        failure_code: &str,
    ) -> Result<EvidenceExecutionRecord, ApplicationError> {
        Ok(self
            .store()
            .mark_evidence_execution_unknown(operation_id, failure_code)?)
    }

    /// Record a receipt produced by the trusted bounded execution adapter.
    /// The ordinary `record_receipt` path is intentionally an import path and
    /// rejects `BorealWitnessed`; callers must provide the application-built
    /// run request/result pair so the full declared command and observable
    /// expectation is checked again immediately before persistence.
    pub fn record_witnessed_execution(
        &self,
        actor_id: &str,
        session_id: Option<&str>,
        request: &EvidenceRunRequest,
        result: &EvidenceRunResult,
        expected_project_revision: Option<u64>,
        now: TimestampMs,
    ) -> Result<ReceiptInsertResult, ApplicationError> {
        if request.attestation != crate::ExecutorAttestation::BorealWitnessed
            || result.receipt.attestation != crate::ExecutorAttestation::BorealWitnessed
        {
            return Err(ApplicationError::Evidence(
                crate::EvidenceValidationError::new(EvidenceErrorCode::ReceiptAttestationMissing),
            ));
        }
        result
            .receipt
            .validate_for(&request.expectation)
            .map_err(ApplicationError::from)?;
        self.ensure_current_context(&result.receipt, &request.expectation, actor_id, session_id)?;
        self.insert_receipt(
            actor_id,
            session_id,
            &result.receipt,
            &request.expectation,
            ReceiptSubmissionKind::WitnessedExecutor,
            expected_project_revision,
            now,
            receipt_outcome(result.receipt.result),
            None,
        )
    }

    /// Record an imported receipt with a caller-supplied complete expectation.
    /// This is useful to adapters that already resolved a declared command and
    /// observable policy. It still compares the expectation to the persisted
    /// current attempt/work/gate context before accepting the fact.
    pub fn record_receipt_with_expectation(
        &self,
        actor_id: &str,
        session_id: Option<&str>,
        receipt: &ReceiptPayload,
        expected: &ReceiptExpectation,
        expected_project_revision: Option<u64>,
        now: TimestampMs,
    ) -> Result<ReceiptInsertResult, ApplicationError> {
        if receipt.attestation == crate::ExecutorAttestation::BorealWitnessed {
            return Err(ApplicationError::Evidence(
                crate::EvidenceValidationError::new(
                    EvidenceErrorCode::WitnessedReceiptImportDenied,
                ),
            ));
        }
        self.ensure_current_context(receipt, expected, actor_id, session_id)?;
        receipt
            .validate_for_import(expected)
            .map_err(ApplicationError::from)?;
        let (result, rejection_code) =
            if receipt.result == ReceiptResult::Passed && !receipt.attestation.is_gate_trusted() {
                (
                    ReceiptOutcome::Rejected,
                    Some(EvidenceErrorCode::ReceiptAttestationMissing.as_str()),
                )
            } else {
                (receipt_outcome(receipt.result), None)
            };
        self.insert_receipt(
            actor_id,
            session_id,
            receipt,
            expected,
            ReceiptSubmissionKind::ExternalImport,
            expected_project_revision,
            now,
            result,
            rejection_code,
        )
    }

    /// Evaluate only proof eligible for the supplied current attempt. The
    /// store's work-level gate state is deliberately ignored here: it is a
    /// derived cache and cannot authorize closeout after an attempt rollover.
    ///
    /// Receipt commits recheck this context atomically. Close finalization is
    /// still a separate transaction, so this read remains a fail-closed
    /// projection and must not by itself authorize a later close mutation.
    pub fn evaluate_current_acceptance(
        &self,
        project_id: &str,
        work_id: &WorkId,
        attempt_id: &AttemptId,
        fence: Fence,
        definition: &AcceptanceDefinition,
    ) -> Result<AcceptanceEvaluation, ApplicationError> {
        let attempt = self
            .store()
            .current_attempt(project_id, attempt_id.as_str())?;
        if attempt.work_id != work_id.as_str() || attempt.fence != fence.get() {
            return Err(ApplicationError::Evidence(
                crate::EvidenceValidationError::new(EvidenceErrorCode::StaleFence),
            ));
        }
        let source_snapshot_hash = attempt.source_version_id.clone().ok_or_else(|| {
            ApplicationError::Evidence(crate::EvidenceValidationError::new(
                EvidenceErrorCode::ReceiptSourceMismatch,
            ))
        })?;
        let base = ReceiptExpectationBase {
            work_id: work_id.clone(),
            attempt_id: attempt_id.clone(),
            fence,
            source_snapshot_hash: SourceVersionId::new(source_snapshot_hash),
            config_identity: ConfigIdentity::new(attempt.config_identity.clone()),
        };
        let diagnostics = self.store().gate_diagnostics(
            project_id,
            work_id.as_str(),
            attempt_id.as_str(),
            fence.get(),
        )?;
        let mut receipts = Vec::new();
        for gate in &definition.gates {
            let persisted_gate_id =
                self.store()
                    .gate_id_for_work(project_id, work_id.as_str(), gate.id.as_str())?;
            let persisted = self
                .store()
                .gate(project_id, work_id.as_str(), &persisted_gate_id)?
                .ok_or_else(|| StoreError::NotFound {
                    entity: "gate",
                    id: gate.id.as_str().to_owned(),
                })?;
            if persisted.profile_id != definition.id.as_str()
                || persisted.profile_version.to_string() != definition.version
                || persisted.kind != gate.kind
                || persisted.required != gate.required
            {
                return Err(ApplicationError::Evidence(
                    crate::EvidenceValidationError::new(EvidenceErrorCode::ReceiptPolicyMismatch),
                ));
            }
            if let Some(receipt_id) = diagnostics
                .gates
                .iter()
                .find(|candidate| candidate.gate_id == persisted_gate_id)
                .and_then(|candidate| candidate.receipt_id.as_deref())
            {
                let record = self.store().receipt(receipt_id)?.ok_or_else(|| {
                    StoreError::Corrupt("gate diagnostic refers to missing receipt".to_owned())
                })?;
                let mut payload = receipt_payload_from_record(&record)?;
                payload.gate_id = gate.id.clone();
                receipts.push(payload);
            }
        }
        Ok(crate::evaluate_acceptance(definition, &receipts, &base)?)
    }

    fn current_receipt_expectation(
        &self,
        receipt: &ReceiptPayload,
        actor_id: &str,
        session_id: Option<&str>,
    ) -> Result<ReceiptExpectation, ApplicationError> {
        let project_id = self.project_for_work(receipt.work_id.as_str())?;
        let attempt = self
            .store()
            .current_attempt(&project_id, receipt.attempt_id.as_str())?;
        if attempt.work_id != receipt.work_id.as_str()
            || attempt.actor_id != actor_id
            || attempt.session_id.as_deref() != session_id
        {
            return Err(ApplicationError::Store(StoreError::WrongOwner {
                expected: actor_id.to_owned(),
                actual: attempt.actor_id,
            }));
        }
        let source_snapshot_hash = attempt.source_version_id.ok_or_else(|| {
            ApplicationError::Evidence(crate::EvidenceValidationError::new(
                EvidenceErrorCode::ReceiptSourceMismatch,
            ))
        })?;
        let persisted_gate_id = self.store().gate_id_for_work(
            &project_id,
            receipt.work_id.as_str(),
            receipt.gate_id.as_str(),
        )?;
        let gate = self
            .store()
            .gate(&project_id, receipt.work_id.as_str(), &persisted_gate_id)?
            .ok_or_else(|| StoreError::NotFound {
                entity: "gate",
                id: receipt.gate_id.as_str().to_owned(),
            })?;
        Ok(ReceiptExpectation {
            work_id: receipt.work_id.clone(),
            attempt_id: receipt.attempt_id.clone(),
            fence: boreal_domain::Fence::new(attempt.fence),
            source_snapshot_hash: SourceVersionId::new(source_snapshot_hash),
            config_identity: ConfigIdentity::new(attempt.config_identity),
            profile_id: ProfileId::new(gate.profile_id),
            profile_version: gate.profile_version.to_string(),
            gate: AcceptanceGateDefinition {
                id: receipt.gate_id.clone(),
                kind: gate.kind,
                required: gate.required,
                command: None,
                requires_attestation: true,
                required_observables: Vec::new(),
            },
        })
    }

    fn ensure_current_context(
        &self,
        receipt: &ReceiptPayload,
        expected: &ReceiptExpectation,
        actor_id: &str,
        session_id: Option<&str>,
    ) -> Result<(), ApplicationError> {
        let persisted = self.current_receipt_expectation(receipt, actor_id, session_id)?;
        if persisted.work_id != expected.work_id
            || persisted.attempt_id != expected.attempt_id
            || persisted.fence != expected.fence
            || persisted.source_snapshot_hash != expected.source_snapshot_hash
            || persisted.config_identity != expected.config_identity
            || persisted.profile_id != expected.profile_id
            || persisted.profile_version != expected.profile_version
            || persisted.gate.id != expected.gate.id
            || persisted.gate.kind != expected.gate.kind
            || persisted.gate.required != expected.gate.required
        {
            return Err(ApplicationError::Evidence(
                crate::EvidenceValidationError::new(EvidenceErrorCode::ReceiptPolicyMismatch),
            ));
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn insert_receipt(
        &self,
        actor_id: &str,
        session_id: Option<&str>,
        receipt: &ReceiptPayload,
        expected: &ReceiptExpectation,
        submission_kind: ReceiptSubmissionKind,
        expected_project_revision: Option<u64>,
        now: TimestampMs,
        result: ReceiptOutcome,
        rejection_code: Option<&str>,
    ) -> Result<ReceiptInsertResult, ApplicationError> {
        let project_id = self.project_for_work(receipt.work_id.as_str())?;
        let gate_id = self.store().gate_id_for_work(
            &project_id,
            receipt.work_id.as_str(),
            receipt.gate_id.as_str(),
        )?;
        Ok(self.store().insert_receipt(ReceiptInsertRequest {
            project_id,
            actor_id: actor_id.to_owned(),
            session_id: session_id.map(str::to_owned),
            expected_project_revision,
            request_digest: canonical_request_digest(
                "evidence.receipt.record/v1",
                json!({
                    "schema_version": receipt.schema_version,
                    "receipt_id": receipt.receipt_id.as_str(),
                    "work_id": receipt.work_id.as_str(),
                    "attempt_id": receipt.attempt_id.as_str(),
                    "fence": receipt.fence.get(),
                    "gate_id": receipt.gate_id.as_str(),
                    "executable": receipt.executable,
                    "argv": receipt.argv,
                    "cwd": receipt.cwd,
                    "exit_code": receipt.exit_code,
                    "started_at": receipt.started_at.as_millis(),
                    "ended_at": receipt.ended_at.as_millis(),
                    "source_version_id": receipt.source_snapshot_hash.as_str(),
                    "config_identity": receipt.config_identity.as_str(),
                    "environment_fingerprint": receipt.environment_fingerprint,
                    "output_digest": receipt.output_digest,
                    "output_ref": receipt.output_ref,
                    "coverage_kind": format!("{:?}", receipt.coverage.kind),
                    "profile_id": receipt.coverage.profile_id.as_str(),
                    "profile_version": receipt.coverage.profile_version,
                    "observables": receipt.coverage.observables,
                    "attestation": format!("{:?}", receipt.attestation),
                    "result": format!("{:?}", result),
                    "rejection_code": rejection_code,
                }),
            ),
            receipt_id: receipt.receipt_id.as_str().to_owned(),
            work_id: receipt.work_id.as_str().to_owned(),
            attempt_id: receipt.attempt_id.as_str().to_owned(),
            fence: receipt.fence.get(),
            operation_id: receipt.operation_id.as_str().to_owned(),
            gate_id: Some(gate_id.clone()),
            executable: receipt.executable.clone(),
            argv_json: json!(receipt.argv).to_string(),
            cwd: receipt.cwd.clone(),
            exit_code: receipt.exit_code,
            started_at: stamp(receipt.started_at),
            ended_at: stamp(receipt.ended_at),
            source_version_id: Some(receipt.source_snapshot_hash.as_str().to_owned()),
            config_identity: receipt.config_identity.as_str().to_owned(),
            environment_fingerprint: receipt.environment_fingerprint.clone(),
            output_digest: receipt.output_digest.clone(),
            output_ref: receipt.output_ref.clone(),
            subject_json: json!({
                "work_id": receipt.work_id.as_str(),
                "attempt_id": receipt.attempt_id.as_str(),
                "fence": receipt.fence.get(),
                "gate_id": receipt.gate_id.as_str(),
            })
            .to_string(),
            coverage_json: json!({
                "kind": format!("{:?}", receipt.coverage.kind),
                "profile_id": receipt.coverage.profile_id.as_str(),
                "profile_version": receipt.coverage.profile_version,
                "observables": receipt.coverage.observables,
            })
            .to_string(),
            attestation: receipt_attestation(receipt.attestation),
            submission_kind,
            acceptance: Some(ReceiptAcceptanceExpectation {
                work_id: expected.work_id.as_str().to_owned(),
                attempt_id: expected.attempt_id.as_str().to_owned(),
                fence: expected.fence.get(),
                source_version_id: Some(expected.source_snapshot_hash.as_str().to_owned()),
                config_identity: expected.config_identity.as_str().to_owned(),
                profile_id: expected.profile_id.as_str().to_owned(),
                profile_version: expected.profile_version.parse().map_err(|_| {
                    ApplicationError::Evidence(crate::EvidenceValidationError::new(
                        EvidenceErrorCode::ReceiptPolicyMismatch,
                    ))
                })?,
                gate_id,
                gate_kind: expected.gate.kind,
                gate_required: expected.gate.required,
                requires_attestation: expected.gate.requires_attestation,
            }),
            result,
            rejection_code: rejection_code.map(str::to_owned),
            created_at: stamp(now),
        })?)
    }

    pub fn record_review(
        &self,
        actor_id: &ActorId,
        session_id: Option<&str>,
        review: &ReviewDecisionRequest,
        definition: &AcceptanceDefinition,
        expected_project_revision: Option<u64>,
        now: TimestampMs,
    ) -> Result<crate::OperationResult<()>, ApplicationError> {
        let expected = crate::ReviewExpectation {
            work_id: review.work_id.clone(),
            attempt_id: review.attempt_id.clone(),
            fence: review.fence,
            source_snapshot_hash: review.source_snapshot_hash.clone(),
            config_identity: review.config_identity.clone(),
            policy_version: review.policy_version.clone(),
        };
        validate_review_decision(review, definition, &expected).map_err(ApplicationError::from)?;
        let project_id = self.project_for_work(review.work_id.as_str())?;
        let review_gate_id = definition
            .gates
            .iter()
            .find(|gate| gate.kind == boreal_domain::GateKind::Review)
            .map(|gate| {
                self.store().gate_id_for_work(
                    &project_id,
                    review.work_id.as_str(),
                    gate.id.as_str(),
                )
            })
            .transpose()?;
        let result = self.store().insert_review(ReviewInsertRequest {
            project_id,
            actor_id: actor_id.as_str().to_owned(),
            session_id: session_id.map(str::to_owned),
            expected_project_revision,
            review_id: review.review_id.clone(),
            work_id: review.work_id.as_str().to_owned(),
            attempt_id: review.attempt_id.as_str().to_owned(),
            fence: review.fence.get(),
            gate_id: review_gate_id,
            reviewer_actor_id: review.reviewer_actor_id.as_str().to_owned(),
            decision: match review.decision {
                ReviewDecision::Accepted => StoreReviewDecision::Accepted,
                ReviewDecision::Rejected => StoreReviewDecision::Rejected,
            },
            reason: review.reason.clone(),
            source_version_id: Some(review.source_snapshot_hash.as_str().to_owned()),
            policy_digest: review.policy_version.clone(),
            operation_id: format!("review:{}", review.review_id),
            request_digest: canonical_request_digest(
                "review.decide/v1",
                json!({
                    "review_id": review.review_id,
                    "work_id": review.work_id.as_str(),
                    "attempt_id": review.attempt_id.as_str(),
                    "fence": review.fence.get(),
                    "reviewer_actor_id": review.reviewer_actor_id.as_str(),
                    "attempt_actor_id": review.attempt_actor_id.as_str(),
                    "reviewer_role": format!("{:?}", review.reviewer_role),
                    "decision": format!("{:?}", review.decision),
                    "reason": review.reason,
                    "source_version_id": review.source_snapshot_hash.as_str(),
                    "config_identity": review.config_identity.as_str(),
                    "policy_version": review.policy_version,
                }),
            ),
            created_at: stamp(now),
        })?;
        Ok(crate::OperationResult {
            operation_id: format!("review:{}", review.review_id),
            snapshot_revision: result.revision,
            changed: !result.replayed,
            value: (),
        })
    }

    /// Commit a typed summary against the exact current proof context.
    ///
    /// The store repeats every ownership, attempt, source, configuration and
    /// profile check inside the write transaction. The caller-supplied digest
    /// identifies immutable summary bytes; the body itself belongs in the
    /// bounded artifact/source layer rather than the canonical work store.
    #[allow(clippy::too_many_arguments)]
    pub fn record_summary(
        &self,
        actor_id: &str,
        session_id: Option<&str>,
        summary: &SummaryPayload,
        operation_id: &str,
        expected_project_revision: Option<u64>,
        now: TimestampMs,
    ) -> Result<SummaryInsertResult, ApplicationError> {
        summary.validate().map_err(ApplicationError::from)?;
        let profile_version = summary.profile_version.parse::<u64>().map_err(|_| {
            ApplicationError::Invalid(
                "summary profile version must be a positive integer".to_owned(),
            )
        })?;
        Ok(self.store().insert_summary(SummaryInsertRequest {
            project_id: self.project_for_work(summary.work_id.as_str())?,
            actor_id: actor_id.to_owned(),
            session_id: session_id.map(str::to_owned),
            expected_project_revision,
            summary_id: summary.summary_id.clone(),
            work_id: summary.work_id.as_str().to_owned(),
            attempt_id: summary.attempt_id.as_str().to_owned(),
            fence: summary.fence.get(),
            source_version_id: summary.source_snapshot_hash.as_str().to_owned(),
            config_identity: summary.config_identity.as_str().to_owned(),
            profile_id: summary.profile_id.as_str().to_owned(),
            profile_version,
            body_digest: summary.body_digest.clone(),
            body_size: summary.body_size,
            operation_id: operation_id.to_owned(),
            created_at: stamp(now),
        })?)
    }

    pub fn request_close(
        &self,
        actor_id: &str,
        session_id: Option<&str>,
        intent: &CloseIntent,
        expected_project_revision: Option<u64>,
        now: TimestampMs,
    ) -> Result<CloseIntentResult, ApplicationError> {
        Ok(self.store().create_close_intent(CloseIntentRequest {
            project_id: self.project_for_work(intent.work_id.as_str())?,
            actor_id: actor_id.to_owned(),
            session_id: session_id.map(str::to_owned),
            expected_project_revision,
            close_intent_id: format!("close:{}", intent.attempt_id),
            work_id: intent.work_id.as_str().to_owned(),
            attempt_id: intent.attempt_id.as_str().to_owned(),
            fence: intent.fence.get(),
            operation_id: format!("close:request:{}", intent.attempt_id),
            source_version_id: Some(intent.source_snapshot_hash.as_str().to_owned()),
            config_identity: intent.config_identity.as_str().to_owned(),
            profile_id: intent.profile_id.as_str().to_owned(),
            profile_version: intent.profile_version.parse().unwrap_or(1),
            summary_id: intent.summary_id.clone(),
            at: stamp(now),
            request_digest: close_request_digest(
                "close.request/v1",
                actor_id,
                session_id,
                expected_project_revision,
                intent,
            ),
        })?)
    }

    pub fn finalize_close(
        &self,
        actor_id: &str,
        session_id: Option<&str>,
        intent: &CloseIntent,
        expected_project_revision: Option<u64>,
        now: TimestampMs,
    ) -> Result<CloseIntentResult, ApplicationError> {
        if matches!(intent.profile_id.as_str(), "focused" | "reviewed") {
            return Err(ApplicationError::Invalid(
                "proof-gated profiles require finalize_close_checked with typed current summary/review facts"
                    .to_owned(),
            ));
        }
        self.finalize_close_unchecked(actor_id, session_id, intent, expected_project_revision, now)
    }

    /// Finalize from durable current receipts, reviews, and summary facts.
    /// The store repeats the complete current-attempt and proof-context check
    /// inside the committing transaction. A fresh evaluation operation allows
    /// corrected proof to proceed without mutating an earlier rejected result.
    #[allow(clippy::too_many_arguments)]
    pub fn finalize_close_current(
        &self,
        actor_id: &str,
        session_id: Option<&str>,
        intent: &CloseIntent,
        expected_project_revision: Option<u64>,
        now: TimestampMs,
        evaluation_operation_id: &str,
    ) -> Result<CloseIntentResult, ApplicationError> {
        self.finalize_close_with_operation(
            actor_id,
            session_id,
            intent,
            expected_project_revision,
            now,
            evaluation_operation_id,
        )
    }

    /// Finalize only after the application has evaluated immutable current
    /// proof plus typed summary/review facts. This is the safe façade for
    /// proof-gated profiles; the low-level store finalizer still needs a
    /// future atomic proof-context seam to repeat these checks inside its
    /// transaction (see `evaluate_current_acceptance`).
    pub fn finalize_close_checked(
        &self,
        actor_id: &str,
        session_id: Option<&str>,
        input: &CloseoutInput,
        expected_project_revision: Option<u64>,
        now: TimestampMs,
    ) -> Result<CloseIntentResult, ApplicationError> {
        let readiness = crate::evaluate_close_readiness(input)?;
        if !readiness.ready {
            let gaps = readiness
                .gaps
                .iter()
                .map(crate::CloseoutGap::code)
                .collect::<Vec<_>>()
                .join(",");
            return Err(ApplicationError::Invalid(format!(
                "proof-gated closeout is not ready: {gaps}"
            )));
        }
        for receipt in &input.receipts {
            self.ensure_current_context(
                receipt,
                &ReceiptExpectation {
                    work_id: input.work_id.clone(),
                    attempt_id: input.attempt.attempt_id.clone(),
                    fence: input.expected_fence,
                    source_snapshot_hash: input.source_snapshot_hash.clone(),
                    config_identity: input.config_identity.clone(),
                    profile_id: input.definition.id.clone(),
                    profile_version: input.definition.version.clone(),
                    gate: input
                        .definition
                        .gates
                        .iter()
                        .find(|gate| gate.id == receipt.gate_id)
                        .cloned()
                        .ok_or_else(|| {
                            ApplicationError::Evidence(crate::EvidenceValidationError::new(
                                EvidenceErrorCode::ReceiptSubjectMismatch,
                            ))
                        })?,
                },
                actor_id,
                session_id,
            )?;
        }
        let intent = input.close_intent.as_ref().ok_or_else(|| {
            ApplicationError::Invalid("proof-gated closeout requires a close intent".to_owned())
        })?;
        let durable = self.evaluate_current_acceptance(
            &self.project_for_work(input.work_id.as_str())?,
            &input.work_id,
            &input.attempt.attempt_id,
            input.expected_fence,
            &input.definition,
        )?;
        let durable_non_review_ready = input
            .definition
            .gates
            .iter()
            .filter(|gate| gate.required && gate.kind != GateKind::Review)
            .all(|gate| {
                durable
                    .gates
                    .iter()
                    .find(|result| result.gate_id == gate.id)
                    .is_some_and(|result| result.state == boreal_domain::GateState::Satisfied)
            });
        if !durable_non_review_ready {
            return Err(ApplicationError::Invalid(
                "durable current proof does not satisfy the closeout definition".to_owned(),
            ));
        }
        self.finalize_close_unchecked(actor_id, session_id, intent, expected_project_revision, now)
    }

    fn finalize_close_unchecked(
        &self,
        actor_id: &str,
        session_id: Option<&str>,
        intent: &CloseIntent,
        expected_project_revision: Option<u64>,
        now: TimestampMs,
    ) -> Result<CloseIntentResult, ApplicationError> {
        // A rejected evaluation is replayable only for the proof snapshot it
        // evaluated.  Bind the generated operation to the current project
        // revision so adding evidence, a summary, or a review creates a new
        // logical evaluation while an unchanged retry remains idempotent.
        let project_id = self.project_for_work(intent.work_id.as_str())?;
        let proof_revision = self.store().project_revision(&project_id)?.0;
        self.finalize_close_with_operation(
            actor_id,
            session_id,
            intent,
            expected_project_revision,
            now,
            &format!("close:finalize:{}:r{proof_revision}", intent.attempt_id),
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn finalize_close_with_operation(
        &self,
        actor_id: &str,
        session_id: Option<&str>,
        intent: &CloseIntent,
        expected_project_revision: Option<u64>,
        now: TimestampMs,
        evaluation_operation_id: &str,
    ) -> Result<CloseIntentResult, ApplicationError> {
        Ok(self.store().finalize_close_intent(CloseIntentRequest {
            project_id: self.project_for_work(intent.work_id.as_str())?,
            actor_id: actor_id.to_owned(),
            session_id: session_id.map(str::to_owned),
            expected_project_revision,
            close_intent_id: format!("close:{}", intent.attempt_id),
            work_id: intent.work_id.as_str().to_owned(),
            attempt_id: intent.attempt_id.as_str().to_owned(),
            fence: intent.fence.get(),
            operation_id: evaluation_operation_id.to_owned(),
            source_version_id: Some(intent.source_snapshot_hash.as_str().to_owned()),
            config_identity: intent.config_identity.as_str().to_owned(),
            profile_id: intent.profile_id.as_str().to_owned(),
            profile_version: intent.profile_version.parse().unwrap_or(1),
            summary_id: intent.summary_id.clone(),
            at: stamp(now),
            request_digest: close_request_digest(
                "close.finalize/v1",
                actor_id,
                session_id,
                expected_project_revision,
                intent,
            ),
        })?)
    }

    fn store(&self) -> &SqliteStore {
        self.store_ref()
    }

    fn project_for_work(&self, work_id: &str) -> Result<String, ApplicationError> {
        self.store()
            .project_for_work(work_id)
            .map_err(ApplicationError::from)
    }
}

fn close_request_digest(
    command: &str,
    actor_id: &str,
    session_id: Option<&str>,
    expected_project_revision: Option<u64>,
    intent: &CloseIntent,
) -> String {
    canonical_request_digest(
        command,
        json!({
            "work_id": intent.work_id.as_str(),
            "attempt_id": intent.attempt_id.as_str(),
            "fence": intent.fence.get(),
            "source_version_id": intent.source_snapshot_hash.as_str(),
            "config_identity": intent.config_identity.as_str(),
            "profile_id": intent.profile_id.as_str(),
            "profile_version": intent.profile_version,
            "summary_id": intent.summary_id,
            "actor_id": actor_id,
            "session_id": session_id,
            "expected_project_revision": expected_project_revision,
        }),
    )
}

fn receipt_attestation(value: crate::ExecutorAttestation) -> ReceiptAttestation {
    match value {
        crate::ExecutorAttestation::BorealWitnessed => ReceiptAttestation::BorealWitnessed,
        crate::ExecutorAttestation::ExternalAttested => ReceiptAttestation::ExternalAttested,
        crate::ExecutorAttestation::SelfReported => ReceiptAttestation::SelfReported,
        crate::ExecutorAttestation::Unknown => ReceiptAttestation::Unknown,
    }
}

fn receipt_outcome(value: boreal_domain::ReceiptResult) -> ReceiptOutcome {
    match value {
        boreal_domain::ReceiptResult::Passed => ReceiptOutcome::Passed,
        boreal_domain::ReceiptResult::Failed => ReceiptOutcome::Failed,
        boreal_domain::ReceiptResult::Stale => ReceiptOutcome::Stale,
    }
}

fn receipt_payload_from_record(record: &ReceiptRecord) -> Result<ReceiptPayload, ApplicationError> {
    let argv = serde_json::from_str(&record.argv_json).map_err(|_| {
        ApplicationError::Evidence(crate::EvidenceValidationError::new(
            EvidenceErrorCode::ReceiptInvalid,
        ))
    })?;
    let coverage = parse_coverage(&record.coverage_json)?;
    Ok(ReceiptPayload {
        schema_version: crate::RECEIPT_SCHEMA_VERSION.to_owned(),
        receipt_id: ReceiptId::new(record.receipt_id.clone()),
        operation_id: boreal_domain::OperationId::new(record.operation_id.clone()),
        work_id: WorkId::new(record.work_id.clone()),
        attempt_id: AttemptId::new(record.attempt_id.clone()),
        fence: Fence::new(record.fence),
        gate_id: GateId::new(record.gate_id.clone().ok_or_else(|| {
            ApplicationError::Evidence(crate::EvidenceValidationError::new(
                EvidenceErrorCode::ReceiptInvalid,
            ))
        })?),
        executable: record.executable.clone(),
        argv,
        cwd: record.cwd.clone(),
        exit_code: record.exit_code,
        started_at: parse_stamp(&record.started_at)?,
        ended_at: parse_stamp(&record.ended_at)?,
        source_snapshot_hash: SourceVersionId::new(record.source_version_id.clone().ok_or_else(
            || {
                ApplicationError::Evidence(crate::EvidenceValidationError::new(
                    EvidenceErrorCode::ReceiptInvalid,
                ))
            },
        )?),
        config_identity: ConfigIdentity::new(record.config_identity.clone()),
        environment_fingerprint: record.environment_fingerprint.clone(),
        output_digest: record.output_digest.clone(),
        output_ref: record.output_ref.clone(),
        coverage,
        attestation: match record.attestation {
            ReceiptAttestation::BorealWitnessed => crate::ExecutorAttestation::BorealWitnessed,
            ReceiptAttestation::ExternalAttested => crate::ExecutorAttestation::ExternalAttested,
            ReceiptAttestation::SelfReported => crate::ExecutorAttestation::SelfReported,
            ReceiptAttestation::Unknown => crate::ExecutorAttestation::Unknown,
        },
        result: match record.result {
            ReceiptOutcome::Passed => ReceiptResult::Passed,
            ReceiptOutcome::Failed | ReceiptOutcome::Rejected | ReceiptOutcome::Unknown => {
                ReceiptResult::Failed
            }
            ReceiptOutcome::Stale => ReceiptResult::Stale,
        },
    })
}

fn parse_coverage(value: &str) -> Result<crate::ReceiptCoverage, ApplicationError> {
    let value: Value = serde_json::from_str(value).map_err(|_| {
        ApplicationError::Evidence(crate::EvidenceValidationError::new(
            EvidenceErrorCode::ReceiptInvalid,
        ))
    })?;
    let kind = match value.get("kind").and_then(Value::as_str) {
        Some("Checkpoint") | Some("checkpoint") => GateKind::Checkpoint,
        Some("Verification") | Some("verification") => GateKind::Verification,
        Some("Review") | Some("review") => GateKind::Review,
        Some("OperatorApproval") | Some("operator_approval") => GateKind::OperatorApproval,
        Some("Summary") | Some("summary") => GateKind::Summary,
        Some("Audit") | Some("audit") => GateKind::Audit,
        _ => {
            return Err(ApplicationError::Evidence(
                crate::EvidenceValidationError::new(EvidenceErrorCode::ReceiptInvalid),
            ))
        }
    };
    let profile_id = value
        .get("profile_id")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            ApplicationError::Evidence(crate::EvidenceValidationError::new(
                EvidenceErrorCode::ReceiptInvalid,
            ))
        })?;
    let profile_version = value
        .get("profile_version")
        .and_then(|value| {
            value
                .as_str()
                .map(str::to_owned)
                .or_else(|| value.as_u64().map(|value| value.to_string()))
        })
        .ok_or_else(|| {
            ApplicationError::Evidence(crate::EvidenceValidationError::new(
                EvidenceErrorCode::ReceiptInvalid,
            ))
        })?;
    let observables = value
        .get("observables")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            ApplicationError::Evidence(crate::EvidenceValidationError::new(
                EvidenceErrorCode::ReceiptInvalid,
            ))
        })?
        .iter()
        .map(|value| {
            value.as_str().map(str::to_owned).ok_or_else(|| {
                ApplicationError::Evidence(crate::EvidenceValidationError::new(
                    EvidenceErrorCode::ReceiptInvalid,
                ))
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(crate::ReceiptCoverage {
        kind,
        profile_id: ProfileId::new(profile_id),
        profile_version,
        observables,
    })
}

fn parse_stamp(value: &str) -> Result<TimestampMs, ApplicationError> {
    value
        .strip_prefix("unix-ms:")
        .and_then(|value| value.parse::<u64>().ok())
        .map(TimestampMs::from_millis)
        .ok_or_else(|| {
            ApplicationError::Evidence(crate::EvidenceValidationError::new(
                EvidenceErrorCode::ReceiptInvalid,
            ))
        })
}

fn stamp(value: TimestampMs) -> String {
    format!("unix-ms:{}", value.as_millis())
}
