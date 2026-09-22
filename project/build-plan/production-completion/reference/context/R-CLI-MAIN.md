# R-CLI-MAIN — crates/cli/src/main.rs

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `crates/cli/src/main.rs:L1–L260`  
**File SHA-256:** `1cadfb35c2073e8f1bf2c6044b878bd5d289510afac80c8a9130439e66022829`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Public parser and machine/human output entry point; locate existing routes before creating new ones.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,260p' 'crates/cli/src/main.rs'
```

## Exact baseline excerpt

````text
    1 | use boreal_application::{
    2 |     canonical_request_digest, guide_checked, sha256_content_digest, AcceptanceGateDefinition,
    3 |     ApplicationError, AttemptPolicy, AttemptRequest, BoundedExecutionResult, CommandSpec,
    4 |     EndAttemptRequest, EvidenceExecutionOutcome, EvidenceRunRequest, ExecutorAttestation,
    5 |     IntakeBucket, IntakeBucketId, IntakeItem, IntakeItemId, IntakeKind, IntakeLifecycle,
    6 |     KnowledgeApplication, LivenessMetadata, OperationResult, ReceiptCoverage, ReceiptExpectation,
    7 |     ReceiptPayload, SessionRegistrationRequest, SourceCaptureInput, SqliteAttemptAdapter,
    8 |     SummaryPayload, WorkApplication,
    9 | };
   10 | use boreal_domain::{
   11 |     AcceptanceProfile, ActorId, AttemptId, AttemptPhase, ConfigIdentity, DispatchPolicy, Fence,
   12 |     GateId, GateKind, HarnessId, OperationId, PersistedLifecycle, ProjectId, ReasonCode, ReceiptId,
   13 |     ReceiptResult, SessionId, SourceVersionId, TimestampMs, WorkId, WorkItem, WorkKind,
   14 | };
   15 | use boreal_protocol::{
   16 |     models::{
   17 |         AgentGuideDto, AgentNextDto, ContextRefDto, GuidanceContextDto, GuidanceProvenanceDto,
   18 |         GuidanceStatusDto, NextActionDto, NextReasonDto, NextStatusDto, RequirementDto, SubjectDto,
   19 |     },
   20 |     schema, ApplicationOutcome, DetailReference, Envelope, ErrorCode, ProtocolError,
   21 |     TransportOutcome, API_VERSION,
   22 | };
   23 | use boreal_source::SourceCatalog;
   24 | use boreal_store::{
   25 |     AttemptRecord, EvidenceExecutionState, OperationOutcome as StoreOperationOutcome,
   26 |     OperationRecord, ReceiptAttestation, ReceiptOutcome, ReceiptRecord, SqliteStore, StoreError,
   27 |     WorkRecord,
   28 | };
   29 | use serde::Deserialize;
   30 | use serde_json::{json, Value};
   31 | use std::{
   32 |     env, fs,
   33 |     io::{Read, Write},
   34 |     path::{Path, PathBuf},
   35 |     process::{Child, Command, ExitCode, ExitStatus, Stdio},
   36 |     sync::{
   37 |         atomic::{AtomicBool, AtomicU64, Ordering},
   38 |         Arc,
   39 |     },
   40 |     thread,
   41 |     time::{Duration, Instant, SystemTime, UNIX_EPOCH},
   42 | };
   43 | 
   44 | #[cfg(unix)]
   45 | use std::os::unix::process::CommandExt;
   46 | 
   47 | mod command_registry;
   48 | mod dashboard;
   49 | mod service;
   50 | mod setup;
   51 | mod update;
   52 | 
   53 | const SCHEMA: &str = include_str!("../../../project/spec/schema-v2.sql");
   54 | const MAX_JSON_BYTES: usize = boreal_protocol::bounds::MAX_INLINE_OUTPUT_BYTES;
   55 | const ENVELOPE_METADATA_BUDGET: usize = 4096;
   56 | const DEFAULT_ACTOR: &str = "agent-1";
   57 | const DEFAULT_HARNESS: &str = "cli";
   58 | const DEFAULT_SESSION: &str = "session-cli";
   59 | const MAX_GATE_RUNTIME_MS: u64 = 30_000;
   60 | const GATE_COMMANDS_DIR: &str = "gates";
   61 | const MAX_SOURCE_INPUT_BYTES: u64 = 16 * 1024 * 1024;
   62 | static OPERATION_COUNTER: AtomicU64 = AtomicU64::new(0);
   63 | const HELP: &str = r#"bwrk v2
   64 | 
   65 | Usage:
   66 |   bwrk commands [PATH] [--json]
   67 |   bwrk help [PATH] [--json]
   68 |   bwrk version [--json]
   69 |   bwrk init [PROJECT] [--interactive|--yes] [--agents codex,claude] [--project-root PATH] [--db PATH] [--dry-run] [--json]
   70 |   bwrk setup [PROJECT] [--yes] [--agents codex,claude] [--project-root PATH] [--db PATH] [--dry-run] [--json]
   71 |   bwrk install [PROJECT] [--yes] [--agents codex,claude] [--project-root PATH] [--db PATH] [--dry-run] [--json]
   72 |   bwrk update [--json]
   73 |   bwrk upgrade --machine [--json]  (alias for update)
   74 |   bwrk service run --db PATH --socket PATH [--max-requests N] [--dispatch-workers N] [--dispatch-capacity N] [--json]
   75 |   bwrk status <project> [--limit N] [--offset N] [--socket PATH] [--db PATH] [--json]
   76 |   bwrk dashboard [PROJECT] [--project PROJECT] [--db PATH] [--actor ID] [--harness ID] [--session ID] [--json]
   77 |   bwrk work create <project> <work-id> <title> [--kind milestone|sprint|task] [--parent WORK_ID] [--priority N] [--description TEXT] [--dispatch automatic|operator_only|paused] [--hold CODE] [--db PATH] [--json]
   78 |   bwrk work edit <project> <work-id> [--title TEXT] [--description TEXT] [--parent WORK_ID] [--priority N] [--dispatch automatic|operator_only|paused] --expected-revision N
   79 |   bwrk dep remove <project> <prerequisite-id> <dependent-id> --expected-revision N
   80 |   bwrk work hold add <project> <work-id> --reason CODE --expected-revision N
   81 |   bwrk work hold resolve <project> <work-id> <hold-id> --reason TEXT --expected-revision N
   82 |   bwrk work dispatch set <project> <work-id> --dispatch automatic|operator_only|paused --expected-revision N
   83 |   bwrk dep add <project> <prerequisite-id> <dependent-id> [--expected-revision N] [--db PATH] [--json]
   84 |   bwrk dep tree <project> [--db PATH] [--json]
   85 |   bwrk dep cycles <project> [--db PATH] [--json]
   86 |   bwrk source add <project> --input PATH --origin ORIGIN [--media-type TYPE] [--db PATH] [--json]
   87 |   bwrk source show <project> <source-version-id> [--db PATH] [--json]
   88 |   bwrk source list <project> [--limit N] [--offset N] [--db PATH] [--json]
   89 |   bwrk source verify <project> <source-version-id> [--db PATH] [--json]
   90 |   bwrk doctor [--project PROJECT] [--db PATH] [--json]
   91 |   bwrk work list <project> [--limit N] [--offset N] [--db PATH] [--json]
   92 |   bwrk work show <project> <work-id> [--db PATH] [--json]
   93 |   bwrk work claim <project> <work-id> [--session SESSION_ID] [--lease-ttl DURATION] [--time-limit DURATION] [--socket PATH] [--db PATH] [--json]
   94 |   bwrk work accept <project> <work-id> --attempt ATTEMPT_ID --fence N [--socket PATH] [--db PATH] [--json]
   95 |   bwrk work heartbeat <project> <work-id> --attempt ATTEMPT_ID --fence N [--socket PATH] [--db PATH] [--json]
   96 |   bwrk work renew <project> <work-id> --attempt ATTEMPT_ID --fence N [--lease-ttl DURATION] [--socket PATH] [--db PATH] [--json]
   97 |   bwrk work release <project> <work-id> --attempt ATTEMPT_ID --fence N [--socket PATH] [--db PATH] [--json]
   98 |   bwrk work finish <project> <work-id> --attempt ATTEMPT_ID --fence N [--socket PATH] [--db PATH] [--json]
   99 |   bwrk agent guide [--project PROJECT] [--work WORK_ID] [--json]
  100 |   bwrk next [--project PROJECT] [--work WORK_ID] [--json]
  101 |   bwrk agent status [--project PROJECT] [--session SESSION_ID] [--json]
  102 |   bwrk agent start [WORK_ID] [--project PROJECT] [--session SESSION_ID] [--lease-ttl DURATION] [--time-limit DURATION] [--socket PATH] [--json]
  103 |   bwrk agent resume --project PROJECT --session SESSION_ID --attempt ATTEMPT_ID [--json]
  104 |   bwrk agent heartbeat --project PROJECT --work WORK_ID --attempt ATTEMPT_ID --fence N [--socket PATH] [--json]
  105 |   bwrk agent renew --project PROJECT --work WORK_ID --attempt ATTEMPT_ID --fence N [--lease-ttl DURATION] [--socket PATH] [--json]
  106 |   bwrk agent release WORK_ID --project PROJECT --attempt ATTEMPT_ID --fence N [--socket PATH] [--reason CODE] [--json]
  107 |   bwrk agent finish WORK_ID --close --project PROJECT --attempt ATTEMPT_ID --fence N --receipt PATH --summary PATH [--socket PATH] [--json]
  108 |   bwrk agent finish WORK_ID --release --project PROJECT --attempt ATTEMPT_ID --fence N [--socket PATH] [--reason CODE] [--json]
  109 |   bwrk evidence run --project PROJECT --work WORK_ID --gate GATE_ID [--attempt ATTEMPT_ID --fence N] [--json]
  110 |   bwrk evidence add --project PROJECT --work WORK_ID --gate GATE_ID --receipt PATH [--json]
  111 |   bwrk session start --project PROJECT --session SESSION_ID --harness HARNESS_ID [--json]
  112 |   bwrk session show --project PROJECT --session SESSION_ID [--json]
  113 |   bwrk session end --project PROJECT --session SESSION_ID [--expected-revision N] [--json]
  114 |   bwrk operation show PROJECT OPERATION_ID [--socket PATH] [--json]"#;
  115 | 
  116 | #[derive(Clone, Debug, Eq, PartialEq)]
  117 | struct CliOptions {
  118 |     db: String,
  119 |     socket: Option<String>,
  120 |     project: Option<String>,
  121 |     actor: String,
  122 |     actor_role: Option<String>,
  123 |     harness: String,
  124 |     session: String,
  125 |     operation_id: Option<String>,
  126 |     expected_revision: Option<u64>,
  127 |     attempt: Option<String>,
  128 |     fence: Option<u64>,
  129 |     work: Option<String>,
  130 |     gate: Option<String>,
  131 |     receipt: Option<String>,
  132 |     summary: Option<String>,
  133 |     reason: Option<String>,
  134 |     lease_ttl_ms: Option<u64>,
  135 |     time_limit_ms: Option<u64>,
  136 |     json: bool,
  137 |     close: bool,
  138 |     release: bool,
  139 |     machine: bool,
  140 |     include_expiry: bool,
  141 |     limit: Option<u64>,
  142 |     offset: Option<u64>,
  143 |     max_requests: Option<usize>,
  144 |     dispatch_workers: Option<usize>,
  145 |     dispatch_capacity: Option<usize>,
  146 |     kind: Option<String>,
  147 |     parent: Option<String>,
  148 |     description: Option<String>,
  149 |     title: Option<String>,
  150 |     priority: Option<u8>,
  151 |     dispatch: Option<String>,
  152 |     hold: Option<String>,
  153 |     bucket: Option<String>,
  154 |     input: Option<String>,
  155 |     origin: Option<String>,
  156 |     media_type: Option<String>,
  157 |     source_version: Option<String>,
  158 |     config_identity: Option<String>,
  159 |     setup: SetupCliOptions,
  160 |     positionals: Vec<String>,
  161 | }
  162 | 
  163 | #[derive(Clone, Debug, Default, Eq, PartialEq)]
  164 | struct SetupCliOptions {
  165 |     interactive: bool,
  166 |     yes: bool,
  167 |     dry_run: bool,
  168 |     agents: Option<String>,
  169 |     project_root: Option<String>,
  170 |     memory_layout: Option<String>,
  171 |     install_root: Option<String>,
  172 | }
  173 | 
  174 | impl Default for CliOptions {
  175 |     fn default() -> Self {
  176 |         Self {
  177 |             db: ".boreal/boreal.sqlite".to_owned(),
  178 |             socket: None,
  179 |             project: None,
  180 |             actor: DEFAULT_ACTOR.to_owned(),
  181 |             actor_role: None,
  182 |             harness: DEFAULT_HARNESS.to_owned(),
  183 |             session: DEFAULT_SESSION.to_owned(),
  184 |             operation_id: None,
  185 |             expected_revision: None,
  186 |             attempt: None,
  187 |             fence: None,
  188 |             work: None,
  189 |             gate: None,
  190 |             receipt: None,
  191 |             summary: None,
  192 |             reason: None,
  193 |             lease_ttl_ms: None,
  194 |             time_limit_ms: None,
  195 |             json: false,
  196 |             close: false,
  197 |             release: false,
  198 |             machine: false,
  199 |             include_expiry: false,
  200 |             limit: None,
  201 |             offset: None,
  202 |             max_requests: None,
  203 |             dispatch_workers: None,
  204 |             dispatch_capacity: None,
  205 |             kind: None,
  206 |             parent: None,
  207 |             description: None,
  208 |             title: None,
  209 |             priority: None,
  210 |             dispatch: None,
  211 |             hold: None,
  212 |             bucket: None,
  213 |             input: None,
  214 |             origin: None,
  215 |             media_type: None,
  216 |             source_version: None,
  217 |             config_identity: None,
  218 |             setup: SetupCliOptions::default(),
  219 |             positionals: Vec::new(),
  220 |         }
  221 |     }
  222 | }
  223 | 
  224 | #[derive(Clone, Debug, Eq, PartialEq)]
  225 | struct ParsedCommand {
  226 |     path: Vec<String>,
  227 |     options: CliOptions,
  228 | }
  229 | 
  230 | #[derive(Clone, Debug)]
  231 | struct CliError {
  232 |     code: ErrorCode,
  233 |     outcome: ApplicationOutcome,
  234 |     message: String,
  235 |     exit: u8,
  236 |     transport: TransportOutcome,
  237 |     as_of: Option<String>,
  238 |     next_status_change_at: Option<String>,
  239 |     detail_ref: Option<DetailReference>,
  240 |     protocol_error: Option<ProtocolError>,
  241 | }
  242 | 
  243 | impl CliError {
  244 |     fn invalid(message: impl Into<String>) -> Self {
  245 |         Self::with(
  246 |             ErrorCode::InvalidArgument,
  247 |             ApplicationOutcome::Rejected,
  248 |             message,
  249 |         )
  250 |     }
  251 | 
  252 |     fn with(code: ErrorCode, outcome: ApplicationOutcome, message: impl Into<String>) -> Self {
  253 |         Self {
  254 |             code,
  255 |             outcome,
  256 |             message: message.into(),
  257 |             exit: exit_code(code),
  258 |             transport: TransportOutcome::Ok,
  259 |             as_of: None,
  260 |             next_status_change_at: None,
````
