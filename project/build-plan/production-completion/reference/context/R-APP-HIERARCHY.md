# R-APP-HIERARCHY — crates/application/src/hierarchy.rs

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `crates/application/src/hierarchy.rs:L1–L1143`  
**File SHA-256:** `10958530b2228edd78ab87b49be699fe37e9c6c80cff9f6b14720f8d00de86be`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Fixed-tree facade and current parent validation; define explicit cycle compatibility migration.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,1143p' 'crates/application/src/hierarchy.rs'
```

## Exact baseline excerpt

````text
    1 | //! Application façade for v3 hierarchy planning and schema capability.
    2 | //!
    3 | //! The mutation methods keep lifecycle and graph policy in this application
    4 | //! boundary.  Row-level adapters are used where the store exposes a v3 seam;
    5 | //! planning-only APIs remain explicit for edits and graph operations whose
    6 | //! transactional store methods are not available yet.
    7 | 
    8 | use boreal_domain::work_model_v3::{
    9 |     ActivationPolicy, CycleAssignment, CycleAssignmentState, CycleInstance, CycleLifecycle,
   10 |     CycleSeries, CycleSeriesLifecycle, CycleTemplate, DispositionKind, FoldPolicy, GapPolicy,
   11 |     IntakeBucket, IntakeItem, IntakeKind, IntakeLifecycle, IntakePromotion, PromotionTargetKind,
   12 | };
   13 | use boreal_domain::{ProjectId, SessionId};
   14 | use boreal_store::{
   15 |     AttemptRecord, ContainerDispositionV3Input, CycleAssignmentV3Input, CycleSeriesV3Input,
   16 |     CycleTemplateV3Input, CycleV3Input, IntakeBucketV3Input, IntakeItemV3Input, IntakeItemV3Record,
   17 |     IntakePromotionV3Input, MutationResult, SessionRecord, SessionState, V3MutationContext,
   18 |     WorkNodeV3Input,
   19 | };
   20 | use std::collections::{BTreeMap, BTreeSet};
   21 | 
   22 | use crate::planning_v3::{
   23 |     plan_cycle_activation, plan_cycle_create, plan_cycle_slot, plan_dependency_change,
   24 |     plan_work_edit, plan_work_policy,
   25 | };
   26 | use crate::{canonical_request_digest, ApplicationError, OperationResult, WorkApplication};
   27 | 
   28 | pub use crate::planning_v3::{
   29 |     CycleActivationRequest, CycleCreateRequest, CycleSlotRequest, DependencyChange,
   30 |     HierarchySnapshot, PlannedOperation, PlanningError, PlanningScope, SystemTimeZoneDatabase,
   31 |     WorkEditRequest, WorkPolicyPatch,
   32 | };
   33 | 
   34 | #[derive(Clone, Debug, Eq, PartialEq)]
   35 | pub struct DependencyGraphView {
   36 |     pub project_id: ProjectId,
   37 |     pub revision: u64,
   38 |     pub edges: Vec<DependencyEdgeView>,
   39 |     pub cycles: Vec<Vec<String>>,
   40 | }
   41 | 
   42 | #[derive(Clone, Debug, Eq, PartialEq)]
   43 | pub struct DependencyEdgeView {
   44 |     pub prerequisite_id: String,
   45 |     pub dependent_id: String,
   46 | }
   47 | 
   48 | #[derive(Clone, Debug, Eq, PartialEq)]
   49 | pub struct CycleBoardView {
   50 |     pub project_id: ProjectId,
   51 |     pub revision: u64,
   52 |     pub cycle: boreal_store::CycleV3Record,
   53 |     pub assignments: Vec<CycleBoardAssignment>,
   54 | }
   55 | 
   56 | #[derive(Clone, Debug, Eq, PartialEq)]
   57 | pub struct CycleBoardAssignment {
   58 |     pub assignment: boreal_store::CycleAssignmentV3Record,
   59 |     pub work_title: Option<String>,
   60 |     pub work_kind: Option<String>,
   61 |     pub work_lifecycle: Option<String>,
   62 | }
   63 | 
   64 | #[derive(Clone, Debug, Eq, PartialEq)]
   65 | pub struct IntakeItemsView {
   66 |     pub project_id: ProjectId,
   67 |     pub revision: u64,
   68 |     pub items: Vec<IntakeItemV3Record>,
   69 | }
   70 | 
   71 | impl WorkApplication<'_> {
   72 |     /// Return the canonical dependency graph and deterministic cycle
   73 |     /// diagnostics from one store snapshot. This read model is shared by
   74 |     /// CLI, service, and dashboard adapters.
   75 |     pub fn dependency_graph(
   76 |         &self,
   77 |         project_id: &ProjectId,
   78 |     ) -> Result<DependencyGraphView, ApplicationError> {
   79 |         let snapshot = self.store_ref().read_project_status(project_id.as_str())?;
   80 |         let mut edges = snapshot
   81 |             .dependencies
   82 |             .into_iter()
   83 |             .map(|edge| DependencyEdgeView {
   84 |                 prerequisite_id: edge.prerequisite_id.to_string(),
   85 |                 dependent_id: edge.dependent_id.to_string(),
   86 |             })
   87 |             .collect::<Vec<_>>();
   88 |         edges.sort_by(|left, right| {
   89 |             left.prerequisite_id
   90 |                 .cmp(&right.prerequisite_id)
   91 |                 .then_with(|| left.dependent_id.cmp(&right.dependent_id))
   92 |         });
   93 |         let cycles = find_dependency_cycles(&edges);
   94 |         Ok(DependencyGraphView {
   95 |             project_id: project_id.clone(),
   96 |             revision: snapshot.revision.0,
   97 |             edges,
   98 |             cycles,
   99 |         })
  100 |     }
  101 | 
  102 |     /// Build a cycle board from persisted v3 assignments and the canonical
  103 |     /// v2 work/status snapshot. The board is read-only; lifecycle mutations
  104 |     /// remain application/store operations.
  105 |     pub fn cycle_board_v3(
  106 |         &self,
  107 |         project_id: &ProjectId,
  108 |         cycle_id: &str,
  109 |     ) -> Result<CycleBoardView, ApplicationError> {
  110 |         if !self.store_ref().work_model_v3_enabled()? {
  111 |             return Err(ApplicationError::Invalid(
  112 |                 "cycle board requires work-model/3 to be enabled".to_owned(),
  113 |             ));
  114 |         }
  115 |         let cycle = self
  116 |             .store_ref()
  117 |             .cycle_v3(project_id.as_str(), cycle_id)?
  118 |             .ok_or_else(|| boreal_store::StoreError::NotFound {
  119 |                 entity: "cycle_v3",
  120 |                 id: cycle_id.to_owned(),
  121 |             })?;
  122 |         let status = self.store_ref().read_project_status(project_id.as_str())?;
  123 |         let work = status
  124 |             .works
  125 |             .into_iter()
  126 |             .map(|row| (row.work.id.to_string(), row.work))
  127 |             .collect::<BTreeMap<_, _>>();
  128 |         let assignments = self
  129 |             .store_ref()
  130 |             .cycle_assignments_v3(project_id.as_str(), cycle_id)?
  131 |             .into_iter()
  132 |             .map(|assignment| {
  133 |                 let item = work.get(&assignment.work_id);
  134 |                 CycleBoardAssignment {
  135 |                     work_title: item.map(|value| value.title.clone()),
  136 |                     work_kind: item.map(|value| format!("{:?}", value.kind).to_ascii_lowercase()),
  137 |                     work_lifecycle: item
  138 |                         .map(|value| format!("{:?}", value.lifecycle).to_ascii_lowercase()),
  139 |                     assignment,
  140 |                 }
  141 |             })
  142 |             .collect();
  143 |         Ok(CycleBoardView {
  144 |             project_id: project_id.clone(),
  145 |             revision: self.store_ref().project_revision(project_id.as_str())?.0,
  146 |             cycle,
  147 |             assignments,
  148 |         })
  149 |     }
  150 | 
  151 |     pub fn intake_items_v3(
  152 |         &self,
  153 |         project_id: &ProjectId,
  154 |     ) -> Result<IntakeItemsView, ApplicationError> {
  155 |         if !self.store_ref().work_model_v3_enabled()? {
  156 |             return Err(ApplicationError::Invalid(
  157 |                 "intake requires work-model/3 to be enabled".to_owned(),
  158 |             ));
  159 |         }
  160 |         Ok(IntakeItemsView {
  161 |             project_id: project_id.clone(),
  162 |             revision: self.store_ref().project_revision(project_id.as_str())?.0,
  163 |             items: self.store_ref().intake_items_v3(project_id.as_str())?,
  164 |         })
  165 |     }
  166 | 
  167 |     /// Install and verify the additive v3 schema through the store-owned
  168 |     /// migration boundary.  Existing schema-2 tables remain untouched.
  169 |     pub fn ensure_work_model_v3(&self) -> Result<bool, ApplicationError> {
  170 |         if self.store_ref().work_model_v3_enabled()? {
  171 |             return Ok(false);
  172 |         }
  173 |         self.store_ref()
  174 |             .apply_work_model_v3(include_str!("../../../project/spec/schema-v3.sql"))?;
  175 |         Ok(true)
  176 |     }
  177 | 
  178 |     pub fn work_model_v3_enabled(&self) -> Result<bool, ApplicationError> {
  179 |         Ok(self.store_ref().work_model_v3_enabled()?)
  180 |     }
  181 | 
  182 |     pub fn create_work_node_v3(
  183 |         &self,
  184 |         scope: &PlanningScope,
  185 |         operation_id: impl Into<String>,
  186 |         node: &boreal_domain::work_model_v3::WorkNode,
  187 |         now: &str,
  188 |     ) -> Result<OperationResult<()>, ApplicationError> {
  189 |         ensure_mutation_scope(self.store_ref(), scope)?;
  190 |         if node.project_id != scope.project_id {
  191 |             return Err(ApplicationError::Planning(PlanningError::ScopeConflict {
  192 |                 expected: scope.project_id.to_string(),
  193 |                 actual: node.project_id.to_string(),
  194 |             }));
  195 |         }
  196 |         validate_nonempty("work_id", node.id.as_str())?;
  197 |         validate_nonempty("work title", &node.title)?;
  198 |         let operation_id = operation_id.into();
  199 |         let input = WorkNodeV3Input {
  200 |             project_id: node.project_id.to_string(),
  201 |             work_id: node.id.to_string(),
  202 |             decomposition_kind: match node.kind {
  203 |                 boreal_domain::work_model_v3::DecompositionKind::Milestone => "milestone",
  204 |                 boreal_domain::work_model_v3::DecompositionKind::Task => "task",
  205 |             }
  206 |             .to_owned(),
  207 |             execution_mode: match node.execution_mode {
  208 |                 boreal_domain::work_model_v3::ExecutionMode::Direct => "direct",
  209 |                 boreal_domain::work_model_v3::ExecutionMode::Container => "container",
  210 |             }
  211 |             .to_owned(),
  212 |             parent_id: node.parent_id.as_ref().map(ToString::to_string),
  213 |             created_at: now.to_owned(),
  214 |             updated_at: now.to_owned(),
  215 |         };
  216 |         let mutation = self.store_ref().create_work_node_v3(
  217 |             &v3_context(
  218 |                 scope,
  219 |                 &operation_id,
  220 |                 "work.node.create/v3",
  221 |                 node.id.as_str(),
  222 |                 now,
  223 |             ),
  224 |             &input,
  225 |         )?;
  226 |         Ok(operation_result(operation_id, mutation))
  227 |     }
  228 | 
  229 |     pub fn create_cycle_series_v3(
  230 |         &self,
  231 |         scope: &PlanningScope,
  232 |         operation_id: impl Into<String>,
  233 |         series: &CycleSeries,
  234 |         timezone: &str,
  235 |         tzdb_identity: &str,
  236 |         now: &str,
  237 |     ) -> Result<OperationResult<()>, ApplicationError> {
  238 |         ensure_mutation_scope(self.store_ref(), scope)?;
  239 |         if series.project_id != scope.project_id {
  240 |             return Err(ApplicationError::Planning(PlanningError::ScopeConflict {
  241 |                 expected: scope.project_id.to_string(),
  242 |                 actual: series.project_id.to_string(),
  243 |             }));
  244 |         }
  245 |         validate_nonempty("cycle series id", series.id.as_str())?;
  246 |         validate_nonempty("cycle series name", &series.name)?;
  247 |         validate_nonempty("cycle timezone", timezone)?;
  248 |         validate_nonempty("tzdb identity", tzdb_identity)?;
  249 |         let operation_id = operation_id.into();
  250 |         let mutation = self.store_ref().create_cycle_series_v3(
  251 |             &v3_context(
  252 |                 scope,
  253 |                 &operation_id,
  254 |                 "cycle.series.create/v3",
  255 |                 series.id.as_str(),
  256 |                 now,
  257 |             ),
  258 |             &CycleSeriesV3Input {
  259 |                 project_id: series.project_id.to_string(),
  260 |                 series_id: series.id.to_string(),
  261 |                 name: series.name.clone(),
  262 |                 lifecycle: series_lifecycle(series.lifecycle),
  263 |                 timezone: timezone.to_owned(),
  264 |                 tzdb_identity: tzdb_identity.to_owned(),
  265 |                 created_at: now.to_owned(),
  266 |                 updated_at: now.to_owned(),
  267 |             },
  268 |         )?;
  269 |         Ok(operation_result(operation_id, mutation))
  270 |     }
  271 | 
  272 |     pub fn create_cycle_template_v3(
  273 |         &self,
  274 |         scope: &PlanningScope,
  275 |         operation_id: impl Into<String>,
  276 |         template: &CycleTemplate,
  277 |         now: &str,
  278 |         tzdb_identity: &str,
  279 |     ) -> Result<OperationResult<()>, ApplicationError> {
  280 |         ensure_mutation_scope(self.store_ref(), scope)?;
  281 |         template
  282 |             .validate()
  283 |             .map_err(PlanningError::from)
  284 |             .map_err(ApplicationError::from)?;
  285 |         if tzdb_identity.trim().is_empty() {
  286 |             return Err(ApplicationError::Planning(PlanningError::Invalid(
  287 |                 "cycle template requires a real tzdb identity".to_owned(),
  288 |             )));
  289 |         }
  290 |         let series_row = self
  291 |             .store_ref()
  292 |             .cycle_series_v3(scope.project_id.as_str(), template.series_id.as_str())?
  293 |             .ok_or_else(|| boreal_store::StoreError::NotFound {
  294 |                 entity: "cycle_series_v3",
  295 |                 id: template.series_id.to_string(),
  296 |             })?;
  297 |         if series_row.timezone != template.timezone {
  298 |             return Err(ApplicationError::Planning(PlanningError::Invalid(
  299 |                 "cycle template timezone must match its series".to_owned(),
  300 |             )));
  301 |         }
  302 |         if series_row.tzdb_identity != tzdb_identity {
  303 |             return Err(ApplicationError::Planning(PlanningError::Invalid(
  304 |                 "cycle template tzdb identity must match its series".to_owned(),
  305 |             )));
  306 |         }
  307 |         let operation_id = operation_id.into();
  308 |         let recurrence = &template.recurrence;
  309 |         let mutation = self.store_ref().create_cycle_template_v3(
  310 |             &v3_context(
  311 |                 scope,
  312 |                 &operation_id,
  313 |                 "cycle.template.create/v3",
  314 |                 template.id.as_str(),
  315 |                 now,
  316 |             ),
  317 |             &CycleTemplateV3Input {
  318 |                 project_id: scope.project_id.to_string(),
  319 |                 template_version_id: template.id.to_string(),
  320 |                 series_id: template.series_id.to_string(),
  321 |                 version: u64::from(template.version),
  322 |                 effective_from_slot_ordinal: template.effective_from_slot_ordinal,
  323 |                 interval_weeks: u64::from(recurrence.interval_weeks),
  324 |                 anchor_local_date: format_local_date(recurrence.anchor_local_start.date),
  325 |                 anchor_local_time: format_local_time(recurrence.anchor_local_start.time),
  326 |                 anchor_weekday: recurrence
  327 |                     .anchor_local_start
  328 |                     .weekday()
  329 |                     .map_err(PlanningError::from)
  330 |                     .map_err(ApplicationError::from)?,
  331 |                 recurrence_end_kind: recurrence_end_kind(recurrence.end),
  332 |                 recurrence_end_count: recurrence_end_count(recurrence.end),
  333 |                 recurrence_end_local_date: recurrence_end_date(recurrence.end),
  334 |                 name_pattern: template.name_pattern.clone(),
  335 |                 goal_template: template.goal_template.clone(),
  336 |                 timezone: template.timezone.clone(),
  337 |                 tzdb_identity: tzdb_identity.to_owned(),
  338 |                 gap_policy: gap_policy(recurrence.gap_policy),
  339 |                 fold_policy: fold_policy(recurrence.fold_policy),
  340 |                 weekdays: recurrence.weekdays.iter().copied().collect(),
  341 |                 created_at: now.to_owned(),
  342 |             },
  343 |         )?;
  344 |         Ok(operation_result(operation_id, mutation))
  345 |     }
  346 | 
  347 |     pub fn create_cycle_instance_v3(
  348 |         &self,
  349 |         scope: &PlanningScope,
  350 |         operation_id: impl Into<String>,
  351 |         cycle: &CycleInstance,
  352 |         goal: &str,
  353 |         lifecycle: CycleLifecycle,
  354 |         now: &str,
  355 |     ) -> Result<OperationResult<()>, ApplicationError> {
  356 |         ensure_mutation_scope(self.store_ref(), scope)?;
  357 |         cycle
  358 |             .validate()
  359 |             .map_err(PlanningError::from)
  360 |             .map_err(ApplicationError::from)?;
  361 |         if cycle.project_id != scope.project_id {
  362 |             return Err(ApplicationError::Planning(PlanningError::ScopeConflict {
  363 |                 expected: scope.project_id.to_string(),
  364 |                 actual: cycle.project_id.to_string(),
  365 |             }));
  366 |         }
  367 |         validate_nonempty("cycle id", cycle.id.as_str())?;
  368 |         validate_nonempty("cycle name", &cycle.name)?;
  369 |         let operation_id = operation_id.into();
  370 |         let start = &cycle.scheduled_start;
  371 |         let mutation = self.store_ref().create_cycle_v3(
  372 |             &v3_context(
  373 |                 scope,
  374 |                 &operation_id,
  375 |                 "cycle.create/v3",
  376 |                 cycle.id.as_str(),
  377 |                 now,
  378 |             ),
  379 |             &CycleV3Input {
  380 |                 project_id: cycle.project_id.to_string(),
  381 |                 cycle_id: cycle.id.to_string(),
  382 |                 series_id: cycle.series_id.to_string(),
  383 |                 template_version_id: cycle.template_version_id.to_string(),
  384 |                 slot_ordinal: cycle.slot_ordinal,
  385 |                 name: cycle.name.clone(),
  386 |                 goal: goal.to_owned(),
  387 |                 lifecycle: cycle_lifecycle(lifecycle),
  388 |                 scheduled_start_utc_ms: i64::try_from(start.utc_instant.as_millis()).map_err(
  389 |                     |_| {
  390 |                         ApplicationError::Invalid("cycle timestamp exceeds SQLite range".to_owned())
  391 |                     },
  392 |                 )?,
  393 |                 scheduled_end_utc_ms: cycle
  394 |                     .scheduled_end
  395 |                     .as_ref()
  396 |                     .map(|end| i64::try_from(end.utc_instant.as_millis()))
  397 |                     .transpose()
  398 |                     .map_err(|_| {
  399 |                         ApplicationError::Invalid("cycle timestamp exceeds SQLite range".to_owned())
  400 |                     })?,
  401 |                 scheduled_start_local: format_local_datetime(start.nominal_local),
  402 |                 scheduled_start_utc_offset_minutes: i64::from(start.utc_offset_minutes),
  403 |                 timezone: start.timezone.clone(),
  404 |                 tzdb_identity: start.tzdb_identity.clone(),
  405 |                 gap_policy: gap_policy(start.gap_policy),
  406 |                 fold_policy: fold_policy(start.fold_policy),
  407 |                 created_at: now.to_owned(),
  408 |                 updated_at: now.to_owned(),
  409 |             },
  410 |         )?;
  411 |         Ok(operation_result(operation_id, mutation))
  412 |     }
  413 | 
  414 |     pub fn assign_cycle_work_v3(
  415 |         &self,
  416 |         scope: &PlanningScope,
  417 |         operation_id: impl Into<String>,
  418 |         assignment: &CycleAssignment,
  419 |         now: &str,
  420 |     ) -> Result<OperationResult<()>, ApplicationError> {
  421 |         ensure_mutation_scope(self.store_ref(), scope)?;
  422 |         if assignment.project_id != scope.project_id {
  423 |             return Err(ApplicationError::Planning(PlanningError::ScopeConflict {
  424 |                 expected: scope.project_id.to_string(),
  425 |                 actual: assignment.project_id.to_string(),
  426 |             }));
  427 |         }
  428 |         let cycle = self
  429 |             .store_ref()
  430 |             .cycle_v3(scope.project_id.as_str(), assignment.cycle_id.as_str())?
  431 |             .ok_or_else(|| boreal_store::StoreError::NotFound {
  432 |                 entity: "cycle_v3",
  433 |                 id: assignment.cycle_id.to_string(),
  434 |             })?;
  435 |         let work = self
  436 |             .store_ref()
  437 |             .work_node_v3(scope.project_id.as_str(), assignment.work_id.as_str())?
  438 |             .ok_or_else(|| boreal_store::StoreError::NotFound {
  439 |                 entity: "work_node_v3",
  440 |                 id: assignment.work_id.to_string(),
  441 |             })?;
  442 |         if cycle.project_id.as_str() != assignment.project_id.as_str()
  443 |             || work.project_id.as_str() != assignment.project_id.as_str()
  444 |         {
  445 |             return Err(ApplicationError::Planning(PlanningError::ScopeConflict {
  446 |                 expected: scope.project_id.to_string(),
  447 |                 actual: assignment.project_id.to_string(),
  448 |             }));
  449 |         }
  450 |         let operation_id = operation_id.into();
  451 |         let mutation = self.store_ref().assign_cycle_work_v3(
  452 |             &v3_context(
  453 |                 scope,
  454 |                 &operation_id,
  455 |                 "cycle.assignment.create/v3",
  456 |                 &assignment.id,
  457 |                 now,
  458 |             ),
  459 |             &CycleAssignmentV3Input {
  460 |                 project_id: assignment.project_id.to_string(),
  461 |                 assignment_id: assignment.id.clone(),
  462 |                 cycle_id: assignment.cycle_id.to_string(),
  463 |                 work_id: assignment.work_id.to_string(),
  464 |                 state: assignment_state(assignment.state),
  465 |                 activation_policy: activation_policy(assignment.activation_policy),
  466 |                 activation_at_utc_ms: assignment
  467 |                     .activation_at
  468 |                     .map(|at| i64::try_from(at.as_millis()))
  469 |                     .transpose()
  470 |                     .map_err(|_| {
  471 |                         ApplicationError::Invalid(
  472 |                             "activation timestamp exceeds SQLite range".to_owned(),
  473 |                         )
  474 |                     })?,
  475 |                 predecessor_id: assignment.predecessor_id.clone(),
  476 |                 successor_id: assignment.successor_id.clone(),
  477 |                 created_at: now.to_owned(),
  478 |                 updated_at: now.to_owned(),
  479 |             },
  480 |         )?;
  481 |         Ok(operation_result(operation_id, mutation))
  482 |     }
  483 | 
  484 |     pub fn create_intake_bucket_v3(
  485 |         &self,
  486 |         scope: &PlanningScope,
  487 |         operation_id: impl Into<String>,
  488 |         bucket: &IntakeBucket,
  489 |         now: &str,
  490 |     ) -> Result<OperationResult<()>, ApplicationError> {
  491 |         ensure_mutation_scope(self.store_ref(), scope)?;
  492 |         if bucket.project_id != scope.project_id {
  493 |             return Err(ApplicationError::Planning(PlanningError::ScopeConflict {
  494 |                 expected: scope.project_id.to_string(),
  495 |                 actual: bucket.project_id.to_string(),
  496 |             }));
  497 |         }
  498 |         validate_nonempty("intake bucket id", bucket.id.as_str())?;
  499 |         validate_nonempty("intake bucket name", &bucket.name)?;
  500 |         let operation_id = operation_id.into();
  501 |         let mutation = self.store_ref().create_intake_bucket_v3(
  502 |             &v3_context(
  503 |                 scope,
  504 |                 &operation_id,
  505 |                 "intake.bucket.create/v3",
  506 |                 bucket.id.as_str(),
  507 |                 now,
  508 |             ),
  509 |             &IntakeBucketV3Input {
  510 |                 project_id: bucket.project_id.to_string(),
  511 |                 bucket_id: bucket.id.to_string(),
  512 |                 name: bucket.name.clone(),
  513 |                 archived: bucket.archived,
  514 |                 created_at: now.to_owned(),
  515 |                 updated_at: now.to_owned(),
  516 |             },
  517 |         )?;
  518 |         Ok(operation_result(operation_id, mutation))
  519 |     }
  520 | 
  521 |     pub fn create_intake_item_v3(
  522 |         &self,
  523 |         scope: &PlanningScope,
  524 |         operation_id: impl Into<String>,
  525 |         item: &IntakeItem,
  526 |         captured_at: &str,
  527 |         updated_at: &str,
  528 |     ) -> Result<OperationResult<()>, ApplicationError> {
  529 |         ensure_mutation_scope(self.store_ref(), scope)?;
  530 |         if item.project_id != scope.project_id {
  531 |             return Err(ApplicationError::Planning(PlanningError::ScopeConflict {
  532 |                 expected: scope.project_id.to_string(),
  533 |                 actual: item.project_id.to_string(),
  534 |             }));
  535 |         }
  536 |         validate_nonempty("intake id", item.id.as_str())?;
  537 |         if item.content.trim().is_empty() {
  538 |             return Err(ApplicationError::Invalid(
  539 |                 "intake content is required".to_owned(),
  540 |             ));
  541 |         }
  542 |         if item.content_revision == 0 {
  543 |             return Err(ApplicationError::Invalid(
  544 |                 "intake content_revision must be positive".to_owned(),
  545 |             ));
  546 |         }
  547 |         let expected_digest = crate::sha256_content_digest(item.content.as_bytes());
  548 |         if item.content_digest != expected_digest {
  549 |             return Err(ApplicationError::Planning(PlanningError::Invalid(
  550 |                 "intake content_digest does not match content".to_owned(),
  551 |             )));
  552 |         }
  553 |         let operation_id = operation_id.into();
  554 |         let mutation = self.store_ref().create_intake_item_v3(
  555 |             &v3_context(
  556 |                 scope,
  557 |                 &operation_id,
  558 |                 "intake.item.create/v3",
  559 |                 item.id.as_str(),
  560 |                 updated_at,
  561 |             ),
  562 |             &IntakeItemV3Input {
  563 |                 project_id: item.project_id.to_string(),
  564 |                 intake_id: item.id.to_string(),
  565 |                 bucket_id: item.bucket_id.to_string(),
  566 |                 kind: intake_kind(item.kind),
  567 |                 lifecycle: intake_lifecycle(item.lifecycle),
  568 |                 content: item.content.clone(),
  569 |                 content_revision: item.content_revision,
  570 |                 content_digest: item.content_digest.clone(),
  571 |                 captured_at: captured_at.to_owned(),
  572 |                 updated_at: updated_at.to_owned(),
  573 |                 revisit_at_utc_ms: item
  574 |                     .revisit_at
  575 |                     .map(|at| i64::try_from(at.as_millis()))
  576 |                     .transpose()
  577 |                     .map_err(|_| {
  578 |                         ApplicationError::Invalid(
  579 |                             "revisit timestamp exceeds SQLite range".to_owned(),
  580 |                         )
  581 |                     })?,
  582 |             },
  583 |         )?;
  584 |         Ok(operation_result(operation_id, mutation))
  585 |     }
  586 | 
  587 |     pub fn promote_intake_v3(
  588 |         &self,
  589 |         scope: &PlanningScope,
  590 |         operation_id: impl Into<String>,
  591 |         promotion: &IntakePromotion,
  592 |         now: &str,
  593 |     ) -> Result<OperationResult<()>, ApplicationError> {
  594 |         ensure_mutation_scope(self.store_ref(), scope)?;
  595 |         if promotion.project_id != scope.project_id {
  596 |             return Err(ApplicationError::Planning(PlanningError::ScopeConflict {
  597 |                 expected: scope.project_id.to_string(),
  598 |                 actual: promotion.project_id.to_string(),
  599 |             }));
  600 |         }
  601 |         validate_nonempty("promotion id", promotion.id.as_str())?;
  602 |         validate_nonempty("promotion target id", &promotion.target_id)?;
  603 |         // The store trigger checks the intake revision/digest in the same
  604 |         // transaction as the insert. Avoid a mutable pre-read here: a retry
  605 |         // must reach the store's replay-first path even if the intake changed
  606 |         // after the original promotion committed.
  607 |         let operation_id = operation_id.into();
  608 |         let mutation = self.store_ref().promote_intake_v3(
  609 |             &v3_context(
  610 |                 scope,
  611 |                 &operation_id,
  612 |                 "intake.promote/v3",
  613 |                 promotion.intake_id.as_str(),
  614 |                 now,
  615 |             ),
  616 |             &IntakePromotionV3Input {
  617 |                 project_id: promotion.project_id.to_string(),
  618 |                 promotion_id: promotion.id.to_string(),
  619 |                 intake_id: promotion.intake_id.to_string(),
  620 |                 intake_revision: promotion.intake_revision,
  621 |                 intake_digest: promotion.intake_digest.clone(),
  622 |                 target_kind: promotion_target_kind(promotion.target_kind),
  623 |                 target_id: promotion.target_id.clone(),
  624 |                 actor_id: scope.actor_id.clone(),
  625 |                 operation_id: operation_id.clone(),
  626 |                 created_at: now.to_owned(),
  627 |             },
  628 |         )?;
  629 |         Ok(operation_result(operation_id, mutation))
  630 |     }
  631 | 
  632 |     pub fn append_container_disposition_v3(
  633 |         &self,
  634 |         scope: &PlanningScope,
  635 |         operation_id: impl Into<String>,
  636 |         disposition: &boreal_domain::work_model_v3::ContainerDisposition,
  637 |         now: &str,
  638 |     ) -> Result<OperationResult<()>, ApplicationError> {
  639 |         ensure_mutation_scope(self.store_ref(), scope)?;
  640 |         if disposition.project_id != scope.project_id {
  641 |             return Err(ApplicationError::Planning(PlanningError::ScopeConflict {
  642 |                 expected: scope.project_id.to_string(),
  643 |                 actual: disposition.project_id.to_string(),
  644 |             }));
  645 |         }
  646 |         validate_disposition_shape(disposition)?;
  647 |         let operation_id = operation_id.into();
  648 |         let mutation = self.store_ref().append_container_disposition_v3(
  649 |             &v3_context(
  650 |                 scope,
  651 |                 &operation_id,
  652 |                 "container.disposition.append/v3",
  653 |                 disposition.container_id.as_str(),
  654 |                 now,
  655 |             ),
  656 |             &ContainerDispositionV3Input {
  657 |                 project_id: disposition.project_id.to_string(),
  658 |                 disposition_id: disposition.id.to_string(),
  659 |                 container_work_id: disposition.container_id.to_string(),
  660 |                 descendant_work_id: disposition.descendant_id.to_string(),
  661 |                 kind: disposition_kind(disposition.kind),
  662 |                 descendant_revision: disposition.descendant_revision,
  663 |                 descendant_outcome_digest: disposition.descendant_outcome_digest.clone(),
  664 |                 replacement_work_id: disposition.replacement_id.as_ref().map(ToString::to_string),
  665 |                 reason: disposition.reason.clone(),
  666 |                 supersedes_id: disposition.supersedes_id.as_ref().map(ToString::to_string),
  667 |                 created_at: now.to_owned(),
  668 |             },
  669 |         )?;
  670 |         Ok(operation_result(operation_id, mutation))
  671 |     }
  672 | 
  673 |     pub fn plan_work_edit(
  674 |         &self,
  675 |         snapshot: &HierarchySnapshot,
  676 |         request: &WorkEditRequest,
  677 |     ) -> Result<PlannedOperation<boreal_domain::work_model_v3::WorkNode>, ApplicationError> {
  678 |         plan_work_edit(snapshot, request).map_err(ApplicationError::from)
  679 |     }
  680 | 
  681 |     pub fn plan_dependency_change(
  682 |         &self,
  683 |         snapshot: &HierarchySnapshot,
  684 |         scope: &PlanningScope,
  685 |         operation_id: impl Into<String>,
  686 |         change: DependencyChange,
  687 |     ) -> Result<
  688 |         PlannedOperation<Vec<boreal_domain::work_model_v3::DirectDependency>>,
  689 |         ApplicationError,
  690 |     > {
  691 |         plan_dependency_change(snapshot, scope, operation_id, change)
  692 |             .map_err(ApplicationError::from)
  693 |     }
  694 | 
  695 |     pub fn plan_work_policy(
  696 |         &self,
  697 |         scope: &PlanningScope,
  698 |         actual_revision: u64,
  699 |         operation_id: impl Into<String>,
  700 |         current: &boreal_domain::WorkItem,
  701 |         patch: &WorkPolicyPatch,
  702 |     ) -> Result<PlannedOperation<boreal_domain::WorkItem>, ApplicationError> {
  703 |         plan_work_policy(scope, actual_revision, operation_id, current, patch)
  704 |             .map_err(ApplicationError::from)
  705 |     }
  706 | 
  707 |     pub fn plan_cycle_create(
  708 |         &self,
  709 |         snapshot: &HierarchySnapshot,
  710 |         request: &CycleCreateRequest,
  711 |     ) -> Result<PlannedOperation<boreal_domain::work_model_v3::Cycle>, ApplicationError> {
  712 |         plan_cycle_create(snapshot, request).map_err(ApplicationError::from)
  713 |     }
  714 | 
  715 |     pub fn plan_cycle_activation(
  716 |         &self,
  717 |         snapshot: &HierarchySnapshot,
  718 |         request: &CycleActivationRequest,
  719 |     ) -> Result<PlannedOperation<boreal_domain::work_model_v3::Cycle>, ApplicationError> {
  720 |         plan_cycle_activation(snapshot, request).map_err(ApplicationError::from)
  721 |     }
  722 | 
  723 |     pub fn plan_cycle_slot(
  724 |         &self,
  725 |         request: &CycleSlotRequest,
  726 |         tzdb: &SystemTimeZoneDatabase,
  727 |     ) -> Result<PlannedOperation<boreal_domain::work_model_v3::CycleInstance>, ApplicationError>
  728 |     {
  729 |         plan_cycle_slot(request, tzdb).map_err(ApplicationError::from)
  730 |     }
  731 | 
  732 |     /// Prepare a session-end operation without silently releasing live work.
  733 |     /// The current store has no session-end transaction yet; the returned plan
  734 |     /// tells the service whether a fenced attempt release is required first.
  735 |     pub fn prepare_session_end(
  736 |         &self,
  737 |         request: &SessionEndRequest,
  738 |     ) -> Result<SessionEndPlan, ApplicationError> {
  739 |         if request.project_id.as_str().trim().is_empty()
  740 |             || request.actor_id.trim().is_empty()
  741 |             || request.session_id.as_str().trim().is_empty()
  742 |         {
  743 |             return Err(ApplicationError::Invalid(
  744 |                 "session end scope is incomplete".to_owned(),
  745 |             ));
  746 |         }
  747 |         let session = self
  748 |             .store_ref()
  749 |             .session(request.project_id.as_str(), request.session_id.as_str())?
  750 |             .ok_or_else(|| boreal_store::StoreError::NotFound {
  751 |                 entity: "session",
  752 |                 id: request.session_id.to_string(),
  753 |             })?;
  754 |         if session.actor_id != request.actor_id {
  755 |             return Err(ApplicationError::Planning(PlanningError::ScopeConflict {
  756 |                 expected: session.actor_id,
  757 |                 actual: request.actor_id.clone(),
  758 |             }));
  759 |         }
  760 |         let current_attempt = self.store_ref().current_attempt_for_session(
  761 |             request.project_id.as_str(),
  762 |             request.session_id.as_str(),
  763 |         )?;
  764 |         if current_attempt.is_some() && !request.confirm_release {
  765 |             return Err(ApplicationError::Planning(PlanningError::Invalid(
  766 |                 "session has live work; confirm fenced release before ending".to_owned(),
  767 |             )));
  768 |         }
  769 |         let requires_release = current_attempt.is_some();
  770 |         Ok(SessionEndPlan {
  771 |             session,
  772 |             current_attempt,
  773 |             requires_release,
  774 |             operation_id: request.operation_id.clone(),
  775 |         })
  776 |     }
  777 | 
  778 |     /// Read-only restart assessment for operator recovery.  It intentionally
  779 |     /// does not mark unknown work safe or force-break a lock.
  780 |     pub fn assess_operator_recovery(
  781 |         &self,
  782 |         project_id: &ProjectId,
  783 |     ) -> Result<OperatorRecoveryAssessment, ApplicationError> {
  784 |         let incomplete = self
  785 |             .store_ref()
  786 |             .list_incomplete_evidence_executions()?
  787 |             .into_iter()
  788 |             .filter(|execution| execution.project_id == project_id.as_str())
  789 |             .collect();
  790 |         Ok(OperatorRecoveryAssessment {
  791 |             project_id: project_id.clone(),
  792 |             incomplete_evidence_executions: incomplete,
  793 |             requires_explicit_reconciliation: true,
  794 |         })
  795 |     }
  796 | }
  797 | 
  798 | fn find_dependency_cycles(edges: &[DependencyEdgeView]) -> Vec<Vec<String>> {
  799 |     let mut adjacency = BTreeMap::<String, Vec<String>>::new();
  800 |     let mut nodes = BTreeSet::new();
  801 |     for edge in edges {
  802 |         nodes.insert(edge.prerequisite_id.clone());
  803 |         nodes.insert(edge.dependent_id.clone());
  804 |         adjacency
  805 |             .entry(edge.prerequisite_id.clone())
  806 |             .or_default()
  807 |             .push(edge.dependent_id.clone());
  808 |     }
  809 |     for children in adjacency.values_mut() {
  810 |         children.sort();
  811 |         children.dedup();
  812 |     }
  813 |     let mut state = BTreeMap::<String, u8>::new();
  814 |     let mut stack = Vec::<String>::new();
  815 |     let mut found = BTreeSet::<Vec<String>>::new();
  816 |     for node in nodes {
  817 |         find_dependency_cycles_from(&node, &adjacency, &mut state, &mut stack, &mut found);
  818 |     }
  819 |     found.into_iter().collect()
  820 | }
  821 | 
  822 | fn find_dependency_cycles_from(
  823 |     node: &str,
  824 |     adjacency: &BTreeMap<String, Vec<String>>,
  825 |     state: &mut BTreeMap<String, u8>,
  826 |     stack: &mut Vec<String>,
  827 |     found: &mut BTreeSet<Vec<String>>,
  828 | ) {
  829 |     if state.get(node).copied() == Some(2) {
  830 |         return;
  831 |     }
  832 |     if state.get(node).copied() == Some(1) {
  833 |         if let Some(index) = stack.iter().position(|value| value == node) {
  834 |             let body = &stack[index..];
  835 |             if let Some((offset, _)) = body.iter().enumerate().min_by_key(|(_, value)| *value) {
  836 |                 let mut canonical = body[offset..].to_vec();
  837 |                 canonical.extend_from_slice(&body[..offset]);
  838 |                 canonical.push(canonical[0].clone());
  839 |                 found.insert(canonical);
  840 |             }
  841 |         }
  842 |         return;
  843 |     }
  844 |     state.insert(node.to_owned(), 1);
  845 |     stack.push(node.to_owned());
  846 |     if let Some(children) = adjacency.get(node) {
  847 |         for child in children {
  848 |             find_dependency_cycles_from(child, adjacency, state, stack, found);
  849 |         }
  850 |     }
  851 |     stack.pop();
  852 |     state.insert(node.to_owned(), 2);
  853 | }
  854 | 
  855 | #[derive(Clone, Debug, Eq, PartialEq)]
  856 | pub struct SessionEndRequest {
  857 |     pub project_id: ProjectId,
  858 |     pub actor_id: String,
  859 |     pub session_id: SessionId,
  860 |     pub operation_id: String,
  861 |     pub confirm_release: bool,
  862 | }
  863 | 
  864 | #[derive(Clone, Debug, Eq, PartialEq)]
  865 | pub struct SessionEndPlan {
  866 |     pub session: SessionRecord,
  867 |     pub current_attempt: Option<AttemptRecord>,
  868 |     pub requires_release: bool,
  869 |     pub operation_id: String,
  870 | }
  871 | 
  872 | #[derive(Clone, Debug, Eq, PartialEq)]
  873 | pub struct OperatorRecoveryAssessment {
  874 |     pub project_id: ProjectId,
  875 |     pub incomplete_evidence_executions: Vec<boreal_store::EvidenceExecutionRecord>,
  876 |     pub requires_explicit_reconciliation: bool,
  877 | }
  878 | 
  879 | fn ensure_mutation_scope(
  880 |     store: &boreal_store::SqliteStore,
  881 |     scope: &PlanningScope,
  882 | ) -> Result<(), ApplicationError> {
  883 |     scope.validate().map_err(ApplicationError::from)?;
  884 |     if let Some(session_id) = scope.session_id.as_deref() {
  885 |         let session = store
  886 |             .session(scope.project_id.as_str(), session_id)?
  887 |             .ok_or_else(|| boreal_store::StoreError::NotFound {
  888 |                 entity: "session",
  889 |                 id: session_id.to_owned(),
  890 |             })?;
  891 |         if session.actor_id != scope.actor_id {
  892 |             return Err(ApplicationError::Planning(PlanningError::ScopeConflict {
  893 |                 expected: session.actor_id,
  894 |                 actual: scope.actor_id.clone(),
  895 |             }));
  896 |         }
  897 |         if session.state != SessionState::Active {
  898 |             return Err(ApplicationError::Invalid(format!(
  899 |                 "session {session_id} is not active"
  900 |             )));
  901 |         }
  902 |     }
  903 |     // The v3 store mutation owns the replay-first, transactional expected
  904 |     // revision check.  Do not perform a read-before-write revision check here:
  905 |     // a retry must be able to replay after the project revision has advanced.
  906 |     if scope.expected_revision.is_none() {
  907 |         return Err(ApplicationError::Planning(PlanningError::Invalid(
  908 |             "v3 mutations require expected_revision".to_owned(),
  909 |         )));
  910 |     }
  911 |     Ok(())
  912 | }
  913 | 
  914 | fn v3_context(
  915 |     scope: &PlanningScope,
  916 |     operation_id: &str,
  917 |     command: &str,
  918 |     subject_id: &str,
  919 |     now: &str,
  920 | ) -> V3MutationContext {
  921 |     V3MutationContext {
  922 |         project_id: scope.project_id.to_string(),
  923 |         actor_id: scope.actor_id.clone(),
  924 |         operation_id: operation_id.to_owned(),
  925 |         request_digest: canonical_request_digest(
  926 |             command,
  927 |             serde_json::json!({
  928 |                 "project_id": scope.project_id.as_str(),
  929 |                 "actor_id": scope.actor_id,
  930 |                 "session_id": scope.session_id,
  931 |                 "subject_id": subject_id,
  932 |                 "expected_revision": scope.expected_revision,
  933 |             }),
  934 |         ),
  935 |         expected_revision: scope.expected_revision,
  936 |         now: now.to_owned(),
  937 |     }
  938 | }
  939 | 
  940 | fn validate_nonempty(field: &'static str, value: &str) -> Result<(), ApplicationError> {
  941 |     if value.trim().is_empty() {
  942 |         return Err(ApplicationError::Invalid(format!("{field} is required")));
  943 |     }
  944 |     Ok(())
  945 | }
  946 | 
  947 | fn validate_disposition_shape(
  948 |     disposition: &boreal_domain::work_model_v3::ContainerDisposition,
  949 | ) -> Result<(), ApplicationError> {
  950 |     use boreal_domain::work_model_v3::DispositionKind;
  951 | 
  952 |     if disposition.container_id == disposition.descendant_id {
  953 |         return Err(ApplicationError::Invalid(
  954 |             "container disposition cannot target its container".to_owned(),
  955 |         ));
  956 |     }
  957 |     validate_nonempty(
  958 |         "descendant outcome digest",
  959 |         &disposition.descendant_outcome_digest,
  960 |     )?;
  961 |     match disposition.kind {
  962 |         DispositionKind::AcceptedClosed | DispositionKind::AcceptedCancelled
  963 |             if disposition.replacement_id.is_some() =>
  964 |         {
  965 |             Err(ApplicationError::Invalid(
  966 |                 "accepted disposition cannot name a replacement".to_owned(),
  967 |             ))
  968 |         }
  969 |         DispositionKind::Deferred
  970 |             if disposition
  971 |                 .reason
  972 |                 .as_deref()
  973 |                 .unwrap_or("")
  974 |                 .trim()
  975 |                 .is_empty() =>
  976 |         {
  977 |             Err(ApplicationError::Invalid(
  978 |                 "deferred disposition requires a reason".to_owned(),
  979 |             ))
  980 |         }
  981 |         DispositionKind::Deferred if disposition.replacement_id.is_some() => Err(
  982 |             ApplicationError::Invalid("deferred disposition cannot name a replacement".to_owned()),
  983 |         ),
  984 |         DispositionKind::Replaced
  985 |             if disposition.replacement_id.is_none()
  986 |                 || disposition
  987 |                     .reason
  988 |                     .as_deref()
  989 |                     .unwrap_or("")
  990 |                     .trim()
  991 |                     .is_empty() =>
  992 |         {
  993 |             Err(ApplicationError::Invalid(
  994 |                 "replacement disposition requires replacement and reason".to_owned(),
  995 |             ))
  996 |         }
  997 |         _ => Ok(()),
  998 |     }
  999 | }
 1000 | 
 1001 | fn operation_result(operation_id: String, mutation: MutationResult) -> OperationResult<()> {
 1002 |     OperationResult {
 1003 |         operation_id,
 1004 |         snapshot_revision: mutation.revision,
 1005 |         changed: !mutation.replayed,
 1006 |         value: (),
 1007 |     }
 1008 | }
 1009 | 
 1010 | fn series_lifecycle(value: CycleSeriesLifecycle) -> String {
 1011 |     match value {
 1012 |         CycleSeriesLifecycle::Active => "active",
 1013 |         CycleSeriesLifecycle::Paused => "paused",
 1014 |         CycleSeriesLifecycle::Retired => "retired",
 1015 |     }
 1016 |     .to_owned()
 1017 | }
 1018 | 
 1019 | fn cycle_lifecycle(value: CycleLifecycle) -> String {
 1020 |     match value {
 1021 |         CycleLifecycle::Planned => "planned",
 1022 |         CycleLifecycle::Active => "active",
 1023 |         CycleLifecycle::Completed => "completed",
 1024 |         CycleLifecycle::Cancelled => "cancelled",
 1025 |     }
 1026 |     .to_owned()
 1027 | }
 1028 | 
 1029 | fn assignment_state(value: CycleAssignmentState) -> String {
 1030 |     match value {
 1031 |         CycleAssignmentState::Planned => "planned",
 1032 |         CycleAssignmentState::Committed => "committed",
 1033 |         CycleAssignmentState::Removed => "removed",
 1034 |         CycleAssignmentState::Completed => "completed",
 1035 |         CycleAssignmentState::CarriedOver => "carried_over",
 1036 |     }
 1037 |     .to_owned()
 1038 | }
 1039 | 
 1040 | fn activation_policy(value: ActivationPolicy) -> String {
 1041 |     match value {
 1042 |         ActivationPolicy::AtCycleStart => "at_cycle_start",
 1043 |         ActivationPolicy::Immediate => "immediate",
 1044 |         ActivationPolicy::ExplicitNotBefore => "explicit_not_before",
 1045 |     }
 1046 |     .to_owned()
 1047 | }
 1048 | 
 1049 | fn gap_policy(value: GapPolicy) -> String {
 1050 |     match value {
 1051 |         GapPolicy::NextValid => "next_valid",
 1052 |     }
 1053 |     .to_owned()
 1054 | }
 1055 | 
 1056 | fn fold_policy(value: FoldPolicy) -> String {
 1057 |     match value {
 1058 |         FoldPolicy::EarlierOffset => "earlier_offset",
 1059 |         FoldPolicy::LaterOffset => "later_offset",
 1060 |     }
 1061 |     .to_owned()
 1062 | }
 1063 | 
 1064 | fn recurrence_end_kind(value: boreal_domain::work_model_v3::RecurrenceEnd) -> String {
 1065 |     match value {
 1066 |         boreal_domain::work_model_v3::RecurrenceEnd::Never => "never",
 1067 |         boreal_domain::work_model_v3::RecurrenceEnd::Count(_) => "count",
 1068 |         boreal_domain::work_model_v3::RecurrenceEnd::UntilLocalDate(_) => "until_local_date",
 1069 |     }
 1070 |     .to_owned()
 1071 | }
 1072 | 
 1073 | fn recurrence_end_count(value: boreal_domain::work_model_v3::RecurrenceEnd) -> Option<u64> {
 1074 |     match value {
 1075 |         boreal_domain::work_model_v3::RecurrenceEnd::Count(count) => Some(count),
 1076 |         _ => None,
 1077 |     }
 1078 | }
 1079 | 
 1080 | fn recurrence_end_date(value: boreal_domain::work_model_v3::RecurrenceEnd) -> Option<String> {
 1081 |     match value {
 1082 |         boreal_domain::work_model_v3::RecurrenceEnd::UntilLocalDate(date) => {
 1083 |             Some(format_local_date(date))
 1084 |         }
 1085 |         _ => None,
 1086 |     }
 1087 | }
 1088 | 
 1089 | fn format_local_date(date: boreal_domain::work_model_v3::LocalDate) -> String {
 1090 |     format!("{:04}-{:02}-{:02}", date.year, date.month, date.day)
 1091 | }
 1092 | 
 1093 | fn format_local_time(time: boreal_domain::work_model_v3::LocalTime) -> String {
 1094 |     format!("{:02}:{:02}:{:02}", time.hour, time.minute, time.second)
 1095 | }
 1096 | 
 1097 | fn format_local_datetime(value: boreal_domain::work_model_v3::LocalDateTime) -> String {
 1098 |     format!(
 1099 |         "{}T{}",
 1100 |         format_local_date(value.date),
 1101 |         format_local_time(value.time)
 1102 |     )
 1103 | }
 1104 | 
 1105 | fn intake_kind(value: IntakeKind) -> String {
 1106 |     match value {
 1107 |         IntakeKind::Note => "note",
 1108 |         IntakeKind::Discovery => "discovery",
 1109 |         IntakeKind::Question => "question",
 1110 |         IntakeKind::Revisit => "revisit",
 1111 |     }
 1112 |     .to_owned()
 1113 | }
 1114 | 
 1115 | fn intake_lifecycle(value: IntakeLifecycle) -> String {
 1116 |     match value {
 1117 |         IntakeLifecycle::Captured => "captured",
 1118 |         IntakeLifecycle::Triaged => "triaged",
 1119 |         IntakeLifecycle::Deferred => "deferred",
 1120 |         IntakeLifecycle::Resolved => "resolved",
 1121 |         IntakeLifecycle::Archived => "archived",
 1122 |     }
 1123 |     .to_owned()
 1124 | }
 1125 | 
 1126 | fn promotion_target_kind(value: PromotionTargetKind) -> String {
 1127 |     match value {
 1128 |         PromotionTargetKind::DraftWork => "draft_work",
 1129 |         PromotionTargetKind::SourceVersion => "source_version",
 1130 |         PromotionTargetKind::MemoryDraft => "memory_draft",
 1131 |     }
 1132 |     .to_owned()
 1133 | }
 1134 | 
 1135 | fn disposition_kind(value: DispositionKind) -> String {
 1136 |     match value {
 1137 |         DispositionKind::AcceptedClosed => "accepted_closed",
 1138 |         DispositionKind::AcceptedCancelled => "accepted_cancelled",
 1139 |         DispositionKind::Deferred => "deferred",
 1140 |         DispositionKind::Replaced => "replaced",
 1141 |     }
 1142 |     .to_owned()
 1143 | }
````
