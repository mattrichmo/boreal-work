# R-BACKUP-TEST — crates/store/tests/runtime_backup.rs

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `crates/store/tests/runtime_backup.rs:L1–L116`  
**File SHA-256:** `39f4c799c277ae1793e04f8c553fc0cebe0f3e16df80a45ea8e63794b113f2b5`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Existing linked-runtime and backup scaffolding; extend to real interrupted multi-process restore semantics.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,116p' 'crates/store/tests/runtime_backup.rs'
```

## Exact baseline excerpt

````text
    1 | use boreal_store::{SqliteStore, StoreError, SCHEMA_VERSION};
    2 | use std::path::{Path, PathBuf};
    3 | use std::time::{SystemTime, UNIX_EPOCH};
    4 | 
    5 | const SCHEMA: &str = include_str!("../../../project/spec/schema-v2.sql");
    6 | 
    7 | fn temp_path(label: &str) -> PathBuf {
    8 |     let stamp = SystemTime::now()
    9 |         .duration_since(UNIX_EPOCH)
   10 |         .expect("clock before unix epoch")
   11 |         .as_nanos();
   12 |     std::env::temp_dir().join(format!(
   13 |         "boreal-store-{label}-{}-{stamp}.sqlite",
   14 |         std::process::id()
   15 |     ))
   16 | }
   17 | 
   18 | fn remove_sqlite_files(path: &Path) {
   19 |     let _ = std::fs::remove_file(path);
   20 |     let _ = std::fs::remove_file(path.with_extension("sqlite-wal"));
   21 |     let _ = std::fs::remove_file(path.with_extension("sqlite-shm"));
   22 | }
   23 | 
   24 | fn seed(store: &SqliteStore, title: &str) {
   25 |     store
   26 |         .execute_batch(&format!(
   27 |             "INSERT INTO project VALUES ('p1', {SCHEMA_VERSION}, 'boreal.work-status/2', 0, 't0', 't0');
   28 |              INSERT INTO acceptance_profile VALUES ('default', 1, 'sha256:policy', '{{}}', 't0');
   29 |              INSERT INTO work_item (
   30 |                  work_id, project_id, kind, parent_id, lifecycle, dispatch_policy,
   31 |                  priority, acceptance_profile_id, acceptance_profile_version,
   32 |                  title, description, created_at, updated_at
   33 |              ) VALUES ('w1', 'p1', 'task', NULL, 'open', 'automatic', 0,
   34 |                        'default', 1, '{}', '', 't0', 't0');",
   35 |             title.replace('\'', "''")
   36 |         ))
   37 |         .expect("seed source database");
   38 | }
   39 | 
   40 | #[test]
   41 | fn reports_linked_sqlite_runtime_identity() {
   42 |     let store = SqliteStore::open_in_memory(SCHEMA).expect("schema opens");
   43 |     let identity = store.sqlite_runtime_identity();
   44 |     assert!(!identity.libversion.is_empty());
   45 |     assert!(!identity.source_id.is_empty());
   46 |     assert!(identity.version_tuple().is_some());
   47 |     assert!(identity.at_least((3, 0, 0)));
   48 |     assert_eq!(identity.as_json()["libversion"], identity.libversion);
   49 |     assert_eq!(identity.as_json()["source_id"], identity.source_id);
   50 | }
   51 | 
   52 | #[test]
   53 | fn online_backup_and_restore_round_trip_live_database() {
   54 |     let source_path = temp_path("backup-source");
   55 |     let backup_path = temp_path("backup-copy");
   56 |     let restored_path = temp_path("backup-restored");
   57 |     remove_sqlite_files(&source_path);
   58 |     remove_sqlite_files(&backup_path);
   59 |     remove_sqlite_files(&restored_path);
   60 | 
   61 |     let source = SqliteStore::open(&source_path, SCHEMA).expect("source opens");
   62 |     seed(&source, "before backup");
   63 |     let report = source
   64 |         .backup_to(&backup_path)
   65 |         .expect("online backup succeeds");
   66 |     assert!(report.source_page_count > 0);
   67 |     assert_eq!(report.pages_copied, report.source_page_count);
   68 |     assert!(report.busy_retries < 10_001);
   69 | 
   70 |     let copy = SqliteStore::open(&backup_path, SCHEMA).expect("backup opens");
   71 |     assert_eq!(
   72 |         copy.work("p1", "w1").unwrap().unwrap().title,
   73 |         "before backup"
   74 |     );
   75 | 
   76 |     let restored = SqliteStore::open(&restored_path, SCHEMA).expect("restore target opens");
   77 |     let restore_report = restored
   78 |         .restore_from(&source_path)
   79 |         .expect("restore succeeds");
   80 |     assert_eq!(
   81 |         restore_report.pages_copied,
   82 |         restore_report.source_page_count
   83 |     );
   84 |     assert_eq!(
   85 |         restored.work("p1", "w1").unwrap().unwrap().title,
   86 |         "before backup"
   87 |     );
   88 | 
   89 |     let conflict = source.backup_to(&backup_path);
   90 |     assert!(matches!(conflict, Err(StoreError::Conflict(_))));
   91 |     drop(copy);
   92 |     drop(restored);
   93 |     drop(source);
   94 |     remove_sqlite_files(&source_path);
   95 |     remove_sqlite_files(&backup_path);
   96 |     remove_sqlite_files(&restored_path);
   97 | }
   98 | 
   99 | #[test]
  100 | fn query_metrics_are_resettable_and_count_status_reads() {
  101 |     let store = SqliteStore::open_in_memory(SCHEMA).expect("schema opens");
  102 |     seed(&store, "instrumented");
  103 |     store.reset_query_metrics();
  104 |     let status = store.read_project_status("p1").expect("status reads");
  105 |     let metrics = store.query_metrics();
  106 |     assert_eq!(status.works.len(), 1);
  107 |     assert!(metrics.statements_prepared > 0);
  108 |     assert!(metrics.batch_calls >= 2);
  109 |     assert!(metrics.rows_returned >= 1);
  110 |     assert!(metrics.text_bytes_read > 0);
  111 | 
  112 |     store.reset_query_metrics();
  113 |     assert_eq!(store.query_metrics().statements_prepared, 0);
  114 |     assert_eq!(store.query_metrics().rows_returned, 0);
  115 |     assert_eq!(store.query_metrics().text_bytes_read, 0);
  116 | }
````
