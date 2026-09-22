# PF-S03-T10 — attempt 7 start

## Assignment

- Task: `PF-S03-T10` — complete deterministic status/transition oracle coverage.
- Attempt: `7` — protected store/application adapter integration only.
- Input `HEAD`: `70514f0ed2521df710c3c913f50ff9d759f5e743`.
- Scope: reconcile the scheduled-status domain inputs from the current combined
  source and preserve the status/2 compatibility boundary.
- Implementer: PF-S03 adapter integration steward.
- Independent review: required; this attempt does not claim task or sprint
  acceptance.

## Granted paths

- `crates/store/src/status_evaluation.rs`
- `crates/application/src/status.rs`
- focused status tests under `crates/store/tests/` or
  `crates/application/tests/` only when they directly cover this adapter
  integration
- `project/validation/production/tasks/PF-S03-T10/attempt-7/`

## Protected paths not edited

- `crates/store/src/lib.rs`
- protocol models and service/CLI roots
- plan/state/ledger files
- commit/push operations

## Invariants

1. The domain evaluator remains the sole status/action policy engine.
2. Store readers use the canonical schedule and live cycle-assignment facts
   already loaded under the store snapshot transaction.
3. Application projection passes those facts through unchanged to the domain,
   while legacy status/2 presentation maps `scheduled` to `queued` and keeps
   the stable `scheduled_start` reason and non-claimable decision.
4. Snapshot revision, actor identity, availability/integrity diagnostics and
   existing precedence remain unchanged.

## Baseline

The combined tree currently contains the unaccepted PF-S03-T10 attempt-6
domain changes and protected store record fields/call site. The application
adapter still omits `schedule` and `activation_at`, so the combined source
cannot compile until this attempt reconciles those fields.
