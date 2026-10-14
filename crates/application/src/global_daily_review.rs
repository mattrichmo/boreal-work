//! Shared classification policy for Global daily review.

use crate::GlobalCivilTimeContext;
use serde_json::{json, Value};
use std::collections::BTreeSet;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum DailyDeadline {
    Overdue,
    DueToday,
    Unscheduled,
    Later,
    Unknown,
}

impl DailyDeadline {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Overdue => "overdue",
            Self::DueToday => "due_today",
            Self::Unscheduled => "unscheduled",
            Self::Later => "later",
            Self::Unknown => "unknown",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct DailyClassification {
    pub deadline: DailyDeadline,
    pub waiting: bool,
    pub group: &'static str,
}

/// Classify an active management item using the read's resolved civil date.
/// Waiting is retained as an independent workflow dimension; the group keeps
/// urgent deadlines visible before placing remaining waiting work.
pub(crate) fn classify(
    due_at: Option<&str>,
    status_category: &str,
    time: &GlobalCivilTimeContext,
) -> DailyClassification {
    let deadline = match due_at {
        None => DailyDeadline::Unscheduled,
        Some(value) => match time.civil_day_for(value) {
            Some(day) if day < time.system_civil_date => DailyDeadline::Overdue,
            Some(day) if day == time.system_civil_date => DailyDeadline::DueToday,
            Some(_) => DailyDeadline::Later,
            None => DailyDeadline::Unknown,
        },
    };
    let waiting = status_category == "waiting";
    let group = match deadline {
        DailyDeadline::Overdue => "overdue",
        DailyDeadline::DueToday => "due_today",
        DailyDeadline::Unscheduled if waiting => "waiting",
        DailyDeadline::Unscheduled => "unscheduled",
        DailyDeadline::Later if waiting => "waiting",
        DailyDeadline::Later => "later",
        DailyDeadline::Unknown if waiting => "waiting",
        DailyDeadline::Unknown => "unknown",
    };
    DailyClassification {
        deadline,
        waiting,
        group,
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum DailyFilter {
    Today,
    Overdue,
    Waiting,
    Unscheduled,
    AllOpen,
}

impl DailyFilter {
    pub(crate) fn matches(self, classification: DailyClassification, is_open: bool) -> bool {
        if !is_open {
            return false;
        }
        match self {
            Self::Today => classification.deadline == DailyDeadline::DueToday,
            Self::Overdue => classification.deadline == DailyDeadline::Overdue,
            Self::Waiting => classification.waiting,
            Self::Unscheduled => classification.deadline == DailyDeadline::Unscheduled,
            Self::AllOpen => is_open,
        }
    }
}

fn filter_flags(classification: DailyClassification, is_open: bool) -> Value {
    json!({
        "today": DailyFilter::Today.matches(classification, is_open),
        "overdue": DailyFilter::Overdue.matches(classification, is_open),
        "waiting": DailyFilter::Waiting.matches(classification, is_open),
        "unscheduled": DailyFilter::Unscheduled.matches(classification, is_open),
        "all_open": DailyFilter::AllOpen.matches(classification, is_open),
    })
}

/// Add a compact presentation classification to the transient snapshot rows.
/// The persisted state is never modified by this read-side projection.
pub(crate) fn annotate_items(state: &mut Value, time: &GlobalCivilTimeContext) {
    let archived_projects = state
        .get("projects")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|project| project.get("archived").and_then(Value::as_bool) == Some(true))
        .filter_map(|project| project.get("id").and_then(Value::as_str).map(str::to_owned))
        .collect::<BTreeSet<_>>();
    let statuses = state
        .get("statuses")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let Some(items) = state.get_mut("items").and_then(Value::as_array_mut) else {
        return;
    };
    for item in items {
        let owner = item.get("project_id").and_then(Value::as_str);
        let status_id = item
            .get("status_id")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let category = statuses
            .iter()
            .find(|status| {
                status.get("project_id").and_then(Value::as_str) == owner
                    && status.get("status_id").and_then(Value::as_str) == Some(status_id)
            })
            .and_then(|status| status.get("category"))
            .and_then(Value::as_str)
            .unwrap_or("open");
        let classification = classify(item.get("due_at").and_then(Value::as_str), category, time);
        let is_open = item.get("archived").and_then(Value::as_bool) != Some(true)
            && !owner.is_some_and(|owner| archived_projects.contains(owner))
            && !matches!(category, "completed" | "cancelled");
        item["daily_classification"] = json!({
            "group": classification.group,
            "deadline": classification.deadline.as_str(),
            "waiting": classification.waiting,
            "filters": filter_flags(classification, is_open),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::{annotate_items, classify, DailyDeadline};
    use crate::GlobalCivilTimeContext;
    use serde_json::json;

    #[test]
    fn classification_keeps_deadline_urgency_and_waiting_separate() {
        let time = GlobalCivilTimeContext::system().unwrap();

        let overdue = classify(Some("1900-01-01"), "open", &time);
        assert_eq!(overdue.deadline, DailyDeadline::Overdue);
        assert_eq!(overdue.group, "overdue");
        assert!(!overdue.waiting);

        let due_today = classify(Some(&time.system_civil_date), "open", &time);
        assert_eq!(due_today.deadline, DailyDeadline::DueToday);
        assert_eq!(due_today.group, "due_today");

        let waiting = classify(None, "waiting", &time);
        assert_eq!(waiting.deadline, DailyDeadline::Unscheduled);
        assert_eq!(waiting.group, "waiting");
        assert!(waiting.waiting);

        let unscheduled = classify(None, "open", &time);
        assert_eq!(unscheduled.deadline, DailyDeadline::Unscheduled);
        assert_eq!(unscheduled.group, "unscheduled");

        let later = classify(Some("9999-12-31"), "open", &time);
        assert_eq!(later.deadline, DailyDeadline::Later);
        assert_eq!(later.group, "later");

        let waiting_overdue = classify(Some("1900-01-01"), "waiting", &time);
        assert_eq!(waiting_overdue.deadline, DailyDeadline::Overdue);
        assert_eq!(waiting_overdue.group, "overdue");
        assert!(waiting_overdue.waiting);
    }

    #[test]
    fn follow_up_does_not_become_a_due_date_and_filters_only_match_open_items() {
        let time = GlobalCivilTimeContext::system().unwrap();
        let today = time.system_civil_date.clone();
        let mut state = json!({
            "projects": [{"id":"archived-project","archived":true}],
            "statuses": [
                {"project_id":null,"status_id":"open","category":"open"},
                {"project_id":null,"status_id":"waiting","category":"waiting"},
                {"project_id":null,"status_id":"done","category":"completed"},
            ],
            "items": [
                {"id":"waiting-unscheduled","project_id":null,"status_id":"waiting","due_at":null,"follow_up_at":"1900-01-01","archived":false},
                {"id":"waiting-today","project_id":null,"status_id":"waiting","due_at":today,"follow_up_at":"1900-01-01","archived":false},
                {"id":"waiting-overdue","project_id":null,"status_id":"waiting","due_at":"1900-01-01","follow_up_at":"9999-12-31","archived":false},
                {"id":"completed-overdue","project_id":null,"status_id":"done","due_at":"1900-01-01","archived":false},
                {"id":"archived-today","project_id":null,"status_id":"open","due_at":today,"archived":true},
                {"id":"archived-project-item","project_id":"archived-project","status_id":"open","due_at":today,"archived":false},
            ]
        });

        annotate_items(&mut state, &time);

        let items = state["items"].as_array().unwrap();
        let classification = |id: &str| {
            items.iter().find(|item| item["id"] == id).unwrap()["daily_classification"].clone()
        };

        let unscheduled_waiting = classification("waiting-unscheduled");
        assert_eq!(unscheduled_waiting["deadline"], "unscheduled");
        assert_eq!(unscheduled_waiting["group"], "waiting");
        assert_eq!(unscheduled_waiting["filters"]["today"], false);
        assert_eq!(unscheduled_waiting["filters"]["overdue"], false);
        assert_eq!(unscheduled_waiting["filters"]["waiting"], true);
        assert_eq!(unscheduled_waiting["filters"]["unscheduled"], true);
        assert_eq!(unscheduled_waiting["filters"]["all_open"], true);

        let today_waiting = classification("waiting-today");
        assert_eq!(today_waiting["deadline"], "due_today");
        assert_eq!(today_waiting["group"], "due_today");
        assert_eq!(today_waiting["filters"]["today"], true);
        assert_eq!(today_waiting["filters"]["waiting"], true);
        assert_eq!(today_waiting["filters"]["unscheduled"], false);

        let overdue_waiting = classification("waiting-overdue");
        assert_eq!(overdue_waiting["group"], "overdue");
        assert_eq!(overdue_waiting["filters"]["overdue"], true);
        assert_eq!(overdue_waiting["filters"]["waiting"], true);

        for id in [
            "completed-overdue",
            "archived-today",
            "archived-project-item",
        ] {
            let filters = &classification(id)["filters"];
            for key in ["today", "overdue", "waiting", "unscheduled", "all_open"] {
                assert_eq!(filters[key], false, "{id} must not match {key}");
            }
        }
    }
}
