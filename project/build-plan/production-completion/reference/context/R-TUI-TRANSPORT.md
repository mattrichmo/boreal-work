# R-TUI-TRANSPORT — apps/tui/src/node-transport.ts

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `apps/tui/src/node-transport.ts:L1–L209`  
**File SHA-256:** `c696c2f927b4a5ba23285bb9482f20a1ab873592be2cf72566be81bb0565909b`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Service connection, pending request and reconnect handling; prevent cross-project late responses.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,209p' 'apps/tui/src/node-transport.ts'
```

## Exact baseline excerpt

````text
    1 | import { createConnection } from "node:net";
    2 | 
    3 | import {
    4 |   DEFAULT_MAX_PAYLOAD_BYTES,
    5 |   FRAME_HEADER_BYTES,
    6 |   FramedTransport,
    7 |   ProtocolEnvelopeError,
    8 |   decodeJsonFrame,
    9 |   encodeJsonFrame,
   10 | } from "./client.js";
   11 | 
   12 | export interface UnixSocketTransportOptions {
   13 |   readonly max_payload_bytes?: number;
   14 |   readonly timeout_ms?: number;
   15 | }
   16 | 
   17 | interface RustTransportRequest {
   18 |   readonly request_id: string;
   19 |   readonly payload: Record<string, unknown>;
   20 | }
   21 | 
   22 | interface RustTransportError {
   23 |   readonly code: string;
   24 |   readonly message: string;
   25 | }
   26 | 
   27 | interface RustTransportResponse {
   28 |   readonly request_id: string;
   29 |   readonly payload?: unknown;
   30 |   readonly error?: RustTransportError;
   31 | }
   32 | 
   33 | type UnixSocket = ReturnType<typeof createConnection>;
   34 | 
   35 | interface ActiveRoundTrip {
   36 |   readonly socket: UnixSocket;
   37 |   readonly abort: (error: Error) => void;
   38 | }
   39 | 
   40 | function isRecord(value: unknown): value is Record<string, unknown> {
   41 |   return typeof value === "object" && value !== null && !Array.isArray(value);
   42 | }
   43 | 
   44 | function appendBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
   45 |   const combined = new Uint8Array(left.length + right.length);
   46 |   combined.set(left);
   47 |   combined.set(right, left.length);
   48 |   return combined;
   49 | }
   50 | 
   51 | /**
   52 |  * Node's built-in Unix-domain-socket adapter for the TUI service seam.
   53 |  *
   54 |  * The current Rust service accepts one request per connection, so each
   55 |  * round-trip opens one socket, drains exactly one framed response, and then
   56 |  * closes it. The FramedTransport interface still keeps this detail out of
   57 |  * the controller and permits a persistent implementation when the service
   58 |  * protocol gains connection reuse.
   59 |  */
   60 | export class UnixSocketFramedTransport implements FramedTransport {
   61 |   private readonly max_payload_bytes: number;
   62 |   private readonly timeout_ms: number;
   63 |   private readonly active_round_trips = new Set<ActiveRoundTrip>();
   64 |   private closed = false;
   65 | 
   66 |   constructor(private readonly socket_path: string, options: UnixSocketTransportOptions = {}) {
   67 |     this.max_payload_bytes = options.max_payload_bytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
   68 |     this.timeout_ms = options.timeout_ms ?? 10_000;
   69 |     if (!socket_path) throw new ProtocolEnvelopeError("Unix socket path must not be empty");
   70 |     if (!Number.isInteger(this.max_payload_bytes) || this.max_payload_bytes <= 0) {
   71 |       throw new ProtocolEnvelopeError("payload limit must be a positive integer");
   72 |     }
   73 |     if (!Number.isInteger(this.timeout_ms) || this.timeout_ms <= 0) {
   74 |       throw new ProtocolEnvelopeError("socket timeout must be a positive integer");
   75 |     }
   76 |   }
   77 | 
   78 |   roundTrip(request: Uint8Array): Promise<Uint8Array> {
   79 |     if (this.closed) return Promise.reject(new ProtocolEnvelopeError("Unix socket transport is closed"));
   80 |     const wrapped = this.wrapRequest(request);
   81 |     return new Promise<Uint8Array>((resolve, reject) => {
   82 |       let received: Uint8Array = new Uint8Array(0);
   83 |       let settled = false;
   84 |       const socket = createConnection(this.socket_path, () => {
   85 |         socket.write(wrapped.frame, (error) => {
   86 |           if (error) fail(error);
   87 |         });
   88 |       });
   89 |       let activeRoundTrip: ActiveRoundTrip;
   90 | 
   91 |       const detachAndDestroy = (): void => {
   92 |         // The local Node shim intentionally exposes only the transport surface;
   93 |         // removeAllListeners is used here to detach every late event before the
   94 |         // half-open socket is destroyed.
   95 |         const detachableSocket = socket as UnixSocket & {
   96 |           removeAllListeners(): UnixSocket;
   97 |         };
   98 |         detachableSocket.removeAllListeners();
   99 |         socket.destroy();
  100 |       };
  101 | 
  102 |       const finish = (callback: () => void): void => {
  103 |         if (settled) return;
  104 |         settled = true;
  105 |         this.active_round_trips.delete(activeRoundTrip);
  106 |         callback();
  107 |         socket.end();
  108 |       };
  109 |       const fail = (error: unknown): void => {
  110 |         if (settled) return;
  111 |         settled = true;
  112 |         this.active_round_trips.delete(activeRoundTrip);
  113 |         detachAndDestroy();
  114 |         reject(error instanceof Error ? error : new Error(String(error)));
  115 |       };
  116 |       activeRoundTrip = { socket, abort: (error) => fail(error) };
  117 |       this.active_round_trips.add(activeRoundTrip);
  118 |       const consume = (): void => {
  119 |         if (received.length < FRAME_HEADER_BYTES) return;
  120 |         const payloadLength = new DataView(received.buffer, received.byteOffset, received.byteLength).getUint32(0, false);
  121 |         if (payloadLength > this.max_payload_bytes) {
  122 |           fail(new ProtocolEnvelopeError(`response payload is ${payloadLength} bytes; maximum is ${this.max_payload_bytes}`));
  123 |           return;
  124 |         }
  125 |         const frameLength = FRAME_HEADER_BYTES + payloadLength;
  126 |         if (received.length < frameLength) return;
  127 |         try {
  128 |           const applicationFrame = this.unwrapResponse(received.slice(0, frameLength), wrapped.request_id);
  129 |           finish(() => resolve(applicationFrame));
  130 |         } catch (error) {
  131 |           fail(error);
  132 |         }
  133 |       };
  134 | 
  135 |       socket.on("data", (chunk) => {
  136 |         received = appendBytes(received, chunk);
  137 |         consume();
  138 |       });
  139 |       socket.on("error", fail);
  140 |       socket.on("end", () => {
  141 |         if (!settled) fail(new Error("Unix socket closed before a complete response frame arrived"));
  142 |       });
  143 |       socket.setTimeout(this.timeout_ms, () => fail(new Error(`Unix socket timed out after ${this.timeout_ms} ms`)));
  144 |     });
  145 |   }
  146 | 
  147 |   close(): void {
  148 |     if (this.closed) return;
  149 |     this.closed = true;
  150 |     for (const activeRoundTrip of [...this.active_round_trips]) {
  151 |       activeRoundTrip.abort(new Error("Unix socket transport closed"));
  152 |     }
  153 |   }
  154 | 
  155 |   private wrapRequest(request: Uint8Array): { request_id: string; frame: Uint8Array } {
  156 |     const applicationJson = decodeJsonFrame(request, this.max_payload_bytes);
  157 |     let payload: unknown;
  158 |     try {
  159 |       payload = JSON.parse(applicationJson) as unknown;
  160 |     } catch (error) {
  161 |       throw new ProtocolEnvelopeError(`application request is not valid JSON: ${String(error)}`);
  162 |     }
  163 |     if (!isRecord(payload)) throw new ProtocolEnvelopeError("application request payload must be an object");
  164 |     const operationId = payload.operation_id;
  165 |     if (typeof operationId !== "string" || operationId.length === 0) {
  166 |       throw new ProtocolEnvelopeError("application request must contain a non-empty operation_id");
  167 |     }
  168 |     const outer: RustTransportRequest = { request_id: operationId, payload };
  169 |     return {
  170 |       request_id: operationId,
  171 |       frame: encodeJsonFrame(JSON.stringify(outer), this.max_payload_bytes),
  172 |     };
  173 |   }
  174 | 
  175 |   private unwrapResponse(responseFrame: Uint8Array, expectedRequestId: string): Uint8Array {
  176 |     const outerJson = decodeJsonFrame(responseFrame, this.max_payload_bytes);
  177 |     let value: unknown;
  178 |     try {
  179 |       value = JSON.parse(outerJson) as unknown;
  180 |     } catch (error) {
  181 |       throw new ProtocolEnvelopeError(`Rust transport response is not valid JSON: ${String(error)}`);
  182 |     }
  183 |     if (!isRecord(value)) throw new ProtocolEnvelopeError("Rust transport response must be an object");
  184 |     const response = value as unknown as RustTransportResponse;
  185 |     for (const field of Object.keys(value)) {
  186 |       if (!["request_id", "payload", "error"].includes(field)) {
  187 |         throw new ProtocolEnvelopeError(`unknown Rust transport response field ${field}`);
  188 |       }
  189 |     }
  190 |     if (response.request_id !== expectedRequestId) {
  191 |       throw new ProtocolEnvelopeError("Rust transport response request_id mismatch");
  192 |     }
  193 |     const hasPayload = Object.prototype.hasOwnProperty.call(value, "payload");
  194 |     const hasError = Object.prototype.hasOwnProperty.call(value, "error");
  195 |     if (hasPayload === hasError) {
  196 |       throw new ProtocolEnvelopeError("Rust transport response requires exactly one of payload or error");
  197 |     }
  198 |     if (hasError) {
  199 |       if (!isRecord(response.error) || typeof response.error.code !== "string" || typeof response.error.message !== "string") {
  200 |         throw new ProtocolEnvelopeError("Rust transport error is malformed");
  201 |       }
  202 |       throw new ProtocolEnvelopeError(`Rust transport ${response.error.code}: ${response.error.message}`);
  203 |     }
  204 |     if (!isRecord(response.payload)) {
  205 |       throw new ProtocolEnvelopeError("Rust transport response payload must be an application envelope object");
  206 |     }
  207 |     return encodeJsonFrame(JSON.stringify(response.payload), this.max_payload_bytes);
  208 |   }
  209 | }
````
