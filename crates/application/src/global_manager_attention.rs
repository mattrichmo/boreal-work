//! Derived Global attention. It contains no persisted or linked execution
//! state; snapshots rebuild it from the canonical management records.

use crate::global_daily_review::{classify, DailyClassification, DailyDeadline};
use crate::GlobalCivilTimeContext;
use boreal_domain::global_manager::{
    management_prerequisite_state, prerequisite_to_dependent, ManagementPrerequisiteState,
    ManagementRelationshipKind, StatusCategory,
};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet};

const MAX_BLOCKED_CANDIDATES: usize = 5;
const MAX_BLOCKERS_PER_CANDIDATE: usize = 5;

#[derive(Clone, Copy, Debug, Default)]
struct Counts {
    open: u64,
    waiting: u64,
    overdue: u64,
    due_today: u64,
    unscheduled: u64,
    later: u64,
}

impl Counts {
    fn record(&mut self, classification: DailyClassification) {
        self.open += 1;
        if classification.waiting {
            self.waiting += 1;
        }
        match classification.deadline {
            DailyDeadline::Overdue => self.overdue += 1,
            DailyDeadline::DueToday => self.due_today += 1,
            DailyDeadline::Unscheduled => self.unscheduled += 1,
            DailyDeadline::Later => self.later += 1,
            DailyDeadline::Unknown => {}
        }
    }

    fn value(self) -> Value {
        json!({
            "open": self.open,
            "waiting": self.waiting,
            "overdue": self.overdue,
            "due_today": self.due_today,
            "unscheduled": self.unscheduled,
            "later": self.later,
        })
    }
}

pub(crate) fn attention_summary(
    state: &Value,
    selected_project_ids: &[String],
    time: &GlobalCivilTimeContext,
) -> Result<Value, String> {
    let archived_projects = rows(state, "projects")
        .iter()
        .filter(|project| project.get("archived").and_then(Value::as_bool) == Some(true))
        .filter_map(|project| project.get("id").and_then(Value::as_str).map(str::to_owned))
        .collect::<BTreeSet<_>>();
    let project_ids = rows(state, "projects")
        .iter()
        .filter_map(|project| project.get("id").and_then(Value::as_str).map(str::to_owned))
        .collect::<Vec<_>>();
    let projects_total = project_ids.len() as u64;
    let included = selected_project_ids
        .iter()
        .filter(|id| project_ids.contains(id))
        .cloned()
        .collect::<BTreeSet<_>>();
    let mut project_counts = included
        .iter()
        .map(|id| (id.clone(), Counts::default()))
        .collect::<BTreeMap<_, _>>();
    let mut portfolio = Counts::default();
    let mut personal = Counts::default();

    for item in rows(state, "items") {
        if item.get("archived").and_then(Value::as_bool) == Some(true) {
            continue;
        }
        let category = item_category(state, item);
        if matches!(
            category,
            Some(StatusCategory::Completed | StatusCategory::Cancelled)
        ) {
            continue;
        }
        let classification = classify(
            item.get("due_at").and_then(Value::as_str),
            category.map_or("open", StatusCategory::as_str),
            time,
        );
        let owner = item.get("project_id").and_then(Value::as_str);
        if owner.is_some_and(|id| archived_projects.contains(id)) {
            continue;
        }
        portfolio.record(classification);
        if let Some(owner) = owner {
            if let Some(counts) = project_counts.get_mut(owner) {
                counts.record(classification);
            }
        } else {
            personal.record(classification);
        }
    }

    let mut project_summaries = project_counts
        .into_iter()
        .map(|(id, counts)| (id, empty_attention(counts)))
        .collect::<Map<_, _>>();
    for (project_id, summary) in project_summaries.iter_mut() {
        if archived_projects.contains(project_id) {
            continue;
        }
        populate_attention_details(state, Some(project_id), summary, time)?;
    }
    let mut personal_summary = empty_attention(personal);
    populate_attention_details(state, None, &mut personal_summary, time)?;

    let projects_sampled = included.len() as u64;
    let projects_truncated = projects_sampled < projects_total;
    Ok(json!({
        "portfolio": portfolio.value(),
        "projects": project_summaries,
        "projects_total": projects_total,
        "projects_limit": projects_sampled,
        "projects_has_more": projects_truncated,
        "projects_truncated": projects_truncated,
        "personal": personal_summary
    }))
}

fn empty_attention(counts: Counts) -> Value {
    let mut result = counts.value();
    result["next_action"] = Value::Null;
    result["next_milestone"] = Value::Null;
    result["blocked_by"] = json!([]);
    result["next_action_unavailable_reason"] = Value::Null;
    result
}

fn populate_attention_details(
    state: &Value,
    project_id: Option<&str>,
    summary: &mut Value,
    time: &GlobalCivilTimeContext,
) -> Result<(), String> {
    let owns = |item: &Value| match project_id {
        Some(project_id) => item.get("project_id").and_then(Value::as_str) == Some(project_id),
        None => item.get("project_id").is_some_and(Value::is_null),
    };
    let mut candidates = rows(state, "items")
        .iter()
        .filter(|item| {
            owns(item)
                && item.get("archived").and_then(Value::as_bool) != Some(true)
                && matches!(
                    item_category(state, item),
                    Some(StatusCategory::Open | StatusCategory::Active)
                )
                && matches!(
                    item.get("kind").and_then(Value::as_str),
                    Some("task" | "subtask")
                )
        })
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| action_order(left, right, state, time));

    let item_by_id = rows(state, "items")
        .iter()
        .filter_map(|item| Some((item.get("id")?.as_str()?.to_owned(), item)))
        .collect::<BTreeMap<_, _>>();
    let mut prerequisites: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for relationship in rows(state, "relationships") {
        let source = relationship
            .get("source_id")
            .and_then(Value::as_str)
            .ok_or_else(|| "management relationship source is missing".to_owned())?;
        let target = relationship
            .get("target_id")
            .and_then(Value::as_str)
            .ok_or_else(|| "management relationship target is missing".to_owned())?;
        let raw_kind = relationship
            .get("kind")
            .and_then(Value::as_str)
            .ok_or_else(|| "management relationship kind is missing".to_owned())?;
        let kind =
            ManagementRelationshipKind::try_from(raw_kind).map_err(|error| error.to_string())?;
        if let Some((prerequisite, dependent)) = prerequisite_to_dependent(source, target, kind) {
            prerequisites
                .entry(dependent)
                .or_default()
                .insert(prerequisite);
        }
    }

    let mut blocked_candidates = Vec::new();
    for candidate in &candidates {
        let item_id = candidate
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let blocking = prerequisites
            .get(item_id)
            .into_iter()
            .flatten()
            .filter_map(|prerequisite_id| {
                let prerequisite = item_by_id.get(prerequisite_id);
                let category = prerequisite.and_then(|item| item_category(state, item));
                let archived = prerequisite
                    .and_then(|item| item.get("archived"))
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                let readiness = management_prerequisite_state(category, archived);
                if readiness == ManagementPrerequisiteState::Satisfied {
                    return None;
                }
                let prerequisite_title = prerequisite
                    .and_then(|item| item.get("title"))
                    .and_then(Value::as_str)
                    .map(|title| bound_text(title, 160))
                    .unwrap_or_else(|| "Missing prerequisite".into());
                let status = prerequisite
                    .and_then(|item| item.get("status_id"))
                    .and_then(Value::as_str)
                    .unwrap_or("unresolved");
                Some(json!({
                    "item_id": prerequisite_id,
                    "title": prerequisite_title,
                    "status_id": bound_text(status, 80),
                    "reason_code": prerequisite_reason_code(readiness),
                    "reason": prerequisite_reason(readiness, status),
                }))
            })
            .take(MAX_BLOCKERS_PER_CANDIDATE)
            .collect::<Vec<_>>();
        if blocking.is_empty() {
            let status_id = candidate
                .get("status_id")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let label = rows(state, "statuses")
                .iter()
                .find(|status| {
                    status.get("project_id").and_then(Value::as_str) == project_id
                        && status.get("status_id").and_then(Value::as_str) == Some(status_id)
                })
                .and_then(|status| status.get("label"))
                .and_then(Value::as_str)
                .unwrap_or(status_id);
            summary["next_action"] = json!({
                "item_id": candidate.get("id"),
                "title": bound_text(candidate.get("title").and_then(Value::as_str).unwrap_or_default(), 160),
                "due_at": candidate.get("due_at").cloned().unwrap_or(Value::Null),
                "priority": candidate.get("priority").cloned().unwrap_or(Value::Null),
                "status_id": status_id,
                "status_label": bound_text(label, 160),
                "kind": candidate.get("kind"),
            });
            break;
        }
        if blocked_candidates.len() < MAX_BLOCKED_CANDIDATES {
            blocked_candidates.push(json!({
                "item_id": item_id,
                "title": bound_text(candidate.get("title").and_then(Value::as_str).unwrap_or_default(), 160),
                "prerequisites": blocking,
            }));
        }
    }
    if summary.get("next_action").is_some_and(Value::is_null) {
        let unavailable_reason = if blocked_candidates.is_empty() {
            "no_open_action".to_owned()
        } else {
            "unresolved_prerequisites".to_owned()
        };
        summary["blocked_by"] = json!(blocked_candidates);
        summary["next_action_unavailable_reason"] = json!(unavailable_reason);
    }

    let mut milestones = rows(state, "items")
        .iter()
        .filter(|item| {
            owns(item)
                && item.get("kind").and_then(Value::as_str) == Some("milestone")
                && item.get("archived").and_then(Value::as_bool) != Some(true)
                && !matches!(
                    item_category(state, item),
                    Some(StatusCategory::Completed | StatusCategory::Cancelled)
                )
        })
        .collect::<Vec<_>>();
    milestones.sort_by(|left, right| action_order(left, right, state, time));
    if let Some(milestone) = milestones.first() {
        let children = rows(state, "items")
            .iter()
            .filter(|child| child.get("parent_id") == milestone.get("id") && owns(child))
            .collect::<Vec<_>>();
        let completed = children
            .iter()
            .filter(|child| item_category(state, child) == Some(StatusCategory::Completed))
            .count();
        summary["next_milestone"] = json!({
            "item_id": milestone.get("id"),
            "title": bound_text(milestone.get("title").and_then(Value::as_str).unwrap_or_default(), 160),
            "due_at": milestone.get("due_at").cloned().unwrap_or(Value::Null),
            "completed_children": completed,
            "total_children": children.len(),
        });
    }
    Ok(())
}

fn action_order(
    left: &Value,
    right: &Value,
    state: &Value,
    time: &GlobalCivilTimeContext,
) -> std::cmp::Ordering {
    let due_rank = |item: &Value| {
        let category = item_category(state, item).map_or("open", StatusCategory::as_str);
        let classification = classify(item.get("due_at").and_then(Value::as_str), category, time);
        match classification.deadline {
            DailyDeadline::Overdue => 0,
            DailyDeadline::DueToday => 1,
            DailyDeadline::Later => 2,
            DailyDeadline::Unscheduled => 3,
            DailyDeadline::Unknown => 4,
        }
    };
    due_rank(left)
        .cmp(&due_rank(right))
        .then_with(|| {
            right
                .get("priority")
                .and_then(Value::as_u64)
                .unwrap_or(0)
                .cmp(&left.get("priority").and_then(Value::as_u64).unwrap_or(0))
        })
        .then_with(|| {
            left.get("position")
                .and_then(Value::as_i64)
                .unwrap_or(0)
                .cmp(&right.get("position").and_then(Value::as_i64).unwrap_or(0))
        })
        .then_with(|| {
            left.get("id")
                .and_then(Value::as_str)
                .cmp(&right.get("id").and_then(Value::as_str))
        })
}

fn item_category(state: &Value, item: &Value) -> Option<StatusCategory> {
    let owner = item.get("project_id").and_then(Value::as_str);
    let status_id = item.get("status_id").and_then(Value::as_str)?;
    rows(state, "statuses")
        .iter()
        .find(|status| {
            status.get("project_id").and_then(Value::as_str) == owner
                && status.get("status_id").and_then(Value::as_str) == Some(status_id)
        })
        .and_then(|status| status.get("category"))
        .and_then(Value::as_str)
        .and_then(|category| StatusCategory::try_from(category).ok())
}

fn prerequisite_reason_code(readiness: ManagementPrerequisiteState) -> &'static str {
    match readiness {
        ManagementPrerequisiteState::Satisfied => "completed",
        ManagementPrerequisiteState::Incomplete => "not_completed",
        ManagementPrerequisiteState::ArchivedIncomplete => "archived_incomplete",
        ManagementPrerequisiteState::Cancelled => "cancelled",
        ManagementPrerequisiteState::Missing => "missing",
    }
}

fn prerequisite_reason(readiness: ManagementPrerequisiteState, status: &str) -> String {
    let reason = match readiness {
        ManagementPrerequisiteState::Satisfied => "completed",
        ManagementPrerequisiteState::Incomplete => "not completed",
        ManagementPrerequisiteState::ArchivedIncomplete => "archived before completion",
        ManagementPrerequisiteState::Cancelled => "cancelled; completion is still required",
        ManagementPrerequisiteState::Missing => "missing or unresolved",
    };
    bound_text(&format!("{reason} (status {status})"), 160)
}

fn rows<'a>(state: &'a Value, key: &str) -> &'a [Value] {
    state
        .get(key)
        .and_then(Value::as_array)
        .map_or(&[], Vec::as_slice)
}

fn bound_text(value: &str, maximum_bytes: usize) -> String {
    if value.len() <= maximum_bytes {
        return value.to_owned();
    }
    let mut end = maximum_bytes.saturating_sub(3);
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", &value[..end])
}
