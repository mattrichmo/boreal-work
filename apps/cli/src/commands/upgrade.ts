import { existsSync } from "node:fs";
import { join } from "node:path";

import { BorealError } from "@boreal/core";

import { hasFlag, type ParsedArgs } from "../args.js";
import type { CliContext } from "../context.js";
import { formatRecord, type CliOutput } from "../output.js";
import { updateCommand } from "./update.js";
import type { CommandResult } from "./shared.js";

interface UpgradeStep {
  readonly scope: "machine" | "project";
  readonly exitCode: number;
  readonly data?: unknown;
}

export async function upgradeCommand(
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  validateUpgradeScope(args);
  const machineOnly = hasFlag(args, "machine");
  const projectOnly = hasFlag(args, "project");

  const projectAvailable = workspaceIsInitialized(context);
  if (projectOnly && !projectAvailable) {
    throw new BorealError("BOREAL_INVALID_INPUT", "No initialized Boreal project found; run `bwrk setup` first", {
      workspaceRoot: context.workspaceRoot
    });
  }

  const runProject = projectOnly || (!machineOnly && projectAvailable);
  const runMachine = machineOnly || !projectOnly;
  const steps: UpgradeStep[] = [];

  // Project assets are refreshed before the machine binary so a single process
  // never tries to use the newly-installed binary halfway through the upgrade.
  if (runProject) {
    steps.push(await runUpdate("repo", context, args, output, json));
  }
  if (runMachine) {
    steps.push(await runUpdate("self", context, args, output, json));
  }

  if (json) {
    output.write(
      formatRecord(
        {
          schemaVersion: "boreal.cli.upgrade.v1",
          workspaceRoot: context.workspaceRoot,
          machine: steps.find((step) => step.scope === "machine")?.data,
          project: steps.find((step) => step.scope === "project")?.data,
          steps: steps.map(({ scope, exitCode }) => ({ scope, exitCode })),
          recommendedActions: runProject ? ["bwrk sync refresh --json", "bwrk doctor --strict --json"] : []
        },
        true
      )
    );
  }

  return { exitCode: steps.some((step) => step.exitCode !== 0) ? 1 : 0 };
}

export function validateUpgradeScope(args: ParsedArgs): void {
  if (hasFlag(args, "machine") && hasFlag(args, "project")) {
    throw new BorealError("BOREAL_INVALID_INPUT", "bwrk upgrade cannot combine --machine and --project");
  }
}

async function runUpdate(
  action: "self" | "repo",
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<UpgradeStep> {
  if (!json) {
    const result = await updateCommand(action, context, { command: ["update", action], flags: args.flags }, output, false);
    return { scope: action === "self" ? "machine" : "project", exitCode: result.exitCode };
  }

  let text = "";
  const capturedOutput: CliOutput = {
    write(value) {
      text += value;
    },
    error(value) {
      output.error(value);
    }
  };
  const result = await updateCommand(action, context, { command: ["update", action], flags: args.flags }, capturedOutput, true);
  let data: unknown;
  try {
    const envelope = JSON.parse(text) as { readonly data?: unknown };
    data = envelope.data;
  } catch {
    throw new BorealError("BOREAL_INVARIANT", `bwrk upgrade received invalid JSON from update ${action}`);
  }
  return { scope: action === "self" ? "machine" : "project", exitCode: result.exitCode, data };
}

function workspaceIsInitialized(context: CliContext): boolean {
  if (!existsSync(join(context.paths.borealDir, "project.json"))) {
    return false;
  }
  return context.storage === "objects-v1"
    ? existsSync(context.paths.eventLogFile) || existsSync(context.paths.objectsDir)
    : existsSync(context.paths.stateFile);
}
