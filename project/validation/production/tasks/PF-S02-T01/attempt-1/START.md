# PF-S02-T01 — Attempt 1

- Task: ordered schema migration and invariant verification.
- Workspace: `/Users/cybertron/Code/boreal-work`.
- Started: 2026-09-22 (America/Regina).
- Input source: `HEAD 784a41b3802c29a76721c55eef2e9493283396c2`, dirty worktree;
  accepted PF-S01-T92 gate at `project/validation/production/tasks/PF-S01-T92/attempt-3/HANDOFF.md`.
- Exclusive worker paths: `crates/store/src/migrations.rs`,
  `crates/store/tests/production_migrations.rs`, and this attempt directory.
- Coordinator-owned integration requests: `crates/store/src/lib.rs` and
  `project/spec/schema-production.sql`; neither may be edited by this attempt.
- Protected paths: plan JSON, `execution/STATE.json`, existing schema files,
  all unrelated source/tests, prior evidence, live databases, and service locks.

## Interpreted invariant

The migration path is ordered and additive. It must reject unsupported newer
schema identities before mutation, acquire the existing service/maintenance
lock without force-breaking it, preflight live attempts and ambiguous legacy
facts, retain diagnostics, stage a durable ledger record, apply DDL and
postconditions transactionally, set the version marker last, and make a
reopen verify the exact identity/checksums/ledger. Interrupted or failed work
must leave the old version and canonical relations usable and retryable.

## Planned verification

- Run the new focused migration test target if the current checkout can
  compile it without coordinator registration.
- Run formatter/checks available in the current toolchain.
- Capture exact commands, exit codes, source identity, tool versions, and any
  blocked integration result in `COMMANDS.md` and `EVIDENCE.md`.
- Finish with exact changed paths, residual integration requests, and limits in
  `HANDOFF.md`; this attempt does not self-accept PF-S02-T01.
