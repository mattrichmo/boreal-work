# PF-S02-T01 — Attempt 8 independent re-review evidence

## Decision

**ACCEPTED for PF-S02-T01 only.** Attribution: Codex, independent re-reviewer
for attempt-8. This is acceptance of the bounded T01 migration/invariant
review outcome only; it is not acceptance of PF-S02, any service/native/
publication/release scope, a successor task, or a sprint gate.

## Attempt-6 findings re-reviewed

### Live-attempt exclusion ordering — corrected and verified

In `crates/store/src/lib.rs:1333-1355`, the public v2 migration path computes
the legacy-v2 route, acquires `BEGIN IMMEDIATE` through
`store_try_acquire_migration_lock`, runs `production_preflight`, and only then
calls `repair_schema_v2`. On a blocking live-attempt diagnostic it rolls back
and returns before the repair call. The ordered runner is then constructed on
the same `SqliteStore`; its lock acquisition reuses the already-owned
transaction boundary, so the v2 repair is not committed in an unlocked gap.

The real integrated test
`integrated_canonical_open_rejects_live_attempt_before_v2_repair_or_production_metadata`
uses a file-backed v2 fixture with an accepted current attempt. It observes a
typed conflict containing `live_attempt_blocks_migration`, user version 2,
the legacy identity still readable, and no production ledger. The source
ordering verifies preflight/lock-before-repair; the adapter regression verifies
the public rejection and no production migration metadata write.

The v3 metadata-repair path likewise acquires the writer boundary and runs
preflight before metadata DDL at `lib.rs:1404-1455`; partial metadata is
rejected before repair.

### Real adapter evidence — present

`crates/store/tests/production_migrations.rs` contains seven integrated
real-`SqliteStore` cases, not only the generic `MigrationBackend` fixture:

- fresh production open reads schema identity, target checksum, and the
  `bootstrap-v3` applied ledger route;
- file-backed v2 upgrade preserves the canonical work row and reads the
  target identity/checksum plus `work-model-2-to-3` applied ledger route;
- public canonical open rejects unsupported user version 4 before metadata;
- public canonical open rejects a live accepted attempt before v2 repair/
  production metadata;
- an injectable conflicting v3 object forces production failure, retains
  user version 2, and reads back one failed `work-model-2-to-3` ledger attempt
  with failure/completion metadata;
- a raw schema-v3/no-production-metadata fixture repairs identity and ledger
  while preserving the canonical work row;
- a raw schema-v3/partial-metadata fixture is rejected as typed corruption
  without repair.

The nine generic fake-backend tests remain useful low-level runner evidence,
but are not counted alone. The real adapter target passed 16/16.

### Schema and ordered runner review — verified

`crates/store/src/migrations.rs` retains checksummed ordered steps, supported
source identity checks, newer-version rejection, a committed running ledger
phase, transactional DDL/version/identity/applied completion, rollback on
failure, and retained failed attempts for retry. The production plan in
`crates/store/src/lib.rs:7813-7842` binds the v2-to-v3 step and target checksum
to `project/spec/schema-production.sql`. The production schema sets
`PRAGMA user_version = 3` only after the additive objects and metadata tables
are declared.

## Acceptance matrix

| T01 outcome | Evidence | Result |
|---|---|---|
| Preflight/lock before v2 repair writes | Current source order plus real live-attempt adapter regression | Passed |
| Identity/checksum/ledger | Real fresh, v2-upgrade, and legacy-v3 readback assertions | Passed |
| Unsupported newer schema | Real public open at user version 4 | Passed |
| Live attempt | Real public open with accepted current attempt | Passed |
| Rollback/failure | Real conflicting-v3 failure; v2 marker retained and failed ledger retained | Passed |
| Legacy-v3 metadata repair | Real raw v3/no-metadata fixture, row preservation, identity and ledger readback | Passed |
| Partial metadata rejection | Real raw v3/one-metadata-table fixture, typed corruption and no ledger repair | Passed |
| Generic runner mechanics | Focused target and full package, supplementary only | Passed |
| Historical schema-v3 compatibility | `schema_v3` 11/11 | Passed |
| Storage remediation/contracts | `storage_remediation` 15/15; `store_contracts` 24/24 | Passed |

## Residual observations preserved precisely

- `verify_production_schema_current` was not changed. Its existing behavior
  accepts either a valid bootstrap ledger route or a valid v2-to-v3 step route
  for a current schema; the integrated tests assert the expected route shape
  for fresh, upgrade, and legacy-v3 fixtures, but the verifier still does not
  encode route provenance as a separate invariant.
- No separate two-process concurrent-writer race harness was run in this
  attempt. The correction holds `BEGIN IMMEDIATE` across the preflight and v2
  repair and the integrated live-attempt regression exercises the real
  adapter; this review verified the cross-connection boundary statically.
- Existing dead-code warnings for migration state helper methods remain.
- The release status benchmark remains intentionally ignored by the package
  test command.
- The worktree was dirty before this attempt. No claim is made that unrelated
  combined-tree changes were authored here.

These observations do not block the bounded T01 decision because the required
route-specific integrated readbacks, live-attempt ordering, and requested
fresh/focused checks are present and passing. They remain open observations
for any later migration/sprint or release gate that requires exact ledger
route enforcement or a genuine multi-process race harness.

## Scope guard

No service, native artifact, publication, release, sprint, or successor claim
is made. Prior failed attempts and evidence remain preserved.
