# PF-S03-T10 — attempt 6 evidence

## Disposition

`ready_for_review` with a bounded protected-path integration blocker. This is a
pure-domain contribution only. It does not accept PF-S03-T10, PF-S03, the
status/3 contract, or any store/service/protocol behavior.

## Exact source scope

Attempt-owned production/test changes:

- `crates/domain/src/lib.rs`
- `crates/domain/src/status_evaluator.rs`
- `crates/domain/tests/production_properties.rs`

Attempt-owned evidence:

- `project/validation/production/domain/PF-S03-T10-ORACLE-ATTEMPT-6.md`
- `project/validation/production/tasks/PF-S03-T10/attempt-6/START.md`
- `project/validation/production/tasks/PF-S03-T10/attempt-6/COMMANDS.md`
- `project/validation/production/tasks/PF-S03-T10/attempt-6/INTEGRATION-REQUESTS.md`
- this file and `HANDOFF.md`

No contract source, protocol adapter, store, application, plan, ledger,
acceptance record, commit, or push was changed by this attempt.

## Implemented behavior

1. Added typed `DerivedStatus::Scheduled` and typed
   `ReasonCode::ScheduledStart(TimestampMs)` with stable parameterized reason
   codes.
2. Extended the pure `StatusContext` with optional canonical work schedule and
   resolved cycle/assignment activation inputs, while keeping existing
   constructor callers default-compatible.
3. Evaluated work `not_before_at` and activation constraints independently;
   the earliest future instant is the scheduled primary reason and next
   reevaluation timer. Equality clears the relevant constraint.
4. Preserved precedence: terminal, expiry, hard intervention, draft, active
   attempt/proof, pause, retry, scheduled, normal prerequisite queue, then
   readiness. Secondary schedule/retry/dependency/hold facts remain present.
5. Invalid schedules fail closed as a typed intervention reason and never
   become immediately claimable.
6. Added the scheduled rollup count and semantic scheduled action coverage.
   The action policy denies claim for `Scheduled` while still allowing
   read-only inspection through the existing action model.
7. Expanded semantic pure-domain T/I assertions for attempt/lifecycle
   transitions, close/proof gaps, hold/pause/cancel/reopen, expiry recovery,
   claim denial, stale fences, receipt subjects, independent review, and
   dependency cycles. Service-only T18/I07/I14 remain explicitly bounded out.

## Key proof cases

- `< not_before_at`: `Scheduled`, `scheduled_start(100)`, `WaitUntil`, no claim.
- `= not_before_at` with later assignment activation: still `Scheduled` with
  `scheduled_start(120)` and timer `120`.
- `= activation_at`: `Ready`, `eligible`, claimable for an agent.
- A due time contributes the next timer but does not block claim.
- Status/2 compatibility is recorded as an adapter integration request: map
  `Scheduled` to `queued` plus `scheduled_start`, and retain claim denial. No
  adapter/UI policy was invented in this attempt.

## Validation result

The focused production-property target passed 21/21 tests. The full
`boreal-domain` package passed all 137 unit/integration tests and zero
doc-tests. Strict all-target domain Clippy, owned Rust formatting, contract
validation, and `git diff --check` passed.

Workspace/application compilation is not green because protected direct
`StatusContext` literals have not yet been reconciled. The exact compiler
diagnostic and owners are in `COMMANDS.md` and `INTEGRATION-REQUESTS.md`.

## Evidence limitations and next owner

The current status/3 artifact is still labeled a proposed PF-S01-T05 contract;
this attempt did not edit or self-accept it. The status/2 projection and
canonical schedule/assignment extraction remain adapter responsibilities.
The next safe owner is the store/application/protocol integration steward,
followed by an independent review and exact combined-tree revalidation.
