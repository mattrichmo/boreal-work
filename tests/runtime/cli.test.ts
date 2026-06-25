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
  it("fails closed before init", async () => {
    const rootDir = await makeTempWorkspace();

    const result = await runCli(rootDir, ["work", "list", "--json"]);
    const payload = parseJson<{ readonly code: string; readonly message: string }>(result.stderr);

    expect(result.exitCode).toBe(2);
    expect(payload.code).toBe("BOREAL_INVALID_INPUT");
    expect(payload.message).toContain("not initialized");
  });

  it("runs the work lifecycle through file-backed commands", async () => {
    const rootDir = await makeTempWorkspace();
    const childDir = join(rootDir, "nested");
    await mkdir(childDir);

    const init = await runCli(rootDir, ["init", "--json"]);
    expect(init.exitCode).toBe(0);
    expect(parseJson<{ readonly initialized: boolean }>(init.stdout).initialized).toBe(true);

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
    const work = parseJson<{ readonly meta: { readonly id: string }; readonly status: string }>(created.stdout);
    expect(created.exitCode).toBe(0);
    expect(work.status).toBe("ready");

    const ready = await runCli(rootDir, ["work", "list", "--ready", "--json"]);
    expect(parseJson<Array<{ readonly id: string }>>(ready.stdout).map((item) => item.id)).toContain(work.meta.id);

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
    const evidenceRecord = parseJson<{ readonly meta: { readonly id: string } }>(evidence.stdout);
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
    expect(parseJson<{ readonly verdict: string }>(verification.stdout).verdict).toBe("passed");

    const closed = await runCli(rootDir, ["work", "close", work.meta.id, "--reason", "verified", "--json"]);
    expect(parseJson<{ readonly status: string }>(closed.stdout).status).toBe("closed");

    const repaired = await runCli(rootDir, ["doctor", "--fix", "--json"]);
    const repairedPayload = parseJson<{ readonly ok: boolean; readonly fixed: boolean }>(repaired.stdout);
    expect(repaired.exitCode).toBe(0);
    expect(repairedPayload.ok).toBe(true);
    expect(repairedPayload.fixed).toBe(true);

    const doctor = await runCli(rootDir, ["doctor", "--json"]);
    expect(doctor.exitCode).toBe(0);
    expect(parseJson<{ readonly ok: boolean }>(doctor.stdout).ok).toBe(true);
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
    const payloads = results.map((result) => parseJson<{ readonly initialized: boolean }>(result.stdout));
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
    const rows = parseJson<Array<{ readonly status: string; readonly labels: readonly string[] }>>(listed.stdout);

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
    const failingPayload = parseJson<{ readonly ok: boolean; readonly diagnostics: Array<{ readonly code: string }> }>(
      failingDoctor.stdout
    );
    expect(failingDoctor.exitCode).toBe(1);
    expect(failingPayload.ok).toBe(false);
    expect(failingPayload.diagnostics.map((diagnostic) => diagnostic.code)).toContain("lock.stale");

    const repaired = await runCli(rootDir, ["lock", "break", "--stale-only", "--json"]);
    expect(repaired.exitCode).toBe(0);
    expect(parseJson<{ readonly removed: boolean }>(repaired.stdout).removed).toBe(true);

    const inspection = await runCli(rootDir, ["lock", "inspect", "--json"]);
    expect(parseJson<{ readonly exists: boolean }>(inspection.stdout).exists).toBe(false);
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
