# R-DOMAIN-V3 — crates/domain/src/work_model_v3.rs

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `crates/domain/src/work_model_v3.rs:L1–L300`  
**File SHA-256:** `89f8c34ad3ad965badad82867683f32e88ae9a9ee34cfdcedf4c93c06ab8b7fc`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Additive work-model types and validators; distinguish available contracts from wired application capabilities.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,300p' 'crates/domain/src/work_model_v3.rs'
```

## Exact baseline excerpt

````text
    1 | //! Pure, additive work-model v3 contracts.
    2 | //!
    3 | //! This module intentionally does not alter the schema-2 `WorkItem` or claim
    4 | //! evaluator.  It provides the value objects and invariants that a later
    5 | //! application/store adapter can adopt behind `boreal.work-model/3`:
    6 | //! decomposition is separate from cycles, recurring cycles are materialized
    7 | //! occurrences, intake is not work, and calendar planning is not execution
    8 | //! timing.
    9 | 
   10 | use std::{
   11 |     collections::{BTreeMap, BTreeSet},
   12 |     fmt,
   13 | };
   14 | 
   15 | use super::{ProjectId, TimestampMs, WorkId};
   16 | 
   17 | macro_rules! model_id {
   18 |     ($name:ident) => {
   19 |         #[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
   20 |         pub struct $name(String);
   21 | 
   22 |         impl $name {
   23 |             pub fn new(value: impl Into<String>) -> Self {
   24 |                 Self(value.into())
   25 |             }
   26 | 
   27 |             pub fn parse(value: impl Into<String>) -> Result<Self, ModelError> {
   28 |                 let value = value.into();
   29 |                 if value.is_empty()
   30 |                     || value.len() > 255
   31 |                     || value.chars().any(|c| c.is_control() || c.is_whitespace())
   32 |                 {
   33 |                     return Err(ModelError::InvalidIdentifier {
   34 |                         kind: stringify!($name),
   35 |                         value,
   36 |                     });
   37 |                 }
   38 |                 Ok(Self(value))
   39 |             }
   40 | 
   41 |             pub fn as_str(&self) -> &str {
   42 |                 &self.0
   43 |             }
   44 |         }
   45 | 
   46 |         impl From<&str> for $name {
   47 |             fn from(value: &str) -> Self {
   48 |                 Self::new(value)
   49 |             }
   50 |         }
   51 | 
   52 |         impl From<String> for $name {
   53 |             fn from(value: String) -> Self {
   54 |                 Self::new(value)
   55 |             }
   56 |         }
   57 | 
   58 |         impl fmt::Display for $name {
   59 |             fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
   60 |                 f.write_str(&self.0)
   61 |             }
   62 |         }
   63 |     };
   64 | }
   65 | 
   66 | model_id!(CycleId);
   67 | model_id!(CycleSeriesId);
   68 | model_id!(CycleTemplateVersionId);
   69 | model_id!(IntakeBucketId);
   70 | model_id!(IntakeItemId);
   71 | model_id!(PromotionId);
   72 | model_id!(CloseoutDispositionId);
   73 | 
   74 | /// Work decomposition is deliberately smaller than the schema-2 kind enum.
   75 | /// A sprint/cycle is not a work parent in this model.
   76 | #[derive(Clone, Copy, Debug, Eq, PartialEq)]
   77 | pub enum DecompositionKind {
   78 |     Milestone,
   79 |     Task,
   80 | }
   81 | 
   82 | #[derive(Clone, Copy, Debug, Eq, PartialEq)]
   83 | pub enum ExecutionMode {
   84 |     Direct,
   85 |     Container,
   86 | }
   87 | 
   88 | #[derive(Clone, Debug, Eq, PartialEq)]
   89 | pub struct WorkNode {
   90 |     pub id: WorkId,
   91 |     pub project_id: ProjectId,
   92 |     pub kind: DecompositionKind,
   93 |     pub execution_mode: ExecutionMode,
   94 |     pub parent_id: Option<WorkId>,
   95 |     pub title: String,
   96 | }
   97 | 
   98 | impl WorkNode {
   99 |     pub fn milestone(project_id: ProjectId, id: WorkId, title: impl Into<String>) -> Self {
  100 |         Self {
  101 |             id,
  102 |             project_id,
  103 |             kind: DecompositionKind::Milestone,
  104 |             execution_mode: ExecutionMode::Container,
  105 |             parent_id: None,
  106 |             title: title.into(),
  107 |         }
  108 |     }
  109 | 
  110 |     pub fn task(
  111 |         project_id: ProjectId,
  112 |         id: WorkId,
  113 |         execution_mode: ExecutionMode,
  114 |         parent_id: Option<WorkId>,
  115 |         title: impl Into<String>,
  116 |     ) -> Self {
  117 |         Self {
  118 |             id,
  119 |             project_id,
  120 |             kind: DecompositionKind::Task,
  121 |             execution_mode,
  122 |             parent_id,
  123 |             title: title.into(),
  124 |         }
  125 |     }
  126 | 
  127 |     pub fn is_direct(&self) -> bool {
  128 |         self.execution_mode == ExecutionMode::Direct
  129 |     }
  130 | 
  131 |     pub fn is_container(&self) -> bool {
  132 |         self.execution_mode == ExecutionMode::Container
  133 |     }
  134 | }
  135 | 
  136 | /// Validate the entire decomposition forest.  This is intentionally stricter
  137 | /// than schema 2: milestones can contain milestones/tasks, container tasks can
  138 | /// contain tasks, and direct tasks cannot have children.
  139 | pub fn validate_decomposition(nodes: &[WorkNode]) -> Result<(), ModelError> {
  140 |     let mut by_id = BTreeMap::new();
  141 |     for node in nodes {
  142 |         if by_id.insert(node.id.clone(), node).is_some() {
  143 |             return Err(ModelError::DuplicateIdentifier(node.id.to_string()));
  144 |         }
  145 |         if node.kind == DecompositionKind::Milestone
  146 |             && node.execution_mode != ExecutionMode::Container
  147 |         {
  148 |             return Err(ModelError::MilestoneMustBeContainer(node.id.clone()));
  149 |         }
  150 |     }
  151 | 
  152 |     let mut children = BTreeMap::<WorkId, Vec<WorkId>>::new();
  153 |     for node in nodes {
  154 |         let Some(parent_id) = &node.parent_id else {
  155 |             continue;
  156 |         };
  157 |         let Some(parent) = by_id.get(parent_id) else {
  158 |             return Err(ModelError::MissingParent(node.id.clone()));
  159 |         };
  160 |         if node.project_id != parent.project_id {
  161 |             return Err(ModelError::CrossProjectReference {
  162 |                 from: node.id.clone(),
  163 |                 to: parent.id.clone(),
  164 |             });
  165 |         }
  166 |         let allowed = matches!(
  167 |             (parent.kind, parent.execution_mode, node.kind),
  168 |             (
  169 |                 DecompositionKind::Milestone,
  170 |                 ExecutionMode::Container,
  171 |                 DecompositionKind::Milestone,
  172 |             ) | (
  173 |                 DecompositionKind::Milestone,
  174 |                 ExecutionMode::Container,
  175 |                 DecompositionKind::Task,
  176 |             ) | (
  177 |                 DecompositionKind::Task,
  178 |                 ExecutionMode::Container,
  179 |                 DecompositionKind::Task,
  180 |             )
  181 |         );
  182 |         if !allowed {
  183 |             return Err(ModelError::InvalidParentShape {
  184 |                 parent: parent.id.clone(),
  185 |                 child: node.id.clone(),
  186 |             });
  187 |         }
  188 |         children
  189 |             .entry(parent.id.clone())
  190 |             .or_default()
  191 |             .push(node.id.clone());
  192 |     }
  193 | 
  194 |     for node in nodes {
  195 |         if node.is_direct() && children.contains_key(&node.id) {
  196 |             return Err(ModelError::DirectTaskHasChildren(node.id.clone()));
  197 |         }
  198 |     }
  199 | 
  200 |     // Parent links are a forest, not merely a set of non-self edges.
  201 |     for node in nodes {
  202 |         let mut seen = BTreeSet::new();
  203 |         let mut current = Some(node.id.clone());
  204 |         while let Some(id) = current {
  205 |             if !seen.insert(id.clone()) {
  206 |                 return Err(ModelError::DecompositionCycle(id));
  207 |             }
  208 |             current = by_id.get(&id).and_then(|item| item.parent_id.clone());
  209 |         }
  210 |     }
  211 |     Ok(())
  212 | }
  213 | 
  214 | #[derive(Clone, Debug, Eq, PartialEq)]
  215 | pub struct DirectDependency {
  216 |     pub blocker_id: WorkId,
  217 |     pub blocked_id: WorkId,
  218 | }
  219 | 
  220 | pub fn validate_direct_dependencies(
  221 |     nodes: &[WorkNode],
  222 |     dependencies: &[DirectDependency],
  223 | ) -> Result<(), ModelError> {
  224 |     validate_decomposition(nodes)?;
  225 |     let by_id = nodes
  226 |         .iter()
  227 |         .map(|n| (n.id.clone(), n))
  228 |         .collect::<BTreeMap<_, _>>();
  229 |     let mut edges = BTreeSet::new();
  230 |     for edge in dependencies {
  231 |         let Some(blocker) = by_id.get(&edge.blocker_id) else {
  232 |             return Err(ModelError::MissingWork(edge.blocker_id.clone()));
  233 |         };
  234 |         let Some(blocked) = by_id.get(&edge.blocked_id) else {
  235 |             return Err(ModelError::MissingWork(edge.blocked_id.clone()));
  236 |         };
  237 |         if blocker.project_id != blocked.project_id {
  238 |             return Err(ModelError::CrossProjectReference {
  239 |                 from: blocker.id.clone(),
  240 |                 to: blocked.id.clone(),
  241 |             });
  242 |         }
  243 |         if !blocker.is_direct() || !blocked.is_direct() {
  244 |             return Err(ModelError::DependencyEndpointNotDirect {
  245 |                 blocker: blocker.id.clone(),
  246 |                 blocked: blocked.id.clone(),
  247 |             });
  248 |         }
  249 |         if !edges.insert((edge.blocker_id.clone(), edge.blocked_id.clone())) {
  250 |             return Err(ModelError::DuplicateDependency {
  251 |                 blocker: edge.blocker_id.clone(),
  252 |                 blocked: edge.blocked_id.clone(),
  253 |             });
  254 |         }
  255 |         if edge.blocker_id == edge.blocked_id || reaches(&edges, &edge.blocked_id, &edge.blocker_id)
  256 |         {
  257 |             return Err(ModelError::DependencyCycle(edge.blocker_id.clone()));
  258 |         }
  259 |     }
  260 |     Ok(())
  261 | }
  262 | 
  263 | fn reaches(edges: &BTreeSet<(WorkId, WorkId)>, from: &WorkId, target: &WorkId) -> bool {
  264 |     if from == target {
  265 |         return true;
  266 |     }
  267 |     let mut stack = vec![from.clone()];
  268 |     let mut visited = BTreeSet::new();
  269 |     while let Some(current) = stack.pop() {
  270 |         if !visited.insert(current.clone()) {
  271 |             continue;
  272 |         }
  273 |         for (_source, destination) in edges.iter().filter(|(source, _)| source == &current) {
  274 |             if destination == target {
  275 |                 return true;
  276 |             }
  277 |             stack.push(destination.clone());
  278 |         }
  279 |     }
  280 |     false
  281 | }
  282 | 
  283 | /// Calendar planning fields.  These are not attempt lease or hard-budget
  284 | /// fields; the executor owns those in the existing attempt model.
  285 | #[derive(Clone, Copy, Debug, Eq, PartialEq)]
  286 | pub struct WorkSchedule {
  287 |     pub not_before_at: Option<TimestampMs>,
  288 |     pub due_at: Option<TimestampMs>,
  289 |     pub target_start_at: Option<TimestampMs>,
  290 |     pub target_end_at: Option<TimestampMs>,
  291 | }
  292 | 
  293 | impl WorkSchedule {
  294 |     pub const fn empty() -> Self {
  295 |         Self {
  296 |             not_before_at: None,
  297 |             due_at: None,
  298 |             target_start_at: None,
  299 |             target_end_at: None,
  300 |         }
````
