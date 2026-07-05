import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { workWorktreePath } from "../../apps/cli/src/git-branch.ts";
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

interface StartedWork {
  readonly action: string;
  readonly gitBranch?: {
    readonly status: string;
    readonly branch: string;
    readonly baseSha: string;
    readonly worktreePath?: string;
  };
  readonly reservation?: {
    readonly git?: {
      readonly branch: string;
      readonly baseSha: string;
      readonly worktreePath?: string;
    };
  };
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("git worktree lifecycle", () => {
  it("claim with --worktree creates a sibling worktree without moving the main checkout", async () => {
    const rootDir = await createTestWorkspace();
    await runCli(rootDir, ["init", "--json"]);
    const initialBranch = git(rootDir, ["symbolic-ref", "--short", "HEAD"]);
    const initialHead = git(rootDir, ["rev-parse", "HEAD"]);
    const repoRoot = git(rootDir, ["rev-parse", "--show-toplevel"]);
    const created = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Worktree claim", "--kind", "task", "--ready", "--json"])).stdout
    );
    const expectedBranch = `work/${created.meta.id.slice(-8)}-worktree-claim`;
    const expectedPath = workWorktreePath(repoRoot, expectedBranch);
    tempDirs.push(expectedPath);

    const started = parseData<StartedWork>(
      (await runCli(rootDir, ["agent", "start", created.meta.id, "--agent", "a1", "--worktree", "--json"])).stdout
    );

    expect(git(rootDir, ["symbolic-ref", "--short", "HEAD"])).toBe(initialBranch);
    expect(git(rootDir, ["rev-parse", "HEAD"])).toBe(initialHead);
    expect(existsSync(join(expectedPath, ".git"))).toBe(true);
    expect(git(expectedPath, ["symbolic-ref", "--short", "HEAD"])).toBe(expectedBranch);
    expect(git(expectedPath, ["rev-parse", "HEAD"])).toBe(initialHead);
    expect(started.gitBranch).toEqual({
      status: "recorded",
      branch: expectedBranch,
      baseSha: initialHead,
      worktreePath: expectedPath
    });

    const show = parseData<{
      readonly reservation?: { readonly git?: { readonly branch: string; readonly baseSha: string; readonly worktreePath?: string } };
    }>((await runCli(rootDir, ["work", "show", created.meta.id, "--json"])).stdout);
    expect(show.reservation?.git).toEqual({
      branch: expectedBranch,
      baseSha: initialHead,
      worktreePath: expectedPath
    });
  });

  it("concurrent worktree claims do not contend on the main checkout branch", async () => {
    const rootDir = await createTestWorkspace();
    await runCli(rootDir, ["init", "--json"]);
    const initialBranch = git(rootDir, ["symbolic-ref", "--short", "HEAD"]);
    const repoRoot = git(rootDir, ["rev-parse", "--show-toplevel"]);
    const first = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "First concurrent", "--kind", "task", "--ready", "--json"])).stdout
    );
    const second = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Second concurrent", "--kind", "task", "--ready", "--json"])).stdout
    );
    const firstBranch = `work/${first.meta.id.slice(-8)}-first-concurrent`;
    const secondBranch = `work/${second.meta.id.slice(-8)}-second-concurrent`;
    const firstPath = workWorktreePath(repoRoot, firstBranch);
    const secondPath = workWorktreePath(repoRoot, secondBranch);
    tempDirs.push(firstPath, secondPath);

    const [firstStarted, secondStarted] = await Promise.all([
      runCli(rootDir, ["agent", "start", first.meta.id, "--agent", "a1", "--worktree", "--json"]),
      runCli(rootDir, ["agent", "start", second.meta.id, "--agent", "a2", "--worktree", "--json"])
    ]);

    expect(parseData<StartedWork>(firstStarted.stdout).gitBranch?.worktreePath).toBe(firstPath);
    expect(parseData<StartedWork>(secondStarted.stdout).gitBranch?.worktreePath).toBe(secondPath);
    expect(git(rootDir, ["symbolic-ref", "--short", "HEAD"])).toBe(initialBranch);
    expect(git(firstPath, ["symbolic-ref", "--short", "HEAD"])).toBe(firstBranch);
    expect(git(secondPath, ["symbolic-ref", "--short", "HEAD"])).toBe(secondBranch);
    const worktrees = git(rootDir, ["worktree", "list", "--porcelain"]);
    expect(worktrees).toContain(firstPath);
    expect(worktrees).toContain(secondPath);
  });

  it("reuses an existing sibling worktree when it is already on the target branch", async () => {
    const rootDir = await createTestWorkspace();
    await runCli(rootDir, ["init", "--json"]);
    const initialBranch = git(rootDir, ["symbolic-ref", "--short", "HEAD"]);
    const repoRoot = git(rootDir, ["rev-parse", "--show-toplevel"]);
    const created = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Reuse worktree", "--kind", "task", "--ready", "--json"])).stdout
    );
    const expectedBranch = `work/${created.meta.id.slice(-8)}-reuse-worktree`;
    const expectedPath = workWorktreePath(repoRoot, expectedBranch);
    tempDirs.push(expectedPath);
    execFileSync("git", ["-C", rootDir, "worktree", "add", "-b", expectedBranch, expectedPath, "HEAD"], { stdio: "ignore" });

    const started = parseData<StartedWork>(
      (await runCli(rootDir, ["agent", "start", created.meta.id, "--agent", "a1", "--worktree", "--json"])).stdout
    );

    expect(started.action).toBe("claimed_work");
    expect(started.reservation?.git?.worktreePath).toBe(expectedPath);
    expect(started.gitBranch?.worktreePath).toBe(expectedPath);
    expect(git(rootDir, ["symbolic-ref", "--short", "HEAD"])).toBe(initialBranch);
    expect(git(expectedPath, ["symbolic-ref", "--short", "HEAD"])).toBe(expectedBranch);
  });

  it("rejects --worktree with --no-branch before claiming work", async () => {
    const rootDir = await createTestWorkspace();
    await runCli(rootDir, ["init", "--json"]);
    const created = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Invalid worktree flags", "--kind", "task", "--ready", "--json"])).stdout
    );

    const result = await runCli(rootDir, ["agent", "start", created.meta.id, "--agent", "a1", "--worktree", "--no-branch", "--json"], {
      expectFailure: true
    });

    expect(JSON.parse(result.stderr)).toMatchObject({
      code: "BOREAL_INVALID_INPUT",
      message: "--worktree cannot be combined with --no-branch"
    });
    const show = parseData<{ readonly status: string; readonly reservation?: unknown }>(
      (await runCli(rootDir, ["work", "show", created.meta.id, "--json"])).stdout
    );
    expect(show.status).toBe("ready");
    expect(show.reservation).toBeUndefined();
  });
});

async function createTestWorkspace(): Promise<string> {
  const rootDir = await mkdtemp(join(tmpdir(), "boreal-git-worktree-"));
  tempDirs.push(rootDir);
  execFileSync("git", ["init", "-b", "main"], { cwd: rootDir, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: rootDir, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: rootDir, stdio: "ignore" });
  await writeFile(join(rootDir, "README.md"), "git worktree lifecycle\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: rootDir, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: rootDir, stdio: "ignore" });
  return rootDir;
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
