use boreal_domain::{
    evaluate_status, validate_hierarchy, validate_parent, ActorContext, ActorId, ActorRole,
    DerivedStatus, DomainAction, DomainError, ProjectId, ReasonCode, Revision, StatusContext,
    TimestampMs, WorkId, WorkItem, WorkKind,
};

fn project(value: &str) -> ProjectId {
    ProjectId::new(value)
}

fn work_id(value: &str) -> WorkId {
    WorkId::new(value)
}

fn open_work(project_id: &str, id: &str, kind: WorkKind, parent_id: Option<&str>) -> WorkItem {
    WorkItem::new(
        project(project_id),
        work_id(id),
        kind,
        parent_id.map(work_id),
        id,
    )
    .open()
}

fn agent() -> ActorContext {
    ActorContext {
        actor_id: ActorId::new("agent-1"),
        role: ActorRole::Agent,
    }
}

fn status(work: &WorkItem) -> boreal_domain::StatusDecision {
    let actor = agent();
    evaluate_status(StatusContext::new(
        work,
        &[],
        None,
        &work.acceptance_profile.gates,
        &actor,
        TimestampMs::from_millis(1_000),
        Revision(1),
    ))
}

#[test]
fn root_milestone_and_root_task_are_valid_but_root_sprint_is_rejected() {
    let milestone = open_work("project", "milestone", WorkKind::Milestone, None);
    let task = open_work("project", "task", WorkKind::Task, None);
    let sprint = open_work("project", "sprint", WorkKind::Sprint, None);

    assert!(validate_parent(&milestone, None).is_ok());
    assert!(validate_parent(&task, None).is_ok());
    assert!(matches!(
        validate_parent(&sprint, None),
        Err(DomainError::ParentRequired {
            kind: WorkKind::Sprint,
            ..
        })
    ));
    assert!(validate_hierarchy(&[milestone, task]).is_ok());
}

#[test]
fn milestone_sprint_task_hierarchy_is_valid() {
    let milestone = open_work("project", "milestone", WorkKind::Milestone, None);
    let sprint = open_work("project", "sprint", WorkKind::Sprint, Some("milestone"));
    let task = open_work("project", "task", WorkKind::Task, Some("sprint"));

    assert!(validate_parent(&sprint, Some(&milestone)).is_ok());
    assert!(validate_parent(&task, Some(&sprint)).is_ok());
    assert!(validate_hierarchy(&[milestone, sprint, task]).is_ok());
}

#[test]
fn invalid_reparenting_is_rejected() {
    let milestone = open_work("project", "milestone", WorkKind::Milestone, None);
    let sprint = open_work("project", "sprint", WorkKind::Sprint, Some("milestone"));
    let task = open_work("project", "task", WorkKind::Task, Some("sprint"));

    // A task cannot be moved directly under a milestone.
    assert!(matches!(
        validate_parent(&task, Some(&milestone)),
        Err(DomainError::InvalidParentKind {
            child: WorkKind::Task,
            parent: WorkKind::Milestone,
        })
    ));

    // A sprint cannot be moved below an executable task.
    assert!(matches!(
        validate_parent(&sprint, Some(&task)),
        Err(DomainError::InvalidParentKind {
            child: WorkKind::Sprint,
            parent: WorkKind::Task,
        })
    ));

    // Reparenting across projects is also invalid even when the kinds match.
    let other_milestone = open_work(
        "other-project",
        "other-milestone",
        WorkKind::Milestone,
        None,
    );
    assert!(matches!(
        validate_parent(&sprint, Some(&other_milestone)),
        Err(DomainError::CrossProjectReference { .. })
    ));
}

#[test]
fn open_containers_are_planning_only_and_never_claimable() {
    let milestone = open_work("project", "milestone", WorkKind::Milestone, None);
    let sprint = open_work("project", "sprint", WorkKind::Sprint, Some("milestone"));
    let task = open_work("project", "task", WorkKind::Task, Some("sprint"));

    for container in [&milestone, &sprint] {
        let decision = status(container);
        assert_eq!(decision.display_status, DerivedStatus::Queued);
        assert!(!decision.claimable_for_actor);
        assert_eq!(decision.next_action, None);
        assert!(decision
            .reason_codes
            .contains(&ReasonCode::ContainerPlanning));
    }

    let decision = status(&task);
    assert_eq!(decision.display_status, DerivedStatus::Ready);
    assert!(decision.claimable_for_actor);
    assert_eq!(decision.next_action, Some(DomainAction::Claim));
    assert!(decision.reason_codes.contains(&ReasonCode::Eligible));
}
