# PF-S02-T10 attempt 17 — store integration steward start

- Source identity: `70514f0ed2521df710c3c913f50ff9d759f5e743` (`70514f0e`), branch `codex/apply-responsive-terminal-overlay`.
- Baseline: the worktree is clean except the intentionally untracked nested `memory/` runtime directory; that directory is outside this attempt and will remain unmodified and unstaged.
- Role: integrate the bounded PF-S02-T04 profile, PF-S02-T06 recovery/jobs, and PF-S02-T07 operation/audit seams into the canonical store boundary, while preserving the Rust-owned service contract and fail-closed behavior.

## Invariants under review

1. Fresh, upgrade, and reopen paths apply one ordered migration/opening authority without unsafe repeated DDL.
2. Pinned acceptance requirements are durable independently of gate observations; deletion, drift, malformed identity, and missing project identity fail closed on root read/claim/close paths.
3. Canonical mutations validate identity-bound operation replay before side effects and preserve durable audit/readback semantics, including relevant direct store writers.
4. Recovery obligations, resource reservations, and external jobs remain registered at canonical lifecycle and revision boundaries; restart and concurrency do not erase or duplicate them.
5. Project/database identity and scope are bound at open and mutation boundaries, with no cross-project readback or replay.

## Authorized write set

- `crates/store/src/lib.rs`
- `project/spec/schema-production.sql`
- `crates/store/tests/production_integration.rs`
- `project/validation/production/tasks/PF-S02-T10/attempt-17/`
- Any exact migration/opening registration necessarily coupled to the files above.

No application memory/update work, CLI/TUI policy work, plan/state ledger edit, commit, or push is authorized in this attempt. If a required path falls outside the write set, record it as an integration request instead of editing it.

## Planned evidence

Record commands and outcomes in `COMMANDS.md`, evidence and limitations in `EVIDENCE.md`, and the bounded review handoff in `HANDOFF.md`. Use `INTEGRATION-REQUESTS.md` for unresolved protected-path work. Required checks include focused store integration tests, the full `boreal-store` suite, formatting, contract validation, and relevant compile checks.
