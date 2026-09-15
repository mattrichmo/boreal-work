//! Long-lived local service host.
//!
//! [`ServiceHost`] owns only the process boundary: a Unix listener, the
//! versioned [`ApplicationRoute`], and a bounded request loop. The application
//! supplies the [`ApplicationCommandHandler`]; this module intentionally does
//! not open SQLite or implement any business transition.

use crate::{
    ApplicationCommandHandler, ApplicationRoute, ApplicationRouteConfig, OperationRecovery,
    RecoveryReport, ServeOnceOutcome, TransportConfig, TransportConfigError, TransportError,
    UnixSocketServer,
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

/// Settings for a long-lived local host.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ServiceHostConfig {
    transport: TransportConfig,
    application: ApplicationRouteConfig,
    poll_interval: Duration,
    max_requests: Option<usize>,
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
    ThreadPanic,
}

impl fmt::Display for ServiceHostError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Config(error) => error.fmt(formatter),
            Self::Transport(error) => error.fmt(formatter),
            Self::ThreadPanic => formatter.write_str("service host thread panicked"),
        }
    }
}

impl std::error::Error for ServiceHostError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Config(error) => Some(error),
            Self::Transport(error) => Some(error),
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

    /// Start the bounded host loop on one dedicated thread.
    pub fn start(self) -> Result<ServiceHostHandle, ServiceHostError>
    where
        H: ApplicationCommandHandler + Send + 'static,
    {
        self.server
            .set_nonblocking(true)
            .map_err(ServiceHostError::Transport)?;
        let shutdown = Arc::clone(&self.shutdown);
        let thread_shutdown = Arc::clone(&shutdown);
        let recovery = self.recovery.clone();
        let recovery_report = recovery.recover();
        let socket_path = self.server.socket_path().to_owned();
        let join = thread::Builder::new()
            .name("boreal-service-host".to_owned())
            .spawn(move || self.run_loop(thread_shutdown, recovery_report))
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
                    return Err(ServiceHostError::Transport(TransportError::Accept(error)))
                }
                Err(_) => {
                    // A request-side framing, protocol, timeout, or write
                    // failure belongs to that client. Drop that connection
                    // and keep the long-lived listener available.
                    report.recoverable_errors += 1;
                }
            }
        }
        Ok(report)
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
        ApplicationRequest, ApplicationResponse, JsonRequest, ProtocolError, TransportError,
        UnixSocketClient, APPLICATION_API_VERSION, APPLICATION_SCHEMA_VERSION,
    };
    use std::io;
    use std::sync::{Arc, Mutex};
    use std::time::{SystemTime, UNIX_EPOCH};

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

    fn socket_path(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock is after Unix epoch")
            .as_nanos();
        PathBuf::from(format!("/private/tmp/boreal-service-{label}-{nonce}.sock"))
    }

    fn request(id: &str, operation_id: &str) -> JsonRequest {
        JsonRequest::new(
            id,
            format!(
                r#"{{"api_version":"{APPLICATION_API_VERSION}","schema_version":"{APPLICATION_SCHEMA_VERSION}","operation_id":"{operation_id}","data":{{"command":"status"}}}}"#
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
}
