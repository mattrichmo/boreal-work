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
fn generated_dependency_sequences_match_reference_dag() {
    // This is a deterministic property-style test without adding a runtime
    // dependency: the small reference graph decides whether an edge is legal,
    // then the domain validator must agree for every generated prefix.
    fn reaches(
        edges: &[(boreal_domain::WorkId, boreal_domain::WorkId)],
        from: &boreal_domain::WorkId,
        target: &boreal_domain::WorkId,
    ) -> bool {
        let mut pending = vec![from.clone()];
        let mut visited = HashSet::new();
        while let Some(current) = pending.pop() {
            if !visited.insert(current.clone()) {
                continue;
            }
            if &current == target {
                return true;
            }
            pending.extend(
                edges
                    .iter()
                    .filter(|(blocker, _)| blocker == &current)
                    .map(|(_, blocked)| blocked.clone()),
            );
        }
        false
    }

    struct DeterministicRng(u64);
    impl DeterministicRng {
        fn next(&mut self, upper: usize) -> usize {
            self.0 = self
                .0
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1);
            (self.0 as usize) % upper
        }
    }

    for seed in 1..=64u64 {
        let mut rng = DeterministicRng(seed);
        let count = 2 + rng.next(12);
        let nodes = (0..count)
            .map(|index| {
                WorkNode::task(
                    project(),
                    work(&format!("generated-{seed}-{index}")),
                    ExecutionMode::Direct,
                    None,
                    "generated",
                )
            })
            .collect::<Vec<_>>();
        let mut accepted = Vec::<DirectDependency>::new();
        let mut reference = Vec::<(WorkId, WorkId)>::new();

        for _ in 0..256 {
            let blocker = nodes[rng.next(nodes.len())].id.clone();
            let blocked = nodes[rng.next(nodes.len())].id.clone();
            let expected = blocker != blocked
                && !reference.contains(&(blocker.clone(), blocked.clone()))
                && !reaches(&reference, &blocked, &blocker);
            let mut candidate = accepted.clone();
            candidate.push(DirectDependency {
                blocker_id: blocker.clone(),
                blocked_id: blocked.clone(),
            });
            let actual = validate_direct_dependencies(&nodes, &candidate).is_ok();
            assert_eq!(actual, expected, "seed={seed} edge={blocker}->{blocked}");
            if expected {
                accepted.push(DirectDependency {
                    blocker_id: blocker.clone(),
                    blocked_id: blocked.clone(),
                });
                reference.push((blocker, blocked));
            }
        }
    }
}

#[test]
fn generated_intake_lifecycle_sequences_match_reference_model() {
    struct DeterministicRng(u64);
    impl DeterministicRng {
        fn next(&mut self, upper: usize) -> usize {
            self.0 = self
                .0
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1);
            (self.0 as usize) % upper
        }
    }

    let states = [
        IntakeLifecycle::Captured,
        IntakeLifecycle::Triaged,
        IntakeLifecycle::Deferred,
        IntakeLifecycle::Resolved,
        IntakeLifecycle::Archived,
    ];
    let allowed = |from: IntakeLifecycle, to: IntakeLifecycle| {
        matches!(
            (from, to),
            (
                IntakeLifecycle::Captured,
                IntakeLifecycle::Triaged | IntakeLifecycle::Deferred | IntakeLifecycle::Archived
            ) | (
                IntakeLifecycle::Triaged,
                IntakeLifecycle::Deferred | IntakeLifecycle::Resolved | IntakeLifecycle::Archived
            ) | (
                IntakeLifecycle::Deferred,
                IntakeLifecycle::Triaged | IntakeLifecycle::Resolved | IntakeLifecycle::Archived
            ) | (
                IntakeLifecycle::Resolved,
                IntakeLifecycle::Triaged | IntakeLifecycle::Archived
            ) | (IntakeLifecycle::Archived, IntakeLifecycle::Triaged)
        )
    };

    for seed in 1..=64u64 {
        let mut rng = DeterministicRng(seed);
        let mut item = IntakeItem {
            id: IntakeItemId::new(format!("generated-intake-{seed}")),
            bucket_id: IntakeBucketId::new("inbox"),
            project_id: project(),
            kind: IntakeKind::Note,
            lifecycle: IntakeLifecycle::Captured,
            content: "generated".into(),
            content_revision: 1,
            content_digest: "sha256:generated".into(),
            revisit_at: None,
        };
        for _ in 0..128 {
            let next = states[rng.next(states.len())];
            let has_revisit = rng.next(2) == 1;
            item.revisit_at = has_revisit.then(|| TimestampMs::from_millis(500));
            let expected =
                allowed(item.lifecycle, next) && (next != IntakeLifecycle::Deferred || has_revisit);
            let actual = item.transition(next).is_ok();
            assert_eq!(
                actual, expected,
                "seed={seed} {:?}->{next:?}",
                item.lifecycle
            );
            if actual {
                assert_eq!(item.lifecycle, next);
            }
        }
    }
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
fn carry_over_requires_reciprocal_same_work_lineage_across_cycles() {
    let prior_cycle = Cycle::new(project(), CycleId::new("cycle-prior"), "Prior");
    let next_cycle = Cycle::new(project(), CycleId::new("cycle-next"), "Next");
    let nodes = vec![
        WorkNode::task(project(), work("task"), ExecutionMode::Direct, None, "Task"),
        WorkNode::task(
            project(),
            work("other"),
            ExecutionMode::Direct,
            None,
            "Other",
        ),
    ];
    let prior_assignment = CycleAssignment {
        id: "assignment-prior".into(),
        cycle_id: prior_cycle.id.clone(),
        work_id: work("task"),
        project_id: project(),
        state: CycleAssignmentState::CarriedOver,
        activation_policy: ActivationPolicy::AtCycleStart,
        activation_at: None,
        predecessor_id: None,
        successor_id: Some("assignment-next".into()),
    };
    let next_assignment = CycleAssignment {
        id: "assignment-next".into(),
        cycle_id: next_cycle.id.clone(),
        work_id: work("task"),
        project_id: project(),
        state: CycleAssignmentState::Planned,
        activation_policy: ActivationPolicy::AtCycleStart,
        activation_at: None,
        predecessor_id: Some("assignment-prior".into()),
        successor_id: None,
    };
    let cycles = [prior_cycle.clone(), next_cycle.clone()];
    let valid = [prior_assignment.clone(), next_assignment.clone()];

    assert!(validate_cycle_assignments(&cycles, &nodes, &valid).is_ok());

    let mut dangling = valid.clone();
    dangling[0].successor_id = Some("missing-assignment".into());
    assert!(validate_cycle_assignments(&cycles, &nodes, &dangling).is_err());

    let mut asymmetric = valid.clone();
    asymmetric[1].predecessor_id = None;
    assert!(validate_cycle_assignments(&cycles, &nodes, &asymmetric).is_err());

    let mut same_cycle = valid.clone();
    same_cycle[1].cycle_id = prior_cycle.id.clone();
    assert!(validate_cycle_assignments(&cycles, &nodes, &same_cycle).is_err());

    let mut different_work = valid.clone();
    different_work[1].work_id = work("other");
    assert!(validate_cycle_assignments(&cycles, &nodes, &different_work).is_err());

    let mut wrong_state = valid.clone();
    wrong_state[0].state = CycleAssignmentState::Completed;
    assert!(validate_cycle_assignments(&cycles, &nodes, &wrong_state).is_err());

    let mut no_successor = valid.clone();
    no_successor[0].successor_id = None;
    assert!(validate_cycle_assignments(&cycles, &nodes, &no_successor).is_err());

    let third_cycle = Cycle::new(project(), CycleId::new("cycle-third"), "Third");
    let mut cycle = valid.to_vec();
    cycle[0].predecessor_id = Some("assignment-next".into());
    cycle[1].state = CycleAssignmentState::CarriedOver;
    cycle[1].successor_id = Some("assignment-prior".into());
    cycle[1].cycle_id = third_cycle.id.clone();
    assert!(
        validate_cycle_assignments(&[prior_cycle, next_cycle, third_cycle], &nodes, &cycle)
            .is_err()
    );
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
