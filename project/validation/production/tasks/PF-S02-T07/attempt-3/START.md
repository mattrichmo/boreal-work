# PF-S02-T07 — Attempt 3 start

- Task: `PF-S02-T07` — persist command registration, outcomes and audit atomically.
- Attempt: `attempt-3` corrective bounded implementation.
- Started: 2026-09-22 America/Regina.
- Repository: `/Users/cybertron/Code/boreal-work`.
- Branch: `codex/apply-responsive-terminal-overlay`.
- Input commit: `784a41b3802c29a76721c55eef2e9493283396c2`.
- Worktree: dirty; unrelated work and prior evidence are preserved.
- Worker scope: only `crates/store/src/operations.rs`, `crates/store/src/audit.rs`, `crates/store/tests/production_operation_audit.rs`, and this attempt directory.

## Required context read

Before editing, this worker read:

- the complete PF-S02 sprint card and PF-S02-T07 task card;
- `execution/AGENT_START.md` and `execution/PARALLEL_DISPATCH.md`;
- PF-S02-T07 attempts 1 and 2, including the coordinator integration request;
- `project/spec/production/contract-manifest.json`;
- `project/spec/production/identity-revisions-authority.md`;
- the current `IdentityStore`, operation/audit record types, schema constraints,
  and all current operation journal tests.

## Corrective invariant

The bounded store seam must bind an operation ID to immutable project,
command, actor/session, subject, revision/fence, request digest, and current
database lineage. A caller-owned transaction must either register the operation
and its redacted audit event or return the exact prior readback. A changed
digest, actor, subject, project, or epoch must fail closed. Busy/unknown
outcomes remain distinct and readable. Outcome and audit payloads are bounded
and credential-like values are redacted before durable write or bounded
readback.

## Deliberate integration boundary

The canonical root call sites in `crates/store/src/lib.rs` and application/CLI
callers are protected shared files and remain read-only for this attempt. This
attempt adds the reusable strict seam and real SQLite regression coverage; it
does not claim that every production mutation has been migrated to the new
registration method. The coordinator must apply that shared-root integration
serially and rerun the combined service/native acceptance matrix.
