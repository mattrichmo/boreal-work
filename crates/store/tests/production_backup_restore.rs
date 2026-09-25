use boreal_store::identity::{IdentityStore, WorkspaceBinding};
use boreal_store::{SqliteStore, StoreError};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const PRODUCTION_SCHEMA: &str = include_str!("../../../project/spec/schema-production.sql");

fn temp_path(label: &str) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock before unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!(
        "boreal-production-backup-{label}-{}-{stamp}",
        std::process::id()
    ))
}

fn remove_sqlite_files(path: &Path) {
    let _ = fs::remove_file(path);
    let _ = fs::remove_file(path.with_extension("sqlite-wal"));
    let _ = fs::remove_file(path.with_extension("sqlite-shm"));
}

fn initialize(path: &Path, project_id: &str) -> SqliteStore {
    let store = SqliteStore::open(path, PRODUCTION_SCHEMA).expect("production store opens");
    store
        .create_project(project_id, "unix-ms:1")
        .expect("project creates");
    let binding = WorkspaceBinding::new(
        "/tmp/boreal-backup-root",
        "/tmp/boreal-backup-root/worktree",
        "sha256:backup-binding",
    )
    .expect("binding validates");
    IdentityStore::new(&store)
        .bind_project(project_id, &binding, "unix-ms:1")
        .expect("project binds");
    store
}

#[test]
fn production_package_round_trip_advances_epoch_and_retains_previous_database() {
    let source_path = temp_path("source.sqlite");
    let target_path = temp_path("target.sqlite");
    let package_path = temp_path("package");
    remove_sqlite_files(&source_path);
    remove_sqlite_files(&target_path);
    let _ = fs::remove_dir_all(&package_path);

    let source = initialize(&source_path, "source-project");
    let source_identity = IdentityStore::new(&source)
        .database_identity()
        .expect("source identity");
    let package = source
        .backup_package_to(&package_path)
        .expect("production backup package succeeds");
    assert!(package.restore_supported);
    assert_eq!(package.project_count, 1);
    assert_eq!(package.referenced_blob_count, 0);
    assert_eq!(package.published_memory_count, 0);
    drop(source);

    let target = initialize(&target_path, "old-project");
    let target_identity = IdentityStore::new(&target)
        .database_identity()
        .expect("target identity");
    drop(target);

    let restored = SqliteStore::restore_package_to(&package_path, &target_path)
        .expect("validated package restores");
    assert_eq!(
        restored.source_restore_epoch,
        source_identity.restore_epoch.get()
    );
    assert!(restored.current_restore_epoch > target_identity.restore_epoch.get());
    let previous = restored
        .previous_database_path
        .as_ref()
        .expect("previous target is retained");
    assert!(previous.exists());

    let reopened = SqliteStore::open(&target_path, PRODUCTION_SCHEMA).expect("restored opens");
    assert_eq!(reopened.list_project_ids().unwrap(), vec!["source-project"]);
    let current_identity = IdentityStore::new(&reopened)
        .database_identity()
        .expect("restored identity");
    assert_eq!(
        current_identity.restore_epoch.get(),
        restored.current_restore_epoch
    );
    assert_ne!(
        current_identity.database_instance_id.as_str(),
        source_identity.database_instance_id.as_str()
    );

    drop(reopened);
    let _ = fs::remove_dir_all(&package_path);
    remove_sqlite_files(&source_path);
    remove_sqlite_files(&target_path);
    remove_sqlite_files(previous);
}

#[test]
fn restore_fails_closed_when_another_connection_holds_a_read_transaction() {
    let source_path = temp_path("active-reader-source.sqlite");
    let target_path = temp_path("active-reader-target.sqlite");
    let package_path = temp_path("active-reader-package");
    remove_sqlite_files(&source_path);
    remove_sqlite_files(&target_path);
    let _ = fs::remove_dir_all(&package_path);

    let source = initialize(&source_path, "replacement-project");
    let source_package = source
        .backup_package_to(&package_path)
        .expect("source backup package succeeds");
    assert!(source_package.restore_supported);
    drop(source);

    let target = initialize(&target_path, "original-project");
    let original_identity = IdentityStore::new(&target)
        .database_identity()
        .expect("original target identity");

    let reader =
        SqliteStore::open(&target_path, PRODUCTION_SCHEMA).expect("second target connection opens");
    reader
        .execute_batch("BEGIN; SELECT project_id FROM project;")
        .expect("reader transaction reads the original project");

    let error = SqliteStore::restore_package_to(&package_path, &target_path)
        .expect_err("restore must fail while another connection holds a read transaction");
    assert!(
        matches!(error, StoreError::Busy(_)),
        "unexpected error: {error:?}"
    );
    assert!(
        target_path.exists(),
        "original target file must remain present"
    );
    let destination_after_failure = SqliteStore::open(&target_path, PRODUCTION_SCHEMA)
        .expect("destination path still opens after rejected restore");
    assert_eq!(
        destination_after_failure
            .list_project_ids()
            .expect("original target remains readable"),
        vec!["original-project"]
    );
    let identity_after_failure = IdentityStore::new(&destination_after_failure)
        .database_identity()
        .expect("identity at destination path remains readable");
    assert_eq!(
        identity_after_failure.database_instance_id, original_identity.database_instance_id,
        "failed restore must not replace the destination database"
    );
    assert_eq!(
        identity_after_failure.restore_epoch, original_identity.restore_epoch,
        "failed restore must not advance the restore epoch"
    );

    drop(destination_after_failure);
    reader
        .execute_batch("ROLLBACK")
        .expect("reader transaction closes");
    drop(reader);
    drop(target);
    let _ = fs::remove_dir_all(&package_path);
    remove_sqlite_files(&source_path);
    remove_sqlite_files(&target_path);
}

#[test]
fn incompatible_manifest_is_rejected_before_destination_creation() {
    let source_path = temp_path("incompatible-source.sqlite");
    let package_path = temp_path("incompatible-package");
    let target_path = temp_path("incompatible-target.sqlite");
    remove_sqlite_files(&source_path);
    remove_sqlite_files(&target_path);
    let _ = fs::remove_dir_all(&package_path);

    let source = initialize(&source_path, "manifest-project");
    source
        .backup_package_to(&package_path)
        .expect("backup succeeds");
    drop(source);

    let manifest_path = package_path.join("manifest.json");
    let mut manifest: Value = serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
    manifest["schema"]["checksum"] = Value::String("sha256:wrong".to_owned());
    fs::write(
        &manifest_path,
        serde_json::to_vec_pretty(&manifest).unwrap(),
    )
    .unwrap();

    let error = SqliteStore::restore_package_to(&package_path, &target_path)
        .expect_err("incompatible manifest must fail closed");
    assert!(matches!(error, StoreError::Conflict(message) if message.contains("schema identity")));
    assert!(!target_path.exists());

    let _ = fs::remove_dir_all(&package_path);
    remove_sqlite_files(&source_path);
    remove_sqlite_files(&target_path);
}

#[test]
fn database_tampering_is_rejected_by_the_manifest_digest() {
    let source_path = temp_path("tampered-source.sqlite");
    let package_path = temp_path("tampered-package");
    let target_path = temp_path("tampered-target.sqlite");
    remove_sqlite_files(&source_path);
    remove_sqlite_files(&target_path);
    let _ = fs::remove_dir_all(&package_path);

    let source = initialize(&source_path, "tampered-project");
    source
        .backup_package_to(&package_path)
        .expect("backup succeeds");
    drop(source);
    let database_path = package_path.join("database.sqlite");
    let mut bytes = fs::read(&database_path).expect("backup database reads");
    bytes.push(0);
    fs::write(&database_path, bytes).expect("tampered database writes");

    let error = SqliteStore::restore_package_to(&package_path, &target_path)
        .expect_err("tampered database must fail closed");
    assert!(matches!(error, StoreError::Conflict(message) if message.contains("database digest")));
    assert!(!target_path.exists());

    let _ = fs::remove_dir_all(&package_path);
    remove_sqlite_files(&source_path);
    remove_sqlite_files(&target_path);
}

#[test]
fn external_blob_reference_is_recorded_and_blocks_incomplete_restore() {
    let source_path = temp_path("blob-source.sqlite");
    let package_path = temp_path("blob-package");
    let target_path = temp_path("blob-target.sqlite");
    remove_sqlite_files(&source_path);
    remove_sqlite_files(&target_path);
    let _ = fs::remove_dir_all(&package_path);

    let source = initialize(&source_path, "blob-project");
    source
        .execute_batch(
            "INSERT INTO blob
               (blob_digest, byte_count, media_type, path, verified_at, created_at)
             VALUES ('sha256:blob', 4, 'text/plain', '/outside/backup/blob',
                     'unix-ms:2', 'unix-ms:1');",
        )
        .expect("blob reference inserts");
    let package = source
        .backup_package_to(&package_path)
        .expect("database and manifest backup succeeds");
    assert_eq!(package.referenced_blob_count, 1);
    assert!(!package.restore_supported);
    drop(source);

    let error = SqliteStore::restore_package_to(&package_path, &target_path)
        .expect_err("external reference must block incomplete restore");
    assert!(matches!(error, StoreError::Conflict(message) if message.contains("external blobs")));
    assert!(!target_path.exists());

    let _ = fs::remove_dir_all(&package_path);
    remove_sqlite_files(&source_path);
    remove_sqlite_files(&target_path);
}
