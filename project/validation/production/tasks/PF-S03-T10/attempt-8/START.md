# PF-S03-T10 — attempt 8 start

## Dispatch identity

- Task: `PF-S03-T10` — deterministic status and transition oracle integration.
- Remediation scope: application status projection wiring for canonical schedule
  and cycle/assignment activation, plus the status/2 compatibility boundary.
- Input `HEAD`: `70514f0ed2521df710c3c913f50ff9d759f5e743` (`70514f0e`).
- Worktree: combined coordinator checkout; existing stream changes are
  preserved and excluded unless they are required to compile the adapter.
- Worker: PF-S03 application status adapter steward, attempt 8.

## Authorized write boundary

- `crates/application/src/status.rs`
- directly relevant existing application status tests, if needed
- `project/validation/production/tasks/PF-S03-T10/attempt-8/`

No plan/state/acceptance records, protocol/service callers, CLI, store, domain,
schema, commits, or pushes will be changed by this attempt. If a protected
caller must change, this attempt records an exact integration request instead.

## Invariants and expected proof

1. Every application status decision receives only canonical `schedule` and
   `activation_at` facts from the store row; no retry or fixture data is used as
   a schedule substitute.
2. The pure domain decision remains status/3-shaped in `StatusWork.decision`,
   while the existing status/2 application read model maps `scheduled` to
   `queued` and retains `scheduled_start(<timestamp>)` as a reason.
3. Compatibility mapping must not make scheduled work claimable; the domain
   action and `claimable_for_actor` remain unchanged.
4. Existing revision, pagination, diagnostics, dependency, gate, and timer
   semantics remain intact.

