//! Durable application façade for receipts, reviews, and proof-gated closeout.

use boreal_domain::{
    ActorId, AttemptId, AttemptPhase, ConfigIdentity, Fence, GateId, GateKind, ProfileId,
    ReceiptId, ReceiptResult, SourceVersionId, TimestampMs, WorkId,
};
use boreal_store::{
    AuditEventRecord, CloseIntentRequest, CloseIntentResult, EvidenceExecutionAdmissionRequest,
    EvidenceExecutionAdmissionResult, EvidenceExecutionRecord, OperationOutcome, OperationRecord,
    ReceiptAcceptanceExpectation, ReceiptAttestation, ReceiptInsertRequest, ReceiptInsertResult,
    ReceiptOutcome, ReceiptRecord, ReceiptSubmissionKind, ReviewDecision as StoreReviewDecision,
    ReviewInsertRequest, StoreError, SummaryInsertRequest, SummaryInsertResult,
    identity::{IdentityContext, IdentityError, IdentityStore},
};
use serde_json::{Value, json};

use crate::{
    AcceptanceDefinition, AcceptanceEvaluation, AcceptanceGateDefinition, ApplicationError,
    CloseIntent, CloseoutInput, EvidenceErrorCode, EvidenceRunRequest, EvidenceRunResult,
    ExternalEffectAcquisition, ExternalEffectAdapter, ExternalEffectReadback,
    ExternalEffectRequest, ExternalEffectResolution, ExternalJobKind, ReceiptExpectation,
    ReceiptExpectationBase, ReceiptPayload, ReviewDecision, ReviewDecisionRequest, SqliteStore,
    SummaryPayload, WorkApplication, canonical_request_digest, validate_review_decision,
};
use boreal_source::{
    ArtifactProducer, ArtifactRelationshipInput, ArtifactRightsProvenance, ArtifactRole,
    ArtifactScope, DEFAULT_MAX_ARTIFACT_BYTES, SourceCatalog, SourceIdentity,
};
use boreal_store::jobs::ExternalJobInput;

const VERIFIER_JOB_PREFIX: &str = "verifier:";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CloseReadinessReadback {
    pub project_revision: u64,
    pub work_id: WorkId,
    pub attempt_id: Option<String>,
    pub fence: Option<u64>,
    pub readiness: crate::CloseReadiness,
}

impl WorkApplication<'_> {
    /// Project-scoped durable receipt readback. A receipt remains available
    /// after its attempt is stale so failed and superseded evidence stays
    /// inspectable, but callers cannot use this helper to cross project scope.
    pub fn read_receipt(
        &self,
        project_id: &str,
        receipt_id: &str,
    ) -> Result<Option<ReceiptRecord>, ApplicationError> {
        if project_id.trim().is_empty() || receipt_id.trim().is_empty() {
            return Err(ApplicationError::Invalid(
                "project and receipt ids are required".into(),
            ));
        }
        let Some(receipt) = self.store().receipt(receipt_id)? else {
            return Ok(None);
        };
        if receipt.project_id != project_id {
            return Err(ApplicationError::Store(StoreError::WrongSubject {
                expected: project_id.to_owned(),
                actual: receipt.project_id,
            }));
        }
        Ok(Some(receipt))
    }

    /// Exact sealed proof readback used when a client reconnects. The store
    /// only returns the submission for the requested proof generation.
    pub fn read_current_submission(
        &self,
        project_id: &str,
        work_id: &str,
        proof_revision: u64,
    ) -> Result<Option<boreal_store::acceptance::SubmissionRecord>, ApplicationError> {
        if project_id.trim().is_empty() || work_id.trim().is_empty() || proof_revision == 0 {
            return Err(ApplicationError::Invalid(
                "project, work, and positive proof revision are required".into(),
            ));
        }
        let acceptance = boreal_store::acceptance::AcceptanceStore::new(self.store_ref());
        let binding = acceptance.current_final_result(project_id, work_id, proof_revision)?;
        let submission =
            self.store_ref()
                .current_submission(project_id, work_id, proof_revision)?;
        let requirements = boreal_store::profiles::ProfileStore::new(self.store_ref())
            .current_pinned_requirements(project_id, work_id)?;
        if requires_bound_final_result(&requirements) && binding.is_none() && submission.is_some() {
            return Err(ApplicationError::Store(StoreError::Conflict(
                "current software submission has no final-result binding".into(),
            )));
        }
        if let (Some(binding), Some(submission)) = (&binding, &submission) {
            if submission.attempt_id != binding.attempt_id
                || submission.fence != binding.fence
                || submission.entity_revision != binding.entity_revision
                || submission.source_version_id != binding.source_version_id
                || submission.config_identity != binding.config_identity
                || submission.profile_id != binding.profile_id
                || submission.profile_version != binding.profile_version
                || submission.profile_digest != binding.profile_digest
            {
                return Err(ApplicationError::Store(StoreError::Corrupt(
                    "submission does not match the current final-result binding".into(),
                )));
            }
        }
        Ok(submission)
    }

    /// Verify captured result bytes through the canonical source catalog,
    /// then bind that exact source to the next proof generation. The immutable
    /// SQLite binding is authoritative; the source relationship is a
    /// rebuildable lineage projection and can be repaired from its receipt.
    pub fn bind_final_result(
        &self,
        catalog: &SourceCatalog,
        request: &crate::FinalResultCaptureRequest,
    ) -> Result<crate::OperationResult<crate::FinalResultCaptureResult>, ApplicationError> {
        validate_final_result_capture_request(request)?;
        let source = SourceIdentity {
            project_id: request.project_id.clone(),
            source_version_id: request.source_version_id.clone(),
            content_digest: request.content_digest.clone(),
        };
        let acceptance = boreal_store::acceptance::AcceptanceStore::new(self.store_ref());
        let replay = acceptance
            .final_result_for_operation(&request.project_id, &request.operation_id)?
            .is_some();
        if !replay {
            catalog
                .read_identity_bounded(&source, DEFAULT_MAX_ARTIFACT_BYTES)
                .map_err(|error| {
                    ApplicationError::Invalid(format!(
                        "final result source bytes failed catalog verification: {error}"
                    ))
                })?;
        }
        let binding =
            acceptance.bind_final_result(&boreal_store::acceptance::FinalResultBindingRequest {
                project_id: request.project_id.clone(),
                work_id: request.work_id.clone(),
                actor_id: request.actor_id.clone(),
                session_id: request.session_id.clone(),
                attempt_id: request.attempt_id.clone(),
                fence: request.fence,
                expected_project_revision: request.expected_project_revision,
                expected_entity_revision: request.expected_entity_revision,
                expected_proof_revision: request.expected_proof_revision,
                source_version_id: request.source_version_id.clone(),
                content_digest: request.content_digest.clone(),
                operation_id: request.operation_id.clone(),
                at: request.at.clone(),
            })?;
        let lineage_pending = record_final_result_lineage(catalog, &binding).err();
        Ok(crate::OperationResult {
            operation_id: binding.operation_id.clone(),
            snapshot_revision: binding.project_revision,
            changed: !binding.replayed,
            value: crate::FinalResultCaptureResult {
                binding,
                lineage_pending,
            },
        })
    }

    pub fn read_current_final_result(
        &self,
        project_id: &str,
        work_id: &str,
        proof_revision: u64,
    ) -> Result<Option<boreal_store::acceptance::FinalResultBindingRecord>, ApplicationError> {
        Ok(
            boreal_store::acceptance::AcceptanceStore::new(self.store_ref()).current_final_result(
                project_id,
                work_id,
                proof_revision,
            )?,
        )
    }

    /// Evaluates close readiness from one revision-consistent projection of
    /// persisted proof, review, summary, profile, and close-intent facts.
    /// Callers provide only the subject identity; no proof facts are accepted
    /// here, and this read never changes lifecycle state.
    pub fn read_close_readiness(
        &self,
        project_id: &str,
        work_id: &str,
    ) -> Result<crate::CloseReadiness, ApplicationError> {
        self.read_close_readiness_readback(project_id, work_id)
            .map(|readback| readback.readiness)
    }

    /// Returns the evaluated readiness with its project revision, requested
    /// work identity, and current attempt identity from the same store snapshot.
    pub fn read_close_readiness_readback(
        &self,
        project_id: &str,
        work_id: &str,
    ) -> Result<CloseReadinessReadback, ApplicationError> {
        let snapshot = boreal_store::acceptance::AcceptanceStore::new(self.store_ref())
            .close_readiness_snapshot(project_id, work_id)?;
        let project_revision = snapshot.project_revision;
        let requested_work_id = WorkId::new(snapshot.work_id.clone());
        let current_attempt_id = snapshot
            .current_attempt
            .as_ref()
            .map(|attempt| attempt.attempt_id.clone());
        let current_fence = snapshot
            .current_attempt
            .as_ref()
            .map(|attempt| attempt.fence);
        let definition = close_readiness_definition(&snapshot.pinned_requirements)?;
        let attempt = close_readiness_attempt_snapshot(&snapshot)?;
        let source_snapshot_hash = close_readiness_source(&snapshot, &attempt);
        let config_identity = ConfigIdentity::new(
            snapshot
                .proof_attempt
                .as_ref()
                .map(|attempt| attempt.config_identity.as_str())
                .unwrap_or_default(),
        );
        let expected_fence = attempt.fence;

        let receipts = snapshot
            .ordered_receipts
            .iter()
            .filter(|record| {
                snapshot.submission.as_ref().is_none_or(|submission| {
                    submission
                        .receipt_ids
                        .iter()
                        .any(|id| id == &record.receipt_id)
                })
            })
            .map(|record| {
                let mut receipt = receipt_payload_from_record(record)?;
                if let Some(local_gate_id) = definition.gates.iter().find_map(|gate| {
                    let local = gate.id.as_str();
                    let scoped = format!("{}:{local}", snapshot.work_id);
                    (receipt.gate_id.as_str() == scoped.as_str()
                        || receipt.gate_id.as_str() == local)
                        .then_some(gate.id.clone())
                }) {
                    receipt.gate_id = local_gate_id;
                }
                Ok(receipt)
            })
            .collect::<Result<Vec<_>, ApplicationError>>()?;
        let review = snapshot
            .required_review
            .as_ref()
            .map(|record| ReviewDecisionRequest {
                review_id: record.review_id.clone(),
                work_id: WorkId::new(record.work_id.clone()),
                attempt_id: AttemptId::new(record.attempt_id.clone()),
                fence: Fence::new(record.fence),
                reviewer_actor_id: ActorId::new(record.reviewer_actor_id.clone()),
                attempt_actor_id: attempt.actor_id.clone(),
                reviewer_role: record
                    .reviewer_role
                    .unwrap_or(boreal_domain::ActorRole::Agent),
                decision: match record.outcome.as_str() {
                    "approved" | "accepted" => ReviewDecision::Accepted,
                    _ => ReviewDecision::Rejected,
                },
                reason: record.reason.clone(),
                source_snapshot_hash: source_snapshot_hash.clone(),
                config_identity: config_identity.clone(),
                policy_version: definition.version.clone(),
            });
        let summary = snapshot
            .current_summary
            .as_ref()
            .map(|record| SummaryPayload {
                summary_id: record.summary.summary_id.clone(),
                work_id: WorkId::new(record.summary.work_id.clone()),
                attempt_id: AttemptId::new(record.summary.attempt_id.clone()),
                fence: Fence::new(record.summary.fence),
                source_snapshot_hash: SourceVersionId::new(
                    record.summary.source_version_id.clone(),
                ),
                config_identity: ConfigIdentity::new(record.summary.config_identity.clone()),
                profile_id: ProfileId::new(record.summary.profile_id.clone()),
                profile_version: record.summary.profile_version.to_string(),
                body_digest: record.summary.body_digest.clone(),
                body_size: record.summary.body_size,
            });
        let close_intent = snapshot.close_intent.as_ref().map(|record| CloseIntent {
            work_id: WorkId::new(record.work_id.clone()),
            attempt_id: AttemptId::new(record.attempt_id.clone()),
            fence: Fence::new(record.fence),
            source_snapshot_hash: SourceVersionId::new(
                record.source_version_id.clone().unwrap_or_default(),
            ),
            config_identity: ConfigIdentity::new(record.config_identity.clone()),
            profile_id: ProfileId::new(record.profile_id.clone()),
            profile_version: record.profile_version.to_string(),
            summary_id: record.summary_id.clone(),
        });

        let input = CloseoutInput {
            definition: definition.clone(),
            work_id: WorkId::new(snapshot.work_id.clone()),
            attempt,
            expected_fence,
            source_snapshot_hash,
            config_identity,
            policy_version: definition.version.clone(),
            receipts,
            gates: Vec::new(),
            review,
            summary,
            close_intent,
        };
        let mut readiness = crate::evaluate_close_readiness(&input)?;
        if snapshot.final_result.is_none() {
            if let Some(requirement) = snapshot
                .pinned_requirements
                .required_declarations()
                .find(|declaration| declaration.kind == "verification")
            {
                readiness
                    .gaps
                    .push(crate::CloseoutGap::GateUnsatisfied(GateId::new(
                        requirement.gate_id.clone(),
                    )));
            }
        }
        match snapshot.typed_acceptance {
            boreal_store::acceptance::CloseReadinessTypedAcceptance::NotRequired
            | boreal_store::acceptance::CloseReadinessTypedAcceptance::Ready => {}
            boreal_store::acceptance::CloseReadinessTypedAcceptance::ResultMissing => {
                readiness
                    .gaps
                    .push(crate::CloseoutGap::AcceptanceResultMissing);
            }
            boreal_store::acceptance::CloseReadinessTypedAcceptance::ResultMismatch => {
                readiness
                    .gaps
                    .push(crate::CloseoutGap::AcceptanceResultMismatch);
            }
            boreal_store::acceptance::CloseReadinessTypedAcceptance::ArtifactDecisionMissing => {
                let gate_id = snapshot
                    .pinned_requirements
                    .declarations
                    .iter()
                    .find(|declaration| declaration.required && declaration.kind == "review")
                    .map(|declaration| declaration.gate_id.as_str())
                    .unwrap_or("artifact_review");
                readiness
                    .gaps
                    .push(crate::CloseoutGap::ReviewRequired(GateId::new(gate_id)));
            }
            boreal_store::acceptance::CloseReadinessTypedAcceptance::ArtifactDecisionMismatch => {
                let gate_id = snapshot
                    .pinned_requirements
                    .declarations
                    .iter()
                    .find(|declaration| declaration.required && declaration.kind == "review")
                    .map(|declaration| declaration.gate_id.as_str())
                    .unwrap_or("artifact_review");
                readiness
                    .gaps
                    .push(crate::CloseoutGap::ReviewRejected(GateId::new(gate_id)));
            }
        }
        let attempt_context = snapshot.proof_attempt.as_ref();
        let binding_mismatch = snapshot.final_result.as_ref().is_some_and(|binding| {
            let Some(attempt) = attempt_context else {
                return true;
            };
            binding.project_id.as_str() != snapshot.project_id.as_str()
                || binding.work_id.as_str() != snapshot.work_id.as_str()
                || binding.attempt_id.as_str() != attempt.attempt_id.as_str()
                || binding.fence != attempt.fence
                || binding.entity_revision != snapshot.entity_revision
                || binding.proof_revision != snapshot.proof_revision
                || binding.config_identity.as_str() != attempt.config_identity.as_str()
                || binding.profile_id.as_str()
                    != snapshot.pinned_requirements.profile.profile_id.as_str()
                || binding.profile_version != snapshot.pinned_requirements.profile.version
                || binding.profile_digest.as_str()
                    != snapshot.pinned_requirements.profile.policy_digest.as_str()
        });
        let submission_mismatch = snapshot.submission.as_ref().is_some_and(|submission| {
            let Some(attempt) = attempt_context else {
                return true;
            };
            submission.project_id.as_str() != snapshot.project_id.as_str()
                || submission.work_id.as_str() != snapshot.work_id.as_str()
                || submission.attempt_id.as_str() != attempt.attempt_id.as_str()
                || submission.fence != attempt.fence
                || submission.entity_revision != snapshot.entity_revision
                || submission.proof_revision != snapshot.proof_revision
                || submission.config_identity.as_str() != attempt.config_identity.as_str()
                || submission.profile_id.as_str()
                    != snapshot.pinned_requirements.profile.profile_id.as_str()
                || submission.profile_version != snapshot.pinned_requirements.profile.version
                || submission.profile_digest.as_str()
                    != snapshot.pinned_requirements.profile.policy_digest.as_str()
                || snapshot.final_result.as_ref().is_some_and(|binding| {
                    submission.attempt_id != binding.attempt_id
                        || submission.fence != binding.fence
                        || submission.entity_revision != binding.entity_revision
                        || submission.source_version_id != binding.source_version_id
                        || submission.config_identity != binding.config_identity
                        || submission.profile_id != binding.profile_id
                        || submission.profile_version != binding.profile_version
                        || submission.profile_digest != binding.profile_digest
                })
        });
        if binding_mismatch || submission_mismatch {
            readiness.gaps.push(crate::CloseoutGap::StaleFence);
        }
        if snapshot.submission.as_ref().is_some_and(|submission| {
            !submission.receipt_ids.iter().all(|id| {
                snapshot
                    .ordered_receipts
                    .iter()
                    .any(|receipt| receipt.receipt_id == *id)
            })
        }) {
            readiness.gaps.push(crate::CloseoutGap::StaleFence);
        }
        if snapshot.current_summary.as_ref().is_some_and(|record| {
            record.body_integrity != boreal_store::acceptance::CloseReadinessSummaryIntegrity::Valid
                || snapshot.submission.as_ref().is_some_and(|submission| {
                    record.summary.summary_id != submission.summary_id
                        || record.summary.body_digest != submission.summary_digest
                })
        }) {
            readiness.gaps.push(crate::CloseoutGap::SummaryMismatch);
        }
        if snapshot
            .close_intent
            .as_ref()
            .is_some_and(|record| record.state != boreal_store::CloseIntentState::Open)
        {
            readiness.gaps.push(crate::CloseoutGap::CloseIntentMismatch);
        }
        readiness.gaps.sort_by(|left, right| {
            left.code()
                .cmp(right.code())
                .then_with(|| close_readiness_gap_id(left).cmp(close_readiness_gap_id(right)))
        });
        readiness.gaps.dedup();
        readiness.ready = readiness.gaps.is_empty();
        Ok(CloseReadinessReadback {
            project_revision,
            work_id: requested_work_id,
            attempt_id: current_attempt_id,
            fence: current_fence,
            readiness,
        })
    }

    pub fn read_final_result_for_operation(
        &self,
        project_id: &str,
        operation_id: &str,
    ) -> Result<Option<boreal_store::acceptance::FinalResultBindingRecord>, ApplicationError> {
        Ok(
            boreal_store::acceptance::AcceptanceStore::new(self.store_ref())
                .final_result_for_operation(project_id, operation_id)?,
        )
    }

    /// Rebuild the non-authoritative ProducedDeliverable relationship from
    /// the durable result binding after a restart or partial catalog write.
    pub fn reconcile_final_result_lineage(
        &self,
        catalog: &SourceCatalog,
        project_id: &str,
        operation_id: &str,
    ) -> Result<boreal_store::acceptance::FinalResultBindingRecord, ApplicationError> {
        let binding = self
            .read_final_result_for_operation(project_id, operation_id)?
            .ok_or_else(|| {
                ApplicationError::Invalid(format!(
                    "final result operation {operation_id} has no durable binding"
                ))
            })?;
        record_final_result_lineage(catalog, &binding).map_err(ApplicationError::Invalid)?;
        Ok(binding)
    }

    /// Canonical event and legacy decision history for public list/show paths.
    /// Canonical rows preserve their submission ID and supersession chain;
    /// legacy decisions are explicitly marked as legacy and keep their own
    /// original identity.
    pub fn review_history_list(
        &self,
        project_id: &str,
        work_id: Option<&str>,
        limit: u64,
        offset: u64,
    ) -> Result<boreal_store::completion::ReviewHistoryPage, ApplicationError> {
        Ok(self
            .store_ref()
            .review_history_list(project_id, work_id, limit, offset)?)
    }

    pub fn review_history_show(
        &self,
        project_id: &str,
        event_id: &str,
    ) -> Result<Option<boreal_store::completion::ReviewHistoryRecord>, ApplicationError> {
        Ok(self.store_ref().review_history_show(project_id, event_id)?)
    }

    /// Bounded exact attempt/fence receipt hydration. Absence is an empty page;
    /// multiple receipts are preserved in insertion order, including failed
    /// and rejected facts.
    pub fn read_receipts_for_attempt(
        &self,
        project_id: &str,
        work_id: &str,
        attempt_id: &str,
        fence: u64,
        limit: u64,
        offset: u64,
    ) -> Result<boreal_store::acceptance::ReceiptAttemptPage, ApplicationError> {
        Ok(
            boreal_store::acceptance::AcceptanceStore::new(self.store_ref())
                .receipts_for_attempt(project_id, work_id, attempt_id, fence, limit, offset)?,
        )
    }

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
        let missing_final_result = expected.gate.kind == GateKind::Verification
            && self.verification_result_is_unbound(
                expected.work_id.as_str(),
                expected.attempt_id.as_str(),
            )?;

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
            } else if receipt.result == ReceiptResult::Passed && missing_final_result {
                (
                    ReceiptOutcome::Rejected,
                    Some(EvidenceErrorCode::ReceiptSourceMismatch.as_str()),
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
        let valid_policy_identity = request
            .gate_policy_identity
            .strip_prefix("sha256:")
            .is_some_and(|digest| {
                digest.len() == 64
                    && digest
                        .bytes()
                        .all(|value| value.is_ascii_hexdigit() && !value.is_ascii_uppercase())
            });
        if !valid_policy_identity {
            return Err(ApplicationError::Evidence(
                crate::EvidenceValidationError::new(EvidenceErrorCode::ReceiptPolicyMismatch),
            ));
        }
        let project_id = self.project_for_work(request.expectation.work_id.as_str())?;
        let identity = self.identity_context(&project_id)?;
        let gate_id = self.store().gate_id_for_work(
            &project_id,
            request.expectation.work_id.as_str(),
            request.expectation.gate.id.as_str(),
        )?;
        let gate = self
            .store()
            .gate(&project_id, request.expectation.work_id.as_str(), &gate_id)?
            .ok_or_else(|| StoreError::NotFound {
                entity: "gate",
                id: gate_id.as_str().to_owned(),
            })?;
        if gate.kind == GateKind::Verification {
            let attempt = self
                .store()
                .proof_attempt(&project_id, request.expectation.attempt_id.as_str())?;
            if attempt.work_id != request.expectation.work_id.as_str()
                || attempt.fence != request.expectation.fence.get()
            {
                return Err(ApplicationError::Evidence(
                    crate::EvidenceValidationError::new(EvidenceErrorCode::StaleFence),
                ));
            }
            if attempt.actor_id != actor_id || attempt.session_id.as_deref() != session_id {
                return Err(ApplicationError::Store(StoreError::WrongOwner {
                    expected: actor_id.to_owned(),
                    actual: attempt.actor_id,
                }));
            }
            if now.as_millis() >= parse_stamp(&attempt.hard_deadline)?.as_millis() {
                return Err(ApplicationError::Store(StoreError::HardDeadlineElapsed));
            }
            if now.as_millis() >= parse_stamp(&attempt.lease_deadline)?.as_millis() {
                return Err(ApplicationError::Store(StoreError::LeaseExpired));
            }
            let requirements = boreal_store::profiles::ProfileStore::new(self.store_ref())
                .current_pinned_requirements(&project_id, request.expectation.work_id.as_str())?;
            let binding = boreal_store::acceptance::AcceptanceStore::new(self.store_ref())
                .current_final_result_for_attempt(&attempt)?
                .ok_or_else(|| {
                    ApplicationError::Evidence(crate::EvidenceValidationError::new(
                        EvidenceErrorCode::ReceiptSourceMismatch,
                    ))
                })?;
            if attempt.config_identity != request.expectation.config_identity.as_str()
                || binding.source_version_id != request.expectation.source_snapshot_hash.as_str()
                || binding.config_identity != request.expectation.config_identity.as_str()
                || binding.profile_id != gate.profile_id
                || binding.profile_version != gate.profile_version
                || binding.profile_digest != requirements.profile.policy_digest
            {
                return Err(ApplicationError::Evidence(
                    crate::EvidenceValidationError::new(EvidenceErrorCode::ReceiptPolicyMismatch),
                ));
            }
            let claim_source_id = attempt.source_version_id.as_deref().ok_or_else(|| {
                ApplicationError::Evidence(crate::EvidenceValidationError::new(
                    EvidenceErrorCode::ReceiptSourceMismatch,
                ))
            })?;
            let claim_source = self
                .store()
                .source_version(&project_id, claim_source_id)?
                .ok_or_else(|| {
                    ApplicationError::Evidence(crate::EvidenceValidationError::new(
                        EvidenceErrorCode::ReceiptSourceMismatch,
                    ))
                })?;
            let result_source = self
                .store()
                .source_version(&project_id, &binding.source_version_id)?
                .ok_or_else(|| {
                    ApplicationError::Evidence(crate::EvidenceValidationError::new(
                        EvidenceErrorCode::ReceiptSourceMismatch,
                    ))
                })?;
            if claim_source.source_version_id == result_source.source_version_id
                || claim_source.content_digest == binding.content_digest
                || result_source.content_digest != binding.content_digest
                || result_source.availability != "available"
            {
                return Err(ApplicationError::Evidence(
                    crate::EvidenceValidationError::new(EvidenceErrorCode::ReceiptSourceMismatch),
                ));
            }
        }
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
                "gate_policy_identity": request.gate_policy_identity,
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
        let outcome_matches_receipt = match result.outcome {
            crate::EvidenceExecutionOutcome::Passed => {
                result.receipt.result == ReceiptResult::Passed
            }
            crate::EvidenceExecutionOutcome::Failed
            | crate::EvidenceExecutionOutcome::TimedOut
            | crate::EvidenceExecutionOutcome::Uncertain => {
                result.receipt.result == ReceiptResult::Failed
            }
        };
        if !outcome_matches_receipt {
            return Err(ApplicationError::Evidence(
                crate::EvidenceValidationError::new(EvidenceErrorCode::ExecutionResultInvalid),
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
        let missing_final_result = expected.gate.kind == GateKind::Verification
            && self.verification_result_is_unbound(
                expected.work_id.as_str(),
                expected.attempt_id.as_str(),
            )?;
        let (result, rejection_code) =
            if receipt.result == ReceiptResult::Passed && !receipt.attestation.is_gate_trusted() {
                (
                    ReceiptOutcome::Rejected,
                    Some(EvidenceErrorCode::ReceiptAttestationMissing.as_str()),
                )
            } else if receipt.result == ReceiptResult::Passed && missing_final_result {
                (
                    ReceiptOutcome::Rejected,
                    Some(EvidenceErrorCode::ReceiptSourceMismatch.as_str()),
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
            .proof_attempt(project_id, attempt_id.as_str())?;
        if attempt.work_id != work_id.as_str() || attempt.fence != fence.get() {
            return Err(ApplicationError::Evidence(
                crate::EvidenceValidationError::new(EvidenceErrorCode::StaleFence),
            ));
        }
        let current_final = boreal_store::acceptance::AcceptanceStore::new(self.store_ref())
            .current_final_result_for_attempt(&attempt)?;
        let requirements = boreal_store::profiles::ProfileStore::new(self.store_ref())
            .current_pinned_requirements(project_id, work_id.as_str())?;
        if let Some(binding) = &current_final {
            if binding.config_identity != attempt.config_identity
                || binding.profile_id != definition.id.as_str()
                || binding.profile_version.to_string() != definition.version
                || binding.profile_digest != requirements.profile.policy_digest
            {
                return Err(ApplicationError::Evidence(
                    crate::EvidenceValidationError::new(EvidenceErrorCode::ReceiptPolicyMismatch),
                ));
            }
        }
        let source_snapshot_hash = current_final
            .as_ref()
            .map(|binding| binding.source_version_id.clone())
            .or_else(|| attempt.source_version_id.clone())
            .ok_or_else(|| {
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
        let mut evaluation = crate::evaluate_acceptance(definition, &receipts, &base)?;
        if requires_bound_final_result(&requirements) && current_final.is_none() {
            for gate in evaluation
                .gates
                .iter_mut()
                .filter(|gate| gate.kind == GateKind::Verification)
            {
                gate.state = boreal_domain::GateState::Failed;
                gate.reason = Some(EvidenceErrorCode::ReceiptSourceMismatch);
            }
        }
        Ok(evaluation)
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
            .proof_attempt(&project_id, receipt.attempt_id.as_str())?;
        if attempt.work_id != receipt.work_id.as_str()
            || attempt.actor_id != actor_id
            || attempt.session_id.as_deref() != session_id
        {
            return Err(ApplicationError::Store(StoreError::WrongOwner {
                expected: actor_id.to_owned(),
                actual: attempt.actor_id,
            }));
        }
        let current_final = boreal_store::acceptance::AcceptanceStore::new(self.store_ref())
            .current_final_result_for_attempt(&attempt)?;
        let requirements = boreal_store::profiles::ProfileStore::new(self.store_ref())
            .current_pinned_requirements(&project_id, receipt.work_id.as_str())?;
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
        if let Some(binding) = &current_final {
            if binding.config_identity != attempt.config_identity
                || binding.profile_id != gate.profile_id
                || binding.profile_version != gate.profile_version
                || binding.profile_digest != requirements.profile.policy_digest
            {
                return Err(ApplicationError::Evidence(
                    crate::EvidenceValidationError::new(EvidenceErrorCode::ReceiptPolicyMismatch),
                ));
            }
        }
        let source_snapshot_hash = current_final
            .as_ref()
            .map(|binding| binding.source_version_id.clone())
            .or(attempt.source_version_id)
            .ok_or_else(|| {
                ApplicationError::Evidence(crate::EvidenceValidationError::new(
                    EvidenceErrorCode::ReceiptSourceMismatch,
                ))
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

    fn verification_result_is_unbound(
        &self,
        work_id: &str,
        attempt_id: &str,
    ) -> Result<bool, ApplicationError> {
        let project_id = self.project_for_work(work_id)?;
        let attempt = self.store().proof_attempt(&project_id, attempt_id)?;
        Ok(
            boreal_store::acceptance::AcceptanceStore::new(self.store_ref())
                .current_final_result_for_attempt(&attempt)?
                .is_none(),
        )
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
        let policy_digest = if self.store().is_canonical_production() {
            let pin = boreal_store::profiles::ProfileStore::new(self.store())
                .current_pinned_requirements(&project_id, review.work_id.as_str())?;
            if pin.profile.version.to_string() != review.policy_version {
                return Err(ApplicationError::Store(boreal_store::StoreError::Conflict(
                    "review policy version is not the pinned profile version".into(),
                )));
            }
            let attempt = self
                .store()
                .proof_attempt(&project_id, review.attempt_id.as_str())?;
            if attempt.actor_id != review.attempt_actor_id.as_str()
                || attempt.config_identity != review.config_identity.as_str()
            {
                return Err(ApplicationError::Store(boreal_store::StoreError::Conflict(
                    "review owner/configuration is not the submitted context".into(),
                )));
            }
            pin.profile.policy_digest
        } else {
            review.policy_version.clone()
        };
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
            policy_digest,
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
            close_intent_id: close_candidate_id(intent),
            work_id: intent.work_id.as_str().to_owned(),
            attempt_id: intent.attempt_id.as_str().to_owned(),
            fence: intent.fence.get(),
            operation_id: format!("request:{}", close_candidate_id(intent)),
            source_version_id: Some(intent.source_snapshot_hash.as_str().to_owned()),
            config_identity: intent.config_identity.as_str().to_owned(),
            profile_id: intent.profile_id.as_str().to_owned(),
            profile_version: intent
                .profile_version
                .parse()
                .ok()
                .filter(|version| *version > 0)
                .ok_or_else(|| {
                    ApplicationError::Invalid(
                        "close profile version must be a positive integer".into(),
                    )
                })?,
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
            close_intent_id: close_candidate_id(intent),
            work_id: intent.work_id.as_str().to_owned(),
            attempt_id: intent.attempt_id.as_str().to_owned(),
            fence: intent.fence.get(),
            operation_id: evaluation_operation_id.to_owned(),
            source_version_id: Some(intent.source_snapshot_hash.as_str().to_owned()),
            config_identity: intent.config_identity.as_str().to_owned(),
            profile_id: intent.profile_id.as_str().to_owned(),
            profile_version: intent
                .profile_version
                .parse()
                .ok()
                .filter(|version| *version > 0)
                .ok_or_else(|| {
                    ApplicationError::Invalid(
                        "close profile version must be a positive integer".into(),
                    )
                })?,
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

fn validate_final_result_capture_request(
    request: &crate::FinalResultCaptureRequest,
) -> Result<(), ApplicationError> {
    for (name, value) in [
        ("project_id", request.project_id.as_str()),
        ("work_id", request.work_id.as_str()),
        ("actor_id", request.actor_id.as_str()),
        ("session_id", request.session_id.as_str()),
        ("attempt_id", request.attempt_id.as_str()),
        ("source_version_id", request.source_version_id.as_str()),
        ("operation_id", request.operation_id.as_str()),
        ("timestamp", request.at.as_str()),
    ] {
        if value.trim().is_empty() || value.len() > 255 || value.contains('\0') {
            return Err(ApplicationError::Invalid(format!(
                "final result {name} must contain 1..=255 valid bytes"
            )));
        }
    }
    if request.fence == 0
        || request.expected_project_revision == 0
        || request.expected_proof_revision == 0
        || request.content_digest.len() != "sha256:".len() + 64
        || !request.content_digest.starts_with("sha256:")
        || !request.content_digest["sha256:".len()..]
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err(ApplicationError::Invalid(
            "final result fence, revisions, or source digest are invalid".into(),
        ));
    }
    Ok(())
}

fn requires_bound_final_result(requirements: &boreal_store::profiles::PinnedRequirements) -> bool {
    requirements.requires_kind("verification")
}

fn close_readiness_definition(
    requirements: &boreal_store::profiles::PinnedRequirements,
) -> Result<AcceptanceDefinition, ApplicationError> {
    let gates = requirements
        .declarations
        .iter()
        .map(|declaration| {
            let kind = match declaration.kind.as_str() {
                "Checkpoint" | "checkpoint" => GateKind::Checkpoint,
                "Verification" | "verification" => GateKind::Verification,
                "Review" | "review" => GateKind::Review,
                "OperatorApproval" | "operator_approval" => GateKind::OperatorApproval,
                "Summary" | "summary" => GateKind::Summary,
                "Audit" | "audit" => GateKind::Audit,
                other => {
                    return Err(ApplicationError::Store(StoreError::Corrupt(format!(
                        "pinned close-readiness gate has unknown kind {other}"
                    ))));
                }
            };
            Ok(AcceptanceGateDefinition {
                id: GateId::new(declaration.gate_id.clone()),
                kind,
                required: declaration.required,
                command: None,
                requires_attestation: true,
                required_observables: declaration.observable_rules.clone(),
            })
        })
        .collect::<Result<Vec<_>, ApplicationError>>()?;
    Ok(AcceptanceDefinition {
        id: ProfileId::new(requirements.profile.profile_id.clone()),
        version: requirements.profile.version.to_string(),
        gates,
        close_requires_intent: true,
    })
}

fn close_readiness_attempt_snapshot(
    snapshot: &boreal_store::acceptance::CloseReadinessSnapshot,
) -> Result<crate::AttemptSnapshot, ApplicationError> {
    let Some(record) = snapshot.proof_attempt.as_ref() else {
        return Ok(crate::AttemptSnapshot {
            project_id: boreal_domain::ProjectId::new(snapshot.project_id.clone()),
            work_id: WorkId::new(snapshot.work_id.clone()),
            attempt_id: AttemptId::new(""),
            actor_id: ActorId::new(""),
            harness_id: None,
            session_id: None,
            fence: Fence::new(0),
            phase: AttemptPhase::Failed,
            claimed_at: TimestampMs::from_millis(0),
            accepted_at: None,
            lease_deadline: TimestampMs::from_millis(0),
            hard_deadline: TimestampMs::from_millis(0),
            current: false,
        });
    };
    Ok(crate::AttemptSnapshot {
        project_id: boreal_domain::ProjectId::new(record.project_id.clone()),
        work_id: WorkId::new(record.work_id.clone()),
        attempt_id: AttemptId::new(record.attempt_id.clone()),
        actor_id: ActorId::new(record.actor_id.clone()),
        harness_id: record
            .harness_id
            .as_deref()
            .map(boreal_domain::HarnessId::new),
        session_id: record
            .session_id
            .as_deref()
            .map(boreal_domain::SessionId::new),
        fence: Fence::new(record.fence),
        phase: record.phase,
        claimed_at: parse_stamp(&record.claimed_at)?,
        accepted_at: record.accepted_at.as_deref().map(parse_stamp).transpose()?,
        lease_deadline: parse_stamp(&record.lease_deadline)?,
        hard_deadline: parse_stamp(&record.hard_deadline)?,
        current: snapshot.current_attempt.as_ref().is_some_and(|current| {
            current.attempt_id == record.attempt_id && current.fence == record.fence
        }),
    })
}

fn close_readiness_source(
    snapshot: &boreal_store::acceptance::CloseReadinessSnapshot,
    attempt: &crate::AttemptSnapshot,
) -> SourceVersionId {
    let binding_source = snapshot.final_result.as_ref().and_then(|binding| {
        (binding.attempt_id == attempt.attempt_id.as_str()
            && binding.fence == attempt.fence.get()
            && binding.config_identity
                == snapshot
                    .proof_attempt
                    .as_ref()
                    .map(|record| record.config_identity.as_str())
                    .unwrap_or_default()
            && binding.profile_id == snapshot.pinned_requirements.profile.profile_id.as_str()
            && binding.profile_version == snapshot.pinned_requirements.profile.version)
            .then(|| binding.source_version_id.clone())
    });
    let submission_source = snapshot.submission.as_ref().and_then(|submission| {
        (submission.attempt_id == attempt.attempt_id.as_str()
            && submission.fence == attempt.fence.get()
            && submission.config_identity
                == snapshot
                    .proof_attempt
                    .as_ref()
                    .map(|record| record.config_identity.as_str())
                    .unwrap_or_default()
            && submission.profile_id == snapshot.pinned_requirements.profile.profile_id.as_str()
            && submission.profile_version == snapshot.pinned_requirements.profile.version)
            .then(|| submission.source_version_id.clone())
    });
    SourceVersionId::new(
        binding_source
            .or(submission_source)
            .or_else(|| {
                snapshot
                    .proof_attempt
                    .as_ref()
                    .and_then(|record| record.source_version_id.clone())
            })
            .unwrap_or_default(),
    )
}

fn close_readiness_gap_id(gap: &crate::CloseoutGap) -> &str {
    match gap {
        crate::CloseoutGap::GateUnsatisfied(id)
        | crate::CloseoutGap::ReviewRequired(id)
        | crate::CloseoutGap::ReviewRejected(id) => id.as_str(),
        _ => "",
    }
}

fn record_final_result_lineage(
    catalog: &SourceCatalog,
    binding: &boreal_store::acceptance::FinalResultBindingRecord,
) -> Result<(), String> {
    let source = SourceIdentity {
        project_id: binding.project_id.clone(),
        source_version_id: binding.source_version_id.clone(),
        content_digest: binding.content_digest.clone(),
    };
    catalog
        .read_identity_bounded(&source, DEFAULT_MAX_ARTIFACT_BYTES)
        .map_err(|error| format!("final result source readback failed: {error}"))?;
    let digest = crate::canonical_request_digest(
        "final-result.lineage-id/v1",
        json!({
            "project_id": binding.project_id,
            "work_id": binding.work_id,
            "attempt_id": binding.attempt_id,
            "fence": binding.fence,
            "binding_id": binding.binding_id,
        }),
    );
    let relationship_suffix = digest.strip_prefix("sha256:").unwrap_or(&digest);
    let relationship_suffix = relationship_suffix
        .get(..48)
        .ok_or_else(|| "final result lineage digest is malformed".to_owned())?;
    catalog
        .record_artifact_relationship(ArtifactRelationshipInput {
            relationship_id: format!("final-result-{relationship_suffix}"),
            source,
            role: ArtifactRole::ProducedDeliverable,
            scope: ArtifactScope::Project,
            requirement_key: None,
            produced_by: Some(ArtifactProducer {
                work_id: binding.work_id.clone(),
                attempt_id: binding.attempt_id.clone(),
                result_id: binding.binding_id.clone(),
            }),
            rights: ArtifactRightsProvenance::default(),
            operation_id: format!(
                "final-result-lineage-{}",
                digest.strip_prefix("sha256:").unwrap_or(&digest)
            ),
        })
        .map_err(|error| format!("final result lineage remains pending: {error}"))?;
    Ok(())
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
            ));
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

/// New summary/proof candidates have new close intent identities. A rejected
/// candidate and its operation result remain immutable and readable.
fn close_candidate_id(intent: &CloseIntent) -> String {
    format!(
        "close:{}",
        canonical_request_digest(
            "close.candidate/v1",
            json!({
                "work_id":intent.work_id.as_str(),"attempt_id":intent.attempt_id.as_str(),
                "fence":intent.fence.get(),"source":intent.source_snapshot_hash.as_str(),
                "configuration":intent.config_identity.as_str(),"profile":intent.profile_id.as_str(),
                "profile_version":intent.profile_version,"summary_id":intent.summary_id,
            })
        )
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::CommandSpec;
    use boreal_domain::{
        AcceptanceProfile, ActorRole, ConfigIdentity, DispatchPolicy, GateRequirement,
        PersistedLifecycle, ProjectId, WorkId, WorkItem, WorkKind,
    };
    use boreal_store::{
        EvidenceExecutionState,
        identity::{DatabaseIdentity, IdentityStore, WorkspaceBinding},
        principals::{PrincipalGrantRequest, PrincipalRevocationRequest},
        SourceVersionRegistrationInput,
    };

    const FIXTURE_SCHEMA: &str = include_str!("../../../project/spec/schema-v2.sql");
    const PRODUCTION_SCHEMA: &str = include_str!("../../../project/spec/schema-production.sql");
    const VERIFIER_SESSION: &str = "verifier-session";
    const VERIFIER_OPERATOR_SESSION: &str = "verifier-operator-session";

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
            gate_policy_identity: format!("sha256:{}", "2".repeat(64)),
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
        store
            .bootstrap_project_principal(&PrincipalGrantRequest {
                project_id: project.as_str().to_owned(),
                actor_id: "verifier-operator".to_owned(),
                session_id: None,
                principal_actor_id: "verifier-operator".to_owned(),
                role: ActorRole::Operator,
                independent: true,
                credential: format!("bwrk1_{}", "a".repeat(64)),
                expires_at_ms: None,
                display_name: "Verifier operator".to_owned(),
                reason: "bootstrap production verifier test principal".to_owned(),
                expected_revision: store
                    .project_revision(project.as_str())
                    .expect("project revision")
                    .0,
                operation_id: "op-verifier-bootstrap".to_owned(),
                at: "unix-ms:2".to_owned(),
            })
            .expect("bootstrap verifier operator");
        store
            .grant_principal(&PrincipalGrantRequest {
                project_id: project.as_str().to_owned(),
                actor_id: "verifier-operator".to_owned(),
                session_id: None,
                principal_actor_id: "agent-one".to_owned(),
                role: ActorRole::Agent,
                independent: false,
                credential: format!("bwrk1_{}", "b".repeat(64)),
                expires_at_ms: None,
                display_name: "Verifier agent".to_owned(),
                reason: "grant test execution principal".to_owned(),
                expected_revision: store
                    .project_revision(project.as_str())
                    .expect("project revision")
                    .0,
                operation_id: "op-verifier-agent-grant".to_owned(),
                at: "unix-ms:2".to_owned(),
            })
            .expect("grant verifier agent");
        let app = WorkApplication::new(&store);
        app.register_session_as(
            &project,
            "agent-one",
            "verifier-harness",
            VERIFIER_SESSION,
            "unix-ms:3",
            "op-verifier-session",
        )
        .expect("register verifier session");
        app.register_session_as(
            &project,
            "verifier-operator",
            "verifier-harness",
            VERIFIER_OPERATOR_SESSION,
            "unix-ms:3",
            "op-verifier-operator-session",
        )
        .expect("register verifier operator session");
        app.create_work_as_session_checked(
            &verifier_work(&project),
            "verifier-operator",
            VERIFIER_OPERATOR_SESSION,
            Some(
                store
                    .project_revision(project.as_str())
                    .expect("project revision")
                    .0,
            ),
            "unix-ms:4",
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
            Some(VERIFIER_SESSION),
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

    fn bind_verifier_final_result(
        store: &SqliteStore,
        project: &ProjectId,
        request: &mut EvidenceRunRequest,
        binding_at: TimestampMs,
    ) {
        let attempt = store
            .current_attempt_for_work(project.as_str(), request.expectation.work_id.as_str())
            .expect("read current verifier attempt")
            .expect("current verifier attempt exists");
        let session_id = attempt
            .session_id
            .as_deref()
            .expect("verifier attempt has a session");
        let fixture_id = request.operation_id.as_str();
        let origin = format!("{fixture_id}-final-result.txt");
        let body = format!("final verifier result bytes for {fixture_id}");
        let version = SourceCatalog::default()
            .capture(project.as_str(), &origin, body.as_bytes(), "text/plain")
            .expect("capture verifier final result");
        store
            .register_source_version(&SourceVersionRegistrationInput {
                operation_id: format!("op-source-register-{fixture_id}"),
                project_id: project.as_str().to_owned(),
                actor_id: attempt.actor_id.clone(),
                source_version_id: version.source_version_id.clone(),
                origin,
                access_scope: "project".to_owned(),
                content_digest: version.content_digest.clone(),
                media_type: version.media_type.clone(),
                byte_count: version.byte_count as u64,
                captured_at: stamp(TimestampMs::from_millis(
                    binding_at.as_millis().saturating_sub(10),
                )),
                parser_identity: "verifier-test/1".to_owned(),
                availability: "available".to_owned(),
                citation_json: "[]".to_owned(),
                request_digest: format!("sha256:source-register-{fixture_id}"),
            })
            .expect("register verifier final result source");
        let (entity_revision, proof_revision) = store
            .work_revisions(project.as_str(), request.expectation.work_id.as_str())
            .expect("read verifier proof revisions");
        boreal_store::acceptance::AcceptanceStore::new(store)
            .bind_final_result(&boreal_store::acceptance::FinalResultBindingRequest {
                project_id: project.as_str().to_owned(),
                work_id: request.expectation.work_id.as_str().to_owned(),
                actor_id: attempt.actor_id,
                session_id: session_id.to_owned(),
                attempt_id: request.expectation.attempt_id.as_str().to_owned(),
                fence: request.expectation.fence.get(),
                expected_project_revision: store
                    .project_revision(project.as_str())
                    .expect("project revision")
                    .0,
                expected_entity_revision: entity_revision,
                expected_proof_revision: proof_revision,
                source_version_id: version.source_version_id.clone(),
                content_digest: version.content_digest,
                operation_id: format!("op-final-result-{fixture_id}"),
                at: stamp(binding_at),
            })
            .expect("bind verifier final result");
        request.expectation.source_snapshot_hash = SourceVersionId::new(version.source_version_id);
    }

    fn production_reviewed_verifier_work(
        store: &SqliteStore,
        project: &ProjectId,
        work_id: &str,
        attempt_id: &str,
        session_id: &str,
    ) {
        let app = WorkApplication::new(store);
        app.register_session_as(
            project,
            "agent-one",
            "verifier-harness",
            session_id,
            "unix-ms:12",
            &format!("op-session-{work_id}"),
        )
        .expect("register reviewed verifier agent session");
        let mut work = verifier_work(project);
        work.id = WorkId::new(work_id);
        work.acceptance_profile = AcceptanceProfile::reviewed();
        app.create_work_as_session_checked(
            &work,
            "verifier-operator",
            VERIFIER_OPERATOR_SESSION,
            Some(
                store
                    .project_revision(project.as_str())
                    .expect("project revision")
                    .0,
            ),
            "unix-ms:10",
            &format!("op-create-{work_id}"),
        )
        .expect("create reviewed verifier work");
        app.claim_with_context(
            project,
            work_id,
            "agent-one",
            "verifier-harness",
            Some(session_id),
            attempt_id,
            &format!("op-claim-{work_id}"),
            &format!("sha256:{work_id}-claim"),
            None,
            "unix-ms:1000",
            "unix-ms:2000",
            "unix-ms:3000",
            Some("source-one"),
            "config-one",
        )
        .expect("claim reviewed verifier work");
        store
            .execute_batch(&format!(
                "UPDATE attempt SET state = 'running', accepted_at = 'unix-ms:1001'
                 WHERE attempt_id = '{attempt_id}'"
            ))
            .expect("put reviewed verifier attempt in running phase");
    }

    fn production_general_attestation_work(
        store: &SqliteStore,
        project: &ProjectId,
        work_id: &str,
        attempt_id: &str,
        session_id: &str,
    ) {
        let app = WorkApplication::new(store);
        app.register_session_as(
            project,
            "agent-one",
            "verifier-harness",
            session_id,
            "unix-ms:12",
            &format!("op-session-{work_id}"),
        )
        .expect("register general-work agent session");
        let mut work = verifier_work(project);
        work.id = WorkId::new(work_id);
        work.acceptance_profile = AcceptanceProfile {
            id: ProfileId::new("general-attestation"),
            version: "1".to_owned(),
            gates: vec![GateRequirement::required(
                GateId::new("summary"),
                GateKind::Summary,
            )],
        };
        app.create_work_as_session_checked(
            &work,
            "verifier-operator",
            VERIFIER_OPERATOR_SESSION,
            Some(
                store
                    .project_revision(project.as_str())
                    .expect("project revision")
                    .0,
            ),
            "unix-ms:10",
            &format!("op-create-{work_id}"),
        )
        .expect("create general-attestation work");
        app.claim_with_context(
            project,
            work_id,
            "agent-one",
            "verifier-harness",
            Some(session_id),
            attempt_id,
            &format!("op-claim-{work_id}"),
            &format!("sha256:{work_id}-claim"),
            None,
            "unix-ms:1000",
            "unix-ms:2000",
            "unix-ms:3000",
            Some("source-one"),
            "config-one",
        )
        .expect("claim general-attestation work");
        store
            .execute_batch(&format!(
                "UPDATE attempt SET state = 'running', accepted_at = 'unix-ms:1001'
                 WHERE attempt_id = '{attempt_id}'"
            ))
            .expect("put general-attestation attempt in running phase");
    }

    fn persist_open_close_intent(
        store: &SqliteStore,
        project: &ProjectId,
        work_id: &str,
        attempt_id: &str,
        profile_id: &str,
    ) -> String {
        let app = WorkApplication::new(store);
        let attempt = store
            .current_attempt_for_work(project.as_str(), work_id)
            .expect("read current attempt")
            .expect("current attempt exists");
        let session_id = attempt
            .session_id
            .as_deref()
            .expect("test attempt has a session");
        let mut final_result_source = attempt.source_version_id.clone();
        if matches!(profile_id, "focused" | "reviewed") {
            let catalog = SourceCatalog::default();
            let origin = format!("{work_id}-final-result.txt");
            let final_result_body = format!("final result bytes for {work_id}");
            let version = catalog
                .capture(
                    project.as_str(),
                    &origin,
                    final_result_body.as_bytes(),
                    "text/plain",
                )
                .expect("capture a fixture final result");
            store
                .register_source_version(&SourceVersionRegistrationInput {
                    operation_id: format!("op-source-register-{work_id}"),
                    project_id: project.as_str().to_owned(),
                    actor_id: attempt.actor_id.clone(),
                    source_version_id: version.source_version_id.clone(),
                    origin,
                    access_scope: "project".to_owned(),
                    content_digest: version.content_digest.clone(),
                    media_type: version.media_type.clone(),
                    byte_count: version.byte_count as u64,
                    captured_at: "unix-ms:1300".to_owned(),
                    parser_identity: "close-readiness-test/1".to_owned(),
                    availability: "available".to_owned(),
                    citation_json: "[]".to_owned(),
                    request_digest: format!("sha256:source-register-{work_id}"),
                })
                .expect("register fixture final result source");
            let (entity_revision, proof_revision) = store
                .work_revisions(project.as_str(), work_id)
                .expect("read current software proof revisions");
            final_result_source = Some(version.source_version_id.clone());
            boreal_store::acceptance::AcceptanceStore::new(store)
                .bind_final_result(&boreal_store::acceptance::FinalResultBindingRequest {
                    project_id: project.as_str().to_owned(),
                    work_id: work_id.to_owned(),
                    actor_id: attempt.actor_id.clone(),
                    session_id: session_id.to_owned(),
                    attempt_id: attempt_id.to_owned(),
                    fence: attempt.fence,
                    expected_project_revision: store
                        .project_revision(project.as_str())
                        .expect("project revision")
                        .0,
                    expected_entity_revision: entity_revision,
                    expected_proof_revision: proof_revision,
                    source_version_id: version.source_version_id,
                    content_digest: version.content_digest,
                    operation_id: format!("op-final-result-{work_id}"),
                    at: "unix-ms:1350".to_owned(),
                })
                .expect("bind a final result for the software-profile fixture");
        }
        store
            .apply_attempt_mutation(boreal_store::AttemptMutationRequest {
                project_id: project.as_str().to_owned(),
                work_id: work_id.to_owned(),
                attempt_id: attempt_id.to_owned(),
                actor_id: "agent-one".to_owned(),
                harness_id: Some("verifier-harness".to_owned()),
                session_id: Some(session_id.to_owned()),
                fence: attempt.fence,
                operation_id: format!("op-submit-{work_id}"),
                request_digest: format!("sha256:submit-{work_id}"),
                at: "unix-ms:1400".to_owned(),
                expected_project_revision: None,
                expected_work_revision: None,
                expected_attempt_revision: Some(attempt.fence),
                expected_phase: Some(AttemptPhase::Running),
                expected_lease_deadline: None,
                expected_hard_deadline: None,
                mutation: boreal_store::AttemptMutationKind::Submit,
                reason: None,
            })
            .expect("submit verifier attempt");

        let body = format!("close readiness summary for {work_id}");
        let summary_id = format!("summary-{work_id}");
        let summary = SummaryPayload {
            summary_id: summary_id.clone(),
            work_id: WorkId::new(work_id),
            attempt_id: AttemptId::new(attempt_id),
            fence: Fence::new(attempt.fence),
            source_snapshot_hash: SourceVersionId::new(
                final_result_source.as_deref().unwrap_or(""),
            ),
            config_identity: ConfigIdentity::new("config-one"),
            profile_id: ProfileId::new(profile_id),
            profile_version: "1".to_owned(),
            body_digest: crate::sha256_content_digest(body.as_bytes()),
            body_size: body.len() as u64,
        };
        app.record_summary_with_body(
            project.as_str(),
            "agent-one",
            Some(session_id),
            &summary,
            &body,
            &format!("op-summary-{work_id}"),
            Some(
                store
                    .project_revision(project.as_str())
                    .expect("project revision")
                    .0,
            ),
            TimestampMs::from_millis(1500),
        )
        .expect("persist typed summary and body");

        let intent = CloseIntent {
            work_id: WorkId::new(work_id),
            attempt_id: AttemptId::new(attempt_id),
            fence: Fence::new(attempt.fence),
            source_snapshot_hash: SourceVersionId::new(
                final_result_source.as_deref().unwrap_or(""),
            ),
            config_identity: ConfigIdentity::new("config-one"),
            profile_id: ProfileId::new(profile_id),
            profile_version: "1".to_owned(),
            summary_id: Some(summary_id),
        };
        app.request_close(
            "agent-one",
            Some(session_id),
            &intent,
            Some(
                store
                    .project_revision(project.as_str())
                    .expect("project revision")
                    .0,
            ),
            TimestampMs::from_millis(1600),
        )
        .expect("persist open close intent")
        .close_intent
        .close_intent_id
    }

    fn record_required_review(
        store: &SqliteStore,
        project: &ProjectId,
        work_id: &str,
        attempt_id: &str,
        review_id: &str,
        decision: ReviewDecision,
        now: u64,
    ) {
        let requirements = boreal_store::profiles::ProfileStore::new(store)
            .current_pinned_requirements(project.as_str(), work_id)
            .expect("read reviewed profile pin");
        let attempt = store
            .attempt_record_by_id(project.as_str(), attempt_id)
            .expect("read reviewed attempt")
            .expect("reviewed attempt exists");
        let revisions_before = store
            .work_revisions(project.as_str(), work_id)
            .expect("read reviewed proof revision");
        let (_, proof_revision) = revisions_before;
        let submission = store
            .current_submission(project.as_str(), work_id, proof_revision)
            .expect("read reviewed submission")
            .expect("reviewed work has an immutable submission");
        // This test targets close-readiness review readback only; it does not
        // exercise review-write authorization. A software final-result
        // submission has a produced source distinct from the immutable claim
        // source, so do not route the fixture through the review action
        // preflight (which evaluates the claim proof). Seed the legacy review
        // row against the exact sealed submission instead.
        let gate_id = store
            .gate_id_for_work(project.as_str(), work_id, "review")
            .expect("read exact reviewed gate id");
        let decision = match decision {
            ReviewDecision::Accepted => "accepted",
            ReviewDecision::Rejected => "rejected",
        };
        let project_id = project.as_str();
        let sql = format!(
            "INSERT INTO review (
                 review_id,work_id,attempt_id,fence,gate_id,reviewer_actor_id,
                 decision,reason,source_version_id,policy_digest,created_at
             ) VALUES (
                 '{review_id}','{work_id}','{attempt_id}',{},'{gate_id}',
                 'reviewer-one','{decision}','reviewed close-readiness test submission',
                 '{}','{}','unix-ms:{now}'
             );
             UPDATE project
             SET project_revision=project_revision+1,updated_at='unix-ms:{now}'
             WHERE project_id='{project_id}';",
            attempt.fence,
            submission.source_version_id,
            requirements.profile.policy_digest,
        );
        store
            .execute_batch(&sql)
            .expect("seed exact legacy review readback fixture");
        assert_eq!(
            store
                .work_revisions(project.as_str(), work_id)
                .expect("read work revisions after review fixture"),
            revisions_before,
            "recording a review must not advance entity or proof revisions",
        );
        assert_eq!(
            store
                .attempt_record_by_id(project.as_str(), attempt_id)
                .expect("read attempt after review fixture")
                .expect("reviewed attempt remains durable"),
            attempt,
            "recording a review must not mutate the immutable claim attempt",
        );
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
        bind_verifier_final_result(
            store,
            project,
            &mut request,
            TimestampMs::from_millis(1_050),
        );
        let admission = app
            .admit_witnessed_execution(
                "agent-one",
                Some(VERIFIER_SESSION),
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
    fn canonical_status_fails_closed_for_a_revoked_project_principal() {
        let (store, project) = production_verifier_setup();
        store
            .revoke_principal(&PrincipalRevocationRequest {
                project_id: project.as_str().to_owned(),
                actor_id: "verifier-operator".to_owned(),
                session_id: Some(VERIFIER_OPERATOR_SESSION.to_owned()),
                principal_actor_id: "agent-one".to_owned(),
                credential_id: None,
                reason: "test that revoked callers cannot supply decision authority".to_owned(),
                expected_revision: store
                    .project_revision(project.as_str())
                    .expect("project revision")
                    .0,
                operation_id: "op-verifier-agent-revoke".to_owned(),
                at: "unix-ms:4".to_owned(),
            })
            .expect("revoke agent principal");

        assert!(matches!(
            store.read_project_status_for_session(
                project.as_str(),
                "agent-one",
                Some(VERIFIER_SESSION),
                TimestampMs::from_millis(1_500),
            ),
            Err(StoreError::Conflict(message))
                if message.contains("principal or its delegator is not active in this project")
        ));
    }

    #[test]
    fn canonical_status_fails_closed_for_an_unenrolled_project_actor() {
        let (store, project) = production_verifier_setup();
        store
            .execute_batch(
                "INSERT INTO actor(actor_id,role,credential_ref,display_name,created_at)
                 VALUES ('unregistered-agent','agent','credential-unregistered-agent',
                         'Unregistered agent','unix-ms:3');",
            )
            .expect("fixture has a global actor record without project enrollment");

        assert!(matches!(
            store.read_project_status_for_session(
                project.as_str(),
                "unregistered-agent",
                None,
                TimestampMs::from_millis(1_500),
            ),
            Err(StoreError::Conflict(message))
                if message.contains("principal or its delegator is not active in this project")
        ));
    }

    #[test]
    fn noncanonical_fixture_missing_database_identity_keeps_legacy_fallback() {
        let store = SqliteStore::open_in_memory(FIXTURE_SCHEMA).expect("open fixture store");
        let application = WorkApplication::new(&store);

        assert!(!store.is_canonical_production());
        assert!(
            application
                .identity_context("fixture-project")
                .expect("fixture identity lookup")
                .is_none()
        );
    }

    #[test]
    fn artifact_reference_is_explicitly_not_claimed_as_content_digest() {
        let binding = artifact_binding("artifact://verifier-output", "source-one");
        assert_eq!(binding["mode"], "reference_only");
        assert_eq!(binding["content_bound"], false);
        assert_eq!(binding["reference"], "artifact://verifier-output");
        assert!(
            binding["diagnostic"]
                .as_str()
                .expect("reference diagnostic")
                .contains("not a content digest")
        );
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
        assert!(
            store
                .evidence_execution(request.operation_id.as_str())
                .expect("read execution")
                .is_none()
        );
        assert!(
            store
                .operation("verifier:op-verifier-admission-order")
                .expect("read verifier operation")
                .is_none(),
            "hard-deadline rejection happens before the admission journal is written"
        );
        assert!(
            store
                .audit_event("verifier:op-verifier-admission-order")
                .expect("read verifier audit")
                .is_none()
        );
        assert!(
            store
                .external_job(project.as_str(), "verifier:op-verifier-admission-order")
                .expect("read verifier job")
                .is_none()
        );
    }

    #[test]
    fn verifier_admission_replay_repairs_either_durable_half_without_second_job() {
        let (store, project) = production_verifier_setup();
        let app = WorkApplication::new(&store);
        let mut request = verifier_request("op-verifier-admission-repair");
        bind_verifier_final_result(
            &store,
            &project,
            &mut request,
            TimestampMs::from_millis(1_050),
        );

        let first = app
            .admit_witnessed_execution(
                "agent-one",
                Some(VERIFIER_SESSION),
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
                Some(VERIFIER_SESSION),
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
                Some(VERIFIER_SESSION),
                &request,
                "artifact://verifier-output",
                TimestampMs::from_millis(1_100),
            )
            .expect("repair missing evidence execution");
        assert!(!repaired_execution.replayed);
        assert!(
            store
                .evidence_execution(request.operation_id.as_str())
                .expect("read repaired evidence execution")
                .is_some()
        );
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
        let mut request = verifier_request("op-verifier-unknown-readback");
        bind_verifier_final_result(
            &store,
            &project,
            &mut request,
            TimestampMs::from_millis(1_050),
        );

        app.admit_witnessed_execution(
            "agent-one",
            Some(VERIFIER_SESSION),
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
        // A newer produced result supersedes the output this verifier ran
        // against. The old receipt must fail its source-context preflight
        // before the external job is reconciled.
        let mut changed_result_request = request.clone();
        changed_result_request.operation_id =
            boreal_domain::OperationId::new("op-verifier-source-change-rebind");
        bind_verifier_final_result(
            &store,
            &project,
            &mut changed_result_request,
            TimestampMs::from_millis(1_360),
        );
        assert_ne!(
            changed_result_request.expectation.source_snapshot_hash,
            request.expectation.source_snapshot_hash,
            "the newer final-result binding must supersede the verifier's source"
        );

        let error = app.record_witnessed_execution(
            "agent-one",
            Some(VERIFIER_SESSION),
            &request,
            &result,
            None,
            TimestampMs::from_millis(1_400),
        );
        assert!(matches!(
            error,
            Err(ApplicationError::Evidence(error))
                if error.code() == EvidenceErrorCode::ReceiptPolicyMismatch
        ));
        assert!(
            store
                .receipt(request.receipt_id.as_str())
                .expect("read receipt")
                .is_none()
        );
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
    fn verifier_outcome_cannot_disagree_with_the_receipt_result() {
        let (store, project) = production_verifier_setup();
        let (app, request, mut result) =
            finished_production_execution(&store, &project, "op-verifier-outcome-mismatch");
        result.outcome = crate::EvidenceExecutionOutcome::Failed;

        let error = app.record_witnessed_execution(
            "agent-one",
            Some(VERIFIER_SESSION),
            &request,
            &result,
            None,
            TimestampMs::from_millis(1_400),
        );
        assert!(matches!(
            error,
            Err(ApplicationError::Evidence(error))
                if error.code() == EvidenceErrorCode::ExecutionResultInvalid
        ));
        assert!(
            store
                .receipt(request.receipt_id.as_str())
                .expect("read mismatched verifier receipt")
                .is_none()
        );

        let identity = IdentityStore::new(&store)
            .context(project.as_str())
            .expect("read production identity");
        let execution = store
            .evidence_execution(request.operation_id.as_str())
            .expect("read verifier execution")
            .expect("execution remains durable");
        let readback = ExternalEffectAdapter::new_with_identity(&store, &identity)
            .readback(
                project.as_str(),
                &verifier_operation_id(request.operation_id.as_str()),
                &execution.request_digest,
            )
            .expect("read verifier job after mismatch rejection");
        assert_eq!(readback.record().stage, "readback_required");
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
            Some(VERIFIER_SESSION),
            &request,
            &result,
            Some(expected + 1),
            TimestampMs::from_millis(1_400),
        );
        assert!(matches!(
            error,
            Err(ApplicationError::Store(StoreError::StaleRevision { .. }))
        ));
        assert!(
            store
                .receipt(request.receipt_id.as_str())
                .expect("read pending receipt")
                .is_none()
        );
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
                Some(VERIFIER_SESSION),
                &request,
                &result,
                None,
                TimestampMs::from_millis(1_500),
            )
            .expect("retry persists receipt after readback");
        assert!(!recorded.replayed);
        assert!(
            store
                .receipt(request.receipt_id.as_str())
                .expect("read recorded receipt")
                .is_some()
        );
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
                Some(VERIFIER_SESSION),
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

        assert!(
            second_app
                .record_witnessed_execution(
                    "agent-one",
                    Some(VERIFIER_SESSION),
                    &second_request,
                    &second_result,
                    None,
                    TimestampMs::from_millis(1_500),
                )
                .is_err()
        );

        let execution = store
            .evidence_execution(second_request.operation_id.as_str())
            .expect("read second execution")
            .expect("second execution remains durable");
        assert_eq!(execution.state, EvidenceExecutionState::Exited);
        assert!(execution.receipt_id.is_none());
        assert!(
            store
                .operation(second_request.operation_id.as_str())
                .expect("read failed receipt operation")
                .is_none()
        );
    }

    #[test]
    fn close_readiness_reports_gaps_from_persisted_inputs() {
        let (store, project) = production_verifier_setup();
        let readiness = WorkApplication::new(&store)
            .read_close_readiness(project.as_str(), "verifier-work")
            .expect("read canonical close readiness");
        let codes = readiness
            .gaps
            .iter()
            .map(crate::CloseoutGap::code)
            .collect::<Vec<_>>();
        assert!(!readiness.ready);
        assert!(codes.contains(&"attempt_not_verifying"));
        assert!(codes.contains(&"gate_unsatisfied"));
        assert!(codes.contains(&"summary_missing"));
        assert!(codes.contains(&"close_intent_missing"));
        assert!(!codes.contains(&"attempt_not_current"));
    }

    #[test]
    fn close_readiness_blocks_missing_or_mismatched_typed_acceptance_results() {
        let (store, project) = production_verifier_setup();
        production_general_attestation_work(
            &store,
            &project,
            "attested-work",
            "attested-attempt",
            "attested-session",
        );
        let app = WorkApplication::new(&store);
        let missing = app
            .read_close_readiness(project.as_str(), "attested-work")
            .expect("read missing typed acceptance readiness");
        assert!(!missing.ready);
        assert!(
            missing
                .gaps
                .contains(&crate::CloseoutGap::AcceptanceResultMissing)
        );

        let attempt = store
            .current_attempt_for_work(project.as_str(), "attested-work")
            .expect("read current typed acceptance attempt")
            .expect("typed acceptance attempt exists");
        let (entity_revision, proof_revision) = store
            .work_revisions(project.as_str(), "attested-work")
            .expect("read typed acceptance revisions");
        let bind_request = boreal_store::acceptance::AcceptanceResultBindRequest {
            project_id: project.as_str().to_owned(),
            work_id: "attested-work".to_owned(),
            actor_id: "agent-one".to_owned(),
            session_id: "attested-session".to_owned(),
            attempt_id: attempt.attempt_id.clone(),
            fence: attempt.fence,
            expected_project_revision: store
                .project_revision(project.as_str())
                .expect("project revision")
                .0,
            expected_entity_revision: entity_revision,
            expected_proof_revision: proof_revision,
            result_id: "result-attested-work".to_owned(),
            contract_revision: 0,
            outputs: Vec::new(),
            attestation: Some(boreal_store::acceptance::CompletionAttestationInput {
                statement: "Completed bounded general work".to_owned(),
            }),
            operation_id: "op-bind-attested-work".to_owned(),
            at: "unix-ms:1300".to_owned(),
        };
        boreal_store::acceptance::AcceptanceStore::new(&store)
            .bind_result(&bind_request)
            .expect("bind general-attestation result");
        persist_open_close_intent(
            &store,
            &project,
            "attested-work",
            "attested-attempt",
            "general-attestation",
        );

        let valid_snapshot = boreal_store::acceptance::AcceptanceStore::new(&store)
            .close_readiness_snapshot(project.as_str(), "attested-work")
            .expect("read exact typed acceptance snapshot");
        assert_eq!(
            valid_snapshot
                .acceptance_result
                .as_ref()
                .map(|record| record.result_id.as_str()),
            Some("result-attested-work")
        );
        assert_eq!(
            valid_snapshot.typed_acceptance,
            boreal_store::acceptance::CloseReadinessTypedAcceptance::Ready
        );

        store
            .execute_batch(
                "DROP TRIGGER boreal_submission_acceptance_immutable_update;
                 UPDATE boreal_submission_acceptance_v1
                 SET result_digest='sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
                 WHERE work_id='attested-work';",
            )
            .expect("tamper only the result binding digest fixture");
        let mismatched = app
            .read_close_readiness(project.as_str(), "attested-work")
            .expect("read mismatched typed acceptance readiness");
        assert!(!mismatched.ready);
        assert!(
            mismatched
                .gaps
                .contains(&crate::CloseoutGap::AcceptanceResultMismatch)
        );
    }

    #[test]
    fn close_readiness_distinguishes_a_stale_attempt_from_the_current_attempt() {
        let (store, project) = production_verifier_setup();
        let app = WorkApplication::new(&store);
        let current = app
            .read_close_readiness_readback(project.as_str(), "verifier-work")
            .expect("read current attempt readiness");
        assert_eq!(
            current.project_revision,
            store.project_revision(project.as_str()).unwrap().0
        );
        assert_eq!(current.work_id, WorkId::new("verifier-work"));
        assert_eq!(current.attempt_id.as_deref(), Some("verifier-attempt"));
        assert_eq!(current.fence, Some(1));
        assert!(
            !current
                .readiness
                .gaps
                .iter()
                .any(|gap| gap.code() == "attempt_not_current")
        );

        store
            .execute_batch(
                "UPDATE attempt
                 SET current=0, state='released', terminal_at='unix-ms:1600',
                     terminal_reason='test_stale_readback'
                 WHERE attempt_id='verifier-attempt'",
            )
            .expect("stale the persisted attempt for projection test");
        let stale = app
            .read_close_readiness_readback(project.as_str(), "verifier-work")
            .expect("read stale attempt readiness");
        assert_eq!(stale.attempt_id, None);
        assert_eq!(stale.fence, None);
        assert!(
            stale
                .readiness
                .gaps
                .iter()
                .any(|gap| gap.code() == "attempt_not_current")
        );
    }

    #[test]
    fn close_readiness_reports_summary_body_integrity_mismatch() {
        let (store, project) = production_verifier_setup();
        persist_open_close_intent(
            &store,
            &project,
            "verifier-work",
            "verifier-attempt",
            "focused",
        );
        store
            .execute_batch(
                "DROP TRIGGER summary_body_v1_no_update;
                 UPDATE summary_body_v1 SET body_text='tampered summary bytes'
                 WHERE summary_id='summary-verifier-work';",
            )
            .expect("tamper with stored body integrity fixture");

        let readiness = WorkApplication::new(&store)
            .read_close_readiness(project.as_str(), "verifier-work")
            .expect("read tampered summary readiness");
        assert!(
            readiness
                .gaps
                .iter()
                .any(|gap| gap.code() == "summary_mismatch")
        );
    }

    #[test]
    fn close_readiness_reports_mismatched_close_intent() {
        let (store, project) = production_verifier_setup();
        persist_open_close_intent(
            &store,
            &project,
            "verifier-work",
            "verifier-attempt",
            "focused",
        );
        store
            .execute_batch(
                "UPDATE close_intent SET config_identity='config-mismatch'
                 WHERE work_id='verifier-work';",
            )
            .expect("mismatch persisted close intent context");

        let readiness = WorkApplication::new(&store)
            .read_close_readiness(project.as_str(), "verifier-work")
            .expect("read mismatched close intent readiness");
        assert!(
            readiness
                .gaps
                .iter()
                .any(|gap| gap.code() == "close_intent_invalid")
        );
    }

    #[test]
    fn close_readiness_reports_non_open_close_intent() {
        let (store, project) = production_verifier_setup();
        persist_open_close_intent(
            &store,
            &project,
            "verifier-work",
            "verifier-attempt",
            "focused",
        );
        store
            .execute_batch(
                "UPDATE close_intent
                 SET state='invalidated', invalidated_at='unix-ms:1700',
                     invalidation_code='test.invalidated'
                 WHERE work_id='verifier-work';",
            )
            .expect("invalidate persisted close intent fixture");

        let readiness = WorkApplication::new(&store)
            .read_close_readiness(project.as_str(), "verifier-work")
            .expect("read invalidated close intent readiness");
        assert!(
            readiness
                .gaps
                .iter()
                .any(|gap| gap.code() == "close_intent_invalid")
        );
    }

    #[test]
    fn close_readiness_accepts_and_rejects_required_reviews() {
        let (store, project) = production_verifier_setup();
        store
            .grant_principal(&PrincipalGrantRequest {
                project_id: project.as_str().to_owned(),
                actor_id: "verifier-operator".to_owned(),
                session_id: None,
                principal_actor_id: "reviewer-one".to_owned(),
                role: ActorRole::Reviewer,
                independent: true,
                credential: format!("bwrk1_{}", "c".repeat(64)),
                expires_at_ms: None,
                display_name: "Independent verifier reviewer".to_owned(),
                reason: "grant independent reviewer for close-readiness test".to_owned(),
                expected_revision: store
                    .project_revision(project.as_str())
                    .expect("project revision")
                    .0,
                operation_id: "op-verifier-reviewer-grant".to_owned(),
                at: "unix-ms:10".to_owned(),
            })
            .expect("grant independent reviewer");
        WorkApplication::new(&store)
            .register_session_as(
                &project,
                "reviewer-one",
                "verifier-harness",
                "reviewer-session",
                "unix-ms:11",
                "op-verifier-reviewer-session",
            )
            .expect("register independent reviewer session");

        production_reviewed_verifier_work(
            &store,
            &project,
            "reviewed-accepted-work",
            "reviewed-accepted-attempt",
            "reviewed-accepted-session",
        );
        persist_open_close_intent(
            &store,
            &project,
            "reviewed-accepted-work",
            "reviewed-accepted-attempt",
            "reviewed",
        );
        record_required_review(
            &store,
            &project,
            "reviewed-accepted-work",
            "reviewed-accepted-attempt",
            "review-accepted",
            ReviewDecision::Accepted,
            1800,
        );
        let accepted = WorkApplication::new(&store)
            .read_close_readiness(project.as_str(), "reviewed-accepted-work")
            .expect("read accepted review readiness");
        assert!(
            !accepted
                .gaps
                .iter()
                .any(|gap| matches!(gap, crate::CloseoutGap::ReviewRequired(_)))
        );
        assert!(
            !accepted
                .gaps
                .iter()
                .any(|gap| matches!(gap, crate::CloseoutGap::ReviewRejected(_)))
        );

        production_reviewed_verifier_work(
            &store,
            &project,
            "reviewed-rejected-work",
            "reviewed-rejected-attempt",
            "reviewed-rejected-session",
        );
        persist_open_close_intent(
            &store,
            &project,
            "reviewed-rejected-work",
            "reviewed-rejected-attempt",
            "reviewed",
        );
        record_required_review(
            &store,
            &project,
            "reviewed-rejected-work",
            "reviewed-rejected-attempt",
            "review-rejected",
            ReviewDecision::Rejected,
            1900,
        );
        let rejected = WorkApplication::new(&store)
            .read_close_readiness(project.as_str(), "reviewed-rejected-work")
            .expect("read rejected review readiness");
        assert!(
            !rejected
                .gaps
                .iter()
                .any(|gap| matches!(gap, crate::CloseoutGap::ReviewRequired(_)))
        );
        assert!(
            rejected
                .gaps
                .iter()
                .any(|gap| matches!(gap, crate::CloseoutGap::ReviewRejected(_)))
        );
    }

    #[test]
    fn close_readiness_rejects_a_work_item_from_another_project() {
        let (store, _project) = production_verifier_setup();
        store
            .create_project("other-project", "unix-ms:5")
            .expect("create other project");
        let error = WorkApplication::new(&store)
            .read_close_readiness("other-project", "verifier-work")
            .expect_err("cross-project work read must fail");
        assert!(matches!(
            error,
            ApplicationError::Store(StoreError::WrongSubject { .. })
        ));
    }
}
