use std::collections::{BTreeSet, VecDeque};
use std::fmt;
use std::sync::{Arc, Mutex};

/// A monotonic cursor into the committed revision stream.
#[derive(Clone, Copy, Debug, Default, Eq, Ord, PartialEq, PartialOrd)]
pub struct RevisionCursor(u64);

impl RevisionCursor {
    pub const fn new(revision: u64) -> Self {
        Self(revision)
    }

    pub const fn revision(self) -> u64 {
        self.0
    }
}

/// One compact post-commit revision notification.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RevisionNotification {
    revision: u64,
    affected_subjects: Vec<String>,
}

impl RevisionNotification {
    pub fn revision(&self) -> u64 {
        self.revision
    }

    pub fn cursor(&self) -> RevisionCursor {
        RevisionCursor::new(self.revision)
    }

    pub fn affected_subjects(&self) -> &[String] {
        &self.affected_subjects
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum NotificationError {
    ZeroCapacity,
    RevisionWentBackwards { previous: u64, next: u64 },
}

impl fmt::Display for NotificationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ZeroCapacity => formatter.write_str("notification capacity must be positive"),
            Self::RevisionWentBackwards { previous, next } => {
                write!(
                    formatter,
                    "revision moved backwards from {previous} to {next}"
                )
            }
        }
    }
}

impl std::error::Error for NotificationError {}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Replay {
    pub cursor: RevisionCursor,
    pub latest_revision: u64,
    pub notifications: Vec<RevisionNotification>,
    pub resnapshot: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SubscriptionUpdate {
    Notification(RevisionNotification),
    ResnapshotRequired {
        latest_revision: u64,
        cursor: RevisionCursor,
    },
    Empty,
}

#[derive(Debug)]
struct NotificationState {
    latest_revision: u64,
    entries: VecDeque<RevisionNotification>,
}

/// A bounded post-commit notification log.
#[derive(Clone, Debug)]
pub struct NotificationHub {
    capacity: usize,
    state: Arc<Mutex<NotificationState>>,
}

impl NotificationHub {
    pub fn new(capacity: usize) -> Result<Self, NotificationError> {
        if capacity == 0 {
            return Err(NotificationError::ZeroCapacity);
        }
        Ok(Self {
            capacity,
            state: Arc::new(Mutex::new(NotificationState {
                latest_revision: 0,
                entries: VecDeque::with_capacity(capacity),
            })),
        })
    }

    pub fn capacity(&self) -> usize {
        self.capacity
    }

    pub fn latest_cursor(&self) -> RevisionCursor {
        RevisionCursor::new(
            self.state
                .lock()
                .expect("notification mutex poisoned")
                .latest_revision,
        )
    }

    /// Publish after the writer transaction commits. Repeated publication of
    /// one revision is coalesced and affected subjects are unioned.
    pub fn publish<I, S>(&self, revision: u64, subjects: I) -> Result<(), NotificationError>
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        let mut state = self.state.lock().expect("notification mutex poisoned");
        if revision < state.latest_revision {
            return Err(NotificationError::RevisionWentBackwards {
                previous: state.latest_revision,
                next: revision,
            });
        }
        let subjects = deduplicate_subjects(subjects);
        if revision == state.latest_revision {
            if let Some(last) = state.entries.back_mut() {
                let mut merged = last
                    .affected_subjects
                    .iter()
                    .cloned()
                    .collect::<BTreeSet<_>>();
                merged.extend(subjects);
                last.affected_subjects = merged.into_iter().collect();
            }
            return Ok(());
        }
        state.latest_revision = revision;
        state.entries.push_back(RevisionNotification {
            revision,
            affected_subjects: subjects,
        });
        while state.entries.len() > self.capacity {
            state.entries.pop_front();
        }
        Ok(())
    }

    pub fn replay(&self, cursor: RevisionCursor) -> Replay {
        let state = self.state.lock().expect("notification mutex poisoned");
        let latest = RevisionCursor::new(state.latest_revision);
        let oldest = state
            .entries
            .front()
            .map_or(latest, RevisionNotification::cursor);
        let resnapshot = cursor.revision().saturating_add(1) < oldest.revision();
        let notifications = if resnapshot {
            Vec::new()
        } else {
            state
                .entries
                .iter()
                .filter(|entry| entry.revision() > cursor.revision())
                .cloned()
                .collect()
        };
        Replay {
            cursor: if resnapshot { latest } else { cursor },
            latest_revision: state.latest_revision,
            notifications,
            resnapshot,
        }
    }

    pub fn subscribe(&self, cursor: RevisionCursor) -> Subscription {
        Subscription {
            hub: self.clone(),
            cursor,
        }
    }
}

/// A reconnectable subscriber. A resnapshot update advances the cursor to the
/// latest known revision so one refresh is sufficient and cannot loop.
#[derive(Clone, Debug)]
pub struct Subscription {
    hub: NotificationHub,
    cursor: RevisionCursor,
}

impl Subscription {
    pub const fn cursor(&self) -> RevisionCursor {
        self.cursor
    }

    pub fn poll(&mut self) -> SubscriptionUpdate {
        let replay = self.hub.replay(self.cursor);
        if replay.resnapshot {
            self.cursor = replay.cursor;
            return SubscriptionUpdate::ResnapshotRequired {
                latest_revision: replay.latest_revision,
                cursor: self.cursor,
            };
        }
        let Some(notification) = replay.notifications.into_iter().next() else {
            return SubscriptionUpdate::Empty;
        };
        self.cursor = notification.cursor();
        SubscriptionUpdate::Notification(notification)
    }
}

fn deduplicate_subjects<I, S>(subjects: I) -> Vec<String>
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
{
    subjects
        .into_iter()
        .map(Into::into)
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn duplicate_revision_notifications_are_coalesced() {
        let hub = NotificationHub::new(3).unwrap();
        hub.publish(1, ["work-2", "work-1", "work-2"]).unwrap();
        hub.publish(1, ["attempt-1", "work-1"]).unwrap();
        let replay = hub.replay(RevisionCursor::default());
        assert!(!replay.resnapshot);
        assert_eq!(replay.notifications.len(), 1);
        assert_eq!(
            replay.notifications[0].affected_subjects(),
            &[
                "attempt-1".to_owned(),
                "work-1".to_owned(),
                "work-2".to_owned()
            ]
        );
    }

    #[test]
    fn an_old_cursor_requests_one_resnapshot_and_then_stays_current() {
        let hub = NotificationHub::new(2).unwrap();
        hub.publish(1, ["one"]).unwrap();
        hub.publish(2, ["two"]).unwrap();
        hub.publish(3, ["three"]).unwrap();
        let mut subscription = hub.subscribe(RevisionCursor::new(1));
        assert_eq!(
            subscription.poll(),
            SubscriptionUpdate::Notification(RevisionNotification {
                revision: 2,
                affected_subjects: vec!["two".to_owned()]
            })
        );
        assert_eq!(
            subscription.poll(),
            SubscriptionUpdate::Notification(RevisionNotification {
                revision: 3,
                affected_subjects: vec!["three".to_owned()]
            })
        );

        let mut missed = hub.subscribe(RevisionCursor::new(0));
        assert_eq!(
            missed.poll(),
            SubscriptionUpdate::ResnapshotRequired {
                latest_revision: 3,
                cursor: RevisionCursor::new(3)
            }
        );
        assert_eq!(missed.poll(), SubscriptionUpdate::Empty);
    }
}
