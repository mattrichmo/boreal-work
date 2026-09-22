# R-APP-PLANNING — crates/application/src/planning_v3.rs

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `crates/application/src/planning_v3.rs:L1–L300`  
**File SHA-256:** `c59b776166a39ae9d83f951e054f2419a9b359a2074c36206835d1a0c354ce4e`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Additive planning adapters and missing full public lifecycle; preserve identity rather than duplicate sprint/cycle authority.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,300p' 'crates/application/src/planning_v3.rs'
```

## Exact baseline excerpt

````text
    1 | //! Application-side contracts for the additive `boreal.work-model/3` slice.
    2 | //!
    3 | //! This module is deliberately a policy boundary, not a second persistence
    4 | //! layer.  It validates a command against one canonical snapshot and returns
    5 | //! a typed planned result containing the operation identity and request
    6 | //! digest.  The store adapter must apply that plan in a short transaction,
    7 | //! re-read the same rows, and re-run the validators before committing.
    8 | 
    9 | use std::{collections::BTreeSet, fmt, fs, path::PathBuf};
   10 | 
   11 | use boreal_domain::work_model_v3::{
   12 |     validate_cycle_assignments, validate_decomposition, validate_direct_dependencies, Cycle,
   13 |     CycleAssignment, CycleId, CycleInstance, CycleSeries, CycleTemplate, DirectDependency,
   14 |     ExecutionMode, FoldPolicy, GapPolicy, LocalDateTime, ModelError, TimeResolution,
   15 | };
   16 | use boreal_domain::{DispatchPolicy, ProjectId, ReasonCode, TimestampMs, WorkId, WorkItem};
   17 | use serde_json::json;
   18 | 
   19 | use crate::canonical_request_digest;
   20 | 
   21 | /// Scope carried by every v3 planning mutation.  `expected_revision` is
   22 | /// mandatory for persisted adapters; the optional form is useful for read-only
   23 | /// planning and is rejected by [`PlanningScope::require_revision`].
   24 | #[derive(Clone, Debug, Eq, PartialEq)]
   25 | pub struct PlanningScope {
   26 |     pub project_id: ProjectId,
   27 |     pub actor_id: String,
   28 |     pub session_id: Option<String>,
   29 |     pub expected_revision: Option<u64>,
   30 | }
   31 | 
   32 | impl PlanningScope {
   33 |     pub fn new(project_id: ProjectId, actor_id: impl Into<String>) -> Self {
   34 |         Self {
   35 |             project_id,
   36 |             actor_id: actor_id.into(),
   37 |             session_id: None,
   38 |             expected_revision: None,
   39 |         }
   40 |     }
   41 | 
   42 |     pub fn with_session(mut self, session_id: impl Into<String>) -> Self {
   43 |         self.session_id = Some(session_id.into());
   44 |         self
   45 |     }
   46 | 
   47 |     pub fn at_revision(mut self, revision: u64) -> Self {
   48 |         self.expected_revision = Some(revision);
   49 |         self
   50 |     }
   51 | 
   52 |     pub fn validate(&self) -> Result<(), PlanningError> {
   53 |         if self.project_id.as_str().trim().is_empty() {
   54 |             return Err(PlanningError::Invalid("project_id is required".to_owned()));
   55 |         }
   56 |         if self.actor_id.trim().is_empty() {
   57 |             return Err(PlanningError::Invalid("actor_id is required".to_owned()));
   58 |         }
   59 |         if self
   60 |             .session_id
   61 |             .as_deref()
   62 |             .is_some_and(|id| id.trim().is_empty())
   63 |         {
   64 |             return Err(PlanningError::Invalid(
   65 |                 "session_id cannot be empty".to_owned(),
   66 |             ));
   67 |         }
   68 |         Ok(())
   69 |     }
   70 | 
   71 |     pub fn require_revision(&self, actual: u64) -> Result<(), PlanningError> {
   72 |         match self.expected_revision {
   73 |             Some(expected) if expected == actual => Ok(()),
   74 |             Some(expected) => Err(PlanningError::RevisionConflict { expected, actual }),
   75 |             None => Err(PlanningError::Invalid(
   76 |                 "v3 mutations require expected_revision".to_owned(),
   77 |             )),
   78 |         }
   79 |     }
   80 | }
   81 | 
   82 | /// A mutation prepared by application policy and ready for a store adapter.
   83 | /// The adapter must preserve this operation ID/digest on replay.
   84 | #[derive(Clone, Debug, Eq, PartialEq)]
   85 | pub struct PlannedOperation<T> {
   86 |     pub operation_id: String,
   87 |     pub request_digest: String,
   88 |     pub project_id: ProjectId,
   89 |     pub actor_id: String,
   90 |     pub session_id: Option<String>,
   91 |     pub expected_revision: u64,
   92 |     pub value: T,
   93 | }
   94 | 
   95 | impl<T> PlannedOperation<T> {
   96 |     pub fn map<U>(self, f: impl FnOnce(T) -> U) -> PlannedOperation<U> {
   97 |         PlannedOperation {
   98 |             operation_id: self.operation_id,
   99 |             request_digest: self.request_digest,
  100 |             project_id: self.project_id,
  101 |             actor_id: self.actor_id,
  102 |             session_id: self.session_id,
  103 |             expected_revision: self.expected_revision,
  104 |             value: f(self.value),
  105 |         }
  106 |     }
  107 | }
  108 | 
  109 | #[derive(Clone, Debug, Eq, PartialEq)]
  110 | pub enum PlanningError {
  111 |     Domain(ModelError),
  112 |     Invalid(String),
  113 |     RevisionConflict {
  114 |         expected: u64,
  115 |         actual: u64,
  116 |     },
  117 |     ScopeConflict {
  118 |         expected: String,
  119 |         actual: String,
  120 |     },
  121 |     TimeZoneUnavailable {
  122 |         timezone: String,
  123 |         searched: Vec<PathBuf>,
  124 |     },
  125 |     TimeZoneParse(String),
  126 |     StoreSeam(&'static str),
  127 | }
  128 | 
  129 | impl fmt::Display for PlanningError {
  130 |     fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
  131 |         match self {
  132 |             Self::Domain(error) => error.fmt(f),
  133 |             Self::Invalid(message) => f.write_str(message),
  134 |             Self::RevisionConflict { expected, actual } => {
  135 |                 write!(f, "stale v3 revision: expected {expected}, actual {actual}")
  136 |             }
  137 |             Self::ScopeConflict { expected, actual } => {
  138 |                 write!(f, "v3 scope conflict: expected {expected}, actual {actual}")
  139 |             }
  140 |             Self::TimeZoneUnavailable { timezone, searched } => write!(
  141 |                 f,
  142 |                 "timezone {timezone:?} is unavailable in the system tz database (searched {})",
  143 |                 searched
  144 |                     .iter()
  145 |                     .map(|path| path.display().to_string())
  146 |                     .collect::<Vec<_>>()
  147 |                     .join(", ")
  148 |             ),
  149 |             Self::TimeZoneParse(message) => write!(f, "timezone database parse failed: {message}"),
  150 |             Self::StoreSeam(operation) => {
  151 |                 write!(f, "store v3 mutation seam is not exposed: {operation}")
  152 |             }
  153 |         }
  154 |     }
  155 | }
  156 | 
  157 | impl std::error::Error for PlanningError {}
  158 | 
  159 | impl From<ModelError> for PlanningError {
  160 |     fn from(error: ModelError) -> Self {
  161 |         Self::Domain(error)
  162 |     }
  163 | }
  164 | 
  165 | /// The canonical v3 hierarchy read snapshot consumed by planning commands.
  166 | /// It is a materialized read model, not a writable cache.
  167 | #[derive(Clone, Debug, Eq, PartialEq)]
  168 | pub struct HierarchySnapshot {
  169 |     pub project_id: ProjectId,
  170 |     pub revision: u64,
  171 |     pub nodes: Vec<boreal_domain::work_model_v3::WorkNode>,
  172 |     pub dependencies: Vec<DirectDependency>,
  173 |     pub cycles: Vec<Cycle>,
  174 |     pub assignments: Vec<CycleAssignment>,
  175 | }
  176 | 
  177 | impl HierarchySnapshot {
  178 |     pub fn validate(&self) -> Result<(), PlanningError> {
  179 |         validate_decomposition(&self.nodes)?;
  180 |         validate_direct_dependencies(&self.nodes, &self.dependencies)?;
  181 |         validate_cycle_assignments(&self.cycles, &self.nodes, &self.assignments)?;
  182 |         Ok(())
  183 |     }
  184 | 
  185 |     pub fn node(
  186 |         &self,
  187 |         work_id: &WorkId,
  188 |     ) -> Result<&boreal_domain::work_model_v3::WorkNode, PlanningError> {
  189 |         self.nodes
  190 |             .iter()
  191 |             .find(|node| &node.id == work_id)
  192 |             .ok_or_else(|| PlanningError::Invalid(format!("work node not found: {work_id}")))
  193 |     }
  194 | 
  195 |     pub fn cycle(&self, cycle_id: &CycleId) -> Result<&Cycle, PlanningError> {
  196 |         self.cycles
  197 |             .iter()
  198 |             .find(|cycle| &cycle.id == cycle_id)
  199 |             .ok_or_else(|| PlanningError::Invalid(format!("cycle not found: {cycle_id}")))
  200 |     }
  201 | 
  202 |     fn scope(&self, scope: &PlanningScope) -> Result<(), PlanningError> {
  203 |         scope.validate()?;
  204 |         if scope.project_id != self.project_id {
  205 |             return Err(PlanningError::ScopeConflict {
  206 |                 expected: self.project_id.to_string(),
  207 |                 actual: scope.project_id.to_string(),
  208 |             });
  209 |         }
  210 |         scope.require_revision(self.revision)
  211 |     }
  212 | }
  213 | 
  214 | #[derive(Clone, Debug, Eq, PartialEq)]
  215 | pub struct WorkEditRequest {
  216 |     pub scope: PlanningScope,
  217 |     pub operation_id: String,
  218 |     pub work_id: WorkId,
  219 |     /// `None` leaves the parent unchanged; `Some(None)` moves to the root.
  220 |     pub parent_id: Option<Option<WorkId>>,
  221 |     pub title: Option<String>,
  222 |     pub execution_mode: Option<ExecutionMode>,
  223 | }
  224 | 
  225 | pub fn plan_work_edit(
  226 |     snapshot: &HierarchySnapshot,
  227 |     request: &WorkEditRequest,
  228 | ) -> Result<PlannedOperation<boreal_domain::work_model_v3::WorkNode>, PlanningError> {
  229 |     snapshot.scope(&request.scope)?;
  230 |     let mut updated = snapshot.node(&request.work_id)?.clone();
  231 |     if let Some(parent_id) = &request.parent_id {
  232 |         updated.parent_id = parent_id.clone();
  233 |     }
  234 |     if let Some(title) = &request.title {
  235 |         if title.trim().is_empty() {
  236 |             return Err(PlanningError::Invalid(
  237 |                 "work title cannot be empty".to_owned(),
  238 |             ));
  239 |         }
  240 |         updated.title = title.clone();
  241 |     }
  242 |     if let Some(mode) = request.execution_mode {
  243 |         updated.execution_mode = mode;
  244 |     }
  245 |     let mut nodes = snapshot.nodes.clone();
  246 |     let position = nodes
  247 |         .iter()
  248 |         .position(|node| node.id == request.work_id)
  249 |         .unwrap();
  250 |     nodes[position] = updated.clone();
  251 |     validate_decomposition(&nodes)?;
  252 |     let request_digest = canonical_request_digest(
  253 |         "work.edit/v3",
  254 |         json!({
  255 |             "project_id": request.scope.project_id.as_str(),
  256 |             "actor_id": request.scope.actor_id,
  257 |             "session_id": request.scope.session_id,
  258 |             "work_id": request.work_id.as_str(),
  259 |             "parent_id": request.parent_id.as_ref().map(|parent| parent.as_ref().map(WorkId::as_str)),
  260 |             "title": request.title,
  261 |             "execution_mode": request.execution_mode.map(|mode| format!("{mode:?}").to_ascii_lowercase()),
  262 |             "expected_revision": request.scope.expected_revision,
  263 |         }),
  264 |     );
  265 |     Ok(PlannedOperation {
  266 |         operation_id: request.operation_id.clone(),
  267 |         request_digest,
  268 |         project_id: request.scope.project_id.clone(),
  269 |         actor_id: request.scope.actor_id.clone(),
  270 |         session_id: request.scope.session_id.clone(),
  271 |         expected_revision: snapshot.revision,
  272 |         value: updated,
  273 |     })
  274 | }
  275 | 
  276 | #[derive(Clone, Debug, Eq, PartialEq)]
  277 | pub enum DependencyChange {
  278 |     Add(DirectDependency),
  279 |     Remove(DirectDependency),
  280 | }
  281 | 
  282 | pub fn plan_dependency_change(
  283 |     snapshot: &HierarchySnapshot,
  284 |     scope: &PlanningScope,
  285 |     operation_id: impl Into<String>,
  286 |     change: DependencyChange,
  287 | ) -> Result<PlannedOperation<Vec<DirectDependency>>, PlanningError> {
  288 |     snapshot.scope(scope)?;
  289 |     let mut dependencies = snapshot.dependencies.clone();
  290 |     match &change {
  291 |         DependencyChange::Add(edge) => dependencies.push(edge.clone()),
  292 |         DependencyChange::Remove(edge) => {
  293 |             let before = dependencies.len();
  294 |             dependencies.retain(|candidate| candidate != edge);
  295 |             if before == dependencies.len() {
  296 |                 return Err(PlanningError::Invalid(
  297 |                     "dependency edge not found".to_owned(),
  298 |                 ));
  299 |             }
  300 |         }
````
