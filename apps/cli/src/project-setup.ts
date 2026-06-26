import { existsSync } from "node:fs";
import { lstat, mkdir, readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";

import { BorealError, assertPathInside, assertRealPathInside, nowIso, safeParseJson } from "@boreal/core";
import { writeTextFileAtomic } from "@boreal/storage";

import { flagValue, flagValues, hasFlag, type ParsedArgs } from "./args.js";
import type { CliContext } from "./context.js";

export const PROJECT_SETUP_SCHEMA_VERSION = "boreal.project-setup.v1";
const VAULT_SCHEMA_VERSION = "boreal.vault.v1";

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

interface SelectOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly description: string;
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

const MEMORY_LAYOUT_OPTIONS: readonly SelectOption<MemoryLayout>[] = [
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

const MEMORY_GIT_OPTIONS: readonly SelectOption<MemoryGitMode>[] = [
  {
    value: "shared",
    label: "Shared with project",
    description: "Memory is tracked with the project repository or left untracked by project policy."
  },
  {
    value: "separate",
    label: "Separate memory repo",
    description: "Memory is expected to have its own Git boundary."
  }
];

const SKILL_TARGET_OPTIONS: readonly SelectOption<SkillTarget>[] = [
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

const YES_NO_OPTIONS: readonly SelectOption<"yes" | "no">[] = [
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
    process.stdout.write("Boreal project setup\n\nUse arrow keys to choose options. Press Enter to accept.\n\n");
    const projectRoot = resolveUserPath(
      context.workspaceRoot,
      await askWithDefault(rl, "Project root", defaults.projectRoot)
    );
    const memoryLayout = await selectOne(
      "Memory layout",
      MEMORY_LAYOUT_OPTIONS,
      defaults.memoryLayout
    );
    const memoryRootDefault = flagValue(args, "memory-root")
      ? defaults.memoryRoot
      : defaultMemoryRoot(projectRoot, memoryLayout);
    const memoryRoot = resolveUserPath(projectRoot, await askWithDefault(rl, "Memory root", memoryRootDefault));
    const memoryGitMode = await selectOne(
      "Memory git mode",
      MEMORY_GIT_OPTIONS,
      defaults.memoryGitMode
    );
    const installRoot = resolveUserPath(projectRoot, await askWithDefault(rl, "Skill install root", defaults.installRoot));
    const skillTargets = await selectMany(
      "Skill targets",
      SKILL_TARGET_OPTIONS,
      defaults.skillTargets
    );
    const folderScoped = (await selectOne("Folder scoped skills", YES_NO_OPTIONS, defaults.folderScoped ? "yes" : "no")) === "yes";
    return { projectRoot, memoryRoot, memoryLayout, memoryGitMode, installRoot, skillTargets, folderScoped };
  } finally {
    rl.close();
  }
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

async function askWithDefault(
  rl: ReturnType<typeof createInterface>,
  label: string,
  defaultValue: string
): Promise<string> {
  const answer = await rl.question(`${label} [${defaultValue}]: `);
  return answer.trim() || defaultValue;
}

async function selectOne<T extends string>(
  label: string,
  options: readonly SelectOption<T>[],
  defaultValue: T
): Promise<T> {
  const selected = await selectValues(label, options, [defaultValue], { multiple: false });
  return selected[0] ?? defaultValue;
}

async function selectMany<T extends string>(
  label: string,
  options: readonly SelectOption<T>[],
  defaultValues: readonly T[]
): Promise<readonly T[]> {
  return selectValues(label, options, defaultValues, { multiple: true });
}

async function selectValues<T extends string>(
  label: string,
  options: readonly SelectOption<T>[],
  defaultValues: readonly T[],
  input: { readonly multiple: boolean }
): Promise<readonly T[]> {
  const stdin = process.stdin;
  const stdout = process.stdout;
  const defaultSet = new Set(defaultValues);
  const selected = new Set(options.filter((option) => defaultSet.has(option.value)).map((option) => option.value));
  if (selected.size === 0 && options[0]) {
    selected.add(options[0].value);
  }
  let index = Math.max(0, options.findIndex((option) => selected.has(option.value)));
  const wasRaw = stdin.isRaw;
  let renderedLines = 0;

  emitKeypressEvents(stdin);
  stdin.setRawMode(true);
  stdin.resume();
  stdout.write("\x1B[?25l");
  renderedLines = renderSelect(label, options, index, selected, input.multiple, renderedLines);

  try {
    return await new Promise<readonly T[]>((resolveSelection) => {
      const onKeypress = (_text: string, key: { readonly name?: string; readonly ctrl?: boolean }) => {
        if (key.ctrl && key.name === "c") {
          stdout.write("\x1B[?25h\n");
          process.exit(130);
        }
        if (key.name === "up" || key.name === "k") {
          index = (index - 1 + options.length) % options.length;
          selectActiveOption(options, index, selected, input.multiple);
          renderedLines = renderSelect(label, options, index, selected, input.multiple, renderedLines);
          return;
        }
        if (key.name === "down" || key.name === "j") {
          index = (index + 1) % options.length;
          selectActiveOption(options, index, selected, input.multiple);
          renderedLines = renderSelect(label, options, index, selected, input.multiple, renderedLines);
          return;
        }
        if (input.multiple && key.name === "space") {
          const current = options[index];
          if (current) {
            if (selected.has(current.value) && selected.size > 1) {
              selected.delete(current.value);
            } else {
              selected.add(current.value);
            }
          }
          renderedLines = renderSelect(label, options, index, selected, input.multiple, renderedLines);
          return;
        }
        if (key.name === "return" || key.name === "enter") {
          stdin.off("keypress", onKeypress);
          stdout.write("\x1B[?25h\n");
          resolveSelection(options.filter((option) => selected.has(option.value)).map((option) => option.value));
        }
      };
      stdin.on("keypress", onKeypress);
    });
  } finally {
    stdin.setRawMode(wasRaw);
  }
}

function renderSelect<T extends string>(
  label: string,
  options: readonly SelectOption<T>[],
  index: number,
  selected: ReadonlySet<T>,
  multiple: boolean,
  previousLineCount: number
): number {
  const active = options[index];
  const lines = [
    `${label}:`,
    ...options.map((option, optionIndex) => {
      const cursor = optionIndex === index ? ">" : " ";
      const marker = multiple ? (selected.has(option.value) ? "[x]" : "[ ]") : selected.has(option.value) ? "(*)" : "( )";
      return `${cursor} ${marker} ${option.label}`;
    }),
    "",
    active ? active.description : "",
    multiple ? "Space toggles. Enter accepts." : "Enter accepts.",
    ""
  ];
  const prefix = previousLineCount > 0 ? `\x1B[${previousLineCount}F\x1B[J` : "";
  process.stdout.write(`${prefix}${lines.join("\n")}`);
  return lines.length;
}

function selectActiveOption<T extends string>(
  options: readonly SelectOption<T>[],
  index: number,
  selected: Set<T>,
  multiple: boolean
): void {
  if (multiple) {
    return;
  }
  const active = options[index];
  if (active) {
    selected.clear();
    selected.add(active.value);
  }
}

function relativeMemoryPath(memoryRoot: string, path: string): string {
  return path === memoryRoot ? basename(memoryRoot) : path.slice(memoryRoot.length + 1);
}
