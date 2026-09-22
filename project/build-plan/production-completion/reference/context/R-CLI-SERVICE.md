# R-CLI-SERVICE — crates/cli/src/service.rs

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `crates/cli/src/service.rs:L1–L260`  
**File SHA-256:** `0e91f462908bf9d6e50c24e80f70002cb9a0cd67b91915e7e59d66cb1b907897`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

CLI/service composition and request mapping; audit direct/offline adapters as well as socket routes.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,260p' 'crates/cli/src/service.rs'
```

## Exact baseline excerpt

````text
    1 | //! CLI-owned service process and Unix-socket client adapter.
    2 | //!
    3 | //! The service crate deliberately stays independent of SQLite and the
    4 | //! application crate. This module is the composition point for the CLI: the
    5 | //! long-lived process owns a store-backed application handler, while client
    6 | //! commands retain the same versioned protocol envelope as direct commands.
    7 | 
    8 | use super::*;
    9 | 
   10 | pub(crate) fn supports(parsed: &ParsedCommand) -> bool {
   11 |     let path = &parsed.path;
   12 |     // A lower-level handler is not enough to advertise a public service
   13 |     // route. Registry gaps remain fail-closed until their DTO and operation
   14 |     // contract are complete; explicit --socket must not bypass that status.
   15 |     if crate::command_registry::is_unavailable_path(path) {
   16 |         return false;
   17 |     }
   18 |     matches!(
   19 |         path.iter()
   20 |             .map(String::as_str)
   21 |             .collect::<Vec<_>>()
   22 |             .as_slice(),
   23 |         ["init"]
   24 |             | ["status"]
   25 |             | ["prime"]
   26 |             | ["work", "show"]
   27 |             | ["work", "create"]
   28 |             | ["work", "edit"]
   29 |             | ["work", "hold", "add"]
   30 |             | ["work", "hold", "resolve"]
   31 |             | ["work", "dispatch", "set"]
   32 |             | ["dep", "add"]
   33 |             | ["dep", "remove"]
   34 |             | ["dep", "tree"]
   35 |             | ["dep", "cycles"]
   36 |             | ["doctor"]
   37 |             | ["work", "claim"]
   38 |             | ["work", "accept"]
   39 |             | ["work", "heartbeat"]
   40 |             | ["work", "renew"]
   41 |             | ["work", "release"]
   42 |             | ["work", "finish"]
   43 |             | ["agent", "start"]
   44 |             | ["agent", "status"]
   45 |             | ["agent", "guide"]
   46 |             | ["agent", "resume"]
   47 |             | ["agent", "next"]
   48 |             | ["next"]
   49 |             | ["agent", "heartbeat"]
   50 |             | ["agent", "renew"]
   51 |             | ["agent", "release"]
   52 |             | ["session", "start"]
   53 |             | ["session", "show"]
   54 |             | ["session", "end"]
   55 |             | ["evidence", "run"]
   56 |             | ["operation", "show"]
   57 |     ) || (path == &["agent".to_owned(), "finish".to_owned()]
   58 |         && (parsed.options.release || (parsed.options.close && parsed.options.receipt.is_some())))
   59 |         || (path == &["evidence".to_owned(), "add".to_owned()] && parsed.options.receipt.is_some())
   60 | }
   61 | 
   62 | #[cfg(not(unix))]
   63 | pub(crate) fn run_service(
   64 |     _parsed: &ParsedCommand,
   65 |     _operation: &str,
   66 | ) -> Result<CliResult, CliError> {
   67 |     Err(CliError::with(
   68 |         ErrorCode::UnsupportedPlatform,
   69 |         ApplicationOutcome::Failed,
   70 |         "the local service requires Unix-domain sockets",
   71 |     ))
   72 | }
   73 | 
   74 | #[cfg(not(unix))]
   75 | pub(crate) fn request(_parsed: &ParsedCommand, _operation: &str) -> Result<CliResult, CliError> {
   76 |     Err(CliError::with(
   77 |         ErrorCode::UnsupportedPlatform,
   78 |         ApplicationOutcome::Failed,
   79 |         "the local service requires Unix-domain sockets",
   80 |     ))
   81 | }
   82 | 
   83 | #[cfg(unix)]
   84 | mod unix {
   85 |     use super::*;
   86 |     use boreal_application::{project_status_from_store, AttemptLifecycleAdapter, AttemptSnapshot};
   87 |     use boreal_domain::{ActorContext, ActorRole, ReasonCode};
   88 |     use boreal_protocol::{schema, Envelope, ProtocolError as WireError, TransportOutcome};
   89 |     use boreal_service::{
   90 |         ApplicationCommandHandler, ApplicationRequest, ApplicationResponse,
   91 |         ConcurrentApplicationCommandHandler, JsonRequest, OperationPhase, RecoveryBackend,
   92 |         RecoveryBackendError, RecoveryEntry, ServiceHost, ServiceHostConfig, ServiceHostHooks,
   93 |         TimerRegistry, TransportConfig, TransportError, UnixSocketClient, APPLICATION_API_VERSION,
   94 |         APPLICATION_SCHEMA_VERSION,
   95 |     };
   96 |     use boreal_store::{
   97 |         OperationOutcome as StoreOperationOutcome, OperationRecord, ReceiptAttestation,
   98 |         ReceiptOutcome, ReceiptRecord,
   99 |     };
  100 |     use std::os::unix::{fs::FileTypeExt, net::UnixStream};
  101 | 
  102 |     const SERVICE_REQUEST_ID: &str = "cli-service-request";
  103 | 
  104 |     #[derive(Clone, Debug)]
  105 |     struct SqliteRecoveryBackend {
  106 |         database: PathBuf,
  107 |     }
  108 | 
  109 |     impl RecoveryBackend for SqliteRecoveryBackend {
  110 |         fn load_incomplete(&self) -> Result<Vec<RecoveryEntry>, RecoveryBackendError> {
  111 |             let store = SqliteStore::open(&self.database, SCHEMA)
  112 |                 .map_err(|error| RecoveryBackendError::new(error.to_string()))?;
  113 |             store
  114 |                 .list_incomplete_evidence_executions()
  115 |                 .map(|records| {
  116 |                     records
  117 |                         .into_iter()
  118 |                         .map(|record| {
  119 |                             RecoveryEntry::new(record.operation_id, OperationPhase::InFlight, None)
  120 |                         })
  121 |                         .collect()
  122 |                 })
  123 |                 .map_err(|error| RecoveryBackendError::new(error.to_string()))
  124 |         }
  125 | 
  126 |         fn mark_unknown(&self, operation_id: &str) -> Result<(), RecoveryBackendError> {
  127 |             let store = SqliteStore::open(&self.database, SCHEMA)
  128 |                 .map_err(|error| RecoveryBackendError::new(error.to_string()))?;
  129 |             store
  130 |                 .mark_evidence_execution_unknown(operation_id, "service_restart_recovery")
  131 |                 .map(|_| ())
  132 |                 .map_err(|error| RecoveryBackendError::new(error.to_string()))
  133 |         }
  134 |     }
  135 | 
  136 |     /// The host owns timer delivery and stop intent; this adapter deliberately
  137 |     /// does not perform lifecycle transitions from a callback. A deadline
  138 |     /// creates a stop request in the service host, while the application/store
  139 |     /// still require an executor acknowledgement before expiry is terminal.
  140 |     #[derive(Clone, Debug, Default)]
  141 |     struct ProductionServiceHooks;
  142 | 
  143 |     impl ServiceHostHooks for ProductionServiceHooks {}
  144 | 
  145 |     fn schedule_current_attempt_deadlines(database: &Path, timers: &TimerRegistry) {
  146 |         let Ok(store) = SqliteStore::open(database, SCHEMA) else {
  147 |             return;
  148 |         };
  149 |         let Ok(projects) = store.list_project_ids() else {
  150 |             return;
  151 |         };
  152 |         for project in projects {
  153 |             let mut offset = 0_u64;
  154 |             loop {
  155 |                 let Ok(page) = store.list_work(&project, 1_000, offset) else {
  156 |                     break;
  157 |                 };
  158 |                 for work in &page.items {
  159 |                     let Ok(Some(attempt)) = store.current_attempt_for_work(&project, &work.work_id)
  160 |                     else {
  161 |                         continue;
  162 |                     };
  163 |                     if attempt.phase.is_terminal() {
  164 |                         continue;
  165 |                     }
  166 |                     let Some(deadline_ms) = [
  167 |                         super::super::parse_stamp_ms(&attempt.lease_deadline),
  168 |                         super::super::parse_stamp_ms(&attempt.hard_deadline),
  169 |                     ]
  170 |                     .into_iter()
  171 |                     .flatten()
  172 |                     .min() else {
  173 |                         continue;
  174 |                     };
  175 |                     let delay_ms = deadline_ms.saturating_sub(super::super::now_ms_u64());
  176 |                     let key = format!(
  177 |                         "attempt-deadline:{project}:{}:{}",
  178 |                         attempt.attempt_id, attempt.fence
  179 |                     );
  180 |                     let _ = timers.schedule(key, Instant::now() + Duration::from_millis(delay_ms));
  181 |                 }
  182 |                 if page.items.len() < 1_000 {
  183 |                     break;
  184 |                 }
  185 |                 offset = offset.saturating_add(page.items.len() as u64);
  186 |             }
  187 |         }
  188 |     }
  189 | 
  190 |     pub(super) fn schedule_deadline_from_response(
  191 |         timers: &TimerRegistry,
  192 |         request_data: &Value,
  193 |         response: &ApplicationResponse,
  194 |     ) {
  195 |         if !matches!(
  196 |             request_data.get("command").and_then(Value::as_str),
  197 |             Some("claim" | "start" | "renew")
  198 |         ) {
  199 |             return;
  200 |         }
  201 |         let Ok(envelope) = serde_json::from_str::<Value>(&response.data) else {
  202 |             return;
  203 |         };
  204 |         let Some(data) = envelope.get("data") else {
  205 |             return;
  206 |         };
  207 |         let Some(project) = request_data.get("project_id").and_then(Value::as_str) else {
  208 |             return;
  209 |         };
  210 |         let Some(attempt_id) = data.get("attempt_id").and_then(Value::as_str) else {
  211 |             return;
  212 |         };
  213 |         let Some(fence) = data.get("fence").and_then(Value::as_u64) else {
  214 |             return;
  215 |         };
  216 |         let Some(deadline_ms) = [
  217 |             data.get("lease_deadline").and_then(Value::as_str),
  218 |             data.get("hard_deadline").and_then(Value::as_str),
  219 |         ]
  220 |         .into_iter()
  221 |         .flatten()
  222 |         .filter_map(super::super::parse_stamp_ms)
  223 |         .min() else {
  224 |             return;
  225 |         };
  226 |         let delay_ms = deadline_ms.saturating_sub(super::super::now_ms_u64());
  227 |         let _ = timers.schedule(
  228 |             attempt_deadline_key(project, attempt_id, fence),
  229 |             Instant::now() + Duration::from_millis(delay_ms),
  230 |         );
  231 |     }
  232 | 
  233 |     pub(super) fn cancel_deadline_from_response(
  234 |         timers: &TimerRegistry,
  235 |         request_data: &Value,
  236 |         response: &ApplicationResponse,
  237 |     ) {
  238 |         if !matches!(
  239 |             request_data.get("command").and_then(Value::as_str),
  240 |             Some("release" | "submit" | "finish_close")
  241 |         ) {
  242 |             return;
  243 |         }
  244 |         let Ok(envelope) = serde_json::from_str::<Value>(&response.data) else {
  245 |             return;
  246 |         };
  247 |         if !matches!(
  248 |             envelope.get("outcome").and_then(Value::as_str),
  249 |             Some("changed" | "unchanged")
  250 |         ) {
  251 |             return;
  252 |         }
  253 |         let Some(project) = request_data.get("project_id").and_then(Value::as_str) else {
  254 |             return;
  255 |         };
  256 |         let Some(attempt_id) = request_data.get("attempt_id").and_then(Value::as_str) else {
  257 |             return;
  258 |         };
  259 |         let Some(fence) = request_data.get("fence").and_then(Value::as_u64) else {
  260 |             return;
````
