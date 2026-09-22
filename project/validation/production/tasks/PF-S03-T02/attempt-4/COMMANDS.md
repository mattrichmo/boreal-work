# PF-S03-T02 attempt 4 — commands and results

Workspace: `/Users/cybertron/Code/boreal-work`  
Review date: `2026-09-22`  
Input HEAD: `784a41b3802c29a76721c55eef2e9493283396c2`  
Host/toolchain: Darwin arm64; `rustc 1.85.0 (4d91de4e4 2025-02-17) (Homebrew)`, `cargo 1.85.0`

All commands ran from the workspace root. No command changed product or
coordinator files.

## Exact commands

| Command | Exit | Observed result |
| --- | ---: | --- |
| `bwrk workflows show boreal.workflow.review.v1 --json` | `6` | Typed `outcome: busy`, `error.code: service_busy`; the database owner was reported as `process:68913:sha256:37e8ffb92bd9e159abd0e6909a484f6a9e0c1b0dc3451a9129bb4f74d6f5df8`; read-only diagnostic, no lock break or lifecycle mutation. |
| `cargo fmt --all -- --check` | `0` | Passed with no output. |
| `cargo check --locked -p boreal-domain --tests` | `0` | Domain library and all domain test targets checked successfully. |
| `cargo test --locked -p boreal-domain --test production_status_precedence -- --nocapture` | `0` | `8 passed, 0 failed, 0 ignored`; all eight prior/corrective precedence and reason-ordering vectors passed. |
| `cargo test --locked -p boreal-domain` | `0` | `73 passed, 0 failed, 0 ignored`; `0` doc tests. |
| `cargo clippy --locked -p boreal-domain --all-targets -- -D warnings` | `0` | Strict clippy passed for the complete domain package and all targets. |

## Focused vector receipt

The focused target passed these exact tests:

- `paused_precedes_open_prerequisite_and_retains_the_safe_resume_action`
- `expiry_wins_the_hold_tie_and_retains_both_elapsed_clocks`
- `terminal_expiry_review_retains_elapsed_clocks_from_durable_deadlines`
- `failed_proof_rejected_review_and_missing_review_are_distinct`
- `failed_proof_and_rejected_review_without_current_attempt_cannot_be_claimed`
- `hard_reason_primary_selection_uses_intervention_priority_not_lexical_order`
- `equivalent_fact_permutations_produce_byte_equivalent_decisions`
- `next_action_follows_the_selected_status_branch`

## Source and contract identities

| Path | SHA-256 |
| --- | --- |
| `crates/domain/src/status_evaluator.rs` | `a2bbe9d64569f1be5f34cc2ab1c51d62b1ad45e9a2141dca3727c23efc2afcac` |
| `crates/domain/tests/production_status_precedence.rs` | `d7da1c4c7e494cb015b0fe21c92b3fa1a8e7e1cbe8b17c996c6c31430b340c5c` |
| `project/spec/production/status-and-actions.md` | `b2b41ffd640811118e2c8f0ac0ba9c60d79cc46ccc73135cdcf609ae384b3a94` |
| `project/spec/production/contract-manifest.json` | `131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa1` |
| `project/spec/production/reason-registry.json` | `fb47a166efc1bcef7b94300e638ff67bf45b24dc1767dcd4475301525946ce70` |
| `project/spec/production/acceptance-and-proof.md` | `da4c7796a801c185f33f0f309d82bc1a1a0f3aaa8ee6b3d546f49f7674714245` |
| `project/spec/production/execution-submission-contract.md` | `539088128f18bc6fef8bbd855ca6a140c4d02ba33bffc799179b128c2a8393a4` |
| `project/validation/production/tasks/PF-S03-T02/attempt-2/EVIDENCE.md` | `5e7a3b5ca77ba024c71f6991997df31f179787015e9fb44ac458320b04fd3417` |
| `project/validation/production/tasks/PF-S03-T02/attempt-2/HANDOFF.md` | `71d2dc1e45ce357f748a87280fc68099041e028f874a4beab2c00125c3650c52` |
| `project/validation/production/tasks/PF-S03-T02/attempt-3/EVIDENCE.md` | `431a91c13c2050e9495aade83538e88d83d1c4ef952f1b29e943e8cce6512040` |
| `project/validation/production/tasks/PF-S03-T02/attempt-3/HANDOFF.md` | `3f77034ce931e8ec3a2f12464c3e7f34c206b061af68c2c1b355027015e913fe` |
