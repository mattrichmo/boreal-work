import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { lstat, mkdir, readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";

import { BorealError, assertPathInside, assertRealPathInside, nowIso, safeParseJson } from "@boreal/core";
import { writeTextFileAtomic } from "@boreal/storage";

import { flagValue, flagValues, hasFlag, type ParsedArgs } from "./args.js";
import { withPromptSession, type CliSelectOption } from "./cli-ui.js";
import type { CliContext } from "./context.js";

export const PROJECT_SETUP_SCHEMA_VERSION = "boreal.project-setup.v1";
const VAULT_SCHEMA_VERSION = "boreal.vault.v1";
const execFileAsync = promisify(execFile);

export type MemoryLayout = "in-repo" | "child" | "sibling";
export type MemoryGitMode = "shared" | "separate" | "submodule";
export type SkillTarget = "codex" | "claude";

export interface ProjectSetupConfig {
  readonly schemaVersion: typeof PROJECT_SETUP_SCHEMA_VERSION;
  readonly projectRoot: string;
  readonly memoryRoot: string;
  readonly memoryLayout: MemoryLayout;
  readonly memoryGitMode: MemoryGitMode;
  readonly memoryRemote?: string;
  readonly installRoot: string;
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

interface ProjectSetupInput {
  readonly projectRoot: string;
  readonly memoryRoot: string;
  readonly memoryLayout: MemoryLayout;
  readonly memoryGitMode: MemoryGitMode;
  readonly memoryRemote?: string;
  readonly installRoot: string;
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
  ".boreal/runtime/",
  ".boreal/cache/",
  ".boreal/tmp/",
  ".boreal/results/",
  ".boreal/**/*.db",
  ".boreal/**/*.db-*"
] as const;

const MEMORY_LAYOUT_OPTIONS: readonly CliSelectOption<MemoryLayout>[] = [
  {
    value: "in-repo",
    label: "In repo",
    description: "Use <project>/memory. Best default when memory belongs to this repository."
  },
  {
    value: "child",
    label: "Child memory repo",
    description: "Use a direct child memory folder that can become its own Git repository."
  },
  {
    value: "sibling",
    label: "Sibling memory repo",
    description: "Use ../<project>-memory. Choose this when memory must live beside the project."
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

export async function readProjectSetupConfig(projectRoot: string): Promise<ProjectSetupConfig | undefined> {
  const config = await readExistingConfig(join(projectRoot, ".boreal", "project.json"));
  if (config) {
    await validateProjectSetupInput(config);
  }
  return config;
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

function projectSetupInputFromArgs(context: CliContext, args: ParsedArgs): ProjectSetupInput {
  const projectRoot = context.workspaceRoot;
  const memoryLayout = parseMemoryLayout(flagValue(args, "memory-layout") ?? (flagValue(args, "memory-root") ? "in-repo" : "sibling"));
  const memoryRoot = resolveUserPath(projectRoot, flagValue(args, "memory-root") ?? defaultMemoryRoot(projectRoot, memoryLayout));
  const installRoot = resolveUserPath(projectRoot, flagValue(args, "install-root") ?? ".agents/skills");
  const skillTargets = parseSkillTargets(flagValues(args, "skill-target"));
  return {
    projectRoot,
    memoryRoot,
    memoryLayout,
    memoryGitMode: parseMemoryGitMode(args, memoryLayout),
    memoryRemote: flagValue(args, "memory-remote"),
    installRoot,
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
    prompt.writeIntro("Boreal project setup", "Use arrow keys to choose options. Press Enter to accept.");
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
    const folderScoped = (await prompt.select("Folder scoped skills", YES_NO_OPTIONS, defaults.folderScoped ? "yes" : "no")) === "yes";
    return { projectRoot, memoryRoot, memoryLayout, memoryGitMode, memoryRemote, installRoot, skillTargets, folderScoped };
  });
}

async function applyProjectSetup(input: ProjectSetupInput): Promise<ProjectSetupResult> {
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

async function validateProjectSetupInput(input: ProjectSetupInput): Promise<void> {
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
  return parsed;
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
  return text.split(/\r?\n/u).some((line) => line.trim() === pattern);
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
  const block = [
    `[submodule "${submodulePath}"]`,
    `\tpath = ${submodulePath}`,
    `\turl = ${memoryRemote}`
  ].join("\n");
  const existing = existsSync(gitmodulesPath) ? await readFile(gitmodulesPath, "utf8") : "";
  if (existing.includes(`[submodule "${submodulePath}"]`)) {
    return false;
  }
  const prefix = existing.length === 0 || existing.endsWith("\n") ? existing : `${existing}\n`;
  await writeTextFileAtomic(gitmodulesPath, `${prefix}${block}\n`);
  return true;
}

function projectRelativePath(projectRoot: string, path: string): string {
  const relativePath = relative(projectRoot, path).replaceAll("\\", "/");
  if (relativePath.startsWith("..") || relativePath === "") {
    throw new BorealError("BOREAL_INVALID_INPUT", "Path must be inside project root", { projectRoot, path });
  }
  return relativePath;
}
