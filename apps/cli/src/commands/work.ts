import { BorealError, type WorkId } from "@boreal/core";

import { type ParsedArgs } from "../args.js";
import type { CliContext } from "../context.js";
import { formatRecord, table, type CliOutput } from "../output.js";
import type { CommandResult } from "./shared.js";

type WorkCommandGroup = "dep";

export interface WorkCommandDependencies {
  readonly dependencyTypeFromArgs: (args: ParsedArgs) => string;
  readonly resolveWorkId: (context: CliContext, value: string, options?: { readonly agentId?: string }) => Promise<WorkId>;
  readonly requiredPositional: (values: readonly string[], index: number, label: string) => string;
  readonly dependencyTreeForWork: (workId: WorkId, workItems: readonly unknown[], graphEdges: readonly unknown[]) => unknown;
  readonly formatRecordWithAgentDirectives: (
    context: CliContext,
    args: ParsedArgs,
    value: unknown,
    json: boolean,
    options?: { readonly subjectWorkId?: WorkId }
  ) => Promise<string>;
  readonly dependencyTreeRows: (tree: unknown) => readonly Record<string, string | number | undefined>[];
  readonly dependencyCyclesFromGraph: (graphEdges: readonly unknown[]) => readonly { readonly cycle: readonly string[] }[];
}

export async function workCommand(
  group: WorkCommandGroup,
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean,
  dependencies: WorkCommandDependencies
): Promise<CommandResult> {
  switch (group) {
    case "dep":
      return depCommand(action, rest, context, args, output, json, dependencies);
  }
}

async function depCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean,
  dependencies: WorkCommandDependencies
): Promise<CommandResult> {
  switch (action) {
    case "add": {
      const type = dependencies.dependencyTypeFromArgs(args);
      const blockedWorkId = await dependencies.resolveWorkId(context, dependencies.requiredPositional(rest, 0, "dependent work reference"));
      const blockingWorkId = await dependencies.resolveWorkId(context, dependencies.requiredPositional(rest, 1, "dependency work reference"));
      const work = await context.runtime.addBlockingDependency({ blockedWorkId, blockingWorkId });
      output.write(formatRecord({ type, work }, json));
      return { exitCode: 0 };
    }
    case "remove": {
      const type = dependencies.dependencyTypeFromArgs(args);
      const blockedWorkId = await dependencies.resolveWorkId(context, dependencies.requiredPositional(rest, 0, "dependent work reference"));
      const blockingWorkId = await dependencies.resolveWorkId(context, dependencies.requiredPositional(rest, 1, "dependency work reference"));
      const work = await context.runtime.removeBlockingDependency({ blockedWorkId, blockingWorkId });
      output.write(formatRecord({ type, work }, json));
      return { exitCode: 0 };
    }
    case "tree": {
      const workId = await dependencies.resolveWorkId(context, dependencies.requiredPositional(rest, 0, "work reference"));
      const tree = await context.store.read(async (reader) =>
        dependencies.dependencyTreeForWork(workId, await reader.listWorkItems(), await reader.listGraphEdges())
      );
      output.write(json ? await dependencies.formatRecordWithAgentDirectives(context, args, tree, true, { subjectWorkId: workId }) : table(dependencies.dependencyTreeRows(tree)));
      return { exitCode: 0 };
    }
    case "cycles": {
      const cycles = await context.store.read(async (reader) => dependencies.dependencyCyclesFromGraph(await reader.listGraphEdges()));
      output.write(
        json
          ? formatRecord(cycles, true)
          : table(cycles.map((cycle, index) => ({ cycle: index + 1, path: cycle.cycle.join(" -> ") })))
      );
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown dep command: ${action ?? ""}`);
  }
}
