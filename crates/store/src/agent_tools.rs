//! Revisioned annotations and trusted-directive acknowledgements.
use super::*;
use crate::work_model_v3::V3MutationContext;
pub const AGENT_TOOLS_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS work_label_v1(project_id TEXT NOT NULL,work_id TEXT NOT NULL,label TEXT NOT NULL,PRIMARY KEY(project_id,work_id,label),FOREIGN KEY(project_id,work_id) REFERENCES work_item(project_id,work_id));
CREATE TABLE IF NOT EXISTS directive_ack_v1(project_id TEXT NOT NULL,ack_id TEXT NOT NULL,directive_id TEXT NOT NULL,work_id TEXT,actor_id TEXT NOT NULL,session_id TEXT NOT NULL,compiled_revision INTEGER NOT NULL,operation_id TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL,PRIMARY KEY(project_id,ack_id));
CREATE TRIGGER IF NOT EXISTS directive_ack_immutable_update BEFORE UPDATE ON directive_ack_v1 BEGIN SELECT RAISE(ABORT,'directive_ack_immutable'); END;
CREATE TRIGGER IF NOT EXISTS directive_ack_immutable_delete BEFORE DELETE ON directive_ack_v1 BEGIN SELECT RAISE(ABORT,'directive_ack_immutable'); END;
"#;
impl SqliteStore {
    pub fn work_labels(&self, project: &str, work: &str) -> Result<Vec<String>, StoreError> {
        let mut q = self.prepare(
            "SELECT label FROM work_label_v1 WHERE project_id=?1 AND work_id=?2 ORDER BY label",
        )?;
        q.bind_text(1, project)?;
        q.bind_text(2, work)?;
        let mut labels = Vec::new();
        while q.step()? == SQLITE_ROW {
            labels.push(q.column_text(0)?);
        }
        Ok(labels)
    }
    pub fn set_work_labels(
        &self,
        context: &V3MutationContext,
        work: &str,
        labels: &[String],
    ) -> Result<MutationResult, StoreError> {
        let digest = serde_json::json!({"work_id":work,"labels":labels});
        self.fact_mutation(
            &context.with_payload(digest.clone()),
            "work.labels.set",
            "work",
            work,
            &[boreal_domain::ActorRole::Operator],
            || {
                let store = self;
                if store.work(&context.project_id, work)?.is_none() {
                    return Err(StoreError::NotFound {
                        entity: "work",
                        id: work.into(),
                    });
                }
                let mut del = store
                    .prepare("DELETE FROM work_label_v1 WHERE project_id=?1 AND work_id=?2")?;
                del.bind_text(1, &context.project_id)?;
                del.bind_text(2, work)?;
                del.run()?;
                drop(del);
                for label in labels {
                    let mut q = store.prepare(
                        "INSERT INTO work_label_v1(project_id,work_id,label) VALUES(?1,?2,?3)",
                    )?;
                    q.bind_text(1, &context.project_id)?;
                    q.bind_text(2, work)?;
                    q.bind_text(3, label)?;
                    q.run()?;
                }
                Ok(())
            },
        )
    }
    pub fn acknowledge_directive(
        &self,
        context: &V3MutationContext,
        id: &str,
        work: Option<&str>,
    ) -> Result<MutationResult, StoreError> {
        let payload = serde_json::json!({"directive_id":id,"work_id":work,"compiled_revision":context.expected_revision});
        self.fact_mutation(&context.with_payload(payload.clone()),"directives.ack.create","operation",&context.operation_id,&[boreal_domain::ActorRole::Agent,boreal_domain::ActorRole::Operator,boreal_domain::ActorRole::Reviewer],||{
            let store=self;
            if let Some(work)=work {if store.work(&context.project_id,work)?.is_none(){return Err(StoreError::NotFound{entity:"work",id:work.into()});}}
            let mut q=store.prepare("INSERT INTO directive_ack_v1(project_id,ack_id,directive_id,work_id,actor_id,session_id,compiled_revision,operation_id,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?2,?8)")?;
            q.bind_text(1,&context.project_id)?;q.bind_text(2,&context.operation_id)?;q.bind_text(3,id)?;q.bind_optional_text(4,work)?;q.bind_text(5,&context.actor_id)?;q.bind_text(6,context.session_id.as_deref().ok_or_else(||StoreError::Invalid("directive acknowledgment requires a session".into()))?)?;q.bind_i64(7,context.expected_revision.ok_or_else(||StoreError::Invalid("directive acknowledgement requires a compiled revision".into()))?)?;q.bind_text(8,&context.now)?;q.run()?;Ok(())
        })
    }
    pub fn directive_ack_page(
        &self,
        project: &str,
        limit: u64,
        offset: u64,
    ) -> Result<Vec<serde_json::Value>, StoreError> {
        let mut q=self.prepare("SELECT ack_id,directive_id,work_id,actor_id,session_id,compiled_revision,created_at FROM directive_ack_v1 WHERE project_id=?1 ORDER BY compiled_revision DESC,ack_id LIMIT ?2 OFFSET ?3")?;
        q.bind_text(1, project)?;
        q.bind_i64(2, limit.clamp(1, 1000))?;
        q.bind_i64(3, offset)?;
        let mut rows = Vec::new();
        while q.step()? == SQLITE_ROW {
            rows.push(serde_json::json!({"ack_id":q.column_text(0)?,"directive_id":q.column_text(1)?,"work_id":q.column_optional_text(2)?,"actor_id":q.column_text(3)?,"session_id":q.column_text(4)?,"compiled_revision":q.column_u64(5)?,"created_at":q.column_text(6)?}));
        }
        Ok(rows)
    }
    pub fn directive_ack_show(
        &self,
        project: &str,
        id: &str,
    ) -> Result<Option<serde_json::Value>, StoreError> {
        let mut q=self.prepare("SELECT ack_id,directive_id,work_id,actor_id,session_id,compiled_revision,created_at FROM directive_ack_v1 WHERE project_id=?1 AND ack_id=?2")?;
        q.bind_text(1, project)?;
        q.bind_text(2, id)?;
        if q.step()? != SQLITE_ROW {
            return Ok(None);
        }
        Ok(Some(
            serde_json::json!({"ack_id":q.column_text(0)?,"directive_id":q.column_text(1)?,"work_id":q.column_optional_text(2)?,"actor_id":q.column_text(3)?,"session_id":q.column_text(4)?,"compiled_revision":q.column_u64(5)?,"created_at":q.column_text(6)?}),
        ))
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FilteredOperationPage {
    pub items: Vec<OperationRecord>,
    pub total: u64,
}
impl SqliteStore {
    /// Filter against the work subject before applying page bounds. This keeps
    /// `work history --offset` stable even when project history is long.
    pub fn operation_page_for_work(
        &self,
        project: &str,
        work: &str,
        limit: u64,
        offset: u64,
    ) -> Result<FilteredOperationPage, StoreError> {
        if !(1..=1000).contains(&limit) {
            return Err(StoreError::Invalid(
                "history page limit must be 1..1000".into(),
            ));
        }
        let mut count=self.prepare("SELECT COUNT(*) FROM operation o LEFT JOIN audit_event a ON a.operation_id=o.operation_id WHERE o.project_id=?1 AND ((a.subject_type='work' AND a.subject_id=?2) OR o.attempt_id IN (SELECT attempt_id FROM attempt WHERE project_id=?1 AND work_id=?2))")?;
        count.bind_text(1, project)?;
        count.bind_text(2, work)?;
        if count.step()? != SQLITE_ROW {
            return Err(StoreError::Corrupt(
                "missing filtered operation count".into(),
            ));
        }
        let total = count.column_u64(0)?;
        drop(count);
        let mut rows=self.prepare("SELECT o.operation_id FROM operation o LEFT JOIN audit_event a ON a.operation_id=o.operation_id WHERE o.project_id=?1 AND ((a.subject_type='work' AND a.subject_id=?2) OR o.attempt_id IN (SELECT attempt_id FROM attempt WHERE project_id=?1 AND work_id=?2)) ORDER BY o.revision DESC,o.operation_id LIMIT ?3 OFFSET ?4")?;
        rows.bind_text(1, project)?;
        rows.bind_text(2, work)?;
        rows.bind_i64(3, limit)?;
        rows.bind_i64(4, offset)?;
        let mut ids = Vec::new();
        while rows.step()? == SQLITE_ROW {
            ids.push(rows.column_text(0)?);
        }
        drop(rows);
        let mut items = Vec::with_capacity(ids.len());
        for id in ids {
            items.push(
                self.operation(&id)?
                    .ok_or_else(|| StoreError::Corrupt("filtered operation disappeared".into()))?,
            );
        }
        Ok(FilteredOperationPage { items, total })
    }

    /// Newest close revision for each work item whose current lifecycle is
    /// closed. The app uses this rank after applying actor/status/label filters.
    pub fn recent_closed_ranks(&self, project: &str) -> Result<BTreeMap<String, u64>, StoreError> {
        let mut q=self.prepare("SELECT a.subject_id,MAX(a.revision) FROM audit_event a JOIN work_item w ON w.project_id=a.project_id AND w.work_id=a.subject_id WHERE a.project_id=?1 AND a.subject_type='work' AND a.event_type IN ('work.closed','close.completed') AND w.lifecycle='closed' GROUP BY a.subject_id ORDER BY MAX(a.revision) DESC,a.subject_id")?;
        q.bind_text(1, project)?;
        let mut ranks = BTreeMap::new();
        while q.step()? == SQLITE_ROW {
            ranks.insert(q.column_text(0)?, q.column_u64(1)?);
        }
        Ok(ranks)
    }

    pub fn project_work_labels(
        &self,
        project: &str,
    ) -> Result<BTreeMap<String, Vec<String>>, StoreError> {
        let mut q = self.prepare(
            "SELECT work_id,label FROM work_label_v1 WHERE project_id=?1 ORDER BY work_id,label",
        )?;
        q.bind_text(1, project)?;
        let mut result = BTreeMap::<String, Vec<String>>::new();
        while q.step()? == SQLITE_ROW {
            result
                .entry(q.column_text(0)?)
                .or_default()
                .push(q.column_text(1)?);
        }
        Ok(result)
    }
}

impl SqliteStore {
    pub fn operation_count(&self, project: &str) -> Result<u64, StoreError> {
        let mut q = self.prepare("SELECT COUNT(*) FROM operation WHERE project_id=?1")?;
        q.bind_text(1, project)?;
        if q.step()? == SQLITE_ROW {
            q.column_u64(0)
        } else {
            Err(StoreError::Corrupt("missing operation count".into()))
        }
    }
}
