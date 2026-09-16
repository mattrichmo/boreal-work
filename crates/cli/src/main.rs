use boreal_application::{
    canonical_request_digest, guide_checked, sha256_content_digest, AcceptanceGateDefinition,
    ApplicationError, AttemptPolicy, AttemptRequest, BoundedExecutionResult, CommandSpec,
    EndAttemptRequest, EvidenceExecutionOutcome, EvidenceRunRequest, ExecutorAttestation,
    LivenessMetadata, OperationResult, ReceiptCoverage, ReceiptExpectation, ReceiptPayload,
    SessionRegistrationRequest, SqliteAttemptAdapter, SummaryPayload, WorkApplication,
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
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, ExitCode, ExitStatus, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

mod dashboard;
mod service;

const SCHEMA: &str = include_str!("../../../project/spec/schema-v2.sql");
const MAX_JSON_BYTES: usize = boreal_protocol::bounds::MAX_INLINE_OUTPUT_BYTES;
const DEFAULT_ACTOR: &str = "agent-1";
const DEFAULT_HARNESS: &str = "cli";
const DEFAULT_SESSION: &str = "session-cli";
const MAX_GATE_RUNTIME_MS: u64 = 30_000;
const GATE_COMMANDS_DIR: &str = "gates";
static OPERATION_COUNTER: AtomicU64 = AtomicU64::new(0);
const HELP: &str = r#"bwrk v2

Usage:
  bwrk init <project> [--db PATH] [--json]
  bwrk service run --db PATH --socket PATH [--max-requests N] [--json]
  bwrk status <project> [--limit N] [--offset N] [--socket PATH] [--db PATH] [--json]
  bwrk dashboard [PROJECT] [--project PROJECT] [--db PATH] [--actor ID] [--harness ID] [--session ID] [--json]
  bwrk work create <project> <work-id> <title> [--kind milestone|sprint|task] [--parent WORK_ID] [--priority N] [--description TEXT] [--db PATH] [--json]
  bwrk work list <project> [--limit N] [--offset N] [--db PATH] [--json]
  bwrk work show <project> <work-id> [--db PATH] [--json]
  bwrk work claim <project> <work-id> [--session SESSION_ID] [--lease-ttl DURATION] [--time-limit DURATION] [--socket PATH] [--db PATH] [--json]
  bwrk agent guide [--project PROJECT] [--work WORK_ID] [--json]
  bwrk next [--project PROJECT] [--work WORK_ID] [--json]
  bwrk agent start [WORK_ID] [--project PROJECT] [--session SESSION_ID] [--lease-ttl DURATION] [--time-limit DURATION] [--socket PATH] [--json]
  bwrk agent resume --project PROJECT --session SESSION_ID --attempt ATTEMPT_ID [--json]
  bwrk agent release WORK_ID --project PROJECT --attempt ATTEMPT_ID --fence N [--socket PATH] [--reason CODE] [--json]
  bwrk agent finish WORK_ID --close --project PROJECT --attempt ATTEMPT_ID --fence N --receipt PATH --summary PATH [--socket PATH] [--json]
  bwrk agent finish WORK_ID --release --project PROJECT --attempt ATTEMPT_ID --fence N [--socket PATH] [--reason CODE] [--json]
  bwrk evidence run --project PROJECT --work WORK_ID --gate GATE_ID [--attempt ATTEMPT_ID --fence N] [--json]
  bwrk evidence add --project PROJECT --work WORK_ID --gate GATE_ID --receipt PATH [--json]
  bwrk operation show PROJECT OPERATION_ID [--socket PATH] [--json]"#;

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
    summary: Option<String>,
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
    kind: Option<String>,
    parent: Option<String>,
    description: Option<String>,
    priority: Option<u8>,
    source_version: Option<String>,
    config_identity: Option<String>,
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
            summary: None,
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
            kind: None,
            parent: None,
            description: None,
            priority: None,
            source_version: None,
            config_identity: None,
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
        println!("bwrk {} (api {})", env!("CARGO_PKG_VERSION"), API_VERSION);
        return ExitCode::SUCCESS;
    }
    let json_output = args.iter().any(|arg| arg == "--json");
    let interactive_dashboard =
        !json_output && parse(&args).is_ok_and(|parsed| parsed.path == ["dashboard"]);
    let operation = operation_id(&args);
    match run_with_operation(&args, &operation) {
        Ok(result) => {
            let has_data = result.data.is_some();
            let application_error = result_protocol_error(&result, &operation);
            if json_output {
                print_envelope(
                    operation,
                    result.revision,
                    result.outcome,
                    result.data,
                    application_error.clone(),
                );
            } else if !interactive_dashboard {
                if let Some(data) = result.data {
                    println!("{}", serde_json::to_string_pretty(&data).unwrap());
                }
            }
            if result.outcome.is_success() {
                if !json_output && !has_data && !interactive_dashboard {
                    println!("ok");
                }
                ExitCode::SUCCESS
            } else {
                if !json_output {
                    let error = application_error
                        .as_ref()
                        .expect("unsuccessful outcomes require a protocol error");
                    eprintln!("error [{}]: {}", error.code, error.message);
                }
                let code = application_error
                    .as_ref()
                    .map_or_else(|| outcome_error_code(result.outcome), |error| error.code);
                ExitCode::from(exit_code(code))
            }
        }
        Err(error) => {
            if json_output {
                let mut protocol_error =
                    ProtocolError::new(error.code, error.message, is_retryable(error.code));
                if error.outcome == ApplicationOutcome::Unknown {
                    protocol_error.operation_id = Some(operation.clone());
                    protocol_error.readback_required = Some(true);
                }
                print_envelope(operation, None, error.outcome, None, Some(protocol_error));
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

#[cfg(test)]
fn run(args: &[String]) -> Result<CliResult, CliError> {
    let operation = operation_id(args);
    run_with_operation(args, &operation)
}

fn run_with_operation(args: &[String], operation: &str) -> Result<CliResult, CliError> {
    let parsed = parse(args)?;
    if parsed.path == ["service", "run"] {
        return service::run_service(&parsed, operation);
    }
    if parsed.path == ["dashboard"] {
        return dashboard::run_dashboard(&parsed);
    }
    if parsed.options.socket.is_some() {
        if service::supports(&parsed) {
            return service::request(&parsed, operation);
        }
        return Err(CliError::with(
            ErrorCode::UnknownCommandNamespace,
            ApplicationOutcome::Rejected,
            "the requested command is not available through the selected service socket",
        ));
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
                operation.to_owned(),
            )
            .map_err(map_application_error)?;
        return Ok(changed(result.snapshot_revision, None));
    }
    let store = SqliteStore::open(&path, SCHEMA).map_err(map_store_error)?;
    let app = WorkApplication::new(&store);
    let adapter = SqliteAttemptAdapter::new(&store);
    dispatch(&parsed, operation, &app, &adapter, &store)
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
        [command] if *command == "status" || *command == "prime" => status_result(parsed, store),
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
        ["operation", "show"] => operation_show_result(parsed, store),
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
        summary: None,
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
        kind: None,
        parent: None,
        description: None,
        priority: None,
        source_version: None,
        config_identity: None,
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
                | "--summary"
                | "--reason"
                | "--operator-reason"
                | "--reviewer"
                | "--actor-role"
                | "--lease-ttl"
                | "--time-limit"
                | "--limit"
                | "--offset"
                | "--max-requests"
                | "--kind"
                | "--parent"
                | "--description"
                | "--priority"
                | "--source-version"
                | "--config-identity" => Some(option_value(args, &mut index, canonical)?),
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
                "--summary" => options.summary = Some(value.unwrap()),
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
                "--kind" => {
                    let kind = value.unwrap();
                    if !matches!(kind.as_str(), "milestone" | "sprint" | "task") {
                        return Err(CliError::invalid(
                            "--kind must be milestone, sprint, or task",
                        ));
                    }
                    options.kind = Some(kind);
                }
                "--parent" => options.parent = Some(value.unwrap()),
                "--description" => options.description = Some(value.unwrap()),
                "--priority" => {
                    options.priority = Some(value.unwrap().parse().map_err(|_| {
                        CliError::invalid("--priority must be an integer from 0 to 255")
                    })?);
                }
                "--source-version" => options.source_version = Some(value.unwrap()),
                "--config-identity" => options.config_identity = Some(value.unwrap()),
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
    if path.as_slice() == ["view"] {
        path[0] = "dashboard".to_owned();
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

/// The direct status/prime view is the same derived projection exposed by the
/// service. Raw work listing remains available through `work list`, but an
/// operator-facing status command must include dependency, gate, ownership,
/// and clock decisions from one coherent snapshot.
fn status_result(parsed: &ParsedCommand, store: &SqliteStore) -> Result<CliResult, CliError> {
    let project = ProjectId::new(project_argument(parsed, 0)?);
    let snapshot = boreal_application::project_status_from_store(
        store,
        &project,
        &boreal_domain::ActorContext {
            actor_id: ActorId::new(parsed.options.actor.clone()),
            role: boreal_domain::ActorRole::Agent,
        },
        TimestampMs::from_millis(now_ms_u64()),
        parsed.options.limit.unwrap_or(100),
        parsed.options.offset.unwrap_or(0),
    )
    .map_err(|message| {
        CliError::with(
            ErrorCode::ServiceUnavailable,
            ApplicationOutcome::Failed,
            message,
        )
    })?;
    let items = snapshot
        .items
        .iter()
        .map(status_item_json)
        .collect::<Vec<_>>();
    let counts = &snapshot.counts;
    bounded_result(
        Some(json!({
            "command": "status",
            "contract_version": snapshot.contract_version,
            "project_id": snapshot.project_id.as_str(),
            "project_revision": snapshot.project_revision.0,
            "revision": snapshot.project_revision.0,
            "as_of": stamp(snapshot.as_of.as_millis()),
            "next_status_change_at": snapshot.next_status_change_at.map(|value| stamp(value.as_millis())),
            "limit": snapshot.limit,
            "offset": snapshot.offset,
            "total": snapshot.total,
            "has_more": snapshot.has_more(),
            "next_offset": snapshot.next_offset(),
            "counts": {
                "matched": counts.total,
                "total": counts.total,
                "draft": counts.draft,
                "queued": counts.queued,
                "ready": counts.ready,
                "claimed": counts.claimed,
                "in_progress": counts.in_progress,
                "needs_verification": counts.needs_verification,
                "awaiting_review": counts.awaiting_review,
                "complete": counts.complete,
                "closed": counts.closed,
                "blocked": counts.blocked,
                "paused": counts.paused,
                "retry_wait": counts.retry_wait,
                "expired_review": counts.expired_review,
                "cancelled": counts.cancelled,
            },
            "items": items,
        })),
        Some(snapshot.project_revision.0),
    )
}

fn status_item_json(item: &boreal_application::StatusWork) -> Value {
    let gates = item
        .gates
        .gates
        .iter()
        .map(|gate| {
            json!({
                "gate_id": gate.gate_id.as_str(),
                "kind": format!("{:?}", gate.kind).to_ascii_lowercase(),
                "required": gate.required,
                "state": format!("{:?}", gate.state).to_ascii_lowercase(),
                "receipt_id": gate.receipt_id,
                "reason": gate.reason,
            })
        })
        .collect::<Vec<_>>();
    let (open, satisfied): (Vec<_>, Vec<_>) = gates
        .into_iter()
        .partition(|gate| gate["state"] != "satisfied");
    let attempt = item.attempt.as_ref().map(|attempt| {
        json!({
            "attempt_id": attempt.attempt_id.as_str(),
            "fence": attempt.fence.get(),
            "phase": format!("{:?}", attempt.phase).to_ascii_lowercase(),
            "actor_id": attempt.actor_id.as_str(),
            "harness_id": attempt.harness_id.as_ref().map(|value| value.as_str()),
            "session_id": attempt.session_id.as_ref().map(|value| value.as_str()),
            "lease_deadline": stamp(attempt.lease_deadline.as_millis()),
            "hard_deadline": stamp(attempt.max_attempt_deadline.as_millis()),
        })
    });
    json!({
        "work_id": item.work.id.as_str(),
        "project_id": item.work.project_id.as_str(),
        "kind": format!("{:?}", item.work.kind).to_ascii_lowercase(),
        "parent_id": item.work.parent_id.as_ref().map(|value| value.as_str()),
        "title": item.work.title,
        "description": item.work.description,
        "lifecycle": format!("{:?}", item.work.lifecycle).to_ascii_lowercase(),
        "priority": item.work.priority,
        "dispatch_policy": format!("{:?}", item.work.dispatch_policy).to_ascii_lowercase(),
        "status": status_name(item.display_status()),
        "display_status": status_name(item.display_status()),
        "claimable": item.decision.claimable_for_actor,
        "claimable_for_actor": item.decision.claimable_for_actor,
        "reason_codes": item.decision.reason_codes.iter().map(|reason| reason.stable_code()).collect::<Vec<_>>(),
        "next_status_change_at": item.decision.next_status_change_at.map(|value| stamp(value.as_millis())),
        "attempt": attempt,
        "gates": { "open": open, "satisfied": satisfied },
        "dependency": {
            "prerequisites": item.dependency_blockers.iter().map(|blocker| json!({
                "work_id": blocker.work_id.as_str(),
                "display_status": status_name(blocker.display_status),
                "satisfies_default": blocker.satisfies_default,
            })).collect::<Vec<_>>(),
        },
    })
}

fn status_name(status: boreal_domain::DerivedStatus) -> &'static str {
    match status {
        boreal_domain::DerivedStatus::Draft => "draft",
        boreal_domain::DerivedStatus::Queued => "queued",
        boreal_domain::DerivedStatus::Ready => "ready",
        boreal_domain::DerivedStatus::Claimed => "claimed",
        boreal_domain::DerivedStatus::InProgress => "in_progress",
        boreal_domain::DerivedStatus::NeedsVerification => "needs_verification",
        boreal_domain::DerivedStatus::AwaitingReview => "awaiting_review",
        boreal_domain::DerivedStatus::Complete => "complete",
        boreal_domain::DerivedStatus::Closed => "closed",
        boreal_domain::DerivedStatus::Blocked => "blocked",
        boreal_domain::DerivedStatus::Paused => "paused",
        boreal_domain::DerivedStatus::RetryWait => "retry_wait",
        boreal_domain::DerivedStatus::ExpiredReview => "expired_review",
        boreal_domain::DerivedStatus::Cancelled => "cancelled",
    }
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

fn operation_show_result(
    parsed: &ParsedCommand,
    store: &SqliteStore,
) -> Result<CliResult, CliError> {
    let project = project_argument(parsed, 0)?;
    let operation_index = usize::from(parsed.options.project.is_none());
    let operation_id = parsed
        .options
        .positionals
        .get(operation_index)
        .ok_or_else(|| CliError::invalid("missing operation identifier"))?;
    let operation = store.operation(operation_id).map_err(map_store_error)?;
    let execution = store
        .evidence_execution(operation_id)
        .map_err(map_store_error)?;
    if operation.is_none() && execution.is_none() {
        return Err(CliError::with(
            ErrorCode::NotFound,
            ApplicationOutcome::Rejected,
            format!("operation not found: {operation_id}"),
        ));
    }
    if let Some(operation) = &operation {
        if operation.project_id != project {
            return Err(CliError::with(
                ErrorCode::InvalidArgument,
                ApplicationOutcome::Rejected,
                "operation does not belong to the selected project",
            ));
        }
    }
    let operation_json = operation.clone().map(|operation| {
        json!({
            "operation_id": operation.operation_id,
            "project_id": operation.project_id,
            "command": operation.command,
            "actor_id": operation.actor_id,
            "session_id": operation.session_id,
            "attempt_id": operation.attempt_id,
            "fence": operation.fence,
            "request_digest": operation.request_digest,
            "outcome": format!("{:?}", operation.outcome).to_ascii_lowercase(),
            "result": serde_json::from_str::<Value>(&operation.result_json)
                .unwrap_or(Value::String(operation.result_json)),
            "revision": operation.revision,
            "created_at": operation.created_at,
            "completed_at": operation.completed_at,
        })
    });
    let execution_json = execution.map(|execution| {
        json!({
            "operation_id": execution.operation_id,
            "project_id": execution.project_id,
            "work_id": execution.work_id,
            "attempt_id": execution.attempt_id,
            "fence": execution.fence,
            "gate_id": execution.gate_id,
            "actor_id": execution.actor_id,
            "session_id": execution.session_id,
            "request_digest": execution.request_digest,
            "artifact_ref": execution.artifact_ref,
            "state": format!("{:?}", execution.state).to_ascii_lowercase(),
            "admitted_at": execution.admitted_at,
            "started_at": execution.started_at,
            "exited_at": execution.exited_at,
            "exit_code": execution.exit_code,
            "receipt_id": execution.receipt_id,
            "failure_code": execution.failure_code,
        })
    });
    let outcome = if execution_json
        .as_ref()
        .is_some_and(|value| value["state"] != "receipt_committed")
    {
        ApplicationOutcome::Unknown
    } else {
        operation
            .as_ref()
            .map(|value| match value.outcome {
                boreal_store::OperationOutcome::Changed => ApplicationOutcome::Changed,
                boreal_store::OperationOutcome::Unchanged => ApplicationOutcome::Unchanged,
                boreal_store::OperationOutcome::Rejected => ApplicationOutcome::Rejected,
                boreal_store::OperationOutcome::Conflict => ApplicationOutcome::Conflict,
                boreal_store::OperationOutcome::Busy => ApplicationOutcome::Busy,
                boreal_store::OperationOutcome::Failed => ApplicationOutcome::Failed,
                boreal_store::OperationOutcome::Unknown => ApplicationOutcome::Unknown,
            })
            .unwrap_or(ApplicationOutcome::Unknown)
    };
    bounded_result(
        Some(json!({
            "operation": operation_json,
            "execution": execution_json,
            "readback_required": outcome == ApplicationOutcome::Unknown,
        })),
        operation.as_ref().map(|value| value.revision),
    )
    .map(|mut result| {
        result.outcome = outcome;
        result
    })
}

fn create_work_result(
    parsed: &ParsedCommand,
    app: &WorkApplication<'_>,
    operation: &str,
) -> Result<CliResult, CliError> {
    let project = ProjectId::new(project_argument(parsed, 0)?);
    let positional_offset = usize::from(parsed.options.project.is_none());
    let work_id = parsed
        .options
        .positionals
        .get(positional_offset)
        .cloned()
        .ok_or_else(|| CliError::invalid("missing work identifier"))?;
    let title = parsed
        .options
        .positionals
        .get(positional_offset + 1)
        .cloned()
        .ok_or_else(|| CliError::invalid("missing work title"))?;
    // A newly-created work item is executable by default. Containers remain
    // explicit (`--kind milestone|sprint`) so the scheduler never presents a
    // planning container as an agent task by accident.
    let kind = match parsed.options.kind.as_deref().unwrap_or("task") {
        "milestone" => WorkKind::Milestone,
        "sprint" => WorkKind::Sprint,
        "task" => WorkKind::Task,
        _ => unreachable!("parser validates work kind"),
    };
    let work = WorkItem {
        id: WorkId::new(work_id),
        project_id: project,
        kind,
        parent_id: parsed.options.parent.clone().map(WorkId::new),
        title,
        description: parsed.options.description.clone().unwrap_or_default(),
        lifecycle: PersistedLifecycle::Open,
        priority: parsed.options.priority.unwrap_or(0),
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
        .claim_with_context(
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
            parsed.options.source_version.as_deref(),
            parsed
                .options
                .config_identity
                .as_deref()
                .unwrap_or("unknown"),
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
    // Goal-less start resumes this session's current attempt first. If no
    // attempt is resumable, choose from the same canonical status projection
    // used by `next`; claim_result still performs the atomic claim/recheck.
    let Some(work_id) = parsed
        .options
        .work
        .clone()
        .or_else(|| parsed.options.positionals.first().cloned())
        .or(find_session_work(
            store,
            &project,
            &parsed.options.actor,
            &parsed.options.session,
        )?)
        .or(select_claimable_work(
            store,
            &project,
            &parsed.options.actor,
        )?)
    else {
        return Ok(CliResult {
            outcome: ApplicationOutcome::Unchanged,
            revision: Some(store_revision(store, &project)?),
            data: Some(json!({
                "phase": "idle",
                "reason": "no_ready_work",
                "message": "no resumable or claimable task is available",
                "next_action": null,
            })),
        });
    };
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
            "attempt.accept/v1",
            None,
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
                    "attempt.start/v1",
                    None,
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
    let mut selected = parsed.clone();
    selected.options.work = Some(work_id.clone());
    let result = claim_result(&selected, app, adapter, operation, store)?;
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
                "attempt.accept/v1",
                None,
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
                "attempt.start/v1",
                None,
            )?,
        )
        .map_err(map_application_error)?;
    let outcome = if accepted.changed || started.changed {
        ApplicationOutcome::Changed
    } else {
        ApplicationOutcome::Unchanged
    };
    let mut data = attempt_json(&started.value, &accepted_snapshot);
    data["work_id"] = json!(work_id);
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
            find_session_work(
                store,
                &project,
                &parsed.options.actor,
                &parsed.options.session,
            )
            .ok()
            .flatten()
            .and_then(|work| {
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
    let selected = parsed.options.work.clone().or(find_session_work(
        store,
        &project,
        &parsed.options.actor,
        &parsed.options.session,
    )?);
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
    if let Some(work) = find_session_work(
        store,
        &project,
        &parsed.options.actor,
        &parsed.options.session,
    )?
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
    let snapshot = boreal_application::project_status_from_store(
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
            ErrorCode::GuidanceUnavailable,
            ApplicationOutcome::Failed,
            message,
        )
    })?;
    if let Some(item) = snapshot
        .items
        .into_iter()
        .find(|item| item.work.kind == WorkKind::Task && item.decision.claimable_for_actor)
    {
        let work_id = item.work.id.as_str().to_owned();
        let next = AgentNextDto {
            kind: "agent_next".to_owned(),
            next_schema_version: schema::NEXT.to_owned(),
            mode: "discover".to_owned(),
            selection: "ready_work".to_owned(),
            status: NextStatusDto {
                display_status: "ready".to_owned(),
                work_id: Some(work_id.clone()),
                reason_codes: item
                    .decision
                    .reason_codes
                    .iter()
                    .map(|reason| format!("{reason:?}").to_ascii_lowercase())
                    .collect(),
                claimable_for_actor: true,
            },
            reason: NextReasonDto {
                code: "ready_work_selected".to_owned(),
                message: "One open automatic work item is available for this actor.".to_owned(),
                selection_key: format!("ready|{}|agent.start@v1", work_id),
            },
            next_action: Some(start_action(
                &parsed.options,
                &project,
                &work_id,
                snapshot.project_revision.0,
            )),
            context_refs: vec![ContextRefDto {
                reference_type: "work".to_owned(),
                id: work_id,
                revision: snapshot.project_revision.0,
            }],
            no_goal: parsed.options.work.is_none(),
        };
        return typed_result(
            ApplicationOutcome::Unchanged,
            Some(snapshot.project_revision.0),
            next,
        );
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
    typed_result(
        ApplicationOutcome::Unchanged,
        Some(snapshot.project_revision.0),
        next,
    )
}

fn guide_for_work(
    parsed: &ParsedCommand,
    app: &WorkApplication<'_>,
    store: &SqliteStore,
    project: &ProjectId,
    work_id: &str,
    resume: bool,
) -> Result<CliResult, CliError> {
    let work = app
        .show_work(project, work_id)
        .map_err(map_application_error)?;
    let revision = store_revision(store, project)?;
    let current = store
        .current_attempt_for_work(project.as_str(), work_id)
        .map_err(map_store_error)?;
    let (display_status, state, attempt_id, fence, reason_codes, next_action) =
        guide_state(parsed, project, &work, current.as_ref(), revision, resume)?;
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
            project_revision: revision,
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
        selection_key: format!("{}|{}|agent.guide@v1", work_id, revision),
    };
    typed_result(ApplicationOutcome::Unchanged, Some(revision), dto)
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

impl AttemptOperation {
    fn command_identity(self) -> &'static str {
        match self {
            Self::Accept => "attempt.accept/v1",
            Self::Heartbeat => "attempt.heartbeat/v1",
            Self::Release => "attempt.release/v1",
            Self::Submit => "attempt.submit/v1",
        }
    }
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
        kind.command_identity(),
        parsed.options.reason.as_deref(),
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
    let diagnostics = store
        .gate_diagnostics(
            parsed
                .options
                .project
                .as_deref()
                .ok_or_else(|| CliError::invalid("agent finish --close requires --project"))?,
            &work_id,
            expected_attempt,
            expected_fence,
        )
        .map_err(map_store_error)?;
    if diagnostics.missing.is_empty() {
        return Err(CliError::invalid(
            "proof-gated close requires typed summary/review facts; use the service finish workflow",
        ));
    }
    bounded_result(
        Some(json!({
            "attempt": submitted.data,
            "receipt_id": receipt.receipt_id.as_str(),
            "receipt_replayed": receipt_result.replayed,
            "close_intent": format!("{:?}", requested.close_intent.state).to_ascii_lowercase(),
            "close_state": "open",
            "close_replayed": false,
            "gates": json!({
                "missing": diagnostics.missing,
                "gates": diagnostics.gates.into_iter().map(|gate| json!({
                    "gate_id": gate.gate_id,
                    "kind": format!("{:?}", gate.kind).to_ascii_lowercase(),
                    "required": gate.required,
                    "state": format!("{:?}", gate.state).to_ascii_lowercase(),
                    "receipt_id": gate.receipt_id,
                    "reason": gate.reason,
                })).collect::<Vec<_>>(),
            }),
        })),
        Some(diagnostics.revision),
    )
    .map(|mut result| {
        result.outcome = ApplicationOutcome::Rejected;
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
    // Completed-operation replay is checked before reading declarations,
    // creating artifacts, or launching an external process. A separate
    // durable admitted/running state is still required to close the crash
    // window between this check and receipt commit.
    if let Some(existing) = store.operation(operation).map_err(map_store_error)? {
        if existing.command != "receipt.insert" {
            return Err(CliError::with(
                ErrorCode::OperationConflict,
                ApplicationOutcome::Conflict,
                "operation id is already bound to another command",
            ));
        }
        let replayed = store
            .read_receipt_operation(project.as_str(), operation)
            .map_err(map_store_error)?
            .ok_or_else(|| {
                CliError::with(
                    ErrorCode::UnknownOutcome,
                    ApplicationOutcome::Unknown,
                    "receipt operation exists but its result is unavailable",
                )
            })?;
        let gate_matches = replayed.receipt.gate_id.as_deref().is_some_and(|stored| {
            stored == gate_id.as_str()
                || stored
                    .strip_prefix(&format!("{}:", work_id))
                    .is_some_and(|short| short == gate_id.as_str())
        });
        if replayed.receipt.work_id.as_str() != work_id
            || !gate_matches
            || parsed
                .options
                .attempt
                .as_deref()
                .is_some_and(|attempt| attempt != replayed.receipt.attempt_id)
            || parsed
                .options
                .fence
                .is_some_and(|fence| fence != replayed.receipt.fence)
        {
            return Err(CliError::with(
                ErrorCode::OperationConflict,
                ApplicationOutcome::Conflict,
                "operation id is already bound to a different evidence target",
            ));
        }
        // The operation was durably completed even when the command itself
        // failed. Replay reports an unchanged transport/application state and
        // preserves the receipt result in the bounded payload.
        let outcome = ApplicationOutcome::Unchanged;
        return bounded_result(
            Some(json!({
                "receipt_id": replayed.receipt.receipt_id,
                "operation_id": replayed.receipt.operation_id,
                "result": format!("{:?}", replayed.receipt.result).to_ascii_lowercase(),
                "replayed": true,
            })),
            Some(replayed.revision),
        )
        .map(|mut result| {
            result.outcome = outcome;
            result
        });
    }
    if let Some(execution) = store
        .evidence_execution(operation)
        .map_err(map_store_error)?
    {
        let target_matches = execution.project_id == project.as_str()
            && execution.work_id == work_id
            && (execution.gate_id == gate_id
                || execution
                    .gate_id
                    .strip_prefix(&format!("{}:", work_id))
                    .is_some_and(|short| short == gate_id))
            && parsed
                .options
                .attempt
                .as_deref()
                .is_none_or(|attempt| attempt == execution.attempt_id)
            && parsed
                .options
                .fence
                .is_none_or(|fence| fence == execution.fence);
        if !target_matches {
            return Err(CliError::with(
                ErrorCode::OperationConflict,
                ApplicationOutcome::Conflict,
                "operation id is already bound to a different evidence execution",
            ));
        }
        return Err(CliError::with(
            ErrorCode::UnknownOutcome,
            ApplicationOutcome::Unknown,
            format!(
                "evidence operation {operation} is {:?}; it will not be launched again (artifact_ref={}, read back or reconcile this operation, or use a new operation id)",
                execution.state, execution.artifact_ref
            ),
        ));
    }
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
    // Keep artifacts scoped to the gate declaration root as well as the
    // operation. This prevents independent databases/tests that reuse a
    // human-readable operation ID from sharing mutable filesystem paths.
    let artifact_namespace = sha256_content_digest(
        format!("{}:{}", project.as_str(), gate_root.to_string_lossy()).as_bytes(),
    )
    .replace(':', "-");
    let output_dir = gate_root
        .parent()
        .unwrap_or(gate_root)
        .join("evidence")
        .join(artifact_namespace);
    let artifact_stem = sha256_content_digest(operation.as_bytes()).replace(':', "-");
    let output_path = output_dir.join(format!("{artifact_stem}.out"));
    let artifact_ref = output_path.with_extension("combined");
    let workspace_root = env::current_dir().map_err(|error| {
        CliError::with(
            ErrorCode::ReceiptInvalid,
            ApplicationOutcome::Rejected,
            format!("workspace root is unavailable: {error}"),
        )
    })?;
    let request = EvidenceRunRequest {
        receipt_id: ReceiptId::new(format!("receipt-{operation}")),
        operation_id: OperationId::new(operation),
        expectation,
        cwd: declaration.cwd.clone(),
        environment_fingerprint: declaration.environment_fingerprint.clone(),
        attestation: ExecutorAttestation::BorealWitnessed,
    };
    let admission = app
        .admit_witnessed_execution(
            &parsed.options.actor,
            Some(parsed.options.session.as_str()),
            &request,
            &artifact_ref.to_string_lossy(),
            TimestampMs::from_millis(now_ms_u64()),
        )
        .map_err(map_application_error)?;
    if admission.replayed {
        return Err(CliError::with(
            ErrorCode::UnknownOutcome,
            ApplicationOutcome::Unknown,
            format!(
                "evidence operation {operation} was already admitted as {:?}; it will not be launched again",
                admission.execution.state
            ),
        ));
    }
    if let Err(error) = fs::create_dir_all(&output_dir) {
        let _ = app.mark_witnessed_execution_unknown(operation, "artifact_directory_failed");
        return Err(CliError::with(
            ErrorCode::UnknownOutcome,
            ApplicationOutcome::Unknown,
            format!("evidence execution was admitted but artifact setup failed: {error}"),
        ));
    }
    app.start_witnessed_execution(operation, TimestampMs::from_millis(now_ms_u64()))
        .map_err(map_application_error)?;
    let execution = match execute_gate_command(&declaration, &output_path, Some(&workspace_root)) {
        Ok(execution) => execution,
        Err(error) => {
            let _ =
                app.mark_witnessed_execution_unknown(operation, "executor_failed_before_receipt");
            return Err(CliError::with(
                ErrorCode::UnknownOutcome,
                ApplicationOutcome::Unknown,
                format!(
                    "evidence operation was admitted and may have launched; automatic retry is disabled: {}",
                    error.message
                ),
            ));
        }
    };
    app.finish_witnessed_execution(operation, execution.exit_code, execution.ended_at)
        .map_err(map_application_error)?;
    let result = app
        .build_bounded_evidence_receipt(&request, &execution)
        .map_err(map_application_error)?;
    let inserted = app
        .record_witnessed_execution(
            &parsed.options.actor,
            Some(parsed.options.session.as_str()),
            &request,
            &result,
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
        "stdout_ref": output_path.to_string_lossy(),
        "stderr_ref": output_path.with_extension("err").to_string_lossy(),
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
            "output_digest": inserted.receipt.output_digest,
            "output_ref": inserted.receipt.output_ref,
            "stdout_ref": output_path,
            "stderr_ref": output_path.with_extension("err"),
            "observables": result.receipt.coverage.observables,
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
    // Capture each stream into its own create-new artifact. The capture
    // workers enforce the aggregate bound before bytes reach disk, rather
    // than allowing an external command to fill an unbounded file first.
    let stdout_file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(output_path)
        .map_err(|error| {
            CliError::with(
                ErrorCode::ServiceUnavailable,
                ApplicationOutcome::Failed,
                error.to_string(),
            )
        })?;
    let stderr_path = output_path.with_extension("err");
    let stderr_file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&stderr_path)
        .map_err(|error| {
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
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            CliError::with(
                ErrorCode::ReceiptInvalid,
                ApplicationOutcome::Rejected,
                format!("declared gate could not start: {error}"),
            )
        })?;
    let stdout_reader = child.stdout.take().ok_or_else(|| {
        CliError::with(
            ErrorCode::ServiceUnavailable,
            ApplicationOutcome::Failed,
            "declared gate stdout pipe was unavailable",
        )
    })?;
    let stderr_reader = child.stderr.take().ok_or_else(|| {
        CliError::with(
            ErrorCode::ServiceUnavailable,
            ApplicationOutcome::Failed,
            "declared gate stderr pipe was unavailable",
        )
    })?;
    let captured_bytes = Arc::new(AtomicU64::new(0));
    let output_exceeded = Arc::new(AtomicBool::new(false));
    let capture_failed = Arc::new(AtomicBool::new(false));
    let stdout_thread = spawn_capture_worker(
        stdout_reader,
        stdout_file,
        Arc::clone(&captured_bytes),
        Arc::clone(&output_exceeded),
        Arc::clone(&capture_failed),
    );
    let stderr_thread = spawn_capture_worker(
        stderr_reader,
        stderr_file,
        Arc::clone(&captured_bytes),
        Arc::clone(&output_exceeded),
        Arc::clone(&capture_failed),
    );
    let deadline = Instant::now() + Duration::from_millis(declaration.max_runtime_ms.unwrap_or(1));
    let mut timed_out = false;
    let child_status: Option<ExitStatus>;
    loop {
        if output_exceeded.load(Ordering::Acquire) || capture_failed.load(Ordering::Acquire) {
            let _ = child.kill();
            child_status = child.wait().ok();
            break;
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                child_status = Some(status);
                break;
            }
            Ok(None) => {}
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = stdout_thread.join();
                let _ = stderr_thread.join();
                return Err(CliError::with(
                    ErrorCode::ServiceUnavailable,
                    ApplicationOutcome::Failed,
                    error.to_string(),
                ));
            }
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            child_status = child.wait().ok();
            timed_out = true;
            break;
        }
        thread::sleep(Duration::from_millis(5));
    }
    let stdout_capture = stdout_thread.join().map_err(|_| {
        CliError::with(
            ErrorCode::ServiceUnavailable,
            ApplicationOutcome::Failed,
            "stdout capture worker panicked",
        )
    })?;
    let stderr_capture = stderr_thread.join().map_err(|_| {
        CliError::with(
            ErrorCode::ServiceUnavailable,
            ApplicationOutcome::Failed,
            "stderr capture worker panicked",
        )
    })?;
    if let Some(error) = stdout_capture.err().or(stderr_capture.err()) {
        return Err(CliError::with(
            ErrorCode::ServiceUnavailable,
            ApplicationOutcome::Failed,
            error,
        ));
    }
    let ended_at = TimestampMs::from_millis(now_ms_u64());
    let mut output = read_bounded_file(output_path, boreal_application::MAX_OUTPUT_BYTES)?;
    let mut error_output = read_bounded_file(&stderr_path, boreal_application::MAX_OUTPUT_BYTES)?;
    let output_size = output.len().saturating_add(error_output.len()) as u64;
    if output_exceeded.load(Ordering::Acquire) || output_size > boreal_application::MAX_OUTPUT_BYTES
    {
        return Err(CliError::with(
            ErrorCode::ReceiptInvalid,
            ApplicationOutcome::Rejected,
            "declared gate output exceeds the bounded limit",
        ));
    }
    output.append(&mut error_output);
    let observables = declaration
        .observables
        .iter()
        .filter(|observable| !observable.is_empty())
        .filter(|observable| {
            output
                .windows(observable.len())
                .any(|window| window == observable.as_bytes())
        })
        .cloned()
        .collect();
    let combined_path = output_path.with_extension("combined");
    let mut combined = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&combined_path)
        .map_err(|error| {
            CliError::with(
                ErrorCode::ServiceUnavailable,
                ApplicationOutcome::Failed,
                error.to_string(),
            )
        })?;
    combined.write_all(&output).map_err(|error| {
        CliError::with(
            ErrorCode::ServiceUnavailable,
            ApplicationOutcome::Failed,
            error.to_string(),
        )
    })?;
    combined.sync_all().map_err(|error| {
        CliError::with(
            ErrorCode::ServiceUnavailable,
            ApplicationOutcome::Failed,
            error.to_string(),
        )
    })?;
    let outcome = if timed_out {
        EvidenceExecutionOutcome::TimedOut
    } else if child_status.is_some_and(|status| status.success()) {
        EvidenceExecutionOutcome::Passed
    } else {
        EvidenceExecutionOutcome::Failed
    };
    let exit_code = if timed_out {
        None
    } else {
        child_status.and_then(|status| status.code())
    };
    Ok(BoundedExecutionResult {
        outcome,
        exit_code,
        started_at,
        ended_at,
        output_size_bytes: output.len() as u64,
        output_digest: Some(sha256_content_digest(&output)),
        output_ref: Some(combined_path.to_string_lossy().into_owned()),
        observables,
    })
}

fn spawn_capture_worker<R>(
    mut reader: R,
    mut file: fs::File,
    captured_bytes: Arc<AtomicU64>,
    output_exceeded: Arc<AtomicBool>,
    capture_failed: Arc<AtomicBool>,
) -> thread::JoinHandle<Result<(), String>>
where
    R: Read + Send + 'static,
{
    thread::spawn(move || {
        let mut buffer = [0_u8; 8 * 1024];
        loop {
            let read = match reader.read(&mut buffer) {
                Ok(read) => read,
                Err(error) => {
                    capture_failed.store(true, Ordering::Release);
                    return Err(error.to_string());
                }
            };
            if read == 0 {
                break;
            }
            let retained = reserve_output_bytes(
                &captured_bytes,
                read,
                boreal_application::MAX_OUTPUT_BYTES,
                &output_exceeded,
            );
            if retained > 0 {
                if let Err(error) = file.write_all(&buffer[..retained]) {
                    capture_failed.store(true, Ordering::Release);
                    return Err(error.to_string());
                }
            }
        }
        file.sync_all().map_err(|error| {
            capture_failed.store(true, Ordering::Release);
            error.to_string()
        })
    })
}

fn reserve_output_bytes(
    captured_bytes: &AtomicU64,
    incoming: usize,
    limit: u64,
    output_exceeded: &AtomicBool,
) -> usize {
    loop {
        let current = captured_bytes.load(Ordering::Acquire);
        if current >= limit {
            output_exceeded.store(true, Ordering::Release);
            return 0;
        }
        let available = limit - current;
        let retained = available.min(incoming as u64) as usize;
        if captured_bytes
            .compare_exchange(
                current,
                current + retained as u64,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .is_ok()
        {
            if retained < incoming {
                output_exceeded.store(true, Ordering::Release);
            }
            return retained;
        }
    }
}

fn read_bounded_file(path: &Path, limit: u64) -> Result<Vec<u8>, CliError> {
    let mut output = Vec::new();
    fs::File::open(path)
        .and_then(|file| file.take(limit.saturating_add(1)).read_to_end(&mut output))
        .map_err(|error| {
            CliError::with(
                ErrorCode::ServiceUnavailable,
                ApplicationOutcome::Failed,
                error.to_string(),
            )
        })?;
    Ok(output)
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

fn read_summary_body(parsed: &ParsedCommand) -> Result<String, CliError> {
    let path = parsed
        .options
        .summary
        .as_deref()
        .ok_or_else(|| CliError::invalid("agent finish --close requires --summary PATH"))?;
    let bytes = read_bounded_file(Path::new(path), boreal_store::MAX_SUMMARY_BODY_BYTES)?;
    if bytes.is_empty() {
        return Err(CliError::invalid("summary body must not be empty"));
    }
    if bytes.len() as u64 > boreal_store::MAX_SUMMARY_BODY_BYTES {
        return Err(CliError::invalid("summary body exceeds the 64 KiB bound"));
    }
    String::from_utf8(bytes).map_err(|_| CliError::invalid("summary body must be valid UTF-8 text"))
}

fn summary_payload(receipt: &ReceiptPayload, body: &str, operation: &str) -> SummaryPayload {
    SummaryPayload {
        summary_id: format!(
            "summary-{}-{}",
            receipt.attempt_id,
            operation.strip_prefix("op_").unwrap_or(operation)
        ),
        work_id: receipt.work_id.clone(),
        attempt_id: receipt.attempt_id.clone(),
        fence: receipt.fence,
        source_snapshot_hash: receipt.source_snapshot_hash.clone(),
        config_identity: receipt.config_identity.clone(),
        profile_id: receipt.coverage.profile_id.clone(),
        profile_version: receipt.coverage.profile_version.clone(),
        body_digest: sha256_content_digest(body.as_bytes()),
        body_size: body.len() as u64,
    }
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

#[allow(clippy::too_many_arguments)]
fn attempt_request(
    project: &ProjectId,
    work_id: &str,
    attempt_id: &AttemptId,
    options: &CliOptions,
    fence: Fence,
    operation: &str,
    command: &str,
    reason: Option<&str>,
) -> Result<AttemptRequest, CliError> {
    let request_digest = canonical_request_digest(
        command,
        json!({
            "project_id": project.as_str(),
            "work_id": work_id,
            "attempt_id": attempt_id.as_str(),
            "actor_id": options.actor,
            "harness_id": options.harness,
            "session_id": options.session,
            "fence": fence.get(),
            "reason": reason,
        }),
    );
    Ok(AttemptRequest::new(
        project.clone(),
        WorkId::new(work_id),
        attempt_id.clone(),
        ActorId::new(options.actor.clone()),
        Some(boreal_domain::HarnessId::new(options.harness.clone())),
        Some(SessionId::new(options.session.clone())),
        fence,
        OperationId::new(operation),
        request_digest,
        TimestampMs::from_millis(now_ms_u64()),
    ))
}

fn attempt_result(
    result: OperationResult<boreal_application::AttemptMutation>,
    snapshot: &boreal_application::AttemptSnapshot,
    store: &SqliteStore,
    project: &ProjectId,
) -> Result<CliResult, CliError> {
    let mut data = attempt_json(&result.value, snapshot);
    data["work_id"] = json!(snapshot.work_id.as_str());
    bounded_result(
        Some(data),
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
        request_digest: canonical_request_digest(
            "session.register/v1",
            json!({
                "project_id": project.as_str(),
                "session_id": options.session,
                "actor_id": options.actor,
                "harness_id": options.harness,
                "started_at": started_at.as_millis(),
            }),
        ),
        expected_project_revision: expected_revision,
        started_at,
    };
    let registered = app
        .register_session(&request)
        .map_err(map_application_error)?;
    Ok(Some(registered.snapshot_revision))
}

fn find_session_work(
    store: &SqliteStore,
    project: &ProjectId,
    actor: &str,
    session: &str,
) -> Result<Option<String>, CliError> {
    let attempt = store
        .current_attempt_for_session(project.as_str(), session)
        .map_err(map_store_error)?;
    Ok(attempt
        .filter(|attempt| attempt.actor_id == actor)
        .map(|attempt| attempt.work_id))
}

fn select_claimable_work(
    store: &SqliteStore,
    project: &ProjectId,
    actor: &str,
) -> Result<Option<String>, CliError> {
    let snapshot = boreal_application::project_status_from_store(
        store,
        project,
        &boreal_domain::ActorContext {
            actor_id: ActorId::new(actor.to_owned()),
            role: boreal_domain::ActorRole::Agent,
        },
        TimestampMs::from_millis(now_ms_u64()),
        1_000,
        0,
    )
    .map_err(|message| {
        CliError::with(
            ErrorCode::GuidanceUnavailable,
            ApplicationOutcome::Failed,
            message,
        )
    })?;
    Ok(snapshot
        .items
        .into_iter()
        .find(|item| item.work.kind == WorkKind::Task && item.decision.claimable_for_actor)
        .map(|item| item.work.id.as_str().to_owned()))
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
    canonical_request_digest(
        "attempt.transition/v1",
        json!({
            "operation_id": operation,
            "project_id": project.as_str(),
            "work_id": work,
            "attempt_id": attempt,
        }),
    )
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
    let sequence = OPERATION_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!(
        "op_cli_{}_{}_{}",
        now_ms_u64(),
        std::process::id(),
        sequence
    )
}

fn outcome_name(outcome: ApplicationOutcome) -> &'static str {
    match outcome {
        ApplicationOutcome::Changed => "changed",
        ApplicationOutcome::Unchanged => "unchanged",
        ApplicationOutcome::Rejected => "rejected",
        ApplicationOutcome::Conflict => "conflict",
        ApplicationOutcome::Busy => "busy",
        ApplicationOutcome::Failed => "failed",
        ApplicationOutcome::Unknown => "unknown",
    }
}

fn outcome_error_code(outcome: ApplicationOutcome) -> ErrorCode {
    match outcome {
        ApplicationOutcome::Rejected => ErrorCode::GateUnsatisfied,
        ApplicationOutcome::Conflict => ErrorCode::OperationConflict,
        ApplicationOutcome::Busy => ErrorCode::ServiceBusy,
        ApplicationOutcome::Failed => ErrorCode::ServiceUnavailable,
        ApplicationOutcome::Unknown => ErrorCode::UnknownOutcome,
        ApplicationOutcome::Changed | ApplicationOutcome::Unchanged => ErrorCode::InvalidArgument,
    }
}

/// Build the protocol error for an application result without discarding the
/// result's revision or bounded obligation data. Most unsuccessful results are
/// returned as `CliError`; proof-gated close is intentionally a bounded
/// `CliResult` so callers can inspect the exact missing obligations.
fn result_protocol_error(result: &CliResult, operation: &str) -> Option<ProtocolError> {
    if result.outcome.is_success() {
        return None;
    }

    let (code, message) = match result.outcome {
        ApplicationOutcome::Rejected => {
            let missing = result
                .data
                .as_ref()
                .and_then(|data| data.pointer("/gates/missing"))
                .and_then(Value::as_array)
                .map(|values| values.iter().filter_map(Value::as_str).collect::<Vec<_>>())
                .unwrap_or_default();
            if missing.is_empty() {
                (
                    ErrorCode::GateUnsatisfied,
                    "application request was rejected".to_owned(),
                )
            } else {
                (
                    ErrorCode::GateUnsatisfied,
                    format!(
                        "close requirements remain unsatisfied: {}; inspect data.gates.missing and submit current proof before retrying",
                        missing.join(", ")
                    ),
                )
            }
        }
        outcome => {
            let code = outcome_error_code(outcome);
            (
                code,
                format!("application outcome: {}", outcome_name(outcome)),
            )
        }
    };
    let mut error = ProtocolError::new(code, message, is_retryable(code));
    error.observed_revision = result.revision;
    if result.outcome == ApplicationOutcome::Unknown {
        error.operation_id = Some(operation.to_owned());
        error.readback_required = Some(true);
    }
    Some(error)
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
            | ErrorCode::GateUnsatisfied
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
    fn parser_allows_dashboard_project_discovery_and_explicit_context() {
        let discovered = parse(&args(&["dashboard", "--json"])).unwrap();
        assert_eq!(discovered.path, vec!["dashboard"]);
        assert_eq!(discovered.options.project, None);

        let explicit = parse(&args(&[
            "dashboard",
            "--project",
            "project-1",
            "--actor",
            "operator-1",
            "--harness",
            "terminal",
            "--session",
            "session-1",
        ]))
        .unwrap();
        assert_eq!(explicit.path, vec!["dashboard"]);
        assert_eq!(explicit.options.project.as_deref(), Some("project-1"));
        assert_eq!(explicit.options.actor, "operator-1");
        assert_eq!(explicit.options.harness, "terminal");
        assert_eq!(explicit.options.session, "session-1");

        let view = parse(&args(&["view", "--json"])).unwrap();
        assert_eq!(view.path, vec!["dashboard"]);
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
    fn operation_ids_are_fresh_unless_explicitly_retried() {
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
        assert_ne!(first, second);
        assert!(first.starts_with("op_"));
        let retry = operation_id(&args(&[
            "agent",
            "start",
            "w",
            "--operation-id",
            "op-retry-1",
        ]));
        let retry_again = operation_id(&args(&[
            "agent",
            "start",
            "w",
            "--operation-id",
            "op-retry-1",
        ]));
        assert_eq!(retry, "op-retry-1");
        assert_eq!(retry, retry_again);
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
        assert_ne!(first, second);

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
    fn every_application_outcome_has_a_consistent_error_and_exit_contract() {
        for outcome in [ApplicationOutcome::Changed, ApplicationOutcome::Unchanged] {
            let result = CliResult {
                outcome,
                revision: Some(4),
                data: Some(json!({"selection": "none"})),
            };
            assert!(result_protocol_error(&result, "op_success").is_none());
        }

        for (outcome, expected_code, expected_exit) in [
            (ApplicationOutcome::Rejected, ErrorCode::GateUnsatisfied, 7),
            (
                ApplicationOutcome::Conflict,
                ErrorCode::OperationConflict,
                4,
            ),
            (ApplicationOutcome::Busy, ErrorCode::ServiceBusy, 6),
            (ApplicationOutcome::Failed, ErrorCode::ServiceUnavailable, 9),
            (ApplicationOutcome::Unknown, ErrorCode::UnknownOutcome, 11),
        ] {
            let result = CliResult {
                outcome,
                revision: Some(9),
                data: Some(json!({"obligation": "preserved"})),
            };
            let error = result_protocol_error(&result, "op_outcome_contract")
                .expect("unsuccessful outcome has a protocol error");
            assert_eq!(error.code, expected_code);
            assert_eq!(error.observed_revision, Some(9));
            assert_eq!(exit_code(error.code), expected_exit);
            if outcome == ApplicationOutcome::Unknown {
                assert_eq!(error.operation_id.as_deref(), Some("op_outcome_contract"));
                assert_eq!(error.readback_required, Some(true));
            }
        }
    }

    #[test]
    fn rejected_close_error_names_preserved_gate_obligations() {
        let result = CliResult {
            outcome: ApplicationOutcome::Rejected,
            revision: Some(17),
            data: Some(json!({
                "close_state": "open",
                "gates": {"missing": ["work:checkpoint", "work:summary"]}
            })),
        };
        let error = result_protocol_error(&result, "op_rejected_close").unwrap();
        assert_eq!(error.code, ErrorCode::GateUnsatisfied);
        assert_eq!(error.observed_revision, Some(17));
        assert!(error.retryable);
        assert!(error.message.contains("work:checkpoint"));
        assert!(error.message.contains("work:summary"));
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
    fn no_goal_start_selects_and_starts_a_claimable_task() {
        let path =
            env::temp_dir().join(format!("boreal-cli-no-goal-start-{}.sqlite", now_ms_u64()));
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
        .expect("task creates");

        let result = run(&args(&[
            "agent",
            "start",
            "--project",
            "p",
            "--actor",
            "agent-1",
            "--harness",
            "cli",
            "--session",
            "session-no-goal-start",
            "--db",
            &db,
            "--json",
        ]))
        .expect("goal-less start selects a task");
        let data = result.data.expect("start data");
        assert_eq!(data["work_id"], "ready-work");
        assert_eq!(data["phase"], "running");
        assert_eq!(data["replayed"], false);

        let _ = fs::remove_file(path);
    }

    #[test]
    fn direct_status_uses_derived_hierarchy_and_readiness() {
        let path =
            env::temp_dir().join(format!("boreal-cli-derived-status-{}.sqlite", now_ms_u64()));
        let db = path.to_string_lossy().to_string();
        let _ = fs::remove_file(&path);

        run(&args(&["init", "p", "--db", &db])).expect("project initializes");
        run(&args(&[
            "work",
            "create",
            "p",
            "container",
            "Planning container",
            "--kind",
            "milestone",
            "--db",
            &db,
        ]))
        .expect("milestone creates");
        run(&args(&[
            "work",
            "create",
            "p",
            "task",
            "Executable task",
            "--db",
            &db,
        ]))
        .expect("task creates");

        let result =
            run(&args(&["status", "p", "--db", &db, "--json"])).expect("derived status succeeds");
        let status = result.data.expect("status data");
        let items = status["items"].as_array().expect("status items");
        let container = items
            .iter()
            .find(|item| item["work_id"] == "container")
            .expect("container row");
        assert_eq!(container["kind"], "milestone");
        assert_eq!(container["display_status"], "blocked");
        assert_eq!(container["claimable_for_actor"], false);
        let task = items
            .iter()
            .find(|item| item["work_id"] == "task")
            .expect("task row");
        assert_eq!(task["kind"], "task");
        assert_eq!(task["claimable_for_actor"], true);

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
        SqliteStore::open(&db_path, SCHEMA)
            .expect("database reopens for proof context")
            .execute_batch(&format!(
                "UPDATE attempt
                     SET source_version_id = 'source-1', config_identity = 'config-1'
                     WHERE attempt_id = '{}';",
                attempt_id
            ))
            .expect("attempt proof context binds");
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
                "coverage": {"kind": "verification", "profile_id": "focused", "profile_version": "1"},
                "attestation": "external_attested",
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
