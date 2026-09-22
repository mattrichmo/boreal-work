# PF-S02-T01 — Attempt 3 evidence

## Result

The bounded compatibility-test remediation is complete within the granted
write set. The focused schema-v3 target passes all 11 tests, including explicit
v3 apply/reopen, failed v3 rollback, v3 mutations and typed replay, destructive
rollback protection, backup/reopen, additive compatibility, and constraint
coverage.

This is implementation evidence only. It does not self-accept PF-S02-T01 and
does not claim the full `boreal-store` package is green.

## Change

`crates/store/tests/schema_v3.rs` now uses `open_v2_fixture`, which calls the
public `SqliteStore::open_for_migration` boundary and then applies the complete
`SCHEMA_V2` text through `execute_batch`. The direct additive tests therefore
start from a raw schema-v2 fixture instead of asking canonical production open
to open v2. Explicit v3 application remains in the tests. The normal
schema-v2 reopen assertion remains for compatibility behavior on an already-v3
database.

The backup source was changed from `open_with_work_model_v3` to the same raw-v2
fixture followed by an explicit v3 apply, preserving the backup/reopen intent
under the new production open routing.

## Exact focused outcome

```text
running 11 tests
...
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
```

The compiler emitted the existing warning for unused `MigrationState::as_sql`
and `MigrationState::parse` in coordinator/worker migration code. It did not
affect the focused test result.

## Package-level limitation

`cargo test --locked -p boreal-store` exited 101. The focused `schema_v3`
target passed 11/11, but `tests/storage_remediation.rs` still has two failures:

- `fresh_schema_rolls_back_all_ddl_when_initialization_fails`: expected schema
  version 2 but observed 3;
- `legacy_v2_schema_is_repaired_atomically_and_survives_restart`: expected the
  old incomplete-v2 setup to be accepted but observed
  `Invalid("schema version 2 is missing required table work_hold")`.

The package result is therefore not reported as fully green. These failures
are outside the granted write set and were not changed or hidden by this
attempt.

## Changed paths

- `/Users/cybertron/Code/boreal-work/crates/store/tests/schema_v3.rs`
- `/Users/cybertron/Code/boreal-work/project/validation/production/tasks/PF-S02-T01/attempt-3/START.md`
- `/Users/cybertron/Code/boreal-work/project/validation/production/tasks/PF-S02-T01/attempt-3/COMMANDS.md`
- `/Users/cybertron/Code/boreal-work/project/validation/production/tasks/PF-S02-T01/attempt-3/EVIDENCE.md`
- `/Users/cybertron/Code/boreal-work/project/validation/production/tasks/PF-S02-T01/attempt-3/HANDOFF.md`

No production source, plan/state, prior evidence, or unrelated path was
intentionally changed.

## Source artifact digest

```text
33f5af81f88c0b8adc7ca45af8bab18465b4d84a6a16d64cbf419e96dc4dc83c  crates/store/tests/schema_v3.rs
```
