import { execFile } from "node:child_process";

import type { CliContext } from "./context.js";

const DEFAULT_PROTECTED_BRANCHES = ["main", "master", "trunk"] as const;
const COLLABORATION_PATHS = [".boreal/ledgers", ".boreal/runtime", "memory/raw/index.jsonl", "memory"] as const;
const GENERATED_ARTIFACT_PATHS = [
  ".boreal/ledgers",
  ".boreal/runtime",
  ".boreal/cache",
  ".boreal/tmp",
  ".boreal/results",
  ".agents",
  ".claude",
  "dump",
  "memory/.boreal/db",
  "memory/.boreal/cache",
  "memory/.boreal/locks",
  "memory/.boreal/tmp",
  "memory/.boreal/results"
] as const;

export type GitWorktreeFindingCategory =
  | "protected_branch"
  | "detached_head"
  | "dirty_generated_artifact"
  | "dirty_memory_index"
  | "dirty_collaboration_path"
  | "git_status_error";

export type GitWorktreeFindingSeverity = "info" | "warning" | "error";

export interface GitDirtyPath {
  readonly status: string;
  readonly path: string;
}

export interface GitWorktreeFinding {
  readonly category: GitWorktreeFindingCategory;
  readonly severity: GitWorktreeFindingSeverity;
  readonly blocking: boolean;
  readonly message: string;
  readonly path?: string;
  readonly status?: string;
  readonly recommendedActions: readonly string[];
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
  readonly blockingDirtyPaths: readonly GitDirtyPath[];
  readonly findings: readonly GitWorktreeFinding[];
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
      blockingDirtyPaths: [],
      findings: [],
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
  const findings = gitWorktreeFindings({
    protectedBranch,
    detached,
    collaborationDirtyPaths,
    statusError: status.ok ? undefined : status.error,
    branchError: branchResult.ok ? undefined : branchResult.error
  });
  const blockingDirtyPaths = collaborationDirtyPaths.filter((entry) =>
    findings.some((finding) => finding.blocking && finding.path === entry.path)
  );
  const recommendedActions = uniqueStrings(findings.flatMap((finding) => finding.recommendedActions));

  return {
    ...base,
    ok: findings.every((finding) => !finding.blocking),
    available: true,
    insideWorktree: true,
    gitRoot: root.stdout.trim(),
    branch: detached ? undefined : branch,
    detached,
    protectedBranch,
    collaborationDirtyPaths,
    blockingDirtyPaths,
    findings,
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

function gitWorktreeFindings(input: {
  readonly protectedBranch: boolean;
  readonly detached: boolean;
  readonly collaborationDirtyPaths: readonly GitDirtyPath[];
  readonly statusError?: string;
  readonly branchError?: string;
}): readonly GitWorktreeFinding[] {
  const findings: GitWorktreeFinding[] = [];

  if (input.branchError || input.statusError) {
    findings.push({
      category: "git_status_error",
      severity: "warning",
      blocking: true,
      message: "Could not inspect Git branch or collaboration path status",
      recommendedActions: ["git status --short .boreal/ledgers .boreal/runtime memory/raw/index.jsonl memory"]
    });
  }

  if (input.protectedBranch) {
    findings.push({
      category: "protected_branch",
      severity: "info",
      blocking: false,
      message: "Workspace is on a protected Git branch",
      recommendedActions: []
    });
  }

  if (input.detached) {
    findings.push({
      category: "detached_head",
      severity: input.collaborationDirtyPaths.length > 0 ? "warning" : "info",
      blocking: input.collaborationDirtyPaths.some((entry) => !isGeneratedArtifactPath(entry.path)),
      message:
        input.collaborationDirtyPaths.length > 0
          ? "Detached Git HEAD has dirty collaboration paths"
          : "Workspace is on a detached Git HEAD",
      recommendedActions: input.collaborationDirtyPaths.length > 0 ? ["git switch -c boreal/sync-work"] : []
    });
  }

  for (const entry of input.collaborationDirtyPaths) {
    if (isGeneratedArtifactPath(entry.path)) {
      findings.push({
        category: "dirty_generated_artifact",
        severity: "info",
        blocking: false,
        path: entry.path,
        status: entry.status,
        message: `Generated Boreal artifact is visible to Git status: ${entry.path}`,
        recommendedActions: generatedArtifactActions(entry)
      });
      continue;
    }

    if (isMemoryIndexPath(entry.path)) {
      findings.push({
        category: "dirty_memory_index",
        severity: "info",
        blocking: false,
        path: entry.path,
        status: entry.status,
        message: `Memory raw index has local changes: ${entry.path}`,
        recommendedActions: input.protectedBranch ? ["git switch -c boreal/sync-work", "git add memory/raw/index.jsonl && git commit"] : []
      });
      continue;
    }

    findings.push({
      category: "dirty_collaboration_path",
      severity: input.detached ? "warning" : "info",
      blocking: input.detached,
      path: entry.path,
      status: entry.status,
      message: `Collaboration path has local changes: ${entry.path}`,
      recommendedActions: input.protectedBranch || input.detached ? ["git switch -c boreal/sync-work", "git add memory && git commit"] : []
    });
  }

  return findings;
}

function generatedArtifactActions(entry: GitDirtyPath): readonly string[] {
  if (entry.status === "??") {
    return ["bwrk doctor --fix --json"];
  }
  return [`git rm -r --cached -- ${shellPath(entry.path)}`, "bwrk doctor --fix --json"];
}

function isGeneratedArtifactPath(path: string): boolean {
  const normalized = normalizeGitPath(path);
  return GENERATED_ARTIFACT_PATHS.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
}

function isMemoryIndexPath(path: string): boolean {
  return normalizeGitPath(path) === "memory/raw/index.jsonl";
}

function normalizeGitPath(path: string): string {
  return path.replace(/\\/gu, "/").replace(/\/+$/u, "");
}

function shellPath(path: string): string {
  return `'${path.replace(/'/gu, "'\\''")}'`;
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
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
