# PF-S03-T07 attempt 4 — commands

Review cwd: `/Users/cybertron/Code/boreal-work`

## Required focused validation

```text
$ cargo test --locked -p boreal-domain --test production_rollup_policy
Finished `test` profile [unoptimized + debuginfo] target(s) in 0.00s
running 5 tests
test queued_container_work_is_nonclaimable_and_not_a_hard_block ... ok
test corrupt_descendant_is_not_reported_as_fully_accepted ... ok
test container_inputs_cannot_make_a_container_task_claimable ... ok
test deferred_cycle_separates_accepted_and_reconciled_scope ... ok
test active_gate_overdue_and_blocker_totals_stay_separate ... ok
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
```

Exit code: `0`.

## Read-only inspection

- `crates/domain/src/lib.rs` registers `pub mod rollups;`.
- `crates/domain/tests/production_rollup_policy.rs` imports `boreal_domain::rollups::*`; no source-path shim is present.
- `crates/domain/src/rollups.rs` was inspected for exact totals, reconciliation, integrity quality, assignment history, container/cycle non-claimability, and integration closeout handling.

No source, manifest, `STATE.json`, or prior evidence was edited.
