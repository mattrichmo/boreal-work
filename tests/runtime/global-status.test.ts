import { mkdtemp, rm } from "node:fs/promises";
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

interface JsonEnvelope<T> {
  readonly ok: boolean;
  readonly data: T;
}

interface CreatedWork {
  readonly meta: { readonly id: string };
}

interface GlobalStatusProject {
  readonly projectId: string;
  readonly rootDir: string;
  readonly storage?: string;
  readonly workOpen?: number;
  readonly workReady?: number;
  readonly workBlocked?: number;
  readonly activeReservations?: number;
  readonly lastEventAt?: string;
  readonly ok: boolean;
  readonly error?: string;
}

interface GlobalStatusPayload {
  readonly schemaVersion: string;
  readonly projectCount: number;
  readonly okCount: number;
  readonly errorCount: number;
  readonly projects: readonly GlobalStatusProject[];
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("global status", () => {
  it("summarizes registered projects read-only, keeps broken projects as rows, and gates strict exit", async () => {
    const registryRoot = await createTempDir("boreal-global-status-registry-");
    const validRoot = await createTempDir("boreal-global-status-valid-");
    const brokenRoot = await createTempDir("boreal-global-status-broken-");

    await runCli(validRoot, ["init", "--setup-memory", "--json"]);
    await runCli(brokenRoot, ["init", "--setup-memory", "--json"]);
    await runCli(validRoot, ["registry", "add", "--workspace", validRoot, "--registry-root", registryRoot, "--name", "valid-project", "--json"]);
    await runCli(validRoot, ["registry", "add", "--workspace", brokenRoot, "--registry-root", registryRoot, "--name", "broken-project", "--json"]);

    const ready = await createWork(validRoot, "Global status ready");
    const blocker = await createWork(validRoot, "Global status blocker");
    const blocked = await createWork(validRoot, "Global status blocked");
    const reserved = await createWork(validRoot, "Global status reserved");
    await runCli(validRoot, ["dep", "add", blocked.meta.id, blocker.meta.id, "--json"]);
    await runCli(validRoot, ["work", "reserve", reserved.meta.id, "--agent", "global-status-agent", "--ttl", "1h", "--json"]);
    expect(ready.meta.id).toMatch(/^bw_work_/);

    await rm(brokenRoot, { recursive: true, force: true });

    const env = { BOREAL_PROJECT_REGISTRY_ROOT: registryRoot };
    const status = parseData<GlobalStatusPayload>(
      (await runCli(validRoot, ["global", "status", "--registry-root", registryRoot, "--json"], { env })).stdout
    );

    expect(status).toEqual(
      expect.objectContaining({
        schemaVersion: "boreal.cli.global.status.v1",
        projectCount: 2,
        okCount: 1,
        errorCount: 1
      })
    );
    const valid = status.projects.find((project) => project.rootDir === validRoot);
    expect(valid).toEqual(
      expect.objectContaining({
        ok: true,
        workOpen: 4,
        workReady: 2,
        workBlocked: 1,
        activeReservations: 1
      })
    );
    expect(valid?.storage).toMatch(/^(file-v2|objects-v1)$/u);
    expect(Date.parse(valid?.lastEventAt ?? "")).not.toBeNaN();

    const broken = status.projects.find((project) => project.rootDir === brokenRoot);
    expect(broken).toEqual(
      expect.objectContaining({
        ok: false,
        error: "Registered project root is missing"
      })
    );

    const human = (await runCli(validRoot, ["global", "status", "--registry-root", registryRoot], { env })).stdout;
    expect(human).toContain("global status: 1/2 project(s) readable");
    expect(human).toContain(validRoot);
    expect(human).toContain("Registered project root is missing");

    const strict = await runCli(validRoot, ["global", "status", "--registry-root", registryRoot, "--strict", "--json"], {
      env,
      expectExitCode: 1
    });
    expect(strict.stderr).toBe("");
    expect(parseData<GlobalStatusPayload>(strict.stdout).errorCount).toBe(1);
  });
});

async function createTempDir(prefix: string): Promise<string> {
  const rootDir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(rootDir);
  return rootDir;
}

async function createWork(rootDir: string, title: string): Promise<CreatedWork> {
  return parseData<CreatedWork>((await runCli(rootDir, ["work", "create", title, "--ready", "--json"])).stdout);
}

async function runCli(
  cwd: string,
  argv: readonly string[],
  options: { readonly env?: Record<string, string>; readonly expectExitCode?: number } = {}
): Promise<CommandRun> {
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
  const previousEnv = setTemporaryEnv(options.env ?? {});
  try {
    const exitCode = await main([...argv], output, cwd);
    expect(exitCode).toBe(options.expectExitCode ?? 0);
    if ((options.expectExitCode ?? 0) === 0) {
      expect(stderr).toBe("");
    }
    return { exitCode, stdout, stderr };
  } finally {
    restoreTemporaryEnv(previousEnv);
  }
}

function parseData<T>(text: string): T {
  const envelope = JSON.parse(text) as JsonEnvelope<T>;
  expect(envelope.ok).toBe(true);
  return envelope.data;
}

function setTemporaryEnv(env: Record<string, string>): Map<string, string | undefined> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(env)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  return previous;
}

function restoreTemporaryEnv(previous: Map<string, string | undefined>): void {
  for (const [key, value] of previous) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
