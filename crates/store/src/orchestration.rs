//! Durable coordination records for harness-neutral orchestration.
//!
//! This module stores run intent and observations only. Canonical work status,
//! eligibility, attempt ownership and fencing remain exclusively in the
//! project lifecycle tables and their application commands.

use super::{MutationResult, SqliteStore, StoreError, V3MutationContext, SQLITE_ROW};

pub const ORCHESTRATION_SCHEMA_VERSION: i64 = 1;
pub const ORCHESTRATION_SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS orchestration_run(
 run_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('queued','running','paused','completed','failed','cancelled')),
 selector_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1, last_error TEXT,
 claim_count INTEGER NOT NULL DEFAULT 0 CHECK(claim_count>=0),
 max_claims INTEGER NOT NULL DEFAULT 1 CHECK(max_claims BETWEEN 1 AND 500)
);
CREATE TABLE IF NOT EXISTS orchestration_event(
 sequence INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES orchestration_run(run_id),
 project_id TEXT NOT NULL, operation_id TEXT NOT NULL, actor_id TEXT NOT NULL,
 project_revision INTEGER NOT NULL, kind TEXT NOT NULL, detail_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS orchestration_events_by_run ON orchestration_event(run_id,sequence);
CREATE TABLE IF NOT EXISTS orchestration_tick(
 tick_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, run_id TEXT NOT NULL,
 work_id TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('selected','claimed','rejected')),
 result_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 FOREIGN KEY(run_id) REFERENCES orchestration_run(run_id)
);
"#;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OrchestrationRun {
    pub run_id: String,
    pub project_id: String,
    pub name: String,
    pub state: String,
    pub selector_json: String,
    pub revision: u64,
    pub last_error: Option<String>,
    pub claim_count: u64,
    pub max_claims: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OrchestrationTickRecord {
    pub tick_id: String,
    pub project_id: String,
    pub run_id: String,
    pub work_id: String,
    pub state: String,
    pub result_json: Option<String>,
}

impl SqliteStore {
    /// Installs the additive orchestration tables without modifying project
    /// lifecycle tables or schema identity.
    pub fn install_orchestration_schema(&self) -> Result<(), StoreError> {
        self.execute_batch(ORCHESTRATION_SCHEMA_SQL)
    }
    pub fn orchestration_run_create(
        &self,
        c: &V3MutationContext,
        run: &OrchestrationRun,
    ) -> Result<MutationResult, StoreError> {
        if run.project_id != c.project_id {
            return Err(StoreError::Invalid(
                "run must belong to the authorized project".into(),
            ));
        }
        let bound = c.with_payload(
            serde_json::json!({"run_id":run.run_id,"name":run.name,"selector":run.selector_json}),
        );
        self.v3_mutation(&bound,"orchestration.start","orchestration_run",&run.run_id,||{
            let mut q=self.prepare("INSERT INTO orchestration_run(run_id,project_id,name,state,selector_json,created_at,updated_at,revision,last_error,claim_count,max_claims) VALUES(?1,?2,?3,'queued',?4,?5,?5,1,NULL,0,?6)")?;
            q.bind_text(1,&run.run_id)?;q.bind_text(2,&run.project_id)?;q.bind_text(3,&run.name)?;q.bind_text(4,&run.selector_json)?;q.bind_text(5,&c.now)?;q.bind_i64(6,run.max_claims)?;q.run()?;
            self.orchestration_event(c,&run.run_id,"run.queued","{}")
        })
    }
    pub fn orchestration_run_read(
        &self,
        project: &str,
        id: &str,
    ) -> Result<Option<OrchestrationRun>, StoreError> {
        let mut q=self.prepare("SELECT run_id,project_id,name,state,selector_json,revision,last_error,claim_count,max_claims FROM orchestration_run WHERE project_id=?1 AND run_id=?2")?;
        q.bind_text(1, project)?;
        q.bind_text(2, id)?;
        if q.step()? != SQLITE_ROW {
            return Ok(None);
        };
        Ok(Some(OrchestrationRun {
            run_id: q.column_text(0)?,
            project_id: q.column_text(1)?,
            name: q.column_text(2)?,
            state: q.column_text(3)?,
            selector_json: q.column_text(4)?,
            revision: q.column_u64(5)?,
            last_error: q.column_optional_text(6)?,
            claim_count: q.column_u64(7)?,
            max_claims: q.column_u64(8)?,
        }))
    }
    pub fn orchestration_runs(
        &self,
        project: &str,
        limit: u64,
    ) -> Result<Vec<OrchestrationRun>, StoreError> {
        let mut q=self.prepare("SELECT run_id,project_id,name,state,selector_json,revision,last_error,claim_count,max_claims FROM orchestration_run WHERE project_id=?1 ORDER BY created_at DESC LIMIT ?2")?;
        q.bind_text(1, project)?;
        q.bind_i64(2, limit.min(500))?;
        let mut rows = vec![];
        while q.step()? == SQLITE_ROW {
            rows.push(OrchestrationRun {
                run_id: q.column_text(0)?,
                project_id: q.column_text(1)?,
                name: q.column_text(2)?,
                state: q.column_text(3)?,
                selector_json: q.column_text(4)?,
                revision: q.column_u64(5)?,
                last_error: q.column_optional_text(6)?,
                claim_count: q.column_u64(7)?,
                max_claims: q.column_u64(8)?,
            });
        }
        Ok(rows)
    }
    /// Returns a stable keyset page. Unlike an offset page, the cursor does
    /// not shift when a run changes state while a scheduler is scanning.
    pub fn orchestration_runs_after(
        &self,
        project: &str,
        after_run_id: &str,
        limit: u64,
    ) -> Result<Vec<OrchestrationRun>, StoreError> {
        let mut q=self.prepare("SELECT run_id,project_id,name,state,selector_json,revision,last_error,claim_count,max_claims FROM orchestration_run WHERE project_id=?1 AND run_id>?2 ORDER BY run_id LIMIT ?3")?;
        q.bind_text(1, project)?;
        q.bind_text(2, after_run_id)?;
        q.bind_i64(3, limit.min(500))?;
        let mut rows = vec![];
        while q.step()? == SQLITE_ROW {
            rows.push(OrchestrationRun {
                run_id: q.column_text(0)?,
                project_id: q.column_text(1)?,
                name: q.column_text(2)?,
                state: q.column_text(3)?,
                selector_json: q.column_text(4)?,
                revision: q.column_u64(5)?,
                last_error: q.column_optional_text(6)?,
                claim_count: q.column_u64(7)?,
                max_claims: q.column_u64(8)?,
            });
        }
        Ok(rows)
    }
    pub fn orchestration_run_transition(
        &self,
        c: &V3MutationContext,
        id: &str,
        expected: u64,
        next: &str,
        error: Option<&str>,
    ) -> Result<MutationResult, StoreError> {
        if ![
            "queued",
            "running",
            "paused",
            "completed",
            "failed",
            "cancelled",
        ]
        .contains(&next)
        {
            return Err(StoreError::Invalid(
                "invalid orchestration run state".into(),
            ));
        }
        let bound = c.with_payload(
            serde_json::json!({"run_id":id,"run_revision":expected,"state":next,"error":error}),
        );
        self.v3_mutation(&bound,&format!("orchestration.{next}"),"orchestration_run",id,||{
            let current=self.orchestration_run_read(&c.project_id,id)?.ok_or_else(||StoreError::NotFound{entity:"orchestration_run",id:id.into()})?;
            let selector:serde_json::Value=serde_json::from_str(&current.selector_json).map_err(|e|StoreError::Corrupt(format!("invalid orchestration selector: {e}")))?;
            if selector.get("pending_work").is_some_and(|v|!v.is_null()) && matches!(next,"paused"|"cancelled"|"failed"|"completed") {
                return Err(StoreError::Conflict("a canonical claim operation is unresolved; replay or reconcile its tick before changing run state".into()));
            }
            let valid = matches!(
                (current.state.as_str(), next),
                ("queued", "running" | "paused" | "cancelled" | "failed")
                    | ("running", "paused" | "completed" | "cancelled" | "failed")
                    | ("paused", "running" | "cancelled" | "failed")
            );
            if !valid{return Err(StoreError::Invalid(format!("invalid orchestration transition {} -> {next}",current.state)));}
            if current.revision!=expected{return Err(StoreError::Conflict("orchestration run revision conflict".into()));}
            let mut q=self.prepare("UPDATE orchestration_run SET state=?3,last_error=?4,updated_at=?5,revision=revision+1 WHERE project_id=?1 AND run_id=?2 AND revision=?6")?;q.bind_text(1,&c.project_id)?;q.bind_text(2,id)?;q.bind_text(3,next)?;q.bind_optional_text(4,error)?;q.bind_text(5,&c.now)?;q.bind_i64(6,expected)?;q.run()?;if q.changes()?==0{return Err(StoreError::Conflict("orchestration run changed during transition".into()));}
            self.orchestration_event(c,id,&format!("run.{next}"),&serde_json::json!({"error":error}).to_string())
        })
    }
    /// Pins the selected task before claiming so an unknown claim outcome can
    /// be retried against exactly the same subject and operation identity.
    pub fn orchestration_tick_read(
        &self,
        project: &str,
        run: &str,
        tick_id: &str,
    ) -> Result<Option<OrchestrationTickRecord>, StoreError> {
        let mut q=self.prepare("SELECT tick_id,project_id,run_id,work_id,state,result_json FROM orchestration_tick WHERE project_id=?1 AND run_id=?2 AND tick_id=?3")?;
        q.bind_text(1, project)?;
        q.bind_text(2, run)?;
        q.bind_text(3, tick_id)?;
        if q.step()? != SQLITE_ROW {
            return Ok(None);
        };
        Ok(Some(OrchestrationTickRecord {
            tick_id: q.column_text(0)?,
            project_id: q.column_text(1)?,
            run_id: q.column_text(2)?,
            work_id: q.column_text(3)?,
            state: q.column_text(4)?,
            result_json: q.column_optional_text(5)?,
        }))
    }
    pub fn orchestration_tick_select(
        &self,
        c: &V3MutationContext,
        tick_id: &str,
        id: &str,
        expected: u64,
        work: &str,
    ) -> Result<MutationResult, StoreError> {
        let bound=c.with_payload(serde_json::json!({"tick_id":tick_id,"run_id":id,"run_revision":expected,"selected_work":work}));
        self.v3_mutation(&bound,"orchestration.tick.select","orchestration_run",id,||{
            let run=self.orchestration_run_read(&c.project_id,id)?.ok_or_else(||StoreError::NotFound{entity:"orchestration_run",id:id.into()})?;
            if !matches!(run.state.as_str(),"queued"|"running"){return Err(StoreError::Invalid(format!("run is {}, so it cannot claim",run.state)));}
            if run.revision!=expected{return Err(StoreError::Conflict("orchestration run revision conflict".into()));}
            if run.claim_count>=run.max_claims{return Err(StoreError::Invalid("orchestration run reached max_claims".into()));}
            let mut selector:serde_json::Value=serde_json::from_str(&run.selector_json).map_err(|e|StoreError::Corrupt(format!("invalid orchestration selector: {e}")))?;
            if selector.get("pending_work").is_some_and(|v|!v.is_null()){return Err(StoreError::Conflict("orchestration run already has an unresolved tick".into()));}
            selector["pending_work"]=serde_json::json!(work);
            selector["pending_tick_id"]=serde_json::json!(tick_id);
            let mut q=self.prepare("UPDATE orchestration_run SET selector_json=?3,revision=revision+1,updated_at=?4 WHERE project_id=?1 AND run_id=?2 AND revision=?5")?;q.bind_text(1,&c.project_id)?;q.bind_text(2,id)?;q.bind_text(3,&selector.to_string())?;q.bind_text(4,&c.now)?;q.bind_i64(5,expected)?;q.run()?;if q.changes()?==0{return Err(StoreError::Conflict("orchestration run changed while pinning tick".into()));}
            let mut t=self.prepare("INSERT INTO orchestration_tick(tick_id,project_id,run_id,work_id,state,result_json,created_at,updated_at) VALUES(?1,?2,?3,?4,'selected',NULL,?5,?5)")?;t.bind_text(1,tick_id)?;t.bind_text(2,&c.project_id)?;t.bind_text(3,id)?;t.bind_text(4,work)?;t.bind_text(5,&c.now)?;t.run()?;
            self.orchestration_event(c,id,"tick.selected",&serde_json::json!({"work_id":work}).to_string())
        })
    }
    /// Completes a pinned tick after canonical claim readback. `claimed`
    /// increments the bounded claim count; definite rejection clears the pin.
    /// Unknown claim outcomes must leave the pin intact for operation replay.
    #[expect(
        clippy::too_many_arguments,
        reason = "this public store API preserves the established tick-finish command fields"
    )]
    pub fn orchestration_tick_finish(
        &self,
        c: &V3MutationContext,
        tick_id: &str,
        id: &str,
        expected: u64,
        work: &str,
        outcome: &str,
        detail: &str,
    ) -> Result<MutationResult, StoreError> {
        if !matches!(outcome, "claimed" | "rejected") {
            return Err(StoreError::Invalid(
                "tick outcome must be claimed or rejected".into(),
            ));
        }
        let bound=c.with_payload(serde_json::json!({"tick_id":tick_id,"run_id":id,"run_revision":expected,"work_id":work,"outcome":outcome,"detail":detail}));
        self.v3_mutation(&bound,&format!("orchestration.tick.{outcome}"),"orchestration_run",id,||{
            let run=self.orchestration_run_read(&c.project_id,id)?.ok_or_else(||StoreError::NotFound{entity:"orchestration_run",id:id.into()})?;
            if run.revision!=expected{return Err(StoreError::Conflict("orchestration run revision conflict while finishing tick".into()));}
            let mut selector:serde_json::Value=serde_json::from_str(&run.selector_json).map_err(|e|StoreError::Corrupt(format!("invalid orchestration selector: {e}")))?;
            if selector.get("pending_work").and_then(serde_json::Value::as_str)!=Some(work){return Err(StoreError::Conflict("tick subject does not match the persisted pending work".into()));}
            if self.orchestration_tick_read(&c.project_id,id,tick_id)?.is_none(){return Err(StoreError::NotFound{entity:"orchestration_tick",id:tick_id.into()});}
            if outcome=="claimed"&&run.claim_count>=run.max_claims{return Err(StoreError::Conflict("max_claims reached before claim readback".into()));}
            selector["pending_work"]=serde_json::Value::Null;
            selector["pending_tick_id"]=serde_json::Value::Null;
            let next_state=if outcome=="claimed"&&run.state=="queued"{"running"}else{run.state.as_str()};
            let mut q=self.prepare("UPDATE orchestration_run SET selector_json=?3,state=?4,claim_count=claim_count+?5,last_error=?6,revision=revision+1,updated_at=?7 WHERE project_id=?1 AND run_id=?2 AND revision=?8")?;q.bind_text(1,&c.project_id)?;q.bind_text(2,id)?;q.bind_text(3,&selector.to_string())?;q.bind_text(4,next_state)?;q.bind_i64(5,u64::from(outcome=="claimed"))?;q.bind_optional_text(6,if outcome=="rejected"{Some(detail)}else{None})?;q.bind_text(7,&c.now)?;q.bind_i64(8,expected)?;q.run()?;if q.changes()?==0{return Err(StoreError::Conflict("orchestration run changed during tick finalization".into()));}
            let mut t=self.prepare("UPDATE orchestration_tick SET state=?4,result_json=?5,updated_at=?6 WHERE project_id=?1 AND run_id=?2 AND tick_id=?3 AND state='selected'")?;t.bind_text(1,&c.project_id)?;t.bind_text(2,id)?;t.bind_text(3,tick_id)?;t.bind_text(4,outcome)?;t.bind_text(5,detail)?;t.bind_text(6,&c.now)?;t.run()?;if t.changes()?==0{return Err(StoreError::Conflict("orchestration tick was already finalized".into()));}
            self.orchestration_event(c,id,&format!("tick.{outcome}"),detail)
        })
    }
    fn orchestration_event(
        &self,
        c: &V3MutationContext,
        id: &str,
        kind: &str,
        detail: &str,
    ) -> Result<(), StoreError> {
        let revision = self.project_revision(&c.project_id)?.0 + 1;
        let mut q=self.prepare("INSERT INTO orchestration_event(run_id,project_id,operation_id,actor_id,project_revision,kind,detail_json,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)")?;
        q.bind_text(1, id)?;
        q.bind_text(2, &c.project_id)?;
        q.bind_text(3, &c.operation_id)?;
        q.bind_text(4, &c.actor_id)?;
        q.bind_i64(5, revision)?;
        q.bind_text(6, kind)?;
        q.bind_text(7, detail)?;
        q.bind_text(8, &c.now)?;
        q.run()
    }
    pub fn orchestration_record_event(
        &self,
        c: &V3MutationContext,
        id: &str,
        kind: &str,
        detail: &str,
    ) -> Result<MutationResult, StoreError> {
        if !matches!(kind, "tick.observed" | "run.nudged") {
            return Err(StoreError::Invalid(
                "unsupported orchestration event kind".into(),
            ));
        }
        if self.orchestration_run_read(&c.project_id, id)?.is_none() {
            return Err(StoreError::NotFound {
                entity: "orchestration_run",
                id: id.into(),
            });
        }
        let bound = c.with_payload(serde_json::json!({"run_id":id,"kind":kind,"detail":detail}));
        self.v3_mutation(
            &bound,
            &format!("orchestration.event.{kind}"),
            "orchestration_run",
            id,
            || self.orchestration_event(c, id, kind, detail),
        )
    }
    pub fn orchestration_events(
        &self,
        project: &str,
        id: &str,
        limit: u64,
    ) -> Result<Vec<serde_json::Value>, StoreError> {
        let mut q=self.prepare("SELECT e.sequence,e.project_id,e.operation_id,e.actor_id,e.project_revision,e.kind,e.detail_json,e.created_at FROM orchestration_event e JOIN orchestration_run r ON r.run_id=e.run_id WHERE r.project_id=?1 AND e.project_id=?1 AND e.run_id=?2 ORDER BY e.sequence DESC LIMIT ?3")?;
        q.bind_text(1, project)?;
        q.bind_text(2, id)?;
        q.bind_i64(3, limit.min(1000))?;
        let mut rows = vec![];
        while q.step()? == SQLITE_ROW {
            rows.push(serde_json::json!({"sequence":q.column_u64(0)?,"project_id":q.column_text(1)?,"operation_id":q.column_text(2)?,"actor_id":q.column_text(3)?,"project_revision":q.column_u64(4)?,"kind":q.column_text(5)?,"detail":q.column_text(6)?,"created_at":q.column_text(7)?}));
        }
        rows.reverse();
        Ok(rows)
    }
}
