# PF-S03-T06 — coordinator integration evidence

The coordinator registered `boreal_domain::actions` in `crates/domain/src/lib.rs`
and converted `production_action_policy.rs` from its private source-path shim to
the public crate boundary requested by the worker.

## Exact-tree checks

- `cargo fmt --all -- --check` — passed.
- `cargo test --locked -p boreal-domain --test production_action_policy` — 7 passed.
- `cargo test --locked -p boreal-domain` — 104 tests passed, 0 failed, 0 doc tests.
- `cargo check --locked -p boreal-domain --tests` — passed.
- `cargo clippy --locked -p boreal-domain --all-targets -- -D warnings` — passed.
- `git diff --check` — passed.

The adjacent rollup public-boundary target also passed its 5 focused tests in
the same exact-tree run.

## Integrated source hashes

```text
8c8293e61be01be9d699f405d38bcbfd34d35033440ad6f757c233645c05c2e7  crates/domain/src/lib.rs
8ac6bdecee87c1d14c139a8fe9554be2b448a6fa1d00ebcad79bfe9a3d5c23e7  crates/domain/src/actions.rs
dbde282e8907f30bc72eb67d877bfa4669b8198e78c8e2444a7a34c383183f80  crates/domain/tests/production_action_policy.rs
```

This is integration evidence only. Independent review and sprint acceptance
remain open.
