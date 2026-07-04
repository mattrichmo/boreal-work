import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("git branch lifecycle", () => {
  it("claim creates and records the work branch", async () => {
    const rootDir = await createTestWorkspace({ git: true });
    await runCli(rootDir, ["init", "--json"]);
    const created = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Fix parser", "--kind", "task", "--ready", "--json"])).stdout
    );

    await runCli(rootDir, ["agent", "start", created.meta.id, "--agent", "a1", "--json"]);

    const branch = git(rootDir, ["symbolic-ref", "--short", "HEAD"]);
    expect(branch).toBe(`work/${created.meta.id.slice(-8)}-fix-parser`);
    const show = parseData<{
      readonly reservation?: { readonly git?: { readonly branch: string; readonly baseSha: string } };
    }>((await runCli(rootDir, ["work", "show", created.meta.id, "--json"])).stdout);
    expect(show.reservation?.git?.branch).toBe(branch);
    expect(show.reservation?.git?.baseSha).toMatch(/^[a-f0-9]{40}$/);
  });

  it("claim with --no-branch skips git entirely", async () => {
    const rootDir = await createTestWorkspace({ git: true });
    await runCli(rootDir, ["init", "--json"]);
    const created = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "No branch", "--kind", "task", "--ready", "--json"])).stdout
    );

    await runCli(rootDir, ["agent", "start", created.meta.id, "--agent", "a1", "--no-branch", "--json"]);

    expect(git(rootDir, ["symbolic-ref", "--short", "HEAD"])).toBe("main");
    const show = parseData<{
      readonly reservation?: { readonly git?: { readonly branch: string; readonly baseSha: string } };
    }>((await runCli(rootDir, ["work", "show", created.meta.id, "--json"])).stdout);
    expect(show.reservation?.git).toBeUndefined();
  });

  it("claim in a non-git directory succeeds with an info note", async () => {
    const rootDir = await createTestWorkspace({ git: false });
    await runCli(rootDir, ["init", "--json"]);
    const created = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "No repo", "--kind", "task", "--ready", "--json"])).stdout
    );

    const started = parseData<{ readonly gitBranch?: { readonly status: string; readonly reason: string } }>(
      (await runCli(rootDir, ["agent", "start", created.meta.id, "--agent", "a1", "--json"])).stdout
    );

    expect(started.gitBranch).toEqual({ status: "skipped", reason: "not_git_repository" });
  });
});

async function createTestWorkspace(options: { readonly git: boolean }): Promise<string> {
  const rootDir = await mkdtemp(join(tmpdir(), "boreal-git-branch-"));
  tempDirs.push(rootDir);
  if (options.git) {
    execFileSync("git", ["init", "-b", "main"], { cwd: rootDir, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: rootDir, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "Test User"], { cwd: rootDir, stdio: "ignore" });
    await writeFile(join(rootDir, "README.md"), "git branch lifecycle\n", "utf8");
    execFileSync("git", ["add", "README.md"], { cwd: rootDir, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "init"], { cwd: rootDir, stdio: "ignore" });
  }
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

function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}
