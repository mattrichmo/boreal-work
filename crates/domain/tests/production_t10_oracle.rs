//! PF-S03-T10 deterministic oracle coverage.
//!
//! This target is intentionally pure-domain. It exercises the current public
//! decision, transition, dependency, and action APIs without pretending that
//! a store transaction, operation journal, or service adapter has been proved.

use boreal_domain::actions::{
    evaluate_actions, ActionDenialReason, ActionEvaluationInput, ActionKind,
};
use boreal_domain::decision_inputs::*;
use boreal_domain::dependencies::{
    evaluate_dependencies, validate_dependency_graph, ClosedOutcome, DependencyEdge,
    DependencyEndpoint, DependencyEndpointKind, DependencyObservation, EdgeSatisfaction,
    EdgeSatisfaction as DependencySatisfaction, EdgeWaiver, UpstreamOutcome,
};
use boreal_domain::{
    evaluate_status, transition_attempt, ActorContext, ActorId, ActorRole, Attempt, AttemptId,
    AttemptOperation, AttemptPhase, ConfigIdentity, DerivedStatus, DispatchPolicy, DomainAction,
    Fence, GateId, GateKind, GateState, PersistedLifecycle, ProjectId, ReasonCode, Revision,
    SessionId, StatusContext, TimestampMs, WorkId, WorkItem, WorkKind,
};

#[derive(Clone)]
struct StatusVector {
    name: &'static str,
    lifecycle: PersistedLifecycle,
    hard_hold: bool,
    open_prerequisite: bool,
    attempt: Option<AttemptPhase>,
    as_of: u64,
    activation_at: Option<u64>,
    expected_status: DerivedStatus,
    expected_reason: ReasonCode,
}

fn status_vector(vector: StatusVector) -> boreal_domain::StatusDecision {
    let mut work = WorkItem::new(
        ProjectId::new("project-1"),
        WorkId::new("work-1"),
        WorkKind::Task,
        None,
        vector.name,
    );
    work.lifecycle = vector.lifecycle;
    work.dispatch_policy = DispatchPolicy::Automatic;
    if vector.hard_hold {
        work.hard_holds
            .push(ReasonCode::HardHold("operator_decision_required".into()));
    }

    let prerequisites = if vector.open_prerequisite {
        vec![WorkItem::new(
            ProjectId::new("project-1"),
            WorkId::new("upstream-1"),
            WorkKind::Task,
            None,
            "upstream",
        )
        .open()]
    } else {
        Vec::new()
    };

    let mut attempt = vector.attempt.map(|phase| {
        let mut attempt = Attempt::claim(
            WorkId::new("work-1"),
            AttemptId::new("attempt-1"),
            ActorId::new("agent-1"),
            Fence::new(1),
            TimestampMs::from_millis(0),
            Some(100),
            Some(200),
        )
        .expect("oracle attempt deadlines are valid");
        attempt.phase = phase;
        attempt
    });
    let actor = ActorContext {
        actor_id: ActorId::new("agent-1"),
        role: ActorRole::Agent,
    };
    let gates = work.acceptance_profile.gates.clone();
    let mut context = StatusContext::new(
        &work,
        &prerequisites,
        attempt.as_ref(),
        &gates,
        &actor,
        TimestampMs::from_millis(vector.as_of),
        Revision(19),
    );
    context.activation_at = vector.activation_at.map(TimestampMs::from_millis);
    let decision = evaluate_status(context);
    assert_eq!(
        decision.display_status, vector.expected_status,
        "{}",
        vector.name
    );
    assert_eq!(
        decision.primary_reason, vector.expected_reason,
        "{}",
        vector.name
    );
    if let Some(attempt) = attempt.as_mut() {
        // Keep the local ownership explicit. This prevents a future fixture
        // change from accidentally evaluating a different attempt subject.
        assert_eq!(attempt.work_id, WorkId::new("work-1"));
    }
    decision
}

fn permuted_expiry_status(reverse: bool) -> boreal_domain::StatusDecision {
    let mut work = WorkItem::new(
        ProjectId::new("project-1"),
        WorkId::new("work-1"),
        WorkKind::Task,
        None,
        "permuted expiry",
    )
    .open();
    work.hard_holds = vec![
        ReasonCode::HardHold("resource_reconciliation_required".into()),
        ReasonCode::HardHold("operator_decision_required".into()),
    ];
    let mut prerequisites = vec![
        WorkItem::new(
            ProjectId::new("project-1"),
            WorkId::new("upstream-z"),
            WorkKind::Task,
            None,
            "upstream z",
        )
        .open(),
        WorkItem::new(
            ProjectId::new("project-1"),
            WorkId::new("upstream-a"),
            WorkKind::Task,
            None,
            "upstream a",
        )
        .open(),
    ];
    if reverse {
        work.hard_holds.reverse();
        prerequisites.reverse();
    }
    let mut attempt = Attempt::claim(
        WorkId::new("work-1"),
        AttemptId::new("attempt-1"),
        ActorId::new("agent-1"),
        Fence::new(1),
        TimestampMs::from_millis(0),
        Some(100),
        Some(200),
    )
    .expect("permutation attempt deadlines are valid");
    attempt.phase = AttemptPhase::Running;
    let actor = ActorContext {
        actor_id: ActorId::new("agent-1"),
        role: ActorRole::Agent,
    };
    let gates = work.acceptance_profile.gates.clone();
    evaluate_status(StatusContext::new(
        &work,
        &prerequisites,
        Some(&attempt),
        &gates,
        &actor,
        TimestampMs::from_millis(200),
        Revision(19),
    ))
}

#[test]
fn precedence_vectors_are_table_driven_and_secondary_reasons_survive() {
    let vectors = [
        StatusVector {
            name: "terminal wins over every nonterminal fact",
            lifecycle: PersistedLifecycle::Closed,
            hard_hold: true,
            open_prerequisite: true,
            attempt: Some(AttemptPhase::Running),
            as_of: 200,
            activation_at: Some(500),
            expected_status: DerivedStatus::Closed,
            expected_reason: ReasonCode::TerminalClosed,
        },
        StatusVector {
            name: "expiry wins over hold and prerequisite",
            lifecycle: PersistedLifecycle::Open,
            hard_hold: true,
            open_prerequisite: true,
            attempt: Some(AttemptPhase::Running),
            as_of: 200,
            activation_at: Some(500),
            expected_status: DerivedStatus::ExpiredReview,
            expected_reason: ReasonCode::ExpiryReviewRequired,
        },
        StatusVector {
            name: "hard intervention is not ordinary queueing",
            lifecycle: PersistedLifecycle::Open,
            hard_hold: true,
            open_prerequisite: true,
            attempt: None,
            as_of: 10,
            activation_at: None,
            expected_status: DerivedStatus::Blocked,
            expected_reason: ReasonCode::HardHold("operator_decision_required".into()),
        },
        StatusVector {
            name: "open prerequisite is queued",
            lifecycle: PersistedLifecycle::Open,
            hard_hold: false,
            open_prerequisite: true,
            attempt: None,
            as_of: 10,
            activation_at: None,
            expected_status: DerivedStatus::Queued,
            expected_reason: ReasonCode::PrerequisiteOpen(WorkId::new("upstream-1")),
        },
        StatusVector {
            name: "future activation is scheduled",
            lifecycle: PersistedLifecycle::Open,
            hard_hold: false,
            open_prerequisite: false,
            attempt: None,
            as_of: 10,
            activation_at: Some(100),
            expected_status: DerivedStatus::Scheduled,
            expected_reason: ReasonCode::ScheduledStart(TimestampMs::from_millis(100)),
        },
        StatusVector {
            name: "no barrier is ready",
            lifecycle: PersistedLifecycle::Open,
            hard_hold: false,
            open_prerequisite: false,
            attempt: None,
            as_of: 10,
            activation_at: None,
            expected_status: DerivedStatus::Ready,
            expected_reason: ReasonCode::Eligible,
        },
    ];

    for vector in &vectors {
        let decision = status_vector(vector.clone());
        assert_eq!(
            decision.reason_codes.first(),
            Some(&decision.primary_reason)
        );
        assert!(decision.reason_codes[1..]
            .windows(2)
            .all(|pair| pair[0].stable_code() < pair[1].stable_code()));

        if vector.name.starts_with("terminal") {
            assert!(decision
                .reason_codes
                .contains(&ReasonCode::HardHold("operator_decision_required".into())));
            assert!(decision
                .reason_codes
                .contains(&ReasonCode::PrerequisiteOpen(WorkId::new("upstream-1"))));
            assert_eq!(decision.next_action, None);
        }
        if vector.name.starts_with("expiry") {
            assert!(decision.reason_codes.contains(&ReasonCode::LeaseElapsed));
            assert!(decision
                .reason_codes
                .contains(&ReasonCode::HardBudgetElapsed));
            assert_eq!(decision.next_action, Some(DomainAction::ReviewExpiry));
            assert!(!decision.claimable_for_actor);
        }
    }

    // Reordering independent facts must not change the complete decision.
    let first = permuted_expiry_status(false);
    let second = permuted_expiry_status(true);
    assert_eq!(first, second);
}

#[test]
fn exact_deadline_and_expiry_recovery_vectors_are_deterministic() {
    let mut attempt = Attempt::claim(
        WorkId::new("work-1"),
        AttemptId::new("attempt-1"),
        ActorId::new("agent-1"),
        Fence::new(1),
        TimestampMs::from_millis(0),
        Some(100),
        Some(200),
    )
    .expect("valid bounded attempt");

    let boundaries = [
        (99, None),
        (100, Some(boreal_domain::ExpiryReason::LeaseElapsed)),
        (199, Some(boreal_domain::ExpiryReason::LeaseElapsed)),
        (200, Some(boreal_domain::ExpiryReason::HardBudgetElapsed)),
    ];
    for (as_of, expected) in boundaries {
        assert_eq!(
            attempt.expiry_reason(TimestampMs::from_millis(as_of)),
            expected
        );
    }
    assert!(attempt.heartbeat(TimestampMs::from_millis(99)).is_ok());
    assert_eq!(
        attempt.heartbeat(TimestampMs::from_millis(100)),
        Err(boreal_domain::DomainError::LeaseExpired)
    );

    attempt.phase = AttemptPhase::Running;
    let work = WorkItem::new(
        ProjectId::new("project-1"),
        WorkId::new("work-1"),
        WorkKind::Task,
        None,
        "expiring work",
    )
    .open();
    let actor = ActorContext {
        actor_id: ActorId::new("agent-1"),
        role: ActorRole::Agent,
    };
    let gates = work.acceptance_profile.gates.clone();
    let decision = evaluate_status(StatusContext::new(
        &work,
        &[],
        Some(&attempt),
        &gates,
        &actor,
        TimestampMs::from_millis(200),
        Revision(19),
    ));
    assert_eq!(decision.display_status, DerivedStatus::ExpiredReview);
    assert_eq!(decision.primary_reason, ReasonCode::ExpiryReviewRequired);

    transition_attempt(&mut attempt, AttemptOperation::ExpiryPending).unwrap();
    assert_eq!(attempt.phase, AttemptPhase::ExpiryPending);
    transition_attempt(&mut attempt, AttemptOperation::Expire).unwrap();
    assert_eq!(attempt.phase, AttemptPhase::Expired);
    let after_expiry = evaluate_status(StatusContext::new(
        &work,
        &[],
        Some(&attempt),
        &gates,
        &actor,
        TimestampMs::from_millis(201),
        Revision(20),
    ));
    assert_eq!(after_expiry.display_status, DerivedStatus::ExpiredReview);
    assert_eq!(after_expiry.next_action, Some(DomainAction::ReviewExpiry));
    assert!(!after_expiry.claimable_for_actor);
}

fn dependency_fixture() -> (
    boreal_domain::dependencies::DependencyGraph,
    DependencyEdge,
    EntityIdentity,
) {
    let project = ProjectId::new("project-1");
    let predecessor = WorkId::new("upstream-1");
    let successor = WorkId::new("work-1");
    let edge = DependencyEdge::closed_only(
        DependencyId::new("edge-1"),
        project.clone(),
        predecessor.clone(),
        successor,
        EntityRevision::new(3),
    );
    let graph = validate_dependency_graph(
        project.clone(),
        &[
            DependencyEndpoint::new(
                project.clone(),
                predecessor,
                DependencyEndpointKind::DirectTask,
            ),
            DependencyEndpoint::new(
                project.clone(),
                WorkId::new("work-1"),
                DependencyEndpointKind::DirectTask,
            ),
        ],
        std::slice::from_ref(&edge),
    )
    .expect("dependency fixture is valid");
    let identity = EntityIdentity::new(project, WorkId::new("upstream-1"), EntityRevision::new(4));
    (graph, edge, identity)
}

#[test]
fn scoped_override_satisfies_only_its_edge_and_preserves_raw_truth() {
    let (graph, edge, predecessor) = dependency_fixture();
    let waiver = EdgeWaiver {
        decision_id: DecisionId::new("decision-1"),
        edge_id: edge.id.clone(),
        edge_revision: edge.revision,
        project_id: graph.project_id().clone(),
        successor: edge.successor.clone(),
        valid_from: EntityRevision::new(4),
        revoked_at: Some(EntityRevision::new(7)),
    };
    let observation = DependencyObservation {
        edge_id: edge.id.clone(),
        edge_revision: edge.revision,
        predecessor: predecessor.clone(),
        outcome: UpstreamOutcome::Open,
        waiver: Some(waiver.clone()),
    };

    let waived = evaluate_dependencies(
        &graph,
        std::slice::from_ref(&observation),
        EntityRevision::new(4),
    )
    .expect("waiver evaluation is pure");
    assert!(matches!(
        waived.edges[0].satisfaction,
        DependencySatisfaction::Waived { .. }
    ));
    assert_eq!(waived.edges[0].outcome, Some(UpstreamOutcome::Open));
    assert_eq!(waived.edges[0].waiver, Some(waiver.clone()));
    assert_eq!(
        waived.edges[0].raw_observations[0].outcome,
        UpstreamOutcome::Open
    );
    assert!(!matches!(
        waived.edges[0].outcome,
        Some(UpstreamOutcome::Closed(ClosedOutcome::Accepted { .. }))
    ));

    let revoked = evaluate_dependencies(&graph, &[observation], EntityRevision::new(7))
        .expect("revocation evaluation is pure");
    assert!(matches!(
        revoked.edges[0].satisfaction,
        EdgeSatisfaction::Unmet {
            reason: boreal_domain::dependencies::UnmetReason::WaiverRevoked
        }
    ));
    assert_eq!(revoked.edges[0].outcome, Some(UpstreamOutcome::Open));
}

fn action_facts(role: ActorRole) -> DecisionInputs {
    let subject = EntityIdentity::new(
        ProjectId::new("project-1"),
        WorkId::new("work-1"),
        EntityRevision::new(7),
    );
    let profile = ProfileIdentity::new(
        boreal_domain::ProfileId::new("focused"),
        "1",
        ContentDigest::new("sha256:profile"),
    );
    let proof = ProofIdentity::new(
        subject.clone(),
        ProofRevision::new(11),
        None,
        boreal_domain::SourceVersionId::new("source-1"),
        ConfigIdentity::new("config-1"),
        profile,
        "policy-1",
    );
    DecisionInputs {
        subject: subject.clone(),
        snapshot_revision: Revision(42),
        clock: EvaluationClock::at(TimestampMs::from_millis(1_000)),
        availability: Availability::Live,
        lifecycle: Fact::present(LifecycleInput {
            identity: subject.clone(),
            lifecycle: PersistedLifecycle::Open,
            terminal_decision: None,
        }),
        authority: Fact::present(ActorAuthorityInput {
            project_id: ProjectId::new("project-1"),
            role,
            principal: PrincipalBinding::Authenticated {
                actor_id: ActorId::new("actor-1"),
            },
            session_id: Some(SessionId::new("session-1")),
        }),
        requirements: Fact::present(PinnedRequirementsInput {
            proof,
            requirements: vec![PinnedRequirement {
                id: RequirementId::new("requirement-1"),
                gate_id: GateId::new("verification"),
                kind: GateKind::Verification,
                required: true,
                state: GateState::Satisfied,
                verifier_policy: VerifierPolicy {
                    id: VerifierPolicyId::new("rust-test"),
                    version: "1".into(),
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
        permitted_actions: PermittedActionsInput::allowing([
            PermittedAction::Inspect,
            PermittedAction::Claim,
            PermittedAction::Repair,
        ]),
    }
}

#[test]
fn action_descriptors_are_deterministic_and_status_specific() {
    let cases = [
        (DerivedStatus::Ready, ReasonCode::Eligible, true),
        (
            DerivedStatus::Queued,
            ReasonCode::PrerequisiteOpen(WorkId::new("upstream-1")),
            false,
        ),
        (
            DerivedStatus::Blocked,
            ReasonCode::HardHold("operator_decision_required".into()),
            false,
        ),
        (
            DerivedStatus::ExpiredReview,
            ReasonCode::ExpiryReviewRequired,
            false,
        ),
    ];
    for (status, reason, claim_allowed) in cases {
        let facts = action_facts(ActorRole::Agent);
        let reasons = [reason];
        let input = ActionEvaluationInput::new(&facts, status, &reasons);
        let first = evaluate_actions(&input);
        let second = evaluate_actions(&input);
        assert_eq!(
            first, second,
            "action result must be deterministic for {status:?}"
        );
        assert!(first.allows(ActionKind::Inspect));
        assert_eq!(first.allows(ActionKind::Claim), claim_allowed);
        if claim_allowed {
            let descriptor = first
                .allowed
                .iter()
                .find(|descriptor| descriptor.action == ActionKind::Claim)
                .expect("claim descriptor");
            assert_eq!(descriptor.target, facts.subject);
            assert_eq!(descriptor.expected_project_revision, Revision(42));
            assert_eq!(descriptor.expected_entity_revision, EntityRevision::new(7));
        } else {
            assert!(matches!(
                first.denial(ActionKind::Claim).map(|denial| &denial.reason),
                Some(ActionDenialReason::StatusDenied(actual)) if *actual == status
            ));
        }
    }
}
