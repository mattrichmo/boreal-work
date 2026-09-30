//! Review-first duplicate and compaction workflows. These use cases create
//! version-bound plans; the store preserves source records and writes only
//! append-only lineage or summary records.
use boreal_store::{SqliteStore, V3MutationContext};
use serde_json::{Value, json};

use crate::{ApplicationError, OperationResult, sha256_content_digest};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MaintenancePlan {
    pub project_id: String,
    pub revision: u64,
    pub plan_digest: String,
    pub source_kind: String,
    pub source_id: String,
    pub canonical_kind: Option<String>,
    pub canonical_id: Option<String>,
    pub source_digest: String,
    pub canonical_digest: Option<String>,
}

pub struct KnowledgeMaintenanceApplication<'a> {
    store: &'a SqliteStore,
}

impl<'a> KnowledgeMaintenanceApplication<'a> {
    pub fn new(store: &'a SqliteStore) -> Self {
        Self { store }
    }

    pub fn duplicate_scan(&self, project: &str, limit: u64) -> Result<Value, ApplicationError> {
        let snapshot = self.store.knowledge_maintenance_snapshot(project, limit)?;
        if snapshot.truncated {
            return Err(ApplicationError::Invalid(
                "duplicate scan is incomplete at this bound; raise --limit and scan again".into(),
            ));
        }
        let revision = snapshot.revision;
        let items = snapshot.candidates;
        let mut groups = std::collections::BTreeMap::<(String, String), Vec<Value>>::new();
        for item in &items {
            let normalized = if matches!(item.kind.as_str(), "source" | "claim") {
                item.content_digest.clone()
            } else {
                format!("{}\n{}", normalize(&item.title), normalize(&item.content))
            };
            let identity = sha256_content_digest(normalized.as_bytes());
            groups.entry((item.kind.clone(),identity)).or_default().push(json!({"id":item.id,"title":item.title,"revision":item.revision,"content_digest":item.content_digest,"lifecycle":item.lifecycle,"active_attempt":item.active_attempt}));
        }
        let duplicates:Vec<Value>=groups.into_iter().filter(|(_,members)|members.len()>1).map(|((kind,identity_digest),members)|json!({"kind":kind,"identity_digest":identity_digest,"members":members})).collect();
        Ok(
            json!({"schema":"boreal.maintenance.duplicate-scan.v1","project_id":project,"revision":revision,"scanned":items.len(),"limit_per_kind":limit,"possibly_truncated":snapshot.truncated,"groups":duplicates,"scope":["work","source","decision","claim","memory_draft"],"published_git_memory":"the CLI adds separately validated committed Git memory groups when a manifest exists"}),
        )
    }

    pub fn merge_plan(
        &self,
        project: &str,
        source_kind: &str,
        source_id: &str,
        canonical_kind: &str,
        canonical_id: &str,
    ) -> Result<MaintenancePlan, ApplicationError> {
        if source_kind != canonical_kind {
            return Err(ApplicationError::Invalid(
                "merge lineage must connect records of the same kind".into(),
            ));
        }
        if source_kind == canonical_kind && source_id == canonical_id {
            return Err(ApplicationError::Invalid(
                "merge source and canonical item must differ".into(),
            ));
        }
        let snapshot = self.store.knowledge_maintenance_snapshot(project, 10_000)?;
        let revision = snapshot.revision;
        let items = snapshot.candidates;
        if snapshot.truncated {
            return Err(ApplicationError::Invalid("project exceeds the bounded merge planning window; narrow the project before planning".into()));
        }
        let source = items
            .iter()
            .find(|item| item.kind == source_kind && item.id == source_id)
            .ok_or_else(|| {
                ApplicationError::Invalid("merge source was not found in this project".into())
            })?;
        let canonical = items
            .iter()
            .find(|item| item.kind == canonical_kind && item.id == canonical_id)
            .ok_or_else(|| {
                ApplicationError::Invalid("canonical item was not found in this project".into())
            })?;
        if source.active_attempt || canonical.active_attempt {
            return Err(ApplicationError::Invalid(
                "merge is blocked while either work item has an active attempt".into(),
            ));
        }
        let payload = json!({"schema":"boreal.maintenance.merge-plan.v1","project_id":project,"revision":revision,"source_kind":source_kind,"source_id":source_id,"source_digest":source.content_digest,"source_revision":source.revision,"canonical_kind":canonical_kind,"canonical_id":canonical_id,"canonical_digest":canonical.content_digest,"canonical_revision":canonical.revision,"semantics":"append-only alias/supersession lineage; originals and proof remain unchanged"});
        Ok(MaintenancePlan {
            project_id: project.into(),
            revision,
            plan_digest: sha256_content_digest(payload.to_string().as_bytes()),
            source_kind: source_kind.into(),
            source_id: source_id.into(),
            canonical_kind: Some(canonical_kind.into()),
            canonical_id: Some(canonical_id.into()),
            source_digest: source.content_digest.clone(),
            canonical_digest: Some(canonical.content_digest.clone()),
        })
    }

    /// Read durable merge annotations and every retained compaction version
    /// for a project-scoped record. Consumers may show the newest summary as
    /// current context, but older summary versions and original content remain.
    pub fn maintenance_annotations(
        &self,
        project: &str,
        kind: &str,
        id: &str,
        limit: u64,
        offset: u64,
    ) -> Result<Value, ApplicationError> {
        let snapshot = self
            .store
            .maintenance_annotations_snapshot(project, kind, id, limit, offset)?;
        let current = snapshot.current_summary_id.clone();
        let lineage_next = offset
            .checked_add(limit)
            .filter(|next| *next < snapshot.lineage_total);
        let summary_next = offset
            .checked_add(limit)
            .filter(|next| *next < snapshot.summary_total);
        Ok(
            json!({"project_id":project,"revision":snapshot.revision,"kind":kind,"id":id,"lineage":snapshot.lineage.iter().map(|r|json!({"source_kind":r.source_kind,"source_id":r.source_id,"canonical_kind":r.canonical_kind,"canonical_id":r.canonical_id,"plan_digest":r.plan_digest,"source_digest":r.source_digest,"canonical_digest":r.canonical_digest,"revision":r.revision})).collect::<Vec<_>>(),"lineage_total":snapshot.lineage_total,"lineage_next_offset":lineage_next,"summaries":snapshot.summaries.iter().map(|r|json!({"summary_id":r.summary_id,"source_kind":r.source_kind,"source_id":r.source_id,"source_revision":r.source_revision,"source_digest":r.source_digest,"summary_digest":r.summary_digest,"summary_text":r.summary_text,"revision":r.revision,"matches_current_source":snapshot.current_source_digest.as_deref()==Some(r.source_digest.as_str())})).collect::<Vec<_>>(),"summary_total":snapshot.summary_total,"summary_next_offset":summary_next,"current_source_digest":snapshot.current_source_digest,"current_summary_id":current,"original_preserved":true}),
        )
    }

    pub fn apply_merge(
        &self,
        context: &V3MutationContext,
        expected_plan_digest: &str,
        source_kind: &str,
        source_id: &str,
        canonical_kind: &str,
        canonical_id: &str,
    ) -> Result<OperationResult<Value>, ApplicationError> {
        if let Some((result, record)) = self.store.maintenance_lineage_replay(
            context,
            source_kind,
            source_id,
            canonical_kind,
            canonical_id,
            expected_plan_digest,
        )? {
            return Ok(OperationResult {
                operation_id: result.operation_id,
                snapshot_revision: result.revision,
                changed: false,
                value: json!({"relationship":"alias_or_supersession","source_kind":record.source_kind,"source_id":record.source_id,"canonical_kind":record.canonical_kind,"canonical_id":record.canonical_id,"plan_digest":record.plan_digest,"original_preserved":true,"acceptance_proof_transferred":false,"canonical_behavior":"lineage only; existing references and work status are unchanged"}),
            });
        }
        let plan = self.merge_plan(
            &context.project_id,
            source_kind,
            source_id,
            canonical_kind,
            canonical_id,
        )?;
        if context.expected_revision != Some(plan.revision)
            || plan.plan_digest != expected_plan_digest
        {
            return Err(ApplicationError::Invalid(
                "merge plan is stale or its exact identity differs; run merge plan again".into(),
            ));
        }
        let source_digest = plan.source_digest.clone();
        let canonical_digest = plan.canonical_digest.clone().unwrap_or_default();
        let result = self.store.record_maintenance_lineage(
            context,
            source_kind,
            source_id,
            canonical_kind,
            canonical_id,
            &plan.plan_digest,
            &source_digest,
            &canonical_digest,
        )?;
        Ok(OperationResult {
            operation_id: result.operation_id.clone(),
            snapshot_revision: result.revision,
            changed: !result.replayed,
            value: json!({"relationship":"alias_or_supersession","source_kind":source_kind,"source_id":source_id,"canonical_kind":canonical_kind,"canonical_id":canonical_id,"plan_digest":plan.plan_digest,"original_preserved":true,"acceptance_proof_transferred":false,"canonical_behavior":"lineage only; existing references and work status are unchanged"}),
        })
    }

    pub fn compact_analyze(
        &self,
        project: &str,
        limit: u64,
        minimum_bytes: usize,
    ) -> Result<Value, ApplicationError> {
        if minimum_bytes == 0 {
            return Err(ApplicationError::Invalid(
                "minimum compaction size must be positive".into(),
            ));
        }
        let snapshot = self.store.knowledge_maintenance_snapshot(project, limit)?;
        let revision = snapshot.revision;
        let items = snapshot.candidates;
        let candidates:Vec<Value>=items.iter().filter(|item|item.kind!="source"&&item.content.len()>=minimum_bytes).map(|item|{
            let plan=json!({"project_id":project,"revision":revision,"kind":item.kind,"id":item.id,"source_revision":item.revision,"source_digest":item.content_digest});
            json!({"kind":item.kind,"id":item.id,"source_revision":item.revision,"source_digest":item.content_digest,"bytes":item.content.len(),"plan_digest":sha256_content_digest(plan.to_string().as_bytes()),"summary_required_from_operator":true,"original_preserved":true})
        }).collect();
        Ok(
            json!({"schema":"boreal.maintenance.compact-analysis.v1","project_id":project,"revision":revision,"limit_per_kind":limit,"minimum_bytes":minimum_bytes,"possibly_truncated":snapshot.truncated,"candidates":candidates,"storage_effect":"none; compaction adds a versioned summary and does not shrink or overwrite source content"}),
        )
    }

    pub fn apply_compaction(
        &self,
        context: &V3MutationContext,
        plan_digest: &str,
        source_kind: &str,
        source_id: &str,
        source_revision: u64,
        source_digest: &str,
        summary_text: &str,
    ) -> Result<OperationResult<Value>, ApplicationError> {
        if summary_text.trim().is_empty() || summary_text.len() > 65_536 {
            return Err(ApplicationError::Invalid(
                "summary must contain 1..65536 bytes".into(),
            ));
        }
        let summary_digest = sha256_content_digest(summary_text.as_bytes());
        if let Some((result, record)) = self.store.compaction_summary_replay(
            context,
            source_kind,
            source_id,
            source_revision,
            source_digest,
            &summary_digest,
            summary_text,
        )? {
            return Ok(OperationResult {
                operation_id: result.operation_id,
                snapshot_revision: result.revision,
                changed: false,
                value: json!({"summary_id":record.summary_id,"source_kind":record.source_kind,"source_id":record.source_id,"source_revision":record.source_revision,"source_digest":record.source_digest,"summary_digest":record.summary_digest,"original_preserved":true,"storage_reduced":false}),
            });
        }
        let snapshot = self
            .store
            .knowledge_maintenance_snapshot(&context.project_id, 10_000)?;
        let revision = snapshot.revision;
        let items = snapshot.candidates;
        if snapshot.truncated {
            return Err(ApplicationError::Invalid(
                "project exceeds the bounded compaction verification window".into(),
            ));
        }
        let source = items
            .iter()
            .find(|item| item.kind == source_kind && item.id == source_id)
            .ok_or_else(|| {
                ApplicationError::Invalid("compaction source was not found in this project".into())
            })?;
        if source.active_attempt {
            return Err(ApplicationError::Invalid(
                "compaction is blocked while the source work item has an active attempt".into(),
            ));
        }
        let payload = json!({"project_id":context.project_id,"revision":revision,"kind":source_kind,"id":source_id,"source_revision":source.revision,"source_digest":source.content_digest});
        let fresh_digest = sha256_content_digest(payload.to_string().as_bytes());
        if context.expected_revision != Some(revision)
            || source.revision != source_revision
            || source.content_digest != source_digest
            || fresh_digest != plan_digest
        {
            return Err(ApplicationError::Invalid(
                "compaction plan is stale or source identity changed; analyze again".into(),
            ));
        }
        let id_material = format!(
            "{}\n{}\n{}\n{}",
            context.operation_id, source_kind, source_id, summary_digest
        );
        let summary_id = format!(
            "compact-{}",
            &sha256_content_digest(id_material.as_bytes())[..20]
        );
        let result = self.store.record_compaction_summary(
            context,
            &summary_id,
            source_kind,
            source_id,
            source_revision,
            source_digest,
            &summary_digest,
            summary_text,
        )?;
        Ok(OperationResult {
            operation_id: result.operation_id.clone(),
            snapshot_revision: result.revision,
            changed: !result.replayed,
            value: json!({"summary_id":summary_id,"source_kind":source_kind,"source_id":source_id,"source_revision":source_revision,"source_digest":source_digest,"summary_digest":summary_digest,"original_preserved":true,"storage_reduced":false}),
        })
    }
}

fn normalize(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}
