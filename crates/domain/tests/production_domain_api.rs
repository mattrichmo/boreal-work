//! PF-S03-T09 contract coverage for the domain decision/action seam.
//!
//! These tests deliberately stop at the pure-domain boundary.  They model the
//! adapter handoff that the application, service, and TUI must use, but do not
//! pretend to prove that those consumers already call this policy.  The
//! ignored operator vector is a retained executable witness for PF-S03-R7:
//! the current status evaluator and action role table disagree for ordinary
//! operator claimability.

use std::collections::BTreeSet;

use boreal_domain::actions::{
    all_action_kinds, evaluate_action, evaluate_actions, ActionAuthorization, ActionDenialReason,
    ActionEvaluationInput, ActionInputKind, ActionKind,
};
use boreal_domain::decision_inputs::*;
use boreal_domain::{
    evaluate_status, ActorContext, ActorId, ActorRole, AttemptId, AttemptPhase, ConfigIdentity,
    DerivedStatus, GateId, GateKind, GateState, PersistedLifecycle, ProfileId, ProjectId,
    ReasonCode, Revision, SessionId, SourceVersionId, StatusContext, TimestampMs, WorkId, WorkItem,
    WorkKind,
};

fn subject() -> EntityIdentity {
    EntityIdentity::new(
        ProjectId::new("project-1"),
        WorkId::new("work-1"),
        EntityRevision::new(7),
    )
}

fn attempt(fence: u64) -> AttemptIdentity {
    AttemptIdentity::new(AttemptId::new("attempt-1"), AttemptFence::new(fence))
}

fn proof(current_attempt: Option<AttemptIdentity>) -> ProofIdentity {
    ProofIdentity::new(
        subject(),
        ProofRevision::new(11),
        current_attempt,
        SourceVersionId::new("source-1"),
        ConfigIdentity::new("config-1"),
        ProfileIdentity::new(
            ProfileId::new("focused"),
            "1",
            ContentDigest::new("sha256:profile"),
        ),
        "policy-1",
    )
}

fn permitted() -> PermittedActionsInput {
    PermittedActionsInput::allowing([
        PermittedAction::Inspect,
        PermittedAction::Claim,
        PermittedAction::AcceptAttempt,
        PermittedAction::ResumeAttempt,
        PermittedAction::AttachEvidence,
        PermittedAction::Submit,
        PermittedAction::Review,
        PermittedAction::Finish,
        PermittedAction::Release,
        PermittedAction::Recover,
        PermittedAction::ResolveHold,
        PermittedAction::Repair,
    ])
}

fn facts(role: ActorRole, principal: PrincipalBinding) -> DecisionInputs {
    DecisionInputs {
        subject: subject(),
        snapshot_revision: Revision(42),
        clock: EvaluationClock::at(TimestampMs::from_millis(1_000)),
        availability: Availability::Live,
        lifecycle: Fact::present(LifecycleInput {
            identity: subject(),
            lifecycle: PersistedLifecycle::Open,
            terminal_decision: None,
        }),
        authority: Fact::present(ActorAuthorityInput {
            project_id: ProjectId::new("project-1"),
            role,
            principal,
            session_id: Some(SessionId::new("session-1")),
        }),
        requirements: Fact::present(PinnedRequirementsInput {
            proof: proof(None),
            requirements: vec![PinnedRequirement {
                id: RequirementId::new("requirement-1"),
                gate_id: GateId::new("verification"),
                kind: GateKind::Verification,
                required: true,
                state: GateState::Satisfied,
                verifier_policy: VerifierPolicy {
                    id: VerifierPolicyId::new("rust-test"),
                    version: "1".to_owned(),
                },
            }],
            review_policy: ReviewRequirementPolicy::NotRequired,
        }),
        dependencies: Fact::present(DependencyOutcomesInput { edges: Vec::new() }),
        holds: Fact::present(HoldsInput { holds: Vec::new() }),
        execution: Fact::optional_absent(
            FactKind::Execution,
            FactSubject::work(ProjectId::new("project-1"), WorkId::new("work-1")),
        ),
        submission: Fact::optional_absent(
            FactKind::Submission,
            FactSubject::work(ProjectId::new("project-1"), WorkId::new("work-1")),
        ),
        review: Fact::optional_absent(
            FactKind::Review,
            FactSubject::work(ProjectId::new("project-1"), WorkId::new("work-1")),
        ),
        recovery: Fact::optional_absent(
            FactKind::Recovery,
            FactSubject::work(ProjectId::new("project-1"), WorkId::new("work-1")),
        ),
        integrity: IntegrityInput {
            scope: IntegrityScope::work(ProjectId::new("project-1"), WorkId::new("work-1")),
            level: IntegrityLevel::Valid,
            diagnostics: Vec::new(),
        },
        permitted_actions: permitted(),
    }
}

fn running_facts() -> DecisionInputs {
    let current = attempt(4);
    let mut facts = facts(
        ActorRole::Agent,
        PrincipalBinding::Authenticated {
            actor_id: ActorId::new("agent-1"),
        },
    );
    facts.requirements = Fact::present(PinnedRequirementsInput {
        proof: proof(Some(current.clone())),
        requirements: Vec::new(),
        review_policy: ReviewRequirementPolicy::NotRequired,
    });
    facts.execution = Fact::present(ExecutionInput {
        attempt: current.clone(),
        actor_id: ActorId::new("agent-1"),
        session_id: Some(SessionId::new("session-1")),
        phase: AttemptPhase::Running,
        claimed_at: TimestampMs::from_millis(10),
        lease_deadline: TimestampMs::from_millis(20_000),
        hard_deadline: TimestampMs::from_millis(30_000),
        proof: proof(Some(current)),
    });
    facts
}

#[test]
fn public_action_descriptors_preserve_subject_status_reason_and_revisions() {
    let facts = facts(
        ActorRole::Agent,
        PrincipalBinding::Authenticated {
            actor_id: ActorId::new("agent-1"),
        },
    );
    let reasons = [ReasonCode::Eligible];
    let input = ActionEvaluationInput::new(&facts, DerivedStatus::Ready, &reasons);
    let decision = evaluate_actions(&input);
    let claim = decision
        .allowed
        .iter()
        .find(|descriptor| descriptor.action == ActionKind::Claim)
        .expect("ready agent claim descriptor");

    assert_eq!(claim.target, facts.subject);
    assert_eq!(claim.expected_project_revision, Revision(42));
    assert_eq!(claim.expected_entity_revision, EntityRevision::new(7));
    assert_eq!(claim.required_roles, vec![ActorRole::Agent]);
    assert!(claim
        .required_inputs
        .contains(&ActionInputKind::ExpectedProjectRevision));
    assert!(claim
        .required_inputs
        .contains(&ActionInputKind::ExpectedEntityRevision));
    assert!(claim
        .required_inputs
        .contains(&ActionInputKind::OperationId));
    assert!(matches!(
        evaluate_action(&input, &claim.request()),
        ActionAuthorization::Allowed(_)
    ));
}

#[test]
fn every_descriptor_round_trips_without_losing_authority_context() {
    let facts = facts(
        ActorRole::Agent,
        PrincipalBinding::Authenticated {
            actor_id: ActorId::new("agent-1"),
        },
    );
    let reasons = [ReasonCode::Eligible];
    let input = ActionEvaluationInput::new(&facts, DerivedStatus::Ready, &reasons);
    let decision = evaluate_actions(&input);
    let represented = decision
        .allowed
        .iter()
        .map(|descriptor| descriptor.action)
        .chain(
            decision
                .denied
                .iter()
                .map(|denied| denied.descriptor.action),
        )
        .collect::<BTreeSet<_>>();

    assert_eq!(represented, all_action_kinds().iter().copied().collect());
    for descriptor in &decision.allowed {
        assert!(matches!(
            evaluate_action(&input, &descriptor.request()),
            ActionAuthorization::Allowed(_)
        ));
    }
    for denied in &decision.denied {
        let replay = evaluate_action(&input, &denied.descriptor.request());
        assert!(matches!(replay, ActionAuthorization::Denied(_)));
        if let ActionAuthorization::Denied(replayed) = replay {
            assert_eq!(replayed.reason, denied.reason);
            assert_eq!(replayed.descriptor, denied.descriptor);
        }
    }
}

#[test]
fn status_reason_changes_authority_without_rewriting_product_status() {
    let facts = facts(
        ActorRole::Agent,
        PrincipalBinding::Authenticated {
            actor_id: ActorId::new("agent-1"),
        },
    );
    let reasons = [ReasonCode::OperatorOnly];
    let input = ActionEvaluationInput::new(&facts, DerivedStatus::Ready, &reasons);
    let decision = evaluate_actions(&input);
    let claim = decision.denial(ActionKind::Claim).expect("claim denial");

    assert_eq!(claim.descriptor.expected_project_revision, Revision(42));
    assert_eq!(claim.descriptor.target, facts.subject);
    assert_eq!(claim.descriptor.required_roles, vec![ActorRole::Operator]);
    match &claim.reason {
        ActionDenialReason::RoleDenied { required, observed } => {
            assert_eq!(required.as_slice(), [ActorRole::Operator]);
            assert_eq!(*observed, ActorRole::Agent);
        }
        other => panic!("expected role denial, got {other:?}"),
    }
}

#[test]
fn blocked_reason_keeps_safe_recovery_actions_and_revision_bindings() {
    let mut facts = running_facts();
    facts.holds = Fact::present(HoldsInput {
        holds: vec![HoldInput {
            id: HoldId::new("hold-1"),
            scope: IntegrityScope::work(ProjectId::new("project-1"), WorkId::new("work-1")),
            code: HoldCode::new("operator_decision_required"),
            entity_revision: EntityRevision::new(7),
            active: true,
        }],
    });
    let reasons = [ReasonCode::HardHold(
        "operator_decision_required".to_owned(),
    )];
    let input = ActionEvaluationInput::new(&facts, DerivedStatus::Blocked, &reasons);
    let decision = evaluate_actions(&input);
    let claim = decision.denial(ActionKind::Claim).expect("claim denial");
    let stop = decision
        .allowed
        .iter()
        .find(|descriptor| descriptor.action == ActionKind::Stop)
        .expect("safe stop descriptor");

    assert_eq!(
        claim.reason,
        ActionDenialReason::HoldActive(HoldCode::new("operator_decision_required"))
    );
    assert_eq!(claim.descriptor.target, facts.subject);
    assert_eq!(claim.descriptor.expected_project_revision, Revision(42));
    assert!(stop.recovery);
    assert_eq!(stop.target, facts.subject);
    assert_eq!(stop.expected_entity_revision, EntityRevision::new(7));
}

#[test]
fn stale_descriptor_context_is_denied_at_the_action_boundary() {
    let facts = running_facts();
    let reasons = [ReasonCode::AttemptActive];
    let input = ActionEvaluationInput::new(&facts, DerivedStatus::InProgress, &reasons);
    let evidence = evaluate_actions(&input)
        .allowed
        .into_iter()
        .find(|descriptor| descriptor.action == ActionKind::AttachEvidence)
        .expect("evidence descriptor");

    let mut stale_project = evidence.request();
    stale_project.expected_project_revision = Revision(41);
    assert!(matches!(
        evaluate_action(&input, &stale_project),
        ActionAuthorization::Denied(denied)
            if matches!(denied.reason, ActionDenialReason::StaleSnapshot { .. })
    ));

    let mut stale_entity = evidence.request();
    stale_entity.target.revision = EntityRevision::new(6);
    assert!(matches!(
        evaluate_action(&input, &stale_entity),
        ActionAuthorization::Denied(denied)
            if matches!(denied.reason, ActionDenialReason::StaleEntity { .. })
    ));

    let mut stale_proof = evidence.request();
    stale_proof.expected_proof_revision = Some(ProofRevision::new(10));
    assert!(matches!(
        evaluate_action(&input, &stale_proof),
        ActionAuthorization::Denied(denied)
            if matches!(denied.reason, ActionDenialReason::StaleProof { .. })
    ));

    let mut stale_fence = evidence.request();
    stale_fence.attempt = Some(attempt(5));
    assert!(matches!(
        evaluate_action(&input, &stale_fence),
        ActionAuthorization::Denied(denied)
            if matches!(denied.reason, ActionDenialReason::StaleFence { .. })
    ));
}

#[test]
fn quarantined_integrity_exposes_repair_but_denies_forward_progress() {
    let mut facts = facts(
        ActorRole::Operator,
        PrincipalBinding::Authenticated {
            actor_id: ActorId::new("operator-1"),
        },
    );
    facts.integrity.level = IntegrityLevel::Quarantined;
    facts.integrity.diagnostics.push(IntegrityDiagnostic {
        scope: IntegrityScope::work(ProjectId::new("project-1"), WorkId::new("work-1")),
        code: IntegrityDiagnosticCode::Corrupt,
    });
    let reasons = [ReasonCode::HardHold("integrity_quarantined".to_owned())];
    let input = ActionEvaluationInput::new(&facts, DerivedStatus::Blocked, &reasons);
    let decision = evaluate_actions(&input);

    assert!(decision.allows(ActionKind::Repair));
    assert!(matches!(
        decision
            .denial(ActionKind::Claim)
            .expect("claim denial")
            .reason,
        ActionDenialReason::IntegrityQuarantined
    ));
}

#[test]
#[ignore = "PF-S03-R7: coordinator must reconcile ordinary Operator claim semantics"]
fn ordinary_operator_status_and_action_claimability_are_one_contract() {
    let work = WorkItem::new(
        ProjectId::new("project-1"),
        WorkId::new("work-1"),
        WorkKind::Task,
        None,
        "task",
    )
    .open();
    let prerequisites = Vec::new();
    let gates = work.acceptance_profile.gates.clone();
    let actor = ActorContext {
        actor_id: ActorId::new("operator-1"),
        role: ActorRole::Operator,
    };
    let status = evaluate_status(StatusContext::new(
        &work,
        &prerequisites,
        None,
        &gates,
        &actor,
        TimestampMs::from_millis(1_000),
        Revision(42),
    ));
    let facts = facts(
        ActorRole::Operator,
        PrincipalBinding::Authenticated {
            actor_id: ActorId::new("operator-1"),
        },
    );
    let actions = evaluate_actions(&ActionEvaluationInput::new(
        &facts,
        status.display_status,
        &status.reason_codes,
    ));

    assert_eq!(status.display_status, DerivedStatus::Ready);
    assert_eq!(
        status.claimable_for_actor,
        actions.allows(ActionKind::Claim),
        "status and action projections must agree for the same actor and facts"
    );
}
