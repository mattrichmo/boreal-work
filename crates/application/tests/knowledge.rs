use boreal_application::{
    canonical_request_digest, KnowledgeApplication, KnowledgeDurability, MemoryDraftInput,
    MemoryReviewInput, MemorySearchInput, MigrationApplyState, SourceCaptureInput,
    SourceRegistrationState, WorkApplication,
};
use boreal_domain::ActorRole;
use boreal_memory::Citation as MemoryCitation;
use boreal_migration::{MigrationDocument, ProjectRecord, FORMAT, FORMAT_VERSION};
use boreal_source::{Availability, SourceCatalog};
use boreal_store::{
    identity::{DatabaseIdentity, IdentityContext, IdentityStore, WorkspaceBinding},
    principals::PrincipalGrantRequest,
    SqliteStore, V3MutationContext,
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

fn publication_store(workspace: &std::path::Path) -> (SqliteStore, IdentityContext) {
    let store = SqliteStore::open(workspace.join("project.sqlite"), PRODUCTION_SCHEMA).unwrap();
    store.create_project("project-a", "unix-ms:0").unwrap();
    let identities = IdentityStore::new(&store);
    let database_identity = identities
        .database_identity()
        .unwrap_or_else(|_| DatabaseIdentity::new("database-knowledge-publication", 1).unwrap());
    identities.install(&database_identity, "unix-ms:1").unwrap();
    let canonical_workspace = workspace.canonicalize().unwrap();
    let context = identities
        .bind_project(
            "project-a",
            &WorkspaceBinding::new(
                canonical_workspace.to_string_lossy(),
                canonical_workspace.to_string_lossy(),
                "sha256:knowledge-publication",
            )
            .unwrap(),
            "unix-ms:1",
        )
        .unwrap();
    store
        .bootstrap_project_principal(&PrincipalGrantRequest {
            project_id: "project-a".to_owned(),
            actor_id: "memory-operator".to_owned(),
            session_id: None,
            principal_actor_id: "memory-operator".to_owned(),
            role: ActorRole::Operator,
            independent: true,
            credential: format!("bwrk1_{}", "a".repeat(64)),
            expires_at_ms: None,
            display_name: "Memory operator".to_owned(),
            reason: "bootstrap memory publication test".to_owned(),
            expected_revision: store.project_revision("project-a").unwrap().0,
            operation_id: "memory-operator-bootstrap".to_owned(),
            at: "unix-ms:2".to_owned(),
        })
        .unwrap();
    for (actor_id, role, independent, credential) in [
        ("agent-1", ActorRole::Agent, false, 'b'),
        ("reviewer-a", ActorRole::Reviewer, true, 'c'),
    ] {
        store
            .grant_principal(&PrincipalGrantRequest {
                project_id: "project-a".to_owned(),
                actor_id: "memory-operator".to_owned(),
                session_id: None,
                principal_actor_id: actor_id.to_owned(),
                role,
                independent,
                credential: format!("bwrk1_{}", credential.to_string().repeat(64)),
                expires_at_ms: None,
                display_name: actor_id.to_owned(),
                reason: format!("grant {actor_id} for memory publication test"),
                expected_revision: store.project_revision("project-a").unwrap().0,
                operation_id: format!("memory-grant-{actor_id}"),
                at: "unix-ms:2".to_owned(),
            })
            .unwrap();
    }
    let work = WorkApplication::new(&store);
    let project_id = boreal_domain::ProjectId::new("project-a");
    for (actor_id, session_id, operation_id) in [
        ("agent-1", "memory-agent-session", "memory-agent-session-op"),
        (
            "reviewer-a",
            "memory-reviewer-session",
            "memory-reviewer-session-op",
        ),
        (
            "memory-operator",
            "memory-operator-session",
            "memory-operator-session-op",
        ),
    ] {
        work.register_session_as(
            &project_id,
            actor_id,
            "memory-test-harness",
            session_id,
            "unix-ms:3",
            operation_id,
        )
        .unwrap();
    }
    (store, context)
}

fn mutation_context(
    store: &SqliteStore,
    actor_id: &str,
    session_id: &str,
    operation_id: &str,
    now: &str,
) -> V3MutationContext {
    let expected_revision = store.project_revision("project-a").unwrap().0;
    V3MutationContext {
        project_id: "project-a".to_owned(),
        actor_id: actor_id.to_owned(),
        session_id: Some(session_id.to_owned()),
        operation_id: operation_id.to_owned(),
        request_digest: canonical_request_digest(
            "knowledge.test-context/v1",
            json!({
                "project_id":"project-a",
                "actor_id":actor_id,
                "session_id":session_id,
                "operation_id":operation_id,
                "expected_revision":expected_revision,
            }),
        ),
        expected_revision: Some(expected_revision),
        now: now.to_owned(),
    }
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

    let workspace = test_root("memory").canonicalize().unwrap();
    let root = workspace.join("memory");
    let (store, identity) = publication_store(&workspace);
    app.register_captured_source(
        &store,
        &source.source,
        &source.operation,
        "agent-1",
        "unix-ms:4",
    )
    .unwrap();
    app.persist_memory_draft(
        &store,
        &mutation_context(
            &store,
            "agent-1",
            "memory-agent-session",
            "memory-draft-persist",
            "unix-ms:5",
        ),
        "memory-draft-1",
        MemoryDraftInput {
            operation_id: "memory-draft-persist".to_owned(),
            project_id: "project-a".to_owned(),
            entry_id: reviewed.draft.entry_id.clone(),
            title: reviewed.draft.title.clone(),
            body: reviewed.draft.body.clone(),
            citations: reviewed.draft.citations.clone(),
        },
    )
    .unwrap();
    app.review_durable_memory(
        &store,
        &mutation_context(
            &store,
            "reviewer-a",
            "memory-reviewer-session",
            "memory-review-1",
            "unix-ms:6",
        ),
        "memory-draft-1",
        "approved",
        "Independent review approved the cited release guidance",
    )
    .unwrap();
    let publish_context = mutation_context(
        &store,
        "memory-operator",
        "memory-operator-session",
        "memory-publish-1",
        "unix-ms:7",
    );
    store
        .execute_batch(
            r#"CREATE TRIGGER fail_memory_publication_ack
               BEFORE UPDATE ON boreal_external_job
               WHEN OLD.operation_id='memory-publish-1' AND NEW.stage='reconciled'
               BEGIN
                 SELECT RAISE(ABORT, 'simulated interruption before database acknowledgement');
               END;"#,
        )
        .unwrap();
    let interrupted = app.publish_durable_memory(
        &store,
        &identity,
        &publish_context,
        &root,
        "memory-review-1",
        "",
    );
    assert!(
        interrupted.is_err(),
        "the injected database acknowledgement failure must reach the caller"
    );
    let pending_job = store
        .external_job_by_operation_with_identity(&identity, "memory-publish-1")
        .unwrap()
        .unwrap();
    assert_eq!(pending_job.stage, "readback_required");

    // Simulate process restart: preserve the SQLite job and Git worktree, drop
    // the application/store handles, and reopen the database from disk.
    drop(store);
    let store = SqliteStore::open(workspace.join("project.sqlite"), PRODUCTION_SCHEMA).unwrap();
    let restarted_app = KnowledgeApplication::new(&catalog);
    let interrupted_readback = restarted_app
        .read_memory_publication(&store, &identity, &root, "memory-publish-1")
        .unwrap();
    assert_eq!(interrupted_readback["database_state"], "readback_required");
    assert_eq!(
        interrupted_readback["database_reconciliation_state"],
        "required"
    );
    assert_eq!(interrupted_readback["git_state"], "verified_commit");
    assert_eq!(
        interrupted_readback["reconciliation_state"],
        "git_committed_db_pending"
    );
    assert_eq!(interrupted_readback["git_verified"], true);
    assert_eq!(interrupted_readback["readback_required"], true);

    store
        .execute_batch("DROP TRIGGER fail_memory_publication_ack")
        .unwrap();
    restarted_app
        .reconcile_memory_publication(
            &store,
            &identity,
            &mutation_context(
                &store,
                "memory-operator",
                "memory-operator-session",
                "memory-reconcile-1",
                "unix-ms:8",
            ),
            &root,
            "memory-publish-1",
        )
        .unwrap();
    let reconciled_readback = restarted_app
        .read_memory_publication(&store, &identity, &root, "memory-publish-1")
        .unwrap();
    assert_eq!(reconciled_readback["database_state"], "reconciled");
    assert_eq!(reconciled_readback["git_state"], "verified_commit");
    assert_eq!(reconciled_readback["reconciliation_state"], "reconciled");
    assert_eq!(reconciled_readback["readback_required"], false);

    let search = restarted_app
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
        reconciled_readback["verified_git_revision"]
            .as_str()
            .map(str::to_owned)
    );

    let retry = restarted_app
        .publish_durable_memory(
            &store,
            &identity,
            &publish_context,
            &root,
            "memory-review-1",
            "",
        )
        .unwrap();
    assert_eq!(
        retry.state,
        boreal_application::MemoryPublicationState::Reconciled
    );
    assert_eq!(retry.operation.durability, KnowledgeDurability::GitCommit);
    assert_eq!(
        retry.provenance.memory_entry_id.as_deref(),
        Some("release-review")
    );
    assert!(retry.receipt.as_ref().unwrap().duplicate);
    assert_eq!(
        retry.receipt.as_ref().unwrap().git_revision.as_str(),
        reconciled_readback["verified_git_revision"]
            .as_str()
            .unwrap()
    );

    // A terminal SQLite job is not reconciled if its stored commit reference
    // or content digest disagrees with the independently verified Git result.
    let verified_revision = reconciled_readback["verified_git_revision"]
        .as_str()
        .unwrap();
    let expected_side_effect_ref = format!("git:{verified_revision}");
    let (_, expected_content_digest) = store
        .memory_publication_plan(&identity.project_id, "memory-publish-1")
        .unwrap()
        .unwrap();
    let terminal_job = store
        .external_job_by_operation_with_identity(&identity, "memory-publish-1")
        .unwrap()
        .unwrap();
    assert_eq!(
        terminal_job.side_effect_ref.as_deref(),
        Some(expected_side_effect_ref.as_str())
    );
    assert_eq!(
        terminal_job.result_digest.as_deref(),
        Some(expected_content_digest.as_str())
    );

    store
        .execute_batch(
            "UPDATE boreal_external_job SET side_effect_ref='git:wrong-commit' \
             WHERE operation_id='memory-publish-1'",
        )
        .unwrap();
    let mismatched_commit = restarted_app
        .read_memory_publication(&store, &identity, &root, "memory-publish-1")
        .unwrap();
    assert_eq!(
        mismatched_commit["reconciliation_state"],
        "database_git_conflict"
    );
    assert_eq!(mismatched_commit["git_verified"], true);
    assert_eq!(mismatched_commit["database_effect_matches"], false);
    assert_eq!(mismatched_commit["readback_required"], true);
    let unchanged_after_commit_readback = store
        .external_job_by_operation_with_identity(&identity, "memory-publish-1")
        .unwrap()
        .unwrap();
    assert_eq!(
        unchanged_after_commit_readback.side_effect_ref.as_deref(),
        Some("git:wrong-commit")
    );
    assert_eq!(
        unchanged_after_commit_readback.result_digest.as_deref(),
        Some(expected_content_digest.as_str())
    );

    store
        .execute_batch(&format!(
            "UPDATE boreal_external_job \
             SET side_effect_ref='{expected_side_effect_ref}', \
                 result_digest='sha256:wrong-content' \
             WHERE operation_id='memory-publish-1'"
        ))
        .unwrap();
    let mismatched_digest = restarted_app
        .read_memory_publication(&store, &identity, &root, "memory-publish-1")
        .unwrap();
    assert_eq!(
        mismatched_digest["reconciliation_state"],
        "database_git_conflict"
    );
    assert_eq!(mismatched_digest["database_effect_matches"], false);
    assert_eq!(mismatched_digest["readback_required"], true);
    let unchanged_after_digest_readback = store
        .external_job_by_operation_with_identity(&identity, "memory-publish-1")
        .unwrap()
        .unwrap();
    assert_eq!(
        unchanged_after_digest_readback.side_effect_ref.as_deref(),
        Some(expected_side_effect_ref.as_str())
    );
    assert_eq!(
        unchanged_after_digest_readback.result_digest.as_deref(),
        Some("sha256:wrong-content")
    );
    drop(store);
    fs::remove_dir_all(workspace).unwrap();
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
