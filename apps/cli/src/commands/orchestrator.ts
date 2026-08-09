import {
  BorealError,
  type OrchestrationNudgeKind,
  type OrchestrationStatus,
  type OrchestrationProgressState,
  type OrchestrationId,
  type WorkId
} from "@boreal/core";
import type { OrchestrationPolicy } from "@boreal/core";

import { flagValue, flagValues, hasFlag, requiredFlag, type ParsedArgs } from "../args.js";
import type { CliContext } from "../context.js";
import { formatRecord, type CliOutput } from "../output.js";
import type { CommandResult } from "./shared.js";

export interface OrchestratorCommandDependencies {
  readonly requiredPositional: (values: readonly string[], index: number, label: string) => string;
  readonly resolveWorkId: (context: CliContext, value: string) => Promise<WorkId>;
}

const ORCHESTRATION_STATUSES = new Set<OrchestrationStatus>([
  "active",
  "paused",
  "needs_attention",
  "succeeded",
  "failed",
  "cancelled"
]);
const PROGRESS_STATES = new Set<OrchestrationProgressState>(["working", "waiting", "blocked", "completed"]);
const NUDGE_KINDS = new Set<OrchestrationNudgeKind>(["heartbeat", "checkpoint", "scope", "blocked", "replan"]);

export async function orchestratorCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean,
  dependencies: OrchestratorCommandDependencies
): Promise<CommandResult> {
  switch (action) {
    case "start": {
      const rootWorkId = await dependencies.resolveWorkId(
        context,
        dependencies.requiredPositional(rest, 0, "root work reference")
      );
      const run = await context.runtime.orchestrator.start({
        rootWorkId,
        ...(flagValues(args, "agent").length > 0 ? { agentPool: flagValues(args, "agent") } : {}),
        ...(flagValue(args, "purpose") ? { purpose: flagValue(args, "purpose") } : {}),
        policy: policyFromArgs(args)
      });
      const tick = hasFlag(args, "dispatch")
        ? await context.runtime.orchestrator.tick({ orchestrationId: run.meta.id, dispatch: true })
        : undefined;
      output.write(formatRecord({ schemaVersion: "boreal.cli.orchestrate.start.v1", run, ...(tick ? { tick } : {}) }, json));
      return { exitCode: 0 };
    }
    case "list": {
      const status = optionalStatus(flagValue(args, "status"));
      const limit = positiveInteger(flagValue(args, "limit"), "--limit", 100, 1000);
      const runs = await context.runtime.orchestrator.list({ status, limit });
      output.write(formatRecord({ schemaVersion: "boreal.cli.orchestrate.list.v1", runs }, json));
      return { exitCode: 0 };
    }
    case "show": {
      const orchestrationId = asOrchestrationId(dependencies.requiredPositional(rest, 0, "orchestration id"));
      output.write(formatRecord({ schemaVersion: "boreal.cli.orchestrate.show.v1", ...(await context.runtime.orchestrator.show(orchestrationId)) }, json));
      return { exitCode: 0 };
    }
    case "tick": {
      const orchestrationId = asOrchestrationId(dependencies.requiredPositional(rest, 0, "orchestration id"));
      const result = await context.runtime.orchestrator.tick({ orchestrationId, dispatch: hasFlag(args, "dispatch") });
      output.write(formatRecord({ schemaVersion: "boreal.cli.orchestrate.tick.v1", ...result }, json));
      return { exitCode: 0 };
    }
    case "progress": {
      const orchestrationId = asOrchestrationId(dependencies.requiredPositional(rest, 0, "orchestration id"));
      const workId = await dependencies.resolveWorkId(context, dependencies.requiredPositional(rest, 1, "assigned work reference"));
      const agentId = requiredFlag(args, "agent");
      const state = requiredProgressState(requiredFlag(args, "state"));
      const run = await context.runtime.orchestrator.progress({
        orchestrationId,
        workId,
        agentId,
        state,
        ...(flagValue(args, "phase") ? { phase: flagValue(args, "phase") } : {}),
        ...(flagValue(args, "next-checkpoint") ? { nextCheckpoint: flagValue(args, "next-checkpoint") } : {}),
        ...(flagValue(args, "blocker-code") ? { blockerCode: flagValue(args, "blocker-code") } : {}),
        ...(flagValue(args, "note") ? { note: flagValue(args, "note") } : {}),
        ...(flagValues(args, "evidence").length > 0 ? { evidenceIds: flagValues(args, "evidence") } : {}),
        ...(flagValues(args, "artifact").length > 0 ? { artifactUris: flagValues(args, "artifact") } : {}),
        ...(flagValues(args, "touched-path").length > 0 ? { touchedPaths: flagValues(args, "touched-path") } : {})
      });
      output.write(formatRecord({ schemaVersion: "boreal.cli.orchestrate.progress.v1", run }, json));
      return { exitCode: 0 };
    }
    case "nudge": {
      const orchestrationId = asOrchestrationId(dependencies.requiredPositional(rest, 0, "orchestration id"));
      const workId = await dependencies.resolveWorkId(context, dependencies.requiredPositional(rest, 1, "assigned work reference"));
      const kind = requiredNudgeKind(requiredFlag(args, "kind"));
      const result = await context.runtime.orchestrator.nudge({
        orchestrationId,
        workId,
        kind,
        ...(flagValue(args, "agent") ? { agentId: flagValue(args, "agent") } : {})
      });
      output.write(formatRecord({ schemaVersion: "boreal.cli.orchestrate.nudge.v1", ...result }, json));
      return { exitCode: 0 };
    }
    case "pause":
    case "resume":
    case "cancel":
    case "fail": {
      const orchestrationId = asOrchestrationId(dependencies.requiredPositional(rest, 0, "orchestration id"));
      const run = await context.runtime.orchestrator.transition(
        orchestrationId,
        action === "resume" ? "resumed" : action === "pause" ? "paused" : action === "cancel" ? "cancelled" : "failed"
      );
      output.write(formatRecord({ schemaVersion: `boreal.cli.orchestrate.${action}.v1`, run }, json));
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown orchestrate command: ${action ?? ""}`);
  }
}

function policyFromArgs(args: ParsedArgs): Partial<OrchestrationPolicy> {
  return {
    ...(flagValue(args, "max-concurrent") ? { maxConcurrent: positiveInteger(flagValue(args, "max-concurrent"), "--max-concurrent", 3, 100) } : {}),
    ...(flagValue(args, "nudge-after-ms") ? { nudgeAfterMs: positiveInteger(flagValue(args, "nudge-after-ms"), "--nudge-after-ms", 15 * 60_000, 24 * 60 * 60_000) } : {}),
    ...(flagValue(args, "stale-after-ms") ? { staleAfterMs: positiveInteger(flagValue(args, "stale-after-ms"), "--stale-after-ms", 60 * 60_000, 7 * 24 * 60 * 60_000) } : {}),
    ...(flagValue(args, "max-nudges") ? { maxNudgesPerWork: positiveInteger(flagValue(args, "max-nudges"), "--max-nudges", 3, 100) } : {})
  };
}

function positiveInteger(value: string | undefined, label: string, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > max) {
    throw new BorealError("BOREAL_INVALID_INPUT", `${label} must be an integer between 1 and ${max}`);
  }
  return parsed;
}

function optionalStatus(value: string | undefined): OrchestrationStatus | undefined {
  if (value === undefined || value === "all") return undefined;
  if (!ORCHESTRATION_STATUSES.has(value as OrchestrationStatus)) {
    throw new BorealError("BOREAL_INVALID_INPUT", "--status must be active, paused, needs_attention, succeeded, failed, cancelled, or all");
  }
  return value as OrchestrationStatus;
}

function requiredProgressState(value: string): OrchestrationProgressState {
  if (!PROGRESS_STATES.has(value as OrchestrationProgressState)) {
    throw new BorealError("BOREAL_INVALID_INPUT", "--state must be working, waiting, blocked, or completed");
  }
  return value as OrchestrationProgressState;
}

function requiredNudgeKind(value: string): OrchestrationNudgeKind {
  if (!NUDGE_KINDS.has(value as OrchestrationNudgeKind)) {
    throw new BorealError("BOREAL_INVALID_INPUT", "--kind must be heartbeat, checkpoint, scope, blocked, or replan");
  }
  return value as OrchestrationNudgeKind;
}

function asOrchestrationId(value: string): OrchestrationId {
  if (!/^bw_orchestration_[a-f0-9]{12,64}$/u.test(value)) {
    throw new BorealError("BOREAL_INVALID_INPUT", `Expected an orchestration id, got ${value}`);
  }
  return value as OrchestrationId;
}
