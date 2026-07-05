import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BorealError } from "@boreal/core";

import { flagValue, type ParsedArgs } from "../args.js";
import { type CliContext } from "../context.js";
import { formatRecord, type CliOutput } from "../output.js";
import { readProjectSetupConfig } from "../project-setup.js";
import { migrateStorage, type StorageMigrationResult } from "../storage-migrate.js";
import { getVersionInfo } from "../version.js";
import { buildSkillInstallPlan, installSkillsFromPlan, type SkillInstallPlan } from "../workflow-assets.js";
import type { CommandResult } from "./shared.js";

const DEFAULT_UPDATE_REPO_URL = "https://github.com/mattrichmo/boreal-work.git";

export interface UpdateSelfResult {
  readonly updated: boolean;
  readonly repoUrl: string;
  readonly ref?: string;
  readonly installedVersion?: string;
  readonly previousVersion: string;
  readonly binPath: string;
  readonly steps: readonly UpdateStep[];
}

export interface UpdateRepoResult {
  readonly workspaceRoot: string;
  readonly storage: { readonly migrated: boolean; readonly from?: string; readonly to?: string };
  readonly skillInstalls: readonly { readonly target: string; readonly installRoot: string; readonly written: number; readonly issues: number }[];
  readonly nextCommand?: string;
}

interface UpdateStep {
  readonly step: string;
  readonly command: string;
  readonly ok: boolean;
  readonly durationMs: number;
}

export async function updateCommand(
  action: string | undefined,
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  switch (action) {
    case "self":
      return updateSelfCommand(args, output, json);
    case "repo":
      return updateRepoCommand(context, output, json);
    default:
      throw new BorealError(
        "BOREAL_INVALID_INPUT",
        "Unknown update command; use `bwrk update self` (upgrade the machine install from GitHub) or `bwrk update repo` (migrate storage and refresh installed skills in this repo)",
        { action: action ?? "" }
      );
  }
}

async function updateSelfCommand(args: ParsedArgs, output: CliOutput, json: boolean): Promise<CommandResult> {
  const repoUrl = flagValue(args, "repo-url") ?? process.env.BOREAL_UPDATE_REPO_URL ?? DEFAULT_UPDATE_REPO_URL;
  const ref = flagValue(args, "ref");
  const previousVersion = getVersionInfo().version;
  const binDir = flagValue(args, "bin-dir") ?? process.env.BOREAL_INSTALL_BIN_DIR;
  const libDir = flagValue(args, "lib-dir") ?? process.env.BOREAL_INSTALL_LIB_DIR;
  const steps: UpdateStep[] = [];
  const stageDir = await mkdtemp(join(tmpdir(), "bwrk-update-"));

  const progress = (line: string) => {
    if (!json) {
      output.write(`${line}\n`);
    }
  };

  try {
    const cloneArgs = ["clone", "--depth", "1", ...(ref ? ["--branch", ref] : []), repoUrl, stageDir];
    progress(`Fetching ${repoUrl}${ref ? ` (${ref})` : ""} ...`);
    steps.push(await runStep("fetch", "git", cloneArgs, process.cwd(), json));
    progress("Installing build dependencies ...");
    steps.push(await runStep("dependencies", "pnpm", ["install", "--frozen-lockfile", "--silent"], stageDir, json));
    progress("Building bwrk bundle ...");
    steps.push(await runStep("build", "pnpm", ["build"], stageDir, json));
    progress("Installing machine binary ...");
    steps.push(
      await runStep("install", "bash", ["install.sh", "--machine"], stageDir, json, {
        ...(binDir ? { BOREAL_INSTALL_BIN_DIR: binDir } : {}),
        ...(libDir ? { BOREAL_INSTALL_LIB_DIR: libDir } : {})
      })
    );

    const binPath = join(binDir ?? join(process.env.HOME ?? "~", ".local", "bin"), "bwrk");
    const version = await captureCommand(binPath, ["--version", "--no-delegate"]);
    const result: UpdateSelfResult = {
      updated: true,
      repoUrl,
      ref,
      installedVersion: version.trim(),
      previousVersion,
      binPath,
      steps
    };
    output.write(json ? formatRecord(result, true) : formatUpdateSelf(result));
    return { exitCode: 0 };
  } finally {
    await rm(stageDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function updateRepoCommand(context: CliContext, output: CliOutput, json: boolean): Promise<CommandResult> {
  let migration: StorageMigrationResult | undefined;
  if (context.storage !== "objects-v1") {
    migration = await migrateStorage(context, "objects");
  }

  const config = await readProjectSetupConfig(context.workspaceRoot);
  const skillInstalls: Array<UpdateRepoResult["skillInstalls"][number]> = [];
  for (const root of config?.skillInstallRoots ?? []) {
    const plan: SkillInstallPlan = await buildSkillInstallPlan({
      target: root.target,
      dryRun: false,
      installRoot: root.installRoot,
      workspaceRoot: context.workspaceRoot
    });
    const applied = await installSkillsFromPlan(plan);
    skillInstalls.push({
      target: root.target,
      installRoot: root.installRoot,
      written: applied.files.length,
      issues: applied.issues.length
    });
  }

  const result: UpdateRepoResult = {
    workspaceRoot: context.workspaceRoot,
    storage: migration
      ? { migrated: true, from: migration.from, to: migration.to }
      : { migrated: false, to: context.storage },
    skillInstalls,
    nextCommand: "bwrk sync refresh --json"
  };
  output.write(json ? formatRecord(result, true) : formatUpdateRepo(result));
  const hasIssues = skillInstalls.some((install) => install.issues > 0);
  return { exitCode: hasIssues ? 1 : 0 };
}

function runStep(
  step: string,
  command: string,
  commandArgs: readonly string[],
  cwd: string,
  json: boolean,
  extraEnv: Record<string, string> = {}
): Promise<UpdateStep> {
  const startedAt = Date.now();
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, commandArgs, {
      cwd,
      env: { ...process.env, ...extraEnv },
      stdio: json ? ["ignore", "ignore", "pipe"] : ["ignore", "ignore", "inherit"]
    });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      rejectPromise(
        new BorealError("BOREAL_STORAGE_ERROR", `bwrk update could not run ${command}`, {
          step,
          command: `${command} ${commandArgs.join(" ")}`,
          error: error.message
        })
      );
    });
    child.on("close", (code) => {
      const durationMs = Date.now() - startedAt;
      if (code === 0) {
        resolvePromise({ step, command: `${command} ${commandArgs.join(" ")}`, ok: true, durationMs });
        return;
      }
      rejectPromise(
        new BorealError("BOREAL_STORAGE_ERROR", `bwrk update step failed: ${step}`, {
          step,
          command: `${command} ${commandArgs.join(" ")}`,
          exitCode: code,
          stderr: stderr.slice(-2000)
        })
      );
    });
  });
}

function captureCommand(command: string, commandArgs: readonly string[]): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, commandArgs, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.on("error", (error) =>
      rejectPromise(
        new BorealError("BOREAL_STORAGE_ERROR", "Installed bwrk binary did not respond after update", {
          command,
          error: error.message
        })
      )
    );
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise(stdout);
        return;
      }
      rejectPromise(
        new BorealError("BOREAL_STORAGE_ERROR", "Installed bwrk binary exited non-zero after update", {
          command,
          exitCode: code
        })
      );
    });
  });
}

function formatUpdateSelf(result: UpdateSelfResult): string {
  const lines = [
    `Updated bwrk machine install from ${result.repoUrl}${result.ref ? ` (${result.ref})` : ""}`,
    `  previous: ${result.previousVersion}`,
    `  installed: ${result.installedVersion ?? "unknown"}`,
    `  binary: ${result.binPath}`,
    ...result.steps.map((step) => `  ${step.ok ? "ok" : "failed"} ${step.step} (${Math.round(step.durationMs / 100) / 10}s)`)
  ];
  return `${lines.join("\n")}\n`;
}

function formatUpdateRepo(result: UpdateRepoResult): string {
  const lines = [
    `Updated Boreal assets in ${result.workspaceRoot}`,
    result.storage.migrated
      ? `  storage: migrated ${result.storage.from} -> ${result.storage.to}`
      : `  storage: already ${result.storage.to}`,
    ...result.skillInstalls.map(
      (install) => `  skills[${install.target}]: ${install.written} installed at ${install.installRoot}${install.issues > 0 ? ` (${install.issues} issue(s))` : ""}`
    ),
    ...(result.skillInstalls.length === 0 ? ["  skills: no recorded install roots (run `bwrk install` to configure)"] : []),
    `  next: ${result.nextCommand}`
  ];
  return `${lines.join("\n")}\n`;
}
