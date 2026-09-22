# PF-S02-T10 recovery contract fixture — attempt 22 command record

Commands ran from `/Users/cybertron/Code/boreal-work` against the current
combined worktree. No plan/state command, commit, or push was run.

| Command | Result |
| --- | --- |
| `cargo test --locked --offline -p boreal-store --test store_contracts expiry_and_cancel_are_fenced_and_release_the_reservation -- --nocapture` | PASS — 1 passed, 0 failed, 23 filtered |
| `cargo test --locked --offline -p boreal-store` | PASS — 153 passed, 1 ignored, 0 failed across all store targets; doc-tests included with 0 tests |
| `cargo test --locked --offline -p boreal-store --test production_recovery_records -- --nocapture` | PASS — 12 passed, 0 failed |
| `cargo test --locked --offline -p boreal-store --test production_integration -- --nocapture` | PASS — 4 passed, 0 failed |
| `rustfmt --edition 2021 crates/store/tests/store_contracts.rs` | PASS — formatted the single allowlisted source file |
| `cargo fmt --all -- --check` | PASS |
| `python3 project/spec/validate_contracts.py` | PASS — 8 protocol envelopes, 11 guidance fixtures, 10 workflow assets, 18 legal/15 illegal transitions, 19 clock/dependency cases, 52 conformance mappings, SQLite schema parsed |
| `git diff --check` | PASS |

The full-store result was repeated after formatting with `cargo test
--locked --offline -p boreal-store --quiet`; it exited 0 with the counts above.

## Source hash

```text
601922236ee0d2bd11364a0fd0de58712a5faf841d0e288e48b3c17120964557  crates/store/tests/store_contracts.rs
```
