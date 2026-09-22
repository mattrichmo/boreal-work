# R-SERVICE-RECOVERY — crates/service/src/recovery.rs

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `crates/service/src/recovery.rs:L1–L663`  
**File SHA-256:** `1b8224751ea6dc9fb9d15d75da966ef255bd38cc797924e7a859ac4b0a746aa1`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Restart/uncertain-operation recovery and durable state reconciliation.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,663p' 'crates/service/src/recovery.rs'
```

## Exact baseline excerpt

````text
    1 | use crate::QueueTicket;
    2 | use std::collections::BTreeMap;
    3 | use std::fmt;
    4 | use std::sync::{Arc, Mutex};
    5 | use std::time::{Duration, Instant};
    6 | 
    7 | /// The durable boundary a service operation has reached.
    8 | #[derive(Clone, Copy, Debug, Eq, PartialEq)]
    9 | pub enum OperationPhase {
   10 |     Queued,
   11 |     InFlight,
   12 |     Committed,
   13 |     Failed,
   14 |     /// The process restarted after dispatch, so the result must be read back
   15 |     /// by operation ID before a caller can decide whether to retry.
   16 |     Unknown,
   17 | }
   18 | 
   19 | /// Recoverable identity and state for one operation.
   20 | #[derive(Clone, Debug, Eq, PartialEq)]
   21 | pub struct OperationRecord {
   22 |     operation_id: String,
   23 |     phase: OperationPhase,
   24 |     ticket: Option<QueueTicket>,
   25 |     revision: Option<u64>,
   26 |     recovered: bool,
   27 |     updated_at: Instant,
   28 | }
   29 | 
   30 | impl OperationRecord {
   31 |     pub fn operation_id(&self) -> &str {
   32 |         &self.operation_id
   33 |     }
   34 | 
   35 |     pub const fn phase(&self) -> OperationPhase {
   36 |         self.phase
   37 |     }
   38 | 
   39 |     pub const fn ticket(&self) -> Option<QueueTicket> {
   40 |         self.ticket
   41 |     }
   42 | 
   43 |     pub const fn revision(&self) -> Option<u64> {
   44 |         self.revision
   45 |     }
   46 | 
   47 |     pub const fn was_recovered(&self) -> bool {
   48 |         self.recovered
   49 |     }
   50 | }
   51 | 
   52 | /// A bounded-process restart report. Queued work remains queued; in-flight
   53 | /// work is deliberately made unknown rather than replayed blindly.
   54 | #[derive(Clone, Debug, Eq, PartialEq)]
   55 | pub struct RecoveryReport {
   56 |     pub queued: Vec<String>,
   57 |     pub unknown: Vec<String>,
   58 |     pub reconciled: Vec<String>,
   59 | }
   60 | 
   61 | /// A reference to an external execution admitted by the application before a
   62 | /// service process stopped. The service carries this opaque identity across a
   63 | /// restart; it does not infer that a PID is still the same process.
   64 | #[derive(Clone, Debug, Eq, PartialEq)]
   65 | pub struct ExecutionReference {
   66 |     pub run_id: String,
   67 |     pub process_id: Option<u32>,
   68 |     pub process_start_token: Option<String>,
   69 |     pub artifact_ref: Option<String>,
   70 | }
   71 | 
   72 | impl ExecutionReference {
   73 |     pub fn new(run_id: impl Into<String>) -> Self {
   74 |         Self {
   75 |             run_id: run_id.into(),
   76 |             process_id: None,
   77 |             process_start_token: None,
   78 |             artifact_ref: None,
   79 |         }
   80 |     }
   81 | 
   82 |     pub fn with_process(mut self, process_id: u32, start_token: impl Into<String>) -> Self {
   83 |         self.process_id = Some(process_id);
   84 |         self.process_start_token = Some(start_token.into());
   85 |         self
   86 |     }
   87 | 
   88 |     pub fn with_artifact(mut self, artifact_ref: impl Into<String>) -> Self {
   89 |         self.artifact_ref = Some(artifact_ref.into());
   90 |         self
   91 |     }
   92 | }
   93 | 
   94 | /// A storage-neutral snapshot of an operation that was durable before the
   95 | /// service process started.
   96 | #[derive(Clone, Debug, Eq, PartialEq)]
   97 | pub struct RecoveryEntry {
   98 |     pub operation_id: String,
   99 |     pub phase: OperationPhase,
  100 |     pub revision: Option<u64>,
  101 |     pub execution: Option<ExecutionReference>,
  102 | }
  103 | 
  104 | impl RecoveryEntry {
  105 |     pub fn new(
  106 |         operation_id: impl Into<String>,
  107 |         phase: OperationPhase,
  108 |         revision: Option<u64>,
  109 |     ) -> Self {
  110 |         Self {
  111 |             operation_id: operation_id.into(),
  112 |             phase,
  113 |             revision,
  114 |             execution: None,
  115 |         }
  116 |     }
  117 | 
  118 |     pub fn with_execution(mut self, execution: ExecutionReference) -> Self {
  119 |         self.execution = Some(execution);
  120 |         self
  121 |     }
  122 | }
  123 | 
  124 | /// Result of asking the durable application adapter to reconcile an admitted
  125 | /// external execution. `Unknown` is the safe default and must not be retried
  126 | /// automatically. A known terminal result is valid only when the adapter has
  127 | /// observed and durably recorded that result.
  128 | #[derive(Clone, Debug, Eq, PartialEq)]
  129 | pub enum RecoveryDisposition {
  130 |     Unknown { reason: String },
  131 |     Committed { revision: Option<u64> },
  132 |     Failed { reason: String },
  133 | }
  134 | 
  135 | /// Error returned by an application/store recovery adapter.
  136 | #[derive(Clone, Debug, Eq, PartialEq)]
  137 | pub struct RecoveryBackendError {
  138 |     message: String,
  139 | }
  140 | 
  141 | impl RecoveryBackendError {
  142 |     pub fn new(message: impl Into<String>) -> Self {
  143 |         Self {
  144 |             message: message.into(),
  145 |         }
  146 |     }
  147 | 
  148 |     pub fn message(&self) -> &str {
  149 |         &self.message
  150 |     }
  151 | }
  152 | 
  153 | impl fmt::Display for RecoveryBackendError {
  154 |     fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
  155 |         formatter.write_str(&self.message)
  156 |     }
  157 | }
  158 | 
  159 | impl std::error::Error for RecoveryBackendError {}
  160 | 
  161 | /// Adapter boundary for durable operation recovery.
  162 | ///
  163 | /// The service does not inspect a database or decide application policy. An
  164 | /// application adapter supplies incomplete durable operations and persists
  165 | /// the transition of an in-flight operation to `Unknown` before the host
  166 | /// accepts new work. Implementations should use a short transaction and must
  167 | /// never delete or force-complete a live owner's attempt.
  168 | pub trait RecoveryBackend: Send + Sync + 'static {
  169 |     fn load_incomplete(&self) -> Result<Vec<RecoveryEntry>, RecoveryBackendError>;
  170 | 
  171 |     fn mark_unknown(&self, operation_id: &str) -> Result<(), RecoveryBackendError>;
  172 | 
  173 |     /// Reconcile an admitted operation using application-owned durable facts
  174 |     /// and any external execution reference. The default is deliberately
  175 |     /// conservative: without an adapter-specific observation, the operation
  176 |     /// remains unknown and must be read back by operation ID.
  177 |     fn reconcile(
  178 |         &self,
  179 |         _entry: &RecoveryEntry,
  180 |     ) -> Result<RecoveryDisposition, RecoveryBackendError> {
  181 |         Ok(RecoveryDisposition::Unknown {
  182 |             reason: "no durable execution reconciliation was available".to_owned(),
  183 |         })
  184 |     }
  185 | }
  186 | 
  187 | #[derive(Clone, Debug, Eq, PartialEq)]
  188 | pub enum OperationError {
  189 |     InvalidId,
  190 |     Duplicate(OperationRecord),
  191 |     HydrationConflict { operation_id: String },
  192 | }
  193 | 
  194 | /// The result of process-side admission.
  195 | ///
  196 | /// A terminal record is only a transient hint that an operation has already
  197 | /// reached the application. It is deliberately admitted again so the
  198 | /// application can perform its durable, request-digest-checked replay. The
  199 | /// service must reject only active or uncertain work here.
  200 | #[derive(Clone, Debug, Eq, PartialEq)]
  201 | pub(crate) enum OperationAdmission {
  202 |     New,
  203 |     TerminalReplay(OperationRecord),
  204 | }
  205 | 
  206 | impl fmt::Display for OperationError {
  207 |     fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
  208 |         match self {
  209 |             Self::InvalidId => formatter.write_str("operation ID must be non-empty and safe"),
  210 |             Self::Duplicate(record) => write!(
  211 |                 formatter,
  212 |                 "operation {:?} already exists in phase {:?}",
  213 |                 record.operation_id, record.phase
  214 |             ),
  215 |             Self::HydrationConflict { operation_id } => {
  216 |                 write!(
  217 |                     formatter,
  218 |                     "durable recovery conflicts for operation {operation_id:?}"
  219 |                 )
  220 |             }
  221 |         }
  222 |     }
  223 | }
  224 | 
  225 | impl std::error::Error for OperationError {}
  226 | 
  227 | /// In-memory operation journal used by the service boundary.
  228 | ///
  229 | /// The application/store owns durable operation results. This journal owns
  230 | /// the process-side recovery state needed to hand those results back to the
  231 | /// application for readback after a service restart.
  232 | #[derive(Clone, Debug)]
  233 | pub struct OperationRecovery {
  234 |     records: Arc<Mutex<BTreeMap<String, OperationRecord>>>,
  235 |     max_unknown_records: usize,
  236 |     max_terminal_records: usize,
  237 |     unknown_retention: Duration,
  238 |     terminal_retention: Duration,
  239 | }
  240 | 
  241 | impl Default for OperationRecovery {
  242 |     fn default() -> Self {
  243 |         Self::with_limits(1024, Duration::from_secs(5 * 60))
  244 |     }
  245 | }
  246 | 
  247 | impl OperationRecovery {
  248 |     pub fn new() -> Self {
  249 |         Self::default()
  250 |     }
  251 | 
  252 |     /// Configure the bounded process-side retention for uncertain operations.
  253 |     /// Durable operation facts remain owned by the application/store; this
  254 |     /// limit only controls the host's transient recovery hints.
  255 |     pub fn with_limits(max_unknown_records: usize, unknown_retention: Duration) -> Self {
  256 |         Self {
  257 |             records: Arc::new(Mutex::new(BTreeMap::new())),
  258 |             max_unknown_records: max_unknown_records.max(1),
  259 |             max_terminal_records: max_unknown_records.max(1),
  260 |             unknown_retention,
  261 |             terminal_retention: unknown_retention,
  262 |         }
  263 |     }
  264 | 
  265 |     pub fn register(&self, operation_id: impl Into<String>) -> Result<(), OperationError> {
  266 |         let operation_id = operation_id.into();
  267 |         if operation_id.trim().is_empty() || operation_id.chars().any(char::is_control) {
  268 |             return Err(OperationError::InvalidId);
  269 |         }
  270 |         let mut records = self
  271 |             .records
  272 |             .lock()
  273 |             .expect("operation journal mutex poisoned");
  274 |         prune_transient(
  275 |             &mut records,
  276 |             self.max_unknown_records,
  277 |             self.max_terminal_records,
  278 |             self.unknown_retention,
  279 |             self.terminal_retention,
  280 |         );
  281 |         if let Some(record) = records.get(&operation_id) {
  282 |             return Err(OperationError::Duplicate(record.clone()));
  283 |         }
  284 |         records.insert(
  285 |             operation_id.clone(),
  286 |             OperationRecord {
  287 |                 operation_id,
  288 |                 phase: OperationPhase::Queued,
  289 |                 ticket: None,
  290 |                 revision: None,
  291 |                 recovered: false,
  292 |                 updated_at: Instant::now(),
  293 |             },
  294 |         );
  295 |         Ok(())
  296 |     }
  297 | 
  298 |     /// Admit a request while keeping active ownership separate from durable
  299 |     /// operation identity. Active/unknown records are rejected; terminal
  300 |     /// records are reset to an active transient state and dispatched so the
  301 |     /// application can return its durable replay or a digest conflict.
  302 |     pub(crate) fn admit(
  303 |         &self,
  304 |         operation_id: impl Into<String>,
  305 |     ) -> Result<OperationAdmission, OperationError> {
  306 |         let operation_id = operation_id.into();
  307 |         validate_operation_id(&operation_id)?;
  308 |         let mut records = self
  309 |             .records
  310 |             .lock()
  311 |             .expect("operation journal mutex poisoned");
  312 |         prune_transient(
  313 |             &mut records,
  314 |             self.max_unknown_records,
  315 |             self.max_terminal_records,
  316 |             self.unknown_retention,
  317 |             self.terminal_retention,
  318 |         );
  319 |         if let Some(record) = records.get_mut(&operation_id) {
  320 |             match record.phase {
  321 |                 OperationPhase::Queued | OperationPhase::InFlight | OperationPhase::Unknown => {
  322 |                     return Err(OperationError::Duplicate(record.clone()))
  323 |                 }
  324 |                 OperationPhase::Committed | OperationPhase::Failed => {
  325 |                     let previous = record.clone();
  326 |                     record.phase = OperationPhase::Queued;
  327 |                     record.ticket = None;
  328 |                     record.revision = None;
  329 |                     record.recovered = false;
  330 |                     record.updated_at = Instant::now();
  331 |                     return Ok(OperationAdmission::TerminalReplay(previous));
  332 |                 }
  333 |             }
  334 |         }
  335 |         records.insert(
  336 |             operation_id.clone(),
  337 |             OperationRecord {
  338 |                 operation_id,
  339 |                 phase: OperationPhase::Queued,
  340 |                 ticket: None,
  341 |                 revision: None,
  342 |                 recovered: false,
  343 |                 updated_at: Instant::now(),
  344 |             },
  345 |         );
  346 |         Ok(OperationAdmission::New)
  347 |     }
  348 | 
  349 |     /// Hydrate process-side state from the application's durable operation
  350 |     /// projection before a host begins accepting requests.
  351 |     pub fn hydrate<I>(&self, entries: I) -> Result<(), OperationError>
  352 |     where
  353 |         I: IntoIterator<Item = RecoveryEntry>,
  354 |     {
  355 |         let mut records = self
  356 |             .records
  357 |             .lock()
  358 |             .expect("operation journal mutex poisoned");
  359 |         for entry in entries {
  360 |             validate_operation_id(&entry.operation_id)?;
  361 |             let hydrated = OperationRecord {
  362 |                 operation_id: entry.operation_id.clone(),
  363 |                 phase: entry.phase,
  364 |                 ticket: None,
  365 |                 revision: entry.revision,
  366 |                 recovered: false,
  367 |                 updated_at: Instant::now(),
  368 |             };
  369 |             if let Some(existing) = records.get(&entry.operation_id) {
  370 |                 if existing.phase != hydrated.phase || existing.revision != hydrated.revision {
  371 |                     return Err(OperationError::HydrationConflict {
  372 |                         operation_id: entry.operation_id,
  373 |                     });
  374 |                 }
  375 |                 continue;
  376 |             }
  377 |             records.insert(entry.operation_id, hydrated);
  378 |         }
  379 |         Ok(())
  380 |     }
  381 | 
  382 |     pub(crate) fn set_ticket(&self, operation_id: &str, ticket: QueueTicket) {
  383 |         if let Some(record) = self
  384 |             .records
  385 |             .lock()
  386 |             .expect("operation journal mutex poisoned")
  387 |             .get_mut(operation_id)
  388 |         {
  389 |             record.ticket = Some(ticket);
  390 |             record.updated_at = Instant::now();
  391 |         }
  392 |     }
  393 | 
  394 |     pub(crate) fn mark_in_flight(&self, operation_id: &str) {
  395 |         if let Some(record) = self
  396 |             .records
  397 |             .lock()
  398 |             .expect("operation journal mutex poisoned")
  399 |             .get_mut(operation_id)
  400 |         {
  401 |             record.phase = OperationPhase::InFlight;
  402 |             record.updated_at = Instant::now();
  403 |         }
  404 |     }
  405 | 
  406 |     pub(crate) fn mark_committed(&self, operation_id: &str, revision: Option<u64>) {
  407 |         if let Some(record) = self
  408 |             .records
  409 |             .lock()
  410 |             .expect("operation journal mutex poisoned")
  411 |             .get_mut(operation_id)
  412 |         {
  413 |             record.phase = OperationPhase::Committed;
  414 |             record.revision = revision;
  415 |             record.updated_at = Instant::now();
  416 |         }
  417 |     }
  418 | 
  419 |     pub(crate) fn mark_failed(&self, operation_id: &str) {
  420 |         if let Some(record) = self
  421 |             .records
  422 |             .lock()
  423 |             .expect("operation journal mutex poisoned")
  424 |             .get_mut(operation_id)
  425 |         {
  426 |             record.phase = OperationPhase::Failed;
  427 |             record.updated_at = Instant::now();
  428 |         }
  429 |     }
  430 | 
  431 |     pub(crate) fn mark_unknown(&self, operation_id: &str) {
  432 |         let mut records = self
  433 |             .records
  434 |             .lock()
  435 |             .expect("operation journal mutex poisoned");
  436 |         if let Some(record) = records.get_mut(operation_id) {
  437 |             record.phase = OperationPhase::Unknown;
  438 |             record.updated_at = Instant::now();
  439 |         }
  440 |         prune_transient(
  441 |             &mut records,
  442 |             self.max_unknown_records,
  443 |             self.max_terminal_records,
  444 |             self.unknown_retention,
  445 |             self.terminal_retention,
  446 |         );
  447 |     }
  448 | 
  449 |     pub(crate) fn remove(&self, operation_id: &str) {
  450 |         self.records
  451 |             .lock()
  452 |             .expect("operation journal mutex poisoned")
  453 |             .remove(operation_id);
  454 |     }
  455 | 
  456 |     pub fn get(&self, operation_id: &str) -> Option<OperationRecord> {
  457 |         let mut records = self
  458 |             .records
  459 |             .lock()
  460 |             .expect("operation journal mutex poisoned");
  461 |         prune_transient(
  462 |             &mut records,
  463 |             self.max_unknown_records,
  464 |             self.max_terminal_records,
  465 |             self.unknown_retention,
  466 |             self.terminal_retention,
  467 |         );
  468 |         records.get(operation_id).cloned()
  469 |     }
  470 | 
  471 |     pub fn records(&self) -> Vec<OperationRecord> {
  472 |         let mut records = self
  473 |             .records
  474 |             .lock()
  475 |             .expect("operation journal mutex poisoned");
  476 |         prune_transient(
  477 |             &mut records,
  478 |             self.max_unknown_records,
  479 |             self.max_terminal_records,
  480 |             self.unknown_retention,
  481 |             self.terminal_retention,
  482 |         );
  483 |         records.values().cloned().collect()
  484 |     }
  485 | 
  486 |     /// Apply the process restart rule and return the states requiring action.
  487 |     pub fn recover(&self) -> RecoveryReport {
  488 |         let mut records = self
  489 |             .records
  490 |             .lock()
  491 |             .expect("operation journal mutex poisoned");
  492 |         let mut report = RecoveryReport {
  493 |             queued: Vec::new(),
  494 |             unknown: Vec::new(),
  495 |             reconciled: Vec::new(),
  496 |         };
  497 |         for record in records.values_mut() {
  498 |             match record.phase {
  499 |                 OperationPhase::Queued => report.queued.push(record.operation_id.clone()),
  500 |                 OperationPhase::InFlight => {
  501 |                     record.phase = OperationPhase::Unknown;
  502 |                     record.recovered = true;
  503 |                     record.updated_at = Instant::now();
  504 |                     report.unknown.push(record.operation_id.clone());
  505 |                 }
  506 |                 OperationPhase::Committed | OperationPhase::Failed => {}
  507 |                 OperationPhase::Unknown => report.unknown.push(record.operation_id.clone()),
  508 |             }
  509 |         }
  510 |         prune_transient(
  511 |             &mut records,
  512 |             self.max_unknown_records,
  513 |             self.max_terminal_records,
  514 |             self.unknown_retention,
  515 |             self.terminal_retention,
  516 |         );
  517 |         report
  518 |     }
  519 | 
  520 |     pub(crate) fn mark_reconciled(&self, operation_id: &str, disposition: &RecoveryDisposition) {
  521 |         match disposition {
  522 |             RecoveryDisposition::Committed { revision } => {
  523 |                 self.mark_committed(operation_id, *revision)
  524 |             }
  525 |             RecoveryDisposition::Failed { .. } => self.mark_failed(operation_id),
  526 |             RecoveryDisposition::Unknown { .. } => self.mark_unknown(operation_id),
  527 |         }
  528 |     }
  529 | }
  530 | 
  531 | fn prune_transient(
  532 |     records: &mut BTreeMap<String, OperationRecord>,
  533 |     max_unknown_records: usize,
  534 |     max_terminal_records: usize,
  535 |     unknown_retention: Duration,
  536 |     terminal_retention: Duration,
  537 | ) {
  538 |     let now = Instant::now();
  539 |     records.retain(|_, record| match record.phase {
  540 |         OperationPhase::Unknown => {
  541 |             now.saturating_duration_since(record.updated_at) <= unknown_retention
  542 |         }
  543 |         OperationPhase::Committed | OperationPhase::Failed => {
  544 |             now.saturating_duration_since(record.updated_at) <= terminal_retention
  545 |         }
  546 |         OperationPhase::Queued | OperationPhase::InFlight => true,
  547 |     });
  548 |     let mut unknown = records
  549 |         .values()
  550 |         .filter(|record| record.phase == OperationPhase::Unknown)
  551 |         .map(|record| (record.updated_at, record.operation_id.clone()))
  552 |         .collect::<Vec<_>>();
  553 |     unknown.sort_by_key(|(updated_at, _)| *updated_at);
  554 |     let remove_count = unknown.len().saturating_sub(max_unknown_records);
  555 |     for (_, operation_id) in unknown.into_iter().take(remove_count) {
  556 |         records.remove(&operation_id);
  557 |     }
  558 |     let mut terminal = records
  559 |         .values()
  560 |         .filter(|record| {
  561 |             matches!(
  562 |                 record.phase,
  563 |                 OperationPhase::Committed | OperationPhase::Failed
  564 |             )
  565 |         })
  566 |         .map(|record| (record.updated_at, record.operation_id.clone()))
  567 |         .collect::<Vec<_>>();
  568 |     terminal.sort_by_key(|(updated_at, _)| *updated_at);
  569 |     let remove_count = terminal.len().saturating_sub(max_terminal_records);
  570 |     for (_, operation_id) in terminal.into_iter().take(remove_count) {
  571 |         records.remove(&operation_id);
  572 |     }
  573 | }
  574 | 
  575 | fn validate_operation_id(operation_id: &str) -> Result<(), OperationError> {
  576 |     if operation_id.trim().is_empty() || operation_id.chars().any(char::is_control) {
  577 |         Err(OperationError::InvalidId)
  578 |     } else {
  579 |         Ok(())
  580 |     }
  581 | }
  582 | 
  583 | #[cfg(test)]
  584 | mod tests {
  585 |     use super::*;
  586 | 
  587 |     #[test]
  588 |     fn restart_preserves_queued_and_fences_in_flight_work_for_readback() {
  589 |         let journal = OperationRecovery::new();
  590 |         journal.register("queued").unwrap();
  591 |         journal.register("running").unwrap();
  592 |         journal.mark_in_flight("running");
  593 | 
  594 |         let report = journal.recover();
  595 |         assert_eq!(report.queued, vec!["queued"]);
  596 |         assert_eq!(report.unknown, vec!["running"]);
  597 |         assert_eq!(
  598 |             journal.get("queued").unwrap().phase(),
  599 |             OperationPhase::Queued
  600 |         );
  601 |         let running = journal.get("running").unwrap();
  602 |         assert_eq!(running.phase(), OperationPhase::Unknown);
  603 |         assert!(running.was_recovered());
  604 |     }
  605 | 
  606 |     #[test]
  607 |     fn committed_operation_ids_are_not_admitted_twice() {
  608 |         let journal = OperationRecovery::new();
  609 |         journal.register("op-1").unwrap();
  610 |         journal.mark_committed("op-1", Some(42));
  611 |         assert!(matches!(
  612 |             journal.register("op-1"),
  613 |             Err(OperationError::Duplicate(record))
  614 |                 if record.phase() == OperationPhase::Committed && record.revision() == Some(42)
  615 |         ));
  616 |     }
  617 | 
  618 |     #[test]
  619 |     fn terminal_admission_is_replayable_but_active_admission_is_rejected() {
  620 |         let journal = OperationRecovery::new();
  621 |         assert_eq!(journal.admit("op-replay").unwrap(), OperationAdmission::New);
  622 |         assert!(matches!(
  623 |             journal.admit("op-replay"),
  624 |             Err(OperationError::Duplicate(record))
  625 |                 if record.phase() == OperationPhase::Queued
  626 |         ));
  627 | 
  628 |         journal.mark_committed("op-replay", Some(7));
  629 |         assert!(matches!(
  630 |             journal.admit("op-replay"),
  631 |             Ok(OperationAdmission::TerminalReplay(record))
  632 |                 if record.phase() == OperationPhase::Committed
  633 |                     && record.revision() == Some(7)
  634 |         ));
  635 |         assert_eq!(
  636 |             journal.get("op-replay").unwrap().phase(),
  637 |             OperationPhase::Queued
  638 |         );
  639 |     }
  640 | 
  641 |     #[test]
  642 |     fn uncertain_transient_records_are_bounded_and_expire() {
  643 |         let journal = OperationRecovery::with_limits(2, Duration::from_millis(1));
  644 |         for index in 0..4 {
  645 |             journal.register(format!("op-unknown-{index}")).unwrap();
  646 |             journal.mark_unknown(&format!("op-unknown-{index}"));
  647 |         }
  648 |         assert!(journal.records().len() <= 2);
  649 | 
  650 |         std::thread::sleep(Duration::from_millis(3));
  651 |         assert!(journal.records().is_empty());
  652 |     }
  653 | 
  654 |     #[test]
  655 |     fn completed_transient_records_are_bounded_when_a_caller_keeps_the_journal() {
  656 |         let journal = OperationRecovery::with_limits(2, Duration::from_secs(60));
  657 |         for index in 0..4 {
  658 |             journal.register(format!("op-completed-{index}")).unwrap();
  659 |             journal.mark_committed(&format!("op-completed-{index}"), Some(index));
  660 |         }
  661 |         assert_eq!(journal.records().len(), 2);
  662 |     }
  663 | }
````
