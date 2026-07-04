import { BorealError } from "@boreal/core";

import type { CliContext } from "../context.js";
import { formatRecord, type CliOutput } from "../output.js";
import { initVault, inspectVault } from "../vault.js";
import {
  assertCircuitBreakerAllows,
  recordCircuitBreakerFailure,
  recordCircuitBreakerSuccess,
  type CommandResult
} from "./shared.js";

export async function vaultCommand(
  action: string | undefined,
  context: CliContext,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  switch (action) {
    case "init": {
      await assertCircuitBreakerAllows(context, "vault init");
      try {
        const result = await initVault(context);
        await recordCircuitBreakerSuccess(context, "vault init");
        output.write(formatRecord(result, json));
      } catch (error) {
        await recordCircuitBreakerFailure(context, "vault init", error);
        throw error;
      }
      return { exitCode: 0 };
    }
    case "status": {
      const status = await inspectVault(context);
      output.write(formatRecord(status, json));
      return { exitCode: status.ok ? 0 : 1 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown vault command: ${action ?? ""}`);
  }
}
