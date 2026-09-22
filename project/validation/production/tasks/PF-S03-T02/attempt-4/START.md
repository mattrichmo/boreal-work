# PF-S03-T02 attempt 4 — independent re-review start

## Identity and boundary

- Task: `PF-S03-T02` — implement exhaustive status precedence and reason ordering.
- Attempt: `attempt-4` independent re-review of corrective implementation attempt 3.
- Reviewer: Codex (OpenAI), independent validation reviewer; not the attempt-3 implementer.
- Workspace: `/Users/cybertron/Code/boreal-work`.
- Input HEAD: `784a41b3802c29a76721c55eef2e9493283396c2`.
- Branch: `codex/apply-responsive-terminal-overlay`.
- Worktree: dirty before review; unrelated changes were preserved.
- Review observation: `2026-09-22T08:44:29Z` UTC.
- Toolchain: Darwin arm64; `rustc 1.85.0 (4d91de4e4 2025-02-17) (Homebrew)`, `cargo 1.85.0`.

## Inputs read

- Repository `AGENTS.md`, project packet, production-completion master plan,
  PF-S03 sprint, PF-S03-T02 task card, startup/dispatch rules, validation
  playbook, and review gates.
- PF-S03-T02 attempt-3 `START.md`, `COMMANDS.md`, `EVIDENCE.md`, and
  `HANDOFF.md`.
- PF-S03-T02 attempt-2 `EVIDENCE.md` and `HANDOFF.md`, including rejected
  findings `PF-S03-T02-R1` and `PF-S03-T02-R2`.
- Current `crates/domain/src/status_evaluator.rs` and
  `crates/domain/tests/production_status_precedence.rs`.
- Contract manifest and the accepted status contract at
  `project/spec/production/status-and-actions.md`, plus the reason, proof, and
  execution/submission contract references used by the prior finding.

## Review invariant

The evaluator must preserve applicable elapsed-clock reasons for an already
expired/terminal attempt, and required failed technical gates or rejected
reviews must remain non-claimable when `current_attempt` is absent. The prior
precedence, reason-ordering, permutation, and action vectors must remain green.

This review writes only this attempt-4 directory:

- `START.md`
- `COMMANDS.md`
- `EVIDENCE.md`
- `HANDOFF.md`

No product source, product test, contract, plan file, `STATE.json`, prior
evidence, or unrelated path is edited. The decision is limited to
`PF-S03-T02`; it makes no sprint, service, native, publication, or release
claim.
