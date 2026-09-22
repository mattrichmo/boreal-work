# PF-S02-T01 — Attempt 4 compatibility remediation

- Task: update storage-remediation compatibility tests for the coordinator's
  canonical production v2-to-v3 migration and repair behavior.
- Workspace: `/Users/cybertron/Code/boreal-work`.
- Started: 2026-09-22 (America/Regina); final checks recorded at
  `2026-09-22T08:18:53Z`.
- Input source: `HEAD 784a41b3802c29a76721c55eef2e9493283396c2`, dirty worktree;
  coordinator-owned production migration behavior was already present.
- Exclusive write set: `crates/store/tests/storage_remediation.rs` and this
  attempt-4 evidence directory only.
- Protected paths: production Rust source, plan/state files, prior evidence,
  schema artifacts, unrelated tests, live databases, and service locks.

## Interpreted invariant

Canonical production opens and applies may repair structurally valid legacy v2
drift and complete the ordered v2-to-v3 migration. They therefore return the
production work-model schema version 3 and must satisfy the v3 contract.
Explicit `open_for_migration` remains the fixture boundary for constructing a
raw, incomplete v2 database.

The tests retain their real failure/recovery and data-preservation intent:
failed fresh DDL remains recoverable; the raw legacy fixture is demonstrably
incomplete before the production boundary; repair is atomic; rows survive;
and repaired objects are usable before and after restart.

This attempt does not self-accept PF-S02-T01 or any review, reconciliation, or
revalidation gate.
