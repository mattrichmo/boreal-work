import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { BorealError } from "@boreal/core";

import { flagValue, hasFlag, type ParsedArgs } from "../args.js";
import { type CliContext } from "../context.js";
import {
  installSkillsFromPlanAtomically,
  type InstallProvenance,
  type SkillInstallTransactionInput
} from "./install.js";
import { formatRecord, type CliOutput } from "../output.js";
import { readProjectSetupConfig } from "../project-setup.js";
import { migrateStorage, type StorageMigrationResult } from "../storage-migrate.js";
import { getVersionInfo, type VersionInfo } from "../version.js";
import { BINARY_IDENTITY_SCHEMA_VERSION, type BinaryIdentity } from "../install-status.js";
import { buildSkillInstallPlan, type SkillInstallPlan } from "../workflow-assets.js";
import type { CommandResult } from "./shared.js";

const DEFAULT_UPDATE_REPO_URL = "https://github.com/mattrichmo/boreal-work.git";

export interface UpdateSelfResult {
  readonly updated: boolean;
  readonly dryRun: boolean;
  readonly transactionId: string;
  readonly repoUrl: string;
  readonly ref?: string;
  readonly installedVersion?: string;
  readonly previousVersion: string;
  readonly binPath: string;
  readonly stagedIdentity?: BinaryIdentity;
  readonly installedIdentity?: BinaryIdentity;
  readonly verification: {
    readonly staged: boolean;
    readonly installed: boolean;
  };
  readonly rollback: {
    readonly available: boolean;
    readonly performed: boolean;
  };
  readonly steps: readonly UpdateStep[];
}

export interface UpdateRepoResult {
  readonly dryRun: boolean;
  readonly transactionId: string;
  readonly workspaceRoot: string;
  readonly storage: { readonly migrated: boolean; readonly planned?: boolean; readonly from?: string; readonly to?: string; readonly rollback?: unknown };
  readonly skillInstalls: readonly {
    readonly target: string;
    readonly installRoot: string;
    readonly written: number;
    readonly planned?: number;
    readonly issues: number;
    readonly provenance?: InstallProvenance;
  }[];
  readonly provenance: {
    readonly actor: { readonly pid: number; readonly cwd: string };
    readonly build: ReturnType<typeof getVersionInfo>["build"];
  };
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
      return updateRepoCommand(context, args, output, json);
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
  const dryRun = hasFlag(args, "dry-run");
  const transactionId = randomUUID();
  const binDir = flagValue(args, "bin-dir") ?? process.env.BOREAL_INSTALL_BIN_DIR;
  const libDir = flagValue(args, "lib-dir") ?? process.env.BOREAL_INSTALL_LIB_DIR;
  const binPath = join(binDir ?? join(homedir(), ".local", "bin"), "bwrk");
  const previousIdentity = await captureBinaryIdentity(binPath).catch(() => undefined);
  const previousVersion = previousIdentity?.version ?? getVersionInfo().version;
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
    steps.push(await runStep("fetch", "git", cloneArgs, process.cwd(), json, {}, transactionId));
    progress("Installing build dependencies ...");
    steps.push(await runStep("dependencies", "pnpm", ["install", "--frozen-lockfile", "--silent"], stageDir, json, {}, transactionId));
    progress("Building bwrk bundle ...");
    steps.push(await runStep("build", "pnpm", ["build"], stageDir, json, {}, transactionId));
    const stagedPath = join(stageDir, "apps", "cli", "dist", "index.js");
    const stagedIdentity = await captureBinaryIdentity(stagedPath, stageDir, true);
    progress(dryRun ? "Dry run: skipping machine install ..." : "Installing machine binary ...");
    if (!dryRun) {
      steps.push(
        await runStep("install", "bash", ["install.sh", "--machine"], stageDir, json, {
          ...(binDir ? { BOREAL_INSTALL_BIN_DIR: binDir } : {}),
          ...(libDir ? { BOREAL_INSTALL_LIB_DIR: libDir } : {}),
          BOREAL_INSTALL_TRANSACTION_ID: transactionId,
          BOREAL_INSTALL_PROVENANCE_OPERATION: "update.self",
          BOREAL_INSTALL_SOURCE_REPO_URL: repoUrl,
          ...(ref ? { BOREAL_INSTALL_SOURCE_REF: ref } : {})
        }, transactionId)
      );
    }

    const installedIdentity = dryRun ? undefined : await captureBinaryIdentity(binPath);
    if (!dryRun && !installedIdentity) {
      throw new BorealError("BOREAL_STORAGE_ERROR", "Updated bwrk binary did not return a machine-readable identity", {
        transactionId,
        binPath
      });
    }
    const result: UpdateSelfResult = {
      updated: !dryRun,
      dryRun,
      transactionId,
      repoUrl,
      ref,
      installedVersion: installedIdentity?.version,
      previousVersion,
      binPath,
      stagedIdentity,
      installedIdentity,
      verification: { staged: true, installed: Boolean(installedIdentity) },
      rollback: { available: true, performed: false },
      steps
    };
    output.write(json ? formatRecord(result, true) : formatUpdateSelf(result));
    return { exitCode: 0 };
  } finally {
    await rm(stageDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function updateRepoCommand(context: CliContext, args: ParsedArgs, output: CliOutput, json: boolean): Promise<CommandResult> {
  const dryRun = hasFlag(args, "dry-run");
  const transactionId = randomUUID();
  const startedAt = new Date().toISOString();
  let migration: StorageMigrationResult | undefined;
  if (!dryRun && context.storage !== "objects-v1") {
    migration = await migrateStorage(context, "objects");
  }

  const config = await readProjectSetupConfig(context.workspaceRoot);
  const skillInstalls: Array<UpdateRepoResult["skillInstalls"][number]> = [];
  for (const root of config?.skillInstallRoots ?? []) {
    const plan: SkillInstallPlan = await buildSkillInstallPlan({
      target: root.target,
      dryRun,
      installRoot: root.installRoot,
      workspaceRoot: context.workspaceRoot
    });
    if (dryRun) {
      skillInstalls.push({
        target: root.target,
        installRoot: root.installRoot,
        written: 0,
        planned: plan.files.length,
        issues: plan.issues.length
      });
    } else {
      const applied = await installSkillsFromPlanAtomically(plan, {
        transactionId,
        operation: "update.repo",
        startedAt
      } satisfies SkillInstallTransactionInput);
      skillInstalls.push({
        target: root.target,
        installRoot: root.installRoot,
        written: applied.files.length,
        issues: applied.issues.length,
        provenance: applied.provenance
      });
    }
  }

  const result: UpdateRepoResult = {
    dryRun,
    transactionId,
    workspaceRoot: context.workspaceRoot,
    storage: migration
      ? { migrated: true, from: migration.from, to: migration.to, rollback: migration.rollback }
      : { migrated: false, ...(dryRun && context.storage !== "objects-v1" ? { planned: true } : {}), to: context.storage },
    skillInstalls,
    provenance: { actor: { pid: process.pid, cwd: process.cwd() }, build: getVersionInfo().build },
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
  extraEnv: Record<string, string> = {},
  transactionId?: string
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
          error: error.message,
          ...(transactionId ? { transactionId } : {})
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
          stderr: stderr.slice(-2000),
          ...(transactionId ? { transactionId } : {})
        })
      );
    });
  });
}

function captureCommand(command: string, commandArgs: readonly string[], cwd = process.cwd(), json = false): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, commandArgs, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < 1_000_000) {
        stdout += chunk.toString().slice(0, 1_000_000 - stdout.length);
      }
    });
    child.on("error", (error) =>
      rejectPromise(
        new BorealError("BOREAL_STORAGE_ERROR", "Installed bwrk binary did not respond after update", {
          command,
          error: error.message,
          json
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
          exitCode: code,
          json
        })
      );
    });
  });
}

async function captureBinaryIdentity(
  executable: string,
  cwd = process.cwd(),
  javascriptEntrypoint = false
): Promise<BinaryIdentity> {
  const command = javascriptEntrypoint ? process.execPath : executable;
  const args = javascriptEntrypoint
    ? [executable, "--no-delegate", "--version", "--json"]
    : ["--no-delegate", "--version", "--json"];
  const stdout = await captureCommand(command, args, cwd, true);
  try {
    const parsed = JSON.parse(stdout) as { readonly data?: unknown };
    if (!isRecord(parsed.data)) {
      throw new Error("missing data envelope");
    }
    const data = parsed.data;
    if (typeof data.name !== "string" || typeof data.version !== "string" || typeof data.installChannel !== "string") {
      throw new Error("missing version identity fields");
    }
    const build = parseBuildIdentity(data.build);
    return {
      schemaVersion: BINARY_IDENTITY_SCHEMA_VERSION,
      name: data.name,
      version: data.version,
      installChannel: data.installChannel,
      executable,
      ...(build ? { build } : {})
    };
  } catch (error) {
    throw new BorealError("BOREAL_STORAGE_ERROR", "Binary identity verification returned invalid JSON", {
      executable,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseBuildIdentity(value: unknown): VersionInfo["build"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const requiredStrings = ["semanticVersion", "buildSha", "artifactDigest", "agentAssetDigest"];
  const requiredNumbers = ["protocolEpoch", "writerEpoch", "readerEpoch", "cacheEpoch"];
  if (
    !requiredStrings.every((key) => typeof value[key] === "string") ||
    !requiredNumbers.every((key) => typeof value[key] === "number")
  ) {
    return undefined;
  }
  return {
    semanticVersion: value.semanticVersion as string,
    buildSha: value.buildSha as string,
    artifactDigest: value.artifactDigest as string,
    protocolEpoch: value.protocolEpoch as number,
    writerEpoch: value.writerEpoch as number,
    readerEpoch: value.readerEpoch as number,
    cacheEpoch: value.cacheEpoch as number,
    agentAssetDigest: value.agentAssetDigest as string
  };
}

function formatUpdateSelf(result: UpdateSelfResult): string {
  const lines = [
    `${result.dryRun ? "Planned bwrk machine update" : "Updated bwrk machine install"} from ${result.repoUrl}${result.ref ? ` (${result.ref})` : ""}`,
    `  transaction: ${result.transactionId}`,
    `  previous: ${result.previousVersion}`,
    `  installed: ${result.installedVersion ?? "unknown"}`,
    `  binary: ${result.binPath}`,
    `  staged build: ${result.stagedIdentity?.build?.buildSha ?? "unknown"}`,
    `  verification: staged=${result.verification.staged ? "passed" : "failed"}, installed=${result.verification.installed ? "passed" : "not run"}`,
    `  rollback available: ${result.rollback.available ? "yes" : "no"}`,
    ...result.steps.map((step) => `  ${step.ok ? "ok" : "failed"} ${step.step} (${Math.round(step.durationMs / 100) / 10}s)`)
  ];
  return `${lines.join("\n")}\n`;
}

function formatUpdateRepo(result: UpdateRepoResult): string {
  const lines = [
    `${result.dryRun ? "Planned Boreal asset update" : "Updated Boreal assets"} in ${result.workspaceRoot}`,
    `  transaction: ${result.transactionId}`,
    result.storage.migrated
      ? `  storage: migrated ${result.storage.from} -> ${result.storage.to}`
      : `  storage: already ${result.storage.to}`,
    ...result.skillInstalls.map(
      (install) => `  skills[${install.target}]: ${result.dryRun ? `${install.planned ?? 0} planned` : `${install.written} installed`} at ${install.installRoot}${install.issues > 0 ? ` (${install.issues} issue(s))` : ""}`
    ),
    ...(result.skillInstalls.length === 0 ? ["  skills: no recorded install roots (run `bwrk install` to configure)"] : []),
    `  next: ${result.nextCommand}`
  ];
  return `${lines.join("\n")}\n`;
}
