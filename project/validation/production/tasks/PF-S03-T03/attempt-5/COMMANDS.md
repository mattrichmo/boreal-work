# PF-S03-T03 attempt 5 — commands and observed results

Workspace: `/Users/cybertron/Code/boreal-work`  
Input HEAD: `784a41b3802c29a76721c55eef2e9493283396c2`  
Branch: `codex/apply-responsive-terminal-overlay`  
Validation readback: `2026-09-22T10:00:24Z` UTC  
Toolchain: Darwin arm64; `rustc 1.85.0 (4d91de4e4 2025-02-17)`;
`cargo 1.85.0`; `rustfmt 1.8.0`  
All validation commands ran from the repository root. No command wrote a
source, test, plan, or state file.

## Read-only workflow observations

| Command | Exit | Observed result |
| --- | ---: | --- |
| `bwrk prime --json` | 0 | Protocol outcome `rejected`; `invalid_argument`; `missing project identifier`. |
| `bwrk workflows show boreal.workflow.claim-and-finish-work.v1 --json` | 0 | Protocol outcome `busy`; `service_busy`; database owner `process:68913:sha256:37e8ffb92bd9e159abd0e6909a4849f6a9e0c1b0dc3451a9129bb4f74d6f5df8`. |
| `bwrk workflows show boreal.workflow.closeout-work.v1 --json` | 0 | Same typed `service_busy` response. |
| `bwrk workflows show boreal.workflow.checkpoint-git-state.v1 --json` | 0 | Same typed `service_busy` response. |
| `bwrk workflows show boreal.workflow.link-dependencies.v1 --json` | 0 | Same typed `service_busy` response. |
| `bwrk workflows show boreal.workflow.finish.v1 --json` | 0 | Same typed `service_busy` response. |

No lock break, work claim, review, evidence attachment, acceptance, or
coordinator state transition was attempted.

## Fresh validation matrix

| Command | Exit | Observed result |
| --- | ---: | --- |
| `cargo test --locked -p boreal-domain --test production_time_policy -- --nocapture` | 0 | 17 passed, 0 failed, 0 ignored. The public-boundary regression passed. |
| `cargo test --locked -p boreal-domain` | 0 | 104 package tests passed, 0 failed, 0 ignored across unit/integration targets; doc-tests 0 passed, 0 failed. |
| `cargo check --locked -p boreal-domain --tests` | 0 | Domain library and all test targets checked successfully. |
| `cargo clippy --locked -p boreal-domain --all-targets -- -D warnings` | 0 | Strict all-target clippy passed with no warnings. |
| `cargo fmt --all -- --check` | 0 | Workspace Rust formatting passed. |
| `git diff --check` | 0 | No whitespace diagnostics in the tracked diff. |

The focused target exercised, among other vectors, exact deadline equality,
lease-only expiry, public phase-only no-trigger behavior, zero/shortening
renewals, immutable hard budget, expiry-review timer suppression, and
unvalidated-restart retry suppression.

## Source and contract identity

Current SHA-256 values captured before writing these four evidence files:

| Path | SHA-256 |
| --- | --- |
| `crates/domain/src/lib.rs` | `460b6e4dcd8e365b1318a32d9d11f80238418259550717e90d497ce25ced1bed` |
| `crates/domain/src/time_policy.rs` | `58ee17cdcad6e4cd7f42f75f68c5526471ce278d8c6f098c011f5207b5d2ac58` |
| `crates/domain/tests/production_time_policy.rs` | `31ba7ce120d547ffd86c6fa8eeaf7247b9cb84b6f86dde07b849ac7653508fe7` |
| `project/spec/production/execution-submission-contract.md` | `539088128f18bc6fef8bbd855ca6a140c4d02ba33bffc799179b128c2a8393a4` |
| `project/spec/production/status-and-actions.md` | `b2b41ffd640811118e2c8f0ac0ba9c60d79cc46ccc73135cdcf609ae384b3a94` |
| `project/spec/clock-and-attempt.json` | `65baf4f18512129c72c3239c91c3ffe95d2999fd63cea7227b4f9ad62997e80f` |
| `project/build-plan/production-completion/sprints/PF-S03/tasks/PF-S03-T03.md` | `892addfe415d344cba6ae32565d105a1774a22165d3758da8d1e1af15d33e36b` |
| `project/build-plan/production-completion/execution/STATE.json` | `5e6f1e2bd353942d12d7f745819fce93425446de832d7e264beef87b40f874f5` |

Attempt-4’s recorded source hashes for comparison were:

| Path | Attempt-4 SHA-256 | Attempt-5 current SHA-256 |
| --- | --- | --- |
| `crates/domain/src/lib.rs` | `504bb99b658217c8bb3d605f6e7b30b3f4080f14ed1f4928ca4b37121ef45538` | `460b6e4dcd8e365b1318a32d9d11f80238418259550717e90d497ce25ced1bed` |
| `crates/domain/src/time_policy.rs` | `58ee17cdcad6e4cd7f42f75f68c5526471ce278d8c6f098c011f5207b5d2ac58` | `58ee17cdcad6e4cd7f42f75f68c5526471ce278d8c6f098c011f5207b5d2ac58` |
| `crates/domain/tests/production_time_policy.rs` | `c535f8269097726cfafa6e28d2329a6e10d6c93434eef9868514b052761dc12d` | `31ba7ce120d547ffd86c6fa8eeaf7247b9cb84b6f86dde07b849ac7653508fe7` |

`STATE.json` had SHA-256
`5e6f1e2bd353942d12d7f745819fce93425446de832d7e264beef87b40f874f5` at the
pre-write readback and was not edited.

## Evidence handling

The command output was observed directly in the terminal; no separate log
artifact was created, keeping the write set limited to the four requested
Markdown files. Prior failed and rejected attempts remain in their original
directories. This record is pure-domain/public-boundary evidence, not a
workflow receipt and not coordinator acceptance.
