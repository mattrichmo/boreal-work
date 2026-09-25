//! Transport projection of the canonical decision. Domain facts remain JSON-free.
//! Missing, unreadable, stale and failed facts are distinct on the wire.
use boreal_domain::decision_inputs::*;
use serde_json::{json, Value};

fn label(value: impl std::fmt::Debug) -> String {
    let text = format!("{value:?}");
    let mut result = String::new();
    for (index, character) in text.chars().enumerate() {
        if character.is_ascii_uppercase() && index > 0 {
            result.push('_');
        }
        result.extend(character.to_lowercase());
    }
    result
}
fn entity(value: &EntityIdentity) -> Value {
    json!({"project_id":value.project_id.as_str(),"work_id":value.work_id.as_str(),"entity_revision":value.revision.get()})
}
fn attempt(value: &AttemptIdentity) -> Value {
    json!({"attempt_id":value.attempt_id.as_str(),"fence":value.fence.get()})
}
fn target(value: &FactTarget) -> Value {
    match value {
        FactTarget::Work => json!({"kind":"work"}),
        FactTarget::Actor(id) => json!({"kind":"actor","id":id.as_str()}),
        FactTarget::Requirements => json!({"kind":"requirements"}),
        FactTarget::Dependencies => json!({"kind":"dependencies"}),
        FactTarget::Holds => json!({"kind":"holds"}),
        FactTarget::Attempt(id) => json!({"kind":"attempt","id":id.as_str()}),
        FactTarget::Submission(id) => json!({"kind":"submission","id":id.as_str()}),
        FactTarget::Review(id) => json!({"kind":"review","id":id.as_str()}),
        FactTarget::Recovery(id) => json!({"kind":"recovery","id":id.as_str()}),
    }
}
fn subject(value: &FactSubject) -> Value {
    json!({"project_id":value.project_id.as_str(),"work_id":value.work_id.as_str(),"target":target(&value.target)})
}
fn scope(value: &IntegrityScope) -> Value {
    json!({"project_id":value.project_id.as_str(),"work_id":value.work_id.as_str(),"target":target(&value.target)})
}
fn revision(value: RevisionMarker) -> Value {
    match value {
        RevisionMarker::Snapshot(v) => json!({"kind":"snapshot","value":v.0}),
        RevisionMarker::Entity(v) => json!({"kind":"entity","value":v.get()}),
        RevisionMarker::Proof(v) => json!({"kind":"proof","value":v.get()}),
        RevisionMarker::Fence(v) => json!({"kind":"fence","value":v.get()}),
    }
}
fn fact<T>(value: &Fact<T>, present: impl FnOnce(&T) -> Value) -> Value {
    match value {
        Fact::Present(v) => json!({"state":"present","value":present(v)}),
        Fact::Absent { diagnostic: d } => {
            json!({"state":"absent","diagnostic":{"fact":label(d.fact),"subject":subject(&d.subject),"allowance":label(d.allowance)}})
        }
        Fact::Unreadable { diagnostic: d } => {
            json!({"state":"unreadable","diagnostic":{"fact":label(d.fact),"subject":subject(&d.subject),"reason":label(d.reason)}})
        }
        Fact::Stale { diagnostic: d } => {
            json!({"state":"stale","diagnostic":{"fact":label(d.fact),"subject":subject(&d.subject),"expected":revision(d.expected),"observed":revision(d.observed)}})
        }
        Fact::Failed { diagnostic: d } => {
            json!({"state":"failed","diagnostic":{"fact":label(d.fact),"subject":subject(&d.subject),"reason":label(d.reason)}})
        }
    }
}
fn proof(v: &ProofIdentity) -> Value {
    json!({"entity":entity(&v.entity),"proof_revision":v.proof_revision.get(),"attempt":v.attempt.as_ref().map(attempt),
        "source_snapshot":v.source_snapshot.as_ref().map(|id|id.as_str()),"configuration":v.configuration.as_ref().map(|id|id.as_str()),
        "profile":{"profile_id":v.profile.profile_id.as_str(),"version":v.profile.version,"digest":v.profile.digest.as_str()},"policy_version":v.policy_version})
}
pub fn canonical_decision_facts_json(v: &DecisionInputs) -> Value {
    json!({
        "schema_version":"boreal.decision-facts.v1","subject":entity(&v.subject),"snapshot_revision":v.snapshot_revision.0,
        "clock":{"evaluated_at_ms":v.clock.evaluated_at.as_millis(),"next_change_at_ms":v.clock.next_change_at.map(|t|t.as_millis())},
        "availability":label(v.availability),
        "lifecycle":fact(&v.lifecycle,|f|json!({"identity":entity(&f.identity),"lifecycle":label(f.lifecycle),"terminal_decision":f.terminal_decision.as_ref().map(|d|match d{
            TerminalDecision::Closed{decided_at}=>json!({"kind":"closed","decided_at_ms":decided_at.as_millis()}),
            TerminalDecision::Cancelled{decided_at}=>json!({"kind":"cancelled","decided_at_ms":decided_at.as_millis()})})})),
        "authority":fact(&v.authority,|f|json!({"project_id":f.project_id.as_str(),"actor_id":f.actor_id().as_str(),"authority_root":f.authority_root.as_str(),"role":label(f.role),
            "session_id":f.session_id.as_ref().map(|id|id.as_str()),"principal":match &f.principal{
                PrincipalBinding::Authenticated{actor_id}=>json!({"kind":"authenticated","actor_id":actor_id.as_str()}),
                PrincipalBinding::Delegated{actor_id,delegation_id,delegator_id}=>json!({"kind":"delegated","actor_id":actor_id.as_str(),"delegation_id":delegation_id.as_str(),"delegator_id":delegator_id.as_str()})}})),
        "requirements":fact(&v.requirements,|f|json!({"proof":proof(&f.proof),"review_policy":label(f.review_policy),"requirements":f.requirements.iter().map(|r|json!({
            "requirement_id":r.id.as_str(),"gate_id":r.gate_id.as_str(),"kind":label(r.kind),"required":r.required,"state":label(r.state),
            "verifier_policy":{"id":r.verifier_policy.id.as_str(),"version":r.verifier_policy.version},"exception":r.exception.as_ref().map(|e|json!({
                "decision_id":e.id.as_str(),"reason":label(e.reason),"comment":e.comment,"actor_role":label(e.actor_role),"entity_revision":e.entity_revision.get(),
                "proof_revision":e.proof_revision.get(),"expires_at_ms":e.expires_at.map(|t|t.as_millis()),"revoked":e.revoked}))})).collect::<Vec<_>>()})),
        "dependencies":fact(&v.dependencies,|f|json!({"edges":f.edges.iter().map(|e|json!({"edge_id":e.id.as_str(),"predecessor":entity(&e.predecessor),"successor":entity(&e.successor),
            "policy":label(e.policy),"outcome":label(e.outcome),"outcome_revision":e.outcome_revision.get(),"waiver":e.waiver.as_ref().map(|w|json!({"decision_id":w.decision_id.as_str(),"edge_revision":w.edge_revision.get()}))})).collect::<Vec<_>>()})),
        "holds":fact(&v.holds,|f|json!({"holds":f.holds.iter().map(|h|json!({"id":h.id.as_str(),"scope":scope(&h.scope),"code":h.code.as_str(),"entity_revision":h.entity_revision.get(),"active":h.active})).collect::<Vec<_>>()})),
        "execution":fact(&v.execution,|f|json!({"attempt":attempt(&f.attempt),"actor_id":f.actor_id.as_str(),"session_id":f.session_id.as_ref().map(|id|id.as_str()),"phase":label(f.phase),
            "claimed_at_ms":f.claimed_at.as_millis(),"lease_deadline_ms":f.lease_deadline.as_millis(),"hard_deadline_ms":f.hard_deadline.as_millis(),"proof":proof(&f.proof)})),
        "submission":fact(&v.submission,|f|json!({"submission_id":f.id.as_str(),"actor_id":f.actor_id.as_str(),"session_id":f.session_id.as_str(),"authority_root":f.authority_root.as_str(),
            "proof":proof(&f.proof),"summary_digest":f.summary_digest.as_str(),"state":label(f.state)})),
        "review":fact(&v.review,|f|json!({"review_id":f.id.as_str(),"submission_id":f.submission_id.as_str(),"proof":proof(&f.proof),"reviewer_id":f.reviewer_id.as_str(),"attempt_actor_id":f.attempt_actor_id.as_str(),
            "reviewer_authority_root":f.reviewer_authority_root.as_str(),"attempt_authority_root":f.attempt_authority_root.as_str(),"outcome":label(f.outcome)})),
        "recovery":fact(&v.recovery,|f|json!({"recovery_id":f.id.as_str(),"attempt":attempt(&f.attempt),"reason":label(f.reason),"resource":label(f.resource),"unresolved":f.unresolved,"owner_id":f.owner_id.as_ref().map(|id|id.as_str())})),
        "integrity":{"scope":scope(&v.integrity.scope),"level":label(v.integrity.level),"diagnostics":v.integrity.diagnostics.iter().map(|d|json!({"scope":scope(&d.scope),"code":label(d.code)})).collect::<Vec<_>>()},
        "permitted_actions_input":{"allowed":v.permitted_actions.allowed.iter().map(label).collect::<Vec<_>>(),"denied":v.permitted_actions.denied.iter().map(|d|json!({"action":label(d.action),"reason":label(d.reason)})).collect::<Vec<_>>()}
    })
}

pub fn action_decision_json(
    decision: &boreal_domain::actions::ActionDecision,
    context_available: bool,
) -> Value {
    json!({
        "allowed": decision
            .allowed
            .iter()
            .map(|descriptor| action_descriptor_json(descriptor, context_available))
            .collect::<Vec<_>>(),
        "denied": decision
            .denied
            .iter()
            .map(|denied| {
                json!({
                    "descriptor": action_descriptor_json(&denied.descriptor, context_available),
                    "reason": {
                        "code": action_denial_code(&denied.reason),
                        "detail": action_denial_message(&denied.reason),
                        "diagnostic": format!("{:?}", denied.reason),
                    },
                    "reason_code": action_denial_code(&denied.reason),
                    "recovery": denied
                        .recovery
                        .iter()
                        .map(|action| action_kind_name(*action))
                        .collect::<Vec<_>>(),
                })
            })
            .collect::<Vec<_>>(),
    })
}

fn action_descriptor_json(
    descriptor: &boreal_domain::actions::ActionDescriptor,
    context_available: bool,
) -> Value {
    json!({
        "action": action_kind_name(descriptor.action),
        "target": {
            "project_id": descriptor.target.project_id.as_str(),
            "work_id": descriptor.target.work_id.as_str(),
            "entity_revision": context_available.then_some(descriptor.target.revision.get()),
        },
        "expected_project_revision": descriptor.expected_project_revision.0,
        "expected_entity_revision": context_available.then_some(descriptor.expected_entity_revision.get()),
        "expected_proof_revision": context_available.then(|| descriptor.expected_proof_revision.map(|revision| revision.get())).flatten(),
        "attempt": context_available.then(|| descriptor.attempt.as_ref().map(|attempt| json!({
            "attempt_id": attempt.attempt_id.as_str(),
            "fence": attempt.fence.get(),
        }))).flatten(),
        "required_roles": descriptor
            .required_roles
            .iter()
            .map(|role| actor_role_name(*role))
            .collect::<Vec<_>>(),
        "required_inputs": descriptor
            .required_inputs
            .iter()
            .map(|input| action_input_name(*input))
            .collect::<Vec<_>>(),
        "confirmation": descriptor.confirmation,
        "read_only": descriptor.read_only,
        "recovery": descriptor.recovery,
    })
}

pub fn action_kind_name(value: boreal_domain::actions::ActionKind) -> &'static str {
    use boreal_domain::actions::ActionKind::*;
    match value {
        Inspect => "inspect",
        ReadHistory => "read_history",
        ReadOperation => "read_operation",
        Export => "export",
        Publish => "publish",
        Claim => "claim",
        AcceptAttempt => "accept_attempt",
        StartAttempt => "start_attempt",
        Checkpoint => "checkpoint",
        AttachEvidence => "attach_evidence",
        Submit => "submit",
        RequestReview => "request_review",
        Review => "review",
        FinishClose => "finish_close",
        Close => "close",
        Stop => "stop",
        Release => "release",
        PausePolicy => "pause_policy",
        ResumePolicy => "resume_policy",
        Cancel => "cancel",
        Reopen => "reopen",
        Retry => "retry",
        RevokeReview => "revoke_review",
        RevokeException => "revoke_exception",
        ResolveHold => "resolve_hold",
        WaiveDependency => "waive_dependency",
        ForceGate => "force_gate",
        Recover => "recover",
        ReconcileResource => "reconcile_resource",
        Repair => "repair",
    }
}

pub fn action_input_name(value: boreal_domain::actions::ActionInputKind) -> &'static str {
    use boreal_domain::actions::ActionInputKind::*;
    match value {
        ExpectedProjectRevision => "expected_project_revision",
        ExpectedEntityRevision => "expected_entity_revision",
        ExpectedProofRevision => "expected_proof_revision",
        AttemptId => "attempt_id",
        Fence => "fence",
        SessionId => "session_id",
        OperationId => "operation_id",
        Confirmation => "confirmation",
        Reason => "reason",
        Comment => "comment",
        Evidence => "evidence",
        Summary => "summary",
        ReviewDecision => "review_decision",
        RecoveryDisposition => "recovery_disposition",
    }
}

pub fn actor_role_name(value: boreal_domain::ActorRole) -> &'static str {
    match value {
        boreal_domain::ActorRole::Agent => "agent",
        boreal_domain::ActorRole::Reviewer => "reviewer",
        boreal_domain::ActorRole::Operator => "operator",
        boreal_domain::ActorRole::Publisher => "publisher",
    }
}

pub fn action_denial_code(value: &boreal_domain::actions::ActionDenialReason) -> &'static str {
    use boreal_domain::actions::ActionDenialReason::*;
    match value {
        Unauthenticated => "unauthenticated",
        ScopeMismatch => "scope_mismatch",
        InvalidFacts => "invalid_facts",
        AvailabilityUnavailable(_) => "availability_unavailable",
        IntegrityQuarantined => "integrity_quarantined",
        IntegrityDegraded => "integrity_degraded",
        RoleDenied { .. } => "role_denied",
        DelegationInvalid => "delegation_invalid",
        PolicyDenied => "policy_denied",
        StatusDenied(_) => "status_denied",
        HoldActive(_) => "hold_active",
        StaleSnapshot { .. } => "stale_snapshot",
        StaleEntity { .. } => "stale_entity",
        StaleProof { .. } => "stale_proof",
        MissingAttempt => "attempt_missing",
        StaleFence { .. } => "stale_fence",
        AttemptOwnerMismatch => "attempt_owner_mismatch",
        AttemptPhaseDenied(_) => "attempt_phase_denied",
        MissingSubmission => "submission_missing",
        ReviewNotIndependent => "review_not_independent",
        RecoveryRequired => "recovery_required",
        NoActiveHold => "hold_missing",
        ActionNotApplicable => "action_not_applicable",
    }
}

fn action_denial_message(reason: &boreal_domain::actions::ActionDenialReason) -> &'static str {
    use boreal_domain::actions::ActionDenialReason::*;
    match reason {
        Unauthenticated => "Authenticate with a project credential before changing this work.",
        ScopeMismatch => "The request belongs to a different project or work item.",
        InvalidFacts | IntegrityQuarantined | IntegrityDegraded => {
            "Damaged or incomplete facts require inspection before this action is safe."
        }
        AvailabilityUnavailable(_) => {
            "The authoritative service is unavailable; reconnect and refresh before changing work."
        }
        RoleDenied { .. } | DelegationInvalid => {
            "Your project role or delegation does not authorize this action."
        }
        PolicyDenied | StatusDenied(_) | ActionNotApplicable => {
            "This action is not allowed for the current work state."
        }
        HoldActive(_) => "Resolve the recorded hold before continuing.",
        StaleSnapshot { .. } | StaleEntity { .. } | StaleProof { .. } | StaleFence { .. } => {
            "The work changed. Refresh and confirm against the new revision."
        }
        MissingAttempt | AttemptPhaseDenied(_) => {
            "This action requires an eligible execution attempt."
        }
        AttemptOwnerMismatch => {
            "Only the recorded attempt owner and session may perform this action."
        }
        MissingSubmission => "Seal an immutable submission before requesting review or closeout.",
        ReviewNotIndependent => {
            "A reviewer must be independent of the producer, including their delegation root."
        }
        RecoveryRequired => "Resolve the recorded recovery obligation before continuing.",
        NoActiveHold => "There is no active hold to resolve.",
    }
}
