use boreal_store::{SqliteStore, StoreError, SCHEMA_VERSION};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const SCHEMA: &str = include_str!("../../../project/spec/schema-v2.sql");

fn temp_path(label: &str) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock before unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!(
        "boreal-store-{label}-{}-{stamp}.sqlite",
        std::process::id()
    ))
}

fn remove_sqlite_files(path: &Path) {
    let _ = std::fs::remove_file(path);
    let _ = std::fs::remove_file(path.with_extension("sqlite-wal"));
    let _ = std::fs::remove_file(path.with_extension("sqlite-shm"));
}

fn seed(store: &SqliteStore, title: &str) {
    store
        .execute_batch(&format!(
            "INSERT INTO project VALUES ('p1', {SCHEMA_VERSION}, 'boreal.work-status/2', 0, 't0', 't0');
             INSERT INTO acceptance_profile VALUES ('default', 1, 'sha256:policy', '{{}}', 't0');
             INSERT INTO work_item (
                 work_id, project_id, kind, parent_id, lifecycle, dispatch_policy,
                 priority, acceptance_profile_id, acceptance_profile_version,
                 title, description, created_at, updated_at
             ) VALUES ('w1', 'p1', 'task', NULL, 'open', 'automatic', 0,
                       'default', 1, '{}', '', 't0', 't0');",
            title.replace('\'', "''")
        ))
        .expect("seed source database");
}

#[test]
fn reports_linked_sqlite_runtime_identity() {
    let store = SqliteStore::open_in_memory(SCHEMA).expect("schema opens");
    let identity = store.sqlite_runtime_identity();
    assert!(!identity.libversion.is_empty());
    assert!(!identity.source_id.is_empty());
    assert!(identity.version_tuple().is_some());
    assert!(identity.at_least((3, 0, 0)));
    assert_eq!(identity.as_json()["libversion"], identity.libversion);
    assert_eq!(identity.as_json()["source_id"], identity.source_id);
}

#[test]
fn online_backup_and_restore_round_trip_live_database() {
    let source_path = temp_path("backup-source");
    let backup_path = temp_path("backup-copy");
    let restored_path = temp_path("backup-restored");
    remove_sqlite_files(&source_path);
    remove_sqlite_files(&backup_path);
    remove_sqlite_files(&restored_path);

    let source = SqliteStore::open(&source_path, SCHEMA).expect("source opens");
    seed(&source, "before backup");
    let report = source
        .backup_to(&backup_path)
        .expect("online backup succeeds");
    assert!(report.source_page_count > 0);
    assert_eq!(report.pages_copied, report.source_page_count);
    assert!(report.busy_retries < 10_001);

    let copy = SqliteStore::open(&backup_path, SCHEMA).expect("backup opens");
    assert_eq!(
        copy.work("p1", "w1").unwrap().unwrap().title,
        "before backup"
    );

    let restored = SqliteStore::open(&restored_path, SCHEMA).expect("restore target opens");
    let restore_report = restored
        .restore_from(&source_path)
        .expect("restore succeeds");
    assert_eq!(
        restore_report.pages_copied,
        restore_report.source_page_count
    );
    assert_eq!(
        restored.work("p1", "w1").unwrap().unwrap().title,
        "before backup"
    );

    let conflict = source.backup_to(&backup_path);
    assert!(matches!(conflict, Err(StoreError::Conflict(_))));
    drop(copy);
    drop(restored);
    drop(source);
    remove_sqlite_files(&source_path);
    remove_sqlite_files(&backup_path);
    remove_sqlite_files(&restored_path);
}

#[test]
fn query_metrics_are_resettable_and_count_status_reads() {
    let store = SqliteStore::open_in_memory(SCHEMA).expect("schema opens");
    seed(&store, "instrumented");
    store.reset_query_metrics();
    let status = store.read_project_status("p1").expect("status reads");
    let metrics = store.query_metrics();
    assert_eq!(status.works.len(), 1);
    assert!(metrics.statements_prepared > 0);
    assert!(metrics.batch_calls >= 2);
    assert!(metrics.rows_returned >= 1);
    assert!(metrics.text_bytes_read > 0);

    store.reset_query_metrics();
    assert_eq!(store.query_metrics().statements_prepared, 0);
    assert_eq!(store.query_metrics().rows_returned, 0);
    assert_eq!(store.query_metrics().text_bytes_read, 0);
}
