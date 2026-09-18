//! Pure, additive work-model v3 contracts.
//!
//! This module intentionally does not alter the schema-2 `WorkItem` or claim
//! evaluator.  It provides the value objects and invariants that a later
//! application/store adapter can adopt behind `boreal.work-model/3`:
//! decomposition is separate from cycles, recurring cycles are materialized
//! occurrences, intake is not work, and calendar planning is not execution
//! timing.

use std::{
    collections::{BTreeMap, BTreeSet},
    fmt,
};

use super::{ProjectId, TimestampMs, WorkId};

macro_rules! model_id {
    ($name:ident) => {
        #[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
        pub struct $name(String);

        impl $name {
            pub fn new(value: impl Into<String>) -> Self {
                Self(value.into())
            }

            pub fn parse(value: impl Into<String>) -> Result<Self, ModelError> {
                let value = value.into();
                if value.is_empty()
                    || value.len() > 255
                    || value.chars().any(|c| c.is_control() || c.is_whitespace())
                {
                    return Err(ModelError::InvalidIdentifier {
                        kind: stringify!($name),
                        value,
                    });
                }
                Ok(Self(value))
            }

            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl From<&str> for $name {
            fn from(value: &str) -> Self {
                Self::new(value)
            }
        }

        impl From<String> for $name {
            fn from(value: String) -> Self {
                Self::new(value)
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str(&self.0)
            }
        }
    };
}

model_id!(CycleId);
model_id!(CycleSeriesId);
model_id!(CycleTemplateVersionId);
model_id!(IntakeBucketId);
model_id!(IntakeItemId);
model_id!(PromotionId);
model_id!(CloseoutDispositionId);

/// Work decomposition is deliberately smaller than the schema-2 kind enum.
/// A sprint/cycle is not a work parent in this model.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DecompositionKind {
    Milestone,
    Task,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ExecutionMode {
    Direct,
    Container,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkNode {
    pub id: WorkId,
    pub project_id: ProjectId,
    pub kind: DecompositionKind,
    pub execution_mode: ExecutionMode,
    pub parent_id: Option<WorkId>,
    pub title: String,
}

impl WorkNode {
    pub fn milestone(project_id: ProjectId, id: WorkId, title: impl Into<String>) -> Self {
        Self {
            id,
            project_id,
            kind: DecompositionKind::Milestone,
            execution_mode: ExecutionMode::Container,
            parent_id: None,
            title: title.into(),
        }
    }

    pub fn task(
        project_id: ProjectId,
        id: WorkId,
        execution_mode: ExecutionMode,
        parent_id: Option<WorkId>,
        title: impl Into<String>,
    ) -> Self {
        Self {
            id,
            project_id,
            kind: DecompositionKind::Task,
            execution_mode,
            parent_id,
            title: title.into(),
        }
    }

    pub fn is_direct(&self) -> bool {
        self.execution_mode == ExecutionMode::Direct
    }

    pub fn is_container(&self) -> bool {
        self.execution_mode == ExecutionMode::Container
    }
}

/// Validate the entire decomposition forest.  This is intentionally stricter
/// than schema 2: milestones can contain milestones/tasks, container tasks can
/// contain tasks, and direct tasks cannot have children.
pub fn validate_decomposition(nodes: &[WorkNode]) -> Result<(), ModelError> {
    let mut by_id = BTreeMap::new();
    for node in nodes {
        if by_id.insert(node.id.clone(), node).is_some() {
            return Err(ModelError::DuplicateIdentifier(node.id.to_string()));
        }
        if node.kind == DecompositionKind::Milestone
            && node.execution_mode != ExecutionMode::Container
        {
            return Err(ModelError::MilestoneMustBeContainer(node.id.clone()));
        }
    }

    let mut children = BTreeMap::<WorkId, Vec<WorkId>>::new();
    for node in nodes {
        let Some(parent_id) = &node.parent_id else {
            continue;
        };
        let Some(parent) = by_id.get(parent_id) else {
            return Err(ModelError::MissingParent(node.id.clone()));
        };
        if node.project_id != parent.project_id {
            return Err(ModelError::CrossProjectReference {
                from: node.id.clone(),
                to: parent.id.clone(),
            });
        }
        let allowed = matches!(
            (parent.kind, parent.execution_mode, node.kind),
            (
                DecompositionKind::Milestone,
                ExecutionMode::Container,
                DecompositionKind::Milestone,
            ) | (
                DecompositionKind::Milestone,
                ExecutionMode::Container,
                DecompositionKind::Task,
            ) | (
                DecompositionKind::Task,
                ExecutionMode::Container,
                DecompositionKind::Task,
            )
        );
        if !allowed {
            return Err(ModelError::InvalidParentShape {
                parent: parent.id.clone(),
                child: node.id.clone(),
            });
        }
        children
            .entry(parent.id.clone())
            .or_default()
            .push(node.id.clone());
    }

    for node in nodes {
        if node.is_direct() && children.contains_key(&node.id) {
            return Err(ModelError::DirectTaskHasChildren(node.id.clone()));
        }
    }

    // Parent links are a forest, not merely a set of non-self edges.
    for node in nodes {
        let mut seen = BTreeSet::new();
        let mut current = Some(node.id.clone());
        while let Some(id) = current {
            if !seen.insert(id.clone()) {
                return Err(ModelError::DecompositionCycle(id));
            }
            current = by_id.get(&id).and_then(|item| item.parent_id.clone());
        }
    }
    Ok(())
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DirectDependency {
    pub blocker_id: WorkId,
    pub blocked_id: WorkId,
}

pub fn validate_direct_dependencies(
    nodes: &[WorkNode],
    dependencies: &[DirectDependency],
) -> Result<(), ModelError> {
    validate_decomposition(nodes)?;
    let by_id = nodes
        .iter()
        .map(|n| (n.id.clone(), n))
        .collect::<BTreeMap<_, _>>();
    let mut edges = BTreeSet::new();
    for edge in dependencies {
        let Some(blocker) = by_id.get(&edge.blocker_id) else {
            return Err(ModelError::MissingWork(edge.blocker_id.clone()));
        };
        let Some(blocked) = by_id.get(&edge.blocked_id) else {
            return Err(ModelError::MissingWork(edge.blocked_id.clone()));
        };
        if blocker.project_id != blocked.project_id {
            return Err(ModelError::CrossProjectReference {
                from: blocker.id.clone(),
                to: blocked.id.clone(),
            });
        }
        if !blocker.is_direct() || !blocked.is_direct() {
            return Err(ModelError::DependencyEndpointNotDirect {
                blocker: blocker.id.clone(),
                blocked: blocked.id.clone(),
            });
        }
        if !edges.insert((edge.blocker_id.clone(), edge.blocked_id.clone())) {
            return Err(ModelError::DuplicateDependency {
                blocker: edge.blocker_id.clone(),
                blocked: edge.blocked_id.clone(),
            });
        }
        if edge.blocker_id == edge.blocked_id || reaches(&edges, &edge.blocked_id, &edge.blocker_id)
        {
            return Err(ModelError::DependencyCycle(edge.blocker_id.clone()));
        }
    }
    Ok(())
}

fn reaches(edges: &BTreeSet<(WorkId, WorkId)>, from: &WorkId, target: &WorkId) -> bool {
    if from == target {
        return true;
    }
    let mut stack = vec![from.clone()];
    let mut visited = BTreeSet::new();
    while let Some(current) = stack.pop() {
        if !visited.insert(current.clone()) {
            continue;
        }
        for (_source, destination) in edges.iter().filter(|(source, _)| source == &current) {
            if destination == target {
                return true;
            }
            stack.push(destination.clone());
        }
    }
    false
}

/// Calendar planning fields.  These are not attempt lease or hard-budget
/// fields; the executor owns those in the existing attempt model.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct WorkSchedule {
    pub not_before_at: Option<TimestampMs>,
    pub due_at: Option<TimestampMs>,
    pub target_start_at: Option<TimestampMs>,
    pub target_end_at: Option<TimestampMs>,
}

impl WorkSchedule {
    pub const fn empty() -> Self {
        Self {
            not_before_at: None,
            due_at: None,
            target_start_at: None,
            target_end_at: None,
        }
    }

    pub fn validate(&self) -> Result<(), ModelError> {
        if let (Some(start), Some(end)) = (self.target_start_at, self.target_end_at) {
            if end <= start {
                return Err(ModelError::InvalidSchedule(
                    "target_end_at must be after target_start_at",
                ));
            }
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ScheduleView {
    pub available: bool,
    pub overdue: bool,
    pub next_change_at: Option<TimestampMs>,
}

pub fn evaluate_schedule(
    schedule: WorkSchedule,
    as_of: TimestampMs,
    terminal: bool,
) -> Result<ScheduleView, ModelError> {
    schedule.validate()?;
    let available = schedule.not_before_at.is_none_or(|at| as_of >= at);
    let overdue = !terminal && schedule.due_at.is_some_and(|at| as_of >= at);
    let next_change_at = [schedule.not_before_at, schedule.due_at]
        .into_iter()
        .flatten()
        .filter(|at| *at > as_of)
        .min();
    Ok(ScheduleView {
        available,
        overdue,
        next_change_at,
    })
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CycleLifecycle {
    Planned,
    Active,
    Completed,
    Cancelled,
}

impl CycleLifecycle {
    pub const fn is_terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Cancelled)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Cycle {
    pub id: CycleId,
    pub project_id: ProjectId,
    pub name: String,
    pub goal: String,
    pub lifecycle: CycleLifecycle,
    pub scheduled_start_at: Option<TimestampMs>,
    pub scheduled_end_at: Option<TimestampMs>,
    pub actual_started_at: Option<TimestampMs>,
    pub actual_ended_at: Option<TimestampMs>,
}

impl Cycle {
    pub fn new(project_id: ProjectId, id: CycleId, name: impl Into<String>) -> Self {
        Self {
            id,
            project_id,
            name: name.into(),
            goal: String::new(),
            lifecycle: CycleLifecycle::Planned,
            scheduled_start_at: None,
            scheduled_end_at: None,
            actual_started_at: None,
            actual_ended_at: None,
        }
    }

    pub fn validate(&self) -> Result<(), ModelError> {
        if let (Some(start), Some(end)) = (self.scheduled_start_at, self.scheduled_end_at) {
            if end <= start {
                return Err(ModelError::InvalidSchedule(
                    "cycle end must be after cycle start",
                ));
            }
        }
        Ok(())
    }

    pub fn start(&mut self, at: TimestampMs) -> Result<(), ModelError> {
        if self.lifecycle != CycleLifecycle::Planned {
            return Err(ModelError::IllegalCycleTransition);
        }
        self.lifecycle = CycleLifecycle::Active;
        self.actual_started_at = Some(at);
        Ok(())
    }

    pub fn complete(&mut self, at: TimestampMs, live_assignments: usize) -> Result<(), ModelError> {
        if self.lifecycle != CycleLifecycle::Active {
            return Err(ModelError::IllegalCycleTransition);
        }
        if live_assignments != 0 {
            return Err(ModelError::CycleHasLiveAssignments);
        }
        self.lifecycle = CycleLifecycle::Completed;
        self.actual_ended_at = Some(at);
        Ok(())
    }

    pub fn cancel(&mut self, at: TimestampMs, live_assignments: usize) -> Result<(), ModelError> {
        if !matches!(
            self.lifecycle,
            CycleLifecycle::Planned | CycleLifecycle::Active
        ) {
            return Err(ModelError::IllegalCycleTransition);
        }
        if live_assignments != 0 {
            return Err(ModelError::CycleHasLiveAssignments);
        }
        self.lifecycle = CycleLifecycle::Cancelled;
        self.actual_ended_at = Some(at);
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CycleAssignmentState {
    Planned,
    Committed,
    Removed,
    Completed,
    CarriedOver,
}

impl CycleAssignmentState {
    pub const fn is_live(self) -> bool {
        matches!(self, Self::Planned | Self::Committed)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ActivationPolicy {
    AtCycleStart,
    Immediate,
    ExplicitNotBefore,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CycleAssignment {
    pub id: String,
    pub cycle_id: CycleId,
    pub work_id: WorkId,
    pub project_id: ProjectId,
    pub state: CycleAssignmentState,
    pub activation_policy: ActivationPolicy,
    pub activation_at: Option<TimestampMs>,
    pub predecessor_id: Option<String>,
    pub successor_id: Option<String>,
}

pub fn validate_cycle_assignments(
    cycles: &[Cycle],
    nodes: &[WorkNode],
    assignments: &[CycleAssignment],
) -> Result<(), ModelError> {
    validate_decomposition(nodes)?;
    let cycles = cycles
        .iter()
        .map(|c| (c.id.clone(), c))
        .collect::<BTreeMap<_, _>>();
    let nodes = nodes
        .iter()
        .map(|n| (n.id.clone(), n))
        .collect::<BTreeMap<_, _>>();
    let mut live_by_work = BTreeMap::<WorkId, String>::new();
    let mut ids = BTreeSet::new();
    for assignment in assignments {
        if !ids.insert(assignment.id.clone()) {
            return Err(ModelError::DuplicateIdentifier(assignment.id.clone()));
        }
        let Some(cycle) = cycles.get(&assignment.cycle_id) else {
            return Err(ModelError::MissingCycle(assignment.cycle_id.clone()));
        };
        let Some(work) = nodes.get(&assignment.work_id) else {
            return Err(ModelError::MissingWork(assignment.work_id.clone()));
        };
        if assignment.project_id != cycle.project_id || assignment.project_id != work.project_id {
            return Err(ModelError::AssignmentProjectMismatch(assignment.id.clone()));
        }
        if !work.is_direct() {
            return Err(ModelError::AssignmentRequiresDirectTask(
                assignment.work_id.clone(),
            ));
        }
        if cycle.lifecycle.is_terminal() && assignment.state.is_live() {
            return Err(ModelError::TerminalCycleHasLiveAssignment(
                assignment.cycle_id.clone(),
            ));
        }
        if assignment.activation_policy == ActivationPolicy::ExplicitNotBefore
            && assignment.activation_at.is_none()
        {
            return Err(ModelError::InvalidActivation(assignment.id.clone()));
        }
        if assignment.state.is_live()
            && live_by_work
                .insert(assignment.work_id.clone(), assignment.id.clone())
                .is_some()
        {
            return Err(ModelError::MultipleLiveAssignments(
                assignment.work_id.clone(),
            ));
        }
        if assignment.predecessor_id.as_deref() == Some(assignment.id.as_str())
            || assignment.successor_id.as_deref() == Some(assignment.id.as_str())
        {
            return Err(ModelError::AssignmentLineageCycle(assignment.id.clone()));
        }
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub struct LocalDate {
    pub year: i32,
    pub month: u8,
    pub day: u8,
}

impl LocalDate {
    pub const fn new(year: i32, month: u8, day: u8) -> Self {
        Self { year, month, day }
    }

    pub fn validate(self) -> Result<(), ModelError> {
        if !(1..=12).contains(&self.month)
            || self.day == 0
            || self.day > days_in_month(self.year, self.month)
        {
            return Err(ModelError::InvalidLocalDate(self));
        }
        Ok(())
    }

    /// ISO weekday, Monday = 1 through Sunday = 7.
    pub fn weekday(self) -> Result<u8, ModelError> {
        self.validate()?;
        let epoch = days_from_civil(1970, 1, 1);
        Ok(
            ((days_from_civil(self.year, self.month, self.day) - epoch + 3).rem_euclid(7) as u8)
                + 1,
        )
    }

    pub fn add_days(self, days: i64) -> Result<Self, ModelError> {
        self.validate()?;
        let (year, month, day) =
            civil_from_days(days_from_civil(self.year, self.month, self.day) + days);
        let result = Self::new(year, month, day);
        result.validate()?;
        Ok(result)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub struct LocalTime {
    pub hour: u8,
    pub minute: u8,
    pub second: u8,
}

impl LocalTime {
    pub const fn new(hour: u8, minute: u8, second: u8) -> Self {
        Self {
            hour,
            minute,
            second,
        }
    }
    pub fn validate(self) -> Result<(), ModelError> {
        if self.hour > 23 || self.minute > 59 || self.second > 59 {
            return Err(ModelError::InvalidLocalTime(self));
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub struct LocalDateTime {
    pub date: LocalDate,
    pub time: LocalTime,
}

impl LocalDateTime {
    pub const fn new(date: LocalDate, time: LocalTime) -> Self {
        Self { date, time }
    }
    pub fn validate(self) -> Result<(), ModelError> {
        self.date.validate().and(self.time.validate())
    }
    pub fn weekday(self) -> Result<u8, ModelError> {
        self.date.weekday()
    }
    pub fn add_days(self, days: i64) -> Result<Self, ModelError> {
        Ok(Self::new(self.date.add_days(days)?, self.time))
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum GapPolicy {
    NextValid,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FoldPolicy {
    EarlierOffset,
    LaterOffset,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RecurrenceEnd {
    Never,
    Count(u64),
    UntilLocalDate(LocalDate),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WeeklyRecurrence {
    pub anchor_local_start: LocalDateTime,
    pub interval_weeks: u32,
    pub weekdays: BTreeSet<u8>,
    pub end: RecurrenceEnd,
    pub gap_policy: GapPolicy,
    pub fold_policy: FoldPolicy,
}

impl WeeklyRecurrence {
    pub fn validate(&self) -> Result<(), ModelError> {
        self.anchor_local_start.validate()?;
        if self.interval_weeks == 0 {
            return Err(ModelError::InvalidRecurrence(
                "interval_weeks must be positive",
            ));
        }
        if self.weekdays.is_empty() || self.weekdays.iter().any(|day| !(1..=7).contains(day)) {
            return Err(ModelError::InvalidRecurrence(
                "weekdays must contain ISO weekdays 1..=7",
            ));
        }
        if !self.weekdays.contains(&self.anchor_local_start.weekday()?) {
            return Err(ModelError::InvalidRecurrence(
                "anchor weekday must be configured",
            ));
        }
        if let RecurrenceEnd::Count(count) = self.end {
            if count == 0 {
                return Err(ModelError::InvalidRecurrence("count must be positive"));
            }
        }
        if let RecurrenceEnd::UntilLocalDate(date) = self.end {
            date.validate()?;
        }
        Ok(())
    }

    /// Generate the nominal local value for a stable zero-based slot ordinal.
    /// Time-zone gap/fold resolution is deliberately supplied by the adapter;
    /// this function never silently invents a UTC instant.
    pub fn local_slot(&self, slot_ordinal: u64) -> Result<LocalDateTime, ModelError> {
        self.validate()?;
        if let RecurrenceEnd::Count(count) = self.end {
            if slot_ordinal >= count {
                return Err(ModelError::SlotOutOfRange(slot_ordinal));
            }
        }
        let anchor_weekday = self.anchor_local_start.weekday()?;
        let week_start = self
            .anchor_local_start
            .date
            .add_days(-(anchor_weekday as i64 - 1))?;
        let mut emitted = 0u64;
        let mut week = 0u64;
        loop {
            let base = week_start.add_days((week * 7) as i64)?;
            for weekday in &self.weekdays {
                let candidate = LocalDateTime::new(
                    base.add_days(*weekday as i64 - 1)?,
                    self.anchor_local_start.time,
                );
                if candidate < self.anchor_local_start {
                    continue;
                }
                if let RecurrenceEnd::UntilLocalDate(until) = self.end {
                    if candidate.date > until {
                        return Err(ModelError::SlotOutOfRange(slot_ordinal));
                    }
                }
                if emitted == slot_ordinal {
                    return Ok(candidate);
                }
                emitted = emitted
                    .checked_add(1)
                    .ok_or(ModelError::RecurrenceOverflow)?;
            }
            week = week
                .checked_add(self.interval_weeks as u64)
                .ok_or(ModelError::RecurrenceOverflow)?;
            if week > 5_000_000 {
                return Err(ModelError::RecurrenceOverflow);
            }
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TimeResolution {
    pub nominal_local: LocalDateTime,
    pub utc_instant: TimestampMs,
    pub utc_offset_minutes: i32,
    pub timezone: String,
    pub tzdb_identity: String,
    pub gap_policy: GapPolicy,
    pub fold_policy: FoldPolicy,
}

impl TimeResolution {
    pub fn validate(&self) -> Result<(), ModelError> {
        self.nominal_local.validate()?;
        if !(-24 * 60..=24 * 60).contains(&self.utc_offset_minutes) {
            return Err(ModelError::InvalidUtcOffset(self.utc_offset_minutes));
        }
        if self.timezone.trim().is_empty() || self.tzdb_identity.trim().is_empty() {
            return Err(ModelError::MissingTimeZoneIdentity);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CycleTemplate {
    pub id: CycleTemplateVersionId,
    pub series_id: CycleSeriesId,
    pub version: u32,
    pub effective_from_slot_ordinal: u64,
    pub name_pattern: String,
    pub goal_template: String,
    pub timezone: String,
    pub recurrence: WeeklyRecurrence,
}

impl CycleTemplate {
    pub fn validate(&self) -> Result<(), ModelError> {
        if self.version == 0 || self.timezone.trim().is_empty() {
            return Err(ModelError::InvalidRecurrence(
                "template version/timezone is missing",
            ));
        }
        self.recurrence.validate()
    }

    pub fn slot_key(&self, slot_ordinal: u64) -> String {
        format!("boreal.cycle-slot/1/{}/{}", self.series_id, slot_ordinal)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CycleSeriesLifecycle {
    Active,
    Paused,
    Retired,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CycleSeries {
    pub id: CycleSeriesId,
    pub project_id: ProjectId,
    pub name: String,
    pub lifecycle: CycleSeriesLifecycle,
    pub revision: u64,
}

impl CycleSeries {
    pub fn can_materialize(&self) -> bool {
        self.lifecycle == CycleSeriesLifecycle::Active
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CycleInstance {
    pub id: CycleId,
    pub project_id: ProjectId,
    pub series_id: CycleSeriesId,
    pub template_version_id: CycleTemplateVersionId,
    pub slot_ordinal: u64,
    pub slot_key: String,
    pub name: String,
    pub scheduled_start: TimeResolution,
    pub scheduled_end: Option<TimeResolution>,
}

impl CycleInstance {
    pub fn validate(&self) -> Result<(), ModelError> {
        self.scheduled_start.validate()?;
        if let Some(end) = &self.scheduled_end {
            end.validate()?;
            if end.utc_instant <= self.scheduled_start.utc_instant {
                return Err(ModelError::InvalidSchedule(
                    "cycle instance end must be after start",
                ));
            }
        }
        if self.slot_key
            != format!(
                "boreal.cycle-slot/1/{}/{}",
                self.series_id, self.slot_ordinal
            )
        {
            return Err(ModelError::InvalidSlotKey);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntakeBucket {
    pub id: IntakeBucketId,
    pub project_id: ProjectId,
    pub name: String,
    pub archived: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum IntakeKind {
    Note,
    Discovery,
    Question,
    Revisit,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum IntakeLifecycle {
    Captured,
    Triaged,
    Deferred,
    Resolved,
    Archived,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum IntakeStatus {
    Inbox,
    Attention,
    Waiting,
    RevisitDue,
    Resolved,
    Archived,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntakeItem {
    pub id: IntakeItemId,
    pub bucket_id: IntakeBucketId,
    pub project_id: ProjectId,
    pub kind: IntakeKind,
    pub lifecycle: IntakeLifecycle,
    pub content: String,
    pub content_revision: u64,
    pub content_digest: String,
    pub revisit_at: Option<TimestampMs>,
}

impl IntakeItem {
    pub fn transition(&mut self, next: IntakeLifecycle) -> Result<(), ModelError> {
        let allowed = matches!(
            (self.lifecycle, next),
            (
                IntakeLifecycle::Captured,
                IntakeLifecycle::Triaged | IntakeLifecycle::Deferred | IntakeLifecycle::Archived,
            ) | (
                IntakeLifecycle::Triaged,
                IntakeLifecycle::Deferred | IntakeLifecycle::Resolved | IntakeLifecycle::Archived,
            ) | (
                IntakeLifecycle::Deferred,
                IntakeLifecycle::Triaged | IntakeLifecycle::Resolved | IntakeLifecycle::Archived,
            ) | (
                IntakeLifecycle::Resolved,
                IntakeLifecycle::Triaged | IntakeLifecycle::Archived,
            ) | (IntakeLifecycle::Archived, IntakeLifecycle::Triaged)
        );
        if !allowed {
            return Err(ModelError::IllegalIntakeTransition);
        }
        if matches!(next, IntakeLifecycle::Deferred) && self.revisit_at.is_none() {
            return Err(ModelError::DeferredWithoutRevisit);
        }
        self.lifecycle = next;
        Ok(())
    }

    pub fn status_at(&self, as_of: TimestampMs) -> IntakeStatus {
        match self.lifecycle {
            IntakeLifecycle::Captured => IntakeStatus::Inbox,
            IntakeLifecycle::Triaged => IntakeStatus::Attention,
            IntakeLifecycle::Deferred => match self.revisit_at {
                Some(at) if as_of >= at => IntakeStatus::RevisitDue,
                _ => IntakeStatus::Waiting,
            },
            IntakeLifecycle::Resolved => IntakeStatus::Resolved,
            IntakeLifecycle::Archived => IntakeStatus::Archived,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PromotionTargetKind {
    DraftWork,
    SourceVersion,
    MemoryDraft,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntakePromotion {
    pub id: PromotionId,
    pub project_id: ProjectId,
    pub intake_id: IntakeItemId,
    pub intake_revision: u64,
    pub intake_digest: String,
    pub target_kind: PromotionTargetKind,
    pub target_id: String,
}

pub fn validate_promotion(
    item: &IntakeItem,
    promotion: &IntakePromotion,
) -> Result<(), ModelError> {
    if item.project_id != promotion.project_id || item.id != promotion.intake_id {
        return Err(ModelError::PromotionSubjectMismatch);
    }
    if item.content_revision != promotion.intake_revision
        || item.content_digest != promotion.intake_digest
    {
        return Err(ModelError::PromotionSourceChanged);
    }
    if promotion.target_id.trim().is_empty() {
        return Err(ModelError::InvalidIdentifier {
            kind: "promotion.target_id",
            value: promotion.target_id.clone(),
        });
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DispositionKind {
    AcceptedClosed,
    AcceptedCancelled,
    Deferred,
    Replaced,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContainerDisposition {
    pub id: CloseoutDispositionId,
    pub container_id: WorkId,
    pub descendant_id: WorkId,
    pub project_id: ProjectId,
    pub kind: DispositionKind,
    pub descendant_revision: u64,
    pub descendant_outcome_digest: String,
    pub replacement_id: Option<WorkId>,
    pub reason: Option<String>,
    pub supersedes_id: Option<CloseoutDispositionId>,
}

pub fn validate_container_dispositions(
    container: &WorkNode,
    descendants: &[WorkNode],
    dispositions: &[ContainerDisposition],
) -> Result<(), ModelError> {
    if !container.is_container() {
        return Err(ModelError::ContainerRequired(container.id.clone()));
    }
    let descendant_ids = descendants
        .iter()
        .map(|node| node.id.clone())
        .collect::<BTreeSet<_>>();
    let mut current = BTreeSet::new();
    for disposition in dispositions {
        if disposition.project_id != container.project_id
            || disposition.container_id != container.id
            || !descendant_ids.contains(&disposition.descendant_id)
            || disposition.descendant_id == container.id
        {
            return Err(ModelError::InvalidDispositionSubject(
                disposition.id.clone(),
            ));
        }
        if !current.insert(disposition.descendant_id.clone()) && disposition.supersedes_id.is_none()
        {
            return Err(ModelError::DuplicateCurrentDisposition(
                disposition.descendant_id.clone(),
            ));
        }
        match disposition.kind {
            DispositionKind::AcceptedClosed | DispositionKind::AcceptedCancelled => {
                if disposition.replacement_id.is_some() {
                    return Err(ModelError::InvalidDispositionShape);
                }
            }
            DispositionKind::Deferred => {
                if disposition
                    .reason
                    .as_deref()
                    .unwrap_or("")
                    .trim()
                    .is_empty()
                    || disposition.replacement_id.is_some()
                {
                    return Err(ModelError::InvalidDispositionShape);
                }
            }
            DispositionKind::Replaced => {
                if disposition.replacement_id.is_none()
                    || disposition
                        .reason
                        .as_deref()
                        .unwrap_or("")
                        .trim()
                        .is_empty()
                {
                    return Err(ModelError::InvalidDispositionShape);
                }
            }
        }
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ContainerCloseoutReadiness {
    Attention,
    Closing,
    ReadyToClose,
}

pub fn evaluate_container_closeout(
    required_descendants: &[WorkId],
    accepted_dispositions: &BTreeSet<WorkId>,
    unresolved_holds: bool,
    gates_satisfied: bool,
    summary_present: bool,
) -> ContainerCloseoutReadiness {
    if unresolved_holds
        || !required_descendants
            .iter()
            .all(|id| accepted_dispositions.contains(id))
    {
        return ContainerCloseoutReadiness::Attention;
    }
    if gates_satisfied && summary_present {
        ContainerCloseoutReadiness::ReadyToClose
    } else {
        ContainerCloseoutReadiness::Closing
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ModelError {
    InvalidIdentifier { kind: &'static str, value: String },
    DuplicateIdentifier(String),
    MissingParent(WorkId),
    MissingWork(WorkId),
    MissingCycle(CycleId),
    CrossProjectReference { from: WorkId, to: WorkId },
    MilestoneMustBeContainer(WorkId),
    InvalidParentShape { parent: WorkId, child: WorkId },
    DirectTaskHasChildren(WorkId),
    DecompositionCycle(WorkId),
    DependencyEndpointNotDirect { blocker: WorkId, blocked: WorkId },
    DuplicateDependency { blocker: WorkId, blocked: WorkId },
    DependencyCycle(WorkId),
    InvalidSchedule(&'static str),
    IllegalCycleTransition,
    CycleHasLiveAssignments,
    AssignmentProjectMismatch(String),
    AssignmentRequiresDirectTask(WorkId),
    TerminalCycleHasLiveAssignment(CycleId),
    InvalidActivation(String),
    MultipleLiveAssignments(WorkId),
    AssignmentLineageCycle(String),
    InvalidLocalDate(LocalDate),
    InvalidLocalTime(LocalTime),
    InvalidRecurrence(&'static str),
    SlotOutOfRange(u64),
    RecurrenceOverflow,
    InvalidUtcOffset(i32),
    MissingTimeZoneIdentity,
    InvalidSlotKey,
    IllegalIntakeTransition,
    DeferredWithoutRevisit,
    PromotionSubjectMismatch,
    PromotionSourceChanged,
    ContainerRequired(WorkId),
    InvalidDispositionSubject(CloseoutDispositionId),
    DuplicateCurrentDisposition(WorkId),
    InvalidDispositionShape,
}

impl fmt::Display for ModelError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidIdentifier { kind, value } => {
                write!(f, "invalid {kind} identifier: {value:?}")
            }
            Self::DuplicateIdentifier(id) => write!(f, "duplicate identifier: {id}"),
            Self::MissingParent(id) => write!(f, "missing parent: {id}"),
            Self::MissingWork(id) => write!(f, "missing work: {id}"),
            Self::MissingCycle(id) => write!(f, "missing cycle: {id}"),
            Self::CrossProjectReference { from, to } => {
                write!(f, "cross-project reference: {from} -> {to}")
            }
            Self::MilestoneMustBeContainer(id) => write!(f, "milestone must be a container: {id}"),
            Self::InvalidParentShape { parent, child } => {
                write!(f, "invalid parent shape: {parent} -> {child}")
            }
            Self::DirectTaskHasChildren(id) => write!(f, "direct task has children: {id}"),
            Self::DecompositionCycle(id) => write!(f, "decomposition cycle at {id}"),
            Self::DependencyEndpointNotDirect { blocker, blocked } => write!(
                f,
                "dependency endpoints must be direct tasks: {blocker} -> {blocked}"
            ),
            Self::DuplicateDependency { blocker, blocked } => {
                write!(f, "duplicate dependency: {blocker} -> {blocked}")
            }
            Self::DependencyCycle(id) => write!(f, "dependency cycle at {id}"),
            Self::InvalidSchedule(message) | Self::InvalidRecurrence(message) => {
                f.write_str(message)
            }
            Self::IllegalCycleTransition => f.write_str("illegal cycle transition"),
            Self::CycleHasLiveAssignments => f.write_str("cycle has live assignments"),
            Self::AssignmentProjectMismatch(id) => write!(f, "assignment project mismatch: {id}"),
            Self::AssignmentRequiresDirectTask(id) => {
                write!(f, "assignment requires direct task: {id}")
            }
            Self::TerminalCycleHasLiveAssignment(id) => {
                write!(f, "terminal cycle has live assignment: {id}")
            }
            Self::InvalidActivation(id) => {
                write!(f, "explicit activation is missing a timestamp: {id}")
            }
            Self::MultipleLiveAssignments(id) => write!(f, "multiple live assignments: {id}"),
            Self::AssignmentLineageCycle(id) => write!(f, "assignment lineage cycle: {id}"),
            Self::InvalidLocalDate(date) => write!(f, "invalid local date: {date:?}"),
            Self::InvalidLocalTime(time) => write!(f, "invalid local time: {time:?}"),
            Self::SlotOutOfRange(slot) => write!(f, "recurrence slot out of range: {slot}"),
            Self::RecurrenceOverflow => f.write_str("recurrence overflow"),
            Self::InvalidUtcOffset(offset) => write!(f, "invalid UTC offset: {offset}"),
            Self::MissingTimeZoneIdentity => f.write_str("timezone and tzdb identity are required"),
            Self::InvalidSlotKey => f.write_str("invalid cycle slot key"),
            Self::IllegalIntakeTransition => f.write_str("illegal intake transition"),
            Self::DeferredWithoutRevisit => f.write_str("deferred intake requires revisit_at"),
            Self::PromotionSubjectMismatch => f.write_str("promotion subject mismatch"),
            Self::PromotionSourceChanged => {
                f.write_str("promotion source revision or digest changed")
            }
            Self::ContainerRequired(id) => write!(f, "container required: {id}"),
            Self::InvalidDispositionSubject(id) => write!(f, "invalid disposition subject: {id}"),
            Self::DuplicateCurrentDisposition(id) => {
                write!(f, "duplicate current disposition: {id}")
            }
            Self::InvalidDispositionShape => f.write_str("invalid disposition shape"),
        }
    }
}

impl std::error::Error for ModelError {}

fn is_leap_year(year: i32) -> bool {
    year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
}

fn days_in_month(year: i32, month: u8) -> u8 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if is_leap_year(year) => 29,
        2 => 28,
        _ => 0,
    }
}

// Proleptic Gregorian civil-date conversion, based on integer-only formulas.
fn days_from_civil(year: i32, month: u8, day: u8) -> i64 {
    let y = year as i64 - i64::from(month <= 2);
    let era = (if y >= 0 { y } else { y - 399 }) / 400;
    let yoe = y - era * 400;
    let month = month as i64;
    let day = day as i64;
    let mp = month + if month > 2 { -3 } else { 9 };
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

fn civil_from_days(days: i64) -> (i32, u8, u8) {
    let z = days + 719468;
    let era = (if z >= 0 { z } else { z - 146096 }) / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let mut year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    year += i64::from(month <= 2);
    (year as i32, month as u8, day as u8)
}
