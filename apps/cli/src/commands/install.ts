import { join, resolve } from "node:path";

import { BorealError, nowIso } from "@boreal/core";

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
  installSkillsFromPlan,
  type SkillInstallPlan
} from "../workflow-assets.js";
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
  const dryRun = hasFlag(args, "dry-run");
  const interactive = hasFlag(args, "interactive");
  if (interactive && json) {
    throw new BorealError("BOREAL_INVALID_INPUT", "--interactive cannot be combined with --json");
  }
  const plan = await buildSkillInstallPlan({
    target,
    dryRun,
    installRoot: await installRootFromArgs(context, args, target),
    workspaceRoot: context.workspaceRoot
  });
  if (interactive && !dryRun) {
    await confirmSkillInstallPlan(plan);
  }
  const result = dryRun ? plan : await installSkillsFromPlan(plan);
  output.write(json ? formatRecord(result, true) : formatSkillInstallPlan(result));
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
  const skillInstalls = projectSetup ? await installProjectSetupSkills(context, projectSetup) : undefined;
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
  target: "codex" | "claude" | "skills"
): Promise<string> {
  const explicit = flagValue(args, "install-root");
  if (explicit) {
    return resolve(context.workspaceRoot, explicit);
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
  if (dryRun) {
    const result: InstallSetupResult = {
      kind: "install",
      dryRun: true,
      yes,
      workspaceRoot: context.workspaceRoot,
      plan
    };
    output.write(json ? formatRecord(result, true) : formatInstallSetupResult(result, input));
    return { exitCode: 0 };
  }

  await ensureWorkspaceDirs(context);
  const initialized = await context.runtime.ensureWorkspaceInitialized();
  const projectSetup = await applyProjectSetup(input);
  const skillInstalls = await installProjectSetupSkills(context, projectSetup);
  const result: InstallSetupResult = {
    kind: "install",
    dryRun: false,
    yes,
    initialized: initialized.initialized,
    workspaceRoot: context.workspaceRoot,
    eventId: initialized.event.meta.id,
    plan,
    projectSetup,
    skillInstalls
  };
  output.write(json ? formatRecord(result, true) : formatInstallSetupResult(result, input));
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
    ? "No files were written. Run bwrk install --yes to apply this plan."
    : "Workspace runtime, child memory, Git guards, and agent skills are ready.";
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

async function confirmSkillInstallPlan(plan: SkillInstallPlan): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new BorealError("BOREAL_INVALID_INPUT", "--interactive requires a TTY; use --dry-run to review install plans in automation");
  }
  const accepted = await withPromptSession({ input: process.stdin, output: process.stdout }, async (prompt) => {
    prompt.writeIntro("Boreal skill install review", formatSkillInstallPlan(plan));
    return prompt.select("Write install files", INSTALL_CONFIRM_OPTIONS, "yes");
  });
  if (accepted !== "yes") {
    throw new BorealError("BOREAL_INVALID_INPUT", "Skill install cancelled", { reason: "cancelled" });
  }
}

function formatSkillInstallPlan(plan: SkillInstallPlan): string {
  const summaryStatus = plan.issues.length > 0 ? "warning" : plan.dryRun ? "pending" : "success";
  const fileRows = plan.files.map((file) => {
    const action = file.wouldWrite ? "write" : "skip";
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
        { key: "dryRun", value: plan.dryRun },
        { key: "assetRoot", value: plan.assetRoot },
        { key: "installRoot", value: plan.installRoot },
        { key: "skillRoot", value: plan.skillRoot }
      ]).split("\n")
    ),
    section("Files", fileRows.length > 0 ? fileRows : ["none"]),
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

async function installProjectSetupSkills(context: CliContext, projectSetup: ProjectSetupResult): Promise<readonly SkillInstallSummary[]> {
  const results: SkillInstallSummary[] = [];
  for (const target of projectSetup.config.skillTargets) {
    const installRoot =
      projectSetup.config.skillInstallRoots?.find((entry) => entry.target === target)?.installRoot ??
      configuredInstallRootForTarget(context.workspaceRoot, projectSetup.config.installRoot, target);
    const plan = await buildSkillInstallPlan({ target, dryRun: false, installRoot, workspaceRoot: context.workspaceRoot });
    const installed = await installSkillsFromPlan(plan);
    results.push({
      target: installed.target,
      installRoot: installed.installRoot,
      skillRoot: installed.skillRoot,
      fileCount: installed.files.length
    });
  }
  return results;
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
      `folder scoped: ${result.projectSetup.config.folderScoped ? "yes" : "no"}`,
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
  return `${lines.join("\n")}\n`;
}
