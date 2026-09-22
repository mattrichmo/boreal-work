# PF-S03-T03 attempt 6 — commands and receipts

Workspace: `/Users/cybertron/Code/boreal-work`
Input HEAD: `784a41b3802c29a76721c55eef2e9493283396c2`
Branch: `codex/apply-responsive-terminal-overlay`
Review readback: `2026-09-22T10:10:04Z` UTC baseline
Toolchain: Darwin arm64; `rustc 1.85.0 (4d91de4e4 2025-02-17)`; `cargo 1.85.0`; `rustfmt 1.8.0`
Worktree: dirty; 74 status entries before creating this attempt directory.

All commands ran from the repository root. The only review writes are the
four attempt-6 Markdown files. Source, prior evidence, and `STATE.json` were
read-only.

## Read-only workflow observations

| Command | Exit | Observed result |
| --- | ---: | --- |
| `bwrk workflows show boreal.workflow.review.v1 --json` | `0` | Typed protocol envelope with `outcome: busy` and `error.code: service_busy`; database owner `process:68913:sha256:37e8ffb92bd9e159abd0e6909a4849f6a9e0c1b0dc3451a9129bb4f74d6f5df8`. |
| `bwrk work review-candidates boreal-work --json` | `6` | Typed protocol envelope with `outcome: busy` and `error.code: service_busy`; no candidate readback. |
| `bwrk work show boreal-work PF-S03-T03 --json` | `6` | Typed protocol envelope with `outcome: busy` and `error.code: service_busy`; no work readback. |

No lock break, claim, review mutation, evidence attachment, acceptance, or
coordinator state transition was attempted.

## Fresh exact-tree checks

| Command | Exit | Result |
| --- | ---: | --- |
| `cargo fmt --all -- --check` | `0` | Workspace Rust formatting passed. |
| `cargo test --locked -p boreal-domain --test production_time_policy -- --nocapture` | `0` | Focused public target: 17 passed, 0 failed, 0 ignored. |
| `cargo test --locked -p boreal-domain` | `0` | 104 package tests passed, 0 failed, 0 ignored across unit/integration targets; doc-tests 0 passed, 0 failed. |
| `cargo check --locked -p boreal-domain --tests` | `0` | Domain library and all test targets checked. |
| `cargo clippy --locked -p boreal-domain --all-targets -- -D warnings` | `0` | Strict all-target domain clippy passed with no warnings. |
| `git diff --check` | `0` | No whitespace diagnostics in the tracked diff. |

The focused target includes the public-boundary regressions for lease-only and
phase-only expiry, zero/shortening renewal candidates, expiry-review timer
suppression, and unvalidated-restart retry/timer suppression.

## Current source and contract identities

| Path | SHA-256 |
| --- | --- |
| `crates/domain/src/lib.rs` | `460b6e4dcd8e365b1318a32d9d11f80238418259550717e90d497ce25ced1bed` |
| `crates/domain/src/time_policy.rs` | `58ee17cdcad6e4cd7f42f75f68c5526471ce278d8c6f098c011f5207b5d2ac58` |
| `crates/domain/tests/production_time_policy.rs` | `31ba7ce120d547ffd86c6fa8eeaf7247b9cb84b6f86dde07b849ac7653508fe7` |
| `project/STATUS_MODEL.md` | `688595dc7d305a19e018ba727df4c850bc6a6d441e53cd4e537f02d9dc77a914` |
| `project/spec/transition-table.md` | `4a22bceb49b8d40d96a872f2ae3aed8b79a81d5636339c609914a05b3a2a9d38` |
| `project/spec/production/status-and-actions.md` | `b2b41ffd640811118e2c8f0ac0ba9c60d79cc46ccc73135cdcf609ae384b3a94` |
| `project/spec/production/execution-submission-contract.md` | `539088128f18bc6fef8bbd855ca6a140c4d02ba33bffc799179b128c2a8393a4` |
| `project/spec/clock-and-attempt.json` | `65baf4f18512129c72c3239c91c3ffe95d2999fd63cea7227b4f9ad62997e80f` |
| `project/build-plan/production-completion/sprints/PF-S03/tasks/PF-S03-T03.md` | `892addfe415d344cba6ae32565d105a1774a22165d3758da8d1e1af15d33e36b` |
| `project/build-plan/production-completion/execution/STATE.json` | `2d913ce57ba9344c0173c04f0fc1e41c1bd01389445cc7355e03b51d1d4cbd70` |

The `STATE.json` digest is recorded for read-only identity only; the file was
not edited.
