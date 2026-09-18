use crate::{
    EnqueueError, FairWriterQueue, NotificationHub, OperationError, OperationRecord,
    OperationRecovery, ReadPoolConfigError, ReadPoolError, ReadTask, RevisionCursor, Subscription,
    WriteTask, WriterMetrics, WriterMetricsSnapshot,
};
use std::fmt;
use std::sync::{mpsc, Arc};
use std::thread::{self, JoinHandle};
use std::time::Instant;

struct WriteJob {
    operation_id: String,
    run: Box<dyn FnOnce() + Send + 'static>,
}

#[derive(Debug)]
pub enum WriterExecutionError<E> {
    Queue(EnqueueError),
    Duplicate(OperationRecord),
    InvalidOperation,
    /// The task crossed an execution boundary without producing a result.
    /// The application must read the durable operation back before retrying.
    Unknown,
    WorkerStopped,
    Task(E),
}

impl<E: fmt::Display> fmt::Display for WriterExecutionError<E> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Queue(error) => error.fmt(formatter),
            Self::Duplicate(record) => write!(
                formatter,
                "operation {:?} already exists",
                record.operation_id()
            ),
            Self::InvalidOperation => {
                formatter.write_str("operation ID must be non-empty and safe")
            }
            Self::Unknown => {
                formatter.write_str("write outcome is unknown; read back the operation")
            }
            Self::WorkerStopped => formatter.write_str("writer worker stopped"),
            Self::Task(error) => write!(formatter, "write task failed: {error}"),
        }
    }
}

impl<E: fmt::Debug + fmt::Display + Send + 'static> std::error::Error for WriterExecutionError<E> {}

/// The single writer execution lane around the existing fair queue.
pub struct BoundedWriter {
    queue: Arc<FairWriterQueue<WriteJob>>,
    recovery: OperationRecovery,
    metrics: Arc<WriterMetrics>,
    worker: Option<JoinHandle<()>>,
}

impl BoundedWriter {
    pub fn new(capacity: usize) -> Result<Self, crate::QueueConfigError> {
        Self::with_recovery(capacity, OperationRecovery::new())
    }

    pub fn with_recovery(
        capacity: usize,
        recovery: OperationRecovery,
    ) -> Result<Self, crate::QueueConfigError> {
        let queue = Arc::new(FairWriterQueue::<WriteJob>::with_capacity(capacity)?);
        let worker_queue = Arc::clone(&queue);
        let worker_recovery = recovery.clone();
        let metrics = Arc::new(WriterMetrics::default());
        let worker_metrics = Arc::clone(&metrics);
        let worker = thread::spawn(move || {
            while let Some(queued) = worker_queue.pop() {
                let wait = queued.wait_duration();
                let job = queued.into_inner();
                worker_metrics.record_queue_wait(wait);
                worker_recovery.mark_in_flight(&job.operation_id);
                let started = Instant::now();
                (job.run)();
                worker_metrics.record_writer_hold(started.elapsed());
            }
        });
        Ok(Self {
            queue,
            recovery,
            metrics,
            worker: Some(worker),
        })
    }

    pub fn capacity(&self) -> usize {
        self.queue.capacity()
    }

    pub fn queued(&self) -> usize {
        self.queue.len()
    }

    pub fn metrics(&self) -> WriterMetricsSnapshot {
        self.metrics.snapshot()
    }

    pub fn recovery(&self) -> OperationRecovery {
        self.recovery.clone()
    }

    pub fn execute<T: WriteTask>(
        &self,
        operation_id: impl Into<String>,
        task: T,
    ) -> Result<T::Output, WriterExecutionError<T::Error>> {
        let operation_id = operation_id.into();
        self.recovery
            .admit(operation_id.clone())
            .map_err(|error| match error {
                OperationError::Duplicate(record) => WriterExecutionError::Duplicate(record),
                OperationError::InvalidId | OperationError::HydrationConflict { .. } => {
                    WriterExecutionError::InvalidOperation
                }
            })?;
        let (sender, receiver) = mpsc::sync_channel(1);
        let job = WriteJob {
            operation_id: operation_id.clone(),
            run: Box::new(move || {
                let result =
                    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| task.run_write()));
                let result = match result {
                    Ok(Ok(output)) => Ok(output),
                    Ok(Err(error)) => Err(WriterExecutionError::Task(error)),
                    // A panic can happen after an application transaction has
                    // committed but before the result reached the caller.
                    // It is therefore never safe to classify this as failed.
                    Err(_) => Err(WriterExecutionError::Unknown),
                };
                let _ = sender.send(result);
            }),
        };
        let ticket = match self.queue.try_push(job) {
            Ok(ticket) => ticket,
            Err(error) => {
                self.recovery.remove(&operation_id);
                return Err(WriterExecutionError::Queue(error));
            }
        };
        self.metrics.record_admitted();
        self.recovery.set_ticket(&operation_id, ticket);
        match receiver.recv() {
            Ok(Ok(output)) => {
                self.recovery.mark_committed(&operation_id, None);
                self.recovery.remove(&operation_id);
                Ok(output)
            }
            Ok(Err(WriterExecutionError::Unknown)) => {
                self.recovery.mark_unknown(&operation_id);
                Err(WriterExecutionError::Unknown)
            }
            Ok(Err(WriterExecutionError::WorkerStopped)) => {
                // A stopped worker produced no durable result. Preserve the
                // admission record for operation-ID readback.
                self.recovery.mark_unknown(&operation_id);
                Err(WriterExecutionError::WorkerStopped)
            }
            Ok(Err(WriterExecutionError::Task(error))) => {
                self.recovery.mark_failed(&operation_id);
                self.recovery.remove(&operation_id);
                Err(WriterExecutionError::Task(error))
            }
            Ok(Err(other)) => {
                self.recovery.remove(&operation_id);
                Err(other)
            }
            Err(_) => {
                self.recovery.mark_unknown(&operation_id);
                Err(WriterExecutionError::Unknown)
            }
        }
    }
}

impl Drop for BoundedWriter {
    fn drop(&mut self) {
        self.queue.close();
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

#[derive(Debug)]
pub enum ServiceRuntimeConfigError {
    Queue(crate::QueueConfigError),
    ReadPool(ReadPoolConfigError),
    Notifications(crate::NotificationError),
}

/// Dependency-free composition point for service adapters.
pub struct ServiceRuntime {
    reads: crate::BoundedReadPool,
    writes: BoundedWriter,
    notifications: NotificationHub,
}

impl ServiceRuntime {
    pub fn new(
        read_workers: usize,
        read_capacity: usize,
        writer_capacity: usize,
        notification_capacity: usize,
    ) -> Result<Self, ServiceRuntimeConfigError> {
        let reads = crate::BoundedReadPool::new(read_workers, read_capacity)
            .map_err(ServiceRuntimeConfigError::ReadPool)?;
        let writes =
            BoundedWriter::new(writer_capacity).map_err(ServiceRuntimeConfigError::Queue)?;
        let notifications = NotificationHub::new(notification_capacity)
            .map_err(ServiceRuntimeConfigError::Notifications)?;
        Ok(Self {
            reads,
            writes,
            notifications,
        })
    }

    pub fn execute_read<T: ReadTask>(&self, task: T) -> Result<T::Output, ReadPoolError<T::Error>> {
        self.reads.execute(task)
    }

    pub fn execute_write<T: WriteTask>(
        &self,
        operation_id: impl Into<String>,
        task: T,
    ) -> Result<T::Output, WriterExecutionError<T::Error>> {
        self.writes.execute(operation_id, task)
    }

    pub fn publish_revision<I, S>(
        &self,
        revision: u64,
        subjects: I,
    ) -> Result<(), crate::NotificationError>
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.notifications.publish(revision, subjects)
    }

    pub fn subscribe(&self, cursor: RevisionCursor) -> Subscription {
        self.notifications.subscribe(cursor)
    }

    pub fn metrics(&self) -> WriterMetricsSnapshot {
        self.writes.metrics()
    }

    pub fn recovery(&self) -> OperationRecovery {
        self.writes.recovery()
    }
}

pub type WriterRuntime = BoundedWriter;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::WriteFn;
    use std::sync::{Arc, Barrier};
    use std::thread;

    #[test]
    fn writer_metrics_keep_queue_wait_separate_from_hold_time() {
        let writer = Arc::new(BoundedWriter::new(1).unwrap());
        let entered = Arc::new(Barrier::new(2));
        let release = Arc::new(Barrier::new(2));
        let first_writer = Arc::clone(&writer);
        let first_entered = Arc::clone(&entered);
        let first_release = Arc::clone(&release);
        let first = thread::spawn(move || {
            first_writer.execute(
                "first",
                WriteFn(move || {
                    first_entered.wait();
                    first_release.wait();
                    Ok::<_, ()>(1)
                }),
            )
        });
        entered.wait();
        let second_writer = Arc::clone(&writer);
        let second =
            thread::spawn(move || second_writer.execute("second", WriteFn(|| Ok::<_, ()>(2))));
        for _ in 0..10_000 {
            if writer.queued() == 1 {
                break;
            }
            thread::yield_now();
        }
        assert_eq!(writer.queued(), 1);
        release.wait();
        assert_eq!(first.join().unwrap().unwrap(), 1);
        assert_eq!(second.join().unwrap().unwrap(), 2);
        let metrics = writer.metrics();
        assert_eq!(metrics.admitted, 2);
        assert_eq!(metrics.completed, 2);
        assert!(metrics.queue_wait >= metrics.max_queue_wait);
        assert!(metrics.writer_hold >= metrics.max_writer_hold);
    }

    #[test]
    fn completed_writer_operation_ids_are_active_only() {
        let writer = BoundedWriter::new(1).unwrap();
        assert_eq!(
            writer
                .execute("op_runtime_replay", WriteFn(|| Ok::<_, ()>(1)))
                .unwrap(),
            1
        );
        assert_eq!(
            writer
                .execute("op_runtime_replay", WriteFn(|| Ok::<_, ()>(2)))
                .unwrap(),
            2
        );
        assert!(writer.recovery().records().is_empty());
    }

    #[test]
    fn panicking_write_task_is_unknown_and_retained_for_readback() {
        let writer = BoundedWriter::new(1).unwrap();
        let result = writer.execute(
            "op_runtime_panic",
            WriteFn(|| -> Result<(), ()> { panic!("simulated post-commit panic") }),
        );

        assert!(matches!(result, Err(WriterExecutionError::Unknown)));
        assert_eq!(
            writer
                .recovery()
                .get("op_runtime_panic")
                .expect("unknown operation is retained")
                .phase(),
            crate::OperationPhase::Unknown
        );
    }
}
