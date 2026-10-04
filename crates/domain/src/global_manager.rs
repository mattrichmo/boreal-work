//! Pure types and invariants for installation-wide management records.
//!
//! This domain is intentionally independent of SQLite, JSON, filesystems and
//! terminal concerns. Global management status is separate from Boreal's
//! proof-gated execution lifecycle.

use std::fmt;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GlobalActivityEvent {
    pub operation_id: String,
    pub revision: u64,
    pub command: String,
    pub entity_kind: Option<String>,
    pub entity_id: Option<String>,
    pub project_id: Option<String>,
    pub source_id: Option<String>,
    pub target_id: Option<String>,
    pub title: Option<String>,
    pub summary: String,
    pub created_at: String,
}

/// A management note attached to one management item in the same project.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ManagementNoteLink {
    pub note_id: String,
    pub item_id: String,
    pub project_id: Option<String>,
}

impl ManagementNoteLink {
    pub fn validate(&self) -> Result<(), GlobalManagerDomainError> {
        validate_identifier(&self.note_id)?;
        validate_identifier(&self.item_id)?;
        if let Some(project_id) = self.project_id.as_deref() {
            validate_identifier(project_id)?;
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StatusCategory {
    Open,
    Active,
    Waiting,
    Blocked,
    Completed,
    Cancelled,
}

impl StatusCategory {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Active => "active",
            Self::Waiting => "waiting",
            Self::Blocked => "blocked",
            Self::Completed => "completed",
            Self::Cancelled => "cancelled",
        }
    }
}

impl TryFrom<&str> for StatusCategory {
    type Error = GlobalManagerDomainError;
    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "open" => Ok(Self::Open),
            "active" => Ok(Self::Active),
            "waiting" => Ok(Self::Waiting),
            "blocked" => Ok(Self::Blocked),
            "completed" => Ok(Self::Completed),
            "cancelled" => Ok(Self::Cancelled),
            _ => Err(GlobalManagerDomainError::InvalidCategory(value.to_owned())),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ManagementItemKind {
    Task,
    Subtask,
    Milestone,
}

impl ManagementItemKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Task => "task",
            Self::Subtask => "subtask",
            Self::Milestone => "milestone",
        }
    }
}

impl TryFrom<&str> for ManagementItemKind {
    type Error = GlobalManagerDomainError;
    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "task" | "todo" => Ok(Self::Task),
            "subtask" => Ok(Self::Subtask),
            "milestone" => Ok(Self::Milestone),
            _ => Err(GlobalManagerDomainError::InvalidItemKind(value.to_owned())),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkflowStatus {
    pub id: String,
    pub label: String,
    pub category: StatusCategory,
    pub position: i64,
}

impl WorkflowStatus {
    pub fn validate(&self) -> Result<(), GlobalManagerDomainError> {
        validate_identifier(&self.id)?;
        if self.label.trim().is_empty() {
            return Err(GlobalManagerDomainError::EmptyLabel);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ManagementItem {
    pub id: String,
    pub project_id: Option<String>,
    pub parent_id: Option<String>,
    pub kind: ManagementItemKind,
    pub title: String,
    pub description: String,
    pub status_id: String,
    pub priority: u8,
    pub due_at: Option<String>,
    /// Optional date for checking back on waiting work; it does not schedule a reminder.
    pub follow_up_at: Option<String>,
    pub archived: bool,
    pub position: i64,
}

impl ManagementItem {
    pub fn validate(&self) -> Result<(), GlobalManagerDomainError> {
        validate_identifier(&self.id)?;
        validate_identifier(&self.status_id)?;
        if let Some(id) = &self.project_id {
            validate_identifier(id)?;
        }
        if let Some(id) = &self.parent_id {
            validate_identifier(id)?;
        }
        if self.title.trim().is_empty() {
            return Err(GlobalManagerDomainError::EmptyTitle);
        }
        if self.kind == ManagementItemKind::Subtask && self.parent_id.is_none() {
            return Err(GlobalManagerDomainError::SubtaskNeedsParent);
        }
        Ok(())
    }
}

pub fn validate_item_parent(
    child: ManagementItemKind,
    parent: Option<ManagementItemKind>,
) -> Result<(), GlobalManagerDomainError> {
    let valid = matches!(
        (child, parent),
        (ManagementItemKind::Milestone, None)
            | (
                ManagementItemKind::Task,
                None | Some(ManagementItemKind::Milestone)
            )
            | (
                ManagementItemKind::Subtask,
                Some(ManagementItemKind::Task | ManagementItemKind::Subtask)
            )
    );
    if valid {
        Ok(())
    } else {
        Err(GlobalManagerDomainError::InvalidHierarchy)
    }
}

/// Rejects a dependency that would make a cycle in the supplied edge set.
/// Edges are `(prerequisite, dependent)`.
pub fn validate_dependency(
    prerequisite: &str,
    dependent: &str,
    edges: &[(String, String)],
) -> Result<(), GlobalManagerDomainError> {
    validate_identifier(prerequisite)?;
    validate_identifier(dependent)?;
    if prerequisite == dependent {
        return Err(GlobalManagerDomainError::DependencyCycle);
    }
    let mut adjacency: std::collections::BTreeMap<&str, Vec<&str>> =
        std::collections::BTreeMap::new();
    for (from, to) in edges {
        adjacency.entry(from).or_default().push(to);
    }
    let mut pending = vec![dependent];
    let mut seen = std::collections::BTreeSet::new();
    while let Some(node) = pending.pop() {
        if node == prerequisite {
            return Err(GlobalManagerDomainError::DependencyCycle);
        }
        if seen.insert(node) {
            pending.extend(adjacency.get(node).into_iter().flatten().copied());
        }
    }
    Ok(())
}

/// Validates an existing prerequisite → dependent graph in O(V + E).
pub fn validate_dependency_graph(
    edges: &[(String, String)],
) -> Result<(), GlobalManagerDomainError> {
    use std::collections::{BTreeMap, VecDeque};
    let mut adjacency: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    let mut indegree: BTreeMap<&str, usize> = BTreeMap::new();
    for (from, to) in edges {
        validate_identifier(from)?;
        validate_identifier(to)?;
        if from == to {
            return Err(GlobalManagerDomainError::DependencyCycle);
        }
        adjacency.entry(from).or_default().push(to);
        indegree.entry(from).or_default();
        *indegree.entry(to).or_default() += 1;
    }
    let mut ready = indegree
        .iter()
        .filter_map(|(node, degree)| (*degree == 0).then_some(*node))
        .collect::<VecDeque<_>>();
    let mut visited = 0usize;
    while let Some(node) = ready.pop_front() {
        visited += 1;
        for next in adjacency.get(node).into_iter().flatten() {
            let degree = indegree.get_mut(next).expect("edge endpoint was inserted");
            *degree -= 1;
            if *degree == 0 {
                ready.push_back(next);
            }
        }
    }
    if visited == indegree.len() {
        Ok(())
    } else {
        Err(GlobalManagerDomainError::DependencyCycle)
    }
}

pub fn validate_identifier(value: &str) -> Result<(), GlobalManagerDomainError> {
    if value.trim().is_empty() || value.len() > 255 || value.chars().any(char::is_control) {
        Err(GlobalManagerDomainError::InvalidIdentifier(
            value.to_owned(),
        ))
    } else {
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum GlobalManagerDomainError {
    InvalidIdentifier(String),
    InvalidCategory(String),
    InvalidItemKind(String),
    EmptyTitle,
    EmptyLabel,
    SubtaskNeedsParent,
    OnlySubtasksMayHaveParent,
    InvalidHierarchy,
    DependencyCycle,
}

impl fmt::Display for GlobalManagerDomainError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidIdentifier(v) => write!(f, "invalid global identifier: {v:?}"),
            Self::InvalidCategory(v) => write!(f, "unknown workflow category: {v}"),
            Self::InvalidItemKind(v) => write!(f, "unknown management item kind: {v}"),
            Self::EmptyTitle => f.write_str("item title is required"),
            Self::EmptyLabel => f.write_str("workflow status label is required"),
            Self::SubtaskNeedsParent => f.write_str("a subtask requires a parent item"),
            Self::OnlySubtasksMayHaveParent => f.write_str("only subtasks may have a parent"),
            Self::InvalidHierarchy => {
                f.write_str("invalid management item parent/child relationship")
            }
            Self::DependencyCycle => f.write_str("relationship would create a dependency cycle"),
        }
    }
}

impl std::error::Error for GlobalManagerDomainError {}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn dependency_validation_rejects_cycles() {
        let edges = vec![("a".into(), "b".into()), ("b".into(), "c".into())];
        assert!(validate_dependency("c", "a", &edges).is_err());
        assert!(validate_dependency("a", "d", &edges).is_ok());
    }
}
