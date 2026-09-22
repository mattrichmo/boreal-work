# R-SERVICE-QUEUE — crates/service/src/priority_queue.rs

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `crates/service/src/priority_queue.rs:L1–L276`  
**File SHA-256:** `61564d8940116c9c90dba2d231b386aa6d750ea02b20c964143e61250521102f`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Priority/write queue fairness and bounded execution; measure queue wait separately from transaction hold.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,276p' 'crates/service/src/priority_queue.rs'
```

## Exact baseline excerpt

````text
    1 | use crate::{BusyOutcome, EnqueueError};
    2 | use std::collections::VecDeque;
    3 | use std::fmt;
    4 | use std::sync::{Condvar, Mutex};
    5 | use std::time::{Duration, Instant};
    6 | 
    7 | /// Dispatch class used by the local service host.
    8 | ///
    9 | /// Control traffic is allowed to pass queued application work, but a bounded
   10 | /// burst prevents a continuously busy control plane from starving ordinary
   11 | /// work forever.
   12 | #[derive(Clone, Copy, Debug, Eq, PartialEq)]
   13 | pub enum QueuePriority {
   14 |     Control,
   15 |     Normal,
   16 | }
   17 | 
   18 | /// A queued item with its admission ticket and priority.
   19 | #[derive(Debug)]
   20 | pub struct PrioritizedItem<T> {
   21 |     ticket: u64,
   22 |     item: T,
   23 |     enqueued_at: Instant,
   24 | }
   25 | 
   26 | impl<T> PrioritizedItem<T> {
   27 |     pub fn ticket(&self) -> u64 {
   28 |         self.ticket
   29 |     }
   30 | 
   31 |     pub fn into_inner(self) -> T {
   32 |         self.item
   33 |     }
   34 | 
   35 |     pub fn wait_duration(&self) -> Duration {
   36 |         self.enqueued_at.elapsed()
   37 |     }
   38 | }
   39 | 
   40 | #[derive(Debug)]
   41 | struct State<T> {
   42 |     next_ticket: u64,
   43 |     control: VecDeque<PrioritizedItem<T>>,
   44 |     normal: VecDeque<PrioritizedItem<T>>,
   45 |     consecutive_control: usize,
   46 |     closed: bool,
   47 | }
   48 | 
   49 | /// A bounded queue with a control-plane lane.
   50 | ///
   51 | /// Admission remains non-blocking and total depth is bounded by `capacity`.
   52 | /// Workers prefer control items, subject to [`MAX_CONTROL_BURST`], then return
   53 | /// to the normal FIFO lane. This keeps heartbeat/stop/readback/status work
   54 | /// responsive while preserving eventual progress for queued mutations.
   55 | pub struct PriorityQueue<T> {
   56 |     capacity: usize,
   57 |     control_reserve: usize,
   58 |     state: Mutex<State<T>>,
   59 |     available: Condvar,
   60 | }
   61 | 
   62 | pub const MAX_CONTROL_BURST: usize = 8;
   63 | pub const DEFAULT_CONTROL_RESERVE: usize = 1;
   64 | 
   65 | impl<T> PriorityQueue<T> {
   66 |     pub fn with_capacity(capacity: usize) -> Result<Self, crate::QueueConfigError> {
   67 |         Self::with_capacity_and_control_reserve(capacity, DEFAULT_CONTROL_RESERVE.min(capacity))
   68 |     }
   69 | 
   70 |     /// Construct a queue with slots reserved for control traffic. Normal
   71 |     /// traffic may use the non-reserved portion; control traffic may use the
   72 |     /// complete bounded queue. A zero reserve is useful for the explicit
   73 |     /// single-lane compatibility configuration.
   74 |     pub fn with_capacity_and_control_reserve(
   75 |         capacity: usize,
   76 |         control_reserve: usize,
   77 |     ) -> Result<Self, crate::QueueConfigError> {
   78 |         if capacity == 0 {
   79 |             return Err(crate::QueueConfigError::ZeroCapacity);
   80 |         }
   81 |         if control_reserve > capacity {
   82 |             return Err(crate::QueueConfigError::ControlReserveExceedsCapacity);
   83 |         }
   84 |         Ok(Self {
   85 |             capacity,
   86 |             control_reserve,
   87 |             state: Mutex::new(State {
   88 |                 next_ticket: 0,
   89 |                 control: VecDeque::new(),
   90 |                 normal: VecDeque::new(),
   91 |                 consecutive_control: 0,
   92 |                 closed: false,
   93 |             }),
   94 |             available: Condvar::new(),
   95 |         })
   96 |     }
   97 | 
   98 |     pub const fn capacity(&self) -> usize {
   99 |         self.capacity
  100 |     }
  101 | 
  102 |     pub fn len(&self) -> usize {
  103 |         let state = self.state.lock().expect("priority queue mutex poisoned");
  104 |         state.control.len() + state.normal.len()
  105 |     }
  106 | 
  107 |     pub fn is_empty(&self) -> bool {
  108 |         self.len() == 0
  109 |     }
  110 | 
  111 |     pub fn try_push_recoverable(
  112 |         &self,
  113 |         item: T,
  114 |         priority: QueuePriority,
  115 |     ) -> Result<u64, (EnqueueError, T)> {
  116 |         let mut state = self.state.lock().expect("priority queue mutex poisoned");
  117 |         if state.closed {
  118 |             return Err((EnqueueError::Closed, item));
  119 |         }
  120 |         let depth = state.control.len() + state.normal.len();
  121 |         let full = match priority {
  122 |             QueuePriority::Control => depth >= self.capacity,
  123 |             QueuePriority::Normal => depth >= self.capacity.saturating_sub(self.control_reserve),
  124 |         };
  125 |         if full {
  126 |             return Err((
  127 |                 EnqueueError::Busy(BusyOutcome::WriterQueueFull {
  128 |                     capacity: self.capacity,
  129 |                     depth,
  130 |                     retry_after_ms: 1,
  131 |                 }),
  132 |                 item,
  133 |             ));
  134 |         }
  135 |         let Some(ticket) = state.next_ticket.checked_add(1) else {
  136 |             return Err((EnqueueError::TicketExhausted, item));
  137 |         };
  138 |         state.next_ticket = ticket;
  139 |         let queued = PrioritizedItem {
  140 |             ticket,
  141 |             item,
  142 |             enqueued_at: Instant::now(),
  143 |         };
  144 |         match priority {
  145 |             QueuePriority::Control => state.control.push_back(queued),
  146 |             QueuePriority::Normal => state.normal.push_back(queued),
  147 |         }
  148 |         self.available.notify_one();
  149 |         Ok(ticket)
  150 |     }
  151 | 
  152 |     pub fn pop(&self) -> Option<PrioritizedItem<T>> {
  153 |         let mut state = self.state.lock().expect("priority queue mutex poisoned");
  154 |         loop {
  155 |             let choose_control = !state.control.is_empty()
  156 |                 && (state.normal.is_empty() || state.consecutive_control < MAX_CONTROL_BURST);
  157 |             if choose_control {
  158 |                 state.consecutive_control += 1;
  159 |                 return state.control.pop_front();
  160 |             }
  161 |             if let Some(item) = state.normal.pop_front() {
  162 |                 state.consecutive_control = 0;
  163 |                 return Some(item);
  164 |             }
  165 |             if state.closed {
  166 |                 return None;
  167 |             }
  168 |             state = self
  169 |                 .available
  170 |                 .wait(state)
  171 |                 .expect("priority queue mutex poisoned");
  172 |         }
  173 |     }
  174 | 
  175 |     pub fn close(&self) {
  176 |         let mut state = self.state.lock().expect("priority queue mutex poisoned");
  177 |         state.closed = true;
  178 |         self.available.notify_all();
  179 |     }
  180 | }
  181 | 
  182 | impl<T> fmt::Debug for PriorityQueue<T> {
  183 |     fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
  184 |         formatter
  185 |             .debug_struct("PriorityQueue")
  186 |             .field("capacity", &self.capacity)
  187 |             .field("control_reserve", &self.control_reserve)
  188 |             .field("depth", &self.len())
  189 |             .finish()
  190 |     }
  191 | }
  192 | 
  193 | #[cfg(test)]
  194 | mod tests {
  195 |     use super::*;
  196 | 
  197 |     #[test]
  198 |     fn control_items_pass_queued_normal_work() {
  199 |         let queue = PriorityQueue::with_capacity(4).unwrap();
  200 |         queue
  201 |             .try_push_recoverable("normal-1", QueuePriority::Normal)
  202 |             .unwrap();
  203 |         queue
  204 |             .try_push_recoverable("normal-2", QueuePriority::Normal)
  205 |             .unwrap();
  206 |         queue
  207 |             .try_push_recoverable("control", QueuePriority::Control)
  208 |             .unwrap();
  209 | 
  210 |         assert_eq!(queue.pop().unwrap().into_inner(), "control");
  211 |         assert_eq!(queue.pop().unwrap().into_inner(), "normal-1");
  212 |         assert_eq!(queue.pop().unwrap().into_inner(), "normal-2");
  213 |     }
  214 | 
  215 |     #[test]
  216 |     fn control_burst_is_bounded_and_normal_work_eventually_runs() {
  217 |         let queue = PriorityQueue::<String>::with_capacity(MAX_CONTROL_BURST + 2).unwrap();
  218 |         queue
  219 |             .try_push_recoverable("normal".to_owned(), QueuePriority::Normal)
  220 |             .unwrap();
  221 |         for index in 0..=MAX_CONTROL_BURST {
  222 |             queue
  223 |                 .try_push_recoverable(index.to_string(), QueuePriority::Control)
  224 |                 .unwrap();
  225 |         }
  226 | 
  227 |         for _ in 0..MAX_CONTROL_BURST {
  228 |             assert_ne!(queue.pop().unwrap().into_inner(), "normal");
  229 |         }
  230 |         assert_eq!(queue.pop().unwrap().into_inner(), "normal");
  231 |     }
  232 | 
  233 |     #[test]
  234 |     fn total_capacity_is_bounded_and_close_drains_both_lanes() {
  235 |         let queue = PriorityQueue::with_capacity(2).unwrap();
  236 |         queue
  237 |             .try_push_recoverable("normal", QueuePriority::Normal)
  238 |             .unwrap();
  239 |         queue
  240 |             .try_push_recoverable("control", QueuePriority::Control)
  241 |             .unwrap();
  242 |         assert!(matches!(
  243 |             queue.try_push_recoverable("overflow", QueuePriority::Control),
  244 |             Err((
  245 |                 EnqueueError::Busy(BusyOutcome::WriterQueueFull { depth: 2, .. }),
  246 |                 "overflow"
  247 |             ))
  248 |         ));
  249 |         queue.close();
  250 |         assert!(queue.pop().is_some());
  251 |         assert!(queue.pop().is_some());
  252 |         assert!(queue.pop().is_none());
  253 |     }
  254 | 
  255 |     #[test]
  256 |     fn control_reserve_remains_admissible_when_normal_lane_is_full() {
  257 |         let queue = PriorityQueue::with_capacity_and_control_reserve(3, 1).unwrap();
  258 |         queue
  259 |             .try_push_recoverable("normal-1", QueuePriority::Normal)
  260 |             .unwrap();
  261 |         queue
  262 |             .try_push_recoverable("normal-2", QueuePriority::Normal)
  263 |             .unwrap();
  264 |         assert!(matches!(
  265 |             queue.try_push_recoverable("normal-3", QueuePriority::Normal),
  266 |             Err((
  267 |                 EnqueueError::Busy(BusyOutcome::WriterQueueFull { depth: 2, .. }),
  268 |                 "normal-3"
  269 |             ))
  270 |         ));
  271 |         queue
  272 |             .try_push_recoverable("control", QueuePriority::Control)
  273 |             .unwrap();
  274 |         assert_eq!(queue.pop().unwrap().into_inner(), "control");
  275 |     }
  276 | }
````
