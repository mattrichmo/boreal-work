//! Project-owned policy for immutable cross-store Intake delivery receipts.

use boreal_domain::work_model_v3::{IntakeBucketId, IntakeItemId, IntakeKind};
use boreal_domain::TimestampMs;
use boreal_store::{
    IntakeDeliveryInput, IntakeDeliveryMutationResult, IntakeDeliveryReadback,
    IntakeDeliveryRecord, IntakeItemV3Input, IntakeItemV3Record, MutationResult, StoreError,
    V3MutationContext,
};
use serde_json::json;

use crate::{
    canonical_request_digest, sha256_content_digest, ApplicationError, PlanningScope,
    WorkApplication,
};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntakeDeliveryOrigin {
    pub kind: String,
    pub item_id: String,
    pub digest: String,
}

/// Frozen semantic fields for the Project Intake row. The observation time
/// and allocated Intake ID are kept outside this digest so retries remain
/// stable while the immutable receipt supplies the original ID.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntakeDeliveryPayload {
    pub bucket_id: IntakeBucketId,
    pub kind: IntakeKind,
    pub content: String,
    pub revisit_at: Option<TimestampMs>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntakeDeliveryRequest {
    pub scope: PlanningScope,
    pub operation_id: String,
    pub delivery_key: String,
    pub origin: IntakeDeliveryOrigin,
    pub intake_id: IntakeItemId,
    pub payload: IntakeDeliveryPayload,
    pub payload_digest: String,
    /// One observation time used for both the Intake row and receipt.
    pub captured_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntakeDeliveryResult {
    pub project_revision: u64,
    /// Absent when this call resolved a prior semantic delivery without a
    /// new operation, revision, or audit write.
    pub operation: Option<MutationResult>,
    pub receipt: IntakeDeliveryRecord,
    pub intake: IntakeItemV3Record,
}

/// Stable digest used by both Global's frozen intent and the Project receiver.
pub fn intake_delivery_payload_digest(payload: &IntakeDeliveryPayload) -> String {
    canonical_request_digest(
        "intake.delivery.payload/v1",
        json!({
            "schema": "boreal.intake_delivery.payload.v1",
            "bucket_id": payload.bucket_id.as_str(),
            "kind": intake_kind(payload.kind),
            "content": payload.content,
            "revisit_at_utc_ms": payload.revisit_at.map(TimestampMs::as_millis),
        }),
    )
}

impl WorkApplication<'_> {
    /// Accept a new Project Intake delivery or resolve the immutable receipt
    /// from an earlier attempt. Duplicate resolution is authenticated and
    /// read-only even when the current Intake row has since changed.
    pub fn receive_intake_delivery(
        &self,
        request: &IntakeDeliveryRequest,
    ) -> Result<IntakeDeliveryResult, ApplicationError> {
        validate_receive_request(request)?;
        let scope = &request.scope;
        let revisit_at_utc_ms = request
            .payload
            .revisit_at
            .map(|at| i64::try_from(at.as_millis()))
            .transpose()
            .map_err(|_| {
                ApplicationError::Invalid("revisit timestamp exceeds SQLite range".to_owned())
            })?;
        let request_digest = canonical_request_digest(
            "intake.delivery.receive/v1",
            json!({
                "project_id": scope.project_id.as_str(),
                "actor_id": scope.actor_id,
                "session_id": scope.session_id,
                "expected_revision": scope.expected_revision,
                "delivery_key": request.delivery_key,
                "origin": {
                    "kind": request.origin.kind,
                    "item_id": request.origin.item_id,
                    "digest": request.origin.digest,
                },
                "intake_id": request.intake_id.as_str(),
                "payload_digest": request.payload_digest,
            }),
        );
        let context = V3MutationContext {
            project_id: scope.project_id.to_string(),
            actor_id: scope.actor_id.clone(),
            session_id: scope.session_id.clone(),
            operation_id: request.operation_id.clone(),
            request_digest,
            expected_revision: scope.expected_revision,
            now: request.captured_at.clone(),
        };
        let input = IntakeDeliveryInput {
            delivery_key: request.delivery_key.clone(),
            origin_kind: request.origin.kind.clone(),
            origin_item_id: request.origin.item_id.clone(),
            origin_digest: request.origin.digest.clone(),
            payload_digest: request.payload_digest.clone(),
            created_at: request.captured_at.clone(),
            intake: IntakeItemV3Input {
                project_id: scope.project_id.to_string(),
                intake_id: request.intake_id.to_string(),
                bucket_id: request.payload.bucket_id.to_string(),
                kind: intake_kind(request.payload.kind).to_owned(),
                lifecycle: "captured".to_owned(),
                content: request.payload.content.clone(),
                content_revision: 1,
                content_digest: sha256_content_digest(request.payload.content.as_bytes()),
                captured_at: request.captured_at.clone(),
                updated_at: request.captured_at.clone(),
                revisit_at_utc_ms,
            },
        };
        let result = self.store_ref().receive_intake_delivery(&context, &input)?;
        delivery_result(result)
    }

    /// Read a delivery by its stable logical identity. The result includes the
    /// current revision even when no receipt exists, so authorized callers can
    /// distinguish absence from an unavailable or failed readback.
    pub fn intake_delivery_readback(
        &self,
        scope: &PlanningScope,
        delivery_key: &str,
    ) -> Result<IntakeDeliveryReadback, ApplicationError> {
        validate_read_scope(scope)?;
        validate_nonempty("delivery_key", delivery_key)?;
        Ok(self.store_ref().intake_delivery_readback(
            scope.project_id.as_str(),
            &scope.actor_id,
            scope.session_id.as_deref(),
            delivery_key,
        )?)
    }

    /// Attach an optional immutable delivery receipt to an Intake detail read.
    pub fn intake_delivery_readback_for_intake(
        &self,
        scope: &PlanningScope,
        intake_id: &str,
    ) -> Result<IntakeDeliveryReadback, ApplicationError> {
        validate_read_scope(scope)?;
        validate_nonempty("intake_id", intake_id)?;
        Ok(self.store_ref().intake_delivery_readback_for_intake(
            scope.project_id.as_str(),
            &scope.actor_id,
            scope.session_id.as_deref(),
            intake_id,
        )?)
    }
}

fn delivery_result(
    result: IntakeDeliveryMutationResult,
) -> Result<IntakeDeliveryResult, ApplicationError> {
    Ok(IntakeDeliveryResult {
        project_revision: result.readback.project_revision,
        operation: result.mutation,
        receipt: result.readback.receipt.ok_or_else(|| {
            ApplicationError::Store(StoreError::Corrupt(
                "Intake delivery receipt was not read back".to_owned(),
            ))
        })?,
        intake: result.readback.intake.ok_or_else(|| {
            ApplicationError::Store(StoreError::Corrupt(
                "delivered Intake row was not read back".to_owned(),
            ))
        })?,
    })
}

fn validate_receive_request(request: &IntakeDeliveryRequest) -> Result<(), ApplicationError> {
    request
        .scope
        .validate()
        .map_err(ApplicationError::Planning)?;
    if request.scope.expected_revision.is_none() {
        return Err(ApplicationError::Invalid(
            "Intake delivery requires an expected project revision".to_owned(),
        ));
    }
    validate_read_scope(&request.scope)?;
    for (field, value) in [
        ("operation_id", request.operation_id.as_str()),
        ("delivery_key", request.delivery_key.as_str()),
        ("origin kind", request.origin.kind.as_str()),
        ("origin item ID", request.origin.item_id.as_str()),
        ("origin digest", request.origin.digest.as_str()),
        ("payload digest", request.payload_digest.as_str()),
        ("Intake content", request.payload.content.as_str()),
        ("captured_at", request.captured_at.as_str()),
    ] {
        validate_nonempty(field, value)?;
    }
    IntakeItemId::parse(request.intake_id.as_str().to_owned())
        .map_err(|error| ApplicationError::Invalid(error.to_string()))?;
    IntakeBucketId::parse(request.payload.bucket_id.as_str().to_owned())
        .map_err(|error| ApplicationError::Invalid(error.to_string()))?;
    if request.payload_digest != intake_delivery_payload_digest(&request.payload) {
        return Err(ApplicationError::Invalid(
            "Intake delivery payload digest does not match its frozen payload".to_owned(),
        ));
    }
    Ok(())
}

fn validate_read_scope(scope: &PlanningScope) -> Result<(), ApplicationError> {
    scope.validate().map_err(ApplicationError::Planning)?;
    if scope
        .session_id
        .as_deref()
        .is_none_or(|session| session.trim().is_empty())
    {
        return Err(ApplicationError::Invalid(
            "authenticated project session is required for Intake delivery".to_owned(),
        ));
    }
    Ok(())
}

fn validate_nonempty(field: &'static str, value: &str) -> Result<(), ApplicationError> {
    if value.trim().is_empty() {
        return Err(ApplicationError::Invalid(format!("{field} is required")));
    }
    Ok(())
}

fn intake_kind(value: IntakeKind) -> &'static str {
    match value {
        IntakeKind::Note => "note",
        IntakeKind::Discovery => "discovery",
        IntakeKind::Question => "question",
        IntakeKind::Revisit => "revisit",
    }
}
