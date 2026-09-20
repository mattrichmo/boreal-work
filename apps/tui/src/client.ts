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

export interface StatusItem {
  work_id: string;
  project_id?: string;
  /** `status` is retained for the original groundwork; service DTOs may use `display_status`. */
  status: WorkStatus;
  reason_codes: string[];
  claimable: boolean;
  next_action: string | null;
  next_status_change_at?: string | null;
  display_status?: WorkStatus;
  claimable_for_actor?: boolean;
  title?: string;
  kind?: WorkKind | string;
  parent_id?: string | null;
  description?: string;
  priority?: number;
  dispatch_policy?: DispatchPolicy | string;
  due_at?: string | null;
  dependencies?: DependencySummary[];
  activity?: ActivitySummary[];
  gates?: { open: GateItem[]; satisfied: GateItem[] };
  attempt?: AttemptSummary | null;
  lifecycle?: WorkStatus;
  receipt?: unknown;
  receipt_id?: string | null;
  diagnostic?: StatusDiagnostic;
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

export interface RevisionedStatusResponse {
  /** Service read-model revision. The envelope revision is authoritative when both exist. */
  revision?: number;
  total?: number;
  items: StatusItem[];
  diagnostics?: StatusDiagnostic[];
  counts?: Partial<MonitoringCounts>;
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
  revision: number;
  as_of: string;
  next_status_change_at: string | null;
  total: number;
  counts: MonitoringCounts;
  items: StatusItem[];
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
}

export interface ClaimInput {
  project_id: string;
  work_id: string;
  actor_id: string;
  harness_id: string;
  session_id: string;
  attempt_id: string;
  claimed_at: string;
  lease_deadline: string;
  hard_deadline: string;
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
  /** Optional durable receipt payload readback. Finish stays disabled without this seam. */
  readReceipt?(project_id: string, work_id: string, attempt_id: string, fence: number): Promise<Envelope<ReceiptReadback>>;
}

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
  | "milestones" | "sprints" | "tasks";

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
  { route: "work.edit", label: "Edit work", status: "unavailable", reason: "Rust service route is not exposed yet", owner: "planning/application" },
  { route: "dependency.add/remove/tree", label: "Dependencies", status: "unavailable", reason: "Rust graph read/write routes are not exposed yet", owner: "planning/application" },
  { route: "cycle.create/activate/board", label: "Cycles and sprints", status: "unavailable", reason: "Schema-v3 cycle routes are not exposed yet", owner: "hierarchy/application" },
  { route: "intake.list/promote", label: "Intake", status: "unavailable", reason: "Intake service adapter is not exposed yet", owner: "knowledge/application" },
  { route: "source.list/verify", label: "Sources", status: "unavailable", reason: "Source adapter route is not exposed yet", owner: "source/application" },
  { route: "memory.search/publish", label: "Published memory", status: "unavailable", reason: "Memory adapter route is not exposed yet", owner: "memory/application" },
  { route: "session.end/recover", label: "Session recovery", status: "unavailable", reason: "Operator lifecycle route is not exposed yet", owner: "runtime/service" },
  { route: "activity.history", label: "Activity history", status: "unavailable", reason: "Bounded activity route is not exposed yet", owner: "protocol/service" },
];

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
    readonly action: TuiAction,
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
  action: TuiAction;
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
  const rawStatus = value.status ?? value.display_status;
  if (typeof rawStatus !== "string") throw new ProtocolEnvelopeError("status item must contain status");
  const statusValue = normalizeStateSpelling(rawStatus);
  const reasonCodes = value.reason_codes ?? [];
  if (!Array.isArray(reasonCodes) || !reasonCodes.every((code) => typeof code === "string")) {
    throw new ProtocolEnvelopeError("status item reason_codes must be strings");
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
  const dependencyValue = isObject(value.dependency) ? value.dependency.prerequisites : value.dependencies;
  const dependencies = normalizeDependencies(dependencyValue);
  const nextStatusChange = value.next_status_change_at;
  if (nextStatusChange !== undefined && nextStatusChange !== null && typeof nextStatusChange !== "string") {
    throw new ProtocolEnvelopeError("status item next_status_change_at must be a string or null");
  }
  const priority = value.priority === undefined ? undefined : asNumber(value.priority, "priority");
  return {
    work_id: value.work_id,
    project_id: typeof value.project_id === "string" ? value.project_id : undefined,
    status: statusValue,
    display_status: statusValue,
    reason_codes: reasonCodes,
    claimable: claimableValue,
    claimable_for_actor: claimableValue,
    next_action: typeof value.next_action === "string" ? value.next_action : null,
    next_status_change_at: nextStatusChange as string | null | undefined,
    title: typeof value.title === "string" ? value.title : undefined,
    kind: typeof value.kind === "string" ? value.kind : undefined,
    parent_id: typeof value.parent_id === "string" || value.parent_id === null ? value.parent_id : undefined,
    description: typeof value.description === "string" ? value.description : undefined,
    priority,
    dispatch_policy: typeof value.dispatch_policy === "string" ? value.dispatch_policy : undefined,
    due_at: typeof value.due_at === "string" || value.due_at === null ? value.due_at : undefined,
    dependencies,
    activity: normalizeActivity(value.activity),
    gates: normalizedGates,
    attempt,
    lifecycle: typeof value.lifecycle === "string" ? normalizeStateSpelling(value.lifecycle) : undefined,
    receipt: value.receipt,
    receipt_id: typeof value.receipt_id === "string" || value.receipt_id === null ? value.receipt_id : undefined,
  };
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
  private readonly max_payload_bytes: number;
  private readonly project_id?: string;
  private readonly actor_id?: string;
  private readonly harness_id?: string;
  private readonly session_id?: string;
  readonly notifications?: RefreshNotificationSource;

  constructor(private readonly transport: FramedTransport, config: ServiceClientConfig = {}) {
    this.max_payload_bytes = config.max_payload_bytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
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

  private async call<Response, Request>(command: string, request: RequestEnvelope<Request>, mutation = false): Promise<Envelope<Response>> {
    const validated = validateRequestEnvelope(request);
    const data = isObject(validated.data) ? {
      ...validated.data,
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
      return validateEnvelope<Response>(outerResponse(parsed, validated.operation_id));
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
  const items = validated.data.items.map(normalizeStatusItem);
  const diagnostics = normalizeDiagnostics(validated.data.diagnostics);
  const diagnosticItems: StatusItem[] = diagnostics.map((diagnostic) => ({
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
    revision: validated.revision,
    as_of: validated.as_of,
    next_status_change_at: validated.next_status_change_at ?? validated.data.next_status_change_at ?? itemDeadline,
    total,
    counts: normalizeCounts(validated.data.counts, displayItems, total),
    items: displayItems.slice(0, MAX_INLINE_ITEMS),
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
  /** The current service route requires a receipt before finish_close. */
  receipt_available?: boolean;
  pending_operation?: PendingOperation;
}

export function actionAvailability(
  item: StatusItem,
  busy: ReadonlySet<TuiAction> = new Set(),
  context: ActionAvailabilityContext = {},
): ActionAvailability[] {
  const status = statusOf(item);
  const blocked = status === "blocked";
  const queued = status === "queued";
  const expired = status === "expired_review";
  const gateOpen = gateIsOpen(item);
  const hasAttempt = !!item.attempt;
  const receiptAvailable = context.receipt_available !== false;
  const pendingOperation = context.pending_operation;
  const accepted = (hasAttempt && ["accepted", "running", "in_progress", "verifying"].includes(item.attempt?.phase ?? ""))
    || ["accepted", "running", "in_progress"].includes(status);
  const disabled = (action: TuiAction, reason: string | null, enabled: boolean, confirmation = true): ActionAvailability => ({
    action,
    enabled: enabled && !busy.has(action) && !pendingOperation,
    reason: busy.has(action)
      ? "operation already in progress"
      : pendingOperation
        ? `operation ${pendingOperation.operation_id} has unknown outcome; read it back before retrying`
        : reason,
    requires_confirmation: confirmation,
  });
  if (item.diagnostic) {
    return (["claim", "accept_start", "evidence", "finish", "release"] as const).map((action) =>
      disabled(action, `unavailable: ${item.diagnostic?.code ?? "corrupt record"}`, false));
  }
  return [
    disabled("claim", blocked ? "work is blocked" : queued ? "waiting for prerequisite" : expired ? "expiry requires review" : item.claimable ? null : "work is not claimable at this revision", item.claimable && !blocked && !queued && !expired),
    disabled("accept_start", blocked ? "work is blocked" : queued ? "waiting for prerequisite" : expired ? "expiry requires review" : hasAttempt && status === "claimed" ? null : "a claimed attempt is required", hasAttempt && status === "claimed" && !blocked && !queued && !expired),
    disabled("evidence", blocked ? "work is blocked" : queued ? "waiting for prerequisite" : expired ? "expiry requires review" : accepted ? null : "an accepted attempt is required", accepted && !blocked && !queued && !expired),
    disabled("finish", blocked ? "work is blocked" : queued ? "waiting for prerequisite" : expired ? "expiry requires review" : gateOpen ? "required gate is open" : !receiptAvailable ? "a current receipt is required" : accepted ? null : "an accepted attempt is required", accepted && !blocked && !queued && !expired && !gateOpen && receiptAvailable),
    disabled("release", blocked ? "work is blocked" : queued ? "waiting for prerequisite" : expired ? "expiry requires review" : hasAttempt ? null : "a current attempt is required", hasAttempt && !blocked && !queued && !expired),
  ];
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
  private readonly receipts = new Map<string, { attempt_id: string; fence: number; receipt: unknown }>();
  private model: MonitoringModel | null = null;
  private mounted = false;
  private route: Route = { kind: "monitoring" };
  private notice: ControllerNotice | null = null;
  private readonly busy = new Set<TuiAction>();
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
    this.unsubscribeNotifications?.();
    this.unsubscribeNotifications = null;
  }

  view(): MountedView {
    const selected = this.route.work_id ? this.model?.items.find((item) => item.work_id === this.route.work_id) ?? null : null;
    const pending = selected ? this.pendingForWork(selected.work_id) : undefined;
    const pendingCreateProject = [...this.pending.values()].find((operation) => operation.action === "create_project");
    const pendingCreateWork = [...this.pending.values()].find((operation) => operation.action === "create_work");
    const creationActions: ActionAvailability[] = [
      { action: "create_project", enabled: this.mounted && !pendingCreateProject, reason: !this.mounted ? "controller is not mounted" : pendingCreateProject ? `operation ${pendingCreateProject.operation_id} has unknown outcome; read it back before retrying` : null, requires_confirmation: true },
      { action: "create_work", enabled: this.mounted && !pendingCreateWork, reason: !this.mounted ? "controller is not mounted" : pendingCreateWork ? `operation ${pendingCreateWork.operation_id} has unknown outcome; read it back before retrying` : null, requires_confirmation: true },
    ];
    return {
      mounted: this.mounted,
      route: { ...this.route },
      monitoring: this.model,
      selected_work: selected,
      actions: [...creationActions, ...(selected ? actionAvailability(selected, this.busy, {
        receipt_available: this.currentReceipt(selected) !== undefined,
        pending_operation: pending,
      }) : [])],
      notice: this.notice,
      stale_revision: this.notice?.stale ?? null,
      busy_actions: [...this.busy],
      pending_operations: [...this.pending.values()],
      capabilities: DASHBOARD_CAPABILITIES,
      selected_receipt_available: selected ? this.currentReceipt(selected) !== undefined : false,
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

  refresh(): Promise<MountedView> {
    return this.refreshCoordinator.refresh().then(async (model) => {
      this.model = model;
      if (this.route.work_id) await this.hydrateReceiptForWork(this.route.work_id);
      return this.view();
    });
  }

  notifyRevision(observedRevision?: number): Promise<MountedView> {
    return this.refreshCoordinator.notifyRevision(observedRevision).then((model) => {
      this.model = model;
      return this.view();
    });
  }

  notifyDeadline(): Promise<MountedView> {
    return this.refreshCoordinator.notifyDeadline().then((model) => {
      this.model = model;
      return this.view();
    });
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
    }));
    const page = buildMonitoringModel(envelope);
    if (page.revision !== model.revision) {
      this.notice = {
        kind: "stale_revision",
        message: `page changed from revision ${model.revision} to ${page.revision}; refreshing from the current snapshot`,
      };
      return this.refresh();
    }
    this.model = page;
    if (this.route.work_id) await this.hydrateReceiptForWork(this.route.work_id);
    return this.view();
  }

  actionAvailability(work_id: string): ActionAvailability[] {
    const item = this.item(work_id);
    return actionAvailability(item, this.busy, {
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
    const terminal = envelope.outcome !== "unknown" && envelope.outcome !== "busy"
      && envelope.data?.readback_required !== true;
    if (terminal) this.pending.delete(operation_id);
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
    };
    const result = await this.mutate("create_work", (id, revision) => this.service.createWork(requestEnvelope(id, request, revision)), undefined);
    if (result.ok) {
      this.route = { kind: "work", project_id: request.project_id, work_id: request.work_id };
    }
    return result;
  }

  async claim(work_id: string): Promise<ActionResult<unknown>> {
    const item = this.item(work_id);
    this.requireAction(item, "claim");
    const now = this.now();
    const input: ClaimInput = {
      project_id: this.projectId(work_id),
      work_id,
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
    if (result.ok) this.receipts.set(work_id, { attempt_id: attempt.attempt_id, fence: attempt.fence, receipt: evidence });
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

  private pendingForWork(work_id: string): PendingOperation | undefined {
    return [...this.pending.values()].find((operation) => operation.work_id === work_id);
  }

  private async hydrateReceiptForWork(work_id: string): Promise<void> {
    const item = this.model?.items.find((candidate) => candidate.work_id === work_id);
    const attempt = item?.attempt;
    if (!item || !attempt || this.currentReceipt(item) !== undefined) return;
    if (item.receipt !== undefined) {
      this.receipts.set(work_id, { attempt_id: attempt.attempt_id, fence: attempt.fence, receipt: item.receipt });
      return;
    }
    if (!this.service.readReceipt) return;
    const key = `${work_id}:${attempt.attempt_id}:${attempt.fence}`;
    if (this.receiptHydration.has(key)) return;
    this.receiptHydration.add(key);
    try {
      const envelope = validateEnvelope<ReceiptReadback>(await this.service.readReceipt(
        this.context.project_id, work_id, attempt.attempt_id, attempt.fence,
      ));
      const receipt = envelope.data;
      if ((envelope.outcome === "changed" || envelope.outcome === "unchanged") && receipt
        && receipt.work_id === work_id && receipt.attempt_id === attempt.attempt_id && receipt.fence === attempt.fence) {
        this.receipts.set(work_id, { attempt_id: attempt.attempt_id, fence: attempt.fence, receipt: receipt.receipt });
      }
    } catch (error) {
      this.notice = { kind: "error", message: `durable receipt readback unavailable: ${error instanceof Error ? error.message : String(error)}` };
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
      receipt_available: this.currentReceipt(item) !== undefined,
      pending_operation: this.pendingForWork(item.work_id),
    }).find((entry) => entry.action === action);
    if (!available?.enabled) throw new ActionDisabledError(action, available?.reason ?? "action unavailable", item.work_id);
  }

  private async mutate<T>(action: TuiAction, invoke: (operation_id: string, revision: number | null) => Promise<unknown>, work_id: string | undefined): Promise<ActionResult<T>> {
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
      if (envelope.outcome === "changed" || envelope.outcome === "unchanged") {
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
