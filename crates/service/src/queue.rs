use crate::BusyOutcome;
use std::collections::VecDeque;
use std::fmt;
use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};

/// A monotonically increasing position assigned at queue admission.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct QueueTicket(u64);

impl QueueTicket {
    pub const fn sequence(self) -> u64 {
        self.0
    }
}

/// A write item together with its fairness position.
#[derive(Debug)]
pub struct QueuedWrite<T> {
    ticket: QueueTicket,
    item: T,
    enqueued_at: Instant,
}

impl<T> QueuedWrite<T> {
    pub fn ticket(&self) -> QueueTicket {
        self.ticket
    }

    pub fn into_inner(self) -> T {
        self.item
    }

    pub fn item(&self) -> &T {
        &self.item
    }

    /// Time spent waiting between admission and removal by a consumer.
    pub fn wait_duration(&self) -> Duration {
        self.enqueued_at.elapsed()
    }
}

/// Errors returned while admitting work to a [`FairWriterQueue`].
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum EnqueueError {
    Busy(BusyOutcome),
    Closed,
    TicketExhausted,
}

impl fmt::Display for EnqueueError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Busy(outcome) => outcome.fmt(formatter),
            Self::Closed => formatter.write_str("writer queue is closed"),
            Self::TicketExhausted => formatter.write_str("writer queue ticket space exhausted"),
        }
    }
}

impl std::error::Error for EnqueueError {}

/// Invalid queue configuration.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum QueueConfigError {
    ZeroCapacity,
}

impl fmt::Display for QueueConfigError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ZeroCapacity => formatter.write_str("writer queue capacity must be positive"),
        }
    }
}

impl std::error::Error for QueueConfigError {}

struct QueueState<T> {
    next_ticket: u64,
    items: VecDeque<QueuedWrite<T>>,
    closed: bool,
}

/// A bounded, FIFO writer queue.
///
/// Admission and ticket assignment happen under one mutex, which defines a
/// deterministic FIFO order even when producers race. `try_push` never waits
/// for a writer and reports saturation as a typed busy outcome. `pop` waits
/// only for an item and returns queued work in ticket order.
pub struct FairWriterQueue<T> {
    capacity: usize,
    state: Mutex<QueueState<T>>,
    available: Condvar,
}

impl<T> FairWriterQueue<T> {
    pub fn new(capacity: usize) -> Result<Self, QueueConfigError> {
        Self::with_capacity(capacity)
    }

    pub fn with_capacity(capacity: usize) -> Result<Self, QueueConfigError> {
        if capacity == 0 {
            return Err(QueueConfigError::ZeroCapacity);
        }
        Ok(Self {
            capacity,
            state: Mutex::new(QueueState {
                next_ticket: 0,
                items: VecDeque::with_capacity(capacity),
                closed: false,
            }),
            available: Condvar::new(),
        })
    }

    pub const fn capacity(&self) -> usize {
        self.capacity
    }

    pub fn len(&self) -> usize {
        self.state
            .lock()
            .expect("writer queue mutex poisoned")
            .items
            .len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn is_closed(&self) -> bool {
        self.state
            .lock()
            .expect("writer queue mutex poisoned")
            .closed
    }

    /// Admit one item without waiting for a writer.
    pub fn try_push(&self, item: T) -> Result<QueueTicket, EnqueueError> {
        self.try_push_recoverable(item).map_err(|(error, _)| error)
    }

    /// Admit one item without waiting, returning the item on rejection.
    ///
    /// Network-facing dispatchers use this form so a typed busy response can
    /// still be written to a just-accepted connection when the bounded queue
    /// is saturated.
    pub fn try_push_recoverable(&self, item: T) -> Result<QueueTicket, (EnqueueError, T)> {
        let mut state = self.state.lock().expect("writer queue mutex poisoned");
        if state.closed {
            return Err((EnqueueError::Closed, item));
        }
        if state.items.len() == self.capacity {
            return Err((
                EnqueueError::Busy(BusyOutcome::WriterQueueFull {
                    capacity: self.capacity,
                    depth: state.items.len(),
                    retry_after_ms: 1,
                }),
                item,
            ));
        }

        let Some(next_ticket) = state.next_ticket.checked_add(1) else {
            return Err((EnqueueError::TicketExhausted, item));
        };
        let ticket = QueueTicket(next_ticket);
        state.next_ticket += 1;
        state.items.push_back(QueuedWrite {
            ticket,
            item,
            enqueued_at: Instant::now(),
        });
        self.available.notify_one();
        Ok(ticket)
    }

    /// Remove the oldest item, waiting until one is available or the queue is
    /// closed and drained.
    pub fn pop(&self) -> Option<QueuedWrite<T>> {
        let mut state = self.state.lock().expect("writer queue mutex poisoned");
        loop {
            if let Some(item) = state.items.pop_front() {
                return Some(item);
            }
            if state.closed {
                return None;
            }
            state = self
                .available
                .wait(state)
                .expect("writer queue mutex poisoned");
        }
    }

    /// Remove the oldest item without waiting.
    pub fn try_pop(&self) -> Option<QueuedWrite<T>> {
        self.state
            .lock()
            .expect("writer queue mutex poisoned")
            .items
            .pop_front()
    }

    /// Close admission while allowing already accepted writes to drain.
    pub fn close(&self) {
        let mut state = self.state.lock().expect("writer queue mutex poisoned");
        state.closed = true;
        self.available.notify_all();
    }
}

pub type WriterQueue<T> = FairWriterQueue<T>;

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Barrier};
    use std::thread;

    #[test]
    fn fifo_order_survives_interleaved_admission_and_consumption() {
        let queue = FairWriterQueue::with_capacity(3).unwrap();
        let first = queue.try_push("first").unwrap();
        let second = queue.try_push("second").unwrap();
        assert_eq!(queue.try_pop().unwrap().into_inner(), "first");
        let third = queue.try_push("third").unwrap();

        assert_eq!(first.sequence(), 1);
        assert_eq!(second.sequence(), 2);
        assert_eq!(third.sequence(), 3);
        assert_eq!(queue.pop().unwrap().into_inner(), "second");
        assert_eq!(queue.pop().unwrap().into_inner(), "third");
    }

    #[test]
    fn concurrent_producers_are_drained_in_ticket_order() {
        let queue = Arc::new(FairWriterQueue::with_capacity(64).unwrap());
        let start = Arc::new(Barrier::new(5));
        let producers = (0..4)
            .map(|producer| {
                let queue = Arc::clone(&queue);
                let start = Arc::clone(&start);
                thread::spawn(move || {
                    start.wait();
                    (0..8)
                        .map(|item| queue.try_push((producer, item)).unwrap())
                        .collect::<Vec<_>>()
                })
            })
            .collect::<Vec<_>>();
        start.wait();

        let mut producer_tickets = producers
            .into_iter()
            .flat_map(|producer| producer.join().unwrap())
            .collect::<Vec<_>>();
        producer_tickets.sort();

        let drained = (0..32)
            .map(|_| queue.pop().unwrap().ticket())
            .collect::<Vec<_>>();
        assert_eq!(drained, producer_tickets);
        assert_eq!(queue.len(), 0);
    }

    #[test]
    fn admission_is_bounded_and_reports_typed_busy() {
        let queue = FairWriterQueue::with_capacity(2).unwrap();
        queue.try_push(1).unwrap();
        queue.try_push(2).unwrap();

        let error = queue.try_push(3).unwrap_err();
        assert_eq!(
            error,
            EnqueueError::Busy(BusyOutcome::WriterQueueFull {
                capacity: 2,
                depth: 2,
                retry_after_ms: 1,
            })
        );
        assert_eq!(queue.len(), 2);
        assert_eq!(queue.capacity(), 2);
    }

    #[test]
    fn close_drains_accepted_writes_without_admitting_new_ones() {
        let queue = FairWriterQueue::with_capacity(2).unwrap();
        queue.try_push("accepted").unwrap();
        queue.close();

        assert_eq!(queue.try_push("rejected"), Err(EnqueueError::Closed));
        assert_eq!(queue.pop().unwrap().into_inner(), "accepted");
        assert!(queue.pop().is_none());
    }
}
