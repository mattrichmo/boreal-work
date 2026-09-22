# PF-S02-T10 attempt 19 — commands and exact results

All commands ran from `/Users/cybertron/Code/boreal-work` against the dirty
combined tree whose committed base is `70514f0ed2521df710c3c913f50ff9d759f5e743`.

| Command | Result |
|---|---|
| `cargo test --locked --offline -p boreal-store --test storage_remediation status_gate_queries_are_batched_for_large_projects -- --exact --nocapture` | **FAIL**, exit 101; assertion reports `status prepared 762 statements; expected fixed-size relation reads` at `crates/store/tests/storage_remediation.rs:284`. |
| `cargo test --locked --offline -p boreal-application --test p2_guided_flow p2_guided_flow_claims_three_harnesses_and_fences_recovery -- --exact --nocapture` | **FAIL**, exit 101; `UNIQUE constraint failed: boreal_resource_reservation.project_id, boreal_resource_reservation.resource_key` at `crates/application/tests/p2_guided_flow.rs:106`. |
| `git diff --check` | **PASS**, exit 0. |
| `python3 project/spec/validate_contracts.py` | **PASS**, exit 0; protocol/guidance/workflow/transition/clock/dependency/conformance/schema checks passed. |
| `cargo fmt --all -- --check` | **PASS**, exit 0. |

The application test was rerun after the temporary diagnostic output was
removed. No source, plan, ledger, commit, or push was changed by attempt 19.
