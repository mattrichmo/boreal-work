use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

/// A point-in-time view of writer scheduling measurements.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct WriterMetricsSnapshot {
    pub admitted: u64,
    pub completed: u64,
    pub queue_wait: Duration,
    pub writer_hold: Duration,
    pub max_queue_wait: Duration,
    pub max_writer_hold: Duration,
}

/// Lock-free counters for the writer boundary.
///
/// `queue_wait` ends when a queued task is removed by the writer, while
/// `writer_hold` covers only the task execution itself. They intentionally do
/// not share a timer or a bucket.
#[derive(Debug, Default)]
pub struct WriterMetrics {
    admitted: AtomicU64,
    completed: AtomicU64,
    queue_wait_nanos: AtomicU64,
    writer_hold_nanos: AtomicU64,
    max_queue_wait_nanos: AtomicU64,
    max_writer_hold_nanos: AtomicU64,
}

impl WriterMetrics {
    pub(crate) fn record_admitted(&self) {
        self.admitted.fetch_add(1, Ordering::Relaxed);
    }

    pub(crate) fn record_queue_wait(&self, duration: Duration) {
        let nanos = duration.as_nanos().min(u128::from(u64::MAX)) as u64;
        self.queue_wait_nanos.fetch_add(nanos, Ordering::Relaxed);
        self.max_queue_wait_nanos
            .fetch_max(nanos, Ordering::Relaxed);
    }

    pub(crate) fn record_writer_hold(&self, duration: Duration) {
        let nanos = duration.as_nanos().min(u128::from(u64::MAX)) as u64;
        self.writer_hold_nanos.fetch_add(nanos, Ordering::Relaxed);
        self.max_writer_hold_nanos
            .fetch_max(nanos, Ordering::Relaxed);
        self.completed.fetch_add(1, Ordering::Relaxed);
    }

    pub fn snapshot(&self) -> WriterMetricsSnapshot {
        WriterMetricsSnapshot {
            admitted: self.admitted.load(Ordering::Relaxed),
            completed: self.completed.load(Ordering::Relaxed),
            queue_wait: Duration::from_nanos(self.queue_wait_nanos.load(Ordering::Relaxed)),
            writer_hold: Duration::from_nanos(self.writer_hold_nanos.load(Ordering::Relaxed)),
            max_queue_wait: Duration::from_nanos(self.max_queue_wait_nanos.load(Ordering::Relaxed)),
            max_writer_hold: Duration::from_nanos(
                self.max_writer_hold_nanos.load(Ordering::Relaxed),
            ),
        }
    }
}
