//! M02 candidate regressions. These exercise the real pure evaluator, not a
//! second implementation in a client or a test-only status assignment API.
use boreal_domain::*;

fn task(id: &str) -> WorkItem {
    WorkItem::new("project".into(), id.into(), WorkKind::Task, None, id).open()
}

fn attempt(phase: AttemptPhase) -> Attempt {
    let mut attempt = Attempt::claim(
        "task".into(),
        "attempt".into(),
        "agent".into(),
        Fence(1),
        TimestampMs(0),
        Some(100),
        Some(200),
    )
    .unwrap();
    attempt.phase = phase;
    attempt
}

fn decide(
    work: &WorkItem,
    prerequisites: &[WorkItem],
    current: Option<&Attempt>,
    gates: &[GateRequirement],
    role: ActorRole,
    now: u64,
    retry: Option<u64>,
) -> StatusDecision {
    let actor = ActorContext {
        actor_id: "agent".into(),
        role,
    };
    let mut context = StatusContext::new(
        work,
        prerequisites,
        current,
        gates,
        &actor,
        TimestampMs(now),
        Revision(17),
    );
    context.retry_not_before = retry.map(TimestampMs);
    evaluate_status(context)
}

fn idle(work: &WorkItem, prerequisites: &[WorkItem], retry: Option<u64>) -> StatusDecision {
    decide(
        work,
        prerequisites,
        None,
        &work.acceptance_profile.gates,
        ActorRole::Agent,
        10,
        retry,
    )
}

fn codes(decision: &StatusDecision) -> Vec<String> {
    decision
        .reason_codes
        .iter()
        .map(ReasonCode::stable_code)
        .collect()
}

#[test]
fn paused_precedes_retry_and_dependency_without_hiding_reasons() {
    let mut work = task("task");
    work.dispatch_policy = DispatchPolicy::Paused;
    let result = idle(&work, &[task("upstream")], Some(50));
    assert_eq!(result.display_status, DerivedStatus::Paused);
    assert_eq!(result.primary_reason, ReasonCode::Paused);
    assert_eq!(
        codes(&result),
        [
            "paused",
            "prerequisite_open(upstream)",
            "retry_not_before(50)"
        ]
    );
    assert_eq!(result.next_status_change_at, Some(TimestampMs(50)));
    assert!(!result.claimable_for_actor);
}

#[test]
fn hold_precedes_pause_retry_and_dependency() {
    let mut work = task("task");
    work.dispatch_policy = DispatchPolicy::Paused;
    work.hard_holds = vec![ReasonCode::HardHold("security_hold".into())];
    let result = idle(&work, &[task("upstream")], Some(50));
    assert_eq!(result.display_status, DerivedStatus::Blocked);
    assert_eq!(
        codes(&result),
        [
            "security_hold",
            "paused",
            "prerequisite_open(upstream)",
            "retry_not_before(50)"
        ]
    );
    assert!(!result.claimable_for_actor);
}

#[test]
fn idle_retry_precedes_dependency_and_ends_at_exact_boundary() {
    let work = task("task");
    let prerequisites = [task("upstream")];
    let before = decide(
        &work,
        &prerequisites,
        None,
        &work.acceptance_profile.gates,
        ActorRole::Agent,
        49,
        Some(50),
    );
    assert_eq!(before.display_status, DerivedStatus::RetryWait);
    assert_eq!(before.next_status_change_at, Some(TimestampMs(50)));
    let at = decide(
        &work,
        &prerequisites,
        None,
        &work.acceptance_profile.gates,
        ActorRole::Agent,
        50,
        Some(50),
    );
    assert_eq!(at.display_status, DerivedStatus::Queued);
    assert_eq!(at.next_status_change_at, None);
}

#[test]
fn active_attempt_precedes_dispatch_and_dependencies_but_not_a_hold() {
    let mut work = task("task");
    work.dispatch_policy = DispatchPolicy::Paused;
    let current = attempt(AttemptPhase::Running);
    let prerequisites = [task("upstream")];
    let result = decide(
        &work,
        &prerequisites,
        Some(&current),
        &work.acceptance_profile.gates,
        ActorRole::Agent,
        10,
        Some(50),
    );
    assert_eq!(result.display_status, DerivedStatus::InProgress);
    assert!(codes(&result).contains(&"paused".into()));
    assert!(codes(&result).contains(&"prerequisite_open(upstream)".into()));
    work.hard_holds
        .push(ReasonCode::HardHold("security_hold".into()));
    let held = decide(
        &work,
        &prerequisites,
        Some(&current),
        &work.acceptance_profile.gates,
        ActorRole::Agent,
        10,
        None,
    );
    assert_eq!(held.display_status, DerivedStatus::Blocked);
    assert!(codes(&held).contains(&"attempt_active".into()));
}

#[test]
fn expiry_has_one_primary_reason_and_retains_both_elapsed_clocks() {
    let mut work = task("task");
    work.hard_holds
        .push(ReasonCode::HardHold("security_hold".into()));
    let current = attempt(AttemptPhase::Running);
    let result = decide(
        &work,
        &[task("upstream")],
        Some(&current),
        &work.acceptance_profile.gates,
        ActorRole::Agent,
        200,
        None,
    );
    assert_eq!(result.display_status, DerivedStatus::ExpiredReview);
    assert_eq!(result.primary_reason, ReasonCode::ExpiryReviewRequired);
    for code in [
        "hard_budget_elapsed",
        "lease_elapsed",
        "security_hold",
        "prerequisite_open(upstream)",
    ] {
        assert!(codes(&result).contains(&code.to_string()));
    }
    assert_eq!(result.next_status_change_at, None);
}

#[test]
fn closed_and_cancelled_win_over_all_nonterminal_inputs() {
    for lifecycle in [PersistedLifecycle::Closed, PersistedLifecycle::Cancelled] {
        let mut work = task("task");
        work.lifecycle = lifecycle;
        work.dispatch_policy = DispatchPolicy::Paused;
        work.hard_holds
            .push(ReasonCode::HardHold("security_hold".into()));
        let current = attempt(AttemptPhase::Running);
        let result = decide(
            &work,
            &[task("upstream")],
            Some(&current),
            &work.acceptance_profile.gates,
            ActorRole::Agent,
            201,
            Some(500),
        );
        assert_eq!(
            result.display_status,
            if lifecycle == PersistedLifecycle::Closed {
                DerivedStatus::Closed
            } else {
                DerivedStatus::Cancelled
            }
        );
        assert!(!result.claimable_for_actor);
        assert_eq!(result.next_action, None);
        assert_eq!(result.next_status_change_at, None);
    }
}

#[test]
fn historical_failure_release_and_cancel_do_not_skip_idle_predicates() {
    for phase in [
        AttemptPhase::Failed,
        AttemptPhase::Released,
        AttemptPhase::Cancelled,
    ] {
        let mut work = task("task");
        work.dispatch_policy = DispatchPolicy::Paused;
        let current = attempt(phase);
        let with_history = decide(
            &work,
            &[task("upstream")],
            Some(&current),
            &work.acceptance_profile.gates,
            ActorRole::Agent,
            500,
            None,
        );
        let without_history = decide(
            &work,
            &[task("upstream")],
            None,
            &work.acceptance_profile.gates,
            ActorRole::Agent,
            500,
            None,
        );
        assert_eq!(with_history, without_history);
        assert_eq!(with_history.display_status, DerivedStatus::Paused);
    }
}

#[test]
fn reviewed_profile_uses_gate_kind_with_work_scoped_ids() {
    let mut work = task("task");
    work.acceptance_profile = AcceptanceProfile::reviewed();
    for gate in &mut work.acceptance_profile.gates {
        gate.id = format!("task:{}", gate.id).into();
    }
    let gates = work
        .acceptance_profile
        .gates
        .iter()
        .cloned()
        .map(|gate| {
            if gate.kind == GateKind::Review {
                gate
            } else {
                gate.satisfied()
            }
        })
        .collect::<Vec<_>>();
    let current = attempt(AttemptPhase::Verifying);
    let result = decide(
        &work,
        &[],
        Some(&current),
        &gates,
        ActorRole::Agent,
        10,
        None,
    );
    assert_eq!(result.display_status, DerivedStatus::AwaitingReview);
    assert_eq!(result.gate_gaps, [GateId::new("task:review")]);
    assert!(codes(&result).contains(&"gate_open(task:review)".into()));
}

#[test]
fn failed_review_blocks_and_failed_technical_gate_still_needs_proof() {
    let mut work = task("task");
    work.acceptance_profile = AcceptanceProfile::reviewed();
    let mut gates = work.acceptance_profile.gates.clone();
    for gate in &mut gates {
        gate.state = GateState::Satisfied;
    }
    let current = attempt(AttemptPhase::Verifying);
    gates
        .iter_mut()
        .find(|gate| gate.kind == GateKind::Review)
        .unwrap()
        .state = GateState::Failed;
    assert_eq!(
        decide(
            &work,
            &[],
            Some(&current),
            &gates,
            ActorRole::Agent,
            10,
            None
        )
        .display_status,
        DerivedStatus::Blocked
    );
    gates
        .iter_mut()
        .find(|gate| gate.kind == GateKind::Review)
        .unwrap()
        .state = GateState::Satisfied;
    gates
        .iter_mut()
        .find(|gate| gate.kind == GateKind::Verification)
        .unwrap()
        .state = GateState::Failed;
    let technical = decide(
        &work,
        &[],
        Some(&current),
        &gates,
        ActorRole::Agent,
        10,
        None,
    );
    assert_eq!(technical.display_status, DerivedStatus::NeedsVerification);
    assert!(codes(&technical).contains(&"gate_failed(verification)".into()));
}

#[test]
fn missing_or_duplicate_declared_gates_are_integrity_errors() {
    let work = task("task");
    let mut gates = work.acceptance_profile.gates.clone();
    gates.pop();
    let missing = decide(&work, &[], None, &gates, ActorRole::Agent, 10, None);
    assert_eq!(missing.display_status, DerivedStatus::Blocked);
    assert!(codes(&missing).contains(&"gate_missing(summary)".into()));
    let mut gates = work.acceptance_profile.gates.clone();
    gates.push(gates[0].clone());
    assert_eq!(
        decide(&work, &[], None, &gates, ActorRole::Agent, 10, None).display_status,
        DerivedStatus::Blocked
    );
}

#[test]
fn actor_roles_change_claimability_not_display_readiness() {
    let mut work = task("task");
    for role in [
        ActorRole::Agent,
        ActorRole::Reviewer,
        ActorRole::Operator,
        ActorRole::Publisher,
    ] {
        let result = decide(
            &work,
            &[],
            None,
            &work.acceptance_profile.gates,
            role,
            10,
            None,
        );
        assert_eq!(result.display_status, DerivedStatus::Ready);
        assert_eq!(result.claimable_for_actor, role == ActorRole::Agent);
    }
    work.dispatch_policy = DispatchPolicy::OperatorOnly;
    for role in [
        ActorRole::Agent,
        ActorRole::Reviewer,
        ActorRole::Operator,
        ActorRole::Publisher,
    ] {
        let result = decide(
            &work,
            &[],
            None,
            &work.acceptance_profile.gates,
            role,
            10,
            None,
        );
        assert_eq!(result.display_status, DerivedStatus::Ready);
        assert_eq!(result.claimable_for_actor, role == ActorRole::Operator);
        assert!(codes(&result).contains(&"operator_only".into()));
    }
}

#[test]
fn complete_and_cancelled_never_satisfy_close_only_edges() {
    let work = task("task");
    let upstream = task("upstream");
    let mut current = attempt(AttemptPhase::Completed);
    current.work_id = upstream.id.clone();
    let gates = upstream
        .acceptance_profile
        .gates
        .iter()
        .cloned()
        .map(GateRequirement::satisfied)
        .collect::<Vec<_>>();
    let complete = decide(
        &upstream,
        &[],
        Some(&current),
        &gates,
        ActorRole::Agent,
        500,
        None,
    );
    assert_eq!(complete.display_status, DerivedStatus::Complete);
    assert_eq!(
        idle(&work, &[upstream.clone()], None).display_status,
        DerivedStatus::Queued
    );
    let mut cancelled = upstream.clone();
    cancelled.lifecycle = PersistedLifecycle::Cancelled;
    assert_eq!(
        idle(&work, &[cancelled], None).display_status,
        DerivedStatus::Queued
    );
    let mut closed = upstream;
    closed.lifecycle = PersistedLifecycle::Closed;
    assert_eq!(
        idle(&work, &[closed], None).display_status,
        DerivedStatus::Ready
    );
}

#[test]
fn permutations_and_duplicate_facts_do_not_change_the_decision() {
    let mut work = task("task");
    work.hard_holds = vec![
        ReasonCode::HardHold("z_hold".into()),
        ReasonCode::HardHold("a_hold".into()),
    ];
    let mut prerequisites = vec![task("z"), task("a")];
    let first = idle(&work, &prerequisites, None);
    for _ in 0..8 {
        work.hard_holds.reverse();
        prerequisites.reverse();
        work.acceptance_profile.gates.reverse();
        assert_eq!(idle(&work, &prerequisites, None), first);
    }
    work.hard_holds.push(work.hard_holds[0].clone());
    prerequisites.push(prerequisites[0].clone());
    assert_eq!(idle(&work, &prerequisites, None), first);
    assert_eq!(codes(&first)[0], first.primary_reason.stable_code());
}

#[test]
fn attempt_for_another_work_is_blocked_without_mutating_inputs() {
    let work = task("different");
    let current = attempt(AttemptPhase::Running);
    let original = current.clone();
    let result = decide(
        &work,
        &[],
        Some(&current),
        &work.acceptance_profile.gates,
        ActorRole::Agent,
        10,
        None,
    );
    assert_eq!(result.display_status, DerivedStatus::Blocked);
    assert!(codes(&result).contains(&"attempt_subject_mismatch".into()));
    assert_eq!(current, original);
}

#[test]
fn derived_status_is_not_a_writable_lifecycle() {
    for status in [
        DerivedStatus::Ready,
        DerivedStatus::Complete,
        DerivedStatus::Closed,
        DerivedStatus::Paused,
    ] {
        assert!(reject_derived_status_write(status).is_err());
    }
}
