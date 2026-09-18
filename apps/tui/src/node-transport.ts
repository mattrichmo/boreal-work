import { createConnection } from "node:net";

import {
  DEFAULT_MAX_PAYLOAD_BYTES,
  FRAME_HEADER_BYTES,
  FramedTransport,
  ProtocolEnvelopeError,
  decodeJsonFrame,
  encodeJsonFrame,
} from "./client.js";

export interface UnixSocketTransportOptions {
  readonly max_payload_bytes?: number;
  readonly timeout_ms?: number;
}

interface RustTransportRequest {
  readonly request_id: string;
  readonly payload: Record<string, unknown>;
}

interface RustTransportError {
  readonly code: string;
  readonly message: string;
}

interface RustTransportResponse {
  readonly request_id: string;
  readonly payload?: unknown;
  readonly error?: RustTransportError;
}

type UnixSocket = ReturnType<typeof createConnection>;

interface ActiveRoundTrip {
  readonly socket: UnixSocket;
  readonly abort: (error: Error) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function appendBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const combined = new Uint8Array(left.length + right.length);
  combined.set(left);
  combined.set(right, left.length);
  return combined;
}

/**
 * Node's built-in Unix-domain-socket adapter for the TUI service seam.
 *
 * The current Rust service accepts one request per connection, so each
 * round-trip opens one socket, drains exactly one framed response, and then
 * closes it. The FramedTransport interface still keeps this detail out of
 * the controller and permits a persistent implementation when the service
 * protocol gains connection reuse.
 */
export class UnixSocketFramedTransport implements FramedTransport {
  private readonly max_payload_bytes: number;
  private readonly timeout_ms: number;
  private readonly active_round_trips = new Set<ActiveRoundTrip>();
  private closed = false;

  constructor(private readonly socket_path: string, options: UnixSocketTransportOptions = {}) {
    this.max_payload_bytes = options.max_payload_bytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
    this.timeout_ms = options.timeout_ms ?? 10_000;
    if (!socket_path) throw new ProtocolEnvelopeError("Unix socket path must not be empty");
    if (!Number.isInteger(this.max_payload_bytes) || this.max_payload_bytes <= 0) {
      throw new ProtocolEnvelopeError("payload limit must be a positive integer");
    }
    if (!Number.isInteger(this.timeout_ms) || this.timeout_ms <= 0) {
      throw new ProtocolEnvelopeError("socket timeout must be a positive integer");
    }
  }

  roundTrip(request: Uint8Array): Promise<Uint8Array> {
    if (this.closed) return Promise.reject(new ProtocolEnvelopeError("Unix socket transport is closed"));
    const wrapped = this.wrapRequest(request);
    return new Promise<Uint8Array>((resolve, reject) => {
      let received: Uint8Array = new Uint8Array(0);
      let settled = false;
      const socket = createConnection(this.socket_path, () => {
        socket.write(wrapped.frame, (error) => {
          if (error) fail(error);
        });
      });
      let activeRoundTrip: ActiveRoundTrip;

      const detachAndDestroy = (): void => {
        // The local Node shim intentionally exposes only the transport surface;
        // removeAllListeners is used here to detach every late event before the
        // half-open socket is destroyed.
        const detachableSocket = socket as UnixSocket & {
          removeAllListeners(): UnixSocket;
        };
        detachableSocket.removeAllListeners();
        socket.destroy();
      };

      const finish = (callback: () => void): void => {
        if (settled) return;
        settled = true;
        this.active_round_trips.delete(activeRoundTrip);
        callback();
        socket.end();
      };
      const fail = (error: unknown): void => {
        if (settled) return;
        settled = true;
        this.active_round_trips.delete(activeRoundTrip);
        detachAndDestroy();
        reject(error instanceof Error ? error : new Error(String(error)));
      };
      activeRoundTrip = { socket, abort: (error) => fail(error) };
      this.active_round_trips.add(activeRoundTrip);
      const consume = (): void => {
        if (received.length < FRAME_HEADER_BYTES) return;
        const payloadLength = new DataView(received.buffer, received.byteOffset, received.byteLength).getUint32(0, false);
        if (payloadLength > this.max_payload_bytes) {
          fail(new ProtocolEnvelopeError(`response payload is ${payloadLength} bytes; maximum is ${this.max_payload_bytes}`));
          return;
        }
        const frameLength = FRAME_HEADER_BYTES + payloadLength;
        if (received.length < frameLength) return;
        try {
          const applicationFrame = this.unwrapResponse(received.slice(0, frameLength), wrapped.request_id);
          finish(() => resolve(applicationFrame));
        } catch (error) {
          fail(error);
        }
      };

      socket.on("data", (chunk) => {
        received = appendBytes(received, chunk);
        consume();
      });
      socket.on("error", fail);
      socket.on("end", () => {
        if (!settled) fail(new Error("Unix socket closed before a complete response frame arrived"));
      });
      socket.setTimeout(this.timeout_ms, () => fail(new Error(`Unix socket timed out after ${this.timeout_ms} ms`)));
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const activeRoundTrip of [...this.active_round_trips]) {
      activeRoundTrip.abort(new Error("Unix socket transport closed"));
    }
  }

  private wrapRequest(request: Uint8Array): { request_id: string; frame: Uint8Array } {
    const applicationJson = decodeJsonFrame(request, this.max_payload_bytes);
    let payload: unknown;
    try {
      payload = JSON.parse(applicationJson) as unknown;
    } catch (error) {
      throw new ProtocolEnvelopeError(`application request is not valid JSON: ${String(error)}`);
    }
    if (!isRecord(payload)) throw new ProtocolEnvelopeError("application request payload must be an object");
    const operationId = payload.operation_id;
    if (typeof operationId !== "string" || operationId.length === 0) {
      throw new ProtocolEnvelopeError("application request must contain a non-empty operation_id");
    }
    const outer: RustTransportRequest = { request_id: operationId, payload };
    return {
      request_id: operationId,
      frame: encodeJsonFrame(JSON.stringify(outer), this.max_payload_bytes),
    };
  }

  private unwrapResponse(responseFrame: Uint8Array, expectedRequestId: string): Uint8Array {
    const outerJson = decodeJsonFrame(responseFrame, this.max_payload_bytes);
    let value: unknown;
    try {
      value = JSON.parse(outerJson) as unknown;
    } catch (error) {
      throw new ProtocolEnvelopeError(`Rust transport response is not valid JSON: ${String(error)}`);
    }
    if (!isRecord(value)) throw new ProtocolEnvelopeError("Rust transport response must be an object");
    const response = value as unknown as RustTransportResponse;
    for (const field of Object.keys(value)) {
      if (!["request_id", "payload", "error"].includes(field)) {
        throw new ProtocolEnvelopeError(`unknown Rust transport response field ${field}`);
      }
    }
    if (response.request_id !== expectedRequestId) {
      throw new ProtocolEnvelopeError("Rust transport response request_id mismatch");
    }
    const hasPayload = Object.prototype.hasOwnProperty.call(value, "payload");
    const hasError = Object.prototype.hasOwnProperty.call(value, "error");
    if (hasPayload === hasError) {
      throw new ProtocolEnvelopeError("Rust transport response requires exactly one of payload or error");
    }
    if (hasError) {
      if (!isRecord(response.error) || typeof response.error.code !== "string" || typeof response.error.message !== "string") {
        throw new ProtocolEnvelopeError("Rust transport error is malformed");
      }
      throw new ProtocolEnvelopeError(`Rust transport ${response.error.code}: ${response.error.message}`);
    }
    if (!isRecord(response.payload)) {
      throw new ProtocolEnvelopeError("Rust transport response payload must be an application envelope object");
    }
    return encodeJsonFrame(JSON.stringify(response.payload), this.max_payload_bytes);
  }
}
