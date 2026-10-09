//! Typed transport to cited-memory application workflows. No local acceptance policy.
use super::*;
use boreal_protocol::models::{MemoryCommandDto, MemoryOperationDto};
pub(super) fn supported(path: &[String]) -> bool {
    path.len() == 2
        && path[0] == "memory"
        && matches!(
            path[1].as_str(),
            "draft" | "review" | "publish" | "show" | "search" | "readback" | "reconcile"
        )
}

fn positional_target_field(operation: &str) -> Option<&'static str> {
    match operation {
        "draft" | "review" | "show" => Some("draft_id"),
        "publish" => Some("review_id"),
        "readback" | "reconcile" => Some("operation_id"),
        "search" => Some("text"),
        _ => None,
    }
}

fn bind_positional_target(
    change: &mut Value,
    field: &str,
    positional: &str,
) -> Result<(), CliError> {
    match change.get(field) {
        Some(Value::String(existing)) if existing == positional => Ok(()),
        Some(_) => Err(CliError::invalid(format!(
            "memory positional target conflicts with input {field}"
        ))),
        None => {
            change[field] = json!(positional);
            Ok(())
        }
    }
}

fn map_memory_error(error: boreal_application::KnowledgeError) -> CliError {
    let code = match &error {
        boreal_application::KnowledgeError::Source(boreal_source::SourceError::DigestMismatch) => {
            ErrorCode::IntegrityQuarantined
        }
        _ => ErrorCode::InvalidArgument,
    };
    CliError::with(code, ApplicationOutcome::Rejected, error.to_string())
}

fn publication_readback_unknown(
    operation: &str,
    state: &str,
    stage: &str,
    reconciliation: &str,
    side_effect_ref: Option<&str>,
    detail: &str,
) -> CliError {
    CliError::unknown_delivery(
        operation,
        format!(
            "memory publication state={state}, database_stage={stage}, reconciliation={reconciliation}, side_effect_ref={}; readback failed: {detail}; use `bwrk memory readback --project <project> {operation}` before retrying",
            side_effect_ref.unwrap_or("unavailable")
        ),
    )
}

fn failed_publication_error(
    operation: &str,
    publish_error: boreal_application::KnowledgeError,
    readback_error: boreal_application::KnowledgeError,
    job: Result<Option<boreal_store::jobs::ExternalJobRecord>, boreal_store::StoreError>,
) -> CliError {
    match job {
        Ok(None) => map_memory_error(publish_error),
        Ok(Some(record)) if matches!(record.stage.as_str(), "registered" | "admitted")
            && record.side_effect_ref.is_none() =>
        {
            map_memory_error(publish_error)
        }
        Ok(Some(record)) => publication_readback_unknown(
            operation,
            "unknown",
            &record.stage,
            &record.reconciliation_state,
            record.side_effect_ref.as_deref(),
            &format!("publish failed: {publish_error}; readback failed: {readback_error}"),
        ),
        Err(job_error) => publication_readback_unknown(
            operation,
            "unknown",
            "unavailable",
            "unavailable",
            None,
            &format!(
                "publish failed: {publish_error}; readback failed: {readback_error}; publication record lookup failed: {job_error}"
            ),
        ),
    }
}

pub(super) fn payload(parsed: &ParsedCommand) -> Result<Value, CliError> {
    let context = project_context::resolve(parsed)?;
    let mut change = if let Some(path) = &parsed.options.input {
        let path = project_context::confined_path(&context.root, Path::new(path), false)?;
        serde_json::from_slice::<Value>(
            &fs::read(path).map_err(|e| CliError::invalid(e.to_string()))?,
        )
        .map_err(|e| CliError::invalid(e.to_string()))?
    } else {
        json!({})
    };
    if !change.is_object() {
        return Err(CliError::invalid("memory input must be an object"));
    }
    if change
        .get("kind")
        .and_then(Value::as_str)
        .is_some_and(|kind| kind != parsed.path[1])
    {
        return Err(CliError::invalid(
            "memory input kind disagrees with command",
        ));
    }
    change["kind"] = json!(parsed.path[1]);
    if let Some(id) = parsed.options.positionals.first() {
        let key = positional_target_field(&parsed.path[1])
            .ok_or_else(|| CliError::invalid("memory command does not accept a positional ID"))?;
        bind_positional_target(&mut change, key, id)?;
    }
    Ok(
        json!({"expected_revision":parsed.options.expected_revision,"confirmed":parsed.options.setup.yes,"change":change}),
    )
}

pub(super) fn run(
    parsed: &ParsedCommand,
    operation: &str,
    store: &SqliteStore,
) -> Result<CliResult, CliError> {
    apply(
        store,
        &project_argument(parsed, 0)?,
        &parsed.options.actor,
        &parsed.options.session,
        operation,
        payload(parsed)?,
    )
}
pub(super) fn apply(
    store: &SqliteStore,
    project: &str,
    actor: &str,
    session: &str,
    operation: &str,
    value: Value,
) -> Result<CliResult, CliError> {
    let dto: MemoryCommandDto = serde_json::from_value(value)
        .map_err(|e| CliError::invalid(format!("invalid memory request: {e}")))?;
    let identity = boreal_store::identity::IdentityStore::new(store)
        .context(project)
        .map_err(|e| CliError::invalid(e.to_string()))?;
    let binding = boreal_store::identity::IdentityStore::new(store)
        .workspace_binding(project)
        .map_err(|e| CliError::invalid(e.to_string()))?;
    let root = Path::new(binding.canonical_root());
    let memory_root = project_context::confined_path(root, Path::new("memory"), true)?;
    let catalog_path = store
        .database_location()
        .and_then(Path::parent)
        .ok_or_else(|| CliError::invalid("source catalog requires a persistent project database"))?
        .join("source");
    let catalog_path = project_context::confined_path(root, &catalog_path, true)?;
    // Reading a durable draft, review or Git result does not require the source
    // cache to be online. Creating or publishing proof still validates real citations.
    let needs_sources = matches!(
        &dto.change,
        MemoryOperationDto::Draft { .. } | MemoryOperationDto::Publish { .. }
    );
    let catalog = if needs_sources {
        source_catalog(&catalog_path)?
    } else {
        SourceCatalog::default()
    };
    let app = boreal_application::KnowledgeApplication::new(&catalog);
    let context = boreal_store::V3MutationContext {
        project_id: project.into(),
        actor_id: actor.into(),
        session_id: Some(session.into()),
        operation_id: operation.into(),
        request_digest: boreal_application::canonical_request_digest(
            "memory/v1",
            json!({"project_id":project,"actor_id":actor,"session_id":session}),
        ),
        expected_revision: dto.expected_revision,
        now: now(),
    };
    let map_error = |error: boreal_application::KnowledgeError| map_memory_error(error);
    let mutation = matches!(
        &dto.change,
        MemoryOperationDto::Draft { .. }
            | MemoryOperationDto::Review { .. }
            | MemoryOperationDto::Publish { .. }
            | MemoryOperationDto::Reconcile { .. }
    );
    if mutation && (!dto.confirmed || dto.expected_revision.is_none()) {
        return Err(CliError::invalid(
            "memory mutation requires --yes and --expected-revision",
        ));
    }
    match dto.change {
        MemoryOperationDto::Draft {
            draft_id,
            entry_id,
            title,
            body,
            citations,
        } => {
            let result = app
                .persist_memory_draft(
                    store,
                    &context,
                    &draft_id,
                    boreal_application::MemoryDraftInput {
                        operation_id: operation.into(),
                        project_id: project.into(),
                        entry_id,
                        title,
                        body,
                        citations: citations
                            .into_iter()
                            .map(|c| boreal_application::MemoryCitationInput {
                                source_version_id: c.source_version_id,
                                location: c.location,
                                excerpt: c.excerpt.unwrap_or_default(),
                            })
                            .collect(),
                    },
                )
                .map_err(map_error)?;
            bounded_result(
                Some(
                    json!({"draft_id":draft_id,"durability":"sqlite","operation_id":operation,"replayed":result.replayed}),
                ),
                Some(result.revision),
            )
        }
        MemoryOperationDto::Review {
            draft_id,
            decision,
            reason,
        } => {
            let result = app
                .review_durable_memory(store, &context, &draft_id, &decision, &reason)
                .map_err(map_error)?;
            bounded_result(
                Some(
                    json!({"draft_id":draft_id,"review_id":operation,"decision":decision,"replayed":result.replayed}),
                ),
                Some(result.revision),
            )
        }
        MemoryOperationDto::Publish {
            review_id,
            expected_manifest_identity,
        } => {
            let root = boreal_memory::MemoryRoot::new(memory_root.clone())
                .map_err(|e| CliError::invalid(e.to_string()))?;
            root.validate_existing_repository()
                .map_err(|e| CliError::invalid(e.to_string()))?;
            let result = match app.publish_durable_memory(
                store,
                &identity,
                &context,
                &memory_root,
                &review_id,
                &expected_manifest_identity,
            ) {
                Ok(result) => result,
                Err(error) => {
                    // Git and SQLite cannot commit atomically. If publication
                    // has crossed that boundary, preserve the original
                    // operation identity and tell the caller to read it back
                    // before considering another publication attempt.
                    match app.read_memory_publication(store, &identity, &memory_root, operation) {
                        Ok(readback) => {
                            let state = readback
                                .get("reconciliation_state")
                                .and_then(Value::as_str)
                                .unwrap_or_default();
                            if state == "reconciled"
                                && readback.get("readback_required").and_then(Value::as_bool)
                                    == Some(false)
                            {
                                let mut response = bounded_result(
                                    Some(json!({
                                        "operation_id": operation,
                                        "state": "Reconciled",
                                        "readback": readback,
                                    })),
                                    Some(
                                        store.project_revision(project).map_err(map_store_error)?.0,
                                    ),
                                )?;
                                response.outcome = ApplicationOutcome::Changed;
                                return Ok(response);
                            }
                            if readback.get("readback_required").and_then(Value::as_bool)
                                == Some(true)
                                && state != "not_published"
                            {
                                return Err(CliError::unknown_delivery(
                                operation,
                                format!(
                                    "memory publication is {state}; use `bwrk memory readback --project {project} {operation}` before retrying"
                                ),
                            ));
                            }
                        }
                        Err(readback_error) => {
                            let job =
                                store.external_job_by_operation_with_identity(&identity, operation);
                            return Err(failed_publication_error(
                                operation,
                                error,
                                readback_error,
                                job,
                            ));
                        }
                    }
                    return Err(map_error(error));
                }
            };
            let readback =
                match app.read_memory_publication(store, &identity, &memory_root, operation) {
                    Ok(readback) => readback,
                    Err(error) => {
                        let state = format!("{:?}", result.state);
                        let stage = format!("{:?}", result.job.state);
                        let reconciliation = match result.state {
                            boreal_application::MemoryPublicationState::Pending => {
                                "publication_pending"
                            }
                            boreal_application::MemoryPublicationState::ReadbackRequired => {
                                "readback_required"
                            }
                            boreal_application::MemoryPublicationState::Reconciled => "reconciled",
                            boreal_application::MemoryPublicationState::Rejected => "rejected",
                            boreal_application::MemoryPublicationState::Failed => "failed",
                        };
                        return Err(publication_readback_unknown(
                            operation,
                            &state,
                            &stage,
                            reconciliation,
                            result.job.side_effect_ref.as_deref(),
                            &format!(
                                "{}; job error: {}",
                                error,
                                result.job.error.as_deref().unwrap_or("none")
                            ),
                        ));
                    }
                };
            let mut response = bounded_result(
                Some(
                    json!({"operation_id":operation,"state":format!("{:?}",result.state),"readback":readback}),
                ),
                Some(store.project_revision(project).map_err(map_store_error)?.0),
            )?;
            response.outcome = match result.state {
                boreal_application::MemoryPublicationState::Reconciled => {
                    ApplicationOutcome::Changed
                }
                boreal_application::MemoryPublicationState::Rejected => {
                    ApplicationOutcome::Rejected
                }
                boreal_application::MemoryPublicationState::Failed => ApplicationOutcome::Failed,
                boreal_application::MemoryPublicationState::Pending
                | boreal_application::MemoryPublicationState::ReadbackRequired => {
                    ApplicationOutcome::Unknown
                }
            };
            Ok(response)
        }
        MemoryOperationDto::Show { draft_id } => {
            let (revision, row, review) = store
                .memory_draft_snapshot(project, &draft_id)
                .map_err(map_store_error)?;
            bounded_result(Some(json!({"project_id":project,"draft_id":row.draft_id,"entry_id":row.entry_id,"title":row.title,"body":row.body,
                "citations":serde_json::from_str::<Value>(&row.citations_json).map_err(|e|CliError::invalid(e.to_string()))?,"content_digest":row.content_digest,
                "draft_revision":row.project_revision,"actor_id":row.actor_id,"review":review.map(|r|json!({"review_id":r.review_id,"decision":r.decision,"reason":r.reason,"actor_id":r.actor_id,"revision":r.project_revision}))})),Some(revision)).map(|mut result|{result.outcome=ApplicationOutcome::Unchanged;result})
        }
        MemoryOperationDto::Search {
            text,
            entry_id,
            source_version_id,
            requested_git_revision,
            limit,
        } => {
            let limit = limit.unwrap_or(20);
            if limit == 0 || limit > 100 {
                return Err(CliError::invalid("memory search limit must be 1..100"));
            }
            let result = app
                .search_memory(
                    &memory_root,
                    boreal_application::MemorySearchInput {
                        project_id: project.into(),
                        text,
                        entry_id,
                        source_version_id,
                        requested_git_revision,
                        limit,
                        max_excerpt_bytes: 512,
                    },
                )
                .map_err(map_error)?;
            bounded_result(Some(json!({"project_id":project,"git_revision":result.response.git_revision,"index_revision":result.response.index_revision,"lag":format!("{:?}",result.response.lag),
                "hits":result.response.hits.iter().map(|h|json!({"entry_id":h.entry_id,"title":h.title,"excerpt":h.excerpt,"content_digest":h.content_digest,"git_revision":h.git_revision,
                    "citations":h.citations.iter().map(|c|json!({"source_version_id":c.source_version_id,"location":c.location,"excerpt_digest":c.excerpt_digest})).collect::<Vec<_>>()})).collect::<Vec<_>>()})),Some(store.project_revision(project).map_err(map_store_error)?.0)).map(|mut response|{response.outcome=ApplicationOutcome::Unchanged;response})
        }
        MemoryOperationDto::Reconcile { operation_id } => {
            let result = app
                .reconcile_memory_publication(
                    store,
                    &identity,
                    &context,
                    &memory_root,
                    &operation_id,
                )
                .map_err(map_error)?;
            bounded_result(
                Some(
                    json!({"operation_id":operation,"publication_operation":operation_id,"replayed":result.replayed,"readback":app.read_memory_publication(store,&identity,&memory_root,&operation_id).map_err(map_error)?}),
                ),
                Some(result.revision),
            )
        }
        MemoryOperationDto::Readback { operation_id } => bounded_result(
            Some(
                app.read_memory_publication(store, &identity, &memory_root, &operation_id)
                    .map_err(map_error)?,
            ),
            Some(store.project_revision(project).map_err(map_store_error)?.0),
        )
        .map(|mut response| {
            response.outcome = ApplicationOutcome::Unchanged;
            response
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn memory_publish_positional_targets_review_not_draft() {
        assert_eq!(positional_target_field("publish"), Some("review_id"));
        assert_eq!(positional_target_field("review"), Some("draft_id"));
    }

    #[test]
    fn positional_target_is_injected_or_must_match_input() {
        let mut change = json!({});
        bind_positional_target(&mut change, "draft_id", "draft-7").unwrap();
        assert_eq!(change["draft_id"], "draft-7");

        bind_positional_target(&mut change, "draft_id", "draft-7").unwrap();
        assert!(bind_positional_target(&mut change, "draft_id", "draft-8").is_err());
    }

    #[test]
    fn source_digest_mismatch_is_quarantined_in_memory_routes() {
        let root = std::env::temp_dir().join(format!(
            "boreal-memory-digest-mismatch-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        fs::create_dir_all(&root).expect("create disposable source catalog");
        let catalog = SourceCatalog::with_persistent_filesystem(&root).expect("catalog");
        let version = catalog
            .capture("p1", "notes.md", b"original bytes", "text/plain")
            .expect("capture source");
        let blob_path = boreal_source::FilesystemBlobStore::new(&root)
            .blob_path(&version.content_digest)
            .expect("content addressed blob path");
        fs::write(blob_path, b"tampered bytes").expect("tamper disposable blob");
        let error = catalog
            .verify(&version)
            .expect_err("tampered bytes are rejected");
        assert_eq!(error, boreal_source::SourceError::DigestMismatch);
        let error = map_memory_error(error.into());
        assert_eq!(error.code, ErrorCode::IntegrityQuarantined);
        assert_eq!(error.outcome, ApplicationOutcome::Rejected);
        fs::remove_dir_all(root).expect("remove disposable source catalog");
    }

    #[test]
    fn publish_error_with_effect_stage_and_failed_readback_remains_unknown() {
        let error = failed_publication_error(
            "op-memory-publish",
            boreal_application::KnowledgeError::Invalid("synthetic publish error".into()),
            boreal_application::KnowledgeError::Invalid("synthetic readback error".into()),
            Ok(Some(boreal_store::jobs::ExternalJobRecord {
                job_id: "op-memory-publish".into(),
                operation_id: "op-memory-publish".into(),
                project_id: "p1".into(),
                subject_type: "project".into(),
                subject_id: "p1".into(),
                kind: "memory_publication".into(),
                request_digest: "sha256:request".into(),
                stage: "readback_required".into(),
                side_effect_ref: Some("git:abc123".into()),
                source_identity: None,
                config_identity: None,
                actor_id: "operator".into(),
                session_id: None,
                started_at: None,
                deadline: None,
                result_digest: None,
                reconciliation_state: "git_committed_db_pending".into(),
                error_message: None,
                created_at: "2026-10-09T00:00:00Z".into(),
                updated_at: "2026-10-09T00:00:01Z".into(),
            })),
        );
        assert_eq!(error.outcome, ApplicationOutcome::Unknown);
        let protocol = error.protocol_error.as_deref().expect("protocol error");
        assert_eq!(protocol.operation_id.as_deref(), Some("op-memory-publish"));
        assert_eq!(protocol.readback_required, Some(true));
        assert!(protocol.message.contains("readback_required"));
        assert!(protocol.message.contains("git_committed_db_pending"));
        assert!(protocol.message.contains("git:abc123"));
    }

    #[test]
    fn publication_readback_failures_preserve_unknown_operation_details() {
        for state in ["Pending", "ReadbackRequired", "Reconciled", "Failed"] {
            let error = publication_readback_unknown(
                "op-memory-publish",
                state,
                "readback_required",
                "git_committed_db_pending",
                Some("git:abc123"),
                "synthetic readback interruption",
            );
            assert_eq!(error.code, ErrorCode::UnknownOutcome);
            assert_eq!(error.outcome, ApplicationOutcome::Unknown);
            let protocol = error.protocol_error.as_deref().expect("protocol error");
            assert_eq!(protocol.operation_id.as_deref(), Some("op-memory-publish"));
            assert_eq!(protocol.operation_preserved, Some(true));
            assert_eq!(protocol.readback_required, Some(true));
            assert!(protocol.message.contains(state));
            assert!(protocol.message.contains("readback_required"));
            assert!(protocol.message.contains("git_committed_db_pending"));
            assert!(protocol.message.contains("git:abc123"));
        }
    }

    #[test]
    fn unreadable_publication_record_after_publish_error_is_unknown() {
        let error = failed_publication_error(
            "op-memory-publish",
            boreal_application::KnowledgeError::Invalid("synthetic publish error".into()),
            boreal_application::KnowledgeError::Invalid("synthetic readback error".into()),
            Err(boreal_store::StoreError::Corrupt(
                "synthetic job lookup interruption".into(),
            )),
        );
        assert_eq!(error.outcome, ApplicationOutcome::Unknown);
        assert_eq!(error.code, ErrorCode::UnknownOutcome);
        let protocol = error.protocol_error.as_deref().expect("protocol error");
        assert_eq!(protocol.operation_id.as_deref(), Some("op-memory-publish"));
        assert_eq!(protocol.operation_preserved, Some(true));
        assert_eq!(protocol.readback_required, Some(true));
        assert!(protocol.message.contains("synthetic publish error"));
        assert!(protocol.message.contains("synthetic readback error"));
        assert!(protocol
            .message
            .contains("synthetic job lookup interruption"));
    }
}
