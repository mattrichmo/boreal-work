# PF-S02-T11 — attempt 35 commands

Working directory: `/Users/cybertron/Code/boreal-work`

Base commit: `5584d461a8192cd06999f14069b3fe590b059406`

## Checks

| Command | Result |
| --- | --- |
| `cargo test --locked -p boreal-application --lib evidence_store::tests::verifier_admission` | First run exposed a test-fixture readback mistake: production identity-bound jobs cannot use the legacy `external_job(project, id)` reader. The test was corrected to use `external_job_with_identity`. Rerun passed 2/2. |
| `cargo test --locked -p boreal-application --lib evidence_store::tests::verifier_unknown_outcome_remains_readback_required_after_atomic_admission` | Passed 1/1. |
| `cargo test --locked -p boreal-application` | Passed: 54 unit tests; all application integration targets passed, including `production_external_jobs` 14/14. |
| `cargo test --locked -p boreal-store --lib` | Passed: 1/1 store unit test. |
| `rustfmt --edition 2021 --check crates/application/src/evidence_store.rs crates/store/src/jobs.rs` | Passed. |
| `git diff --check -- crates/application/src/evidence_store.rs crates/store/src/jobs.rs crates/store/src/lib.rs` | Passed. |
| `cargo fmt --all -- --check` | Not clean because unrelated working-tree formatting remains in backup/restore helpers in `crates/store/src/lib.rs`; this attempt did not reformat that shared file. |

No release, CLI/TUI, real verifier-process, crash-injection, commit, or push
was performed for this bounded task.
