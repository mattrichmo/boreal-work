use boreal_application::{
    canonical_request_digest, KnowledgeApplication, KnowledgeDurability, MemoryDraftInput,
    MemoryPublishInput, MemoryReviewInput, MemorySearchInput, MigrationApplyState,
    SourceCaptureInput, SourceRegistrationState,
};
use boreal_memory::{publication_identity, Citation as MemoryCitation, MemoryRoot, Publisher};
use boreal_migration::{MigrationDocument, ProjectRecord, FORMAT, FORMAT_VERSION};
use boreal_source::{Availability, SourceCatalog};
use boreal_store::{
    identity::{DatabaseIdentity, IdentityContext, IdentityStore, WorkspaceBinding},
    operations::{OperationBundle, OperationJournal},
    AuditEventRecord, OperationOutcome, OperationRecord, SqliteStore,
};
use serde_json::json;
use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};

static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

const PRODUCTION_SCHEMA: &str = include_str!("../../../project/spec/schema-production.sql");

fn test_root(name: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!(
        "boreal-application-knowledge-{name}-{}-{}",
        std::process::id(),
        TEST_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir_all(&path).unwrap();
    path
}

fn publication_store(operation_id: &str, request_digest: &str) -> (SqliteStore, IdentityContext) {
    let store = SqliteStore::open_in_memory(PRODUCTION_SCHEMA).unwrap();
    store.create_project("project-a", "unix-ms:0").unwrap();
    store
        .ensure_actor("agent-1", "agent", "credential", "Agent 1", "unix-ms:0")
        .unwrap();
    let identities = IdentityStore::new(&store);
    identities
        .install(
            &DatabaseIdentity::new("database-knowledge-publication", 1).unwrap(),
            "unix-ms:1",
        )
        .unwrap();
    let context = identities
        .bind_project(
            "project-a",
            &WorkspaceBinding::new(
                "/tmp/boreal-knowledge-publication",
                "/tmp/boreal-knowledge-publication",
                "sha256:knowledge-publication",
            )
            .unwrap(),
            "unix-ms:1",
        )
        .unwrap();
    let operation = OperationRecord {
        operation_id: operation_id.to_owned(),
        project_id: "project-a".to_owned(),
        command: "memory.publish".to_owned(),
        actor_id: "agent-1".to_owned(),
        session_id: None,
        expected_revision: None,
        attempt_id: None,
        fence: None,
        request_digest: request_digest.to_owned(),
        outcome: OperationOutcome::Changed,
        result_json: "{}".to_owned(),
        revision: 1,
        created_at: "unix-ms:3".to_owned(),
        completed_at: Some("unix-ms:3".to_owned()),
    };
    let audit = AuditEventRecord {
        project_id: "project-a".to_owned(),
        revision: 1,
        operation_id: operation_id.to_owned(),
        event_type: "repair.correction".to_owned(),
        subject_type: "project".to_owned(),
        subject_id: "project-a".to_owned(),
        actor_id: "agent-1".to_owned(),
        session_id: None,
        fence: None,
        as_of: "unix-ms:3".to_owned(),
        payload_json: "{}".to_owned(),
    };
    store.execute_batch("BEGIN IMMEDIATE").unwrap();
    OperationJournal::new(&store)
        .append_in_transaction_with_identity(
            &context,
            &OperationBundle::new(operation, Some(audit)),
        )
        .unwrap();
    store.execute_batch("COMMIT").unwrap();
    (store, context)
}

#[test]
fn source_capture_is_operation_aware_and_explicit_about_store_registration() {
    let catalog = SourceCatalog::default();
    let app = KnowledgeApplication::new(&catalog);
    let input = SourceCaptureInput {
        operation_id: "source-op-1".to_owned(),
        project_id: "project-a".to_owned(),
        origin: "notes/today.md".to_owned(),
        media_type: "text/markdown".to_owned(),
        bytes: b"immutable source".to_vec(),
    };

    let first = app.capture_source(input.clone()).unwrap();
    let retry = app.capture_source(input).unwrap();
    assert_eq!(
        first.source.source_version_id,
        retry.source.source_version_id
    );
    assert!(!first.duplicate);
    assert!(retry.duplicate);
    assert_eq!(
        first.operation.durability,
        KnowledgeDurability::SourceCatalog
    );
    assert_eq!(
        first.registration,
        SourceRegistrationState::StoreRegistrationPending {
            reason: "SQLite source_version registration must be committed by the store adapter with this operation identity".to_owned(),
        }
    );

    let verified = app
        .verify_source("project-a", &first.source.source_version_id)
        .unwrap();
    assert_eq!(verified.availability, Availability::Available);
    assert_eq!(verified.byte_count, b"immutable source".len());
    assert_eq!(
        verified.verified_digest.as_deref(),
        Some(first.source.content_digest.as_str())
    );

    let mut changed = SourceCaptureInput {
        operation_id: "source-op-1".to_owned(),
        project_id: "project-a".to_owned(),
        origin: "notes/today.md".to_owned(),
        media_type: "text/markdown".to_owned(),
        bytes: b"changed bytes".to_vec(),
    };
    assert!(matches!(
        app.capture_source(changed.clone()),
        Err(boreal_application::KnowledgeError::Source(
            boreal_source::SourceError::OperationConflict
        ))
    ));
    changed.operation_id = "source-op-2".to_owned();
    let second = app.capture_source(changed).unwrap();
    assert_ne!(
        second.source.source_version_id,
        first.source.source_version_id
    );
}

#[test]
fn memory_draft_review_publish_and_search_preserve_provenance() {
    let catalog = SourceCatalog::default();
    let app = KnowledgeApplication::new(&catalog);
    let source = app
        .capture_source(SourceCaptureInput {
            operation_id: "source-op-memory".to_owned(),
            project_id: "project-a".to_owned(),
            origin: "docs/guide.md".to_owned(),
            media_type: "text/markdown".to_owned(),
            bytes: b"the release process requires a verified review".to_vec(),
        })
        .unwrap();
    let citation = app
        .cite_source(
            "project-a",
            &source.source.source_version_id,
            "docs/guide.md:1",
            b"verified review",
        )
        .unwrap();

    let draft = app
        .draft_memory(MemoryDraftInput {
            operation_id: "memory-draft-1".to_owned(),
            project_id: "project-a".to_owned(),
            entry_id: "release-review".to_owned(),
            title: "Release review".to_owned(),
            body: "The release process requires a verified review.".to_owned(),
            citations: vec![MemoryCitation {
                source_version_id: citation.citation.source_version_id,
                location: citation.citation.location,
            }],
        })
        .unwrap();
    let reviewed = app
        .review_memory(
            &draft,
            MemoryReviewInput {
                operation_id: "memory-review-1".to_owned(),
                reviewer_id: "reviewer-a".to_owned(),
                accepted: true,
            },
        )
        .unwrap();

    let root = test_root("memory").join(".boreal-memory");
    let publisher = Publisher::new(MemoryRoot::new(&root).unwrap()).unwrap();
    let expected_identity = publication_identity(&reviewed.draft, "memory-publish-1").unwrap();
    let memory_root_identity = publisher.root().path().to_string_lossy().into_owned();
    let request_digest = canonical_request_digest(
        "memory.publish/v2",
        json!({
            "project_id": reviewed.draft.project_id,
            "entry_id": reviewed.draft.entry_id,
            "content_digest": expected_identity.content_digest,
            "manifest_identity": expected_identity.manifest_identity,
            "memory_root_identity": memory_root_identity,
            "expected_manifest_identity": Some(String::new()),
            "review_operation_id": reviewed.operation.operation_id,
            "actor_id": "agent-1",
            "session_id": Option::<String>::None,
            "deadline": Option::<String>::None,
            "created_at": "unix-ms:3",
            "started_at": "unix-ms:4",
            "observed_at": "unix-ms:5",
            "source_identity": Option::<String>::None,
            "config_identity": Option::<String>::None,
        }),
    );
    let (store, identity) = publication_store("memory-publish-1", &request_digest);
    let publish_input = MemoryPublishInput {
        operation_id: "memory-publish-1".to_owned(),
        expected_manifest_identity: Some(String::new()),
        actor_id: "agent-1".to_owned(),
        session_id: None,
        deadline: None,
        created_at: "unix-ms:3".to_owned(),
        started_at: "unix-ms:4".to_owned(),
        observed_at: "unix-ms:5".to_owned(),
        source_identity: None,
        config_identity: None,
    };
    let publication = app
        .publish_memory(
            &store,
            &identity,
            &publisher,
            &reviewed,
            publish_input.clone(),
        )
        .unwrap();
    assert_eq!(
        publication.operation.durability,
        KnowledgeDurability::GitCommit
    );
    assert_eq!(
        publication.provenance.memory_entry_id.as_deref(),
        Some("release-review")
    );
    assert!(publication.provenance.git_revision.is_some());

    let search = app
        .search_memory(
            &root,
            MemorySearchInput {
                project_id: "project-a".to_owned(),
                text: Some("verified review".to_owned()),
                ..MemorySearchInput::default()
            },
        )
        .unwrap();
    assert_eq!(search.response.hits.len(), 1);
    assert_eq!(search.response.hits[0].entry_id, "release-review");
    assert_eq!(
        search.provenance.git_revision,
        Some(publication.receipt.as_ref().unwrap().git_revision.clone(),)
    );

    let retry = app
        .publish_memory(&store, &identity, &publisher, &reviewed, publish_input)
        .unwrap();
    assert_eq!(
        retry.state,
        boreal_application::MemoryPublicationState::Reconciled
    );
    assert!(retry.receipt.as_ref().unwrap().duplicate);
    fs::remove_dir_all(root.parent().unwrap()).unwrap();
}

#[test]
fn migration_apply_is_staged_only_and_loss_is_not_silenced() {
    let catalog = SourceCatalog::default();
    let app = KnowledgeApplication::new(&catalog);
    let document = MigrationDocument::new(ProjectRecord {
        id: "project-a".to_owned(),
        name: "Project A".to_owned(),
        description: String::new(),
    });
    let input = serde_json::to_string(&document).unwrap();
    let dry_run = app.migration_dry_run("migration-1", &input).unwrap();
    assert!(dry_run.ready);
    assert_eq!(dry_run.source.source_format, FORMAT);
    assert_eq!(dry_run.source.source_version, FORMAT_VERSION);

    let verification = app.verify_migration(&dry_run).unwrap();
    assert!(verification.ready);
    assert_eq!(verification.issue_count, 0);
    assert!(verification
        .unsupported_capabilities
        .iter()
        .any(|capability| capability == "live_store_materialization_requires_store_adapter"));

    let applied = app.apply_migration(&dry_run).unwrap();
    assert_eq!(applied.state, MigrationApplyState::StagedOnly);
    assert!(applied.document.is_some());
    assert_eq!(
        applied.operation.durability,
        KnowledgeDurability::StagedOnly
    );

    let legacy_with_unknown = serde_json::json!({
        "format": "boreal.legacy.records",
        "version": 1,
        "project": {"id": "project-a", "name": "Project A"},
        "future_field": {"not": "supported"}
    });
    let legacy = app
        .migration_dry_run("migration-loss", &legacy_with_unknown.to_string())
        .unwrap();
    assert!(!legacy.ready);
    assert!(!legacy.loss_ledger.is_empty());
    assert_eq!(
        app.apply_migration(&legacy).unwrap().state,
        MigrationApplyState::RequiresReview
    );
}

#[test]
fn source_capture_can_commit_and_replay_sqlite_registration() {
    let catalog = SourceCatalog::default();
    let app = KnowledgeApplication::new(&catalog);
    let store =
        SqliteStore::open_in_memory(include_str!("../../../project/spec/schema-v2.sql")).unwrap();
    store
        .initialize_project(
            "project-a",
            "actor-a",
            "agent",
            "cred-a",
            "Agent A",
            "init-knowledge",
            "sha256:init-knowledge",
            "2026-09-18T00:00:00Z",
        )
        .unwrap();

    let input = SourceCaptureInput {
        operation_id: "source-register-1".to_owned(),
        project_id: "project-a".to_owned(),
        origin: "notes/source.md".to_owned(),
        media_type: "text/markdown".to_owned(),
        bytes: b"durable source".to_vec(),
    };
    let first = app
        .capture_source_with_store(&store, input.clone(), "actor-a", "2026-09-18T00:01:00Z")
        .unwrap();
    assert!(matches!(
        first.registration,
        SourceRegistrationState::StoreCommitted {
            revision: 2,
            replayed: false
        }
    ));
    let row = store
        .source_version("project-a", &first.source.source_version_id)
        .unwrap()
        .unwrap();
    assert_eq!(row.content_digest, first.source.content_digest);

    let retry = app
        .capture_source_with_store(&store, input, "actor-a", "2026-09-18T00:01:00Z")
        .unwrap();
    assert!(matches!(
        retry.registration,
        SourceRegistrationState::StoreCommitted {
            revision: 2,
            replayed: true
        }
    ));
    assert_eq!(
        store
            .list_source_versions("project-a", 10, 0)
            .unwrap()
            .len(),
        1
    );
}
