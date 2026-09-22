//! Pure, revision-bound rollups for direct work, containers, and cycles.
//!
//! Adapters select one canonical scope revision and pass the complete set of
//! facts for that revision to this module.  The functions below never infer a
//! total from a page, never turn a container into executable work, and never
//! treat a damaged descendant as accepted.  Store/application code owns the
//! transaction and snapshot boundaries; this module only evaluates facts.

use std::collections::BTreeSet;

use super::decision_inputs::{ContentDigest, EntityIdentity, EntityRevision, ProofRevision};
use super::work_model_v3::{Cycle, CycleAssignment, CycleAssignmentState, CycleId, ExecutionMode};
use super::{DerivedStatus, GateId, PersistedLifecycle, ProjectId, WorkId};

/// The exact subject and revision used to produce one rollup.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum RollupSubject {
    Task(WorkId),
    Container(WorkId),
    Cycle(CycleId),
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct RollupScope {
    pub project_id: ProjectId,
    pub subject: RollupSubject,
    pub revision: EntityRevision,
}

impl RollupScope {
    pub fn task(project_id: ProjectId, work_id: WorkId, revision: EntityRevision) -> Self {
        Self {
            project_id,
            subject: RollupSubject::Task(work_id),
            revision,
        }
    }

    pub fn container(project_id: ProjectId, work_id: WorkId, revision: EntityRevision) -> Self {
        Self {
            project_id,
            subject: RollupSubject::Container(work_id),
            revision,
        }
    }

    pub fn cycle(project_id: ProjectId, cycle_id: CycleId, revision: EntityRevision) -> Self {
        Self {
            project_id,
            subject: RollupSubject::Cycle(cycle_id),
            revision,
        }
    }
}

/// Integrity is intentionally separate from lifecycle and reconciliation.
#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum DescendantIntegrity {
    Valid,
    Degraded { code: String },
    Corrupt { code: String },
}

impl DescendantIntegrity {
    fn quality(&self) -> RollupQuality {
        match self {
            Self::Valid => RollupQuality::Complete,
            Self::Degraded { .. } => RollupQuality::Incomplete,
            Self::Corrupt { .. } => RollupQuality::Corrupt,
        }
    }

    fn is_trustworthy(&self) -> bool {
        matches!(self, Self::Valid)
    }
}

/// A current accepted close outcome.  The identity and digest must match the
/// descendant fact and any accepted-closed scope disposition.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct AcceptedOutcome {
    pub identity: EntityIdentity,
    pub proof_revision: ProofRevision,
    pub digest: ContentDigest,
}

impl AcceptedOutcome {
    pub fn new(
        identity: EntityIdentity,
        proof_revision: ProofRevision,
        digest: ContentDigest,
    ) -> Self {
        Self {
            identity,
            proof_revision,
            digest,
        }
    }
}

/// A scope disposition is not a task outcome.  It reconciles a descendant's
/// membership in a container/cycle while preserving accepted work separately.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum ScopeDisposition {
    AcceptedClosed {
        entity_revision: EntityRevision,
        outcome_digest: ContentDigest,
    },
    AcceptedCancelled {
        entity_revision: EntityRevision,
        outcome_digest: ContentDigest,
    },
    Deferred {
        reason: String,
    },
    Replaced {
        replacement_id: WorkId,
        reason: String,
    },
}

impl ScopeDisposition {
    pub fn accepted_closed(identity: &EntityIdentity, digest: ContentDigest) -> Self {
        Self::AcceptedClosed {
            entity_revision: identity.revision,
            outcome_digest: digest,
        }
    }

    pub fn accepted_cancelled(identity: &EntityIdentity, digest: ContentDigest) -> Self {
        Self::AcceptedCancelled {
            entity_revision: identity.revision,
            outcome_digest: digest,
        }
    }

    pub fn deferred(reason: impl Into<String>) -> Self {
        Self::Deferred {
            reason: reason.into(),
        }
    }

    pub fn replaced(replacement_id: WorkId, reason: impl Into<String>) -> Self {
        Self::Replaced {
            replacement_id,
            reason: reason.into(),
        }
    }
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct RollupBlocker {
    pub work_id: WorkId,
    pub code: String,
}

impl RollupBlocker {
    pub fn new(work_id: WorkId, code: impl Into<String>) -> Self {
        Self {
            work_id,
            code: code.into(),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum RollupQuality {
    Complete,
    Incomplete,
    Corrupt,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum ReconciliationState {
    NotRequired,
    Unresolved,
    AcceptedClosed,
    AcceptedCancelled,
    Deferred,
    Replaced,
}

impl ReconciliationState {
    fn is_reconciled(self) -> bool {
        matches!(
            self,
            Self::AcceptedClosed | Self::AcceptedCancelled | Self::Deferred | Self::Replaced
        )
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum RollupFactDiagnostic {
    ContainerClaimabilityIgnored,
    ContainerExecutionPresent,
    ActiveTerminal,
    LifecycleStatusMismatch,
    AcceptedOutcomeWrongIdentity,
    AcceptedOutcomeNotClosed,
    AcceptedOutcomeMissingDigest,
    AcceptedDispositionWithoutOutcome,
    AcceptedDispositionBindingMismatch,
    CancelledDispositionNotCancelled,
    DispositionBindingMismatch,
    DispositionInvalid,
    DispositionMissing,
    DegradedIntegrity,
    CorruptIntegrity,
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum RollupDiagnostic {
    Task {
        work_id: WorkId,
        code: RollupFactDiagnostic,
    },
    DuplicateDescendant(WorkId),
    ForeignProject(WorkId),
    WrongScopeSubject,
    InvalidCycle,
    AssignmentProjectMismatch(String),
    AssignmentCycleMismatch(String),
    AssignmentWorkMismatch(String),
    CompletedAssignmentNotAcceptedClosed(WorkId),
    CycleHasLiveAssignments,
    IntegrationCloseoutMissing(WorkId),
    IntegrationCloseoutNotDirect(WorkId),
}

/// Facts for one task or descendant.  `requires_reconciliation` is set by a
/// containing scope; a standalone direct-task rollup can omit a disposition.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TaskRollupInput {
    pub identity: EntityIdentity,
    pub execution_mode: ExecutionMode,
    pub lifecycle: PersistedLifecycle,
    pub status: DerivedStatus,
    pub claimable_for_actor: bool,
    pub active_execution: bool,
    pub accepted_outcome: Option<AcceptedOutcome>,
    pub disposition: Option<ScopeDisposition>,
    pub requires_reconciliation: bool,
    pub gate_gaps: Vec<GateId>,
    pub overdue: bool,
    pub blockers: Vec<RollupBlocker>,
    pub integrity: DescendantIntegrity,
}

impl TaskRollupInput {
    pub fn new(
        identity: EntityIdentity,
        execution_mode: ExecutionMode,
        lifecycle: PersistedLifecycle,
        status: DerivedStatus,
    ) -> Self {
        Self {
            identity,
            execution_mode,
            lifecycle,
            status,
            claimable_for_actor: false,
            active_execution: false,
            accepted_outcome: None,
            disposition: None,
            requires_reconciliation: false,
            gate_gaps: Vec::new(),
            overdue: false,
            blockers: Vec::new(),
            integrity: DescendantIntegrity::Valid,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TaskRollup {
    pub identity: EntityIdentity,
    pub execution_mode: ExecutionMode,
    pub lifecycle: PersistedLifecycle,
    pub status: DerivedStatus,
    pub claimable_for_actor: bool,
    pub active_execution: bool,
    pub accepted_closed: bool,
    pub reconciliation: ReconciliationState,
    pub gate_gaps: Vec<GateId>,
    pub overdue: bool,
    pub blockers: Vec<RollupBlocker>,
    pub quality: RollupQuality,
    pub diagnostics: Vec<RollupDiagnostic>,
}

impl TaskRollup {
    pub fn is_reconciled(&self) -> bool {
        self.quality == RollupQuality::Complete && self.reconciliation.is_reconciled()
    }
}

/// Exact, scope-wide counters.  These are counts of the complete fact set
/// passed to the evaluator, not a page size or a fabricated estimate.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct RollupTotals {
    pub total: usize,
    pub accepted_closed: usize,
    pub accepted_cancelled: usize,
    pub reconciled_scope: usize,
    pub deferred: usize,
    pub replaced: usize,
    pub unresolved_scope: usize,
    pub active_work: usize,
    pub gate_review_gaps: usize,
    pub gate_review_gap_tasks: usize,
    pub overdue_work: usize,
    pub blockers: usize,
    pub blocked_work: usize,
    pub incomplete_descendants: usize,
    pub corrupt_descendants: usize,
}

impl RollupTotals {
    fn record(&mut self, task: &TaskRollup) {
        self.total += 1;
        if task.accepted_closed && task.quality != RollupQuality::Corrupt {
            self.accepted_closed += 1;
        }
        if task.quality == RollupQuality::Complete {
            match task.reconciliation {
                ReconciliationState::AcceptedCancelled => self.accepted_cancelled += 1,
                ReconciliationState::Deferred => self.deferred += 1,
                ReconciliationState::Replaced => self.replaced += 1,
                ReconciliationState::AcceptedClosed
                | ReconciliationState::NotRequired
                | ReconciliationState::Unresolved => {}
            }
        }
        if task.is_reconciled() {
            self.reconciled_scope += 1;
        } else if task.reconciliation == ReconciliationState::Unresolved {
            self.unresolved_scope += 1;
        }
        if task.active_execution {
            self.active_work += 1;
        }
        if !task.gate_gaps.is_empty() {
            self.gate_review_gap_tasks += 1;
            self.gate_review_gaps += task.gate_gaps.len();
        }
        if task.overdue {
            self.overdue_work += 1;
        }
        if !task.blockers.is_empty() {
            self.blocked_work += 1;
            self.blockers += task.blockers.len();
        }
        match task.quality {
            RollupQuality::Complete => {}
            RollupQuality::Incomplete => self.incomplete_descendants += 1,
            RollupQuality::Corrupt => self.corrupt_descendants += 1,
        }
    }

    /// `None` means that a complete percentage cannot be trusted, including
    /// when the scope contains a corrupt or incomplete descendant.
    pub fn accepted_percentage(&self) -> Option<u8> {
        if self.total == 0 || self.incomplete_descendants != 0 || self.corrupt_descendants != 0 {
            return None;
        }
        Some(((self.accepted_closed * 100) / self.total) as u8)
    }

    pub fn reconciled_percentage(&self) -> Option<u8> {
        if self.total == 0 || self.incomplete_descendants != 0 || self.corrupt_descendants != 0 {
            return None;
        }
        Some(((self.reconciled_scope * 100) / self.total) as u8)
    }

    pub fn is_fully_accepted(&self) -> bool {
        self.total > 0
            && self.accepted_closed == self.total
            && self.incomplete_descendants == 0
            && self.corrupt_descendants == 0
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntegrationCloseoutSpec {
    pub work_id: WorkId,
    pub required: bool,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum IntegrationCloseoutState {
    Missing,
    Pending,
    Accepted,
    Reconciled,
    Corrupt,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntegrationCloseoutRollup {
    pub work_id: WorkId,
    pub required: bool,
    pub state: IntegrationCloseoutState,
}

impl IntegrationCloseoutRollup {
    fn blocks_closeout(&self) -> bool {
        self.required && self.state != IntegrationCloseoutState::Accepted
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContainerRollupInput {
    pub scope: RollupScope,
    pub lifecycle: PersistedLifecycle,
    pub descendants: Vec<TaskRollupInput>,
    pub gate_gaps: Vec<GateId>,
    pub overdue: bool,
    pub blockers: Vec<RollupBlocker>,
    pub summary_present: bool,
    pub integration_closeout: Option<IntegrationCloseoutSpec>,
}

impl ContainerRollupInput {
    pub fn new(scope: RollupScope, descendants: Vec<TaskRollupInput>) -> Self {
        Self {
            scope,
            lifecycle: PersistedLifecycle::Open,
            descendants,
            gate_gaps: Vec::new(),
            overdue: false,
            blockers: Vec::new(),
            summary_present: false,
            integration_closeout: None,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum ContainerRollupState {
    Planning,
    Closing,
    ReadyToClose,
    Closed,
    Cancelled,
    Attention,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContainerRollup {
    pub scope: RollupScope,
    pub state: ContainerRollupState,
    pub claimable_for_actor: bool,
    pub totals: RollupTotals,
    pub quality: RollupQuality,
    pub gate_review_gaps: Vec<GateId>,
    pub overdue: bool,
    pub blockers: Vec<RollupBlocker>,
    pub diagnostics: Vec<RollupDiagnostic>,
    pub descendants: Vec<TaskRollup>,
    pub integration_closeout: Option<IntegrationCloseoutRollup>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct AssignmentCounts {
    pub planned: usize,
    pub committed: usize,
    pub removed: usize,
    pub completed: usize,
    pub carried_over: usize,
    pub live: usize,
}

impl AssignmentCounts {
    fn record(&mut self, state: CycleAssignmentState) {
        match state {
            CycleAssignmentState::Planned => {
                self.planned += 1;
                self.live += 1;
            }
            CycleAssignmentState::Committed => {
                self.committed += 1;
                self.live += 1;
            }
            CycleAssignmentState::Removed => self.removed += 1,
            CycleAssignmentState::Completed => self.completed += 1,
            CycleAssignmentState::CarriedOver => self.carried_over += 1,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CycleAssignmentRollupInput {
    pub assignment: CycleAssignment,
    pub task: TaskRollupInput,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CycleRollupInput {
    pub scope: RollupScope,
    pub cycle: Cycle,
    pub assignments: Vec<CycleAssignmentRollupInput>,
    pub gate_gaps: Vec<GateId>,
    pub overdue: bool,
    pub blockers: Vec<RollupBlocker>,
    pub integration_closeout: Option<IntegrationCloseoutSpec>,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum CycleRollupState {
    Planned,
    Active,
    ReadyToComplete,
    Completed,
    Cancelled,
    Attention,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CycleRollup {
    pub scope: RollupScope,
    pub state: CycleRollupState,
    pub claimable_for_actor: bool,
    pub totals: RollupTotals,
    pub quality: RollupQuality,
    pub scope_reconciled: bool,
    pub assignment_counts: AssignmentCounts,
    pub gate_review_gaps: Vec<GateId>,
    pub overdue: bool,
    pub blockers: Vec<RollupBlocker>,
    pub diagnostics: Vec<RollupDiagnostic>,
    pub descendants: Vec<TaskRollup>,
    pub integration_closeout: Option<IntegrationCloseoutRollup>,
}

/// Evaluate one task without importing storage, protocol, or process facts.
pub fn evaluate_task_rollup(input: &TaskRollupInput) -> TaskRollup {
    evaluate_task(input, input.requires_reconciliation)
}

/// Evaluate one container's complete descendant scope.  Containers are always
/// non-claimable, even if a malformed input says that an actor may claim one.
pub fn evaluate_container_rollup(input: &ContainerRollupInput) -> ContainerRollup {
    let mut diagnostics = Vec::new();
    if !matches!(input.scope.subject, RollupSubject::Container(_)) {
        diagnostics.push(RollupDiagnostic::WrongScopeSubject);
    }

    let (descendants, mut totals, mut child_diagnostics, mut quality) =
        evaluate_descendants(&input.scope.project_id, &input.descendants, true);
    diagnostics.append(&mut child_diagnostics);

    let mut gate_review_gaps = normalized_gates(&input.gate_gaps);
    let mut blockers = normalized_blockers(&input.blockers);
    for descendant in &descendants {
        gate_review_gaps.extend(descendant.gate_gaps.iter().cloned());
        blockers.extend(descendant.blockers.iter().cloned());
    }
    gate_review_gaps.sort();
    gate_review_gaps.dedup();
    blockers.sort();
    blockers.dedup();
    totals.gate_review_gaps += normalized_gates(&input.gate_gaps).len();
    totals.gate_review_gap_tasks += usize::from(!input.gate_gaps.is_empty());
    totals.blockers += normalized_blockers(&input.blockers).len();
    totals.blocked_work += usize::from(!input.blockers.is_empty());
    totals.overdue_work += usize::from(input.overdue);

    let integration_closeout = evaluate_integration_closeout(
        input.integration_closeout.as_ref(),
        &descendants,
        &mut diagnostics,
    );
    let integration_blocks = integration_closeout
        .as_ref()
        .is_some_and(IntegrationCloseoutRollup::blocks_closeout);
    let structural_attention = diagnostics.iter().any(|diagnostic| {
        matches!(
            diagnostic,
            RollupDiagnostic::DuplicateDescendant(_)
                | RollupDiagnostic::ForeignProject(_)
                | RollupDiagnostic::WrongScopeSubject
                | RollupDiagnostic::IntegrationCloseoutNotDirect(_)
                | RollupDiagnostic::Task {
                    code: RollupFactDiagnostic::ContainerClaimabilityIgnored
                        | RollupFactDiagnostic::ContainerExecutionPresent
                        | RollupFactDiagnostic::ActiveTerminal
                        | RollupFactDiagnostic::LifecycleStatusMismatch
                        | RollupFactDiagnostic::AcceptedOutcomeWrongIdentity
                        | RollupFactDiagnostic::AcceptedOutcomeNotClosed
                        | RollupFactDiagnostic::AcceptedOutcomeMissingDigest
                        | RollupFactDiagnostic::AcceptedDispositionWithoutOutcome
                        | RollupFactDiagnostic::AcceptedDispositionBindingMismatch
                        | RollupFactDiagnostic::CancelledDispositionNotCancelled
                        | RollupFactDiagnostic::DispositionBindingMismatch
                        | RollupFactDiagnostic::DispositionInvalid
                        | RollupFactDiagnostic::CorruptIntegrity,
                    ..
                }
        )
    });
    if structural_attention || quality == RollupQuality::Corrupt {
        quality = RollupQuality::Corrupt;
    }
    let overdue = input.overdue || totals.overdue_work != 0;

    let state = if structural_attention || !blockers.is_empty() {
        ContainerRollupState::Attention
    } else if input.lifecycle == PersistedLifecycle::Draft {
        ContainerRollupState::Planning
    } else if input.lifecycle == PersistedLifecycle::Cancelled {
        ContainerRollupState::Cancelled
    } else if input.lifecycle == PersistedLifecycle::Closed {
        if integration_blocks
            || !input.summary_present
            || !gate_review_gaps.is_empty()
            || totals.unresolved_scope != 0
            || totals.incomplete_descendants != 0
        {
            ContainerRollupState::Attention
        } else {
            ContainerRollupState::Closed
        }
    } else if integration_blocks
        || !input.summary_present
        || !gate_review_gaps.is_empty()
        || totals.unresolved_scope != 0
        || totals.incomplete_descendants != 0
        || totals.active_work != 0
    {
        ContainerRollupState::Closing
    } else {
        ContainerRollupState::ReadyToClose
    };

    diagnostics.sort();
    ContainerRollup {
        scope: input.scope.clone(),
        state,
        claimable_for_actor: false,
        totals,
        quality,
        gate_review_gaps,
        overdue,
        blockers,
        diagnostics,
        descendants,
        integration_closeout,
    }
}

/// Evaluate one cycle's exact assignment snapshot.  Cycle assignment state is
/// counted separately from task acceptance and never becomes a proof outcome.
pub fn evaluate_cycle_rollup(input: &CycleRollupInput) -> CycleRollup {
    let mut diagnostics = Vec::new();
    let mut assignment_counts = AssignmentCounts::default();
    if !matches!(input.scope.subject, RollupSubject::Cycle(_)) {
        diagnostics.push(RollupDiagnostic::WrongScopeSubject);
    }
    if input.cycle.project_id != input.scope.project_id {
        diagnostics.push(RollupDiagnostic::AssignmentProjectMismatch(
            input.cycle.id.to_string(),
        ));
    }
    if !matches!(&input.scope.subject, RollupSubject::Cycle(id) if *id == input.cycle.id) {
        diagnostics.push(RollupDiagnostic::AssignmentCycleMismatch(
            input.cycle.id.to_string(),
        ));
    }
    if input.cycle.validate().is_err() {
        diagnostics.push(RollupDiagnostic::InvalidCycle);
    }

    let mut seen_assignments = BTreeSet::new();
    let mut task_inputs = Vec::with_capacity(input.assignments.len());
    for entry in &input.assignments {
        assignment_counts.record(entry.assignment.state);
        let mut task = entry.task.clone();
        if !seen_assignments.insert(entry.assignment.id.clone()) {
            diagnostics.push(RollupDiagnostic::AssignmentWorkMismatch(
                entry.assignment.id.clone(),
            ));
            task.integrity = DescendantIntegrity::Corrupt {
                code: "duplicate_assignment".into(),
            };
        }
        if entry.assignment.project_id != input.scope.project_id {
            diagnostics.push(RollupDiagnostic::AssignmentProjectMismatch(
                entry.assignment.id.clone(),
            ));
            task.integrity = DescendantIntegrity::Corrupt {
                code: "assignment_foreign_project".into(),
            };
        }
        if entry.assignment.cycle_id != input.cycle.id {
            diagnostics.push(RollupDiagnostic::AssignmentCycleMismatch(
                entry.assignment.id.clone(),
            ));
            task.integrity = DescendantIntegrity::Corrupt {
                code: "assignment_wrong_cycle".into(),
            };
        }
        if entry.assignment.work_id != entry.task.identity.work_id {
            diagnostics.push(RollupDiagnostic::AssignmentWorkMismatch(
                entry.assignment.id.clone(),
            ));
            task.integrity = DescendantIntegrity::Corrupt {
                code: "assignment_wrong_work".into(),
            };
        }
        task_inputs.push((entry.assignment.state, task));
    }

    let (descendants, mut totals, mut child_diagnostics, mut quality) = evaluate_descendants(
        &input.scope.project_id,
        &task_inputs
            .iter()
            .map(|(_, task)| task.clone())
            .collect::<Vec<_>>(),
        true,
    );
    diagnostics.append(&mut child_diagnostics);
    for (assignment_state, task_input) in &task_inputs {
        if *assignment_state == CycleAssignmentState::Completed {
            let accepted_closed = descendants
                .iter()
                .find(|descendant| descendant.identity.work_id == task_input.identity.work_id)
                .is_some_and(|descendant| descendant.accepted_closed);
            if !accepted_closed {
                diagnostics.push(RollupDiagnostic::CompletedAssignmentNotAcceptedClosed(
                    task_input.identity.work_id.clone(),
                ));
                quality = RollupQuality::Corrupt;
            }
        }
    }
    if input.cycle.lifecycle.is_terminal() && assignment_counts.live != 0 {
        diagnostics.push(RollupDiagnostic::CycleHasLiveAssignments);
        quality = RollupQuality::Corrupt;
    }

    let mut gate_review_gaps = normalized_gates(&input.gate_gaps);
    let mut blockers = normalized_blockers(&input.blockers);
    for descendant in &descendants {
        gate_review_gaps.extend(descendant.gate_gaps.iter().cloned());
        blockers.extend(descendant.blockers.iter().cloned());
    }
    gate_review_gaps.sort();
    gate_review_gaps.dedup();
    blockers.sort();
    blockers.dedup();
    totals.gate_review_gaps += normalized_gates(&input.gate_gaps).len();
    totals.gate_review_gap_tasks += usize::from(!input.gate_gaps.is_empty());
    totals.blockers += normalized_blockers(&input.blockers).len();
    totals.blocked_work += usize::from(!input.blockers.is_empty());
    totals.overdue_work += usize::from(input.overdue);

    let integration_closeout = evaluate_integration_closeout(
        input.integration_closeout.as_ref(),
        &descendants,
        &mut diagnostics,
    );
    let integration_blocks = integration_closeout
        .as_ref()
        .is_some_and(IntegrationCloseoutRollup::blocks_closeout);
    let structural_attention = diagnostics.iter().any(|diagnostic| {
        matches!(
            diagnostic,
            RollupDiagnostic::WrongScopeSubject
                | RollupDiagnostic::InvalidCycle
                | RollupDiagnostic::AssignmentProjectMismatch(_)
                | RollupDiagnostic::AssignmentCycleMismatch(_)
                | RollupDiagnostic::AssignmentWorkMismatch(_)
                | RollupDiagnostic::IntegrationCloseoutNotDirect(_)
                | RollupDiagnostic::CompletedAssignmentNotAcceptedClosed(_)
                | RollupDiagnostic::CycleHasLiveAssignments
        )
    });
    if structural_attention {
        quality = RollupQuality::Corrupt;
    }
    let overdue = input.overdue || totals.overdue_work != 0;
    let scope_reconciled = quality == RollupQuality::Complete
        && totals.unresolved_scope == 0
        && totals.incomplete_descendants == 0
        && totals.corrupt_descendants == 0;

    let state = if quality == RollupQuality::Corrupt || !blockers.is_empty() {
        CycleRollupState::Attention
    } else {
        match input.cycle.lifecycle {
            super::work_model_v3::CycleLifecycle::Planned => CycleRollupState::Planned,
            super::work_model_v3::CycleLifecycle::Active => {
                if scope_reconciled
                    && assignment_counts.live == 0
                    && gate_review_gaps.is_empty()
                    && !integration_blocks
                {
                    CycleRollupState::ReadyToComplete
                } else {
                    CycleRollupState::Active
                }
            }
            super::work_model_v3::CycleLifecycle::Completed => CycleRollupState::Completed,
            super::work_model_v3::CycleLifecycle::Cancelled => CycleRollupState::Cancelled,
        }
    };

    diagnostics.sort();
    CycleRollup {
        scope: input.scope.clone(),
        state,
        claimable_for_actor: false,
        totals,
        quality,
        scope_reconciled,
        assignment_counts,
        gate_review_gaps,
        overdue,
        blockers,
        diagnostics,
        descendants,
        integration_closeout,
    }
}

fn evaluate_task(input: &TaskRollupInput, requires_reconciliation: bool) -> TaskRollup {
    let mut diagnostics = Vec::new();
    let mut quality = input.integrity.quality();
    if matches!(input.integrity, DescendantIntegrity::Degraded { .. }) {
        diagnostics.push(RollupDiagnostic::Task {
            work_id: input.identity.work_id.clone(),
            code: RollupFactDiagnostic::DegradedIntegrity,
        });
    }
    if matches!(input.integrity, DescendantIntegrity::Corrupt { .. }) {
        diagnostics.push(RollupDiagnostic::Task {
            work_id: input.identity.work_id.clone(),
            code: RollupFactDiagnostic::CorruptIntegrity,
        });
    }
    if input.execution_mode == ExecutionMode::Container && input.claimable_for_actor {
        diagnostics.push(RollupDiagnostic::Task {
            work_id: input.identity.work_id.clone(),
            code: RollupFactDiagnostic::ContainerClaimabilityIgnored,
        });
        quality = RollupQuality::Corrupt;
    }
    if input.execution_mode == ExecutionMode::Container && input.active_execution {
        diagnostics.push(RollupDiagnostic::Task {
            work_id: input.identity.work_id.clone(),
            code: RollupFactDiagnostic::ContainerExecutionPresent,
        });
        quality = RollupQuality::Corrupt;
    }
    if input.lifecycle.is_terminal() && input.active_execution {
        diagnostics.push(RollupDiagnostic::Task {
            work_id: input.identity.work_id.clone(),
            code: RollupFactDiagnostic::ActiveTerminal,
        });
        quality = RollupQuality::Corrupt;
    }
    if (input.lifecycle == PersistedLifecycle::Closed && input.status != DerivedStatus::Closed)
        || (input.lifecycle == PersistedLifecycle::Cancelled
            && input.status != DerivedStatus::Cancelled)
        || (!input.lifecycle.is_terminal()
            && matches!(
                input.status,
                DerivedStatus::Closed | DerivedStatus::Cancelled
            ))
    {
        diagnostics.push(RollupDiagnostic::Task {
            work_id: input.identity.work_id.clone(),
            code: RollupFactDiagnostic::LifecycleStatusMismatch,
        });
        quality = RollupQuality::Corrupt;
    }

    let mut accepted_closed = false;
    if let Some(outcome) = &input.accepted_outcome {
        if outcome.identity != input.identity {
            diagnostics.push(RollupDiagnostic::Task {
                work_id: input.identity.work_id.clone(),
                code: RollupFactDiagnostic::AcceptedOutcomeWrongIdentity,
            });
            quality = RollupQuality::Corrupt;
        } else if input.lifecycle != PersistedLifecycle::Closed {
            diagnostics.push(RollupDiagnostic::Task {
                work_id: input.identity.work_id.clone(),
                code: RollupFactDiagnostic::AcceptedOutcomeNotClosed,
            });
            quality = RollupQuality::Corrupt;
        } else if outcome.digest.as_str().trim().is_empty() {
            diagnostics.push(RollupDiagnostic::Task {
                work_id: input.identity.work_id.clone(),
                code: RollupFactDiagnostic::AcceptedOutcomeMissingDigest,
            });
            quality = RollupQuality::Corrupt;
        } else if input.integrity.is_trustworthy() {
            accepted_closed = true;
        }
    }

    let mut reconciliation = ReconciliationState::NotRequired;
    match &input.disposition {
        None if requires_reconciliation => {
            reconciliation = ReconciliationState::Unresolved;
            if quality == RollupQuality::Complete {
                quality = RollupQuality::Incomplete;
            }
            diagnostics.push(RollupDiagnostic::Task {
                work_id: input.identity.work_id.clone(),
                code: RollupFactDiagnostic::DispositionMissing,
            });
        }
        None => {}
        Some(ScopeDisposition::AcceptedClosed {
            entity_revision,
            outcome_digest,
        }) => {
            reconciliation = ReconciliationState::AcceptedClosed;
            let matches_outcome = input.accepted_outcome.as_ref().is_some_and(|outcome| {
                outcome.identity.revision == *entity_revision && outcome.digest == *outcome_digest
            });
            if !matches_outcome {
                let code = if input.accepted_outcome.is_none() {
                    RollupFactDiagnostic::AcceptedDispositionWithoutOutcome
                } else {
                    RollupFactDiagnostic::AcceptedDispositionBindingMismatch
                };
                diagnostics.push(RollupDiagnostic::Task {
                    work_id: input.identity.work_id.clone(),
                    code,
                });
                quality = RollupQuality::Corrupt;
            }
        }
        Some(ScopeDisposition::AcceptedCancelled {
            entity_revision,
            outcome_digest,
        }) => {
            reconciliation = ReconciliationState::AcceptedCancelled;
            if input.lifecycle != PersistedLifecycle::Cancelled {
                diagnostics.push(RollupDiagnostic::Task {
                    work_id: input.identity.work_id.clone(),
                    code: RollupFactDiagnostic::CancelledDispositionNotCancelled,
                });
                quality = RollupQuality::Corrupt;
            }
            if *entity_revision != input.identity.revision
                || outcome_digest.as_str().trim().is_empty()
            {
                diagnostics.push(RollupDiagnostic::Task {
                    work_id: input.identity.work_id.clone(),
                    code: RollupFactDiagnostic::DispositionBindingMismatch,
                });
                quality = RollupQuality::Corrupt;
            }
        }
        Some(ScopeDisposition::Deferred { reason }) => {
            reconciliation = ReconciliationState::Deferred;
            if reason.trim().is_empty() {
                diagnostics.push(RollupDiagnostic::Task {
                    work_id: input.identity.work_id.clone(),
                    code: RollupFactDiagnostic::DispositionInvalid,
                });
                quality = RollupQuality::Corrupt;
            }
        }
        Some(ScopeDisposition::Replaced {
            replacement_id,
            reason,
        }) => {
            reconciliation = ReconciliationState::Replaced;
            if replacement_id == &input.identity.work_id || reason.trim().is_empty() {
                diagnostics.push(RollupDiagnostic::Task {
                    work_id: input.identity.work_id.clone(),
                    code: RollupFactDiagnostic::DispositionInvalid,
                });
                quality = RollupQuality::Corrupt;
            }
        }
    }

    let mut gate_gaps = normalized_gates(&input.gate_gaps);
    let mut blockers = normalized_blockers(&input.blockers);
    gate_gaps.sort();
    gate_gaps.dedup();
    blockers.sort();
    blockers.dedup();
    let claimable_for_actor = input.execution_mode == ExecutionMode::Direct
        && input.claimable_for_actor
        && input.lifecycle == PersistedLifecycle::Open
        && input.status == DerivedStatus::Ready
        && !input.active_execution
        && gate_gaps.is_empty()
        && blockers.is_empty()
        && input.accepted_outcome.is_none()
        && input.disposition.is_none()
        && quality == RollupQuality::Complete;
    if quality == RollupQuality::Corrupt {
        accepted_closed = false;
    }
    diagnostics.sort();
    TaskRollup {
        identity: input.identity.clone(),
        execution_mode: input.execution_mode,
        lifecycle: input.lifecycle,
        status: input.status,
        claimable_for_actor,
        active_execution: input.active_execution,
        accepted_closed,
        reconciliation,
        gate_gaps,
        overdue: input.overdue,
        blockers,
        quality,
        diagnostics,
    }
}

fn evaluate_descendants(
    project_id: &ProjectId,
    inputs: &[TaskRollupInput],
    requires_reconciliation: bool,
) -> (
    Vec<TaskRollup>,
    RollupTotals,
    Vec<RollupDiagnostic>,
    RollupQuality,
) {
    let mut seen = BTreeSet::new();
    let mut descendants = Vec::with_capacity(inputs.len());
    let mut diagnostics = Vec::new();
    for input in inputs {
        let mut input = input.clone();
        if input.identity.project_id != *project_id {
            diagnostics.push(RollupDiagnostic::ForeignProject(
                input.identity.work_id.clone(),
            ));
            input.integrity = DescendantIntegrity::Corrupt {
                code: "foreign_project".into(),
            };
        }
        if !seen.insert(input.identity.work_id.clone()) {
            diagnostics.push(RollupDiagnostic::DuplicateDescendant(
                input.identity.work_id.clone(),
            ));
            input.integrity = DescendantIntegrity::Corrupt {
                code: "duplicate_descendant".into(),
            };
        }
        descendants.push(evaluate_task(&input, requires_reconciliation));
    }
    descendants.sort_by(|left, right| left.identity.work_id.cmp(&right.identity.work_id));
    let mut totals = RollupTotals::default();
    for descendant in &descendants {
        totals.record(descendant);
        diagnostics.extend(descendant.diagnostics.iter().cloned());
    }
    let quality = if totals.corrupt_descendants != 0 {
        RollupQuality::Corrupt
    } else if totals.incomplete_descendants != 0 {
        RollupQuality::Incomplete
    } else {
        RollupQuality::Complete
    };
    diagnostics.sort();
    (descendants, totals, diagnostics, quality)
}

fn evaluate_integration_closeout(
    spec: Option<&IntegrationCloseoutSpec>,
    descendants: &[TaskRollup],
    diagnostics: &mut Vec<RollupDiagnostic>,
) -> Option<IntegrationCloseoutRollup> {
    let spec = spec?;
    let matches = descendants
        .iter()
        .filter(|task| task.identity.work_id == spec.work_id)
        .collect::<Vec<_>>();
    let state = match matches.as_slice() {
        [] => {
            if spec.required {
                diagnostics.push(RollupDiagnostic::IntegrationCloseoutMissing(
                    spec.work_id.clone(),
                ));
            }
            IntegrationCloseoutState::Missing
        }
        [task] if task.execution_mode != ExecutionMode::Direct => {
            diagnostics.push(RollupDiagnostic::IntegrationCloseoutNotDirect(
                spec.work_id.clone(),
            ));
            IntegrationCloseoutState::Corrupt
        }
        [task] if task.quality == RollupQuality::Corrupt => IntegrationCloseoutState::Corrupt,
        [task] if task.accepted_closed => IntegrationCloseoutState::Accepted,
        [task] if task.is_reconciled() => IntegrationCloseoutState::Reconciled,
        [_] => IntegrationCloseoutState::Pending,
        _ => IntegrationCloseoutState::Corrupt,
    };
    Some(IntegrationCloseoutRollup {
        work_id: spec.work_id.clone(),
        required: spec.required,
        state,
    })
}

fn normalized_gates(gates: &[GateId]) -> Vec<GateId> {
    let mut normalized = gates.to_vec();
    normalized.sort();
    normalized.dedup();
    normalized
}

fn normalized_blockers(blockers: &[RollupBlocker]) -> Vec<RollupBlocker> {
    let mut normalized = blockers.to_vec();
    normalized.sort();
    normalized.dedup();
    normalized
}
