# PF-S02-T01 — Attempt 6 independent validation evidence

## Decision

**REJECTED for PF-S02-T01 only.** The required commands pass, but the current
integrated source does not establish the requested production migration
contract and contains a live-attempt exclusion ordering defect. This decision
does not assess or accept PF-S02, any service/native/publication/release gate,
or any other leaf.

## Positive evidence observed

- `cargo fmt --all -- --check`: exit 0.
- `cargo test --locked -p boreal-store`: exit 0; all listed store targets
  passed, with one explicitly ignored release benchmark and existing dead-code
  warnings only.
- Focused exits: `production_migrations` 9/9, `schema_v3` 11/11,
  `storage_remediation` 15/15, and `store_contracts` 24/24.
- The production schema artifact parses in an ephemeral SQLite database.
- `crates/store/src/migrations.rs` defines ordered checksummed steps, durable
  running/applied/failed ledger states, retryable failed-step retention,
  identity/checksum checks, newer-version rejection, and a no-force-break
  adapter lock boundary. The isolated tests exercise those mechanics.
- The integrated store tests exercise fresh production open, v2 repair with
  preserved work rows, explicit v3 extension behavior, schema rollback for the
  standalone v3 artifact, and idempotent reopen.

## Findings

### F-PF-S02-T01-06-001 — live-attempt exclusion starts after v2 repair

- Severity: **major**; mandatory safety/integrity acceptance row.
- Exact sources: `crates/store/src/lib.rs:1333-1347` and
  `crates/store/src/lib.rs:4792-4812`; runner preflight/lock order is
  `crates/store/src/migrations.rs:471-488` and `547-575`.
- Observation: `SqliteStore::migrate_production` begins and commits
  `repair_schema_v2()` before constructing/applying `MigrationRunner`.
  `repair_schema_v2()` can alter `work_item`, create `work_hold` and
  `evidence_execution`, create indexes, and replace triggers. The runner's
  `live_attempt_diagnostics()` preflight and migration lock occur only after
  that repair transaction.
- Static reproduction: a structurally valid schema-v2 database containing a
  live attempt reaches the repair transaction through the production
  `SqliteStore::open(..., schema-v2)` path before the runner can reject the
  live attempt. The later preflight can return `live_attempt_blocks_migration`,
  but the schema repair has already committed. A concurrent writer can also
  enter the interval between repair commit and runner lock acquisition.
- Impact: the integrated production path does not provide the required
  live-attempt exclusion over all migration/repair writes. The focused test
  `crates/store/tests/production_migrations.rs:504-519` proves only the
  generic fake runner's preflight-before-ledger behavior; no real-store test
  covers this public path.
- Review status: **not runtime-reproduced in this review**; this is a direct
  source-order finding. Required correction: move the live/legacy preflight and
  one exclusion boundary ahead of every v2 repair write, or otherwise make
  repair part of the same locked, preflighted production migration transaction;
  add an integrated live-attempt regression test.

### F-PF-S02-T01-06-002 — required legacy-v3 compatibility fixture is absent

- Severity: **major** evidence gap for the requested leaf contract.
- Exact sources: the untested production path is
  `crates/store/src/lib.rs:1355-1433` and its dispatch is
  `crates/store/src/lib.rs:1435-1459`. The current tests contain no reference
  to `repair_production_schema` or a pre-runner v3 fixture; the read-only
  inventory was performed over `crates/store/tests/`.
- Observation: the source implements a special path for schema version 3 with
  all three production metadata tables absent, but no preserved or new test
  constructs an established v3 database without metadata, verifies canonical
  rows survive, verifies metadata/identity/ledger/checksum repair, reopens it,
  and rejects partial metadata. `storage_remediation.rs:116-165` is a legacy
  v2 repair fixture, not a legacy-v3 compatibility fixture.
- Impact: explicit legacy-v3 compatibility, one of the requested review
  outcomes, remains unproven at the integrated store boundary. The passing
  focused tests cannot be promoted to this acceptance row.
- Review status: **not runtime-reproduced** because the required fixture/test
  is missing. Required correction: add an attributable integrated legacy-v3
  fixture and negative partial-metadata case, then rerun the leaf review.

### F-PF-S02-T01-06-003 — production negative/identity/ledger cases are fixture-only

- Severity: **major** evidence-layer gap.
- Exact sources: `crates/store/tests/production_migrations.rs:1-2` imports
  `../src/migrations.rs` directly; `:62-90` defines an isolated in-memory
  `TestDb`; `:237-372` implements the fake `MigrationBackend`. The real
  adapter is in `crates/store/src/lib.rs:7232-7483` and the public production
  open routes are `crates/store/src/lib.rs:1228-1240` and `:1435-1463`.
- Observation: the 9/9 production migration tests exercise the generic
  runner against `TestDb`, not the integrated `SqliteStore` adapter. The
  passing integrated store tests do not assert production metadata identity,
  target checksum, applied ledger contents, unsupported newer-version
  rejection, real-store live-attempt rejection, or production failed-step
  rollback. Therefore the requested fresh/upgrade/rollback/identity/ledger/
  newer/live contract is only partially exercised at the required layer.
- Impact: full package green status is not sufficient evidence for the
  production migration contract; it includes no integrated regression for the
  actual runner/adapter boundary for these negative and identity cases.
- Review status: **not runtime-reproduced at the real-store boundary**.
  Required correction: add real `SqliteStore` production migration tests for
  each required negative/identity/ledger case, including the legacy-v3 fixture,
  and rerun the full store plus focused targets.

### F-PF-S02-T01-06-004 — current ledger verification accepts either route

- Severity: **observation**, not the primary rejection reason.
- Exact sources: `crates/store/src/lib.rs:1465-1510` and
  `crates/store/src/migrations.rs:893-922`.
- Observation: current-schema verification iterates the bootstrap and
  v2-to-v3 step entries, but `current_entry` becomes true when either one is
  applied; a missing entry is skipped. Normal fresh databases use the
  bootstrap entry, upgrades use the step entry, and pre-runner v3 repair uses
  the bootstrap entry, so the intended route distinction is implicit rather
  than encoded as an exact ledger contract.
- Limitation: no crafted-corruption runtime probe was run. This finding should
  be resolved while adding the integrated ledger tests, with the expected
  fresh/upgrade/legacy-v3 ledger shape made explicit.

## Contract matrix

| Requested outcome | Evidence observed | Review result |
|---|---|---|
| Fresh create | Integrated fresh open tests pass; production runner internals also pass in fake backend. | Partial pass; identity/ledger readback is not asserted by an integrated test. |
| Ordered v2→v3 upgrade | Integrated legacy-v2 repair/reopen tests pass; ordered step is statically present. | Partial pass; real runner/adapter upgrade negative cases are unproven. |
| Atomic/failed-step rollback | Fake backend injected failure passes; standalone v3 rollback/fresh broken-SQL cases pass. | Not accepted for integrated production runner failure. |
| Idempotent reopen | `store_contracts` and storage remediation pass. | Passed for exercised reopen paths. |
| Schema identity/checksum/ledger | Static implementation and fake checksum/tamper test pass. | Not accepted at real `SqliteStore` boundary; see F-003/F-004. |
| Legacy v2 repair without lost rows | `storage_remediation` 15/15 passes, including preserved row/restart. | Passed for exercised valid legacy-v2 fixture. |
| Unsupported newer versions | Fake runner test passes. | Not accepted for public production open. |
| Live-attempt exclusion | Fake runner test passes. | Rejected at integrated path; see F-001. |
| Explicit legacy v3 compatibility fixture | No fixture/test found; repair path unexercised. | Rejected as unproven; see F-002. |

## Scope, limitations, and required rerun

- This review did not edit product source, tests, `STATE.json`, prior evidence,
  or unrelated paths. Only the attempt-6 directory is newly written.
- The worktree was already dirty. The review subject is the combined current
  source, not the attempt-1 through attempt-5 source hashes; prior evidence is
  retained and treated as historical.
- No service, native, UI, publication, release, or sprint acceptance was run
  or claimed. No live database or lock was force-broken.
- The local Boreal workflow owner was busy and the public review routes are
  unavailable; no lifecycle mutation or review decision was recorded through
  `bwrk`.
- Required next action is a bounded correction of F-001 plus integrated
  production negative/identity/ledger and legacy-v3 fixtures for F-002/F-003,
  followed by an independent revalidation of this leaf. The current decision
  remains rejected until those results exist.
