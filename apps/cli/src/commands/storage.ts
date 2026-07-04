import { BorealError } from "@boreal/core";

import { requiredFlag, type ParsedArgs } from "../args.js";
import type { CliContext } from "../context.js";
import { formatRecord, type CliOutput } from "../output.js";
import { migrateStorage } from "../storage-migrate.js";
import type { CommandResult } from "./shared.js";

export async function storageCommand(
  action: string | undefined,
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  switch (action) {
    case "migrate": {
      const to = requiredFlag(args, "to");
      if (to !== "objects" && to !== "file") {
        throw new BorealError("BOREAL_INVALID_INPUT", "--to must be objects or file", { to });
      }
      output.write(formatRecord(await migrateStorage(context, to), json));
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown storage command: ${action ?? ""}`);
  }
}
