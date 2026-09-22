# PF-S03-T02 attempt 3 — commands and results

Workspace: `/Users/cybertron/Code/boreal-work`  
Attempt date: `2026-09-22`  
Input HEAD: `784a41b3802c29a76721c55eef2e9493283396c2`  
Host/toolchain: Darwin arm64; `rustc 1.85.0 (4d91de4e4 2025-02-17)`, `cargo 1.85.0`

All commands ran from the workspace root. The repository was already dirty;
no unrelated path was reset or overwritten.

## Workflow diagnostics

These were read-only diagnostics only. The file-based production-completion
plan explicitly forbids using `bwrk` to claim or close plan items.

| Command | Exit | Observed result |
| --- | ---: | --- |
| `bwrk prime --json` | `2` | Typed `outcome: rejected`, `error.code: invalid_argument`, `missing project identifier`; no mutation. |
| `bwrk workflows show boreal.workflow.claim-and-finish-work.v1` | `6` | `service_busy`; the local database owner was `process:68913:sha256:37e8ffb92bd9e159abd0e6909a4849f6a9e0c1b0dc3451a9129bb4f74d6f5df8`; no lock break or lifecycle mutation. |
| `bwrk workflows show boreal.workflow.closeout-work.v1` | `6` | Same typed `service_busy` owner result; no lock break or lifecycle mutation. |

## Required verification

| Command | Exit | Observed result |
| --- | ---: | --- |
| `cargo fmt --all -- --check` | `0` | Passed with no output. |
| `cargo check --locked -p boreal-domain --tests` | `0` | Domain library and all domain test targets checked successfully. |
| `cargo test --locked -p boreal-domain --test production_status_precedence` | `0` | `8 passed, 0 failed, 0 ignored`. |
| `cargo test --locked -p boreal-domain` | `0` | `71 passed, 0 failed, 0 ignored`; `0` doc tests. |
| `cargo clippy --locked -p boreal-domain --all-targets -- -D warnings` | `0` | Strict clippy passed for the complete domain package and all targets. |

The focused target includes the prior six T02 cases plus two new corrective
regressions. The full domain count is 15 unit tests, 4 hierarchy tests, 15
M02 status tests, 10 production acceptance tests, 10 production decision-input
tests, 8 production precedence tests, 9 work-model tests, and 0 doc tests.

