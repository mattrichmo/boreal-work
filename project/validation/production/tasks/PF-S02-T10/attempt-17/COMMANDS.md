# PF-S02-T10 attempt 17 — commands

Source baseline: `70514f0ed2521df710c3c913f50ff9d759f5e743` (`70514f0e`).
The checkout also contained unrelated in-progress edits in
`crates/application/src/evidence.rs` and
`crates/application/tests/production_external_jobs.rs`, plus nested `memory/`
runtime data and other agents' START records. Those paths were not edited by
this attempt.

| Command | Result |
| --- | --- |
| `python3 project/spec/validate_contracts.py` | PASS — 8 protocol envelopes, 11 guidance fixtures, 10 workflow assets, 18 legal/15 illegal transition vectors, 19 clock/dependency cases, 52 conformance mappings, SQLite schema parsed. |
| `git diff --check` | PASS. |
| `cargo fmt --all -- --check` | BLOCKED/FAIL on unrelated concurrent edits in `crates/application/src/evidence.rs` and `crates/store/src/recovery.rs`; no formatting issue was reported for an attempt-17 production file. |
| `cargo clippy --locked --offline -p boreal-store --lib -- -D warnings` | PASS. |
| `cargo test --locked --offline -p boreal-store --test production_integration` | BLOCKED before execution: no such test target exists. Cargo listed the existing store targets; `production_integration.rs` has not yet been created. |
| `cargo test --locked --offline -p boreal-store` | FAIL: all executed targets passed except `production_store_seams::profile_seam_validates_identity_and_definition_before_registration`, which fails because the committed fixture supplies `sha256:seam-policy` while the strict profile seam computes `sha256:04937b08e17caa0326307286452067bee4354acde865e7890753f8ad8a88bd4a`. The other production migration (16), operation/audit (19), profile (13), recovery (11), identity, external-job, claim, and seam tests passed. |

No commit, push, plan edit, state edit, or ledger edit was performed.
