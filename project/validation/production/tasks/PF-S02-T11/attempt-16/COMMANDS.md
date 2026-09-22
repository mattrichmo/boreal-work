# PF-S02-T11 attempt 16 — command record

All commands ran from `/Users/cybertron/Code/boreal-work` against the current
combined dirty worktree. No plan/state command, commit, or push was run.

| Command | Result |
| --- | --- |
| `cargo test --locked --offline -p boreal-application --lib runtime::tests -- --nocapture` | PASS — 8/8 |
| `cargo test --locked --offline -p boreal-application` | PASS — all application unit, integration, and doc-test targets |
| `cargo clippy --locked --offline -p boreal-application --all-targets -- -D warnings` | PASS |
| `cargo test --locked --offline -p boreal-store --test production_integration -- --nocapture` | PASS — 4/4 |
| `cargo test --locked --offline -p boreal-store --test production_recovery_records -- --nocapture` | PASS — 12/12 |
| `cargo fmt --all -- --check` | PASS |
| `python3 project/spec/validate_contracts.py` | PASS — 8 protocol envelopes, 11 guidance fixtures, 10 workflow assets, 18 legal/15 illegal transitions, 19 clock/dependency cases, 52 conformance mappings, schema parsed |
| `git diff --check` | PASS |

The earlier PF-S02-T10 `attempt-21R` full-store run remains separately
blocked by the existing out-of-scope `store_contracts` fixture that invokes
the intentionally rejected project-id-only `released` recovery path. This
attempt did not alter that store test.

