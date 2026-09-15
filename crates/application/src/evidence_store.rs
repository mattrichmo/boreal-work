//! Durable application façade for receipts, reviews, and proof-gated closeout.

use boreal_domain::{ActorId, TimestampMs};
use boreal_store::{
    CloseIntentRequest, CloseIntentResult, ReceiptAttestation, ReceiptInsertRequest,
    ReceiptInsertResult, ReceiptOutcome, ReviewDecision as StoreReviewDecision,
    ReviewInsertRequest,
};
use serde_json::json;

use crate::{
    validate_review_decision, AcceptanceDefinition, ApplicationError, CloseIntent, ReceiptPayload,
    ReviewDecision, ReviewDecisionRequest, SqliteStore, WorkApplication,
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
        receipt.validate().map_err(ApplicationError::from)?;
        let project_id = self.project_for_work(receipt.work_id.as_str())?;
        let gate_id = self.store().gate_id_for_work(
            &project_id,
            receipt.work_id.as_str(),
            receipt.gate_id.as_str(),
        )?;
        let result = self.store().insert_receipt(ReceiptInsertRequest {
            project_id,
            actor_id: actor_id.to_owned(),
            session_id: session_id.map(str::to_owned),
            expected_project_revision,
            request_digest: format!("receipt:{}", receipt.operation_id),
            receipt_id: receipt.receipt_id.as_str().to_owned(),
            work_id: receipt.work_id.as_str().to_owned(),
            attempt_id: receipt.attempt_id.as_str().to_owned(),
            fence: receipt.fence.get(),
            operation_id: receipt.operation_id.as_str().to_owned(),
            gate_id: Some(gate_id),
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
            result: receipt_outcome(receipt.result),
            rejection_code: None,
            created_at: stamp(now),
        })?;
        Ok(result)
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
            request_digest: format!("review:{}", review.review_id),
            created_at: stamp(now),
        })?;
        Ok(crate::OperationResult {
            operation_id: format!("review:{}", review.review_id),
            snapshot_revision: result.revision,
            changed: !result.replayed,
            value: (),
        })
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
            request_digest: format!("close:{}", intent.attempt_id),
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
        Ok(self.store().finalize_close_intent(CloseIntentRequest {
            project_id: self.project_for_work(intent.work_id.as_str())?,
            actor_id: actor_id.to_owned(),
            session_id: session_id.map(str::to_owned),
            expected_project_revision,
            close_intent_id: format!("close:{}", intent.attempt_id),
            work_id: intent.work_id.as_str().to_owned(),
            attempt_id: intent.attempt_id.as_str().to_owned(),
            fence: intent.fence.get(),
            operation_id: format!("close:finalize:{}", intent.attempt_id),
            source_version_id: Some(intent.source_snapshot_hash.as_str().to_owned()),
            config_identity: intent.config_identity.as_str().to_owned(),
            profile_id: intent.profile_id.as_str().to_owned(),
            profile_version: intent.profile_version.parse().unwrap_or(1),
            summary_id: intent.summary_id.clone(),
            at: stamp(now),
            request_digest: format!("close-finalize:{}", intent.attempt_id),
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

fn stamp(value: TimestampMs) -> String {
    format!("unix-ms:{}", value.as_millis())
}
