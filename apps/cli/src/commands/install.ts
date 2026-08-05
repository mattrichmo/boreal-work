import { randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

import { assertPathInside, BorealError, hashContent, nowIso } from "@boreal/core";
import { writeTextFileAtomic } from "@boreal/storage";

import { flagValue, hasFlag, type ParsedArgs } from "../args.js";
import { box } from "../branding.js";
import { keyValueRows, resultSummary, section, withPromptSession, type CliSelectOption } from "../cli-ui.js";
import { ensureWorkspaceDirs, type CliContext } from "../context.js";
import {
  inspectBorealInstallStatus,
  installStatusHealthy,
  installStatusSummary,
  type InstallStatus
} from "../install-status.js";
import { formatRecord, type CliOutput } from "../output.js";
import {
  applyProjectSetup,
  configuredInstallRootForTarget,
  configuredInstallRootMatchesTarget,
  ensureBorealJsonlMergeDriver,
  formatProjectInstallReview,
  maybeConfigureProjectSetup,
  projectSetupInputFromArgs,
  promptProjectInstallInput,
  readProjectSetupConfig,
  writeProjectStorageMarker,
  validateProjectSetupInput,
  type ProjectSetupInput,
  type ProjectSetupResult
} from "../project-setup.js";
import {
  buildSkillInstallPlan,
  type SkillInstallPlan
} from "../workflow-assets.js";
import { getVersionInfo, type VersionInfo } from "../version.js";
import type { CommandResult } from "./shared.js";

const INSTALL_CONFIRM_OPTIONS: readonly CliSelectOption<"yes" | "no">[] = [
  {
    value: "yes",
    label: "Write files",
    description: "Write the planned skill files to the selected install root."
  },
  {
    value: "no",
    label: "Cancel",
    description: "Leave the filesystem unchanged."
  }
];

interface SkillInstallSummary {
  readonly target: "codex" | "claude" | "skills";
  readonly installRoot: string;
  readonly skillRoot: string;
  readonly fileCount: number;
  readonly provenance: InstallProvenance;
}

export type SkillInstallScope = "project" | "user";

export const INSTALL_PROVENANCE_SCHEMA_VERSION = "boreal.install.provenance.v1";

export interface InstallProvenance {
  readonly schemaVersion: typeof INSTALL_PROVENANCE_SCHEMA_VERSION;
  readonly transactionId: string;
  readonly operation: "install.skills" | "install.setup" | "update.repo";
  readonly status: "planned" | "committed";
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly actor: {
    readonly pid: number;
    readonly cwd: string;
  };
  readonly source: {
    readonly assetRoot: string;
    readonly packageName: string;
    readonly packageVersion: string;
    readonly installChannel: string;
    readonly build: VersionInfo["build"];
  };
  readonly target: {
    readonly kind: "skills";
    readonly target: SkillInstallPlan["target"];
    readonly installRoot: string;
    readonly skillRoot: string;
    readonly scope?: SkillInstallScope;
  };
  readonly files: readonly {
    readonly path: string;
    readonly bytes: number;
    readonly contentHash: string;
  }[];
  readonly verification: {
    readonly checkedFiles: number;
    readonly ok: boolean;
  };
  readonly rollback: {
    readonly available: boolean;
    readonly performed: boolean;
  };
}

export interface AtomicSkillInstallResult extends SkillInstallPlan {
  readonly provenance: InstallProvenance;
}

interface InstallSetupResult {
  readonly kind: "install";
  readonly dryRun: boolean;
  readonly yes: boolean;
  readonly initialized?: boolean;
  readonly workspaceRoot: string;
  readonly eventId?: string;
  readonly plan: {
    readonly projectRoot: string;
    readonly memoryRoot: string;
    readonly memoryLayout: string;
    readonly memoryGitMode: string;
    readonly installRoot: string;
    readonly skillTargets: readonly string[];
    readonly folderScoped: boolean;
  };
  readonly provenance?: {
    readonly transactionId: string;
    readonly operation: "install.setup";
    readonly status: "planned" | "committed";
    readonly startedAt: string;
    readonly finishedAt?: string;
    readonly target: string;
  };
  readonly projectSetup?: ProjectSetupResult;
  readonly skillInstalls?: readonly SkillInstallSummary[];
}

export async function installCommand(
  action: string | undefined,
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  if (action === undefined) {
    return installSetupCommand(context, args, output, json);
  }

  if (action === "status") {
    const status = await inspectBorealInstallStatus({
      workspaceRoot: context.workspaceRoot,
      checkedAt: nowIso(),
      binDir: flagValue(args, "bin-dir"),
      envPath: flagValue(args, "path")
    });
    output.write(json ? formatRecord(status, true) : formatInstallStatus(status));
    return { exitCode: installStatusHealthy(status) ? 0 : 1 };
  }

  const target = installTarget(action);
  const scope = skillInstallScopeFromArgs(args);
  const dryRun = hasFlag(args, "dry-run");
  const interactive = hasFlag(args, "interactive");
  const transactionId = randomUUID();
  const startedAt = nowIso();
  if (interactive && json) {
    throw new BorealError("BOREAL_INVALID_INPUT", "--interactive cannot be combined with --json");
  }
  const plan = await buildSkillInstallPlan({
    target,
    dryRun,
    installRoot: await installRootFromArgs(context, args, target, scope),
    workspaceRoot: context.workspaceRoot
  });
  if (interactive && !dryRun) {
    await confirmSkillInstallPlan(plan, scope);
  }
  const result = dryRun
    ? {
        ...plan,
        provenance: await buildInstallProvenance(plan, {
          transactionId,
          operation: "install.skills",
          status: "planned",
          startedAt,
          scope
        })
      }
    : await installSkillsFromPlanAtomically(plan, {
        transactionId,
        operation: "install.skills",
        startedAt,
        scope
      });
  output.write(json ? formatRecord({ ...result, scope }, true) : formatSkillInstallPlan(result, scope));
  return { exitCode: result.issues.length === 0 ? 0 : 1 };
}

export async function initCommand(
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  await ensureWorkspaceDirs(context);
  const result = await context.runtime.ensureWorkspaceInitialized();
  const storage = await writeProjectStorageMarker(context.workspaceRoot, context.storage);
  const mergeDriver = await ensureBorealJsonlMergeDriver(context.workspaceRoot);
  const projectSetup = await maybeConfigureProjectSetup(context, args);
  const skillInstalls = projectSetup
    ? await installProjectSetupSkills(context, projectSetup, randomUUID(), nowIso())
    : undefined;
  const initResult = {
    initialized: result.initialized,
    workspaceRoot: context.workspaceRoot,
    storage,
    eventId: result.event.meta.id,
    mergeDriver,
    projectSetup,
    skillInstalls
  };
  output.write(json ? formatRecord(initResult, true) : formatInitResult(initResult));
  return { exitCode: 0 };
}

export async function installRootFromArgs(
  context: CliContext,
  args: ParsedArgs,
  target: "codex" | "claude" | "skills",
  scope: SkillInstallScope = "project"
): Promise<string> {
  const explicit = flagValue(args, "install-root");
  if (explicit) {
    return resolveInstallPath(scope === "user" ? homedir() : context.workspaceRoot, explicit);
  }
  if (scope === "user") {
    return defaultUserInstallRoot(target);
  }
  const config = await readProjectSetupConfig(context.workspaceRoot);
  if (config?.installRoot && (target === "skills" || configuredInstallRootMatchesTarget(config.installRoot, target))) {
    return config.installRoot;
  }
  if (config && target !== "skills") {
    const targetRoot = config.skillInstallRoots?.find((entry) => entry.target === target)?.installRoot;
    if (targetRoot) {
      return targetRoot;
    }
  }
  return defaultInstallRoot(context.workspaceRoot, target);
}

export function skillInstallScopeFromArgs(args: ParsedArgs): SkillInstallScope {
  const scope = flagValue(args, "scope") ?? "project";
  if (scope !== "project" && scope !== "user") {
    throw new BorealError("BOREAL_INVALID_INPUT", "--scope must be project or user", { scope });
  }
  return scope;
}

function resolveInstallPath(baseDir: string, value: string): string {
  const expanded = value.replace(/^~(?=$|\/)/u, homedir());
  return resolve(isAbsolute(expanded) ? expanded : join(baseDir, expanded));
}

function defaultUserInstallRoot(target: "codex" | "claude" | "skills"): string {
  return target === "claude" ? join(homedir(), ".claude") : join(homedir(), ".agents");
}

async function installSetupCommand(
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  const yes = hasFlag(args, "yes");
  const explicitDryRun = hasFlag(args, "dry-run");
  const dryRun = explicitDryRun || (json && !yes);
  const explicitInteractive = hasFlag(args, "interactive");
  const interactive = explicitInteractive || (!yes && !dryRun);
  if (yes && explicitDryRun) {
    throw new BorealError("BOREAL_INVALID_INPUT", "bwrk install cannot combine --yes and --dry-run");
  }
  if (yes && explicitInteractive) {
    throw new BorealError("BOREAL_INVALID_INPUT", "bwrk install cannot combine --yes and --interactive");
  }
  if (interactive && json) {
    throw new BorealError("BOREAL_INVALID_INPUT", "--interactive cannot be combined with --json");
  }

  const setupArgs = installSetupArgs(args);
  const input = interactive
    ? await promptProjectInstallInput(context, setupArgs)
    : projectSetupInputFromArgs(context, setupArgs);
  await validateProjectSetupInput(input);
  const plan = installSetupPlan(input);
  const transactionId = randomUUID();
  const startedAt = nowIso();
  if (dryRun) {
    const result: InstallSetupResult = {
      kind: "install",
      dryRun: true,
      yes,
      workspaceRoot: context.workspaceRoot,
      plan,
      provenance: {
        transactionId,
        operation: "install.setup",
        status: "planned",
        startedAt,
        target: input.projectRoot
      }
    };
    output.write(
      json
        ? formatRecord(
            {
              ...result,
              provenance: {
                transactionId,
                operation: "install.setup",
                status: "planned",
                startedAt,
                target: input.projectRoot
              }
            },
            true
          )
        : formatInstallSetupResult(result, input)
    );
    return { exitCode: 0 };
  }

  await ensureWorkspaceDirs(context);
  const initialized = await context.runtime.ensureWorkspaceInitialized();
  const projectSetup = await applyProjectSetup(input);
  const skillInstalls = await installProjectSetupSkills(context, projectSetup, transactionId, startedAt);
  const result: InstallSetupResult = {
    kind: "install",
    dryRun: false,
    yes,
    initialized: initialized.initialized,
    workspaceRoot: context.workspaceRoot,
    eventId: initialized.event.meta.id,
    plan,
    provenance: {
      transactionId,
      operation: "install.setup",
      status: "committed",
      startedAt,
      finishedAt: nowIso(),
      target: input.projectRoot
    },
    projectSetup,
    skillInstalls
  };
  output.write(
    json
      ? formatRecord(
          {
            ...result,
            provenance: {
              transactionId,
              operation: "install.setup",
              status: "committed",
              startedAt,
              finishedAt: nowIso(),
              target: input.projectRoot
            }
          },
          true
        )
      : formatInstallSetupResult(result, input)
  );
  return { exitCode: 0 };
}

function installSetupArgs(args: ParsedArgs): ParsedArgs {
  const flags = new Map<string, string[]>();
  for (const [name, values] of args.flags.entries()) {
    flags.set(name, [...values]);
  }
  if (!flags.has("folder-scoped")) {
    flags.set("folder-scoped", ["true"]);
  }
  return { command: args.command, flags };
}

function installSetupPlan(input: ProjectSetupInput): InstallSetupResult["plan"] {
  return {
    projectRoot: input.projectRoot,
    memoryRoot: input.memoryRoot,
    memoryLayout: input.memoryLayout,
    memoryGitMode: input.memoryGitMode,
    installRoot: input.installRoot,
    skillTargets: input.skillTargets,
    folderScoped: input.folderScoped
  };
}

function formatInstallSetupResult(result: InstallSetupResult, input: ProjectSetupInput): string {
  const title = result.dryRun ? "Boreal install plan" : "Boreal install complete";
  const detail = result.dryRun
    ? "No files were written. Rerun without --dry-run to apply these choices."
    : "Project runtime, memory, Git guards, and project agent skills are ready.";
  const lines = [
    box(["Boreal Install", "Clean local setup for project memory and agent skills"]),
    "",
    resultSummary({ status: result.dryRun ? "pending" : "success", title, detail }),
    "",
    formatProjectInstallReview(input)
  ];
  if (result.projectSetup) {
    lines.push(
      "",
      section(
        "Written",
        [
          `config ${result.projectSetup.configPath}`,
          `memory directories ${result.projectSetup.createdDirectories.length} created, ${result.projectSetup.existingDirectories.length} existing`,
          `memory files ${result.projectSetup.createdFiles.length} created, ${result.projectSetup.existingFiles.length} existing`,
          `project gitignore ${result.projectSetup.gitSetup.projectGitignoreUpdated ? "updated" : "unchanged"}`,
          `memory repo ${result.projectSetup.gitSetup.memoryRepoInitialized ? "initialized" : "already present"}`
        ]
      )
    );
  }
  if (result.skillInstalls && result.skillInstalls.length > 0) {
    lines.push(
      "",
      section(
        "Skills",
        result.skillInstalls.map((install) => `${install.target} ${install.skillRoot} (${install.fileCount} files)`)
      )
    );
  }
  lines.push(
    "",
    section("Next", result.dryRun ? ["rerun bwrk install to apply this plan"] : ["run bwrk prime --json to verify the project"])
  );
  return `${lines.join("\n")}\n`;
}

function installTarget(action: string | undefined): "codex" | "claude" | "skills" {
  if (action === "codex" || action === "claude" || action === "skills") {
    return action;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", `Unknown install command: ${action ?? ""}`);
}

function formatInstallStatus(status: InstallStatus): string {
  const globalProbe = status.globalCommand.probe;
  return [
    resultSummary({
      status: installStatusHealthy(status) ? "success" : "warning",
      title: "bwrk install status",
      detail: installStatusSummary(status)
    }),
    section(
      "Package",
      keyValueRows([
        { key: "name", value: status.package.name },
        { key: "version", value: status.package.version },
        { key: "node", value: status.package.node },
        { key: "packageManager", value: status.package.packageManager ?? "unknown" },
        { key: "installChannel", value: status.package.installChannel },
        { key: "upgrade", value: status.upgrade.command }
      ]).split("\n")
    ),
    section(
      "Local source runner",
      keyValueRows([
        { key: "available", value: status.localSource.available },
        { key: "command", value: status.localSource.command },
        { key: "sourceRoot", value: status.localSource.sourceRoot },
        { key: "packageScript", value: status.localSource.packageScript || "missing" },
        { key: "reason", value: status.localSource.reason ?? "none" }
      ]).split("\n")
    ),
    section(
      "Global command",
      keyValueRows([
        { key: "found", value: status.globalCommand.found },
        { key: "path", value: status.globalCommand.path ?? "not found" },
        { key: "probe", value: globalProbe ? (globalProbe.ok ? "passed" : "failed") : "not run" },
        { key: "versionOutput", value: globalProbe?.stdout || "none" },
        { key: "probeError", value: globalProbe?.error ?? "none" }
      ]).split("\n")
    ),
    section(
      "PATH",
      keyValueRows([
        { key: "shimPath", value: status.localShim.path },
        { key: "shimExecutable", value: status.localShim.executable },
        { key: "binDirOnPath", value: status.path.binDirOnPath },
        { key: "addToPath", value: status.path.addToPathCommand ?? "none" }
      ]).split("\n")
    ),
    section("Recommended actions", status.recommendedActions.length > 0 ? status.recommendedActions : ["none"])
  ].join("\n\n") + "\n";
}

function defaultInstallRoot(workspaceRoot: string, target: "codex" | "claude" | "skills"): string {
  switch (target) {
    case "codex":
      return join(workspaceRoot, ".agents");
    case "claude":
      return join(workspaceRoot, ".claude");
    case "skills":
      return join(workspaceRoot, ".agents", "skills");
  }
}

async function confirmSkillInstallPlan(plan: SkillInstallPlan, scope: SkillInstallScope): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new BorealError("BOREAL_INVALID_INPUT", "--interactive requires a TTY; use --dry-run to review install plans in automation");
  }
  const accepted = await withPromptSession({ input: process.stdin, output: process.stdout }, async (prompt) => {
    prompt.writeIntro("Boreal skill install review", formatSkillInstallPlan(plan, scope));
    return prompt.select("Write install files", INSTALL_CONFIRM_OPTIONS, "yes");
  });
  if (accepted !== "yes") {
    throw new BorealError("BOREAL_INVALID_INPUT", "Skill install cancelled", { reason: "cancelled" });
  }
}

function formatSkillInstallPlan(plan: SkillInstallPlan & { readonly provenance?: InstallProvenance }, scope: SkillInstallScope = "project"): string {
  const summaryStatus = plan.issues.length > 0 ? "warning" : plan.dryRun ? "pending" : "success";
  const fileRows = plan.files.map((file) => {
    const action = plan.dryRun ? "would write" : file.wouldWrite ? "write" : "skip";
    return `${action} ${file.destination} (${file.workflowRefs.length} workflows)`;
  });
  return [
    resultSummary({
      status: summaryStatus,
      title: `${plan.target} skill install ${plan.dryRun ? "plan" : "result"}`,
      detail: `${plan.files.length} files, ${plan.issues.length} issues`
    }),
    section(
      "Paths",
      keyValueRows([
        { key: "target", value: plan.target },
        { key: "scope", value: scope === "user" ? "user-wide" : "project" },
        { key: "dryRun", value: plan.dryRun },
        { key: "assetRoot", value: plan.assetRoot },
        { key: "installRoot", value: plan.installRoot },
        { key: "skillRoot", value: plan.skillRoot }
      ]).split("\n")
    ),
    section("Files", fileRows.length > 0 ? fileRows : ["none"]),
    plan.provenance
      ? section(
          "Provenance",
          keyValueRows([
            { key: "transactionId", value: plan.provenance.transactionId },
            { key: "status", value: plan.provenance.status },
            { key: "buildSha", value: plan.provenance.source.build.buildSha },
            { key: "artifactDigest", value: plan.provenance.source.build.artifactDigest },
            { key: "rollback", value: plan.provenance.rollback.available }
          ]).split("\n")
        )
      : undefined,
    plan.issues.length > 0
      ? section(
          "Issues",
          plan.issues.map((issue) => `${issue.code} ${issue.path}: ${issue.message}`)
        )
      : undefined
  ]
    .filter((line): line is string => typeof line === "string")
    .join("\n\n") + "\n";
}

async function installProjectSetupSkills(
  context: CliContext,
  projectSetup: ProjectSetupResult,
  transactionId: string,
  startedAt: string
): Promise<readonly SkillInstallSummary[]> {
  const results: SkillInstallSummary[] = [];
  for (const target of projectSetup.config.skillTargets) {
    const installRoot =
      projectSetup.config.skillInstallRoots?.find((entry) => entry.target === target)?.installRoot ??
      configuredInstallRootForTarget(context.workspaceRoot, projectSetup.config.installRoot, target);
    const plan = await buildSkillInstallPlan({ target, dryRun: false, installRoot, workspaceRoot: context.workspaceRoot });
    const installed = await installSkillsFromPlanAtomically(plan, {
      transactionId,
      operation: "install.setup",
      startedAt,
      scope: "project"
    });
    results.push({
      target: installed.target,
      installRoot: installed.installRoot,
      skillRoot: installed.skillRoot,
      fileCount: installed.files.length,
      provenance: installed.provenance
    });
  }
  return results;
}

export interface SkillInstallTransactionInput {
  readonly transactionId: string;
  readonly operation: InstallProvenance["operation"];
  readonly startedAt: string;
  readonly scope?: SkillInstallScope;
}

export async function installSkillsFromPlanAtomically(
  plan: SkillInstallPlan,
  input: SkillInstallTransactionInput
): Promise<AtomicSkillInstallResult> {
  if (plan.issues.length > 0) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Cannot install skills while workflow assets are invalid", {
      issues: plan.issues,
      transactionId: input.transactionId
    });
  }

  await mkdir(plan.installRoot, { recursive: true });
  const stageDir = await mkdtemp(join(tmpdir(), `bwrk-install-${input.transactionId}-`));
  const markerPath = join(plan.installRoot, ".boreal-install-provenance.json");
  const destinations = [...plan.files.map((file) => file.destination), markerPath];
  const backups: Array<{ readonly path: string; readonly existed: boolean; readonly content?: string; readonly mode?: number }> = [];

  try {
    const stagedFiles = await Promise.all(
      plan.files.map(async (file, index) => {
        assertPathInside(plan.installRoot, file.destination);
        const source = await readFile(resolve(plan.assetRoot, file.source), "utf8");
        const stagedPath = join(stageDir, String(index));
        await writeFile(stagedPath, source, "utf8");
        const content = await readFile(stagedPath, "utf8");
        if (content !== source) {
          throw new BorealError("BOREAL_STORAGE_ERROR", "Staged skill content failed verification", {
            transactionId: input.transactionId,
            path: file.destination
          });
        }
        return { file, content };
      })
    );

    for (const path of destinations) {
      const existing = await lstat(path).catch(() => undefined);
      if (!existing) {
        backups.push({ path, existed: false });
        continue;
      }
      if (!existing.isFile()) {
        throw new BorealError("BOREAL_CONFLICT", "Install destination is not a regular file", {
          transactionId: input.transactionId,
          path
        });
      }
      backups.push({ path, existed: true, content: await readFile(path, "utf8"), mode: existing.mode & 0o777 });
    }

    for (const { file, content } of stagedFiles) {
      await writeTextFileAtomic(file.destination, content, { mode: modeForBackup(backups, file.destination) });
      const written = await readFile(file.destination, "utf8");
      if (written !== content) {
        throw new BorealError("BOREAL_STORAGE_ERROR", "Installed skill file failed verification", {
          transactionId: input.transactionId,
          path: file.destination
        });
      }
    }

    const provenance = await provenanceForFiles(plan, input, stagedFiles.map(({ file, content }) => ({ file, content })));
    await writeTextFileAtomic(markerPath, `${JSON.stringify(provenance, null, 2)}\n`, {
      mode: modeForBackup(backups, markerPath)
    });
    const marker = await readFile(markerPath, "utf8");
    if (JSON.parse(marker).transactionId !== input.transactionId) {
      throw new BorealError("BOREAL_STORAGE_ERROR", "Install provenance failed verification", {
        transactionId: input.transactionId,
        path: markerPath
      });
    }

    return { ...plan, provenance };
  } catch (error) {
    for (const backup of [...backups].reverse()) {
      try {
        if (backup.existed) {
          await writeTextFileAtomic(backup.path, backup.content ?? "", { mode: backup.mode });
        } else {
          await rm(backup.path, { force: true });
        }
      } catch {
        // Preserve the original failure; the provenance result will not claim a commit.
      }
    }
    throw error;
  } finally {
    await rm(stageDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function buildInstallProvenance(
  plan: SkillInstallPlan,
  input: SkillInstallTransactionInput & { readonly status: "planned" }
): Promise<InstallProvenance> {
  const files = await Promise.all(
    plan.files.map(async (file) => ({ file, content: await readFile(resolve(plan.assetRoot, file.source), "utf8") }))
  );
  return provenanceForFiles(plan, input, files);
}

async function provenanceForFiles(
  plan: SkillInstallPlan,
  input: SkillInstallTransactionInput & { readonly status?: "planned" | "committed" },
  files: readonly { readonly file: SkillInstallPlan["files"][number]; readonly content: string }[]
): Promise<InstallProvenance> {
  const version = getVersionInfo();
  return {
    schemaVersion: INSTALL_PROVENANCE_SCHEMA_VERSION,
    transactionId: input.transactionId,
    operation: input.operation,
    status: input.status ?? "committed",
    startedAt: input.startedAt,
    ...(input.status !== "planned" ? { finishedAt: nowIso() } : {}),
    actor: { pid: process.pid, cwd: process.cwd() },
    source: {
      assetRoot: plan.assetRoot,
      packageName: version.name,
      packageVersion: version.version,
      installChannel: version.installChannel,
      build: version.build
    },
    target: {
      kind: "skills",
      target: plan.target,
      installRoot: plan.installRoot,
      skillRoot: plan.skillRoot,
      ...(input.scope ? { scope: input.scope } : {})
    },
    files: files.map(({ file, content }) => ({
      path: relative(plan.installRoot, file.destination),
      bytes: Buffer.byteLength(content, "utf8"),
      contentHash: String(hashContent(content))
    })),
    verification: { checkedFiles: files.length, ok: input.status !== "planned" },
    rollback: { available: input.status !== "planned", performed: false }
  };
}

function modeForBackup(
  backups: readonly { readonly path: string; readonly mode?: number }[],
  path: string
): number {
  return backups.find((backup) => backup.path === path)?.mode ?? 0o644;
}

function formatInitResult(result: {
  readonly initialized: boolean;
  readonly workspaceRoot: string;
  readonly storage?: { readonly storage: string };
  readonly eventId: string;
  readonly projectSetup?: ProjectSetupResult;
  readonly skillInstalls?: readonly SkillInstallSummary[];
}): string {
  const lines = [
    "Boreal workspace initialized",
    `workspace: ${result.workspaceRoot}`,
    `storage: ${result.storage?.storage ?? "file-v2"}`,
    `event: ${result.eventId}`
  ];
  if (result.projectSetup) {
    lines.push(
      "",
      "Project setup",
      `config: ${result.projectSetup.configPath}`,
      `memory: ${result.projectSetup.config.memoryRoot}`,
      `layout: ${result.projectSetup.config.memoryLayout}`,
      `memory git: ${result.projectSetup.config.memoryGitMode}`,
      `memory repo initialized: ${result.projectSetup.gitSetup.memoryRepoInitialized ? "yes" : "no"}`,
      `project gitignore updated: ${result.projectSetup.gitSetup.projectGitignoreUpdated ? "yes" : "no"}`,
      `gitmodules updated: ${result.projectSetup.gitSetup.gitmodulesUpdated ? "yes" : "no"}`,
      `skills: ${result.projectSetup.config.installRoot}`,
      `targets: ${result.projectSetup.config.skillTargets.join(", ")}`,
      `skill visibility: ${result.projectSetup.config.folderScoped ? "every folder in project" : "one project folder"}`,
      `created: ${result.projectSetup.createdDirectories.length} directories, ${result.projectSetup.createdFiles.length} files`,
      `existing: ${result.projectSetup.existingDirectories.length} directories, ${result.projectSetup.existingFiles.length} files`
    );
  }
  if (result.skillInstalls && result.skillInstalls.length > 0) {
    lines.push(
      "",
      "Skill installs",
      ...result.skillInstalls.map((install) => `${install.target}: ${install.skillRoot} (${install.fileCount} files)`)
    );
  }
  lines.push(
    "",
    result.projectSetup ? "Next: run bwrk prime --json to verify the project." : "Next: run bwrk install to add project memory and agent skills."
  );
  return `${lines.join("\n")}\n`;
}
