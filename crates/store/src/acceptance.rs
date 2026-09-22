//! Read-only acceptance/profile binding seam.
//!
//! This module exposes the canonical gate and diagnostic reads required by
//! later acceptance work.  It keeps requirements/observations in the
//! application/domain boundary and does not make a SQL status decision.

use super::{
    CloseIntentRequest, CloseIntentResult, GateDiagnostics, GateRecord, GateStateUpdateRequest,
    MutationResult, ReceiptInsertRequest, ReceiptInsertResult, ReceiptRecord, ReviewInsertRequest,
    ReviewRecord, SqliteStore, StoreError, SummaryInsertRequest, SummaryInsertResult,
    SummaryRecord,
};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AcceptanceBinding {
    pub project_id: String,
    pub work_id: String,
    pub attempt_id: String,
    pub fence: u64,
    pub source_version_id: Option<String>,
    pub config_identity: String,
    pub profile_id: String,
    pub profile_version: u64,
}

impl AcceptanceBinding {
    pub fn matches(&self, other: &Self) -> bool {
        self == other
    }
}

pub struct AcceptanceStore<'a> {
    store: &'a SqliteStore,
}

impl<'a> AcceptanceStore<'a> {
    pub const fn new(store: &'a SqliteStore) -> Self {
        Self { store }
    }

    pub fn gate(
        &self,
        project_id: &str,
        work_id: &str,
        gate_id: &str,
    ) -> Result<Option<GateRecord>, StoreError> {
        self.store.gate(project_id, work_id, gate_id)
    }

    pub fn diagnostics(
        &self,
        project_id: &str,
        work_id: &str,
        attempt_id: &str,
        fence: u64,
    ) -> Result<GateDiagnostics, StoreError> {
        self.store
            .gate_diagnostics(project_id, work_id, attempt_id, fence)
    }

    pub fn record_receipt(
        &self,
        request: &ReceiptInsertRequest,
    ) -> Result<ReceiptInsertResult, StoreError> {
        self.store.insert_receipt(request)
    }

    pub fn receipt(&self, receipt_id: &str) -> Result<Option<ReceiptRecord>, StoreError> {
        self.store.receipt(receipt_id)
    }

    pub fn update_gate(
        &self,
        request: &GateStateUpdateRequest,
    ) -> Result<MutationResult, StoreError> {
        self.store.update_gate_state(request)
    }

    pub fn record_review(
        &self,
        request: &ReviewInsertRequest,
    ) -> Result<MutationResult, StoreError> {
        self.store.insert_review(request)
    }

    pub fn review(&self, review_id: &str) -> Result<Option<ReviewRecord>, StoreError> {
        self.store.review(review_id)
    }

    pub fn record_summary(
        &self,
        request: &SummaryInsertRequest,
    ) -> Result<SummaryInsertResult, StoreError> {
        self.store.insert_summary(request)
    }

    pub fn summary(
        &self,
        project_id: &str,
        summary_id: &str,
    ) -> Result<Option<SummaryRecord>, StoreError> {
        self.store.summary(project_id, summary_id)
    }

    pub fn open_close(
        &self,
        request: &CloseIntentRequest,
    ) -> Result<CloseIntentResult, StoreError> {
        self.store.create_close_intent(request)
    }

    pub fn finalize_close(
        &self,
        request: &CloseIntentRequest,
    ) -> Result<CloseIntentResult, StoreError> {
        self.store.finalize_close_intent(request)
    }

    pub fn reject_close(
        &self,
        request: &CloseIntentRequest,
        rejection_code: &str,
    ) -> Result<CloseIntentResult, StoreError> {
        self.store.reject_close_intent(request, rejection_code)
    }
}
