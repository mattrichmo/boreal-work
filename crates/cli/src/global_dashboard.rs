//! Managed launcher for the separate global dashboard.

use super::*;
use std::io::IsTerminal;
static DASHBOARD_COUNTER: AtomicU64 = AtomicU64::new(0);
#[cfg(unix)]
use boreal_service::{JsonRequest, TransportConfig, UnixSocketClient};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

pub(crate) fn run_dashboard(
    parsed: &ParsedCommand,
    operation: &str,
) -> Result<CliResult, CliError> {
    if parsed.options.socket.is_some() {
        return Err(CliError::invalid(
            "global dashboard manages its own service; omit --socket",
        ));
    }
    if parsed.options.json {
        let snapshot = global_commands::snapshot_data(operation)?;
        return Ok(CliResult {
            outcome: ApplicationOutcome::Unchanged,
            revision: snapshot.get("revision").and_then(Value::as_u64),
            data: Some(snapshot),
            as_of: Some(global_commands::global_now_timestamp()),
            ..CliResult::default()
        });
    }
    if !std::io::stdin().is_terminal() || !std::io::stdout().is_terminal() {
        return Err(CliError::invalid(
            "global dashboard requires an interactive terminal; use `bwrk dashboard global --json` for a snapshot",
        ));
    }
    #[cfg(unix)]
    launch(parsed)?;
    #[cfg(not(unix))]
    return Err(CliError::with(
        ErrorCode::UnsupportedPlatform,
        ApplicationOutcome::Failed,
        "the global dashboard currently requires Unix-domain sockets",
    ));
    Ok(CliResult {
        outcome: ApplicationOutcome::Unchanged,
        ..CliResult::default()
    })
}

#[cfg(unix)]
fn launch(_parsed: &ParsedCommand) -> Result<(), CliError> {
    let _signals = signal::SignalGuard::install().map_err(|error| {
        CliError::with(
            ErrorCode::ServiceUnavailable,
            ApplicationOutcome::Failed,
            format!("cannot install global dashboard signal handlers: {error}"),
        )
    })?;
    global_commands::ensure_global_root()?;
    let tui_entrypoint = find_tui_entrypoint()?;
    let runtime = env::temp_dir().join(format!(
        "bg{}{}",
        std::process::id(),
        DASHBOARD_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        let mut builder = fs::DirBuilder::new();
        builder.mode(0o700);
        builder.create(&runtime).map_err(|error| {
            CliError::invalid(format!(
                "cannot create private global runtime directory: {error}"
            ))
        })?;
    }
    #[cfg(not(unix))]
    fs::create_dir_all(&runtime).map_err(|error| {
        CliError::invalid(format!("cannot create global runtime directory: {error}"))
    })?;
    #[cfg(unix)]
    fs::set_permissions(&runtime, fs::Permissions::from_mode(0o700)).map_err(|error| {
        CliError::invalid(format!("cannot secure global runtime directory: {error}"))
    })?;
    let socket = runtime.join("s");
    let executable = env::current_exe().map_err(|error| {
        CliError::with(
            ErrorCode::ServiceUnavailable,
            ApplicationOutcome::Failed,
            error.to_string(),
        )
    })?;
    let mut service = Command::new(&executable)
        .args(["global", "service", "run", "--socket"])
        .arg(&socket)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|error| {
            let _ = fs::remove_dir_all(&runtime);
            CliError::with(
                ErrorCode::ServiceUnavailable,
                ApplicationOutcome::Failed,
                format!("cannot start global service: {error}"),
            )
        })?;
    if let Err(error) = wait_until_ready(&socket, &mut service) {
        terminate_child(&mut service);
        let _ = fs::remove_dir_all(&runtime);
        return Err(error);
    }
    let tui = match tui_entrypoint {
        TuiEntrypoint::Executable(path) => Command::new(path)
            .env("BOREAL_DASHBOARD_BINARY", &executable)
            .arg("--socket")
            .arg(&socket)
            .arg("--interactive")
            .spawn(),
        TuiEntrypoint::JavaScript(path) => {
            Command::new(env::var_os("BOREAL_NODE_BINARY").unwrap_or_else(|| "node".into()))
                .env("BOREAL_DASHBOARD_BINARY", &executable)
                .arg(path)
                .arg("--socket")
                .arg(&socket)
                .arg("--interactive")
                .spawn()
        }
    };
    let mut tui = match tui {
        Ok(child) => child,
        Err(error) => {
            terminate_child(&mut service);
            let _ = fs::remove_dir_all(&runtime);
            return Err(CliError::with(
                ErrorCode::ServiceUnavailable,
                ApplicationOutcome::Failed,
                format!("cannot start global dashboard UI: {error}"),
            ));
        }
    };
    let tui_status = supervise(&mut tui, &mut service, &socket);
    let _ = fs::remove_dir_all(&runtime);
    match tui_status? {
        status if status.success() => Ok(()),
        status => Err(CliError::with(
            ErrorCode::ServiceUnavailable,
            ApplicationOutcome::Failed,
            format!("global dashboard UI exited with {status}"),
        )),
    }
}

#[cfg(unix)]
fn wait_until_ready(socket: &Path, service: &mut Child) -> Result<(), CliError> {
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(5) {
        if let Some(status) = service.try_wait().map_err(|error| {
            CliError::with(
                ErrorCode::ServiceUnavailable,
                ApplicationOutcome::Failed,
                error.to_string(),
            )
        })? {
            return Err(CliError::with(
                ErrorCode::ServiceUnavailable,
                ApplicationOutcome::Failed,
                format!("global service exited before startup completed ({status})"),
            ));
        }
        let request = JsonRequest::new(
            "global-dashboard-ready",
            json!({
                "api_version": API_VERSION,
                "schema_version": "boreal.global.request.v1",
                "operation_id": format!("op_global_dashboard_ready_{}", std::process::id()),
                "command": "snapshot",
                "payload": {},
            })
            .to_string(),
        )
        .map_err(|error| {
            CliError::with(
                ErrorCode::ProtocolMismatch,
                ApplicationOutcome::Failed,
                error.to_string(),
            )
        })?;
        if let Ok(mut client) = UnixSocketClient::connect(
            socket,
            TransportConfig::default()
                .with_read_timeout(Some(Duration::from_millis(500)))
                .with_write_timeout(Some(Duration::from_millis(500))),
        ) {
            if let Ok(response) = client.request(request) {
                if response.request_id() == "global-dashboard-ready" && response.payload().is_some()
                {
                    return Ok(());
                }
            }
        }
        thread::sleep(Duration::from_millis(50));
    }
    Err(CliError::with(
        ErrorCode::ServiceUnavailable,
        ApplicationOutcome::Failed,
        "global service did not become ready within five seconds",
    ))
}

#[cfg(unix)]
fn supervise(tui: &mut Child, service: &mut Child, socket: &Path) -> Result<ExitStatus, CliError> {
    loop {
        let tui_status = match tui.try_wait() {
            Ok(status) => status,
            Err(error) => {
                terminate_child(tui);
                terminate_child(service);
                return Err(CliError::with(
                    ErrorCode::ServiceUnavailable,
                    ApplicationOutcome::Failed,
                    error.to_string(),
                ));
            }
        };
        if let Some(status) = tui_status {
            let _ = request_shutdown(socket);
            wait_service(service);
            return Ok(status);
        }
        let service_status = match service.try_wait() {
            Ok(status) => status,
            Err(error) => {
                terminate_child(tui);
                terminate_child(service);
                return Err(CliError::with(
                    ErrorCode::ServiceUnavailable,
                    ApplicationOutcome::Failed,
                    error.to_string(),
                ));
            }
        };
        if let Some(status) = service_status {
            terminate_child(tui);
            return Err(CliError::with(
                ErrorCode::ServiceUnavailable,
                ApplicationOutcome::Failed,
                format!("global service exited while the dashboard was running ({status})"),
            ));
        }
        let pending = signal::take_pending();
        if pending != 0 {
            signal::send_to_process(tui.id(), pending);
            terminate_child(service);
            terminate_child(tui);
            return Err(CliError::with(
                ErrorCode::ServiceUnavailable,
                ApplicationOutcome::Failed,
                format!("global dashboard interrupted by signal {pending}"),
            ));
        }
        thread::sleep(Duration::from_millis(25));
    }
}

#[cfg(unix)]
fn request_shutdown(socket: &Path) -> Result<(), CliError> {
    let operation = format!("op_global_shutdown_{}", std::process::id());
    let payload = json!({"api_version":API_VERSION,"schema_version":"boreal.global.request.v1","operation_id":operation,"command":"service shutdown","payload":{}});
    let request =
        JsonRequest::new("global-dashboard-shutdown", payload.to_string()).map_err(|error| {
            CliError::with(
                ErrorCode::ProtocolMismatch,
                ApplicationOutcome::Failed,
                error.to_string(),
            )
        })?;
    let mut client = UnixSocketClient::connect(
        socket,
        TransportConfig::default()
            .with_read_timeout(Some(Duration::from_secs(1)))
            .with_write_timeout(Some(Duration::from_secs(1))),
    )
    .map_err(|error| {
        CliError::with(
            ErrorCode::ServiceUnavailable,
            ApplicationOutcome::Failed,
            error.to_string(),
        )
    })?;
    client.request(request).map_err(|error| {
        CliError::with(
            ErrorCode::ServiceUnavailable,
            ApplicationOutcome::Failed,
            error.to_string(),
        )
    })?;
    Ok(())
}

#[cfg(unix)]
fn wait_service(service: &mut Child) {
    let deadline = Instant::now() + Duration::from_secs(3);
    while Instant::now() < deadline {
        if service.try_wait().ok().flatten().is_some() {
            return;
        }
        thread::sleep(Duration::from_millis(25));
    }
    terminate_child(service);
}

#[cfg(unix)]
fn terminate_child(child: &mut Child) {
    if child.try_wait().ok().flatten().is_some() {
        return;
    }
    signal::send_to_process(child.id(), signal::SIGTERM);
    let deadline = Instant::now() + Duration::from_millis(750);
    while Instant::now() < deadline {
        if child.try_wait().ok().flatten().is_some() {
            return;
        }
        thread::sleep(Duration::from_millis(25));
    }
    signal::send_to_process(child.id(), signal::SIGKILL);
    let _ = child.wait();
}

enum TuiEntrypoint {
    Executable(PathBuf),
    JavaScript(PathBuf),
}

#[cfg(unix)]
mod signal {
    use std::{
        io,
        os::raw::c_int,
        sync::atomic::{AtomicI32, Ordering},
    };
    pub(super) const SIGINT: c_int = 2;
    pub(super) const SIGTERM: c_int = 15;
    pub(super) const SIGKILL: c_int = 9;
    const SIGNAL_ERROR: usize = usize::MAX;
    static PENDING: AtomicI32 = AtomicI32::new(0);
    unsafe extern "C" {
        fn signal(signal: c_int, handler: usize) -> usize;
        fn kill(process: c_int, signal: c_int) -> c_int;
    }
    extern "C" fn record(signal_number: c_int) {
        PENDING.store(signal_number, Ordering::SeqCst);
    }
    pub(super) struct SignalGuard {
        previous: [(c_int, usize); 2],
    }
    impl SignalGuard {
        pub(super) fn install() -> io::Result<Self> {
            PENDING.store(0, Ordering::SeqCst);
            let mut previous = [(0, 0); 2];
            for (slot, number) in previous.iter_mut().zip([SIGINT, SIGTERM]) {
                let handler = unsafe { signal(number, record as *const () as usize) };
                if handler == SIGNAL_ERROR {
                    return Err(io::Error::last_os_error());
                }
                *slot = (number, handler);
            }
            Ok(Self { previous })
        }
    }
    impl Drop for SignalGuard {
        fn drop(&mut self) {
            for (number, handler) in self.previous {
                unsafe { signal(number, handler) };
            }
            PENDING.store(0, Ordering::SeqCst);
        }
    }
    pub(super) fn take_pending() -> c_int {
        PENDING.swap(0, Ordering::SeqCst)
    }
    pub(super) fn send_to_process(pid: u32, signal_number: c_int) {
        if let Ok(pid) = c_int::try_from(pid) {
            unsafe {
                kill(pid, signal_number);
            }
        }
    }
}

fn find_tui_entrypoint() -> Result<TuiEntrypoint, CliError> {
    if let Some(path) = env::var_os("BOREAL_GLOBAL_TUI_ENTRYPOINT").map(PathBuf::from) {
        return classify_tui(path);
    }
    let mut candidates = Vec::new();
    if let Ok(executable) = env::current_exe() {
        if let Some(prefix) = executable.parent().and_then(Path::parent) {
            candidates.push(prefix.join("lib/boreal/global-tui/entrypoint.js"));
        }
    }
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../apps/global-tui/dist/entrypoint.js"),
    );
    for path in candidates {
        if path.is_file() {
            return classify_tui(path);
        }
    }
    Err(CliError::with(
        ErrorCode::NotFound,
        ApplicationOutcome::Failed,
        "the global dashboard is not bundled with this installation; build apps/global-tui/dist/entrypoint.js or set BOREAL_GLOBAL_TUI_ENTRYPOINT",
    ))
}

fn classify_tui(path: PathBuf) -> Result<TuiEntrypoint, CliError> {
    if !path.is_file() {
        return Err(CliError::with(
            ErrorCode::NotFound,
            ApplicationOutcome::Failed,
            format!("global TUI entrypoint does not exist: {}", path.display()),
        ));
    }
    if path
        .extension()
        .is_some_and(|extension| extension == "js" || extension == "mjs")
    {
        Ok(TuiEntrypoint::JavaScript(path))
    } else {
        Ok(TuiEntrypoint::Executable(path))
    }
}
