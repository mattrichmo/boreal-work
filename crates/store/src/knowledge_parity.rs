//! Versioned, project-scoped decision and knowledge-claim records.
//!
//! These are append-only facts. Decisions are superseded by a new decision;
//! claims retain every review event. The extension is independently versioned
//! so installation does not change the canonical work schema version.

use super::*;
use boreal_domain::ActorRole;
use serde_json::json;

pub const KNOWLEDGE_PARITY_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS boreal_knowledge_parity_meta (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL CHECK(version=1)
);
INSERT OR IGNORE INTO boreal_knowledge_parity_meta(singleton,version) VALUES(1,1);
CREATE TABLE IF NOT EXISTS boreal_decision_v1 (
  project_id TEXT NOT NULL, decision_id TEXT NOT NULL, title TEXT NOT NULL,
  body TEXT NOT NULL, rationale TEXT NOT NULL, source_version_id TEXT,
  supersedes_id TEXT, actor_id TEXT NOT NULL, operation_id TEXT NOT NULL,
  project_revision INTEGER NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY(project_id,decision_id), UNIQUE(project_id,operation_id),
  FOREIGN KEY(project_id,source_version_id) REFERENCES source_version(project_id,source_version_id),
  FOREIGN KEY(project_id,supersedes_id) REFERENCES boreal_decision_v1(project_id,decision_id)
);
CREATE INDEX IF NOT EXISTS boreal_decision_project_recent ON boreal_decision_v1(project_id,project_revision DESC,decision_id);
CREATE TABLE IF NOT EXISTS boreal_knowledge_claim_v1 (
  project_id TEXT NOT NULL, claim_id TEXT NOT NULL, statement TEXT NOT NULL, content_digest TEXT NOT NULL,
  source_version_id TEXT NOT NULL, citation_location TEXT NOT NULL,
  supersedes_id TEXT, actor_id TEXT NOT NULL, operation_id TEXT NOT NULL,
  project_revision INTEGER NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY(project_id,claim_id), UNIQUE(project_id,operation_id),
  FOREIGN KEY(project_id,source_version_id) REFERENCES source_version(project_id,source_version_id),
  FOREIGN KEY(project_id,supersedes_id) REFERENCES boreal_knowledge_claim_v1(project_id,claim_id)
);
CREATE INDEX IF NOT EXISTS boreal_claim_project_recent ON boreal_knowledge_claim_v1(project_id,project_revision DESC,claim_id);
CREATE TABLE IF NOT EXISTS boreal_knowledge_claim_review_v1 (
  project_id TEXT NOT NULL, review_id TEXT NOT NULL, claim_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('accepted','rejected','needs_revision')),
  reason TEXT NOT NULL, actor_id TEXT NOT NULL, operation_id TEXT NOT NULL,
  project_revision INTEGER NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY(project_id,review_id), UNIQUE(project_id,operation_id),
  FOREIGN KEY(project_id,claim_id) REFERENCES boreal_knowledge_claim_v1(project_id,claim_id)
);
CREATE TRIGGER IF NOT EXISTS boreal_decision_v1_no_update BEFORE UPDATE ON boreal_decision_v1
BEGIN SELECT RAISE(ABORT,'knowledge_decision_append_only'); END;
CREATE TRIGGER IF NOT EXISTS boreal_decision_v1_no_delete BEFORE DELETE ON boreal_decision_v1
BEGIN SELECT RAISE(ABORT,'knowledge_decision_append_only'); END;
CREATE TRIGGER IF NOT EXISTS boreal_claim_v1_no_update BEFORE UPDATE ON boreal_knowledge_claim_v1
BEGIN SELECT RAISE(ABORT,'knowledge_claim_append_only'); END;
CREATE TRIGGER IF NOT EXISTS boreal_claim_v1_no_delete BEFORE DELETE ON boreal_knowledge_claim_v1
BEGIN SELECT RAISE(ABORT,'knowledge_claim_append_only'); END;
CREATE TRIGGER IF NOT EXISTS boreal_claim_review_v1_no_update BEFORE UPDATE ON boreal_knowledge_claim_review_v1
BEGIN SELECT RAISE(ABORT,'knowledge_claim_review_append_only'); END;
CREATE TRIGGER IF NOT EXISTS boreal_claim_review_v1_no_delete BEFORE DELETE ON boreal_knowledge_claim_review_v1
BEGIN SELECT RAISE(ABORT,'knowledge_claim_review_append_only'); END;
"#;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct KnowledgeDecisionRecord {
    pub project_id: String,
    pub decision_id: String,
    pub title: String,
    pub body: String,
    pub rationale: String,
    pub source_version_id: Option<String>,
    pub supersedes_id: Option<String>,
    pub actor_id: String,
    pub operation_id: String,
    pub project_revision: u64,
    pub created_at: String,
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct KnowledgeClaimRecord {
    pub project_id: String,
    pub claim_id: String,
    pub statement: String,
    pub content_digest: String,
    pub source_version_id: String,
    pub citation_location: String,
    pub supersedes_id: Option<String>,
    pub actor_id: String,
    pub operation_id: String,
    pub project_revision: u64,
    pub created_at: String,
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct KnowledgeClaimReviewRecord {
    pub project_id: String,
    pub review_id: String,
    pub claim_id: String,
    pub decision: String,
    pub reason: String,
    pub actor_id: String,
    pub operation_id: String,
    pub project_revision: u64,
    pub created_at: String,
}

/// A revision and the selected claims with their review history.
pub type KnowledgeClaimPageWithReviews = (
    u64,
    Vec<(KnowledgeClaimRecord, Vec<KnowledgeClaimReviewRecord>)>,
);

impl SqliteStore {
    pub fn ensure_knowledge_parity_schema(&self) -> Result<(), StoreError> {
        self.install_feature_schema("knowledge_parity", 1, KNOWLEDGE_PARITY_SCHEMA)
    }

    /// One-revision, bounded read capsule used by context and search. It reads
    /// only rows owned by the requested project and contains no lifecycle
    /// authority or executable instruction field.
    pub fn knowledge_context_snapshot(
        &self,
        project: &str,
        limit: u64,
        offset: u64,
        expected_revision: Option<u64>,
    ) -> Result<Value, StoreError> {
        if limit == 0 || limit > 100 {
            return Err(StoreError::Invalid(
                "context page limit must be 1..=100".into(),
            ));
        }
        self.execute_batch("BEGIN")?;
        let result = (|| {
            let revision = self.project_revision(project)?.0;
            if let Some(expected) = expected_revision {
                if revision != expected {
                    return Err(StoreError::StaleRevision {
                        expected,
                        actual: revision,
                    });
                }
            }
            let mut work=self.prepare("SELECT work_id,kind,parent_id,lifecycle,dispatch_policy,priority,title,description,acceptance_profile_id,acceptance_profile_version,source_version_id,due_at FROM work_item WHERE project_id=?1 ORDER BY priority DESC,work_id LIMIT ?2 OFFSET ?3")?;
            work.bind_text(1, project)?;
            work.bind_i64(2, limit)?;
            work.bind_i64(3, offset)?;
            let mut work_rows = Vec::new();
            while work.step()? == SQLITE_ROW {
                work_rows.push(json!({"id":work.column_text(0)?,"kind":work.column_text(1)?,"parent_id":work.column_optional_text(2)?,"lifecycle":work.column_text(3)?,"dispatch_policy":work.column_text(4)?,"priority":work.column_u64(5)?,"title":work.column_text(6)?,"description":work.column_text(7)?,"acceptance_profile":{"id":work.column_text(8)?,"version":work.column_u64(9)?},"source_version_id":work.column_optional_text(10)?,"due_at":work.column_optional_text(11)?}))
            }
            let mut dependencies=self.prepare("SELECT prerequisite_id,dependent_id,satisfaction_policy,exception_reason,approved_by FROM dependency WHERE project_id=?1 ORDER BY prerequisite_id,dependent_id LIMIT ?2 OFFSET ?3")?;
            dependencies.bind_text(1, project)?;
            dependencies.bind_i64(2, limit.saturating_mul(4))?;
            dependencies.bind_i64(3, offset.saturating_mul(4))?;
            let mut dependency_rows = Vec::new();
            while dependencies.step()? == SQLITE_ROW {
                dependency_rows.push(json!({"prerequisite_id":dependencies.column_text(0)?,"dependent_id":dependencies.column_text(1)?,"satisfaction_policy":dependencies.column_text(2)?,"exception_reason":dependencies.column_optional_text(3)?,"approved_by":dependencies.column_optional_text(4)?}))
            }
            let mut attempts=self.prepare("SELECT a.work_id,a.attempt_id,a.state,a.fence,a.actor_id,a.session_id,a.lease_deadline,a.source_version_id,a.config_identity FROM attempt a JOIN work_item w ON w.work_id=a.work_id AND w.project_id=?1 WHERE a.current=1 ORDER BY a.work_id LIMIT ?2 OFFSET ?3")?;
            attempts.bind_text(1, project)?;
            attempts.bind_i64(2, limit)?;
            attempts.bind_i64(3, offset)?;
            let mut attempt_rows = Vec::new();
            while attempts.step()? == SQLITE_ROW {
                attempt_rows.push(json!({"work_id":attempts.column_text(0)?,"attempt_id":attempts.column_text(1)?,"state":attempts.column_text(2)?,"fence":attempts.column_u64(3)?,"actor_id":attempts.column_text(4)?,"session_id":attempts.column_optional_text(5)?,"lease_deadline":attempts.column_text(6)?,"source_version_id":attempts.column_optional_text(7)?,"config_identity":attempts.column_text(8)?}))
            }
            let mut receipts=self.prepare("SELECT r.work_id,r.receipt_id,r.attempt_id,r.fence,r.gate_id,r.exit_code,r.output_digest,r.source_version_id,r.config_identity FROM receipt r JOIN work_item w ON w.work_id=r.work_id AND w.project_id=?1 ORDER BY r.ended_at DESC,r.receipt_id DESC LIMIT ?2 OFFSET ?3")?;
            receipts.bind_text(1, project)?;
            receipts.bind_i64(2, limit)?;
            receipts.bind_i64(3, offset)?;
            let mut receipt_rows = Vec::new();
            while receipts.step()? == SQLITE_ROW {
                receipt_rows.push(json!({"work_id":receipts.column_text(0)?,"receipt_id":receipts.column_text(1)?,"attempt_id":receipts.column_text(2)?,"fence":receipts.column_u64(3)?,"gate_id":receipts.column_optional_text(4)?,"exit_code":receipts.column_i64(5)?,"output_digest":receipts.column_optional_text(6)?,"source_version_id":receipts.column_optional_text(7)?,"config_identity":receipts.column_text(8)?}))
            }
            let mut sources=self.prepare("SELECT source_version_id,origin,content_digest,availability,captured_at,citation_json FROM source_version WHERE project_id=?1 ORDER BY captured_at DESC,source_version_id LIMIT ?2 OFFSET ?3")?;
            sources.bind_text(1, project)?;
            sources.bind_i64(2, limit)?;
            sources.bind_i64(3, offset)?;
            let mut source_rows = Vec::new();
            while sources.step()? == SQLITE_ROW {
                source_rows.push(json!({"id":sources.column_text(0)?,"kind":"source","origin":sources.column_text(1)?,"digest":sources.column_text(2)?,"availability":sources.column_text(3)?,"captured_at":sources.column_text(4)?,"citation":serde_json::from_str::<Value>(&sources.column_text(5)?).unwrap_or(Value::Null)}))
            }
            let mut decisions=self.prepare("SELECT decision_id,title,body,rationale,source_version_id,supersedes_id,project_revision FROM boreal_decision_v1 WHERE project_id=?1 ORDER BY project_revision DESC,decision_id LIMIT ?2 OFFSET ?3")?;
            decisions.bind_text(1, project)?;
            decisions.bind_i64(2, limit)?;
            decisions.bind_i64(3, offset)?;
            let mut decision_rows = Vec::new();
            while decisions.step()? == SQLITE_ROW {
                decision_rows.push(json!({"id":decisions.column_text(0)?,"kind":"decision","title":decisions.column_text(1)?,"body":decisions.column_text(2)?,"rationale":decisions.column_text(3)?,"source_version_id":decisions.column_optional_text(4)?,"supersedes_id":decisions.column_optional_text(5)?,"revision":decisions.column_u64(6)?}))
            }
            let mut claims=self.prepare("SELECT claim_id,statement,content_digest,source_version_id,citation_location,supersedes_id,project_revision FROM boreal_knowledge_claim_v1 WHERE project_id=?1 ORDER BY project_revision DESC,claim_id LIMIT ?2 OFFSET ?3")?;
            claims.bind_text(1, project)?;
            claims.bind_i64(2, limit)?;
            claims.bind_i64(3, offset)?;
            let mut claim_rows = Vec::new();
            while claims.step()? == SQLITE_ROW {
                let id = claims.column_text(0)?;
                let statement = claims.column_text(1)?;
                let digest = claims.column_text(2)?;
                let source = claims.column_text(3)?;
                let location = claims.column_text(4)?;
                let supersedes = claims.column_optional_text(5)?;
                let row_revision = claims.column_u64(6)?;
                let mut reviews=self.prepare("SELECT decision,reason,project_revision FROM boreal_knowledge_claim_review_v1 WHERE project_id=?1 AND claim_id=?2 ORDER BY project_revision,review_id")?;
                reviews.bind_text(1, project)?;
                reviews.bind_text(2, &id)?;
                let mut review_rows = Vec::new();
                while reviews.step()? == SQLITE_ROW {
                    review_rows.push(json!({"decision":reviews.column_text(0)?,"reason":reviews.column_text(1)?,"revision":reviews.column_u64(2)?}))
                }
                claim_rows.push(json!({"id":id,"kind":"claim","statement":statement,"content_digest":digest,"source_version_id":source,"citation_location":location,"supersedes_id":supersedes,"reviews":review_rows,"revision":row_revision}))
            }
            let mut intake_rows = Vec::new();
            if self.table_exists("intake_item_v3")? {
                let mut intake=self.prepare("SELECT intake_id,lifecycle,content,content_revision,content_digest,revisit_at_utc_ms FROM intake_item_v3 WHERE project_id=?1 ORDER BY updated_at DESC,intake_id LIMIT ?2 OFFSET ?3")?;
                intake.bind_text(1, project)?;
                intake.bind_i64(2, limit)?;
                intake.bind_i64(3, offset)?;
                while intake.step()? == SQLITE_ROW {
                    intake_rows.push(json!({"id":intake.column_text(0)?,"kind":"intake","lifecycle":intake.column_text(1)?,"content":intake.column_text(2)?,"content_revision":intake.column_u64(3)?,"content_digest":intake.column_text(4)?,"revisit_at_utc_ms":intake.column_optional_signed_i64(5)?}))
                }
            }
            let mut memory_rows = Vec::new();
            if self.table_exists("boreal_memory_draft")? {
                let mut memory_ids=self.prepare("SELECT draft_id FROM boreal_memory_draft WHERE project_id=?1 ORDER BY project_revision DESC,draft_id LIMIT ?2 OFFSET ?3")?;
                memory_ids.bind_text(1, project)?;
                memory_ids.bind_i64(2, limit)?;
                memory_ids.bind_i64(3, offset)?;
                while memory_ids.step()? == SQLITE_ROW {
                    let id = memory_ids.column_text(0)?;
                    let draft = self.memory_draft(project, &id)?.ok_or_else(|| {
                        StoreError::Corrupt("memory draft disappeared in context snapshot".into())
                    })?;
                    let review = self.latest_memory_review(project, &id)?;
                    memory_rows.push(json!({"id":id,"kind":"memory","entry_id":draft.entry_id,"title":draft.title,"body":draft.body,"citations":serde_json::from_str::<Value>(&draft.citations_json).unwrap_or(Value::Null),"content_digest":draft.content_digest,"review":review.map(|r|json!({"decision":r.decision,"reason":r.reason,"revision":r.project_revision})),"revision":draft.project_revision}))
                }
            }
            Ok(
                json!({"project_id":project,"revision":revision,"work":work_rows,"dependencies":dependency_rows,"active_attempts":attempt_rows,"receipts":receipt_rows,"sources":source_rows,"decisions":decision_rows,"claims":claim_rows,"intake":intake_rows,"memory":memory_rows}),
            )
        })();
        finish_transaction(self, result)
    }

    /// Revision-checked disposition update. The original captured record is
    /// still present as the same intake identity and promotion rows retain its
    /// exact content revision and digest.
    pub fn update_intake_disposition_v3(
        &self,
        context: &V3MutationContext,
        intake_id: &str,
        expected_content_revision: u64,
        lifecycle: &str,
        revisit_at_utc_ms: Option<i64>,
    ) -> Result<MutationResult, StoreError> {
        if !matches!(
            lifecycle,
            "captured" | "triaged" | "deferred" | "resolved" | "archived"
        ) {
            return Err(StoreError::Invalid("unsupported intake lifecycle".into()));
        }
        if lifecycle == "deferred" && revisit_at_utc_ms.is_none() {
            return Err(StoreError::Invalid(
                "deferred intake requires a revisit time".into(),
            ));
        }
        let bound = context.with_payload(json!({"intake_id":intake_id,"expected_content_revision":expected_content_revision,"lifecycle":lifecycle,"revisit_at_utc_ms":revisit_at_utc_ms}));
        self.fact_mutation(&bound,"intake.update","intake",intake_id,&[ActorRole::Agent,ActorRole::Operator],||{
            let mut q=self.prepare("UPDATE intake_item_v3 SET lifecycle=?1,revisit_at_utc_ms=?2,updated_at=?3 WHERE project_id=?4 AND intake_id=?5 AND content_revision=?6")?;
            q.bind_text(1,lifecycle)?;if let Some(value)=revisit_at_utc_ms{q.bind_signed_i64(2,value)?}else{q.bind_null(2)?};q.bind_text(3,&context.now)?;q.bind_text(4,&context.project_id)?;q.bind_text(5,intake_id)?;q.bind_i64(6,expected_content_revision)?;q.run()?;
            if self.intake_item_v3(&context.project_id,intake_id)?.is_none(){return Err(StoreError::NotFound{entity:"intake_item_v3",id:intake_id.to_owned()})}
            // sqlite3_changes is intentionally not exposed; reread the exact expected
            // revision and lifecycle to distinguish a stale write from success.
            let item=self.intake_item_v3(&context.project_id,intake_id)?.expect("checked above");
            if item.content_revision!=expected_content_revision||item.lifecycle!=lifecycle{return Err(StoreError::Conflict("intake changed since it was reviewed; refresh and retry".into()))}
            Ok(())
        })
    }

    pub fn create_knowledge_decision(
        &self,
        context: &V3MutationContext,
        row: &KnowledgeDecisionRecord,
    ) -> Result<MutationResult, StoreError> {
        if row.project_id != context.project_id
            || row.actor_id != context.actor_id
            || empty(&row.decision_id)
            || empty(&row.title)
            || empty(&row.body)
            || empty(&row.rationale)
        {
            return Err(StoreError::Invalid(
                "decision identity and non-empty title, body, and rationale are required".into(),
            ));
        }
        let payload = json!({"decision_id":row.decision_id,"title":row.title,"body":row.body,"rationale":row.rationale,"source_version_id":row.source_version_id,"supersedes_id":row.supersedes_id});
        let bound = context.with_payload(payload);
        self.fact_mutation(&bound,"knowledge.decision.create","decision",&row.decision_id,&[ActorRole::Agent,ActorRole::Operator],||{
            if let Some(source)=&row.source_version_id { if self.source_version(&row.project_id,source)?.is_none(){return Err(StoreError::Invalid("decision source is not registered in this project".into()));} }
            if let Some(parent)=&row.supersedes_id { let prior=self.knowledge_decision(&row.project_id,parent)?.ok_or_else(||StoreError::Invalid("superseded decision does not exist in this project".into()))?; if self.knowledge_decision_superseded(&row.project_id,parent)? { return Err(StoreError::Conflict("decision already has a successor".into())); }
                if prior.decision_id==row.decision_id{return Err(StoreError::Invalid("decision cannot supersede itself".into()));} }
            let mut q=self.prepare("INSERT INTO boreal_decision_v1(project_id,decision_id,title,body,rationale,source_version_id,supersedes_id,actor_id,operation_id,project_revision,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)")?;
            q.bind_text(1,&row.project_id)?;q.bind_text(2,&row.decision_id)?;q.bind_text(3,&row.title)?;q.bind_text(4,&row.body)?;q.bind_text(5,&row.rationale)?;q.bind_optional_text(6,row.source_version_id.as_deref())?;q.bind_optional_text(7,row.supersedes_id.as_deref())?;q.bind_text(8,&context.actor_id)?;q.bind_text(9,&context.operation_id)?;q.bind_i64(10,self.project_revision(&context.project_id)?.0+1)?;q.bind_text(11,&context.now)?;q.run()
        })
    }
    pub fn knowledge_decision(
        &self,
        project: &str,
        id: &str,
    ) -> Result<Option<KnowledgeDecisionRecord>, StoreError> {
        let mut q=self.prepare("SELECT project_id,decision_id,title,body,rationale,source_version_id,supersedes_id,actor_id,operation_id,project_revision,created_at FROM boreal_decision_v1 WHERE project_id=?1 AND decision_id=?2")?;
        q.bind_text(1, project)?;
        q.bind_text(2, id)?;
        if q.step()? != SQLITE_ROW {
            return Ok(None);
        }
        Ok(Some(KnowledgeDecisionRecord {
            project_id: q.column_text(0)?,
            decision_id: q.column_text(1)?,
            title: q.column_text(2)?,
            body: q.column_text(3)?,
            rationale: q.column_text(4)?,
            source_version_id: q.column_optional_text(5)?,
            supersedes_id: q.column_optional_text(6)?,
            actor_id: q.column_text(7)?,
            operation_id: q.column_text(8)?,
            project_revision: q.column_u64(9)?,
            created_at: q.column_text(10)?,
        }))
    }
    pub fn list_knowledge_decisions(
        &self,
        project: &str,
        limit: u64,
        offset: u64,
    ) -> Result<Vec<KnowledgeDecisionRecord>, StoreError> {
        if limit == 0 || limit > 1000 {
            return Err(StoreError::Invalid(
                "decision page limit must be 1..=1000".into(),
            ));
        }
        let mut q=self.prepare("SELECT project_id,decision_id,title,body,rationale,source_version_id,supersedes_id,actor_id,operation_id,project_revision,created_at FROM boreal_decision_v1 WHERE project_id=?1 ORDER BY project_revision DESC,decision_id LIMIT ?2 OFFSET ?3")?;
        q.bind_text(1, project)?;
        q.bind_i64(2, limit)?;
        q.bind_i64(3, offset)?;
        let mut out = Vec::new();
        while q.step()? == SQLITE_ROW {
            out.push(KnowledgeDecisionRecord {
                project_id: q.column_text(0)?,
                decision_id: q.column_text(1)?,
                title: q.column_text(2)?,
                body: q.column_text(3)?,
                rationale: q.column_text(4)?,
                source_version_id: q.column_optional_text(5)?,
                supersedes_id: q.column_optional_text(6)?,
                actor_id: q.column_text(7)?,
                operation_id: q.column_text(8)?,
                project_revision: q.column_u64(9)?,
                created_at: q.column_text(10)?,
            })
        }
        Ok(out)
    }
    pub fn knowledge_decision_superseded(
        &self,
        project: &str,
        id: &str,
    ) -> Result<bool, StoreError> {
        let mut q = self.prepare(
            "SELECT 1 FROM boreal_decision_v1 WHERE project_id=?1 AND supersedes_id=?2 LIMIT 1",
        )?;
        q.bind_text(1, project)?;
        q.bind_text(2, id)?;
        Ok(q.step()? == SQLITE_ROW)
    }
    pub fn knowledge_decision_page(
        &self,
        project: &str,
        limit: u64,
        offset: u64,
    ) -> Result<(u64, Vec<KnowledgeDecisionRecord>), StoreError> {
        self.execute_batch("BEGIN")?;
        let result = (|| {
            Ok((
                self.project_revision(project)?.0,
                self.list_knowledge_decisions(project, limit, offset)?,
            ))
        })();
        finish_transaction(self, result)
    }
    pub fn knowledge_decision_detail(
        &self,
        project: &str,
        id: &str,
    ) -> Result<(u64, Option<KnowledgeDecisionRecord>, bool), StoreError> {
        self.execute_batch("BEGIN")?;
        let result = (|| {
            Ok((
                self.project_revision(project)?.0,
                self.knowledge_decision(project, id)?,
                self.knowledge_decision_superseded(project, id)?,
            ))
        })();
        finish_transaction(self, result)
    }

    pub fn create_knowledge_claim(
        &self,
        context: &V3MutationContext,
        row: &KnowledgeClaimRecord,
    ) -> Result<MutationResult, StoreError> {
        if row.project_id != context.project_id
            || row.actor_id != context.actor_id
            || empty(&row.claim_id)
            || empty(&row.statement)
            || empty(&row.citation_location)
        {
            return Err(StoreError::Invalid(
                "claim identity, statement, and citation location are required".into(),
            ));
        }
        let expected_digest=checksum(json!({"statement":row.statement,"source_version_id":row.source_version_id,"citation_location":row.citation_location}).to_string().as_bytes());
        if row.content_digest != expected_digest {
            return Err(StoreError::Invalid(
                "claim content digest does not match its immutable statement and citation".into(),
            ));
        }
        let bound=context.with_payload(json!({"claim_id":row.claim_id,"statement":row.statement,"content_digest":row.content_digest,"source_version_id":row.source_version_id,"citation_location":row.citation_location,"supersedes_id":row.supersedes_id}));
        self.fact_mutation(&bound,"knowledge.claim.create","knowledge_claim",&row.claim_id,&[ActorRole::Agent,ActorRole::Operator],||{let source=self.source_version(&row.project_id,&row.source_version_id)?.ok_or_else(||StoreError::Invalid("claim citation source is not registered in this project".into()))?;if source.availability!="available"{return Err(StoreError::Conflict("claim citation source is unavailable".into()))}
                if let Some(parent)=&row.supersedes_id{if self.knowledge_claim(&row.project_id,parent)?.is_none(){return Err(StoreError::Invalid("superseded claim does not exist in this project".into()))}
                    if self.knowledge_claim_superseded(&row.project_id,parent)?{return Err(StoreError::Conflict("claim already has a successor".into()))}} let mut q=self.prepare("INSERT INTO boreal_knowledge_claim_v1(project_id,claim_id,statement,content_digest,source_version_id,citation_location,supersedes_id,actor_id,operation_id,project_revision,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)")?;q.bind_text(1,&row.project_id)?;q.bind_text(2,&row.claim_id)?;q.bind_text(3,&row.statement)?;q.bind_text(4,&row.content_digest)?;q.bind_text(5,&row.source_version_id)?;q.bind_text(6,&row.citation_location)?;q.bind_optional_text(7,row.supersedes_id.as_deref())?;q.bind_text(8,&context.actor_id)?;q.bind_text(9,&context.operation_id)?;q.bind_i64(10,self.project_revision(&context.project_id)?.0+1)?;q.bind_text(11,&context.now)?;q.run()})
    }
    pub fn knowledge_claim(
        &self,
        project: &str,
        id: &str,
    ) -> Result<Option<KnowledgeClaimRecord>, StoreError> {
        let mut q=self.prepare("SELECT project_id,claim_id,statement,content_digest,source_version_id,citation_location,supersedes_id,actor_id,operation_id,project_revision,created_at FROM boreal_knowledge_claim_v1 WHERE project_id=?1 AND claim_id=?2")?;
        q.bind_text(1, project)?;
        q.bind_text(2, id)?;
        if q.step()? != SQLITE_ROW {
            return Ok(None);
        }
        Ok(Some(KnowledgeClaimRecord {
            project_id: q.column_text(0)?,
            claim_id: q.column_text(1)?,
            statement: q.column_text(2)?,
            content_digest: q.column_text(3)?,
            source_version_id: q.column_text(4)?,
            citation_location: q.column_text(5)?,
            supersedes_id: q.column_optional_text(6)?,
            actor_id: q.column_text(7)?,
            operation_id: q.column_text(8)?,
            project_revision: q.column_u64(9)?,
            created_at: q.column_text(10)?,
        }))
    }
    pub fn knowledge_claim_superseded(&self, project: &str, id: &str) -> Result<bool, StoreError> {
        let mut q=self.prepare("SELECT 1 FROM boreal_knowledge_claim_v1 WHERE project_id=?1 AND supersedes_id=?2 LIMIT 1")?;
        q.bind_text(1, project)?;
        q.bind_text(2, id)?;
        Ok(q.step()? == SQLITE_ROW)
    }
    pub fn knowledge_claim_page(
        &self,
        project: &str,
        limit: u64,
        offset: u64,
    ) -> Result<(u64, Vec<KnowledgeClaimRecord>), StoreError> {
        self.execute_batch("BEGIN")?;
        let result = (|| {
            Ok((
                self.project_revision(project)?.0,
                self.list_knowledge_claims(project, limit, offset)?,
            ))
        })();
        finish_transaction(self, result)
    }
    pub fn knowledge_claim_page_full(
        &self,
        project: &str,
        limit: u64,
        offset: u64,
    ) -> Result<KnowledgeClaimPageWithReviews, StoreError> {
        self.execute_batch("BEGIN")?;
        let result = (|| {
            let revision = self.project_revision(project)?.0;
            let claims = self.list_knowledge_claims(project, limit, offset)?;
            let mut rows = Vec::with_capacity(claims.len());
            for claim in claims {
                let reviews = self.knowledge_claim_reviews(project, &claim.claim_id)?;
                rows.push((claim, reviews));
            }
            Ok((revision, rows))
        })();
        finish_transaction(self, result)
    }
    pub fn knowledge_claim_detail(
        &self,
        project: &str,
        id: &str,
    ) -> Result<
        (
            u64,
            Option<KnowledgeClaimRecord>,
            Vec<KnowledgeClaimReviewRecord>,
        ),
        StoreError,
    > {
        self.execute_batch("BEGIN")?;
        let result = (|| {
            Ok((
                self.project_revision(project)?.0,
                self.knowledge_claim(project, id)?,
                self.knowledge_claim_reviews(project, id)?,
            ))
        })();
        finish_transaction(self, result)
    }
    pub fn list_knowledge_claims(
        &self,
        project: &str,
        limit: u64,
        offset: u64,
    ) -> Result<Vec<KnowledgeClaimRecord>, StoreError> {
        if limit == 0 || limit > 1000 {
            return Err(StoreError::Invalid(
                "claim page limit must be 1..=1000".into(),
            ));
        }
        let mut q=self.prepare("SELECT project_id,claim_id,statement,content_digest,source_version_id,citation_location,supersedes_id,actor_id,operation_id,project_revision,created_at FROM boreal_knowledge_claim_v1 WHERE project_id=?1 ORDER BY project_revision DESC,claim_id LIMIT ?2 OFFSET ?3")?;
        q.bind_text(1, project)?;
        q.bind_i64(2, limit)?;
        q.bind_i64(3, offset)?;
        let mut out = Vec::new();
        while q.step()? == SQLITE_ROW {
            out.push(KnowledgeClaimRecord {
                project_id: q.column_text(0)?,
                claim_id: q.column_text(1)?,
                statement: q.column_text(2)?,
                content_digest: q.column_text(3)?,
                source_version_id: q.column_text(4)?,
                citation_location: q.column_text(5)?,
                supersedes_id: q.column_optional_text(6)?,
                actor_id: q.column_text(7)?,
                operation_id: q.column_text(8)?,
                project_revision: q.column_u64(9)?,
                created_at: q.column_text(10)?,
            })
        }
        Ok(out)
    }
    pub fn review_knowledge_claim(
        &self,
        context: &V3MutationContext,
        row: &KnowledgeClaimReviewRecord,
    ) -> Result<MutationResult, StoreError> {
        if row.project_id != context.project_id
            || row.actor_id != context.actor_id
            || empty(&row.reason)
            || !matches!(
                row.decision.as_str(),
                "accepted" | "rejected" | "needs_revision"
            )
        {
            return Err(StoreError::Invalid(
                "claim review requires same-project identity, a supported decision, and a reason"
                    .into(),
            ));
        }
        let bound=context.with_payload(json!({"review_id":row.review_id,"claim_id":row.claim_id,"decision":row.decision,"reason":row.reason}));
        self.fact_mutation(&bound,"knowledge.claim.review","knowledge_claim",&row.claim_id,&[ActorRole::Reviewer,ActorRole::Operator],||{let claim=self.knowledge_claim(&row.project_id,&row.claim_id)?.ok_or_else(||StoreError::NotFound{entity:"knowledge_claim",id:row.claim_id.clone()})?;let source=self.source_version(&row.project_id,&claim.source_version_id)?.ok_or_else(||StoreError::Conflict("claim source no longer exists".into()))?;if source.availability!="available"{return Err(StoreError::Conflict("claim source is no longer available for review".into()))}let mut q=self.prepare("INSERT INTO boreal_knowledge_claim_review_v1(project_id,review_id,claim_id,decision,reason,actor_id,operation_id,project_revision,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)")?;q.bind_text(1,&row.project_id)?;q.bind_text(2,&row.review_id)?;q.bind_text(3,&row.claim_id)?;q.bind_text(4,&row.decision)?;q.bind_text(5,&row.reason)?;q.bind_text(6,&context.actor_id)?;q.bind_text(7,&context.operation_id)?;q.bind_i64(8,self.project_revision(&context.project_id)?.0+1)?;q.bind_text(9,&context.now)?;q.run()})
    }
    pub fn knowledge_claim_reviews(
        &self,
        project: &str,
        id: &str,
    ) -> Result<Vec<KnowledgeClaimReviewRecord>, StoreError> {
        let mut q=self.prepare("SELECT project_id,review_id,claim_id,decision,reason,actor_id,operation_id,project_revision,created_at FROM boreal_knowledge_claim_review_v1 WHERE project_id=?1 AND claim_id=?2 ORDER BY project_revision,review_id")?;
        q.bind_text(1, project)?;
        q.bind_text(2, id)?;
        let mut out = Vec::new();
        while q.step()? == SQLITE_ROW {
            out.push(KnowledgeClaimReviewRecord {
                project_id: q.column_text(0)?,
                review_id: q.column_text(1)?,
                claim_id: q.column_text(2)?,
                decision: q.column_text(3)?,
                reason: q.column_text(4)?,
                actor_id: q.column_text(5)?,
                operation_id: q.column_text(6)?,
                project_revision: q.column_u64(7)?,
                created_at: q.column_text(8)?,
            })
        }
        Ok(out)
    }
}
fn empty(value: &str) -> bool {
    value.trim().is_empty()
}
