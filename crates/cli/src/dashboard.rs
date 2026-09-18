//! One-command dashboard launcher.
//!
//! The dashboard remains a service client. This module composes the existing
//! CLI-owned service process and packaged/development TUI into one supervised
//! foreground command so operators do not have to manage either process.

use super::*;
use serde::Deserialize;
use std::{
    collections::BTreeSet,
    io::IsTerminal,
    process::{Child, ExitStatus},
    sync::atomic::{AtomicU64, Ordering},
};

#[cfg(unix)]
use boreal_service::{
    JsonRequest, TransportConfig, UnixSocketClient, APPLICATION_API_VERSION,
    APPLICATION_SCHEMA_VERSION,
};

const SERVICE_START_TIMEOUT: Duration = Duration::from_secs(5);
const CHILD_EXIT_GRACE: Duration = Duration::from_secs(2);
const PROJECT_ENV_KEYS: [&str; 2] = ["BOREAL_PROJECT", "BOREAL_PROJECT_ID"];
const PROJECT_METADATA_FILES: [&str; 3] = ["project-id", "project", "project.json"];
static DASHBOARD_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Deserialize)]
struct ProjectMetadata {
    project_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum TuiEntrypoint {
    Executable(PathBuf),
    JavaScript(PathBuf),
    TypeScript {
        runner: PathBuf,
        source: PathBuf,
        tsconfig: PathBuf,
    },
}

pub(super) fn run_dashboard(parsed: &ParsedCommand) -> Result<CliResult, CliError> {
    if parsed.options.socket.is_some() {
        return Err(CliError::invalid(
            "dashboard manages its own private service; omit --socket",
        ));
    }
    let database = existing_database_path(Path::new(&parsed.options.db))?;
    let current_dir = env::current_dir().map_err(|error| {
        CliError::with(
            ErrorCode::ServiceUnavailable,
            ApplicationOutcome::Failed,
            format!("cannot resolve the working directory: {error}"),
        )
    })?;
    let store = SqliteStore::open(&database, SCHEMA).map_err(map_store_error)?;
    let project_ids = store.list_project_ids().map_err(map_store_error)?;
    let metadata_ids = local_project_metadata(&database, &current_dir)?;
    let project = resolve_project_id(
        parsed.options.project.as_deref(),
        &metadata_ids,
        &project_ids,
    )?;

    if parsed.options.json {
        let mut resolved = parsed.clone();
        resolved.options.project = Some(project);
        return status_result(&resolved, &store);
    }

    drop(store);
    if !std::io::stdin().is_terminal() || !std::io::stdout().is_terminal() {
        return Err(CliError::invalid(
            "dashboard requires an interactive terminal; use --json for noninteractive status",
        ));
    }

    #[cfg(unix)]
    {
        launch_dashboard(parsed, &database, &project)?;
        Ok(CliResult {
            outcome: ApplicationOutcome::Unchanged,
            revision: None,
            data: None,
            ..CliResult::default()
        })
    }
    #[cfg(not(unix))]
    {
        let _ = (parsed, database, project);
        Err(CliError::with(
            ErrorCode::UnsupportedPlatform,
            ApplicationOutcome::Failed,
            "the managed dashboard currently requires Unix-domain sockets",
        ))
    }
}

fn existing_database_path(path: &Path) -> Result<PathBuf, CliError> {
    if !path.is_file() {
        return Err(CliError::with(
            ErrorCode::NotFound,
            ApplicationOutcome::Failed,
            format!(
                "Boreal database not found at {}; run `bwrk init PROJECT` or pass --db PATH",
                path.display()
            ),
        ));
    }
    fs::canonicalize(path).map_err(|error| {
        CliError::with(
            ErrorCode::ServiceUnavailable,
            ApplicationOutcome::Failed,
            format!("cannot resolve database {}: {error}", path.display()),
        )
    })
}

fn local_project_metadata(database: &Path, current_dir: &Path) -> Result<Vec<String>, CliError> {
    let mut values = BTreeSet::new();
    for key in PROJECT_ENV_KEYS {
        if let Some(value) = env::var_os(key) {
            let value = value.to_string_lossy().trim().to_owned();
            if !value.is_empty() {
                values.insert(value);
            }
        }
    }

    let state_root = database.parent().unwrap_or_else(|| Path::new("."));
    let mut roots = current_dir
        .ancestors()
        .map(Path::to_owned)
        .collect::<Vec<_>>();
    if !roots.iter().any(|root| root == state_root) {
        roots.push(state_root.to_owned());
    }
    let mut metadata_paths = BTreeSet::new();
    for root in roots {
        for candidate in PROJECT_METADATA_FILES
            .iter()
            .map(|name| root.join(name))
            .chain(
                PROJECT_METADATA_FILES
                    .iter()
                    .map(|name| root.join(".boreal").join(name)),
            )
        {
            metadata_paths.insert(candidate);
        }
    }
    for path in metadata_paths {
        if !path.is_file() {
            continue;
        }
        let encoded = fs::read_to_string(&path).map_err(|error| {
            CliError::with(
                ErrorCode::InvalidArgument,
                ApplicationOutcome::Rejected,
                format!("cannot read project metadata {}: {error}", path.display()),
            )
        })?;
        let value = if path.file_name().and_then(|name| name.to_str()) == Some("project.json") {
            serde_json::from_str::<ProjectMetadata>(&encoded)
                .map_err(|error| {
                    CliError::with(
                        ErrorCode::InvalidArgument,
                        ApplicationOutcome::Rejected,
                        format!("invalid project metadata {}: {error}", path.display()),
                    )
                })?
                .project_id
        } else {
            encoded.trim().to_owned()
        };
        if value.is_empty() {
            return Err(CliError::invalid(format!(
                "project metadata {} has an empty project identifier",
                path.display()
            )));
        }
        values.insert(value);
    }
    Ok(values.into_iter().collect())
}

fn resolve_project_id(
    explicit: Option<&str>,
    metadata_ids: &[String],
    database_ids: &[String],
) -> Result<String, CliError> {
    if let Some(project) = explicit {
        return require_known_project(project, database_ids, "explicit --project");
    }

    match metadata_ids {
        [project] => return require_known_project(project, database_ids, "local metadata"),
        [] => {}
        projects => {
            return Err(CliError::invalid(format!(
                "local project metadata is ambiguous ({}); pass --project PROJECT",
                projects.join(", ")
            )))
        }
    }

    match database_ids {
        [project] => Ok(project.clone()),
        [] => Err(CliError::with(
            ErrorCode::NotFound,
            ApplicationOutcome::Failed,
            "the Boreal database contains no projects; run `bwrk init PROJECT`",
        )),
        projects => {
            let visible = projects.iter().take(8).cloned().collect::<Vec<_>>();
            let suffix = if projects.len() > visible.len() {
                format!(", … ({} total)", projects.len())
            } else {
                String::new()
            };
            Err(CliError::invalid(format!(
                "the Boreal database contains multiple projects ({}{suffix}); pass --project PROJECT",
                visible.join(", ")
            )))
        }
    }
}

fn require_known_project(
    project: &str,
    database_ids: &[String],
    source: &str,
) -> Result<String, CliError> {
    if database_ids.iter().any(|candidate| candidate == project) {
        Ok(project.to_owned())
    } else {
        Err(CliError::with(
            ErrorCode::NotFound,
            ApplicationOutcome::Failed,
            format!("project {project:?} selected by {source} is not present in the database"),
        ))
    }
}

#[cfg(unix)]
fn launch_dashboard(
    parsed: &ParsedCommand,
    database: &Path,
    project: &str,
) -> Result<(), CliError> {
    use std::os::unix::process::CommandExt;

    let executable = env::current_exe().map_err(process_error("locate the bwrk executable"))?;
    let current_dir = env::current_dir().map_err(process_error("resolve the working directory"))?;
    let tui = locate_tui_entrypoint(
        &executable,
        &current_dir,
        env::var_os("BOREAL_TUI_ENTRYPOINT").map(PathBuf::from),
    )?;
    let _signals = signal::SignalGuard::install().map_err(|error| {
        CliError::with(
            ErrorCode::ServiceUnavailable,
            ApplicationOutcome::Failed,
            format!("cannot install dashboard signal handlers: {error}"),
        )
    })?;
    let mut service_socket_guard = SocketGuard::allocate("service")?;
    let service_socket = service_socket_guard.path().to_owned();

    let dashboard_result = (|| {
        let mut service_command = Command::new(&executable);
        service_command
            .arg("service")
            .arg("run")
            .arg("--db")
            .arg(database)
            .arg("--socket")
            .arg(&service_socket)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::inherit())
            .process_group(0);
        let service_child = service_command
            .spawn()
            .map_err(process_error("start the private Boreal service"))?;
        let mut service = ManagedChild::new("service", service_child);
        if let Err(error) = wait_for_service(&mut service, &service_socket, project) {
            let termination = service.terminate(signal::SIGTERM, CHILD_EXIT_GRACE);
            return combine_dashboard_results(
                Err(error),
                termination,
                "private Boreal service shutdown",
            );
        }

        let harness = if parsed.options.harness == DEFAULT_HARNESS {
            "tui".to_owned()
        } else {
            parsed.options.harness.clone()
        };
        let session = if parsed.options.session == DEFAULT_SESSION {
            format!(
                "session-tui-{}-{}",
                std::process::id(),
                DASHBOARD_COUNTER.fetch_add(1, Ordering::Relaxed)
            )
        } else {
            parsed.options.session.clone()
        };
        let mut tui_command = command_for_tui(&tui);
        tui_command
            .arg("--socket")
            .arg(&service_socket)
            .arg("--project")
            .arg(project)
            .arg("--actor")
            .arg(&parsed.options.actor)
            .arg("--harness")
            .arg(harness)
            .arg("--session")
            .arg(session)
            .arg("--interactive")
            .stdin(Stdio::inherit())
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .process_group(0);
        if let Some(work) = &parsed.options.work {
            tui_command.arg("--work").arg(work);
        }
        let tui_child = match tui_command.spawn() {
            Ok(child) => child,
            Err(error) => {
                let spawn_error = process_error("start the Boreal TUI")(error);
                let termination = service.terminate(signal::SIGTERM, CHILD_EXIT_GRACE);
                return combine_dashboard_results(
                    Err(spawn_error),
                    termination,
                    "private Boreal service shutdown",
                );
            }
        };
        let mut tui_process = ManagedChild::new("TUI", tui_child);

        let outcome = supervise(&mut service, &mut tui_process);
        let termination = service.terminate(signal::SIGTERM, CHILD_EXIT_GRACE);
        combine_dashboard_results(outcome, termination, "private Boreal service shutdown")
    })();
    let cleanup = service_socket_guard.cleanup();
    combine_dashboard_results(
        dashboard_result,
        cleanup,
        "private dashboard endpoint cleanup",
    )
}

#[cfg(unix)]
fn combine_dashboard_results(
    result: Result<(), CliError>,
    cleanup: Result<(), CliError>,
    cleanup_label: &str,
) -> Result<(), CliError> {
    match (result, cleanup) {
        (Ok(()), Ok(())) => Ok(()),
        (Err(error), Ok(())) => Err(error),
        (Ok(()), Err(error)) => Err(error),
        (Err(mut error), Err(cleanup_error)) => {
            error.message = format!(
                "{}; additionally, {cleanup_label} failed: {}",
                error.message, cleanup_error.message
            );
            Err(error)
        }
    }
}

#[cfg(unix)]
fn private_socket_directory(role: &str) -> Result<(PathBuf, PathBuf), CliError> {
    let nonce = DASHBOARD_COUNTER.fetch_add(1, Ordering::Relaxed);
    let directory_name = format!("boreal-dashboard-{role}-{}-{nonce}", std::process::id());
    let socket_name = "service.sock";
    let mut base = env::temp_dir();
    if base
        .join(&directory_name)
        .join(socket_name)
        .as_os_str()
        .len()
        > 96
    {
        base = PathBuf::from("/tmp");
    }
    for attempt in 0..16_u8 {
        let name = if attempt == 0 {
            directory_name.clone()
        } else {
            format!("{directory_name}-{attempt}")
        };
        let directory = base.join(name);
        match fs::create_dir(&directory) {
            Ok(()) => return Ok((directory.clone(), directory.join(socket_name))),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(CliError::with(
                    ErrorCode::ServiceUnavailable,
                    ApplicationOutcome::Failed,
                    format!(
                        "cannot create private dashboard runtime directory {}: {error}",
                        directory.display()
                    ),
                ))
            }
        }
    }
    Err(CliError::with(
        ErrorCode::ServiceUnavailable,
        ApplicationOutcome::Failed,
        format!(
            "cannot allocate a private dashboard runtime directory under {}",
            base.display()
        ),
    ))
}

#[cfg(unix)]
fn locate_tui_entrypoint(
    executable: &Path,
    current_dir: &Path,
    override_path: Option<PathBuf>,
) -> Result<TuiEntrypoint, CliError> {
    if let Some(path) = override_path {
        let path = absolute_from(&path, current_dir);
        return classify_tui_path(&path).ok_or_else(|| {
            CliError::with(
                ErrorCode::NotFound,
                ApplicationOutcome::Failed,
                format!(
                    "BOREAL_TUI_ENTRYPOINT does not name a TUI file: {}",
                    path.display()
                ),
            )
        });
    }

    let binary_dir = executable.parent().unwrap_or_else(|| Path::new("."));
    let mut candidates = vec![
        binary_dir.join("bwrk-tui"),
        binary_dir.join("bwrk-tui.js"),
        binary_dir.join("tui/entrypoint.js"),
        binary_dir.join("../dist/tui/entrypoint.js"),
        binary_dir.join("../lib/boreal/tui/entrypoint.js"),
        binary_dir.join("../share/boreal/tui/entrypoint.js"),
    ];
    for ancestor in current_dir.ancestors() {
        candidates.push(ancestor.join("apps/tui/dist/entrypoint.js"));
    }
    if cfg!(debug_assertions) {
        candidates.push(
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../apps/tui/dist/entrypoint.js"),
        );
    }
    if let Some(path) = executable_on_path("bwrk-tui") {
        candidates.push(path);
    }

    if let Some(entrypoint) = candidates.iter().find_map(|path| classify_tui_path(path)) {
        return Ok(entrypoint);
    }

    if cfg!(debug_assertions) {
        let manifest_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        let source_roots = current_dir
            .ancestors()
            .map(Path::to_owned)
            .chain(std::iter::once(manifest_root));
        for root in source_roots {
            let runner = root.join("node_modules/.bin/tsx");
            let source = root.join("apps/tui/src/entrypoint.ts");
            let tsconfig = root.join("apps/tui/tsconfig.json");
            if runner.is_file() && source.is_file() && tsconfig.is_file() {
                return Ok(TuiEntrypoint::TypeScript {
                    runner,
                    source,
                    tsconfig,
                });
            }
        }
    }

    Err(CliError::with(
        ErrorCode::NotFound,
        ApplicationOutcome::Failed,
        "the terminal dashboard is not bundled with this bwrk installation; build apps/tui/dist/entrypoint.js, reinstall the packaged TUI, set BOREAL_TUI_ENTRYPOINT, or use `bwrk dashboard --json`",
    ))
}

#[cfg(unix)]
fn absolute_from(path: &Path, current_dir: &Path) -> PathBuf {
    if path.is_absolute() {
        path.to_owned()
    } else {
        current_dir.join(path)
    }
}

#[cfg(unix)]
fn classify_tui_path(path: &Path) -> Option<TuiEntrypoint> {
    if !path.is_file() {
        return None;
    }
    if path.extension().and_then(|value| value.to_str()) == Some("js") {
        Some(TuiEntrypoint::JavaScript(path.to_owned()))
    } else {
        use std::os::unix::fs::PermissionsExt;

        path.metadata().ok().and_then(|metadata| {
            (metadata.permissions().mode() & 0o111 != 0)
                .then(|| TuiEntrypoint::Executable(path.to_owned()))
        })
    }
}

#[cfg(unix)]
fn executable_on_path(name: &str) -> Option<PathBuf> {
    use std::os::unix::fs::PermissionsExt;

    let path = env::var_os("PATH")?;
    env::split_paths(&path)
        .map(|directory| directory.join(name))
        .find(|candidate| {
            candidate.metadata().is_ok_and(|metadata| {
                metadata.is_file() && metadata.permissions().mode() & 0o111 != 0
            })
        })
}

#[cfg(unix)]
fn command_for_tui(entrypoint: &TuiEntrypoint) -> Command {
    match entrypoint {
        TuiEntrypoint::Executable(path) => Command::new(path),
        TuiEntrypoint::JavaScript(path) => {
            let mut command =
                Command::new(env::var_os("BOREAL_NODE").unwrap_or_else(|| "node".into()));
            command.arg(path);
            command
        }
        TuiEntrypoint::TypeScript {
            runner,
            source,
            tsconfig,
        } => {
            let mut command = Command::new(runner);
            command.arg("--tsconfig").arg(tsconfig).arg(source);
            command
        }
    }
}

#[cfg(unix)]
fn wait_for_service(
    service: &mut ManagedChild,
    socket: &Path,
    project: &str,
) -> Result<(), CliError> {
    let deadline = Instant::now() + SERVICE_START_TIMEOUT;
    let mut last_probe_error = None;
    loop {
        if let Some(status) = service.try_wait()? {
            return Err(CliError::with(
                ErrorCode::ServiceUnavailable,
                ApplicationOutcome::Failed,
                format!(
                    "private Boreal service exited before becoming ready ({status}); another service may already own this database or startup failed"
                ),
            ));
        }
        let pending = signal::take_pending();
        if pending != 0 {
            return Err(interrupted_error(pending));
        }
        if socket.exists() {
            match probe_service(socket, project) {
                Ok(()) => return Ok(()),
                Err(error) => last_probe_error = Some(error),
            }
        }
        if Instant::now() >= deadline {
            let detail = last_probe_error
                .map(|error| format!("; last readiness probe: {error}"))
                .unwrap_or_default();
            return Err(CliError::with(
                ErrorCode::ServiceUnavailable,
                ApplicationOutcome::Failed,
                format!(
                    "private Boreal service did not become ready at {} within {} seconds{}",
                    socket.display(),
                    SERVICE_START_TIMEOUT.as_secs(),
                    detail,
                ),
            ));
        }
        thread::sleep(
            Duration::from_millis(20).min(deadline.saturating_duration_since(Instant::now())),
        );
    }
}

#[cfg(unix)]
fn probe_service(socket: &Path, project: &str) -> Result<(), String> {
    let operation = format!(
        "op_dashboard_ready_{}_{}",
        std::process::id(),
        DASHBOARD_COUNTER.fetch_add(1, Ordering::Relaxed)
    );
    let payload = json!({
        "api_version": APPLICATION_API_VERSION,
        "schema_version": APPLICATION_SCHEMA_VERSION,
        "operation_id": operation,
        "data": {
            "command": "status",
            "project_id": project,
            "actor_id": "dashboard-readiness",
            "harness_id": "dashboard-readiness",
            "session_id": "dashboard-readiness",
            "limit": 1,
            "offset": 0,
        },
    });
    let request = JsonRequest::new("dashboard-readiness", payload.to_string())
        .map_err(|error| error.to_string())?;
    let config = TransportConfig::default()
        .with_read_timeout(Some(Duration::from_millis(150)))
        .with_write_timeout(Some(Duration::from_millis(150)));
    let mut client =
        UnixSocketClient::connect(socket, config).map_err(|error| error.to_string())?;
    let response = client.request(request).map_err(|error| error.to_string())?;
    let body = response
        .payload()
        .ok_or_else(|| "readiness response omitted its payload".to_owned())?;
    let outer: Value = serde_json::from_str(body)
        .map_err(|error| format!("readiness response is not JSON: {error}"))?;
    if outer.get("api_version").and_then(Value::as_str) != Some(APPLICATION_API_VERSION)
        || outer.get("schema_version").and_then(Value::as_str) != Some(APPLICATION_SCHEMA_VERSION)
    {
        return Err("readiness response version does not match the launcher".to_owned());
    }
    let envelope = outer
        .get("data")
        .ok_or_else(|| "readiness response omitted its application envelope".to_owned())?;
    if envelope.get("transport").and_then(Value::as_str) != Some("ok") {
        return Err("readiness response did not report successful transport".to_owned());
    }
    if envelope.get("outcome").and_then(Value::as_str) != Some("unchanged") {
        return Err("readiness status did not complete as unchanged".to_owned());
    }
    let status = envelope
        .get("data")
        .ok_or_else(|| "readiness response omitted status data".to_owned())?;
    if status.get("command").and_then(Value::as_str) != Some("status")
        || status.get("project_id").and_then(Value::as_str) != Some(project)
    {
        return Err("readiness response was not for the selected project".to_owned());
    }
    Ok(())
}

#[cfg(unix)]
fn interrupted_error(signal_number: i32) -> CliError {
    CliError {
        code: ErrorCode::ServiceUnavailable,
        outcome: ApplicationOutcome::Failed,
        message: format!("dashboard interrupted by signal {signal_number}"),
        exit: u8::try_from(128_i32.saturating_add(signal_number)).unwrap_or(1),
        transport: TransportOutcome::Ok,
        as_of: None,
        next_status_change_at: None,
        detail_ref: None,
        protocol_error: None,
    }
}

#[cfg(unix)]
fn supervise(service: &mut ManagedChild, tui: &mut ManagedChild) -> Result<(), CliError> {
    loop {
        if let Some(status) = tui.try_wait()? {
            return tui_status(status);
        }
        if let Some(status) = service.try_wait()? {
            let _ = tui.terminate(signal::SIGTERM, CHILD_EXIT_GRACE);
            return Err(CliError::with(
                ErrorCode::ServiceUnavailable,
                ApplicationOutcome::Failed,
                format!("private Boreal service exited while the dashboard was running ({status})"),
            ));
        }
        let pending = signal::take_pending();
        if pending != 0 {
            let _ = tui.terminate(pending, CHILD_EXIT_GRACE);
            let _ = service.terminate(pending, CHILD_EXIT_GRACE);
            return Err(interrupted_error(pending));
        }
        thread::sleep(Duration::from_millis(25));
    }
}

#[cfg(unix)]
fn tui_status(status: ExitStatus) -> Result<(), CliError> {
    if status.success() {
        Ok(())
    } else {
        let exit = status
            .code()
            .and_then(|code| u8::try_from(code).ok())
            .unwrap_or(1);
        Err(CliError {
            code: ErrorCode::ServiceUnavailable,
            outcome: ApplicationOutcome::Failed,
            message: format!("Boreal TUI exited with {status}"),
            exit,
            transport: TransportOutcome::Ok,
            as_of: None,
            next_status_change_at: None,
            detail_ref: None,
            protocol_error: None,
        })
    }
}

#[cfg(unix)]
fn process_error(action: &'static str) -> impl FnOnce(std::io::Error) -> CliError {
    move |error| {
        CliError::with(
            ErrorCode::ServiceUnavailable,
            ApplicationOutcome::Failed,
            format!("cannot {action}: {error}"),
        )
    }
}

#[cfg(unix)]
struct ManagedChild {
    label: &'static str,
    child: Child,
    exited: bool,
}

#[cfg(unix)]
impl ManagedChild {
    fn new(label: &'static str, child: Child) -> Self {
        Self {
            label,
            child,
            exited: false,
        }
    }

    fn try_wait(&mut self) -> Result<Option<ExitStatus>, CliError> {
        let status = self
            .child
            .try_wait()
            .map_err(process_error("inspect a dashboard child process"))?;
        self.exited |= status.is_some();
        Ok(status)
    }

    fn terminate(&mut self, signal: i32, grace: Duration) -> Result<(), CliError> {
        if self.exited || self.try_wait()?.is_some() {
            return Ok(());
        }
        signal::send_to_group(self.child.id(), signal);
        let deadline = Instant::now() + grace;
        while Instant::now() < deadline {
            if self.try_wait()?.is_some() {
                return Ok(());
            }
            thread::sleep(Duration::from_millis(20));
        }
        self.child
            .kill()
            .map_err(process_error("stop a dashboard child process"))?;
        self.child
            .wait()
            .map_err(process_error("reap a dashboard child process"))?;
        self.exited = true;
        Ok(())
    }
}

#[cfg(unix)]
impl Drop for ManagedChild {
    fn drop(&mut self) {
        if !self.exited {
            let _ = self.terminate(signal::SIGTERM, Duration::from_millis(250));
        }
        let _ = self.label;
    }
}

#[cfg(unix)]
struct SocketGuard {
    directory: PathBuf,
    path: PathBuf,
    cleaned: bool,
}

#[cfg(unix)]
impl SocketGuard {
    fn allocate(role: &str) -> Result<Self, CliError> {
        let (directory, path) = private_socket_directory(role)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&directory, fs::Permissions::from_mode(0o700)).map_err(
                |error| {
                    let _ = fs::remove_dir(&directory);
                    CliError::with(
                        ErrorCode::ServiceUnavailable,
                        ApplicationOutcome::Failed,
                        format!(
                            "cannot secure private dashboard runtime directory {}: {error}",
                            directory.display()
                        ),
                    )
                },
            )?;
        }
        Ok(Self {
            directory,
            path,
            cleaned: false,
        })
    }

    fn path(&self) -> &Path {
        &self.path
    }

    fn cleanup(&mut self) -> Result<(), CliError> {
        use std::os::unix::fs::FileTypeExt;

        if self.cleaned {
            return Ok(());
        }
        match fs::symlink_metadata(&self.path) {
            Ok(metadata) if metadata.file_type().is_socket() => {
                fs::remove_file(&self.path).map_err(|error| {
                    cleanup_error(
                        &self.path,
                        format!("cannot remove the owned Unix socket: {error}"),
                    )
                })?;
            }
            Ok(metadata) => {
                return Err(cleanup_error(
                    &self.path,
                    format!(
                        "refusing to remove a non-socket endpoint (file type {:?})",
                        metadata.file_type()
                    ),
                ));
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(cleanup_error(
                    &self.path,
                    format!("cannot inspect the owned Unix socket: {error}"),
                ));
            }
        }
        match fs::symlink_metadata(&self.directory) {
            Ok(metadata) if metadata.file_type().is_dir() => {
                fs::remove_dir(&self.directory).map_err(|error| {
                    cleanup_error(
                        &self.directory,
                        format!("cannot remove the private runtime directory: {error}"),
                    )
                })?;
            }
            Ok(_) => {
                return Err(cleanup_error(
                    &self.directory,
                    "refusing to remove a private runtime path that is not a directory",
                ));
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(cleanup_error(
                    &self.directory,
                    format!("cannot inspect the private runtime directory: {error}"),
                ));
            }
        }
        self.cleaned = true;
        Ok(())
    }
}

#[cfg(unix)]
impl Drop for SocketGuard {
    fn drop(&mut self) {
        if let Err(error) = self.cleanup() {
            eprintln!("error: {}", error.message);
        }
    }
}

#[cfg(unix)]
fn cleanup_error(path: &Path, message: impl Into<String>) -> CliError {
    CliError::with(
        ErrorCode::ServiceUnavailable,
        ApplicationOutcome::Failed,
        format!(
            "dashboard cleanup failed for {}: {}",
            path.display(),
            message.into()
        ),
    )
}

#[cfg(unix)]
mod signal {
    use std::{
        io,
        os::raw::c_int,
        sync::atomic::{AtomicI32, Ordering},
    };

    pub(super) const SIGHUP: c_int = 1;
    pub(super) const SIGINT: c_int = 2;
    pub(super) const SIGTERM: c_int = 15;
    const SIGNAL_ERROR: usize = usize::MAX;
    static PENDING: AtomicI32 = AtomicI32::new(0);

    unsafe extern "C" {
        fn signal(signal: c_int, handler: usize) -> usize;
        fn kill(process: c_int, signal: c_int) -> c_int;
    }

    extern "C" fn record(signal: c_int) {
        PENDING.store(signal, Ordering::SeqCst);
    }

    pub(super) struct SignalGuard {
        previous: [(c_int, usize); 3],
    }

    impl SignalGuard {
        pub(super) fn install() -> io::Result<Self> {
            let mut previous = [(0, 0); 3];
            for (slot, signal_number) in previous.iter_mut().zip([SIGHUP, SIGINT, SIGTERM]) {
                let handler = unsafe { signal(signal_number, record as usize) };
                if handler == SIGNAL_ERROR {
                    for (installed, old_handler) in previous.iter().copied() {
                        if installed != 0 {
                            unsafe { signal(installed, old_handler) };
                        }
                    }
                    return Err(io::Error::last_os_error());
                }
                *slot = (signal_number, handler);
            }
            Ok(Self { previous })
        }
    }

    impl Drop for SignalGuard {
        fn drop(&mut self) {
            for (signal_number, handler) in self.previous {
                unsafe { signal(signal_number, handler) };
            }
        }
    }

    pub(super) fn take_pending() -> c_int {
        PENDING.swap(0, Ordering::SeqCst)
    }

    pub(super) fn send_to_group(process_id: u32, signal_number: c_int) {
        if let Ok(group) = c_int::try_from(process_id) {
            unsafe {
                kill(-group, signal_number);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_resolution_prefers_explicit_then_metadata_then_single_database_project() {
        let projects = vec!["alpha".to_owned(), "beta".to_owned()];
        assert_eq!(
            resolve_project_id(Some("beta"), &["alpha".to_owned()], &projects).unwrap(),
            "beta"
        );
        assert_eq!(
            resolve_project_id(None, &["alpha".to_owned()], &projects).unwrap(),
            "alpha"
        );
        assert_eq!(
            resolve_project_id(None, &[], &["only".to_owned()]).unwrap(),
            "only"
        );
    }

    #[test]
    fn project_resolution_reports_ambiguous_and_stale_metadata() {
        let projects = vec!["alpha".to_owned(), "beta".to_owned()];
        let ambiguous = resolve_project_id(None, &[], &projects).unwrap_err();
        assert_eq!(ambiguous.code, ErrorCode::InvalidArgument);
        assert!(ambiguous.message.contains("multiple projects"));

        let stale = resolve_project_id(None, &["missing".to_owned()], &projects).unwrap_err();
        assert_eq!(stale.code, ErrorCode::NotFound);
        assert!(stale.message.contains("local metadata"));

        let conflicting =
            resolve_project_id(None, &["alpha".to_owned(), "beta".to_owned()], &projects)
                .unwrap_err();
        assert!(conflicting.message.contains("metadata is ambiguous"));
    }

    #[test]
    fn store_project_listing_is_exact_and_stably_sorted() {
        let store = SqliteStore::open_in_memory(SCHEMA).unwrap();
        store.create_project("zeta", "unix-ms:1").unwrap();
        store.create_project("alpha", "unix-ms:1").unwrap();
        assert_eq!(
            store.list_project_ids().unwrap(),
            vec!["alpha".to_owned(), "zeta".to_owned()]
        );
    }

    #[cfg(unix)]
    #[test]
    fn tui_locator_prefers_an_explicit_javascript_entrypoint() {
        let root = env::temp_dir().join(format!(
            "boreal-dashboard-locator-{}-{}",
            std::process::id(),
            DASHBOARD_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&root).unwrap();
        let entrypoint = root.join("entrypoint.js");
        fs::write(&entrypoint, "// fixture").unwrap();
        let located = locate_tui_entrypoint(
            Path::new("/tmp/bwrk"),
            &root,
            Some(PathBuf::from("entrypoint.js")),
        )
        .unwrap();
        assert_eq!(located, TuiEntrypoint::JavaScript(entrypoint.clone()));
        fs::remove_file(entrypoint).unwrap();
        fs::remove_dir(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn tui_exit_status_is_propagated() {
        let status = Command::new("sh").args(["-c", "exit 23"]).status().unwrap();
        let error = tui_status(status).unwrap_err();
        assert_eq!(error.exit, 23);
        assert!(error.message.contains("exit status: 23"));
    }

    #[cfg(unix)]
    #[test]
    fn socket_guard_refuses_to_remove_a_non_socket_endpoint() {
        let mut guard = SocketGuard::allocate("test").unwrap();
        let path = guard.path().to_owned();
        fs::write(&path, "fixture").unwrap();
        let error = guard.cleanup().unwrap_err();
        assert!(error
            .message
            .contains("refusing to remove a non-socket endpoint"));
        assert!(path.exists());
        fs::remove_file(path).unwrap();
        guard.cleanup().unwrap();
    }
}
