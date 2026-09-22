# PF-S02-T11 — attempt 14 commands

Timestamp: `2026-09-22T18:33Z`  
Repository: `/Users/cybertron/Code/boreal-work`  
Base HEAD: `70514f0e`  
Toolchain: `rustc 1.85.0`, `cargo 1.85.0`

## Commands and results

| Command | Result |
| --- | --- |
| `rustfmt --edition 2021 crates/application/src/evidence.rs crates/application/tests/production_external_jobs.rs` | PASS; formatted only owned Rust files. |
| `rustfmt --edition 2021 --check crates/application/src/evidence.rs crates/application/tests/production_external_jobs.rs` | PASS. |
| `git diff --check -- crates/application/src/evidence.rs crates/application/tests/production_external_jobs.rs` | PASS. |
| `python3 project/spec/validate_contracts.py` | PASS; 8 protocol envelopes, 11 guidance fixtures, 10 workflow assets, 18 legal/15 illegal transition vectors, 19 clock/dependency cases, 52 conformance mappings, SQLite schema parsed. |
| `cargo test --locked -p boreal-memory` | PASS; 9 unit tests and 22 publisher tests passed; doc-tests passed. |
| `cargo test --locked -p boreal-application --test production_external_jobs` | BLOCKED before application compilation. `crates/store/src/status_evaluation.rs:146` initializes `StatusContext` without required `activation_at` and `schedule` fields. |
| `cargo test --locked -p boreal-application --lib runtime::tests` | BLOCKED by the same store compile error. |
| `cargo test --locked -p boreal-cli` | BLOCKED by the same store compile error. |
| `cargo test --locked -p boreal-store --test production_external_job_boundary` | BLOCKED by the same store compile error. |
| `cargo fmt --all -- --check` | BLOCKED by unrelated concurrent formatting drift in `crates/domain/src/status_evaluator.rs`, `crates/store/src/profiles.rs`, `crates/store/src/recovery.rs`, and `crates/store/tests/production_store_seams.rs`. |

The focused external-job target, including the new concurrent test, could not
execute because the combined tree does not compile before reaching
`boreal-application`. No result is represented as a pass by this attempt.
