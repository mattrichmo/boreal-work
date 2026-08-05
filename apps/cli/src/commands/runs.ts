import {
  BorealError,
  type ExecutionRun,
  type EventId,
  type RunId,
  type RunProgress,
  type RunWaitCondition,
  type WorkId
} from "@boreal/core";
import { executionRunCommandFromText } from "@boreal/engine";

import { flagValue, flagValues, hasFlag, requiredFlag, type ParsedArgs } from "../args.js";
import type { CliContext } from "../context.js";
import { formatRecord, type CliOutput } from "../output.js";
import type { CommandResult } from "./shared.js";

export interface RunCommandDependencies {
  readonly requiredPositional: (values: readonly string[], index: number, label: string) => string;
  readonly resolveWorkId: (context: CliContext, value: string) => Promise<WorkId>;
}

export async function runCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean,
  dependencies: RunCommandDependencies
): Promise<CommandResult> {
  switch (action) {
    case "start": {
      const workId = await dependencies.resolveWorkId(context, dependencies.requiredPositional(rest, 0, "work reference"));
      const commandText = flagValue(args, "command");
      const run = await context.runtime.runs.start({
        workId,
        ...(commandText ? {
          command: executionRunCommandFromText({
            command: commandText,
            cwd: flagValue(args, "cwd"),
            timeoutMs: positiveInteger(flagValue(args, "timeout-ms"), "--timeout-ms", 60 * 60_000),
            stdoutMaxBytes: positiveInteger(flagValue(args, "stdout-max-bytes"), "--stdout-max-bytes", 1024 * 1024),
            stderrMaxBytes: positiveInteger(flagValue(args, "stderr-max-bytes"), "--stderr-max-bytes", 1024 * 1024)
          })
        } : {}),
        ...(flagValue(args, "idempotency-key") ? { idempotencyKey: flagValue(args, "idempotency-key") } : {}),
        ...(flagValue(args, "reservation") ? { reservationId: flagValue(args, "reservation") } : {}),
        ...(flagValue(args, "stale-after-ms") ? { staleAfterMs: positiveInteger(flagValue(args, "stale-after-ms"), "--stale-after-ms") } : {}),
        ...(flagValue(args, "max-attempts") ? { maxAttempts: positiveInteger(flagValue(args, "max-attempts"), "--max-attempts") } : {}),
        ...(flagValue(args, "backoff-ms") ? { backoffMs: nonNegativeInteger(flagValue(args, "backoff-ms"), "--backoff-ms") } : {})
      });
      output.write(formatRecord(runPayload(run), json));
      return { exitCode: 0 };
    }
    case "list": {
      const workId = flagValue(args, "work") ? await dependencies.resolveWorkId(context, requiredFlag(args, "work")) : undefined;
      const status = flagValue(args, "status");
      const limit = boundedInteger(flagValue(args, "limit"), "--limit", 100, 1000);
      const runs = (await context.runtime.runs.list())
        .filter((run) => !workId || run.workId === workId)
        .filter((run) => !status || status === "all" || run.status === status)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, limit);
      output.write(formatRecord({ schemaVersion: "boreal.cli.run.list.v1", runs }, json));
      return { exitCode: 0 };
    }
    case "show": {
      const runId = asRunId(dependencies.requiredPositional(rest, 0, "run id"));
      const result = await context.runtime.runs.show(runId);
      output.write(formatRecord({ schemaVersion: "boreal.cli.run.show.v1", ...result }, json));
      return { exitCode: 0 };
    }
    case "heartbeat": {
      const run = await context.runtime.runs.heartbeat(asRunId(dependencies.requiredPositional(rest, 0, "run id")), flagValue(args, "worker"));
      output.write(formatRecord(runPayload(run), json));
      return { exitCode: 0 };
    }
    case "checkpoint": {
      const runId = asRunId(dependencies.requiredPositional(rest, 0, "run id"));
      const progress = progressFromArgs(args);
      const result = await context.runtime.runs.checkpoint({
        runId,
        ...(flagValue(args, "phase") ? { phase: flagValue(args, "phase") } : {}),
        ...(progress ? { progress } : {}),
        ...(flagValue(args, "cursor") ? { cursor: flagValue(args, "cursor") } : {}),
        ...(flagValues(args, "artifact").length > 0 ? { artifactUris: flagValues(args, "artifact") } : {}),
        ...(flagValue(args, "note") ? { note: flagValue(args, "note") } : {})
      });
      output.write(formatRecord({ schemaVersion: "boreal.cli.run.checkpoint.v1", ...result }, json));
      return { exitCode: 0 };
    }
    case "wait": {
      const runId = asRunId(dependencies.requiredPositional(rest, 0, "run id"));
      const kind = requiredFlag(args, "kind");
      if (!["dependency", "human", "external", "timer", "rate_limit"].includes(kind)) {
        throw new BorealError("BOREAL_INVALID_INPUT", "--kind must be dependency, human, external, timer, or rate_limit");
      }
      const condition: RunWaitCondition = {
        kind: kind as RunWaitCondition["kind"],
        reasonCode: requiredFlag(args, "reason-code"),
        reason: requiredFlag(args, "reason"),
        ...(flagValue(args, "wake-at") ? { wakeAt: flagValue(args, "wake-at") as RunWaitCondition["wakeAt"] } : {}),
        ...(flagValue(args, "deadline") ? { deadline: flagValue(args, "deadline") as RunWaitCondition["deadline"] } : {}),
        ...(flagValue(args, "source-ref") ? { sourceRef: flagValue(args, "source-ref") } : {})
      };
      const run = await context.runtime.runs.wait(runId, condition);
      output.write(formatRecord(runPayload(run), json));
      return { exitCode: 0 };
    }
    case "pause":
    case "cancel":
    case "succeed":
    case "fail": {
      const runId = asRunId(dependencies.requiredPositional(rest, 0, "run id"));
      const run = await context.runtime.runs.transition(
        runId,
        action === "pause" ? "paused" : action === "cancel" ? "cancelled" : action === "succeed" ? "succeeded" : "failed",
        action === "fail" ? { code: flagValue(args, "error-code") ?? "BOREAL_RUN_FAILED", message: flagValue(args, "error") ?? "Execution was marked failed." } : undefined
      );
      output.write(formatRecord(runPayload(run), json));
      return { exitCode: 0 };
    }
    case "resume": {
      const run = await context.runtime.runs.resume(asRunId(dependencies.requiredPositional(rest, 0, "run id")), flagValue(args, "worker"));
      output.write(formatRecord(runPayload(run), json));
      return { exitCode: 0 };
    }
    case "retry": {
      const run = await context.runtime.runs.retry(asRunId(dependencies.requiredPositional(rest, 0, "run id")));
      output.write(formatRecord(runPayload(run), json));
      return { exitCode: 0 };
    }
    case "reconcile": {
      const result = await context.runtime.runs.reconcile();
      output.write(formatRecord({ schemaVersion: "boreal.cli.run.reconcile.v1", ...result }, json));
      return { exitCode: 0 };
    }
    case "worker": {
      if (hasFlag(args, "loop")) {
        if (json) throw new BorealError("BOREAL_INVALID_INPUT", "--loop cannot be combined with --json; use one JSON invocation per worker run");
        const intervalMs = boundedInteger(flagValue(args, "interval-ms"), "--interval-ms", 5_000, 60 * 60_000);
        output.write(`Boreal worker loop active (interval ${intervalMs}ms). Press Ctrl-C to stop.\n`);
        for (;;) {
          await context.runtime.runs.reconcile();
          const loopRun = await context.runtime.runs.executeQueued(flagValue(args, "worker") ?? String(context.actor.id));
          if (loopRun) output.write(`${loopRun.meta.id} ${loopRun.status}\n`);
          await new Promise((resolve) => setTimeout(resolve, intervalMs));
        }
      }
      const run = await context.runtime.runs.executeQueued(flagValue(args, "worker") ?? context.actor.id.toString());
      const payload = run ? runPayload(run) : undefined;
      const workerId = flagValue(args, "worker") ?? context.actor.id.toString();
      output.write(
        formatRecord(
          {
            schemaVersion: "boreal.cli.run.worker.v1",
            workerId,
            run: payload?.run,
            result: payload?.result ?? {
              schemaVersion: "boreal.cli.result.v1",
              id: workerId,
              kind: "worker",
              status: "idle",
              subjectId: context.workspaceRoot
            },
          },
          json,
        ),
      );
      return { exitCode: run && run.status === "failed" ? 1 : 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown run command: ${action ?? ""}`);
  }
}

export async function eventsCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean,
  dependencies: Pick<RunCommandDependencies, "requiredPositional">
): Promise<CommandResult> {
  if (action === "tail") {
    const cursorName = flagValue(args, "cursor");
    let afterEventId = flagValue(args, "after-event") as EventId | undefined;
    if (cursorName) {
      const cursor = (await context.store.read((reader) => reader.listEventCursors())).find((entry) => entry.name === cursorName && entry.consumerId === (flagValue(args, "consumer") ?? context.actor.id));
      afterEventId = cursor?.lastEventId;
    }
    const limit = boundedInteger(flagValue(args, "limit"), "--limit", 100, 1000);
    const events = (await context.runtime.runs.listEventsAfter(afterEventId)).slice(-limit);
    output.write(formatRecord({ schemaVersion: "boreal.cli.events.tail.v1", afterEventId, events, nextEventId: events.at(-1)?.meta.id }, json));
    return { exitCode: 0 };
  }
  if (action === "cursor") {
    const name = dependencies.requiredPositional(rest, 0, "cursor name");
    const consumerId = flagValue(args, "consumer") ?? String(context.actor.id);
    const cursor = await context.runtime.runs.advanceCursor({
      name,
      consumerId,
      ...(flagValue(args, "event") ? { eventId: flagValue(args, "event") as EventId } : {}),
      ...(flagValue(args, "seq") ? { seq: nonNegativeInteger(flagValue(args, "seq"), "--seq") } : {})
    });
    output.write(formatRecord({ schemaVersion: "boreal.cli.events.cursor.v1", cursor }, json));
    return { exitCode: 0 };
  }
  throw new BorealError("BOREAL_INVALID_INPUT", `Unknown events command: ${action ?? ""}`);
}

interface RunCliPayload {
  readonly schemaVersion: "boreal.cli.run.v1";
  readonly run: ExecutionRun;
  readonly result: {
    readonly schemaVersion: "boreal.cli.result.v1";
    readonly id: string;
    readonly kind: "execution_run";
    readonly status: ExecutionRun["status"];
    readonly subjectId: WorkId;
  };
}

function runPayload(run: ExecutionRun): RunCliPayload {
  return {
    schemaVersion: "boreal.cli.run.v1",
    run,
    result: {
      schemaVersion: "boreal.cli.result.v1",
      id: run.meta.id,
      kind: "execution_run",
      status: run.status,
      subjectId: run.workId
    }
  };
}

function progressFromArgs(args: ParsedArgs): RunProgress | undefined {
  const completed = flagValue(args, "completed");
  const total = flagValue(args, "total");
  const unit = flagValue(args, "unit");
  const label = flagValue(args, "label");
  if (!completed && !total && !unit && !label) return undefined;
  return {
    ...(completed ? { completed: nonNegativeInteger(completed, "--completed") } : {}),
    ...(total ? { total: nonNegativeInteger(total, "--total") } : {}),
    ...(unit ? { unit } : {}),
    ...(label ? { label } : {})
  };
}

function asRunId(value: string): RunId {
  if (!/^bw_run_[a-f0-9]{12,64}$/u.test(value)) throw new BorealError("BOREAL_INVALID_INPUT", "Expected a run id", { value });
  return value as RunId;
}

function positiveInteger(value: string | undefined, label: string, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new BorealError("BOREAL_INVALID_INPUT", `${label} must be a positive integer`, { value });
  return parsed;
}

function nonNegativeInteger(value: string | undefined, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new BorealError("BOREAL_INVALID_INPUT", `${label} must be a non-negative integer`, { value });
  return parsed;
}

function boundedInteger(value: string | undefined, label: string, fallback: number, maximum: number): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) throw new BorealError("BOREAL_INVALID_INPUT", `${label} must be an integer from 1 to ${maximum}`, { value });
  return parsed;
}
