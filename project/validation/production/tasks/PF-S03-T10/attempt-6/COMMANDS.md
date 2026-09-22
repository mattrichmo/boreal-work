# PF-S03-T10 — attempt 6 command record

All commands ran from `/Users/cybertron/Code/boreal-work` against the dirty
combined checkout whose base `HEAD` was
`70514f0ed2521df710c3c913f50ff9d759f5e743`.

| Command | Result |
| --- | --- |
| `cargo test --locked -p boreal-domain --test production_properties` | PASS — 21 tests |
| `cargo test --locked -p boreal-domain` | PASS — all unit/integration targets: 137 tests, doc-tests 0 |
| `cargo clippy --locked -p boreal-domain --all-targets -- -D warnings` | PASS |
| `rustfmt --edition 2021 --check crates/domain/src/lib.rs crates/domain/src/status_evaluator.rs crates/domain/tests/production_properties.rs` | PASS |
| `python3 project/spec/validate_contracts.py` | PASS — 8 protocol envelopes, 11 guidance fixtures, 10 workflow assets, 18 legal/15 illegal vectors, 19 clock/dependency cases, 52 conformance mappings, SQLite schema parsed |
| `git diff --check` | PASS |
| `cargo check --locked --workspace` | BLOCKED before workspace completion |
| `cargo check --locked -p boreal-application` | BLOCKED before application completion |
| `cargo fmt --all -- --check` | BLOCKED by unrelated combined-worktree drift |

## Exact bounded blockers

The workspace/application checks stop at the first protected adapter literal:

```text
error[E0063]: missing fields `activation_at` and `schedule` in initializer of `StatusContext<'_>`
   --> crates/store/src/status_evaluation.rs:146:28
    |
146 |         Ok(evaluate_status(StatusContext {
    |                            ^^^^^^^^^^^^^ missing `activation_at` and `schedule`
```

The second known protected literal is `crates/application/src/status.rs:291`;
the compiler did not reach it because `boreal-store` failed first. The owning
store/application integration steward must wire canonical schedule and
assignment activation facts, or explicitly pass absent facts with a diagnostic
until those projections exist. See `INTEGRATION-REQUESTS.md`.

The workspace formatter also reported pre-existing/unrelated drift in:

- `crates/store/src/lib.rs`
- `crates/store/src/profiles.rs`
- `crates/store/src/recovery.rs`
- `crates/store/tests/production_store_seams.rs`

Owned Rust formatting passed after formatting only the three granted source/test
paths. No protected path was edited by this attempt.
