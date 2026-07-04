import { BorealError } from "@boreal/core";
import type { inspectDaemonStatus } from "@boreal/daemon";

import type { CliContext } from "../context.js";
import { formatRecord, type CliOutput } from "../output.js";
import type { CommandResult } from "./shared.js";

export interface DaemonCommandDependencies {
  readonly inspectDaemonStatus: typeof inspectDaemonStatus;
}

export async function daemonCommand(
  action: string | undefined,
  context: CliContext,
  output: CliOutput,
  json: boolean,
  dependencies: DaemonCommandDependencies
): Promise<CommandResult> {
  switch (action) {
    case "status":
      output.write(formatRecord(await dependencies.inspectDaemonStatus({ workspaceRoot: context.workspaceRoot }), json));
      return { exitCode: 0 };
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown daemon command: ${action ?? ""}`);
  }
}
