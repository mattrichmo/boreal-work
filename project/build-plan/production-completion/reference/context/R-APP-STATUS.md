# R-APP-STATUS — crates/application/src/status.rs

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `crates/application/src/status.rs:L1–L679`  
**File SHA-256:** `f7b277b0cc221d58c6fbef39a3113f83128574ad0b89fada5add5df10ca43f8e`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Revisioned read projection, actor context and diagnostics; no separate timer/status policy.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,679p' 'crates/application/src/status.rs'
```

## Exact baseline excerpt

````text
    1 | //! Revisioned, derived work-status read models.
    2 | //!
    3 | //! The application layer owns projection assembly. Callers provide the
    4 | //! canonical rows read from a store at one revision and clock; this module
    5 | //! supplies the graph, attempt, gate, and pagination context to the pure
    6 | //! domain evaluators and never persists the resulting status.
    7 | 
    8 | use boreal_domain::{
    9 |     dependency_satisfied, evaluate_rollup, evaluate_status, ActorContext, Attempt, CurrentAttempt,
   10 |     DependencyPolicy, DerivedStatus, GateId, GateKind, GateRequirement, GateState, Revision,
   11 |     RollupCounts, StatusContext, StatusDecision, TimestampMs, WorkId, WorkItem,
   12 | };
   13 | use boreal_store::{SqliteStore, StatusRecordDiagnostic, StatusWorkRecord};
   14 | use std::{collections::BTreeMap, fmt};
   15 | 
   16 | pub const STATUS_CONTRACT_VERSION: &str = "boreal.work-status/2";
   17 | pub const MAX_STATUS_ROWS: u64 = 1_000;
   18 | 
   19 | /// Canonical read inputs for one work item. The store adapter may populate
   20 | /// these from its read APIs; the derived fields are intentionally absent.
   21 | #[derive(Clone, Debug, Eq, PartialEq)]
   22 | pub struct StatusWorkInput {
   23 |     pub work: WorkItem,
   24 |     pub retry_not_before: Option<TimestampMs>,
   25 |     pub current_attempt: Option<Attempt>,
   26 |     pub gates: Vec<GateRequirement>,
   27 |     pub gate_reasons: Vec<GateReason>,
   28 | }
   29 | 
   30 | impl StatusWorkInput {
   31 |     pub fn new(work: WorkItem) -> Self {
   32 |         let gates = work.acceptance_profile.gates.clone();
   33 |         Self {
   34 |             work,
   35 |             retry_not_before: None,
   36 |             current_attempt: None,
   37 |             gates,
   38 |             gate_reasons: Vec::new(),
   39 |         }
   40 |     }
   41 | }
   42 | 
   43 | /// A retained reason attached to a gate read from the store, such as a failed
   44 | /// or rejected receipt. The domain evaluator still decides whether the gate
   45 | /// is a gap; this type only preserves diagnostic detail for clients.
   46 | #[derive(Clone, Debug, Eq, PartialEq)]
   47 | pub struct GateReason {
   48 |     pub gate_id: GateId,
   49 |     pub receipt_id: Option<String>,
   50 |     pub reason: Option<String>,
   51 | }
   52 | 
   53 | #[derive(Clone, Debug, Eq, PartialEq)]
   54 | pub struct DependencyInput {
   55 |     pub prerequisite_id: WorkId,
   56 |     pub dependent_id: WorkId,
   57 |     pub policy: DependencyPolicy,
   58 | }
   59 | 
   60 | impl DependencyInput {
   61 |     pub fn close_only(prerequisite_id: WorkId, dependent_id: WorkId) -> Self {
   62 |         Self {
   63 |             prerequisite_id,
   64 |             dependent_id,
   65 |             policy: DependencyPolicy::ClosedOnly,
   66 |         }
   67 |     }
   68 | }
   69 | 
   70 | #[derive(Clone, Debug, Eq, PartialEq)]
   71 | pub struct DependencyBlocker {
   72 |     pub work_id: WorkId,
   73 |     pub display_status: DerivedStatus,
   74 |     pub satisfies_default: bool,
   75 |     pub policy: DependencyPolicy,
   76 | }
   77 | 
   78 | #[derive(Clone, Debug, Eq, PartialEq)]
   79 | pub struct GateDiagnostic {
   80 |     pub gate_id: GateId,
   81 |     pub kind: GateKind,
   82 |     pub required: bool,
   83 |     pub state: GateState,
   84 |     pub receipt_id: Option<String>,
   85 |     pub reason: Option<String>,
   86 | }
   87 | 
   88 | #[derive(Clone, Debug, Eq, PartialEq)]
   89 | pub struct GateDiagnostics {
   90 |     pub gates: Vec<GateDiagnostic>,
   91 |     pub missing: Vec<GateId>,
   92 | }
   93 | 
   94 | impl GateDiagnostics {
   95 |     fn from_input(input: &StatusWorkInput) -> Self {
   96 |         let mut gates = input
   97 |             .gates
   98 |             .iter()
   99 |             .map(|gate| {
  100 |                 let detail = input
  101 |                     .gate_reasons
  102 |                     .iter()
  103 |                     .find(|detail| detail.gate_id == gate.id);
  104 |                 GateDiagnostic {
  105 |                     gate_id: gate.id.clone(),
  106 |                     kind: gate.kind,
  107 |                     required: gate.required,
  108 |                     state: gate.state,
  109 |                     receipt_id: detail.and_then(|detail| detail.receipt_id.clone()),
  110 |                     reason: detail.and_then(|detail| detail.reason.clone()),
  111 |                 }
  112 |             })
  113 |             .collect::<Vec<_>>();
  114 |         gates.sort_by(|left, right| left.gate_id.cmp(&right.gate_id));
  115 |         let missing = gates
  116 |             .iter()
  117 |             .filter(|gate| gate.required && gate.state != GateState::Satisfied)
  118 |             .map(|gate| gate.gate_id.clone())
  119 |             .collect();
  120 |         Self { gates, missing }
  121 |     }
  122 | 
  123 |     pub fn open(&self) -> Vec<&GateDiagnostic> {
  124 |         self.gates
  125 |             .iter()
  126 |             .filter(|gate| gate.state != GateState::Satisfied)
  127 |             .collect()
  128 |     }
  129 | 
  130 |     pub fn satisfied(&self) -> Vec<&GateDiagnostic> {
  131 |         self.gates
  132 |             .iter()
  133 |             .filter(|gate| gate.state == GateState::Satisfied)
  134 |             .collect()
  135 |     }
  136 | }
  137 | 
  138 | #[derive(Clone, Debug, Eq, PartialEq)]
  139 | pub struct StatusWork {
  140 |     pub work: WorkItem,
  141 |     pub decision: StatusDecision,
  142 |     pub attempt: Option<Attempt>,
  143 |     pub gates: GateDiagnostics,
  144 |     pub dependency_blockers: Vec<DependencyBlocker>,
  145 | }
  146 | 
  147 | impl StatusWork {
  148 |     pub fn display_status(&self) -> DerivedStatus {
  149 |         self.decision.display_status
  150 |     }
  151 | 
  152 |     pub fn current_attempt(&self) -> Option<&CurrentAttempt> {
  153 |         self.decision.current_attempt.as_ref()
  154 |     }
  155 | }
  156 | 
  157 | #[derive(Clone, Debug, Eq, PartialEq)]
  158 | pub struct StatusSnapshot {
  159 |     pub contract_version: &'static str,
  160 |     pub project_id: boreal_domain::ProjectId,
  161 |     pub project_revision: Revision,
  162 |     pub as_of: TimestampMs,
  163 |     pub limit: u64,
  164 |     pub offset: u64,
  165 |     pub total: u64,
  166 |     pub counts: RollupCounts,
  167 |     pub items: Vec<StatusWork>,
  168 |     pub diagnostics: Vec<StatusRecordDiagnostic>,
  169 |     pub next_status_change_at: Option<TimestampMs>,
  170 | }
  171 | 
  172 | impl StatusSnapshot {
  173 |     pub fn has_more(&self) -> bool {
  174 |         self.offset
  175 |             .saturating_add(self.items.len() as u64)
  176 |             .saturating_add(self.diagnostics.len() as u64)
  177 |             < self.total
  178 |     }
  179 | 
  180 |     pub fn next_offset(&self) -> Option<u64> {
  181 |         self.has_more()
  182 |             .then(|| self.offset.saturating_add(self.items.len() as u64))
  183 |     }
  184 | }
  185 | 
  186 | #[derive(Clone, Debug, Eq, PartialEq)]
  187 | pub enum StatusProjectionError {
  188 |     InvalidPage { limit: u64, max: u64 },
  189 |     DuplicateWork(WorkId),
  190 |     WrongProject { work: WorkId },
  191 |     MissingWork(WorkId),
  192 |     WrongDependencyProject { dependent: WorkId },
  193 | }
  194 | 
  195 | impl fmt::Display for StatusProjectionError {
  196 |     fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
  197 |         match self {
  198 |             Self::InvalidPage { limit, max } => {
  199 |                 write!(
  200 |                     formatter,
  201 |                     "status page limit must be 1..={max}, got {limit}"
  202 |                 )
  203 |             }
  204 |             Self::DuplicateWork(work) => write!(formatter, "duplicate work row: {work}"),
  205 |             Self::WrongProject { work } => {
  206 |                 write!(formatter, "work belongs to another project: {work}")
  207 |             }
  208 |             Self::MissingWork(work) => {
  209 |                 write!(formatter, "dependency references missing work: {work}")
  210 |             }
  211 |             Self::WrongDependencyProject { dependent } => {
  212 |                 write!(
  213 |                     formatter,
  214 |                     "dependency belongs to another project: {dependent}"
  215 |                 )
  216 |             }
  217 |         }
  218 |     }
  219 | }
  220 | 
  221 | impl std::error::Error for StatusProjectionError {}
  222 | 
  223 | /// Materialize a complete revisioned status snapshot, then apply pagination.
  224 | /// Rollup counts and the snapshot timer are deliberately calculated before
  225 | /// pagination so a small page never reports a false project total.
  226 | #[allow(clippy::too_many_arguments)]
  227 | pub fn project_status(
  228 |     project_id: &boreal_domain::ProjectId,
  229 |     actor: &ActorContext,
  230 |     as_of: TimestampMs,
  231 |     project_revision: Revision,
  232 |     inputs: &[StatusWorkInput],
  233 |     dependencies: &[DependencyInput],
  234 |     limit: u64,
  235 |     offset: u64,
  236 | ) -> Result<StatusSnapshot, StatusProjectionError> {
  237 |     if !(1..=MAX_STATUS_ROWS).contains(&limit) {
  238 |         return Err(StatusProjectionError::InvalidPage {
  239 |             limit,
  240 |             max: MAX_STATUS_ROWS,
  241 |         });
  242 |     }
  243 | 
  244 |     let mut by_id = BTreeMap::new();
  245 |     for (index, input) in inputs.iter().enumerate() {
  246 |         if &input.work.project_id != project_id {
  247 |             return Err(StatusProjectionError::WrongProject {
  248 |                 work: input.work.id.clone(),
  249 |             });
  250 |         }
  251 |         if by_id.insert(input.work.id.clone(), index).is_some() {
  252 |             return Err(StatusProjectionError::DuplicateWork(input.work.id.clone()));
  253 |         }
  254 |     }
  255 | 
  256 |     let mut prerequisites = vec![Vec::<(usize, DependencyPolicy)>::new(); inputs.len()];
  257 |     let mut affected_dependents = vec![Vec::<WorkId>::new(); inputs.len()];
  258 |     for dependency in dependencies {
  259 |         let Some(&dependent_index) = by_id.get(&dependency.dependent_id) else {
  260 |             return Err(StatusProjectionError::MissingWork(
  261 |                 dependency.dependent_id.clone(),
  262 |             ));
  263 |         };
  264 |         let Some(&prerequisite_index) = by_id.get(&dependency.prerequisite_id) else {
  265 |             return Err(StatusProjectionError::MissingWork(
  266 |                 dependency.prerequisite_id.clone(),
  267 |             ));
  268 |         };
  269 |         if inputs[dependent_index].work.project_id != *project_id
  270 |             || inputs[prerequisite_index].work.project_id != *project_id
  271 |         {
  272 |             return Err(StatusProjectionError::WrongDependencyProject {
  273 |                 dependent: dependency.dependent_id.clone(),
  274 |             });
  275 |         }
  276 |         prerequisites[dependent_index].push((prerequisite_index, dependency.policy));
  277 |         affected_dependents[prerequisite_index].push(dependency.dependent_id.clone());
  278 |     }
  279 |     for dependents in &mut affected_dependents {
  280 |         dependents.sort();
  281 |         dependents.dedup();
  282 |     }
  283 | 
  284 |     let mut all = Vec::with_capacity(inputs.len());
  285 |     for (index, input) in inputs.iter().enumerate() {
  286 |         let prerequisite_rows = prerequisites[index]
  287 |             .iter()
  288 |             .filter(|(_, policy)| matches!(policy, DependencyPolicy::ClosedOnly))
  289 |             .map(|(prerequisite_index, _)| inputs[*prerequisite_index].work.clone())
  290 |             .collect::<Vec<_>>();
  291 |         let decision = evaluate_status(StatusContext {
  292 |             work: &input.work,
  293 |             prerequisites: &prerequisite_rows,
  294 |             current_attempt: input.current_attempt.as_ref(),
  295 |             gates: &input.gates,
  296 |             actor,
  297 |             as_of,
  298 |             project_revision,
  299 |             retry_not_before: input.retry_not_before,
  300 |             affected_dependents: &affected_dependents[index],
  301 |         });
  302 |         all.push(decision);
  303 |     }
  304 | 
  305 |     let decisions = all.to_vec();
  306 |     let counts = evaluate_rollup(&decisions);
  307 |     let next_status_change_at = decisions
  308 |         .iter()
  309 |         .filter_map(|decision| decision.next_status_change_at)
  310 |         .min();
  311 | 
  312 |     let mut order = (0..inputs.len()).collect::<Vec<_>>();
  313 |     order.sort_by(|left, right| inputs[*left].work.id.cmp(&inputs[*right].work.id));
  314 |     let total = order.len() as u64;
  315 |     let items = order
  316 |         .into_iter()
  317 |         .skip(offset as usize)
  318 |         .take(limit as usize)
  319 |         .map(|index| {
  320 |             let dependency_blockers = prerequisites[index]
  321 |                 .iter()
  322 |                 .filter_map(|(prerequisite_index, policy)| {
  323 |                     let prerequisite = &inputs[*prerequisite_index];
  324 |                     (!dependency_satisfied(*policy, &prerequisite.work)).then(|| {
  325 |                         DependencyBlocker {
  326 |                             work_id: prerequisite.work.id.clone(),
  327 |                             display_status: all[*prerequisite_index].display_status,
  328 |                             satisfies_default: dependency_satisfied(
  329 |                                 DependencyPolicy::ClosedOnly,
  330 |                                 &prerequisite.work,
  331 |                             ),
  332 |                             policy: *policy,
  333 |                         }
  334 |                     })
  335 |                 })
  336 |                 .collect::<Vec<_>>();
  337 |             StatusWork {
  338 |                 work: inputs[index].work.clone(),
  339 |                 decision: all[index].clone(),
  340 |                 attempt: inputs[index].current_attempt.clone(),
  341 |                 gates: GateDiagnostics::from_input(&inputs[index]),
  342 |                 dependency_blockers,
  343 |             }
  344 |         })
  345 |         .collect::<Vec<_>>();
  346 | 
  347 |     Ok(StatusSnapshot {
  348 |         contract_version: STATUS_CONTRACT_VERSION,
  349 |         project_id: project_id.clone(),
  350 |         project_revision,
  351 |         as_of,
  352 |         limit,
  353 |         offset,
  354 |         total,
  355 |         counts,
  356 |         items,
  357 |         diagnostics: Vec::new(),
  358 |         next_status_change_at,
  359 |     })
  360 | }
  361 | 
  362 | pub use project_status as project_status_snapshot;
  363 | 
  364 | /// Convenience constructor for callers that have only a work item and want
  365 | /// its declared acceptance profile to supply the initial gate rows.
  366 | pub fn status_input(work: WorkItem) -> StatusWorkInput {
  367 |     StatusWorkInput::new(work)
  368 | }
  369 | 
  370 | /// Assemble the application projection from one store-owned, revisioned read.
  371 | /// The store supplies canonical rows; this function performs only pure
  372 | /// derivation and pagination, so status reads never write or advance a clock.
  373 | pub fn project_status_from_store(
  374 |     store: &SqliteStore,
  375 |     project_id: &boreal_domain::ProjectId,
  376 |     actor: &ActorContext,
  377 |     as_of: TimestampMs,
  378 |     limit: u64,
  379 |     offset: u64,
  380 | ) -> Result<StatusSnapshot, String> {
  381 |     let (persisted, authorized_actor) = store
  382 |         .read_project_status_for_actor(project_id.as_str(), actor.actor_id.as_str())
  383 |         .map_err(|error| error.to_string())?;
  384 |     let mut diagnostics = persisted.diagnostics.clone();
  385 |     let mut inputs = Vec::with_capacity(persisted.works.len());
  386 |     for row in &persisted.works {
  387 |         match status_input_from_store_row(row) {
  388 |             Ok(input) => inputs.push(input),
  389 |             Err(detail) => diagnostics.push(StatusRecordDiagnostic {
  390 |                 work_id: row.work.id.to_string(),
  391 |                 title: Some(row.work.title.clone()),
  392 |                 code: "corrupt_record".to_owned(),
  393 |                 detail,
  394 |             }),
  395 |         }
  396 |     }
  397 |     let known_work = inputs
  398 |         .iter()
  399 |         .map(|input| input.work.id.clone())
  400 |         .collect::<std::collections::BTreeSet<_>>();
  401 |     let dependencies = persisted
  402 |         .dependencies
  403 |         .iter()
  404 |         .filter_map(|edge| {
  405 |             if known_work.contains(&edge.prerequisite_id)
  406 |                 && known_work.contains(&edge.dependent_id)
  407 |             {
  408 |                 Some(DependencyInput {
  409 |                     prerequisite_id: edge.prerequisite_id.clone(),
  410 |                     dependent_id: edge.dependent_id.clone(),
  411 |                     policy: edge.policy,
  412 |                 })
  413 |             } else {
  414 |                 diagnostics.push(StatusRecordDiagnostic {
  415 |                     work_id: edge.dependent_id.to_string(),
  416 |                     title: None,
  417 |                     code: "orphaned_dependency".to_owned(),
  418 |                     detail: format!(
  419 |                         "dependency references a work record that could not be read (prerequisite {})",
  420 |                         edge.prerequisite_id
  421 |                     ),
  422 |                 });
  423 |                 None
  424 |             }
  425 |         })
  426 |         .collect::<Vec<_>>();
  427 |     let mut snapshot = project_status(
  428 |         project_id,
  429 |         &authorized_actor,
  430 |         as_of,
  431 |         Revision(persisted.revision.0),
  432 |         &inputs,
  433 |         &dependencies,
  434 |         limit,
  435 |         offset,
  436 |     )
  437 |     .map_err(|error| error.to_string())?;
  438 |     snapshot.total = persisted.total;
  439 |     snapshot.diagnostics = diagnostics;
  440 |     Ok(snapshot)
  441 | }
  442 | 
  443 | fn status_input_from_store_row(row: &StatusWorkRecord) -> Result<StatusWorkInput, String> {
  444 |     let mut input = status_input(row.work.clone());
  445 |     input.retry_not_before = row
  446 |         .status_retry_not_before()
  447 |         .map_err(|error| error.to_string())?;
  448 |     input.gates = row
  449 |         .gate_diagnostics
  450 |         .gates
  451 |         .iter()
  452 |         .map(|gate| GateRequirement {
  453 |             id: gate.gate_id.clone().into(),
  454 |             kind: gate.kind,
  455 |             required: gate.required,
  456 |             state: gate.state,
  457 |         })
  458 |         .collect();
  459 |     input.gate_reasons = row
  460 |         .gate_diagnostics
  461 |         .gates
  462 |         .iter()
  463 |         .filter(|gate| gate.receipt_id.is_some() || gate.reason.is_some())
  464 |         .map(|gate| GateReason {
  465 |             gate_id: gate.gate_id.clone().into(),
  466 |             receipt_id: gate.receipt_id.clone(),
  467 |             reason: gate.reason.clone(),
  468 |         })
  469 |         .collect();
  470 |     input.current_attempt = row.status_attempt().map_err(|error| error.to_string())?;
  471 |     Ok(input)
  472 | }
  473 | 
  474 | #[cfg(test)]
  475 | mod tests {
  476 |     use super::*;
  477 |     use boreal_domain::{AcceptanceProfile, ActorId, AttemptId, Fence, ReasonCode, WorkKind};
  478 | 
  479 |     fn actor() -> ActorContext {
  480 |         ActorContext {
  481 |             actor_id: ActorId::new("agent"),
  482 |             role: boreal_domain::ActorRole::Agent,
  483 |         }
  484 |     }
  485 | 
  486 |     fn work(id: &str) -> WorkItem {
  487 |         WorkItem::new("project".into(), id.into(), WorkKind::Task, None, id).open()
  488 |     }
  489 | 
  490 |     fn input(id: &str) -> StatusWorkInput {
  491 |         StatusWorkInput::new(work(id))
  492 |     }
  493 | 
  494 |     #[test]
  495 |     fn queued_and_blocked_remain_distinct() {
  496 |         let mut held = input("blocked");
  497 |         held.work
  498 |             .hard_holds
  499 |             .push(ReasonCode::HardHold("repair".into()));
  500 |         let snapshot = project_status(
  501 |             &"project".into(),
  502 |             &actor(),
  503 |             TimestampMs(10),
  504 |             Revision(7),
  505 |             &[input("ready"), held, input("upstream")],
  506 |             &[DependencyInput::close_only(
  507 |                 "upstream".into(),
  508 |                 "ready".into(),
  509 |             )],
  510 |             10,
  511 |             0,
  512 |         )
  513 |         .unwrap();
  514 |         assert_eq!(snapshot.counts.queued, 1);
  515 |         assert_eq!(snapshot.counts.blocked, 1);
  516 |         let queued = snapshot
  517 |             .items
  518 |             .iter()
  519 |             .find(|item| item.work.id.as_str() == "ready")
  520 |             .unwrap();
  521 |         assert_eq!(queued.display_status(), DerivedStatus::Queued);
  522 |         assert_eq!(queued.dependency_blockers[0].work_id.as_str(), "upstream");
  523 |     }
  524 | 
  525 |     #[test]
  526 |     fn attempt_phases_map_to_claimed_and_in_progress() {
  527 |         let claimed = Attempt::claim(
  528 |             "claimed".into(),
  529 |             AttemptId::new("a-claimed"),
  530 |             "agent".into(),
  531 |             Fence::new(1),
  532 |             TimestampMs(0),
  533 |             Some(100),
  534 |             Some(1_000),
  535 |         )
  536 |         .unwrap();
  537 |         let mut running = Attempt::claim(
  538 |             "running".into(),
  539 |             AttemptId::new("a-running"),
  540 |             "agent".into(),
  541 |             Fence::new(1),
  542 |             TimestampMs(0),
  543 |             Some(100),
  544 |             Some(1_000),
  545 |         )
  546 |         .unwrap();
  547 |         running.accept(TimestampMs(1)).unwrap();
  548 |         running.start().unwrap();
  549 |         let mut claimed_input = input("claimed");
  550 |         claimed_input.current_attempt = Some(claimed);
  551 |         let mut running_input = input("running");
  552 |         running_input.current_attempt = Some(running);
  553 |         let snapshot = project_status(
  554 |             &"project".into(),
  555 |             &actor(),
  556 |             TimestampMs(10),
  557 |             Revision(2),
  558 |             &[claimed_input, running_input],
  559 |             &[],
  560 |             10,
  561 |             0,
  562 |         )
  563 |         .unwrap();
  564 |         assert_eq!(snapshot.counts.claimed, 1);
  565 |         assert_eq!(snapshot.counts.in_progress, 1);
  566 |         assert_eq!(
  567 |             snapshot.items[0].current_attempt().unwrap().fence,
  568 |             Fence::new(1)
  569 |         );
  570 |     }
  571 | 
  572 |     #[test]
  573 |     fn expired_attempt_and_gate_diagnostics_are_retained() {
  574 |         let mut expired = input("expired");
  575 |         expired.current_attempt = Some(
  576 |             Attempt::claim(
  577 |                 "expired".into(),
  578 |                 AttemptId::new("a-expired"),
  579 |                 "agent".into(),
  580 |                 Fence::new(3),
  581 |                 TimestampMs(0),
  582 |                 Some(10),
  583 |                 Some(100),
  584 |             )
  585 |             .unwrap(),
  586 |         );
  587 |         expired.gate_reasons.push(GateReason {
  588 |             gate_id: GateId::new("checkpoint"),
  589 |             receipt_id: Some("receipt-1".into()),
  590 |             reason: Some("failed".into()),
  591 |         });
  592 |         let snapshot = project_status(
  593 |             &"project".into(),
  594 |             &actor(),
  595 |             TimestampMs(10),
  596 |             Revision(4),
  597 |             &[expired],
  598 |             &[],
  599 |             10,
  600 |             0,
  601 |         )
  602 |         .unwrap();
  603 |         let item = &snapshot.items[0];
  604 |         assert_eq!(item.display_status(), DerivedStatus::ExpiredReview);
  605 |         assert_eq!(
  606 |             item.decision.reason_codes[0],
  607 |             ReasonCode::ExpiryReviewRequired
  608 |         );
  609 |         assert_eq!(item.gates.gates[0].receipt_id.as_deref(), Some("receipt-1"));
  610 |         assert_eq!(item.gates.gates[0].reason.as_deref(), Some("failed"));
  611 |         assert_eq!(snapshot.next_status_change_at, None);
  612 |     }
  613 | 
  614 |     #[test]
  615 |     fn counts_cover_all_rows_when_page_is_bounded_and_timer_is_next() {
  616 |         let mut retry = input("retry");
  617 |         retry.retry_not_before = Some(TimestampMs(50));
  618 |         let snapshot = project_status(
  619 |             &"project".into(),
  620 |             &actor(),
  621 |             TimestampMs(10),
  622 |             Revision(9),
  623 |             &[input("a"), retry, input("c")],
  624 |             &[],
  625 |             1,
  626 |             1,
  627 |         )
  628 |         .unwrap();
  629 |         assert_eq!(snapshot.items.len(), 1);
  630 |         assert_eq!(snapshot.total, 3);
  631 |         assert_eq!(snapshot.counts.total, 3);
  632 |         assert_eq!(snapshot.counts.ready, 2);
  633 |         assert_eq!(snapshot.next_status_change_at, Some(TimestampMs(50)));
  634 |         assert!(snapshot.has_more());
  635 |         assert_eq!(snapshot.next_offset(), Some(2));
  636 |     }
  637 | 
  638 |     #[test]
  639 |     fn reviewed_gates_become_awaiting_review_and_open_gate_is_diagnostic() {
  640 |         let mut reviewed = work("reviewed");
  641 |         reviewed.acceptance_profile = AcceptanceProfile::reviewed();
  642 |         let mut item = StatusWorkInput::new(reviewed);
  643 |         for gate in &mut item.gates {
  644 |             if gate.kind != GateKind::Review {
  645 |                 gate.state = GateState::Satisfied;
  646 |             }
  647 |         }
  648 |         let mut attempt = Attempt::claim(
  649 |             "reviewed".into(),
  650 |             AttemptId::new("a-reviewed"),
  651 |             "agent".into(),
  652 |             Fence::new(1),
  653 |             TimestampMs(0),
  654 |             Some(1_000),
  655 |             Some(2_000),
  656 |         )
  657 |         .unwrap();
  658 |         attempt.accept(TimestampMs(1)).unwrap();
  659 |         attempt.start().unwrap();
  660 |         attempt.submit().unwrap();
  661 |         item.current_attempt = Some(attempt);
  662 |         let snapshot = project_status(
  663 |             &"project".into(),
  664 |             &actor(),
  665 |             TimestampMs(2),
  666 |             Revision(11),
  667 |             &[item],
  668 |             &[],
  669 |             10,
  670 |             0,
  671 |         )
  672 |         .unwrap();
  673 |         assert_eq!(
  674 |             snapshot.items[0].display_status(),
  675 |             DerivedStatus::AwaitingReview
  676 |         );
  677 |         assert_eq!(snapshot.items[0].gates.missing, vec![GateId::new("review")]);
  678 |     }
  679 | }
````
