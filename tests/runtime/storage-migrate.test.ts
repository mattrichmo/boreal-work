import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createBorealRuntime } from "@boreal/engine";
import { FileBorealStore } from "@boreal/storage";

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

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("storage migration", () => {
  it("migrates a file-store workspace to objects and back", async () => {
    const rootDir = await makeTempWorkspace();
    const runtime = createBorealRuntime({ store: new FileBorealStore({ rootDir }) });
    await runtime.ensureWorkspaceInitialized();
    const a = await runtime.createWork({ title: "a", kind: "task", ready: true });
    const b = await runtime.createWork({ title: "b", kind: "task", ready: true });
    await runtime.createWork({ title: "c", kind: "task", ready: true });
    await runtime.addBlockingDependency({ blockedWorkId: b.meta.id, blockingWorkId: a.meta.id });

    const migrated = parseData<{
      readonly migrated: boolean;
      readonly to: string;
      readonly records: { readonly workItems: number; readonly graphEdges: number };
      readonly eventLog: { readonly ok: boolean; readonly seq: number };
      readonly preflight: { readonly sourceReadable: boolean; readonly sourceStorage: string; readonly targetStorage: string };
      readonly parity: { readonly counts: boolean; readonly contentHash: boolean; readonly sourceContentHash: string; readonly targetContentHash: string };
      readonly rollback: { readonly command: string; readonly sourceRetained: boolean; readonly backupPath?: string };
      readonly stateBackupPath?: string;
    }>((await runCli(rootDir, ["storage", "migrate", "--to", "objects", "--json"])).stdout);

    expect(migrated.migrated).toBe(true);
    expect(migrated.to).toBe("objects-v1");
    expect(migrated.records.workItems).toBe(3);
    expect(migrated.records.graphEdges).toBe(1);
    expect(migrated.eventLog.ok).toBe(true);
    expect(migrated.eventLog.seq).toBeGreaterThan(0);
    expect(migrated.preflight).toEqual({ sourceReadable: true, sourceStorage: "file-v2", targetStorage: "objects-v1" });
    expect(migrated.parity).toMatchObject({ counts: true, contentHash: true });
    expect(migrated.parity.sourceContentHash).toBe(migrated.parity.targetContentHash);
    expect(migrated.rollback).toMatchObject({ command: "bwrk storage migrate --to file --json", sourceRetained: false });
    expect(migrated.rollback.backupPath).toBe(migrated.stateBackupPath);
    expect(migrated.stateBackupPath && existsSync(migrated.stateBackupPath)).toBe(true);
    expect(existsSync(join(rootDir, ".boreal", "runtime", "state.json"))).toBe(false);
    expect(existsSync(join(rootDir, ".boreal", "objects", "work", `${a.meta.id}.json`))).toBe(true);
    expect(JSON.parse(await readFile(join(rootDir, ".boreal", "project.json"), "utf8")).storage).toBe("objects-v1");

    const list = parseData<readonly unknown[]>((await runCli(rootDir, ["work", "list", "--json"])).stdout);
    expect(list).toHaveLength(3);

    const reverted = parseData<{
      readonly migrated: boolean;
      readonly to: string;
      readonly records: { readonly workItems: number; readonly graphEdges: number };
      readonly parity: { readonly counts: boolean; readonly contentHash: boolean; readonly sourceContentHash: string; readonly targetContentHash: string };
      readonly rollback: { readonly command: string; readonly sourceRetained: boolean };
    }>((await runCli(rootDir, ["storage", "migrate", "--to", "file", "--json"])).stdout);
    expect(reverted.migrated).toBe(true);
    expect(reverted.to).toBe("file-v2");
    expect(reverted.records.workItems).toBe(3);
    expect(reverted.records.graphEdges).toBe(1);
    expect(reverted.parity).toMatchObject({ counts: true, contentHash: true });
    expect(reverted.parity.sourceContentHash).toBe(reverted.parity.targetContentHash);
    expect(reverted.rollback).toEqual({ command: "bwrk storage migrate --to objects --json", sourceRetained: true });
    expect(existsSync(join(rootDir, ".boreal", "runtime", "state.json"))).toBe(true);
    expect(JSON.parse(await readFile(join(rootDir, ".boreal", "project.json"), "utf8")).storage).toBe("file-v2");
    const fileList = parseData<readonly unknown[]>((await runCli(rootDir, ["work", "list", "--json"])).stdout);
    expect(fileList).toHaveLength(3);
  });

  it("initializes new workspaces on the object store", async () => {
    const rootDir = await makeTempWorkspace();
    const initialized = parseData<{ readonly storage: { readonly storage: string } }>(
      (await runCli(rootDir, ["init", "--json"])).stdout
    );

    expect(initialized.storage.storage).toBe("objects-v1");
    expect(JSON.parse(await readFile(join(rootDir, ".boreal", "project.json"), "utf8")).storage).toBe("objects-v1");
    expect(existsSync(join(rootDir, ".boreal", "runtime", "state.json"))).toBe(false);
    expect(existsSync(join(rootDir, ".boreal", "log", "events.jsonl"))).toBe(true);

    const created = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "object-backed work", "--ready", "--json"])).stdout
    );
    expect(existsSync(join(rootDir, ".boreal", "objects", "work", `${created.meta.id}.json`))).toBe(true);
  });
});

async function makeTempWorkspace(): Promise<string> {
  const rootDir = await mkdtemp(join(tmpdir(), "boreal-storage-migrate-"));
  tempDirs.push(rootDir);
  return rootDir;
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
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  return { exitCode, stdout, stderr };
}

function parseData<T>(text: string): T {
  const envelope = JSON.parse(text) as JsonEnvelope<T>;
  expect(envelope.ok).toBe(true);
  return envelope.data;
}
