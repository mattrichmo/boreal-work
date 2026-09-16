//! Authoritative v2 use cases and adapter-facing read models.
//!
//! CLI, service, and TUI code call this layer. They do not open SQLite or
//! apply lifecycle transitions themselves.

mod runtime;
mod status;

mod evidence;
mod evidence_store;
mod guidance;
mod operation_identity;
mod session;
mod sqlite_adapter;
mod workflow_assets;

use boreal_domain::{validate_parent, ProjectId, WorkItem};
use boreal_store::{ClaimResult, SqliteStore, StoreError, WorkPage, WorkRecord};
pub use evidence::*;
pub use guidance::{
    guide, guide_checked, Directive, DirectiveSeverity, DirectiveValidationError, GuidanceContext,
};
pub use operation_identity::{canonical_request_digest, sha256_content_digest};
use serde_json::json;
pub use session::{
    SessionRegistrationRequest, SessionRegistrationResult, StoreSessionRegistrationRequest,
};
pub use sqlite_adapter::SqliteAttemptAdapter;
pub use status::*;
use std::fmt;
pub use workflow_assets::{WorkflowAsset, WorkflowAssetError, WorkflowRegistry};

pub use runtime::{
    AcceptAttemptRequest, AttemptAdapterError, AttemptCommand, AttemptCommandKind,
    AttemptLifecycleAdapter, AttemptMutation, AttemptPolicy, AttemptPolicyError, AttemptRequest,
    AttemptSnapshot, CancelAttemptRequest, EndAttemptRequest, ExpireAttemptRequest,
    HeartbeatAttemptRequest, LivenessMetadata, RenewLeaseAttemptRequest, StopConfirmation,
};

pub const API_VERSION: &str = "v2";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OperationResult<T> {
    pub operation_id: String,
    pub snapshot_revision: u64,
    pub changed: bool,
    pub value: T,
}

#[derive(Debug)]
pub enum ApplicationError {
    Store(StoreError),
    AttemptAdapter(AttemptAdapterError),
    AttemptPolicy(AttemptPolicyError),
    Evidence(EvidenceValidationError),
    Invalid(String),
}

impl fmt::Display for ApplicationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Store(error) => error.fmt(formatter),
            Self::AttemptAdapter(error) => error.fmt(formatter),
            Self::AttemptPolicy(error) => error.fmt(formatter),
            Self::Evidence(error) => error.fmt(formatter),
            Self::Invalid(message) => formatter.write_str(message),
        }
    }
}

impl std::error::Error for ApplicationError {}

impl From<StoreError> for ApplicationError {
    fn from(error: StoreError) -> Self {
        Self::Store(error)
    }
}

impl From<AttemptAdapterError> for ApplicationError {
    fn from(error: AttemptAdapterError) -> Self {
        Self::AttemptAdapter(error)
    }
}

impl From<AttemptPolicyError> for ApplicationError {
    fn from(error: AttemptPolicyError) -> Self {
        Self::AttemptPolicy(error)
    }
}

pub struct WorkApplication<'a> {
    store: &'a SqliteStore,
}

impl WorkApplication<'_> {
    pub(crate) fn store_ref(&self) -> &SqliteStore {
        self.store
    }
}

impl<'a> WorkApplication<'a> {
    pub fn new(store: &'a SqliteStore) -> Self {
        Self { store }
    }

    /// Build a bounded declared-gate receipt without executing or persisting
    /// anything. Process adapters use this seam after they have returned
    /// bounded result data.
    pub fn build_bounded_evidence_receipt(
        &self,
        request: &EvidenceRunRequest,
        execution: &BoundedExecutionResult,
    ) -> Result<EvidenceRunResult, ApplicationError> {
        build_bounded_evidence_receipt(request, execution).map_err(ApplicationError::from)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn init_project(
        &self,
        project_id: &ProjectId,
        actor_id: &str,
        actor_role: &str,
        credential_ref: &str,
        display_name: &str,
        now: &str,
        operation_id: impl Into<String>,
    ) -> Result<OperationResult<()>, ApplicationError> {
        let operation_id = operation_id.into();
        let request_digest = canonical_request_digest(
            "project.init/v1",
            json!({
                "project_id": project_id.as_str(),
                "actor_id": actor_id,
                "actor_role": actor_role,
                "credential_ref": credential_ref,
                "display_name": display_name,
            }),
        );
        let mutation = self.store.initialize_project(
            project_id.as_str(),
            actor_id,
            actor_role,
            credential_ref,
            display_name,
            &operation_id,
            &request_digest,
            now,
        )?;
        Ok(OperationResult {
            operation_id,
            snapshot_revision: mutation.revision,
            changed: !mutation.replayed,
            value: (),
        })
    }

    pub fn create_work(
        &self,
        work: &WorkItem,
        now: &str,
        operation_id: impl Into<String>,
    ) -> Result<OperationResult<WorkRecord>, ApplicationError> {
        self.create_work_as(work, "agent-1", now, operation_id)
    }

    pub fn create_work_as(
        &self,
        work: &WorkItem,
        actor_id: &str,
        now: &str,
        operation_id: impl Into<String>,
    ) -> Result<OperationResult<WorkRecord>, ApplicationError> {
        if work.project_id.as_str().is_empty() || work.title.trim().is_empty() {
            return Err(ApplicationError::Invalid(
                "project and title are required".to_owned(),
            ));
        }
        if work.parent_id.is_none()
            && !matches!(
                work.kind,
                boreal_domain::WorkKind::Milestone | boreal_domain::WorkKind::Task
            )
        {
            return Err(ApplicationError::Invalid(
                "sprints require a parent; root work must be a milestone or task".to_owned(),
            ));
        }
        let operation_id = operation_id.into();
        let request_digest = canonical_request_digest(
            "work.create/v1",
            json!({
                "project_id": work.project_id.as_str(),
                "work_id": work.id.as_str(),
                "actor_id": actor_id,
                "kind": format!("{:?}", work.kind).to_ascii_lowercase(),
                "parent_id": work.parent_id.as_ref().map(|id| id.as_str()),
                "title": work.title,
                "description": work.description,
                "lifecycle": format!("{:?}", work.lifecycle).to_ascii_lowercase(),
                "priority": work.priority,
                "dispatch_policy": format!("{:?}", work.dispatch_policy).to_ascii_lowercase(),
                "hard_holds": work.hard_holds.iter().map(|hold| hold.stable_code()).collect::<Vec<_>>(),
                "acceptance_profile": {
                    "id": work.acceptance_profile.id.as_str(),
                    "version": work.acceptance_profile.version,
                    "gates": work.acceptance_profile.gates.iter().map(|gate| json!({
                        "id": gate.id.as_str(),
                        "kind": format!("{:?}", gate.kind).to_ascii_lowercase(),
                        "required": gate.required,
                        "state": format!("{:?}", gate.state).to_ascii_lowercase(),
                    })).collect::<Vec<_>>(),
                },
            }),
        );
        let mutation = self.store.create_work_operation(
            work,
            actor_id,
            &operation_id,
            &request_digest,
            now,
        )?;
        let value = self
            .store
            .work(work.project_id.as_str(), work.id.as_str())?
            .ok_or_else(|| ApplicationError::Invalid("created work was not readable".to_owned()))?;
        Ok(OperationResult {
            operation_id,
            snapshot_revision: mutation.revision,
            changed: !mutation.replayed,
            value,
        })
    }

    pub fn list_work(
        &self,
        project_id: &ProjectId,
        limit: u64,
        offset: u64,
    ) -> Result<WorkPage, ApplicationError> {
        Ok(self.store.list_work(project_id.as_str(), limit, offset)?)
    }

    pub fn show_work(
        &self,
        project_id: &ProjectId,
        work_id: &str,
    ) -> Result<WorkRecord, ApplicationError> {
        self.store
            .work(project_id.as_str(), work_id)?
            .ok_or_else(|| {
                ApplicationError::Store(StoreError::NotFound {
                    entity: "work",
                    id: work_id.to_owned(),
                })
            })
    }

    pub fn add_dependency(
        &self,
        project_id: &ProjectId,
        prerequisite_id: &str,
        dependent_id: &str,
        now: &str,
        operation_id: impl Into<String>,
    ) -> Result<OperationResult<()>, ApplicationError> {
        self.add_dependency_as(
            project_id,
            prerequisite_id,
            dependent_id,
            "agent-1",
            now,
            operation_id,
        )
    }

    pub fn add_dependency_as(
        &self,
        project_id: &ProjectId,
        prerequisite_id: &str,
        dependent_id: &str,
        actor_id: &str,
        now: &str,
        operation_id: impl Into<String>,
    ) -> Result<OperationResult<()>, ApplicationError> {
        if prerequisite_id == dependent_id {
            return Err(ApplicationError::Invalid(
                "a work item cannot depend on itself".to_owned(),
            ));
        }
        let operation_id = operation_id.into();
        let request_digest = canonical_request_digest(
            "dependency.add/v1",
            json!({
                "project_id": project_id.as_str(),
                "prerequisite_id": prerequisite_id,
                "dependent_id": dependent_id,
                "actor_id": actor_id,
            }),
        );
        let mutation = self.store.add_dependency_operation(
            project_id.as_str(),
            prerequisite_id,
            dependent_id,
            actor_id,
            &operation_id,
            &request_digest,
            now,
        )?;
        Ok(OperationResult {
            operation_id,
            snapshot_revision: mutation.revision,
            changed: !mutation.replayed,
            value: (),
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub fn claim(
        &self,
        project_id: &ProjectId,
        work_id: &str,
        actor_id: &str,
        harness_id: &str,
        session_id: Option<&str>,
        attempt_id: &str,
        operation_id: &str,
        request_digest: &str,
        expected_revision: Option<u64>,
        claimed_at: &str,
        lease_deadline: &str,
        max_attempt_deadline: &str,
    ) -> Result<OperationResult<ClaimResult>, ApplicationError> {
        self.claim_with_context(
            project_id,
            work_id,
            actor_id,
            harness_id,
            session_id,
            attempt_id,
            operation_id,
            request_digest,
            expected_revision,
            claimed_at,
            lease_deadline,
            max_attempt_deadline,
            None,
            "unknown",
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn claim_with_context(
        &self,
        project_id: &ProjectId,
        work_id: &str,
        actor_id: &str,
        harness_id: &str,
        session_id: Option<&str>,
        attempt_id: &str,
        operation_id: &str,
        request_digest: &str,
        expected_revision: Option<u64>,
        claimed_at: &str,
        lease_deadline: &str,
        max_attempt_deadline: &str,
        source_version_id: Option<&str>,
        config_identity: &str,
    ) -> Result<OperationResult<ClaimResult>, ApplicationError> {
        let value = self.store.claim_work_with_context(
            project_id.as_str(),
            work_id,
            actor_id,
            harness_id,
            session_id,
            attempt_id,
            operation_id,
            request_digest,
            expected_revision,
            claimed_at,
            lease_deadline,
            max_attempt_deadline,
            source_version_id,
            config_identity,
        )?;
        Ok(OperationResult {
            operation_id: operation_id.to_owned(),
            snapshot_revision: value.revision,
            changed: !value.replayed,
            value,
        })
    }

    pub fn validate_parent(
        &self,
        child: &WorkItem,
        parent: Option<&WorkItem>,
    ) -> Result<(), ApplicationError> {
        validate_parent(child, parent).map_err(|error| ApplicationError::Invalid(error.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use boreal_domain::{AcceptanceProfile, DispatchPolicy, PersistedLifecycle, WorkKind};
    const SCHEMA: &str = include_str!("../../../project/spec/schema-v2.sql");

    #[test]
    fn application_routes_init_create_list_and_claim() {
        let store = SqliteStore::open_in_memory(SCHEMA).unwrap();
        let app = WorkApplication::new(&store);
        let project = ProjectId::new("p1");
        app.init_project(
            &project, "agent-1", "agent", "cred", "Agent", "t0", "op-init",
        )
        .unwrap();
        let work = WorkItem {
            id: boreal_domain::WorkId::new("w1"),
            project_id: project.clone(),
            kind: WorkKind::Task,
            parent_id: None,
            title: "M1".into(),
            description: String::new(),
            lifecycle: PersistedLifecycle::Open,
            priority: 0,
            dispatch_policy: DispatchPolicy::Automatic,
            hard_holds: Vec::new(),
            acceptance_profile: AcceptanceProfile::focused(),
        };
        let created = app.create_work(&work, "t0", "op-work").unwrap();
        assert_eq!(created.value.work_id, "w1");
        assert_eq!(app.list_work(&project, 1, 0).unwrap().total, 1);
        let claim = app
            .claim(
                &project,
                "w1",
                "agent-1",
                "luna",
                None,
                "a1",
                "op-claim",
                "sha256:req",
                Some(2),
                "2026-01-01T00:00:00Z",
                "2026-01-01T00:30:00Z",
                "2026-01-01T02:00:00Z",
            )
            .unwrap();
        assert_eq!(claim.value.fence, 1);
        assert!(claim.changed);
    }
}
