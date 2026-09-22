# PF-S02-T11 attempt 18 — external-adapter remediation start

## Scope and disposition

- Task: `PF-S02-T11`
- Attempt: `attempt-18`
- Date: 2026-09-22
- Input commit identity: `0d9611a017d5dc167e92fe79e8d65756fbac2d5a`
- Branch: `codex/apply-responsive-terminal-overlay`
- Working tree: dirty and uncommitted; existing changes were preserved
- Disposition: bounded adapter remediation; not accepted as canonical production wiring
- Commit/push/ledger edits: none

## Exclusive implementation paths

- `crates/cli/src/update.rs`
- `crates/memory/src/publisher.rs`
- Existing component tests in `crates/memory/tests/publisher.rs`
- Evidence only in this attempt directory

Forbidden runtime, store-root, CLI-main/service, memory-root, domain, plan and
state paths were not edited by this attempt. The update command's existing
direct route remains fail-closed until the protected canonical caller supplies
the identity-bound durable job port.

## Required invariants

1. Admission and readback are durable, operation-bound and identity-checked.
2. Only the winning acquisition may invoke an external callback.
3. Exact replay, losing acquisition, restart and callback-error paths read back
   the original operation and never invoke the external effect twice.
4. Pending, readback-required, rejected, failed and unknown outcomes remain
   unresolved; only attributable readback may produce `Reconciled`.
5. Identity, result, timestamp, reason and side-effect payloads are bounded.
