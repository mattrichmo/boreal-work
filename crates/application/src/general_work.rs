//! Revision-bound application use cases for general work artifacts and waits.
//! Adapters use these methods instead of composing lifecycle or acceptance
//! decisions in clients.

use boreal_domain::deliverables::{
    AcceptedInput, ArtifactDecision, ArtifactInspection, InputSource, OutputRequirement,
    ProducedArtifact, RigorProfile,
};
use boreal_domain::external_waits::{
    AccountableParty, BusinessDate, BusinessMoment, CivilDate, ExternalWait, ExternalWaitState,
};
use boreal_domain::{ProjectId, TimestampMs};
use boreal_store::general_work::{
    AcceptedInputBindingInput, AcceptedInputSetInput, ArtifactDecisionInput,
    ArtifactInspectionInput, ExternalWaitInput, OutputSubmissionInput, ProducedArtifactInput,
    WorkContractRevisionInput,
};
use boreal_store::{MutationResult, StoreError, V3MutationContext};
use serde_json::{json, Value};

use crate::{
    canonical_request_digest, ApplicationError, OperationResult, PlanningScope, WorkApplication,
};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SetWorkContractRequest {
    pub scope: PlanningScope,
    pub operation_id: String,
    pub work_id: String,
    pub expected_contract_revision: u64,
    pub new_contract_revision: u64,
    pub rigor: RigorProfile,
    pub requirements: Vec<OutputRequirement>,
    pub amendment_reason: Option<String>,
    pub now: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AcceptInputSetRequest {
    pub scope: PlanningScope,
    pub operation_id: String,
    pub work_id: String,
    pub expected_contract_revision: u64,
    pub expected_input_revision: u64,
    pub new_input_revision: u64,
    pub inputs: Vec<AcceptedInput>,
    pub amendment_reason: Option<String>,
    pub now: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SubmitOutputArtifactsRequest {
    pub scope: PlanningScope,
    pub operation_id: String,
    pub work_id: String,
    pub submission_id: String,
    pub attempt_id: String,
    pub fence: u64,
    pub proof_revision: u64,
    pub contract_revision: u64,
    pub input_revision: u64,
    pub artifacts: Vec<ProducedArtifact>,
    pub now: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CreateExternalWaitRequest {
    pub scope: PlanningScope,
    pub operation_id: String,
    pub wait: ExternalWait,
    pub now: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResolveExternalWaitRequest {
    pub scope: PlanningScope,
    pub operation_id: String,
    pub work_id: String,
    pub wait_id: String,
    pub state: ExternalWaitState,
    pub result: Option<String>,
    pub rationale: String,
    pub now: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExternalWaitList {
    pub source_revision: u64,
    pub waits: Vec<boreal_store::general_work::ExternalWaitRecord>,
    pub blocked_work_ids: Vec<String>,
    pub due_follow_up_ids: Vec<String>,
    pub overdue_follow_up_ids: Vec<String>,
}

impl WorkApplication<'_> {
    pub fn set_work_contract_v1(
        &self,
        request: &SetWorkContractRequest,
    ) -> Result<OperationResult<()>, ApplicationError> {
        validate_scope(&request.scope)?;
        validate_operation_id(&request.operation_id)?;
        if request.scope.project_id.as_str().is_empty() || request.work_id.trim().is_empty() {
            return Err(ApplicationError::Invalid(
                "project_id and work_id are required".into(),
            ));
        }
        RigorProfile::supported(request.rigor.id.clone(), request.rigor.version).map_err(
            |error| ApplicationError::Invalid(format!("invalid rigor profile: {error:?}")),
        )?;
        if request.requirements.len() > boreal_domain::deliverables::MAX_OUTPUT_REQUIREMENTS {
            return Err(ApplicationError::Invalid(
                "at most 64 output requirements are supported".into(),
            ));
        }
        for requirement in &request.requirements {
            requirement.validate().map_err(|error| {
                ApplicationError::Invalid(format!("invalid output requirement: {error:?}"))
            })?;
        }
        // An empty declaration set is intentionally valid for legacy work.
        let requirements_json = json!({
            "schema_version": "boreal.general-work/1",
            "requirements": request.requirements.iter().map(requirement_json).collect::<Vec<_>>(),
        })
        .to_string();
        let context = mutation_context(
            &request.scope,
            &request.operation_id,
            "work.contract.set/v1",
            &request.work_id,
            &json!({
                "expected_contract_revision": request.expected_contract_revision,
                "new_contract_revision": request.new_contract_revision,
                "rigor_profile_id": request.rigor.id,
                "rigor_profile_version": request.rigor.version,
                "requirements": request.requirements.iter().map(requirement_json).collect::<Vec<_>>(),
                "amendment_reason": request.amendment_reason,
            }),
            &request.now,
        );
        let input = WorkContractRevisionInput {
            work_id: request.work_id.clone(),
            expected_contract_revision: request.expected_contract_revision,
            new_contract_revision: request.new_contract_revision,
            rigor_profile_id: request.rigor.id.clone(),
            rigor_profile_version: u64::from(request.rigor.version),
            requirements_json,
            amendment_reason: request.amendment_reason.clone(),
        };
        let mutation = self.store_ref().set_work_contract_v1(&context, &input)?;
        Ok(operation_result(request.operation_id.clone(), mutation))
    }

    pub fn accept_input_set_v1(
        &self,
        request: &AcceptInputSetRequest,
    ) -> Result<OperationResult<()>, ApplicationError> {
        validate_scope(&request.scope)?;
        validate_operation_id(&request.operation_id)?;
        if request.inputs.len() > 100 {
            return Err(ApplicationError::Invalid(
                "at most 100 accepted inputs are supported".into(),
            ));
        }
        for input in &request.inputs {
            input.validate().map_err(|error| {
                ApplicationError::Invalid(format!("invalid accepted input: {error:?}"))
            })?;
            if input.project_id != request.scope.project_id
                || input.work_id.as_str() != request.work_id
                || input.revision != request.new_input_revision
                || input.accepted_by.as_str() != request.scope.actor_id
            {
                return Err(ApplicationError::Invalid(
                    "accepted input scope, revision, and actor must match this mutation".into(),
                ));
            }
        }
        let bindings = request
            .inputs
            .iter()
            .map(input_binding)
            .collect::<Result<Vec<_>, _>>()?;
        let context = mutation_context(
            &request.scope,
            &request.operation_id,
            "work.inputs.accept/v1",
            &request.work_id,
            &json!({
                "expected_contract_revision": request.expected_contract_revision,
                "expected_input_revision": request.expected_input_revision,
                "new_input_revision": request.new_input_revision,
                "inputs": request.inputs.iter().map(input_json).collect::<Vec<_>>(),
                "amendment_reason": request.amendment_reason,
            }),
            &request.now,
        );
        let input = AcceptedInputSetInput {
            work_id: request.work_id.clone(),
            expected_contract_revision: request.expected_contract_revision,
            expected_input_revision: request.expected_input_revision,
            new_input_revision: request.new_input_revision,
            bindings,
            amendment_reason: request.amendment_reason.clone(),
        };
        let mutation = self
            .store_ref()
            .set_accepted_input_set_v1(&context, &input)?;
        Ok(operation_result(request.operation_id.clone(), mutation))
    }

    pub fn submit_output_artifacts_v1(
        &self,
        request: &SubmitOutputArtifactsRequest,
    ) -> Result<OperationResult<boreal_store::general_work::OutputSubmissionRecord>, ApplicationError> {
        validate_scope(&request.scope)?;
        validate_operation_id(&request.operation_id)?;
        if request.artifacts.len() > 6_400 {
            return Err(ApplicationError::Invalid(
                "output submission exceeds the 6,400 artifact bound".into(),
            ));
        }
        for artifact in &request.artifacts {
            artifact.validate().map_err(|error| {
                ApplicationError::Invalid(format!("invalid produced artifact: {error:?}"))
            })?;
            if artifact.identity.project_id != request.scope.project_id
                || artifact.producing_work_id.as_str() != request.work_id
                || artifact.submission_id != request.submission_id
                || artifact.attempt_id != request.attempt_id
                || artifact.fence != request.fence
                || artifact.producer_actor_id.as_str() != request.scope.actor_id
            {
                return Err(ApplicationError::Invalid(
                    "output artifact scope, submission, producer, and fence must match".into(),
                ));
            }
        }
        let context = mutation_context(
            &request.scope,
            &request.operation_id,
            "work.outputs.submit/v1",
            &request.work_id,
            &json!({
                "submission_id": request.submission_id,
                "attempt_id": request.attempt_id,
                "fence": request.fence,
                "proof_revision": request.proof_revision,
                "contract_revision": request.contract_revision,
                "input_revision": request.input_revision,
                "artifacts": request.artifacts.iter().map(|artifact| json!({
                    "artifact_id": artifact.artifact_id,
                    "requirement_key": artifact.requirement_key.as_str(),
                    "source_version_id": artifact.identity.source_version_id.as_str(),
                })).collect::<Vec<_>>(),
            }),
            &request.now,
        );
        let input = OutputSubmissionInput {
            work_id: request.work_id.clone(),
            submission_id: request.submission_id.clone(),
            attempt_id: request.attempt_id.clone(),
            fence: request.fence,
            proof_revision: request.proof_revision,
            contract_revision: request.contract_revision,
            input_revision: request.input_revision,
            artifacts: request
                .artifacts
                .iter()
                .map(|artifact| ProducedArtifactInput {
                    artifact_id: artifact.artifact_id.clone(),
                    requirement_key: artifact.requirement_key.as_str().to_owned(),
                    source_version_id: artifact.identity.source_version_id.as_str().to_owned(),
                })
                .collect(),
        };
        let (mutation, record) = self
            .store_ref()
            .submit_output_artifacts_v1(&context, &input)?;
        Ok(OperationResult {
            operation_id: request.operation_id.clone(),
            snapshot_revision: mutation.revision,
            changed: !mutation.replayed,
            value: record,
        })
    }

    pub fn record_artifact_inspection_v1(
        &self,
        scope: &PlanningScope,
        operation_id: &str,
        inspection: &ArtifactInspection,
        now: &str,
    ) -> Result<OperationResult<()>, ApplicationError> {
        validate_scope(scope)?;
        validate_operation_id(operation_id)?;
        let kind = match inspection.inspector_kind {
            boreal_domain::deliverables::InspectorKind::Automatic => {
                return Err(ApplicationError::Invalid(
                    "automatic inspections require trusted internal validator provenance; use a reviewer or operator for a human inspection".into(),
                ));
            }
            boreal_domain::deliverables::InspectorKind::Human => "human",
        };
        if inspection.project_id != scope.project_id
            || inspection.inspector_actor_id.as_str() != scope.actor_id
        {
            return Err(ApplicationError::Invalid(
                "inspection project and inspector must match the authenticated scope".into(),
            ));
        }
        let outcome = match inspection.outcome {
            boreal_domain::deliverables::InspectionOutcome::Passed => "passed",
            boreal_domain::deliverables::InspectionOutcome::Failed => "failed",
            boreal_domain::deliverables::InspectionOutcome::Unavailable => "unavailable",
        };
        let criteria =
            json!(inspection.criteria.iter().map(|value| json!({
            "criterion": value.criterion,
            "outcome": match value.outcome {
                boreal_domain::deliverables::InspectionOutcome::Passed => "passed",
                boreal_domain::deliverables::InspectionOutcome::Failed => "failed",
                boreal_domain::deliverables::InspectionOutcome::Unavailable => "unavailable",
            },
            "detail": value.detail,
        })).collect::<Vec<_>>())
            .to_string();
        let context = mutation_context(
            scope,
            operation_id,
            "work.artifact.inspect/v1",
            inspection.work_id.as_str(),
            &json!({"inspection_id":inspection.inspection_id,"submission_id":inspection.submission_id,"artifact_id":inspection.artifact_id,"artifact_digest":inspection.artifact_digest,"inspector_kind":kind,"outcome":outcome,"criteria":criteria}),
            now,
        );
        let mutation = self.store_ref().record_artifact_inspection_v1(
            &context,
            &ArtifactInspectionInput {
                work_id: inspection.work_id.to_string(),
                inspection_id: inspection.inspection_id.clone(),
                submission_id: inspection.submission_id.clone(),
                artifact_id: inspection.artifact_id.clone(),
                artifact_digest: inspection.artifact_digest.clone(),
                inspector_kind: kind.into(),
                outcome: outcome.into(),
                criteria_json: criteria,
            },
        )?;
        Ok(operation_result(operation_id.to_owned(), mutation))
    }

    pub fn record_artifact_decision_v1(
        &self,
        scope: &PlanningScope,
        operation_id: &str,
        decision: &ArtifactDecision,
        now: &str,
    ) -> Result<OperationResult<()>, ApplicationError> {
        validate_scope(scope)?;
        validate_operation_id(operation_id)?;
        if decision.project_id != scope.project_id
            || decision.reviewer_actor_id.as_str() != scope.actor_id
        {
            return Err(ApplicationError::Invalid(
                "decision project and reviewer must match the authenticated scope".into(),
            ));
        }
        let decision_name = match decision.decision {
            boreal_domain::deliverables::AcceptanceDecisionKind::Approved => "approved",
            boreal_domain::deliverables::AcceptanceDecisionKind::Rejected => "rejected",
            boreal_domain::deliverables::AcceptanceDecisionKind::NeedsRevision => "needs_revision",
        };
        let context = mutation_context(
            scope,
            operation_id,
            "work.artifact.decide/v1",
            decision.work_id.as_str(),
            &json!({
                "decision_id":decision.decision_id,"submission_id":decision.submission_id,"contract_revision":decision.contract_revision,
                "input_revision":decision.input_revision,"artifact_set_digest":decision.artifact_set_digest,
                "producer_actor_id":decision.producer_actor_id,"decision":decision_name,"reason":decision.reason,
            }),
            now,
        );
        let mutation = self.store_ref().record_artifact_decision_v1(
            &context,
            &ArtifactDecisionInput {
                work_id: decision.work_id.to_string(),
                decision_id: decision.decision_id.clone(),
                submission_id: decision.submission_id.clone(),
                contract_revision: decision.contract_revision,
                input_revision: decision.input_revision,
                proof_revision: decision.proof_revision,
                artifact_set_digest: decision.artifact_set_digest.clone(),
                producer_actor_id: decision.producer_actor_id.to_string(),
                decision: decision_name.into(),
                reason: decision.reason.clone(),
            },
        )?;
        Ok(operation_result(operation_id.to_owned(), mutation))
    }

    pub fn create_external_wait_v1(
        &self,
        request: &CreateExternalWaitRequest,
    ) -> Result<OperationResult<()>, ApplicationError> {
        validate_scope(&request.scope)?;
        validate_operation_id(&request.operation_id)?;
        request.wait.validate().map_err(|error| {
            ApplicationError::Invalid(format!("invalid external wait: {error:?}"))
        })?;
        if request.wait.project_id != request.scope.project_id
            || request.wait.created_by.as_str() != request.scope.actor_id
            || request.wait.state != ExternalWaitState::Open
            || request.wait.resolution.is_some()
            || request.wait.cancellation.is_some()
        {
            return Err(ApplicationError::Invalid(
                "new external waits must be open and attributed to the current project actor"
                    .into(),
            ));
        }
        if let Some(BusinessMoment::Date(date)) = &request.wait.follow_up {
            crate::SystemTimeZoneDatabase::system().validate_timezone(&date.timezone)?;
        }
        let (accountable_kind, accountable_ref) = match &request.wait.accountable {
            AccountableParty::PersonOrRole { reference } => ("person_or_role", reference.clone()),
            AccountableParty::ExternalService { reference } => {
                ("external_service", reference.clone())
            }
        };
        let follow_up_json = request
            .wait
            .follow_up
            .as_ref()
            .map(business_moment_json)
            .map(|value| value.to_string());
        let context = mutation_context(
            &request.scope,
            &request.operation_id,
            "work.wait.create/v1",
            request.wait.work_id.as_str(),
            &json!({
                "wait_id":request.wait.wait_id,"category":request.wait.category,"reason":request.wait.reason,
                "accountable_kind":accountable_kind,"accountable_ref":accountable_ref,
                "expected_decision_or_output":request.wait.expected_decision_or_output,"follow_up":follow_up_json,
            }),
            &request.now,
        );
        let mutation = self.store_ref().create_external_wait_v1(
            &context,
            &ExternalWaitInput {
                work_id: request.wait.work_id.to_string(),
                wait_id: request.wait.wait_id.clone(),
                category: request.wait.category.clone(),
                reason: request.wait.reason.clone(),
                accountable_kind: accountable_kind.into(),
                accountable_ref,
                expected_decision_or_output: request.wait.expected_decision_or_output.clone(),
                follow_up_json,
            },
        )?;
        Ok(operation_result(request.operation_id.clone(), mutation))
    }

    pub fn resolve_external_wait_v1(
        &self,
        request: &ResolveExternalWaitRequest,
    ) -> Result<OperationResult<()>, ApplicationError> {
        validate_scope(&request.scope)?;
        validate_operation_id(&request.operation_id)?;
        let state = match request.state {
            ExternalWaitState::Resolved => "resolved",
            ExternalWaitState::Cancelled => "cancelled",
            ExternalWaitState::Open => {
                return Err(ApplicationError::Invalid(
                    "terminal wait transition must be resolved or cancelled".into(),
                ))
            }
        };
        if state == "resolved" && request.result.as_deref().is_none_or(str::is_empty) {
            return Err(ApplicationError::Invalid(
                "resolution result is required".into(),
            ));
        }
        let context = mutation_context(
            &request.scope,
            &request.operation_id,
            "work.wait.resolve/v1",
            &request.work_id,
            &json!({
                "wait_id":request.wait_id,"state":state,"result":request.result,"rationale":request.rationale,
            }),
            &request.now,
        );
        let mutation = self.store_ref().resolve_external_wait_v1(
            &context,
            &request.work_id,
            &request.wait_id,
            state,
            request.result.as_deref(),
            &request.rationale,
        )?;
        Ok(operation_result(request.operation_id.clone(), mutation))
    }

    pub fn external_waits_v1(
        &self,
        project_id: &ProjectId,
        work_id: Option<&str>,
        include_terminal: bool,
    ) -> Result<Vec<boreal_store::general_work::ExternalWaitRecord>, ApplicationError> {
        Ok(self
            .store_ref()
            .external_waits_v1(project_id.as_str(), work_id, include_terminal)?)
    }

    /// Read external waits with current blocked and due-follow-up projections.
    /// Date-only follow-ups are evaluated using the exact IANA zone stored on
    /// each wait; an overdue follow-up does not resolve or remove the wait.
    pub fn external_wait_list_v1(
        &self,
        project_id: &ProjectId,
        work_id: Option<&str>,
        include_terminal: bool,
        expected_project_revision: u64,
        now: TimestampMs,
    ) -> Result<ExternalWaitList, ApplicationError> {
        let start_revision = self.store_ref().project_revision(project_id.as_str())?.0;
        if start_revision != expected_project_revision {
            return Err(ApplicationError::Store(StoreError::StaleRevision {
                expected: expected_project_revision,
                actual: start_revision,
            }));
        }
        let waits =
            self.store_ref()
                .external_waits_v1(project_id.as_str(), work_id, include_terminal)?;
        let mut blocked_work_ids = Vec::new();
        let mut due_follow_up_ids = Vec::new();
        let mut overdue_follow_up_ids = Vec::new();
        let timezone_db = crate::SystemTimeZoneDatabase::system();
        for wait in &waits {
            if wait.state != "open" {
                continue;
            }
            blocked_work_ids.push(wait.work_id.clone());
            if let Some(raw) = &wait.follow_up_json {
                let moment = parse_business_moment(raw)?;
                let (due, overdue) = match moment {
                    BusinessMoment::Instant(at) => (now >= at, now > at),
                    BusinessMoment::Date(date) => {
                        let local = timezone_db.local_date_at(&date.timezone, now)?;
                        let year = u16::try_from(local.year).map_err(|_| {
                            ApplicationError::Invalid(
                                "follow-up year is outside supported range".into(),
                            )
                        })?;
                        let local_date =
                            CivilDate::new(year, local.month, local.day).map_err(|_| {
                                ApplicationError::Invalid("follow-up local date is invalid".into())
                            })?;
                        (date.date <= local_date, date.date < local_date)
                    }
                };
                if due {
                    due_follow_up_ids.push(wait.wait_id.clone());
                }
                if overdue {
                    overdue_follow_up_ids.push(wait.wait_id.clone());
                }
            }
        }
        blocked_work_ids.sort();
        blocked_work_ids.dedup();
        due_follow_up_ids.sort();
        overdue_follow_up_ids.sort();
        let source_revision = self.store_ref().project_revision(project_id.as_str())?.0;
        if source_revision != start_revision {
            return Err(ApplicationError::Store(StoreError::StaleRevision {
                expected: expected_project_revision,
                actual: source_revision,
            }));
        }
        Ok(ExternalWaitList {
            source_revision,
            waits,
            blocked_work_ids,
            due_follow_up_ids,
            overdue_follow_up_ids,
        })
    }

    pub fn work_contract_v1(
        &self,
        project_id: &ProjectId,
        work_id: &str,
        revision: Option<u64>,
    ) -> Result<Option<boreal_store::general_work::WorkContractRevisionRecord>, ApplicationError>
    {
        Ok(self
            .store_ref()
            .work_contract_v1(project_id.as_str(), work_id, revision)?)
    }

    pub fn output_acceptance_v1(
        &self,
        project_id: &ProjectId,
        work_id: &str,
        expected_project_revision: u64,
    ) -> Result<Option<boreal_store::general_work::OutputAcceptanceRecord>, ApplicationError> {
        Ok(self.store_ref().output_acceptance_v1(
            project_id.as_str(),
            work_id,
            expected_project_revision,
        )?)
    }

    pub fn accepted_input_set_v1(
        &self,
        project_id: &ProjectId,
        work_id: &str,
        revision: Option<u64>,
    ) -> Result<Option<boreal_store::general_work::AcceptedInputSetRecord>, ApplicationError> {
        Ok(self
            .store_ref()
            .accepted_input_set_v1(project_id.as_str(), work_id, revision)?)
    }

    pub fn output_submission_v1(
        &self,
        project_id: &ProjectId,
        work_id: &str,
        submission_id: &str,
    ) -> Result<Option<boreal_store::general_work::OutputSubmissionRecord>, ApplicationError> {
        Ok(self
            .store_ref()
            .output_submission_v1(project_id.as_str(), work_id, submission_id)?)
    }

    pub fn artifact_evidence_v1(
        &self,
        project_id: &ProjectId,
        work_id: &str,
        submission_id: &str,
    ) -> Result<Option<boreal_store::general_work::ArtifactEvidenceRecord>, ApplicationError> {
        Ok(self
            .store_ref()
            .artifact_evidence_v1(project_id.as_str(), work_id, submission_id)?)
    }
}

fn validate_scope(scope: &PlanningScope) -> Result<(), ApplicationError> {
    scope
        .validate()
        .map_err(|error| ApplicationError::Planning(error))?;
    if scope.expected_revision.is_none() {
        return Err(ApplicationError::Invalid(
            "general-work mutations require expected_revision".into(),
        ));
    }
    Ok(())
}

fn validate_operation_id(value: &str) -> Result<(), ApplicationError> {
    if value.trim().is_empty() || value.len() > 255 || value.chars().any(char::is_control) {
        return Err(ApplicationError::Invalid(
            "operation_id must be nonempty and at most 255 bytes".into(),
        ));
    }
    Ok(())
}

fn mutation_context(
    scope: &PlanningScope,
    operation_id: &str,
    command: &str,
    subject_id: &str,
    payload: &Value,
    now: &str,
) -> V3MutationContext {
    V3MutationContext {
        project_id: scope.project_id.to_string(),
        actor_id: scope.actor_id.clone(),
        session_id: scope.session_id.clone(),
        operation_id: operation_id.to_owned(),
        request_digest: canonical_request_digest(
            command,
            json!({"project_id":scope.project_id,"actor_id":scope.actor_id,"session_id":scope.session_id,"subject_id":subject_id,"expected_revision":scope.expected_revision,"payload":payload}),
        ),
        expected_revision: scope.expected_revision,
        now: now.to_owned(),
    }
}

fn operation_result(operation_id: String, mutation: MutationResult) -> OperationResult<()> {
    OperationResult {
        operation_id,
        snapshot_revision: mutation.revision,
        changed: !mutation.replayed,
        value: (),
    }
}

fn requirement_json(requirement: &OutputRequirement) -> Value {
    json!({
        "requirement_key":requirement.key.as_str(),"purpose":requirement.purpose,"required":requirement.required,
        "deliverable_type":match requirement.deliverable_type {
            boreal_domain::deliverables::DeliverableType::Document=>"document",
            boreal_domain::deliverables::DeliverableType::Image=>"image",
            boreal_domain::deliverables::DeliverableType::Data=>"data",
            boreal_domain::deliverables::DeliverableType::Archive=>"archive",
            boreal_domain::deliverables::DeliverableType::Code=>"code",
            boreal_domain::deliverables::DeliverableType::Other=>"other",
        },
        "allowed_media_types":requirement.allowed_media_types,"minimum_count":requirement.minimum_count,"maximum_count":requirement.maximum_count,
        "criteria":requirement.criteria.iter().map(|criterion|match criterion {
            boreal_domain::deliverables::ValidationCriterion::MinimumBytes(value)=>json!({"kind":"minimum_bytes","value":value}),
            boreal_domain::deliverables::ValidationCriterion::MaximumBytes(value)=>json!({"kind":"maximum_bytes","value":value}),
            boreal_domain::deliverables::ValidationCriterion::MinimumImageWidth(value)=>json!({"kind":"minimum_image_width","value":value}),
            boreal_domain::deliverables::ValidationCriterion::MinimumImageHeight(value)=>json!({"kind":"minimum_image_height","value":value}),
        }).collect::<Vec<_>>(),
    })
}

fn input_binding(input: &AcceptedInput) -> Result<AcceptedInputBindingInput, ApplicationError> {
    let (producing_work_id, producing_submission_id, producing_artifact_id, source_version_id) =
        match &input.source {
            InputSource::CapturedSource { source_version_id } => {
                (None, None, None, source_version_id)
            }
            InputSource::ProducedArtifact {
                producing_work_id,
                submission_id,
                artifact_id,
                source_version_id,
            } => (
                Some(producing_work_id.as_str().to_owned()),
                Some(submission_id.clone()),
                Some(artifact_id.clone()),
                source_version_id,
            ),
        };
    Ok(AcceptedInputBindingInput {
        input_key: input.key.clone(),
        role: input.role.clone(),
        required: input.required,
        source_version_id: source_version_id.as_str().to_owned(),
        producing_work_id,
        producing_submission_id,
        producing_artifact_id,
    })
}

fn input_json(input: &AcceptedInput) -> Value {
    match &input.source {
        InputSource::CapturedSource { source_version_id } => {
            json!({"input_key":input.key,"role":input.role,"required":input.required,"source_version_id":source_version_id.as_str()})
        }
        InputSource::ProducedArtifact {
            producing_work_id,
            submission_id,
            artifact_id,
            source_version_id,
        } => {
            json!({"input_key":input.key,"role":input.role,"required":input.required,"source_version_id":source_version_id.as_str(),"producing_work_id":producing_work_id.as_str(),"producing_submission_id":submission_id,"producing_artifact_id":artifact_id})
        }
    }
}

fn business_moment_json(moment: &BusinessMoment) -> Value {
    match moment {
        BusinessMoment::Instant(at) => json!({"kind":"instant","at_utc_ms":at.as_millis()}),
        BusinessMoment::Date(date) => {
            json!({"kind":"date_only","date":date.date.as_iso_date(),"timezone":date.timezone})
        }
    }
}

fn parse_business_moment(raw: &str) -> Result<BusinessMoment, ApplicationError> {
    let value: Value = serde_json::from_str(raw)
        .map_err(|_| ApplicationError::Invalid("stored business moment is invalid JSON".into()))?;
    match value.get("kind").and_then(Value::as_str) {
        Some("instant") => value
            .get("at_utc_ms")
            .and_then(Value::as_u64)
            .map(|at| BusinessMoment::Instant(TimestampMs::from_millis(at)))
            .ok_or_else(|| {
                ApplicationError::Invalid("instant follow-up is missing at_utc_ms".into())
            }),
        Some("date_only") => {
            let date = value.get("date").and_then(Value::as_str).ok_or_else(|| {
                ApplicationError::Invalid("date-only follow-up is missing date".into())
            })?;
            let timezone = value
                .get("timezone")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    ApplicationError::Invalid("date-only follow-up is missing timezone".into())
                })?;
            let date = CivilDate::parse(date).map_err(|_| {
                ApplicationError::Invalid("date-only follow-up date is invalid".into())
            })?;
            let date = BusinessDate::new(date, timezone.to_owned()).map_err(|_| {
                ApplicationError::Invalid("date-only follow-up timezone is invalid".into())
            })?;
            Ok(BusinessMoment::Date(date))
        }
        _ => Err(ApplicationError::Invalid(
            "business moment kind is unsupported".into(),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use boreal_domain::deliverables::{InspectionOutcome, InspectorKind};
    use boreal_domain::{ActorId, ProjectId, WorkId};
    use boreal_store::SqliteStore;

    #[test]
    fn enrolled_agent_cannot_assert_automatic_inspection() {
        let store = SqliteStore::open_in_memory(include_str!(
            "../../../project/spec/schema-v2.sql"
        ))
        .expect("synthetic schema opens");
        let app = WorkApplication::new(&store);
        let mut scope = PlanningScope::new(ProjectId::new("p1"), "agent-1");
        scope.expected_revision = Some(0);
        let inspection = ArtifactInspection {
            inspection_id: "inspect-1".into(),
            project_id: ProjectId::new("p1"),
            work_id: WorkId::new("w1"),
            submission_id: "submission-1".into(),
            artifact_id: "artifact-1".into(),
            artifact_digest: format!("sha256:{}", "a".repeat(64)),
            inspector_actor_id: ActorId::new("agent-1"),
            inspector_kind: InspectorKind::Automatic,
            outcome: InspectionOutcome::Passed,
            criteria: Vec::new(),
            inspected_at: TimestampMs(1),
        };

        let result = app.record_artifact_inspection_v1(
            &scope,
            "op-forged-automatic-inspection",
            &inspection,
            "unix-ms:1",
        );
        assert!(matches!(
            result,
            Err(ApplicationError::Invalid(message))
                if message.contains("trusted internal validator provenance")
        ));
        assert!(!store
            .operation_exists("op-forged-automatic-inspection")
            .expect("operation lookup succeeds"));
    }

    #[test]
    fn enrolled_agent_cannot_record_a_human_inspection_as_the_producer() {
        let store = SqliteStore::open_with_work_model_v3(
            ":memory:",
            include_str!("../../../project/spec/schema-v2.sql"),
            include_str!("../../../project/spec/schema-v3.sql"),
        )
        .expect("synthetic v3 schema opens");
        store
            .ensure_general_work_schema()
            .expect("general-work schema installs");
        let app = WorkApplication::new(&store);
        let project = ProjectId::new("p1");
        app.init_project(
            &project,
            "agent-1",
            "agent",
            "fixture-agent",
            "Fixture agent",
            "unix-ms:0",
            "op-init-agent-inspection",
        )
        .expect("synthetic agent project initializes");
        let mut scope = PlanningScope::new(project.clone(), "agent-1");
        scope.expected_revision = Some(store.project_revision("p1").unwrap().0);
        let inspection = ArtifactInspection {
            inspection_id: "inspect-human-1".into(),
            project_id: project,
            work_id: WorkId::new("w1"),
            submission_id: "submission-1".into(),
            artifact_id: "artifact-1".into(),
            artifact_digest: format!("sha256:{}", "a".repeat(64)),
            inspector_actor_id: ActorId::new("agent-1"),
            inspector_kind: InspectorKind::Human,
            outcome: InspectionOutcome::Passed,
            criteria: Vec::new(),
            inspected_at: TimestampMs(1),
        };

        let result = app.record_artifact_inspection_v1(
            &scope,
            "op-forged-human-inspection",
            &inspection,
            "unix-ms:1",
        );
        assert!(matches!(
            result,
            Err(ApplicationError::Store(boreal_store::StoreError::Invalid(message)))
                if message.contains("reviewer or operator principal")
        ));
        assert!(!store
            .operation_exists("op-forged-human-inspection")
            .expect("operation lookup succeeds"));
    }
}
