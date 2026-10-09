use boreal_store::global_manager::GlobalManagerStore;
use boreal_store::StoreError;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

fn temp_root(label: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "boreal-global-recovery-{label}-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock after epoch")
            .as_nanos()
    ))
}

fn set_projects(store: &GlobalManagerStore, ids: &[&str], operation: &str) {
    store
        .mutate("fixture", &json!({}), operation, |mut state, _| {
            state["projects"] =
                Value::Array(ids.iter().map(|id| json!({"id": id, "name": id})).collect());
            Ok((state, json!({"projects": ids.len()})))
        })
        .expect("fixture state mutation");
}

fn clean(root: &Path) {
    let _ = fs::remove_dir_all(root);
}

#[test]
fn physical_backup_restores_history_with_fresh_identity_and_retains_previous_database() {
    let root = temp_root("roundtrip");
    fs::create_dir_all(&root).unwrap();
    let database = root.join("global.sqlite");
    let package = root.join("backup-package");

    let store = GlobalManagerStore::open(&database).expect("Global store opens");
    set_projects(&store, &["kept-project"], "fixture-source");
    let expected_history = store
        .revision_history()
        .expect("source history is readable");
    let (expected_activity, expected_activity_count) = store
        .activity(None, None, 20, 0)
        .expect("source audit history is readable");
    let expected_operation = store
        .operation_result("fixture-source")
        .expect("source operation receipt is readable");
    let backup = store
        .backup_package_to(&package)
        .expect("physical backup package validates");
    assert!(backup.byte_count > 0);
    assert!(backup.database_checksum.starts_with("sha256:"));
    assert!(backup.manifest_checksum.starts_with("sha256:"));
    assert_eq!(backup.schema_version, 2);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(&package).unwrap().permissions().mode() & 0o777,
            0o700
        );
        assert_eq!(
            fs::metadata(&backup.database_path)
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        assert_eq!(
            fs::metadata(&backup.manifest_path)
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }

    set_projects(&store, &["replacement-project"], "fixture-current");
    let blocked = GlobalManagerStore::restore_package_to(&database, &package, "restore-live")
        .expect_err("a live Global store must block exclusive restore admission");
    assert!(matches!(blocked, StoreError::Busy(_)));
    assert_eq!(
        store.state().unwrap()["projects"][0]["id"],
        "replacement-project"
    );
    drop(store);

    let restored = GlobalManagerStore::restore_package_to(&database, &package, "restore-roundtrip")
        .expect("restore activates the verified staged database");
    assert_eq!(restored.source_database_id, backup.database_id);
    assert_ne!(restored.current_database_id, backup.database_id);
    assert_eq!(restored.current_revision, backup.revision);
    assert!(restored.previous_database_path.as_ref().unwrap().exists());

    let active = GlobalManagerStore::open(&database).expect("restored Global store reopens");
    assert_eq!(active.state().unwrap()["projects"][0]["id"], "kept-project");
    assert_eq!(active.revision().unwrap(), backup.revision);
    let restored_history = active.revision_history().unwrap();
    assert!(restored_history.len() > expected_history.len());
    assert_eq!(
        &restored_history[..expected_history.len()],
        expected_history.as_slice()
    );
    assert_eq!(
        restored_history.last().unwrap()["revision"].as_u64(),
        Some(backup.revision)
    );
    assert_eq!(
        restored_history.last().unwrap()["snapshot"]["projects"][0]["id"],
        "kept-project"
    );
    let (restored_activity, restored_activity_count) = active
        .activity(None, None, 20, 0)
        .expect("restored audit history is readable");
    assert_eq!(restored_activity_count, expected_activity_count);
    assert_eq!(restored_activity, expected_activity);
    assert_eq!(
        active.operation_result("fixture-source").unwrap(),
        expected_operation
    );
    drop(active);
    clean(&root);
}

#[test]
fn invalid_global_package_is_rejected_before_replacing_active_database() {
    let root = temp_root("invalid");
    fs::create_dir_all(&root).unwrap();
    let database = root.join("global.sqlite");
    let package = root.join("backup-package");

    let store = GlobalManagerStore::open(&database).expect("Global store opens");
    set_projects(&store, &["active-project"], "fixture-active");
    let backup = store
        .backup_package_to(&package)
        .expect("physical backup package validates");
    drop(store);

    let manifest_path = package.join("manifest.json");
    let mut manifest: Value = serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
    manifest["database"]["sha256"] = json!("sha256:tampered");
    fs::write(
        &manifest_path,
        serde_json::to_vec_pretty(&manifest).unwrap(),
    )
    .unwrap();

    let error = GlobalManagerStore::restore_package_to(&database, &package, "restore-invalid")
        .expect_err("manifest mismatch must reject before touching the active database");
    assert!(matches!(error, StoreError::Conflict(message) if message.contains("size or checksum")));
    let active = GlobalManagerStore::open(&database).expect("active database remains usable");
    assert_eq!(
        active.state().unwrap()["projects"][0]["id"],
        "active-project"
    );
    assert_ne!(active.revision().unwrap(), 0);
    drop(active);
    clean(&root);
    let _ = backup;
}

#[test]
fn large_physical_backup_restores_successfully() {
    const MINIMUM_BYTES: u64 = 64 * 1024 * 1024;
    let root = temp_root("large-roundtrip");
    fs::create_dir_all(&root).unwrap();
    let database = root.join("global.sqlite");
    let package = root.join("large-backup-package");

    let store = GlobalManagerStore::open(&database).expect("Global store opens");
    let large_private_note = "x".repeat((MINIMUM_BYTES + 1024) as usize);
    store
        .mutate(
            "fixture",
            &json!({}),
            "fixture-large-note",
            |mut state, _| {
                state["notes"] = json!([{"id":"large-note","text":large_private_note}]);
                Ok((state, json!({"note":"large-note"})))
            },
        )
        .expect("synthetic private note persists");
    let backup = store
        .backup_package_to(&package)
        .expect("large physical backup validates");
    assert!(backup.byte_count > MINIMUM_BYTES);
    drop(store);

    let restored = GlobalManagerStore::restore_package_to(&database, &package, "restore-large")
        .expect("large verified package restores");
    assert_eq!(restored.source_database_id, backup.database_id);
    assert_ne!(restored.current_database_id, backup.database_id);
    let active = GlobalManagerStore::open(&database).expect("restored large Global DB opens");
    let state = active
        .state()
        .expect("large note is readable after restore");
    assert_eq!(
        state["notes"][0]["text"].as_str().unwrap().len() as u64,
        MINIMUM_BYTES + 1024
    );
    drop(active);
    clean(&root);
}
