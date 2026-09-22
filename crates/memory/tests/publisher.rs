use boreal_memory::publisher as durable_publication;
use boreal_memory::{
    publication_identity, publication_side_effect_ref, rebuild_index,
    reconciled_publication_observation, render_manifest, render_markdown, validate_fresh_clone,
    validate_import, validate_publication_request, Citation, Draft, DraftState, FindingCode,
    ImportError, IndexLag, ManifestEntry, MemoryAuthority, MemoryDoctor, MemoryRoot,
    PublicationIdentity, PublicationJobObservation, PublicationManifest, PublicationRecovery,
    PublicationRecoveryState, PublicationState, PublishError, Publisher, RetentionPolicy,
    RetrievalQuery, SourceTrust,
};

use std::{
    cell::{Cell, RefCell},
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
    let recovery = restarted.recovery_status().unwrap();
    assert_eq!(recovery.state, PublicationRecoveryState::Committed);
    assert_eq!(
        recovery.git_revision.as_deref(),
        Some(receipt.git_revision.as_str())
    );
    let root_name = path.file_name().unwrap().to_string_lossy();
    fs::write(
        path.parent()
            .unwrap()
            .join(format!(".{root_name}.publication-recovery")),
        format!(
            "schema=1\nstate=staged\noperation_id={}\nmanifest_identity={}\nnote_name=notes/entry-1.md\ngit_revision=\n",
            operation_id, identity.manifest_identity
        ),
    )
    .unwrap();
    let reconciled = restarted.recovery_status().unwrap();
    assert_eq!(reconciled.state, PublicationRecoveryState::Committed);
    assert_eq!(
        reconciled.git_revision.as_deref(),
        Some(receipt.git_revision.as_str())
    );

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
fn staged_human_edit_requires_reconciliation_and_is_not_overwritten() {
    let path = test_root("staged-human-edit");
    let accepted = draft("entry-1").review(true);
    let operation_id = "operation-staged-human-edit";
    let publisher = Publisher::new(MemoryRoot::new(&path).unwrap()).unwrap();
    let identity = publication_identity(&accepted, operation_id).unwrap();
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
    fs::write(publisher.root().entry_path("entry-1").unwrap(), &markdown).unwrap();
    fs::write(publisher.root().manifest_path(), render_manifest(&manifest)).unwrap();
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
    assert!(staged.status.success(), "git add failed: {staged:?}");

    let human_text = format!("{markdown}\nHuman staged/worktree edit.\n");
    fs::write(path.join("notes/entry-1.md"), &human_text).unwrap();
    let root_name = path.file_name().unwrap().to_string_lossy();
    fs::write(
        path.parent()
            .unwrap()
            .join(format!(".{root_name}.publication-recovery")),
        format!(
            "schema=1\nstate=staged\noperation_id={}\nmanifest_identity={}\nnote_name=notes/entry-1.md\ngit_revision=\n",
            operation_id, identity.manifest_identity
        ),
    )
    .unwrap();

    assert!(matches!(
        publisher.publish(&accepted, operation_id),
        Err(PublishError::Conflict(message)) if message.contains("publication recovery note bytes")
    ));
    assert_eq!(
        fs::read_to_string(path.join("notes/entry-1.md")).unwrap(),
        human_text
    );
    remove(&path);
}

#[test]
fn files_prepared_with_tampered_staged_bytes_requires_reconciliation() {
    let path = test_root("prepared-staged-tamper");
    let accepted = draft("entry-1").review(true);
    let operation_id = "operation-prepared-staged-tamper";
    let publisher = Publisher::new(MemoryRoot::new(&path).unwrap()).unwrap();
    let identity = publication_identity(&accepted, operation_id).unwrap();
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
    fs::write(publisher.root().entry_path("entry-1").unwrap(), &markdown).unwrap();
    fs::write(publisher.root().manifest_path(), render_manifest(&manifest)).unwrap();
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
    assert!(staged.status.success(), "git add failed: {staged:?}");

    fs::write(path.join("notes/entry-1.md"), b"tampered staged bytes\n").unwrap();
    let staged_tamper = Command::new("git")
        .args([
            "-C",
            path.to_str().unwrap(),
            "add",
            "--",
            "notes/entry-1.md",
        ])
        .output()
        .unwrap();
    assert!(
        staged_tamper.status.success(),
        "git add tampered note failed: {staged_tamper:?}"
    );
    fs::write(path.join("notes/entry-1.md"), &markdown).unwrap();

    let root_name = path.file_name().unwrap().to_string_lossy();
    fs::write(
        path.parent()
            .unwrap()
            .join(format!(".{root_name}.publication-recovery")),
        format!(
            "schema=1\nstate=files_prepared\noperation_id={}\nmanifest_identity={}\nnote_name=notes/entry-1.md\ngit_revision=\n",
            operation_id, identity.manifest_identity
        ),
    )
    .unwrap();

    assert_eq!(
        publisher.recovery_status().unwrap().state,
        PublicationRecoveryState::ReconciliationRequired
    );
    assert_eq!(
        fs::read_to_string(path.join("notes/entry-1.md")).unwrap(),
        markdown
    );
    remove(&path);
}

#[test]
fn replay_rejects_a_committed_manifest_with_a_tampered_note() {
    let path = test_root("committed-note-tamper");
    let accepted = draft("entry-1").review(true);
    let publisher = Publisher::new(MemoryRoot::new(&path).unwrap()).unwrap();
    let receipt = publisher
        .publish(&accepted, "operation-note-tamper")
        .unwrap();
    fs::write(path.join("notes/entry-1.md"), b"tampered committed note\n").unwrap();
    let staged = Command::new("git")
        .args([
            "-C",
            path.to_str().unwrap(),
            "add",
            "--",
            "notes/entry-1.md",
        ])
        .output()
        .unwrap();
    assert!(staged.status.success(), "git add failed: {staged:?}");
    let amended = Command::new("git")
        .args([
            "-C",
            path.to_str().unwrap(),
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.invalid",
            "commit",
            "--amend",
            "--no-edit",
            "--no-verify",
            "--no-gpg-sign",
        ])
        .output()
        .unwrap();
    assert!(amended.status.success(), "git amend failed: {amended:?}");
    assert_eq!(
        publisher.recovery_status().unwrap().state,
        PublicationRecoveryState::ReconciliationRequired
    );
    assert!(matches!(
        publisher.publish(&accepted, "operation-note-tamper"),
        Err(PublishError::Conflict(message))
            if message.contains("manifest or note failed identity verification")
    ));
    let current_revision = Command::new("git")
        .args(["-C", path.to_str().unwrap(), "rev-parse", "HEAD"])
        .output()
        .unwrap();
    assert_ne!(
        receipt.git_revision,
        String::from_utf8_lossy(&current_revision.stdout).trim()
    );
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
    assert_eq!(
        publisher.recovery_status().unwrap().state,
        PublicationRecoveryState::ReconciliationRequired
    );
    remove(&path);
}

#[test]
fn dead_publication_lock_is_recovered_but_unknown_lock_is_preserved() {
    let path = test_root("lock-recovery");
    let lock = path.parent().unwrap().join(format!(
        "{}.publication.lock",
        path.file_name().unwrap().to_string_lossy()
    ));
    fs::write(&lock, "pid=2147483647\ntoken=dead\n").unwrap();
    let publisher = Publisher::new(MemoryRoot::new(&path).unwrap()).unwrap();
    assert!(!lock.exists());
    publisher
        .publish(&draft("entry-1").review(true), "operation-lock-recovery")
        .unwrap();

    fs::write(
        &lock,
        format!("pid={}\ntoken=live-owner\n", std::process::id()),
    )
    .unwrap();
    let result = Publisher::new(MemoryRoot::new(&path).unwrap());
    assert!(matches!(result, Err(PublishError::Conflict(_))));
    assert!(lock.exists(), "an unverified lock must never be removed");
    fs::remove_file(lock).unwrap();
    remove(&path);
}

#[cfg(unix)]
#[test]
fn import_and_doctor_reject_a_symlinked_manifest() {
    use std::os::unix::fs::symlink;

    let path = test_root("manifest-symlink");
    let publisher = Publisher::new(MemoryRoot::new(&path).unwrap()).unwrap();
    publisher
        .publish(&draft("entry-1").review(true), "operation-manifest-symlink")
        .unwrap();

    let outside = test_root("manifest-symlink-target").join("manifest.json");
    fs::write(&outside, b"outside manifest bytes").unwrap();
    let manifest = path.join("manifest.json");
    fs::remove_file(&manifest).unwrap();
    symlink(&outside, &manifest).unwrap();

    assert_eq!(
        validate_import(&path, "project-1"),
        Err(ImportError::InvalidPath)
    );
    let report = MemoryDoctor::inspect(&path, "project-1");
    assert!(report
        .findings
        .iter()
        .any(|finding| finding.code == FindingCode::InvalidManifest));

    remove(&path);
    remove(outside.parent().unwrap());
}

#[cfg(unix)]
#[test]
fn managed_git_hooks_and_global_configuration_cannot_run_during_publication() {
    use std::os::unix::fs::PermissionsExt;

    let path = test_root("hook-boundary");
    let publisher = Publisher::new(MemoryRoot::new(&path).unwrap()).unwrap();
    let hook_dir = path.join(".git/hooks");
    fs::create_dir_all(&hook_dir).unwrap();
    let marker = path.join("hook-ran");
    let hook = hook_dir.join("pre-commit");
    fs::write(
        &hook,
        format!(
            "#!/bin/sh\nprintf hook-ran > {}\nexit 1\n",
            marker.display()
        ),
    )
    .unwrap();
    fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();

    let filter_marker = path.join("filter-ran");
    let filter = path.join(".git/filter.sh");
    fs::write(
        &filter,
        format!(
            "#!/bin/sh\nprintf filter-ran > {}\ncat\n",
            filter_marker.display()
        ),
    )
    .unwrap();
    fs::set_permissions(&filter, fs::Permissions::from_mode(0o755)).unwrap();
    let signer_marker = path.join("signer-ran");
    let signer = path.join(".git/signer.sh");
    fs::write(
        &signer,
        format!(
            "#!/bin/sh\nprintf signer-ran > {}\nexit 1\n",
            signer_marker.display()
        ),
    )
    .unwrap();
    fs::set_permissions(&signer, fs::Permissions::from_mode(0o755)).unwrap();
    fs::write(
        path.join(".gitattributes"),
        "manifest.json filter=boreal\nnotes/*.md filter=boreal\n",
    )
    .unwrap();
    for (key, value) in [
        ("filter.boreal.clean", filter.to_str().unwrap()),
        ("filter.boreal.smudge", filter.to_str().unwrap()),
        ("filter.boreal.required", "true"),
        ("gpg.program", signer.to_str().unwrap()),
        ("commit.gpgSign", "true"),
    ] {
        let configured = Command::new("git")
            .args(["-C", path.to_str().unwrap(), "config", key, value])
            .output()
            .unwrap();
        assert!(
            configured.status.success(),
            "git config failed: {configured:?}"
        );
    }
    let setup_add = Command::new("git")
        .args(["-C", path.to_str().unwrap(), "add", ".gitattributes"])
        .output()
        .unwrap();
    assert!(setup_add.status.success(), "git add failed: {setup_add:?}");
    let setup_commit = Command::new("git")
        .args([
            "-C",
            path.to_str().unwrap(),
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.invalid",
            "commit",
            "--no-verify",
            "--no-gpg-sign",
            "-m",
            "setup",
        ])
        .output()
        .unwrap();
    assert!(
        setup_commit.status.success(),
        "setup commit failed: {setup_commit:?}"
    );
    let _ = fs::remove_file(&filter_marker);
    let _ = fs::remove_file(&signer_marker);

    let receipt = publisher
        .publish(&draft("entry-1").review(true), "operation-hook-boundary")
        .unwrap();
    assert_eq!(receipt.state, PublicationState::Published);
    assert!(
        !marker.exists(),
        "repository hook escaped the publication boundary"
    );
    assert!(
        !filter_marker.exists(),
        "repository filters escaped the publication boundary"
    );
    assert!(
        !signer_marker.exists(),
        "repository signing helper escaped the publication boundary"
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

struct DurablePublicationJobs {
    record: RefCell<durable_publication::PublicationJobRecord>,
    events: RefCell<Vec<&'static str>>,
}

impl DurablePublicationJobs {
    fn new(state: durable_publication::PublicationJobState) -> Self {
        let request = durable_publication_request();
        Self::from_request(state, &request)
    }

    fn from_request(
        state: durable_publication::PublicationJobState,
        request: &durable_publication::PublicationJobRequest,
    ) -> Self {
        Self {
            record: RefCell::new(durable_publication::PublicationJobRecord {
                project_id: request.project_id.clone(),
                operation_id: request.operation_id.clone(),
                request_digest: request.request_digest.clone(),
                entry_id: request.entry_id.clone(),
                content_digest: request.content_digest.clone(),
                manifest_identity: request.manifest_identity.clone(),
                memory_root_identity: request.memory_root_identity.clone(),
                state,
                side_effect_ref: None,
                git_revision: None,
                result_digest: None,
                error: None,
            }),
            events: RefCell::new(Vec::new()),
        }
    }

    fn snapshot(&self) -> durable_publication::PublicationJobRecord {
        self.record.borrow().clone()
    }
}

impl durable_publication::PublicationJobPort for DurablePublicationJobs {
    fn register(
        &self,
        request: &durable_publication::PublicationJobRequest,
    ) -> Result<durable_publication::PublicationJobRecord, String> {
        self.events.borrow_mut().push("register");
        let record = self.snapshot();
        if record.project_id != request.project_id
            || record.operation_id != request.operation_id
            || record.request_digest != request.request_digest
            || record.entry_id != request.entry_id
            || record.content_digest != request.content_digest
            || record.manifest_identity != request.manifest_identity
            || record.memory_root_identity != request.memory_root_identity
        {
            return Err("publication identity mismatch".into());
        }
        Ok(record)
    }

    fn acquire(
        &self,
        request: &durable_publication::PublicationJobRequest,
        _started_at: &str,
    ) -> Result<durable_publication::PublicationJobAcquisition, String> {
        self.events.borrow_mut().push("acquire");
        let mut record = self.record.borrow_mut();
        if record.operation_id != request.operation_id {
            return Err("publication operation mismatch".into());
        }
        if record.state == durable_publication::PublicationJobState::Registered {
            record.state = durable_publication::PublicationJobState::Running;
        }
        Ok(durable_publication::PublicationJobAcquisition::Won(
            record.clone(),
        ))
    }

    fn mark_readback_required(
        &self,
        request: &durable_publication::PublicationJobRequest,
        side_effect_ref: &str,
    ) -> Result<durable_publication::PublicationJobRecord, String> {
        self.events.borrow_mut().push("mark_readback");
        let mut record = self.record.borrow_mut();
        if record.operation_id != request.operation_id {
            return Err("publication operation mismatch".into());
        }
        record.state = durable_publication::PublicationJobState::ReadbackRequired;
        record.side_effect_ref = Some(side_effect_ref.into());
        Ok(record.clone())
    }

    fn readback(
        &self,
        request: &durable_publication::PublicationJobRequest,
    ) -> Result<durable_publication::PublicationJobRecord, String> {
        self.events.borrow_mut().push("readback");
        let record = self.snapshot();
        if record.operation_id != request.operation_id {
            return Err("publication operation mismatch".into());
        }
        Ok(record)
    }

    fn reconcile(
        &self,
        request: &durable_publication::PublicationJobRequest,
        readback: &durable_publication::PublicationJobReadback,
    ) -> Result<durable_publication::PublicationJobRecord, String> {
        self.events.borrow_mut().push("reconcile");
        let mut record = self.record.borrow_mut();
        if record.operation_id != request.operation_id {
            return Err("publication operation mismatch".into());
        }
        record.state = durable_publication::PublicationJobState::Reconciled;
        record.side_effect_ref = Some(readback.side_effect_ref.clone());
        record.git_revision = Some(readback.git_revision.clone());
        record.result_digest = Some(readback.result_digest.clone());
        Ok(record.clone())
    }

    fn reject(
        &self,
        request: &durable_publication::PublicationJobRequest,
        reason: &str,
    ) -> Result<durable_publication::PublicationJobRecord, String> {
        self.events.borrow_mut().push("reject");
        let mut record = self.record.borrow_mut();
        if record.operation_id != request.operation_id {
            return Err("publication operation mismatch".into());
        }
        record.state = durable_publication::PublicationJobState::Rejected;
        record.error = Some(reason.into());
        Ok(record.clone())
    }

    fn fail(
        &self,
        request: &durable_publication::PublicationJobRequest,
        side_effect_ref: Option<&str>,
        reason: &str,
    ) -> Result<durable_publication::PublicationJobRecord, String> {
        self.events.borrow_mut().push("fail");
        let mut record = self.record.borrow_mut();
        if record.operation_id != request.operation_id {
            return Err("publication operation mismatch".into());
        }
        record.state = durable_publication::PublicationJobState::Failed;
        record.side_effect_ref = side_effect_ref.map(str::to_owned);
        record.error = Some(reason.into());
        Ok(record.clone())
    }
}

fn durable_publication_request() -> durable_publication::PublicationJobRequest {
    durable_publication::PublicationJobRequest {
        project_id: "project-1".into(),
        operation_id: "operation-1".into(),
        request_digest: "sha256:request".into(),
        entry_id: "entry-1".into(),
        content_digest: "sha256:content".into(),
        manifest_identity: "sha256:manifest".into(),
        memory_root_identity: "sha256:root".into(),
        actor_id: "actor-1".into(),
        session_id: Some("session-1".into()),
        source_identity: Some("source-1".into()),
        config_identity: Some("config-1".into()),
        deadline: Some("unix-ms:3".into()),
        created_at: "unix-ms:1".into(),
    }
}

#[test]
fn publication_identity_helpers_are_available_to_application_adapters() {
    let request = durable_publication_request();
    let expected = PublicationIdentity {
        project_id: request.project_id.clone(),
        entry_id: request.entry_id.clone(),
        content_digest: request.content_digest.clone(),
        operation_id: request.operation_id.clone(),
        manifest_identity: request.manifest_identity.clone(),
    };
    validate_publication_request(&request, &expected).unwrap();

    let recovery = PublicationRecovery {
        state: PublicationRecoveryState::Committed,
        operation_id: Some(request.operation_id.clone()),
        manifest_identity: Some(request.manifest_identity.clone()),
        git_revision: Some("revision-1".into()),
        detail: "verified committed publication".into(),
    };
    assert_eq!(
        publication_side_effect_ref(&request, &recovery),
        "git:revision-1"
    );
    assert!(matches!(
        reconciled_publication_observation(&request, &recovery, "unix-ms:4"),
        Ok(PublicationJobObservation::Reconciled {
            git_revision,
            manifest_identity,
            ..
        }) if git_revision == "revision-1" && manifest_identity == request.manifest_identity
    ));
}

#[test]
fn publisher_root_routes_git_through_durable_admission_and_readback() {
    let path = test_root("durable-root");
    let publisher = Publisher::new(MemoryRoot::new(&path).unwrap()).unwrap();
    let accepted = draft("entry-1").review(true);
    let operation_id = "operation-durable-root";
    let identity = publication_identity(&accepted, operation_id).unwrap();
    let request = durable_publication::PublicationJobRequest {
        project_id: identity.project_id.clone(),
        operation_id: identity.operation_id.clone(),
        request_digest: "sha256:request-durable-root".into(),
        entry_id: identity.entry_id.clone(),
        content_digest: identity.content_digest.clone(),
        manifest_identity: identity.manifest_identity.clone(),
        memory_root_identity: "sha256:root-durable-root".into(),
        actor_id: "actor-1".into(),
        session_id: Some("session-1".into()),
        source_identity: Some("source-1".into()),
        config_identity: Some("config-1".into()),
        deadline: Some("unix-ms:100".into()),
        created_at: "unix-ms:1".into(),
    };
    let jobs = DurablePublicationJobs::from_request(
        durable_publication::PublicationJobState::Registered,
        &request,
    );

    let first = publisher
        .publish_with_durable_job(&jobs, &request, "unix-ms:2", "unix-ms:3", &accepted, None)
        .unwrap();
    assert!(first.is_resolved());
    assert_eq!(
        jobs.events.borrow().as_slice(),
        ["register", "acquire", "reconcile"]
    );
    let revision = first.record().git_revision.clone().unwrap();
    assert_eq!(first.record().manifest_identity, request.manifest_identity);
    assert!(publisher
        .publication_readback(operation_id)
        .unwrap()
        .is_resolved());

    let second = publisher
        .publish_with_durable_job(&jobs, &request, "unix-ms:4", "unix-ms:5", &accepted, None)
        .unwrap();
    assert!(second.is_resolved());
    assert_eq!(
        second.record().git_revision.as_deref(),
        Some(revision.as_str())
    );
    assert_eq!(
        jobs.events.borrow().as_slice(),
        ["register", "acquire", "reconcile", "register", "readback"]
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
fn durable_publication_replay_does_not_repeat_git_effect() {
    let jobs = DurablePublicationJobs::new(durable_publication::PublicationJobState::Registered);
    let calls = Cell::new(0_u8);
    let request = durable_publication_request();
    let first = durable_publication::run_with_durable_job(&jobs, &request, "unix-ms:2", |_| {
        calls.set(calls.get() + 1);
        Ok(durable_publication::PublicationJobObservation::Reconciled {
            side_effect_ref: "git:revision-1".into(),
            git_revision: "revision-1".into(),
            result_digest: request.content_digest.clone(),
            manifest_identity: request.manifest_identity.clone(),
            observed_at: "unix-ms:3".into(),
        })
    })
    .unwrap();
    let second = durable_publication::run_with_durable_job(&jobs, &request, "unix-ms:3", |_| {
        calls.set(calls.get() + 1);
        Err("replay must not invoke Git".into())
    })
    .unwrap();

    assert!(first.is_resolved());
    assert!(second.is_resolved());
    assert_eq!(calls.get(), 1);
    assert_eq!(
        jobs.events.borrow().as_slice(),
        ["register", "acquire", "reconcile", "register", "readback"]
    );
}

#[test]
fn durable_publication_running_replay_requires_readback_without_git_retry() {
    let jobs = DurablePublicationJobs::new(durable_publication::PublicationJobState::Running);
    let calls = Cell::new(0_u8);
    let outcome = durable_publication::run_with_durable_job(
        &jobs,
        &durable_publication_request(),
        "unix-ms:2",
        |_| {
            calls.set(calls.get() + 1);
            Err("running replay must not invoke Git".into())
        },
    )
    .unwrap();

    assert!(!outcome.is_resolved());
    assert_eq!(calls.get(), 0);
    assert_eq!(jobs.events.borrow().as_slice(), ["register", "readback"]);
}

#[test]
fn durable_publication_unknown_callback_preserves_original_readback() {
    let jobs = DurablePublicationJobs::new(durable_publication::PublicationJobState::Registered);
    let outcome = durable_publication::run_with_durable_job(
        &jobs,
        &durable_publication_request(),
        "unix-ms:2",
        |_| Err("Git response was interrupted".into()),
    )
    .unwrap();

    assert!(matches!(
        outcome,
        durable_publication::PublicationJobOutcome::ReadbackRequired(_)
    ));
    assert_eq!(
        jobs.events.borrow().as_slice(),
        ["register", "acquire", "readback"]
    );
}

#[test]
fn durable_publication_rejects_unbounded_identity_before_admission() {
    let jobs = DurablePublicationJobs::new(durable_publication::PublicationJobState::Registered);
    let mut request = durable_publication_request();
    request.entry_id = "x".repeat(4 * 1024 + 1);
    let error = durable_publication::run_with_durable_job(&jobs, &request, "unix-ms:2", |_| {
        panic!("oversized publication reached Git")
    })
    .expect_err("oversized publication identity must be rejected");

    assert!(error.contains("entry identity"));
    assert!(jobs.events.borrow().is_empty());
}

#[test]
fn durable_publication_rejects_readback_for_the_wrong_manifest() {
    let jobs = DurablePublicationJobs::new(durable_publication::PublicationJobState::Registered);
    let request = durable_publication_request();
    let error = durable_publication::run_with_durable_job(&jobs, &request, "unix-ms:2", |_| {
        Ok(durable_publication::PublicationJobObservation::Reconciled {
            side_effect_ref: "git:revision-1".into(),
            git_revision: "revision-1".into(),
            result_digest: request.content_digest.clone(),
            manifest_identity: "sha256:other-manifest".into(),
            observed_at: "unix-ms:3".into(),
        })
    })
    .expect_err("foreign manifest readback must not reconcile");

    assert!(error.contains("readback identity"));
    assert!(!jobs
        .record
        .borrow()
        .state
        .eq(&durable_publication::PublicationJobState::Reconciled));
}
