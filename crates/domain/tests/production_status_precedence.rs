//! PF-S03-T02 production precedence, reason-ordering, and next-action vectors.
use boreal_domain::*;

fn task(id: &str) -> WorkItem {
    WorkItem::new("project".into(), id.into(), WorkKind::Task, None, id).open()
}

fn attempt(work_id: &str, phase: AttemptPhase) -> Attempt {
    let mut attempt = Attempt::claim(
        work_id.into(),
        format!("{work_id}-attempt").into(),
        "agent".into(),
        Fence::new(7),
        TimestampMs(0),
        Some(100),
        Some(200),
    )
    .unwrap();
    attempt.phase = phase;
    attempt
}

#[allow(clippy::too_many_arguments)]
fn decide(
    work: &WorkItem,
    prerequisites: &[WorkItem],
    current_attempt: Option<&Attempt>,
    gates: &[GateRequirement],
    role: ActorRole,
    as_of: u64,
    retry_not_before: Option<u64>,
    affected_dependents: &[WorkId],
) -> StatusDecision {
    let actor = ActorContext {
        actor_id: "actor".into(),
        role,
    };
    let mut context = StatusContext::new(
        work,
        prerequisites,
        current_attempt,
        gates,
        &actor,
        TimestampMs(as_of),
        Revision(44),
    );
    context.retry_not_before = retry_not_before.map(TimestampMs);
    context.affected_dependents = affected_dependents;
    evaluate_status(context)
}

fn codes(decision: &StatusDecision) -> Vec<String> {
    decision
        .reason_codes
        .iter()
        .map(ReasonCode::stable_code)
        .collect()
}

#[test]
fn paused_precedes_open_prerequisite_and_retains_the_safe_resume_action() {
    let mut work = task("dependent");
    work.dispatch_policy = DispatchPolicy::Paused;
    let result = decide(
        &work,
        &[task("upstream")],
        None,
        &work.acceptance_profile.gates,
        ActorRole::Agent,
        10,
        None,
        &[],
    );

    assert_eq!(result.display_status, DerivedStatus::Paused);
    assert_eq!(result.primary_reason, ReasonCode::Paused);
    assert_eq!(result.next_action, Some(DomainAction::ResumePolicy));
    assert_eq!(
        codes(&result),
        ["paused", "prerequisite_open(upstream)"].map(str::to_owned)
    );
    assert!(!result.claimable_for_actor);
}

#[test]
fn expiry_wins_the_hold_tie_and_retains_both_elapsed_clocks() {
    let mut work = task("dependent");
    work.hard_holds
        .push(ReasonCode::HardHold("operator_decision_required".into()));
    let current = attempt("dependent", AttemptPhase::Running);
    let result = decide(
        &work,
        &[task("upstream")],
        Some(&current),
        &work.acceptance_profile.gates,
        ActorRole::Agent,
        200,
        None,
        &[],
    );

    assert_eq!(result.display_status, DerivedStatus::ExpiredReview);
    assert_eq!(result.primary_reason, ReasonCode::ExpiryReviewRequired);
    assert_eq!(result.next_action, Some(DomainAction::ReviewExpiry));
    assert_eq!(
        codes(&result),
        [
            "expiry_review_required",
            "attempt_active",
            "hard_budget_elapsed",
            "lease_elapsed",
            "operator_decision_required",
            "prerequisite_open(upstream)",
        ]
        .map(str::to_owned)
    );
    assert_eq!(result.next_status_change_at, None);
}

#[test]
fn terminal_expiry_review_retains_elapsed_clocks_from_durable_deadlines() {
    let mut work = task("expired");
    work.hard_holds
        .push(ReasonCode::HardHold("operator_decision_required".into()));
    let current = attempt("expired", AttemptPhase::Expired);
    let result = decide(
        &work,
        &[],
        Some(&current),
        &work.acceptance_profile.gates,
        ActorRole::Agent,
        200,
        None,
        &[],
    );

    assert_eq!(result.display_status, DerivedStatus::ExpiredReview);
    assert_eq!(result.primary_reason, ReasonCode::ExpiryReviewRequired);
    assert_eq!(result.next_action, Some(DomainAction::ReviewExpiry));
    assert_eq!(
        codes(&result),
        [
            "expiry_review_required",
            "hard_budget_elapsed",
            "lease_elapsed",
            "operator_decision_required",
        ]
        .map(str::to_owned)
    );
    assert_eq!(result.next_status_change_at, None);
}

#[test]
fn failed_proof_rejected_review_and_missing_review_are_distinct() {
    let mut work = task("proof-task");
    work.acceptance_profile = AcceptanceProfile::reviewed();
    let current = attempt("proof-task", AttemptPhase::Verifying);

    let mut failed_proof = work.acceptance_profile.gates.clone();
    for gate in &mut failed_proof {
        gate.state = GateState::Satisfied;
    }
    failed_proof
        .iter_mut()
        .find(|gate| gate.kind == GateKind::Verification)
        .unwrap()
        .state = GateState::Failed;
    let failed = decide(
        &work,
        &[],
        Some(&current),
        &failed_proof,
        ActorRole::Agent,
        10,
        None,
        &[],
    );
    assert_eq!(failed.display_status, DerivedStatus::NeedsVerification);
    assert_eq!(failed.primary_reason, ReasonCode::VerificationRequired);
    assert_eq!(failed.next_action, Some(DomainAction::ProvideEvidence));
    assert!(codes(&failed).contains(&"gate_failed(verification)".to_owned()));
    assert!(!codes(&failed).contains(&"review_required".to_owned()));
    assert!(!codes(&failed).contains(&"review_rejected(review)".to_owned()));

    let mut rejected_review = work.acceptance_profile.gates.clone();
    for gate in &mut rejected_review {
        gate.state = GateState::Satisfied;
    }
    rejected_review
        .iter_mut()
        .find(|gate| gate.kind == GateKind::Review)
        .unwrap()
        .state = GateState::Failed;
    let rejected = decide(
        &work,
        &[],
        Some(&current),
        &rejected_review,
        ActorRole::Agent,
        10,
        None,
        &[],
    );
    assert_eq!(rejected.display_status, DerivedStatus::Blocked);
    assert_eq!(
        rejected.primary_reason,
        ReasonCode::ReviewRejected("review".into())
    );
    assert_eq!(rejected.next_action, Some(DomainAction::ResolveHold));
    assert!(codes(&rejected).contains(&"review_rejected(review)".to_owned()));
    assert!(!codes(&rejected).contains(&"review_required".to_owned()));

    let mut missing_review = work.acceptance_profile.gates.clone();
    for gate in &mut missing_review {
        gate.state = if gate.kind == GateKind::Review {
            GateState::Open
        } else {
            GateState::Satisfied
        };
    }
    let missing = decide(
        &work,
        &[],
        Some(&current),
        &missing_review,
        ActorRole::Agent,
        10,
        None,
        &[],
    );
    assert_eq!(missing.display_status, DerivedStatus::AwaitingReview);
    assert_eq!(missing.primary_reason, ReasonCode::ReviewRequired);
    assert_eq!(missing.next_action, Some(DomainAction::RequestReview));
    assert!(codes(&missing).contains(&"gate_open(review)".to_owned()));
    assert!(!codes(&missing).contains(&"review_rejected(review)".to_owned()));
}

#[test]
fn failed_proof_and_rejected_review_without_current_attempt_cannot_be_claimed() {
    let mut work = task("released-proof");
    work.acceptance_profile = AcceptanceProfile::reviewed();

    let mut failed_proof = work.acceptance_profile.gates.clone();
    for gate in &mut failed_proof {
        gate.state = GateState::Satisfied;
    }
    failed_proof
        .iter_mut()
        .find(|gate| gate.kind == GateKind::Verification)
        .unwrap()
        .state = GateState::Failed;
    let failed = decide(
        &work,
        &[],
        None,
        &failed_proof,
        ActorRole::Agent,
        10,
        None,
        &[],
    );
    assert_eq!(failed.display_status, DerivedStatus::NeedsVerification);
    assert_eq!(failed.primary_reason, ReasonCode::VerificationRequired);
    assert_eq!(failed.next_action, Some(DomainAction::ProvideEvidence));
    assert!(codes(&failed).contains(&"gate_failed(verification)".to_owned()));
    assert!(!failed.claimable_for_actor);
    assert_ne!(failed.next_action, Some(DomainAction::Claim));

    let mut rejected_review = work.acceptance_profile.gates.clone();
    for gate in &mut rejected_review {
        gate.state = GateState::Satisfied;
    }
    rejected_review
        .iter_mut()
        .find(|gate| gate.kind == GateKind::Review)
        .unwrap()
        .state = GateState::Failed;
    let rejected = decide(
        &work,
        &[],
        None,
        &rejected_review,
        ActorRole::Agent,
        10,
        None,
        &[],
    );
    assert_eq!(rejected.display_status, DerivedStatus::Blocked);
    assert_eq!(
        rejected.primary_reason,
        ReasonCode::ReviewRejected("review".into())
    );
    assert_eq!(rejected.next_action, Some(DomainAction::ResolveHold));
    assert!(codes(&rejected).contains(&"review_rejected(review)".to_owned()));
    assert!(!rejected.claimable_for_actor);
    assert_ne!(rejected.next_action, Some(DomainAction::Claim));
}

#[test]
fn hard_reason_primary_selection_uses_intervention_priority_not_lexical_order() {
    let mut work = task("proof-task");
    work.acceptance_profile = AcceptanceProfile::reviewed();
    work.hard_holds
        .push(ReasonCode::HardHold("z_security_hold".into()));
    let current = attempt("proof-task", AttemptPhase::Verifying);
    let mut gates = work.acceptance_profile.gates.clone();
    for gate in &mut gates {
        gate.state = GateState::Satisfied;
    }
    gates
        .iter_mut()
        .find(|gate| gate.kind == GateKind::Review)
        .unwrap()
        .state = GateState::Failed;

    let result = decide(
        &work,
        &[],
        Some(&current),
        &gates,
        ActorRole::Agent,
        10,
        None,
        &[],
    );
    assert_eq!(result.display_status, DerivedStatus::Blocked);
    assert_eq!(
        result.primary_reason,
        ReasonCode::HardHold("z_security_hold".into())
    );
    assert!(codes(&result).contains(&"review_rejected(review)".to_owned()));
}

#[test]
fn equivalent_fact_permutations_produce_byte_equivalent_decisions() {
    let mut work = task("dependent");
    work.dispatch_policy = DispatchPolicy::Paused;
    work.hard_holds = vec![
        ReasonCode::HardHold("z_hold".into()),
        ReasonCode::HardHold("a_hold".into()),
    ];
    let prerequisites = vec![task("z-upstream"), task("a-upstream")];
    let dependents = vec![WorkId::new("z-dependent"), WorkId::new("a-dependent")];
    let gates = work.acceptance_profile.gates.clone();
    let expected = decide(
        &work,
        &prerequisites,
        None,
        &gates,
        ActorRole::Agent,
        10,
        Some(50),
        &dependents,
    );

    let mut reversed_prerequisites = prerequisites.clone();
    reversed_prerequisites.reverse();
    let mut reversed_dependents = dependents.clone();
    reversed_dependents.reverse();
    let mut reversed_gates = gates.clone();
    reversed_gates.reverse();
    let reversed = decide(
        &work,
        &reversed_prerequisites,
        None,
        &reversed_gates,
        ActorRole::Agent,
        10,
        Some(50),
        &reversed_dependents,
    );

    work.hard_holds.reverse();
    let reversed_all = decide(
        &work,
        &reversed_prerequisites,
        None,
        &reversed_gates,
        ActorRole::Agent,
        10,
        Some(50),
        &reversed_dependents,
    );

    assert_eq!(expected, reversed);
    assert_eq!(expected, reversed_all);
    assert_eq!(expected.reason_codes[0], expected.primary_reason);
}

#[test]
fn next_action_follows_the_selected_status_branch() {
    let work = task("task");
    let cases = [
        (
            DerivedStatus::Draft,
            Some(DomainAction::PublishWork),
            PersistedLifecycle::Draft,
            DispatchPolicy::Automatic,
            None,
            None,
        ),
        (
            DerivedStatus::RetryWait,
            Some(DomainAction::WaitUntil),
            PersistedLifecycle::Open,
            DispatchPolicy::Automatic,
            None,
            Some(50),
        ),
        (
            DerivedStatus::Queued,
            Some(DomainAction::WaitForPrerequisite),
            PersistedLifecycle::Open,
            DispatchPolicy::Automatic,
            Some("upstream"),
            None,
        ),
    ];

    for (status, action, lifecycle, policy, prerequisite, retry) in cases {
        let mut candidate = work.clone();
        candidate.lifecycle = lifecycle;
        candidate.dispatch_policy = policy;
        let prerequisites = prerequisite.map(|id| vec![task(id)]).unwrap_or_default();
        let result = decide(
            &candidate,
            &prerequisites,
            None,
            &candidate.acceptance_profile.gates,
            ActorRole::Agent,
            10,
            retry,
            &[],
        );
        assert_eq!(result.display_status, status);
        assert_eq!(result.next_action, action);
    }

    let mut paused = work.clone();
    paused.dispatch_policy = DispatchPolicy::Paused;
    let paused_result = decide(
        &paused,
        &[],
        None,
        &paused.acceptance_profile.gates,
        ActorRole::Agent,
        10,
        None,
        &[],
    );
    assert_eq!(paused_result.next_action, Some(DomainAction::ResumePolicy));

    let mut operator_only = work.clone();
    operator_only.dispatch_policy = DispatchPolicy::OperatorOnly;
    let operator_result = decide(
        &operator_only,
        &[],
        None,
        &operator_only.acceptance_profile.gates,
        ActorRole::Agent,
        10,
        None,
        &[],
    );
    assert_eq!(operator_result.display_status, DerivedStatus::Ready);
    assert_eq!(
        operator_result.next_action,
        Some(DomainAction::RequestOperatorClaim)
    );
    assert!(!operator_result.claimable_for_actor);

    let claimed_attempt = attempt("task", AttemptPhase::Claimed);
    let claimed = decide(
        &work,
        &[],
        Some(&claimed_attempt),
        &work.acceptance_profile.gates,
        ActorRole::Agent,
        10,
        None,
        &[],
    );
    assert_eq!(claimed.next_action, Some(DomainAction::AcceptAttempt));

    let active_attempt = attempt("task", AttemptPhase::Running);
    let active = decide(
        &work,
        &[],
        Some(&active_attempt),
        &work.acceptance_profile.gates,
        ActorRole::Agent,
        10,
        None,
        &[],
    );
    assert_eq!(active.next_action, Some(DomainAction::ResumeAttempt));

    let mut complete_gates = work.acceptance_profile.gates.clone();
    for gate in &mut complete_gates {
        gate.state = GateState::Satisfied;
    }
    let completed_attempt = attempt("task", AttemptPhase::Completed);
    let complete = decide(
        &work,
        &[],
        Some(&completed_attempt),
        &complete_gates,
        ActorRole::Agent,
        10,
        None,
        &[],
    );
    assert_eq!(complete.display_status, DerivedStatus::Complete);
    assert_eq!(complete.next_action, Some(DomainAction::FinishClose));
}
