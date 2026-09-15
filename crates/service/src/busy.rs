use std::fmt;

/// A typed indication that a local service operation cannot be accepted yet.
///
/// Queue saturation and project ownership are intentionally represented by
/// one service-level type so transports can map either case to the same
/// application-level busy outcome without parsing an error string.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum BusyOutcome {
    /// The bounded writer queue has no available slot.
    WriterQueueFull {
        capacity: usize,
        depth: usize,
        retry_after_ms: u64,
    },
    /// The bounded read pool has no available admission slot.
    ReadPoolFull {
        capacity: usize,
        depth: usize,
        retry_after_ms: u64,
    },
    /// Another local service process currently owns this project.
    ProjectAlreadyOwned {
        project_id: String,
        owner_id: Option<String>,
    },
}

impl BusyOutcome {
    /// Whether retrying later can change the outcome without changing input.
    pub const fn retryable(&self) -> bool {
        true
    }

    /// Suggested delay for queue backpressure. Ownership contention has no
    /// reliable delay because it depends on the other process's lifetime.
    pub const fn retry_after_ms(&self) -> Option<u64> {
        match self {
            Self::WriterQueueFull { retry_after_ms, .. }
            | Self::ReadPoolFull { retry_after_ms, .. } => Some(*retry_after_ms),
            Self::ProjectAlreadyOwned { .. } => None,
        }
    }
}

impl fmt::Display for BusyOutcome {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::WriterQueueFull {
                capacity,
                depth,
                retry_after_ms,
            } => write!(
                formatter,
                "writer queue is full ({depth}/{capacity}); retry after {retry_after_ms} ms"
            ),
            Self::ReadPoolFull {
                capacity,
                depth,
                retry_after_ms,
            } => write!(
                formatter,
                "read pool is full ({depth}/{capacity}); retry after {retry_after_ms} ms"
            ),
            Self::ProjectAlreadyOwned {
                project_id,
                owner_id: Some(owner_id),
            } => write!(
                formatter,
                "project {project_id:?} is already owned by {owner_id:?}"
            ),
            Self::ProjectAlreadyOwned {
                project_id,
                owner_id: None,
            } => write!(formatter, "project {project_id:?} is already owned"),
        }
    }
}
