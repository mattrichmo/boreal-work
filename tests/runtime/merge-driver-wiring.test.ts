import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { createRecordMeta, withContentHash, type ActorRef, type EventId, type RuntimeEvent } from "@boreal/core";
import { FileEventLog } from "@boreal/storage";
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

interface DoctorPayload {
  readonly ok: boolean;
  readonly fixed: boolean;
  readonly diagnostics: readonly Array<{
    readonly code: string;
    readonly severity: string;
    readonly message: string;
  }>;
}

const tempDirs: string[] = [];
const actor: ActorRef = { id: "test", kind: "system", displayName: "Test" };

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("merge driver wiring", () => {
  it("init installs the JSONL merge driver config", async () => {
    const rootDir = await createGitWorkspace();

    await runCli(rootDir, ["init", "--json"]);

    const driver = git(rootDir, ["config", "merge.boreal-jsonl.driver"]);
    expect(driver).toContain("boreal-jsonl-merge-driver.mjs");
    expect(driver).toContain("%O %A %B");
  });

  it("doctor detects and fixes a missing JSONL merge driver", async () => {
    const rootDir = await createInitializedGitWorkspace();
    execFileSync("git", ["config", "--unset", "merge.boreal-jsonl.driver"], { cwd: rootDir, stdio: "ignore" });

    const missing = parseData<DoctorPayload>((await runCli(rootDir, ["doctor", "--json"])).stdout);
    expect(missing.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "git.merge-driver-missing", severity: "warning" })])
    );

    const fixed = parseData<DoctorPayload>((await runCli(rootDir, ["doctor", "--fix", "--json"])).stdout);
    expect(fixed.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "git.merge-driver-missing", severity: "fixed" })])
    );
    expect(git(rootDir, ["config", "merge.boreal-jsonl.driver"])).toContain("%O %A %B");
  });

  it("doctor detects an unrechained merged log and fix rechains it", async () => {
    const rootDir = await createInitializedGitWorkspace();
    const eventLogPath = join(rootDir, ".boreal", "log", "events.jsonl");
    await writeRepairableMergedLog(eventLogPath);

    expect((await new FileEventLog({ path: eventLogPath }).verify()).ok).toBe(false);
    const broken = parseData<DoctorPayload>((await runCli(rootDir, ["doctor", "--json"], { expectFailure: true })).stdout);
    expect(broken.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "log.rechain-needed", severity: "error" })])
    );

    const fixed = parseData<DoctorPayload>((await runCli(rootDir, ["doctor", "--fix", "--json"])).stdout);
    expect(fixed.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "log.rechain-needed", severity: "fixed" })])
    );
    expect(await new FileEventLog({ path: eventLogPath }).verify()).toEqual({ ok: true });
  });

  it("doctor reports corrupt logs without auto-fixing them", async () => {
    const rootDir = await createInitializedGitWorkspace();
    const eventLogPath = join(rootDir, ".boreal", "log", "events.jsonl");
    await writeFile(eventLogPath, "{\"not\":\"closed\"\n", "utf8");

    const corrupt = parseData<DoctorPayload>((await runCli(rootDir, ["doctor", "--json"], { expectFailure: true })).stdout);
    expect(corrupt.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "log.corrupt", severity: "error" })])
    );

    const before = await readFile(eventLogPath, "utf8");
    const fixed = parseData<DoctorPayload>((await runCli(rootDir, ["doctor", "--fix", "--json"], { expectFailure: true })).stdout);
    expect(fixed.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "log.corrupt", severity: "error" })])
    );
    expect(await readFile(eventLogPath, "utf8")).toBe(before);
  });
});

async function createInitializedGitWorkspace(): Promise<string> {
  const rootDir = await createGitWorkspace();
  await runCli(rootDir, ["init", "--json"]);
  execFileSync("git", ["add", "."], { cwd: rootDir, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init boreal"], { cwd: rootDir, stdio: "ignore" });
  return rootDir;
}

async function createGitWorkspace(): Promise<string> {
  const rootDir = await mkdtemp(join(tmpdir(), "boreal-merge-driver-"));
  tempDirs.push(rootDir);
  execFileSync("git", ["init", "-b", "main"], { cwd: rootDir, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: rootDir, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: rootDir, stdio: "ignore" });
  await writeFile(join(rootDir, "README.md"), "merge driver wiring\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: rootDir, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: rootDir, stdio: "ignore" });
  return rootDir;
}

async function writeRepairableMergedLog(path: string): Promise<void> {
  const fixtureDir = await mkdtemp(join(tmpdir(), "boreal-merged-log-"));
  tempDirs.push(fixtureDir);
  const common = join(fixtureDir, "common.jsonl");
  const current = join(fixtureDir, "current.jsonl");
  const other = join(fixtureDir, "other.jsonl");

  await new FileEventLog({ path: common }).append("event", testEvent("bw_event_000000000001"));
  const commonText = await readFile(common, "utf8");
  await writeFile(current, commonText, "utf8");
  await writeFile(other, commonText, "utf8");
  await new FileEventLog({ path: current }).append("event", testEvent("bw_event_000000000002"));
  await new FileEventLog({ path: other }).append("event", testEvent("bw_event_000000000003"));

  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    commonText + (await readFile(current, "utf8")).slice(commonText.length) + (await readFile(other, "utf8")).slice(commonText.length),
    "utf8"
  );
}

function testEvent(id: EventId): RuntimeEvent {
  return withContentHash({
    meta: createRecordMeta({
      id,
      actor,
      now: "2026-07-05T00:00:00.000Z"
    }),
    type: "test.event",
    subjectId: id,
    subjectType: "workspace",
    payload: {}
  } satisfies RuntimeEvent);
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
  } else {
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  }
  return { exitCode, stdout, stderr };
}

function parseData<T>(text: string): T {
  const envelope = JSON.parse(text) as JsonEnvelope<T>;
  expect(envelope.ok).toBe(true);
  return envelope.data;
}

function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}
