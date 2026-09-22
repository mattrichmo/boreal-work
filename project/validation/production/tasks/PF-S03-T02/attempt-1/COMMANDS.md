# PF-S03-T02 attempt 1 — commands and results

Workspace: `/Users/cybertron/Code/boreal-work`
Attempt date: `2026-09-22`
Input HEAD: `784a41b3802c29a76721c55eef2e9493283396c2`
Branch: `codex/apply-responsive-terminal-overlay`
Host/toolchain: Darwin arm64; `rustc 1.85.0 (4d91de4e4 2025-02-17)`, `cargo 1.85.0`

All commands below ran from the workspace root unless noted. The worktree was
already dirty; unrelated status entries were not edited.

## Exact commands

| Command | Exit | Observed result |
| --- | ---: | --- |
| `bwrk prime boreal-work --json` | `0` | Typed `outcome: busy`, `error.code: service_busy`; database owner `process:68913:sha256:37e8ffb92bd9e159abd0e6909a484f6a9e0c1b0dc3451a9129bb4f74d6f5df8`; no lock break. |
| `bwrk workflows show boreal.workflow.claim-and-finish-work.v1 --json` | `0` | Typed `outcome: busy`, `error.code: service_busy`; workflow resolution unavailable while the same database owner held the lock. |
| `bwrk workflows show boreal.workflow.closeout-work.v1 --json` | `0` | Typed `outcome: busy`, `error.code: service_busy`; no closeout mutation attempted. |
| `rustfmt --edition 2021 crates/domain/src/status_evaluator.rs crates/domain/tests/production_status_precedence.rs` | `0` | Assigned Rust source/test formatted. |
| `rustfmt --edition 2021 --check crates/domain/src/status_evaluator.rs crates/domain/tests/production_status_precedence.rs` | `0` | Assigned Rust files formatted. |
| `cargo fmt --all -- --check` | `0` | Workspace formatting check passed. |
| `cargo check --locked -p boreal-domain --tests` | `0` | Domain library and all test targets checked successfully. |
| `cargo check --locked -p boreal-domain --tests` (parallel invocation) | `101` | Transient concurrent/incremental compile reported `validate_exception_records` missing while the unrelated `production_acceptance_policy` target was compiling; no owned source was implicated. |
| `cargo check --locked -p boreal-domain --tests` (serial retry) | `0` | Immediate retry passed; all domain test targets checked successfully. |
| `cargo test --locked -p boreal-domain --test production_status_precedence` (first run) | `101` | 5 passed, 1 failed because the new expiry assertion initially omitted the applicable `attempt_active` secondary reason. Failure preserved; test expectation corrected. |
| `cargo clippy --locked -p boreal-domain --test production_status_precedence -- -D warnings` (first source run) | `101` | Found two fixable owned-file diagnostics: `filter-map-bool-then` in `status_evaluator.rs` and redundant local binding. Both were corrected. |
| `cargo test --locked -p boreal-domain --test production_status_precedence` (final) | `0` | 6 passed, 0 failed, 0 ignored. |
| `cargo clippy --locked -p boreal-domain --test production_status_precedence -- -D warnings` (final) | `0` | Focused target passed strict clippy. |
| `cargo clippy --locked -p boreal-domain -- -D warnings` | `0` | Full domain package strict clippy passed. |
| `cargo test --locked -p boreal-domain` (final serial run after the priority tweak) | `0` | 15 unit + 4 hierarchy + 15 M02 status + 9 production acceptance + 10 PF-S03-T01 + 6 PF-S03-T02 + 9 work-model tests passed; 68 passed, 0 failed, 0 ignored; 0 doc tests. |
| `git diff --check -- crates/domain/src/status_evaluator.rs crates/domain/tests/production_status_precedence.rs` | `0` | No whitespace errors in owned source/test paths. |

The first focused failure was a test-vector correction, not a retained product
failure. The first strict-clippy failure was a source-quality failure in the
owned files and was fixed before the final checks. No command was run against a
service, database migration, genuine verifier, native package, publication, or
release channel.

## Final source identities

| Path | SHA-256 |
| --- | --- |
| `crates/domain/src/status_evaluator.rs` | `1eba7eb050489a5a433e11f62486854d8400db3932c5eac7640068129f0474f9` |
| `crates/domain/tests/production_status_precedence.rs` | `48e31ece43e9e73ca9b73b370fc8eab2c30af7eed4f1dd7e6e51c97b58c7a0e6` |
| `crates/domain/src/decision_inputs.rs` (accepted prerequisite context) | `24895893d826f6a540975e648392de6e677b03e5b7434175711dc6b64f4ed85d` |
| `crates/domain/tests/production_decision_inputs.rs` (accepted prerequisite context) | `b6f093098c603f34a12cc571df00c1b4c0d308395c6536fffbd93a34a8df64d8` |
| `project/spec/production/contract-manifest.json` | `131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa` |
| `project/validation/production/tasks/PF-S03-T01/attempt-2/HANDOFF.md` | `6f3a4b5d96ada595b01b937e5fb99b99e41cccfdaa581f2bb5b4e7899552ee6e` |

The final worktree had 62 porcelain entries, including unrelated pre-existing
changes and this task's source/evidence paths. No unrelated path was staged,
reset, or rewritten.
