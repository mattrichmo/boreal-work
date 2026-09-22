pub use boreal_domain::work_model_v3;
use boreal_domain::{
    ActorId, Attempt, AttemptId, AttemptPhase, DomainError, ExpiryReason, Fence, TimestampMs,
    WorkId, DEFAULT_HARD_TIME_LIMIT_MS, DEFAULT_LEASE_TTL_MS,
};
use work_model_v3::WorkSchedule;

use boreal_domain::time_policy::*;

fn ts(value: u64) -> TimestampMs {
    TimestampMs::from_millis(value)
}

fn attempt(claimed_at: u64, lease_ttl_ms: u64, hard_limit_ms: u64) -> Attempt {
    Attempt::claim(
        WorkId::new("work-1"),
        AttemptId::new("attempt-1"),
        ActorId::new("agent-1"),
        Fence::new(7),
        ts(claimed_at),
        Some(lease_ttl_ms),
        Some(hard_limit_ms),
    )
    .expect("valid attempt fixture")
}

#[test]
fn claim_windows_use_exact_defaults_and_keep_clocks_separate() {
    let window = AttemptWindow::from_claim(ts(10_000), None, None).unwrap();
    assert_eq!(window.lease_deadline, ts(10_000 + DEFAULT_LEASE_TTL_MS));
    assert_eq!(
        window.hard_deadline,
        ts(10_000 + DEFAULT_HARD_TIME_LIMIT_MS)
    );
    assert_eq!(RetryInput::none().failure_count, 0);

    let explicit = AttemptWindow::from_claim(ts(100), Some(3_600), Some(1_200)).unwrap();
    assert_eq!(explicit.lease_deadline, ts(3_700));
    assert_eq!(explicit.hard_deadline, ts(1_300));
}

#[test]
fn exact_hard_deadline_fences_authority_and_late_sweeper_is_not_required() {
    let current = attempt(0, 10_000, 2_000);
    let token = AuthorityToken::new(current.attempt_id.clone(), current.fence);
    let decision = evaluate_attempt(
        AttemptSnapshot::current(&current),
        PolicyClock::at(ts(2_000)),
        Some(token.clone()),
    )
    .unwrap();

    assert!(decision.hard_budget_elapsed);
    assert!(decision.expired);
    assert_eq!(
        decision.expiry_reason,
        Some(ExpiryReason::HardBudgetElapsed)
    );
    assert_eq!(decision.authority, AuthorityDecision::HardBudgetElapsed);
    assert_eq!(decision.next_reevaluation_at, None);

    let lease_current = attempt(0, 100, 2_000);
    let lease_token = AuthorityToken::new(lease_current.attempt_id.clone(), lease_current.fence);
    let lease_decision = evaluate_attempt(
        AttemptSnapshot::current(&lease_current),
        PolicyClock::at(ts(100)),
        Some(lease_token),
    )
    .unwrap();
    assert!(lease_decision.lease_elapsed);
    assert!(!lease_decision.hard_budget_elapsed);
    assert!(lease_decision.expired);
    assert_eq!(lease_decision.authority, AuthorityDecision::LeaseElapsed);
}

#[test]
fn lease_renewal_is_allowed_before_lease_deadline_and_never_moves_hard_budget() {
    let current = attempt(100, 1_000, 5_000);
    let token = AuthorityToken::new(current.attempt_id.clone(), current.fence);
    let renewal = renew_lease(
        AttemptSnapshot::current(&current),
        token,
        PolicyClock::at(ts(500)),
        2_000,
    )
    .unwrap();

    assert_eq!(renewal.previous_lease_deadline, ts(1_100));
    assert_eq!(renewal.new_lease_deadline, ts(2_500));
    assert_eq!(renewal.hard_deadline, ts(5_100));
}

#[test]
fn lease_renewal_rejects_zero_and_shortening_candidates() {
    let current = attempt(0, 1_000, 5_000);
    let token = AuthorityToken::new(current.attempt_id.clone(), current.fence);

    assert_eq!(
        renew_lease(
            AttemptSnapshot::current(&current),
            token.clone(),
            PolicyClock::at(ts(500)),
            0,
        ),
        Err(RenewalError::Time(
            TimePolicyError::RenewalDeadlineNotAfterNow {
                as_of: ts(500),
                deadline: ts(500),
            }
        ))
    );

    assert_eq!(
        renew_lease(
            AttemptSnapshot::current(&current),
            token,
            PolicyClock::at(ts(500)),
            100,
        ),
        Err(RenewalError::Time(TimePolicyError::RenewalShortensLease {
            previous: ts(1_000),
            candidate: ts(600),
        }))
    );
}

#[test]
fn stale_attempt_and_fence_authority_are_distinct_and_never_mutate() {
    let current = attempt(0, 1_000, 5_000);
    let wrong_attempt = AuthorityToken::new(AttemptId::new("old-attempt"), current.fence);
    let wrong_fence = AuthorityToken::new(current.attempt_id.clone(), Fence::new(6));

    assert_eq!(
        evaluate_attempt(
            AttemptSnapshot::current(&current),
            PolicyClock::at(ts(100)),
            Some(wrong_attempt)
        )
        .unwrap()
        .authority,
        AuthorityDecision::StaleAttempt
    );
    assert_eq!(
        evaluate_attempt(
            AttemptSnapshot::current(&current),
            PolicyClock::at(ts(100)),
            Some(wrong_fence)
        )
        .unwrap()
        .authority,
        AuthorityDecision::StaleFence
    );
}

#[test]
fn historical_terminal_attempt_clocks_are_ignored_unless_recovery_is_pending() {
    for phase in [
        AttemptPhase::Failed,
        AttemptPhase::Released,
        AttemptPhase::Cancelled,
    ] {
        let mut historical = attempt(0, 10, 20);
        historical.phase = phase;
        let decision = evaluate_attempt(
            AttemptSnapshot::historical(&historical, RecoveryState::None),
            PolicyClock::at(ts(100)),
            None,
        )
        .unwrap();
        assert!(!decision.expired);
        assert!(!decision.lease_elapsed);
        assert!(!decision.hard_budget_elapsed);
        assert!(!decision.review_required);
    }

    let mut expired = attempt(0, 10, 20);
    expired.phase = AttemptPhase::Expired;
    let recovery = evaluate_attempt(
        AttemptSnapshot::historical(&expired, RecoveryState::Pending),
        PolicyClock::at(ts(100)),
        None,
    )
    .unwrap();
    assert!(recovery.expired);
    assert!(recovery.review_required);
    assert!(recovery.lease_elapsed);
    assert!(recovery.hard_budget_elapsed);
    assert_eq!(recovery.expiry_reason, Some(ExpiryReason::LeaseElapsed));

    let mut already_expired_before_deadline = attempt(1_000, 10_000, 20_000);
    already_expired_before_deadline.phase = AttemptPhase::Expired;
    let retained_reason = evaluate_attempt(
        AttemptSnapshot::historical(&already_expired_before_deadline, RecoveryState::Pending)
            .with_retained_expiry_reason(ExpiryReason::HardBudgetElapsed),
        PolicyClock::at(ts(1_001)),
        None,
    )
    .unwrap();
    assert_eq!(
        retained_reason.expiry_reason,
        Some(ExpiryReason::HardBudgetElapsed)
    );

    let current_recovery = evaluate_attempt(
        AttemptSnapshot::current_with_recovery(&expired),
        PolicyClock::at(ts(100)),
        None,
    )
    .unwrap();
    assert!(current_recovery.review_required);
}

#[test]
fn expiry_review_uses_lease_trigger_and_requires_retained_phase_only_reason() {
    let mut lease_expiring = attempt(0, 100, 1_000);
    lease_expiring.phase = AttemptPhase::ExpiryPending;
    let lease_review = evaluate_attempt(
        AttemptSnapshot::current(&lease_expiring),
        PolicyClock::at(ts(100)),
        None,
    )
    .unwrap();
    assert!(lease_review.expired);
    assert!(lease_review.review_required);
    assert!(lease_review.lease_elapsed);
    assert!(!lease_review.hard_budget_elapsed);
    assert_eq!(lease_review.expiry_reason, Some(ExpiryReason::LeaseElapsed));

    let mut phase_only = attempt(1_000, 10_000, 20_000);
    phase_only.phase = AttemptPhase::Expired;
    assert_eq!(
        evaluate_attempt(
            AttemptSnapshot::current(&phase_only),
            PolicyClock::at(ts(1_001)),
            None,
        ),
        Err(TimePolicyError::MissingExpiryReason)
    );

    let retained = evaluate_attempt(
        AttemptSnapshot::current(&phase_only)
            .with_retained_expiry_reason(ExpiryReason::LeaseElapsed),
        PolicyClock::at(ts(1_001)),
        None,
    )
    .unwrap();
    assert_eq!(retained.expiry_reason, Some(ExpiryReason::LeaseElapsed));
}

#[test]
fn public_attempt_api_matches_canonical_expiry_and_renewal_guards() {
    let mut current = attempt(0, 1_000, 5_000);
    assert_eq!(
        current.expiry_reason(ts(1_000)),
        Some(ExpiryReason::LeaseElapsed)
    );

    current.phase = AttemptPhase::ExpiryPending;
    assert_eq!(current.expiry_reason(ts(500)), None);

    current.phase = AttemptPhase::Running;
    assert_eq!(
        current.renew_lease(ts(500), 0),
        Err(DomainError::InvalidLeaseRenewal)
    );
    assert_eq!(current.lease_deadline, ts(1_000));
    assert_eq!(
        current.renew_lease(ts(500), 100),
        Err(DomainError::InvalidLeaseRenewal)
    );
    assert_eq!(current.lease_deadline, ts(1_000));
}

#[test]
fn schedule_equality_marks_due_without_stealing_ownership() {
    let schedule = WorkSchedule {
        not_before_at: Some(ts(100)),
        due_at: Some(ts(200)),
        target_start_at: Some(ts(80)),
        target_end_at: Some(ts(300)),
    };
    let before = evaluate_schedule(schedule, ts(99), false).unwrap();
    assert!(!before.eligible);
    assert!(before.scheduled);
    assert!(!before.overdue);
    assert_eq!(before.next_change_at, Some(ts(100)));

    let due = evaluate_schedule(schedule, ts(200), false).unwrap();
    assert!(due.eligible);
    assert!(!due.scheduled);
    assert!(due.overdue);
    assert_eq!(due.next_change_at, None);
}

#[test]
fn planning_target_window_does_not_gate_claim_eligibility_or_due() {
    let schedule = WorkSchedule {
        not_before_at: None,
        due_at: None,
        target_start_at: Some(ts(500)),
        target_end_at: Some(ts(600)),
    };

    let decision = evaluate_schedule(schedule, ts(100), false).unwrap();

    assert!(decision.eligible);
    assert!(!decision.scheduled);
    assert!(!decision.overdue);
    assert_eq!(decision.next_change_at, None);
}

#[test]
fn retry_backoff_is_deterministic_bounded_and_clears_at_equality() {
    let policy = RetryPolicy::bounded(100, 350, 3);
    assert_eq!(policy.delay_for(0).unwrap(), 100);
    assert_eq!(policy.delay_for(1).unwrap(), 200);
    assert_eq!(policy.delay_for(2).unwrap(), 350);
    assert_eq!(policy.retry_not_before(ts(1_000), 20).unwrap(), ts(1_350));

    let retry_at = policy.retry_not_before(ts(1_000), 1).unwrap();
    let waiting = evaluate_retry(
        policy,
        RetryInput {
            failure_count: 1,
            retry_not_before: Some(retry_at),
        },
        ts(1_199),
    )
    .unwrap();
    assert!(waiting.waiting);
    assert!(!waiting.eligible);
    assert_eq!(waiting.next_change_at, Some(retry_at));

    let equal = evaluate_retry(
        policy,
        RetryInput {
            failure_count: 1,
            retry_not_before: Some(retry_at),
        },
        retry_at,
    )
    .unwrap();
    assert!(!equal.waiting);
    assert!(equal.eligible);

    let exhausted = evaluate_retry(
        policy,
        RetryInput {
            failure_count: policy.max_retries,
            retry_not_before: Some(ts(10_000)),
        },
        ts(0),
    )
    .unwrap();
    assert!(exhausted.exhausted);
    assert!(!exhausted.eligible);
    assert_eq!(exhausted.next_change_at, None);
}

#[test]
fn next_reevaluation_is_the_earliest_relevant_timer() {
    let current = attempt(0, 500, 2_000);
    let retry_at = ts(300);
    let decision = evaluate_time_policy(TimePolicyInput {
        clock: PolicyClock::at(ts(100)),
        schedule: WorkSchedule {
            not_before_at: Some(ts(250)),
            due_at: Some(ts(700)),
            target_start_at: None,
            target_end_at: None,
        },
        terminal: false,
        retry_policy: RetryPolicy::default(),
        retry: RetryInput {
            failure_count: 1,
            retry_not_before: Some(retry_at),
        },
        attempt: Some(AttemptSnapshot::current(&current)),
        authority: None,
        exception_valid_until: Some(ts(400)),
        review_readback_at: Some(ts(450)),
    })
    .unwrap();

    assert_eq!(decision.next_reevaluation_at, Some(ts(250)));
    assert!(!decision.overdue);
    assert!(decision.exception_valid);
}

#[test]
fn expiry_review_suppresses_forward_eligibility_and_timers() {
    let mut current = attempt(0, 100, 1_000);
    current.phase = AttemptPhase::ExpiryPending;
    let decision = evaluate_time_policy(TimePolicyInput {
        clock: PolicyClock::at(ts(100)),
        schedule: WorkSchedule {
            not_before_at: Some(ts(500)),
            due_at: Some(ts(900)),
            target_start_at: None,
            target_end_at: None,
        },
        terminal: false,
        retry_policy: RetryPolicy::default(),
        retry: RetryInput {
            failure_count: 1,
            retry_not_before: Some(ts(600)),
        },
        attempt: Some(AttemptSnapshot::current(&current)),
        authority: None,
        exception_valid_until: Some(ts(700)),
        review_readback_at: Some(ts(800)),
    })
    .unwrap();

    assert!(decision.attempt.unwrap().review_required);
    assert!(!decision.schedule.eligible);
    assert!(!decision.retry.eligible);
    assert_eq!(decision.schedule.next_change_at, None);
    assert_eq!(decision.retry.next_change_at, None);
    assert_eq!(decision.next_reevaluation_at, None);
}

#[test]
fn backward_clock_does_not_resurrect_expiry_and_unvalidated_restart_denies_writes() {
    let current = attempt(0, 100, 200);
    let token = AuthorityToken::new(current.attempt_id.clone(), current.fence);

    let backward = evaluate_attempt(
        AttemptSnapshot::current(&current),
        PolicyClock::after(ts(250), ts(100)),
        Some(token.clone()),
    )
    .unwrap();
    assert!(backward.hard_budget_elapsed);
    assert_eq!(backward.authority, AuthorityDecision::ClockDiscontinuity);

    let restart = evaluate_attempt(
        AttemptSnapshot::current(&current),
        PolicyClock::restarted(ts(100), ts(150), None),
        Some(token.clone()),
    )
    .unwrap();
    assert_eq!(restart.authority, AuthorityDecision::ClockDiscontinuity);
    assert!(!restart.hard_budget_elapsed);
}

#[test]
fn unvalidated_restart_suppresses_combined_retry_eligibility_and_timers() {
    let decision = evaluate_time_policy(TimePolicyInput {
        clock: PolicyClock::restarted(ts(100), ts(150), None),
        schedule: WorkSchedule {
            not_before_at: None,
            due_at: None,
            target_start_at: None,
            target_end_at: None,
        },
        terminal: false,
        retry_policy: RetryPolicy::default(),
        retry: RetryInput::none(),
        attempt: None,
        authority: None,
        exception_valid_until: Some(ts(400)),
        review_readback_at: Some(ts(450)),
    })
    .unwrap();

    assert!(decision.clock.validity.needs_reconciliation());
    assert!(!decision.schedule.eligible);
    assert!(!decision.retry.eligible);
    assert_eq!(decision.retry.next_change_at, None);
    assert_eq!(decision.next_reevaluation_at, None);
}

#[test]
fn validated_restart_uses_monotonic_elapsed_time_without_extending_hard_budget() {
    let current = attempt(0, 500, 200);
    let token = AuthorityToken::new(current.attempt_id.clone(), current.fence);
    let restart = evaluate_attempt(
        AttemptSnapshot::current(&current),
        PolicyClock::restarted(ts(100), ts(150), Some(100)),
        Some(token),
    )
    .unwrap();

    assert!(restart.hard_budget_elapsed);
    assert_eq!(restart.authority, AuthorityDecision::HardBudgetElapsed);
}

#[test]
fn malformed_deadlines_and_schedules_fail_closed() {
    assert!(matches!(
        AttemptWindow::new(ts(10), ts(10), ts(20)),
        Err(TimePolicyError::DeadlineNotAfterClaim {
            kind: DeadlineKind::Lease,
            ..
        })
    ));

    let invalid_schedule = WorkSchedule {
        not_before_at: None,
        due_at: None,
        target_start_at: Some(ts(20)),
        target_end_at: Some(ts(20)),
    };
    assert_eq!(
        evaluate_schedule(invalid_schedule, ts(0), false),
        Err(TimePolicyError::InvalidSchedule)
    );
    assert_eq!(
        RetryPolicy::bounded(10, 9, 2).delay_for(0),
        Err(TimePolicyError::InvalidBackoffBounds)
    );
}
