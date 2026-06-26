import { execFile } from "node:child_process";

import type { CliContext } from "./context.js";

const DEFAULT_PROTECTED_BRANCHES = ["main", "master", "trunk"] as const;
const COLLABORATION_PATHS = [".boreal/ledgers", "memory"] as const;

export interface GitDirtyPath {
  readonly status: string;
  readonly path: string;
}

export interface GitWorktreeInspection {
  readonly ok: boolean;
  readonly available: boolean;
  readonly insideWorktree: boolean;
  readonly workspaceRoot: string;
  readonly gitRoot?: string;
  readonly branch?: string;
  readonly detached: boolean;
  readonly protectedBranch: boolean;
  readonly protectedBranches: readonly string[];
  readonly checkedPaths: readonly string[];
  readonly collaborationDirtyPaths: readonly GitDirtyPath[];
  readonly recommendedActions: readonly string[];
  readonly error?: string;
}

export async function inspectGitWorktree(context: CliContext): Promise<GitWorktreeInspection> {
  const protectedBranches = protectedBranchNames();
  const base = {
    workspaceRoot: context.workspaceRoot,
    protectedBranches,
    checkedPaths: COLLABORATION_PATHS
  };

  const root = await runGit(context.workspaceRoot, ["rev-parse", "--show-toplevel"]);
  if (!root.ok) {
    return {
      ...base,
      ok: true,
      available: !isMissingGit(root),
      insideWorktree: false,
      detached: false,
      protectedBranch: false,
      collaborationDirtyPaths: [],
      recommendedActions: [],
      error: isMissingGit(root) ? root.error : undefined
    };
  }

  const branchResult = await runGit(context.workspaceRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const branch = branchResult.ok ? branchResult.stdout.trim() : undefined;
  const detached = branch === "HEAD" || !branch;
  const protectedBranch = Boolean(branch && protectedBranches.includes(branch));
  const status = await runGit(context.workspaceRoot, ["status", "--porcelain=v1", "--", ...COLLABORATION_PATHS]);
  const collaborationDirtyPaths = status.ok ? parsePorcelainStatus(status.stdout) : [];
  const guardedDirtyPaths = protectedBranch || detached ? collaborationDirtyPaths : [];
  const recommendedActions = gitRecommendedActions({ protectedBranch, detached, guardedDirtyPaths });

  return {
    ...base,
    ok: guardedDirtyPaths.length === 0,
    available: true,
    insideWorktree: true,
    gitRoot: root.stdout.trim(),
    branch: detached ? undefined : branch,
    detached,
    protectedBranch,
    collaborationDirtyPaths,
    recommendedActions,
    error: branchResult.ok && status.ok ? undefined : branchResult.error ?? status.error
  };
}

function protectedBranchNames(): readonly string[] {
  const configured = process.env.BOREAL_PROTECTED_BRANCHES;
  if (!configured) {
    return DEFAULT_PROTECTED_BRANCHES;
  }
  const branches = configured
    .split(",")
    .map((branch) => branch.trim())
    .filter(Boolean);
  return branches.length > 0 ? branches : DEFAULT_PROTECTED_BRANCHES;
}

function parsePorcelainStatus(stdout: string): readonly GitDirtyPath[] {
  return stdout
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => ({
      status: line.slice(0, 2).trim() || line.slice(0, 2),
      path: line.slice(3)
    }));
}

function gitRecommendedActions(input: {
  readonly protectedBranch: boolean;
  readonly detached: boolean;
  readonly guardedDirtyPaths: readonly GitDirtyPath[];
}): readonly string[] {
  if (input.guardedDirtyPaths.length === 0) {
    return [];
  }
  if (input.detached) {
    return ["git switch -c boreal/sync-work"];
  }
  if (input.protectedBranch) {
    return ["git switch -c boreal/sync-work", "git add .boreal/ledgers memory && git commit"];
  }
  return [];
}

interface GitResult {
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: string;
  readonly code?: string | number;
}

function runGit(cwd: string, args: readonly string[]): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile("git", ["-C", cwd, ...args], { maxBuffer: 5 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        resolve({
          ok: false,
          stdout,
          stderr,
          error: stderr.trim() || error.message,
          code: "code" in error && error.code !== null ? error.code : undefined
        });
        return;
      }
      resolve({ ok: true, stdout, stderr });
    });
  });
}

function isMissingGit(result: GitResult): boolean {
  return result.code === "ENOENT";
}
