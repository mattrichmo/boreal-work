import { BorealError } from "@boreal/core";

import type { ParsedArgs } from "../args.js";
import type { CliContext } from "../context.js";
import { formatRecord, type CliOutput } from "../output.js";
import { inspectProjectRollup, readProjectRollupDocument } from "../rollup.js";
import type { CommandResult } from "./shared.js";

export async function rollupCommand(
  action: string | undefined,
  context: CliContext,
  _args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  switch (action) {
    case "show": {
      const inspection = await inspectProjectRollup(context);
      const ok = inspection.exists && !inspection.stale && !inspection.error;
      const rollup = ok ? await readProjectRollupDocument(context) : null;
      const result = {
        schemaVersion: "boreal.cli.rollup.show.v1",
        ok,
        inspection,
        rollup
      };
      output.write(json ? formatRecord(result, true) : formatRecord(result, false));
      return { exitCode: ok ? 0 : 1 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown rollup command: ${action ?? ""}`);
  }
}
