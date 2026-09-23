//! PF-S03-T08 deterministic property, differential, and exhaustive coverage.
//!
//! This target intentionally uses a small local generator instead of adding a
//! runtime dependency.  Every generated case is deterministic and failures
//! include the seed and case index, which is the minimal counterexample needed
//! to reproduce a failing pure-domain rule.

use std::{collections::BTreeSet, env, fmt::Write as _, fs, path::Path, process::Command};

use boreal_domain::actions::{
    all_action_kinds, evaluate_action, evaluate_actions, ActionAuthorization, ActionDenialReason,
    ActionEvaluationInput, ActionKind,
};
use boreal_domain::decision_inputs::{
    ActorAuthorityInput, AttemptFence, AttemptIdentity, Availability, ContentDigest,
    ContradictionCode, DecisionDiagnostic, DecisionId, DecisionInputs, DependencyId,
    EntityIdentity, EntityRevision, ExecutionInput, Fact, FactDiagnostic, FactKind, FactSubject,
    HoldId, HoldInput, HoldsInput, IntegrityDiagnostic, IntegrityDiagnosticCode, IntegrityInput,
    IntegrityLevel, IntegrityScope, LifecycleInput, PermittedAction, PermittedActionsInput,
    PinnedRequirement, PinnedRequirementsInput, PrincipalBinding, ProfileIdentity, ProofIdentity,
    ProofRevision, RecoveryId, RecoveryInput, RecoveryReason, RequirementId, ResourceDisposition,
    ReviewId, ReviewInput, ReviewOutcome, ReviewRequirementPolicy, RevisionMarker, SubmissionId,
    SubmissionInput, SubmissionState, UnreadableReason, VerifierPolicy, VerifierPolicyId,
};
use boreal_domain::dependencies::{
    evaluate_dependencies, validate_dependency_graph, ClosedOutcome, CorruptPrerequisite,
    DependencyEdge as CanonicalDependencyEdge, DependencyEndpoint, DependencyEvaluationError,
    DependencyObservation, EdgeSatisfaction, EdgeWaiver, RawPrerequisiteContext, StalePrerequisite,
    UnmetReason, UnreadablePrerequisite, UpstreamOutcome,
};
use boreal_domain::time_policy::{evaluate_schedule as evaluate_time_schedule, PolicyClock};
use boreal_domain::work_model_v3::WorkSchedule;
use boreal_domain::{
    dependency_satisfied, evaluate_close, evaluate_status, reject_derived_status_write,
    transition_attempt, transition_lifecycle, validate_dependencies, validate_fence,
    validate_independent_review, validate_receipt_subject, AcceptanceProfile, ActorContext,
    ActorId, ActorRole, Attempt, AttemptId, AttemptOperation, AttemptPhase, BlockingDependency,
    CloseGap, CloseReadiness, ConfigIdentity, DerivedStatus, DispatchPolicy, DomainAction,
    DomainError, ExpiryReason, Fence, GateId, GateKind, GateRequirement, GateState,
    PersistedLifecycle, ReasonCode, ReceiptIdentity, ReceiptSubject, ReviewRecord, Revision,
    SessionId, TimestampMs, WorkId, WorkItem, WorkKind, WorkOperation, DEFAULT_HARD_TIME_LIMIT_MS,
};

const SEEDS: [u64; 4] = [0x5eed_0001, 0x5eed_0029, 0x5eed_00a7, 0x5eed_01f3];

// These identities are part of the executable oracle contract.  Updating a
// normative policy or fixture revision requires an intentional oracle review,
// rather than silently rerunning the old vectors against new prose.
const ORACLE_STATUS_CONTRACT: &str = "boreal.work-status/3";
const ORACLE_TRANSITION_CONTRACT: &str = "boreal.work-transition/2";
const ORACLE_FIXTURE_REVISION: &str = "m02-candidate.1";
const ORACLE_SOURCE_RECORD: &str =
    include_str!("../../../project/validation/production/domain/PF-S03-T08-ORACLE-SOURCE.md");

// Keep the artifact binding self-contained in this test target.  The domain
// crate intentionally has no hashing dependency; this small SHA-256
// implementation lets the oracle compare the actual included policy bytes
// with the digest recorded by the accepted contract manifest.
fn sha256_hex(bytes: &[u8]) -> String {
    const INITIAL: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19,
    ];
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];
    let mut message = bytes.to_vec();
    message.push(0x80);
    while message.len() % 64 != 56 {
        message.push(0);
    }
    message.extend_from_slice(&(bytes.len() as u64 * 8).to_be_bytes());

    let mut state = INITIAL;
    for chunk in message.chunks_exact(64) {
        let mut schedule = [0u32; 64];
        for (word, encoded) in schedule[..16].iter_mut().zip(chunk.chunks_exact(4)) {
            *word = u32::from_be_bytes([encoded[0], encoded[1], encoded[2], encoded[3]]);
        }
        for index in 16..64 {
            let s0 = schedule[index - 15].rotate_right(7)
                ^ schedule[index - 15].rotate_right(18)
                ^ (schedule[index - 15] >> 3);
            let s1 = schedule[index - 2].rotate_right(17)
                ^ schedule[index - 2].rotate_right(19)
                ^ (schedule[index - 2] >> 10);
            schedule[index] = schedule[index - 16]
                .wrapping_add(s0)
                .wrapping_add(schedule[index - 7])
                .wrapping_add(s1);
        }
        let mut working = state;
        for (index, constant) in K.iter().enumerate() {
            let s1 = working[4].rotate_right(6)
                ^ working[4].rotate_right(11)
                ^ working[4].rotate_right(25);
            let choose = (working[4] & working[5]) ^ ((!working[4]) & working[6]);
            let temp1 = working[7]
                .wrapping_add(s1)
                .wrapping_add(choose)
                .wrapping_add(*constant)
                .wrapping_add(schedule[index]);
            let s0 = working[0].rotate_right(2)
                ^ working[0].rotate_right(13)
                ^ working[0].rotate_right(22);
            let majority =
                (working[0] & working[1]) ^ (working[0] & working[2]) ^ (working[1] & working[2]);
            let temp2 = s0.wrapping_add(majority);
            working[7] = working[6];
            working[6] = working[5];
            working[5] = working[4];
            working[4] = working[3].wrapping_add(temp1);
            working[3] = working[2];
            working[2] = working[1];
            working[1] = working[0];
            working[0] = temp1.wrapping_add(temp2);
        }
        for (slot, value) in state.iter_mut().zip(working) {
            *slot = slot.wrapping_add(value);
        }
    }
    let mut hex = String::with_capacity(64);
    for word in state {
        write!(&mut hex, "{word:08x}").expect("writing to String cannot fail");
    }
    hex
}

fn oracle_field(name: &str) -> &str {
    ORACLE_SOURCE_RECORD
        .lines()
        .find_map(|line| line.strip_prefix(name).map(str::trim))
        .and_then(|value| value.strip_prefix('`'))
        .and_then(|value| value.strip_suffix('`'))
        .map(str::trim)
        .unwrap_or_else(|| panic!("missing oracle source field {name:?}"))
}

const VALIDATION_MANIFEST_ENV: &str = "BOREAL_PRODUCTION_ORACLE_MANIFEST";

fn validation_manifest() -> String {
    let path = env::var(VALIDATION_MANIFEST_ENV).unwrap_or_else(|_| {
        panic!(
            "{VALIDATION_MANIFEST_ENV} is required; generate an external production-oracle manifest before running this target"
        )
    });
    fs::read_to_string(&path).unwrap_or_else(|error| {
        panic!("failed to read {VALIDATION_MANIFEST_ENV} at {path}: {error}")
    })
}

fn manifest_field<'a>(manifest: &'a str, name: &str) -> &'a str {
    manifest
        .lines()
        .find_map(|line| line.strip_prefix(name).map(str::trim))
        .and_then(|value| value.strip_prefix('`'))
        .and_then(|value| value.strip_suffix('`'))
        .map(str::trim)
        .unwrap_or_else(|| panic!("missing validation manifest field {name:?}"))
}

fn current_git_head() -> String {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let output = Command::new("git")
        .args([
            "-C",
            root.to_str().expect("repository path is UTF-8"),
            "rev-parse",
            "HEAD",
        ])
        .output()
        .expect("git must be available for source-bound oracle validation");
    assert!(output.status.success(), "git rev-parse failed: {output:?}");
    String::from_utf8(output.stdout)
        .expect("git revision is UTF-8")
        .trim()
        .to_owned()
}

fn assert_artifact_digest(path: &str, actual: &[u8]) {
    let field = format!("artifact::{path} =");
    let expected = oracle_field(&field);
    assert_eq!(
        sha256_hex(actual),
        expected,
        "normative artifact drift: {path}"
    );
}

fn assert_manifest_artifact_digest(manifest: &str, path: &str, actual: &[u8]) {
    let field = format!("artifact::{path} =");
    assert_eq!(
        sha256_hex(actual),
        manifest_field(manifest, &field),
        "generated validation manifest drift: {path}"
    );
}

fn assert_bound_artifact(manifest: &str, path: &str, actual: &[u8]) {
    assert_artifact_digest(path, actual);
    assert_manifest_artifact_digest(manifest, path, actual);
}

fn assert_transition_table_row(id: &str) {
    let row_prefix = format!("| {id} |");
    assert!(
        include_str!("../../../project/spec/transition-table.md")
            .lines()
            .any(|line| line.starts_with(&row_prefix)),
        "missing normative transition row {id}"
    );
}

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

#[allow(clippy::too_many_arguments)]
fn status_fixture(
    lifecycle: PersistedLifecycle,
    kind: WorkKind,
    dispatch_policy: DispatchPolicy,
    holds: Vec<ReasonCode>,
    profile: AcceptanceProfile,
    gates: Vec<GateRequirement>,
    prerequisites: Vec<WorkItem>,
    attempt: Option<Attempt>,
    actor_role: ActorRole,
    as_of: u64,
    retry_not_before: Option<u64>,
) -> boreal_domain::StatusDecision {
    let mut work = WorkItem::new(
        "project".into(),
        WorkId::new("work"),
        kind,
        None,
        "status fixture",
    );
    work.lifecycle = lifecycle;
    work.dispatch_policy = dispatch_policy;
    work.hard_holds = holds;
    work.acceptance_profile = profile;
    let actor = ActorContext {
        actor_id: ActorId::new("actor"),
        role: actor_role,
    };
    let mut context = boreal_domain::StatusContext::new(
        &work,
        &prerequisites,
        attempt.as_ref(),
        &gates,
        &actor,
        TimestampMs(as_of),
        Revision(17),
    );
    context.retry_not_before = retry_not_before.map(TimestampMs);
    evaluate_status(context)
}

fn open_work(id: &str, lifecycle: PersistedLifecycle) -> WorkItem {
    let mut work = WorkItem::new("project".into(), WorkId::new(id), WorkKind::Task, None, id);
    work.lifecycle = lifecycle;
    work
}

fn claimed_attempt(phase: AttemptPhase) -> Attempt {
    let mut attempt = Attempt::claim(
        WorkId::new("work"),
        AttemptId::new("attempt"),
        ActorId::new("actor"),
        Fence::new(1),
        TimestampMs(0),
        Some(100),
        Some(200),
    )
    .expect("fixture deadlines are valid");
    attempt.phase = phase;
    attempt
}

fn satisfied_gates(profile: &AcceptanceProfile) -> Vec<GateRequirement> {
    profile
        .gates
        .iter()
        .cloned()
        .map(GateRequirement::satisfied)
        .collect()
}

#[test]
fn normative_status_precedence_and_reason_actions_are_exhaustive() {
    let focused = AcceptanceProfile::focused();
    let reviewed = AcceptanceProfile::reviewed();

    let draft = status_fixture(
        PersistedLifecycle::Draft,
        WorkKind::Task,
        DispatchPolicy::Automatic,
        Vec::new(),
        focused.clone(),
        focused.gates.clone(),
        Vec::new(),
        None,
        ActorRole::Agent,
        10,
        None,
    );
    assert_eq!(draft.display_status, DerivedStatus::Draft);
    assert_eq!(draft.primary_reason, ReasonCode::NotPublished);
    assert_eq!(draft.next_action, Some(DomainAction::PublishWork));
    assert!(!draft.claimable_for_actor);

    let closed = status_fixture(
        PersistedLifecycle::Closed,
        WorkKind::Task,
        DispatchPolicy::Paused,
        vec![ReasonCode::HardHold("operator_decision_required".into())],
        focused.clone(),
        Vec::new(),
        vec![open_work("upstream", PersistedLifecycle::Open)],
        Some(claimed_attempt(AttemptPhase::Running)),
        ActorRole::Agent,
        10,
        Some(20),
    );
    assert_eq!(closed.display_status, DerivedStatus::Closed);
    assert_eq!(closed.primary_reason, ReasonCode::TerminalClosed);
    assert_eq!(closed.next_action, None);
    assert!(!closed.claimable_for_actor);

    let cancelled = status_fixture(
        PersistedLifecycle::Cancelled,
        WorkKind::Task,
        DispatchPolicy::Automatic,
        Vec::new(),
        focused.clone(),
        Vec::new(),
        Vec::new(),
        None,
        ActorRole::Agent,
        10,
        None,
    );
    assert_eq!(cancelled.display_status, DerivedStatus::Cancelled);
    assert_eq!(cancelled.primary_reason, ReasonCode::TerminalCancelled);

    let expired = status_fixture(
        PersistedLifecycle::Open,
        WorkKind::Task,
        DispatchPolicy::Automatic,
        vec![ReasonCode::HardHold("operator_decision_required".into())],
        focused.clone(),
        focused.gates.clone(),
        vec![open_work("upstream", PersistedLifecycle::Open)],
        Some(claimed_attempt(AttemptPhase::Running)),
        ActorRole::Agent,
        100,
        Some(200),
    );
    assert_eq!(expired.display_status, DerivedStatus::ExpiredReview);
    assert_eq!(expired.primary_reason, ReasonCode::ExpiryReviewRequired);
    assert_eq!(expired.next_action, Some(DomainAction::ReviewExpiry));
    assert!(!expired.claimable_for_actor);

    let blocked = status_fixture(
        PersistedLifecycle::Open,
        WorkKind::Task,
        DispatchPolicy::Automatic,
        vec![ReasonCode::HardHold("operator_decision_required".into())],
        focused.clone(),
        focused.gates.clone(),
        Vec::new(),
        None,
        ActorRole::Agent,
        10,
        None,
    );
    assert_eq!(blocked.display_status, DerivedStatus::Blocked);
    assert_eq!(
        blocked.primary_reason,
        ReasonCode::HardHold("operator_decision_required".into())
    );
    assert_eq!(blocked.next_action, Some(DomainAction::ResolveHold));
    assert!(!blocked.claimable_for_actor);

    let claimed = status_fixture(
        PersistedLifecycle::Open,
        WorkKind::Task,
        DispatchPolicy::Automatic,
        Vec::new(),
        focused.clone(),
        focused.gates.clone(),
        Vec::new(),
        Some(claimed_attempt(AttemptPhase::Claimed)),
        ActorRole::Agent,
        10,
        None,
    );
    assert_eq!(claimed.display_status, DerivedStatus::Claimed);
    assert_eq!(claimed.primary_reason, ReasonCode::AttemptUnaccepted);
    assert_eq!(claimed.next_action, Some(DomainAction::AcceptAttempt));

    let in_progress = status_fixture(
        PersistedLifecycle::Open,
        WorkKind::Task,
        DispatchPolicy::Automatic,
        Vec::new(),
        focused.clone(),
        focused.gates.clone(),
        Vec::new(),
        Some(claimed_attempt(AttemptPhase::Accepted)),
        ActorRole::Agent,
        10,
        None,
    );
    assert_eq!(in_progress.display_status, DerivedStatus::InProgress);
    assert_eq!(in_progress.primary_reason, ReasonCode::AttemptActive);
    assert_eq!(in_progress.next_action, Some(DomainAction::ResumeAttempt));

    let mut verification_gates = satisfied_gates(&focused);
    verification_gates[1].state = GateState::Open;
    let needs_verification = status_fixture(
        PersistedLifecycle::Open,
        WorkKind::Task,
        DispatchPolicy::Automatic,
        Vec::new(),
        focused.clone(),
        verification_gates,
        Vec::new(),
        Some(claimed_attempt(AttemptPhase::Verifying)),
        ActorRole::Agent,
        10,
        None,
    );
    assert_eq!(
        needs_verification.display_status,
        DerivedStatus::NeedsVerification
    );
    assert_eq!(
        needs_verification.primary_reason,
        ReasonCode::VerificationRequired
    );
    assert_eq!(
        needs_verification.next_action,
        Some(DomainAction::ProvideEvidence)
    );

    let mut review_gates = satisfied_gates(&reviewed);
    review_gates[3].state = GateState::Open;
    let awaiting_review = status_fixture(
        PersistedLifecycle::Open,
        WorkKind::Task,
        DispatchPolicy::Automatic,
        Vec::new(),
        reviewed.clone(),
        review_gates,
        Vec::new(),
        Some(claimed_attempt(AttemptPhase::Verifying)),
        ActorRole::Agent,
        10,
        None,
    );
    assert_eq!(
        awaiting_review.display_status,
        DerivedStatus::AwaitingReview
    );
    assert_eq!(awaiting_review.primary_reason, ReasonCode::ReviewRequired);
    assert_eq!(
        awaiting_review.next_action,
        Some(DomainAction::RequestReview)
    );

    let complete = status_fixture(
        PersistedLifecycle::Open,
        WorkKind::Task,
        DispatchPolicy::Automatic,
        Vec::new(),
        focused.clone(),
        satisfied_gates(&focused),
        Vec::new(),
        Some(claimed_attempt(AttemptPhase::Verifying)),
        ActorRole::Agent,
        10,
        None,
    );
    assert_eq!(complete.display_status, DerivedStatus::Complete);
    assert_eq!(complete.primary_reason, ReasonCode::CloseoutPending);
    assert_eq!(complete.next_action, Some(DomainAction::FinishClose));

    let paused = status_fixture(
        PersistedLifecycle::Open,
        WorkKind::Task,
        DispatchPolicy::Paused,
        Vec::new(),
        focused.clone(),
        focused.gates.clone(),
        Vec::new(),
        None,
        ActorRole::Agent,
        10,
        None,
    );
    assert_eq!(paused.display_status, DerivedStatus::Paused);
    assert_eq!(paused.primary_reason, ReasonCode::Paused);
    assert_eq!(paused.next_action, Some(DomainAction::ResumePolicy));

    let retry_wait = status_fixture(
        PersistedLifecycle::Open,
        WorkKind::Task,
        DispatchPolicy::Automatic,
        Vec::new(),
        focused.clone(),
        focused.gates.clone(),
        Vec::new(),
        None,
        ActorRole::Agent,
        10,
        Some(20),
    );
    assert_eq!(retry_wait.display_status, DerivedStatus::RetryWait);
    assert_eq!(
        retry_wait.primary_reason,
        ReasonCode::RetryNotBefore(TimestampMs(20))
    );
    assert_eq!(retry_wait.next_action, Some(DomainAction::WaitUntil));

    let queued = status_fixture(
        PersistedLifecycle::Open,
        WorkKind::Task,
        DispatchPolicy::Automatic,
        Vec::new(),
        focused.clone(),
        focused.gates.clone(),
        vec![open_work("upstream", PersistedLifecycle::Open)],
        None,
        ActorRole::Agent,
        10,
        None,
    );
    assert_eq!(queued.display_status, DerivedStatus::Queued);
    assert_eq!(
        queued.primary_reason,
        ReasonCode::PrerequisiteOpen(WorkId::new("upstream"))
    );
    assert_eq!(queued.next_action, Some(DomainAction::WaitForPrerequisite));

    let ready = status_fixture(
        PersistedLifecycle::Open,
        WorkKind::Task,
        DispatchPolicy::Automatic,
        Vec::new(),
        focused.clone(),
        focused.gates.clone(),
        Vec::new(),
        None,
        ActorRole::Agent,
        10,
        None,
    );
    assert_eq!(ready.display_status, DerivedStatus::Ready);
    assert_eq!(ready.primary_reason, ReasonCode::Eligible);
    assert_eq!(ready.next_action, Some(DomainAction::Claim));
    assert!(ready.claimable_for_actor);

    let operator_only = status_fixture(
        PersistedLifecycle::Open,
        WorkKind::Task,
        DispatchPolicy::OperatorOnly,
        Vec::new(),
        focused.clone(),
        focused.gates.clone(),
        Vec::new(),
        None,
        ActorRole::Agent,
        10,
        None,
    );
    assert_eq!(operator_only.display_status, DerivedStatus::Ready);
    assert_eq!(operator_only.primary_reason, ReasonCode::OperatorOnly);
    assert_eq!(
        operator_only.next_action,
        Some(DomainAction::RequestOperatorClaim)
    );
    assert!(!operator_only.claimable_for_actor);

    let role_denied = status_fixture(
        PersistedLifecycle::Open,
        WorkKind::Task,
        DispatchPolicy::Automatic,
        Vec::new(),
        focused.clone(),
        focused.gates.clone(),
        Vec::new(),
        None,
        ActorRole::Reviewer,
        10,
        None,
    );
    assert_eq!(role_denied.display_status, DerivedStatus::Ready);
    assert_eq!(role_denied.primary_reason, ReasonCode::RoleDenied);
    assert_eq!(
        role_denied.next_action,
        Some(DomainAction::RequestOperatorClaim)
    );
    assert!(!role_denied.claimable_for_actor);

    let container = status_fixture(
        PersistedLifecycle::Open,
        WorkKind::Sprint,
        DispatchPolicy::Automatic,
        Vec::new(),
        focused.clone(),
        focused.gates.clone(),
        Vec::new(),
        None,
        ActorRole::Agent,
        10,
        None,
    );
    assert_eq!(container.display_status, DerivedStatus::Queued);
    assert_eq!(container.primary_reason, ReasonCode::ContainerPlanning);

    let mut rejected_review_gates = satisfied_gates(&reviewed);
    rejected_review_gates[3].state = GateState::Failed;
    let rejected_review = status_fixture(
        PersistedLifecycle::Open,
        WorkKind::Task,
        DispatchPolicy::Automatic,
        Vec::new(),
        reviewed,
        rejected_review_gates,
        Vec::new(),
        Some(claimed_attempt(AttemptPhase::Verifying)),
        ActorRole::Agent,
        10,
        None,
    );
    assert_eq!(rejected_review.display_status, DerivedStatus::Blocked);
    assert_eq!(
        rejected_review.primary_reason,
        ReasonCode::ReviewRejected(GateId::new("review"))
    );
}

#[test]
fn status_precedence_retains_secondary_facts_and_terminal_reopen_is_explicit() {
    let profile = AcceptanceProfile::focused();
    let mut attempt = claimed_attempt(AttemptPhase::Running);
    attempt.review_required_after_expiry = true;
    let prerequisites = vec![open_work("upstream-z", PersistedLifecycle::Open)];
    let first = status_fixture(
        PersistedLifecycle::Open,
        WorkKind::Task,
        DispatchPolicy::Paused,
        vec![ReasonCode::HardHold("operator_decision_required".into())],
        profile.clone(),
        profile.gates.clone(),
        prerequisites.clone(),
        Some(attempt.clone()),
        ActorRole::Agent,
        10,
        Some(20),
    );
    let mut reversed_prerequisites = prerequisites;
    reversed_prerequisites.reverse();
    let second = status_fixture(
        PersistedLifecycle::Open,
        WorkKind::Task,
        DispatchPolicy::Paused,
        vec![ReasonCode::HardHold("operator_decision_required".into())],
        profile.clone(),
        profile.gates.clone(),
        reversed_prerequisites,
        Some(attempt),
        ActorRole::Agent,
        10,
        Some(20),
    );
    assert_eq!(first, second);
    assert_eq!(first.primary_reason, ReasonCode::ExpiryReviewRequired);
    assert!(first
        .reason_codes
        .iter()
        .any(|reason| reason == &ReasonCode::HardHold("operator_decision_required".into())));
    assert!(first.reason_codes.iter().any(
        |reason| matches!(reason, ReasonCode::PrerequisiteOpen(id) if id.as_str() == "upstream-z")
    ));
    assert_eq!(first.next_status_change_at, None);
    assert!(first.reason_codes[1..]
        .windows(2)
        .all(|pair| pair[0].stable_code() < pair[1].stable_code()));

    let mut terminal_work = open_work("work", PersistedLifecycle::Closed);
    terminal_work.hard_holds = vec![ReasonCode::HardHold("operator_decision_required".into())];
    let terminal_actor = ActorContext {
        actor_id: ActorId::new("actor"),
        role: ActorRole::Agent,
    };
    let terminal_attempt = claimed_attempt(AttemptPhase::Running);
    let terminal_context = boreal_domain::StatusContext::new(
        &terminal_work,
        &[],
        Some(&terminal_attempt),
        &profile.gates,
        &terminal_actor,
        TimestampMs(10),
        Revision(17),
    );
    let terminal = evaluate_status(terminal_context);
    assert_eq!(terminal.display_status, DerivedStatus::Closed);
    assert_eq!(terminal.next_status_change_at, None);
    assert!(!terminal.claimable_for_actor);
    assert_eq!(
        transition_lifecycle(PersistedLifecycle::Closed, WorkOperation::Reopen),
        Ok(PersistedLifecycle::Open)
    );
    assert_eq!(terminal.display_status, DerivedStatus::Closed);
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
    let manifest = include_str!("../../../project/spec/production/contract-manifest.json");
    assert!(manifest.contains("boreal.production-contract/1"));
    assert!(manifest.contains(&format!(
        "\"revision\": \"{}\"",
        oracle_field("accepted_contract_source_revision:")
    )));
    assert!(
        include_str!("../../../project/spec/production/status-and-actions.md")
            .contains(ORACLE_STATUS_CONTRACT)
    );
    assert!(include_str!("../../../project/spec/transition-table.md")
        .contains(ORACLE_TRANSITION_CONTRACT));
    assert!(
        include_str!("../../../project/spec/production/reason-registry.json")
            .contains("scheduled_start")
    );

    let manifest = validation_manifest();
    assert_eq!(
        manifest_field(&manifest, "schema:"),
        "boreal.production-oracle-source-manifest/1"
    );
    assert_eq!(
        manifest_field(&manifest, "binding:"),
        "external-generated-validation-input"
    );
    assert_eq!(
        current_git_head(),
        manifest_field(&manifest, "source_revision:")
    );
    assert_bound_artifact(
        &manifest,
        "project/spec/production/contract-manifest.json",
        include_bytes!("../../../project/spec/production/contract-manifest.json"),
    );
    assert_bound_artifact(
        &manifest,
        "project/spec/production/status-and-actions.md",
        include_bytes!("../../../project/spec/production/status-and-actions.md"),
    );
    assert_bound_artifact(
        &manifest,
        "project/spec/transition-table.md",
        include_bytes!("../../../project/spec/transition-table.md"),
    );
    assert_bound_artifact(
        &manifest,
        "project/spec/production/reason-registry.json",
        include_bytes!("../../../project/spec/production/reason-registry.json"),
    );
    assert_bound_artifact(
        &manifest,
        "project/validation/production/domain/PF-S03-T08-ORACLE.md",
        include_bytes!("../../../project/validation/production/domain/PF-S03-T08-ORACLE.md"),
    );
    assert_manifest_artifact_digest(
        &manifest,
        "project/validation/production/domain/PF-S03-T10-ORACLE.md",
        include_bytes!("../../../project/validation/production/domain/PF-S03-T10-ORACLE.md"),
    );
    assert_manifest_artifact_digest(
        &manifest,
        "project/validation/production/domain/PF-S03-T08-ORACLE-SOURCE.md",
        include_bytes!("../../../project/validation/production/domain/PF-S03-T08-ORACLE-SOURCE.md"),
    );
    assert_manifest_artifact_digest(
        &manifest,
        "project/validation/production/domain/PF-S03-T10-ORACLE-SOURCE.md",
        include_bytes!("../../../project/validation/production/domain/PF-S03-T10-ORACLE-SOURCE.md"),
    );
    assert_bound_artifact(
        &manifest,
        "crates/domain/src/lib.rs",
        include_bytes!("../src/lib.rs"),
    );
    assert_bound_artifact(
        &manifest,
        "crates/domain/src/status_evaluator.rs",
        include_bytes!("../src/status_evaluator.rs"),
    );
    assert_bound_artifact(
        &manifest,
        "crates/domain/src/actions.rs",
        include_bytes!("../src/actions.rs"),
    );
    assert_bound_artifact(
        &manifest,
        "crates/domain/src/decision_inputs.rs",
        include_bytes!("../src/decision_inputs.rs"),
    );
    assert_bound_artifact(
        &manifest,
        "crates/domain/src/dependencies.rs",
        include_bytes!("../src/dependencies.rs"),
    );
    assert_bound_artifact(
        &manifest,
        "crates/domain/src/time_policy.rs",
        include_bytes!("../src/time_policy.rs"),
    );
    assert_bound_artifact(
        &manifest,
        "crates/domain/tests/production_properties.rs",
        include_bytes!("production_properties.rs"),
    );
    assert_manifest_artifact_digest(
        &manifest,
        "crates/domain/tests/production_t10_oracle.rs",
        include_bytes!("production_t10_oracle.rs"),
    );

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

    let mut renewed = Attempt::claim(
        WorkId::new("work"),
        AttemptId::new("attempt"),
        ActorId::new("agent"),
        Fence::new(1),
        TimestampMs(0),
        Some(20),
        Some(100),
    )
    .unwrap();
    let hard_deadline = renewed.max_attempt_deadline;
    let original_lease = renewed.lease_deadline;
    renewed.renew_lease(TimestampMs(10), 100).unwrap();
    assert!(renewed.lease_deadline > original_lease);
    assert_eq!(renewed.max_attempt_deadline, hard_deadline);
    assert_eq!(renewed.expiry_reason(TimestampMs(99)), None);
    assert_eq!(
        renewed.expiry_reason(hard_deadline),
        Some(ExpiryReason::HardBudgetElapsed)
    );

    let mut expired_history = renewed.clone();
    expired_history.phase = AttemptPhase::Expired;
    expired_history.review_required_after_expiry = true;
    let expired_at_old_clock = status_fixture(
        PersistedLifecycle::Open,
        WorkKind::Task,
        DispatchPolicy::Automatic,
        Vec::new(),
        AcceptanceProfile::focused(),
        AcceptanceProfile::focused().gates,
        Vec::new(),
        Some(expired_history),
        ActorRole::Agent,
        1,
        None,
    );
    assert_eq!(
        expired_at_old_clock.display_status,
        DerivedStatus::ExpiredReview
    );
    assert_eq!(expired_at_old_clock.next_status_change_at, None);

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
        DerivedStatus::Scheduled,
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

#[test]
fn accepted_close_is_the_only_default_dependency_satisfaction() {
    let project = boreal_domain::ProjectId::new("project");
    let predecessor = WorkId::new("predecessor");
    let successor = WorkId::new("successor");
    let edge = CanonicalDependencyEdge::closed_only(
        DependencyId::new("edge"),
        project.clone(),
        predecessor.clone(),
        successor,
        EntityRevision::new(4),
    );
    let graph = validate_dependency_graph(
        project.clone(),
        &[
            DependencyEndpoint::direct_task(project.clone(), predecessor.clone()),
            DependencyEndpoint::direct_task(project.clone(), WorkId::new("successor")),
        ],
        std::slice::from_ref(&edge),
    )
    .expect("dependency fixture is valid");
    let predecessor_identity =
        EntityIdentity::new(project.clone(), predecessor.clone(), EntityRevision::new(4));

    let non_accepting = [
        UpstreamOutcome::Open,
        UpstreamOutcome::Complete,
        UpstreamOutcome::Verified,
        UpstreamOutcome::Cancelled,
        UpstreamOutcome::Failed,
        UpstreamOutcome::Closed(ClosedOutcome::Unaccepted {
            identity: Some(predecessor_identity.clone()),
        }),
        UpstreamOutcome::Closed(ClosedOutcome::Revoked {
            identity: predecessor_identity.clone(),
            proof_generation: ProofRevision::new(9),
        }),
        UpstreamOutcome::Closed(ClosedOutcome::Accepted {
            identity: EntityIdentity::new(
                project.clone(),
                WorkId::new("other-predecessor"),
                EntityRevision::new(4),
            ),
            proof_generation: ProofRevision::new(9),
        }),
    ];
    for outcome in non_accepting {
        let evaluation = evaluate_dependencies(
            &graph,
            &[DependencyObservation {
                edge_id: edge.id.clone(),
                edge_revision: edge.revision,
                predecessor: predecessor_identity.clone(),
                outcome,
                waiver: None,
            }],
            EntityRevision::new(5),
        )
        .unwrap();
        assert!(!evaluation.satisfied());
        assert!(!evaluation.edges[0].satisfaction.is_satisfied());
    }

    let accepted = evaluate_dependencies(
        &graph,
        &[DependencyObservation {
            edge_id: edge.id.clone(),
            edge_revision: edge.revision,
            predecessor: predecessor_identity.clone(),
            outcome: UpstreamOutcome::Closed(ClosedOutcome::Accepted {
                identity: predecessor_identity.clone(),
                proof_generation: ProofRevision::new(9),
            }),
            waiver: None,
        }],
        EntityRevision::new(5),
    )
    .unwrap();
    assert!(accepted.satisfied());
    assert!(matches!(
        accepted.edges[0].satisfaction,
        EdgeSatisfaction::AcceptedClosed {
            proof_generation,
            ..
        } if proof_generation == ProofRevision::new(9)
    ));

    let raw = RawPrerequisiteContext::new(
        edge.id.clone(),
        edge.revision,
        predecessor_identity.clone(),
        "retained malformed prerequisite",
    );
    for outcome in [
        UpstreamOutcome::Unreadable(UnreadablePrerequisite {
            reason: UnreadableReason::Corrupt,
            raw: raw.clone(),
        }),
        UpstreamOutcome::Corrupt(CorruptPrerequisite {
            detail: "bad payload".into(),
            raw: raw.clone(),
        }),
        UpstreamOutcome::Stale(StalePrerequisite {
            expected: EntityRevision::new(4),
            observed: EntityRevision::new(3),
            raw: raw.clone(),
        }),
    ] {
        let evaluation = evaluate_dependencies(
            &graph,
            &[DependencyObservation {
                edge_id: edge.id.clone(),
                edge_revision: edge.revision,
                predecessor: predecessor_identity.clone(),
                outcome,
                waiver: None,
            }],
            EntityRevision::new(5),
        )
        .unwrap();
        assert!(!evaluation.satisfied());
        assert!(evaluation.edges[0].raw_observations[0]
            .outcome
            .eq(&evaluation.edges[0].outcome.clone().unwrap()));
    }

    let malformed_revision = evaluate_dependencies(
        &graph,
        &[DependencyObservation {
            edge_id: edge.id.clone(),
            edge_revision: EntityRevision::new(3),
            predecessor: predecessor_identity.clone(),
            outcome: UpstreamOutcome::Closed(ClosedOutcome::Accepted {
                identity: predecessor_identity.clone(),
                proof_generation: ProofRevision::new(9),
            }),
            waiver: None,
        }],
        EntityRevision::new(5),
    )
    .unwrap();
    assert!(!malformed_revision.satisfied());
    assert!(matches!(
        malformed_revision.edges[0].satisfaction,
        EdgeSatisfaction::Unmet {
            reason: UnmetReason::MalformedObservation { .. }
        }
    ));
    assert_eq!(malformed_revision.edges[0].raw_observations.len(), 1);
    assert!(matches!(
        malformed_revision.edges[0]
            .diagnostic
            .as_ref()
            .map(|diagnostic| &diagnostic.error),
        Some(DependencyEvaluationError::ObservationEdgeRevisionMismatch { .. })
    ));

    let waiver = EdgeWaiver {
        decision_id: DecisionId::new("waiver"),
        edge_id: edge.id.clone(),
        edge_revision: edge.revision,
        project_id: project,
        successor: WorkId::new("successor"),
        valid_from: EntityRevision::new(6),
        revoked_at: Some(EntityRevision::new(8)),
    };
    let waived_before = evaluate_dependencies(
        &graph,
        &[DependencyObservation {
            edge_id: edge.id.clone(),
            edge_revision: edge.revision,
            predecessor: predecessor_identity.clone(),
            outcome: UpstreamOutcome::Open,
            waiver: Some(waiver.clone()),
        }],
        EntityRevision::new(5),
    )
    .unwrap();
    assert!(matches!(
        waived_before.edges[0].satisfaction,
        EdgeSatisfaction::Unmet {
            reason: UnmetReason::WaiverNotYetValid
        }
    ));
    let waived = evaluate_dependencies(
        &graph,
        &[DependencyObservation {
            edge_id: edge.id.clone(),
            edge_revision: edge.revision,
            predecessor: predecessor_identity.clone(),
            outcome: UpstreamOutcome::Open,
            waiver: Some(waiver.clone()),
        }],
        EntityRevision::new(6),
    )
    .unwrap();
    assert!(matches!(
        waived.edges[0].satisfaction,
        EdgeSatisfaction::Waived { .. }
    ));
    let revoked = evaluate_dependencies(
        &graph,
        &[DependencyObservation {
            edge_id: edge.id,
            edge_revision: EntityRevision::new(4),
            predecessor: predecessor_identity,
            outcome: UpstreamOutcome::Open,
            waiver: Some(waiver),
        }],
        EntityRevision::new(8),
    )
    .unwrap();
    assert!(matches!(
        revoked.edges[0].satisfaction,
        EdgeSatisfaction::Unmet {
            reason: UnmetReason::WaiverRevoked
        }
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

fn action_facts_with_execution(role: ActorRole, phase: AttemptPhase) -> DecisionInputs {
    let mut facts = action_facts(role);
    let attempt = AttemptIdentity::new(AttemptId::new("attempt"), AttemptFence::new(1));
    let mut requirements = facts.requirements.as_present().unwrap().clone();
    requirements.proof.attempt = Some(attempt.clone());
    let proof = requirements.proof.clone();
    facts.requirements = Fact::present(requirements);
    facts.execution = Fact::present(ExecutionInput {
        attempt,
        actor_id: ActorId::new("actor"),
        session_id: Some(SessionId::new("session")),
        phase,
        claimed_at: TimestampMs(0),
        lease_deadline: TimestampMs(100),
        hard_deadline: TimestampMs(200),
        proof,
    });
    facts
}

fn action_facts_with_submission(role: ActorRole, state: SubmissionState) -> DecisionInputs {
    let mut facts = action_facts(role);
    let proof = facts.requirements.as_present().unwrap().proof.clone();
    facts.submission = Fact::present(SubmissionInput {
        id: SubmissionId::new("submission"),
        proof,
        summary_digest: ContentDigest::new("sha256:summary"),
        state,
    });
    facts
}

fn assert_action_allowed(
    facts: &DecisionInputs,
    status: DerivedStatus,
    reasons: &[ReasonCode],
    action: ActionKind,
) {
    let decision = evaluate_actions(&ActionEvaluationInput::new(facts, status, reasons));
    assert!(
        decision.allows(action),
        "expected {action:?} to be allowed for {status:?}; denial={:?}",
        decision.denial(action)
    );
}

#[test]
fn every_public_action_has_a_positive_normative_vector() {
    let baseline = action_facts(ActorRole::Agent);
    for action in [
        ActionKind::Inspect,
        ActionKind::ReadHistory,
        ActionKind::ReadOperation,
        ActionKind::Export,
    ] {
        assert_action_allowed(
            &baseline,
            DerivedStatus::Closed,
            &[ReasonCode::TerminalClosed],
            action,
        );
    }

    assert_action_allowed(
        &action_facts(ActorRole::Publisher),
        DerivedStatus::Draft,
        &[ReasonCode::NotPublished],
        ActionKind::Publish,
    );
    assert_action_allowed(
        &baseline,
        DerivedStatus::Ready,
        &[ReasonCode::Eligible],
        ActionKind::Claim,
    );

    let claimed = action_facts_with_execution(ActorRole::Agent, AttemptPhase::Claimed);
    assert_action_allowed(
        &claimed,
        DerivedStatus::Claimed,
        &[ReasonCode::AttemptUnaccepted],
        ActionKind::AcceptAttempt,
    );
    let accepted = action_facts_with_execution(ActorRole::Agent, AttemptPhase::Accepted);
    assert_action_allowed(
        &accepted,
        DerivedStatus::InProgress,
        &[ReasonCode::AttemptActive],
        ActionKind::StartAttempt,
    );
    let running = action_facts_with_execution(ActorRole::Agent, AttemptPhase::Running);
    for action in [
        ActionKind::Checkpoint,
        ActionKind::AttachEvidence,
        ActionKind::Submit,
    ] {
        assert_action_allowed(
            &running,
            DerivedStatus::InProgress,
            &[ReasonCode::AttemptActive],
            action,
        );
    }

    let submission = action_facts_with_submission(ActorRole::Agent, SubmissionState::Sealed);
    assert_action_allowed(
        &submission,
        DerivedStatus::AwaitingReview,
        &[ReasonCode::ReviewRequired],
        ActionKind::RequestReview,
    );
    let reviewer = action_facts_with_submission(ActorRole::Reviewer, SubmissionState::Sealed);
    assert_action_allowed(
        &reviewer,
        DerivedStatus::AwaitingReview,
        &[ReasonCode::ReviewRequired],
        ActionKind::Review,
    );
    assert_action_allowed(
        &submission,
        DerivedStatus::Complete,
        &[ReasonCode::CloseoutPending],
        ActionKind::FinishClose,
    );
    assert_action_allowed(
        &submission,
        DerivedStatus::Complete,
        &[ReasonCode::CloseoutPending],
        ActionKind::Close,
    );

    for action in [ActionKind::Stop, ActionKind::Release] {
        assert_action_allowed(
            &running,
            DerivedStatus::InProgress,
            &[ReasonCode::AttemptActive],
            action,
        );
    }
    let operator = action_facts(ActorRole::Operator);
    assert_action_allowed(
        &operator,
        DerivedStatus::Ready,
        &[],
        ActionKind::PausePolicy,
    );
    assert_action_allowed(
        &operator,
        DerivedStatus::Paused,
        &[ReasonCode::Paused],
        ActionKind::ResumePolicy,
    );
    assert_action_allowed(&operator, DerivedStatus::Ready, &[], ActionKind::Cancel);
    assert_action_allowed(
        &operator,
        DerivedStatus::Closed,
        &[ReasonCode::TerminalClosed],
        ActionKind::Reopen,
    );

    let mut held = operator.clone();
    held.holds = Fact::present(HoldsInput {
        holds: vec![HoldInput {
            id: HoldId::new("hold"),
            scope: IntegrityScope::work("project".into(), "work".into()),
            code: "operator_decision_required".into(),
            entity_revision: EntityRevision::new(7),
            active: true,
        }],
    });
    assert_action_allowed(
        &held,
        DerivedStatus::Blocked,
        &[ReasonCode::HardHold("operator_decision_required".into())],
        ActionKind::ResolveHold,
    );
    assert_action_allowed(
        &operator,
        DerivedStatus::Queued,
        &[],
        ActionKind::WaiveDependency,
    );
    assert_action_allowed(
        &operator,
        DerivedStatus::Blocked,
        &[],
        ActionKind::ForceGate,
    );
    assert_action_allowed(
        &operator,
        DerivedStatus::ExpiredReview,
        &[ReasonCode::ExpiryReviewRequired],
        ActionKind::Recover,
    );
    let mut recovery = operator.clone();
    recovery.recovery = Fact::present(RecoveryInput {
        id: RecoveryId::new("recovery"),
        attempt: AttemptIdentity::new(AttemptId::new("attempt"), AttemptFence::new(1)),
        reason: RecoveryReason::StopUnknown,
        resource: ResourceDisposition::Unknown,
        unresolved: true,
        owner_id: Some(ActorId::new("operator")),
    });
    assert_action_allowed(
        &recovery,
        DerivedStatus::Blocked,
        &[],
        ActionKind::ReconcileResource,
    );
    let mut quarantined = operator;
    quarantined.integrity = IntegrityInput {
        scope: IntegrityScope::work("project".into(), "work".into()),
        level: IntegrityLevel::Quarantined,
        diagnostics: vec![IntegrityDiagnostic {
            scope: IntegrityScope::work("project".into(), "work".into()),
            code: IntegrityDiagnosticCode::Corrupt,
        }],
    };
    assert_action_allowed(
        &quarantined,
        DerivedStatus::Blocked,
        &[ReasonCode::HardHold("integrity_quarantined".into())],
        ActionKind::Repair,
    );
}

#[test]
fn action_status_matrix_and_typed_stale_denials_are_explicit() {
    let facts = action_facts(ActorRole::Agent);
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
        let input = ActionEvaluationInput::new(&facts, status, &[ReasonCode::Eligible]);
        assert_eq!(
            evaluate_actions(&input).allows(ActionKind::Claim),
            status == DerivedStatus::Ready,
            "claim status matrix row {status:?}"
        );
        if status != DerivedStatus::Ready {
            assert_eq!(
                action_denial_for(&facts, status, &[ReasonCode::Eligible], ActionKind::Claim),
                ActionDenialReason::StatusDenied(status)
            );
        }
    }
    assert_eq!(
        action_denial_for(
            &action_facts(ActorRole::Reviewer),
            DerivedStatus::Ready,
            &[ReasonCode::Eligible],
            ActionKind::Claim,
        ),
        ActionDenialReason::RoleDenied {
            required: vec![ActorRole::Agent],
            observed: ActorRole::Reviewer,
        }
    );
    assert_eq!(
        action_denial_for(
            &action_facts(ActorRole::Reviewer),
            DerivedStatus::Ready,
            &[ReasonCode::OperatorOnly],
            ActionKind::Claim,
        ),
        ActionDenialReason::RoleDenied {
            required: vec![ActorRole::Operator],
            observed: ActorRole::Reviewer,
        }
    );

    let input = ActionEvaluationInput::new(&facts, DerivedStatus::Ready, &[ReasonCode::Eligible]);
    let claim = evaluate_actions(&input)
        .allowed
        .into_iter()
        .find(|descriptor| descriptor.action == ActionKind::Claim)
        .expect("ready agent claim descriptor");
    let mut stale_snapshot = claim.request();
    stale_snapshot.expected_project_revision = Revision(11);
    assert!(matches!(
        evaluate_action(&input, &stale_snapshot),
        ActionAuthorization::Denied(denied)
            if matches!(denied.reason, ActionDenialReason::StaleSnapshot { .. })
    ));
    let mut stale_entity = claim.request();
    stale_entity.target.revision = EntityRevision::new(6);
    assert!(matches!(
        evaluate_action(&input, &stale_entity),
        ActionAuthorization::Denied(denied)
            if matches!(denied.reason, ActionDenialReason::StaleEntity { .. })
    ));

    let proof_facts = action_facts_with_submission(ActorRole::Agent, SubmissionState::Sealed);
    let proof_input = ActionEvaluationInput::new(
        &proof_facts,
        DerivedStatus::Complete,
        &[ReasonCode::CloseoutPending],
    );
    let close = evaluate_actions(&proof_input)
        .allowed
        .into_iter()
        .find(|descriptor| descriptor.action == ActionKind::Close)
        .expect("complete close descriptor");
    let mut stale_proof = close.request();
    stale_proof.expected_proof_revision = Some(ProofRevision::new(1));
    assert!(matches!(
        evaluate_action(&proof_input, &stale_proof),
        ActionAuthorization::Denied(denied)
            if matches!(denied.reason, ActionDenialReason::StaleProof { .. })
    ));

    let fenced_facts = action_facts_with_execution(ActorRole::Agent, AttemptPhase::Running);
    let fenced_input = ActionEvaluationInput::new(
        &fenced_facts,
        DerivedStatus::InProgress,
        &[ReasonCode::AttemptActive],
    );
    let submit = evaluate_actions(&fenced_input)
        .allowed
        .into_iter()
        .find(|descriptor| descriptor.action == ActionKind::Submit)
        .expect("running submit descriptor");
    let mut stale_fence = submit.request();
    stale_fence.attempt = Some(AttemptIdentity::new(
        AttemptId::new("attempt"),
        AttemptFence::new(2),
    ));
    assert!(matches!(
        evaluate_action(&fenced_input, &stale_fence),
        ActionAuthorization::Denied(denied)
            if matches!(denied.reason, ActionDenialReason::StaleFence { .. })
    ));
}

#[test]
fn historical_submission_and_review_states_do_not_change_claim_authority() {
    let baseline = action_facts(ActorRole::Agent);
    let baseline_decision = evaluate_actions(&ActionEvaluationInput::new(
        &baseline,
        DerivedStatus::Ready,
        &[ReasonCode::Eligible],
    ));
    let baseline_claim = baseline_decision
        .allowed
        .iter()
        .find(|descriptor| descriptor.action == ActionKind::Claim)
        .expect("baseline claim descriptor");

    for state in [SubmissionState::Superseded, SubmissionState::Rejected] {
        let facts = action_facts_with_submission(ActorRole::Agent, state);
        let decision = evaluate_actions(&ActionEvaluationInput::new(
            &facts,
            DerivedStatus::Ready,
            &[ReasonCode::Eligible],
        ));
        assert_eq!(
            decision
                .allowed
                .iter()
                .find(|descriptor| descriptor.action == ActionKind::Claim),
            Some(baseline_claim),
            "historical submission state {state:?} changed claim authority"
        );
    }

    let mut rejected_review =
        action_facts_with_submission(ActorRole::Agent, SubmissionState::Rejected);
    let proof = rejected_review
        .requirements
        .as_present()
        .unwrap()
        .proof
        .clone();
    rejected_review.review = Fact::present(ReviewInput {
        id: ReviewId::new("historical-review"),
        submission_id: SubmissionId::new("submission"),
        proof,
        reviewer_id: ActorId::new("reviewer"),
        attempt_actor_id: ActorId::new("actor"),
        outcome: ReviewOutcome::Rejected,
    });
    let decision = evaluate_actions(&ActionEvaluationInput::new(
        &rejected_review,
        DerivedStatus::Ready,
        &[ReasonCode::Eligible],
    ));
    assert_eq!(
        decision
            .allowed
            .iter()
            .find(|descriptor| descriptor.action == ActionKind::Claim),
        Some(baseline_claim)
    );
}

#[test]
fn malformed_facts_fail_closed_and_retain_typed_diagnostics() {
    let work_subject = FactSubject::work("project".into(), "work".into());
    let mut unreadable = action_facts(ActorRole::Agent);
    unreadable.lifecycle = Fact::unreadable(
        FactKind::Lifecycle,
        work_subject.clone(),
        UnreadableReason::Corrupt,
    );
    assert!(unreadable.validate().is_err());
    assert!(unreadable.diagnostics().iter().any(|diagnostic| matches!(
        diagnostic,
        DecisionDiagnostic::Fact(FactDiagnostic::Unreadable(_))
    )));
    assert_eq!(
        action_denial_for(
            &unreadable,
            DerivedStatus::Ready,
            &[ReasonCode::Eligible],
            ActionKind::Claim,
        ),
        ActionDenialReason::InvalidFacts
    );

    let mut stale = action_facts(ActorRole::Agent);
    stale.lifecycle = Fact::stale(
        FactKind::Lifecycle,
        work_subject.clone(),
        RevisionMarker::Snapshot(Revision(12)),
        RevisionMarker::Snapshot(Revision(11)),
    );
    assert!(stale.validate().is_err());
    assert!(stale.diagnostics().iter().any(|diagnostic| matches!(
        diagnostic,
        DecisionDiagnostic::Fact(FactDiagnostic::Stale(_))
    )));

    let mut terminal_missing_decision = action_facts(ActorRole::Agent);
    terminal_missing_decision.lifecycle = Fact::present(LifecycleInput {
        identity: terminal_missing_decision.subject.clone(),
        lifecycle: PersistedLifecycle::Closed,
        terminal_decision: None,
    });
    assert!(terminal_missing_decision
        .diagnostics()
        .iter()
        .any(|diagnostic| matches!(
            diagnostic,
            DecisionDiagnostic::Contradictory {
                code: ContradictionCode::TerminalDecisionMissing,
                ..
            }
        )));
    assert!(terminal_missing_decision.validate().is_err());

    let mut malformed_proof = action_facts(ActorRole::Agent);
    let mut requirements = malformed_proof.requirements.as_present().unwrap().clone();
    requirements.proof.policy_version.clear();
    malformed_proof.requirements = Fact::present(requirements);
    assert!(malformed_proof
        .diagnostics()
        .iter()
        .any(|diagnostic| matches!(
            diagnostic,
            DecisionDiagnostic::Contradictory {
                code: ContradictionCode::MalformedInput,
                ..
            }
        )));
    assert!(malformed_proof.validate().is_err());

    let mut self_review = action_facts(ActorRole::Reviewer);
    let proof = self_review.requirements.as_present().unwrap().proof.clone();
    self_review.submission = Fact::present(SubmissionInput {
        id: SubmissionId::new("submission"),
        proof: proof.clone(),
        summary_digest: ContentDigest::new("sha256:summary"),
        state: SubmissionState::Sealed,
    });
    self_review.review = Fact::present(ReviewInput {
        id: ReviewId::new("review"),
        submission_id: SubmissionId::new("submission"),
        proof,
        reviewer_id: ActorId::new("actor"),
        attempt_actor_id: ActorId::new("actor"),
        outcome: ReviewOutcome::Approved,
    });
    assert!(self_review.diagnostics().iter().any(|diagnostic| matches!(
        diagnostic,
        DecisionDiagnostic::Contradictory {
            code: ContradictionCode::SelfReview,
            ..
        }
    )));
    assert!(self_review.validate().is_err());
    assert_eq!(
        action_denial_for(
            &self_review,
            DerivedStatus::AwaitingReview,
            &[ReasonCode::ReviewRequired],
            ActionKind::Review,
        ),
        ActionDenialReason::InvalidFacts
    );

    let mut terminal_execution =
        action_facts_with_execution(ActorRole::Agent, AttemptPhase::Running);
    terminal_execution.execution = Fact::present(ExecutionInput {
        phase: AttemptPhase::Completed,
        ..terminal_execution.execution.as_present().unwrap().clone()
    });
    assert!(terminal_execution
        .diagnostics()
        .iter()
        .any(|diagnostic| matches!(
            diagnostic,
            DecisionDiagnostic::Contradictory {
                code: ContradictionCode::CurrentExecutionIsTerminal,
                ..
            }
        )));
    assert!(terminal_execution.validate().is_err());

    let mut integrity_conflict = action_facts(ActorRole::Agent);
    integrity_conflict
        .integrity
        .diagnostics
        .push(IntegrityDiagnostic {
            scope: IntegrityScope::work("project".into(), "work".into()),
            code: IntegrityDiagnosticCode::Corrupt,
        });
    assert!(integrity_conflict
        .diagnostics()
        .iter()
        .any(|diagnostic| matches!(
            diagnostic,
            DecisionDiagnostic::Contradictory {
                code: ContradictionCode::IntegrityLevelMismatch,
                ..
            }
        )));
    assert!(integrity_conflict.validate().is_err());

    let mut action_conflict = action_facts(ActorRole::Agent);
    action_conflict
        .permitted_actions
        .denied
        .push(boreal_domain::decision_inputs::DeniedAction {
            action: PermittedAction::Claim,
            reason: boreal_domain::decision_inputs::ActionDenialReason::PolicyDenied,
        });
    assert!(action_conflict
        .diagnostics()
        .iter()
        .any(|diagnostic| matches!(
            diagnostic,
            DecisionDiagnostic::ActionConflict {
                action: PermittedAction::Claim
            }
        )));
    assert!(action_conflict.validate().is_err());
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
        DerivedStatus::Scheduled,
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

    let work = WorkItem::new(
        "project".into(),
        WorkId::new("scheduled-work"),
        WorkKind::Task,
        None,
        "scheduled work",
    )
    .open();
    let actor = ActorContext {
        actor_id: boreal_domain::ActorId::new("agent"),
        role: ActorRole::Agent,
    };
    let gates = work.acceptance_profile.gates.clone();
    let before_start = evaluate_status(
        boreal_domain::StatusContext::new(
            &work,
            &[],
            None,
            &gates,
            &actor,
            TimestampMs(99),
            Revision(4),
        )
        .with_schedule(schedule)
        .with_activation_at(TimestampMs(120)),
    );
    assert_eq!(before_start.display_status, DerivedStatus::Scheduled);
    assert_eq!(
        before_start.primary_reason,
        ReasonCode::ScheduledStart(TimestampMs(100))
    );
    assert_eq!(before_start.next_action, Some(DomainAction::WaitUntil));
    assert_eq!(before_start.next_status_change_at, Some(TimestampMs(100)));
    assert!(!before_start.claimable_for_actor);

    let at_work_start = evaluate_status(
        boreal_domain::StatusContext::new(
            &work,
            &[],
            None,
            &gates,
            &actor,
            TimestampMs(100),
            Revision(4),
        )
        .with_schedule(schedule)
        .with_activation_at(TimestampMs(120)),
    );
    assert_eq!(at_work_start.display_status, DerivedStatus::Scheduled);
    assert_eq!(
        at_work_start.primary_reason,
        ReasonCode::ScheduledStart(TimestampMs(120))
    );
    assert_eq!(at_work_start.next_status_change_at, Some(TimestampMs(120)));

    let at_activation = evaluate_status(
        boreal_domain::StatusContext::new(
            &work,
            &[],
            None,
            &gates,
            &actor,
            TimestampMs(120),
            Revision(4),
        )
        .with_schedule(schedule)
        .with_activation_at(TimestampMs(120)),
    );
    assert_eq!(at_activation.display_status, DerivedStatus::Ready);
    assert_eq!(at_activation.primary_reason, ReasonCode::Eligible);
    assert_eq!(at_activation.next_status_change_at, Some(TimestampMs(200)));
    assert!(at_activation.claimable_for_actor);

    // status/3 exposes `scheduled`; a status/2-compatible projection is
    // queued plus a scheduled-start reason and must never claim early.
    let facts = action_facts(ActorRole::Agent);
    let reasons = [ReasonCode::ScheduledStart(TimestampMs(100))];
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

#[test]
fn normative_illegal_vectors_i04_i06_i08_have_distinct_semantics() {
    // I04: a current fenced attempt is an incumbent, so a second claim is
    // denied by the current derived status and the denial retains that
    // attempt identity.  The persistent session race remains service-only.
    let incumbent = action_facts_with_execution(ActorRole::Agent, AttemptPhase::Claimed);
    let incumbent_attempt = incumbent
        .execution
        .as_present()
        .expect("I04 incumbent execution")
        .attempt
        .clone();
    let claim_denial = action_denial_for(
        &incumbent,
        DerivedStatus::Claimed,
        &[ReasonCode::AttemptUnaccepted],
        ActionKind::Claim,
    );
    assert_eq!(
        claim_denial,
        ActionDenialReason::StatusDenied(DerivedStatus::Claimed)
    );
    let claim_descriptor = evaluate_actions(&ActionEvaluationInput::new(
        &incumbent,
        DerivedStatus::Claimed,
        &[ReasonCode::AttemptUnaccepted],
    ))
    .denial(ActionKind::Claim)
    .expect("I04 claim denial")
    .descriptor
    .clone();
    assert_eq!(claim_descriptor.attempt, Some(incumbent_attempt));

    // I06: an executor cannot satisfy an independent-review gate by reviewing
    // its own attempt; the positive control proves that actor inequality is
    // the semantic distinction, not merely the presence of a review row.
    let self_review = ReviewRecord {
        reviewer_actor_id: ActorId::new("agent"),
        attempt_actor_id: ActorId::new("agent"),
        accepted: true,
    };
    assert_eq!(
        validate_independent_review(&self_review),
        Err(DomainError::ReviewerCannotReviewOwnAttempt)
    );
    assert_eq!(
        validate_independent_review(&ReviewRecord {
            reviewer_actor_id: ActorId::new("reviewer"),
            attempt_actor_id: ActorId::new("agent"),
            accepted: true,
        }),
        Ok(())
    );

    // I08: complete/verified/cancelled are not accepted closed outcomes. The
    // typed unmet reason and retained raw observation are both asserted; an
    // exact accepted closed identity is the positive control.
    let project = boreal_domain::ProjectId::new("project");
    let predecessor = WorkId::new("predecessor");
    let successor = WorkId::new("successor");
    let edge = CanonicalDependencyEdge::closed_only(
        DependencyId::new("i08-edge"),
        project.clone(),
        predecessor.clone(),
        successor.clone(),
        EntityRevision::new(4),
    );
    let graph = validate_dependency_graph(
        project.clone(),
        &[
            DependencyEndpoint::direct_task(project.clone(), predecessor.clone()),
            DependencyEndpoint::direct_task(project.clone(), successor),
        ],
        std::slice::from_ref(&edge),
    )
    .expect("I08 dependency fixture");
    let predecessor_identity = EntityIdentity::new(project, predecessor, EntityRevision::new(4));

    for outcome in [
        UpstreamOutcome::Complete,
        UpstreamOutcome::Verified,
        UpstreamOutcome::Cancelled,
    ] {
        let evaluation = evaluate_dependencies(
            &graph,
            &[DependencyObservation {
                edge_id: edge.id.clone(),
                edge_revision: edge.revision,
                predecessor: predecessor_identity.clone(),
                outcome: outcome.clone(),
                waiver: None,
            }],
            EntityRevision::new(5),
        )
        .expect("I08 observation evaluates");
        assert_eq!(
            evaluation.edges[0].satisfaction,
            EdgeSatisfaction::Unmet {
                reason: UnmetReason::NotAcceptedClosedOutcome,
            },
            "I08 outcome={outcome:?}"
        );
        assert_eq!(evaluation.edges[0].raw_observations[0].outcome, outcome);
    }

    let accepted = evaluate_dependencies(
        &graph,
        &[DependencyObservation {
            edge_id: edge.id,
            edge_revision: EntityRevision::new(4),
            predecessor: predecessor_identity.clone(),
            outcome: UpstreamOutcome::Closed(ClosedOutcome::Accepted {
                identity: predecessor_identity,
                proof_generation: ProofRevision::new(9),
            }),
            waiver: None,
        }],
        EntityRevision::new(5),
    )
    .expect("I08 accepted closed observation");
    assert!(accepted.satisfied());
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
    ("I07", VectorLayer::PureDomain),
    ("I08", VectorLayer::PureDomain),
    ("I09", VectorLayer::PureDomain),
    ("I10", VectorLayer::PureDomain),
    ("I11", VectorLayer::PureDomain),
    ("I12", VectorLayer::PureDomain),
    ("I13", VectorLayer::PureDomain),
    ("I14", VectorLayer::ServiceOnlyBoundary),
    ("I15", VectorLayer::PureDomain),
];

const LEGAL_VECTOR_BINDINGS: [(&str, &str); 18] = [
    ("T01", "publish"),
    ("T02", "claim"),
    ("T03", "accept"),
    ("T04", "start"),
    ("T05", "submit"),
    ("T06", "receipt"),
    ("T07", "review"),
    ("T08", "finish --close"),
    ("T09", "finish --close with gaps"),
    ("T10", "finish --release"),
    ("T11", "fail"),
    ("T12", "block/resolve hold"),
    ("T13", "pause/resume"),
    ("T14", "cancel"),
    ("T15", "reopen"),
    ("T16", "expiry_pending"),
    ("T17", "expire"),
    ("T18", "resolve expiry"),
];

const ILLEGAL_VECTOR_BINDINGS: [(&str, &str); 15] = [
    ("I01", "derived status write"),
    ("I02", "draft/queued claim or close"),
    ("I03", "claim with hold/pause/retry/expiry/attempt"),
    ("I04", "parallel attempt"),
    ("I05", "accept/finish/close before proof"),
    ("I06", "review without independent authorization"),
    ("I07", "complete to closed without close intent"),
    ("I08", "non-closed prerequisite satisfaction"),
    ("I09", "expired blind reclaim"),
    ("I10", "stale revision/fence"),
    ("I11", "receipt subject mismatch"),
    ("I12", "renew after expiry or extend hard budget"),
    ("I13", "role denied/self review"),
    ("I14", "operation replay conflict"),
    ("I15", "dependency cycle"),
];

fn assert_service_only_boundary(id: &str, table_phrase: &str) {
    assert_eq!(
        LEGAL_VECTOR_MAP
            .iter()
            .chain(ILLEGAL_VECTOR_MAP.iter())
            .find(|(vector_id, _)| *vector_id == id)
            .map(|(_, layer)| *layer),
        Some(VectorLayer::ServiceOnlyBoundary),
        "vector {id} must remain an explicit service-only boundary"
    );
    assert!(
        include_str!("../../../project/spec/transition-table.md")
            .lines()
            .any(|line| line.starts_with(&format!("| {id} |")) && line.contains(table_phrase)),
        "service-only vector {id} is not tied to its normative row"
    );
}

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
        1
    );
    assert_eq!(LEGAL_VECTOR_BINDINGS.len(), LEGAL_VECTOR_MAP.len());
    assert_eq!(ILLEGAL_VECTOR_BINDINGS.len(), ILLEGAL_VECTOR_MAP.len());
    for ((map_id, map_layer), (binding_id, _)) in LEGAL_VECTOR_MAP.iter().zip(LEGAL_VECTOR_BINDINGS)
    {
        assert_eq!(*map_id, binding_id);
        assert!(
            *map_layer == VectorLayer::PureDomain || *map_layer == VectorLayer::ServiceOnlyBoundary
        );
    }
    for ((map_id, map_layer), (binding_id, _)) in
        ILLEGAL_VECTOR_MAP.iter().zip(ILLEGAL_VECTOR_BINDINGS)
    {
        assert_eq!(*map_id, binding_id);
        assert!(
            *map_layer == VectorLayer::PureDomain || *map_layer == VectorLayer::ServiceOnlyBoundary
        );
    }
    for (id, _) in LEGAL_VECTOR_MAP.iter().chain(ILLEGAL_VECTOR_MAP.iter()) {
        assert_transition_table_row(id);
    }
    assert_service_only_boundary("T18", "resolve expiry");
    assert_service_only_boundary("I14", "Reused operation ID");

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

#[test]
fn normative_pure_vectors_have_semantic_positive_and_negative_results() {
    // T01–T07: the executable attempt path is a deterministic pure-domain
    // transition sequence. Store transactions and operation readback remain
    // outside this target.
    let mut attempt = Attempt::claim(
        WorkId::new("work"),
        AttemptId::new("attempt"),
        ActorId::new("agent"),
        Fence::new(1),
        TimestampMs(0),
        Some(100),
        Some(200),
    )
    .unwrap(); // T02: claim creates a claimed attempt.
    assert_eq!(attempt.phase, AttemptPhase::Claimed);
    transition_attempt(
        &mut attempt,
        AttemptOperation::Accept { at: TimestampMs(1) },
    )
    .unwrap(); // T03: accept.
    transition_attempt(&mut attempt, AttemptOperation::Start).unwrap(); // T04: start.
    transition_attempt(&mut attempt, AttemptOperation::Submit).unwrap(); // T05: submit.
    transition_attempt(&mut attempt, AttemptOperation::RecordReceipt).unwrap(); // T06: receipt.
    transition_attempt(&mut attempt, AttemptOperation::AcceptReview).unwrap(); // T07: review.
    assert_eq!(attempt.phase, AttemptPhase::Completed);

    // T08/T09: proof and close intent are distinct; a completed attempt with
    // no close intent is still not ready to close, while a gap is preserved.
    assert!(matches!(
        evaluate_close(
            &AcceptanceProfile::focused(),
            &AcceptanceProfile::focused().gates,
            None,
            false,
            &attempt,
            Fence::new(1),
        ),
        CloseReadiness::NotReady { gaps }
            if gaps.contains(&CloseGap::CloseIntentMissing)
    ));
    let mut unsatisfied = AcceptanceProfile::focused().gates;
    unsatisfied[1].state = GateState::Open;
    assert!(matches!(
        evaluate_close(
            &AcceptanceProfile::focused(),
            &unsatisfied,
            None,
            true,
            &attempt,
            Fence::new(1),
        ),
        CloseReadiness::NotReady { gaps }
            if gaps.contains(&CloseGap::GateUnsatisfied)
    ));

    // T10/T11: release and failure are terminal attempt outcomes and do not
    // masquerade as accepted completion.
    let mut released = Attempt::claim(
        WorkId::new("work"),
        AttemptId::new("released"),
        ActorId::new("agent"),
        Fence::new(2),
        TimestampMs(0),
        Some(100),
        Some(200),
    )
    .unwrap();
    transition_attempt(&mut released, AttemptOperation::Release).unwrap();
    assert_eq!(released.phase, AttemptPhase::Released);
    let mut failed = Attempt::claim(
        WorkId::new("work"),
        AttemptId::new("failed"),
        ActorId::new("agent"),
        Fence::new(3),
        TimestampMs(0),
        Some(100),
        Some(200),
    )
    .unwrap();
    transition_attempt(&mut failed, AttemptOperation::Accept { at: TimestampMs(1) }).unwrap();
    transition_attempt(&mut failed, AttemptOperation::Start).unwrap();
    transition_attempt(&mut failed, AttemptOperation::Fail).unwrap();
    assert_eq!(failed.phase, AttemptPhase::Failed);

    // T12–T15: intervention, pause/resume, cancellation, and reopen remain
    // explicit lifecycle facts rather than writable display labels.
    let mut held = open_work("held", PersistedLifecycle::Open);
    held.hard_holds = vec![ReasonCode::HardHold("operator_decision_required".into())];
    let actor = ActorContext {
        actor_id: ActorId::new("agent"),
        role: ActorRole::Agent,
    };
    let held_decision = evaluate_status(boreal_domain::StatusContext::new(
        &held,
        &[],
        None,
        &held.acceptance_profile.gates,
        &actor,
        TimestampMs(10),
        Revision(1),
    ));
    assert_eq!(held_decision.display_status, DerivedStatus::Blocked); // T12
    let mut paused = held.clone();
    paused.hard_holds.clear();
    paused.dispatch_policy = DispatchPolicy::Paused;
    let paused_decision = evaluate_status(boreal_domain::StatusContext::new(
        &paused,
        &[],
        None,
        &paused.acceptance_profile.gates,
        &actor,
        TimestampMs(10),
        Revision(1),
    ));
    assert_eq!(paused_decision.display_status, DerivedStatus::Paused); // T13
    paused.dispatch_policy = DispatchPolicy::Automatic;
    let resumed_decision = evaluate_status(boreal_domain::StatusContext::new(
        &paused,
        &[],
        None,
        &paused.acceptance_profile.gates,
        &actor,
        TimestampMs(10),
        Revision(1),
    ));
    assert_eq!(resumed_decision.display_status, DerivedStatus::Ready);
    assert_eq!(
        transition_lifecycle(PersistedLifecycle::Open, WorkOperation::Cancel),
        Ok(PersistedLifecycle::Cancelled)
    ); // T14
    assert_eq!(
        transition_lifecycle(PersistedLifecycle::Closed, WorkOperation::Reopen),
        Ok(PersistedLifecycle::Open)
    ); // T15

    // T16/T17: expiry is a two-step recovery obligation, never a blind retry.
    let mut expiring = Attempt::claim(
        WorkId::new("work"),
        AttemptId::new("expiring"),
        ActorId::new("agent"),
        Fence::new(4),
        TimestampMs(0),
        Some(10),
        Some(100),
    )
    .unwrap();
    transition_attempt(&mut expiring, AttemptOperation::ExpiryPending).unwrap();
    assert_eq!(expiring.phase, AttemptPhase::ExpiryPending);
    transition_attempt(&mut expiring, AttemptOperation::Expire).unwrap();
    assert_eq!(expiring.phase, AttemptPhase::Expired);

    // I01–I03 and I09: derived labels, draft/queued work, holds, pause,
    // retry, and expiry cannot be used as a claim authority.
    for status in [
        DerivedStatus::Draft,
        DerivedStatus::Queued,
        DerivedStatus::Blocked,
        DerivedStatus::Paused,
        DerivedStatus::RetryWait,
        DerivedStatus::Scheduled,
        DerivedStatus::ExpiredReview,
    ] {
        assert!(matches!(
            action_denial_for(
                &action_facts(ActorRole::Agent),
                status,
                &[ReasonCode::Eligible],
                ActionKind::Claim,
            ),
            ActionDenialReason::StatusDenied(actual) if actual == status
        ));
    }
    assert_eq!(
        reject_derived_status_write(DerivedStatus::Scheduled),
        Err(DomainError::DerivedStatusReadOnly {
            status: DerivedStatus::Scheduled
        })
    );

    // I04/I10/I11/I12/I13/I15: foreign/current fences, proof identity,
    // deadlines, role independence, and dependency cycles are rejected by
    // the pure validators.
    let current = Attempt::claim(
        WorkId::new("work"),
        AttemptId::new("current"),
        ActorId::new("agent"),
        Fence::new(5),
        TimestampMs(0),
        Some(10),
        Some(20),
    )
    .unwrap();
    let current_status = evaluate_status(boreal_domain::StatusContext::new(
        &open_work("work", PersistedLifecycle::Open),
        &[],
        Some(&current),
        &AcceptanceProfile::focused().gates,
        &actor,
        TimestampMs(1),
        Revision(1),
    ));
    assert_eq!(current_status.display_status, DerivedStatus::Claimed); // I04
    assert_eq!(
        validate_fence(Fence::new(4), Fence::new(5)),
        Err(DomainError::StaleFence)
    ); // I10
    assert_eq!(
        validate_independent_review(&ReviewRecord {
            reviewer_actor_id: ActorId::new("same"),
            attempt_actor_id: ActorId::new("same"),
            accepted: true,
        }),
        Err(DomainError::ReviewerCannotReviewOwnAttempt)
    ); // I13
    let mut deadline = current.clone();
    assert!(deadline.heartbeat(deadline.lease_deadline).is_err()); // I12

    let mut foreign_receipt = ReceiptIdentity {
        receipt_id: "receipt".into(),
        operation_id: "operation".into(),
        subject: ReceiptSubject {
            work_id: WorkId::new("other-work"),
            attempt_id: AttemptId::new("current"),
            fence: Fence::new(5),
            gate_id: GateId::new("verification"),
        },
        source_snapshot: "source".into(),
        config_identity: ConfigIdentity::new("config"),
        policy_version: "policy".into(),
    };
    assert_eq!(
        validate_receipt_subject(
            &foreign_receipt,
            &WorkId::new("work"),
            &AttemptId::new("current"),
            Fence::new(5),
        ),
        Err(DomainError::ReceiptSubjectMismatch)
    ); // I11
    foreign_receipt.subject.work_id = WorkId::new("work");
    foreign_receipt.subject.fence = Fence::new(4);
    assert_eq!(
        validate_receipt_subject(
            &foreign_receipt,
            &WorkId::new("work"),
            &AttemptId::new("current"),
            Fence::new(5),
        ),
        Err(DomainError::StaleFence)
    );

    let nodes = [
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
    ];
    let cycle = [
        BlockingDependency::new(WorkId::new("a"), WorkId::new("b")),
        BlockingDependency::new(WorkId::new("b"), WorkId::new("a")),
    ];
    assert!(matches!(
        validate_dependencies(&nodes, &cycle),
        Err(DomainError::DependencyCycle { .. })
    )); // I15

    // I06/I08 are covered by the independent-review and accepted-close
    // evaluators above; I14 and T18 remain explicit service/transaction
    // boundaries rather than fabricated pure-domain persistence.
}

#[test]
fn every_normative_vector_executes_a_distinct_semantic_assertion() {
    for (id, _) in LEGAL_VECTOR_MAP {
        assert_transition_table_row(id);
    }
    for (id, _) in ILLEGAL_VECTOR_MAP {
        assert_transition_table_row(id);
    }

    // T01: publication changes only the persisted lifecycle.
    assert_eq!(
        transition_lifecycle(PersistedLifecycle::Draft, WorkOperation::Publish),
        Ok(PersistedLifecycle::Open)
    );

    // T02: claim creates a fenced, leased attempt in the claimed phase.
    let claimed = Attempt::claim(
        WorkId::new("t02-work"),
        AttemptId::new("t02-attempt"),
        ActorId::new("agent"),
        Fence::new(1),
        TimestampMs(10),
        Some(30),
        Some(120),
    )
    .unwrap();
    assert_eq!(claimed.phase, AttemptPhase::Claimed);
    assert_eq!(claimed.lease_deadline, TimestampMs(40));
    assert_eq!(claimed.max_attempt_deadline, TimestampMs(130));

    // T03: only a claimed attempt can be accepted.
    let mut accepted = claimed.clone();
    assert_eq!(
        transition_attempt(
            &mut accepted,
            AttemptOperation::Accept {
                at: TimestampMs(11),
            },
        ),
        Ok(())
    );
    assert_eq!(accepted.phase, AttemptPhase::Accepted);
    assert_eq!(accepted.accepted_at, Some(TimestampMs(11)));

    // T04: acceptance is the precondition for starting execution.
    assert_eq!(
        transition_attempt(&mut accepted, AttemptOperation::Start),
        Ok(())
    );
    assert_eq!(accepted.phase, AttemptPhase::Running);

    // T05: running execution submits into verification.
    assert_eq!(
        transition_attempt(&mut accepted, AttemptOperation::Submit),
        Ok(())
    );
    assert_eq!(accepted.phase, AttemptPhase::Verifying);

    // T06: a receipt is bound to the exact work, attempt, and fence.
    let receipt = ReceiptIdentity {
        receipt_id: "t06-receipt".into(),
        operation_id: "t06-operation".into(),
        subject: ReceiptSubject {
            work_id: WorkId::new("t02-work"),
            attempt_id: AttemptId::new("t02-attempt"),
            fence: Fence::new(1),
            gate_id: GateId::new("verification"),
        },
        source_snapshot: "source".into(),
        config_identity: ConfigIdentity::new("config"),
        policy_version: "policy".into(),
    };
    assert_eq!(
        validate_receipt_subject(
            &receipt,
            &WorkId::new("t02-work"),
            &AttemptId::new("t02-attempt"),
            Fence::new(1),
        ),
        Ok(())
    );

    // T07: an independent reviewer is accepted as a distinct actor.
    assert_eq!(
        validate_independent_review(&ReviewRecord {
            reviewer_actor_id: ActorId::new("reviewer"),
            attempt_actor_id: ActorId::new("agent"),
            accepted: true,
        }),
        Ok(())
    );

    // T08: matching proof, satisfied gates, and close intent make closeout
    // ready; the persisted terminal write remains outside this layer.
    let focused = AcceptanceProfile::focused();
    let mut close_attempt = accepted.clone();
    close_attempt.phase = AttemptPhase::Completed;
    let satisfied = focused
        .gates
        .iter()
        .cloned()
        .map(GateRequirement::satisfied)
        .collect::<Vec<_>>();
    assert_eq!(
        evaluate_close(
            &focused,
            &satisfied,
            None,
            true,
            &close_attempt,
            Fence::new(1),
        ),
        CloseReadiness::ReadyToClose
    );

    // T09: a close request with an unsatisfied proof gate remains open.
    let mut incomplete = satisfied.clone();
    incomplete[1].state = GateState::Open;
    assert!(matches!(
        evaluate_close(
            &focused,
            &incomplete,
            None,
            true,
            &close_attempt,
            Fence::new(1),
        ),
        CloseReadiness::NotReady { gaps } if gaps.contains(&CloseGap::GateUnsatisfied)
    ));

    // T10: release is an explicit terminal attempt outcome, not success.
    let mut released = Attempt::claim(
        WorkId::new("t10-work"),
        AttemptId::new("t10-attempt"),
        ActorId::new("agent"),
        Fence::new(1),
        TimestampMs(0),
        Some(20),
        Some(50),
    )
    .unwrap();
    assert_eq!(
        transition_attempt(&mut released, AttemptOperation::Release),
        Ok(())
    );
    assert_eq!(released.phase, AttemptPhase::Released);

    // T11: failure preserves a failed attempt rather than completing it.
    let mut failed = Attempt::claim(
        WorkId::new("t11-work"),
        AttemptId::new("t11-attempt"),
        ActorId::new("agent"),
        Fence::new(1),
        TimestampMs(0),
        Some(20),
        Some(50),
    )
    .unwrap();
    transition_attempt(&mut failed, AttemptOperation::Accept { at: TimestampMs(1) }).unwrap();
    transition_attempt(&mut failed, AttemptOperation::Start).unwrap();
    assert_eq!(
        transition_attempt(&mut failed, AttemptOperation::Fail),
        Ok(())
    );
    assert_eq!(failed.phase, AttemptPhase::Failed);

    // T12: an explicit hold takes precedence over ordinary dispatch.
    let mut held = open_work("t12-work", PersistedLifecycle::Open);
    held.hard_holds = vec![ReasonCode::HardHold("operator_decision_required".into())];
    let holder = ActorContext {
        actor_id: ActorId::new("agent"),
        role: ActorRole::Agent,
    };
    let held_status = evaluate_status(boreal_domain::StatusContext::new(
        &held,
        &[],
        None,
        &held.acceptance_profile.gates,
        &holder,
        TimestampMs(10),
        Revision(1),
    ));
    assert_eq!(held_status.display_status, DerivedStatus::Blocked);

    // T13: pause is removed explicitly before ready can be derived again.
    let mut paused = open_work("t13-work", PersistedLifecycle::Open);
    paused.dispatch_policy = DispatchPolicy::Paused;
    let paused_status = evaluate_status(boreal_domain::StatusContext::new(
        &paused,
        &[],
        None,
        &paused.acceptance_profile.gates,
        &holder,
        TimestampMs(10),
        Revision(1),
    ));
    assert_eq!(paused_status.display_status, DerivedStatus::Paused);
    paused.dispatch_policy = DispatchPolicy::Automatic;
    let resumed_status = evaluate_status(boreal_domain::StatusContext::new(
        &paused,
        &[],
        None,
        &paused.acceptance_profile.gates,
        &holder,
        TimestampMs(10),
        Revision(1),
    ));
    assert_eq!(resumed_status.display_status, DerivedStatus::Ready);

    // T14: cancellation is an explicit persisted lifecycle transition.
    assert_eq!(
        transition_lifecycle(PersistedLifecycle::Open, WorkOperation::Cancel),
        Ok(PersistedLifecycle::Cancelled)
    );

    // T15: reopening a terminal lifecycle is explicit and returns to open.
    assert_eq!(
        transition_lifecycle(PersistedLifecycle::Closed, WorkOperation::Reopen),
        Ok(PersistedLifecycle::Open)
    );

    // T16: equality at the lease deadline is an expiry observation.
    let expiring = Attempt::claim(
        WorkId::new("t16-work"),
        AttemptId::new("t16-attempt"),
        ActorId::new("agent"),
        Fence::new(1),
        TimestampMs(0),
        Some(10),
        Some(100),
    )
    .unwrap();
    assert_eq!(
        expiring.expiry_reason(TimestampMs(10)),
        Some(ExpiryReason::LeaseElapsed)
    );

    // T17: expiry is a two-step state transition.
    let mut expired = expiring;
    expired.phase = AttemptPhase::Running;
    transition_attempt(&mut expired, AttemptOperation::ExpiryPending).unwrap();
    assert_eq!(expired.phase, AttemptPhase::ExpiryPending);
    transition_attempt(&mut expired, AttemptOperation::Expire).unwrap();
    assert_eq!(expired.phase, AttemptPhase::Expired);

    // T18: resolving expiry persists an operator disposition and therefore
    // remains a service boundary. The pure layer proves the terminal expiry
    // fact and deliberately does not fabricate the missing persistence step.
    assert_service_only_boundary("T18", "resolve expiry");
    assert_eq!(expired.phase, AttemptPhase::Expired);

    // I01: derived labels cannot be persisted.
    assert_eq!(
        reject_derived_status_write(DerivedStatus::Ready),
        Err(DomainError::DerivedStatusReadOnly {
            status: DerivedStatus::Ready,
        })
    );

    // I02: neither draft nor queued work is claimable.
    let facts = action_facts(ActorRole::Agent);
    for status in [DerivedStatus::Draft, DerivedStatus::Queued] {
        assert_eq!(
            action_denial_for(
                &facts,
                status,
                &[ReasonCode::NotPublished],
                ActionKind::Claim
            ),
            ActionDenialReason::StatusDenied(status)
        );
    }

    // I03: hold, pause, retry, and expiry all deny claim independently.
    for status in [
        DerivedStatus::Blocked,
        DerivedStatus::Paused,
        DerivedStatus::RetryWait,
        DerivedStatus::ExpiredReview,
    ] {
        assert_eq!(
            action_denial_for(&facts, status, &[ReasonCode::Eligible], ActionKind::Claim),
            ActionDenialReason::StatusDenied(status)
        );
    }

    // I04: a second attempt request carries a different fence/identity and
    // is rejected as stale; this is distinct from merely observing Claimed.
    let incumbent = action_facts_with_execution(ActorRole::Agent, AttemptPhase::Running);
    let action_input = ActionEvaluationInput::new(
        &incumbent,
        DerivedStatus::InProgress,
        &[ReasonCode::AttemptActive],
    );
    let action_decision = evaluate_actions(&action_input);
    let submit = action_decision
        .allowed
        .iter()
        .find(|descriptor| descriptor.action == ActionKind::Submit)
        .expect("I04 incumbent submit descriptor");
    let mut parallel_request = submit.request();
    parallel_request.attempt = Some(AttemptIdentity::new(
        AttemptId::new("parallel-attempt"),
        AttemptFence::new(2),
    ));
    let observed_attempt = parallel_request.attempt.clone();
    match evaluate_action(&action_input, &parallel_request) {
        ActionAuthorization::Denied(denied) => assert_eq!(
            denied.reason,
            ActionDenialReason::StaleFence {
                expected: submit.attempt.clone(),
                observed: observed_attempt,
            }
        ),
        ActionAuthorization::Allowed(_) => panic!("I04 parallel attempt was allowed"),
    }

    // I05: proof gaps deny close even when a close intent is supplied.
    let mut proof_gaps = focused.gates.clone();
    proof_gaps[1].state = GateState::Open;
    assert!(matches!(
        evaluate_close(
            &focused,
            &proof_gaps,
            None,
            true,
            &close_attempt,
            Fence::new(1),
        ),
        CloseReadiness::NotReady { gaps } if gaps.contains(&CloseGap::GateUnsatisfied)
    ));

    // I06: review-profile close requires an independent accepted decision;
    // no review and self-review produce different typed close gaps.
    let reviewed = AcceptanceProfile::reviewed();
    let mut review_gaps = reviewed.gates.clone();
    for gate in &mut review_gaps {
        gate.state = GateState::Satisfied;
        if gate.kind == GateKind::Review {
            gate.state = GateState::Open;
        }
    }
    assert!(matches!(
        evaluate_close(
            &reviewed,
            &review_gaps,
            None,
            true,
            &close_attempt,
            Fence::new(1),
        ),
        CloseReadiness::NotReady { gaps } if gaps.contains(&CloseGap::ReviewRequired)
    ));
    assert!(matches!(
        evaluate_close(
            &reviewed,
            &review_gaps,
            Some(&ReviewRecord {
                reviewer_actor_id: ActorId::new("agent"),
                attempt_actor_id: ActorId::new("agent"),
                accepted: true,
            }),
            true,
            &close_attempt,
            Fence::new(1),
        ),
        CloseReadiness::NotReady { gaps } if gaps.contains(&CloseGap::ReviewRejected)
    ));
    assert_eq!(
        evaluate_close(
            &reviewed,
            &review_gaps,
            Some(&ReviewRecord {
                reviewer_actor_id: ActorId::new("reviewer"),
                attempt_actor_id: ActorId::new("agent"),
                accepted: true,
            }),
            true,
            &close_attempt,
            Fence::new(1),
        ),
        CloseReadiness::ReadyToClose
    );

    // I07: complete work still needs a close intent.
    assert!(matches!(
        evaluate_close(
            &focused,
            &satisfied,
            None,
            false,
            &close_attempt,
            Fence::new(1),
        ),
        CloseReadiness::NotReady { gaps } if gaps.contains(&CloseGap::CloseIntentMissing)
    ));

    // I08: non-closed upstream outcomes remain unmet, with their raw facts
    // retained; the accepted identity is the distinct positive control.
    let project = boreal_domain::ProjectId::new("i08-project");
    let predecessor = WorkId::new("i08-predecessor");
    let edge = CanonicalDependencyEdge::closed_only(
        DependencyId::new("i08-edge-distinct"),
        project.clone(),
        predecessor.clone(),
        WorkId::new("i08-successor"),
        EntityRevision::new(4),
    );
    let graph = validate_dependency_graph(
        project.clone(),
        &[
            DependencyEndpoint::direct_task(project.clone(), predecessor.clone()),
            DependencyEndpoint::direct_task(project.clone(), WorkId::new("i08-successor")),
        ],
        std::slice::from_ref(&edge),
    )
    .unwrap();
    let predecessor_identity = EntityIdentity::new(project, predecessor, EntityRevision::new(4));
    for outcome in [
        UpstreamOutcome::Complete,
        UpstreamOutcome::Verified,
        UpstreamOutcome::Cancelled,
    ] {
        let evaluation = evaluate_dependencies(
            &graph,
            &[DependencyObservation {
                edge_id: edge.id.clone(),
                edge_revision: edge.revision,
                predecessor: predecessor_identity.clone(),
                outcome: outcome.clone(),
                waiver: None,
            }],
            EntityRevision::new(5),
        )
        .unwrap();
        assert_eq!(
            evaluation.edges[0].satisfaction,
            EdgeSatisfaction::Unmet {
                reason: UnmetReason::NotAcceptedClosedOutcome,
            },
            "I08 outcome={outcome:?}"
        );
        assert_eq!(evaluation.edges[0].raw_observations[0].outcome, outcome);
    }

    // I09: expiry recovery is available, while blind claim remains denied.
    let agent = action_facts(ActorRole::Agent);
    let operator = action_facts(ActorRole::Operator);
    assert_eq!(
        action_denial_for(
            &agent,
            DerivedStatus::ExpiredReview,
            &[ReasonCode::ExpiryReviewRequired],
            ActionKind::Claim,
        ),
        ActionDenialReason::StatusDenied(DerivedStatus::ExpiredReview)
    );
    assert_action_allowed(
        &operator,
        DerivedStatus::ExpiredReview,
        &[ReasonCode::ExpiryReviewRequired],
        ActionKind::Recover,
    );

    // I10: old fences are rejected without altering the expected fence.
    assert_eq!(
        validate_fence(Fence::new(1), Fence::new(2)),
        Err(DomainError::StaleFence)
    );

    // I11: a receipt for another work item is a subject mismatch.
    let mut foreign = receipt.clone();
    foreign.subject.work_id = WorkId::new("foreign-work");
    assert_eq!(
        validate_receipt_subject(
            &foreign,
            &WorkId::new("t02-work"),
            &AttemptId::new("t02-attempt"),
            Fence::new(1),
        ),
        Err(DomainError::ReceiptSubjectMismatch)
    );

    // I12: lease expiry rejects both heartbeat and renewal, and renewal never
    // changes the immutable hard budget.
    let mut deadline = Attempt::claim(
        WorkId::new("i12-work"),
        AttemptId::new("i12-attempt"),
        ActorId::new("agent"),
        Fence::new(1),
        TimestampMs(0),
        Some(10),
        Some(20),
    )
    .unwrap();
    let hard_deadline = deadline.max_attempt_deadline;
    assert_eq!(
        deadline.heartbeat(deadline.lease_deadline),
        Err(DomainError::LeaseExpired)
    );
    assert_eq!(
        deadline.renew_lease(deadline.lease_deadline, 100),
        Err(DomainError::LeaseExpired)
    );
    assert_eq!(deadline.max_attempt_deadline, hard_deadline);

    // I13: role denial and self-review are separate authority checks.
    assert!(matches!(
        action_denial_for(
            &action_facts(ActorRole::Reviewer),
            DerivedStatus::Ready,
            &[ReasonCode::Eligible],
            ActionKind::Claim,
        ),
        ActionDenialReason::RoleDenied { .. }
    ));
    assert_eq!(
        validate_independent_review(&ReviewRecord {
            reviewer_actor_id: ActorId::new("agent"),
            attempt_actor_id: ActorId::new("agent"),
            accepted: true,
        }),
        Err(DomainError::ReviewerCannotReviewOwnAttempt)
    );

    // I14: operation replay/digest conflict requires the persistent journal;
    // no pure-domain fake operation result is substituted.
    assert_service_only_boundary("I14", "operation ID");

    // I15: a graph cycle is rejected before dependency evaluation.
    let nodes = [
        WorkItem::new(
            "i15-project".into(),
            WorkId::new("a"),
            WorkKind::Task,
            None,
            "a",
        ),
        WorkItem::new(
            "i15-project".into(),
            WorkId::new("b"),
            WorkKind::Task,
            None,
            "b",
        ),
    ];
    let cycle = [
        BlockingDependency::new(WorkId::new("a"), WorkId::new("b")),
        BlockingDependency::new(WorkId::new("b"), WorkId::new("a")),
    ];
    assert!(matches!(
        validate_dependencies(&nodes, &cycle),
        Err(DomainError::DependencyCycle { .. })
    ));
}
