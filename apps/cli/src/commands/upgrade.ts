import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
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

  if (runMachine) {
    const machine = await runSelfUpdate(context, args, output);
    steps.push(machine.step);
    if (!json) {
      const data = machine.step.data as { readonly dryRun?: boolean; readonly updated?: boolean };
      output.write(data.dryRun ? "Machine update planned.\n" : data.updated ? "Boreal updated successfully.\n" : "Boreal is already up to date.\n");
    }

    // Once the machine install succeeds, run the freshly installed executable
    // for the project update. This prevents the old process from continuing
    // to mutate project assets after it has replaced its own binary.
    if (runProject && hasFlag(args, "dry-run")) {
      if (!json) output.write("Planning project asset update...\n");
      steps.push(await runUpdate("repo", context, args, output, json));
    } else if (runProject) {
      if (!json) output.write("Updating project assets...\n");
      steps.push(await runInstalledRepoUpdate(machine.binPath, context, args));
      if (!json) output.write("Project assets refreshed.\n");
    }
  } else if (runProject) {
    // Explicit project-only updates remain in-process by design.
    steps.push(await runUpdate("repo", context, args, output, json));
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

async function runSelfUpdate(
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput
): Promise<{ readonly step: UpgradeStep; readonly binPath: string }> {
  let stdout = "";
  const captured: CliOutput = {
    write(value) {
      stdout += value;
    },
    error(value) {
      output.error(value);
    }
  };
  const result = await updateCommand("self", context, { command: ["update", "self"], flags: args.flags }, captured, true);
  if (result.exitCode !== 0) {
    throw new BorealError("BOREAL_STORAGE_ERROR", "Machine update failed", { exitCode: result.exitCode });
  }
  const data = parseUpdateData(stdout, "self") as { readonly binPath?: unknown };
  if (typeof data.binPath !== "string" || data.binPath.length === 0) {
    throw new BorealError("BOREAL_INVARIANT", "bwrk upgrade received no installed machine binary path");
  }
  return { step: { scope: "machine", exitCode: 0, data }, binPath: data.binPath };
}

async function runInstalledRepoUpdate(
  binPath: string,
  context: CliContext,
  args: ParsedArgs
): Promise<UpgradeStep> {
  const commandArgs = ["--no-delegate", "update", "repo", "--workspace", context.workspaceRoot, "--json"];
  if (hasFlag(args, "skip-skills")) commandArgs.push("--skip-skills");
  const result = await captureInstalledCommand(binPath, commandArgs, context.cwd);
  if (result.exitCode !== 0) {
    throw new BorealError("BOREAL_STORAGE_ERROR", "Installed bwrk project update failed", {
      binPath,
      exitCode: result.exitCode,
      stderr: result.stderr.slice(-2000)
    });
  }
  return { scope: "project", exitCode: 0, data: parseUpdateData(result.stdout, "repo") };
}

function parseUpdateData(text: string, action: string): unknown {
  try {
    const envelope = JSON.parse(text) as { readonly ok?: unknown; readonly data?: unknown };
    if (envelope.ok === false || typeof envelope.data !== "object" || envelope.data === null) {
      throw new Error("missing data envelope");
    }
    return envelope.data;
  } catch {
    throw new BorealError("BOREAL_INVARIANT", `bwrk upgrade received invalid JSON from update ${action}`);
  }
}

function captureInstalledCommand(
  executable: string,
  commandArgs: readonly string[],
  cwd: string
): Promise<{ readonly exitCode: number; readonly stdout: string; readonly stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, commandArgs, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const limit = 1_000_000;
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < limit) stdout += chunk.toString().slice(0, limit - stdout.length);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < limit) stderr += chunk.toString().slice(0, limit - stderr.length);
    });
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new BorealError("BOREAL_STORAGE_ERROR", "Installed bwrk binary timed out", {
        executable,
        timeoutMs: INSTALLED_UPDATE_TIMEOUT_MS
      }));
    }, INSTALLED_UPDATE_TIMEOUT_MS);
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new BorealError("BOREAL_STORAGE_ERROR", "Installed bwrk binary could not be run", {
        executable,
        error: error.message
      }));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

const INSTALLED_UPDATE_TIMEOUT_MS = 30_000;

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
  const data = parseUpdateData(text, action);
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
