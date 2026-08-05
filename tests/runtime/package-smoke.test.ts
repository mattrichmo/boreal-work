import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { listenConsole } from "@boreal/console/server";

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("package smoke", () => {
  it("keeps every workspace package and workspace dependency represented in the pnpm lockfile", async () => {
    const lockText = await readFile(join(repoRoot, "pnpm-lock.yaml"), "utf8");
    for (const packageDir of await workspacePackageDirs()) {
      const packageJson = parseJson<WorkspacePackageJson>(
        await readFile(join(repoRoot, packageDir, "package.json"), "utf8")
      );
      const block = pnpmImporterBlock(lockText, packageDir);
      expect(block, `${packageDir} is missing from pnpm-lock.yaml importers`).toBeDefined();
      for (const [dependencyName, specifier] of workspaceDependencyEntries(packageJson)) {
        expect(
          block,
          `${packageDir} missing lockfile workspace dependency ${dependencyName}`
        ).toMatch(workspaceDependencyPattern(dependencyName, specifier));
      }
    }
  });

  it("runs installed bwrk, project init, skills, console startup, and child/sibling memory checks from clean fixtures", async () => {
    const root = await tempRoot();
    const binDir = join(root, "bin");
    const project = join(root, "project");
    const genericSkillRoot = join(root, "generic-skills");
    const siblingProject = join(root, "sibling-project");
    const siblingMemory = join(root, "sibling-memory");
    await mkdir(project, { recursive: true });
    await mkdir(siblingProject, { recursive: true });

    await run("node", [join(repoRoot, "tools", "install-local-bwrk.mjs"), "--bin-dir", binDir], repoRoot);
    const env = {
      ...process.env,
      BOREAL_BIN_DIR: binDir,
      PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`
    };
    const bwrk = join(binDir, process.platform === "win32" ? "bwrk.cmd" : "bwrk");

    await initGit(project);
    await initGit(siblingProject);

    const version = await run(bwrk, ["--version"], project, env);
    expect(version.stdout).toBe("boreal-work 0.1.0 (source)\n");

    const status = parseData<{
      readonly localShim: { readonly executable: boolean; readonly targetCli?: string };
      readonly globalCommand: { readonly found: boolean; readonly probe?: { readonly ok: boolean; readonly stdout: string } };
      readonly recommendedActions: readonly string[];
    }>((await runBwrk(bwrk, ["install", "status", "--bin-dir", binDir, "--path", env.PATH, "--json"], project, env)).stdout);
    expect(status.localShim).toEqual(expect.objectContaining({ executable: true, targetCli: join(repoRoot, "apps/cli/src/index.ts") }));
    expect(status.globalCommand).toEqual(expect.objectContaining({ found: true, probe: expect.objectContaining({ ok: true, stdout: "boreal-work 0.1.0 (source)" }) }));
    expect(status.recommendedActions).toEqual(["Upgrade bwrk via source: git pull && pnpm install && pnpm install:local."]);

    const init = await runBwrk(bwrk, [
      "init",
      "--setup-memory",
      "--memory-root",
      "memory",
      "--memory-layout",
      "child",
      "--memory-git-mode",
      "separate",
      "--install-root",
      ".agents/skills",
      "--skill-target",
      "codex",
      "--json"
    ], project, env);
    expect(parseData<{ readonly initialized: boolean }>(init.stdout).initialized).toBe(true);
    await expectRegularPath(join(project, "memory", ".git"));
    await expectNoTrackedMemoryContamination(project);

    await runBwrk(bwrk, ["work", "create", "Package smoke task", "--ready", "--json"], project, env);
    await runBwrk(bwrk, ["sync", "refresh", "--json"], project, env);
    const doctor = parseData<{ readonly ok: boolean; readonly diagnostics: Array<{ readonly code: string; readonly severity: string }> }>(
      (await runBwrk(bwrk, ["doctor", "--strict", "--json"], project, env)).stdout
    );
    expect(doctor.ok).toBe(true);
    expect(doctor.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "install.status", severity: "ok" }),
        expect.objectContaining({ code: "project_setup.memory_repo", severity: "ok" })
      ])
    );

    await runBwrk(bwrk, ["install", "codex", "--json"], project, env);
    await runBwrk(bwrk, ["install", "claude", "--json"], project, env);
    await runBwrk(bwrk, ["install", "skills", "--install-root", genericSkillRoot, "--json"], project, env);
    const codexClaudeSkillsDoctor = parseData<SkillsDoctorPayload>(
      (await runBwrk(bwrk, ["doctor", "skills", "--skill-target", "codex", "--skill-target", "claude", "--json"], project, env)).stdout
    );
    expect(codexClaudeSkillsDoctor.ok).toBe(true);
    expect(codexClaudeSkillsDoctor.issues).toEqual([]);
    expect(codexClaudeSkillsDoctor.installedChecks.map((check) => check.target).sort()).toEqual(["claude", "codex"]);
    expect(codexClaudeSkillsDoctor.installedChecks.every((check) => check.checkedFileCount === check.expectedFileCount)).toBe(true);

    const genericSkillsDoctor = parseData<SkillsDoctorPayload>(
      (await runBwrk(bwrk, ["doctor", "skills", "--install-root", genericSkillRoot, "--skill-target", "skills", "--json"], project, env)).stdout
    );
    expect(genericSkillsDoctor.ok).toBe(true);
    expect(genericSkillsDoctor.issues).toEqual([]);
    expect(genericSkillsDoctor.installedChecks).toEqual([
      expect.objectContaining({
        target: "skills",
        installRoot: genericSkillRoot,
        skillRoot: genericSkillRoot,
        checkedFileCount: expect.any(Number),
        expectedFileCount: expect.any(Number)
      })
    ]);
    expect(genericSkillsDoctor.installedChecks[0]?.checkedFileCount).toBe(genericSkillsDoctor.installedChecks[0]?.expectedFileCount);
    await expectRegularPath(join(project, ".agents/skills/boreal-router/SKILL.md"));
    await expectRegularPath(join(project, ".claude/skills/boreal-router/SKILL.md"));
    await expectRegularPath(join(genericSkillRoot, "boreal-router/SKILL.md"));

    const consoleCommands: string[] = [];
    const running = await listenConsole({
      workspaceRoot: project,
      mode: "live",
      port: 0,
      runner: {
        run: async (args) => {
          consoleCommands.push(args.join(" "));
          return parseData<unknown>((await runBwrk(bwrk, args, project, env)).stdout);
        }
      }
    });
    try {
      const htmlResponse = await fetch(running.url);
      const html = await htmlResponse.text();
      const stateResponse = await fetch(`${running.url}/api/state`);
      const state = await stateResponse.json() as {
        readonly workspace?: { readonly mode?: string; readonly warnings?: readonly string[] };
      };
      expect(htmlResponse.status, `${html}\ncommands:\n${consoleCommands.join("\n")}`).toBe(200);
      expect(html).toContain("Boreal Console");
      expect(stateResponse.status, `${JSON.stringify(state)}\ncommands:\n${consoleCommands.join("\n")}`).toBe(200);
      expect(state.workspace?.mode).toBe("live");
    } finally {
      await running.close();
    }

    await runBwrk(bwrk, [
      "init",
      "--setup-memory",
      "--memory-root",
      siblingMemory,
      "--memory-layout",
      "sibling",
      "--memory-git-mode",
      "separate",
      "--json"
    ], siblingProject, env);
    await expectRegularPath(join(siblingMemory, ".git"));
    await expectNoTrackedMemoryContamination(siblingProject);
  }, 90_000);
});

async function tempRoot(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "boreal-package-smoke-")));
  tempDirs.push(dir);
  return dir;
}

async function initGit(cwd: string): Promise<void> {
  try {
    await run("git", ["init", "-b", "smoke"], cwd);
  } catch {
    await run("git", ["init"], cwd);
    await run("git", ["checkout", "-B", "smoke"], cwd);
  }
  await run("git", ["config", "user.email", "boreal-smoke@example.invalid"], cwd);
  await run("git", ["config", "user.name", "Boreal Smoke"], cwd);
  await writeFile(join(cwd, "README.md"), "package smoke fixture\n", "utf8");
  await run("git", ["add", "README.md"], cwd);
  await run("git", ["commit", "-m", "Initial fixture commit"], cwd);
}

async function expectNoTrackedMemoryContamination(cwd: string): Promise<void> {
  const status = await run("git", ["status", "--short", "--untracked-files=all"], cwd);
  const paths = status.stdout.split(/\r?\n/u).filter(Boolean);
  expect(paths.filter((path) => /\s(?:memory|\.boreal[\\/]memory)[\\/]/u.test(path))).toEqual([]);
}

async function expectRegularPath(path: string): Promise<void> {
  const info = await stat(path);
  expect(info.isDirectory() || info.isFile()).toBe(true);
}

async function runBwrk(command: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv): Promise<CommandRun> {
  return run(command, args, cwd, env);
}

async function run(
  command: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
  timeout = 30_000
): Promise<CommandRun> {
  try {
    const isWindowsCommandScript = process.platform === "win32" && /\.(?:cmd|bat)$/iu.test(command);
    const executable = isWindowsCommandScript ? process.env.ComSpec ?? "cmd.exe" : command;
    const executableArgs = isWindowsCommandScript
      ? ["/d", "/s", "/c", windowsCommandLine(command, args)]
      : [...args];
    const result = await execFileAsync(executable, executableArgs, {
      cwd,
      env,
      timeout,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024
    });
    return { stdout: String(result.stdout), stderr: String(result.stderr) };
  } catch (error) {
    const failure = error as { readonly stdout?: unknown; readonly stderr?: unknown; readonly message?: unknown };
    throw new Error(
      [
        typeof failure.message === "string" ? failure.message : `Command failed: ${command} ${args.join(" ")}`,
        "stdout:",
        String(failure.stdout ?? "").trim(),
        "stderr:",
        String(failure.stderr ?? "").trim()
      ].join("\n")
    );
  }
}

function windowsCommandLine(command: string, args: readonly string[]): string {
  return [command, ...args].map(cmdQuote).join(" ");
}

function cmdQuote(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

interface CommandRun {
  readonly stdout: string;
  readonly stderr: string;
}

interface SkillsDoctorPayload {
  readonly ok: boolean;
  readonly installedChecks: readonly Array<{
    readonly target: string;
    readonly installRoot: string;
    readonly skillRoot: string;
    readonly expectedFileCount: number;
    readonly checkedFileCount: number;
  }>;
  readonly issues: readonly unknown[];
}

function parseJson<T>(text: string): T {
  return JSON.parse(text) as T;
}

function parseData<T>(text: string): T {
  const envelope = parseJson<{ readonly ok: true; readonly data: T }>(text);
  expect(envelope.ok).toBe(true);
  return envelope.data;
}

async function workspacePackageDirs(): Promise<readonly string[]> {
  const dirs: string[] = [];
  for (const group of ["apps", "packages"]) {
    const entries = await readdir(join(repoRoot, group), { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const packageDir = `${group}/${entry.name}`;
      try {
        await stat(join(repoRoot, packageDir, "package.json"));
        dirs.push(packageDir);
      } catch {
        // Non-package folders under workspace globs are ignored by pnpm too.
      }
    }
  }
  return dirs.sort();
}

function pnpmImporterBlock(lockText: string, packageDir: string): string | undefined {
  const lines = lockText.split(/\r?\n/u);
  const start = lines.findIndex((line) => line === `  ${packageDir}:` || line === `  ${packageDir}: {}`);
  if (start < 0) {
    return undefined;
  }
  if (lines[start] === `  ${packageDir}: {}`) {
    return lines[start];
  }
  let end = start + 1;
  while (end < lines.length && !/^  [^ ].*: ?(?:\{\})?$/u.test(lines[end] ?? "")) {
    end += 1;
  }
  return lines.slice(start, end).join("\n");
}

function workspaceDependencyEntries(packageJson: WorkspacePackageJson): readonly [string, string][] {
  return Object
    .entries({
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
      ...packageJson.optionalDependencies
    })
    .filter((entry): entry is [string, string] => entry[1] === "workspace:*")
    .sort(([left], [right]) => left.localeCompare(right));
}

function workspaceDependencyPattern(dependencyName: string, specifier: string): RegExp {
  return new RegExp(
    [
      `^      ${escapeRegExp(yamlKey(dependencyName))}:`,
      `        specifier: ${escapeRegExp(specifier)}`,
      "        version: link:"
    ].join("\\n"),
    "m"
  );
}

function yamlKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/u.test(key) ? key : `'${key.replace(/'/gu, "''")}'`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

interface WorkspacePackageJson {
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
}
