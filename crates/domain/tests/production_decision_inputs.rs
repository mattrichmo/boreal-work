//! Pure acceptance coverage for PF-S03-T01.
//!
//! The module is exercised through the public domain boundary.

use boreal_domain::{
    ActorRole, AttemptId, AttemptPhase, ConfigIdentity, DependencyPolicy, GateId, GateKind,
    GateState, PersistedLifecycle, ProfileId, ProjectId, Revision, SessionId, SourceVersionId,
    TimestampMs, WorkId,
};

use boreal_domain::decision_inputs::*;

fn subject() -> EntityIdentity {
    EntityIdentity::new(
        ProjectId::new("project-1"),
        WorkId::new("work-1"),
        EntityRevision::new(7),
    )
}

fn profile() -> ProfileIdentity {
    ProfileIdentity::new(
        ProfileId::new("profile-1"),
        "3",
        ContentDigest::new("sha256:profile"),
    )
}

fn proof(attempt: Option<AttemptIdentity>, revision: u64) -> ProofIdentity {
    ProofIdentity::new(
        subject(),
        ProofRevision::new(revision),
        attempt,
        SourceVersionId::new("source-1"),
        ConfigIdentity::new("config-1"),
        profile(),
        "policy-3",
    )
}

fn work_subject() -> FactSubject {
    FactSubject::work(ProjectId::new("project-1"), WorkId::new("work-1"))
}

fn valid_inputs() -> DecisionInputs {
    let attempt = AttemptIdentity::new(AttemptId::new("attempt-1"), AttemptFence::new(4));
    DecisionInputs {
        subject: subject(),
        snapshot_revision: Revision(12),
        clock: EvaluationClock::at(TimestampMs::from_millis(1_000))
            .with_next_change_at(TimestampMs::from_millis(2_000)),
        availability: Availability::Live,
        lifecycle: Fact::present(LifecycleInput {
            identity: subject(),
            lifecycle: PersistedLifecycle::Open,
            terminal_decision: None,
        }),
        authority: Fact::present(ActorAuthorityInput {
            project_id: ProjectId::new("project-1"),
            role: ActorRole::Agent,
            principal: PrincipalBinding::Authenticated {
                actor_id: "agent-1".into(),
            },
            session_id: Some(SessionId::new("session-1")),
        }),
        requirements: Fact::present(PinnedRequirementsInput {
            proof: proof(Some(attempt.clone()), 1),
            requirements: vec![PinnedRequirement {
                id: RequirementId::new("requirement-1"),
                gate_id: GateId::new("verification"),
                kind: GateKind::Verification,
                required: true,
                state: GateState::Open,
                verifier_policy: VerifierPolicy {
                    id: VerifierPolicyId::new("rust-test"),
                    version: "1".to_owned(),
                },
            }],
            review_policy: ReviewRequirementPolicy::NotRequired,
        }),
        dependencies: Fact::present(DependencyOutcomesInput { edges: Vec::new() }),
        holds: Fact::present(HoldsInput { holds: Vec::new() }),
        execution: Fact::optional_absent(FactKind::Execution, work_subject()),
        submission: Fact::optional_absent(FactKind::Submission, work_subject()),
        review: Fact::optional_absent(FactKind::Review, work_subject()),
        recovery: Fact::optional_absent(FactKind::Recovery, work_subject()),
        integrity: IntegrityInput {
            scope: IntegrityScope::work(ProjectId::new("project-1"), WorkId::new("work-1")),
            level: IntegrityLevel::Valid,
            diagnostics: Vec::new(),
        },
        permitted_actions: PermittedActionsInput::allowing([
            PermittedAction::Inspect,
            PermittedAction::Claim,
        ]),
    }
}

fn has_code(diagnostics: &[DecisionDiagnostic], expected: ContradictionCode) -> bool {
    diagnostics.iter().any(|diagnostic| {
        matches!(
            diagnostic,
            DecisionDiagnostic::Contradictory { code, .. } if *code == expected
        )
    })
}

#[test]
fn valid_builder_preserves_canonical_facts_and_injected_clock() {
    let inputs = valid_inputs();

    assert!(inputs.validate().is_ok());
    assert_eq!(inputs.clock.evaluated_at, TimestampMs::from_millis(1_000));
    assert_eq!(
        inputs.clock.next_change_at,
        Some(TimestampMs::from_millis(2_000))
    );
    assert_eq!(inputs.snapshot_revision, Revision(12));
    assert_eq!(inputs.subject.revision, EntityRevision::new(7));
}

#[test]
fn revision_and_fence_newtypes_keep_equal_numbers_non_interchangeable() {
    let entity = EntityRevision::new(9);
    let proof = ProofRevision::new(9);
    let fence = AttemptFence::new(9);

    assert_eq!(entity.get(), proof.get());
    assert_eq!(proof.get(), fence.get());
    assert_ne!(RevisionMarker::Entity(entity), RevisionMarker::Proof(proof));
    assert_ne!(RevisionMarker::Proof(proof), RevisionMarker::Fence(fence));
}

#[test]
fn absent_unreadable_stale_and_failed_are_distinct_diagnostics() {
    let subject = work_subject();
    let facts = [
        Fact::<u8>::absent(FactKind::Lifecycle, subject.clone()),
        Fact::<u8>::unreadable(
            FactKind::Lifecycle,
            subject.clone(),
            UnreadableReason::Corrupt,
        ),
        Fact::<u8>::stale(
            FactKind::Lifecycle,
            subject.clone(),
            RevisionMarker::Entity(EntityRevision::new(2)),
            RevisionMarker::Entity(EntityRevision::new(1)),
        ),
        Fact::<u8>::failed(
            FactKind::Lifecycle,
            subject,
            FailureReason::EvaluationFailed,
        ),
    ];

    assert!(matches!(facts[0], Fact::Absent { .. }));
    assert!(matches!(facts[1], Fact::Unreadable { .. }));
    assert!(matches!(facts[2], Fact::Stale { .. }));
    assert!(matches!(facts[3], Fact::Failed { .. }));
    assert!(facts.iter().all(|fact| fact.diagnostic().is_some()));
}

#[test]
fn optional_absence_is_visible_without_becoming_an_invalid_default() {
    let inputs = valid_inputs();
    let diagnostics = inputs.diagnostics();

    assert!(diagnostics.iter().any(|diagnostic| {
        matches!(
            diagnostic,
            DecisionDiagnostic::Fact(FactDiagnostic::Absent(item))
                if item.fact == FactKind::Execution
                    && item.allowance == AbsenceAllowance::Allowed
        )
    }));
    assert!(inputs.validate().is_ok());
}

#[test]
fn required_absence_blocks_without_fabricating_lifecycle() {
    let mut inputs = valid_inputs();
    inputs.lifecycle = Fact::absent(FactKind::Lifecycle, work_subject());

    let diagnostics = inputs
        .validate()
        .expect_err("required lifecycle must block");
    assert!(diagnostics.iter().any(|diagnostic| {
        matches!(
            diagnostic,
            DecisionDiagnostic::Fact(FactDiagnostic::Absent(item))
                if item.fact == FactKind::Lifecycle
                    && item.allowance == AbsenceAllowance::Required
        )
    }));
}

#[test]
fn terminal_and_policy_contradictions_are_explicit() {
    let mut terminal_without_decision = valid_inputs();
    terminal_without_decision.lifecycle = Fact::present(LifecycleInput {
        identity: subject(),
        lifecycle: PersistedLifecycle::Closed,
        terminal_decision: None,
    });
    assert!(has_code(
        &terminal_without_decision.diagnostics(),
        ContradictionCode::TerminalDecisionMissing
    ));
    assert!(!terminal_without_decision.is_decidable());

    let mut conflicting_actions = valid_inputs();
    conflicting_actions
        .permitted_actions
        .denied
        .push(DeniedAction {
            action: PermittedAction::Claim,
            reason: ActionDenialReason::RoleDenied,
        });
    assert!(conflicting_actions
        .diagnostics()
        .iter()
        .any(|diagnostic| matches!(
            diagnostic,
            DecisionDiagnostic::ActionConflict {
                action: PermittedAction::Claim
            }
        )));
}

#[test]
fn proof_revision_and_current_execution_mismatches_are_not_valid_defaults() {
    let attempt = AttemptIdentity::new(AttemptId::new("attempt-1"), AttemptFence::new(4));
    let mut inputs = valid_inputs();
    inputs.execution = Fact::present(ExecutionInput {
        attempt: attempt.clone(),
        actor_id: "agent-1".into(),
        session_id: Some(SessionId::new("session-1")),
        phase: AttemptPhase::Completed,
        claimed_at: TimestampMs::from_millis(10),
        lease_deadline: TimestampMs::from_millis(20),
        hard_deadline: TimestampMs::from_millis(30),
        proof: proof(Some(attempt), 2),
    });

    let diagnostics = inputs.diagnostics();
    assert!(has_code(
        &diagnostics,
        ContradictionCode::CurrentExecutionIsTerminal
    ));
    assert!(has_code(
        &diagnostics,
        ContradictionCode::ProofRevisionMismatch
    ));
    assert!(!inputs.is_decidable());
}

#[test]
fn malformed_proof_context_is_diagnostic_not_a_passing_default() {
    let mut inputs = valid_inputs();
    let attempt = AttemptIdentity::new(AttemptId::new("attempt-1"), AttemptFence::new(4));
    inputs.requirements = Fact::present(PinnedRequirementsInput {
        proof: ProofIdentity::new(
            subject(),
            ProofRevision::new(1),
            Some(attempt),
            SourceVersionId::new(""),
            ConfigIdentity::new("config-1"),
            ProfileIdentity::new(ProfileId::new("profile-1"), "", ContentDigest::new("")),
            "",
        ),
        requirements: Vec::new(),
        review_policy: ReviewRequirementPolicy::NotRequired,
    });

    assert!(has_code(
        &inputs.diagnostics(),
        ContradictionCode::MalformedInput
    ));
    assert!(!inputs.is_decidable());
}

#[test]
fn integrity_scope_and_permitted_actions_are_transport_independent() {
    let mut inputs = valid_inputs();
    inputs.availability = Availability::Unavailable;
    inputs.integrity = IntegrityInput {
        scope: IntegrityScope::work(ProjectId::new("project-1"), WorkId::new("work-1")),
        level: IntegrityLevel::Degraded,
        diagnostics: vec![IntegrityDiagnostic {
            scope: IntegrityScope::work(ProjectId::new("project-1"), WorkId::new("work-1")),
            code: IntegrityDiagnosticCode::Stale,
        }],
    };
    inputs.permitted_actions = PermittedActionsInput {
        allowed: [PermittedAction::Inspect].into_iter().collect(),
        denied: vec![DeniedAction {
            action: PermittedAction::Claim,
            reason: ActionDenialReason::PolicyDenied,
        }],
    };

    assert_eq!(inputs.availability, Availability::Unavailable);
    assert_eq!(inputs.integrity.level, IntegrityLevel::Degraded);
    assert!(inputs.validate().is_ok());
    assert!(inputs
        .permitted_actions
        .allowed
        .contains(&PermittedAction::Inspect));
    assert!(!inputs
        .permitted_actions
        .allowed
        .contains(&PermittedAction::Claim));
}

#[test]
fn cross_project_dependency_and_proof_inputs_are_rejected() {
    let mut inputs = valid_inputs();
    inputs.dependencies = Fact::present(DependencyOutcomesInput {
        edges: vec![DependencyOutcomeInput {
            id: DependencyId::new("edge-1"),
            predecessor: EntityIdentity::new(
                ProjectId::new("other-project"),
                WorkId::new("upstream"),
                EntityRevision::new(1),
            ),
            successor: EntityIdentity::new(
                ProjectId::new("project-1"),
                WorkId::new("work-1"),
                EntityRevision::new(7),
            ),
            policy: DependencyPolicy::ClosedOnly,
            outcome: DependencyOutcome::Open,
            outcome_revision: EntityRevision::new(1),
            waiver: None,
        }],
    });
    inputs.requirements = Fact::present(PinnedRequirementsInput {
        proof: ProofIdentity::new(
            EntityIdentity::new(
                ProjectId::new("other-project"),
                WorkId::new("work-1"),
                EntityRevision::new(7),
            ),
            ProofRevision::new(1),
            None,
            SourceVersionId::new("source-1"),
            ConfigIdentity::new("config-1"),
            profile(),
            "policy-3",
        ),
        requirements: Vec::new(),
        review_policy: ReviewRequirementPolicy::NotRequired,
    });

    let diagnostics = inputs.validate().expect_err("foreign facts must block");
    assert!(diagnostics.iter().any(|diagnostic| matches!(
        diagnostic,
        DecisionDiagnostic::CrossProject {
            fact: FactKind::DependencyOutcomes,
            ..
        }
    )));
    assert!(diagnostics.iter().any(|diagnostic| matches!(
        diagnostic,
        DecisionDiagnostic::IdentityMismatch {
            fact: FactKind::PinnedRequirements,
            ..
        }
    )));
}
