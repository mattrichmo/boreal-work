//! Durable local worker ownership and external harness process readback.
//!
//! This is coordination metadata only. Attempt ownership remains in the
//! canonical attempt tables and a worker must never hold a SQLite transaction
//! while waiting for a process.
use super::{MutationResult, SqliteStore, StoreError, V3MutationContext, SQLITE_ROW};

pub const ORCHESTRATION_RUNTIME_SCHEMA_VERSION: i64 = 4;
pub const ORCHESTRATION_RUNTIME_SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS orchestration_worker (
 project_id TEXT PRIMARY KEY REFERENCES project(project_id), owner_id TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('running','stopping','stopped','uncertain')),
 lease_until TEXT NOT NULL, heartbeat_at TEXT NOT NULL, max_workers INTEGER NOT NULL CHECK(max_workers BETWEEN 1 AND 32),
 max_requests INTEGER NOT NULL CHECK(max_requests BETWEEN 1 AND 10000),
 requests_completed INTEGER NOT NULL DEFAULT 0 CHECK(requests_completed>=0),
 revision INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS orchestration_process_job (
 job_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(project_id),
 run_id TEXT NOT NULL REFERENCES orchestration_run(run_id), tick_id TEXT NOT NULL,
 work_id TEXT NOT NULL, attempt_id TEXT NOT NULL, fence INTEGER NOT NULL CHECK(fence>0),
 actor_id TEXT NOT NULL, session_id TEXT NOT NULL, harness_id TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('starting','running','readback_required','succeeded','failed','cancelled','uncertain')),
 pid INTEGER, started_at TEXT NOT NULL, deadline TEXT NOT NULL, ended_at TEXT,
 exit_code INTEGER, result_digest TEXT, error_message TEXT, revision INTEGER NOT NULL DEFAULT 1,
 UNIQUE(project_id,tick_id), FOREIGN KEY(run_id) REFERENCES orchestration_run(run_id)
);
CREATE INDEX IF NOT EXISTS orchestration_process_jobs_project_state ON orchestration_process_job(project_id,state,started_at);
CREATE TABLE IF NOT EXISTS orchestration_harness_policy (
 policy_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(project_id),
 harness_id TEXT NOT NULL, policy_revision INTEGER NOT NULL CHECK(policy_revision>0),
 state TEXT NOT NULL CHECK(state IN ('active','revoked')), policy_json TEXT NOT NULL,
 policy_digest TEXT NOT NULL, actor_id TEXT NOT NULL, operation_id TEXT NOT NULL,
 project_revision INTEGER NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(project_id,harness_id,policy_revision), UNIQUE(project_id,operation_id)
);
CREATE INDEX IF NOT EXISTS orchestration_harness_policy_current ON orchestration_harness_policy(project_id,harness_id,policy_revision DESC);
CREATE TRIGGER IF NOT EXISTS orchestration_harness_policy_no_update BEFORE UPDATE ON orchestration_harness_policy BEGIN SELECT RAISE(ABORT,'harness policy history is append-only'); END;
CREATE TRIGGER IF NOT EXISTS orchestration_harness_policy_no_delete BEFORE DELETE ON orchestration_harness_policy BEGIN SELECT RAISE(ABORT,'harness policy history is append-only'); END;
CREATE TABLE IF NOT EXISTS orchestration_worker_pool_policy (
 policy_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(project_id), pool_id TEXT NOT NULL,
 policy_revision INTEGER NOT NULL CHECK(policy_revision>0), state TEXT NOT NULL CHECK(state IN ('active','revoked')),
 policy_json TEXT NOT NULL, policy_digest TEXT NOT NULL, actor_id TEXT NOT NULL, session_id TEXT NOT NULL,
 operation_id TEXT NOT NULL, project_revision INTEGER NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(project_id,pool_id,policy_revision), UNIQUE(project_id,operation_id)
);
CREATE TRIGGER IF NOT EXISTS orchestration_worker_pool_policy_no_update BEFORE UPDATE ON orchestration_worker_pool_policy BEGIN SELECT RAISE(ABORT,'worker pool policy history is append-only'); END;
CREATE TRIGGER IF NOT EXISTS orchestration_worker_pool_policy_no_delete BEFORE DELETE ON orchestration_worker_pool_policy BEGIN SELECT RAISE(ABORT,'worker pool policy history is append-only'); END;
"#;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OrchestrationWorker {
    pub project_id: String,
    pub owner_id: String,
    pub state: String,
    pub lease_until: String,
    pub heartbeat_at: String,
    pub max_workers: u64,
    pub max_requests: u64,
    pub requests_completed: u64,
    pub revision: u64,
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OrchestrationHarnessPolicy {
    pub policy_id: String,
    pub project_id: String,
    pub harness_id: String,
    pub policy_revision: u64,
    pub state: String,
    pub policy_json: String,
    pub policy_digest: String,
    pub actor_id: String,
    pub operation_id: String,
    pub project_revision: u64,
    pub created_at: String,
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OrchestrationProcessJob {
    pub job_id: String,
    pub project_id: String,
    pub run_id: String,
    pub tick_id: String,
    pub work_id: String,
    pub attempt_id: String,
    pub fence: u64,
    pub actor_id: String,
    pub session_id: String,
    pub harness_id: String,
    pub state: String,
    pub pid: Option<u64>,
    pub started_at: String,
    pub deadline: String,
    pub ended_at: Option<String>,
    pub exit_code: Option<i64>,
    pub result_digest: Option<String>,
    pub error_message: Option<String>,
    pub revision: u64,
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OrchestrationWorkerPoolPolicy {
    pub project_id: String,
    pub pool_id: String,
    pub policy_revision: u64,
    pub state: String,
    pub policy_json: String,
    pub policy_digest: String,
    pub actor_id: String,
    pub session_id: String,
    pub operation_id: String,
    pub project_revision: u64,
    pub created_at: String,
}
impl SqliteStore {
    pub fn orchestration_worker_pool_policy(
        &self,
        project: &str,
        pool: &str,
    ) -> Result<Option<OrchestrationWorkerPoolPolicy>, StoreError> {
        let mut q=self.prepare("SELECT project_id,pool_id,policy_revision,state,policy_json,policy_digest,actor_id,session_id,operation_id,project_revision,created_at FROM orchestration_worker_pool_policy WHERE project_id=?1 AND pool_id=?2 ORDER BY policy_revision DESC LIMIT 1")?;
        q.bind_text(1, project)?;
        q.bind_text(2, pool)?;
        if q.step()? != SQLITE_ROW {
            return Ok(None);
        }
        Ok(Some(OrchestrationWorkerPoolPolicy {
            project_id: q.column_text(0)?,
            pool_id: q.column_text(1)?,
            policy_revision: q.column_u64(2)?,
            state: q.column_text(3)?,
            policy_json: q.column_text(4)?,
            policy_digest: q.column_text(5)?,
            actor_id: q.column_text(6)?,
            session_id: q.column_text(7)?,
            operation_id: q.column_text(8)?,
            project_revision: q.column_u64(9)?,
            created_at: q.column_text(10)?,
        }))
    }
    pub fn orchestration_worker_pool_policies(
        &self,
        project: &str,
    ) -> Result<Vec<OrchestrationWorkerPoolPolicy>, StoreError> {
        let mut q=self.prepare("SELECT p.project_id,p.pool_id,p.policy_revision,p.state,p.policy_json,p.policy_digest,p.actor_id,p.session_id,p.operation_id,p.project_revision,p.created_at FROM orchestration_worker_pool_policy p JOIN (SELECT pool_id,MAX(policy_revision) r FROM orchestration_worker_pool_policy WHERE project_id=?1 GROUP BY pool_id) x ON x.pool_id=p.pool_id AND x.r=p.policy_revision WHERE p.project_id=?1 ORDER BY p.pool_id")?;
        q.bind_text(1, project)?;
        let mut rows = Vec::new();
        while q.step()? == SQLITE_ROW {
            rows.push(OrchestrationWorkerPoolPolicy {
                project_id: q.column_text(0)?,
                pool_id: q.column_text(1)?,
                policy_revision: q.column_u64(2)?,
                state: q.column_text(3)?,
                policy_json: q.column_text(4)?,
                policy_digest: q.column_text(5)?,
                actor_id: q.column_text(6)?,
                session_id: q.column_text(7)?,
                operation_id: q.column_text(8)?,
                project_revision: q.column_u64(9)?,
                created_at: q.column_text(10)?,
            })
        }
        Ok(rows)
    }
    pub fn orchestration_worker_pool_configure(
        &self,
        c: &V3MutationContext,
        pool_id: &str,
        policy_json: &str,
        digest: &str,
    ) -> Result<MutationResult, StoreError> {
        if super::checksum(policy_json.as_bytes()) != digest {
            return Err(StoreError::Invalid(
                "worker pool policy digest mismatch".into(),
            ));
        }
        let bound = c.with_payload(
            serde_json::json!({"pool_id":pool_id,"policy_json":policy_json,"policy_digest":digest}),
        );
        self.fact_mutation(&bound,"orchestration.worker-pool.configure","orchestration_worker_pool_policy",pool_id,&[boreal_domain::ActorRole::Operator],||{
            let revision=self.orchestration_worker_pool_policy(&c.project_id,pool_id)?.map(|p|p.policy_revision+1).unwrap_or(1);
            let mut q=self.prepare("INSERT INTO orchestration_worker_pool_policy(policy_id,project_id,pool_id,policy_revision,state,policy_json,policy_digest,actor_id,session_id,operation_id,project_revision,created_at) VALUES(?1,?2,?3,?4,'active',?5,?6,?7,?8,?9,?10,?11)")?;
            q.bind_text(1,&format!("{}:{pool_id}:{revision}",c.project_id))?;q.bind_text(2,&c.project_id)?;q.bind_text(3,pool_id)?;q.bind_i64(4,revision)?;q.bind_text(5,policy_json)?;q.bind_text(6,digest)?;q.bind_text(7,&c.actor_id)?;q.bind_text(8,c.session_id.as_deref().unwrap_or(""))?;q.bind_text(9,&c.operation_id)?;q.bind_i64(10,c.expected_revision.unwrap_or(0)+1)?;q.bind_text(11,&c.now)?;q.run()?;Ok(())
        })
    }
    pub fn orchestration_worker_pool_revoke(
        &self,
        c: &V3MutationContext,
        pool_id: &str,
    ) -> Result<MutationResult, StoreError> {
        let bound = c.with_payload(serde_json::json!({"pool_id":pool_id,"state":"revoked"}));
        self.fact_mutation(&bound,"orchestration.worker-pool.revoke","orchestration_worker_pool_policy",pool_id,&[boreal_domain::ActorRole::Operator],||{
            let current=self.orchestration_worker_pool_policy(&c.project_id,pool_id)?.ok_or_else(||StoreError::NotFound{entity:"worker_pool",id:pool_id.into()})?;
            if current.state!="active"{return Err(StoreError::Conflict("worker pool is already revoked".into()))}
            let revision=current.policy_revision+1;let mut q=self.prepare("INSERT INTO orchestration_worker_pool_policy(policy_id,project_id,pool_id,policy_revision,state,policy_json,policy_digest,actor_id,session_id,operation_id,project_revision,created_at) VALUES(?1,?2,?3,?4,'revoked',?5,?6,?7,?8,?9,?10,?11)")?;
            q.bind_text(1,&format!("{}:{pool_id}:{revision}",c.project_id))?;q.bind_text(2,&c.project_id)?;q.bind_text(3,pool_id)?;q.bind_i64(4,revision)?;q.bind_text(5,&current.policy_json)?;q.bind_text(6,&current.policy_digest)?;q.bind_text(7,&c.actor_id)?;q.bind_text(8,c.session_id.as_deref().unwrap_or(""))?;q.bind_text(9,&c.operation_id)?;q.bind_i64(10,c.expected_revision.unwrap_or(0)+1)?;q.bind_text(11,&c.now)?;q.run()?;Ok(())
        })
    }
    pub fn orchestration_harness_policy(
        &self,
        project: &str,
        harness: &str,
    ) -> Result<Option<OrchestrationHarnessPolicy>, StoreError> {
        let mut q=self.prepare("SELECT policy_id,project_id,harness_id,policy_revision,state,policy_json,policy_digest,actor_id,operation_id,project_revision,created_at FROM orchestration_harness_policy WHERE project_id=?1 AND harness_id=?2 ORDER BY policy_revision DESC LIMIT 1")?;
        q.bind_text(1, project)?;
        q.bind_text(2, harness)?;
        if q.step()? != SQLITE_ROW {
            return Ok(None);
        };
        Ok(Some(OrchestrationHarnessPolicy {
            policy_id: q.column_text(0)?,
            project_id: q.column_text(1)?,
            harness_id: q.column_text(2)?,
            policy_revision: q.column_u64(3)?,
            state: q.column_text(4)?,
            policy_json: q.column_text(5)?,
            policy_digest: q.column_text(6)?,
            actor_id: q.column_text(7)?,
            operation_id: q.column_text(8)?,
            project_revision: q.column_u64(9)?,
            created_at: q.column_text(10)?,
        }))
    }
    pub fn orchestration_harness_policies(
        &self,
        project: &str,
    ) -> Result<Vec<OrchestrationHarnessPolicy>, StoreError> {
        let mut q=self.prepare("SELECT p.policy_id,p.project_id,p.harness_id,p.policy_revision,p.state,p.policy_json,p.policy_digest,p.actor_id,p.operation_id,p.project_revision,p.created_at FROM orchestration_harness_policy p JOIN (SELECT harness_id,MAX(policy_revision) AS r FROM orchestration_harness_policy WHERE project_id=?1 GROUP BY harness_id) c ON c.harness_id=p.harness_id AND c.r=p.policy_revision WHERE p.project_id=?1 ORDER BY p.harness_id")?;
        q.bind_text(1, project)?;
        let mut rows = vec![];
        while q.step()? == SQLITE_ROW {
            rows.push(OrchestrationHarnessPolicy {
                policy_id: q.column_text(0)?,
                project_id: q.column_text(1)?,
                harness_id: q.column_text(2)?,
                policy_revision: q.column_u64(3)?,
                state: q.column_text(4)?,
                policy_json: q.column_text(5)?,
                policy_digest: q.column_text(6)?,
                actor_id: q.column_text(7)?,
                operation_id: q.column_text(8)?,
                project_revision: q.column_u64(9)?,
                created_at: q.column_text(10)?,
            });
        }
        Ok(rows)
    }
    pub fn orchestration_harness_configure(
        &self,
        c: &V3MutationContext,
        harness: &str,
        policy_json: &str,
        digest: &str,
    ) -> Result<MutationResult, StoreError> {
        if super::checksum(policy_json.as_bytes()) != digest {
            return Err(StoreError::Invalid("harness policy digest mismatch".into()));
        }
        let bound=c.with_payload(serde_json::json!({"harness_id":harness,"policy_json":policy_json,"policy_digest":digest}));
        self.fact_mutation(&bound,"orchestration.harness.configure","orchestration_harness_policy",harness,&[boreal_domain::ActorRole::Operator],||{let previous=self.orchestration_harness_policy(&c.project_id,harness)?;let revision=previous.map(|p|p.policy_revision+1).unwrap_or(1);let policy_id=format!("{}:{}:{}",c.project_id,harness,revision);let mut q=self.prepare("INSERT INTO orchestration_harness_policy(policy_id,project_id,harness_id,policy_revision,state,policy_json,policy_digest,actor_id,operation_id,project_revision,created_at) VALUES(?1,?2,?3,?4,'active',?5,?6,?7,?8,?9,?10)")?;q.bind_text(1,&policy_id)?;q.bind_text(2,&c.project_id)?;q.bind_text(3,harness)?;q.bind_i64(4,revision)?;q.bind_text(5,policy_json)?;q.bind_text(6,digest)?;q.bind_text(7,&c.actor_id)?;q.bind_text(8,&c.operation_id)?;q.bind_i64(9,c.expected_revision.unwrap_or(0)+1)?;q.bind_text(10,&c.now)?;q.run()?;Ok(())})
    }
    pub fn orchestration_harness_revoke(
        &self,
        c: &V3MutationContext,
        harness: &str,
    ) -> Result<MutationResult, StoreError> {
        let bound = c.with_payload(serde_json::json!({"harness_id":harness,"state":"revoked"}));
        self.fact_mutation(&bound,"orchestration.harness.revoke","orchestration_harness_policy",harness,&[boreal_domain::ActorRole::Operator],||{let current=self.orchestration_harness_policy(&c.project_id,harness)?.ok_or_else(||StoreError::NotFound{entity:"orchestration_harness",id:harness.into()})?;if current.state!="active"{return Err(StoreError::Conflict("harness policy is already revoked".into()));}let revision=current.policy_revision+1;let policy_id=format!("{}:{}:{}",c.project_id,harness,revision);let mut q=self.prepare("INSERT INTO orchestration_harness_policy(policy_id,project_id,harness_id,policy_revision,state,policy_json,policy_digest,actor_id,operation_id,project_revision,created_at) VALUES(?1,?2,?3,?4,'revoked',?5,?6,?7,?8,?9,?10)")?;q.bind_text(1,&policy_id)?;q.bind_text(2,&c.project_id)?;q.bind_text(3,harness)?;q.bind_i64(4,revision)?;q.bind_text(5,&current.policy_json)?;q.bind_text(6,&current.policy_digest)?;q.bind_text(7,&c.actor_id)?;q.bind_text(8,&c.operation_id)?;q.bind_i64(9,c.expected_revision.unwrap_or(0)+1)?;q.bind_text(10,&c.now)?;q.run()?;Ok(())})
    }
    pub fn orchestration_process_active_jobs(
        &self,
        project: &str,
        limit: u64,
    ) -> Result<Vec<OrchestrationProcessJob>, StoreError> {
        let mut q=self.prepare("SELECT job_id,project_id,run_id,tick_id,work_id,attempt_id,fence,actor_id,session_id,harness_id,state,pid,started_at,deadline,ended_at,exit_code,result_digest,error_message,revision FROM orchestration_process_job WHERE project_id=?1 AND state IN ('starting','running','readback_required') ORDER BY started_at LIMIT ?2")?;
        q.bind_text(1, project)?;
        q.bind_i64(2, limit.min(1000))?;
        let mut v = vec![];
        while q.step()? == SQLITE_ROW {
            v.push(OrchestrationProcessJob {
                job_id: q.column_text(0)?,
                project_id: q.column_text(1)?,
                run_id: q.column_text(2)?,
                tick_id: q.column_text(3)?,
                work_id: q.column_text(4)?,
                attempt_id: q.column_text(5)?,
                fence: q.column_u64(6)?,
                actor_id: q.column_text(7)?,
                session_id: q.column_text(8)?,
                harness_id: q.column_text(9)?,
                state: q.column_text(10)?,
                pid: q.column_optional_i64(11)?,
                started_at: q.column_text(12)?,
                deadline: q.column_text(13)?,
                ended_at: q.column_optional_text(14)?,
                exit_code: q.column_optional_signed_i64(15)?,
                result_digest: q.column_optional_text(16)?,
                error_message: q.column_optional_text(17)?,
                revision: q.column_u64(18)?,
            });
        }
        Ok(v)
    }
    pub fn install_orchestration_runtime_schema(&self) -> Result<(), StoreError> {
        self.execute_batch(ORCHESTRATION_RUNTIME_SCHEMA_SQL)
    }
    pub fn orchestration_worker(
        &self,
        project: &str,
    ) -> Result<Option<OrchestrationWorker>, StoreError> {
        let mut q=self.prepare("SELECT project_id,owner_id,state,lease_until,heartbeat_at,max_workers,max_requests,requests_completed,revision FROM orchestration_worker WHERE project_id=?1")?;
        q.bind_text(1, project)?;
        if q.step()? != SQLITE_ROW {
            return Ok(None);
        }
        Ok(Some(OrchestrationWorker {
            project_id: q.column_text(0)?,
            owner_id: q.column_text(1)?,
            state: q.column_text(2)?,
            lease_until: q.column_text(3)?,
            heartbeat_at: q.column_text(4)?,
            max_workers: q.column_u64(5)?,
            max_requests: q.column_u64(6)?,
            requests_completed: q.column_u64(7)?,
            revision: q.column_u64(8)?,
        }))
    }
    pub fn orchestration_worker_acquire(
        &self,
        c: &V3MutationContext,
        owner: &str,
        lease_until: &str,
        max_workers: u64,
        max_requests: u64,
    ) -> Result<MutationResult, StoreError> {
        if !(1..=32).contains(&max_workers) || !(1..=10000).contains(&max_requests) {
            return Err(StoreError::Invalid(
                "worker bounds are outside supported limits".into(),
            ));
        }
        let b=c.with_payload(serde_json::json!({"owner":owner,"lease_until":lease_until,"max_workers":max_workers,"max_requests":max_requests}));
        self.v3_mutation(&b,"orchestration.daemon.acquire","orchestration_worker",&c.project_id,||{
   let existing=self.orchestration_worker(&c.project_id)?;
   if let Some(w)=existing { if worker_lease_is_active(&w.lease_until,&c.now)&&w.owner_id!=owner&&w.state!="stopped" {return Err(StoreError::Conflict(format!("worker lease held by {} until {}",w.owner_id,w.lease_until)));} }
   let mut q=self.prepare("INSERT INTO orchestration_worker(project_id,owner_id,state,lease_until,heartbeat_at,max_workers,max_requests,requests_completed,revision) VALUES(?1,?2,'running',?3,?4,?5,?6,0,1) ON CONFLICT(project_id) DO UPDATE SET owner_id=excluded.owner_id,state='running',lease_until=excluded.lease_until,heartbeat_at=excluded.heartbeat_at,max_workers=excluded.max_workers,max_requests=excluded.max_requests,requests_completed=0,revision=orchestration_worker.revision+1")?;
   q.bind_text(1,&c.project_id)?;q.bind_text(2,owner)?;q.bind_text(3,lease_until)?;q.bind_text(4,&c.now)?;q.bind_i64(5,max_workers)?;q.bind_i64(6,max_requests)?;q.run()?;Ok(())
  })
    }
    pub fn orchestration_worker_heartbeat(
        &self,
        c: &V3MutationContext,
        owner: &str,
        lease_until: &str,
        completed: u64,
    ) -> Result<MutationResult, StoreError> {
        let b=c.with_payload(serde_json::json!({"owner":owner,"lease_until":lease_until,"requests_completed":completed}));
        self.v3_mutation(&b,"orchestration.daemon.heartbeat","orchestration_worker",&c.project_id,||{
   let mut q=self.prepare("UPDATE orchestration_worker SET heartbeat_at=?4,lease_until=?5,requests_completed=requests_completed+?6,revision=revision+1 WHERE project_id=?1 AND owner_id=?2 AND state='running' AND revision=?3")?;q.bind_text(1,&c.project_id)?;q.bind_text(2,owner)?;q.bind_i64(3,c.expected_revision.unwrap_or(0))?;q.bind_text(4,&c.now)?;q.bind_text(5,lease_until)?;q.bind_i64(6,completed)?;q.run()?;if q.changes()?==0{return Err(StoreError::Conflict("worker ownership or revision changed".into()));}Ok(())
  })
    }
    pub fn orchestration_worker_stop(
        &self,
        c: &V3MutationContext,
        owner: &str,
    ) -> Result<MutationResult, StoreError> {
        let b = c.with_payload(serde_json::json!({"owner":owner,"state":"stopped"}));
        self.v3_mutation(&b,"orchestration.daemon.stop","orchestration_worker",&c.project_id,||{let mut q=self.prepare("UPDATE orchestration_worker SET state='stopped',lease_until=?3,heartbeat_at=?3,revision=revision+1 WHERE project_id=?1 AND owner_id=?2 AND revision=?4")?;q.bind_text(1,&c.project_id)?;q.bind_text(2,owner)?;q.bind_text(3,&c.now)?;q.bind_i64(4,c.expected_revision.unwrap_or(0))?;q.run()?;if q.changes()?==0{return Err(StoreError::Conflict("worker owner/revision changed before stop".into()));}Ok(())})
    }
    pub fn orchestration_process_register(
        &self,
        c: &V3MutationContext,
        j: &OrchestrationProcessJob,
    ) -> Result<MutationResult, StoreError> {
        if j.project_id != c.project_id
            || j.actor_id != c.actor_id
            || Some(j.session_id.as_str()) != c.session_id.as_deref()
        {
            return Err(StoreError::Invalid(
                "process job does not match authenticated project/actor/session".into(),
            ));
        }
        let b=c.with_payload(serde_json::json!({"job_id":j.job_id,"run_id":j.run_id,"tick_id":j.tick_id,"work_id":j.work_id,"attempt_id":j.attempt_id,"fence":j.fence,"actor_id":j.actor_id,"session_id":j.session_id,"harness_id":j.harness_id,"state":j.state,"deadline":j.deadline}));
        self.v3_mutation(&b,"orchestration.process.start","orchestration_process_job",&j.job_id,||{let mut q=self.prepare("INSERT INTO orchestration_process_job(job_id,project_id,run_id,tick_id,work_id,attempt_id,fence,actor_id,session_id,harness_id,state,pid,started_at,deadline,ended_at,exit_code,result_digest,error_message,revision) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,'starting',NULL,?11,?12,NULL,NULL,NULL,NULL,1)")?;q.bind_text(1,&j.job_id)?;q.bind_text(2,&j.project_id)?;q.bind_text(3,&j.run_id)?;q.bind_text(4,&j.tick_id)?;q.bind_text(5,&j.work_id)?;q.bind_text(6,&j.attempt_id)?;q.bind_i64(7,j.fence)?;q.bind_text(8,&j.actor_id)?;q.bind_text(9,&j.session_id)?;q.bind_text(10,&j.harness_id)?;q.bind_text(11,&c.now)?;q.bind_text(12,&j.deadline)?;q.run()?;Ok(())})
    }
    pub fn orchestration_process_transition(
        &self,
        c: &V3MutationContext,
        id: &str,
        expected: u64,
        state: &str,
        pid: Option<u64>,
        exit_code: Option<i64>,
        digest: Option<&str>,
        error: Option<&str>,
    ) -> Result<MutationResult, StoreError> {
        if ![
            "running",
            "readback_required",
            "succeeded",
            "failed",
            "cancelled",
            "uncertain",
        ]
        .contains(&state)
        {
            return Err(StoreError::Invalid("unsupported process-job state".into()));
        }
        let b=c.with_payload(serde_json::json!({"job_id":id,"expected_revision":expected,"state":state,"pid":pid,"exit_code":exit_code,"digest":digest,"error":error}));
        self.v3_mutation(&b,"orchestration.process.transition","orchestration_process_job",id,||{
            let mut current=self.prepare("SELECT state FROM orchestration_process_job WHERE project_id=?1 AND job_id=?2 AND revision=?3")?;
            current.bind_text(1,&c.project_id)?;current.bind_text(2,id)?;current.bind_i64(3,expected)?;
            if current.step()? != SQLITE_ROW { return Err(StoreError::Conflict("process job revision changed".into())); }
            let from=current.column_text(0)?;
            let allowed=match from.as_str(){
                "starting"=>["running","failed","uncertain","readback_required"].contains(&state),
                "running"=>["succeeded","failed","cancelled","uncertain","readback_required"].contains(&state),
                "readback_required"=>state=="uncertain",
                _=>false,
            };
            if !allowed { return Err(StoreError::Conflict(format!("illegal process-job transition {from} -> {state}"))); }
            let mut q=self.prepare("UPDATE orchestration_process_job SET state=?4,pid=COALESCE(?5,pid),exit_code=?6,result_digest=?7,error_message=?8,ended_at=CASE WHEN ?4 IN ('succeeded','failed','cancelled','uncertain') THEN ?9 ELSE ended_at END,revision=revision+1 WHERE project_id=?1 AND job_id=?2 AND revision=?3")?;q.bind_text(1,&c.project_id)?;q.bind_text(2,id)?;q.bind_i64(3,expected)?;q.bind_text(4,state)?;q.bind_optional_i64(5,pid)?;match exit_code {Some(code)=>q.bind_signed_i64(6,code)?,None=>q.bind_null(6)?};q.bind_optional_text(7,digest)?;q.bind_optional_text(8,error)?;q.bind_text(9,&c.now)?;q.run()?;if q.changes()?==0{return Err(StoreError::Conflict("process job revision changed".into()));}Ok(())})
    }
    pub fn orchestration_process_job(
        &self,
        project: &str,
        id: &str,
    ) -> Result<Option<OrchestrationProcessJob>, StoreError> {
        let mut q=self.prepare("SELECT job_id,project_id,run_id,tick_id,work_id,attempt_id,fence,actor_id,session_id,harness_id,state,pid,started_at,deadline,ended_at,exit_code,result_digest,error_message,revision FROM orchestration_process_job WHERE project_id=?1 AND job_id=?2")?;
        q.bind_text(1, project)?;
        q.bind_text(2, id)?;
        if q.step()? != SQLITE_ROW {
            return Ok(None);
        }
        Ok(Some(OrchestrationProcessJob {
            job_id: q.column_text(0)?,
            project_id: q.column_text(1)?,
            run_id: q.column_text(2)?,
            tick_id: q.column_text(3)?,
            work_id: q.column_text(4)?,
            attempt_id: q.column_text(5)?,
            fence: q.column_u64(6)?,
            actor_id: q.column_text(7)?,
            session_id: q.column_text(8)?,
            harness_id: q.column_text(9)?,
            state: q.column_text(10)?,
            pid: q.column_optional_i64(11)?,
            started_at: q.column_text(12)?,
            deadline: q.column_text(13)?,
            ended_at: q.column_optional_text(14)?,
            exit_code: q.column_optional_signed_i64(15)?,
            result_digest: q.column_optional_text(16)?,
            error_message: q.column_optional_text(17)?,
            revision: q.column_u64(18)?,
        }))
    }
    pub fn orchestration_process_jobs(
        &self,
        project: &str,
        limit: u64,
    ) -> Result<Vec<OrchestrationProcessJob>, StoreError> {
        let mut q=self.prepare("SELECT job_id,project_id,run_id,tick_id,work_id,attempt_id,fence,actor_id,session_id,harness_id,state,pid,started_at,deadline,ended_at,exit_code,result_digest,error_message,revision FROM orchestration_process_job WHERE project_id=?1 ORDER BY started_at DESC LIMIT ?2")?;
        q.bind_text(1, project)?;
        q.bind_i64(2, limit.min(500))?;
        let mut v = vec![];
        while q.step()? == SQLITE_ROW {
            v.push(OrchestrationProcessJob {
                job_id: q.column_text(0)?,
                project_id: q.column_text(1)?,
                run_id: q.column_text(2)?,
                tick_id: q.column_text(3)?,
                work_id: q.column_text(4)?,
                attempt_id: q.column_text(5)?,
                fence: q.column_u64(6)?,
                actor_id: q.column_text(7)?,
                session_id: q.column_text(8)?,
                harness_id: q.column_text(9)?,
                state: q.column_text(10)?,
                pid: q.column_optional_i64(11)?,
                started_at: q.column_text(12)?,
                deadline: q.column_text(13)?,
                ended_at: q.column_optional_text(14)?,
                exit_code: q.column_optional_signed_i64(15)?,
                result_digest: q.column_optional_text(16)?,
                error_message: q.column_optional_text(17)?,
                revision: q.column_u64(18)?,
            });
        }
        Ok(v)
    }
}

fn worker_lease_is_active(until: &str, now: &str) -> bool {
    fn millis(v: &str) -> Option<u64> {
        v.strip_prefix("unix-ms:")?.parse().ok()
    }
    match (millis(until), millis(now)) {
        (Some(until), Some(now)) => until > now,
        _ => false,
    }
}
