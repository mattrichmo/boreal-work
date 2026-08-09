import { resolve } from "node:path";

import {
  BorealError,
  DEFAULT_DECLARED_GATE_ENV_KEYS,
  DEFAULT_TRUSTED_EXECUTABLE_NAMES,
  assertPathInside,
  assertRealPathInside,
  createRecordMeta,
  deterministicId,
  isTrustedExecutableCapability,
  nowIso,
  normalizedExecutableName,
  parseDeclaredCommand,
  randomId,
  runBoundedProcess,
  sanitizeProcessEnvironment,
  touchRecord,
  withContentHash,
  type ActorRef,
  type EventCursorId,
  type EventId,
  type ExecutionRun,
  type ExecutionRunCommand,
  type ExecutionRunResult,
  type EventCursorRecord,
  type IsoTimestamp,
  type RunCheckpoint,
  type RunCheckpointId,
  type RunId,
  type RunProgress,
  type RunWaitCondition,
  type RuntimeEvent,
  type WorkId
} from "@boreal/core";
import type { BorealStore, BorealWriter } from "@boreal/storage";

const DEFAULT_RUN_STALE_AFTER_MS = 2 * 60_000;
const DEFAULT_RUN_TIMEOUT_MS = 60 * 60_000;
const DEFAULT_RUN_STREAM_MAX_BYTES = 1024 * 1024;
const MAX_RUN_EXCERPT_CHARS = 4_000;
const APPROVED_RUN_EXECUTABLES = new Set(DEFAULT_TRUSTED_EXECUTABLE_NAMES);

export interface StartExecutionRunInput {
  readonly workId: WorkId;
  readonly command?: ExecutionRunCommand;
  readonly reservationId?: string;
  readonly idempotencyKey?: string;
  readonly staleAfterMs?: number;
  readonly maxAttempts?: number;
  readonly backoffMs?: number;
}

export interface ExecutionRunService {
  start(input: StartExecutionRunInput): Promise<ExecutionRun>;
  heartbeat(runId: RunId, workerId?: string): Promise<ExecutionRun>;
  checkpoint(input: {
    readonly runId: RunId;
    readonly phase?: string;
    readonly progress?: RunProgress;
    readonly cursor?: string;
    readonly artifactUris?: readonly string[];
    readonly note?: string;
  }): Promise<{ readonly run: ExecutionRun; readonly checkpoint: RunCheckpoint }>;
  wait(runId: RunId, condition: RunWaitCondition): Promise<ExecutionRun>;
  transition(runId: RunId, status: "paused" | "cancelled" | "succeeded" | "failed", error?: { readonly code: string; readonly message: string }): Promise<ExecutionRun>;
  resume(runId: RunId, workerId?: string): Promise<ExecutionRun>;
  retry(runId: RunId): Promise<ExecutionRun>;
  reconcile(): Promise<{ readonly expired: readonly RunId[]; readonly requeued: readonly RunId[] }>;
  list(): Promise<readonly ExecutionRun[]>;
  show(runId: RunId): Promise<{ readonly run: ExecutionRun; readonly checkpoints: readonly RunCheckpoint[] }>;
  advanceCursor(input: { readonly name: string; readonly consumerId: string; readonly eventId?: EventId; readonly seq?: number }): Promise<EventCursorRecord>;
  listEventsAfter(eventId?: EventId): Promise<readonly RuntimeEvent[]>;
  executeQueued(workerId?: string): Promise<ExecutionRun | undefined>;
}

export function createExecutionRunService(options: {
  readonly store: BorealStore;
  readonly actor: ActorRef;
  readonly workspaceRoot?: string;
  readonly operationId?: string;
  readonly clock?: () => Date;
}): ExecutionRunService {
  const now = () => nowIso(options.clock?.() ?? new Date());
  const activeControllers = new Map<RunId, AbortController>();

  async function appendEvent(
    writer: BorealWriter,
    type: string,
    subjectId: string,
    payload: Record<string, unknown>
  ): Promise<RuntimeEvent> {
    const timestamp = now();
    const event = withContentHash({
      meta: createRecordMeta({ id: randomId<EventId>("event"), now: timestamp, actor: options.actor }),
      type,
      subjectId,
      subjectType: type.startsWith("run.") ? "run" : "event_cursor",
      ...(options.operationId ? { operationId: options.operationId as RuntimeEvent["operationId"] } : {}),
      payload
    });
    await writer.putEvent(event);
    return event;
  }

  async function getRunOrThrow(reader: { getRun(id: RunId): Promise<ExecutionRun | undefined> }, runId: RunId): Promise<ExecutionRun> {
    const run = await reader.getRun(runId);
    if (!run) throw new BorealError("BOREAL_NOT_FOUND", "Execution run not found", { runId });
    return run;
  }

  function assertWorker(run: ExecutionRun, workerId?: string): void {
    if (run.workerId && workerId && run.workerId !== workerId) {
      throw new BorealError("BOREAL_CONFLICT", "Execution run is fenced to another worker", {
        runId: run.meta.id,
        expectedWorkerId: run.workerId,
        workerId
      });
    }
  }

  async function createRetryRun(writer: BorealWriter, parent: ExecutionRun): Promise<ExecutionRun> {
    if (parent.attempt >= parent.retry.maxAttempts) {
      throw new BorealError("BOREAL_CONFLICT", "Execution run has exhausted its retry policy", {
        runId: parent.meta.id,
        attempt: parent.attempt,
        maxAttempts: parent.retry.maxAttempts
      });
    }
    const timestamp = now();
    const nextAttemptAt = new Date(Date.parse(timestamp) + parent.retry.backoffMs).toISOString() as IsoTimestamp;
    const run = withContentHash({
      meta: createRecordMeta({ id: randomId<RunId>("run"), now: timestamp, actor: options.actor }),
      workId: parent.workId,
      attempt: parent.attempt + 1,
      status: "queued" as const,
      ...(parent.reservationId ? { reservationId: parent.reservationId } : {}),
      ...(parent.idempotencyKey ? { idempotencyKey: parent.idempotencyKey } : {}),
      parentRunId: parent.meta.id,
      ...(parent.command ? { command: parent.command } : {}),
      createdAt: timestamp,
      staleAfterMs: parent.staleAfterMs,
      checkpointSequence: 0,
      retry: { ...parent.retry, nextAttemptAt }
    });
    await writer.putRun(run);
    await appendEvent(writer, "run.retry_queued", run.meta.id, {
      workId: run.workId,
      parentRunId: parent.meta.id,
      attempt: run.attempt,
      nextAttemptAt
    });
    return run;
  }

  return {
    async start(input): Promise<ExecutionRun> {
      return options.store.write(async (writer) => {
        const work = await writer.getWorkItem(input.workId);
        if (!work) throw new BorealError("BOREAL_NOT_FOUND", "Work item not found for execution run", { workId: input.workId });
        if (input.command) validateExecutionRunCommand(input.command);
        const existing = input.idempotencyKey
          ? (await writer.listRunsForWork(input.workId)).find((run) => run.idempotencyKey === input.idempotencyKey)
          : undefined;
        if (existing) return existing;
        const timestamp = now();
        const run = withContentHash({
          meta: createRecordMeta({ id: randomId<RunId>("run"), now: timestamp, actor: options.actor }),
          workId: input.workId,
          attempt: 1,
          status: "queued" as const,
          ...(input.reservationId ? { reservationId: input.reservationId as ExecutionRun["reservationId"] } : {}),
          ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
          ...(input.command ? { command: input.command } : {}),
          createdAt: timestamp,
          staleAfterMs: input.staleAfterMs ?? DEFAULT_RUN_STALE_AFTER_MS,
          checkpointSequence: 0,
          retry: {
            maxAttempts: input.maxAttempts ?? 1,
            backoffMs: input.backoffMs ?? 0
          }
        });
        await writer.putRun(run);
        await appendEvent(writer, "run.queued", run.meta.id, { workId: run.workId, attempt: run.attempt });
        return run;
      });
    },

    async heartbeat(runId, workerId): Promise<ExecutionRun> {
      return options.store.write(async (writer) => {
        const run = await getRunOrThrow(writer, runId);
        assertWorker(run, workerId);
        if (run.status !== "running") throw new BorealError("BOREAL_CONFLICT", "Only running execution runs accept heartbeats", { runId, status: run.status });
        const updated = withContentHash(touchRecord({ ...run, heartbeatAt: now() }, now(), options.actor));
        await writer.putRun(updated);
        await appendEvent(writer, "run.heartbeat", run.meta.id, { workerId: workerId ?? run.workerId });
        return updated;
      });
    },

    async checkpoint(input) {
      return options.store.write(async (writer) => {
        const run = await getRunOrThrow(writer, input.runId);
        if (run.status !== "running" && run.status !== "paused" && run.status !== "waiting") {
          throw new BorealError("BOREAL_CONFLICT", "Only active execution runs accept checkpoints", { runId: input.runId, status: run.status });
        }
        const timestamp = now();
        const sequence = run.checkpointSequence + 1;
        const checkpoint = withContentHash({
          meta: createRecordMeta({
            id: deterministicId<RunCheckpointId>("checkpoint", { runId: run.meta.id, sequence }),
            now: timestamp,
            actor: options.actor
          }),
          runId: run.meta.id,
          sequence,
          ...(input.phase ? { phase: input.phase } : {}),
          ...(input.progress ? { progress: input.progress } : {}),
          ...(input.cursor ? { cursor: input.cursor } : {}),
          artifactUris: [...(input.artifactUris ?? [])],
          ...(input.note ? { note: input.note } : {})
        });
        const updated = withContentHash(touchRecord({
          ...run,
          heartbeatAt: timestamp,
          currentCheckpointId: checkpoint.meta.id,
          checkpointSequence: sequence,
          ...(input.phase ? { phase: input.phase } : {}),
          ...(input.progress ? { progress: input.progress } : {})
        }, timestamp, options.actor));
        await writer.putCheckpoint(checkpoint);
        await writer.putRun(updated);
        await appendEvent(writer, "run.checkpointed", run.meta.id, { sequence, checkpointId: checkpoint.meta.id });
        return { run: updated, checkpoint };
      });
    },

    async wait(runId, condition): Promise<ExecutionRun> {
      const updated = await options.store.write(async (writer) => {
        const run = await getRunOrThrow(writer, runId);
        if (run.status !== "running" && run.status !== "paused") throw new BorealError("BOREAL_CONFLICT", "Only active execution runs can wait", { runId, status: run.status });
        const next = withContentHash(touchRecord({ ...run, status: "waiting" as const, wait: condition, heartbeatAt: now() }, now(), options.actor));
        await writer.putRun(next);
        await appendEvent(writer, "run.waiting", run.meta.id, { kind: condition.kind, reasonCode: condition.reasonCode, wakeAt: condition.wakeAt });
        return next;
      });
      activeControllers.get(runId)?.abort();
      return updated;
    },

    async transition(runId, status, error): Promise<ExecutionRun> {
      const updated = await options.store.write(async (writer) => {
        const run = await getRunOrThrow(writer, runId);
        const timestamp = now();
        const next = withContentHash(touchRecord({
          ...run,
          status,
          finishedAt: status === "paused" ? undefined : timestamp,
          heartbeatAt: timestamp,
          ...(error ? { errorCode: error.code, errorMessage: error.message } : {})
        }, timestamp, options.actor));
        await writer.putRun(next);
        await appendEvent(writer, `run.${status}`, run.meta.id, { errorCode: error?.code, errorMessage: error?.message });
        return next;
      });
      activeControllers.get(runId)?.abort();
      return updated;
    },

    async resume(runId, workerId): Promise<ExecutionRun> {
      return options.store.write(async (writer) => {
        const run = await getRunOrThrow(writer, runId);
        assertWorker(run, workerId);
        if (run.status !== "queued" && run.status !== "paused" && run.status !== "waiting" && run.status !== "needs_attention" && run.status !== "expired") {
          throw new BorealError("BOREAL_CONFLICT", "Execution run is not resumable", { runId, status: run.status });
        }
        const timestamp = now();
        const updated = withContentHash(touchRecord({
          ...run,
          status: "running" as const,
          workerId: workerId ?? run.workerId ?? String(options.actor.id),
          startedAt: run.startedAt ?? timestamp,
          heartbeatAt: timestamp,
          finishedAt: undefined,
          wait: undefined,
          errorCode: undefined,
          errorMessage: undefined
        }, timestamp, options.actor));
        await writer.putRun(updated);
        await appendEvent(writer, "run.resumed", run.meta.id, { workerId: updated.workerId });
        return updated;
      });
    },

    async retry(runId): Promise<ExecutionRun> {
      return options.store.write(async (writer) => {
        const run = await getRunOrThrow(writer, runId);
        if (run.status !== "failed" && run.status !== "expired" && run.status !== "needs_attention") {
          throw new BorealError("BOREAL_CONFLICT", "Only failed or stale runs can be retried", { runId, status: run.status });
        }
        return createRetryRun(writer, run);
      });
    },

    async reconcile() {
      return options.store.write(async (writer) => {
        const timestamp = now();
        const nowMs = Date.parse(timestamp);
        const expired: RunId[] = [];
        const requeued: RunId[] = [];
        for (const run of await writer.listRuns()) {
          if (run.status === "running" && run.heartbeatAt && nowMs - Date.parse(run.heartbeatAt) > run.staleAfterMs) {
            const updated = withContentHash(touchRecord({
              ...run,
              status: "needs_attention" as const,
              finishedAt: timestamp,
              errorCode: "BOREAL_RUN_STALE",
              errorMessage: "Worker heartbeat expired; inspect the run before retrying."
            }, timestamp, options.actor));
            await writer.putRun(updated);
            await appendEvent(writer, "run.stale", run.meta.id, { heartbeatAt: run.heartbeatAt, staleAfterMs: run.staleAfterMs });
            expired.push(run.meta.id);
          }
          if (run.status === "waiting" && run.wait?.wakeAt && Date.parse(run.wait.wakeAt) <= nowMs) {
            const updated = withContentHash(touchRecord({ ...run, status: "queued" as const, wait: undefined, workerId: undefined }, timestamp, options.actor));
            await writer.putRun(updated);
            await appendEvent(writer, "run.requeued", run.meta.id, { reason: "wait_condition_ready" });
            requeued.push(run.meta.id);
          }
        }
        return { expired, requeued };
      });
    },

    async list() {
      return options.store.read((reader) => reader.listRuns());
    },

    async show(runId) {
      return options.store.read(async (reader) => ({
        run: await getRunOrThrow(reader, runId),
        checkpoints: await reader.listCheckpointsForRun(runId)
      }));
    },

    async advanceCursor(input) {
      return options.store.write(async (writer) => {
        const id = deterministicId<EventCursorId>("cursor", { name: input.name, consumerId: input.consumerId });
        const existing = await writer.getEventCursor(id);
        const timestamp = now();
        const cursor = withContentHash(touchRecord({
          ...(existing ?? {
            meta: createRecordMeta({ id, now: timestamp, actor: options.actor }),
            name: input.name,
            consumerId: input.consumerId,
            stream: "runtime-events" as const
          }),
          ...(input.eventId ? { lastEventId: input.eventId } : {}),
          ...(input.seq !== undefined ? { lastSeq: input.seq } : {}),
          advancedAt: timestamp
        }, timestamp, options.actor));
        await writer.putEventCursor(cursor);
        await appendEvent(writer, "event_cursor.advanced", cursor.meta.id, { name: cursor.name, consumerId: cursor.consumerId, lastEventId: cursor.lastEventId, lastSeq: cursor.lastSeq });
        return cursor;
      });
    },

    async listEventsAfter(eventId) {
      return options.store.read(async (reader) => {
        const events = await reader.listEvents();
        if (!eventId) return events;
        const index = events.findIndex((event) => event.meta.id === eventId);
        return index < 0 ? events : events.slice(index + 1);
      });
    },

    async executeQueued(workerId = String(options.actor.id)) {
      const claimed = await options.store.write(async (writer) => {
        const timestamp = now();
        const candidate = (await writer.listRuns())
          .filter((run) => run.status === "queued")
          .filter((run) => !run.retry.nextAttemptAt || Date.parse(run.retry.nextAttemptAt) <= Date.parse(timestamp))
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
        if (!candidate) return undefined;
        if (!candidate.command) {
          const attention = withContentHash(touchRecord({
            ...candidate,
            status: "needs_attention" as const,
            finishedAt: timestamp,
            errorCode: "BOREAL_RUN_COMMAND_MISSING",
            errorMessage: "This run has no capability-bounded command; an external worker must drive its lifecycle."
          }, timestamp, options.actor));
          await writer.putRun(attention);
          await appendEvent(writer, "run.needs_attention", candidate.meta.id, { errorCode: attention.errorCode });
          return undefined;
        }
        try {
          validateExecutionRunCommand(candidate.command);
        } catch (error) {
          const errorCode = error instanceof BorealError ? error.code : "BOREAL_RUN_COMMAND_UNTRUSTED";
          const errorMessage = error instanceof Error ? error.message : "Execution run command failed capability validation.";
          const attention = withContentHash(touchRecord({
            ...candidate,
            status: "needs_attention" as const,
            finishedAt: timestamp,
            errorCode,
            errorMessage
          }, timestamp, options.actor));
          await writer.putRun(attention);
          await appendEvent(writer, "run.needs_attention", candidate.meta.id, { errorCode, reason: "command_capability_validation" });
          return undefined;
        }
        const running = withContentHash(touchRecord({
          ...candidate,
          status: "running" as const,
          workerId,
          startedAt: candidate.startedAt ?? timestamp,
          heartbeatAt: timestamp,
          finishedAt: undefined,
          errorCode: undefined,
          errorMessage: undefined
        }, timestamp, options.actor));
        await writer.putRun(running);
        await appendEvent(writer, "run.claimed", running.meta.id, { workerId });
        return running;
      });
      if (!claimed?.command) return undefined;

      const controller = new AbortController();
      activeControllers.set(claimed.meta.id, controller);
      const heartbeatIntervalMs = Math.max(250, Math.min(30_000, Math.floor(claimed.staleAfterMs / 3)));
      let heartbeatClosed = false;
      const heartbeatTimer = setInterval(() => {
        if (heartbeatClosed) return;
        void options.store.write(async (writer) => {
          const current = await writer.getRun(claimed.meta.id);
          if (!current || current.status !== "running" || current.workerId !== workerId) return;
          const timestamp = now();
          await writer.putRun(withContentHash(touchRecord({ ...current, heartbeatAt: timestamp }, timestamp, options.actor)));
        }).catch(() => undefined);
      }, heartbeatIntervalMs);
      heartbeatTimer.unref?.();

      try {
        const command = claimed.command;
        validateExecutionRunCommand(command);
        const cwd = resolve(options.workspaceRoot ?? process.cwd(), command.cwd ?? ".");
        const workspaceRoot = resolve(options.workspaceRoot ?? process.cwd());
        assertPathInside(workspaceRoot, cwd);
        await assertRealPathInside(workspaceRoot, cwd);
        const env = sanitizeProcessEnvironment(process.env, DEFAULT_DECLARED_GATE_ENV_KEYS);
        const result = await runBoundedProcess({
          command: trustedRuntimeExecutable(command.executable),
          args: command.args,
          cwd,
          timeoutMs: command.timeoutMs,
          stdoutMaxBytes: command.stdoutMaxBytes,
          stderrMaxBytes: command.stderrMaxBytes,
          env,
          signal: controller.signal,
          killProcessGroup: true
        });
        return finishFromProcess(claimed, workerId, result);
      } catch (error) {
        const details = error instanceof BorealError && isRecord(error.details) ? error.details : undefined;
        const processResult = details?.result;
        const result = isRecord(processResult) ? processResult : undefined;
        return options.store.write(async (writer) => {
          const current = await getRunOrThrow(writer, claimed.meta.id);
          assertWorker(current, workerId);
          const timestamp = now();
          const failed = withContentHash(touchRecord({
            ...current,
            status: (current.status === "cancelled" || current.status === "needs_attention" || current.status === "paused" || current.status === "waiting" ? current.status : "failed") as ExecutionRun["status"],
            workerId,
            finishedAt: timestamp,
            result: result ? processResultSummary(result) : undefined,
            errorCode: current.errorCode ?? (error instanceof BorealError ? error.code : "BOREAL_RUN_EXECUTION_FAILED"),
            errorMessage: current.errorMessage ?? (error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000))
          }, timestamp, options.actor));
          await writer.putRun(failed);
          if (current.status === "running") {
            await appendEvent(writer, "run.failed", current.meta.id, { errorCode: failed.errorCode, exitCode: failed.result?.exitCode });
          }
          return failed;
        });
      } finally {
        heartbeatClosed = true;
        clearInterval(heartbeatTimer);
        activeControllers.delete(claimed.meta.id);
      }
    }
  };

  async function finishFromProcess(
    claimed: ExecutionRun,
    workerId: string,
    result: Awaited<ReturnType<typeof runBoundedProcess>>
  ): Promise<ExecutionRun> {
    return options.store.write(async (writer) => {
      const current = await getRunOrThrow(writer, claimed.meta.id);
      assertWorker(current, workerId);
      const timestamp = now();
      const success = result.exitCode === 0 && !result.timedOut && !result.cancelled;
      const fenced = current.status === "cancelled" || current.status === "needs_attention" || current.status === "paused" || current.status === "waiting";
      const updated = withContentHash(touchRecord({
        ...current,
        status: (fenced ? current.status : success ? "succeeded" : "failed") as ExecutionRun["status"],
        finishedAt: timestamp,
        heartbeatAt: timestamp,
        result: processResultSummary(result),
        ...(fenced ? {} : success ? {} : { errorCode: result.timedOut ? "BOREAL_COMMAND_TIMEOUT" : "BOREAL_RUN_EXIT_NONZERO", errorMessage: `Execution exited with code ${String(result.exitCode ?? "unknown")}.` })
      }, timestamp, options.actor));
      await writer.putRun(updated);
      if (!fenced) {
        await appendEvent(writer, success ? "run.succeeded" : "run.failed", current.meta.id, { exitCode: result.exitCode, durationMs: result.durationMs });
      }
      return updated;
    });
  }
}

export function executionRunCommandFromText(input: {
  readonly command: string;
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly stdoutMaxBytes?: number;
  readonly stderrMaxBytes?: number;
}): ExecutionRunCommand {
  const [executable, ...args] = parseDeclaredCommand(input.command);
  if (!executable) throw new BorealError("BOREAL_INVALID_INPUT", "Execution run command cannot be empty");
  const executableName = normalizedExecutableName(executable);
  if (!isTrustedExecutableCapability(executable, [...APPROVED_RUN_EXECUTABLES], { allowRuntimePath: true })) {
    throw new BorealError("BOREAL_POLICY_VIOLATION", "Execution run executable is not approved", {
      executable,
      executableName,
      allowedExecutables: [...APPROVED_RUN_EXECUTABLES].sort()
    });
  }
  if (
    executableName === "node" &&
    resolve(executable) !== resolve(process.execPath) &&
    args.some((arg) => /^--(?:eval|import|loader|require)|^-{1,2}(?:e|p|r)$/u.test(arg))
  ) {
    throw new BorealError("BOREAL_POLICY_VIOLATION", "Execution run command requests an untrusted code-loading capability", { executable, args });
  }
  return {
    executable,
    args,
    ...(input.cwd ? { cwd: input.cwd } : {}),
    timeoutMs: input.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS,
    stdoutMaxBytes: input.stdoutMaxBytes ?? DEFAULT_RUN_STREAM_MAX_BYTES,
    stderrMaxBytes: input.stderrMaxBytes ?? DEFAULT_RUN_STREAM_MAX_BYTES
  };
}

function validateExecutionRunCommand(command: ExecutionRunCommand): void {
  const executableName = normalizedExecutableName(command.executable);
  if (!isTrustedExecutableCapability(command.executable, [...APPROVED_RUN_EXECUTABLES], { allowRuntimePath: true })) {
    throw new BorealError("BOREAL_POLICY_VIOLATION", "Execution run executable is not approved", {
      executable: command.executable,
      executableName
    });
  }
  if (!Number.isInteger(command.timeoutMs) || command.timeoutMs <= 0) throw new BorealError("BOREAL_INVALID_INPUT", "Run timeout must be a positive integer");
  if (!Number.isInteger(command.stdoutMaxBytes) || command.stdoutMaxBytes <= 0) throw new BorealError("BOREAL_INVALID_INPUT", "Run stdout cap must be a positive integer");
  if (!Number.isInteger(command.stderrMaxBytes) || command.stderrMaxBytes <= 0) throw new BorealError("BOREAL_INVALID_INPUT", "Run stderr cap must be a positive integer");
}

function trustedRuntimeExecutable(executable: string): string {
  return executable === "node" ? process.execPath : executable;
}

function processResultSummary(result: unknown): ExecutionRunResult {
  const value = isRecord(result) ? result : {};
  return {
    ...(typeof value.exitCode === "number" ? { exitCode: value.exitCode } : {}),
    ...(typeof value.signal === "string" ? { signal: value.signal } : {}),
    ...(typeof value.timedOut === "boolean" ? { timedOut: value.timedOut } : {}),
    ...(typeof value.cancelled === "boolean" ? { cancelled: value.cancelled } : {}),
    ...(isRecord(value.stdout) ? {
      stdoutHash: value.stdout.sha256 as ExecutionRunResult["stdoutHash"],
      stdoutBytes: value.stdout.bytes as number,
      stdoutExcerpt: typeof value.stdout.text === "string" ? value.stdout.text.slice(-MAX_RUN_EXCERPT_CHARS) : undefined
    } : {}),
    ...(isRecord(value.stderr) ? {
      stderrHash: value.stderr.sha256 as ExecutionRunResult["stderrHash"],
      stderrBytes: value.stderr.bytes as number,
      stderrExcerpt: typeof value.stderr.text === "string" ? value.stderr.text.slice(-MAX_RUN_EXCERPT_CHARS) : undefined
    } : {})
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
