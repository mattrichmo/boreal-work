# PF-S03-T10 — attempt 8 evidence

## Disposition

`ready_for_review` with protected caller and combined-tree blockers. This is a
bounded application adapter contribution. It does not accept PF-S03-T10,
PF-S03, the status/3 contract, or release behavior.

## Changed paths

Production:

- `crates/application/src/status.rs`

Evidence:

- `project/validation/production/tasks/PF-S03-T10/attempt-8/START.md`
- `project/validation/production/tasks/PF-S03-T10/attempt-8/COMMANDS.md`
- `project/validation/production/tasks/PF-S03-T10/attempt-8/EVIDENCE.md`
- `project/validation/production/tasks/PF-S03-T10/attempt-8/INTEGRATION-REQUESTS.md`
- `project/validation/production/tasks/PF-S03-T10/attempt-8/HANDOFF.md`

No plan/state/acceptance record, domain source, store source, service caller,
CLI source, schema, commit, or push was changed by this attempt.

## Implemented behavior

1. `StatusWorkInput` now carries canonical `WorkSchedule` and resolved
   cycle/assignment `activation_at` values. `status_input_from_store_row`
   copies those values directly from `StatusWorkRecord`; no retry timestamp or
   fixture value is converted into a schedule.
2. `project_status` passes both inputs to the pure domain `StatusContext`.
   Revision, pagination, dependency, gate, diagnostic, and timer behavior
   remains in the existing projection path.
3. `StatusWork::decision.display_status` remains the status/3 domain value.
   The existing status/2 `display_status()` accessor maps only
   `DerivedStatus::Scheduled` to `DerivedStatus::Queued`, preserving the
   typed `scheduled_start(...)` primary reason and the domain's denied claim
   action.
4. Status/2 rollup counts map scheduled rows into queued and do not expose a
   false scheduled bucket. The next status-change timer remains the canonical
   activation instant.
5. Tests cover work schedule plus later assignment activation, exact boundary
   behavior, status/3 retention, status/2 mapping, non-claimability, rollup
   mapping, timer selection, and store-row propagation.

## Validation limits

- The focused adapter and status projection tests pass.
- The full application suite has one pre-existing combined-tree failure in the
  three-harness guided flow because the resource-reservation uniqueness path is
  not yet reconciled by the PF-S02 recovery/integration stream.
- CLI compilation remains blocked by the protected `status_name` match. The
  status/2 serializer must consume the mapped accessor; a future status/3
  serializer must use the retained domain decision explicitly.
- No genuine service-backed status/3 route or release qualification is claimed.

