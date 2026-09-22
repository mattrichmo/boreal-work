# PF-S02-T01 — Attempt 2 handoff

## Handoff status

`blocked_pending_coordinator_review`.

The shared tree is no longer missing the `include_str!` target: the production
schema artifact exists, the store crate cargo-checks, and the integration
evidence is complete. This handoff does not self-accept PF-S02-T01.

## Delivered integration

- [crates/store/src/lib.rs](/Users/cybertron/Code/boreal-work/crates/store/src/lib.rs)
  contains the production `MigrationBackend` adapter, fresh/open routing,
  explicit migration and repair methods, identity/checksum/ledger checks, and
  non-force-breaking SQLite transaction exclusion.
- [project/spec/schema-production.sql](/Users/cybertron/Code/boreal-work/project/spec/schema-production.sql)
  contains the canonical production schema and exact migration metadata
  definitions used by the runner.
- Attempt-2 evidence records the commands, actual exits, passing focused
  outcomes, and the full-store blocker.

## Verified

- `cargo check --locked -p boreal-store`: exit `0`.
- `cargo fmt --all -- --check`: exit `0`.
- `cargo test --locked -p boreal-store --test production_migrations`: exit
  `0`, 9 passed.
- `cargo test --locked -p boreal-store --test m02_claim`: exit `0`, 10 passed.
- `sqlite3 :memory: < project/spec/schema-production.sql`: exit `0`.
- `git diff --check`: exit `0`.

## Blocking follow-up

`cargo test --locked -p boreal-store` exits `101` because the existing
`schema_v3` target has 10 failures after canonical schema-v2 open is upgraded
to v3. Representative exact output is:

```text
schema-v3 additive migration applies: Invalid("table work_model_v3_meta already exists")
left: 3
right: 2
assertion failed: store.apply_schema(&broken).is_err()
```

The coordinator must resolve whether the old schema-v3 fixture/open contract
is to be adapted to the new production boundary or whether an additional
compatibility seam is authorized. No out-of-bound test or manifest edits were
made to manufacture a green result. After that decision, rerun the full store
target and independently review the service-election and manifest alignment
claims before accepting the leaf.

## Preservation and review notes

- Attempt-1 worker evidence remains preserved and was not overwritten.
- PF-S01-T92 remains the accepted prerequisite only for its recorded scope;
  it does not accept this migration integration.
- The existing service/maintenance `ProjectElection` remains outside this
  attempt's write boundary. This attempt added no force-break recovery and no
  replacement lock.
- The existing manifest base schema declaration remains unchanged because
  manifest edits were explicitly outside the granted files.
