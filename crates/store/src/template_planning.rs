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
    pub template_id: String,
    pub template_version: u64,
    pub id_prefix: String,
    pub works: Vec<WorkItem>,
    pub planning_contracts: Vec<WorkPlanningContractWrite>,
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

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TemplatePrefixAmendRequest {
    pub project_id: String,
    pub actor_id: String,
    pub session_id: String,
    pub expected_project_revision: u64,
    pub expected_template_version: u64,
    pub operation_id: String,
    pub request_digest: String,
    pub template_id: String,
    pub template_version: u64,
    pub id_prefix: String,
    /// The complete desired template prefix after the amendment. Existing
    /// item keys are retained; new keys are added; removals are not supported.
    pub works: Vec<WorkItem>,
    pub planning_contracts: Vec<WorkPlanningContractWrite>,
    pub dependencies: Vec<(String, String)>,
    pub labels: BTreeMap<String, Vec<String>>,
    pub created_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TemplatePrefixAmendResult {
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
        self.ensure_deliverables_schema()?;
        if request.works.is_empty()
            || request.works.len() > 100
            || request.actor_id.trim().is_empty()
            || request.session_id.trim().is_empty()
            || request.operation_id.trim().is_empty()
            || request.template_id.trim().is_empty()
            || request.template_version == 0
            || !valid_template_prefix(&request.id_prefix)
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
        if request.planning_contracts.len() != request.works.len() {
            return Err(StoreError::Invalid(
                "template batch requires one planning-contract snapshot per work item".into(),
            ));
        }
        let mut contract_work_ids = BTreeSet::new();
        for contract in &request.planning_contracts {
            if !ids.contains(contract.work_id.as_str())
                || !contract_work_ids.insert(contract.work_id.as_str())
            {
                return Err(StoreError::Invalid(
                    "template planning contracts must target each batch item exactly once".into(),
                ));
            }
            self.validate_planning_contract_json(
                &request.project_id,
                &contract.requirements_json,
                &contract.inputs_json,
            )?;
        }
        let prefix_start = format!("{}-", request.id_prefix);
        if request.works.iter().any(|work| {
            work.id
                .as_str()
                .strip_prefix(&prefix_start)
                .is_none_or(|key| !valid_template_key(key))
        }) {
            return Err(StoreError::Invalid(
                "template batch work ids must be the prefix followed by a stable item key".into(),
            ));
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
            if self
                .work_template_prefix(&request.project_id, &request.id_prefix)?
                .is_some()
            {
                return Err(StoreError::Conflict(format!(
                    "template prefix {} already exists; use an explicit prefix amendment",
                    request.id_prefix
                )));
            }
            self.validate_batch_payload(request)?;
            for work in &request.works {
                self.create_work_in_transaction(work, &request.created_at)?;
            }
            for contract in &request.planning_contracts {
                self.insert_planning_contract_in_transaction(
                    &request.project_id,
                    contract,
                    Some(&request.template_id),
                    Some(request.template_version),
                    &request.actor_id,
                    &request.session_id,
                    &request.operation_id,
                    &request.created_at,
                )?;
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
            let prefix_items = request
                .works
                .iter()
                .map(|work| TemplatePrefixItemWrite {
                    item_key: work
                        .id
                        .as_str()
                        .strip_prefix(&prefix_start)
                        .expect("validated template prefix")
                        .to_owned(),
                    work_id: work.id.as_str().to_owned(),
                })
                .collect::<Vec<_>>();
            self.insert_template_prefix_in_transaction(
                &request.project_id,
                &request.id_prefix,
                &request.template_id,
                request.template_version,
                revision.0,
                &request.operation_id,
                &request.actor_id,
                &request.session_id,
                &prefix_items,
                &request.created_at,
            )?;
            let work_ids = request
                .works
                .iter()
                .map(|work| work.id.as_str())
                .collect::<Vec<_>>();
            let result_json = serde_json::to_string(&json!({"work_ids": work_ids,"dependencies":request.dependencies,"labels":request.labels,"template_id":request.template_id,"template_version":request.template_version,"id_prefix":request.id_prefix,"acceptance_profiles":request.works.iter().map(|w|json!({"work_id":w.id.as_str(),"profile":w.acceptance_profile.id.as_str(),"version":w.acceptance_profile.version})).collect::<Vec<_>>()}))
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

    /// Apply an explicit newer template version to an existing generated
    /// prefix. The prefix and project revisions are checked under one write
    /// transaction. Existing rows must still match their prefix ledger and be
    /// draft work with no attempt history; an amendment can add or revise rows
    /// but cannot remove keys or change identity, kind, parent, or acceptance.
    pub fn amend_template_prefix(
        &self,
        request: &TemplatePrefixAmendRequest,
    ) -> Result<TemplatePrefixAmendResult, StoreError> {
        self.ensure_deliverables_schema()?;
        if request.works.is_empty()
            || request.works.len() > 100
            || request.actor_id.trim().is_empty()
            || request.session_id.trim().is_empty()
            || request.operation_id.trim().is_empty()
            || request.template_id.trim().is_empty()
            || request.expected_template_version == 0
            || request.template_version <= request.expected_template_version
            || !valid_template_prefix(&request.id_prefix)
        {
            return Err(StoreError::Invalid(
                "template amendment requires a newer version, a prefix, actor, session, operation id, and 1-100 items".into(),
            ));
        }
        let mut ids = BTreeSet::new();
        for work in &request.works {
            if work.project_id.as_str() != request.project_id || !ids.insert(work.id.as_str()) {
                return Err(StoreError::Invalid(
                    "template amendment work ids must be unique and project-scoped".into(),
                ));
            }
        }
        let prefix_start = format!("{}-", request.id_prefix);
        let mut keys = BTreeSet::new();
        if request.works.iter().any(|work| {
            work.id
                .as_str()
                .strip_prefix(&prefix_start)
                .is_none_or(|key| !valid_template_key(key) || !keys.insert(key.to_owned()))
        }) {
            return Err(StoreError::Invalid(
                "template amendment work ids must use unique stable prefix item keys".into(),
            ));
        }
        if request.planning_contracts.len() != request.works.len() {
            return Err(StoreError::Invalid(
                "template amendment requires one planning contract per item".into(),
            ));
        }
        let mut contract_ids = BTreeSet::new();
        for contract in &request.planning_contracts {
            if !ids.contains(contract.work_id.as_str())
                || !contract_ids.insert(contract.work_id.as_str())
            {
                return Err(StoreError::Invalid(
                    "template amendment contracts must target every item exactly once".into(),
                ));
            }
            self.validate_planning_contract_json(
                &request.project_id,
                &contract.requirements_json,
                &contract.inputs_json,
            )?;
        }
        self.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| {
            if self.canonical_production {
                let (role, _) = self.principal_authority(&request.project_id, &request.actor_id)?;
                if !boreal_domain::work_model_v3::planning_role_allowed(role) {
                    return Err(StoreError::Invalid(
                        "template amendment requires planning authority".into(),
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
                "template.prefix.amend",
                &request.actor_id,
                Some(&request.session_id),
                Some(request.expected_project_revision),
                None,
                None,
                &request.request_digest,
                "work",
                request.works[0].id.as_str(),
            )? {
                let readback: Value =
                    serde_json::from_str(&existing.result_json).map_err(|_| {
                        StoreError::Corrupt("template amendment result is invalid".into())
                    })?;
                let ids = readback
                    .get("work_ids")
                    .and_then(Value::as_array)
                    .ok_or_else(|| {
                        StoreError::Corrupt("template amendment result has no work ids".into())
                    })?;
                let mut works = Vec::with_capacity(ids.len());
                for id in ids {
                    let id = id.as_str().ok_or_else(|| {
                        StoreError::Corrupt("template amendment work id is invalid".into())
                    })?;
                    works.push(self.work(&request.project_id, id)?.ok_or_else(|| {
                        StoreError::Corrupt(format!("template amendment work {id} is missing"))
                    })?);
                }
                return Ok(TemplatePrefixAmendResult {
                    works,
                    revision: existing.revision,
                    replayed: true,
                });
            }
            let actual_revision = self.project_revision(&request.project_id)?.0;
            check_expected_revision(actual_revision, Some(request.expected_project_revision))?;
            let prefix = self
                .work_template_prefix(&request.project_id, &request.id_prefix)?
                .ok_or_else(|| {
                    StoreError::Conflict(
                        "template prefix has no amendment ledger; reapply into a new prefix".into(),
                    )
                })?;
            if prefix.template_id != request.template_id
                || prefix.template_version != request.expected_template_version
            {
                return Err(StoreError::StaleRevision {
                    expected: request.expected_template_version,
                    actual: prefix.template_version,
                });
            }

            // The create validator also checks the complete parent/dependency
            // graphs, label normalization, canonical profiles, and ordering.
            self.validate_batch_payload(&WorkBatchCreateRequest {
                project_id: request.project_id.clone(),
                actor_id: request.actor_id.clone(),
                session_id: request.session_id.clone(),
                expected_project_revision: request.expected_project_revision,
                operation_id: request.operation_id.clone(),
                request_digest: request.request_digest.clone(),
                template_id: request.template_id.clone(),
                template_version: request.template_version,
                id_prefix: request.id_prefix.clone(),
                works: request.works.clone(),
                planning_contracts: request.planning_contracts.clone(),
                dependencies: request.dependencies.clone(),
                labels: request.labels.clone(),
                created_at: request.created_at.clone(),
            })?;

            let existing_items =
                self.work_template_prefix_items(&request.project_id, &request.id_prefix)?;
            if existing_items.is_empty() {
                return Err(StoreError::Corrupt(
                    "template prefix has no item ledger".into(),
                ));
            }
            let existing_by_key = existing_items
                .iter()
                .map(|item| (item.item_key.as_str(), item))
                .collect::<BTreeMap<_, _>>();
            if existing_items
                .iter()
                .any(|item| !keys.contains(&item.item_key))
            {
                return Err(StoreError::Conflict(
                    "template amendment cannot remove an existing item key".into(),
                ));
            }
            let mut additions = Vec::new();
            let mut updated = Vec::new();
            let mut dispatch_changed = false;
            for work in &request.works {
                let item_key = work
                    .id
                    .as_str()
                    .strip_prefix(&prefix_start)
                    .expect("validated prefix");
                if let Some(previous) = existing_by_key.get(item_key) {
                    if previous.work_id != work.id.as_str() {
                        return Err(StoreError::Conflict(format!(
                            "template item key {item_key} is already bound to another work id"
                        )));
                    }
                    let current = self
                        .work(&request.project_id, &previous.work_id)?
                        .ok_or_else(|| {
                            StoreError::Corrupt(format!(
                                "template work {} disappeared",
                                previous.work_id
                            ))
                        })?;
                    let current_state = self
                        .template_prefix_item_state_json(&request.project_id, &previous.work_id)?;
                    let previous_value: Value = serde_json::from_str(&previous.state_json)
                        .map_err(|_| {
                            StoreError::Corrupt("template item ledger is invalid JSON".into())
                        })?;
                    let current_value: Value =
                        serde_json::from_str(&current_state).map_err(|_| {
                            StoreError::Corrupt("template work state is invalid JSON".into())
                        })?;
                    if previous_value != current_value {
                        return Err(StoreError::Conflict(format!(
                            "template work {} changed outside its prefix ledger",
                            previous.work_id
                        )));
                    }
                    if current.lifecycle != "draft" {
                        return Err(StoreError::Conflict(format!(
                            "template work {} is no longer draft",
                            previous.work_id
                        )));
                    }
                    let mut attempts =
                        self.prepare("SELECT 1 FROM attempt WHERE work_id=?1 LIMIT 1")?;
                    attempts.bind_text(1, &previous.work_id)?;
                    if attempts.step()? == SQLITE_ROW {
                        return Err(StoreError::Conflict(format!(
                            "template work {} has attempt history",
                            previous.work_id
                        )));
                    }
                    let mut identity = self.prepare(
                        "SELECT acceptance_profile_id,acceptance_profile_version FROM work_item
                         WHERE project_id=?1 AND work_id=?2",
                    )?;
                    identity.bind_text(1, &request.project_id)?;
                    identity.bind_text(2, &previous.work_id)?;
                    if identity.step()? != SQLITE_ROW {
                        return Err(StoreError::Corrupt(
                            "template work identity disappeared".into(),
                        ));
                    }
                    let desired_profile_version =
                        super::profile_version(&work.acceptance_profile.version)?;
                    if current.kind != work_kind(work.kind)
                        || current.parent_id.as_deref()
                            != work.parent_id.as_ref().map(WorkId::as_str)
                        || identity.column_text(0)? != work.acceptance_profile.id.as_str()
                        || identity.column_u64(1)? != desired_profile_version
                    {
                        return Err(StoreError::Invalid(format!(
                            "template amendment cannot change identity, kind, parent, or acceptance profile for {}",
                            previous.work_id
                        )));
                    }
                    dispatch_changed |=
                        current.dispatch_policy != dispatch_policy(work.dispatch_policy);
                    updated.push(work);
                } else {
                    if self.work(&request.project_id, work.id.as_str())?.is_some() {
                        return Err(StoreError::Conflict(format!(
                            "template amendment work id {} already exists",
                            work.id.as_str()
                        )));
                    }
                    additions.push(work);
                }
            }
            if dispatch_changed && self.canonical_production {
                let (role, _) = self.principal_authority(&request.project_id, &request.actor_id)?;
                if role != boreal_domain::ActorRole::Operator {
                    return Err(StoreError::Invalid(
                        "only a project Operator may amend dispatch policy".into(),
                    ));
                }
            }

            for work in additions {
                self.create_work_in_transaction(work, &request.created_at)?;
            }
            for work in updated {
                let mut update = self.prepare(
                    "UPDATE work_item SET dispatch_policy=?3,priority=?4,title=?5,
                         description=?6,updated_at=?7
                     WHERE project_id=?1 AND work_id=?2 AND lifecycle='draft'",
                )?;
                update.bind_text(1, &request.project_id)?;
                update.bind_text(2, work.id.as_str())?;
                update.bind_text(3, dispatch_policy(work.dispatch_policy))?;
                update.bind_i64(4, u64::from(work.priority))?;
                update.bind_text(5, &work.title)?;
                update.bind_text(6, &work.description)?;
                update.bind_text(7, &request.created_at)?;
                update.run()?;
                if update.changes()? != 1 {
                    return Err(StoreError::Conflict(format!(
                        "template work {} changed while applying amendment",
                        work.id.as_str()
                    )));
                }
            }

            for item in &existing_items {
                let mut delete_dependencies =
                    self.prepare("DELETE FROM dependency WHERE project_id=?1 AND dependent_id=?2")?;
                delete_dependencies.bind_text(1, &request.project_id)?;
                delete_dependencies.bind_text(2, &item.work_id)?;
                delete_dependencies.run()?;
            }
            for (prerequisite, dependent) in &request.dependencies {
                self.add_dependency_in_transaction(
                    &request.project_id,
                    prerequisite,
                    dependent,
                    &request.created_at,
                )?;
            }
            for work in &request.works {
                let mut delete_labels =
                    self.prepare("DELETE FROM work_label_v1 WHERE project_id=?1 AND work_id=?2")?;
                delete_labels.bind_text(1, &request.project_id)?;
                delete_labels.bind_text(2, work.id.as_str())?;
                delete_labels.run()?;
                for label in request.labels.get(work.id.as_str()).into_iter().flatten() {
                    let mut insert = self.prepare(
                        "INSERT INTO work_label_v1(project_id,work_id,label) VALUES(?1,?2,?3)",
                    )?;
                    insert.bind_text(1, &request.project_id)?;
                    insert.bind_text(2, work.id.as_str())?;
                    insert.bind_text(3, label)?;
                    insert.run()?;
                }
            }
            for contract in &request.planning_contracts {
                self.append_planning_contract_in_transaction(
                    &request.project_id,
                    contract,
                    Some(&request.template_id),
                    Some(request.template_version),
                    &request.actor_id,
                    &request.session_id,
                    &request.operation_id,
                    &request.created_at,
                )?;
            }
            let revision = self.bump_revision_in_transaction(&request.project_id)?;
            self.update_template_prefix_head_in_transaction(
                &request.project_id,
                &request.id_prefix,
                &request.template_id,
                request.template_version,
                revision.0,
                &request.operation_id,
                &request.actor_id,
                &request.session_id,
                &request.created_at,
            )?;
            for work in &request.works {
                let item_key = work
                    .id
                    .as_str()
                    .strip_prefix(&prefix_start)
                    .expect("validated prefix");
                if existing_by_key.contains_key(item_key) {
                    self.update_template_prefix_item_state_in_transaction(
                        &request.project_id,
                        &request.id_prefix,
                        item_key,
                        work.id.as_str(),
                        &request.created_at,
                    )?;
                } else {
                    self.insert_template_prefix_item_in_transaction(
                        &request.project_id,
                        &request.id_prefix,
                        item_key,
                        work.id.as_str(),
                        &request.created_at,
                    )?;
                }
            }
            let work_ids = request
                .works
                .iter()
                .map(|work| work.id.as_str())
                .collect::<Vec<_>>();
            let result_json = serde_json::to_string(&json!({
                "work_ids": work_ids,
                "id_prefix": request.id_prefix,
                "template_id": request.template_id,
                "template_version": request.template_version,
                "expected_template_version": request.expected_template_version,
            }))
            .map_err(|error| StoreError::Invalid(error.to_string()))?;
            self.append_operation_audit_in_transaction(
                OperationRecord {
                    operation_id: request.operation_id.clone(),
                    project_id: request.project_id.clone(),
                    command: "template.prefix.amend".into(),
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
                    // The current canonical audit vocabulary has no planning
                    // amendment event. Use its existing correction event and
                    // carry the exact template transition in the payload.
                    event_type: "repair.correction".into(),
                    subject_type: "work".into(),
                    subject_id: request.works[0].id.as_str().to_owned(),
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
                            StoreError::Corrupt("amended template work disappeared".into())
                        })?,
                );
            }
            Ok(TemplatePrefixAmendResult {
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
            let expected_profile = canonical_template_acceptance_profile(&work.acceptance_profile)?;
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

fn canonical_template_acceptance_profile(
    profile: &boreal_domain::AcceptanceProfile,
) -> Result<boreal_domain::AcceptanceProfile, StoreError> {
    match profile.id.as_str() {
        "focused" => Ok(boreal_domain::AcceptanceProfile::focused()),
        "reviewed" => Ok(boreal_domain::AcceptanceProfile::reviewed()),
        profile_id => {
            let version = super::profile_version(&profile.version)?;
            let registered = super::profiles::registered_acceptance_profile(profile_id, version)?
                .ok_or_else(|| {
                StoreError::Invalid(format!(
                    "template acceptance profile '{profile_id}/{version}' is unsupported"
                ))
            })?;
            let mut gates = vec![boreal_domain::GateRequirement::required(
                boreal_domain::GateId::new(registered.summary_gate_id),
                boreal_domain::GateKind::Summary,
            )];
            if let Some(review_gate_id) = registered.review_gate_id {
                gates.push(boreal_domain::GateRequirement::required(
                    boreal_domain::GateId::new(review_gate_id),
                    boreal_domain::GateKind::Review,
                ));
            }
            Ok(boreal_domain::AcceptanceProfile {
                id: boreal_domain::ProfileId::new(registered.profile_id),
                version: registered.version.to_string(),
                gates,
            })
        }
    }
}

fn valid_template_prefix(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 48
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'-' | b'_')
        })
}

fn valid_template_key(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 48
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'-' | b'_')
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::SessionRegistrationRequest;
    use boreal_domain::{
        AcceptanceProfile, GateId, GateKind, GateRequirement, ProfileId, ProjectId, WorkId,
        WorkKind,
    };

    const SCHEMA: &str = include_str!("../../../project/spec/schema-v2.sql");

    fn gate(id: &str, kind: GateKind) -> GateRequirement {
        GateRequirement::required(GateId::new(id), kind)
    }

    fn profile(id: &str, version: &str, gates: Vec<GateRequirement>) -> AcceptanceProfile {
        AcceptanceProfile {
            id: ProfileId::new(id),
            version: version.to_owned(),
            gates,
        }
    }

    fn batch_request(
        project_id: &str,
        profile: AcceptanceProfile,
        operation_id: &str,
        expected_project_revision: u64,
    ) -> WorkBatchCreateRequest {
        let work_id = "profile-item";
        let mut work = boreal_domain::WorkItem::new(
            ProjectId::new(project_id),
            WorkId::new(format!("batch-{work_id}")),
            WorkKind::Task,
            None,
            "Profile fixture",
        );
        work.acceptance_profile = profile;
        WorkBatchCreateRequest {
            project_id: project_id.to_owned(),
            actor_id: "planner".to_owned(),
            session_id: "planner-session".to_owned(),
            expected_project_revision,
            operation_id: operation_id.to_owned(),
            request_digest: format!("digest-{operation_id}"),
            template_id: "profile-fixture".to_owned(),
            template_version: 1,
            id_prefix: "batch".to_owned(),
            works: vec![work],
            planning_contracts: vec![WorkPlanningContractWrite {
                work_id: format!("batch-{work_id}"),
                requirements_json: "[]".to_owned(),
                inputs_json: "[]".to_owned(),
            }],
            dependencies: Vec::new(),
            labels: BTreeMap::new(),
            created_at: "unix-ms:1".to_owned(),
        }
    }

    fn store_with_project(project_id: &str) -> SqliteStore {
        let store = SqliteStore::open_in_memory(SCHEMA).unwrap();
        store
            .install_feature_schema("agent_tools", 1, super::super::AGENT_TOOLS_SCHEMA)
            .unwrap();
        store
            .initialize_project(
                project_id,
                "planner",
                "operator",
                "planner-credential",
                "Planner",
                "operation-init",
                "digest-init",
                "unix-ms:1",
            )
            .unwrap();
        let revision = store.project_revision(project_id).unwrap().0;
        store
            .register_session(SessionRegistrationRequest {
                project_id: project_id.to_owned(),
                session_id: "planner-session".to_owned(),
                actor_id: "planner".to_owned(),
                harness_id: "test-harness".to_owned(),
                operation_id: "operation-session".to_owned(),
                request_digest: "digest-session".to_owned(),
                expected_project_revision: Some(revision),
                started_at: "unix-ms:2".to_owned(),
            })
            .unwrap();
        store
    }

    fn stored_gates(
        store: &SqliteStore,
        work_id: &str,
    ) -> Vec<(String, String, u64, String, bool)> {
        let mut statement = store
            .prepare(
                "SELECT gate_id,profile_id,profile_version,kind,required
                 FROM gate WHERE work_id=?1 ORDER BY gate_id",
            )
            .unwrap();
        statement.bind_text(1, work_id).unwrap();
        let mut gates = Vec::new();
        while statement.step().unwrap() == SQLITE_ROW {
            let gate_id = statement.column_text(0).unwrap();
            gates.push((
                gate_id.rsplit(':').next().unwrap().to_owned(),
                statement.column_text(1).unwrap(),
                statement.column_u64(2).unwrap(),
                statement.column_text(3).unwrap(),
                statement.column_u64(4).unwrap() == 1,
            ));
        }
        gates
    }

    #[test]
    fn template_admission_uses_registered_profile_versions_and_exact_gates() {
        let profiles = [
            (
                "focused",
                AcceptanceProfile::focused(),
                vec![
                    ("checkpoint", "focused", 1, "checkpoint", true),
                    ("summary", "focused", 1, "summary", true),
                    ("verification", "focused", 1, "verification", true),
                ],
            ),
            (
                "reviewed",
                AcceptanceProfile::reviewed(),
                vec![
                    ("checkpoint", "reviewed", 1, "checkpoint", true),
                    ("review", "reviewed", 1, "review", true),
                    ("summary", "reviewed", 1, "summary", true),
                    ("verification", "reviewed", 1, "verification", true),
                ],
            ),
            (
                "general-attestation",
                profile(
                    "general-attestation",
                    "1",
                    vec![gate("summary", GateKind::Summary)],
                ),
                vec![("summary", "general-attestation", 1, "summary", true)],
            ),
            (
                "validated-deliverables",
                profile(
                    "validated-deliverables",
                    "1",
                    vec![gate("summary", GateKind::Summary)],
                ),
                vec![("summary", "validated-deliverables", 1, "summary", true)],
            ),
            (
                "reviewed-artifacts",
                profile(
                    "reviewed-artifacts",
                    "1",
                    vec![
                        gate("summary", GateKind::Summary),
                        gate("artifact_review", GateKind::Review),
                    ],
                ),
                vec![
                    ("artifact_review", "reviewed-artifacts", 1, "review", true),
                    ("summary", "reviewed-artifacts", 1, "summary", true),
                ],
            ),
        ];

        for (index, (name, acceptance_profile, expected_gates)) in profiles.into_iter().enumerate()
        {
            let project_id = format!("template-profile-{index}");
            let store = store_with_project(&project_id);
            let expected_revision = store.project_revision(&project_id).unwrap().0;
            let request = batch_request(
                &project_id,
                acceptance_profile,
                &format!("operation-{name}"),
                expected_revision,
            );
            let created = store.create_work_batch(&request).unwrap();
            assert_eq!(created.works.len(), 1, "profile {name}");
            assert_eq!(
                stored_gates(&store, "batch-profile-item"),
                expected_gates
                    .into_iter()
                    .map(|(id, profile, version, kind, required)| {
                        (
                            id.to_owned(),
                            profile.to_owned(),
                            version,
                            kind.to_owned(),
                            required,
                        )
                    })
                    .collect::<Vec<_>>(),
                "profile {name}"
            );
        }
    }

    #[test]
    fn template_admission_rejects_unknown_wrong_version_and_noncanonical_gates() {
        let cases = [
            (
                "unknown",
                profile(
                    "unregistered",
                    "1",
                    vec![gate("summary", GateKind::Summary)],
                ),
            ),
            (
                "wrong-version",
                profile(
                    "general-attestation",
                    "2",
                    vec![gate("summary", GateKind::Summary)],
                ),
            ),
            (
                "wrong-gates",
                profile(
                    "general-attestation",
                    "1",
                    vec![
                        gate("checkpoint", GateKind::Checkpoint),
                        gate("summary", GateKind::Summary),
                    ],
                ),
            ),
            (
                "legacy-wrong-version",
                profile(
                    "focused",
                    "2",
                    vec![
                        gate("checkpoint", GateKind::Checkpoint),
                        gate("verification", GateKind::Verification),
                        gate("summary", GateKind::Summary),
                    ],
                ),
            ),
        ];

        for (index, (case, acceptance_profile)) in cases.into_iter().enumerate() {
            let project_id = format!("template-invalid-profile-{index}");
            let store = store_with_project(&project_id);
            let expected_revision = store.project_revision(&project_id).unwrap().0;
            let request = batch_request(
                &project_id,
                acceptance_profile,
                &format!("operation-{case}"),
                expected_revision,
            );
            assert!(store.create_work_batch(&request).is_err(), "case {case}");
            assert!(
                store
                    .work(&project_id, "batch-profile-item")
                    .unwrap()
                    .is_none(),
                "case {case} wrote a work item"
            );
            assert_eq!(
                store.project_revision(&project_id).unwrap().0,
                expected_revision,
                "case {case}"
            );
        }
    }
}
