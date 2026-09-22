# PF-S03-T03 attempt 4 — commands and receipts

Workspace: `/Users/cybertron/Code/boreal-work`  
Input HEAD: `784a41b3802c29a76721c55eef2e9493283396c2`  
Branch: `codex/apply-responsive-terminal-overlay`  
Toolchain: Darwin arm64; `rustc 1.85.0 (4d91de4e4 2025-02-17)`; `cargo 1.85.0`; `rustfmt 1.8.0`  
Worktree: dirty; 74 status entries at final pre-write readback.

All commands ran from the repository root. The only review writes are the
four attempt-4 validation files. Source, prior evidence, and `STATE.json`
were read-only.

## Workflow/read-only observations

| Command | Exit | Result |
| --- | ---: | --- |
| `bwrk workflows show boreal.workflow.review.v1 --json` | `0` | Protocol `outcome: busy`, `error.code: service_busy`; database owner `process:68913:sha256:37e8ffb92bd9e159abd0e6909a4849f6a9e0c1b0dc3451a9129bb4f74d6f5df8`. |
| `bwrk work review-candidates boreal-work --json` | `0` | Protocol `outcome: busy`, `error.code: service_busy`; no candidate readback. |
| `bwrk work show boreal-work PF-S03-T03 --json` | `0` | Protocol `outcome: busy`, `error.code: service_busy`; no work readback. |

No lock break, claim, review decision, acceptance, or coordinator mutation was
attempted.

## Fresh exact-tree checks

| Command | Exit | Result |
| --- | ---: | --- |
| `cargo fmt --all -- --check` | `0` | Workspace formatting passed. |
| `cargo test --locked -p boreal-domain --test production_time_policy -- --nocapture` | `0` | 16 passed, 0 failed, 0 ignored. |
| `cargo test --locked -p boreal-domain` | `0` | 103 unit/integration tests passed, 0 failed; doc-tests 0 passed, 0 failed. |
| `cargo check --locked -p boreal-domain --tests` | `0` | Domain library and all test targets checked. |
| `cargo clippy --locked -p boreal-domain --all-targets -- -D warnings` | `0` | Strict all-target domain clippy passed. |
| `git diff --check` | `0` | No whitespace diagnostics. |

The focused target includes fresh regressions for lease-trigger selection,
phase-only missing-reason failure, zero/shortening renewal candidates,
expiry-review timer suppression, and unvalidated-restart retry suppression.

## Current source identities

| Path | SHA-256 |
| --- | --- |
| `crates/domain/src/time_policy.rs` | `58ee17cdcad6e4cd7f42f75f68c5526471ce278d8c6f098c011f5207b5d2ac58` |
| `crates/domain/tests/production_time_policy.rs` | `c535f8269097726cfafa6e28d2329a6e10d6c93434eef9868514b052761dc12d` |
| `crates/domain/src/lib.rs` (read-only public boundary) | `504bb99b658217c8bb3d605f6e7b30b3f4080f14ed1f4928ca4b37121ef45538` |

## Contract identities

| Path | SHA-256 |
| --- | --- |
| `project/STATUS_MODEL.md` | `688595dc7d305a19e018ba727df4c850bc6a6d441e53cd4e537f02d9dc77a914` |
| `project/spec/transition-table.md` | `4a22bceb49b8d40d96a872f2ae3aed8b79a81d5636339c609914a05b3a2a9d38` |
| `project/spec/production/status-and-actions.md` | `b2b41ffd640811118e2c8f0ac0ba9c60d79cc46ccc73135cdcf609ae384b3a94` |
| `project/spec/production/execution-submission-contract.md` | `539088128f18bc6fef8bbd855ca6a140c4d02ba33bffc799179b128c2a8393a4` |
| `project/build-plan/production-completion/sprints/PF-S03/tasks/PF-S03-T03.md` | `892addfe415d344cba6ae32565d105a1774a22165d3758da8d1e1af15d33e36b` |

## Preserved history

Attempt 1 failures, the attempt-2 independent rejection R1–R4, and the
attempt-3 intermediate compile/test failures remain in their original
directories. Attempt-3's final source claims were rechecked here; this record
does not reuse its test totals as current evidence.

