# PF-S02-T01 — Attempt 7 corrective implementation start

## Scope and authority

- Task / attempt: `PF-S02-T01` / `attempt-7`.
- Purpose: bounded correction of the rejected attempt-6 findings, under the
  coordinator-approved T01 integration boundary.
- Input source: `HEAD 784a41b3802c29a76721c55eef2e9493283396c2`, with a dirty
  combined worktree containing prior implementation work.
- Workspace: `/Users/cybertron/Code/boreal-work`.
- Allowed writes: `crates/store/src/lib.rs`,
  `crates/store/tests/production_migrations.rs`, and this attempt directory.
- Explicitly not edited: `STATE.json`, prior attempt evidence, unrelated tests,
  unrelated product paths, service/native/release paths, and plan acceptance
  state.

## Required correction

The production v2 migration path must acquire one SQLite writer exclusion
boundary and reject live or ambiguous legacy facts before `repair_schema_v2`
can commit. The ordered migration runner remains authoritative and is reused
under that boundary. Real `SqliteStore` adapter tests must prove production
identity/checksum/ledger readback, newer-schema rejection, live-attempt
rejection, safely injectable production rollback, and legacy-v3 metadata
repair/partial-metadata rejection.

## Intended implementation

- Preflight live-attempt and legacy diagnostics after acquiring the store’s
  `BEGIN IMMEDIATE` migration boundary and before v2 repair writes.
- Let the ordered runner reuse that same connection boundary, preserving
  typed errors and no-force-break behavior.
- Apply the same preflight boundary to pre-runner v3 metadata repair.
- Add integrated real-SQLite fixtures and readback assertions while retaining
  the standalone fake-backend and historical schema-v3 tests.

## Verification strategy

Run the required formatting and full `boreal-store` package checks, the
production migration target plus historical/integration targets, `cargo check`
where useful, and `git diff --check`. Preserve every pass, failure, warning,
and residual limitation in `COMMANDS.md` and `EVIDENCE.md`.

