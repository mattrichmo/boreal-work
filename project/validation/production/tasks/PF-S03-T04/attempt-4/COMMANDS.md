# PF-S03-T04 attempt 4 — commands and results

Workspace for every command: `/Users/cybertron/Code/boreal-work`.
Review date: `2026-09-22`. HEAD:
`784a41b3802c29a76721c55eef2e9493283396c2`.

## Workflow probes

| Command | Exit | Result |
| --- | ---: | --- |
| `bwrk workflows show boreal.workflow.review.v1 --json` | `6` | Typed `busy/service_busy`; database owner unavailable; no mutation. |
| `bwrk work show boreal-work PF-S03-T04 --json` | `6` | Typed `busy/service_busy`; candidate readback unavailable; no mutation. |
| `bwrk work list boreal-work --json` | `6` | Typed `busy/service_busy`; candidate listing unavailable; no mutation. |

## Required validation

| Command | Exit | Result |
| --- | ---: | --- |
| `cargo fmt --all -- --check` | `0` | Passed. |
| `cargo check --locked -p boreal-domain --tests` | `0` | Domain library and all test targets compiled. |
| `cargo test --locked -p boreal-domain --test production_acceptance_policy` | `0` | `12 passed, 0 failed, 0 ignored`. |
| `cargo test --locked -p boreal-domain` | `0` | `73 passed, 0 failed, 0 ignored`; `0` doc tests. |
| `cargo clippy --locked -p boreal-domain --test production_acceptance_policy -- -D warnings` | `0` | Strict focused-target clippy passed. |
| `cargo clippy --locked -p boreal-domain --lib -- -D warnings` | `0` | Strict domain-library clippy passed. |
| `git diff --check` | `0` | Passed. |

## Direct regression vectors

| Command | Exit | Result |
| --- | ---: | --- |
| `cargo test --locked -p boreal-domain review_gate_is_conditional_and_self_review_is_rejected` | `0` | `1 passed, 0 failed`; existing self-review vector passed. |
| `cargo test --locked -p boreal-domain --test production_acceptance_policy invalid_force_exception_does_not_bypass_failure` | `0` | `1 passed, 0 failed`; unauthorized exception cannot bypass failure. |

The focused suite explicitly passed `newer_invalidated_exact_observations_do_not_shadow_older_valid_pass`, `failed_stale_altered_and_missing_proof_are_distinct`, `self_review_is_rejected_and_not_reported_as_missing_review`, and `newer_approval_for_another_submission_cannot_satisfy_current_review`.

## Environment and source identities

- `rustc --version`: `rustc 1.85.0 (4d91de4e4 2025-02-17) (Homebrew)`.
- `cargo --version`: `cargo 1.85.0`.
- `crates/domain/src/acceptance.rs`: SHA-256
  `6680f089ef262923359ea90c4c99a99b7db7147465d14160d154fe37a4ece4c4`.
- `crates/domain/tests/production_acceptance_policy.rs`: SHA-256
  `78198ba00a7d712e970bf110d32c60ed77d856836ab4ca4e1bca651f72913c10`.
- `crates/domain/src/lib.rs`: SHA-256
  `6f75fcd37496dbff5bc0d5a51b593696781f47818a44edffcd8617d6ef4f78b2`.
- `crates/domain/src/decision_inputs.rs`: SHA-256
  `24895893d826f6a540975e648392de6e677b03e5b7434175711dc6b64f4ed85d`.
- `project/spec/production/acceptance-and-proof.md`: SHA-256
  `da4c7796a801c185f33f0f309d82bc1a1a0f3aaa8ee6b3d546f49f7674714245`.
- `project/spec/production/contract-manifest.json`: SHA-256
  `131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa1`.

No product code, `STATE.json`, prior evidence, or unrelated path was edited.
