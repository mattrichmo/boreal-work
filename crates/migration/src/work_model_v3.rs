//! Versioned work-model v3 migration format and schema-2 compatibility bridge.
//!
//! The bridge deliberately keeps the complete schema-2 document alongside
//! the v3 projection.  A later store adapter may materialize cycles,
//! assignments, intake, and schedules, but this library never silently
//! re-parents a legacy sprint or transfers its attempts/receipts into a new
//! proof context.

use std::{
    collections::{BTreeMap, BTreeSet},
    fmt,
};

use serde::{Deserialize, Serialize};

use crate::{Lifecycle, LossDisposition, LossLedgerEntry, MigrationDocument, WorkKind};

pub const WORK_MODEL_FORMAT: &str = "boreal.work-model";
pub const WORK_MODEL_VERSION: u32 = 3;
pub const CYCLE_CAPABILITY: &str = "boreal.cycle/1";
pub const RECURRENCE_CAPABILITY: &str = "boreal.recurrence/1";
pub const INTAKE_CAPABILITY: &str = "boreal.intake/1";

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct WorkModelV3Document {
    pub format: String,
    pub version: u32,
    pub project: V3Project,
    #[serde(default)]
    pub work: Vec<V3WorkRecord>,
    #[serde(default)]
    pub dependencies: Vec<DependencyRecord>,
    #[serde(default)]
    pub schedules: Vec<WorkScheduleRecord>,
    #[serde(default)]
    pub cycles: Vec<CycleRecord>,
    #[serde(default)]
    pub cycle_series: Vec<CycleSeriesRecord>,
    #[serde(default)]
    pub cycle_templates: Vec<CycleTemplateRecord>,
    #[serde(default)]
    pub assignments: Vec<CycleAssignmentRecord>,
    #[serde(default)]
    pub intake_buckets: Vec<IntakeBucketRecord>,
    #[serde(default)]
    pub intake: Vec<IntakeItemRecord>,
    #[serde(default)]
    pub promotions: Vec<PromotionRecord>,
    #[serde(default)]
    pub dispositions: Vec<ContainerDispositionRecord>,
    #[serde(default)]
    pub compatibility: Option<Schema2Compatibility>,
}

impl WorkModelV3Document {
    pub fn new(project: V3Project) -> Self {
        Self {
            format: WORK_MODEL_FORMAT.to_owned(),
            version: WORK_MODEL_VERSION,
            project,
            work: Vec::new(),
            dependencies: Vec::new(),
            schedules: Vec::new(),
            cycles: Vec::new(),
            cycle_series: Vec::new(),
            cycle_templates: Vec::new(),
            assignments: Vec::new(),
            intake_buckets: Vec::new(),
            intake: Vec::new(),
            promotions: Vec::new(),
            dispositions: Vec::new(),
            compatibility: None,
        }
    }

    pub fn validate(&self) -> Result<(), V3ValidationError> {
        if self.format != WORK_MODEL_FORMAT || self.version != WORK_MODEL_VERSION {
            return Err(V3ValidationError::InvalidHeader);
        }
        if self.project.id.is_empty() {
            return Err(V3ValidationError::EmptyIdentifier("project.id"));
        }
        let compatibility_enabled = self.compatibility.is_some();
        if let Some(compatibility) = &self.compatibility {
            compatibility
                .source
                .validate()
                .map_err(|error| V3ValidationError::CompatibilitySource(error.to_string()))?;
        }

        let mut work = BTreeMap::<&str, &V3WorkRecord>::new();
        for row in &self.work {
            if row.id.is_empty() {
                return Err(V3ValidationError::EmptyIdentifier("work.id"));
            }
            if row.project_id != self.project.id {
                return Err(V3ValidationError::WrongProject("work", row.id.clone()));
            }
            if work.insert(row.id.as_str(), row).is_some() {
                return Err(V3ValidationError::Duplicate("work", row.id.clone()));
            }
            match (row.kind, row.execution_mode) {
                (V3WorkKind::Milestone, ExecutionMode::Container)
                | (V3WorkKind::Task, ExecutionMode::Direct | ExecutionMode::Container) => {}
                (V3WorkKind::CompatibilitySprint, ExecutionMode::Compatibility)
                    if compatibility_enabled => {}
                (V3WorkKind::Milestone, _) => {
                    return Err(V3ValidationError::MilestoneNotContainer(row.id.clone()))
                }
                (V3WorkKind::CompatibilitySprint, _) => {
                    return Err(V3ValidationError::CompatibilitySprintRequiresBridge(
                        row.id.clone(),
                    ))
                }
                (V3WorkKind::Task, ExecutionMode::Compatibility) => {
                    return Err(V3ValidationError::InvalidWorkMode(row.id.clone()))
                }
            }
        }
        let mut parent_of = BTreeMap::new();
        for row in &self.work {
            let Some(parent_id) = &row.parent_id else {
                continue;
            };
            let Some(parent) = work.get(parent_id.as_str()) else {
                return Err(V3ValidationError::MissingReference(
                    "work.parent_id",
                    parent_id.clone(),
                ));
            };
            if row.project_id != parent.project_id {
                return Err(V3ValidationError::WrongProject(
                    "work.parent_id",
                    row.id.clone(),
                ));
            }
            let valid = match (parent.kind, parent.execution_mode, row.kind) {
                (
                    V3WorkKind::Milestone,
                    ExecutionMode::Container,
                    V3WorkKind::Milestone | V3WorkKind::Task,
                ) => true,
                (
                    V3WorkKind::Milestone,
                    ExecutionMode::Container,
                    V3WorkKind::CompatibilitySprint,
                ) if compatibility_enabled => true,
                (V3WorkKind::Task, ExecutionMode::Container, V3WorkKind::Task) => true,
                (
                    V3WorkKind::CompatibilitySprint,
                    ExecutionMode::Compatibility,
                    V3WorkKind::Task,
                ) if compatibility_enabled => true,
                _ => false,
            };
            if !valid {
                return Err(V3ValidationError::InvalidParent {
                    parent: parent.id.clone(),
                    child: row.id.clone(),
                });
            }
            parent_of.insert(row.id.as_str(), parent_id.as_str());
        }
        for row in &self.work {
            let mut seen = BTreeSet::new();
            let mut current = Some(row.id.as_str());
            while let Some(id) = current {
                if !seen.insert(id) {
                    return Err(V3ValidationError::ParentCycle(id.to_owned()));
                }
                current = parent_of.get(id).copied();
            }
        }
        let mut direct_ids = BTreeSet::new();
        let mut children = BTreeSet::new();
        for row in &self.work {
            if row.execution_mode == ExecutionMode::Direct {
                direct_ids.insert(row.id.as_str());
            }
            if let Some(parent) = &row.parent_id {
                children.insert(parent.as_str());
            }
        }
        for id in children {
            if direct_ids.contains(id) {
                return Err(V3ValidationError::DirectHasChildren(id.to_owned()));
            }
        }
        let mut dependency_edges = BTreeSet::new();
        for dependency in &self.dependencies {
            let Some(blocker) = work.get(dependency.blocker_id.as_str()) else {
                return Err(V3ValidationError::MissingReference(
                    "dependency.blocker_id",
                    dependency.blocker_id.clone(),
                ));
            };
            let Some(blocked) = work.get(dependency.blocked_id.as_str()) else {
                return Err(V3ValidationError::MissingReference(
                    "dependency.blocked_id",
                    dependency.blocked_id.clone(),
                ));
            };
            if blocker.execution_mode != ExecutionMode::Direct
                || blocked.execution_mode != ExecutionMode::Direct
            {
                return Err(V3ValidationError::DependencyRequiresDirect {
                    blocker: dependency.blocker_id.clone(),
                    blocked: dependency.blocked_id.clone(),
                });
            }
            if !dependency_edges.insert((
                dependency.blocker_id.as_str(),
                dependency.blocked_id.as_str(),
            )) {
                return Err(V3ValidationError::Duplicate(
                    "dependency",
                    format!("{} -> {}", dependency.blocker_id, dependency.blocked_id),
                ));
            }
        }
        for (blocker, blocked) in &dependency_edges {
            if *blocker == *blocked || reaches(&dependency_edges, blocked, blocker) {
                return Err(V3ValidationError::DependencyCycle((*blocker).to_owned()));
            }
        }

        let mut schedule_ids = BTreeSet::new();
        for schedule in &self.schedules {
            if !work.contains_key(schedule.work_id.as_str()) {
                return Err(V3ValidationError::MissingReference(
                    "schedule.work_id",
                    schedule.work_id.clone(),
                ));
            }
            if !schedule_ids.insert(schedule.work_id.as_str()) {
                return Err(V3ValidationError::Duplicate(
                    "schedule",
                    schedule.work_id.clone(),
                ));
            }
            if let (Some(start), Some(end)) =
                (schedule.target_start_at_ms, schedule.target_end_at_ms)
            {
                if end <= start {
                    return Err(V3ValidationError::InvalidTime(
                        "schedule target end must be after start",
                    ));
                }
            }
        }

        let mut cycle_ids = BTreeSet::new();
        for cycle in &self.cycles {
            if cycle.id.is_empty() {
                return Err(V3ValidationError::EmptyIdentifier("cycle.id"));
            }
            if cycle.project_id != self.project.id {
                return Err(V3ValidationError::WrongProject("cycle", cycle.id.clone()));
            }
            if !cycle_ids.insert(cycle.id.as_str()) {
                return Err(V3ValidationError::Duplicate("cycle", cycle.id.clone()));
            }
            if let (Some(start), Some(end)) =
                (cycle.scheduled_start_at_ms, cycle.scheduled_end_at_ms)
            {
                if end <= start {
                    return Err(V3ValidationError::InvalidTime(
                        "cycle end must be after start",
                    ));
                }
            }
            if let Some(series_id) = &cycle.series_id {
                if !self
                    .cycle_series
                    .iter()
                    .any(|series| &series.id == series_id)
                {
                    return Err(V3ValidationError::MissingReference(
                        "cycle.series_id",
                        series_id.clone(),
                    ));
                }
            }
            if let Some(template_id) = &cycle.template_version_id {
                if !self
                    .cycle_templates
                    .iter()
                    .any(|template| &template.id == template_id)
                {
                    return Err(V3ValidationError::MissingReference(
                        "cycle.template_version_id",
                        template_id.clone(),
                    ));
                }
            }
            if cycle.slot_ordinal.is_some() != cycle.slot_key.is_some() {
                return Err(V3ValidationError::InvalidSlotIdentity(cycle.id.clone()));
            }
            if let (Some(series_id), Some(ordinal), Some(slot_key)) =
                (&cycle.series_id, cycle.slot_ordinal, &cycle.slot_key)
            {
                if slot_key != &format!("boreal.cycle-slot/1/{series_id}/{ordinal}") {
                    return Err(V3ValidationError::InvalidSlotIdentity(cycle.id.clone()));
                }
            }
        }
        let mut series_ids = BTreeSet::new();
        for series in &self.cycle_series {
            if series.id.is_empty() {
                return Err(V3ValidationError::EmptyIdentifier("cycle_series.id"));
            }
            if series.project_id != self.project.id {
                return Err(V3ValidationError::WrongProject(
                    "cycle_series",
                    series.id.clone(),
                ));
            }
            if !series_ids.insert(series.id.as_str()) {
                return Err(V3ValidationError::Duplicate(
                    "cycle_series",
                    series.id.clone(),
                ));
            }
        }
        let mut template_keys = BTreeSet::new();
        for template in &self.cycle_templates {
            if !series_ids.contains(template.series_id.as_str()) {
                return Err(V3ValidationError::MissingReference(
                    "cycle_template.series_id",
                    template.series_id.clone(),
                ));
            }
            if template.version == 0
                || template.timezone.trim().is_empty()
                || template.weekdays.is_empty()
                || template.interval_weeks == 0
            {
                return Err(V3ValidationError::InvalidRecurrence(template.id.clone()));
            }
            if !template_keys.insert((template.series_id.as_str(), template.version)) {
                return Err(V3ValidationError::Duplicate(
                    "cycle_template",
                    template.id.clone(),
                ));
            }
        }
        let mut template_boundaries = BTreeMap::<&str, Vec<&CycleTemplateRecord>>::new();
        for template in &self.cycle_templates {
            template_boundaries
                .entry(template.series_id.as_str())
                .or_default()
                .push(template);
        }
        for templates in template_boundaries.values_mut() {
            templates.sort_by_key(|template| template.effective_from_slot_ordinal);
            for pair in templates.windows(2) {
                if pair[0].effective_from_slot_ordinal >= pair[1].effective_from_slot_ordinal {
                    return Err(V3ValidationError::TemplateBoundaryOrder(pair[1].id.clone()));
                }
            }
        }

        let mut assignment_ids = BTreeSet::new();
        let mut live_work = BTreeSet::new();
        for assignment in &self.assignments {
            if !assignment_ids.insert(assignment.id.as_str()) {
                return Err(V3ValidationError::Duplicate(
                    "assignment",
                    assignment.id.clone(),
                ));
            }
            if !cycle_ids.contains(assignment.cycle_id.as_str()) {
                return Err(V3ValidationError::MissingReference(
                    "assignment.cycle_id",
                    assignment.cycle_id.clone(),
                ));
            }
            let Some(node) = work.get(assignment.work_id.as_str()) else {
                return Err(V3ValidationError::MissingReference(
                    "assignment.work_id",
                    assignment.work_id.clone(),
                ));
            };
            if node.execution_mode != ExecutionMode::Direct {
                return Err(V3ValidationError::AssignmentRequiresDirect(
                    assignment.work_id.clone(),
                ));
            }
            if assignment.state.is_live() && !live_work.insert(assignment.work_id.as_str()) {
                return Err(V3ValidationError::MultipleLiveAssignments(
                    assignment.work_id.clone(),
                ));
            }
            if assignment.activation_policy == ActivationPolicy::ExplicitNotBefore
                && assignment.activation_at_ms.is_none()
            {
                return Err(V3ValidationError::InvalidActivation(assignment.id.clone()));
            }
        }

        let mut bucket_ids = BTreeSet::new();
        for bucket in &self.intake_buckets {
            if bucket.project_id != self.project.id {
                return Err(V3ValidationError::WrongProject(
                    "intake_bucket",
                    bucket.id.clone(),
                ));
            }
            if !bucket_ids.insert(bucket.id.as_str()) {
                return Err(V3ValidationError::Duplicate(
                    "intake_bucket",
                    bucket.id.clone(),
                ));
            }
        }
        let mut intake_ids = BTreeSet::new();
        for item in &self.intake {
            if item.project_id != self.project.id {
                return Err(V3ValidationError::WrongProject("intake", item.id.clone()));
            }
            if !bucket_ids.contains(item.bucket_id.as_str()) {
                return Err(V3ValidationError::MissingReference(
                    "intake.bucket_id",
                    item.bucket_id.clone(),
                ));
            }
            if !intake_ids.insert(item.id.as_str()) {
                return Err(V3ValidationError::Duplicate("intake", item.id.clone()));
            }
            if item.lifecycle == IntakeLifecycle::Deferred && item.revisit_at_ms.is_none() {
                return Err(V3ValidationError::DeferredWithoutRevisit(item.id.clone()));
            }
        }
        for promotion in &self.promotions {
            let Some(item) = self
                .intake
                .iter()
                .find(|item| item.id == promotion.intake_id)
            else {
                return Err(V3ValidationError::MissingReference(
                    "promotion.intake_id",
                    promotion.intake_id.clone(),
                ));
            };
            if promotion.project_id != self.project.id || item.project_id != promotion.project_id {
                return Err(V3ValidationError::WrongProject(
                    "promotion",
                    promotion.id.clone(),
                ));
            }
            if item.content_revision != promotion.intake_revision
                || item.content_digest != promotion.intake_digest
            {
                return Err(V3ValidationError::PromotionSourceChanged(
                    promotion.id.clone(),
                ));
            }
            if promotion.target_id.trim().is_empty() {
                return Err(V3ValidationError::EmptyIdentifier("promotion.target_id"));
            }
        }
        for disposition in &self.dispositions {
            let Some(container) = work.get(disposition.container_id.as_str()) else {
                return Err(V3ValidationError::MissingReference(
                    "disposition.container_id",
                    disposition.container_id.clone(),
                ));
            };
            let Some(descendant) = work.get(disposition.descendant_id.as_str()) else {
                return Err(V3ValidationError::MissingReference(
                    "disposition.descendant_id",
                    disposition.descendant_id.clone(),
                ));
            };
            if container.execution_mode != ExecutionMode::Container
                || container.project_id != self.project.id
                || descendant.project_id != self.project.id
            {
                return Err(V3ValidationError::InvalidDisposition(
                    disposition.id.clone(),
                ));
            }
            if disposition.container_id == disposition.descendant_id
                || !is_descendant(
                    &parent_of,
                    &disposition.container_id,
                    &disposition.descendant_id,
                )
            {
                return Err(V3ValidationError::InvalidDisposition(
                    disposition.id.clone(),
                ));
            }
            match disposition.kind {
                DispositionKind::AcceptedClosed | DispositionKind::AcceptedCancelled => {
                    if disposition.replacement_id.is_some() {
                        return Err(V3ValidationError::InvalidDisposition(
                            disposition.id.clone(),
                        ));
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
                        return Err(V3ValidationError::InvalidDisposition(
                            disposition.id.clone(),
                        ));
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
                        return Err(V3ValidationError::InvalidDisposition(
                            disposition.id.clone(),
                        ));
                    }
                }
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct V3Project {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub lifecycle: ProjectLifecycle,
    pub timezone: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProjectLifecycle {
    Active,
    Archived,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum V3WorkKind {
    Milestone,
    Task,
    CompatibilitySprint,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionMode {
    Direct,
    Container,
    Compatibility,
}

fn default_lifecycle() -> Lifecycle {
    Lifecycle::Draft
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct V3WorkRecord {
    pub id: String,
    pub project_id: String,
    pub kind: V3WorkKind,
    pub execution_mode: ExecutionMode,
    #[serde(default)]
    pub parent_id: Option<String>,
    pub title: String,
    #[serde(default = "default_lifecycle")]
    pub lifecycle: Lifecycle,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct WorkScheduleRecord {
    pub work_id: String,
    #[serde(default)]
    pub not_before_at_ms: Option<u64>,
    #[serde(default)]
    pub due_at_ms: Option<u64>,
    #[serde(default)]
    pub target_start_at_ms: Option<u64>,
    #[serde(default)]
    pub target_end_at_ms: Option<u64>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct DependencyRecord {
    pub blocker_id: String,
    pub blocked_id: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CycleLifecycle {
    Planned,
    Active,
    Completed,
    Cancelled,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct CycleRecord {
    pub id: String,
    pub project_id: String,
    pub name: String,
    #[serde(default)]
    pub goal: String,
    pub lifecycle: CycleLifecycle,
    #[serde(default)]
    pub series_id: Option<String>,
    #[serde(default)]
    pub template_version_id: Option<String>,
    #[serde(default)]
    pub slot_ordinal: Option<u64>,
    #[serde(default)]
    pub slot_key: Option<String>,
    #[serde(default)]
    pub scheduled_start_at_ms: Option<u64>,
    #[serde(default)]
    pub scheduled_end_at_ms: Option<u64>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct CycleSeriesRecord {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub lifecycle: SeriesLifecycle,
    pub revision: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SeriesLifecycle {
    Active,
    Paused,
    Retired,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct CycleTemplateRecord {
    pub id: String,
    pub series_id: String,
    pub version: u32,
    pub effective_from_slot_ordinal: u64,
    pub timezone: String,
    pub anchor_local_start: String,
    pub interval_weeks: u32,
    pub weekdays: BTreeSet<u8>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
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

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActivationPolicy {
    AtCycleStart,
    Immediate,
    ExplicitNotBefore,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct CycleAssignmentRecord {
    pub id: String,
    pub cycle_id: String,
    pub work_id: String,
    pub state: CycleAssignmentState,
    pub activation_policy: ActivationPolicy,
    #[serde(default)]
    pub activation_at_ms: Option<u64>,
    #[serde(default)]
    pub predecessor_id: Option<String>,
    #[serde(default)]
    pub successor_id: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct IntakeBucketRecord {
    pub id: String,
    pub project_id: String,
    pub name: String,
    #[serde(default)]
    pub archived: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IntakeKind {
    Note,
    Discovery,
    Question,
    Revisit,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IntakeLifecycle {
    Captured,
    Triaged,
    Deferred,
    Resolved,
    Archived,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct IntakeItemRecord {
    pub id: String,
    pub bucket_id: String,
    pub project_id: String,
    pub kind: IntakeKind,
    pub lifecycle: IntakeLifecycle,
    pub content: String,
    pub content_revision: u64,
    pub content_digest: String,
    #[serde(default)]
    pub revisit_at_ms: Option<u64>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PromotionTargetKind {
    DraftWork,
    SourceVersion,
    MemoryDraft,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct PromotionRecord {
    pub id: String,
    pub project_id: String,
    pub intake_id: String,
    pub intake_revision: u64,
    pub intake_digest: String,
    pub target_kind: PromotionTargetKind,
    pub target_id: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DispositionKind {
    AcceptedClosed,
    AcceptedCancelled,
    Deferred,
    Replaced,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ContainerDispositionRecord {
    pub id: String,
    pub project_id: String,
    pub container_id: String,
    pub descendant_id: String,
    pub kind: DispositionKind,
    pub descendant_revision: u64,
    pub descendant_outcome_digest: String,
    #[serde(default)]
    pub replacement_id: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub supersedes_id: Option<String>,
}

/// Full source preservation is intentional.  A future adapter can perform a
/// reviewed conversion without losing records that v3 cannot yet represent.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct Schema2Compatibility {
    pub source: MigrationDocument,
    pub retained_sprint_work_ids: Vec<String>,
    pub proof_subject_work_ids: Vec<String>,
    pub notes: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Schema2UpgradePlan {
    pub document: WorkModelV3Document,
    pub review_required: bool,
    pub reasons: Vec<String>,
}

impl Schema2UpgradePlan {
    pub fn is_lossless(&self) -> bool {
        self.document.compatibility.is_some()
    }
    pub fn materialize(&self) -> Result<WorkModelV3Document, V3ValidationError> {
        self.document.validate()?;
        Ok(self.document.clone())
    }

    /// Return the explicit schema-2 compatibility loss/review ledger. The
    /// complete source document remains embedded in `compatibility`; these
    /// entries identify only semantics that must not be silently promoted into
    /// live v3 execution state.
    pub fn loss_ledger(&self) -> Vec<LossLedgerEntry> {
        let compatibility = self.document.compatibility.as_ref();
        let mut ledger = compatibility
            .into_iter()
            .flat_map(|compatibility| {
                let sprint_entries = compatibility
                    .retained_sprint_work_ids
                    .iter()
                    .map(|id| LossLedgerEntry {
                        record_type: "work".to_owned(),
                        record_id: Some(id.clone()),
                        disposition: LossDisposition::HistoricalOnly,
                        reason: "legacy sprint remains a compatibility subject until reviewed cycle conversion".to_owned(),
                        raw: serde_json::json!({"work_id": id, "kind": "sprint"}),
                    });
                let proof_entries = compatibility
                    .proof_subject_work_ids
                    .iter()
                    .map(|id| LossLedgerEntry {
                        record_type: "proof".to_owned(),
                        record_id: Some(id.clone()),
                        disposition: LossDisposition::HistoricalOnly,
                        reason: "historical proof is preserved but not rebound to a v3 attempt".to_owned(),
                        raw: serde_json::json!({"work_id": id}),
                    });
                sprint_entries.chain(proof_entries)
            })
            .collect::<Vec<_>>();
        ledger.sort_by(|left, right| {
            (
                left.record_type.as_str(),
                left.record_id.as_deref().unwrap_or(""),
            )
                .cmp(&(
                    right.record_type.as_str(),
                    right.record_id.as_deref().unwrap_or(""),
                ))
        });
        ledger.dedup_by(|left, right| {
            left.record_type == right.record_type && left.record_id == right.record_id
        });
        ledger
    }
}

/// Build a non-writing schema-2 -> schema-3 plan.  Legacy sprint work stays
/// a compatibility subject; no cycle, assignment, attempt, receipt, or
/// summary is fabricated from it.
pub fn plan_schema2_upgrade(
    source: &MigrationDocument,
) -> Result<Schema2UpgradePlan, V3UpgradeError> {
    source
        .validate()
        .map_err(|error| V3UpgradeError::InvalidSource(error.to_string()))?;
    let mut document = WorkModelV3Document::new(V3Project {
        id: source.project.id.clone(),
        name: source.project.name.clone(),
        description: source.project.description.clone(),
        lifecycle: ProjectLifecycle::Active,
        timezone: "UTC".to_owned(),
    });
    let mut retained_sprints = Vec::new();
    for work in &source.work {
        let (kind, execution_mode) = match work.kind {
            WorkKind::Milestone => (V3WorkKind::Milestone, ExecutionMode::Container),
            WorkKind::Task => (V3WorkKind::Task, ExecutionMode::Direct),
            WorkKind::Sprint => {
                retained_sprints.push(work.id.clone());
                (
                    V3WorkKind::CompatibilitySprint,
                    ExecutionMode::Compatibility,
                )
            }
        };
        document.work.push(V3WorkRecord {
            id: work.id.clone(),
            project_id: work.project_id.clone(),
            kind,
            execution_mode,
            parent_id: work.parent_id.clone(),
            title: work.title.clone(),
            lifecycle: work.lifecycle,
        });
    }
    let proof_subject_work_ids = source
        .attempts
        .iter()
        .map(|attempt| attempt.work_id.clone())
        .chain(
            source
                .evidence
                .iter()
                .map(|evidence| evidence.work_id.clone()),
        )
        .chain(
            source
                .summaries
                .iter()
                .map(|summary| summary.work_id.clone()),
        )
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let mut reasons = Vec::new();
    if !retained_sprints.is_empty() {
        reasons.push("legacy sprint subjects require reviewed cycle conversion".to_owned());
    }
    if !proof_subject_work_ids.is_empty() {
        reasons.push("historical proof remains on schema-2 subjects and is not rebound".to_owned());
    }
    let review_required = !reasons.is_empty();
    document.compatibility = Some(Schema2Compatibility {
        source: source.clone(),
        retained_sprint_work_ids: retained_sprints,
        proof_subject_work_ids,
        notes: vec!["This is a dry-run projection; no store writes are implied.".to_owned()],
    });
    document
        .validate()
        .map_err(V3UpgradeError::InvalidProjection)?;
    Ok(Schema2UpgradePlan {
        document,
        review_required,
        reasons,
    })
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum V3ValidationError {
    InvalidHeader,
    EmptyIdentifier(&'static str),
    WrongProject(&'static str, String),
    Duplicate(&'static str, String),
    MissingReference(&'static str, String),
    ParentCycle(String),
    InvalidParent { parent: String, child: String },
    DirectHasChildren(String),
    MilestoneNotContainer(String),
    CompatibilitySprintRequiresBridge(String),
    InvalidWorkMode(String),
    InvalidTime(&'static str),
    InvalidSlotIdentity(String),
    InvalidRecurrence(String),
    DependencyRequiresDirect { blocker: String, blocked: String },
    DependencyCycle(String),
    TemplateBoundaryOrder(String),
    AssignmentRequiresDirect(String),
    MultipleLiveAssignments(String),
    InvalidActivation(String),
    DeferredWithoutRevisit(String),
    PromotionSourceChanged(String),
    CompatibilitySource(String),
    InvalidDisposition(String),
}

impl fmt::Display for V3ValidationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidHeader => f.write_str("invalid work-model v3 header"),
            Self::EmptyIdentifier(field) => write!(f, "empty identifier: {field}"),
            Self::WrongProject(record, id) => {
                write!(f, "{record} belongs to another project: {id}")
            }
            Self::Duplicate(record, id) => write!(f, "duplicate {record}: {id}"),
            Self::MissingReference(record, id) => write!(f, "missing {record}: {id}"),
            Self::ParentCycle(id) => write!(f, "parent cycle at: {id}"),
            Self::InvalidParent { parent, child } => {
                write!(f, "invalid parent {parent} -> {child}")
            }
            Self::DirectHasChildren(id) => write!(f, "direct work has children: {id}"),
            Self::MilestoneNotContainer(id) => write!(f, "milestone is not a container: {id}"),
            Self::CompatibilitySprintRequiresBridge(id) => {
                write!(f, "compatibility sprint requires schema-2 bridge: {id}")
            }
            Self::InvalidWorkMode(id) => write!(f, "invalid work execution mode: {id}"),
            Self::InvalidTime(message) => f.write_str(message),
            Self::InvalidSlotIdentity(id) => write!(f, "incomplete cycle slot identity: {id}"),
            Self::InvalidRecurrence(id) => write!(f, "invalid recurrence template: {id}"),
            Self::DependencyRequiresDirect { blocker, blocked } => write!(
                f,
                "dependency requires direct tasks: {blocker} -> {blocked}"
            ),
            Self::DependencyCycle(id) => write!(f, "dependency cycle at: {id}"),
            Self::TemplateBoundaryOrder(id) => {
                write!(f, "recurrence template boundary is not increasing: {id}")
            }
            Self::AssignmentRequiresDirect(id) => {
                write!(f, "assignment requires direct task: {id}")
            }
            Self::MultipleLiveAssignments(id) => write!(f, "multiple live assignments: {id}"),
            Self::InvalidActivation(id) => write!(f, "explicit activation is missing: {id}"),
            Self::DeferredWithoutRevisit(id) => {
                write!(f, "deferred intake lacks revisit time: {id}")
            }
            Self::PromotionSourceChanged(id) => write!(f, "promotion source changed: {id}"),
            Self::CompatibilitySource(message) => {
                write!(f, "invalid schema-2 compatibility source: {message}")
            }
            Self::InvalidDisposition(id) => write!(f, "invalid container disposition: {id}"),
        }
    }
}

impl std::error::Error for V3ValidationError {}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum V3UpgradeError {
    InvalidSource(String),
    InvalidProjection(V3ValidationError),
}

impl fmt::Display for V3UpgradeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidSource(message) => write!(f, "invalid schema-2 source: {message}"),
            Self::InvalidProjection(error) => write!(f, "invalid v3 projection: {error}"),
        }
    }
}

impl std::error::Error for V3UpgradeError {}

fn reaches(edges: &BTreeSet<(&str, &str)>, from: &str, target: &str) -> bool {
    if from == target {
        return true;
    }
    let mut stack = vec![from];
    let mut visited = BTreeSet::new();
    while let Some(current) = stack.pop() {
        if !visited.insert(current) {
            continue;
        }
        for (_source, destination) in edges
            .iter()
            .copied()
            .filter(|(source, _)| *source == current)
        {
            if destination == target {
                return true;
            }
            stack.push(destination);
        }
    }
    false
}

fn is_descendant(parent_of: &BTreeMap<&str, &str>, ancestor: &str, candidate: &str) -> bool {
    let mut current = parent_of.get(candidate).copied();
    while let Some(id) = current {
        if id == ancestor {
            return true;
        }
        current = parent_of.get(id).copied();
    }
    false
}
