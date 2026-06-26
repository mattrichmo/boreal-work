import { existsSync } from "node:fs";
import { lstat, mkdir, readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";

import { BorealError, assertPathInside, nowIso, safeParseJson } from "@boreal/core";
import { writeTextFileAtomic } from "@boreal/storage";

import { flagValue, flagValues, hasFlag, type ParsedArgs } from "./args.js";
import type { CliContext } from "./context.js";
import { VAULT_SCHEMA_VERSION } from "./vault.js";

export const PROJECT_SETUP_SCHEMA_VERSION = "boreal.project-setup.v1";

export type MemoryLayout = "in-repo" | "child" | "sibling";
export type MemoryGitMode = "shared" | "separate";
export type SkillTarget = "codex" | "claude";

export interface ProjectSetupConfig {
  readonly schemaVersion: typeof PROJECT_SETUP_SCHEMA_VERSION;
  readonly projectRoot: string;
  readonly memoryRoot: string;
  readonly memoryLayout: MemoryLayout;
  readonly memoryGitMode: MemoryGitMode;
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
}

interface ProjectSetupInput {
  readonly projectRoot: string;
  readonly memoryRoot: string;
  readonly memoryLayout: MemoryLayout;
  readonly memoryGitMode: MemoryGitMode;
  readonly installRoot: string;
  readonly skillTargets: readonly SkillTarget[];
  readonly folderScoped: boolean;
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

function shouldConfigureProjectSetup(args: ParsedArgs): boolean {
  return (
    hasFlag(args, "setup-memory") ||
    hasFlag(args, "interactive") ||
    flagValue(args, "memory-root") !== undefined ||
    flagValue(args, "memory-layout") !== undefined ||
    flagValue(args, "install-root") !== undefined ||
    flagValues(args, "skill-target").length > 0 ||
    hasFlag(args, "folder-scoped") ||
    hasFlag(args, "separate-git")
  );
}

function projectSetupInputFromArgs(context: CliContext, args: ParsedArgs): ProjectSetupInput {
  const projectRoot = context.workspaceRoot;
  const memoryLayout = parseMemoryLayout(flagValue(args, "memory-layout") ?? "in-repo");
  const memoryRoot = resolveUserPath(projectRoot, flagValue(args, "memory-root") ?? "memory");
  const installRoot = resolveUserPath(projectRoot, flagValue(args, "install-root") ?? ".agents/skills");
  const skillTargets = parseSkillTargets(flagValues(args, "skill-target"));
  return {
    projectRoot,
    memoryRoot,
    memoryLayout,
    memoryGitMode: hasFlag(args, "separate-git") ? "separate" : "shared",
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
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const projectRoot = resolveUserPath(
      context.workspaceRoot,
      await askWithDefault(rl, "Project root", defaults.projectRoot)
    );
    const memoryLayout = parseMemoryLayout(
      await askWithDefault(rl, "Memory layout (in-repo, child, sibling)", defaults.memoryLayout)
    );
    const memoryRoot = resolveUserPath(projectRoot, await askWithDefault(rl, "Memory root", defaults.memoryRoot));
    const memoryGitMode = parseMemoryGitMode(
      await askWithDefault(rl, "Memory git mode (shared, separate)", defaults.memoryGitMode)
    );
    const installRoot = resolveUserPath(projectRoot, await askWithDefault(rl, "Skill install root", defaults.installRoot));
    const skillTargets = parseSkillTargets(
      (await askWithDefault(rl, "Skill targets (codex, claude)", defaults.skillTargets.join(",")))
        .split(",")
        .map((target) => target.trim())
        .filter(Boolean)
    );
    const folderScoped = parseYesNo(await askWithDefault(rl, "Folder scoped skills (yes/no)", defaults.folderScoped ? "yes" : "no"));
    return { projectRoot, memoryRoot, memoryLayout, memoryGitMode, installRoot, skillTargets, folderScoped };
  } finally {
    rl.close();
  }
}

async function applyProjectSetup(input: ProjectSetupInput): Promise<ProjectSetupResult> {
  validateProjectSetupInput(input);
  const now = nowIso();
  const configPath = join(input.projectRoot, ".boreal", "project.json");
  const existingConfig = await readExistingConfig(configPath);
  const config: ProjectSetupConfig = {
    schemaVersion: PROJECT_SETUP_SCHEMA_VERSION,
    projectRoot: input.projectRoot,
    memoryRoot: input.memoryRoot,
    memoryLayout: input.memoryLayout,
    memoryGitMode: input.memoryGitMode,
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

  await writeTextFileAtomic(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return { configured: true, configPath, config, createdDirectories, existingDirectories, createdFiles, existingFiles };
}

function validateProjectSetupInput(input: ProjectSetupInput): void {
  if (input.memoryLayout === "in-repo") {
    assertPathInside(input.projectRoot, input.memoryRoot);
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
  }
  if (input.installRoot === input.memoryRoot || input.installRoot.startsWith(`${input.memoryRoot}/`)) {
    throw new BorealError("BOREAL_INVALID_INPUT", "--install-root cannot be inside the memory root");
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
    (record.memoryGitMode === "shared" || record.memoryGitMode === "separate") &&
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

function parseMemoryGitMode(value: string): MemoryGitMode {
  if (value === "shared" || value === "separate") {
    return value;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "Memory git mode must be shared or separate");
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

async function askWithDefault(
  rl: ReturnType<typeof createInterface>,
  label: string,
  defaultValue: string
): Promise<string> {
  const answer = await rl.question(`${label} [${defaultValue}]: `);
  return answer.trim() || defaultValue;
}

function parseYesNo(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized === "yes" || normalized === "y" || normalized === "true") {
    return true;
  }
  if (normalized === "no" || normalized === "n" || normalized === "false") {
    return false;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "Expected yes or no");
}

function relativeMemoryPath(memoryRoot: string, path: string): string {
  return path === memoryRoot ? basename(memoryRoot) : path.slice(memoryRoot.length + 1);
}
