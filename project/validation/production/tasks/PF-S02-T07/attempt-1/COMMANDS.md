# PF-S02-T07 — Attempt 1 commands

Repository: `/Users/cybertron/Code/boreal-work`  
Input branch: `codex/apply-responsive-terminal-overlay`  
Input HEAD: `784a41b3802c29a76721c55eef2e9493283396c2`  
Worktree: dirty; unrelated changes were preserved.

| Command | Exit | Result |
| --- | ---: | --- |
| `cargo test --locked -p boreal-store --test production_operation_audit` | 0 | 6 passed, 0 failed. |
| `cargo clippy --locked -p boreal-store --test production_operation_audit -- -D warnings` | 0 | Task target passes strict clippy. |
| `rustfmt --edition 2021 --check crates/store/src/operations.rs crates/store/src/audit.rs crates/store/tests/production_operation_audit.rs` | 0 | Changed files are formatted. |
| `cargo test --locked -p boreal-store --lib` | 0 | Store library compiled; 0 unit tests in the library target. |
| `cargo test --locked -p boreal-store --test production_store_seams` | 0 | Existing seam target: 5 passed, 0 failed. |
| `python3 project/spec/validate_contracts.py` | 0 | 8 envelopes, 11 guidance fixtures, 10 workflow assets, 18/15 transition vectors, 19 clock/dependency cases, 52 conformance mappings, schema parsed. |
| `git diff --check` | 0 | No whitespace errors. |
| `cargo fmt --all -- --check` | 0 | Workspace format check passed at the final check. |
| `cargo test --locked -p boreal-store` | 101 | Blocked by unrelated existing `crates/store/tests/production_recovery_records.rs`: missing root `jobs`/`recovery` exports and methods. No PF-S02-T07 test failure was reported. |

The package-wide failure was retained as evidence. This worker did not edit
`crates/store/src/lib.rs`, the recovery test, or any unrelated shared path.
