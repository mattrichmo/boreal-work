import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

interface RunOptions {
  readonly env?: Readonly<Record<string, string>>;
}

interface RawAddResult {
  readonly indexPath: string;
  readonly record: {
    readonly id: string;
    readonly title: string;
  };
}

interface DashboardEnvelope {
  readonly ok: true;
  readonly data: {
    readonly schemaVersion: "boreal.cli.dashboard.global.v1";
    readonly globalInbox: {
      readonly summary: {
        readonly queued: number;
        readonly oldestQueuedAgeDays: number | null;
        readonly agingQueuedCount: number;
      };
      readonly policy: {
        readonly agingThresholdDays: number;
        readonly source: string;
      };
      readonly rows: readonly Array<{
        readonly id: string;
        readonly ageDays: number;
        readonly triageCommand: string;
      }>;
    };
  };
  readonly agentDirectives?: readonly Array<{
    readonly directives: readonly Array<{
      readonly registryId: string;
      readonly severity: string;
      readonly nextCommandTemplate: string;
      readonly data: Record<string, unknown>;
    }>;
  }>;
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("global dashboard raw inbox surfacing", () => {
  it("emits inbox counts, oldest age, and advisory directives for aging queued raw sources", async () => {
    const callerRoot = await makeTempDir();
    const registryRoot = await makeTempDir();
    const env = { BOREAL_PROJECT_REGISTRY_ROOT: registryRoot };

    await runJson(callerRoot, ["init", "--json"], { env });
    await runJson(callerRoot, ["global", "init", "--registry-root", registryRoot, "--json"], { env });
    const raw = await runJson<RawAddResult>(callerRoot, ["capture", "Aged inbox note", "--json"], { env });
    await rewriteRawAddedAt(raw.indexPath, raw.record.id, "2026-06-20T00:00:00.000Z");

    const envelope = await runEnvelope(callerRoot, [
      "dashboard",
      "global",
      "--registry-root",
      registryRoot,
      "--inbox-aging-days",
      "7",
      "--json"
    ], { env });
    const oldestAge = envelope.data.globalInbox.summary.oldestQueuedAgeDays;
    expect(envelope.data.globalInbox.policy).toMatchObject({
      agingThresholdDays: 7,
      source: "flag"
    });
    expect(envelope.data.globalInbox.summary).toMatchObject({
      queued: 1,
      agingQueuedCount: 1
    });
    expect(oldestAge).toBeGreaterThanOrEqual(7);
    expect(envelope.data.globalInbox.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: raw.record.id,
          triageCommand: `bwrk global raw triage <action> ${raw.record.id} --json`
        })
      ])
    );

    const directives = envelope.agentDirectives?.flatMap((bundle) => bundle.directives) ?? [];
    expect(directives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          registryId: "inbox.triage-aging",
          severity: "advisory",
          nextCommandTemplate: "bwrk global raw triage <action> <raw-id> --json",
          data: expect.objectContaining({
            rawSourceIds: [raw.record.id],
            rawSourceCount: 1,
            oldestRawSourceId: raw.record.id,
            thresholdDays: 7,
            command: `bwrk global raw triage <action> ${raw.record.id} --json`
          })
        })
      ])
    );
  });
});

async function rewriteRawAddedAt(indexPath: string, rawSourceId: string, addedAt: string): Promise<void> {
  const lines = (await readFile(indexPath, "utf8")).split(/\r?\n/u);
  const rewritten = lines.map((line) => {
    if (!line.trim()) {
      return line;
    }
    const record = JSON.parse(line) as { readonly id?: string; readonly [key: string]: unknown };
    return record.id === rawSourceId ? JSON.stringify({ ...record, addedAt }) : line;
  });
  await writeFile(indexPath, rewritten.join("\n"), "utf8");
}

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "boreal-global-inbox-"));
  tempDirs.push(dir);
  return dir;
}

async function runJson<T>(cwd: string, argv: readonly string[], options: RunOptions = {}): Promise<T> {
  const envelope = await runEnvelope(cwd, argv, options);
  return envelope.data as T;
}

async function runEnvelope(cwd: string, argv: readonly string[], options: RunOptions = {}): Promise<DashboardEnvelope> {
  expect(argv).toContain("--json");
  const result = await runCli(cwd, argv, options);
  expect(result.stderr).toBe("");
  expect(result.exitCode, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0);
  return JSON.parse(result.stdout) as DashboardEnvelope;
}

async function runCli(cwd: string, argv: readonly string[], options: RunOptions = {}): Promise<CommandRun> {
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
  const previousEnv = new Map(Object.keys(options.env ?? {}).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(options.env ?? {})) {
      process.env[key] = value;
    }
    const exitCode = await main([...argv], output, cwd);
    return { exitCode, stdout, stderr };
  } finally {
    for (const [key, value] of previousEnv) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}
