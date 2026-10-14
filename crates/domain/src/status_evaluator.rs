//! One pure decision over canonical inputs. Reads and transactional claim
//! authorization both call this function; adapters must not repair its result.
use crate::{
    time_policy::evaluate_schedule as evaluate_time_schedule, ActorContext, ActorRole,
    AttemptPhase, CurrentAttempt, DerivedStatus, DispatchPolicy, DomainAction, GateId, GateKind,
    GateRequirement, GateState, PersistedLifecycle, ReasonCode, StatusContext, StatusDecision,
    WorkItem, WorkKind,
};
use crate::decision_inputs::ExternalWaitPersistedState;
use crate::work_model_v3::{
    evaluate_business_schedule, BusinessDate, BusinessDateBoundary, BusinessScheduleView,
};

type PrimaryDecision = (DerivedStatus, bool, Option<DomainAction>, ReasonCode);

/// Evaluate the status contract in one fixed precedence pass.
///
/// Every applicable fact is collected before the primary branch is selected.
/// This is important for combined states: a paused dependent stays paused but
/// still reports its open prerequisites, and an expired attempt stays in
/// expiry review while retaining both elapsed clocks and any hard hold.
pub fn evaluate_status(context: StatusContext<'_>) -> StatusDecision {
    evaluate_status_inner(context, None)
}

/// Production entry point: durable submission/recovery and accepted dependency
/// outcomes survive execution ownership. Legacy callers retain the v2 wrapper.
pub fn evaluate_canonical_status(
    context: StatusContext<'_>,
    facts: &crate::decision_inputs::DecisionInputs,
) -> StatusDecision {
    evaluate_status_inner(context, Some(facts))
}

fn evaluate_status_inner(
    context: StatusContext<'_>,
    facts: Option<&crate::decision_inputs::DecisionInputs>,
) -> StatusDecision {
    use crate::decision_inputs::{
        DependencyOutcome, RecoveryReason, ReviewOutcome, SubmissionState,
    };
    let work = context.work;
    // Failed/released/cancelled attempts are historical facts, not current
    // eligibility inputs. Expiry-pending/expired remain visible because they
    // carry an unresolved recovery obligation.
    let attempt = context.current_attempt.filter(|current| {
        !matches!(
            current.phase,
            AttemptPhase::Failed | AttemptPhase::Released | AttemptPhase::Cancelled
        )
    });
    let live_attempt = attempt.filter(|current| !current.phase.is_terminal());
    let expiry = live_attempt.and_then(|current| current.expiry_reason(context.as_of));
    let durable_recovery = facts
        .and_then(|facts| facts.recovery.as_present())
        .filter(|recovery| recovery.unresolved);
    let submitted = facts
        .and_then(|facts| facts.submission.as_present())
        .is_some_and(|submission| submission.state == SubmissionState::Sealed);
    // `review_required_after_expiry` is retained for old schemas, whose DDL
    // defaulted it to true even on newly claimed, unexpired attempts. It is
    // not itself proof that the deadline elapsed. Expiry is established by
    // the clock, an explicit expiry phase, or the durable recovery record.
    let expiry_pending = durable_recovery
        .is_some_and(|recovery| recovery.reason == RecoveryReason::Expired)
        || expiry.is_some()
        || attempt.is_some_and(|current| {
            matches!(
                current.phase,
                AttemptPhase::ExpiryPending | AttemptPhase::Expired
            )
        });
    let retry_at = context.retry_not_before.filter(|at| *at > context.as_of);

    // A schedule and a cycle/assignment activation are independent canonical
    // dispatch constraints.  The earliest future instant wins the primary
    // scheduled reason, while all other facts remain secondary reasons.  An
    // invalid schedule is fail-closed as an intervention fact; it is never
    // treated as an immediately claimable work item.
    let schedule_decision = context.schedule.map(|schedule| {
        evaluate_time_schedule(schedule, context.as_of, work.lifecycle.is_terminal())
    });
    let schedule_invalid = schedule_decision.as_ref().is_some_and(Result::is_err);
    let work_schedule_at = if work.lifecycle.is_terminal() {
        None
    } else {
        schedule_decision
            .as_ref()
            .and_then(|result| result.as_ref().ok())
            .filter(|decision| decision.scheduled)
            .and_then(|_| context.schedule.and_then(|schedule| schedule.not_before_at))
            .filter(|at| *at > context.as_of)
    };
    let activation_at = if work.lifecycle.is_terminal() {
        None
    } else {
        context.activation_at.filter(|at| *at > context.as_of)
    };
    let schedule_next_change_at = schedule_decision
        .as_ref()
        .and_then(|result| result.as_ref().ok())
        .and_then(|decision| decision.next_change_at);

    let business_schedule_decision = context.business_schedule.map(|schedule| {
        schedule.validate()?;
        if context.business_schedule_revision == Some(0)
            || (context.business_schedule_revision.is_some()
                && schedule_has_local_dates(schedule)
                && context.business_schedule_setting_revision.is_none())
        {
            return Err(crate::work_model_v3::ModelError::InvalidSchedule(
                "revisioned date-only schedule is missing its setting revision",
            ));
        }
        if let Some(business_time) = context.business_time {
            if business_time.as_of != context.as_of
                || business_time.project_id != work.project_id
                || context
                    .business_schedule_setting_revision
                    .is_some_and(|revision| revision > business_time.setting_revision)
            {
                return Err(crate::work_model_v3::ModelError::InvalidSchedule(
                    "business schedule context does not match the current project clock",
                ));
            }
            evaluate_business_schedule(schedule, business_time, work.lifecycle.is_terminal())
        } else if schedule_requires_project_clock(schedule) {
            Err(crate::work_model_v3::ModelError::InvalidSchedule(
                "date-only not-before schedule requires a validated project civil-time context",
            ))
        } else {
            let instant = |value: &Option<BusinessDate>| match value {
                Some(BusinessDate::Instant(at)) => Some(*at),
                Some(BusinessDate::ResolvedLocal(value)) => Some(value.utc_instant),
                _ => None,
            };
            let not_before = instant(&schedule.not_before);
            let due = instant(&schedule.due);
            Ok(BusinessScheduleView {
                available: not_before.is_none_or(|at| context.as_of >= at),
                due_today: false,
                overdue: !work.lifecycle.is_terminal()
                    && due.is_some_and(|at| context.as_of >= at),
                next_changes: [
                    not_before.filter(|at| *at > context.as_of),
                    (!work.lifecycle.is_terminal())
                        .then(|| due.filter(|at| *at > context.as_of))
                        .flatten(),
                ]
                .into_iter()
                .flatten()
                .map(BusinessDateBoundary::Instant)
                .collect(),
            })
        }
    });
    let business_schedule_invalid = business_schedule_decision
        .as_ref()
        .is_some_and(Result::is_err);
    let business_schedule_view = business_schedule_decision
        .as_ref()
        .and_then(|result| result.as_ref().ok());
    let business_schedule_available = business_schedule_view.is_none_or(|view| view.available);
    let business_not_before_at = if business_schedule_available || work.lifecycle.is_terminal() {
        None
    } else {
        context
            .business_schedule
            .and_then(|schedule| schedule.not_before.as_ref())
            .and_then(|value| match value {
                BusinessDate::LocalDate(_) => context.business_not_before_at,
                BusinessDate::Instant(at) => Some(*at),
                BusinessDate::ResolvedLocal(value) => Some(value.utc_instant),
            })
            .filter(|at| *at > context.as_of)
    };
    let business_schedule_next_change_at = context
        .business_schedule_next_change_at
        .or_else(|| {
            business_schedule_view.and_then(|view| {
                view.next_changes
                    .iter()
                    .filter_map(|boundary| match boundary {
                        BusinessDateBoundary::Instant(at) if *at > context.as_of => Some(*at),
                        _ => None,
                    })
                    .min()
            })
        });

    let mut blocking_external_wait_ids = Vec::new();
    let mut follow_up_due_wait_ids = Vec::new();
    let mut external_wait_invalid = false;
    for wait in context
        .external_waits
        .iter()
        .filter(|wait| wait.affected_work_id == work.id)
    {
        if wait.project_id != work.project_id {
            external_wait_invalid = true;
            continue;
        }
        match wait.state {
            ExternalWaitPersistedState::Open | ExternalWaitPersistedState::Unknown => {
                blocking_external_wait_ids.push(wait.wait_id.clone());
                if wait.state == ExternalWaitPersistedState::Unknown {
                    external_wait_invalid = true;
                    continue;
                }
                if let Some(follow_up) = &wait.follow_up {
                    let date_only = matches!(follow_up, BusinessDate::LocalDate(_));
                    if follow_up.validate().is_err()
                        || date_only != wait.civil_time_setting_revision.is_some()
                    {
                        external_wait_invalid = true;
                        continue;
                    }
                    if let Some(business_time) = context.business_time {
                        if business_time.as_of != context.as_of
                            || business_time.project_id != work.project_id
                            || wait
                                .civil_time_setting_revision
                                .is_some_and(|revision| revision > business_time.setting_revision)
                        {
                            external_wait_invalid = true;
                            continue;
                        }
                        let due = match follow_up {
                            BusinessDate::LocalDate(date) => business_time.civil_date >= *date,
                            BusinessDate::Instant(at) => *at <= context.as_of,
                            BusinessDate::ResolvedLocal(value) => {
                                value.utc_instant <= context.as_of
                            }
                        };
                        if due {
                            follow_up_due_wait_ids.push(wait.wait_id.clone());
                        }
                    } else if date_only {
                        external_wait_invalid = true;
                    } else if matches!(follow_up,
                        BusinessDate::Instant(at) if *at <= context.as_of
                    ) || matches!(follow_up,
                        BusinessDate::ResolvedLocal(value) if value.utc_instant <= context.as_of
                    ) {
                        follow_up_due_wait_ids.push(wait.wait_id.clone());
                    }
                }
            }
            ExternalWaitPersistedState::Resolved | ExternalWaitPersistedState::Cancelled => {}
        }
    }
    blocking_external_wait_ids.sort();
    blocking_external_wait_ids.dedup();
    follow_up_due_wait_ids.sort();
    follow_up_due_wait_ids.dedup();
    let scheduled_at = [work_schedule_at, activation_at, business_not_before_at]
        .into_iter()
        .flatten()
        .min();

    let exception_satisfies = |gate_id: &crate::GateId| {
        facts.is_some_and(|facts| {
            facts.requirements.as_present().is_some_and(|requirements| {
                requirements
                    .requirements
                    .iter()
                    .find(|gate| &gate.gate_id == gate_id)
                    .is_some_and(|gate| {
                        gate.exception.as_ref().is_some_and(|exception| {
                            exception.applies(
                                gate.state,
                                facts.subject.revision,
                                requirements.proof.proof_revision,
                                context.as_of,
                            )
                        })
                    })
            })
        })
    };
    let mut reasons = Vec::new();
    let mut hard_reasons = work.hard_holds.clone();
    if facts.is_some_and(|facts| facts.validate().is_err()) {
        hard_reasons.push(ReasonCode::HardHold("integrity_quarantined".into()));
    }
    if let Some(recovery) = durable_recovery {
        if recovery.reason != RecoveryReason::Expired {
            hard_reasons.push(ReasonCode::HardHold("recovery_required".into()));
        }
    }
    if let Some(review) = facts.and_then(|facts| facts.review.as_present()) {
        if matches!(
            review.outcome,
            ReviewOutcome::Rejected | ReviewOutcome::Returned | ReviewOutcome::Revoked
        ) && context.gates.iter().any(|gate| {
            gate.required
                && gate.kind == GateKind::Review
                && gate.state == GateState::Failed
                && !exception_satisfies(&gate.id)
        }) {
            hard_reasons.push(ReasonCode::HardHold(format!(
                "review_{}",
                match review.outcome {
                    ReviewOutcome::Rejected => "rejected",
                    ReviewOutcome::Returned => "returned",
                    _ => "revoked",
                }
            )));
        }
    }
    if schedule_invalid {
        hard_reasons.push(ReasonCode::HardHold("schedule_invalid".into()));
    }
    if business_schedule_invalid {
        hard_reasons.push(ReasonCode::HardHold("business_schedule_invalid".into()));
    }
    if external_wait_invalid {
        hard_reasons.push(ReasonCode::HardHold("external_wait_invalid".into()));
    }

    let mut prerequisites = match facts.and_then(|facts| facts.dependencies.as_present()) {
        Some(dependencies) => dependencies
            .edges
            .iter()
            .filter(|edge| edge.outcome != DependencyOutcome::Closed && edge.waiver.is_none())
            .map(|edge| ReasonCode::PrerequisiteOpen(edge.predecessor.work_id.clone()))
            .collect::<Vec<_>>(),
        None => context
            .prerequisites
            .iter()
            .filter(|item| item.lifecycle != PersistedLifecycle::Closed)
            .map(|item| ReasonCode::PrerequisiteOpen(item.id.clone()))
            .collect::<Vec<_>>(),
    };
    prerequisites.extend(
        blocking_external_wait_ids
            .iter()
            .cloned()
            .map(ReasonCode::ExternalWaitOpen),
    );
    sort_reasons(&mut prerequisites);

    if attempt.is_some_and(|current| current.work_id != work.id || work.kind != WorkKind::Task) {
        hard_reasons.push(ReasonCode::AttemptSubjectMismatch);
    }

    // A required declaration missing from the snapshot, or a row whose
    // identity/type disagrees with that declaration, is integrity/configuration
    // intervention. An open gate is ordinary proof state, not a configuration
    // failure.
    for declared in &work.acceptance_profile.gates {
        let actual = context.gates.iter().find(|gate| gate.id == declared.id);
        match actual {
            None if declared.required => {
                hard_reasons.push(ReasonCode::GateMissing(declared.id.clone()));
            }
            Some(actual)
                if actual.kind != declared.kind || actual.required != declared.required =>
            {
                hard_reasons.push(ReasonCode::GateInvalid(declared.id.clone()));
            }
            _ => {}
        }
    }
    let mut gate_ids = std::collections::BTreeSet::new();
    for gate in context.gates {
        if !gate_ids.insert(gate.id.clone()) {
            hard_reasons.push(ReasonCode::GateInvalid(gate.id.clone()));
        }
    }

    let mut gaps = context
        .gates
        .iter()
        .filter(|gate| {
            gate.required && gate.state != GateState::Satisfied && !exception_satisfies(&gate.id)
        })
        .map(|gate| gate.id.clone())
        .collect::<Vec<_>>();
    gaps.extend(
        work.acceptance_profile
            .gates
            .iter()
            .filter(|declared| declared.required && !gate_ids.contains(&declared.id))
            .map(|declared| declared.id.clone()),
    );
    gaps.sort();
    gaps.dedup();

    // Open proof facts are only actionable once an attempt has submitted a
    // result. Failed facts are durable submission/review outcomes, though, so
    // they remain authoritative after execution ownership is released. A
    // failed technical gate remains a verification gap. A failed review is a
    // hard reconciliation obligation and can never be relabeled proof-missing.
    let proof_phase = submitted
        || attempt.is_some_and(|current| {
            matches!(
                current.phase,
                AttemptPhase::Verifying | AttemptPhase::Completed
            )
        });
    for gate in context.gates.iter().filter(|gate| gate.required) {
        match gate.state {
            GateState::Open if proof_phase => {
                reasons.push(ReasonCode::GateOpen(gate.id.clone()));
            }
            GateState::Failed
                if gate.kind == GateKind::Review && !exception_satisfies(&gate.id) =>
            {
                hard_reasons.push(ReasonCode::ReviewRejected(gate.id.clone()));
            }
            GateState::Failed => reasons.push(ReasonCode::GateFailed(gate.id.clone())),
            GateState::Open | GateState::Satisfied => {}
        }
    }

    reasons.extend(work.hard_holds.iter().cloned());
    if attempt.is_some_and(|current| current.work_id != work.id || work.kind != WorkKind::Task) {
        reasons.push(ReasonCode::AttemptSubjectMismatch);
    }
    reasons.extend(
        hard_reasons
            .iter()
            .filter(|reason| {
                !work.hard_holds.contains(reason)
                    && **reason != ReasonCode::AttemptSubjectMismatch
                    && !matches!(
                        reason,
                        ReasonCode::GateMissing(_) | ReasonCode::GateInvalid(_)
                    )
            })
            .cloned(),
    );
    // Configuration reasons are useful even before proof begins.
    reasons.extend(
        hard_reasons
            .iter()
            .filter(|reason| {
                matches!(
                    reason,
                    ReasonCode::GateMissing(_) | ReasonCode::GateInvalid(_)
                )
            })
            .cloned(),
    );
    reasons.extend(prerequisites.iter().cloned());

    if work.lifecycle == PersistedLifecycle::Draft {
        reasons.push(ReasonCode::NotPublished);
    }
    match work.dispatch_policy {
        DispatchPolicy::Paused => reasons.push(ReasonCode::Paused),
        DispatchPolicy::OperatorOnly => reasons.push(ReasonCode::OperatorOnly),
        DispatchPolicy::Automatic => {}
    }
    if work.kind == WorkKind::Task
        && matches!(
            context.actor.role,
            ActorRole::Reviewer | ActorRole::Publisher
        )
    {
        reasons.push(ReasonCode::RoleDenied);
    }
    if let Some(at) = retry_at {
        reasons.push(ReasonCode::RetryNotBefore(at));
    }
    if let Some(at) = scheduled_at {
        reasons.push(ReasonCode::ScheduledStart(at));
    }
    if expiry_pending {
        reasons.push(ReasonCode::ExpiryReviewRequired);
    }
    // Expired attempts remain in the input as an expiry-review obligation.
    // Their durable deadlines still explain why expiry occurred, even though
    // the execution phase is terminal and therefore not a live attempt.
    if let Some(current) = attempt {
        if context.as_of >= current.lease_deadline {
            reasons.push(ReasonCode::LeaseElapsed);
        }
        if context.as_of >= current.max_attempt_deadline {
            reasons.push(ReasonCode::HardBudgetElapsed);
        }
        match current.phase {
            AttemptPhase::Claimed => reasons.push(ReasonCode::AttemptUnaccepted),
            AttemptPhase::Accepted | AttemptPhase::Running => {
                reasons.push(ReasonCode::AttemptActive)
            }
            _ => {}
        }
    }

    // Status precedence is independent of the lexical reason order. In
    // particular, expiry wins the hold tie, and a rejected review wins the
    // proof-gap alternatives by becoming a hard block.
    let (display_status, claimable, action, primary) =
        if work.lifecycle == PersistedLifecycle::Closed {
            pending(DerivedStatus::Closed, None, ReasonCode::TerminalClosed)
        } else if work.lifecycle == PersistedLifecycle::Cancelled {
            pending(
                DerivedStatus::Cancelled,
                None,
                ReasonCode::TerminalCancelled,
            )
        } else if expiry_pending {
            pending(
                DerivedStatus::ExpiredReview,
                Some(DomainAction::ReviewExpiry),
                ReasonCode::ExpiryReviewRequired,
            )
        } else if let Some(reason) = select_hard_reason(&hard_reasons) {
            pending(
                DerivedStatus::Blocked,
                Some(DomainAction::ResolveHold),
                reason,
            )
        } else if work.lifecycle == PersistedLifecycle::Draft {
            pending(
                DerivedStatus::Draft,
                Some(DomainAction::PublishWork),
                ReasonCode::NotPublished,
            )
        } else if let Some(current) = attempt {
            match current.phase {
                AttemptPhase::Claimed => pending(
                    DerivedStatus::Claimed,
                    Some(DomainAction::AcceptAttempt),
                    ReasonCode::AttemptUnaccepted,
                ),
                AttemptPhase::Accepted | AttemptPhase::Running => pending(
                    DerivedStatus::InProgress,
                    Some(DomainAction::ResumeAttempt),
                    ReasonCode::AttemptActive,
                ),
                AttemptPhase::Verifying | AttemptPhase::Completed => {
                    proof_decision(context.gates, &gaps)
                }
                AttemptPhase::Failed | AttemptPhase::Released | AttemptPhase::Cancelled => {
                    unreachable!("historical attempts were filtered")
                }
                AttemptPhase::ExpiryPending | AttemptPhase::Expired => pending(
                    DerivedStatus::ExpiredReview,
                    Some(DomainAction::ReviewExpiry),
                    ReasonCode::ExpiryReviewRequired,
                ),
            }
        } else if submitted
            || context.gates.iter().any(|gate| {
                gate.required && gate.state == GateState::Failed && gate.kind != GateKind::Review
            })
        {
            proof_decision(context.gates, &gaps)
        } else if work.dispatch_policy == DispatchPolicy::Paused {
            pending(
                DerivedStatus::Paused,
                Some(DomainAction::ResumePolicy),
                ReasonCode::Paused,
            )
        } else if let Some(at) = retry_at {
            pending(
                DerivedStatus::RetryWait,
                Some(DomainAction::WaitUntil),
                ReasonCode::RetryNotBefore(at),
            )
        } else if let Some(at) = scheduled_at {
            pending(
                DerivedStatus::Scheduled,
                Some(DomainAction::WaitUntil),
                ReasonCode::ScheduledStart(at),
            )
        } else if let Some(reason) = prerequisites.first() {
            pending(
                DerivedStatus::Queued,
                Some(DomainAction::WaitForPrerequisite),
                reason.clone(),
            )
        } else if work.kind != WorkKind::Task {
            // Provisional planning label, not a descendant rollup or launch
            // signal. Container rollups are a later bounded domain slice.
            pending(DerivedStatus::Queued, None, ReasonCode::ContainerPlanning)
        } else {
            eligibility(work, context.actor)
        };

    // Only exact duplicate facts are removed. Distinct typed variants that
    // happen to share a display code must not erase one another.
    reasons.retain(|reason| reason != &primary);
    sort_reasons(&mut reasons);
    reasons.insert(0, primary.clone());

    // Timers belong to this evaluator, not to individual read adapters. A
    // secondary reason disappearing is also a status-snapshot change.
    let next_status_change_at = if work.lifecycle.is_terminal() || expiry_pending {
        None
    } else {
        live_attempt
            .into_iter()
            .flat_map(|current| [current.lease_deadline, current.max_attempt_deadline])
            .chain(retry_at)
            .chain(scheduled_at)
            .chain(schedule_next_change_at)
            .chain(business_schedule_next_change_at)
            .chain(context.external_wait_next_change_at)
            .filter(|at| *at > context.as_of)
            .min()
    };
    let mut dependents = context.affected_dependents.to_vec();
    dependents.sort();
    dependents.dedup();

    StatusDecision {
        work_id: work.id.clone(),
        project_revision: context.project_revision,
        as_of: context.as_of,
        next_status_change_at,
        due_today: business_schedule_view.is_some_and(|view| view.due_today),
        overdue: business_schedule_view.is_some_and(|view| view.overdue),
        blocking_external_wait_ids,
        follow_up_due_wait_ids,
        display_status,
        primary_reason: primary,
        reason_codes: reasons,
        claimable_for_actor: claimable,
        next_action: action,
        current_attempt: attempt.map(|current| CurrentAttempt {
            attempt_id: current.attempt_id.clone(),
            fence: current.fence,
            phase: current.phase,
        }),
        gate_gaps: gaps,
        affected_dependents: dependents,
    }
}

fn schedule_has_local_dates(schedule: &crate::work_model_v3::BusinessSchedule) -> bool {
    [
        schedule.not_before.as_ref(),
        schedule.due.as_ref(),
        schedule.planned_start.as_ref(),
        schedule.planned_end.as_ref(),
    ]
    .into_iter()
    .flatten()
    .any(|value| matches!(value, BusinessDate::LocalDate(_)))
}

fn schedule_requires_project_clock(schedule: &crate::work_model_v3::BusinessSchedule) -> bool {
    matches!(schedule.not_before.as_ref(), Some(BusinessDate::LocalDate(_)))
}

fn sort_reasons(reasons: &mut Vec<ReasonCode>) {
    reasons.sort_by_key(ReasonCode::stable_code);
    reasons.dedup();
}

/// Hard reasons use the production registry's intervention/configuration
/// priority, with stable-code tie-breaking for same-class facts. This keeps a
/// rejected review from being mistaken for a missing gate and keeps a named
/// operator hold ahead of ordinary configuration diagnostics.
fn select_hard_reason(reasons: &[ReasonCode]) -> Option<ReasonCode> {
    reasons
        .iter()
        .min_by(|left, right| {
            hard_reason_priority(left)
                .cmp(&hard_reason_priority(right))
                .then_with(|| left.stable_code().cmp(&right.stable_code()))
        })
        .cloned()
}

fn hard_reason_priority(reason: &ReasonCode) -> u8 {
    match reason {
        ReasonCode::HardHold(code) if code == "integrity_quarantined" => 32,
        ReasonCode::HardHold(code) if code == "requirements_missing" => 33,
        ReasonCode::HardHold(_) => 30,
        ReasonCode::ReviewRejected(_) => 31,
        ReasonCode::AttemptSubjectMismatch => 32,
        ReasonCode::GateInvalid(_) => 32,
        ReasonCode::GateMissing(_) => 33,
        _ => 34,
    }
}

fn pending(
    status: DerivedStatus,
    action: Option<DomainAction>,
    reason: ReasonCode,
) -> PrimaryDecision {
    (status, false, action, reason)
}

fn eligibility(work: &WorkItem, actor: &ActorContext) -> PrimaryDecision {
    if work.dispatch_policy == DispatchPolicy::OperatorOnly {
        let allowed = actor.role == ActorRole::Operator;
        let action = if allowed {
            DomainAction::Claim
        } else {
            DomainAction::RequestOperatorClaim
        };
        return (
            DerivedStatus::Ready,
            allowed,
            Some(action),
            ReasonCode::OperatorOnly,
        );
    }
    if actor.role == ActorRole::Agent {
        (
            DerivedStatus::Ready,
            true,
            Some(DomainAction::Claim),
            ReasonCode::Eligible,
        )
    } else if actor.role == ActorRole::Operator {
        // Operator authority is for explicit operator-only dispatch and
        // recovery/policy actions, not ordinary agent execution.
        pending(DerivedStatus::Ready, None, ReasonCode::RoleDenied)
    } else {
        pending(
            DerivedStatus::Ready,
            Some(DomainAction::RequestOperatorClaim),
            ReasonCode::RoleDenied,
        )
    }
}

fn proof_decision(gates: &[GateRequirement], gaps: &[GateId]) -> PrimaryDecision {
    if gaps.is_empty() {
        return pending(
            DerivedStatus::Complete,
            Some(DomainAction::FinishClose),
            ReasonCode::CloseoutPending,
        );
    }
    // Persisted gate IDs are work-scoped (for example "task:review"). Kind,
    // not the bare string "review", determines whether only review remains.
    let only_review = gaps.iter().all(|id| {
        gates
            .iter()
            .any(|gate| gate.id == *id && gate.kind == GateKind::Review)
    });
    if only_review {
        pending(
            DerivedStatus::AwaitingReview,
            Some(DomainAction::RequestReview),
            ReasonCode::ReviewRequired,
        )
    } else {
        pending(
            DerivedStatus::NeedsVerification,
            Some(DomainAction::ProvideEvidence),
            ReasonCode::VerificationRequired,
        )
    }
}

#[cfg(test)]
mod business_status_tests {
    use super::*;
    use crate::decision_inputs::{ExternalWaitPersistedState, ExternalWaitScopeInput};
    use crate::work_model_v3::{BusinessDate, BusinessSchedule, BusinessTimeContext, LocalDate};
    use crate::{AcceptanceProfile, ActorId, ProjectId, Revision, TimestampMs};

    fn work() -> WorkItem {
        WorkItem {
            id: "work-1".into(),
            project_id: ProjectId::new("project-1"),
            kind: WorkKind::Task,
            parent_id: None,
            title: "Prepare release".into(),
            description: String::new(),
            lifecycle: PersistedLifecycle::Open,
            priority: 0,
            dispatch_policy: DispatchPolicy::Automatic,
            hard_holds: Vec::new(),
            acceptance_profile: AcceptanceProfile::focused(),
        }
    }

    fn actor() -> ActorContext {
        ActorContext {
            actor_id: ActorId::new("agent-1"),
            role: ActorRole::Agent,
        }
    }

    fn business_time() -> BusinessTimeContext {
        BusinessTimeContext {
            project_id: ProjectId::new("project-1"),
            setting_revision: 3,
            as_of: TimestampMs(1_800_000_000_000),
            civil_date: LocalDate::new(2027, 1, 15),
            timezone: "Etc/UTC".into(),
            tzdb_identity: "sha256:test-zone".into(),
        }
    }

    #[test]
    fn date_only_deadlines_and_waits_use_project_local_day() {
        let work = work();
        let actor = actor();
        let time = business_time();
        let schedule = BusinessSchedule {
            due: Some(BusinessDate::LocalDate(LocalDate::new(2027, 1, 15))),
            ..BusinessSchedule::default()
        };
        let waits = [ExternalWaitScopeInput {
            project_id: work.project_id.clone(),
            wait_id: "decision-1".into(),
            affected_work_id: work.id.clone(),
            state: ExternalWaitPersistedState::Open,
            follow_up: Some(BusinessDate::LocalDate(LocalDate::new(2027, 1, 15))),
            civil_time_setting_revision: Some(3),
        }];
        let mut context = StatusContext::new(
            &work,
            &[],
            None,
            &work.acceptance_profile.gates,
            &actor,
            time.as_of,
            Revision(12),
        );
        context.business_schedule = Some(&schedule);
        context.business_schedule_revision = Some(4);
        context.business_schedule_setting_revision = Some(2);
        context.business_time = Some(&time);
        context.external_waits = &waits;

        let decision = evaluate_status(context);

        assert!(decision.due_today);
        assert!(!decision.overdue);
        assert_eq!(decision.blocking_external_wait_ids, ["decision-1"]);
        assert_eq!(decision.follow_up_due_wait_ids, ["decision-1"]);
        assert_eq!(decision.display_status, DerivedStatus::Queued);
        assert!(decision.reason_codes.contains(&ReasonCode::ExternalWaitOpen(
            "decision-1".into()
        )));
    }

    #[test]
    fn date_only_schedule_without_project_clock_fails_closed() {
        let work = work();
        let actor = actor();
        let schedule = BusinessSchedule {
            not_before: Some(BusinessDate::LocalDate(LocalDate::new(2027, 1, 16))),
            ..BusinessSchedule::default()
        };
        let mut context = StatusContext::new(
            &work,
            &[],
            None,
            &work.acceptance_profile.gates,
            &actor,
            TimestampMs(1_800_000_000_000),
            Revision(12),
        );
        context.business_schedule = Some(&schedule);
        context.business_schedule_revision = Some(4);
        context.business_schedule_setting_revision = Some(3);

        let decision = evaluate_status(context);

        assert_eq!(decision.display_status, DerivedStatus::Blocked);
        assert!(!decision.claimable_for_actor);
        assert!(decision
            .reason_codes
            .contains(&ReasonCode::HardHold("business_schedule_invalid".into())));
    }

    #[test]
    fn date_only_due_without_project_clock_stays_informational() {
        let work = work();
        let actor = actor();
        let schedule = BusinessSchedule {
            due: Some(BusinessDate::LocalDate(LocalDate::new(2027, 1, 16))),
            ..BusinessSchedule::default()
        };
        let mut context = StatusContext::new(
            &work,
            &[],
            None,
            &work.acceptance_profile.gates,
            &actor,
            TimestampMs(1_800_000_000_000),
            Revision(12),
        );
        context.business_schedule = Some(&schedule);
        context.business_schedule_revision = Some(4);
        context.business_schedule_setting_revision = Some(3);

        let decision = evaluate_status(context);

        assert!(decision.claimable_for_actor);
        assert!(!decision.due_today);
        assert!(!decision.overdue);
        assert!(!decision
            .reason_codes
            .contains(&ReasonCode::HardHold("business_schedule_invalid".into())));
    }
}
