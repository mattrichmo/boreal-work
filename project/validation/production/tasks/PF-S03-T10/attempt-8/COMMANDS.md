# PF-S03-T10 — attempt 8 commands

## Source identity

- Input `HEAD`: `70514f0ed2521df710c3c913f50ff9d759f5e743`
- Final owned source hash: `37bbcc93dfa8ec6122f3730a09312455763887a744bf57a59049d47735903d80`
  (`crates/application/src/status.rs`)
- The combined worktree was dirty before this attempt. Other stream changes
  were not reset, staged, committed, or pushed.

## Checks

| Command | Result |
| --- | --- |
| `cargo test --locked --offline -p boreal-application --lib status::tests` | **PASS** — 7/7 |
| `cargo test --locked --offline -p boreal-application --test status_projection` | **PASS** — 3/3 |
| `cargo check --locked --offline -p boreal-application` | **PASS** |
| `cargo test --locked --offline -p boreal-application` | **BLOCKED** — 41 unit tests and all other application targets passed; `p2_guided_flow_claims_three_harnesses_and_fences_recovery` failed on the combined-tree `boreal_resource_reservation` uniqueness constraint |
| `cargo check --locked --offline -p boreal-cli --bin bwrk` | **BLOCKED** — protected `crates/cli/src/main.rs:2687` does not yet match `DerivedStatus::Scheduled` |
| `cargo fmt --all -- --check` | **PASS** |
| `rustfmt --edition 2021 --check crates/application/src/status.rs` | **PASS** |
| `python3 project/spec/validate_contracts.py` | **PASS** |
| `git diff --check` | **PASS** |

The application test failure is outside the authorized status adapter path and
is retained as a bounded PF-S02 resource/recovery integration blocker. The CLI
compile failure is a protected caller request documented separately.

