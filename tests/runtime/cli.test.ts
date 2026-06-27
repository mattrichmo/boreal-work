import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
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
import type { CliOutput } from "../../apps/cli/src/output.ts";

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
    expect(commands).toContain("[--priority low|normal|high|critical]");
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
    expect(root.stdout).toContain("bwrk - Boreal Work CLI");
    expect(root.stdout).toContain(
      "bwrk help [init|work|dep|evidence|source|claim|decision|context|search|reservation|agent|session|operation|workflows|install|export|import|vault|raw|wiki|duplicate|merge|compact|sync|ledger|snapshot|doctor|lock|commands|prime]"
    );
    expect(root.stdout).toContain("bwrk version [--json]");
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

  it("does not append equivalent project .gitignore guards during repeated setup", async () => {
    const rootDir = await makeTempWorkspace();
    await writeFile(
      join(rootDir, ".gitignore"),
      [
        "# Boreal local workspace binding and runtime artifacts",
        ".boreal/project.json",
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

    const fixed = await runCli(rootDir, ["doctor", "--fix", "--json"]);
    const fixedPayload = parseData<DoctorPayload>(fixed.stdout);

    expect(fixed.exitCode).toBe(0);
    expect(doctorDiagnostic(fixedPayload, "project_setup.gitmodules")).toEqual(
      expect.objectContaining({ severity: "fixed" })
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
        wikiPageCount: 1,
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
    const searchQuery = registry.commands.find((command) => command.path.join(" ") === "search query");
    const searchIndex = registry.commands.find((command) => command.path.join(" ") === "search index");
    const evidenceAdd = registry.commands.find((command) => command.path.join(" ") === "evidence add");
    const agentFinish = registry.commands.find((command) => command.path.join(" ") === "agent finish");

    expect(result.exitCode).toBe(0);
    expect(() => validateCommandBehaviorMetadata()).not.toThrow();
    expect(registry.commands.map((command) => command.path.join(" "))).toContain("commands");
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
        "operation list",
        "operation show",
        "operation prune",
        "operation repair",
        "workflows list",
        "workflows show",
        "install codex",
        "install claude",
        "install skills",
        "export json",
        "export markdown",
        "export ledgers",
        "import json",
        "import ledgers",
        "vault init",
        "vault status",
        "raw add",
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
    const workCreatedEvent = state.events.find((event) => event.type === "work.created");
    const operation = state.operations.find((entry) => entry.commandPath === "work create");

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
      expect.arrayContaining(["work", "create", "--label", "<redacted>", "--ready", "--session", "<redacted>", "--actor", "<redacted>"])
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

    expect(text.exitCode).toBe(0);
    expect(text.stdout).toBe("boreal-work 0.1.0\n");
    expect(json.exitCode).toBe(0);
    expect(parseData<{ readonly name: string; readonly version: string }>(json.stdout)).toEqual(
      expect.objectContaining({ name: "boreal-work", version: "0.1.0" })
    );
    expect(parseData<{ readonly name: string; readonly version: string }>(shortcutJson.stdout)).toEqual(
      expect.objectContaining({ name: "boreal-work", version: "0.1.0" })
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

    const closed = await runCli(rootDir, ["work", "close", work.meta.id, "--reason", "verified", "--json"]);
    expect(parseData<{ readonly status: string }>(closed.stdout).status).toBe("closed");

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
    await runCli(rootDir, ["work", "close", blocker.meta.id, "--reason", "dependency satisfied", "--json"]);

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
    expect(payload.fullResultPath).toMatch(/^\.boreal\/results\/result-/);
    expect(payload.fullResultBytes).toBeGreaterThan(25_000);
    expect(payload.preview).toEqual(expect.objectContaining({ kind: "array", length: 80 }));

    const fullResult = parseJson<{ readonly ok: true; readonly data: Array<{ readonly title: string }> }>(
      await readFile(join(rootDir, payload.fullResultPath), "utf8")
    );
    expect(fullResult.ok).toBe(true);
    expect(fullResult.data).toHaveLength(80);
    expect(fullResult.data[0]?.title).toContain("Spool output");
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
        readonly events: Array<{ readonly operationId?: string }>;
      };
    }>(await readFile(exportPath, "utf8"));
    expect(exportDocument.schemaVersion).toBe("boreal.export.v1");
    expect(exportDocument.state.workItems.map((item) => item.meta.id)).toContain(work.meta.id);
    expect(exportDocument.state.events.every((event) => event.operationId === undefined)).toBe(true);

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
    const workLedger = await readFile(join(rootDir, ".boreal/ledgers/work-items.jsonl"), "utf8");
    expect(workLedger).toContain("\"title\":\"Exportable work\"");
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
      readonly diagnostics: Array<{ readonly code: string; readonly severity: string }>;
    }>(freshDoctor.stdout);
    expect(freshDoctorPayload.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "ledger.export_drift", severity: "ok" })])
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

  it("reports dirty collaboration paths on protected git branches", async () => {
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
      };
      readonly recommendedActions: readonly string[];
    }>(protectedStatus.stdout);
    expect(protectedStatus.exitCode).toBe(1);
    expect(protectedPayload).toEqual(
      expect.objectContaining({
        ok: false,
        ledgers: expect.objectContaining({ ok: true }),
        searchIndex: expect.objectContaining({ ok: true }),
        git: expect.objectContaining({
          ok: false,
          insideWorktree: true,
          branch: "main",
          protectedBranch: true
        }),
        recommendedActions: expect.arrayContaining(["git switch -c boreal/sync-work"])
      })
    );
    expect(protectedPayload.git.collaborationDirtyPaths.map((entry) => entry.path).join("\n")).toContain(
      ".boreal/ledgers"
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
    expect(protectedRefresh.exitCode).toBe(1);
    expect(protectedRefreshPayload).toEqual(
      expect.objectContaining({
        refreshed: true,
        refreshOk: true,
        postRefreshStatusOk: false,
        exitReason: "post_refresh_status_unhealthy",
        status: expect.objectContaining({
          ok: false,
          ledgers: expect.objectContaining({ ok: true }),
          searchIndex: expect.objectContaining({ ok: true }),
          git: expect.objectContaining({ ok: false, protectedBranch: true }),
          recommendedActions: expect.arrayContaining(["git switch -c boreal/sync-work"])
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
      expect.arrayContaining([expect.objectContaining({ code: "git.worktree", severity: "warning" })])
    );

    const strictDoctor = await runCli(rootDir, ["doctor", "--strict", "--json"]);
    expect(strictDoctor.exitCode).toBe(1);

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
        recommendedActions: []
      })
    );
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
