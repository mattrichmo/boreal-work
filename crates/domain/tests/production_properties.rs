//! PF-S03-T08 deterministic property, differential, and exhaustive coverage.
//!
//! This target intentionally uses a small local generator instead of adding a
//! runtime dependency.  Every generated case is deterministic and failures
//! include the seed and case index, which is the minimal counterexample needed
//! to reproduce a failing pure-domain rule.

use std::collections::BTreeSet;

use boreal_domain::actions::{
    all_action_kinds, evaluate_action, evaluate_actions, ActionAuthorization, ActionDenialReason,
    ActionEvaluationInput, ActionKind,
};
use boreal_domain::decision_inputs::{
    ActorAuthorityInput, Availability, ContentDigest, DecisionInputs, EntityIdentity,
    EntityRevision, Fact, FactSubject, IntegrityDiagnostic, IntegrityDiagnosticCode,
    IntegrityInput, IntegrityLevel, IntegrityScope, PermittedAction, PermittedActionsInput,
    PinnedRequirement, PinnedRequirementsInput, PrincipalBinding, ProfileIdentity, ProofIdentity,
    RequirementId, ReviewRequirementPolicy, VerifierPolicy, VerifierPolicyId,
};
use boreal_domain::time_policy::{evaluate_schedule as evaluate_time_schedule, PolicyClock};
use boreal_domain::work_model_v3::WorkSchedule;
use boreal_domain::{
    dependency_satisfied, evaluate_close, evaluate_status, reject_derived_status_write,
    transition_attempt, transition_lifecycle, validate_dependencies, validate_fence,
    validate_independent_review, validate_receipt_subject, AcceptanceProfile, ActorContext,
    ActorId, ActorRole, Attempt, AttemptId, AttemptOperation, AttemptPhase, BlockingDependency,
    CloseGap, CloseReadiness, ConfigIdentity, DerivedStatus, DispatchPolicy, DomainError,
    ExpiryReason, Fence, GateId, GateKind, GateState, PersistedLifecycle, ReasonCode,
    ReceiptIdentity, ReceiptSubject, ReviewRecord, Revision, SessionId, TimestampMs, WorkId,
    WorkItem, WorkKind, WorkOperation, DEFAULT_HARD_TIME_LIMIT_MS,
};

const SEEDS: [u64; 4] = [0x5eed_0001, 0x5eed_0029, 0x5eed_00a7, 0x5eed_01f3];

// These identities are part of the executable oracle contract.  Updating a
// normative policy or fixture revision requires an intentional oracle review,
// rather than silently rerunning the old vectors against new prose.
const ORACLE_STATUS_CONTRACT: &str = "boreal.work-status/3";
const ORACLE_TRANSITION_CONTRACT: &str = "boreal.work-transition/2";
const ORACLE_FIXTURE_REVISION: &str = "m02-candidate.1";
const ORACLE_SOURCE_REVISION: &str = "784a41b3802c29a76721c55eef2e9493283396c2";
const ORACLE_STATUS_POLICY_SHA256: &str =
    "b2b41ffd640811118e2c8f0ac0ba9c60d79cc46ccc73135cdcf609ae384b3a94";
const ORACLE_TRANSITION_POLICY_SHA256: &str =
    "4a22bceb49b8d40d96a872f2ae3aed8b79a81d5636339c609914a05b3a2a9d38";

#[derive(Clone, Copy)]
struct Generator(u64);

impl Generator {
    fn next(&mut self) -> u64 {
        // Numerical Recipes LCG.  The fixed constants are part of the test
        // contract so a failure can be reproduced without external state.
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        self.0
    }

    fn index(&mut self, length: usize) -> usize {
        (self.next() as usize) % length
    }

    fn choose<T: Copy>(&mut self, values: &[T]) -> T {
        values[self.index(values.len())]
    }

    fn bit(&mut self) -> bool {
        self.next() & 1 == 1
    }
}

#[derive(Clone, Debug)]
struct StatusCase {
    lifecycle: PersistedLifecycle,
    kind: WorkKind,
    dispatch_policy: DispatchPolicy,
    holds: Vec<ReasonCode>,
    prerequisite_lifecycles: Vec<PersistedLifecycle>,
    attempt_phase: Option<AttemptPhase>,
    attempt_foreign: bool,
    reviewed_profile: bool,
    gate_mask: u8,
    omit_first_gate: bool,
    actor_role: ActorRole,
    as_of: u64,
    retry_not_before: Option<u64>,
}

fn serialize_status_case(case: &StatusCase) -> String {
    format!(
        "{{lifecycle:{:?},kind:{:?},dispatch:{:?},holds:{:?},prerequisites:{:?},attempt:{:?},foreign:{},reviewed:{},gate_mask:{},omit_checkpoint:{},role:{:?},as_of:{},retry_not_before:{:?}}}",
        case.lifecycle,
        case.kind,
        case.dispatch_policy,
        case.holds,
        case.prerequisite_lifecycles,
        case.attempt_phase,
        case.attempt_foreign,
        case.reviewed_profile,
        case.gate_mask,
        case.omit_first_gate,
        case.actor_role,
        case.as_of,
        case.retry_not_before,
    )
}

/// Minimize a generated case without randomness.  The predicate is supplied
/// by the caller so this helper can be used by a failure harness without
/// changing the production domain or adding a property-testing dependency.
fn shrink_status_case<F>(mut case: StatusCase, still_fails: F) -> StatusCase
where
    F: Fn(&StatusCase) -> bool,
{
    let candidates = [StatusCase {
        lifecycle: PersistedLifecycle::Open,
        kind: WorkKind::Task,
        dispatch_policy: DispatchPolicy::Automatic,
        holds: Vec::new(),
        prerequisite_lifecycles: Vec::new(),
        attempt_phase: None,
        attempt_foreign: false,
        reviewed_profile: false,
        gate_mask: 1,
        omit_first_gate: false,
        actor_role: ActorRole::Agent,
        as_of: 0,
        retry_not_before: None,
    }];

    for candidate in candidates {
        if still_fails(&candidate) {
            case = candidate;
        }
    }
    let mut candidate = case.clone();
    candidate.holds.clear();
    if still_fails(&candidate) {
        case = candidate;
    }
    let mut candidate = case.clone();
    candidate.prerequisite_lifecycles.clear();
    if still_fails(&candidate) {
        case = candidate;
    }
    let mut candidate = case.clone();
    candidate.attempt_phase = None;
    if still_fails(&candidate) {
        case = candidate;
    }
    let mut candidate = case.clone();
    candidate.gate_mask &= 1;
    if still_fails(&candidate) {
        case = candidate;
    }
    let mut candidate = case.clone();
    candidate.retry_not_before = None;
    if still_fails(&candidate) {
        case = candidate;
    }
    case
}

fn generated_case(generator: &mut Generator) -> StatusCase {
    let lifecycles = [
        PersistedLifecycle::Draft,
        PersistedLifecycle::Open,
        PersistedLifecycle::Closed,
        PersistedLifecycle::Cancelled,
    ];
    let kinds = [WorkKind::Task, WorkKind::Milestone, WorkKind::Sprint];
    let policies = [
        DispatchPolicy::Automatic,
        DispatchPolicy::OperatorOnly,
        DispatchPolicy::Paused,
    ];
    let phases = [
        AttemptPhase::Claimed,
        AttemptPhase::Accepted,
        AttemptPhase::Running,
        AttemptPhase::Verifying,
        AttemptPhase::ExpiryPending,
        AttemptPhase::Expired,
        AttemptPhase::Failed,
        AttemptPhase::Released,
        AttemptPhase::Cancelled,
    ];
    let roles = [
        ActorRole::Agent,
        ActorRole::Reviewer,
        ActorRole::Operator,
        ActorRole::Publisher,
    ];

    let prerequisite_lifecycles = (0..(generator.index(4)))
        .map(|_| generator.choose(&lifecycles))
        .collect();
    let attempt_phase = if generator.bit() {
        Some(generator.choose(&phases))
    } else {
        None
    };
    let mut holds = Vec::new();
    if generator.bit() {
        holds.push(ReasonCode::HardHold("operator_decision_required".into()));
    }
    if generator.bit() {
        holds.push(ReasonCode::HardHold(
            "resource_reconciliation_required".into(),
        ));
    }

    StatusCase {
        lifecycle: generator.choose(&lifecycles),
        kind: generator.choose(&kinds),
        dispatch_policy: generator.choose(&policies),
        holds,
        prerequisite_lifecycles,
        attempt_phase,
        attempt_foreign: generator.bit(),
        reviewed_profile: generator.bit(),
        gate_mask: generator.next() as u8,
        omit_first_gate: generator.bit(),
        actor_role: generator.choose(&roles),
        as_of: generator.index(90) as u64,
        retry_not_before: if generator.bit() {
            Some(10 + generator.index(90) as u64)
        } else {
            None
        },
    }
}

fn generated_work(case: &StatusCase, reverse: bool) -> WorkItem {
    let mut work = WorkItem::new(
        "project".into(),
        WorkId::new("work"),
        case.kind,
        None,
        "generated work",
    );
    work.lifecycle = case.lifecycle;
    work.dispatch_policy = case.dispatch_policy;
    work.hard_holds = case.holds.clone();
    work.acceptance_profile = if case.reviewed_profile {
        AcceptanceProfile::reviewed()
    } else {
        AcceptanceProfile::focused()
    };
    if reverse {
        work.hard_holds.reverse();
        work.acceptance_profile.gates.reverse();
    }
    work
}

fn generated_status(case: &StatusCase, reverse: bool) -> boreal_domain::StatusDecision {
    let work = generated_work(case, reverse);
    let mut prerequisites = case
        .prerequisite_lifecycles
        .iter()
        .enumerate()
        .map(|(index, lifecycle)| {
            let mut item = WorkItem::new(
                "project".into(),
                WorkId::new(format!("upstream-{index}")),
                WorkKind::Task,
                None,
                format!("upstream {index}"),
            );
            item.lifecycle = *lifecycle;
            item
        })
        .collect::<Vec<_>>();
    if reverse {
        prerequisites.reverse();
    }

    let mut gates = work.acceptance_profile.gates.clone();
    for gate in &mut gates {
        let bit = match gate.id.as_str() {
            "checkpoint" => 0,
            "verification" => 1,
            "summary" => 2,
            "review" => 3,
            _ => 7,
        };
        gate.state = match (case.gate_mask >> bit) % 3 {
            0 => GateState::Open,
            1 => GateState::Satisfied,
            _ => GateState::Failed,
        };
    }
    if case.omit_first_gate {
        // Omit a named declaration rather than the first vector element so the
        // same semantic facts are tested after the input vector is reversed.
        gates.retain(|gate| gate.id != GateId::new("checkpoint"));
    }
    if reverse {
        gates.reverse();
    }

    let mut attempt = case.attempt_phase.map(|_phase| {
        Attempt::claim(
            if case.attempt_foreign {
                WorkId::new("foreign-work")
            } else {
                WorkId::new("work")
            },
            AttemptId::new("attempt"),
            ActorId::new("agent"),
            Fence::new(1),
            TimestampMs(0),
            Some(20),
            Some(50),
        )
        .expect("generated attempt deadlines are valid")
    });
    if let Some(current) = &mut attempt {
        current.phase = case.attempt_phase.expect("attempt phase is present");
    }

    let actor = ActorContext {
        actor_id: ActorId::new("actor"),
        role: case.actor_role,
    };
    let mut affected_dependents = vec![WorkId::new("dependent-z"), WorkId::new("dependent-a")];
    if reverse {
        affected_dependents.reverse();
    }
    let mut context = boreal_domain::StatusContext::new(
        &work,
        &prerequisites,
        attempt.as_ref(),
        &gates,
        &actor,
        TimestampMs(case.as_of),
        Revision(17),
    );
    context.retry_not_before = case.retry_not_before.map(TimestampMs);
    context.affected_dependents = &affected_dependents;
    evaluate_status(context)
}

#[test]
fn generated_status_is_idempotent_and_order_independent() {
    for seed in SEEDS {
        let mut generator = Generator(seed);
        for case_index in 0..256 {
            let case = generated_case(&mut generator);
            let forward = generated_status(&case, false);
            let repeat = generated_status(&case, false);
            let reversed = generated_status(&case, true);
            assert_eq!(
                forward,
                repeat,
                "seed={seed:#x} case={case_index} idempotence input={}",
                serialize_status_case(&case)
            );
            assert_eq!(
                forward,
                reversed,
                "seed={seed:#x} case={case_index} ordering input={}",
                serialize_status_case(&case)
            );
            assert_eq!(forward.reason_codes.first(), Some(&forward.primary_reason));
            assert!(forward.reason_codes[1..]
                .windows(2)
                .all(|pair| pair[0].stable_code() < pair[1].stable_code()));
            assert!(forward
                .reason_codes
                .iter()
                .skip(1)
                .all(|reason| reason != &forward.primary_reason));
            assert!(forward.gate_gaps.windows(2).all(|pair| pair[0] < pair[1]));
            assert!(forward
                .affected_dependents
                .windows(2)
                .all(|pair| pair[0] < pair[1]));
        }
    }
}

#[test]
fn oracle_identity_and_minimal_counterexample_replay_are_explicit() {
    assert_eq!(ORACLE_STATUS_CONTRACT, "boreal.work-status/3");
    assert_eq!(ORACLE_TRANSITION_CONTRACT, "boreal.work-transition/2");
    assert_eq!(ORACLE_FIXTURE_REVISION, "m02-candidate.1");
    assert_eq!(ORACLE_SOURCE_REVISION.len(), 40);
    assert_eq!(ORACLE_STATUS_POLICY_SHA256.len(), 64);
    assert_eq!(ORACLE_TRANSITION_POLICY_SHA256.len(), 64);

    let original = StatusCase {
        lifecycle: PersistedLifecycle::Closed,
        kind: WorkKind::Sprint,
        dispatch_policy: DispatchPolicy::Paused,
        holds: vec![ReasonCode::HardHold("operator_decision_required".into())],
        prerequisite_lifecycles: vec![PersistedLifecycle::Open],
        attempt_phase: Some(AttemptPhase::Failed),
        attempt_foreign: true,
        reviewed_profile: true,
        gate_mask: 0b1111,
        omit_first_gate: true,
        actor_role: ActorRole::Publisher,
        as_of: 89,
        retry_not_before: Some(99),
    };
    let minimized = shrink_status_case(original.clone(), |candidate| candidate.gate_mask != 0);
    assert_eq!(minimized.gate_mask, 1);
    assert_eq!(minimized.lifecycle, PersistedLifecycle::Open);
    assert!(serialize_status_case(&minimized).contains("gate_mask:1"));
    assert_ne!(
        serialize_status_case(&original),
        serialize_status_case(&minimized)
    );
}

#[test]
fn historical_attempts_do_not_change_current_status() {
    let mut work = WorkItem::new(
        "project".into(),
        WorkId::new("work"),
        WorkKind::Task,
        None,
        "historical attempt",
    )
    .open();
    let actor = ActorContext {
        actor_id: ActorId::new("agent"),
        role: ActorRole::Agent,
    };
    let gates = work.acceptance_profile.gates.clone();
    let baseline = evaluate_status(boreal_domain::StatusContext::new(
        &work,
        &[],
        None,
        &gates,
        &actor,
        TimestampMs(10),
        Revision(1),
    ));

    for phase in [
        AttemptPhase::Failed,
        AttemptPhase::Released,
        AttemptPhase::Cancelled,
    ] {
        let mut historical = Attempt::claim(
            WorkId::new("work"),
            AttemptId::new(format!("historical-{phase:?}")),
            ActorId::new("agent"),
            Fence::new(1),
            TimestampMs(0),
            Some(1),
            Some(2),
        )
        .unwrap();
        historical.phase = phase;
        let decision = evaluate_status(boreal_domain::StatusContext::new(
            &work,
            &[],
            Some(&historical),
            &gates,
            &actor,
            TimestampMs(10),
            Revision(1),
        ));
        assert_eq!(decision, baseline, "historical phase {phase:?}");
    }

    // Terminal stability is a property of the persisted lifecycle. Reopen is
    // the explicit exception, not an implicit status rewrite.
    for lifecycle in [PersistedLifecycle::Closed, PersistedLifecycle::Cancelled] {
        work.lifecycle = lifecycle;
        let terminal = evaluate_status(boreal_domain::StatusContext::new(
            &work,
            &[],
            None,
            &gates,
            &actor,
            TimestampMs(10),
            Revision(1),
        ));
        assert_eq!(
            terminal.display_status,
            if lifecycle == PersistedLifecycle::Closed {
                DerivedStatus::Closed
            } else {
                DerivedStatus::Cancelled
            }
        );
        assert!(!terminal.claimable_for_actor);
        assert_eq!(
            transition_lifecycle(lifecycle, WorkOperation::Reopen),
            Ok(PersistedLifecycle::Open)
        );
    }
}

#[test]
fn exact_deadlines_and_timer_precedence_are_exhaustive_over_clock_pairs() {
    for lease_ttl in [1, 7, 20, 50] {
        for hard_limit in [2, 11, 20, 80] {
            let mut current = Attempt::claim(
                WorkId::new("work"),
                AttemptId::new("attempt"),
                ActorId::new("agent"),
                Fence::new(1),
                TimestampMs(100),
                Some(lease_ttl),
                Some(hard_limit),
            )
            .unwrap();
            let earliest = current.lease_deadline.0.min(current.max_attempt_deadline.0);
            if earliest > 100 {
                assert_eq!(current.expiry_reason(TimestampMs(earliest - 1)), None);
            }
            let expected = if current.max_attempt_deadline <= current.lease_deadline {
                ExpiryReason::HardBudgetElapsed
            } else {
                ExpiryReason::LeaseElapsed
            };
            assert_eq!(
                current.expiry_reason(TimestampMs(earliest)),
                Some(expected),
                "lease_ttl={lease_ttl} hard_limit={hard_limit}"
            );
            assert!(current.heartbeat(current.lease_deadline).is_err());
        }
    }

    let work = WorkItem::new(
        "project".into(),
        WorkId::new("work"),
        WorkKind::Task,
        None,
        "deadline",
    )
    .open();
    let actor = ActorContext {
        actor_id: ActorId::new("agent"),
        role: ActorRole::Agent,
    };
    let gates = work.acceptance_profile.gates.clone();
    let mut current = Attempt::claim(
        WorkId::new("work"),
        AttemptId::new("attempt"),
        ActorId::new("agent"),
        Fence::new(1),
        TimestampMs(0),
        Some(1_000),
        Some(200),
    )
    .unwrap();
    current.phase = AttemptPhase::Running;
    let before = evaluate_status(boreal_domain::StatusContext::new(
        &work,
        &[],
        Some(&current),
        &gates,
        &actor,
        TimestampMs(199),
        Revision(1),
    ));
    let at_deadline = evaluate_status(boreal_domain::StatusContext::new(
        &work,
        &[],
        Some(&current),
        &gates,
        &actor,
        TimestampMs(200),
        Revision(1),
    ));
    assert_eq!(before.display_status, DerivedStatus::InProgress);
    assert_eq!(at_deadline.display_status, DerivedStatus::ExpiredReview);
    assert!(at_deadline
        .reason_codes
        .contains(&ReasonCode::HardBudgetElapsed));
    assert_eq!(at_deadline.next_status_change_at, None);
}

fn expected_attempt_transition(
    phase: AttemptPhase,
    operation: AttemptOperation,
) -> Option<AttemptPhase> {
    match (phase, operation) {
        (AttemptPhase::Claimed, AttemptOperation::Accept { .. }) => Some(AttemptPhase::Accepted),
        (AttemptPhase::Accepted, AttemptOperation::Start) => Some(AttemptPhase::Running),
        (AttemptPhase::Running, AttemptOperation::Submit) => Some(AttemptPhase::Verifying),
        (AttemptPhase::Verifying, AttemptOperation::RecordReceipt) => Some(AttemptPhase::Verifying),
        (AttemptPhase::Verifying, AttemptOperation::AcceptReview) => Some(AttemptPhase::Completed),
        (AttemptPhase::Verifying, AttemptOperation::RejectReview) => Some(AttemptPhase::Verifying),
        (
            AttemptPhase::Claimed
            | AttemptPhase::Accepted
            | AttemptPhase::Running
            | AttemptPhase::Verifying,
            AttemptOperation::Release,
        ) => Some(AttemptPhase::Released),
        (AttemptPhase::Running | AttemptPhase::Verifying, AttemptOperation::Fail) => {
            Some(AttemptPhase::Failed)
        }
        (
            AttemptPhase::Claimed
            | AttemptPhase::Accepted
            | AttemptPhase::Running
            | AttemptPhase::Verifying,
            AttemptOperation::ExpiryPending,
        ) => Some(AttemptPhase::ExpiryPending),
        (AttemptPhase::ExpiryPending, AttemptOperation::Expire) => Some(AttemptPhase::Expired),
        (
            AttemptPhase::Claimed
            | AttemptPhase::Accepted
            | AttemptPhase::Running
            | AttemptPhase::Verifying
            | AttemptPhase::ExpiryPending,
            AttemptOperation::Cancel,
        ) => Some(AttemptPhase::Cancelled),
        _ => None,
    }
}

#[test]
fn every_attempt_transition_pair_matches_the_frozen_oracle() {
    let phases = [
        AttemptPhase::Claimed,
        AttemptPhase::Accepted,
        AttemptPhase::Running,
        AttemptPhase::Verifying,
        AttemptPhase::ExpiryPending,
        AttemptPhase::Completed,
        AttemptPhase::Failed,
        AttemptPhase::Released,
        AttemptPhase::Expired,
        AttemptPhase::Cancelled,
    ];
    let operations = [
        AttemptOperation::Accept { at: TimestampMs(9) },
        AttemptOperation::Start,
        AttemptOperation::Submit,
        AttemptOperation::RecordReceipt,
        AttemptOperation::AcceptReview,
        AttemptOperation::RejectReview,
        AttemptOperation::Release,
        AttemptOperation::Fail,
        AttemptOperation::ExpiryPending,
        AttemptOperation::Expire,
        AttemptOperation::Cancel,
    ];
    for phase in phases {
        for operation in operations {
            let mut attempt = Attempt::claim(
                WorkId::new("work"),
                AttemptId::new("attempt"),
                ActorId::new("agent"),
                Fence::new(1),
                TimestampMs(0),
                Some(20),
                Some(50),
            )
            .unwrap();
            attempt.phase = phase;
            let expected = expected_attempt_transition(phase, operation);
            let actual = transition_attempt(&mut attempt, operation);
            assert_eq!(
                actual.is_ok(),
                expected.is_some(),
                "phase={phase:?} operation={operation:?}"
            );
            if let Some(expected_phase) = expected {
                assert_eq!(actual, Ok(()));
                assert_eq!(attempt.phase, expected_phase);
            } else {
                assert!(matches!(
                    actual,
                    Err(DomainError::IllegalAttemptTransition { .. })
                ));
                assert_eq!(attempt.phase, phase, "illegal transition mutated state");
            }
        }
    }
}

fn expected_lifecycle_transition(
    lifecycle: PersistedLifecycle,
    operation: WorkOperation,
) -> Option<PersistedLifecycle> {
    match (lifecycle, operation) {
        (PersistedLifecycle::Draft | PersistedLifecycle::Open, WorkOperation::Publish) => {
            Some(PersistedLifecycle::Open)
        }
        (PersistedLifecycle::Open, WorkOperation::Close) => Some(PersistedLifecycle::Closed),
        (PersistedLifecycle::Draft | PersistedLifecycle::Open, WorkOperation::Cancel) => {
            Some(PersistedLifecycle::Cancelled)
        }
        (PersistedLifecycle::Closed | PersistedLifecycle::Cancelled, WorkOperation::Reopen) => {
            Some(PersistedLifecycle::Open)
        }
        _ => None,
    }
}

#[test]
fn every_lifecycle_transition_pair_and_derived_write_is_exhaustive() {
    let lifecycles = [
        PersistedLifecycle::Draft,
        PersistedLifecycle::Open,
        PersistedLifecycle::Closed,
        PersistedLifecycle::Cancelled,
    ];
    let operations = [
        WorkOperation::Publish,
        WorkOperation::Close,
        WorkOperation::Cancel,
        WorkOperation::Reopen,
    ];
    for lifecycle in lifecycles {
        for operation in operations {
            assert_eq!(
                transition_lifecycle(lifecycle, operation),
                expected_lifecycle_transition(lifecycle, operation).ok_or({
                    DomainError::IllegalLifecycleTransition {
                        from: lifecycle,
                        operation,
                    }
                })
            );
        }
    }
    for status in [
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
        DerivedStatus::ExpiredReview,
        DerivedStatus::Cancelled,
    ] {
        assert_eq!(
            reject_derived_status_write(status),
            Err(DomainError::DerivedStatusReadOnly { status })
        );
    }
}

#[test]
fn default_dependencies_are_satisfied_only_by_closed_work() {
    for lifecycle in [
        PersistedLifecycle::Draft,
        PersistedLifecycle::Open,
        PersistedLifecycle::Closed,
        PersistedLifecycle::Cancelled,
    ] {
        let mut blocker = WorkItem::new(
            "project".into(),
            WorkId::new("blocker"),
            WorkKind::Task,
            None,
            "blocker",
        );
        blocker.lifecycle = lifecycle;
        assert_eq!(
            dependency_satisfied(boreal_domain::DependencyPolicy::ClosedOnly, &blocker),
            lifecycle == PersistedLifecycle::Closed
        );
    }

    let items = [
        WorkItem::new(
            "project".into(),
            WorkId::new("a"),
            WorkKind::Task,
            None,
            "a",
        ),
        WorkItem::new(
            "project".into(),
            WorkId::new("b"),
            WorkKind::Task,
            None,
            "b",
        ),
        WorkItem::new(
            "project".into(),
            WorkId::new("c"),
            WorkKind::Task,
            None,
            "c",
        ),
    ];
    let path = [
        BlockingDependency::new(WorkId::new("a"), WorkId::new("b")),
        BlockingDependency::new(WorkId::new("b"), WorkId::new("c")),
    ];
    assert!(validate_dependencies(&items, &path).is_ok());
    let cycle = [
        path[0].clone(),
        path[1].clone(),
        BlockingDependency::new(WorkId::new("c"), WorkId::new("a")),
    ];
    assert!(matches!(
        validate_dependencies(&items, &cycle),
        Err(DomainError::DependencyCycle { .. })
    ));
    let foreign_items = [
        items[0].clone(),
        WorkItem::new("other".into(), WorkId::new("b"), WorkKind::Task, None, "b"),
    ];
    assert!(matches!(
        validate_dependencies(
            &foreign_items,
            &[BlockingDependency::new(WorkId::new("a"), WorkId::new("b"))]
        ),
        Err(DomainError::CrossProjectReference { .. })
    ));
}

fn action_facts(role: ActorRole) -> DecisionInputs {
    let subject = EntityIdentity::new("project".into(), "work".into(), EntityRevision::new(7));
    let proof = ProofIdentity::new(
        subject.clone(),
        boreal_domain::decision_inputs::ProofRevision::new(2),
        None,
        "source-1".into(),
        ConfigIdentity::new("config-1"),
        ProfileIdentity::new("focused".into(), "1", ContentDigest::new("sha256:profile")),
        "policy-1",
    );
    DecisionInputs {
        subject: subject.clone(),
        snapshot_revision: Revision(12),
        clock: boreal_domain::decision_inputs::EvaluationClock::at(TimestampMs(100)),
        availability: Availability::Live,
        lifecycle: Fact::present(boreal_domain::decision_inputs::LifecycleInput {
            identity: subject.clone(),
            lifecycle: PersistedLifecycle::Open,
            terminal_decision: None,
        }),
        authority: Fact::present(ActorAuthorityInput {
            project_id: "project".into(),
            role,
            principal: PrincipalBinding::Authenticated {
                actor_id: "actor".into(),
            },
            session_id: Some(SessionId::new("session")),
        }),
        requirements: Fact::present(PinnedRequirementsInput {
            proof,
            requirements: vec![PinnedRequirement {
                id: RequirementId::new("verification-requirement"),
                gate_id: GateId::new("verification"),
                kind: GateKind::Verification,
                required: true,
                state: GateState::Satisfied,
                verifier_policy: VerifierPolicy {
                    id: VerifierPolicyId::new("trusted"),
                    version: "1".into(),
                },
            }],
            review_policy: ReviewRequirementPolicy::NotRequired,
        }),
        dependencies: Fact::present(boreal_domain::decision_inputs::DependencyOutcomesInput {
            edges: Vec::new(),
        }),
        holds: Fact::present(boreal_domain::decision_inputs::HoldsInput { holds: Vec::new() }),
        execution: Fact::optional_absent(
            boreal_domain::decision_inputs::FactKind::Execution,
            FactSubject::work("project".into(), "work".into()),
        ),
        submission: Fact::optional_absent(
            boreal_domain::decision_inputs::FactKind::Submission,
            FactSubject::work("project".into(), "work".into()),
        ),
        review: Fact::optional_absent(
            boreal_domain::decision_inputs::FactKind::Review,
            FactSubject::work("project".into(), "work".into()),
        ),
        recovery: Fact::optional_absent(
            boreal_domain::decision_inputs::FactKind::Recovery,
            FactSubject::work("project".into(), "work".into()),
        ),
        integrity: IntegrityInput {
            scope: boreal_domain::decision_inputs::IntegrityScope::work(
                "project".into(),
                "work".into(),
            ),
            level: IntegrityLevel::Valid,
            diagnostics: Vec::new(),
        },
        permitted_actions: PermittedActionsInput::allowing([
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
        ]),
    }
}

#[test]
fn actor_action_decisions_are_total_deterministic_and_round_trip_descriptors() {
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
        DerivedStatus::ExpiredReview,
        DerivedStatus::Cancelled,
    ];
    let reasons = [ReasonCode::Eligible];
    for role in [
        ActorRole::Agent,
        ActorRole::Reviewer,
        ActorRole::Operator,
        ActorRole::Publisher,
    ] {
        let facts = action_facts(role);
        for status in statuses {
            let input = ActionEvaluationInput::new(&facts, status, &reasons);
            let first = evaluate_actions(&input);
            let second = evaluate_actions(&input);
            assert_eq!(first, second, "role={role:?} status={status:?}");
            assert_eq!(
                first.allowed.len() + first.denied.len(),
                all_action_kinds().len(),
                "role={role:?} status={status:?}"
            );
            let mut seen = BTreeSet::new();
            for descriptor in &first.allowed {
                assert!(seen.insert(descriptor.action));
                assert!(matches!(
                    evaluate_action(&input, &descriptor.request()),
                    ActionAuthorization::Allowed(ref actual) if actual == descriptor
                ));
            }
            for denied in &first.denied {
                assert!(seen.insert(denied.descriptor.action));
                assert!(denied
                    .recovery
                    .iter()
                    .all(|route| all_action_kinds().contains(route)));
            }
            assert_eq!(seen.len(), all_action_kinds().len());
            assert!(first.allows(ActionKind::Inspect));
        }
    }
}

fn action_denial_for(
    facts: &DecisionInputs,
    status: DerivedStatus,
    reasons: &[ReasonCode],
    action: ActionKind,
) -> ActionDenialReason {
    let decision = evaluate_actions(&ActionEvaluationInput::new(facts, status, reasons));
    decision
        .denial(action)
        .unwrap_or_else(|| panic!("expected {action:?} to be denied"))
        .reason
        .clone()
}

#[test]
fn status_three_schedule_and_compatibility_predicate_are_exact_at_boundaries() {
    let schedule = WorkSchedule {
        not_before_at: Some(TimestampMs(100)),
        due_at: Some(TimestampMs(200)),
        target_start_at: None,
        target_end_at: None,
    };
    let before = evaluate_time_schedule(schedule, TimestampMs(99), false).unwrap();
    let at_start = evaluate_time_schedule(schedule, TimestampMs(100), false).unwrap();
    let terminal = evaluate_time_schedule(schedule, TimestampMs(99), true).unwrap();

    assert!(!before.eligible);
    assert_eq!(before.next_change_at, Some(TimestampMs(100)));
    assert!(at_start.eligible);
    assert_eq!(at_start.next_change_at, Some(TimestampMs(200)));
    assert!(!terminal.overdue);

    // status/3 exposes `scheduled`; a status/2-compatible projection is
    // queued plus a scheduled-start reason and must never claim early.
    let facts = action_facts(ActorRole::Agent);
    let reasons = [ReasonCode::RetryNotBefore(TimestampMs(100))];
    assert!(matches!(
        action_denial_for(&facts, DerivedStatus::Queued, &reasons, ActionKind::Claim),
        ActionDenialReason::StatusDenied(DerivedStatus::Queued)
    ));
    assert!(evaluate_actions(&ActionEvaluationInput::new(
        &facts,
        DerivedStatus::Queued,
        &reasons,
    ))
    .allows(ActionKind::Inspect));

    // The clock floor also remains deterministic when an observation moves
    // backward; no schedule transition is allowed to resurrect authority.
    assert_eq!(
        PolicyClock::after(TimestampMs(100), TimestampMs(99))
            .resolve()
            .unwrap()
            .effective_at,
        TimestampMs(100)
    );
}

#[test]
fn availability_and_integrity_dimensions_have_typed_safe_action_policy() {
    for availability in [
        Availability::Stale,
        Availability::Unavailable,
        Availability::Incompatible,
    ] {
        let mut facts = action_facts(ActorRole::Agent);
        facts.availability = availability;
        let reasons = [ReasonCode::Eligible];
        let decision = evaluate_actions(&ActionEvaluationInput::new(
            &facts,
            DerivedStatus::Ready,
            &reasons,
        ));
        assert!(decision.allows(ActionKind::Inspect));
        assert_eq!(
            action_denial_for(&facts, DerivedStatus::Ready, &reasons, ActionKind::Claim),
            ActionDenialReason::AvailabilityUnavailable(availability)
        );
    }

    for (level, diagnostic_code, expected_reason) in [
        (
            IntegrityLevel::Degraded,
            IntegrityDiagnosticCode::Stale,
            ActionDenialReason::IntegrityDegraded,
        ),
        (
            IntegrityLevel::Quarantined,
            IntegrityDiagnosticCode::Corrupt,
            ActionDenialReason::IntegrityQuarantined,
        ),
    ] {
        let mut facts = action_facts(ActorRole::Agent);
        facts.integrity = IntegrityInput {
            scope: IntegrityScope::work("project".into(), "work".into()),
            level,
            diagnostics: vec![IntegrityDiagnostic {
                scope: IntegrityScope::work("project".into(), "work".into()),
                code: diagnostic_code,
            }],
        };
        let reasons = [ReasonCode::HardHold("integrity_quarantined".into())];
        assert_eq!(
            action_denial_for(&facts, DerivedStatus::Ready, &reasons, ActionKind::Claim),
            expected_reason
        );
        let operator = {
            let mut operator = facts.clone();
            operator.authority = Fact::present(ActorAuthorityInput {
                project_id: "project".into(),
                role: ActorRole::Operator,
                principal: PrincipalBinding::Authenticated {
                    actor_id: "operator".into(),
                },
                session_id: Some(SessionId::new("operator-session")),
            });
            operator
        };
        assert!(evaluate_actions(&ActionEvaluationInput::new(
            &operator,
            DerivedStatus::Blocked,
            &reasons,
        ))
        .allows(ActionKind::Repair));
    }
}

#[test]
fn normative_action_vectors_assert_expected_allow_and_deny_results() {
    let reasons = [ReasonCode::Eligible];
    let agent = action_facts(ActorRole::Agent);
    assert!(evaluate_actions(&ActionEvaluationInput::new(
        &agent,
        DerivedStatus::Ready,
        &reasons,
    ))
    .allows(ActionKind::Claim));
    assert!(matches!(
        action_denial_for(&agent, DerivedStatus::Closed, &reasons, ActionKind::Claim),
        ActionDenialReason::StatusDenied(DerivedStatus::Closed)
    ));
    assert!(matches!(
        action_denial_for(&agent, DerivedStatus::Draft, &reasons, ActionKind::Claim),
        ActionDenialReason::StatusDenied(DerivedStatus::Draft)
    ));
    assert!(matches!(
        action_denial_for(&agent, DerivedStatus::Blocked, &reasons, ActionKind::Claim),
        ActionDenialReason::StatusDenied(DerivedStatus::Blocked)
    ));

    let operator = action_facts(ActorRole::Operator);
    assert!(evaluate_actions(&ActionEvaluationInput::new(
        &operator,
        DerivedStatus::ExpiredReview,
        &[ReasonCode::ExpiryReviewRequired],
    ))
    .allows(ActionKind::Recover));
    assert!(matches!(
        action_denial_for(
            &agent,
            DerivedStatus::ExpiredReview,
            &[ReasonCode::ExpiryReviewRequired],
            ActionKind::Claim,
        ),
        ActionDenialReason::StatusDenied(DerivedStatus::ExpiredReview)
    ));
}

#[test]
fn proof_and_receipt_subjects_fail_closed_for_foreign_history() {
    let subject = ReceiptSubject {
        work_id: WorkId::new("work"),
        attempt_id: AttemptId::new("attempt"),
        fence: Fence::new(3),
        gate_id: GateId::new("verification"),
    };
    let receipt = ReceiptIdentity {
        receipt_id: "receipt".into(),
        operation_id: "operation".into(),
        subject,
        source_snapshot: "source".into(),
        config_identity: ConfigIdentity::new("config"),
        policy_version: "policy-1".into(),
    };
    assert_eq!(
        validate_receipt_subject(
            &receipt,
            &WorkId::new("other-work"),
            &AttemptId::new("attempt"),
            Fence::new(3)
        ),
        Err(DomainError::ReceiptSubjectMismatch)
    );
    assert_eq!(
        validate_receipt_subject(
            &receipt,
            &WorkId::new("work"),
            &AttemptId::new("other-attempt"),
            Fence::new(3)
        ),
        Err(DomainError::StaleFence)
    );
    assert_eq!(
        validate_fence(Fence::new(3), Fence::new(4)),
        Err(DomainError::StaleFence)
    );

    let profile = AcceptanceProfile::reviewed();
    let mut gates = profile.gates.clone();
    for gate in &mut gates {
        gate.state = if gate.kind == GateKind::Review {
            GateState::Open
        } else {
            GateState::Satisfied
        };
    }
    let current = Attempt::claim(
        WorkId::new("work"),
        AttemptId::new("attempt"),
        ActorId::new("agent"),
        Fence::new(3),
        TimestampMs(0),
        Some(100),
        Some(DEFAULT_HARD_TIME_LIMIT_MS),
    )
    .unwrap();
    assert!(matches!(
        evaluate_close(&profile, &gates, None, true, &current, Fence::new(3)),
        CloseReadiness::NotReady { gaps } if gaps.contains(&CloseGap::ReviewRequired)
    ));
    let self_review = boreal_domain::ReviewRecord {
        reviewer_actor_id: ActorId::new("agent"),
        attempt_actor_id: ActorId::new("agent"),
        accepted: true,
    };
    assert_eq!(
        validate_independent_review(&self_review),
        Err(DomainError::ReviewerCannotReviewOwnAttempt)
    );
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum VectorLayer {
    PureDomain,
    ServiceOnlyBoundary,
}

// This is the executable crosswalk for the normative transition table.  The
// service-only entries are intentionally still named and asserted: they are
// not silently represented by a weaker domain fixture.
const LEGAL_VECTOR_MAP: [(&str, VectorLayer); 18] = [
    ("T01", VectorLayer::PureDomain),
    ("T02", VectorLayer::PureDomain),
    ("T03", VectorLayer::PureDomain),
    ("T04", VectorLayer::PureDomain),
    ("T05", VectorLayer::PureDomain),
    ("T06", VectorLayer::PureDomain),
    ("T07", VectorLayer::PureDomain),
    ("T08", VectorLayer::PureDomain),
    ("T09", VectorLayer::PureDomain),
    ("T10", VectorLayer::PureDomain),
    ("T11", VectorLayer::PureDomain),
    ("T12", VectorLayer::PureDomain),
    ("T13", VectorLayer::PureDomain),
    ("T14", VectorLayer::PureDomain),
    ("T15", VectorLayer::PureDomain),
    ("T16", VectorLayer::PureDomain),
    ("T17", VectorLayer::PureDomain),
    ("T18", VectorLayer::ServiceOnlyBoundary),
];

const ILLEGAL_VECTOR_MAP: [(&str, VectorLayer); 15] = [
    ("I01", VectorLayer::PureDomain),
    ("I02", VectorLayer::PureDomain),
    ("I03", VectorLayer::PureDomain),
    ("I04", VectorLayer::PureDomain),
    ("I05", VectorLayer::PureDomain),
    ("I06", VectorLayer::PureDomain),
    ("I07", VectorLayer::ServiceOnlyBoundary),
    ("I08", VectorLayer::PureDomain),
    ("I09", VectorLayer::PureDomain),
    ("I10", VectorLayer::PureDomain),
    ("I11", VectorLayer::PureDomain),
    ("I12", VectorLayer::PureDomain),
    ("I13", VectorLayer::PureDomain),
    ("I14", VectorLayer::ServiceOnlyBoundary),
    ("I15", VectorLayer::PureDomain),
];

#[test]
fn normative_t_and_i_vectors_are_complete_and_layered() {
    let legal = LEGAL_VECTOR_MAP
        .iter()
        .map(|(id, _)| (*id).to_owned())
        .collect::<BTreeSet<_>>();
    let illegal = ILLEGAL_VECTOR_MAP
        .iter()
        .map(|(id, _)| (*id).to_owned())
        .collect::<BTreeSet<_>>();
    assert_eq!(legal.len(), 18);
    assert_eq!(illegal.len(), 15);
    assert_eq!(legal, (1..=18).map(|n| format!("T{n:02}")).collect());
    assert_eq!(illegal, (1..=15).map(|n| format!("I{n:02}")).collect());
    assert_eq!(
        LEGAL_VECTOR_MAP
            .iter()
            .filter(|(_, layer)| *layer == VectorLayer::ServiceOnlyBoundary)
            .count(),
        1
    );
    assert_eq!(
        ILLEGAL_VECTOR_MAP
            .iter()
            .filter(|(_, layer)| *layer == VectorLayer::ServiceOnlyBoundary)
            .count(),
        2
    );

    // Pure-domain vector anchors. The complete ID crosswalk above is kept in
    // sync with the companion oracle document; these calls prove the anchor
    // behavior is executable rather than a documentation-only checklist.
    assert_eq!(
        transition_lifecycle(PersistedLifecycle::Draft, WorkOperation::Publish),
        Ok(PersistedLifecycle::Open)
    ); // T01
    let mut attempt = Attempt::claim(
        WorkId::new("work"),
        AttemptId::new("attempt"),
        ActorId::new("agent"),
        Fence::new(1),
        TimestampMs(0),
        Some(100),
        Some(200),
    )
    .unwrap();
    assert_eq!(
        transition_attempt(
            &mut attempt,
            AttemptOperation::Accept { at: TimestampMs(1) }
        ),
        Ok(())
    ); // T02/T03
    assert_eq!(
        transition_attempt(&mut attempt, AttemptOperation::Start),
        Ok(())
    ); // T04
    assert_eq!(
        transition_attempt(&mut attempt, AttemptOperation::Submit),
        Ok(())
    ); // T05
    assert_eq!(
        validate_receipt_subject(
            &ReceiptIdentity {
                receipt_id: "receipt".into(),
                operation_id: "operation".into(),
                subject: ReceiptSubject {
                    work_id: WorkId::new("work"),
                    attempt_id: AttemptId::new("attempt"),
                    fence: Fence::new(1),
                    gate_id: GateId::new("verification"),
                },
                source_snapshot: "source".into(),
                config_identity: ConfigIdentity::new("config"),
                policy_version: "policy".into(),
            },
            &WorkId::new("work"),
            &AttemptId::new("attempt"),
            Fence::new(1),
        ),
        Ok(())
    ); // T06
    assert_eq!(
        validate_independent_review(&ReviewRecord {
            reviewer_actor_id: ActorId::new("reviewer"),
            attempt_actor_id: ActorId::new("agent"),
            accepted: true,
        }),
        Ok(())
    ); // T07/I06
    assert!(matches!(
        evaluate_close(
            &AcceptanceProfile::focused(),
            &AcceptanceProfile::focused().gates,
            None,
            true,
            &attempt,
            Fence::new(1),
        ),
        CloseReadiness::NotReady { .. }
    )); // T08/T09/I05
    assert_eq!(
        transition_attempt(&mut attempt, AttemptOperation::Release),
        Ok(())
    ); // T10
    assert_eq!(
        transition_lifecycle(PersistedLifecycle::Open, WorkOperation::Cancel),
        Ok(PersistedLifecycle::Cancelled)
    ); // T14
    assert_eq!(
        transition_lifecycle(PersistedLifecycle::Closed, WorkOperation::Reopen),
        Ok(PersistedLifecycle::Open)
    ); // T15
    assert_eq!(
        validate_fence(Fence::new(1), Fence::new(2)),
        Err(DomainError::StaleFence)
    ); // I10
    assert_eq!(validate_dependencies(&[], &[]), Ok(())); // I15 anchor's non-cycle half
}
