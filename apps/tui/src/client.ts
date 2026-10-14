/**
 * Dependency-free client/view-model boundary for the Boreal v2 TUI.
 *
 * This module deliberately knows nothing about SQLite, terminals, or process
 * execution. A mounted controller can only observe and mutate state through
 * the injected versioned service API below.
 */

export const API_VERSION = "2";
export const ENVELOPE_SCHEMA = "boreal.protocol.envelope.v1";
export const STATUS_SCHEMA = "boreal.status.v1";
export const LIST_SCHEMA = "boreal.list.v1";
export const MAX_INLINE_ITEMS = 100;
export const FRAME_HEADER_BYTES = 4;
export const DEFAULT_MAX_PAYLOAD_BYTES = 64 * 1024;

export type ApplicationOutcome =
  | "changed" | "unchanged" | "rejected" | "conflict" | "busy" | "failed" | "unknown";

export type TransportOutcome = "ok" | "error";

export interface DetailReference {
  uri?: string;
  digest?: string;
  size_bytes?: number;
  expires_at?: string;
}

export interface ProtocolError {
  code: string;
  message: string;
  retryable?: boolean;
  retry_after_ms?: number;
  queue_depth?: number;
  operation_preserved?: boolean;
  expected_revision?: number;
  observed_revision?: number;
  provided_attempt_id?: string;
  provided_fence?: number;
  operation_id?: string;
  readback_required?: boolean;
  service_state?: string;
  recovery?: RecoveryMetadata;
  timing?: TimingMetadata;
  fields?: Array<{ path: string; reason_code: string; expected: string; received: unknown }>;
}

/** Optional structured service timing retained for monitoring and recovery UI. */
export interface TimingMetadata {
  admitted_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  elapsed_ms?: number | null;
  queue_wait_ms?: number | null;
  [key: string]: unknown;
}

/** Optional structured recovery details; the TUI does not reinterpret policy. */
export interface RecoveryMetadata {
  action?: string;
  safe_argv?: string[];
  readback_required?: boolean;
  [key: string]: unknown;
}

export interface Envelope<T> {
  api_version: string;
  schema_version: string;
  operation_id: string;
  revision: number | null;
  as_of: string;
  next_status_change_at?: string | null;
  transport: TransportOutcome;
  outcome: ApplicationOutcome;
  data: T | null;
  detail_ref?: DetailReference | null;
  error: ProtocolError | null;
  timing?: TimingMetadata;
  recovery?: RecoveryMetadata;
}

export interface RequestEnvelope<T> {
  api_version: string;
  schema_version: string;
  operation_id: string;
  expected_revision: number | null;
  attempt_id: string | null;
  attempt_fence: number | null;
  data: T;
}

export type WorkStatus =
  | "draft" | "queued" | "ready" | "claimed" | "in_progress"
  | "needs_verification" | "awaiting_review" | "complete" | "closed"
  | "blocked" | "paused" | "retry_wait" | "expired_review" | "cancelled"
  | string;

export interface GateItem {
  gate_id: string;
  kind: string;
  required: boolean;
  state: string;
  reason?: string | null;
  receipt_id?: string | null;
}

export interface AttemptSummary {
  attempt_id: string;
  fence: number;
  phase?: string;
  actor_id?: string | null;
  session_id?: string | null;
  harness_id?: string | null;
  lease_deadline?: string | null;
  hard_deadline?: string | null;
}

export interface DependencySummary {
  work_id: string;
  relation?: string;
  status?: WorkStatus;
  satisfied?: boolean;
}

export interface ActivitySummary {
  event_id?: string;
  kind: string;
  occurred_at?: string;
  actor_id?: string | null;
  summary?: string;
}

/** Server-owned action context for one status snapshot. */
export interface ServerActionDescriptor {
  action: string;
  target: { project_id: string; work_id: string; entity_revision: number | null };
  expected_project_revision: number;
  expected_entity_revision: number | null;
  expected_proof_revision?: number | null;
  attempt?: { attempt_id: string; fence: number } | null;
  required_roles: string[];
  required_inputs: string[];
  confirmation?: string | null;
  read_only: boolean;
  recovery: boolean;
}

export interface ServerDeniedAction {
  descriptor: ServerActionDescriptor;
  reason: { code: string; detail?: string };
  reason_code?: string;
  recovery: string[];
}

export interface ServerActionSet {
  allowed: ServerActionDescriptor[];
  denied: ServerDeniedAction[];
}

export interface StatusActionContext {
  state: string;
  missing_facts?: string[];
  entity_revision?: number | null;
  proof_revision?: number | null;
  authenticated_session_id?: string | null;
  integrity?: string;
}

export interface StatusItem {
  work_id: string;
  project_id?: string;
  /** `status` is retained for the original groundwork; service DTOs may use `display_status`. */
  status: WorkStatus;
  reason_codes: string[];
  /** Authoritative primary reason, not a client-side sort or policy choice. */
  primary_reason?: string;
  claimable: boolean;
  next_action: string | null;
  next_status_change_at?: string | null;
  display_status?: WorkStatus;
  claimable_for_actor?: boolean;
  title?: string;
  kind?: WorkKind | string;
  parent_id?: string | null;
  execution_mode?: ExecutionMode | null;
  planning_parent_id?: string | null;
  planning_integrity?: PlanningIntegrity;
  planning_diagnostic?: string | null;
  description?: string;
  priority?: number;
  dispatch_policy?: DispatchPolicy | string;
  due_at?: string | null;
  /** Civil-time classification supplied by Rust's canonical status decision. */
  due_today?: boolean;
  overdue?: boolean;
  /** Open waits supplied by the same canonical status decision. */
  blocking_external_wait_ids?: string[];
  follow_up_due_wait_ids?: string[];
  dependencies?: DependencySummary[];
  activity?: ActivitySummary[];
  gates?: { open: GateItem[]; satisfied: GateItem[] };
  attempt?: AttemptSummary | null;
  lifecycle?: WorkStatus;
  receipt?: unknown;
  receipt_id?: string | null;
  diagnostic?: StatusDiagnostic;
  /** Present on current service responses; absent is the legacy compatibility path. */
  actions?: ServerActionSet;
  /** Explicitly describes why the legacy row has no server action set. */
  action_context?: StatusActionContext;
}

export interface StatusDiagnostic {
  work_id: string;
  title?: string | null;
  code: string;
  detail: string;
}

export interface MonitoringCounts {
  matched: number;
  queued: number;
  ready: number;
  blocked: number;
  in_progress: number;
  expired_review: number;
  closed: number;
  [key: string]: number;
}

export interface ProjectPlanningAction {
  action: string;
  target: { project_id: string };
  caller: { actor_id: string; session_id: string | null };
  expected_project_revision: number;
  allowed: boolean;
  denial_reason: string | null;
  confirmation: string;
}

export interface RevisionedStatusResponse {
  project_actions?: ProjectPlanningAction[];
  /** Service read-model revision. The envelope revision is authoritative when both exist. */
  revision?: number;
  total?: number;
  items: StatusItem[];
  diagnostics?: StatusDiagnostic[];
  counts?: Partial<MonitoringCounts>;
  attention_queues?: unknown;
  as_of?: string;
  project_id?: string;
  project_name?: string;
  active_cycle_id?: string | null;
  active_sprint_id?: string | null;
  contract_version?: string;
  limit?: number;
  offset?: number;
  has_more?: boolean;
  next_offset?: number | null;
  next_status_change_at?: string | null;
  timing?: TimingMetadata;
  recovery?: RecoveryMetadata;
}

export interface MonitoringModel {
  project_actions?: ProjectPlanningAction[];
  revision: number;
  as_of: string;
  next_status_change_at: string | null;
  total: number;
  counts: MonitoringCounts;
  items: StatusItem[];
  attention_queues?: AttentionQueuesModel;
  diagnostics: StatusDiagnostic[];
  truncated: boolean;
  project_id?: string;
  project_name?: string;
  active_cycle_id?: string | null;
  active_sprint_id?: string | null;
  contract_version?: string;
  limit: number;
  offset: number;
  has_more: boolean;
  next_offset: number | null;
  timing?: TimingMetadata;
  recovery?: RecoveryMetadata;
}

export interface AttentionQueueModel {
  total: number;
  has_more: boolean;
  items: StatusItem[];
}

export interface AttentionQueuesModel {
  review: AttentionQueueModel;
  rejected_review: AttentionQueueModel;
  expiry: AttentionQueueModel;
  failed_execution: AttentionQueueModel;
  operator_holds: AttentionQueueModel;
  damaged_planning: AttentionQueueModel;
}

/** Backwards-compatible name for the original status groundwork. */
export type StatusView = MonitoringModel;

export interface StatusReader {
  readStatus(options?: StatusReadOptions): Promise<Envelope<RevisionedStatusResponse>>;
}

/**
 * The runtime-specific half of the local service connection.
 *
 * Implementations provide one complete request/response round trip. The
 * byte arrays include Boreal's four-byte big-endian length prefix, so a Node
 * Unix-socket adapter can be kept outside this dependency-free package (and
 * browser/test transports can use the same seam).
 */
export interface FramedTransport {
  roundTrip(request: Uint8Array): Promise<Uint8Array>;
  close?(): void | Promise<void>;
}

export interface ServiceClientConfig {
  credential_ref?: string;
  max_payload_bytes?: number;
  project_id?: string;
  actor_id?: string;
  harness_id?: string;
  session_id?: string;
  notifications?: RefreshNotificationSource;
}

export interface RefreshNotification {
  kind: "revision" | "deadline";
  revision?: number;
  next_status_change_at?: string | null;
}

/** Optional push seam. The Unix request/response transport does not provide it yet. */
export interface RefreshNotificationSource {
  subscribe(listener: (notification: RefreshNotification) => void): () => void;
}

export interface StatusReadOptions {
  /** Last fully applied revision. `null` requests a complete resnapshot. */
  cursor_revision?: number | null;
  project_id?: string;
  limit?: number;
  offset?: number;
  /** Optional exact-record selector; supported only by service adapters that expose it. */
  work_id?: string;
}

export class TuiTransportError extends Error {
  readonly kind = "transport_error";

  constructor(readonly operation_id: string, message: string, readonly cause?: unknown) {
    super(message);
    this.name = "TuiTransportError";
  }
}

export type WorkKind = "milestone" | "sprint" | "task";
export type DispatchPolicy = "automatic" | "operator_only" | "paused";
export type ExecutionMode = "direct" | "container";
export type PlanningIntegrity = "valid" | "missing" | "inconsistent" | "unavailable" | "unreadable" | "legacy";

export interface AcceptanceProfileInput {
  id: string;
  version: string;
}

export interface CreateProjectInput {
  project_id: string;
  actor_id: string;
  actor_role: string;
  credential_ref: string;
  display_name: string;
}

export interface CreateWorkInput {
  project_id: string;
  work_id: string;
  actor_id: string;
  kind: WorkKind;
  title: string;
  parent_id: string | null;
  description: string;
  priority: number;
  dispatch_policy: DispatchPolicy;
  hard_holds: string[];
  acceptance_profile: AcceptanceProfileInput;
  execution_mode?: ExecutionMode;
}

interface CreateProjectWireInput {
  project_id: string;
  actor_id: string;
  actor_role: string;
  credential_ref: string;
  name: string;
}

interface CreateWorkWireInput {
  project_id: string;
  work_id: string;
  actor_id: string;
  kind: WorkKind;
  title: string;
  parent_id: string | null;
  description: string;
  priority: number;
  dispatch: DispatchPolicy;
  profile: string;
  profile_version: string;
  execution_mode?: ExecutionMode;
}

export interface CreateProjectDraftInput {
  project_id: string;
  actor_role?: string;
  credential_ref?: string;
  display_name?: string;
}

export interface CreateWorkDraftInput {
  work_id: string;
  kind: WorkKind;
  title: string;
  parent_id?: string | null;
  description?: string;
  priority?: number;
  dispatch_policy?: DispatchPolicy;
  hard_holds?: string[];
  acceptance_profile?: AcceptanceProfileInput;
  execution_mode?: ExecutionMode;
}

export interface ClaimInput {
  project_id: string;
  work_id: string;
  source_version_id: string;
  config_identity: string;
  actor_id: string;
  harness_id: string;
  session_id: string;
  attempt_id: string;
  claimed_at: string;
  lease_deadline: string;
  hard_deadline: string;
}

export interface ClaimExecutionContext {
  /** Exact immutable source version registered for the mounted project. */
  source_version_id: string;
  /** Meaningful identity of the execution configuration; never a secret. */
  config_identity: string;
}

export interface AcceptStartInput {
  project_id: string;
  work_id: string;
  attempt_id: string;
  fence: number;
  actor_id: string;
  harness_id: string;
  session_id: string;
}

export interface EvidenceInput {
  project_id: string;
  work_id: string;
  attempt_id: string;
  fence: number;
  actor_id: string;
  harness_id: string;
  session_id: string;
  receipt: unknown;
}

export interface FinishInput {
  project_id: string;
  work_id: string;
  attempt_id: string;
  fence: number;
  actor_id: string;
  harness_id: string;
  session_id: string;
  close?: boolean;
  summary?: string;
  receipt: unknown;
}

interface FinishWireInput extends Omit<FinishInput, "summary"> {
  summary_body: string;
}

export interface ReleaseInput {
  project_id: string;
  work_id: string;
  attempt_id: string;
  fence: number;
  actor_id: string;
  harness_id: string;
  session_id: string;
  reason?: string;
}

export interface OperationReadback {
  operation?: Record<string, unknown> | null;
  execution?: Record<string, unknown> | null;
  readback_required?: boolean;
  timing?: TimingMetadata;
  recovery?: RecoveryMetadata;
}

export interface AttemptReceiptRecord {
  receipt_id: string;
  work_id: string;
  attempt_id: string;
  fence: number;
  project_id: string;
  operation_id: string;
  gate_id: string | null;
  executable: string;
  argv_json: string;
  cwd: string;
  exit_code: number;
  started_at: string;
  ended_at: string;
  source_version_id: string | null;
  config_identity: string;
  environment_fingerprint: string;
  output_digest: string | null;
  output_ref: string | null;
  subject_json: string;
  coverage_json: string;
  attestation: "boreal_witnessed" | "external_attested" | "self_reported" | "unknown";
  result: "passed" | "failed" | "rejected" | "unknown" | "stale";
  rejection_code: string | null;
  created_at: string;
  /** Rust's receipt_record_json projection, null when durable data is malformed. */
  receipt_payload?: unknown | null;
  receipt_payload_diagnostic?: string | null;
}

export interface AttemptReceiptPage {
  project_id: string;
  work_id: string;
  attempt_id: string;
  fence: number;
  items: AttemptReceiptRecord[];
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface FinalResultBinding {
  binding_id: string;
  project_id: string;
  work_id: string;
  attempt_id: string;
  fence: number;
  source_version_id: string;
  content_digest: string;
  config_identity: string;
  profile_id: string;
  profile_version: number;
  profile_digest: string;
  entity_revision: number;
  prior_proof_revision: number;
  proof_revision: number;
  operation_id: string;
  request_digest: string;
  project_revision: number;
  created_at: string;
  lineage_pending: string | null;
  replayed: boolean;
}

export interface BindFinalResultInput {
  project_id: string;
  actor_id: string;
  session_id: string;
  work_id: string;
  attempt_id: string;
  fence: number;
  source_version_id: string;
  content_digest: string;
  expected_revision: number;
  expected_entity_revision: number;
  expected_proof_revision: number;
}

/** Legacy mock/adapter shape retained for source compatibility; never used for finish eligibility. */
export interface ReceiptReadback {
  project_id?: string;
  work_id: string;
  attempt_id: string;
  fence: number;
  receipt: unknown;
  receipt_id?: string;
  timing?: TimingMetadata;
  recovery?: RecoveryMetadata;
}

export interface WorkEditInput {
  project_id: string;
  work_id: string;
  expected_revision: number;
  title?: string;
  description?: string;
  priority?: number;
  dispatch_policy?: DispatchPolicy;
  execution_mode?: ExecutionMode;
  /** A string moves the work item; omission leaves its parent unchanged. */
  parent_id?: string;
  /** Explicitly clears the canonical parent; parent_id and clear_parent are exclusive. */
  clear_parent?: boolean;
}

/** Exact typed projection returned by the public work_show service route. */
export interface WorkProjection {
  project_id: string;
  work_id: string;
  kind: WorkKind | string;
  parent_id: string | null;
  lifecycle: string;
  dispatch_policy: DispatchPolicy | string;
  priority: number;
  hard_holds: string[];
  title: string;
  description: string;
  /** Null means legacy work has no projected v3 decomposition node. */
  execution_mode?: ExecutionMode | null;
  /** The v3 hierarchy edge (for example, a Task's projected Milestone parent). */
  planning_parent_id?: string | null;
  /** Rust-owned assessment of the projected decomposition row and parent chain. */
  planning_integrity?: PlanningIntegrity;
  planning_diagnostic?: string | null;
}

export type BusinessDateDto =
  | { kind: "instant"; at_ms: number }
  | { kind: "local_date"; year: number; month: number; day: number }
  | { kind: "resolved_local"; nominal_local: LocalDateTimeInput; utc_instant_ms: number; utc_offset_minutes: number; timezone: string; tzdb_identity: string; gap_policy: "next_valid"; fold_policy: "earlier_offset" | "later_offset" };

export interface BusinessScheduleDto {
  not_before: BusinessDateDto | null;
  due: BusinessDateDto | null;
  planned_start: BusinessDateDto | null;
  planned_end: BusinessDateDto | null;
}

export interface WorkScheduleReadbackDto {
  schema_version: "boreal.work_schedule_readback.v1";
  project_revision: number;
  work_id: string;
  schedule_revision: number;
  schedule: BusinessScheduleDto | null;
  legacy_due_at: string | null;
}

export interface WorkScheduleMutationReadbackDto {
  schema_version: "boreal.work_schedule_readback.v1";
  operation_id: string;
  replayed: boolean;
  project_revision: number;
  work_id: string;
  schedule_revision: number;
  schedule: BusinessScheduleDto;
}

export type ExternalWaitCategoryDto = "decision" | "approval" | "information" | "access" | "service" | "other";
export type ExternalWaitStateDto = "open" | "resolved" | "cancelled";
export type ExternalWaitOutcomeDto = "approved" | "rejected" | "decision_provided" | "output_provided" | "declined" | "unavailable" | "cancelled";
export type ExternalWaitRoleDto = "agent" | "operator" | "reviewer" | "publisher";
export type ExternalWaitAccountableDto =
  | { kind: "person"; reference: string; display_name: string }
  | { kind: "role"; role: ExternalWaitRoleDto }
  | { kind: "service"; reference: string; display_name: string };

export interface ExternalWaitResolutionDto {
  outcome: ExternalWaitOutcomeDto;
  detail: string;
  output_ref: string | null;
  supplied_by: ExternalWaitAccountableDto;
  recorded_by: string;
  recorded_as: ExternalWaitRoleDto;
  recorded_at_ms: number;
}

export interface ExternalWaitDto {
  wait_id: string;
  source_work_id: string;
  affected_work_ids: string[];
  category: ExternalWaitCategoryDto;
  reason: string;
  accountable: ExternalWaitAccountableDto;
  expected_decision: string | null;
  expected_output: string | null;
  follow_up: BusinessDateDto | null;
  civil_time_setting_revision: number | null;
  wait_revision: number;
  state: ExternalWaitStateDto;
  created_by: string;
  created_at_ms: number;
  resolution: ExternalWaitResolutionDto | null;
}

export interface ExternalWaitReadbackDto {
  schema_version: "boreal.external_wait_readback.v1";
  project_revision: number;
  waits: ExternalWaitDto[];
}

export interface ExternalWaitMutationReadbackDto {
  schema_version: "boreal.external_wait_readback.v1";
  operation_id: string;
  replayed: boolean;
  project_revision: number;
  wait: ExternalWaitDto;
}

export interface WorkScheduleUpdateDto {
  schema_version: "boreal.work_schedule_update.v1";
  expected_project_revision: number;
  expected_schedule_revision: number;
  schedule: BusinessScheduleDto;
}

export interface ExternalWaitCreateDto {
  schema_version: "boreal.external_wait_create.v1";
  expected_project_revision: number;
  expected_wait_revision: 0;
  wait_id: string;
  source_work_id: string;
  affected_work_ids: string[];
  category: ExternalWaitCategoryDto;
  reason: string;
  accountable: ExternalWaitAccountableDto;
  expected_decision: string | null;
  expected_output: string | null;
  follow_up: BusinessDateDto | null;
}

export interface ExternalWaitResolveDto {
  schema_version: "boreal.external_wait_resolve.v1";
  expected_project_revision: number;
  expected_wait_revision: number;
  wait_id: string;
  next_state: "resolved" | "cancelled";
  outcome: ExternalWaitOutcomeDto;
  detail: string;
  output_ref: string | null;
  supplied_by: ExternalWaitAccountableDto;
}

export interface ProjectCivilTimeReadbackDto {
  schema_version: "boreal.project_civil_time_readback.v1";
  project_revision: number;
  setting: { setting_revision: number; timezone: string; tzdb_identity: string; changed_by: string; changed_at_ms: number } | null;
}

export interface DependencyChangeInput {
  project_id: string;
  prerequisite_id: string;
  dependent_id: string;
  expected_revision: number;
}

export interface LocalDateTimeInput {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second?: number;
}

/** Existing Rust CycleOperationDto, kept as a discriminated union. */
export type CycleChange =
  | { kind: "create"; cycle_id: string; name: string; goal: string; timezone: string; start: LocalDateTimeInput; end: LocalDateTimeInput | null; later_fold?: boolean }
  | { kind: "activate" | "close" | "cancel"; cycle_id: string }
  | { kind: "assign"; cycle_id: string; assignment_id: string; work_id: string }
  | { kind: "commit" | "remove"; cycle_id: string; assignment_id: string }
  | { kind: "carry_over"; cycle_id: string; assignment_id: string; successor_cycle_id: string; successor_assignment_id: string }
  | { kind: "map_legacy"; cycle_id: string; work_id: string };

export interface CycleCommandInput {
  expected_revision: number;
  reason: string;
  confirmed: true;
  change: CycleChange;
}

export type CycleReadView = "list" | "current" | "board" | "report";

export interface SourceListReadback {
  project_id: string;
  items: Array<{
    project_id: string;
    source_version_id: string;
    origin: string;
    media_type: string;
    byte_count: number;
    content_digest: string;
    availability: string;
    parser_identity?: string | null;
  }>;
  total: number;
  offset: number;
  limit: number;
  has_more: boolean;
  catalog_root: string;
}

export type MemoryCitationInput = { source_version_id: string; location: string };
export type MemoryOperationInput =
  | { kind: "draft"; draft_id: string; entry_id: string; title: string; body: string; citations: MemoryCitationInput[] }
  | { kind: "review"; draft_id: string; decision: string; reason: string }
  | { kind: "publish"; review_id: string; expected_manifest_identity: string }
  | { kind: "show"; draft_id: string }
  | { kind: "search"; text: string | null; entry_id: string | null; source_version_id: string | null; requested_git_revision: string | null; limit: number | null }
  | { kind: "readback" | "reconcile"; operation_id: string };
export interface MemoryCommandInput {
  expected_revision: number | null;
  confirmed: boolean;
  change: MemoryOperationInput;
}

export type RecoveryCommandInput =
  | { action: "list"; limit: number; after_id?: string }
  | { action: "resolve"; obligation_id: string; resolution_id: string; outcome: string; reason: string; resource_state: string; expected_revision: number; confirmed: true }
  | { action: "recover"; descriptor: ServerActionDescriptor; disposition: "adapter_acknowledged" | "reviewed_safe_recovery"; expected_revision: number; confirmed: true };

export interface CompletionCommandInput {
  kind: string;
  work_id: string;
  expected_revision: number;
  expected_entity_revision: number;
  expected_proof_revision: number;
  submission_id?: string | null;
  target_id?: string | null;
  predecessor_revision?: number | null;
  exception_reason?: string | null;
  reason: string;
  expires_at_ms?: number | null;
  confirmed: boolean;
}

export type WorkspaceAction =
  | "work_edit" | "dependency_add" | "dependency_remove" | "cycle_change"
  | "memory_command" | "recovery_command" | "completion" | "session_end" | "bind_final_result"
  | "source_add" | "work_schedule_update" | "external_wait_create" | "external_wait_resolve";
export type MutationAction = TuiAction | WorkspaceAction;

export interface VersionedServiceApi extends StatusReader {
  readonly notifications?: RefreshNotificationSource;
  createProject(request: RequestEnvelope<CreateProjectInput>): Promise<Envelope<unknown>>;
  createWork(request: RequestEnvelope<CreateWorkInput>): Promise<Envelope<unknown>>;
  claim(request: RequestEnvelope<ClaimInput>): Promise<Envelope<unknown>>;
  acceptStart(request: RequestEnvelope<AcceptStartInput>): Promise<Envelope<unknown>>;
  addEvidence(request: RequestEnvelope<EvidenceInput>): Promise<Envelope<unknown>>;
  finish(request: RequestEnvelope<FinishInput>): Promise<Envelope<unknown>>;
  release(request: RequestEnvelope<ReleaseInput>): Promise<Envelope<unknown>>;
  /** Optional operation readback. The current mounted service may omit it. */
  readOperation?(project_id: string, operation_id: string): Promise<Envelope<OperationReadback>>;
  /** Bounded durable history for one exact active attempt fence. */
  readReceiptsForAttempt?(project_id: string, work_id: string, attempt_id: string, fence: number, limit?: number, offset?: number): Promise<Envelope<AttemptReceiptPage>>;
  bindFinalResult?(request: RequestEnvelope<BindFinalResultInput>): Promise<Envelope<FinalResultBinding>>;
  /** @deprecated Compatibility only. Dashboard hydration never trusts a singular readback. */
  readReceipt?(project_id: string, work_id: string, attempt_id: string, fence: number): Promise<Envelope<ReceiptReadback>>;
  /** Optional read-only workspace projections served by the versioned Rust API. */
  readWorkspaceView?(kind: WorkspaceViewKind, project_id: string): Promise<Envelope<unknown>>;
  readWorkSchedule?(project_id: string, work_id: string): Promise<Envelope<WorkScheduleReadbackDto>>;
  updateWorkSchedule?(request: RequestEnvelope<{ project_id: string; work_id: string; schedule_update: WorkScheduleUpdateDto }>): Promise<Envelope<WorkScheduleMutationReadbackDto>>;
  readExternalWaits?(project_id: string, wait_id?: string): Promise<Envelope<ExternalWaitReadbackDto>>;
  createExternalWait?(request: RequestEnvelope<{ project_id: string; wait_create: ExternalWaitCreateDto }>): Promise<Envelope<ExternalWaitMutationReadbackDto>>;
  resolveExternalWait?(request: RequestEnvelope<{ project_id: string; wait_resolve: ExternalWaitResolveDto }>): Promise<Envelope<ExternalWaitMutationReadbackDto>>;
  readProjectCivilTime?(project_id: string): Promise<Envelope<ProjectCivilTimeReadbackDto>>;
  editWork?(request: RequestEnvelope<WorkEditInput>): Promise<Envelope<unknown>>;
  readWork?(project_id: string, work_id: string): Promise<Envelope<WorkProjection>>;
  addDependency?(request: RequestEnvelope<DependencyChangeInput>): Promise<Envelope<unknown>>;
  removeDependency?(request: RequestEnvelope<DependencyChangeInput>): Promise<Envelope<unknown>>;
  readDependencyGraph?(project_id: string, command?: "dependency_tree" | "dependency_cycles"): Promise<Envelope<unknown>>;
  readCycle?(project_id: string, view: CycleReadView, cycle_id?: string, limit?: number, offset?: number): Promise<Envelope<unknown>>;
  changeCycle?(request: RequestEnvelope<{ project_id: string; cycle_change: CycleCommandInput }>): Promise<Envelope<unknown>>;
  readSources?(project_id: string, limit?: number, offset?: number): Promise<Envelope<SourceListReadback>>;
  searchSources?(project_id: string, query: string, limit?: number): Promise<Envelope<unknown>>;
  readReview?(project_id: string, review_id: string): Promise<Envelope<unknown>>;
  memoryCommand?(request: RequestEnvelope<{ project_id: string; memory: MemoryCommandInput }>): Promise<Envelope<unknown>>;
  recoveryCommand?(request: RequestEnvelope<{ project_id: string; recovery: RecoveryCommandInput }>): Promise<Envelope<unknown>>;
  completion?(request: RequestEnvelope<{ project_id: string; completion: CompletionCommandInput }>): Promise<Envelope<unknown>>;
  readSession?(project_id: string): Promise<Envelope<unknown>>;
  endSession?(request: RequestEnvelope<{ project_id: string; expected_revision: number }>): Promise<Envelope<unknown>>;
  captureSource?(request: RequestEnvelope<{ project_id: string; input: string; origin: string; media_type?: string; expected_revision: number }>): Promise<Envelope<unknown>>;
}

export type WorkspaceViewKind = "cycles" | "reviews" | "memory" | "recovery" | "dependencies" | "sources" | "session" | "waits";

export type TuiAction =
  | "create_project" | "create_work" | "claim" | "accept_start"
  | "evidence" | "finish" | "release";

export interface ActionAvailability {
  action: TuiAction;
  enabled: boolean;
  reason: string | null;
  requires_confirmation: boolean;
}

export interface Route {
  kind: "monitoring" | "project" | "work";
  project_id?: string;
  work_id?: string;
}

/** Presentation-only queue filters. The service remains the authority for status. */
export type DashboardFilter =
  | "all" | "ready" | "active" | "blocked" | "expired" | "closed"
  | "milestones" | "sprints" | "tasks" | "review" | "rejected" | "failed" | "held" | "corrupt";

export interface DashboardCapability {
  route: string;
  label: string;
  status: "available" | "unavailable";
  reason: string;
  owner?: string;
}

/**
 * Routes that are intentionally visible before their Rust service DTO exists.
 * The TUI may display these as disabled integration requests, but must never
 * implement a local mutation or pretend that a route succeeded.
 */
export const DASHBOARD_CAPABILITIES: readonly DashboardCapability[] = [
  { route: "work.edit", label: "Edit work", status: "unavailable", reason: "This action is not available in this connection", owner: "planning/application" },
  { route: "dependency.add/remove/tree", label: "Dependencies", status: "unavailable", reason: "Use the project command line to inspect or edit dependencies", owner: "planning/application" },
  { route: "cycle.create/activate/board", label: "Cycle changes and boards", status: "unavailable", reason: "Cycle lists are available here; use the project command line to create, change, or open a cycle board", owner: "hierarchy/application" },
  { route: "intake.list/promote", label: "Intake", status: "unavailable", reason: "Use the project command line for this workflow", owner: "knowledge/application" },
  { route: "source.list/search/capture", label: "Sources", status: "unavailable", reason: "Source routes are not available in this connection", owner: "source/application" },
  { route: "evidence.bind_final_result/receipts_for_attempt", label: "Result binding and attempt receipts", status: "unavailable", reason: "Typed result binding and receipt history routes are not available in this connection", owner: "evidence/service" },
  { route: "memory.publish", label: "Published memory changes", status: "unavailable", reason: "Memory search is available here; use the project command line to draft, review, publish, or reconcile memory", owner: "memory/application" },
  { route: "session.end/recover", label: "Session recovery resolution", status: "unavailable", reason: "Recovery obligations are visible here; use the project command line to resolve an obligation or end a session", owner: "runtime/service" },
  { route: "work.schedule/wait.read/create/resolve", label: "Work dates and external waits", status: "unavailable", reason: "Date and external-wait operations are not available in this connection", owner: "scheduling/application" },
  { route: "activity.history", label: "Activity history", status: "unavailable", reason: "Use the project command line for this workflow", owner: "protocol/service" },
];

function dashboardCapabilities(service: VersionedServiceApi): DashboardCapability[] {
  return DASHBOARD_CAPABILITIES.map(capability => {
    const available = capability.route === "work.edit"
      ? !!service.editWork && !!service.readWork
      : capability.route === "dependency.add/remove/tree"
        ? !!service.addDependency && !!service.removeDependency && !!service.readDependencyGraph
        : capability.route === "cycle.create/activate/board"
          ? !!service.changeCycle && !!service.readCycle
          : capability.route === "source.list/search/capture"
            ? !!service.readSources && !!service.searchSources && !!service.captureSource
            : capability.route === "evidence.bind_final_result/receipts_for_attempt"
              ? !!service.bindFinalResult && !!service.readReceiptsForAttempt && !!service.readSources
              : capability.route === "memory.publish"
                ? !!service.memoryCommand
                : capability.route === "session.end/recover"
                  ? !!service.endSession && !!service.recoveryCommand
                    : capability.route === "work.schedule/wait.read/create/resolve"
                      ? !!service.readWorkSchedule && !!service.updateWorkSchedule && !!service.readExternalWaits && !!service.createExternalWait && !!service.resolveExternalWait
                  : false;
    return available
      ? { ...capability, status: "available", reason: "Typed service routes are available in this connection." }
      : capability;
  });
}

export interface StaleRevisionDisplay {
  kind: "stale_revision";
  message: string;
  expected_revision: number | null;
  observed_revision: number | null;
  operation_id: string;
  error_code: string;
}

export interface ControllerNotice {
  kind: "stale_revision" | "error" | "busy" | "unknown";
  message: string;
  stale?: StaleRevisionDisplay;
  error?: TuiServiceError;
}

export class ProtocolEnvelopeError extends Error {
  readonly kind = "protocol_error";

  constructor(message: string) {
    super(message);
    this.name = "ProtocolEnvelopeError";
  }
}

export class ActionDisabledError extends Error {
  readonly kind = "action_disabled";

  constructor(
    readonly action: string,
    readonly reason: string,
    readonly work_id?: string,
  ) {
    super(`${action} is disabled${work_id ? ` for ${work_id}` : ""}: ${reason}`);
    this.name = "ActionDisabledError";
  }
}

export class TuiServiceError extends Error {
  readonly kind = "service_error";

  constructor(
    readonly code: string,
    message: string,
    readonly operation_id: string,
    readonly envelope: Envelope<unknown>,
  ) {
    super(message);
    this.name = "TuiServiceError";
  }

  get stale(): boolean {
    return ["stale_revision", "revision_conflict", "stale_context", "stale_fence", "stale_receipt"]
      .includes(this.code);
  }

  get unknown(): boolean {
    return this.envelope.outcome === "unknown" || this.code === "unknown_outcome";
  }
}

export interface PendingOperation {
  operation_id: string;
  action: MutationAction;
  work_id?: string;
}

export type ActionResult<T> =
  | { ok: true; envelope: Envelope<T>; data: T | null }
  | { ok: false; envelope: Envelope<unknown>; error: TuiServiceError };

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function isApplicationOutcome(value: unknown): value is ApplicationOutcome {
  return ["changed", "unchanged", "rejected", "conflict", "busy", "failed", "unknown"]
    .includes(String(value));
}

function isTransportOutcome(value: unknown): value is TransportOutcome {
  return value === "ok" || value === "error";
}

function asNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new ProtocolEnvelopeError(`${field} must be a non-negative number`);
  }
  return value;
}

function asOptionalNumber(value: unknown, field: string): number | null | undefined {
  if (value === undefined || value === null) return value;
  return asNumber(value, field);
}

function asOptionalString(value: unknown, field: string): string | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== "string") throw new ProtocolEnvelopeError(`${field} must be a string`);
  return value;
}

function validateOperationId(value: unknown): string {
  if (typeof value !== "string" || !/^op_[A-Za-z0-9._-]+$/.test(value)) {
    throw new ProtocolEnvelopeError("invalid operation id");
  }
  return value;
}

function jsonBytes(value: unknown, field: string): Uint8Array {
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(value);
  } catch (error) {
    throw new ProtocolEnvelopeError(`${field} is not JSON serializable: ${String(error)}`);
  }
  if (encoded === undefined) throw new ProtocolEnvelopeError(`${field} must be JSON serializable`);
  return new TextEncoder().encode(encoded);
}

/** Encode one Boreal length-delimited JSON frame for a socket transport. */
export function encodeJsonFrame(json: string, max_payload_bytes = DEFAULT_MAX_PAYLOAD_BYTES): Uint8Array {
  const payload = new TextEncoder().encode(json);
  if (!Number.isInteger(max_payload_bytes) || max_payload_bytes <= 0) {
    throw new ProtocolEnvelopeError("payload limit must be a positive integer");
  }
  if (payload.length > max_payload_bytes) {
    throw new ProtocolEnvelopeError(`payload is ${payload.length} bytes; maximum is ${max_payload_bytes}`);
  }
  const frame = new Uint8Array(FRAME_HEADER_BYTES + payload.length);
  new DataView(frame.buffer).setUint32(0, payload.length, false);
  frame.set(payload, FRAME_HEADER_BYTES);
  return frame;
}

/** Decode exactly one Boreal length-delimited JSON frame. */
export function decodeJsonFrame(frame: Uint8Array, max_payload_bytes = DEFAULT_MAX_PAYLOAD_BYTES): string {
  if (frame.length < FRAME_HEADER_BYTES) throw new ProtocolEnvelopeError("framed response is missing its length prefix");
  const payloadLength = new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint32(0, false);
  if (payloadLength > max_payload_bytes) {
    throw new ProtocolEnvelopeError(`response payload is ${payloadLength} bytes; maximum is ${max_payload_bytes}`);
  }
  if (frame.length !== FRAME_HEADER_BYTES + payloadLength) {
    throw new ProtocolEnvelopeError("framed response length does not match its payload");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(frame.subarray(FRAME_HEADER_BYTES));
  } catch (error) {
    throw new ProtocolEnvelopeError(`response is not valid UTF-8: ${String(error)}`);
  }
}

export function validateRequestEnvelope<T>(value: unknown): RequestEnvelope<T> {
  if (!isObject(value)) throw new ProtocolEnvelopeError("request envelope must be an object");
  if (value.api_version !== API_VERSION) throw new ProtocolEnvelopeError("request API version mismatch");
  if (value.schema_version !== ENVELOPE_SCHEMA) throw new ProtocolEnvelopeError("request schema version mismatch");
  const operation_id = validateOperationId(value.operation_id);
  const expected_revision = asOptionalNumber(value.expected_revision, "expected_revision");
  const attempt_fence = asOptionalNumber(value.attempt_fence, "attempt_fence");
  if (attempt_fence !== undefined && attempt_fence !== null && !Number.isInteger(attempt_fence)) {
    throw new ProtocolEnvelopeError("attempt_fence must be an integer");
  }
  const attempt_id = asOptionalString(value.attempt_id, "attempt_id");
  if (!isObject(value.data)) throw new ProtocolEnvelopeError("request data must be an object");
  return {
    api_version: API_VERSION,
    schema_version: ENVELOPE_SCHEMA,
    operation_id,
    expected_revision: expected_revision === undefined ? null : expected_revision,
    attempt_id: attempt_id === undefined ? null : attempt_id,
    attempt_fence: attempt_fence === undefined ? null : attempt_fence,
    data: value.data as T,
  };
}

/** Convert service enum spellings to the stable snake_case view spelling. */
export function normalizeStateSpelling(value: string): string {
  const normalized = value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLocaleLowerCase();
  return normalized === "running" || normalized === "inprogress" ? "in_progress" : normalized;
}

function normalizeStatusItem(value: unknown): StatusItem {
  if (!isObject(value) || typeof value.work_id !== "string") {
    throw new ProtocolEnvelopeError("status item must contain work_id");
  }
  // Prefer the richer status/3 display value when a compatibility response
  // also carries the status/2 field. Older responses generally provide only
  // `status`, so this remains backward-compatible.
  const rawStatus = value.display_status ?? value.status;
  if (typeof rawStatus !== "string") throw new ProtocolEnvelopeError("status item must contain status");
  const reasonCodes = value.reason_codes ?? [];
  if (!Array.isArray(reasonCodes) || !reasonCodes.every((code) => typeof code === "string")) {
    throw new ProtocolEnvelopeError("status item reason_codes must be strings");
  }
  const normalizedReasons = reasonCodes.map((code) => normalizeStateSpelling(code));
  // status/2 represents expired_review as blocked. Preserve the structured
  // reason as the compatibility discriminator so older payloads still render
  // the recovery state instead of an ordinary hold.
  const statusValue = normalizeStateSpelling(rawStatus) === "blocked"
    && normalizedReasons.some((code) => [
      "expiry_review_required",
      "hard_budget_elapsed",
      "lease_elapsed",
      "attempt_expired",
      "attempt_expiry_pending",
    ].includes(code))
    ? "expired_review"
    : normalizeStateSpelling(rawStatus);
  const primaryReason = value.primary_reason;
  if (primaryReason !== undefined && (typeof primaryReason !== "string" || reasonCodes[0] !== primaryReason)) {
    throw new ProtocolEnvelopeError("status item primary_reason must match the first reason code");
  }
  const claimableValue = value.claimable ?? value.claimable_for_actor ?? false;
  if (typeof claimableValue !== "boolean") throw new ProtocolEnvelopeError("status item claimable must be boolean");
  const gates = value.gates;
  if (gates !== undefined && (!isObject(gates) || !Array.isArray(gates.open) || !Array.isArray(gates.satisfied))) {
    throw new ProtocolEnvelopeError("status item gates must contain open and satisfied arrays");
  }
  const normalizeGate = (gate: unknown): GateItem => {
    if (!isObject(gate) || typeof gate.gate_id !== "string" || typeof gate.kind !== "string"
      || typeof gate.required !== "boolean" || typeof gate.state !== "string") {
      throw new ProtocolEnvelopeError("gate item has invalid fields");
    }
    return {
      gate_id: gate.gate_id,
      kind: gate.kind,
      required: gate.required,
      state: normalizeStateSpelling(gate.state),
      reason: typeof gate.reason === "string" || gate.reason === null ? gate.reason : undefined,
      receipt_id: typeof gate.receipt_id === "string" || gate.receipt_id === null ? gate.receipt_id : undefined,
    };
  };
  const normalizedGates = gates ? {
    open: (gates.open as unknown[]).map(normalizeGate),
    satisfied: (gates.satisfied as unknown[]).map(normalizeGate),
  } : undefined;
  let attempt: AttemptSummary | null = null;
  const rawAttempt = value.attempt ?? (
    typeof value.attempt_id === "string"
      ? { attempt_id: value.attempt_id, fence: value.fence, phase: value.phase }
      : undefined
  );
  if (rawAttempt !== undefined && rawAttempt !== null) {
    if (!isObject(rawAttempt) || typeof rawAttempt.attempt_id !== "string") {
      throw new ProtocolEnvelopeError("attempt summary must contain attempt_id");
    }
    const fence = asNumber(rawAttempt.fence, "attempt.fence");
    if (!Number.isInteger(fence)) throw new ProtocolEnvelopeError("attempt.fence must be an integer");
    const phase = typeof rawAttempt.phase === "string"
      ? normalizeStateSpelling(rawAttempt.phase)
      : statusValue === "claimed"
        ? "claimed"
        : ["in_progress", "running", "accepted"].includes(statusValue)
          ? "running"
          : undefined;
    attempt = {
      attempt_id: rawAttempt.attempt_id,
      fence,
      phase,
      actor_id: typeof rawAttempt.actor_id === "string" || rawAttempt.actor_id === null ? rawAttempt.actor_id : undefined,
      session_id: typeof rawAttempt.session_id === "string" || rawAttempt.session_id === null ? rawAttempt.session_id : undefined,
      harness_id: typeof rawAttempt.harness_id === "string" || rawAttempt.harness_id === null ? rawAttempt.harness_id : undefined,
      lease_deadline: typeof rawAttempt.lease_deadline === "string" || rawAttempt.lease_deadline === null ? rawAttempt.lease_deadline : undefined,
      hard_deadline: typeof rawAttempt.hard_deadline === "string" || rawAttempt.hard_deadline === null ? rawAttempt.hard_deadline : undefined,
    };
  }
  const normalizeDependencies = (raw: unknown): DependencySummary[] | undefined => {
    if (raw === undefined) return undefined;
    if (!Array.isArray(raw)) throw new ProtocolEnvelopeError("status item dependencies must be an array");
    return raw.map((dependency) => {
      if (!isObject(dependency) || typeof dependency.work_id !== "string") {
        throw new ProtocolEnvelopeError("dependency summary must contain work_id");
      }
      return {
        work_id: dependency.work_id,
        relation: typeof dependency.relation === "string" ? dependency.relation : undefined,
        status: typeof (dependency.status ?? dependency.display_status) === "string"
          ? normalizeStateSpelling((dependency.status ?? dependency.display_status) as string) : undefined,
        satisfied: typeof dependency.satisfied === "boolean"
          ? dependency.satisfied
          : typeof dependency.satisfies_default === "boolean" ? dependency.satisfies_default : undefined,
      };
    });
  };
  const normalizeActivity = (raw: unknown): ActivitySummary[] | undefined => {
    if (raw === undefined) return undefined;
    if (!Array.isArray(raw)) throw new ProtocolEnvelopeError("status item activity must be an array");
    return raw.map((event) => {
      if (!isObject(event) || typeof event.kind !== "string") {
        throw new ProtocolEnvelopeError("activity summary must contain kind");
      }
      return {
        event_id: typeof event.event_id === "string" ? event.event_id : undefined,
        kind: event.kind,
        occurred_at: typeof event.occurred_at === "string" ? event.occurred_at : undefined,
        actor_id: typeof event.actor_id === "string" || event.actor_id === null ? event.actor_id : undefined,
        summary: typeof event.summary === "string" ? event.summary : undefined,
      };
    });
  };
  const normalizeActionDescriptor = (raw: unknown): ServerActionDescriptor => {
    if (!isObject(raw) || typeof raw.action !== "string" || !isObject(raw.target)
      || typeof raw.target.project_id !== "string" || typeof raw.target.work_id !== "string"
      || (raw.target.entity_revision !== null && (typeof raw.target.entity_revision !== "number" || !Number.isInteger(raw.target.entity_revision)))
      || typeof raw.expected_project_revision !== "number" || !Number.isInteger(raw.expected_project_revision)
      || (raw.expected_entity_revision !== null && (typeof raw.expected_entity_revision !== "number" || !Number.isInteger(raw.expected_entity_revision)))
      || !Array.isArray(raw.required_roles) || !raw.required_roles.every((role) => typeof role === "string")
      || !Array.isArray(raw.required_inputs) || !raw.required_inputs.every((input) => typeof input === "string")
      || typeof raw.read_only !== "boolean" || typeof raw.recovery !== "boolean") {
      throw new ProtocolEnvelopeError("status action descriptor has invalid fields");
    }
    const proofRevision = raw.expected_proof_revision;
    if (proofRevision !== undefined && proofRevision !== null
      && (typeof proofRevision !== "number" || !Number.isInteger(proofRevision))) {
      throw new ProtocolEnvelopeError("status action proof revision must be an integer or null");
    }
    const confirmation = raw.confirmation;
    if (confirmation !== undefined && confirmation !== null && typeof confirmation !== "string") {
      throw new ProtocolEnvelopeError("status action confirmation must be a string or null");
    }
    let attempt: ServerActionDescriptor["attempt"];
    if (raw.attempt !== undefined && raw.attempt !== null) {
      if (!isObject(raw.attempt) || typeof raw.attempt.attempt_id !== "string"
        || typeof raw.attempt.fence !== "number" || !Number.isInteger(raw.attempt.fence)) {
        throw new ProtocolEnvelopeError("status action attempt has invalid fields");
      }
      attempt = { attempt_id: raw.attempt.attempt_id, fence: raw.attempt.fence };
    } else {
      attempt = raw.attempt === null ? null : undefined;
    }
    return {
      action: raw.action,
      target: {
        project_id: raw.target.project_id,
        work_id: raw.target.work_id,
        entity_revision: raw.target.entity_revision as number | null,
      },
      expected_project_revision: raw.expected_project_revision,
      expected_entity_revision: raw.expected_entity_revision as number | null,
      expected_proof_revision: proofRevision as number | null | undefined,
      attempt,
      required_roles: raw.required_roles as string[],
      required_inputs: raw.required_inputs as string[],
      confirmation: confirmation as string | null | undefined,
      read_only: raw.read_only,
      recovery: raw.recovery,
    };
  };
  const normalizeActions = (raw: unknown): ServerActionSet | undefined => {
    if (raw === undefined || raw === null) return undefined;
    if (!isObject(raw) || !Array.isArray(raw.allowed) || !Array.isArray(raw.denied)) {
      throw new ProtocolEnvelopeError("status actions must contain allowed and denied arrays");
    }
    const denied = raw.denied.map((entry) => {
      if (!isObject(entry) || !isObject(entry.reason) || !Array.isArray(entry.recovery)) {
        throw new ProtocolEnvelopeError("status denied action has invalid fields");
      }
      if (typeof entry.reason.code !== "string" || !entry.recovery.every((action) => typeof action === "string")) {
        throw new ProtocolEnvelopeError("status denied action reason has invalid fields");
      }
      return {
        descriptor: normalizeActionDescriptor(entry.descriptor),
        reason: {
          code: entry.reason.code,
          detail: typeof entry.reason.detail === "string" ? entry.reason.detail : undefined,
        },
        reason_code: typeof entry.reason_code === "string" ? entry.reason_code : undefined,
        recovery: entry.recovery as string[],
      };
    });
    return {
      allowed: raw.allowed.map(normalizeActionDescriptor),
      denied,
    };
  };
  const actions = normalizeActions(value.actions);
  const rawActionContext = value.action_context;
  if (rawActionContext !== undefined && rawActionContext !== null
    && (!isObject(rawActionContext) || typeof rawActionContext.state !== "string"
      || (rawActionContext.missing_facts !== undefined
        && (!Array.isArray(rawActionContext.missing_facts)
          || !rawActionContext.missing_facts.every((fact) => typeof fact === "string")))
      || (rawActionContext.entity_revision !== undefined && rawActionContext.entity_revision !== null
        && (typeof rawActionContext.entity_revision !== "number" || !Number.isSafeInteger(rawActionContext.entity_revision)))
      || (rawActionContext.proof_revision !== undefined && rawActionContext.proof_revision !== null
        && (typeof rawActionContext.proof_revision !== "number" || !Number.isSafeInteger(rawActionContext.proof_revision)))
      || (rawActionContext.authenticated_session_id !== undefined && rawActionContext.authenticated_session_id !== null
        && typeof rawActionContext.authenticated_session_id !== "string")
      || (rawActionContext.integrity !== undefined && typeof rawActionContext.integrity !== "string"))) {
    throw new ProtocolEnvelopeError("status action context has invalid fields");
  }
  const actionContext = isObject(rawActionContext) ? rawActionContext : undefined;
  if (actions) {
    const descriptors = [
      ...actions.allowed,
      ...actions.denied.map((entry) => entry.descriptor),
    ];
    for (const descriptor of descriptors) {
      if (descriptor.target.work_id !== value.work_id
        || (typeof value.project_id === "string" && descriptor.target.project_id !== value.project_id)) {
        throw new ProtocolEnvelopeError("status action descriptor target does not match work row");
      }
    }
  }
  const dependencyValue = isObject(value.dependency) ? value.dependency.prerequisites : value.dependencies;
  const dependencies = normalizeDependencies(dependencyValue);
  const nextStatusChange = value.next_status_change_at;
  if (nextStatusChange !== undefined && nextStatusChange !== null && typeof nextStatusChange !== "string") {
    throw new ProtocolEnvelopeError("status item next_status_change_at must be a string or null");
  }
  for (const field of ["due_today", "overdue"] as const) {
    if (value[field] !== undefined && typeof value[field] !== "boolean")
      throw new ProtocolEnvelopeError(`status item ${field} must be a boolean when supplied`);
  }
  for (const field of ["blocking_external_wait_ids", "follow_up_due_wait_ids"] as const) {
    const waitIds = value[field];
    if (waitIds !== undefined && (!Array.isArray(waitIds) || !waitIds.every((id: unknown) => typeof id === "string")))
      throw new ProtocolEnvelopeError(`status item ${field} must be an array of identifiers when supplied`);
  }
  const priority = value.priority === undefined ? undefined : asNumber(value.priority, "priority");
  const rawExecutionMode = value.execution_mode;
  if (rawExecutionMode !== undefined && rawExecutionMode !== null && !["direct", "container"].includes(String(rawExecutionMode)))
    throw new ProtocolEnvelopeError("status item execution_mode must be direct, container, or null");
  const rawPlanningIntegrity = value.planning_integrity;
  if (rawPlanningIntegrity !== undefined && !["valid", "missing", "inconsistent", "unavailable", "unreadable", "legacy"].includes(String(rawPlanningIntegrity)))
    throw new ProtocolEnvelopeError("status item planning_integrity is invalid");
  const planningParent = asOptionalString(value.planning_parent_id, "planning_parent_id");
  const planningDiagnostic = asOptionalString(value.planning_diagnostic, "planning_diagnostic");
  return {
    work_id: value.work_id,
    project_id: typeof value.project_id === "string" ? value.project_id : undefined,
    status: statusValue,
    display_status: statusValue,
    reason_codes: reasonCodes,
    primary_reason: primaryReason as string | undefined,
    claimable: claimableValue,
    claimable_for_actor: claimableValue,
    next_action: typeof value.next_action === "string" ? value.next_action : null,
    next_status_change_at: nextStatusChange as string | null | undefined,
    title: typeof value.title === "string" ? value.title : undefined,
    kind: typeof value.kind === "string" ? value.kind : undefined,
    parent_id: typeof value.parent_id === "string" || value.parent_id === null ? value.parent_id : undefined,
    execution_mode: rawExecutionMode as ExecutionMode | null | undefined,
    planning_parent_id: planningParent,
    planning_integrity: rawPlanningIntegrity as PlanningIntegrity | undefined,
    planning_diagnostic: planningDiagnostic,
    description: typeof value.description === "string" ? value.description : undefined,
    priority,
    dispatch_policy: typeof value.dispatch_policy === "string" ? value.dispatch_policy : undefined,
    due_at: typeof value.due_at === "string" || value.due_at === null ? value.due_at : undefined,
    due_today: typeof value.due_today === "boolean" ? value.due_today : undefined,
    overdue: typeof value.overdue === "boolean" ? value.overdue : undefined,
    blocking_external_wait_ids: Array.isArray(value.blocking_external_wait_ids) ? value.blocking_external_wait_ids as string[] : undefined,
    follow_up_due_wait_ids: Array.isArray(value.follow_up_due_wait_ids) ? value.follow_up_due_wait_ids as string[] : undefined,
    dependencies,
    activity: normalizeActivity(value.activity),
    gates: normalizedGates,
    attempt,
    lifecycle: typeof value.lifecycle === "string" ? normalizeStateSpelling(value.lifecycle) : undefined,
    receipt: value.receipt,
    receipt_id: typeof value.receipt_id === "string" || value.receipt_id === null ? value.receipt_id : undefined,
    actions,
    action_context: actionContext ? {
      state: actionContext.state as string,
      missing_facts: actionContext.missing_facts as string[] | undefined,
      entity_revision: actionContext.entity_revision as number | null | undefined,
      proof_revision: actionContext.proof_revision as number | null | undefined,
      authenticated_session_id: actionContext.authenticated_session_id as string | null | undefined,
      integrity: actionContext.integrity as string | undefined,
    } : undefined,
  };
}

function normalizeAttemptReceiptRecord(value: unknown): AttemptReceiptRecord {
  if (!isObject(value)) throw new ProtocolEnvelopeError("attempt receipt row must be an object");
  const stringFields = ["receipt_id", "project_id", "work_id", "attempt_id", "operation_id", "executable", "argv_json", "cwd", "started_at", "ended_at", "config_identity", "environment_fingerprint", "subject_json", "coverage_json", "created_at"] as const;
  for (const field of stringFields) if (typeof value[field] !== "string") throw new ProtocolEnvelopeError(`attempt receipt ${field} must be a string`);
  for (const field of ["gate_id", "source_version_id", "output_digest", "output_ref", "rejection_code"] as const)
    if (value[field] !== null && typeof value[field] !== "string") throw new ProtocolEnvelopeError(`attempt receipt ${field} must be a string or null`);
  if (!Number.isSafeInteger(value.fence) || (value.fence as number) < 0 || !Number.isInteger(value.exit_code))
    throw new ProtocolEnvelopeError("attempt receipt fence or exit_code is invalid");
  if (!["boreal_witnessed", "external_attested", "self_reported", "unknown"].includes(String(value.attestation)))
    throw new ProtocolEnvelopeError("attempt receipt attestation is invalid");
  if (!["passed", "failed", "rejected", "unknown", "stale"].includes(String(value.result)))
    throw new ProtocolEnvelopeError("attempt receipt result is invalid");
  if (value.receipt_payload !== undefined && value.receipt_payload !== null && !isObject(value.receipt_payload))
    throw new ProtocolEnvelopeError("attempt receipt payload must be an object or null");
  if (value.receipt_payload_diagnostic !== undefined && value.receipt_payload_diagnostic !== null && typeof value.receipt_payload_diagnostic !== "string")
    throw new ProtocolEnvelopeError("attempt receipt payload diagnostic must be a string or null");
  return {
    receipt_id: value.receipt_id as string,
    project_id: value.project_id as string,
    work_id: value.work_id as string,
    attempt_id: value.attempt_id as string,
    fence: value.fence as number,
    operation_id: value.operation_id as string,
    gate_id: value.gate_id as string | null,
    executable: value.executable as string,
    argv_json: value.argv_json as string,
    cwd: value.cwd as string,
    exit_code: value.exit_code as number,
    started_at: value.started_at as string,
    ended_at: value.ended_at as string,
    source_version_id: value.source_version_id as string | null,
    config_identity: value.config_identity as string,
    environment_fingerprint: value.environment_fingerprint as string,
    output_digest: value.output_digest as string | null,
    output_ref: value.output_ref as string | null,
    subject_json: value.subject_json as string,
    coverage_json: value.coverage_json as string,
    attestation: value.attestation as AttemptReceiptRecord["attestation"],
    result: value.result as AttemptReceiptRecord["result"],
    rejection_code: value.rejection_code as string | null,
    created_at: value.created_at as string,
    receipt_payload: value.receipt_payload,
    receipt_payload_diagnostic: value.receipt_payload_diagnostic as string | null | undefined,
  };
}

function normalizeFinalResultBinding(value: unknown): FinalResultBinding {
  if (!isObject(value)) throw new ProtocolEnvelopeError("final result binding response must be an object");
  for (const field of ["binding_id", "project_id", "work_id", "attempt_id", "source_version_id", "content_digest",
    "config_identity", "profile_id", "profile_digest", "operation_id", "request_digest", "created_at"] as const) {
    if (typeof value[field] !== "string") throw new ProtocolEnvelopeError(`final result binding ${field} must be a string`);
  }
  for (const field of ["fence", "profile_version", "entity_revision", "prior_proof_revision", "proof_revision", "project_revision"] as const) {
    if (!Number.isSafeInteger(value[field]) || (value[field] as number) < 0)
      throw new ProtocolEnvelopeError(`final result binding ${field} must be a non-negative integer`);
  }
  if ((value.fence as number) === 0 || (value.profile_version as number) === 0
    || (value.entity_revision as number) === 0 || (value.proof_revision as number) === 0 || (value.project_revision as number) === 0)
    throw new ProtocolEnvelopeError("final result binding contains a zero revision or fence");
  if (typeof value.lineage_pending !== "string" && value.lineage_pending !== null)
    throw new ProtocolEnvelopeError("final result binding lineage_pending must be a string or null");
  if (typeof value.replayed !== "boolean") throw new ProtocolEnvelopeError("final result binding replayed must be boolean");
  return value as unknown as FinalResultBinding;
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!isObject(value) || Array.isArray(value)) throw new ProtocolEnvelopeError(`${name} must be an object`);
  return value;
}

function requiredNullableString(value: unknown, name: string): string | null {
  if (value !== null && typeof value !== "string") throw new ProtocolEnvelopeError(`${name} must be a string or null`);
  return value as string | null;
}

function validCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || year < -2147483648 || year > 2147483647 || !Number.isInteger(month) || !Number.isInteger(day))
    return false;
  const daysInMonth = [31, ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) ? 29 : 28,
    31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return daysInMonth !== undefined && day >= 1 && day <= daysInMonth;
}

function normalizeBusinessDate(value: unknown, name: string): BusinessDateDto {
  const date = record(value, name);
  if (date.kind === "instant" && Number.isSafeInteger(date.at_ms) && Number(date.at_ms) >= 0)
    return { kind: "instant", at_ms: Number(date.at_ms) };
  if (date.kind === "local_date") {
    const { year, month, day } = date;
    if (typeof year === "number" && typeof month === "number" && typeof day === "number" && validCalendarDate(year, month, day))
      return { kind: "local_date", year, month, day };
  }
  if (date.kind === "resolved_local") {
    const local = record(date.nominal_local, `${name}.nominal_local`);
    const numbers = [local.year, local.month, local.day, local.hour, local.minute, local.second];
    const validNumbers = numbers.every(number => typeof number === "number" && Number.isInteger(number));
    if (validNumbers && validCalendarDate(Number(local.year), Number(local.month), Number(local.day))
      && Number(local.hour) >= 0 && Number(local.hour) <= 23
      && Number(local.minute) >= 0 && Number(local.minute) <= 59 && Number(local.second) >= 0 && Number(local.second) <= 59
      && Number.isSafeInteger(date.utc_instant_ms) && Number(date.utc_instant_ms) >= 0
      && Number.isInteger(date.utc_offset_minutes) && typeof date.timezone === "string" && typeof date.tzdb_identity === "string"
      && date.gap_policy === "next_valid" && ["earlier_offset", "later_offset"].includes(String(date.fold_policy))) {
      return { kind: "resolved_local", nominal_local: {
        year: Number(local.year), month: Number(local.month), day: Number(local.day), hour: Number(local.hour),
        minute: Number(local.minute), second: Number(local.second),
      }, utc_instant_ms: Number(date.utc_instant_ms), utc_offset_minutes: Number(date.utc_offset_minutes),
      timezone: date.timezone, tzdb_identity: date.tzdb_identity, gap_policy: "next_valid",
      fold_policy: date.fold_policy as "earlier_offset" | "later_offset" };
    }
  }
  throw new ProtocolEnvelopeError(`${name} is not a supported typed business date`);
}

function normalizeBusinessSchedule(value: unknown, name: string): BusinessScheduleDto {
  const schedule = record(value, name);
  const fields = ["not_before", "due", "planned_start", "planned_end"] as const;
  const result = {} as BusinessScheduleDto;
  for (const field of fields) {
    if (!(field in schedule)) throw new ProtocolEnvelopeError(`${name}.${field} is missing; null is required to clear a date`);
    result[field] = schedule[field] === null ? null : normalizeBusinessDate(schedule[field], `${name}.${field}`);
  }
  return result;
}

function normalizeScheduleReadback(value: unknown): WorkScheduleReadbackDto | WorkScheduleMutationReadbackDto {
  const data = record(value, "work schedule readback");
  if (data.schema_version !== "boreal.work_schedule_readback.v1" || !Number.isSafeInteger(data.project_revision)
    || typeof data.work_id !== "string" || !Number.isSafeInteger(data.schedule_revision))
    throw new ProtocolEnvelopeError("work schedule readback has invalid identity or revisions");
  if ("operation_id" in data) {
    if (typeof data.operation_id !== "string" || typeof data.replayed !== "boolean" || data.schedule === null)
      throw new ProtocolEnvelopeError("work schedule mutation readback is incomplete");
    return { schema_version: "boreal.work_schedule_readback.v1", operation_id: data.operation_id, replayed: data.replayed,
      project_revision: Number(data.project_revision), work_id: data.work_id, schedule_revision: Number(data.schedule_revision),
      schedule: normalizeBusinessSchedule(data.schedule, "work schedule readback.schedule") };
  }
  if (data.legacy_due_at !== null && typeof data.legacy_due_at !== "string")
    throw new ProtocolEnvelopeError("work schedule legacy_due_at must be a string or null");
  return { schema_version: "boreal.work_schedule_readback.v1", project_revision: Number(data.project_revision),
    work_id: data.work_id, schedule_revision: Number(data.schedule_revision),
    schedule: data.schedule === null ? null : normalizeBusinessSchedule(data.schedule, "work schedule readback.schedule"),
    legacy_due_at: data.legacy_due_at as string | null };
}

function normalizeAccountable(value: unknown, name: string): ExternalWaitAccountableDto {
  const accountable = record(value, name);
  if (accountable.kind === "role" && ["agent", "operator", "reviewer", "publisher"].includes(String(accountable.role)))
    return { kind: "role", role: accountable.role as ExternalWaitRoleDto };
  if ((accountable.kind === "person" || accountable.kind === "service")
    && typeof accountable.reference === "string" && typeof accountable.display_name === "string")
    return { kind: accountable.kind, reference: accountable.reference, display_name: accountable.display_name };
  throw new ProtocolEnvelopeError(`${name} is not a supported accountable identity`);
}

function normalizeExternalWait(value: unknown, name: string): ExternalWaitDto {
  const wait = record(value, name);
  const categories: ExternalWaitCategoryDto[] = ["decision", "approval", "information", "access", "service", "other"];
  const states: ExternalWaitStateDto[] = ["open", "resolved", "cancelled"];
  if (typeof wait.wait_id !== "string" || typeof wait.source_work_id !== "string"
    || !Array.isArray(wait.affected_work_ids) || !wait.affected_work_ids.every(id => typeof id === "string")
    || !categories.includes(wait.category as ExternalWaitCategoryDto) || typeof wait.reason !== "string"
    || !states.includes(wait.state as ExternalWaitStateDto) || !Number.isSafeInteger(wait.wait_revision)
    || typeof wait.created_by !== "string" || !Number.isSafeInteger(wait.created_at_ms))
    throw new ProtocolEnvelopeError(`${name} has invalid identity, state, or revision fields`);
  const resolution = wait.resolution === null ? null : (() => {
    const raw = record(wait.resolution, `${name}.resolution`);
    const outcomes: ExternalWaitOutcomeDto[] = ["approved", "rejected", "decision_provided", "output_provided", "declined", "unavailable", "cancelled"];
    if (!outcomes.includes(raw.outcome as ExternalWaitOutcomeDto) || typeof raw.detail !== "string"
      || !Number.isSafeInteger(raw.recorded_at_ms) || typeof raw.recorded_by !== "string"
      || !["agent", "operator", "reviewer", "publisher"].includes(String(raw.recorded_as)))
      throw new ProtocolEnvelopeError(`${name}.resolution is malformed`);
    return { outcome: raw.outcome as ExternalWaitOutcomeDto, detail: raw.detail,
      output_ref: requiredNullableString(raw.output_ref, `${name}.resolution.output_ref`),
      supplied_by: normalizeAccountable(raw.supplied_by, `${name}.resolution.supplied_by`),
      recorded_by: raw.recorded_by, recorded_as: raw.recorded_as as ExternalWaitRoleDto, recorded_at_ms: Number(raw.recorded_at_ms) };
  })();
  const settingRevision = wait.civil_time_setting_revision;
  if (settingRevision !== null && !Number.isSafeInteger(settingRevision))
    throw new ProtocolEnvelopeError(`${name}.civil_time_setting_revision is invalid`);
  return { wait_id: wait.wait_id, source_work_id: wait.source_work_id, affected_work_ids: wait.affected_work_ids as string[],
    category: wait.category as ExternalWaitCategoryDto, reason: wait.reason,
    accountable: normalizeAccountable(wait.accountable, `${name}.accountable`),
    expected_decision: requiredNullableString(wait.expected_decision, `${name}.expected_decision`),
    expected_output: requiredNullableString(wait.expected_output, `${name}.expected_output`),
    follow_up: wait.follow_up === null ? null : normalizeBusinessDate(wait.follow_up, `${name}.follow_up`),
    civil_time_setting_revision: settingRevision as number | null, wait_revision: Number(wait.wait_revision),
    state: wait.state as ExternalWaitStateDto, created_by: wait.created_by, created_at_ms: Number(wait.created_at_ms), resolution };
}

function normalizeWaitReadback(value: unknown): ExternalWaitReadbackDto | ExternalWaitMutationReadbackDto {
  const data = record(value, "external wait readback");
  if (data.schema_version !== "boreal.external_wait_readback.v1" || !Number.isSafeInteger(data.project_revision))
    throw new ProtocolEnvelopeError("external wait readback has invalid schema or project revision");
  if ("wait" in data) {
    if (typeof data.operation_id !== "string" || typeof data.replayed !== "boolean")
      throw new ProtocolEnvelopeError("external wait mutation readback is incomplete");
    return { schema_version: "boreal.external_wait_readback.v1", operation_id: data.operation_id, replayed: data.replayed,
      project_revision: Number(data.project_revision), wait: normalizeExternalWait(data.wait, "external wait mutation readback.wait") };
  }
  if (!Array.isArray(data.waits)) throw new ProtocolEnvelopeError("external wait list must contain waits");
  return { schema_version: "boreal.external_wait_readback.v1", project_revision: Number(data.project_revision),
    waits: data.waits.map((wait, index) => normalizeExternalWait(wait, `external wait readback.waits[${index}]`)) };
}

function normalizeCivilTimeReadback(value: unknown): ProjectCivilTimeReadbackDto {
  const data = record(value, "project civil-time readback");
  if (data.schema_version !== "boreal.project_civil_time_readback.v1" || !Number.isSafeInteger(data.project_revision))
    throw new ProtocolEnvelopeError("project civil-time readback has invalid schema or revision");
  if (data.setting === null) return { schema_version: "boreal.project_civil_time_readback.v1", project_revision: Number(data.project_revision), setting: null };
  const setting = record(data.setting, "project civil-time readback.setting");
  if (!Number.isSafeInteger(setting.setting_revision) || typeof setting.timezone !== "string"
    || typeof setting.tzdb_identity !== "string" || typeof setting.changed_by !== "string"
    || !Number.isSafeInteger(setting.changed_at_ms))
    throw new ProtocolEnvelopeError("project civil-time setting is malformed");
  return { schema_version: "boreal.project_civil_time_readback.v1", project_revision: Number(data.project_revision),
    setting: { setting_revision: Number(setting.setting_revision), timezone: setting.timezone,
      tzdb_identity: setting.tzdb_identity, changed_by: setting.changed_by, changed_at_ms: Number(setting.changed_at_ms) } };
}

function unwrapReadback<T>(response: Envelope<unknown>, normalize: (value: unknown) => T): Envelope<T> {
  if (response.outcome !== "changed" && response.outcome !== "unchanged") return response as Envelope<T>;
  const data = record(response.data, "scheduling response");
  if (!("readback" in data)) throw new ProtocolEnvelopeError("scheduling response omitted its typed readback");
  return { ...response, data: normalize(data.readback) };
}

function normalizeDiagnostics(value: unknown): StatusDiagnostic[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ProtocolEnvelopeError("status diagnostics must be an array");
  return value.map((entry) => {
    if (!isObject(entry) || typeof entry.work_id !== "string" || typeof entry.code !== "string" || typeof entry.detail !== "string") {
      throw new ProtocolEnvelopeError("status diagnostic has invalid fields");
    }
    return {
      work_id: entry.work_id,
      title: typeof entry.title === "string" || entry.title === null ? entry.title : undefined,
      code: entry.code,
      detail: entry.detail,
    };
  });
}

function emptyCounts(): MonitoringCounts {
  return { matched: 0, queued: 0, ready: 0, blocked: 0, in_progress: 0, expired_review: 0, closed: 0 };
}

function normalizeCounts(value: unknown, items: StatusItem[], total: number): MonitoringCounts {
  const counts = emptyCounts();
  const supplied = new Set<string>();
  if (isObject(value)) {
    for (const key of Object.keys(counts)) {
      const candidate = value[key];
      if (candidate !== undefined) {
        counts[key] = asNumber(candidate, `counts.${key}`);
        supplied.add(key);
      }
    }
    for (const [key, candidate] of Object.entries(value)) {
      if (typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0) {
        counts[key] = candidate;
        supplied.add(key);
      }
    }
  }
  if (!supplied.has("matched")) counts.matched = total;
  for (const item of items) {
    const key = normalizeStateSpelling(String(item.display_status ?? item.status));
    if (!supplied.has(key) && key in counts) counts[key] += 1;
  }
  return counts;
}

/** Validate one service response before route code can inspect it. */
export function validateEnvelope<T>(value: unknown): Envelope<T> {
  if (!isObject(value)) throw new ProtocolEnvelopeError("protocol envelope must be an object");
  if (value.api_version !== API_VERSION) throw new ProtocolEnvelopeError("api version mismatch");
  if (value.schema_version !== ENVELOPE_SCHEMA) throw new ProtocolEnvelopeError("schema version mismatch");
  if (typeof value.operation_id !== "string" || !/^op_[A-Za-z0-9._-]+$/.test(value.operation_id)) {
    throw new ProtocolEnvelopeError("invalid operation id");
  }
  if (typeof value.as_of !== "string" || value.as_of.length === 0) throw new ProtocolEnvelopeError("missing as_of");
  if (!isTransportOutcome(value.transport)) throw new ProtocolEnvelopeError("invalid transport outcome");
  if (!isApplicationOutcome(value.outcome)) throw new ProtocolEnvelopeError("invalid application outcome");
  if (value.revision !== null && value.revision !== undefined) asNumber(value.revision, "revision");
  if (value.next_status_change_at !== undefined && value.next_status_change_at !== null
    && typeof value.next_status_change_at !== "string") {
    throw new ProtocolEnvelopeError("next_status_change_at must be a string or null");
  }
  if (value.data !== null && value.data !== undefined && value.detail_ref !== null && value.detail_ref !== undefined) {
    throw new ProtocolEnvelopeError("inline data and detail reference cannot both be present");
  }
  const successful = value.outcome === "changed" || value.outcome === "unchanged";
  if (!successful && !isObject(value.error)) throw new ProtocolEnvelopeError("failed outcome has no structured error");
  if (successful && value.error !== null && value.error !== undefined) {
    throw new ProtocolEnvelopeError("successful outcome must not carry an error");
  }
  if (value.transport === "error" && !["failed", "unknown"].includes(String(value.outcome))) {
    throw new ProtocolEnvelopeError("transport error has invalid application outcome");
  }
  if (isObject(value.error)) {
    if (typeof value.error.code !== "string" || typeof value.error.message !== "string") {
      throw new ProtocolEnvelopeError("structured error requires code and message");
    }
  } else if (value.error !== null && value.error !== undefined) {
    throw new ProtocolEnvelopeError("error must be a structured error or null");
  }
  return {
    api_version: value.api_version,
    schema_version: value.schema_version,
    operation_id: value.operation_id,
    revision: value.revision === undefined ? null : value.revision as number | null,
    as_of: value.as_of,
    next_status_change_at: value.next_status_change_at as string | null | undefined,
    transport: value.transport,
    outcome: value.outcome,
    data: value.data as T | null,
    detail_ref: value.detail_ref as DetailReference | null | undefined,
    error: value.error as ProtocolError | null,
    timing: isObject(value.timing) ? value.timing as TimingMetadata : undefined,
    recovery: isObject(value.recovery) ? value.recovery as RecoveryMetadata : undefined,
  };
}

function failureEnvelope(
  operation_id: string,
  code: string,
  message: string,
  outcome: "failed" | "unknown" = "failed",
): Envelope<never> {
  return {
    api_version: API_VERSION,
    schema_version: ENVELOPE_SCHEMA,
    operation_id,
    revision: null,
    as_of: new Date().toISOString(),
    next_status_change_at: null,
    transport: "error",
    outcome,
    data: null,
    detail_ref: null,
    error: {
      code,
      message,
      retryable: outcome === "failed",
      operation_id,
      ...(outcome === "unknown" ? { operation_preserved: true, readback_required: true } : {}),
    },
  };
}

function validateStatusReadOptions(options: StatusReadOptions): StatusReadOptions {
  const cursor_revision = asOptionalNumber(options.cursor_revision, "cursor_revision");
  const limit = options.limit === undefined ? MAX_INLINE_ITEMS : asNumber(options.limit, "limit");
  const offset = options.offset === undefined ? 0 : asNumber(options.offset, "offset");
  if (!Number.isInteger(limit) || limit > MAX_INLINE_ITEMS) {
    throw new ProtocolEnvelopeError(`limit must be an integer between 0 and ${MAX_INLINE_ITEMS}`);
  }
  if (!Number.isInteger(offset)) throw new ProtocolEnvelopeError("offset must be an integer");
  if (options.project_id !== undefined && typeof options.project_id !== "string") {
    throw new ProtocolEnvelopeError("project_id must be a string");
  }
  if (options.work_id !== undefined) requiredString(options.work_id, "work_id");
  return {
    cursor_revision: cursor_revision === undefined ? null : cursor_revision,
    project_id: options.project_id,
    limit,
    offset,
    work_id: options.work_id,
  };
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ProtocolEnvelopeError(`${field} must be a non-empty string`);
  }
  return value;
}

function validateCreateProjectInput(input: CreateProjectInput): void {
  requiredString(input.project_id, "create_project.project_id");
  requiredString(input.actor_id, "create_project.actor_id");
  requiredString(input.actor_role, "create_project.actor_role");
  requiredString(input.credential_ref, "create_project.credential_ref");
  requiredString(input.display_name, "create_project.display_name");
}

function validateCreateWorkInput(input: CreateWorkInput): void {
  requiredString(input.project_id, "create_work.project_id");
  requiredString(input.work_id, "create_work.work_id");
  requiredString(input.actor_id, "create_work.actor_id");
  requiredString(input.title, "create_work.title");
  if (!["milestone", "sprint", "task"].includes(input.kind)) {
    throw new ProtocolEnvelopeError("create_work.kind must be milestone, sprint, or task");
  }
  if (input.parent_id !== null) requiredString(input.parent_id, "create_work.parent_id");
  if (input.execution_mode !== undefined && !["direct", "container"].includes(input.execution_mode)) {
    throw new ProtocolEnvelopeError("create_work.execution_mode must be direct or container");
  }
  if (input.kind === "milestone" && input.execution_mode !== undefined && input.execution_mode !== "container") {
    throw new ProtocolEnvelopeError("milestones must use container execution mode");
  }
  if (input.kind === "sprint" && input.execution_mode !== undefined) {
    throw new ProtocolEnvelopeError("Sprint grouping rows do not have a v3 execution mode");
  }
  if (!Number.isInteger(input.priority) || input.priority < 0 || input.priority > 255) {
    throw new ProtocolEnvelopeError("create_work.priority must be an integer between 0 and 255");
  }
  if (!["automatic", "operator_only", "paused"].includes(input.dispatch_policy)) {
    throw new ProtocolEnvelopeError("create_work.dispatch_policy is invalid");
  }
  if (!Array.isArray(input.hard_holds)) {
    throw new ProtocolEnvelopeError("create_work.hard_holds must be an array");
  }
  if (input.hard_holds.length > 0) {
    throw new ProtocolEnvelopeError("create_work.hard_holds are not supported by the current Rust create_work route");
  }
  if (!isObject(input.acceptance_profile)) throw new ProtocolEnvelopeError("create_work.acceptance_profile is required");
  requiredString(input.acceptance_profile.id, "create_work.acceptance_profile.id");
  requiredString(input.acceptance_profile.version, "create_work.acceptance_profile.version");
}

function outerResponse(value: unknown, operation_id: string): unknown {
  if (!isObject(value)) throw new ProtocolEnvelopeError("service response must be an object");
  for (const field of Object.keys(value)) {
    if (!["api_version", "schema_version", "operation_id", "data"].includes(field)) {
      throw new ProtocolEnvelopeError(`unknown service response field ${field}`);
    }
  }
  if (value.api_version !== API_VERSION) throw new ProtocolEnvelopeError("service response API version mismatch");
  if (value.schema_version !== ENVELOPE_SCHEMA) throw new ProtocolEnvelopeError("service response schema version mismatch");
  if (value.operation_id !== operation_id) throw new ProtocolEnvelopeError("service response operation id mismatch");
  if (!isObject(value.data)) throw new ProtocolEnvelopeError("service response omitted its application envelope");
  if (value.data.operation_id !== operation_id) throw new ProtocolEnvelopeError("application response operation id mismatch");
  return value.data;
}

/**
 * Versioned application client over a complete framed byte transport.
 *
 * It deliberately does not import Node's `net` types. A production Unix
 * socket connector can implement FramedTransport with Node streams, while
 * tests and other runtimes can use the same deterministic wire contract.
 */
export class VersionedServiceClient implements VersionedServiceApi {
  private scopeIdentity: string | null = null;
  private readonly max_payload_bytes: number;
  private readonly credential_ref?: string;
  private readonly project_id?: string;
  private readonly actor_id?: string;
  private readonly harness_id?: string;
  private readonly session_id?: string;
  readonly notifications?: RefreshNotificationSource;

  constructor(private readonly transport: FramedTransport, config: ServiceClientConfig = {}) {
    this.max_payload_bytes = config.max_payload_bytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
    this.credential_ref = config.credential_ref;
    this.project_id = config.project_id;
    this.actor_id = config.actor_id;
    this.harness_id = config.harness_id;
    this.session_id = config.session_id;
    this.notifications = config.notifications;
    if (!Number.isInteger(this.max_payload_bytes) || this.max_payload_bytes <= 0) {
      throw new ProtocolEnvelopeError("payload limit must be a positive integer");
    }
  }

  readStatus(options: StatusReadOptions = {}): Promise<Envelope<RevisionedStatusResponse>> {
    const bounded = validateStatusReadOptions(options);
    const project_id = bounded.project_id ?? this.project_id;
    if (!project_id) throw new ProtocolEnvelopeError("status requires project_id");
    if (!this.actor_id) throw new ProtocolEnvelopeError("status requires actor_id");
    const data = {
      command: "status",
      cursor_revision: bounded.cursor_revision,
      project_id,
      actor_id: this.actor_id,
      harness_id: this.harness_id,
      session_id: this.session_id,
      limit: bounded.limit,
      offset: bounded.offset,
      ...(bounded.work_id ? { work_id: bounded.work_id } : {}),
    };
    return this.call<RevisionedStatusResponse, typeof data>("status", requestEnvelope(operationId(), data, bounded.cursor_revision ?? null));
  }

  readOperation(project_id: string, target_operation_id: string): Promise<Envelope<OperationReadback>> {
    requiredString(project_id, "operation_show.project_id");
    requiredString(target_operation_id, "operation_show.target_operation_id");
    const data = {
      command: "operation_show",
      project_id,
      actor_id: this.actor_id,
      harness_id: this.harness_id,
      session_id: this.session_id,
      target_operation_id,
    };
    return this.call<OperationReadback, typeof data>("operation_show", requestEnvelope(operationId(), data, null));
  }

  readWork(project_id: string, work_id: string): Promise<Envelope<WorkProjection>> {
    this.assertProject(project_id, "work detail");
    requiredString(work_id, "work_show.work_id");
    return this.call("work_show", requestEnvelope(operationId(), { project_id, work_id }, null));
  }

  async readWorkSchedule(project_id: string, work_id: string): Promise<Envelope<WorkScheduleReadbackDto>> {
    this.assertProject(project_id, "work schedule readback");
    requiredString(work_id, "work_schedule_readback.work_id");
    const response = await this.call("work_schedule_readback_v1", requestEnvelope(operationId(), {
      project_id, work_id,
    }, null));
    return unwrapReadback(response, normalizeScheduleReadback) as Envelope<WorkScheduleReadbackDto>;
  }

  async updateWorkSchedule(request: RequestEnvelope<{ project_id: string; work_id: string; schedule_update: WorkScheduleUpdateDto }>): Promise<Envelope<WorkScheduleMutationReadbackDto>> {
    const input = request.data;
    this.assertProject(input.project_id, "work schedule update");
    requiredString(input.work_id, "work_schedule_update.work_id");
    if (input.schedule_update.schema_version !== "boreal.work_schedule_update.v1"
      || !Number.isSafeInteger(input.schedule_update.expected_project_revision)
      || !Number.isSafeInteger(input.schedule_update.expected_schedule_revision))
      throw new ProtocolEnvelopeError("work schedule update has invalid schema or revision preconditions");
    const response = await this.call("work_schedule_update_v1", requestEnvelope(request.operation_id, input,
      input.schedule_update.expected_project_revision), true);
    return unwrapReadback(response, normalizeScheduleReadback) as Envelope<WorkScheduleMutationReadbackDto>;
  }

  async readExternalWaits(project_id: string, wait_id?: string): Promise<Envelope<ExternalWaitReadbackDto>> {
    this.assertProject(project_id, "external wait readback");
    if (wait_id !== undefined) requiredString(wait_id, "external_wait_readback.wait_id");
    const response = await this.call("external_wait_readback_v1", requestEnvelope(operationId(), {
      project_id, ...(wait_id ? { wait_id } : {}),
    }, null));
    return unwrapReadback(response, normalizeWaitReadback) as Envelope<ExternalWaitReadbackDto>;
  }

  async createExternalWait(request: RequestEnvelope<{ project_id: string; wait_create: ExternalWaitCreateDto }>): Promise<Envelope<ExternalWaitMutationReadbackDto>> {
    const input = request.data;
    this.assertProject(input.project_id, "external wait create");
    if (input.wait_create.schema_version !== "boreal.external_wait_create.v1"
      || input.wait_create.expected_wait_revision !== 0
      || !Number.isSafeInteger(input.wait_create.expected_project_revision))
      throw new ProtocolEnvelopeError("external wait create has invalid schema or revision preconditions");
    const response = await this.call("external_wait_create_v1", requestEnvelope(request.operation_id, input,
      input.wait_create.expected_project_revision), true);
    return unwrapReadback(response, normalizeWaitReadback) as Envelope<ExternalWaitMutationReadbackDto>;
  }

  async resolveExternalWait(request: RequestEnvelope<{ project_id: string; wait_resolve: ExternalWaitResolveDto }>): Promise<Envelope<ExternalWaitMutationReadbackDto>> {
    const input = request.data;
    this.assertProject(input.project_id, "external wait resolution");
    if (input.wait_resolve.schema_version !== "boreal.external_wait_resolve.v1"
      || !Number.isSafeInteger(input.wait_resolve.expected_project_revision)
      || !Number.isSafeInteger(input.wait_resolve.expected_wait_revision))
      throw new ProtocolEnvelopeError("external wait resolution has invalid schema or revision preconditions");
    const response = await this.call("external_wait_resolve_v1", requestEnvelope(request.operation_id, input,
      input.wait_resolve.expected_project_revision), true);
    return unwrapReadback(response, normalizeWaitReadback) as Envelope<ExternalWaitMutationReadbackDto>;
  }

  async readProjectCivilTime(project_id: string): Promise<Envelope<ProjectCivilTimeReadbackDto>> {
    this.assertProject(project_id, "project civil-time readback");
    const response = await this.call("project_civil_time_readback_v1", requestEnvelope(operationId(), { project_id }, null));
    return unwrapReadback(response, normalizeCivilTimeReadback) as Envelope<ProjectCivilTimeReadbackDto>;
  }

  readReceiptsForAttempt(project_id: string, work_id: string, attempt_id: string, fence: number, limit = 50, offset = 0): Promise<Envelope<AttemptReceiptPage>> {
    this.assertProject(project_id, "attempt receipt history");
    requiredString(work_id, "receipts_for_attempt.work_id");
    requiredString(attempt_id, "receipts_for_attempt.attempt_id");
    if (!Number.isSafeInteger(fence) || fence < 0) throw new ProtocolEnvelopeError("receipts_for_attempt.fence must be a non-negative integer");
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0)
      throw new ProtocolEnvelopeError("receipts_for_attempt requires a page limit of 1..100 and a non-negative offset");
    return this.call("receipts_for_attempt", requestEnvelope(operationId(), {
      project_id, actor_id: this.actor_id, session_id: this.session_id, work_id, attempt_id, fence, limit, offset,
    }, null));
  }

  async bindFinalResult(request: RequestEnvelope<BindFinalResultInput>): Promise<Envelope<FinalResultBinding>> {
    const input = request.data;
    this.assertProject(input.project_id, "final result binding");
    requiredString(input.work_id, "bind_final_result.work_id");
    requiredString(input.attempt_id, "bind_final_result.attempt_id");
    requiredString(input.actor_id, "bind_final_result.actor_id");
    requiredString(input.session_id, "bind_final_result.session_id");
    requiredString(input.source_version_id, "bind_final_result.source_version_id");
    if (!/^sha256:[0-9a-f]{64}$/u.test(input.content_digest))
      throw new ProtocolEnvelopeError("bind_final_result.content_digest must be a lowercase sha256 digest");
    for (const [field, value] of [["fence", input.fence], ["expected_revision", input.expected_revision],
      ["expected_entity_revision", input.expected_entity_revision], ["expected_proof_revision", input.expected_proof_revision]] as const) {
      if (!Number.isSafeInteger(value) || value <= 0) throw new ProtocolEnvelopeError(`bind_final_result.${field} must be a positive integer`);
    }
    const response = await this.call<FinalResultBinding, BindFinalResultInput>("bind_final_result",
      requestEnvelope(request.operation_id, input, input.expected_revision, input.attempt_id, input.fence), true);
    if (response.outcome !== "changed" && response.outcome !== "unchanged") return response;
    if (!response.data) throw new ProtocolEnvelopeError("final result binding response is missing its binding DTO");
    return { ...response, data: normalizeFinalResultBinding(response.data) };
  }

  readWorkspaceView(kind: WorkspaceViewKind, project_id: string): Promise<Envelope<unknown>> {
    requiredString(project_id, "workspace_view.project_id");
    if (this.project_id && project_id !== this.project_id) {
      throw new ProtocolEnvelopeError("workspace view belongs to a different mounted project");
    }
    switch (kind) {
      case "cycles":
        return this.readCycle(project_id, "list", undefined, 100, 0);
      case "reviews":
        return this.call("review_list", requestEnvelope(operationId(), { project_id, limit: 100, offset: 0 }, null));
      case "memory":
        return this.memoryCommand(requestEnvelope(operationId(), { project_id, memory: {
          expected_revision: null,
          confirmed: false,
          change: { kind: "search", text: null, entry_id: null, source_version_id: null, requested_git_revision: null, limit: 20 },
        } }, null));
      case "recovery":
        return this.recoveryCommand(requestEnvelope(operationId(), { project_id, recovery: { action: "list", limit: 100 } }, null));
      case "dependencies":
        return this.readDependencyGraph(project_id, "dependency_tree");
      case "sources":
        return this.readSources(project_id, 100, 0);
      case "session":
        return this.readSession(project_id);
      case "waits":
        return this.readExternalWaits(project_id);
    }
  }

  editWork(request: RequestEnvelope<WorkEditInput>): Promise<Envelope<unknown>> {
    return this.call("work_edit", requestEnvelope(request.operation_id, request.data, request.data.expected_revision), true);
  }

  addDependency(request: RequestEnvelope<DependencyChangeInput>): Promise<Envelope<unknown>> {
    // DependencyAddRequest is deny_unknown_fields and does not accept credentials;
    // its service route authorizes with the authenticated actor and session.
    return this.call("dependency_add", requestEnvelope(request.operation_id, request.data, request.data.expected_revision), true, false);
  }

  removeDependency(request: RequestEnvelope<DependencyChangeInput>): Promise<Envelope<unknown>> {
    return this.call("dependency_remove", requestEnvelope(request.operation_id, request.data, request.data.expected_revision), true);
  }

  readDependencyGraph(project_id: string, command: "dependency_tree" | "dependency_cycles" = "dependency_tree"): Promise<Envelope<unknown>> {
    this.assertProject(project_id, "dependency graph");
    return this.call(command, requestEnvelope(operationId(), { project_id }, null));
  }

  readCycle(project_id: string, view: CycleReadView, cycle_id?: string, limit = 50, offset = 0): Promise<Envelope<unknown>> {
    this.assertProject(project_id, "cycle read");
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0)
      throw new ProtocolEnvelopeError("cycle read requires a page limit of 1..100 and a non-negative offset");
    if ((view === "board" || view === "report") && !cycle_id)
      throw new ProtocolEnvelopeError(`cycle ${view} requires a cycle_id`);
    const data = { project_id, view, ...(cycle_id ? { cycle_id } : {}), limit, offset };
    return this.call("cycle_read", requestEnvelope(operationId(), data, null));
  }

  changeCycle(request: RequestEnvelope<{ project_id: string; cycle_change: CycleCommandInput }>): Promise<Envelope<unknown>> {
    const input = request.data.cycle_change;
    requiredString(input.reason, "cycle_change.reason");
    if (!input.confirmed) throw new ProtocolEnvelopeError("cycle changes require explicit confirmation");
    return this.call("cycle_change", requestEnvelope(request.operation_id, request.data, input.expected_revision), true);
  }

  readSources(project_id: string, limit = 50, offset = 0): Promise<Envelope<SourceListReadback>> {
    this.assertProject(project_id, "source list");
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0)
      throw new ProtocolEnvelopeError("source list requires a page limit of 1..100 and a non-negative offset");
    const op = operationId();
    const data = { project_id, command: "source_list", operation_id: op, limit, offset };
    return this.call("source_list", requestEnvelope(op, data, null));
  }

  searchSources(project_id: string, query: string, limit = 20): Promise<Envelope<unknown>> {
    this.assertProject(project_id, "source search");
    requiredString(query, "source_search.query");
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new ProtocolEnvelopeError("source search limit must be 1..100");
    return this.call("source_search", requestEnvelope(operationId(), { project_id, query, limit }, null));
  }

  captureSource(request: RequestEnvelope<{ project_id: string; input: string; origin: string; media_type?: string; expected_revision: number }>): Promise<Envelope<unknown>> {
    requiredString(request.data.input, "source_add.input");
    requiredString(request.data.origin, "source_add.origin");
    const data = { ...request.data, operation_id: request.operation_id };
    return this.call("source_add", requestEnvelope(request.operation_id, data, request.data.expected_revision), true);
  }

  readReview(project_id: string, review_id: string): Promise<Envelope<unknown>> {
    this.assertProject(project_id, "review read");
    requiredString(review_id, "review_show.review_id");
    return this.call("review_show", requestEnvelope(operationId(), { project_id, review_id }, null));
  }

  memoryCommand(request: RequestEnvelope<{ project_id: string; memory: MemoryCommandInput }>): Promise<Envelope<unknown>> {
    const operation = request.data.memory.change.kind;
    const mutation = ["draft", "review", "publish", "reconcile"].includes(operation);
    return this.call("memory_command", requestEnvelope(request.operation_id, request.data, request.data.memory.expected_revision), mutation);
  }

  recoveryCommand(request: RequestEnvelope<{ project_id: string; recovery: RecoveryCommandInput }>): Promise<Envelope<unknown>> {
    const mutation = request.data.recovery.action !== "list";
    return this.call("recovery_command", requestEnvelope(request.operation_id, request.data, "expected_revision" in request.data.recovery ? request.data.recovery.expected_revision : null), mutation);
  }

  completion(request: RequestEnvelope<{ project_id: string; completion: CompletionCommandInput }>): Promise<Envelope<unknown>> {
    return this.call("completion", requestEnvelope(request.operation_id, request.data, request.data.completion.expected_revision), true);
  }

  readSession(project_id: string): Promise<Envelope<unknown>> {
    this.assertProject(project_id, "session read");
    return this.call("session_show", requestEnvelope(operationId(), { project_id }, null));
  }

  endSession(request: RequestEnvelope<{ project_id: string; expected_revision: number }>): Promise<Envelope<unknown>> {
    return this.call("session_end", requestEnvelope(request.operation_id, request.data, request.data.expected_revision), true);
  }

  private assertProject(project_id: string, route: string): void {
    requiredString(project_id, `${route}.project_id`);
    if (this.project_id && project_id !== this.project_id)
      throw new ProtocolEnvelopeError(`${route} belongs to a different mounted project`);
  }

  createProject(request: RequestEnvelope<CreateProjectInput>): Promise<Envelope<unknown>> {
    const validated = validateRequestEnvelope<CreateProjectInput>(request);
    validateCreateProjectInput(validated.data);
    const wireRequest: RequestEnvelope<CreateProjectWireInput> = {
      ...validated,
      data: {
        project_id: validated.data.project_id,
        actor_id: validated.data.actor_id,
        actor_role: validated.data.actor_role,
        credential_ref: validated.data.credential_ref,
        name: validated.data.display_name,
      },
    };
    return this.call<unknown, CreateProjectWireInput>("create_project", wireRequest, true);
  }

  createWork(request: RequestEnvelope<CreateWorkInput>): Promise<Envelope<unknown>> {
    const validated = validateRequestEnvelope<CreateWorkInput>(request);
    validateCreateWorkInput(validated.data);
    const wireRequest: RequestEnvelope<CreateWorkWireInput> = {
      ...validated,
      data: {
        project_id: validated.data.project_id,
        work_id: validated.data.work_id,
        actor_id: validated.data.actor_id,
        kind: validated.data.kind,
        title: validated.data.title,
        parent_id: validated.data.parent_id,
        description: validated.data.description,
        priority: validated.data.priority,
        dispatch: validated.data.dispatch_policy,
        profile: validated.data.acceptance_profile.id,
        // The current Rust DTO accepts the profile id only. Preserve the
        // requested version on the wire so a version-aware adapter can
        // bind it; older services ignore this optional field.
        profile_version: validated.data.acceptance_profile.version,
        ...(validated.data.execution_mode ? { execution_mode: validated.data.execution_mode } : {}),
      },
    };
    return this.call<unknown, CreateWorkWireInput>("create_work", wireRequest, true);
  }

  claim(request: RequestEnvelope<ClaimInput>): Promise<Envelope<unknown>> {
    return this.call<unknown, ClaimInput>("claim", request, true);
  }

  acceptStart(request: RequestEnvelope<AcceptStartInput>): Promise<Envelope<unknown>> {
    return this.call<unknown, AcceptStartInput>("start", request, true);
  }

  addEvidence(request: RequestEnvelope<EvidenceInput>): Promise<Envelope<unknown>> {
    return this.call<unknown, EvidenceInput>("evidence_add", request, true);
  }

  finish(request: RequestEnvelope<FinishInput>): Promise<Envelope<unknown>> {
    const summary = request.data.summary?.trim();
    if (!summary) throw new ProtocolEnvelopeError("finish_close requires a non-empty typed summary");
    const wireRequest: RequestEnvelope<FinishWireInput> = {
      ...request,
      data: {
        ...request.data,
        summary_body: summary,
      },
    };
    delete (wireRequest.data as Partial<FinishInput>).summary;
    return this.call<unknown, FinishWireInput>("finish_close", wireRequest, true);
  }

  release(request: RequestEnvelope<ReleaseInput>): Promise<Envelope<unknown>> {
    return this.call<unknown, ReleaseInput>("release", request, true);
  }

  close(): void | Promise<void> {
    return this.transport.close?.();
  }

  private async call<Response, Request>(command: string, request: RequestEnvelope<Request>, mutation = false, includeCredential = true): Promise<Envelope<Response>> {
    const validated = validateRequestEnvelope(request);
    if (isObject(validated.data)) {
      if (this.project_id && validated.data.project_id && validated.data.project_id !== this.project_id) throw new ProtocolEnvelopeError("request belongs to a different project");
      if (this.actor_id && validated.data.actor_id && validated.data.actor_id !== this.actor_id) throw new ProtocolEnvelopeError("request belongs to a different principal");
    }
    const data = isObject(validated.data) ? {
      ...validated.data,
      ...(includeCredential && this.credential_ref ? { credential_ref: this.credential_ref } : {}),
      command,
      ...(this.project_id && !validated.data.project_id ? { project_id: this.project_id } : {}),
      ...(this.actor_id && !validated.data.actor_id ? { actor_id: this.actor_id } : {}),
      ...(this.harness_id && !validated.data.harness_id ? { harness_id: this.harness_id } : {}),
      ...(this.session_id && !validated.data.session_id ? { session_id: this.session_id } : {}),
    } : validated.data;
    if (!isObject(data)) throw new ProtocolEnvelopeError("service command data must be an object");
    if (validated.expected_revision !== null) data.expected_revision = validated.expected_revision;
    if (validated.attempt_id !== null) data.attempt_id = validated.attempt_id;
    if (validated.attempt_fence !== null) data.attempt_fence = validated.attempt_fence;
    const body = {
      api_version: API_VERSION,
      schema_version: ENVELOPE_SCHEMA,
      operation_id: validated.operation_id,
      data,
    };
    const encoded = jsonBytes(body, "service request");
    if (encoded.length > this.max_payload_bytes) {
      throw new ProtocolEnvelopeError(`request payload is ${encoded.length} bytes; maximum is ${this.max_payload_bytes}`);
    }
    let responseFrame: Uint8Array;
    try {
      responseFrame = await this.transport.roundTrip(encodeJsonFrame(new TextDecoder().decode(encoded), this.max_payload_bytes));
    } catch (error) {
      return failureEnvelope(
        validated.operation_id,
        mutation ? "unknown_outcome" : "service_unavailable",
        mutation
          ? `mutation delivery is unknown; read operation ${validated.operation_id} before retrying: ${String(error)}`
          : String(error),
        mutation ? "unknown" : "failed",
      ) as Envelope<Response>;
    }
    try {
      const decoded = decodeJsonFrame(responseFrame, this.max_payload_bytes);
      const parsed = JSON.parse(decoded) as unknown;
      const envelope = validateEnvelope<Response>(outerResponse(parsed, validated.operation_id));
      if (isObject(envelope.data) && envelope.data.project_id !== undefined && this.project_id && envelope.data.project_id !== this.project_id) {
        throw new ProtocolEnvelopeError("response belongs to a different project; it was not applied");
      }
      if (isObject(envelope.data) && ["changed", "unchanged"].includes(envelope.outcome)) {
        const scope = envelope.data._scope;
        if (scope !== undefined || this.credential_ref) {
          if (!isObject(scope) || scope.project_id !== this.project_id
            || typeof scope.database_instance_id !== "string" || !scope.database_instance_id
            || !Number.isSafeInteger(scope.restore_epoch) || Number(scope.restore_epoch) < 1
            || typeof scope.workspace_binding_digest !== "string" || !scope.workspace_binding_digest.startsWith("sha256:")) {
            throw new ProtocolEnvelopeError("response has no valid project and database identity; it was not applied");
          }
          const identity = JSON.stringify([scope.project_id, scope.database_instance_id, scope.restore_epoch, scope.workspace_binding_digest]);
          if (this.scopeIdentity !== null && this.scopeIdentity !== identity) {
            throw new ProtocolEnvelopeError("project database changed or was restored; reconnect before using cached work or retrying an operation");
          }
          this.scopeIdentity = identity;
        }
      }
      return envelope;
    } catch (error) {
      if (!mutation) {
        if (error instanceof ProtocolEnvelopeError) throw error;
        throw new ProtocolEnvelopeError(String(error));
      }
      return failureEnvelope(
        validated.operation_id,
        "unknown_outcome",
        `mutation response could not be validated; read operation ${validated.operation_id} before retrying: ${error instanceof Error ? error.message : String(error)}`,
        "unknown",
      ) as Envelope<Response>;
    }
  }
}

export function buildMonitoringModel(envelope: Envelope<RevisionedStatusResponse>): MonitoringModel {
  const validated = validateEnvelope<RevisionedStatusResponse>(envelope);
  if (!validated.data || validated.revision === null) {
    throw new ProtocolEnvelopeError("monitoring response has no revisioned data");
  }
  if (!Array.isArray(validated.data.items)) throw new ProtocolEnvelopeError("monitoring items must be an array");
  const diagnostics = normalizeDiagnostics(validated.data.diagnostics);
  const items = validated.data.items.map(normalizeStatusItem).map((item) => {
    const diagnostic = diagnostics.find((entry) => entry.work_id === item.work_id);
    return diagnostic ? { ...item, diagnostic } : item;
  });
  const knownIds = new Set(items.map((item) => item.work_id));
  const diagnosticItems: StatusItem[] = diagnostics.filter((diagnostic) => !knownIds.has(diagnostic.work_id)).map((diagnostic) => ({
    work_id: diagnostic.work_id,
    status: "corrupt",
    display_status: "corrupt",
    reason_codes: [diagnostic.code],
    claimable: false,
    claimable_for_actor: false,
    next_action: null,
    title: diagnostic.title ?? `${diagnostic.work_id} · unreadable record`,
    kind: "work",
    diagnostic,
  }));
  const displayItems = [...items, ...diagnosticItems];
  const responseRevision = validated.data.revision;
  if (responseRevision !== undefined && responseRevision !== validated.revision) {
    throw new ProtocolEnvelopeError("monitoring response mixes revisions");
  }
  const projectRevision = (validated.data as RevisionedStatusResponse & { project_revision?: number }).project_revision;
  if (projectRevision !== undefined && projectRevision !== validated.revision) {
    throw new ProtocolEnvelopeError("monitoring response project_revision does not match envelope revision");
  }
  // The envelope timestamp is the single snapshot timestamp. Some service
  // implementations also echo `data.as_of`; tolerate an independently read
  // echo and never reject a valid snapshot because the two clocks were sampled
  // at different instants.
  const total = validated.data.total ?? validated.data.counts?.matched ?? validated.data.counts?.total ?? displayItems.length;
  asNumber(total, "total");
  const limit = validated.data.limit === undefined ? MAX_INLINE_ITEMS : asNumber(validated.data.limit, "limit");
  const offset = validated.data.offset === undefined ? 0 : asNumber(validated.data.offset, "offset");
  const hasMore = validated.data.has_more ?? offset + displayItems.length < total;
  const nextOffset = validated.data.next_offset === undefined
    ? (hasMore ? offset + displayItems.length : null)
    : validated.data.next_offset;
  const itemDeadline = items
    .map((item) => item.next_status_change_at)
    .filter((value): value is string => typeof value === "string")
    .sort()[0] ?? null;
  return {
    project_actions: validated.data.project_actions,
    revision: validated.revision,
    as_of: validated.as_of,
    next_status_change_at: validated.next_status_change_at ?? validated.data.next_status_change_at ?? itemDeadline,
    total,
    counts: normalizeCounts(validated.data.counts, displayItems, total),
    items: displayItems.slice(0, MAX_INLINE_ITEMS),
    attention_queues: normalizeAttentionQueues(validated.data.attention_queues),
    diagnostics,
    truncated: displayItems.length > MAX_INLINE_ITEMS || hasMore || total > displayItems.length,
    project_id: typeof validated.data.project_id === "string" ? validated.data.project_id : undefined,
    project_name: typeof validated.data.project_name === "string" ? validated.data.project_name : undefined,
    active_cycle_id: typeof validated.data.active_cycle_id === "string" || validated.data.active_cycle_id === null
      ? validated.data.active_cycle_id : undefined,
    active_sprint_id: typeof validated.data.active_sprint_id === "string" || validated.data.active_sprint_id === null
      ? validated.data.active_sprint_id : undefined,
    contract_version: typeof validated.data.contract_version === "string" ? validated.data.contract_version : undefined,
    limit,
    offset,
    has_more: hasMore,
    next_offset: nextOffset === null ? null : asNumber(nextOffset, "next_offset"),
    timing: validated.timing ?? validated.data.timing,
    recovery: validated.recovery ?? validated.data.recovery,
  };
}

function normalizeAttentionQueues(value: unknown): AttentionQueuesModel | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value)) throw new ProtocolEnvelopeError("attention_queues must be an object");
  const queue = (key: keyof AttentionQueuesModel): AttentionQueueModel => {
    const raw = value[key];
    if (!isObject(raw) || !Array.isArray(raw.items)) {
      throw new ProtocolEnvelopeError(`attention_queues.${key} must contain items`);
    }
    const total = asNumber(raw.total, `attention_queues.${key}.total`);
    if (!Number.isSafeInteger(total) || total < 0 || total < raw.items.length) {
      throw new ProtocolEnvelopeError(`attention_queues.${key}.total is invalid`);
    }
    const items = raw.items.map((entry) => {
      if (!isObject(entry) || typeof entry.work_id !== "string"
        || typeof entry.display_status !== "string" || typeof entry.title !== "string"
        || !Array.isArray(entry.reason_codes)
        || !entry.reason_codes.every((reason) => typeof reason === "string")) {
        throw new ProtocolEnvelopeError(`attention_queues.${key} contains an invalid item`);
      }
      return normalizeStatusItem({
        work_id: entry.work_id,
        title: entry.title,
        status: entry.display_status,
        display_status: entry.display_status,
        reason_codes: entry.reason_codes,
        claimable: false,
        next_action: null,
      });
    });
    if (raw.returned !== undefined && raw.returned !== items.length) {
      throw new ProtocolEnvelopeError(`attention_queues.${key}.returned does not match items`);
    }
    const hasMore = raw.has_more === undefined ? total > items.length : raw.has_more;
    if (typeof hasMore !== "boolean" || hasMore !== (total > items.length)) {
      throw new ProtocolEnvelopeError(`attention_queues.${key}.has_more is invalid`);
    }
    return { total, has_more: hasMore, items };
  };
  return {
    review: queue("review"),
    rejected_review: queue("rejected_review"),
    expiry: queue("expiry"),
    failed_execution: queue("failed_execution"),
    operator_holds: queue("operator_holds"),
    damaged_planning: queue("damaged_planning"),
  };
}

/** Existing API retained; it now returns the richer one-revision monitoring model. */
export function buildStatusView(envelope: Envelope<RevisionedStatusResponse>): StatusView {
  return buildMonitoringModel(envelope);
}

/** Coalesces revision/timer notifications into one read at a time. */
export class RevisionRefreshCoordinator {
  private inFlight: Promise<StatusView> | null = null;
  private revision: number | null = null;
  private resnapshotRequested = false;

  constructor(private readonly reader: StatusReader) {}

  refresh(options: { resnapshot?: boolean } = {}): Promise<StatusView> {
    if (options.resnapshot) this.resnapshotRequested = true;
    if (this.inFlight) {
      const current = this.inFlight;
      return options.resnapshot ? current.then(() => this.refresh({ resnapshot: true })) : current;
    }
    this.inFlight = this.readLatest();
    return this.inFlight;
  }

  notifyRevision(observedRevision?: number): Promise<StatusView> {
    if (observedRevision !== undefined) {
      asNumber(observedRevision, "observed_revision");
      if (this.revision !== null && observedRevision === this.revision && this.model) return Promise.resolve(this.model);
      const missed = this.revision !== null
        && (observedRevision < this.revision || observedRevision > this.revision + 1);
      return this.refresh({ resnapshot: missed });
    }
    return this.refresh();
  }

  /** A deadline notification must refresh even when no database revision changed. */
  notifyDeadline(): Promise<StatusView> {
    return this.refresh();
  }

  private model: StatusView | null = null;

  private async readLatest(): Promise<StatusView> {
    const cursor_revision = this.resnapshotRequested ? null : this.revision;
    this.resnapshotRequested = false;
    try {
      const model = buildMonitoringModel(validateEnvelope<RevisionedStatusResponse>(await this.reader.readStatus({ cursor_revision })));
      this.revision = model.revision;
      this.model = model;
      return model;
    } finally {
      this.inFlight = null;
    }
  }
}

export function contextualAction(item: StatusItem): string {
  const status = item.display_status ?? item.status;
  if (status === "blocked") return "resolve hold";
  if (status === "queued") return "wait for prerequisite";
  if (status === "expired_review") return "review expiry";
  if (item.gates?.open.some((gate) => gate.required)) return "satisfy gate";
  if (item.claimable) return "claim";
  return item.next_action ?? "inspect";
}

/** Stable state consumed by a renderer; an open required gate is explicit. */
export function workflowDisplayState(item: StatusItem): string {
  if (item.gates?.open.some((gate) => gate.required) || ["needs_verification", "awaiting_review"].includes(statusOf(item))) {
    return "gate";
  }
  return statusOf(item);
}

function statusOf(item: StatusItem): WorkStatus {
  return item.display_status ?? item.status;
}

function gateIsOpen(item: StatusItem): boolean {
  return (item.gates?.open.some((gate) => gate.required) ?? false)
    || ["needs_verification", "awaiting_review"].includes(statusOf(item));
}

/** The presentation policy mirrors service-provided status; it never derives claimability. */
export interface ActionAvailabilityContext {
  authority_fresh?: boolean;
  /** The current service route requires a receipt before finish_close. */
  receipt_available?: boolean;
  pending_operation?: PendingOperation;
}

const serverActionNames: Partial<Record<TuiAction, string[]>> = {
  claim: ["claim"],
  accept_start: ["accept_attempt", "start_attempt"],
  evidence: ["attach_evidence"],
  finish: ["finish_close"],
  release: ["release"],
};

function serverActionAvailability(
  item: StatusItem,
  busy: ReadonlySet<TuiAction>,
  context: ActionAvailabilityContext,
): ActionAvailability[] {
  const server = item.actions;
  if (!server) return [];
  const pendingOperation = context.pending_operation;
  const disabled = (action: TuiAction, descriptor: ServerActionDescriptor | undefined, reason: string | null): ActionAvailability => ({
    action,
    enabled: !!descriptor && !busy.has(action) && !pendingOperation,
    reason: busy.has(action)
      ? "operation already in progress"
      : pendingOperation
        ? `operation ${pendingOperation.operation_id} has unknown outcome; read it back before retrying`
        : reason,
    requires_confirmation: descriptor?.confirmation !== null && descriptor?.confirmation !== undefined,
  });
  return (["claim", "accept_start", "evidence", "finish", "release"] as const).map((action) => {
    const names = serverActionNames[action] ?? [];
    const allowed = server.allowed.find((descriptor) => names.includes(descriptor.action));
    if (allowed) return disabled(action, allowed, null);
    const denial = server.denied.find((entry) => names.includes(entry.descriptor.action));
    const reason = denial
      ? `${denial.reason.code}${denial.reason.detail ? `: ${denial.reason.detail}` : ""}`
      : "action is not available at this revision";
    return disabled(action, undefined, reason);
  });
}

export function actionAvailability(
  item: StatusItem,
  busy: ReadonlySet<TuiAction> = new Set(),
  context: ActionAvailabilityContext = {},
): ActionAvailability[] {
  if (context.authority_fresh === false) {
    return (["claim", "accept_start", "evidence", "finish", "release"] as const).map((action) => ({
      action, enabled: false, reason: context.pending_operation ? `operation ${context.pending_operation.operation_id} has unknown outcome; read it back before retrying` : "Connection or snapshot permissions are stale. Refresh before making changes.", requires_confirmation: true,
    }));
  }
  if (item.diagnostic) {
    return (["claim", "accept_start", "evidence", "finish", "release"] as const).map((action) => ({
      action,
      enabled: false,
      reason: `unavailable: ${item.diagnostic?.code ?? "corrupt record"}`,
      requires_confirmation: true,
    }));
  }
  if (item.actions) return serverActionAvailability(item, busy, context).map((entry) => {
    if (entry.action === "finish" && entry.enabled && context.receipt_available !== true) {
      return { ...entry, enabled: false, reason: "Select a receipt payload from this exact attempt and fence before finishing." };
    }
    return entry;
  });
  // A status label is a display fact, never authorization. Older/partial
  // servers remain readable but cannot silently enable local mutation policy.
  return (["claim", "accept_start", "evidence", "finish", "release"] as const).map((action) => ({
    action, enabled: false, reason: "The service has not supplied action permissions. Refresh or check the connection.", requires_confirmation: true,
  }));
}

export interface MountedView {
  mounted: boolean;
  route: Route;
  monitoring: MonitoringModel | null;
  selected_work: StatusItem | null;
  actions: ActionAvailability[];
  notice: ControllerNotice | null;
  stale_revision: StaleRevisionDisplay | null;
  busy_actions: TuiAction[];
  pending_operations: PendingOperation[];
  capabilities?: readonly DashboardCapability[];
  selected_receipt_available?: boolean;
  selected_receipt_id?: string;
  receipt_readback_available?: boolean;
  workspace_actions_available?: readonly string[];
  workspace_views_available?: readonly string[];
}

export interface TuiWorkflowContext {
  project_id: string;
  actor_id: string;
  harness_id: string;
  session_id: string;
  now?: () => Date;
  lease_ttl_ms?: number;
  hard_deadline_ms?: number;
}

export interface TuiWorkflowControllerOptions {
  context: TuiWorkflowContext;
  notifications?: RefreshNotificationSource;
}

let operationSequence = 0;

function operationId(): string {
  operationSequence += 1;
  return `op_tui_${Date.now().toString(36)}_${operationSequence}`;
}

function attemptId(): string {
  return `attempt_tui_${Date.now().toString(36)}_${operationSequence + 1}`;
}

function requestEnvelope<T>(operation_id: string, data: T, revision: number | null, attempt_id: string | null = null, attempt_fence: number | null = null): RequestEnvelope<T> {
  return {
    api_version: API_VERSION,
    schema_version: ENVELOPE_SCHEMA,
    operation_id,
    expected_revision: revision,
    attempt_id,
    attempt_fence,
    data,
  };
}

export class TuiWorkflowController {
  private readonly refreshCoordinator: RevisionRefreshCoordinator;
  private readonly receipts = new Map<string, { attempt_id: string; fence: number; receipt_id?: string; receipt: unknown }>();
  private readonly receiptHistory = new Map<string, Map<string, AttemptReceiptRecord>>();
  private model: MonitoringModel | null = null;
  private mounted = false;
  private authorityFresh = false;
  private minimumObservedRevision = 0;
  private route: Route = { kind: "monitoring" };
  private notice: ControllerNotice | null = null;
  private readonly busy = new Set<TuiAction>();
  private readonly workspaceBusy = new Set<WorkspaceAction>();
  private readonly pending = new Map<string, PendingOperation>();
  private readonly receiptHydration = new Set<string>();
  private readonly context: TuiWorkflowContext;
  private readonly notifications?: RefreshNotificationSource;
  private unsubscribeNotifications: (() => void) | null = null;

  constructor(private readonly service: VersionedServiceApi, options: TuiWorkflowControllerOptions) {
    this.refreshCoordinator = new RevisionRefreshCoordinator(service);
    if (!options?.context) throw new ProtocolEnvelopeError("mounted controller requires a persistent context");
    for (const [field, value] of Object.entries(options.context)) {
      if (["project_id", "actor_id", "harness_id", "session_id"].includes(field)
        && (typeof value !== "string" || value.trim().length === 0)) {
        throw new ProtocolEnvelopeError(`mounted context requires ${field}`);
      }
    }
    this.context = { ...options.context };
    this.notifications = options.notifications ?? service.notifications;
  }

  async mount(route?: Route): Promise<MountedView> {
    const mountedRoute = route ?? { kind: "monitoring", project_id: this.context.project_id };
    if (mountedRoute.project_id && mountedRoute.project_id !== this.context.project_id) {
      throw new ProtocolEnvelopeError("route project_id does not match the mounted project context");
    }
    this.mounted = true;
    this.route = { ...mountedRoute, project_id: this.context.project_id };
    if (!this.unsubscribeNotifications && this.notifications) {
      this.unsubscribeNotifications = this.notifications.subscribe((notification) => {
        const refresh = notification.kind === "deadline"
          ? this.notifyDeadline()
          : this.notifyRevision(notification.revision);
        void refresh.catch((error) => {
          this.notice = { kind: "error", message: error instanceof Error ? error.message : String(error) };
        });
      });
    }
    await this.refresh();
    while (this.route.work_id && !this.model?.items.some((item) => item.work_id === this.route.work_id)
      && this.model?.has_more) {
      await this.nextPage();
    }
    return this.view();
  }

  unmount(): void {
    this.mounted = false;
    this.authorityFresh = false;
    this.unsubscribeNotifications?.();
    this.unsubscribeNotifications = null;
  }

  async readWorkspaceView(kind: WorkspaceViewKind): Promise<Envelope<unknown>> {
    if (!this.mounted) throw new ProtocolEnvelopeError("workspace views require a mounted project context");
    if (kind === "waits" && this.service.readExternalWaits) {
      const response = await this.readWorkspace("external waits", () => this.service.readExternalWaits!(this.context.project_id));
      return response;
    }
    if (!this.service.readWorkspaceView) throw new ProtocolEnvelopeError("this service connection does not provide workspace views");
    const response = await this.service.readWorkspaceView(kind, this.context.project_id);
    if (response.outcome !== "changed" && response.outcome !== "unchanged") {
      throw new TuiServiceError(
        response.error?.code ?? response.outcome,
        response.error?.message ?? `${kind} view request did not succeed`,
        response.operation_id,
        response,
      );
    }
    if (isObject(response.data) && typeof response.data.project_id === "string" && response.data.project_id !== this.context.project_id) {
      throw new ProtocolEnvelopeError("workspace view belongs to another project; it was not displayed");
    }
    return response;
  }

  async readCycle(view: CycleReadView, cycle_id?: string, limit = 50, offset = 0): Promise<Envelope<unknown>> {
    if (!this.mounted || !this.service.readCycle) throw new ProtocolEnvelopeError("cycle reads are unavailable in this connection");
    return this.readWorkspace("cycle", () => this.service.readCycle!(this.context.project_id, view, cycle_id, limit, offset));
  }

  async readSources(limit = 50, offset = 0): Promise<Envelope<SourceListReadback>> {
    if (!this.mounted || !this.service.readSources) throw new ProtocolEnvelopeError("source selection is unavailable in this connection");
    const response = await this.readWorkspace("source list", () => this.service.readSources!(this.context.project_id, limit, offset));
    const data = response.data;
    if (!data || data.project_id !== this.context.project_id || !Array.isArray(data.items)
      || typeof data.total !== "number" || typeof data.offset !== "number" || typeof data.limit !== "number" || typeof data.has_more !== "boolean"
      || typeof data.catalog_root !== "string" || data.items.some(item => !item || item.project_id !== this.context.project_id
        || typeof item.source_version_id !== "string" || !item.source_version_id.trim()
        || typeof item.origin !== "string" || typeof item.media_type !== "string"
        || typeof item.byte_count !== "number" || typeof item.content_digest !== "string"
        || typeof item.availability !== "string"))
      throw new ProtocolEnvelopeError("source list response is malformed or belongs to a different project");
    return response;
  }

  async readWork(work_id: string): Promise<Envelope<WorkProjection>> {
    if (!this.mounted || !this.service.readWork) throw new ProtocolEnvelopeError("work detail is unavailable in this connection");
    const response = await this.readWorkspace("work detail", () => this.service.readWork!(this.context.project_id, work_id));
    const data = response.data;
    if (!data || data.project_id !== this.context.project_id || data.work_id !== work_id
      || !["milestone", "sprint", "task"].includes(data.kind)
      || (data.parent_id !== null && typeof data.parent_id !== "string")
      || typeof data.lifecycle !== "string"
      || !["automatic", "operator_only", "paused"].includes(data.dispatch_policy)
      || !Number.isInteger(data.priority) || data.priority < 0 || data.priority > 255
      || !Array.isArray(data.hard_holds) || data.hard_holds.some(hold => typeof hold !== "string")
      || typeof data.title !== "string" || typeof data.description !== "string"
      || (data.execution_mode !== undefined && data.execution_mode !== null && !["direct", "container"].includes(data.execution_mode))
      || (data.planning_integrity !== undefined && !["valid", "missing", "inconsistent", "unavailable", "unreadable", "legacy"].includes(data.planning_integrity))
      || (data.planning_parent_id !== undefined && data.planning_parent_id !== null && typeof data.planning_parent_id !== "string")
      || (data.planning_diagnostic !== undefined && data.planning_diagnostic !== null && typeof data.planning_diagnostic !== "string"))
      throw new ProtocolEnvelopeError("work detail response is malformed or belongs to a different work item");
    return response;
  }

  async readWorkSchedule(work_id: string): Promise<Envelope<WorkScheduleReadbackDto>> {
    if (!this.mounted || !this.service.readWorkSchedule) throw new ProtocolEnvelopeError("work schedule reads are unavailable in this connection");
    const response = await this.readWorkspace("work schedule", () => this.service.readWorkSchedule!(this.context.project_id, work_id));
    if (!response.data || response.data.work_id !== work_id || !Number.isSafeInteger(response.data.schedule_revision))
      throw new ProtocolEnvelopeError("work schedule readback does not match the selected work item");
    return response;
  }

  async readExternalWaits(wait_id?: string): Promise<Envelope<ExternalWaitReadbackDto>> {
    if (!this.mounted || !this.service.readExternalWaits) throw new ProtocolEnvelopeError("external wait reads are unavailable in this connection");
    const response = await this.readWorkspace("external waits", () => this.service.readExternalWaits!(this.context.project_id, wait_id));
    if (!response.data || (wait_id !== undefined && (response.data.waits.length !== 1 || response.data.waits[0]?.wait_id !== wait_id)))
      throw new ProtocolEnvelopeError("external wait readback did not match the requested wait");
    return response;
  }

  async readProjectCivilTime(): Promise<Envelope<ProjectCivilTimeReadbackDto>> {
    if (!this.mounted || !this.service.readProjectCivilTime) throw new ProtocolEnvelopeError("project civil-time settings are unavailable in this connection");
    return this.readWorkspace("project civil time", () => this.service.readProjectCivilTime!(this.context.project_id));
  }

  async readWorkPage(limit = 100, offset = 0): Promise<Envelope<RevisionedStatusResponse>> {
    if (!this.mounted) throw new ProtocolEnvelopeError("work list is unavailable before the dashboard is mounted");
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_INLINE_ITEMS || !Number.isInteger(offset) || offset < 0)
      throw new ProtocolEnvelopeError("work list requires a page limit of 1..100 and a non-negative offset");
    const response = await this.readWorkspace("work list", () => this.service.readStatus({
      project_id: this.context.project_id, cursor_revision: null, limit, offset,
    }));
    if (!response.data || response.data.project_id !== this.context.project_id || !Array.isArray(response.data.items))
      throw new ProtocolEnvelopeError("work list response is malformed or belongs to a different project");
    const normalized = buildMonitoringModel(response);
    return { ...response, data: { ...response.data, items: normalized.items } };
  }

  async searchSources(query: string, limit = 20): Promise<Envelope<unknown>> {
    if (!this.mounted || !this.service.searchSources) throw new ProtocolEnvelopeError("source search is unavailable in this connection");
    return this.readWorkspace("source search", () => this.service.searchSources!(this.context.project_id, query, limit));
  }

  async readReview(review_id: string): Promise<Envelope<unknown>> {
    if (!this.mounted || !this.service.readReview) throw new ProtocolEnvelopeError("review detail is unavailable in this connection");
    return this.readWorkspace("review detail", () => this.service.readReview!(this.context.project_id, review_id));
  }

  async readSession(): Promise<Envelope<unknown>> {
    if (!this.mounted || !this.service.readSession) throw new ProtocolEnvelopeError("session detail is unavailable in this connection");
    return this.readWorkspace("session", () => this.service.readSession!(this.context.project_id));
  }

  async readReceiptsForAttempt(work_id: string, limit = 50, offset = 0): Promise<Envelope<AttemptReceiptPage>> {
    if (!this.mounted || !this.service.readReceiptsForAttempt) throw new ProtocolEnvelopeError("attempt receipt history is unavailable in this connection");
    const item = this.model?.items.find(candidate => candidate.work_id === work_id);
    const attempt = item?.attempt;
    if (!item || !attempt) throw new ProtocolEnvelopeError("receipt history requires the selected work's current attempt");
    const key = `${work_id}:${attempt.attempt_id}:${attempt.fence}`;
    const response = await this.readWorkspace("attempt receipt history", () => this.service.readReceiptsForAttempt!(
      this.context.project_id, work_id, attempt.attempt_id, attempt.fence, limit, offset,
    ));
    const raw = response.data as unknown;
    if (!isObject(raw) || raw.project_id !== this.context.project_id || raw.work_id !== work_id
      || raw.attempt_id !== attempt.attempt_id || raw.fence !== attempt.fence || !Array.isArray(raw.items)
      || !Number.isInteger(raw.limit) || (raw.limit as number) < 1 || (raw.limit as number) > 100
      || !Number.isInteger(raw.offset) || (raw.offset as number) < 0 || typeof raw.has_more !== "boolean")
      throw new ProtocolEnvelopeError("attempt receipt page does not match the selected project, attempt, and fence");
    const items = raw.items.map(normalizeAttemptReceiptRecord);
    if (items.some(record => record.project_id !== this.context.project_id || record.work_id !== work_id
      || record.attempt_id !== attempt.attempt_id || record.fence !== attempt.fence))
      throw new ProtocolEnvelopeError("attempt receipt page contained a row outside the exact current fence");
    const current = this.model?.items.find(candidate => candidate.work_id === work_id)?.attempt;
    if (!current || current.attempt_id !== attempt.attempt_id || current.fence !== attempt.fence)
      throw new ProtocolEnvelopeError("the active attempt changed while receipt history was loading");
    const history = this.receiptHistory.get(key) ?? new Map<string, AttemptReceiptRecord>();
    for (const record of items) {
      const prior = history.get(record.receipt_id);
      if (prior && JSON.stringify(prior) !== JSON.stringify(record))
        throw new ProtocolEnvelopeError(`receipt ${record.receipt_id} changed between history pages`);
      history.set(record.receipt_id, record);
    }
    this.receiptHistory.set(key, history);
    return { ...response, data: { ...raw, items } as AttemptReceiptPage };
  }

  selectReceiptForAttempt(work_id: string, receipt_id: string): void {
    const item = this.model?.items.find(candidate => candidate.work_id === work_id);
    const attempt = item?.attempt;
    if (!item || !attempt) throw new ProtocolEnvelopeError("receipt selection requires the current attempt");
    requiredString(receipt_id, "receipt_id");
    const key = `${work_id}:${attempt.attempt_id}:${attempt.fence}`;
    const record = this.receiptHistory.get(key)?.get(receipt_id);
    if (!record || record.project_id !== this.context.project_id || record.work_id !== work_id
      || record.attempt_id !== attempt.attempt_id || record.fence !== attempt.fence)
      throw new ProtocolEnvelopeError("selected receipt is not in the loaded page for the exact current attempt and fence");
    if (!isObject(record.receipt_payload))
      throw new ProtocolEnvelopeError(record.receipt_payload_diagnostic ?? "this durable receipt has no safely reconstructed receipt payload");
    const payload = record.receipt_payload;
    const subject = isObject(payload.subject) ? payload.subject : undefined;
    if (payload.receipt_id !== record.receipt_id || !subject || subject.work_id !== work_id
      || subject.attempt_id !== attempt.attempt_id || subject.fence !== attempt.fence)
      throw new ProtocolEnvelopeError("receipt payload identity does not match the selected current attempt and fence");
    this.receipts.set(work_id, { attempt_id: attempt.attempt_id, fence: attempt.fence, receipt_id, receipt: payload });
  }

  private async readWorkspace<T>(label: string, read: () => Promise<Envelope<T>>): Promise<Envelope<T>> {
    let response: Envelope<T>;
    try { response = validateEnvelope(await read()); }
    catch (error) {
      this.notice = { kind: "error", message: `${label} unavailable: ${error instanceof Error ? error.message : String(error)}` };
      throw error;
    }
    if (response.outcome !== "changed" && response.outcome !== "unchanged") {
      const error = new TuiServiceError(response.error?.code ?? response.outcome, response.error?.message ?? `${label} request did not succeed`, response.operation_id, response as Envelope<unknown>);
      this.notice = { kind: "error", message: `${label} unavailable: ${error.message}`, error };
      throw error;
    }
    if (isObject(response.data) && typeof response.data.project_id === "string" && response.data.project_id !== this.context.project_id)
      throw new ProtocolEnvelopeError(`${label} belongs to another project; it was not displayed`);
    return response;
  }

  async editWork(input: Omit<WorkEditInput, "project_id" | "expected_revision">): Promise<ActionResult<unknown>> {
    const service = this.requireWorkspaceService("editWork", "work editing");
    requiredString(input.work_id, "work_edit.work_id");
    if (input.parent_id !== undefined && input.clear_parent) throw new ProtocolEnvelopeError("work_edit.parent_id and clear_parent are mutually exclusive");
    if (input.execution_mode !== undefined && !["direct", "container"].includes(input.execution_mode)) throw new ProtocolEnvelopeError("work_edit.execution_mode must be direct or container");
    return this.mutateWorkspace("work_edit", (id, revision) => service(requestEnvelope(id, {
      project_id: this.context.project_id, work_id: input.work_id, expected_revision: revision,
      ...(input.parent_id !== undefined ? { parent_id: input.parent_id } : {}),
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.dispatch_policy !== undefined ? { dispatch_policy: input.dispatch_policy } : {}),
      ...(input.execution_mode !== undefined ? { execution_mode: input.execution_mode } : {}),
      ...(input.clear_parent ? { clear_parent: true } : {}),
    }, revision)));
  }

  async updateWorkSchedule(work_id: string, schedule_revision: number, schedule: BusinessScheduleDto): Promise<ActionResult<WorkScheduleMutationReadbackDto>> {
    const service = this.requireWorkspaceService("updateWorkSchedule", "work schedule updates");
    requiredString(work_id, "work_schedule_update.work_id");
    if (!Number.isSafeInteger(schedule_revision) || schedule_revision < 0)
      throw new ProtocolEnvelopeError("work_schedule_update.expected_schedule_revision must be a non-negative integer");
    return this.mutateWorkspace("work_schedule_update", (id, revision) => service(requestEnvelope(id, {
      project_id: this.context.project_id, work_id,
      schedule_update: { schema_version: "boreal.work_schedule_update.v1", expected_project_revision: revision,
        expected_schedule_revision: schedule_revision, schedule },
    }, revision)));
  }

  async createExternalWait(input: Omit<ExternalWaitCreateDto, "schema_version" | "expected_project_revision" | "expected_wait_revision">): Promise<ActionResult<ExternalWaitMutationReadbackDto>> {
    const service = this.requireWorkspaceService("createExternalWait", "external wait creation");
    return this.mutateWorkspace("external_wait_create", (id, revision) => service(requestEnvelope(id, {
      project_id: this.context.project_id,
      wait_create: { ...input, schema_version: "boreal.external_wait_create.v1", expected_project_revision: revision, expected_wait_revision: 0 },
    }, revision)));
  }

  async resolveExternalWait(input: Omit<ExternalWaitResolveDto, "schema_version" | "expected_project_revision">): Promise<ActionResult<ExternalWaitMutationReadbackDto>> {
    const service = this.requireWorkspaceService("resolveExternalWait", "external wait resolution");
    return this.mutateWorkspace("external_wait_resolve", (id, revision) => service(requestEnvelope(id, {
      project_id: this.context.project_id,
      wait_resolve: { ...input, schema_version: "boreal.external_wait_resolve.v1", expected_project_revision: revision },
    }, revision)));
  }

  async changeDependency(action: "dependency_add" | "dependency_remove", input: Omit<DependencyChangeInput, "project_id" | "expected_revision">): Promise<ActionResult<unknown>> {
    const method = action === "dependency_add" ? this.service.addDependency : this.service.removeDependency;
    if (!method) throw new ActionDisabledError(action, "dependency changes are unavailable in this connection");
    return this.mutateWorkspace(action, (id, revision) => method.call(this.service, requestEnvelope(id, {
      project_id: this.context.project_id, ...input, expected_revision: revision,
    }, revision)));
  }

  async changeCycle(input: CycleCommandInput): Promise<ActionResult<unknown>> {
    const service = this.requireWorkspaceService("changeCycle", "cycle changes");
    const expected_revision = this.currentRevision();
    return this.mutateWorkspace("cycle_change", (id, revision) => service(requestEnvelope(id, {
      project_id: this.context.project_id,
      cycle_change: { ...input, expected_revision: revision },
    }, expected_revision)));
  }

  async runMemoryCommand(input: MemoryCommandInput): Promise<ActionResult<unknown>> {
    const service = this.requireWorkspaceService("memoryCommand", "memory operations");
    const action = input.change.kind;
    const mutation = ["draft", "review", "publish", "reconcile"].includes(action);
    if (!mutation) {
      const response = await this.readWorkspace("memory", () => service(requestEnvelope(operationId(), {
        project_id: this.context.project_id, memory: input,
      }, input.expected_revision)));
      return { ok: true, envelope: response, data: response.data };
    }
    return this.mutateWorkspace("memory_command", (id, revision) => service(requestEnvelope(id, {
      project_id: this.context.project_id, memory: { ...input, expected_revision: revision },
    }, revision)));
  }

  async runRecoveryCommand(input: RecoveryCommandInput): Promise<ActionResult<unknown>> {
    const service = this.requireWorkspaceService("recoveryCommand", "recovery operations");
    if (input.action === "list") {
      const response = await this.readWorkspace("recovery", () => service(requestEnvelope(operationId(), {
        project_id: this.context.project_id, recovery: input,
      }, null)));
      return { ok: true, envelope: response, data: response.data };
    }
    return this.mutateWorkspace("recovery_command", (id, revision) => service(requestEnvelope(id, {
      project_id: this.context.project_id,
      recovery: { ...input, expected_revision: revision } as RecoveryCommandInput,
    }, revision)));
  }

  async decideCompletion(input: CompletionCommandInput): Promise<ActionResult<unknown>> {
    const service = this.requireWorkspaceService("completion", "completion decisions");
    return this.mutateWorkspace("completion", (id, revision) => service(requestEnvelope(id, {
      project_id: this.context.project_id,
      completion: { ...input, expected_revision: revision },
    }, revision)));
  }

  async endSession(): Promise<ActionResult<unknown>> {
    const service = this.requireWorkspaceService("endSession", "session recovery");
    return this.mutateWorkspace("session_end", (id, revision) => service(requestEnvelope(id, {
      project_id: this.context.project_id, expected_revision: revision,
    }, revision)));
  }

  async addSource(input: { input: string; origin: string; media_type?: string }): Promise<ActionResult<unknown>> {
    const service = this.requireWorkspaceService("captureSource", "source capture");
    return this.mutateWorkspace("source_add", (id, revision) => service(requestEnvelope(id, {
      project_id: this.context.project_id,
      input: input.input,
      origin: input.origin,
      ...(input.media_type ? { media_type: input.media_type } : {}),
      expected_revision: revision,
    }, revision)));
  }

  async bindFinalResult(work_id: string, input: { source_version_id: string; content_digest: string }): Promise<ActionResult<FinalResultBinding>> {
    const service = this.requireWorkspaceService("bindFinalResult", "final result binding");
    const item = this.item(work_id);
    const attempt = item.attempt;
    const facts = item.action_context;
    if (!attempt) throw new ActionDisabledError("bind_final_result", "the selected work has no current attempt", work_id);
    if (!facts || facts.state !== "available" || facts.integrity !== "valid"
      || !Number.isSafeInteger(facts.entity_revision) || (facts.entity_revision ?? 0) <= 0
      || !Number.isSafeInteger(facts.proof_revision) || (facts.proof_revision ?? 0) <= 0
      || facts.authenticated_session_id !== this.session()) {
      throw new ActionDisabledError("bind_final_result", "authoritative entity, proof, and session revisions are unavailable or stale", work_id);
    }
    const source_version_id = requiredString(input.source_version_id, "bind_final_result.source_version_id");
    const content_digest = requiredString(input.content_digest, "bind_final_result.content_digest");
    if (!/^sha256:[0-9a-f]{64}$/u.test(content_digest))
      throw new ProtocolEnvelopeError("bind_final_result.content_digest must be a lowercase sha256 digest from the registered source");
    return this.mutateWorkspace("bind_final_result", async (id, revision) => {
      const response = await service(requestEnvelope(id, {
        project_id: this.context.project_id,
        actor_id: this.actor(),
        session_id: this.session(),
        work_id,
        attempt_id: attempt.attempt_id,
        fence: attempt.fence,
        source_version_id,
        content_digest,
        expected_revision: revision,
        expected_entity_revision: facts.entity_revision as number,
        expected_proof_revision: facts.proof_revision as number,
      }, revision, attempt.attempt_id, attempt.fence));
      if (response.outcome !== "changed" && response.outcome !== "unchanged") return response;
      if (!response.data) throw new ProtocolEnvelopeError("final result binding response is missing its binding DTO");
      const data = normalizeFinalResultBinding(response.data);
      if (data.project_id !== this.context.project_id || data.work_id !== work_id
        || data.attempt_id !== attempt.attempt_id || data.fence !== attempt.fence
        || data.source_version_id !== source_version_id || data.content_digest !== content_digest
        || data.operation_id !== id || data.entity_revision !== facts.entity_revision
        || data.prior_proof_revision !== facts.proof_revision
        || response.revision !== data.project_revision || data.project_revision < revision) {
        throw new ProtocolEnvelopeError("final result binding response does not match the submitted project, attempt, revisions, or source");
      }
      return { ...response, data };
    });
  }

  private requireWorkspaceService<K extends keyof VersionedServiceApi>(key: K, label: string): NonNullable<VersionedServiceApi[K]> {
    const method = this.service[key];
    if (typeof method !== "function") throw new ActionDisabledError(String(key), `${label} are unavailable in this connection`);
    return method as NonNullable<VersionedServiceApi[K]>;
  }

  private currentRevision(): number {
    if (!this.authorityFresh || this.model === null) throw new ActionDisabledError("workspace mutation", "refresh the connection before making changes");
    return this.model.revision;
  }

  private async mutateWorkspace<T = unknown>(action: WorkspaceAction, invoke: (operation_id: string, revision: number) => Promise<Envelope<T>>): Promise<ActionResult<T>> {
    if (!this.mounted) throw new ActionDisabledError(action, "dashboard is not mounted");
    const revision = this.currentRevision();
    if (this.pending.size) throw new ActionDisabledError(action, "resolve the pending operation before submitting another change");
    if (this.workspaceBusy.size > 0) throw new ActionDisabledError(action, "another workspace operation is already in progress");
    this.workspaceBusy.add(action);
    this.notice = null;
    const id = operationId();
    try {
      const envelope = validateEnvelope<T>(await invoke(id, revision));
      if (envelope.revision !== null) this.minimumObservedRevision = Math.max(this.minimumObservedRevision, envelope.revision);
      if (envelope.outcome === "changed" || envelope.outcome === "unchanged") {
        this.authorityFresh = false;
        const result: ActionResult<T> = { ok: true, envelope, data: envelope.data };
        if (this.mounted) {
          try { await this.refresh(); }
          catch (error) { this.notice = { kind: "error", message: `change committed at revision ${envelope.revision ?? "unknown"}; refresh unavailable: ${error instanceof Error ? error.message : String(error)}` }; }
        }
        return result;
      }
      const error = new TuiServiceError(envelope.error?.code ?? "unknown", envelope.error?.message ?? "service rejected operation", envelope.operation_id, envelope as Envelope<unknown>);
      if (error.unknown) {
        this.authorityFresh = false;
        this.pending.set(envelope.operation_id, { operation_id: envelope.operation_id, action });
        this.notice = { kind: "unknown", message: `${error.message} Read operation ${envelope.operation_id} before retrying.`, error };
      } else if (error.stale) {
        this.notice = { kind: "stale_revision", message: error.message, stale: {
          kind: "stale_revision", message: error.message,
          expected_revision: envelope.error?.expected_revision ?? revision,
          observed_revision: envelope.error?.observed_revision ?? envelope.revision,
          operation_id: envelope.operation_id, error_code: error.code,
        }, error };
        if (this.mounted) { try { await this.refresh(); } catch { /* Keep the precise stale error. */ } }
      } else this.notice = { kind: "error", message: error.message, error };
      return { ok: false, envelope: envelope as Envelope<unknown>, error };
    } catch (error) {
      this.authorityFresh = false;
      this.pending.set(id, { operation_id: id, action });
      this.notice = { kind: "unknown", message: `Operation ${id} may have been admitted. Read it back before retrying. ${error instanceof Error ? error.message : String(error)}` };
      throw error;
    } finally {
      this.workspaceBusy.delete(action);
    }
  }

  view(): MountedView {
    const selected = this.route.work_id ? this.model?.items.find((item) => item.work_id === this.route.work_id) ?? null : null;
    const pending = selected ? this.pendingForWork(selected.work_id) : undefined;
    const pendingCreateProject = [...this.pending.values()].find((operation) => operation.action === "create_project");
    const pendingCreateWork = [...this.pending.values()].find((operation) => operation.action === "create_work");
    const creationActions: ActionAvailability[] = (["create_project", "create_work"] as const).map((action) => {
      const descriptor=this.model?.project_actions?.find((entry)=>entry.action===action);
      const pending=action==="create_project"?pendingCreateProject:pendingCreateWork;
      const bound=descriptor?.target?.project_id===this.context.project_id
        && descriptor?.caller?.actor_id===this.context.actor_id && descriptor?.caller?.session_id===this.context.session_id
        && descriptor?.expected_project_revision===this.model?.revision;
      const reason=!this.mounted?"Dashboard is not mounted":pending?`operation ${pending.operation_id} has unknown outcome; read it back before retrying`
        :!this.authorityFresh?"Refresh the connection before making changes":!bound?"The service has not supplied current project action permissions"
        :!descriptor?.allowed?(descriptor?.denial_reason??"Project action denied"):null;
      return {action,enabled:reason===null,reason,requires_confirmation:true};
    });
    return {
      mounted: this.mounted,
      route: { ...this.route },
      monitoring: this.model,
      selected_work: selected,
      actions: [...creationActions, ...(selected ? actionAvailability(selected, this.busy, {
        authority_fresh: this.authorityFresh,
        receipt_available: this.currentReceipt(selected) !== undefined,
        pending_operation: pending,
      }) : [])],
      notice: this.notice,
      stale_revision: this.notice?.stale ?? null,
      busy_actions: [...this.busy],
      pending_operations: [...this.pending.values()],
      capabilities: dashboardCapabilities(this.service),
      selected_receipt_available: selected ? this.currentReceipt(selected) !== undefined : false,
      selected_receipt_id: selected ? this.currentReceiptId(selected) : undefined,
      receipt_readback_available: typeof this.service.readReceiptsForAttempt === "function",
      workspace_actions_available: [
        ...(this.service.editWork && this.service.readWork ? ["edit_work"] : []),
        ...(this.service.addDependency ? ["dependency_add"] : []),
        ...(this.service.removeDependency ? ["dependency_remove"] : []),
        ...(this.service.changeCycle ? ["cycle_create", "cycle_activate", "cycle_close", "cycle_cancel", "cycle_assign", "cycle_commit", "cycle_remove", "cycle_carry_over"] : []),
        ...(this.service.readCycle ? ["cycle_board"] : []),
        ...(this.service.memoryCommand ? ["memory_search", "memory_show", "memory_draft", "memory_review", "memory_publish", "memory_reconcile"] : []),
        ...(this.service.recoveryCommand ? ["recovery_resolve"] : []),
        ...(this.service.endSession ? ["session_end"] : []),
        ...(this.service.captureSource ? ["source_capture"] : []),
        ...(this.service.searchSources ? ["source_search"] : []),
        ...(this.service.readReview ? ["review_show"] : []),
        ...(this.service.bindFinalResult && this.service.readSources ? ["bind_result"] : []),
        ...(this.service.readWorkSchedule && this.service.updateWorkSchedule ? ["schedule_edit"] : []),
        ...(this.service.createExternalWait ? ["wait_create"] : []),
        ...(this.service.readExternalWaits && this.service.resolveExternalWait ? ["wait_resolve"] : []),
      ],
      workspace_views_available: [
        ...(this.service.readWorkspaceView ? ["cycles", "reviews", "memory", "recovery", "dependencies", "sources", "session"] : []),
        ...(this.service.readExternalWaits ? ["waits"] : []),
      ],
    };
  }

  navigate(route: Route): MountedView {
    if (route.project_id && route.project_id !== this.context.project_id) {
      throw new ProtocolEnvelopeError("route project_id does not match the mounted project context");
    }
    this.route = { ...route, project_id: this.context.project_id };
    if (this.route.work_id) void this.hydrateReceiptForWork(this.route.work_id);
    return this.view();
  }

  private installSnapshot(model: MonitoringModel): boolean {
    if (model.project_id && model.project_id !== this.context.project_id) {
      throw new ProtocolEnvelopeError("snapshot belongs to another project; no cached rows were replaced");
    }
    if (!this.mounted) return false;
    if (model.revision < Math.max(this.minimumObservedRevision, this.model?.revision ?? 0)) {
      this.authorityFresh = false;
      if (this.notice?.kind !== "stale_revision") this.notice = { kind: "stale_revision", message: "The response predates an observed operation. Last known rows remain read-only." };
      return false;
    }
    this.minimumObservedRevision = Math.max(this.minimumObservedRevision, model.revision);
    this.model = model;
    this.authorityFresh = true;
    return true;
  }

  private connectionFailed(error: unknown): never {
    this.authorityFresh = false;
    this.notice = { kind: "error", message: `Connection unavailable; last known rows are read-only. ${error instanceof Error ? error.message : String(error)}` };
    throw error;
  }

  refresh(): Promise<MountedView> {
    return this.refreshCoordinator.refresh().then(async (model) => {
      if (!this.installSnapshot(model)) return this.view();
      if (this.route.work_id) await this.hydrateReceiptForWork(this.route.work_id);
      return this.view();
    }).catch((error) => this.connectionFailed(error));
  }

  notifyRevision(observedRevision?: number): Promise<MountedView> {
    return this.refreshCoordinator.notifyRevision(observedRevision).then((model) => {
      this.installSnapshot(model);
      return this.view();
    }).catch((error) => this.connectionFailed(error));
  }

  notifyDeadline(): Promise<MountedView> {
    return this.refreshCoordinator.notifyDeadline().then((model) => {
      this.installSnapshot(model);
      return this.view();
    }).catch((error) => this.connectionFailed(error));
  }

  /** Fetch the next bounded page without pretending the first page is complete. */
  async nextPage(): Promise<MountedView> {
    const model = this.model;
    if (!model?.has_more || model.next_offset === null) return this.view();
    const envelope = validateEnvelope<RevisionedStatusResponse>(await this.service.readStatus({
      cursor_revision: model.revision,
      project_id: this.context.project_id,
      limit: model.limit,
      offset: model.next_offset,
    }).catch((error) => this.connectionFailed(error)));
    const page = buildMonitoringModel(envelope);
    if (page.revision !== model.revision) {
      this.notice = {
        kind: "stale_revision",
        message: `page changed from revision ${model.revision} to ${page.revision}; refreshing from the current snapshot`,
      };
      return this.refresh();
    }
    if (!this.installSnapshot(page)) return this.view();
    if (this.route.work_id) await this.hydrateReceiptForWork(this.route.work_id);
    return this.view();
  }

  actionAvailability(work_id: string): ActionAvailability[] {
    const item = this.item(work_id);
    return actionAvailability(item, this.busy, {
      authority_fresh: this.authorityFresh,
        receipt_available: this.currentReceipt(item) !== undefined,
      pending_operation: this.pendingForWork(work_id),
    });
  }

  /** Resolve an unknown mutation using the original operation identity. */
  async readback(operation_id: string): Promise<Envelope<OperationReadback>> {
    const pending = this.pending.get(operation_id);
    if (!pending) throw new ProtocolEnvelopeError(`operation ${operation_id} is not pending readback`);
    if (!this.service.readOperation) {
      throw new ActionDisabledError(pending.action, "the service does not expose operation readback", pending.work_id);
    }
    const envelope = validateEnvelope<OperationReadback>(await this.service.readOperation(this.context.project_id, operation_id));
    if (envelope.revision !== null) this.minimumObservedRevision = Math.max(this.minimumObservedRevision, envelope.revision);
    const terminal = envelope.outcome !== "unknown" && envelope.outcome !== "busy"
      && envelope.data?.readback_required !== true;
    if (terminal) {
      this.pending.delete(operation_id);
      // A readback resolves one operation, not the current action permissions.
      // Only a fresh project snapshot can re-enable mutations.
      if (this.mounted) await this.refresh();
    }
    if (envelope.outcome === "unknown" || envelope.data?.readback_required === true) {
      this.notice = { kind: "unknown", message: `operation ${operation_id} still requires readback` };
    } else {
      this.notice = null;
    }
    return envelope;
  }

  async createProject(input: CreateProjectDraftInput): Promise<ActionResult<unknown>> {
    if (input.project_id !== this.context.project_id) {
      throw new ProtocolEnvelopeError("create_project must target the mounted project context");
    }
    const request: CreateProjectInput = {
      project_id: input.project_id,
      actor_id: this.actor(),
      actor_role: input.actor_role ?? "operator",
      credential_ref: input.credential_ref ?? `tui:${this.harness()}`,
      display_name: input.display_name ?? this.actor(),
    };
    const result = await this.mutate("create_project", (id, revision) => this.service.createProject(requestEnvelope(id, request, revision)), undefined);
    if (result.ok) {
      this.route = { kind: "project", project_id: request.project_id };
    }
    return result;
  }

  async createWork(input: CreateWorkDraftInput): Promise<ActionResult<unknown>> {
    if (!Number.isInteger(input.priority ?? 0) || (input.priority ?? 0) < 0 || (input.priority ?? 0) > 255) {
      throw new ProtocolEnvelopeError("create_work priority must be an integer between 0 and 255");
    }
    const request: CreateWorkInput = {
      project_id: this.context.project_id,
      work_id: input.work_id,
      actor_id: this.actor(),
      kind: input.kind,
      title: input.title,
      parent_id: input.parent_id ?? null,
      description: input.description ?? "",
      priority: input.priority ?? 0,
      dispatch_policy: input.dispatch_policy ?? "automatic",
      hard_holds: [...(input.hard_holds ?? [])],
      acceptance_profile: input.acceptance_profile ?? { id: "focused", version: "1" },
      ...(input.kind === "milestone" ? { execution_mode: "container" } : input.kind === "task" ? { execution_mode: input.execution_mode ?? "direct" } : {}),
    };
    const result = await this.mutate("create_work", (id, revision) => this.service.createWork(requestEnvelope(id, request, revision)), undefined);
    if (result.ok) {
      this.route = { kind: "work", project_id: request.project_id, work_id: request.work_id };
    }
    return result;
  }

  async claim(work_id: string, execution: ClaimExecutionContext): Promise<ActionResult<unknown>> {
    const sourceVersionId = execution.source_version_id.trim();
    const configIdentity = execution.config_identity.trim();
    const missingConfig = /^(?:unknown|n\/a|none|null|undefined|todo|tbd)$/iu.test(configIdentity);
    if (!sourceVersionId || /^unknown$/iu.test(sourceVersionId)) {
      throw new ProtocolEnvelopeError("claim requires a real source_version_id from this project's registered sources; list or capture a source before claiming");
    }
    if (!configIdentity || missingConfig) {
      throw new ProtocolEnvelopeError("claim requires a meaningful config_identity (for example, repository revision plus toolchain/config version); do not use unknown or a placeholder");
    }
    const item = this.item(work_id);
    this.requireAction(item, "claim");
    const now = this.now();
    const input: ClaimInput = {
      project_id: this.projectId(work_id),
      work_id,
      source_version_id: sourceVersionId,
      config_identity: configIdentity,
      actor_id: this.actor(),
      harness_id: this.harness(),
      session_id: this.session(),
      attempt_id: attemptId(),
      claimed_at: now.toISOString(),
      lease_deadline: new Date(now.getTime() + (this.context.lease_ttl_ms ?? 30 * 60 * 1000)).toISOString(),
      hard_deadline: new Date(now.getTime() + (this.context.hard_deadline_ms ?? 2 * 60 * 60 * 1000)).toISOString(),
    };
    return this.mutate("claim", (id, revision) => this.service.claim(requestEnvelope(id, input, revision)), work_id);
  }

  async acceptStart(work_id: string): Promise<ActionResult<unknown>> {
    const item = this.item(work_id);
    this.requireAction(item, "accept_start");
    const attempt = item.attempt;
    if (!attempt) throw new ActionDisabledError("accept_start", "a current attempt is required", work_id);
    const input: AcceptStartInput = {
      project_id: this.projectId(work_id),
      work_id,
      attempt_id: attempt.attempt_id,
      fence: attempt.fence,
      actor_id: this.actor(),
      harness_id: this.harness(),
      session_id: this.session(),
    };
    return this.mutate("accept_start", (id, revision) => this.service.acceptStart(requestEnvelope(id, input, revision, attempt.attempt_id, attempt.fence)), work_id);
  }

  /** Alias for callers that use the shorter lifecycle verb. */
  start(work_id: string): Promise<ActionResult<unknown>> {
    return this.acceptStart(work_id);
  }

  async addEvidence(work_id: string, evidence: unknown): Promise<ActionResult<unknown>> {
    const item = this.item(work_id);
    this.requireAction(item, "evidence");
    const attempt = item.attempt;
    if (!attempt) throw new ActionDisabledError("evidence", "a current attempt is required", work_id);
    const input: EvidenceInput = {
      project_id: this.projectId(work_id),
      work_id,
      attempt_id: attempt.attempt_id,
      fence: attempt.fence,
      actor_id: this.actor(),
      harness_id: this.harness(),
      session_id: this.session(),
      receipt: evidence,
    };
    const result = await this.mutate("evidence", (id, revision) => this.service.addEvidence(requestEnvelope(id, input, revision, attempt.attempt_id, attempt.fence)), work_id);
    if (result.ok) {
      this.receiptHistory.delete(`${work_id}:${attempt.attempt_id}:${attempt.fence}`);
      this.receipts.set(work_id, {
        attempt_id: attempt.attempt_id, fence: attempt.fence,
        ...(isObject(evidence) && typeof evidence.receipt_id === "string" ? { receipt_id: evidence.receipt_id } : {}),
        receipt: evidence,
      });
    }
    return result;
  }

  evidence(work_id: string, evidence: unknown): Promise<ActionResult<unknown>> {
    return this.addEvidence(work_id, evidence);
  }

  async finish(work_id: string, summary?: string): Promise<ActionResult<unknown>> {
    const item = this.item(work_id);
    this.requireAction(item, "finish");
    const attempt = item.attempt;
    if (!attempt) throw new ActionDisabledError("finish", "a current attempt is required", work_id);
    const storedReceipt = this.receipts.get(work_id);
    if (!storedReceipt || storedReceipt.attempt_id !== attempt.attempt_id || storedReceipt.fence !== attempt.fence) {
      throw new ActionDisabledError("finish", "a current receipt is required", work_id);
    }
    if (!summary?.trim()) {
      throw new ActionDisabledError("finish", "a non-empty typed summary is required", work_id);
    }
    const input: FinishInput = {
      project_id: this.projectId(work_id),
      work_id,
      attempt_id: attempt.attempt_id,
      fence: attempt.fence,
      actor_id: this.actor(),
      harness_id: this.harness(),
      session_id: this.session(),
      close: true,
      summary,
      receipt: storedReceipt.receipt,
    };
    const result = await this.mutate("finish", (id, revision) => this.service.finish(requestEnvelope(id, input, revision, attempt.attempt_id, attempt.fence)), work_id);
    if (result.ok) this.receipts.delete(work_id);
    return result;
  }

  async release(work_id: string, reason?: string): Promise<ActionResult<unknown>> {
    const item = this.item(work_id);
    this.requireAction(item, "release");
    const attempt = item.attempt;
    if (!attempt) throw new ActionDisabledError("release", "a current attempt is required", work_id);
    const input: ReleaseInput = {
      project_id: this.projectId(work_id),
      work_id,
      attempt_id: attempt.attempt_id,
      fence: attempt.fence,
      actor_id: this.actor(),
      harness_id: this.harness(),
      session_id: this.session(),
      reason,
    };
    return this.mutate("release", (id, revision) => this.service.release(requestEnvelope(id, input, revision, attempt.attempt_id, attempt.fence)), work_id);
  }

  private item(work_id: string): StatusItem {
    const item = this.model?.items.find((candidate) => candidate.work_id === work_id);
    if (!item) throw new ActionDisabledError("claim", "work is not present in the current monitoring snapshot", work_id);
    return item;
  }

  private projectId(work_id: string): string {
    const itemProject = (this.model?.items.find((item) => item.work_id === work_id) as StatusItem & { project_id?: string } | undefined)?.project_id;
    if (itemProject && itemProject !== this.context.project_id) {
      throw new ProtocolEnvelopeError("work project_id does not match the mounted project context");
    }
    return this.context.project_id;
  }

  private currentReceipt(item: StatusItem): unknown | undefined {
    const stored = this.receipts.get(item.work_id);
    if (!stored || !item.attempt || stored.attempt_id !== item.attempt.attempt_id || stored.fence !== item.attempt.fence) return undefined;
    return stored.receipt;
  }

  private currentReceiptId(item: StatusItem): string | undefined {
    const stored = this.receipts.get(item.work_id);
    return stored && item.attempt && stored.attempt_id === item.attempt.attempt_id && stored.fence === item.attempt.fence
      ? stored.receipt_id
      : undefined;
  }

  private pendingForWork(work_id: string): PendingOperation | undefined {
    return [...this.pending.values()].find((operation) => operation.work_id === work_id);
  }

  private async hydrateReceiptForWork(work_id: string): Promise<void> {
    const item = this.model?.items.find((candidate) => candidate.work_id === work_id);
    const attempt = item?.attempt;
    if (!item || !attempt || !this.service.readReceiptsForAttempt) return;
    const key = `${work_id}:${attempt.attempt_id}:${attempt.fence}`;
    if (this.receiptHistory.has(key)) return;
    if (this.receiptHydration.has(key)) return;
    this.receiptHydration.add(key);
    try {
      await this.readReceiptsForAttempt(work_id, 50, 0);
    } catch (error) {
      this.notice = { kind: "error", message: `durable receipt history unavailable: ${error instanceof Error ? error.message : String(error)}` };
    } finally {
      this.receiptHydration.delete(key);
    }
  }

  private now(): Date {
    return this.context.now?.() ?? new Date();
  }

  private actor(): string {
    return this.context.actor_id;
  }

  private harness(): string {
    return this.context.harness_id;
  }

  private session(): string {
    return this.context.session_id;
  }

  private requireAction(item: StatusItem, action: TuiAction): void {
    const available = actionAvailability(item, this.busy, {
      authority_fresh: this.authorityFresh,
        receipt_available: this.currentReceipt(item) !== undefined,
      pending_operation: this.pendingForWork(item.work_id),
    }).find((entry) => entry.action === action);
    if (!available?.enabled) throw new ActionDisabledError(action, available?.reason ?? "action unavailable", item.work_id);
  }

  private async mutate<T>(action: TuiAction, invoke: (operation_id: string, revision: number | null) => Promise<unknown>, work_id: string | undefined): Promise<ActionResult<T>> {
    if (!this.mounted) throw new ActionDisabledError(action, "dashboard is not mounted", work_id);
    if (!this.authorityFresh) throw new ActionDisabledError(action, "refresh the connection before making changes", work_id);
    if (action==="create_work" || action==="create_project") {
      const permission=this.view().actions.find((entry)=>entry.action===action);
      if (!permission?.enabled) throw new ActionDisabledError(action,permission?.reason??"project action unavailable",work_id);
    }
    if (this.busy.has(action)) throw new ActionDisabledError(action, "operation already in progress", work_id);
    const existing = work_id ? this.pendingForWork(work_id) : [...this.pending.values()].find((entry) => entry.action === action);
    if (existing) {
      throw new ActionDisabledError(action, `operation ${existing.operation_id} has unknown outcome; read it back before retrying`, work_id);
    }
    this.busy.add(action);
    this.notice = null;
    const id = operationId();
    try {
      const envelope = validateEnvelope<T>(await invoke(id, this.model?.revision ?? null));
      if (envelope.revision !== null) this.minimumObservedRevision = Math.max(this.minimumObservedRevision, envelope.revision);
      if (envelope.outcome === "changed" || envelope.outcome === "unchanged") {
        this.authorityFresh = false;
        const result: ActionResult<T> = { ok: true, envelope, data: envelope.data };
        if (this.mounted) {
          try {
            await this.refresh();
          } catch (error) {
            this.notice = { kind: "error", message: `mutation committed at revision ${envelope.revision ?? "unknown"}; refresh unavailable: ${error instanceof Error ? error.message : String(error)}` };
          }
        }
        return result;
      }
      const error = new TuiServiceError(envelope.error?.code ?? "unknown", envelope.error?.message ?? "service rejected operation", envelope.operation_id, envelope as Envelope<unknown>);
      if (error.unknown) {
        this.authorityFresh = false;
        this.pending.set(envelope.operation_id, { operation_id: envelope.operation_id, action, ...(work_id ? { work_id } : {}) });
        this.notice = {
          kind: "unknown",
          message: `${error.message} Read operation ${envelope.operation_id} before retrying.`,
          error,
        };
      } else if (error.stale) {
        this.notice = {
          kind: "stale_revision",
          message: error.message,
          stale: {
            kind: "stale_revision",
            message: error.message,
            expected_revision: envelope.error?.expected_revision ?? this.model?.revision ?? null,
            observed_revision: envelope.error?.observed_revision ?? envelope.revision,
            operation_id: envelope.operation_id,
            error_code: error.code,
          },
          error,
        };
        if (this.mounted) {
          try {
            await this.refresh();
          } catch {
            // Preserve the typed stale result when the recovery read is unavailable.
          }
        }
      } else {
        this.notice = { kind: "error", message: error.message, error };
      }
      return { ok: false, envelope: envelope as Envelope<unknown>, error };
    } catch (error) {
      this.authorityFresh = false;
      this.pending.set(id, { operation_id: id, action, ...(work_id ? { work_id } : {}) });
      this.notice = { kind: "unknown", message: `Operation ${id} may have been admitted. Read it back before retrying. ${error instanceof Error ? error.message : String(error)}` };
      throw error;
    } finally {
      this.busy.delete(action);
    }
  }
}

/** Explicit name for consumers that mount the workflow controller in a TUI shell. */
export class MountedWorkflowController extends TuiWorkflowController {}

export function createMountedWorkflowController(service: VersionedServiceApi, context: TuiWorkflowContext): MountedWorkflowController {
  return new MountedWorkflowController(service, { context });
}
