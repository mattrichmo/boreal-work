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

interface WorkRecord {
  readonly meta: { readonly id: string };
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("terminal dependency mutation guards", () => {
  it("rejects dep add, work block, and dep remove for closed, cancelled, and verified work", async () => {
    const rootDir = await createWorkspace();
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

    const resolvedBlocker = await createWork(rootDir, "Resolved dependency blocker");
    await closeWork(rootDir, resolvedBlocker.meta.id, "resolved dependency blocker");

    const closedTarget = await createWork(rootDir, "Closed dependency target", true);
    await addDependency(rootDir, closedTarget.meta.id, resolvedBlocker.meta.id);
    await closeWork(rootDir, closedTarget.meta.id, "closed dependency target");

    const cancelledTarget = await createWork(rootDir, "Cancelled dependency target", true);
    await addDependency(rootDir, cancelledTarget.meta.id, resolvedBlocker.meta.id);
    await runCli(rootDir, [
      "work",
      "cancel",
      cancelledTarget.meta.id,
      "--reason",
      "cancelled dependency target",
      "--dirty-path",
      "no_repo_changes: terminal dependency fixture",
      "--json"
    ]);

    const verifiedTarget = await createWork(rootDir, "Verified dependency target", true);
    await addDependency(rootDir, verifiedTarget.meta.id, resolvedBlocker.meta.id);
    await verifyWork(rootDir, verifiedTarget.meta.id, "verified dependency target");

    const newBlocker = await createWork(rootDir, "New dependency blocker", true);
    const cases = [
      { status: "closed", work: closedTarget },
      { status: "cancelled", work: cancelledTarget },
      { status: "verified", work: verifiedTarget }
    ] as const;

    for (const testCase of cases) {
      assertRejected(
        await runCli(rootDir, ["dep", "add", testCase.work.meta.id, newBlocker.meta.id, "--json"], { expectFailure: true }),
        testCase.status,
        "add"
      );
      assertRejected(
        await runCli(rootDir, ["work", "block", testCase.work.meta.id, newBlocker.meta.id, "--json"], { expectFailure: true }),
        testCase.status,
        "add"
      );
      assertRejected(
        await runCli(rootDir, ["dep", "remove", testCase.work.meta.id, resolvedBlocker.meta.id, "--json"], { expectFailure: true }),
        testCase.status,
        "remove"
      );

      const shown = parseData<{ readonly status: string; readonly dependencyIds: readonly string[] }>(
        (await runCli(rootDir, ["work", "show", testCase.work.meta.id, "--json"])).stdout
      );
      expect(shown).toEqual(
        expect.objectContaining({
          status: testCase.status,
          dependencyIds: [resolvedBlocker.meta.id]
        })
      );
    }
  });
});

async function createWorkspace(): Promise<string> {
  const rootDir = await mkdtemp(join(tmpdir(), "boreal-terminal-dependencies-"));
  tempDirs.push(rootDir);
  return rootDir;
}

async function createWork(rootDir: string, title: string, ready = false): Promise<WorkRecord> {
  return parseData<WorkRecord>(
    (await runCli(rootDir, ["work", "create", title, ...(ready ? ["--ready"] : []), "--json"])).stdout
  );
}

async function addDependency(rootDir: string, blockedWorkId: string, blockingWorkId: string): Promise<void> {
  await runCli(rootDir, ["dep", "add", blockedWorkId, blockingWorkId, "--json"]);
}

async function verifyWork(rootDir: string, workId: string, summary: string): Promise<void> {
  const evidence = parseData<{ readonly meta: { readonly id: string } }>(
    (await runCli(rootDir, ["evidence", "add", workId, "--summary", summary, "--kind", "test", "--outcome", "passed", "--json"])).stdout
  );
  await runCli(rootDir, ["work", "verify", workId, "--evidence", evidence.meta.id, "--verdict", "passed", "--json"]);
}

async function closeWork(rootDir: string, workId: string, reason: string): Promise<void> {
  await verifyWork(rootDir, workId, `${reason} evidence`);
  await runCli(rootDir, [
    "work",
    "close",
    workId,
    "--reason",
    reason,
    "--dirty-path",
    "no_repo_changes: terminal dependency fixture",
    "--json"
  ]);
}

function assertRejected(result: CommandRun, status: string, operation: string): void {
  expect(result.exitCode).toBe(1);
  expect(JSON.parse(result.stderr)).toMatchObject({
    ok: false,
    code: "BOREAL_POLICY_VIOLATION",
    details: expect.objectContaining({ status, operation })
  });
}

async function runCli(
  cwd: string,
  argv: readonly string[],
  options: { readonly expectFailure?: boolean } = {}
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
  const exitCode = await main([...argv], output, cwd);
  if (options.expectFailure) {
    expect(exitCode).not.toBe(0);
    expect(stderr).not.toBe("");
  } else {
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
  }
  return { exitCode, stdout, stderr };
}

function parseData<T>(text: string): T {
  const envelope = JSON.parse(text) as JsonEnvelope<T>;
  expect(envelope.ok).toBe(true);
  return envelope.data;
}
