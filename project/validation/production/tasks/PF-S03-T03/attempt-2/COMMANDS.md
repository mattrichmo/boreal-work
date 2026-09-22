# PF-S03-T03 attempt 2 — independent review commands and results

Workspace: `/Users/cybertron/Code/boreal-work`
Review date: `2026-09-22`
Review window: `2026-09-22T09:24:33Z` onward, UTC
Input HEAD: `784a41b3802c29a76721c55eef2e9493283396c2`
Branch: `codex/apply-responsive-terminal-overlay`
Worktree: dirty; 74 status entries at readback
Host/toolchain: Darwin arm64; `rustc 1.85.0 (4d91de4e4 2025-02-17) (Homebrew)`;
`cargo 1.85.0`

All Rust commands ran from the workspace root. No command edited product
source, product tests, `STATE.json`, or prior evidence.

## Required workflow and public-boundary checks

| Command | Exit | Observed result |
| --- | ---: | --- |
| `bwrk workflows show boreal.workflow.review.v1 --json` | `6` | Typed `outcome: busy`, `error.code: service_busy`; operation `op_cli_1790069101640_42870_0`; local database owner `process:68913:sha256:37e8ffb92bd9e159abd0e6909a4849f6a9e0c1b0dc3451a9129bb4f74d6f5df8`; no lock break or state mutation. |
| `bwrk work review-candidates boreal --json` | `6` | Typed `outcome: busy`, `error.code: service_busy`; operation `op_cli_1790069101626_42869_0`; no candidate eligibility was inferred from filenames or evidence paths. |
| `bwrk work show boreal PF-S03-T03 --json` | `6` | Typed `outcome: busy`, `error.code: service_busy`; operation `op_cli_1790069101618_42868_0`; no work-show result was inferred. |
| `rg -n '^pub mod time_policy;|^use boreal_domain::time_policy::|^#\\[path = .*time_policy' crates/domain/src/lib.rs crates/domain/tests/production_time_policy.rs` | `0` | Public registration at `crates/domain/src/lib.rs:12`; public import at `crates/domain/tests/production_time_policy.rs:8`; no source-path shim match. |
| `git diff --check -- crates/domain/src/time_policy.rs crates/domain/src/lib.rs crates/domain/tests/production_time_policy.rs` | `0` | No whitespace diagnostics on the reviewed source/test paths. |

## Required Rust validation

| Command | Exit | Observed result |
| --- | ---: | --- |
| `cargo fmt --all -- --check` | `0` | Workspace formatting passed on the current dirty tree. |
| `cargo test --locked -p boreal-domain --test production_time_policy` | `0` | Focused public-boundary target: 12 passed, 0 failed, 0 ignored. |
| `cargo test --locked -p boreal-domain` | `0` | Full domain package: 96 passed, 0 failed, 0 ignored; doc-tests 0 passed, 0 failed. |
| `cargo check --locked -p boreal-domain --tests` | `0` | Domain library and all test targets checked successfully. |
| `cargo clippy --locked -p boreal-domain --all-targets -- -D warnings` | `0` | Strict all-target domain clippy passed. |

The focused target covered exact hard-deadline equality, separate lease/hard
defaults, renewal immutability, stale attempt/fence, historical terminal
clocks, pending recovery, due/eligibility, planning estimates, deterministic
retry equality, timer selection, backward/unvalidated restart authority,
validated monotonic restart, and selected malformed inputs. It did not cover
the rejected boundary findings recorded in `EVIDENCE.md`.

## Current source and contract identities

| Path | SHA-256 |
| --- | --- |
| `crates/domain/src/time_policy.rs` | `d3d83676b3d0fdf65346c409c6311278d304bed309b333aa4b28811a7516630e` |
| `crates/domain/src/lib.rs` | `504bb99b658217c8bb3d605f6e7b30b3f4080f14ed1f4928ca4b37121ef45538` |
| `crates/domain/tests/production_time_policy.rs` | `71792d46fc13d3936301a78d3fb2a7266ad9200e466eb338f1e57c7bf9d7a32c` |
| `project/spec/production/contract-manifest.json` | `131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa1` |
| `project/validation/production/tasks/PF-S03-T01/attempt-2/HANDOFF.md` | `6f3a4b5d96ada595b01b937e5fb99b99e41cccfdaa581f2bb5b4e7899552ee6e` |
| `project/validation/production/tasks/PF-S03-T02/attempt-4/HANDOFF.md` | `b5bfb371a4e732f898309a18fae8b7fb677d1e0de6d7028c579b435f2a4c8d13` |

## Review artifact identities

| Path | SHA-256 |
| --- | --- |
| `project/validation/production/tasks/PF-S03-T03/attempt-2/START.md` | `0f2e7ee868de9d08a16a568e4dc226185ed9011b138e435543825f38df38a745` |
| `project/validation/production/tasks/PF-S03-T03/attempt-2/EVIDENCE.md` | `55d51108666005d9e7880c12ccb076b6454afa94cb7e1ca9f20ed93a04d2cb79` |
| `project/validation/production/tasks/PF-S03-T03/attempt-2/HANDOFF.md` | `639ea26c11d13c850ad2d53af5798a60ac7e79cb693976a6b0e3f9acdb69ca4f` |

The Rust checks are pure-domain evidence only. No service, store transaction,
process-stop, native, publication, genuine verifier, or release evidence was
run or inferred.
