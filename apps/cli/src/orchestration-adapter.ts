import { BorealError } from "@boreal/core";
import type { OrchestrationClaimWorkAdapter } from "@boreal/engine";

import { prepareGitWorktree, removePreparedGitWorktree, type PreparedGitWorktree } from "./git-worktree-attachment.js";
import { runGit } from "./git-exec.js";

export function createOrchestrationClaimWorkAdapter(workspaceRoot: string): OrchestrationClaimWorkAdapter {
  return async (input, dependencies) => {
    const claim = await dependencies.claimWork(input);
    if (input.worktree !== true) {
      return claim;
    }

    let prepared: PreparedGitWorktree | undefined;
    try {
      const root = await runGit(workspaceRoot, ["rev-parse", "--show-toplevel"]);
      if (!root.ok || root.stdout.trim().length === 0) {
        throw new BorealError("BOREAL_CONFLICT", "Orchestration worktree dispatch requires a Git repository", {
          workspaceRoot,
          stderr: root.stderr.trim(),
          error: root.error
        });
      }
      prepared = await prepareGitWorktree(root.stdout.trim(), claim.work);
      const reservation = await dependencies.attachReservationGit({
        reservationId: claim.reservation.meta.id,
        git: prepared.git
      });
      return { ...claim, reservation };
    } catch (error) {
      let rollbackError: unknown;
      if (prepared) {
        try {
          await removePreparedGitWorktree(prepared);
        } catch (cleanupError) {
          rollbackError = cleanupError;
        }
      }
      try {
        await dependencies.releaseWorkReservation(input.workId);
      } catch (releaseError) {
        rollbackError ??= releaseError;
      }
      if (rollbackError) {
        throw new BorealError("BOREAL_CONFLICT", "Orchestration dispatch rollback failed", {
          workId: input.workId,
          originalError: error instanceof Error ? error.message : String(error),
          rollbackError: rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
        });
      }
      throw error;
    }
  };
}
