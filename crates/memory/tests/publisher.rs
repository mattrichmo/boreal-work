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

fn manifest_entry_from(
    draft: &Draft,
    receipt: &boreal_memory::PublicationReceipt,
    operation_id: &str,
) -> ManifestEntry {
    ManifestEntry {
        memory_entry_id: draft.entry_id.clone(),
        project_id: draft.project_id.clone(),
        state: PublicationState::Published,
        content_digest: receipt.identity.content_digest.clone(),
        source_citations: draft
            .citations
            .iter()
            .map(|citation| citation.source_version_id.clone())
            .collect(),
        manifest_path: format!("notes/{}.md", draft.entry_id),
        operation_id: operation_id.into(),
        provenance_preserved: true,
    }
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
fn publication_appends_updates_and_retries_old_operations_without_loss() {
    let path = test_root("merge-publication");
    let publisher = Publisher::new(MemoryRoot::new(&path).unwrap()).unwrap();
    let first_draft = draft("entry-1").review(true);
    let first = publisher.publish(&first_draft, "operation-a").unwrap();
    let second_draft = draft("entry-2").review(true);
    // A fresh publisher must treat the clean committed manifest as its base,
    // not as a human edit that conflicts with appending another entry.
    let second_publisher = Publisher::new(MemoryRoot::new(&path).unwrap()).unwrap();
    let second = second_publisher
        .publish(&second_draft, "operation-b")
        .unwrap();
    assert_ne!(first.git_revision, second.git_revision);

    let imported = validate_fresh_clone(&path, "project-1").unwrap();
    assert_eq!(imported.entries.len(), 2);
    assert!(imported
        .entries
        .iter()
        .any(|entry| entry.memory_entry_id == "entry-1"));
    assert!(imported
        .entries
        .iter()
        .any(|entry| entry.memory_entry_id == "entry-2"));

    let mut updated = first_draft.clone();
    updated.body = "An updated cited body.".into();
    let base = validate_fresh_clone(&path, "project-1")
        .unwrap()
        .manifest_identity;
    let update = publisher
        .publish_with_expected_base(&updated, "operation-a-update", Some(&base))
        .unwrap();
    assert!(!update.duplicate);
    assert_ne!(update.git_revision, second.git_revision);
    let imported = validate_fresh_clone(&path, "project-1").unwrap();
    assert_eq!(imported.entries.len(), 2);
    assert_eq!(
        imported
            .entries
            .iter()
            .find(|entry| entry.memory_entry_id == "entry-1")
            .unwrap()
            .operation_id,
        "operation-a-update"
    );

    // Replaying the original operation after later publications must resolve
    // its original receipt; it must not roll the current entry back.
    let retry = publisher.publish(&first_draft, "operation-a").unwrap();
    assert!(retry.duplicate);
    assert_eq!(retry.git_revision, first.git_revision);
    assert_eq!(retry.identity, first.identity);
    let imported = validate_fresh_clone(&path, "project-1").unwrap();
    assert_eq!(imported.entries.len(), 2);
    assert_eq!(
        imported
            .entries
            .iter()
            .find(|entry| entry.memory_entry_id == "entry-1")
            .unwrap()
            .operation_id,
        "operation-a-update"
    );
    remove(&path);
}

#[test]
fn expected_base_rejects_conflicting_concurrent_publishers() {
    let path = test_root("expected-base");
    let _initialized = Publisher::new(MemoryRoot::new(&path).unwrap()).unwrap();
    let barrier = Arc::new(Barrier::new(2));
    let mut workers = Vec::new();
    for (entry_id, operation_id) in [("entry-a", "operation-a"), ("entry-b", "operation-b")] {
        let path = path.clone();
        let barrier = Arc::clone(&barrier);
        workers.push(thread::spawn(move || {
            let publisher = Publisher::new(MemoryRoot::new(&path).unwrap()).unwrap();
            barrier.wait();
            publisher.publish_with_expected_base(
                &draft(entry_id).review(true),
                operation_id,
                Some(""),
            )
        }));
    }
    let results = workers
        .into_iter()
        .map(|worker| worker.join().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(
        results.iter().filter(|result| result.is_ok()).count(),
        1,
        "results: {results:?}"
    );
    assert_eq!(
        results
            .iter()
            .filter(|result| matches!(result, Err(PublishError::Conflict(_))))
            .count(),
        1,
        "results: {results:?}"
    );
    assert_eq!(
        validate_fresh_clone(&path, "project-1")
            .unwrap()
            .entries
            .len(),
        1
    );
    remove(&path);
}

#[test]
fn interrupted_merged_publication_is_recovered_and_committed_once() {
    let path = test_root("merged-restart");
    let publisher = Publisher::new(MemoryRoot::new(&path).unwrap()).unwrap();
    let first_draft = draft("entry-1").review(true);
    let first = publisher.publish(&first_draft, "operation-a").unwrap();
    let second_draft = draft("entry-2").review(true);
    let second_identity = publication_identity(&second_draft, "operation-b").unwrap();
    let manifest = PublicationManifest::new(
        "project-1",
        "operation-b",
        manifest_entry_from(&first_draft, &first, "operation-a"),
    )
    .unwrap()
    .merge_entry(
        "operation-b",
        manifest_entry_from(
            &second_draft,
            &boreal_memory::PublicationReceipt {
                state: PublicationState::Published,
                identity: second_identity,
                git_revision: String::new(),
                duplicate: false,
            },
            "operation-b",
        ),
    )
    .unwrap();
    fs::write(
        publisher.root().entry_path("entry-2").unwrap(),
        render_markdown(&second_draft)
            .unwrap()
            .replace("state: accepted", "state: published"),
    )
    .unwrap();
    fs::write(publisher.root().manifest_path(), render_manifest(&manifest)).unwrap();
    let staged = Command::new("git")
        .args([
            "-C",
            path.to_str().unwrap(),
            "add",
            "--",
            "manifest.json",
            "notes/entry-2.md",
        ])
        .output()
        .unwrap();
    assert!(staged.status.success(), "git add failed: {:?}", staged);

    let restarted = Publisher::new(MemoryRoot::new(&path).unwrap()).unwrap();
    let receipt = restarted.publish(&second_draft, "operation-b").unwrap();
    assert!(!receipt.duplicate);
    assert_eq!(
        validate_fresh_clone(&path, "project-1")
            .unwrap()
            .entries
            .len(),
        2
    );
    let retry = restarted.publish(&second_draft, "operation-b").unwrap();
    assert!(retry.duplicate);
    assert_eq!(retry.git_revision, receipt.git_revision);
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
    let barrier = Arc::new(Barrier::new(8));
    let mut workers = Vec::new();
    for _ in 0..8 {
        let path = path.clone();
        let accepted = Arc::clone(&accepted);
        let barrier = Arc::clone(&barrier);
        workers.push(thread::spawn(move || {
            barrier.wait();
            Publisher::new(MemoryRoot::new(&path).unwrap())
                .and_then(|publisher| publisher.publish(&accepted, "operation-concurrent"))
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
fn concurrent_distinct_publications_serialize_without_lost_entries() {
    let path = test_root("concurrent-distinct-publications");
    let barrier = Arc::new(Barrier::new(6));
    let mut workers = Vec::new();
    for index in 0..6 {
        let path = path.clone();
        let barrier = Arc::clone(&barrier);
        workers.push(thread::spawn(move || {
            let entry_id = format!("entry-{index}");
            let operation_id = format!("operation-{index}");
            barrier.wait();
            Publisher::new(MemoryRoot::new(&path).unwrap()).and_then(|publisher| {
                publisher.publish(&draft(&entry_id).review(true), &operation_id)
            })
        }));
    }

    let results = workers
        .into_iter()
        .map(|worker| worker.join().unwrap())
        .collect::<Vec<_>>();
    assert!(results.iter().all(Result::is_ok), "results: {results:?}");
    let imported = validate_fresh_clone(&path, "project-1").unwrap();
    assert_eq!(imported.entries.len(), 6);
    for index in 0..6 {
        assert!(imported
            .entries
            .iter()
            .any(|entry| entry.memory_entry_id == format!("entry-{index}")));
    }
    remove(&path);
}

#[test]
fn publication_preserves_uncommitted_human_edits_to_managed_notes() {
    let path = test_root("human-managed-edit");
    let publisher = Publisher::new(MemoryRoot::new(&path).unwrap()).unwrap();
    let first = draft("entry-1").review(true);
    publisher.publish(&first, "operation-a").unwrap();

    let note_path = path.join("notes/entry-1.md");
    let mut human_text = fs::read_to_string(&note_path).unwrap();
    human_text.push_str("\nHuman edit that must survive.\n");
    fs::write(&note_path, &human_text).unwrap();

    let mut update = first;
    update.body = "Publisher update.".into();
    assert!(matches!(
        publisher.publish(&update, "operation-a-update"),
        Err(PublishError::Conflict(_))
    ));
    assert_eq!(fs::read_to_string(note_path).unwrap(), human_text);
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
