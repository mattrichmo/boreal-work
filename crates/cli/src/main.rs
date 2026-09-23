use boreal_application::{
    canonical_request_digest, guide_checked, sha256_content_digest, AcceptanceGateDefinition,
    ApplicationError, AttemptPolicy, AttemptRequest, AuthenticatedOperationJournal,
    BoundedExecutionResult, CommandSpec, EndAttemptRequest, EvidenceExecutionOutcome,
    EvidenceRunRequest, ExecutorAttestation, IntakeBucket, IntakeBucketId, IntakeItem,
    IntakeItemId, IntakeKind, IntakeLifecycle, KnowledgeApplication, LivenessMetadata,
    OperationResult, ReceiptCoverage, ReceiptExpectation, ReceiptPayload,
    SessionRegistrationRequest, SourceCaptureInput, SqliteAttemptAdapter, SummaryPayload,
    WorkApplication, WorkflowRegistry,
};
use boreal_domain::{
    AcceptanceProfile, ActorId, AttemptId, AttemptPhase, ConfigIdentity, DispatchPolicy, Fence,
    GateId, GateKind, HarnessId, OperationId, PersistedLifecycle, ProjectId, ReasonCode, ReceiptId,
    ReceiptResult, SessionId, SourceVersionId, TimestampMs, WorkId, WorkItem, WorkKind,
};
use boreal_protocol::{
    models::{
        AgentGuideDto, AgentNextDto, ContextRefDto, GuidanceContextDto, GuidanceProvenanceDto,
        GuidanceStatusDto, NextActionDto, NextReasonDto, NextStatusDto, RequirementDto, SubjectDto,
        WorkflowAssetDto, WorkflowCriterionDto, WorkflowInputDto, WorkflowPackageDto,
        WorkflowShowDto,
    },
    schema, ApplicationOutcome, DetailReference, Envelope, ErrorCode, ProtocolError,
    TransportOutcome, API_VERSION,
};
use boreal_source::SourceCatalog;
use boreal_store::identity::{IdentityError, IdentityStore, WorkspaceBinding};
use boreal_store::{
    AttemptRecord, AuditEventRecord, EvidenceExecutionState,
    OperationOutcome as StoreOperationOutcome, OperationRecord, ReceiptAttestation, ReceiptOutcome,
    ReceiptRecord, SqliteBackupPackageReport, SqliteRestorePackageReport, SqliteStore, StoreError,
    WorkRecord,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    env, fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Child, Command, ExitCode, ExitStatus, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

#[cfg(unix)]
use std::os::unix::process::CommandExt;

mod command_registry;
mod dashboard;
mod service;
mod setup;
mod update;

/// The compatibility schema is reserved for explicitly labeled fixtures and
/// in-process legacy tests. Shipped CLI/service/dashboard paths must use the
/// exact production payload below so `SqliteStore` enables its canonical
/// identity and operation/audit enforcement.
const LEGACY_SCHEMA: &str = include_str!("../../../project/spec/schema-v2.sql");
const PRODUCTION_SCHEMA: &str = include_str!("../../../project/spec/schema-production.sql");
const MAX_JSON_BYTES: usize = boreal_protocol::bounds::MAX_INLINE_OUTPUT_BYTES;
const ENVELOPE_METADATA_BUDGET: usize = 4096;
const DEFAULT_ACTOR: &str = "agent-1";
const DEFAULT_HARNESS: &str = "cli";
const DEFAULT_SESSION: &str = "session-cli";
const MAX_GATE_RUNTIME_MS: u64 = 30_000;
const GATE_COMMANDS_DIR: &str = "gates";
const MAX_SOURCE_INPUT_BYTES: u64 = 16 * 1024 * 1024;
static OPERATION_COUNTER: AtomicU64 = AtomicU64::new(0);
const HELP: &str = r#"bwrk v2

Usage:
  bwrk commands [PATH] [--json]
  bwrk help [PATH] [--json]
  bwrk version [--json]
  bwrk workflows list [--json]
  bwrk workflows show WORKFLOW_REF [--json]
  bwrk init [PROJECT] [--interactive|--yes] [--agents codex,claude] [--project-root PATH] [--db PATH] [--dry-run] [--json]
  bwrk setup [PROJECT] [--yes] [--agents codex,claude] [--project-root PATH] [--db PATH] [--dry-run] [--json]
  bwrk install [PROJECT] [--yes] [--agents codex,claude] [--project-root PATH] [--db PATH] [--dry-run] [--json]
  bwrk update [--json]
  bwrk upgrade --machine [--json]  (alias for update)
  bwrk backup PACKAGE_DIR [--db PATH] [--json]
  bwrk restore PACKAGE_DIR [--db PATH] [--json]
  bwrk service run --db PATH --socket PATH [--max-requests N] [--dispatch-workers N] [--dispatch-capacity N] [--json]
  bwrk status <project> [--limit N] [--offset N] [--socket PATH] [--db PATH] [--json]
  bwrk dashboard [PROJECT] [--project PROJECT] [--db PATH] [--actor ID] [--harness ID] [--session ID] [--json]
  bwrk work create <project> <work-id> <title> [--kind milestone|sprint|task] [--parent WORK_ID] [--priority N] [--description TEXT] [--dispatch automatic|operator_only|paused] [--hold CODE] [--db PATH] [--json]
  bwrk work edit <project> <work-id> [--title TEXT] [--description TEXT] [--parent WORK_ID] [--priority N] [--dispatch automatic|operator_only|paused] --expected-revision N
  bwrk dep remove <project> <prerequisite-id> <dependent-id> --expected-revision N
  bwrk work hold add <project> <work-id> --reason CODE --expected-revision N
  bwrk work hold resolve <project> <work-id> <hold-id> --reason TEXT --expected-revision N
  bwrk work dispatch set <project> <work-id> --dispatch automatic|operator_only|paused --expected-revision N
  bwrk dep add <project> <prerequisite-id> <dependent-id> [--expected-revision N] [--db PATH] [--json]
  bwrk dep tree <project> [--db PATH] [--json]
  bwrk dep cycles <project> [--db PATH] [--json]
  bwrk source add <project> --input PATH --origin ORIGIN [--media-type TYPE] [--db PATH] [--json]
  bwrk source show <project> <source-version-id> [--db PATH] [--json]
  bwrk source list <project> [--limit N] [--offset N] [--db PATH] [--json]
  bwrk source verify <project> <source-version-id> [--db PATH] [--json]
  bwrk doctor [--project PROJECT] [--db PATH] [--json]
  bwrk work list <project> [--limit N] [--offset N] [--db PATH] [--json]
  bwrk work show <project> <work-id> [--db PATH] [--json]
  bwrk work claim <project> <work-id> [--session SESSION_ID] [--lease-ttl DURATION] [--time-limit DURATION] [--socket PATH] [--db PATH] [--json]
  bwrk work accept <project> <work-id> --attempt ATTEMPT_ID --fence N [--socket PATH] [--db PATH] [--json]
  bwrk work heartbeat <project> <work-id> --attempt ATTEMPT_ID --fence N [--socket PATH] [--db PATH] [--json]
  bwrk work renew <project> <work-id> --attempt ATTEMPT_ID --fence N [--lease-ttl DURATION] [--socket PATH] [--db PATH] [--json]
  bwrk work release <project> <work-id> --attempt ATTEMPT_ID --fence N [--socket PATH] [--db PATH] [--json]
  bwrk work finish <project> <work-id> --attempt ATTEMPT_ID --fence N [--socket PATH] [--db PATH] [--json]
  bwrk agent guide [--project PROJECT] [--work WORK_ID] [--json]
  bwrk next [--project PROJECT] [--work WORK_ID] [--json]
  bwrk agent status [--project PROJECT] [--session SESSION_ID] [--json]
  bwrk agent start [WORK_ID] [--project PROJECT] [--session SESSION_ID] [--lease-ttl DURATION] [--time-limit DURATION] [--socket PATH] [--json]
  bwrk agent resume --project PROJECT --session SESSION_ID --attempt ATTEMPT_ID [--json]
  bwrk agent heartbeat --project PROJECT --work WORK_ID --attempt ATTEMPT_ID --fence N [--socket PATH] [--json]
  bwrk agent renew --project PROJECT --work WORK_ID --attempt ATTEMPT_ID --fence N [--lease-ttl DURATION] [--socket PATH] [--json]
  bwrk agent release WORK_ID --project PROJECT --attempt ATTEMPT_ID --fence N [--socket PATH] [--reason CODE] [--json]
  bwrk agent finish WORK_ID --close --project PROJECT --attempt ATTEMPT_ID --fence N --receipt PATH --summary PATH [--socket PATH] [--json]
  bwrk agent finish WORK_ID --release --project PROJECT --attempt ATTEMPT_ID --fence N [--socket PATH] [--reason CODE] [--json]
  bwrk evidence run --project PROJECT --work WORK_ID --gate GATE_ID [--attempt ATTEMPT_ID --fence N] [--json]
  bwrk evidence add --project PROJECT --work WORK_ID --gate GATE_ID --receipt PATH [--json]
  bwrk session start --project PROJECT --session SESSION_ID --harness HARNESS_ID [--json]
  bwrk session show --project PROJECT --session SESSION_ID [--json]
  bwrk session end --project PROJECT --session SESSION_ID [--expected-revision N] [--json]
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
    machine: bool,
    include_expiry: bool,
    limit: Option<u64>,
    offset: Option<u64>,
    max_requests: Option<usize>,
    dispatch_workers: Option<usize>,
    dispatch_capacity: Option<usize>,
    kind: Option<String>,
    parent: Option<String>,
    description: Option<String>,
    title: Option<String>,
    priority: Option<u8>,
    dispatch: Option<String>,
    hold: Option<String>,
    bucket: Option<String>,
    input: Option<String>,
    origin: Option<String>,
    media_type: Option<String>,
    source_version: Option<String>,
    config_identity: Option<String>,
    setup: SetupCliOptions,
    positionals: Vec<String>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
struct SetupCliOptions {
    interactive: bool,
    yes: bool,
    dry_run: bool,
    agents: Option<String>,
    project_root: Option<String>,
    memory_layout: Option<String>,
    install_root: Option<String>,
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
            machine: false,
            include_expiry: false,
            limit: None,
            offset: None,
            max_requests: None,
            dispatch_workers: None,
            dispatch_capacity: None,
            kind: None,
            parent: None,
            description: None,
            title: None,
            priority: None,
            dispatch: None,
            hold: None,
            bucket: None,
            input: None,
            origin: None,
            media_type: None,
            source_version: None,
            config_identity: None,
            setup: SetupCliOptions::default(),
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
    transport: TransportOutcome,
    as_of: Option<String>,
    next_status_change_at: Option<String>,
    detail_ref: Option<DetailReference>,
    protocol_error: Option<ProtocolError>,
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
            transport: TransportOutcome::Ok,
            as_of: None,
            next_status_change_at: None,
            detail_ref: None,
            protocol_error: None,
        }
    }

    fn from_envelope(
        error: ProtocolError,
        outcome: ApplicationOutcome,
        operation_id: Option<&str>,
        as_of: Option<String>,
        next_status_change_at: Option<String>,
        detail_ref: Option<DetailReference>,
    ) -> Self {
        let mut value = Self::with(error.code, outcome, error.message.clone());
        value.as_of = as_of;
        value.next_status_change_at = next_status_change_at;
        value.detail_ref = detail_ref;
        value.protocol_error = Some(error);
        if outcome == ApplicationOutcome::Unknown {
            if let Some(protocol_error) = value.protocol_error.as_mut() {
                protocol_error.readback_required = Some(true);
                if protocol_error.operation_id.is_none() {
                    protocol_error.operation_id = operation_id.map(str::to_owned);
                }
                if protocol_error.operation_preserved.is_none() {
                    protocol_error.operation_preserved = Some(true);
                }
            }
        }
        value
    }

    fn unknown_delivery(operation: &str, message: impl Into<String>) -> Self {
        let mut error = ProtocolError::new(ErrorCode::UnknownOutcome, message.into(), false);
        error.operation_id = Some(operation.to_owned());
        error.operation_preserved = Some(true);
        error.readback_required = Some(true);
        let mut value = Self::with(
            ErrorCode::UnknownOutcome,
            ApplicationOutcome::Unknown,
            error.message.clone(),
        );
        value.transport = TransportOutcome::Error;
        value.protocol_error = Some(error);
        value
    }
}

#[derive(Clone, Debug)]
struct CliResult {
    outcome: ApplicationOutcome,
    revision: Option<u64>,
    data: Option<Value>,
    human: Option<String>,
    as_of: Option<String>,
    next_status_change_at: Option<String>,
    detail_ref: Option<DetailReference>,
}

impl Default for CliResult {
    fn default() -> Self {
        Self {
            outcome: ApplicationOutcome::Changed,
            revision: None,
            data: None,
            human: None,
            as_of: None,
            next_status_change_at: None,
            detail_ref: None,
        }
    }
}

fn main() -> ExitCode {
    let args = env::args().skip(1).collect::<Vec<_>>();
    if args.is_empty() {
        println!("{HELP}");
        return ExitCode::SUCCESS;
    }
    let json_output = args.iter().any(|arg| arg == "--json");
    let discovery = args
        .iter()
        .any(|arg| matches!(arg.as_str(), "--help" | "-h" | "--version"));
    if discovery {
        let wants_version = args.iter().any(|arg| arg == "--version");
        let has_data_operand = args.iter().enumerate().any(|(index, arg)| {
            index > 0 && !arg.starts_with('-') && !matches!(arg.as_str(), "help" | "version")
        });
        if !json_output && !has_data_operand {
            if wants_version {
                println!("bwrk {} (api {})", env!("CARGO_PKG_VERSION"), API_VERSION);
            } else {
                println!("{HELP}");
            }
            return ExitCode::SUCCESS;
        }
        if json_output && !has_data_operand {
            let data = if wants_version {
                json!({
                    "command": "version",
                    "version": env!("CARGO_PKG_VERSION"),
                    "api_version": API_VERSION,
                })
            } else {
                json!({ "command": "help", "text": HELP })
            };
            print_envelope(
                operation_id(&args),
                None,
                ApplicationOutcome::Changed,
                Some(data),
                None,
                None,
                None,
                TransportOutcome::Ok,
                None,
            );
            return ExitCode::SUCCESS;
        }
        if has_data_operand {
            let message =
                "help/version flags must be a command discovery request, not a data operand";
            if json_output {
                let error = CliError::invalid(message);
                print_envelope(
                    operation_id(&args),
                    None,
                    error.outcome,
                    None,
                    error.as_of,
                    error.next_status_change_at,
                    error.detail_ref,
                    error.transport,
                    error.protocol_error.or_else(|| {
                        Some(ProtocolError::new(error.code, error.message.clone(), false))
                    }),
                );
                return ExitCode::from(error.exit);
            }
            eprintln!("error [{}]: {message}", ErrorCode::InvalidArgument);
            return ExitCode::from(exit_code(ErrorCode::InvalidArgument));
        }
    }
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
                    result.as_of,
                    result.next_status_change_at,
                    result.detail_ref,
                    TransportOutcome::Ok,
                    application_error.clone(),
                );
            } else if !interactive_dashboard {
                if let Some(human) = result.human.as_deref() {
                    print!("{human}");
                } else if let Some(data) = result.data {
                    println!("{}", serde_json::to_string_pretty(&data).unwrap());
                }
            }
            if result.outcome.is_success() {
                if !json_output && !has_data && result.human.is_none() && !interactive_dashboard {
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
                print_envelope(
                    operation,
                    None,
                    error.outcome,
                    None,
                    error.as_of,
                    error.next_status_change_at,
                    error.detail_ref,
                    error.transport,
                    error.protocol_error.or(Some(protocol_error)),
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
    as_of: Option<String>,
    next_status_change_at: Option<String>,
    detail_ref: Option<DetailReference>,
    transport: TransportOutcome,
    error: Option<ProtocolError>,
) {
    let envelope = Envelope {
        api_version: API_VERSION.to_owned(),
        schema_version: schema::ENVELOPE.to_owned(),
        operation_id,
        revision,
        as_of: as_of.unwrap_or_else(now),
        next_status_change_at,
        transport,
        outcome,
        data,
        detail_ref,
        error,
    };
    let encoded = serde_json::to_string(&envelope).unwrap_or_else(|_| "{}".to_owned());
    let encoded = if encoded.len() <= MAX_JSON_BYTES {
        encoded
    } else {
        // A committed result must not be relabeled as failed because its
        // presentation exceeded the inline bound. Keep the operation and
        // revision visible and replace only the oversized inline body with a
        // durable-operation reference.
        let fallback = Envelope {
            api_version: API_VERSION.to_owned(),
            schema_version: schema::ENVELOPE.to_owned(),
            operation_id: envelope.operation_id.clone(),
            revision: envelope.revision,
            as_of: envelope.as_of.clone(),
            next_status_change_at: envelope.next_status_change_at.clone(),
            transport: envelope.transport,
            outcome: envelope.outcome,
            data: None::<Value>,
            detail_ref: Some(DetailReference {
                uri: Some(format!("operation:{}", envelope.operation_id)),
                digest: None,
                size_bytes: Some(encoded.len() as u64),
                expires_at: None,
            }),
            error: envelope.error.clone(),
        };
        let fallback = serde_json::to_string(&fallback).unwrap_or_else(|_| "{}".to_owned());
        if fallback.len() <= MAX_JSON_BYTES {
            fallback
        } else {
            // Error metadata is also untrusted input at this boundary. Keep
            // the typed code and recovery identity, but cap a pathological
            // message/field payload so the outer envelope remains valid.
            let minimal_error = envelope.error.clone().map(|error| {
                let mut value = ProtocolError::new(
                    error.code,
                    error.message.chars().take(256).collect::<String>(),
                    error.retryable,
                );
                value.operation_id = error.operation_id;
                value.operation_preserved = error.operation_preserved;
                value.readback_required = error.readback_required;
                value
            });
            let operation_id = envelope.operation_id.clone();
            let minimal = Envelope {
                api_version: API_VERSION.to_owned(),
                schema_version: schema::ENVELOPE.to_owned(),
                operation_id: operation_id.clone(),
                revision: envelope.revision,
                as_of: envelope.as_of,
                next_status_change_at: envelope.next_status_change_at,
                transport: envelope.transport,
                outcome: envelope.outcome,
                data: None::<Value>,
                detail_ref: Some(DetailReference {
                    uri: Some(format!("operation:{operation_id}")),
                    digest: None,
                    size_bytes: Some(encoded.len() as u64),
                    expires_at: None,
                }),
                error: minimal_error,
            };
            serde_json::to_string(&minimal).unwrap_or_else(|_| "{}".to_owned())
        }
    };
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
    if command_registry::is_registry_path(&parsed.path) {
        return command_registry::result(&parsed);
    }
    if parsed.options.socket.is_none()
        && parsed.path.first().map(String::as_str) == Some("workflows")
    {
        return workflow_result(&parsed);
    }
    if command_registry::is_unavailable_path(&parsed.path) {
        return Err(CliError::with(
            ErrorCode::UnknownCommandNamespace,
            ApplicationOutcome::Rejected,
            format!(
                "command route is catalogued but unavailable: {}; inspect `bwrk commands {}`",
                parsed.path.join(" "),
                parsed.path.join(" ")
            ),
        ));
    }
    if parsed.path == ["dashboard"] {
        return dashboard::run_dashboard(&parsed);
    }
    if parsed.path.len() == 1 && matches!(parsed.path[0].as_str(), "update" | "upgrade") {
        if parsed.options.socket.is_some() {
            if service::supports(&parsed) {
                return service::request(&parsed, operation);
            }
            return Err(CliError::with(
                ErrorCode::UnknownCommandNamespace,
                ApplicationOutcome::Rejected,
                "the requested update command is not available through the selected service socket",
            ));
        }
        return service::run_update(&parsed, operation);
    }
    if matches!(parsed.path.as_slice(), [path] if path == "backup" || path == "restore") {
        return backup_restore_result(&parsed);
    }
    let setup_command = setup::is_setup_command(&parsed.path);
    let setup_requested = setup::should_setup(&parsed);
    if setup_command && parsed.options.expected_revision.is_some() {
        return Err(CliError::invalid(
            "project creation does not yet expose an atomic expected-revision store contract",
        ));
    }
    if ((setup_command && parsed.path[0] != "init") || setup_requested)
        && parsed.options.socket.is_some()
    {
        return Err(CliError::invalid(
            "project setup runs in the local project folder; omit --socket",
        ));
    }
    if parsed.options.socket.is_some() {
        if service::supports(&parsed) {
            return service::request(&parsed, operation);
        }
        let message = if command_registry::is_unavailable_path(&parsed.path) {
            format!(
                "command route is catalogued but unavailable through the selected service socket: {}; inspect `bwrk commands {}`",
                parsed.path.join(" "),
                parsed.path.join(" ")
            )
        } else {
            "the requested command is not available through the selected service socket".to_owned()
        };
        return Err(CliError::with(
            ErrorCode::UnknownCommandNamespace,
            ApplicationOutcome::Rejected,
            message,
        ));
    }
    let setup_plan = if setup_requested {
        Some(setup::prepare(&parsed)?)
    } else {
        None
    };
    if setup_plan.as_ref().is_some_and(|plan| plan.dry_run) {
        let plan = setup_plan.as_ref().expect("setup plan exists for dry-run");
        return Ok(CliResult {
            outcome: ApplicationOutcome::Unchanged,
            data: parsed.options.json.then(|| setup::plan_value(plan)),
            human: (!parsed.options.json).then(|| setup::render(plan, None)),
            ..CliResult::default()
        });
    }
    let path = setup_plan.as_ref().map_or_else(
        || PathBuf::from(&parsed.options.db),
        |plan| plan.database.clone(),
    );
    ensure_db_parent(&path)?;
    let owner_parsed = if let Some(plan) = setup_plan.as_ref() {
        let mut owner = parsed.clone();
        owner.options.positionals = vec![plan.project_id.clone()];
        owner
    } else {
        parsed.clone()
    };
    let _database_owner = direct_database_owner(&path, &owner_parsed)?;
    if setup_command {
        let project = if let Some(plan) = setup_plan.as_ref() {
            plan.project_id.clone()
        } else {
            project_argument(&parsed, 0)?
        };
        let binding_root = if let Some(plan) = setup_plan.as_ref() {
            plan.project_root.clone()
        } else {
            env::current_dir().map_err(|error| {
                CliError::with(
                    ErrorCode::ServiceUnavailable,
                    ApplicationOutcome::Failed,
                    format!("cannot resolve the project folder: {error}"),
                )
            })?
        };
        let binding = workspace_binding(&binding_root)?;
        let store = SqliteStore::open(&path, PRODUCTION_SCHEMA).map_err(map_store_error)?;
        let app = WorkApplication::new(&store);
        let initialized_at = now();
        let result = app
            .init_project_with_workspace(
                &ProjectId::new(project.clone()),
                &parsed.options.actor,
                "agent",
                "cli",
                "CLI agent",
                &binding,
                &initialized_at,
                operation.to_owned(),
            )
            .map_err(map_application_error)?;
        let mut outcome = if result.changed {
            ApplicationOutcome::Changed
        } else {
            ApplicationOutcome::Unchanged
        };
        let (data, human) = if let Some(plan) = setup_plan.as_ref() {
            let setup_result = setup::apply(plan)?;
            if setup_result.changed {
                outcome = ApplicationOutcome::Changed;
            }
            let value = setup::result_value(plan, &setup_result);
            (
                parsed.options.json.then_some(value),
                (!parsed.options.json).then(|| setup::render(plan, Some(&setup_result))),
            )
        } else {
            (None, None)
        };
        return Ok(CliResult {
            outcome,
            revision: Some(result.snapshot_revision),
            data,
            human,
            ..CliResult::default()
        });
    }
    let store = SqliteStore::open(&path, PRODUCTION_SCHEMA).map_err(map_store_error)?;
    let app = WorkApplication::new(&store);
    let adapter = SqliteAttemptAdapter::new(&store);
    dispatch(&parsed, operation, &app, &adapter, &store)
}

fn backup_restore_result(parsed: &ParsedCommand) -> Result<CliResult, CliError> {
    let package = parsed
        .options
        .positionals
        .first()
        .map(PathBuf::from)
        .ok_or_else(|| CliError::invalid("backup or restore requires a package directory"))?;
    let database = PathBuf::from(&parsed.options.db);
    ensure_db_parent(&database)?;
    let _database_owner = direct_database_maintenance_owner(&database)?;
    match parsed.path.first().map(String::as_str) {
        Some("backup") => {
            if !database.exists() {
                return Err(CliError::with(
                    ErrorCode::NotFound,
                    ApplicationOutcome::Rejected,
                    format!("database does not exist: {}", database.display()),
                ));
            }
            let store = SqliteStore::open(&database, PRODUCTION_SCHEMA).map_err(map_store_error)?;
            let report = store.backup_package_to(&package).map_err(map_store_error)?;
            let data = backup_package_json(&report);
            bounded_result(Some(data), None).map(|mut result| {
                result.outcome = ApplicationOutcome::Changed;
                result.human = Some(format!(
                    "Backup written to {} ({} project(s), restore {}.)",
                    report.package_path.display(),
                    report.project_count,
                    if report.restore_supported {
                        "supported"
                    } else {
                        "blocked by external references"
                    }
                ));
                result
            })
        }
        Some("restore") => {
            let report =
                SqliteStore::restore_package_to(&package, &database).map_err(map_store_error)?;
            let data = restore_package_json(&report);
            bounded_result(Some(data), None).map(|mut result| {
                result.outcome = ApplicationOutcome::Changed;
                result.human = Some(format!(
                    "Restored {} to {} at restore epoch {}. Previous database: {}",
                    report.package_path.display(),
                    report.destination_path.display(),
                    report.current_restore_epoch,
                    report
                        .previous_database_path
                        .as_ref()
                        .map_or_else(|| "none".to_owned(), |path| path.display().to_string())
                ));
                result
            })
        }
        _ => Err(CliError::invalid("unknown backup/restore route")),
    }
}

fn backup_package_json(report: &SqliteBackupPackageReport) -> Value {
    json!({
        "package_path": report.package_path,
        "database_path": report.database_path,
        "manifest_path": report.manifest_path,
        "source_page_count": report.backup.source_page_count,
        "pages_copied": report.backup.pages_copied,
        "busy_retries": report.backup.busy_retries,
        "project_count": report.project_count,
        "referenced_blob_count": report.referenced_blob_count,
        "published_memory_count": report.published_memory_count,
        "restore_supported": report.restore_supported,
    })
}

fn restore_package_json(report: &SqliteRestorePackageReport) -> Value {
    json!({
        "package_path": report.package_path,
        "destination_path": report.destination_path,
        "previous_database_path": report.previous_database_path,
        "source_database_instance_id": report.source_database_instance_id,
        "source_restore_epoch": report.source_restore_epoch,
        "current_database_instance_id": report.current_database_instance_id,
        "current_restore_epoch": report.current_restore_epoch,
        "source_page_count": report.backup.source_page_count,
        "pages_copied": report.backup.pages_copied,
        "busy_retries": report.backup.busy_retries,
    })
}

fn workflow_result(parsed: &ParsedCommand) -> Result<CliResult, CliError> {
    let registry = WorkflowRegistry::embedded().map_err(|error| {
        CliError::with(
            ErrorCode::ProtocolMismatch,
            ApplicationOutcome::Failed,
            error.to_string(),
        )
    })?;
    let package = workflow_package_json(&registry);
    match parsed.path.get(1).map(String::as_str) {
        Some("list") if parsed.options.positionals.is_empty() => {
            bounded_result(Some(package), None)
        }
        Some("show") if parsed.options.positionals.len() == 1 => {
            let reference = &parsed.options.positionals[0];
            let asset = registry.get(reference).map_err(|error| {
                CliError::with(
                    ErrorCode::NotFound,
                    ApplicationOutcome::Rejected,
                    error.to_string(),
                )
            })?;
            bounded_result(Some(workflow_show_json(&registry, asset)), None)
        }
        _ => Err(CliError::invalid(
            "workflows requires `list` or `show WORKFLOW_REF`",
        )),
    }
}

fn workflow_package_json(registry: &WorkflowRegistry) -> Value {
    let mut package = serde_json::to_value(workflow_package_dto(registry))
        .expect("workflow package DTO is serializable");
    package["command"] = json!("workflows list");
    package
}

fn workflow_asset_dto(asset: &boreal_application::WorkflowAsset) -> WorkflowAssetDto {
    WorkflowAssetDto {
        reference: asset.reference.clone(),
        kind: asset.kind.clone(),
        title: asset.title.clone(),
        allowed_commands: asset.allowed_commands.clone(),
        typed_inputs: asset
            .typed_inputs
            .iter()
            .map(|input| WorkflowInputDto {
                name: input.name.clone(),
                input_type: input.input_type.clone(),
                source: input.source.clone(),
                validation: input.validation.clone(),
            })
            .collect(),
        finish_criteria: asset
            .finish_criteria
            .iter()
            .map(|criterion| WorkflowCriterionDto {
                id: criterion.id.clone(),
                criterion_type: criterion.criterion_type.clone(),
                required: criterion.required,
            })
            .collect(),
        next_refs: asset.next_refs.clone(),
    }
}

fn workflow_package_dto(registry: &WorkflowRegistry) -> WorkflowPackageDto {
    WorkflowPackageDto {
        schema_version: registry.schema_version().to_owned(),
        package_id: registry.package_id().to_owned(),
        package_version: registry.package_version().to_owned(),
        asset_identity: registry.asset_identity().to_owned(),
        assets: registry.assets().iter().map(workflow_asset_dto).collect(),
    }
}

fn workflow_show_json(
    registry: &WorkflowRegistry,
    asset: &boreal_application::WorkflowAsset,
) -> Value {
    let mut show = serde_json::to_value(WorkflowShowDto {
        package: workflow_package_dto(registry),
        asset: workflow_asset_dto(asset),
    })
    .expect("workflow show DTO is serializable");
    show["command"] = json!("workflows show");
    show
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
        ["work", "edit"] => work_edit_result(parsed, app, operation),
        ["work", "hold", "add"] => work_hold_add_result(parsed, app, operation),
        ["work", "hold", "resolve"] => work_hold_resolve_result(parsed, app, operation),
        ["work", "dispatch", "set"] => work_dispatch_set_result(parsed, app, operation),
        ["dep", "add"] => dependency_add_result(parsed, app, operation),
        ["dep", "remove"] => dependency_remove_result(parsed, app, operation),
        ["dep", "tree"] | ["dep", "cycles"] => dependency_graph_result(parsed, app),
        ["cycle", "board"] | ["cycle", "report"] => cycle_board_result(parsed, app),
        ["intake", "list"] => intake_list_result(parsed, app),
        ["intake", "show"] => intake_show_result(parsed, app),
        ["intake", "bucket"] => intake_bucket_result(parsed, app, operation),
        ["intake", "capture"] => intake_capture_result(parsed, app, operation),
        ["source", "add"] => source_add_result(parsed, operation, store),
        ["source", "show"] => source_show_result(parsed, store),
        ["source", "list"] => source_list_result(parsed, store),
        ["source", "verify"] => source_verify_result(parsed, store),
        ["doctor"] => doctor_result(parsed, store),
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
        ["work", "renew"] => attempt_mutation_result(
            parsed,
            app,
            adapter,
            operation,
            store,
            AttemptOperation::Renew,
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
        ["agent", "status"] => status_result(parsed, store),
        ["agent", "heartbeat"] => attempt_mutation_result(
            parsed,
            app,
            adapter,
            operation,
            store,
            AttemptOperation::Heartbeat,
        ),
        ["agent", "renew"] => attempt_mutation_result(
            parsed,
            app,
            adapter,
            operation,
            store,
            AttemptOperation::Renew,
        ),
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
        ["session", "start"] => session_start_result(parsed, app, operation),
        ["session", "show"] => session_show_result(parsed, app),
        ["session", "end"] => session_end_result(parsed, app, operation),
        _ if command_registry::is_unavailable_path(&parsed.path) => Err(CliError::with(
            ErrorCode::UnknownCommandNamespace,
            ApplicationOutcome::Rejected,
            format!(
                "command route is catalogued but unavailable: {}; inspect `bwrk commands {}`",
                parsed.path.join(" "),
                parsed.path.join(" ")
            ),
        )),
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
        machine: false,
        include_expiry: false,
        limit: None,
        offset: None,
        max_requests: None,
        dispatch_workers: None,
        dispatch_capacity: None,
        kind: None,
        parent: None,
        description: None,
        title: None,
        priority: None,
        dispatch: None,
        hold: None,
        bucket: None,
        input: None,
        origin: None,
        media_type: None,
        source_version: None,
        config_identity: None,
        setup: SetupCliOptions::default(),
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
        if arg == "--machine" {
            if path.as_slice() != ["upgrade"] {
                return Err(CliError::invalid(
                    "--machine is only valid with `bwrk upgrade`",
                ));
            }
            options.machine = true;
            index += 1;
            continue;
        }
        if arg == "--include-expiry" {
            options.include_expiry = true;
            index += 1;
            continue;
        }
        if arg == "--interactive" {
            options.setup.interactive = true;
            index += 1;
            continue;
        }
        if arg == "--yes" {
            options.setup.yes = true;
            index += 1;
            continue;
        }
        if arg == "--dry-run" {
            options.setup.dry_run = true;
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
                | "--dispatch-workers"
                | "--dispatch-capacity"
                | "--kind"
                | "--parent"
                | "--description"
                | "--title"
                | "--priority"
                | "--dispatch"
                | "--hold"
                | "--bucket"
                | "--input"
                | "--origin"
                | "--media-type"
                | "--source-version"
                | "--config-identity"
                | "--agents"
                | "--project-root"
                | "--memory-layout"
                | "--install-root" => Some(option_value(args, &mut index, canonical)?),
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
                    let revision = parse_revision(&value.unwrap())?;
                    if options.expected_revision.replace(revision).is_some() {
                        return Err(CliError::invalid(
                            "--revision and --expected-revision may be supplied only once",
                        ));
                    }
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
                "--dispatch-workers" => {
                    let value = parse_revision(&value.unwrap())?;
                    options.dispatch_workers = Some(usize::try_from(value).map_err(|_| {
                        CliError::invalid("--dispatch-workers is too large for this platform")
                    })?);
                }
                "--dispatch-capacity" => {
                    let value = parse_revision(&value.unwrap())?;
                    options.dispatch_capacity = Some(usize::try_from(value).map_err(|_| {
                        CliError::invalid("--dispatch-capacity is too large for this platform")
                    })?);
                }
                "--kind" => {
                    let kind = value.unwrap();
                    let intake_kind = path.as_slice() == ["intake", "capture"];
                    if (intake_kind
                        && !matches!(kind.as_str(), "note" | "discovery" | "question" | "revisit"))
                        || (!intake_kind
                            && !matches!(kind.as_str(), "milestone" | "sprint" | "task"))
                    {
                        return Err(CliError::invalid(if intake_kind {
                            "--kind must be note, discovery, question, or revisit"
                        } else {
                            "--kind must be milestone, sprint, or task"
                        }));
                    }
                    options.kind = Some(kind);
                }
                "--parent" => options.parent = Some(value.unwrap()),
                "--description" => options.description = Some(value.unwrap()),
                "--title" => options.title = Some(value.unwrap()),
                "--priority" => {
                    options.priority = Some(value.unwrap().parse().map_err(|_| {
                        CliError::invalid("--priority must be an integer from 0 to 255")
                    })?);
                }
                "--dispatch" => {
                    let dispatch = value.unwrap();
                    if !matches!(dispatch.as_str(), "automatic" | "operator_only" | "paused") {
                        return Err(CliError::invalid(
                            "--dispatch must be automatic, operator_only, or paused",
                        ));
                    }
                    options.dispatch = Some(dispatch);
                }
                "--hold" => {
                    let hold = value.unwrap();
                    if hold.trim().is_empty() {
                        return Err(CliError::invalid("--hold must not be empty"));
                    }
                    options.hold = Some(hold);
                }
                "--bucket" => {
                    let bucket = value.unwrap();
                    if bucket.trim().is_empty() {
                        return Err(CliError::invalid("--bucket must not be empty"));
                    }
                    options.bucket = Some(bucket);
                }
                "--input" => options.input = Some(value.unwrap()),
                "--origin" => {
                    let origin = value.unwrap();
                    if origin.trim().is_empty() {
                        return Err(CliError::invalid("--origin must not be empty"));
                    }
                    options.origin = Some(origin);
                }
                "--media-type" => {
                    let media_type = value.unwrap();
                    if media_type.trim().is_empty() {
                        return Err(CliError::invalid("--media-type must not be empty"));
                    }
                    options.media_type = Some(media_type);
                }
                "--source-version" => options.source_version = Some(value.unwrap()),
                "--config-identity" => options.config_identity = Some(value.unwrap()),
                "--agents" => options.setup.agents = Some(value.unwrap()),
                "--project-root" => options.setup.project_root = Some(value.unwrap()),
                "--memory-layout" => options.setup.memory_layout = Some(value.unwrap()),
                "--install-root" => options.setup.install_root = Some(value.unwrap()),
                _ => return Err(CliError::invalid(format!("unknown option: {name}"))),
            }
            index += 1;
        } else if path
            .first()
            .map(String::as_str)
            .is_some_and(|value| matches!(value, "commands" | "help"))
        {
            // Discovery paths are deliberately variadic. This lets the
            // registry answer questions about a concrete route such as
            // `help work create` without teaching the parser every future
            // command namespace.
            path.push(arg.clone());
            index += 1;
        } else if (path.len() < 2
            && !matches!(
                path.first().map(String::as_str),
                Some("init" | "backup" | "restore")
            ))
            || (path.len() == 2
                && ((path.as_slice() == ["work", "hold"]
                    && matches!(arg.as_str(), "add" | "resolve"))
                    || (path.as_slice() == ["work", "dispatch"] && arg == "set")))
        {
            path.push(arg.clone());
            index += 1;
        } else {
            options.positionals.push(arg.clone());
            index += 1;
        }
    }
    if path
        .first()
        .is_some_and(|value| matches!(value.as_str(), "init" | "setup" | "install"))
    {
        options.positionals.extend(path.drain(1..));
    } else if matches!(
        path.first().map(String::as_str),
        Some("status" | "prime" | "dashboard" | "doctor")
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
            Some("create" | "show" | "claim" | "edit")
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
        ["version"] => options.positionals.is_empty(),
        ["workflows", "list"] => options.positionals.is_empty(),
        ["workflows", "show"] => options.positionals.len() == 1,
        ["update"] => options.positionals.is_empty() && !options.machine,
        ["upgrade"] => options.positionals.is_empty() && options.machine,
        ["backup"] | ["restore"] => positionals == 1 && options.socket.is_none(),
        ["init"] | ["setup"] | ["install"] => positionals <= 1,
        _ if matches!(path.first().copied(), Some("commands" | "help")) => {
            options.positionals.is_empty()
        }
        ["agent", "guide"] | ["agent", "resume"] | ["next"] | ["agent", "next"] => positionals == 0,
        ["doctor"] | ["session", "end"] => positionals == 0,
        ["dep", "add"] | ["dep", "remove"] => {
            positionals == 2 + usize::from(options.project.is_none())
        }
        ["work", "edit"] => positionals == 1 + usize::from(options.project.is_none()),
        ["work", "hold", "add"] | ["work", "dispatch", "set"] => {
            positionals == 1 + usize::from(options.project.is_none())
        }
        ["work", "hold", "resolve"] => positionals == 2 + usize::from(options.project.is_none()),
        ["dep", "tree"] | ["dep", "cycles"] => {
            positionals == usize::from(options.project.is_none())
        }
        ["cycle", "board"] | ["cycle", "report"] => {
            positionals == 1 + usize::from(options.project.is_none())
        }
        ["intake", "list"] => positionals == usize::from(options.project.is_none()),
        ["intake", "show"] => positionals == 1 + usize::from(options.project.is_none()),
        ["intake", "bucket"] | ["intake", "capture"] => {
            positionals == 2 + usize::from(options.project.is_none())
        }
        ["source", "add"] => {
            positionals == usize::from(options.project.is_none())
                && options.input.is_some()
                && options.origin.is_some()
        }
        ["source", "list"] => positionals == usize::from(options.project.is_none()),
        ["source", "show"] | ["source", "verify"] => {
            positionals == 1 + usize::from(options.project.is_none())
        }
        ["agent", "start"] => positionals <= 1,
        ["agent", "release"] | ["agent", "finish"] => positionals == 1,
        ["agent", "status"] => positionals == 0,
        ["agent", "heartbeat"] | ["agent", "renew"] => positionals == 0 && options.work.is_some(),
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
    if matches!(
        path.as_slice(),
        ["evidence", "run"]
            | ["evidence", "add"]
            | ["work", "accept"]
            | ["work", "heartbeat"]
            | ["work", "renew"]
            | ["work", "release"]
            | ["work", "finish"]
            | ["agent", "heartbeat"]
            | ["agent", "renew"]
            | ["agent", "release"]
            | ["agent", "finish"]
    ) && options.attempt.is_some() != options.fence.is_some()
    {
        return Err(CliError::invalid(
            "--attempt and --fence must be supplied together",
        ));
    }
    if matches!(
        path.as_slice(),
        ["work", "accept"]
            | ["work", "heartbeat"]
            | ["work", "renew"]
            | ["work", "release"]
            | ["work", "finish"]
    ) && options.positionals.len() < usize::from(options.project.is_none()) + 1
    {
        return Err(CliError::invalid(format!(
            "{} requires a work identifier",
            path.join(" ")
        )));
    }
    Ok(())
}

fn option_value(args: &[String], index: &mut usize, name: &str) -> Result<String, CliError> {
    let current = args.get(*index).map(String::as_str);
    let alias_matches = (name == "--lease-ttl" && current == Some("--ttl"))
        || (name == "--expected-revision" && current == Some("--revision"));
    if current != Some(name) && !alias_matches {
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

fn dependency_add_result(
    parsed: &ParsedCommand,
    app: &WorkApplication<'_>,
    operation: &str,
) -> Result<CliResult, CliError> {
    let project = ProjectId::new(project_argument(parsed, 0)?);
    let offset = usize::from(parsed.options.project.is_none());
    let prerequisite_id = parsed
        .options
        .positionals
        .get(offset)
        .cloned()
        .ok_or_else(|| CliError::invalid("dep add requires a prerequisite work identifier"))?;
    let dependent_id = parsed
        .options
        .positionals
        .get(offset + 1)
        .cloned()
        .ok_or_else(|| CliError::invalid("dep add requires a dependent work identifier"))?;
    let result = app
        .add_dependency_as_checked(
            &project,
            &prerequisite_id,
            &dependent_id,
            &parsed.options.actor,
            parsed.options.expected_revision,
            &now(),
            operation.to_owned(),
        )
        .map_err(map_dependency_error)?;
    bounded_result(
        Some(json!({
            "project_id": project.as_str(),
            "prerequisite_id": prerequisite_id,
            "dependent_id": dependent_id,
            "satisfaction_policy": "closed_only",
            "replayed": !result.changed,
        })),
        Some(result.snapshot_revision),
    )
    .map(|mut result_view| {
        result_view.outcome = if result.changed {
            ApplicationOutcome::Changed
        } else {
            ApplicationOutcome::Unchanged
        };
        result_view
    })
}

fn work_edit_result(
    parsed: &ParsedCommand,
    app: &WorkApplication<'_>,
    operation: &str,
) -> Result<CliResult, CliError> {
    let project = ProjectId::new(project_argument(parsed, 0)?);
    let offset = usize::from(parsed.options.project.is_none());
    let work_id = parsed
        .options
        .positionals
        .get(offset)
        .cloned()
        .ok_or_else(|| CliError::invalid("work edit requires a work identifier"))?;
    let result = app
        .edit_work_as(
            &project,
            &work_id,
            &parsed.options.actor,
            parsed.options.parent.clone().map(Some),
            parsed.options.title.clone(),
            parsed.options.description.clone(),
            parsed.options.priority,
            parsed.options.dispatch.clone(),
            parsed.options.expected_revision,
            &now(),
            operation.to_owned(),
        )
        .map_err(map_application_error)?;
    bounded_result(
        Some(json!({
            "project_id": result.value.project_id,
            "work_id": result.value.work_id,
            "title": result.value.title,
            "description": result.value.description,
            "priority": result.value.priority,
            "dispatch_policy": result.value.dispatch_policy,
            "hard_holds": result.value.hard_holds.iter().map(ReasonCode::stable_code).collect::<Vec<_>>(),
            "replayed": !result.changed,
        })),
        Some(result.snapshot_revision),
    )
    .map(|mut view| {
        view.outcome = if result.changed { ApplicationOutcome::Changed } else { ApplicationOutcome::Unchanged };
        view
    })
}

fn dependency_remove_result(
    parsed: &ParsedCommand,
    app: &WorkApplication<'_>,
    operation: &str,
) -> Result<CliResult, CliError> {
    let project = ProjectId::new(project_argument(parsed, 0)?);
    let offset = usize::from(parsed.options.project.is_none());
    let prerequisite_id = parsed
        .options
        .positionals
        .get(offset)
        .cloned()
        .ok_or_else(|| CliError::invalid("dep remove requires a prerequisite work identifier"))?;
    let dependent_id = parsed
        .options
        .positionals
        .get(offset + 1)
        .cloned()
        .ok_or_else(|| CliError::invalid("dep remove requires a dependent work identifier"))?;
    let result = app
        .remove_dependency_as(
            &project,
            &prerequisite_id,
            &dependent_id,
            &parsed.options.actor,
            parsed.options.expected_revision,
            &now(),
            operation.to_owned(),
        )
        .map_err(map_dependency_error)?;
    bounded_result(
        Some(json!({
            "project_id": project.as_str(),
            "prerequisite_id": prerequisite_id,
            "dependent_id": dependent_id,
            "replayed": !result.changed,
        })),
        Some(result.snapshot_revision),
    )
    .map(|mut view| {
        view.outcome = if result.changed {
            ApplicationOutcome::Changed
        } else {
            ApplicationOutcome::Unchanged
        };
        view
    })
}

fn work_hold_add_result(
    parsed: &ParsedCommand,
    app: &WorkApplication<'_>,
    operation: &str,
) -> Result<CliResult, CliError> {
    let project = ProjectId::new(project_argument(parsed, 0)?);
    let offset = usize::from(parsed.options.project.is_none());
    let work_id = parsed
        .options
        .positionals
        .get(offset)
        .cloned()
        .ok_or_else(|| CliError::invalid("work hold add requires a work identifier"))?;
    let reason = parsed
        .options
        .reason
        .clone()
        .ok_or_else(|| CliError::invalid("work hold add requires --reason"))?;
    let result = app
        .add_work_hold_as(
            &project,
            &work_id,
            &reason,
            &parsed.options.actor,
            parsed.options.expected_revision,
            &now(),
            operation.to_owned(),
        )
        .map_err(map_application_error)?;
    bounded_result(Some(json!({
        "project_id": result.value.project_id,
        "work_id": result.value.work_id,
        "hard_holds": result.value.hard_holds.iter().map(ReasonCode::stable_code).collect::<Vec<_>>(),
        "replayed": !result.changed,
    })), Some(result.snapshot_revision)).map(|mut view| {
        view.outcome = if result.changed { ApplicationOutcome::Changed } else { ApplicationOutcome::Unchanged };
        view
    })
}

fn work_hold_resolve_result(
    parsed: &ParsedCommand,
    app: &WorkApplication<'_>,
    operation: &str,
) -> Result<CliResult, CliError> {
    let project = ProjectId::new(project_argument(parsed, 0)?);
    let offset = usize::from(parsed.options.project.is_none());
    let work_id = parsed
        .options
        .positionals
        .get(offset)
        .cloned()
        .ok_or_else(|| CliError::invalid("work hold resolve requires a work identifier"))?;
    let hold_id = parsed
        .options
        .positionals
        .get(offset + 1)
        .cloned()
        .ok_or_else(|| CliError::invalid("work hold resolve requires a hold identifier"))?;
    let reason = parsed
        .options
        .reason
        .clone()
        .ok_or_else(|| CliError::invalid("work hold resolve requires --reason"))?;
    let result = app
        .resolve_work_hold_as(
            &project,
            &work_id,
            &hold_id,
            &reason,
            &parsed.options.actor,
            parsed.options.expected_revision,
            &now(),
            operation.to_owned(),
        )
        .map_err(map_application_error)?;
    bounded_result(Some(json!({
        "project_id": result.value.project_id,
        "work_id": result.value.work_id,
        "hard_holds": result.value.hard_holds.iter().map(ReasonCode::stable_code).collect::<Vec<_>>(),
        "replayed": !result.changed,
    })), Some(result.snapshot_revision)).map(|mut view| {
        view.outcome = if result.changed { ApplicationOutcome::Changed } else { ApplicationOutcome::Unchanged };
        view
    })
}

fn work_dispatch_set_result(
    parsed: &ParsedCommand,
    app: &WorkApplication<'_>,
    operation: &str,
) -> Result<CliResult, CliError> {
    let project = ProjectId::new(project_argument(parsed, 0)?);
    let offset = usize::from(parsed.options.project.is_none());
    let work_id = parsed
        .options
        .positionals
        .get(offset)
        .cloned()
        .ok_or_else(|| CliError::invalid("work dispatch set requires a work identifier"))?;
    let dispatch = parsed
        .options
        .dispatch
        .clone()
        .ok_or_else(|| CliError::invalid("work dispatch set requires --dispatch"))?;
    let result = app
        .edit_work_as(
            &project,
            &work_id,
            &parsed.options.actor,
            None,
            None,
            None,
            None,
            Some(dispatch),
            parsed.options.expected_revision,
            &now(),
            operation.to_owned(),
        )
        .map_err(map_application_error)?;
    bounded_result(
        Some(json!({
            "project_id": result.value.project_id,
            "work_id": result.value.work_id,
            "dispatch_policy": result.value.dispatch_policy,
            "replayed": !result.changed,
        })),
        Some(result.snapshot_revision),
    )
    .map(|mut view| {
        view.outcome = if result.changed {
            ApplicationOutcome::Changed
        } else {
            ApplicationOutcome::Unchanged
        };
        view
    })
}

fn dependency_graph_result(
    parsed: &ParsedCommand,
    app: &WorkApplication<'_>,
) -> Result<CliResult, CliError> {
    let project = ProjectId::new(project_argument(parsed, 0)?);
    let graph = app
        .dependency_graph(&project)
        .map_err(map_application_error)?;
    let edges = graph
        .edges
        .iter()
        .map(|edge| {
            json!({
                "prerequisite_id": edge.prerequisite_id,
                "dependent_id": edge.dependent_id,
            })
        })
        .collect::<Vec<_>>();
    let cycles = graph
        .cycles
        .iter()
        .map(|cycle| json!(cycle))
        .collect::<Vec<_>>();
    bounded_result(
        Some(json!({
            "project_id": graph.project_id.as_str(),
            "revision": graph.revision,
            "edges": edges,
            "cycles": cycles,
            "cycle_count": graph.cycles.len(),
        })),
        Some(graph.revision),
    )
    .map(|mut result| {
        result.outcome = ApplicationOutcome::Unchanged;
        result
    })
}

fn cycle_board_result(
    parsed: &ParsedCommand,
    app: &WorkApplication<'_>,
) -> Result<CliResult, CliError> {
    let project = ProjectId::new(project_argument(parsed, 0)?);
    let cycle_index = usize::from(parsed.options.project.is_none());
    let cycle_id = parsed
        .options
        .positionals
        .get(cycle_index)
        .cloned()
        .ok_or_else(|| CliError::invalid("cycle board/report requires a cycle identifier"))?;
    let board = app
        .cycle_board_v3(&project, &cycle_id)
        .map_err(map_application_error)?;
    let assignments = board
        .assignments
        .iter()
        .map(|item| {
            json!({
                "assignment_id": item.assignment.assignment_id,
                "work_id": item.assignment.work_id,
                "state": item.assignment.state,
                "activation_policy": item.assignment.activation_policy,
                "activation_at_utc_ms": item.assignment.activation_at_utc_ms,
                "work_title": item.work_title,
                "work_kind": item.work_kind,
                "work_lifecycle": item.work_lifecycle,
            })
        })
        .collect::<Vec<_>>();
    let mut state_counts = std::collections::BTreeMap::<String, usize>::new();
    for assignment in &board.assignments {
        *state_counts
            .entry(assignment.assignment.state.clone())
            .or_default() += 1;
    }
    bounded_result(
        Some(json!({
            "project_id": board.project_id.as_str(),
            "revision": board.revision,
            "cycle": {
                "cycle_id": board.cycle.cycle_id,
                "series_id": board.cycle.series_id,
                "template_version_id": board.cycle.template_version_id,
                "slot_ordinal": board.cycle.slot_ordinal,
                "name": board.cycle.name,
                "goal": board.cycle.goal,
                "lifecycle": board.cycle.lifecycle,
                "scheduled_start_utc_ms": board.cycle.scheduled_start_utc_ms,
                "scheduled_end_utc_ms": board.cycle.scheduled_end_utc_ms,
                "scheduled_start_local": board.cycle.scheduled_start_local,
                "timezone": board.cycle.timezone,
                "tzdb_identity": board.cycle.tzdb_identity,
            },
            "assignments": assignments,
            "counts": state_counts,
        })),
        Some(board.revision),
    )
    .map(|mut result| {
        result.outcome = ApplicationOutcome::Unchanged;
        result
    })
}

fn intake_list_result(
    parsed: &ParsedCommand,
    app: &WorkApplication<'_>,
) -> Result<CliResult, CliError> {
    let project = ProjectId::new(project_argument(parsed, 0)?);
    let view = app
        .intake_items_v3(&project)
        .map_err(map_application_error)?;
    let items = view.items.iter().map(intake_item_json).collect::<Vec<_>>();
    bounded_result(
        Some(json!({
            "command": "intake_list",
            "project_id": view.project_id.as_str(),
            "revision": view.revision,
            "items": items,
            "total": view.items.len(),
        })),
        Some(view.revision),
    )
    .map(|mut result| {
        result.outcome = ApplicationOutcome::Unchanged;
        result
    })
}

fn intake_show_result(
    parsed: &ParsedCommand,
    app: &WorkApplication<'_>,
) -> Result<CliResult, CliError> {
    let project = ProjectId::new(project_argument(parsed, 0)?);
    let intake_index = usize::from(parsed.options.project.is_none());
    let intake_id = parsed
        .options
        .positionals
        .get(intake_index)
        .cloned()
        .ok_or_else(|| CliError::invalid("intake show requires an intake identifier"))?;
    let view = app
        .intake_items_v3(&project)
        .map_err(map_application_error)?;
    let item = view
        .items
        .iter()
        .find(|item| item.intake_id == intake_id)
        .ok_or_else(|| {
            CliError::with(
                ErrorCode::NotFound,
                ApplicationOutcome::Rejected,
                format!("intake item not found: {intake_id}"),
            )
        })?;
    bounded_result(
        Some(json!({
            "command": "intake_show",
            "project_id": view.project_id.as_str(),
            "revision": view.revision,
            "item": intake_item_json(item),
        })),
        Some(view.revision),
    )
    .map(|mut result| {
        result.outcome = ApplicationOutcome::Unchanged;
        result
    })
}

fn intake_item_json(item: &boreal_store::IntakeItemV3Record) -> Value {
    json!({
        "project_id": item.project_id,
        "intake_id": item.intake_id,
        "bucket_id": item.bucket_id,
        "kind": item.kind,
        "lifecycle": item.lifecycle,
        "content": item.content,
        "content_revision": item.content_revision,
        "content_digest": item.content_digest,
        "captured_at": item.captured_at,
        "updated_at": item.updated_at,
        "revisit_at_utc_ms": item.revisit_at_utc_ms,
    })
}

fn intake_bucket_result(
    parsed: &ParsedCommand,
    app: &WorkApplication<'_>,
    operation: &str,
) -> Result<CliResult, CliError> {
    // The v3 application/store path owns the optimistic-concurrency check;
    // preserve the caller's revision instead of replacing it with a fresh
    // read taken by this adapter.
    let project = ProjectId::new(project_argument(parsed, 0)?);
    let offset = usize::from(parsed.options.project.is_none());
    let bucket_id = parsed
        .options
        .positionals
        .get(offset)
        .cloned()
        .ok_or_else(|| CliError::invalid("intake bucket requires a bucket identifier"))?;
    let name = parsed
        .options
        .positionals
        .get(offset + 1)
        .cloned()
        .ok_or_else(|| CliError::invalid("intake bucket requires a bucket name"))?;
    app.ensure_work_model_v3().map_err(map_application_error)?;
    let bucket = IntakeBucket {
        id: IntakeBucketId::new(bucket_id.clone()),
        project_id: project.clone(),
        name: name.clone(),
        archived: false,
    };
    let revision = app
        .intake_items_v3(&project)
        .map_err(map_application_error)?
        .revision;
    let scope =
        boreal_application::PlanningScope::new(project.clone(), parsed.options.actor.clone())
            .with_session(parsed.options.session.clone())
            .at_revision(parsed.options.expected_revision.unwrap_or(revision));
    let result = app
        .create_intake_bucket_v3(&scope, operation.to_owned(), &bucket, &now())
        .map_err(map_application_error)?;
    Ok(CliResult {
        outcome: if result.changed {
            ApplicationOutcome::Changed
        } else {
            ApplicationOutcome::Unchanged
        },
        revision: Some(result.snapshot_revision),
        data: Some(json!({
            "project_id": project.as_str(),
            "bucket_id": bucket_id,
            "name": name,
            "archived": false,
            "replayed": !result.changed,
        })),
        ..CliResult::default()
    })
}

fn intake_capture_result(
    parsed: &ParsedCommand,
    app: &WorkApplication<'_>,
    operation: &str,
) -> Result<CliResult, CliError> {
    let project = ProjectId::new(project_argument(parsed, 0)?);
    let offset = usize::from(parsed.options.project.is_none());
    let intake_id = parsed
        .options
        .positionals
        .get(offset)
        .cloned()
        .ok_or_else(|| CliError::invalid("intake capture requires an intake identifier"))?;
    let content = parsed
        .options
        .positionals
        .get(offset + 1)
        .cloned()
        .ok_or_else(|| CliError::invalid("intake capture requires content"))?;
    let bucket_id = parsed
        .options
        .bucket
        .clone()
        .ok_or_else(|| CliError::invalid("intake capture requires --bucket"))?;
    let kind = match parsed.options.kind.as_deref().unwrap_or("note") {
        "note" => IntakeKind::Note,
        "discovery" => IntakeKind::Discovery,
        "question" => IntakeKind::Question,
        "revisit" => IntakeKind::Revisit,
        _ => unreachable!("parser validates intake kind"),
    };
    app.ensure_work_model_v3().map_err(map_application_error)?;
    let captured_at = TimestampMs::from_millis(now_ms_u64());
    let item = IntakeItem {
        id: IntakeItemId::new(intake_id.clone()),
        bucket_id: IntakeBucketId::new(bucket_id.clone()),
        project_id: project.clone(),
        kind,
        lifecycle: IntakeLifecycle::Captured,
        content: content.clone(),
        content_revision: 1,
        content_digest: sha256_content_digest(content.as_bytes()),
        revisit_at: None,
    };
    let revision = app
        .intake_items_v3(&project)
        .map_err(map_application_error)?
        .revision;
    let scope =
        boreal_application::PlanningScope::new(project.clone(), parsed.options.actor.clone())
            .with_session(parsed.options.session.clone())
            .at_revision(parsed.options.expected_revision.unwrap_or(revision));
    let result = app
        .create_intake_item_v3(
            &scope,
            operation.to_owned(),
            &item,
            &stamp(captured_at.as_millis()),
            &stamp(captured_at.as_millis()),
        )
        .map_err(map_application_error)?;
    Ok(CliResult {
        outcome: if result.changed {
            ApplicationOutcome::Changed
        } else {
            ApplicationOutcome::Unchanged
        },
        revision: Some(result.snapshot_revision),
        data: Some(json!({
            "project_id": project.as_str(),
            "intake_id": intake_id,
            "bucket_id": bucket_id,
            "kind": parsed.options.kind.as_deref().unwrap_or("note"),
            "lifecycle": "captured",
            "content_revision": 1,
            "content_digest": item.content_digest,
            "replayed": !result.changed,
        })),
        ..CliResult::default()
    })
}

fn source_catalog_root(db_path: &str) -> PathBuf {
    let db_path = Path::new(db_path);
    db_path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .map_or_else(
            || PathBuf::from(".boreal/source"),
            |parent| parent.join("source"),
        )
}

fn source_catalog(root: &Path) -> Result<SourceCatalog, CliError> {
    fs::create_dir_all(root).map_err(|error| {
        CliError::with(
            ErrorCode::ServiceUnavailable,
            ApplicationOutcome::Failed,
            format!("unable to initialize source catalog: {error}"),
        )
    })?;
    SourceCatalog::with_persistent_filesystem(root).map_err(map_source_error)
}

fn source_add_result(
    parsed: &ParsedCommand,
    operation: &str,
    store: &SqliteStore,
) -> Result<CliResult, CliError> {
    let project = project_argument(parsed, 0)?;
    // Validate the relational project before writing catalog state. If this
    // fails, the command cannot leave an orphan source capture behind.
    let revision = store_revision(store, &ProjectId::new(project.clone()))?;
    let input_path = parsed
        .options
        .input
        .as_deref()
        .ok_or_else(|| CliError::invalid("source add requires --input"))?;
    let origin = parsed
        .options
        .origin
        .as_deref()
        .ok_or_else(|| CliError::invalid("source add requires --origin"))?;
    let metadata = fs::metadata(input_path).map_err(|error| {
        CliError::with(
            ErrorCode::NotFound,
            ApplicationOutcome::Rejected,
            format!("source input is not readable: {error}"),
        )
    })?;
    if !metadata.is_file() {
        return Err(CliError::invalid("source --input must name a regular file"));
    }
    if metadata.len() > MAX_SOURCE_INPUT_BYTES {
        return Err(CliError::invalid(format!(
            "source input exceeds the {} byte bound",
            MAX_SOURCE_INPUT_BYTES
        )));
    }
    let file = fs::File::open(input_path).map_err(|error| {
        CliError::with(
            ErrorCode::NotFound,
            ApplicationOutcome::Rejected,
            format!("source input is not readable: {error}"),
        )
    })?;
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(MAX_SOURCE_INPUT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| {
            CliError::with(
                ErrorCode::ServiceUnavailable,
                ApplicationOutcome::Failed,
                format!("unable to read source input: {error}"),
            )
        })?;
    if bytes.len() as u64 > MAX_SOURCE_INPUT_BYTES {
        return Err(CliError::invalid(format!(
            "source input exceeds the {} byte bound",
            MAX_SOURCE_INPUT_BYTES
        )));
    }
    let catalog_root = source_catalog_root(&parsed.options.db);
    let catalog = source_catalog(&catalog_root)?;
    let app = KnowledgeApplication::new(&catalog);
    let mut result = app
        .capture_source(SourceCaptureInput {
            operation_id: operation.to_owned(),
            project_id: project.clone(),
            origin: origin.to_owned(),
            media_type: parsed
                .options
                .media_type
                .clone()
                .unwrap_or_else(|| "application/octet-stream".to_owned()),
            bytes,
        })
        .map_err(map_knowledge_error)?;
    // Preserve the original registration timestamp when a catalog capture is
    // retried after SQLite committed. It is part of the canonical registration
    // digest, so using a fresh wall clock here would turn a safe retry into a
    // false operation conflict.
    let captured_at = store
        .source_version(&project, &result.source.source_version_id)
        .map_err(map_store_error)?
        .map_or_else(now, |record| record.captured_at);
    let registration = app
        .register_captured_source(
            store,
            &result.source,
            &result.operation,
            &parsed.options.actor,
            &captured_at,
        )
        .map_err(map_knowledge_error)?;
    result.registration = boreal_application::SourceRegistrationState::StoreCommitted {
        revision: registration.revision,
        replayed: registration.replayed,
    };
    let registration_revision = registration.revision;
    let registration_replayed = registration.replayed;
    bounded_result(
        Some(json!({
            "project_id": project,
            "source": source_json(&result.source),
            "input": input_path,
            "catalog_root": catalog_root,
            "registration": {
                "state": "store_committed",
                "revision": registration_revision,
                "replayed": registration_replayed,
            },
            "project_revision_before": revision,
            "duplicate": result.duplicate,
            "reused_existing_version": result.reused_existing_version,
        })),
        Some(registration_revision),
    )
    .map(|mut result| {
        if registration_replayed {
            result.outcome = ApplicationOutcome::Unchanged;
        }
        result
    })
}

fn source_show_result(parsed: &ParsedCommand, store: &SqliteStore) -> Result<CliResult, CliError> {
    let project = project_argument(parsed, 0)?;
    let index = usize::from(parsed.options.project.is_none());
    let source_id = parsed
        .options
        .positionals
        .get(index)
        .ok_or_else(|| CliError::invalid("source show requires a source version identifier"))?;
    let project_id = ProjectId::new(project.clone());
    let revision = store_revision(store, &project_id)?;
    let catalog_root = source_catalog_root(&parsed.options.db);
    let catalog = source_catalog(&catalog_root)?;
    let app = KnowledgeApplication::new(&catalog);
    let source = app
        .show_source(&project, source_id)
        .map_err(map_knowledge_error)?;
    let registration = store
        .source_version(&project, source_id)
        .map_err(map_store_error)?;
    bounded_result(
        Some(json!({
            "project_id": project,
            "source": source_json(&source),
            "sqlite_registration": registration.as_ref().map(source_record_json),
            "catalog_root": catalog_root,
        })),
        Some(revision),
    )
}

fn source_list_result(parsed: &ParsedCommand, store: &SqliteStore) -> Result<CliResult, CliError> {
    let project = project_argument(parsed, 0)?;
    let project_id = ProjectId::new(project.clone());
    let revision = store_revision(store, &project_id)?;
    let catalog_root = source_catalog_root(&parsed.options.db);
    let catalog = source_catalog(&catalog_root)?;
    let app = KnowledgeApplication::new(&catalog);
    let all = app
        .list_sources(Some(&project))
        .map_err(map_knowledge_error)?;
    let total = all.len();
    let offset = parsed.options.offset.unwrap_or(0) as usize;
    let limit = parsed.options.limit.unwrap_or(50) as usize;
    let items = all
        .into_iter()
        .skip(offset)
        .take(limit)
        .map(|source| source_json(&source))
        .collect::<Vec<_>>();
    bounded_result(
        Some(json!({
            "project_id": project,
            "items": items,
            "total": total,
            "offset": offset,
            "limit": limit,
            "has_more": offset.saturating_add(limit) < total,
            "catalog_root": catalog_root,
        })),
        Some(revision),
    )
}

fn source_verify_result(
    parsed: &ParsedCommand,
    store: &SqliteStore,
) -> Result<CliResult, CliError> {
    let project = project_argument(parsed, 0)?;
    let index = usize::from(parsed.options.project.is_none());
    let source_id =
        parsed.options.positionals.get(index).ok_or_else(|| {
            CliError::invalid("source verify requires a source version identifier")
        })?;
    let revision = store_revision(store, &ProjectId::new(project.clone()))?;
    let catalog_root = source_catalog_root(&parsed.options.db);
    let catalog = source_catalog(&catalog_root)?;
    let app = KnowledgeApplication::new(&catalog);
    let result = app
        .verify_source(&project, source_id)
        .map_err(map_knowledge_error)?;
    let verified_digest = result.verified_digest;
    let verified = verified_digest.is_some();
    bounded_result(
        Some(json!({
            "project_id": project,
            "source_version_id": source_id,
            "availability": format!("{:?}", result.availability).to_ascii_lowercase(),
            "verified_digest": verified_digest,
            "byte_count": result.byte_count,
            "verified": verified,
        })),
        Some(revision),
    )
}

fn source_json(source: &boreal_source::SourceVersion) -> Value {
    json!({
        "project_id": source.project_id.as_str(),
        "source_version_id": source.source_version_id.as_str(),
        "origin": source.origin.as_str(),
        "media_type": source.media_type.as_str(),
        "byte_count": source.byte_count,
        "content_digest": source.content_digest.as_str(),
        "availability": format!("{:?}", source.availability).to_ascii_lowercase(),
        "parser_identity": source.parser_identity.as_deref(),
    })
}

fn source_record_json(record: &boreal_store::SourceVersionRecord) -> Value {
    json!({
        "source_version_id": record.source_version_id.as_str(),
        "project_id": record.project_id.as_str(),
        "origin": record.origin.as_str(),
        "access_scope": record.access_scope.as_str(),
        "content_digest": record.content_digest.as_str(),
        "media_type": record.media_type.as_str(),
        "byte_count": record.byte_count,
        "captured_at": record.captured_at.as_str(),
        "parser_identity": record.parser_identity.as_str(),
        "availability": record.availability.as_str(),
    })
}

fn map_source_error(error: boreal_source::SourceError) -> CliError {
    let code = match error {
        boreal_source::SourceError::ScopeViolation | boreal_source::SourceError::MissingBlob => {
            ErrorCode::NotFound
        }
        boreal_source::SourceError::Storage(_) => ErrorCode::ServiceUnavailable,
        boreal_source::SourceError::OperationConflict
        | boreal_source::SourceError::SourceMetadataConflict => ErrorCode::OperationConflict,
        _ => ErrorCode::InvalidArgument,
    };
    CliError::with(code, ApplicationOutcome::Rejected, error.to_string())
}

fn map_knowledge_error(error: boreal_application::KnowledgeError) -> CliError {
    match error {
        boreal_application::KnowledgeError::Store(error) => map_store_error(error),
        boreal_application::KnowledgeError::Source(error) => map_source_error(error),
        boreal_application::KnowledgeError::Invalid(message) => CliError::invalid(message),
        other => CliError::with(
            ErrorCode::ServiceUnavailable,
            ApplicationOutcome::Failed,
            other.to_string(),
        ),
    }
}

/// Read-only operator diagnostics. This deliberately reports the checks that
/// this adapter can prove; it does not claim to repair application state or
/// replace the store-owned doctor/recovery implementation.
fn doctor_result(parsed: &ParsedCommand, store: &SqliteStore) -> Result<CliResult, CliError> {
    let project = parsed.options.project.clone();
    let schema_version = store.schema_version().map_err(map_store_error)?;
    let v3_enabled = store.work_model_v3_enabled().map_err(map_store_error)?;
    let revision = project
        .as_deref()
        .map(|project| store.project_revision(project).map(|revision| revision.0))
        .transpose()
        .map_err(map_store_error)?;
    bounded_result(
        Some(json!({
            "project_id": project,
            "checks": {
                "database_open": "pass",
                "schema_version": schema_version,
                "work_model_v3": if v3_enabled { "enabled" } else { "not_enabled" },
                "sqlite_runtime": store.sqlite_runtime_identity().as_json(),
            },
            "repair": {
                "available": false,
                "reason": "doctor is read-only in the CLI adapter; use the application/store recovery route when available"
            }
        })),
        revision,
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
    bounded_result(
        Some(status_snapshot_json(&snapshot, None)),
        Some(snapshot.project_revision.0),
    )
    .map(|mut result| {
        result.outcome = ApplicationOutcome::Unchanged;
        result
    })
}

fn status_snapshot_json(
    snapshot: &boreal_application::StatusSnapshot,
    recovery: Option<Value>,
) -> Value {
    let counts = &snapshot.counts;
    json!({
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
        "diagnostics": snapshot.diagnostics.iter().map(|diagnostic| json!({
            "work_id": diagnostic.work_id,
            "title": diagnostic.title,
            "code": diagnostic.code,
            "detail": diagnostic.detail,
            "display_status": "corrupt",
        })).collect::<Vec<_>>(),
        "counts": {
            "matched": snapshot.total,
            "total": snapshot.total,
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
            "degraded": snapshot.diagnostics.len(),
        },
        "items": snapshot.items.iter().map(status_item_json).collect::<Vec<_>>(),
        "timing": {
            "as_of": stamp(snapshot.as_of.as_millis()),
            "next_status_change_at": snapshot.next_status_change_at.map(|value| stamp(value.as_millis())),
        },
        "recovery": recovery.unwrap_or_else(|| json!({
            "readback_required": false,
            "service_state": "ready",
        })),
    })
}

fn status_item_json(item: &boreal_application::StatusWork) -> Value {
    let gates = item
        .gates
        .gates
        .iter()
        .map(|gate| {
            json!({
                "gate_id": gate.gate_id.as_str(),
                "kind": gate_kind_name(gate.kind),
                "required": gate.required,
                "state": gate_state_name(gate.state),
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
            "phase": attempt_phase_name(attempt.phase),
            "actor_id": attempt.actor_id.as_str(),
            "harness_id": attempt.harness_id.as_ref().map(|value| value.as_str()),
            "session_id": attempt.session_id.as_ref().map(|value| value.as_str()),
            "lease_deadline": stamp(attempt.lease_deadline.as_millis()),
            "hard_deadline": stamp(attempt.max_attempt_deadline.as_millis()),
        })
    });
    // A compatibility status row does not yet carry the v3 identity/proof
    // facts required to make action descriptors authoritative.  Do not send
    // synthetic denied descriptors here: they would override the legacy
    // discovery hint in clients while still claiming that the row is
    // selectable.  Once the store supplies a complete action context, the
    // same response includes the canonical descriptor set.
    let actions = item
        .actions
        .as_ref()
        .map(|actions| action_decision_json(actions, true));
    json!({
        "work_id": item.work.id.as_str(),
        "project_id": item.work.project_id.as_str(),
        "kind": work_kind_name(item.work.kind),
        "parent_id": item.work.parent_id.as_ref().map(|value| value.as_str()),
        "title": item.work.title,
        "description": item.work.description,
        "lifecycle": lifecycle_name(item.work.lifecycle),
        "priority": item.work.priority,
        "dispatch_policy": dispatch_policy_name(item.work.dispatch_policy),
        // `status` is the status/2 compatibility field. Keep the richer
        // status/3 value in `display_status` so newer clients can render
        // expiry as its own recovery state without breaking older clients.
        "status": status2_name(item.display_status()),
        "display_status": status_name(item.display_status()),
        // Compatibility status rows predate the v3 identity/proof read model.
        // Keep their legacy readiness hint for discovery, but keep the
        // server-derived action set alongside it; mutating commands still
        // authorize through their own canonical transaction.
        "claimable": item.claimable_for_actor(),
        "claimable_for_actor": item.claimable_for_actor(),
        "primary_reason": item.decision.primary_reason.stable_code(),
        "reason_codes": item.decision.reason_codes.iter().map(|reason| reason.stable_code()).collect::<Vec<_>>(),
        "next_action": item.decision.next_action.map(domain_action_name),
        "next_status_change_at": item.decision.next_status_change_at.map(|value| stamp(value.as_millis())),
        "attempt": attempt,
        "actions": actions,
        "action_context": {
            "state": item.action_context.state(),
            "missing_facts": item.action_context.missing_facts(),
        },
        "gates": { "open": open, "satisfied": satisfied },
        "dependencies": item.dependency_blockers.iter().map(|blocker| json!({
                "work_id": blocker.work_id.as_str(),
                "display_status": status_name(blocker.display_status),
                "status": status2_name(blocker.display_status),
                "satisfies_default": blocker.satisfies_default,
                "satisfied": blocker.satisfies_default,
            })).collect::<Vec<_>>(),
        "dependency": {
            "prerequisites": item.dependency_blockers.iter().map(|blocker| json!({
                "work_id": blocker.work_id.as_str(),
                "display_status": status_name(blocker.display_status),
                "status": status_name(blocker.display_status),
                "satisfies_default": blocker.satisfies_default,
                "satisfied": blocker.satisfies_default,
            })).collect::<Vec<_>>(),
        },
    })
}

fn action_decision_json(
    decision: &boreal_domain::actions::ActionDecision,
    context_available: bool,
) -> Value {
    json!({
        "allowed": decision
            .allowed
            .iter()
            .filter(|descriptor| inline_status_action(descriptor.action))
            .map(|descriptor| action_descriptor_json(descriptor, context_available))
            .collect::<Vec<_>>(),
        "denied": decision
            .denied
            .iter()
            .filter(|denied| inline_status_action(denied.descriptor.action))
            .map(|denied| {
                json!({
                    "descriptor": action_descriptor_json(&denied.descriptor, context_available),
                    "reason": {
                        "code": action_denial_code(&denied.reason),
                        "detail": format!("{:?}", denied.reason),
                    },
                    "reason_code": action_denial_code(&denied.reason),
                    "recovery": denied
                        .recovery
                        .iter()
                        .map(|action| action_kind_name(*action))
                        .collect::<Vec<_>>(),
                })
            })
            .collect::<Vec<_>>(),
    })
}

/// The status envelope carries the action vocabulary consumed by the current
/// terminal client. The domain still evaluates the complete action set; the
/// remaining descriptors are available through the dedicated action/readback
/// routes rather than making a normal paginated status page exceed its inline
/// protocol bound.
fn inline_status_action(action: boreal_domain::actions::ActionKind) -> bool {
    use boreal_domain::actions::ActionKind;
    matches!(
        action,
        ActionKind::Inspect
            | ActionKind::Claim
            | ActionKind::AcceptAttempt
            | ActionKind::StartAttempt
            | ActionKind::AttachEvidence
            | ActionKind::FinishClose
            | ActionKind::Release
            | ActionKind::Recover
    )
}

/// Select a candidate for discovery without turning a compatibility status
/// hint into authorization. Once the store supplies v3 identity/proof facts,
/// this is exactly the server-derived Claim decision. Until then, the real
/// claim/start mutation remains the authority and can reject the candidate.
fn status_item_selection_eligible(item: &boreal_application::StatusWork) -> bool {
    item.claimable_for_actor()
}

fn action_descriptor_json(
    descriptor: &boreal_domain::actions::ActionDescriptor,
    context_available: bool,
) -> Value {
    json!({
        "action": action_kind_name(descriptor.action),
        "target": {
            "project_id": descriptor.target.project_id.as_str(),
            "work_id": descriptor.target.work_id.as_str(),
            "entity_revision": context_available.then_some(descriptor.target.revision.get()),
        },
        "expected_project_revision": descriptor.expected_project_revision.0,
        "expected_entity_revision": context_available.then_some(descriptor.expected_entity_revision.get()),
        "expected_proof_revision": context_available.then(|| descriptor.expected_proof_revision.map(|revision| revision.get())).flatten(),
        "attempt": context_available.then(|| descriptor.attempt.as_ref().map(|attempt| json!({
            "attempt_id": attempt.attempt_id.as_str(),
            "fence": attempt.fence.get(),
        }))).flatten(),
        "required_roles": descriptor
            .required_roles
            .iter()
            .map(|role| actor_role_name(*role))
            .collect::<Vec<_>>(),
        "required_inputs": descriptor
            .required_inputs
            .iter()
            .map(|input| action_input_name(*input))
            .collect::<Vec<_>>(),
        "confirmation": descriptor.confirmation,
        "read_only": descriptor.read_only,
        "recovery": descriptor.recovery,
    })
}

fn action_kind_name(value: boreal_domain::actions::ActionKind) -> &'static str {
    use boreal_domain::actions::ActionKind::*;
    match value {
        Inspect => "inspect",
        ReadHistory => "read_history",
        ReadOperation => "read_operation",
        Export => "export",
        Publish => "publish",
        Claim => "claim",
        AcceptAttempt => "accept_attempt",
        StartAttempt => "start_attempt",
        Checkpoint => "checkpoint",
        AttachEvidence => "attach_evidence",
        Submit => "submit",
        RequestReview => "request_review",
        Review => "review",
        FinishClose => "finish_close",
        Close => "close",
        Stop => "stop",
        Release => "release",
        PausePolicy => "pause_policy",
        ResumePolicy => "resume_policy",
        Cancel => "cancel",
        Reopen => "reopen",
        ResolveHold => "resolve_hold",
        WaiveDependency => "waive_dependency",
        ForceGate => "force_gate",
        Recover => "recover",
        ReconcileResource => "reconcile_resource",
        Repair => "repair",
    }
}

fn action_input_name(value: boreal_domain::actions::ActionInputKind) -> &'static str {
    use boreal_domain::actions::ActionInputKind::*;
    match value {
        ExpectedProjectRevision => "expected_project_revision",
        ExpectedEntityRevision => "expected_entity_revision",
        ExpectedProofRevision => "expected_proof_revision",
        AttemptId => "attempt_id",
        Fence => "fence",
        SessionId => "session_id",
        OperationId => "operation_id",
        Confirmation => "confirmation",
        Reason => "reason",
        Comment => "comment",
        Evidence => "evidence",
        Summary => "summary",
        ReviewDecision => "review_decision",
        RecoveryDisposition => "recovery_disposition",
    }
}

fn actor_role_name(value: boreal_domain::ActorRole) -> &'static str {
    match value {
        boreal_domain::ActorRole::Agent => "agent",
        boreal_domain::ActorRole::Reviewer => "reviewer",
        boreal_domain::ActorRole::Operator => "operator",
        boreal_domain::ActorRole::Publisher => "publisher",
    }
}

fn action_denial_code(value: &boreal_domain::actions::ActionDenialReason) -> &'static str {
    use boreal_domain::actions::ActionDenialReason::*;
    match value {
        Unauthenticated => "unauthenticated",
        ScopeMismatch => "scope_mismatch",
        InvalidFacts => "invalid_facts",
        AvailabilityUnavailable(_) => "availability_unavailable",
        IntegrityQuarantined => "integrity_quarantined",
        IntegrityDegraded => "integrity_degraded",
        RoleDenied { .. } => "role_denied",
        DelegationInvalid => "delegation_invalid",
        PolicyDenied => "policy_denied",
        StatusDenied(_) => "status_denied",
        HoldActive(_) => "hold_active",
        StaleSnapshot { .. } => "stale_snapshot",
        StaleEntity { .. } => "stale_entity",
        StaleProof { .. } => "stale_proof",
        MissingAttempt => "attempt_missing",
        StaleFence { .. } => "stale_fence",
        AttemptOwnerMismatch => "attempt_owner_mismatch",
        AttemptPhaseDenied(_) => "attempt_phase_denied",
        MissingSubmission => "submission_missing",
        ReviewNotIndependent => "review_not_independent",
        RecoveryRequired => "recovery_required",
        NoActiveHold => "hold_missing",
        ActionNotApplicable => "action_not_applicable",
    }
}

fn lifecycle_name(value: PersistedLifecycle) -> &'static str {
    match value {
        PersistedLifecycle::Draft => "draft",
        PersistedLifecycle::Open => "open",
        PersistedLifecycle::Closed => "closed",
        PersistedLifecycle::Cancelled => "cancelled",
    }
}

fn work_kind_name(value: WorkKind) -> &'static str {
    match value {
        WorkKind::Milestone => "milestone",
        WorkKind::Sprint => "sprint",
        WorkKind::Task => "task",
    }
}

fn dispatch_policy_name(value: DispatchPolicy) -> &'static str {
    match value {
        DispatchPolicy::Automatic => "automatic",
        DispatchPolicy::OperatorOnly => "operator_only",
        DispatchPolicy::Paused => "paused",
    }
}

fn gate_kind_name(value: boreal_domain::GateKind) -> &'static str {
    match value {
        boreal_domain::GateKind::Checkpoint => "checkpoint",
        boreal_domain::GateKind::Verification => "verification",
        boreal_domain::GateKind::Review => "review",
        boreal_domain::GateKind::OperatorApproval => "operator_approval",
        boreal_domain::GateKind::Summary => "summary",
        boreal_domain::GateKind::Audit => "audit",
    }
}

fn gate_state_name(value: boreal_domain::GateState) -> &'static str {
    match value {
        boreal_domain::GateState::Open => "open",
        boreal_domain::GateState::Satisfied => "satisfied",
        boreal_domain::GateState::Failed => "failed",
    }
}

fn attempt_phase_name(value: AttemptPhase) -> &'static str {
    match value {
        AttemptPhase::Claimed => "claimed",
        AttemptPhase::Accepted => "accepted",
        AttemptPhase::Running => "running",
        AttemptPhase::Verifying => "verifying",
        AttemptPhase::ExpiryPending => "expiry_pending",
        AttemptPhase::Completed => "completed",
        AttemptPhase::Failed => "failed",
        AttemptPhase::Released => "released",
        AttemptPhase::Expired => "expired",
        AttemptPhase::Cancelled => "cancelled",
    }
}

fn domain_action_name(value: boreal_domain::DomainAction) -> &'static str {
    match value {
        boreal_domain::DomainAction::PublishWork => "publish_work",
        boreal_domain::DomainAction::Claim => "claim",
        boreal_domain::DomainAction::AcceptAttempt => "accept_attempt",
        boreal_domain::DomainAction::ResumeAttempt => "resume_attempt",
        boreal_domain::DomainAction::ProvideEvidence => "provide_evidence",
        boreal_domain::DomainAction::RequestReview => "request_review",
        boreal_domain::DomainAction::FinishClose => "finish_close",
        boreal_domain::DomainAction::WaitForPrerequisite => "wait_for_prerequisite",
        boreal_domain::DomainAction::ResolveHold => "resolve_hold",
        boreal_domain::DomainAction::ResumePolicy => "resume_policy",
        boreal_domain::DomainAction::WaitUntil => "wait_until",
        boreal_domain::DomainAction::ReviewExpiry => "review_expiry",
        boreal_domain::DomainAction::RequestOperatorClaim => "request_operator_claim",
    }
}

fn status_name(status: boreal_domain::DerivedStatus) -> &'static str {
    match status {
        boreal_domain::DerivedStatus::Draft => "draft",
        boreal_domain::DerivedStatus::Queued => "queued",
        // Status/2 compatibility: status/3 scheduled work remains queued and
        // retains its scheduled_start reason in the surrounding projection.
        boreal_domain::DerivedStatus::Scheduled => "queued",
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

fn status2_name(status: boreal_domain::DerivedStatus) -> &'static str {
    match status {
        boreal_domain::DerivedStatus::ExpiredReview => "blocked",
        other => status_name(other),
    }
}

pub(crate) fn work_projection_json(item: &WorkRecord) -> Value {
    json!({
        "work_id": item.work_id,
        "project_id": item.project_id,
        "kind": item.kind,
        "parent_id": item.parent_id,
        "lifecycle": item.lifecycle,
        "dispatch_policy": item.dispatch_policy,
        "priority": item.priority,
        "hard_holds": item
            .hard_holds
            .iter()
            .map(|hold| hold.stable_code())
            .collect::<Vec<_>>(),
        "title": item.title,
        "description": item.description,
    })
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
    bounded_result(Some(work_projection_json(&item)), Some(revision))
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
        if let Some(partial) = finish_parent_readback(store, &project, operation_id)? {
            return Ok(partial);
        }
    }
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
    if let Some(execution) = &execution {
        if execution.project_id != project {
            return Err(CliError::with(
                ErrorCode::InvalidArgument,
                ApplicationOutcome::Rejected,
                "evidence execution does not belong to the selected project",
            ));
        }
        if operation
            .as_ref()
            .is_some_and(|operation| operation.project_id != execution.project_id)
        {
            return Err(CliError::with(
                ErrorCode::ProtocolMismatch,
                ApplicationOutcome::Failed,
                "operation and evidence execution project scopes disagree",
            ));
        }
    }
    let receipt_id = execution
        .as_ref()
        .and_then(|value| value.receipt_id.clone())
        .or_else(|| {
            operation.as_ref().and_then(|value| {
                serde_json::from_str::<Value>(&value.result_json)
                    .ok()
                    .and_then(|result| {
                        result
                            .get("receipt_id")
                            .and_then(Value::as_str)
                            .or_else(|| {
                                result
                                    .get("receipt")
                                    .and_then(|receipt| receipt.get("receipt_id"))
                                    .and_then(Value::as_str)
                            })
                            .map(ToOwned::to_owned)
                    })
            })
        });
    let receipt = receipt_id
        .as_deref()
        .map(|value| store.receipt(value).map_err(map_store_error))
        .transpose()?
        .flatten();
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
    let execution_json = execution.as_ref().map(|execution| {
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
            "state": evidence_execution_state_name(execution.state),
            "admitted_at": execution.admitted_at,
            "started_at": execution.started_at,
            "exited_at": execution.exited_at,
            "exit_code": execution.exit_code,
            "receipt_id": execution.receipt_id,
            "failure_code": execution.failure_code,
            "receipt": receipt.as_ref().map(receipt_record_json),
        })
    });
    let outcome = if execution
        .as_ref()
        .is_some_and(|value| !matches!(value.state, EvidenceExecutionState::ReceiptCommitted))
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
            "receipt_id": receipt.as_ref().map(|value| value.receipt_id.as_str()),
            "receipt": receipt.as_ref().map(receipt_record_json),
            "readback_required": outcome == ApplicationOutcome::Unknown,
        })),
        operation.as_ref().map(|value| value.revision),
    )
    .map(|mut result| {
        result.outcome = outcome;
        result
    })
}

fn receipt_record_json(receipt: &ReceiptRecord) -> Value {
    json!({
        "schema_version": "boreal.receipt.v1",
        "fixture_id": Value::Null,
        "receipt_id": receipt.receipt_id,
        "operation_id": receipt.operation_id,
        "subject": {
            "work_id": receipt.work_id,
            "attempt_id": receipt.attempt_id,
            "fence": receipt.fence,
            "gate_id": receipt.gate_id.clone().unwrap_or_default(),
        },
        "executable": receipt.executable,
        "argv": serde_json::from_str::<Value>(&receipt.argv_json).unwrap_or_else(|_| json!([])),
        "cwd": receipt.cwd,
        "exit_code": receipt.exit_code,
        "started_at": receipt.started_at,
        "ended_at": receipt.ended_at,
        "source_snapshot_hash": receipt.source_version_id,
        "config_identity": receipt.config_identity,
        "environment_fingerprint": receipt.environment_fingerprint,
        "output_digest": receipt.output_digest.clone().unwrap_or_default(),
        "output_ref": receipt.output_ref,
        "coverage": serde_json::from_str::<Value>(&receipt.coverage_json)
            .unwrap_or_else(|_| json!({})),
        "attestation": match receipt.attestation {
            ReceiptAttestation::BorealWitnessed => "boreal_witnessed",
            ReceiptAttestation::ExternalAttested => "external_attested",
            ReceiptAttestation::SelfReported => "self_reported",
            ReceiptAttestation::Unknown => "unknown",
        },
        "result": match receipt.result {
            ReceiptOutcome::Passed => "passed",
            ReceiptOutcome::Failed => "failed",
            ReceiptOutcome::Rejected => "rejected",
            ReceiptOutcome::Unknown => "unknown",
            ReceiptOutcome::Stale => "stale",
        },
        "retention": Value::Null,
        "rejection_code": receipt.rejection_code,
        "created_at": receipt.created_at,
    })
}

fn finish_parent_readback(
    store: &SqliteStore,
    project: &str,
    operation_id: &str,
) -> Result<Option<CliResult>, CliError> {
    let mut stages = serde_json::Map::new();
    let mut revision = None;
    for suffix in ["submit", "summary", "finalize"] {
        let child_id = sub_operation(operation_id, suffix);
        if let Some(child) = store.operation(&child_id).map_err(map_store_error)? {
            if child.project_id != project {
                return Err(CliError::with(
                    ErrorCode::InvalidArgument,
                    ApplicationOutcome::Rejected,
                    "finish child operation does not belong to the selected project",
                ));
            }
            revision = Some(revision.unwrap_or(0).max(child.revision));
            stages.insert(
                suffix.to_owned(),
                json!({
                    "operation_id": child.operation_id,
                    "outcome": format!("{:?}", child.outcome).to_ascii_lowercase(),
                    "revision": child.revision,
                    "result": serde_json::from_str::<Value>(&child.result_json).unwrap_or(Value::String(child.result_json)),
                }),
            );
        }
    }
    if stages.is_empty() {
        return Ok(None);
    }
    let mut result = bounded_result(
        Some(json!({
            "parent_operation_id": operation_id,
            "stages": stages,
            "readback_required": true,
        })),
        revision,
    )?;
    result.outcome = ApplicationOutcome::Unknown;
    Ok(Some(result))
}

fn evidence_execution_state_name(state: EvidenceExecutionState) -> &'static str {
    match state {
        EvidenceExecutionState::Admitted => "admitted",
        EvidenceExecutionState::Running => "running",
        EvidenceExecutionState::Exited => "exited",
        EvidenceExecutionState::ReceiptCommitted => "receipt_committed",
        EvidenceExecutionState::Unknown => "unknown",
    }
}

fn session_start_result(
    parsed: &ParsedCommand,
    app: &WorkApplication<'_>,
    operation: &str,
) -> Result<CliResult, CliError> {
    let project_id = ProjectId::new(project_argument(parsed, 0)?);
    let started_at = TimestampMs::from_millis(now_ms_u64());
    let session_id = SessionId::new(parsed.options.session.clone());
    let actor_id = ActorId::new(parsed.options.actor.clone());
    let harness_id = HarnessId::new(parsed.options.harness.clone());
    let expected_revision = parsed.options.expected_revision;
    let request_digest = canonical_request_digest(
        "session.register/v1",
        json!({
            "project_id": project_id.as_str(),
            "session_id": session_id.as_str(),
            "actor_id": actor_id.as_str(),
            "harness_id": harness_id.as_str(),
            "expected_project_revision": expected_revision,
        }),
    );
    let request = SessionRegistrationRequest {
        project_id,
        session_id,
        actor_id,
        harness_id,
        operation_id: OperationId::new(operation),
        request_digest,
        expected_project_revision: expected_revision,
        started_at,
    };
    let result = app
        .register_session(&request)
        .map_err(map_application_error)?;
    bounded_result(
        Some(json!({
            "project_id": result.value.project_id,
            "session_id": result.value.session_id,
            "actor_id": result.value.actor_id,
            "harness_id": result.value.harness_id,
            "state": format!("{:?}", result.value.state).to_ascii_lowercase(),
            "started_at": result.value.started_at,
            "ended_at": result.value.ended_at,
            "registration_operation_id": result.value.registration_operation_id,
            "replayed": !result.changed,
        })),
        Some(result.snapshot_revision),
    )
    .map(|mut value| {
        value.outcome = if result.changed {
            ApplicationOutcome::Changed
        } else {
            ApplicationOutcome::Unchanged
        };
        value
    })
}

fn session_show_result(
    parsed: &ParsedCommand,
    app: &WorkApplication<'_>,
) -> Result<CliResult, CliError> {
    let project_id = ProjectId::new(project_argument(parsed, 0)?);
    let session_id = SessionId::new(parsed.options.session.clone());
    let session = app
        .session(&project_id, &session_id)
        .map_err(map_application_error)?
        .ok_or_else(|| {
            CliError::with(
                ErrorCode::NotFound,
                ApplicationOutcome::Rejected,
                format!("session not found: {}", session_id.as_str()),
            )
        })?;
    bounded_result(
        Some(json!({
            "project_id": session.project_id,
            "session_id": session.session_id,
            "actor_id": session.actor_id,
            "harness_id": session.harness_id,
            "state": format!("{:?}", session.state).to_ascii_lowercase(),
            "started_at": session.started_at,
            "ended_at": session.ended_at,
            "registration_operation_id": session.registration_operation_id,
        })),
        Some(session.revision),
    )
}

fn session_end_result(
    parsed: &ParsedCommand,
    app: &WorkApplication<'_>,
    operation: &str,
) -> Result<CliResult, CliError> {
    let project_id = ProjectId::new(project_argument(parsed, 0)?);
    let session_id = parsed.options.session.clone();
    let result = app
        .end_session_as(
            &project_id,
            &session_id,
            &parsed.options.actor,
            parsed.options.expected_revision,
            &now(),
            operation.to_owned(),
        )
        .map_err(map_application_error)?;
    bounded_result(
        Some(json!({
            "project_id": result.value.project_id,
            "session_id": result.value.session_id,
            "actor_id": result.value.actor_id,
            "harness_id": result.value.harness_id,
            "state": format!("{:?}", result.value.state).to_ascii_lowercase(),
            "started_at": result.value.started_at,
            "ended_at": result.value.ended_at,
            "replayed": !result.changed,
        })),
        Some(result.snapshot_revision),
    )
    .map(|mut value| {
        value.outcome = if result.changed {
            ApplicationOutcome::Changed
        } else {
            ApplicationOutcome::Unchanged
        };
        value
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
        dispatch_policy: match parsed.options.dispatch.as_deref().unwrap_or("automatic") {
            "automatic" => DispatchPolicy::Automatic,
            "operator_only" => DispatchPolicy::OperatorOnly,
            "paused" => DispatchPolicy::Paused,
            _ => unreachable!("parser validates dispatch policy"),
        },
        hard_holds: parsed
            .options
            .hold
            .clone()
            .into_iter()
            .map(ReasonCode::HardHold)
            .collect(),
        acceptance_profile: AcceptanceProfile::focused(),
    };
    let result = match parsed.options.expected_revision {
        Some(expected_revision) => app.create_work_as_checked(
            &work,
            &parsed.options.actor,
            Some(expected_revision),
            &now(),
            operation.to_owned(),
        ),
        None => app.create_work_as(&work, &parsed.options.actor, &now(), operation.to_owned()),
    }
    .map_err(map_application_error)?;
    bounded_result(
        Some(json!({
            "project_id": result.value.project_id,
            "work_id": result.value.work_id,
            "kind": result.value.kind,
            "parent_id": result.value.parent_id,
            "title": result.value.title,
            "description": result.value.description,
            "priority": result.value.priority,
            "dispatch_policy": result.value.dispatch_policy,
            "profile": {
                "id": work.acceptance_profile.id.as_str(),
                "version": work.acceptance_profile.version,
            },
            "hard_holds": result
                .value
                .hard_holds
                .iter()
                .map(ReasonCode::stable_code)
                .collect::<Vec<_>>(),
            "replayed": !result.changed,
        })),
        Some(result.snapshot_revision),
    )
    .map(|mut view| {
        view.outcome = if result.changed {
            ApplicationOutcome::Changed
        } else {
            ApplicationOutcome::Unchanged
        };
        view
    })
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
            ..CliResult::default()
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
        .find(|item| item.work.kind == WorkKind::Task && status_item_selection_eligible(item))
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
    Renew,
    Release,
    Submit,
}

impl AttemptOperation {
    fn command_identity(self) -> &'static str {
        match self {
            Self::Accept => "attempt.accept/v1",
            Self::Heartbeat => "attempt.heartbeat/v1",
            Self::Renew => "attempt.renew/v1",
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
    let work_index = if parsed.path.first().is_some_and(|value| value == "work")
        && parsed.options.project.is_none()
    {
        1
    } else {
        0
    };
    let work_id = work_argument(parsed, work_index)?;
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
        AttemptOperation::Renew => app
            .renew_lease(
                adapter,
                boreal_application::RenewLeaseAttemptRequest {
                    attempt: request,
                    lease_ttl_ms: parsed
                        .options
                        .lease_ttl_ms
                        .ok_or_else(|| CliError::invalid("lease renewal requires --lease-ttl"))?,
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
    let project = project_argument(parsed, 0)?;
    let context = IdentityStore::new(store)
        .context(&project)
        .map_err(map_identity_error)?;
    let journal = app.authenticated_operation_journal(&context);
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
    // Validate every file/input before the first durable write. The summary
    // is part of the closeout identity, not a post-receipt presentation step.
    let summary_body = read_summary_body(parsed)?;
    let summary = summary_payload(&receipt, &summary_body, operation);
    let parent_request_digest = finish_close_request_digest(
        &ProjectId::new(project.clone()),
        &work_id,
        expected_attempt,
        expected_fence,
        &parsed.options.actor,
        &parsed.options.session,
        parsed.options.expected_revision,
        &receipt,
        &summary_body,
    );
    let result_operation = finish_result_operation_id(operation);
    ensure_finish_parent_intent(
        &journal,
        operation,
        &ProjectId::new(project.clone()),
        &parsed.options.actor,
        &parsed.options.session,
        expected_attempt,
        expected_fence,
        parsed.options.expected_revision,
        &parent_request_digest,
        &result_operation,
    )?;
    if let Some(readback) = finish_result_readback(&journal, operation, &result_operation)? {
        return Ok(readback);
    }
    let receipt_result = app.record_receipt(
        &parsed.options.actor,
        Some(parsed.options.session.as_str()),
        &receipt,
        parsed.options.expected_revision,
        TimestampMs::from_millis(now_ms_u64()),
    );
    let receipt_replayed = match receipt_result {
        Ok(result) => result.replayed,
        Err(error) if receipt.attestation == ExecutorAttestation::BorealWitnessed => {
            let import_denied = matches!(
                &error,
                ApplicationError::Evidence(validation)
                    if validation.code()
                        == boreal_application::EvidenceErrorCode::WitnessedReceiptImportDenied
            );
            if !import_denied {
                return Err(map_application_error(error));
            }
            // Witnessed receipts are already authoritative facts created by
            // evidence run. Direct closeout may read them back, but may never
            // import a second witnessed fact through the external-ingest API.
            let durable = store
                .receipt(receipt.receipt_id.as_str())
                .map_err(map_store_error)?
                .ok_or_else(|| {
                    CliError::with(
                        ErrorCode::ReceiptInvalid,
                        ApplicationOutcome::Rejected,
                        "witnessed receipt is not durably readable; use service readback",
                    )
                })?;
            let durable_result_matches = match receipt.result {
                ReceiptResult::Passed => durable.result == ReceiptOutcome::Passed,
                ReceiptResult::Failed => durable.result == ReceiptOutcome::Failed,
                ReceiptResult::Stale => durable.result == ReceiptOutcome::Stale,
            };
            if durable.project_id != project
                || durable.work_id != receipt.work_id.as_str()
                || durable.attempt_id != receipt.attempt_id.as_str()
                || durable.fence != receipt.fence.get()
                || durable.operation_id != receipt.operation_id.as_str()
                || durable.gate_id.as_deref() != Some(receipt.gate_id.as_str())
                || durable.source_version_id.as_deref()
                    != Some(receipt.source_snapshot_hash.as_str())
                || durable.config_identity != receipt.config_identity.as_str()
                || durable.output_digest != receipt.output_digest
                || durable.output_ref != receipt.output_ref
                || durable.attestation != ReceiptAttestation::BorealWitnessed
                || !durable_result_matches
            {
                return Err(CliError::with(
                    ErrorCode::ReceiptInvalid,
                    ApplicationOutcome::Rejected,
                    "witnessed receipt does not match its durable execution fact",
                ));
            }
            true
        }
        Err(error) => return Err(map_application_error(error)),
    };
    let submitted = attempt_mutation_result(
        parsed,
        app,
        adapter,
        &sub_operation(operation, "submit"),
        store,
        AttemptOperation::Submit,
    )?;
    let summary_result = app
        .record_summary(
            &parsed.options.actor,
            Some(parsed.options.session.as_str()),
            &summary,
            &sub_operation(operation, "summary"),
            None,
            TimestampMs::from_millis(now_ms_u64()),
        )
        .map_err(map_application_error)?;
    let intent = boreal_application::CloseIntent {
        work_id: receipt.work_id.clone(),
        attempt_id: receipt.attempt_id.clone(),
        fence: receipt.fence,
        source_snapshot_hash: receipt.source_snapshot_hash.clone(),
        config_identity: receipt.config_identity.clone(),
        profile_id: receipt.coverage.profile_id.clone(),
        profile_version: receipt.coverage.profile_version.clone(),
        summary_id: Some(summary.summary_id.clone()),
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
        .finalize_close_current(
            &parsed.options.actor,
            Some(parsed.options.session.as_str()),
            &intent,
            None,
            TimestampMs::from_millis(now_ms_u64()),
            &sub_operation(operation, "finalize"),
        )
        .map_err(map_application_error)?;
    let diagnostics = finalized.diagnostics.as_ref();
    let close_outcome = if diagnostics.is_some() {
        ApplicationOutcome::Rejected
    } else {
        ApplicationOutcome::Changed
    };
    let close_data = json!({
        "attempt": submitted.data,
        "receipt_id": receipt.receipt_id.as_str(),
        "receipt_replayed": receipt_replayed,
        "summary_id": summary.summary_id,
        "summary_replayed": summary_result.replayed,
        "close_intent": format!("{:?}", requested.close_intent.state).to_ascii_lowercase(),
        "close_state": format!("{:?}", finalized.close_intent.state).to_ascii_lowercase(),
        "close_replayed": finalized.replayed,
        "gates": diagnostics.map(|diagnostics| json!({
            "missing": diagnostics.missing,
            "gates": diagnostics.gates.iter().map(|gate| json!({
                "gate_id": gate.gate_id,
                "kind": format!("{:?}", gate.kind).to_ascii_lowercase(),
                "required": gate.required,
                "state": format!("{:?}", gate.state).to_ascii_lowercase(),
                "receipt_id": gate.receipt_id,
                "reason": gate.reason,
            })).collect::<Vec<_>>(),
        })),
    });
    append_finish_result_operation(
        &journal,
        operation,
        &result_operation,
        &ProjectId::new(project),
        &parsed.options.actor,
        &parsed.options.session,
        expected_attempt,
        expected_fence,
        parsed.options.expected_revision,
        close_outcome,
        &parent_request_digest,
        &close_data,
    )?;
    bounded_result(Some(close_data), Some(finalized.revision)).map(|mut result| {
        result.outcome = close_outcome;
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
            Some(parsed.options.session.as_str()),
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
    /// Names copied from the invoking environment. The default is a small,
    /// non-secret compatibility set; declarations may narrow or extend it
    /// with explicitly named, non-sensitive variables.
    #[serde(default = "default_environment_allowlist")]
    environment_allowlist: Vec<String>,
    #[serde(default)]
    observables: Vec<String>,
    #[serde(default = "default_gate_runtime_ms")]
    max_runtime_ms: Option<u64>,
    /// SHA-256 of the exact declaration bytes. This is diagnostic provenance;
    /// it is never used as a substitute for the durable gate policy identity.
    #[serde(skip)]
    policy_identity: String,
}

fn default_gate_cwd() -> String {
    ".".to_owned()
}

fn default_gate_runtime_ms() -> Option<u64> {
    Some(MAX_GATE_RUNTIME_MS)
}

fn default_environment_allowlist() -> Vec<String> {
    // PATH is needed by declarations that invoke a name rather than an
    // absolute executable. Locale and temp variables are useful to ordinary
    // build tools and do not contain credentials by convention. HOME is
    // intentionally excluded because it can expose user configuration and
    // credential stores.
    [
        "PATH", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR", "TMP", "TEMP", "CI",
    ]
    .into_iter()
    .map(str::to_owned)
    .collect()
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
    let canonical_gate_root = gate_root.canonicalize().map_err(|error| {
        CliError::with(
            ErrorCode::ReceiptInvalid,
            ApplicationOutcome::Rejected,
            format!("gate policy root is unavailable: {error}"),
        )
    })?;
    let prepared_environment = prepare_gate_environment(&declaration)?;
    let workspace_root = resolve_workspace_root(&canonical_gate_root)?;
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
        format!(
            "{}:{}",
            project.as_str(),
            canonical_gate_root.to_string_lossy()
        )
        .as_bytes(),
    )
    .replace(':', "-");
    let output_dir = canonical_gate_root
        .parent()
        .unwrap_or(&canonical_gate_root)
        .join("evidence")
        .join(artifact_namespace);
    let artifact_stem = sha256_content_digest(operation.as_bytes()).replace(':', "-");
    let output_path = output_dir.join(format!("{artifact_stem}.out"));
    let artifact_ref = output_path.with_extension("combined");
    let request = EvidenceRunRequest {
        receipt_id: ReceiptId::new(format!("receipt-{operation}")),
        operation_id: OperationId::new(operation),
        expectation,
        cwd: declaration.cwd.clone(),
        environment_fingerprint: prepared_environment.fingerprint.clone(),
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
    validation_failpoint("after_evidence_admission");
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
    validation_failpoint("after_evidence_start");
    let execution = match execute_gate_command(
        &declaration,
        &output_path,
        Some(&workspace_root),
        &prepared_environment.variables,
    ) {
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
    validation_failpoint("after_evidence_exit");
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
        "declared_environment_fingerprint": declaration.environment_fingerprint,
        "environment_allowlist": prepared_environment.names,
        "gate_policy_identity": declaration.policy_identity,
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
    let export = match serde_json::to_vec(&receipt_json) {
        Ok(bytes) => match write_receipt_sidecar(&receipt_path, &bytes) {
            Ok(()) => json!({
                "status": "exported",
                "path": receipt_path,
                "retryable": false,
            }),
            Err(message) => json!({
                "status": "committed_export_failed",
                "path": receipt_path,
                "retryable": true,
                "code": "receipt_sidecar_export_failed",
                "message": message,
            }),
        },
        Err(error) => json!({
            "status": "committed_export_failed",
            "path": receipt_path,
            "retryable": false,
            "code": "receipt_sidecar_serialization_failed",
            "message": error.to_string(),
        }),
    };
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
            "export": export,
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

fn write_receipt_sidecar(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let temporary = path.with_extension(format!(
        "json.tmp-{}-{}",
        std::process::id(),
        OPERATION_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|error| error.to_string())?;
        file.write_all(bytes).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        fs::rename(&temporary, path).map_err(|error| error.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

/// Deterministic crash points used only by the validation harness. They are
/// compiled out of optimized release binaries so a production invocation
/// cannot be made to abort by an inherited test environment variable.
fn validation_failpoint(name: &str) {
    if cfg!(debug_assertions) && env::var("BOREAL_VALIDATION_FAILPOINT").as_deref() == Ok(name) {
        eprintln!("BOREAL_VALIDATION_FAILPOINT reached: {name}");
        std::process::abort();
    }
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
    let mut declaration: GateDeclaration = serde_json::from_str(&text).map_err(|error| {
        CliError::with(
            ErrorCode::ReceiptInvalid,
            ApplicationOutcome::Rejected,
            error.to_string(),
        )
    })?;
    validate_environment_policy(&declaration.environment_allowlist)?;
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
    declaration.policy_identity = sha256_content_digest(text.as_bytes());
    Ok(declaration)
}

fn validate_environment_policy(names: &[String]) -> Result<(), CliError> {
    if names.len() > 64 {
        return Err(CliError::with(
            ErrorCode::UnsafeCommand,
            ApplicationOutcome::Rejected,
            "gate environment allowlist exceeds the 64-variable limit",
        ));
    }
    let mut seen = Vec::with_capacity(names.len());
    for name in names {
        if !valid_environment_name(name) {
            return Err(CliError::with(
                ErrorCode::UnsafeCommand,
                ApplicationOutcome::Rejected,
                format!("gate environment name is invalid: {name:?}"),
            ));
        }
        if is_sensitive_environment_name(name) {
            return Err(CliError::with(
                ErrorCode::UnsafeCommand,
                ApplicationOutcome::Rejected,
                format!("gate environment name is sensitive and cannot be inherited: {name}"),
            ));
        }
        if seen.iter().any(|existing: &String| existing == name) {
            return Err(CliError::with(
                ErrorCode::ReceiptPolicyMismatch,
                ApplicationOutcome::Rejected,
                format!("gate environment allowlist contains a duplicate: {name}"),
            ));
        }
        seen.push(name.clone());
    }
    Ok(())
}

fn valid_environment_name(name: &str) -> bool {
    let mut characters = name.chars();
    matches!(characters.next(), Some(value) if value == '_' || value.is_ascii_uppercase())
        && characters
            .all(|value| value == '_' || value.is_ascii_uppercase() || value.is_ascii_digit())
}

fn is_sensitive_environment_name(name: &str) -> bool {
    let upper = name.to_ascii_uppercase();
    [
        "SECRET",
        "TOKEN",
        "PASSWORD",
        "PASSWD",
        "PRIVATE",
        "API_KEY",
        "CREDENTIAL",
        "AUTH",
        "COOKIE",
        "BEARER",
    ]
    .iter()
    .any(|marker| upper.contains(marker))
}

struct PreparedEnvironment {
    variables: Vec<(String, String)>,
    names: Vec<String>,
    fingerprint: String,
}

fn prepare_gate_environment(
    declaration: &GateDeclaration,
) -> Result<PreparedEnvironment, CliError> {
    validate_environment_policy(&declaration.environment_allowlist)?;
    let mut names = declaration.environment_allowlist.clone();
    names.sort();
    let mut variables = Vec::with_capacity(names.len());
    let mut missing = Vec::new();
    for name in &names {
        match env::var_os(name) {
            Some(value) => {
                let value = value.into_string().map_err(|_| {
                    CliError::with(
                        ErrorCode::UnsafeCommand,
                        ApplicationOutcome::Rejected,
                        format!("gate environment value is not valid UTF-8: {name}"),
                    )
                })?;
                variables.push((name.clone(), value));
            }
            None => missing.push(name.clone()),
        }
    }
    let fingerprint = canonical_request_digest(
        "gate.environment/v1",
        json!({
            "allowlist": names,
            "present": variables,
            "missing": missing,
        }),
    );
    Ok(PreparedEnvironment {
        variables,
        names,
        fingerprint,
    })
}

fn resolve_workspace_root(gate_root: &Path) -> Result<PathBuf, CliError> {
    let storage_root = gate_root.parent().ok_or_else(|| {
        CliError::with(
            ErrorCode::ReceiptInvalid,
            ApplicationOutcome::Rejected,
            "gate policy has no storage root",
        )
    })?;
    let candidate = {
        // The standard layout is <workspace>/.boreal/{boreal.sqlite,gates}.
        // Test and explicitly external layouts use <workspace>/{db,gates}.
        if storage_root
            .file_name()
            .is_some_and(|name| name == ".boreal")
        {
            storage_root.parent().unwrap_or(storage_root).to_path_buf()
        } else {
            storage_root.to_path_buf()
        }
    };
    let root = candidate.canonicalize().map_err(|error| {
        CliError::with(
            ErrorCode::ReceiptInvalid,
            ApplicationOutcome::Rejected,
            format!("workspace root is unavailable: {error}"),
        )
    })?;
    if !root.is_dir() {
        return Err(CliError::with(
            ErrorCode::ReceiptInvalid,
            ApplicationOutcome::Rejected,
            "workspace root is not a directory",
        ));
    }
    Ok(root)
}

/// Resolves the validated project/workspace identity supplied to the atomic
/// production bootstrap primitive. Filesystem canonicalization stays outside
/// the SQLite transaction; only the resulting immutable binding is persisted.
fn workspace_binding(project_root: &Path) -> Result<WorkspaceBinding, CliError> {
    let canonical_root = fs::canonicalize(project_root).map_err(|error| {
        CliError::with(
            ErrorCode::NotFound,
            ApplicationOutcome::Failed,
            format!(
                "cannot establish the project workspace identity for {}: {error}",
                project_root.display()
            ),
        )
    })?;
    let canonical_root_text = canonical_root.to_string_lossy().into_owned();
    let binding_material = format!(
        "boreal.workspace-binding/v1\nroot={canonical_root_text}\nworktree={canonical_root_text}\n"
    );
    let binding_digest = sha256_content_digest(binding_material.as_bytes());
    let binding = WorkspaceBinding::new(
        canonical_root_text.clone(),
        canonical_root_text,
        binding_digest,
    )
    .map_err(|error| {
        CliError::with(
            ErrorCode::InvalidArgument,
            ApplicationOutcome::Rejected,
            format!("cannot establish the project workspace identity: {error}"),
        )
    })?;
    Ok(binding)
}

fn map_identity_error(error: IdentityError) -> CliError {
    match error {
        IdentityError::Store(error) => map_store_error(error),
        IdentityError::Invalid { .. } => CliError::with(
            ErrorCode::InvalidArgument,
            ApplicationOutcome::Rejected,
            error.to_string(),
        ),
        IdentityError::ProjectNotFound { .. } | IdentityError::WorkNotFound { .. } => {
            CliError::with(
                ErrorCode::NotFound,
                ApplicationOutcome::Rejected,
                error.to_string(),
            )
        }
        IdentityError::ForeignSubject { .. }
        | IdentityError::DatabaseInstanceConflict { .. }
        | IdentityError::RestoreEpochConflict { .. }
        | IdentityError::WorkspaceConflict { .. }
        | IdentityError::RestoreEpochRegression { .. } => CliError::with(
            ErrorCode::OperationConflict,
            ApplicationOutcome::Conflict,
            error.to_string(),
        ),
        IdentityError::StaleEntity { .. } | IdentityError::StaleProof { .. } => CliError::with(
            ErrorCode::StaleRevision,
            ApplicationOutcome::Conflict,
            error.to_string(),
        ),
        IdentityError::StaleFence { .. } | IdentityError::FenceRevoked { .. } => CliError::with(
            ErrorCode::StaleFence,
            ApplicationOutcome::Rejected,
            error.to_string(),
        ),
        IdentityError::OperationInvalidated { .. } => CliError::with(
            ErrorCode::OperationConflict,
            ApplicationOutcome::Conflict,
            error.to_string(),
        ),
    }
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
    environment: &[(String, String)],
) -> Result<BoundedExecutionResult, CliError> {
    if !cfg!(unix) {
        return Err(CliError::with(
            ErrorCode::UnsupportedPlatform,
            ApplicationOutcome::Failed,
            "witnessed gate execution is fail-closed on platforms without process-group cleanup",
        ));
    }
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
    let mut process = Command::new(&command.executable);
    process
        .args(command.argv.iter().skip(1))
        .current_dir(&cwd)
        .env_clear()
        .envs(environment.iter().map(|(name, value)| (name, value)))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    process.process_group(0);
    let mut child = process.spawn().map_err(|error| {
        CliError::with(
            ErrorCode::ReceiptInvalid,
            ApplicationOutcome::Rejected,
            format!("declared gate could not start: {error}"),
        )
    })?;
    let process_group_id = child.id();
    let stdout_reader = match child.stdout.take() {
        Some(reader) => reader,
        None => {
            let _ = terminate_gate_process(&mut child);
            return Err(CliError::with(
                ErrorCode::ServiceUnavailable,
                ApplicationOutcome::Failed,
                "declared gate stdout pipe was unavailable",
            ));
        }
    };
    let stderr_reader = match child.stderr.take() {
        Some(reader) => reader,
        None => {
            let _ = terminate_gate_process(&mut child);
            return Err(CliError::with(
                ErrorCode::ServiceUnavailable,
                ApplicationOutcome::Failed,
                "declared gate stderr pipe was unavailable",
            ));
        }
    };
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
            child_status = terminate_gate_process(&mut child).status;
            break;
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                child_status = Some(status);
                break;
            }
            Ok(None) => {}
            Err(error) => {
                let _ = terminate_gate_process(&mut child);
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
            child_status = terminate_gate_process(&mut child).status;
            timed_out = true;
            break;
        }
        thread::sleep(Duration::from_millis(5));
    }
    if child_status.is_some() && !timed_out {
        // A parent exit is not process-tree completion: descendants can keep
        // either inherited pipe open forever. Terminate the operation group
        // before joining capture workers so the declared runtime also bounds
        // output drain. The process group was created exclusively for this
        // verifier invocation.
        terminate_gate_descendants(process_group_id);
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
    let observables = declaration
        .observables
        .iter()
        .filter(|observable| !observable.is_empty())
        .filter(|observable| {
            contains_bytes(&output, observable.as_bytes())
                || contains_bytes(&error_output, observable.as_bytes())
        })
        .cloned()
        .collect();
    output.append(&mut error_output);
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
    seal_artifact(output_path)?;
    seal_artifact(&stderr_path)?;
    seal_artifact(&combined_path)?;
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

fn contains_bytes(haystack: &[u8], needle: &[u8]) -> bool {
    !needle.is_empty()
        && haystack
            .windows(needle.len())
            .any(|window| window == needle)
}

/// Seal artifacts after their complete contents and digest have been written.
/// `create_new` plus the operation-specific path prevents the runner itself
/// from replacing an existing artifact. Filesystem permissions are defense in
/// depth only; the same OS user can still deliberately change them.
fn seal_artifact(path: &Path) -> Result<(), CliError> {
    let mut permissions = fs::metadata(path)
        .map_err(|error| {
            CliError::with(
                ErrorCode::ServiceUnavailable,
                ApplicationOutcome::Failed,
                format!(
                    "cannot inspect evidence artifact {}: {error}",
                    path.display()
                ),
            )
        })?
        .permissions();
    permissions.set_readonly(true);
    fs::set_permissions(path, permissions).map_err(|error| {
        CliError::with(
            ErrorCode::ServiceUnavailable,
            ApplicationOutcome::Failed,
            format!("cannot seal evidence artifact {}: {error}", path.display()),
        )
    })
}

struct GateTermination {
    status: Option<ExitStatus>,
}

fn terminate_gate_process(child: &mut Child) -> GateTermination {
    #[cfg(unix)]
    {
        let process_id = child.id();
        // The child is placed in its own process group before spawn. A TERM
        // grace period lets cooperative tools flush diagnostics; KILL then
        // covers descendants that ignore TERM or keep the pipes open.
        let _ = runner_process::send_group(process_id, runner_process::SIGTERM);
        let grace_deadline = Instant::now() + Duration::from_millis(150);
        loop {
            match child.try_wait() {
                Ok(Some(status)) => {
                    // The direct child may exit before its descendants. Send
                    // the hard stop after reaping it while the group id is
                    // still the operation's immutable process id.
                    let _ = runner_process::send_group(process_id, runner_process::SIGKILL);
                    return GateTermination {
                        status: Some(status),
                    };
                }
                Ok(None) if Instant::now() < grace_deadline => {
                    thread::sleep(Duration::from_millis(5));
                }
                Ok(None) | Err(_) => break,
            }
        }
        let _ = runner_process::send_group(process_id, runner_process::SIGKILL);
        GateTermination {
            status: child.wait().ok(),
        }
    }
    #[cfg(not(unix))]
    {
        // execute_gate_command rejects non-Unix platforms before spawn. This
        // fallback is defensive if a future caller bypasses that guard.
        let _ = child.kill();
        GateTermination {
            status: child.wait().ok(),
        }
    }
}

#[cfg(unix)]
fn terminate_gate_descendants(process_group_id: u32) {
    let _ = runner_process::send_group(process_group_id, runner_process::SIGTERM);
    thread::sleep(Duration::from_millis(25));
    let _ = runner_process::send_group(process_group_id, runner_process::SIGKILL);
}

#[cfg(not(unix))]
fn terminate_gate_descendants(_process_group_id: u32) {}

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
            > MAX_JSON_BYTES.saturating_sub(ENVELOPE_METADATA_BUDGET)
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
        ..CliResult::default()
    })
}

fn finish_close_request_digest(
    project: &ProjectId,
    work_id: &str,
    attempt: &str,
    fence: u64,
    actor: &str,
    session: &str,
    expected_revision: Option<u64>,
    receipt: &ReceiptPayload,
    summary_body: &str,
) -> String {
    canonical_request_digest(
        "finish.close/v2",
        json!({
            "project_id": project.as_str(),
            "work_id": work_id,
            "attempt_id": attempt,
            "fence": fence,
            "actor_id": actor,
            "session_id": session,
            "expected_revision": expected_revision,
            "receipt": {
                "schema_version": receipt.schema_version,
                "receipt_id": receipt.receipt_id.as_str(),
                "operation_id": receipt.operation_id.as_str(),
                "subject": {
                    "work_id": receipt.work_id.as_str(),
                    "attempt_id": receipt.attempt_id.as_str(),
                    "fence": receipt.fence.get(),
                    "gate_id": receipt.gate_id.as_str(),
                },
                "executable": receipt.executable,
                "argv": receipt.argv,
                "cwd": receipt.cwd,
                "exit_code": receipt.exit_code,
                "started_at": receipt.started_at.as_millis(),
                "ended_at": receipt.ended_at.as_millis(),
                "source_snapshot_hash": receipt.source_snapshot_hash.as_str(),
                "config_identity": receipt.config_identity.as_str(),
                "environment_fingerprint": receipt.environment_fingerprint,
                "output_digest": receipt.output_digest,
                "output_ref": receipt.output_ref,
                "coverage": {
                    "kind": finish_gate_kind_name(receipt.coverage.kind),
                    "profile_id": receipt.coverage.profile_id.as_str(),
                    "profile_version": receipt.coverage.profile_version,
                    "observables": receipt.coverage.observables,
                },
                "attestation": finish_attestation_name(receipt.attestation),
                "result": finish_receipt_result_name(receipt.result),
            },
            "summary": summary_body,
        }),
    )
}

fn finish_gate_kind_name(kind: GateKind) -> &'static str {
    match kind {
        GateKind::Checkpoint => "checkpoint",
        GateKind::Verification => "verification",
        GateKind::Review => "review",
        GateKind::OperatorApproval => "operator_approval",
        GateKind::Summary => "summary",
        GateKind::Audit => "audit",
    }
}

fn finish_attestation_name(attestation: ExecutorAttestation) -> &'static str {
    match attestation {
        ExecutorAttestation::BorealWitnessed => "boreal_witnessed",
        ExecutorAttestation::ExternalAttested => "external_attested",
        ExecutorAttestation::SelfReported => "self_reported",
        ExecutorAttestation::Unknown => "unknown",
    }
}

fn finish_receipt_result_name(result: ReceiptResult) -> &'static str {
    match result {
        ReceiptResult::Passed => "passed",
        ReceiptResult::Failed => "failed",
        ReceiptResult::Stale => "stale",
    }
}

fn finish_result_operation_id(operation: &str) -> String {
    format!("{}:result", operation)
}

fn finish_store_outcome(outcome: ApplicationOutcome) -> StoreOperationOutcome {
    match outcome {
        ApplicationOutcome::Changed => StoreOperationOutcome::Changed,
        ApplicationOutcome::Unchanged => StoreOperationOutcome::Unchanged,
        ApplicationOutcome::Rejected => StoreOperationOutcome::Rejected,
        ApplicationOutcome::Conflict => StoreOperationOutcome::Conflict,
        ApplicationOutcome::Busy => StoreOperationOutcome::Busy,
        ApplicationOutcome::Failed => StoreOperationOutcome::Failed,
        ApplicationOutcome::Unknown => StoreOperationOutcome::Unknown,
    }
}

fn finish_application_outcome(outcome: StoreOperationOutcome) -> ApplicationOutcome {
    match outcome {
        StoreOperationOutcome::Changed => ApplicationOutcome::Changed,
        StoreOperationOutcome::Unchanged => ApplicationOutcome::Unchanged,
        StoreOperationOutcome::Rejected => ApplicationOutcome::Rejected,
        StoreOperationOutcome::Conflict => ApplicationOutcome::Conflict,
        StoreOperationOutcome::Busy => ApplicationOutcome::Busy,
        StoreOperationOutcome::Failed => ApplicationOutcome::Failed,
        StoreOperationOutcome::Unknown => ApplicationOutcome::Unknown,
    }
}

fn ensure_finish_parent_intent(
    journal: &AuthenticatedOperationJournal<'_>,
    operation: &str,
    project: &ProjectId,
    actor: &str,
    session: &str,
    attempt: &str,
    fence: u64,
    expected_revision: Option<u64>,
    request_digest: &str,
    result_operation: &str,
) -> Result<(), CliError> {
    if let Some(readback) = journal.readback(operation).map_err(map_application_error)? {
        let existing = readback.operation.ok_or_else(|| {
            CliError::with(
                ErrorCode::ProtocolMismatch,
                ApplicationOutcome::Failed,
                "finish_close parent operation has no durable outcome",
            )
        })?;
        if existing.project_id != project.as_str()
            || existing.command != "finish_close"
            || existing.actor_id != actor
            || existing.session_id.as_deref() != Some(session)
            || existing.expected_revision != expected_revision
            || existing.attempt_id.as_deref() != Some(attempt)
            || existing.fence != Some(fence)
            || existing.request_digest != request_digest
        {
            return Err(CliError::with(
                ErrorCode::OperationConflict,
                ApplicationOutcome::Conflict,
                "finish_close operation ID was reused with a different immutable request",
            ));
        }
        return Ok(());
    }
    let created_at = now();
    let payload = json!({
        "state": "pending",
        "parent_operation_id": operation,
        "result_operation_id": result_operation,
        "request_digest": request_digest,
        "readback_required": true,
    })
    .to_string();
    journal
        .append(
            OperationRecord {
                operation_id: operation.to_owned(),
                project_id: project.as_str().to_owned(),
                command: "finish_close".to_owned(),
                actor_id: actor.to_owned(),
                session_id: Some(session.to_owned()),
                expected_revision,
                attempt_id: Some(attempt.to_owned()),
                fence: Some(fence),
                request_digest: request_digest.to_owned(),
                outcome: StoreOperationOutcome::Busy,
                result_json: payload.clone(),
                revision: 0,
                created_at: created_at.clone(),
                completed_at: None,
            },
            AuditEventRecord {
                project_id: project.as_str().to_owned(),
                revision: 0,
                operation_id: operation.to_owned(),
                event_type: "close.requested".to_owned(),
                subject_type: "attempt".to_owned(),
                subject_id: attempt.to_owned(),
                actor_id: actor.to_owned(),
                session_id: Some(session.to_owned()),
                fence: Some(fence),
                as_of: created_at,
                payload_json: payload,
            },
        )
        .map(|_| ())
        .map_err(map_application_error)
}

fn finish_result_from_operation(operation: &OperationRecord) -> Result<CliResult, CliError> {
    if matches!(
        operation.outcome,
        StoreOperationOutcome::Busy | StoreOperationOutcome::Unknown
    ) {
        return Err(CliError::with(
            ErrorCode::UnknownOutcome,
            ApplicationOutcome::Unknown,
            "finish_close result is still pending readback",
        ));
    }
    let value: Value = serde_json::from_str(&operation.result_json).map_err(|error| {
        CliError::with(
            ErrorCode::ProtocolMismatch,
            ApplicationOutcome::Failed,
            format!("finish_close result is invalid JSON: {error}"),
        )
    })?;
    let data = value.get("close").cloned().unwrap_or(value);
    let mut result = bounded_result(Some(data), Some(operation.revision))?;
    result.outcome = finish_application_outcome(operation.outcome);
    Ok(result)
}

fn finish_result_readback(
    journal: &AuthenticatedOperationJournal<'_>,
    operation: &str,
    result_operation: &str,
) -> Result<Option<CliResult>, CliError> {
    let parent = journal
        .readback(operation)
        .map_err(map_application_error)?
        .and_then(|readback| readback.operation)
        .ok_or_else(|| {
            CliError::with(
                ErrorCode::ProtocolMismatch,
                ApplicationOutcome::Failed,
                "finish_close result exists without its parent operation",
            )
        })?;
    if let Some(readback) = journal
        .readback(result_operation)
        .map_err(map_application_error)?
    {
        let record = readback.operation.ok_or_else(|| {
            CliError::with(
                ErrorCode::ProtocolMismatch,
                ApplicationOutcome::Failed,
                "finish_close result operation has no durable outcome",
            )
        })?;
        if record.command != "finish_close.result" {
            return Err(CliError::with(
                ErrorCode::ProtocolMismatch,
                ApplicationOutcome::Failed,
                "finish_close result operation has an unexpected command",
            ));
        }
        if record.operation_id != result_operation
            || record.project_id != parent.project_id
            || record.actor_id != parent.actor_id
            || record.session_id != parent.session_id
            || record.expected_revision != parent.expected_revision
            || record.attempt_id != parent.attempt_id
            || record.fence != parent.fence
        {
            return Err(CliError::with(
                ErrorCode::ProtocolMismatch,
                ApplicationOutcome::Failed,
                "finish_close result operation identity does not match its parent",
            ));
        }
        let expected_request_digest = canonical_request_digest(
            "finish.close.result/v1",
            json!({
                "parent_operation_id": parent.operation_id,
                "parent_request_digest": parent.request_digest,
            }),
        );
        if record.request_digest != expected_request_digest {
            return Err(CliError::with(
                ErrorCode::ProtocolMismatch,
                ApplicationOutcome::Failed,
                "finish_close result operation digest does not match its parent",
            ));
        }
        let result_value: Value = serde_json::from_str(&record.result_json).map_err(|error| {
            CliError::with(
                ErrorCode::ProtocolMismatch,
                ApplicationOutcome::Failed,
                format!("finish_close result is invalid JSON: {error}"),
            )
        })?;
        if result_value
            .get("parent_operation_id")
            .and_then(Value::as_str)
            != Some(parent.operation_id.as_str())
            || result_value
                .get("parent_request_digest")
                .and_then(Value::as_str)
                != Some(parent.request_digest.as_str())
        {
            return Err(CliError::with(
                ErrorCode::ProtocolMismatch,
                ApplicationOutcome::Failed,
                "finish_close result payload does not match its parent",
            ));
        }
        return finish_result_from_operation(&record).map(Some);
    }
    if !matches!(
        parent.outcome,
        StoreOperationOutcome::Busy | StoreOperationOutcome::Unknown
    ) {
        return finish_result_from_operation(&parent).map(Some);
    }
    Ok(None)
}

fn append_finish_result_operation(
    journal: &AuthenticatedOperationJournal<'_>,
    parent_operation: &str,
    result_operation: &str,
    project: &ProjectId,
    actor: &str,
    session: &str,
    attempt: &str,
    fence: u64,
    expected_revision: Option<u64>,
    outcome: ApplicationOutcome,
    parent_request_digest: &str,
    result: &Value,
) -> Result<(), CliError> {
    let created_at = now();
    let result_json = json!({
        "parent_operation_id": parent_operation,
        "parent_request_digest": parent_request_digest,
        "close": result,
    })
    .to_string();
    let request_digest = canonical_request_digest(
        "finish.close.result/v1",
        json!({
            "parent_operation_id": parent_operation,
            "parent_request_digest": parent_request_digest,
        }),
    );
    journal
        .append(
            OperationRecord {
                operation_id: result_operation.to_owned(),
                project_id: project.as_str().to_owned(),
                command: "finish_close.result".to_owned(),
                actor_id: actor.to_owned(),
                session_id: Some(session.to_owned()),
                expected_revision,
                attempt_id: Some(attempt.to_owned()),
                fence: Some(fence),
                request_digest,
                outcome: finish_store_outcome(outcome),
                result_json: result_json.clone(),
                // The journal allocates a fresh revision so its audit row
                // cannot collide with the lifecycle mutation's audit row.
                revision: 0,
                created_at: created_at.clone(),
                completed_at: Some(created_at.clone()),
            },
            AuditEventRecord {
                project_id: project.as_str().to_owned(),
                revision: 0,
                operation_id: result_operation.to_owned(),
                event_type: "close.completed".to_owned(),
                subject_type: "attempt".to_owned(),
                subject_id: attempt.to_owned(),
                actor_id: actor.to_owned(),
                session_id: Some(session.to_owned()),
                fence: Some(fence),
                as_of: created_at,
                payload_json: result_json,
            },
        )
        .map(|_| ())
        .map_err(map_application_error)
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
        .find(|item| item.work.kind == WorkKind::Task && status_item_selection_eligible(item))
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

/// Direct mode is an explicitly safe offline mode: it must hold the same
/// database-identity election used by the local service for the entire
/// application operation. This prevents a direct CLI process from silently
/// racing an elected service owner.
fn direct_database_owner(
    path: &Path,
    parsed: &ParsedCommand,
) -> Result<Option<boreal_service::ProjectElection>, CliError> {
    let project = if parsed.path == ["doctor"] && parsed.options.project.is_none() {
        None
    } else {
        Some(project_argument(parsed, 0)?)
    };
    let Some(project) = project else {
        return Ok(None);
    };
    let canonical_db = if path.exists() {
        fs::canonicalize(path).map_err(|error| {
            CliError::with(
                ErrorCode::ServiceUnavailable,
                ApplicationOutcome::Failed,
                format!("database identity is unavailable: {error}"),
            )
        })?
    } else {
        let parent = path.parent().unwrap_or(Path::new("."));
        let parent = fs::canonicalize(parent).map_err(|error| {
            CliError::with(
                ErrorCode::ServiceUnavailable,
                ApplicationOutcome::Failed,
                format!("database parent identity is unavailable: {error}"),
            )
        })?;
        parent.join(
            path.file_name()
                .ok_or_else(|| CliError::invalid("database path must name a database file"))?,
        )
    };
    let runtime_dir = canonical_db
        .parent()
        .unwrap_or(Path::new("."))
        .join(".boreal-service-runtime");
    let database_identity = format!("database:{}", canonical_db.to_string_lossy());
    let owner_id = format!(
        "direct-process:{}:{}",
        std::process::id(),
        sha256_content_digest(database_identity.as_bytes())
    );
    boreal_service::ProjectElection::try_acquire(&runtime_dir, database_identity, owner_id)
        .map(Some)
        .map_err(|error| {
            let outcome = match error {
                boreal_service::ElectionError::Busy(_) => ApplicationOutcome::Busy,
                _ => ApplicationOutcome::Failed,
            };
            let code = if outcome == ApplicationOutcome::Busy {
                ErrorCode::ServiceBusy
            } else {
                ErrorCode::ServiceUnavailable
            };
            CliError::with(
                code,
                outcome,
                format!(
                    "direct offline mode could not acquire database owner for project {project}: {error}"
                ),
            )
        })
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
        ApplicationError::Planning(error) => CliError::invalid(error.to_string()),
    }
}

fn map_dependency_error(error: ApplicationError) -> CliError {
    match &error {
        ApplicationError::Store(StoreError::Conflict(message))
            if message.to_ascii_lowercase().contains("dependency cycle") =>
        {
            CliError::with(
                ErrorCode::DependencyCycle,
                ApplicationOutcome::Rejected,
                error.to_string(),
            )
        }
        _ => map_application_error(error),
    }
}

/// Maintenance commands use the same local election as normal direct CLI
/// operations, but bind the lock to the database rather than guessing a
/// project from a backup package. Restore must not race a service or another
/// direct writer while it swaps the database path.
fn direct_database_maintenance_owner(
    path: &Path,
) -> Result<Option<boreal_service::ProjectElection>, CliError> {
    let canonical_db = if path.exists() {
        fs::canonicalize(path).map_err(|error| {
            CliError::with(
                ErrorCode::ServiceUnavailable,
                ApplicationOutcome::Failed,
                format!("database identity is unavailable: {error}"),
            )
        })?
    } else {
        let parent = path.parent().unwrap_or(Path::new("."));
        let parent = fs::canonicalize(parent).map_err(|error| {
            CliError::with(
                ErrorCode::ServiceUnavailable,
                ApplicationOutcome::Failed,
                format!("database parent identity is unavailable: {error}"),
            )
        })?;
        parent.join(
            path.file_name()
                .ok_or_else(|| CliError::invalid("database path must name a database file"))?,
        )
    };
    let runtime_dir = canonical_db
        .parent()
        .unwrap_or(Path::new("."))
        .join(".boreal-service-runtime");
    let database_identity = format!("database:{}", canonical_db.to_string_lossy());
    let owner_id = format!(
        "maintenance-process:{}:{}",
        std::process::id(),
        sha256_content_digest(database_identity.as_bytes())
    );
    boreal_service::ProjectElection::try_acquire(&runtime_dir, database_identity, owner_id)
        .map(Some)
        .map_err(|error| {
            let outcome = match error {
                boreal_service::ElectionError::Busy(_) => ApplicationOutcome::Busy,
                _ => ApplicationOutcome::Failed,
            };
            let code = if outcome == ApplicationOutcome::Busy {
                ErrorCode::ServiceBusy
            } else {
                ErrorCode::ServiceUnavailable
            };
            CliError::with(
                code,
                outcome,
                format!("database maintenance could not acquire ownership: {error}"),
            )
        })
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

#[cfg(unix)]
mod runner_process {
    use std::os::raw::c_int;

    pub(super) const SIGTERM: c_int = 15;
    pub(super) const SIGKILL: c_int = 9;

    unsafe extern "C" {
        fn kill(process: c_int, signal: c_int) -> c_int;
    }

    pub(super) fn send_group(process_id: u32, signal: c_int) -> bool {
        let Ok(process_id) = c_int::try_from(process_id) else {
            return false;
        };
        // Negative pid addresses the process group created by
        // CommandExt::process_group(0), never an unrelated process selected
        // by executable name.
        unsafe { kill(-process_id, signal) == 0 }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }

    #[test]
    fn status_name_maps_scheduled_to_status_two_queued() {
        assert_eq!(
            status_name(boreal_domain::DerivedStatus::Scheduled),
            "queued"
        );
        assert_eq!(status_name(boreal_domain::DerivedStatus::Ready), "ready");
        assert_eq!(
            status2_name(boreal_domain::DerivedStatus::ExpiredReview),
            "blocked"
        );
        assert_eq!(
            status_name(boreal_domain::DerivedStatus::ExpiredReview),
            "expired_review"
        );
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
    fn parser_supports_release_machine_update_alias() {
        let update = parse(&args(&["update", "--json"])).expect("update parses");
        assert_eq!(update.path, vec!["update"]);
        assert!(!update.options.machine);

        let upgrade =
            parse(&args(&["upgrade", "--machine", "--json"])).expect("machine upgrade parses");
        assert_eq!(upgrade.path, vec!["upgrade"]);
        assert!(upgrade.options.machine);
    }

    #[test]
    fn parser_supports_service_dispatch_bounds() {
        let parsed = parse(&args(&[
            "service",
            "run",
            "--db",
            "fixture.sqlite",
            "--socket",
            "fixture.sock",
            "--dispatch-workers",
            "1",
            "--dispatch-capacity",
            "2",
        ]))
        .expect("service dispatch bounds parse");
        assert_eq!(parsed.options.dispatch_workers, Some(1));
        assert_eq!(parsed.options.dispatch_capacity, Some(2));
    }

    #[test]
    fn parser_routes_workflow_and_registry_queries_without_project_context() {
        let workflow = parse(&args(&["workflows", "list", "--json"]))
            .expect("workflow discovery parses without a project");
        assert_eq!(workflow.path, vec!["workflows", "list"]);
        assert!(workflow.options.positionals.is_empty());

        let commands = parse(&args(&["commands", "workflows", "list", "--json"]))
            .expect("registry discovery parses without a project");
        assert_eq!(commands.path, vec!["commands", "workflows", "list"]);
        assert!(commands.options.positionals.is_empty());
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
    fn revision_alias_preserves_the_expected_revision_precondition() {
        let canonical = parse(&args(&[
            "intake",
            "bucket",
            "project-1",
            "bucket-1",
            "Inbox",
            "--expected-revision",
            "7",
        ]))
        .expect("canonical revision parses");
        let alias = parse(&args(&[
            "intake",
            "bucket",
            "project-1",
            "bucket-1",
            "Inbox",
            "--revision",
            "7",
        ]))
        .expect("revision alias parses");
        assert_eq!(
            alias.options.expected_revision,
            canonical.options.expected_revision
        );
        let duplicate = parse(&args(&[
            "intake",
            "bucket",
            "project-1",
            "bucket-1",
            "Inbox",
            "--revision",
            "7",
            "--expected-revision",
            "7",
        ]))
        .expect_err("duplicate revision spellings must not silently overwrite");
        assert_eq!(duplicate.code, ErrorCode::InvalidArgument);
    }

    #[test]
    fn evidence_execution_state_readback_uses_protocol_terminal_names() {
        assert_eq!(
            evidence_execution_state_name(EvidenceExecutionState::ReceiptCommitted),
            "receipt_committed"
        );
        assert_eq!(
            evidence_execution_state_name(EvidenceExecutionState::Admitted),
            "admitted"
        );
        assert_eq!(
            evidence_execution_state_name(EvidenceExecutionState::Unknown),
            "unknown"
        );
    }

    #[test]
    fn bounded_results_reserve_space_for_the_outer_envelope() {
        let near_bound = Value::String("x".repeat(
            // JSON string encoding contributes opening/closing quotes in
            // addition to the payload bytes.
            MAX_JSON_BYTES.saturating_sub(ENVELOPE_METADATA_BUDGET + 2),
        ));
        assert!(bounded_result(Some(near_bound), None).is_ok());
        let over_bound =
            Value::String("x".repeat(MAX_JSON_BYTES.saturating_sub(ENVELOPE_METADATA_BUDGET) + 1));
        let error = bounded_result(Some(over_bound), None)
            .expect_err("data must leave room for envelope metadata");
        assert_eq!(error.code, ErrorCode::InvalidArgument);
    }

    #[test]
    fn receipt_sidecar_failure_is_reported_without_erasing_durable_state() {
        let path = env::temp_dir().join(format!("boreal-cli-sidecar-dir-{}", now_ms_u64()));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).expect("sidecar conflict directory creates");
        let error = write_receipt_sidecar(&path, b"receipt")
            .expect_err("a directory target must not be treated as an exported receipt");
        assert!(!error.is_empty());
        let _ = fs::remove_dir_all(path);
    }

    #[test]
    fn parser_and_request_context_cover_dependency_and_planning_flags() {
        let dependency = parse(&args(&[
            "dep",
            "add",
            "project-1",
            "task-a",
            "task-b",
            "--expected-revision",
            "7",
        ]))
        .unwrap();
        assert_eq!(dependency.path, vec!["dep", "add"]);
        assert_eq!(dependency.options.project, None);
        assert_eq!(dependency.options.expected_revision, Some(7));
        assert_eq!(
            dependency.options.positionals,
            vec!["project-1", "task-a", "task-b"]
        );

        let create = parse(&args(&[
            "work",
            "create",
            "project-1",
            "task-a",
            "Task",
            "--dispatch",
            "operator_only",
            "--hold",
            "waiting-for-review",
        ]))
        .unwrap();
        assert_eq!(create.options.dispatch.as_deref(), Some("operator_only"));
        assert_eq!(create.options.hold.as_deref(), Some("waiting-for-review"));

        let tree = parse(&args(&["dep", "tree", "project-1"])).unwrap();
        assert_eq!(tree.path, vec!["dep", "tree"]);
        assert_eq!(tree.options.positionals, vec!["project-1"]);
        let cycle = parse(&args(&["dep", "cycles", "project-1"])).unwrap();
        assert_eq!(cycle.path, vec!["dep", "cycles"]);

        let board = parse(&args(&["cycle", "board", "project-1", "cycle-1"])).unwrap();
        assert_eq!(board.path, vec!["cycle", "board"]);
        assert_eq!(board.options.positionals, vec!["project-1", "cycle-1"]);

        let intake = parse(&args(&["intake", "show", "project-1", "intake-1"])).unwrap();
        assert_eq!(intake.path, vec!["intake", "show"]);
    }

    #[test]
    fn explicitly_selected_socket_rejects_direct_only_source_routes() {
        let error = run_with_operation(
            &args(&[
                "source",
                "show",
                "project-1",
                "source-1",
                "--socket",
                "/tmp/boreal-unavailable-route.sock",
            ]),
            "op_unavailable_route",
        )
        .expect_err("direct-only source route must fail closed");
        assert_eq!(error.code, ErrorCode::UnknownCommandNamespace);
        assert_eq!(error.outcome, ApplicationOutcome::Rejected);
        assert!(error
            .message
            .contains("not available through the selected service socket"));
    }

    #[test]
    fn v3_routes_are_unavailable_without_opening_or_mutating_a_v2_database() {
        let path = env::temp_dir().join(format!("boreal-cli-v3-gap-{}.sqlite", now_ms_u64()));
        let db = path.to_string_lossy().to_string();
        let _ = fs::remove_file(&path);

        let error = run(&args(&[
            "intake",
            "capture",
            "project-1",
            "intake-1",
            "observation",
            "--bucket",
            "inbox",
            "--db",
            &db,
            "--json",
        ]))
        .expect_err("v3 intake capture must be unavailable in v2");
        assert_eq!(error.code, ErrorCode::UnknownCommandNamespace);
        assert_eq!(error.outcome, ApplicationOutcome::Rejected);
        assert!(!path.exists(), "unavailable route opened a database");

        let _ = fs::remove_file(path);
    }

    #[test]
    fn shipped_post_init_routes_require_canonical_project_binding() {
        let path = env::temp_dir().join(format!(
            "boreal-cli-production-schema-route-{}.sqlite",
            now_ms_u64()
        ));
        let db = path.to_string_lossy().to_string();
        let _ = fs::remove_file(&path);

        run(&args(&["init", "production-route", "--db", &db]))
            .expect("bootstrap initialization succeeds");

        let store = SqliteStore::open(&path, PRODUCTION_SCHEMA)
            .expect("post-init route reopens through production schema");
        assert!(store.is_canonical_production());
        store
            .execute_batch(
                "DELETE FROM boreal_project_identity
                 WHERE project_id = 'production-route';",
            )
            .expect("fixture removes the workspace binding");
        drop(store);

        let error = run(&args(&[
            "work",
            "create",
            "production-route",
            "unbound-work",
            "Unbound work",
            "--db",
            &db,
        ]))
        .expect_err("canonical post-init route must reject an unbound project");
        assert_eq!(error.code, ErrorCode::ClaimConflict);
        assert!(error.message.contains("workspace identity binding"));

        let _ = fs::remove_file(path);
    }

    #[test]
    fn production_schema_bootstrap_binds_identity_before_project_init() {
        let path = env::temp_dir().join(format!(
            "boreal-cli-production-bootstrap-{}.sqlite",
            now_ms_u64()
        ));
        let _ = fs::remove_file(&path);
        let store = SqliteStore::open(&path, PRODUCTION_SCHEMA)
            .expect("production schema opens before bootstrap");
        let app = WorkApplication::new(&store);
        let binding = WorkspaceBinding::new(
            "/tmp/boreal-production-bootstrap",
            "/tmp/boreal-production-bootstrap",
            "sha256:production-bootstrap",
        )
        .expect("bootstrap binding is valid");

        let result = app
            .init_project_with_workspace(
                &ProjectId::new("production-bootstrap"),
                "agent-1",
                "agent",
                "cli",
                "CLI agent",
                &binding,
                "unix-ms:1",
                "op-production-bootstrap",
            )
            .expect("production bootstrap must bind identity before project.init");
        assert!(result.changed);
        let identity = IdentityStore::new(&store);
        assert_eq!(
            identity.workspace_binding("production-bootstrap").unwrap(),
            binding
        );
        let context = identity.context("production-bootstrap").unwrap();
        assert!(identity
            .operation(&context, "op-production-bootstrap")
            .unwrap()
            .is_some());
        let replay = app
            .init_project_with_workspace(
                &ProjectId::new("production-bootstrap"),
                "agent-1",
                "agent",
                "cli",
                "CLI agent",
                &binding,
                "unix-ms:2",
                "op-production-bootstrap",
            )
            .expect("identical bootstrap retries must read back");
        assert!(!replay.changed);

        let _ = fs::remove_file(path);
    }

    #[test]
    fn dependency_add_is_idempotent_and_cycle_failures_are_typed() {
        let path = env::temp_dir().join(format!("boreal-cli-dependency-{}.sqlite", now_ms_u64()));
        let db = path.to_string_lossy().to_string();
        let _ = fs::remove_file(&path);

        run(&args(&["init", "p", "--db", &db])).expect("project initializes");
        for work in [("a", "A"), ("b", "B")] {
            run(&args(&["work", "create", "p", work.0, work.1, "--db", &db]))
                .expect("work creates");
        }
        let stale_revision = run(&args(&[
            "dep",
            "add",
            "p",
            "a",
            "b",
            "--expected-revision",
            "2",
            "--db",
            &db,
        ]))
        .expect_err("stale dependency revision must be rejected");
        assert_eq!(stale_revision.code, ErrorCode::StaleRevision);
        assert_eq!(stale_revision.outcome, ApplicationOutcome::Conflict);
        let first = run(&args(&[
            "dep",
            "add",
            "p",
            "a",
            "b",
            "--operation-id",
            "op_dep_add",
            "--db",
            &db,
        ]))
        .expect("dependency adds");
        assert_eq!(first.outcome, ApplicationOutcome::Changed);
        let replay = run(&args(&[
            "dep",
            "add",
            "p",
            "a",
            "b",
            "--operation-id",
            "op_dep_add",
            "--db",
            &db,
        ]))
        .expect("dependency replays");
        assert_eq!(replay.outcome, ApplicationOutcome::Unchanged);
        assert_eq!(replay.data.as_ref().unwrap()["replayed"], true);

        let tree = run(&args(&["dep", "tree", "p", "--db", &db])).expect("dependency tree reads");
        assert_eq!(tree.outcome, ApplicationOutcome::Unchanged);
        assert_eq!(
            tree.data.as_ref().unwrap()["edges"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert_eq!(tree.data.as_ref().unwrap()["cycle_count"], 0);

        let cycles =
            run(&args(&["dep", "cycles", "p", "--db", &db])).expect("dependency cycles reads");
        assert_eq!(cycles.data.as_ref().unwrap()["cycle_count"], 0);

        let cycle = run(&args(&[
            "dep",
            "add",
            "p",
            "b",
            "a",
            "--operation-id",
            "op_dep_cycle",
            "--db",
            &db,
        ]))
        .expect_err("cycle rejects");
        assert_eq!(cycle.code, ErrorCode::DependencyCycle);
        assert_eq!(cycle.outcome, ApplicationOutcome::Rejected);
        let _ = fs::remove_file(path);
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
                ..CliResult::default()
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
                ..CliResult::default()
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
            ..CliResult::default()
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
            "agent-1",
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
        assert_eq!(result.outcome, ApplicationOutcome::Unchanged);
        let status = result.data.expect("status data");
        let items = status["items"].as_array().expect("status items");
        let container = items
            .iter()
            .find(|item| item["work_id"] == "container")
            .expect("container row");
        assert_eq!(container["kind"], "milestone");
        assert_eq!(container["display_status"], "queued");
        assert_eq!(container["claimable_for_actor"], false);
        let task = items
            .iter()
            .find(|item| item["work_id"] == "task")
            .expect("task row");
        assert_eq!(task["kind"], "task");
        assert_eq!(task["claimable_for_actor"], true);
        assert_eq!(task["actions"], Value::Null);
        assert_eq!(task["action_context"]["state"], "unavailable");

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
        let store = SqliteStore::open(&path, PRODUCTION_SCHEMA).expect("database reopens");
        assert!(store
            .session("p", "session-preflight")
            .expect("session read succeeds")
            .is_none());
        let _ = fs::remove_file(path);
    }

    fn finish_receipt_fixture() -> ReceiptPayload {
        ReceiptPayload {
            schema_version: "boreal.receipt.v1".to_owned(),
            receipt_id: ReceiptId::new("receipt-finish-digest"),
            operation_id: OperationId::new("receipt-operation-finish-digest"),
            work_id: WorkId::new("finish-work"),
            attempt_id: AttemptId::new("finish-attempt"),
            fence: Fence::new(3),
            gate_id: GateId::new("verification"),
            executable: "bwrk-check".to_owned(),
            argv: vec!["bwrk-check".to_owned(), "--strict".to_owned()],
            cwd: "/workspace".to_owned(),
            exit_code: 0,
            started_at: TimestampMs::from_millis(10),
            ended_at: TimestampMs::from_millis(11),
            source_snapshot_hash: SourceVersionId::new("source-finish-digest"),
            config_identity: ConfigIdentity::new("config-finish-digest"),
            environment_fingerprint: "env-finish-digest".to_owned(),
            output_digest: Some("sha256:output-finish-digest".to_owned()),
            output_ref: Some("artifacts/output.txt".to_owned()),
            coverage: ReceiptCoverage {
                kind: GateKind::Verification,
                profile_id: boreal_domain::ProfileId::new("focused"),
                profile_version: "7".to_owned(),
                observables: vec!["exit_status".to_owned(), "summary".to_owned()],
            },
            attestation: ExecutorAttestation::ExternalAttested,
            result: ReceiptResult::Passed,
        }
    }

    #[test]
    fn finish_close_digest_changes_for_each_proof_relevant_receipt_field() {
        let base = finish_receipt_fixture();
        let digest = |receipt: &ReceiptPayload| {
            finish_close_request_digest(
                &ProjectId::new("finish-project"),
                "finish-work",
                "finish-attempt",
                3,
                "actor-finish",
                "session-finish",
                Some(19),
                receipt,
                "finish summary",
            )
        };
        let expected = digest(&base);
        let mut variants = Vec::new();

        let mut value = base.clone();
        value.schema_version.push_str("-changed");
        variants.push(("schema_version", value));
        let mut value = base.clone();
        value.receipt_id = ReceiptId::new("receipt-finish-digest-2");
        variants.push(("receipt_id", value));
        let mut value = base.clone();
        value.operation_id = OperationId::new("receipt-operation-finish-digest-2");
        variants.push(("operation_id", value));
        let mut value = base.clone();
        value.work_id = WorkId::new("finish-work-2");
        variants.push(("work_id", value));
        let mut value = base.clone();
        value.attempt_id = AttemptId::new("finish-attempt-2");
        variants.push(("attempt_id", value));
        let mut value = base.clone();
        value.fence = Fence::new(4);
        variants.push(("fence", value));
        let mut value = base.clone();
        value.gate_id = GateId::new("checkpoint");
        variants.push(("gate_id", value));
        let mut value = base.clone();
        value.executable.push_str("-changed");
        variants.push(("executable", value));
        let mut value = base.clone();
        value.argv.push("--changed".to_owned());
        variants.push(("argv", value));
        let mut value = base.clone();
        value.cwd.push_str("/changed");
        variants.push(("cwd", value));
        let mut value = base.clone();
        value.exit_code = 1;
        variants.push(("exit_code", value));
        let mut value = base.clone();
        value.started_at = TimestampMs::from_millis(12);
        variants.push(("started_at", value));
        let mut value = base.clone();
        value.ended_at = TimestampMs::from_millis(13);
        variants.push(("ended_at", value));
        let mut value = base.clone();
        value.source_snapshot_hash = SourceVersionId::new("source-finish-digest-2");
        variants.push(("source_snapshot_hash", value));
        let mut value = base.clone();
        value.config_identity = ConfigIdentity::new("config-finish-digest-2");
        variants.push(("config_identity", value));
        let mut value = base.clone();
        value.environment_fingerprint.push_str("-changed");
        variants.push(("environment_fingerprint", value));
        let mut value = base.clone();
        value.output_digest = Some("sha256:output-finish-digest-2".to_owned());
        variants.push(("output_digest", value));
        let mut value = base.clone();
        value.output_ref = Some("artifacts/output-2.txt".to_owned());
        variants.push(("output_ref", value));
        let mut value = base.clone();
        value.coverage.kind = GateKind::Summary;
        variants.push(("coverage.kind", value));
        let mut value = base.clone();
        value.coverage.profile_id = boreal_domain::ProfileId::new("reviewed");
        variants.push(("coverage.profile_id", value));
        let mut value = base.clone();
        value.coverage.profile_version.push_str("-changed");
        variants.push(("coverage.profile_version", value));
        let mut value = base.clone();
        value.coverage.observables.push("new_observable".to_owned());
        variants.push(("coverage.observables", value));
        let mut value = base.clone();
        value.attestation = ExecutorAttestation::BorealWitnessed;
        variants.push(("attestation", value));
        let mut value = base;
        value.result = ReceiptResult::Failed;
        variants.push(("result", value));

        for (field, variant) in variants {
            assert_ne!(
                expected,
                digest(&variant),
                "receipt field {field} is not bound"
            );
        }
    }

    #[test]
    fn finish_close_result_readback_rejects_mismatched_result_identity() {
        let path = env::temp_dir().join(format!(
            "boreal-cli-finish-readback-{}.sqlite",
            now_ms_u64()
        ));
        let _ = fs::remove_file(&path);
        run(&args(&[
            "init",
            "finish-project",
            "--db",
            path.to_str().unwrap(),
        ]))
        .expect("project initializes");
        let store = SqliteStore::open(&path, PRODUCTION_SCHEMA).expect("database reopens");
        let identity = IdentityStore::new(&store)
            .context("finish-project")
            .expect("identity context opens");
        let app = WorkApplication::new(&store);
        let journal = app.authenticated_operation_journal(&identity);
        let parent_operation = "op-finish-readback";
        let result_operation = finish_result_operation_id(parent_operation);
        let parent_digest =
            canonical_request_digest("finish.close/v2", json!({"fixture": "finish-readback"}));
        let timestamp = stamp(1);
        journal
            .append(
                OperationRecord {
                    operation_id: parent_operation.to_owned(),
                    project_id: "finish-project".to_owned(),
                    command: "finish_close".to_owned(),
                    actor_id: DEFAULT_ACTOR.to_owned(),
                    session_id: None,
                    expected_revision: Some(19),
                    attempt_id: Some("finish-attempt".to_owned()),
                    fence: Some(3),
                    request_digest: parent_digest.clone(),
                    outcome: StoreOperationOutcome::Busy,
                    result_json: json!({"result_operation_id": result_operation}).to_string(),
                    revision: 0,
                    created_at: timestamp.clone(),
                    completed_at: None,
                },
                AuditEventRecord {
                    project_id: "finish-project".to_owned(),
                    revision: 0,
                    operation_id: parent_operation.to_owned(),
                    event_type: "close.requested".to_owned(),
                    subject_type: "attempt".to_owned(),
                    subject_id: "finish-attempt".to_owned(),
                    actor_id: DEFAULT_ACTOR.to_owned(),
                    session_id: None,
                    fence: Some(3),
                    as_of: timestamp.clone(),
                    payload_json: "{}".to_owned(),
                },
            )
            .expect("parent intent appends");
        let result_digest = canonical_request_digest(
            "finish.close.result/v1",
            json!({
                "parent_operation_id": parent_operation,
                "parent_request_digest": parent_digest,
            }),
        );
        journal
            .append(
                OperationRecord {
                    operation_id: result_operation.clone(),
                    project_id: "finish-project".to_owned(),
                    command: "finish_close.result".to_owned(),
                    actor_id: DEFAULT_ACTOR.to_owned(),
                    session_id: None,
                    expected_revision: Some(19),
                    attempt_id: Some("wrong-attempt".to_owned()),
                    fence: Some(3),
                    request_digest: result_digest,
                    outcome: StoreOperationOutcome::Rejected,
                    result_json: json!({
                        "parent_operation_id": parent_operation,
                        "parent_request_digest": parent_digest,
                        "close": {"close_state": "open"}
                    })
                    .to_string(),
                    revision: 0,
                    created_at: timestamp.clone(),
                    completed_at: Some(timestamp.clone()),
                },
                AuditEventRecord {
                    project_id: "finish-project".to_owned(),
                    revision: 0,
                    operation_id: result_operation.clone(),
                    event_type: "close.completed".to_owned(),
                    subject_type: "attempt".to_owned(),
                    subject_id: "finish-attempt".to_owned(),
                    actor_id: DEFAULT_ACTOR.to_owned(),
                    session_id: None,
                    fence: Some(3),
                    as_of: timestamp,
                    payload_json: "{}".to_owned(),
                },
            )
            .expect("mismatched result appends for corruption fixture");

        let error = finish_result_readback(&journal, parent_operation, &result_operation)
            .expect_err("mismatched result identity is rejected");
        assert_eq!(error.code, ErrorCode::ProtocolMismatch);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn finish_close_records_receipt_and_retains_open_gate_diagnostics() {
        let db_path = env::temp_dir().join(format!("boreal-cli-finish-{}.sqlite", now_ms_u64()));
        let receipt_path =
            env::temp_dir().join(format!("boreal-cli-receipt-{}.json", now_ms_u64()));
        let summary_path = env::temp_dir().join(format!("boreal-cli-summary-{}.md", now_ms_u64()));
        let db = db_path.to_string_lossy().to_string();
        let receipt_file = receipt_path.to_string_lossy().to_string();
        let summary_file = summary_path.to_string_lossy().to_string();
        let _ = fs::remove_file(&db_path);
        let _ = fs::remove_file(&receipt_path);
        let _ = fs::remove_file(&summary_path);

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
        SqliteStore::open(&db_path, PRODUCTION_SCHEMA)
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
        SqliteStore::open(&db_path, PRODUCTION_SCHEMA)
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
        fs::write(
            &summary_path,
            "Finish remains open pending the required checkpoint.",
        )
        .expect("summary writes");

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
            "--summary",
            &summary_file,
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
        assert!(!data["gates"]["missing"]
            .as_array()
            .expect("missing gate list")
            .iter()
            .any(|gate| gate.as_str().is_some_and(|id| id.ends_with(":summary"))));

        let _ = fs::remove_file(db_path);
        let _ = fs::remove_file(receipt_path);
        let _ = fs::remove_file(summary_path);
    }
}
