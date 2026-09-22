# PF-S02-T10 attempt 21R — command record

Baseline checkout: `70514f0ed2521df710c3c913f50ff9d759f5e743`.

All commands ran from `/Users/cybertron/Code/boreal-work` against the current
combined, dirty worktree. No plan/state command, commit, or push was run.

| Command | Result |
| --- | --- |
| `cargo test --locked --offline -p boreal-store --test production_recovery_records -- --nocapture` | PASS — 12/12 |
| `cargo test --locked --offline -p boreal-application --test p2_guided_flow -- --nocapture` | PASS — 2/2 |
| `cargo test --locked --offline -p boreal-store --test production_integration -- --nocapture` | PASS — 4/4 |
| `cargo test --locked --offline -p boreal-application --lib runtime::tests -- --nocapture` | PASS — 6/6 |
| `cargo test --locked --offline -p boreal-application` | PASS — all targets |
| `cargo test --locked --offline -p boreal-store` | BLOCKED — one out-of-scope `store_contracts::expiry_and_cancel_are_fenced_and_release_the_reservation` test still calls plain `released` resolution and receives the intentional authenticated-resolution conflict |
| `cargo clippy --locked --offline -p boreal-store --all-targets -- -D warnings` | PASS |
| `cargo clippy --locked --offline -p boreal-application --all-targets -- -D warnings` | BLOCKED — unused public `AttemptRecoveryAdapter::{new_with_identity,resolve,acknowledge_resource_release}` warning |
| `cargo fmt --all -- --check` | PASS |
| `python3 project/spec/validate_contracts.py` | PASS |
| `git diff --check` | PASS |

## Source hashes after attempt

```text
a30b0c8cac868e2376aee0f186bfffd69d37f696f175ecfb21421d59058f76f8  crates/store/src/recovery.rs
bc6eb958a5736af84d9481834e48934a4876ad111ab7dda5dd609c2193dabb58  crates/application/src/runtime.rs
89c60a481a909c2a8a524b590c6eb0a35941ec1fa46984eed2c249b83f4c9332  crates/application/tests/p2_guided_flow.rs
e42c104d1bb29be45166a98ad64fd43e3bd55c162bfb3f732dbc9cb6ee673d86  crates/store/tests/production_recovery_records.rs
```
