//! Application policy for non-work intake and typed promotion.
//!
//! Intake is intentionally not represented as `WorkItem`.  These commands
//! preserve immutable content revisions and return plans for the store/source
//! adapters.  A promotion is valid only against the exact current revision and
//! digest; an adapter must make the plan and target creation one durable
//! operation or return a replayable unknown outcome.

use boreal_domain::work_model_v3::{
    validate_container_dispositions, validate_promotion, ContainerDisposition, IntakeBucket,
    IntakeBucketId, IntakeItem, IntakeItemId, IntakeKind, IntakeLifecycle, IntakePromotion,
    ModelError, PromotionId, PromotionTargetKind, WorkNode,
};
use boreal_domain::{ProjectId, TimestampMs};
use serde_json::json;

use crate::planning_v3::{PlannedOperation, PlanningError, PlanningScope};
use crate::{canonical_request_digest, ApplicationError, WorkApplication};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntakeSnapshot {
    pub project_id: ProjectId,
    pub revision: u64,
    pub buckets: Vec<IntakeBucket>,
    pub items: Vec<IntakeItem>,
    pub promotions: Vec<IntakePromotion>,
    pub dispositions: Vec<ContainerDisposition>,
}

impl IntakeSnapshot {
    fn scope(&self, scope: &PlanningScope) -> Result<(), PlanningError> {
        scope.validate()?;
        if scope.project_id != self.project_id {
            return Err(PlanningError::ScopeConflict {
                expected: self.project_id.to_string(),
                actual: scope.project_id.to_string(),
            });
        }
        scope.require_revision(self.revision)
    }

    fn bucket(&self, id: &IntakeBucketId) -> Result<&IntakeBucket, PlanningError> {
        self.buckets
            .iter()
            .find(|bucket| &bucket.id == id)
            .ok_or_else(|| PlanningError::Invalid(format!("intake bucket not found: {id}")))
    }

    fn item(&self, id: &IntakeItemId) -> Result<&IntakeItem, PlanningError> {
        self.items
            .iter()
            .find(|item| &item.id == id)
            .ok_or_else(|| PlanningError::Invalid(format!("intake item not found: {id}")))
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntakeCaptureRequest {
    pub scope: PlanningScope,
    pub operation_id: String,
    pub bucket_id: IntakeBucketId,
    pub intake_id: IntakeItemId,
    pub kind: IntakeKind,
    pub content: String,
    pub captured_at: TimestampMs,
    pub revisit_at: Option<TimestampMs>,
}

pub fn plan_intake_capture(
    snapshot: &IntakeSnapshot,
    request: &IntakeCaptureRequest,
) -> Result<PlannedOperation<IntakeItem>, PlanningError> {
    snapshot.scope(&request.scope)?;
    let bucket = snapshot.bucket(&request.bucket_id)?;
    if bucket.archived {
        return Err(PlanningError::Invalid(
            "cannot capture into an archived bucket".to_owned(),
        ));
    }
    if request.content.trim().is_empty() {
        return Err(PlanningError::Invalid(
            "intake content cannot be empty".to_owned(),
        ));
    }
    if snapshot
        .items
        .iter()
        .any(|item| item.id == request.intake_id)
    {
        return Err(PlanningError::Invalid(
            "intake ID already exists".to_owned(),
        ));
    }
    let item = IntakeItem {
        id: request.intake_id.clone(),
        bucket_id: request.bucket_id.clone(),
        project_id: request.scope.project_id.clone(),
        kind: request.kind,
        lifecycle: IntakeLifecycle::Captured,
        content: request.content.clone(),
        content_revision: 1,
        content_digest: crate::sha256_content_digest(request.content.as_bytes()),
        revisit_at: request.revisit_at,
    };
    let digest = canonical_request_digest(
        "intake.capture/v3",
        json!({
            "project_id": request.scope.project_id.as_str(),
            "actor_id": request.scope.actor_id,
            "session_id": request.scope.session_id,
            "bucket_id": request.bucket_id.as_str(),
            "intake_id": request.intake_id.as_str(),
            "kind": format!("{:?}", request.kind).to_ascii_lowercase(),
            "content_digest": item.content_digest,
            "captured_at": request.captured_at.as_millis(),
            "revisit_at": request.revisit_at.map(TimestampMs::as_millis),
            "expected_revision": snapshot.revision,
        }),
    );
    Ok(PlannedOperation {
        operation_id: request.operation_id.clone(),
        request_digest: digest,
        project_id: request.scope.project_id.clone(),
        actor_id: request.scope.actor_id.clone(),
        session_id: request.scope.session_id.clone(),
        expected_revision: snapshot.revision,
        value: item,
    })
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntakeUpdateRequest {
    pub scope: PlanningScope,
    pub operation_id: String,
    pub intake_id: IntakeItemId,
    pub expected_content_revision: u64,
    pub content: Option<String>,
    pub lifecycle: Option<IntakeLifecycle>,
    pub revisit_at: Option<Option<TimestampMs>>,
}

pub fn plan_intake_update(
    snapshot: &IntakeSnapshot,
    request: &IntakeUpdateRequest,
) -> Result<PlannedOperation<IntakeItem>, PlanningError> {
    snapshot.scope(&request.scope)?;
    let mut item = snapshot.item(&request.intake_id)?.clone();
    if item.content_revision != request.expected_content_revision {
        return Err(PlanningError::RevisionConflict {
            expected: request.expected_content_revision,
            actual: item.content_revision,
        });
    }
    if let Some(content) = &request.content {
        if content.trim().is_empty() {
            return Err(PlanningError::Invalid(
                "intake content cannot be empty".to_owned(),
            ));
        }
        item.content = content.clone();
        item.content_revision = item
            .content_revision
            .checked_add(1)
            .ok_or_else(|| PlanningError::Invalid("intake revision overflow".to_owned()))?;
        item.content_digest = crate::sha256_content_digest(content.as_bytes());
    }
    if let Some(revisit_at) = request.revisit_at {
        item.revisit_at = revisit_at;
    }
    if let Some(lifecycle) = request.lifecycle {
        item.transition(lifecycle)?;
    }
    if item.lifecycle == IntakeLifecycle::Deferred && item.revisit_at.is_none() {
        return Err(PlanningError::Domain(ModelError::DeferredWithoutRevisit));
    }
    let digest = canonical_request_digest(
        "intake.update/v3",
        json!({
            "project_id": request.scope.project_id.as_str(),
            "actor_id": request.scope.actor_id,
            "intake_id": request.intake_id.as_str(),
            "expected_content_revision": request.expected_content_revision,
            "new_content_digest": item.content_digest,
            "lifecycle": format!("{:?}", item.lifecycle).to_ascii_lowercase(),
            "revisit_at": item.revisit_at.map(TimestampMs::as_millis),
            "expected_snapshot_revision": snapshot.revision,
        }),
    );
    Ok(PlannedOperation {
        operation_id: request.operation_id.clone(),
        request_digest: digest,
        project_id: request.scope.project_id.clone(),
        actor_id: request.scope.actor_id.clone(),
        session_id: request.scope.session_id.clone(),
        expected_revision: snapshot.revision,
        value: item,
    })
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntakePromotionRequest {
    pub scope: PlanningScope,
    pub operation_id: String,
    pub promotion_id: PromotionId,
    pub intake_id: IntakeItemId,
    pub target_kind: PromotionTargetKind,
    pub target_id: String,
}

pub fn plan_intake_promotion(
    snapshot: &IntakeSnapshot,
    request: &IntakePromotionRequest,
) -> Result<PlannedOperation<IntakePromotion>, PlanningError> {
    snapshot.scope(&request.scope)?;
    let item = snapshot.item(&request.intake_id)?;
    let promotion = IntakePromotion {
        id: request.promotion_id.clone(),
        project_id: request.scope.project_id.clone(),
        intake_id: request.intake_id.clone(),
        intake_revision: item.content_revision,
        intake_digest: item.content_digest.clone(),
        target_kind: request.target_kind,
        target_id: request.target_id.clone(),
    };
    validate_promotion(item, &promotion)?;
    if snapshot
        .promotions
        .iter()
        .any(|existing| existing == &promotion)
    {
        return Err(PlanningError::Invalid(
            "promotion already exists; replay its operation".to_owned(),
        ));
    }
    let digest = canonical_request_digest(
        "intake.promote/v3",
        json!({
            "project_id": request.scope.project_id.as_str(),
            "actor_id": request.scope.actor_id,
            "intake_id": request.intake_id.as_str(),
            "intake_revision": item.content_revision,
            "intake_digest": item.content_digest,
            "target_kind": format!("{:?}", request.target_kind).to_ascii_lowercase(),
            "target_id": request.target_id,
            "expected_snapshot_revision": snapshot.revision,
        }),
    );
    Ok(PlannedOperation {
        operation_id: request.operation_id.clone(),
        request_digest: digest,
        project_id: request.scope.project_id.clone(),
        actor_id: request.scope.actor_id.clone(),
        session_id: request.scope.session_id.clone(),
        expected_revision: snapshot.revision,
        value: promotion,
    })
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DispositionRequest {
    pub scope: PlanningScope,
    pub operation_id: String,
    pub disposition: ContainerDisposition,
    pub container: WorkNode,
    pub descendants: Vec<WorkNode>,
    pub current: Vec<ContainerDisposition>,
}

pub fn plan_disposition(
    request: &DispositionRequest,
) -> Result<PlannedOperation<ContainerDisposition>, PlanningError> {
    request.scope.validate()?;
    let expected_revision = request.scope.expected_revision.ok_or_else(|| {
        PlanningError::Invalid("v3 disposition requires expected_revision".to_owned())
    })?;
    if request.disposition.project_id != request.scope.project_id
        || request.container.project_id != request.scope.project_id
    {
        return Err(PlanningError::ScopeConflict {
            expected: request.scope.project_id.to_string(),
            actual: request.disposition.project_id.to_string(),
        });
    }
    let mut all = request.current.clone();
    all.push(request.disposition.clone());
    validate_container_dispositions(&request.container, &request.descendants, &all)?;
    let digest = canonical_request_digest(
        "container.disposition/v3",
        json!({
            "project_id": request.scope.project_id.as_str(),
            "actor_id": request.scope.actor_id,
            "container_id": request.disposition.container_id.as_str(),
            "descendant_id": request.disposition.descendant_id.as_str(),
            "kind": format!("{:?}", request.disposition.kind).to_ascii_lowercase(),
            "descendant_revision": request.disposition.descendant_revision,
            "descendant_outcome_digest": request.disposition.descendant_outcome_digest,
            "supersedes_id": request.disposition.supersedes_id.as_ref().map(ToString::to_string),
            "expected_snapshot_revision": request.scope.expected_revision,
        }),
    );
    Ok(PlannedOperation {
        operation_id: request.operation_id.clone(),
        request_digest: digest,
        project_id: request.scope.project_id.clone(),
        actor_id: request.scope.actor_id.clone(),
        session_id: request.scope.session_id.clone(),
        expected_revision,
        value: request.disposition.clone(),
    })
}

impl WorkApplication<'_> {
    pub fn plan_intake_capture(
        &self,
        snapshot: &IntakeSnapshot,
        request: &IntakeCaptureRequest,
    ) -> Result<PlannedOperation<IntakeItem>, ApplicationError> {
        plan_intake_capture(snapshot, request).map_err(ApplicationError::from)
    }

    pub fn plan_intake_update(
        &self,
        snapshot: &IntakeSnapshot,
        request: &IntakeUpdateRequest,
    ) -> Result<PlannedOperation<IntakeItem>, ApplicationError> {
        plan_intake_update(snapshot, request).map_err(ApplicationError::from)
    }

    pub fn plan_intake_promotion(
        &self,
        snapshot: &IntakeSnapshot,
        request: &IntakePromotionRequest,
    ) -> Result<PlannedOperation<IntakePromotion>, ApplicationError> {
        plan_intake_promotion(snapshot, request).map_err(ApplicationError::from)
    }

    pub fn plan_container_disposition(
        &self,
        request: &DispositionRequest,
    ) -> Result<PlannedOperation<ContainerDisposition>, ApplicationError> {
        plan_disposition(request).map_err(ApplicationError::from)
    }
}

/// A compact application-side target descriptor used by source/memory
/// adapters.  The actual target creation remains owned by those crates; this
/// contract carries the immutable intake provenance they must retain.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PromotionTarget {
    pub project_id: ProjectId,
    pub intake_id: IntakeItemId,
    pub intake_revision: u64,
    pub intake_digest: String,
    pub target_kind: PromotionTargetKind,
    pub target_id: String,
}

impl From<&IntakePromotion> for PromotionTarget {
    fn from(promotion: &IntakePromotion) -> Self {
        Self {
            project_id: promotion.project_id.clone(),
            intake_id: promotion.intake_id.clone(),
            intake_revision: promotion.intake_revision,
            intake_digest: promotion.intake_digest.clone(),
            target_kind: promotion.target_kind,
            target_id: promotion.target_id.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use boreal_domain::work_model_v3::{DispositionKind, ExecutionMode, IntakeStatus};
    use boreal_domain::WorkId;

    fn snapshot() -> IntakeSnapshot {
        IntakeSnapshot {
            project_id: ProjectId::new("p1"),
            revision: 3,
            buckets: vec![IntakeBucket {
                id: IntakeBucketId::new("inbox"),
                project_id: ProjectId::new("p1"),
                name: "Inbox".into(),
                archived: false,
            }],
            items: Vec::new(),
            promotions: Vec::new(),
            dispositions: Vec::new(),
        }
    }

    fn scope() -> PlanningScope {
        PlanningScope::new(ProjectId::new("p1"), "operator").at_revision(3)
    }

    #[test]
    fn capture_update_and_revisit_status_are_revision_bound() {
        let request = IntakeCaptureRequest {
            scope: scope(),
            operation_id: "capture".into(),
            bucket_id: IntakeBucketId::new("inbox"),
            intake_id: IntakeItemId::new("i1"),
            kind: IntakeKind::Revisit,
            content: "check DST".into(),
            captured_at: TimestampMs::from_millis(10),
            revisit_at: None,
        };
        let item = plan_intake_capture(&snapshot(), &request).unwrap().value;
        assert_eq!(
            item.status_at(TimestampMs::from_millis(10)),
            IntakeStatus::Inbox
        );
        let mut state = snapshot();
        state.items.push(item);
        let update = IntakeUpdateRequest {
            scope: scope(),
            operation_id: "update".into(),
            intake_id: IntakeItemId::new("i1"),
            expected_content_revision: 1,
            content: Some("check DST twice".into()),
            lifecycle: Some(IntakeLifecycle::Deferred),
            revisit_at: Some(Some(TimestampMs::from_millis(100))),
        };
        let updated = plan_intake_update(&state, &update).unwrap().value;
        assert_eq!(updated.content_revision, 2);
        assert_eq!(
            updated.status_at(TimestampMs::from_millis(100)),
            IntakeStatus::RevisitDue
        );
        state.items[0] = updated;
        let stale = IntakeUpdateRequest {
            expected_content_revision: 1,
            ..update
        };
        assert!(matches!(
            plan_intake_update(&state, &stale),
            Err(PlanningError::RevisionConflict { .. })
        ));
    }

    #[test]
    fn promotion_binds_current_content_and_disposition_is_append_only() {
        let mut state = snapshot();
        let capture = IntakeCaptureRequest {
            scope: scope(),
            operation_id: "capture".into(),
            bucket_id: IntakeBucketId::new("inbox"),
            intake_id: IntakeItemId::new("i1"),
            kind: IntakeKind::Discovery,
            content: "found a thing".into(),
            captured_at: TimestampMs::from_millis(10),
            revisit_at: None,
        };
        state
            .items
            .push(plan_intake_capture(&state, &capture).unwrap().value);
        let promotion = IntakePromotionRequest {
            scope: scope(),
            operation_id: "promote".into(),
            promotion_id: PromotionId::new("p1"),
            intake_id: IntakeItemId::new("i1"),
            target_kind: PromotionTargetKind::DraftWork,
            target_id: "w1".into(),
        };
        let planned = plan_intake_promotion(&state, &promotion).unwrap();
        assert_eq!(planned.value.intake_revision, 1);
        state.promotions.push(planned.value.clone());
        assert!(plan_intake_promotion(&state, &promotion).is_err());

        let container = WorkNode::milestone(ProjectId::new("p1"), WorkId::new("m"), "M");
        let child = WorkNode::task(
            ProjectId::new("p1"),
            WorkId::new("t"),
            ExecutionMode::Direct,
            Some(WorkId::new("m")),
            "T",
        );
        let disposition = ContainerDisposition {
            id: boreal_domain::work_model_v3::CloseoutDispositionId::new("d1"),
            container_id: WorkId::new("m"),
            descendant_id: WorkId::new("t"),
            project_id: ProjectId::new("p1"),
            kind: DispositionKind::AcceptedClosed,
            descendant_revision: 3,
            descendant_outcome_digest: "sha256:outcome".into(),
            replacement_id: None,
            reason: None,
            supersedes_id: None,
        };
        let request = DispositionRequest {
            scope: scope(),
            operation_id: "dispose".into(),
            disposition,
            container,
            descendants: vec![child],
            current: Vec::new(),
        };
        assert!(plan_disposition(&request).is_ok());
    }

    #[test]
    fn disposition_requires_reason_for_defer_or_replace() {
        let container = WorkNode::milestone(ProjectId::new("p1"), WorkId::new("m"), "M");
        let child = WorkNode::task(
            ProjectId::new("p1"),
            WorkId::new("t"),
            ExecutionMode::Direct,
            Some(WorkId::new("m")),
            "T",
        );
        let disposition = ContainerDisposition {
            id: boreal_domain::work_model_v3::CloseoutDispositionId::new("d1"),
            container_id: WorkId::new("m"),
            descendant_id: WorkId::new("t"),
            project_id: ProjectId::new("p1"),
            kind: DispositionKind::Deferred,
            descendant_revision: 3,
            descendant_outcome_digest: "sha256:outcome".into(),
            replacement_id: None,
            reason: None,
            supersedes_id: None,
        };
        let request = DispositionRequest {
            scope: scope(),
            operation_id: "dispose".into(),
            disposition,
            container,
            descendants: vec![child],
            current: Vec::new(),
        };
        assert!(matches!(
            plan_disposition(&request),
            Err(PlanningError::Domain(_))
        ));
    }
}
