//! Focused contract coverage for the additive immutable Intake-delivery schema.

use boreal_store::{INTAKE_DELIVERY_SCHEMA_VERSION, SqliteStore, StoreError};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const PRODUCTION_SCHEMA: &str = include_str!("../../../project/spec/schema-production.sql");

fn temp_path(label: &str) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock before unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!(
        "boreal-intake-delivery-{label}-{}-{stamp}.sqlite",
        std::process::id()
    ))
}

fn remove_sqlite_files(path: &Path) {
    let _ = std::fs::remove_file(path);
    let _ = std::fs::remove_file(path.with_extension("sqlite-wal"));
    let _ = std::fs::remove_file(path.with_extension("sqlite-shm"));
}

fn open_canonical(path: &Path) -> SqliteStore {
    SqliteStore::open(path, PRODUCTION_SCHEMA).expect("canonical production database opens")
}

fn seed_intakes(store: &SqliteStore) {
    store
        .execute_batch(
            "INSERT INTO project
                 (project_id, schema_version, status_contract_version,
                  project_revision, created_at, updated_at)
             VALUES ('p1', 2, 'boreal.work-status/2', 0, 't0', 't0'),
                    ('p2', 2, 'boreal.work-status/2', 0, 't0', 't0');
             INSERT INTO intake_bucket_v3
                 (bucket_id, project_id, name, created_at, updated_at)
             VALUES ('b1', 'p1', 'Inbox one', 't0', 't0'),
                    ('b2', 'p2', 'Inbox two', 't0', 't0');
             INSERT INTO intake_item_v3
                 (intake_id, project_id, bucket_id, kind, lifecycle, content,
                  content_revision, content_digest, captured_at, updated_at)
             VALUES ('i1', 'p1', 'b1', 'discovery', 'captured', 'first item',
                     1, 'sha256:i1', 't0', 't0'),
                    ('i2', 'p1', 'b1', 'discovery', 'captured', 'second item',
                     1, 'sha256:i2', 't0', 't0'),
                    ('i3', 'p2', 'b2', 'discovery', 'captured', 'other project item',
                     1, 'sha256:i3', 't0', 't0');",
        )
        .expect("project and Intake fixtures seed");
}

fn insert_receipt(store: &SqliteStore, project: &str, key: &str, intake: &str) {
    let sql = format!(
        "INSERT INTO intake_delivery_v1
             (project_id, delivery_key, intake_id, origin_kind, origin_item_id,
              origin_digest, payload_digest, created_at)
         VALUES ('{project}', '{key}', '{intake}', 'global_inbox', 'capture-1',
                 'sha256:origin', 'sha256:payload', 't1');"
    );
    store.execute_batch(&sql).expect("receipt inserts");
}

fn assert_constraint(store: &SqliteStore, sql: &str, expected: &str) {
    let error = store
        .execute_batch(sql)
        .expect_err("invalid receipt mutation must be rejected");
    assert!(
        matches!(error, StoreError::Constraint { .. }),
        "expected a SQLite constraint error, got {error:?}"
    );
    assert!(
        error.to_string().contains(expected),
        "expected {expected:?} in {error:?}"
    );
}

#[test]
fn canonical_open_installs_and_reopens_the_exact_additive_contract() {
    let path = temp_path("canonical-open");
    remove_sqlite_files(&path);

    {
        let store = open_canonical(&path);
        assert!(store.foreign_keys_enabled().expect("foreign keys state"));
        store
            .ensure_intake_delivery_schema()
            .expect("first canonical open installs the Intake-delivery feature");
        seed_intakes(&store);
        insert_receipt(&store, "p1", "delivery-1", "i1");
    }

    {
        let store = open_canonical(&path);
        store
            .ensure_intake_delivery_schema()
            .expect("reopen verifies the installed feature contract");
        assert_eq!(INTAKE_DELIVERY_SCHEMA_VERSION, 1);
        assert!(store.foreign_keys_enabled().expect("foreign keys state"));
    }

    remove_sqlite_files(&path);
}

#[test]
fn receipt_identity_is_project_scoped_and_references_one_project_intake() {
    let path = temp_path("constraints");
    remove_sqlite_files(&path);
    let store = open_canonical(&path);
    seed_intakes(&store);

    insert_receipt(&store, "p1", "delivery-1", "i1");
    insert_receipt(&store, "p2", "delivery-1", "i3");

    assert_constraint(
        &store,
        "INSERT INTO intake_delivery_v1
             (project_id, delivery_key, intake_id, origin_kind, origin_item_id,
              origin_digest, payload_digest, created_at)
         VALUES ('p1', 'delivery-1', 'i2', 'global_inbox', 'capture-2',
                 'sha256:origin', 'sha256:payload', 't1');",
        "UNIQUE constraint failed",
    );
    assert_constraint(
        &store,
        "INSERT INTO intake_delivery_v1
             (project_id, delivery_key, intake_id, origin_kind, origin_item_id,
              origin_digest, payload_digest, created_at)
         VALUES ('p1', 'delivery-2', 'i1', 'global_inbox', 'capture-3',
                 'sha256:origin', 'sha256:payload', 't1');",
        "UNIQUE constraint failed",
    );
    assert_constraint(
        &store,
        "INSERT INTO intake_delivery_v1
             (project_id, delivery_key, intake_id, origin_kind, origin_item_id,
              origin_digest, payload_digest, created_at)
         VALUES ('p1', 'delivery-3', 'i3', 'global_inbox', 'capture-4',
                 'sha256:origin', 'sha256:payload', 't1');",
        "FOREIGN KEY constraint failed",
    );

    assert_constraint(
        &store,
        "UPDATE intake_delivery_v1 SET origin_digest = 'sha256:changed'
         WHERE project_id = 'p1' AND delivery_key = 'delivery-1';",
        "intake_delivery_receipts_are_immutable",
    );
    assert_constraint(
        &store,
        "DELETE FROM intake_delivery_v1
         WHERE project_id = 'p1' AND delivery_key = 'delivery-1';",
        "intake_delivery_receipts_are_immutable",
    );

    drop(store);
    remove_sqlite_files(&path);
}

#[test]
fn canonical_reopen_rejects_a_changed_feature_contract() {
    for (label, mutation) in [
        (
            "changed-version",
            "UPDATE boreal_feature_schema SET version = 2 WHERE feature = 'intake_delivery';",
        ),
        (
            "changed-sql",
            "UPDATE boreal_feature_schema SET sql = sql || ' -- changed'
             WHERE feature = 'intake_delivery';",
        ),
    ] {
        let path = temp_path(label);
        remove_sqlite_files(&path);
        let store = open_canonical(&path);
        store
            .execute_batch(mutation)
            .expect("feature contract fixture mutates");
        drop(store);

        let error = SqliteStore::open(&path, PRODUCTION_SCHEMA)
            .expect_err("canonical reopen rejects contract drift");
        assert!(
            matches!(error, StoreError::Conflict(_)),
            "expected feature migration conflict, got {error:?}"
        );
        assert!(
            error.to_string().contains("intake_delivery"),
            "expected Intake-delivery contract error, got {error:?}"
        );
        remove_sqlite_files(&path);
    }
}
