//! Policy and application boundary for opt-in local orchestration workers.
//! Process launch is delegated to a CLI adapter after these durable checks;
//! no SQLite transaction is held while the child process runs.
use boreal_store::orchestration_runtime::{
    OrchestrationHarnessPolicy, OrchestrationWorkerPoolPolicy,
};
use boreal_store::{
    OrchestrationProcessJob, OrchestrationWorker, SqliteStore, StoreError, V3MutationContext,
};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug)]
pub enum RuntimeError {
    Store(StoreError),
    Invalid(String),
    Identity(String),
}
impl std::fmt::Display for RuntimeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Store(e) => e.fmt(f),
            Self::Invalid(e) | Self::Identity(e) => f.write_str(e),
        }
    }
}
impl std::error::Error for RuntimeError {}
impl From<StoreError> for RuntimeError {
    fn from(e: StoreError) -> Self {
        Self::Store(e)
    }
}

/// Only operator-owned config is accepted. Arguments are individual argv
/// entries; no shell parsing or command string is ever performed.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HarnessPolicy {
    pub harness_id: String,
    pub executable: PathBuf,
    #[serde(default)]
    pub args: Vec<String>,
    pub cwd: PathBuf,
    #[serde(default)]
    pub environment: Vec<(String, String)>,
    pub timeout_ms: u64,
    #[serde(default = "default_output_cap")]
    pub output_cap_bytes: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkerIdentity {
    pub actor_id: String,
    pub session_id: String,
    pub harness_id: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkerPoolPolicy {
    pub workers: Vec<WorkerIdentity>,
}
impl WorkerPoolPolicy {
    pub fn validate(&self) -> Result<(), RuntimeError> {
        if self.workers.is_empty() || self.workers.len() > 32 {
            return Err(RuntimeError::Invalid(
                "worker pool must contain from 1 to 32 identities".into(),
            ));
        }
        let mut ids = std::collections::BTreeSet::new();
        for identity in &self.workers {
            if [
                identity.actor_id.as_str(),
                identity.session_id.as_str(),
                identity.harness_id.as_str(),
            ]
            .iter()
            .any(|v| v.trim().is_empty() || v.chars().any(char::is_control))
            {
                return Err(RuntimeError::Invalid("worker pool identity fields must be non-empty and contain no control characters".into()));
            }
            if identity.actor_id.len() > 256
                || identity.session_id.len() > 256
                || identity.harness_id.len() > 256
            {
                return Err(RuntimeError::Invalid(
                    "worker pool identity fields are limited to 256 bytes".into(),
                ));
            }
            if !ids.insert(identity.session_id.as_str()) {
                return Err(RuntimeError::Invalid("worker pool session IDs must be unique because the canonical attempt model allows one active attempt per session".into()));
            }
        }
        Ok(())
    }
}
fn default_output_cap() -> u64 {
    1024 * 1024
}
impl HarnessPolicy {
    pub fn validate(&self, workspace: &Path) -> Result<(), RuntimeError> {
        if self.harness_id.trim().is_empty() || self.harness_id.chars().any(char::is_control) {
            return Err(RuntimeError::Invalid(
                "harness id is empty or contains control characters".into(),
            ));
        }
        if !self.executable.is_absolute() || !self.executable.is_file() {
            return Err(RuntimeError::Invalid(
                "configured harness executable must be an existing absolute file".into(),
            ));
        }
        let metadata = std::fs::symlink_metadata(&self.executable).map_err(|e| {
            RuntimeError::Invalid(format!("cannot inspect harness executable: {e}"))
        })?;
        if metadata.file_type().is_symlink() {
            return Err(RuntimeError::Invalid(
                "harness executable may not be a symlink".into(),
            ));
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if metadata.permissions().mode() & 0o111 == 0 {
                return Err(RuntimeError::Invalid(
                    "harness executable is not executable".into(),
                ));
            }
        }
        if !self.cwd.is_absolute() || !self.cwd.starts_with(workspace) || !self.cwd.is_dir() {
            return Err(RuntimeError::Invalid(
                "harness working directory must be inside the linked workspace".into(),
            ));
        }
        if !(1_000..=7_200_000).contains(&self.timeout_ms) {
            return Err(RuntimeError::Invalid(
                "harness timeout must be between 1 second and 2 hours".into(),
            ));
        }
        if !(1024..=16 * 1024 * 1024).contains(&self.output_cap_bytes) {
            return Err(RuntimeError::Invalid(
                "harness output cap must be between 1 KiB and 16 MiB".into(),
            ));
        }
        for arg in &self.args {
            if arg.chars().any(char::is_control) {
                return Err(RuntimeError::Invalid(
                    "harness argv contains a control character".into(),
                ));
            }
        }
        for (name, value) in &self.environment {
            if name.is_empty()
                || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
                || name.to_ascii_uppercase().contains("TOKEN")
                || name.to_ascii_uppercase().contains("SECRET")
                || value.chars().any(char::is_control)
            {
                return Err(RuntimeError::Invalid(
                    "harness environment contains an invalid or credential-bearing entry".into(),
                ));
            }
        }
        Ok(())
    }
}

pub struct OrchestrationRuntimeApplication<'a> {
    store: &'a SqliteStore,
}
impl<'a> OrchestrationRuntimeApplication<'a> {
    pub fn new(store: &'a SqliteStore) -> Self {
        Self { store }
    }
    pub fn acquire(
        &self,
        c: &V3MutationContext,
        owner: &str,
        lease_until: &str,
        workers: u64,
        requests: u64,
    ) -> Result<OrchestrationWorker, RuntimeError> {
        self.store
            .orchestration_worker_acquire(c, owner, lease_until, workers, requests)?;
        self.store
            .orchestration_worker(&c.project_id)?
            .ok_or_else(|| {
                RuntimeError::Invalid("worker lease disappeared after acquisition".into())
            })
    }
    pub fn worker(&self, project: &str) -> Result<Option<OrchestrationWorker>, RuntimeError> {
        Ok(self.store.orchestration_worker(project)?)
    }
    pub fn heartbeat(
        &self,
        c: &V3MutationContext,
        owner: &str,
        until: &str,
        completed: u64,
    ) -> Result<OrchestrationWorker, RuntimeError> {
        self.store
            .orchestration_worker_heartbeat(c, owner, until, completed)?;
        self.store
            .orchestration_worker(&c.project_id)?
            .ok_or_else(|| RuntimeError::Invalid("worker disappeared after heartbeat".into()))
    }
    pub fn stop(&self, c: &V3MutationContext, owner: &str) -> Result<(), RuntimeError> {
        self.store.orchestration_worker_stop(c, owner)?;
        Ok(())
    }
    pub fn register_process(
        &self,
        c: &V3MutationContext,
        job: &OrchestrationProcessJob,
    ) -> Result<(), RuntimeError> {
        self.store.orchestration_process_register(c, job)?;
        Ok(())
    }
    #[expect(
        clippy::too_many_arguments,
        reason = "preserves the public process transition API used by launch and recovery callers"
    )]
    pub fn transition_process(
        &self,
        c: &V3MutationContext,
        id: &str,
        revision: u64,
        state: &str,
        pid: Option<u64>,
        exit_code: Option<i64>,
        digest: Option<&str>,
        error: Option<&str>,
    ) -> Result<(), RuntimeError> {
        self.store.orchestration_process_transition(
            c, id, revision, state, pid, exit_code, digest, error,
        )?;
        Ok(())
    }
    pub fn configure_policy(
        &self,
        c: &V3MutationContext,
        policy: &HarnessPolicy,
    ) -> Result<(String, bool), RuntimeError> {
        let json =
            serde_json::to_string(policy).map_err(|e| RuntimeError::Invalid(e.to_string()))?;
        let digest = boreal_store::checksum(json.as_bytes());
        let result =
            self.store
                .orchestration_harness_configure(c, &policy.harness_id, &json, &digest)?;
        Ok((digest, result.replayed))
    }
    pub fn configure_pool(
        &self,
        c: &V3MutationContext,
        pool_id: &str,
        policy: &WorkerPoolPolicy,
    ) -> Result<(String, bool), RuntimeError> {
        if pool_id.trim().is_empty() || pool_id.len() > 128 || pool_id.chars().any(char::is_control)
        {
            return Err(RuntimeError::Invalid(
                "worker pool ID must be 1 to 128 printable bytes".into(),
            ));
        }
        policy.validate()?;
        let json =
            serde_json::to_string(policy).map_err(|e| RuntimeError::Invalid(e.to_string()))?;
        let digest = boreal_store::checksum(json.as_bytes());
        let result = self
            .store
            .orchestration_worker_pool_configure(c, pool_id, &json, &digest)?;
        Ok((digest, result.replayed))
    }
    pub fn worker_pool(
        &self,
        project: &str,
        pool_id: &str,
    ) -> Result<Option<(WorkerPoolPolicy, String, u64)>, RuntimeError> {
        let Some(record) = self
            .store
            .orchestration_worker_pool_policy(project, pool_id)?
        else {
            return Ok(None);
        };
        if boreal_store::checksum(record.policy_json.as_bytes()) != record.policy_digest {
            return Err(RuntimeError::Invalid(
                "stored worker pool policy digest mismatch".into(),
            ));
        }
        let policy: WorkerPoolPolicy = serde_json::from_str(&record.policy_json).map_err(|e| {
            RuntimeError::Invalid(format!("stored worker pool policy is corrupt: {e}"))
        })?;
        policy.validate()?;
        if record.state != "active" {
            return Ok(None);
        }
        Ok(Some((policy, record.policy_digest, record.policy_revision)))
    }
    pub fn worker_pool_record(
        &self,
        project: &str,
        pool_id: &str,
    ) -> Result<Option<OrchestrationWorkerPoolPolicy>, RuntimeError> {
        let record = self
            .store
            .orchestration_worker_pool_policy(project, pool_id)?;
        if let Some(record) = &record {
            if boreal_store::checksum(record.policy_json.as_bytes()) != record.policy_digest {
                return Err(RuntimeError::Invalid(
                    "stored worker pool policy digest mismatch".into(),
                ));
            }
            let policy: WorkerPoolPolicy = serde_json::from_str(&record.policy_json)
                .map_err(|e| RuntimeError::Invalid(e.to_string()))?;
            policy.validate()?;
        }
        Ok(record)
    }
    pub fn worker_pools(
        &self,
        project: &str,
    ) -> Result<Vec<OrchestrationWorkerPoolPolicy>, RuntimeError> {
        let records = self.store.orchestration_worker_pool_policies(project)?;
        for record in &records {
            if boreal_store::checksum(record.policy_json.as_bytes()) != record.policy_digest {
                return Err(RuntimeError::Invalid(format!(
                    "worker pool {} has a digest mismatch",
                    record.pool_id
                )));
            }
            let policy: WorkerPoolPolicy =
                serde_json::from_str(&record.policy_json).map_err(|e| {
                    RuntimeError::Invalid(format!("worker pool {} is corrupt: {e}", record.pool_id))
                })?;
            policy.validate()?;
        }
        Ok(records)
    }
    pub fn revoke_pool(&self, c: &V3MutationContext, pool_id: &str) -> Result<bool, RuntimeError> {
        Ok(self
            .store
            .orchestration_worker_pool_revoke(c, pool_id)?
            .replayed)
    }
    pub fn revoke_policy(
        &self,
        c: &V3MutationContext,
        harness: &str,
    ) -> Result<bool, RuntimeError> {
        Ok(self
            .store
            .orchestration_harness_revoke(c, harness)?
            .replayed)
    }
    pub fn policy(
        &self,
        project: &str,
        harness: &str,
    ) -> Result<Option<(HarnessPolicy, String, u64)>, RuntimeError> {
        match self.store.orchestration_harness_policy(project, harness)? {
            Some(record) if record.state == "active" => {
                if boreal_store::checksum(record.policy_json.as_bytes()) != record.policy_digest {
                    return Err(RuntimeError::Invalid(
                        "stored harness policy digest does not match its content".into(),
                    ));
                }
                let policy: HarnessPolicy =
                    serde_json::from_str(&record.policy_json).map_err(|e| {
                        RuntimeError::Invalid(format!("stored harness policy is corrupt: {e}"))
                    })?;
                Ok(Some((policy, record.policy_digest, record.policy_revision)))
            }
            _ => Ok(None),
        }
    }
    pub fn policies(&self, project: &str) -> Result<Vec<OrchestrationHarnessPolicy>, RuntimeError> {
        let records = self.store.orchestration_harness_policies(project)?;
        for record in &records {
            if boreal_store::checksum(record.policy_json.as_bytes()) != record.policy_digest {
                return Err(RuntimeError::Invalid(format!(
                    "stored harness policy {} has a digest mismatch",
                    record.harness_id
                )));
            }
        }
        Ok(records)
    }
    pub fn active_jobs(
        &self,
        project: &str,
        limit: u64,
    ) -> Result<Vec<OrchestrationProcessJob>, RuntimeError> {
        Ok(self
            .store
            .orchestration_process_active_jobs(project, limit)?)
    }
    pub fn jobs(
        &self,
        project: &str,
        limit: u64,
    ) -> Result<Vec<OrchestrationProcessJob>, RuntimeError> {
        Ok(self.store.orchestration_process_jobs(project, limit)?)
    }
    pub fn verify_bound_session(
        &self,
        project: &str,
        actor: &str,
        session: &str,
        harness: &str,
    ) -> Result<(), RuntimeError> {
        let record = self
            .store
            .session_for_claim(project, session, actor, harness)?;
        if record.state != boreal_store::SessionState::Active {
            return Err(RuntimeError::Identity(
                "configured harness session is not active".into(),
            ));
        }
        Ok(())
    }
}
