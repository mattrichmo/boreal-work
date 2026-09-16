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
  TuiWorkflowContext,
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
import { FullScreenTerminal, TerminalSignal, decodeKeys, runFullScreen } from "./full-screen.js";
import { renderMountedView } from "./terminal.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function throws(action: () => unknown): void {
  let didThrow = false;
  try { action(); } catch { didThrow = true; }
  assert(didThrow, "expected action to throw");
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[], message: string): void {
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = [...expected].sort();
  assert(JSON.stringify(actualKeys) === JSON.stringify(expectedKeys), `${message}: ${actualKeys.join(", ")}`);
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
const skewedAsOf = {
  ...initialEnvelope,
  as_of: "2026-09-14T22:04:00.000Z",
  data: { ...initialEnvelope.data!, as_of: "2026-09-14T22:04:00.001Z" },
};
assert(buildStatusView(skewedAsOf).as_of === skewedAsOf.as_of, "envelope as_of remains authoritative when service echo is skewed");

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
const parsedClaim = parseLineCommand("claim");
assert(parsedClaim.kind === "mutation" && parsedClaim.action === "claim", "line shell uses the mounted claim identity");
assert(parseLineCommand("claim actor-luna").kind === "invalid", "line shell rejects per-request actor overrides");
const parsedProject = parseLineCommand("create-project project_test --role operator --display-name Luna");
assert(parsedProject.kind === "mutation" && parsedProject.action === "create_project" && parsedProject.input.project_id === "project_test", "line shell parses project creation");
const parsedWork = parseLineCommand("create-work task-new task Ship route --parent sprint-1 --priority 7");
assert(parsedWork.kind === "mutation" && parsedWork.action === "create_work" && parsedWork.input.title === "Ship route" && parsedWork.input.priority === 7, "line shell parses typed work creation");
const parsedEvidence = parseLineCommand('evidence {"receipt_id":"r1","result":"passed"}');
assert(parsedEvidence.kind === "mutation" && parsedEvidence.action === "evidence" && typeof parsedEvidence.evidence === "object", "line shell parses structured evidence JSON");
assert(parseLineCommand("finish done with proof").kind === "mutation", "line shell parses finish");
assert(parseLineCommand("release handoff").kind === "mutation", "line shell parses release");
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
const wireClient = new VersionedServiceClient(transport, {
  max_payload_bytes: 4096,
  project_id: "project_test",
  actor_id: "actor-luna",
  harness_id: "harness-test",
  session_id: "session-test",
});
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
  data: {
    project_id: "project_test",
    work_id: "wire-task",
    actor_id: "actor-luna",
    harness_id: "harness-test",
    session_id: "session-test",
    attempt_id: "attempt-test",
    claimed_at: "2026-09-14T22:00:00Z",
    lease_deadline: "2026-09-14T22:15:00Z",
    hard_deadline: "2026-09-15T00:00:00Z",
  },
});
assert(wireClaim.outcome === "changed" && (transport.requests[1].data as Record<string, unknown>).command === "claim", "wire client routes mutation through service command");
assert((transport.requests[1].data as Record<string, unknown>).expected_revision === 8, "wire client carries revision precondition");
assert((transport.requests[1].data as Record<string, unknown>).attempt_fence === 4, "wire client carries attempt fence");
assert((transport.requests[1].data as Record<string, unknown>).project_id === "project_test", "claim carries project context");
assert((transport.requests[1].data as Record<string, unknown>).harness_id === "harness-test", "claim carries harness context");
assert((transport.requests[1].data as Record<string, unknown>).session_id === "session-test", "claim carries session context");

const wireEvidence = await wireClient.addEvidence({
  api_version: API_VERSION,
  schema_version: ENVELOPE_SCHEMA,
  operation_id: "op_wire_evidence",
  expected_revision: 8,
  attempt_id: "attempt-test",
  attempt_fence: 4,
  data: {
    project_id: "project_test",
    work_id: "wire-task",
    attempt_id: "attempt-test",
    fence: 4,
    actor_id: "actor-luna",
    harness_id: "harness-test",
    session_id: "session-test",
    receipt: { receipt_id: "receipt-wire", result: "passed" },
  },
});
assert(wireEvidence.outcome === "changed", "wire evidence response is accepted");
assert((transport.requests[2].data as Record<string, unknown>).command === "evidence_add", "evidence uses the Rust evidence_add route");
assert((transport.requests[2].data as Record<string, unknown>).receipt !== undefined, "evidence sends receipt rather than an opaque evidence field");
assert((transport.requests[2].data as Record<string, unknown>).actor_id === "actor-luna", "evidence carries actor context");

const wireFinish = await wireClient.finish({
  api_version: API_VERSION,
  schema_version: ENVELOPE_SCHEMA,
  operation_id: "op_wire_finish",
  expected_revision: 8,
  attempt_id: "attempt-test",
  attempt_fence: 4,
  data: {
    project_id: "project_test",
    work_id: "wire-task",
    attempt_id: "attempt-test",
    fence: 4,
    actor_id: "actor-luna",
    harness_id: "harness-test",
    session_id: "session-test",
    close: true,
    summary: "done",
    receipt: { receipt_id: "receipt-wire", result: "passed" },
  },
});
assert(wireFinish.outcome === "changed", "wire finish response is accepted");
assert((transport.requests[3].data as Record<string, unknown>).command === "finish_close", "finish uses the Rust finish_close route");
assert((transport.requests[3].data as Record<string, unknown>).session_id === "session-test", "finish carries session context");
assert((transport.requests[3].data as Record<string, unknown>).receipt !== undefined, "finish_close carries the receipt required by the Rust service");
assert((transport.requests[3].data as Record<string, unknown>).summary_body === "done", "finish_close maps the typed summary to the Rust service field");

await wireClient.createProject({
  api_version: API_VERSION,
  schema_version: ENVELOPE_SCHEMA,
  operation_id: "op_wire_create_project",
  expected_revision: null,
  attempt_id: null,
  attempt_fence: null,
  data: {
    project_id: "project_test",
    actor_id: "actor-luna",
    actor_role: "operator",
    credential_ref: "tui:harness-test",
    display_name: "Luna",
  },
});
const createProjectWire = transport.requests[4].data as Record<string, unknown>;
assert(createProjectWire.command === "create_project", "project creation uses the create_project service route");
assert(createProjectWire.project_id === "project_test" && createProjectWire.actor_id === "actor-luna" && createProjectWire.actor_role === "operator", "project creation carries complete typed identity fields");
assert(createProjectWire.name === "Luna" && createProjectWire.display_name === undefined, "project creation maps display_name to Rust's canonical name field");
assertExactKeys(createProjectWire, [
  "actor_id", "actor_role", "command", "credential_ref", "harness_id", "name", "project_id", "session_id",
], "project creation emits only the exact Rust DTO fields");

await wireClient.createWork({
  api_version: API_VERSION,
  schema_version: ENVELOPE_SCHEMA,
  operation_id: "op_wire_create_work",
  expected_revision: 8,
  attempt_id: null,
  attempt_fence: null,
  data: {
    project_id: "project_test",
    work_id: "wire-created",
    actor_id: "actor-luna",
    kind: "task",
    title: "Wire-created task",
    parent_id: "sprint-1",
    description: "created through the service route",
    priority: 7,
    dispatch_policy: "automatic",
    hard_holds: [],
    acceptance_profile: { id: "focused", version: "1" },
  },
});
const createWorkWire = transport.requests[5].data as Record<string, unknown>;
assert(createWorkWire.command === "create_work", "work creation uses the create_work service route");
assert(createWorkWire.work_id === "wire-created" && createWorkWire.parent_id === "sprint-1" && createWorkWire.priority === 7, "work creation carries complete typed planning fields");
assert(createWorkWire.dispatch === "automatic" && createWorkWire.profile === "focused", "work creation maps ergonomic policy inputs to Rust strings");
assert(createWorkWire.dispatch_policy === undefined && createWorkWire.acceptance_profile === undefined && createWorkWire.hard_holds === undefined, "work creation omits unsupported or non-canonical fields");
assertExactKeys(createWorkWire, [
  "actor_id", "command", "description", "dispatch", "expected_revision", "harness_id", "kind", "parent_id", "priority", "profile", "project_id", "session_id", "title", "work_id",
], "work creation emits only the exact Rust DTO fields");

throws(() => wireClient.createWork({
  api_version: API_VERSION,
  schema_version: ENVELOPE_SCHEMA,
  operation_id: "op_wire_unsupported_hold",
  expected_revision: 8,
  attempt_id: null,
  attempt_fence: null,
  data: {
    project_id: "project_test",
    work_id: "wire-held",
    actor_id: "actor-luna",
    kind: "task",
    title: "Held task",
    parent_id: "sprint-1",
    description: "must not be silently downgraded",
    priority: 7,
    dispatch_policy: "automatic",
    hard_holds: ["operator approval"],
    acceptance_profile: { id: "focused", version: "1" },
  },
}));

const boundedClient = new VersionedServiceClient(transport, { max_payload_bytes: 64 });
await (async () => {
  let rejected = false;
  try {
    await boundedClient.claim({
      api_version: API_VERSION,
      schema_version: ENVELOPE_SCHEMA,
      operation_id: "op_oversized",
      expected_revision: null,
      attempt_id: null,
      attempt_fence: null,
      data: {
        project_id: "project_test",
        work_id: "wire-task",
        actor_id: "actor-luna",
        harness_id: "harness-test",
        session_id: "session-test",
        attempt_id: "x".repeat(200),
        claimed_at: "2026-09-14T22:00:00Z",
        lease_deadline: "2026-09-14T22:15:00Z",
        hard_deadline: "2026-09-15T00:00:00Z",
      },
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
try {
  await new VersionedServiceClient(mismatchTransport, { project_id: "project_test", actor_id: "actor-luna" }).readStatus();
} catch { correlationRejected = true; }
assert(correlationRejected, "wire client rejects mismatched response correlation");

const unavailableClient = new VersionedServiceClient({
  async roundTrip() { throw new Error("socket closed"); },
}, { project_id: "project_test", actor_id: "actor-luna" });
const unavailable = await unavailableClient.readStatus();
assert(unavailable.transport === "error" && unavailable.error?.code === "service_unavailable", "wire client returns typed transport errors");
const unknownMutationClient = new VersionedServiceClient({
  async roundTrip() { throw new Error("response lost after delivery"); },
}, { project_id: "project_test", actor_id: "actor-luna", harness_id: "harness-test", session_id: "session-test" });
const unknownMutation = await unknownMutationClient.release({
  api_version: API_VERSION,
  schema_version: ENVELOPE_SCHEMA,
  operation_id: "op_unknown_release",
  expected_revision: 8,
  attempt_id: "attempt-test",
  attempt_fence: 4,
  data: {
    project_id: "project_test",
    work_id: "wire-task",
    attempt_id: "attempt-test",
    fence: 4,
    actor_id: "actor-luna",
    harness_id: "harness-test",
    session_id: "session-test",
  },
});
assert(unknownMutation.outcome === "unknown", "possibly delivered mutation is unknown rather than retryable failed");
assert(unknownMutation.error?.operation_preserved === true && unknownMutation.error.readback_required === true, "unknown mutation preserves operation readback requirements");

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
let deadlineReads = 0;
const deadlineCoordinator = new RevisionRefreshCoordinator({
  async readStatus() {
    deadlineReads += 1;
    return monitoring(40 + deadlineReads, []);
  },
});
await deadlineCoordinator.refresh();
await deadlineCoordinator.notifyDeadline();
assert(deadlineReads === 2, "deadline notification refreshes even without a revision event");

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
  async createProject(request) { return record("createProject", request, { project_id: "project_test" }); },
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

const tuiContext = {
  project_id: "project_test",
  actor_id: "actor-luna",
  harness_id: "harness-test",
  session_id: "session-test",
  now: () => new Date("2026-09-14T22:00:00.000Z"),
};
let notificationListener: ((notification: { kind: "revision" | "deadline"; revision?: number }) => void) | undefined;
let notificationReads = 0;
const notificationController = new MountedWorkflowController({
  ...service,
  async readStatus() {
    notificationReads += 1;
    return monitoring(60 + notificationReads, []);
  },
}, {
  context: tuiContext,
  notifications: {
    subscribe(listener) {
      notificationListener = listener;
      return () => { notificationListener = undefined; };
    },
  },
});
await notificationController.mount({ kind: "monitoring", project_id: "project_test" });
notificationListener?.({ kind: "deadline" });
await new Promise<void>((resolve) => setTimeout(resolve, 0));
assert(notificationReads === 2, "mounted controller wires deadline notifications to refresh");
notificationController.unmount();
const controller = new MountedWorkflowController(service, { context: tuiContext });
throws(() => new MountedWorkflowController(service, {
  context: { ...tuiContext, actor_id: "" } as TuiWorkflowContext,
}));
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
assert(shellOutput.length === 3 && shellOutput[0].includes("select WORK_ID") && shellOutput[2].includes("revision "), "line shell handles help, selection, refresh, and quit");
assert(controller.view().route.work_id === "task-release", "line shell selection uses controller navigation");
const unknownSelection: string[] = [];
await runLineShell((async function* () { yield "select missing"; yield "quit"; })(), controller, (value) => unknownSelection.push(value));
assert(unknownSelection[0].includes("not present") && controller.view().route.work_id === "task-release", "line shell rejects unknown work selection safely");
const projectResult = await controller.createProject({ project_id: "project_test", display_name: "Luna" });
assert(projectResult.ok && controller.view().route.kind === "project" && controller.view().route.project_id === "project_test", "project creation route");
const workResult = await controller.createWork({ work_id: "task-flow", kind: "task", title: "Flow task", parent_id: "sprint-1", priority: 9 });
assert(workResult.ok && controller.view().route.kind === "work" && controller.view().route.work_id === "task-flow", "work creation route");
await controller.claim("task-flow");
await controller.acceptStart("task-flow");
await controller.addEvidence("task-flow", { receipt_id: "receipt-flow", result: "passed" });
const finished = await controller.finish("task-flow", "done");
assert(finished.ok && controller.view().selected_work?.status === "closed", "claim/accept/evidence/finish flow");
controller.navigate({ kind: "work", project_id: "project_test", work_id: "task-release" });
const released = await controller.release("task-release", "handoff");
assert(released.ok && controller.view().selected_work?.status === "ready", "release flow");
assert(calls.map((call) => call.name).join(",") === "createProject,createWork,claim,acceptStart,addEvidence,finish,release", "all mounted service actions called");
assert(calls.every((call) => call.request.operation_id.startsWith("op_tui_")), "operation IDs are client-generated");
assert(calls.some((call) => call.name === "claim" && call.request.expected_revision !== null), "claim carries expected revision");
assert(calls.some((call) => call.name === "acceptStart" && call.request.attempt_fence === 7), "accept carries attempt fence");
assert((calls.find((call) => call.name === "claim")?.request.data as Record<string, unknown>).session_id === "session-test", "controller retains its session context");
assert((calls.find((call) => call.name === "claim")?.request.data as Record<string, unknown>).actor_id === "actor-luna", "controller retains its actor context");
assert((calls.find((call) => call.name === "claim")?.request.data as Record<string, unknown>).harness_id === "harness-test", "controller retains its harness context");
assert((calls.find((call) => call.name === "claim")?.request.data as Record<string, unknown>).attempt_id !== undefined, "controller supplies the Rust claim attempt identity");
assert((calls.find((call) => call.name === "addEvidence")?.request.data as Record<string, unknown>).receipt !== undefined, "controller uses the receipt field for evidence");
const createProjectRequest = calls.find((call) => call.name === "createProject")?.request.data as Record<string, unknown>;
assert(createProjectRequest.project_id === "project_test" && createProjectRequest.actor_id === "actor-luna" && createProjectRequest.credential_ref === "tui:harness-test", "controller completes project creation identity fields");
const createWorkRequest = calls.find((call) => call.name === "createWork")?.request.data as Record<string, unknown>;
assert(createWorkRequest.work_id === "task-flow" && createWorkRequest.actor_id === "actor-luna" && createWorkRequest.priority === 9, "controller completes work creation planning fields");

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
const shellController = new MountedWorkflowController(shellService, { context: tuiContext });
await shellController.mount({ kind: "monitoring", project_id: "project_test" });
const shellMutationOutput: string[] = [];
await runLineShell((async function* () {
  yield "select shell-task";
  yield "claim";
  yield "quit";
})(), shellController, (value) => shellMutationOutput.push(value));
assert(shellCalls.length === 0, "line shell does not mutate before confirmation");
shellMutationOutput.length = 0;
await runLineShell((async function* () {
  yield "claim";
  yield "confirm";
  yield "accept-start";
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
const staleController = new MountedWorkflowController(staleService, { context: tuiContext });
await staleController.mount({ kind: "work", project_id: "project_test", work_id: "stale-task" });
const staleResult = await staleController.claim("stale-task");
assert(!staleResult.ok && staleResult.error instanceof TuiServiceError && staleResult.error.stale, "typed stale error");
assert(staleController.view().notice?.kind === "stale_revision", "stale revision is displayed");
assert(staleController.view().notice?.stale?.expected_revision === 20, "stale expected revision is displayed");

const unknownController = new MountedWorkflowController({
  ...service,
  async readStatus() { return monitoring(22, [item("unknown-task", "ready")]); },
  async claim(request) {
    return envelope(22, null, "unknown", {
      code: "unknown_outcome",
      message: "the service response was lost after admission",
      operation_id: request.operation_id,
      operation_preserved: true,
      readback_required: true,
    });
  },
}, { context: tuiContext });
await unknownController.mount({ kind: "work", project_id: "project_test", work_id: "unknown-task" });
const unknownResult = await unknownController.claim("unknown-task");
assert(!unknownResult.ok && unknownResult.error.unknown, "controller exposes unknown mutation outcome");
assert(unknownController.view().pending_operations.some((operation) => operation.operation_id === unknownResult.error.operation_id), "controller retains unknown operation for readback");
assert(unknownController.view().notice?.kind === "unknown", "unknown outcome is visibly distinct from an ordinary failure");

const blockedController = new MountedWorkflowController({
  ...service,
  async readStatus() { return monitoring(30, [blocked, queued, expired, gateOpen]); },
}, { context: tuiContext });
await blockedController.mount({ kind: "work", project_id: "project_test", work_id: "blocked" });
await throwsAsync(() => blockedController.claim("blocked"), "work is blocked");
blockedController.navigate({ kind: "work", project_id: "project_test", work_id: "queued" });
await throwsAsync(() => blockedController.claim("queued"), "waiting for prerequisite");
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
const socketOuterRequests: Array<Record<string, unknown>> = [];
const fakeServer = createServer((socket) => {
  let frame = new Uint8Array(0);
  socket.on("data", (chunk) => {
    frame = new Uint8Array([...frame, ...chunk]);
    if (frame.length < 4) return;
    const payloadLength = new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint32(0, false);
    if (frame.length < 4 + payloadLength) return;
    const outer = JSON.parse(decodeJsonFrame(frame.slice(0, 4 + payloadLength))) as Record<string, unknown>;
    socketOuterRequests.push(outer);
    const request = outer.payload as { operation_id: string };
    const response = monitoring(41, [item("socket-task", "ready")]);
    response.operation_id = request.operation_id;
    socket.write(encodeJsonFrame(JSON.stringify({
      request_id: request.operation_id === "op_outer_mismatch" ? "wrong-request" : outer.request_id,
      payload: {
        api_version: API_VERSION,
        schema_version: ENVELOPE_SCHEMA,
        operation_id: request.operation_id,
        data: response,
      },
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
  const rawResponse = await socketTransport.roundTrip(encodeJsonFrame(JSON.stringify({
    api_version: API_VERSION,
    schema_version: ENVELOPE_SCHEMA,
    operation_id: "op_outer_frame",
    data: { command: "status" },
  }), 4096));
  assert(JSON.parse(decodeJsonFrame(rawResponse)).data !== undefined, "Unix socket adapter receives one framed response");
  assertExactKeys(socketOuterRequests[0], ["payload", "request_id"], "Unix transport emits the exact Rust outer request frame");
  assert(socketOuterRequests[0].request_id === "op_outer_frame", "Unix transport correlates outer request_id with operation_id");
  assert((socketOuterRequests[0].payload as Record<string, unknown>).operation_id === "op_outer_frame", "Unix transport preserves the application envelope as outer payload");
  let outerMismatch = false;
  try {
    await socketTransport.roundTrip(encodeJsonFrame(JSON.stringify({
      api_version: API_VERSION,
      schema_version: ENVELOPE_SCHEMA,
      operation_id: "op_outer_mismatch",
      data: { command: "status" },
    }), 4096));
  } catch { outerMismatch = true; }
  assert(outerMismatch, "Unix transport rejects a mismatched Rust response request_id");
  let rendered = "";
  await mountAndRender(parseTerminalArgs(["--socket", socketPath, "--project", "project_test"]), (value) => { rendered += value; });
  assert(rendered.includes("BOREAL / WORK DASHBOARD") && rendered.includes("socket-task: ready"), "entrypoint mounts and renders the controller");
  const dashboardArgs = parseTerminalArgs(["--socket", socketPath, "--project", "project_test", "--interactive"]);
  assert(dashboardArgs.interactive === true, "entrypoint parses explicit interactive mode");
  assert(dashboardArgs.actor.length > 0 && dashboardArgs.harness.startsWith("tui_") && dashboardArgs.session.startsWith("session_tui_"), "entrypoint creates one explicit mounted dashboard identity");
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
    const outer = JSON.parse(decodeJsonFrame(frame.slice(0, 4 + payloadLength))) as { request_id: string; payload: { operation_id: string } };
    const request = outer.payload;
    const response = monitoring(42, [item("reconnect-task", "ready")]);
    response.operation_id = request.operation_id;
    socket.write(encodeJsonFrame(JSON.stringify({
      request_id: outer.request_id,
      payload: {
        api_version: API_VERSION,
        schema_version: ENVELOPE_SCHEMA,
        operation_id: request.operation_id,
        data: response,
      },
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
    { project_id: "project_test", actor_id: "actor-luna", harness_id: "harness-test", session_id: "session-test" },
  ), { context: tuiContext });
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

class FakeFullScreenTerminal implements FullScreenTerminal {
  readonly is_tty = true;
  readonly writes: string[] = [];
  readonly rawModes: boolean[] = [];
  resumed = 0;
  paused = 0;
  private readonly dataListeners = new Set<(value: string) => void>();
  private readonly resizeListeners = new Set<() => void>();
  private readonly signalListeners = new Map<TerminalSignal, Set<() => void>>();

  dimensions(): { width: number; height: number } { return { width: 44, height: 18 }; }
  write(value: string): void { this.writes.push(value); }
  setRawMode(enabled: boolean): void { this.rawModes.push(enabled); }
  resume(): void { this.resumed += 1; }
  pause(): void { this.paused += 1; }
  onData(listener: (value: string) => void): () => void {
    this.dataListeners.add(listener);
    return () => { this.dataListeners.delete(listener); };
  }
  onResize(listener: () => void): () => void {
    this.resizeListeners.add(listener);
    return () => { this.resizeListeners.delete(listener); };
  }
  onSignal(signal: TerminalSignal, listener: () => void): () => void {
    const listeners = this.signalListeners.get(signal) ?? new Set<() => void>();
    listeners.add(listener);
    this.signalListeners.set(signal, listeners);
    return () => { listeners.delete(listener); };
  }
  emitData(value: string): void { for (const listener of [...this.dataListeners]) listener(value); }
  emitSignal(signal: TerminalSignal): void { for (const listener of [...(this.signalListeners.get(signal) ?? [])]) listener(); }
  listenerCount(): number {
    return this.dataListeners.size + this.resizeListeners.size
      + [...this.signalListeners.values()].reduce((total, listeners) => total + listeners.size, 0);
  }
}

assert(decodeKeys("\u001b[B\u001b[A\r\u0003").join(",") === "down,up,enter,ctrl-c", "full-screen keyboard decoder handles arrows, enter, and Ctrl-C");
let fullScreenItems = [item("keyboard-task", "ready", { title: "A deliberately long title for narrow terminal clipping" })];
const fullScreenCalls: Call[] = [];
const fullScreenService: VersionedServiceApi = {
  ...service,
  async readStatus() { return monitoring(80 + fullScreenCalls.length, fullScreenItems); },
  async claim(request) {
    fullScreenCalls.push({ name: "claim", request });
    fullScreenItems = fullScreenItems.map((entry) => ({
      ...entry,
      status: "claimed",
      display_status: "claimed",
      claimable: false,
      claimable_for_actor: false,
      attempt: { attempt_id: "attempt-keyboard", fence: 11, phase: "claimed" },
    }));
    const result = envelope(81, { work_id: "keyboard-task", attempt_id: "attempt-keyboard", fence: 11 }, "changed");
    result.operation_id = request.operation_id;
    return result;
  },
};
const fullScreenController = new MountedWorkflowController(fullScreenService, { context: tuiContext });
await fullScreenController.mount({ kind: "monitoring", project_id: "project_test" });
const fakeTerminal = new FakeFullScreenTerminal();
const fullScreenRun = runFullScreen(fullScreenController, fakeTerminal, { auto_refresh_ms: 60_000 });
fakeTerminal.emitData("\r");
fakeTerminal.emitData("c");
fakeTerminal.emitData("y");
await new Promise<void>((resolve) => setTimeout(resolve, 0));
fakeTerminal.emitData("q");
await fullScreenRun;
assert(fullScreenCalls.length === 1, "keyboard lifecycle action submits exactly once after confirmation");
const keyboardClaim = fullScreenCalls[0].request.data as Record<string, unknown>;
assert(keyboardClaim.actor_id === "actor-luna" && keyboardClaim.harness_id === "harness-test" && keyboardClaim.session_id === "session-test", "keyboard action retains mounted identity");
assert(fakeTerminal.rawModes.join(",") === "true,false" && fakeTerminal.resumed === 1 && fakeTerminal.paused === 1, "full-screen lifecycle restores raw input state");
assert(fakeTerminal.writes.some((value) => value.includes("\u001b[?1049h")) && fakeTerminal.writes.at(-1)?.includes("\u001b[?1049l"), "full-screen lifecycle enters and leaves alternate screen");
assert(fakeTerminal.writes.some((value) => value.includes("CONFIRM: claim keyboard-task")), "full-screen lifecycle renders confirmation before mutation");
assert(fakeTerminal.listenerCount() === 0, "full-screen lifecycle removes data, resize, and signal listeners");

const narrow = renderMountedView(fullScreenController.view(), { width: 36, height: 12, interactive: true });
assert(narrow.split("\n").every((line) => line.length <= 36), "narrow renderer clips every visible line to terminal width");
assert(narrow.split("\n").length <= 13, "narrow renderer bounds output by terminal height");

const signalTerminal = new FakeFullScreenTerminal();
const signalledRun = runFullScreen(fullScreenController, signalTerminal, { auto_refresh_ms: 60_000 });
signalTerminal.emitSignal("SIGTERM");
await signalledRun;
assert(signalTerminal.rawModes.join(",") === "true,false" && signalTerminal.listenerCount() === 0, "signal exit performs the same idempotent terminal cleanup");

let resolveDrainingClaim: ((result: Envelope<unknown>) => void) | undefined;
let drainingOperationId: string | null = null;
const drainingService: VersionedServiceApi = {
  ...fullScreenService,
  async readStatus() { return monitoring(90, [item("drain-task", "ready")]); },
  async claim(request) {
    drainingOperationId = request.operation_id;
    return new Promise<Envelope<unknown>>((resolve) => { resolveDrainingClaim = resolve; });
  },
};
const drainingController = new MountedWorkflowController(drainingService, { context: tuiContext });
await drainingController.mount({ kind: "monitoring", project_id: "project_test" });
const drainingTerminal = new FakeFullScreenTerminal();
const drainingRun = runFullScreen(drainingController, drainingTerminal, {
  auto_refresh_ms: 60_000,
  shutdown_drain_ms: 100,
});
drainingTerminal.emitData("\r");
drainingTerminal.emitData("c");
drainingTerminal.emitData("y");
await new Promise<void>((resolve) => setTimeout(resolve, 0));
assert(drainingOperationId !== null, "drain test starts the mutation before shutdown");
let drainingCompleted = false;
void drainingRun.then(() => { drainingCompleted = true; });
drainingTerminal.emitSignal("SIGTERM");
drainingTerminal.emitData("c");
await new Promise<void>((resolve) => setTimeout(resolve, 10));
assert(!drainingCompleted, "shutdown waits for an in-flight mutation instead of closing immediately");
const drainingResult = envelope(91, null, "unknown", {
  code: "unknown_outcome",
  message: "response lost after admission",
  operation_id: drainingOperationId!,
  operation_preserved: true,
  readback_required: true,
});
drainingResult.operation_id = drainingOperationId!;
resolveDrainingClaim?.(drainingResult);
await drainingRun;
assert(drainingTerminal.listenerCount() === 0 && drainingTerminal.rawModes.join(",") === "true,false", "completed mutation drains before terminal cleanup");
assert(drainingTerminal.writes.at(-1)?.includes(`operation ${drainingOperationId} retained with unknown outcome`) === true, "shutdown reports the client-preserved operation ID");

let timedOutOperationId: string | null = null;
const timedOutService: VersionedServiceApi = {
  ...fullScreenService,
  async readStatus() { return monitoring(100, [item("timeout-task", "ready")]); },
  async claim(request) {
    timedOutOperationId = request.operation_id;
    return new Promise<Envelope<unknown>>(() => { /* simulate a transport that never returns */ });
  },
};
const timedOutController = new MountedWorkflowController(timedOutService, { context: tuiContext });
await timedOutController.mount({ kind: "monitoring", project_id: "project_test" });
const timedOutTerminal = new FakeFullScreenTerminal();
const timedOutRun = runFullScreen(timedOutController, timedOutTerminal, {
  auto_refresh_ms: 60_000,
  shutdown_drain_ms: 15,
});
timedOutTerminal.emitData("\r");
timedOutTerminal.emitData("c");
timedOutTerminal.emitData("y");
await new Promise<void>((resolve) => setTimeout(resolve, 0));
timedOutTerminal.emitData("\u0003");
await timedOutRun;
assert(timedOutOperationId !== null, "timeout test starts a mutation with an operation ID");
assert(timedOutTerminal.writes.at(-1)?.includes("outcome unknown") === true, "shutdown reports an unknown mutation outcome after the drain deadline");
assert(timedOutTerminal.listenerCount() === 0 && timedOutTerminal.rawModes.join(",") === "true,false", "timed-out mutation still restores terminal state");

console.log("TUI mounted workflow, protocol/error, monitoring, disabled-action, and refresh tests passed");
