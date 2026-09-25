//! PF-S03-T09 contract coverage for the domain decision/action seam.
//!
//! These tests deliberately stop at the pure-domain boundary.  They model the
//! adapter handoff that the application, service, and TUI must use, but do not
//! pretend to prove that those consumers already call this policy. The
//! role/policy vectors ensure status and action descriptors agree when both
//! are evaluated from the same typed fact snapshot.

use std::collections::BTreeSet;

use boreal_domain::actions::{
    all_action_kinds, evaluate_action, evaluate_actions, ActionAuthorization, ActionDenialReason,
    ActionEvaluationInput, ActionInputKind, ActionKind,
};
use boreal_domain::decision_inputs::*;
use boreal_domain::{
    evaluate_decision_actions, reject_derived_status_write, AcceptanceProfile, ActorContext,
    ActorId, ActorRole, AttemptId, AttemptPhase, ConfigIdentity, DecisionActionView,
    DecisionApiError, DecisionContextMismatch, DerivedStatus, DispatchPolicy, DomainError, GateId,
    GateKind, GateRequirement, GateState, PersistedLifecycle, ProfileId, ProjectId, ReasonCode,
    Revision, SessionId, SourceVersionId, StatusContext, TimestampMs, WorkId, WorkItem, WorkKind,
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
        dispatch_policy: DispatchPolicy::Automatic,
        lifecycle: Fact::present(LifecycleInput {
            identity: subject(),
            lifecycle: PersistedLifecycle::Open,
            terminal_decision: None,
        }),
        authority: Fact::present(ActorAuthorityInput {
            project_id: ProjectId::new("project-1"),
            authority_root: match &principal {
                PrincipalBinding::Authenticated { actor_id } => actor_id.clone(),
                PrincipalBinding::Delegated { delegator_id, .. } => delegator_id.clone(),
            },
            role,
            principal,
            session_id: Some(SessionId::new("session-1")),
        }),
        requirements: Fact::present(PinnedRequirementsInput {
            proof: proof(None),
            requirements: vec![PinnedRequirement {
                exception: None,
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

fn canonical_decision(
    facts: &DecisionInputs,
    dispatch_policy: DispatchPolicy,
) -> Result<DecisionActionView, DecisionApiError> {
    let (work, prerequisites, gates, actor) = context_parts(facts, dispatch_policy);
    evaluate_decision_actions(
        StatusContext::new(
            &work,
            &prerequisites,
            None,
            &gates,
            &actor,
            facts.clock.evaluated_at,
            facts.snapshot_revision,
        ),
        facts,
    )
}

fn context_parts(
    facts: &DecisionInputs,
    dispatch_policy: DispatchPolicy,
) -> (WorkItem, Vec<WorkItem>, Vec<GateRequirement>, ActorContext) {
    let requirements = facts
        .requirements
        .as_present()
        .expect("canonical fixture has pinned requirements");
    let gates = requirements
        .requirements
        .iter()
        .map(|requirement| GateRequirement {
            id: requirement.gate_id.clone(),
            kind: requirement.kind,
            required: requirement.required,
            state: requirement.state,
        })
        .collect::<Vec<_>>();
    let mut work = WorkItem::new(
        facts.subject.project_id.clone(),
        facts.subject.work_id.clone(),
        WorkKind::Task,
        None,
        "canonical API fixture",
    )
    .open();
    work.dispatch_policy = dispatch_policy;
    work.acceptance_profile = AcceptanceProfile {
        id: requirements.proof.profile.profile_id.clone(),
        version: requirements.proof.profile.version.clone(),
        gates: gates.clone(),
    };
    let authority = facts
        .authority
        .as_present()
        .expect("canonical fixture has actor authority");
    let actor = ActorContext {
        actor_id: authority.actor_id().clone(),
        role: authority.role,
    };
    (work, Vec::new(), gates, actor)
}

fn evaluate_parts<'a>(
    facts: &DecisionInputs,
    work: &'a WorkItem,
    prerequisites: &'a [WorkItem],
    current_attempt: Option<&'a boreal_domain::Attempt>,
    gates: &'a [GateRequirement],
    actor: &'a ActorContext,
    as_of: TimestampMs,
    revision: Revision,
) -> Result<DecisionActionView, DecisionApiError> {
    evaluate_decision_actions(
        StatusContext::new(
            work,
            prerequisites,
            current_attempt,
            gates,
            actor,
            as_of,
            revision,
        ),
        facts,
    )
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
fn canonical_dispatch_policy_changes_authority_without_rewriting_product_status() {
    let mut facts = facts(
        ActorRole::Agent,
        PrincipalBinding::Authenticated {
            actor_id: ActorId::new("agent-1"),
        },
    );
    facts.dispatch_policy = DispatchPolicy::OperatorOnly;
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
    facts.dispatch_policy = DispatchPolicy::OperatorOnly;
    facts.integrity.level = IntegrityLevel::Quarantined;
    facts.integrity.diagnostics.push(IntegrityDiagnostic {
        scope: IntegrityScope::work(ProjectId::new("project-1"), WorkId::new("work-1")),
        code: IntegrityDiagnosticCode::Corrupt,
    });
    let decision = canonical_decision(&facts, DispatchPolicy::OperatorOnly)
        .expect("quarantined facts remain diagnosable through the paired API");

    assert_eq!(decision.status.display_status, DerivedStatus::Blocked);
    assert!(decision.actions.allows(ActionKind::Repair));
    assert!(matches!(
        decision
            .actions
            .denial(ActionKind::Claim)
            .expect("claim denial")
            .reason,
        ActionDenialReason::IntegrityQuarantined
    ));
}

#[test]
fn paired_api_keeps_ready_status_when_degraded_integrity_denies_claim() {
    let mut facts = facts(
        ActorRole::Agent,
        PrincipalBinding::Authenticated {
            actor_id: ActorId::new("agent-1"),
        },
    );
    facts.integrity.level = IntegrityLevel::Degraded;
    facts.integrity.diagnostics.push(IntegrityDiagnostic {
        scope: IntegrityScope::work(ProjectId::new("project-1"), WorkId::new("work-1")),
        code: IntegrityDiagnosticCode::Stale,
    });

    let decision = canonical_decision(&facts, DispatchPolicy::Automatic)
        .expect("degraded facts still return a paired read decision");
    assert_eq!(decision.status.display_status, DerivedStatus::Ready);
    assert!(!decision.status.claimable_for_actor);
    assert!(matches!(
        decision
            .actions
            .denial(ActionKind::Claim)
            .map(|denied| &denied.reason),
        Some(ActionDenialReason::IntegrityDegraded)
    ));
}

#[test]
fn paired_api_keeps_repair_descriptor_when_integrity_facts_contradict() {
    let mut facts = facts(
        ActorRole::Operator,
        PrincipalBinding::Authenticated {
            actor_id: ActorId::new("operator-1"),
        },
    );
    // A valid level with a diagnostic is structurally inconsistent and must
    // remain visible as a repairable blocked decision, not erase recovery UI.
    facts.integrity.diagnostics.push(IntegrityDiagnostic {
        scope: IntegrityScope::work(ProjectId::new("project-1"), WorkId::new("work-1")),
        code: IntegrityDiagnosticCode::Corrupt,
    });

    let decision = canonical_decision(&facts, DispatchPolicy::Automatic)
        .expect("structural corruption still produces a safe paired view");
    assert_eq!(decision.status.display_status, DerivedStatus::Blocked);
    assert!(decision.actions.allows(ActionKind::Repair));
    assert!(matches!(
        decision
            .actions
            .denial(ActionKind::Claim)
            .map(|denied| &denied.reason),
        Some(ActionDenialReason::InvalidFacts)
    ));
}

#[test]
fn canonical_status_and_action_claimability_agree_for_roles_and_policies() {
    let roles = [
        (ActorRole::Agent, "agent-1"),
        (ActorRole::Operator, "operator-1"),
        (ActorRole::Reviewer, "reviewer-1"),
        (ActorRole::Publisher, "publisher-1"),
    ];

    for dispatch_policy in [DispatchPolicy::Automatic, DispatchPolicy::OperatorOnly] {
        for (role, actor_id) in roles {
            let mut facts = facts(
                role,
                PrincipalBinding::Authenticated {
                    actor_id: ActorId::new(actor_id),
                },
            );
            facts.dispatch_policy = dispatch_policy;
            let decision = canonical_decision(&facts, dispatch_policy)
                .expect("one canonical status/action view evaluates");
            let status = decision.status;
            let actions = decision.actions;
            let expected_claimability = match dispatch_policy {
                DispatchPolicy::Automatic => role == ActorRole::Agent,
                DispatchPolicy::OperatorOnly => role == ActorRole::Operator,
                DispatchPolicy::Paused => unreachable!("not exercised by this contract vector"),
            };
            let expected_required_role = match dispatch_policy {
                DispatchPolicy::Automatic => ActorRole::Agent,
                DispatchPolicy::OperatorOnly => ActorRole::Operator,
                DispatchPolicy::Paused => unreachable!("not exercised by this contract vector"),
            };

            assert_eq!(status.display_status, DerivedStatus::Ready);
            assert_eq!(status.claimable_for_actor, expected_claimability);
            assert_eq!(
                status.claimable_for_actor,
                actions.allows(ActionKind::Claim),
                "status and action decisions must agree for {role:?} under {dispatch_policy:?}"
            );
            if expected_claimability {
                assert!(actions.denial(ActionKind::Claim).is_none());
            } else {
                assert!(matches!(
                    actions.denial(ActionKind::Claim).map(|denied| &denied.reason),
                    Some(ActionDenialReason::RoleDenied { required, observed })
                        if required == &[expected_required_role] && *observed == role
                ));
            }
        }
    }
}

#[test]
fn paired_api_rejects_mismatched_subject_revision_clock_lifecycle_and_actor() {
    let facts = facts(
        ActorRole::Agent,
        PrincipalBinding::Authenticated {
            actor_id: ActorId::new("agent-1"),
        },
    );
    let (work, prerequisites, gates, actor) = context_parts(&facts, DispatchPolicy::Automatic);
    let evaluated_at = TimestampMs::from_millis(1_000);
    let revision = Revision(42);

    let mut wrong_subject = work.clone();
    wrong_subject.project_id = ProjectId::new("project-2");
    assert!(matches!(
        evaluate_parts(
            &facts,
            &wrong_subject,
            &prerequisites,
            None,
            &gates,
            &actor,
            evaluated_at,
            revision,
        ),
        Err(DecisionApiError::ContextMismatch(
            DecisionContextMismatch::Subject
        ))
    ));

    assert!(matches!(
        evaluate_parts(
            &facts,
            &work,
            &prerequisites,
            None,
            &gates,
            &actor,
            evaluated_at,
            Revision(43),
        ),
        Err(DecisionApiError::ContextMismatch(
            DecisionContextMismatch::ProjectRevision
        ))
    ));

    assert!(matches!(
        evaluate_parts(
            &facts,
            &work,
            &prerequisites,
            None,
            &gates,
            &actor,
            TimestampMs::from_millis(1_001),
            revision,
        ),
        Err(DecisionApiError::ContextMismatch(
            DecisionContextMismatch::Clock
        ))
    ));

    let mut wrong_lifecycle = work.clone();
    wrong_lifecycle.lifecycle = PersistedLifecycle::Draft;
    assert!(matches!(
        evaluate_parts(
            &facts,
            &wrong_lifecycle,
            &prerequisites,
            None,
            &gates,
            &actor,
            evaluated_at,
            revision,
        ),
        Err(DecisionApiError::ContextMismatch(
            DecisionContextMismatch::Lifecycle
        ))
    ));

    let mut wrong_dispatch_policy = work.clone();
    wrong_dispatch_policy.dispatch_policy = DispatchPolicy::OperatorOnly;
    assert!(matches!(
        evaluate_parts(
            &facts,
            &wrong_dispatch_policy,
            &prerequisites,
            None,
            &gates,
            &actor,
            evaluated_at,
            revision,
        ),
        Err(DecisionApiError::ContextMismatch(
            DecisionContextMismatch::DispatchPolicy
        ))
    ));

    let wrong_actor = ActorContext {
        actor_id: ActorId::new("agent-2"),
        role: ActorRole::Agent,
    };
    assert!(matches!(
        evaluate_parts(
            &facts,
            &work,
            &prerequisites,
            None,
            &gates,
            &wrong_actor,
            evaluated_at,
            revision,
        ),
        Err(DecisionApiError::ContextMismatch(
            DecisionContextMismatch::Actor
        ))
    ));
}

#[test]
fn paired_api_rejects_context_omitting_future_timing_constraints() {
    let base = facts(
        ActorRole::Agent,
        PrincipalBinding::Authenticated {
            actor_id: ActorId::new("agent-1"),
        },
    );
    let future = TimestampMs::from_millis(2_000);
    let timing_cases = [
        StatusTimingInput {
            schedule: Some(boreal_domain::work_model_v3::WorkSchedule {
                not_before_at: Some(future),
                due_at: None,
                target_start_at: None,
                target_end_at: None,
            }),
            ..StatusTimingInput::default()
        },
        StatusTimingInput {
            cycle_activation_at: Some(future),
            ..StatusTimingInput::default()
        },
        StatusTimingInput {
            retry_not_before: Some(future),
            ..StatusTimingInput::default()
        },
    ];

    for timing in timing_cases {
        let mut facts = base.clone();
        facts.clock = facts.clock.with_status_timing(timing);

        assert!(matches!(
            canonical_decision(&facts, DispatchPolicy::Automatic),
            Err(DecisionApiError::ContextMismatch(
                DecisionContextMismatch::Timing
            ))
        ));
    }
}

#[test]
fn paired_api_rejects_mismatched_profile_gates_dependencies_and_execution() {
    let facts = facts(
        ActorRole::Agent,
        PrincipalBinding::Authenticated {
            actor_id: ActorId::new("agent-1"),
        },
    );
    let (work, prerequisites, gates, actor) = context_parts(&facts, DispatchPolicy::Automatic);
    let evaluated_at = TimestampMs::from_millis(1_000);
    let revision = Revision(42);

    let mut wrong_profile = work.clone();
    wrong_profile.acceptance_profile.id = ProfileId::new("other-profile");
    assert!(matches!(
        evaluate_parts(
            &facts,
            &wrong_profile,
            &prerequisites,
            None,
            &gates,
            &actor,
            evaluated_at,
            revision,
        ),
        Err(DecisionApiError::ContextMismatch(
            DecisionContextMismatch::AcceptanceProfile
        ))
    ));

    assert!(matches!(
        evaluate_parts(
            &facts,
            &work,
            &prerequisites,
            None,
            &[],
            &actor,
            evaluated_at,
            revision,
        ),
        Err(DecisionApiError::ContextMismatch(
            DecisionContextMismatch::GateRequirements
        ))
    ));

    let extra_prerequisite = WorkItem::new(
        ProjectId::new("project-1"),
        WorkId::new("unbound-prerequisite"),
        WorkKind::Task,
        None,
        "unbound prerequisite",
    )
    .open();
    assert!(matches!(
        evaluate_parts(
            &facts,
            &work,
            &[extra_prerequisite],
            None,
            &gates,
            &actor,
            evaluated_at,
            revision,
        ),
        Err(DecisionApiError::ContextMismatch(
            DecisionContextMismatch::Dependencies
        ))
    ));

    let unexpected_attempt = boreal_domain::Attempt::claim(
        WorkId::new("work-1"),
        AttemptId::new("attempt-1"),
        ActorId::new("agent-1"),
        boreal_domain::Fence::new(1),
        TimestampMs::from_millis(10),
        Some(100),
        Some(200),
    )
    .expect("fixture attempt");
    assert!(matches!(
        evaluate_parts(
            &facts,
            &work,
            &prerequisites,
            Some(&unexpected_attempt),
            &gates,
            &actor,
            evaluated_at,
            revision,
        ),
        Err(DecisionApiError::ContextMismatch(
            DecisionContextMismatch::Execution
        ))
    ));
}

#[test]
fn every_derived_status_is_rejected_by_the_public_persistence_guard() {
    let statuses = [
        DerivedStatus::Draft,
        DerivedStatus::Queued,
        DerivedStatus::Ready,
        DerivedStatus::Claimed,
        DerivedStatus::InProgress,
        DerivedStatus::NeedsVerification,
        DerivedStatus::AwaitingReview,
        DerivedStatus::Complete,
        DerivedStatus::Closed,
        DerivedStatus::Blocked,
        DerivedStatus::Paused,
        DerivedStatus::RetryWait,
        DerivedStatus::Scheduled,
        DerivedStatus::ExpiredReview,
        DerivedStatus::Cancelled,
    ];

    for status in statuses {
        assert_eq!(
            reject_derived_status_write(status),
            Err(DomainError::DerivedStatusReadOnly { status }),
            "derived status {status:?} must not be persisted as lifecycle state"
        );
    }
}
