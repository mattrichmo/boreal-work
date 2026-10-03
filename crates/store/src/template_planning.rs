//! Atomic canonical work creation for one versioned template application.
use super::*;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkBatchCreateRequest {
    pub project_id: String,
    pub actor_id: String,
    pub session_id: String,
    pub expected_project_revision: u64,
    pub operation_id: String,
    pub request_digest: String,
    pub works: Vec<WorkItem>,
    /// `(prerequisite, dependent)` IDs. Every endpoint must belong to `works`.
    pub dependencies: Vec<(String, String)>,
    /// Canonical normalized labels keyed by generated work ID.
    pub labels: BTreeMap<String, Vec<String>>,
    pub created_at: String,
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkBatchCreateResult {
    pub works: Vec<WorkRecord>,
    pub revision: u64,
    pub replayed: bool,
}

impl SqliteStore {
    /// Creates every rendered template item under a single write transaction,
    /// one project revision, and one auditable operation. An invalid child,
    /// stale revision, authorization failure, or existing id rolls back the
    /// entire batch.
    pub fn create_work_batch(
        &self,
        request: &WorkBatchCreateRequest,
    ) -> Result<WorkBatchCreateResult, StoreError> {
        if request.works.is_empty()
            || request.works.len() > 100
            || request.actor_id.trim().is_empty()
            || request.session_id.trim().is_empty()
            || request.operation_id.trim().is_empty()
        {
            return Err(StoreError::Invalid(
                "template batch requires 1-100 work items, actor, session, and operation id".into(),
            ));
        }
        let mut ids = BTreeSet::new();
        for work in &request.works {
            if work.project_id.as_str() != request.project_id || !ids.insert(work.id.as_str()) {
                return Err(StoreError::Invalid(
                    "template batch work ids must be unique and project-scoped".into(),
                ));
            }
        }
        self.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| {
            if self.canonical_production {
                let (role, _) = self.principal_authority(&request.project_id, &request.actor_id)?;
                if !boreal_domain::work_model_v3::planning_role_allowed(role) {
                    return Err(StoreError::Invalid(
                        "template instantiation requires planning authority".into(),
                    ));
                }
                self.validate_project_session(
                    &request.project_id,
                    &request.actor_id,
                    &request.session_id,
                )?;
            }
            if let Some(existing) = self.preflight_operation_replay(
                &request.project_id,
                &request.operation_id,
                "template.instantiate",
                &request.actor_id,
                Some(&request.session_id),
                Some(request.expected_project_revision),
                None,
                None,
                &request.request_digest,
                "template",
                &request.operation_id,
            )? {
                let readback: Value =
                    serde_json::from_str(&existing.result_json).map_err(|_| {
                        StoreError::Corrupt("template operation result is invalid".into())
                    })?;
                let ids = readback
                    .get("work_ids")
                    .and_then(Value::as_array)
                    .ok_or_else(|| {
                        StoreError::Corrupt(
                            "template operation readback has no work id list".into(),
                        )
                    })?;
                let mut works = Vec::with_capacity(ids.len());
                for id in ids {
                    let id = id.as_str().ok_or_else(|| {
                        StoreError::Corrupt("template operation work id is invalid".into())
                    })?;
                    works.push(self.work(&request.project_id, id)?.ok_or_else(|| {
                        StoreError::Corrupt(format!("template operation work {id} is missing"))
                    })?);
                }
                return Ok(WorkBatchCreateResult {
                    works,
                    revision: existing.revision,
                    replayed: true,
                });
            }
            check_expected_revision(
                self.project_revision(&request.project_id)?.0,
                Some(request.expected_project_revision),
            )?;
            self.validate_batch_payload(request)?;
            for work in &request.works {
                self.create_work_in_transaction(work, &request.created_at)?;
            }
            for (prerequisite, dependent) in &request.dependencies {
                self.add_dependency_in_transaction(
                    &request.project_id,
                    prerequisite,
                    dependent,
                    &request.created_at,
                )?;
            }
            for (work_id, labels) in &request.labels {
                for label in labels {
                    let mut insert = self.prepare(
                        "INSERT INTO work_label_v1(project_id,work_id,label) VALUES(?1,?2,?3)",
                    )?;
                    insert.bind_text(1, &request.project_id)?;
                    insert.bind_text(2, work_id)?;
                    insert.bind_text(3, label)?;
                    insert.run()?;
                }
            }
            let revision = self.bump_revision_in_transaction(&request.project_id)?;
            let work_ids = request
                .works
                .iter()
                .map(|work| work.id.as_str())
                .collect::<Vec<_>>();
            let result_json = serde_json::to_string(&json!({"work_ids": work_ids,"dependencies":request.dependencies,"labels":request.labels,"acceptance_profiles":request.works.iter().map(|w|json!({"work_id":w.id.as_str(),"profile":w.acceptance_profile.id.as_str(),"version":w.acceptance_profile.version})).collect::<Vec<_>>()}))
                .map_err(|e| StoreError::Invalid(e.to_string()))?;
            self.append_operation_audit_in_transaction(
                OperationRecord {
                    operation_id: request.operation_id.clone(),
                    project_id: request.project_id.clone(),
                    command: "template.instantiate".into(),
                    actor_id: request.actor_id.clone(),
                    session_id: Some(request.session_id.clone()),
                    expected_revision: Some(request.expected_project_revision),
                    attempt_id: None,
                    fence: None,
                    request_digest: request.request_digest.clone(),
                    outcome: OperationOutcome::Changed,
                    result_json: result_json.clone(),
                    revision: revision.0,
                    created_at: request.created_at.clone(),
                    completed_at: Some(request.created_at.clone()),
                },
                AuditEventRecord {
                    project_id: request.project_id.clone(),
                    revision: revision.0,
                    operation_id: request.operation_id.clone(),
                    event_type: "work.created".into(),
                    subject_type: "work".into(),
                    subject_id: request
                        .works
                        .first()
                        .expect("nonempty batch")
                        .id
                        .as_str()
                        .to_owned(),
                    actor_id: request.actor_id.clone(),
                    session_id: Some(request.session_id.clone()),
                    fence: None,
                    as_of: request.created_at.clone(),
                    payload_json: result_json.clone(),
                },
            )?;
            let mut works = Vec::with_capacity(request.works.len());
            for work in &request.works {
                works.push(
                    self.work(&request.project_id, work.id.as_str())?
                        .ok_or_else(|| {
                            StoreError::Corrupt("created template work disappeared".into())
                        })?,
                );
            }
            Ok(WorkBatchCreateResult {
                works,
                revision: revision.0,
                replayed: false,
            })
        })();
        finish_transaction(self, result)
    }

    fn validate_batch_payload(&self, request: &WorkBatchCreateRequest) -> Result<(), StoreError> {
        let mut by_id = BTreeMap::new();
        for (index, work) in request.works.iter().enumerate() {
            if work.title.trim().is_empty()
                || work.project_id.as_str() != request.project_id
                || work.lifecycle.is_terminal()
            {
                return Err(StoreError::Invalid(
                    "template work items must be titled, project-scoped, and non-terminal".into(),
                ));
            }
            if by_id.insert(work.id.as_str(), index).is_some() {
                return Err(StoreError::Invalid(
                    "template batch work IDs must be unique".into(),
                ));
            }
        }
        for (index, work) in request.works.iter().enumerate() {
            if let Some(parent) = &work.parent_id {
                let parent_index = by_id.get(parent.as_str()).ok_or_else(|| {
                    StoreError::Invalid(format!(
                        "template parent {} is outside the batch",
                        parent.as_str()
                    ))
                })?;
                if *parent_index >= index {
                    return Err(StoreError::Invalid(
                        "template work batch must order each parent before its child".into(),
                    ));
                }
            }
        }
        let mut edge_keys = BTreeSet::new();
        let edges = request
            .dependencies
            .iter()
            .map(|(before, after)| {
                if !by_id.contains_key(before.as_str())
                    || !by_id.contains_key(after.as_str())
                    || !edge_keys.insert((before.as_str(), after.as_str()))
                {
                    return Err(StoreError::Invalid(
                        "template dependencies must be unique and reference batch work".into(),
                    ));
                }
                Ok(boreal_domain::DependencyEdge::close_only(
                    boreal_domain::WorkId::new(before.clone()),
                    boreal_domain::WorkId::new(after.clone()),
                ))
            })
            .collect::<Result<Vec<_>, StoreError>>()?;
        boreal_domain::validate_dependency_edges(&request.works, &edges)
            .map_err(|e| StoreError::Invalid(format!("invalid template dependency graph: {e}")))?;
        for (work_id, labels) in &request.labels {
            if !by_id.contains_key(work_id.as_str()) || labels.len() > 64 {
                return Err(StoreError::Invalid(
                    "template labels must target batch work and contain at most 64 values".into(),
                ));
            }
            let mut seen = BTreeSet::new();
            if labels.iter().any(|label| {
                label.is_empty()
                    || label.len() > 64
                    || !label.bytes().all(|b| {
                        b.is_ascii_lowercase()
                            || b.is_ascii_digit()
                            || matches!(b, b'-' | b'_' | b'.' | b'/')
                    })
                    || !seen.insert(label.as_str())
            }) {
                return Err(StoreError::Invalid("template labels must be unique normalized tokens of 1..64 lowercase ASCII characters".into()));
            }
        }
        let mut profile_definitions = BTreeMap::new();
        for work in &request.works {
            let expected_profile = match work.acceptance_profile.id.as_str() {
                "focused" => boreal_domain::AcceptanceProfile::focused(),
                "reviewed" => boreal_domain::AcceptanceProfile::reviewed(),
                other => {
                    return Err(StoreError::Invalid(format!(
                        "template acceptance profile '{other}' is unsupported"
                    )));
                }
            };
            if work.acceptance_profile != expected_profile {
                return Err(StoreError::Invalid(format!(
                    "template acceptance profile '{}' does not match its canonical definition",
                    work.acceptance_profile.id.as_str()
                )));
            }
            let profile =
                super::profile_version_for_work(&work.acceptance_profile, &request.created_at)?;
            let key = (profile.profile_id.clone(), profile.version);
            if let Some(previous) = profile_definitions.insert(
                key.clone(),
                (
                    profile.policy_digest.clone(),
                    profile.definition_json.clone(),
                ),
            ) {
                if previous
                    != (
                        profile.policy_digest.clone(),
                        profile.definition_json.clone(),
                    )
                {
                    return Err(StoreError::Conflict("template batch contains conflicting definitions for one acceptance profile version".into()));
                }
            }
            let mut existing=self.prepare("SELECT policy_digest,definition_json FROM acceptance_profile WHERE profile_id=?1 AND version=?2")?;
            existing.bind_text(1, &profile.profile_id)?;
            existing.bind_i64(2, profile.version)?;
            if existing.step()? == SQLITE_ROW
                && (existing.column_text(0)? != profile.policy_digest
                    || existing.column_text(1)? != profile.definition_json)
            {
                return Err(StoreError::Conflict(format!(
                    "acceptance profile {} v{} conflicts with its registered immutable definition",
                    profile.profile_id, profile.version
                )));
            }
        }
        Ok(())
    }
}
