//! Completion facade shared by direct and service adapters.
use crate::{ApplicationError, WorkApplication};
pub use boreal_store::completion::CompletionMutationRequest;
impl WorkApplication<'_> {
    pub fn complete(
        &self,
        request: &CompletionMutationRequest,
    ) -> Result<boreal_store::MutationResult, ApplicationError> {
        Ok(self.store_ref().apply_completion_command(request)?)
    }
}

impl WorkApplication<'_> {
    /// Returning None means the immutable result is already submitted. It is
    /// not a second execution transition and does not restart a completed lease.
    /// Closeout writers repeat all identity/fence/generation checks under lock.
    pub fn prepare_finish<A: crate::AttemptLifecycleAdapter>(
        &self,
        adapter: &A,
        request: crate::AttemptRequest,
    ) -> Result<Option<crate::OperationResult<crate::AttemptMutation>>, ApplicationError> {
        if self.store_ref().is_canonical_production() {
            let attempt = self
                .store_ref()
                .proof_attempt(request.project_id.as_str(), request.attempt_id.as_str())?;
            if attempt.work_id != request.work_id.as_str()
                || attempt.actor_id != request.actor_id.as_str()
                || attempt.session_id.as_deref() != request.session_id.as_ref().map(|s| s.as_str())
                || attempt.fence != request.fence.get()
            {
                return Err(ApplicationError::Invalid(
                    "finish does not own the exact submitted context".into(),
                ));
            }
            if attempt.phase == boreal_domain::AttemptPhase::Completed {
                return Ok(None);
            }
            if attempt.phase == boreal_domain::AttemptPhase::Verifying {
                return Ok(None);
            }
        }
        self.submit(adapter, request).map(Some)
    }
}
