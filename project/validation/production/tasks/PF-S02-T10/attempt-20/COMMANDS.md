# PF-S02-T10/T06 attempt 20 — command record

All commands ran from `/Users/cybertron/Code/boreal-work` against the dirty
combined tree at `70514f0ed2521df710c3c913f50ff9d759f5e743`. No source, plan,
state, commit, or push was performed by this attempt.

| Check | Result | Exact observation |
| --- | --- | --- |
| `cargo test --locked --offline -p boreal-store --test storage_remediation status_gate_queries_are_batched_for_large_projects -- --exact` | FAIL | `status prepared 762 statements; expected fixed-size relation reads` |
| `cargo test --locked --offline -p boreal-store --test storage_remediation` | FAIL | 14 passed, 1 failed: the same batching test |
| `cargo test --locked --offline -p boreal-application --test p2_guided_flow p2_guided_flow_claims_three_harnesses_and_fences_recovery -- --exact` | FAIL | unique constraint on `boreal_resource_reservation(project_id, resource_key)` at `p2_guided_flow.rs:106` |
| `cargo test --locked --offline -p boreal-application` | FAIL | 42 unit, 2 boundary, 4 knowledge, 2 authority, and 1 of 2 guided-flow tests passed; the guided lifecycle test failed with the same resource uniqueness error |
| `cargo test --locked --offline -p boreal-store --test production_recovery_records` | PASS | 11 passed |
| `cargo test --locked --offline -p boreal-store --test production_integration` | PASS | 4 passed |
| `cargo test --locked --offline -p boreal-store` | FAIL | All listed targets passed except the single batching test in `storage_remediation` |
| `cargo clippy --locked --offline -p boreal-store --all-targets -- -D warnings` | PASS | exit 0 |
| `cargo fmt --all -- --check` | PASS | exit 0 |
| `python3 project/spec/validate_contracts.py` | PASS | 8 envelopes, 11 guidance fixtures, 10 workflow assets, 18 legal/15 illegal transitions, 19 clock/dependency cases, 52 conformance mappings, schema parsed |
| `git diff --check` | PASS | exit 0 |
