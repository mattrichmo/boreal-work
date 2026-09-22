# R-SERVICE-HOST — crates/service/src/host.rs

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `crates/service/src/host.rs:L1–L260`  
**File SHA-256:** `dc69ffc6ef5c3c6194c8c808a9cb37610de29869962d057762f54c705cfced04`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Production service host, writer boundary and response lifecycle.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,260p' 'crates/service/src/host.rs'
```

## Exact baseline excerpt

````text
    1 | //! Long-lived local service host.
    2 | //!
    3 | //! [`ServiceHost`] owns only the process boundary: a Unix listener, the
    4 | //! versioned [`ApplicationRoute`], and a bounded request loop. The application
    5 | //! supplies the [`ApplicationCommandHandler`]; this module intentionally does
    6 | //! not open SQLite or implement any business transition.
    7 | 
    8 | use crate::application_route::ConcurrentApplicationCommandHandler;
    9 | use crate::recovery::{RecoveryBackend, RecoveryBackendError, RecoveryDisposition, RecoveryEntry};
   10 | use crate::transport::UnixSocketConnection;
   11 | use crate::{
   12 |     ApplicationCommandHandler, ApplicationRoute, ApplicationRouteConfig, ControlError,
   13 |     ControlRecord, EnqueueError, OperationControl, OperationRecovery, PriorityQueue,
   14 |     ProjectElection, QueuePriority, RecoveryReport, ServeOnceOutcome, TimerRegistry,
   15 |     TransportConfig, TransportConfigError, TransportError, UnixSocketServer,
   16 | };
   17 | use std::fmt;
   18 | use std::path::{Path, PathBuf};
   19 | use std::sync::{
   20 |     atomic::{AtomicBool, Ordering},
   21 |     Arc,
   22 | };
   23 | use std::thread::{self, JoinHandle};
   24 | use std::time::Duration;
   25 | 
   26 | /// A conservative per-client timeout used when a host config does not supply
   27 | /// one. It ensures shutdown is observed even if a connected client stops
   28 | /// sending bytes.
   29 | pub const DEFAULT_HOST_IO_TIMEOUT: Duration = Duration::from_millis(100);
   30 | pub const DEFAULT_DISPATCH_WORKERS: usize = 4;
   31 | pub const DEFAULT_DISPATCH_CAPACITY: usize = 32;
   32 | pub const DEFAULT_MAINTENANCE_INTERVAL: Duration = Duration::from_secs(1);
   33 | 
   34 | /// Settings for a long-lived local host.
   35 | #[derive(Clone, Debug, Eq, PartialEq)]
   36 | pub struct ServiceHostConfig {
   37 |     transport: TransportConfig,
   38 |     application: ApplicationRouteConfig,
   39 |     poll_interval: Duration,
   40 |     max_requests: Option<usize>,
   41 |     dispatch_workers: usize,
   42 |     dispatch_capacity: usize,
   43 |     maintenance_interval: Duration,
   44 | }
   45 | 
   46 | impl Default for ServiceHostConfig {
   47 |     fn default() -> Self {
   48 |         Self::new(
   49 |             TransportConfig::default(),
   50 |             ApplicationRouteConfig::default(),
   51 |         )
   52 |         .expect("default service host configuration is valid")
   53 |     }
   54 | }
   55 | 
   56 | impl ServiceHostConfig {
   57 |     /// Construct a host config. Missing socket timeouts are filled with the
   58 |     /// bounded host default so shutdown cannot be held hostage by a client.
   59 |     pub fn new(
   60 |         mut transport: TransportConfig,
   61 |         application: ApplicationRouteConfig,
   62 |     ) -> Result<Self, ServiceHostConfigError> {
   63 |         transport
   64 |             .validate()
   65 |             .map_err(ServiceHostConfigError::Transport)?;
   66 |         if application.max_payload_size == 0 {
   67 |             return Err(ServiceHostConfigError::ZeroApplicationPayload);
   68 |         }
   69 |         if transport.read_timeout.is_none() {
   70 |             transport.read_timeout = Some(DEFAULT_HOST_IO_TIMEOUT);
   71 |         }
   72 |         if transport.write_timeout.is_none() {
   73 |             transport.write_timeout = Some(DEFAULT_HOST_IO_TIMEOUT);
   74 |         }
   75 |         Ok(Self {
   76 |             transport,
   77 |             application,
   78 |             poll_interval: Duration::from_millis(5),
   79 |             max_requests: None,
   80 |             dispatch_workers: DEFAULT_DISPATCH_WORKERS,
   81 |             dispatch_capacity: DEFAULT_DISPATCH_CAPACITY,
   82 |             maintenance_interval: DEFAULT_MAINTENANCE_INTERVAL,
   83 |         })
   84 |     }
   85 | 
   86 |     pub fn transport(&self) -> &TransportConfig {
   87 |         &self.transport
   88 |     }
   89 | 
   90 |     pub const fn application(&self) -> ApplicationRouteConfig {
   91 |         self.application
   92 |     }
   93 | 
   94 |     pub const fn poll_interval(&self) -> Duration {
   95 |         self.poll_interval
   96 |     }
   97 | 
   98 |     pub const fn max_requests(&self) -> Option<usize> {
   99 |         self.max_requests
  100 |     }
  101 | 
  102 |     pub const fn dispatch_workers(&self) -> usize {
  103 |         self.dispatch_workers
  104 |     }
  105 | 
  106 |     pub const fn dispatch_capacity(&self) -> usize {
  107 |         self.dispatch_capacity
  108 |     }
  109 | 
  110 |     pub const fn maintenance_interval(&self) -> Duration {
  111 |         self.maintenance_interval
  112 |     }
  113 | 
  114 |     pub fn with_poll_interval(
  115 |         mut self,
  116 |         poll_interval: Duration,
  117 |     ) -> Result<Self, ServiceHostConfigError> {
  118 |         if poll_interval.is_zero() {
  119 |             return Err(ServiceHostConfigError::ZeroPollInterval);
  120 |         }
  121 |         self.poll_interval = poll_interval;
  122 |         Ok(self)
  123 |     }
  124 | 
  125 |     pub fn with_max_requests(
  126 |         mut self,
  127 |         max_requests: Option<usize>,
  128 |     ) -> Result<Self, ServiceHostConfigError> {
  129 |         if max_requests == Some(0) {
  130 |             return Err(ServiceHostConfigError::ZeroMaxRequests);
  131 |         }
  132 |         self.max_requests = max_requests;
  133 |         Ok(self)
  134 |     }
  135 | 
  136 |     pub fn with_dispatch_workers(mut self, workers: usize) -> Result<Self, ServiceHostConfigError> {
  137 |         if workers == 0 {
  138 |             return Err(ServiceHostConfigError::ZeroDispatchWorkers);
  139 |         }
  140 |         self.dispatch_workers = workers;
  141 |         Ok(self)
  142 |     }
  143 | 
  144 |     pub fn with_dispatch_capacity(
  145 |         mut self,
  146 |         capacity: usize,
  147 |     ) -> Result<Self, ServiceHostConfigError> {
  148 |         if capacity == 0 {
  149 |             return Err(ServiceHostConfigError::ZeroDispatchCapacity);
  150 |         }
  151 |         self.dispatch_capacity = capacity;
  152 |         Ok(self)
  153 |     }
  154 | 
  155 |     pub fn with_maintenance_interval(
  156 |         mut self,
  157 |         interval: Duration,
  158 |     ) -> Result<Self, ServiceHostConfigError> {
  159 |         if interval.is_zero() {
  160 |             return Err(ServiceHostConfigError::ZeroMaintenanceInterval);
  161 |         }
  162 |         self.maintenance_interval = interval;
  163 |         Ok(self)
  164 |     }
  165 | 
  166 |     pub fn validate(&self) -> Result<(), ServiceHostConfigError> {
  167 |         self.transport
  168 |             .validate()
  169 |             .map_err(ServiceHostConfigError::Transport)?;
  170 |         if self.application.max_payload_size == 0 {
  171 |             return Err(ServiceHostConfigError::ZeroApplicationPayload);
  172 |         }
  173 |         if self.poll_interval.is_zero() {
  174 |             return Err(ServiceHostConfigError::ZeroPollInterval);
  175 |         }
  176 |         if self.max_requests == Some(0) {
  177 |             return Err(ServiceHostConfigError::ZeroMaxRequests);
  178 |         }
  179 |         if self.dispatch_workers == 0 {
  180 |             return Err(ServiceHostConfigError::ZeroDispatchWorkers);
  181 |         }
  182 |         if self.dispatch_capacity == 0 {
  183 |             return Err(ServiceHostConfigError::ZeroDispatchCapacity);
  184 |         }
  185 |         if self.maintenance_interval.is_zero() {
  186 |             return Err(ServiceHostConfigError::ZeroMaintenanceInterval);
  187 |         }
  188 |         Ok(())
  189 |     }
  190 | }
  191 | 
  192 | /// Invalid host configuration.
  193 | #[derive(Clone, Copy, Debug, Eq, PartialEq)]
  194 | pub enum ServiceHostConfigError {
  195 |     Transport(TransportConfigError),
  196 |     ZeroApplicationPayload,
  197 |     ZeroPollInterval,
  198 |     ZeroMaxRequests,
  199 |     ZeroDispatchWorkers,
  200 |     ZeroDispatchCapacity,
  201 |     ZeroMaintenanceInterval,
  202 | }
  203 | 
  204 | impl fmt::Display for ServiceHostConfigError {
  205 |     fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
  206 |         match self {
  207 |             Self::Transport(error) => error.fmt(formatter),
  208 |             Self::ZeroApplicationPayload => {
  209 |                 formatter.write_str("application payload limit must be positive")
  210 |             }
  211 |             Self::ZeroPollInterval => formatter.write_str("host poll interval must be positive"),
  212 |             Self::ZeroMaxRequests => formatter.write_str("maximum request count must be positive"),
  213 |             Self::ZeroDispatchWorkers => {
  214 |                 formatter.write_str("dispatch worker count must be positive")
  215 |             }
  216 |             Self::ZeroDispatchCapacity => {
  217 |                 formatter.write_str("dispatch queue capacity must be positive")
  218 |             }
  219 |             Self::ZeroMaintenanceInterval => {
  220 |                 formatter.write_str("maintenance interval must be positive")
  221 |             }
  222 |         }
  223 |     }
  224 | }
  225 | 
  226 | impl std::error::Error for ServiceHostConfigError {}
  227 | 
  228 | /// Why a host loop stopped.
  229 | #[derive(Clone, Copy, Debug, Eq, PartialEq)]
  230 | pub enum ServiceHostExit {
  231 |     Shutdown,
  232 |     RequestLimit,
  233 | }
  234 | 
  235 | /// Process-side facts from one host lifetime.
  236 | #[derive(Clone, Debug, Eq, PartialEq)]
  237 | pub struct ServiceHostReport {
  238 |     exit: ServiceHostExit,
  239 |     served_requests: usize,
  240 |     recoverable_errors: usize,
  241 |     recovery: RecoveryReport,
  242 | }
  243 | 
  244 | /// Non-blocking hooks for application-owned recovery and timer work.
  245 | ///
  246 | /// Hooks run on a dedicated maintenance thread. They are intentionally
  247 | /// storage-neutral: an adapter may use them to sweep deadlines, reconcile
  248 | /// process state, or publish notifications, but the service does not inspect
  249 | /// application records or decide lifecycle policy.
  250 | pub trait ServiceHostHooks: Send + Sync + 'static {
  251 |     fn on_recovery(&self, _report: &RecoveryReport) {}
  252 | 
  253 |     fn on_timer(&self) {}
  254 | 
  255 |     /// Called with timer keys whose registered deadline has elapsed. The
  256 |     /// application owns the durable reaper transaction and may safely ignore
  257 |     /// a duplicate callback after a crash because the key is only a wake-up
  258 |     /// hint, not proof that a lifecycle transition committed.
  259 |     fn on_deadlines(&self, _keys: &[String]) {}
  260 | 
````
