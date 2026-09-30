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

test("client exposes pollable linked-detail jobs and note backlinks", async t => {
  const commands = [];
  const service = await fakeService(request => {
    const command = request.payload.command;
    commands.push(command);
    const response = validResponse(request);
    if (command === "linked page") response.payload.data = {
      availability: "refreshing", job_id: "job-1", items: [], items_total: null,
      revision: null, as_of: null, error: null,
    };
    else if (command === "linked job show") response.payload.data = {
      job_id: request.payload.payload.job_id, state: "complete", page: {
        availability: "available", items: [{ work_id: "work-1", title: "Review" }],
        items_total: 1, items_limit: 50, items_offset: 0, items_has_more: false,
        revision: 7, as_of: "2026-09-30T00:00:00Z", error: null,
      },
    };
    else if (command === "note show") response.payload.data = {
      id: "note-1", project_id: "p1", title: "Planning", archived: false,
      created_at: "now", updated_at: "now", linked_items: [{ id: "item-1", title: "Review" }],
    };
    return response;
  });
  t.after(service.close);
  const client = new GlobalServiceClient(service.socketPath);
  const pending = await client.linkedPage("p1", "workspace-1");
  assert.equal(pending.availability, "refreshing");
  assert.equal(pending.job_id, "job-1");
  const completed = await client.linkedJobShow(pending.job_id);
  assert.equal(completed.state, "complete");
  assert.equal(completed.page.items[0].work_id, "work-1");
  assert.equal((await client.noteShow("note-1")).linked_items[0].id, "item-1");
  assert.deepEqual(commands, ["linked page", "linked job show", "note show"]);
});

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
