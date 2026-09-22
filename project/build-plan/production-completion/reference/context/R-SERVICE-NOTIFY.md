# R-SERVICE-NOTIFY — crates/service/src/notifications.rs

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `crates/service/src/notifications.rs:L1–L289`  
**File SHA-256:** `ba0a22e21bb7469abf4e806361222032964fc7cd6a0b534a1dc89ae63ecfcba0`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Post-commit notifications and cursor gap handling; notifications cannot be acceptance authority.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,289p' 'crates/service/src/notifications.rs'
```

## Exact baseline excerpt

````text
    1 | use std::collections::{BTreeSet, VecDeque};
    2 | use std::fmt;
    3 | use std::sync::{Arc, Mutex};
    4 | 
    5 | /// A monotonic cursor into the committed revision stream.
    6 | #[derive(Clone, Copy, Debug, Default, Eq, Ord, PartialEq, PartialOrd)]
    7 | pub struct RevisionCursor(u64);
    8 | 
    9 | impl RevisionCursor {
   10 |     pub const fn new(revision: u64) -> Self {
   11 |         Self(revision)
   12 |     }
   13 | 
   14 |     pub const fn revision(self) -> u64 {
   15 |         self.0
   16 |     }
   17 | }
   18 | 
   19 | /// One compact post-commit revision notification.
   20 | #[derive(Clone, Debug, Eq, PartialEq)]
   21 | pub struct RevisionNotification {
   22 |     revision: u64,
   23 |     affected_subjects: Vec<String>,
   24 | }
   25 | 
   26 | impl RevisionNotification {
   27 |     pub fn revision(&self) -> u64 {
   28 |         self.revision
   29 |     }
   30 | 
   31 |     pub fn cursor(&self) -> RevisionCursor {
   32 |         RevisionCursor::new(self.revision)
   33 |     }
   34 | 
   35 |     pub fn affected_subjects(&self) -> &[String] {
   36 |         &self.affected_subjects
   37 |     }
   38 | }
   39 | 
   40 | #[derive(Clone, Debug, Eq, PartialEq)]
   41 | pub enum NotificationError {
   42 |     ZeroCapacity,
   43 |     RevisionWentBackwards { previous: u64, next: u64 },
   44 | }
   45 | 
   46 | impl fmt::Display for NotificationError {
   47 |     fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
   48 |         match self {
   49 |             Self::ZeroCapacity => formatter.write_str("notification capacity must be positive"),
   50 |             Self::RevisionWentBackwards { previous, next } => {
   51 |                 write!(
   52 |                     formatter,
   53 |                     "revision moved backwards from {previous} to {next}"
   54 |                 )
   55 |             }
   56 |         }
   57 |     }
   58 | }
   59 | 
   60 | impl std::error::Error for NotificationError {}
   61 | 
   62 | #[derive(Clone, Debug, Eq, PartialEq)]
   63 | pub struct Replay {
   64 |     pub cursor: RevisionCursor,
   65 |     pub latest_revision: u64,
   66 |     pub notifications: Vec<RevisionNotification>,
   67 |     pub resnapshot: bool,
   68 | }
   69 | 
   70 | #[derive(Clone, Debug, Eq, PartialEq)]
   71 | pub enum SubscriptionUpdate {
   72 |     Notification(RevisionNotification),
   73 |     ResnapshotRequired {
   74 |         latest_revision: u64,
   75 |         cursor: RevisionCursor,
   76 |     },
   77 |     Empty,
   78 | }
   79 | 
   80 | #[derive(Debug)]
   81 | struct NotificationState {
   82 |     latest_revision: u64,
   83 |     entries: VecDeque<RevisionNotification>,
   84 | }
   85 | 
   86 | /// A bounded post-commit notification log.
   87 | #[derive(Clone, Debug)]
   88 | pub struct NotificationHub {
   89 |     capacity: usize,
   90 |     state: Arc<Mutex<NotificationState>>,
   91 | }
   92 | 
   93 | impl NotificationHub {
   94 |     pub fn new(capacity: usize) -> Result<Self, NotificationError> {
   95 |         if capacity == 0 {
   96 |             return Err(NotificationError::ZeroCapacity);
   97 |         }
   98 |         Ok(Self {
   99 |             capacity,
  100 |             state: Arc::new(Mutex::new(NotificationState {
  101 |                 latest_revision: 0,
  102 |                 entries: VecDeque::with_capacity(capacity),
  103 |             })),
  104 |         })
  105 |     }
  106 | 
  107 |     pub fn capacity(&self) -> usize {
  108 |         self.capacity
  109 |     }
  110 | 
  111 |     pub fn latest_cursor(&self) -> RevisionCursor {
  112 |         RevisionCursor::new(
  113 |             self.state
  114 |                 .lock()
  115 |                 .expect("notification mutex poisoned")
  116 |                 .latest_revision,
  117 |         )
  118 |     }
  119 | 
  120 |     /// Publish after the writer transaction commits. Repeated publication of
  121 |     /// one revision is coalesced and affected subjects are unioned.
  122 |     pub fn publish<I, S>(&self, revision: u64, subjects: I) -> Result<(), NotificationError>
  123 |     where
  124 |         I: IntoIterator<Item = S>,
  125 |         S: Into<String>,
  126 |     {
  127 |         let mut state = self.state.lock().expect("notification mutex poisoned");
  128 |         if revision < state.latest_revision {
  129 |             return Err(NotificationError::RevisionWentBackwards {
  130 |                 previous: state.latest_revision,
  131 |                 next: revision,
  132 |             });
  133 |         }
  134 |         let subjects = deduplicate_subjects(subjects);
  135 |         if revision == state.latest_revision {
  136 |             if let Some(last) = state.entries.back_mut() {
  137 |                 let mut merged = last
  138 |                     .affected_subjects
  139 |                     .iter()
  140 |                     .cloned()
  141 |                     .collect::<BTreeSet<_>>();
  142 |                 merged.extend(subjects);
  143 |                 last.affected_subjects = merged.into_iter().collect();
  144 |             }
  145 |             return Ok(());
  146 |         }
  147 |         state.latest_revision = revision;
  148 |         state.entries.push_back(RevisionNotification {
  149 |             revision,
  150 |             affected_subjects: subjects,
  151 |         });
  152 |         while state.entries.len() > self.capacity {
  153 |             state.entries.pop_front();
  154 |         }
  155 |         Ok(())
  156 |     }
  157 | 
  158 |     pub fn replay(&self, cursor: RevisionCursor) -> Replay {
  159 |         let state = self.state.lock().expect("notification mutex poisoned");
  160 |         let latest = RevisionCursor::new(state.latest_revision);
  161 |         let oldest = state
  162 |             .entries
  163 |             .front()
  164 |             .map_or(latest, RevisionNotification::cursor);
  165 |         let resnapshot = cursor.revision().saturating_add(1) < oldest.revision();
  166 |         let notifications = if resnapshot {
  167 |             Vec::new()
  168 |         } else {
  169 |             state
  170 |                 .entries
  171 |                 .iter()
  172 |                 .filter(|entry| entry.revision() > cursor.revision())
  173 |                 .cloned()
  174 |                 .collect()
  175 |         };
  176 |         Replay {
  177 |             cursor: if resnapshot { latest } else { cursor },
  178 |             latest_revision: state.latest_revision,
  179 |             notifications,
  180 |             resnapshot,
  181 |         }
  182 |     }
  183 | 
  184 |     pub fn subscribe(&self, cursor: RevisionCursor) -> Subscription {
  185 |         Subscription {
  186 |             hub: self.clone(),
  187 |             cursor,
  188 |         }
  189 |     }
  190 | }
  191 | 
  192 | /// A reconnectable subscriber. A resnapshot update advances the cursor to the
  193 | /// latest known revision so one refresh is sufficient and cannot loop.
  194 | #[derive(Clone, Debug)]
  195 | pub struct Subscription {
  196 |     hub: NotificationHub,
  197 |     cursor: RevisionCursor,
  198 | }
  199 | 
  200 | impl Subscription {
  201 |     pub const fn cursor(&self) -> RevisionCursor {
  202 |         self.cursor
  203 |     }
  204 | 
  205 |     pub fn poll(&mut self) -> SubscriptionUpdate {
  206 |         let replay = self.hub.replay(self.cursor);
  207 |         if replay.resnapshot {
  208 |             self.cursor = replay.cursor;
  209 |             return SubscriptionUpdate::ResnapshotRequired {
  210 |                 latest_revision: replay.latest_revision,
  211 |                 cursor: self.cursor,
  212 |             };
  213 |         }
  214 |         let Some(notification) = replay.notifications.into_iter().next() else {
  215 |             return SubscriptionUpdate::Empty;
  216 |         };
  217 |         self.cursor = notification.cursor();
  218 |         SubscriptionUpdate::Notification(notification)
  219 |     }
  220 | }
  221 | 
  222 | fn deduplicate_subjects<I, S>(subjects: I) -> Vec<String>
  223 | where
  224 |     I: IntoIterator<Item = S>,
  225 |     S: Into<String>,
  226 | {
  227 |     subjects
  228 |         .into_iter()
  229 |         .map(Into::into)
  230 |         .collect::<BTreeSet<_>>()
  231 |         .into_iter()
  232 |         .collect()
  233 | }
  234 | 
  235 | #[cfg(test)]
  236 | mod tests {
  237 |     use super::*;
  238 | 
  239 |     #[test]
  240 |     fn duplicate_revision_notifications_are_coalesced() {
  241 |         let hub = NotificationHub::new(3).unwrap();
  242 |         hub.publish(1, ["work-2", "work-1", "work-2"]).unwrap();
  243 |         hub.publish(1, ["attempt-1", "work-1"]).unwrap();
  244 |         let replay = hub.replay(RevisionCursor::default());
  245 |         assert!(!replay.resnapshot);
  246 |         assert_eq!(replay.notifications.len(), 1);
  247 |         assert_eq!(
  248 |             replay.notifications[0].affected_subjects(),
  249 |             &[
  250 |                 "attempt-1".to_owned(),
  251 |                 "work-1".to_owned(),
  252 |                 "work-2".to_owned()
  253 |             ]
  254 |         );
  255 |     }
  256 | 
  257 |     #[test]
  258 |     fn an_old_cursor_requests_one_resnapshot_and_then_stays_current() {
  259 |         let hub = NotificationHub::new(2).unwrap();
  260 |         hub.publish(1, ["one"]).unwrap();
  261 |         hub.publish(2, ["two"]).unwrap();
  262 |         hub.publish(3, ["three"]).unwrap();
  263 |         let mut subscription = hub.subscribe(RevisionCursor::new(1));
  264 |         assert_eq!(
  265 |             subscription.poll(),
  266 |             SubscriptionUpdate::Notification(RevisionNotification {
  267 |                 revision: 2,
  268 |                 affected_subjects: vec!["two".to_owned()]
  269 |             })
  270 |         );
  271 |         assert_eq!(
  272 |             subscription.poll(),
  273 |             SubscriptionUpdate::Notification(RevisionNotification {
  274 |                 revision: 3,
  275 |                 affected_subjects: vec!["three".to_owned()]
  276 |             })
  277 |         );
  278 | 
  279 |         let mut missed = hub.subscribe(RevisionCursor::new(0));
  280 |         assert_eq!(
  281 |             missed.poll(),
  282 |             SubscriptionUpdate::ResnapshotRequired {
  283 |                 latest_revision: 3,
  284 |                 cursor: RevisionCursor::new(3)
  285 |             }
  286 |         );
  287 |         assert_eq!(missed.poll(), SubscriptionUpdate::Empty);
  288 |     }
  289 | }
````
