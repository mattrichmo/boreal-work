import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { main } from "../../apps/cli/src/index.ts";
import type { CliOutput } from "../../apps/cli/src/output.ts";

interface CommandRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("bwrk cli", () => {
  it("documents every current command group", async () => {
    const commands = await readFile(new URL("../../docs/cli/COMMANDS.md", import.meta.url), "utf8");

    for (const heading of [
      "## Help",
      "## `init`",
      "## `commands`",
      "## `work create`",
      "## `work ready`",
      "## `work list`",
      "## `work show`",
      "## `work block`",
      "## `work reserve`",
      "## `evidence add`",
      "## `work verify`",
      "## `work close`",
      "## `doctor`",
      "## `lock inspect`",
      "## `lock break`"
    ]) {
      expect(commands).toContain(heading);
    }
  });

  it("prints root and grouped help without a workspace", async () => {
    const rootDir = await makeTempWorkspace();

    const root = await runCli(rootDir, ["help"]);
    const work = await runCli(rootDir, ["help", "work"]);
    const workWithFlag = await runCli(rootDir, ["help", "work", "--help"]);
    const doctor = await runCli(rootDir, ["doctor", "--help"]);

    expect(root.exitCode).toBe(0);
    expect(root.stdout).toContain("bwrk - Boreal Work CLI");
    expect(root.stdout).toContain("bwrk help [init|work|evidence|doctor|lock|commands]");
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

  it("exposes the registered command surface as JSON", async () => {
    const rootDir = await makeTempWorkspace();

    const result = await runCli(rootDir, ["commands", "--json"]);
    const registry = parseData<{
      readonly commands: Array<{
        readonly path: readonly string[];
        readonly flags: Array<{ readonly name: string; readonly type: string }>;
      }>;
    }>(result.stdout);
    const reserve = registry.commands.find((command) => command.path.join(" ") === "work reserve");

    expect(result.exitCode).toBe(0);
    expect(registry.commands.map((command) => command.path.join(" "))).toContain("commands");
    expect(reserve?.flags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "force", type: "boolean" }),
        expect.objectContaining({ name: "reason", type: "value" })
      ])
    );
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
});

async function makeTempWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "boreal-cli-"));
  tempDirs.push(dir);
  return dir;
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

async function writeLockOwner(rootDir: string, createdAt: string): Promise<void> {
  const lockDir = join(rootDir, ".boreal/runtime/state.lock");
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
