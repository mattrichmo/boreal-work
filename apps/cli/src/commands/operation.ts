import { BorealError, type RuntimeOperation, type RuntimeOperationStatus } from "@boreal/core";

import { flagValue, hasFlag, type ParsedArgs } from "../args.js";
import type { CliContext } from "../context.js";
import { formatRecord, table, type CliOutput } from "../output.js";
import type { CommandResult } from "./shared.js";

export interface OperationCommandDependencies {
  readonly defaultListLimit: number;
  readonly optionalSessionId: (value: string | undefined) => string | undefined;
  readonly optionalCommandPath: (value: string | undefined) => string | undefined;
  readonly parseOperationStatus: (value: string | undefined) => RuntimeOperationStatus | undefined;
  readonly parseLimit: (value: string | undefined, options?: { readonly max?: number }) => number | undefined;
  readonly compareOperationsNewestFirst: (left: RuntimeOperation, right: RuntimeOperation) => number;
  readonly operationListRow: (operation: RuntimeOperation) => unknown;
  readonly textOperationListRow: (row: unknown) => Record<string, string>;
  readonly requiredPositional: (values: readonly string[], index: number, label: string) => string;
  readonly resolveOperation: (context: CliContext, value: string) => Promise<RuntimeOperation>;
  readonly operationStats: (context: CliContext, args: ParsedArgs) => Promise<unknown>;
  readonly pruneOperations: (context: CliContext, args: ParsedArgs) => Promise<unknown>;
  readonly repairOperationLinks: (context: CliContext, dryRun: boolean) => Promise<unknown>;
}

export async function operationCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean,
  dependencies: OperationCommandDependencies
): Promise<CommandResult> {
  switch (action) {
    case "list": {
      const sessionId = dependencies.optionalSessionId(flagValue(args, "session-id"));
      const command = dependencies.optionalCommandPath(flagValue(args, "command"));
      const status = dependencies.parseOperationStatus(flagValue(args, "status"));
      const limit = dependencies.parseLimit(flagValue(args, "limit")) ?? dependencies.defaultListLimit;
      const rows = await context.store.read(async (reader) => {
        const operations = await reader.listOperations();
        return [...operations]
          .filter((operation) => !sessionId || operation.sessionId === sessionId)
          .filter((operation) => !command || operation.commandPath === command)
          .filter((operation) => !status || operation.status === status)
          .sort(dependencies.compareOperationsNewestFirst)
          .slice(0, limit)
          .map(dependencies.operationListRow);
      });
      output.write(json ? formatRecord(rows, true) : table(rows.map(dependencies.textOperationListRow)));
      return { exitCode: 0 };
    }
    case "show": {
      const operation = await dependencies.resolveOperation(context, dependencies.requiredPositional(rest, 0, "operation id"));
      output.write(formatRecord(operation, json));
      return { exitCode: 0 };
    }
    case "stats": {
      output.write(formatRecord(await dependencies.operationStats(context, args), json));
      return { exitCode: 0 };
    }
    case "prune": {
      output.write(formatRecord(await dependencies.pruneOperations(context, args), json));
      return { exitCode: 0 };
    }
    case "repair": {
      output.write(formatRecord(await dependencies.repairOperationLinks(context, hasFlag(args, "dry-run")), json));
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown operation command: ${action ?? ""}`);
  }
}
