//! Coordinator-owned adapters for root store mutations.
//!
//! `SqliteStore` remains the only transaction and project-revision owner.  The
//! public types in this module deliberately do not begin, commit, roll back,
//! or re-check a revision, and they do not expose the raw store handle.  Each
//! method delegates to one existing root mutation, whose `BEGIN IMMEDIATE`,
//! expected-revision check, revision bump, and commit/rollback behavior remain
//! authoritative.
//!
//! This is a scoped adapter, not a second transaction API.  The coordinator
//! may use it to select a root-owned mutation while preserving the root's
//! transaction boundary.  In particular, callers cannot use this adapter to
//! wrap a root mutation in another `BEGIN` path.

use super::{
    CloseIntentRequest, CloseIntentResult, GateStateUpdateRequest, MutationResult,
    ReceiptInsertRequest, ReceiptInsertResult, ReviewInsertRequest, SqliteStore, StoreError,
    SummaryInsertRequest, SummaryInsertResult,
};

/// A coordinator-scoped view of root-owned project mutations.
///
/// The adapter stores only the project scope and a private reference to the
/// root.  It intentionally has no `store()` accessor and no transaction
/// lifecycle methods.  Root methods receive the request and own the complete
/// transaction/revision boundary.
#[derive(Debug)]
pub struct RootMutationAdapter<'a> {
    store: &'a SqliteStore,
    project_id: &'a str,
}

impl<'a> RootMutationAdapter<'a> {
    /// Creates a scoped adapter without opening a transaction.
    pub(crate) const fn new(store: &'a SqliteStore, project_id: &'a str) -> Self {
        Self { store, project_id }
    }

    fn require_scope(&self, request_project_id: &str) -> Result<(), StoreError> {
        if request_project_id != self.project_id {
            return Err(StoreError::WrongSubject {
                expected: self.project_id.to_owned(),
                actual: request_project_id.to_owned(),
            });
        }
        Ok(())
    }

    /// Delegates to the root gate mutation.  The root owns its transaction,
    /// expected-revision check, revision bump, and rollback path.
    pub fn update_gate(
        &self,
        request: &GateStateUpdateRequest,
    ) -> Result<MutationResult, StoreError> {
        self.require_scope(&request.project_id)?;
        self.store.update_gate_state(request)
    }

    /// Delegates to the root receipt mutation without introducing a wrapper
    /// transaction.
    pub fn record_receipt(
        &self,
        request: &ReceiptInsertRequest,
    ) -> Result<ReceiptInsertResult, StoreError> {
        self.require_scope(&request.project_id)?;
        self.store.insert_receipt(request)
    }

    /// Delegates to the root review mutation without introducing a wrapper
    /// transaction.
    pub fn record_review(
        &self,
        request: &ReviewInsertRequest,
    ) -> Result<MutationResult, StoreError> {
        self.require_scope(&request.project_id)?;
        self.store.insert_review(request)
    }

    /// Delegates to the root summary mutation without introducing a wrapper
    /// transaction.
    pub fn record_summary(
        &self,
        request: &SummaryInsertRequest,
    ) -> Result<SummaryInsertResult, StoreError> {
        self.require_scope(&request.project_id)?;
        self.store.insert_summary(request)
    }

    /// Delegates to the root close-intent creation mutation without
    /// introducing a wrapper transaction.
    pub fn open_close(
        &self,
        request: &CloseIntentRequest,
    ) -> Result<CloseIntentResult, StoreError> {
        self.require_scope(&request.project_id)?;
        self.store.create_close_intent(request)
    }

    /// Delegates to the root close-intent finalization mutation without
    /// introducing a wrapper transaction.
    pub fn finalize_close(
        &self,
        request: &CloseIntentRequest,
    ) -> Result<CloseIntentResult, StoreError> {
        self.require_scope(&request.project_id)?;
        self.store.finalize_close_intent(request)
    }

    /// Delegates to the root close-intent rejection mutation without
    /// introducing a wrapper transaction.
    pub fn reject_close(
        &self,
        request: &CloseIntentRequest,
        rejection_code: &str,
    ) -> Result<CloseIntentResult, StoreError> {
        self.require_scope(&request.project_id)?;
        self.store.reject_close_intent(request, rejection_code)
    }
}

/// Runs a coordinator callback against root-owned mutations.
///
/// This function is intentionally not named `with_*_transaction`: it does
/// not start or finish a transaction.  The callback receives only the scoped
/// adapter, so it cannot reach through this seam to invoke an arbitrary raw
/// `SqliteStore` method.  The selected root mutation remains the sole owner
/// of transaction and revision semantics.
pub fn with_root_mutation<T, F>(
    store: &SqliteStore,
    project_id: &str,
    body: F,
) -> Result<T, StoreError>
where
    F: FnOnce(&RootMutationAdapter<'_>) -> Result<T, StoreError>,
{
    body(&RootMutationAdapter::new(store, project_id))
}
