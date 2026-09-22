# PF-S03-T10 — attempt 6 start

## Dispatch identity

- Task: `PF-S03-T10` — complete deterministic oracle coverage for status and transitions.
- Remediation scope: typed `scheduled` status and `scheduled_start` reason, deterministic schedule/activation precedence and timers, semantic T/I coverage, and source-bound evidence.
- Base commit: `70514f0ed2521df710c3c913f50ff9d759f5e743`
- Worktree: combined coordinator checkout; existing unrelated worker changes are preserved and excluded from this bounded scope.
- Worker: PF-S03 domain-contract remediation steward, attempt 6.

## Authorized write boundary

- `crates/domain/src/lib.rs`
- `crates/domain/src/status_evaluator.rs`
- `crates/domain/src/actions.rs` only if typed scheduled action behavior requires it
- `crates/domain/tests/production_properties.rs`
- `project/validation/production/domain/`
- `project/validation/production/tasks/PF-S03-T10/attempt-6/`

No plan/state/acceptance records, protocol adapters, store/service paths,
contract source files, commits, or pushes will be changed by this attempt.

## Invariants and expected proof

1. `boreal.work-status/3` exposes `scheduled` and a typed `scheduled_start`
   reason while remaining deterministic at `< start`, `= start`, and `> start`.
2. Work-level `not_before_at` and explicit cycle/assignment activation input
   are independent blocking instants; the earliest future instant is the next
   reevaluation timer and neither permits a claim before equality.
3. Terminal, expiry, hard-hold, pause, retry, dependency, and schedule
   precedence remain stable; secondary reasons are retained and ordered.
4. The pure domain action model denies forward progress for `scheduled` while
   preserving inspection/readback and does not invent presentation policy.
5. Normative status/action and T/I vectors assert semantic outcomes, including
   positive/negative actions, dimensions, history/reopen/recovery invariance,
   and source/policy identity binding.

The status/2 compatibility projection remains an adapter responsibility. This
attempt records that requirement and does not modify protocol or UI adapters.
