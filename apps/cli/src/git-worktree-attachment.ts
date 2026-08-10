import { existsSync } from "node:fs";

import { BorealError, type AgentReservation } from "@boreal/core";

import { workBranchName, workWorktreePath, type BranchableWork } from "./git-branch.js";
import { runGit } from "./git-exec.js";

export interface PreparedGitWorktree {
  readonly repoRoot: string;
  readonly git: NonNullable<AgentReservation["git"]>;
  readonly created: boolean;
}

export async function prepareGitWorktree(
  repoRoot: string,
  work: BranchableWork
): Promise<PreparedGitWorktree> {
  const baseHead = await runGit(repoRoot, ["rev-parse", "HEAD"]);
  if (!baseHead.ok || baseHead.stdout.trim().length === 0) {
    throw new BorealError("BOREAL_CONFLICT", "Unable to determine the repository HEAD for the worktree", {
      repoRoot,
      stderr: baseHead.stderr.trim(),
      error: baseHead.error
    });
  }

  const branch = workBranchName(work);
  const worktreePath = workWorktreePath(repoRoot, branch);
  let created = false;
  if (existsSync(worktreePath)) {
    const worktreeBranch = await runGit(worktreePath, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
    if (!worktreeBranch.ok || worktreeBranch.stdout.trim() !== branch) {
      throw new BorealError("BOREAL_CONFLICT", "Unable to reuse existing worktree path", {
        branch,
        worktreePath,
        stderr: worktreeBranch.stderr.trim(),
        error: worktreeBranch.error
      });
    }
  } else {
    const existing = await runGit(repoRoot, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
    const added = existing.ok
      ? await runGit(repoRoot, ["worktree", "add", worktreePath, branch])
      : await runGit(repoRoot, ["worktree", "add", "-b", branch, worktreePath, baseHead.stdout.trim()]);
    if (!added.ok) {
      throw new BorealError("BOREAL_CONFLICT", "Unable to create worktree for work branch", {
        branch,
        worktreePath,
        stderr: added.stderr.trim(),
        error: added.error
      });
    }
    created = true;
  }

  const head = await runGit(worktreePath, ["rev-parse", "HEAD"]);
  if (!head.ok || head.stdout.trim().length === 0) {
    if (created) {
      await removePreparedGitWorktree({
        repoRoot,
        created,
        git: { branch, baseSha: baseHead.stdout.trim(), worktreePath }
      });
    }
    throw new BorealError("BOREAL_CONFLICT", "Unable to determine the worktree HEAD", {
      branch,
      worktreePath,
      stderr: head.stderr.trim(),
      error: head.error
    });
  }

  return {
    repoRoot,
    created,
    git: {
      branch,
      baseSha: head.stdout.trim(),
      worktreePath
    }
  };
}

export async function removePreparedGitWorktree(prepared: PreparedGitWorktree): Promise<void> {
  if (!prepared.created || !prepared.git.worktreePath) {
    return;
  }
  const removed = await runGit(prepared.repoRoot, ["worktree", "remove", prepared.git.worktreePath]);
  if (!removed.ok) {
    throw new BorealError("BOREAL_CONFLICT", "Unable to roll back the newly-created worktree", {
      branch: prepared.git.branch,
      worktreePath: prepared.git.worktreePath,
      stderr: removed.stderr.trim(),
      error: removed.error
    });
  }
}
