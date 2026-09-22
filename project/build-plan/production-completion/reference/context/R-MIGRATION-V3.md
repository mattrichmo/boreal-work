# R-MIGRATION-V3 — crates/migration/src/work_model_v3.rs

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `crates/migration/src/work_model_v3.rs:L1–L260`  
**File SHA-256:** `6384242dc7c4d2d98f721110b8869158fd37c0f1efcce7605ebc4741dea40ee5`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Cycle/work-model migration groundwork, raw legacy IDs and compatibility mappings.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,260p' 'crates/migration/src/work_model_v3.rs'
```

## Exact baseline excerpt

````text
    1 | //! Versioned work-model v3 migration format and schema-2 compatibility bridge.
    2 | //!
    3 | //! The bridge deliberately keeps the complete schema-2 document alongside
    4 | //! the v3 projection.  A later store adapter may materialize cycles,
    5 | //! assignments, intake, and schedules, but this library never silently
    6 | //! re-parents a legacy sprint or transfers its attempts/receipts into a new
    7 | //! proof context.
    8 | 
    9 | use std::{
   10 |     collections::{BTreeMap, BTreeSet},
   11 |     fmt,
   12 | };
   13 | 
   14 | use serde::{Deserialize, Serialize};
   15 | 
   16 | use crate::{Lifecycle, LossDisposition, LossLedgerEntry, MigrationDocument, WorkKind};
   17 | 
   18 | pub const WORK_MODEL_FORMAT: &str = "boreal.work-model";
   19 | pub const WORK_MODEL_VERSION: u32 = 3;
   20 | pub const CYCLE_CAPABILITY: &str = "boreal.cycle/1";
   21 | pub const RECURRENCE_CAPABILITY: &str = "boreal.recurrence/1";
   22 | pub const INTAKE_CAPABILITY: &str = "boreal.intake/1";
   23 | 
   24 | #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
   25 | pub struct WorkModelV3Document {
   26 |     pub format: String,
   27 |     pub version: u32,
   28 |     pub project: V3Project,
   29 |     #[serde(default)]
   30 |     pub work: Vec<V3WorkRecord>,
   31 |     #[serde(default)]
   32 |     pub dependencies: Vec<DependencyRecord>,
   33 |     #[serde(default)]
   34 |     pub schedules: Vec<WorkScheduleRecord>,
   35 |     #[serde(default)]
   36 |     pub cycles: Vec<CycleRecord>,
   37 |     #[serde(default)]
   38 |     pub cycle_series: Vec<CycleSeriesRecord>,
   39 |     #[serde(default)]
   40 |     pub cycle_templates: Vec<CycleTemplateRecord>,
   41 |     #[serde(default)]
   42 |     pub assignments: Vec<CycleAssignmentRecord>,
   43 |     #[serde(default)]
   44 |     pub intake_buckets: Vec<IntakeBucketRecord>,
   45 |     #[serde(default)]
   46 |     pub intake: Vec<IntakeItemRecord>,
   47 |     #[serde(default)]
   48 |     pub promotions: Vec<PromotionRecord>,
   49 |     #[serde(default)]
   50 |     pub dispositions: Vec<ContainerDispositionRecord>,
   51 |     #[serde(default)]
   52 |     pub compatibility: Option<Schema2Compatibility>,
   53 | }
   54 | 
   55 | impl WorkModelV3Document {
   56 |     pub fn new(project: V3Project) -> Self {
   57 |         Self {
   58 |             format: WORK_MODEL_FORMAT.to_owned(),
   59 |             version: WORK_MODEL_VERSION,
   60 |             project,
   61 |             work: Vec::new(),
   62 |             dependencies: Vec::new(),
   63 |             schedules: Vec::new(),
   64 |             cycles: Vec::new(),
   65 |             cycle_series: Vec::new(),
   66 |             cycle_templates: Vec::new(),
   67 |             assignments: Vec::new(),
   68 |             intake_buckets: Vec::new(),
   69 |             intake: Vec::new(),
   70 |             promotions: Vec::new(),
   71 |             dispositions: Vec::new(),
   72 |             compatibility: None,
   73 |         }
   74 |     }
   75 | 
   76 |     pub fn validate(&self) -> Result<(), V3ValidationError> {
   77 |         if self.format != WORK_MODEL_FORMAT || self.version != WORK_MODEL_VERSION {
   78 |             return Err(V3ValidationError::InvalidHeader);
   79 |         }
   80 |         if self.project.id.is_empty() {
   81 |             return Err(V3ValidationError::EmptyIdentifier("project.id"));
   82 |         }
   83 |         let compatibility_enabled = self.compatibility.is_some();
   84 |         if let Some(compatibility) = &self.compatibility {
   85 |             compatibility
   86 |                 .source
   87 |                 .validate()
   88 |                 .map_err(|error| V3ValidationError::CompatibilitySource(error.to_string()))?;
   89 |         }
   90 | 
   91 |         let mut work = BTreeMap::<&str, &V3WorkRecord>::new();
   92 |         for row in &self.work {
   93 |             if row.id.is_empty() {
   94 |                 return Err(V3ValidationError::EmptyIdentifier("work.id"));
   95 |             }
   96 |             if row.project_id != self.project.id {
   97 |                 return Err(V3ValidationError::WrongProject("work", row.id.clone()));
   98 |             }
   99 |             if work.insert(row.id.as_str(), row).is_some() {
  100 |                 return Err(V3ValidationError::Duplicate("work", row.id.clone()));
  101 |             }
  102 |             match (row.kind, row.execution_mode) {
  103 |                 (V3WorkKind::Milestone, ExecutionMode::Container)
  104 |                 | (V3WorkKind::Task, ExecutionMode::Direct | ExecutionMode::Container) => {}
  105 |                 (V3WorkKind::CompatibilitySprint, ExecutionMode::Compatibility)
  106 |                     if compatibility_enabled => {}
  107 |                 (V3WorkKind::Milestone, _) => {
  108 |                     return Err(V3ValidationError::MilestoneNotContainer(row.id.clone()))
  109 |                 }
  110 |                 (V3WorkKind::CompatibilitySprint, _) => {
  111 |                     return Err(V3ValidationError::CompatibilitySprintRequiresBridge(
  112 |                         row.id.clone(),
  113 |                     ))
  114 |                 }
  115 |                 (V3WorkKind::Task, ExecutionMode::Compatibility) => {
  116 |                     return Err(V3ValidationError::InvalidWorkMode(row.id.clone()))
  117 |                 }
  118 |             }
  119 |         }
  120 |         let mut parent_of = BTreeMap::new();
  121 |         for row in &self.work {
  122 |             let Some(parent_id) = &row.parent_id else {
  123 |                 continue;
  124 |             };
  125 |             let Some(parent) = work.get(parent_id.as_str()) else {
  126 |                 return Err(V3ValidationError::MissingReference(
  127 |                     "work.parent_id",
  128 |                     parent_id.clone(),
  129 |                 ));
  130 |             };
  131 |             if row.project_id != parent.project_id {
  132 |                 return Err(V3ValidationError::WrongProject(
  133 |                     "work.parent_id",
  134 |                     row.id.clone(),
  135 |                 ));
  136 |             }
  137 |             let valid = match (parent.kind, parent.execution_mode, row.kind) {
  138 |                 (
  139 |                     V3WorkKind::Milestone,
  140 |                     ExecutionMode::Container,
  141 |                     V3WorkKind::Milestone | V3WorkKind::Task,
  142 |                 ) => true,
  143 |                 (
  144 |                     V3WorkKind::Milestone,
  145 |                     ExecutionMode::Container,
  146 |                     V3WorkKind::CompatibilitySprint,
  147 |                 ) if compatibility_enabled => true,
  148 |                 (V3WorkKind::Task, ExecutionMode::Container, V3WorkKind::Task) => true,
  149 |                 (
  150 |                     V3WorkKind::CompatibilitySprint,
  151 |                     ExecutionMode::Compatibility,
  152 |                     V3WorkKind::Task,
  153 |                 ) if compatibility_enabled => true,
  154 |                 _ => false,
  155 |             };
  156 |             if !valid {
  157 |                 return Err(V3ValidationError::InvalidParent {
  158 |                     parent: parent.id.clone(),
  159 |                     child: row.id.clone(),
  160 |                 });
  161 |             }
  162 |             parent_of.insert(row.id.as_str(), parent_id.as_str());
  163 |         }
  164 |         for row in &self.work {
  165 |             let mut seen = BTreeSet::new();
  166 |             let mut current = Some(row.id.as_str());
  167 |             while let Some(id) = current {
  168 |                 if !seen.insert(id) {
  169 |                     return Err(V3ValidationError::ParentCycle(id.to_owned()));
  170 |                 }
  171 |                 current = parent_of.get(id).copied();
  172 |             }
  173 |         }
  174 |         let mut direct_ids = BTreeSet::new();
  175 |         let mut children = BTreeSet::new();
  176 |         for row in &self.work {
  177 |             if row.execution_mode == ExecutionMode::Direct {
  178 |                 direct_ids.insert(row.id.as_str());
  179 |             }
  180 |             if let Some(parent) = &row.parent_id {
  181 |                 children.insert(parent.as_str());
  182 |             }
  183 |         }
  184 |         for id in children {
  185 |             if direct_ids.contains(id) {
  186 |                 return Err(V3ValidationError::DirectHasChildren(id.to_owned()));
  187 |             }
  188 |         }
  189 |         let mut dependency_edges = BTreeSet::new();
  190 |         for dependency in &self.dependencies {
  191 |             let Some(blocker) = work.get(dependency.blocker_id.as_str()) else {
  192 |                 return Err(V3ValidationError::MissingReference(
  193 |                     "dependency.blocker_id",
  194 |                     dependency.blocker_id.clone(),
  195 |                 ));
  196 |             };
  197 |             let Some(blocked) = work.get(dependency.blocked_id.as_str()) else {
  198 |                 return Err(V3ValidationError::MissingReference(
  199 |                     "dependency.blocked_id",
  200 |                     dependency.blocked_id.clone(),
  201 |                 ));
  202 |             };
  203 |             if blocker.execution_mode != ExecutionMode::Direct
  204 |                 || blocked.execution_mode != ExecutionMode::Direct
  205 |             {
  206 |                 return Err(V3ValidationError::DependencyRequiresDirect {
  207 |                     blocker: dependency.blocker_id.clone(),
  208 |                     blocked: dependency.blocked_id.clone(),
  209 |                 });
  210 |             }
  211 |             if !dependency_edges.insert((
  212 |                 dependency.blocker_id.as_str(),
  213 |                 dependency.blocked_id.as_str(),
  214 |             )) {
  215 |                 return Err(V3ValidationError::Duplicate(
  216 |                     "dependency",
  217 |                     format!("{} -> {}", dependency.blocker_id, dependency.blocked_id),
  218 |                 ));
  219 |             }
  220 |         }
  221 |         for (blocker, blocked) in &dependency_edges {
  222 |             if *blocker == *blocked || reaches(&dependency_edges, blocked, blocker) {
  223 |                 return Err(V3ValidationError::DependencyCycle((*blocker).to_owned()));
  224 |             }
  225 |         }
  226 | 
  227 |         let mut schedule_ids = BTreeSet::new();
  228 |         for schedule in &self.schedules {
  229 |             if !work.contains_key(schedule.work_id.as_str()) {
  230 |                 return Err(V3ValidationError::MissingReference(
  231 |                     "schedule.work_id",
  232 |                     schedule.work_id.clone(),
  233 |                 ));
  234 |             }
  235 |             if !schedule_ids.insert(schedule.work_id.as_str()) {
  236 |                 return Err(V3ValidationError::Duplicate(
  237 |                     "schedule",
  238 |                     schedule.work_id.clone(),
  239 |                 ));
  240 |             }
  241 |             if let (Some(start), Some(end)) =
  242 |                 (schedule.target_start_at_ms, schedule.target_end_at_ms)
  243 |             {
  244 |                 if end <= start {
  245 |                     return Err(V3ValidationError::InvalidTime(
  246 |                         "schedule target end must be after start",
  247 |                     ));
  248 |                 }
  249 |             }
  250 |         }
  251 | 
  252 |         let mut cycle_ids = BTreeSet::new();
  253 |         for cycle in &self.cycles {
  254 |             if cycle.id.is_empty() {
  255 |                 return Err(V3ValidationError::EmptyIdentifier("cycle.id"));
  256 |             }
  257 |             if cycle.project_id != self.project.id {
  258 |                 return Err(V3ValidationError::WrongProject("cycle", cycle.id.clone()));
  259 |             }
  260 |             if !cycle_ids.insert(cycle.id.as_str()) {
````
