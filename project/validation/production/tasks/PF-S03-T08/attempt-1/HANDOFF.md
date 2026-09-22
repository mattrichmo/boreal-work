# Task handoff — PF-S03-T08 attempt 1

## Identity and disposition

- Task / plan / attempt: `PF-S03-T08` / `PF-production-completion-2026-09-21` /
  `attempt-1`.
- Worker: bounded validation worker (Codex).
- Reviewer: not assigned in this worker handoff; independent review remains
  required before coordinator acceptance.
- State requested: `ready_for_review`.
- Input/final source identity: branch
  `codex/apply-responsive-terminal-overlay`, `HEAD`
  `784a41b3802c29a76721c55eef2e9493283396c2`, dirty combined tree.
- Prerequisites read: accepted bounded PF-S03-T02, T03, T04, T05, T06, T07
  handoffs and PF-S01-T92; accepted production contract manifest and status,
  transition, dependency, proof, action, timer, and rollup context.

## Changes and invariant

Granted paths written:

- `crates/domain/tests/production_properties.rs`
- `project/validation/production/domain/PF-S03-T08-ORACLE.md`
- `project/validation/production/tasks/PF-S03-T08/attempt-1/`

No shared integration path was needed. No production source, manifest,
protocol/schema registry, plan ledger, or prior evidence was edited.

The new target provides deterministic generated status properties, explicit
differential transition oracles, exhaustive attempt/lifecycle pair coverage,
exact timer boundaries, dependency/isolation checks, actor-action descriptor
partitioning, terminal/reopen checks, and fail-closed proof/receipt subjects.
It uses public domain APIs and adds no package dependency.

## Validation

| Check | Outcome |
| --- | --- |
| Baseline proposed target | Not runnable before creation; Cargo exit `101`, no target. Preserved. |
| Owned rustfmt check | Passed, exit `0`. |
| Workspace `cargo fmt --all -- --check` | Passed, exit `0`. |
| Focused property target | Passed, 8/8, exit `0`. |
| Focused strict clippy | Passed, exit `0`. |
| Domain test compilation | Passed, exit `0`. |
| Full `cargo test --locked -p boreal-domain` | Passed, all reported unit/integration/doc tests. |
| Full domain strict clippy | Passed, exit `0`. |
| `git diff --check` | Passed, exit `0`. |

Exact commands, toolchain, source and contract hashes are in `COMMANDS.md` and
`EVIDENCE.md`.

## Impact and residual work

- Schema/migration/protocol: none.
- Service/store/application: not exercised; no claim made.
- Authority/history: pure tests preserve failed/foreign/stale facts as rejected
  outcomes; they do not establish production authentication or transaction
  enforcement.
- Packaging/release/native: not applicable to this bounded leaf.
- New findings: none raised within this task's pure-domain boundary.
- Residual requirement: assign an independent reviewer, inspect this target on
  the exact combined tree, and run PF-S03 reconciliation/revalidation. This
  handoff does not accept PF-S03-T08, PF-S03, or the release.

- [x] No test/run/peer/native success was inferred or fabricated.
- [x] Initial unsupported result and intermediate test failures were retained
      in the attempt narrative.
- [x] All final changed paths fit the granted boundary.
- [ ] Independent review and coordinator acceptance recorded separately.

