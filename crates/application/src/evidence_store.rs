//! Durable application façade for receipts, reviews, and proof-gated closeout.

use boreal_domain::{
    ActorId, AttemptId, ConfigIdentity, Fence, GateId, GateKind, ProfileId, ReceiptId,
    ReceiptResult, SourceVersionId, TimestampMs, WorkId,
};
use boreal_store::{
    identity::{IdentityContext, IdentityError, IdentityStore},
    AuditEventRecord, CloseIntentRequest, CloseIntentResult, EvidenceExecutionAdmissionRequest,
    EvidenceExecutionAdmissionResult, EvidenceExecutionRecord, OperationOutcome, OperationRecord,
    ReceiptAcceptanceExpectation, ReceiptAttestation, ReceiptInsertRequest, ReceiptInsertResult,
    ReceiptOutcome, ReceiptRecord, ReceiptSubmissionKind, ReviewDecision as StoreReviewDecision,
    ReviewInsertRequest, StoreError, SummaryInsertRequest, SummaryInsertResult,
};
use serde_json::{json, Value};

use crate::{
    canonical_request_digest, validate_review_decision, AcceptanceDefinition, AcceptanceEvaluation,
    AcceptanceGateDefinition, ApplicationError, CloseIntent, CloseoutInput, EvidenceErrorCode,
    EvidenceRunRequest, EvidenceRunResult, ExternalEffectAcquisition, ExternalEffectAdapter,
    ExternalEffectReadback, ExternalEffectRequest, ExternalEffectResolution, ExternalJobKind,
    ReceiptExpectation, ReceiptExpectationBase, ReceiptPayload, ReviewDecision,
    ReviewDecisionRequest, SqliteStore, SummaryPayload, WorkApplication,
};
use boreal_store::jobs::ExternalJobInput;

const VERIFIER_JOB_PREFIX: &str = "verifier:";

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
        let identity = self.identity_context(&project_id)?;
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
                "artifact_binding": artifact_binding(
                    artifact_ref,
                    request.expectation.source_snapshot_hash.as_str(),
                ),
            }),
        );
        let external_operation_id = verifier_operation_id(request.operation_id.as_str());
        let external_request = ExternalEffectRequest {
            job_id: verifier_job_id(request.operation_id.as_str()),
            operation_id: external_operation_id.clone(),
            project_id: project_id.clone(),
            subject_type: "work".to_owned(),
            subject_id: request.expectation.work_id.as_str().to_owned(),
            kind: ExternalJobKind::Verifier.as_str().to_owned(),
            request_digest: request_digest.clone(),
            source_identity: Some(request.expectation.source_snapshot_hash.as_str().to_owned()),
            config_identity: Some(request.expectation.config_identity.as_str().to_owned()),
            actor_id: actor_id.to_owned(),
            session_id: session_id.map(str::to_owned),
            deadline: None,
            created_at: stamp(now),
        };

        let payload = json!({
            "event": "evidence.verifier.admitted",
            "job_id": external_request.job_id,
            "kind": external_request.kind,
            "request_digest": external_request.request_digest,
            "source_identity": external_request.source_identity,
            "config_identity": external_request.config_identity,
            "artifact_ref": artifact_ref,
            "artifact_binding": artifact_binding(
                artifact_ref,
                request.expectation.source_snapshot_hash.as_str(),
            ),
        })
        .to_string();
        self.append_verifier_admission_journal(
            identity.as_ref(),
            &external_request,
            &payload,
            request.expectation.attempt_id.as_str(),
            request.expectation.fence.get(),
            &stamp(now),
        )?;

        // The execution identity and the external-job sidecar are admitted in
        // one store transaction.  A semantic rejection therefore creates
        // neither record, while a crash can only commit both (or neither).
        // Replays repair either half written by an older implementation and
        // never grant a second process launch.
        let evidence_request = EvidenceExecutionAdmissionRequest {
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
            source_version_id: Some(request.expectation.source_snapshot_hash.as_str().to_owned()),
            config_identity: request.expectation.config_identity.as_str().to_owned(),
            profile_id: request.expectation.profile_id.as_str().to_owned(),
            profile_version,
            admitted_at: stamp(now),
        };
        let external_input = ExternalJobInput {
            job_id: external_request.job_id.clone(),
            operation_id: external_request.operation_id.clone(),
            project_id: external_request.project_id.clone(),
            subject_type: external_request.subject_type.clone(),
            subject_id: external_request.subject_id.clone(),
            kind: external_request.kind.clone(),
            request_digest: external_request.request_digest.clone(),
            source_identity: external_request.source_identity.clone(),
            config_identity: external_request.config_identity.clone(),
            actor_id: external_request.actor_id.clone(),
            session_id: external_request.session_id.clone(),
            deadline: external_request.deadline.clone(),
            created_at: external_request.created_at.clone(),
        };
        let admitted = self.store().admit_evidence_execution_with_external_job(
            identity.as_ref(),
            &evidence_request,
            &external_input,
            evidence_request.admitted_at.as_str(),
        )?;

        Ok(admitted)
    }

    pub fn start_witnessed_execution(
        &self,
        operation_id: &str,
        now: TimestampMs,
    ) -> Result<EvidenceExecutionRecord, ApplicationError> {
        let existing = self
            .store()
            .evidence_execution(operation_id)?
            .ok_or_else(|| StoreError::NotFound {
                entity: "evidence_execution",
                id: operation_id.to_owned(),
            })?;
        let at = stamp(now);
        let Some(identity) = self.identity_context(&existing.project_id)? else {
            return Ok(self.store().start_evidence_execution(operation_id, &at)?);
        };
        let adapter = ExternalEffectAdapter::new_with_identity(self.store(), &identity);
        match adapter.start_acquisition(
            &existing.project_id,
            &verifier_job_id(operation_id),
            &at,
        )? {
            ExternalEffectAcquisition::Won(_) => {
                adapter.mark_side_effect_started(
                    &existing.project_id,
                    &verifier_job_id(operation_id),
                    &verifier_side_effect_ref(operation_id),
                    &at,
                )?;
                Ok(self.store().start_evidence_execution(operation_id, &at)?)
            }
            ExternalEffectAcquisition::AlreadyRunning(_)
            | ExternalEffectAcquisition::Pending(_)
            | ExternalEffectAcquisition::Terminal(_)
            | ExternalEffectAcquisition::Conflict { .. } => {
                Err(ApplicationError::Store(StoreError::Conflict(
                    "verifier external job was not acquired; external spawn is not authorized"
                        .to_owned(),
                )))
            }
        }
    }

    pub fn finish_witnessed_execution(
        &self,
        operation_id: &str,
        exit_code: Option<i32>,
        now: TimestampMs,
    ) -> Result<EvidenceExecutionRecord, ApplicationError> {
        let existing = self
            .store()
            .evidence_execution(operation_id)?
            .ok_or_else(|| StoreError::NotFound {
                entity: "evidence_execution",
                id: operation_id.to_owned(),
            })?;
        let at = stamp(now);
        let identity = self.identity_context(&existing.project_id)?;
        if let Some(identity) = identity.as_ref() {
            ExternalEffectAdapter::new_with_identity(self.store(), identity).readback(
                &existing.project_id,
                &verifier_operation_id(operation_id),
                &existing.request_digest,
            )?;
        }
        let execution = self
            .store()
            .finish_evidence_execution(operation_id, &at, exit_code)?;
        let Some(identity) = identity else {
            return Ok(execution);
        };
        self.transition_verifier_to_readback(
            &identity,
            &execution,
            &at,
            "verifier execution finished without attributable reconciliation",
        )?;
        Ok(execution)
    }

    pub fn mark_witnessed_execution_unknown(
        &self,
        operation_id: &str,
        failure_code: &str,
    ) -> Result<EvidenceExecutionRecord, ApplicationError> {
        let existing = self
            .store()
            .evidence_execution(operation_id)?
            .ok_or_else(|| StoreError::NotFound {
                entity: "evidence_execution",
                id: operation_id.to_owned(),
            })?;
        let identity = self.identity_context(&existing.project_id)?;
        if let Some(identity) = identity.as_ref() {
            ExternalEffectAdapter::new_with_identity(self.store(), identity).readback(
                &existing.project_id,
                &verifier_operation_id(operation_id),
                &existing.request_digest,
            )?;
        }
        let execution = self
            .store()
            .mark_evidence_execution_unknown(operation_id, failure_code)?;
        let Some(identity) = identity else {
            return Ok(execution);
        };
        self.transition_verifier_to_readback(
            &identity,
            &execution,
            &execution.admitted_at,
            failure_code,
        )?;
        Ok(execution)
    }

    pub fn readback_witnessed_execution(
        &self,
        operation_id: &str,
    ) -> Result<ExternalEffectResolution, ApplicationError> {
        let execution = self
            .store()
            .evidence_execution(operation_id)?
            .ok_or_else(|| StoreError::NotFound {
                entity: "evidence_execution",
                id: operation_id.to_owned(),
            })?;
        let identity = self
            .identity_context(&execution.project_id)?
            .ok_or_else(|| {
                StoreError::Conflict(
                    "witnessed verifier readback requires a canonical project identity".to_owned(),
                )
            })?;
        Ok(
            ExternalEffectAdapter::new_with_identity(self.store(), &identity).readback(
                &execution.project_id,
                &verifier_operation_id(operation_id),
                &execution.request_digest,
            )?,
        )
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
        if result.receipt.receipt_id != request.receipt_id
            || result.receipt.operation_id != request.operation_id
        {
            return Err(ApplicationError::Evidence(
                crate::EvidenceValidationError::new(EvidenceErrorCode::ReceiptSubjectMismatch),
            ));
        }
        result
            .receipt
            .validate_for(&request.expectation)
            .map_err(ApplicationError::from)?;
        self.ensure_current_context(&result.receipt, &request.expectation, actor_id, session_id)?;
        let project_id = self.project_for_work(request.expectation.work_id.as_str())?;
        // Recheck the caller's snapshot before reconciling the verifier job.
        // If receipt persistence is already known to be impossible, leave
        // the external job in its readback state; a reconciled job is never
        // itself an accepted proof and the receipt remains the acceptance
        // boundary.
        if let Some(expected) = expected_project_revision {
            let actual = self.store().project_revision(&project_id)?.0;
            if expected != actual {
                return Err(ApplicationError::Store(StoreError::StaleRevision {
                    expected,
                    actual,
                }));
            }
        }
        if let Some(identity) = self.identity_context(&project_id)? {
            let execution = self
                .store()
                .evidence_execution(request.operation_id.as_str())?
                .ok_or_else(|| StoreError::NotFound {
                    entity: "evidence_execution",
                    id: request.operation_id.as_str().to_owned(),
                })?;
            let resolution = self.reconcile_verifier(&identity, &execution, result, &stamp(now))?;
            if !resolution.is_resolved() {
                return Err(ApplicationError::Store(StoreError::Conflict(
                    "verifier readback is still pending; receipt cannot be accepted".to_owned(),
                )));
            }
        }
        // The verifier job resolution above is never itself proof. The
        // receipt insert is the acceptance boundary, and its transaction
        // must durably move the execution to receipt_committed.
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

    fn identity_context(
        &self,
        project_id: &str,
    ) -> Result<Option<IdentityContext>, ApplicationError> {
        match IdentityStore::new(self.store()).context(project_id) {
            Ok(identity) => Ok(Some(identity)),
            Err(IdentityError::Invalid { field, .. }) if field == "database_identity" => {
                if self.store().is_canonical_production() {
                    return Err(ApplicationError::Store(StoreError::Conflict(
                        "canonical production verifier requires database identity".to_owned(),
                    )));
                }
                Ok(None)
            }
            Err(error) => Err(ApplicationError::Store(StoreError::Conflict(format!(
                "witnessed verifier identity: {error}"
            )))),
        }
    }

    fn append_verifier_admission_journal(
        &self,
        identity: Option<&IdentityContext>,
        request: &ExternalEffectRequest,
        payload_json: &str,
        attempt_id: &str,
        fence: u64,
        at: &str,
    ) -> Result<(), ApplicationError> {
        let operation = OperationRecord {
            operation_id: request.operation_id.clone(),
            project_id: request.project_id.clone(),
            command: "evidence.verifier".to_owned(),
            actor_id: request.actor_id.clone(),
            session_id: request.session_id.clone(),
            expected_revision: None,
            attempt_id: Some(attempt_id.to_owned()),
            fence: Some(fence),
            request_digest: request.request_digest.clone(),
            outcome: OperationOutcome::Busy,
            result_json: payload_json.to_owned(),
            revision: 0,
            created_at: at.to_owned(),
            completed_at: None,
        };
        let audit = AuditEventRecord {
            project_id: request.project_id.clone(),
            revision: 0,
            operation_id: request.operation_id.clone(),
            event_type: "evidence.verifier.admitted".to_owned(),
            subject_type: request.subject_type.clone(),
            subject_id: request.subject_id.clone(),
            actor_id: request.actor_id.clone(),
            session_id: request.session_id.clone(),
            fence: Some(fence),
            as_of: at.to_owned(),
            payload_json: payload_json.to_owned(),
        };

        if let Some(identity) = identity {
            self.store()
                .append_identity_operation_audit(identity, operation, audit)?;
            return Ok(());
        }

        // Noncanonical schema-v2 fixtures do not have the database identity
        // seam, but they still receive the same operation/audit envelope so
        // the legacy fallback cannot create an execution row without a
        // durable journal companion. Replays validate the immutable fields
        // before returning instead of attempting a duplicate insert.
        if let Some(existing) = self.store().operation(&request.operation_id)? {
            if existing.project_id != operation.project_id
                || existing.command != operation.command
                || existing.actor_id != operation.actor_id
                || existing.session_id != operation.session_id
                || existing.attempt_id != operation.attempt_id
                || existing.fence != operation.fence
                || existing.request_digest != operation.request_digest
            {
                return Err(ApplicationError::Store(StoreError::Conflict(
                    "verifier operation was reused with another immutable identity".to_owned(),
                )));
            }
            let existing_audit = self
                .store()
                .audit_event(&request.operation_id)?
                .ok_or_else(|| {
                    StoreError::Corrupt("verifier operation is missing its audit event".to_owned())
                })?;
            if existing_audit.subject_type != audit.subject_type
                || existing_audit.subject_id != audit.subject_id
            {
                return Err(ApplicationError::Store(StoreError::WrongSubject {
                    expected: format!("{}/{}", audit.subject_type, audit.subject_id),
                    actual: format!(
                        "{}/{}",
                        existing_audit.subject_type, existing_audit.subject_id
                    ),
                }));
            }
            return Ok(());
        }

        let revision = self.store().next_revision(&request.project_id)?.0;
        let mut operation = operation;
        let mut audit = audit;
        operation.revision = revision;
        audit.revision = revision;
        self.store().append_operation(&operation)?;
        self.store().append_audit_event(&audit)?;
        Ok(())
    }

    fn transition_verifier_to_readback(
        &self,
        identity: &IdentityContext,
        execution: &EvidenceExecutionRecord,
        at: &str,
        reason: &str,
    ) -> Result<ExternalEffectResolution, ApplicationError> {
        let adapter = ExternalEffectAdapter::new_with_identity(self.store(), identity);
        let job_id = verifier_job_id(&execution.operation_id);
        let external_operation_id = verifier_operation_id(&execution.operation_id);
        let resolution = adapter.readback(
            &execution.project_id,
            &external_operation_id,
            &execution.request_digest,
        )?;
        match resolution {
            ExternalEffectResolution::Pending(job) if job.stage == "admitted" => {
                Ok(adapter.fail(&execution.project_id, &job_id, at, reason)?)
            }
            ExternalEffectResolution::Pending(job) if job.stage == "running" => {
                adapter.mark_side_effect_started(
                    &execution.project_id,
                    &job_id,
                    &verifier_side_effect_ref(&execution.operation_id),
                    at,
                )?;
                Ok(adapter.mark_readback_required(
                    &execution.project_id,
                    &job_id,
                    &verifier_side_effect_ref(&execution.operation_id),
                    at,
                )?)
            }
            ExternalEffectResolution::ReadbackRequired(job)
                if job.stage == "side_effect_started" || job.stage == "side_effect_finished" =>
            {
                Ok(adapter.mark_readback_required(
                    &execution.project_id,
                    &job_id,
                    &verifier_side_effect_ref(&execution.operation_id),
                    at,
                )?)
            }
            ExternalEffectResolution::ReadbackRequired(job) => {
                Ok(ExternalEffectResolution::ReadbackRequired(job))
            }
            other => Ok(other),
        }
    }

    fn reconcile_verifier(
        &self,
        identity: &IdentityContext,
        execution: &EvidenceExecutionRecord,
        result: &EvidenceRunResult,
        at: &str,
    ) -> Result<ExternalEffectResolution, ApplicationError> {
        let adapter = ExternalEffectAdapter::new_with_identity(self.store(), identity);
        let job_id = verifier_job_id(&execution.operation_id);
        let external_operation_id = verifier_operation_id(&execution.operation_id);
        let side_effect_ref = verifier_side_effect_ref(&execution.operation_id);
        let resolution = self.transition_verifier_to_readback(
            identity,
            execution,
            at,
            "verifier execution did not acquire",
        )?;
        if resolution.is_resolved() {
            return Ok(resolution);
        }
        if !resolution.is_readback_required() {
            return Err(ApplicationError::Store(StoreError::Conflict(
                "verifier job is not attributable for receipt reconciliation".to_owned(),
            )));
        }
        Ok(adapter.reconcile_readback(&ExternalEffectReadback {
            project_id: execution.project_id.clone(),
            job_id,
            operation_id: external_operation_id,
            request_digest: execution.request_digest.clone(),
            side_effect_ref,
            result_digest: canonical_request_digest(
                "evidence.verifier.result/v1",
                json!({
                    "receipt_id": result.receipt.receipt_id.as_str(),
                    "result": format!("{:?}", result.outcome),
                    "exit_code": result.receipt.exit_code,
                    "output_digest": result.receipt.output_digest,
                    "output_ref": result.receipt.output_ref,
                }),
            ),
            observed_at: at.to_owned(),
        })?)
    }
}

fn verifier_job_id(operation_id: &str) -> String {
    format!("{VERIFIER_JOB_PREFIX}{operation_id}")
}

fn verifier_operation_id(operation_id: &str) -> String {
    format!("{VERIFIER_JOB_PREFIX}{operation_id}")
}

fn verifier_side_effect_ref(operation_id: &str) -> String {
    format!("verifier-run:{operation_id}")
}

fn artifact_binding(artifact_ref: &str, source_identity: &str) -> Value {
    json!({
        "mode": "reference_only",
        "content_bound": false,
        "reference": artifact_ref,
        "source_identity": source_identity,
        "diagnostic": "artifact bytes were not supplied at verifier admission; the reference is not a content digest",
    })
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::CommandSpec;
    use boreal_domain::{
        AcceptanceProfile, ConfigIdentity, DispatchPolicy, PersistedLifecycle, ProjectId, WorkId,
        WorkItem, WorkKind,
    };
    use boreal_store::{
        identity::{DatabaseIdentity, IdentityStore, WorkspaceBinding},
        EvidenceExecutionState,
    };

    const FIXTURE_SCHEMA: &str = include_str!("../../../project/spec/schema-v2.sql");
    const PRODUCTION_SCHEMA: &str = include_str!("../../../project/spec/schema-production.sql");

    fn verifier_work(project_id: &ProjectId) -> WorkItem {
        WorkItem {
            id: WorkId::new("verifier-work"),
            project_id: project_id.clone(),
            kind: WorkKind::Task,
            parent_id: None,
            title: "verifier work".to_owned(),
            description: String::new(),
            lifecycle: PersistedLifecycle::Open,
            priority: 0,
            dispatch_policy: DispatchPolicy::Automatic,
            hard_holds: Vec::new(),
            acceptance_profile: AcceptanceProfile::focused(),
        }
    }

    fn verifier_request(operation_id: &str) -> EvidenceRunRequest {
        EvidenceRunRequest {
            receipt_id: ReceiptId::new(format!("receipt-{operation_id}")),
            operation_id: boreal_domain::OperationId::new(operation_id),
            expectation: ReceiptExpectation {
                work_id: WorkId::new("verifier-work"),
                attempt_id: AttemptId::new("verifier-attempt"),
                fence: Fence::new(1),
                source_snapshot_hash: SourceVersionId::new("source-one"),
                config_identity: ConfigIdentity::new("config-one"),
                profile_id: ProfileId::new("focused"),
                profile_version: "1".to_owned(),
                gate: AcceptanceGateDefinition::required(
                    GateId::new("verification"),
                    GateKind::Verification,
                ),
            },
            cwd: "/tmp/verifier-work".to_owned(),
            environment_fingerprint: "env-one".to_owned(),
            attestation: crate::ExecutorAttestation::BorealWitnessed,
        }
    }

    fn legacy_verifier_setup() -> (SqliteStore, ProjectId) {
        let store = SqliteStore::open_in_memory(FIXTURE_SCHEMA).expect("open fixture store");
        let app = WorkApplication::new(&store);
        let project = ProjectId::new("verifier-fixture-project");
        app.init_project(
            &project,
            "agent-one",
            "agent",
            "credential",
            "Verifier fixture",
            "unix-ms:1",
            "op-verifier-init",
        )
        .expect("initialize fixture project");
        app.create_work_as(
            &verifier_work(&project),
            "agent-one",
            "unix-ms:2",
            "op-verifier-work",
        )
        .expect("create verifier work");
        store
            .execute_batch(&format!(
                "INSERT INTO source_version
                 (source_version_id, project_id, origin, access_scope, content_digest,
                  media_type, byte_count, captured_at, parser_identity, availability, citation_json)
                 VALUES ('source-one', '{}', 'fixture', 'project',
                         'sha256:source-one', 'text/plain', 0, 'unix-ms:2',
                         'verifier-test/1', 'available', '[]');",
                project.as_str()
            ))
            .expect("insert verifier source");
        app.claim_with_context(
            &project,
            "verifier-work",
            "agent-one",
            "verifier-harness",
            None,
            "verifier-attempt",
            "op-verifier-claim",
            "sha256:verifier-claim",
            None,
            "unix-ms:1000",
            "unix-ms:2000",
            "unix-ms:3000",
            Some("source-one"),
            "config-one",
        )
        .expect("claim verifier work");
        store
            .execute_batch(
                "UPDATE attempt SET state = 'running', accepted_at = 'unix-ms:1001'
                 WHERE attempt_id = 'verifier-attempt'",
            )
            .expect("put fixture attempt in running phase");
        (store, project)
    }

    fn production_verifier_setup() -> (SqliteStore, ProjectId) {
        let store =
            SqliteStore::open_in_memory(PRODUCTION_SCHEMA).expect("open production verifier store");
        let project = ProjectId::new("verifier-production-project");
        store
            .create_project(project.as_str(), "unix-ms:0")
            .expect("create production project");
        store
            .ensure_actor(
                "agent-one",
                "agent",
                "credential",
                "Verifier agent",
                "unix-ms:0",
            )
            .expect("create verifier actor");
        IdentityStore::new(&store)
            .install(
                &DatabaseIdentity::new("verifier-database", 1).expect("database identity"),
                "unix-ms:1",
            )
            .expect("install database identity");
        IdentityStore::new(&store)
            .bind_project(
                project.as_str(),
                &WorkspaceBinding::new(
                    "/tmp/verifier-production",
                    "/tmp/verifier-production",
                    "sha256:verifier-workspace",
                )
                .expect("workspace binding"),
                "unix-ms:1",
            )
            .expect("bind production project");
        let app = WorkApplication::new(&store);
        app.create_work_as(
            &verifier_work(&project),
            "agent-one",
            "unix-ms:2",
            "op-verifier-production-work",
        )
        .expect("create production verifier work");
        store
            .execute_batch(&format!(
                "INSERT INTO source_version
                 (source_version_id, project_id, origin, access_scope, content_digest,
                  media_type, byte_count, captured_at, parser_identity, availability, citation_json)
                 VALUES ('source-one', '{}', 'fixture', 'project',
                         'sha256:source-one', 'text/plain', 0, 'unix-ms:2',
                         'verifier-test/1', 'available', '[]');",
                project.as_str()
            ))
            .expect("insert production verifier source");
        app.claim_with_context(
            &project,
            "verifier-work",
            "agent-one",
            "verifier-harness",
            None,
            "verifier-attempt",
            "op-verifier-production-claim",
            "sha256:verifier-production-claim",
            None,
            "unix-ms:1000",
            "unix-ms:2000",
            "unix-ms:3000",
            Some("source-one"),
            "config-one",
        )
        .expect("claim production verifier work");
        store
            .execute_batch(
                "UPDATE attempt SET state = 'running', accepted_at = 'unix-ms:1001'
                 WHERE attempt_id = 'verifier-attempt'",
            )
            .expect("put production attempt in running phase");
        (store, project)
    }

    fn finished_production_execution<'a>(
        store: &'a SqliteStore,
        project: &ProjectId,
        operation_id: &str,
    ) -> (WorkApplication<'a>, EvidenceRunRequest, EvidenceRunResult) {
        finished_production_execution_with_artifact(
            store,
            project,
            operation_id,
            "artifact://verifier-output",
        )
    }

    fn finished_production_execution_with_artifact<'a>(
        store: &'a SqliteStore,
        project: &ProjectId,
        operation_id: &str,
        artifact_ref: &str,
    ) -> (WorkApplication<'a>, EvidenceRunRequest, EvidenceRunResult) {
        let app = WorkApplication::new(store);
        let mut request = verifier_request(operation_id);
        request.expectation.gate.command = Some(CommandSpec::new("true", vec!["true".to_owned()]));
        let admission = app
            .admit_witnessed_execution(
                "agent-one",
                None,
                &request,
                artifact_ref,
                TimestampMs::from_millis(1100),
            )
            .expect("admit witnessed execution");
        assert!(!admission.replayed);
        app.start_witnessed_execution(operation_id, TimestampMs::from_millis(1200))
            .expect("start witnessed execution");
        app.finish_witnessed_execution(operation_id, Some(0), TimestampMs::from_millis(1300))
            .expect("finish witnessed execution");
        let result = app
            .build_bounded_evidence_receipt(
                &request,
                &crate::BoundedExecutionResult {
                    outcome: crate::EvidenceExecutionOutcome::Passed,
                    exit_code: Some(0),
                    started_at: TimestampMs::from_millis(1200),
                    ended_at: TimestampMs::from_millis(1300),
                    output_size_bytes: 1,
                    output_digest: Some("sha256:verifier-output".to_owned()),
                    output_ref: Some(artifact_ref.to_owned()),
                    observables: Vec::new(),
                },
            )
            .expect("build witnessed receipt");
        assert_eq!(project.as_str(), "verifier-production-project");
        (app, request, result)
    }

    #[test]
    fn canonical_missing_database_identity_fails_closed() {
        let store = SqliteStore::open_in_memory(PRODUCTION_SCHEMA).expect("open production store");
        let application = WorkApplication::new(&store);

        assert!(store.is_canonical_production());
        assert!(matches!(
            application.identity_context("project-without-database-identity"),
            Err(ApplicationError::Store(StoreError::Conflict(message)))
                if message.contains("canonical production verifier requires database identity")
        ));
    }

    #[test]
    fn noncanonical_fixture_missing_database_identity_keeps_legacy_fallback() {
        let store = SqliteStore::open_in_memory(FIXTURE_SCHEMA).expect("open fixture store");
        let application = WorkApplication::new(&store);

        assert!(!store.is_canonical_production());
        assert!(application
            .identity_context("fixture-project")
            .expect("fixture identity lookup")
            .is_none());
    }

    #[test]
    fn artifact_reference_is_explicitly_not_claimed_as_content_digest() {
        let binding = artifact_binding("artifact://verifier-output", "source-one");
        assert_eq!(binding["mode"], "reference_only");
        assert_eq!(binding["content_bound"], false);
        assert_eq!(binding["reference"], "artifact://verifier-output");
        assert!(binding["diagnostic"]
            .as_str()
            .expect("reference diagnostic")
            .contains("not a content digest"));
        assert!(binding.get("artifact_digest").is_none());
    }

    #[test]
    fn verifier_admission_rejection_leaves_no_execution_or_external_job() {
        let (store, project) = legacy_verifier_setup();
        let app = WorkApplication::new(&store);
        let request = verifier_request("op-verifier-admission-order");

        let error = app.admit_witnessed_execution(
            "agent-one",
            None,
            &request,
            "artifact://verifier-output",
            TimestampMs::from_millis(4_000),
        );
        assert!(matches!(
            error,
            Err(ApplicationError::Store(StoreError::HardDeadlineElapsed))
        ));
        assert!(store
            .evidence_execution(request.operation_id.as_str())
            .expect("read execution")
            .is_none());
        assert!(store
            .operation("verifier:op-verifier-admission-order")
            .expect("read verifier operation")
            .is_some());
        assert!(store
            .audit_event("verifier:op-verifier-admission-order")
            .expect("read verifier audit")
            .is_some());
        assert!(store
            .external_job(project.as_str(), "verifier:op-verifier-admission-order")
            .expect("read verifier job")
            .is_none());
    }

    #[test]
    fn verifier_admission_replay_repairs_either_durable_half_without_second_job() {
        let (store, project) = production_verifier_setup();
        let app = WorkApplication::new(&store);
        let request = verifier_request("op-verifier-admission-repair");

        let first = app
            .admit_witnessed_execution(
                "agent-one",
                None,
                &request,
                "artifact://verifier-output",
                TimestampMs::from_millis(1_100),
            )
            .expect("admit witnessed execution");
        assert!(!first.replayed);
        let job_id = "verifier:op-verifier-admission-repair";
        let context = IdentityStore::new(&store)
            .context(project.as_str())
            .expect("read verifier identity context");
        assert_eq!(
            store
                .external_job_with_identity(&context, job_id)
                .expect("read initial verifier job")
                .expect("initial verifier job")
                .stage,
            "admitted"
        );

        // Model a crash after the execution identity committed but before a
        // legacy adapter committed its sidecar. The same operation replay
        // must recreate the job without creating a second execution identity.
        store
            .execute_batch("DELETE FROM boreal_external_job WHERE job_id = 'verifier:op-verifier-admission-repair'")
            .expect("remove sidecar for recovery fixture");
        let repaired_job = app
            .admit_witnessed_execution(
                "agent-one",
                None,
                &request,
                "artifact://verifier-output",
                TimestampMs::from_millis(1_100),
            )
            .expect("repair missing verifier job");
        assert!(repaired_job.replayed);
        assert_eq!(
            store
                .external_job_with_identity(&context, job_id)
                .expect("read repaired verifier job")
                .expect("repaired verifier job")
                .stage,
            "admitted"
        );

        // Model the inverse legacy half-write. Replaying the same immutable
        // request restores the execution row while reusing the existing job.
        store
            .execute_batch(
                "DELETE FROM evidence_execution
                 WHERE operation_id = 'op-verifier-admission-repair'",
            )
            .expect("remove execution for recovery fixture");
        let repaired_execution = app
            .admit_witnessed_execution(
                "agent-one",
                None,
                &request,
                "artifact://verifier-output",
                TimestampMs::from_millis(1_100),
            )
            .expect("repair missing evidence execution");
        assert!(!repaired_execution.replayed);
        assert!(store
            .evidence_execution(request.operation_id.as_str())
            .expect("read repaired evidence execution")
            .is_some());
        assert_eq!(
            store
                .external_job_with_identity(&context, job_id)
                .expect("read reused verifier job")
                .expect("reused verifier job")
                .stage,
            "admitted"
        );
    }

    #[test]
    fn verifier_unknown_outcome_remains_readback_required_after_atomic_admission() {
        let (store, project) = production_verifier_setup();
        let app = WorkApplication::new(&store);
        let request = verifier_request("op-verifier-unknown-readback");

        app.admit_witnessed_execution(
            "agent-one",
            None,
            &request,
            "artifact://verifier-unknown-readback",
            TimestampMs::from_millis(1_100),
        )
        .expect("admit witnessed execution");
        app.start_witnessed_execution(
            request.operation_id.as_str(),
            TimestampMs::from_millis(1_200),
        )
        .expect("start witnessed execution");

        let unknown = app
            .mark_witnessed_execution_unknown(
                request.operation_id.as_str(),
                "verifier_process_outcome_unknown",
            )
            .expect("mark unknown execution");
        assert_eq!(unknown.state, EvidenceExecutionState::Unknown);

        let readback = app
            .readback_witnessed_execution(request.operation_id.as_str())
            .expect("read back unknown verifier");
        assert!(matches!(
            readback,
            ExternalEffectResolution::ReadbackRequired(job)
                if job.stage == "readback_required"
                    && job.project_id == project.as_str()
        ));
    }

    #[test]
    fn verifier_source_change_stays_readback_pending_without_receipt() {
        let (store, project) = production_verifier_setup();
        let (app, request, result) =
            finished_production_execution(&store, &project, "op-verifier-source-change");
        store
            .execute_batch(
                "INSERT INTO source_version
                 (source_version_id, project_id, origin, access_scope, content_digest,
                  media_type, byte_count, captured_at, parser_identity, availability, citation_json)
                 VALUES ('source-two', 'verifier-production-project', 'fixture', 'project',
                         'sha256:source-two', 'text/plain', 0, 'unix-ms:1300',
                         'verifier-test/1', 'available', '[]');
                 UPDATE attempt SET source_version_id = 'source-two'
                 WHERE attempt_id = 'verifier-attempt'",
            )
            .expect("change source context");

        let error = app.record_witnessed_execution(
            "agent-one",
            None,
            &request,
            &result,
            None,
            TimestampMs::from_millis(1_400),
        );
        assert!(matches!(
            error,
            Err(ApplicationError::Evidence(
                crate::EvidenceValidationError { .. }
            )) | Err(ApplicationError::Store(StoreError::Conflict(_)))
                | Err(ApplicationError::Store(StoreError::Invalid(_)))
        ));
        assert!(store
            .receipt(request.receipt_id.as_str())
            .expect("read receipt")
            .is_none());
        let context = IdentityStore::new(&store)
            .context(project.as_str())
            .expect("read production identity");
        let job = ExternalEffectAdapter::new_with_identity(&store, &context)
            .readback(
                project.as_str(),
                "verifier:op-verifier-source-change",
                &store
                    .evidence_execution(request.operation_id.as_str())
                    .expect("read execution")
                    .expect("execution remains durable")
                    .request_digest,
            )
            .expect("read verifier job");
        assert_eq!(job.record().stage, "readback_required");
    }

    #[test]
    fn verifier_revision_conflict_does_not_reconcile_before_receipt_persistence() {
        let (store, project) = production_verifier_setup();
        let (app, request, result) =
            finished_production_execution(&store, &project, "op-verifier-revision-pending");
        let expected = store
            .project_revision(project.as_str())
            .expect("project revision")
            .0;

        let error = app.record_witnessed_execution(
            "agent-one",
            None,
            &request,
            &result,
            Some(expected + 1),
            TimestampMs::from_millis(1_400),
        );
        assert!(matches!(
            error,
            Err(ApplicationError::Store(StoreError::StaleRevision { .. }))
        ));
        assert!(store
            .receipt(request.receipt_id.as_str())
            .expect("read pending receipt")
            .is_none());
        let context = IdentityStore::new(&store)
            .context(project.as_str())
            .expect("read production identity");
        let pending = ExternalEffectAdapter::new_with_identity(&store, &context)
            .readback(
                project.as_str(),
                "verifier:op-verifier-revision-pending",
                &store
                    .evidence_execution(request.operation_id.as_str())
                    .expect("read execution")
                    .expect("execution remains durable")
                    .request_digest,
            )
            .expect("read pending verifier job");
        assert_eq!(pending.record().stage, "readback_required");

        let recorded = app
            .record_witnessed_execution(
                "agent-one",
                None,
                &request,
                &result,
                None,
                TimestampMs::from_millis(1_500),
            )
            .expect("retry persists receipt after readback");
        assert!(!recorded.replayed);
        assert!(store
            .receipt(request.receipt_id.as_str())
            .expect("read recorded receipt")
            .is_some());
        let reconciled = ExternalEffectAdapter::new_with_identity(&store, &context)
            .readback(
                project.as_str(),
                "verifier:op-verifier-revision-pending",
                &store
                    .evidence_execution(request.operation_id.as_str())
                    .expect("read execution after retry")
                    .expect("execution after retry")
                    .request_digest,
            )
            .expect("read reconciled verifier job");
        assert_eq!(reconciled.record().stage, "reconciled");
    }

    #[test]
    fn verifier_receipt_failure_does_not_commit_execution_without_receipt() {
        let (store, project) = production_verifier_setup();
        let (first_app, first_request, first_result) = finished_production_execution_with_artifact(
            &store,
            &project,
            "op-verifier-first-receipt",
            "artifact://verifier-first",
        );
        first_app
            .record_witnessed_execution(
                "agent-one",
                None,
                &first_request,
                &first_result,
                None,
                TimestampMs::from_millis(1_400),
            )
            .expect("persist first receipt");

        let (second_app, mut second_request, mut second_result) =
            finished_production_execution_with_artifact(
                &store,
                &project,
                "op-verifier-duplicate-receipt",
                "artifact://verifier-second",
            );
        second_request.receipt_id = first_request.receipt_id.clone();
        second_result.receipt.receipt_id = second_request.receipt_id.clone();

        assert!(second_app
            .record_witnessed_execution(
                "agent-one",
                None,
                &second_request,
                &second_result,
                None,
                TimestampMs::from_millis(1_500),
            )
            .is_err());

        let execution = store
            .evidence_execution(second_request.operation_id.as_str())
            .expect("read second execution")
            .expect("second execution remains durable");
        assert_eq!(execution.state, EvidenceExecutionState::Exited);
        assert!(execution.receipt_id.is_none());
        assert!(store
            .operation(second_request.operation_id.as_str())
            .expect("read failed receipt operation")
            .is_none());
    }
}
