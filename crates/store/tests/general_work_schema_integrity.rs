//! Reopen-time integrity checks for the additive general-work schema.

use boreal_store::{SqliteStore, StoreError};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

const PRODUCTION_SCHEMA: &str = include_str!("../../../project/spec/schema-production.sql");

fn temp_path() -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock before unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!(
        "boreal-general-work-schema-{}-{stamp}.sqlite",
        std::process::id()
    ))
}

fn remove_sqlite_files(path: &PathBuf) {
    let _ = std::fs::remove_file(path);
    let _ = std::fs::remove_file(path.with_extension("sqlite-wal"));
    let _ = std::fs::remove_file(path.with_extension("sqlite-shm"));
}

#[test]
fn reopen_rejects_a_missing_general_work_immutability_trigger() {
    let path = temp_path();
    remove_sqlite_files(&path);

    let store = SqliteStore::open(&path, PRODUCTION_SCHEMA).expect("production schema opens");
    store
        .execute_batch("DROP TRIGGER boreal_artifact_decision_v1_immutable_delete")
        .expect("synthetic corruption fixture removes one trigger");
    drop(store);

    let reopened = SqliteStore::open(&path, PRODUCTION_SCHEMA);
    assert!(matches!(
        reopened,
        Err(StoreError::Corrupt(message))
            if message.contains("boreal_artifact_decision_v1_immutable_delete")
    ));
    remove_sqlite_files(&path);
}
