//! Application use cases for durable actor/harness session registration.

use boreal_domain::{ActorId, HarnessId, OperationId, ProjectId, SessionId, TimestampMs};
use boreal_store::SessionRecord;

use crate::{canonical_request_digest, ApplicationError, OperationResult, WorkApplication};
use serde_json::{json, Value};

pub use boreal_store::{
    SessionRegistrationRequest as StoreSessionRegistrationRequest, SessionRegistrationResult,
};

/// Typed application request for registering one project-scoped session.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SessionRegistrationRequest {
    pub project_id: ProjectId,
    pub session_id: SessionId,
    pub actor_id: ActorId,
    pub harness_id: HarnessId,
    pub operation_id: OperationId,
    pub request_digest: String,
    pub expected_project_revision: Option<u64>,
    pub started_at: TimestampMs,
}

impl SessionRegistrationRequest {
    pub fn new(
        project_id: ProjectId,
        session_id: SessionId,
        actor_id: ActorId,
        harness_id: HarnessId,
        operation_id: OperationId,
        started_at: TimestampMs,
    ) -> Self {
        let request_digest = canonical_request_digest(
            "session.register/v1",
            json!({
                "project_id": project_id.as_str(),
                "session_id": session_id.as_str(),
                "actor_id": actor_id.as_str(),
                "harness_id": harness_id.as_str(),
                "expected_project_revision": Value::Null,
            }),
        );
        Self {
            project_id,
            session_id,
            actor_id,
            harness_id,
            operation_id,
            request_digest,
            expected_project_revision: None,
            started_at,
        }
    }
}

impl WorkApplication<'_> {
    /// Registers a session and returns its durable readback. Reusing the same
    /// operation ID and request digest is idempotent and does not advance the
    /// project revision.
    pub fn register_session(
        &self,
        request: &SessionRegistrationRequest,
    ) -> Result<OperationResult<SessionRecord>, ApplicationError> {
        let result = self
            .store_ref()
            .register_session(StoreSessionRegistrationRequest {
                project_id: request.project_id.as_str().to_owned(),
                session_id: request.session_id.as_str().to_owned(),
                actor_id: request.actor_id.as_str().to_owned(),
                harness_id: request.harness_id.as_str().to_owned(),
                operation_id: request.operation_id.as_str().to_owned(),
                request_digest: request.request_digest.clone(),
                expected_project_revision: request.expected_project_revision,
                started_at: stamp(request.started_at),
            })?;
        Ok(OperationResult {
            operation_id: request.operation_id.as_str().to_owned(),
            snapshot_revision: result.revision,
            changed: !result.replayed,
            value: result.session,
        })
    }

    /// Convenience form for callers that already use the store's canonical
    /// timestamp text representation.
    #[allow(clippy::too_many_arguments)]
    pub fn register_session_as(
        &self,
        project_id: &ProjectId,
        actor_id: &str,
        harness_id: &str,
        session_id: &str,
        started_at: &str,
        operation_id: impl Into<String>,
    ) -> Result<OperationResult<SessionRecord>, ApplicationError> {
        let operation_id = OperationId::new(operation_id);
        let request = SessionRegistrationRequest {
            project_id: project_id.clone(),
            session_id: SessionId::new(session_id),
            actor_id: ActorId::new(actor_id),
            harness_id: HarnessId::new(harness_id),
            request_digest: canonical_request_digest(
                "session.register/v1",
                json!({
                    "project_id": project_id.as_str(),
                    "session_id": session_id,
                    "actor_id": actor_id,
                    "harness_id": harness_id,
                    "expected_project_revision": Value::Null,
                }),
            ),
            operation_id,
            expected_project_revision: None,
            started_at: parse_stamp(started_at)?,
        };
        self.register_session(&request)
    }

    pub fn session(
        &self,
        project_id: &ProjectId,
        session_id: &SessionId,
    ) -> Result<Option<SessionRecord>, ApplicationError> {
        Ok(self
            .store_ref()
            .session(project_id.as_str(), session_id.as_str())?)
    }

    pub fn session_for_claim(
        &self,
        project_id: &ProjectId,
        session_id: &SessionId,
        actor_id: &ActorId,
        harness_id: &HarnessId,
    ) -> Result<SessionRecord, ApplicationError> {
        Ok(self.store_ref().session_for_claim(
            project_id.as_str(),
            session_id.as_str(),
            actor_id.as_str(),
            harness_id.as_str(),
        )?)
    }

    /// End a durable session after the caller has explicitly made sure it has
    /// no live work. The store repeats that check in the same transaction so a
    /// read-then-write race cannot abandon a current fenced attempt.
    pub fn end_session_as(
        &self,
        project_id: &ProjectId,
        session_id: &str,
        actor_id: &str,
        expected_project_revision: Option<u64>,
        ended_at: &str,
        operation_id: impl Into<String>,
    ) -> Result<OperationResult<SessionRecord>, ApplicationError> {
        let operation_id = operation_id.into();
        let request_digest = canonical_request_digest(
            "session.end/v1",
            json!({
                "project_id": project_id.as_str(),
                "session_id": session_id,
                "actor_id": actor_id,
                "expected_project_revision": expected_project_revision,
            }),
        );
        let result = self.store_ref().end_session(
            project_id.as_str(),
            session_id,
            actor_id,
            &operation_id,
            &request_digest,
            expected_project_revision,
            ended_at,
        )?;
        Ok(OperationResult {
            operation_id,
            snapshot_revision: result.revision,
            changed: !result.replayed,
            value: result.session,
        })
    }
}

fn stamp(value: TimestampMs) -> String {
    format!("unix-ms:{}", value.as_millis())
}

fn parse_stamp(value: &str) -> Result<TimestampMs, ApplicationError> {
    let value = value.strip_prefix("unix-ms:").ok_or_else(|| {
        ApplicationError::Invalid(format!("unsupported session timestamp format: {value}"))
    })?;
    value.parse::<u64>().map(TimestampMs).map_err(|_| {
        ApplicationError::Invalid(
            "session timestamp must contain an unsigned millisecond value".to_owned(),
        )
    })
}
