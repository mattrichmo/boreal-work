# PF-S03-T02 attempt 3 — bounded corrective implementation start

## Identity and boundary

- Task: `PF-S03-T02` — implement exhaustive status precedence and reason ordering.
- Attempt: `attempt-3` corrective implementation after independent review attempt 2.
- Implementer: Codex, using the assigned domain/test write boundary.
- Workspace: `/Users/cybertron/Code/boreal-work`.
- Input HEAD: `784a41b3802c29a76721c55eef2e9493283396c2`.
- Branch: `codex/apply-responsive-terminal-overlay`.
- Worktree: dirty before this attempt; unrelated integrated-overlay changes were preserved.
- Start observation: `2026-09-22T08:39:46Z` UTC.
- Toolchain: `rustc 1.85.0 (4d91de4e4 2025-02-17)`, `cargo 1.85.0`.

## Read inputs

- `AGENTS.md`, `project/README.md`, `project/build-plan/README.md`,
  `MASTER_PLAN.md`, `AGENT_HANDOFF.md`.
- PF-S03 sprint and the complete PF-S03-T02 task card.
- Prior prerequisite and review records, especially
  `project/validation/production/tasks/PF-S03-T02/attempt-2/HANDOFF.md` and
  `EVIDENCE.md`.
- Current evaluator/test source and the typed domain status/reason contracts.

## Corrective invariant and write boundary

This attempt addresses only the two bounded attempt-2 findings:

1. An `AttemptPhase::Expired` expiry-review record retains applicable
   `LeaseElapsed` and `HardBudgetElapsed` reasons from its durable deadlines.
2. Required failed technical gates and rejected review gates remain proof or
   intervention facts when `current_attempt` is absent; they cannot become
   `Ready`/`Claim`.

The implementation uses the existing `StatusContext`, `GateState`,
`GateKind`, `DerivedStatus`, `DomainAction`, and `ReasonCode` surface. It does
not edit `crates/domain/src/lib.rs`, coordinator state, prior evidence, or
unrelated paths.

Only these paths are writable in this attempt:

- `crates/domain/src/status_evaluator.rs`
- `crates/domain/tests/production_status_precedence.rs`
- `project/validation/production/tasks/PF-S03-T02/attempt-3/`

This record requests review only. It makes no acceptance, service, native,
publication, or release claim.
