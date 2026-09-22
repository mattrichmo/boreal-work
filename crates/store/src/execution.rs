//! Durable evidence-execution seam.
//!
//! This adapter keeps admission, process lifecycle, and project-scoped
//! readback behind named interfaces.  It delegates lifecycle authorization and
//! receipt satisfaction to the existing application/store contract; it does
//! not spawn processes or invent a second policy engine.

use super::{
    EvidenceExecutionAdmissionRequest, EvidenceExecutionAdmissionResult, EvidenceExecutionRecord,
    SqliteStore, StoreError,
};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExecutionIdentity {
    pub operation_id: String,
    pub project_id: String,
    pub work_id: String,
    pub attempt_id: String,
    pub fence: u64,
    pub artifact_ref: String,
}

impl From<&EvidenceExecutionRecord> for ExecutionIdentity {
    fn from(execution: &EvidenceExecutionRecord) -> Self {
        Self {
            operation_id: execution.operation_id.clone(),
            project_id: execution.project_id.clone(),
            work_id: execution.work_id.clone(),
            attempt_id: execution.attempt_id.clone(),
            fence: execution.fence,
            artifact_ref: execution.artifact_ref.clone(),
        }
    }
}

pub struct ExecutionStore<'a> {
    store: &'a SqliteStore,
}

impl<'a> ExecutionStore<'a> {
    pub const fn new(store: &'a SqliteStore) -> Self {
        Self { store }
    }

    pub fn admit(
        &self,
        request: &EvidenceExecutionAdmissionRequest,
    ) -> Result<EvidenceExecutionAdmissionResult, StoreError> {
        self.store.admit_evidence_execution(request)
    }

    pub fn start(
        &self,
        operation_id: &str,
        started_at: &str,
    ) -> Result<EvidenceExecutionRecord, StoreError> {
        self.store
            .start_evidence_execution(operation_id, started_at)
    }

    pub fn finish(
        &self,
        operation_id: &str,
        exited_at: &str,
        exit_code: Option<i32>,
    ) -> Result<EvidenceExecutionRecord, StoreError> {
        self.store
            .finish_evidence_execution(operation_id, exited_at, exit_code)
    }

    pub fn mark_unknown(
        &self,
        operation_id: &str,
        failure_code: &str,
    ) -> Result<EvidenceExecutionRecord, StoreError> {
        self.store
            .mark_evidence_execution_unknown(operation_id, failure_code)
    }

    pub fn incomplete(&self) -> Result<Vec<EvidenceExecutionRecord>, StoreError> {
        self.store.list_incomplete_evidence_executions()
    }
}
