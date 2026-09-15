use boreal_memory::{
    publication_identity, rebuild_index, render_manifest, render_markdown, validate_fresh_clone,
    Citation, Draft, DraftState, FindingCode, ImportError, IndexLag, ManifestEntry,
    MemoryAuthority, MemoryDoctor, MemoryRoot, PublicationManifest, PublicationState, PublishError,
    Publisher, RetentionPolicy, RetrievalQuery, SourceTrust,
};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Barrier},
    thread,
    time::{SystemTime, UNIX_EPOCH},
};

fn test_root(label: &str) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let path = std::env::temp_dir().join(format!(
        "boreal-memory-{}-{}-{}",
        label,
        std::process::id(),
        stamp
    ));
    fs::create_dir_all(&path).unwrap();
    path
}

fn draft(entry_id: &str) -> Draft {
    Draft::new(
        "project-1",
        entry_id,
        "A deterministic title",
        "A cited body.",
        vec![Citation {
            source_version_id: "source-1".into(),
            location: "line:4".into(),
        }],
    )
    .unwrap()
}

fn remove(path: &Path) {
    let _ = fs::remove_dir_all(path);
}

#[test]
fn publisher_rejects_unaccepted_drafts_and_publishes_only_accepted_citations() {
    let path = test_root("accepted");
    let publisher = Publisher::new(MemoryRoot::new(&path).unwrap()).unwrap();

    let draft = draft("entry-1");
    assert_eq!(draft.state, DraftState::Draft);
    assert!(matches!(
        publisher.publish(&draft, "operation-1"),
        Err(PublishError::DraftNotAccepted)
    ));
    assert_eq!(
        PublishError::DraftNotAccepted.state(),
        PublicationState::Failed
    );

    let receipt = publisher
        .publish(&draft.review(true), "operation-1")
        .unwrap();
    assert_eq!(receipt.state, PublicationState::Published);
    assert!(fs::read_to_string(path.join("notes/entry-1.md"))
        .unwrap()
        .contains("state: published"));
    remove(&path);
}

#[test]
fn markdown_manifest_and_identity_are_byte_stable() {
    let mut first = draft("entry-1").review(true);
    let mut second = first.clone();
    first.citations.reverse();
    second.citations.reverse();
    assert_eq!(
        render_markdown(&first).unwrap(),
        render_markdown(&second).unwrap()
    );

    let path = test_root("deterministic");
    let publisher = Publisher::new(MemoryRoot::new(&path).unwrap()).unwrap();
    let one = publisher.publish(&first, "operation-1").unwrap();
    let two = publisher.publish(&second, "operation-1").unwrap();
    assert_eq!(one.identity, two.identity);
    assert!(two.duplicate);
    assert_eq!(one.git_revision, two.git_revision);
    let manifest = fs::read_to_string(path.join("manifest.json")).unwrap();
    assert_eq!(
        manifest,
        fs::read_to_string(path.join("manifest.json")).unwrap()
    );
    assert!(fs::read_dir(path.join("notes")).unwrap().all(|entry| !entry
        .unwrap()
        .file_name()
        .to_string_lossy()
        .contains(".tmp-")));
    remove(&path);
}

#[test]
fn staged_publication_recovers_after_restart_without_changing_provenance() {
    let path = test_root("staged-restart");
    let accepted = draft("entry-1").review(true);
    let operation_id = "operation-staged-restart";
    let first = Publisher::new(MemoryRoot::new(&path).unwrap()).unwrap();
    let identity = publication_identity(&accepted, operation_id).unwrap();

    // Model a crash after the atomic note/manifest writes and `git add`, but
    // before the publisher can create its commit. This stays at the memory/Git
    // boundary and does not claim to prove store or application recovery.
    let markdown = render_markdown(&accepted)
        .unwrap()
        .replace("state: accepted", "state: published");
    let manifest = PublicationManifest::new(
        "project-1",
        operation_id,
        ManifestEntry {
            memory_entry_id: "entry-1".into(),
            project_id: "project-1".into(),
            state: PublicationState::Published,
            content_digest: identity.content_digest.clone(),
            source_citations: vec!["source-1".into()],
            manifest_path: "notes/entry-1.md".into(),
            operation_id: operation_id.into(),
            provenance_preserved: true,
        },
    )
    .unwrap();
    fs::write(first.root().entry_path("entry-1").unwrap(), markdown).unwrap();
    fs::write(first.root().manifest_path(), render_manifest(&manifest)).unwrap();
    let staged = Command::new("git")
        .args([
            "-C",
            path.to_str().unwrap(),
            "add",
            "--",
            "manifest.json",
            "notes/entry-1.md",
        ])
        .output()
        .unwrap();
    assert!(staged.status.success(), "git add failed: {:?}", staged);
    drop(first);

    let restarted = Publisher::new(MemoryRoot::new(&path).unwrap()).unwrap();
    let receipt = restarted.publish(&accepted, operation_id).unwrap();
    assert_eq!(receipt.state, PublicationState::Published);
    assert!(!receipt.duplicate);
    assert_eq!(receipt.identity, identity);

    let imported = restarted.reimport("project-1").unwrap();
    assert_eq!(imported.entries.len(), 1);
    assert_eq!(imported.entries[0].operation_id, operation_id);
    assert_eq!(imported.entries[0].source_citations, vec!["source-1"]);
    assert_eq!(imported.entries[0].content_digest, identity.content_digest);
    assert!(fs::read_to_string(path.join("manifest.json"))
        .unwrap()
        .contains("\"provenance_preserved\":true"));

    // A second publisher instance observes the committed identity as a
    // duplicate, rather than creating a second publication or changing refs.
    let retry = Publisher::new(MemoryRoot::new(&path).unwrap())
        .unwrap()
        .publish(&accepted, operation_id)
        .unwrap();
    assert!(retry.duplicate);
    assert_eq!(retry.identity, receipt.identity);
    assert_eq!(retry.git_revision, receipt.git_revision);
    remove(&path);
}

#[test]
fn publication_retry_removes_only_abandoned_publisher_temps() {
    let path = test_root("abandoned-temp-retry");
    let accepted = draft("entry-1").review(true);
    let publisher = Publisher::new(MemoryRoot::new(&path).unwrap()).unwrap();

    fs::write(path.join(".manifest.json.tmp-crashed"), b"partial manifest").unwrap();
    fs::write(path.join("notes/.entry-1.md.tmp-crashed"), b"partial note").unwrap();

    let receipt = publisher
        .publish(&accepted, "operation-temp-retry")
        .unwrap();
    assert_eq!(receipt.state, PublicationState::Published);
    assert!(!path.join(".manifest.json.tmp-crashed").exists());
    assert!(!path.join("notes/.entry-1.md.tmp-crashed").exists());

    fs::write(
        path.join("notes/human-edit.md"),
        b"preserve this unrelated file",
    )
    .unwrap();
    assert!(path.join("notes/human-edit.md").exists());
    assert!(matches!(
        publisher.publish(&accepted, "operation-temp-retry"),
        Err(PublishError::Conflict(_))
    ));
    remove(&path);
}

#[test]
fn concurrent_same_operation_publication_has_one_commit_identity() {
    let path = test_root("concurrent-publication");
    let accepted = Arc::new(draft("entry-1").review(true));
    let _initialized = Publisher::new(MemoryRoot::new(&path).unwrap()).unwrap();
    let barrier = Arc::new(Barrier::new(8));
    let mut workers = Vec::new();
    for _ in 0..8 {
        let path = path.clone();
        let accepted = Arc::clone(&accepted);
        let barrier = Arc::clone(&barrier);
        workers.push(thread::spawn(move || {
            let publisher = Publisher::new(MemoryRoot::new(&path).unwrap()).unwrap();
            barrier.wait();
            publisher.publish(&accepted, "operation-concurrent")
        }));
    }

    let results = workers
        .into_iter()
        .map(|worker| worker.join().unwrap())
        .collect::<Vec<_>>();
    let published = results
        .iter()
        .filter_map(|result| result.as_ref().ok())
        .collect::<Vec<_>>();
    assert_eq!(published.len(), 8, "results: {results:?}");
    assert_eq!(published[0].state, PublicationState::Published);
    assert_eq!(
        published
            .iter()
            .filter(|receipt| !receipt.duplicate)
            .count(),
        1,
        "results: {results:?}"
    );
    assert!(
        results.iter().all(|result| {
            matches!(result, Ok(receipt) if receipt.identity == published[0].identity)
                || matches!(result, Err(PublishError::Conflict(_)))
        }),
        "results: {results:?}"
    );
    remove(&path);
}

#[test]
fn memory_root_rejects_traversal_and_manifest_paths_are_checked() {
    assert!(MemoryRoot::new(PathBuf::from("safe/../outside")).is_err());
    let path = test_root("traversal");
    let root = MemoryRoot::new(&path).unwrap();
    assert!(root.entry_path("../outside").is_err());
    assert!(root.entry_path("nested/entry").is_err());

    fs::create_dir_all(path.join("notes")).unwrap();
    let manifest = PublicationManifest::new(
        "project-1",
        "operation-1",
        ManifestEntry {
            memory_entry_id: "entry-1".into(),
            project_id: "project-1".into(),
            state: PublicationState::Published,
            content_digest: "fnv1a64:0000000000000000".into(),
            source_citations: vec!["source-1".into()],
            manifest_path: "../outside.md".into(),
            operation_id: "operation-1".into(),
            provenance_preserved: true,
        },
    )
    .unwrap();
    fs::write(path.join("manifest.json"), render_manifest(&manifest)).unwrap();
    assert!(matches!(
        validate_fresh_clone(&path, "project-1"),
        Err(ImportError::InvalidPath)
    ));
    remove(&path);
}

#[test]
fn fresh_clone_reimports_and_detects_tampering() {
    let source = test_root("source");
    let publisher = Publisher::new(MemoryRoot::new(&source).unwrap()).unwrap();
    let receipt = publisher
        .publish(&draft("entry-1").review(true), "operation-1")
        .unwrap();

    let clone = test_root("clone");
    fs::remove_dir_all(&clone).unwrap();
    let output = Command::new("git")
        .args(["clone", source.to_str().unwrap(), clone.to_str().unwrap()])
        .output()
        .unwrap();
    assert!(output.status.success(), "git clone failed: {:?}", output);
    let clone_publisher = Publisher::new(MemoryRoot::new(&clone).unwrap()).unwrap();
    let report = clone_publisher.reimport("project-1").unwrap();
    assert_eq!(report.entries.len(), 1);
    assert_eq!(report.entries[0].memory_entry_id, "entry-1");
    assert_eq!(report.git_revision, receipt.git_revision);

    fs::OpenOptions::new()
        .append(true)
        .open(clone.join("notes/entry-1.md"))
        .unwrap()
        .write_all(b"\ntampered\n")
        .unwrap();
    assert!(matches!(
        validate_fresh_clone(&clone, "project-1"),
        Err(ImportError::DigestMismatch(entry)) if entry == "entry-1"
    ));
    assert!(matches!(
        clone_publisher.reimport("project-1"),
        Err(ImportError::Git(_))
    ));
    remove(&source);
    remove(&clone);
}

#[test]
fn retrieval_is_scoped_deterministic_and_cited() {
    let path = test_root("retrieval");
    let publisher = Publisher::new(MemoryRoot::new(&path).unwrap()).unwrap();
    let receipt = publisher
        .publish(&draft("entry-1").review(true), "operation-1")
        .unwrap();
    let index = rebuild_index(&path, "project-1").unwrap();
    let query = RetrievalQuery::new("project-1")
        .unwrap()
        .with_text("cited body")
        .with_source_version("source-1")
        .with_max_excerpt_bytes(8);
    let first = index.search(&query).unwrap();
    let second = index.search(&query).unwrap();
    assert_eq!(first, second);
    assert_eq!(first.hits.len(), 1);
    let hit = &first.hits[0];
    assert_eq!(hit.entry_id, "entry-1");
    assert_eq!(hit.content_digest, receipt.identity.content_digest);
    assert_eq!(hit.git_revision, receipt.git_revision);
    assert_eq!(hit.authority, MemoryAuthority::PublishedGit);
    assert_eq!(hit.source_trust, SourceTrust::ImmutableVersionCitation);
    assert!(hit.excerpt.len() <= 8);
    assert!(hit.excerpt.ends_with('…'));
    assert_eq!(first.lag, IndexLag::Current);
    assert!(matches!(
        index.search(&RetrievalQuery::new("other-project").unwrap()),
        Err(boreal_memory::IndexError::InvalidQuery(_))
    ));
    remove(&path);
}

#[test]
fn doctor_identifies_manifest_tampering_without_repairing_canonical_files() {
    let path = test_root("doctor-manifest");
    let publisher = Publisher::new(MemoryRoot::new(&path).unwrap()).unwrap();
    publisher
        .publish(&draft("entry-1").review(true), "operation-1")
        .unwrap();
    let manifest_path = path.join("manifest.json");
    let original = fs::read_to_string(&manifest_path).unwrap();
    fs::write(
        &manifest_path,
        original.replace("operation-1", "tampered-operation"),
    )
    .unwrap();
    let report = MemoryDoctor::inspect(&path, "project-1");
    assert!(report.has_errors());
    assert!(report
        .findings
        .iter()
        .any(|finding| finding.code == FindingCode::ManifestIdentityMismatch));
    assert!(MemoryDoctor::repair_index(&path, "project-1").is_err());
    assert_eq!(
        fs::read_to_string(&manifest_path).unwrap(),
        original.replace("operation-1", "tampered-operation")
    );
    remove(&path);
}

#[test]
fn doctor_identifies_tampered_note_and_rebuild_is_idempotent() {
    let path = test_root("doctor-note");
    let publisher = Publisher::new(MemoryRoot::new(&path).unwrap()).unwrap();
    publisher
        .publish(&draft("entry-1").review(true), "operation-1")
        .unwrap();
    let before = rebuild_index(&path, "project-1").unwrap();
    let original_note = fs::read(path.join("notes/entry-1.md")).unwrap();
    fs::OpenOptions::new()
        .append(true)
        .open(path.join("notes/entry-1.md"))
        .unwrap()
        .write_all(b"tampered")
        .unwrap();
    let report = MemoryDoctor::inspect(&path, "project-1");
    assert!(report
        .findings
        .iter()
        .any(|finding| finding.code == FindingCode::EntryDigestMismatch));
    fs::write(path.join("notes/entry-1.md"), original_note).unwrap();
    // The repaired/rebuilt projection is deterministic and never mutates the
    // managed Git files; callers can persist it in the application index.
    let repaired = MemoryDoctor::repair_index(&path, "project-1").unwrap();
    let rebuilt = rebuild_index(&path, "project-1").unwrap();
    assert_eq!(repaired, rebuilt);
    assert_eq!(repaired.index_revision(), before.index_revision());
    remove(&path);
}

#[test]
fn retention_only_bounds_the_derived_index_and_preserves_published_memory() {
    let path = test_root("retention");
    let publisher = Publisher::new(MemoryRoot::new(&path).unwrap()).unwrap();
    publisher
        .publish(&draft("entry-1").review(true), "operation-1")
        .unwrap();
    let index = rebuild_index(&path, "project-1").unwrap();
    assert_eq!(
        index
            .retained(RetentionPolicy::keep_at_most(1))
            .entry_count(),
        1
    );
    assert_eq!(
        index
            .retained(RetentionPolicy::keep_at_most(0))
            .entry_count(),
        0
    );
    assert!(validate_fresh_clone(&path, "project-1").is_ok());
    assert!(path.join("notes/entry-1.md").exists());
    remove(&path);
}
