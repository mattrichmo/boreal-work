use crate::{BusyOutcome, EnqueueError, FairWriterQueue, ReadTask};
use std::fmt;
use std::sync::{mpsc, Arc};
use std::thread::{self, JoinHandle};

struct ReadJob {
    run: Box<dyn FnOnce() + Send + 'static>,
}

#[derive(Debug)]
pub enum ReadPoolError<E> {
    Busy(BusyOutcome),
    Closed,
    WorkerStopped,
    Task(E),
}

impl<E: fmt::Display> fmt::Display for ReadPoolError<E> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Busy(outcome) => outcome.fmt(formatter),
            Self::Closed => formatter.write_str("read pool is closed"),
            Self::WorkerStopped => formatter.write_str("read pool worker stopped"),
            Self::Task(error) => write!(formatter, "read task failed: {error}"),
        }
    }
}

impl<E: fmt::Debug + fmt::Display + Send + 'static> std::error::Error for ReadPoolError<E> {}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReadPoolConfigError {
    ZeroWorkers,
    ZeroCapacity,
}

impl fmt::Display for ReadPoolConfigError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ZeroWorkers => formatter.write_str("read pool worker count must be positive"),
            Self::ZeroCapacity => formatter.write_str("read pool capacity must be positive"),
        }
    }
}

impl std::error::Error for ReadPoolConfigError {}

/// A fixed-size, bounded read executor. Read tasks are FIFO and each worker
/// runs one short materialization at a time; serialization remains the
/// caller's responsibility after the result is returned.
pub struct BoundedReadPool {
    queue: Arc<FairWriterQueue<ReadJob>>,
    workers: Vec<JoinHandle<()>>,
}

impl BoundedReadPool {
    pub fn new(worker_count: usize, capacity: usize) -> Result<Self, ReadPoolConfigError> {
        if worker_count == 0 {
            return Err(ReadPoolConfigError::ZeroWorkers);
        }
        if capacity == 0 {
            return Err(ReadPoolConfigError::ZeroCapacity);
        }
        let queue = Arc::new(
            FairWriterQueue::<ReadJob>::with_capacity(capacity)
                .map_err(|_| ReadPoolConfigError::ZeroCapacity)?,
        );
        let workers = (0..worker_count)
            .map(|_| {
                let queue = Arc::clone(&queue);
                thread::spawn(move || {
                    while let Some(job) = queue.pop() {
                        (job.into_inner().run)();
                    }
                })
            })
            .collect();
        Ok(Self { queue, workers })
    }

    pub fn worker_count(&self) -> usize {
        self.workers.len()
    }

    pub fn capacity(&self) -> usize {
        self.queue.capacity()
    }

    pub fn queued(&self) -> usize {
        self.queue.len()
    }

    pub fn execute<T: ReadTask>(&self, task: T) -> Result<T::Output, ReadPoolError<T::Error>> {
        let (sender, receiver) = mpsc::sync_channel(1);
        let job = ReadJob {
            run: Box::new(move || {
                let result =
                    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| task.run_read()));
                let result = match result {
                    Ok(Ok(output)) => Ok(output),
                    Ok(Err(error)) => Err(ReadPoolError::Task(error)),
                    Err(_) => Err(ReadPoolError::WorkerStopped),
                };
                let _ = sender.send(result);
            }),
        };
        self.queue.try_push(job).map_err(map_enqueue)?;
        match receiver.recv() {
            Ok(Ok(output)) => Ok(output),
            Ok(Err(error)) => Err(error),
            Err(_) => Err(ReadPoolError::WorkerStopped),
        }
    }
}

impl Drop for BoundedReadPool {
    fn drop(&mut self) {
        self.queue.close();
        for worker in self.workers.drain(..) {
            let _ = worker.join();
        }
    }
}

fn map_enqueue<E>(error: EnqueueError) -> ReadPoolError<E> {
    match error {
        EnqueueError::Busy(BusyOutcome::WriterQueueFull {
            capacity,
            depth,
            retry_after_ms,
        }) => ReadPoolError::Busy(BusyOutcome::ReadPoolFull {
            capacity,
            depth,
            retry_after_ms,
        }),
        EnqueueError::Busy(outcome) => ReadPoolError::Busy(outcome),
        EnqueueError::Closed => ReadPoolError::Closed,
        EnqueueError::TicketExhausted => ReadPoolError::Closed,
    }
}

pub type ReadPool = BoundedReadPool;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ReadFn;
    use std::sync::{mpsc, Arc, Barrier};
    use std::thread;

    #[test]
    fn pool_is_bounded_without_waiting_for_a_worker() {
        let pool = Arc::new(BoundedReadPool::new(1, 1).unwrap());
        let entered = Arc::new(Barrier::new(2));
        let release = Arc::new(Barrier::new(2));
        let first_pool = Arc::clone(&pool);
        let first_entered = Arc::clone(&entered);
        let first_release = Arc::clone(&release);
        let first = thread::spawn(move || {
            first_pool.execute(ReadFn(move || {
                first_entered.wait();
                first_release.wait();
                Ok::<_, ()>(1)
            }))
        });
        entered.wait();

        let (second_sender, second_receiver) = mpsc::channel();
        let second_pool = Arc::clone(&pool);
        let second = thread::spawn(move || {
            let result = second_pool.execute(ReadFn(|| Ok::<_, ()>(2)));
            second_sender.send(result).unwrap();
        });
        for _ in 0..10_000 {
            if pool.queued() == 1 {
                break;
            }
            thread::yield_now();
        }
        assert_eq!(pool.queued(), 1);
        assert!(matches!(
            pool.execute(ReadFn(|| Ok::<_, ()>(3))),
            Err(ReadPoolError::Busy(BusyOutcome::ReadPoolFull {
                capacity: 1,
                depth: 1,
                ..
            }))
        ));
        release.wait();
        assert_eq!(first.join().unwrap().unwrap(), 1);
        assert_eq!(second_receiver.recv().unwrap().unwrap(), 2);
        second.join().unwrap();
    }
}
