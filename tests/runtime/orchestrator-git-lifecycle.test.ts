import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { workBranchName, workWorktreePath } from "../../apps/cli/src/git-branch.ts";
import { main } from "../../apps/cli/src/index.ts";
import type { CliOutput } from "../../apps/cli/src/output.ts";

interface CommandRun {
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

describe("orchestrator agent-session Git lifecycle", () => {
  it("dispatches a sibling worktree and observes canonical agent closeout", async () => {
    const rootDir = await createTestWorkspace();
    await runCli(rootDir, ["init", "--json"]);
    const initialBranch = git(rootDir, ["symbolic-ref", "--short", "HEAD"]);
    const initialHead = git(rootDir, ["rev-parse", "HEAD"]);
    const root = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Orchestrator root", "--kind", "sprint", "--json"])).stdout
    );
    const child = parseData<{ readonly meta: { readonly id: string }; readonly title: string }>(
      (await runCli(rootDir, ["work", "create", "Orchestrated child", "--kind", "task", "--ready", "--json"])).stdout
    );
    await runCli(rootDir, ["work", "block", root.meta.id, child.meta.id, "--json"]);

    const started = parseData<{
      readonly run: { readonly meta: { readonly id: string }; readonly sessionId?: string; readonly worktree?: boolean };
      readonly tick: {
        readonly assigned: readonly Array<{
          readonly workId: string;
          readonly sessionId?: string;
          readonly git?: { readonly branch: string; readonly baseSha: string; readonly worktreePath?: string };
        }>;
      };
    }>(
      (
        await runCli(rootDir, [
          "orchestrate",
          "start",
          root.meta.id,
          "--agent",
          "a1",
          "--session",
          "orchestrator-session",
          "--worktree",
          "--dispatch",
          "--json"
        ])
      ).stdout
    );

    const assignment = started.tick.assigned[0];
    expect(started.run).toMatchObject({ sessionId: "orchestrator-session", worktree: true });
    expect(assignment).toMatchObject({ workId: child.meta.id, sessionId: "orchestrator-session" });
    expect(assignment?.git?.baseSha).toBe(initialHead);
    expect(git(rootDir, ["symbolic-ref", "--short", "HEAD"])).toBe(initialBranch);
    expect(git(rootDir, ["rev-parse", "HEAD"])).toBe(initialHead);

    const repoRoot = git(rootDir, ["rev-parse", "--show-toplevel"]);
    const expectedBranch = workBranchName({
      kind: "task",
      title: child.title,
      meta: { id: child.meta.id }
    });
    const expectedPath = workWorktreePath(repoRoot, expectedBranch);
    tempDirs.push(expectedPath);
    expect(assignment?.git).toEqual({ branch: expectedBranch, baseSha: initialHead, worktreePath: expectedPath });
    expect(existsSync(join(expectedPath, ".git"))).toBe(true);

    await writeFile(join(expectedPath, "orchestrator-child.txt"), "closed through the agent lifecycle\n", "utf8");
    execFileSync("git", ["add", "orchestrator-child.txt"], { cwd: expectedPath, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "finish orchestrated child"], { cwd: expectedPath, stdio: "ignore" });
    const closeoutHead = git(expectedPath, ["rev-parse", "HEAD"]);

    await runCli(rootDir, [
      "agent",
      "finish",
      child.meta.id,
      "--agent",
      "a1",
      "--summary",
      "Orchestrated child committed and verified in its assigned worktree.",
      "--kind",
      "test",
      "--outcome",
      "passed",
      "--verdict",
      "passed",
      "--close",
      "--reason",
      "Canonical agent closeout completed.",
      "--commit",
      closeoutHead,
      "--remove-worktree",
      "--json"
    ]);

    const ticked = parseData<{
      readonly run: {
        readonly assignments: readonly Array<{
          readonly state: string;
          readonly evidenceIds?: readonly string[];
          readonly verificationIds?: readonly string[];
          readonly agentSummaryIds?: readonly string[];
          readonly commitShas?: readonly string[];
          readonly satisfiedCloseoutGateIds?: readonly string[];
        }>;
      };
    }>((await runCli(rootDir, ["orchestrate", "tick", started.run.meta.id, "--json"])).stdout);

    expect(ticked.run.assignments[0]).toMatchObject({ state: "completed" });
    expect(ticked.run.assignments[0]?.evidenceIds?.length).toBeGreaterThan(0);
    expect(ticked.run.assignments[0]?.verificationIds?.length).toBeGreaterThan(0);
    expect(ticked.run.assignments[0]?.agentSummaryIds?.length).toBeGreaterThan(0);
    expect(ticked.run.assignments[0]?.commitShas).toContain(closeoutHead);
    expect(existsSync(expectedPath)).toBe(false);
  }, 30_000);
});

async function createTestWorkspace(): Promise<string> {
  const rootDir = await mkdtemp(join(tmpdir(), "boreal-orchestrator-git-"));
  tempDirs.push(rootDir);
  execFileSync("git", ["init", "-b", "main"], { cwd: rootDir, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: rootDir, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: rootDir, stdio: "ignore" });
  await writeFile(join(rootDir, "README.md"), "orchestrator lifecycle\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: rootDir, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: rootDir, stdio: "ignore" });
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
  expect(exitCode, stderr).toBe(0);
  expect(stderr).toBe("");
  return { stdout, stderr };
}

function parseData<T>(text: string): T {
  return (JSON.parse(text) as JsonEnvelope<T>).data;
}

function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}
