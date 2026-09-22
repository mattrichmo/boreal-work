//! Focused pure-domain authorization coverage for PF-S03-T06.
//!
use boreal_domain::actions::{
    evaluate_action, evaluate_actions, ActionAuthorization, ActionDecision, ActionDenialReason,
    ActionEvaluationInput, ActionInputKind, ActionKind,
};
use boreal_domain::decision_inputs::*;
use boreal_domain::{
    ActorId, ActorRole, AttemptId, AttemptPhase, ConfigIdentity, DerivedStatus, GateId, GateKind,
    GateState, PersistedLifecycle, ProfileId, ProjectId, ReasonCode, Revision, SessionId,
    SourceVersionId, TimestampMs, WorkId,
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
        snapshot_revision: Revision(12),
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

fn input<'a>(
    facts: &'a DecisionInputs,
    status: DerivedStatus,
    reasons: &'a [ReasonCode],
) -> ActionEvaluationInput<'a> {
    ActionEvaluationInput::new(facts, status, reasons)
}

fn decision(
    facts: &DecisionInputs,
    status: DerivedStatus,
    reasons: &[ReasonCode],
) -> ActionDecision {
    evaluate_actions(&input(facts, status, reasons))
}

fn denial(
    facts: &DecisionInputs,
    status: DerivedStatus,
    reasons: &[ReasonCode],
    action: ActionKind,
) -> ActionDenialReason {
    let all = decision(facts, status, reasons);
    all.denial(action)
        .unwrap_or_else(|| panic!("expected {action:?} to be denied"))
        .reason
        .clone()
}

#[test]
fn descriptors_are_complete_and_stably_ordered() {
    let facts = facts(
        ActorRole::Agent,
        PrincipalBinding::Authenticated {
            actor_id: ActorId::new("agent-1"),
        },
    );
    let reasons = [ReasonCode::Eligible];
    let result = decision(&facts, DerivedStatus::Ready, &reasons);

    assert_eq!(
        result
            .allowed
            .iter()
            .map(|item| item.action)
            .collect::<Vec<_>>(),
        vec![
            ActionKind::Inspect,
            ActionKind::ReadHistory,
            ActionKind::ReadOperation,
            ActionKind::Export,
            ActionKind::Claim,
        ]
    );
    assert_eq!(result.denied.len(), 22);
    assert!(result
        .allowed
        .iter()
        .all(|descriptor| descriptor.target == subject()));
    let claim = result
        .allowed
        .iter()
        .find(|descriptor| descriptor.action == ActionKind::Claim)
        .expect("claim descriptor");
    assert_eq!(claim.expected_project_revision, Revision(12));
    assert_eq!(claim.expected_entity_revision, EntityRevision::new(7));
    assert!(claim
        .required_inputs
        .contains(&ActionInputKind::OperationId));
}

#[test]
fn ready_actor_denial_is_actor_specific_not_a_blocked_status() {
    let facts = facts(
        ActorRole::Reviewer,
        PrincipalBinding::Authenticated {
            actor_id: ActorId::new("reviewer-1"),
        },
    );
    let reasons = [ReasonCode::Eligible];
    let result = decision(&facts, DerivedStatus::Ready, &reasons);

    assert!(!result.allows(ActionKind::Claim));
    assert_eq!(
        denial(&facts, DerivedStatus::Ready, &reasons, ActionKind::Claim).stable_code(),
        "role_denied"
    );
    assert_eq!(
        result.denial(ActionKind::Claim).unwrap().recovery,
        vec![ActionKind::Inspect, ActionKind::ReadHistory]
    );
}

#[test]
fn blocked_work_denies_claim_and_close_but_allows_owner_stop() {
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
    let result = decision(&facts, DerivedStatus::Blocked, &reasons);

    assert!(!result.allows(ActionKind::Claim));
    assert!(!result.allows(ActionKind::Close));
    assert!(result.allows(ActionKind::Stop));
    assert_eq!(
        denial(&facts, DerivedStatus::Blocked, &reasons, ActionKind::Claim).stable_code(),
        "hold_active"
    );
    let stop = result
        .allowed
        .iter()
        .find(|descriptor| descriptor.action == ActionKind::Stop)
        .expect("safe stop descriptor");
    assert_eq!(stop.attempt, Some(attempt(4)));
    assert!(stop.recovery);

    let mut reordered = facts.clone();
    if let Fact::Present(holds) = &mut reordered.holds {
        holds.holds.push(HoldInput {
            id: HoldId::new("hold-0"),
            scope: IntegrityScope::work(ProjectId::new("project-1"), WorkId::new("work-1")),
            code: HoldCode::new("a_recovery_hold"),
            entity_revision: EntityRevision::new(7),
            active: true,
        });
        holds.holds.reverse();
    }
    let mut original = facts.clone();
    if let Fact::Present(holds) = &mut original.holds {
        holds.holds.push(HoldInput {
            id: HoldId::new("hold-0"),
            scope: IntegrityScope::work(ProjectId::new("project-1"), WorkId::new("work-1")),
            code: HoldCode::new("a_recovery_hold"),
            entity_revision: EntityRevision::new(7),
            active: true,
        });
    }
    assert_eq!(
        denial(
            &reordered,
            DerivedStatus::Blocked,
            &reasons,
            ActionKind::Claim
        ),
        denial(
            &original,
            DerivedStatus::Blocked,
            &reasons,
            ActionKind::Claim
        )
    );
}

#[test]
fn revision_and_fence_are_required_again_at_mutation_boundary() {
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
        phase: AttemptPhase::Claimed,
        claimed_at: TimestampMs::from_millis(10),
        lease_deadline: TimestampMs::from_millis(20_000),
        hard_deadline: TimestampMs::from_millis(30_000),
        proof: proof(Some(current)),
    });
    let reasons = [ReasonCode::AttemptUnaccepted];
    let policy = input(&facts, DerivedStatus::Claimed, &reasons);
    let descriptor = evaluate_actions(&policy)
        .allowed
        .into_iter()
        .find(|item| item.action == ActionKind::Inspect)
        .expect("inspect descriptor");

    let mut stale_snapshot = descriptor.request();
    stale_snapshot.action = ActionKind::AcceptAttempt;
    stale_snapshot.expected_project_revision = Revision(11);
    assert!(matches!(
        evaluate_action(&policy, &stale_snapshot),
        ActionAuthorization::Denied(denied)
            if matches!(denied.reason, ActionDenialReason::StaleSnapshot { .. })
    ));

    let accept_descriptor = evaluate_actions(&policy)
        .allowed
        .into_iter()
        .find(|item| item.action == ActionKind::AcceptAttempt)
        .expect("accept action");
    let mut stale_fence = accept_descriptor.request();
    stale_fence.attempt = Some(attempt(5));
    assert!(matches!(
        evaluate_action(&policy, &stale_fence),
        ActionAuthorization::Denied(denied)
            if matches!(denied.reason, ActionDenialReason::StaleFence { .. })
    ));

    let mut stale_entity = accept_descriptor.request();
    stale_entity.target.revision = EntityRevision::new(6);
    assert!(matches!(
        evaluate_action(&policy, &stale_entity),
        ActionAuthorization::Denied(denied)
            if matches!(denied.reason, ActionDenialReason::StaleEntity { .. })
    ));
}

#[test]
fn foreign_scope_and_invalid_delegation_fail_closed() {
    let mut facts = facts(
        ActorRole::Agent,
        PrincipalBinding::Authenticated {
            actor_id: ActorId::new("agent-1"),
        },
    );
    let reasons = [ReasonCode::Eligible];
    let policy = input(&facts, DerivedStatus::Ready, &reasons);
    let mut foreign = evaluate_actions(&policy)
        .allowed
        .iter()
        .find(|descriptor| descriptor.action == ActionKind::Claim)
        .expect("claim descriptor")
        .request();
    foreign.target = EntityIdentity::new(
        ProjectId::new("other-project"),
        WorkId::new("work-1"),
        EntityRevision::new(7),
    );
    assert!(matches!(
        evaluate_action(&policy, &foreign),
        ActionAuthorization::Denied(denied)
            if denied.reason == ActionDenialReason::ScopeMismatch
    ));

    let request = evaluate_actions(&policy)
        .allowed
        .iter()
        .find(|descriptor| descriptor.action == ActionKind::Claim)
        .expect("claim descriptor")
        .request();

    facts.authority = Fact::present(ActorAuthorityInput {
        project_id: ProjectId::new("project-1"),
        role: ActorRole::Agent,
        principal: PrincipalBinding::Delegated {
            actor_id: ActorId::new("agent-1"),
            delegation_id: DelegationId::new(""),
            delegator_id: ActorId::new("operator-1"),
        },
        session_id: Some(SessionId::new("session-1")),
    });
    let invalid_delegation = input(&facts, DerivedStatus::Ready, &reasons);
    assert!(matches!(
        evaluate_action(&invalid_delegation, &request),
        ActionAuthorization::Denied(denied)
            if denied.reason == ActionDenialReason::DelegationInvalid
    ));
}

#[test]
fn operator_only_ready_work_requires_operator_without_changing_status() {
    let facts = facts(
        ActorRole::Agent,
        PrincipalBinding::Authenticated {
            actor_id: ActorId::new("agent-1"),
        },
    );
    let reasons = [ReasonCode::OperatorOnly];
    let result = decision(&facts, DerivedStatus::Ready, &reasons);

    assert!(!result.allows(ActionKind::Claim));
    assert!(matches!(
        denial(&facts, DerivedStatus::Ready, &reasons, ActionKind::Claim),
        ActionDenialReason::RoleDenied { .. }
    ));
}

#[test]
fn quarantined_scope_exposes_repair_but_denies_forward_progress() {
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
    let result = decision(&facts, DerivedStatus::Blocked, &reasons);

    assert!(result.allows(ActionKind::Repair));
    assert!(matches!(
        denial(&facts, DerivedStatus::Blocked, &reasons, ActionKind::Claim),
        ActionDenialReason::IntegrityQuarantined
    ));
}
