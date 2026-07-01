import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { flagValue, parseArgs } from "../../apps/cli/src/args.ts";
import {
  COMMAND_DEFINITIONS,
  commandPath,
  registryValueFlagNames,
  validateCommandBehaviorMetadata
} from "../../apps/cli/src/command-registry.ts";
import { installJsonStdoutGuard, isBrokenPipeError, main } from "../../apps/cli/src/index.ts";
import { inspectBorealInstallStatus } from "../../apps/cli/src/install-status.ts";
import type { CliOutput } from "../../apps/cli/src/output.ts";
import { inspectWorkflowAssets } from "../../apps/cli/src/workflow-assets.ts";

interface CommandRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface DoctorPayload {
  readonly ok: boolean;
  readonly fixed: boolean;
  readonly diagnostics: readonly Array<{
    readonly code: string;
    readonly severity: string;
    readonly message: string;
    readonly details?: unknown;
  }>;
}

interface MutableActorForTest {
  id: string;
  [key: string]: unknown;
}

interface MutableMetaForTest {
  readonly id: string;
  readonly createdBy: MutableActorForTest;
  readonly updatedBy: MutableActorForTest;
  readonly tags: readonly string[];
  readonly [key: string]: unknown;
}

interface MutableWorkForTest {
  readonly meta: MutableMetaForTest;
  readonly title: string;
  readonly labels: readonly string[];
  readonly [key: string]: unknown;
}

interface MutableStateForTest {
  readonly workItems: readonly MutableWorkForTest[];
  readonly [key: string]: unknown;
}

const tempDirs: string[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("bwrk cli", () => {
  it("documents every current command group", async () => {
    const commands = await readFile(new URL("../../docs/cli/COMMANDS.md", import.meta.url), "utf8");
    const packageJson = parseJson<{ readonly scripts: Record<string, string> }>(
      await readFile(new URL("../../package.json", import.meta.url), "utf8")
    );

    for (const heading of ["## Help", ...COMMAND_DEFINITIONS.map((definition) => `## \`${commandPath(definition)}\``)]) {
      expect(commands).toContain(heading);
    }
    for (const definition of COMMAND_DEFINITIONS) {
      expect(commands, `${commandPath(definition)} usage drifted from COMMAND_DEFINITIONS`).toContain(definition.usage);
    }
    expect(commands).toContain("[--priority low|normal|high|critical]");
    expect(commands).toContain("`--view dashboard` changes only human rendering; JSON mode still returns the same schema-backed payload.");
    expect(commands).toContain("pnpm doctor:strict");
    expect(packageJson.scripts["doctor:strict"]).toBe(
      "tsx --tsconfig tsconfig.base.json apps/cli/src/index.ts doctor --workspace . --strict --json"
    );
  });

  it("prints root and grouped help without a workspace", async () => {
    const rootDir = await makeTempWorkspace();

    const root = await runCli(rootDir, ["help"]);
    const work = await runCli(rootDir, ["help", "work"]);
    const workWithFlag = await runCli(rootDir, ["help", "work", "--help"]);
    const doctor = await runCli(rootDir, ["doctor", "--help"]);

    expect(root.exitCode).toBe(0);
    expect(root.stdout).toContain("Boreal Work");
    // Grouped overview: section headers + the per-command help pointer.
    expect(root.stdout).toContain("WORK");
    expect(root.stdout).toContain("KNOWLEDGE");
    expect(root.stdout).toContain("bwrk help <command>");
    expect(root.stdout).toContain("bwrk --about");

    const about = await runCli(rootDir, ["--about"]);
    expect(about.exitCode).toBe(0);
    expect(about.stdout).toContain("Boreal Work");
    expect(about.stdout).toContain("Matt Richmond");
    expect(work.exitCode).toBe(0);
    expect(work.stdout).toContain("bwrk work create");
    expect(work.stdout).toContain("--force --reason");
    expect(workWithFlag.exitCode).toBe(0);
    expect(workWithFlag.stdout).toContain("bwrk work create");
    expect(doctor.exitCode).toBe(0);
    expect(doctor.stdout).toContain("bwrk doctor");

    const missing = await runCli(rootDir, ["help", "missing", "--json"]);
    const payload = parseJson<{ readonly ok: false; readonly code: string }>(missing.stderr);
    expect(missing.exitCode).toBe(2);
    expect(payload.ok).toBe(false);
    expect(payload.code).toBe("BOREAL_INVALID_INPUT");
  });

  it("fails closed before init", async () => {
    const rootDir = await makeTempWorkspace();

    const result = await runCli(rootDir, ["work", "list", "--json"]);
    const payload = parseJson<{ readonly ok: false; readonly code: string; readonly message: string }>(result.stderr);

    expect(result.exitCode).toBe(2);
    expect(payload.ok).toBe(false);
    expect(payload.code).toBe("BOREAL_INVALID_INPUT");
    expect(payload.message).toContain("not initialized");
  });

  it("initializes and validates the repo-local memory vault", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);

    const missingStatus = await runCli(rootDir, ["vault", "status", "--json"]);
    const missingPayload = parseData<{
      readonly ok: boolean;
      readonly initialized: boolean;
      readonly missingDirectories: readonly string[];
      readonly missingFiles: readonly string[];
    }>(missingStatus.stdout);
    expect(missingStatus.exitCode).toBe(1);
    expect(missingPayload.ok).toBe(false);
    expect(missingPayload.initialized).toBe(false);
    expect(missingPayload.missingDirectories).toContain("memory/wiki");
    expect(missingPayload.missingFiles).toContain("memory/raw/index.jsonl");

    const warningDoctor = await runCli(rootDir, ["doctor", "--json"]);
    expect(parseData<{ readonly diagnostics: Array<{ readonly code: string; readonly severity: string }> }>(
      warningDoctor.stdout
    ).diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "vault.structure", severity: "warning" })])
    );

    const initialized = await runCli(rootDir, ["vault", "init", "--json"]);
    const initPayload = parseData<{
      readonly ok: boolean;
      readonly initialized: boolean;
      readonly createdDirectories: readonly string[];
      readonly createdFiles: readonly string[];
    }>(initialized.stdout);
    expect(initialized.exitCode).toBe(0);
    expect(initPayload.ok).toBe(true);
    expect(initPayload.initialized).toBe(true);
    expect(initPayload.createdDirectories).toEqual(expect.arrayContaining(["memory/wiki", "memory/.boreal/cache"]));
    expect(initPayload.createdFiles).toEqual(
      expect.arrayContaining(["memory/index.md", "memory/raw/index.jsonl", "memory/graph/relationships.jsonl"])
    );
    expect(await readFile(join(rootDir, "memory/index.md"), "utf8")).toContain("Boreal Memory Vault");

    const idempotent = await runCli(rootDir, ["vault", "init", "--json"]);
    expect(parseData<{ readonly createdDirectories: readonly string[]; readonly createdFiles: readonly string[] }>(
      idempotent.stdout
    )).toEqual(expect.objectContaining({ createdDirectories: [], createdFiles: [] }));

    const readyStatus = await runCli(rootDir, ["vault", "status", "--json"]);
    expect(readyStatus.exitCode).toBe(0);
    expect(parseData<{ readonly ok: boolean; readonly initialized: boolean }>(readyStatus.stdout)).toEqual(
      expect.objectContaining({ ok: true, initialized: true })
    );

    const readyDoctor = await runCli(rootDir, ["doctor", "--json"]);
    expect(parseData<{ readonly diagnostics: Array<{ readonly code: string; readonly severity: string }> }>(
      readyDoctor.stdout
    ).diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "vault.structure", severity: "ok" })])
    );
  });

  it("configures project setup and scoped memory roots from init flags", async () => {
    const rootDir = await makeTempWorkspace();
    const initialized = await runCli(rootDir, [
      "init",
      "--setup-memory",
      "--memory-root",
      "memory",
      "--memory-layout",
      "child",
      "--separate-git",
      "--install-root",
      ".agents/skills",
      "--skill-target",
      "codex",
      "--skill-target",
      "claude",
      "--folder-scoped",
      "--json"
    ]);
    const payload = parseData<{
      readonly initialized: boolean;
      readonly projectSetup: {
        readonly configured: true;
        readonly configPath: string;
        readonly config: {
          readonly schemaVersion: string;
          readonly projectRoot: string;
          readonly memoryRoot: string;
          readonly memoryLayout: string;
          readonly memoryGitMode: string;
          readonly installRoot: string;
          readonly skillTargets: readonly string[];
          readonly folderScoped: boolean;
        };
        readonly gitSetup: {
          readonly memoryGitMode: string;
          readonly memoryRepoInitialized: boolean;
          readonly memoryRepoExisting: boolean;
          readonly memoryGitignoreUpdated: boolean;
          readonly projectGitignoreUpdated: boolean;
          readonly gitmodulesUpdated: boolean;
          readonly ignoredByProject: boolean;
        };
        readonly createdDirectories: readonly string[];
        readonly createdFiles: readonly string[];
      };
      readonly skillInstalls: readonly Array<{
        readonly target: string;
        readonly installRoot: string;
        readonly skillRoot: string;
        readonly fileCount: number;
      }>;
    }>(initialized.stdout);
    const config = parseJson<typeof payload.projectSetup.config>(await readFile(join(rootDir, ".boreal/project.json"), "utf8"));

    expect(initialized.exitCode).toBe(0);
    expect(payload.initialized).toBe(true);
    expect(payload.projectSetup.configPath).toBe(join(rootDir, ".boreal/project.json"));
    expect(payload.projectSetup.config).toEqual(
      expect.objectContaining({
        schemaVersion: "boreal.project-setup.v1",
        projectRoot: rootDir,
        memoryRoot: join(rootDir, "memory"),
        memoryLayout: "child",
        memoryGitMode: "separate",
        installRoot: join(rootDir, ".agents/skills"),
        skillInstallRoots: [
          {
            target: "codex",
            installRoot: join(rootDir, ".agents/skills"),
            skillRoot: join(rootDir, ".agents/skills")
          },
          {
            target: "claude",
            installRoot: join(rootDir, ".claude"),
            skillRoot: join(rootDir, ".claude/skills")
          }
        ],
        skillTargets: ["codex", "claude"],
        folderScoped: true
      })
    );
    expect(config).toEqual(expect.objectContaining(payload.projectSetup.config));
    expect(payload.skillInstalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target: "codex",
          installRoot: join(rootDir, ".agents/skills"),
          skillRoot: join(rootDir, ".agents/skills")
        }),
        expect.objectContaining({
          target: "claude",
          installRoot: join(rootDir, ".claude"),
          skillRoot: join(rootDir, ".claude/skills")
        })
      ])
    );
    expect(payload.projectSetup.createdDirectories).toEqual(
      expect.arrayContaining(["memory", "wiki", ".boreal/cache"])
    );
    expect(payload.projectSetup.createdFiles).toEqual(
      expect.arrayContaining(["index.md", "raw/index.jsonl", "graph/relationships.jsonl"])
    );
    expect(payload.projectSetup.gitSetup).toEqual(
      expect.objectContaining({
        memoryGitMode: "separate",
        memoryRepoInitialized: true,
        memoryRepoExisting: false,
        memoryGitignoreUpdated: true,
        projectGitignoreUpdated: true,
        gitmodulesUpdated: false,
        ignoredByProject: true
      })
    );
    expect(await readFile(join(rootDir, "memory/index.md"), "utf8")).toContain("Boreal Memory Vault");
    expect(await fileMissing(join(rootDir, ".agents/skills/boreal-router/SKILL.md"))).toBe(false);
    expect(await fileMissing(join(rootDir, ".claude/skills/boreal-router/SKILL.md"))).toBe(false);
    expect(await readFile(join(rootDir, "memory/raw/index.jsonl"), "utf8")).toBe("");
    expect(await readFile(join(rootDir, "memory/.gitignore"), "utf8")).toContain(".boreal/locks/");
    expect(await fileMissing(join(rootDir, "memory/.git"))).toBe(false);
    const projectGitignore = await readFile(join(rootDir, ".gitignore"), "utf8");
    expect(projectGitignore).toContain(".boreal/project.json");
    expect(projectGitignore).toContain(".boreal/mcp.json");
    expect(projectGitignore).toContain(".boreal/ledgers/");
    expect(projectGitignore).toContain(".agents/");
    expect(projectGitignore).toContain(".claude/");
    expect(projectGitignore).toContain("/memory/");
    expect(await fileMissing(join(rootDir, ".gitmodules"))).toBe(true);

    const idempotent = await runCli(rootDir, [
      "init",
      "--setup-memory",
      "--memory-root",
      "memory",
      "--memory-layout",
      "child",
      "--separate-git",
      "--json"
    ]);
    const idempotentPayload = parseData<{
      readonly projectSetup: {
        readonly config: { readonly createdAt: string; readonly updatedAt: string };
        readonly gitSetup: { readonly memoryRepoInitialized: boolean; readonly memoryRepoExisting: boolean; readonly projectGitignoreUpdated: boolean };
        readonly createdDirectories: readonly string[];
        readonly createdFiles: readonly string[];
      };
    }>(
      idempotent.stdout
    ).projectSetup;
    expect(idempotentPayload).toEqual(expect.objectContaining({ createdDirectories: [], createdFiles: [] }));
    expect(idempotentPayload.config.createdAt).toBe(config.createdAt);
    expect(idempotentPayload.gitSetup).toEqual(
      expect.objectContaining({ memoryRepoInitialized: false, memoryRepoExisting: true, projectGitignoreUpdated: false })
    );

    await writeFile(join(rootDir, ".boreal/project.json"), "{\"schemaVersion\":\"wrong\"}\n", "utf8");
    const invalidConfig = await runCli(rootDir, ["init", "--setup-memory", "--memory-root", "memory", "--json"]);
    const invalidConfigPayload = parseJson<{ readonly code: string; readonly message: string }>(invalidConfig.stderr);
    expect(invalidConfig.exitCode).toBe(1);
    expect(invalidConfigPayload.code).toBe("BOREAL_CONFLICT");
    expect(invalidConfigPayload.message).toContain("Existing project setup config is invalid");
  });

  it("validates project-scoped MCP config drift in doctor", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, [
      "init",
      "--setup-memory",
      "--memory-root",
      "memory",
      "--memory-layout",
      "in-repo",
      "--memory-git-mode",
      "shared",
      "--json"
    ]);

    await writeFile(
      join(rootDir, ".boreal/mcp.json"),
      `${JSON.stringify(
        {
          schemaVersion: "boreal.mcp-config.v1",
          workspaceRoot: rootDir,
          projectRoot: rootDir,
          memoryRoot: join(rootDir, "memory"),
          memoryLayout: "in-repo",
          command: "node",
          args: ["apps/mcp/dist/index.js", "--workspace", "."]
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const scoped = parseData<DoctorPayload>((await runCli(rootDir, ["doctor", "--json"])).stdout);
    expect(scoped.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "mcp.config",
          severity: "ok",
          message: "MCP config is scoped to this project"
        })
      ])
    );

    await writeFile(
      join(rootDir, ".boreal/mcp.json"),
      `${JSON.stringify(
        {
          schemaVersion: "boreal.mcp-config.v1",
          workspaceRoot: "/tmp/other-project",
          projectRoot: "/tmp/other-project",
          memoryRoot: "/tmp/other-project/memory",
          memoryLayout: "in-repo",
          command: "node",
          args: ["apps/mcp/dist/index.js"]
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const drift = await runCli(rootDir, ["doctor", "--strict", "--json"]);
    const driftPayload = parseData<DoctorPayload>(drift.stdout);
    const mcpDiagnostic = driftPayload.diagnostics.find((diagnostic) => diagnostic.code === "mcp.config");

    expect(drift.exitCode).toBe(1);
    expect(mcpDiagnostic).toEqual(
      expect.objectContaining({
        severity: "warning",
        message: "MCP config drift detected"
      })
    );
    expect(JSON.stringify(mcpDiagnostic?.details)).toContain("args must include --workspace <project-root>");
  });

  it("surfaces daemon status in CLI, doctor, and global dashboard", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, [
      "init",
      "--setup-memory",
      "--memory-root",
      "memory",
      "--memory-layout",
      "in-repo",
      "--memory-git-mode",
      "shared",
      "--json"
    ]);

    const status = parseData<{ readonly state: string; readonly watch: { readonly writesTruth: boolean } }>(
      (await runCli(rootDir, ["daemon", "status", "--json"])).stdout
    );
    expect(status.state).toBe("stopped");
    expect(status.watch.writesTruth).toBe(false);

    const dashboard = parseData<{
      readonly daemonStatus: { readonly projects: readonly Array<{ readonly projectRoot: string; readonly state: string }> };
    }>((await runCli(rootDir, ["dashboard", "global", "--json"])).stdout);
    expect(dashboard.daemonStatus.projects).toEqual(
      expect.arrayContaining([expect.objectContaining({ projectRoot: rootDir, state: "stopped" })])
    );

    await mkdir(join(rootDir, ".boreal/daemon"), { recursive: true });
    await writeFile(
      join(rootDir, ".boreal/daemon/status.json"),
      `${JSON.stringify(
        {
          schemaVersion: "boreal.daemon.status.v1",
          workspaceRoot: rootDir,
          projectRoot: rootDir,
          memoryRoot: join(rootDir, "memory"),
          memoryLayout: "in-repo",
          pid: 999_999,
          state: "running",
          startedAt: "2026-06-27T00:00:00.000Z",
          updatedAt: "2026-06-27T00:00:00.000Z"
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const drift = await runCli(rootDir, ["doctor", "--strict", "--json"]);
    const driftPayload = parseData<DoctorPayload>(drift.stdout);
    expect(drift.exitCode).toBe(0);
    expect(driftPayload.ok).toBe(true);
    expect(driftPayload.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "daemon.status", severity: "warning" })])
    );
  });

  it("manages machine-local project registry entries and doctors drift", async () => {
    const rootDir = await makeTempWorkspace();
    const registryRoot = join(rootDir, "registry-home");
    await runCli(rootDir, [
      "init",
      "--setup-memory",
      "--memory-root",
      "memory",
      "--memory-layout",
      "in-repo",
      "--memory-git-mode",
      "shared",
      "--install-root",
      ".agents/skills",
      "--json"
    ]);
    await mkdir(join(rootDir, ".agents/skills"), { recursive: true });

    const empty = parseData<{ readonly entries: readonly unknown[]; readonly entryCount: number }>(
      (await runCli(rootDir, ["registry", "list", "--registry-root", registryRoot, "--json"])).stdout
    );
    expect(empty.entries).toEqual([]);
    expect(empty.entryCount).toBe(0);

    const missingWorkspace = await runCli(rootDir, ["registry", "add", "--registry-root", registryRoot, "--json"]);
    expect(missingWorkspace.exitCode).toBe(2);
    expect(parseJson<{ readonly code: string }>(missingWorkspace.stderr).code).toBe("BOREAL_INVALID_INPUT");

    const imported = parseData<{
      readonly imported: true;
      readonly changed: boolean;
      readonly added: boolean;
      readonly replaced: boolean;
      readonly entry: { readonly id: string; readonly projectRoot: string };
      readonly entryCount: number;
    }>((await runCli(rootDir, ["registry", "import-setup", "--registry-root", registryRoot, "--json"])).stdout);
    expect(imported).toEqual(
      expect.objectContaining({
        imported: true,
        changed: true,
        added: true,
        replaced: false,
        entryCount: 1
      })
    );
    expect(imported.entry.projectRoot).toBe(rootDir);

    const importedAgain = parseData<{
      readonly imported: true;
      readonly changed: boolean;
      readonly added: boolean;
      readonly replaced: boolean;
      readonly entry: { readonly id: string };
      readonly entryCount: number;
    }>((await runCli(rootDir, ["registry", "import-setup", "--registry-root", registryRoot, "--json"])).stdout);
    expect(importedAgain).toEqual(
      expect.objectContaining({
        imported: true,
        changed: false,
        added: false,
        replaced: false,
        entryCount: 1
      })
    );
    expect(importedAgain.entry.id).toBe(imported.entry.id);

    const added = parseData<{
      readonly added: boolean;
      readonly entry: {
        readonly id: string;
        readonly display: { readonly name: string; readonly labels: readonly string[] };
        readonly projectRoot: string;
        readonly memoryRoot: string;
        readonly installRoot: string;
      };
      readonly entryCount: number;
    }>(
      (
        await runCli(rootDir, [
          "registry",
          "add",
          "--workspace",
          rootDir,
          "--registry-root",
          registryRoot,
          "--name",
          "Boreal Test",
          "--label",
          "CLI",
          "--json"
        ])
      ).stdout
    );

    expect(added.added).toBe(false);
    expect(added.entry.display).toEqual({ name: "Boreal Test", labels: ["cli"] });
    expect(added.entry.projectRoot).toBe(rootDir);
    expect(added.entry.memoryRoot).toBe(join(rootDir, "memory"));
    expect(added.entry.installRoot).toBe(join(rootDir, ".agents/skills"));
    expect(added.entryCount).toBe(1);

    const listed = parseData<{ readonly entries: Array<{ readonly id: string; readonly projectRoot: string }> }>(
      (await runCli(rootDir, ["registry", "list", "--registry-root", registryRoot, "--json"])).stdout
    );
    expect(listed.entries).toEqual([expect.objectContaining({ id: added.entry.id, projectRoot: rootDir })]);

    const healthy = await runCli(rootDir, ["registry", "doctor", "--registry-root", registryRoot, "--json"]);
    const healthyPayload = parseData<{
      readonly ok: boolean;
      readonly findings: Array<{ readonly code: string; readonly severity: string }>;
    }>(healthy.stdout);
    expect(healthy.exitCode).toBe(0);
    expect(healthyPayload.ok).toBe(true);
    expect(healthyPayload.findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "registry.memory_root", severity: "ok" })])
    );

    const configPath = join(rootDir, ".boreal/project.json");
    const config = parseJson<Record<string, unknown>>(await readFile(configPath, "utf8"));
    await writeFile(configPath, `${JSON.stringify({ ...config, memoryRoot: join(rootDir, "other-memory") }, null, 2)}\n`, "utf8");

    const drift = await runCli(rootDir, ["registry", "doctor", "--registry-root", registryRoot, "--json"]);
    const driftPayload = parseData<{
      readonly ok: boolean;
      readonly findings: Array<{ readonly code: string; readonly severity: string }>;
    }>(drift.stdout);
    expect(drift.exitCode).toBe(1);
    expect(driftPayload.ok).toBe(false);
    expect(driftPayload.findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "registry.memory_root_mismatch", severity: "error" })])
    );

    const removed = parseData<{ readonly removed: true; readonly entryCount: number }>(
      (await runCli(rootDir, ["registry", "remove", added.entry.id, "--registry-root", registryRoot, "--json"])).stdout
    );
    expect(removed).toEqual(expect.objectContaining({ removed: true, entryCount: 0 }));
  });

  it("emits bounded global dashboard payloads for empty, registered, and stale registries", async () => {
    const rootDir = await makeTempWorkspace();
    const secondRoot = await makeTempWorkspace();
    const registryRoot = join(rootDir, "registry-home");
    for (const workspace of [rootDir, secondRoot]) {
      await runCli(workspace, [
        "init",
        "--setup-memory",
        "--memory-root",
        "memory",
        "--memory-layout",
        "in-repo",
        "--memory-git-mode",
        "shared",
        "--install-root",
        ".agents/skills",
        "--json"
      ]);
      await mkdir(join(workspace, ".agents/skills"), { recursive: true });
    }

    const empty = parseData<{
      readonly schemaVersion: string;
      readonly limits: { readonly projects: number; readonly queueRowsPerQueue: number; readonly searchPerProject: number; readonly activityPerProject: number };
      readonly truncated: { readonly projects: boolean };
      readonly registry: { readonly summary: { readonly totalProjects: number }; readonly entries: Array<{ readonly projectRoot: string }> };
      readonly globalSettings: { readonly projects: Array<{ readonly projectRoot: string; readonly validateCommand: string }> };
    }>((await runCli(rootDir, ["dashboard", "global", "--registry-root", registryRoot, "--json"])).stdout);
    expect(empty.schemaVersion).toBe("boreal.cli.dashboard.global.v1");
    expect(empty.limits).toMatchObject({ projects: 100, queueRowsPerQueue: 200, searchPerProject: 10, activityPerProject: 20 });
    expect(empty.truncated.projects).toBe(false);
    expect(empty.registry.summary.totalProjects).toBe(1);
    expect(empty.registry.entries[0]?.projectRoot).toBe(rootDir);
    expect(empty.globalSettings.projects[0]?.validateCommand).toBe(`bwrk --workspace ${rootDir} doctor --json`);

    const human = await runCli(rootDir, ["dashboard", "global", "--registry-root", registryRoot]);
    expect(human.exitCode).toBe(0);
    expect(human.stdout).toContain("project");
    expect(human.stdout).not.toContain("schemaVersion");

    await runCli(rootDir, ["registry", "import-setup", "--registry-root", registryRoot, "--json"]);
    await runCli(secondRoot, ["registry", "import-setup", "--registry-root", registryRoot, "--json"]);

    const capped = parseData<{
      readonly truncated: { readonly projects: boolean };
      readonly registry: { readonly entries: readonly unknown[] };
      readonly globalQueues: { readonly queues: Array<{ readonly items: readonly unknown[] }> };
    }>((await runCli(rootDir, ["dashboard", "global", "--registry-root", registryRoot, "--limit", "1", "--json"])).stdout);
    expect(capped.truncated.projects).toBe(true);
    expect(capped.registry.entries).toHaveLength(1);
    expect(capped.globalQueues.queues.every((queue) => queue.items.length <= 200)).toBe(true);

    const configPath = join(rootDir, ".boreal/project.json");
    const config = parseJson<Record<string, unknown>>(await readFile(configPath, "utf8"));
    await writeFile(configPath, `${JSON.stringify({ ...config, memoryRoot: join(rootDir, "other-memory") }, null, 2)}\n`, "utf8");

    const stale = parseData<{
      readonly registry: {
        readonly entries: Array<{
          readonly projectRoot: string;
          readonly health: string;
          readonly stale: boolean;
          readonly findings: Array<{ readonly code: string; readonly severity: string; readonly source?: string }>;
        }>;
      };
      readonly globalHealth: {
        readonly summary: { readonly errorProjects: number; readonly setupFindings: number };
        readonly findings: Array<{ readonly code: string; readonly projectRoot: string; readonly sourcePath: string }>;
      };
    }>((await runCli(rootDir, ["dashboard", "global", "--registry-root", registryRoot, "--json"])).stdout);
    const staleEntry = stale.registry.entries.find((entry) => entry.projectRoot === rootDir);
    expect(staleEntry).toMatchObject({ health: "error", stale: true });
    expect(staleEntry?.findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "registry.memory_root_mismatch", severity: "error" })])
    );
    expect(stale.globalHealth.summary.errorProjects).toBeGreaterThanOrEqual(1);
    expect(stale.globalHealth.summary.setupFindings).toBeGreaterThanOrEqual(1);
    expect(stale.globalHealth.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "registry.memory_root_mismatch",
          projectRoot: rootDir,
          sourcePath: join(rootDir, "memory")
        })
      ])
    );
  });

  it("manages active sprint command contracts with workspace-scoped audit events", async () => {
    const rootDir = await makeTempWorkspace();
    const otherRoot = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);
    await runCli(otherRoot, ["init", "--json"]);
    const sprint = parseData<{ readonly meta: { readonly id: string }; readonly kind: string }>(
      (await runCli(rootDir, ["work", "create", "Sprint Alpha", "--kind", "sprint", "--ready", "--json"])).stdout
    );
    const phase = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Phase Alpha", "--kind", "milestone", "--ready", "--json"])).stdout
    );
    const task = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Task Alpha", "--kind", "task", "--ready", "--json"])).stdout
    );
    await runCli(rootDir, ["dep", "add", sprint.meta.id, phase.meta.id, "--json"]);
    await runCli(rootDir, ["dep", "add", phase.meta.id, task.meta.id, "--json"]);

    const emptyCurrent = parseData<{ readonly active: boolean; readonly stale: boolean }>(
      (await runCli(rootDir, ["sprint", "current", "--json"])).stdout
    );
    expect(emptyCurrent).toEqual(expect.objectContaining({ active: false, stale: false }));

    const activated = parseData<{
      readonly activeSprintId: string;
      readonly projectionId: string;
      readonly eventId: string;
      readonly workspaceRoot: string;
    }>(
      (
        await runCli(rootDir, [
          "sprint",
          "activate",
          sprint.meta.id,
          "--session",
          "Sprint Session",
          "--actor",
          "Sprint Agent",
          "--actor-kind",
          "agent",
          "--json"
        ])
      ).stdout
    );
    expect(activated).toEqual(
      expect.objectContaining({
        activeSprintId: sprint.meta.id,
        workspaceRoot: rootDir
      })
    );
    expect(activated.projectionId).toMatch(/^bw_projection_/);
    expect(activated.eventId).toMatch(/^bw_event_/);

    const current = parseData<{
      readonly active: boolean;
      readonly activeSprintId: string;
      readonly sprint: { readonly id: string; readonly kind: string };
      readonly scope: { readonly totalDescendants: number; readonly descendants: Array<{ readonly id: string }> };
    }>((await runCli(rootDir, ["sprint", "current", "--json"])).stdout);
    expect(current.active).toBe(true);
    expect(current.activeSprintId).toBe(sprint.meta.id);
    expect(current.sprint).toEqual(expect.objectContaining({ id: sprint.meta.id, kind: "sprint" }));
    expect(current.scope.totalDescendants).toBe(2);
    expect(current.scope.descendants.map((item) => item.id)).toEqual(expect.arrayContaining([phase.meta.id, task.meta.id]));

    const shown = parseData<{
      readonly active: boolean;
      readonly scope: {
        readonly directChildren: Array<{ readonly id: string }>;
        readonly descendants: Array<{ readonly id: string }>;
        readonly totalDescendants: number;
        readonly truncated: boolean;
      };
    }>((await runCli(rootDir, ["sprint", "show", "current", "--limit", "1", "--json"])).stdout);
    expect(shown.active).toBe(true);
    expect(shown.scope.directChildren.map((item) => item.id)).toContain(phase.meta.id);
    expect(shown.scope.descendants).toHaveLength(1);
    expect(shown.scope.totalDescendants).toBe(2);
    expect(shown.scope.truncated).toBe(true);

    const listed = parseData<{ readonly activeSprintId: string; readonly sprints: Array<{ readonly id: string; readonly active: boolean }> }>(
      (await runCli(rootDir, ["sprint", "list", "--json"])).stdout
    );
    expect(listed.activeSprintId).toBe(sprint.meta.id);
    expect(listed.sprints).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: sprint.meta.id, active: true })])
    );

    const otherCurrent = parseData<{ readonly active: boolean }>((await runCli(otherRoot, ["sprint", "current", "--json"])).stdout);
    expect(otherCurrent.active).toBe(false);

    const state = parseJson<{
      readonly projections: Array<{ readonly meta: { readonly id: string }; readonly kind: string; readonly subjectId: string; readonly value: Record<string, unknown> }>;
      readonly events: Array<{ readonly meta: { readonly id: string }; readonly type: string; readonly subjectId: string; readonly operationId?: string }>;
      readonly operations: Array<{ readonly meta: { readonly id: string }; readonly commandPath: string; readonly eventIds: readonly string[]; readonly actorId: string }>;
    }>(await readFile(join(rootDir, ".boreal/runtime/state.json"), "utf8"));
    const projection = state.projections.find((record) => record.meta.id === activated.projectionId);
    const event = state.events.find((record) => record.meta.id === activated.eventId);
    const operation = state.operations.find((record) => record.commandPath === "sprint activate");
    expect(projection).toEqual(
      expect.objectContaining({
        kind: "active-sprint",
        subjectId: "workspace",
        value: expect.objectContaining({ sprintId: sprint.meta.id, eventId: activated.eventId, workspaceRoot: rootDir })
      })
    );
    expect(event).toEqual(
      expect.objectContaining({
        type: "sprint.activated",
        subjectId: sprint.meta.id,
        operationId: operation?.meta.id
      })
    );
    expect(operation).toEqual(expect.objectContaining({ actorId: "sprint agent" }));
    expect(operation?.eventIds).toContain(activated.eventId);

    const invalid = await runCli(rootDir, ["sprint", "activate", phase.meta.id, "--json"]);
    expect(invalid.exitCode).toBe(2);
    expect(parseJson<{ readonly code: string }>(invalid.stderr).code).toBe("BOREAL_INVALID_INPUT");

    await runCli(rootDir, ["work", "create", "Duplicate Sprint", "--kind", "sprint", "--ready", "--json"]);
    await runCli(rootDir, ["work", "create", "Duplicate Sprint", "--kind", "sprint", "--ready", "--json"]);
    const ambiguous = await runCli(rootDir, ["sprint", "show", "Duplicate Sprint", "--json"]);
    expect(ambiguous.exitCode).toBe(1);
    expect(parseJson<{ readonly code: string }>(ambiguous.stderr).code).toBe("BOREAL_CONFLICT");
  });

  it("emits sprint board projections from graph scope with active blockers and reservations", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);
    const sprint = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Board Sprint", "--kind", "sprint", "--ready", "--json"])).stdout
    );
    const phase = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Board Phase", "--kind", "milestone", "--ready", "--json"])).stdout
    );
    const blockedTask = parseData<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "work",
          "create",
          "Blocked Board Task",
          "--kind",
          "task",
          "--priority",
          "critical",
          "--ready",
          "--json"
        ])
      ).stdout
    );
    const reservedTask = parseData<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "work",
          "create",
          "Reserved Board Task",
          "--kind",
          "task",
          "--priority",
          "high",
          "--ready",
          "--json"
        ])
      ).stdout
    );
    const verifiedTask = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Verified Board Task", "--kind", "task", "--ready", "--json"])).stdout
    );
    const activeBlocker = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Open Board Blocker", "--kind", "task", "--ready", "--json"])).stdout
    );
    const closedBlocker = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Closed Board Blocker", "--kind", "task", "--ready", "--json"])).stdout
    );

    await runCli(rootDir, ["dep", "add", sprint.meta.id, phase.meta.id, "--json"]);
    await runCli(rootDir, ["dep", "add", sprint.meta.id, blockedTask.meta.id, "--json"]);
    await runCli(rootDir, ["dep", "add", sprint.meta.id, reservedTask.meta.id, "--json"]);
    await runCli(rootDir, ["dep", "add", sprint.meta.id, verifiedTask.meta.id, "--json"]);
    await runCli(rootDir, ["dep", "add", blockedTask.meta.id, activeBlocker.meta.id, "--json"]);
    await runCli(rootDir, ["dep", "add", blockedTask.meta.id, closedBlocker.meta.id, "--json"]);

    const taskEvidence = parseData<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "evidence",
          "add",
          blockedTask.meta.id,
          "--summary",
          "Board task evidence.",
          "--outcome",
          "observed",
          "--json"
        ])
      ).stdout
    );
    expect(taskEvidence.meta.id).toMatch(/^bw_evidence_/);
    const verifiedEvidence = parseData<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "evidence",
          "add",
          verifiedTask.meta.id,
          "--summary",
          "Verified board task passed.",
          "--outcome",
          "passed",
          "--json"
        ])
      ).stdout
    );
    await runCli(rootDir, ["work", "verify", verifiedTask.meta.id, "--evidence", verifiedEvidence.meta.id, "--verdict", "passed", "--json"]);
    const blockerEvidence = parseData<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "evidence",
          "add",
          closedBlocker.meta.id,
          "--summary",
          "Closed blocker passed.",
          "--outcome",
          "passed",
          "--json"
        ])
      ).stdout
    );
    await runCli(rootDir, ["work", "verify", closedBlocker.meta.id, "--evidence", blockerEvidence.meta.id, "--verdict", "passed", "--json"]);
    await runCli(rootDir, [
      "work",
      "close",
      closedBlocker.meta.id,
      "--reason",
      "resolved for board test",
      "--dirty-path",
      "no_repo_changes: board fixture",
      "--json"
    ]);
    await runCli(rootDir, ["work", "reserve", reservedTask.meta.id, "--agent", "board-agent", "--purpose", "board test", "--json"]);
    await runCli(rootDir, ["sprint", "activate", sprint.meta.id, "--json"]);

    const result = parseData<{
      readonly schemaVersion: string;
      readonly active: boolean;
      readonly selectedSprintId: string;
      readonly scope: { readonly totalDescendants: number; readonly truncated: boolean };
      readonly board: {
        readonly phases: Array<{ readonly id: string }>;
        readonly lanes: Array<{ readonly id: string; readonly items: Array<{ readonly id: string; readonly activeReservationId?: string; readonly dependencyIds: readonly string[]; readonly activeBlockerIds: readonly string[]; readonly evidenceCount: number; readonly verificationCount: number }> }>;
        readonly summary: {
          readonly sprintId: string;
          readonly phaseCount: number;
          readonly taskCount: number;
          readonly activeBlockerCount: number;
          readonly activeReservations: number;
          readonly blocked: number;
          readonly inProgress: number;
          readonly verified: number;
        };
      };
    }>((await runCli(rootDir, ["sprint", "board", "--json"])).stdout);

    expect(result).toEqual(
      expect.objectContaining({
        schemaVersion: "boreal.cli.sprint.board.v1",
        active: true,
        selectedSprintId: sprint.meta.id,
        scope: expect.objectContaining({ totalDescendants: 6, truncated: false })
      })
    );
    expect(result.board.summary).toEqual(
      expect.objectContaining({
        sprintId: sprint.meta.id,
        phaseCount: 1,
        taskCount: 5,
        activeBlockerCount: 1,
        activeReservations: 1,
        blocked: 1,
        inProgress: 1,
        verified: 1
      })
    );
    expect(result.board.phases.map((item) => item.id)).toEqual([phase.meta.id]);
    const blockedRow = result.board.lanes.find((lane) => lane.id === "blocked")?.items.find((item) => item.id === blockedTask.meta.id);
    expect(blockedRow).toEqual(
      expect.objectContaining({
        dependencyIds: expect.arrayContaining([activeBlocker.meta.id, closedBlocker.meta.id]),
        activeBlockerIds: [activeBlocker.meta.id],
        evidenceCount: 1,
        verificationCount: 0
      })
    );
    const verifiedRow = result.board.lanes.find((lane) => lane.id === "verified")?.items.find((item) => item.id === verifiedTask.meta.id);
    expect(verifiedRow).toEqual(expect.objectContaining({ evidenceCount: 1, verificationCount: 1 }));
    const inProgressRow = result.board.lanes.find((lane) => lane.id === "in_progress")?.items.find((item) => item.id === reservedTask.meta.id);
    expect(inProgressRow?.activeReservationId).toMatch(/^bw_reservation_/);

    const limited = parseData<{ readonly scope: { readonly totalDescendants: number; readonly truncated: boolean; readonly limit: number } }>(
      (await runCli(rootDir, ["sprint", "board", sprint.meta.id, "--limit", "1", "--json"])).stdout
    );
    expect(limited.scope).toEqual(expect.objectContaining({ totalDescendants: 6, truncated: true, limit: 1 }));
  });

  it("exports sprint closeout reports with required doctor and sync evidence", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);
    const sprint = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Closeout Sprint", "--kind", "sprint", "--ready", "--json"])).stdout
    );
    const phase = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Closeout Phase", "--kind", "milestone", "--ready", "--json"])).stdout
    );
    const completedTask = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Completed Report Task", "--kind", "task", "--ready", "--json"])).stdout
    );
    const source = parseData<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "source",
          "add",
          "--title",
          "Report decision source",
          "--uri",
          "artifact://sprint-report-decision",
          "--kind",
          "artifact",
          "--summary",
          "Source linking a sprint decision to scoped work.",
          "--json"
        ])
      ).stdout
    );
    const nextTask = parseData<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "work",
          "create",
          "Next <Task>",
          "--kind",
          "task",
          "--source",
          "artifact://sprint-report-decision",
          "--ready",
          "--json"
        ])
      ).stdout
    );
    const blockedTask = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Blocked Report Task", "--kind", "task", "--ready", "--json"])).stdout
    );
    const blocker = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Open Report Blocker", "--kind", "task", "--ready", "--json"])).stdout
    );

    await runCli(rootDir, ["dep", "add", sprint.meta.id, phase.meta.id, "--json"]);
    await runCli(rootDir, ["dep", "add", sprint.meta.id, completedTask.meta.id, "--json"]);
    await runCli(rootDir, ["dep", "add", sprint.meta.id, nextTask.meta.id, "--json"]);
    await runCli(rootDir, ["dep", "add", sprint.meta.id, blockedTask.meta.id, "--json"]);
    await runCli(rootDir, ["dep", "add", blockedTask.meta.id, blocker.meta.id, "--json"]);

    await runCli(rootDir, [
      "decision",
      "create",
      "--title",
      "Static report decision",
      "--decision",
      "Ship a static sprint closeout report.",
      "--status",
      "accepted",
      "--source",
      source.meta.id,
      "--json"
    ]);
    const completedEvidence = parseData<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "evidence",
          "add",
          completedTask.meta.id,
          "--summary",
          "Completed task evidence passed.",
          "--outcome",
          "passed",
          "--json"
        ])
      ).stdout
    );
    await runCli(rootDir, [
      "work",
      "verify",
      completedTask.meta.id,
      "--evidence",
      completedEvidence.meta.id,
      "--verdict",
      "passed",
      "--json"
    ]);
    await runCli(rootDir, ["work", "close", completedTask.meta.id, "--reason", "ready for report", "--commit", "abc1234", "--json"]);

    const doctorEvidence = parseData<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "evidence",
          "add",
          sprint.meta.id,
          "--summary",
          "doctor strict passed",
          "--kind",
          "command",
          "--outcome",
          "passed",
          "--command",
          "bwrk doctor --strict --json",
          "--json"
        ])
      ).stdout
    );
    const syncEvidence = parseData<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "evidence",
          "add",
          sprint.meta.id,
          "--summary",
          "sync refresh passed",
          "--kind",
          "command",
          "--outcome",
          "passed",
          "--command",
          "bwrk sync refresh --json",
          "--json"
        ])
      ).stdout
    );
    await runCli(rootDir, ["sprint", "activate", sprint.meta.id, "--json"]);

    const markdownResult = parseData<{
      readonly schemaVersion: string;
      readonly format: string;
      readonly path: string;
      readonly contentHash: string;
      readonly report: {
        readonly summary: {
          readonly completed: number;
          readonly open: number;
          readonly decisions: number;
          readonly agentSummaries: number;
          readonly summaryCheckpointGaps: number;
          readonly nextSprintCandidates: number;
        };
        readonly closeoutEvidence: { readonly doctor: { readonly id: string }; readonly sync: { readonly id: string } };
        readonly agentSummaries: Array<{ readonly subjectId: string; readonly commitShas: readonly string[]; readonly artifactUri: string }>;
        readonly decisions: Array<{ readonly title: string }>;
        readonly unresolvedBlockers: Array<{ readonly work: { readonly id: string }; readonly blockers: Array<{ readonly id: string }> }>;
      };
    }>(
      (
        await runCli(rootDir, [
          "sprint",
          "report",
          "--doctor-evidence",
          doctorEvidence.meta.id,
          "--sync-evidence",
          syncEvidence.meta.id,
          "--out",
          ".boreal/results/closeout.md",
          "--json"
        ])
      ).stdout
    );

    expect(markdownResult.schemaVersion).toBe("boreal.cli.sprint.report.v1");
    expect(markdownResult.format).toBe("markdown");
    expect(markdownResult.path).toBe(join(rootDir, ".boreal/results/closeout.md"));
    expect(markdownResult.contentHash).toMatch(/^sha256:/);
    expect(markdownResult.report.summary).toEqual(
      expect.objectContaining({ completed: 1, open: 4, decisions: 1, agentSummaries: 1, summaryCheckpointGaps: 0, nextSprintCandidates: 4 })
    );
    expect(markdownResult.report.agentSummaries).toEqual([
      expect.objectContaining({ subjectId: completedTask.meta.id, commitShas: ["abc1234"] })
    ]);
    expect(markdownResult.report.closeoutEvidence.doctor.id).toBe(doctorEvidence.meta.id);
    expect(markdownResult.report.closeoutEvidence.sync.id).toBe(syncEvidence.meta.id);
    expect(markdownResult.report.decisions.map((decision) => decision.title)).toContain("Static report decision");
    expect(markdownResult.report.unresolvedBlockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          work: expect.objectContaining({ id: blockedTask.meta.id }),
          blockers: [expect.objectContaining({ id: blocker.meta.id })]
        })
      ])
    );

    const markdown = await readFile(join(rootDir, ".boreal/results/closeout.md"), "utf8");
    expect(markdown).toContain("# Sprint Closeout: Closeout Sprint");
    expect(markdown).toContain("Static report decision");
    expect(markdown).toContain("Blocked Report Task");
    expect(markdown).toContain("## Agent Summaries");
    expect(markdown).toContain("commits abc1234");
    expect(markdown).toContain(`Doctor evidence: ${doctorEvidence.meta.id}`);
    expect(markdown).toContain(`Sync evidence: ${syncEvidence.meta.id}`);

    const htmlResult = parseData<{ readonly format: string; readonly path: string }>(
      (
        await runCli(rootDir, [
          "sprint",
          "report",
          sprint.meta.id,
          "--format",
          "html",
          "--doctor-evidence",
          doctorEvidence.meta.id,
          "--sync-evidence",
          syncEvidence.meta.id,
          "--out",
          ".boreal/results/closeout.html",
          "--json"
        ])
      ).stdout
    );
    expect(htmlResult.format).toBe("html");
    expect(htmlResult.path).toBe(join(rootDir, ".boreal/results/closeout.html"));
    const html = await readFile(join(rootDir, ".boreal/results/closeout.html"), "utf8");
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Agent Summaries");
    expect(html).toContain("Next &lt;Task&gt;");
    expect(html).not.toContain("Next <Task>");

    const invalid = await runCli(rootDir, [
      "sprint",
      "report",
      sprint.meta.id,
      "--doctor-evidence",
      doctorEvidence.meta.id,
      "--sync-evidence",
      completedEvidence.meta.id,
      "--json"
    ]);
    expect(invalid.exitCode).toBe(2);
    expect(parseJson<{ readonly code: string }>(invalid.stderr).code).toBe("BOREAL_INVALID_INPUT");
  });

  it("runs golden-path agent aliases and closeout gates", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, [
      "init",
      "--setup-memory",
      "--memory-root",
      "memory",
      "--memory-layout",
      "in-repo",
      "--memory-git-mode",
      "shared",
      "--json"
    ]);
    await runCli(rootDir, ["work", "create", "Alias paused task", "--ready", "--json"]);

    const start = parseData<{
      readonly started: boolean;
      readonly action: string;
      readonly reservation: { readonly meta: { readonly id: string } };
    }>((await runCli(rootDir, ["start", "--agent", "alias-agent", "--purpose", "alias smoke", "--json"])).stdout);
    expect(start).toEqual(expect.objectContaining({ started: true, action: "claimed_work" }));
    expect(start.reservation.meta.id).toMatch(/^bw_reservation_/);

    const paused = parseData<{
      readonly finished: boolean;
      readonly action: string;
      readonly verification: { readonly verdict: string };
      readonly release: { readonly reservation: { readonly status: string } };
    }>(
      (
        await runCli(rootDir, [
          "pause",
          "--agent",
          "alias-agent",
          "--summary",
          "Paused through alias.",
          "--verdict",
          "failed",
          "--json"
        ])
      ).stdout
    );
    expect(paused).toEqual(expect.objectContaining({ finished: true, action: "verified_and_released" }));
    expect(paused.verification.verdict).toBe("failed");
    expect(paused.release.reservation.status).toBe("released");

    await runCli(rootDir, ["work", "create", "Alias done task", "--ready", "--json"]);
    await runCli(rootDir, ["start", "--agent", "alias-agent", "--purpose", "alias close", "--json"]);
    const done = parseData<{
      readonly finished: boolean;
      readonly action: string;
      readonly verification: { readonly verdict: string };
      readonly closedWork: { readonly status: string; readonly closedReason: string };
    }>(
      (
        await runCli(rootDir, [
          "done",
          "--agent",
          "alias-agent",
          "--summary",
          "Done through alias.",
          "--kind",
          "test",
	          "--command",
	          "node --version",
	          "--reason",
	          "verified alias path",
	          "--dirty-path",
	          "no_repo_changes: alias done fixture",
	          "--json"
	        ])
      ).stdout
    );
    expect(done).toEqual(expect.objectContaining({ finished: true, action: "verified_and_closed" }));
    expect(done.verification.verdict).toBe("passed");
    expect(done.closedWork).toEqual(expect.objectContaining({ status: "closed", closedReason: "verified alias path" }));

    const status = parseData<{ readonly kind: string; readonly agent: { readonly agentId: string } }>(
      (await runCli(rootDir, ["status", "--agent", "alias-agent", "--json"])).stdout
    );
    expect(status).toEqual(expect.objectContaining({ kind: "prime", agent: expect.objectContaining({ agentId: "alias-agent" }) }));

    const schema = parseData<{ readonly ok: boolean; readonly commandMetadata: { readonly ok: boolean } }>(
      (await runCli(rootDir, ["schema", "validate", "--json"])).stdout
    );
    expect(schema).toEqual(expect.objectContaining({ ok: true, commandMetadata: expect.objectContaining({ ok: true }) }));

    const docs = parseData<{ readonly ok: boolean; readonly commandMetadata: { readonly ok: boolean } }>(
      (await runCli(rootDir, ["docs", "check", "--json"])).stdout
    );
    expect(docs).toEqual(expect.objectContaining({ ok: true, commandMetadata: expect.objectContaining({ ok: true }) }));

    const gate = parseData<{
      readonly ok: boolean;
      readonly sync: { readonly postRefreshStatusOk: boolean };
      readonly doctor: { readonly ok: boolean };
      readonly schema: { readonly ok: boolean };
      readonly docs: { readonly ok: boolean };
    }>((await runCli(rootDir, ["gate", "closeout", "--strict", "--json"])).stdout);
    expect(gate).toEqual(
      expect.objectContaining({
        ok: true,
        sync: expect.objectContaining({ postRefreshStatusOk: true }),
        doctor: expect.objectContaining({ ok: true }),
        schema: expect.objectContaining({ ok: true }),
        docs: expect.objectContaining({ ok: true })
      })
    );
  });

  it("edits, cancels, reopens, splits, reviews claims, and supersedes decisions", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, [
      "init",
      "--setup-memory",
      "--memory-root",
      "memory",
      "--memory-layout",
      "in-repo",
      "--memory-git-mode",
      "shared",
      "--json"
    ]);
    const work = parseData<{
      readonly meta: { readonly id: string; readonly sourceRefs: readonly Array<{ readonly uri: string }> };
      readonly title: string;
      readonly labels: readonly string[];
      readonly acceptanceCriteria: readonly string[];
    }>(
      (
        await runCli(rootDir, [
          "work",
          "create",
          "Editable work",
          "--source",
          "artifact://editable-source",
          "--label",
          "Original",
          "--acceptance",
          "Original criterion",
          "--ready",
          "--json"
        ])
      ).stdout
    );

    const edited = parseData<{
      readonly work: {
        readonly meta: { readonly id: string; readonly sourceRefs: readonly Array<{ readonly uri: string }> };
        readonly title: string;
        readonly labels: readonly string[];
        readonly acceptanceCriteria: readonly string[];
      };
      readonly event: { readonly type: string };
    }>(
      (
        await runCli(rootDir, [
          "work",
          "edit",
          work.meta.id,
          "--title",
          "Edited work",
          "--label",
          "Edited",
          "--acceptance",
          "Edited criterion",
          "--json"
        ])
      ).stdout
    );
    expect(edited.work).toEqual(
      expect.objectContaining({
        title: "Edited work",
        labels: ["edited"],
        acceptanceCriteria: ["Edited criterion"],
        meta: expect.objectContaining({ sourceRefs: work.meta.sourceRefs })
      })
    );
    expect(edited.event.type).toBe("work.edited");

    const split = parseData<{
      readonly child: { readonly meta: { readonly id: string }; readonly parentId: string; readonly labels: readonly string[] };
      readonly blockedParent: { readonly dependencyIds: readonly string[]; readonly status: string };
    }>(
      (
        await runCli(rootDir, [
          "work",
          "split",
          work.meta.id,
          "--title",
          "Split child",
          "--label",
          "Child",
          "--acceptance",
          "Child criterion",
          "--ready",
          "--json"
        ])
      ).stdout
    );
    expect(split.child).toEqual(expect.objectContaining({ parentId: work.meta.id, labels: ["edited", "child"] }));
    expect(split.blockedParent.dependencyIds).toContain(split.child.meta.id);
    expect(split.blockedParent.status).toBe("blocked");

    const cancellable = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Cancelable work", "--ready", "--json"])).stdout
    );
    await runCli(rootDir, ["work", "reserve", cancellable.meta.id, "--agent", "cancel-agent", "--purpose", "guard", "--json"]);
    const activeCancel = await runCli(rootDir, ["work", "cancel", cancellable.meta.id, "--reason", "not now", "--json"]);
    expect(activeCancel.exitCode).toBe(1);
    expect(parseJson<{ readonly code: string }>(activeCancel.stderr).code).toBe("BOREAL_POLICY_VIOLATION");
    await runCli(rootDir, ["work", "release", cancellable.meta.id, "--json"]);
    const cancelled = parseData<{ readonly work: { readonly status: string; readonly closedReason: string } }>(
      (
        await runCli(rootDir, [
          "work",
          "cancel",
          cancellable.meta.id,
          "--reason",
          "not now",
          "--dirty-path",
          "no_repo_changes: cancel fixture",
          "--json"
        ])
      ).stdout
    );
    expect(cancelled.work).toEqual(expect.objectContaining({ status: "cancelled", closedReason: "not now" }));
    const reopened = parseData<{ readonly work: { readonly status: string; readonly closedReason?: string } }>(
      (await runCli(rootDir, ["work", "reopen", cancellable.meta.id, "--ready", "--reason", "resume", "--json"])).stdout
    );
    expect(reopened.work.status).toBe("ready");
    expect(reopened.work.closedReason).toBeUndefined();

    const source = parseData<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "source",
          "add",
          "--title",
          "Review source",
          "--uri",
          "artifact://review-source",
          "--kind",
          "artifact",
          "--json"
        ])
      ).stdout
    );
    const evidence = parseData<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "evidence",
          "add",
          work.meta.id,
          "--summary",
          "Review evidence observed.",
          "--outcome",
          "observed",
          "--json"
        ])
      ).stdout
    );
    const claim = parseData<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "claim",
          "create",
          "--statement",
          "The review path is source-backed.",
          "--status",
          "proposed",
          "--json"
        ])
      ).stdout
    );
    const reviewed = parseData<{
      readonly claim: { readonly status: string; readonly sourceIds: readonly string[]; readonly evidenceIds: readonly string[] };
      readonly event: { readonly type: string };
    }>(
      (
        await runCli(rootDir, [
          "claim",
          "review",
          claim.meta.id,
          "--status",
          "accepted",
          "--source",
          source.meta.id,
          "--evidence",
          evidence.meta.id,
          "--notes",
          "reviewed",
          "--json"
        ])
      ).stdout
    );
    expect(reviewed.claim).toEqual(
      expect.objectContaining({
        status: "accepted",
        sourceIds: [source.meta.id],
        evidenceIds: [evidence.meta.id]
      })
    );
    expect(reviewed.event.type).toBe("knowledge.claim_reviewed");

    const decision = parseData<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "decision",
          "create",
          "--title",
          "Original decision",
          "--decision",
          "Use the original route.",
          "--source",
          source.meta.id,
          "--json"
        ])
      ).stdout
    );
    const superseded = parseData<{
      readonly superseded: { readonly meta: { readonly id: string }; readonly status: string };
      readonly decision: { readonly meta: { readonly id: string }; readonly status: string; readonly decision: string; readonly sourceIds: readonly string[] };
    }>(
      (
        await runCli(rootDir, [
          "decision",
          "supersede",
          decision.meta.id,
          "--decision",
          "Use the replacement route.",
          "--reason",
          "new source review",
          "--json"
        ])
      ).stdout
    );
    expect(superseded.superseded).toEqual(expect.objectContaining({ meta: expect.objectContaining({ id: decision.meta.id }), status: "superseded" }));
    expect(superseded.decision).toEqual(
      expect.objectContaining({ status: "accepted", decision: "Use the replacement route.", sourceIds: [source.meta.id] })
    );
    expect(superseded.decision.meta.id).not.toBe(decision.meta.id);
  });

  it("computes sprint metrics and closes verified sprints", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);
    const sprint = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Metrics Sprint", "--kind", "sprint", "--ready", "--json"])).stdout
    );
    const first = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Metrics first", "--ready", "--json"])).stdout
    );
    const second = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Metrics second", "--ready", "--json"])).stdout
    );
    await runCli(rootDir, ["dep", "add", sprint.meta.id, first.meta.id, "--json"]);
    await runCli(rootDir, ["dep", "add", sprint.meta.id, second.meta.id, "--json"]);

    for (const workId of [first.meta.id, second.meta.id]) {
      const evidence = parseData<{ readonly meta: { readonly id: string } }>(
        (
          await runCli(rootDir, [
            "evidence",
            "add",
            workId,
            "--summary",
            `Evidence for ${workId}`,
            "--outcome",
            "passed",
            "--json"
          ])
        ).stdout
      );
      await runCli(rootDir, ["work", "verify", workId, "--evidence", evidence.meta.id, "--verdict", "passed", "--json"]);
      await runCli(rootDir, [
        "work",
        "close",
        workId,
        "--reason",
        "completed for metrics",
        "--dirty-path",
        "no_repo_changes: metrics fixture",
        "--json"
      ]);
    }

    const metrics = parseData<{
      readonly schemaVersion: string;
      readonly capacity: { readonly capacity: number; readonly committed: number; readonly overCapacity: boolean };
      readonly summary: { readonly completed: number; readonly open: number; readonly risks: number };
      readonly risks: readonly string[];
      readonly closeout: { readonly readyForReport: boolean; readonly unresolvedWork: readonly unknown[] };
    }>(
      (
        await runCli(rootDir, [
          "sprint",
          "metrics",
          sprint.meta.id,
          "--capacity",
          "1",
          "--risk",
          "manual risk",
          "--closeout-reason",
          "scope complete",
          "--json"
        ])
      ).stdout
    );
    expect(metrics.schemaVersion).toBe("boreal.cli.sprint.metrics.v1");
    expect(metrics.capacity).toEqual(expect.objectContaining({ capacity: 1, committed: 2, overCapacity: true }));
    expect(metrics.summary).toEqual(expect.objectContaining({ completed: 2, open: 0, risks: 2 }));
    expect(metrics.risks).toEqual(expect.arrayContaining(["manual risk", "capacity_exceeded: committed 2 exceeds capacity 1"]));
    expect(metrics.closeout).toEqual(expect.objectContaining({ readyForReport: true, unresolvedWork: [] }));

    const sprintEvidence = parseData<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "evidence",
          "add",
          sprint.meta.id,
          "--summary",
          "Sprint metrics closeout passed.",
          "--outcome",
          "passed",
          "--json"
        ])
      ).stdout
    );
    await runCli(rootDir, ["work", "verify", sprint.meta.id, "--evidence", sprintEvidence.meta.id, "--verdict", "passed", "--json"]);
    const closed = parseData<{ readonly closed: { readonly status: string; readonly closedReason: string }; readonly metrics: { readonly summary: { readonly open: number } } }>(
      (
        await runCli(rootDir, [
          "sprint",
          "close",
          sprint.meta.id,
          "--reason",
          "metrics complete",
          "--dirty-path",
          "no_repo_changes: metrics sprint fixture",
          "--json"
        ])
      ).stdout
    );
    expect(closed.closed).toEqual(expect.objectContaining({ status: "closed", closedReason: "metrics complete" }));
    expect(closed.metrics.summary.open).toBe(0);
  });

  it("does not append equivalent project .gitignore guards during repeated setup", async () => {
    const rootDir = await makeTempWorkspace();
    await writeFile(
      join(rootDir, ".gitignore"),
      [
        "# Boreal local workspace binding and runtime artifacts",
        ".boreal/project.json",
        ".boreal/mcp.json",
        ".boreal/runtime/",
        ".boreal/cache/",
        ".boreal/tmp/",
        ".boreal/results/",
        ".boreal/**/*.db",
        ".boreal/**/*.db-*",
        ".boreal/ledgers/",
        ".agents/",
        ".claude/",
        "dump/",
        "memory/"
      ].join("\n") + "\n",
      "utf8"
    );

    const initialized = await runCli(rootDir, [
      "init",
      "--setup-memory",
      "--memory-root",
      "memory",
      "--memory-layout",
      "child",
      "--separate-git",
      "--json"
    ]);
    const payload = parseData<{
      readonly projectSetup: { readonly gitSetup: { readonly projectGitignoreUpdated: boolean } };
    }>(initialized.stdout);
    const firstGitignore = await readFile(join(rootDir, ".gitignore"), "utf8");

    expect(initialized.exitCode).toBe(0);
    expect(payload.projectSetup.gitSetup.projectGitignoreUpdated).toBe(false);
    expect(firstGitignore).toContain("memory/");
    expect(firstGitignore).not.toContain("/memory/");
    expect(projectMemoryGuardCount(firstGitignore)).toBe(1);

    await runCli(rootDir, [
      "init",
      "--setup-memory",
      "--memory-root",
      "memory",
      "--memory-layout",
      "child",
      "--separate-git",
      "--json"
    ]);
    const secondGitignore = await readFile(join(rootDir, ".gitignore"), "utf8");
    expect(projectMemoryGuardCount(secondGitignore)).toBe(1);
  });

  it("defaults setup memory to a sibling separate repo with local project git guards", async () => {
    const rootDir = await makeTempWorkspace();
    const siblingRoot = join(dirname(rootDir), `${rootDir.split("/").at(-1) ?? "workspace"}-memory`);
    tempDirs.push(siblingRoot);

    const initialized = await runCli(rootDir, ["init", "--setup-memory", "--json"]);
    const payload = parseData<{
      readonly projectSetup: {
        readonly config: { readonly memoryRoot: string; readonly memoryLayout: string; readonly memoryGitMode: string };
        readonly gitSetup: {
          readonly memoryRepoInitialized: boolean;
          readonly ignoredByProject: boolean;
          readonly projectGitignoreUpdated: boolean;
          readonly gitmodulesUpdated: boolean;
        };
      };
    }>(initialized.stdout);

    expect(initialized.exitCode).toBe(0);
    expect(payload.projectSetup.config).toEqual(
      expect.objectContaining({ memoryRoot: siblingRoot, memoryLayout: "sibling", memoryGitMode: "separate" })
    );
    expect(payload.projectSetup.gitSetup).toEqual(
      expect.objectContaining({
        memoryRepoInitialized: true,
        ignoredByProject: false,
        projectGitignoreUpdated: true,
        gitmodulesUpdated: false
      })
    );
    expect(await fileMissing(join(siblingRoot, ".git"))).toBe(false);
    expect(await readFile(join(siblingRoot, ".gitignore"), "utf8")).toContain(".boreal/cache/");
    const projectGitignore = await readFile(join(rootDir, ".gitignore"), "utf8");
    expect(projectGitignore).toContain(".boreal/project.json");
    expect(projectGitignore).not.toContain("/memory/");
  });

  it("sets up child memory submodules with gitmodules metadata", async () => {
    const rootDir = await makeTempWorkspace();
    await initGitRepository(rootDir, "main");

    const initialized = await runCli(rootDir, [
      "init",
      "--setup-memory",
      "--memory-root",
      "memory",
      "--memory-layout",
      "child",
      "--memory-git-mode",
      "submodule",
      "--memory-remote",
      "git@example.com:example/project-memory.git",
      "--json"
    ]);
    const payload = parseData<{
      readonly projectSetup: {
        readonly config: { readonly memoryGitMode: string; readonly memoryRemote?: string };
        readonly gitSetup: {
          readonly memoryRepoInitialized: boolean;
          readonly ignoredByProject: boolean;
          readonly projectGitignoreUpdated: boolean;
          readonly gitmodulesUpdated: boolean;
        };
      };
    }>(initialized.stdout);

    expect(initialized.exitCode).toBe(0);
    expect(payload.projectSetup.config).toEqual(
      expect.objectContaining({
        memoryGitMode: "submodule",
        memoryRemote: "git@example.com:example/project-memory.git"
      })
    );
    expect(payload.projectSetup.gitSetup).toEqual(
      expect.objectContaining({
        memoryRepoInitialized: true,
        ignoredByProject: false,
        projectGitignoreUpdated: true,
        gitmodulesUpdated: true
      })
    );
    const gitmodules = await readFile(join(rootDir, ".gitmodules"), "utf8");
    expect(gitmodules).toContain('[submodule "memory"]');
    expect(gitmodules).toContain("path = memory");
    expect(gitmodules).toContain("url = git@example.com:example/project-memory.git");
    expect(await readFile(join(rootDir, ".gitignore"), "utf8")).not.toContain("/memory/");
    expect(await fileMissing(join(rootDir, "memory/.git"))).toBe(false);

    const missingRemote = await runCli(rootDir, [
      "init",
      "--setup-memory",
      "--memory-root",
      "other-memory",
      "--memory-layout",
      "child",
      "--memory-git-mode",
      "submodule",
      "--json"
    ]);
    const error = parseJson<{ readonly code: string; readonly message: string }>(missingRemote.stderr);
    expect(missingRemote.exitCode).toBe(2);
    expect(error.code).toBe("BOREAL_INVALID_INPUT");
    expect(error.message).toContain("--memory-remote");
  });

  it("doctors project setup git drift and repairs safe guards", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, [
      "init",
      "--setup-memory",
      "--memory-root",
      "memory",
      "--memory-layout",
      "child",
      "--json"
    ]);
    await rm(join(rootDir, "memory/.git"), { recursive: true, force: true });
    await writeFile(join(rootDir, ".gitignore"), "# user ignore\n", "utf8");
    await writeFile(join(rootDir, "memory/.gitignore"), "# memory ignore\n", "utf8");

    const failing = await runCli(rootDir, ["doctor", "--json"]);
    const failingPayload = parseData<DoctorPayload>(failing.stdout);

    expect(failing.exitCode).toBe(1);
    expect(failingPayload.ok).toBe(false);
    expect(doctorDiagnostic(failingPayload, "project_setup.memory_repo")).toEqual(
      expect.objectContaining({ severity: "error" })
    );
    expect(doctorDiagnostic(failingPayload, "project_setup.gitignore")).toEqual(
      expect.objectContaining({ severity: "error" })
    );

    const fixed = await runCli(rootDir, ["doctor", "--fix", "--json"]);
    const fixedPayload = parseData<DoctorPayload>(fixed.stdout);

    expect(fixed.exitCode).toBe(0);
    expect(fixedPayload.fixed).toBe(true);
    expect(doctorDiagnostic(fixedPayload, "project_setup.memory_repo")).toEqual(
      expect.objectContaining({ severity: "fixed" })
    );
    expect(doctorDiagnostic(fixedPayload, "project_setup.gitignore")).toEqual(
      expect.objectContaining({ severity: "fixed" })
    );
    expect(await fileMissing(join(rootDir, "memory/.git"))).toBe(false);
    expect(await readFile(join(rootDir, ".gitignore"), "utf8")).toContain("/memory/");
    expect(await readFile(join(rootDir, "memory/.gitignore"), "utf8")).toContain(".boreal/locks/");
  });

  it("reports child separate memory tracked by the project git index", async () => {
    const rootDir = await makeTempWorkspace();
    if (!(await gitAvailable(rootDir))) {
      return;
    }
    await initGitRepository(rootDir, "main");
    await runCli(rootDir, [
      "init",
      "--setup-memory",
      "--memory-root",
      "memory",
      "--memory-layout",
      "child",
      "--json"
    ]);
    await runGit(join(rootDir, "memory"), ["config", "user.email", "boreal-tests@example.invalid"]);
    await runGit(join(rootDir, "memory"), ["config", "user.name", "Boreal Tests"]);
    await runGit(join(rootDir, "memory"), ["add", "index.md"]);
    await runGit(join(rootDir, "memory"), ["commit", "-m", "Initial memory commit"]);
    await runGit(rootDir, ["add", "-f", "memory"]);

    const doctor = await runCli(rootDir, ["doctor", "--json"]);
    const payload = parseData<DoctorPayload>(doctor.stdout);

    expect(doctor.exitCode).toBe(1);
    expect(doctorDiagnostic(payload, "project_setup.child_tracking")).toEqual(
      expect.objectContaining({ severity: "error" })
    );
  });

  it("repairs stale child memory submodule metadata through doctor fix", async () => {
    const rootDir = await makeTempWorkspace();
    await initGitRepository(rootDir, "main");
    await runCli(rootDir, [
      "init",
      "--setup-memory",
      "--memory-root",
      "memory",
      "--memory-layout",
      "child",
      "--memory-git-mode",
      "submodule",
      "--memory-remote",
      "git@example.com:example/project-memory.git",
      "--json"
    ]);
    await writeFile(
      join(rootDir, ".gitmodules"),
      '[submodule "memory"]\n\tpath = memory\n\turl = git@example.com:example/stale-memory.git\n',
      "utf8"
    );

    const failing = await runCli(rootDir, ["doctor", "--json"]);
    const failingPayload = parseData<DoctorPayload>(failing.stdout);

    expect(failing.exitCode).toBe(1);
    expect(doctorDiagnostic(failingPayload, "project_setup.gitmodules")).toEqual(
      expect.objectContaining({ severity: "error" })
    );
    expect(doctorDiagnostic(failingPayload, "project_setup.child_tracking")).toEqual(
      expect.objectContaining({
        severity: "error",
        message: expect.stringContaining("Git gitlink")
      })
    );

    const fixed = await runCli(rootDir, ["doctor", "--fix", "--json"]);
    const fixedPayload = parseData<DoctorPayload>(fixed.stdout);

    expect(fixed.exitCode).toBe(1);
    expect(doctorDiagnostic(fixedPayload, "project_setup.gitmodules")).toEqual(
      expect.objectContaining({ severity: "fixed" })
    );
    expect(doctorDiagnostic(fixedPayload, "project_setup.child_tracking")).toEqual(
      expect.objectContaining({
        severity: "error",
        message: expect.stringContaining("Git gitlink")
      })
    );
    expect(await readFile(join(rootDir, ".gitmodules"), "utf8")).toContain(
      "url = git@example.com:example/project-memory.git"
    );
  });

  it("fails closed on project setup config root mismatches", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--setup-memory", "--json"]);
    const configPath = join(rootDir, ".boreal/project.json");
    const config = parseJson<Record<string, unknown>>(await readFile(configPath, "utf8"));
    await writeFile(configPath, `${JSON.stringify({ ...config, projectRoot: join(rootDir, "other-project") }, null, 2)}\n`, "utf8");

    const doctor = await runCli(rootDir, ["doctor", "--json"]);
    const payload = parseData<DoctorPayload>(doctor.stdout);

    expect(doctor.exitCode).toBe(1);
    expect(doctorDiagnostic(payload, "project_setup.config")).toEqual(
      expect.objectContaining({ severity: "error" })
    );
    expect(doctorDiagnostic(payload, "vault.structure")).toEqual(
      expect.objectContaining({ severity: "warning" })
    );

    const vault = await runCli(rootDir, ["vault", "status", "--json"]);
    const error = parseJson<{ readonly code: string; readonly message: string }>(vault.stderr);
    expect(vault.exitCode).toBe(2);
    expect(error.code).toBe("BOREAL_INVALID_INPUT");
    expect(error.message).toContain("different project root");
  });

  it("prints a readable init setup summary in human mode", async () => {
    const rootDir = await makeTempWorkspace();
    const initialized = await runCli(rootDir, [
      "init",
      "--setup-memory",
      "--memory-root",
      "memory",
      "--memory-layout",
      "child",
      "--install-root",
      ".agents/skills"
    ]);

    expect(initialized.exitCode).toBe(0);
    expect(initialized.stdout).toContain("Boreal workspace initialized");
    expect(initialized.stdout).toContain(`workspace: ${rootDir}`);
    expect(initialized.stdout).toContain("Project setup");
    expect(initialized.stdout).toContain(`memory: ${join(rootDir, "memory")}`);
    expect(initialized.stdout).toContain("layout: child");
    expect(initialized.stdout).toContain("memory git: separate");
    expect(initialized.stdout).toContain("memory repo initialized: yes");
    expect(initialized.stdout).toContain(`skills: ${join(rootDir, ".agents/skills")}`);
    expect(initialized.stdout.trimStart()).not.toMatch(/^\{/u);
  });

  it("allows explicit sibling memory setup and rejects mismatched layouts", async () => {
    const rootDir = await makeTempWorkspace();
    const siblingRoot = join(rootDir, "..", `${rootDir.split("/").at(-1) ?? "workspace"}-memory`);
    tempDirs.push(siblingRoot);

    const sibling = await runCli(rootDir, [
      "init",
      "--setup-memory",
      "--memory-root",
      siblingRoot,
      "--memory-layout",
      "sibling",
      "--json"
    ]);
    const siblingPayload = parseData<{
      readonly projectSetup: { readonly config: { readonly memoryRoot: string; readonly memoryLayout: string } };
    }>(sibling.stdout);
    expect(sibling.exitCode).toBe(0);
    expect(siblingPayload.projectSetup.config).toEqual(
      expect.objectContaining({ memoryRoot: siblingRoot, memoryLayout: "sibling" })
    );
    expect(await readFile(join(siblingRoot, "wiki/index.md"), "utf8")).toContain("Stable project knowledge pages");

    const mismatched = await runCli(rootDir, [
      "init",
      "--setup-memory",
      "--memory-root",
      "../not-a-direct-child",
      "--memory-layout",
      "child",
      "--json"
    ]);
    const error = parseJson<{ readonly code: string; readonly message: string }>(mismatched.stderr);
    expect(mismatched.exitCode).toBe(2);
    expect(error.code).toBe("BOREAL_INVALID_INPUT");
    expect(error.message).toContain("--memory-layout child");

    const outsideRoot = await makeTempWorkspace();
    const linkedRoot = join(rootDir, "linked-out");
    await symlink(outsideRoot, linkedRoot, "dir");
    const symlinkEscape = await runCli(rootDir, [
      "init",
      "--setup-memory",
      "--memory-root",
      "linked-out/memory",
      "--memory-layout",
      "in-repo",
      "--json"
    ]);
    const symlinkError = parseJson<{ readonly code: string; readonly message: string }>(symlinkEscape.stderr);
    expect(symlinkEscape.exitCode).toBe(2);
    expect(symlinkError.code).toBe("BOREAL_INVALID_INPUT");
    expect(symlinkError.message).toContain("Path escapes Boreal workspace");
  });

  it("uses configured sibling memory roots for vault, raw, and wiki commands", async () => {
    const rootDir = await makeTempWorkspace();
    const siblingRoot = join(rootDir, "..", `${rootDir.split("/").at(-1) ?? "workspace"}-memory`);
    tempDirs.push(siblingRoot);
    await runCli(rootDir, [
      "init",
      "--setup-memory",
      "--memory-root",
      siblingRoot,
      "--memory-layout",
      "sibling",
      "--json"
    ]);

    const raw = await runCli(rootDir, [
      "raw",
      "add",
      "--title",
      "Sibling source",
      "--uri",
      "file://sibling.md",
      "--json"
    ]);
    const rawPayload = parseData<{ readonly indexPath: string; readonly record: { readonly id: string } }>(raw.stdout);
    const wiki = await runCli(rootDir, [
      "wiki",
      "create",
      "Sibling Wiki",
      "--source",
      rawPayload.record.id,
      "--json"
    ]);
    const wikiPayload = parseData<{ readonly path: string; readonly page: { readonly path: string } }>(wiki.stdout);
    const status = await runCli(rootDir, ["vault", "status", "--json"]);
    const statusPayload = parseData<{
      readonly initialized: boolean;
      readonly rootDir: string;
      readonly health: { readonly rawSourceCount: number; readonly wikiPageCount: number };
    }>(status.stdout);

    expect(raw.exitCode).toBe(0);
    expect(rawPayload.indexPath).toBe(join(siblingRoot, "raw/index.jsonl"));
    expect(await readFile(join(siblingRoot, "raw/index.jsonl"), "utf8")).toContain(rawPayload.record.id);
    expect(await fileMissing(join(rootDir, "memory/raw/index.jsonl"))).toBe(true);
    expect(wiki.exitCode).toBe(0);
    expect(wikiPayload.path).toBe(join(siblingRoot, "wiki/sibling-wiki.md"));
    expect(wikiPayload.page.path).toBe(join(siblingRoot, "wiki/sibling-wiki.md"));
    expect(await readFile(join(siblingRoot, "wiki/sibling-wiki.md"), "utf8")).toContain("Sibling Wiki");
    expect(status.exitCode).toBe(0);
    expect(statusPayload).toEqual(
      expect.objectContaining({
        initialized: true,
        rootDir: siblingRoot,
        health: expect.objectContaining({ rawSourceCount: 1, wikiPageCount: 1 })
      })
    );
  });

  it("adds raw vault sources, creates wiki pages, and reports vault health", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);
    await runCli(rootDir, ["vault", "init", "--json"]);

    const raw = await runCli(rootDir, [
      "raw",
      "add",
      "--title",
      "Design source",
      "--uri",
      "file://design-source.md",
      "--summary",
      "Source-backed wiki test.",
      "--tag",
      "Design",
      "--json"
    ]);
    const rawPayload = parseData<{
      readonly added: true;
      readonly record: { readonly id: string; readonly title: string; readonly tags: readonly string[] };
    }>(raw.stdout);
    expect(raw.exitCode).toBe(0);
    expect(rawPayload.record.title).toBe("Design source");
    expect(rawPayload.record.tags).toEqual(["design"]);
    expect(await readFile(join(rootDir, "memory/raw/index.jsonl"), "utf8")).toContain(rawPayload.record.id);

    const wiki = await runCli(rootDir, [
      "wiki",
      "create",
      "Design Principles",
      "--summary",
      "This page is backed by a raw source.",
      "--source",
      rawPayload.record.id,
      "--tag",
      "Design",
      "--json"
    ]);
    const wikiPayload = parseData<{
      readonly created: true;
      readonly page: { readonly slug: string; readonly path: string; readonly sourceRefs: readonly string[] };
    }>(wiki.stdout);
    expect(wiki.exitCode).toBe(0);
    expect(wikiPayload.page).toEqual(
      expect.objectContaining({ slug: "design-principles", path: "memory/wiki/design-principles.md" })
    );
    expect(wikiPayload.page.sourceRefs).toEqual([rawPayload.record.id]);
    const wikiMarkdown = await readFile(join(rootDir, "memory/wiki/design-principles.md"), "utf8");
    expect(wikiMarkdown).toContain("source_refs:\n  - bw_source_");

    await writeFile(
      join(rootDir, "memory/wiki/project-index.md"),
      `---\nkind: boreal-wiki-page\nschemaVersion: boreal.vault.v1\nid: bw_page_index\nslug: project-index\ntitle: Project Index\nclaim_status: accepted\nsource_refs:\n  - ${rawPayload.record.id}\n---\n\n# Project Index\n\n[[Design Principles]]\n`,
      "utf8"
    );
    const wikiList = await runCli(rootDir, ["wiki", "list", "--json"]);
    const wikiRows = parseData<Array<{
      readonly title: string;
      readonly truthStatus: string;
      readonly backlinkCount: number;
      readonly sourceRefCount: number;
      readonly showCommand: string;
    }>>(wikiList.stdout);
    expect(wikiList.exitCode).toBe(0);
    expect(wikiRows[0]).toEqual(expect.objectContaining({
      title: "Project Index",
      truthStatus: "accepted",
      sourceRefCount: 1,
      showCommand: "bwrk wiki show bw_page_index --json"
    }));
    expect(wikiRows.find((row) => row.title === "Design Principles")).toEqual(
      expect.objectContaining({ truthStatus: "draft", backlinkCount: 1 })
    );

    const wikiShow = await runCli(rootDir, ["wiki", "show", "project-index", "--json"]);
    const wikiDetail = parseData<{
      readonly title: string;
      readonly truthStatus: string;
      readonly outboundPages: readonly Array<{ readonly title: string; readonly truthStatus: string }>;
      readonly missingOutboundLinks: readonly string[];
    }>(wikiShow.stdout);
    expect(wikiShow.exitCode).toBe(0);
    expect(wikiDetail).toEqual(expect.objectContaining({ title: "Project Index", truthStatus: "accepted" }));
    expect(wikiDetail.outboundPages).toEqual(
      expect.arrayContaining([expect.objectContaining({ title: "Design Principles", truthStatus: "draft" })])
    );
    expect(wikiDetail.missingOutboundLinks).toEqual([]);

    const health = await runCli(rootDir, ["vault", "status", "--json"]);
    const healthPayload = parseData<{
      readonly ok: boolean;
      readonly health: {
        readonly ok: boolean;
        readonly hasWarnings: boolean;
        readonly rawSourceCount: number;
        readonly wikiPageCount: number;
        readonly ledgerEventCount: number;
        readonly orphanPages: readonly string[];
        readonly brokenLinks: readonly unknown[];
        readonly missingSourceRefs: readonly unknown[];
        readonly malformedLedgerEvents: readonly unknown[];
      };
    }>(health.stdout);
    expect(health.exitCode).toBe(0);
    expect(healthPayload.ok).toBe(true);
    expect(healthPayload.health).toEqual(
      expect.objectContaining({
        ok: true,
        hasWarnings: false,
        rawSourceCount: 1,
        wikiPageCount: 2,
        ledgerEventCount: 0,
        brokenLinks: [],
        missingSourceRefs: [],
        malformedLedgerEvents: [],
        orphanPages: []
      })
    );

    const doctor = await runCli(rootDir, ["doctor", "--json"]);
    const doctorPayload = parseData<{
      readonly diagnostics: Array<{ readonly code: string; readonly severity: string }>;
    }>(doctor.stdout);
    expect(doctorPayload.diagnostics.find((diagnostic) => diagnostic.code === "vault.health")).toEqual(
      expect.objectContaining({ severity: "ok" })
    );

    await writeFile(
      join(rootDir, "memory/wiki/unlinked.md"),
      "---\nkind: boreal-wiki-page\nschemaVersion: boreal.vault.v1\nslug: unlinked\nsource_refs: []\n---\n\n# Unlinked\n\nNo source yet.\n",
      "utf8"
    );
    const orphanHealth = await runCli(rootDir, ["vault", "status", "--json"]);
    const orphanPayload = parseData<{
      readonly health: { readonly ok: boolean; readonly hasWarnings: boolean; readonly orphanPages: readonly string[] };
    }>(orphanHealth.stdout);
    expect(orphanHealth.exitCode).toBe(0);
    expect(orphanPayload.health).toEqual(
      expect.objectContaining({
        ok: true,
        hasWarnings: true,
        orphanPages: ["memory/wiki/unlinked.md"]
      })
    );

    await writeFile(
      join(rootDir, "memory/wiki/broken.md"),
      "---\nkind: boreal-wiki-page\nschemaVersion: boreal.vault.v1\nslug: broken\nsource_refs:\n  - bw_source_missing\n---\n\n# Broken\n\n[[Missing Page]]\n",
      "utf8"
    );
    const brokenHealth = await runCli(rootDir, ["vault", "status", "--json"]);
    const brokenPayload = parseData<{
      readonly ok: boolean;
      readonly health: {
        readonly ok: boolean;
        readonly brokenLinks: readonly Array<{ readonly target: string }>;
        readonly missingSourceRefs: readonly Array<{ readonly sourceRef: string }>;
      };
    }>(brokenHealth.stdout);
    expect(brokenHealth.exitCode).toBe(1);
    expect(brokenPayload.ok).toBe(false);
    expect(brokenPayload.health.brokenLinks).toEqual(
      expect.arrayContaining([expect.objectContaining({ target: "Missing Page" })])
    );
    expect(brokenPayload.health.missingSourceRefs).toEqual(
      expect.arrayContaining([expect.objectContaining({ sourceRef: "bw_source_missing" })])
    );

    await writeFile(join(rootDir, "memory/ledgers/events.jsonl"), "{\"bad\":true}\n", "utf8");
    const malformedLedgerHealth = await runCli(rootDir, ["vault", "status", "--json"]);
    const malformedLedgerPayload = parseData<{
      readonly ok: boolean;
      readonly health: {
        readonly malformedLedgerEvents: readonly Array<{ readonly line: number; readonly error: string }>;
      };
    }>(malformedLedgerHealth.stdout);
    expect(malformedLedgerHealth.exitCode).toBe(1);
    expect(malformedLedgerPayload.ok).toBe(false);
    expect(malformedLedgerPayload.health.malformedLedgerEvents).toEqual(
      expect.arrayContaining([expect.objectContaining({ line: 1, error: expect.stringContaining("unsupported shape") })])
    );
  });

  it("links source-backed claims and decisions to wiki pages and doctors coverage", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);
    await runCli(rootDir, ["vault", "init", "--json"]);

    const raw = parseData<{ readonly record: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "raw",
          "add",
          "--title",
          "Runtime coverage source",
          "--uri",
          "file://runtime-coverage.md",
          "--json"
        ])
      ).stdout
    );
    const wiki = parseData<{ readonly page: { readonly id: string; readonly slug: string; readonly path: string } }>(
      (
        await runCli(rootDir, [
          "wiki",
          "create",
          "Runtime Coverage",
          "--slug",
          "runtime-coverage",
          "--source",
          raw.record.id,
          "--json"
        ])
      ).stdout
    );
    const source = parseData<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "source",
          "add",
          "--title",
          "Runtime coverage source",
          "--uri",
          "memory/wiki/runtime-coverage.md",
          "--kind",
          "document",
          "--summary",
          "Runtime claim and decision coverage.",
          "--json"
        ])
      ).stdout
    );

    const missingWiki = await runCli(rootDir, [
      "claim",
      "create",
      "--statement",
      "Missing wiki references fail closed.",
      "--source",
      source.meta.id,
      "--wiki",
      "missing-runtime-page",
      "--json"
    ]);
    expect(missingWiki.exitCode).toBe(1);
    expect(parseJson<{ readonly code: string }>(missingWiki.stderr).code).toBe("BOREAL_NOT_FOUND");

    const claim = parseData<{
      readonly meta: { readonly id: string };
      readonly sourceIds: readonly string[];
      readonly wikiPageIds: readonly string[];
    }>(
      (
        await runCli(rootDir, [
          "claim",
          "create",
          "--statement",
          "Runtime claims should cite wiki coverage.",
          "--status",
          "accepted",
          "--source",
          source.meta.id,
          "--wiki",
          wiki.page.slug,
          "--json"
        ])
      ).stdout
    );
    expect(claim.sourceIds).toEqual([source.meta.id]);
    expect(claim.wikiPageIds).toEqual([wiki.page.id]);

    const decision = parseData<{
      readonly meta: { readonly id: string };
      readonly sourceIds: readonly string[];
      readonly wikiPageIds: readonly string[];
    }>(
      (
        await runCli(rootDir, [
          "decision",
          "create",
          "--title",
          "Runtime wiki coverage",
          "--decision",
          "Claims and decisions cite wiki pages.",
          "--status",
          "accepted",
          "--source",
          source.meta.id,
          "--wiki",
          wiki.page.path,
          "--json"
        ])
      ).stdout
    );
    expect(decision.sourceIds).toEqual([source.meta.id]);
    expect(decision.wikiPageIds).toEqual([wiki.page.id]);

    const claimRows = parseData<Array<{ readonly id: string; readonly wikiPageIds: readonly string[]; readonly wikiPageCount: number }>>(
      (await runCli(rootDir, ["claim", "list", "--json"])).stdout
    );
    expect(claimRows.find((row) => row.id === claim.meta.id)).toEqual(
      expect.objectContaining({ wikiPageIds: [wiki.page.id], wikiPageCount: 1 })
    );
    const decisionRows = parseData<Array<{ readonly id: string; readonly wikiPageIds: readonly string[]; readonly wikiPageCount: number }>>(
      (await runCli(rootDir, ["decision", "list", "--json"])).stdout
    );
    expect(decisionRows.find((row) => row.id === decision.meta.id)).toEqual(
      expect.objectContaining({ wikiPageIds: [wiki.page.id], wikiPageCount: 1 })
    );

    const coveredDoctor = parseData<DoctorPayload>((await runCli(rootDir, ["doctor", "--json"])).stdout);
    expect(doctorDiagnostic(coveredDoctor, "knowledge.dangling_wiki_pages")).toEqual(expect.objectContaining({ severity: "ok" }));
    expect(doctorDiagnostic(coveredDoctor, "knowledge.missing_wiki_coverage")).toEqual(expect.objectContaining({ severity: "ok" }));
    expect(doctorDiagnostic(coveredDoctor, "knowledge.stale_source_assertions")).toEqual(expect.objectContaining({ severity: "ok" }));

    const uncoveredClaim = parseData<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "claim",
          "create",
          "--statement",
          "Source-backed claims need wiki coverage.",
          "--source",
          source.meta.id,
          "--json"
        ])
      ).stdout
    );
    const staleClaim = parseData<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "claim",
          "create",
          "--statement",
          "Stale source-backed claims are visible.",
          "--status",
          "stale",
          "--source",
          source.meta.id,
          "--wiki",
          wiki.page.id,
          "--json"
        ])
      ).stdout
    );
    const warningDoctor = parseData<DoctorPayload>((await runCli(rootDir, ["doctor", "--json"])).stdout);
    expect(doctorDiagnostic(warningDoctor, "knowledge.missing_wiki_coverage")).toEqual(
      expect.objectContaining({
        severity: "warning",
        details: expect.arrayContaining([expect.objectContaining({ claimId: uncoveredClaim.meta.id })])
      })
    );
    expect(doctorDiagnostic(warningDoctor, "knowledge.stale_source_assertions")).toEqual(
      expect.objectContaining({
        severity: "warning",
        details: expect.arrayContaining([expect.objectContaining({ claimId: staleClaim.meta.id })])
      })
    );

    await rm(join(rootDir, "memory/wiki/runtime-coverage.md"));
    const danglingDoctor = parseData<DoctorPayload>((await runCli(rootDir, ["doctor", "--json"])).stdout);
    expect(doctorDiagnostic(danglingDoctor, "knowledge.dangling_wiki_pages")).toEqual(
      expect.objectContaining({
        severity: "error",
        details: expect.arrayContaining([
          expect.objectContaining({ claimId: claim.meta.id, wikiPageId: wiki.page.id }),
          expect.objectContaining({ decisionId: decision.meta.id, wikiPageId: wiki.page.id })
        ])
      })
    );
  });

  it("reports stale truth repair workflows with safe and manual commands", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);
    await runCli(rootDir, ["vault", "init", "--json"]);

    const linkedRaw = parseData<{ readonly record: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "raw",
          "add",
          "--title",
          "Linked truth source",
          "--uri",
          "file://linked-truth.md",
          "--json"
        ])
      ).stdout
    );
    const queuedRaw = parseData<{ readonly record: { readonly id: string; readonly title: string } }>(
      (
        await runCli(rootDir, [
          "raw",
          "add",
          "--title",
          "Unreconciled Raw Source",
          "--uri",
          "file://unreconciled.md",
          "--json"
        ])
      ).stdout
    );
    const wiki = parseData<{ readonly page: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "wiki",
          "create",
          "Linked Truth",
          "--slug",
          "linked-truth",
          "--source",
          linkedRaw.record.id,
          "--json"
        ])
      ).stdout
    );
    const acceptedSource = parseData<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "source",
          "add",
          "--title",
          "Accepted claim source",
          "--uri",
          "memory/wiki/linked-truth.md#accepted",
          "--json"
        ])
      ).stdout
    );
    const rejectedSource = parseData<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "source",
          "add",
          "--title",
          "Rejected claim source",
          "--uri",
          "memory/wiki/linked-truth.md#rejected",
          "--json"
        ])
      ).stdout
    );

    const acceptedClaim = parseData<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "claim",
          "create",
          "--statement",
          "Runtime truth conflicts.",
          "--status",
          "accepted",
          "--source",
          acceptedSource.meta.id,
          "--wiki",
          wiki.page.id,
          "--json"
        ])
      ).stdout
    );
    const rejectedClaim = parseData<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "claim",
          "create",
          "--statement",
          "Runtime truth conflicts.",
          "--status",
          "rejected",
          "--source",
          rejectedSource.meta.id,
          "--wiki",
          wiki.page.id,
          "--json"
        ])
      ).stdout
    );
    const supersededDecision = parseData<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "decision",
          "create",
          "--title",
          "Legacy Runtime Path",
          "--decision",
          "Use the old runtime path.",
          "--status",
          "superseded",
          "--source",
          acceptedSource.meta.id,
          "--wiki",
          wiki.page.id,
          "--json"
        ])
      ).stdout
    );

    const doctor = parseData<DoctorPayload>((await runCli(rootDir, ["doctor", "--json"])).stdout);
    expect(doctorDiagnostic(doctor, "knowledge.claim_contradictions")).toEqual(
      expect.objectContaining({
        severity: "warning",
        details: expect.arrayContaining([
          expect.objectContaining({
            workflow: expect.objectContaining({
              id: "boreal.workflow.contradiction-resolution.v1",
              path: "workflows/20-memory/contradiction-resolution.md"
            }),
            acceptedClaimIds: [acceptedClaim.meta.id],
            conflictingClaimIds: [rejectedClaim.meta.id],
            safeFixCommands: ["bwrk sync refresh --json", "bwrk doctor --strict --json"],
            manualReviewCommands: expect.arrayContaining([
              `bwrk claim show ${acceptedClaim.meta.id} --json`,
              `bwrk claim show ${rejectedClaim.meta.id} --json`,
              "bwrk work create 'Review contradictory claim: Runtime truth conflicts.' --kind task --label truth-review --json"
            ])
          })
        ])
      })
    );
    expect(doctorDiagnostic(doctor, "knowledge.superseded_decision_review")).toEqual(
      expect.objectContaining({
        severity: "warning",
        details: expect.arrayContaining([
          expect.objectContaining({
            decisionId: supersededDecision.meta.id,
            workflow: expect.objectContaining({
              id: "boreal.workflow.supersede-decision.v1",
              path: "workflows/30-knowledge/supersede-decision.md"
            }),
            safeFixCommands: ["bwrk sync refresh --json", "bwrk doctor --strict --json"],
            manualReviewCommands: expect.arrayContaining([
              `bwrk decision show ${supersededDecision.meta.id} --json`,
              "bwrk decision list --status accepted --json",
              "bwrk work create 'Review superseded decision: Legacy Runtime Path' --kind task --label truth-review --json"
            ])
          })
        ])
      })
    );
    expect(doctorDiagnostic(doctor, "knowledge.raw_source_reconciliation")).toEqual(
      expect.objectContaining({
        severity: "warning",
        details: expect.arrayContaining([
          expect.objectContaining({
            sourceId: queuedRaw.record.id,
            workflow: expect.objectContaining({
              id: "boreal.workflow.reconcile-raw-to-memory.v1",
              path: "workflows/20-memory/reconcile-raw-to-memory.md"
            }),
            safeFixCommands: ["bwrk sync refresh --json", "bwrk doctor --strict --json"],
            manualReviewCommands: [
              `bwrk raw show ${queuedRaw.record.id} --json`,
              `bwrk wiki create '${queuedRaw.record.title}' --source ${queuedRaw.record.id} --json`
            ]
          })
        ])
      })
    );
  });

  it("lists raw vault sources and shows bounded source previews", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);
    await runCli(rootDir, ["vault", "init", "--json"]);
    await writeFile(join(rootDir, "large-source.txt"), "0123456789abcdef\n".repeat(600), "utf8");
    await writeFile(join(rootDir, "binary-source.bin"), Buffer.from([0, 1, 2, 3, 4]));

    const large = parseData<{ readonly record: { readonly id: string } }>((await runCli(rootDir, [
      "raw",
      "add",
      "--title",
      "Large Source",
      "--uri",
      "large-source.txt",
      "--summary",
      "Large text asset.",
      "--json"
    ])).stdout);
    const missing = parseData<{ readonly record: { readonly id: string } }>((await runCli(rootDir, [
      "raw",
      "add",
      "--title",
      "Missing Source",
      "--uri",
      "missing-source.txt",
      "--json"
    ])).stdout);
    const binary = parseData<{ readonly record: { readonly id: string } }>((await runCli(rootDir, [
      "raw",
      "add",
      "--title",
      "Binary Source",
      "--uri",
      "binary-source.bin",
      "--kind",
      "artifact",
      "--json"
    ])).stdout);
    const external = parseData<{ readonly record: { readonly id: string } }>((await runCli(rootDir, [
      "raw",
      "add",
      "--title",
      "External Source",
      "--uri",
      "https://example.test/source.txt",
      "--json"
    ])).stdout);

    await runCli(rootDir, ["wiki", "create", "Large Source Notes", "--source", large.record.id, "--json"]);

    const list = await runCli(rootDir, ["raw", "list", "--json"]);
    const rows = parseData<Array<{
      readonly id: string;
      readonly title: string;
      readonly sourceBacked: boolean;
      readonly immutable: boolean;
      readonly processingStatus: string;
      readonly linkedPageCount: number;
      readonly retrievalCommand: string;
      readonly previewCommand: string;
    }>>(list.stdout);
    expect(list.exitCode).toBe(0);
    expect(rows.find((row) => row.id === large.record.id)).toEqual(
      expect.objectContaining({
        sourceBacked: true,
        immutable: true,
        processingStatus: "linked",
        linkedPageCount: 1,
        retrievalCommand: `bwrk raw show ${large.record.id} --json`,
        previewCommand: `bwrk raw show ${large.record.id} --preview-bytes 4096 --json`
      })
    );
    expect(rows.find((row) => row.id === missing.record.id)).toEqual(expect.objectContaining({ processingStatus: "queued" }));

    const largeShow = parseData<{
      readonly preview: { readonly status: string; readonly mediaType: string; readonly body: string; readonly truncated: boolean };
      readonly linkedPages: readonly Array<{ readonly title: string }>;
    }>((await runCli(rootDir, ["raw", "show", large.record.id, "--preview-bytes", "32", "--json"])).stdout);
    expect(largeShow.preview).toEqual(expect.objectContaining({ status: "truncated", mediaType: "text", truncated: true }));
    expect(largeShow.preview.body.length).toBeLessThanOrEqual(32);
    expect(largeShow.linkedPages).toEqual(expect.arrayContaining([expect.objectContaining({ title: "Large Source Notes" })]));

    const missingShow = parseData<{ readonly preview: { readonly status: string; readonly mediaType: string; readonly message: string } }>(
      (await runCli(rootDir, ["raw", "show", missing.record.id, "--json"])).stdout
    );
    expect(missingShow.preview).toEqual(
      expect.objectContaining({ status: "missing", mediaType: "missing", message: expect.stringContaining("missing") })
    );

    const binaryShow = parseData<{ readonly preview: { readonly status: string; readonly mediaType: string } }>(
      (await runCli(rootDir, ["raw", "show", binary.record.id, "--json"])).stdout
    );
    expect(binaryShow.preview).toEqual(expect.objectContaining({ status: "unsupported", mediaType: "binary" }));

    const externalShow = parseData<{ readonly preview: { readonly status: string; readonly mediaType: string } }>(
      (await runCli(rootDir, ["raw", "show", external.record.id, "--json"])).stdout
    );
    expect(externalShow.preview).toEqual(expect.objectContaining({ status: "external", mediaType: "external" }));

    const tooLarge = await runCli(rootDir, ["raw", "show", large.record.id, "--preview-bytes", "65537", "--json"]);
    expect(tooLarge.exitCode).toBe(2);
    expect(parseJson<{ readonly code: string; readonly message: string }>(tooLarge.stderr)).toEqual(
      expect.objectContaining({
        code: "BOREAL_INVALID_INPUT",
        message: expect.stringContaining("--preview-bytes must be at most 65536")
      })
    );
  });

  it("serializes concurrent vault raw source appends", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);
    await runCli(rootDir, ["vault", "init", "--json"]);

    const results = await Promise.all(
      Array.from({ length: 24 }, (_, index) =>
        runCli(rootDir, [
          "raw",
          "add",
          "--title",
          `Concurrent raw source ${index}`,
          "--uri",
          `file://concurrent-${index}.md`,
          "--json"
        ])
      )
    );

    expect(results.map((result) => result.exitCode)).toEqual(Array.from({ length: 24 }, () => 0));

    const records = (await readFile(join(rootDir, "memory/raw/index.jsonl"), "utf8"))
      .trim()
      .split(/\r?\n/u)
      .map((line) => parseJson<{ readonly id: string }>(line));
    expect(records).toHaveLength(24);
    expect(new Set(records.map((record) => record.id)).size).toBe(24);

    const status = await runCli(rootDir, ["vault", "status", "--json"]);
    const payload = parseData<{
      readonly health: { readonly rawSourceCount: number; readonly malformedRawRecords: readonly unknown[] };
    }>(status.stdout);
    expect(payload.health.rawSourceCount).toBe(24);
    expect(payload.health.malformedRawRecords).toEqual([]);
  });

  it("scans duplicate work and vault records with non-destructive merge plans", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);
    await runCli(rootDir, ["vault", "init", "--json"]);
    await runCli(rootDir, ["work", "create", "Duplicate Task", "--json"]);
    await runCli(rootDir, ["work", "create", "Duplicate Task", "--json"]);
    await runCli(rootDir, ["raw", "add", "--title", "Duplicate Source A", "--uri", "file://duplicate.md", "--json"]);
    await runCli(rootDir, ["raw", "add", "--title", "Duplicate Source B", "--uri", "file://duplicate.md", "--json"]);
    await runCli(rootDir, ["wiki", "create", "Duplicate Wiki", "--slug", "duplicate-wiki-a", "--json"]);
    await runCli(rootDir, ["wiki", "create", "Duplicate Wiki", "--slug", "duplicate-wiki-b", "--json"]);

    const scan = await runCli(rootDir, ["duplicate", "scan", "--json"]);
    const scanPayload = parseData<{
      readonly ok: boolean;
      readonly scanned: { readonly work: number; readonly raw: number; readonly wiki: number };
      readonly duplicateGroups: Array<{
        readonly domain: string;
        readonly reason: string;
        readonly records: Array<{ readonly id: string; readonly title: string }>;
      }>;
      readonly mergePlans: Array<{
        readonly id: string;
        readonly domain: string;
        readonly destructive: boolean;
        readonly strategy: string;
        readonly survivorId: string;
        readonly duplicateIds: readonly string[];
        readonly commands: readonly string[];
      }>;
    }>(scan.stdout);
    expect(scan.exitCode).toBe(0);
    expect(scanPayload.ok).toBe(false);
    expect(scanPayload.scanned).toEqual(expect.objectContaining({ work: 2, raw: 2, wiki: 2 }));
    expect(scanPayload.duplicateGroups.map((group) => group.domain)).toEqual(
      expect.arrayContaining(["work", "raw", "wiki"])
    );
    expect(scanPayload.mergePlans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ domain: "work", destructive: false, strategy: "manual_review" }),
        expect.objectContaining({ domain: "raw", destructive: false, strategy: "manual_review" }),
        expect.objectContaining({ domain: "wiki", destructive: false, strategy: "manual_review" })
      ])
    );

    const firstPlan = scanPayload.mergePlans[0];
    expect(firstPlan?.commands[0]).toContain("bwrk merge plan");
    const planned = await runCli(rootDir, [
      "merge",
      "plan",
      "--domain",
      firstPlan?.domain ?? "work",
      "--survivor",
      firstPlan?.survivorId ?? "",
      "--duplicate",
      firstPlan?.duplicateIds[0] ?? "",
      "--json"
    ]);
    const plannedPayload = parseData<{ readonly destructive: boolean; readonly strategy: string }>(planned.stdout);
    expect(planned.exitCode).toBe(0);
    expect(plannedPayload).toEqual(expect.objectContaining({ destructive: false, strategy: "manual_review" }));

    const workPlan = scanPayload.mergePlans.find((plan) => plan.domain === "work");
    const unconfirmed = await runCli(rootDir, [
      "merge",
      "apply",
      "--domain",
      "work",
      "--survivor",
      workPlan?.survivorId ?? "",
      "--duplicate",
      workPlan?.duplicateIds[0] ?? "",
      "--plan",
      workPlan?.id ?? "",
      "--json"
    ]);
    expect(unconfirmed.exitCode).toBe(2);
    expect(parseJson<{ readonly code: string; readonly message: string }>(unconfirmed.stderr)).toEqual(
      expect.objectContaining({ code: "BOREAL_INVALID_INPUT", message: expect.stringContaining("--confirm") })
    );

    const appliedWork = await runCli(rootDir, [
      "merge",
      "apply",
      "--domain",
      "work",
      "--survivor",
      workPlan?.survivorId ?? "",
      "--duplicate",
      workPlan?.duplicateIds[0] ?? "",
      "--plan",
      workPlan?.id ?? "",
      "--confirm",
      "--json"
    ]);
    const appliedWorkPayload = parseData<{
      readonly applied: true;
      readonly mode: string;
      readonly changedWorkIds: readonly string[];
      readonly event: { readonly type: string; readonly operationId: string };
    }>(appliedWork.stdout);
    const mergedState = await readState<{
      readonly workItems: Array<{
        readonly meta: { readonly id: string; readonly tags: readonly string[] };
        readonly status: string;
        readonly labels: readonly string[];
        readonly description: string;
        readonly closedReason?: string;
      }>;
    }>(rootDir);
    const survivor = mergedState.workItems.find((item) => item.meta.id === workPlan?.survivorId);
    const duplicate = mergedState.workItems.find((item) => item.meta.id === workPlan?.duplicateIds[0]);
    expect(appliedWork.exitCode).toBe(0);
    expect(appliedWorkPayload).toEqual(
      expect.objectContaining({ applied: true, mode: "state_archive", changedWorkIds: expect.arrayContaining([workPlan?.survivorId]) })
    );
    expect(appliedWorkPayload.event.type).toBe("merge.applied");
    expect(appliedWorkPayload.event.operationId).toMatch(/^bw_operation_/);
    expect(survivor?.labels).toContain("merged-survivor");
    expect(survivor?.description).toContain("Merge Archive");
    expect(duplicate).toEqual(
      expect.objectContaining({
        status: "cancelled",
        closedReason: `Merged into ${workPlan?.survivorId} by ${workPlan?.id}`
      })
    );
    expect(duplicate?.labels).toContain("merged-duplicate");

    const rawPlan = scanPayload.mergePlans.find((plan) => plan.domain === "raw");
    const appliedRaw = await runCli(rootDir, [
      "merge",
      "apply",
      "--domain",
      "raw",
      "--survivor",
      rawPlan?.survivorId ?? "",
      "--duplicate",
      rawPlan?.duplicateIds[0] ?? "",
      "--plan",
      rawPlan?.id ?? "",
      "--confirm",
      "--json"
    ]);
    const appliedRawPayload = parseData<{
      readonly applied: true;
      readonly mode: string;
      readonly vaultEvent: { readonly type: string; readonly subjectType: string; readonly payload: { readonly planId: string } };
    }>(appliedRaw.stdout);
    const rawLedgerEvents = await readFile(join(rootDir, "memory/ledgers/events.jsonl"), "utf8");
    const rawIndex = await readFile(join(rootDir, "memory/raw/index.jsonl"), "utf8");
    expect(appliedRaw.exitCode).toBe(0);
    expect(appliedRawPayload.mode).toBe("vault_event");
    expect(appliedRawPayload.vaultEvent).toEqual(
      expect.objectContaining({
        type: "merge.applied",
        subjectType: "raw",
        payload: expect.objectContaining({ planId: rawPlan?.id })
      })
    );
    expect(rawLedgerEvents).toContain(rawPlan?.id ?? "");
    expect(rawIndex).toContain(rawPlan?.survivorId ?? "");
    expect(rawIndex).toContain(rawPlan?.duplicateIds[0] ?? "");

    const postMergeScan = await runCli(rootDir, ["duplicate", "scan", "--json"]);
    const postMergePayload = parseData<{
      readonly duplicateGroups: Array<{ readonly domain: string; readonly records: Array<{ readonly id: string }> }>;
    }>(postMergeScan.stdout);
    const postMergeWorkIds = postMergePayload.duplicateGroups.find((group) => group.domain === "work")?.records.map((record) => record.id) ?? [];
    expect(postMergeWorkIds).not.toContain(workPlan?.duplicateIds[0]);
    expect(postMergePayload.duplicateGroups.find((group) => group.domain === "raw")).toBeUndefined();
  });

  it("analyzes compaction candidates with source preservation guarantees", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);
    await runCli(rootDir, ["vault", "init", "--json"]);
    const work = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Closed compact candidate", "--json"])).stdout
    );
    await updateState(rootDir, (state) => ({
      ...state,
      workItems: state.workItems.map((item) =>
        item.meta.id === work.meta.id
          ? {
              ...item,
              status: "closed",
              closedAt: "2026-01-01T00:00:00.000Z",
              evidenceIds: ["bw_evidence_compact"],
              verificationIds: ["bw_verification_compact"],
              meta: {
                ...item.meta,
                sourceRefs: [{ uri: "file://closed-work.md", label: "source" }]
              }
            }
          : item
      )
    }));
    const raw = parseData<{ readonly record: { readonly id: string } }>(
      (await runCli(rootDir, ["raw", "add", "--title", "Compact source", "--uri", "file://compact.md", "--json"])).stdout
    );
    await runCli(rootDir, ["wiki", "create", "Compact Wiki", "--source", raw.record.id, "--summary", "Candidate wiki page.", "--json"]);
    await runCli(rootDir, ["wiki", "create", "Unlinked Compact Wiki", "--summary", "Unsourced candidate wiki page.", "--json"]);

    const analyzed = await runCli(rootDir, ["compact", "analyze", "--older-than-days", "1", "--json"]);
    const payload = parseData<{
      readonly ok: true;
      readonly candidates: Array<{ readonly domain: string; readonly title: string; readonly reason: string }>;
      readonly plans: Array<{
        readonly id: string;
        readonly domain: string;
        readonly destructive: boolean;
        readonly strategy: string;
        readonly targetId: string;
        readonly targetTitle: string;
        readonly preserves: {
          readonly evidenceIds: readonly string[];
          readonly verificationIds: readonly string[];
          readonly sourceRefs: readonly string[];
          readonly originalPaths: readonly string[];
        };
      }>;
    }>(analyzed.stdout);
    expect(analyzed.exitCode).toBe(0);
    expect(payload.ok).toBe(true);
    expect(payload.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ domain: "work", title: "Closed compact candidate" }),
        expect.objectContaining({ domain: "wiki", title: "Unlinked Compact Wiki", reason: "wiki page has no inbound links" })
      ])
    );
    expect(payload.candidates).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ domain: "wiki", title: "Compact Wiki" })])
    );
    expect(payload.plans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          domain: "work",
          destructive: false,
          strategy: "summarize_preserve_sources",
          preserves: expect.objectContaining({
            evidenceIds: ["bw_evidence_compact"],
            verificationIds: ["bw_verification_compact"],
            sourceRefs: ["source:file://closed-work.md"]
          })
        }),
        expect.objectContaining({
          domain: "wiki",
          targetTitle: "Unlinked Compact Wiki",
          preserves: expect.objectContaining({
            sourceRefs: [],
            originalPaths: ["memory/wiki/unlinked-compact-wiki.md"]
          })
        })
      ])
    );

    const workPlan = payload.plans.find((plan) => plan.domain === "work");
    const compactedWork = await runCli(rootDir, [
      "compact",
      "apply",
      "--domain",
      "work",
      "--target",
      workPlan?.targetId ?? "",
      "--plan",
      workPlan?.id ?? "",
      "--summary",
      "Reviewed compact work summary.",
      "--older-than-days",
      "1",
      "--confirm",
      "--json"
    ]);
    const compactedWorkPayload = parseData<{
      readonly applied: true;
      readonly archivePath: string;
      readonly preserves: { readonly evidenceIds: readonly string[]; readonly sourceRefs: readonly string[] };
      readonly event: { readonly type: string; readonly operationId: string };
      readonly vaultEvent: { readonly type: string; readonly payload: { readonly archivePath: string } };
    }>(compactedWork.stdout);
    const compactedState = await readState<{
      readonly workItems: Array<{ readonly meta: { readonly id: string; readonly tags: readonly string[] }; readonly description: string; readonly labels: readonly string[] }>;
    }>(rootDir);
    const compactedWorkRecord = compactedState.workItems.find((item) => item.meta.id === work.meta.id);
    const workArchive = await readFile(join(rootDir, compactedWorkPayload.archivePath), "utf8");
    expect(compactedWork.exitCode).toBe(0);
    expect(compactedWorkPayload.archivePath).toBe(`memory/work/compacted/${work.meta.id}.md`);
    expect(compactedWorkPayload.preserves.evidenceIds).toEqual(["bw_evidence_compact"]);
    expect(compactedWorkPayload.preserves.sourceRefs).toEqual(["source:file://closed-work.md"]);
    expect(compactedWorkPayload.event.type).toBe("compact.applied");
    expect(compactedWorkPayload.event.operationId).toMatch(/^bw_operation_/);
    expect(compactedWorkPayload.vaultEvent.payload.archivePath).toBe(compactedWorkPayload.archivePath);
    expect(workArchive).toContain("Original Description");
    expect(workArchive).toContain("Reviewed compact work summary.");
    expect(compactedWorkRecord?.description).toContain("Reviewed compact work summary.");
    expect(compactedWorkRecord?.description).toContain("Preserved evidence IDs");
    expect(compactedWorkRecord?.labels).toContain("compacted");

    const wikiPlan = payload.plans.find((plan) => plan.domain === "wiki");
    const compactedWiki = await runCli(rootDir, [
      "compact",
      "apply",
      "--domain",
      "wiki",
      "--target",
      wikiPlan?.targetId ?? "",
      "--plan",
      wikiPlan?.id ?? "",
      "--summary",
      "Reviewed compact wiki summary.",
      "--confirm",
      "--json"
    ]);
    const compactedWikiPayload = parseData<{
      readonly applied: true;
      readonly archivePath: string;
      readonly preserves: { readonly sourceRefs: readonly string[]; readonly originalPaths: readonly string[] };
      readonly vaultEvent: { readonly subjectType: string; readonly payload: { readonly archivePath: string } };
    }>(compactedWiki.stdout);
    const wikiArchive = await readFile(join(rootDir, compactedWikiPayload.archivePath), "utf8");
    const wikiPage = await readFile(join(rootDir, "memory/wiki/unlinked-compact-wiki.md"), "utf8");
    const compactEvents = await readFile(join(rootDir, "memory/ledgers/events.jsonl"), "utf8");
    expect(compactedWiki.exitCode).toBe(0);
    expect(compactedWikiPayload.archivePath).toMatch(/^memory\/wiki\/archive\/unlinked-compact-wiki-/);
    expect(compactedWikiPayload.preserves).toEqual(
      expect.objectContaining({ sourceRefs: [], originalPaths: ["memory/wiki/unlinked-compact-wiki.md"] })
    );
    expect(compactedWikiPayload.vaultEvent.subjectType).toBe("wiki");
    expect(wikiArchive).toContain("Unsourced candidate wiki page.");
    expect(wikiPage).toContain("claim_status: compacted");
    expect(wikiPage).toContain("Reviewed compact wiki summary.");
    expect(wikiPage).toContain(compactedWikiPayload.archivePath);
    expect(compactEvents).toContain(workPlan?.id ?? "");
    expect(compactEvents).toContain(wikiPlan?.id ?? "");

    const postCompactAnalyze = await runCli(rootDir, ["compact", "analyze", "--older-than-days", "1", "--json"]);
    const postCompactPayload = parseData<{
      readonly candidates: Array<{ readonly domain: string; readonly id: string }>;
    }>(postCompactAnalyze.stdout);
    expect(postCompactPayload.candidates).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ domain: "work", id: work.meta.id }),
        expect.objectContaining({ domain: "wiki", id: wikiPlan?.targetId })
      ])
    );

    await rm(join(rootDir, compactedWikiPayload.archivePath));
    const missingArchiveHealth = await runCli(rootDir, ["vault", "status", "--json"]);
    const missingArchivePayload = parseData<{
      readonly ok: boolean;
      readonly health: {
        readonly missingArchiveRefs: readonly Array<{ readonly archivePath: string; readonly subjectType: string }>;
      };
    }>(missingArchiveHealth.stdout);
    expect(missingArchiveHealth.exitCode).toBe(1);
    expect(missingArchivePayload.ok).toBe(false);
    expect(missingArchivePayload.health.missingArchiveRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ archivePath: compactedWikiPayload.archivePath, subjectType: "wiki" })
      ])
    );
  });

  it("prints the agent guide without an initialized workspace", async () => {
    const rootDir = await makeTempWorkspace();

    const jsonGuide = await runCli(rootDir, ["agent", "guide", "--agent", "agent $one's", "--label", "cli label", "--json"]);
    const payload = parseData<{
      readonly agentId: string;
      readonly labels: readonly string[];
      readonly commands: {
        readonly status: string;
        readonly start: string;
        readonly finish: string;
        readonly evidence: string;
        readonly verify: string;
        readonly release: string;
        readonly repair: string;
      };
      readonly loop: Array<{ readonly step: string; readonly command: string }>;
      readonly recovery: Array<{ readonly command: string }>;
    }>(jsonGuide.stdout);

    expect(jsonGuide.exitCode).toBe(0);
    expect(payload.agentId).toBe("agent $one's");
    expect(payload.labels).toEqual(["cli label"]);
    expect(payload.commands.status).toBe("bwrk agent status --agent 'agent $one'\\''s' --label 'cli label' --json");
    expect(payload.commands.start).toBe(
      "bwrk agent start --agent 'agent $one'\\''s' --label 'cli label' --purpose 'start implementation' --json"
    );
    expect(payload.commands.finish).toBe(
      "bwrk agent finish <work-id> --agent 'agent $one'\\''s' --summary 'implemented and tested' --command 'pnpm test' --close --reason 'verified by evidence' --json"
    );
    expect(payload.commands.evidence).toContain("bwrk evidence add <work-id>");
    expect(payload.commands.verify).toContain("bwrk work verify <work-id>");
    expect(payload.commands.release).toBe("bwrk work release <work-id> --json");
    expect(payload.commands.repair).toBe("bwrk doctor --fix --json");
    expect(payload.loop.map((step) => step.step)).toEqual([
      "Check coordination state",
      "Start or resume work",
      "Renew if work continues",
      "Finish with evidence",
      "Release if stopping"
    ]);
    expect(payload.recovery.map((step) => step.command)).toContain("bwrk doctor --fix --json");

    const textGuide = await runCli(rootDir, ["agent", "guide", "--agent", "agent-a", "--label", "cli"]);
    expect(textGuide.exitCode).toBe(0);
    expect(textGuide.stdout).toContain("Boreal agent guide");
    expect(textGuide.stdout).toContain("bwrk agent start --agent agent-a --label cli --purpose 'start implementation' --json");
    expect(textGuide.stdout).toContain(
      "bwrk agent finish <work-id> --agent agent-a --summary 'implemented and tested' --command 'pnpm test' --close --reason 'verified by evidence' --json"
    );
    expect(textGuide.stdout).toContain("bwrk doctor --fix --json");
  });

  it("primes and summarizes agent protocol sessions", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);
    await runCli(rootDir, ["work", "create", "Session protocol work", "--label", "cli", "--ready", "--json"]);

    const primed = await runCli(rootDir, ["prime", "--agent", "agent-a", "--label", "cli", "--json"]);
    const primePayload = parseData<{
      readonly kind: string;
      readonly sessionId: string;
      readonly sync: { readonly ok: boolean; readonly recommendedActions: readonly string[] };
      readonly agent: { readonly readyWork: { readonly claimableCount: number } };
      readonly commands: { readonly sessionEnd: string; readonly agentStart: string };
      readonly recommendedActions: readonly string[];
    }>(primed.stdout);

    expect(primed.exitCode).toBe(0);
    expect(primePayload.kind).toBe("prime");
    expect(primePayload.sessionId).toBe("local");
    expect(primePayload.agent.readyWork.claimableCount).toBe(1);
    expect(primePayload.commands.sessionEnd).toBe("bwrk session end --session local --agent agent-a --label cli --json");
    expect(primePayload.commands.agentStart).toBe(
      "bwrk agent start --session local --agent agent-a --label cli --purpose 'start implementation' --json"
    );
    expect(primePayload.sync.ok).toBe(false);
    expect(primePayload.sync.recommendedActions).toEqual(expect.arrayContaining(["bwrk vault init --json"]));
    expect(primePayload.recommendedActions).toContain("bwrk session end --session local --agent agent-a --label cli --json");

    const started = await runCli(rootDir, ["session", "start", "--agent", "agent-a", "--label", "cli", "--json"]);
    const startedPayload = parseData<{
      readonly kind: string;
      readonly sessionId: string;
      readonly commands: {
        readonly prime: string;
        readonly sessionStart: string;
        readonly sessionEnd: string;
        readonly operationList: string;
      };
      readonly operations: { readonly sessionId: string; readonly total: number };
    }>(started.stdout);
    expect(started.exitCode).toBe(0);
    expect(startedPayload.kind).toBe("session_start");
    expect(startedPayload.sessionId).toMatch(/^session-[a-f0-9]{12}$/);
    expect(startedPayload.operations).toEqual(expect.objectContaining({ sessionId: startedPayload.sessionId, total: 0 }));
    expect(startedPayload.commands.prime).toContain(`bwrk prime --session ${startedPayload.sessionId} --agent agent-a --label cli --json`);
    expect(startedPayload.commands.sessionStart).toBe(
      `bwrk session start --id ${startedPayload.sessionId} --agent agent-a --label cli --json`
    );
    expect(startedPayload.commands.sessionEnd).toBe(
      `bwrk session end --session ${startedPayload.sessionId} --agent agent-a --label cli --json`
    );
    expect(startedPayload.commands.operationList).toBe(
      `bwrk operation list --session ${startedPayload.sessionId} --session-id ${startedPayload.sessionId} --limit 20 --json`
    );

    await runCli(rootDir, ["work", "list", "--session", startedPayload.sessionId, "--json"]);
    const operationList = await runCli(rootDir, ["operation", "list", "--session-id", startedPayload.sessionId, "--limit", "20", "--json"]);
    const operationRows = parseData<Array<{ readonly actorId: string; readonly actorKind: string }>>(operationList.stdout);
    expect(operationList.exitCode).toBe(0);
    expect(operationRows.length).toBeGreaterThan(0);
    expect(operationRows.every((operation) => ["human", "agent", "system"].includes(operation.actorKind))).toBe(true);
    expect(operationRows.every((operation) => operation.actorId.length > 0)).toBe(true);

    const ended = await runCli(rootDir, ["session", "end", "--id", startedPayload.sessionId, "--agent", "agent-a", "--label", "cli", "--json"]);
    const endedPayload = parseData<{
      readonly kind: string;
      readonly sessionId: string;
      readonly operations: {
        readonly total: number;
        readonly succeeded: number;
        readonly failed: number;
        readonly recent: Array<{ readonly commandPath: string; readonly sessionId: string }>;
      };
      readonly recommendedActions: readonly string[];
    }>(ended.stdout);

    expect(ended.exitCode).toBe(0);
    expect(endedPayload.kind).toBe("session_end");
    expect(endedPayload.sessionId).toBe(startedPayload.sessionId);
    expect(endedPayload.operations.total).toBeGreaterThanOrEqual(2);
    expect(endedPayload.operations.succeeded).toBeGreaterThanOrEqual(2);
    expect(endedPayload.operations.failed).toBe(0);
    expect(endedPayload.operations.recent.map((operation) => operation.commandPath)).toEqual(
      expect.arrayContaining(["session start", "work list"])
    );
    expect(endedPayload.operations.recent.every((operation) => operation.sessionId === startedPayload.sessionId)).toBe(true);
    expect(endedPayload.recommendedActions).not.toContain(
      `bwrk session end --session ${startedPayload.sessionId} --agent agent-a --label cli --json`
    );
  });

  it("exposes the registered command surface as JSON", async () => {
    const rootDir = await makeTempWorkspace();

    const result = await runCli(rootDir, ["commands", "--json"]);
    const registry = parseData<{
      readonly commands: Array<{
        readonly path: readonly string[];
        readonly usage: string;
        readonly flags: Array<{ readonly name: string; readonly type: string }>;
        readonly behavior: {
          readonly readOnly: boolean;
          readonly writesState: boolean;
          readonly writesGeneratedArtifacts: boolean;
          readonly requiresFreshIndex: boolean;
          readonly requiresLock: string;
          readonly maxResultSizeChars: number;
          readonly jsonOutputSchema: string;
          readonly examples: readonly string[];
        };
      }>;
    }>(result.stdout);
    const reserve = registry.commands.find((command) => command.path.join(" ") === "work reserve");
    const commands = registry.commands.find((command) => command.path.join(" ") === "commands");
    const completion = registry.commands.find((command) => command.path.join(" ") === "completion");
    const searchQuery = registry.commands.find((command) => command.path.join(" ") === "search query");
    const searchIndex = registry.commands.find((command) => command.path.join(" ") === "search index");
    const evidenceAdd = registry.commands.find((command) => command.path.join(" ") === "evidence add");
    const agentFinish = registry.commands.find((command) => command.path.join(" ") === "agent finish");

    expect(result.exitCode).toBe(0);
    expect(() => validateCommandBehaviorMetadata()).not.toThrow();
    expect(registry.commands.map((command) => command.path.join(" "))).toContain("commands");
    expect(registry.commands.map((command) => command.path.join(" "))).toContain("completion");
    expect(registry.commands.map((command) => command.path.join(" "))).toContain("version");
    expect(registry.commands.map((command) => command.path.join(" "))).toEqual(
      expect.arrayContaining([
        "source add",
        "claim create",
        "decision create",
        "context rebuild",
        "context show",
        "context search",
        "search index",
        "search query",
        "dep add",
        "dep remove",
        "dep tree",
        "dep cycles",
        "work claim",
        "work release",
        "work renew",
        "reservation list",
        "prime",
        "agent guide",
        "agent finish",
        "agent start",
        "agent status",
        "session start",
        "session end",
        "completion",
        "operation list",
        "operation show",
        "operation prune",
        "operation repair",
        "workflows list",
        "workflows show",
        "install codex",
        "install claude",
        "install skills",
        "registry list",
        "registry add",
        "registry remove",
        "registry import-setup",
        "registry doctor",
        "sprint list",
        "sprint show",
        "sprint current",
        "sprint activate",
        "sprint board",
        "sprint report",
        "export json",
        "export markdown",
        "export ledgers",
        "import json",
        "import ledgers",
        "vault init",
        "vault status",
        "raw add",
        "raw list",
        "raw show",
        "wiki list",
        "wiki show",
        "wiki create",
        "duplicate scan",
        "merge plan",
        "merge apply",
        "compact analyze",
        "compact apply",
        "sync status",
        "sync refresh",
        "ledger status",
        "ledger delete",
        "snapshot create",
        "snapshot list",
        "snapshot show",
        "doctor skills"
      ])
    );
    expect(reserve?.flags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "force", type: "boolean" }),
        expect.objectContaining({ name: "reason", type: "value" })
      ])
    );
    expect(completion?.flags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "name", type: "value" }),
        expect.objectContaining({ name: "json", type: "boolean" })
      ])
    );
    expect(registry.commands.every((command) => command.behavior.examples.length > 0)).toBe(true);
    expect(registry.commands.every((command) => command.behavior.jsonOutputSchema.startsWith("boreal.cli."))).toBe(true);
    expect(registry.commands.every((command) => command.behavior.maxResultSizeChars > 0)).toBe(true);
    expect(
      registry.commands
        .filter((command) => command.behavior.writesGeneratedArtifacts)
        .every((command) => command.behavior.requiresLock !== "none")
    ).toBe(true);
    expect(commands?.behavior.readOnly).toBe(true);
    expect(reserve?.behavior).toEqual(expect.objectContaining({ writesState: true, requiresLock: "state" }));
    expect(searchIndex?.behavior).toEqual(
      expect.objectContaining({ writesGeneratedArtifacts: true, requiresLock: "index" })
    );
    expect(searchQuery?.behavior).toEqual(expect.objectContaining({ readOnly: true, requiresFreshIndex: true }));
    expect(evidenceAdd?.usage).toContain("[--kind command|test|diff|review|artifact|note]");
    expect(evidenceAdd?.usage).not.toContain("document");
    expect(evidenceAdd?.flags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "kind",
          summary: "Evidence kind: command, test, diff, review, artifact, or note. Defaults to command."
        })
      ])
    );
    expect(agentFinish?.behavior).toEqual(
      expect.objectContaining({ writesGeneratedArtifacts: true, requiresLock: "state+index" })
    );
  });

  it("generates shell completions from the command registry", async () => {
    const rootDir = await makeTempWorkspace();
    const commandPaths = COMMAND_DEFINITIONS.map(commandPath);

    const zsh = await runCli(rootDir, ["completion", "zsh"]);
    expect(zsh.exitCode).toBe(0);
    expect(zsh.stdout).toContain("#compdef bwrk");
    expect(zsh.stdout).toContain("Generated from COMMAND_DEFINITIONS");
    expect(zsh.stdout).toContain("compadd --");

    const bash = await runCli(rootDir, ["completion", "bash", "--name", "boreal"]);
    expect(bash.exitCode).toBe(0);
    expect(bash.stdout).toContain("complete -F boreal_completion boreal");
    expect(bash.stdout).toContain("work create");

    const fish = await runCli(rootDir, ["completion", "fish", "--name", "boreal", "--json"]);
    const fishPayload = parseData<{ readonly shell: string; readonly name: string; readonly script: string }>(fish.stdout);
    expect(fish.exitCode).toBe(0);
    expect(fishPayload).toEqual(expect.objectContaining({ shell: "fish", name: "boreal" }));
    expect(fishPayload.script).toContain("complete -c 'boreal'");
    expect(fishPayload.script).toContain("-l 'workspace'");

    for (const command of commandPaths) {
      expect(zsh.stdout).toContain(command);
      expect(bash.stdout).toContain(command);
      expect(fishPayload.script).toContain(command);
    }

    const invalid = await runCli(rootDir, ["completion", "powershell", "--json"]);
    const invalidPayload = parseJson<{ readonly ok: false; readonly code: string; readonly message: string }>(invalid.stderr);
    expect(invalid.exitCode).toBe(2);
    expect(invalidPayload.code).toBe("BOREAL_INVALID_INPUT");
    expect(invalidPayload.message).toContain("bash, zsh, fish");
  });

  it("lists workflows, shows workflow markdown, plans skill installs, and doctors skill assets", async () => {
    const rootDir = await makeTempWorkspace();

    const workflows = await runCli(rootDir, ["workflows", "list", "--json"]);
    const workflowRows = parseData<Array<{ readonly id: string; readonly path: string }>>(workflows.stdout);
    const shown = await runCli(rootDir, ["workflows", "show", "launch-sprint"]);
    const installPlan = await runCli(rootDir, ["install", "skills", "--dry-run", "--json"]);
    const plan = parseData<{
      readonly dryRun: boolean;
      readonly files: Array<{ readonly destination: string; readonly workflowRefs: readonly string[] }>;
      readonly issues: readonly unknown[];
    }>(installPlan.stdout);
    const doctor = await runCli(rootDir, ["doctor", "skills", "--json"]);
    const doctorPayload = parseData<{
      readonly ok: boolean;
      readonly workflowCount: number;
      readonly templateCount: number;
      readonly skillCount: number;
      readonly installedChecks: readonly unknown[];
      readonly issues: readonly unknown[];
    }>(doctor.stdout);

    expect(workflows.exitCode).toBe(0);
    expect(workflowRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "boreal.workflow.launch-sprint.v1", path: "40-work/launch-sprint.md" })
      ])
    );
    expect(shown.exitCode).toBe(0);
    expect(shown.stdout).toContain("# Launch Sprint");
    expect(shown.stdout).toContain("bwrk session start");
    expect(installPlan.exitCode).toBe(0);
    expect(plan.dryRun).toBe(true);
    expect(plan.issues).toEqual([]);
    expect(plan.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          destination: expect.stringContaining(".agents/skills/boreal-router/SKILL.md"),
          workflowRefs: expect.arrayContaining(["00-agent/route-request.md"])
        })
      ])
    );
    expect(doctor.exitCode).toBe(0);
    expect(doctorPayload).toEqual(
      expect.objectContaining({ ok: true, workflowCount: expect.any(Number), templateCount: expect.any(Number), skillCount: expect.any(Number) })
    );
    expect(doctorPayload.installedChecks).toEqual([]);
    expect(doctorPayload.issues).toEqual([]);
  });

  it("validates skill frontmatter with standards-compatible quoted YAML scalars", async () => {
    const rootDir = await makeTempWorkspace();
    const assetRoot = join(rootDir, "assets");
    await mkdir(join(assetRoot, "workflows/00-agent"), { recursive: true });
    await mkdir(join(assetRoot, "templates"), { recursive: true });
    await mkdir(join(assetRoot, "skills/boreal-test"), { recursive: true });
    await writeFile(
      join(assetRoot, "workflows/00-agent/route-request.md"),
      [
        "---",
        "id: boreal.workflow.test-route.v1",
        "title: Test Route",
        "group: agent",
        "allowed_commands:",
        "  - work list",
        "templates:",
        "  - none",
        "---",
        "",
        "# Test Route"
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      join(assetRoot, "skills/boreal-test/boreal.yaml"),
      ["skill: boreal-test", "display_name: Boreal Test", "workflows:", "  - 00-agent/route-request.md"].join("\n"),
      "utf8"
    );
    const skillBody = [
      "Use `bwrk workflows show <ref>` to resolve workflow refs.",
      "Keep this skill as a thin adapter.",
      "Workflow: `workflows/00-agent/route-request.md`"
    ].join("\n");

    await writeFile(
      join(assetRoot, "skills/boreal-test/SKILL.md"),
      ["---", "name: boreal-test", "description: Adapter for: invalid YAML", "---", "", skillBody].join("\n"),
      "utf8"
    );
    await expect(inspectWorkflowAssets({ assetRoot })).rejects.toMatchObject({
      code: "BOREAL_INVALID_INPUT",
      message: "YAML scalar containing ': ' must be quoted"
    });

    await writeFile(
      join(assetRoot, "skills/boreal-test/SKILL.md"),
      ["---", "name: boreal-test", 'description: "Adapter for: valid YAML"', "---", "", skillBody].join("\n"),
      "utf8"
    );
    await expect(inspectWorkflowAssets({ assetRoot })).resolves.toEqual(
      expect.objectContaining({ ok: true, workflowCount: 1, templateCount: 0, skillCount: 1, issues: [] })
    );
  });

  it("installs Codex and Claude skill files and keeps dry-run read-only", async () => {
    const rootDir = await makeTempWorkspace();
    const dryRunRoot = join(rootDir, "dry-run-skills");
    const codexRoot = join(rootDir, "codex-home");
    const claudeRoot = join(rootDir, "claude-home");

    const dryRun = await runCli(rootDir, ["install", "skills", "--install-root", dryRunRoot, "--dry-run", "--json"]);
    const codex = await runCli(rootDir, ["install", "codex", "--install-root", codexRoot, "--json"]);
    const claude = await runCli(rootDir, ["install", "claude", "--install-root", claudeRoot, "--json"]);
    const doctorCodex = await runCli(rootDir, ["doctor", "skills", "--install-root", codexRoot, "--skill-target", "codex", "--json"]);
    const doctorClaude = await runCli(rootDir, ["doctor", "skills", "--install-root", claudeRoot, "--skill-target", "claude", "--json"]);
    const codexRouter = await readFile(join(codexRoot, "skills/boreal-router/SKILL.md"), "utf8");
    const codexRouterMetadata = await readFile(join(codexRoot, "skills/boreal-router/boreal.yaml"), "utf8");
    const codexOpenAiMetadata = await readFile(join(codexRoot, "skills/boreal-router/agents/openai.yaml"), "utf8");
    const claudeRouter = await readFile(join(claudeRoot, "skills/boreal-router/SKILL.md"), "utf8");
    const claudeRouterMetadata = await readFile(join(claudeRoot, "skills/boreal-router/boreal.yaml"), "utf8");
    const codexDoctorPayload = parseData<{
      readonly ok: boolean;
      readonly installedChecks: Array<{ readonly target: string; readonly skillRoot: string; readonly expectedFileCount: number }>;
      readonly issues: readonly unknown[];
    }>(doctorCodex.stdout);
    const claudeDoctorPayload = parseData<{
      readonly ok: boolean;
      readonly installedChecks: Array<{ readonly target: string; readonly skillRoot: string; readonly expectedFileCount: number }>;
      readonly issues: readonly unknown[];
    }>(doctorClaude.stdout);

    expect(dryRun.exitCode).toBe(0);
    expect(await fileMissing(join(dryRunRoot, "boreal-router/SKILL.md"))).toBe(true);
    expect(await fileMissing(join(dryRunRoot, "skills/boreal-router/SKILL.md"))).toBe(true);
    expect(codex.exitCode).toBe(0);
    expect(parseData<{ readonly files: readonly unknown[]; readonly issues: readonly unknown[] }>(codex.stdout)).toEqual(
      expect.objectContaining({
        issues: [],
        files: expect.arrayContaining([
          expect.objectContaining({ destination: join(codexRoot, "skills/boreal-router/SKILL.md") }),
          expect.objectContaining({ destination: join(codexRoot, "skills/boreal-router/agents/openai.yaml") })
        ])
      })
    );
    expect(codexRouter).toContain("name: boreal-router");
    expect(codexRouter).toContain("00-agent/route-request.md");
    expect(codexRouter).toContain("bwrk workflows show <ref>");
    expect(codexRouter).toContain("not paths that must exist inside the installed skill folder");
    expect(codexRouter).toContain("You may read this skill folder's `SKILL.md`, `boreal.yaml`");
    expect(codexRouterMetadata).toContain("skill: boreal-router");
    expect(codexOpenAiMetadata).toContain("default_prompt: \"Use $boreal-router");
    expect(doctorCodex.exitCode).toBe(0);
    expect(codexDoctorPayload).toEqual(
      expect.objectContaining({
        ok: true,
        installedChecks: [expect.objectContaining({ target: "codex", skillRoot: join(codexRoot, "skills") })],
        issues: []
      })
    );
    expect(codexDoctorPayload.installedChecks[0]?.expectedFileCount).toBeGreaterThan(0);
    expect(claude.exitCode).toBe(0);
    expect(parseData<{ readonly files: readonly unknown[]; readonly issues: readonly unknown[] }>(claude.stdout)).toEqual(
      expect.objectContaining({
        issues: [],
        files: expect.arrayContaining([
          expect.objectContaining({ destination: join(claudeRoot, "skills/boreal-router/SKILL.md") }),
          expect.objectContaining({ destination: join(claudeRoot, "skills/boreal-router/boreal.yaml") })
        ])
      })
    );
    expect(claudeRouter).toContain("name: boreal-router");
    expect(claudeRouter).toContain("00-agent/route-request.md");
    expect(claudeRouter).toContain("bwrk workflows show <ref>");
    expect(claudeRouter).toContain("not paths that must exist inside the installed skill folder");
    expect(claudeRouter).toContain("You may read this skill folder's `SKILL.md`, `boreal.yaml`");
    expect(claudeRouterMetadata).toContain("skill: boreal-router");
    expect(doctorClaude.exitCode).toBe(0);
    expect(claudeDoctorPayload).toEqual(
      expect.objectContaining({
        ok: true,
        installedChecks: [expect.objectContaining({ target: "claude", skillRoot: join(claudeRoot, "skills") })],
        issues: []
      })
    );
    expect(claudeDoctorPayload.installedChecks[0]?.expectedFileCount).toBeGreaterThan(0);
    expect(await fileMissing(join(claudeRoot, "skills/boreal-router/agents/openai.yaml"))).toBe(true);
  });

  it("reports stale or target-mismatched installed skills", async () => {
    const rootDir = await makeTempWorkspace();
    const claudeRoot = join(rootDir, "claude-home");
    await runCli(rootDir, ["install", "claude", "--install-root", claudeRoot, "--json"]);
    await mkdir(join(claudeRoot, "skills/boreal-router/agents"), { recursive: true });
    await writeFile(join(claudeRoot, "skills/boreal-router/agents/openai.yaml"), "unexpected: true\n", "utf8");
    await writeFile(join(claudeRoot, "skills/boreal-router/SKILL.md"), "stale skill\n", "utf8");

    const doctor = await runCli(rootDir, ["doctor", "skills", "--install-root", claudeRoot, "--skill-target", "claude", "--json"]);
    const payload = parseData<{
      readonly ok: boolean;
      readonly issues: Array<{ readonly code: string; readonly path: string }>;
    }>(doctor.stdout);

    expect(doctor.exitCode).toBe(1);
    expect(payload.ok).toBe(false);
    expect(payload.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["installed_skill.stale_file", "installed_skill.missing_workflow_resolver", "installed_skill.unexpected_openai_metadata"])
    );
  });

  it("uses configured skill roots without nesting skills directories twice", async () => {
    const rootDir = await makeTempWorkspace();
    const configured = await runCli(rootDir, [
      "init",
      "--setup-memory",
      "--memory-root",
      "memory",
      "--memory-layout",
      "child",
      "--install-root",
      ".agents/skills",
      "--skill-target",
      "codex",
      "--json"
    ]);
    const codex = await runCli(rootDir, ["install", "codex", "--dry-run", "--json"]);
    const claude = await runCli(rootDir, ["install", "claude", "--dry-run", "--json"]);
    const explicitCodex = await runCli(rootDir, ["install", "codex", "--install-root", ".agents/skills", "--dry-run", "--json"]);
    const interactiveCodex = await runCli(rootDir, ["install", "codex", "--interactive"]);
    const codexPlan = parseData<{
      readonly installRoot: string;
      readonly skillRoot: string;
      readonly files: Array<{ readonly destination: string }>;
    }>(codex.stdout);
    const claudePlan = parseData<{
      readonly installRoot: string;
      readonly skillRoot: string;
      readonly files: Array<{ readonly destination: string }>;
    }>(claude.stdout);
    const explicitCodexPlan = parseData<{
      readonly installRoot: string;
      readonly skillRoot: string;
      readonly files: Array<{ readonly destination: string }>;
    }>(explicitCodex.stdout);

    expect(configured.exitCode).toBe(0);
    expect(codex.exitCode).toBe(0);
    expect(codexPlan.installRoot).toBe(join(rootDir, ".agents/skills"));
    expect(codexPlan.skillRoot).toBe(join(rootDir, ".agents/skills"));
    expect(codexPlan.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ destination: join(rootDir, ".agents/skills/boreal-router/SKILL.md") })
      ])
    );
    expect(codex.stdout).not.toContain(".agents/skills/skills/");
    expect(claude.exitCode).toBe(0);
    expect(claudePlan.installRoot).toBe(join(rootDir, ".claude"));
    expect(claudePlan.skillRoot).toBe(join(rootDir, ".claude/skills"));
    expect(claudePlan.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ destination: join(rootDir, ".claude/skills/boreal-router/SKILL.md") })
      ])
    );
    expect(explicitCodex.exitCode).toBe(0);
    expect(explicitCodexPlan.skillRoot).toBe(join(rootDir, ".agents/skills"));
    expect(explicitCodex.stdout).not.toContain(".agents/skills/skills/");
    expect(interactiveCodex.exitCode).toBe(2);
    expect(interactiveCodex.stderr).toContain("--interactive requires a TTY");
  });

  it("reports local source, shim, PATH, and global bwrk install status", async () => {
    const rootDir = await makeTempWorkspace();
    const binDir = join(rootDir, "bin");
    const emptyPath = join(rootDir, "empty-path");
    await mkdir(binDir, { recursive: true });
    await mkdir(emptyPath, { recursive: true });

    const missing = await runCli(rootDir, ["install", "status", "--bin-dir", binDir, "--path", emptyPath, "--json"]);
    const missingPayload = parseData<{
      readonly schemaVersion: string;
      readonly localSource: { readonly available: boolean; readonly command: string };
      readonly localShim: { readonly exists: boolean; readonly executable: boolean; readonly path: string };
      readonly path: { readonly binDirOnPath: boolean; readonly addToPathCommand: string };
      readonly globalCommand: { readonly found: boolean };
      readonly recommendedActions: readonly string[];
    }>(missing.stdout);
    const directMissing = await inspectBorealInstallStatus({
      workspaceRoot: rootDir,
      checkedAt: "2026-06-27T00:00:00.000Z",
      binDir,
      envPath: emptyPath
    });

    expect(missing.exitCode).toBe(0);
    expect(missingPayload.schemaVersion).toBe("boreal.cli.install.status.v1");
    expect(missingPayload.localSource.available).toBe(true);
    expect(missingPayload.localSource.command).toBe("pnpm bwrk <command>");
    expect(missingPayload.localShim).toEqual(expect.objectContaining({ exists: false, executable: false, path: join(binDir, "bwrk") }));
    expect(missingPayload.path.binDirOnPath).toBe(false);
    expect(missingPayload.path.addToPathCommand).toContain(binDir);
    expect(missingPayload.globalCommand.found).toBe(false);
    expect(missingPayload.recommendedActions.join("\n")).toContain("pnpm install:local");
    expect(directMissing.globalCommand.found).toBe(false);

    const fakeBwrk = join(binDir, "bwrk");
    await writeFile(fakeBwrk, "#!/bin/sh\necho boreal-work 0.1.0\n", "utf8");
    await chmod(fakeBwrk, 0o755);

    const found = await runCli(rootDir, ["install", "status", "--bin-dir", binDir, "--path", binDir, "--json"]);
    const foundPayload = parseData<{
      readonly localShim: { readonly exists: boolean; readonly executable: boolean };
      readonly path: { readonly binDirOnPath: boolean };
      readonly globalCommand: { readonly found: boolean; readonly path: string; readonly probe: { readonly ok: boolean; readonly stdout: string } };
    }>(found.stdout);

    expect(found.exitCode).toBe(0);
    expect(foundPayload.localShim).toEqual(expect.objectContaining({ exists: true, executable: true }));
    expect(foundPayload.path.binDirOnPath).toBe(true);
    expect(foundPayload.globalCommand).toEqual(
      expect.objectContaining({
        found: true,
        path: fakeBwrk,
        probe: expect.objectContaining({ ok: true, stdout: "boreal-work 0.1.0" })
      })
    );
  });

  it("surfaces install status in doctor diagnostics", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);

    const doctor = await runCli(rootDir, ["doctor", "--json"]);
    const payload = parseData<DoctorPayload>(doctor.stdout);
    const diagnostic = doctorDiagnostic(payload, "install.status");

    expect(diagnostic).toEqual(
      expect.objectContaining({
        code: "install.status",
        details: expect.objectContaining({ schemaVersion: "boreal.cli.install.status.v1" })
      })
    );
  });

  it("generates a markdown command reference from the registry", async () => {
    const rootDir = await makeTempWorkspace();

    const markdown = await runCli(rootDir, ["commands", "--format", "markdown"]);
    const invalid = await runCli(rootDir, ["commands", "--format", "xml", "--json"]);
    const invalidPayload = parseJson<{ readonly ok: false; readonly code: string }>(invalid.stderr);

    expect(markdown.exitCode).toBe(0);
    expect(markdown.stdout).toContain("# Boreal Command Reference");
    expect(markdown.stdout).toContain("## `version`");
    expect(markdown.stdout).toContain("## `work create`");
    expect(markdown.stdout).toContain("bwrk work create <title> [--description <text>] [--priority low|normal|high|critical]");
    expect(markdown.stdout).toContain("bwrk evidence add <work-id> --summary <text> [--kind command|test|diff|review|artifact|note]");
    expect(markdown.stdout).toContain(
      "`--kind <value>`: Evidence kind: command, test, diff, review, artifact, or note. Defaults to command."
    );
    expect(markdown.stdout).toContain("Output schema: `boreal.cli.work.create.v1`");
    expect(markdown.stdout).toContain("`--label <value>`: Label to attach to the work item. Repeatable.");
    expect(markdown.stdout).toContain("`--skill-target <value>`: Skill target to install and record: codex or claude. Repeatable.");
    expect(markdown.stdout).not.toContain("Repeatable. Repeatable.");
    expect(invalid.exitCode).toBe(2);
    expect(invalidPayload.code).toBe("BOREAL_INVALID_INPUT");
  });

  it("renders opt-in dashboard views without changing json contracts", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);
    await runCli(rootDir, ["work", "create", "Dashboard ready work", "--label", "dashboard", "--ready", "--json"]);
    await runCli(rootDir, ["sync", "refresh", "--json"]);

    const doctor = await runCli(rootDir, ["doctor", "--view", "dashboard"]);
    const sync = await runCli(rootDir, ["sync", "status", "--view", "dashboard"]);
    const ready = await runCli(rootDir, ["work", "next", "--label", "dashboard", "--view", "dashboard"]);
    const workflows = await runCli(rootDir, ["workflows", "list", "--view", "dashboard"]);
    const lock = await runCli(rootDir, ["lock", "inspect", "--view", "dashboard"]);
    const agent = await runCli(rootDir, [
      "agent",
      "status",
      "--agent",
      "dashboard-agent",
      "--label",
      "dashboard",
      "--view",
      "dashboard"
    ]);
    const readyJson = await runCli(rootDir, ["work", "next", "--label", "dashboard", "--view", "dashboard", "--json"]);

    expect(doctor.exitCode).toBe(0);
    expect(doctor.stdout).toContain("Doctor");
    expect([0, 1]).toContain(sync.exitCode);
    expect(sync.stdout).toContain("Sync status");
    expect(ready.exitCode).toBe(0);
    expect(ready.stdout).toContain("Dashboard ready work");
    expect(workflows.exitCode).toBe(0);
    expect(workflows.stdout).toContain("Workflow picker");
    expect(lock.exitCode).toBe(0);
    expect(lock.stdout).toContain("State lock");
    expect(agent.exitCode).toBe(0);
    expect(agent.stdout).toContain("Agent dashboard-agent");
    expect(parseData<Array<{ readonly title: string }>>(readyJson.stdout)).toEqual([
      expect.objectContaining({ title: "Dashboard ready work" })
    ]);
  });

  it("records local command operations with session, redacted argv, and generated event ids", async () => {
    const rootDir = await makeTempWorkspace();

    const init = await runCli(rootDir, ["init", "--session", "Session One", "--actor", "Agent Op", "--actor-kind", "agent", "--json"]);
    expect(init.exitCode).toBe(0);
    const created = await runCli(rootDir, [
      "work",
      "create",
      "Operation tracked work",
      "--label",
      "Sensitive Label",
      "--source",
      "raw:bw_source_1",
      "--ready",
      "--session",
      "Run 42",
      "--actor",
      "Agent Op",
      "--actor-kind",
      "agent",
      "--json"
    ]);
    expect(created.exitCode).toBe(0);

    const state = parseJson<{
      readonly workItems: Array<{ readonly title: string; readonly meta: { readonly sourceRefs: readonly Array<{ readonly uri: string }> } }>;
      readonly events: Array<{ readonly meta: { readonly id: string }; readonly type: string; readonly operationId?: string }>;
      readonly operations: Array<{
        readonly meta: { readonly id: string; readonly contentHash: string };
        readonly sessionId: string;
        readonly commandPath: string;
        readonly argv: readonly string[];
        readonly actorId: string;
        readonly exitCode: number;
        readonly status: string;
        readonly stateChanged: boolean;
        readonly generatedArtifactsChanged: boolean;
        readonly eventIds: readonly string[];
      }>;
    }>(await readFile(join(rootDir, ".boreal/runtime/state.json"), "utf8"));
    const createdWork = state.workItems.find((item) => item.title === "Operation tracked work");
    const workCreatedEvent = state.events.find((event) => event.type === "work.created");
    const operation = state.operations.find((entry) => entry.commandPath === "work create");

    expect(createdWork?.meta.sourceRefs).toEqual([{ uri: "raw:bw_source_1" }]);
    expect(state.operations.map((entry) => entry.commandPath)).toEqual(expect.arrayContaining(["init", "work create"]));
    expect(operation).toEqual(
      expect.objectContaining({
        sessionId: "run 42",
        actorId: "agent op",
        exitCode: 0,
        status: "succeeded",
        stateChanged: true,
        generatedArtifactsChanged: false
      })
    );
    expect(operation?.meta.id).toMatch(/^bw_operation_/);
    expect(operation?.meta.contentHash).toMatch(/^sha256:/);
    expect(operation?.argv).toEqual(
      expect.arrayContaining(["work", "create", "--label", "<redacted>", "--source", "<redacted>", "--ready", "--session", "<redacted>", "--actor", "<redacted>"])
    );
    expect(operation?.argv.join(" ")).not.toContain("Operation tracked work");
    expect(operation?.argv.join(" ")).not.toContain("Sensitive Label");
    expect(workCreatedEvent).toBeDefined();
    expect(operation?.eventIds).toContain(workCreatedEvent?.meta.id);
    expect(workCreatedEvent?.operationId).toBe(operation?.meta.id);
  });

  it("lists, shows, and prunes local command operations", async () => {
    const rootDir = await makeTempWorkspace();

    await runCli(rootDir, ["init", "--json"]);
    await runCli(rootDir, [
      "work",
      "create",
      "Inspectable operation",
      "--ready",
      "--session",
      "Run 42",
      "--actor",
      "Agent Op",
      "--actor-kind",
      "agent",
      "--json"
    ]);

    const listed = await runCli(rootDir, ["operation", "list", "--session-id", "Run 42", "--limit", "10", "--json"]);
    const rows = parseData<Array<{ readonly id: string; readonly commandPath: string; readonly sessionId: string }>>(listed.stdout);
    const workOperation = rows.find((row) => row.commandPath === "work create");
    expect(listed.exitCode).toBe(0);
    expect(workOperation).toEqual(expect.objectContaining({ sessionId: "run 42" }));

    const prefix = workOperation?.id.slice(0, "bw_operation_".length + 12) ?? "";
    const shown = await runCli(rootDir, ["operation", "show", prefix, "--json"]);
    const shownOperation = parseData<{ readonly meta: { readonly id: string }; readonly commandPath: string }>(shown.stdout);
    expect(shown.exitCode).toBe(0);
    expect(shownOperation.meta.id).toBe(workOperation?.id);
    expect(shownOperation.commandPath).toBe("work create");

    const pruned = await runCli(rootDir, ["operation", "prune", "--keep", "2", "--json"]);
    const pruneResult = parseData<{
      readonly deleted: number;
      readonly remainingAfterOperationLog: number;
      readonly keep: number;
    }>(pruned.stdout);
    const state = parseJson<{
      readonly operations: Array<{ readonly commandPath: string }>;
    }>(await readFile(join(rootDir, ".boreal/runtime/state.json"), "utf8"));

    expect(pruned.exitCode).toBe(0);
    expect(pruneResult.deleted).toBeGreaterThan(0);
    expect(pruneResult.keep).toBe(2);
    expect(pruneResult.remainingAfterOperationLog).toBe(2);
    expect(state.operations).toHaveLength(2);
    expect(state.operations.map((operation) => operation.commandPath)).toContain("operation prune");
  });

  it("keeps strict doctor stable just above the operation prune target", async () => {
    const rootDir = await makeTempWorkspace();

    await runCli(rootDir, ["init", "--setup-memory", "--json"]);
    await runCli(rootDir, ["sync", "refresh", "--json"]);

    const initialState = await readState<{
      readonly operations: Array<Record<string, unknown>>;
      readonly [key: string]: unknown;
    }>(rootDir);
    const template = initialState.operations[0];
    if (!template) {
      throw new Error("expected init operation");
    }
    const templateMeta = template.meta as Record<string, unknown>;
    const syntheticOperationCount = 1001;
    const syntheticOperations = [
      ...initialState.operations,
      ...Array.from({ length: syntheticOperationCount - initialState.operations.length }, (_, index) => ({
        ...template,
        meta: {
          ...templateMeta,
          id: `bw_operation_${(index + 10_000).toString(16).padStart(12, "0")}`,
          contentHash: `sha256:${(index + 10_000).toString(16).padStart(64, "0")}`
        },
        eventIds: []
      }))
    ];

    await updateState(rootDir, (state) => ({
      ...state,
      operations: syntheticOperations
    }));

    const strictDoctor = await runCli(rootDir, ["doctor", "--strict", "--json"]);
    const payload = parseData<DoctorPayload>(strictDoctor.stdout);

    expect(strictDoctor.exitCode).toBe(0);
    expect(payload.ok).toBe(true);
    expect(doctorDiagnostic(payload, "operation.volume")).toEqual(
      expect.objectContaining({
        severity: "ok",
        message: "Operation log volume is above the prune target but within maintenance grace",
        details: expect.objectContaining({
          operationCount: syntheticOperationCount,
          recommendedKeep: 1000,
          warningThreshold: 1025
        })
      })
    );
  });

  it("auto-prunes local operation volume when it is the only strict closeout blocker", async () => {
    const rootDir = await makeTempWorkspace();

    await runCli(rootDir, ["init", "--setup-memory", "--json"]);
    await runCli(rootDir, ["sync", "refresh", "--json"]);

    const initialState = await readState<{
      readonly operations: Array<Record<string, unknown>>;
      readonly [key: string]: unknown;
    }>(rootDir);
    const template = initialState.operations[0];
    if (!template) {
      throw new Error("expected init operation");
    }
    const templateMeta = template.meta as Record<string, unknown>;
    const syntheticOperationCount = 1_030;
    await updateState(rootDir, (state) => ({
      ...state,
      operations: [
        ...initialState.operations,
        ...Array.from({ length: syntheticOperationCount - initialState.operations.length }, (_, index) => ({
          ...template,
          meta: {
            ...templateMeta,
            id: `bw_operation_${(index + 20_000).toString(16).padStart(12, "0")}`,
            contentHash: `sha256:${(index + 20_000).toString(16).padStart(64, "0")}`
          },
          eventIds: []
        }))
      ]
    }));

    const strictGate = await runCli(rootDir, ["gate", "closeout", "--strict", "--json"]);
    const strictPayload = parseData<{
      readonly ok: boolean;
      readonly autoPruneOperations: boolean;
      readonly operationPrune?: unknown;
      readonly doctor: { readonly ok: boolean; readonly diagnostics: DoctorPayload["diagnostics"] };
    }>(strictGate.stdout);
    const strictOperationVolume = strictPayload.doctor.diagnostics.find((diagnostic) => diagnostic.code === "operation.volume");

    expect(strictGate.exitCode).toBe(1);
    expect(strictPayload.ok).toBe(false);
    expect(strictPayload.autoPruneOperations).toBe(false);
    expect(strictPayload.operationPrune).toBeUndefined();
    expect(strictOperationVolume).toEqual(
      expect.objectContaining({
        severity: "warning",
        details: expect.objectContaining({ recommendedKeep: 1000, warningThreshold: 1025 })
      })
    );

    const autoGate = await runCli(rootDir, ["gate", "closeout", "--strict", "--auto-prune-operations", "--json"]);
    const autoPayload = parseData<{
      readonly ok: boolean;
      readonly autoPruneOperations: boolean;
      readonly operationPrune?: {
        readonly triggeredBy: string;
        readonly deleted: number;
        readonly keep: number;
        readonly remainingAfterOperationLog: number;
      };
      readonly doctor: { readonly ok: boolean; readonly diagnostics: DoctorPayload["diagnostics"] };
    }>(autoGate.stdout);
    const autoOperationVolume = autoPayload.doctor.diagnostics.find((diagnostic) => diagnostic.code === "operation.volume");
    const finalState = await readState<{
      readonly operations: Array<{ readonly commandPath: string }>;
    }>(rootDir);

    expect(autoGate.exitCode).toBe(0);
    expect(autoPayload.ok).toBe(true);
    expect(autoPayload.autoPruneOperations).toBe(true);
    expect(autoPayload.operationPrune).toEqual(
      expect.objectContaining({
        triggeredBy: "operation.volume",
        keep: 1000,
        remainingAfterOperationLog: 1000
      })
    );
    expect(autoPayload.operationPrune?.deleted).toBeGreaterThan(0);
    expect(autoOperationVolume).toEqual(expect.objectContaining({ severity: "ok" }));
    expect(finalState.operations).toHaveLength(1000);
    expect(finalState.operations.map((operation) => operation.commandPath)).toContain("gate closeout");
  });

  it("repairs legacy operation-event links and marks unlinked events", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);
    await runCli(rootDir, ["work", "create", "Repair operation links", "--ready", "--json"]);

    let createdEventId = "";
    let createdOperationId = "";
    let legacyEventId = "";
    await updateState(rootDir, (state) => {
      const events = (state.events as Array<Record<string, unknown>>) ?? [];
      const operations = (state.operations as Array<Record<string, unknown>>) ?? [];
      const createdEvent = events.find((event) => event.type === "work.created");
      const initEvent = events.find((event) => event.type === "workspace.initialized");
      createdEventId = String((createdEvent?.meta as Record<string, unknown> | undefined)?.id ?? "");
      legacyEventId = String((initEvent?.meta as Record<string, unknown> | undefined)?.id ?? "");
      const createdOperation = operations.find((operation) =>
        ((operation.eventIds as readonly string[] | undefined) ?? []).includes(createdEventId)
      );
      createdOperationId = String((createdOperation?.meta as Record<string, unknown> | undefined)?.id ?? "");
      return {
        ...state,
        events: events.map((event) => {
          if (event.type === "work.created" || event.type === "workspace.initialized") {
            const { operationId: _operationId, operationLink: _operationLink, ...legacyEvent } = event;
            return legacyEvent;
          }
          return event;
        }),
        operations: operations.map((operation) => ({
          ...operation,
          eventIds: ((operation.eventIds as readonly string[] | undefined) ?? []).filter((eventId) => eventId !== legacyEventId)
        }))
      };
    });

    const repaired = await runCli(rootDir, ["operation", "repair", "--json"]);
    const repairedPayload = parseData<{
      readonly linkedEvents: readonly string[];
      readonly markedLegacyEvents: readonly string[];
    }>(repaired.stdout);
    const state = parseJson<{
      readonly events: Array<{ readonly meta: { readonly id: string }; readonly operationId?: string; readonly operationLink?: string }>;
    }>(await readFile(join(rootDir, ".boreal/runtime/state.json"), "utf8"));
    const createdEvent = state.events.find((event) => event.meta.id === createdEventId);
    const legacyEvent = state.events.find((event) => event.meta.id === legacyEventId);

    expect(repaired.exitCode).toBe(0);
    expect(repairedPayload.linkedEvents).toContain(createdEventId);
    expect(repairedPayload.markedLegacyEvents).toContain(legacyEventId);
    expect(createdEvent?.operationId).toBe(createdOperationId);
    expect(createdEvent?.operationLink).toBeUndefined();
    expect(legacyEvent?.operationId).toBeUndefined();
    expect(legacyEvent?.operationLink).toBe("legacy");

    const doctor = await runCli(rootDir, ["doctor", "--json"]);
    const doctorPayload = parseData<{
      readonly ok: boolean;
      readonly diagnostics: Array<{ readonly code: string; readonly severity: string }>;
    }>(doctor.stdout);
    expect(doctor.exitCode).toBe(0);
    expect(doctorPayload.ok).toBe(true);
    expect(doctorPayload.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "operation.legacy_events", severity: "warning" })])
    );

    const strictDoctor = await runCli(rootDir, ["doctor", "--strict", "--json"]);
    const strictPayload = parseData<{
      readonly ok: boolean;
      readonly strict: boolean;
      readonly diagnostics: Array<{ readonly code: string; readonly severity: string }>;
    }>(strictDoctor.stdout);
    expect(strictDoctor.exitCode).toBe(1);
    expect(strictPayload.ok).toBe(false);
    expect(strictPayload.strict).toBe(true);
    expect(strictPayload.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "operation.legacy_events", severity: "warning" })])
    );

    await runCli(rootDir, ["export", "json", "--out", "repair-export.json", "--json"]);
    const exported = parseJson<{
      readonly state: { readonly events: Array<{ readonly operationId?: string; readonly operationLink?: string }> };
    }>(await readFile(join(rootDir, "repair-export.json"), "utf8"));
    expect(exported.state.events.every((event) => event.operationId === undefined && event.operationLink === undefined)).toBe(true);
  });

  it("rejects unknown flags and honors explicit false booleans", async () => {
    const rootDir = await makeTempWorkspace();

    const invalid = await runCli(rootDir, ["work", "create", "Invalid flag", "--prio", "critical", "--json"]);
    const invalidPayload = parseJson<{ readonly ok: false; readonly code: string; readonly message: string }>(
      invalid.stderr
    );
    expect(invalid.exitCode).toBe(2);
    expect(invalidPayload.ok).toBe(false);
    expect(invalidPayload.code).toBe("BOREAL_INVALID_INPUT");
    expect(invalidPayload.message).toContain("Unknown flag --prio");

    await runCli(rootDir, ["init", "--json"]);
    const created = await runCli(rootDir, ["work", "create", "Draft via false flag", "--ready=false", "--json"]);
    expect(created.exitCode).toBe(0);
    expect(parseData<{ readonly status: string }>(created.stdout).status).toBe("draft");
  });

  it("parses value flags from the command registry and honors json=true errors", async () => {
    const rootDir = await makeTempWorkspace();
    const parsed = parseArgs(["agent", "finish", "bw_work_example", "--summary", "done", "--release", "--json=true"]);

    expect(registryValueFlagNames()).toContain("summary");
    expect(flagValue(parsed, "summary")).toBe("done");
    expect(flagValue(parsed, "json")).toBe("true");

    const jsonError = await runCli(rootDir, ["unknown", "--json=true"]);
    const jsonPayload = parseJson<{ readonly ok: false; readonly code: string; readonly message: string }>(jsonError.stderr);
    expect(jsonError.exitCode).toBe(2);
    expect(jsonError.stdout).toBe("");
    expect(jsonPayload.ok).toBe(false);
    expect(jsonPayload.code).toBe("BOREAL_INVALID_INPUT");
    expect(jsonPayload.message).toContain("Unknown command");

    const humanError = await runCli(rootDir, ["unknown", "--json=false"]);
    expect(humanError.exitCode).toBe(2);
    expect(humanError.stderr).toContain("BOREAL_INVALID_INPUT: Unknown command");
  });

  it("redirects unexpected stdout while a json stdout guard is active", () => {
    let redirected = "";
    const guard = installJsonStdoutGuard({
      enabled: true,
      stderrWrite(text) {
        redirected += text;
      }
    });
    try {
      process.stdout.write("accidental stdout\n");
    } finally {
      guard.release();
    }

    expect(redirected).toBe("accidental stdout\n");
  });

  it("prints stable version output and treats broken stdout pipes as clean exits", async () => {
    const rootDir = await makeTempWorkspace();
    const text = await runCli(rootDir, ["--version"]);
    const human = await runCli(rootDir, ["version"]);
    const json = await runCli(rootDir, ["version", "--json"]);
    const shortcutJson = await runCli(rootDir, ["--version", "--json"]);
    const brokenPipeExit = await main(
      ["--version"],
      {
        write() {
          throw Object.assign(new Error("broken pipe"), { code: "EPIPE" });
        },
        error() {
          throw new Error("stderr should not be written");
        }
      },
      rootDir
    );
    const jsonPayload = parseData<{
      readonly schemaVersion: string;
      readonly name: string;
      readonly version: string;
      readonly cli: { readonly packageName: string; readonly packageVersion: string };
      readonly runtime: { readonly recordSchemaVersion: string; readonly fileStoreSchemaVersion: string };
      readonly schemas: Record<string, string>;
      readonly publishedSchemas: { readonly totalCount: number; readonly ids: readonly string[] };
      readonly migrationPolicy: { readonly version: string; readonly snapshotSchemaVersion: string; readonly rules: readonly string[] };
    }>(json.stdout);
    const shortcutPayload = parseData<{ readonly schemaVersion: string; readonly runtime: { readonly recordSchemaVersion: string } }>(
      shortcutJson.stdout
    );

    expect(text.exitCode).toBe(0);
    expect(text.stdout).toBe("boreal-work 0.1.0\n");
    expect(human.exitCode).toBe(0);
    expect(human.stdout).toContain("schemaVersion: boreal.cli.version.v1");
    expect(human.stdout).toContain("runtimeRecord: boreal.runtime.v1");
    expect(json.exitCode).toBe(0);
    expect(jsonPayload).toEqual(
      expect.objectContaining({ schemaVersion: "boreal.cli.version.v1", name: "boreal-work", version: "0.1.0" })
    );
    expect(jsonPayload.cli).toEqual(expect.objectContaining({ packageName: "@boreal/cli", packageVersion: "0.1.0" }));
    expect(jsonPayload.runtime).toEqual({
      recordSchemaVersion: "boreal.runtime.v1",
      fileStoreSchemaVersion: "boreal.file-store.v1"
    });
    expect(jsonPayload.schemas).toEqual(
      expect.objectContaining({
        runtimeRecord: "boreal.runtime.v1",
        fileStore: "boreal.file-store.v1",
        export: "boreal.export.v1",
        ledgerManifest: "boreal.ledgers.v1",
        ledgerDeletion: "boreal.ledger-deletion.v1",
        searchIndex: "boreal.search-index.v1",
        sqliteCache: "boreal.sqlite-cache.v1",
        projectSetup: "boreal.project-setup.v1",
        projectRegistry: "boreal.project-registry.v1",
        vault: "boreal.vault.v1",
        daemonStatus: "boreal.daemon.status.v1"
      })
    );
    expect(jsonPayload.publishedSchemas.totalCount).toBeGreaterThanOrEqual(14);
    expect(jsonPayload.publishedSchemas.ids).toContain("https://boreal.work/schemas/records/work-item.schema.json");
    expect(jsonPayload.migrationPolicy).toEqual(
      expect.objectContaining({
        version: "boreal.runtime-migration-policy.v1",
        snapshotSchemaVersion: "boreal.export.v1"
      })
    );
    expect(jsonPayload.migrationPolicy.rules.join("\n")).toContain(
      "Non-reversible migrations must create a boreal.export.v1 recovery snapshot"
    );
    expect(shortcutPayload).toEqual(
      expect.objectContaining({
        schemaVersion: "boreal.cli.version.v1",
        runtime: expect.objectContaining({ recordSchemaVersion: "boreal.runtime.v1" })
      })
    );
    expect(isBrokenPipeError(Object.assign(new Error("broken pipe"), { code: "EPIPE" }))).toBe(true);
    expect(brokenPipeExit).toBe(0);
  });

  it("runs the work lifecycle through file-backed commands", async () => {
    const rootDir = await makeTempWorkspace();
    const childDir = join(rootDir, "nested");
    await mkdir(childDir);

    const init = await runCli(rootDir, ["init", "--json"]);
    expect(init.exitCode).toBe(0);
    expect(parseData<{ readonly initialized: boolean }>(init.stdout).initialized).toBe(true);

    const created = await runCli(childDir, [
      "work",
      "create",
      "Build CLI surface",
      "--description",
      "Create a hardened command surface.",
      "--label",
      "cli",
      "--acceptance",
      "doctor stays clean",
      "--ready",
      "--json"
    ]);
    const work = parseData<{ readonly meta: { readonly id: string }; readonly status: string }>(created.stdout);
    expect(created.exitCode).toBe(0);
    expect(work.status).toBe("ready");

    const ready = await runCli(rootDir, ["work", "list", "--ready", "--json"]);
    expect(parseData<Array<{ readonly id: string }>>(ready.stdout).map((item) => item.id)).toContain(work.meta.id);

    const evidence = await runCli(rootDir, [
      "evidence",
      "add",
      work.meta.id,
      "--summary",
      "CLI lifecycle test passed",
      "--kind",
      "test",
      "--outcome",
      "passed",
      "--command",
      "pnpm test",
      "--json"
    ]);
    const evidenceRecord = parseData<{ readonly meta: { readonly id: string } }>(evidence.stdout);
    expect(evidence.exitCode).toBe(0);

    const redactedEvidence = await runCli(rootDir, [
      "evidence",
      "add",
      work.meta.id,
      "--summary",
      "CLI redaction evidence",
      "--kind",
      "command",
      "--outcome",
      "passed",
      "--command",
      "API_TOKEN=abc123 bwrk evidence add --token token123 --password=pw123",
      "--json"
    ]);
    const redactedEvidenceRecord = parseData<{ readonly command?: string }>(redactedEvidence.stdout);
    expect(redactedEvidence.exitCode).toBe(0);
    expect(redactedEvidenceRecord.command).toContain("API_TOKEN=<redacted>");
    expect(redactedEvidenceRecord.command).toContain("--token <redacted>");
    expect(redactedEvidenceRecord.command).toContain("--password=<redacted>");
    expect(redactedEvidenceRecord.command).not.toContain("abc123");
    expect(redactedEvidenceRecord.command).not.toContain("token123");
    expect(redactedEvidenceRecord.command).not.toContain("pw123");

    const artifactEvidence = await runCli(rootDir, [
      "evidence",
      "add",
      work.meta.id,
      "--summary",
      "source-map artifact attached",
      "--kind",
      "artifact",
      "--uri",
      "file://source-map.md",
      "--json"
    ]);
    const artifactEvidenceRecord = parseData<{ readonly kind: string; readonly uri: string }>(artifactEvidence.stdout);
    expect(artifactEvidence.exitCode).toBe(0);
    expect(artifactEvidenceRecord.kind).toBe("artifact");
    expect(artifactEvidenceRecord.uri).toBe("file://source-map.md");

    const documentEvidence = await runCli(rootDir, [
      "evidence",
      "add",
      work.meta.id,
      "--summary",
      "source-map document attached",
      "--kind",
      "document",
      "--json"
    ]);
    const documentEvidenceError = parseJson<{ readonly ok: false; readonly code: string; readonly message: string }>(
      documentEvidence.stderr
    );
    expect(documentEvidence.exitCode).toBe(2);
    expect(documentEvidenceError.code).toBe("BOREAL_INVALID_INPUT");
    expect(documentEvidenceError.message).toContain("--kind must be command, test, diff, review, artifact, or note");

    const otherWork = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Other evidence owner", "--json"])).stdout
    );
    const otherEvidence = parseData<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "evidence",
          "add",
          otherWork.meta.id,
          "--summary",
          "Other work passed",
          "--kind",
          "test",
          "--outcome",
          "passed",
          "--json"
        ])
      ).stdout
    );
    const mismatchedVerification = await runCli(rootDir, [
      "work",
      "verify",
      work.meta.id,
      "--evidence",
      otherEvidence.meta.id,
      "--verdict",
      "passed",
      "--json"
    ]);
    const mismatchedVerificationPayload = parseJson<{
      readonly ok: false;
      readonly code: string;
      readonly message: string;
      readonly details?: { readonly mismatchedEvidence?: readonly { readonly evidenceId: string }[] };
    }>(mismatchedVerification.stderr);
    expect(mismatchedVerification.exitCode).toBe(1);
    expect(mismatchedVerificationPayload.code).toBe("BOREAL_POLICY_VIOLATION");
    expect(mismatchedVerificationPayload.message).toContain("different subject");
    expect(mismatchedVerificationPayload.details?.mismatchedEvidence?.[0]?.evidenceId).toBe(otherEvidence.meta.id);

    const verification = await runCli(rootDir, [
      "work",
      "verify",
      work.meta.id,
      "--evidence",
      evidenceRecord.meta.id,
      "--notes",
      "Verified by CLI integration test.",
      "--json"
    ]);
    expect(parseData<{ readonly verdict: string }>(verification.stdout).verdict).toBe("passed");

    const closed = await runCli(rootDir, ["work", "close", work.meta.id, "--reason", "verified", "--commit", "abc1234", "--json"]);
    const closeout = parseData<{
      readonly work: { readonly status: string };
      readonly agentSummaries: readonly Array<{ readonly subjectId: string; readonly commitShas: readonly string[] }>;
      readonly createdAgentSummary?: { readonly subjectId: string; readonly commitShas: readonly string[] };
      readonly createdAgentSummaryArtifact?: { readonly path: string };
    }>(closed.stdout);
    expect(closeout.work.status).toBe("closed");
    expect(closeout.agentSummaries).toEqual([
      expect.objectContaining({ subjectId: work.meta.id, commitShas: ["abc1234"] })
    ]);
    expect(closeout.createdAgentSummary).toEqual(expect.objectContaining({ subjectId: work.meta.id, commitShas: ["abc1234"] }));
    expect(closeout.createdAgentSummaryArtifact?.path).toContain("agent-summaries");

    const repaired = await runCli(rootDir, ["doctor", "--fix", "--json"]);
    const repairedPayload = parseData<{ readonly ok: boolean; readonly fixed: boolean }>(repaired.stdout);
    expect(repaired.exitCode).toBe(0);
    expect(repairedPayload.ok).toBe(true);
    expect(repairedPayload.fixed).toBe(true);

    const doctor = await runCli(rootDir, ["doctor", "--json"]);
    expect(doctor.exitCode).toBe(0);
    expect(parseData<{ readonly ok: boolean }>(doctor.stdout).ok).toBe(true);
  });

  it("manages dependency graph through the dep namespace", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);
    const blocker = parseData<{ readonly meta: { readonly id: string }; readonly status: string }>(
      (await runCli(rootDir, ["work", "create", "Dependency namespace blocker", "--ready", "--json"])).stdout
    );
    const blocked = parseData<{ readonly meta: { readonly id: string }; readonly status: string }>(
      (await runCli(rootDir, ["work", "create", "Dependency namespace blocked", "--ready", "--json"])).stdout
    );

    const added = await runCli(rootDir, ["dep", "add", blocked.meta.id, blocker.meta.id, "--json"]);
    const addedPayload = parseData<{
      readonly type: string;
      readonly work: { readonly meta: { readonly id: string }; readonly status: string; readonly dependencyIds: readonly string[] };
    }>(added.stdout);
    expect(added.exitCode).toBe(0);
    expect(addedPayload).toEqual(
      expect.objectContaining({
        type: "blocks",
        work: expect.objectContaining({
          meta: expect.objectContaining({ id: blocked.meta.id }),
          status: "blocked",
          dependencyIds: [blocker.meta.id]
        })
      })
    );

    const tree = parseData<{
      readonly id: string;
      readonly title: string;
      readonly dependencies: Array<{ readonly id: string; readonly title: string; readonly dependencies: readonly unknown[] }>;
    }>((await runCli(rootDir, ["dep", "tree", blocked.meta.id, "--json"])).stdout);
    expect(tree.id).toBe(blocked.meta.id);
    expect(tree.dependencies).toEqual([
      expect.objectContaining({
        id: blocker.meta.id,
        title: "Dependency namespace blocker",
        dependencies: []
      })
    ]);

    expect(parseData<readonly unknown[]>((await runCli(rootDir, ["dep", "cycles", "--json"])).stdout)).toEqual([]);

    const blockerEvidence = parseData<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "evidence",
          "add",
          blocker.meta.id,
          "--summary",
          "Dependency blocker passed verification.",
          "--outcome",
          "passed",
          "--json"
        ])
      ).stdout
    );
    await runCli(rootDir, ["work", "verify", blocker.meta.id, "--evidence", blockerEvidence.meta.id, "--verdict", "passed", "--json"]);
    await runCli(rootDir, [
      "work",
      "close",
      blocker.meta.id,
      "--reason",
      "dependency satisfied",
      "--dirty-path",
      "no_repo_changes: dependency fixture",
      "--json"
    ]);

    const readyDependent = parseData<{
      readonly status: string;
      readonly dependencyIds: readonly string[];
      readonly activeBlockerIds: readonly string[];
      readonly blockedBy: readonly string[];
    }>((await runCli(rootDir, ["work", "show", blocked.meta.id, "--json"])).stdout);
    expect(readyDependent).toEqual(
      expect.objectContaining({
        status: "ready",
        dependencyIds: [blocker.meta.id],
        activeBlockerIds: [],
        blockedBy: []
      })
    );

    await updateState(rootDir, (state) => {
      const graphEdges = (state.graphEdges as Array<Record<string, unknown>>) ?? [];
      const firstEdge = graphEdges[0] ?? {};
      const firstMeta = firstEdge.meta as Record<string, unknown> | undefined;
      return {
        ...state,
        graphEdges: [
          ...graphEdges,
          {
            ...firstEdge,
            meta: { ...firstMeta, id: "bw_edge_deadbeefcafe" },
            fromId: blocked.meta.id,
            fromType: "work",
            toId: blocker.meta.id,
            toType: "work",
            kind: "blocks",
            directed: true
          }
        ]
      };
    });
    const cycles = parseData<Array<{ readonly cycle: readonly string[] }>>((await runCli(rootDir, ["dep", "cycles", "--json"])).stdout);
    expect(cycles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cycle: expect.arrayContaining([blocker.meta.id, blocked.meta.id])
        })
      ])
    );

    const removed = await runCli(rootDir, ["dep", "remove", blocked.meta.id, blocker.meta.id, "--json"]);
    const removedPayload = parseData<{
      readonly type: string;
      readonly work: { readonly meta: { readonly id: string }; readonly status: string; readonly dependencyIds: readonly string[] };
    }>(removed.stdout);
    expect(removed.exitCode).toBe(0);
    expect(removedPayload).toEqual(
      expect.objectContaining({
        type: "blocks",
        work: expect.objectContaining({
          meta: expect.objectContaining({ id: blocked.meta.id }),
          status: "ready",
          dependencyIds: []
        })
      })
    );

    const removedTree = parseData<{ readonly dependencies: readonly unknown[] }>(
      (await runCli(rootDir, ["dep", "tree", blocked.meta.id, "--json"])).stdout
    );
    expect(removedTree.dependencies).toEqual([]);

    const missingRemove = await runCli(rootDir, ["dep", "remove", blocked.meta.id, blocker.meta.id, "--json"]);
    const missingPayload = parseJson<{ readonly ok: false; readonly code: string }>(missingRemove.stderr);
    expect(missingRemove.exitCode).toBe(1);
    expect(missingPayload.code).toBe("BOREAL_NOT_FOUND");
  });

  it("bounds dependency tree output for shared dependency subgraphs", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);
    const target = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Shared dependency target", "--ready", "--json"])).stdout
    );
    const first = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Shared dependency first", "--ready", "--json"])).stdout
    );
    const second = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Shared dependency second", "--ready", "--json"])).stdout
    );
    const shared = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Shared dependency leaf", "--ready", "--json"])).stdout
    );

    await runCli(rootDir, ["dep", "add", target.meta.id, first.meta.id, "--json"]);
    await runCli(rootDir, ["dep", "add", target.meta.id, second.meta.id, "--json"]);
    await runCli(rootDir, ["dep", "add", first.meta.id, shared.meta.id, "--json"]);
    await runCli(rootDir, ["dep", "add", second.meta.id, shared.meta.id, "--json"]);

    interface TestDependencyTreeNode {
      readonly id: string;
      readonly shared?: boolean;
      readonly dependencies: readonly TestDependencyTreeNode[];
    }

    const tree = parseData<TestDependencyTreeNode>((await runCli(rootDir, ["dep", "tree", target.meta.id, "--json"])).stdout);
    const nodes: TestDependencyTreeNode[] = [];
    const visit = (node: TestDependencyTreeNode): void => {
      nodes.push(node);
      for (const dependency of node.dependencies) {
        visit(dependency);
      }
    };
    visit(tree);

    const sharedLeafNodes = nodes.filter((node) => node.id === shared.meta.id);
    expect(sharedLeafNodes).toHaveLength(2);
    expect(sharedLeafNodes.filter((node) => node.shared === true)).toHaveLength(1);
    expect(sharedLeafNodes.every((node) => node.dependencies.length === 0)).toBe(true);
  });

  it("normalizes cli machine strings and rejects unsafe unicode input", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);

    const created = await runCli(rootDir, [
      "work",
      "create",
      "  Ｓｈｉｐ   Runtime  ",
      "--label",
      "CLI Work",
      "--ready",
      "--json"
    ]);
    const work = parseData<{ readonly meta: { readonly id: string }; readonly title: string; readonly labels: readonly string[] }>(
      created.stdout
    );
    expect(created.exitCode).toBe(0);
    expect(work.title).toBe("Ship Runtime");
    expect(work.labels).toEqual(["cli work"]);

    const listed = await runCli(rootDir, ["work", "list", "--label", "cli work", "--json"]);
    expect(parseData<Array<{ readonly id: string }>>(listed.stdout).map((row) => row.id)).toContain(work.meta.id);

    const unsafeTitle = await runCli(rootDir, ["work", "create", "Bad\u200bTitle", "--json"]);
    const unsafeTitlePayload = parseJson<{ readonly ok: false; readonly code: string }>(unsafeTitle.stderr);
    expect(unsafeTitle.exitCode).toBe(2);
    expect(unsafeTitlePayload.code).toBe("BOREAL_UNSAFE_UNICODE");

    await runCli(rootDir, ["search", "index", "--json"]);
    const unsafeQuery = await runCli(rootDir, ["search", "query", "Ship\u200bRuntime", "--json"]);
    const unsafeQueryPayload = parseJson<{ readonly ok: false; readonly code: string }>(unsafeQuery.stderr);
    expect(unsafeQuery.exitCode).toBe(2);
    expect(unsafeQueryPayload.code).toBe("BOREAL_UNSAFE_UNICODE");
  });

  it("reports unsafe imported machine strings and normalization collisions in doctor", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);
    await runCli(rootDir, ["work", "create", "Doctor string safety", "--label", "cli", "--ready", "--json"]);

    await updateState(rootDir, (state) => ({
      ...state,
      workItems: state.workItems.map((work, index) =>
        index === 0
          ? {
              ...work,
              title: "Doctor\u200b string safety",
              labels: ["CLI", "cli"],
              meta: {
                ...work.meta,
                tags: ["CLI", "cli"],
                createdBy: { ...work.meta.createdBy, id: "Agent-A" },
                updatedBy: { ...work.meta.updatedBy, id: "agent-a" }
              }
            }
          : work
      )
    }));

    const doctor = await runCli(rootDir, ["doctor", "--json"]);
    const payload = parseData<{
      readonly ok: boolean;
      readonly diagnostics: Array<{ readonly code: string; readonly severity: string }>;
    }>(doctor.stdout);

    expect(doctor.exitCode).toBe(1);
    expect(payload.ok).toBe(false);
    expect(payload.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "string.suspicious_unicode", severity: "error" }),
        expect.objectContaining({ code: "label.normalization_collision", severity: "warning" }),
        expect.objectContaining({ code: "actor.normalization_collision", severity: "warning" })
      ])
    );
  });

  it("reports malformed operation records in doctor without masking diagnostics", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);
    await updateState(rootDir, (state) => {
      const operations = ((state.operations as Array<Record<string, unknown>> | undefined) ?? []).map((operation, index) =>
        index === 0 ? { ...operation, status: "sideways" } : operation
      );
      return { ...state, operations };
    });

    const doctor = await runCli(rootDir, ["doctor", "--json"]);
    const payload = parseData<{
      readonly ok: boolean;
      readonly diagnostics: Array<{ readonly code: string; readonly severity: string }>;
    }>(doctor.stdout);

    expect(doctor.exitCode).toBe(1);
    expect(payload.ok).toBe(false);
    expect(payload.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "state.schema_validation", severity: "error" }),
        expect.objectContaining({ code: "state.record_shape", severity: "error" }),
        expect.objectContaining({ code: "snapshot.export_drift", severity: "warning" })
      ])
    );
  });

  it("reports operation event causality mismatches in doctor", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);
    await runCli(rootDir, ["work", "create", "Causality mismatch", "--ready", "--json"]);
    await updateState(rootDir, (state) => {
      const events = ((state.events as Array<Record<string, unknown>> | undefined) ?? []).map((event) =>
        event.type === "work.created" ? { ...event, operationId: "bw_operation_deadbeefdead" } : event
      );
      return { ...state, events };
    });

    const doctor = await runCli(rootDir, ["doctor", "--json"]);
    const payload = parseData<{
      readonly ok: boolean;
      readonly diagnostics: Array<{ readonly code: string; readonly severity: string }>;
    }>(doctor.stdout);

    expect(doctor.exitCode).toBe(1);
    expect(payload.ok).toBe(false);
    expect(payload.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "operation.event_causality", severity: "error" })])
    );

    const repaired = await runCli(rootDir, ["operation", "repair", "--json"]);
    const repairPayload = parseData<{
      readonly removedConflictingEventRefs: readonly unknown[];
      readonly markedLegacyEvents: readonly string[];
    }>(repaired.stdout);
    const repairedDoctor = await runCli(rootDir, ["doctor", "--json"]);
    const repairedDoctorPayload = parseData<{
      readonly ok: boolean;
      readonly diagnostics: Array<{ readonly code: string; readonly severity: string }>;
    }>(repairedDoctor.stdout);

    expect(repaired.exitCode).toBe(0);
    expect(repairPayload.removedConflictingEventRefs.length).toBeGreaterThan(0);
    expect(repairPayload.markedLegacyEvents.length).toBeGreaterThan(0);
    expect(repairedDoctor.exitCode).toBe(0);
    expect(repairedDoctorPayload.ok).toBe(true);
  });

  it("spools oversized json command output to a result file", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);
    const longTitle = "x".repeat(500);

    for (let index = 0; index < 80; index += 1) {
      const created = await runCli(rootDir, [
        "work",
        "create",
        `Spool output ${index} ${longTitle}`,
        "--label",
        "spool",
        "--ready",
        "--json"
      ]);
      expect(created.exitCode).toBe(0);
    }

    const listed = await runCli(rootDir, ["work", "list", "--label", "spool", "--json"]);
    const payload = parseData<{
      readonly truncated: boolean;
      readonly command: string;
      readonly fullResultPath: string;
      readonly fullResultBytes: number;
      readonly preview: { readonly kind: string; readonly length: number };
    }>(listed.stdout);

    expect(listed.exitCode).toBe(0);
    expect(payload.truncated).toBe(true);
    expect(payload.command).toBe("work list");
    expect(Object.keys(payload)).toEqual([
      "truncated",
      "command",
      "maxResultSizeChars",
      "fullResultPath",
      "fullResultBytes",
      "preview"
    ]);
    expect(payload.maxResultSizeChars).toBe(25_000);
    expect(payload.fullResultPath).toMatch(/^\.boreal\/results\/result-/);
    expect(payload.fullResultPath).toMatch(/\.json$/u);
    expect(payload.fullResultPath).not.toContain(rootDir);
    expect(payload.fullResultBytes).toBeGreaterThan(25_000);
    expect(payload.preview).toEqual(expect.objectContaining({ kind: "array", length: 80 }));

    const fullResultFile = join(rootDir, payload.fullResultPath);
    const fullResultStats = await stat(fullResultFile);
    const fullResult = parseJson<{ readonly ok: true; readonly data: Array<{ readonly title: string }> }>(
      await readFile(fullResultFile, "utf8")
    );
    expect(fullResult.ok).toBe(true);
    expect(fullResult.data).toHaveLength(80);
    expect(fullResult.data[0]?.title).toContain("Spool output");
    expect(fullResultStats.size).toBe(payload.fullResultBytes);
  });

  it("runs the knowledge context lifecycle through file-backed commands", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);

    const sourceResult = await runCli(rootDir, [
      "source",
      "add",
      "--title",
      "Context design note",
      "--uri",
      "file://context-design.md",
      "--kind",
      "document",
      "--summary",
      "Knowledge context must be visible to agents.",
      "--json"
    ]);
    const source = parseData<{ readonly meta: { readonly id: string }; readonly title: string }>(sourceResult.stdout);
    expect(sourceResult.exitCode).toBe(0);

    const sourceShow = await runCli(rootDir, ["source", "show", source.meta.id, "--json"]);
    expect(parseData<{ readonly title: string }>(sourceShow.stdout).title).toBe("Context design note");

    const sourceList = await runCli(rootDir, ["source", "list", "--kind", "document", "--json"]);
    expect(parseData<Array<{ readonly id: string }>>(sourceList.stdout).map((row) => row.id)).toContain(source.meta.id);

    const claimResult = await runCli(rootDir, [
      "claim",
      "create",
      "--statement",
      "Context packs include accepted claims.",
      "--status",
      "accepted",
      "--source",
      source.meta.id,
      "--json"
    ]);
    const claim = parseData<{ readonly meta: { readonly id: string }; readonly status: string }>(claimResult.stdout);
    expect(claim.status).toBe("accepted");

    const claimShow = await runCli(rootDir, ["claim", "show", claim.meta.id, "--json"]);
    expect(parseData<{ readonly statement: string }>(claimShow.stdout).statement).toContain("accepted claims");

    const claimList = await runCli(rootDir, ["claim", "list", "--status", "accepted", "--source", source.meta.id, "--json"]);
    expect(parseData<Array<{ readonly id: string }>>(claimList.stdout).map((row) => row.id)).toContain(claim.meta.id);

    const decisionResult = await runCli(rootDir, [
      "decision",
      "create",
      "--title",
      "Expose context packs",
      "--context",
      "Agents need compact project memory.",
      "--decision",
      "Expose context packs through the runtime and CLI.",
      "--status",
      "accepted",
      "--consequence",
      "CLI users can inspect rebuilt context packs.",
      "--source",
      source.meta.id,
      "--json"
    ]);
    const decision = parseData<{ readonly meta: { readonly id: string }; readonly status: string }>(decisionResult.stdout);
    expect(decision.status).toBe("accepted");

    const decisionShow = await runCli(rootDir, ["decision", "show", decision.meta.id, "--json"]);
    expect(parseData<{ readonly decision: string }>(decisionShow.stdout).decision).toContain("runtime and CLI");

    const decisionList = await runCli(rootDir, ["decision", "list", "--status", "accepted", "--source", source.meta.id, "--json"]);
    expect(parseData<Array<{ readonly id: string }>>(decisionList.stdout).map((row) => row.id)).toContain(
      decision.meta.id
    );

    const workResult = await runCli(rootDir, ["work", "create", "Build context commands", "--ready", "--json"]);
    const work = parseData<{ readonly meta: { readonly id: string } }>(workResult.stdout);

    const evidenceResult = await runCli(rootDir, [
      "evidence",
      "add",
      work.meta.id,
      "--summary",
      "context command test passed",
      "--kind",
      "test",
      "--outcome",
      "passed",
      "--json"
    ]);
    expect(evidenceResult.exitCode).toBe(0);

    const rebuild = await runCli(rootDir, ["context", "rebuild", "--json"]);
    expect(parseData<{ readonly rebuilt: number }>(rebuild.stdout).rebuilt).toBe(1);

    const contextPack = await runCli(rootDir, ["context", "show", work.meta.id, "--json"]);
    const pack = parseData<{ readonly facts: readonly string[]; readonly evidence: readonly string[] }>(contextPack.stdout);
    expect(pack.facts).toContain("claim: Context packs include accepted claims.");
    expect(pack.facts).toContain("decision: Expose context packs through the runtime and CLI.");
    expect(pack.evidence).toContain("passed: context command test passed");
  });

  it("builds a fresh search index, searches context, and rejects stale reads", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);

    const work = parseData<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "work",
          "create",
          "Ship search runtime",
          "--description",
          "Search must rank context facts.",
          "--priority",
          "high",
          "--label",
          "cli",
          "--ready",
          "--json"
        ])
      ).stdout
    );
    await runCli(rootDir, ["work", "create", "Write search docs", "--label", "docs", "--ready", "--json"]);

    const next = await runCli(rootDir, ["work", "next", "--label", "cli", "--json"]);
    expect(parseData<Array<{ readonly id: string }>>(next.stdout).map((row) => row.id)).toEqual([work.meta.id]);

    const source = parseData<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "source",
          "add",
          "--title",
          "Search hardening note",
          "--uri",
          "file://search-hardening.md",
          "--summary",
          "Search index freshness is part of runtime policy.",
          "--json"
        ])
      ).stdout
    );
    await runCli(rootDir, [
      "claim",
      "create",
      "--statement",
      "Search index must fail closed when stale.",
      "--status",
      "accepted",
      "--source",
      source.meta.id,
      "--json"
    ]);
    await runCli(rootDir, [
      "decision",
      "create",
      "--title",
      "Use content hash search",
      "--context",
      "Agents need reliable retrieval.",
      "--decision",
      "Search query uses a fresh content hash.",
      "--status",
      "accepted",
      "--source",
      source.meta.id,
      "--json"
    ]);
    await runCli(rootDir, [
      "evidence",
      "add",
      work.meta.id,
      "--summary",
      "search integration test passed",
      "--kind",
      "test",
      "--outcome",
      "passed",
      "--json"
    ]);
    await runCli(rootDir, ["context", "rebuild", "--json"]);

    const missing = await runCli(rootDir, ["search", "query", "content hash", "--json"]);
    const missingPayload = parseJson<{ readonly ok: false; readonly code: string }>(missing.stderr);
    expect(missing.exitCode).toBe(1);
    expect(missingPayload.code).toBe("BOREAL_POLICY_VIOLATION");

    const indexed = await runCli(rootDir, ["search", "index", "--json"]);
    expect(parseData<{ readonly documentCount: number; readonly tokenCount: number }>(indexed.stdout).documentCount).toBeGreaterThan(8);

    const concurrentIndexes = await Promise.all([
      runCli(rootDir, ["search", "index", "--json"]),
      runCli(rootDir, ["search", "index", "--json"]),
      runCli(rootDir, ["search", "index", "--json"])
    ]);
    expect(concurrentIndexes.map((result) => result.exitCode)).toEqual([0, 0, 0]);
    for (const result of concurrentIndexes) {
      expect(parseData<{ readonly documentCount: number }>(result.stdout).documentCount).toBeGreaterThan(8);
    }

    const searchIndexDocument = parseJson<{
      readonly schemaVersion: string;
      readonly algorithm: string;
      readonly documentCount: number;
      readonly documentFrequencies: readonly (readonly [string, number])[];
      readonly documents: Array<{
        readonly type: string;
        readonly title: string;
        readonly vectorWeights?: readonly unknown[];
        readonly fieldWeights?: Array<{ readonly field: string; readonly tokenWeights: readonly unknown[] }>;
      }>;
    }>(await readFile(join(rootDir, ".boreal/runtime/search-index.json"), "utf8"));
    expect(searchIndexDocument.schemaVersion).toBe("boreal.search-index.v1");
    expect(searchIndexDocument.algorithm).toBe("boreal.search.hybrid.v1");
    expect(searchIndexDocument.documentCount).toBeGreaterThan(8);
    expect(new Map(searchIndexDocument.documentFrequencies).get("search")).toBeGreaterThan(1);
    expect(new Map(searchIndexDocument.documentFrequencies).get("content")).toBeGreaterThan(1);
    const indexedDecision = searchIndexDocument.documents.find(
      (document) => document.type === "decision" && document.title === "Use content hash search"
    );
    expect(indexedDecision?.vectorWeights?.length).toBeGreaterThan(0);
    expect(indexedDecision?.fieldWeights?.map((field) => field.field)).toEqual(
      expect.arrayContaining(["id", "title", "decision", "context"])
    );

    const query = await runCli(rootDir, ["search", "query", "content hash", "--json"]);
    const searchResults = parseData<Array<{ readonly type: string; readonly title: string; readonly explain?: unknown }>>(query.stdout);
    expect(searchResults.map((result) => result.type)).toEqual(expect.arrayContaining(["decision", "context_pack"]));
    expect(searchResults.map((result) => result.title)).toContain("Use content hash search");
    expect(searchResults.every((result) => result.explain === undefined)).toBe(true);

    const explainedQuery = await runCli(rootDir, ["search", "query", "content hash", "--explain", "--json"]);
    const explainedSearchResults = parseData<
      Array<{
        readonly type: string;
        readonly title: string;
        readonly explain?: {
          readonly algorithm: string;
          readonly queryTokens: readonly string[];
          readonly fieldMatches: Array<{
            readonly field: string;
            readonly token: string;
            readonly matchedToken: string;
            readonly match: string;
            readonly weight: number;
            readonly idf: number;
            readonly contribution: number;
          }>;
          readonly scoreBreakdown: Array<{
            readonly kind: string;
            readonly baseWeight?: number;
            readonly documentFrequency?: number;
            readonly idf?: number;
            readonly contribution: number;
          }>;
        };
      }>
    >(explainedQuery.stdout);
    const explainedDecision = explainedSearchResults.find((result) => result.title === "Use content hash search");
    expect(explainedDecision?.explain?.algorithm).toBe("boreal.search.hybrid.v1");
    expect(explainedDecision?.explain?.queryTokens).toEqual(["content", "hash"]);
    expect(explainedDecision?.explain?.fieldMatches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "title", token: "content", matchedToken: "content", match: "exact" }),
        expect.objectContaining({ field: "decision", token: "hash", matchedToken: "hash", match: "exact" })
      ])
    );
    expect(explainedDecision?.explain?.scoreBreakdown).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "token_exact",
          baseWeight: expect.any(Number),
          documentFrequency: expect.any(Number),
          idf: expect.any(Number)
        }),
        expect.objectContaining({
          kind: "vector_similarity",
          similarity: expect.any(Number),
          matchedDimensions: expect.any(Number)
        })
      ])
    );
    expect(explainedDecision?.explain?.fieldMatches.every((match) => match.idf > 0)).toBe(true);

    const contextSearch = await runCli(rootDir, ["context", "search", "fail closed stale", "--explain", "--json"]);
    const contextResults = parseData<
      Array<{
        readonly type: string;
        readonly summary: string;
        readonly explain?: { readonly fieldMatches: Array<{ readonly field: string }> };
      }>
    >(contextSearch.stdout);
    expect(contextResults.every((result) => result.type === "context_pack" || result.type === "context_chunk")).toBe(true);
    expect(contextResults.map((result) => result.type)).toContain("context_chunk");
    expect(contextResults.some((result) => result.summary.includes("Ship search runtime"))).toBe(true);
    expect(contextResults.flatMap((result) => result.explain?.fieldMatches.map((match) => match.field) ?? [])).toEqual(
      expect.arrayContaining(["facts"])
    );

    await runCli(rootDir, [
      "source",
      "add",
      "--title",
      "Stale search note",
      "--uri",
      "file://stale-search.md",
      "--json"
    ]);
    const stale = await runCli(rootDir, ["search", "query", "content hash", "--json"]);
    const stalePayload = parseJson<{ readonly ok: false; readonly code: string; readonly message: string }>(stale.stderr);
    expect(stale.exitCode).toBe(1);
    expect(stalePayload.code).toBe("BOREAL_POLICY_VIOLATION");
    expect(stalePayload.message).toContain("stale");

    const repaired = await runCli(rootDir, ["doctor", "--fix", "--json"]);
    const repairedPayload = parseData<{
      readonly ok: boolean;
      readonly fixed: boolean;
      readonly diagnostics: Array<{ readonly code: string; readonly severity: string }>;
    }>(repaired.stdout);
    expect(repaired.exitCode).toBe(0);
    expect(repairedPayload.ok).toBe(true);
    expect(repairedPayload.fixed).toBe(true);
    expect(repairedPayload.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "search.index", severity: "fixed" })])
    );

    const repairedSearch = await runCli(rootDir, ["search", "query", "Stale search note", "--json"]);
    expect(parseData<Array<{ readonly type: string; readonly title: string }>>(repairedSearch.stdout)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "source", title: "Stale search note" })])
    );
  });

  it("claims next work and returns a refreshed handoff bundle", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);

    const work = parseData<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "work",
          "create",
          "Claim handoff runtime",
          "--description",
          "Return context and retrieval hits after reservation.",
          "--priority",
          "critical",
          "--label",
          "cli",
          "--ready",
          "--json"
        ])
      ).stdout
    );
    await runCli(rootDir, ["work", "create", "Unrelated docs work", "--label", "docs", "--ready", "--json"]);

    const source = parseData<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "source",
          "add",
          "--title",
          "Claim handoff note",
          "--uri",
          "file://claim-handoff.md",
          "--summary",
          "Claim commands must return enough context to start safely.",
          "--json"
        ])
      ).stdout
    );
    await runCli(rootDir, [
      "claim",
      "create",
      "--statement",
      "Claim handoff includes refreshed context.",
      "--status",
      "accepted",
      "--source",
      source.meta.id,
      "--json"
    ]);
    await runCli(rootDir, [
      "decision",
      "create",
      "--title",
      "Return claim handoff bundle",
      "--context",
      "Agents need a single starting payload.",
      "--decision",
      "Return claimed work, reservation, context, and focused search results.",
      "--status",
      "accepted",
      "--source",
      source.meta.id,
      "--json"
    ]);

    const claimed = await runCli(rootDir, [
      "work",
      "claim",
      "--label",
      "cli",
      "--agent",
      "agent-a",
      "--purpose",
      "start implementation",
      "--json"
    ]);
    const payload = parseData<{
      readonly claimed: boolean;
      readonly handoffComplete: boolean;
      readonly work: { readonly id: string; readonly status: string; readonly activeReservationId?: string };
      readonly reservation: { readonly meta: { readonly id: string }; readonly status: string; readonly purpose?: string };
      readonly contextPack: { readonly subjectId: string; readonly facts: readonly string[] };
      readonly search: { readonly query: string; readonly results: Array<{ readonly type: string; readonly title: string }> };
    }>(claimed.stdout);

    expect(claimed.exitCode).toBe(0);
    expect(payload.claimed).toBe(true);
    expect(payload.handoffComplete).toBe(true);
    expect(payload.work.id).toBe(work.meta.id);
    expect(payload.work.status).toBe("in_progress");
    expect(payload.work.activeReservationId).toBe(payload.reservation.meta.id);
    expect(payload.reservation.status).toBe("active");
    expect(payload.reservation.purpose).toBe("start implementation");
    expect(payload.contextPack.subjectId).toBe(work.meta.id);
    expect(payload.contextPack.facts).toContain("claim: Claim handoff includes refreshed context.");
    expect(payload.contextPack.facts).toContain(
      "decision: Return claimed work, reservation, context, and focused search results."
    );
    expect(payload.search.query).toContain("Claim handoff runtime");
    expect(payload.search.results.map((result) => result.type)).toEqual(
      expect.arrayContaining(["work", "context_pack", "decision"])
    );

    const searchAfterClaim = await runCli(rootDir, ["search", "query", "focused search results", "--json"]);
    expect(parseData<Array<{ readonly type: string; readonly title: string }>>(searchAfterClaim.stdout)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "decision", title: "Return claim handoff bundle" })])
    );

    const missing = await runCli(rootDir, ["work", "claim", "--label", "missing", "--json"]);
    expect(parseData<{ readonly claimed: boolean; readonly reason: string }>(missing.stdout)).toEqual({
      claimed: false,
      reason: "no_ready_work",
      agentId: expect.any(String),
      labels: ["missing"]
    });
  });

  it("keeps claimed work reservations when work claim handoff generation fails", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);

    const work = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Degraded work claim", "--label", "claim-degraded", "--ready", "--json"]))
        .stdout
    );
    await mkdir(join(rootDir, ".boreal/runtime/search-index.json"), { recursive: true });

    const claimed = await runCli(rootDir, [
      "work",
      "claim",
      "--agent",
      "agent-claim-degraded",
      "--label",
      "claim-degraded",
      "--json"
    ]);
    const payload = parseData<{
      readonly claimed: boolean;
      readonly handoffComplete: boolean;
      readonly work?: { readonly id: string; readonly status: string; readonly activeReservationId?: string };
      readonly reservation?: { readonly meta: { readonly id: string }; readonly status: string };
      readonly warnings: Array<{ readonly code: string }>;
      readonly repairCommand?: string;
    }>(claimed.stdout);

    expect(claimed.exitCode).toBe(0);
    expect(payload.claimed).toBe(true);
    expect(payload.handoffComplete).toBe(false);
    expect(payload.work?.id).toBe(work.meta.id);
    expect(payload.work?.status).toBe("in_progress");
    expect(payload.work?.activeReservationId).toBe(payload.reservation?.meta.id);
    expect(payload.reservation?.status).toBe("active");
    expect(payload.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "handoff.failed" })]));
    expect(payload.repairCommand).toBe("bwrk doctor --fix --json");
  });

  it("starts agents by claiming or resuming with a handoff bundle", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);

    const work = parseData<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "work",
          "create",
          "Agent start CLI work",
          "--description",
          "Agents should receive context before changing files.",
          "--priority",
          "high",
          "--label",
          "cli",
          "--ready",
          "--json"
        ])
      ).stdout
    );
    const source = parseData<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "source",
          "add",
          "--title",
          "Agent start note",
          "--uri",
          "file://agent-start.md",
          "--summary",
          "Agent start should claim or resume with a handoff bundle.",
          "--json"
        ])
      ).stdout
    );
    await runCli(rootDir, [
      "claim",
      "create",
      "--statement",
      "Agent start includes context.",
      "--status",
      "accepted",
      "--source",
      source.meta.id,
      "--json"
    ]);

    const started = await runCli(rootDir, [
      "agent",
      "start",
      "--agent",
      "agent-a",
      "--label",
      "cli",
      "--purpose",
      "begin safe work",
      "--json"
    ]);
    const startedPayload = parseData<{
      readonly started: boolean;
      readonly action?: string;
      readonly handoffComplete: boolean;
      readonly work?: { readonly id: string; readonly status: string; readonly activeReservationId?: string };
      readonly reservation?: { readonly meta: { readonly id: string }; readonly status: string; readonly purpose?: string };
      readonly contextPack?: { readonly subjectId: string; readonly facts: readonly string[] };
      readonly search?: { readonly query: string; readonly results: Array<{ readonly type: string }> };
      readonly status: {
        readonly reservations: { readonly activeCount: number; readonly capacityRemaining: number };
        readonly readyWork: { readonly claimableCount: number };
        readonly recommendedAction: { readonly kind: string };
      };
    }>(started.stdout);

    expect(started.exitCode).toBe(0);
    expect(startedPayload.started).toBe(true);
    expect(startedPayload.action).toBe("claimed_work");
    expect(startedPayload.handoffComplete).toBe(true);
    expect(startedPayload.work?.id).toBe(work.meta.id);
    expect(startedPayload.work?.status).toBe("in_progress");
    expect(startedPayload.work?.activeReservationId).toBe(startedPayload.reservation?.meta.id);
    expect(startedPayload.reservation?.status).toBe("active");
    expect(startedPayload.reservation?.purpose).toBe("begin safe work");
    expect(startedPayload.contextPack?.subjectId).toBe(work.meta.id);
    expect(startedPayload.contextPack?.facts).toContain("claim: Agent start includes context.");
    expect(startedPayload.search?.query).toContain("Agent start CLI work");
    expect(startedPayload.search?.results.map((result) => result.type)).toContain("context_pack");
    expect(startedPayload.status.reservations.activeCount).toBe(1);
    expect(startedPayload.status.reservations.capacityRemaining).toBe(2);
    expect(startedPayload.status.readyWork.claimableCount).toBe(0);
    expect(startedPayload.status.recommendedAction.kind).toBe("continue_reserved_work");

    const resumed = await runCli(rootDir, ["agent", "start", "--agent", "agent-a", "--label", "cli", "--json"]);
    const resumedPayload = parseData<{
      readonly started: boolean;
      readonly action?: string;
      readonly handoffComplete: boolean;
      readonly work?: { readonly id: string; readonly activeReservationId?: string };
      readonly reservation?: { readonly meta: { readonly id: string } };
      readonly status: { readonly reservations: { readonly activeCount: number } };
    }>(resumed.stdout);
    expect(resumed.exitCode).toBe(0);
    expect(resumedPayload.started).toBe(true);
    expect(resumedPayload.action).toBe("continue_reserved_work");
    expect(resumedPayload.handoffComplete).toBe(true);
    expect(resumedPayload.work?.id).toBe(work.meta.id);
    expect(resumedPayload.reservation?.meta.id).toBe(startedPayload.reservation?.meta.id);
    expect(resumedPayload.status.reservations.activeCount).toBe(1);

    const activeList = await runCli(rootDir, ["reservation", "list", "--agent", "agent-a", "--status", "active", "--json"]);
    expect(parseData<Array<{ readonly id: string }>>(activeList.stdout).map((row) => row.id)).toEqual([
      startedPayload.reservation?.meta.id
    ]);

    const missing = await runCli(rootDir, ["agent", "start", "--agent", "agent-b", "--label", "missing", "--json"]);
    const missingPayload = parseData<{
      readonly started: boolean;
      readonly reason: string;
      readonly recommendedAction: { readonly kind: string };
      readonly status: { readonly readyWork: { readonly claimableCount: number } };
    }>(missing.stdout);
    expect(missing.exitCode).toBe(0);
    expect(missingPayload.started).toBe(false);
    expect(missingPayload.reason).toBe("no_ready_work");
    expect(missingPayload.status.readyWork.claimableCount).toBe(0);
    expect(missingPayload.recommendedAction.kind).toBe("wait_for_ready_work");
  });

  it("keeps claimed reservations when agent start handoff generation fails", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);

    const work = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Degraded handoff work", "--label", "degraded", "--ready", "--json"])).stdout
    );
    await mkdir(join(rootDir, ".boreal/runtime/search-index.json"), { recursive: true });

    const started = await runCli(rootDir, ["agent", "start", "--agent", "agent-degraded", "--label", "degraded", "--json"]);
    const payload = parseData<{
      readonly started: boolean;
      readonly action?: string;
      readonly handoffComplete: boolean;
      readonly work?: { readonly id: string; readonly status: string; readonly activeReservationId?: string };
      readonly reservation?: { readonly meta: { readonly id: string }; readonly status: string };
      readonly warnings: Array<{ readonly code: string; readonly message: string }>;
      readonly repairCommand?: string;
      readonly status: { readonly reservations: { readonly activeCount: number } };
    }>(started.stdout);

    expect(started.exitCode).toBe(0);
    expect(payload.started).toBe(true);
    expect(payload.action).toBe("claimed_work");
    expect(payload.handoffComplete).toBe(false);
    expect(payload.work?.id).toBe(work.meta.id);
    expect(payload.work?.status).toBe("in_progress");
    expect(payload.work?.activeReservationId).toBe(payload.reservation?.meta.id);
    expect(payload.reservation?.status).toBe("active");
    expect(payload.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "handoff.failed" })])
    );
    expect(payload.repairCommand).toBe("bwrk doctor --fix --json");
    expect(payload.status.reservations.activeCount).toBe(1);

    const shown = await runCli(rootDir, ["work", "show", work.meta.id, "--json"]);
    expect(parseData<{ readonly status: string; readonly activeReservationId?: string }>(shown.stdout)).toEqual(
      expect.objectContaining({ status: "in_progress", activeReservationId: payload.reservation?.meta.id })
    );
  });

  it("finishes reserved agent work with guarded evidence, verification, and cleanup", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);

    const closeWork = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Finish and close", "--label", "finish", "--ready", "--json"])).stdout
    );
    await runCli(rootDir, ["agent", "start", "--agent", "agent-a", "--label", "finish", "--json"]);

    const missingMode = await runCli(rootDir, [
      "agent",
      "finish",
      closeWork.meta.id,
      "--agent",
      "agent-a",
      "--summary",
      "missing exit mode",
      "--json"
    ]);
    const missingModePayload = parseJson<{ readonly ok: false; readonly code: string; readonly message: string }>(
      missingMode.stderr
    );
    expect(missingMode.exitCode).toBe(2);
    expect(missingModePayload.code).toBe("BOREAL_INVALID_INPUT");
    expect(missingModePayload.message).toContain("requires --close or --release");

    const wrongAgent = await runCli(rootDir, [
      "agent",
      "finish",
      closeWork.meta.id,
      "--agent",
      "agent-b",
      "--summary",
      "wrong agent attempt",
      "--release",
      "--json"
    ]);
    const wrongAgentPayload = parseJson<{ readonly ok: false; readonly code: string; readonly message: string }>(
      wrongAgent.stderr
    );
    expect(wrongAgent.exitCode).toBe(1);
    expect(wrongAgentPayload.ok).toBe(false);
    expect(wrongAgentPayload.code).toBe("BOREAL_POLICY_VIOLATION");
    expect(wrongAgentPayload.message).toContain("does not own");

    const directReservedClose = await runCli(rootDir, [
      "work",
      "close",
      closeWork.meta.id,
	      "--reason",
	      "direct close should not bypass reservation",
	      "--dirty-path",
	      "no_repo_changes: reserved close guard fixture",
	      "--json"
	    ]);
    const directReservedClosePayload = parseJson<{ readonly ok: false; readonly code: string; readonly message: string }>(
      directReservedClose.stderr
    );
    expect(directReservedClose.exitCode).toBe(1);
    expect(directReservedClosePayload.code).toBe("BOREAL_POLICY_VIOLATION");
    expect(directReservedClosePayload.message).toContain("Reserved work");

    const finishedClosed = await runCli(rootDir, [
      "agent",
      "finish",
      "current",
      "--agent",
      "agent-a",
      "--summary",
      "Implemented and tested finish close.",
      "--command",
      "pnpm test",
	      "--close",
	      "--reason",
	      "verified by finish evidence",
	      "--dirty-path",
	      "no_repo_changes: agent finish fixture",
	      "--json"
	    ]);
    const closedPayload = parseData<{
      readonly finished: boolean;
      readonly action: string;
      readonly work: {
        readonly id: string;
        readonly status: string;
        readonly evidenceCount: number;
        readonly verificationCount: number;
        readonly activeReservationId?: string;
        readonly contextSummary?: string;
      };
      readonly evidence: { readonly outcome: string; readonly command?: string };
      readonly verification: { readonly verdict: string };
      readonly reservation: { readonly status: string };
      readonly closedWork?: { readonly status: string; readonly closedReason?: string };
      readonly release?: { readonly reservation: { readonly status: string } };
      readonly status: { readonly reservations: { readonly activeCount: number } };
    }>(finishedClosed.stdout);

    expect(finishedClosed.exitCode).toBe(0);
    expect(closedPayload.finished).toBe(true);
    expect(closedPayload.action).toBe("verified_and_closed");
    expect(closedPayload.work.id).toBe(closeWork.meta.id);
    expect(closedPayload.work.status).toBe("closed");
    expect(closedPayload.work.activeReservationId).toBeUndefined();
    expect(closedPayload.work.evidenceCount).toBe(1);
    expect(closedPayload.work.verificationCount).toBe(1);
    expect(closedPayload.work.contextSummary).toContain("is closed.");
    expect(closedPayload.work.contextSummary).not.toContain("is in_progress.");
    expect(closedPayload.evidence).toEqual(expect.objectContaining({ outcome: "passed", command: "pnpm test" }));
    expect(closedPayload.verification.verdict).toBe("passed");
    expect(closedPayload.reservation.status).toBe("released");
    expect(closedPayload.closedWork).toEqual(
      expect.objectContaining({ status: "closed", closedReason: "verified by finish evidence" })
    );
    expect(closedPayload.release?.reservation.status).toBe("released");
    expect(closedPayload.status.reservations.activeCount).toBe(0);

    const releaseWork = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Finish and release", "--label", "release", "--ready", "--json"])).stdout
    );
    await runCli(rootDir, ["agent", "start", "--agent", "agent-c", "--label", "release", "--json"]);
    const finishedReleased = await runCli(rootDir, [
      "agent",
      "finish",
      releaseWork.meta.id,
      "--agent",
      "agent-c",
      "--summary",
      "Blocked by a failing check.",
      "--verdict",
      "failed",
      "--release",
      "--json"
    ]);
    const releasedPayload = parseData<{
      readonly action: string;
      readonly work: { readonly status: string; readonly activeReservationId?: string };
      readonly evidence: { readonly outcome: string };
      readonly verification: { readonly verdict: string };
      readonly release?: { readonly reservation: { readonly status: string } };
      readonly status: { readonly reservations: { readonly activeCount: number } };
    }>(finishedReleased.stdout);

    expect(finishedReleased.exitCode).toBe(0);
    expect(releasedPayload.action).toBe("verified_and_released");
    expect(releasedPayload.work.status).toBe("needs_verification");
    expect(releasedPayload.work.activeReservationId).toBeUndefined();
    expect(releasedPayload.evidence.outcome).toBe("failed");
    expect(releasedPayload.verification.verdict).toBe("failed");
    expect(releasedPayload.release?.reservation.status).toBe("released");
    expect(releasedPayload.status.reservations.activeCount).toBe(0);

    const invalidMode = await runCli(rootDir, [
      "agent",
      "finish",
      releaseWork.meta.id,
      "--agent",
      "agent-c",
      "--summary",
      "invalid mode",
      "--close",
      "--release",
      "--json"
    ]);
    const invalidPayload = parseJson<{ readonly ok: false; readonly code: string; readonly message: string }>(invalidMode.stderr);
    expect(invalidMode.exitCode).toBe(2);
    expect(invalidPayload.code).toBe("BOREAL_INVALID_INPUT");
    expect(invalidPayload.message).toContain("cannot be used together");
  });

  it("renews, releases, and repairs expired reservations through the CLI", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);

    const claimLabel = "coord $label's";
    const shellSensitiveAgent = "agent $one's";
    const work = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Reservation CLI lifecycle", "--label", claimLabel, "--ready", "--json"])).stdout
    );
    const readyStatus = await runCli(rootDir, ["agent", "status", "--agent", shellSensitiveAgent, "--label", claimLabel, "--json"]);
    const readyStatusPayload = parseData<{
      readonly reservations: { readonly activeCount: number; readonly capacityRemaining: number };
      readonly readyWork: { readonly claimableCount: number; readonly next?: { readonly id: string } };
      readonly recommendedAction: { readonly kind: string; readonly command?: string };
    }>(readyStatus.stdout);
    expect(readyStatusPayload.reservations.activeCount).toBe(0);
    expect(readyStatusPayload.reservations.capacityRemaining).toBe(3);
    expect(readyStatusPayload.readyWork.claimableCount).toBe(1);
    expect(readyStatusPayload.readyWork.next?.id).toBe(work.meta.id);
    expect(readyStatusPayload.recommendedAction.kind).toBe("claim_work");
    expect(readyStatusPayload.recommendedAction.command).toBe(
      "bwrk work claim --agent 'agent $one'\\''s' --label 'coord $label'\\''s'"
    );

    const reserved = await runCli(rootDir, ["work", "reserve", work.meta.id, "--agent", "agent-a", "--ttl", "1h", "--json"]);
    const reservedWork = parseData<{ readonly status: string; readonly reservationId: string }>(reserved.stdout);
    expect(reservedWork.status).toBe("in_progress");
    expect(reservedWork.reservationId).toMatch(/^bw_reservation_/);

    const activeList = await runCli(rootDir, ["reservation", "list", "--agent", "agent-a", "--work", work.meta.id, "--json"]);
    const activeRows = parseData<
      Array<{
        readonly id: string;
        readonly status: string;
        readonly expired: boolean;
        readonly agentId: string;
        readonly workId: string;
        readonly workTitle?: string;
      }>
    >(activeList.stdout);
    expect(activeRows).toHaveLength(1);
    expect(activeRows[0]).toEqual(
      expect.objectContaining({
        id: reservedWork.reservationId,
        status: "active",
        expired: false,
        agentId: "agent-a",
        workId: work.meta.id,
        workTitle: "Reservation CLI lifecycle"
      })
    );
    const activeStatus = await runCli(rootDir, ["agent", "status", "--agent", "agent-a", "--json"]);
    const activeStatusPayload = parseData<{
      readonly reservations: { readonly activeCount: number; readonly expiredActiveCount: number; readonly capacityRemaining: number };
      readonly readyWork: { readonly claimableCount: number };
      readonly recommendedAction: { readonly kind: string; readonly command?: string };
    }>(activeStatus.stdout);
    expect(activeStatusPayload.reservations.activeCount).toBe(1);
    expect(activeStatusPayload.reservations.expiredActiveCount).toBe(0);
    expect(activeStatusPayload.reservations.capacityRemaining).toBe(2);
    expect(activeStatusPayload.readyWork.claimableCount).toBe(0);
    expect(activeStatusPayload.recommendedAction.kind).toBe("continue_reserved_work");
    expect(activeStatusPayload.recommendedAction.command).toContain(`bwrk work show ${work.meta.id}`);

    const renewed = await runCli(rootDir, ["work", "renew", work.meta.id, "--ttl", "2h", "--json"]);
    const renewedPayload = parseData<{
      readonly work: { readonly meta: { readonly id: string }; readonly status: string };
      readonly reservation: { readonly meta: { readonly id: string }; readonly status: string; readonly expiresAt: string };
    }>(renewed.stdout);
    expect(renewedPayload.work.meta.id).toBe(work.meta.id);
    expect(renewedPayload.reservation.status).toBe("active");
    expect(renewedPayload.reservation.expiresAt).toMatch(/T/);

    const released = await runCli(rootDir, ["work", "release", work.meta.id, "--json"]);
    const releasedPayload = parseData<{
      readonly work: { readonly status: string; readonly reservationId?: string };
      readonly reservation: { readonly status: string };
    }>(released.stdout);
    expect(releasedPayload.reservation.status).toBe("released");
    expect(releasedPayload.work.status).toBe("ready");
    expect(releasedPayload.work.reservationId).toBeUndefined();

    const releasedList = await runCli(rootDir, ["reservation", "list", "--status", "released", "--work", work.meta.id, "--json"]);
    expect(parseData<Array<{ readonly status: string }>>(releasedList.stdout)).toEqual([
      expect.objectContaining({ status: "released" })
    ]);

    const reservedAgain = await runCli(rootDir, ["work", "reserve", work.meta.id, "--agent", "agent-b", "--ttl", "1h", "--json"]);
    const staleReservationId = parseData<{ readonly reservationId: string }>(reservedAgain.stdout).reservationId;
    await setReservationExpiresAt(rootDir, staleReservationId, "2000-01-01T00:00:00.000Z");

    const expiredActiveList = await runCli(rootDir, ["reservation", "list", "--agent", "agent-b", "--expired", "--json"]);
    expect(parseData<Array<{ readonly id: string; readonly status: string; readonly expired: boolean }>>(expiredActiveList.stdout)).toEqual([
      expect.objectContaining({ id: staleReservationId, status: "active", expired: true })
    ]);
    const expiredStatus = await runCli(rootDir, ["agent", "status", "--agent", "agent-b", "--json"]);
    const expiredStatusPayload = parseData<{
      readonly reservations: { readonly activeCount: number; readonly expiredActiveCount: number };
      readonly recommendedAction: { readonly kind: string; readonly command?: string };
    }>(expiredStatus.stdout);
    expect(expiredStatusPayload.reservations.activeCount).toBe(1);
    expect(expiredStatusPayload.reservations.expiredActiveCount).toBe(1);
    expect(expiredStatusPayload.recommendedAction).toEqual(
      expect.objectContaining({
        kind: "repair_expired_reservations",
        command: "bwrk doctor --fix"
      })
    );
    const blockedStart = await runCli(rootDir, ["agent", "start", "--agent", "agent-b", "--json"]);
    const blockedStartPayload = parseData<{
      readonly started: boolean;
      readonly reason: string;
      readonly recommendedAction: { readonly kind: string; readonly command?: string };
      readonly status: { readonly reservations: { readonly expiredActiveCount: number } };
    }>(blockedStart.stdout);
    expect(blockedStart.exitCode).toBe(1);
    expect(blockedStartPayload.started).toBe(false);
    expect(blockedStartPayload.reason).toBe("expired_active_reservations");
    expect(blockedStartPayload.status.reservations.expiredActiveCount).toBe(1);
    expect(blockedStartPayload.recommendedAction).toEqual(
      expect.objectContaining({
        kind: "repair_expired_reservations",
        command: "bwrk doctor --fix"
      })
    );

    const failingDoctor = await runCli(rootDir, ["doctor", "--json"]);
    const failingPayload = parseData<{
      readonly ok: boolean;
      readonly diagnostics: Array<{ readonly code: string; readonly severity: string }>;
    }>(failingDoctor.stdout);
    expect(failingDoctor.exitCode).toBe(1);
    expect(failingPayload.ok).toBe(false);
    expect(failingPayload.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "reservation.expired", severity: "error" })])
    );

    const repairedDoctor = await runCli(rootDir, ["doctor", "--fix", "--json"]);
    const repairedPayload = parseData<{
      readonly ok: boolean;
      readonly fixed: boolean;
      readonly diagnostics: Array<{ readonly code: string; readonly severity: string }>;
    }>(repairedDoctor.stdout);
    expect(repairedDoctor.exitCode).toBe(0);
    expect(repairedPayload.ok).toBe(true);
    expect(repairedPayload.fixed).toBe(true);
    expect(repairedPayload.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "reservation.expired", severity: "fixed" })])
    );

    const shown = await runCli(rootDir, ["work", "show", work.meta.id, "--json"]);
    const shownWork = parseData<{ readonly status: string; readonly activeReservationId?: string }>(shown.stdout);
    expect(shownWork.status).toBe("ready");
    expect(shownWork.activeReservationId).toBeUndefined();

    const expiredList = await runCli(rootDir, ["reservation", "list", "--status", "expired", "--work", work.meta.id, "--json"]);
    expect(parseData<Array<{ readonly id: string; readonly status: string; readonly expired: boolean }>>(expiredList.stdout)).toEqual([
      expect.objectContaining({ id: staleReservationId, status: "expired", expired: true })
    ]);
  });

  it("persists reviewer heartbeat checkpoints through CLI and sync refresh", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);
    await runCli(rootDir, ["vault", "init", "--json"]);

    const sprint = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Heartbeat Sprint", "--kind", "sprint", "--ready", "--json"])).stdout
    );
    const first = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Heartbeat first close", "--ready", "--json"])).stdout
    );
    const second = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Heartbeat second close", "--ready", "--json"])).stdout
    );
    await runCli(rootDir, ["dep", "add", sprint.meta.id, first.meta.id, "--json"]);
    await runCli(rootDir, ["dep", "add", sprint.meta.id, second.meta.id, "--json"]);

    const closeWork = async (workId: string, summary: string) => {
      const evidence = parseData<{ readonly meta: { readonly id: string } }>(
        (
          await runCli(rootDir, [
            "evidence",
            "add",
            workId,
            "--summary",
            summary,
            "--outcome",
            "passed",
            "--json"
          ])
        ).stdout
      );
      await runCli(rootDir, ["work", "verify", workId, "--evidence", evidence.meta.id, "--verdict", "passed", "--json"]);
      return parseData<{ readonly work: { readonly status: string; readonly closedAt: string } }>(
        (
          await runCli(rootDir, [
            "work",
            "close",
            workId,
            "--reason",
            "heartbeat fixture closed",
            "--dirty-path",
            "no_repo_changes: heartbeat fixture",
            "--json"
          ])
        ).stdout
      );
    };

    const firstClosed = await closeWork(first.meta.id, "First heartbeat fixture evidence passed.");
    expect(firstClosed.work.status).toBe("closed");

    const created = parseData<{
      readonly schemaVersion: string;
      readonly heartbeat: {
        readonly meta: { readonly id: string };
        readonly name: string;
        readonly reviewerId: string;
        readonly containerId?: string;
        readonly lastClosedAt?: string;
        readonly lastEventId?: string;
        readonly lastWorkId?: string;
      };
      readonly sinceHeartbeat: {
        readonly closedAt?: string;
        readonly eventId?: string;
        readonly workId?: string;
        readonly includeEqualClosedAt: boolean;
      };
      readonly event?: { readonly type: string; readonly subjectType: string; readonly subjectId: string };
    }>(
      (
        await runCli(rootDir, [
          "heartbeat",
          "create",
          "review-pass",
          "--reviewer",
          "reviewer-a",
          "--container",
          sprint.meta.id,
          "--work",
          first.meta.id,
          "--json"
        ])
      ).stdout
    );
    expect(created.schemaVersion).toBe("boreal.cli.heartbeat.v1");
    expect(created.heartbeat).toEqual(
      expect.objectContaining({
        name: "review-pass",
        reviewerId: "reviewer-a",
        containerId: sprint.meta.id,
        lastClosedAt: firstClosed.work.closedAt,
        lastWorkId: first.meta.id
      })
    );
    expect(created.heartbeat.lastEventId).toMatch(/^bw_event_/);
    expect(created.sinceHeartbeat).toEqual(
      expect.objectContaining({
        closedAt: firstClosed.work.closedAt,
        eventId: created.heartbeat.lastEventId,
        workId: first.meta.id,
        includeEqualClosedAt: true
      })
    );
    expect(created.event).toEqual(
      expect.objectContaining({
        type: "reviewer_heartbeat.created",
        subjectType: "reviewer_heartbeat",
        subjectId: created.heartbeat.meta.id
      })
    );

    const shownByName = parseData<{ readonly heartbeat: { readonly meta: { readonly id: string } } }>(
      (
        await runCli(rootDir, [
          "heartbeat",
          "show",
          "review-pass",
          "--reviewer",
          "reviewer-a",
          "--container",
          sprint.meta.id,
          "--json"
        ])
      ).stdout
    );
    expect(shownByName.heartbeat.meta.id).toBe(created.heartbeat.meta.id);

    const shownById = parseData<{ readonly heartbeat: { readonly meta: { readonly id: string } } }>(
      (await runCli(rootDir, ["heartbeat", "show", created.heartbeat.meta.id, "--json"])).stdout
    );
    expect(shownById.heartbeat.meta.id).toBe(created.heartbeat.meta.id);

    const secondClosed = await closeWork(second.meta.id, "Second heartbeat fixture evidence passed.");
    const advanced = parseData<{
      readonly heartbeat: { readonly lastClosedAt?: string; readonly lastWorkId?: string };
      readonly sinceHeartbeat: { readonly includeEqualClosedAt: boolean; readonly workId?: string };
      readonly event?: { readonly type: string };
    }>(
      (
        await runCli(rootDir, [
          "heartbeat",
          "advance",
          "review-pass",
          "--reviewer",
          "reviewer-a",
          "--container",
          sprint.meta.id,
          "--work",
          second.meta.id,
          "--json"
        ])
      ).stdout
    );
    expect(advanced.heartbeat.lastClosedAt).toBe(secondClosed.work.closedAt);
    expect(advanced.heartbeat.lastWorkId).toBe(second.meta.id);
    expect(advanced.sinceHeartbeat).toEqual(expect.objectContaining({ includeEqualClosedAt: true, workId: second.meta.id }));
    expect(advanced.event?.type).toBe("reviewer_heartbeat.advanced");

    const refresh = await runCli(rootDir, ["sync", "refresh", "--json"]);
    const refreshPayload = parseData<{
      readonly ledgers: { readonly recordCounts: { readonly reviewerHeartbeats: number } };
    }>(refresh.stdout);
    expect(refresh.exitCode).toBe(0);
    expect(refreshPayload.ledgers.recordCounts.reviewerHeartbeats).toBe(1);

    const state = await readState<{
      readonly reviewerHeartbeats: Array<{ readonly meta: { readonly id: string }; readonly lastWorkId?: string }>;
    }>(rootDir);
    expect(state.reviewerHeartbeats).toEqual([
      expect.objectContaining({ meta: expect.objectContaining({ id: created.heartbeat.meta.id }), lastWorkId: second.meta.id })
    ]);
    const heartbeatLedger = await readFile(join(rootDir, ".boreal/ledgers/reviewer-heartbeats.jsonl"), "utf8");
    expect(heartbeatLedger).toContain(created.heartbeat.meta.id);
  });

  it("lists recently closed work with checkpoint, container, kind, and phase filters", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);

    const sprint = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Recent closed sprint", "--kind", "sprint", "--ready", "--json"])).stdout
    );
    const older = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Older closed child", "--ready", "--json"])).stdout
    );
    const equal = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Equal watermark child", "--ready", "--json"])).stdout
    );
    const newer = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Newer closed child", "--ready", "--json"])).stdout
    );
    const phase = parseData<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "work",
          "create",
          "Phase close milestone",
          "--kind",
          "milestone",
          "--label",
          "phase",
          "--ready",
          "--json"
        ])
      ).stdout
    );
    const outside = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Outside closed issue", "--kind", "issue", "--ready", "--json"])).stdout
    );
    for (const child of [older, equal, newer, phase]) {
      await runCli(rootDir, ["dep", "add", sprint.meta.id, child.meta.id, "--json"]);
    }

    const closedAtByWork = new Map([
      [older.meta.id, "2026-01-01T00:00:00.000Z"],
      [equal.meta.id, "2026-01-02T00:00:00.000Z"],
      [newer.meta.id, "2026-01-03T00:00:00.000Z"],
      [phase.meta.id, "2026-01-04T00:00:00.000Z"],
      [outside.meta.id, "2026-01-05T00:00:00.000Z"]
    ]);
    await updateState(rootDir, (state) => ({
      ...state,
      workItems: state.workItems.map((work) =>
        closedAtByWork.has(work.meta.id)
          ? {
              ...work,
              status: "closed",
              closedAt: closedAtByWork.get(work.meta.id),
              closedReason: `${work.title} closed`,
              evidenceIds: [`bw_evidence_${work.meta.id.slice("bw_work_".length)}`],
              verificationIds: [`bw_verification_${work.meta.id.slice("bw_work_".length)}`]
            }
          : work
      ),
      events: [
        ...((state.events as readonly unknown[] | undefined) ?? []),
        ...[older, equal, newer, phase, outside].map((work, index) => ({
          meta: {
            ...testMeta(`bw_event_${String(index + 1).padStart(12, "0")}`),
            createdAt: closedAtByWork.get(work.meta.id),
            updatedAt: closedAtByWork.get(work.meta.id)
          },
          type: "work.closed",
          subjectId: work.meta.id,
          subjectType: "work",
          payload: { reason: `${work.meta.id} closed` }
        }))
      ]
    }));

    const checkpointRun = await runCli(rootDir, [
      "heartbeat",
      "create",
      "recent-review",
      "--reviewer",
      "reviewer-a",
      "--container",
      sprint.meta.id,
      "--closed-at",
      "2026-01-02T00:00:00.000Z",
      "--json"
    ]);
    expect(checkpointRun).toEqual(expect.objectContaining({ exitCode: 0, stderr: "" }));
    const checkpoint = parseData<{
      readonly heartbeat: { readonly meta: { readonly id: string }; readonly lastClosedAt?: string; readonly lastWorkId?: string };
    }>(checkpointRun.stdout);
    expect(checkpoint.heartbeat.lastClosedAt).toBe("2026-01-02T00:00:00.000Z");
    expect(checkpoint.heartbeat.lastWorkId).toBeUndefined();

    const afterCheckpoint = parseData<{
      readonly schemaVersion: string;
      readonly filters: { readonly after: { readonly source: string; readonly includeEqualClosedAt: boolean }; readonly containerId: string };
      readonly items: readonly Array<{
        readonly id: string;
        readonly title: string;
        readonly kind: string;
        readonly status: string;
        readonly closedAt: string;
        readonly closedReason: string;
        readonly labels: readonly string[];
        readonly evidenceCount: number;
        readonly verificationCount: number;
        readonly closedEventId?: string;
      }>;
    }>(
      (
        await runCli(rootDir, [
          "work",
          "recent-closed",
          "--container",
          sprint.meta.id,
          "--after",
          checkpoint.heartbeat.meta.id,
          "--order",
          "asc",
          "--json"
        ])
      ).stdout
    );

    expect(afterCheckpoint.schemaVersion).toBe("boreal.cli.work.recent_closed.v1");
    expect(afterCheckpoint.filters).toEqual(
      expect.objectContaining({
        containerId: sprint.meta.id,
        after: expect.objectContaining({ source: "checkpoint", includeEqualClosedAt: true })
      })
    );
    expect(afterCheckpoint.items.map((item) => item.id)).toEqual([equal.meta.id, newer.meta.id, phase.meta.id]);
    expect(afterCheckpoint.items[0]).toEqual(
      expect.objectContaining({
        title: "Equal watermark child",
        kind: "task",
        status: "closed",
        closedAt: "2026-01-02T00:00:00.000Z",
        closedReason: "Equal watermark child closed",
        evidenceCount: 1,
        verificationCount: 1,
        closedEventId: expect.stringMatching(/^bw_event_/)
      })
    );

    const afterIso = parseData<{ readonly items: readonly Array<{ readonly id: string }> }>(
      (
        await runCli(rootDir, [
          "work",
          "recent-closed",
          "--container",
          sprint.meta.id,
          "--after",
          "2026-01-02T00:00:00.000Z",
          "--order",
          "asc",
          "--json"
        ])
      ).stdout
    );
    expect(afterIso.items.map((item) => item.id)).toEqual([newer.meta.id, phase.meta.id]);

    const limitedTasks = parseData<{ readonly items: readonly Array<{ readonly id: string; readonly kind: string }> }>(
      (
        await runCli(rootDir, [
          "work",
          "recent-closed",
          "--container",
          sprint.meta.id,
          "--kind",
          "task",
          "--since",
          "2026-01-03T00:00:00.000Z",
          "--limit",
          "1",
          "--json"
        ])
      ).stdout
    );
    expect(limitedTasks.items).toEqual([expect.objectContaining({ id: newer.meta.id, kind: "task" })]);

    const phaseOnly = parseData<{ readonly items: readonly Array<{ readonly id: string; readonly kind: string; readonly labels: readonly string[] }> }>(
      (await runCli(rootDir, ["work", "recent-closed", "--container", sprint.meta.id, "--phase", "--json"])).stdout
    );
    expect(phaseOnly.items).toEqual([
      expect.objectContaining({ id: phase.meta.id, kind: "milestone", labels: expect.arrayContaining(["phase"]) })
    ]);
  });

  it("lists review candidates and rolls review gate counts through closeout surfaces", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);

    const sprint = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Review candidate sprint", "--kind", "sprint", "--ready", "--json"])).stdout
    );

    const closePlainWork = async (title: string) => {
      const work = parseData<{ readonly meta: { readonly id: string } }>(
        (await runCli(rootDir, ["work", "create", title, "--ready", "--json"])).stdout
      );
      await runCli(rootDir, ["dep", "add", sprint.meta.id, work.meta.id, "--json"]);
      const evidence = parseData<{ readonly meta: { readonly id: string } }>(
        (
          await runCli(rootDir, [
            "evidence",
            "add",
            work.meta.id,
            "--summary",
            `${title} implementation passed.`,
            "--kind",
            "test",
            "--outcome",
            "passed",
            "--json"
          ])
        ).stdout
      );
      await runCli(rootDir, ["work", "verify", work.meta.id, "--evidence", evidence.meta.id, "--verdict", "passed", "--json"]);
      const summary = parseData<{ readonly summary: { readonly meta: { readonly id: string } } }>(
        (
          await runCli(rootDir, [
            "summary",
            "compose",
            work.meta.id,
            "--dirty-path",
            `no_repo_changes: ${title} fixture`,
            "--json"
          ])
        ).stdout
      );
      await runCli(rootDir, [
        "work",
        "close",
        work.meta.id,
        "--reason",
        `${title} closed`,
        "--agent-summary",
        summary.summary.meta.id,
        "--json"
      ]);
      return work;
    };

    const pending = await closePlainWork("Pending review candidate");
    const passed = await closePlainWork("Passed review candidate");
    const forced = await closePlainWork("Forced audit candidate");
    const optional = await closePlainWork("Optional recent closure");
    const outside = await closePlainWork("Outside candidate");
    await runCli(rootDir, ["dep", "remove", sprint.meta.id, outside.meta.id, "--json"]);

    await runCli(rootDir, ["work", "edit", pending.meta.id, "--required-gate", "review", "--json"]);
    await runCli(rootDir, ["work", "edit", passed.meta.id, "--required-gate", "review", "--json"]);
    const reviewEvidence = parseData<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "evidence",
          "add",
          passed.meta.id,
          "--summary",
          "Reviewer checked passed candidate and found no blockers.",
          "--kind",
          "review",
          "--outcome",
          "passed",
          "--json"
        ])
      ).stdout
    );
    expect(reviewEvidence.meta.id).toMatch(/^bw_evidence_/);

    await runCli(rootDir, ["work", "edit", forced.meta.id, "--required-gate", "audit", "--json"]);
    const forceEvidence = parseData<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "evidence",
          "add",
          forced.meta.id,
          "--summary",
          "External audit window was unavailable for this closed work.",
          "--kind",
          "note",
          "--outcome",
          "observed",
          "--json"
        ])
      ).stdout
    );
    await runCli(rootDir, [
      "work",
      "edit",
      forced.meta.id,
      "--force-gate",
      "audit",
      "--force-gate-reason",
      "audit_unavailable",
      "--force-gate-comment",
      "External audit window unavailable before reviewer sweep.",
      "--force-gate-evidence",
      forceEvidence.meta.id,
      "--json"
    ]);

    const checkpoint = parseData<{ readonly heartbeat: { readonly meta: { readonly id: string } } }>(
      (
        await runCli(rootDir, [
          "heartbeat",
          "create",
          "candidate-review",
          "--reviewer",
          "reviewer-a",
          "--container",
          sprint.meta.id,
          "--closed-at",
          "2000-01-01T00:00:00.000Z",
          "--json"
        ])
      ).stdout
    );

    const pendingCandidates = parseData<{
      readonly schemaVersion: string;
      readonly summary: {
        readonly total: number;
        readonly returned: number;
        readonly pending: number;
        readonly passed: number;
        readonly forced: number;
        readonly optional: number;
        readonly reviewGates: {
          readonly review: { readonly pending: number; readonly passed: number; readonly forced: number };
          readonly audit: { readonly pending: number; readonly passed: number; readonly forced: number };
        };
      };
      readonly optionalRecentClosedCommand: string;
      readonly items: readonly Array<{
        readonly id: string;
        readonly reviewStatus: string;
        readonly pendingGateIds: readonly string[];
        readonly passedGateIds: readonly string[];
        readonly forcedGateIds: readonly string[];
        readonly reviewEvidenceCommand: string;
        readonly heartbeatAdvanceCommand?: string;
      }>;
    }>(
      (
        await runCli(rootDir, [
          "work",
          "review-candidates",
          "--container",
          sprint.meta.id,
          "--after",
          checkpoint.heartbeat.meta.id,
          "--json"
        ])
      ).stdout
    );

    expect(pendingCandidates.schemaVersion).toBe("boreal.cli.work.review_candidates.v1");
    expect(pendingCandidates.items).toEqual([
      expect.objectContaining({
        id: pending.meta.id,
        reviewStatus: "pending",
        pendingGateIds: [expect.stringMatching(/^bw_gate_/)],
        reviewEvidenceCommand: expect.stringContaining("bwrk evidence add"),
        heartbeatAdvanceCommand: `bwrk heartbeat advance ${checkpoint.heartbeat.meta.id} --work ${pending.meta.id} --json`
      })
    ]);
    expect(pendingCandidates.summary).toEqual(
      expect.objectContaining({
        total: 3,
        returned: 1,
        pending: 1,
        passed: 1,
        forced: 1,
        optional: 0,
        reviewGates: expect.objectContaining({
          review: expect.objectContaining({ pending: 1, passed: 1, forced: 0 }),
          audit: expect.objectContaining({ pending: 0, passed: 0, forced: 1 })
        })
      })
    );
    expect(pendingCandidates.optionalRecentClosedCommand).toContain("bwrk work recent-closed");

    const allCandidates = parseData<{ readonly items: readonly Array<{ readonly id: string; readonly reviewStatus: string }> }>(
      (
        await runCli(rootDir, [
          "work",
          "review-candidates",
          "--container",
          sprint.meta.id,
          "--after",
          checkpoint.heartbeat.meta.id,
          "--review-status",
          "all",
          "--json"
        ])
      ).stdout
    );
    expect(allCandidates.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: pending.meta.id, reviewStatus: "pending" }),
        expect.objectContaining({ id: passed.meta.id, reviewStatus: "passed" }),
        expect.objectContaining({ id: forced.meta.id, reviewStatus: "forced" })
      ])
    );
    expect(allCandidates.items.map((item) => item.id)).not.toContain(optional.meta.id);
    expect(allCandidates.items.map((item) => item.id)).not.toContain(outside.meta.id);

    const optionalCandidates = parseData<{ readonly items: readonly Array<{ readonly id: string; readonly reviewStatus: string }> }>(
      (
        await runCli(rootDir, [
          "work",
          "review-candidates",
          "--container",
          sprint.meta.id,
          "--include-optional",
          "--review-status",
          "optional",
          "--json"
        ])
      ).stdout
    );
    expect(optionalCandidates.items).toEqual([expect.objectContaining({ id: optional.meta.id, reviewStatus: "optional" })]);

    const doctor = parseData<DoctorPayload>((await runCli(rootDir, ["doctor", "--json"])).stdout);
    expect(doctorDiagnostic(doctor, "closeout.review_gate_counts")).toEqual(
      expect.objectContaining({
        severity: "ok",
        details: expect.objectContaining({
          review: expect.objectContaining({ pending: 1, passed: 1, forced: 0 }),
          audit: expect.objectContaining({ pending: 0, passed: 0, forced: 1 })
        })
      })
    );
    expect(doctorDiagnostic(doctor, "closeout.required_gate_coverage")).toEqual(
      expect.objectContaining({
        severity: "warning",
        details: expect.arrayContaining([
          expect.objectContaining({
            workId: pending.meta.id,
            gateKind: "review",
            gateScope: "self",
            targetId: pending.meta.id,
            reason: "required gate has no satisfying evidence"
          })
        ])
      })
    );

    const strictDoctor = parseData<DoctorPayload>((await runCli(rootDir, ["doctor", "--strict", "--json"])).stdout);
    expect(strictDoctor.ok).toBe(false);
    expect(doctorDiagnostic(strictDoctor, "closeout.required_gate_coverage")).toEqual(
      expect.objectContaining({ severity: "warning" })
    );

    const gate = parseData<{
      readonly reviewGates: {
        readonly review: { readonly pending: number; readonly passed: number; readonly forced: number };
        readonly audit: { readonly pending: number; readonly passed: number; readonly forced: number };
      };
    }>((await runCli(rootDir, ["gate", "closeout", "--json"])).stdout);
    expect(gate.reviewGates).toEqual(
      expect.objectContaining({
        review: expect.objectContaining({ pending: 1, passed: 1, forced: 0 }),
        audit: expect.objectContaining({ pending: 0, passed: 0, forced: 1 })
      })
    );
    const strictGate = parseData<{
      readonly ok: boolean;
      readonly doctor: { readonly ok: boolean; readonly diagnostics: readonly Array<{ readonly code: string; readonly severity: string }> };
    }>((await runCli(rootDir, ["gate", "closeout", "--strict", "--json"])).stdout);
    expect(strictGate.ok).toBe(false);
    expect(strictGate.doctor.ok).toBe(false);
    expect(strictGate.doctor.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "closeout.required_gate_coverage", severity: "warning" })
      ])
    );

    const doctorEvidence = parseData<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "evidence",
          "add",
          sprint.meta.id,
          "--summary",
          "doctor review gate counts passed",
          "--kind",
          "command",
          "--outcome",
          "passed",
          "--command",
          "bwrk doctor --json",
          "--json"
        ])
      ).stdout
    );
    const syncEvidence = parseData<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "evidence",
          "add",
          sprint.meta.id,
          "--summary",
          "sync refresh passed",
          "--kind",
          "command",
          "--outcome",
          "passed",
          "--command",
          "bwrk sync refresh --json",
          "--json"
        ])
      ).stdout
    );
    const report = parseData<{
      readonly path: string;
      readonly report: {
        readonly summary: {
          readonly reviewGates: {
            readonly review: { readonly pending: number; readonly passed: number; readonly forced: number };
            readonly audit: { readonly pending: number; readonly passed: number; readonly forced: number };
          };
        };
        readonly reviewGateDetails: readonly Array<{
          readonly workId: string;
          readonly kind: string;
          readonly status: string;
          readonly evidenceIds: readonly string[];
          readonly forceReason?: string;
          readonly forceComment?: string;
          readonly forceEvidenceIds: readonly string[];
        }>;
      };
    }>(
      (
        await runCli(rootDir, [
          "sprint",
          "report",
          sprint.meta.id,
          "--doctor-evidence",
          doctorEvidence.meta.id,
          "--sync-evidence",
          syncEvidence.meta.id,
          "--out",
          ".boreal/results/review-gates.md",
          "--json"
        ])
      ).stdout
    );
    expect(report.report.summary.reviewGates).toEqual(
      expect.objectContaining({
        review: expect.objectContaining({ pending: 1, passed: 1, forced: 0 }),
        audit: expect.objectContaining({ pending: 0, passed: 0, forced: 1 })
      })
    );
    expect(report.report.reviewGateDetails).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          workId: pending.meta.id,
          kind: "review",
          status: "open",
          evidenceIds: []
        }),
        expect.objectContaining({
          workId: passed.meta.id,
          kind: "review",
          status: "satisfied",
          evidenceIds: [reviewEvidence.meta.id]
        }),
        expect.objectContaining({
          workId: forced.meta.id,
          kind: "audit",
          status: "forced",
          forceReason: "audit_unavailable",
          forceComment: "External audit window unavailable before reviewer sweep.",
          forceEvidenceIds: [forceEvidence.meta.id]
        })
      ])
    );
    const reportMarkdown = await readFile(report.path, "utf8");
    expect(reportMarkdown).toContain("Review gates: pending 1, passed 1, forced bypass 0");
    expect(reportMarkdown).toContain("Audit gates: pending 0, passed 0, forced bypass 1");
    expect(reportMarkdown).toContain(reviewEvidence.meta.id);
    expect(reportMarkdown).toContain(`force_evidence=${forceEvidence.meta.id}`);

    const composed = parseData<{
      readonly summary: { readonly body: string };
      readonly closeoutGateStatus: { readonly summary: { readonly reviewGates: { readonly review: { readonly pending: number } } } };
    }>(
      (
        await runCli(rootDir, [
          "summary",
          "compose",
          pending.meta.id,
          "--dirty-path",
          "no_repo_changes: pending review gate summary fixture",
          "--no-render",
          "--json"
        ])
      ).stdout
    );
    expect(composed.closeoutGateStatus?.summary.reviewGates.review.pending).toBe(1);
    expect(composed.summary.body).toContain("Review gates: pending 1, passed 0, forced bypass 0");

    const sprintSummary = parseData<{ readonly summary: { readonly body: string } }>(
      (
        await runCli(rootDir, [
          "summary",
          "compose",
          sprint.meta.id,
          "--dirty-path",
          "no_repo_changes: sprint review gate summary fixture",
          "--no-render",
          "--json"
        ])
      ).stdout
    );
    expect(sprintSummary.summary.body).toContain("## Review/Audit Gate Details");
    expect(sprintSummary.summary.body).toContain(reviewEvidence.meta.id);
    expect(sprintSummary.summary.body).toContain(`force_evidence=${forceEvidence.meta.id}`);
  });

  it("reports SQLite cache missing, stale, and corrupt states in doctor", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);
    await runCli(rootDir, ["vault", "init", "--json"]);
    await runCli(rootDir, ["work", "create", "SQLite cache doctor work", "--json"]);

    const missingDoctor = await runCli(rootDir, ["doctor", "--json"]);
    const missingPayload = parseData<DoctorPayload>(missingDoctor.stdout);
    expect(doctorDiagnostic(missingPayload, "cache.sqlite")).toEqual(
      expect.objectContaining({
        code: "cache.sqlite",
        severity: "ok",
        message: "SQLite generated cache is not built yet",
        details: expect.objectContaining({ exists: false })
      })
    );

    const refresh = await runCli(rootDir, ["sync", "refresh", "--json"]);
    const refreshPayload = parseData<{
      readonly sqliteCache: {
        readonly path: string;
        readonly sqliteAvailable: boolean;
        readonly rebuilt: boolean;
        readonly skipped: boolean;
      };
    }>(refresh.stdout);
    expect(refresh.exitCode).toBe(0);
    if (!refreshPayload.sqliteCache.sqliteAvailable) {
      expect(refreshPayload.sqliteCache).toEqual(expect.objectContaining({ rebuilt: false, skipped: true }));
      return;
    }

    const freshDoctor = await runCli(rootDir, ["doctor", "--json"]);
    const freshPayload = parseData<DoctorPayload>(freshDoctor.stdout);
    expect(doctorDiagnostic(freshPayload, "cache.sqlite")).toEqual(
      expect.objectContaining({
        code: "cache.sqlite",
        severity: "ok",
        message: "SQLite generated cache matches current runtime state",
        details: expect.objectContaining({ exists: true, stale: false })
      })
    );

    await runCli(rootDir, ["work", "create", "SQLite cache drift work", "--json"]);
    const staleDoctor = await runCli(rootDir, ["doctor", "--json"]);
    const stalePayload = parseData<DoctorPayload>(staleDoctor.stdout);
    expect(doctorDiagnostic(stalePayload, "cache.sqlite")).toEqual(
      expect.objectContaining({
        code: "cache.sqlite",
        severity: "warning",
        message: "SQLite generated cache differs from current runtime state",
        details: expect.objectContaining({
          stale: true,
          repairCommand: "bwrk sync refresh --json"
        })
      })
    );

    await runCli(rootDir, ["sync", "refresh", "--json"]);
    await writeFile(refreshPayload.sqliteCache.path, "not a sqlite database", "utf8");
    const corruptDoctor = await runCli(rootDir, ["doctor", "--json"]);
    const corruptPayload = parseData<DoctorPayload>(corruptDoctor.stdout);
    expect(doctorDiagnostic(corruptPayload, "cache.sqlite")).toEqual(
      expect.objectContaining({
        code: "cache.sqlite",
        severity: "warning",
        message: "SQLite generated cache is invalid",
        details: expect.objectContaining({
          error: expect.any(String),
          repairCommand: "bwrk sync refresh --json"
        })
      })
    );
  });

  it("exports, snapshots, imports, and rejects conflicting JSON snapshots", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);

    const work = parseData<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "work",
          "create",
          "Exportable work",
          "--description",
          "This record should round-trip through import.",
          "--label",
          "export",
          "--ready",
          "--json"
        ])
      ).stdout
    );
    await runCli(rootDir, [
      "evidence",
      "add",
      work.meta.id,
      "--summary",
      "export import test passed",
      "--kind",
      "test",
      "--outcome",
      "passed",
      "--json"
    ]);
    await runCli(rootDir, [
      "source",
      "add",
      "--title",
      "Export source",
      "--uri",
      "file://export-source.md",
      "--json"
    ]);
    await runCli(rootDir, ["context", "rebuild", "--json"]);
    const sourceState = parseJson<{
      readonly events: Array<{ readonly type: string; readonly subjectId: string; readonly operationId?: string; readonly operationLink?: string }>;
      readonly operations: Array<{ readonly commandPath: string }>;
    }>(await readFile(join(rootDir, ".boreal/runtime/state.json"), "utf8"));
    expect(sourceState.operations.map((operation) => operation.commandPath)).toEqual(
      expect.arrayContaining(["work create", "evidence add", "source add", "context rebuild"])
    );
    expect(sourceState.events.some((event) => event.operationId !== undefined || event.operationLink !== undefined)).toBe(true);

    const exportPath = join(rootDir, "boreal-export.json");
    const exported = await runCli(rootDir, ["export", "json", "--out", "boreal-export.json", "--json"]);
    const exportPayload = parseData<{ readonly path: string; readonly contentHash: string }>(exported.stdout);
    expect(exported.exitCode).toBe(0);
    expect(exportPayload.path).toBe(exportPath);
    expect(exportPayload.contentHash).toMatch(/^sha256:/);

    const exportDocument = parseJson<{
      readonly schemaVersion: string;
      readonly contentHash: string;
      readonly state: {
        readonly workItems: Array<{ readonly meta: { readonly id: string }; readonly title: string }>;
        readonly events: Array<{ readonly type: string; readonly subjectId: string; readonly operationId?: string; readonly operationLink?: string }>;
      };
    }>(await readFile(exportPath, "utf8"));
    expect(exportDocument.schemaVersion).toBe("boreal.export.v1");
    expect("operations" in exportDocument.state).toBe(false);
    expect(exportDocument.state.workItems.map((item) => item.meta.id)).toContain(work.meta.id);
    expect(
      exportDocument.state.events.every((event) => event.operationId === undefined && event.operationLink === undefined)
    ).toBe(true);

    const markdown = await runCli(rootDir, ["export", "markdown", "--out", "markdown-export", "--json"]);
    const markdownPayload = parseData<{ readonly outDir: string; readonly files: readonly string[] }>(markdown.stdout);
    expect(markdownPayload.outDir).toBe(join(rootDir, "markdown-export"));
    expect(markdownPayload.files.some((file) => file.endsWith(`/work/${work.meta.id}.md`))).toBe(true);
    const workMarkdown = await readFile(join(rootDir, "markdown-export", "work", `${work.meta.id}.md`), "utf8");
    expect(workMarkdown).toContain("kind: work");
    expect(workMarkdown).toContain("work_kind: task");
    expect(workMarkdown).toContain("status: needs_verification");
    expect(workMarkdown).toContain("labels:\n  - export");
    expect(workMarkdown).toContain("evidence:\n  - bw_evidence_");
    expect(workMarkdown).toContain("created_at:");

    const ledgers = await runCli(rootDir, ["export", "ledgers", "--json"]);
    const ledgerPayload = parseData<{
      readonly outDir: string;
      readonly manifestPath: string;
      readonly contentHash: string;
      readonly recordCounts: { readonly workItems: number; readonly events: number };
      readonly deletedRecordCounts: { readonly workItems: number };
      readonly files: Array<{ readonly section: string; readonly path: string; readonly count: number; readonly contentHash: string }>;
      readonly deletions: { readonly path: string; readonly count: number; readonly contentHash: string };
    }>(ledgers.stdout);
    expect(ledgers.exitCode).toBe(0);
    expect(ledgerPayload.outDir).toBe(join(rootDir, ".boreal/ledgers"));
    expect(ledgerPayload.manifestPath).toBe(join(rootDir, ".boreal/ledgers/manifest.json"));
    expect(ledgerPayload.contentHash).toMatch(/^sha256:/);
    expect(ledgerPayload.recordCounts.workItems).toBe(1);
    expect(ledgerPayload.deletedRecordCounts.workItems).toBe(0);
    expect(ledgerPayload.deletions).toEqual(
      expect.objectContaining({ path: "deletions.jsonl", count: 0, contentHash: expect.stringMatching(/^sha256:/) })
    );
    expect(ledgerPayload.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ section: "workItems", path: "work-items.jsonl", count: 1 }),
        expect.objectContaining({ section: "events", path: "events.jsonl" })
      ])
    );
    expect(ledgerPayload.files.map((file) => file.section)).not.toContain("operations");
    const workLedger = await readFile(join(rootDir, ".boreal/ledgers/work-items.jsonl"), "utf8");
    expect(workLedger).toContain("\"title\":\"Exportable work\"");
    const eventLedger = await readFile(join(rootDir, ".boreal/ledgers/events.jsonl"), "utf8");
    expect(eventLedger).not.toContain("operationId");
    expect(eventLedger).not.toContain("operationLink");
    expect(await readFile(join(rootDir, ".boreal/ledgers/deletions.jsonl"), "utf8")).toBe("");

    const freshLedgerStatus = await runCli(rootDir, ["ledger", "status", "--json"]);
    const freshLedgerPayload = parseData<{
      readonly ok: boolean;
      readonly exists: boolean;
      readonly stale: boolean;
      readonly reconstructable: boolean;
      readonly deletedRecordCounts: { readonly workItems: number };
      readonly deletions: { readonly path: string; readonly count: number };
    }>(freshLedgerStatus.stdout);
    expect(freshLedgerStatus.exitCode).toBe(0);
    expect(freshLedgerPayload).toEqual(
      expect.objectContaining({
        ok: true,
        exists: true,
        stale: false,
        reconstructable: true,
        deletedRecordCounts: expect.objectContaining({ workItems: 0 }),
        deletions: expect.objectContaining({ path: "deletions.jsonl", count: 0 })
      })
    );

    await runCli(rootDir, ["vault", "init", "--json"]);
    const missingIndexSync = await runCli(rootDir, ["sync", "status", "--json"]);
    const missingIndexSyncPayload = parseData<{
      readonly ok: boolean;
      readonly vault: { readonly ok: boolean };
      readonly ledgers: { readonly ok: boolean };
      readonly searchIndex: { readonly ok: boolean; readonly exists: boolean; readonly stale: boolean };
      readonly recommendedActions: readonly string[];
    }>(missingIndexSync.stdout);
    expect(missingIndexSync.exitCode).toBe(1);
    expect(missingIndexSyncPayload).toEqual(
      expect.objectContaining({
        ok: false,
        vault: expect.objectContaining({ ok: true }),
        ledgers: expect.objectContaining({ ok: true }),
        searchIndex: expect.objectContaining({ ok: false, exists: false, stale: true }),
        recommendedActions: ["bwrk sync refresh --json"]
      })
    );

    const initialRefresh = await runCli(rootDir, ["sync", "refresh", "--json"]);
    const initialRefreshPayload = parseData<{
      readonly refreshed: true;
      readonly refreshOk: true;
      readonly postRefreshStatusOk: boolean;
      readonly exitReason: string;
      readonly contextViews: number;
      readonly sqliteCache: {
        readonly path: string;
        readonly sqliteAvailable: boolean;
        readonly rebuilt: boolean;
        readonly skipped: boolean;
        readonly sourceContentHash: string;
        readonly recordCounts: { readonly workItems: number };
      };
      readonly status: {
        readonly ok: boolean;
        readonly ledgers: { readonly ok: boolean; readonly stale: boolean };
        readonly searchIndex: { readonly ok: boolean; readonly stale: boolean };
        readonly recommendedActions: readonly string[];
      };
    }>(initialRefresh.stdout);
    expect(initialRefresh.exitCode).toBe(0);
    expect(initialRefreshPayload.refreshed).toBe(true);
    expect(initialRefreshPayload.refreshOk).toBe(true);
    expect(initialRefreshPayload.postRefreshStatusOk).toBe(true);
    expect(initialRefreshPayload.exitReason).toBe("ok");
    expect(initialRefreshPayload.contextViews).toBeGreaterThan(0);
    expect(initialRefreshPayload.sqliteCache.path).toBe(join(rootDir, ".boreal/cache/runtime-cache.sqlite"));
    expect(initialRefreshPayload.sqliteCache.sourceContentHash).toMatch(/^sha256:/);
    expect(initialRefreshPayload.sqliteCache.recordCounts.workItems).toBe(1);
    if (initialRefreshPayload.sqliteCache.sqliteAvailable) {
      expect(initialRefreshPayload.sqliteCache).toEqual(expect.objectContaining({ rebuilt: true, skipped: false }));
    } else {
      expect(initialRefreshPayload.sqliteCache).toEqual(expect.objectContaining({ rebuilt: false, skipped: true }));
    }
    expect(initialRefreshPayload.status).toEqual(
      expect.objectContaining({
        ok: true,
        ledgers: expect.objectContaining({ ok: true, stale: false }),
        searchIndex: expect.objectContaining({ ok: true, stale: false }),
        recommendedActions: []
      })
    );

    const freshSync = await runCli(rootDir, ["sync", "status", "--json"]);
    const freshSyncPayload = parseData<{
      readonly ok: boolean;
      readonly vault: { readonly ok: boolean; readonly initialized: boolean };
      readonly ledgers: { readonly ok: boolean; readonly stale: boolean };
      readonly searchIndex: { readonly ok: boolean; readonly stale: boolean };
      readonly recommendedActions: readonly string[];
    }>(freshSync.stdout);
    expect(freshSync.exitCode).toBe(0);
    expect(freshSyncPayload).toEqual(
      expect.objectContaining({
        ok: true,
        vault: expect.objectContaining({ ok: true, initialized: true }),
        ledgers: expect.objectContaining({ ok: true, stale: false }),
        searchIndex: expect.objectContaining({ ok: true, stale: false }),
        recommendedActions: []
      })
    );

    const freshDoctor = await runCli(rootDir, ["doctor", "--json"]);
    const freshDoctorPayload = parseData<{
      readonly diagnostics: Array<{ readonly code: string; readonly severity: string; readonly details?: { readonly exists?: boolean } }>;
    }>(freshDoctor.stdout);
    expect(freshDoctorPayload.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "ledger.export_drift", severity: "ok" }),
        expect.objectContaining({ code: "cache.sqlite", severity: "ok" })
      ])
    );

    const ledgerTargetDir = await makeTempWorkspace();
    await runCli(ledgerTargetDir, ["init", "--json"]);
    const blockedLedgerImport = await runCli(ledgerTargetDir, [
      "import",
      "ledgers",
      "--from",
      join(rootDir, ".boreal/ledgers"),
      "--json"
    ]);
    const blockedLedgerPayload = parseJson<{ readonly ok: false; readonly code: string; readonly message: string }>(
      blockedLedgerImport.stderr
    );
    expect(blockedLedgerImport.exitCode).toBe(2);
    expect(blockedLedgerPayload.code).toBe("BOREAL_INVALID_INPUT");
    expect(blockedLedgerPayload.message).toContain("Path escapes Boreal workspace");

    const importedLedgers = await runCli(ledgerTargetDir, [
      "import",
      "ledgers",
      "--from",
      join(rootDir, ".boreal/ledgers"),
      "--allow-external-read",
      "--json"
    ]);
    const importedLedgerPayload = parseData<{
      readonly imported: { readonly workItems: number };
      readonly skipped: { readonly workItems: number };
    }>(importedLedgers.stdout);
    expect(importedLedgers.exitCode).toBe(0);
    expect(importedLedgerPayload.imported.workItems).toBe(1);
    expect(importedLedgerPayload.skipped.workItems).toBe(0);
    const importedLedgerState = parseJson<{
      readonly operations: Array<{ readonly commandPath: string }>;
    }>(await readFile(join(ledgerTargetDir, ".boreal/runtime/state.json"), "utf8"));
    expect(importedLedgerState.operations.map((operation) => operation.commandPath)).not.toEqual(
      expect.arrayContaining(["work create", "evidence add", "source add", "context rebuild"])
    );

    const importedLedgersAgain = await runCli(ledgerTargetDir, [
      "import",
      "ledgers",
      "--from",
      join(rootDir, ".boreal/ledgers"),
      "--allow-external-read",
      "--json"
    ]);
    expect(parseData<{ readonly skipped: { readonly workItems: number } }>(importedLedgersAgain.stdout).skipped.workItems).toBe(1);

    await runCli(rootDir, ["export", "ledgers", "--out", "tampered-ledgers", "--json"]);
    await writeFile(
      join(rootDir, "tampered-ledgers", "deletions.jsonl"),
      '{"schemaVersion":"boreal.ledger-deletion.v1","section":"workItems","id":"bw_work_deleted","deletedAt":"2026-01-01T00:00:00.000Z"}\n',
      "utf8"
    );
    const tamperedDeletionImport = await runCli(rootDir, [
      "import",
      "ledgers",
      "--from",
      "tampered-ledgers",
      "--json"
    ]);
    const tamperedDeletionPayload = parseJson<{ readonly ok: false; readonly code: string; readonly message: string }>(
      tamperedDeletionImport.stderr
    );
    expect(tamperedDeletionImport.exitCode).toBe(2);
    expect(tamperedDeletionPayload.code).toBe("BOREAL_INVALID_INPUT");
    expect(tamperedDeletionPayload.message).toContain("Ledger deletions count does not match manifest");

    const outsideDir = await makeTempWorkspace();
    await symlink(outsideDir, join(rootDir, "linked-out"), "dir");
    const symlinkedExport = await runCli(rootDir, ["export", "markdown", "--out", "linked-out/markdown", "--json"]);
    const symlinkedExportPayload = parseJson<{ readonly ok: false; readonly code: string; readonly message: string }>(
      symlinkedExport.stderr
    );
    expect(symlinkedExport.exitCode).toBe(2);
    expect(symlinkedExportPayload.code).toBe("BOREAL_INVALID_INPUT");
    expect(symlinkedExportPayload.message).toContain("Path escapes Boreal workspace");

    const currentExport = await runCli(rootDir, ["export", "json", "--out", "current-export.json", "--json"]);
    const currentExportPayload = parseData<{ readonly contentHash: string }>(currentExport.stdout);
    expect(currentExport.exitCode).toBe(0);

    const snapshot = await runCli(rootDir, ["snapshot", "create", "--name", "baseline", "--json"]);
    const snapshotPayload = parseData<{ readonly id: string; readonly contentHash: string }>(snapshot.stdout);
    expect(snapshotPayload.id).toContain("baseline");
    expect(snapshotPayload.contentHash).toBe(currentExportPayload.contentHash);

    const snapshots = await runCli(rootDir, ["snapshot", "list", "--json"]);
    expect(parseData<Array<{ readonly id: string }>>(snapshots.stdout).map((entry) => entry.id)).toContain(
      snapshotPayload.id
    );

    const shown = await runCli(rootDir, ["snapshot", "show", snapshotPayload.id, "--json"]);
    expect(parseData<{ readonly contentHash: string }>(shown.stdout).contentHash).toBe(currentExportPayload.contentHash);

    await runCli(rootDir, ["work", "create", "Ledger drift work", "--json"]);
    const staleLedgerStatus = await runCli(rootDir, ["ledger", "status", "--json"]);
    const staleLedgerPayload = parseData<{ readonly ok: boolean; readonly exists: boolean; readonly stale: boolean }>(
      staleLedgerStatus.stdout
    );
    expect(staleLedgerStatus.exitCode).toBe(1);
    expect(staleLedgerPayload).toEqual(expect.objectContaining({ ok: false, exists: true, stale: true }));

    const staleSync = await runCli(rootDir, ["sync", "status", "--json"]);
    const staleSyncPayload = parseData<{
      readonly ok: boolean;
      readonly ledgers: { readonly ok: boolean; readonly stale: boolean };
      readonly searchIndex: { readonly ok: boolean; readonly stale: boolean };
      readonly recommendedActions: readonly string[];
    }>(staleSync.stdout);
    expect(staleSync.exitCode).toBe(1);
    expect(staleSyncPayload).toEqual(
      expect.objectContaining({
        ok: false,
        ledgers: expect.objectContaining({ ok: false, stale: true }),
        searchIndex: expect.objectContaining({ ok: false, stale: true }),
        recommendedActions: ["bwrk sync refresh --json"]
      })
    );

    const staleDoctor = await runCli(rootDir, ["doctor", "--json"]);
    const staleDoctorPayload = parseData<{
      readonly diagnostics: Array<{
        readonly code: string;
        readonly severity: string;
        readonly details?: { readonly repairCommand?: string; readonly repairNote?: string };
      }>;
    }>(staleDoctor.stdout);
    expect(staleDoctorPayload.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "ledger.export_drift",
          severity: "warning",
          details: expect.objectContaining({ repairCommand: "bwrk sync refresh --json" })
        }),
        expect.objectContaining({
          code: "snapshot.export_drift",
          severity: "warning",
          details: expect.objectContaining({
            repairCommand: "bwrk snapshot create --json",
            repairNote: expect.stringContaining("explicit snapshot baseline")
          })
        })
      ])
    );

    const driftRefresh = await runCli(rootDir, ["sync", "refresh", "--json"]);
    const driftRefreshPayload = parseData<{
      readonly refreshed: true;
      readonly refreshOk: true;
      readonly postRefreshStatusOk: boolean;
      readonly exitReason: string;
      readonly status: {
        readonly ok: boolean;
        readonly ledgers: { readonly ok: boolean; readonly stale: boolean };
        readonly searchIndex: { readonly ok: boolean; readonly stale: boolean };
        readonly recommendedActions: readonly string[];
      };
    }>(driftRefresh.stdout);
    expect(driftRefresh.exitCode).toBe(0);
    expect(driftRefreshPayload.refreshOk).toBe(true);
    expect(driftRefreshPayload.postRefreshStatusOk).toBe(true);
    expect(driftRefreshPayload.exitReason).toBe("ok");
    expect(driftRefreshPayload.status).toEqual(
      expect.objectContaining({
        ok: true,
        ledgers: expect.objectContaining({ ok: true, stale: false }),
        searchIndex: expect.objectContaining({ ok: true, stale: false }),
        recommendedActions: []
      })
    );

    const targetDir = await makeTempWorkspace();
    await runCli(targetDir, ["init", "--json"]);
    const blockedExternalImport = await runCli(targetDir, ["import", "json", "--from", exportPath, "--json"]);
    const blockedExternalPayload = parseJson<{ readonly ok: false; readonly code: string; readonly message: string }>(
      blockedExternalImport.stderr
    );
    expect(blockedExternalImport.exitCode).toBe(2);
    expect(blockedExternalPayload.code).toBe("BOREAL_INVALID_INPUT");
    expect(blockedExternalPayload.message).toContain("Path escapes Boreal workspace");

    const imported = await runCli(targetDir, ["import", "json", "--from", exportPath, "--allow-external-read", "--json"]);
    const importPayload = parseData<{ readonly imported: { readonly workItems: number }; readonly skipped: { readonly workItems: number } }>(
      imported.stdout
    );
    expect(importPayload.imported.workItems).toBe(1);
    expect(importPayload.skipped.workItems).toBe(0);
    const importedState = parseJson<{
      readonly events: Array<{ readonly type: string; readonly subjectId: string; readonly operationId?: string; readonly operationLink?: string }>;
      readonly operations: Array<{ readonly commandPath: string }>;
    }>(await readFile(join(targetDir, ".boreal/runtime/state.json"), "utf8"));
    expect(importedState.operations.map((operation) => operation.commandPath)).not.toEqual(
      expect.arrayContaining(["work create", "evidence add", "source add", "context rebuild"])
    );
    const importedWorkCreatedEvent = importedState.events.find(
      (event) => event.type === "work.created" && event.subjectId === work.meta.id
    );
    expect(importedWorkCreatedEvent).toEqual(
      expect.objectContaining({ type: "work.created", subjectId: work.meta.id })
    );
    expect(importedWorkCreatedEvent?.operationId).toBeUndefined();
    expect(importedWorkCreatedEvent?.operationLink).toBeUndefined();

    const importedAgain = await runCli(targetDir, ["import", "json", "--from", exportPath, "--allow-external-read", "--json"]);
    expect(parseData<{ readonly skipped: { readonly workItems: number } }>(importedAgain.stdout).skipped.workItems).toBe(1);

    const importedDoctor = await runCli(targetDir, ["doctor", "--json"]);
    expect(importedDoctor.exitCode).toBe(0);
    expect(parseData<{ readonly ok: boolean }>(importedDoctor.stdout).ok).toBe(true);

    const importedIndex = await runCli(targetDir, ["search", "index", "--json"]);
    expect(parseData<{ readonly documentCount: number }>(importedIndex.stdout).documentCount).toBeGreaterThan(0);
    const importedSearch = await runCli(targetDir, ["search", "query", "Export source", "--json"]);
    expect(parseData<Array<{ readonly type: string; readonly title: string }>>(importedSearch.stdout)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "source", title: "Export source" })])
    );
    const importedContextSearch = await runCli(targetDir, ["context", "search", "export import test passed", "--json"]);
    expect(parseData<Array<{ readonly type: string }>>(importedContextSearch.stdout).map((result) => result.type)).toContain(
      "context_pack"
    );

    const conflictingPath = join(rootDir, "conflicting-export.json");
    const conflicting = {
      schemaVersion: "boreal.file-store.v1",
      ...exportDocument.state,
      workItems: exportDocument.state.workItems.map((item) =>
        item.meta.id === work.meta.id ? { ...item, title: "Conflicting title" } : item
      )
    };
    await writeFile(conflictingPath, `${JSON.stringify(conflicting, null, 2)}\n`, "utf8");
    const conflict = await runCli(rootDir, ["import", "json", "--from", conflictingPath, "--json"]);
    const conflictPayload = parseJson<{ readonly ok: false; readonly code: string }>(conflict.stderr);
    expect(conflict.exitCode).toBe(1);
    expect(conflictPayload.code).toBe("BOREAL_CONFLICT");

    const danglingPath = join(rootDir, "dangling-export.json");
    const dangling = {
      schemaVersion: "boreal.file-store.v1",
      ...exportDocument.state,
      workItems: exportDocument.state.workItems.map((item) =>
        item.meta.id === work.meta.id ? { ...item, dependencyIds: ["bw_work_deadbeefdead"] } : item
      )
    };
    await writeFile(danglingPath, `${JSON.stringify(dangling, null, 2)}\n`, "utf8");
    const danglingImport = await runCli(targetDir, ["import", "json", "--from", danglingPath, "--allow-external-read", "--json"]);
    const danglingPayload = parseJson<{ readonly ok: false; readonly code: string }>(danglingImport.stderr);
    expect(danglingImport.exitCode).toBe(2);
    expect(danglingPayload.code).toBe("BOREAL_INVALID_INPUT");

    await writeFile(join(rootDir, ".boreal/ledgers/work-items.jsonl"), `${workLedger}{"bad":true}\n`, "utf8");
    const tamperedLedgerImport = await runCli(targetDir, [
      "import",
      "ledgers",
      "--from",
      join(rootDir, ".boreal/ledgers"),
      "--allow-external-read",
      "--json"
    ]);
    const tamperedLedgerPayload = parseJson<{ readonly ok: false; readonly code: string; readonly message: string }>(
      tamperedLedgerImport.stderr
    );
    expect(tamperedLedgerImport.exitCode).toBe(2);
    expect(tamperedLedgerPayload.code).toBe("BOREAL_INVALID_INPUT");
    expect(tamperedLedgerPayload.message).toContain("Ledger file content hash does not match manifest");

    const malformedSchemaPath = join(rootDir, "malformed-schema-export.json");
    await writeFile(
      malformedSchemaPath,
      `${JSON.stringify(
        emptyFileStoreState({
          workItems: [
            {
              meta: {
                id: "bw_work_deadbeefdead",
                schemaVersion: "boreal.runtime.v1",
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
                createdBy: {},
                updatedBy: {},
                sourceRefs: [],
                tags: []
              },
              kind: "task",
              title: "Malformed imported status",
              description: "",
              status: "not_ready",
              priority: "normal",
              acceptanceCriteria: [],
              labels: [],
              dependencyIds: [],
              evidenceIds: [],
              verificationIds: []
            }
          ]
        }),
        null,
        2
      )}\n`,
      "utf8"
    );
    const malformedImport = await runCli(targetDir, [
      "import",
      "json",
      "--from",
      malformedSchemaPath,
      "--allow-external-read",
      "--json"
    ]);
    const malformedPayload = parseJson<{ readonly ok: false; readonly code: string; readonly message: string }>(
      malformedImport.stderr
    );
    expect(malformedImport.exitCode).toBe(2);
    expect(malformedPayload.code).toBe("BOREAL_INVALID_INPUT");
    expect(malformedPayload.message).toContain("schema validation");
  });

  it("reports non-blocking git caveats on protected git branches", async () => {
    const rootDir = await makeTempWorkspace();
    if (!(await gitAvailable(rootDir))) {
      return;
    }

    await initGitRepository(rootDir, "main");
    await runCli(rootDir, ["init", "--json"]);
    await runCli(rootDir, ["vault", "init", "--json"]);
    await runCli(rootDir, ["work", "create", "Protected branch ledger work", "--ready", "--json"]);
    await runCli(rootDir, ["export", "ledgers", "--json"]);
    await runCli(rootDir, ["search", "index", "--json"]);

    const protectedStatus = await runCli(rootDir, ["sync", "status", "--json"]);
    const protectedPayload = parseData<{
      readonly ok: boolean;
      readonly ledgers: { readonly ok: boolean };
      readonly searchIndex: { readonly ok: boolean };
      readonly git: {
        readonly ok: boolean;
        readonly insideWorktree: boolean;
        readonly branch?: string;
        readonly protectedBranch: boolean;
        readonly collaborationDirtyPaths: readonly Array<{ readonly path: string }>;
        readonly blockingDirtyPaths: readonly Array<{ readonly path: string }>;
        readonly findings: readonly Array<{
          readonly category: string;
          readonly blocking: boolean;
          readonly path?: string;
        }>;
      };
      readonly recommendedActions: readonly string[];
    }>(protectedStatus.stdout);
    expect(protectedStatus.exitCode).toBe(0);
    expect(protectedPayload).toEqual(
      expect.objectContaining({
        ok: true,
        ledgers: expect.objectContaining({ ok: true }),
        searchIndex: expect.objectContaining({ ok: true }),
        git: expect.objectContaining({
          ok: true,
          insideWorktree: true,
          branch: "main",
          protectedBranch: true
        }),
        recommendedActions: expect.arrayContaining(["bwrk doctor --fix --json", "git switch -c boreal/sync-work"])
      })
    );
    expect(protectedPayload.git.collaborationDirtyPaths.map((entry) => entry.path).join("\n")).toContain(
      ".boreal/ledgers"
    );
    expect(protectedPayload.git.blockingDirtyPaths).toEqual([]);
    expect(protectedPayload.git.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "protected_branch", blocking: false }),
        expect.objectContaining({ category: "dirty_generated_artifact", blocking: false }),
        expect.objectContaining({ category: "dirty_collaboration_path", blocking: false })
      ])
    );

    const protectedRefresh = await runCli(rootDir, ["sync", "refresh", "--json"]);
    const protectedRefreshPayload = parseData<{
      readonly refreshed: true;
      readonly refreshOk: true;
      readonly postRefreshStatusOk: boolean;
      readonly exitReason: string;
      readonly ledgers: { readonly recordCounts: { readonly workItems: number } };
      readonly status: {
        readonly ok: boolean;
        readonly ledgers: { readonly ok: boolean };
        readonly searchIndex: { readonly ok: boolean };
        readonly git: { readonly ok: boolean; readonly protectedBranch: boolean };
        readonly recommendedActions: readonly string[];
      };
    }>(protectedRefresh.stdout);
    expect(protectedRefresh.exitCode).toBe(0);
    expect(protectedRefreshPayload).toEqual(
      expect.objectContaining({
        refreshed: true,
        refreshOk: true,
        postRefreshStatusOk: true,
        exitReason: "ok",
        status: expect.objectContaining({
          ok: true,
          ledgers: expect.objectContaining({ ok: true }),
          searchIndex: expect.objectContaining({ ok: true }),
          git: expect.objectContaining({ ok: true, protectedBranch: true }),
          recommendedActions: expect.arrayContaining(["bwrk doctor --fix --json", "git switch -c boreal/sync-work"])
        })
      })
    );

    const doctor = await runCli(rootDir, ["doctor", "--json"]);
    const doctorPayload = parseData<{
      readonly ok: boolean;
      readonly diagnostics: Array<{ readonly code: string; readonly severity: string }>;
    }>(doctor.stdout);
    expect(doctor.exitCode).toBe(0);
    expect(doctorPayload.ok).toBe(true);
    expect(doctorPayload.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "git.worktree", severity: "ok" })])
    );

    const strictDoctor = await runCli(rootDir, ["doctor", "--strict", "--json"]);
    expect(strictDoctor.exitCode).toBe(0);

    await runGit(rootDir, ["checkout", "-b", "feature/sync-work"]);
    const featureStatus = await runCli(rootDir, ["sync", "status", "--json"]);
    const featurePayload = parseData<{
      readonly ok: boolean;
      readonly git: { readonly ok: boolean; readonly branch?: string; readonly protectedBranch: boolean };
      readonly recommendedActions: readonly string[];
    }>(featureStatus.stdout);
    expect(featureStatus.exitCode).toBe(0);
    expect(featurePayload).toEqual(
      expect.objectContaining({
        ok: true,
        git: expect.objectContaining({ ok: true, branch: "feature/sync-work", protectedBranch: false }),
        recommendedActions: expect.arrayContaining(["bwrk doctor --fix --json"])
      })
    );
    expect(featurePayload.recommendedActions).not.toContain("git switch -c boreal/sync-work");
  });

  it("classifies memory raw index changes as non-blocking git caveats", async () => {
    const rootDir = await makeTempWorkspace();
    if (!(await gitAvailable(rootDir))) {
      return;
    }

    await initGitRepository(rootDir, "main");
    await runCli(rootDir, [
      "init",
      "--setup-memory",
      "--memory-root",
      "memory",
      "--memory-layout",
      "in-repo",
      "--memory-git-mode",
      "shared",
      "--json"
    ]);
    await runCli(rootDir, ["work", "create", "Tracked memory index work", "--ready", "--json"]);
    await runCli(rootDir, ["sync", "refresh", "--json"]);
    await runGit(rootDir, ["add", "."]);
    await runGit(rootDir, ["commit", "-m", "Commit initialized Boreal workspace"]);
    await writeFile(join(rootDir, "memory/raw/index.jsonl"), "\n", "utf8");

    const status = await runCli(rootDir, ["sync", "status", "--json"]);
    const payload = parseData<{
      readonly ok: boolean;
      readonly git: {
        readonly ok: boolean;
        readonly blockingDirtyPaths: readonly Array<{ readonly path: string }>;
        readonly findings: readonly Array<{
          readonly category: string;
          readonly blocking: boolean;
          readonly path?: string;
          readonly recommendedActions: readonly string[];
        }>;
      };
      readonly recommendedActions: readonly string[];
    }>(status.stdout);

    expect(status.exitCode).toBe(0);
    expect(payload.ok).toBe(true);
    expect(payload.git.ok).toBe(true);
    expect(payload.git.blockingDirtyPaths).toEqual([]);
    expect(payload.git.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "dirty_memory_index",
          blocking: false,
          path: "memory/raw/index.jsonl",
          recommendedActions: expect.arrayContaining(["git switch -c boreal/sync-work"])
        })
      ])
    );
    expect(payload.recommendedActions).toEqual(expect.arrayContaining(["git switch -c boreal/sync-work"]));

    const strictDoctor = await runCli(rootDir, ["doctor", "--strict", "--json"]);
    expect(strictDoctor.exitCode).toBe(0);
  });

  it("deletes supported unreferenced records through tombstoned ledgers and blocks referenced deletions", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);

    const referencedSource = parseData<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "source",
          "add",
          "--title",
          "Referenced source",
          "--uri",
          "file://referenced.md",
          "--json"
        ])
      ).stdout
    );
    await runCli(rootDir, [
      "claim",
      "create",
      "--statement",
      "Referenced source must stay.",
      "--source",
      referencedSource.meta.id,
      "--json"
    ]);
    const blockedDelete = await runCli(rootDir, [
      "ledger",
      "delete",
      "source",
      referencedSource.meta.id,
      "--reason",
      "cleanup",
      "--json"
    ]);
    const blockedPayload = parseJson<{ readonly ok: false; readonly code: string; readonly message: string }>(
      blockedDelete.stderr
    );
    expect(blockedDelete.exitCode).toBe(1);
    expect(blockedPayload.code).toBe("BOREAL_CONFLICT");
    expect(blockedPayload.message).toContain("records reference it");

    const deletableSource = parseData<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "source",
          "add",
          "--title",
          "Duplicate source",
          "--uri",
          "file://duplicate.md",
          "--json"
        ])
      ).stdout
    );
    const deleted = await runCli(rootDir, [
      "ledger",
      "delete",
      "source",
      deletableSource.meta.id,
      "--reason",
      "duplicate",
      "--json"
    ]);
    const deletedPayload = parseData<{
      readonly deleted: true;
      readonly section: string;
      readonly id: string;
      readonly tombstone: { readonly section: string; readonly id: string; readonly reason?: string };
      readonly ledger: { readonly deletedRecordCounts: { readonly knowledgeSources: number } };
    }>(deleted.stdout);
    expect(deleted.exitCode).toBe(0);
    expect(deletedPayload).toEqual(
      expect.objectContaining({
        deleted: true,
        section: "knowledgeSources",
        id: deletableSource.meta.id,
        tombstone: expect.objectContaining({
          section: "knowledgeSources",
          id: deletableSource.meta.id,
          reason: "duplicate"
        })
      })
    );
    expect(deletedPayload.ledger.deletedRecordCounts.knowledgeSources).toBe(1);

    const graphProtectedClaim = parseData<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "claim",
          "create",
          "--statement",
          "Graph-referenced claim must stay.",
          "--json"
        ])
      ).stdout
    );
    await appendGraphEdge(rootDir, {
      id: "bw_edge_111111111111",
      fromId: "manual-node",
      fromType: "external",
      toId: graphProtectedClaim.meta.id,
      toType: "claims"
    });
    const blockedClaimDelete = await runCli(rootDir, [
      "ledger",
      "delete",
      "claim",
      graphProtectedClaim.meta.id,
      "--json"
    ]);
    const blockedClaimPayload = parseJson<{ readonly ok: false; readonly code: string; readonly message: string }>(
      blockedClaimDelete.stderr
    );
    expect(blockedClaimDelete.exitCode).toBe(1);
    expect(blockedClaimPayload.code).toBe("BOREAL_CONFLICT");
    expect(blockedClaimPayload.message).toContain("graph edges reference it");

    const deletableClaim = parseData<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "claim",
          "create",
          "--statement",
          "Duplicate claim can be tombstoned.",
          "--json"
        ])
      ).stdout
    );
    const deletedClaim = await runCli(rootDir, [
      "ledger",
      "delete",
      "claim",
      deletableClaim.meta.id,
      "--reason",
      "duplicate-claim",
      "--json"
    ]);
    const deletedClaimPayload = parseData<{
      readonly section: string;
      readonly id: string;
      readonly ledger: { readonly deletedRecordCounts: { readonly claims: number } };
    }>(deletedClaim.stdout);
    expect(deletedClaim.exitCode).toBe(0);
    expect(deletedClaimPayload).toEqual(
      expect.objectContaining({
        section: "claims",
        id: deletableClaim.meta.id
      })
    );
    expect(deletedClaimPayload.ledger.deletedRecordCounts.claims).toBe(1);

    const graphProtectedDecision = parseData<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "decision",
          "create",
          "--title",
          "Graph-referenced decision",
          "--decision",
          "Keep the decision while a graph edge references it.",
          "--json"
        ])
      ).stdout
    );
    await appendGraphEdge(rootDir, {
      id: "bw_edge_222222222222",
      fromId: graphProtectedDecision.meta.id,
      fromType: "decisions",
      toId: "manual-node",
      toType: "external"
    });
    const blockedDecisionDelete = await runCli(rootDir, [
      "ledger",
      "delete",
      "decision",
      graphProtectedDecision.meta.id,
      "--json"
    ]);
    const blockedDecisionPayload = parseJson<{ readonly ok: false; readonly code: string; readonly message: string }>(
      blockedDecisionDelete.stderr
    );
    expect(blockedDecisionDelete.exitCode).toBe(1);
    expect(blockedDecisionPayload.code).toBe("BOREAL_CONFLICT");
    expect(blockedDecisionPayload.message).toContain("graph edges reference it");

    const deletableDecision = parseData<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "decision",
          "create",
          "--title",
          "Duplicate decision",
          "--decision",
          "Delete the duplicate decision.",
          "--json"
        ])
      ).stdout
    );
    const deletedDecision = await runCli(rootDir, [
      "ledger",
      "delete",
      "decision",
      deletableDecision.meta.id,
      "--reason",
      "duplicate-decision",
      "--json"
    ]);
    const deletedDecisionPayload = parseData<{
      readonly section: string;
      readonly id: string;
      readonly ledger: { readonly deletedRecordCounts: { readonly decisions: number } };
    }>(deletedDecision.stdout);
    expect(deletedDecision.exitCode).toBe(0);
    expect(deletedDecisionPayload).toEqual(
      expect.objectContaining({
        section: "decisions",
        id: deletableDecision.meta.id
      })
    );
    expect(deletedDecisionPayload.ledger.deletedRecordCounts.decisions).toBe(1);

    const deletableWork = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Tombstoned work", "--ready", "--json"])).stdout
    );
    const attachedEvidence = parseData<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "evidence",
          "add",
          deletableWork.meta.id,
          "--summary",
          "Evidence blocks tombstone deletion while attached.",
          "--kind",
          "test",
          "--outcome",
          "passed",
          "--json"
        ])
      ).stdout
    );
    const blockedEvidenceDelete = await runCli(rootDir, [
      "ledger",
      "delete",
      "evidence",
      attachedEvidence.meta.id,
      "--json"
    ]);
    const blockedEvidencePayload = parseJson<{ readonly ok: false; readonly code: string; readonly message: string }>(
      blockedEvidenceDelete.stderr
    );
    expect(blockedEvidenceDelete.exitCode).toBe(1);
    expect(blockedEvidencePayload.code).toBe("BOREAL_CONFLICT");
    expect(blockedEvidencePayload.message).toContain("records reference it");

    const attachedVerification = parseData<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "work",
          "verify",
          deletableWork.meta.id,
          "--evidence",
          attachedEvidence.meta.id,
          "--json"
        ])
      ).stdout
    );
    const blockedVerificationDelete = await runCli(rootDir, [
      "ledger",
      "delete",
      "verification",
      attachedVerification.meta.id,
      "--json"
    ]);
    const blockedVerificationPayload = parseJson<{ readonly ok: false; readonly code: string; readonly message: string }>(
      blockedVerificationDelete.stderr
    );
    expect(blockedVerificationDelete.exitCode).toBe(1);
    expect(blockedVerificationPayload.code).toBe("BOREAL_CONFLICT");
    expect(blockedVerificationPayload.message).toContain("records reference it");

    const blockedWorkDelete = await runCli(rootDir, [
      "ledger",
      "delete",
      "work",
      deletableWork.meta.id,
      "--json"
    ]);
    const blockedWorkPayload = parseJson<{ readonly ok: false; readonly code: string; readonly message: string }>(
      blockedWorkDelete.stderr
    );
    expect(blockedWorkDelete.exitCode).toBe(1);
    expect(blockedWorkPayload.code).toBe("BOREAL_CONFLICT");
    expect(blockedWorkPayload.message).toContain("records reference it");

    await updateState(rootDir, (state) => ({
      ...state,
      workItems: state.workItems.map((work) =>
        work.meta.id === deletableWork.meta.id ? { ...work, evidenceIds: [], verificationIds: [] } : work
      )
    }));

    const deletedVerification = await runCli(rootDir, [
      "ledger",
      "delete",
      "verification",
      attachedVerification.meta.id,
      "--reason",
      "duplicate-verification",
      "--json"
    ]);
    const deletedVerificationPayload = parseData<{
      readonly section: string;
      readonly id: string;
      readonly ledger: { readonly deletedRecordCounts: { readonly verifications: number } };
    }>(deletedVerification.stdout);
    expect(deletedVerification.exitCode).toBe(0);
    expect(deletedVerificationPayload).toEqual(
      expect.objectContaining({
        section: "verifications",
        id: attachedVerification.meta.id
      })
    );
    expect(deletedVerificationPayload.ledger.deletedRecordCounts.verifications).toBe(1);

    const deletedEvidence = await runCli(rootDir, [
      "ledger",
      "delete",
      "evidence",
      attachedEvidence.meta.id,
      "--reason",
      "duplicate-evidence",
      "--json"
    ]);
    const deletedEvidencePayload = parseData<{
      readonly section: string;
      readonly id: string;
      readonly ledger: { readonly deletedRecordCounts: { readonly evidence: number } };
    }>(deletedEvidence.stdout);
    expect(deletedEvidence.exitCode).toBe(0);
    expect(deletedEvidencePayload).toEqual(
      expect.objectContaining({
        section: "evidence",
        id: attachedEvidence.meta.id
      })
    );
    expect(deletedEvidencePayload.ledger.deletedRecordCounts.evidence).toBe(1);

    const deletedWork = await runCli(rootDir, [
      "ledger",
      "delete",
      "work",
      deletableWork.meta.id,
      "--reason",
      "duplicate-work",
      "--json"
    ]);
    const deletedWorkPayload = parseData<{
      readonly section: string;
      readonly id: string;
      readonly ledger: { readonly deletedRecordCounts: { readonly workItems: number } };
    }>(deletedWork.stdout);
    expect(deletedWork.exitCode).toBe(0);
    expect(deletedWorkPayload).toEqual(
      expect.objectContaining({
        section: "workItems",
        id: deletableWork.meta.id
      })
    );
    expect(deletedWorkPayload.ledger.deletedRecordCounts.workItems).toBe(1);

    const graphBlocker = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Ledger delete graph blocker", "--ready", "--json"])).stdout
    );
    const graphBlocked = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Ledger delete graph blocked", "--ready", "--json"])).stdout
    );
    await runCli(rootDir, ["dep", "add", graphBlocked.meta.id, graphBlocker.meta.id, "--json"]);
    const blockState = await readState<{
      readonly graphEdges: Array<{ readonly meta: { readonly id: string }; readonly kind: string; readonly fromId: string; readonly toId: string }>;
    }>(rootDir);
    const blockEdge = blockState.graphEdges.find(
      (edge) => edge.kind === "blocks" && edge.fromId === graphBlocker.meta.id && edge.toId === graphBlocked.meta.id
    );
    expect(blockEdge).toBeDefined();
    const deletedGraphEdge = await runCli(rootDir, [
      "ledger",
      "delete",
      "graph-edge",
      blockEdge?.meta.id ?? "",
      "--reason",
      "remove-block",
      "--json"
    ]);
    const deletedGraphEdgePayload = parseData<{
      readonly section: string;
      readonly id: string;
      readonly ledger: { readonly deletedRecordCounts: { readonly graphEdges: number } };
    }>(deletedGraphEdge.stdout);
    expect(deletedGraphEdge.exitCode).toBe(0);
    expect(deletedGraphEdgePayload).toEqual(
      expect.objectContaining({
        section: "graphEdges",
        id: blockEdge?.meta.id
      })
    );
    expect(deletedGraphEdgePayload.ledger.deletedRecordCounts.graphEdges).toBe(1);
    const unblockedWork = parseData<{ readonly status: string; readonly blockedBy: readonly string[] }>(
      (await runCli(rootDir, ["work", "show", graphBlocked.meta.id, "--json"])).stdout
    );
    expect(unblockedWork).toEqual(expect.objectContaining({ status: "ready", blockedBy: [] }));

    const reservationWork = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Ledger delete reservation", "--ready", "--json"])).stdout
    );
    await runCli(rootDir, ["work", "reserve", reservationWork.meta.id, "--agent", "reservation-delete-test", "--json"]);
    const activeReservationState = await readState<{
      readonly reservations: Array<{ readonly meta: { readonly id: string }; readonly workId: string; readonly status: string }>;
    }>(rootDir);
    const activeReservation = activeReservationState.reservations.find(
      (reservation) => reservation.workId === reservationWork.meta.id
    );
    expect(activeReservation).toBeDefined();
    const blockedReservationDelete = await runCli(rootDir, [
      "ledger",
      "delete",
      "reservation",
      activeReservation?.meta.id ?? "",
      "--json"
    ]);
    const blockedReservationPayload = parseJson<{ readonly ok: false; readonly code: string; readonly message: string }>(
      blockedReservationDelete.stderr
    );
    expect(blockedReservationDelete.exitCode).toBe(1);
    expect(blockedReservationPayload.code).toBe("BOREAL_CONFLICT");
    expect(blockedReservationPayload.message).toContain("active or referenced");

    await runCli(rootDir, ["work", "release", reservationWork.meta.id, "--json"]);
    const deletedReservation = await runCli(rootDir, [
      "ledger",
      "delete",
      "reservation",
      activeReservation?.meta.id ?? "",
      "--reason",
      "released-cleanup",
      "--json"
    ]);
    const deletedReservationPayload = parseData<{
      readonly section: string;
      readonly id: string;
      readonly ledger: { readonly deletedRecordCounts: { readonly reservations: number } };
    }>(deletedReservation.stdout);
    expect(deletedReservation.exitCode).toBe(0);
    expect(deletedReservationPayload).toEqual(
      expect.objectContaining({
        section: "reservations",
        id: activeReservation?.meta.id
      })
    );
    expect(deletedReservationPayload.ledger.deletedRecordCounts.reservations).toBe(1);

    const projectionWork = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Ledger delete generated projection", "--ready", "--json"])).stdout
    );
    await runCli(rootDir, ["context", "rebuild", "--json"]);
    const generatedState = await readState<{
      readonly projections: Array<{ readonly meta: { readonly id: string }; readonly subjectId: string }>;
      readonly contextPacks: Array<{ readonly id: string; readonly subjectId: string }>;
    }>(rootDir);
    const projection = generatedState.projections.find((record) => record.subjectId === projectionWork.meta.id);
    const contextPack = generatedState.contextPacks.find((record) => record.subjectId === projectionWork.meta.id);
    expect(projection).toBeDefined();
    expect(contextPack).toBeDefined();
    const deletedProjection = await runCli(rootDir, [
      "ledger",
      "delete",
      "projection",
      projection?.meta.id ?? "",
      "--reason",
      "generated-cleanup",
      "--json"
    ]);
    const deletedProjectionPayload = parseData<{
      readonly section: string;
      readonly id: string;
      readonly ledger: { readonly deletedRecordCounts: { readonly projections: number } };
    }>(deletedProjection.stdout);
    expect(deletedProjection.exitCode).toBe(0);
    expect(deletedProjectionPayload).toEqual(
      expect.objectContaining({
        section: "projections",
        id: projection?.meta.id
      })
    );
    expect(deletedProjectionPayload.ledger.deletedRecordCounts.projections).toBe(1);

    const deletedContextPack = await runCli(rootDir, [
      "ledger",
      "delete",
      "context-pack",
      contextPack?.id ?? "",
      "--reason",
      "generated-cleanup",
      "--json"
    ]);
    const deletedContextPackPayload = parseData<{
      readonly section: string;
      readonly id: string;
      readonly ledger: { readonly deletedRecordCounts: { readonly contextPacks: number } };
    }>(deletedContextPack.stdout);
    expect(deletedContextPack.exitCode).toBe(0);
    expect(deletedContextPackPayload).toEqual(
      expect.objectContaining({
        section: "contextPacks",
        id: contextPack?.id
      })
    );
    expect(deletedContextPackPayload.ledger.deletedRecordCounts.contextPacks).toBe(1);

    const tombstoneAwareRebuild = await runCli(rootDir, ["context", "rebuild", "--json"]);
    expect(tombstoneAwareRebuild.exitCode).toBe(0);
    const rebuiltGeneratedState = await readState<{
      readonly projections: Array<{ readonly meta: { readonly id: string } }>;
      readonly contextPacks: Array<{ readonly id: string }>;
    }>(rootDir);
    expect(rebuiltGeneratedState.projections.map((record) => record.meta.id)).not.toContain(projection?.meta.id);
    expect(rebuiltGeneratedState.contextPacks.map((record) => record.id)).not.toContain(contextPack?.id);
    const refreshedLedgerExport = await runCli(rootDir, ["export", "ledgers", "--json"]);
    expect(refreshedLedgerExport.exitCode).toBe(0);
    expect(
      parseData<{ readonly deletedRecordCounts: { readonly projections: number; readonly contextPacks: number } }>(
        refreshedLedgerExport.stdout
      ).deletedRecordCounts
    ).toEqual(expect.objectContaining({ projections: 1, contextPacks: 1 }));
    const tombstoneAwareDoctor = await runCli(rootDir, ["doctor", "--json"]);
    const tombstoneAwareDoctorPayload = parseData<{
      readonly diagnostics: Array<{ readonly code: string; readonly severity: string }>;
    }>(tombstoneAwareDoctor.stdout);
    expect(tombstoneAwareDoctor.exitCode).toBe(0);
    expect(tombstoneAwareDoctorPayload.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "projection.context_pack", severity: "ok" })])
    );

    const sources = parseData<Array<{ readonly id: string }>>((await runCli(rootDir, ["source", "list", "--json"])).stdout);
    expect(sources.map((source) => source.id)).toContain(referencedSource.meta.id);
    expect(sources.map((source) => source.id)).not.toContain(deletableSource.meta.id);
    const workItems = parseData<Array<{ readonly id: string }>>((await runCli(rootDir, ["work", "list", "--json"])).stdout);
    expect(workItems.map((work) => work.id)).not.toContain(deletableWork.meta.id);
    const claims = parseData<Array<{ readonly id: string }>>((await runCli(rootDir, ["claim", "list", "--json"])).stdout);
    expect(claims.map((claim) => claim.id)).toContain(graphProtectedClaim.meta.id);
    expect(claims.map((claim) => claim.id)).not.toContain(deletableClaim.meta.id);
    const decisions = parseData<Array<{ readonly id: string }>>((await runCli(rootDir, ["decision", "list", "--json"])).stdout);
    expect(decisions.map((decision) => decision.id)).toContain(graphProtectedDecision.meta.id);
    expect(decisions.map((decision) => decision.id)).not.toContain(deletableDecision.meta.id);
    const deletions = await readFile(join(rootDir, ".boreal/ledgers/deletions.jsonl"), "utf8");
    expect(deletions).toContain(deletableSource.meta.id);
    expect(deletions).toContain(deletableClaim.meta.id);
    expect(deletions).toContain(deletableDecision.meta.id);
    expect(deletions).toContain(attachedVerification.meta.id);
    expect(deletions).toContain(attachedEvidence.meta.id);
    expect(deletions).toContain(deletableWork.meta.id);
    expect(deletions).toContain(blockEdge?.meta.id);
    expect(deletions).toContain(activeReservation?.meta.id);
    expect(deletions).toContain(projection?.meta.id);
    expect(deletions).toContain(contextPack?.id);
    expect(deletions).toContain("\"reason\":\"duplicate\"");

    const status = await runCli(rootDir, ["ledger", "status", "--json"]);
    const statusPayload = parseData<{
      readonly ok: boolean;
      readonly reconstructable: boolean;
      readonly deletedRecordCounts: {
        readonly workItems: number;
        readonly evidence: number;
        readonly verifications: number;
        readonly knowledgeSources: number;
        readonly claims: number;
        readonly decisions: number;
        readonly graphEdges: number;
        readonly reservations: number;
        readonly projections: number;
        readonly contextPacks: number;
      };
    }>(status.stdout);
    expect(status.exitCode).toBe(0);
    expect(statusPayload).toEqual(
      expect.objectContaining({
        ok: true,
        reconstructable: true,
        deletedRecordCounts: expect.objectContaining({
          workItems: 1,
          evidence: 1,
          verifications: 1,
          knowledgeSources: 1,
          claims: 1,
          decisions: 1,
          graphEdges: 1,
          reservations: 1,
          projections: 1,
          contextPacks: 1
        })
      })
    );
  });

  it("keeps explicit workspace paths exact while cwd discovery walks upward", async () => {
    const rootDir = await makeTempWorkspace();
    const childDir = join(rootDir, "nested");
    await mkdir(childDir);
    await runCli(rootDir, ["init", "--json"]);

    const discovered = await runCli(childDir, ["work", "list", "--json"]);
    expect(discovered.exitCode).toBe(0);

    const explicit = await runCli(rootDir, ["work", "list", "--workspace", childDir, "--json"]);
    const payload = parseJson<{ readonly code: string; readonly details: { readonly workspaceRoot: string } }>(
      explicit.stderr
    );
    expect(explicit.exitCode).toBe(2);
    expect(payload.code).toBe("BOREAL_INVALID_INPUT");
    expect(payload.details.workspaceRoot).toBe(childDir);
  });

  it("initializes idempotently under concurrent commands", async () => {
    const rootDir = await makeTempWorkspace();

    const results = await Promise.all([
      runCli(rootDir, ["init", "--json"]),
      runCli(rootDir, ["init", "--json"]),
      runCli(rootDir, ["init", "--json"])
    ]);
    const payloads = results.map((result) => parseData<{ readonly initialized: boolean }>(result.stdout));
    const state = parseJson<{ readonly events: Array<{ readonly type: string }> }>(
      await readFile(join(rootDir, ".boreal/runtime/state.json"), "utf8")
    );

    expect(results.map((result) => result.exitCode)).toEqual([0, 0, 0]);
    expect(payloads.filter((payload) => payload.initialized)).toHaveLength(1);
    expect(state.events.filter((event) => event.type === "workspace.initialized")).toHaveLength(1);
  });

  it("serializes concurrent runtime writers before refreshing search and context projections", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);
    await runCli(rootDir, ["vault", "init", "--json"]);

    const writes = await Promise.all(
      Array.from({ length: 18 }, (_, index) =>
        runCli(rootDir, [
          "work",
          "create",
          `Concurrent projection work ${String(index).padStart(2, "0")}`,
          "--label",
          "concurrent-projection",
          "--ready",
          "--json"
        ])
      )
    );
    const created = writes.map((result) =>
      parseData<{ readonly meta: { readonly id: string }; readonly title: string }>(result.stdout)
    );
    const blocked = created[0];
    const blocker = created[1];
    if (!blocked || !blocker) {
      throw new Error("concurrent writer fixture did not create enough work items");
    }

    expect(writes.map((result) => result.exitCode)).toEqual(Array.from({ length: 18 }, () => 0));
    expect(new Set(created.map((work) => work.meta.id)).size).toBe(18);

    const listed = await runCli(rootDir, [
      "work",
      "list",
      "--label",
      "concurrent-projection",
      "--limit",
      "20",
      "--json"
    ]);
    const listedRows = parseData<Array<{ readonly id: string; readonly title: string }>>(listed.stdout);
    expect(listed.exitCode).toBe(0);
    expect(listedRows).toHaveLength(18);
    expect(new Set(listedRows.map((row) => row.id)).size).toBe(18);

    const dependency = await runCli(rootDir, ["dep", "add", blocked.meta.id, blocker.meta.id, "--json"]);
    expect(dependency.exitCode).toBe(0);
    const shown = parseData<{
      readonly status: string;
      readonly dependencyIds: readonly string[];
      readonly activeBlockerIds: readonly string[];
    }>((await runCli(rootDir, ["work", "show", blocked.meta.id, "--json"])).stdout);
    expect(shown).toEqual(
      expect.objectContaining({
        status: "blocked",
        dependencyIds: [blocker.meta.id],
        activeBlockerIds: [blocker.meta.id]
      })
    );

    const refresh = await runCli(rootDir, ["sync", "refresh", "--json"]);
    const refreshPayload = parseData<{
      readonly contextViews: number;
      readonly searchIndex: { readonly documentCount: number };
      readonly ledgers: { readonly recordCounts: { readonly workItems: number; readonly contextPacks: number } };
    }>(refresh.stdout);
    expect(refresh.exitCode).toBe(0);
    expect(refreshPayload.contextViews).toBeGreaterThanOrEqual(18);
    expect(refreshPayload.searchIndex.documentCount).toBeGreaterThanOrEqual(18);
    expect(refreshPayload.ledgers.recordCounts).toEqual(
      expect.objectContaining({ workItems: 18, contextPacks: 18 })
    );

    const search = await runCli(rootDir, ["search", "query", "Concurrent projection work", "--json"]);
    const searchRows = parseData<Array<{ readonly type: string; readonly title: string }>>(search.stdout);
    expect(search.exitCode).toBe(0);
    expect(searchRows.some((row) => row.type === "work" && row.title.includes("Concurrent projection work"))).toBe(true);

    const context = parseData<{ readonly facts: readonly string[] }>(
      (await runCli(rootDir, ["context", "show", blocked.meta.id, "--json"])).stdout
    );
    expect(context.facts).toContain("status: blocked");

    const doctor = await runCli(rootDir, ["doctor", "--json"]);
    const doctorPayload = parseData<DoctorPayload>(doctor.stdout);
    expect(doctor.exitCode).toBe(0);
    expect(doctorPayload.ok).toBe(true);
    expect(doctorDiagnostic(doctorPayload, "graph.block_consistency")).toEqual(
      expect.objectContaining({ severity: "ok" })
    );
    expect(doctorDiagnostic(doctorPayload, "search.index")).toEqual(expect.objectContaining({ severity: "ok" }));
  });

  it("supports bounded and filtered work lists", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);
    await runCli(rootDir, ["work", "create", "Ready CLI work", "--label", "cli", "--ready", "--json"]);
    await runCli(rootDir, ["work", "create", "Draft CLI work", "--label", "cli", "--json"]);
    await runCli(rootDir, ["work", "create", "Ready docs work", "--label", "docs", "--ready", "--json"]);

    const listed = await runCli(rootDir, [
      "work",
      "list",
      "--status",
      "ready",
      "--label",
      "cli",
      "--limit",
      "1",
      "--json"
    ]);
    const rows = parseData<Array<{ readonly status: string; readonly labels: readonly string[] }>>(listed.stdout);

    expect(listed.exitCode).toBe(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("ready");
    expect(rows[0]?.labels).toContain("cli");
  });

  it("caps high-volume list and search result limits", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);

    for (let index = 0; index < 101; index += 1) {
      await runCli(rootDir, [
        "work",
        "create",
        `Volume CLI work ${String(index).padStart(3, "0")}`,
        "--label",
        "volume",
        "--json"
      ]);
    }

    const defaultList = await runCli(rootDir, ["work", "list", "--label", "volume", "--json"]);
    expect(defaultList.exitCode).toBe(0);
    expect(parseData<Array<{ readonly id: string }>>(defaultList.stdout)).toHaveLength(100);

    const explicitList = await runCli(rootDir, ["work", "list", "--label", "volume", "--limit", "101", "--json"]);
    expect(explicitList.exitCode).toBe(0);
    expect(parseData<Array<{ readonly id: string }>>(explicitList.stdout)).toHaveLength(101);

    const excessiveList = await runCli(rootDir, ["work", "list", "--limit", "1001", "--json"]);
    const excessiveListPayload = parseJson<{ readonly ok: false; readonly code: string; readonly message: string }>(
      excessiveList.stderr
    );
    expect(excessiveList.exitCode).toBe(2);
    expect(excessiveListPayload.code).toBe("BOREAL_INVALID_INPUT");
    expect(excessiveListPayload.message).toContain("--limit must be at most 1000");

    const excessiveSearch = await runCli(rootDir, ["search", "query", "volume", "--limit", "101", "--json"]);
    const excessiveSearchPayload = parseJson<{ readonly ok: false; readonly code: string; readonly message: string }>(
      excessiveSearch.stderr
    );
    expect(excessiveSearch.exitCode).toBe(2);
    expect(excessiveSearchPayload.code).toBe("BOREAL_INVALID_INPUT");
    expect(excessiveSearchPayload.message).toContain("--limit must be at most 100");
  });

  it("rejects excessive handoff limits before claiming work", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);
    await runCli(rootDir, ["work", "create", "Handoff limit guard", "--label", "limit-guard", "--ready", "--json"]);

    const invalidClaim = await runCli(rootDir, [
      "work",
      "claim",
      "--agent",
      "agent-limit",
      "--label",
      "limit-guard",
      "--limit",
      "51",
      "--json"
    ]);
    const invalidClaimPayload = parseJson<{ readonly ok: false; readonly code: string; readonly message: string }>(
      invalidClaim.stderr
    );
    expect(invalidClaim.exitCode).toBe(2);
    expect(invalidClaimPayload.code).toBe("BOREAL_INVALID_INPUT");
    expect(invalidClaimPayload.message).toContain("--limit must be at most 50");

    const invalidStart = await runCli(rootDir, [
      "agent",
      "start",
      "--agent",
      "agent-limit",
      "--label",
      "limit-guard",
      "--limit",
      "51",
      "--json"
    ]);
    const invalidStartPayload = parseJson<{ readonly ok: false; readonly code: string; readonly message: string }>(
      invalidStart.stderr
    );
    expect(invalidStart.exitCode).toBe(2);
    expect(invalidStartPayload.code).toBe("BOREAL_INVALID_INPUT");
    expect(invalidStartPayload.message).toContain("--limit must be at most 50");

    const workRows = parseData<Array<{ readonly status: string }>>(
      (await runCli(rootDir, ["work", "list", "--label", "limit-guard", "--json"])).stdout
    );
    expect(workRows).toEqual([expect.objectContaining({ status: "ready" })]);

    const reservations = parseData<Array<{ readonly id: string }>>(
      (await runCli(rootDir, ["reservation", "list", "--agent", "agent-limit", "--status", "all", "--json"])).stdout
    );
    expect(reservations).toEqual([]);
  });

  it("resolves work references by title and id prefix in work commands", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);

    const created = await runCli(rootDir, [
      "work",
      "create",
      "CLI reference target",
      "--label",
      "resolver",
      "--ready",
      "--json"
    ]);
    const work = parseData<{ readonly meta: { readonly id: string }; readonly title: string }>(created.stdout);
    const prefix = work.meta.id.slice(0, 16);

    const shownByTitle = await runCli(rootDir, ["work", "show", "cli reference target", "--json"]);
    expect(parseData<{ readonly id: string }>(shownByTitle.stdout).id).toBe(work.meta.id);

    const reservedByPrefix = await runCli(rootDir, ["work", "reserve", prefix, "--agent", "agent-ref", "--json"]);
    const reservedWork = parseData<{ readonly meta: { readonly id: string }; readonly reservationId: string }>(
      reservedByPrefix.stdout
    );
    expect(reservedWork.meta.id).toBe(work.meta.id);

    const listedByTitle = await runCli(rootDir, ["reservation", "list", "--work", "CLI reference target", "--json"]);
    expect(parseData<Array<{ readonly workId: string }>>(listedByTitle.stdout)).toEqual([
      expect.objectContaining({ workId: work.meta.id })
    ]);

    const releasedByTitle = await runCli(rootDir, ["work", "release", "CLI reference target", "--json"]);
    expect(parseData<{ readonly work: { readonly status: string } }>(releasedByTitle.stdout).work.status).toBe("ready");

    await runCli(rootDir, ["work", "create", "Ambiguous CLI reference", "--json"]);
    await runCli(rootDir, ["work", "create", "Ambiguous CLI reference", "--json"]);
    const ambiguous = await runCli(rootDir, ["work", "show", "Ambiguous CLI reference", "--json"]);
    const ambiguousPayload = parseJson<{ readonly ok: false; readonly code: string }>(ambiguous.stderr);
    expect(ambiguous.exitCode).toBe(1);
    expect(ambiguousPayload.code).toBe("BOREAL_CONFLICT");
  });

	  it("creates, renders, lists, and composes agent summaries", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);

    const work = parseData<{ readonly meta: { readonly id: string }; readonly title: string }>(
      (await runCli(rootDir, ["work", "create", "Summary target", "--ready", "--json"])).stdout
    );
    const evidence = parseData<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "evidence",
          "add",
          work.meta.id,
          "--summary",
          "summary test evidence passed",
          "--kind",
          "test",
          "--outcome",
          "passed",
          "--json"
        ])
      ).stdout
    );
    const verification = parseData<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "work",
          "verify",
          work.meta.id,
          "--evidence",
          evidence.meta.id,
          "--verdict",
          "passed",
          "--notes",
          "verified summary test",
          "--json"
        ])
      ).stdout
    );

    const created = parseData<{
      readonly summary: {
        readonly meta: { readonly id: string };
        readonly subjectId: string;
        readonly subjectType: string;
        readonly status: string;
        readonly outcome: string;
        readonly evidenceIds: readonly string[];
        readonly verificationIds: readonly string[];
        readonly commitShas: readonly string[];
        readonly artifactUri: string;
      };
      readonly artifact: { readonly path: string; readonly uri: string };
    }>(
      (
        await runCli(rootDir, [
          "summary",
          "create",
          work.meta.id,
          "--body",
          "Implemented the summary target and verified it.",
          "--evidence",
          evidence.meta.id,
          "--verification",
          verification.meta.id,
          "--commit",
          "abc1234",
          "--dirty-path",
          "none",
          "--json"
        ])
      ).stdout
    );

    expect(created.summary.subjectId).toBe(work.meta.id);
    expect(created.summary.subjectType).toBe("work");
    expect(created.summary.status).toBe("final");
    expect(created.summary.outcome).toBe("completed");
    expect(created.summary.evidenceIds).toEqual([evidence.meta.id]);
    expect(created.summary.verificationIds).toEqual([verification.meta.id]);
    expect(created.summary.commitShas).toEqual(["abc1234"]);
    expect(created.artifact.uri).toBe(created.summary.artifactUri);
    expect(await readFile(created.artifact.path, "utf8")).toContain("Implemented the summary target and verified it.");

    const shown = parseData<{ readonly meta: { readonly id: string }; readonly subjectId: string }>(
      (await runCli(rootDir, ["summary", "show", created.summary.meta.id, "--json"])).stdout
    );
    expect(shown).toEqual(expect.objectContaining({ subjectId: work.meta.id }));

    const listed = parseData<Array<{ readonly id: string; readonly subjectId: string }>>(
      (await runCli(rootDir, ["summary", "list", "--subject", work.meta.id, "--json"])).stdout
    );
    expect(listed).toEqual([expect.objectContaining({ id: created.summary.meta.id, subjectId: work.meta.id })]);

    const composed = parseData<{ readonly summary: { readonly subjectId: string; readonly body: string } }>(
      (await runCli(rootDir, ["summary", "compose", work.meta.id, "--no-render", "--json"])).stdout
    );
    expect(composed.summary.subjectId).toBe(work.meta.id);
    expect(composed.summary.body).toContain("summary test evidence passed");

    const forcedWithoutComment = await runCli(rootDir, [
      "summary",
      "create",
      work.meta.id,
      "--body",
      "forced summary without comment",
      "--force-reason",
      "operator_override",
      "--json"
    ]);
	    expect(forcedWithoutComment.exitCode).toBe(2);
	    expect(parseJson<{ readonly code: string }>(forcedWithoutComment.stderr).code).toBe("BOREAL_INVALID_INPUT");
	  });

	  it("keeps closeout summaries atomic with work close failures", async () => {
	    const rootDir = await makeTempWorkspace();
	    await runCli(rootDir, ["init", "--json"]);

	    const work = parseData<{ readonly meta: { readonly id: string } }>(
	      (await runCli(rootDir, ["work", "create", "Unverified closeout target", "--ready", "--json"])).stdout
	    );
	    const failedClose = await runCli(rootDir, [
	      "work",
	      "close",
	      work.meta.id,
	      "--reason",
	      "should not close",
	      "--commit",
	      "abc1234",
	      "--json"
	    ]);

	    expect(failedClose.exitCode).toBe(1);
	    expect(parseJson<{ readonly code: string }>(failedClose.stderr).code).toBe("BOREAL_POLICY_VIOLATION");
	    const state = await readState<{
	      readonly workItems: Array<{ readonly meta: { readonly id: string }; readonly status: string }>;
	      readonly agentSummaries: readonly unknown[];
	    }>(rootDir);
	    expect(state.workItems.find((item) => item.meta.id === work.meta.id)?.status).toBe("ready");
	    expect(state.agentSummaries).toHaveLength(0);
	  });

  it("plans and exposes required review and audit gates from CLI workflows", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);

    const work = parseData<{
      readonly meta: { readonly id: string };
      readonly requiredCloseoutGates: readonly Array<{ readonly kind: string; readonly status: string }>;
    }>(
      (
        await runCli(rootDir, [
          "work",
          "create",
          "CLI review gate target",
          "--required-gate",
          "review",
          "--ready",
          "--json"
        ])
      ).stdout
    );
    expect(work.requiredCloseoutGates).toEqual([
      expect.objectContaining({ kind: "review", status: "open" })
    ]);

    const edited = parseData<{
      readonly work: {
        readonly requiredCloseoutGates: readonly Array<{ readonly kind: string; readonly scope: string; readonly status: string }>;
      };
    }>(
      (
        await runCli(rootDir, [
          "work",
          "edit",
          work.meta.id,
          "--required-gate",
          "review",
          "--required-gate",
          "audit",
          "--json"
        ])
      ).stdout
    );
    expect(edited.work.requiredCloseoutGates).toEqual([
      expect.objectContaining({ kind: "review", scope: "self", status: "open" }),
      expect.objectContaining({ kind: "audit", scope: "self", status: "open" })
    ]);

    const testEvidence = parseData<{
      readonly meta: { readonly id: string };
      readonly closeoutGateStatus: {
        readonly summary: { readonly total: number; readonly open: number; readonly satisfied: number };
        readonly gateGaps: readonly Array<{ readonly gateKind: string; readonly targetId: string }>;
      };
    }>(
      (
        await runCli(rootDir, [
          "evidence",
          "add",
          work.meta.id,
          "--summary",
          "ordinary test evidence passed",
          "--kind",
          "test",
          "--outcome",
          "passed",
          "--json"
        ])
      ).stdout
    );
    expect(testEvidence.closeoutGateStatus.summary).toEqual(expect.objectContaining({ total: 2, open: 2, satisfied: 0 }));
    expect(testEvidence.closeoutGateStatus.gateGaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ gateKind: "review", targetId: work.meta.id }),
        expect.objectContaining({ gateKind: "audit", targetId: work.meta.id })
      ])
    );
    const testVerification = parseData<{
      readonly verdict: string;
      readonly closeoutGateStatus: { readonly summary: { readonly open: number; readonly satisfied: number } };
    }>(
      (await runCli(rootDir, ["work", "verify", work.meta.id, "--evidence", testEvidence.meta.id, "--verdict", "passed", "--json"])).stdout
    );
    expect(testVerification.verdict).toBe("passed");
    expect(testVerification.closeoutGateStatus.summary).toEqual(expect.objectContaining({ open: 2, satisfied: 0 }));

    const failedClose = await runCli(rootDir, [
      "work",
      "close",
      work.meta.id,
      "--reason",
      "missing review and audit evidence",
      "--commit",
      "abc1234",
      "--json"
    ]);
    expect(failedClose.exitCode).toBe(1);
    expect(parseJson<{ readonly code: string; readonly details: { readonly gateGaps: readonly unknown[] } }>(failedClose.stderr)).toEqual(
      expect.objectContaining({
        code: "BOREAL_POLICY_VIOLATION",
        details: expect.objectContaining({
          gateGaps: expect.arrayContaining([
            expect.objectContaining({
              gateKind: "review",
              targetId: work.meta.id
            }),
            expect.objectContaining({
              gateKind: "audit",
              targetId: work.meta.id
            })
          ])
        })
      })
    );
    expect((await readState<{ readonly agentSummaries: readonly unknown[] }>(rootDir)).agentSummaries).toHaveLength(0);

    const reviewEvidence = parseData<{
      readonly meta: { readonly id: string };
      readonly closeoutGateStatus: {
        readonly summary: { readonly open: number; readonly satisfied: number };
        readonly requiredGates: readonly Array<{
          readonly kind: string;
          readonly status: string;
          readonly recordedStatus: string;
          readonly satisfiedBy?: { readonly evidenceIds?: readonly string[] };
        }>;
      };
    }>(
      (
        await runCli(rootDir, [
          "evidence",
          "add",
          work.meta.id,
          "--summary",
          "review evidence passed",
          "--kind",
          "review",
          "--outcome",
          "passed",
          "--json"
        ])
      ).stdout
    );
    expect(reviewEvidence.closeoutGateStatus.summary).toEqual(expect.objectContaining({ open: 0, satisfied: 2 }));
    expect(reviewEvidence.closeoutGateStatus.requiredGates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "review",
          status: "satisfied",
          recordedStatus: "open",
          satisfiedBy: expect.objectContaining({ evidenceIds: [reviewEvidence.meta.id] })
        }),
        expect.objectContaining({
          kind: "audit",
          status: "satisfied",
          recordedStatus: "open",
          satisfiedBy: expect.objectContaining({ evidenceIds: [reviewEvidence.meta.id] })
        })
      ])
    );

    const composed = parseData<{
      readonly summary: { readonly body: string };
      readonly closeoutGateStatus: { readonly summary: { readonly open: number; readonly satisfied: number } };
    }>((await runCli(rootDir, ["summary", "compose", work.meta.id, "--no-render", "--json"])).stdout);
    expect(composed.closeoutGateStatus.summary).toEqual(expect.objectContaining({ open: 0, satisfied: 2 }));
    expect(composed.summary.body).toContain("## Closeout Gates");
    expect(composed.summary.body).toContain("review:self satisfied");
    expect(composed.summary.body).toContain("audit:self satisfied");

    const closed = parseData<{
      readonly work: {
        readonly status: string;
        readonly requiredCloseoutGates: readonly Array<{
          readonly kind: string;
          readonly status: string;
          readonly satisfiedBy?: { readonly evidenceIds?: readonly string[] };
        }>;
      };
      readonly createdAgentSummary?: { readonly commitShas: readonly string[] };
    }>(
      (
        await runCli(rootDir, [
          "work",
          "close",
          work.meta.id,
          "--reason",
          "review gate satisfied",
          "--commit",
          "def5678",
          "--json"
        ])
      ).stdout
    );

    expect(closed.work.status).toBe("closed");
    expect(closed.createdAgentSummary?.commitShas).toEqual(["def5678"]);
    expect(closed.work.requiredCloseoutGates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "review",
          status: "satisfied",
          satisfiedBy: expect.objectContaining({
            evidenceIds: [reviewEvidence.meta.id]
          })
        }),
        expect.objectContaining({
          kind: "audit",
          status: "satisfied",
          satisfiedBy: expect.objectContaining({
            evidenceIds: [reviewEvidence.meta.id]
          })
        })
      ])
    );
  });

  it("forces planned required gates through work edit with audited metadata", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);

    const work = parseData<{
      readonly meta: { readonly id: string };
      readonly requiredCloseoutGates: readonly Array<{ readonly kind: string; readonly status: string }>;
    }>(
      (
        await runCli(rootDir, [
          "work",
          "create",
          "Forced audit gate target",
          "--required-gate",
          "audit",
          "--ready",
          "--json"
        ])
      ).stdout
    );
    expect(work.requiredCloseoutGates).toEqual([
      expect.objectContaining({ kind: "audit", status: "open" })
    ]);

    const invalidForce = await runCli(rootDir, [
      "work",
      "edit",
      work.meta.id,
      "--force-gate",
      "audit",
      "--force-gate-reason",
      "audit_unavailable",
      "--json"
    ]);
    expect(invalidForce.exitCode).toBe(2);
    expect(parseJson<{ readonly code: string; readonly message: string }>(invalidForce.stderr)).toEqual(
      expect.objectContaining({
        code: "BOREAL_INVALID_INPUT",
        message: expect.stringContaining("--force-gate requires --force-gate-reason and --force-gate-comment")
      })
    );

    const supportEvidence = parseData<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "evidence",
          "add",
          work.meta.id,
          "--summary",
          "External audit window was unavailable.",
          "--kind",
          "note",
          "--outcome",
          "observed",
          "--json"
        ])
      ).stdout
    );

    const forced = parseData<{
      readonly work: {
        readonly requiredCloseoutGates: readonly Array<{
          readonly kind: string;
          readonly status: string;
          readonly force?: {
            readonly reason: string;
            readonly comment: string;
            readonly evidenceIds?: readonly string[];
          };
        }>;
      };
    }>(
      (
        await runCli(rootDir, [
          "work",
          "edit",
          work.meta.id,
          "--force-gate",
          "audit",
          "--force-gate-reason",
          "audit_unavailable",
          "--force-gate-comment",
          "External audit window was unavailable before closeout.",
          "--force-gate-evidence",
          supportEvidence.meta.id,
          "--json"
        ])
      ).stdout
    );
    expect(forced.work.requiredCloseoutGates).toEqual([
      expect.objectContaining({
        kind: "audit",
        status: "forced",
        force: expect.objectContaining({
          reason: "audit_unavailable",
          comment: "External audit window was unavailable before closeout.",
          evidenceIds: [supportEvidence.meta.id]
        })
      })
    ]);

    const verificationEvidence = parseData<{
      readonly meta: { readonly id: string };
      readonly closeoutGateStatus: {
        readonly summary: { readonly open: number; readonly forced: number };
        readonly requiredGates: readonly Array<{ readonly kind: string; readonly status: string }>;
      };
    }>(
      (
        await runCli(rootDir, [
          "evidence",
          "add",
          work.meta.id,
          "--summary",
          "Verification evidence passed after forced audit.",
          "--kind",
          "test",
          "--outcome",
          "passed",
          "--json"
        ])
      ).stdout
    );
    expect(verificationEvidence.closeoutGateStatus.summary).toEqual(expect.objectContaining({ open: 0, forced: 1 }));
    expect(verificationEvidence.closeoutGateStatus.requiredGates).toEqual([
      expect.objectContaining({ kind: "audit", status: "forced" })
    ]);

    await runCli(rootDir, [
      "work",
      "verify",
      work.meta.id,
      "--evidence",
      verificationEvidence.meta.id,
      "--verdict",
      "passed",
      "--json"
    ]);
    const composed = parseData<{
      readonly summary: { readonly meta: { readonly id: string }; readonly body: string; readonly dirtyPathNotes: readonly string[] };
      readonly closeoutGateStatus: { readonly summary: { readonly open: number; readonly forced: number } };
    }>(
      (
        await runCli(rootDir, [
          "summary",
          "compose",
          work.meta.id,
          "--dirty-path",
          "no_repo_changes: forced audit gate fixture",
          "--no-render",
          "--json"
        ])
      ).stdout
    );
    expect(composed.summary.dirtyPathNotes).toEqual(["no_repo_changes: forced audit gate fixture"]);
    expect(composed.closeoutGateStatus.summary).toEqual(expect.objectContaining({ open: 0, forced: 1 }));
    expect(composed.summary.body).toContain("audit:self forced");
    expect(composed.summary.body).toContain("forced=audit_unavailable External audit window was unavailable before closeout.");

    const closed = parseData<{
      readonly work: {
        readonly status: string;
        readonly requiredCloseoutGates: readonly Array<{
          readonly kind: string;
          readonly status: string;
          readonly force?: { readonly reason: string };
        }>;
      };
      readonly agentSummaries: readonly Array<{ readonly meta: { readonly id: string } }>;
    }>(
      (
        await runCli(rootDir, [
          "work",
          "close",
          work.meta.id,
          "--reason",
          "forced audit gate accepted",
          "--agent-summary",
          composed.summary.meta.id,
          "--json"
        ])
      ).stdout
    );
    expect(closed.work.status).toBe("closed");
    expect(closed.agentSummaries).toEqual([
      expect.objectContaining({ meta: expect.objectContaining({ id: composed.summary.meta.id }) })
    ]);
    expect(closed.work.requiredCloseoutGates).toEqual([
      expect.objectContaining({
        kind: "audit",
        status: "forced",
        force: expect.objectContaining({ reason: "audit_unavailable" })
      })
    ]);
  });

	  it("keeps agent finish close atomic when summary checkpoint metadata is invalid", async () => {
	    const rootDir = await makeTempWorkspace();
	    await runCli(rootDir, ["init", "--json"]);

	    const work = parseData<{ readonly meta: { readonly id: string } }>(
	      (await runCli(rootDir, ["work", "create", "Invalid finish checkpoint", "--label", "finish-atomic", "--ready", "--json"])).stdout
	    );
	    await runCli(rootDir, ["agent", "start", "--agent", "finish-atomic-agent", "--label", "finish-atomic", "--json"]);

	    const failedFinish = await runCli(rootDir, [
	      "agent",
	      "finish",
	      "current",
	      "--agent",
	      "finish-atomic-agent",
	      "--summary",
	      "Implemented the invalid checkpoint fixture.",
	      "--command",
	      "pnpm test",
	      "--close",
	      "--reason",
	      "verified by invalid checkpoint fixture",
	      "--commit",
	      "notasha",
	      "--json"
	    ]);

	    expect(failedFinish.exitCode).toBe(2);
	    expect(parseJson<{ readonly code: string }>(failedFinish.stderr).code).toBe("BOREAL_INVALID_INPUT");
	    const state = await readState<{
	      readonly workItems: Array<{ readonly meta: { readonly id: string }; readonly status: string; readonly reservationId?: string }>;
	      readonly evidence: readonly unknown[];
	      readonly verifications: readonly unknown[];
	      readonly agentSummaries: readonly unknown[];
	      readonly reservations: Array<{ readonly workId: string; readonly status: string; readonly agentId: string }>;
	    }>(rootDir);
	    const storedWork = state.workItems.find((item) => item.meta.id === work.meta.id);
	    expect(storedWork).toEqual(expect.objectContaining({ status: "in_progress" }));
	    expect(state.evidence).toHaveLength(0);
	    expect(state.verifications).toHaveLength(0);
	    expect(state.agentSummaries).toHaveLength(0);
	    expect(state.reservations).toEqual([
	      expect.objectContaining({ workId: work.meta.id, status: "active", agentId: "finish-atomic-agent" })
	    ]);
	  });

	  it("creates a fresh closeout summary when new checkpoint metadata is supplied", async () => {
	    const rootDir = await makeTempWorkspace();
	    await runCli(rootDir, ["init", "--json"]);

	    const work = parseData<{ readonly meta: { readonly id: string } }>(
	      (await runCli(rootDir, ["work", "create", "Fresh checkpoint summary", "--ready", "--json"])).stdout
	    );
	    const evidence = parseData<{ readonly meta: { readonly id: string } }>(
	      (
	        await runCli(rootDir, [
	          "evidence",
	          "add",
	          work.meta.id,
	          "--summary",
	          "Fresh summary close evidence passed.",
	          "--outcome",
	          "passed",
	          "--json"
	        ])
	      ).stdout
	    );
	    await runCli(rootDir, ["work", "verify", work.meta.id, "--evidence", evidence.meta.id, "--verdict", "passed", "--json"]);
	    const previous = parseData<{ readonly summary: { readonly meta: { readonly id: string }; readonly commitShas: readonly string[] } }>(
	      (
	        await runCli(rootDir, [
	          "summary",
	          "create",
	          work.meta.id,
	          "--body",
	          "Existing final summary without a checkpoint.",
	          "--no-render",
	          "--json"
	        ])
	      ).stdout
	    );

	    const closed = parseData<{
	      readonly agentSummaries: readonly Array<{ readonly meta: { readonly id: string }; readonly commitShas: readonly string[] }>;
	      readonly createdAgentSummary?: { readonly meta: { readonly id: string }; readonly commitShas: readonly string[] };
	    }>(
	      (
	        await runCli(rootDir, [
	          "work",
	          "close",
	          work.meta.id,
	          "--reason",
	          "verified with fresh checkpoint",
	          "--commit",
	          "abc1234",
	          "--json"
	        ])
	      ).stdout
	    );

	    expect(previous.summary.commitShas).toEqual([]);
	    expect(closed.agentSummaries).toEqual([
	      expect.objectContaining({ commitShas: ["abc1234"] })
	    ]);
	    expect(closed.createdAgentSummary).toEqual(expect.objectContaining({ commitShas: ["abc1234"] }));
	    expect(closed.createdAgentSummary?.meta.id).not.toBe(previous.summary.meta.id);
	    const state = await readState<{ readonly agentSummaries: readonly Array<{ readonly subjectId: string }> }>(rootDir);
	    expect(state.agentSummaries.filter((summary) => summary.subjectId === work.meta.id)).toHaveLength(2);
	  });

	  it("rejects closeout dirty-path notes without a checkpoint reason code", async () => {
	    const rootDir = await makeTempWorkspace();
	    await runCli(rootDir, ["init", "--json"]);

	    const work = parseData<{ readonly meta: { readonly id: string } }>(
	      (await runCli(rootDir, ["work", "create", "Dirty reason code target", "--ready", "--json"])).stdout
	    );
	    const invalid = await runCli(rootDir, [
	      "work",
	      "cancel",
	      work.meta.id,
	      "--reason",
	      "no valid checkpoint reason",
	      "--dirty-path",
	      "none",
	      "--json"
	    ]);

	    expect(invalid.exitCode).toBe(2);
	    expect(parseJson<{ readonly code: string; readonly message: string }>(invalid.stderr)).toEqual(
	      expect.objectContaining({
	        code: "BOREAL_INVALID_INPUT",
	        message: expect.stringContaining("reason-code prefixes")
	      })
	    );
	    const state = await readState<{
	      readonly workItems: Array<{ readonly meta: { readonly id: string }; readonly status: string }>;
	      readonly agentSummaries: readonly unknown[];
	    }>(rootDir);
	    expect(state.workItems.find((item) => item.meta.id === work.meta.id)?.status).toBe("ready");
	    expect(state.agentSummaries).toHaveLength(0);
	  });

	  it("requires agent summary coverage for cancelled work and doctors terminal coverage", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);

    const work = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Duplicate cancellation", "--ready", "--json"])).stdout
    );
    const cancelled = parseData<{
      readonly schemaVersion: string;
      readonly work: { readonly status: string; readonly closedReason: string };
      readonly agentSummaries: readonly Array<{
        readonly meta: { readonly id: string };
        readonly subjectId: string;
        readonly status: string;
        readonly outcome: string;
        readonly dirtyPathNotes: readonly string[];
        readonly forceReasonCode: string;
        readonly forceComment: string;
        readonly artifactUri: string;
      }>;
      readonly createdAgentSummaryArtifact: { readonly path: string; readonly uri: string };
    }>(
      (
        await runCli(rootDir, [
          "work",
          "cancel",
          work.meta.id,
          "--reason",
          "duplicate task",
          "--force-summary",
          "--force-reason",
          "duplicate",
	          "--force-comment",
	          "Covered by the canonical duplicate target.",
	          "--dirty-path",
	          "no_repo_changes: duplicate closeout",
	          "--json"
	        ])
      ).stdout
    );

    expect(cancelled.schemaVersion).toBe("boreal.cli.work.cancel.v1");
    expect(cancelled.work).toEqual(expect.objectContaining({ status: "cancelled", closedReason: "duplicate task" }));
    expect(cancelled.agentSummaries).toEqual([
      expect.objectContaining({
        subjectId: work.meta.id,
	        status: "forced",
	        outcome: "cancelled",
	        dirtyPathNotes: ["no_repo_changes: duplicate closeout"],
	        forceReasonCode: "duplicate",
        forceComment: "Covered by the canonical duplicate target."
      })
    ]);
    expect(cancelled.createdAgentSummaryArtifact.uri).toBe(cancelled.agentSummaries[0]?.artifactUri);
    expect(await readFile(cancelled.createdAgentSummaryArtifact.path, "utf8")).toContain("duplicate task");

    const cleanDoctor = parseData<DoctorPayload>((await runCli(rootDir, ["doctor", "--strict", "--json"])).stdout);
    expect(doctorDiagnostic(cleanDoctor, "summary.force_reason")).toEqual(expect.objectContaining({ severity: "ok" }));
    expect(doctorDiagnostic(cleanDoctor, "summary.closeout_coverage")).toEqual(expect.objectContaining({ severity: "ok" }));
    expect(doctorDiagnostic(cleanDoctor, "summary.checkpoint_coverage")).toEqual(expect.objectContaining({ severity: "ok" }));
    expect(doctorDiagnostic(cleanDoctor, "summary.artifact_coverage")).toEqual(expect.objectContaining({ severity: "ok" }));

    const legacy = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Legacy closed without summary", "--ready", "--json"])).stdout
    );
    await updateState(rootDir, (current) => ({
      ...current,
      workItems: ((current.workItems as Array<Record<string, unknown>> | undefined) ?? []).map((item) =>
        item?.meta && typeof item.meta === "object" && "id" in item.meta && item.meta.id === legacy.meta.id
          ? {
              ...item,
              status: "closed",
              closedAt: "2026-06-01T00:00:00.000Z",
              closedReason: "legacy imported closeout"
            }
          : item
      )
    }));

    const legacyDoctorRun = await runCli(rootDir, ["doctor", "--json"]);
    const legacyDoctor = parseData<DoctorPayload>(legacyDoctorRun.stdout);
    expect(legacyDoctorRun.exitCode).toBe(0);
    expect(doctorDiagnostic(legacyDoctor, "summary.legacy_closeout_coverage")).toEqual(
      expect.objectContaining({
        severity: "warning",
        details: expect.arrayContaining([expect.objectContaining({ workId: legacy.meta.id })])
      })
    );
  });

  it("repairs missing generated projection records through doctor", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);
    const work = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Doctor generated projection", "--ready", "--json"])).stdout
    );
    await runCli(rootDir, ["context", "rebuild", "--json"]);

    const state = await readState<{
      readonly projections: Array<{ readonly meta: { readonly id: string }; readonly subjectId: string }>;
    }>(rootDir);
    const projection = state.projections.find((record) => record.subjectId === work.meta.id);
    expect(projection).toBeDefined();
    await updateState(rootDir, (current) => ({
      ...current,
      projections: ((current.projections as typeof state.projections | undefined) ?? []).filter(
        (record) => record.meta.id !== projection?.meta.id
      )
    }));

    const warningDoctor = await runCli(rootDir, ["doctor", "--json"]);
    const warningPayload = parseData<{
      readonly ok: boolean;
      readonly diagnostics: Array<{ readonly code: string; readonly severity: string }>;
    }>(warningDoctor.stdout);
    expect(warningDoctor.exitCode).toBe(0);
    expect(warningPayload.ok).toBe(true);
    expect(warningPayload.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "projection.context_pack", severity: "warning" })])
    );

    const fixedDoctor = await runCli(rootDir, ["doctor", "--fix", "--json"]);
    const fixedPayload = parseData<{
      readonly ok: boolean;
      readonly diagnostics: Array<{ readonly code: string; readonly severity: string }>;
    }>(fixedDoctor.stdout);
    expect(fixedDoctor.exitCode).toBe(0);
    expect(fixedPayload.ok).toBe(true);
    expect(fixedPayload.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "projection.context_pack", severity: "fixed" })])
    );
    const fixedState = await readState<{
      readonly projections: Array<{ readonly meta: { readonly id: string }; readonly subjectId: string }>;
    }>(rootDir);
    expect(fixedState.projections.map((record) => record.meta.id)).toContain(projection?.meta.id);
  });

  it("repairs dependency projection drift from canonical block graph edges", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);
    const blocker = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Doctor graph blocker", "--ready", "--json"])).stdout
    );
    const blocked = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Doctor graph blocked", "--ready", "--json"])).stdout
    );
    await runCli(rootDir, ["work", "block", blocked.meta.id, blocker.meta.id, "--json"]);

    await updateState(rootDir, (state) => ({
      ...state,
      workItems: state.workItems.map((work) =>
        work.meta.id === blocked.meta.id ? { ...work, dependencyIds: [], status: "ready" } : work
      )
    }));
    await runCli(rootDir, ["context", "rebuild", "--json"]);

    const nextRows = parseData<Array<{ readonly id: string }>>((await runCli(rootDir, ["work", "next", "--json"])).stdout);
    expect(nextRows.map((row) => row.id)).not.toContain(blocked.meta.id);
    const agentStatus = parseData<{
      readonly readyWork: { readonly claimableCount: number; readonly next?: { readonly id: string } };
    }>((await runCli(rootDir, ["agent", "status", "--agent", "graph-doctor", "--json"])).stdout);
    expect(agentStatus.readyWork.claimableCount).toBe(1);
    expect(agentStatus.readyWork.next?.id).toBe(blocker.meta.id);

    const failingDoctor = await runCli(rootDir, ["doctor", "--json"]);
    const failingPayload = parseData<{
      readonly ok: boolean;
      readonly diagnostics: Array<{ readonly code: string; readonly severity: string }>;
    }>(failingDoctor.stdout);
    expect(failingDoctor.exitCode).toBe(1);
    expect(failingPayload.ok).toBe(false);
    expect(failingPayload.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "graph.block_consistency", severity: "error" }),
        expect.objectContaining({ code: "work.readiness", severity: "error" })
      ])
    );

    const repairedDoctor = await runCli(rootDir, ["doctor", "--fix", "--json"]);
    const repairedPayload = parseData<{
      readonly ok: boolean;
      readonly diagnostics: Array<{ readonly code: string; readonly severity: string }>;
    }>(repairedDoctor.stdout);
    expect(repairedDoctor.exitCode).toBe(0);
    expect(repairedPayload.ok).toBe(true);
    expect(repairedPayload.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "graph.block_consistency", severity: "fixed" }),
        expect.objectContaining({ code: "projection.context_pack", severity: "fixed" })
      ])
    );

    const shown = await runCli(rootDir, ["work", "show", blocked.meta.id, "--json"]);
    expect(parseData<{ readonly status: string; readonly blockedBy: readonly string[] }>(shown.stdout)).toEqual(
      expect.objectContaining({ status: "blocked", blockedBy: [blocker.meta.id] })
    );
    const pack = parseData<{ readonly facts: readonly string[] }>(
      (await runCli(rootDir, ["context", "show", blocked.meta.id, "--json"])).stdout
    );
    expect(pack.facts).toContain("status: blocked");
  });

  it("repairs stale runtime locks explicitly", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);
    await writeLockOwner(rootDir, new Date(Date.now() - 120_000).toISOString());

    const failingDoctor = await runCli(rootDir, ["doctor", "--json"]);
    const failingPayload = parseData<{ readonly ok: boolean; readonly diagnostics: Array<{ readonly code: string }> }>(
      failingDoctor.stdout
    );
    expect(failingDoctor.exitCode).toBe(1);
    expect(failingPayload.ok).toBe(false);
    expect(failingPayload.diagnostics.map((diagnostic) => diagnostic.code)).toContain("lock.stale");

    const repaired = await runCli(rootDir, ["lock", "break", "--stale-only", "--json"]);
    expect(repaired.exitCode).toBe(0);
    expect(parseData<{ readonly removed: boolean }>(repaired.stdout).removed).toBe(true);

    const inspection = await runCli(rootDir, ["lock", "inspect", "--json"]);
    expect(parseData<{ readonly exists: boolean }>(inspection.stdout).exists).toBe(false);
  });

  it("repairs stale generated search index locks through doctor", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);
    await writeLockOwner(rootDir, new Date(Date.now() - 120_000).toISOString(), "search-index.lock");

    const failingDoctor = await runCli(rootDir, ["doctor", "--json"]);
    const failingPayload = parseData<{ readonly ok: boolean; readonly diagnostics: Array<{ readonly code: string }> }>(
      failingDoctor.stdout
    );
    expect(failingDoctor.exitCode).toBe(1);
    expect(failingPayload.ok).toBe(false);
    expect(failingPayload.diagnostics.map((diagnostic) => diagnostic.code)).toContain("lock.search_index.stale");

    const repairedDoctor = await runCli(rootDir, ["doctor", "--fix", "--json"]);
    const repairedPayload = parseData<{
      readonly ok: boolean;
      readonly fixed: boolean;
      readonly diagnostics: Array<{ readonly code: string; readonly severity: string }>;
    }>(repairedDoctor.stdout);
    expect(repairedDoctor.exitCode).toBe(0);
    expect(repairedPayload.ok).toBe(true);
    expect(repairedPayload.fixed).toBe(true);
    expect(repairedPayload.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "lock.search_index.stale", severity: "fixed" })])
    );

    const searchIndexDocument = parseJson<{ readonly schemaVersion: string }>(
      await readFile(join(rootDir, ".boreal/runtime/search-index.json"), "utf8")
    );
    expect(searchIndexDocument.schemaVersion).toBe("boreal.search-index.v1");
  });
});

async function makeTempWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "boreal-cli-"));
  tempDirs.push(dir);
  return dir;
}

async function fileMissing(path: string): Promise<boolean> {
  try {
    await stat(path);
    return false;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return true;
    }
    throw error;
  }
}

async function gitAvailable(cwd: string): Promise<boolean> {
  try {
    await runGit(cwd, ["--version"]);
    return true;
  } catch {
    return false;
  }
}

async function initGitRepository(cwd: string, branch: string): Promise<void> {
  try {
    await runGit(cwd, ["init", "-b", branch]);
  } catch {
    await runGit(cwd, ["init"]);
    await runGit(cwd, ["checkout", "-B", branch]);
  }
  await runGit(cwd, ["config", "user.email", "boreal-tests@example.invalid"]);
  await runGit(cwd, ["config", "user.name", "Boreal Tests"]);
  await writeFile(join(cwd, "README.md"), "test repository\n", "utf8");
  await runGit(cwd, ["add", "README.md"]);
  await runGit(cwd, ["commit", "-m", "Initial commit"]);
}

async function runGit(cwd: string, args: readonly string[]): Promise<void> {
  await execFileAsync("git", ["-C", cwd, ...args]);
}

async function runCli(cwd: string, argv: readonly string[]): Promise<CommandRun> {
  let stdout = "";
  let stderr = "";
  const output: CliOutput = {
    write(text) {
      stdout += text;
    },
    error(text) {
      stderr += text;
    }
  };
  const exitCode = await main([...argv], output, cwd);
  return { exitCode, stdout, stderr };
}

function parseJson<T>(text: string): T {
  return JSON.parse(text) as T;
}

function parseData<T>(text: string): T {
  const envelope = parseJson<{ readonly ok: true; readonly data: T }>(text);
  expect(envelope.ok).toBe(true);
  return envelope.data;
}

function projectMemoryGuardCount(text: string): number {
  return text.split(/\r?\n/u).filter((line) => line.trim() === "memory/" || line.trim() === "/memory/").length;
}

function doctorDiagnostic(payload: DoctorPayload, code: string): DoctorPayload["diagnostics"][number] | undefined {
  return payload.diagnostics.find((diagnostic) => diagnostic.code === code);
}

async function writeLockOwner(rootDir: string, createdAt: string, lockName = "state.lock"): Promise<void> {
  const lockDir = join(rootDir, ".boreal/runtime", lockName);
  await mkdir(lockDir, { recursive: true });
  await writeFile(
    join(lockDir, "owner.json"),
    `${JSON.stringify(
      {
        token: "external-lock",
        pid: 999_999,
        hostname: "test-host",
        createdAt
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

async function setReservationExpiresAt(rootDir: string, reservationId: string, expiresAt: string): Promise<void> {
  const statePath = join(rootDir, ".boreal/runtime/state.json");
  const state = parseJson<{
    readonly reservations: Array<{ readonly meta: { readonly id: string }; readonly [key: string]: unknown }>;
    readonly [key: string]: unknown;
  }>(await readFile(statePath, "utf8"));
  await writeFile(
    statePath,
    `${JSON.stringify(
      {
        ...state,
        reservations: state.reservations.map((reservation) =>
          reservation.meta.id === reservationId ? { ...reservation, expiresAt } : reservation
        )
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

async function readState<T = MutableStateForTest>(rootDir: string): Promise<T> {
  return parseJson<T>(await readFile(join(rootDir, ".boreal/runtime/state.json"), "utf8"));
}

async function updateState(
  rootDir: string,
  update: (state: MutableStateForTest) => MutableStateForTest
): Promise<void> {
  const statePath = join(rootDir, ".boreal/runtime/state.json");
  const state = await readState(rootDir);
  await writeFile(statePath, `${JSON.stringify(update(state), null, 2)}\n`, "utf8");
}

async function appendGraphEdge(
  rootDir: string,
  edge: {
    readonly id: string;
    readonly fromId: string;
    readonly fromType: string;
    readonly toId: string;
    readonly toType: string;
  }
): Promise<void> {
  await updateState(rootDir, (state) => ({
    ...state,
    graphEdges: [
      ...((state.graphEdges as readonly unknown[] | undefined) ?? []),
      {
        meta: testMeta(edge.id),
        kind: "references",
        fromId: edge.fromId,
        fromType: edge.fromType,
        toId: edge.toId,
        toType: edge.toType,
        directed: true
      }
    ]
  }));
}

function testMeta(id: string): Record<string, unknown> {
  return {
    id,
    schemaVersion: "boreal.runtime.v1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    createdBy: { id: "test", kind: "system" },
    updatedBy: { id: "test", kind: "system" },
    sourceRefs: [],
    tags: []
  };
}

function emptyFileStoreState(overrides: Record<string, readonly unknown[]> = {}): Record<string, unknown> {
  return {
    schemaVersion: "boreal.file-store.v1",
    workItems: [],
    evidence: [],
    verifications: [],
    knowledgeSources: [],
    claims: [],
    decisions: [],
    graphEdges: [],
    reservations: [],
    events: [],
    operations: [],
    projections: [],
    contextPacks: [],
    ...overrides
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
