import {
  ActionDisabledError,
  API_VERSION,
  ENVELOPE_SCHEMA,
  Envelope,
  MountedWorkflowController,
  RevisionedStatusResponse,
  RevisionRefreshCoordinator,
  StatusItem,
  TuiServiceError,
  VersionedServiceApi,
  VersionedServiceClient,
  FramedTransport,
  decodeJsonFrame,
  encodeJsonFrame,
  actionAvailability,
  buildStatusView,
  contextualAction,
  validateEnvelope,
  validateRequestEnvelope,
  workflowDisplayState,
} from "./client.js";
import { createServer } from "node:net";
import { unlinkSync } from "node:fs";
import { UnixSocketFramedTransport } from "./node-transport.js";
import { mountAndRender, parseTerminalArgs } from "./entrypoint.js";
import { lineShellHelp, parseLineCommand, runLineShell } from "./line-shell.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function throws(action: () => unknown): void {
  let didThrow = false;
  try { action(); } catch { didThrow = true; }
  assert(didThrow, "expected action to throw");
}

async function throwsAsync(action: () => Promise<unknown>, expected: string): Promise<void> {
  let error: unknown;
  try { await action(); } catch (caught) { error = caught; }
  assert(error instanceof ActionDisabledError, `${expected}: expected ActionDisabledError`);
  assert((error as ActionDisabledError).reason.includes(expected), `${expected}: wrong disable reason`);
}

function envelope<T>(revision: number | null, data: T | null, outcome: Envelope<T>["outcome"] = "unchanged", error: Envelope<T>["error"] = null, asOf = `2026-09-14T22:${revision ?? 0}:00Z`): Envelope<T> {
  return {
    api_version: API_VERSION,
    schema_version: ENVELOPE_SCHEMA,
    operation_id: `op_test_${revision ?? "none"}_${Math.random().toString(36).slice(2, 7)}`,
    revision,
    as_of: asOf,
    next_status_change_at: null,
    transport: outcome === "failed" || outcome === "unknown" ? "error" : "ok",
    outcome,
    data,
    detail_ref: null,
    error,
  };
}

function item(work_id: string, status: StatusItem["status"], extra: Partial<StatusItem> = {}): StatusItem {
  return {
    work_id,
    project_id: "project_test",
    status,
    display_status: status,
    reason_codes: [],
    claimable: status === "ready",
    claimable_for_actor: status === "ready",
    next_action: null,
    ...extra,
  };
}

function monitoring(revision: number, items: StatusItem[]): Envelope<RevisionedStatusResponse> {
  return envelope(revision, {
    revision,
    as_of: `2026-09-14T22:${revision}:00Z`,
    total: items.length,
    counts: {
      matched: items.length,
      queued: items.filter((entry) => entry.status === "queued").length,
      ready: items.filter((entry) => entry.status === "ready").length,
      blocked: items.filter((entry) => entry.status === "blocked").length,
      in_progress: items.filter((entry) => entry.status === "in_progress").length,
      expired_review: items.filter((entry) => entry.status === "expired_review").length,
      closed: items.filter((entry) => entry.status === "closed").length,
    },
    items,
  }, "unchanged", null, `2026-09-14T22:${revision}:00Z`);
}

const initialItems = [
  item("w1", "queued", { reason_codes: ["prerequisite_open:w0"] }),
  item("w2", "ready"),
];
const initialEnvelope = monitoring(4, initialItems);
const view = buildStatusView(initialEnvelope);
assert(view.revision === 4, "revision");
assert(view.as_of === initialEnvelope.as_of, "single as_of");
assert(view.total === 2 && view.counts.queued === 1 && view.counts.ready === 1, "monitoring counts");
assert(contextualAction(view.items[0]) === "wait for prerequisite", "queued action");
assert(contextualAction(view.items[1]) === "claim", "ready action");
throws(() => validateEnvelope({ ...initialEnvelope, api_version: "1" }));
throws(() => validateEnvelope({ ...initialEnvelope, outcome: "rejected", error: null }));

const blocked = item("blocked", "blocked", { claimable: true });
const queued = item("queued", "queued", { claimable: true });
const expired = item("expired", "expired_review", { claimable: true, attempt: { attempt_id: "a-expired", fence: 2, phase: "running" } });
const gateOpen = item("gate", "in_progress", {
  attempt: { attempt_id: "a-gate", fence: 3, phase: "accepted" },
  gates: { open: [{ gate_id: "verify", kind: "verification", required: true, state: "open" }], satisfied: [] },
});
const disabled = (work: StatusItem, action: string) => actionAvailability(work).find((entry) => entry.action === action);
assert(disabled(blocked, "claim")?.enabled === false && disabled(blocked, "claim")?.reason === "work is blocked", "blocked claim disabled");
assert(disabled(queued, "claim")?.enabled === false && disabled(queued, "claim")?.reason === "waiting for prerequisite", "queued claim disabled");
assert(disabled(expired, "release")?.enabled === false && disabled(expired, "release")?.reason === "expiry requires review", "expired release disabled");
assert(disabled(gateOpen, "finish")?.enabled === false && disabled(gateOpen, "finish")?.reason === "required gate is open", "gate finish disabled");
assert(disabled(gateOpen, "evidence")?.enabled === true, "gate evidence remains available");
assert(workflowDisplayState(gateOpen) === "gate", "open gate is a distinct display state");
assert(parseLineCommand("help").kind === "help", "line shell parses help");
assert(parseLineCommand("select task-flow").kind === "select", "line shell parses work selection");
assert(parseLineCommand("exit").kind === "quit", "line shell accepts exit alias");
const parsedClaim = parseLineCommand("claim actor-luna --session session-1 --harness harness-1");
assert(parsedClaim.kind === "mutation" && parsedClaim.action === "claim" && parsedClaim.actor_id === "actor-luna" && parsedClaim.session_id === "session-1", "line shell parses structured claim");
const parsedEvidence = parseLineCommand('evidence {"receipt_id":"r1","result":"passed"}');
assert(parsedEvidence.kind === "mutation" && parsedEvidence.action === "evidence" && typeof parsedEvidence.evidence === "object", "line shell parses structured evidence JSON");
assert(parseLineCommand("finish done with proof").kind === "mutation", "line shell parses finish");
assert(parseLineCommand("release handoff").kind === "mutation", "line shell parses release");
assert(parseLineCommand("claim").kind === "invalid", "line shell rejects incomplete mutation syntax");
assert(parseLineCommand("evidence not-json").kind === "invalid", "line shell rejects invalid evidence JSON");
assert(lineShellHelp().includes("refresh") && lineShellHelp().includes("select WORK_ID") && lineShellHelp().includes("confirm"), "line shell help is bounded");

const unicodePayload = "{\"message\":\"snowman ☃\"}";
const unicodeFrame = encodeJsonFrame(unicodePayload);
assert(decodeJsonFrame(unicodeFrame) === unicodePayload, "framing preserves UTF-8 payloads");
throws(() => decodeJsonFrame(new Uint8Array([0, 0, 0, 3, 123])));
throws(() => validateRequestEnvelope({
  api_version: API_VERSION,
  schema_version: ENVELOPE_SCHEMA,
  operation_id: "op_bad_request",
  expected_revision: 1,
  attempt_id: null,
  attempt_fence: 1.5,
  data: {},
}));

class RecordingTransport implements FramedTransport {
  readonly requests: Array<Record<string, unknown>> = [];
  constructor(private readonly response: (request: Record<string, unknown>) => Record<string, unknown>) {}

  async roundTrip(frame: Uint8Array): Promise<Uint8Array> {
    const request = JSON.parse(decodeJsonFrame(frame)) as Record<string, unknown>;
    this.requests.push(request);
    return encodeJsonFrame(JSON.stringify(this.response(request)));
  }
}

const transport = new RecordingTransport((request) => {
  const operation_id = request.operation_id as string;
  const commandData = request.data as Record<string, unknown>;
  const result = envelope(8, commandData.command === "status" ? {
    revision: 8,
    total: 1,
    items: [item("wire-task", "ready")],
    counts: { matched: 1, ready: 1 },
  } : { accepted: true }, "changed");
  result.operation_id = operation_id;
  return {
    api_version: API_VERSION,
    schema_version: ENVELOPE_SCHEMA,
    operation_id,
    data: result,
  };
});
const wireClient = new VersionedServiceClient(transport, { max_payload_bytes: 4096 });
const wireStatus = await wireClient.readStatus({ project_id: "project_test", limit: 3, cursor_revision: null });
assert(wireStatus.data?.items[0]?.work_id === "wire-task", "wire client decodes service status");
assert((transport.requests[0].data as Record<string, unknown>).command === "status", "wire client routes status through service command");
assert((transport.requests[0].data as Record<string, unknown>).cursor_revision === null, "wire client requests a full snapshot cursor");
const wireClaim = await wireClient.claim({
  api_version: API_VERSION,
  schema_version: ENVELOPE_SCHEMA,
  operation_id: "op_wire_claim",
  expected_revision: 8,
  attempt_id: "attempt-wire",
  attempt_fence: 4,
  data: { project_id: "project_test", work_id: "wire-task", actor_id: "actor-luna" },
});
assert(wireClaim.outcome === "changed" && (transport.requests[1].data as Record<string, unknown>).command === "claim", "wire client routes mutation through service command");
assert((transport.requests[1].data as Record<string, unknown>).expected_revision === 8, "wire client carries revision precondition");
assert((transport.requests[1].data as Record<string, unknown>).attempt_fence === 4, "wire client carries attempt fence");

const boundedClient = new VersionedServiceClient(transport, { max_payload_bytes: 64 });
await (async () => {
  let rejected = false;
  try {
    await boundedClient.createProject({
      api_version: API_VERSION,
      schema_version: ENVELOPE_SCHEMA,
      operation_id: "op_oversized",
      expected_revision: null,
      attempt_id: null,
      attempt_fence: null,
      data: { name: "x".repeat(200) },
    });
  } catch { rejected = true; }
  assert(rejected, "wire client bounds request payloads before transport");
})();

const mismatchTransport: FramedTransport = {
  async roundTrip() {
    return encodeJsonFrame(JSON.stringify({
      api_version: API_VERSION,
      schema_version: ENVELOPE_SCHEMA,
      operation_id: "op_other",
      data: envelope(1, null),
    }));
  },
};
let correlationRejected = false;
try { await new VersionedServiceClient(mismatchTransport).readStatus(); } catch { correlationRejected = true; }
assert(correlationRejected, "wire client rejects mismatched response correlation");

const unavailableClient = new VersionedServiceClient({
  async roundTrip() { throw new Error("socket closed"); },
});
const unavailable = await unavailableClient.readStatus();
assert(unavailable.transport === "error" && unavailable.error?.code === "service_unavailable", "wire client returns typed transport errors");

let reads = 0;
const coordinator = new RevisionRefreshCoordinator({
  async readStatus() {
    reads += 1;
    await Promise.resolve();
    return initialEnvelope;
  },
});
const first = coordinator.refresh();
const second = coordinator.notifyRevision();
assert(first === second, "refreshes are coalesced");
await first;
assert(reads === 1, "one in-flight read");

let cursorReads: Array<number | null | undefined> = [];
const cursorCoordinator = new RevisionRefreshCoordinator({
  async readStatus(options) {
    cursorReads.push(options?.cursor_revision);
    return monitoring(cursorReads.length === 1 ? 40 : 42, []);
  },
});
await cursorCoordinator.refresh();
assert(cursorReads[0] === null, "first refresh requests a complete snapshot");
await cursorCoordinator.notifyRevision(42);
assert(cursorReads[1] === null, "missed revision cursor requests a resnapshot");
const readsBeforeSameRevision = cursorReads.length;
await cursorCoordinator.notifyRevision(42);
assert(cursorReads.length === readsBeforeSameRevision, "unchanged revision notification does not poll");

type Call = { name: string; request: { operation_id: string; expected_revision: number | null; attempt_id: string | null; attempt_fence: number | null; data: unknown } };
let currentRevision = 10;
let currentItems: StatusItem[] = [
  item("task-flow", "ready"),
  item("task-release", "in_progress", { attempt: { attempt_id: "attempt-release", fence: 1, phase: "accepted" } }),
];
const calls: Call[] = [];
const record = <T>(name: string, request: Call["request"], data: T | null = null): Envelope<T> => {
  calls.push({ name, request });
  currentRevision += 1;
  return envelope(currentRevision, data, "changed", null, `2026-09-14T22:${currentRevision}:00Z`);
};
const service: VersionedServiceApi = {
  async readStatus() { return monitoring(currentRevision, currentItems); },
  async createProject(request) { return record("createProject", request, { project_id: "project-created" }); },
  async createWork(request) { return record("createWork", request, { work_id: "task-flow" }); },
  async claim(request) {
    currentItems = currentItems.map((entry) => entry.work_id === "task-flow" ? { ...entry, status: "claimed", display_status: "claimed", claimable: false, claimable_for_actor: false, attempt: { attempt_id: "attempt-flow", fence: 7, phase: "claimed" } } : entry);
    return record("claim", request, { work_id: "task-flow", attempt_id: "attempt-flow", fence: 7 });
  },
  async acceptStart(request) {
    currentItems = currentItems.map((entry) => entry.work_id === "task-flow" ? { ...entry, status: "in_progress", display_status: "in_progress", attempt: { attempt_id: "attempt-flow", fence: 7, phase: "accepted" } } : entry);
    return record("acceptStart", request, { work_id: "task-flow", attempt_id: "attempt-flow", fence: 7 });
  },
  async addEvidence(request) {
    return record("addEvidence", request, { receipt_id: "receipt-flow" });
  },
  async finish(request) {
    currentItems = currentItems.map((entry) => entry.work_id === "task-flow" ? { ...entry, status: "closed", display_status: "closed", attempt: null } : entry);
    return record("finish", request, { work_id: "task-flow", status: "closed" });
  },
  async release(request) {
    currentItems = currentItems.map((entry) => entry.work_id === "task-release" ? { ...entry, status: "ready", display_status: "ready", claimable: true, claimable_for_actor: true, attempt: null } : entry);
    return record("release", request, { work_id: "task-release", released: true });
  },
};

const controller = new MountedWorkflowController(service);
await controller.mount({ kind: "monitoring", project_id: "project_test" });
assert(controller.view().actions.some((action) => action.action === "create_project"), "project action is mounted");
const shellOutput: string[] = [];
const shellLines: AsyncIterable<string> = {
  async *[Symbol.asyncIterator]() {
    yield "help";
    yield "select task-release";
    yield "refresh";
    yield "quit";
    yield "select task-flow";
  },
};
await runLineShell(shellLines, controller, (value) => shellOutput.push(value));
assert(shellOutput.length === 3 && shellOutput[0].includes("select WORK_ID") && shellOutput[2].includes("revision:"), "line shell handles help, selection, refresh, and quit");
assert(controller.view().route.work_id === "task-release", "line shell selection uses controller navigation");
const unknownSelection: string[] = [];
await runLineShell((async function* () { yield "select missing"; yield "quit"; })(), controller, (value) => unknownSelection.push(value));
assert(unknownSelection[0].includes("not present") && controller.view().route.work_id === "task-release", "line shell rejects unknown work selection safely");
const projectResult = await controller.createProject({ name: "Project created" });
assert(projectResult.ok && controller.view().route.kind === "project" && controller.view().route.project_id === "project-created", "project creation route");
const workResult = await controller.createWork({ project_id: "project-created", kind: "task", title: "Flow task" });
assert(workResult.ok && controller.view().route.kind === "work" && controller.view().route.work_id === "task-flow", "work creation route");
await controller.claim("task-flow", "actor-luna");
await controller.acceptStart("task-flow", { session_id: "session-flow" });
await controller.addEvidence("task-flow", { receipt_id: "receipt-flow", result: "passed" });
const finished = await controller.finish("task-flow", "done");
assert(finished.ok && controller.view().selected_work?.status === "closed", "claim/accept/evidence/finish flow");
controller.navigate({ kind: "work", project_id: "project-created", work_id: "task-release" });
const released = await controller.release("task-release", "handoff");
assert(released.ok && controller.view().selected_work?.status === "ready", "release flow");
assert(calls.map((call) => call.name).join(",") === "createProject,createWork,claim,acceptStart,addEvidence,finish,release", "all mounted service actions called");
assert(calls.every((call) => call.request.operation_id.startsWith("op_tui_")), "operation IDs are client-generated");
assert(calls.some((call) => call.name === "claim" && call.request.expected_revision !== null), "claim carries expected revision");
assert(calls.some((call) => call.name === "acceptStart" && call.request.attempt_fence === 7), "accept carries attempt fence");

let shellRevision = 50;
let shellItems: StatusItem[] = [
  item("shell-task", "ready"),
  item("shell-release", "in_progress", { attempt: { attempt_id: "attempt-shell-release", fence: 2, phase: "accepted" } }),
];
const shellCalls: Call[] = [];
const shellRecord = <T>(name: string, request: Call["request"], data: T | null = null): Envelope<T> => {
  shellCalls.push({ name, request });
  shellRevision += 1;
  const result = envelope(shellRevision, data, "changed", null, `2026-09-14T22:${shellRevision}:00Z`);
  result.operation_id = request.operation_id;
  return result;
};
const shellService: VersionedServiceApi = {
  ...service,
  async readStatus() { return monitoring(shellRevision, shellItems); },
  async claim(request) {
    shellItems = shellItems.map((entry) => entry.work_id === "shell-task"
      ? { ...entry, status: "claimed", display_status: "claimed", claimable: false, claimable_for_actor: false, attempt: { attempt_id: "attempt-shell", fence: 4, phase: "claimed" } }
      : entry);
    return shellRecord("claim", request, { work_id: "shell-task", attempt_id: "attempt-shell", fence: 4 });
  },
  async acceptStart(request) {
    shellItems = shellItems.map((entry) => entry.work_id === "shell-task"
      ? { ...entry, status: "in_progress", display_status: "in_progress", attempt: { attempt_id: "attempt-shell", fence: 4, phase: "accepted" } }
      : entry);
    return shellRecord("acceptStart", request, { work_id: "shell-task", attempt_id: "attempt-shell", fence: 4 });
  },
  async addEvidence(request) {
    return shellRecord("addEvidence", request, { receipt_id: "receipt-shell" });
  },
  async finish(request) {
    shellItems = shellItems.map((entry) => entry.work_id === "shell-task"
      ? { ...entry, status: "closed", display_status: "closed", attempt: null }
      : entry);
    return shellRecord("finish", request, { work_id: "shell-task", status: "closed" });
  },
  async release(request) {
    shellItems = shellItems.map((entry) => entry.work_id === "shell-release"
      ? { ...entry, status: "ready", display_status: "ready", claimable: true, claimable_for_actor: true, attempt: null }
      : entry);
    return shellRecord("release", request, { work_id: "shell-release", released: true });
  },
};
const shellController = new MountedWorkflowController(shellService);
await shellController.mount({ kind: "monitoring", project_id: "project_test" });
const shellMutationOutput: string[] = [];
await runLineShell((async function* () {
  yield "select shell-task";
  yield "claim actor-shell";
  yield "quit";
})(), shellController, (value) => shellMutationOutput.push(value));
assert(shellCalls.length === 0, "line shell does not mutate before confirmation");
shellMutationOutput.length = 0;
await runLineShell((async function* () {
  yield "claim actor-shell --session session-shell --harness harness-shell";
  yield "confirm";
  yield "accept-start --session session-shell";
  yield "confirm";
  yield 'evidence {"receipt_id":"receipt-shell","result":"passed"}';
  yield "confirm";
  yield "finish done shell";
  yield "confirm";
  yield "select shell-release";
  yield "release handoff";
  yield "confirm";
  yield "quit";
})(), shellController, (value) => shellMutationOutput.push(value));
assert(shellMutationOutput.some((value) => value.includes("expected_revision=50") && value.includes("attempt_fence=none")), "confirmation shows revision and initial fence");
assert(shellMutationOutput.filter((value) => value.includes("enter confirm or cancel")).length === 5, "every shell mutation requires confirmation");
assert(shellMutationOutput.some((value) => value.includes("operation=op_tui_") && value.includes("outcome=changed")), "shell renders mutation operation outcome");
assert(shellCalls.map((call) => call.name).join(",") === "claim,acceptStart,addEvidence,finish,release", "shell routes only supported controller lifecycle actions");
assert(shellController.view().selected_work?.status === "ready", "shell release refreshes the mounted view");

const staleService: VersionedServiceApi = {
  ...service,
  async readStatus() { return monitoring(20, [item("stale-task", "ready")]); },
  async claim(request) {
    return envelope(21, null, "conflict", {
      code: "stale_revision",
      message: "The expected project revision is no longer current.",
      expected_revision: request.expected_revision ?? undefined,
      observed_revision: 21,
      retryable: true,
    });
  },
};
const staleController = new MountedWorkflowController(staleService);
await staleController.mount({ kind: "work", project_id: "project_test", work_id: "stale-task" });
const staleResult = await staleController.claim("stale-task", "actor-luna");
assert(!staleResult.ok && staleResult.error instanceof TuiServiceError && staleResult.error.stale, "typed stale error");
assert(staleController.view().notice?.kind === "stale_revision", "stale revision is displayed");
assert(staleController.view().notice?.stale?.expected_revision === 20, "stale expected revision is displayed");

const blockedController = new MountedWorkflowController({
  ...service,
  async readStatus() { return monitoring(30, [blocked, queued, expired, gateOpen]); },
});
await blockedController.mount({ kind: "work", project_id: "project_test", work_id: "blocked" });
await throwsAsync(() => blockedController.claim("blocked", "actor-luna"), "work is blocked");
blockedController.navigate({ kind: "work", project_id: "project_test", work_id: "queued" });
await throwsAsync(() => blockedController.claim("queued", "actor-luna"), "waiting for prerequisite");
blockedController.navigate({ kind: "work", project_id: "project_test", work_id: "expired" });
await throwsAsync(() => blockedController.release("expired"), "expiry requires review");
blockedController.navigate({ kind: "work", project_id: "project_test", work_id: "gate" });
await throwsAsync(() => blockedController.finish("gate"), "required gate is open");

let resolvePending: ((value: Envelope<RevisionedStatusResponse>) => void) | undefined;
let pendingReads = 0;
const pendingCoordinator = new RevisionRefreshCoordinator({
  readStatus() {
    pendingReads += 1;
    return new Promise<Envelope<RevisionedStatusResponse>>((resolve) => { resolvePending = resolve; });
  },
});
const burst = pendingCoordinator.refresh();
const burstNotify = pendingCoordinator.notifyRevision();
const burstRefresh = pendingCoordinator.refresh();
assert(burst === burstNotify && burst === burstRefresh, "revision burst coalesced");
assert(pendingReads === 1, "burst made one service read");
resolvePending?.(monitoring(31, []));
await burst;

const socketPath = `/tmp/boreal-tui-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`;
const fakeServer = createServer((socket) => {
  let frame = new Uint8Array(0);
  socket.on("data", (chunk) => {
    frame = new Uint8Array([...frame, ...chunk]);
    if (frame.length < 4) return;
    const payloadLength = new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint32(0, false);
    if (frame.length < 4 + payloadLength) return;
    const request = JSON.parse(decodeJsonFrame(frame.slice(0, 4 + payloadLength))) as { operation_id: string };
    const response = monitoring(41, [item("socket-task", "ready")]);
    response.operation_id = request.operation_id;
    socket.write(encodeJsonFrame(JSON.stringify({
      api_version: API_VERSION,
      schema_version: ENVELOPE_SCHEMA,
      operation_id: request.operation_id,
      data: response,
    })));
    socket.end();
  });
});
await new Promise<void>((resolve, reject) => {
  fakeServer.on("error", reject);
  fakeServer.listen(socketPath, resolve);
});
try {
  const socketTransport = new UnixSocketFramedTransport(socketPath, { max_payload_bytes: 4096, timeout_ms: 2_000 });
  const rawResponse = await socketTransport.roundTrip(encodeJsonFrame(JSON.stringify({ ping: true }), 4096));
  assert(JSON.parse(decodeJsonFrame(rawResponse)).data !== undefined, "Unix socket adapter receives one framed response");
  let rendered = "";
  await mountAndRender(parseTerminalArgs(["--socket", socketPath, "--project", "project_test"]), (value) => { rendered += value; });
  assert(rendered.includes("Boreal v2 TUI") && rendered.includes("socket-task: ready"), "entrypoint mounts and renders the controller");
  assert(parseTerminalArgs(["--socket", socketPath, "--project", "project_test", "--interactive"]).interactive === true, "entrypoint parses explicit interactive mode");
  let invalidFrame = false;
  try { await socketTransport.roundTrip(new Uint8Array([0, 0, 0, 2, 1])); } catch { invalidFrame = true; }
  assert(invalidFrame, "Unix socket adapter rejects incomplete request frames");
} finally {
  await new Promise<void>((resolve, reject) => fakeServer.close((error) => error ? reject(error) : resolve()));
  try { unlinkSync(socketPath); } catch { /* server cleanup already removed it */ }
}

const reconnectSocketPath = `/tmp/boreal-tui-reconnect-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`;
let reconnectConnections = 0;
const reconnectServer = createServer((socket) => {
  reconnectConnections += 1;
  if (reconnectConnections === 1) {
    socket.destroy();
    return;
  }
  let frame = new Uint8Array(0);
  socket.on("data", (chunk) => {
    frame = new Uint8Array([...frame, ...chunk]);
    if (frame.length < 4) return;
    const payloadLength = new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint32(0, false);
    if (frame.length < 4 + payloadLength) return;
    const request = JSON.parse(decodeJsonFrame(frame.slice(0, 4 + payloadLength))) as { operation_id: string };
    const response = monitoring(42, [item("reconnect-task", "ready")]);
    response.operation_id = request.operation_id;
    socket.write(encodeJsonFrame(JSON.stringify({
      api_version: API_VERSION,
      schema_version: ENVELOPE_SCHEMA,
      operation_id: request.operation_id,
      data: response,
    })), () => socket.destroy());
  });
});
await new Promise<void>((resolve, reject) => {
  reconnectServer.on("error", reject);
  reconnectServer.listen(reconnectSocketPath, resolve);
});
try {
  const reconnectController = new MountedWorkflowController(new VersionedServiceClient(
    new UnixSocketFramedTransport(reconnectSocketPath, { max_payload_bytes: 4096, timeout_ms: 2_000 }),
  ));
  let initialMountFailed = false;
  try {
    await reconnectController.mount({ kind: "monitoring", project_id: "project_test" });
  } catch {
    initialMountFailed = true;
  }
  assert(initialMountFailed, "initial mount reports a dropped service connection");
  const recoveredView = await reconnectController.mount({ kind: "monitoring", project_id: "project_test" });
  assert(recoveredView.mounted && recoveredView.monitoring?.revision === 42, "mounted controller recovers after reconnect");
  assert(recoveredView.selected_work === null, "monitoring reconnect has no implicit selection");
  assert(reconnectConnections === 2, "retry uses a fresh Unix socket connection");
} finally {
  await new Promise<void>((resolve, reject) => reconnectServer.close((error) => error ? reject(error) : resolve()));
  try { unlinkSync(reconnectSocketPath); } catch { /* server cleanup already removed it */ }
}

console.log("TUI mounted workflow, protocol/error, monitoring, disabled-action, and refresh tests passed");
