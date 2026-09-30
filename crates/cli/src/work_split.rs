//! CLI adapter for atomic sibling-task decomposition.
use super::*;
use boreal_application::{WorkSplitInput, canonical_request_digest, sha256_content_digest};
use boreal_store::{V3MutationContext, WorkSplitRecord};

pub(crate) fn supported(path: &[String]) -> bool {
    matches!(path, [a, b] if a == "work" && b == "split")
        || matches!(path, [a, b, c] if a == "work" && b == "split" && c == "show")
}

pub(crate) fn run(
    parsed: &ParsedCommand,
    operation: &str,
    store: &SqliteStore,
) -> Result<CliResult, CliError> {
    let project = parsed
        .options
        .project
        .clone()
        .ok_or_else(|| CliError::invalid("work split requires --project"))?;
    if parsed.path.last().is_some_and(|part| part == "show") {
        let split_id = parsed
            .options
            .positionals
            .first()
            .ok_or_else(|| CliError::invalid("work split show requires SPLIT_ID"))?;
        let split = store
            .work_split(&project, split_id)
            .map_err(|e| CliError::invalid(e.to_string()))?
            .ok_or_else(|| CliError::invalid("split lineage not found in this project"))?;
        let revision = store
            .project_revision(&project)
            .map_err(|e| CliError::invalid(e.to_string()))?
            .0;
        let mut result = bounded_result(Some(split_json(&split)), Some(revision))?;
        result.outcome = ApplicationOutcome::Unchanged;
        return Ok(result);
    }

    let work_id = parsed
        .options
        .positionals
        .first()
        .ok_or_else(|| CliError::invalid("work split requires WORK_ID"))?;
    let title = parsed
        .options
        .title
        .as_deref()
        .ok_or_else(|| CliError::invalid("work split requires --title"))?;
    let expected = parsed
        .options
        .expected_revision
        .ok_or_else(|| CliError::invalid("work split requires --expected-revision"))?;
    if !parsed.options.setup.yes {
        return Err(CliError::invalid(
            "work split is a mutation and requires --yes",
        ));
    }
    let acceptance = one_extra(parsed, "--acceptance")?;
    if acceptance
        .as_deref()
        .is_some_and(|v| !matches!(v, "focused" | "reviewed"))
    {
        return Err(CliError::invalid(
            "--acceptance must be focused or reviewed",
        ));
    }
    let labels = parsed
        .options
        .extra
        .get("--label")
        .cloned()
        .unwrap_or_default();
    let priority = match one_extra(parsed, "--priority")? {
        Some(value) => Some(
            value
                .parse::<u8>()
                .map_err(|_| CliError::invalid("--priority must be an integer from 0 to 255"))?,
        ),
        None => parsed.options.priority,
    };
    let digest = sha256_content_digest(operation.as_bytes());
    let child_id = format!("split-child-{}", &digest[..32]);
    let split_id = format!("split-{}", &digest[..32]);
    let payload = json!({
        "project": project,
        "work_id": work_id,
        "child_id": child_id,
        "split_id": split_id,
        "title": title,
        "description": parsed.options.description,
        "priority": priority,
        "labels": labels,
        "acceptance": acceptance,
        "expected_revision": expected,
    });
    let context = V3MutationContext {
        project_id: project.clone(),
        actor_id: parsed.options.actor.clone(),
        session_id: Some(parsed.options.session.clone()),
        operation_id: operation.to_owned(),
        request_digest: canonical_request_digest("work.split", payload),
        expected_revision: Some(expected),
        now: stamp(now_ms_u64()),
    };
    let input = WorkSplitInput {
        project_id: project.clone(),
        parent_work_id: work_id.clone(),
        child_work_id: child_id,
        split_id,
        title: title.to_owned(),
        description: parsed.options.description.clone().unwrap_or_default(),
        priority,
        labels,
        acceptance,
        as_of_ms: now_ms_u64(),
    };
    let mutation =
        boreal_application::split_work(store, &context, &input).map_err(CliError::invalid)?;
    let split = store
        .work_split(&project, &input.split_id)
        .map_err(|e| CliError::invalid(e.to_string()))?
        .ok_or_else(|| CliError::invalid("split mutation committed without lineage readback"))?;
    let mut result = bounded_result(Some(split_json(&split)), Some(mutation.revision))?;
    result.outcome = if mutation.replayed {
        ApplicationOutcome::Unchanged
    } else {
        ApplicationOutcome::Changed
    };
    Ok(result)
}

fn one_extra(parsed: &ParsedCommand, key: &str) -> Result<Option<String>, CliError> {
    let Some(values) = parsed.options.extra.get(key) else {
        return Ok(None);
    };
    if values.len() != 1 {
        return Err(CliError::invalid(format!("{key} may be supplied once")));
    }
    Ok(values.first().cloned())
}

fn split_json(row: &WorkSplitRecord) -> Value {
    json!({
        "schema": "boreal.work-split.v1",
        "project_id": row.project_id,
        "split_id": row.split_id,
        "source_work_id": row.parent_work_id,
        "child_work_id": row.child_work_id,
        "parent_project_revision": row.parent_project_revision,
        "project_revision": row.project_revision,
        "source_version_id": row.parent_source_version_id,
        "child_source_version_id": row.child_source_version_id,
        "proof_context": serde_json::from_str::<Value>(&row.proof_context_json).unwrap_or(Value::Null),
        "acceptance_profile_id": row.inherited_profile_id,
        "acceptance_profile_version": row.inherited_profile_version,
        "child_acceptance_profile_id": row.child_profile_id,
        "child_acceptance_profile_version": row.child_profile_version,
        "actor_id": row.actor_id,
        "session_id": row.session_id,
        "operation_id": row.operation_id,
        "created_at": row.created_at,
    })
}
