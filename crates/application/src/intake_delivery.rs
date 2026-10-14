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
    /// read-only even when the current Intake row has since changed. It does
    /// not need a project revision because it performs no write; an unseen
    /// delivery is revision-checked by the store before it can be created.
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

#[cfg(test)]
mod tests {
    use super::*;
    use boreal_domain::ProjectId;
    use boreal_store::{SqliteStore, StoreError, V3MutationContext};

    const SCHEMA_V2: &str = include_str!("../../../project/spec/schema-v2.sql");

    fn setup() -> (SqliteStore, ProjectId) {
        let store = SqliteStore::open_in_memory(SCHEMA_V2).expect("open project store");
        let app = WorkApplication::new(&store);
        let project = ProjectId::new("project-intake-delivery");
        app.init_project(
            &project,
            "agent-1",
            "agent",
            "credential",
            "Intake delivery tests",
            "unix-ms:1",
            "op-init",
        )
        .expect("initialize project");
        app.ensure_work_model_v3().expect("install work-model/3");
        app.register_session_as(
            &project,
            "agent-1",
            "test-harness",
            "session-1",
            "unix-ms:2",
            "op-session",
        )
        .expect("register project session");
        let bucket = crate::IntakeBucket {
            id: IntakeBucketId::new("inbox"),
            project_id: project.clone(),
            name: "Inbox".to_owned(),
            archived: false,
        };
        let scope = PlanningScope::new(project.clone(), "agent-1")
            .at_revision(store.project_revision(project.as_str()).unwrap().0);
        app.create_intake_bucket_v3(&scope, "op-bucket", &bucket, "unix-ms:2")
            .expect("create Intake bucket");
        (store, project)
    }

    fn request(
        project: &ProjectId,
        expected_revision: Option<u64>,
        operation_id: &str,
        origin_digest: &str,
        content: &str,
    ) -> IntakeDeliveryRequest {
        let payload = IntakeDeliveryPayload {
            bucket_id: IntakeBucketId::new("inbox"),
            kind: IntakeKind::Discovery,
            content: content.to_owned(),
            revisit_at: None,
        };
        let mut scope = PlanningScope::new(project.clone(), "agent-1").with_session("session-1");
        if let Some(revision) = expected_revision {
            scope = scope.at_revision(revision);
        }
        IntakeDeliveryRequest {
            scope,
            operation_id: operation_id.to_owned(),
            delivery_key: "delivery-1".to_owned(),
            origin: IntakeDeliveryOrigin {
                kind: "global_inbox".to_owned(),
                item_id: "capture-1".to_owned(),
                digest: origin_digest.to_owned(),
            },
            intake_id: IntakeItemId::new("intake-1"),
            payload_digest: intake_delivery_payload_digest(&payload),
            payload,
            captured_at: "unix-ms:3".to_owned(),
        }
    }

    #[test]
    fn semantic_retry_without_revision_returns_the_edited_archived_promoted_intake_read_only() {
        let (store, project) = setup();
        let app = WorkApplication::new(&store);
        let initial_revision = store.project_revision(project.as_str()).unwrap().0;
        let original = request(
            &project,
            Some(initial_revision),
            "op-delivery",
            "sha256:origin-1",
            "original delivered content",
        );
        let created = app
            .receive_intake_delivery(&original)
            .expect("new delivery commits");
        assert!(created.operation.is_some());

        let promotion_scope = PlanningScope::new(project.clone(), "agent-1")
            .with_session("session-1")
            .at_revision(store.project_revision(project.as_str()).unwrap().0);
        app.promote_intake_v3(
            &promotion_scope,
            "op-promote",
            &crate::IntakePromotion {
                id: crate::PromotionId::new("promotion-1"),
                project_id: project.clone(),
                intake_id: IntakeItemId::new("intake-1"),
                intake_revision: created.intake.content_revision,
                intake_digest: created.intake.content_digest.clone(),
                target_kind: crate::PromotionTargetKind::DraftWork,
                target_id: "draft-task-1".to_owned(),
            },
            "unix-ms:4",
        )
        .expect("promote delivered Intake");

        let edited_content = "edited after delivery";
        let edited_digest = sha256_content_digest(edited_content.as_bytes());
        store
            .execute_batch(&format!(
                "UPDATE intake_item_v3
                 SET content = '{edited_content}', content_revision = 2,
                     content_digest = '{edited_digest}', updated_at = 'unix-ms:5'
                 WHERE project_id = '{}' AND intake_id = 'intake-1';",
                project.as_str()
            ))
            .expect("edit current Intake content");

        let archive_revision = store.project_revision(project.as_str()).unwrap().0;
        crate::KnowledgeParityApplication::new(&store)
            .update_intake_disposition(
                &V3MutationContext {
                    project_id: project.as_str().to_owned(),
                    actor_id: "agent-1".to_owned(),
                    session_id: Some("session-1".to_owned()),
                    operation_id: "op-archive".to_owned(),
                    request_digest: "sha256:archive-request".to_owned(),
                    expected_revision: Some(archive_revision),
                    now: "unix-ms:6".to_owned(),
                },
                "intake-1",
                2,
                crate::IntakeLifecycle::Archived,
                None,
            )
            .expect("archive edited Intake");

        let before_retry = app
            .intake_delivery_readback_for_intake(
                &PlanningScope::new(project.clone(), "agent-1").with_session("session-1"),
                "intake-1",
            )
            .expect("read current Intake and receipt");
        let retry_revision = store.project_revision(project.as_str()).unwrap().0;
        let mut retry = original.clone();
        retry.operation_id = "op-semantic-retry".to_owned();
        retry.scope.expected_revision = None;

        let resolved = app
            .receive_intake_delivery(&retry)
            .expect("semantic retry resolves without a project revision");
        assert_eq!(resolved.operation, None);
        assert_eq!(resolved.project_revision, retry_revision);
        assert_eq!(resolved.receipt, created.receipt);
        assert_eq!(resolved.intake, before_retry.intake.unwrap());
        assert_eq!(resolved.intake.content, edited_content);
        assert_eq!(resolved.intake.content_revision, 2);
        assert_eq!(resolved.intake.lifecycle, "archived");
        assert_eq!(
            store.project_revision(project.as_str()).unwrap().0,
            retry_revision
        );
        assert!(store.operation("op-semantic-retry").unwrap().is_none());
        assert!(store.audit_event("op-semantic-retry").unwrap().is_none());

        let mut changed_payload = retry.clone();
        changed_payload.operation_id = "op-changed-payload".to_owned();
        changed_payload.payload.content = "different frozen content".to_owned();
        changed_payload.payload_digest = intake_delivery_payload_digest(&changed_payload.payload);
        assert!(matches!(
            app.receive_intake_delivery(&changed_payload),
            Err(ApplicationError::Store(StoreError::Conflict(_)))
        ));

        let mut changed_origin = retry;
        changed_origin.operation_id = "op-changed-origin".to_owned();
        changed_origin.origin.digest = "sha256:other-origin".to_owned();
        assert!(matches!(
            app.receive_intake_delivery(&changed_origin),
            Err(ApplicationError::Store(StoreError::Conflict(_)))
        ));
        assert_eq!(
            store.project_revision(project.as_str()).unwrap().0,
            retry_revision
        );
    }

    #[test]
    fn unseen_delivery_requires_an_expected_revision_and_rejects_stale_revision_atomically() {
        let (store, project) = setup();
        let app = WorkApplication::new(&store);
        let current_revision = store.project_revision(project.as_str()).unwrap().0;

        let without_revision = request(
            &project,
            None,
            "op-no-revision",
            "sha256:origin-1",
            "new delivery",
        );
        assert!(matches!(
            app.receive_intake_delivery(&without_revision),
            Err(ApplicationError::Store(StoreError::Invalid(_)))
        ));

        let stale = request(
            &project,
            Some(current_revision.saturating_sub(1)),
            "op-stale-revision",
            "sha256:origin-1",
            "new delivery",
        );
        assert!(matches!(
            app.receive_intake_delivery(&stale),
            Err(ApplicationError::Store(StoreError::StaleRevision { .. }))
        ));

        let readback_scope =
            PlanningScope::new(project.clone(), "agent-1").with_session("session-1");
        let readback = app
            .intake_delivery_readback(&readback_scope, "delivery-1")
            .expect("read back missing delivery");
        assert!(readback.receipt.is_none());
        assert!(readback.intake.is_none());
        assert_eq!(
            store.project_revision(project.as_str()).unwrap().0,
            current_revision
        );
        assert!(store.operation("op-no-revision").unwrap().is_none());
        assert!(store.operation("op-stale-revision").unwrap().is_none());
    }
}
