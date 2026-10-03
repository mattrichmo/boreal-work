#!/usr/bin/env node

/**
 * Production-composition evidence for the TUI-owned forensic gates.
 *
 * This fixture deliberately lives beside the TUI validation harness. It does
 * not open SQLite or use a fake service: every status, mutation, restart,
 * readback, and closeout crosses the real bwrk Unix-socket service boundary.
 * The only direct filesystem writes are the isolated fixture, gate policies,
 * and report files owned by this validation lane.
 */

import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import {
  API_VERSION,
  ENVELOPE_SCHEMA,
  MountedWorkflowController,
  VersionedServiceClient,
  buildMonitoringModel,
  validateEnvelope,
} from "../../../apps/tui/dist/client.js";
import { UnixSocketFramedTransport } from "../../../apps/tui/dist/node-transport.js";
import { runFullScreen } from "../../../apps/tui/dist/full-screen.js";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../../..");
const BIN = join(ROOT, "target/debug/bwrk");
const REPORT_DIR = join(ROOT, "scripts/validation/tui");
const REPORT_JSON = join(REPORT_DIR, "forensic-closeout.latest.json");
const REPORT_MD = join(REPORT_DIR, "forensic-closeout.latest.md");

const PROJECT = "forensic-tui-project";
const OPERATOR = "operator";
const ACTOR = "forensic-tui-agent";
const HARNESS = "forensic-tui-harness";
const SESSION = "session-forensic-tui";
let SOURCE_VERSION = "source-forensic-tui";
let PROJECT_ROOT = null;
let OPERATOR_CREDENTIAL = "";
let AGENT_CREDENTIAL = "";
const CONFIG_IDENTITY = "config-forensic-tui";

let operationSequence = 0;
const nextOperation = (label) => {
  operationSequence += 1;
  return `op_forensic_tui_${label}_${operationSequence}`;
};

function assertThat(condition, message) {
  if (!condition) throw new Error(message);
}

function stableValue(value) {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function operationDigest(command, payload) {
  const canonical = stableValue({
    command,
    payload,
    schema: "boreal.operation-request.v1",
  });
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

function environmentFingerprint() {
  return operationDigest("gate.environment/v1", {
    allowlist: [],
    present: [],
    missing: [],
  });
}

function requestEnvelope(operation_id, data, expected_revision = null, attempt_id = null, attempt_fence = null) {
  return {
    api_version: API_VERSION,
    schema_version: ENVELOPE_SCHEMA,
    operation_id,
    expected_revision,
    attempt_id,
    attempt_fence,
    data,
  };
}

function assertSuccess(label, envelope) {
  assertThat(envelope.transport === "ok", `${label}: transport=${envelope.transport}`);
  assertThat(["changed", "unchanged"].includes(envelope.outcome), `${label}: outcome=${envelope.outcome} error=${JSON.stringify(envelope.error)}`);
  return envelope.data;
}

function serviceClient(socket, actor, credential, project = PROJECT, session = SESSION) {
  const transport = new UnixSocketFramedTransport(socket, { timeout_ms: 10_000 });
  const client = new VersionedServiceClient(transport, {
    project_id: project,
    actor_id: actor,
    credential_ref: credential,
    harness_id: HARNESS,
    session_id: session,
  });
  return client;
}

function cli(args, environment = {}, cwd = ROOT) {
  const result = spawnSync(BIN, args, {
    cwd,
    env: { ...process.env, ...environment },
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  let json = null;
  for (const line of stdout.trim().split(/\r?\n/).reverse()) {
    if (!line.trim()) continue;
    try {
      json = JSON.parse(line);
      break;
    } catch {
      // The CLI may include a human diagnostic before its final JSON result.
    }
  }
  return { ...result, stdout, stderr, json };
}

async function waitForSocket(path, child, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) return;
    if (child.exitCode !== null) {
      throw new Error(`service exited before socket publication (${child.exitCode}): ${child.stderrText}`);
    }
    await delay(20);
  }
  throw new Error(`service socket did not appear: ${path}; stderr=${child.stderrText}`);
}

function startService(db, socket, projectRoot, failpoint = null) {
  const child = spawn(BIN, ["service", "run", "--db", db, "--socket", socket, "--json"], {
    cwd: projectRoot,
    env: failpoint ? { ...process.env, BOREAL_VALIDATION_FAILPOINT: failpoint } : { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderrText = "";
  child.stdoutText = "";
  child.stderr.on("data", (chunk) => { child.stderrText += chunk.toString(); });
  child.stdout.on("data", (chunk) => { child.stdoutText += chunk.toString(); });
  child.once("error", (error) => { child.stderrText += String(error); });
  return child;
}

async function waitForExit(child, timeoutMs = 8_000) {
  if (child.exitCode !== null) return child.exitCode;
  return new Promise((resolveExit, reject) => {
    const timer = setTimeout(() => reject(new Error(`service did not exit; stderr=${child.stderrText}`)), timeoutMs);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolveExit(code === null ? 128 : code);
    });
  });
}

async function stopService(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await waitForExit(child);
}

function removeSocket(socket) {
  try { rmSync(socket, { force: true }); } catch { /* isolated fixture cleanup */ }
}

function writeGatePolicies(gateRoot, source, config, verifierDigest) {
  mkdirSync(gateRoot, { recursive: true });
  const fingerprint = environmentFingerprint();
  const gates = [
    ["checkpoint", "checkpoint"],
    ["verification", "verification"],
    ["summary", "summary"],
  ];
  for (const [gate_id, kind] of gates) {
    writeFileSync(join(gateRoot, `${gate_id}.json`), `${JSON.stringify({
      gate_id,
      policy_revision: 1,
      kind,
      executable: "./verify.sh",
      verifier_digest: verifierDigest,
      argv: ["./verify.sh", `${gate_id}-forensic-pass`],
      cwd: ".",
      source_snapshot_hash: source,
      config_identity: config,
      environment_fingerprint: fingerprint,
      environment_allowlist: [],
      observables: [gate_id],
      max_runtime_ms: 10_000,
    }, null, 2)}\n`, "utf8");
  }
}

function projectCredential(root, actor) {
  const actorHash = createHash("sha256").update(actor).digest("hex");
  const path = join(root, ".boreal", "credentials", `sha256-${actorHash}.json`);
  const value = JSON.parse(readFileSync(path, "utf8")).credential;
  assertThat(typeof value === "string" && value.length > 0, `local credential for ${actor} is invalid`);
  return value;
}

async function createProjectAndHierarchy(client) {
  const initial = await client.readStatus({ project_id: PROJECT, limit: 1, offset: 0 });
  assertSuccess("initial project status", initial);
  let revision = initial.revision;
  const items = [
    ["matrix-milestone", "milestone", "Forensic milestone", null],
    ["matrix-sprint", "sprint", "Forensic sprint", "matrix-milestone"],
    ["matrix-task", "task", "Forensic task", "matrix-sprint"],
  ];
  for (const [work_id, kind, title, parent_id] of items) {
    const created = await client.createWork(requestEnvelope(nextOperation(`create_${work_id}`), {
      project_id: PROJECT,
      work_id,
      actor_id: OPERATOR,
      kind,
      title,
      parent_id,
      description: "Live DTO matrix fixture",
      priority: 10,
      dispatch_policy: "automatic",
      hard_holds: [],
      acceptance_profile: { id: "focused", version: "1" },
    }, revision));
    assertSuccess(`create ${work_id}`, created);
    revision = created.revision;
  }
  return revision;
}

async function claimAndStart(client, work_id, revision, source = SOURCE_VERSION, config = CONFIG_IDENTITY, session_id = `session-${work_id}`) {
  const now = Date.now();
  const attempt_id = `attempt-${work_id}`;
  const claim = await client.claim(requestEnvelope(nextOperation(`claim_${work_id}`), {
    project_id: PROJECT,
    work_id,
    actor_id: ACTOR,
    harness_id: HARNESS,
    session_id,
    attempt_id,
    claimed_at: new Date(now).toISOString(),
    lease_deadline: new Date(now + 30 * 60_000).toISOString(),
    hard_deadline: new Date(now + 2 * 60 * 60_000).toISOString(),
    source_version_id: source,
    config_identity: config,
  }, revision));
  const claimData = assertSuccess(`claim ${work_id}`, claim);
  const fence = claimData.fence;
  const start = await client.acceptStart(requestEnvelope(nextOperation(`start_${work_id}`), {
    project_id: PROJECT,
    work_id,
    attempt_id,
    fence,
    actor_id: ACTOR,
    harness_id: HARNESS,
    session_id,
  }, claim.revision, attempt_id, fence));
  assertSuccess(`start ${work_id}`, start);
  return { attempt_id, fence, revision: start.revision, session_id };
}

async function readStatusPages(client, label, project = PROJECT) {
  const pages = [];
  let offset = 0;
  let revision = null;
  let total = null;
  const limit = 100;
  for (let pageNumber = 0; pageNumber < 1_000; pageNumber += 1) {
    const envelope = await client.readStatus({
      project_id: project,
      limit,
      offset,
      ...(revision === null ? {} : { cursor_revision: revision }),
    });
    const pageLabel = pageNumber === 0 ? label : `${label}/offset-${offset}`;
    const data = assertSuccess(`${pageLabel} status`, envelope);
    assertThat(data && Array.isArray(data.items), `${pageLabel}: missing items`);
    const validated = validateEnvelope(envelope);
    const model = buildMonitoringModel(validated);
    assertThat(Number.isInteger(envelope.revision), `${pageLabel}: missing revision`);
    assertThat(data.offset === offset && data.limit === limit, `${pageLabel}: service returned the wrong status page`);
    if (revision === null) {
      revision = envelope.revision;
      total = data.total;
    } else {
      assertThat(envelope.revision === revision, `${pageLabel}: status revision changed during pagination`);
      assertThat(data.total === total, `${pageLabel}: status total changed during pagination`);
    }
    pages.push({ envelope, data, model, label: pageLabel });
    if (!data.has_more) return pages;
    assertThat(Number.isInteger(data.next_offset) && data.next_offset > offset,
      `${pageLabel}: bounded status page made no forward progress`);
    assertThat(data.next_offset === offset + data.returned_rows,
      `${pageLabel}: next_offset does not match the returned physical rows`);
    offset = data.next_offset;
  }
  throw new Error(`${label}: status pagination exceeded its safety bound`);
}

function checkStatusDtoMatrix(snapshots) {
  const observations = [];
  const seenStates = new Set();
  const seenKinds = new Set();
  const seenGates = new Set();
  for (const snapshot of snapshots) {
    const { envelope, data, model, label } = snapshot;
    assertThat(typeof envelope.as_of === "string" && envelope.as_of.length > 0, `${label}: missing envelope as_of`);
    assertThat(Number.isInteger(envelope.revision), `${label}: missing envelope revision`);
    assertThat(envelope.next_status_change_at === null || typeof envelope.next_status_change_at === "string", `${label}: invalid envelope deadline`);
    const recovery = envelope.recovery ?? data.recovery;
    assertThat(recovery && typeof recovery.readback_required === "boolean", `${label}: missing recovery.readback_required`);
    for (const item of data.items) {
      for (const field of ["work_id", "project_id", "kind", "lifecycle", "status", "display_status", "claimable", "claimable_for_actor", "reason_codes", "next_action", "next_status_change_at", "gates", "attempt"]) {
        assertThat(Object.prototype.hasOwnProperty.call(item, field), `${label}/${item.work_id}: missing DTO field ${field}`);
      }
      assertThat(item.gates && Array.isArray(item.gates.open) && Array.isArray(item.gates.satisfied), `${label}/${item.work_id}: malformed gate DTO`);
      seenStates.add(item.display_status ?? item.status);
      seenKinds.add(item.kind);
      for (const gate of [...item.gates.open, ...item.gates.satisfied]) {
        for (const field of ["gate_id", "kind", "required", "state", "receipt_id", "reason"]) {
          assertThat(Object.prototype.hasOwnProperty.call(gate, field), `${label}/${item.work_id}/${gate.gate_id}: missing gate field ${field}`);
        }
        seenGates.add(gate.gate_id.includes(":") ? gate.gate_id.split(":").at(-1) : gate.gate_id);
      }
      if (item.attempt) {
        for (const field of ["attempt_id", "fence", "phase", "actor_id", "harness_id", "session_id", "lease_deadline", "hard_deadline"]) {
          assertThat(Object.prototype.hasOwnProperty.call(item.attempt, field), `${label}/${item.work_id}: missing attempt field ${field}`);
        }
      }
      observations.push({
        label,
        work_id: item.work_id,
        kind: item.kind,
        parent_id: item.parent_id,
        state: item.display_status ?? item.status,
        gates_open: item.gates.open.map((gate) => gate.gate_id),
        gates_satisfied: item.gates.satisfied.map((gate) => gate.gate_id),
        has_attempt: Boolean(item.attempt),
        has_deadlines: Boolean(item.attempt?.lease_deadline && item.attempt?.hard_deadline),
        revision: envelope.revision,
        as_of: envelope.as_of,
        recovery_readback_required: recovery.readback_required,
      });
    }
    const modelItems = new Set(model.items.map((item) => item.work_id));
    assertThat(modelItems.size === data.items.length, `${label}: production TUI model dropped live items`);
  }
  assertThat(seenKinds.has("milestone") && seenKinds.has("sprint") && seenKinds.has("task"), `V04 kind matrix incomplete: ${[...seenKinds]}; items=${observations.map((item) => `${item.label}/${item.work_id}:${item.kind}`).join(",")}`);
  assertThat(seenStates.has("ready") && [...seenStates].some((state) => ["claimed", "in_progress"].includes(state)), `V04 state matrix incomplete: ${[...seenStates]}`);
  assertThat(["checkpoint", "verification", "summary"].every((gate) => seenGates.has(gate)), `V04 gate matrix incomplete: ${[...seenGates]}`);
  const initialTask = observations.find((item) => item.label.startsWith("initial") && item.work_id === "matrix-task");
  assertThat(initialTask?.parent_id === "matrix-sprint", "V04 task parent DTO is not preserved");
  assertThat(observations.find((item) => item.label.startsWith("initial") && item.work_id === "matrix-sprint")?.parent_id === "matrix-milestone", "V04 sprint parent DTO is not preserved");
  assertThat(observations.some((item) => item.has_deadlines), "V04 timestamp/deadline DTO is not observed");
  return { seen_states: [...seenStates].sort(), seen_kinds: [...seenKinds].sort(), seen_gates: [...seenGates].sort(), observations };
}

async function runEvidence(client, socket, work_id, gate_id, context, operation_id, environment = {}) {
  const result = cli([
    "evidence", "run",
    "--project", PROJECT,
    "--work", work_id,
    "--gate", gate_id,
    "--attempt", context.attempt_id,
    "--fence", String(context.fence),
    "--socket", socket,
    "--actor", ACTOR,
    "--harness", HARNESS,
    "--session", context.session_id,
    "--operation-id", operation_id,
    "--json",
  ], environment, PROJECT_ROOT ?? ROOT);
  return result;
}

async function readOperation(client, operation_id) {
  const envelope = await client.readOperation(PROJECT, operation_id);
  assertThat(envelope.data && typeof envelope.data === "object", `operation ${operation_id}: missing readback data`);
  return envelope;
}

async function resolveSubmittedResourceRelease(operatorClient, socket, context) {
  const recovery = await operatorClient.readWorkspaceView("recovery", PROJECT);
  const data = assertSuccess("post-submit recovery list", recovery);
  const obligation = data.items.find((item) => item.work_id === context.work_id
    && item.attempt_id === context.attempt_id
    && item.reason === "resource_unknown"
    && item.resource_state === "release_pending");
  assertThat(obligation, "operator recovery list omitted the submitted closeout resource obligation");
  assertThat(Number.isInteger(recovery.revision), "operator recovery list omitted its project revision");

  const inputPath = join(PROJECT_ROOT, ".boreal", "closeout-resource-release.json");
  writeFileSync(inputPath, `${JSON.stringify({
    resolution_id: nextOperation("closeout_resource_release_decision"),
    outcome: "runtime_stopped",
    reason: "Operator confirmed this isolated fixture has no external attempt resource to retain.",
    resource_state: "released",
  }, null, 2)}\n`, "utf8");
  const resolution = cli([
    "recovery", "resolve", obligation.obligation_id,
    "--project", PROJECT,
    "--input", ".boreal/closeout-resource-release.json",
    "--expected-revision", String(recovery.revision),
    "--yes",
    "--socket", socket,
    "--actor", OPERATOR,
    "--harness", HARNESS,
    "--session", "session-forensic-tui-operator",
    "--operation-id", nextOperation("resolve_closeout_resource_release"),
    "--json",
  ], {}, PROJECT_ROOT);
  assertThat(resolution.status === 0 && resolution.json?.outcome === "changed",
    `operator recovery resolution failed: ${resolution.stdout}${resolution.stderr}`);
  assertThat(resolution.json?.data?.obligation?.state === "resolved"
    && resolution.json?.data?.obligation?.resource_state === "released",
  `operator recovery resolution did not acknowledge the resource release: ${resolution.stdout}`);

  const readback = await operatorClient.readWorkspaceView("recovery", PROJECT);
  const readbackData = assertSuccess("operator recovery resolution readback", readback);
  assertThat(!readbackData.items.some((item) => item.obligation_id === obligation.obligation_id),
    "resolved closeout resource obligation remained in the unresolved recovery list");
  return {
    obligation_id: obligation.obligation_id,
    operation_id: resolution.json.data.operation_id,
    outcome: resolution.json.outcome,
    resource_state: resolution.json.data.obligation.resource_state,
    readback_revision: readback.revision,
  };
}

class CapturedTty {
  is_tty = true;
  writes = [];
  listeners = new Set();
  signalListeners = new Map();
  dimensions() { return { width: 120, height: 40 }; }
  write(value) { this.writes.push(value); }
  setRawMode() {}
  resume() {}
  pause() {}
  onData(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  onResize() { return () => {}; }
  onSignal(signal, listener) {
    const entries = this.signalListeners.get(signal) ?? new Set();
    entries.add(listener);
    this.signalListeners.set(signal, entries);
    return () => entries.delete(listener);
  }
  emit(value) { for (const listener of [...this.listeners]) listener(value); }
}

async function runFullScreenCloseout(serviceChild, socket, operatorClient, context, verificationOperation) {
  const closeoutClient = serviceClient(socket, ACTOR, AGENT_CREDENTIAL, PROJECT, context.session_id);
  const realReadReceipt = async (project_id, work_id, attempt_id, fence) => {
    const operation = await closeoutClient.readOperation(project_id, verificationOperation);
    const rawReceipt = operation.data?.receipt ?? operation.data?.execution?.receipt;
    assertThat(rawReceipt && rawReceipt.subject?.work_id === work_id
      && rawReceipt.subject?.attempt_id === attempt_id && rawReceipt.subject?.fence === fence,
    "durable verification receipt readback is not bound to the requested attempt");
    return {
      ...operation,
      data: { project_id, work_id, attempt_id, fence, receipt: rawReceipt, receipt_id: rawReceipt.receipt_id },
    };
  };
  let finishRequest = null;
  let finishResponse = null;
  let finishDispatchError = null;
  let finishCompleted = false;
  let resourceRecovery = null;
  const service = {
    readStatus: closeoutClient.readStatus.bind(closeoutClient),
    readOperation: closeoutClient.readOperation.bind(closeoutClient),
    readReceipt: realReadReceipt,
    finish: async (request) => {
      finishRequest = request;
      try {
        let response = await closeoutClient.finish(request);
        if (response.error?.code === "claim_conflict"
          && response.error.message.includes("action_denied:status_denied")) {
          resourceRecovery = await resolveSubmittedResourceRelease(operatorClient, socket, {
            work_id: "closeout-task",
            attempt_id: context.attempt_id,
          });
          // Retry this exact finish operation only after the separately
          // authenticated operator has confirmed the fixture resource release.
          response = await closeoutClient.finish(request);
        }
        finishResponse = response;
        if (!["changed", "unchanged"].includes(response.outcome)) return response;
        // Deliberately make the following controller refresh fail after the
        // service has durably committed the mutation.
        await stopService(serviceChild);
        return response;
      } catch (error) {
        finishDispatchError = error instanceof Error ? error.message : String(error);
        throw error;
      } finally {
        finishCompleted = true;
      }
    },
  };
  const controller = new MountedWorkflowController(service, {
    context: { project_id: PROJECT, actor_id: ACTOR, harness_id: HARNESS, session_id: context.session_id },
  });
  await controller.mount({ kind: "work", project_id: PROJECT, work_id: "closeout-task" });
  assertThat(controller.view().selected_receipt_available === true, "full-screen closeout did not rehydrate the durable receipt");
  const terminal = new CapturedTty();
  const run = runFullScreen(controller, terminal, { auto_refresh_ms: 60_000 });
  terminal.emit("f");
  terminal.emit("typed forensic closeout summary");
  terminal.emit("\r");
  terminal.emit("y");
  for (let index = 0; index < 100 && !finishCompleted; index += 1) await delay(20);
  if (!finishRequest) {
    const view = controller.view();
    const diagnostic = {
      selected_work: view.selected_work && {
        work_id: view.selected_work.work_id,
        status: view.selected_work.status,
        attempt_session_id: view.selected_work.attempt?.session_id,
      },
      finish_action: view.actions.find((action) => action.action === "finish"),
      notice: view.notice,
      pending_operations: view.pending_operations,
      terminal_tail: terminal.writes.join("").slice(-500),
    };
    terminal.emit("\x1b");
    await delay(50);
    terminal.emit("q");
    await run;
    controller.unmount();
    await closeoutClient.close();
    throw new Error(`full-screen closeout did not dispatch finish: ${JSON.stringify(diagnostic)}`);
  }
  if (!["changed", "unchanged"].includes(finishResponse?.outcome)) {
    const view = controller.view();
    throw new Error(`full-screen finish rejected: ${JSON.stringify({
      response: finishResponse,
      dispatch_error: finishDispatchError,
      notice: view.notice?.message,
      selected_work: view.selected_work && {
        work_id: view.selected_work.work_id,
        status: view.selected_work.status,
        attempt: view.selected_work.attempt,
        gates: view.selected_work.gates,
      },
      finish_action: view.actions.find((action) => action.action === "finish"),
      finish_session_id: finishRequest.data.session_id,
    })}`);
  }
  for (let index = 0; index < 100 && !controller.view().notice; index += 1) await delay(20);
  assertThat(controller.view().notice?.message.includes("mutation committed") === true, `V07 did not preserve committed mutation: ${JSON.stringify(controller.view().notice)}`);
  assertThat(controller.view().notice?.message.includes("refresh unavailable") === true, `V07 did not expose refresh failure: ${JSON.stringify(controller.view().notice)}`);
  terminal.emit("q");
  await run;
  controller.unmount();
  assertThat(finishRequest.data.summary === "typed forensic closeout summary", "typed summary was not sent through the full-screen path");
  assertThat(finishRequest.data.receipt?.subject?.work_id === "closeout-task", "full-screen finish did not send the durable typed receipt");
  assertThat(finishRequest.data.receipt?.subject?.gate_id === "verification", "full-screen finish changed the service receipt gate id");
  assertThat(finishRequest.data.receipt?.coverage?.kind === "verification", "full-screen finish changed the service receipt coverage kind");
  await closeoutClient.close();
  return {
    finish_operation_id: finishRequest.operation_id,
    notice: controller.view().notice?.message,
    terminal_output_bytes: terminal.writes.join("").length,
    receipt_dto_coverage_kind: finishRequest.data.receipt?.coverage?.kind,
    resource_recovery: resourceRecovery,
  };
}

async function main() {
  if (process.platform !== "darwin" && process.platform !== "linux") {
    console.log("BOREAL_VALIDATION_SKIP: live Unix-socket TUI validation requires POSIX");
    return 0;
  }
  assertThat(existsSync(BIN), `missing current bwrk binary: ${BIN}`);
  const fixture = mkdtempSync(join(tmpdir(), "boreal-forensic-tui-"));
  PROJECT_ROOT = fixture;
  const db = join(fixture, ".boreal", "boreal.sqlite");
  const socket = join(fixture, "service.sock");
  const gateRoot = join(fixture, ".boreal", "gates");
  const sourceFixture = join(fixture, "workspace-fixture");
  mkdirSync(sourceFixture, { recursive: true });
  writeFileSync(join(sourceFixture, "README.md"), "# Boreal forensic TUI source\n\nThis immutable fixture binds live evidence receipts.\n", "utf8");
  const verifierPath = join(sourceFixture, "verify.sh");
  writeFileSync(verifierPath, "#!/bin/sh\nprintf '%s\\n' \"$1\"\n", { encoding: "utf8", mode: 0o755 });
  chmodSync(verifierPath, 0o755);
  let service = null;
  let client = null;
  let operatorClient = null;
  const evidence = { fixture, v04: null, v06: null, v07: null };
  try {
    // The source adapter is intentionally direct-only in the current public
    // registry. Seed its immutable source before the service host is elected;
    // all lifecycle, status, evidence, restart, and closeout assertions still
    // cross the live service boundary below.
    const init = cli(["init", "--project", PROJECT, "--project-root", fixture, "--db", db, "--actor", OPERATOR, "--actor-role", "operator", "--yes", "--json"], {}, fixture);
    assertThat(init.status === 0 && init.json?.outcome === "changed", `fixture init failed: ${init.stdout}${init.stderr}`);
    OPERATOR_CREDENTIAL = projectCredential(fixture, OPERATOR);
    const operatorSession = cli([
      "session", "start", "--project", PROJECT, "--session", "session-forensic-tui-operator",
      "--harness", HARNESS, "--actor", OPERATOR, "--expected-revision", String(init.json.revision),
      "--db", db, "--operation-id", "op_forensic_tui_operator_session", "--json",
    ], {}, fixture);
    assertThat(operatorSession.status === 0 && operatorSession.json?.outcome === "changed", `operator session setup failed: ${operatorSession.stdout}${operatorSession.stderr}`);
    const enrollment = cli(["auth", "key", "--actor", ACTOR, "--actor-role", "agent", "--db", db, "--json"], {}, fixture);
    const enrollmentPath = enrollment.json?.data?.enrollment_path;
    assertThat(enrollment.status === 0 && typeof enrollmentPath === "string", `Agent enrollment failed: ${enrollment.stdout}${enrollment.stderr}`);
    const grant = cli([
      "auth", "grant", "--actor", OPERATOR, "--input", enrollmentPath,
      "--expected-revision", String(operatorSession.json.revision), "--reason", "isolated forensic TUI fixture", "--yes",
      "--db", db, "--operation-id", "op_forensic_tui_agent_grant", "--json",
    ], {}, fixture);
    assertThat(grant.status === 0 && grant.json?.outcome === "changed", `Agent grant failed: ${grant.stdout}${grant.stderr}`);
    AGENT_CREDENTIAL = projectCredential(fixture, ACTOR);
    const source = cli(["source", "add", PROJECT, "--input", sourceFixture, "--origin", "forensic-tui", "--db", db, "--actor", OPERATOR, "--harness", HARNESS, "--session", "session-forensic-tui-operator", "--expected-revision", String(grant.json.revision), "--operation-id", "op_forensic_tui_source", "--json"], {}, fixture);
    assertThat(source.status === 0 && source.json?.outcome === "changed", `fixture source add failed: ${source.stdout}${source.stderr}`);
    SOURCE_VERSION = source.json?.data?.source?.source_version_id ?? SOURCE_VERSION;
    assertThat(SOURCE_VERSION.startsWith("sv_"), `fixture source add did not return a source version: ${source.stdout}`);
    writeGatePolicies(gateRoot, SOURCE_VERSION, CONFIG_IDENTITY, `sha256:${createHash("sha256").update(readFileSync(verifierPath)).digest("hex")}`);
    let policyRevision = source.json.revision;
    for (const gate_id of ["checkpoint", "verification", "summary"]) {
      const publish = cli([
        "gate", "policy", "publish", "--project", PROJECT, "--gate", gate_id,
        "--input", `.boreal/gates/${gate_id}.json`, "--expected-revision", String(policyRevision), "--yes",
        "--actor", OPERATOR, "--harness", HARNESS, "--session", "session-forensic-tui-operator",
        "--db", db, "--operation-id", nextOperation(`publish_${gate_id}`), "--json",
      ], {}, fixture);
      assertThat(publish.status === 0 && publish.json?.outcome === "changed", `gate policy ${gate_id} publish failed: ${publish.stdout}${publish.stderr}`);
      policyRevision = publish.json.revision;
    }
    service = startService(db, socket, fixture);
    await waitForSocket(socket, service);
    operatorClient = serviceClient(socket, OPERATOR, OPERATOR_CREDENTIAL, PROJECT, "session-forensic-tui-operator");
    client = serviceClient(socket, ACTOR, AGENT_CREDENTIAL, PROJECT, SESSION);
    let revision = await createProjectAndHierarchy(operatorClient);

    const initialPages = await readStatusPages(client, "initial status");
    const initial = initialPages[0];
    const context = await claimAndStart(client, "matrix-task", initial.envelope.revision);
    const claimedPages = await readStatusPages(client, "running status");
    const claimed = claimedPages[0];
    revision = claimed.envelope.revision;
    const v04 = checkStatusDtoMatrix([...initialPages, ...claimedPages]);
    evidence.v04 = { status: "pass", ...v04 };

    // Three independent live-service crash points prove that the execution
    // journal survives admission, start, and post-exit response loss. Each
    // point is restarted and read back before the next task is touched.
    const faultCases = [
      ["after_evidence_admission", "fault-admission"],
      ["after_evidence_start", "fault-start"],
      ["after_evidence_exit", "fault-exit"],
    ];
    const faultReadbacks = [];
    for (const [failpoint, work_id] of faultCases) {
      const created = await operatorClient.createWork(requestEnvelope(nextOperation(`create_${work_id}`), {
        project_id: PROJECT, work_id, actor_id: OPERATOR, kind: "task", title: failpoint,
        parent_id: "matrix-sprint", description: "fault boundary", priority: 10,
        dispatch_policy: "automatic", hard_holds: [], acceptance_profile: { id: "focused", version: "1" },
      }, revision));
      revision = assertSuccess(`create ${work_id}`, created) && created.revision;
      const faultContext = await claimAndStart(client, work_id, revision);
      revision = faultContext.revision;
      const operation_id = nextOperation(`fault_${failpoint}`);
      await client.close();
      client = null;
      await stopService(service);
      service = startService(db, socket, fixture, failpoint);
      await waitForSocket(socket, service);
      client = serviceClient(socket, ACTOR, AGENT_CREDENTIAL, PROJECT, SESSION);
      const fault = await runEvidence(client, socket, work_id, "verification", faultContext, operation_id, { BOREAL_VALIDATION_FAILPOINT: failpoint });
      const crashed = await waitForExit(service);
      assertThat(crashed !== 0, `${failpoint}: service did not fault at the requested boundary`);
      service = null;
      removeSocket(socket);
      service = startService(db, socket, fixture);
      await waitForSocket(socket, service);
      client = serviceClient(socket, ACTOR, AGENT_CREDENTIAL, PROJECT, SESSION);
      const readback = await readOperation(client, operation_id);
      assertThat(readback.outcome === "unknown", `${failpoint}: readback outcome=${readback.outcome}`);
      assertThat(readback.data.readback_required === true, `${failpoint}: readback_required was not true`);
      const recoveredStatus = await client.readStatus({ project_id: PROJECT, limit: 1, offset: 0 });
      assertSuccess(`${failpoint}: recovered status`, recoveredStatus);
      assertThat(Number.isInteger(recoveredStatus.revision), `${failpoint}: recovered status omitted the current project revision`);
      revision = recoveredStatus.revision;
      const state = readback.data.execution?.state ?? null;
      assertThat(["admitted", "running", "exited", "unknown"].includes(state), `${failpoint}: invalid execution state ${state}`);
      faultReadbacks.push({ failpoint, work_id, operation_id, client_exit: fault.status, readback_outcome: readback.outcome, execution_state: state });
    }

    // Real successful evidence for all focused gates, followed by a mounted
    // full-screen closeout using durable receipt readback.
    const closeWork = await operatorClient.createWork(requestEnvelope(nextOperation("create_closeout"), {
      project_id: PROJECT, work_id: "closeout-task", actor_id: OPERATOR, kind: "task", title: "Closeout task",
      parent_id: "matrix-sprint", description: "typed closeout", priority: 10,
      dispatch_policy: "automatic", hard_holds: [], acceptance_profile: { id: "focused", version: "1" },
    }, revision));
    revision = assertSuccess("create closeout-task", closeWork) && closeWork.revision;
    const closeContext = await claimAndStart(client, "closeout-task", revision);
    const gateOperations = [];
    for (const gate_id of ["checkpoint", "verification", "summary"]) {
      const operation_id = nextOperation(`close_${gate_id}`);
      const result = await runEvidence(client, socket, "closeout-task", gate_id, closeContext, operation_id);
      assertThat(result.status === 0 && result.json?.outcome === "changed", `successful ${gate_id} evidence failed: ${result.stdout}${result.stderr}`);
      gateOperations.push({ gate_id, operation_id });
    }
    const afterEvidencePages = await readStatusPages(client, "after evidence");
    const closeItem = afterEvidencePages.flatMap((page) => page.data.items).find((item) => item.work_id === "closeout-task");
    assertThat(closeItem && closeItem.gates.satisfied.length === 3, `closeout-task did not expose all satisfied gates: ${JSON.stringify(closeItem?.gates)}`);
    const verificationOperation = gateOperations.find((entry) => entry.gate_id === "verification").operation_id;
    const fullScreenEvidence = await runFullScreenCloseout(service, socket, operatorClient, {
      ...closeContext,
      work_id: "closeout-task",
    }, verificationOperation);
    service = null;
    client = null;

    // V06/V07 must survive the stop-after-commit refresh failure and be
    // visible to a fresh production client after restart.
    service = startService(db, socket, fixture);
    await waitForSocket(socket, service);
    client = serviceClient(socket, ACTOR, AGENT_CREDENTIAL, PROJECT, SESSION);
    const finalPages = await readStatusPages(client, "post-closeout status");
    const closed = finalPages.flatMap((page) => page.data.items).find((item) => item.work_id === "closeout-task");
    assertThat(closed && ["complete", "closed"].includes(closed.status), `post-closeout status is not terminal: ${JSON.stringify(closed)}`);
    const finishReadback = await readOperation(client, `${fullScreenEvidence.finish_operation_id}:result`);
    const closeResult = finishReadback.data.operation?.result?.close;
    assertThat(closeResult?.summary_id,
      `finish result operation did not retain typed summary identity: ${JSON.stringify(finishReadback.data)}`);
    assertThat(closeResult?.close_state,
      `finish result operation did not retain typed close state: ${JSON.stringify(finishReadback.data)}`);
    evidence.v06 = { status: "pass", fault_boundaries: faultReadbacks, full_screen: fullScreenEvidence, finish_readback: finishReadback.data };
    evidence.v07 = { status: "pass", committed_status: closed.status, refresh_notice: fullScreenEvidence.notice, finish_operation_id: fullScreenEvidence.finish_operation_id };

    const result = {
      schema: "boreal.validation.tui-forensic-closeout.v1",
      generated_at: new Date().toISOString(),
      status: "pass",
      gates: { V04: evidence.v04, V06: evidence.v06, V07: evidence.v07 },
      fixture: { service: "real bwrk Unix socket", database: "isolated temporary SQLite fixture", product_client: "apps/tui/dist/client.js", full_screen: "apps/tui/dist/full-screen.js" },
      limitations: [],
    };
    mkdirSync(REPORT_DIR, { recursive: true });
    writeFileSync(REPORT_JSON, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    writeFileSync(REPORT_MD, markdown(result), "utf8");
    console.log(JSON.stringify({ status: result.status, gates: { V04: "pass", V06: "pass", V07: "pass" }, report: REPORT_MD, json: REPORT_JSON }));
    return 0;
  } catch (error) {
    const failure = {
      schema: "boreal.validation.tui-forensic-closeout.v1",
      generated_at: new Date().toISOString(),
      status: "fail",
      gates: evidence,
      error: String(error?.stack ?? error),
      fixture: { service: "real bwrk Unix socket", database: "isolated temporary SQLite fixture" },
    };
    mkdirSync(REPORT_DIR, { recursive: true });
    writeFileSync(REPORT_JSON, `${JSON.stringify(failure, null, 2)}\n`, "utf8");
    writeFileSync(REPORT_MD, markdown(failure), "utf8");
    console.error(JSON.stringify({ status: "fail", report: REPORT_MD, error: failure.error }));
    return 1;
  } finally {
    try { await client?.close?.(); } catch { /* cleanup */ }
    try { await operatorClient?.close?.(); } catch { /* cleanup */ }
    try { await stopService(service); } catch { /* preserve report failure */ }
    removeSocket(socket);
    rmSync(fixture, { recursive: true, force: true });
  }
}

function markdown(result) {
  const gate = (id) => result.gates?.[id];
  const lines = [
    "# TUI forensic closeout evidence",
    "",
    `Overall: **${result.status}**`,
    "",
    "This report is produced by a real `bwrk service run` Unix-socket fixture and the compiled TypeScript TUI client/full-screen controller.",
    "",
    "| Gate | Result | Evidence |",
    "| --- | --- | --- |",
    `| V04 | **${gate("V04")?.status ?? "not-run"}** | ${gate("V04") ? `${gate("V04").seen_kinds?.length ?? 0} kinds, ${gate("V04").seen_states?.length ?? 0} observed states, ${gate("V04").seen_gates?.length ?? 0} gates` : "not run"} |`,
    `| V06 | **${gate("V06")?.status ?? "not-run"}** | ${gate("V06") ? `${gate("V06").fault_boundaries?.length ?? 0} live crash boundaries; restarted readback; typed summary closeout` : "not run"} |`,
    `| V07 | **${gate("V07")?.status ?? "not-run"}** | ${gate("V07") ? `committed ${gate("V07").committed_status}; refresh notice preserved` : "not run"} |`,
    "",
  ];
  if (result.error) lines.push("## Failure", "", "```text", result.error, "```", "");
  return lines.join("\n");
}

main().then((code) => process.exitCode = code).catch((error) => {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
});
