# PF-S03-T07 — coordinator integration evidence

The coordinator registered `boreal_domain::rollups` in `crates/domain/src/lib.rs`
and converted `production_rollup_policy.rs` from its private source-path shim to
the public crate boundary requested by the worker.

## Exact-tree checks

- `cargo fmt --all -- --check` — passed.
- `cargo test --locked -p boreal-domain --test production_rollup_policy` — 5 passed.
- `cargo test --locked -p boreal-domain` — 104 tests passed, 0 failed, 0 doc tests.
- `cargo check --locked -p boreal-domain --tests` — passed.
- `cargo clippy --locked -p boreal-domain --all-targets -- -D warnings` — passed.
- `git diff --check` — passed.

The adjacent action public-boundary target also passed its 7 focused tests in
the same exact-tree run.

## Integrated source hashes

```text
8c8293e61be01be9d699f405d38bcbfd34d35033440ad6f757c233645c05c2e7  crates/domain/src/lib.rs
cf7fd816022d427b41c3f9c005363446010a2c1c0388c2f3d86ad75056095a7d  crates/domain/src/rollups.rs
2771cff629ef3c3b881e622f2a7e26c652719b466c2b7ad92534d973129d7fbf  crates/domain/tests/production_rollup_policy.rs
```

This is integration evidence only. Independent review and sprint acceptance
remain open.
