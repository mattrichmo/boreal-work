# PF-S02-T01 — Attempt 2 commands

Recorded 2026-09-22 (America/Regina), from `/Users/cybertron/Code/boreal-work`.

## Context and workflow checks

- `bwrk prime --json` — exit `2`; rejected with `invalid_argument` because the
  invocation had no project identifier. No workflow state was changed.
- `bwrk workflows show boreal.workflow.claim-and-finish-work.v1` — exit `6`;
  service reported `service_busy`. No workflow state was changed.
- The required project/task cards, PF-S02 dispatch/shared-file rules,
  PF-S02-T01 attempt-1 handoff, accepted PF-S01-T92 gate, schemas, and
  contract manifest were read before implementation. The repository's
  `AGENTS.md` and file-based dispatch rules prohibit using the legacy command
  path to create or close these plan items.

## Implementation and static checks

- `rustfmt --edition 2021 crates/store/src/lib.rs` — exit `0`.
- `cargo fmt --all -- --check` — exit `0`.
- `cargo check --locked -p boreal-store` — exit `0`.
  The only compiler warning is the pre-existing worker-module dead-code
  warning for `MigrationState::as_sql` and `MigrationState::parse` in
  `crates/store/src/migrations.rs`.
- `sqlite3 :memory: < project/spec/schema-production.sql` — exit `0`.
- `git diff --check` — exit `0`.

## Focused tests

- `cargo test --locked -p boreal-store --test production_migrations` — exit
  `0`; `9 passed, 0 failed`.
- `cargo test --locked -p boreal-store --test m02_claim` — exit `0`; `10
  passed, 0 failed`.

## Blocked test commands

- `cargo test --locked -p boreal-store --test schema_v3` — exit `101`; `1
  passed, 10 failed`.
- `cargo test --locked -p boreal-store` — exit `101`. Unit tests, M02,
  production migrations, release acceptance, and runtime backup tests passed;
  the `schema_v3` target had `1 passed, 10 failed`.

The exact representative failure output was:

```text
schema-v3 additive migration applies: Invalid("table work_model_v3_meta already exists")
assertion `left == right` failed
  left: 3
 right: 2
assertion failed: store.apply_schema(&broken).is_err()
```

The failures are in the existing `crates/store/tests/schema_v3.rs` contract:
those tests open the canonical schema-v2 text and then expect to observe
schema version 2 before explicitly applying the standalone v3 extension. The
integrated production open path now upgrades canonical v2 to production v3,
so those tests either re-apply v3 DDL (`work_model_v3_meta already exists`) or
assert the old version-2 opening behavior. No test receipt is being treated as
passing for this blocked target.

## Hashes

```text
3fd0d323955cf4d52ec06cf366fdf7abe47ac0a27b4ac2768492b5835095e1cf  project/spec/schema-production.sql
3ffb080b3afbda69b42230e153acedcd13ceb39342f58e2543afd3f98b004b5a  crates/store/src/lib.rs
2d0b211e26acdd015f48803dc409aff2f9e654e4f6d985444b60da76acd9e314  project/validation/production/tasks/PF-S02-T01/attempt-2/START.md
```
