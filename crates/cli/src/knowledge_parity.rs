//! CLI adapters for decisions, cited claims, intake promotion/disposition,
//! and bounded project knowledge context.
use super::*;
use boreal_application::{ClaimInput, ClaimReviewInput, DecisionInput, KnowledgeParityApplication};
use boreal_domain::work_model_v3::{
    IntakeLifecycle, IntakePromotion, PromotionId, PromotionTargetKind,
};
use boreal_domain::{
    AcceptanceProfile, DispatchPolicy, PersistedLifecycle, WorkId, WorkItem, WorkKind,
};

pub(crate) fn supported(path: &[String]) -> bool {
    matches!(path, [a,b] if (a=="decision" && matches!(b.as_str(),"create"|"list"|"show"|"supersede"))
        || (a=="knowledge" && matches!(b.as_str(),"claim"|"context"|"search"|"rebuild"))
        || (a=="claim" && matches!(b.as_str(),"create"|"list"|"show"|"review"))
        || (a=="context" && matches!(b.as_str(),"show"|"search"|"rebuild"))
        || (a=="search" && matches!(b.as_str(),"query"|"index"))
        || (a=="intake" && matches!(b.as_str(),"promote"|"disposition")))
        || matches!(path,[a,b,c] if a=="knowledge" && b=="claim" && matches!(c.as_str(),"create"|"list"|"show"|"review"))
        || matches!(path,[a,b,c] if a=="knowledge" && b=="context" && matches!(c.as_str(),"show"|"search"|"rebuild"))
}

pub(crate) fn run(
    parsed: &ParsedCommand,
    operation: &str,
    store: &SqliteStore,
) -> Result<CliResult, CliError> {
    if matches!(parsed.path.as_slice(),[a,_] if a=="claim"||a=="context"||a=="search") {
        let mut canonical = parsed.clone();
        canonical.path = match parsed.path[0].as_str() {
            "claim" => vec!["knowledge".into(), "claim".into(), parsed.path[1].clone()],
            "context" => vec!["knowledge".into(), "context".into(), parsed.path[1].clone()],
            "search" => vec![
                "knowledge".into(),
                "context".into(),
                if parsed.path[1] == "index" {
                    "rebuild"
                } else {
                    "search"
                }
                .into(),
            ],
            _ => unreachable!(),
        };
        return run(&canonical, operation, store);
    }
    let project = project_argument(parsed, 0)?;
    let app = KnowledgeParityApplication::new(store);
    if parsed.path[0] == "decision" && parsed.path[1] == "list" {
        return read_list(&app, parsed, &project, "decision");
    }
    if parsed.path[0] == "decision" && parsed.path[1] == "show" {
        let id = target(parsed, 0, "decision ID")?;
        let (revision, row, superseded) = app.decision_detail(&project, id).map_err(app_error)?;
        let row = row.ok_or_else(|| CliError::invalid("decision not found in this project"))?;
        let mut result = bounded_result(
            Some(
                json!({"project_id":project,"revision":revision,"decision":decision_json(&row),"superseded":superseded}),
            ),
            None,
        )?;
        result.outcome = ApplicationOutcome::Unchanged;
        return Ok(result);
    }
    if parsed.path[0] == "knowledge"
        && parsed.path[1] == "claim"
        && parsed.path.len() == 3
        && parsed.path[2] == "list"
    {
        return read_list(&app, parsed, &project, "claim");
    }
    if parsed.path[0] == "knowledge"
        && parsed.path[1] == "claim"
        && parsed.path.len() == 3
        && parsed.path[2] == "show"
    {
        let id = target(parsed, 0, "claim ID")?;
        let (revision, claim, reviews) = app.claim_detail(&project, id).map_err(app_error)?;
        let claim = claim.ok_or_else(|| CliError::invalid("claim not found in this project"))?;
        let source = app
            .source_version(&project, &claim.source_version_id)
            .map_err(app_error)?;
        let mut result = bounded_result(
            Some(
                json!({"project_id":project,"revision":revision,"claim":claim_json(&claim),"source":source.as_ref().map(source_json),"reviews":reviews.iter().map(review_json).collect::<Vec<_>>()}),
            ),
            None,
        )?;
        result.outcome = ApplicationOutcome::Unchanged;
        return Ok(result);
    }
    if parsed.path[0] == "knowledge"
        && parsed
            .path
            .get(1)
            .is_some_and(|s| s == "context" || s == "search" || s == "rebuild")
    {
        let action = if parsed.path.len() == 3 {
            parsed.path[2].as_str()
        } else {
            parsed.path[1].as_str()
        };
        return match action {
            "show" | "search" => {
                let query = option(parsed, "--query");
                let limit = number(parsed, "--limit", 20, 100)?;
                let focus = parsed.options.work.as_deref().or(option(parsed, "--work"));
                let mut data = if let Some(work_id) = focus {
                    app.context_for_work(&project, work_id, query, limit)
                } else {
                    app.context(&project, query, limit)
                }
                .map_err(app_error)?;
                enrich_search(parsed, &project, query, limit, &mut data)?;
                if let Some(work_id) = focus {
                    let mut maintenance =
                        boreal_application::KnowledgeMaintenanceApplication::new(store)
                            .maintenance_annotations(&project, "work", work_id, 10, 0)
                            .map_err(app_error)?;
                    if maintenance["revision"] != data["revision"] {
                        return Err(CliError::with(
                            ErrorCode::RevisionConflict,
                            ApplicationOutcome::Conflict,
                            "project changed while composing maintenance context; retry",
                        ));
                    }
                    let latest = maintenance["summaries"]
                        .as_array()
                        .and_then(|rows| rows.first())
                        .filter(|row| row["matches_current_source"] == true)
                        .cloned();
                    maintenance.as_object_mut().unwrap().remove("summaries");
                    maintenance["current_summary"] = json!(latest);
                    maintenance["content_is_untrusted_source_data"] = json!(true);
                    data["maintenance"] = maintenance;
                }

                let mut result = bounded_result(Some(data.clone()), data["revision"].as_u64())?;
                result.outcome = ApplicationOutcome::Unchanged;
                Ok(result)
            }
            "rebuild" => {
                let context = project_context::resolve(parsed)?;
                let binding = IdentityStore::new(store)
                    .workspace_binding(&project)
                    .map_err(|e| CliError::invalid(e.to_string()))?;
                let index = Path::new(binding.canonical_root())
                    .join(".boreal")
                    .join("knowledge-index.json");
                let confined_index = project_context::confined_path(
                    &context.root,
                    Path::new(".boreal/knowledge-index.json"),
                    true,
                )?;
                let previous_digest = existing_digest(&confined_index);
                let mut data = app
                    .rebuild_search_index(&project, index)
                    .map_err(app_error)?;
                let source_root = project_context::confined_path(
                    &context.root,
                    Path::new(".boreal/source"),
                    true,
                )?;
                let mut related_changed = false;
                if source_root.is_dir() {
                    let catalog = source_catalog(&source_root)?;
                    let status = catalog
                        .rebuild_index(Some(&project))
                        .map_err(map_source_error)?;
                    related_changed |= status.repaired > 0 || status.orphan_indexes_removed > 0;
                    data["source_index"] = json!({"source_revision":status.status.source_revision,"index_revision":status.status.index_revision,"lag":status.status.lag,"repaired":status.repaired,"unchanged":status.unchanged,"orphan_indexes_removed":status.orphan_indexes_removed});
                }
                let memory_root =
                    project_context::confined_path(&context.root, Path::new("memory"), true)?;
                if memory_root.is_dir() {
                    let catalog = SourceCatalog::default();
                    let knowledge = KnowledgeApplication::new(&catalog);
                    let result = knowledge
                        .search_memory(
                            &memory_root,
                            boreal_application::MemorySearchInput {
                                project_id: project.clone(),
                                text: None,
                                entry_id: None,
                                source_version_id: None,
                                limit: 1000,
                                max_excerpt_bytes: 256,
                                requested_git_revision: None,
                            },
                        )
                        .map_err(map_knowledge_error)?;
                    data["published_memory_index"] = json!({"git_revision":result.response.git_revision,"index_revision":result.response.index_revision,"lag":format!("{:?}",result.response.lag),"retrieved":true});
                }
                let projection_changed = previous_digest.as_deref() != data["digest"].as_str();
                data["rebuilt"] = json!(projection_changed || related_changed);
                let mut result = bounded_result(Some(data.clone()), data["revision"].as_u64())?;
                result.outcome = if projection_changed || related_changed {
                    ApplicationOutcome::Changed
                } else {
                    ApplicationOutcome::Unchanged
                };
                Ok(result)
            }
            _ => Err(CliError::invalid("unknown knowledge context action")),
        };
    }
    let is_mutation = true;
    require_confirmed(parsed, is_mutation)?;
    let revision = parsed
        .options
        .expected_revision
        .ok_or_else(|| CliError::invalid("mutation requires --expected-revision"))?;
    let ctx = boreal_application::knowledge_operation_context(
        &project,
        &parsed.options.actor,
        &parsed.options.session,
        operation,
        revision,
        &now(),
    );
    match parsed.path.as_slice() {
        [a, b] if a == "decision" && (b == "create" || b == "supersede") => {
            let mut v = input_object(parsed)?;
            if let Some(id) = parsed.options.positionals.get(project_offset(parsed)) {
                v.entry("decision_id").or_insert(json!(id));
            }
            if b == "supersede" && v.get("supersedes_id").is_none() {
                if let Some(id) = parsed.options.positionals.get(project_offset(parsed) + 1) {
                    v["supersedes_id"] = json!(id)
                } else {
                    return Err(CliError::invalid(
                        "decision supersede requires the prior decision ID",
                    ));
                }
            }
            let input = DecisionInput {
                decision_id: json_string(&v, "decision_id")?,
                title: json_string(&v, "title")?,
                body: json_string(&v, "body")?,
                rationale: json_string(&v, "rationale")?,
                source_version_id: json_optional_string(&v, "source_version_id")?,
                supersedes_id: json_optional_string(&v, "supersedes_id")?,
            };
            let decision_id = input.decision_id.clone();
            let result = app.create_decision(&ctx, input).map_err(app_error)?;
            mutation_result(
                Some(
                    json!({"decision_id":decision_id,"operation_id":result.operation_id,"replayed":result.replayed}),
                ),
                result.revision,
                result.replayed,
            )
        }
        [a, b, c] if a == "knowledge" && b == "claim" && c == "create" => {
            let mut v = input_object(parsed)?;
            if let Some(id) = parsed.options.positionals.get(project_offset(parsed)) {
                v.entry("claim_id").or_insert(json!(id));
            }
            let input = ClaimInput {
                claim_id: json_string(&v, "claim_id")?,
                statement: json_string(&v, "statement")?,
                source_version_id: json_string(&v, "source_version_id")?,
                citation_location: json_string(&v, "citation_location")?,
                supersedes_id: json_optional_string(&v, "supersedes_id")?,
            };
            let id = input.claim_id.clone();
            let result = app.create_claim(&ctx, input).map_err(app_error)?;
            mutation_result(
                Some(
                    json!({"claim_id":id,"operation_id":result.operation_id,"replayed":result.replayed}),
                ),
                result.revision,
                result.replayed,
            )
        }
        [a, b, c] if a == "knowledge" && b == "claim" && c == "review" => {
            let id = target(parsed, 0, "claim ID")?.to_owned();
            let decision = option(parsed, "--decision")
                .ok_or_else(|| CliError::invalid("--decision is required"))?
                .to_owned();
            let reason = option(parsed, "--reason")
                .or_else(|| option(parsed, "--description"))
                .ok_or_else(|| CliError::invalid("--reason is required"))?
                .to_owned();
            let input = ClaimReviewInput {
                review_id: operation.into(),
                claim_id: id.clone(),
                decision,
                reason,
            };
            let result = app.review_claim(&ctx, input).map_err(app_error)?;
            mutation_result(
                Some(
                    json!({"claim_id":id,"review_id":operation,"operation_id":result.operation_id,"replayed":result.replayed}),
                ),
                result.revision,
                result.replayed,
            )
        }
        [a, b] if a == "intake" && b == "promote" => {
            promote_intake(store, parsed, &project, operation, revision)
        }
        [a, b] if a == "intake" && b == "disposition" => {
            let id = target(parsed, 0, "intake ID")?;
            let lifecycle = parse_lifecycle(
                option(parsed, "--state")
                    .ok_or_else(|| CliError::invalid("--state is required"))?,
            )?;
            let item = app
                .intake_item(&project, id)
                .map_err(app_error)?
                .ok_or_else(|| CliError::invalid("intake item not found in this project"))?;
            let revisit = option(parsed, "--revisit-at-ms")
                .map(str::parse::<i64>)
                .transpose()
                .map_err(|_| CliError::invalid("--revisit-at-ms must be an integer"))?;
            let result = app
                .update_intake_disposition(&ctx, id, item.content_revision, lifecycle, revisit)
                .map_err(app_error)?;
            mutation_result(
                Some(
                    json!({"intake_id":id,"content_revision":item.content_revision,"lifecycle":option(parsed,"--state"),"operation_id":result.operation_id,"replayed":result.replayed}),
                ),
                result.revision,
                result.replayed,
            )
        }
        _ => Err(CliError::invalid("unsupported knowledge command")),
    }
}

fn read_list(
    app: &KnowledgeParityApplication<'_>,
    parsed: &ParsedCommand,
    project: &str,
    kind: &str,
) -> Result<CliResult, CliError> {
    let limit = number(parsed, "--limit", 50, 1000)? as u64;
    let offset = number(parsed, "--offset", 0, u64::MAX as usize)? as u64;
    let (revision, data) = if kind == "decision" {
        let (revision, items) = app
            .decision_page(project, limit, offset)
            .map_err(app_error)?;
        (
            revision,
            json!({"project_id":project,"revision":revision,"items":items.iter().map(decision_json).collect::<Vec<_>>()}),
        )
    } else {
        let (revision, claims) = app
            .claim_page_full(project, limit, offset)
            .map_err(app_error)?;
        let mut items = Vec::with_capacity(claims.len());
        for (claim, reviews) in claims {
            let latest = reviews.last().map(review_json);
            items.push(json!({"claim":claim_json(&claim),"latest_review":latest,"review_history":reviews.iter().map(review_json).collect::<Vec<_>>()}));
        }
        (
            revision,
            json!({"project_id":project,"revision":revision,"items":items}),
        )
    };
    let mut result = bounded_result(Some(data), Some(revision))?;
    result.outcome = ApplicationOutcome::Unchanged;
    Ok(result)
}
fn promote_intake(
    store: &SqliteStore,
    parsed: &ParsedCommand,
    project: &str,
    operation: &str,
    revision: u64,
) -> Result<CliResult, CliError> {
    let app = KnowledgeParityApplication::new(store);
    let id = target(parsed, 0, "intake ID")?;
    let item = app
        .intake_item(project, id)
        .map_err(app_error)?
        .ok_or_else(|| CliError::invalid("intake item not found in this project"))?;
    let kind = option(parsed, "--target-kind")
        .ok_or_else(|| CliError::invalid("--target-kind is required"))?;
    let target = option(parsed, "--target-id")
        .ok_or_else(|| CliError::invalid("--target-id is required"))?;
    let target_kind = match kind {
        "draft_work" => PromotionTargetKind::DraftWork,
        "source_version" => PromotionTargetKind::SourceVersion,
        "memory_draft" => PromotionTargetKind::MemoryDraft,
        _ => {
            return Err(CliError::invalid(
                "--target-kind must be draft_work, source_version, or memory_draft",
            ));
        }
    };
    let promotion = IntakePromotion {
        id: PromotionId::new(operation),
        project_id: project.into(),
        intake_id: IntakeItemId::new(id),
        intake_revision: item.content_revision,
        intake_digest: item.content_digest,
        target_kind,
        target_id: target.into(),
    };
    let scope = boreal_application::PlanningScope::new(
        ProjectId::new(project),
        parsed.options.actor.clone(),
    )
    .with_session(parsed.options.session.clone())
    .at_revision(revision);
    let create_work = parsed.options.extra.contains_key("--create-work");
    if create_work {
        if target_kind != PromotionTargetKind::DraftWork {
            return Err(CliError::invalid(
                "--create-work requires --target-kind draft_work",
            ));
        }
        if !parsed.options.setup.yes {
            return Err(CliError::invalid(
                "--create-work requires --yes to confirm creation",
            ));
        }
        let expected_revision = parsed.options.expected_revision.ok_or_else(|| {
            CliError::invalid("intake promote --create-work requires --expected-revision")
        })?;
        let mut scope = scope;
        scope.expected_revision = Some(expected_revision);
        let values = input_object(parsed)?;
        const ALLOWED: &[&str] = &[
            "title",
            "description",
            "kind",
            "parent",
            "priority",
            "dispatch",
            "acceptance_profile",
        ];
        if let Some(key) = values.keys().find(|key| !ALLOWED.contains(&key.as_str())) {
            return Err(CliError::invalid(format!(
                "unsupported --create-work input field '{key}'"
            )));
        }
        let fallback_title = item
            .content
            .lines()
            .map(str::trim)
            .find(|line| !line.is_empty())
            .unwrap_or("Promoted intake item");
        let title = input_string(&values, "title")?.unwrap_or(fallback_title);
        let description = input_string(&values, "description")?.unwrap_or(&item.content);
        let work_kind = match input_string(&values, "kind")?.unwrap_or("task") {
            "task" => WorkKind::Task,
            "milestone" => WorkKind::Milestone,
            "sprint" => WorkKind::Sprint,
            _ => {
                return Err(CliError::invalid(
                    "input kind must be task, milestone, or sprint",
                ));
            }
        };
        let parent = input_string(&values, "parent")?.map(str::to_owned);
        let priority = values
            .get("priority")
            .map(|value| {
                value
                    .as_u64()
                    .and_then(|value| u8::try_from(value).ok())
                    .ok_or_else(|| {
                        CliError::invalid("input priority must be an integer from 0 to 255")
                    })
            })
            .transpose()?
            .unwrap_or(0);
        let dispatch = match input_string(&values, "dispatch")?.unwrap_or("automatic") {
            "automatic" => DispatchPolicy::Automatic,
            "operator_only" => DispatchPolicy::OperatorOnly,
            "paused" => DispatchPolicy::Paused,
            _ => {
                return Err(CliError::invalid(
                    "input dispatch must be automatic, operator_only, or paused",
                ));
            }
        };
        let acceptance_profile =
            match input_string(&values, "acceptance_profile")?.unwrap_or("focused") {
                "focused" => AcceptanceProfile::focused(),
                "reviewed" => AcceptanceProfile::reviewed(),
                _ => {
                    return Err(CliError::invalid(
                        "input acceptance_profile must be focused or reviewed",
                    ));
                }
            };
        let mut work = WorkItem::new(
            ProjectId::new(project),
            WorkId::new(target),
            work_kind,
            parent.map(WorkId::new),
            title,
        );
        work.description = description.to_owned();
        work.lifecycle = PersistedLifecycle::Draft;
        work.priority = priority;
        work.dispatch_policy = dispatch;
        work.acceptance_profile = acceptance_profile;
        let result = app
            .promote_intake_create_work(&scope, operation, &promotion, &work, &now())
            .map_err(app_error)?;
        return mutation_result(
            Some(json!({
                "intake_id":id,
                "promotion_id":operation,
                "target_kind":"draft_work",
                "target_id":target,
                "created_work":true,
                "work_id":target,
                "operation_id":result.operation_id,
                "replayed":!result.changed,
            })),
            result.snapshot_revision,
            !result.changed,
        );
    }
    let result = app
        .promote_intake_link(&scope, operation, &promotion, &now())
        .map_err(app_error)?;
    mutation_result(
        Some(
            json!({"intake_id":id,"promotion_id":operation,"target_kind":kind,"target_id":target,"operation_id":result.operation_id,"replayed":!result.changed}),
        ),
        result.snapshot_revision,
        !result.changed,
    )
}

fn input_string<'a>(
    values: &'a serde_json::Map<String, Value>,
    name: &str,
) -> Result<Option<&'a str>, CliError> {
    values
        .get(name)
        .map(|value| {
            value
                .as_str()
                .ok_or_else(|| CliError::invalid(format!("input field '{name}' must be a string")))
        })
        .transpose()
}
fn input_object(parsed: &ParsedCommand) -> Result<serde_json::Map<String, Value>, CliError> {
    let mut value = if let Some(path) = &parsed.options.input {
        let context = project_context::resolve(parsed)?;
        let p = project_context::confined_path(&context.root, Path::new(path), false)?;
        let bytes = read_bounded_file(&p, MAX_JSON_BYTES as u64)?;
        if bytes.len() > MAX_JSON_BYTES {
            return Err(CliError::invalid(
                "knowledge input exceeds the JSON input bound",
            ));
        }
        serde_json::from_slice::<Value>(&bytes).map_err(|e| CliError::invalid(e.to_string()))?
    } else {
        json!({})
    };
    let object = value
        .as_object_mut()
        .ok_or_else(|| CliError::invalid("input must be a JSON object"))?;
    for (key, flag) in [
        ("title", "--title"),
        ("body", "--body"),
        ("rationale", "--reason"),
        ("source_version_id", "--source-version"),
        ("supersedes_id", "--supersedes"),
        ("statement", "--statement"),
        ("citation_location", "--citation"),
    ] {
        if let Some(v) = option(parsed, flag) {
            let supplied = json!(v);
            if let Some(existing) = object.get(key) {
                if existing != &supplied {
                    return Err(CliError::invalid(format!(
                        "--input field {key} conflicts with {flag}"
                    )));
                }
            } else {
                object.insert(key.into(), supplied);
            }
        }
    }
    Ok(object.clone())
}

fn decision_json(row: &boreal_store::KnowledgeDecisionRecord) -> Value {
    json!({"project_id":row.project_id,"decision_id":row.decision_id,"title":row.title,"body":row.body,"rationale":row.rationale,"source_version_id":row.source_version_id,"supersedes_id":row.supersedes_id,"actor_id":row.actor_id,"operation_id":row.operation_id,"project_revision":row.project_revision,"created_at":row.created_at})
}
fn claim_json(row: &boreal_store::KnowledgeClaimRecord) -> Value {
    json!({"project_id":row.project_id,"claim_id":row.claim_id,"statement":row.statement,"content_digest":row.content_digest,"source_version_id":row.source_version_id,"citation_location":row.citation_location,"supersedes_id":row.supersedes_id,"actor_id":row.actor_id,"operation_id":row.operation_id,"project_revision":row.project_revision,"created_at":row.created_at})
}
fn review_json(row: &boreal_store::KnowledgeClaimReviewRecord) -> Value {
    json!({"project_id":row.project_id,"review_id":row.review_id,"claim_id":row.claim_id,"decision":row.decision,"reason":row.reason,"actor_id":row.actor_id,"operation_id":row.operation_id,"project_revision":row.project_revision,"created_at":row.created_at})
}
fn source_json(row: &boreal_store::SourceVersionRecord) -> Value {
    json!({"source_version_id":row.source_version_id,"project_id":row.project_id,"origin":row.origin,"access_scope":row.access_scope,"content_digest":row.content_digest,"media_type":row.media_type,"byte_count":row.byte_count,"captured_at":row.captured_at,"parser_identity":row.parser_identity,"availability":row.availability,"citation_json":row.citation_json})
}

fn mutation_result(
    data: Option<Value>,
    revision: u64,
    replayed: bool,
) -> Result<CliResult, CliError> {
    let mut result = bounded_result(data, Some(revision))?;
    result.outcome = if replayed {
        ApplicationOutcome::Unchanged
    } else {
        ApplicationOutcome::Changed
    };
    Ok(result)
}

fn existing_digest(path: &Path) -> Option<String> {
    let bytes = read_bounded_file(path, MAX_JSON_BYTES as u64).ok()?;
    if bytes.len() > MAX_JSON_BYTES {
        return None;
    }
    Some(sha256_content_digest(&bytes))
}

fn option<'a>(parsed: &'a ParsedCommand, key: &str) -> Option<&'a str> {
    let direct = match key {
        "--title" => parsed.options.title.as_deref(),
        "--reason" => parsed.options.reason.as_deref(),
        "--description" => parsed.options.description.as_deref(),
        "--source-version" => parsed.options.source_version.as_deref(),
        _ => None,
    };
    direct.or_else(|| {
        parsed
            .options
            .extra
            .get(key)
            .and_then(|values| values.last())
            .map(String::as_str)
    })
}
fn number(
    parsed: &ParsedCommand,
    key: &str,
    default: usize,
    max: usize,
) -> Result<usize, CliError> {
    let direct = match key {
        "--limit" => parsed
            .options
            .limit
            .map(usize::try_from)
            .transpose()
            .map_err(|_| CliError::invalid("--limit exceeds supported range"))?,
        "--offset" => parsed
            .options
            .offset
            .map(usize::try_from)
            .transpose()
            .map_err(|_| CliError::invalid("--offset exceeds supported range"))?,
        _ => None,
    };
    let value = direct
        .or(option(parsed, key)
            .map(str::parse::<usize>)
            .transpose()
            .map_err(|_| CliError::invalid(format!("{key} must be a positive integer")))?)
        .unwrap_or(default);
    if (value == 0 && key != "--offset") || value > max {
        return Err(CliError::invalid(format!("{key} must be 1..={max}")));
    }
    Ok(value)
}
fn target<'a>(parsed: &'a ParsedCommand, index: usize, what: &str) -> Result<&'a str, CliError> {
    parsed
        .options
        .positionals
        .get(project_offset(parsed) + index)
        .map(String::as_str)
        .ok_or_else(|| CliError::invalid(format!("{what} is required")))
}
fn json_string(value: &serde_json::Map<String, Value>, key: &str) -> Result<String, CliError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| CliError::invalid(format!("input field {key} must be a string")))
}
fn json_optional_string(
    value: &serde_json::Map<String, Value>,
    key: &str,
) -> Result<Option<String>, CliError> {
    match value.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(v)) => Ok(Some(v.clone())),
        _ => Err(CliError::invalid(format!(
            "input field {key} must be a string or null"
        ))),
    }
}
fn project_offset(parsed: &ParsedCommand) -> usize {
    usize::from(parsed.options.project.is_none())
}
fn parse_lifecycle(s: &str) -> Result<IntakeLifecycle, CliError> {
    match s {
        "captured" => Ok(IntakeLifecycle::Captured),
        "triaged" => Ok(IntakeLifecycle::Triaged),
        "deferred" => Ok(IntakeLifecycle::Deferred),
        "resolved" => Ok(IntakeLifecycle::Resolved),
        "archived" => Ok(IntakeLifecycle::Archived),
        _ => Err(CliError::invalid(
            "state must be captured, triaged, deferred, resolved, or archived",
        )),
    }
}
fn require_confirmed(parsed: &ParsedCommand, mutation: bool) -> Result<(), CliError> {
    if mutation && !parsed.options.setup.yes {
        return Err(CliError::invalid("knowledge mutation requires --yes"));
    }
    Ok(())
}
fn app_error(e: ApplicationError) -> CliError {
    CliError::invalid(e.to_string())
}
/// Add the canonical source-engine and published Git-memory retrieval layers
/// to the operational SQLite capsule. Each result keeps its own source/index
/// revisions and citations; retrieved text is never executable authority.
fn enrich_search(
    parsed: &ParsedCommand,
    project: &str,
    query: Option<&str>,
    limit: usize,
    data: &mut Value,
) -> Result<(), CliError> {
    let project_context = project_context::resolve(parsed)?;
    let source_root =
        project_context::confined_path(&project_context.root, Path::new(".boreal/source"), true)?;
    let catalog = if source_root.is_dir() {
        source_catalog(&source_root)?
    } else {
        SourceCatalog::default()
    };
    let knowledge = KnowledgeApplication::new(&catalog);
    if let Some(query) = query {
        let source = knowledge
            .search_sources(boreal_source::RetrievalRequest {
                project_id: project.into(),
                query: query.into(),
                limit,
                max_excerpt_bytes: 320,
            })
            .map_err(map_knowledge_error)?;
        data["source_search"] = json!({"source_revision":source.source_revision,"index_revision":source.index_revision,"lag":source.lag,"hits":source.hits.iter().map(|hit|json!({"source_version_id":hit.source_version_id,"origin":hit.origin,"location":hit.location,"excerpt":hit.excerpt,"excerpt_digest":hit.excerpt_digest,"score":hit.score,"index_revision":hit.index_revision})).collect::<Vec<_>>()});
    }
    let memory_root =
        project_context::confined_path(&project_context.root, Path::new("memory"), true)?;
    if memory_root.is_dir() {
        let result = knowledge
            .search_memory(
                &memory_root,
                boreal_application::MemorySearchInput {
                    project_id: project.into(),
                    text: query.map(str::to_owned),
                    entry_id: None,
                    source_version_id: None,
                    limit,
                    max_excerpt_bytes: 320,
                    requested_git_revision: None,
                },
            )
            .map_err(map_knowledge_error)?;
        data["published_memory_search"] = json!({"git_revision":result.response.git_revision,"index_revision":result.response.index_revision,"lag":format!("{:?}",result.response.lag),"hits":result.response.hits.iter().map(|hit|json!({"entry_id":hit.entry_id,"title":hit.title,"excerpt":hit.excerpt,"content_digest":hit.content_digest,"git_revision":hit.git_revision,"index_revision":hit.index_revision,"authority":format!("{:?}",hit.authority),"source_trust":format!("{:?}",hit.source_trust),"citations":hit.citations.iter().map(|citation|json!({"source_version_id":citation.source_version_id,"location":citation.location})).collect::<Vec<_>>()})).collect::<Vec<_>>()});
    }
    Ok(())
}
