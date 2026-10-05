//! Application coordination for durable, harness-neutral runs.
//!
//! A tick delegates claiming to the existing `WorkApplication` path supplied
//! by the caller. This module never reads project SQLite directly and never
//! launches a model or agent process; the host/harness pulls canonical claims.

use crate::canonical_request_digest;
use boreal_store::{OrchestrationRun, SqliteStore, StoreError, V3MutationContext};

#[derive(Debug)]
pub enum OrchestrationError {
    Store(StoreError),
    Invalid(String),
    Claim(String),
    ClaimUnknown(String),
}
impl std::fmt::Display for OrchestrationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Store(e) => e.fmt(f),
            Self::Invalid(e) | Self::Claim(e) | Self::ClaimUnknown(e) => f.write_str(e),
        }
    }
}
impl std::error::Error for OrchestrationError {}
impl From<StoreError> for OrchestrationError {
    fn from(e: StoreError) -> Self {
        Self::Store(e)
    }
}

pub struct OrchestrationApplication<'a> {
    store: &'a SqliteStore,
}

struct TickFinish<'a> {
    context: &'a V3MutationContext,
    run_id: &'a str,
    expected_revision: u64,
    tick_id: &'a str,
    work_id: &'a str,
    outcome: &'a str,
    detail: &'a str,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TickClaimError {
    Rejected(String),
    Unknown(String),
}
impl<'a> OrchestrationApplication<'a> {
    pub fn new(store: &'a SqliteStore) -> Result<Self, OrchestrationError> {
        Ok(Self { store })
    }
    pub fn start(
        &self,
        context: &V3MutationContext,
        name: &str,
        selector: serde_json::Value,
    ) -> Result<OrchestrationRun, OrchestrationError> {
        let project_id = &context.project_id;
        if project_id.trim().is_empty() || name.trim().is_empty() {
            return Err(OrchestrationError::Invalid(
                "run name and owning project are required".into(),
            ));
        }
        let max_claims = selector
            .get("max_claims")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(1);
        if !(1..=500).contains(&max_claims) {
            return Err(OrchestrationError::Invalid(
                "max_claims must be from 1 to 500".into(),
            ));
        }
        let id = format!("run-{}", context.operation_id);
        let selector_json = serde_json::to_string(&selector)
            .map_err(|e| OrchestrationError::Invalid(e.to_string()))?;
        let run = OrchestrationRun {
            run_id: id,
            project_id: project_id.into(),
            name: name.into(),
            state: "queued".into(),
            selector_json,
            revision: 1,
            last_error: None,
            claim_count: 0,
            max_claims,
        };
        self.store.orchestration_run_create(context, &run)?;
        Ok(run)
    }
    pub fn list(
        &self,
        project: &str,
        limit: u64,
    ) -> Result<Vec<OrchestrationRun>, OrchestrationError> {
        Ok(self.store.orchestration_runs(project, limit)?)
    }
    pub fn list_after(
        &self,
        project: &str,
        after_run_id: &str,
        limit: u64,
    ) -> Result<Vec<OrchestrationRun>, OrchestrationError> {
        Ok(self
            .store
            .orchestration_runs_after(project, after_run_id, limit)?)
    }
    pub fn show(&self, project: &str, id: &str) -> Result<OrchestrationRun, OrchestrationError> {
        self.store
            .orchestration_run_read(project, id)?
            .ok_or_else(|| OrchestrationError::Invalid(format!("run {id} not found")))
    }
    pub fn events(
        &self,
        project: &str,
        id: &str,
        limit: u64,
    ) -> Result<Vec<serde_json::Value>, OrchestrationError> {
        let _ = self.show(project, id)?;
        Ok(self.store.orchestration_events(project, id, limit)?)
    }
    pub fn transition(
        &self,
        context: &V3MutationContext,
        id: &str,
        expected: u64,
        state: &str,
        error: Option<&str>,
    ) -> Result<OrchestrationRun, OrchestrationError> {
        let mutation = self
            .store
            .orchestration_run_transition(context, id, expected, state, error)?;
        let run = self.show(&context.project_id, id)?;
        if !mutation.replayed && run.revision != expected + 1 {
            return Err(OrchestrationError::Invalid(
                "run changed while reading transition result".into(),
            ));
        }
        Ok(run)
    }
    pub fn pending_work(
        &self,
        project: &str,
        id: &str,
    ) -> Result<Option<String>, OrchestrationError> {
        let run = self.show(project, id)?;
        let selector: serde_json::Value = serde_json::from_str(&run.selector_json)
            .map_err(|e| OrchestrationError::Invalid(e.to_string()))?;
        Ok(selector
            .get("pending_work")
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned))
    }
    pub fn tick_record(
        &self,
        project: &str,
        id: &str,
        tick_id: &str,
    ) -> Result<Option<boreal_store::orchestration::OrchestrationTickRecord>, OrchestrationError>
    {
        Ok(self.store.orchestration_tick_read(project, id, tick_id)?)
    }
    pub fn select_work(
        &self,
        context: &V3MutationContext,
        id: &str,
        expected: u64,
        work: &str,
    ) -> Result<OrchestrationRun, OrchestrationError> {
        let run = self.show(&context.project_id, id)?;
        if let Some(pending) = self.pending_work(&context.project_id, id)? {
            let selector: serde_json::Value = serde_json::from_str(&run.selector_json)
                .map_err(|e| OrchestrationError::Invalid(e.to_string()))?;
            let expected_tick = context
                .operation_id
                .strip_suffix(":select")
                .unwrap_or(&context.operation_id);
            if pending == work
                && selector
                    .get("pending_tick_id")
                    .and_then(serde_json::Value::as_str)
                    == Some(expected_tick)
            {
                return Ok(run);
            }
            return Err(OrchestrationError::Invalid(
                "run already has a different pending tick; replay that claim operation".into(),
            ));
        }
        let tick_id = context
            .operation_id
            .strip_suffix(":select")
            .unwrap_or(&context.operation_id);
        self.store
            .orchestration_tick_select(context, tick_id, id, expected, work)?;
        self.show(&context.project_id, id)
    }
    fn finish_tick(&self, request: TickFinish<'_>) -> Result<(), OrchestrationError> {
        let TickFinish {
            context,
            run_id,
            expected_revision,
            tick_id,
            work_id,
            outcome,
            detail,
        } = request;
        let mut c = context.clone();
        c.operation_id = format!("{}:finish", context.operation_id);
        c.expected_revision = Some(self.store.project_revision(&context.project_id)?.0);
        c.request_digest = canonical_request_digest(
            "orchestration.tick.finish",
            serde_json::json!({"base":context.request_digest,"run_id":run_id,"work":work_id,"outcome":outcome,"detail":detail}),
        );
        self.store.orchestration_tick_finish(
            &c,
            tick_id,
            run_id,
            expected_revision,
            work_id,
            outcome,
            detail,
        )?;
        Ok(())
    }
    /// A single scheduler tick asks the canonical claim adapter for work. A
    /// tick is informational: it may report no work or an existing claim, but
    /// it cannot manufacture a claim or represent a harness launch as done.
    pub fn tick<F>(
        &self,
        context: &V3MutationContext,
        id: &str,
        expected: u64,
        tick_id: &str,
        work: &str,
        mut claim: F,
    ) -> Result<serde_json::Value, OrchestrationError>
    where
        F: FnMut(&str, &str, &serde_json::Value) -> Result<serde_json::Value, TickClaimError>,
    {
        let run = self.show(&context.project_id, id)?;
        if let Some(record) = self.tick_record(&context.project_id, id, tick_id)? {
            if record.state == "claimed" {
                let result: serde_json::Value = record
                    .result_json
                    .as_deref()
                    .and_then(|s| serde_json::from_str(s).ok())
                    .unwrap_or(serde_json::Value::Null);
                return Ok(
                    serde_json::json!({"run_id":id,"outcome":"claimed","claim":result,"claim_count":run.claim_count,"max_claims":run.max_claims,"dispatch":"harness_pull_required","replayed":true}),
                );
            }
            if record.state == "rejected" {
                return Err(OrchestrationError::Claim(
                    record
                        .result_json
                        .unwrap_or_else(|| "canonical claim was rejected".into()),
                ));
            }
            if record.work_id != work {
                return Err(OrchestrationError::Invalid(
                    "tick replay work does not match durable selection".into(),
                ));
            }
        }
        if run.revision != expected {
            return Err(OrchestrationError::Invalid("run revision conflict".into()));
        }
        if run.state != "queued" && run.state != "running" {
            return Err(OrchestrationError::Invalid(format!(
                "run is {}, so it cannot tick",
                run.state
            )));
        }
        if run.claim_count >= run.max_claims {
            return Err(OrchestrationError::Invalid(format!(
                "run reached max_claims ({}/{})",
                run.claim_count, run.max_claims
            )));
        }
        let selector: serde_json::Value = serde_json::from_str(&run.selector_json)
            .map_err(|e| OrchestrationError::Invalid(e.to_string()))?;
        if selector
            .get("pending_work")
            .and_then(serde_json::Value::as_str)
            != Some(work)
        {
            return Err(OrchestrationError::Invalid(
                "selected work does not match the durable pending tick".into(),
            ));
        }
        let claim_result = match claim(&run.project_id, work, &selector) {
            Ok(value) => value,
            Err(TickClaimError::Unknown(error)) => {
                return Err(OrchestrationError::ClaimUnknown(error))
            }
            Err(TickClaimError::Rejected(error)) => {
                self.finish_tick(TickFinish {
                    context,
                    run_id: id,
                    expected_revision: expected,
                    tick_id,
                    work_id: work,
                    outcome: "rejected",
                    detail: &error,
                })?;
                return Err(OrchestrationError::Claim(error));
            }
        };
        let observation = serde_json::json!({"outcome":"claimed","claim":claim_result});
        let detail = observation.to_string();
        self.finish_tick(TickFinish {
            context,
            run_id: id,
            expected_revision: expected,
            tick_id,
            work_id: work,
            outcome: "claimed",
            detail: &detail,
        })?;
        Ok(
            serde_json::json!({"run_id":id,"outcome":"claimed","claim":claim_result,"claim_count":run.claim_count+1,"max_claims":run.max_claims,"dispatch":"harness_pull_required"}),
        )
    }
}
