//! Focused pure-domain coverage for PF-S03-T07.
//!
use boreal_domain::rollups::*;
use boreal_domain::{DerivedStatus, GateId, PersistedLifecycle, ProjectId, TimestampMs, WorkId};

use boreal_domain::decision_inputs::{
    ContentDigest, EntityIdentity, EntityRevision, ProofRevision,
};
use boreal_domain::work_model_v3::{
    Cycle, CycleAssignment, CycleAssignmentState, CycleId, ExecutionMode,
};
fn project() -> ProjectId {
    ProjectId::new("project-1")
}

fn work(id: &str) -> WorkId {
    WorkId::new(id)
}

fn revision(value: u64) -> EntityRevision {
    EntityRevision::new(value)
}

fn identity(id: &str, value: u64) -> EntityIdentity {
    EntityIdentity::new(project(), work(id), revision(value))
}

fn task(id: &str, lifecycle: PersistedLifecycle, status: DerivedStatus) -> TaskRollupInput {
    TaskRollupInput::new(identity(id, 1), ExecutionMode::Direct, lifecycle, status)
}

fn accepted_task(id: &str) -> TaskRollupInput {
    let task_identity = identity(id, 2);
    let mut input = TaskRollupInput::new(
        task_identity.clone(),
        ExecutionMode::Direct,
        PersistedLifecycle::Closed,
        DerivedStatus::Closed,
    );
    input.requires_reconciliation = true;
    input.accepted_outcome = Some(AcceptedOutcome::new(
        task_identity.clone(),
        ProofRevision::new(8),
        ContentDigest::new(format!("sha256:{id}:closed")),
    ));
    input.disposition = Some(ScopeDisposition::accepted_closed(
        &task_identity,
        ContentDigest::new(format!("sha256:{id}:closed")),
    ));
    input
}

fn assignment(
    id: &str,
    cycle_id: &CycleId,
    work_id: &WorkId,
    state: CycleAssignmentState,
) -> CycleAssignment {
    CycleAssignment {
        id: id.into(),
        cycle_id: cycle_id.clone(),
        work_id: work_id.clone(),
        project_id: project(),
        state,
        activation_policy: boreal_domain::work_model_v3::ActivationPolicy::Immediate,
        activation_at: None,
        predecessor_id: None,
        successor_id: None,
    }
}

#[test]
fn deferred_cycle_separates_accepted_and_reconciled_scope() {
    let cycle_id = CycleId::new("cycle-deferred");
    let mut cycle = Cycle::new(project(), cycle_id.clone(), "Deferred delivery");
    cycle.start(TimestampMs::from_millis(10)).unwrap();

    let mut deferred = task("deferred", PersistedLifecycle::Open, DerivedStatus::Queued);
    deferred.requires_reconciliation = true;
    deferred.disposition = Some(ScopeDisposition::deferred("moved to next cycle"));

    let mut cancelled = task(
        "cancelled",
        PersistedLifecycle::Cancelled,
        DerivedStatus::Cancelled,
    );
    cancelled.requires_reconciliation = true;
    cancelled.disposition = Some(ScopeDisposition::accepted_cancelled(
        &cancelled.identity,
        ContentDigest::new("sha256:cancelled"),
    ));

    let mut replaced = task("replaced", PersistedLifecycle::Open, DerivedStatus::Queued);
    replaced.requires_reconciliation = true;
    replaced.disposition = Some(ScopeDisposition::replaced(
        work("replacement"),
        "superseded by a smaller task",
    ));

    let assignments = vec![
        CycleAssignmentRollupInput {
            assignment: assignment(
                "a-accepted",
                &cycle_id,
                &work("accepted"),
                CycleAssignmentState::Completed,
            ),
            task: accepted_task("accepted"),
        },
        CycleAssignmentRollupInput {
            assignment: assignment(
                "a-deferred",
                &cycle_id,
                &work("deferred"),
                CycleAssignmentState::Removed,
            ),
            task: deferred,
        },
        CycleAssignmentRollupInput {
            assignment: assignment(
                "a-cancelled",
                &cycle_id,
                &work("cancelled"),
                CycleAssignmentState::Removed,
            ),
            task: cancelled,
        },
        CycleAssignmentRollupInput {
            assignment: assignment(
                "a-replaced",
                &cycle_id,
                &work("replaced"),
                CycleAssignmentState::CarriedOver,
            ),
            task: replaced,
        },
    ];
    let rollup = evaluate_cycle_rollup(&CycleRollupInput {
        scope: RollupScope::cycle(project(), cycle_id.clone(), revision(42)),
        cycle,
        assignments,
        gate_gaps: Vec::new(),
        overdue: false,
        blockers: Vec::new(),
        integration_closeout: None,
    });

    assert_eq!(rollup.scope.revision, revision(42));
    assert_eq!(rollup.assignment_counts.live, 0);
    assert_eq!(rollup.totals.total, 4);
    assert_eq!(rollup.totals.accepted_closed, 1);
    assert_eq!(rollup.totals.accepted_cancelled, 1);
    assert_eq!(rollup.totals.deferred, 1);
    assert_eq!(rollup.totals.replaced, 1);
    assert_eq!(rollup.totals.reconciled_scope, 4);
    assert_eq!(rollup.totals.unresolved_scope, 0);
    assert_eq!(rollup.totals.accepted_closed, 1);
    assert_eq!(rollup.totals.accepted_percentage(), Some(25));
    assert_eq!(rollup.totals.reconciled_percentage(), Some(100));
    assert!(rollup.scope_reconciled);
    assert_eq!(rollup.state, CycleRollupState::ReadyToComplete);
    assert!(!rollup.claimable_for_actor);
}

#[test]
fn persisted_completed_cycle_with_unresolved_scope_reports_attention() {
    let cycle_id = CycleId::new("cycle-unresolved");
    let mut cycle = Cycle::new(project(), cycle_id.clone(), "Unresolved cycle");
    cycle.start(TimestampMs::from_millis(10)).unwrap();
    cycle.complete(TimestampMs::from_millis(20), 0).unwrap();

    let mut unresolved = task(
        "unresolved",
        PersistedLifecycle::Open,
        DerivedStatus::Queued,
    );
    unresolved.requires_reconciliation = true;
    let rollup = evaluate_cycle_rollup(&CycleRollupInput {
        scope: RollupScope::cycle(project(), cycle_id.clone(), revision(43)),
        cycle,
        assignments: vec![CycleAssignmentRollupInput {
            assignment: assignment(
                "a-unresolved",
                &cycle_id,
                &work("unresolved"),
                CycleAssignmentState::Removed,
            ),
            task: unresolved,
        }],
        gate_gaps: Vec::new(),
        overdue: false,
        blockers: Vec::new(),
        integration_closeout: None,
    });

    assert_eq!(rollup.state, CycleRollupState::Attention);
    assert!(!rollup.scope_reconciled);
    assert_eq!(rollup.totals.unresolved_scope, 1);
}

#[test]
fn persisted_completed_cycle_with_gate_or_integration_gaps_reports_attention() {
    let cycle_id = CycleId::new("cycle-closeout-gaps");
    let mut cycle = Cycle::new(project(), cycle_id.clone(), "Closeout gaps");
    cycle.start(TimestampMs::from_millis(10)).unwrap();
    cycle.complete(TimestampMs::from_millis(20), 0).unwrap();

    let rollup = evaluate_cycle_rollup(&CycleRollupInput {
        scope: RollupScope::cycle(project(), cycle_id.clone(), revision(44)),
        cycle,
        assignments: vec![CycleAssignmentRollupInput {
            assignment: assignment(
                "a-accepted",
                &cycle_id,
                &work("accepted"),
                CycleAssignmentState::Completed,
            ),
            task: accepted_task("accepted"),
        }],
        gate_gaps: vec![GateId::new("review")],
        overdue: false,
        blockers: Vec::new(),
        integration_closeout: Some(IntegrationCloseoutSpec {
            work_id: work("missing-integration-closeout"),
            required: true,
        }),
    });

    assert_eq!(rollup.state, CycleRollupState::Attention);
    assert!(rollup.scope_reconciled);
    assert_eq!(rollup.gate_review_gaps, vec![GateId::new("review")]);
    assert_eq!(
        rollup.integration_closeout.unwrap().state,
        IntegrationCloseoutState::Missing
    );
}

#[test]
fn queued_container_work_is_nonclaimable_and_not_a_hard_block() {
    let mut queued = task("queued", PersistedLifecycle::Open, DerivedStatus::Queued);
    queued.requires_reconciliation = true;
    queued.gate_gaps.push(GateId::new("verification"));
    queued.overdue = true;

    let mut input = ContainerRollupInput::new(
        RollupScope::container(project(), work("container"), revision(7)),
        vec![queued],
    );
    input.summary_present = false;
    input.integration_closeout = Some(IntegrationCloseoutSpec {
        work_id: work("queued"),
        required: false,
    });
    let rollup = evaluate_container_rollup(&input);

    assert!(!rollup.claimable_for_actor);
    assert_eq!(rollup.state, ContainerRollupState::Closing);
    assert!(rollup.blockers.is_empty());
    assert_eq!(rollup.totals.active_work, 0);
    assert_eq!(rollup.totals.blocked_work, 0);
    assert_eq!(rollup.totals.gate_review_gaps, 1);
    assert_eq!(rollup.totals.gate_review_gap_tasks, 1);
    assert_eq!(rollup.totals.overdue_work, 1);
    assert!(rollup.overdue);
    assert_eq!(rollup.totals.unresolved_scope, 1);
    assert_eq!(rollup.totals.incomplete_descendants, 1);
    assert_eq!(
        rollup.integration_closeout,
        Some(IntegrationCloseoutRollup {
            work_id: work("queued"),
            required: false,
            state: IntegrationCloseoutState::Pending,
        })
    );
}

#[test]
fn active_gate_overdue_and_blocker_totals_stay_separate() {
    let mut active = task(
        "active",
        PersistedLifecycle::Open,
        DerivedStatus::InProgress,
    );
    active.requires_reconciliation = true;
    active.active_execution = true;
    active.gate_gaps.push(GateId::new("review"));
    active.overdue = true;
    active
        .blockers
        .push(RollupBlocker::new(work("active"), "dependency_open"));

    let mut input = ContainerRollupInput::new(
        RollupScope::container(project(), work("container"), revision(8)),
        vec![active],
    );
    input.summary_present = true;
    let rollup = evaluate_container_rollup(&input);

    assert_eq!(rollup.totals.total, 1);
    assert_eq!(rollup.totals.active_work, 1);
    assert_eq!(rollup.totals.gate_review_gaps, 1);
    assert_eq!(rollup.totals.gate_review_gap_tasks, 1);
    assert_eq!(rollup.totals.overdue_work, 1);
    assert_eq!(rollup.totals.blockers, 1);
    assert_eq!(rollup.totals.blocked_work, 1);
    assert_eq!(rollup.totals.unresolved_scope, 1);
    assert_eq!(rollup.state, ContainerRollupState::Attention);
}

#[test]
fn container_inputs_cannot_make_a_container_task_claimable() {
    let mut container_task = TaskRollupInput::new(
        identity("nested-container", 3),
        ExecutionMode::Container,
        PersistedLifecycle::Open,
        DerivedStatus::Ready,
    );
    container_task.claimable_for_actor = true;

    let rollup = evaluate_task_rollup(&container_task);

    assert!(!rollup.claimable_for_actor);
    assert_eq!(rollup.quality, RollupQuality::Corrupt);
    assert!(rollup.diagnostics.contains(&RollupDiagnostic::Task {
        work_id: work("nested-container"),
        code: RollupFactDiagnostic::ContainerClaimabilityIgnored,
    }));
}

#[test]
fn corrupt_descendant_is_not_reported_as_fully_accepted() {
    let mut corrupt = task("corrupt", PersistedLifecycle::Closed, DerivedStatus::Closed);
    corrupt.requires_reconciliation = true;
    corrupt.accepted_outcome = Some(AcceptedOutcome::new(
        corrupt.identity.clone(),
        ProofRevision::new(4),
        ContentDigest::new("sha256:corrupt"),
    ));
    corrupt.disposition = Some(ScopeDisposition::accepted_closed(
        &corrupt.identity,
        ContentDigest::new("sha256:corrupt"),
    ));
    corrupt.integrity = DescendantIntegrity::Corrupt {
        code: "unreadable_gate".into(),
    };

    let mut input = ContainerRollupInput::new(
        RollupScope::container(project(), work("container"), revision(11)),
        vec![accepted_task("accepted"), corrupt],
    );
    input.summary_present = true;
    let rollup = evaluate_container_rollup(&input);

    assert_eq!(rollup.totals.total, 2);
    assert_eq!(rollup.totals.accepted_closed, 1);
    assert_eq!(rollup.totals.corrupt_descendants, 1);
    assert_eq!(rollup.totals.accepted_percentage(), None);
    assert!(!rollup.totals.is_fully_accepted());
    assert_eq!(rollup.quality, RollupQuality::Corrupt);
    assert_eq!(rollup.state, ContainerRollupState::Attention);
    assert!(!rollup.claimable_for_actor);
}
