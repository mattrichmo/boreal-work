//! One pure decision over canonical inputs. Reads and transactional claim
//! authorization both call this function; adapters must not repair its result.
use crate::{
    ActorContext, ActorRole, AttemptPhase, CurrentAttempt, DerivedStatus, DispatchPolicy,
    DomainAction, GateId, GateKind, GateRequirement, GateState, PersistedLifecycle, ReasonCode,
    StatusContext, StatusDecision, WorkItem, WorkKind,
};

type PrimaryDecision = (DerivedStatus, bool, Option<DomainAction>, ReasonCode);

/// Evaluate the status contract in one fixed precedence pass.
///
/// Every applicable fact is collected before the primary branch is selected.
/// This is important for combined states: a paused dependent stays paused but
/// still reports its open prerequisites, and an expired attempt stays in
/// expiry review while retaining both elapsed clocks and any hard hold.
pub fn evaluate_status(context: StatusContext<'_>) -> StatusDecision {
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
    let expiry_pending = expiry.is_some()
        || attempt.is_some_and(|current| {
            matches!(
                current.phase,
                AttemptPhase::ExpiryPending | AttemptPhase::Expired
            ) || current.review_required_after_expiry
        });
    let retry_at = context.retry_not_before.filter(|at| *at > context.as_of);

    let mut reasons = Vec::new();
    let mut hard_reasons = work.hard_holds.clone();

    let mut prerequisites = context
        .prerequisites
        .iter()
        .filter(|item| item.lifecycle != PersistedLifecycle::Closed)
        .map(|item| ReasonCode::PrerequisiteOpen(item.id.clone()))
        .collect::<Vec<_>>();
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
        .filter(|gate| gate.required && gate.state != GateState::Satisfied)
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
    let proof_phase = attempt.is_some_and(|current| {
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
            GateState::Failed if gate.kind == GateKind::Review => {
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
        } else if context.gates.iter().any(|gate| {
            gate.required && gate.state == GateState::Failed && gate.kind != GateKind::Review
        }) {
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
    if matches!(actor.role, ActorRole::Agent | ActorRole::Operator) {
        (
            DerivedStatus::Ready,
            true,
            Some(DomainAction::Claim),
            ReasonCode::Eligible,
        )
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
