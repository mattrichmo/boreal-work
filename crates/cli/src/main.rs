use boreal_application::{
    guide_checked, AcceptanceGateDefinition, ApplicationError, AttemptPolicy, AttemptRequest,
    BoundedExecutionResult, CommandSpec, EndAttemptRequest, EvidenceExecutionOutcome,
    EvidenceRunRequest, ExecutorAttestation, LivenessMetadata, OperationResult, ReceiptCoverage,
    ReceiptExpectation, ReceiptPayload, SessionRegistrationRequest, SqliteAttemptAdapter,
    WorkApplication,
};
use boreal_domain::{
    AcceptanceProfile, ActorId, AttemptId, AttemptPhase, ConfigIdentity, DispatchPolicy, Fence,
    GateId, GateKind, HarnessId, OperationId, PersistedLifecycle, ProjectId, ReceiptId,
    ReceiptResult, SessionId, SourceVersionId, TimestampMs, WorkId, WorkItem, WorkKind,
};
use boreal_protocol::{
    models::{
        AgentGuideDto, AgentNextDto, ContextRefDto, GuidanceContextDto, GuidanceProvenanceDto,
        GuidanceStatusDto, NextActionDto, NextReasonDto, NextStatusDto, RequirementDto, SubjectDto,
    },
    schema, ApplicationOutcome, Envelope, ErrorCode, ProtocolError, TransportOutcome, API_VERSION,
};
use boreal_store::{AttemptRecord, SqliteStore, StoreError};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    env, fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, ExitCode, Stdio},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

mod service;

const SCHEMA: &str = include_str!("../../../project/spec/schema-v2.sql");
const MAX_JSON_BYTES: usize = boreal_protocol::bounds::MAX_INLINE_OUTPUT_BYTES;
const DEFAULT_ACTOR: &str = "agent-1";
const DEFAULT_HARNESS: &str = "cli";
const DEFAULT_SESSION: &str = "session-cli";
const MAX_GATE_RUNTIME_MS: u64 = 30_000;
const GATE_COMMANDS_DIR: &str = "gates";
const HELP: &str = "bwrk v2\n\nUsage:\n  bwrk init <project> [--db PATH] [--json]\n  bwrk service run --db PATH --socket PATH [--max-requests N] [--json]\n  bwrk status <project> [--limit N] [--offset N] [--socket PATH] [--db PATH] [--json]\n  bwrk dashboard <project> [--db PATH] [--json]\n  bwrk work create <project> <work-id> <title> [--db PATH] [--json]\n  bwrk work list <project> [--limit N] [--offset N] [--db PATH] [--json]\n  bwrk work show <project> <work-id> [--db PATH] [--json]\n  bwrk work claim <project> <work-id> [--session SESSION_ID] [--lease-ttl DURATION] [--time-limit DURATION] [--socket PATH] [--db PATH] [--json]\n  bwrk agent guide [--project PROJECT] [--work WORK_ID] [--json]\n  bwrk next [--project PROJECT] [--work WORK_ID] [--json]\n  bwrk agent start [WORK_ID] [--project PROJECT] [--session SESSION_ID] [--lease-ttl DURATION] [--time-limit DURATION] [--socket PATH] [--json]\n  bwrk agent resume --project PROJECT --session SESSION_ID --attempt ATTEMPT_ID [--json]\n  bwrk agent release WORK_ID --project PROJECT --attempt ATTEMPT_ID --fence N [--socket PATH] [--reason CODE] [--json]\n  bwrk agent finish WORK_ID --close --project PROJECT --attempt ATTEMPT_ID --fence N --receipt PATH [--socket PATH] [--json]\n  bwrk agent finish WORK_ID --release --project PROJECT --attempt ATTEMPT_ID --fence N [--socket PATH] [--reason CODE] [--json]\n  bwrk evidence run --project PROJECT --work WORK_ID --gate GATE_ID [--attempt ATTEMPT_ID --fence N] [--json]\n  bwrk evidence add --project PROJECT --work WORK_ID --gate GATE_ID --receipt PATH [--json]";

#[derive(Clone, Debug, Eq, PartialEq)]
struct CliOptions {
    db: String,
    socket: Option<String>,
    project: Option<String>,
    actor: String,
    actor_role: Option<String>,
    harness: String,
    session: String,
    operation_id: Option<String>,
    expected_revision: Option<u64>,
    attempt: Option<String>,
    fence: Option<u64>,
    work: Option<String>,
    gate: Option<String>,
    receipt: Option<String>,
    reason: Option<String>,
    lease_ttl_ms: Option<u64>,
    time_limit_ms: Option<u64>,
    json: bool,
    close: bool,
    release: bool,
    include_expiry: bool,
    limit: Option<u64>,
    offset: Option<u64>,
    max_requests: Option<usize>,
    positionals: Vec<String>,
}

impl Default for CliOptions {
    fn default() -> Self {
        Self {
            db: ".boreal/boreal.sqlite".to_owned(),
            socket: None,
            project: None,
            actor: DEFAULT_ACTOR.to_owned(),
            actor_role: None,
            harness: DEFAULT_HARNESS.to_owned(),
            session: DEFAULT_SESSION.to_owned(),
            operation_id: None,
            expected_revision: None,
            attempt: None,
            fence: None,
            work: None,
            gate: None,
            receipt: None,
            reason: None,
            lease_ttl_ms: None,
            time_limit_ms: None,
            json: false,
            close: false,
            release: false,
            include_expiry: false,
            limit: None,
            offset: None,
            max_requests: None,
            positionals: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct ParsedCommand {
    path: Vec<String>,
    options: CliOptions,
}

#[derive(Clone, Debug)]
struct CliError {
    code: ErrorCode,
    outcome: ApplicationOutcome,
    message: String,
    exit: u8,
}

impl CliError {
    fn invalid(message: impl Into<String>) -> Self {
        Self::with(
            ErrorCode::InvalidArgument,
            ApplicationOutcome::Rejected,
            message,
        )
    }

    fn with(code: ErrorCode, outcome: ApplicationOutcome, message: impl Into<String>) -> Self {
        Self {
            code,
            outcome,
            message: message.into(),
            exit: exit_code(code),
        }
    }
}

#[derive(Clone, Debug)]
struct CliResult {
    outcome: ApplicationOutcome,
    revision: Option<u64>,
    data: Option<Value>,
}

fn main() -> ExitCode {
    let args = env::args().skip(1).collect::<Vec<_>>();
    if args.is_empty() || args.iter().any(|arg| arg == "--help" || arg == "-h") {
        println!("{HELP}");
        return ExitCode::SUCCESS;
    }
    if args.iter().any(|arg| arg == "--version") {
        println!("bwrk {API_VERSION}");
        return ExitCode::SUCCESS;
    }
    let json_output = args.iter().any(|arg| arg == "--json");
    let operation = operation_id(&args);
    match run(&args) {
        Ok(result) => {
            if json_output {
                print_envelope(
                    operation,
                    result.revision,
                    result.outcome,
                    result.data,
                    None,
                );
            } else if let Some(data) = result.data {
                println!("{}", serde_json::to_string_pretty(&data).unwrap());
            } else {
                println!("ok");
            }
            ExitCode::SUCCESS
        }
        Err(error) => {
            if json_output {
                print_envelope(
                    operation,
                    None,
                    error.outcome,
                    None,
                    Some(ProtocolError::new(
                        error.code,
                        error.message,
                        is_retryable(error.code),
                    )),
                );
            } else {
                eprintln!("error [{}]: {}", error.code, error.message);
            }
            ExitCode::from(error.exit)
        }
    }
}

fn print_envelope(
    operation_id: String,
    revision: Option<u64>,
    outcome: ApplicationOutcome,
    data: Option<Value>,
    error: Option<ProtocolError>,
) {
    let envelope = Envelope {
        api_version: API_VERSION.to_owned(),
        schema_version: schema::ENVELOPE.to_owned(),
        operation_id,
        revision,
        as_of: now(),
        next_status_change_at: None,
        transport: TransportOutcome::Ok,
        outcome,
        data,
        detail_ref: None,
        error,
    };
    let encoded = serde_json::to_string(&envelope).unwrap();
    debug_assert!(encoded.len() <= MAX_JSON_BYTES);
    println!("{encoded}");
}

fn run(args: &[String]) -> Result<CliResult, CliError> {
    let parsed = parse(args)?;
    let operation = operation_id(args);
    if parsed.path == ["service", "run"] {
        return service::run_service(&parsed, &operation);
    }
    if parsed.options.socket.is_some() && service::supports(&parsed) {
        return service::request(&parsed, &operation);
    }
    let path = PathBuf::from(&parsed.options.db);
    ensure_db_parent(&path)?;
    if parsed.path == ["init"] {
        let project = project_argument(&parsed, 0)?;
        let store = SqliteStore::open(&path, SCHEMA).map_err(map_store_error)?;
        let app = WorkApplication::new(&store);
        let result = app
            .init_project(
                &ProjectId::new(project),
                &parsed.options.actor,
                "agent",
                "cli",
                "CLI agent",
                &now(),
                operation,
            )
            .map_err(map_application_error)?;
        return Ok(changed(result.snapshot_revision, None));
    }
    let store = SqliteStore::open(&path, SCHEMA).map_err(map_store_error)?;
    let app = WorkApplication::new(&store);
    let adapter = SqliteAttemptAdapter::new(&store);
    dispatch(&parsed, &operation, &app, &adapter, &store)
}

fn dispatch<A: boreal_application::AttemptLifecycleAdapter>(
    parsed: &ParsedCommand,
    operation: &str,
    app: &WorkApplication<'_>,
    adapter: &A,
    store: &SqliteStore,
) -> Result<CliResult, CliError> {
    let path = parsed.path.iter().map(String::as_str).collect::<Vec<_>>();
    match path.as_slice() {
        [command] if *command == "status" || *command == "prime" || *command == "dashboard" => {
            list_result(parsed, app)
        }
        ["work", "list"] => list_result(parsed, app),
        ["work", "show"] => show_work_result(parsed, app, store),
        ["work", "create"] => create_work_result(parsed, app, operation),
        ["work", "claim"] => claim_result(parsed, app, adapter, operation, store),
        ["work", "accept"] => attempt_mutation_result(
            parsed,
            app,
            adapter,
            operation,
            store,
            AttemptOperation::Accept,
        ),
        ["work", "heartbeat"] => attempt_mutation_result(
            parsed,
            app,
            adapter,
            operation,
            store,
            AttemptOperation::Heartbeat,
        ),
        ["work", "release"] => attempt_mutation_result(
            parsed,
            app,
            adapter,
            operation,
            store,
            AttemptOperation::Release,
        ),
        ["work", "finish"] => attempt_mutation_result(
            parsed,
            app,
            adapter,
            operation,
            store,
            AttemptOperation::Submit,
        ),
        ["agent", "guide"] => guide_result(parsed, app, store),
        ["agent", "resume"] => resume_result(parsed, app, store),
        ["agent", "start"] => start_result(parsed, app, adapter, operation, store),
        ["agent", "release"] => attempt_mutation_result(
            parsed,
            app,
            adapter,
            operation,
            store,
            AttemptOperation::Release,
        ),
        ["agent", "finish"] => finish_result(parsed, app, adapter, operation, store),
        ["next"] | ["agent", "next"] => next_result(parsed, app, store),
        ["evidence", "add"] => evidence_add_result(parsed, app),
        ["evidence", "run"] => evidence_run_result(
            parsed,
            app,
            adapter,
            store,
            operation,
            &PathBuf::from(&parsed.options.db)
                .parent()
                .unwrap_or(Path::new("."))
                .join(GATE_COMMANDS_DIR),
        ),
        _ => Err(CliError::invalid(format!(
            "unknown command path: {}",
            parsed.path.join(" ")
        ))),
    }
}

fn parse(args: &[String]) -> Result<ParsedCommand, CliError> {
    if args.is_empty() {
        return Err(CliError::invalid("a command path is required"));
    }
    let mut options = CliOptions {
        db: ".boreal/boreal.sqlite".to_owned(),
        socket: None,
        project: None,
        actor: DEFAULT_ACTOR.to_owned(),
        actor_role: None,
        harness: DEFAULT_HARNESS.to_owned(),
        session: DEFAULT_SESSION.to_owned(),
        operation_id: None,
        expected_revision: None,
        attempt: None,
        fence: None,
        work: None,
        gate: None,
        receipt: None,
        reason: None,
        lease_ttl_ms: None,
        time_limit_ms: None,
        json: false,
        close: false,
        release: false,
        include_expiry: false,
        limit: None,
        offset: None,
        max_requests: None,
        positionals: Vec::new(),
    };
    let mut path = Vec::new();
    let mut index = 0;
    while index < args.len() {
        let arg = &args[index];
        if arg == "--json" {
            options.json = true;
            index += 1;
            continue;
        }
        if arg == "--close" {
            options.close = true;
            index += 1;
            continue;
        }
        if arg == "--release" {
            options.release = true;
            index += 1;
            continue;
        }
        if arg == "--include-expiry" {
            options.include_expiry = true;
            index += 1;
            continue;
        }
        if arg.starts_with('-') {
            let name = arg.as_str();
            let canonical = match name {
                "--revision" => "--expected-revision",
                "--ttl" => "--lease-ttl",
                _ => name,
            };
            if canonical == "--protocol-version" {
                let value = option_value(args, &mut index, canonical)?;
                if value != "2" {
                    return Err(CliError::with(
                        ErrorCode::ProtocolMismatch,
                        ApplicationOutcome::Failed,
                        "--protocol-version must be 2",
                    ));
                }
                continue;
            }
            let value = match canonical {
                "--db"
                | "--socket"
                | "--project"
                | "--actor"
                | "--harness"
                | "--session"
                | "--operation-id"
                | "--expected-revision"
                | "--attempt"
                | "--fence"
                | "--work"
                | "--gate"
                | "--receipt"
                | "--reason"
                | "--operator-reason"
                | "--reviewer"
                | "--actor-role"
                | "--lease-ttl"
                | "--time-limit"
                | "--limit"
                | "--offset"
                | "--max-requests" => Some(option_value(args, &mut index, canonical)?),
                _ => None,
            };
            match canonical {
                "--db" => options.db = value.unwrap(),
                "--socket" => options.socket = Some(value.unwrap()),
                "--project" => options.project = Some(value.unwrap()),
                "--actor" => options.actor = value.unwrap(),
                "--actor-role" => {
                    let role = value.unwrap();
                    if !matches!(
                        role.as_str(),
                        "agent" | "reviewer" | "operator" | "publisher"
                    ) {
                        return Err(CliError::invalid(format!("invalid actor role: {role}")));
                    }
                    options.actor_role = Some(role);
                }
                "--harness" => options.harness = value.unwrap(),
                "--session" => options.session = value.unwrap(),
                "--operation-id" => options.operation_id = Some(value.unwrap()),
                "--expected-revision" => {
                    options.expected_revision = Some(parse_revision(&value.unwrap())?)
                }
                "--attempt" => options.attempt = Some(value.unwrap()),
                "--fence" => {
                    let fence = parse_revision(&value.unwrap())?;
                    if fence == 0 {
                        return Err(CliError::invalid("--fence must be positive"));
                    }
                    options.fence = Some(fence);
                }
                "--work" => options.work = Some(value.unwrap()),
                "--gate" => options.gate = Some(value.unwrap()),
                "--receipt" => options.receipt = Some(value.unwrap()),
                "--reason" | "--operator-reason" => options.reason = Some(value.unwrap()),
                "--reviewer" => {
                    let _ = value;
                }
                "--lease-ttl" => {
                    let parsed = parse_duration(&value.unwrap())?;
                    if options.lease_ttl_ms.replace(parsed).is_some() {
                        return Err(CliError::invalid(
                            "--ttl and --lease-ttl are mutually exclusive",
                        ));
                    }
                }
                "--time-limit" => options.time_limit_ms = Some(parse_duration(&value.unwrap())?),
                "--limit" => {
                    let limit = parse_revision(&value.unwrap())?;
                    if !(1..=100).contains(&limit) {
                        return Err(CliError::invalid("--limit must be in the range 1..=100"));
                    }
                    options.limit = Some(limit);
                }
                "--offset" => options.offset = Some(parse_revision(&value.unwrap())?),
                "--max-requests" => {
                    let value = parse_revision(&value.unwrap())?;
                    options.max_requests = Some(usize::try_from(value).map_err(|_| {
                        CliError::invalid("--max-requests is too large for this platform")
                    })?);
                }
                _ => return Err(CliError::invalid(format!("unknown option: {name}"))),
            }
            index += 1;
        } else if path.len() < 2 && !matches!(path.first().map(String::as_str), Some("init")) {
            path.push(arg.clone());
            index += 1;
        } else {
            options.positionals.push(arg.clone());
            index += 1;
        }
    }
    if path.first().is_some_and(|value| value == "init") {
        options.positionals.extend(path.drain(1..));
    } else if matches!(
        path.first().map(String::as_str),
        Some("status" | "prime" | "dashboard")
    ) && options.project.is_none()
    {
        if let Some(project) = path.get(1).cloned() {
            options.project = Some(project);
            path.truncate(1);
        }
    } else if path.first().is_some_and(|value| value == "work")
        && options.project.is_none()
        && matches!(
            path.get(1).map(String::as_str),
            Some("create" | "show" | "claim")
        )
    {
        if let Some(project) = path.get(2).cloned() {
            options.project = Some(project);
            options.positionals.extend(path.drain(3..));
            path.truncate(2);
        }
    }
    if options.lease_ttl_ms.is_none() {
        options.lease_ttl_ms = Some(AttemptPolicy::default().default_lease_ttl_ms);
    }
    if options.time_limit_ms.is_none() {
        options.time_limit_ms = Some(AttemptPolicy::default().default_hard_time_limit_ms);
    }
    validate_command(&path, &options)?;
    Ok(ParsedCommand { path, options })
}

fn validate_command(path: &[String], options: &CliOptions) -> Result<(), CliError> {
    let path = path.iter().map(String::as_str).collect::<Vec<_>>();
    let positionals = options.positionals.len();
    let valid = match path.as_slice() {
        ["agent", "guide"] | ["agent", "resume"] | ["next"] | ["agent", "next"] => positionals == 0,
        ["agent", "start"] => positionals <= 1,
        ["agent", "release"] | ["agent", "finish"] => positionals == 1,
        ["evidence", "run"] => positionals == 0 && options.work.is_some() && options.gate.is_some(),
        ["evidence", "add"] => {
            positionals == 0
                && options.work.is_some()
                && options.gate.is_some()
                && options.receipt.is_some()
        }
        _ => true,
    };
    if !valid {
        return Err(CliError::invalid(format!(
            "invalid arguments for command path: {}",
            path.join(" ")
        )));
    }
    if matches!(path.as_slice(), ["evidence", "run"] | ["evidence", "add"])
        && options.attempt.is_some() != options.fence.is_some()
    {
        return Err(CliError::invalid(
            "--attempt and --fence must be supplied together",
        ));
    }
    Ok(())
}

fn option_value(args: &[String], index: &mut usize, name: &str) -> Result<String, CliError> {
    let current = args.get(*index).map(String::as_str);
    if current != Some(name) && !(name == "--lease-ttl" && current == Some("--ttl")) {
        return Err(CliError::invalid(format!("expected option {name}")));
    }
    let value = args
        .get(*index + 1)
        .ok_or_else(|| CliError::invalid(format!("missing value for {current:?}")))?;
    if value.starts_with('-') {
        return Err(CliError::invalid(format!("missing value for {current:?}")));
    }
    *index += 1;
    Ok(value.clone())
}

fn project_argument(parsed: &ParsedCommand, index: usize) -> Result<String, CliError> {
    parsed
        .options
        .project
        .clone()
        .or_else(|| parsed.options.positionals.get(index).cloned())
        .ok_or_else(|| CliError::invalid("missing project identifier"))
}

fn work_argument(parsed: &ParsedCommand, index: usize) -> Result<String, CliError> {
    parsed
        .options
        .work
        .clone()
        .or_else(|| parsed.options.positionals.get(index).cloned())
        .ok_or_else(|| CliError::invalid("missing work identifier"))
}

fn parse_revision(value: &str) -> Result<u64, CliError> {
    value
        .parse()
        .map_err(|_| CliError::invalid(format!("invalid revision: {value}")))
}

fn parse_duration(value: &str) -> Result<u64, CliError> {
    let split = value
        .char_indices()
        .find(|(_, character)| !character.is_ascii_digit())
        .ok_or_else(|| CliError::invalid("duration must end in ms, s, m, h, or d"))?;
    let (number, unit) = value.split_at(split.0);
    if number.is_empty() || unit.len() > 2 || !matches!(unit, "ms" | "s" | "m" | "h" | "d") {
        return Err(CliError::invalid(format!("invalid duration: {value}")));
    }
    let multiplier = match unit {
        "ms" => 1,
        "s" => 1_000,
        "m" => 60 * 1_000,
        "h" => 60 * 60 * 1_000,
        "d" => 24 * 60 * 60 * 1_000,
        _ => unreachable!(),
    };
    number
        .parse::<u64>()
        .ok()
        .and_then(|number| number.checked_mul(multiplier))
        .filter(|value| *value > 0)
        .ok_or_else(|| CliError::invalid(format!("invalid duration: {value}")))
}

fn list_result(parsed: &ParsedCommand, app: &WorkApplication<'_>) -> Result<CliResult, CliError> {
    let project = ProjectId::new(project_argument(parsed, 0)?);
    let page = app
        .list_work(
            &project,
            parsed.options.limit.unwrap_or(100),
            parsed.options.offset.unwrap_or(0),
        )
        .map_err(map_application_error)?;
    let items = page.items.into_iter().map(|item| json!({"work_id": item.work_id, "kind": item.kind, "lifecycle": item.lifecycle, "dispatch_policy": item.dispatch_policy, "title": item.title, "parent_id": item.parent_id})).collect::<Vec<_>>();
    bounded_result(
        Some(json!({"revision": page.revision.0, "total": page.total, "items": items})),
        Some(page.revision.0),
    )
}

fn show_work_result(
    parsed: &ParsedCommand,
    app: &WorkApplication<'_>,
    store: &SqliteStore,
) -> Result<CliResult, CliError> {
    let project = ProjectId::new(project_argument(parsed, 0)?);
    let work_id = work_argument(parsed, 1)?;
    let item = app
        .show_work(&project, &work_id)
        .map_err(map_application_error)?;
    let revision = store_revision(store, &project)?;
    bounded_result(
        Some(
            json!({"work_id": item.work_id, "kind": item.kind, "lifecycle": item.lifecycle, "title": item.title, "description": item.description}),
        ),
        Some(revision),
    )
}

fn create_work_result(
    parsed: &ParsedCommand,
    app: &WorkApplication<'_>,
    operation: &str,
) -> Result<CliResult, CliError> {
    let project = ProjectId::new(project_argument(parsed, 0)?);
    let work_id = parsed
        .options
        .positionals
        .get(1)
        .cloned()
        .ok_or_else(|| CliError::invalid("missing work identifier"))?;
    let title = parsed
        .options
        .positionals
        .get(2)
        .cloned()
        .ok_or_else(|| CliError::invalid("missing work title"))?;
    let work = WorkItem {
        id: WorkId::new(work_id),
        project_id: project,
        kind: WorkKind::Milestone,
        parent_id: None,
        title,
        description: String::new(),
        lifecycle: PersistedLifecycle::Open,
        priority: 0,
        dispatch_policy: DispatchPolicy::Automatic,
        hard_holds: Vec::new(),
        acceptance_profile: AcceptanceProfile::focused(),
    };
    let result = app
        .create_work_as(&work, &parsed.options.actor, &now(), operation.to_owned())
        .map_err(map_application_error)?;
    bounded_result(
        Some(json!({"work_id": result.value.work_id, "title": result.value.title})),
        Some(result.snapshot_revision),
    )
}

fn claim_result<A: boreal_application::AttemptLifecycleAdapter>(
    parsed: &ParsedCommand,
    app: &WorkApplication<'_>,
    adapter: &A,
    operation: &str,
    store: &SqliteStore,
) -> Result<CliResult, CliError> {
    let project = ProjectId::new(project_argument(parsed, 0)?);
    let work_index = if parsed.path == ["work", "claim"] {
        1
    } else {
        0
    };
    let work_id = work_argument(parsed, work_index)?;
    // Validate the project/work foreign-key path before registering a session.
    // Actor existence is then checked by the atomic session-registration
    // transaction itself, before it can insert a session row.
    app.show_work(&project, &work_id)
        .map_err(map_application_error)?;
    let _ = store
        .project_revision(project.as_str())
        .map_err(map_store_error)?;
    let claimed_at = TimestampMs::from_millis(now_ms_u64());
    let deadlines = AttemptPolicy::default()
        .deadlines(
            claimed_at,
            parsed.options.lease_ttl_ms,
            parsed.options.time_limit_ms,
        )
        .map_err(|error| CliError::invalid(error.to_string()))?;
    let attempt_id = parsed
        .options
        .attempt
        .clone()
        .unwrap_or_else(|| attempt_id_for(operation));
    let expected_revision = register_session_if_requested(
        app,
        &project,
        &parsed.options,
        operation,
        claimed_at,
        parsed.options.expected_revision,
    )?;
    let result = app
        .claim(
            &project,
            &work_id,
            &parsed.options.actor,
            &parsed.options.harness,
            Some(parsed.options.session.as_str()),
            &attempt_id,
            operation,
            &request_digest(operation, &project, &work_id, &attempt_id),
            expected_revision,
            &stamp(claimed_at.as_millis()),
            &stamp(deadlines.lease_deadline.as_millis()),
            &stamp(deadlines.hard_deadline.as_millis()),
        )
        .map_err(map_application_error)?;
    let snapshot = adapter
        .current_attempt(&project, &AttemptId::new(result.value.attempt_id.clone()))
        .map_err(|error| map_application_error(ApplicationError::from(error)))?;
    bounded_result(
        Some(json!({
            "attempt_id": result.value.attempt_id,
            "fence": result.value.fence,
            "phase": "claimed",
            "lease_deadline": stamp(snapshot.lease_deadline.as_millis()),
            "hard_deadline": stamp(snapshot.hard_deadline.as_millis()),
            "deadline_source": "claim_hard_budget",
            "replayed": result.value.replayed,
            "current": snapshot.current
        })),
        Some(result.snapshot_revision),
    )
}

fn start_result<A: boreal_application::AttemptLifecycleAdapter>(
    parsed: &ParsedCommand,
    app: &WorkApplication<'_>,
    adapter: &A,
    operation: &str,
    store: &SqliteStore,
) -> Result<CliResult, CliError> {
    let project = ProjectId::new(project_argument(parsed, 0)?);
    let work_id = work_argument(parsed, 0)?;
    if let Some(current) = store
        .current_attempt_for_work(project.as_str(), &work_id)
        .map_err(map_store_error)?
    {
        if current.actor_id != parsed.options.actor {
            return Err(CliError::with(
                ErrorCode::AttemptConflict,
                ApplicationOutcome::Conflict,
                "the work already has a current attempt owned by another actor or session",
            ));
        }
        let attempt_id = AttemptId::new(current.attempt_id);
        let snapshot = adapter
            .current_attempt(&project, &attempt_id)
            .map_err(|error| map_application_error(ApplicationError::from(error)))?;
        let request = attempt_request(
            &project,
            &work_id,
            &attempt_id,
            &parsed.options,
            snapshot.fence,
            &sub_operation(operation, "resume"),
        )?;
        let result = match snapshot.phase {
            AttemptPhase::Claimed => {
                let accepted = app
                    .accept(adapter, request)
                    .map_err(map_application_error)?;
                let accepted_snapshot = adapter
                    .current_attempt(&project, &attempt_id)
                    .map_err(|error| map_application_error(ApplicationError::from(error)))?;
                let started_request = attempt_request(
                    &project,
                    &work_id,
                    &attempt_id,
                    &parsed.options,
                    accepted_snapshot.fence,
                    &sub_operation(operation, "start"),
                )?;
                let started = app
                    .start(adapter, started_request)
                    .map_err(map_application_error)?;
                let _ = accepted;
                started
            }
            AttemptPhase::Accepted => app.start(adapter, request).map_err(map_application_error)?,
            AttemptPhase::Running | AttemptPhase::Verifying => {
                return attempt_result(
                    OperationResult {
                        operation_id: operation.to_owned(),
                        snapshot_revision: store_revision(store, &project)?,
                        changed: false,
                        value: boreal_application::AttemptMutation {
                            operation_id: OperationId::new(operation),
                            request_digest: request.request_digest,
                            attempt_id,
                            fence: snapshot.fence,
                            phase: snapshot.phase,
                            lease_deadline: snapshot.lease_deadline,
                            hard_deadline: snapshot.hard_deadline,
                            revision: store_revision(store, &project)?,
                            changed: false,
                            replayed: true,
                        },
                    },
                    &snapshot,
                    store,
                    &project,
                )
            }
            _ => {
                return Err(CliError::with(
                    ErrorCode::AttemptExpired,
                    ApplicationOutcome::Rejected,
                    "the current attempt is not resumable",
                ))
            }
        };
        let updated = adapter
            .current_attempt(&project, &attempt_id)
            .map_err(|error| map_application_error(ApplicationError::from(error)))?;
        return attempt_result(result, &updated, store, &project);
    }
    let result = claim_result(parsed, app, adapter, operation, store)?;
    let attempt_id = result
        .data
        .as_ref()
        .and_then(|value| value.get("attempt_id"))
        .and_then(Value::as_str)
        .ok_or_else(|| {
            CliError::with(
                ErrorCode::UnknownOutcome,
                ApplicationOutcome::Unknown,
                "claim did not return an attempt id",
            )
        })?
        .to_owned();
    let attempt = AttemptId::new(attempt_id);
    let snapshot = adapter
        .current_attempt(&project, &attempt)
        .map_err(|error| map_application_error(ApplicationError::from(error)))?;
    let accepted = app
        .accept(
            adapter,
            attempt_request(
                &project,
                &work_id,
                &attempt,
                &parsed.options,
                snapshot.fence,
                &sub_operation(operation, "accept"),
            )?,
        )
        .map_err(map_application_error)?;
    let accepted_snapshot = adapter
        .current_attempt(&project, &attempt)
        .map_err(|error| map_application_error(ApplicationError::from(error)))?;
    let started = app
        .start(
            adapter,
            attempt_request(
                &project,
                &work_id,
                &attempt,
                &parsed.options,
                accepted_snapshot.fence,
                &sub_operation(operation, "start"),
            )?,
        )
        .map_err(map_application_error)?;
    let outcome = if accepted.changed || started.changed {
        ApplicationOutcome::Changed
    } else {
        ApplicationOutcome::Unchanged
    };
    let mut data = attempt_json(&started.value, &accepted_snapshot);
    data["phase"] = Value::String("running".to_owned());
    bounded_result(Some(data), Some(started.snapshot_revision)).map(|mut value| {
        value.outcome = outcome;
        value
    })
}

fn resume_result(
    parsed: &ParsedCommand,
    _app: &WorkApplication<'_>,
    store: &SqliteStore,
) -> Result<CliResult, CliError> {
    let project = ProjectId::new(project_argument(parsed, 0)?);
    let attempt_id = parsed
        .options
        .attempt
        .clone()
        .or_else(|| {
            find_session_work(store, &project, &parsed.options.actor).and_then(|work| {
                store
                    .current_attempt_for_work(project.as_str(), &work)
                    .ok()
                    .flatten()
                    .map(|attempt| attempt.attempt_id)
            })
        })
        .ok_or_else(|| CliError::invalid("agent resume requires a current attempt or --attempt"))?;
    let attempt = store
        .current_attempt(project.as_str(), &attempt_id)
        .map_err(map_store_error)?;
    if attempt
        .session_id
        .as_deref()
        .is_some_and(|session| session != parsed.options.session)
    {
        return Err(CliError::with(
            ErrorCode::StaleContext,
            ApplicationOutcome::Rejected,
            "the attempt is not bound to this session",
        ));
    }
    guide_for_work(parsed, _app, store, &project, &attempt.work_id, true)
}

fn guide_result(
    parsed: &ParsedCommand,
    app: &WorkApplication<'_>,
    store: &SqliteStore,
) -> Result<CliResult, CliError> {
    let project = ProjectId::new(project_argument(parsed, 0)?);
    let selected = parsed
        .options
        .work
        .clone()
        .or_else(|| find_session_work(store, &project, &parsed.options.actor));
    selected.map_or_else(
        || guide_idle(parsed, store, &project),
        |work| guide_for_work(parsed, app, store, &project, &work, false),
    )
}

fn next_result(
    parsed: &ParsedCommand,
    app: &WorkApplication<'_>,
    store: &SqliteStore,
) -> Result<CliResult, CliError> {
    let project = ProjectId::new(project_argument(parsed, 0)?);
    if let Some(work) = find_session_work(store, &project, &parsed.options.actor)
        .or_else(|| parsed.options.work.clone())
    {
        let result = guide_for_work(parsed, app, store, &project, &work, false)?;
        let guide: AgentGuideDto = serde_json::from_value(result.data.ok_or_else(|| {
            CliError::with(
                ErrorCode::GuidanceUnavailable,
                ApplicationOutcome::Failed,
                "guide returned no data",
            )
        })?)
        .map_err(|error| {
            CliError::with(
                ErrorCode::GuidanceUnavailable,
                ApplicationOutcome::Failed,
                error.to_string(),
            )
        })?;
        return next_from_guide(parsed, result.revision, guide);
    }
    let page = app
        .list_work(&project, 100, 0)
        .map_err(map_application_error)?;
    if let Some(item) = page
        .items
        .into_iter()
        .find(|item| item.lifecycle == "open" && item.dispatch_policy == "automatic")
    {
        let next = AgentNextDto {
            kind: "agent_next".to_owned(),
            next_schema_version: schema::NEXT.to_owned(),
            mode: "discover".to_owned(),
            selection: "ready_work".to_owned(),
            status: NextStatusDto {
                display_status: "ready".to_owned(),
                work_id: Some(item.work_id.clone()),
                reason_codes: Vec::new(),
                claimable_for_actor: true,
            },
            reason: NextReasonDto {
                code: "ready_work_selected".to_owned(),
                message: "One open automatic work item is available for this actor.".to_owned(),
                selection_key: format!("ready|{}|agent.start@v1", item.work_id),
            },
            next_action: Some(start_action(
                &parsed.options,
                &project,
                &item.work_id,
                page.revision.0,
            )),
            context_refs: vec![ContextRefDto {
                reference_type: "work".to_owned(),
                id: item.work_id,
                revision: page.revision.0,
            }],
            no_goal: parsed.options.work.is_none(),
        };
        return typed_result(ApplicationOutcome::Unchanged, Some(page.revision.0), next);
    }
    let next = AgentNextDto {
        kind: "agent_next".to_owned(),
        next_schema_version: schema::NEXT.to_owned(),
        mode: "idle".to_owned(),
        selection: "none".to_owned(),
        status: NextStatusDto {
            display_status: "idle".to_owned(),
            work_id: None,
            reason_codes: vec!["no_safe_action".to_owned()],
            claimable_for_actor: false,
        },
        reason: NextReasonDto {
            code: "no_safe_action".to_owned(),
            message: "No current attempt or open automatic work item is available.".to_owned(),
            selection_key: format!("idle|{}|agent.next@v1", project.as_str()),
        },
        next_action: None,
        context_refs: Vec::new(),
        no_goal: parsed.options.work.is_none(),
    };
    typed_result(ApplicationOutcome::Unchanged, Some(page.revision.0), next)
}

fn guide_for_work(
    parsed: &ParsedCommand,
    app: &WorkApplication<'_>,
    store: &SqliteStore,
    project: &ProjectId,
    work_id: &str,
    resume: bool,
) -> Result<CliResult, CliError> {
    let page = app
        .list_work(project, 100, 0)
        .map_err(map_application_error)?;
    let work = page
        .items
        .iter()
        .find(|item| item.work_id == work_id)
        .ok_or_else(|| {
            CliError::with(
                ErrorCode::NotFound,
                ApplicationOutcome::Rejected,
                format!("work not found: {work_id}"),
            )
        })?;
    let current = store
        .current_attempt_for_work(project.as_str(), work_id)
        .map_err(map_store_error)?;
    let (display_status, state, attempt_id, fence, reason_codes, next_action) = guide_state(
        parsed,
        project,
        work,
        current.as_ref(),
        page.revision.0,
        resume,
    )?;
    let dto = AgentGuideDto {
        kind: "agent_guide".to_owned(),
        guide_schema_version: schema::GUIDANCE.to_owned(),
        context: GuidanceContextDto {
            mode: if attempt_id.is_some() {
                "resume"
            } else {
                "discover"
            }
            .to_owned(),
            project_id: project.as_str().to_owned(),
            actor_id: parsed.options.actor.clone(),
            harness_id: Some(parsed.options.harness.clone()),
            session_id: Some(parsed.options.session.clone()),
            project_revision: page.revision.0,
        },
        status: GuidanceStatusDto {
            state,
            display_status,
            work_id: Some(work_id.to_owned()),
            attempt_id,
            fence,
            summary: "Follow the current bounded action and its required obligations.".to_owned(),
        },
        requirements: reason_codes
            .iter()
            .map(|reason| RequirementDto {
                id: format!("reason:{reason}"),
                kind: "status".to_owned(),
                severity: if reason.contains("blocked") || reason.contains("expired") {
                    "blocking"
                } else {
                    "required"
                }
                .to_owned(),
                state: "open".to_owned(),
                reason: reason.clone(),
            })
            .collect(),
        next_action,
        provenance: GuidanceProvenanceDto {
            registry_version: "directives.v1".to_owned(),
            registry_path: "boreal.agent.directive.registry.v1".to_owned(),
            source_snapshot_hash: "sha256:unknown".to_owned(),
            config_identity: "sha256:unknown".to_owned(),
            gap_codes: reason_codes,
            workflow_refs: vec![
                "boreal.workflow.claim.v1".to_owned(),
                "boreal.workflow.finish.v1".to_owned(),
            ],
        },
        selection_key: format!("{}|{}|agent.guide@v1", work_id, page.revision.0),
    };
    typed_result(ApplicationOutcome::Unchanged, Some(page.revision.0), dto)
}

type GuideState = (
    String,
    String,
    Option<String>,
    Option<u64>,
    Vec<String>,
    Option<NextActionDto>,
);

fn guide_state(
    parsed: &ParsedCommand,
    project: &ProjectId,
    work: &boreal_store::WorkRecord,
    current: Option<&AttemptRecord>,
    revision: u64,
    _resume: bool,
) -> Result<GuideState, CliError> {
    if let Some(attempt) = current {
        let expired = attempt.phase == AttemptPhase::ExpiryPending
            || now_ms_u64() >= parse_stamp_ms(&attempt.lease_deadline).unwrap_or(u64::MAX);
        return Ok((
            phase_status(attempt.phase).to_owned(),
            if expired {
                "expired_review"
            } else {
                "active_attempt"
            }
            .to_owned(),
            Some(attempt.attempt_id.clone()),
            Some(attempt.fence),
            vec![if expired {
                "expired_review"
            } else {
                "attempt.active"
            }
            .to_owned()],
            (!expired).then(|| resume_action(&parsed.options, project, &attempt.work_id, attempt)),
        ));
    }
    let derived = if work.lifecycle == "closed" {
        boreal_domain::DerivedStatus::Closed
    } else if work.dispatch_policy == "automatic" && work.lifecycle == "open" {
        boreal_domain::DerivedStatus::Ready
    } else {
        boreal_domain::DerivedStatus::Blocked
    };
    let reasons = if derived == boreal_domain::DerivedStatus::Ready {
        Vec::new()
    } else {
        vec!["blocked_work".to_owned()]
    };
    let directive = guide_checked(boreal_application::GuidanceContext {
        work_id: work.work_id.as_str(),
        status: derived,
        reason_codes: &reasons,
        has_goal: true,
    })
    .map_err(|error| {
        CliError::with(
            ErrorCode::GuidanceUnavailable,
            ApplicationOutcome::Failed,
            error.to_string(),
        )
    })?;
    let action = if derived == boreal_domain::DerivedStatus::Ready {
        Some(start_action(
            &parsed.options,
            project,
            &work.work_id,
            revision,
        ))
    } else {
        Some(NextActionDto {
            directive_id: directive.registry_id.to_owned(),
            severity: "blocking".to_owned(),
            title: directive.explanation.to_owned(),
            instruction: directive.explanation.to_owned(),
            subject: SubjectDto {
                subject_type: "work".to_owned(),
                id: work.work_id.clone(),
            },
            safe_argv: directive
                .safe_argv
                .iter()
                .map(|value| value.to_string())
                .collect(),
            cwd: ".".to_owned(),
            runner: "boreal_cli".to_owned(),
            shell: false,
        })
    };
    Ok((
        format!("{derived:?}").to_ascii_lowercase(),
        if derived == boreal_domain::DerivedStatus::Ready {
            "ready"
        } else {
            "blocked"
        }
        .to_owned(),
        None,
        None,
        reasons,
        action,
    ))
}

fn guide_idle(
    parsed: &ParsedCommand,
    store: &SqliteStore,
    project: &ProjectId,
) -> Result<CliResult, CliError> {
    let revision = store_revision(store, project)?;
    let dto = AgentGuideDto {
        kind: "agent_guide".to_owned(),
        guide_schema_version: schema::GUIDANCE.to_owned(),
        context: GuidanceContextDto {
            mode: "idle".to_owned(),
            project_id: project.as_str().to_owned(),
            actor_id: parsed.options.actor.clone(),
            harness_id: Some(parsed.options.harness.clone()),
            session_id: Some(parsed.options.session.clone()),
            project_revision: revision,
        },
        status: GuidanceStatusDto {
            state: "idle".to_owned(),
            display_status: "idle".to_owned(),
            work_id: None,
            attempt_id: None,
            fence: None,
            summary: "No active attempt or selected work exists in this snapshot.".to_owned(),
        },
        requirements: Vec::new(),
        next_action: None,
        provenance: GuidanceProvenanceDto {
            registry_version: "directives.v1".to_owned(),
            registry_path: "boreal.agent.directive.registry.v1".to_owned(),
            source_snapshot_hash: "sha256:unknown".to_owned(),
            config_identity: "sha256:unknown".to_owned(),
            gap_codes: vec!["no_safe_action".to_owned()],
            workflow_refs: Vec::new(),
        },
        selection_key: format!("idle|{}|agent.guide@v1", project.as_str()),
    };
    typed_result(ApplicationOutcome::Unchanged, Some(revision), dto)
}

fn next_from_guide(
    parsed: &ParsedCommand,
    revision: Option<u64>,
    guide: AgentGuideDto,
) -> Result<CliResult, CliError> {
    let next = AgentNextDto {
        kind: "agent_next".to_owned(),
        next_schema_version: schema::NEXT.to_owned(),
        mode: guide.context.mode,
        selection: if guide.next_action.is_some() {
            "guided_action"
        } else {
            "none"
        }
        .to_owned(),
        status: NextStatusDto {
            display_status: guide.status.display_status,
            work_id: guide.status.work_id.clone(),
            reason_codes: guide.provenance.gap_codes.clone(),
            claimable_for_actor: guide.status.state == "ready",
        },
        reason: NextReasonDto {
            code: guide
                .provenance
                .gap_codes
                .first()
                .cloned()
                .unwrap_or_else(|| "no_safe_action".to_owned()),
            message: guide.status.summary,
            selection_key: guide.selection_key,
        },
        next_action: guide.next_action,
        context_refs: guide
            .status
            .work_id
            .map(|id| {
                vec![ContextRefDto {
                    reference_type: "work".to_owned(),
                    id,
                    revision: revision.unwrap_or_default(),
                }]
            })
            .unwrap_or_default(),
        no_goal: parsed.options.work.is_none(),
    };
    typed_result(ApplicationOutcome::Unchanged, revision, next)
}

#[derive(Clone, Copy)]
enum AttemptOperation {
    Accept,
    Heartbeat,
    Release,
    Submit,
}

fn attempt_mutation_result<A: boreal_application::AttemptLifecycleAdapter>(
    parsed: &ParsedCommand,
    app: &WorkApplication<'_>,
    adapter: &A,
    operation: &str,
    _store: &SqliteStore,
    kind: AttemptOperation,
) -> Result<CliResult, CliError> {
    let project = ProjectId::new(project_argument(parsed, 0)?);
    let work_id = work_argument(parsed, 0)?;
    let attempt_id = parsed
        .options
        .attempt
        .clone()
        .ok_or_else(|| CliError::invalid("fenced mutation requires --attempt"))?;
    let fence = parsed
        .options
        .fence
        .ok_or_else(|| CliError::invalid("fenced mutation requires --fence"))?;
    let request = attempt_request(
        &project,
        &work_id,
        &AttemptId::new(attempt_id.clone()),
        &parsed.options,
        Fence::new(fence),
        operation,
    )?;
    let result = match kind {
        AttemptOperation::Accept => app
            .accept(adapter, request)
            .map_err(map_application_error)?,
        AttemptOperation::Heartbeat => app
            .heartbeat(
                adapter,
                boreal_application::HeartbeatAttemptRequest {
                    attempt: request,
                    liveness: LivenessMetadata::empty(),
                },
            )
            .map_err(map_application_error)?,
        AttemptOperation::Release => app
            .release(
                adapter,
                EndAttemptRequest {
                    attempt: request,
                    reason: parsed.options.reason.clone(),
                },
            )
            .map_err(map_application_error)?,
        AttemptOperation::Submit => app
            .submit(adapter, request)
            .map_err(map_application_error)?,
    };
    let current = adapter
        .current_attempt(&project, &AttemptId::new(attempt_id))
        .or_else(|_| adapter.current_attempt(&project, &result.value.attempt_id))
        .ok();
    bounded_result(
        Some(attempt_json_with_current(
            &result.value,
            current.as_ref().is_some_and(|snapshot| snapshot.current),
        )),
        Some(result.snapshot_revision),
    )
}

fn finish_result<A: boreal_application::AttemptLifecycleAdapter>(
    parsed: &ParsedCommand,
    app: &WorkApplication<'_>,
    adapter: &A,
    operation: &str,
    store: &SqliteStore,
) -> Result<CliResult, CliError> {
    if parsed.options.close == parsed.options.release {
        return Err(CliError::invalid(
            "agent finish requires exactly one of --close or --release",
        ));
    }
    if parsed.options.release {
        return attempt_mutation_result(
            parsed,
            app,
            adapter,
            operation,
            store,
            AttemptOperation::Release,
        );
    }
    let work_id = work_argument(parsed, 0)?;
    let expected_attempt = parsed
        .options
        .attempt
        .as_deref()
        .ok_or_else(|| CliError::invalid("agent finish --close requires --attempt"))?;
    let expected_fence = parsed
        .options
        .fence
        .ok_or_else(|| CliError::invalid("agent finish --close requires --fence"))?;
    let receipt = read_receipt(parsed)?;
    if receipt.work_id.as_str() != work_id {
        return Err(CliError::with(
            ErrorCode::ReceiptInvalid,
            ApplicationOutcome::Rejected,
            "receipt work_id does not match the finish target",
        ));
    }
    if expected_attempt != receipt.attempt_id.as_str() {
        return Err(CliError::with(
            ErrorCode::ReceiptInvalid,
            ApplicationOutcome::Rejected,
            "receipt attempt_id does not match --attempt",
        ));
    }
    if expected_fence != receipt.fence.get() {
        return Err(CliError::with(
            ErrorCode::ReceiptInvalid,
            ApplicationOutcome::Rejected,
            "receipt fence does not match --fence",
        ));
    }
    let receipt_result = app
        .record_receipt(
            &parsed.options.actor,
            Some(parsed.options.session.as_str()),
            &receipt,
            parsed.options.expected_revision,
            TimestampMs::from_millis(now_ms_u64()),
        )
        .map_err(map_application_error)?;
    let submitted = attempt_mutation_result(
        parsed,
        app,
        adapter,
        &sub_operation(operation, "submit"),
        store,
        AttemptOperation::Submit,
    )?;
    let intent = boreal_application::CloseIntent {
        work_id: receipt.work_id.clone(),
        attempt_id: receipt.attempt_id.clone(),
        fence: receipt.fence,
        source_snapshot_hash: receipt.source_snapshot_hash.clone(),
        config_identity: receipt.config_identity.clone(),
        profile_id: receipt.coverage.profile_id.clone(),
        profile_version: receipt.coverage.profile_version.clone(),
        summary_id: None,
    };
    let requested = app
        .request_close(
            &parsed.options.actor,
            Some(parsed.options.session.as_str()),
            &intent,
            None,
            TimestampMs::from_millis(now_ms_u64()),
        )
        .map_err(map_application_error)?;
    let finalized = app
        .finalize_close(
            &parsed.options.actor,
            Some(parsed.options.session.as_str()),
            &intent,
            None,
            TimestampMs::from_millis(now_ms_u64()),
        )
        .map_err(map_application_error)?;
    let outcome = if finalized.close_intent.state == boreal_store::CloseIntentState::Finalized {
        ApplicationOutcome::Changed
    } else {
        ApplicationOutcome::Rejected
    };
    bounded_result(
        Some(json!({
            "attempt": submitted.data,
            "receipt_id": receipt.receipt_id.as_str(),
            "receipt_replayed": receipt_result.replayed,
            "close_intent": format!("{:?}", requested.close_intent.state).to_ascii_lowercase(),
            "close_state": format!("{:?}", finalized.close_intent.state).to_ascii_lowercase(),
            "close_replayed": finalized.replayed,
            "gates": finalized.diagnostics.map(|diagnostics| json!({
                "missing": diagnostics.missing,
                "gates": diagnostics.gates.into_iter().map(|gate| json!({
                    "gate_id": gate.gate_id,
                    "kind": format!("{:?}", gate.kind).to_ascii_lowercase(),
                    "required": gate.required,
                    "state": format!("{:?}", gate.state).to_ascii_lowercase(),
                    "receipt_id": gate.receipt_id,
                    "reason": gate.reason,
                })).collect::<Vec<_>>(),
            })),
        })),
        Some(finalized.revision),
    )
    .map(|mut result| {
        result.outcome = outcome;
        result
    })
}

fn evidence_add_result(
    parsed: &ParsedCommand,
    app: &WorkApplication<'_>,
) -> Result<CliResult, CliError> {
    if parsed.options.receipt.is_none() {
        return Err(CliError::invalid("evidence add requires --receipt PATH"));
    }
    let receipt = read_receipt(parsed)?;
    let result = app
        .record_receipt(
            &parsed.options.actor,
            None,
            &receipt,
            parsed.options.expected_revision,
            TimestampMs::from_millis(now_ms_u64()),
        )
        .map_err(map_application_error)?;
    bounded_result(
        Some(
            json!({"receipt_id": result.receipt.receipt_id, "operation_id": result.receipt.operation_id, "result": format!("{:?}", result.receipt.result).to_ascii_lowercase(), "replayed": result.replayed}),
        ),
        Some(result.revision),
    )
}

#[derive(Clone, Debug, Deserialize)]
struct GateDeclaration {
    gate_id: String,
    kind: String,
    executable: String,
    argv: Vec<String>,
    #[serde(default = "default_gate_cwd")]
    cwd: String,
    source_snapshot_hash: String,
    config_identity: String,
    environment_fingerprint: String,
    #[serde(default)]
    observables: Vec<String>,
    #[serde(default = "default_gate_runtime_ms")]
    max_runtime_ms: Option<u64>,
}

fn default_gate_cwd() -> String {
    ".".to_owned()
}

fn default_gate_runtime_ms() -> Option<u64> {
    Some(MAX_GATE_RUNTIME_MS)
}

fn evidence_run_result<A: boreal_application::AttemptLifecycleAdapter>(
    parsed: &ParsedCommand,
    app: &WorkApplication<'_>,
    adapter: &A,
    store: &SqliteStore,
    operation: &str,
    gate_root: &Path,
) -> Result<CliResult, CliError> {
    let project = ProjectId::new(project_argument(parsed, 0)?);
    let work_id = work_argument(parsed, 0)?;
    let gate_id = parsed
        .options
        .gate
        .clone()
        .ok_or_else(|| CliError::invalid("evidence run requires --gate"))?;
    let declaration = read_gate_declaration(gate_root, &gate_id)?;
    let attempt_record = store
        .current_attempt_for_work(project.as_str(), &work_id)
        .map_err(map_store_error)?
        .ok_or_else(|| {
            CliError::with(
                ErrorCode::AttemptConflict,
                ApplicationOutcome::Rejected,
                "evidence run requires a current attempt",
            )
        })?;
    let attempt_id = parsed
        .options
        .attempt
        .clone()
        .unwrap_or_else(|| attempt_record.attempt_id.clone());
    let fence = parsed.options.fence.unwrap_or(attempt_record.fence);
    if attempt_id != attempt_record.attempt_id || fence != attempt_record.fence {
        return Err(CliError::with(
            ErrorCode::StaleFence,
            ApplicationOutcome::Rejected,
            "evidence run target is not the current attempt",
        ));
    }
    let snapshot = adapter
        .current_attempt(&project, &AttemptId::new(attempt_id.clone()))
        .map_err(|error| map_application_error(ApplicationError::from(error)))?;
    if snapshot.actor_id.as_str() != parsed.options.actor {
        return Err(CliError::with(
            ErrorCode::AttemptConflict,
            ApplicationOutcome::Rejected,
            "evidence run actor does not own the current attempt",
        ));
    }
    if snapshot.session_id.as_ref().map(|value| value.as_str())
        != Some(parsed.options.session.as_str())
    {
        return Err(CliError::with(
            ErrorCode::AttemptConflict,
            ApplicationOutcome::Rejected,
            format!(
                "evidence run session does not own the current attempt (observed={:?}, expected={})",
                snapshot.session_id.as_ref().map(|value| value.as_str()),
                parsed.options.session
            ),
        ));
    }
    if snapshot.phase != AttemptPhase::Running {
        return Err(CliError::with(
            ErrorCode::AttemptConflict,
            ApplicationOutcome::Rejected,
            "evidence run requires an accepted and started attempt",
        ));
    }
    let status = boreal_application::project_status_from_store(
        store,
        &project,
        &boreal_domain::ActorContext {
            actor_id: ActorId::new(parsed.options.actor.clone()),
            role: boreal_domain::ActorRole::Agent,
        },
        TimestampMs::from_millis(now_ms_u64()),
        1_000,
        0,
    )
    .map_err(|message| {
        CliError::with(
            ErrorCode::ServiceUnavailable,
            ApplicationOutcome::Failed,
            message,
        )
    })?;
    let status_work = status
        .items
        .into_iter()
        .find(|item| item.work.id.as_str() == work_id)
        .ok_or_else(|| CliError::invalid("evidence run work is not in the project snapshot"))?;
    let gate = status_work
        .work
        .acceptance_profile
        .gates
        .iter()
        .find(|gate| {
            gate.id.as_str() == gate_id || gate.id.as_str().ends_with(&format!(":{gate_id}"))
        })
        .ok_or_else(|| {
            CliError::invalid("evidence run gate is not declared by the work acceptance profile")
        })?;
    let kind = parse_gate_kind(&declaration.kind)?;
    if kind != gate.kind || declaration.gate_id != gate_id {
        return Err(CliError::with(
            ErrorCode::ReceiptPolicyMismatch,
            ApplicationOutcome::Rejected,
            "gate declaration does not match the work acceptance profile",
        ));
    }
    let command = CommandSpec::new(declaration.executable.clone(), declaration.argv.clone());
    command
        .validate()
        .map_err(|error| map_application_error(ApplicationError::from(error)))?;
    let expectation = ReceiptExpectation {
        work_id: WorkId::new(work_id.clone()),
        attempt_id: AttemptId::new(attempt_id.clone()),
        fence: Fence::new(fence),
        source_snapshot_hash: SourceVersionId::new(declaration.source_snapshot_hash.clone()),
        config_identity: ConfigIdentity::new(declaration.config_identity.clone()),
        profile_id: status_work.work.acceptance_profile.id.clone(),
        profile_version: status_work.work.acceptance_profile.version.clone(),
        gate: AcceptanceGateDefinition {
            id: GateId::new(gate_id.clone()),
            kind,
            required: gate.required,
            command: Some(command),
            requires_attestation: true,
            required_observables: declaration.observables.clone(),
        },
    };
    let output_dir = gate_root.parent().unwrap_or(gate_root).join("evidence");
    fs::create_dir_all(&output_dir).map_err(|error| {
        CliError::with(
            ErrorCode::ServiceUnavailable,
            ApplicationOutcome::Failed,
            error.to_string(),
        )
    })?;
    let artifact_stem = fnv_digest(operation.as_bytes());
    let output_path = output_dir.join(format!("{artifact_stem}.out"));
    let execution = execute_gate_command(&declaration, &output_path, gate_root.parent())?;
    let request = EvidenceRunRequest {
        receipt_id: ReceiptId::new(format!("receipt-{operation}")),
        operation_id: OperationId::new(operation),
        expectation,
        cwd: declaration.cwd.clone(),
        environment_fingerprint: declaration.environment_fingerprint.clone(),
        attestation: ExecutorAttestation::BorealWitnessed,
    };
    let result = app
        .build_bounded_evidence_receipt(&request, &execution)
        .map_err(map_application_error)?;
    let inserted = app
        .record_receipt(
            &parsed.options.actor,
            Some(parsed.options.session.as_str()),
            &result.receipt,
            parsed.options.expected_revision,
            TimestampMs::from_millis(now_ms_u64()),
        )
        .map_err(map_application_error)?;
    let receipt_path = output_dir.join(format!("{artifact_stem}.json"));
    let receipt_json = json!({
        "schema_version": result.receipt.schema_version,
        "fixture_id": Value::Null,
        "receipt_id": result.receipt.receipt_id.as_str(),
        "operation_id": result.receipt.operation_id.as_str(),
        "subject": {
            "work_id": result.receipt.work_id.as_str(),
            "attempt_id": result.receipt.attempt_id.as_str(),
            "fence": result.receipt.fence.get(),
            "gate_id": result.receipt.gate_id.as_str(),
        },
        "executable": result.receipt.executable,
        "argv": result.receipt.argv,
        "cwd": result.receipt.cwd,
        "exit_code": result.receipt.exit_code,
        "started_at": stamp(result.receipt.started_at.as_millis()),
        "ended_at": stamp(result.receipt.ended_at.as_millis()),
        "source_snapshot_hash": result.receipt.source_snapshot_hash.as_str(),
        "config_identity": result.receipt.config_identity.as_str(),
        "environment_fingerprint": result.receipt.environment_fingerprint,
        "output_digest": result.receipt.output_digest.unwrap_or_default(),
        "output_ref": result.receipt.output_ref,
        "coverage": {
            "kind": format!("{:?}", result.receipt.coverage.kind).to_ascii_lowercase(),
            "profile_id": result.receipt.coverage.profile_id.as_str(),
            "profile_version": result.receipt.coverage.profile_version,
        },
        "attestation": "boreal_witnessed",
        "result": format!("{:?}", result.receipt.result).to_ascii_lowercase(),
        "retention": Value::Null,
    });
    fs::write(
        &receipt_path,
        serde_json::to_vec(&receipt_json).map_err(|error| {
            CliError::with(
                ErrorCode::ReceiptInvalid,
                ApplicationOutcome::Rejected,
                error.to_string(),
            )
        })?,
    )
    .map_err(|error| {
        CliError::with(
            ErrorCode::ServiceUnavailable,
            ApplicationOutcome::Failed,
            error.to_string(),
        )
    })?;
    bounded_result(
        Some(json!({
            "receipt_id": inserted.receipt.receipt_id,
            "operation_id": inserted.receipt.operation_id,
            "gate_id": inserted.receipt.gate_id,
            "result": format!("{:?}", inserted.receipt.result).to_ascii_lowercase(),
            "execution_outcome": format!("{:?}", result.outcome).to_ascii_lowercase(),
            "output_ref": inserted.receipt.output_ref,
            "receipt_path": receipt_path,
            "replayed": inserted.replayed,
        })),
        Some(inserted.revision),
    )
    .map(|mut result| {
        result.outcome = if inserted.replayed {
            ApplicationOutcome::Unchanged
        } else {
            ApplicationOutcome::Changed
        };
        result
    })
}

fn read_gate_declaration(gate_root: &Path, gate_id: &str) -> Result<GateDeclaration, CliError> {
    if gate_id.is_empty()
        || !gate_id
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || value == '_' || value == '-')
    {
        return Err(CliError::invalid(
            "gate identifier is not a safe policy filename",
        ));
    }
    let path = gate_root.join(format!("{gate_id}.json"));
    let text = fs::read_to_string(&path).map_err(|error| {
        CliError::with(
            ErrorCode::ReceiptInvalid,
            ApplicationOutcome::Rejected,
            format!("declared gate policy unavailable: {error}"),
        )
    })?;
    if text.len() > MAX_JSON_BYTES {
        return Err(CliError::with(
            ErrorCode::ReceiptInvalid,
            ApplicationOutcome::Rejected,
            "declared gate policy exceeds the inline bound",
        ));
    }
    let declaration: GateDeclaration = serde_json::from_str(&text).map_err(|error| {
        CliError::with(
            ErrorCode::ReceiptInvalid,
            ApplicationOutcome::Rejected,
            error.to_string(),
        )
    })?;
    if declaration.gate_id != gate_id
        || declaration.max_runtime_ms.unwrap_or(1) == 0
        || declaration.max_runtime_ms.unwrap_or(1) > MAX_GATE_RUNTIME_MS
    {
        return Err(CliError::with(
            ErrorCode::ReceiptPolicyMismatch,
            ApplicationOutcome::Rejected,
            "declared gate policy identity or runtime is invalid",
        ));
    }
    Ok(declaration)
}

fn parse_gate_kind(value: &str) -> Result<GateKind, CliError> {
    match value {
        "checkpoint" => Ok(GateKind::Checkpoint),
        "verification" => Ok(GateKind::Verification),
        "review" => Ok(GateKind::Review),
        "operator_approval" => Ok(GateKind::OperatorApproval),
        "summary" => Ok(GateKind::Summary),
        "audit" => Ok(GateKind::Audit),
        _ => Err(CliError::invalid("unknown declared gate kind")),
    }
}

fn execute_gate_command(
    declaration: &GateDeclaration,
    output_path: &Path,
    project_root: Option<&Path>,
) -> Result<BoundedExecutionResult, CliError> {
    let command = CommandSpec::new(declaration.executable.clone(), declaration.argv.clone());
    command
        .validate()
        .map_err(|error| map_application_error(ApplicationError::from(error)))?;
    let root = project_root
        .ok_or_else(|| {
            CliError::with(
                ErrorCode::ReceiptInvalid,
                ApplicationOutcome::Rejected,
                "gate policy has no project root",
            )
        })?
        .canonicalize()
        .map_err(|error| {
            CliError::with(
                ErrorCode::ReceiptInvalid,
                ApplicationOutcome::Rejected,
                format!("gate project root is unavailable: {error}"),
            )
        })?;
    let cwd = root.join(&declaration.cwd);
    let cwd = cwd.canonicalize().map_err(|error| {
        CliError::with(
            ErrorCode::ReceiptInvalid,
            ApplicationOutcome::Rejected,
            format!("gate cwd is unavailable: {error}"),
        )
    })?;
    if !cwd.starts_with(root) {
        return Err(CliError::with(
            ErrorCode::UnsafeCommand,
            ApplicationOutcome::Rejected,
            "gate cwd escapes the project root",
        ));
    }
    let stdout = fs::File::create(output_path).map_err(|error| {
        CliError::with(
            ErrorCode::ServiceUnavailable,
            ApplicationOutcome::Failed,
            error.to_string(),
        )
    })?;
    let stderr_path = output_path.with_extension("err");
    let stderr = fs::File::create(&stderr_path).map_err(|error| {
        CliError::with(
            ErrorCode::ServiceUnavailable,
            ApplicationOutcome::Failed,
            error.to_string(),
        )
    })?;
    let started_at = TimestampMs::from_millis(now_ms_u64());
    let mut child = Command::new(&command.executable)
        .args(command.argv.iter().skip(1))
        .current_dir(&cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr))
        .spawn()
        .map_err(|error| {
            CliError::with(
                ErrorCode::ReceiptInvalid,
                ApplicationOutcome::Rejected,
                format!("declared gate could not start: {error}"),
            )
        })?;
    let deadline = Instant::now() + Duration::from_millis(declaration.max_runtime_ms.unwrap_or(1));
    let mut timed_out = false;
    loop {
        if child
            .try_wait()
            .map_err(|error| {
                CliError::with(
                    ErrorCode::ServiceUnavailable,
                    ApplicationOutcome::Failed,
                    error.to_string(),
                )
            })?
            .is_some()
        {
            break;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            timed_out = true;
            break;
        }
        thread::sleep(Duration::from_millis(5));
    }
    let ended_at = TimestampMs::from_millis(now_ms_u64());
    let mut output = Vec::new();
    fs::File::open(output_path)
        .and_then(|mut file| file.read_to_end(&mut output))
        .map_err(|error| {
            CliError::with(
                ErrorCode::ServiceUnavailable,
                ApplicationOutcome::Failed,
                error.to_string(),
            )
        })?;
    let mut error_output = Vec::new();
    fs::File::open(&stderr_path)
        .and_then(|mut file| file.read_to_end(&mut error_output))
        .map_err(|error| {
            CliError::with(
                ErrorCode::ServiceUnavailable,
                ApplicationOutcome::Failed,
                error.to_string(),
            )
        })?;
    output.extend_from_slice(&error_output);
    if output.len() as u64 > boreal_application::MAX_OUTPUT_BYTES {
        return Err(CliError::with(
            ErrorCode::ReceiptInvalid,
            ApplicationOutcome::Rejected,
            "declared gate output exceeds the bounded limit",
        ));
    }
    let outcome = if timed_out {
        EvidenceExecutionOutcome::TimedOut
    } else if child
        .try_wait()
        .ok()
        .flatten()
        .is_some_and(|status| status.success())
    {
        EvidenceExecutionOutcome::Passed
    } else {
        EvidenceExecutionOutcome::Failed
    };
    let exit_code = if timed_out {
        None
    } else {
        child
            .try_wait()
            .ok()
            .flatten()
            .and_then(|status| status.code())
    };
    let _ = fs::remove_file(stderr_path);
    Ok(BoundedExecutionResult {
        outcome,
        exit_code,
        started_at,
        ended_at,
        output_size_bytes: output.len() as u64,
        output_digest: Some(fnv_digest(&output)),
        output_ref: Some(output_path.to_string_lossy().into_owned()),
        observables: declaration.observables.clone(),
    })
}

fn fnv_digest(bytes: &[u8]) -> String {
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in bytes {
        hash = (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3);
    }
    format!("fnv1a64:{hash:016x}")
}

fn read_receipt(parsed: &ParsedCommand) -> Result<ReceiptPayload, CliError> {
    let path = parsed
        .options
        .receipt
        .as_deref()
        .ok_or_else(|| CliError::invalid("this command requires --receipt PATH"))?;
    let text = fs::read_to_string(path).map_err(|error| {
        CliError::with(
            ErrorCode::ReceiptInvalid,
            ApplicationOutcome::Rejected,
            error.to_string(),
        )
    })?;
    if text.len() > MAX_JSON_BYTES {
        return Err(CliError::with(
            ErrorCode::ReceiptInvalid,
            ApplicationOutcome::Rejected,
            "receipt JSON exceeds the inline protocol bound",
        ));
    }
    let dto: boreal_protocol::models::ReceiptDto =
        serde_json::from_str(&text).map_err(|error| {
            CliError::with(
                ErrorCode::ReceiptInvalid,
                ApplicationOutcome::Rejected,
                error.to_string(),
            )
        })?;
    receipt_from_dto(dto)
}

fn receipt_from_dto(dto: boreal_protocol::models::ReceiptDto) -> Result<ReceiptPayload, CliError> {
    let attestation = match dto.attestation.as_str() {
        "boreal_witnessed" => ExecutorAttestation::BorealWitnessed,
        "external_attested" => ExecutorAttestation::ExternalAttested,
        "self_reported" => ExecutorAttestation::SelfReported,
        "unknown" => ExecutorAttestation::Unknown,
        value => {
            return Err(CliError::invalid(format!(
                "unknown receipt attestation: {value}"
            )))
        }
    };
    let result = match dto.result.as_str() {
        "passed" => ReceiptResult::Passed,
        "failed" => ReceiptResult::Failed,
        "stale" => ReceiptResult::Stale,
        value => {
            return Err(CliError::invalid(format!(
                "unknown receipt result: {value}"
            )))
        }
    };
    let kind = match dto.coverage.kind.as_str() {
        "checkpoint" => GateKind::Checkpoint,
        "verification" => GateKind::Verification,
        "review" => GateKind::Review,
        "operator_approval" => GateKind::OperatorApproval,
        "summary" => GateKind::Summary,
        "audit" => GateKind::Audit,
        value => {
            return Err(CliError::invalid(format!(
                "unknown receipt gate kind: {value}"
            )))
        }
    };
    let started_at = parse_stamp_ms(&dto.started_at)
        .ok_or_else(|| CliError::invalid("receipt started_at must use unix-ms:N"))?;
    let ended_at = parse_stamp_ms(&dto.ended_at)
        .ok_or_else(|| CliError::invalid("receipt ended_at must use unix-ms:N"))?;
    Ok(ReceiptPayload {
        schema_version: dto.schema_version,
        receipt_id: ReceiptId::new(dto.receipt_id),
        operation_id: OperationId::new(dto.operation_id),
        work_id: WorkId::new(dto.subject.work_id),
        attempt_id: AttemptId::new(dto.subject.attempt_id),
        fence: Fence::new(dto.subject.fence),
        gate_id: GateId::new(dto.subject.gate_id),
        executable: dto.executable,
        argv: dto.argv,
        cwd: dto.cwd,
        exit_code: dto.exit_code,
        started_at: TimestampMs::from_millis(started_at),
        ended_at: TimestampMs::from_millis(ended_at),
        source_snapshot_hash: SourceVersionId::new(dto.source_snapshot_hash),
        config_identity: ConfigIdentity::new(dto.config_identity),
        environment_fingerprint: dto.environment_fingerprint,
        output_digest: (!dto.output_digest.is_empty()).then_some(dto.output_digest),
        output_ref: dto.output_ref,
        coverage: ReceiptCoverage {
            kind,
            profile_id: boreal_domain::ProfileId::new(dto.coverage.profile_id),
            profile_version: dto.coverage.profile_version,
            observables: Vec::new(),
        },
        attestation,
        result,
    })
}

fn attempt_request(
    project: &ProjectId,
    work_id: &str,
    attempt_id: &AttemptId,
    options: &CliOptions,
    fence: Fence,
    operation: &str,
) -> Result<AttemptRequest, CliError> {
    Ok(AttemptRequest::new(
        project.clone(),
        WorkId::new(work_id),
        attempt_id.clone(),
        ActorId::new(options.actor.clone()),
        Some(boreal_domain::HarnessId::new(options.harness.clone())),
        Some(SessionId::new(options.session.clone())),
        fence,
        OperationId::new(operation),
        request_digest(operation, project, work_id, attempt_id.as_str()),
        TimestampMs::from_millis(now_ms_u64()),
    ))
}

fn attempt_result(
    result: OperationResult<boreal_application::AttemptMutation>,
    snapshot: &boreal_application::AttemptSnapshot,
    store: &SqliteStore,
    project: &ProjectId,
) -> Result<CliResult, CliError> {
    bounded_result(
        Some(attempt_json(&result.value, snapshot)),
        Some(
            result
                .snapshot_revision
                .max(store_revision(store, project)?),
        ),
    )
}

fn attempt_json(
    mutation: &boreal_application::AttemptMutation,
    snapshot: &boreal_application::AttemptSnapshot,
) -> Value {
    attempt_json_with_current(mutation, snapshot.current)
}

fn attempt_json_with_current(
    mutation: &boreal_application::AttemptMutation,
    current: bool,
) -> Value {
    json!({"attempt_id": mutation.attempt_id.as_str(), "fence": mutation.fence.get(), "phase": format!("{:?}", mutation.phase).to_ascii_lowercase(), "lease_deadline": stamp(mutation.lease_deadline.as_millis()), "hard_deadline": stamp(mutation.hard_deadline.as_millis()), "deadline_source": "claim_hard_budget", "replayed": mutation.replayed, "current": current})
}

fn resume_action(
    options: &CliOptions,
    project: &ProjectId,
    _work_id: &str,
    attempt: &AttemptRecord,
) -> NextActionDto {
    NextActionDto {
        directive_id: "attempt.resume@v1".to_owned(),
        severity: "required".to_owned(),
        title: "Resume the current fenced attempt".to_owned(),
        instruction: "Reload the durable attempt and continue; do not claim replacement work."
            .to_owned(),
        subject: SubjectDto {
            subject_type: "attempt".to_owned(),
            id: attempt.attempt_id.clone(),
        },
        safe_argv: vec![
            "bwrk".to_owned(),
            "agent".to_owned(),
            "resume".to_owned(),
            "--project".to_owned(),
            project.as_str().to_owned(),
            "--session".to_owned(),
            options.session.clone(),
            "--attempt".to_owned(),
            attempt.attempt_id.clone(),
            "--fence".to_owned(),
            attempt.fence.to_string(),
            "--json".to_owned(),
        ],
        cwd: ".".to_owned(),
        runner: "boreal_cli".to_owned(),
        shell: false,
    }
}

fn start_action(
    options: &CliOptions,
    project: &ProjectId,
    work_id: &str,
    revision: u64,
) -> NextActionDto {
    NextActionDto {
        directive_id: "agent.start@v1".to_owned(),
        severity: "required".to_owned(),
        title: "Claim and start the selected work".to_owned(),
        instruction: "Claim the selected work with a fenced attempt.".to_owned(),
        subject: SubjectDto {
            subject_type: "work".to_owned(),
            id: work_id.to_owned(),
        },
        safe_argv: vec![
            "bwrk".to_owned(),
            "agent".to_owned(),
            "start".to_owned(),
            work_id.to_owned(),
            "--project".to_owned(),
            project.as_str().to_owned(),
            "--actor".to_owned(),
            options.actor.clone(),
            "--session".to_owned(),
            options.session.clone(),
            "--expected-revision".to_owned(),
            revision.to_string(),
            "--lease-ttl".to_owned(),
            "30m".to_owned(),
            "--time-limit".to_owned(),
            "2h".to_owned(),
            "--json".to_owned(),
        ],
        cwd: ".".to_owned(),
        runner: "boreal_cli".to_owned(),
        shell: false,
    }
}

fn typed_result<T: serde::Serialize>(
    outcome: ApplicationOutcome,
    revision: Option<u64>,
    data: T,
) -> Result<CliResult, CliError> {
    let data = serde_json::to_value(data).map_err(|error| {
        CliError::with(
            ErrorCode::GuidanceUnavailable,
            ApplicationOutcome::Failed,
            error.to_string(),
        )
    })?;
    bounded_result(Some(data), revision).map(|mut result| {
        result.outcome = outcome;
        result
    })
}

fn bounded_result(data: Option<Value>, revision: Option<u64>) -> Result<CliResult, CliError> {
    if let Some(value) = &data {
        if serde_json::to_vec(value)
            .map_err(|error| {
                CliError::with(
                    ErrorCode::GuidanceUnavailable,
                    ApplicationOutcome::Failed,
                    error.to_string(),
                )
            })?
            .len()
            > MAX_JSON_BYTES
        {
            return Err(CliError::with(
                ErrorCode::InvalidArgument,
                ApplicationOutcome::Rejected,
                "result exceeds the inline protocol bound",
            ));
        }
    }
    Ok(CliResult {
        outcome: ApplicationOutcome::Changed,
        revision,
        data,
    })
}

fn changed(revision: u64, data: Option<Value>) -> CliResult {
    CliResult {
        outcome: ApplicationOutcome::Changed,
        revision: Some(revision),
        data,
    }
}

fn store_revision(store: &SqliteStore, project: &ProjectId) -> Result<u64, CliError> {
    store
        .project_revision(project.as_str())
        .map(|revision| revision.0)
        .map_err(map_store_error)
}

fn register_session_if_requested(
    app: &WorkApplication<'_>,
    project: &ProjectId,
    options: &CliOptions,
    operation: &str,
    started_at: TimestampMs,
    expected_revision: Option<u64>,
) -> Result<Option<u64>, CliError> {
    if options.session.trim().is_empty() {
        return Ok(expected_revision);
    }
    let request = SessionRegistrationRequest {
        project_id: project.clone(),
        session_id: SessionId::new(options.session.clone()),
        actor_id: ActorId::new(options.actor.clone()),
        harness_id: HarnessId::new(options.harness.clone()),
        operation_id: OperationId::new(sub_operation(operation, "session")),
        request_digest: format!("sha256:{}_session", operation),
        expected_project_revision: expected_revision,
        started_at,
    };
    let registered = app
        .register_session(&request)
        .map_err(map_application_error)?;
    Ok(Some(registered.snapshot_revision))
}

fn find_session_work(store: &SqliteStore, project: &ProjectId, actor: &str) -> Option<String> {
    store
        .list_work(project.as_str(), 100, 0)
        .ok()?
        .items
        .into_iter()
        .find_map(|item| {
            store
                .current_attempt_for_work(project.as_str(), &item.work_id)
                .ok()?
                .filter(|attempt| attempt.actor_id == actor)
                .map(|_| item.work_id)
        })
}

fn phase_status(phase: AttemptPhase) -> &'static str {
    match phase {
        AttemptPhase::Claimed => "claimed",
        AttemptPhase::Accepted => "accepted",
        AttemptPhase::Running => "in_progress",
        AttemptPhase::Verifying => "needs_verification",
        AttemptPhase::ExpiryPending | AttemptPhase::Expired => "expired_review",
        AttemptPhase::Completed => "complete",
        AttemptPhase::Failed => "failed",
        AttemptPhase::Released => "ready",
        AttemptPhase::Cancelled => "cancelled",
    }
}

fn request_digest(operation: &str, project: &ProjectId, work: &str, attempt: &str) -> String {
    format!("sha256:{operation}:{project}:{work}:{attempt}")
}

fn sub_operation(operation: &str, suffix: &str) -> String {
    format!(
        "op_{}_{}",
        operation.strip_prefix("op_").unwrap_or(operation),
        suffix
    )
}

fn attempt_id_for(operation: &str) -> String {
    format!(
        "attempt_cli_{}",
        operation.strip_prefix("op_").unwrap_or(operation)
    )
}

fn operation_id(args: &[String]) -> String {
    if let Some(value) = option(args, "--operation-id") {
        return value;
    }
    let raw = semantic_args(args).join("_");
    let safe = raw
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-') {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();
    if safe.len() <= 200 {
        format!("op_cli_{safe}")
    } else {
        format!("op_cli_{}", fnv_digest(raw.as_bytes()).replace(':', "_"))
    }
}

fn semantic_args(args: &[String]) -> Vec<String> {
    let value_options = [
        "--db",
        "--socket",
        "--operation-id",
        "--expected-revision",
        "--revision",
        "--project",
        "--actor",
        "--harness",
        "--session",
        "--attempt",
        "--fence",
        "--work",
        "--gate",
        "--receipt",
        "--reason",
        "--operator-reason",
        "--reviewer",
        "--lease-ttl",
        "--ttl",
        "--time-limit",
        "--limit",
        "--offset",
        "--max-requests",
    ];
    let mut result = Vec::new();
    let mut index = 0;
    while index < args.len() {
        if args[index] == "--json" {
            index += 1;
        } else if value_options.contains(&args[index].as_str()) {
            if !matches!(
                args[index].as_str(),
                "--db" | "--socket" | "--operation-id" | "--receipt"
            ) {
                result.push(args[index].clone());
                if let Some(value) = args.get(index + 1) {
                    result.push(value.clone());
                }
            }
            index += 2;
        } else {
            result.push(args[index].clone());
            index += 1;
        }
    }
    result
}

fn option(args: &[String], name: &str) -> Option<String> {
    args.windows(2)
        .find(|pair| pair[0] == name)
        .map(|pair| pair[1].clone())
}

fn ensure_db_parent(path: &Path) -> Result<(), CliError> {
    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent).map_err(|error| {
            CliError::with(
                ErrorCode::ServiceUnavailable,
                ApplicationOutcome::Failed,
                error.to_string(),
            )
        })?;
    }
    Ok(())
}

fn map_application_error(error: ApplicationError) -> CliError {
    match error {
        ApplicationError::Store(error) => map_store_error(error),
        ApplicationError::AttemptAdapter(error) => map_attempt_adapter_error(error),
        ApplicationError::AttemptPolicy(error) => map_attempt_policy_error(error),
        ApplicationError::Evidence(error) => {
            let code = match error.code().as_str() {
                "unsafe_command" => ErrorCode::UnsafeCommand,
                "receipt_command_mismatch" => ErrorCode::ReceiptCommandMismatch,
                "receipt_attestation_missing" => ErrorCode::ReceiptAttestationMissing,
                "receipt_exit_nonzero" => ErrorCode::ReceiptExitNonzero,
                "receipt_observable_missing" => ErrorCode::ReceiptObservableMissing,
                "stale_fence" => ErrorCode::StaleFence,
                "receipt_subject_mismatch" => ErrorCode::ReceiptSubjectMismatch,
                "receipt_source_mismatch" => ErrorCode::ReceiptSourceMismatch,
                "receipt_config_mismatch" => ErrorCode::ReceiptConfigMismatch,
                "receipt_policy_mismatch" => ErrorCode::ReceiptPolicyMismatch,
                "role_denied" => ErrorCode::RoleDenied,
                _ => ErrorCode::ReceiptInvalid,
            };
            CliError::with(code, ApplicationOutcome::Rejected, error.to_string())
        }
        ApplicationError::Invalid(message) => CliError::invalid(message),
    }
}

fn map_store_error(error: StoreError) -> CliError {
    let (code, outcome) = match error {
        StoreError::Unavailable(_) => (ErrorCode::ServiceUnavailable, ApplicationOutcome::Failed),
        StoreError::Busy(_) => (ErrorCode::ServiceBusy, ApplicationOutcome::Busy),
        StoreError::Invalid(_) => (ErrorCode::InvalidArgument, ApplicationOutcome::Rejected),
        StoreError::Conflict(_) => (ErrorCode::ClaimConflict, ApplicationOutcome::Conflict),
        StoreError::StaleRevision { .. } => {
            (ErrorCode::StaleRevision, ApplicationOutcome::Conflict)
        }
        StoreError::StaleFence { .. } => (ErrorCode::StaleFence, ApplicationOutcome::Rejected),
        StoreError::LeaseExpired => (ErrorCode::LeaseExpired, ApplicationOutcome::Rejected),
        StoreError::HardDeadlineElapsed => (
            ErrorCode::HardDeadlineImmutable,
            ApplicationOutcome::Rejected,
        ),
        StoreError::NotCurrent { .. } => (ErrorCode::StaleFence, ApplicationOutcome::Rejected),
        StoreError::WrongSubject { .. } => (
            ErrorCode::ReceiptSubjectMismatch,
            ApplicationOutcome::Rejected,
        ),
        StoreError::WrongOwner { .. } => {
            (ErrorCode::PermissionDenied, ApplicationOutcome::Rejected)
        }
        StoreError::IllegalTransition { .. } => {
            (ErrorCode::InvalidArgument, ApplicationOutcome::Rejected)
        }
        StoreError::NotExpired => (ErrorCode::InvalidArgument, ApplicationOutcome::Rejected),
        StoreError::StopConfirmationRequired => (
            ErrorCode::ExpiryStopUnconfirmed,
            ApplicationOutcome::Rejected,
        ),
        StoreError::Constraint { .. } => (ErrorCode::ClaimConflict, ApplicationOutcome::Conflict),
        StoreError::NotFound { .. } => (ErrorCode::NotFound, ApplicationOutcome::Rejected),
        StoreError::UnsupportedSchema { .. } | StoreError::Corrupt(_) => {
            (ErrorCode::ProtocolMismatch, ApplicationOutcome::Failed)
        }
    };
    CliError::with(code, outcome, error.to_string())
}

fn map_attempt_adapter_error(error: boreal_application::AttemptAdapterError) -> CliError {
    match error {
        boreal_application::AttemptAdapterError::Store(error) => map_store_error(error),
        boreal_application::AttemptAdapterError::StaleFence { .. } => CliError::with(
            ErrorCode::StaleFence,
            ApplicationOutcome::Rejected,
            error.to_string(),
        ),
        boreal_application::AttemptAdapterError::LeaseExpired => CliError::with(
            ErrorCode::LeaseExpired,
            ApplicationOutcome::Rejected,
            error.to_string(),
        ),
        boreal_application::AttemptAdapterError::Busy(_) => CliError::with(
            ErrorCode::ServiceBusy,
            ApplicationOutcome::Busy,
            error.to_string(),
        ),
        boreal_application::AttemptAdapterError::UnknownOutcome(_) => CliError::with(
            ErrorCode::UnknownOutcome,
            ApplicationOutcome::Unknown,
            error.to_string(),
        ),
        boreal_application::AttemptAdapterError::NotFound { .. } => CliError::with(
            ErrorCode::NotFound,
            ApplicationOutcome::Rejected,
            error.to_string(),
        ),
        boreal_application::AttemptAdapterError::Conflict(_) => CliError::with(
            ErrorCode::AttemptConflict,
            ApplicationOutcome::Conflict,
            error.to_string(),
        ),
        boreal_application::AttemptAdapterError::Rejected(_) => CliError::with(
            ErrorCode::InvalidArgument,
            ApplicationOutcome::Rejected,
            error.to_string(),
        ),
    }
}

fn map_attempt_policy_error(error: boreal_application::AttemptPolicyError) -> CliError {
    let (code, outcome) = match error {
        boreal_application::AttemptPolicyError::StaleFence => {
            (ErrorCode::StaleFence, ApplicationOutcome::Rejected)
        }
        boreal_application::AttemptPolicyError::LeaseExpired => {
            (ErrorCode::LeaseExpired, ApplicationOutcome::Rejected)
        }
        boreal_application::AttemptPolicyError::HardDeadlineElapsed => (
            ErrorCode::HardDeadlineImmutable,
            ApplicationOutcome::Rejected,
        ),
        boreal_application::AttemptPolicyError::NotCurrent => {
            (ErrorCode::StaleFence, ApplicationOutcome::Rejected)
        }
        boreal_application::AttemptPolicyError::WrongOwner => {
            (ErrorCode::PermissionDenied, ApplicationOutcome::Rejected)
        }
        boreal_application::AttemptPolicyError::StopConfirmationRequired => (
            ErrorCode::ExpiryStopUnconfirmed,
            ApplicationOutcome::Rejected,
        ),
        boreal_application::AttemptPolicyError::OperationReplayConflict => {
            (ErrorCode::OperationConflict, ApplicationOutcome::Conflict)
        }
        boreal_application::AttemptPolicyError::IllegalTransition { .. } => {
            (ErrorCode::InvalidArgument, ApplicationOutcome::Rejected)
        }
        _ => (ErrorCode::InvalidArgument, ApplicationOutcome::Rejected),
    };
    CliError::with(code, outcome, error.to_string())
}

fn exit_code(code: ErrorCode) -> u8 {
    match code {
        ErrorCode::NotFound => 3,
        ErrorCode::RevisionConflict
        | ErrorCode::StaleRevision
        | ErrorCode::ClaimConflict
        | ErrorCode::AttemptConflict
        | ErrorCode::OperationConflict => 4,
        ErrorCode::StaleContext
        | ErrorCode::StaleFence
        | ErrorCode::StaleReceipt
        | ErrorCode::ReceiptSubjectMismatch
        | ErrorCode::ReceiptSourceMismatch
        | ErrorCode::ReceiptConfigMismatch
        | ErrorCode::ReceiptPolicyMismatch
        | ErrorCode::CloseIntentInvalidated
        | ErrorCode::CloseIntentInvalid => 5,
        ErrorCode::WriterQueueFull | ErrorCode::ServiceBusy => 6,
        ErrorCode::WorkNotPublished
        | ErrorCode::DependencyNotClosed
        | ErrorCode::NotClaimable
        | ErrorCode::AttemptUnaccepted
        | ErrorCode::AttemptExpired
        | ErrorCode::ExpiredReview
        | ErrorCode::PrerequisiteOpen
        | ErrorCode::DependencyOpen
        | ErrorCode::BlockedWork
        | ErrorCode::HardBlocked
        | ErrorCode::Paused
        | ErrorCode::RetryWait
        | ErrorCode::VerificationRequired
        | ErrorCode::ReviewRequired
        | ErrorCode::CloseIntentMissing
        | ErrorCode::ExpiryStopUnconfirmed
        | ErrorCode::LeaseExpired
        | ErrorCode::HardDeadlineImmutable
        | ErrorCode::ReceiptObservableMissing
        | ErrorCode::GateUnsatisfied
        | ErrorCode::AuditScopeMissing
        | ErrorCode::NotClosed => 7,
        ErrorCode::PermissionDenied
        | ErrorCode::OperatorRequired
        | ErrorCode::RoleDenied
        | ErrorCode::ReviewerCannotReviewOwnAttempt
        | ErrorCode::ReceiptAttestationMissing => 8,
        ErrorCode::ServiceUnavailable | ErrorCode::UnsupportedPlatform => 9,
        ErrorCode::UnknownOutcome | ErrorCode::OperationUnknown => 11,
        _ => 2,
    }
}

fn is_retryable(code: ErrorCode) -> bool {
    matches!(
        code,
        ErrorCode::ServiceBusy
            | ErrorCode::ServiceUnavailable
            | ErrorCode::StaleRevision
            | ErrorCode::RevisionConflict
            | ErrorCode::VerificationRequired
            | ErrorCode::ReviewRequired
            | ErrorCode::CloseIntentMissing
    )
}

fn now() -> String {
    stamp(now_ms_u64())
}
fn now_ms_u64() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64
}
fn stamp(milliseconds: u64) -> String {
    format!("unix-ms:{milliseconds}")
}
fn parse_stamp_ms(value: &str) -> Option<u64> {
    value.strip_prefix("unix-ms:")?.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }

    #[test]
    fn parser_supports_guided_agent_grammar() {
        let parsed = parse(&args(&[
            "agent",
            "start",
            "work-1",
            "--project",
            "project-1",
            "--session",
            "session-1",
            "--lease-ttl",
            "45m",
            "--time-limit",
            "2h",
            "--json",
        ]))
        .unwrap();
        assert_eq!(parsed.path, vec!["agent", "start"]);
        assert_eq!(parsed.options.project.as_deref(), Some("project-1"));
        assert_eq!(parsed.options.lease_ttl_ms, Some(45 * 60 * 1_000));
        assert_eq!(parsed.options.time_limit_ms, Some(2 * 60 * 60 * 1_000));
        assert!(parsed.options.json);
    }

    #[test]
    fn parser_rejects_ambiguous_lease_aliases_and_bad_duration() {
        let both = parse(&args(&[
            "work",
            "claim",
            "--project",
            "p",
            "--ttl",
            "1m",
            "--lease-ttl",
            "2m",
        ]));
        assert_eq!(both.unwrap_err().code, ErrorCode::InvalidArgument);
        let bad = parse(&args(&[
            "agent",
            "start",
            "w",
            "--project",
            "p",
            "--time-limit",
            "0h",
        ]));
        assert_eq!(bad.unwrap_err().code, ErrorCode::InvalidArgument);
    }

    #[test]
    fn operation_ids_ignore_json_and_database_rendering_flags() {
        let first = operation_id(&args(&[
            "agent",
            "start",
            "w",
            "--project",
            "p",
            "--db",
            "/tmp/a.sqlite",
        ]));
        let second = operation_id(&args(&[
            "agent",
            "start",
            "w",
            "--project",
            "p",
            "--db",
            "/tmp/b.sqlite",
            "--json",
        ]));
        assert_eq!(first, second);
        assert!(first.starts_with("op_"));
    }

    #[test]
    fn operation_ids_ignore_transport_and_receipt_paths_and_bound_long_shapes() {
        let first = operation_id(&args(&[
            "agent",
            "finish",
            "work",
            "--close",
            "--socket",
            "/tmp/first/boreal.sock",
            "--receipt",
            "/tmp/first/evidence.json",
        ]));
        let second = operation_id(&args(&[
            "agent",
            "finish",
            "work",
            "--close",
            "--socket",
            "/tmp/second/boreal.sock",
            "--receipt",
            "/tmp/second/evidence.json",
        ]));
        assert_eq!(first, second);

        let long_value = "x".repeat(300);
        let bounded = operation_id(&args(&["work", "show", &long_value]));
        assert!(bounded.len() <= 255);
        assert!(bounded
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-')));
    }

    #[test]
    fn protocol_exit_mapping_is_stable() {
        assert_eq!(exit_code(ErrorCode::InvalidArgument), 2);
        assert_eq!(exit_code(ErrorCode::NotFound), 3);
        assert_eq!(exit_code(ErrorCode::StaleFence), 5);
        assert_eq!(exit_code(ErrorCode::ExpiredReview), 7);
        assert_eq!(exit_code(ErrorCode::UnknownOutcome), 11);
    }

    #[test]
    fn cli_smoke_start_and_release_use_the_sqlite_adapter() {
        let path = env::temp_dir().join(format!("boreal-cli-smoke-{}.sqlite", now_ms_u64()));
        let db = path.to_string_lossy().to_string();
        let _ = fs::remove_file(&path);
        assert_eq!(
            run(&args(&["init", "p", "--db", &db])).unwrap().outcome,
            ApplicationOutcome::Changed
        );
        run(&args(&["work", "create", "p", "w", "task", "--db", &db])).unwrap();
        let start = run(&args(&[
            "agent",
            "start",
            "w",
            "--project",
            "p",
            "--session",
            "s",
            "--db",
            &db,
        ]))
        .unwrap();
        let data = start.data.unwrap();
        assert_eq!(data["phase"], "running");
        assert_ne!(data["lease_deadline"], data["hard_deadline"]);
        run(&args(&[
            "agent",
            "release",
            "w",
            "--project",
            "p",
            "--session",
            "s",
            "--attempt",
            data["attempt_id"].as_str().unwrap(),
            "--fence",
            &data["fence"].to_string(),
            "--db",
            &db,
        ]))
        .unwrap();
        let _ = fs::remove_file(path);
    }

    #[test]
    fn no_goal_next_emits_one_required_contract_valid_action() {
        let path = env::temp_dir().join(format!("boreal-cli-no-goal-next-{}.sqlite", now_ms_u64()));
        let db = path.to_string_lossy().to_string();
        let _ = fs::remove_file(&path);

        run(&args(&["init", "p", "--db", &db])).expect("project initializes");
        run(&args(&[
            "work",
            "create",
            "p",
            "ready-work",
            "task",
            "--db",
            &db,
        ]))
        .expect("work creates");

        let result = run(&args(&[
            "next",
            "--project",
            "p",
            "--actor",
            "unfamiliar-agent",
            "--session",
            "unfamiliar-session",
            "--db",
            &db,
            "--json",
        ]))
        .expect("no-goal next succeeds");
        let data = result.data.expect("next data");
        assert_eq!(data["no_goal"], true);
        assert_eq!(data["next_action"]["severity"], "required");
        assert_eq!(data["next_action"]["directive_id"], "agent.start@v1");
        assert_eq!(data["next_action"]["shell"], false);

        let safe_argv = data["next_action"]["safe_argv"]
            .as_array()
            .expect("safe argv array");
        assert!(!safe_argv.is_empty());
        assert_eq!(safe_argv[0], "bwrk");
        assert!(safe_argv
            .iter()
            .all(|value| value.as_str().is_some_and(|value| !value.contains('\0'))));
        let reparsed = parse(
            &safe_argv[1..]
                .iter()
                .map(|value| value.as_str().expect("argv string").to_owned())
                .collect::<Vec<_>>(),
        )
        .expect("safe argv follows the CLI grammar");
        assert_eq!(reparsed.path, vec!["agent", "start"]);
        assert_eq!(reparsed.options.project.as_deref(), Some("p"));
        assert_eq!(reparsed.options.work.as_deref(), None);

        let _ = fs::remove_file(path);
    }

    #[test]
    fn direct_claim_validates_work_before_registering_a_session() {
        let path = env::temp_dir().join(format!(
            "boreal-cli-session-preflight-{}.sqlite",
            now_ms_u64()
        ));
        let db = path.to_string_lossy().to_string();
        let _ = fs::remove_file(&path);
        run(&args(&["init", "p", "--db", &db])).expect("project initializes");
        let error = run(&args(&[
            "work",
            "claim",
            "p",
            "missing-work",
            "--session",
            "session-preflight",
            "--db",
            &db,
        ]))
        .expect_err("missing work is rejected before session registration");
        assert_eq!(error.code, ErrorCode::NotFound);
        let store = SqliteStore::open(&path, SCHEMA).expect("database reopens");
        assert!(store
            .session("p", "session-preflight")
            .expect("session read succeeds")
            .is_none());
        let _ = fs::remove_file(path);
    }

    #[test]
    fn finish_close_records_receipt_and_retains_open_gate_diagnostics() {
        let db_path = env::temp_dir().join(format!("boreal-cli-finish-{}.sqlite", now_ms_u64()));
        let receipt_path =
            env::temp_dir().join(format!("boreal-cli-receipt-{}.json", now_ms_u64()));
        let db = db_path.to_string_lossy().to_string();
        let receipt_file = receipt_path.to_string_lossy().to_string();
        let _ = fs::remove_file(&db_path);
        let _ = fs::remove_file(&receipt_path);

        run(&args(&["init", "p", "--db", &db])).expect("project initializes");
        run(&args(&["work", "create", "p", "w", "task", "--db", &db])).expect("work creates");
        let started = run(&args(&[
            "agent",
            "start",
            "w",
            "--project",
            "p",
            "--session",
            "s",
            "--db",
            &db,
        ]))
        .expect("attempt starts")
        .data
        .expect("start data");
        let attempt_id = started["attempt_id"].as_str().expect("attempt id");
        let fence = started["fence"].as_u64().expect("fence");
        SqliteStore::open(&db_path, SCHEMA)
            .expect("database reopens")
            .execute_batch(
                "INSERT INTO source_version
                 (source_version_id, project_id, origin, access_scope, content_digest,
                  media_type, byte_count, captured_at, parser_identity, availability, citation_json)
                 VALUES ('source-1', 'p', 'fixture.md', 'project',
                         'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                         'text/markdown', 1, 'unix-ms:0', 'parser/1', 'available', '[]');",
            )
            .expect("source snapshot registers");
        fs::write(
            &receipt_path,
            serde_json::to_string(&json!({
                "schema_version": "boreal.receipt.v1",
                "fixture_id": "cli.finish.receipt.v1",
                "receipt_id": "receipt-cli-finish",
                "operation_id": "op-cli-finish-receipt",
                "subject": {"work_id": "w", "attempt_id": attempt_id, "fence": fence, "gate_id": "verification"},
                "executable": "./check",
                "argv": ["./check"],
                "cwd": "/workspace",
                "exit_code": 0,
                "started_at": "unix-ms:10",
                "ended_at": "unix-ms:11",
                "source_snapshot_hash": "source-1",
                "config_identity": "config-1",
                "environment_fingerprint": "env-1",
                "output_digest": "output-1",
                "output_ref": null,
                "coverage": {"kind": "verification", "profile_id": "focused", "profile_version": "v1"},
                "attestation": "boreal_witnessed",
                "result": "passed",
                "retention": null,
            }))
            .expect("receipt serializes"),
        )
        .expect("receipt writes");

        let finished = run(&args(&[
            "agent",
            "finish",
            "w",
            "--close",
            "--project",
            "p",
            "--session",
            "s",
            "--attempt",
            attempt_id,
            "--fence",
            &fence.to_string(),
            "--receipt",
            &receipt_file,
            "--db",
            &db,
        ]))
        .expect("close attempt returns a bounded rejection");
        assert_eq!(finished.outcome, ApplicationOutcome::Rejected);
        let data = finished.data.expect("finish data");
        assert_eq!(data["close_state"], "open");
        assert_eq!(data["receipt_replayed"], false);
        assert!(data["gates"]["missing"]
            .as_array()
            .expect("missing gate list")
            .iter()
            .any(|gate| gate.as_str().is_some_and(|id| id.ends_with(":checkpoint"))));
        assert!(data["gates"]["missing"]
            .as_array()
            .expect("missing gate list")
            .iter()
            .any(|gate| gate.as_str().is_some_and(|id| id.ends_with(":summary"))));

        let _ = fs::remove_file(db_path);
        let _ = fs::remove_file(receipt_path);
    }
}
