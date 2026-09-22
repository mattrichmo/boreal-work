# PF-S02-T04 — Attempt 4 commands and results

Repository: `/Users/cybertron/Code/boreal-work`  
Branch: `codex/apply-responsive-terminal-overlay`  
Input `HEAD`: `70514f0ed2521df710c3c913f50ff9d759f5e743`  
Final evidence time: `2026-09-22T18:51:16Z`  
Runtime: Darwin ARM64; `rustc 1.85.0`, `cargo 1.85.0`, `Python 3.14.3`.

The worktree is a dirty combined tree. No commit, push, plan-state edit, or
protected-root edit was made by this attempt.

## Baseline reproduction

| Command | Exit | Result |
| --- | ---: | --- |
| `cargo test --locked --offline -p boreal-store --test production_profile_requirements missing_pinned_child_is_detected_instead_of_reducing_requirements -- --nocapture` | 101 | Readback returned `StoreError::Corrupt("pinned requirement schema is not installed through the production opener")` before reaching the missing-child assertion. |
| `cargo test --locked --offline -p boreal-store --test production_profile_requirements malformed_pinned_profile_and_child_content_is_quarantined_on_readback -- --nocapture` | 101 | Readback returned the same schema-integrity diagnostic before reaching malformed child/profile validation. |

The cause was the corruption fixtures dropping an immutable trigger and not
restoring it. The strict read-only schema check was correctly failing closed;
it was not an error-message regression in `profiles.rs`.

## Final assigned checks

| Command | Exit | Result |
| --- | ---: | --- |
| `rustfmt --edition 2021 --check crates/store/src/profiles.rs crates/store/tests/production_profile_requirements.rs` | 0 | Assigned Rust files formatted. |
| `cargo test --locked --offline -p boreal-store --test production_profile_requirements` | 0 | 13 passed, 0 failed. |
| `cargo test --locked --offline -p boreal-store --test production_integration` | 0 | 4 passed, 0 failed. |
| `cargo clippy --locked --offline -p boreal-store --lib -- -D warnings` | 0 | Passed. |
| `cargo clippy --locked --offline -p boreal-store --all-targets -- -D warnings` | 0 | Passed. |
| `cargo fmt --all -- --check` | 0 | Passed on the combined tree. |
| `python3 project/spec/validate_contracts.py` | 0 | Passed: 8 protocol envelopes, 11 guidance fixtures, 10 workflow assets, 18 legal/15 illegal transition vectors, 19 clock/dependency cases, 52 conformance mappings, SQLite schema parsed. |
| `git diff --check` | 0 | Passed. |

## Combined-tree check retained as a blocker

| Command | Exit | Result |
| --- | ---: | --- |
| `cargo test --locked --offline -p boreal-store` | 101 | All reached targets passed except `storage_remediation::status_gate_queries_are_batched_for_large_projects`, which reports 762 prepared statements where the fixture expects fixed-size relation reads. This is outside the T04 write set and remains open for the status/store integration owner. |

## Final source hashes

```text
c709d56e7f4cbe02eb84a7a2e6a5911ed71c6b3c3d2c4684ba8888bab9f59e2b  crates/store/src/profiles.rs
28535da49cf5f2d620873519feee0960c77e3b217dae1c88aebac4c079c0efb4  crates/store/tests/production_profile_requirements.rs
5aa341af23b894092c036bb61ebf18e3052bbfbbdb2a1299163e1f6788db1362  crates/store/src/lib.rs
1f5c73fd84ed5df8618c6181aeaffd135a2c138d518e05f673e7ffe76f035d34  project/spec/schema-production.sql
848a05f3177f74f43af8df448e952a6a71470caa2d491f5e63ff2153f3ba79a9  project/validation/production/tasks/PF-S02-T04/attempt-4/START.md
```
