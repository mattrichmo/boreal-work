import { BorealError } from "@boreal/core";

export const DIRTY_PATH_REASON_CODES = [
  "no_repo_changes",
  "read_only_or_audit_only",
  "user_requested_review_first",
  "external_system_only",
  "validation_blocked",
  "unrelated_dirty_state",
  "git_unavailable",
  "out_of_scope_repository",
  "sprint_checkpoint_rollup",
  "legacy_backfill"
] as const;

const DIRTY_PATH_REASON_CODE_SET = new Set<string>(DIRTY_PATH_REASON_CODES);

export function dirtyPathNotesHaveReasonCode(notes: readonly string[]): boolean {
  return notes.some((note) => {
    const [code] = note.trim().split(":", 1);
    return code !== undefined && DIRTY_PATH_REASON_CODE_SET.has(code);
  });
}

export function requireCommitOrDirtyPathReason(commitShas: readonly string[], dirtyPathNotes: readonly string[]): void {
  if (commitShas.length > 0 || dirtyPathNotesHaveReasonCode(dirtyPathNotes)) {
    return;
  }
  throw new BorealError(
    "BOREAL_INVALID_INPUT",
    `Closeout summaries without --commit require --dirty-path with one of these reason-code prefixes: ${DIRTY_PATH_REASON_CODES.join(", ")}`
  );
}
