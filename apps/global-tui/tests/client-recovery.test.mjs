import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GlobalProtocolError, GlobalServiceClient } from "../dist/client.js";

function encode(value) {
  const body = Buffer.from(JSON.stringify(value));
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length);
  return Buffer.concat([header, body]);
}

async function fakeService(respond) {
  const dir = await mkdtemp(join(tmpdir(), "global-client-recovery-"));
  const socketPath = join(dir, "service.sock");
  let calls = 0;
  const server = createServer(socket => {
    let received = Buffer.alloc(0);
    socket.on("data", chunk => {
      received = Buffer.concat([received, chunk]);
      if (received.length < 4) return;
      const size = received.readUInt32BE(0);
      if (received.length < size + 4) return;
      const request = JSON.parse(received.subarray(4, size + 4).toString("utf8"));
      calls++;
      socket.end(encode(respond(request)));
    });
  });
  await new Promise(resolve => server.listen(socketPath, resolve));
  return {
    socketPath,
    calls: () => calls,
    close: async () => {
      await new Promise(resolve => server.close(resolve));
      await rm(dir, { recursive: true, force: true });
    },
  };
}

function validResponse(request, changes = {}) {
  const response = {
    request_id: request.request_id,
    payload: {
      api_version: "2",
      schema_version: "boreal.protocol.envelope.v1",
      operation_id: request.payload.operation_id,
      revision: 8,
      as_of: "2026-09-30T00:00:00Z",
      transport: "ok",
      outcome: "changed",
      data: { revision: 8 },
      error: null,
    },
  };
  for (const [path, value] of Object.entries(changes)) {
    if (path === "outer") Object.assign(response, value);
    else if (path === "remove_payload") delete response.payload;
    else if (path === "remove_data") delete response.payload.data;
    else response.payload[path] = value;
  }
  return response;
}

test("malformed post-delivery envelopes freeze mutations with the original operation id", async t => {
  const brokenResponses = [
    ["outer correlation", request => ({ ...validResponse(request), request_id: "wrong-id" })],
    ["missing outer payload", request => validResponse(request, { remove_payload: true })],
    ["API version", request => validResponse(request, { api_version: "99" })],
    ["envelope schema", request => validResponse(request, { schema_version: "wrong" })],
    ["operation correlation", request => validResponse(request, { operation_id: "other-operation" })],
    ["null successful data", request => validResponse(request, { data: null })],
    ["missing successful data", request => validResponse(request, { remove_data: true })],
    ["unknown error field", request => validResponse(request, { outcome: "rejected", data: null, error: { code: "invalid_argument", message: "rejected", surprise: true } })],
    ["malformed error", request => validResponse(request, { error: "not-an-error-object" })],
    ["invalid outcome", request => validResponse(request, { outcome: "maybe" })],
  ];

  for (const [name, respond] of brokenResponses) {
    const service = await fakeService(request => respond(request));
    t.after(service.close);
    const client = new GlobalServiceClient(service.socketPath, 500);
    await assert.rejects(
      client.execute("todo complete", { item_id: "item-1" }, true),
      error => {
        assert.ok(error instanceof GlobalProtocolError, `${name}: ${String(error)}`);
        assert.equal(error.unknownOutcome, true, name);
        assert.equal(error.readbackRequired, true, name);
        assert.match(error.operationId, /^global_/);
        return true;
      },
      name,
    );
    assert.equal(service.calls(), 1, `${name}: mutation was not retried`);
  }
});

test("valid conflict and rejection envelopes are known outcomes, not uncertain writes", async t => {
  for (const [outcome, code] of [["conflict", "revision_conflict"], ["rejected", "invalid_argument"]]) {
    const service = await fakeService(request => validResponse(request, {
      outcome,
      data: null,
      error: { code, message: "known result", retryable: false },
    }));
    t.after(service.close);
    await assert.rejects(
      new GlobalServiceClient(service.socketPath).execute("todo complete", { item_id: "item-1" }, true),
      error => error instanceof GlobalProtocolError && !error.unknownOutcome && error.errorCode === code,
    );
  }
});
