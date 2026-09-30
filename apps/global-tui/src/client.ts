import { createConnection } from "node:net";

export const API_VERSION = "2";
export const REQUEST_SCHEMA = "boreal.global.request.v1";
export const ENVELOPE_SCHEMA = "boreal.protocol.envelope.v1";
export const MAX_FRAME_BYTES = 1024 * 1024;

export interface Project { id: string; name: string; description: string; labels?: string[]; priority?:number; lifecycle?:string; health?:string; archived: boolean; created_at: string; updated_at: string }
export interface Item { id: string; project_id: string | null; parent_id: string | null; kind: string; title: string; description: string; labels?:string[]; status_id: string; priority: number | null; due_at: string | null; archived: boolean; position: number; created_at: string; updated_at: string }
export interface Note { id: string; project_id: string | null; title: string; body: string; archived: boolean; created_at: string; updated_at: string }
export interface Status { project_id: string; status_id: string; label: string; category: string; position: number }
export interface StatusHistoryEntry { item_id: string; from_status_id: string | null; to_status_id: string; revision: number; changed_at: string }
export interface Relationship { source_id: string; target_id: string; kind: string }
export interface Association { project_id: string; kind: string; identity: string; path: string | null; updated_at: string }
export interface LinkedWorkItem { work_id: string; project_id: string; title: string; kind: string; parent_id: string | null; lifecycle: string; display_status: string; status: string; priority: number; reason_codes: string[] }
export interface LinkedProject { management_project_id: string; project_id: string; path: string | null; availability: string; revision: number | null; as_of: string | null; counts?: Record<string, number>; error?: string | null; items?: LinkedWorkItem[]; items_total?: number; items_has_more?: boolean }
export interface GlobalActivityEvent { operation_id: string; revision: number; command: string; entity_kind: string | null; entity_id: string | null; title: string | null; summary: string; created_at: string }
export interface GlobalHistory { events: GlobalActivityEvent[]; current_revision: number; total: number; limit: number; offset: number; has_more: boolean; next_offset: number | null }
export interface TodoReorderResult extends Item { moved: boolean; ordered_ids: string[]; revision: number }
export interface GlobalSnapshot { schema_version: number; revision: number; projects: Project[]; items: Item[]; notes: Note[]; statuses: Status[]; status_history: StatusHistoryEntry[]; relationships: Relationship[]; associations: Association[]; activity?: GlobalHistory; linked_projects?: LinkedProject[] }
export interface GlobalEnvelopeError { code: string; message: string; operation_id?: string | null; operation_preserved?: boolean | null; readback_required?: boolean | null; retryable?: boolean | null }
export interface GlobalEnvelope<T = unknown> { api_version: string; schema_version: string; operation_id: string; outcome: string; transport: string; data: T | null; error: GlobalEnvelopeError | null; revision?: number | null; as_of?: string; next_status_change_at?: string | null; detail_ref?: string | null }

export class GlobalProtocolError extends Error {
  readonly unknownOutcome: boolean;
  readonly operationId?: string;
  readonly readbackRequired: boolean;
  readonly errorCode?: string;
  constructor(message: string, detail: { unknownOutcome?: boolean; operationId?: string; readbackRequired?: boolean; errorCode?: string } = {}) { super(message); this.name = "GlobalProtocolError"; this.unknownOutcome=detail.unknownOutcome??false; this.operationId=detail.operationId; this.readbackRequired=detail.readbackRequired??false; this.errorCode=detail.errorCode; }
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function frame(body: string): Uint8Array {
  const payload = new TextEncoder().encode(body);
  if (payload.length > MAX_FRAME_BYTES) throw new GlobalProtocolError("request exceeds global service frame limit");
  const bytes = new Uint8Array(payload.length + 4);
  new DataView(bytes.buffer).setUint32(0, payload.length, false);
  bytes.set(payload, 4);
  return bytes;
}
function decodeFrame(bytes: Uint8Array): unknown {
  if (bytes.length < 4) throw new GlobalProtocolError("short response frame");
  const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, false);
  if (size > MAX_FRAME_BYTES || bytes.length !== size + 4) throw new GlobalProtocolError("response frame length is invalid");
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(4))) as unknown; }
  catch (error) { throw new GlobalProtocolError(`response is not valid UTF-8 JSON: ${String(error)}`); }
}
function operationId(): string { return `global_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`; }
function deliveryFailure(message: string, id: string, mutation: boolean): GlobalProtocolError {
  return new GlobalProtocolError(
    mutation ? `operation ${id} may have reached the service, but its response could not be trusted; check operation history before making another change: ${message}` : message,
    mutation ? { unknownOutcome: true, operationId: id, readbackRequired: true } : {},
  );
}
function validEnvelopeError(value: unknown): value is GlobalEnvelopeError {
  const allowed = ["code", "message", "operation_id", "operation_preserved", "readback_required", "retryable"];
  return record(value) && typeof value.code === "string" && typeof value.message === "string"
    && Object.keys(value).every(key => allowed.includes(key))
    && (!Object.hasOwn(value, "operation_id") || value.operation_id === null || typeof value.operation_id === "string")
    && (!Object.hasOwn(value, "operation_preserved") || value.operation_preserved === null || typeof value.operation_preserved === "boolean")
    && (!Object.hasOwn(value, "readback_required") || value.readback_required === null || typeof value.readback_required === "boolean")
    && (!Object.hasOwn(value, "retryable") || value.retryable === null || typeof value.retryable === "boolean");
}

/** One request per service connection. Mutations are deliberately never retried. */
export class GlobalServiceClient {
  constructor(private readonly socketPath: string, private readonly timeoutMs = 10_000) {
    if (!socketPath) throw new GlobalProtocolError("--socket PATH is required");
  }

  async execute<T = unknown>(command: string, payload: Record<string, unknown> = {}, mutation = false): Promise<T> {
    const id = operationId();
    const request = { request_id: id, payload: { api_version: API_VERSION, schema_version: REQUEST_SCHEMA, operation_id: id, command, payload } };
    const response = await this.roundTrip(frame(JSON.stringify(request)), id, mutation);
    if (!record(response)) throw deliveryFailure("outer response must be an object", id, mutation);
    const allowedOuterFields = ["request_id", "payload", "error"];
    if (Object.keys(response).some(key => !allowedOuterFields.includes(key))) throw deliveryFailure("outer response contains unknown fields", id, mutation);
    if (response.request_id !== id) throw deliveryFailure("outer request correlation mismatch", id, mutation);
    if (Object.hasOwn(response, "error")) {
      const e = response.error;
      if (!record(e) || typeof e.code !== "string" || typeof e.message !== "string") throw deliveryFailure("malformed outer service error", id, mutation);
      throw deliveryFailure(`${e.code}: ${e.message}`, id, mutation);
    }
    if (!record(response.payload)) throw deliveryFailure("outer response payload is missing", id, mutation);
    const envelope = response.payload as unknown as GlobalEnvelope<T>;
    const allowedEnvelopeFields = ["api_version", "schema_version", "operation_id", "outcome", "transport", "data", "error", "revision", "as_of", "next_status_change_at", "detail_ref"];
    if (Object.keys(response.payload).some(key => !allowedEnvelopeFields.includes(key))) throw deliveryFailure("application envelope contains unknown fields", id, mutation);
    if (envelope.api_version !== API_VERSION) throw deliveryFailure(`API version mismatch: ${String(envelope.api_version)}`, id, mutation);
    if (envelope.schema_version !== ENVELOPE_SCHEMA) throw deliveryFailure(`envelope schema mismatch: ${String(envelope.schema_version)}`, id, mutation);
    if (envelope.operation_id !== id) throw deliveryFailure("application operation correlation mismatch", id, mutation);
    if (typeof envelope.outcome !== "string" || typeof envelope.transport !== "string") throw deliveryFailure("application envelope is missing outcome or transport", id, mutation);
    if (envelope.error !== null && !validEnvelopeError(envelope.error)) throw deliveryFailure("malformed application error", id, mutation);
    if (envelope.revision !== undefined && envelope.revision !== null && (!Number.isSafeInteger(envelope.revision) || envelope.revision < 0)) throw deliveryFailure("malformed application revision", id, mutation);
    if (envelope.as_of !== undefined && typeof envelope.as_of !== "string") throw deliveryFailure("malformed application sample time", id, mutation);
    if (envelope.transport !== "ok") throw deliveryFailure(envelope.error?.message ?? "service transport failed", id, mutation);
    if (envelope.outcome === "conflict") {
      if (!envelope.error) throw deliveryFailure("conflict envelope has no error details", id, mutation);
      throw new GlobalProtocolError(`revision conflict: ${envelope.error.message}`, { errorCode: envelope.error.code });
    }
    if (envelope.outcome === "busy") {
      if (!envelope.error) throw deliveryFailure("busy envelope has no error details", id, mutation);
      throw new GlobalProtocolError(`service is busy: ${envelope.error.message}`, { errorCode: envelope.error.code });
    }
    if (envelope.outcome !== "changed" && envelope.outcome !== "unchanged" && envelope.outcome !== "rejected") throw deliveryFailure(envelope.error?.message ?? `application outcome '${envelope.outcome}' is unresolved`, id, mutation);
    if (envelope.outcome === "rejected") {
      if (!envelope.error) throw deliveryFailure("rejected envelope has no error details", id, mutation);
      throw new GlobalProtocolError(envelope.error.message, { errorCode: envelope.error.code });
    }
    if (!Object.hasOwn(envelope, "data") || envelope.data === null || envelope.data === undefined) throw deliveryFailure("successful application envelope has no data", id, mutation);
    return envelope.data;
  }

  snapshot(): Promise<GlobalSnapshot> { return this.execute<GlobalSnapshot>("snapshot"); }
  history(options: { projectId?: string; entityId?: string; limit?: number; offset?: number } = {}): Promise<GlobalHistory> {
    return this.execute<GlobalHistory>("history", {
      ...(options.projectId ? { project_id: options.projectId } : {}),
      ...(options.entityId ? { entity_id: options.entityId } : {}),
      ...(options.limit === undefined ? {} : { limit: options.limit }),
      ...(options.offset === undefined ? {} : { offset: options.offset }),
    });
  }
  linkedShow(managementProjectId: string, workspaceProjectId: string): Promise<LinkedProject> {
    return this.execute<LinkedProject>("linked show", { project_id: managementProjectId, identity: workspaceProjectId });
  }
  reorderTodo(itemId: string, direction: "up" | "down", expectedRevision: number): Promise<TodoReorderResult> {
    return this.execute<TodoReorderResult>("todo reorder", {
      item_id: itemId,
      direction,
      expected_revision: expectedRevision,
    }, true);
  }

  private roundTrip(bytes: Uint8Array, expectedId: string, mutation: boolean): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const socket = createConnection(this.socketPath, () => { wrote=true; socket.write(bytes, error=>{if(error)finish(error);}); });
      let received = new Uint8Array();
      let settled = false;
      let wrote = false;
      const finish = (error?: Error, value?: unknown): void => {
        if (settled) return;
        settled = true;
        if (error) {
          globalThis.setTimeout(()=>socket.destroy(),0);
          reject(wrote && mutation && !(error instanceof GlobalProtocolError && error.unknownOutcome) ? new GlobalProtocolError(`operation ${expectedId} may have reached the service; do not repeat it before checking current state: ${error.message}`,{unknownOutcome:true,operationId:expectedId,readbackRequired:true}) : error);
        } else { socket.end(); resolve(value); }
      };
      socket.on("data", chunk => {
        const merged = new Uint8Array(received.length + chunk.length); merged.set(received); merged.set(chunk, received.length); received = merged;
        if (received.length < 4) return;
        const size = new DataView(received.buffer, received.byteOffset, received.byteLength).getUint32(0, false);
        if (size > MAX_FRAME_BYTES) { finish(new GlobalProtocolError("response exceeds global service frame limit")); return; }
        if (received.length < size + 4) return;
        if (received.length !== size + 4) { finish(new GlobalProtocolError("service returned trailing or multiple frames")); return; }
        try {
          const value = decodeFrame(received);
          if (!record(value) || value.request_id !== expectedId) throw new GlobalProtocolError("outer request correlation mismatch");
          finish(undefined, value);
        } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
      });
      socket.on("error", error => finish(error));
      socket.on("end", () => { if (!settled) finish(new GlobalProtocolError("socket ended before a complete response")); });
      socket.setTimeout(this.timeoutMs, () => finish(new GlobalProtocolError(`service request timed out after ${this.timeoutMs} ms`)));
    });
  }
}
