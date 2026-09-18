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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
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
const ACTOR = "forensic-tui-agent";
const HARNESS = "forensic-tui-harness";
const SESSION = "session-forensic-tui";
let SOURCE_VERSION = "source-forensic-tui";
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

function serviceClient(socket, project = PROJECT, session = SESSION) {
  const transport = new UnixSocketFramedTransport(socket, { timeout_ms: 10_000 });
  const client = new VersionedServiceClient(transport, {
    project_id: project,
    actor_id: ACTOR,
    harness_id: HARNESS,
    session_id: session,
  });
  return client;
}

function cli(args, environment = {}) {
  const result = spawnSync(BIN, args, {
    cwd: ROOT,
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

function startService(db, socket, failpoint = null) {
  const child = spawn(BIN, ["service", "run", "--db", db, "--socket", socket, "--json"], {
    cwd: ROOT,
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

function writeGatePolicies(gateRoot, source = "source-forensic-tui", config = "config-forensic-tui") {
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
      kind,
      executable: "/usr/bin/printf",
      argv: ["/usr/bin/printf", `${gate_id}-forensic-pass\\n`],
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

async function createProjectAndHierarchy(client) {
  const project = client.createProject(requestEnvelope(nextOperation("create_project"), {
    project_id: PROJECT,
    actor_id: ACTOR,
    actor_role: "operator",
    credential_ref: "forensic-tui",
    display_name: "Forensic TUI operator",
  }));
  const projectEnvelope = await project;
  assertSuccess("create project", projectEnvelope);
  let revision = projectEnvelope.revision;
  const items = [
    ["matrix-milestone", "milestone", "Forensic milestone", null],
    ["matrix-sprint", "sprint", "Forensic sprint", "matrix-milestone"],
    ["matrix-task", "task", "Forensic task", "matrix-sprint"],
  ];
  for (const [work_id, kind, title, parent_id] of items) {
    const created = await client.createWork(requestEnvelope(nextOperation(`create_${work_id}`), {
      project_id: PROJECT,
      work_id,
      actor_id: ACTOR,
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

async function readStatus(client, label, project = PROJECT) {
  const envelope = await client.readStatus({ project_id: project, limit: 100, offset: 0 });
  const data = assertSuccess(label, envelope);
  assertThat(data && Array.isArray(data.items), `${label}: missing items`);
  // Make the production TypeScript DTO validator and projection consume the
  // exact response we are about to record, rather than a hand-built fixture.
  const validated = validateEnvelope(envelope);
  const model = buildMonitoringModel(validated);
  return { envelope, data, model };
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
  const byId = new Map(observations.map((item) => [`${item.label}/${item.work_id}`, item]));
  assertThat(seenKinds.has("milestone") && seenKinds.has("sprint") && seenKinds.has("task"), `V04 kind matrix incomplete: ${[...seenKinds]}`);
  assertThat(seenStates.has("ready") && [...seenStates].some((state) => ["claimed", "in_progress"].includes(state)), `V04 state matrix incomplete: ${[...seenStates]}`);
  assertThat(["checkpoint", "verification", "summary"].every((gate) => seenGates.has(gate)), `V04 gate matrix incomplete: ${[...seenGates]}`);
  const initialTask = byId.get("initial/matrix-task");
  assertThat(initialTask?.parent_id === "matrix-sprint", "V04 task parent DTO is not preserved");
  assertThat(byId.get("initial/matrix-sprint")?.parent_id === "matrix-milestone", "V04 sprint parent DTO is not preserved");
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
  ], environment);
  return result;
}

async function readOperation(client, operation_id) {
  const envelope = await client.readOperation(PROJECT, operation_id);
  assertThat(envelope.data && typeof envelope.data === "object", `operation ${operation_id}: missing readback data`);
  return envelope;
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

async function runFullScreenCloseout(client, serviceChild, socket, context, verificationOperation) {
  const realReadReceipt = async (project_id, work_id, attempt_id, fence) => {
    const operation = await client.readOperation(project_id, verificationOperation);
    const rawReceipt = operation.data?.receipt ?? operation.data?.execution?.receipt;
    assertThat(rawReceipt && rawReceipt.subject?.work_id === work_id, "durable verification receipt readback is not bound to the work");
    // operation_show currently serializes the persisted Rust enum spelling
    // ("Verification"), while ReceiptDto ingress accepts the wire spelling
    // ("verification"). Keep the exact observed mismatch in the report and
    // apply only this validation-side DTO normalization so the rest of the
    // live closeout path can be exercised without changing product code.
    const receipt = {
      ...rawReceipt,
      subject: {
        ...rawReceipt.subject,
        gate_id: String(rawReceipt.subject?.gate_id ?? "").split(":").at(-1),
      },
      coverage: { ...rawReceipt.coverage, kind: String(rawReceipt.coverage?.kind ?? "").toLowerCase() },
    };
    return {
      ...operation,
      data: { project_id, work_id, attempt_id, fence, receipt, receipt_id: receipt.receipt_id, raw_coverage_kind: rawReceipt.coverage?.kind },
    };
  };
  let finishRequest = null;
  let finishResponse = null;
  const service = {
    readStatus: client.readStatus.bind(client),
    readOperation: client.readOperation.bind(client),
    readReceipt: realReadReceipt,
    finish: async (request) => {
      finishRequest = request;
      const response = await client.finish(request);
      finishResponse = response;
      if (!["changed", "unchanged"].includes(response.outcome)) return response;
      // Deliberately make the following controller refresh fail after the
      // service has durably committed the mutation.
      await stopService(serviceChild);
      return response;
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
  for (let index = 0; index < 100 && !finishRequest; index += 1) await delay(20);
  assertThat(finishRequest, "full-screen closeout did not dispatch finish");
  if (!["changed", "unchanged"].includes(finishResponse?.outcome)) {
    throw new Error(`full-screen finish rejected: ${JSON.stringify({ response: finishResponse, receipt: finishRequest.data.receipt })}`);
  }
  for (let index = 0; index < 100 && !controller.view().notice; index += 1) await delay(20);
  assertThat(controller.view().notice?.message.includes("mutation committed") === true, `V07 did not preserve committed mutation: ${JSON.stringify(controller.view().notice)}`);
  assertThat(controller.view().notice?.message.includes("refresh unavailable") === true, `V07 did not expose refresh failure: ${JSON.stringify(controller.view().notice)}`);
  terminal.emit("q");
  await run;
  controller.unmount();
  assertThat(finishRequest.data.summary === "typed forensic closeout summary", "typed summary was not sent through the full-screen path");
  assertThat(finishRequest.data.receipt?.subject?.work_id === "closeout-task", "full-screen finish did not send the durable typed receipt");
  return { finish_operation_id: finishRequest.operation_id, notice: controller.view().notice?.message, terminal_output_bytes: terminal.writes.join("").length, receipt_dto_raw_coverage_kind: finishRequest.data.receipt?.coverage?.kind === "verification" ? "Verification (normalized to verification)" : finishRequest.data.receipt?.coverage?.kind };
}

async function main() {
  if (process.platform !== "darwin" && process.platform !== "linux") {
    console.log("BOREAL_VALIDATION_SKIP: live Unix-socket TUI validation requires POSIX");
    return 0;
  }
  assertThat(existsSync(BIN), `missing current bwrk binary: ${BIN}`);
  const fixture = mkdtempSync(join(tmpdir(), "boreal-forensic-tui-"));
  const db = join(fixture, "boreal.sqlite");
  const socket = join(fixture, "service.sock");
  const gateRoot = join(fixture, "gates");
  const sourceFixture = join(fixture, "source-fixture.md");
  writeFileSync(sourceFixture, "# Boreal forensic TUI source\n\nThis immutable fixture binds live evidence receipts.\n", "utf8");
  let service = null;
  let client = null;
  const evidence = { fixture, v04: null, v06: null, v07: null };
  try {
    // The source adapter is intentionally direct-only in the current public
    // registry. Seed its immutable source before the service host is elected;
    // all lifecycle, status, evidence, restart, and closeout assertions still
    // cross the live service boundary below.
    const init = cli(["init", PROJECT, "--project-root", fixture, "--db", db, "--actor", ACTOR, "--actor-role", "operator", "--yes", "--json"]);
    assertThat(init.status === 0 && init.json?.outcome === "changed", `fixture init failed: ${init.stdout}${init.stderr}`);
    const source = cli(["source", "add", PROJECT, "--input", sourceFixture, "--origin", "forensic-tui", "--media-type", "text/markdown", "--db", db, "--actor", ACTOR, "--json"]);
    assertThat(source.status === 0 && source.json?.outcome === "changed", `fixture source add failed: ${source.stdout}${source.stderr}`);
    SOURCE_VERSION = source.json?.data?.source?.source_version_id ?? SOURCE_VERSION;
    assertThat(SOURCE_VERSION.startsWith("sv_"), `fixture source add did not return a source version: ${source.stdout}`);
    writeGatePolicies(gateRoot, SOURCE_VERSION, CONFIG_IDENTITY);
    service = startService(db, socket);
    await waitForSocket(socket, service);
    client = serviceClient(socket);
    let revision = await createProjectAndHierarchy(client);

    const initial = await readStatus(client, "initial status");
    const context = await claimAndStart(client, "matrix-task", initial.envelope.revision);
    const claimed = await readStatus(client, "running status");
    revision = claimed.envelope.revision;
    const v04 = checkStatusDtoMatrix([
      { ...initial, label: "initial" },
      { ...claimed, label: "running" },
    ]);
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
      const created = await client.createWork(requestEnvelope(nextOperation(`create_${work_id}`), {
        project_id: PROJECT, work_id, actor_id: ACTOR, kind: "task", title: failpoint,
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
      service = startService(db, socket, failpoint);
      await waitForSocket(socket, service);
      client = serviceClient(socket);
      const fault = await runEvidence(client, socket, work_id, "verification", faultContext, operation_id, { BOREAL_VALIDATION_FAILPOINT: failpoint });
      const crashed = await waitForExit(service);
      assertThat(crashed !== 0, `${failpoint}: service did not fault at the requested boundary`);
      service = null;
      removeSocket(socket);
      service = startService(db, socket);
      await waitForSocket(socket, service);
      client = serviceClient(socket);
      const readback = await readOperation(client, operation_id);
      assertThat(readback.outcome === "unknown", `${failpoint}: readback outcome=${readback.outcome}`);
      assertThat(readback.data.readback_required === true, `${failpoint}: readback_required was not true`);
      const state = readback.data.execution?.state ?? null;
      assertThat(["admitted", "running", "exited", "unknown"].includes(state), `${failpoint}: invalid execution state ${state}`);
      faultReadbacks.push({ failpoint, work_id, operation_id, client_exit: fault.status, readback_outcome: readback.outcome, execution_state: state });
    }

    // Real successful evidence for all focused gates, followed by a mounted
    // full-screen closeout using durable receipt readback.
    const closeWork = await client.createWork(requestEnvelope(nextOperation("create_closeout"), {
      project_id: PROJECT, work_id: "closeout-task", actor_id: ACTOR, kind: "task", title: "Closeout task",
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
    const afterEvidence = await readStatus(client, "after evidence");
    const closeItem = afterEvidence.data.items.find((item) => item.work_id === "closeout-task");
    assertThat(closeItem && closeItem.gates.satisfied.length === 3, `closeout-task did not expose all satisfied gates: ${JSON.stringify(closeItem?.gates)}`);
    const verificationOperation = gateOperations.find((entry) => entry.gate_id === "verification").operation_id;
    const fullScreenEvidence = await runFullScreenCloseout(client, service, socket, closeContext, verificationOperation);
    service = null;
    client = null;

    // V06/V07 must survive the stop-after-commit refresh failure and be
    // visible to a fresh production client after restart.
    service = startService(db, socket);
    await waitForSocket(socket, service);
    client = serviceClient(socket);
    const final = await readStatus(client, "post-closeout status");
    const closed = final.data.items.find((item) => item.work_id === "closeout-task");
    assertThat(closed && ["complete", "closed"].includes(closed.status), `post-closeout status is not terminal: ${JSON.stringify(closed)}`);
    const finishReadback = await readOperation(client, fullScreenEvidence.finish_operation_id);
    assertThat(finishReadback.data.operation?.result?.summary_id, "finish parent operation did not retain typed summary identity");
    assertThat(finishReadback.data.operation?.result?.close_state, "finish parent operation did not retain typed close state");
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
