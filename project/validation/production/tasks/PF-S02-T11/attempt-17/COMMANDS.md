# PF-S02-T11 — attempt 17 command record

All commands ran from `/Users/cybertron/Code/boreal-work`. Toolchain:
`rustc 1.85.0 (4d91de4e4 2025-02-17) (Homebrew)`, `cargo 1.85.0`, Darwin
ARM64. Final source identity for the rows below is HEAD
`0d9611a017d5dc167e92fe79e8d65756fbac2d5a` with the dirty paths recorded in
`HANDOFF.md`.

## Before behavior

Before the attempt-17 source edit, the current dirty runtime was the
attempt-16 façade at SHA-256
`f0b30ecb26d3ad0ac373ce5de0559006a04ae92d5ea663ac3a95862e9e9951be`; the
unchanged external-job test file was
`ddfbe915bb95a6150905d9cbd899db26ee94a7a187e186ba4d4a9c2f0f7b4ccb`.

| Exact command | Source / result |
| --- | --- |
| `cargo test --locked --offline -p boreal-application --lib runtime::tests -- --nocapture` | Initial baseline: exit `0`, 8 passed, 0 failed. |
| `cargo test --locked --offline -p boreal-application --test production_external_jobs -- --nocapture` | Initial baseline: exit `0`, 12 passed, 0 failed. |
| `cargo test --locked --offline -p boreal-application` | Initial baseline: exit `0`, 44 unit tests and all application integration/doc targets passed; the external-job target had 12 tests. |
| `rg -n 'AttemptRecoveryAdapter::new|resource-release-request|evidence_ref: request.operation_id' crates/application/src/runtime.rs` | Initial source inspection found the unbound terminal release call and non-canonical fallback identity. |

## Final behavior and checks

| Exact command | Exit/result |
| --- | --- |
| `cargo test --locked --offline -p boreal-application --lib runtime::tests -- --nocapture` | `0` — 8 passed, 0 failed. |
| `cargo test --locked --offline -p boreal-application --test production_external_jobs -- --nocapture` | `0` — 14 passed, 0 failed, including `terminal_release_uses_canonical_identity_bound_recovery` and `terminal_release_fallback_uses_identity_bound_canonical_event`. |
| `cargo test --locked --offline -p boreal-application` | `0` — 44 unit tests; all integration targets and doc tests passed. |
| `cargo test --locked --offline -p boreal-store --test production_recovery_records -- --nocapture` | `0` — 12 passed, 0 failed; identity-bound recovery, stale fence, exact resource acknowledgement, replay, restart, and bounded-query cases passed. |
| `cargo test --locked --offline -p boreal-store --test production_integration -- --nocapture` | `0` — 4 passed, 0 failed; canonical release acknowledgement, identity replay/rollback, and production schema open/reopen cases passed. |
| `cargo clippy --locked --offline -p boreal-application --all-targets -- -D warnings` | `0` — strict all-target application Clippy passed on final HEAD; no broad source lint allowance added. An earlier pre-checkpoint run was blocked by unrelated store dead-code diagnostics; final coordinator checkpoint resolved that external build blocker. |
| `cargo fmt --all -- --check` | `0` — workspace formatting passed on final HEAD. An earlier pre-checkpoint run reported only unrelated CLI/memory formatting drift. |
| `rustfmt --edition 2021 --check crates/application/src/runtime.rs crates/application/tests/production_external_jobs.rs` | `0` — owned files formatted. |
| `python3 project/spec/validate_contracts.py` | `0` — 8 protocol envelopes, 11 guidance fixtures, 10 workflow assets, 18 legal/15 illegal transitions, 19 clock/dependency cases, 52 conformance mappings, and SQLite schema parsing passed. |
| `git diff --check` | `0` — no whitespace errors. |

## Source hashes after validation

```text
HEAD: 0d9611a017d5dc167e92fe79e8d65756fbac2d5a
crates/application/src/runtime.rs: 604f38c3f53f4ea4176e4aca02d9a44226a0c11114556626ef6e169e4dd66717
crates/application/tests/production_external_jobs.rs: 43aaaac3878c56fc34d47677f60894f9f2e75b41ff0ab75512155bdd01486f5d
```

No command in this attempt edited plan/state/acceptance records, committed,
or pushed source. Temporary test databases were created by the existing tests
and removed by their test cleanup paths.
