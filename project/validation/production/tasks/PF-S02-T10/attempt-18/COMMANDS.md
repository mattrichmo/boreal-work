# PF-S02-T10 attempt 18 — commands

Source identity for this attempt: baseline `70514f0ed2521df710c3c913f50ff9d759f5e743`.
The current working tree is dirty and uncommitted; no commit or push was made.
The worktree also contains unaccepted concurrent T11/T10 domain edits; the
commands below therefore report combined-tree results, not a clean acceptance
artifact.

| Command | Result |
|---|---|
| `cargo test --locked --offline -p boreal-store --test production_store_seams` | **PASS**: 5 passed. |
| `cargo test --locked --offline -p boreal-store --test production_integration` | **PASS**: 4 passed, covering fresh/upgrade/reopen, requirement retention/drift, exact replay/rollback, and resource release acknowledgement. |
| `cargo test --locked --offline -p boreal-store` | **FAIL**: 2 profile-requirement assertions fail; all other executed store targets pass. Failures are `missing_pinned_child_is_detected_instead_of_reducing_requirements` at `crates/store/tests/production_profile_requirements.rs:576` and `malformed_pinned_profile_and_child_content_is_quarantined_on_readback` at `:614`. |
| `cargo clippy --locked --offline -p boreal-store --lib -- -D warnings` | **PASS**. |
| `cargo check --locked --offline -p boreal-application` | **FAIL / protected path**: `crates/application/src/status.rs:291` lacks `activation_at` and `schedule`; concurrent `crates/application/src/evidence.rs:687` also has E0505 (`job` borrowed then moved). No application file was edited. |
| `cargo fmt --all -- --check` | **PASS**. |
| `rustfmt --edition 2021` on the authorized changed Rust files | **PASS**. |
| `git diff --check` | **PASS**. |
| `python3 project/spec/validate_contracts.py` | **PASS**: 8 protocol envelopes, 11 guidance fixtures, 10 workflow assets, 18 legal/15 illegal transition vectors, 19 clock/dependency cases, 52 conformance mappings, SQLite schema parsed. |

## Resolved store compiler diagnostic

```text
error[E0063]: missing fields `activation_at` and `schedule` in initializer of `StatusContext<'_>`
  --> crates/store/src/status_evaluation.rs:146:28
   |
146 |         Ok(evaluate_status(StatusContext {
   |                            ^^^^^^^^^^^^^ missing `activation_at` and `schedule`
```

This was resolved inside the authorized store boundary. The adapter now passes
the new fields and sources canonical activation timing from live v3 cycle
assignments. The application copy remains a protected integration request.

## Current residual failures

The full store command reaches tests but fails only the two profile-requirement
assertions named above. The application check remains blocked outside this
attempt's write set by the status-field integration and the concurrent evidence
borrow/move error. These are preserved as blockers, not hidden behind a store
success claim.
