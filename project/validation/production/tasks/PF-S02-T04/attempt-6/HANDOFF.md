# PF-S02-T04 — Attempt 6 integration handoff

## Disposition

**`awaiting_reconciliation` / not accepted.** The shared store integration is implemented and the focused regressions pass, but the full store gate exposed one compatibility-fixture failure. No commit or push was made.

## Changed files

- `crates/store/src/lib.rs`
  - Added read-only pinned-requirement availability checks.
  - Integrated immutable requirement validation into project status and direct gate diagnostics.
  - Quarantines corrupt requirement rows with a visible diagnostic and integrity hold.
  - Uses persisted declarations for summary-required closeout policy.
  - Uses persisted profile/declaration identity for receipt policy validation.
  - Preserves the old observed-gate fallback only when the additive requirement schema is unavailable; this is incomplete for old schema-v2 fixtures where the tables exist but work rows were manually seeded without pins.
- `crates/store/tests/production_profile_requirements.rs`
  - Added real status, closeout, and receipt regression coverage for corrupt pinned declarations.
  - Added a bounded corruption-fixture helper that restores immutable triggers after setup.
- `project/validation/production/tasks/PF-S02-T04/attempt-6/{START,COMMANDS,EVIDENCE,HANDOFF}.md`

## Validation summary

- Focused T04 target: **19 passed**.
- Formatting check: **passed**.
- Diff check: **passed**.
- Full store package: **failed** at `production_store_seams::acceptance_seam_reads_pinned_gate_and_exact_binding` because the fixture expects `verification` while the integrated path returns `requirements_missing` for its unpinned manually-created work.
- Strict store Clippy: **not run**, per the user's stop instruction after the focused test/format pass.

## Residual boundary

The remaining issue is deliberately narrow: decide and implement the compatibility rule for noncanonical schema-v2 fixtures that have pinned tables but no pinned snapshot. The safe production rule remains fail-closed. The compatibility rule must either:

1. explicitly classify those manually seeded rows as legacy and use observed-gate fallback, or
2. update the fixture to create work through the pinning boundary.

Do not weaken canonical production behavior or treat a missing snapshot as an empty acceptance policy. After that reconciliation, rerun the full store suite and strict store Clippy, then create a new source-bound attempt before independent review. Do not mark PF-S02-T04 accepted from this attempt alone.

## Exact source identity

Current tracked source is based on `3017a1dbebaa7945f82b2a2512ec0c1eabbd69c9`; the worktree also contains unrelated coordinator/worker changes and untracked runtime `memory/`, which were not edited by this bounded integration.
