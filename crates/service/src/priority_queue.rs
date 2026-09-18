use crate::{BusyOutcome, EnqueueError};
use std::collections::VecDeque;
use std::fmt;
use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};

/// Dispatch class used by the local service host.
///
/// Control traffic is allowed to pass queued application work, but a bounded
/// burst prevents a continuously busy control plane from starving ordinary
/// work forever.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum QueuePriority {
    Control,
    Normal,
}

/// A queued item with its admission ticket and priority.
#[derive(Debug)]
pub struct PrioritizedItem<T> {
    ticket: u64,
    item: T,
    enqueued_at: Instant,
}

impl<T> PrioritizedItem<T> {
    pub fn ticket(&self) -> u64 {
        self.ticket
    }

    pub fn into_inner(self) -> T {
        self.item
    }

    pub fn wait_duration(&self) -> Duration {
        self.enqueued_at.elapsed()
    }
}

#[derive(Debug)]
struct State<T> {
    next_ticket: u64,
    control: VecDeque<PrioritizedItem<T>>,
    normal: VecDeque<PrioritizedItem<T>>,
    consecutive_control: usize,
    closed: bool,
}

/// A bounded queue with a control-plane lane.
///
/// Admission remains non-blocking and total depth is bounded by `capacity`.
/// Workers prefer control items, subject to [`MAX_CONTROL_BURST`], then return
/// to the normal FIFO lane. This keeps heartbeat/stop/readback/status work
/// responsive while preserving eventual progress for queued mutations.
pub struct PriorityQueue<T> {
    capacity: usize,
    state: Mutex<State<T>>,
    available: Condvar,
}

pub const MAX_CONTROL_BURST: usize = 8;

impl<T> PriorityQueue<T> {
    pub fn with_capacity(capacity: usize) -> Result<Self, crate::QueueConfigError> {
        if capacity == 0 {
            return Err(crate::QueueConfigError::ZeroCapacity);
        }
        Ok(Self {
            capacity,
            state: Mutex::new(State {
                next_ticket: 0,
                control: VecDeque::new(),
                normal: VecDeque::new(),
                consecutive_control: 0,
                closed: false,
            }),
            available: Condvar::new(),
        })
    }

    pub const fn capacity(&self) -> usize {
        self.capacity
    }

    pub fn len(&self) -> usize {
        let state = self.state.lock().expect("priority queue mutex poisoned");
        state.control.len() + state.normal.len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn try_push_recoverable(
        &self,
        item: T,
        priority: QueuePriority,
    ) -> Result<u64, (EnqueueError, T)> {
        let mut state = self.state.lock().expect("priority queue mutex poisoned");
        if state.closed {
            return Err((EnqueueError::Closed, item));
        }
        if state.control.len() + state.normal.len() >= self.capacity {
            return Err((
                EnqueueError::Busy(BusyOutcome::WriterQueueFull {
                    capacity: self.capacity,
                    depth: state.control.len() + state.normal.len(),
                    retry_after_ms: 1,
                }),
                item,
            ));
        }
        let Some(ticket) = state.next_ticket.checked_add(1) else {
            return Err((EnqueueError::TicketExhausted, item));
        };
        state.next_ticket = ticket;
        let queued = PrioritizedItem {
            ticket,
            item,
            enqueued_at: Instant::now(),
        };
        match priority {
            QueuePriority::Control => state.control.push_back(queued),
            QueuePriority::Normal => state.normal.push_back(queued),
        }
        self.available.notify_one();
        Ok(ticket)
    }

    pub fn pop(&self) -> Option<PrioritizedItem<T>> {
        let mut state = self.state.lock().expect("priority queue mutex poisoned");
        loop {
            let choose_control = !state.control.is_empty()
                && (state.normal.is_empty() || state.consecutive_control < MAX_CONTROL_BURST);
            if choose_control {
                state.consecutive_control += 1;
                return state.control.pop_front();
            }
            if let Some(item) = state.normal.pop_front() {
                state.consecutive_control = 0;
                return Some(item);
            }
            if state.closed {
                return None;
            }
            state = self
                .available
                .wait(state)
                .expect("priority queue mutex poisoned");
        }
    }

    pub fn close(&self) {
        let mut state = self.state.lock().expect("priority queue mutex poisoned");
        state.closed = true;
        self.available.notify_all();
    }
}

impl<T> fmt::Debug for PriorityQueue<T> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("PriorityQueue")
            .field("capacity", &self.capacity)
            .field("depth", &self.len())
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn control_items_pass_queued_normal_work() {
        let queue = PriorityQueue::with_capacity(4).unwrap();
        queue
            .try_push_recoverable("normal-1", QueuePriority::Normal)
            .unwrap();
        queue
            .try_push_recoverable("normal-2", QueuePriority::Normal)
            .unwrap();
        queue
            .try_push_recoverable("control", QueuePriority::Control)
            .unwrap();

        assert_eq!(queue.pop().unwrap().into_inner(), "control");
        assert_eq!(queue.pop().unwrap().into_inner(), "normal-1");
        assert_eq!(queue.pop().unwrap().into_inner(), "normal-2");
    }

    #[test]
    fn control_burst_is_bounded_and_normal_work_eventually_runs() {
        let queue = PriorityQueue::<String>::with_capacity(MAX_CONTROL_BURST + 2).unwrap();
        queue
            .try_push_recoverable("normal".to_owned(), QueuePriority::Normal)
            .unwrap();
        for index in 0..=MAX_CONTROL_BURST {
            queue
                .try_push_recoverable(index.to_string(), QueuePriority::Control)
                .unwrap();
        }

        for _ in 0..MAX_CONTROL_BURST {
            assert_ne!(queue.pop().unwrap().into_inner(), "normal");
        }
        assert_eq!(queue.pop().unwrap().into_inner(), "normal");
    }

    #[test]
    fn total_capacity_is_bounded_and_close_drains_both_lanes() {
        let queue = PriorityQueue::with_capacity(2).unwrap();
        queue
            .try_push_recoverable("normal", QueuePriority::Normal)
            .unwrap();
        queue
            .try_push_recoverable("control", QueuePriority::Control)
            .unwrap();
        assert!(matches!(
            queue.try_push_recoverable("overflow", QueuePriority::Control),
            Err((
                EnqueueError::Busy(BusyOutcome::WriterQueueFull { depth: 2, .. }),
                "overflow"
            ))
        ));
        queue.close();
        assert!(queue.pop().is_some());
        assert!(queue.pop().is_some());
        assert!(queue.pop().is_none());
    }
}
