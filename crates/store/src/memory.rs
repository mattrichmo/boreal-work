//! Durable memory facts. Git remains the publication authority; SQLite binds
//! cited drafts, independent review and external-job admission to that effect.
use super::*;
use boreal_domain::ActorRole;
use serde_json::{json, Value};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MemoryDraftRecord {
    pub project_id: String,
    pub draft_id: String,
    pub entry_id: String,
    pub title: String,
    pub body: String,
    pub citations_json: String,
    pub content_digest: String,
    pub actor_id: String,
    pub project_revision: u64,
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MemoryReviewRecord {
    pub project_id: String,
    pub review_id: String,
    pub draft_id: String,
    pub content_digest: String,
    pub decision: String,
    pub reason: String,
    pub actor_id: String,
    pub project_revision: u64,
}
impl SqliteStore {
    pub fn record_memory_draft(
        &self,
        context: &V3MutationContext,
        draft: &MemoryDraftRecord,
    ) -> Result<MutationResult, StoreError> {
        if draft.project_id != context.project_id
            || draft.actor_id != context.actor_id
            || draft.draft_id.trim().is_empty()
        {
            return Err(StoreError::Invalid(
                "draft identity differs from authenticated context".into(),
            ));
        }
        let citations: Value = serde_json::from_str(&draft.citations_json)
            .map_err(|e| StoreError::Invalid(e.to_string()))?;
        let list = citations
            .as_array()
            .filter(|v| !v.is_empty())
            .ok_or_else(|| StoreError::Invalid("memory requires citations".into()))?;
        let payload = json!({"draft_id":draft.draft_id,"entry_id":draft.entry_id,"title":draft.title,"body":draft.body,"citations":citations});
        let digest = checksum(payload.to_string().as_bytes());
        if digest != draft.content_digest {
            return Err(StoreError::Invalid("draft content digest differs".into()));
        }
        let bound = context.with_payload(payload);
        self.fact_mutation(&bound,"memory.draft","memory_draft",&draft.draft_id,&[ActorRole::Agent,ActorRole::Operator],||{
            for citation in list {
                let id=citation.get("source_version_id").and_then(Value::as_str).ok_or_else(||StoreError::Invalid("citation source missing".into()))?;
                if citation.get("location").and_then(Value::as_str).is_none_or(|s|s.trim().is_empty()) {return Err(StoreError::Invalid("citation location missing".into()));}
                let source=self.source_version(&context.project_id,id)?.ok_or_else(||StoreError::Invalid("citation source not registered in this project".into()))?;
                if source.availability!="available" {return Err(StoreError::Conflict("citation source is unavailable".into()));}
            }
            let mut row=self.prepare("INSERT INTO boreal_memory_draft(project_id,draft_id,entry_id,title,body,citations_json,content_digest,actor_id,operation_id,project_revision,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)")?;
            row.bind_text(1,&draft.project_id)?;row.bind_text(2,&draft.draft_id)?;row.bind_text(3,&draft.entry_id)?;
            row.bind_text(4,&draft.title)?;row.bind_text(5,&draft.body)?;row.bind_text(6,&draft.citations_json)?;
            row.bind_text(7,&digest)?;row.bind_text(8,&context.actor_id)?;row.bind_text(9,&context.operation_id)?;
            row.bind_i64(10,self.project_revision(&context.project_id)?.0.checked_add(1).ok_or_else(||StoreError::Invalid("revision overflow".into()))?)?;
            row.bind_text(11,&context.now)?;row.run()
        })
    }
    pub fn memory_draft(
        &self,
        project: &str,
        draft: &str,
    ) -> Result<Option<MemoryDraftRecord>, StoreError> {
        let mut row=self.prepare("SELECT project_id,draft_id,entry_id,title,body,citations_json,content_digest,actor_id,project_revision FROM boreal_memory_draft WHERE project_id=?1 AND draft_id=?2")?;
        row.bind_text(1, project)?;
        row.bind_text(2, draft)?;
        if row.step()? != SQLITE_ROW {
            return Ok(None);
        }
        Ok(Some(MemoryDraftRecord {
            project_id: row.column_text(0)?,
            draft_id: row.column_text(1)?,
            entry_id: row.column_text(2)?,
            title: row.column_text(3)?,
            body: row.column_text(4)?,
            citations_json: row.column_text(5)?,
            content_digest: row.column_text(6)?,
            actor_id: row.column_text(7)?,
            project_revision: row.column_u64(8)?,
        }))
    }
    pub fn record_memory_review(
        &self,
        context: &V3MutationContext,
        draft_id: &str,
        decision: &str,
        reason: &str,
    ) -> Result<MutationResult, StoreError> {
        if !matches!(decision, "approved" | "rejected" | "revoked") || reason.trim().is_empty() {
            return Err(StoreError::Invalid(
                "typed memory decision and reason required".into(),
            ));
        }
        let bound =
            context.with_payload(json!({"draft_id":draft_id,"decision":decision,"reason":reason}));
        self.fact_mutation(&bound,"memory.review","memory_draft",draft_id,&[ActorRole::Reviewer,ActorRole::Operator],||{
            let draft=self.memory_draft(&context.project_id,draft_id)?.ok_or_else(||StoreError::Invalid("draft missing".into()))?;
            let (_,review_root)=self.principal_authority(&context.project_id,&context.actor_id)?;
            let producer_root=self.recorded_principal_root(&context.project_id,&draft.actor_id)?;
            if review_root==producer_root {return Err(StoreError::Conflict("independent memory review requires a different authority root".into()));}
            if decision=="revoked" && self.latest_memory_review(&context.project_id,draft_id)?.is_none_or(|r|r.decision!="approved") {
                return Err(StoreError::Conflict("only an approved memory review can be revoked".into()));
            }
            let mut row=self.prepare("INSERT INTO boreal_memory_review(project_id,review_id,draft_id,content_digest,decision,reason,actor_id,operation_id,project_revision,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?2,?8,?9)")?;
            row.bind_text(1,&context.project_id)?;row.bind_text(2,&context.operation_id)?;row.bind_text(3,draft_id)?;
            row.bind_text(4,&draft.content_digest)?;row.bind_text(5,decision)?;row.bind_text(6,reason)?;row.bind_text(7,&context.actor_id)?;
            row.bind_i64(8,self.project_revision(&context.project_id)?.0.checked_add(1).ok_or_else(||StoreError::Invalid("revision overflow".into()))?)?;row.bind_text(9,&context.now)?;row.run()
        })
    }
    pub fn latest_memory_review(
        &self,
        project: &str,
        draft: &str,
    ) -> Result<Option<MemoryReviewRecord>, StoreError> {
        let mut row=self.prepare("SELECT project_id,review_id,draft_id,content_digest,decision,reason,actor_id,project_revision FROM boreal_memory_review WHERE project_id=?1 AND draft_id=?2 ORDER BY project_revision DESC,review_id DESC LIMIT 1")?;
        row.bind_text(1, project)?;
        row.bind_text(2, draft)?;
        if row.step()? != SQLITE_ROW {
            return Ok(None);
        }
        Ok(Some(MemoryReviewRecord {
            project_id: row.column_text(0)?,
            review_id: row.column_text(1)?,
            draft_id: row.column_text(2)?,
            content_digest: row.column_text(3)?,
            decision: row.column_text(4)?,
            reason: row.column_text(5)?,
            actor_id: row.column_text(6)?,
            project_revision: row.column_u64(7)?,
        }))
    }
    pub fn approved_memory_draft(
        &self,
        project: &str,
        review_id: &str,
    ) -> Result<(MemoryDraftRecord, MemoryReviewRecord), StoreError> {
        let mut row = self.prepare(
            "SELECT draft_id FROM boreal_memory_review WHERE project_id=?1 AND review_id=?2",
        )?;
        row.bind_text(1, project)?;
        row.bind_text(2, review_id)?;
        if row.step()? != SQLITE_ROW {
            return Err(StoreError::Invalid("durable memory review missing".into()));
        }
        let draft_id = row.column_text(0)?;
        let draft = self
            .memory_draft(project, &draft_id)?
            .ok_or_else(|| StoreError::Corrupt("review draft missing".into()))?;
        let review = self
            .latest_memory_review(project, &draft_id)?
            .ok_or_else(|| StoreError::Corrupt("review disappeared".into()))?;
        if review.review_id != review_id
            || review.decision != "approved"
            || review.content_digest != draft.content_digest
        {
            return Err(StoreError::Conflict(
                "memory approval is rejected, revoked, superseded or bound to different content"
                    .into(),
            ));
        }
        Ok((draft, review))
    }
    /// Admission journal, immutable review binding and registered Git job commit
    /// together. No filesystem effect occurs inside this transaction.
    pub fn admit_memory_publication(
        &self,
        context: &V3MutationContext,
        identity: &identity::IdentityContext,
        review_id: &str,
        memory_root: &str,
        expected_manifest: Option<&str>,
        planned_manifest: &str,
        publication_digest: &str,
        job: &jobs::ExternalJobInput,
    ) -> Result<jobs::ExternalJobRegistration, StoreError> {
        if job.project_id != context.project_id
            || identity.project_id != context.project_id
            || job.request_digest != context.request_digest
            || job.operation_id != context.operation_id
            || job.actor_id != context.actor_id
            || job.session_id != context.session_id
        {
            return Err(StoreError::Conflict(
                "memory admission identities disagree".into(),
            ));
        }
        self.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| {
            identity::IdentityStore::new(self)
                .validate_context(identity)
                .map_err(|e| StoreError::Conflict(e.to_string()))?;
            let (role, _) = self.principal_authority(&context.project_id, &context.actor_id)?;
            if !matches!(role, ActorRole::Publisher | ActorRole::Operator) {
                return Err(StoreError::Invalid(
                    "publication requires publisher or operator".into(),
                ));
            }
            if let Some(_existing) = self.preflight_operation_replay(
                &context.project_id,
                &context.operation_id,
                "memory.publish",
                &context.actor_id,
                context.session_id.as_deref(),
                context.expected_revision,
                None,
                None,
                &context.request_digest,
                "project",
                &context.project_id,
            )? {
                return jobs::register_external_job_row(self, job);
            }
            if context.expected_revision.is_none() {
                return Err(StoreError::Invalid(
                    "publication requires expected revision".into(),
                ));
            }
            self.validate_project_session(
                &context.project_id,
                &context.actor_id,
                context
                    .session_id
                    .as_deref()
                    .ok_or_else(|| StoreError::Invalid("publication session missing".into()))?,
            )?;
            check_expected_revision(
                self.project_revision(&context.project_id)?.0,
                context.expected_revision,
            )?;
            let (draft, review) = self.approved_memory_draft(&context.project_id, review_id)?;
            let mut row=self.prepare("INSERT INTO boreal_memory_publication_intent(project_id,operation_id,review_id,draft_id,content_digest,memory_root,expected_manifest_identity,planned_manifest_identity,publication_digest,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)")?;
            row.bind_text(1, &context.project_id)?;
            row.bind_text(2, &context.operation_id)?;
            row.bind_text(3, &review.review_id)?;
            row.bind_text(4, &draft.draft_id)?;
            row.bind_text(5, &draft.content_digest)?;
            row.bind_text(6, memory_root)?;
            row.bind_optional_text(7, expected_manifest)?;
            row.bind_text(8, planned_manifest)?;
            row.bind_text(9, publication_digest)?;
            row.bind_text(10, &context.now)?;
            row.run()?;
            let revision = self.bump_revision_in_transaction(&context.project_id)?.0;
            let payload=json!({"command":"memory.publish","stage":"registered","draft_id":draft.draft_id,"review_id":review_id,"content_digest":draft.content_digest}).to_string();
            self.append_operation_audit_in_transaction(
                OperationRecord {
                    operation_id: context.operation_id.clone(),
                    project_id: context.project_id.clone(),
                    command: "memory.publish".into(),
                    actor_id: context.actor_id.clone(),
                    session_id: context.session_id.clone(),
                    expected_revision: context.expected_revision,
                    attempt_id: None,
                    fence: None,
                    request_digest: context.request_digest.clone(),
                    outcome: OperationOutcome::Changed,
                    result_json: payload.clone(),
                    revision,
                    created_at: context.now.clone(),
                    completed_at: Some(context.now.clone()),
                },
                AuditEventRecord {
                    project_id: context.project_id.clone(),
                    revision,
                    operation_id: context.operation_id.clone(),
                    event_type: "repair.correction".into(),
                    subject_type: "project".into(),
                    subject_id: context.project_id.clone(),
                    actor_id: context.actor_id.clone(),
                    session_id: context.session_id.clone(),
                    fence: None,
                    as_of: context.now.clone(),
                    payload_json: payload,
                },
            )?;
            jobs::register_external_job_row(self, job)
        })();
        finish_transaction(self, result)
    }
    pub fn memory_publication_plan(
        &self,
        project: &str,
        operation: &str,
    ) -> Result<Option<(String, String)>, StoreError> {
        if !self.canonical_production && !self.table_exists("boreal_memory_publication_intent")? {
            return Ok(None);
        }
        let mut row=self.prepare("SELECT planned_manifest_identity,publication_digest FROM boreal_memory_publication_intent WHERE project_id=?1 AND operation_id=?2")?;
        row.bind_text(1, project)?;
        row.bind_text(2, operation)?;
        if row.step()? != SQLITE_ROW {
            return Ok(None);
        }
        Ok(Some((row.column_text(0)?, row.column_text(1)?)))
    }
    pub fn validate_memory_publication_binding(
        &self,
        project: &str,
        operation: &str,
        review: &str,
        root: &str,
        expected: Option<&str>,
    ) -> Result<(), StoreError> {
        let mut row=self.prepare("SELECT review_id,memory_root,expected_manifest_identity FROM boreal_memory_publication_intent WHERE project_id=?1 AND operation_id=?2")?;
        row.bind_text(1, project)?;
        row.bind_text(2, operation)?;
        if row.step()? != SQLITE_ROW
            || row.column_text(0)? != review
            || row.column_text(1)? != root
            || row.column_optional_text(2)?.as_deref() != expected
        {
            return Err(StoreError::Conflict(
                "publication lacks its exact durable review/admission binding".into(),
            ));
        }
        Ok(())
    }
}

impl SqliteStore {
    /// A read snapshot is not allowed to combine an old draft/review with a new revision.
    pub fn memory_draft_snapshot(
        &self,
        project: &str,
        draft: &str,
    ) -> Result<(u64, MemoryDraftRecord, Option<MemoryReviewRecord>), StoreError> {
        self.execute_batch("BEGIN")?;
        let result = (|| {
            let revision = self.project_revision(project)?.0;
            let record =
                self.memory_draft(project, draft)?
                    .ok_or_else(|| StoreError::NotFound {
                        entity: "memory_draft",
                        id: draft.into(),
                    })?;
            let review = self.latest_memory_review(project, draft)?;
            Ok((revision, record, review))
        })();
        finish_transaction(self, result)
    }
    /// Records verified Git readback, never launches Git and never infers success
    /// from a process exit. Admission identity and reconciliation audit commit together.
    pub fn reconcile_memory_publication(
        &self,
        context: &V3MutationContext,
        identity: &identity::IdentityContext,
        original_operation: &str,
        manifest: &str,
        git_revision: &str,
    ) -> Result<MutationResult, StoreError> {
        if identity.project_id != context.project_id
            || !matches!(git_revision.len(), 40 | 64)
            || !git_revision.bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            return Err(StoreError::Invalid(
                "invalid publication readback identity".into(),
            ));
        }
        let bound=context.with_payload(json!({"publication_operation":original_operation,"manifest_identity":manifest,"git_revision":git_revision}));
        self.fact_mutation(
            &bound,
            "memory.reconcile",
            "project",
            &context.project_id,
            &[ActorRole::Publisher, ActorRole::Operator],
            || {
                identity::IdentityStore::new(self)
                    .validate_context(identity)
                    .map_err(|e| StoreError::Conflict(e.to_string()))?;
                let (expected_manifest, content) = self
                    .memory_publication_plan(&context.project_id, original_operation)?
                    .ok_or_else(|| StoreError::Conflict("publication admission missing".into()))?;
                if expected_manifest != manifest {
                    return Err(StoreError::Conflict(
                        "Git readback differs from admitted manifest".into(),
                    ));
                }
                let mut current = self
                    .external_job_by_operation_with_identity(identity, original_operation)?
                    .ok_or_else(|| StoreError::Conflict("publication job missing".into()))?;
                if current.kind != "memory_publication" {
                    return Err(StoreError::Invalid("not a memory publication".into()));
                }
                let reference = format!("git:{git_revision}");
                if matches!(current.stage.as_str(), "committed" | "reconciled") {
                    if current.side_effect_ref.as_deref() != Some(reference.as_str())
                        || current.result_digest.as_deref() != Some(content.as_str())
                    {
                        return Err(StoreError::Corrupt(
                            "terminal publication disagrees with verified Git".into(),
                        ));
                    }
                    return Ok(());
                }
                loop {
                    let next = match current.stage.as_str() {
                        "registered" => "admitted",
                        "admitted" => "running",
                        "running" => "side_effect_started",
                        "side_effect_started" | "side_effect_finished" => "readback_required",
                        "readback_required" | "cancel_requested" => "reconciled",
                        _ => return Err(StoreError::Conflict(
                            "terminal or unknown publication stage needs explicit investigation"
                                .into(),
                        )),
                    };
                    current = jobs::advance_external_job_row(
                        self,
                        &jobs::ExternalJobTransitionInput {
                            project_id: context.project_id.clone(),
                            job_id: current.job_id.clone(),
                            expected_stage: current.stage.clone(),
                            next_stage: next.into(),
                            at: context.now.clone(),
                            side_effect_ref: Some(reference.clone()),
                            result_digest: Some(content.clone()),
                            error_message: None,
                        },
                    )?;
                    if current.stage == "reconciled" {
                        return Ok(());
                    }
                }
            },
        )
    }
}
