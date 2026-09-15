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
  recovery?: { action: string; safe_argv: string[] };
  fields?: Array<{ path: string; reason_code: string; expected: string; received: unknown }>;
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
}

export interface AttemptSummary {
  attempt_id: string;
  fence: number;
  phase?: string;
  actor_id?: string | null;
  session_id?: string | null;
  lease_deadline?: string | null;
  hard_deadline?: string | null;
}

export interface StatusItem {
  work_id: string;
  project_id?: string;
  /** `status` is retained for the original groundwork; service DTOs may use `display_status`. */
  status: WorkStatus;
  reason_codes: string[];
  claimable: boolean;
  next_action: string | null;
  display_status?: WorkStatus;
  claimable_for_actor?: boolean;
  title?: string;
  gates?: { open: GateItem[]; satisfied: GateItem[] };
  attempt?: AttemptSummary | null;
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
  counts?: Partial<MonitoringCounts>;
  as_of?: string;
}

export interface MonitoringModel {
  revision: number;
  as_of: string;
  total: number;
  counts: MonitoringCounts;
  items: StatusItem[];
  truncated: boolean;
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
}

export interface StatusReadOptions {
  /** Last fully applied revision. `null` requests a complete resnapshot. */
  cursor_revision?: number | null;
  project_id?: string;
  limit?: number;
  offset?: number;
}

export class TuiTransportError extends Error {
  readonly kind = "transport_error";

  constructor(readonly operation_id: string, message: string, readonly cause?: unknown) {
    super(message);
    this.name = "TuiTransportError";
  }
}

export type WorkKind = "milestone" | "sprint" | "task" | string;

export interface CreateProjectInput {
  project_id?: string;
  name: string;
  description?: string;
}

export interface CreateWorkInput {
  project_id: string;
  kind: WorkKind;
  title: string;
  parent_id?: string | null;
  description?: string;
}

export interface ClaimInput {
  project_id: string;
  work_id: string;
  actor_id: string;
  harness_id?: string;
  session_id?: string;
}

export interface AcceptStartInput {
  project_id: string;
  work_id: string;
  attempt_id: string;
  fence: number;
  session_id?: string;
}

export interface EvidenceInput {
  project_id: string;
  work_id: string;
  attempt_id: string;
  fence: number;
  evidence: unknown;
}

export interface FinishInput {
  project_id: string;
  work_id: string;
  attempt_id: string;
  fence: number;
  close?: boolean;
  summary?: string;
}

export interface ReleaseInput {
  project_id: string;
  work_id: string;
  attempt_id: string;
  fence: number;
  reason?: string;
}

export interface VersionedServiceApi extends StatusReader {
  createProject(request: RequestEnvelope<CreateProjectInput>): Promise<Envelope<unknown>>;
  createWork(request: RequestEnvelope<CreateWorkInput>): Promise<Envelope<unknown>>;
  claim(request: RequestEnvelope<ClaimInput>): Promise<Envelope<unknown>>;
  acceptStart(request: RequestEnvelope<AcceptStartInput>): Promise<Envelope<unknown>>;
  addEvidence(request: RequestEnvelope<EvidenceInput>): Promise<Envelope<unknown>>;
  finish(request: RequestEnvelope<FinishInput>): Promise<Envelope<unknown>>;
  release(request: RequestEnvelope<ReleaseInput>): Promise<Envelope<unknown>>;
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

export interface StaleRevisionDisplay {
  kind: "stale_revision";
  message: string;
  expected_revision: number | null;
  observed_revision: number | null;
  operation_id: string;
  error_code: string;
}

export interface ControllerNotice {
  kind: "stale_revision" | "error" | "busy";
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

function normalizeStatusItem(value: unknown): StatusItem {
  if (!isObject(value) || typeof value.work_id !== "string") {
    throw new ProtocolEnvelopeError("status item must contain work_id");
  }
  const statusValue = value.status ?? value.display_status;
  if (typeof statusValue !== "string") throw new ProtocolEnvelopeError("status item must contain status");
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
      state: gate.state,
      reason: typeof gate.reason === "string" || gate.reason === null ? gate.reason : undefined,
    };
  };
  const normalizedGates = gates ? {
    open: (gates.open as unknown[]).map(normalizeGate),
    satisfied: (gates.satisfied as unknown[]).map(normalizeGate),
  } : undefined;
  let attempt: AttemptSummary | null = null;
  if (value.attempt !== undefined && value.attempt !== null) {
    if (!isObject(value.attempt) || typeof value.attempt.attempt_id !== "string") {
      throw new ProtocolEnvelopeError("attempt summary must contain attempt_id");
    }
    const fence = asNumber(value.attempt.fence, "attempt.fence");
    if (!Number.isInteger(fence)) throw new ProtocolEnvelopeError("attempt.fence must be an integer");
    attempt = {
      attempt_id: value.attempt.attempt_id,
      fence,
      phase: typeof value.attempt.phase === "string" ? value.attempt.phase : undefined,
      actor_id: typeof value.attempt.actor_id === "string" || value.attempt.actor_id === null ? value.attempt.actor_id : undefined,
      session_id: typeof value.attempt.session_id === "string" || value.attempt.session_id === null ? value.attempt.session_id : undefined,
      lease_deadline: typeof value.attempt.lease_deadline === "string" || value.attempt.lease_deadline === null ? value.attempt.lease_deadline : undefined,
      hard_deadline: typeof value.attempt.hard_deadline === "string" || value.attempt.hard_deadline === null ? value.attempt.hard_deadline : undefined,
    };
  }
  return {
    work_id: value.work_id,
    project_id: typeof value.project_id === "string" ? value.project_id : undefined,
    status: statusValue,
    display_status: statusValue,
    reason_codes: reasonCodes,
    claimable: claimableValue,
    claimable_for_actor: claimableValue,
    next_action: typeof value.next_action === "string" ? value.next_action : null,
    title: typeof value.title === "string" ? value.title : undefined,
    gates: normalizedGates,
    attempt,
  };
}

function emptyCounts(): MonitoringCounts {
  return { matched: 0, queued: 0, ready: 0, blocked: 0, in_progress: 0, expired_review: 0, closed: 0 };
}

function normalizeCounts(value: unknown, items: StatusItem[], total: number): MonitoringCounts {
  const counts = emptyCounts();
  if (isObject(value)) {
    for (const key of Object.keys(counts)) {
      const candidate = value[key];
      if (candidate !== undefined) counts[key] = asNumber(candidate, `counts.${key}`);
    }
    for (const [key, candidate] of Object.entries(value)) {
      if (typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0) counts[key] = candidate;
    }
  }
  if (counts.matched === 0 && total > 0) counts.matched = total;
  if (!value) {
    for (const item of items) {
      const key = item.status === "in_progress" ? "in_progress" : item.status;
      if (key in counts) counts[key] += 1;
    }
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
  };
}

function failureEnvelope(operation_id: string, code: string, message: string): Envelope<never> {
  return {
    api_version: API_VERSION,
    schema_version: ENVELOPE_SCHEMA,
    operation_id,
    revision: null,
    as_of: new Date().toISOString(),
    next_status_change_at: null,
    transport: "error",
    outcome: "failed",
    data: null,
    detail_ref: null,
    error: { code, message, retryable: true, operation_id },
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
  return { cursor_revision: cursor_revision === undefined ? null : cursor_revision, project_id: options.project_id, limit, offset };
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

  constructor(private readonly transport: FramedTransport, config: ServiceClientConfig = {}) {
    this.max_payload_bytes = config.max_payload_bytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
    if (!Number.isInteger(this.max_payload_bytes) || this.max_payload_bytes <= 0) {
      throw new ProtocolEnvelopeError("payload limit must be a positive integer");
    }
  }

  readStatus(options: StatusReadOptions = {}): Promise<Envelope<RevisionedStatusResponse>> {
    const bounded = validateStatusReadOptions(options);
    const data = {
      command: "status",
      cursor_revision: bounded.cursor_revision,
      project_id: bounded.project_id,
      limit: bounded.limit,
      offset: bounded.offset,
    };
    return this.call<RevisionedStatusResponse, typeof data>("status", requestEnvelope(operationId(), data, bounded.cursor_revision ?? null));
  }

  createProject(request: RequestEnvelope<CreateProjectInput>): Promise<Envelope<unknown>> {
    return this.call<unknown, CreateProjectInput>("create_project", request);
  }

  createWork(request: RequestEnvelope<CreateWorkInput>): Promise<Envelope<unknown>> {
    return this.call<unknown, CreateWorkInput>("create_work", request);
  }

  claim(request: RequestEnvelope<ClaimInput>): Promise<Envelope<unknown>> {
    return this.call<unknown, ClaimInput>("claim", request);
  }

  acceptStart(request: RequestEnvelope<AcceptStartInput>): Promise<Envelope<unknown>> {
    return this.call<unknown, AcceptStartInput>("start", request);
  }

  addEvidence(request: RequestEnvelope<EvidenceInput>): Promise<Envelope<unknown>> {
    return this.call<unknown, EvidenceInput>("evidence", request);
  }

  finish(request: RequestEnvelope<FinishInput>): Promise<Envelope<unknown>> {
    return this.call<unknown, FinishInput>("finish", request);
  }

  release(request: RequestEnvelope<ReleaseInput>): Promise<Envelope<unknown>> {
    return this.call<unknown, ReleaseInput>("release", request);
  }

  close(): void | Promise<void> {
    return this.transport.close?.();
  }

  private async call<Response, Request>(command: string, request: RequestEnvelope<Request>): Promise<Envelope<Response>> {
    const validated = validateRequestEnvelope(request);
    const data = isObject(validated.data) ? { ...validated.data, command } : validated.data;
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
      return failureEnvelope(validated.operation_id, "service_unavailable", String(error));
    }
    let decoded: string;
    try {
      decoded = decodeJsonFrame(responseFrame, this.max_payload_bytes);
    } catch (error) {
      if (error instanceof ProtocolEnvelopeError) throw error;
      throw new ProtocolEnvelopeError(String(error));
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(decoded);
    } catch (error) {
      throw new ProtocolEnvelopeError(`service response is not valid JSON: ${String(error)}`);
    }
    return validateEnvelope<Response>(outerResponse(parsed, validated.operation_id));
  }
}

export function buildMonitoringModel(envelope: Envelope<RevisionedStatusResponse>): MonitoringModel {
  const validated = validateEnvelope<RevisionedStatusResponse>(envelope);
  if (!validated.data || validated.revision === null) {
    throw new ProtocolEnvelopeError("monitoring response has no revisioned data");
  }
  if (!Array.isArray(validated.data.items)) throw new ProtocolEnvelopeError("monitoring items must be an array");
  const items = validated.data.items.map(normalizeStatusItem);
  const responseRevision = validated.data.revision;
  if (responseRevision !== undefined && responseRevision !== validated.revision) {
    throw new ProtocolEnvelopeError("monitoring response mixes revisions");
  }
  if (validated.data.as_of !== undefined && validated.data.as_of !== validated.as_of) {
    throw new ProtocolEnvelopeError("monitoring response mixes as_of timestamps");
  }
  const total = validated.data.counts?.matched ?? validated.data.total ?? items.length;
  asNumber(total, "total");
  return {
    revision: validated.revision,
    as_of: validated.as_of,
    total,
    counts: normalizeCounts(validated.data.counts, items, total),
    items: items.slice(0, MAX_INLINE_ITEMS),
    truncated: items.length > MAX_INLINE_ITEMS,
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
      const missed = this.revision !== null && observedRevision > this.revision + 1;
      return this.refresh({ resnapshot: missed });
    }
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
  if (item.gates?.open.length) return "satisfy gate";
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
  return (item.gates?.open.length ?? 0) > 0
    || ["needs_verification", "awaiting_review"].includes(statusOf(item));
}

/** The presentation policy mirrors service-provided status; it never derives claimability. */
export function actionAvailability(item: StatusItem, busy: ReadonlySet<TuiAction> = new Set()): ActionAvailability[] {
  const status = statusOf(item);
  const blocked = status === "blocked";
  const queued = status === "queued";
  const expired = status === "expired_review";
  const gateOpen = gateIsOpen(item);
  const hasAttempt = !!item.attempt;
  const accepted = (hasAttempt && ["accepted", "running", "in_progress", "verifying"].includes(item.attempt?.phase ?? ""))
    || ["accepted", "running", "in_progress"].includes(status);
  const disabled = (action: TuiAction, reason: string | null, enabled: boolean, confirmation = true): ActionAvailability => ({
    action,
    enabled: enabled && !busy.has(action),
    reason: busy.has(action) ? "operation already in progress" : reason,
    requires_confirmation: confirmation,
  });
  return [
    disabled("claim", blocked ? "work is blocked" : queued ? "waiting for prerequisite" : expired ? "expiry requires review" : item.claimable ? null : "work is not claimable at this revision", item.claimable && !blocked && !queued && !expired),
    disabled("accept_start", blocked ? "work is blocked" : queued ? "waiting for prerequisite" : expired ? "expiry requires review" : hasAttempt && status === "claimed" ? null : "a claimed attempt is required", hasAttempt && status === "claimed" && !blocked && !queued && !expired),
    disabled("evidence", blocked ? "work is blocked" : queued ? "waiting for prerequisite" : expired ? "expiry requires review" : accepted ? null : "an accepted attempt is required", accepted && !blocked && !queued && !expired),
    disabled("finish", blocked ? "work is blocked" : queued ? "waiting for prerequisite" : expired ? "expiry requires review" : gateOpen ? "required gate is open" : accepted ? null : "an accepted attempt is required", accepted && !blocked && !queued && !expired && !gateOpen),
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
}

let operationSequence = 0;

function operationId(): string {
  operationSequence += 1;
  return `op_tui_${Date.now().toString(36)}_${operationSequence}`;
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
  private model: MonitoringModel | null = null;
  private mounted = false;
  private route: Route = { kind: "monitoring" };
  private notice: ControllerNotice | null = null;
  private readonly busy = new Set<TuiAction>();

  constructor(private readonly service: VersionedServiceApi) {
    this.refreshCoordinator = new RevisionRefreshCoordinator(service);
  }

  async mount(route: Route = { kind: "monitoring" }): Promise<MountedView> {
    this.mounted = true;
    this.route = route;
    await this.refresh();
    return this.view();
  }

  unmount(): void {
    this.mounted = false;
  }

  view(): MountedView {
    const selected = this.route.work_id ? this.model?.items.find((item) => item.work_id === this.route.work_id) ?? null : null;
    const creationActions: ActionAvailability[] = [
      { action: "create_project", enabled: this.mounted, reason: this.mounted ? null : "controller is not mounted", requires_confirmation: true },
      { action: "create_work", enabled: this.mounted, reason: this.mounted ? null : "controller is not mounted", requires_confirmation: true },
    ];
    return {
      mounted: this.mounted,
      route: { ...this.route },
      monitoring: this.model,
      selected_work: selected,
      actions: [...creationActions, ...(selected ? actionAvailability(selected, this.busy) : [])],
      notice: this.notice,
      stale_revision: this.notice?.stale ?? null,
      busy_actions: [...this.busy],
    };
  }

  navigate(route: Route): MountedView {
    this.route = route;
    return this.view();
  }

  refresh(): Promise<MountedView> {
    return this.refreshCoordinator.refresh().then((model) => {
      this.model = model;
      return this.view();
    });
  }

  notifyRevision(observedRevision?: number): Promise<MountedView> {
    return this.refreshCoordinator.notifyRevision(observedRevision).then((model) => {
      this.model = model;
      return this.view();
    });
  }

  actionAvailability(work_id: string): ActionAvailability[] {
    return actionAvailability(this.item(work_id), this.busy);
  }

  async createProject(input: CreateProjectInput): Promise<ActionResult<unknown>> {
    const result = await this.mutate("create_project", (id, revision) => this.service.createProject(requestEnvelope(id, input, revision)), undefined);
    if (result.ok) {
      const data = isObject(result.data) ? result.data : {};
      const project_id = typeof data.project_id === "string" ? data.project_id : typeof data.id === "string" ? data.id : input.project_id;
      if (project_id) this.route = { kind: "project", project_id };
    }
    return result;
  }

  async createWork(input: CreateWorkInput): Promise<ActionResult<unknown>> {
    const result = await this.mutate("create_work", (id, revision) => this.service.createWork(requestEnvelope(id, input, revision)), undefined);
    if (result.ok) {
      const data = isObject(result.data) ? result.data : {};
      const work_id = typeof data.work_id === "string" ? data.work_id : typeof data.id === "string" ? data.id : undefined;
      if (work_id) this.route = { kind: "work", project_id: input.project_id, work_id };
    }
    return result;
  }

  async claim(work_id: string, actor_id: string, options: { harness_id?: string; session_id?: string } = {}): Promise<ActionResult<unknown>> {
    const item = this.item(work_id);
    this.requireAction(item, "claim");
    const input: ClaimInput = { project_id: this.projectId(work_id), work_id, actor_id, ...options };
    return this.mutate("claim", (id, revision) => this.service.claim(requestEnvelope(id, input, revision)), work_id);
  }

  async acceptStart(work_id: string, options: { session_id?: string } = {}): Promise<ActionResult<unknown>> {
    const item = this.item(work_id);
    this.requireAction(item, "accept_start");
    const attempt = item.attempt;
    if (!attempt) throw new ActionDisabledError("accept_start", "a current attempt is required", work_id);
    const input: AcceptStartInput = { project_id: this.projectId(work_id), work_id, attempt_id: attempt.attempt_id, fence: attempt.fence, ...options };
    return this.mutate("accept_start", (id, revision) => this.service.acceptStart(requestEnvelope(id, input, revision, attempt.attempt_id, attempt.fence)), work_id);
  }

  /** Alias for callers that use the shorter lifecycle verb. */
  start(work_id: string, options: { session_id?: string } = {}): Promise<ActionResult<unknown>> {
    return this.acceptStart(work_id, options);
  }

  async addEvidence(work_id: string, evidence: unknown): Promise<ActionResult<unknown>> {
    const item = this.item(work_id);
    this.requireAction(item, "evidence");
    const attempt = item.attempt;
    if (!attempt) throw new ActionDisabledError("evidence", "a current attempt is required", work_id);
    const input: EvidenceInput = { project_id: this.projectId(work_id), work_id, attempt_id: attempt.attempt_id, fence: attempt.fence, evidence };
    return this.mutate("evidence", (id, revision) => this.service.addEvidence(requestEnvelope(id, input, revision, attempt.attempt_id, attempt.fence)), work_id);
  }

  evidence(work_id: string, evidence: unknown): Promise<ActionResult<unknown>> {
    return this.addEvidence(work_id, evidence);
  }

  async finish(work_id: string, summary?: string): Promise<ActionResult<unknown>> {
    const item = this.item(work_id);
    this.requireAction(item, "finish");
    const attempt = item.attempt;
    if (!attempt) throw new ActionDisabledError("finish", "a current attempt is required", work_id);
    const input: FinishInput = { project_id: this.projectId(work_id), work_id, attempt_id: attempt.attempt_id, fence: attempt.fence, close: true, summary };
    return this.mutate("finish", (id, revision) => this.service.finish(requestEnvelope(id, input, revision, attempt.attempt_id, attempt.fence)), work_id);
  }

  async release(work_id: string, reason?: string): Promise<ActionResult<unknown>> {
    const item = this.item(work_id);
    this.requireAction(item, "release");
    const attempt = item.attempt;
    if (!attempt) throw new ActionDisabledError("release", "a current attempt is required", work_id);
    const input: ReleaseInput = { project_id: this.projectId(work_id), work_id, attempt_id: attempt.attempt_id, fence: attempt.fence, reason };
    return this.mutate("release", (id, revision) => this.service.release(requestEnvelope(id, input, revision, attempt.attempt_id, attempt.fence)), work_id);
  }

  private item(work_id: string): StatusItem {
    const item = this.model?.items.find((candidate) => candidate.work_id === work_id);
    if (!item) throw new ActionDisabledError("claim", "work is not present in the current monitoring snapshot", work_id);
    return item;
  }

  private projectId(work_id: string): string {
    return this.route.project_id ?? (this.model?.items.find((item) => item.work_id === work_id) as StatusItem & { project_id?: string } | undefined)?.project_id ?? "";
  }

  private requireAction(item: StatusItem, action: TuiAction): void {
    const available = actionAvailability(item, this.busy).find((entry) => entry.action === action);
    if (!available?.enabled) throw new ActionDisabledError(action, available?.reason ?? "action unavailable", item.work_id);
  }

  private async mutate<T>(action: TuiAction, invoke: (operation_id: string, revision: number | null) => Promise<unknown>, work_id: string | undefined): Promise<ActionResult<T>> {
    if (this.busy.has(action)) throw new ActionDisabledError(action, "operation already in progress", work_id);
    this.busy.add(action);
    this.notice = null;
    const id = operationId();
    try {
      const envelope = validateEnvelope<T>(await invoke(id, this.model?.revision ?? null));
      if (envelope.outcome === "changed" || envelope.outcome === "unchanged") {
        const result: ActionResult<T> = { ok: true, envelope, data: envelope.data };
        if (this.mounted) await this.refresh();
        return result;
      }
      const error = new TuiServiceError(envelope.error?.code ?? "unknown", envelope.error?.message ?? "service rejected operation", envelope.operation_id, envelope as Envelope<unknown>);
      if (error.stale) {
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
            await this.refreshCoordinator.refresh({ resnapshot: true });
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

export function createMountedWorkflowController(service: VersionedServiceApi): MountedWorkflowController {
  return new MountedWorkflowController(service);
}
