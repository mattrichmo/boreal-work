# PF-S03-T10 — attempt 7 integration requests

These requests preserve the blockers; they do not authorize task acceptance.

## IR-1 — Complete the application status adapter

**Owner:** PF-S03 adapter integration steward.

In `crates/application/src/status.rs`:

- add `schedule: Option<WorkSchedule>` and `activation_at:
  Option<TimestampMs>` to `StatusWorkInput`, defaulting to `None` for callers
  that do not have planning facts;
- pass both fields to every `StatusContext` literal;
- copy `row.schedule` and `row.activation_at` in
  `status_input_from_store_row`;
- add focused future-start and exact-equality tests proving `scheduled` before
  activation, claim denial before activation, and readiness at equality.

The store snapshot already carries these facts under its read transaction;
the application must not query SQLite directly or reconstruct schedule policy.

## IR-2 — Preserve the status/2 compatibility boundary

The application snapshot advertises `boreal.work-status/2`. Its public
presentation helpers and aggregate fields must map a domain
`DerivedStatus::Scheduled` to status/2 `queued` with the stable
`scheduled_start` reason. The underlying `StatusDecision` must remain
`Scheduled`, retain `next_status_change_at`, and retain
`claimable_for_actor == false`.

Add a focused regression against the actual `StatusSnapshot`/`StatusWork`
projection. Do not alter the domain evaluator or add a second action policy.

## IR-3 — Revalidate protected store planning facts

The current protected store query in `crates/store/src/status_evaluation.rs`
must be independently reviewed for:

- cycle lifecycle and assignment-state semantics;
- `immediate` assignments in planned and active cycles;
- duplicate live assignments and malformed/negative timestamps;
- exact project/revision confinement and no cross-project leakage;
- whether unavailable v3 planning facts need a typed diagnostic in a future
  status/3 adapter rather than silent absence for legacy status/2 reads.

Do not broaden this attempt into `crates/store/src/lib.rs`; any required
protected-root changes must be serialized by the store integration steward.

## IR-4 — Preserve unrelated PF-S02-T11 blocker

The current combined application tree also fails compilation at
`crates/application/src/evidence.rs:687` with an `ExternalJobRecord` borrow/move
error. It is outside this attempt's write set and must be repaired and
reviewed by the PF-S02-T11 owner before combined application acceptance.
