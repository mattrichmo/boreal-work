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

interface RunOptions {
  readonly env?: Readonly<Record<string, string>>;
}

interface RegistryImportResult {
  readonly entry: {
    readonly id: string;
    readonly display: {
      readonly name: string;
    };
  };
}

interface RawAddResult {
  readonly record: {
    readonly id: string;
    readonly title: string;
  };
}

interface RawTriageResult {
  readonly action: "promote" | "keep-global" | "drop";
  readonly provenanceUri: string;
  readonly targetProject?: {
    readonly id: string;
    readonly name: string;
    readonly root: string;
  };
  readonly targetRecord?: {
    readonly meta: {
      readonly id: string;
      readonly sourceRefs: readonly Array<{
        readonly uri: string;
        readonly label?: string;
      }>;
    };
    readonly status?: string;
    readonly uri?: string;
  };
  readonly targetRecordKind?: string;
  readonly targetRecordUri?: string;
  readonly triageEvent: {
    readonly subjectId: string;
    readonly payload: {
      readonly outcome: string;
      readonly targetProjectId?: string;
      readonly targetRecordId?: string;
      readonly reason?: string;
    };
  };
}

interface RawSourceRow {
  readonly id: string;
  readonly processingStatus: string;
  readonly triage?: {
    readonly outcome: string;
    readonly targetProjectId?: string;
    readonly targetRecordId?: string;
    readonly reason?: string;
  };
}

interface CliError {
  readonly ok: false;
  readonly code: string;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("global raw triage routing", () => {
  it("routes global raw inbox items into linked projects with provenance", async () => {
    const callerRoot = await makeTempDir();
    const projectRoot = await makeTempDir();
    const registryRoot = await makeTempDir();
    const env = { BOREAL_PROJECT_REGISTRY_ROOT: registryRoot };

    await runJson(projectRoot, ["init", "--setup-memory", "--json"], { env });
    const imported = await runJson<RegistryImportResult>(projectRoot, [
      "registry",
      "import-setup",
      "--registry-root",
      registryRoot,
      "--name",
      "Target Project",
      "--json"
    ], { env });

    const promotedSource = await runJson<RawAddResult>(callerRoot, [
      "capture",
      "Promote me",
      "--label",
      "triage",
      "--json"
    ], { env });
    const provenanceUri = `boreal://global/${promotedSource.record.id}`;
    const promoted = await runJson<RawTriageResult>(callerRoot, [
      "raw",
      "triage",
      "promote",
      promotedSource.record.id,
      "--to",
      imported.entry.id,
      "--as",
      "work",
      "--title",
      "Routed Work",
      "--ready",
      "--global",
      "--json"
    ], { env });

    expect(promoted).toMatchObject({
      action: "promote",
      provenanceUri,
      targetProject: {
        id: imported.entry.id,
        name: "Target Project",
        root: projectRoot
      },
      targetRecordKind: "work"
    });
    expect(promoted.targetRecord?.status).toBe("ready");
    expect(promoted.targetRecord?.meta.sourceRefs).toContainEqual({
      uri: provenanceUri,
      label: "global raw capture"
    });
    expect(promoted.targetRecordUri).toBe(`boreal://${imported.entry.id}/${promoted.targetRecord?.meta.id}`);
    expect(rawRow(await rawList(callerRoot, env), promotedSource.record.id)).toMatchObject({
      processingStatus: "routed",
      triage: {
        outcome: "promoted",
        targetProjectId: imported.entry.id,
        targetRecordId: promoted.targetRecord?.meta.id
      }
    });

    const keptSource = await runJson<RawAddResult>(callerRoot, ["capture", "Keep me", "--json"], { env });
    const kept = await runJson<RawTriageResult>(callerRoot, [
      "raw",
      "triage",
      "keep-global",
      keptSource.record.id,
      "--as",
      "source",
      "--global",
      "--json"
    ], { env });
    expect(kept).toMatchObject({
      action: "keep-global",
      provenanceUri: `boreal://global/${keptSource.record.id}`,
      targetProject: {
        id: "global",
        name: "Global workspace",
        root: registryRoot
      },
      targetRecordKind: "source"
    });
    expect(kept.targetRecord?.uri).toBe(`boreal://global/${keptSource.record.id}`);
    expect(rawRow(await rawList(callerRoot, env), keptSource.record.id)).toMatchObject({
      processingStatus: "kept_global",
      triage: {
        outcome: "kept_global",
        targetProjectId: "global",
        targetRecordId: kept.targetRecord?.meta.id
      }
    });

    const droppedSource = await runJson<RawAddResult>(callerRoot, ["capture", "Drop me", "--json"], { env });
    const dropped = await runJson<RawTriageResult>(callerRoot, [
      "raw",
      "triage",
      "drop",
      droppedSource.record.id,
      "--reason",
      "duplicate",
      "--global",
      "--json"
    ], { env });
    expect(dropped).toMatchObject({
      action: "drop",
      provenanceUri: `boreal://global/${droppedSource.record.id}`,
      triageEvent: {
        subjectId: droppedSource.record.id,
        payload: {
          outcome: "dropped",
          reason: "duplicate"
        }
      }
    });
    expect(rawRow(await rawList(callerRoot, env), droppedSource.record.id)).toMatchObject({
      processingStatus: "dropped",
      triage: {
        outcome: "dropped",
        reason: "duplicate"
      }
    });

    await runJson(callerRoot, [
      "registry",
      "set-state",
      imported.entry.id,
      "--state",
      "archived",
      "--registry-root",
      registryRoot,
      "--json"
    ], { env });
    const blockedSource = await runJson<RawAddResult>(callerRoot, ["capture", "Blocked route", "--json"], { env });
    const blocked = await runCli(callerRoot, [
      "raw",
      "triage",
      "promote",
      blockedSource.record.id,
      "--to",
      imported.entry.id,
      "--as",
      "work",
      "--global",
      "--json"
    ], { env });
    expect(blocked.exitCode).toBe(1);
    expect(blocked.stdout).toBe("");
    expect(parseJson<CliError>(blocked.stderr)).toMatchObject({
      ok: false,
      code: "BOREAL_POLICY_VIOLATION",
      details: {
        projectId: imported.entry.id,
        lifecycle: "archived"
      }
    });
  });
});

async function rawList(cwd: string, env: Readonly<Record<string, string>>): Promise<readonly RawSourceRow[]> {
  return runJson<readonly RawSourceRow[]>(cwd, ["raw", "list", "--global", "--json"], { env });
}

function rawRow(rows: readonly RawSourceRow[], id: string): RawSourceRow {
  const row = rows.find((candidate) => candidate.id === id);
  expect(row, `expected raw list to contain ${id}`).toBeDefined();
  return row as RawSourceRow;
}

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "boreal-global-triage-"));
  tempDirs.push(dir);
  return dir;
}

async function runJson<T>(cwd: string, argv: readonly string[], options: RunOptions = {}): Promise<T> {
  expect(argv).toContain("--json");
  const result = await runCli(cwd, argv, options);
  expect(result.stderr).toBe("");
  expect(result.exitCode, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0);
  return parseJson<{ readonly ok: true; readonly data: T }>(result.stdout).data;
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

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}
