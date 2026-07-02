import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { lstat, mkdir, readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";

import { BorealError, assertPathInside, assertRealPathInside, nowIso, safeParseJson } from "@boreal/core";
import { writeTextFileAtomic } from "@boreal/storage";

import { flagValue, flagValues, hasFlag, type ParsedArgs } from "./args.js";
import { BOREAL_WORK_BANNER } from "./branding.js";
import { keyValueRows, section, withPromptSession, type CliSelectOption } from "./cli-ui.js";
import type { CliContext } from "./context.js";

export const PROJECT_SETUP_SCHEMA_VERSION = "boreal.project-setup.v1";
const VAULT_SCHEMA_VERSION = "boreal.vault.v1";
const execFileAsync = promisify(execFile);

export type MemoryLayout = "in-repo" | "child" | "sibling";
export type MemoryGitMode = "shared" | "separate" | "submodule";
export type SkillTarget = "codex" | "claude";

export interface SkillInstallRootConfig {
  readonly target: SkillTarget;
  readonly installRoot: string;
  readonly skillRoot: string;
}

export interface ProjectSetupConfig {
  readonly schemaVersion: typeof PROJECT_SETUP_SCHEMA_VERSION;
  readonly projectRoot: string;
  readonly memoryRoot: string;
  readonly memoryLayout: MemoryLayout;
  readonly memoryGitMode: MemoryGitMode;
  readonly memoryRemote?: string;
  readonly installRoot: string;
  readonly skillInstallRoots?: readonly SkillInstallRootConfig[];
  readonly skillTargets: readonly SkillTarget[];
  readonly folderScoped: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProjectSetupResult {
  readonly configured: true;
  readonly configPath: string;
  readonly config: ProjectSetupConfig;
  readonly createdDirectories: readonly string[];
  readonly existingDirectories: readonly string[];
  readonly createdFiles: readonly string[];
  readonly existingFiles: readonly string[];
  readonly gitSetup: ProjectGitSetupResult;
}

export interface ProjectSetupInput {
  readonly projectRoot: string;
  readonly memoryRoot: string;
  readonly memoryLayout: MemoryLayout;
  readonly memoryGitMode: MemoryGitMode;
  readonly memoryRemote?: string;
  readonly installRoot: string;
  readonly skillInstallRoots: readonly SkillInstallRootConfig[];
  readonly skillTargets: readonly SkillTarget[];
  readonly folderScoped: boolean;
}

export interface ProjectGitSetupResult {
  readonly memoryGitMode: MemoryGitMode;
  readonly memoryRepoInitialized: boolean;
  readonly memoryRepoExisting: boolean;
  readonly memoryGitignoreUpdated: boolean;
  readonly projectGitignoreUpdated: boolean;
  readonly gitmodulesUpdated: boolean;
  readonly ignoredByProject: boolean;
  readonly memoryGitDir?: string;
  readonly memoryGitignorePath?: string;
  readonly projectGitignorePath?: string;
  readonly gitmodulesPath?: string;
}

export interface ProjectSetupRepair {
  readonly kind: "project_gitignore" | "memory_gitignore" | "memory_repo" | "gitmodules";
  readonly path: string;
  readonly details?: unknown;
}

export interface ProjectSetupPathInspection {
  readonly path: string;
  readonly exists: boolean;
  readonly isDirectory: boolean;
  readonly isFile: boolean;
  readonly error?: string;
}

export interface ProjectSetupTrackedPath {
  readonly mode: string;
  readonly path: string;
}

export interface ProjectSetupChildTrackingInspection {
  readonly checked: boolean;
  readonly available: boolean;
  readonly insideWorktree: boolean;
  readonly expectedPath?: string;
  readonly trackedPaths: readonly ProjectSetupTrackedPath[];
  readonly plainTrackedPaths: readonly ProjectSetupTrackedPath[];
  readonly gitlinkPaths: readonly ProjectSetupTrackedPath[];
  readonly error?: string;
}

export interface ProjectGitmodulesEntry {
  readonly name: string;
  readonly path?: string;
  readonly url?: string;
}

export interface ProjectGitmodulesInspection {
  readonly path: string;
  readonly exists: boolean;
  readonly expectedPath?: string;
  readonly expectedUrl?: string;
  readonly entries: readonly ProjectGitmodulesEntry[];
  readonly matchingEntry?: ProjectGitmodulesEntry;
  readonly ok: boolean;
  readonly missing: boolean;
  readonly stale: boolean;
  readonly unexpected: boolean;
  readonly error?: string;
}

export interface ProjectSetupDriftInspection {
  readonly configured: boolean;
  readonly configPath: string;
  readonly config?: ProjectSetupConfig;
  readonly configValid: boolean;
  readonly configError?: string;
  readonly validationError?: string;
  readonly projectRootMatches?: boolean;
  readonly memoryRoot?: ProjectSetupPathInspection;
  readonly memoryRepoExpected?: boolean;
  readonly memoryRepoExists?: boolean;
  readonly memoryGitignorePath?: string;
  readonly memoryGitignoreMissingPatterns: readonly string[];
  readonly projectGitignorePath?: string;
  readonly projectGitignoreMissingPatterns: readonly string[];
  readonly childTracking?: ProjectSetupChildTrackingInspection;
  readonly gitmodules?: ProjectGitmodulesInspection;
  readonly repairs: readonly ProjectSetupRepair[];
  readonly fixed: boolean;
}

const MEMORY_DIRECTORIES = [
  ".",
  "raw",
  "wiki",
  "work",
  "graph",
  "ledgers",
  "dashboards",
  ".boreal",
  ".boreal/db",
  ".boreal/cache",
  ".boreal/locks",
  ".boreal/tmp",
  ".boreal/results"
] as const;

const MEMORY_FILES = [
  {
    path: "index.md",
    content: `---\nkind: boreal-vault-index\nschemaVersion: ${VAULT_SCHEMA_VERSION}\n---\n\n# Boreal Memory Vault\n\nThis directory is canonical project memory for Boreal.\n\n`
  },
  {
    path: "wiki/index.md",
    content: `---\nkind: boreal-wiki-index\nschemaVersion: ${VAULT_SCHEMA_VERSION}\n---\n\n# Wiki\n\nStable project knowledge pages live here.\n\n`
  },
  {
    path: "work/index.md",
    content: `---\nkind: boreal-work-index\nschemaVersion: ${VAULT_SCHEMA_VERSION}\n---\n\n# Work Memory\n\nDurable work summaries and sprint notes live here.\n\n`
  },
  {
    path: "dashboards/Work Queue.md",
    content: `---\nkind: boreal-dashboard\nschemaVersion: ${VAULT_SCHEMA_VERSION}\n---\n\n# Work Queue\n\nThis page is reserved for generated or curated work queue summaries.\n\n`
  },
  {
    path: ".boreal/README.md",
    content:
      "# Boreal Local Memory Runtime\n\nGenerated local memory cache, lock, and result files live under this directory. Most subdirectories are ignored by Git.\n"
  },
  { path: "raw/index.jsonl", content: "" },
  { path: "graph/relationships.jsonl", content: "" },
  { path: "ledgers/events.jsonl", content: "" },
  { path: "ledgers/deletions.jsonl", content: "" }
] as const;

const MEMORY_GITIGNORE_PATTERNS = [
  "# Boreal generated local memory artifacts",
  ".boreal/db/",
  ".boreal/cache/",
  ".boreal/locks/",
  ".boreal/tmp/",
  ".boreal/results/",
  ".boreal/**/*.db",
  ".boreal/**/*.db-*"
] as const;

const PROJECT_GITIGNORE_PATTERNS = [
  "# Boreal local workspace binding and runtime artifacts",
  ".boreal/project.json",
  ".boreal/mcp.json",
  ".boreal/runtime/",
  ".boreal/ledgers/",
  ".boreal/cache/",
  ".boreal/tmp/",
  ".boreal/results/",
  ".boreal/**/*.db",
  ".boreal/**/*.db-*",
  ".agents/",
  ".claude/",
  "dump/"
] as const;

const MEMORY_LAYOUT_OPTIONS: readonly CliSelectOption<MemoryLayout>[] = [
  {
    value: "in-repo",
    label: "In repo",
    description: "Use <project>/memory in the project repository. Only use when memory history should mix with app history."
  },
  {
    value: "child",
    label: "Child memory repo",
    description: "Use <project>/memory as a separate Git repository ignored by the app repo. This is the safe default."
  },
  {
    value: "sibling",
    label: "Sibling memory repo",
    description: "Use ../<project>-memory. Choose this when memory must live beside the project."
  }
];

const INSTALL_MEMORY_LAYOUT_OPTIONS: readonly CliSelectOption<MemoryLayout>[] = [
  {
    value: "child",
    label: "Child repo: ./memory",
    description: "Clean default. Memory stays inside the project folder, uses its own Git repo, and is ignored by the app repo."
  },
  {
    value: "sibling",
    label: "Sibling repo: ../<project>-memory",
    description: "Keep memory beside the project. Useful when the project tree cannot contain local memory."
  },
  {
    value: "in-repo",
    label: "Shared folder: ./memory",
    description: "Track memory with the app repo. Use only when memory history should mix with app history."
  }
];

const MEMORY_GIT_OPTIONS: readonly CliSelectOption<MemoryGitMode>[] = [
  {
    value: "shared",
    label: "Shared with project",
    description: "Memory is tracked with the project repository. Only use when memory history should mix with app history."
  },
  {
    value: "separate",
    label: "Separate memory repo",
    description: "Memory has its own Git repository. Child memory is ignored by the project repo."
  },
  {
    value: "submodule",
    label: "Child submodule",
    description: "Memory lives at <project>/memory as a separate Git repo pinned by the project gitlink."
  }
];

const INSTALL_CHILD_MEMORY_GIT_OPTIONS: readonly CliSelectOption<MemoryGitMode>[] = [
  {
    value: "separate",
    label: "Separate child repo",
    description: "Default. Initialize ./memory as its own Git repository and ignore it from the app repo."
  },
  {
    value: "submodule",
    label: "Child submodule",
    description: "Advanced. Requires a remote URL and a real project gitlink before doctor treats it as healthy."
  }
];

const INSTALL_SHARED_MEMORY_GIT_OPTIONS: readonly CliSelectOption<MemoryGitMode>[] = [
  {
    value: "shared",
    label: "Shared app history",
    description: "Track memory files in the app repository."
  }
];

const INSTALL_SEPARATE_MEMORY_GIT_OPTIONS: readonly CliSelectOption<MemoryGitMode>[] = [
  {
    value: "separate",
    label: "Separate memory repo",
    description: "Initialize or reuse a separate Git repository for memory."
  }
];

const SKILL_TARGET_OPTIONS: readonly CliSelectOption<SkillTarget>[] = [
  {
    value: "codex",
    label: "Codex",
    description: "Install Boreal skills for Codex sessions."
  },
  {
    value: "claude",
    label: "Claude",
    description: "Install Boreal skills for Claude sessions."
  }
];

function installMemoryGitOptions(memoryLayout: MemoryLayout): readonly CliSelectOption<MemoryGitMode>[] {
  switch (memoryLayout) {
    case "child":
      return INSTALL_CHILD_MEMORY_GIT_OPTIONS;
    case "in-repo":
      return INSTALL_SHARED_MEMORY_GIT_OPTIONS;
    case "sibling":
      return INSTALL_SEPARATE_MEMORY_GIT_OPTIONS;
  }
}

function installMemoryGitDefault(current: MemoryGitMode, memoryLayout: MemoryLayout): MemoryGitMode {
  const options = installMemoryGitOptions(memoryLayout);
  return options.some((option) => option.value === current) ? current : options[0]?.value ?? "separate";
}

const YES_NO_OPTIONS: readonly CliSelectOption<"yes" | "no">[] = [
  {
    value: "yes",
    label: "Yes",
    description: "Install skills under the folder where agent sessions are opened."
  },
  {
    value: "no",
    label: "No",
    description: "Use the project-level skill install root."
  }
];

export async function maybeConfigureProjectSetup(
  context: CliContext,
  args: ParsedArgs
): Promise<ProjectSetupResult | undefined> {
  if (!shouldConfigureProjectSetup(args)) {
    return undefined;
  }
  const input = hasFlag(args, "interactive")
    ? await promptProjectSetupInput(context, args)
    : projectSetupInputFromArgs(context, args);
  return applyProjectSetup(input);
}

export async function promptProjectInstallInput(context: CliContext, args: ParsedArgs): Promise<ProjectSetupInput> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new BorealError("BOREAL_INVALID_INPUT", "bwrk install requires a TTY; use --yes for defaults or --dry-run to preview");
  }
  const defaults = projectSetupInputFromArgs(context, args);
  return withPromptSession({ input: process.stdin, output: process.stdout }, async (prompt) => {
    prompt.writeIntro(
      "Boreal Install",
      [
        "Clean project setup for local-first work and memory.",
        "Recommended: ./memory as a child Git repo, Codex skills in .agents/skills, no app-history pollution."
      ].join("\n")
    );
    const projectRoot = resolveUserPath(context.workspaceRoot, await prompt.text("Project root", defaults.projectRoot));
    const memoryLayout = await prompt.select("Memory location", INSTALL_MEMORY_LAYOUT_OPTIONS, defaults.memoryLayout);
    const memoryRootDefault = flagValue(args, "memory-root")
      ? defaults.memoryRoot
      : defaultMemoryRoot(projectRoot, memoryLayout);
    const memoryRoot = resolveUserPath(projectRoot, await prompt.text("Memory root", memoryRootDefault));
    const memoryGitMode = await prompt.select(
      "Memory Git mode",
      installMemoryGitOptions(memoryLayout),
      installMemoryGitDefault(defaults.memoryGitMode, memoryLayout)
    );
    const memoryRemote =
      memoryGitMode === "submodule"
        ? await prompt.text("Memory remote URL", defaults.memoryRemote ?? "")
        : defaults.memoryRemote;
    const installRoot = resolveUserPath(projectRoot, await prompt.text("Skill install root", defaults.installRoot));
    const skillTargets = await prompt.multiselect("Agent skills", SKILL_TARGET_OPTIONS, defaults.skillTargets);
    const skillInstallRoots = skillTargets.map((target) => skillInstallRootConfig(projectRoot, installRoot, target));
    const folderScoped = (await prompt.select("Folder scoped skills", YES_NO_OPTIONS, defaults.folderScoped ? "yes" : "no")) === "yes";
    const reviewed = { projectRoot, memoryRoot, memoryLayout, memoryGitMode, memoryRemote, installRoot, skillInstallRoots, skillTargets, folderScoped };
    prompt.writeIntro("Install review", formatProjectInstallReview(reviewed));
    const confirmed = await prompt.select("Write install files", YES_NO_OPTIONS, "yes");
    if (confirmed !== "yes") {
      throw new BorealError("BOREAL_INVALID_INPUT", "Boreal install cancelled", { reason: "cancelled" });
    }
    return reviewed;
  });
}

export async function readProjectSetupConfig(projectRoot: string): Promise<ProjectSetupConfig | undefined> {
  const config = await readExistingConfig(join(projectRoot, ".boreal", "project.json"));
  if (config) {
    assertProjectSetupRootMatches(projectRoot, config);
    await validateProjectSetupInput(projectSetupInputFromConfig(config));
  }
  return config;
}

export async function inspectProjectSetupDrift(
  context: CliContext,
  fix: boolean
): Promise<ProjectSetupDriftInspection> {
  const configPath = join(context.workspaceRoot, ".boreal", "project.json");
  const empty = {
    configPath,
    memoryGitignoreMissingPatterns: [],
    projectGitignoreMissingPatterns: [],
    repairs: [],
    fixed: false
  } satisfies Omit<ProjectSetupDriftInspection, "configured" | "configValid">;

  let config: ProjectSetupConfig | undefined;
  try {
    config = await readExistingConfig(configPath);
  } catch (error) {
    return {
      ...empty,
      configured: true,
      configValid: false,
      configError: error instanceof Error ? error.message : String(error)
    };
  }

  if (!config) {
    return {
      ...empty,
      configured: false,
      configValid: true
    };
  }

  const projectRootMatches = projectRootsMatch(context.workspaceRoot, config.projectRoot);
  let validationError: string | undefined;
  try {
    assertProjectSetupRootMatches(context.workspaceRoot, config);
    await validateProjectSetupInput(projectSetupInputFromConfig(config));
  } catch (error) {
    validationError = error instanceof Error ? error.message : String(error);
  }

  if (!projectRootMatches || validationError) {
    return {
      ...empty,
      configured: true,
      config,
      configValid: false,
      validationError,
      projectRootMatches
    };
  }

  const repairs: ProjectSetupRepair[] = [];
  const memoryRoot = await inspectPath(config.memoryRoot);
  const memoryRepoExpected = config.memoryGitMode !== "shared";
  let memoryRepoExists = memoryRepoExpected ? existsSync(join(config.memoryRoot, ".git")) : false;
  let projectGitignoreMissingPatterns = await missingIgnorePatterns(
    join(config.projectRoot, ".gitignore"),
    projectIgnorePatterns(projectSetupInputFromConfig(config))
  );
  let memoryGitignoreMissingPatterns = memoryRoot.isDirectory
    ? await missingIgnorePatterns(join(config.memoryRoot, ".gitignore"), MEMORY_GITIGNORE_PATTERNS)
    : [];

  if (fix && projectGitignoreMissingPatterns.length > 0) {
    await ensureIgnoreFile(join(config.projectRoot, ".gitignore"), projectIgnorePatterns(projectSetupInputFromConfig(config)));
    repairs.push({
      kind: "project_gitignore",
      path: join(config.projectRoot, ".gitignore"),
      details: { addedPatterns: projectGitignoreMissingPatterns }
    });
    projectGitignoreMissingPatterns = [];
  }

  if (fix && memoryRoot.isDirectory && memoryGitignoreMissingPatterns.length > 0) {
    await ensureIgnoreFile(join(config.memoryRoot, ".gitignore"), MEMORY_GITIGNORE_PATTERNS);
    repairs.push({
      kind: "memory_gitignore",
      path: join(config.memoryRoot, ".gitignore"),
      details: { addedPatterns: memoryGitignoreMissingPatterns }
    });
    memoryGitignoreMissingPatterns = [];
  }

  if (fix && memoryRoot.isDirectory && memoryRepoExpected && !memoryRepoExists) {
    await ensureGitRepository(config.memoryRoot, "memory root");
    repairs.push({
      kind: "memory_repo",
      path: config.memoryRoot
    });
    memoryRepoExists = true;
  }

  const childTracking = await inspectChildMemoryTracking(config);
  let gitmodules = await inspectProjectGitmodules(config);
  if (fix && config.memoryGitMode === "submodule" && !gitmodules.ok) {
    await ensureSubmoduleConfig(config.projectRoot, config.memoryRoot, config.memoryRemote ?? "");
    repairs.push({
      kind: "gitmodules",
      path: join(config.projectRoot, ".gitmodules"),
      details: {
        expectedPath: gitmodules.expectedPath,
        expectedUrl: gitmodules.expectedUrl
      }
    });
    gitmodules = await inspectProjectGitmodules(config);
  }

  return {
    configured: true,
    configPath,
    config,
    configValid: true,
    projectRootMatches,
    memoryRoot,
    memoryRepoExpected,
    memoryRepoExists,
    memoryGitignorePath: join(config.memoryRoot, ".gitignore"),
    memoryGitignoreMissingPatterns,
    projectGitignorePath: join(config.projectRoot, ".gitignore"),
    projectGitignoreMissingPatterns,
    childTracking,
    gitmodules,
    repairs,
    fixed: repairs.length > 0
  };
}

function shouldConfigureProjectSetup(args: ParsedArgs): boolean {
  return (
    hasFlag(args, "setup-memory") ||
    hasFlag(args, "interactive") ||
    flagValue(args, "memory-root") !== undefined ||
    flagValue(args, "memory-layout") !== undefined ||
    flagValue(args, "memory-git-mode") !== undefined ||
    flagValue(args, "memory-remote") !== undefined ||
    flagValue(args, "install-root") !== undefined ||
    flagValues(args, "skill-target").length > 0 ||
    hasFlag(args, "folder-scoped") ||
    hasFlag(args, "separate-git")
  );
}

export function projectSetupInputFromArgs(context: CliContext, args: ParsedArgs): ProjectSetupInput {
  const projectRoot = context.workspaceRoot;
  const memoryLayout = parseMemoryLayout(flagValue(args, "memory-layout") ?? "child");
  const memoryRoot = resolveUserPath(projectRoot, flagValue(args, "memory-root") ?? defaultMemoryRoot(projectRoot, memoryLayout));
  const installRoot = resolveUserPath(projectRoot, flagValue(args, "install-root") ?? ".agents/skills");
  const skillTargets = parseSkillTargets(flagValues(args, "skill-target"));
  const skillInstallRoots = skillTargets.map((target) => skillInstallRootConfig(projectRoot, installRoot, target));
  return {
    projectRoot,
    memoryRoot,
    memoryLayout,
    memoryGitMode: parseMemoryGitMode(args, memoryLayout),
    memoryRemote: flagValue(args, "memory-remote"),
    installRoot,
    skillInstallRoots,
    skillTargets,
    folderScoped: hasFlag(args, "folder-scoped")
  };
}

async function promptProjectSetupInput(context: CliContext, args: ParsedArgs): Promise<ProjectSetupInput> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new BorealError("BOREAL_INVALID_INPUT", "--interactive requires a TTY; use noninteractive init flags in automation");
  }
  const defaults = projectSetupInputFromArgs(context, args);
  return withPromptSession({ input: process.stdin, output: process.stdout }, async (prompt) => {
    prompt.writeIntro(BOREAL_WORK_BANNER, "Boreal project setup\nUse arrow keys to choose options. Press Enter to accept.");
    const projectRoot = resolveUserPath(
      context.workspaceRoot,
      await prompt.text("Project root", defaults.projectRoot)
    );
    const memoryLayout = await prompt.select(
      "Memory layout",
      MEMORY_LAYOUT_OPTIONS,
      defaults.memoryLayout
    );
    const memoryRootDefault = flagValue(args, "memory-root")
      ? defaults.memoryRoot
      : defaultMemoryRoot(projectRoot, memoryLayout);
    const memoryRoot = resolveUserPath(projectRoot, await prompt.text("Memory root", memoryRootDefault));
    const memoryGitMode = await prompt.select(
      "Memory git mode",
      MEMORY_GIT_OPTIONS,
      defaults.memoryGitMode
    );
    const memoryRemote =
      memoryGitMode === "submodule"
        ? await prompt.text("Memory remote URL", defaults.memoryRemote ?? "")
        : defaults.memoryRemote;
    const installRoot = resolveUserPath(projectRoot, await prompt.text("Skill install root", defaults.installRoot));
    const skillTargets = await prompt.multiselect(
      "Skill targets",
      SKILL_TARGET_OPTIONS,
      defaults.skillTargets
    );
    const skillInstallRoots = skillTargets.map((target) => skillInstallRootConfig(projectRoot, installRoot, target));
    const folderScoped = (await prompt.select("Folder scoped skills", YES_NO_OPTIONS, defaults.folderScoped ? "yes" : "no")) === "yes";
    const reviewed = { projectRoot, memoryRoot, memoryLayout, memoryGitMode, memoryRemote, installRoot, skillInstallRoots, skillTargets, folderScoped };
    prompt.writeIntro("Review project setup", formatProjectSetupReview(reviewed));
    const confirmed = await prompt.select("Write setup files", YES_NO_OPTIONS, "yes");
    if (confirmed !== "yes") {
      throw new BorealError("BOREAL_INVALID_INPUT", "Project setup cancelled", { reason: "cancelled" });
    }
    return reviewed;
  });
}

export function formatProjectSetupReview(input: ProjectSetupInput): string {
  return [
    section(
      "Config",
      keyValueRows([
        { key: "projectRoot", value: input.projectRoot },
        { key: "memoryRoot", value: input.memoryRoot },
        { key: "memoryLayout", value: input.memoryLayout },
        { key: "memoryGitMode", value: input.memoryGitMode },
        { key: "memoryRemote", value: input.memoryRemote ?? "" },
        { key: "installRoot", value: input.installRoot },
        { key: "skillInstallRoots", value: input.skillInstallRoots.map((entry) => `${entry.target}=${entry.skillRoot}`).join(", ") },
        { key: "skillTargets", value: input.skillTargets.join(", ") },
        { key: "folderScoped", value: input.folderScoped }
      ]).split("\n")
    ),
    section("Directories", MEMORY_DIRECTORIES.map((entry) => `ensure ${relative(input.projectRoot, join(input.memoryRoot, entry))}`)),
    section("Files", MEMORY_FILES.map((entry) => `ensure ${relative(input.projectRoot, join(input.memoryRoot, entry.path))}`)),
    section("Git effects", projectSetupGitReviewRows(input))
  ].join("\n\n");
}

export function formatProjectInstallReview(input: ProjectSetupInput): string {
  return [
    section(
      "Recommended shape",
      [
        "project stays the app repository",
        "memory gets its own Git repository",
        "project Git ignores local memory and generated agent surfaces"
      ]
    ),
    section(
      "Paths",
      keyValueRows([
        { key: "project", value: input.projectRoot },
        { key: "memory", value: input.memoryRoot },
        { key: "skills", value: input.skillInstallRoots.map((entry) => `${entry.target}:${entry.skillRoot}`).join(", ") },
        { key: "config", value: join(input.projectRoot, ".boreal", "project.json") }
      ]).split("\n")
    ),
    section(
      "Choices",
      keyValueRows([
        { key: "memoryLayout", value: input.memoryLayout },
        { key: "memoryGit", value: input.memoryGitMode },
        { key: "skillTargets", value: input.skillTargets.join(", ") },
        { key: "folderScoped", value: input.folderScoped }
      ]).split("\n")
    ),
    section("Git effects", projectSetupGitReviewRows(input))
  ].join("\n\n");
}

function projectSetupGitReviewRows(input: ProjectSetupInput): readonly string[] {
  switch (input.memoryGitMode) {
    case "shared":
      return ["memory history may be tracked by the project Git repository", "no separate memory Git repository is initialized"];
    case "separate":
      return [
        "initialize or reuse a separate memory Git repository",
        "write memory .gitignore guards for generated runtime artifacts",
        "write project .gitignore guards so child memory/runtime artifacts are not tracked"
      ];
    case "submodule":
      return [
        "initialize or reuse a child memory Git repository",
        "write memory .gitignore guards for generated runtime artifacts",
        "write project .gitignore guards for local Boreal runtime artifacts",
        input.memoryRemote ? "write or update .gitmodules for the memory remote" : "require --memory-remote before writing .gitmodules"
      ];
  }
}

export async function applyProjectSetup(input: ProjectSetupInput): Promise<ProjectSetupResult> {
  await validateProjectSetupInput(input);
  const now = nowIso();
  const configPath = join(input.projectRoot, ".boreal", "project.json");
  const existingConfig = await readExistingConfig(configPath);
  const config: ProjectSetupConfig = {
    schemaVersion: PROJECT_SETUP_SCHEMA_VERSION,
    projectRoot: input.projectRoot,
    memoryRoot: input.memoryRoot,
    memoryLayout: input.memoryLayout,
    memoryGitMode: input.memoryGitMode,
    memoryRemote: input.memoryRemote,
    installRoot: input.installRoot,
    skillInstallRoots: input.skillInstallRoots,
    skillTargets: input.skillTargets,
    folderScoped: input.folderScoped,
    createdAt: existingConfig?.createdAt ?? now,
    updatedAt: now
  };

  const createdDirectories: string[] = [];
  const existingDirectories: string[] = [];
  for (const relativePath of MEMORY_DIRECTORIES) {
    const absolutePath = join(input.memoryRoot, relativePath);
    const existed = existsSync(absolutePath);
    await ensureDirectory(absolutePath, input.memoryRoot);
    (existed ? existingDirectories : createdDirectories).push(relativeMemoryPath(input.memoryRoot, absolutePath));
  }

  const createdFiles: string[] = [];
  const existingFiles: string[] = [];
  for (const file of MEMORY_FILES) {
    const absolutePath = join(input.memoryRoot, file.path);
    await assertMemoryPath(input.memoryRoot, absolutePath);
    if (existsSync(absolutePath)) {
      await assertFile(absolutePath);
      existingFiles.push(file.path);
      continue;
    }
    await writeTextFileAtomic(absolutePath, file.content);
    createdFiles.push(file.path);
  }

  const memoryGitignore = await ensureIgnoreFile(join(input.memoryRoot, ".gitignore"), MEMORY_GITIGNORE_PATTERNS);
  const gitSetup = await applyGitSetup(input, memoryGitignore.updated);

  await writeTextFileAtomic(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return { configured: true, configPath, config, createdDirectories, existingDirectories, createdFiles, existingFiles, gitSetup };
}

export async function validateProjectSetupInput(input: ProjectSetupInput): Promise<void> {
  if (input.memoryLayout === "in-repo") {
    assertPathInside(input.projectRoot, input.memoryRoot);
    await assertRealPathInside(input.projectRoot, input.memoryRoot);
  }
  if (input.memoryLayout === "child" && dirname(input.memoryRoot) !== input.projectRoot) {
    throw new BorealError("BOREAL_INVALID_INPUT", "--memory-layout child requires --memory-root to be a direct child of the project root", {
      projectRoot: input.projectRoot,
      memoryRoot: input.memoryRoot
    });
  }
  if (input.memoryLayout === "sibling" && dirname(input.memoryRoot) !== dirname(input.projectRoot)) {
    throw new BorealError("BOREAL_INVALID_INPUT", "--memory-layout sibling requires --memory-root to share the project root parent", {
      projectRoot: input.projectRoot,
      memoryRoot: input.memoryRoot
    });
  }
  if (input.memoryLayout !== "sibling") {
    assertPathInside(input.projectRoot, input.memoryRoot);
    await assertRealPathInside(input.projectRoot, input.memoryRoot);
  }
  if (input.installRoot === input.memoryRoot || input.installRoot.startsWith(`${input.memoryRoot}/`)) {
    throw new BorealError("BOREAL_INVALID_INPUT", "--install-root cannot be inside the memory root");
  }
  if (input.memoryLayout === "sibling" && input.memoryGitMode !== "separate") {
    throw new BorealError("BOREAL_INVALID_INPUT", "--memory-layout sibling requires --memory-git-mode separate", {
      memoryLayout: input.memoryLayout,
      memoryGitMode: input.memoryGitMode
    });
  }
  if (input.memoryGitMode === "submodule" && input.memoryLayout !== "child") {
    throw new BorealError("BOREAL_INVALID_INPUT", "--memory-git-mode submodule requires --memory-layout child", {
      memoryLayout: input.memoryLayout,
      memoryGitMode: input.memoryGitMode
    });
  }
  if (input.memoryGitMode === "submodule" && !input.memoryRemote) {
    throw new BorealError("BOREAL_INVALID_INPUT", "--memory-git-mode submodule requires --memory-remote", {
      memoryGitMode: input.memoryGitMode
    });
  }
}

async function readExistingConfig(configPath: string): Promise<ProjectSetupConfig | undefined> {
  if (!existsSync(configPath)) {
    return undefined;
  }
  const parsed = safeParseJson(await readFile(configPath, "utf8"), {
    path: configPath,
    schemaName: PROJECT_SETUP_SCHEMA_VERSION,
    expectedObject: true
  });
  if (!isProjectSetupConfig(parsed)) {
    throw new BorealError("BOREAL_CONFLICT", "Existing project setup config is invalid; repair it before re-running init", {
      configPath
    });
  }
  return normalizedProjectSetupConfig(parsed);
}

function normalizedProjectSetupConfig(config: ProjectSetupConfig): ProjectSetupConfig {
  return {
    ...config,
    skillInstallRoots:
      config.skillInstallRoots ?? config.skillTargets.map((target) => skillInstallRootConfig(config.projectRoot, config.installRoot, target))
  };
}

function projectSetupInputFromConfig(config: ProjectSetupConfig): ProjectSetupInput {
  return {
    projectRoot: config.projectRoot,
    memoryRoot: config.memoryRoot,
    memoryLayout: config.memoryLayout,
    memoryGitMode: config.memoryGitMode,
    memoryRemote: config.memoryRemote,
    installRoot: config.installRoot,
    skillInstallRoots:
      config.skillInstallRoots ?? config.skillTargets.map((target) => skillInstallRootConfig(config.projectRoot, config.installRoot, target)),
    skillTargets: config.skillTargets,
    folderScoped: config.folderScoped
  };
}

function assertProjectSetupRootMatches(projectRoot: string, config: ProjectSetupConfig): void {
  if (projectRootsMatch(projectRoot, config.projectRoot)) {
    return;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "Project setup config belongs to a different project root", {
    expectedProjectRoot: resolve(projectRoot),
    configuredProjectRoot: resolve(config.projectRoot),
    repairCommand: "bwrk init --setup-memory --interactive"
  });
}

function projectRootsMatch(left: string, right: string): boolean {
  return resolve(left) === resolve(right);
}

function isProjectSetupConfig(value: unknown): value is ProjectSetupConfig {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.schemaVersion === PROJECT_SETUP_SCHEMA_VERSION &&
    typeof record.projectRoot === "string" &&
    typeof record.memoryRoot === "string" &&
    (record.memoryLayout === "in-repo" || record.memoryLayout === "child" || record.memoryLayout === "sibling") &&
    (record.memoryGitMode === "shared" || record.memoryGitMode === "separate" || record.memoryGitMode === "submodule") &&
    (record.memoryRemote === undefined || typeof record.memoryRemote === "string") &&
    typeof record.installRoot === "string" &&
    (record.skillInstallRoots === undefined ||
      (Array.isArray(record.skillInstallRoots) &&
        record.skillInstallRoots.every((entry) => {
          if (typeof entry !== "object" || entry === null) {
            return false;
          }
          const root = entry as Record<string, unknown>;
          return (
            (root.target === "codex" || root.target === "claude") &&
            typeof root.installRoot === "string" &&
            typeof root.skillRoot === "string"
          );
        }))) &&
    Array.isArray(record.skillTargets) &&
    record.skillTargets.every((target) => target === "codex" || target === "claude") &&
    typeof record.folderScoped === "boolean" &&
    typeof record.createdAt === "string" &&
    typeof record.updatedAt === "string"
  );
}

async function ensureDirectory(path: string, memoryRoot: string): Promise<void> {
  await assertMemoryPath(memoryRoot, path);
  if (existsSync(path)) {
    await assertDirectory(path);
    return;
  }
  await mkdir(path, { recursive: true });
}

async function assertMemoryPath(memoryRoot: string, path: string): Promise<void> {
  assertPathInside(memoryRoot, path);
}

async function assertDirectory(path: string): Promise<void> {
  const stats = await lstat(path);
  if (!stats.isDirectory()) {
    throw new BorealError("BOREAL_CONFLICT", "Cannot initialize memory scaffold over a non-directory path", { path });
  }
}

async function assertFile(path: string): Promise<void> {
  const stats = await lstat(path);
  if (!stats.isFile()) {
    throw new BorealError("BOREAL_CONFLICT", "Cannot initialize memory scaffold over a non-file path", { path });
  }
}

function parseMemoryLayout(value: string): MemoryLayout {
  if (value === "in-repo" || value === "child" || value === "sibling") {
    return value;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "--memory-layout must be in-repo, child, or sibling");
}

function parseMemoryGitMode(args: ParsedArgs, memoryLayout: MemoryLayout): MemoryGitMode {
  const explicit = flagValue(args, "memory-git-mode");
  if (explicit !== undefined) {
    const mode = asMemoryGitMode(explicit);
    if (hasFlag(args, "separate-git") && mode === "shared") {
      throw new BorealError("BOREAL_INVALID_INPUT", "--separate-git cannot be combined with --memory-git-mode shared");
    }
    return mode;
  }
  if (hasFlag(args, "separate-git")) {
    return "separate";
  }
  return memoryLayout === "in-repo" ? "shared" : "separate";
}

function asMemoryGitMode(value: string): MemoryGitMode {
  if (value === "shared" || value === "separate" || value === "submodule") {
    return value;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "--memory-git-mode must be shared, separate, or submodule");
}

function parseSkillTargets(values: readonly string[]): readonly SkillTarget[] {
  const targets = values.length > 0 ? values : ["codex"];
  const normalized = targets.flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean);
  const seen = new Set<SkillTarget>();
  for (const value of normalized) {
    if (value !== "codex" && value !== "claude") {
      throw new BorealError("BOREAL_INVALID_INPUT", "--skill-target must be codex or claude");
    }
    seen.add(value);
  }
  return [...seen];
}

function resolveUserPath(baseDir: string, value: string): string {
  const expanded = value.replace(/^~(?=$|\/)/, process.env.HOME ?? "");
  return isAbsolute(expanded) ? resolve(expanded) : resolve(baseDir, expanded);
}

export function skillInstallRootConfig(projectRoot: string, configuredRoot: string, target: SkillTarget): SkillInstallRootConfig {
  const installRoot = configuredInstallRootForTarget(projectRoot, configuredRoot, target);
  return {
    target,
    installRoot,
    skillRoot: skillRootForInstallRoot(installRoot)
  };
}

export function configuredInstallRootForTarget(projectRoot: string, configuredRoot: string, target: SkillTarget): string {
  if (configuredInstallRootMatchesTarget(configuredRoot, target)) {
    return resolve(configuredRoot);
  }
  return target === "codex" ? resolve(projectRoot, ".agents") : resolve(projectRoot, ".claude");
}

export function configuredInstallRootMatchesTarget(root: string, target: SkillTarget): boolean {
  const container = basename(root) === "skills" ? basename(dirname(root)) : basename(root);
  return target === "codex" ? container === ".agents" : container === ".claude";
}

export function skillRootForInstallRoot(root: string): string {
  return basename(root) === "skills" ? resolve(root) : resolve(root, "skills");
}

function defaultMemoryRoot(projectRoot: string, memoryLayout: MemoryLayout): string {
  switch (memoryLayout) {
    case "in-repo":
    case "child":
      return join(projectRoot, "memory");
    case "sibling":
      return join(dirname(projectRoot), `${basename(projectRoot)}-memory`);
  }
}

function relativeMemoryPath(memoryRoot: string, path: string): string {
  return path === memoryRoot ? basename(memoryRoot) : path.slice(memoryRoot.length + 1);
}

async function applyGitSetup(input: ProjectSetupInput, memoryGitignoreUpdated: boolean): Promise<ProjectGitSetupResult> {
  const projectGitignore = await ensureIgnoreFile(join(input.projectRoot, ".gitignore"), projectIgnorePatterns(input));
  const memoryRepoBefore = existsSync(join(input.memoryRoot, ".git"));
  const memoryRepoInitialized =
    input.memoryGitMode === "shared" ? false : await ensureGitRepository(input.memoryRoot, "memory root");
  const gitmodulesUpdated =
    input.memoryGitMode === "submodule"
      ? await ensureSubmoduleConfig(input.projectRoot, input.memoryRoot, input.memoryRemote ?? "")
      : false;
  return {
    memoryGitMode: input.memoryGitMode,
    memoryRepoInitialized,
    memoryRepoExisting: memoryRepoBefore,
    memoryGitignoreUpdated,
    projectGitignoreUpdated: projectGitignore.updated,
    gitmodulesUpdated,
    ignoredByProject: input.memoryGitMode === "separate" && input.memoryLayout !== "sibling",
    memoryGitDir: input.memoryGitMode === "shared" ? undefined : join(input.memoryRoot, ".git"),
    memoryGitignorePath: join(input.memoryRoot, ".gitignore"),
    projectGitignorePath: join(input.projectRoot, ".gitignore"),
    gitmodulesPath: input.memoryGitMode === "submodule" ? join(input.projectRoot, ".gitmodules") : undefined
  };
}

function projectIgnorePatterns(input: ProjectSetupInput): readonly string[] {
  const patterns: string[] = [...PROJECT_GITIGNORE_PATTERNS];
  if (input.memoryGitMode === "separate" && input.memoryLayout !== "sibling") {
    patterns.push(`/${projectRelativePath(input.projectRoot, input.memoryRoot)}/`);
  }
  return patterns;
}

async function ensureIgnoreFile(path: string, patterns: readonly string[]): Promise<{ readonly updated: boolean }> {
  const existing = existsSync(path) ? await readFile(path, "utf8") : "";
  const missing = patterns.filter((pattern) => !ignoreFileHasPattern(existing, pattern));
  if (missing.length === 0) {
    return { updated: false };
  }
  const prefix = existing.length === 0 || existing.endsWith("\n") ? existing : `${existing}\n`;
  await writeTextFileAtomic(path, `${prefix}${missing.join("\n")}\n`);
  return { updated: true };
}

function ignoreFileHasPattern(text: string, pattern: string): boolean {
  const canonicalPattern = canonicalIgnorePattern(pattern);
  return text.split(/\r?\n/u).some((line) => {
    const candidate = line.trim();
    return candidate === pattern || canonicalIgnorePattern(candidate) === canonicalPattern;
  });
}

function canonicalIgnorePattern(pattern: string): string {
  const trimmed = pattern.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("!") || /[*?[\]{}]/u.test(trimmed)) {
    return trimmed;
  }
  const withoutLeadingRoot = trimmed.replace(/^\/+/u, "");
  return trimmed.endsWith("/") ? withoutLeadingRoot.replace(/\/+$/u, "/") : withoutLeadingRoot;
}

async function ensureGitRepository(path: string, label: string): Promise<boolean> {
  if (existsSync(join(path, ".git"))) {
    return false;
  }
  try {
    await execFileAsync("git", ["init"], { cwd: path });
  } catch (error) {
    throw new BorealError("BOREAL_CONFLICT", `Unable to initialize Git repository for ${label}`, {
      path,
      error: error instanceof Error ? error.message : String(error)
    });
  }
  return true;
}

async function ensureSubmoduleConfig(projectRoot: string, memoryRoot: string, memoryRemote: string): Promise<boolean> {
  const gitmodulesPath = join(projectRoot, ".gitmodules");
  const submodulePath = projectRelativePath(projectRoot, memoryRoot);
  const before = await inspectProjectGitmodules({
    schemaVersion: PROJECT_SETUP_SCHEMA_VERSION,
    projectRoot,
    memoryRoot,
    memoryLayout: "child",
    memoryGitMode: "submodule",
    memoryRemote,
    installRoot: projectRoot,
    skillTargets: [],
    folderScoped: false,
    createdAt: "",
    updatedAt: ""
  });
  if (before.ok) {
    return false;
  }
  await runGitOrThrow(projectRoot, ["config", "-f", gitmodulesPath, `submodule.${submodulePath}.path`, submodulePath], {
    action: "write submodule path",
    path: gitmodulesPath
  });
  await runGitOrThrow(projectRoot, ["config", "-f", gitmodulesPath, `submodule.${submodulePath}.url`, memoryRemote], {
    action: "write submodule URL",
    path: gitmodulesPath
  });
  return true;
}

function projectRelativePath(projectRoot: string, path: string): string {
  const relativePath = relative(projectRoot, path).replaceAll("\\", "/");
  if (relativePath.startsWith("..") || relativePath === "") {
    throw new BorealError("BOREAL_INVALID_INPUT", "Path must be inside project root", { projectRoot, path });
  }
  return relativePath;
}

async function inspectPath(path: string): Promise<ProjectSetupPathInspection> {
  try {
    const info = await lstat(path);
    return {
      path,
      exists: true,
      isDirectory: info.isDirectory(),
      isFile: info.isFile()
    };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return {
        path,
        exists: false,
        isDirectory: false,
        isFile: false
      };
    }
    return {
      path,
      exists: false,
      isDirectory: false,
      isFile: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function missingIgnorePatterns(path: string, patterns: readonly string[]): Promise<readonly string[]> {
  const existing = existsSync(path) ? await readFile(path, "utf8") : "";
  return patterns.filter((pattern) => !ignoreFileHasPattern(existing, pattern));
}

async function inspectChildMemoryTracking(config: ProjectSetupConfig): Promise<ProjectSetupChildTrackingInspection> {
  if (config.memoryLayout !== "child" || config.memoryGitMode === "shared") {
    return {
      checked: false,
      available: true,
      insideWorktree: false,
      trackedPaths: [],
      plainTrackedPaths: [],
      gitlinkPaths: []
    };
  }

  const expectedPath = projectRelativePath(config.projectRoot, config.memoryRoot);
  const result = await runGit(config.projectRoot, ["ls-files", "--stage", "--", expectedPath]);
  if (!result.ok) {
    return {
      checked: false,
      available: !isMissingGit(result),
      insideWorktree: false,
      expectedPath,
      trackedPaths: [],
      plainTrackedPaths: [],
      gitlinkPaths: [],
      error: result.error
    };
  }

  const trackedPaths = parseLsFilesStage(result.stdout);
  const plainTrackedPaths = trackedPaths.filter((entry) => entry.mode !== "160000");
  const gitlinkPaths = trackedPaths.filter((entry) => entry.mode === "160000");
  return {
    checked: true,
    available: true,
    insideWorktree: true,
    expectedPath,
    trackedPaths,
    plainTrackedPaths,
    gitlinkPaths
  };
}

async function inspectProjectGitmodules(config: ProjectSetupConfig): Promise<ProjectGitmodulesInspection> {
  const gitmodulesPath = join(config.projectRoot, ".gitmodules");
  const expectedPath = config.memoryLayout === "child" ? projectRelativePath(config.projectRoot, config.memoryRoot) : undefined;
  const expectedUrl = config.memoryGitMode === "submodule" ? config.memoryRemote : undefined;
  const entriesResult = await readGitmodulesEntries(config.projectRoot);
  const matchingEntry = expectedPath
    ? entriesResult.entries.find((entry) => entry.name === expectedPath) ?? entriesResult.entries.find((entry) => entry.path === expectedPath)
    : undefined;
  const submoduleMissing =
    config.memoryGitMode === "submodule" &&
    (!entriesResult.exists || !matchingEntry || matchingEntry.path !== expectedPath || matchingEntry.url !== expectedUrl);
  const unexpected =
    config.memoryGitMode !== "submodule" &&
    expectedPath !== undefined &&
    entriesResult.entries.some((entry) => entry.name === expectedPath || entry.path === expectedPath);

  return {
    path: gitmodulesPath,
    exists: entriesResult.exists,
    expectedPath,
    expectedUrl,
    entries: entriesResult.entries,
    matchingEntry,
    ok: entriesResult.error === undefined && !submoduleMissing && !unexpected,
    missing: submoduleMissing,
    stale: submoduleMissing || unexpected,
    unexpected,
    error: entriesResult.error
  };
}

async function readGitmodulesEntries(projectRoot: string): Promise<{
  readonly exists: boolean;
  readonly entries: readonly ProjectGitmodulesEntry[];
  readonly error?: string;
}> {
  const gitmodulesPath = join(projectRoot, ".gitmodules");
  if (!existsSync(gitmodulesPath)) {
    return { exists: false, entries: [] };
  }
  const result = await runGit(projectRoot, ["config", "-f", gitmodulesPath, "--get-regexp", "^submodule\\..*\\.(path|url)$"]);
  if (!result.ok && result.stdout.trim().length === 0 && result.code === 1) {
    return { exists: true, entries: [] };
  }
  if (!result.ok) {
    return { exists: true, entries: [], error: result.error };
  }

  const entriesByName = new Map<string, { path?: string; url?: string }>();
  for (const line of result.stdout.split(/\r?\n/u).filter(Boolean)) {
    const separator = line.indexOf(" ");
    if (separator < 0) {
      continue;
    }
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    const match = /^submodule\.(.+)\.(path|url)$/u.exec(key);
    if (!match) {
      continue;
    }
    const name = match[1];
    const field = match[2];
    if (!name || (field !== "path" && field !== "url")) {
      continue;
    }
    const entry = entriesByName.get(name) ?? {};
    entriesByName.set(name, field === "path" ? { ...entry, path: value } : { ...entry, url: value });
  }

  return {
    exists: true,
    entries: [...entriesByName.entries()].map(([name, entry]) => ({ name, ...entry }))
  };
}

function parseLsFilesStage(stdout: string): readonly ProjectSetupTrackedPath[] {
  return stdout
    .split(/\r?\n/u)
    .filter(Boolean)
    .flatMap((line) => {
      const match = /^(\d{6})\s+[0-9a-f]+\s+\d+\t(.+)$/u.exec(line);
      const mode = match?.[1];
      const path = match?.[2];
      return mode && path ? [{ mode, path }] : [];
    });
}

async function runGitOrThrow(
  cwd: string,
  args: readonly string[],
  details: { readonly action: string; readonly path: string }
): Promise<void> {
  const result = await runGit(cwd, args);
  if (!result.ok) {
    throw new BorealError("BOREAL_CONFLICT", `Unable to ${details.action}`, {
      path: details.path,
      error: result.error
    });
  }
}

interface GitCommandResult {
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: string;
  readonly code?: string | number;
}

async function runGit(cwd: string, args: readonly string[]): Promise<GitCommandResult> {
  try {
    const result = await execFileAsync("git", ["-C", cwd, ...args], { maxBuffer: 5 * 1024 * 1024 });
    return {
      ok: true,
      stdout: String(result.stdout),
      stderr: String(result.stderr)
    };
  } catch (error) {
    const record = error as { readonly stdout?: unknown; readonly stderr?: unknown; readonly message?: string; readonly code?: string | number };
    return {
      ok: false,
      stdout: typeof record.stdout === "string" ? record.stdout : "",
      stderr: typeof record.stderr === "string" ? record.stderr : "",
      error: (typeof record.stderr === "string" && record.stderr.trim()) || record.message || String(error),
      code: record.code
    };
  }
}

function isMissingGit(result: GitCommandResult): boolean {
  return result.code === "ENOENT";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
