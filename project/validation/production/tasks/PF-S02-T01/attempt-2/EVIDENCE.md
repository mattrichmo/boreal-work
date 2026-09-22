# PF-S02-T01 — Attempt 2 evidence

## Status

`blocked_pending_coordinator_review`. This is integration evidence, not a
self-acceptance of PF-S02-T01 and not an acceptance of any PF-S02 review,
reconciliation, or revalidation gate.

## Authorized changes

Only the granted integration paths were changed by this attempt:

- `crates/store/src/lib.rs`
- `project/spec/schema-production.sql`
- this attempt-2 evidence directory

The worker's `migrations.rs` and `production_migrations.rs` remain prior
attempt inputs; plan/state, service, application, domain, and TUI paths were
not changed by this attempt.

## Implementation evidence

`lib.rs` now registers and re-exports the worker migration protocol and
provides the narrow `MigrationBackend` adapter over the existing
`SqliteStore` connection. The adapter uses the store's existing SQLite
statement/transaction helpers, `StoreError::Busy` classification, and an
atomic transaction-owner marker. Lock acquisition is `BEGIN IMMEDIATE`; lock
release only rolls back the adapter-owned transaction and never force-breaks a
live lock.

The canonical production open path is wired as follows:

- fresh databases run the production bootstrap through `MigrationRunner`;
- canonical schema-v2 opens run the ordered v2-to-v3 plan;
- current production-v3 opens verify the identity, ledger, checksum, and
  production verification SQL without re-running preflight against live
  attempts;
- explicit `migrate_production` remains the ordered migration path;
- explicit `repair_production_schema` provisions missing metadata only after
  the complete v3 contract verifies, and refuses partial metadata.

The schema artifact contains the canonical v2 objects, the existing v3
additive objects, and the exact worker metadata definitions for:

- `boreal_migration_ledger`;
- `boreal_migration_diagnostic`; and
- `boreal_schema_identity`.

Its final marker is `PRAGMA user_version = 3`. The runner target identity is
`boreal.sqlite`, version `3`, contract `boreal.work-model/3`, with the target
checksum computed from this exact `include_str!` artifact. The v2 source
checksum remains the ordered migration's accepted source checksum.

The existing service `ProjectElection` remains the outer service/maintenance
ownership boundary. The store crate cannot depend back on the service crate
without violating the repository dependency direction, and service files were
outside the granted write boundary. This attempt therefore makes no claim of
changing service startup ordering; it adds no second process lock and does not
force-break the existing election lock.

## Verified outcomes

- `cargo check --locked -p boreal-store`: passed.
- `cargo fmt --all -- --check`: passed.
- Production schema parsed by SQLite in memory: passed.
- `cargo test --locked -p boreal-store --test production_migrations`: `9
  passed, 0 failed`.
- `cargo test --locked -p boreal-store --test m02_claim`: `10 passed, 0
  failed`.
- `git diff --check`: passed.

The focused migration receipts exercise fresh migration, idempotent reopen,
ordered upgrade, ledger/checksum validation, live-attempt blocking, lock
exclusion, interrupted recovery, rollback/failure retention, and legacy-row
preservation in the worker's isolated backend. The M02 target exercises the
actual `SqliteStore` boundary and passed.

## Precise blocker

The full store target is not green under the requested open-path integration:
`cargo test --locked -p boreal-store --test schema_v3` exits `101` with `1
passed, 10 failed`, and the full `cargo test --locked -p boreal-store` exits
`101` for the same target. The exact observed failures include:

```text
Invalid("table work_model_v3_meta already exists")
left: 3
right: 2
assertion failed: store.apply_schema(&broken).is_err()
```

The existing schema-v3 tests assume that opening the canonical schema-v2
fixture leaves `user_version = 2` so the test can apply `schema-v3.sql`
itself. The production integration intentionally routes that same canonical
open through the migration runner, so the database is already v3 and a second
standalone v3 apply duplicates `work_model_v3_meta`. Resolving that conflict
requires a coordinator decision about the existing schema-v3 test contract or
the public open compatibility contract; it cannot be truthfully hidden in an
evidence receipt.

The existing `project/spec/manifest.json` still declares the base
`boreal.sqlite/2` schema identity, while the production runner target is the
accepted additive `boreal.work-model/3` identity. No manifest file was within
the granted write boundary, so this attempt records the distinction and does
not claim a manifest promotion.
