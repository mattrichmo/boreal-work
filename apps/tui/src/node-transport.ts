import { createConnection } from "node:net";

import {
  DEFAULT_MAX_PAYLOAD_BYTES,
  FRAME_HEADER_BYTES,
  FramedTransport,
  ProtocolEnvelopeError,
} from "./client.js";

export interface UnixSocketTransportOptions {
  readonly max_payload_bytes?: number;
  readonly timeout_ms?: number;
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
    this.validateRequest(request);
    return new Promise<Uint8Array>((resolve, reject) => {
      let received: Uint8Array = new Uint8Array(0);
      let settled = false;
      const socket = createConnection(this.socket_path, () => {
        socket.write(request, (error) => {
          if (error) fail(error);
        });
      });

      const finish = (callback: () => void): void => {
        if (settled) return;
        settled = true;
        callback();
        socket.end();
      };
      const fail = (error: unknown): void => finish(() => reject(error instanceof Error ? error : new Error(String(error))));
      const consume = (): void => {
        if (received.length < FRAME_HEADER_BYTES) return;
        const payloadLength = new DataView(received.buffer, received.byteOffset, received.byteLength).getUint32(0, false);
        if (payloadLength > this.max_payload_bytes) {
          fail(new ProtocolEnvelopeError(`response payload is ${payloadLength} bytes; maximum is ${this.max_payload_bytes}`));
          return;
        }
        const frameLength = FRAME_HEADER_BYTES + payloadLength;
        if (received.length < frameLength) return;
        finish(() => resolve(received.slice(0, frameLength)));
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
    // Connections are deliberately closed after each completed round-trip.
  }

  private validateRequest(request: Uint8Array): void {
    if (request.length < FRAME_HEADER_BYTES) {
      throw new ProtocolEnvelopeError("request frame is missing its length prefix");
    }
    const payloadLength = new DataView(request.buffer, request.byteOffset, request.byteLength).getUint32(0, false);
    if (payloadLength > this.max_payload_bytes) {
      throw new ProtocolEnvelopeError(`request payload is ${payloadLength} bytes; maximum is ${this.max_payload_bytes}`);
    }
    if (request.length !== FRAME_HEADER_BYTES + payloadLength) {
      throw new ProtocolEnvelopeError("request frame length does not match its payload");
    }
  }
}
