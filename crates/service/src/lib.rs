//! Local service runtime primitives for Boreal v2.
//!
//! The service owns scheduling and process lifetime while callers provide
//! application-specific read and write tasks through the small traits in
//! [`tasks`]. The application route uses the shared, versioned protocol types
//! without depending on SQLite or an application implementation.

#[cfg(unix)]
mod application_route;
mod busy;
mod election;
#[cfg(unix)]
mod host;
mod metrics;
mod notifications;
mod queue;
mod read_pool;
mod recovery;
mod runtime;
mod tasks;
#[cfg(unix)]
mod transport;

#[cfg(unix)]
pub use application_route::{
    ApplicationCommandHandler, ApplicationRequest, ApplicationResponse, ApplicationRoute,
    ApplicationRouteConfig, ConcurrentApplicationCommandHandler, APPLICATION_API_VERSION,
    APPLICATION_SCHEMA_VERSION,
};
pub use busy::BusyOutcome;
pub use election::{ElectionError, ProjectElection};
#[cfg(unix)]
pub use host::{
    ServiceHost, ServiceHostConfig, ServiceHostConfigError, ServiceHostError, ServiceHostExit,
    ServiceHostHandle, ServiceHostHooks, ServiceHostReport, DEFAULT_DISPATCH_CAPACITY,
    DEFAULT_DISPATCH_WORKERS, DEFAULT_HOST_IO_TIMEOUT, DEFAULT_MAINTENANCE_INTERVAL,
};
pub use metrics::{WriterMetrics, WriterMetricsSnapshot};
pub use notifications::{
    NotificationError, NotificationHub, Replay, RevisionCursor, RevisionNotification, Subscription,
    SubscriptionUpdate,
};
pub use queue::{
    EnqueueError, FairWriterQueue, QueueConfigError, QueueTicket, QueuedWrite, WriterQueue,
};
pub use read_pool::{BoundedReadPool, ReadPool, ReadPoolConfigError, ReadPoolError};
pub use recovery::{
    OperationError, OperationPhase, OperationRecord, OperationRecovery, RecoveryBackend,
    RecoveryBackendError, RecoveryEntry, RecoveryReport,
};
pub use runtime::{
    BoundedWriter, ServiceRuntime, ServiceRuntimeConfigError, WriterExecutionError, WriterRuntime,
};
pub use tasks::{ReadExecutor, ReadFn, ReadTask, WriteExecutor, WriteFn, WriteTask};
#[cfg(unix)]
pub use transport::{
    IoOperation, JsonRequest, JsonResponse, ProtocolError, ProtocolErrorCode, ServeOnceOutcome,
    TransportConfig, TransportConfigError, TransportError, UnixSocketClient, UnixSocketServer,
    DEFAULT_MAX_FRAME_SIZE,
};
