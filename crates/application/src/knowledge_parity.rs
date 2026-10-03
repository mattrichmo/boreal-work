//! Application boundary for project decisions, cited knowledge claims,
//! bounded context retrieval, and source-backed intake disposition.
//!
//! Policy is validated here; the store owns the revision/audit transaction.

use boreal_domain::work_model_v3::{
    IntakeItem, IntakeItemId, IntakeKind, IntakeLifecycle, IntakePromotion,
};
use boreal_domain::{ProjectId, TimestampMs, WorkItem};
use boreal_store::{
    KnowledgeClaimRecord, KnowledgeClaimReviewRecord, KnowledgeDecisionRecord, MutationResult,
    SqliteStore, V3MutationContext,
};
use serde_json::{json, Value};

use crate::{
    canonical_request_digest, sha256_content_digest, ApplicationError, IntakePromotionRequest,
};

pub struct KnowledgeParityApplication<'a> {
    store: &'a SqliteStore,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DecisionInput {
    pub decision_id: String,
    pub title: String,
    pub body: String,
    pub rationale: String,
    pub source_version_id: Option<String>,
    pub supersedes_id: Option<String>,
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClaimInput {
    pub claim_id: String,
    pub statement: String,
    pub source_version_id: String,
    pub citation_location: String,
    pub supersedes_id: Option<String>,
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClaimReviewInput {
    pub review_id: String,
    pub claim_id: String,
    pub decision: String,
    pub reason: String,
}

impl<'a> KnowledgeParityApplication<'a> {
    pub fn new(store: &'a SqliteStore) -> Self {
        Self { store }
    }

    pub fn decision(
        &self,
        project: &str,
        id: &str,
    ) -> Result<Option<KnowledgeDecisionRecord>, ApplicationError> {
        self.store
            .knowledge_decision(project, id)
            .map_err(ApplicationError::from)
    }
    pub fn decisions(
        &self,
        project: &str,
        limit: u64,
        offset: u64,
    ) -> Result<Vec<KnowledgeDecisionRecord>, ApplicationError> {
        self.store
            .list_knowledge_decisions(project, limit, offset)
            .map_err(ApplicationError::from)
    }
    pub fn decision_page(
        &self,
        project: &str,
        limit: u64,
        offset: u64,
    ) -> Result<(u64, Vec<KnowledgeDecisionRecord>), ApplicationError> {
        self.store
            .knowledge_decision_page(project, limit, offset)
            .map_err(ApplicationError::from)
    }
    pub fn decision_detail(
        &self,
        project: &str,
        id: &str,
    ) -> Result<(u64, Option<KnowledgeDecisionRecord>, bool), ApplicationError> {
        self.store
            .knowledge_decision_detail(project, id)
            .map_err(ApplicationError::from)
    }
    pub fn decision_is_superseded(
        &self,
        project: &str,
        id: &str,
    ) -> Result<bool, ApplicationError> {
        self.store
            .knowledge_decision_superseded(project, id)
            .map_err(ApplicationError::from)
    }
    pub fn claim(
        &self,
        project: &str,
        id: &str,
    ) -> Result<Option<KnowledgeClaimRecord>, ApplicationError> {
        self.store
            .knowledge_claim(project, id)
            .map_err(ApplicationError::from)
    }
    pub fn claims(
        &self,
        project: &str,
        limit: u64,
        offset: u64,
    ) -> Result<Vec<KnowledgeClaimRecord>, ApplicationError> {
        self.store
            .list_knowledge_claims(project, limit, offset)
            .map_err(ApplicationError::from)
    }
    pub fn claim_page(
        &self,
        project: &str,
        limit: u64,
        offset: u64,
    ) -> Result<(u64, Vec<KnowledgeClaimRecord>), ApplicationError> {
        self.store
            .knowledge_claim_page(project, limit, offset)
            .map_err(ApplicationError::from)
    }
    pub fn claim_page_full(
        &self,
        project: &str,
        limit: u64,
        offset: u64,
    ) -> Result<
        (
            u64,
            Vec<(KnowledgeClaimRecord, Vec<KnowledgeClaimReviewRecord>)>,
        ),
        ApplicationError,
    > {
        self.store
            .knowledge_claim_page_full(project, limit, offset)
            .map_err(ApplicationError::from)
    }
    pub fn claim_detail(
        &self,
        project: &str,
        id: &str,
    ) -> Result<
        (
            u64,
            Option<KnowledgeClaimRecord>,
            Vec<KnowledgeClaimReviewRecord>,
        ),
        ApplicationError,
    > {
        self.store
            .knowledge_claim_detail(project, id)
            .map_err(ApplicationError::from)
    }
    pub fn claim_reviews(
        &self,
        project: &str,
        id: &str,
    ) -> Result<Vec<KnowledgeClaimReviewRecord>, ApplicationError> {
        self.store
            .knowledge_claim_reviews(project, id)
            .map_err(ApplicationError::from)
    }
    pub fn source_version(
        &self,
        project: &str,
        id: &str,
    ) -> Result<Option<boreal_store::SourceVersionRecord>, ApplicationError> {
        self.store
            .source_version(project, id)
            .map_err(ApplicationError::from)
    }
    pub fn intake_item(
        &self,
        project: &str,
        id: &str,
    ) -> Result<Option<boreal_store::IntakeItemV3Record>, ApplicationError> {
        self.store
            .intake_item_v3(project, id)
            .map_err(ApplicationError::from)
    }
    pub fn project_revision(&self, project: &str) -> Result<u64, ApplicationError> {
        Ok(self.store.project_revision(project)?.0)
    }

    pub fn create_decision(
        &self,
        context: &V3MutationContext,
        input: DecisionInput,
    ) -> Result<MutationResult, ApplicationError> {
        require_text("decision title", &input.title)?;
        require_text("decision body", &input.body)?;
        require_text("decision rationale", &input.rationale)?;
        bounded("decision title", &input.title, 512)?;
        bounded("decision body", &input.body, 64 * 1024)?;
        bounded("decision rationale", &input.rationale, 16 * 1024)?;
        self.store
            .create_knowledge_decision(
                context,
                &KnowledgeDecisionRecord {
                    project_id: context.project_id.clone(),
                    decision_id: input.decision_id,
                    title: input.title,
                    body: input.body,
                    rationale: input.rationale,
                    source_version_id: input.source_version_id,
                    supersedes_id: input.supersedes_id,
                    actor_id: context.actor_id.clone(),
                    operation_id: context.operation_id.clone(),
                    project_revision: 0,
                    created_at: context.now.clone(),
                },
            )
            .map_err(ApplicationError::from)
    }

    pub fn create_claim(
        &self,
        context: &V3MutationContext,
        input: ClaimInput,
    ) -> Result<MutationResult, ApplicationError> {
        require_text("claim statement", &input.statement)?;
        require_text("citation location", &input.citation_location)?;
        bounded("claim statement", &input.statement, 16 * 1024)?;
        bounded("citation location", &input.citation_location, 2048)?;
        let content_digest=sha256_content_digest(json!({"statement":input.statement,"source_version_id":input.source_version_id,"citation_location":input.citation_location}).to_string().as_bytes());
        self.store
            .create_knowledge_claim(
                context,
                &KnowledgeClaimRecord {
                    project_id: context.project_id.clone(),
                    claim_id: input.claim_id,
                    statement: input.statement,
                    content_digest,
                    source_version_id: input.source_version_id,
                    citation_location: input.citation_location,
                    supersedes_id: input.supersedes_id,
                    actor_id: context.actor_id.clone(),
                    operation_id: context.operation_id.clone(),
                    project_revision: 0,
                    created_at: context.now.clone(),
                },
            )
            .map_err(ApplicationError::from)
    }

    pub fn review_claim(
        &self,
        context: &V3MutationContext,
        input: ClaimReviewInput,
    ) -> Result<MutationResult, ApplicationError> {
        require_text("review reason", &input.reason)?;
        bounded("review reason", &input.reason, 4096)?;
        self.store
            .review_knowledge_claim(
                context,
                &KnowledgeClaimReviewRecord {
                    project_id: context.project_id.clone(),
                    review_id: input.review_id,
                    claim_id: input.claim_id,
                    decision: input.decision,
                    reason: input.reason,
                    actor_id: context.actor_id.clone(),
                    operation_id: context.operation_id.clone(),
                    project_revision: 0,
                    created_at: context.now.clone(),
                },
            )
            .map_err(ApplicationError::from)
    }

    /// Provides a consistent, project-bounded capsule. Free text remains data;
    /// callers must not treat retrieved material as executable authority.
    pub fn context(
        &self,
        project: &str,
        query: Option<&str>,
        limit: usize,
    ) -> Result<Value, ApplicationError> {
        if project.trim().is_empty() || limit == 0 || limit > 100 {
            return Err(ApplicationError::Invalid(
                "context requires project and a limit of 1..=100".into(),
            ));
        }
        let mut capsule = self
            .store
            .knowledge_context_snapshot(project, 100, 0, None)?;
        let query = query.map(str::to_lowercase);
        let keys = [
            ("work", &["title", "description", "id"][..]),
            (
                "dependencies",
                &["prerequisite_id", "dependent_id", "exception_reason"][..],
            ),
            ("active_attempts", &["work_id", "actor_id", "state"][..]),
            ("receipts", &["work_id", "receipt_id", "gate_id"][..]),
            ("sources", &["origin", "digest"][..]),
            ("decisions", &["title", "body", "rationale"][..]),
            ("claims", &["statement"][..]),
            ("intake", &["content", "id"][..]),
            ("memory", &["title", "body"][..]),
        ];
        for (kind, fields) in keys {
            let rows = capsule
                .get_mut(kind)
                .and_then(Value::as_array_mut)
                .ok_or_else(|| ApplicationError::Invalid("context snapshot is malformed".into()))?;
            if let Some(query) = &query {
                rows.retain(|row| {
                    fields.iter().any(|field| {
                        row.get(field)
                            .and_then(Value::as_str)
                            .is_some_and(|s| s.to_lowercase().contains(query))
                    })
                });
            }
            rows.truncate(limit);
        }
        capsule["query"] = query.map(Value::String).unwrap_or(Value::Null);
        capsule["limits"] = json!({"per_kind":limit});
        capsule["provenance"] = json!({"store_revision":capsule["revision"],"project_scoped":true,"retrieval":"boreal.knowledge-context/1"});
        Ok(capsule)
    }

    pub fn context_for_work(
        &self,
        project: &str,
        work_id: &str,
        query: Option<&str>,
        limit: usize,
    ) -> Result<Value, ApplicationError> {
        let mut capsule = self.context(project, query, limit)?;
        let revision = capsule["revision"]
            .as_u64()
            .ok_or_else(|| ApplicationError::Invalid("context capsule has no revision".into()))?;
        let work =
            crate::WorkApplication::new(self.store).show_work(&ProjectId::new(project), work_id)?;
        let actual = self.store.project_revision(project)?.0;
        if actual != revision {
            return Err(ApplicationError::Store(
                boreal_store::StoreError::StaleRevision {
                    expected: revision,
                    actual,
                },
            ));
        }
        let mut lineage = Vec::new();
        let mut parent = work.parent_id.clone();
        for _ in 0..16 {
            let Some(parent_id) = parent else { break };
            let ancestor = crate::WorkApplication::new(self.store)
                .show_work(&ProjectId::new(project), &parent_id)?;
            parent = ancestor.parent_id.clone();
            lineage.push(json!({"work_id":ancestor.work_id,"parent_id":ancestor.parent_id,"kind":ancestor.kind,"lifecycle":ancestor.lifecycle,"title":ancestor.title,"description":ancestor.description}));
        }
        for key in ["dependencies", "active_attempts", "receipts"] {
            if let Some(rows) = capsule.get_mut(key).and_then(Value::as_array_mut) {
                rows.retain(|row| {
                    row.get("work_id").and_then(Value::as_str) == Some(work_id)
                        || (key == "dependencies"
                            && (row.get("prerequisite_id").and_then(Value::as_str)
                                == Some(work_id)
                                || row.get("dependent_id").and_then(Value::as_str)
                                    == Some(work_id)))
                });
            }
        }
        let current_attempt = capsule["active_attempts"]
            .as_array()
            .and_then(|rows| rows.iter().find(|row| row["work_id"] == work_id))
            .cloned();
        capsule["focus_work"] = json!({"work_id":work.work_id,"project_id":work.project_id,"kind":work.kind,"parent_id":work.parent_id,"parent_lineage":lineage,"lifecycle":work.lifecycle,"dispatch_policy":work.dispatch_policy,"priority":work.priority,"hard_holds":work.hard_holds.iter().map(|hold|hold.stable_code()).collect::<Vec<_>>(),"title":work.title,"description":work.description,"current_attempt":current_attempt,"snapshot_revision":revision,"status_authority":"live store"});
        Ok(capsule)
    }

    pub fn update_intake_disposition(
        &self,
        context: &V3MutationContext,
        intake_id: &str,
        expected_content_revision: u64,
        lifecycle: IntakeLifecycle,
        revisit_at_utc_ms: Option<i64>,
    ) -> Result<MutationResult, ApplicationError> {
        let record = self
            .store
            .intake_item_v3(&context.project_id, intake_id)?
            .ok_or_else(|| {
                ApplicationError::Invalid("intake item not found in this project".into())
            })?;
        let kind = match record.kind.as_str() {
            "note" => IntakeKind::Note,
            "discovery" => IntakeKind::Discovery,
            "question" => IntakeKind::Question,
            "revisit" => IntakeKind::Revisit,
            _ => {
                return Err(ApplicationError::Invalid(
                    "stored intake kind is invalid".into(),
                ));
            }
        };
        let current = match record.lifecycle.as_str() {
            "captured" => IntakeLifecycle::Captured,
            "triaged" => IntakeLifecycle::Triaged,
            "deferred" => IntakeLifecycle::Deferred,
            "resolved" => IntakeLifecycle::Resolved,
            "archived" => IntakeLifecycle::Archived,
            _ => {
                return Err(ApplicationError::Invalid(
                    "stored intake lifecycle is invalid".into(),
                ));
            }
        };
        let existing_revisit = record
            .revisit_at_utc_ms
            .map(|v| u64::try_from(v).map(TimestampMs::from_millis))
            .transpose()
            .map_err(|_| {
                ApplicationError::Invalid("stored revisit timestamp is negative".into())
            })?;
        let requested_revisit = revisit_at_utc_ms
            .map(|v| u64::try_from(v).map(TimestampMs::from_millis))
            .transpose()
            .map_err(|_| {
                ApplicationError::Invalid(
                    "revisit time must be a non-negative millisecond timestamp".into(),
                )
            })?;
        let item = IntakeItem {
            id: IntakeItemId::new(record.intake_id),
            bucket_id: crate::IntakeBucketId::new(record.bucket_id),
            project_id: ProjectId::new(record.project_id),
            kind,
            lifecycle: current,
            content: record.content,
            content_revision: record.content_revision,
            content_digest: record.content_digest,
            revisit_at: existing_revisit,
        };
        let revision = self.store.project_revision(&context.project_id)?.0;
        let scope = crate::PlanningScope {
            project_id: ProjectId::new(context.project_id.clone()),
            actor_id: context.actor_id.clone(),
            session_id: context.session_id.clone(),
            expected_revision: context.expected_revision,
        };
        let snapshot = crate::IntakeSnapshot {
            project_id: scope.project_id.clone(),
            revision,
            buckets: Vec::new(),
            items: vec![item],
            promotions: Vec::new(),
            dispositions: Vec::new(),
        };
        let planned = crate::plan_intake_update(
            &snapshot,
            &crate::IntakeUpdateRequest {
                scope,
                operation_id: context.operation_id.clone(),
                intake_id: IntakeItemId::new(intake_id),
                expected_content_revision,
                lifecycle: Some(lifecycle),
                content: None,
                revisit_at: requested_revisit.map(Some),
            },
        )
        .map_err(ApplicationError::from)?;
        let lifecycle = match planned.value.lifecycle {
            IntakeLifecycle::Captured => "captured",
            IntakeLifecycle::Triaged => "triaged",
            IntakeLifecycle::Deferred => "deferred",
            IntakeLifecycle::Resolved => "resolved",
            IntakeLifecycle::Archived => "archived",
        };
        let revisit = planned
            .value
            .revisit_at
            .map(|v| i64::try_from(v.as_millis()))
            .transpose()
            .map_err(|_| ApplicationError::Invalid("revisit time exceeds SQLite range".into()))?;
        self.store
            .update_intake_disposition_v3(
                context,
                intake_id,
                expected_content_revision,
                lifecycle,
                revisit,
            )
            .map_err(ApplicationError::from)
    }

    /// Run the shared pure promotion planner against the exact current intake
    /// revision and digest before the hierarchy application commits the link.
    pub fn plan_current_intake_promotion(
        &self,
        scope: &crate::PlanningScope,
        operation_id: &str,
        promotion: &IntakePromotion,
    ) -> Result<crate::PlannedOperation<IntakePromotion>, ApplicationError> {
        let record = self
            .store
            .intake_item_v3(scope.project_id.as_str(), promotion.intake_id.as_str())?
            .ok_or_else(|| {
                ApplicationError::Invalid("intake item not found in this project".into())
            })?;
        let kind = match record.kind.as_str() {
            "note" => IntakeKind::Note,
            "discovery" => IntakeKind::Discovery,
            "question" => IntakeKind::Question,
            "revisit" => IntakeKind::Revisit,
            _ => {
                return Err(ApplicationError::Invalid(
                    "stored intake kind is invalid".into(),
                ));
            }
        };
        let lifecycle = match record.lifecycle.as_str() {
            "captured" => IntakeLifecycle::Captured,
            "triaged" => IntakeLifecycle::Triaged,
            "deferred" => IntakeLifecycle::Deferred,
            "resolved" => IntakeLifecycle::Resolved,
            "archived" => IntakeLifecycle::Archived,
            _ => {
                return Err(ApplicationError::Invalid(
                    "stored intake lifecycle is invalid".into(),
                ));
            }
        };
        let revisit_at = record
            .revisit_at_utc_ms
            .map(|v| u64::try_from(v).map(TimestampMs::from_millis))
            .transpose()
            .map_err(|_| {
                ApplicationError::Invalid("stored revisit timestamp is negative".into())
            })?;
        let item = IntakeItem {
            id: IntakeItemId::new(record.intake_id),
            bucket_id: crate::IntakeBucketId::new(record.bucket_id),
            project_id: ProjectId::new(record.project_id),
            kind,
            lifecycle,
            content: record.content,
            content_revision: record.content_revision,
            content_digest: record.content_digest,
            revisit_at,
        };
        let revision = self.store.project_revision(scope.project_id.as_str())?.0;
        let snapshot = crate::IntakeSnapshot {
            project_id: scope.project_id.clone(),
            revision,
            buckets: Vec::new(),
            items: vec![item],
            promotions: Vec::new(),
            dispositions: Vec::new(),
        };
        let request = IntakePromotionRequest {
            scope: scope.clone(),
            operation_id: operation_id.into(),
            promotion_id: promotion.id.clone(),
            intake_id: promotion.intake_id.clone(),
            target_kind: promotion.target_kind,
            target_id: promotion.target_id.clone(),
        };
        crate::plan_intake_promotion(&snapshot, &request).map_err(ApplicationError::from)
    }

    /// Promotion means linking a current inbox revision to a durable target.
    /// The target is resolved in the same project before the store transaction
    /// rechecks the source revision/digest and commits the provenance edge.
    pub fn promote_intake_link(
        &self,
        scope: &crate::PlanningScope,
        operation_id: &str,
        promotion: &IntakePromotion,
        now: &str,
    ) -> Result<crate::OperationResult<()>, ApplicationError> {
        let planned = self.plan_current_intake_promotion(scope, operation_id, promotion)?;
        match promotion.target_kind {
            boreal_domain::work_model_v3::PromotionTargetKind::DraftWork => {
                if self
                    .store
                    .work(scope.project_id.as_str(), &promotion.target_id)?
                    .is_none()
                {
                    return Err(ApplicationError::Invalid("draft_work promotion target must already exist in this project; create the work item first".into()));
                }
            }
            boreal_domain::work_model_v3::PromotionTargetKind::SourceVersion => {
                if self
                    .store
                    .source_version(scope.project_id.as_str(), &promotion.target_id)?
                    .is_none()
                {
                    return Err(ApplicationError::Invalid(
                        "source_version promotion target must already exist in this project".into(),
                    ));
                }
            }
            boreal_domain::work_model_v3::PromotionTargetKind::MemoryDraft => {
                if self
                    .store
                    .memory_draft(scope.project_id.as_str(), &promotion.target_id)?
                    .is_none()
                {
                    return Err(ApplicationError::Invalid(
                        "memory_draft promotion target must already exist in this project".into(),
                    ));
                }
            }
        }
        crate::WorkApplication::new(self.store).promote_intake_v3(
            scope,
            operation_id,
            &planned.value,
            now,
        )
    }

    /// Create a task-focused draft work target and preserve the current intake
    /// revision/digest in the same canonical store transaction.
    pub fn promote_intake_create_work(
        &self,
        scope: &crate::PlanningScope,
        operation_id: &str,
        promotion: &IntakePromotion,
        work: &WorkItem,
        now: &str,
    ) -> Result<crate::OperationResult<()>, ApplicationError> {
        let existing = self.store.operation(operation_id)?;
        if let Some(existing) = &existing {
            if existing.project_id != scope.project_id.as_str()
                || existing.command != "intake.promote.create_work"
            {
                return Err(ApplicationError::Invalid(
                    "operation ID is already bound to another project or command".into(),
                ));
            }
            if promotion.project_id != scope.project_id {
                return Err(ApplicationError::Invalid(
                    "promotion project does not match the planning scope".into(),
                ));
            }
        } else {
            self.plan_current_intake_promotion(scope, operation_id, promotion)?;
        }
        if promotion.target_kind != boreal_domain::work_model_v3::PromotionTargetKind::DraftWork
            || promotion.target_id != work.id.as_str()
            || work.project_id != scope.project_id
        {
            return Err(ApplicationError::Invalid(
                "created work must be the same-project draft_work promotion target".into(),
            ));
        }
        if work.title.trim().is_empty() || work.title.len() > 512 || work.description.len() > 65_536
        {
            return Err(ApplicationError::Invalid(
                "work title is required (maximum 512 bytes) and description is limited to 65536 bytes".into(),
            ));
        }
        if work.parent_id.is_none()
            && !matches!(
                work.kind,
                boreal_domain::WorkKind::Milestone | boreal_domain::WorkKind::Task
            )
        {
            return Err(ApplicationError::Invalid(
                "sprints require a parent; root work must be a milestone or task".into(),
            ));
        }
        let parent = work
            .parent_id
            .as_ref()
            .map(|id| self.store.work(scope.project_id.as_str(), id.as_str()))
            .transpose()?
            .flatten();
        if work.parent_id.is_some() && parent.is_none() {
            return Err(ApplicationError::Invalid(
                "work parent must exist in this project".into(),
            ));
        }
        let parent_item = parent.map(|record| {
            let kind = match record.kind.as_str() {
                "milestone" => boreal_domain::WorkKind::Milestone,
                "sprint" => boreal_domain::WorkKind::Sprint,
                _ => boreal_domain::WorkKind::Task,
            };
            WorkItem::new(
                ProjectId::new(record.project_id),
                boreal_domain::WorkId::new(record.work_id),
                kind,
                record.parent_id.map(boreal_domain::WorkId::new),
                record.title,
            )
        });
        crate::WorkApplication::new(self.store).validate_parent(work, parent_item.as_ref())?;

        let input = boreal_store::IntakePromotionV3Input {
            project_id: promotion.project_id.to_string(),
            promotion_id: promotion.id.to_string(),
            intake_id: promotion.intake_id.to_string(),
            intake_revision: promotion.intake_revision,
            intake_digest: promotion.intake_digest.clone(),
            target_kind: "draft_work".into(),
            target_id: promotion.target_id.clone(),
            actor_id: scope.actor_id.clone(),
            operation_id: operation_id.to_owned(),
            created_at: now.to_owned(),
        };
        let context = boreal_store::V3MutationContext {
            project_id: scope.project_id.to_string(),
            actor_id: scope.actor_id.clone(),
            session_id: scope.session_id.clone(),
            operation_id: operation_id.to_owned(),
            request_digest: canonical_request_digest(
                "intake.promote.create_work/v1",
                json!({
                    "project_id": scope.project_id.as_str(),
                    "intake_id": promotion.intake_id.as_str(),
                    "intake_revision": promotion.intake_revision,
                    "intake_digest": promotion.intake_digest,
                    "work_id": work.id.as_str(),
                    "expected_revision": scope.expected_revision,
                }),
            ),
            expected_revision: scope.expected_revision,
            now: now.to_owned(),
        };
        let mutation = self
            .store
            .create_work_and_promote_intake_v3(&context, &input, work)?;
        Ok(crate::OperationResult {
            operation_id: operation_id.to_owned(),
            snapshot_revision: mutation.revision,
            changed: !mutation.replayed,
            value: (),
        })
    }

    pub fn rebuild_search_index(
        &self,
        project: &str,
        index_path: impl AsRef<std::path::Path>,
    ) -> Result<Value, ApplicationError> {
        let mut capsule = self
            .store
            .knowledge_context_snapshot(project, 100, 0, None)?;
        let revision = capsule["revision"].as_u64().ok_or_else(|| {
            ApplicationError::Invalid("context projection has no revision".into())
        })?;
        let keys = [
            "work",
            "dependencies",
            "active_attempts",
            "receipts",
            "sources",
            "decisions",
            "claims",
            "intake",
            "memory",
        ];
        let mut offset = 100u64;
        loop {
            let page =
                self.store
                    .knowledge_context_snapshot(project, 100, offset, Some(revision))?;
            let mut more = false;
            for key in keys {
                let values = page[key].as_array().ok_or_else(|| {
                    ApplicationError::Invalid("context index page is malformed".into())
                })?;
                if !values.is_empty() {
                    more = true;
                    capsule[key]
                        .as_array_mut()
                        .ok_or_else(|| {
                            ApplicationError::Invalid("context index is malformed".into())
                        })?
                        .extend(values.iter().cloned());
                }
            }
            if !more {
                break;
            }
            offset = offset
                .checked_add(100)
                .ok_or_else(|| ApplicationError::Invalid("context index offset overflow".into()))?;
        }
        let documents = capsule
            .as_object()
            .ok_or_else(|| ApplicationError::Invalid("context projection malformed".into()))?;
        let bytes =
            serde_json::to_vec(documents).map_err(|e| ApplicationError::Invalid(e.to_string()))?;
        let digest = sha256_content_digest(&bytes);
        let parent = index_path.as_ref().parent().ok_or_else(|| {
            ApplicationError::Invalid("index path requires a parent directory".into())
        })?;
        std::fs::create_dir_all(parent)
            .map_err(|e| ApplicationError::Invalid(format!("create index directory: {e}")))?;
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| ApplicationError::Invalid(format!("system clock before epoch: {e}")))?
            .as_nanos();
        let base = index_path
            .as_ref()
            .file_name()
            .and_then(|s| s.to_str())
            .ok_or_else(|| ApplicationError::Invalid("index filename is not valid UTF-8".into()))?;
        let temp = parent.join(format!(".{base}.{}.{}.tmp", std::process::id(), stamp));
        std::fs::write(&temp, &bytes)
            .map_err(|e| ApplicationError::Invalid(format!("write search index: {e}")))?;
        std::fs::rename(&temp, index_path)
            .map_err(|e| ApplicationError::Invalid(format!("replace search index: {e}")))?;
        let document_count = keys
            .iter()
            .map(|key| capsule[*key].as_array().map_or(0, Vec::len))
            .sum::<usize>();
        Ok(
            json!({"project_id":project,"revision":revision,"document_count":document_count,"digest":digest,"rebuilt":true}),
        )
    }
}

fn require_text(field: &str, value: &str) -> Result<(), ApplicationError> {
    if value.trim().is_empty() {
        Err(ApplicationError::Invalid(format!("{field} is required")))
    } else {
        Ok(())
    }
}
fn bounded(field: &str, value: &str, max: usize) -> Result<(), ApplicationError> {
    if value.len() > max {
        Err(ApplicationError::Invalid(format!(
            "{field} exceeds {max} bytes"
        )))
    } else {
        Ok(())
    }
}

pub fn knowledge_operation_context(
    project: &str,
    actor: &str,
    session: &str,
    operation: &str,
    expected_revision: u64,
    now: &str,
) -> V3MutationContext {
    V3MutationContext {
        project_id: project.into(),
        actor_id: actor.into(),
        session_id: Some(session.into()),
        operation_id: operation.into(),
        request_digest: canonical_request_digest(
            "knowledge.parity/v1",
            json!({"project_id":project,"actor_id":actor,"session_id":session,"operation_id":operation}),
        ),
        expected_revision: Some(expected_revision),
        now: now.into(),
    }
}
