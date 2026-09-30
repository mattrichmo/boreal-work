//! Transactional storage for duplicate lineage and versioned compaction notes.
//! Originals are immutable; these records only add explicit relationships or
//! derived summaries tied to exact source revisions.
use super::*;
use serde_json::json;

pub const KNOWLEDGE_MAINTENANCE_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS boreal_maintenance_lineage_v1 (
  project_id TEXT NOT NULL, operation_id TEXT NOT NULL, source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL, canonical_kind TEXT NOT NULL, canonical_id TEXT NOT NULL,
  plan_digest TEXT NOT NULL, source_digest TEXT NOT NULL, canonical_digest TEXT NOT NULL,
  actor_id TEXT NOT NULL, project_revision INTEGER NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY(project_id,source_kind,source_id), UNIQUE(project_id,operation_id)
);
CREATE INDEX IF NOT EXISTS boreal_maintenance_lineage_canonical_v1
  ON boreal_maintenance_lineage_v1(project_id,canonical_kind,canonical_id,project_revision DESC);
CREATE TABLE IF NOT EXISTS boreal_compaction_summary_v1 (
  project_id TEXT NOT NULL, summary_id TEXT NOT NULL, source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL, source_revision INTEGER NOT NULL, source_digest TEXT NOT NULL,
  summary_digest TEXT NOT NULL, summary_text TEXT NOT NULL, actor_id TEXT NOT NULL,
  operation_id TEXT NOT NULL, project_revision INTEGER NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY(project_id,summary_id), UNIQUE(project_id,operation_id)
);
CREATE INDEX IF NOT EXISTS boreal_compaction_summary_history_v1
  ON boreal_compaction_summary_v1(project_id,source_kind,source_id,project_revision DESC);
CREATE INDEX IF NOT EXISTS boreal_compaction_summary_current_v1
  ON boreal_compaction_summary_v1(project_id,source_kind,source_id,source_digest,project_revision DESC);
CREATE TRIGGER IF NOT EXISTS boreal_maintenance_lineage_v1_no_update BEFORE UPDATE ON boreal_maintenance_lineage_v1
BEGIN SELECT RAISE(ABORT,'maintenance_lineage_is_immutable'); END;
CREATE TRIGGER IF NOT EXISTS boreal_maintenance_lineage_v1_no_delete BEFORE DELETE ON boreal_maintenance_lineage_v1
BEGIN SELECT RAISE(ABORT,'maintenance_lineage_is_immutable'); END;
CREATE TRIGGER IF NOT EXISTS boreal_compaction_summary_v1_no_update BEFORE UPDATE ON boreal_compaction_summary_v1
BEGIN SELECT RAISE(ABORT,'compaction_summary_is_immutable'); END;
CREATE TRIGGER IF NOT EXISTS boreal_compaction_summary_v1_no_delete BEFORE DELETE ON boreal_compaction_summary_v1
BEGIN SELECT RAISE(ABORT,'compaction_summary_is_immutable'); END;
"#;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MaintenanceCandidate {
    pub kind: String,
    pub id: String,
    pub title: String,
    pub content: String,
    pub content_digest: String,
    pub revision: u64,
    pub lifecycle: Option<String>,
    pub active_attempt: bool,
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct KnowledgeMaintenanceSnapshot {
    pub revision: u64,
    pub candidates: Vec<MaintenanceCandidate>,
    pub truncated: bool,
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MaintenanceLineageRecord {
    pub source_kind: String,
    pub source_id: String,
    pub canonical_kind: String,
    pub canonical_id: String,
    pub plan_digest: String,
    pub source_digest: String,
    pub canonical_digest: String,
    pub revision: u64,
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CompactionSummaryRecord {
    pub summary_id: String,
    pub source_kind: String,
    pub source_id: String,
    pub source_revision: u64,
    pub source_digest: String,
    pub summary_digest: String,
    pub summary_text: String,
    pub revision: u64,
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MaintenanceAnnotationsSnapshot {
    pub revision: u64,
    pub lineage: Vec<MaintenanceLineageRecord>,
    pub lineage_total: u64,
    pub summaries: Vec<CompactionSummaryRecord>,
    pub summary_total: u64,
    pub current_source_digest: Option<String>,
    pub current_summary_id: Option<String>,
}

pub fn ensure_schema(store: &SqliteStore) -> Result<(), StoreError> {
    store.execute_batch(KNOWLEDGE_MAINTENANCE_SCHEMA)
}

impl SqliteStore {
    pub fn ensure_knowledge_maintenance_schema(&self) -> Result<(), StoreError> {
        self.install_feature_schema("knowledge_maintenance", 1, KNOWLEDGE_MAINTENANCE_SCHEMA)
    }

    fn maintenance_count(&self, table: &str, project: &str) -> Result<u64, StoreError> {
        if !matches!(
            table,
            "work_item"
                | "source_version"
                | "boreal_decision_v1"
                | "boreal_knowledge_claim_v1"
                | "boreal_memory_draft"
        ) {
            return Err(StoreError::Invalid("unsupported maintenance table".into()));
        }
        if !self.table_exists(table)? {
            return Ok(0);
        }
        let sql = format!("SELECT COUNT(*) FROM {table} WHERE project_id=?1");
        let mut row = self.prepare(&sql)?;
        row.bind_text(1, project)?;
        if row.step()? == SQLITE_ROW {
            row.column_u64(0)
        } else {
            Err(StoreError::Corrupt("maintenance count is missing".into()))
        }
    }

    /// Captures an ordered, bounded project snapshot under one read transaction.
    pub fn knowledge_maintenance_snapshot(
        &self,
        project: &str,
        limit: u64,
    ) -> Result<KnowledgeMaintenanceSnapshot, StoreError> {
        if limit == 0 || limit > 10_000 {
            return Err(StoreError::Invalid(
                "maintenance scan limit must be 1..=10000".into(),
            ));
        }
        self.execute_batch("BEGIN")?;
        let result = (|| {
            let revision = self.project_revision(project)?.0;
            let mut out = Vec::new();
            let truncated = [
                "work_item",
                "source_version",
                "boreal_decision_v1",
                "boreal_knowledge_claim_v1",
                "boreal_memory_draft",
            ]
            .iter()
            .try_fold(false, |found, table| {
                Ok::<bool, StoreError>(found || self.maintenance_count(table, project)? > limit)
            })?;
            let mut rows = self.prepare("SELECT w.work_id,w.title,w.description,w.lifecycle,(SELECT COUNT(*) FROM attempt a WHERE a.work_id=w.work_id AND a.current=1 AND a.state IN ('claimed','accepted','running','verifying','expiry_pending')) FROM work_item w WHERE w.project_id=?1 ORDER BY w.work_id LIMIT ?2")?;
            rows.bind_text(1, project)?;
            rows.bind_i64(2, limit)?;
            while rows.step()? == SQLITE_ROW {
                let id = rows.column_text(0)?;
                let title = rows.column_text(1)?;
                let content = rows.column_text(2)?;
                out.push(MaintenanceCandidate {
                    kind: "work".into(),
                    id,
                    title,
                    content_digest: super::checksum(content.as_bytes()),
                    content,
                    revision,
                    lifecycle: Some(rows.column_text(3)?),
                    active_attempt: rows.column_u64(4)? > 0,
                });
            }
            if self.table_exists("source_version")? {
                let mut rows=self.prepare("SELECT source_version_id,origin,content_digest,availability FROM source_version WHERE project_id=?1 ORDER BY source_version_id LIMIT ?2")?;
                rows.bind_text(1, project)?;
                rows.bind_i64(2, limit)?;
                while rows.step()? == SQLITE_ROW {
                    let id = rows.column_text(0)?;
                    let title = rows.column_text(1)?;
                    let digest = rows.column_text(2)?;
                    let state = rows.column_text(3)?;
                    out.push(MaintenanceCandidate {
                        kind: "source".into(),
                        id,
                        title,
                        content: digest.clone(),
                        content_digest: digest,
                        revision,
                        lifecycle: Some(state),
                        active_attempt: false,
                    });
                }
            }
            if self.table_exists("boreal_decision_v1")? {
                let mut rows=self.prepare("SELECT decision_id,title,body,rationale,project_revision FROM boreal_decision_v1 WHERE project_id=?1 ORDER BY decision_id LIMIT ?2")?;
                rows.bind_text(1, project)?;
                rows.bind_i64(2, limit)?;
                while rows.step()? == SQLITE_ROW {
                    let id = rows.column_text(0)?;
                    let title = rows.column_text(1)?;
                    let content = format!("{}\n{}", rows.column_text(2)?, rows.column_text(3)?);
                    out.push(MaintenanceCandidate {
                        kind: "decision".into(),
                        id,
                        title,
                        content_digest: super::checksum(content.as_bytes()),
                        content,
                        revision: rows.column_u64(4)?,
                        lifecycle: None,
                        active_attempt: false,
                    });
                }
            }
            if self.table_exists("boreal_knowledge_claim_v1")? {
                let mut rows=self.prepare("SELECT claim_id,statement,content_digest,project_revision FROM boreal_knowledge_claim_v1 WHERE project_id=?1 ORDER BY claim_id LIMIT ?2")?;
                rows.bind_text(1, project)?;
                rows.bind_i64(2, limit)?;
                while rows.step()? == SQLITE_ROW {
                    let id = rows.column_text(0)?;
                    let title = rows.column_text(1)?;
                    let digest = rows.column_text(2)?;
                    let content = title.clone();
                    out.push(MaintenanceCandidate {
                        kind: "claim".into(),
                        id,
                        title,
                        content,
                        content_digest: digest,
                        revision: rows.column_u64(3)?,
                        lifecycle: None,
                        active_attempt: false,
                    });
                }
            }
            if self.table_exists("boreal_memory_draft")? {
                let mut rows=self.prepare("SELECT draft_id,title,body,citations_json,content_digest,project_revision FROM boreal_memory_draft WHERE project_id=?1 ORDER BY draft_id LIMIT ?2")?;
                rows.bind_text(1, project)?;
                rows.bind_i64(2, limit)?;
                while rows.step()? == SQLITE_ROW {
                    let title = rows.column_text(1)?;
                    let body = rows.column_text(2)?;
                    let citations = rows.column_text(3)?;
                    out.push(MaintenanceCandidate {
                        kind: "memory_draft".into(),
                        id: rows.column_text(0)?,
                        title,
                        content: format!("{body}\n{citations}"),
                        content_digest: rows.column_text(4)?,
                        revision: rows.column_u64(5)?,
                        lifecycle: None,
                        active_attempt: false,
                    });
                }
            }
            out.sort_by(|a, b| (&a.kind, &a.id).cmp(&(&b.kind, &b.id)));
            Ok(KnowledgeMaintenanceSnapshot {
                revision,
                candidates: out,
                truncated,
            })
        })();
        finish_transaction(self, result)
    }

    /// Append lineage after validating the endpoint snapshot and fencing the
    /// mutation to that exact revision in the journal/audit transaction.
    pub fn record_maintenance_lineage(
        &self,
        context: &V3MutationContext,
        source_kind: &str,
        source_id: &str,
        canonical_kind: &str,
        canonical_id: &str,
        plan_digest: &str,
        source_digest: &str,
        canonical_digest: &str,
    ) -> Result<MutationResult, StoreError> {
        if source_kind != canonical_kind {
            return Err(StoreError::Invalid(
                "merge lineage must connect records of the same kind".into(),
            ));
        }
        let expected = context.expected_revision.ok_or_else(|| {
            StoreError::Invalid("merge apply requires an expected project revision".into())
        })?;
        let snapshot = self.knowledge_maintenance_snapshot(context.project_id.as_str(), 10_000)?;
        if snapshot.revision != expected {
            return Err(StoreError::Conflict(
                "project revision changed; rescan and build a fresh merge plan".into(),
            ));
        }
        if snapshot.truncated {
            return Err(StoreError::Conflict(
                "project exceeds the bounded merge verification window".into(),
            ));
        }
        let source = snapshot
            .candidates
            .iter()
            .find(|x| x.kind == source_kind && x.id == source_id)
            .ok_or_else(|| StoreError::NotFound {
                entity: "merge_source",
                id: source_id.into(),
            })?;
        let canonical = snapshot
            .candidates
            .iter()
            .find(|x| x.kind == canonical_kind && x.id == canonical_id)
            .ok_or_else(|| StoreError::NotFound {
                entity: "merge_canonical",
                id: canonical_id.into(),
            })?;
        if source.active_attempt || canonical.active_attempt {
            return Err(StoreError::Conflict(
                "merge is blocked while either work item has an active attempt".into(),
            ));
        }
        if source.content_digest != source_digest || canonical.content_digest != canonical_digest {
            return Err(StoreError::Conflict(
                "merge endpoint content changed; build a fresh plan".into(),
            ));
        }
        let payload = json!({"source_kind":source_kind,"source_id":source_id,"canonical_kind":canonical_kind,"canonical_id":canonical_id,"plan_digest":plan_digest,"source_digest":source_digest,"canonical_digest":canonical_digest});
        let bound = context.with_payload(payload.clone());
        self.fact_mutation(&bound,"maintenance.merge.apply","maintenance_lineage",source_id,&[boreal_domain::ActorRole::Operator],||{
            if source_kind==canonical_kind && source_id==canonical_id { return Err(StoreError::Invalid("cannot merge an item into itself".into())); }
            let mut source_links=self.prepare("SELECT 1 FROM boreal_maintenance_lineage_v1 WHERE project_id=?1 AND ((source_kind=?2 AND source_id=?3) OR (canonical_kind=?2 AND canonical_id=?3)) LIMIT 1")?;source_links.bind_text(1,&context.project_id)?;source_links.bind_text(2,source_kind)?;source_links.bind_text(3,source_id)?;
            if source_links.step()?==SQLITE_ROW{return Err(StoreError::Conflict("merge source already participates in lineage; chained or repeated merges are not allowed".into()));}
            let mut canonical_alias=self.prepare("SELECT 1 FROM boreal_maintenance_lineage_v1 WHERE project_id=?1 AND source_kind=?2 AND source_id=?3 LIMIT 1")?;canonical_alias.bind_text(1,&context.project_id)?;canonical_alias.bind_text(2,canonical_kind)?;canonical_alias.bind_text(3,canonical_id)?;
            if canonical_alias.step()?==SQLITE_ROW{return Err(StoreError::Conflict("canonical endpoint is already an alias; choose a terminal canonical item".into()));}
            let mut row=self.prepare("INSERT INTO boreal_maintenance_lineage_v1(project_id,operation_id,source_kind,source_id,canonical_kind,canonical_id,plan_digest,source_digest,canonical_digest,actor_id,project_revision,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)")?;
            row.bind_text(1,&context.project_id)?;row.bind_text(2,&context.operation_id)?;row.bind_text(3,source_kind)?;row.bind_text(4,source_id)?;row.bind_text(5,canonical_kind)?;row.bind_text(6,canonical_id)?;row.bind_text(7,plan_digest)?;row.bind_text(8,source_digest)?;row.bind_text(9,canonical_digest)?;row.bind_text(10,&context.actor_id)?;row.bind_i64(11,self.project_revision(&context.project_id)?.0+1)?;row.bind_text(12,&context.now)?;row.run()
        })
    }

    pub fn maintenance_lineage_for_item(
        &self,
        project: &str,
        kind: &str,
        id: &str,
        limit: u64,
        offset: u64,
    ) -> Result<Vec<MaintenanceLineageRecord>, StoreError> {
        if limit == 0 || limit > 100 {
            return Err(StoreError::Invalid(
                "lineage page size must be 1..=100".into(),
            ));
        }
        let mut rows=self.prepare("SELECT source_kind,source_id,canonical_kind,canonical_id,plan_digest,source_digest,canonical_digest,project_revision FROM boreal_maintenance_lineage_v1 WHERE project_id=?1 AND ((source_kind=?2 AND source_id=?3) OR (canonical_kind=?2 AND canonical_id=?3)) ORDER BY project_revision DESC,source_id LIMIT ?4 OFFSET ?5")?;
        rows.bind_text(1, project)?;
        rows.bind_text(2, kind)?;
        rows.bind_text(3, id)?;
        rows.bind_i64(4, limit)?;
        rows.bind_i64(5, offset)?;
        let mut out = Vec::new();
        while rows.step()? == SQLITE_ROW {
            out.push(MaintenanceLineageRecord {
                source_kind: rows.column_text(0)?,
                source_id: rows.column_text(1)?,
                canonical_kind: rows.column_text(2)?,
                canonical_id: rows.column_text(3)?,
                plan_digest: rows.column_text(4)?,
                source_digest: rows.column_text(5)?,
                canonical_digest: rows.column_text(6)?,
                revision: rows.column_u64(7)?,
            });
        }
        Ok(out)
    }

    pub fn compaction_summaries_for_source(
        &self,
        project: &str,
        kind: &str,
        id: &str,
        limit: u64,
        offset: u64,
    ) -> Result<Vec<CompactionSummaryRecord>, StoreError> {
        if limit == 0 || limit > 100 {
            return Err(StoreError::Invalid(
                "compaction history page size must be 1..=100".into(),
            ));
        }
        let mut rows=self.prepare("SELECT summary_id,source_kind,source_id,source_revision,source_digest,summary_digest,summary_text,project_revision FROM boreal_compaction_summary_v1 WHERE project_id=?1 AND source_kind=?2 AND source_id=?3 ORDER BY project_revision DESC,summary_id DESC LIMIT ?4 OFFSET ?5")?;
        rows.bind_text(1, project)?;
        rows.bind_text(2, kind)?;
        rows.bind_text(3, id)?;
        rows.bind_i64(4, limit)?;
        rows.bind_i64(5, offset)?;
        let mut out = Vec::new();
        while rows.step()? == SQLITE_ROW {
            out.push(CompactionSummaryRecord {
                summary_id: rows.column_text(0)?,
                source_kind: rows.column_text(1)?,
                source_id: rows.column_text(2)?,
                source_revision: rows.column_u64(3)?,
                source_digest: rows.column_text(4)?,
                summary_digest: rows.column_text(5)?,
                summary_text: rows.column_text(6)?,
                revision: rows.column_u64(7)?,
            });
        }
        Ok(out)
    }

    pub fn maintenance_annotations_snapshot(
        &self,
        project: &str,
        kind: &str,
        id: &str,
        limit: u64,
        offset: u64,
    ) -> Result<MaintenanceAnnotationsSnapshot, StoreError> {
        self.execute_batch("BEGIN")?;
        let result = (|| {
            let revision = self.project_revision(project)?.0;
            let lineage = self.maintenance_lineage_for_item(project, kind, id, limit, offset)?;
            let summaries =
                self.compaction_summaries_for_source(project, kind, id, limit, offset)?;
            let mut lq=self.prepare("SELECT COUNT(*) FROM boreal_maintenance_lineage_v1 WHERE project_id=?1 AND ((source_kind=?2 AND source_id=?3) OR (canonical_kind=?2 AND canonical_id=?3))")?;
            lq.bind_text(1, project)?;
            lq.bind_text(2, kind)?;
            lq.bind_text(3, id)?;
            let lineage_total = if lq.step()? == SQLITE_ROW {
                lq.column_u64(0)?
            } else {
                0
            };
            let mut sq=self.prepare("SELECT COUNT(*) FROM boreal_compaction_summary_v1 WHERE project_id=?1 AND source_kind=?2 AND source_id=?3")?;
            sq.bind_text(1, project)?;
            sq.bind_text(2, kind)?;
            sq.bind_text(3, id)?;
            let summary_total = if sq.step()? == SQLITE_ROW {
                sq.column_u64(0)?
            } else {
                0
            };
            let current_source_digest = self.maintenance_current_digest(project, kind, id)?;
            let current_summary_id = if let Some(digest) = current_source_digest.as_deref() {
                let mut q=self.prepare("SELECT summary_id FROM boreal_compaction_summary_v1 WHERE project_id=?1 AND source_kind=?2 AND source_id=?3 AND source_digest=?4 ORDER BY project_revision DESC,summary_id DESC LIMIT 1")?;
                q.bind_text(1, project)?;
                q.bind_text(2, kind)?;
                q.bind_text(3, id)?;
                q.bind_text(4, digest)?;
                if q.step()? == SQLITE_ROW {
                    Some(q.column_text(0)?)
                } else {
                    None
                }
            } else {
                None
            };
            Ok(MaintenanceAnnotationsSnapshot {
                revision,
                lineage,
                lineage_total,
                summaries,
                summary_total,
                current_source_digest,
                current_summary_id,
            })
        })();
        finish_transaction(self, result)
    }

    fn maintenance_current_digest(
        &self,
        project: &str,
        kind: &str,
        id: &str,
    ) -> Result<Option<String>, StoreError> {
        let (sql, is_text) = match kind {
            "work" => (
                "SELECT description FROM work_item WHERE project_id=?1 AND work_id=?2",
                true,
            ),
            "source" => (
                "SELECT content_digest FROM source_version WHERE project_id=?1 AND source_version_id=?2",
                false,
            ),
            "decision" => (
                "SELECT body,rationale FROM boreal_decision_v1 WHERE project_id=?1 AND decision_id=?2",
                true,
            ),
            "claim" => (
                "SELECT content_digest FROM boreal_knowledge_claim_v1 WHERE project_id=?1 AND claim_id=?2",
                false,
            ),
            "memory_draft" => (
                "SELECT content_digest FROM boreal_memory_draft WHERE project_id=?1 AND draft_id=?2",
                false,
            ),
            _ => return Ok(None),
        };
        if (kind == "source" && !self.table_exists("source_version")?)
            || (kind == "decision" && !self.table_exists("boreal_decision_v1")?)
            || (kind == "claim" && !self.table_exists("boreal_knowledge_claim_v1")?)
            || (kind == "memory_draft" && !self.table_exists("boreal_memory_draft")?)
        {
            return Ok(None);
        }
        let mut row = self.prepare(sql)?;
        row.bind_text(1, project)?;
        row.bind_text(2, id)?;
        if row.step()? != SQLITE_ROW {
            return Ok(None);
        }
        let digest = if kind == "decision" {
            super::checksum(format!("{}\n{}", row.column_text(0)?, row.column_text(1)?).as_bytes())
        } else if is_text {
            super::checksum(row.column_text(0)?.as_bytes())
        } else {
            row.column_text(0)?
        };
        Ok(Some(digest))
    }

    /// Reconcile an exact merge replay before the application tries to build a
    /// fresh plan (which may now have a newer project revision).
    pub fn maintenance_lineage_replay(
        &self,
        context: &V3MutationContext,
        source_kind: &str,
        source_id: &str,
        canonical_kind: &str,
        canonical_id: &str,
        plan_digest: &str,
    ) -> Result<Option<(MutationResult, MaintenanceLineageRecord)>, StoreError> {
        let Some(op) = self.operation(&context.operation_id)? else {
            return Ok(None);
        };
        if op.project_id != context.project_id
            || op.command != "maintenance.merge.apply"
            || op.actor_id != context.actor_id
            || op.session_id != context.session_id
            || op.expected_revision != context.expected_revision
        {
            return Err(StoreError::Conflict(
                "operation ID was already used with another maintenance request identity".into(),
            ));
        }
        let mut row=self.prepare("SELECT source_kind,source_id,canonical_kind,canonical_id,plan_digest,source_digest,canonical_digest,project_revision FROM boreal_maintenance_lineage_v1 WHERE project_id=?1 AND operation_id=?2")?;
        row.bind_text(1, &context.project_id)?;
        row.bind_text(2, &context.operation_id)?;
        if row.step()? != SQLITE_ROW {
            return Err(StoreError::Corrupt(
                "merge operation has no lineage readback".into(),
            ));
        }
        let record = MaintenanceLineageRecord {
            source_kind: row.column_text(0)?,
            source_id: row.column_text(1)?,
            canonical_kind: row.column_text(2)?,
            canonical_id: row.column_text(3)?,
            plan_digest: row.column_text(4)?,
            source_digest: row.column_text(5)?,
            canonical_digest: row.column_text(6)?,
            revision: row.column_u64(7)?,
        };
        if record.source_kind != source_kind
            || record.source_id != source_id
            || record.canonical_kind != canonical_kind
            || record.canonical_id != canonical_id
            || record.plan_digest != plan_digest
        {
            return Err(StoreError::Conflict(
                "operation ID was replayed with a different merge plan".into(),
            ));
        }
        let payload = json!({"source_kind":record.source_kind,"source_id":record.source_id,"canonical_kind":record.canonical_kind,"canonical_id":record.canonical_id,"plan_digest":record.plan_digest,"source_digest":record.source_digest,"canonical_digest":record.canonical_digest});
        if op.request_digest != context.with_payload(payload).request_digest {
            return Err(StoreError::Conflict(
                "operation request digest mismatch".into(),
            ));
        }
        Ok(Some((
            MutationResult {
                operation_id: op.operation_id,
                revision: op.revision,
                replayed: true,
            },
            record,
        )))
    }

    pub fn compaction_summary_replay(
        &self,
        context: &V3MutationContext,
        source_kind: &str,
        source_id: &str,
        source_revision: u64,
        source_digest: &str,
        summary_digest: &str,
        summary_text: &str,
    ) -> Result<Option<(MutationResult, CompactionSummaryRecord)>, StoreError> {
        let Some(op) = self.operation(&context.operation_id)? else {
            return Ok(None);
        };
        if op.project_id != context.project_id
            || op.command != "maintenance.compact.apply"
            || op.actor_id != context.actor_id
            || op.session_id != context.session_id
            || op.expected_revision != context.expected_revision
        {
            return Err(StoreError::Conflict(
                "operation ID was already used with another maintenance request identity".into(),
            ));
        }
        let mut row=self.prepare("SELECT summary_id,source_kind,source_id,source_revision,source_digest,summary_digest,summary_text,project_revision FROM boreal_compaction_summary_v1 WHERE project_id=?1 AND operation_id=?2")?;
        row.bind_text(1, &context.project_id)?;
        row.bind_text(2, &context.operation_id)?;
        if row.step()? != SQLITE_ROW {
            return Err(StoreError::Corrupt(
                "compaction operation has no summary readback".into(),
            ));
        }
        let record = CompactionSummaryRecord {
            summary_id: row.column_text(0)?,
            source_kind: row.column_text(1)?,
            source_id: row.column_text(2)?,
            source_revision: row.column_u64(3)?,
            source_digest: row.column_text(4)?,
            summary_digest: row.column_text(5)?,
            summary_text: row.column_text(6)?,
            revision: row.column_u64(7)?,
        };
        if record.source_kind != source_kind
            || record.source_id != source_id
            || record.source_revision != source_revision
            || record.source_digest != source_digest
            || record.summary_digest != summary_digest
            || record.summary_text != summary_text
        {
            return Err(StoreError::Conflict(
                "operation ID was replayed with a different compaction input".into(),
            ));
        }
        let payload = json!({"summary_id":record.summary_id,"source_kind":record.source_kind,"source_id":record.source_id,"source_revision":record.source_revision,"source_digest":record.source_digest,"summary_digest":record.summary_digest,"summary_text":record.summary_text});
        if op.request_digest != context.with_payload(payload).request_digest {
            return Err(StoreError::Conflict(
                "operation request digest mismatch".into(),
            ));
        }
        Ok(Some((
            MutationResult {
                operation_id: op.operation_id,
                revision: op.revision,
                replayed: true,
            },
            record,
        )))
    }

    pub fn record_compaction_summary(
        &self,
        context: &V3MutationContext,
        summary_id: &str,
        source_kind: &str,
        source_id: &str,
        source_revision: u64,
        source_digest: &str,
        summary_digest: &str,
        summary_text: &str,
    ) -> Result<MutationResult, StoreError> {
        let expected = context.expected_revision.ok_or_else(|| {
            StoreError::Invalid("compact apply requires an expected project revision".into())
        })?;
        let snapshot = self.knowledge_maintenance_snapshot(context.project_id.as_str(), 10_000)?;
        if snapshot.revision != expected {
            return Err(StoreError::Conflict(
                "project revision changed; analyze again before applying compaction".into(),
            ));
        }
        let source = snapshot
            .candidates
            .iter()
            .find(|x| x.kind == source_kind && x.id == source_id)
            .ok_or_else(|| StoreError::NotFound {
                entity: "compaction_source",
                id: source_id.into(),
            })?;
        if source.revision != source_revision || source.content_digest != source_digest {
            return Err(StoreError::Conflict(
                "compaction source revision changed; analyze again".into(),
            ));
        }
        if source.active_attempt {
            return Err(StoreError::Conflict(
                "compaction is blocked while the source work item has an active attempt".into(),
            ));
        }
        let payload = json!({"summary_id":summary_id,"source_kind":source_kind,"source_id":source_id,"source_revision":source_revision,"source_digest":source_digest,"summary_digest":summary_digest,"summary_text":summary_text});
        let bound = context.with_payload(payload);
        self.fact_mutation(&bound,"maintenance.compact.apply","compaction_summary",summary_id,&[boreal_domain::ActorRole::Operator],||{
            let mut row=self.prepare("INSERT INTO boreal_compaction_summary_v1(project_id,summary_id,source_kind,source_id,source_revision,source_digest,summary_digest,summary_text,actor_id,operation_id,project_revision,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)")?;
            row.bind_text(1,&context.project_id)?;row.bind_text(2,summary_id)?;row.bind_text(3,source_kind)?;row.bind_text(4,source_id)?;row.bind_i64(5,source_revision)?;row.bind_text(6,source_digest)?;row.bind_text(7,summary_digest)?;row.bind_text(8,summary_text)?;row.bind_text(9,&context.actor_id)?;row.bind_text(10,&context.operation_id)?;row.bind_i64(11,self.project_revision(&context.project_id)?.0+1)?;row.bind_text(12,&context.now)?;row.run()
        })
    }
}
