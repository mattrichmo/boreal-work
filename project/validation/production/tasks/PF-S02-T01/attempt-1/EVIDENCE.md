# PF-S02-T01 — Attempt 1 evidence

## Result

The exclusive implementation paths are complete and the focused migration
contract suite passes. This is implementation evidence only; it is not a
self-acceptance of PF-S02-T01 and does not claim integrated production or
release acceptance.

## Changed paths

- `crates/store/src/migrations.rs` — ordered additive migration engine,
  schema identity, SHA-256 step checksums, durable ledger/diagnostic tables,
  preflight invariants, lock boundary, transactional apply/recovery, and
  fail-closed verification.
- `crates/store/tests/production_migrations.rs` — nine SQLite-backed focused
  tests using an isolated `MigrationBackend` adapter.
- `project/validation/production/tasks/PF-S02-T01/attempt-1/START.md` —
  startup scope and invariant record.
- `project/validation/production/tasks/PF-S02-T01/attempt-1/COMMANDS.md` —
  exact command outcomes.
- `project/validation/production/tasks/PF-S02-T01/attempt-1/EVIDENCE.md` —
  this evidence record.
- `project/validation/production/tasks/PF-S02-T01/attempt-1/HANDOFF.md` —
  coordinator integration request and residual limits.

No other path was intentionally changed by this attempt. In particular,
`crates/store/src/lib.rs`, `project/spec/schema-production.sql`, plan JSON,
`execution/STATE.json`, and prior evidence remain coordinator/protected paths.

## Focused test coverage

The final command
`cargo test --locked -p boreal-store --test production_migrations` exited 0:

- full SHA-256 checksum formatting and stable step identity;
- fresh schema creation and idempotent reopen;
- ordered v2-to-v3 upgrade preserving legacy `work_item` and `attempt` rows;
- retained non-blocking legacy diagnostic;
- live-attempt preflight rejection before migration tables are written;
- unsupported newer schema rejection before writes;
- DDL/invariant/version rollback with retained failed ledger entry and retry;
- seeded interrupted `running` ledger attempt resumed without a new attempt;
- exclusionary migration lock returning `Busy` without force-breaking the lock;
- tampered applied ledger checksum rejected on reopen/current verification.

The final `cargo test --locked -p boreal-store` also exited 0. Its package
result includes the nine focused migration tests, all existing store tests,
and the existing ignored release benchmark.

## Implementation evidence

`MigrationPlan::validate` enforces non-empty identity, a strictly increasing
ordered chain, contiguous step versions, and the checksum of each canonical
step payload. `MigrationRunner` reads identity and source checksum before
creating migration metadata, rejects a newer schema, preflights live/ambiguous
diagnostics, acquires an adapter-provided lock, and never force-breaks it.

Each step commits a `running` ledger record first. The subsequent transaction
performs preconditions, additive migration SQL, postconditions, identity
update, diagnostics, and the version marker before committing the `applied`
ledger state. Failed schema work rolls back and records a durable `failed`
attempt; a matching committed `running` attempt can be resumed. Reopen checks
target identity, the target verification SQL, and exact applied ledger
checksums.

## File hashes

Computed with `sha256sum` after the final focused test run:

```text
0fd57ed2c6b55484fda4dfe5fb5ac8dc46274dd968a7acfbeb52c9a5f32eb356  crates/store/src/migrations.rs
1ce88e223dd281e2cdba25a85b64db86715a24b4354b8c4e10ddd826f34e6922  crates/store/tests/production_migrations.rs
c28101a845b6f1c2b979952fe771d27424a74707942e3d1ebb8a29241eeec3bb  project/validation/production/tasks/PF-S02-T01/attempt-1/START.md
```

## Limits and blockers

- The focused test imports `migrations.rs` directly and supplies a test-only
  raw SQLite backend. It does not prove that `SqliteStore` is registered or
  that the production schema manifest routes all opens through this runner.
- The migration lock test exercises the adapter lock boundary with an
  in-memory mutex. It is not live multi-process/service evidence.
- Interrupted recovery is represented by a durable seeded `running` ledger
  row and retry, not by killing a real service during a live transaction.
- No runtime, release, native/UI, or production-database result is asserted.
- `bwrk prime --json` was rejected for missing project identity, and the
  workflow-definition reads were busy because another process owned the local
  Boreal database. The repository/toolchain did not block the focused Rust
  implementation, so work continued and these workflow limits are recorded
  rather than treated as evidence.
