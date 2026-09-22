# R-SCHEMA-TEST — crates/store/tests/schema_v3.rs

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `crates/store/tests/schema_v3.rs:L1–L802`  
**File SHA-256:** `9b10ff63d7985c4e8360815cfb2ed30aa36dd8d09dba73ddeb657f70f166e956`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Existing additive v3 migration tests and failure rollback examples.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,802p' 'crates/store/tests/schema_v3.rs'
```

## Exact baseline excerpt

````text
    1 | //! Executable coverage for the additive `boreal.work-model/3` schema artifact.
    2 | //!
    3 | //! These tests exercise schema-v3.sql through both the store migration
    4 | //! boundary and direct SQL constraint fixtures.  The v2 tables remain
    5 | //! compatible while the store validates the complete v3 extension.
    6 | 
    7 | use boreal_store::{
    8 |     ContainerDispositionV3Input, CycleAssignmentV3Input, CycleSeriesV3Input, CycleTemplateV3Input,
    9 |     CycleV3Input, IntakeBucketV3Input, IntakeItemV3Input, IntakePromotionV3Input, SqliteStore,
   10 |     StoreError, V3MutationContext, WorkNodeV3Input,
   11 | };
   12 | use std::path::{Path, PathBuf};
   13 | use std::time::{SystemTime, UNIX_EPOCH};
   14 | 
   15 | const SCHEMA_V2: &str = include_str!("../../../project/spec/schema-v2.sql");
   16 | const SCHEMA_V3: &str = include_str!("../../../project/spec/schema-v3.sql");
   17 | 
   18 | fn temp_path(label: &str) -> PathBuf {
   19 |     let stamp = SystemTime::now()
   20 |         .duration_since(UNIX_EPOCH)
   21 |         .expect("clock before unix epoch")
   22 |         .as_nanos();
   23 |     std::env::temp_dir().join(format!(
   24 |         "boreal-schema-v3-{label}-{}-{stamp}.sqlite",
   25 |         std::process::id()
   26 |     ))
   27 | }
   28 | 
   29 | fn remove_sqlite_files(path: &Path) {
   30 |     let _ = std::fs::remove_file(path);
   31 |     let _ = std::fs::remove_file(path.with_extension("sqlite-wal"));
   32 |     let _ = std::fs::remove_file(path.with_extension("sqlite-shm"));
   33 | }
   34 | 
   35 | fn store_v3() -> SqliteStore {
   36 |     let store = SqliteStore::open_in_memory(SCHEMA_V2).expect("schema-v2 opens");
   37 |     store
   38 |         .execute_batch(SCHEMA_V3)
   39 |         .expect("schema-v3 additive migration applies");
   40 |     assert_eq!(store.schema_version().unwrap(), 3);
   41 |     store
   42 | }
   43 | 
   44 | #[test]
   45 | fn runtime_applies_and_reopens_v3_while_accepting_schema2_openers() {
   46 |     let path = temp_path("reopen");
   47 |     remove_sqlite_files(&path);
   48 |     {
   49 |         let store = SqliteStore::open(&path, SCHEMA_V2).expect("schema-v2 opens");
   50 |         assert_eq!(store.schema_version().unwrap(), 2);
   51 |         store
   52 |             .apply_schema(SCHEMA_V3)
   53 |             .expect("runtime applies the additive v3 migration");
   54 |         assert_eq!(store.schema_version().unwrap(), 3);
   55 |         assert!(store.work_model_v3_enabled().unwrap());
   56 |     }
   57 |     {
   58 |         // A schema-2 client can still reopen/read the database.  It sees the
   59 |         // installed extension but does not need to understand its tables.
   60 |         let reopened = SqliteStore::open(&path, SCHEMA_V2).expect("schema-v2 opener reopens v3");
   61 |         assert_eq!(reopened.schema_version().unwrap(), 3);
   62 |         assert!(reopened.work_model_v3_enabled().unwrap());
   63 |     }
   64 |     remove_sqlite_files(&path);
   65 | }
   66 | 
   67 | #[test]
   68 | fn failed_v3_migration_rolls_back_without_a_partial_v3_schema() {
   69 |     let path = temp_path("rollback");
   70 |     remove_sqlite_files(&path);
   71 |     let store = SqliteStore::open(&path, SCHEMA_V2).expect("schema-v2 opens");
   72 |     let broken = SCHEMA_V3.replace(
   73 |         "CREATE TABLE cycle_v3",
   74 |         "THIS IS INVALID SQL;\nCREATE TABLE cycle_v3",
   75 |     );
   76 |     assert!(store.apply_schema(&broken).is_err());
   77 |     assert_eq!(store.schema_version().unwrap(), 2);
   78 |     assert!(!store.work_model_v3_enabled().unwrap());
   79 |     assert!(store
   80 |         .execute_batch("SELECT 1 FROM work_model_v3_meta")
   81 |         .is_err());
   82 |     drop(store);
   83 |     remove_sqlite_files(&path);
   84 | }
   85 | 
   86 | #[test]
   87 | fn store_v3_mutations_use_revisions_audit_and_typed_replay() {
   88 |     let store = store_v3();
   89 |     seed_base(&store);
   90 |     seed_nodes(&store);
   91 |     let context = |operation_id: &str, request_digest: &str| V3MutationContext {
   92 |         project_id: "p1".to_owned(),
   93 |         actor_id: "agent-1".to_owned(),
   94 |         operation_id: operation_id.to_owned(),
   95 |         request_digest: request_digest.to_owned(),
   96 |         expected_revision: None,
   97 |         now: "t1".to_owned(),
   98 |     };
   99 | 
  100 |     let node = WorkNodeV3Input {
  101 |         project_id: "p1".to_owned(),
  102 |         work_id: "direct-a".to_owned(),
  103 |         decomposition_kind: "task".to_owned(),
  104 |         execution_mode: "direct".to_owned(),
  105 |         parent_id: Some("container-1".to_owned()),
  106 |         created_at: "t1".to_owned(),
  107 |         updated_at: "t1".to_owned(),
  108 |     };
  109 |     let first = store
  110 |         .create_work_node_v3(&context("op-node", "sha256:node"), &node)
  111 |         .expect_err("duplicate node should fail after the transaction boundary");
  112 |     assert!(matches!(first, StoreError::Constraint { .. }));
  113 | 
  114 |     let series = CycleSeriesV3Input {
  115 |         project_id: "p1".to_owned(),
  116 |         series_id: "series-api".to_owned(),
  117 |         name: "API cycle".to_owned(),
  118 |         lifecycle: "active".to_owned(),
  119 |         timezone: "America/Regina".to_owned(),
  120 |         tzdb_identity: "tzdb-test".to_owned(),
  121 |         created_at: "t1".to_owned(),
  122 |         updated_at: "t1".to_owned(),
  123 |     };
  124 |     let created = store
  125 |         .create_cycle_series_v3(&context("op-series", "sha256:series"), &series)
  126 |         .expect("series mutation is accepted");
  127 |     assert!(!created.replayed);
  128 |     assert_eq!(created.revision, 1);
  129 |     assert_eq!(
  130 |         store
  131 |             .cycle_series_v3("p1", "series-api")
  132 |             .unwrap()
  133 |             .unwrap()
  134 |             .name,
  135 |         "API cycle"
  136 |     );
  137 | 
  138 |     let replay = store
  139 |         .create_cycle_series_v3(&context("op-series", "sha256:series"), &series)
  140 |         .expect("same operation replays");
  141 |     assert!(replay.replayed);
  142 |     assert_eq!(replay.revision, created.revision);
  143 |     let changed = store.create_cycle_series_v3(&context("op-series", "sha256:changed"), &series);
  144 |     assert!(matches!(changed, Err(StoreError::Conflict(_))));
  145 | 
  146 |     let template = CycleTemplateV3Input {
  147 |         project_id: "p1".to_owned(),
  148 |         template_version_id: "template-api".to_owned(),
  149 |         series_id: "series-api".to_owned(),
  150 |         version: 1,
  151 |         effective_from_slot_ordinal: 0,
  152 |         interval_weeks: 1,
  153 |         anchor_local_date: "2026-09-21".to_owned(),
  154 |         anchor_local_time: "09:00:00".to_owned(),
  155 |         anchor_weekday: 1,
  156 |         recurrence_end_kind: "never".to_owned(),
  157 |         recurrence_end_count: None,
  158 |         recurrence_end_local_date: None,
  159 |         name_pattern: "Cycle {slot}".to_owned(),
  160 |         goal_template: "Ship".to_owned(),
  161 |         timezone: "America/Regina".to_owned(),
  162 |         tzdb_identity: "tzdb-test".to_owned(),
  163 |         gap_policy: "next_valid".to_owned(),
  164 |         fold_policy: "earlier_offset".to_owned(),
  165 |         weekdays: vec![1],
  166 |         created_at: "t1".to_owned(),
  167 |     };
  168 |     store
  169 |         .create_cycle_template_v3(&context("op-template", "sha256:template"), &template)
  170 |         .expect("template mutation is accepted");
  171 |     let cycle = CycleV3Input {
  172 |         project_id: "p1".to_owned(),
  173 |         cycle_id: "cycle-api".to_owned(),
  174 |         series_id: "series-api".to_owned(),
  175 |         template_version_id: "template-api".to_owned(),
  176 |         slot_ordinal: 0,
  177 |         name: "Cycle 0".to_owned(),
  178 |         goal: "Ship".to_owned(),
  179 |         lifecycle: "planned".to_owned(),
  180 |         scheduled_start_utc_ms: 1_790_000_000_000,
  181 |         scheduled_end_utc_ms: Some(1_790_003_600_000),
  182 |         scheduled_start_local: "2026-09-21T09:00:00".to_owned(),
  183 |         scheduled_start_utc_offset_minutes: -360,
  184 |         timezone: "America/Regina".to_owned(),
  185 |         tzdb_identity: "tzdb-test".to_owned(),
  186 |         gap_policy: "next_valid".to_owned(),
  187 |         fold_policy: "earlier_offset".to_owned(),
  188 |         created_at: "t1".to_owned(),
  189 |         updated_at: "t1".to_owned(),
  190 |     };
  191 |     store
  192 |         .create_cycle_v3(&context("op-cycle", "sha256:cycle"), &cycle)
  193 |         .expect("cycle mutation is accepted");
  194 |     store
  195 |         .assign_cycle_work_v3(
  196 |             &context("op-assignment", "sha256:assignment"),
  197 |             &CycleAssignmentV3Input {
  198 |                 project_id: "p1".to_owned(),
  199 |                 assignment_id: "assignment-api".to_owned(),
  200 |                 cycle_id: "cycle-api".to_owned(),
  201 |                 work_id: "direct-a".to_owned(),
  202 |                 state: "planned".to_owned(),
  203 |                 activation_policy: "at_cycle_start".to_owned(),
  204 |                 activation_at_utc_ms: None,
  205 |                 predecessor_id: None,
  206 |                 successor_id: None,
  207 |                 created_at: "t1".to_owned(),
  208 |                 updated_at: "t1".to_owned(),
  209 |             },
  210 |         )
  211 |         .expect("assignment mutation is accepted");
  212 |     assert_eq!(
  213 |         store.cycle_assignments_v3("p1", "cycle-api").unwrap().len(),
  214 |         1
  215 |     );
  216 | 
  217 |     store
  218 |         .create_intake_bucket_v3(
  219 |             &context("op-bucket", "sha256:bucket"),
  220 |             &IntakeBucketV3Input {
  221 |                 project_id: "p1".to_owned(),
  222 |                 bucket_id: "bucket-api".to_owned(),
  223 |                 name: "Inbox".to_owned(),
  224 |                 archived: false,
  225 |                 created_at: "t1".to_owned(),
  226 |                 updated_at: "t1".to_owned(),
  227 |             },
  228 |         )
  229 |         .expect("bucket mutation is accepted");
  230 |     store
  231 |         .create_intake_item_v3(
  232 |             &context("op-intake", "sha256:intake"),
  233 |             &IntakeItemV3Input {
  234 |                 project_id: "p1".to_owned(),
  235 |                 intake_id: "intake-api".to_owned(),
  236 |                 bucket_id: "bucket-api".to_owned(),
  237 |                 kind: "discovery".to_owned(),
  238 |                 lifecycle: "captured".to_owned(),
  239 |                 content: "A useful discovery".to_owned(),
  240 |                 content_revision: 1,
  241 |                 content_digest: "sha256:intake".to_owned(),
  242 |                 captured_at: "t1".to_owned(),
  243 |                 updated_at: "t1".to_owned(),
  244 |                 revisit_at_utc_ms: None,
  245 |             },
  246 |         )
  247 |         .expect("intake mutation is accepted");
  248 |     assert_eq!(
  249 |         store
  250 |             .intake_item_v3("p1", "intake-api")
  251 |             .unwrap()
  252 |             .unwrap()
  253 |             .content_revision,
  254 |         1
  255 |     );
  256 |     store
  257 |         .promote_intake_v3(
  258 |             &context("op-promotion", "sha256:promotion"),
  259 |             &IntakePromotionV3Input {
  260 |                 project_id: "p1".to_owned(),
  261 |                 promotion_id: "promotion-api".to_owned(),
  262 |                 intake_id: "intake-api".to_owned(),
  263 |                 intake_revision: 1,
  264 |                 intake_digest: "sha256:intake".to_owned(),
  265 |                 target_kind: "draft_work".to_owned(),
  266 |                 target_id: "draft-api".to_owned(),
  267 |                 actor_id: "agent-1".to_owned(),
  268 |                 operation_id: "promotion-child-op".to_owned(),
  269 |                 created_at: "t1".to_owned(),
  270 |             },
  271 |         )
  272 |         .expect("promotion mutation is accepted");
  273 | 
  274 |     let disposition = ContainerDispositionV3Input {
  275 |         project_id: "p1".to_owned(),
  276 |         disposition_id: "disposition-api".to_owned(),
  277 |         container_work_id: "container-1".to_owned(),
  278 |         descendant_work_id: "direct-a".to_owned(),
  279 |         kind: "accepted_closed".to_owned(),
  280 |         descendant_revision: 1,
  281 |         descendant_outcome_digest: "sha256:outcome".to_owned(),
  282 |         replacement_work_id: None,
  283 |         reason: None,
  284 |         supersedes_id: None,
  285 |         created_at: "t1".to_owned(),
  286 |     };
  287 |     store
  288 |         .append_container_disposition_v3(
  289 |             &context("op-disposition", "sha256:disposition"),
  290 |             &disposition,
  291 |         )
  292 |         .expect("disposition mutation is accepted");
  293 | }
  294 | 
  295 | #[test]
  296 | fn populated_v3_extension_refuses_destructive_rollback_but_empty_one_downgrades() {
  297 |     let store = store_v3();
  298 |     seed_base(&store);
  299 |     seed_nodes(&store);
  300 |     let error = store.rollback_work_model_v3().unwrap_err();
  301 |     assert!(matches!(error, StoreError::Conflict(_)));
  302 | 
  303 |     let empty = store_v3();
  304 |     empty
  305 |         .rollback_work_model_v3()
  306 |         .expect("empty extension can safely downgrade");
  307 |     assert_eq!(empty.schema_version().unwrap(), 2);
  308 |     assert!(!empty.work_model_v3_enabled().unwrap());
  309 | }
  310 | 
  311 | #[test]
  312 | fn online_backup_preserves_the_v3_extension_and_schema2_rows() {
  313 |     let source_path = temp_path("v3-backup-source");
  314 |     let backup_path = temp_path("v3-backup-copy");
  315 |     remove_sqlite_files(&source_path);
  316 |     remove_sqlite_files(&backup_path);
  317 |     {
  318 |         let source = SqliteStore::open_with_work_model_v3(&source_path, SCHEMA_V2, SCHEMA_V3)
  319 |             .expect("v2 base plus v3 extension opens");
  320 |         seed_base(&source);
  321 |         seed_nodes(&source);
  322 |         source.backup_to(&backup_path).expect("v3 backup succeeds");
  323 |     }
  324 |     let backup = SqliteStore::open(&backup_path, SCHEMA_V2).expect("v2-compatible reopen");
  325 |     assert_eq!(backup.schema_version().unwrap(), 3);
  326 |     assert!(backup.work_model_v3_enabled().unwrap());
  327 |     assert!(backup.work("p1", "direct-a").unwrap().is_some());
  328 |     assert!(backup.work_node_v3("p1", "direct-a").unwrap().is_some());
  329 |     drop(backup);
  330 |     remove_sqlite_files(&source_path);
  331 |     remove_sqlite_files(&backup_path);
  332 | }
  333 | 
  334 | fn seed_base(store: &SqliteStore) {
  335 |     store
  336 |         .execute_batch(
  337 |             "
  338 |             INSERT INTO project VALUES ('p1', 2, 'boreal.work-status/2', 0, 't0', 't0');
  339 |             INSERT INTO actor VALUES ('agent-1', 'agent', 'cred-agent', 'Agent', 't0');
  340 |             INSERT INTO acceptance_profile VALUES ('default', 1, 'sha256:policy', '{}', 't0');
  341 |             INSERT INTO work_item (
  342 |                 work_id, project_id, kind, parent_id, lifecycle, dispatch_policy,
  343 |                 acceptance_profile_id, acceptance_profile_version, title,
  344 |                 description, created_at, updated_at
  345 |             ) VALUES
  346 |               ('milestone-1', 'p1', 'milestone', NULL, 'open', 'automatic',
  347 |                'default', 1, 'Milestone', '', 't0', 't0'),
  348 |               ('container-1', 'p1', 'task', NULL, 'open', 'automatic',
  349 |                'default', 1, 'Container 1', '', 't0', 't0'),
  350 |               ('container-2', 'p1', 'task', NULL, 'open', 'automatic',
  351 |                'default', 1, 'Container 2', '', 't0', 't0'),
  352 |               ('direct-a', 'p1', 'task', NULL, 'open', 'automatic',
  353 |                'default', 1, 'Direct A', '', 't0', 't0'),
  354 |               ('direct-b', 'p1', 'task', NULL, 'open', 'automatic',
  355 |                'default', 1, 'Direct B', '', 't0', 't0'),
  356 |               ('legacy-sprint', 'p1', 'sprint', NULL, 'open', 'automatic',
  357 |                'default', 1, 'Legacy Sprint', '', 't0', 't0');
  358 |             ",
  359 |         )
  360 |         .expect("schema-v2 fixture data inserts");
  361 | }
  362 | 
  363 | fn seed_nodes(store: &SqliteStore) {
  364 |     store
  365 |         .execute_batch(
  366 |             "
  367 |             INSERT INTO work_node_v3
  368 |                 (work_id, project_id, decomposition_kind, execution_mode,
  369 |                  parent_id, created_at, updated_at)
  370 |             VALUES
  371 |               ('milestone-1', 'p1', 'milestone', 'container', NULL, 't0', 't0'),
  372 |               ('container-1', 'p1', 'task', 'container', 'milestone-1', 't0', 't0'),
  373 |               ('container-2', 'p1', 'task', 'container', 'container-1', 't0', 't0'),
  374 |               ('direct-a', 'p1', 'task', 'direct', 'container-1', 't0', 't0'),
  375 |               ('direct-b', 'p1', 'task', 'direct', 'container-2', 't0', 't0');
  376 |             ",
  377 |         )
  378 |         .expect("v3 nodes insert");
  379 | }
  380 | 
  381 | fn reject(store: &SqliteStore, sql: &str, expected_message: &str) {
  382 |     let error = store
  383 |         .execute_batch(sql)
  384 |         .expect_err("statement should violate a v3 invariant");
  385 |     let rendered = error.to_string();
  386 |     assert!(
  387 |         rendered.contains(expected_message),
  388 |         "expected {expected_message:?} in {rendered:?} ({error:?})"
  389 |     );
  390 | }
  391 | 
  392 | #[test]
  393 | fn schema_v3_is_a_versioned_additive_extension_of_schema_v2() {
  394 |     let store = store_v3();
  395 |     seed_base(&store);
  396 | 
  397 |     // The original v2 tables and their semantics remain available.  In
  398 |     // particular, v2 dependency rows are not silently reinterpreted as the
  399 |     // stricter v3 direct-task graph.
  400 |     store
  401 |         .execute_batch(
  402 |             "INSERT INTO dependency (
  403 |                  project_id, prerequisite_id, dependent_id, created_at
  404 |              ) VALUES ('p1', 'milestone-1', 'direct-a', 't0');",
  405 |         )
  406 |         .expect("schema-v2 dependency semantics remain intact");
  407 | 
  408 |     store
  409 |         .execute_batch(
  410 |             "INSERT INTO work_model_v3_meta
  411 |                  (schema_id, schema_version, base_schema_version,
  412 |                   contract_version, created_at)
  413 |              VALUES ('another', 3, 2, 'boreal.work-model/3', 't0');",
  414 |         )
  415 |         .expect_err("the v3 metadata identity is singleton and fixed");
  416 |     assert_eq!(store.schema_version().unwrap(), 3);
  417 |     assert!(store.work("p1", "milestone-1").unwrap().is_some());
  418 | }
  419 | 
  420 | #[test]
  421 | fn hierarchy_separates_cycles_and_rejects_sprint_or_direct_task_children() {
  422 |     let store = store_v3();
  423 |     seed_base(&store);
  424 |     seed_nodes(&store);
  425 | 
  426 |     reject(
  427 |         &store,
  428 |         "INSERT INTO work_node_v3
  429 |              (work_id, project_id, decomposition_kind, execution_mode,
  430 |               parent_id, created_at, updated_at)
  431 |          VALUES ('legacy-sprint', 'p1', 'task', 'direct', NULL, 't0', 't0');",
  432 |         "work_node_v3_kind_mismatch",
  433 |     );
  434 | 
  435 |     reject(
  436 |         &store,
  437 |         "INSERT INTO work_node_v3
  438 |              (work_id, project_id, decomposition_kind, execution_mode,
  439 |               parent_id, created_at, updated_at)
  440 |          VALUES ('direct-child', 'p1', 'task', 'direct', 'direct-a', 't0', 't0');",
  441 |         "work_node_v3_invalid_parent",
  442 |     );
  443 |     reject(
  444 |         &store,
  445 |         "UPDATE work_node_v3
  446 |          SET parent_id = 'container-2' WHERE work_id = 'container-1';",
  447 |         "work_node_v3_hierarchy_cycle",
  448 |     );
  449 |     reject(
  450 |         &store,
  451 |         "UPDATE work_node_v3
  452 |          SET execution_mode = 'direct' WHERE work_id = 'container-1';",
  453 |         "work_node_v3_invalid_retype",
  454 |     );
  455 | 
  456 |     store
  457 |         .execute_batch(
  458 |             "INSERT INTO cycle_series_v3
  459 |                  (series_id, project_id, name, lifecycle, timezone,
  460 |                   tzdb_identity, created_at, updated_at)
  461 |              VALUES ('series-1', 'p1', 'Weekly delivery', 'active',
  462 |                      'America/Regina', 'tzdb-2026a', 't0', 't0');
  463 |              INSERT INTO cycle_template_v3
  464 |                  (template_version_id, project_id, series_id, version,
  465 |                   effective_from_slot_ordinal, interval_weeks,
  466 |                   anchor_local_date, anchor_local_time, anchor_weekday,
  467 |                   recurrence_end_kind, recurrence_end_count,
  468 |                   recurrence_end_local_date, name_pattern, goal_template,
  469 |                   timezone, tzdb_identity, gap_policy, fold_policy, created_at)
  470 |              VALUES ('template-1', 'p1', 'series-1', 1, 0, 1,
  471 |                      '2026-09-21', '09:00:00', 1, 'never', NULL, NULL,
  472 |                      'Cycle {slot}', 'Ship the slice', 'America/Regina',
  473 |                      'tzdb-2026a', 'next_valid', 'earlier_offset', 't0');
  474 |              INSERT INTO cycle_template_weekday_v3
  475 |                  (project_id, template_version_id, weekday)
  476 |              VALUES ('p1', 'template-1', 1), ('p1', 'template-1', 3);
  477 |              INSERT INTO cycle_v3
  478 |                  (cycle_id, project_id, series_id, template_version_id,
  479 |                   slot_ordinal, slot_key, name, lifecycle,
  480 |                   scheduled_start_utc_ms, scheduled_end_utc_ms,
  481 |                   scheduled_start_local, scheduled_start_utc_offset_minutes,
  482 |                   timezone, tzdb_identity, gap_policy, fold_policy,
  483 |                   created_at, updated_at)
  484 |              VALUES ('cycle-1', 'p1', 'series-1', 'template-1', 7,
  485 |                      'boreal.cycle-slot/1/series-1/7', 'Cycle 7', 'planned',
  486 |                      1790000000000, 1790043200000, '2026-09-21T09:00:00',
  487 |                      -360, 'America/Regina', 'tzdb-2026a', 'next_valid',
  488 |                      'earlier_offset', 't0', 't0');
  489 |              INSERT INTO cycle_assignment_v3
  490 |                  (assignment_id, project_id, cycle_id, work_id, state,
  491 |                   activation_policy, activation_at_utc_ms, created_at, updated_at)
  492 |              VALUES ('assignment-1', 'p1', 'cycle-1', 'direct-a', 'planned',
  493 |                      'at_cycle_start', NULL, 't0', 't0');",
  494 |         )
  495 |         .expect("cycle recurrence and direct assignment insert");
  496 | 
  497 |     reject(
  498 |         &store,
  499 |         "INSERT INTO cycle_v3
  500 |              (cycle_id, project_id, series_id, template_version_id,
  501 |               slot_ordinal, slot_key, name, lifecycle,
  502 |               scheduled_start_utc_ms, scheduled_end_utc_ms,
  503 |               scheduled_start_local, scheduled_start_utc_offset_minutes,
  504 |               timezone, tzdb_identity, gap_policy, fold_policy,
  505 |               created_at, updated_at)
  506 |          VALUES ('cycle-bad-slot', 'p1', 'series-1', 'template-1', 8,
  507 |                  'not-a-slot', 'Bad', 'planned', 1790000000000, NULL,
  508 |                  '2026-09-28T09:00:00', -360, 'America/Regina', 'tzdb-2026a',
  509 |                  'next_valid', 'earlier_offset', 't0', 't0');",
  510 |         "CHECK constraint failed",
  511 |     );
  512 | 
  513 |     reject(
  514 |         &store,
  515 |         "INSERT INTO cycle_assignment_v3
  516 |              (assignment_id, project_id, cycle_id, work_id, state,
  517 |               activation_policy, activation_at_utc_ms, created_at, updated_at)
  518 |          VALUES ('assignment-container', 'p1', 'cycle-1', 'container-1',
  519 |                  'planned', 'at_cycle_start', NULL, 't0', 't0');",
  520 |         "cycle_assignment_v3_requires_direct_task",
  521 |     );
  522 | }
  523 | 
  524 | #[test]
  525 | fn direct_task_dependencies_are_separate_and_dag_safe() {
  526 |     let store = store_v3();
  527 |     seed_base(&store);
  528 |     seed_nodes(&store);
  529 | 
  530 |     store
  531 |         .execute_batch(
  532 |             "INSERT INTO work_dependency_v3
  533 |                  (project_id, prerequisite_work_id, dependent_work_id, created_at)
  534 |              VALUES ('p1', 'direct-a', 'direct-b', 't0');",
  535 |         )
  536 |         .expect("direct-task edge inserts");
  537 | 
  538 |     reject(
  539 |         &store,
  540 |         "INSERT INTO work_dependency_v3
  541 |              (project_id, prerequisite_work_id, dependent_work_id, created_at)
  542 |          VALUES ('p1', 'container-1', 'direct-b', 't0');",
  543 |         "work_dependency_v3_requires_direct_tasks",
  544 |     );
  545 |     reject(
  546 |         &store,
  547 |         "INSERT INTO work_dependency_v3
  548 |              (project_id, prerequisite_work_id, dependent_work_id, created_at)
  549 |          VALUES ('p1', 'direct-b', 'direct-a', 't0');",
  550 |         "work_dependency_v3_cycle",
  551 |     );
  552 | 
  553 |     reject(
  554 |         &store,
  555 |         "INSERT INTO work_dependency_v3
  556 |              (project_id, prerequisite_work_id, dependent_work_id, policy,
  557 |               exception_reason, approved_by, created_at)
  558 |          VALUES ('p1', 'direct-a', 'direct-b', 'explicit_exception',
  559 |                  'missing approval', NULL, 't0');",
  560 |         "CHECK constraint failed",
  561 |     );
  562 | }
  563 | 
  564 | #[test]
  565 | fn recurrence_fields_capture_resolved_timezone_and_template_identity() {
  566 |     let store = store_v3();
  567 |     seed_base(&store);
  568 |     seed_nodes(&store);
  569 | 
  570 |     store
  571 |         .execute_batch(
  572 |             "INSERT INTO cycle_series_v3
  573 |                  (series_id, project_id, name, lifecycle, timezone,
  574 |                   tzdb_identity, created_at, updated_at)
  575 |              VALUES ('series-2', 'p1', 'Biweekly review', 'active',
  576 |                      'America/New_York', 'tzdb-2026a', 't0', 't0');
  577 |              INSERT INTO cycle_template_v3
  578 |                  (template_version_id, project_id, series_id, version,
  579 |                   effective_from_slot_ordinal, interval_weeks,
  580 |                   anchor_local_date, anchor_local_time, anchor_weekday,
  581 |                   recurrence_end_kind, recurrence_end_count,
  582 |                   recurrence_end_local_date, name_pattern, goal_template,
  583 |                   timezone, tzdb_identity, gap_policy, fold_policy, created_at)
  584 |              VALUES ('template-2', 'p1', 'series-2', 4, 12, 2,
  585 |                      '2026-09-27', '23:59:00', 7, 'count', 8, NULL,
  586 |                      'Review {slot}', 'Review outcomes', 'America/New_York',
  587 |                      'tzdb-2026a', 'next_valid', 'later_offset', 't0');
  588 |              INSERT INTO cycle_template_weekday_v3
  589 |                  (project_id, template_version_id, weekday)
  590 |              VALUES ('p1', 'template-2', 7);
  591 |              INSERT INTO cycle_v3
  592 |                  (cycle_id, project_id, series_id, template_version_id,
  593 |                   slot_ordinal, slot_key, name, goal, lifecycle,
  594 |                   scheduled_start_utc_ms, scheduled_end_utc_ms,
  595 |                   scheduled_start_local, scheduled_start_utc_offset_minutes,
  596 |                   timezone, tzdb_identity, gap_policy, fold_policy,
  597 |                   created_at, updated_at)
  598 |              VALUES ('cycle-2', 'p1', 'series-2', 'template-2', 12,
  599 |                      'boreal.cycle-slot/1/series-2/12', 'Review 12',
  600 |                      'Review outcomes', 'planned', 1790000000000,
  601 |                      1790000060000, '2026-09-27T23:59:00', -240,
  602 |                      'America/New_York', 'tzdb-2026a', 'next_valid', 'later_offset',
  603 |                      't0', 't0');",
  604 |         )
  605 |         .expect("biweekly recurrence fixture inserts");
  606 | 
  607 |     reject(
  608 |         &store,
  609 |         "INSERT INTO cycle_template_v3
  610 |              (template_version_id, project_id, series_id, version,
  611 |               effective_from_slot_ordinal, interval_weeks,
  612 |               anchor_local_date, anchor_local_time, anchor_weekday,
  613 |               recurrence_end_kind, recurrence_end_count,
  614 |               recurrence_end_local_date, name_pattern, goal_template,
  615 |               timezone, tzdb_identity, gap_policy, fold_policy, created_at)
  616 |          VALUES ('template-bad', 'p1', 'series-2', 5, 13, 0,
  617 |                  '2026-09-27', '23:59:00', 7, 'count', 0, NULL, 'Bad', '',
  618 |                  'America/New_York', 'tzdb-2026a', 'next_valid',
  619 |                  'later_offset', 't0');",
  620 |         "CHECK constraint failed",
  621 |     );
  622 | }
  623 | 
  624 | #[test]
  625 | fn intake_promotion_binds_content_revision_and_digest() {
  626 |     let store = store_v3();
  627 |     seed_base(&store);
  628 | 
  629 |     store
  630 |         .execute_batch(
  631 |             "INSERT INTO intake_bucket_v3
  632 |                  (bucket_id, project_id, name, created_at, updated_at)
  633 |              VALUES ('bucket-1', 'p1', 'Inbox', 't0', 't0');
  634 |              INSERT INTO intake_item_v3
  635 |                  (intake_id, project_id, bucket_id, kind, lifecycle, content,
  636 |                   content_revision, content_digest, captured_at, updated_at)
  637 |              VALUES ('intake-1', 'p1', 'bucket-1', 'discovery', 'captured',
  638 |                      'Found a reproducible edge case', 1, 'sha256:intake-a',
  639 |                      't0', 't0');
  640 |              INSERT INTO intake_promotion_v3
  641 |                  (promotion_id, project_id, intake_id, intake_revision,
  642 |                   intake_digest, target_kind, target_id, actor_id,
  643 |                   operation_id, created_at)
  644 |              VALUES ('promotion-1', 'p1', 'intake-1', 1, 'sha256:intake-a',
  645 |                      'draft_work', 'draft-1', 'agent-1', 'op-1', 't0');",
  646 |         )
  647 |         .expect("matching promotion provenance inserts");
  648 | 
  649 |     reject(
  650 |         &store,
  651 |         "INSERT INTO intake_promotion_v3
  652 |              (promotion_id, project_id, intake_id, intake_revision,
  653 |               intake_digest, target_kind, target_id, actor_id,
  654 |               operation_id, created_at)
  655 |          VALUES ('promotion-stale', 'p1', 'intake-1', 2, 'sha256:intake-b',
  656 |                  'memory_draft', 'memory-1', 'agent-1', 'op-stale', 't0');",
  657 |         "intake_promotion_v3_stale_provenance",
  658 |     );
  659 |     reject(
  660 |         &store,
  661 |         "INSERT INTO intake_item_v3
  662 |              (intake_id, project_id, bucket_id, kind, lifecycle, content,
  663 |               content_revision, content_digest, captured_at, updated_at)
  664 |          VALUES ('intake-deferred', 'p1', 'bucket-1', 'revisit', 'deferred',
  665 |                  'Come back later', 1, 'sha256:later', 't0', 't0');",
  666 |         "CHECK constraint failed",
  667 |     );
  668 | 
  669 |     store
  670 |         .execute_batch(
  671 |             "UPDATE intake_item_v3
  672 |              SET content = 'Found a narrower edge case',
  673 |                  content_revision = 2,
  674 |                  content_digest = 'sha256:intake-b',
  675 |                  updated_at = 't1'
  676 |              WHERE intake_id = 'intake-1';",
  677 |         )
  678 |         .expect("content revision advances with a new digest");
  679 | 
  680 |     reject(
  681 |         &store,
  682 |         "INSERT INTO intake_promotion_v3
  683 |              (promotion_id, project_id, intake_id, intake_revision,
  684 |               intake_digest, target_kind, target_id, actor_id,
  685 |               operation_id, created_at)
  686 |          VALUES ('promotion-old', 'p1', 'intake-1', 1, 'sha256:intake-a',
  687 |                  'source_version', 'source-1', 'agent-1', 'op-old', 't1');",
  688 |         "intake_promotion_v3_stale_provenance",
  689 |     );
  690 | 
  691 |     reject(
  692 |         &store,
  693 |         "UPDATE intake_item_v3
  694 |          SET content = 'Untracked edit', content_revision = 4,
  695 |              content_digest = 'sha256:intake-c'
  696 |          WHERE intake_id = 'intake-1';",
  697 |         "intake_item_v3_revision_digest_mismatch",
  698 |     );
  699 | 
  700 |     store
  701 |         .execute_batch(
  702 |             "INSERT INTO intake_promotion_v3
  703 |                  (promotion_id, project_id, intake_id, intake_revision,
  704 |                   intake_digest, target_kind, target_id, actor_id,
  705 |                   operation_id, created_at)
  706 |              VALUES ('promotion-2', 'p1', 'intake-1', 2, 'sha256:intake-b',
  707 |                      'memory_draft', 'memory-1', 'agent-1', 'op-2', 't1');",
  708 |         )
  709 |         .expect("new promotion binds the new content revision");
  710 | 
  711 |     reject(
  712 |         &store,
  713 |         "DELETE FROM intake_promotion_v3 WHERE promotion_id = 'promotion-1';",
  714 |         "intake_promotion_v3_append_only",
  715 |     );
  716 | }
  717 | 
  718 | #[test]
  719 | fn container_dispositions_are_append_only_chain_tips() {
  720 |     let store = store_v3();
  721 |     seed_base(&store);
  722 |     seed_nodes(&store);
  723 | 
  724 |     store
  725 |         .execute_batch(
  726 |             "INSERT INTO container_disposition_v3
  727 |                  (disposition_id, project_id, container_work_id,
  728 |                   descendant_work_id, kind, descendant_revision,
  729 |                   descendant_outcome_digest, created_at)
  730 |              VALUES ('disposition-1', 'p1', 'container-1', 'direct-a',
  731 |                      'accepted_closed', 7, 'sha256:outcome-a', 't0');",
  732 |         )
  733 |         .expect("initial disposition inserts");
  734 | 
  735 |     reject(
  736 |         &store,
  737 |         "UPDATE container_disposition_v3
  738 |          SET kind = 'deferred' WHERE disposition_id = 'disposition-1';",
  739 |         "container_disposition_v3_append_only",
  740 |     );
  741 |     reject(
  742 |         &store,
  743 |         "DELETE FROM container_disposition_v3
  744 |          WHERE disposition_id = 'disposition-1';",
  745 |         "container_disposition_v3_append_only",
  746 |     );
  747 |     reject(
  748 |         &store,
  749 |         "INSERT INTO container_disposition_v3
  750 |              (disposition_id, project_id, container_work_id,
  751 |               descendant_work_id, kind, descendant_revision,
  752 |               descendant_outcome_digest, created_at)
  753 |          VALUES ('disposition-duplicate', 'p1', 'container-1', 'direct-a',
  754 |                  'accepted_cancelled', 8, 'sha256:outcome-b', 't1');",
  755 |         "container_disposition_v3_current_exists",
  756 |     );
  757 | 
  758 |     store
  759 |         .execute_batch(
  760 |             "INSERT INTO container_disposition_v3
  761 |                  (disposition_id, project_id, container_work_id,
  762 |                   descendant_work_id, kind, descendant_revision,
  763 |                   descendant_outcome_digest, replacement_work_id, reason,
  764 |                   supersedes_id, created_at)
  765 |              VALUES ('disposition-2', 'p1', 'container-1', 'direct-a',
  766 |                      'replaced', 9, 'sha256:outcome-c', 'direct-b',
  767 |                      'replacement approved', 'disposition-1', 't2');",
  768 |         )
  769 |         .expect("replacement disposition supersedes the current tip");
  770 | 
  771 |     reject(
  772 |         &store,
  773 |         "INSERT INTO container_disposition_v3
  774 |              (disposition_id, project_id, container_work_id,
  775 |               descendant_work_id, kind, descendant_revision,
  776 |               descendant_outcome_digest, supersedes_id, created_at)
  777 |          VALUES ('disposition-3', 'p1', 'container-1', 'direct-a',
  778 |                  'accepted_closed', 10, 'sha256:outcome-d',
  779 |                  'disposition-1', 't3');",
  780 |         "container_disposition_v3_invalid_supersedes",
  781 |     );
  782 |     reject(
  783 |         &store,
  784 |         "INSERT INTO container_disposition_v3
  785 |              (disposition_id, project_id, container_work_id,
  786 |               descendant_work_id, kind, descendant_revision,
  787 |               descendant_outcome_digest, created_at)
  788 |          VALUES ('disposition-outside', 'p1', 'container-2', 'direct-a',
  789 |                  'accepted_closed', 1, 'sha256:outside', 't3');",
  790 |         "container_disposition_v3_invalid_subject",
  791 |     );
  792 |     reject(
  793 |         &store,
  794 |         "INSERT INTO container_disposition_v3
  795 |              (disposition_id, project_id, container_work_id,
  796 |               descendant_work_id, kind, descendant_revision,
  797 |               descendant_outcome_digest, replacement_work_id, created_at)
  798 |          VALUES ('disposition-bad-shape', 'p1', 'container-1', 'direct-b',
  799 |                  'accepted_closed', 1, 'sha256:bad', 'direct-a', 't3');",
  800 |         "CHECK constraint failed",
  801 |     );
  802 | }
````
