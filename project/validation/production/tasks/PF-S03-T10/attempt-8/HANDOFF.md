# PF-S03-T10 — attempt 8 handoff

## Identity and disposition

- Task: `PF-S03-T10` — complete deterministic oracle coverage for status and transitions.
- Attempt: `8` — PF-S03 application status adapter remediation.
- Input `HEAD`: `70514f0ed2521df710c3c913f50ff9d759f5e743` (`70514f0e`).
- Final owned source: `crates/application/src/status.rs`;
  SHA-256 `37bbcc93dfa8ec6122f3730a09312455763887a744bf57a59049d47735903d80`.
- State: **ready for independent review with bounded blockers**.
- Decision: **not accepted**. No plan/state/acceptance updates, commit, or push.

## Result

The application projection now receives the store's canonical work schedule
and cycle/assignment activation instant, passes both into `StatusContext`, and
keeps the domain decision intact. The existing status/2 accessor maps only
`scheduled` to `queued`; it preserves the typed `scheduled_start` reason,
canonical timer, denied claimability, and `wait_until` action. A separate
status/3 accessor retains `scheduled` for a versioned caller.

Focused application status tests passed 7/7, the status projection integration
target passed 3/3, application compilation passed, formatting passed, contract
validation passed, and `git diff --check` passed.

## Blockers

1. The full application suite has one combined-tree failure in the existing
   three-harness guided flow: `UNIQUE constraint failed:
   boreal_resource_reservation.project_id, boreal_resource_reservation.resource_key`.
   This belongs to the PF-S02 recovery/resource integration stream.
2. CLI compilation stops at the protected `status_name` match because the new
   domain `DerivedStatus::Scheduled` arm and version-specific serializer have
   not yet been integrated. IR-1 records the exact compatibility behavior.
3. Independent review and exact combined-tree revalidation remain required.

## Next safe action

Have the CLI/protocol steward apply IR-1, have the PF-S02 steward resolve IR-2,
then run the commands in `COMMANDS.md` again on the resulting exact tree. Keep
this attempt and its failures as evidence; do not mark the task or sprint
accepted from this handoff.

