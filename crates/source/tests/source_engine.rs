use boreal_source::{Availability, SourceCatalog, SourceError};
use std::{
    collections::HashSet,
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
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
