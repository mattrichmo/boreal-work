# PF-S03-T02 attempt 2 — commands and results

Workspace: `/Users/cybertron/Code/boreal-work`  
Attempt date: `2026-09-22`  
Input HEAD: `784a41b3802c29a76721c55eef2e9493283396c2`  
Host/toolchain: Darwin arm64; `rustc 1.85.0 (4d91de4e4 2025-02-17)`, `cargo 1.85.0`

All commands ran from the workspace root unless noted. No command changed
product or coordinator files.

## Exact commands

| Command | Exit | Observed result |
| --- | ---: | --- |
| `bwrk workflows show boreal.workflow.review.v1 --json` | `0` | Typed `outcome: busy`, `error.code: service_busy`; database owner `process:68913:sha256:37e8ffb92bd9e159abd0e6909a484f6a9e0c1b0dc3451a9129bb4f74d6f5df8`; no lock break or lifecycle mutation. |
| `cargo fmt --all -- --check` | `0` | Workspace formatting check passed with no output. |
| `cargo check --locked -p boreal-domain --tests` | `0` | Domain library and all domain test targets checked successfully. |
| `cargo test --locked -p boreal-domain --test production_status_precedence` | `0` | `6 passed, 0 failed, 0 ignored`. |
| `cargo test --locked -p boreal-domain` | `0` | `68 passed, 0 failed, 0 ignored`; `0` doc tests. Includes unit, hierarchy, M02 status, production acceptance, decision-input, PF-S03-T02, and work-model targets. |
| `cargo clippy --locked -p boreal-domain --all-targets -- -D warnings` | `0` | Strict clippy passed for the complete domain package and all targets. |
| `sha256sum project/build-plan/production-completion/sprints/PF-S03/tasks/PF-S03-T02.md project/validation/production/tasks/PF-S03-T02/attempt-1/START.md project/validation/production/tasks/PF-S03-T02/attempt-1/COMMANDS.md project/validation/production/tasks/PF-S03-T02/attempt-1/EVIDENCE.md project/validation/production/tasks/PF-S03-T02/attempt-1/HANDOFF.md project/validation/production/tasks/PF-S03-T01/attempt-2/HANDOFF.md crates/domain/src/status_evaluator.rs crates/domain/tests/production_status_precedence.rs crates/domain/src/lib.rs crates/domain/src/decision_inputs.rs crates/domain/tests/production_decision_inputs.rs project/spec/production/contract-manifest.json project/spec/production/status-and-actions.md project/spec/production/reason-registry.json project/spec/production/acceptance-and-proof.md project/spec/production/execution-submission-contract.md project/spec/production/dependencies-overrides-reopen.md project/spec/production/profile-registry.json project/spec/production/conformance-matrix.json project/build-plan/production-completion/reference/context/R-EVALUATOR.md project/build-plan/production-completion/reference/context/R-STATUS.md project/build-plan/production-completion/reference/context/R-DOMAIN-TEST.md project/build-plan/production-completion/reference/context/R-TRANSITIONS.md project/build-plan/production-completion/reference/context/R-DOMAIN-V3.md project/build-plan/production-completion/reference/context/R-DECISIONS.md` | `0` | Source, prerequisite, contract, and prior-attempt identities recorded in `EVIDENCE.md`. |
| `git diff --check -- crates/domain/src/status_evaluator.rs crates/domain/tests/production_status_precedence.rs` | `0` | No whitespace errors in the worker-owned source/test paths. |

The worker's preserved attempt-1 failures are not replayed as current failures:
its first focused assertion and first strict-clippy run were corrected before
its final evidence. They remain preserved in
`project/validation/production/tasks/PF-S03-T02/attempt-1/COMMANDS.md`.

## Fresh-check limitation

The green focused test target covers the worker's six scenarios, but it does
not cover an already-terminal `AttemptPhase::Expired` with both elapsed clocks,
or failed/rejected gate facts after the current attempt is absent. Those gaps
are the source findings recorded in `EVIDENCE.md`; no product test was added by
this review.
