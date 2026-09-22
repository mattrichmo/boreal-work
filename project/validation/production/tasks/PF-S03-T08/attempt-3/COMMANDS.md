# PF-S03-T08 — attempt 3 commands

All commands ran from `/Users/cybertron/Code/boreal-work` on 2026-09-22.
Toolchain: `rustc 1.85.0 (4d91de4e4 2025-02-17) (Homebrew)`, `cargo 1.85.0`,
Python `3.14.3`. The input Git identity was
`b543d41008301f7745c899e95f5cb7203ca64917`; the worktree remained dirty with
unrelated concurrent worker paths. No commit or push was performed.

## Checks

| Command | Exit | Result |
| --- | ---: | --- |
| `bwrk prime --json` | 0 | Returned envelope outcome `rejected`, error `invalid_argument: missing project identifier`; no state change. The file-based plan remains authoritative for this task. |
| `cargo test --locked -p boreal-domain --test production_properties -- --nocapture` before repair edits | 0 | Existing rejected target passed 13 tests; this was baseline context, not acceptance. |
| `rustfmt --edition 2021 crates/domain/tests/production_properties.rs` | 0 | Formatted only the owned test file. |
| First focused compile/run after repair edits | 101 | Preserved intermediate compile errors: type inference for the dependency project, invalid `DerivedStatus::Open`, and one unused import. Fixed within the assigned test file. |
| Second focused compile/run after those fixes | 0 | 19 tests passed. |
| `rustfmt --edition 2021 --check crates/domain/tests/production_properties.rs` | 0 | Owned test file formatted. |
| `cargo test --locked -p boreal-domain --test production_properties -- --nocapture` final | 0 | 20 tests passed, 0 failed. Pure-domain target only. |
| `cargo check --locked -p boreal-domain --tests` | 0 | Domain test targets compiled. |
| `cargo clippy --locked -p boreal-domain --all-targets -- -D warnings` first run | 101 | Preserved `clippy::too_many_arguments` for the local status fixture helper; fixed with a scoped test-helper allow. |
| `cargo clippy --locked -p boreal-domain --all-targets -- -D warnings` final | 0 | Domain library and all test targets passed with `-D warnings`. |
| `cargo test --locked -p boreal-domain` | 0 | 136 unit/integration tests passed; 0 failed; 0 ignored; doc-tests 0/0. |
| `cargo fmt --all -- --check` | 1 | Blocked by pre-existing formatting drift outside this write set in `crates/application/src/evidence.rs`, `crates/application/src/runtime.rs`, and `crates/cli/src/update.rs`. Owned-file rustfmt passed. |
| `python3 project/spec/validate_contracts.py` | 0 | PASS: 8 protocol envelopes, 11 guidance fixtures, 10 workflow assets, 18 legal/15 illegal transition vectors, 19 clock/dependency cases, 52 conformance mappings, SQLite schema parsed. |
| `git diff --check` | 0 | No whitespace errors. |

## Final source hashes

```text
098d5938b10a371dbeb59f923158ad9e571025f8e46cc13b253144f595165fad  crates/domain/tests/production_properties.rs
152960000e878afdbd0e4d6f1b3e47cba2e80ca97cc3f28f6889d5f668687be3  project/validation/production/domain/PF-S03-T08-ORACLE.md
8c8293e61be01be9d699f405d38bcbfd34d35033440ad6f757c233645c05c2e7  crates/domain/src/lib.rs
8ac6bdecee87c1d14c139a8fe9554be2b448a6fa1d00ebcad79bfe9a3d5c23e7  crates/domain/src/actions.rs
24895893d826f6a540975e648392de6e677b03e5b7434175711dc6b64f4ed85d  crates/domain/src/decision_inputs.rs
a2bbe9d64569f1be5f34cc2ab1c51d62b1ad45e9a2141dca3727c23efc2afcac  crates/domain/src/status_evaluator.rs
43001bf2e6009aea63d74662cd47fd1d65183ba76759280c20edeb4076298112  crates/domain/src/dependencies.rs
131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa1  project/spec/production/contract-manifest.json
b2b41ffd640811118e2c8f0ac0ba9c60d79cc46ccc73135cdcf609ae384b3a94  project/spec/production/status-and-actions.md
4a22bceb49b8d40d96a872f2ae3aed8b79a81d5636339c609914a05b3a2a9d38  project/spec/transition-table.md
fb47a166efc1bcef7b94300e638ff67bf45b24dc1767dcd4475301525946ce70  project/spec/production/reason-registry.json
```

The raw command output remains available from the worker run; prior failed
attempt-1 and rejected attempt-2 records remain unchanged.
