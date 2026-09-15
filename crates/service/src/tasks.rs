//! Adapter-neutral task boundaries.

/// A short, materialized read operation.
///
/// Implementations should open/read/materialize/close their read transaction
/// inside `run_read`; serialization, rendering, and network waits belong
/// outside the task.
pub trait ReadTask: Send + 'static {
    type Output: Send + 'static;
    type Error: Send + 'static;

    fn run_read(self) -> Result<Self::Output, Self::Error>;
}

/// A short write operation intended for one writer-queue item.
///
/// Implementations should perform only the application/store transaction and
/// its audit/revision work. Slow external work must happen before queueing or
/// after the committed result is returned.
pub trait WriteTask: Send + 'static {
    type Output: Send + 'static;
    type Error: Send + 'static;

    fn run_write(self) -> Result<Self::Output, Self::Error>;
}

/// The read half of a local runtime boundary.
pub trait ReadExecutor {
    fn execute_read<T: ReadTask>(&self, task: T) -> Result<T::Output, T::Error>;
}

/// The write half of a local runtime boundary.
pub trait WriteExecutor {
    fn execute_write<T: WriteTask>(&self, task: T) -> Result<T::Output, T::Error>;
}

/// Convenience adapter for callers that already have a one-shot read closure.
pub struct ReadFn<F>(pub F);

impl<F, O, E> ReadTask for ReadFn<F>
where
    F: FnOnce() -> Result<O, E> + Send + 'static,
    O: Send + 'static,
    E: Send + 'static,
{
    type Output = O;
    type Error = E;

    fn run_read(self) -> Result<Self::Output, Self::Error> {
        (self.0)()
    }
}

/// Convenience adapter for callers that already have a one-shot write closure.
pub struct WriteFn<F>(pub F);

impl<F, O, E> WriteTask for WriteFn<F>
where
    F: FnOnce() -> Result<O, E> + Send + 'static,
    O: Send + 'static,
    E: Send + 'static,
{
    type Output = O;
    type Error = E;

    fn run_write(self) -> Result<Self::Output, Self::Error> {
        (self.0)()
    }
}
