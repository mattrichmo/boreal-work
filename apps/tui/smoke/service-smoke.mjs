import {
  API_VERSION,
  ENVELOPE_SCHEMA,
  VersionedServiceClient,
} from "../dist/client.js";
import { UnixSocketFramedTransport } from "../dist/node-transport.js";

const [socketPath] = process.argv.slice(2);

if (!socketPath) {
  throw new Error("usage: node apps/tui/smoke/service-smoke.mjs SOCKET_PATH");
}

const projectId = "tui-service-smoke";
const actorId = "smoke-operator";
const harnessId = "tui-service-smoke";
const sessionId = "session-tui-service-smoke";
let operationSequence = 0;

function request(data, expectedRevision = null, attemptId = null, attemptFence = null) {
  operationSequence += 1;
  return {
    api_version: API_VERSION,
    schema_version: ENVELOPE_SCHEMA,
    operation_id: `op_tui_service_smoke_${operationSequence}`,
    expected_revision: expectedRevision,
    attempt_id: attemptId,
    attempt_fence: attemptFence,
    data,
  };
}

function describeFailure(step, envelope) {
  const code = envelope.error?.code ?? "missing_error_code";
  const message = envelope.error?.message ?? "service returned no error message";
  const framingHint = step.startsWith("create_project")
    && code === "unknown_outcome"
    && message.includes("closed before a complete response frame")
    ? "; transport contract mismatch: the Node transport sent the application envelope directly, while the Rust socket requires an outer {request_id,payload} envelope"
    : "";
  return `${step} failed: outcome=${envelope.outcome} code=${code} message=${message}${framingHint}`;
}

function requireSuccess(step, envelope) {
  if (envelope.transport !== "ok" || !["changed", "unchanged"].includes(envelope.outcome)) {
    throw new Error(describeFailure(step, envelope));
  }
  if (envelope.data === null || typeof envelope.data !== "object") {
    throw new Error(`${step} returned no object data`);
  }
  return envelope.data;
}

function requireNumber(value, field) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
  return value;
}

function requireString(value, field) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

const transport = new UnixSocketFramedTransport(socketPath, { timeout_ms: 10_000 });
const client = new VersionedServiceClient(transport, {
  project_id: projectId,
  actor_id: actorId,
  harness_id: harnessId,
  session_id: sessionId,
});

try {
  const project = await client.createProject(request({
    project_id: projectId,
    actor_id: actorId,
    actor_role: "operator",
    credential_ref: "tui-service-smoke",
    display_name: "TUI service smoke operator",
  }));
  requireSuccess("create_project through VersionedServiceClient", project);

  const work = [
    {
      work_id: "smoke-milestone",
      kind: "milestone",
      title: "Smoke milestone",
      parent_id: null,
    },
    {
      work_id: "smoke-sprint",
      kind: "sprint",
      title: "Smoke sprint",
      parent_id: "smoke-milestone",
    },
    {
      work_id: "smoke-task",
      kind: "task",
      title: "Smoke task",
      parent_id: "smoke-sprint",
    },
  ];

  for (const item of work) {
    const created = await client.createWork(request({
      project_id: projectId,
      work_id: item.work_id,
      actor_id: actorId,
      kind: item.kind,
      title: item.title,
      parent_id: item.parent_id,
      description: "Created by the real Node TUI client over the Rust service",
      priority: 10,
      dispatch_policy: "automatic",
      hard_holds: [],
      acceptance_profile: { id: "focused", version: "1" },
    }, project.revision));
    requireSuccess(`create_work ${item.work_id} through VersionedServiceClient`, created);
  }

  const initialStatus = await client.readStatus({ limit: 100, offset: 0 });
  const initialData = requireSuccess("initial status through VersionedServiceClient", initialStatus);
  if (!Array.isArray(initialData.items)) throw new Error("initial status omitted items");
  const expectedWork = new Set(work.map((item) => item.work_id));
  for (const item of initialData.items) expectedWork.delete(item.work_id);
  if (expectedWork.size !== 0) {
    throw new Error(`initial status omitted work: ${[...expectedWork].join(", ")}`);
  }

  const now = Date.now();
  const attemptId = "attempt-tui-service-smoke";
  const claim = await client.claim(request({
    project_id: projectId,
    work_id: "smoke-task",
    actor_id: actorId,
    harness_id: harnessId,
    session_id: sessionId,
    attempt_id: attemptId,
    claimed_at: new Date(now).toISOString(),
    lease_deadline: new Date(now + 30 * 60 * 1000).toISOString(),
    hard_deadline: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
  }, initialStatus.revision));
  const claimData = requireSuccess("claim through VersionedServiceClient", claim);
  const claimedAttemptId = requireString(claimData.attempt_id, "claim.attempt_id");
  const fence = requireNumber(claimData.fence, "claim.fence");

  const start = await client.acceptStart(request({
    project_id: projectId,
    work_id: "smoke-task",
    attempt_id: claimedAttemptId,
    fence,
    actor_id: actorId,
    harness_id: harnessId,
    session_id: sessionId,
  }, claim.revision, claimedAttemptId, fence));
  const startData = requireSuccess("start through VersionedServiceClient", start);
  if (startData.phase !== "running") {
    throw new Error(`start returned phase=${String(startData.phase)} instead of running`);
  }

  const runningStatus = await client.readStatus({ limit: 100, offset: 0 });
  const runningData = requireSuccess("running status through VersionedServiceClient", runningStatus);
  const runningTask = runningData.items.find((item) => item.work_id === "smoke-task");
  if (!runningTask) throw new Error("running status omitted smoke-task");
  if (!runningTask.attempt_id && !runningTask.attempt) {
    throw new Error("running status omitted the current attempt");
  }

  const release = await client.release(request({
    project_id: projectId,
    work_id: "smoke-task",
    attempt_id: claimedAttemptId,
    fence,
    actor_id: actorId,
    harness_id: harnessId,
    session_id: sessionId,
    reason: "cross_language_smoke_complete",
  }, runningStatus.revision, claimedAttemptId, fence));
  requireSuccess("release through VersionedServiceClient", release);

  const finalStatus = await client.readStatus({ limit: 100, offset: 0 });
  const finalData = requireSuccess("final status through VersionedServiceClient", finalStatus);
  const releasedTask = finalData.items.find((item) => item.work_id === "smoke-task");
  if (!releasedTask) throw new Error("final status omitted smoke-task");
  if (releasedTask.attempt_id || releasedTask.attempt) {
    throw new Error("released task still has a current attempt");
  }

  process.stdout.write(
    "tui service smoke: PASS (real Node transport; project/hierarchy creation; status; claim/start/release)\n",
  );
} finally {
  await client.close();
}
