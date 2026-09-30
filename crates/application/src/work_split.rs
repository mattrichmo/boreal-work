//! Transactional application boundary for decomposing open tasks.

use boreal_domain::{
    AcceptanceProfile, ActorContext, ActorId, ActorRole, GateState, ProjectId, TimestampMs, WorkId,
    WorkItem, WorkKind,
};
use boreal_store::{MutationResult, SqliteStore, V3MutationContext, WorkSplitMutationInput};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkSplitInput {
    pub project_id: String,
    pub parent_work_id: String,
    pub child_work_id: String,
    pub split_id: String,
    pub title: String,
    pub description: String,
    pub priority: Option<u8>,
    pub labels: Vec<String>,
    /// Optional canonical profile replacement (`focused` or `reviewed`).
    pub acceptance: Option<String>,
    pub as_of_ms: u64,
}

/// Resolves the live source definition and delegates all mutation semantics to
/// one revision-fenced store transaction. The source remains untouched and
/// its historical receipts are recorded only as provenance.
pub fn split_work(
    store: &SqliteStore,
    context: &V3MutationContext,
    input: &WorkSplitInput,
) -> Result<MutationResult, String> {
    if context.project_id != input.project_id {
        return Err("work split project does not match mutation scope".into());
    }
    if context.expected_revision.is_none() || context.session_id.as_deref().unwrap_or("").is_empty()
    {
        return Err(
            "work split requires an authenticated project session and expected revision".into(),
        );
    }
    if input.title.trim().is_empty() || input.title.len() > 512 || input.description.len() > 65_536
    {
        return Err("split title and description exceed the supported bounds".into());
    }
    let project = ProjectId::parse(input.project_id.clone()).map_err(|e| e.to_string())?;
    let child_id = WorkId::parse(input.child_work_id.clone()).map_err(|e| e.to_string())?;
    let mutation = WorkSplitMutationInput {
        project_id: input.project_id.clone(),
        split_id: input.split_id.clone(),
        parent_work_id: input.parent_work_id.clone(),
        child_work_id: input.child_work_id.clone(),
        requested_labels: input.labels.clone(),
        acceptance_override: input.acceptance.clone(),
        requested_priority: input.priority,
    };

    // A durable exact retry must not depend on today's source state. The
    // store compares the immutable request digest and returns the original
    // operation before evaluating this placeholder child or live invariants.
    if store
        .operation(&context.operation_id)
        .map_err(|e| e.to_string())?
        .is_some()
    {
        let mut profile = match input.acceptance.as_deref() {
            Some("reviewed") => AcceptanceProfile::reviewed(),
            _ => AcceptanceProfile::focused(),
        };
        for gate in &mut profile.gates {
            gate.state = GateState::Open;
        }
        let mut retry_child =
            WorkItem::new(project, child_id, WorkKind::Task, None, input.title.trim()).open();
        retry_child.description = input.description.clone();
        retry_child.priority = input.priority.unwrap_or(0);
        retry_child.acceptance_profile = profile;
        return store
            .split_work_v1(context, &mutation, &retry_child)
            .map_err(|e| e.to_string());
    }
    let actor = ActorContext {
        actor_id: ActorId::parse(context.actor_id.clone()).map_err(|e| e.to_string())?,
        role: ActorRole::Operator,
    };
    let snapshot = crate::discover_work(
        store,
        &project,
        &actor,
        context.session_id.as_deref(),
        TimestampMs(input.as_of_ms),
    )?;
    if snapshot.revision.0 != context.expected_revision.unwrap() {
        return Err("project changed since work split was planned; refresh and retry".into());
    }
    let parent = snapshot
        .items
        .iter()
        .find(|item| item.work.id.as_str() == input.parent_work_id)
        .ok_or_else(|| "source task was not found in this project".to_owned())?;
    if parent.work.kind != WorkKind::Task
        || parent.work.lifecycle != boreal_domain::PersistedLifecycle::Open
    {
        return Err("work split requires an open task".into());
    }
    let mut profile = match input.acceptance.as_deref() {
        None => parent.work.acceptance_profile.clone(),
        Some("focused") => AcceptanceProfile::focused(),
        Some("reviewed") => AcceptanceProfile::reviewed(),
        Some(_) => return Err("acceptance must be focused or reviewed".into()),
    };
    // A profile definition may be copied; a parent's satisfied gate state is
    // evidence and must never become child evidence.
    for gate in &mut profile.gates {
        gate.state = GateState::Open;
    }
    let mut child = WorkItem::new(
        project,
        child_id,
        WorkKind::Task,
        parent.work.parent_id.clone(),
        input.title.trim(),
    )
    .open();
    child.description = input.description.clone();
    child.priority = input.priority.unwrap_or(parent.work.priority);
    child.dispatch_policy = parent.work.dispatch_policy;
    child.acceptance_profile = profile;

    store
        .split_work_v1(context, &mutation, &child)
        .map_err(|e| e.to_string())
}
