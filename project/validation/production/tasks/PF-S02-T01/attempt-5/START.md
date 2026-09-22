# PF-S02-T01 — Attempt 5 compatibility remediation

- Task: update the two remaining `store_contracts` canonical schema-version assertions.
- Workspace: `/Users/cybertron/Code/boreal-work`.
- Started: 2026-09-22 (America/Regina); final checks recorded at `2026-09-22T08:22:30Z`.
- Input source: `HEAD 784a41b3802c29a76721c55eef2e9493283396c2`, dirty worktree; production canonical open/upgrade behavior was already present.
- Exclusive write set: `crates/store/tests/store_contracts.rs` and this attempt-5 evidence directory only.
- Protected paths: production Rust source, plan/state files, prior evidence, schema artifacts, unrelated tests, live databases, and service locks.

## Interpreted invariant

Canonical production fresh-create and reopen requests now intentionally produce
the work-model schema version 3. The two assertions now use
`WORK_MODEL_SCHEMA_VERSION` while preserving the existing foreign-key, WAL, and
idempotent-reopen checks. No unrelated contract assertion was weakened.

This attempt does not self-accept PF-S02-T01 or any review, reconciliation, or
revalidation gate.
