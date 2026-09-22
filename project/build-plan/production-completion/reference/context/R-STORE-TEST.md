# R-STORE-TEST — crates/store/tests/m02_claim.rs

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `crates/store/tests/m02_claim.rs:L1–L391`  
**File SHA-256:** `7f68d5729fea4a58f1cd1cc5bcd0dda064d30c3ff2d57d9fa05c00621d1e4ae1`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Candidate claim/authority regressions, not fresh observed evidence.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,391p' 'crates/store/tests/m02_claim.rs'
```

## Exact baseline excerpt

````text
    1 | //! Store-boundary M02 regression candidates. No service E2E claim is made by
    2 | //! these unit/integration vectors. Every claim goes through the actual store.
    3 | use boreal_domain::{DispatchPolicy, ReasonCode, WorkItem, WorkKind};
    4 | use boreal_store::{ClaimResult, SqliteStore, StoreError, WorkHoldAddInput};
    5 | use std::sync::{Arc, Barrier};
    6 | 
    7 | const SCHEMA: &str = include_str!("../../../project/spec/schema-v2.sql");
    8 | 
    9 | fn initialize(store: &SqliteStore) {
   10 |     store
   11 |         .initialize_project(
   12 |             "p",
   13 |             "agent",
   14 |             "agent",
   15 |             "cred-agent",
   16 |             "Agent",
   17 |             "init",
   18 |             "digest:init",
   19 |             "unix-ms:0",
   20 |         )
   21 |         .unwrap();
   22 |     for role in ["operator", "reviewer"] {
   23 |         store
   24 |             .ensure_actor(role, role, &format!("cred:{role}"), role, "unix-ms:0")
   25 |             .unwrap();
   26 |     }
   27 | }
   28 | 
   29 | fn setup() -> SqliteStore {
   30 |     let store = SqliteStore::open_in_memory(SCHEMA).unwrap();
   31 |     initialize(&store);
   32 |     store
   33 | }
   34 | 
   35 | fn put(store: &SqliteStore, id: &str, policy: DispatchPolicy, held: bool) {
   36 |     let mut item = WorkItem::new("p".into(), id.into(), WorkKind::Task, None, id).open();
   37 |     item.dispatch_policy = policy;
   38 |     if held {
   39 |         item.hard_holds
   40 |             .push(ReasonCode::HardHold("security_hold".into()));
   41 |     }
   42 |     store
   43 |         .create_work_operation(
   44 |             &item,
   45 |             "agent",
   46 |             &format!("create:{id}"),
   47 |             &format!("digest:create:{id}"),
   48 |             "unix-ms:1",
   49 |         )
   50 |         .unwrap();
   51 | }
   52 | 
   53 | fn claim(
   54 |     store: &SqliteStore,
   55 |     work: &str,
   56 |     actor: &str,
   57 |     operation: &str,
   58 |     now: u64,
   59 | ) -> Result<ClaimResult, StoreError> {
   60 |     store.claim_work(
   61 |         "p",
   62 |         work,
   63 |         actor,
   64 |         "harness",
   65 |         None,
   66 |         &format!("attempt:{operation}"),
   67 |         operation,
   68 |         &format!("digest:{operation}"),
   69 |         None,
   70 |         &format!("unix-ms:{now}"),
   71 |         &format!("unix-ms:{}", now + 100),
   72 |         &format!("unix-ms:{}", now + 200),
   73 |     )
   74 | }
   75 | 
   76 | #[test]
   77 | fn a_visible_hard_hold_cannot_be_bypassed_by_the_raw_claim_transaction() {
   78 |     let store = setup();
   79 |     put(&store, "held", DispatchPolicy::Automatic, true);
   80 |     let before = store.project_revision("p").unwrap();
   81 |     let error = claim(&store, "held", "agent", "claim-held", 10).unwrap_err();
   82 |     assert!(error.to_string().contains("security_hold"));
   83 |     assert!(store
   84 |         .current_attempt_for_work("p", "held")
   85 |         .unwrap()
   86 |         .is_none());
   87 |     assert!(store.operation("claim-held").unwrap().is_none());
   88 |     assert_eq!(store.project_revision("p").unwrap(), before);
   89 |     assert_eq!(store.work_holds("held").unwrap().len(), 1);
   90 | }
   91 | 
   92 | #[test]
   93 | fn paused_and_operator_dispatch_follow_the_same_durable_actor_policy() {
   94 |     let store = setup();
   95 |     put(&store, "paused", DispatchPolicy::Paused, false);
   96 |     put(&store, "operator-work", DispatchPolicy::OperatorOnly, false);
   97 |     put(&store, "automatic-work", DispatchPolicy::Automatic, false);
   98 |     assert!(claim(&store, "paused", "operator", "paused", 10).is_err());
   99 |     assert!(claim(&store, "operator-work", "agent", "agent-denied", 10).is_err());
  100 |     assert!(claim(&store, "operator-work", "reviewer", "reviewer-denied", 10).is_err());
  101 |     assert!(claim(
  102 |         &store,
  103 |         "automatic-work",
  104 |         "reviewer",
  105 |         "reviewer-auto-denied",
  106 |         10
  107 |     )
  108 |     .is_err());
  109 |     assert!(claim(&store, "operator-work", "operator", "operator-allowed", 10).is_ok());
  110 | }
  111 | 
  112 | #[test]
  113 | fn retries_compare_numeric_milliseconds_not_lexical_strings() {
  114 |     let store = setup();
  115 |     put(&store, "elapsed", DispatchPolicy::Automatic, false);
  116 |     put(&store, "future", DispatchPolicy::Automatic, false);
  117 |     store
  118 |         .execute_batch(
  119 |             "UPDATE work_item SET retry_not_before = 'unix-ms:9' WHERE work_id = 'elapsed';
  120 |         UPDATE work_item SET retry_not_before = 'unix-ms:100' WHERE work_id = 'future';",
  121 |         )
  122 |         .unwrap();
  123 |     assert!(claim(&store, "elapsed", "agent", "numeric-ready", 100).is_ok());
  124 |     let denied = claim(&store, "future", "agent", "numeric-wait", 9).unwrap_err();
  125 |     assert!(denied.to_string().contains("retry_not_before(100)"));
  126 |     assert!(claim(&store, "future", "agent", "numeric-boundary", 100).is_ok());
  127 | }
  128 | 
  129 | #[test]
  130 | fn canonical_time_errors_and_nonpositive_deadlines_leave_state_unchanged() {
  131 |     let store = setup();
  132 |     put(&store, "task", DispatchPolicy::Automatic, false);
  133 |     let before = store.project_revision("p").unwrap();
  134 |     for (now, lease) in [
  135 |         ("t3", "t4"),
  136 |         ("unix-ms:+3", "unix-ms:4"),
  137 |         ("unix-ms:3", "unix-ms:3"),
  138 |     ] {
  139 |         assert!(store
  140 |             .claim_work(
  141 |                 "p",
  142 |                 "task",
  143 |                 "agent",
  144 |                 "harness",
  145 |                 None,
  146 |                 "a",
  147 |                 "invalid-time",
  148 |                 "digest",
  149 |                 None,
  150 |                 now,
  151 |                 lease,
  152 |                 "unix-ms:10"
  153 |             )
  154 |             .is_err());
  155 |     }
  156 |     assert!(store
  157 |         .current_attempt_for_work("p", "task")
  158 |         .unwrap()
  159 |         .is_none());
  160 |     assert_eq!(store.project_revision("p").unwrap(), before);
  161 | }
  162 | 
  163 | #[test]
  164 | fn exact_replay_returns_the_original_claim_even_when_a_new_hold_blocks_progress() {
  165 |     let store = setup();
  166 |     put(&store, "task", DispatchPolicy::Automatic, false);
  167 |     let first = claim(&store, "task", "agent", "first", 10).unwrap();
  168 |     let revision = store.project_revision("p").unwrap().0;
  169 |     store
  170 |         .add_work_hold_operation(
  171 |             &WorkHoldAddInput {
  172 |                 project_id: "p".into(),
  173 |                 work_id: "task".into(),
  174 |                 reason_code: "security_hold".into(),
  175 |             },
  176 |             "operator",
  177 |             "add-hold",
  178 |             "digest:add-hold",
  179 |             revision,
  180 |             "unix-ms:11",
  181 |         )
  182 |         .unwrap();
  183 |     let held_revision = store.project_revision("p").unwrap();
  184 |     let replay = claim(&store, "task", "agent", "first", 10).unwrap();
  185 |     assert!(replay.replayed);
  186 |     assert_eq!(replay.attempt_id, first.attempt_id);
  187 |     assert_eq!(replay.revision, first.revision);
  188 |     assert_eq!(store.project_revision("p").unwrap(), held_revision);
  189 |     assert!(store.audit_event("first").unwrap().is_some());
  190 |     assert!(claim(&store, "task", "agent", "second", 12).is_err());
  191 | }
  192 | 
  193 | #[test]
  194 | fn unreadable_prerequisite_does_not_disappear_from_eligibility() {
  195 |     let store = setup();
  196 |     for id in ["upstream", "dependent", "healthy"] {
  197 |         put(&store, id, DispatchPolicy::Automatic, false);
  198 |     }
  199 |     store
  200 |         .add_dependency_operation(
  201 |             "p",
  202 |             "upstream",
  203 |             "dependent",
  204 |             "agent",
  205 |             "edge",
  206 |             "digest:edge",
  207 |             "unix-ms:2",
  208 |         )
  209 |         .unwrap();
  210 |     // Deliberate damaged-row fixture, not a production mutation route.
  211 |     store
  212 |         .execute_batch(
  213 |             "PRAGMA ignore_check_constraints = ON;
  214 |         UPDATE work_item SET kind = 'broken-kind' WHERE work_id = 'upstream';
  215 |         PRAGMA ignore_check_constraints = OFF;",
  216 |         )
  217 |         .unwrap();
  218 |     let snapshot = store.read_project_status("p").unwrap();
  219 |     assert_eq!(snapshot.total, 3);
  220 |     assert_eq!(snapshot.works.len(), 2);
  221 |     assert!(snapshot
  222 |         .diagnostics
  223 |         .iter()
  224 |         .any(|item| item.code == "orphaned_dependency"));
  225 |     let denied = claim(&store, "dependent", "agent", "orphan-denied", 10).unwrap_err();
  226 |     assert!(denied.to_string().contains("orphaned_dependency"));
  227 |     assert!(claim(&store, "healthy", "agent", "healthy-allowed", 10).is_ok());
  228 | }
  229 | 
  230 | #[test]
  231 | fn malformed_retry_is_diagnostic_and_not_claimable() {
  232 |     let store = setup();
  233 |     put(&store, "task", DispatchPolicy::Automatic, false);
  234 |     store
  235 |         .execute_batch(
  236 |             "UPDATE work_item SET retry_not_before = 'not-a-clock' WHERE work_id = 'task'",
  237 |         )
  238 |         .unwrap();
  239 |     let snapshot = store.read_project_status("p").unwrap();
  240 |     assert!(snapshot.works.is_empty());
  241 |     assert_eq!(snapshot.diagnostics[0].code, "invalid_status_clock");
  242 |     assert!(claim(&store, "task", "agent", "bad-clock", 10).is_err());
  243 | }
  244 | 
  245 | #[test]
  246 | fn hold_resolution_requires_operator_and_exact_project_scope() {
  247 |     let store = setup();
  248 |     put(&store, "held", DispatchPolicy::Automatic, true);
  249 |     store.create_project("other", "unix-ms:1").unwrap();
  250 |     let hold = store.work_holds("held").unwrap().remove(0);
  251 |     let revision = store.project_revision("p").unwrap().0;
  252 |     let denied = store
  253 |         .resolve_work_hold_operation(
  254 |             "p",
  255 |             "held",
  256 |             &hold.hold_id,
  257 |             "agent",
  258 |             "reviewed",
  259 |             "agent-resolve",
  260 |             "digest:agent-resolve",
  261 |             revision,
  262 |             "unix-ms:10",
  263 |         )
  264 |         .unwrap_err();
  265 |     assert!(denied.to_string().contains("role_denied"));
  266 |     assert!(store
  267 |         .resolve_work_hold_operation(
  268 |             "other",
  269 |             "held",
  270 |             &hold.hold_id,
  271 |             "operator",
  272 |             "reviewed",
  273 |             "foreign-resolve",
  274 |             "digest:foreign-resolve",
  275 |             0,
  276 |             "unix-ms:10"
  277 |         )
  278 |         .is_err());
  279 |     assert!(store.work_holds("held").unwrap()[0].resolved_at.is_none());
  280 |     store
  281 |         .resolve_work_hold_operation(
  282 |             "p",
  283 |             "held",
  284 |             &hold.hold_id,
  285 |             "operator",
  286 |             "reviewed",
  287 |             "operator-resolve",
  288 |             "digest:operator-resolve",
  289 |             revision,
  290 |             "unix-ms:10",
  291 |         )
  292 |         .unwrap();
  293 |     assert!(store.work_holds("held").unwrap()[0].resolved_at.is_some());
  294 |     assert!(store.audit_event("operator-resolve").unwrap().is_some());
  295 |     assert!(claim(&store, "held", "agent", "after-resolution", 11).is_ok());
  296 | }
  297 | 
  298 | #[test]
  299 | fn stale_claim_and_foreign_subject_do_not_write_attempts() {
  300 |     let store = setup();
  301 |     put(&store, "task", DispatchPolicy::Automatic, false);
  302 |     let stale = store.claim_work(
  303 |         "p",
  304 |         "task",
  305 |         "agent",
  306 |         "harness",
  307 |         None,
  308 |         "a",
  309 |         "stale",
  310 |         "digest:stale",
  311 |         Some(0),
  312 |         "unix-ms:10",
  313 |         "unix-ms:20",
  314 |         "unix-ms:30",
  315 |     );
  316 |     assert!(matches!(stale, Err(StoreError::StaleRevision { .. })));
  317 |     store.create_project("other", "unix-ms:1").unwrap();
  318 |     let foreign = store.claim_work(
  319 |         "other",
  320 |         "task",
  321 |         "agent",
  322 |         "harness",
  323 |         None,
  324 |         "b",
  325 |         "foreign",
  326 |         "digest:foreign",
  327 |         None,
  328 |         "unix-ms:10",
  329 |         "unix-ms:20",
  330 |         "unix-ms:30",
  331 |     );
  332 |     assert!(foreign.is_err());
  333 |     assert!(store
  334 |         .current_attempt_for_work("p", "task")
  335 |         .unwrap()
  336 |         .is_none());
  337 | }
  338 | 
  339 | #[test]
  340 | fn competing_write_transactions_still_produce_one_winner() {
  341 |     let suffix = std::time::SystemTime::now()
  342 |         .duration_since(std::time::UNIX_EPOCH)
  343 |         .unwrap()
  344 |         .as_nanos();
  345 |     let directory =
  346 |         std::env::temp_dir().join(format!("boreal-m02-{}-{suffix}", std::process::id()));
  347 |     std::fs::create_dir(&directory).unwrap();
  348 |     let path = directory.join("work.sqlite");
  349 |     {
  350 |         let store = SqliteStore::open(&path, SCHEMA).unwrap();
  351 |         initialize(&store);
  352 |         put(&store, "task", DispatchPolicy::Automatic, false);
  353 |     }
  354 |     let barrier = Arc::new(Barrier::new(2));
  355 |     let handles = (0..2)
  356 |         .map(|index| {
  357 |             let path = path.clone();
  358 |             let barrier = Arc::clone(&barrier);
  359 |             std::thread::spawn(move || {
  360 |                 let store = SqliteStore::open(path, SCHEMA).unwrap();
  361 |                 barrier.wait();
  362 |                 claim(&store, "task", "agent", &format!("race:{index}"), 10)
  363 |             })
  364 |         })
  365 |         .collect::<Vec<_>>();
  366 |     let outcomes = handles
  367 |         .into_iter()
  368 |         .map(|handle| handle.join().unwrap())
  369 |         .collect::<Vec<_>>();
  370 |     assert_eq!(outcomes.iter().filter(|result| result.is_ok()).count(), 1);
  371 |     assert_eq!(
  372 |         outcomes
  373 |             .iter()
  374 |             .filter(|result| matches!(result, Err(StoreError::Conflict(_))))
  375 |             .count(),
  376 |         1
  377 |     );
  378 |     {
  379 |         let store = SqliteStore::open(&path, SCHEMA).unwrap();
  380 |         assert!(store
  381 |             .current_attempt_for_work("p", "task")
  382 |             .unwrap()
  383 |             .is_some());
  384 |         let audit_count = ["race:0", "race:1"]
  385 |             .iter()
  386 |             .filter(|id| store.audit_event(id).unwrap().is_some())
  387 |             .count();
  388 |         assert_eq!(audit_count, 1);
  389 |     }
  390 |     std::fs::remove_dir_all(directory).unwrap();
  391 | }
````
