use boreal_source::{Availability, BlobStore, SourceCaptureRequest, SourceCatalog, SourceError};
use std::{
    collections::HashSet,
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Barrier,
    },
    thread,
};

static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

fn test_root(name: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!(
        "boreal-source-{name}-{}-{}",
        std::process::id(),
        TEST_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir_all(&path).unwrap();
    path
}

#[test]
fn concurrent_capture_is_idempotent_per_project_and_digest() {
    let root = test_root("concurrent");
    let catalog = Arc::new(SourceCatalog::with_filesystem(&root));
    let mut workers = Vec::new();

    for _ in 0..16 {
        let catalog = Arc::clone(&catalog);
        workers.push(thread::spawn(move || {
            catalog
                .capture("project-a", "docs/guide.md", b"same bytes", "text/markdown")
                .unwrap()
        }));
    }

    let versions: Vec<_> = workers
        .into_iter()
        .map(|worker| worker.join().unwrap())
        .collect();
    let ids: HashSet<_> = versions
        .iter()
        .map(|version| &version.source_version_id)
        .collect();
    assert_eq!(ids.len(), 1);
    assert_eq!(catalog.version_count().unwrap(), 1);
    assert_eq!(
        catalog.availability(&versions[0]).unwrap(),
        Availability::Available
    );

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn changed_bytes_at_one_origin_create_another_immutable_version() {
    let catalog = SourceCatalog::default();
    let old = catalog
        .capture("project-a", "notes/today.md", b"before", "text/markdown")
        .unwrap();
    let new = catalog
        .capture("project-a", "notes/today.md", b"after", "text/markdown")
        .unwrap();

    assert_ne!(old.source_version_id, new.source_version_id);
    assert_eq!(catalog.verify(&old).unwrap(), b"before");
    assert_eq!(catalog.verify(&new).unwrap(), b"after");
    assert_eq!(catalog.version_count().unwrap(), 2);
}

#[test]
fn missing_and_tampered_files_are_explicitly_unavailable() {
    let root = test_root("integrity");
    let catalog = SourceCatalog::with_filesystem(&root);
    let missing = catalog
        .capture("project-a", "docs/missing.md", b"keep me", "text/markdown")
        .unwrap();
    let store = boreal_source::FilesystemBlobStore::new(&root);
    fs::remove_file(store.blob_path(&missing.content_digest).unwrap()).unwrap();
    assert_eq!(
        catalog.availability(&missing).unwrap(),
        Availability::Missing
    );
    assert_eq!(catalog.verify(&missing), Err(SourceError::MissingBlob));

    let tampered = catalog
        .capture(
            "project-a",
            "docs/tampered.md",
            b"original",
            "text/markdown",
        )
        .unwrap();
    fs::write(
        store.blob_path(&tampered.content_digest).unwrap(),
        b"tampered",
    )
    .unwrap();
    assert_eq!(
        catalog.availability(&tampered).unwrap(),
        Availability::Corrupt
    );
    assert_eq!(catalog.verify(&tampered), Err(SourceError::DigestMismatch));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn traversal_and_cross_project_versions_are_rejected() {
    let catalog = SourceCatalog::default();
    for origin in [
        "../secret",
        "docs/../../secret",
        "/etc/passwd",
        r"..\secret",
    ] {
        assert_eq!(
            catalog.capture("project-a", origin, b"bytes", "text/plain"),
            Err(SourceError::ScopeViolation)
        );
    }
    assert!(catalog
        .capture("project-a", "docs/release..md", b"bytes", "text/plain")
        .is_ok());
    assert_eq!(
        catalog.capture("project/a", "docs/a.md", b"bytes", "text/plain"),
        Err(SourceError::ScopeViolation)
    );

    let version = catalog
        .capture("project-a", "docs/a.md", b"private", "text/plain")
        .unwrap();
    let same_bytes_in_other_project = catalog
        .capture("project-b", "docs/a.md", b"private", "text/plain")
        .unwrap();
    assert_ne!(
        version.source_version_id,
        same_bytes_in_other_project.source_version_id
    );
    let mut cross_project = version.clone();
    cross_project.project_id = "project-b".to_owned();
    assert_eq!(
        catalog.verify(&cross_project),
        Err(SourceError::ScopeViolation)
    );
}

#[test]
fn failed_catalog_flush_does_not_leave_an_in_memory_source_reference() {
    let root = test_root("flush-rollback");
    let catalog_path = root.join("catalog.json");
    let catalog = SourceCatalog::with_persistent_filesystem(&root).unwrap();
    // Block the atomic replacement target so persistence fails after the blob
    // has been verified and before metadata becomes durable.
    fs::create_dir(&catalog_path).unwrap();
    assert!(matches!(
        catalog.capture("project-a", "docs/a.md", b"bytes", "text/plain"),
        Err(SourceError::Storage(_))
    ));
    assert_eq!(catalog.version_count().unwrap(), 0);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn capture_operation_is_durable_idempotent_and_rejects_changed_retry_payloads() {
    let root = test_root("capture-operation");
    let request = SourceCaptureRequest::new(
        "capture-op-1",
        "project-a",
        "docs/a.md",
        "text/markdown",
        b"operation bytes".to_vec(),
    );
    let catalog = SourceCatalog::with_persistent_filesystem(&root).unwrap();
    let first = catalog.capture_with_operation(&request).unwrap();
    assert!(!first.duplicate);
    assert!(!first.reused_existing_version);

    let blob_store = boreal_source::FilesystemBlobStore::new(&root);
    fs::remove_file(
        blob_store
            .blob_path(&first.source_version.content_digest)
            .unwrap(),
    )
    .unwrap();
    let retry = catalog.capture_with_operation(&request).unwrap();
    assert!(retry.duplicate);
    assert_eq!(retry.source_version, first.source_version);
    assert_eq!(retry.source_version.availability, Availability::Available);

    let changed = SourceCaptureRequest::new(
        "capture-op-1",
        "project-a",
        "docs/a.md",
        "text/markdown",
        b"changed bytes".to_vec(),
    );
    assert_eq!(
        catalog.capture_with_operation(&changed),
        Err(SourceError::OperationConflict)
    );

    drop(catalog);
    let restarted = SourceCatalog::with_persistent_filesystem(&root).unwrap();
    let restarted_retry = restarted.capture_with_operation(&request).unwrap();
    assert!(restarted_retry.duplicate);
    assert_eq!(restarted_retry.source_version, first.source_version);
    assert_eq!(
        restarted
            .show_version("project-a", &first.source_version.source_version_id)
            .unwrap(),
        first.source_version
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn persistent_catalog_instances_merge_operation_commits_under_cross_process_lock() {
    let root = test_root("capture-operation-concurrent");
    let barrier = Arc::new(Barrier::new(2));
    let mut workers = Vec::new();
    for (operation, origin, bytes) in [
        ("capture-op-a", "docs/a.md", b"alpha".to_vec()),
        ("capture-op-b", "docs/b.md", b"beta".to_vec()),
    ] {
        let root = root.clone();
        let barrier = Arc::clone(&barrier);
        workers.push(thread::spawn(move || {
            let catalog = SourceCatalog::with_persistent_filesystem(&root).unwrap();
            barrier.wait();
            catalog
                .capture_with_operation(&SourceCaptureRequest::new(
                    operation,
                    "project-a",
                    origin,
                    "text/plain",
                    bytes,
                ))
                .unwrap();
        }));
    }
    for worker in workers {
        worker.join().unwrap();
    }
    let catalog = SourceCatalog::with_persistent_filesystem(&root).unwrap();
    assert_eq!(catalog.version_count().unwrap(), 2);
    assert_eq!(catalog.list_versions(Some("project-a")).unwrap().len(), 2);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn identical_bytes_with_conflicting_immutable_origin_are_not_relabelled() {
    let catalog = SourceCatalog::default();
    let first = catalog
        .capture("project-a", "docs/a.md", b"same", "text/plain")
        .unwrap();
    assert_eq!(
        catalog.capture("project-a", "docs/b.md", b"same", "text/plain"),
        Err(SourceError::SourceMetadataConflict)
    );
    assert_eq!(catalog.verify(&first).unwrap(), b"same");
}

#[cfg(unix)]
#[test]
fn filesystem_blob_store_rejects_symlinked_roots_directories_and_objects() {
    use std::os::unix::fs::symlink;

    let root = test_root("blob-symlink-root");
    let outside = test_root("blob-symlink-root-target");
    let linked_root = root.join("linked-root");
    symlink(&outside, &linked_root).unwrap();
    let linked_store = boreal_source::FilesystemBlobStore::new(&linked_root);
    let digest = boreal_source::content_digest(b"protected");
    assert_eq!(
        linked_store.put(&digest, b"protected"),
        Err(SourceError::ScopeViolation)
    );

    let directory_root = root.join("directory-root");
    fs::create_dir_all(&directory_root).unwrap();
    let linked_blobs = directory_root.join("blobs");
    symlink(&outside, &linked_blobs).unwrap();
    let directory_store = boreal_source::FilesystemBlobStore::new(&directory_root);
    assert_eq!(
        directory_store.put(&digest, b"protected"),
        Err(SourceError::ScopeViolation)
    );

    let object_root = root.join("object-root");
    fs::create_dir_all(object_root.join("blobs")).unwrap();
    let outside_object = outside.join("object");
    fs::write(&outside_object, b"protected").unwrap();
    let object_path = object_root
        .join("blobs")
        .join(digest.strip_prefix("sha256:").unwrap());
    symlink(&outside_object, &object_path).unwrap();
    let object_store = boreal_source::FilesystemBlobStore::new(&object_root);
    assert_eq!(
        object_store.read_verified(&digest, b"protected".len()),
        Err(SourceError::ScopeViolation)
    );
    assert_eq!(
        object_store.put(&digest, b"protected"),
        Err(SourceError::ScopeViolation)
    );

    fs::remove_dir_all(root).unwrap();
    fs::remove_dir_all(outside).unwrap();
}
