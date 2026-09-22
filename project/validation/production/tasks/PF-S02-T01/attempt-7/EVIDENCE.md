# PF-S02-T01 — Attempt 7 corrective evidence

## Decision

**READY_FOR_REVIEW for PF-S02-T01 only.** This is a corrective implementation
handoff after the rejected attempt-6 review. It does not accept PF-S02, any
service/native/publication/release scope, or the task’s parent sprint.

## Correction evidence

### Live-attempt ordering and exclusion

`SqliteStore::migrate_production` now acquires the adapter’s writer boundary
and runs `production_preflight` before `repair_schema_v2`. The production
adapter’s lock acquisition is reusable by the ordered runner on the same
connection, so the repair is not committed in an unlocked interval before the
runner begins. Failure paths release the boundary with rollback; no live lock
is force-broken. The pre-runner schema-v3 metadata repair uses the same
preflighted boundary before metadata DDL.

The integrated test
`integrated_canonical_open_rejects_live_attempt_before_v2_repair_or_production_metadata`
opens a real file-backed v2 fixture through public canonical `SqliteStore::open`
with a live accepted attempt. It asserts the typed `StoreError::Conflict`
contains `live_attempt_blocks_migration`, user version remains 2, the legacy
identity remains readable, and the production ledger remains absent. This
proves the public path rejects before production metadata writes; the source
ordering covers the repair DDL boundary.

### Real integrated adapter coverage

The production migration test target now includes real `SqliteStore` cases for:

- Fresh production identity, exact target checksum, and explicit
  `bootstrap-v3` applied ledger evidence.
- File-backed v2 upgrade with preserved work-row readback, target identity and
  explicit `work-model-2-to-3` applied ledger evidence.
- Unsupported user version 4 rejection through public canonical open.
- Live-attempt rejection before production metadata creation.
- Safely injectable production migration failure using a conflicting v3 object;
  the test asserts user version remains 2 and the real adapter reads back one
  retained failed `work-model-2-to-3` ledger attempt with failure/completion
  metadata.

The original fake `MigrationBackend` tests remain in the same target as
low-level protocol coverage; they are no longer the only evidence for the
production migration contract.

### Legacy-v3 compatibility

The integrated fixture installs raw schema-v2 plus the standalone schema-v3
extension at `user_version = 3` without production metadata, inserts a
canonical work row, then reopens through public canonical `SqliteStore::open`.
The test verifies the row survives and reads back repaired production identity,
target checksum, and the explicit applied `bootstrap-v3` ledger entry. A
separate raw v3 fixture with one metadata table present is rejected as typed
`StoreError::Corrupt` for partial production metadata. Existing standalone
`schema_v3` tests remain historical compatibility fixtures and passed 11/11.

## Acceptance matrix

| Required outcome | Attempt-7 evidence | Result |
|---|---|---|
| Live-attempt exclusion before v2 repair writes | Public file-backed `SqliteStore::open` regression; preflight/lock source order | Ready for independent review |
| Real identity/checksum/ledger readback | Fresh, v2 upgrade, and legacy-v3 adapter readback tests | Passed |
| Unsupported newer schema | Public canonical open with `user_version = 4` | Passed |
| Real live-attempt rejection | Public canonical open with accepted live attempt | Passed |
| Production migration failure/rollback | Conflicting v3 object; v2 marker retained and failed ledger retained | Passed |
| Legacy-v3 metadata repair | Raw v3/no metadata reopen, row preservation, identity/ledger readback | Passed |
| Partial metadata rejection | Raw v3/one metadata table reopen | Passed |
| Historical standalone schema-v3 compatibility | `--test schema_v3`, 11/11 | Passed |
| Current-ledger verification exact-route contract | New tests make fresh/upgrade/legacy-v3 expected ledger evidence explicit | Observation remains |

## Remaining observation and limits

- `verify_production_schema_current` was not changed in this correction. Its
  existing behavior accepts either a valid bootstrap ledger route or a valid
  v2-to-v3 step route for a current schema; the integrated tests now assert the
  expected route shape for each creation/upgrade/repair fixture, but the
  verifier still does not encode route provenance as a separate invariant.
- No separate two-process concurrent-writer race harness was run in this
  attempt. The correction holds `BEGIN IMMEDIATE` across the preflight and v2
  repair and the integrated live-attempt regression exercises the real adapter;
  independent review should inspect the cross-connection race boundary.
- Existing dead-code warnings for migration state helper methods remain. The
  release status benchmark remains intentionally ignored by the package test
  command, as reported by Cargo.
- The worktree was dirty before this attempt. No claim is made that unrelated
  combined-tree changes were authored here.

