# PF-S03-T04 attempt 2 — commands, results, and identities

Workspace for every command: `/Users/cybertron/Code/boreal-work`.
Review date: `2026-09-22`. HEAD: `784a41b3802c29a76721c55eef2e9493283396c2`.
Branch: `codex/apply-responsive-terminal-overlay`.

## Commands executed

| Command | Exit | Result |
| --- | ---: | --- |
| `bwrk workflows show boreal.workflow.review.v1 --json` | `6` | Typed `busy/service_busy`; database owner unavailable; no mutation. |
| `bwrk work show boreal-work PF-S03-T04 --json` | `6` | Typed `busy/service_busy`; candidate readback unavailable; no mutation. |
| `bwrk work list boreal-work --json` | `6` | Typed `busy/service_busy`; candidate listing unavailable; no mutation. |
| `cargo fmt --all -- --check` | `0` | Passed. |
| `cargo check --locked -p boreal-domain --tests` | `0` | Passed; domain library and all test targets compiled. |
| `cargo test --locked -p boreal-domain --test production_acceptance_policy` | `0` | `10 passed, 0 failed, 0 ignored`. |
| `cargo test --locked -p boreal-domain` | `0` | `69 passed, 0 failed, 0 ignored`; `0` doc tests. |
| `cargo clippy --locked -p boreal-domain --test production_acceptance_policy -- -D warnings` | `0` | Strict focused-target clippy passed. |
| `cargo clippy --locked -p boreal-domain --lib -- -D warnings` | `0` | Strict domain-library clippy passed. |

The full-domain count is 15 unit tests, 4 hierarchy tests, 15 M02 status
tests, 10 PF-S03-T04 acceptance tests, 10 PF-S03-T01 decision-input tests,
6 production status-precedence tests, 9 work-model tests, and 0 doc tests.

## Source and reference hashes

SHA-256 values were captured after the fresh checks:

| Path | SHA-256 |
| --- | --- |
| `crates/domain/src/acceptance.rs` | `cc1f3e25fc1b5399c592aa793bf1ca70cc37f46a86b5c85bd8db525637bc5ffd` |
| `crates/domain/tests/production_acceptance_policy.rs` | `6aa0a3bf8178107e88b2a1d39fa9571814a3758f87d1993776d5a8931a702ff4` |
| `crates/domain/src/lib.rs` | `6f75fcd37496dbff5bc0d5a51b593696781f47818a44edffcd8617d6ef4f78b2` |
| `crates/domain/src/decision_inputs.rs` | `24895893d826f6a540975e648392de6e677b03e5b7434175711dc6b64f4ed85d` |
| `project/build-plan/production-completion/sprints/PF-S03/tasks/PF-S03-T04.md` | `cda28b913779aaf8e8e36159548e46872cdc832c32c5122c37bc11d3acee5a12` |
| `project/validation/production/tasks/PF-S03-T01/attempt-2/HANDOFF.md` | `6f3a4b5d96ada595b01b937e5fb99b99e41cccfdaa581f2bb5b4e7899552ee6e` |
| `project/validation/production/tasks/PF-S03-T04/attempt-1/COMMANDS.md` | `1b9b6cddffa5115c066c8e18e2abaa7bbc0e59c2b038e4ca677ed33d57826774` |
| `project/validation/production/tasks/PF-S03-T04/attempt-1/EVIDENCE.md` | `9cc7ca88b399e598a95b85fcbcdfc113bd5c531b18f5b941b492a571d9a5fb2d` |
| `project/validation/production/tasks/PF-S03-T04/attempt-1/HANDOFF.md` | `736ff48c99798f34565bfeba9d6ce658df097c6485f2eabd57f31a5f6962abed` |
| `project/spec/production/acceptance-and-proof.md` | `da4c7796a801c185f33f0f309d82bc1a1a0f3aaa8ee6b3d546f49f7674714245` |
| `project/spec/production/contract-manifest.json` | `131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa1` |

The worker attempt-1 records report source hashes `9e140b832ccca7ec4e61309a7636ea5e8b600812d4c1732702f3a554db662720`
for `acceptance.rs` and `71910b70f0011eef77a2369a6f4b3a446772942c27bb7ae3d6ebb0e40476d1fb`
for its focused test. The reviewed integrated tree has the hashes listed
above; the public registration and public-import test were verified against
those current hashes.

## Preserved authority/history

No command in this review edited product source, `STATE.json`, prior attempt
evidence, or unrelated files. The service-busy result is retained as an
unsupported workflow probe, not converted into acceptance evidence.
