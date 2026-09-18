use boreal_source::{
    Availability, FindingKind, ParseState, RetrievalRequest, SourceCatalog, SourceError,
    DEFAULT_PARSER_IDENTITY,
};
use std::{
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
        "boreal-source-index-{name}-{}-{}",
        std::process::id(),
        TEST_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir_all(&path).unwrap();
    path
}

#[test]
fn indexing_and_retrieval_are_deterministic_across_capture_order() {
    let first = SourceCatalog::default();
    let first_a = first
        .capture(
            "project-a",
            "docs/a.md",
            b"Shared source alpha\nunique alpha",
            "text/markdown",
        )
        .unwrap();
    let first_b = first
        .capture(
            "project-a",
            "docs/b.md",
            b"Shared source beta\nunique beta",
            "text/markdown",
        )
        .unwrap();
    let first_a_report = first
        .parse_and_index(&first_a, DEFAULT_PARSER_IDENTITY)
        .unwrap();
    let first_b_report = first
        .parse_and_index(&first_b, DEFAULT_PARSER_IDENTITY)
        .unwrap();
    assert_eq!(first_a_report.state, ParseState::Indexed);
    assert_eq!(first_a_report.chunk_count, 2);

    let second = SourceCatalog::default();
    let second_b = second
        .capture(
            "project-a",
            "docs/b.md",
            b"Shared source beta\nunique beta",
            "text/markdown",
        )
        .unwrap();
    let second_a = second
        .capture(
            "project-a",
            "docs/a.md",
            b"Shared source alpha\nunique alpha",
            "text/markdown",
        )
        .unwrap();
    second
        .parse_and_index(&second_b, DEFAULT_PARSER_IDENTITY)
        .unwrap();
    let second_a_report = second
        .parse_and_index(&second_a, DEFAULT_PARSER_IDENTITY)
        .unwrap();
    let second_b_report = second
        .parse_and_index(&second_b, DEFAULT_PARSER_IDENTITY)
        .unwrap();
    assert_eq!(first_a_report.output_digest, second_a_report.output_digest);
    assert_eq!(first_b_report.output_digest, second_b_report.output_digest);

    let first_hits = first
        .retrieve(&RetrievalRequest::new("project-a", "shared source"))
        .unwrap();
    let second_hits = second
        .retrieve(&RetrievalRequest::new("project-a", "shared source"))
        .unwrap();
    let simplify = |response: &boreal_source::RetrievalResponse| {
        response
            .hits
            .iter()
            .map(|hit| {
                (
                    hit.source_version_id.clone(),
                    hit.location.clone(),
                    hit.excerpt.clone(),
                    hit.score,
                )
            })
            .collect::<Vec<_>>()
    };
    assert_eq!(simplify(&first_hits), simplify(&second_hits));
    assert_eq!(first_hits.lag, 0);
    assert_eq!(first_hits.index_revision, second_hits.index_revision);
}

#[test]
fn retrieval_respects_result_and_excerpt_bounds() {
    let catalog = SourceCatalog::default();
    let version = catalog
        .capture(
            "project-a",
            "docs/long.md",
            b"bounded retrieval must preserve a cited source line",
            "text/markdown",
        )
        .unwrap();
    catalog
        .parse_and_index(&version, DEFAULT_PARSER_IDENTITY)
        .unwrap();

    let mut request = RetrievalRequest::new("project-a", "bounded retrieval");
    request.limit = 1;
    request.max_excerpt_bytes = 9;
    let response = catalog.retrieve(&request).unwrap();
    assert_eq!(response.hits.len(), 1);
    assert!(response.hits[0].excerpt.len() <= 9);
    assert_eq!(response.hits[0].location, "line:1");
    assert_eq!(
        response.hits[0].layer,
        boreal_source::RetrievalLayer::RawSource
    );
    assert_eq!(
        response.hits[0].excerpt_digest,
        boreal_source::content_digest(response.hits[0].excerpt.as_bytes())
    );
    assert_eq!(
        catalog.retrieve(&RetrievalRequest::new("project-b", "bounded")),
        Ok(boreal_source::RetrievalResponse {
            project_id: "project-b".to_owned(),
            query: "bounded".to_owned(),
            hits: Vec::new(),
            source_revision: 1,
            index_revision: 1,
            lag: 0,
        })
    );
    assert_eq!(
        catalog.retrieve(&RetrievalRequest::new("project-a", "   ")),
        Err(SourceError::InvalidRetrievalQuery)
    );
}

#[test]
fn retrieval_never_serves_derived_text_after_blob_loss_or_tampering() {
    let root = test_root("retrieval-integrity");
    let catalog = SourceCatalog::with_filesystem(&root);
    let version = catalog
        .capture(
            "project-a",
            "docs/integrity.md",
            b"canonical bytes must remain available",
            "text/markdown",
        )
        .unwrap();
    catalog
        .parse_and_index(&version, DEFAULT_PARSER_IDENTITY)
        .unwrap();
    let store = boreal_source::FilesystemBlobStore::new(&root);
    fs::remove_file(store.blob_path(&version.content_digest).unwrap()).unwrap();
    assert_eq!(
        catalog.retrieve(&RetrievalRequest::new("project-a", "canonical")),
        Err(SourceError::MissingBlob)
    );

    catalog
        .capture(
            "project-a",
            "docs/tampered.md",
            b"tamper detection remains explicit",
            "text/markdown",
        )
        .unwrap();
    let tampered = catalog
        .list_versions(Some("project-a"))
        .unwrap()
        .into_iter()
        .find(|candidate| candidate.origin == "docs/tampered.md")
        .unwrap();
    catalog
        .parse_and_index(&tampered, DEFAULT_PARSER_IDENTITY)
        .unwrap();
    fs::write(
        store.blob_path(&tampered.content_digest).unwrap(),
        b"not the captured bytes",
    )
    .unwrap();
    assert_eq!(
        catalog.retrieve(&RetrievalRequest::new("project-a", "tamper")),
        Err(SourceError::DigestMismatch)
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn doctor_distinguishes_missing_and_corrupt_blobs_and_repair_keeps_them() {
    let root = test_root("doctor");
    let catalog = SourceCatalog::with_filesystem(&root);
    let missing = catalog
        .capture(
            "project-a",
            "docs/missing.md",
            b"missing bytes",
            "text/markdown",
        )
        .unwrap();
    let corrupt = catalog
        .capture(
            "project-a",
            "docs/corrupt.md",
            b"original bytes",
            "text/markdown",
        )
        .unwrap();
    catalog
        .parse_and_index(&missing, DEFAULT_PARSER_IDENTITY)
        .unwrap();
    catalog
        .parse_and_index(&corrupt, DEFAULT_PARSER_IDENTITY)
        .unwrap();
    let store = boreal_source::FilesystemBlobStore::new(&root);
    fs::remove_file(store.blob_path(&missing.content_digest).unwrap()).unwrap();
    fs::write(
        store.blob_path(&corrupt.content_digest).unwrap(),
        b"tampered",
    )
    .unwrap();

    let report = catalog.doctor(Some("project-a")).unwrap();
    let kinds: Vec<_> = report
        .findings
        .iter()
        .map(|finding| &finding.kind)
        .collect();
    assert!(kinds.contains(&&FindingKind::MissingBlob));
    assert!(kinds.contains(&&FindingKind::CorruptBlob));
    let repair = catalog.repair(Some("project-a")).unwrap();
    assert_eq!(repair.skipped_unavailable, 2);
    assert_eq!(
        catalog.availability(&missing).unwrap(),
        Availability::Missing
    );
    assert_eq!(
        catalog.availability(&corrupt).unwrap(),
        Availability::Corrupt
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn persistent_catalog_reloads_metadata_and_index_after_restart() {
    let root = test_root("persistent");
    let first = SourceCatalog::with_persistent_filesystem(&root).unwrap();
    let version = first
        .capture(
            "project-a",
            "docs/restart.md",
            b"restartable source metadata",
            "text/markdown",
        )
        .unwrap();
    let citation = first
        .cite(&version, "line:1", b"restartable source metadata")
        .unwrap();
    first
        .parse_and_index(&version, DEFAULT_PARSER_IDENTITY)
        .unwrap();
    assert!(root.join("catalog.json").is_file());
    drop(first);

    let second = SourceCatalog::with_persistent_filesystem(&root).unwrap();
    assert_eq!(second.version_count().unwrap(), 1);
    let versions = second.list_versions(Some("project-a")).unwrap();
    assert_eq!(versions[0].source_version_id, version.source_version_id);
    assert_eq!(
        versions[0].parser_identity.as_deref(),
        Some(DEFAULT_PARSER_IDENTITY)
    );
    assert_eq!(
        second.verify(&versions[0]).unwrap(),
        b"restartable source metadata"
    );
    second
        .verify_citation(&versions[0], &citation, b"restartable source metadata")
        .unwrap();
    assert_eq!(citation.source_version_id, versions[0].source_version_id);
    assert_eq!(
        citation.excerpt_digest,
        boreal_source::content_digest(b"restartable source metadata")
    );
    let response = second
        .retrieve(&RetrievalRequest::new("project-a", "restartable"))
        .unwrap();
    assert_eq!(response.lag, 0);
    assert_eq!(response.hits.len(), 1);
    assert!(second
        .doctor(Some("project-a"))
        .unwrap()
        .findings
        .is_empty());

    fs::write(root.join("catalog.json"), b"not-json").unwrap();
    assert!(matches!(
        SourceCatalog::with_persistent_filesystem(&root),
        Err(SourceError::Storage(message)) if message.contains("catalog metadata is invalid")
    ));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn persistent_restart_keeps_old_citation_after_recapture_with_new_bytes() {
    let root = test_root("versioned-restart");
    let first = SourceCatalog::with_persistent_filesystem(&root).unwrap();
    let old = first
        .capture(
            "project-a",
            "docs/changing.md",
            b"old source bytes",
            "text/markdown",
        )
        .unwrap();
    let old_citation = first.cite(&old, "line:1", b"old source bytes").unwrap();
    drop(first);

    let second = SourceCatalog::with_persistent_filesystem(&root).unwrap();
    let new = second
        .capture(
            "project-a",
            "docs/changing.md",
            b"new source bytes",
            "text/markdown",
        )
        .unwrap();
    assert_ne!(old.source_version_id, new.source_version_id);
    assert_eq!(second.verify(&old).unwrap(), b"old source bytes");
    second
        .verify_citation(&old, &old_citation, b"old source bytes")
        .unwrap();
    assert_eq!(second.verify(&new).unwrap(), b"new source bytes");
    assert_eq!(second.version_count().unwrap(), 2);

    drop(second);
    let restarted = SourceCatalog::with_persistent_filesystem(&root).unwrap();
    let versions = restarted.list_versions(Some("project-a")).unwrap();
    assert_eq!(versions.len(), 2);
    assert_eq!(restarted.verify(&old).unwrap(), b"old source bytes");
    restarted
        .verify_citation(&old, &old_citation, b"old source bytes")
        .unwrap();
    assert_eq!(restarted.verify(&new).unwrap(), b"new source bytes");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn persistent_catalog_recovers_a_proven_stale_lock_without_losing_capture() {
    let root = test_root("stale-lock");
    fs::write(root.join("catalog.lock"), "pid=2147483647\ntoken=dead\n").unwrap();
    let catalog = SourceCatalog::with_persistent_filesystem(&root).unwrap();
    let version = catalog
        .capture(
            "project-a",
            "docs/stale-lock.md",
            b"stale lock recovery",
            "text/markdown",
        )
        .unwrap();
    assert_eq!(version.availability, Availability::Available);
    assert!(!root.join("catalog.lock").exists());
    assert_eq!(catalog.version_count().unwrap(), 1);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn repair_rebuilds_derived_index_and_second_repair_is_stable() {
    let catalog = SourceCatalog::default();
    let version = catalog
        .capture(
            "project-a",
            "docs/repair.md",
            b"repairable source",
            "text/markdown",
        )
        .unwrap();
    let first = catalog.rebuild_index(Some("project-a")).unwrap();
    assert_eq!(first.repaired, 1);
    assert_eq!(
        catalog.doctor(Some("project-a")).unwrap().findings,
        Vec::new()
    );
    let second = catalog.repair(Some("project-a")).unwrap();
    assert_eq!(second.unchanged, 1);
    assert_eq!(second.repaired, 0);
    assert_eq!(second.failed, 0);
    assert_eq!(
        catalog
            .retrieve(&RetrievalRequest::new("project-a", "repairable"))
            .unwrap()
            .hits
            .len(),
        1
    );

    catalog
        .record_parser(&version, "parser/v2", &version.source_version_id)
        .unwrap();
    let stale = catalog.doctor(Some("project-a")).unwrap();
    assert!(stale
        .findings
        .iter()
        .any(|finding| finding.kind == FindingKind::StaleParser));
    let repaired = catalog.repair(Some("project-a")).unwrap();
    assert_eq!(repaired.repaired, 1);
    assert_eq!(
        catalog.doctor(Some("project-a")).unwrap().findings,
        Vec::new()
    );
}

#[test]
fn persistent_repair_and_capture_share_one_mutation_snapshot() {
    let root = test_root("repair-capture-boundary");
    let seed = SourceCatalog::with_persistent_filesystem(&root).unwrap();
    let original = seed
        .capture(
            "project-a",
            "docs/original.md",
            b"original repairable source",
            "text/markdown",
        )
        .unwrap();
    drop(seed);

    let repairer = Arc::new(SourceCatalog::with_persistent_filesystem(&root).unwrap());
    let capturer = Arc::new(SourceCatalog::with_persistent_filesystem(&root).unwrap());
    let barrier = Arc::new(Barrier::new(2));

    let repair_thread = {
        let repairer = Arc::clone(&repairer);
        let barrier = Arc::clone(&barrier);
        thread::spawn(move || {
            barrier.wait();
            repairer.repair(Some("project-a")).unwrap()
        })
    };
    let capture_thread = {
        let capturer = Arc::clone(&capturer);
        let barrier = Arc::clone(&barrier);
        thread::spawn(move || {
            barrier.wait();
            capturer
                .capture(
                    "project-a",
                    "docs/concurrent.md",
                    b"concurrent source",
                    "text/markdown",
                )
                .unwrap()
        })
    };
    repair_thread.join().unwrap();
    capture_thread.join().unwrap();

    let restarted = SourceCatalog::with_persistent_filesystem(&root).unwrap();
    assert_eq!(restarted.version_count().unwrap(), 2);
    assert_eq!(
        restarted.verify(&original).unwrap(),
        b"original repairable source"
    );
    let response = restarted
        .retrieve(&RetrievalRequest::new("project-a", "original repairable"))
        .unwrap();
    assert_eq!(response.hits.len(), 1);
    assert!(
        response.lag <= 1,
        "only the concurrent source may remain unindexed"
    );

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn parser_failure_is_retained_and_retryable() {
    let catalog = SourceCatalog::default();
    let version = catalog
        .capture(
            "project-a",
            "data.bin",
            &[0xff, 0xfe, 0xfd],
            "application/octet-stream",
        )
        .unwrap();
    let parsed = catalog
        .parse_and_index(&version, DEFAULT_PARSER_IDENTITY)
        .unwrap();
    assert_eq!(parsed.state, ParseState::Failed);
    assert_eq!(parsed.chunk_count, 0);
    assert!(parsed
        .error
        .as_deref()
        .is_some_and(|error| error.contains("UTF-8")));
    let report = catalog.doctor(Some("project-a")).unwrap();
    assert!(report
        .findings
        .iter()
        .any(|finding| finding.kind == FindingKind::ParserFailed));
    assert_eq!(catalog.repair(Some("project-a")).unwrap().failed, 1);
}
