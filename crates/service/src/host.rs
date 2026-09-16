//! Long-lived local service host.
//!
//! [`ServiceHost`] owns only the process boundary: a Unix listener, the
//! versioned [`ApplicationRoute`], and a bounded request loop. The application
//! supplies the [`ApplicationCommandHandler`]; this module intentionally does
//! not open SQLite or implement any business transition.

use crate::application_route::ConcurrentApplicationCommandHandler;
use crate::recovery::{RecoveryBackend, RecoveryBackendError};
use crate::transport::UnixSocketConnection;
use crate::{
    ApplicationCommandHandler, ApplicationRoute, ApplicationRouteConfig, EnqueueError,
    FairWriterQueue, OperationRecovery, ProjectElection, RecoveryReport, ServeOnceOutcome,
    TransportConfig, TransportConfigError, TransportError, UnixSocketServer,
};
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::thread::{self, JoinHandle};
use std::time::Duration;

/// A conservative per-client timeout used when a host config does not supply
/// one. It ensures shutdown is observed even if a connected client stops
/// sending bytes.
pub const DEFAULT_HOST_IO_TIMEOUT: Duration = Duration::from_millis(100);
pub const DEFAULT_DISPATCH_WORKERS: usize = 4;
pub const DEFAULT_DISPATCH_CAPACITY: usize = 32;
pub const DEFAULT_MAINTENANCE_INTERVAL: Duration = Duration::from_secs(1);

/// Settings for a long-lived local host.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ServiceHostConfig {
    transport: TransportConfig,
    application: ApplicationRouteConfig,
    poll_interval: Duration,
    max_requests: Option<usize>,
    dispatch_workers: usize,
    dispatch_capacity: usize,
    maintenance_interval: Duration,
}

impl Default for ServiceHostConfig {
    fn default() -> Self {
        Self::new(
            TransportConfig::default(),
            ApplicationRouteConfig::default(),
        )
        .expect("default service host configuration is valid")
    }
}

impl ServiceHostConfig {
    /// Construct a host config. Missing socket timeouts are filled with the
    /// bounded host default so shutdown cannot be held hostage by a client.
    pub fn new(
        mut transport: TransportConfig,
        application: ApplicationRouteConfig,
    ) -> Result<Self, ServiceHostConfigError> {
        transport
            .validate()
            .map_err(ServiceHostConfigError::Transport)?;
        if application.max_payload_size == 0 {
            return Err(ServiceHostConfigError::ZeroApplicationPayload);
        }
        if transport.read_timeout.is_none() {
            transport.read_timeout = Some(DEFAULT_HOST_IO_TIMEOUT);
        }
        if transport.write_timeout.is_none() {
            transport.write_timeout = Some(DEFAULT_HOST_IO_TIMEOUT);
        }
        Ok(Self {
            transport,
            application,
            poll_interval: Duration::from_millis(5),
            max_requests: None,
            dispatch_workers: DEFAULT_DISPATCH_WORKERS,
            dispatch_capacity: DEFAULT_DISPATCH_CAPACITY,
            maintenance_interval: DEFAULT_MAINTENANCE_INTERVAL,
        })
    }

    pub fn transport(&self) -> &TransportConfig {
        &self.transport
    }

    pub const fn application(&self) -> ApplicationRouteConfig {
        self.application
    }

    pub const fn poll_interval(&self) -> Duration {
        self.poll_interval
    }

    pub const fn max_requests(&self) -> Option<usize> {
        self.max_requests
    }

    pub const fn dispatch_workers(&self) -> usize {
        self.dispatch_workers
    }

    pub const fn dispatch_capacity(&self) -> usize {
        self.dispatch_capacity
    }

    pub const fn maintenance_interval(&self) -> Duration {
        self.maintenance_interval
    }

    pub fn with_poll_interval(
        mut self,
        poll_interval: Duration,
    ) -> Result<Self, ServiceHostConfigError> {
        if poll_interval.is_zero() {
            return Err(ServiceHostConfigError::ZeroPollInterval);
        }
        self.poll_interval = poll_interval;
        Ok(self)
    }

    pub fn with_max_requests(
        mut self,
        max_requests: Option<usize>,
    ) -> Result<Self, ServiceHostConfigError> {
        if max_requests == Some(0) {
            return Err(ServiceHostConfigError::ZeroMaxRequests);
        }
        self.max_requests = max_requests;
        Ok(self)
    }

    pub fn with_dispatch_workers(mut self, workers: usize) -> Result<Self, ServiceHostConfigError> {
        if workers == 0 {
            return Err(ServiceHostConfigError::ZeroDispatchWorkers);
        }
        self.dispatch_workers = workers;
        Ok(self)
    }

    pub fn with_dispatch_capacity(
        mut self,
        capacity: usize,
    ) -> Result<Self, ServiceHostConfigError> {
        if capacity == 0 {
            return Err(ServiceHostConfigError::ZeroDispatchCapacity);
        }
        self.dispatch_capacity = capacity;
        Ok(self)
    }

    pub fn with_maintenance_interval(
        mut self,
        interval: Duration,
    ) -> Result<Self, ServiceHostConfigError> {
        if interval.is_zero() {
            return Err(ServiceHostConfigError::ZeroMaintenanceInterval);
        }
        self.maintenance_interval = interval;
        Ok(self)
    }

    pub fn validate(&self) -> Result<(), ServiceHostConfigError> {
        self.transport
            .validate()
            .map_err(ServiceHostConfigError::Transport)?;
        if self.application.max_payload_size == 0 {
            return Err(ServiceHostConfigError::ZeroApplicationPayload);
        }
        if self.poll_interval.is_zero() {
            return Err(ServiceHostConfigError::ZeroPollInterval);
        }
        if self.max_requests == Some(0) {
            return Err(ServiceHostConfigError::ZeroMaxRequests);
        }
        if self.dispatch_workers == 0 {
            return Err(ServiceHostConfigError::ZeroDispatchWorkers);
        }
        if self.dispatch_capacity == 0 {
            return Err(ServiceHostConfigError::ZeroDispatchCapacity);
        }
        if self.maintenance_interval.is_zero() {
            return Err(ServiceHostConfigError::ZeroMaintenanceInterval);
        }
        Ok(())
    }
}

/// Invalid host configuration.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ServiceHostConfigError {
    Transport(TransportConfigError),
    ZeroApplicationPayload,
    ZeroPollInterval,
    ZeroMaxRequests,
    ZeroDispatchWorkers,
    ZeroDispatchCapacity,
    ZeroMaintenanceInterval,
}

impl fmt::Display for ServiceHostConfigError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Transport(error) => error.fmt(formatter),
            Self::ZeroApplicationPayload => {
                formatter.write_str("application payload limit must be positive")
            }
            Self::ZeroPollInterval => formatter.write_str("host poll interval must be positive"),
            Self::ZeroMaxRequests => formatter.write_str("maximum request count must be positive"),
            Self::ZeroDispatchWorkers => {
                formatter.write_str("dispatch worker count must be positive")
            }
            Self::ZeroDispatchCapacity => {
                formatter.write_str("dispatch queue capacity must be positive")
            }
            Self::ZeroMaintenanceInterval => {
                formatter.write_str("maintenance interval must be positive")
            }
        }
    }
}

impl std::error::Error for ServiceHostConfigError {}

/// Why a host loop stopped.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ServiceHostExit {
    Shutdown,
    RequestLimit,
}

/// Process-side facts from one host lifetime.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ServiceHostReport {
    exit: ServiceHostExit,
    served_requests: usize,
    recoverable_errors: usize,
    recovery: RecoveryReport,
}

/// Non-blocking hooks for application-owned recovery and timer work.
///
/// Hooks run on a dedicated maintenance thread. They are intentionally
/// storage-neutral: an adapter may use them to sweep deadlines, reconcile
/// process state, or publish notifications, but the service does not inspect
/// application records or decide lifecycle policy.
pub trait ServiceHostHooks: Send + Sync + 'static {
    fn on_recovery(&self, _report: &RecoveryReport) {}

    fn on_timer(&self) {}
}

#[derive(Clone, Debug)]
struct ProjectLeaseConfig {
    runtime_dir: PathBuf,
    project_id: String,
    owner_id: String,
}

impl ServiceHostReport {
    pub const fn exit(&self) -> ServiceHostExit {
        self.exit
    }

    pub const fn served_requests(&self) -> usize {
        self.served_requests
    }

    pub const fn recoverable_errors(&self) -> usize {
        self.recoverable_errors
    }

    pub const fn recovery(&self) -> &RecoveryReport {
        &self.recovery
    }
}

/// Errors that prevent a host from starting or keep its listener from
/// continuing to accept clients.
#[derive(Debug)]
pub enum ServiceHostError {
    Config(ServiceHostConfigError),
    Transport(TransportError),
    Dispatch(crate::QueueConfigError),
    Recovery(RecoveryBackendError),
    RecoveryJournal(crate::OperationError),
    Election(crate::ElectionError),
    ThreadPanic,
}

impl fmt::Display for ServiceHostError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Config(error) => error.fmt(formatter),
            Self::Transport(error) => error.fmt(formatter),
            Self::Dispatch(error) => error.fmt(formatter),
            Self::Recovery(error) => error.fmt(formatter),
            Self::RecoveryJournal(error) => error.fmt(formatter),
            Self::Election(error) => error.fmt(formatter),
            Self::ThreadPanic => formatter.write_str("service host thread panicked"),
        }
    }
}

impl std::error::Error for ServiceHostError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Config(error) => Some(error),
            Self::Transport(error) => Some(error),
            Self::Dispatch(error) => Some(error),
            Self::Recovery(error) => Some(error),
            Self::RecoveryJournal(error) => Some(error),
            Self::Election(error) => Some(error),
            Self::ThreadPanic => None,
        }
    }
}

/// A bound local service endpoint before it is started.
pub struct ServiceHost<H> {
    server: UnixSocketServer,
    route: ApplicationRoute<H>,
    config: ServiceHostConfig,
    shutdown: Arc<AtomicBool>,
    recovery: OperationRecovery,
    recovery_backend: Option<Arc<dyn RecoveryBackend>>,
    hooks: Option<Arc<dyn ServiceHostHooks>>,
    project_lease: Option<ProjectLeaseConfig>,
    election: Option<ProjectElection>,
}

impl<H> ServiceHost<H> {
    pub fn bind(
        path: impl AsRef<Path>,
        handler: H,
        config: ServiceHostConfig,
    ) -> Result<Self, ServiceHostError> {
        config.validate().map_err(ServiceHostError::Config)?;
        let server = UnixSocketServer::bind(path, config.transport.clone())
            .map_err(ServiceHostError::Transport)?;
        Ok(Self {
            server,
            route: ApplicationRoute::with_config(handler, config.application),
            config,
            shutdown: Arc::new(AtomicBool::new(false)),
            recovery: OperationRecovery::new(),
            recovery_backend: None,
            hooks: None,
            project_lease: None,
            election: None,
        })
    }

    pub fn socket_path(&self) -> &Path {
        self.server.socket_path()
    }

    pub fn config(&self) -> &ServiceHostConfig {
        &self.config
    }

    pub fn with_recovery(mut self, recovery: OperationRecovery) -> Self {
        self.recovery = recovery;
        self
    }

    pub fn recovery(&self) -> OperationRecovery {
        self.recovery.clone()
    }

    /// Attach the application's durable operation projection. It is hydrated
    /// and reconciled before the listener accepts requests.
    pub fn with_recovery_backend<B>(mut self, backend: B) -> Self
    where
        B: RecoveryBackend,
    {
        self.recovery_backend = Some(Arc::new(backend));
        self
    }

    /// Attach short, non-blocking maintenance hooks for timer and recovery
    /// integration. Hooks never run on the accept or application worker path.
    pub fn with_hooks<T>(mut self, hooks: T) -> Self
    where
        T: ServiceHostHooks,
    {
        self.hooks = Some(Arc::new(hooks));
        self
    }

    /// Configure canonical project ownership for this host. The caller must
    /// derive `project_id` from the same canonical project/database identity
    /// used by every service instance; socket paths are not an identity.
    pub fn with_project_election(
        mut self,
        runtime_dir: impl Into<PathBuf>,
        project_id: impl Into<String>,
        owner_id: impl Into<String>,
    ) -> Self {
        self.project_lease = Some(ProjectLeaseConfig {
            runtime_dir: runtime_dir.into(),
            project_id: project_id.into(),
            owner_id: owner_id.into(),
        });
        self
    }

    fn prepare_start(&mut self) -> Result<RecoveryReport, ServiceHostError> {
        if let Some(backend) = &self.recovery_backend {
            let entries = backend
                .load_incomplete()
                .map_err(ServiceHostError::Recovery)?;
            self.recovery
                .hydrate(entries)
                .map_err(ServiceHostError::RecoveryJournal)?;
        }
        let report = self.recovery.recover();
        if let Some(backend) = &self.recovery_backend {
            for operation_id in &report.unknown {
                backend
                    .mark_unknown(operation_id)
                    .map_err(ServiceHostError::Recovery)?;
            }
        }
        if let Some(lease) = &self.project_lease {
            self.election = Some(
                ProjectElection::try_acquire(
                    &lease.runtime_dir,
                    lease.project_id.clone(),
                    lease.owner_id.clone(),
                )
                .map_err(ServiceHostError::Election)?,
            );
        }
        Ok(report)
    }

    /// Start the bounded host loop on one dedicated thread.
    pub fn start(self) -> Result<ServiceHostHandle, ServiceHostError>
    where
        H: ApplicationCommandHandler + Send + 'static,
    {
        let mut host = self;
        let recovery_report = host.prepare_start()?;
        host.server
            .set_nonblocking(true)
            .map_err(ServiceHostError::Transport)?;
        let shutdown = Arc::clone(&host.shutdown);
        let thread_shutdown = Arc::clone(&shutdown);
        let socket_path = host.server.socket_path().to_owned();
        let hooks = host.hooks.clone();
        let maintenance_interval = host.config.maintenance_interval;
        let join = thread::Builder::new()
            .name("boreal-service-host".to_owned())
            .spawn(move || {
                host.run_loop(
                    thread_shutdown,
                    recovery_report,
                    hooks,
                    maintenance_interval,
                )
            })
            .map_err(|error| ServiceHostError::Transport(TransportError::Io(error)))?;
        Ok(ServiceHostHandle {
            shutdown,
            socket_path,
            join: Some(join),
        })
    }

    /// Start a bounded concurrent host for handlers that are explicitly safe
    /// to invoke through shared references. The legacy [`Self::start`] API
    /// remains request-at-a-time for existing mutable adapters.
    pub fn start_concurrent(self) -> Result<ServiceHostHandle, ServiceHostError>
    where
        H: ConcurrentApplicationCommandHandler,
    {
        let mut host = self;
        let recovery_report = host.prepare_start()?;
        host.server
            .set_nonblocking(true)
            .map_err(ServiceHostError::Transport)?;
        let shutdown = Arc::clone(&host.shutdown);
        let thread_shutdown = Arc::clone(&shutdown);
        let socket_path = host.server.socket_path().to_owned();
        let hooks = host.hooks.clone();
        let maintenance_interval = host.config.maintenance_interval;
        let join = thread::Builder::new()
            .name("boreal-service-host".to_owned())
            .spawn(move || {
                host.run_concurrent_loop(
                    thread_shutdown,
                    recovery_report,
                    hooks,
                    maintenance_interval,
                )
            })
            .map_err(|error| ServiceHostError::Transport(TransportError::Io(error)))?;
        Ok(ServiceHostHandle {
            shutdown,
            socket_path,
            join: Some(join),
        })
    }

    fn run_loop(
        mut self,
        shutdown: Arc<AtomicBool>,
        recovery: RecoveryReport,
        hooks: Option<Arc<dyn ServiceHostHooks>>,
        maintenance_interval: Duration,
    ) -> Result<ServiceHostReport, ServiceHostError>
    where
        H: ApplicationCommandHandler,
    {
        let mut report = ServiceHostReport {
            exit: ServiceHostExit::Shutdown,
            served_requests: 0,
            recoverable_errors: 0,
            recovery,
        };
        let maintenance = MaintenanceWorker::spawn(
            Arc::clone(&shutdown),
            hooks,
            maintenance_interval,
            report.recovery.clone(),
        );
        loop {
            if shutdown.load(Ordering::Acquire) {
                report.exit = ServiceHostExit::Shutdown;
                break;
            }
            if self
                .config
                .max_requests
                .is_some_and(|limit| report.served_requests >= limit)
            {
                report.exit = ServiceHostExit::RequestLimit;
                break;
            }
            match self
                .server
                .try_serve_once(|request| self.route.dispatch(request))
            {
                Ok(ServeOnceOutcome::Served) => report.served_requests += 1,
                Ok(ServeOnceOutcome::WouldBlock) => thread::sleep(self.config.poll_interval),
                Err(TransportError::Accept(error)) => {
                    shutdown.store(true, Ordering::Release);
                    maintenance.join();
                    return Err(ServiceHostError::Transport(TransportError::Accept(error)));
                }
                Err(_) => {
                    // A request-side framing, protocol, timeout, or write
                    // failure belongs to that client. Drop that connection
                    // and keep the long-lived listener available.
                    report.recoverable_errors += 1;
                }
            }
        }
        shutdown.store(true, Ordering::Release);
        maintenance.join();
        Ok(report)
    }

    fn run_concurrent_loop(
        self,
        shutdown: Arc<AtomicBool>,
        recovery: RecoveryReport,
        hooks: Option<Arc<dyn ServiceHostHooks>>,
        maintenance_interval: Duration,
    ) -> Result<ServiceHostReport, ServiceHostError>
    where
        H: ConcurrentApplicationCommandHandler,
    {
        let mut report = ServiceHostReport {
            exit: ServiceHostExit::Shutdown,
            served_requests: 0,
            recoverable_errors: 0,
            recovery,
        };
        let maintenance = MaintenanceWorker::spawn(
            Arc::clone(&shutdown),
            hooks,
            maintenance_interval,
            report.recovery.clone(),
        );
        let route = Arc::new(self.route);
        let mut dispatch = ConcurrentDispatch::new(
            route,
            self.recovery.clone(),
            self.config.dispatch_workers,
            self.config.dispatch_capacity,
        )
        .map_err(ServiceHostError::Dispatch)?;
        let mut stop_accepting = false;
        loop {
            if shutdown.load(Ordering::Acquire) {
                break;
            }
            if self
                .config
                .max_requests
                .is_some_and(|limit| report.served_requests >= limit)
            {
                report.exit = ServiceHostExit::RequestLimit;
                stop_accepting = true;
            }
            if stop_accepting {
                break;
            }
            match self.server.try_accept() {
                Ok(Some(mut connection)) => {
                    let request = match connection.read_request() {
                        Ok(request) => request,
                        Err(_) => {
                            report.recoverable_errors += 1;
                            continue;
                        }
                    };
                    match dispatch.try_submit(request, connection) {
                        Ok(()) => report.served_requests += 1,
                        Err(outcome) => {
                            report.recoverable_errors += 1;
                            let error = outcome
                                .error
                                .or_else(|| outcome.busy.map(crate::ProtocolError::with_busy));
                            if let Some(error) = error {
                                let _ = outcome
                                    .connection
                                    .write_protocol_error(&outcome.request_id, error);
                            }
                        }
                    }
                }
                Ok(None) => thread::sleep(self.config.poll_interval),
                Err(TransportError::Accept(error)) => {
                    dispatch.shutdown();
                    shutdown.store(true, Ordering::Release);
                    maintenance.join();
                    return Err(ServiceHostError::Transport(TransportError::Accept(error)));
                }
                Err(_) => report.recoverable_errors += 1,
            }
        }
        dispatch.shutdown();
        shutdown.store(true, Ordering::Release);
        maintenance.join();
        Ok(report)
    }
}

struct DispatchJob {
    request: crate::JsonRequest,
    connection: UnixSocketConnection,
    operation_id: String,
}

struct DispatchReject {
    connection: UnixSocketConnection,
    request_id: String,
    error: Option<crate::ProtocolError>,
    busy: Option<crate::BusyOutcome>,
}

struct ConcurrentDispatch<H> {
    queue: Arc<FairWriterQueue<DispatchJob>>,
    workers: Vec<JoinHandle<()>>,
    route: Arc<ApplicationRoute<H>>,
    recovery: OperationRecovery,
}

impl<H> ConcurrentDispatch<H>
where
    H: ConcurrentApplicationCommandHandler,
{
    fn new(
        route: Arc<ApplicationRoute<H>>,
        recovery: OperationRecovery,
        worker_count: usize,
        capacity: usize,
    ) -> Result<Self, crate::QueueConfigError> {
        let queue = Arc::new(FairWriterQueue::<DispatchJob>::with_capacity(capacity)?);
        let workers = (0..worker_count)
            .map(|index| {
                let queue = Arc::clone(&queue);
                let route = Arc::clone(&route);
                let recovery = recovery.clone();
                thread::Builder::new()
                    .name(format!("boreal-service-dispatch-{index}"))
                    .spawn(move || {
                        while let Some(job) = queue.pop() {
                            let job = job.into_inner();
                            recovery.mark_in_flight(&job.operation_id);
                            let request_id = job.request.request_id().to_owned();
                            let result =
                                std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                                    route.dispatch_concurrent(job.request)
                                }));
                            match result {
                                Ok(Ok(response)) => {
                                    recovery.mark_committed(&job.operation_id, None);
                                    if job.connection.write_response(&response).is_err() {
                                        recovery.mark_unknown(&job.operation_id);
                                    }
                                }
                                Ok(Err(error)) => {
                                    recovery.mark_failed(&job.operation_id);
                                    let _ = job.connection.write_protocol_error(&request_id, error);
                                }
                                Err(_) => {
                                    recovery.mark_failed(&job.operation_id);
                                    let _ = job.connection.write_protocol_error(
                                        &request_id,
                                        crate::ProtocolError::new(
                                            crate::ProtocolErrorCode::InvalidPayload,
                                            "application handler panicked",
                                        ),
                                    );
                                }
                            }
                        }
                    })
                    .expect("service dispatch worker thread can be created")
            })
            .collect();
        Ok(Self {
            queue,
            workers,
            route,
            recovery,
        })
    }

    // A rejection owns the accepted stream so the caller can return a
    // correlated busy/protocol response. Boxing it would not materially
    // improve the bounded queue path and would complicate ownership recovery.
    #[allow(clippy::result_large_err)]
    fn try_submit(
        &self,
        request: crate::JsonRequest,
        connection: UnixSocketConnection,
    ) -> Result<(), DispatchReject> {
        let operation_id = match self.route.operation_id_for(&request) {
            Ok(operation_id) => operation_id,
            Err(error) => {
                return Err(DispatchReject {
                    connection,
                    request_id: request.request_id().to_owned(),
                    error: Some(error),
                    busy: None,
                })
            }
        };
        if let Err(error) = self.recovery.register(operation_id.clone()) {
            let error = match error {
                crate::OperationError::Duplicate(record) => crate::ProtocolError::new(
                    crate::ProtocolErrorCode::InvalidField,
                    format!(
                        "operation {:?} is already in phase {:?}",
                        record.operation_id(),
                        record.phase()
                    ),
                ),
                crate::OperationError::InvalidId
                | crate::OperationError::HydrationConflict { .. } => crate::ProtocolError::new(
                    crate::ProtocolErrorCode::InvalidField,
                    "operation ID cannot be admitted",
                ),
            };
            return Err(DispatchReject {
                connection,
                request_id: request.request_id().to_owned(),
                error: Some(error),
                busy: None,
            });
        }
        if let Err((error, job)) = self.queue.try_push_recoverable(DispatchJob {
            request,
            connection,
            operation_id: operation_id.clone(),
        }) {
            self.recovery.remove(&operation_id);
            let busy = match error {
                EnqueueError::Busy(crate::BusyOutcome::WriterQueueFull {
                    capacity,
                    depth,
                    retry_after_ms,
                }) => crate::BusyOutcome::DispatchQueueFull {
                    capacity,
                    depth,
                    retry_after_ms,
                },
                EnqueueError::Busy(outcome) => outcome,
                EnqueueError::Closed | EnqueueError::TicketExhausted => {
                    crate::BusyOutcome::DispatchQueueFull {
                        capacity: self.queue.capacity(),
                        depth: self.queue.len(),
                        retry_after_ms: 1,
                    }
                }
            };
            return Err(DispatchReject {
                request_id: job.request.request_id().to_owned(),
                connection: job.connection,
                error: None,
                busy: Some(busy),
            });
        }
        Ok(())
    }

    fn shutdown(&mut self) {
        self.queue.close();
        for worker in self.workers.drain(..) {
            let _ = worker.join();
        }
    }
}

struct MaintenanceWorker {
    join: Option<JoinHandle<()>>,
}

impl MaintenanceWorker {
    fn spawn(
        shutdown: Arc<AtomicBool>,
        hooks: Option<Arc<dyn ServiceHostHooks>>,
        interval: Duration,
        recovery: RecoveryReport,
    ) -> Self {
        let Some(hooks) = hooks else {
            return Self { join: None };
        };
        let join = thread::Builder::new()
            .name("boreal-service-maintenance".to_owned())
            .spawn(move || {
                hooks.on_recovery(&recovery);
                // Perform one deterministic startup sweep before waiting for
                // the periodic interval. Short-lived hosts and request-limited
                // test/process modes must not skip expiry reconciliation just
                // because their first request arrives immediately.
                hooks.on_timer();
                while !shutdown.load(Ordering::Acquire) {
                    thread::sleep(interval);
                    if !shutdown.load(Ordering::Acquire) {
                        hooks.on_timer();
                    }
                }
            })
            .expect("service maintenance thread can be created");
        Self { join: Some(join) }
    }

    fn join(mut self) {
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}

/// Control and join handle for a running [`ServiceHost`].
pub struct ServiceHostHandle {
    shutdown: Arc<AtomicBool>,
    socket_path: PathBuf,
    join: Option<JoinHandle<Result<ServiceHostReport, ServiceHostError>>>,
}

impl ServiceHostHandle {
    pub fn shutdown(&self) {
        self.shutdown.store(true, Ordering::Release);
    }

    pub fn is_shutdown_requested(&self) -> bool {
        self.shutdown.load(Ordering::Acquire)
    }

    pub fn socket_path(&self) -> &Path {
        &self.socket_path
    }

    pub fn join(mut self) -> Result<ServiceHostReport, ServiceHostError> {
        let join = self.join.take().expect("host join handle is present");
        join.join().unwrap_or(Err(ServiceHostError::ThreadPanic))
    }
}

impl Drop for ServiceHostHandle {
    fn drop(&mut self) {
        self.shutdown();
        if let Some(join) = self.join.take() {
            if join.thread().id() != thread::current().id() {
                let _ = join.join();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        ApplicationRequest, ApplicationResponse, ConcurrentApplicationCommandHandler, JsonRequest,
        OperationPhase, ProtocolError, RecoveryBackend, RecoveryBackendError, RecoveryEntry,
        ServiceHostHooks, TransportError, UnixSocketClient, APPLICATION_API_VERSION,
        APPLICATION_SCHEMA_VERSION,
    };
    use std::io;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Barrier, Mutex,
    };
    use std::thread;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    #[derive(Clone, Default)]
    struct CountingHandler {
        seen: Arc<Mutex<Vec<String>>>,
    }

    impl ApplicationCommandHandler for CountingHandler {
        fn handle(
            &mut self,
            request: ApplicationRequest,
        ) -> Result<ApplicationResponse, ProtocolError> {
            self.seen.lock().unwrap().push(request.request_id.clone());
            Ok(ApplicationResponse {
                api_version: APPLICATION_API_VERSION.to_owned(),
                schema_version: APPLICATION_SCHEMA_VERSION.to_owned(),
                operation_id: request.operation_id,
                data: format!(r#"{{"command":"{}","ok":true}}"#, request.command),
            })
        }
    }

    #[derive(Clone)]
    struct SlowConcurrentHandler {
        entered: Arc<Barrier>,
        release: Arc<Barrier>,
        calls: Arc<AtomicUsize>,
    }

    impl ConcurrentApplicationCommandHandler for SlowConcurrentHandler {
        fn handle_concurrent(
            &self,
            request: ApplicationRequest,
        ) -> Result<ApplicationResponse, ProtocolError> {
            self.calls.fetch_add(1, Ordering::Relaxed);
            if request.command == "slow" {
                self.entered.wait();
                self.release.wait();
            }
            Ok(ApplicationResponse {
                api_version: APPLICATION_API_VERSION.to_owned(),
                schema_version: APPLICATION_SCHEMA_VERSION.to_owned(),
                operation_id: request.operation_id,
                data: format!(r#"{{"command":"{}","ok":true}}"#, request.command),
            })
        }
    }

    #[derive(Clone, Default)]
    struct TestRecoveryBackend {
        entries: Arc<Mutex<Vec<RecoveryEntry>>>,
        unknown: Arc<Mutex<Vec<String>>>,
    }

    impl RecoveryBackend for TestRecoveryBackend {
        fn load_incomplete(&self) -> Result<Vec<RecoveryEntry>, RecoveryBackendError> {
            Ok(self.entries.lock().unwrap().clone())
        }

        fn mark_unknown(&self, operation_id: &str) -> Result<(), RecoveryBackendError> {
            self.unknown.lock().unwrap().push(operation_id.to_owned());
            Ok(())
        }
    }

    #[derive(Clone, Default)]
    struct TestHooks {
        recovered: Arc<AtomicUsize>,
        ticks: Arc<AtomicUsize>,
    }

    impl ServiceHostHooks for TestHooks {
        fn on_recovery(&self, _report: &crate::RecoveryReport) {
            self.recovered.fetch_add(1, Ordering::Relaxed);
        }

        fn on_timer(&self) {
            self.ticks.fetch_add(1, Ordering::Relaxed);
        }
    }

    fn socket_path(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock is after Unix epoch")
            .as_nanos();
        PathBuf::from(format!("/private/tmp/boreal-service-{label}-{nonce}.sock"))
    }

    fn request(id: &str, operation_id: &str) -> JsonRequest {
        request_command(id, operation_id, "status")
    }

    fn request_command(id: &str, operation_id: &str, command: &str) -> JsonRequest {
        JsonRequest::new(
            id,
            format!(
                r#"{{"api_version":"{APPLICATION_API_VERSION}","schema_version":"{APPLICATION_SCHEMA_VERSION}","operation_id":"{operation_id}","data":{{"command":"{command}"}}}}"#
            ),
        )
        .unwrap()
    }

    fn bind_or_skip<H>(
        path: &Path,
        handler: H,
        config: ServiceHostConfig,
    ) -> Option<ServiceHost<H>> {
        match ServiceHost::bind(path, handler, config) {
            Ok(host) => Some(host),
            Err(ServiceHostError::Transport(TransportError::Io(error)))
                if error.kind() == io::ErrorKind::PermissionDenied =>
            {
                None
            }
            Err(error) => panic!("host bind failed: {error}"),
        }
    }

    fn client_or_skip(path: &Path) -> Option<UnixSocketClient> {
        match UnixSocketClient::connect(path, TransportConfig::default()) {
            Ok(client) => Some(client),
            Err(TransportError::Io(error)) if error.kind() == io::ErrorKind::PermissionDenied => {
                None
            }
            Err(error) => panic!("client connect failed: {error}"),
        }
    }

    #[test]
    fn host_serves_one_correlated_versioned_request() {
        let path = socket_path("one");
        let seen = Arc::new(Mutex::new(Vec::new()));
        let handler = CountingHandler {
            seen: Arc::clone(&seen),
        };
        let config = ServiceHostConfig::default()
            .with_max_requests(Some(1))
            .unwrap();
        let Some(host) = bind_or_skip(&path, handler, config) else {
            return;
        };
        let running = host.start().unwrap();
        let Some(mut client) = client_or_skip(&path) else {
            running.shutdown();
            let _ = running.join();
            return;
        };
        let response = client
            .request(request("correlation-one", "op_one"))
            .unwrap();
        assert_eq!(response.request_id(), "correlation-one");
        assert!(response.payload().unwrap().contains("\"ok\":true"));
        let report = running.join().unwrap();
        assert_eq!(report.exit(), ServiceHostExit::RequestLimit);
        assert_eq!(report.served_requests(), 1);
        assert_eq!(&*seen.lock().unwrap(), &["correlation-one"]);
    }

    #[test]
    fn host_accepts_multiple_clients_without_unbounded_workers() {
        let path = socket_path("multiple");
        let seen = Arc::new(Mutex::new(Vec::new()));
        let handler = CountingHandler {
            seen: Arc::clone(&seen),
        };
        let config = ServiceHostConfig::default()
            .with_max_requests(Some(3))
            .unwrap();
        let Some(host) = bind_or_skip(&path, handler, config) else {
            return;
        };
        let running = host.start().unwrap();
        for index in 0..3 {
            let Some(mut client) = client_or_skip(&path) else {
                return;
            };
            let id = format!("correlation-{index}");
            let operation = format!("op_multiple_{index}");
            let response = client.request(request(&id, &operation)).unwrap();
            assert_eq!(response.request_id(), id);
        }
        let report = running.join().unwrap();
        assert_eq!(report.exit(), ServiceHostExit::RequestLimit);
        assert_eq!(report.served_requests(), 3);
        assert_eq!(seen.lock().unwrap().len(), 3);
    }

    #[test]
    fn shutdown_stops_idle_host_and_removes_endpoint() {
        let path = socket_path("shutdown");
        let Some(host) = bind_or_skip(
            &path,
            CountingHandler::default(),
            ServiceHostConfig::default(),
        ) else {
            return;
        };
        let running = host.start().unwrap();
        assert!(!running.is_shutdown_requested());
        running.shutdown();
        assert!(running.is_shutdown_requested());
        let report = running.join().unwrap();
        assert_eq!(report.exit(), ServiceHostExit::Shutdown);
        assert!(!path.exists());
    }

    #[test]
    fn restart_rebinds_endpoint_and_reports_in_flight_recovery() {
        let path = socket_path("restart");
        let recovery = OperationRecovery::new();
        recovery.register("op_recovered").unwrap();
        recovery.mark_in_flight("op_recovered");
        let config = ServiceHostConfig::default()
            .with_max_requests(Some(1))
            .unwrap();
        let Some(host) = bind_or_skip(&path, CountingHandler::default(), config.clone()) else {
            return;
        };
        let running = host.with_recovery(recovery.clone()).start().unwrap();
        {
            let Some(mut client) = client_or_skip(&path) else {
                return;
            };
            client
                .request(request("correlation-first", "op_first"))
                .unwrap();
        }
        let report = running.join().unwrap();
        assert_eq!(report.recovery().unknown, vec!["op_recovered"]);
        assert!(!path.exists());

        let Some(restarted) = bind_or_skip(&path, CountingHandler::default(), config) else {
            return;
        };
        let running = restarted.with_recovery(recovery).start().unwrap();
        let Some(mut client) = client_or_skip(&path) else {
            return;
        };
        let response = client
            .request(request("correlation-second", "op_second"))
            .unwrap();
        assert_eq!(response.request_id(), "correlation-second");
        let report = running.join().unwrap();
        assert_eq!(report.exit(), ServiceHostExit::RequestLimit);
        assert_eq!(report.served_requests(), 1);
    }

    #[test]
    fn concurrent_host_keeps_status_responsive_while_handler_is_slow() {
        let path = socket_path("concurrent-slow");
        let entered = Arc::new(Barrier::new(2));
        let release = Arc::new(Barrier::new(2));
        let calls = Arc::new(AtomicUsize::new(0));
        let handler = SlowConcurrentHandler {
            entered: Arc::clone(&entered),
            release: Arc::clone(&release),
            calls: Arc::clone(&calls),
        };
        let config = ServiceHostConfig::default()
            .with_dispatch_workers(2)
            .unwrap()
            .with_dispatch_capacity(2)
            .unwrap();
        let Some(host) = bind_or_skip(&path, handler, config) else {
            return;
        };
        let running = host.start_concurrent().unwrap();
        let slow_path = path.clone();
        let slow = thread::spawn(move || {
            let mut client =
                UnixSocketClient::connect(&slow_path, TransportConfig::default()).unwrap();
            client.request(request_command("slow-request", "op_slow", "slow"))
        });
        entered.wait();

        let started = std::time::Instant::now();
        let mut status = client_or_skip(&path).expect("status client connects");
        let response = status
            .request(request("status-request", "op_status"))
            .unwrap();
        assert!(started.elapsed() < Duration::from_millis(100));
        assert!(response.payload().unwrap().contains("\"status\""));

        release.wait();
        slow.join().unwrap().unwrap();
        assert_eq!(calls.load(Ordering::Relaxed), 2);
        running.shutdown();
        let report = running.join().unwrap();
        assert_eq!(report.served_requests(), 2);
    }

    #[test]
    fn concurrent_dispatch_queue_returns_structured_busy_without_dropping_correlation() {
        let path = socket_path("concurrent-busy");
        let entered = Arc::new(Barrier::new(2));
        let release = Arc::new(Barrier::new(2));
        let handler = SlowConcurrentHandler {
            entered: Arc::clone(&entered),
            release: Arc::clone(&release),
            calls: Arc::new(AtomicUsize::new(0)),
        };
        let config = ServiceHostConfig::default()
            .with_dispatch_workers(1)
            .unwrap()
            .with_dispatch_capacity(1)
            .unwrap();
        let Some(host) = bind_or_skip(&path, handler, config) else {
            return;
        };
        let running = host.start_concurrent().unwrap();
        let slow_path = path.clone();
        let slow = thread::spawn(move || {
            let mut client =
                UnixSocketClient::connect(&slow_path, TransportConfig::default()).unwrap();
            client.request(request_command("slow-request", "op_slow_busy", "slow"))
        });
        entered.wait();
        let queued_path = path.clone();
        let queued = thread::spawn(move || {
            let mut client =
                UnixSocketClient::connect(&queued_path, TransportConfig::default()).unwrap();
            client.request(request("queued-request", "op_queued"))
        });
        thread::sleep(Duration::from_millis(20));

        let mut busy_client = client_or_skip(&path).expect("busy client connects");
        let error = busy_client
            .request(request("busy-request", "op_busy"))
            .unwrap_err();
        match error {
            TransportError::RemoteProtocol(error) => {
                assert_eq!(error.code(), crate::ProtocolErrorCode::Busy);
                assert_eq!(
                    error.busy_outcome(),
                    Some(&crate::BusyOutcome::DispatchQueueFull {
                        capacity: 1,
                        depth: 1,
                        retry_after_ms: 1,
                    })
                );
            }
            other => panic!("expected typed dispatch busy response, got {other:?}"),
        }

        release.wait();
        slow.join().unwrap().unwrap();
        queued.join().unwrap().unwrap();
        running.shutdown();
        running.join().unwrap();
    }

    #[test]
    fn host_hydrates_durable_operations_and_marks_in_flight_unknown_before_serving() {
        let path = socket_path("durable-recovery");
        let backend = TestRecoveryBackend {
            entries: Arc::new(Mutex::new(vec![
                RecoveryEntry::new("op_queued", OperationPhase::Queued, None),
                RecoveryEntry::new("op_in_flight", OperationPhase::InFlight, None),
            ])),
            unknown: Arc::new(Mutex::new(Vec::new())),
        };
        let hooks = TestHooks::default();
        let config = ServiceHostConfig::default()
            .with_max_requests(Some(1))
            .unwrap()
            .with_maintenance_interval(Duration::from_millis(1))
            .unwrap();
        let Some(host) = bind_or_skip(&path, CountingHandler::default(), config) else {
            return;
        };
        let running = host
            .with_recovery_backend(backend.clone())
            .with_hooks(hooks.clone())
            .start()
            .unwrap();
        let mut client = client_or_skip(&path).expect("recovery host accepts requests");
        client
            .request(request("recovery-request", "op_recovery_probe"))
            .unwrap();
        let report = running.join().unwrap();
        assert_eq!(report.recovery().queued, vec!["op_queued"]);
        assert_eq!(report.recovery().unknown, vec!["op_in_flight"]);
        assert_eq!(&*backend.unknown.lock().unwrap(), &["op_in_flight"]);
        assert_eq!(hooks.recovered.load(Ordering::Relaxed), 1);
        assert!(hooks.ticks.load(Ordering::Relaxed) > 0);
    }

    #[test]
    fn hosts_with_different_socket_paths_still_elect_one_canonical_project_owner() {
        let runtime =
            std::env::temp_dir().join(format!("boreal-service-host-election-{}", now_nanos()));
        let first_path = socket_path("election-first");
        let second_path = socket_path("election-second");
        let config = ServiceHostConfig::default();
        let Some(first) = bind_or_skip(&first_path, CountingHandler::default(), config.clone())
        else {
            return;
        };
        let first = first
            .with_project_election(&runtime, "canonical-project", "owner-a")
            .start()
            .unwrap();
        let second = ServiceHost::bind(&second_path, CountingHandler::default(), config)
            .unwrap()
            .with_project_election(&runtime, "canonical-project", "owner-b");
        match second.start() {
            Err(ServiceHostError::Election(crate::ElectionError::Busy(
                crate::BusyOutcome::ProjectAlreadyOwned { owner_id, .. },
            ))) => assert_eq!(owner_id.as_deref(), Some("owner-a")),
            other => panic!(
                "expected canonical election busy result, got an unexpected result: {}",
                if other.is_ok() { "ok" } else { "error" }
            ),
        }
        first.shutdown();
        first.join().unwrap();
        let _ = std::fs::remove_dir_all(runtime);
    }

    fn now_nanos() -> u128 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock is after Unix epoch")
            .as_nanos()
    }
}
