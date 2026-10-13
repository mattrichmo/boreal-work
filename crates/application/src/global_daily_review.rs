//! Shared classification policy for Global daily review.

use crate::GlobalCivilTimeContext;
use serde_json::{json, Value};

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
    pub(crate) fn matches(self, classification: DailyClassification) -> bool {
        match self {
            Self::Today => classification.deadline == DailyDeadline::DueToday,
            Self::Overdue => classification.deadline == DailyDeadline::Overdue,
            Self::Waiting => classification.waiting,
            Self::Unscheduled => classification.deadline == DailyDeadline::Unscheduled,
            Self::AllOpen => true,
        }
    }
}

fn filter_flags(classification: DailyClassification) -> Value {
    json!({
        "today": DailyFilter::Today.matches(classification),
        "overdue": DailyFilter::Overdue.matches(classification),
        "waiting": DailyFilter::Waiting.matches(classification),
        "unscheduled": DailyFilter::Unscheduled.matches(classification),
        "all_open": DailyFilter::AllOpen.matches(classification),
    })
}

/// Add a compact presentation classification to the transient snapshot rows.
/// The persisted state is never modified by this read-side projection.
pub(crate) fn annotate_items(state: &mut Value, time: &GlobalCivilTimeContext) {
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
        item["daily_classification"] = json!({
            "group": classification.group,
            "deadline": classification.deadline.as_str(),
            "waiting": classification.waiting,
            "filters": filter_flags(classification),
        });
    }
}
