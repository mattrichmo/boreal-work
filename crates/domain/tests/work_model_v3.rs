use std::collections::{BTreeSet, HashSet};

use boreal_domain::work_model_v3::{
    evaluate_container_closeout, evaluate_schedule, validate_container_dispositions,
    validate_cycle_assignments, validate_decomposition, validate_direct_dependencies,
    validate_promotion, ActivationPolicy, CloseoutDispositionId, ContainerCloseoutReadiness,
    ContainerDisposition, Cycle, CycleAssignment, CycleAssignmentState, CycleId, DecompositionKind,
    DirectDependency, DispositionKind, ExecutionMode, FoldPolicy, GapPolicy, IntakeBucketId,
    IntakeItem, IntakeItemId, IntakeKind, IntakeLifecycle, IntakePromotion, IntakeStatus,
    LocalDate, LocalDateTime, LocalTime, PromotionId, PromotionTargetKind, RecurrenceEnd,
    TimeResolution, WeeklyRecurrence, WorkNode, WorkSchedule,
};
use boreal_domain::{ProjectId, TimestampMs, WorkId};

fn project() -> ProjectId {
    ProjectId::new("project-1")
}
fn work(id: &str) -> WorkId {
    WorkId::new(id)
}

#[test]
fn decomposition_separates_containers_from_direct_tasks() {
    let milestone = WorkNode::milestone(project(), work("m1"), "Release");
    let mut group = WorkNode::task(
        project(),
        work("group"),
        ExecutionMode::Container,
        Some(work("m1")),
        "Frontend",
    );
    group.kind = DecompositionKind::Task;
    let direct = WorkNode::task(
        project(),
        work("t1"),
        ExecutionMode::Direct,
        Some(work("group")),
        "Implement",
    );
    assert!(validate_decomposition(&[milestone.clone(), group.clone(), direct.clone()]).is_ok());

    let mut invalid = direct.clone();
    invalid.parent_id = None;
    let invalid_direct_parent = WorkNode::task(
        project(),
        work("t2"),
        ExecutionMode::Direct,
        Some(work("t1")),
        "Nested under direct",
    );
    assert!(validate_decomposition(&[milestone, invalid, invalid_direct_parent]).is_err());
}

#[test]
fn dependencies_are_direct_task_only_and_acyclic() {
    let nodes = vec![
        WorkNode::task(project(), work("a"), ExecutionMode::Direct, None, "A"),
        WorkNode::task(project(), work("b"), ExecutionMode::Direct, None, "B"),
        WorkNode::milestone(project(), work("m"), "M"),
    ];
    assert!(validate_direct_dependencies(
        &nodes,
        &[DirectDependency {
            blocker_id: work("a"),
            blocked_id: work("b")
        }],
    )
    .is_ok());
    assert!(validate_direct_dependencies(
        &nodes,
        &[DirectDependency {
            blocker_id: work("m"),
            blocked_id: work("b")
        }],
    )
    .is_err());
    assert!(validate_direct_dependencies(
        &nodes,
        &[
            DirectDependency {
                blocker_id: work("a"),
                blocked_id: work("b")
            },
            DirectDependency {
                blocker_id: work("b"),
                blocked_id: work("a")
            },
        ],
    )
    .is_err());
}

#[test]
fn schedule_distinguishes_availability_due_and_terminal_badges() {
    let schedule = WorkSchedule {
        not_before_at: Some(TimestampMs::from_millis(100)),
        due_at: Some(TimestampMs::from_millis(200)),
        target_start_at: Some(TimestampMs::from_millis(100)),
        target_end_at: Some(TimestampMs::from_millis(150)),
    };
    let before = evaluate_schedule(schedule, TimestampMs::from_millis(99), false).unwrap();
    assert!(!before.available);
    assert!(!before.overdue);
    assert_eq!(before.next_change_at, Some(TimestampMs::from_millis(100)));
    let due = evaluate_schedule(schedule, TimestampMs::from_millis(200), false).unwrap();
    assert!(due.available);
    assert!(due.overdue);
    assert_eq!(due.next_change_at, None);
    let terminal = evaluate_schedule(schedule, TimestampMs::from_millis(200), true).unwrap();
    assert!(!terminal.overdue);
}

#[test]
fn cycles_assign_tasks_without_reparenting_and_enforce_one_live_slot() {
    let mut cycle = Cycle::new(project(), CycleId::new("cycle-1"), "Week 1");
    cycle.start(TimestampMs::from_millis(10)).unwrap();
    let nodes = vec![WorkNode::task(
        project(),
        work("task"),
        ExecutionMode::Direct,
        None,
        "Task",
    )];
    let assignments = vec![CycleAssignment {
        id: "assignment-1".into(),
        cycle_id: cycle.id.clone(),
        work_id: work("task"),
        project_id: project(),
        state: CycleAssignmentState::Committed,
        activation_policy: ActivationPolicy::AtCycleStart,
        activation_at: None,
        predecessor_id: None,
        successor_id: None,
    }];
    assert!(validate_cycle_assignments(&[cycle.clone()], &nodes, &assignments).is_ok());
    assert_eq!(nodes[0].parent_id, None);
    let mut duplicate = assignments.clone();
    duplicate.push(CycleAssignment {
        id: "assignment-2".into(),
        ..assignments[0].clone()
    });
    assert!(validate_cycle_assignments(&[cycle], &nodes, &duplicate).is_err());
}

#[test]
fn weekly_recurrence_has_stable_local_slots_and_explicit_resolution_facts() {
    let recurrence = WeeklyRecurrence {
        anchor_local_start: LocalDateTime::new(
            LocalDate::new(2026, 9, 14),
            LocalTime::new(9, 0, 0),
        ),
        interval_weeks: 1,
        weekdays: BTreeSet::from([1, 3]),
        end: RecurrenceEnd::Count(3),
        gap_policy: GapPolicy::NextValid,
        fold_policy: FoldPolicy::EarlierOffset,
    };
    assert_eq!(
        recurrence.local_slot(0).unwrap().date,
        LocalDate::new(2026, 9, 14)
    );
    assert_eq!(
        recurrence.local_slot(1).unwrap().date,
        LocalDate::new(2026, 9, 16)
    );
    assert_eq!(
        recurrence.local_slot(2).unwrap().date,
        LocalDate::new(2026, 9, 21)
    );
    assert!(recurrence.local_slot(3).is_err());

    let start = TimeResolution {
        nominal_local: recurrence.local_slot(0).unwrap(),
        utc_instant: TimestampMs::from_millis(1_000),
        utc_offset_minutes: -360,
        timezone: "America/Regina".into(),
        tzdb_identity: "tzdb-test".into(),
        gap_policy: GapPolicy::NextValid,
        fold_policy: FoldPolicy::EarlierOffset,
    };
    assert!(start.validate().is_ok());
}

#[test]
fn intake_revisit_is_date_driven_and_promotions_bind_revision_and_digest() {
    let mut item = IntakeItem {
        id: IntakeItemId::new("note-1"),
        bucket_id: IntakeBucketId::new("inbox"),
        project_id: project(),
        kind: IntakeKind::Revisit,
        lifecycle: IntakeLifecycle::Captured,
        content: "Review deployment finding".into(),
        content_revision: 3,
        content_digest: "sha256:note".into(),
        revisit_at: Some(TimestampMs::from_millis(500)),
    };
    assert_eq!(
        item.status_at(TimestampMs::from_millis(499)),
        IntakeStatus::Inbox
    );
    item.transition(IntakeLifecycle::Triaged).unwrap();
    item.transition(IntakeLifecycle::Deferred).unwrap();
    assert_eq!(
        item.status_at(TimestampMs::from_millis(500)),
        IntakeStatus::RevisitDue
    );
    let promotion = IntakePromotion {
        id: PromotionId::new("promotion-1"),
        project_id: project(),
        intake_id: item.id.clone(),
        intake_revision: 3,
        intake_digest: "sha256:note".into(),
        target_kind: PromotionTargetKind::DraftWork,
        target_id: "task-draft".into(),
    };
    assert!(validate_promotion(&item, &promotion).is_ok());
    item.content_revision = 4;
    assert!(validate_promotion(&item, &promotion).is_err());
}

#[test]
fn container_closeout_requires_current_dispositions_and_own_summary() {
    let container = WorkNode::milestone(project(), work("m"), "Milestone");
    let child = WorkNode::task(
        project(),
        work("t"),
        ExecutionMode::Direct,
        Some(work("m")),
        "Task",
    );
    let disposition = ContainerDisposition {
        id: CloseoutDispositionId::new("disp-1"),
        container_id: container.id.clone(),
        descendant_id: child.id.clone(),
        project_id: project(),
        kind: DispositionKind::AcceptedClosed,
        descendant_revision: 8,
        descendant_outcome_digest: "sha256:closed".into(),
        replacement_id: None,
        reason: None,
        supersedes_id: None,
    };
    assert!(validate_container_dispositions(&container, &[child], &[disposition]).is_ok());
    let accepted = HashSet::from([work("t")])
        .into_iter()
        .collect::<BTreeSet<_>>();
    assert_eq!(
        evaluate_container_closeout(&[work("t")], &accepted, false, false, false),
        ContainerCloseoutReadiness::Closing
    );
    assert_eq!(
        evaluate_container_closeout(&[work("t")], &accepted, false, true, true),
        ContainerCloseoutReadiness::ReadyToClose
    );
    assert_eq!(
        evaluate_container_closeout(&[work("t"), work("missing")], &accepted, false, true, true),
        ContainerCloseoutReadiness::Attention
    );
}
