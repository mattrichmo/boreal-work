# PF-S03-T10 — attempt 8 integration requests

## IR-1 — protected CLI/status protocol caller

Owner: CLI/protocol interface steward.

Input source: this attempt's `crates/application/src/status.rs`, whose final
owned hash is recorded in `COMMANDS.md`.

The protected `status_name` match in `crates/cli/src/main.rs` must be made
exhaustive for `DerivedStatus::Scheduled`. Keep the existing status/2 route
compatible by serializing `StatusWork::display_status()` (which returns
`queued` for scheduled work) and retaining `scheduled_start(<timestamp>)` in
`primary_reason`/`reason_codes`. Add or update the versioned status/3 route to
serialize `StatusWork::status3_display_status()` as `scheduled` instead of
reconstructing status from reason strings.

Required checks:

- before activation: status/2 is `queued`, status/3 is `scheduled`, reason is
  `scheduled_start`, `claimable_for_actor` is false, and `wait_until` remains
  the next action;
- at activation equality: the schedule constraint clears and the domain
  decision may become `ready` only when all other predicates pass;
- old status/2 consumers cannot treat a scheduled row as ready;
- status/3 consumers retain the canonical decision without parsing prose.

Do not add client-side status policy or invent schedule values.

## IR-2 — combined PF-S02 application revalidation

Owner: PF-S02 integration/recovery steward.

The full application suite still fails in
`p2_guided_flow_claims_three_harnesses_and_fences_recovery` at the combined
resource reservation uniqueness constraint. Reconcile the canonical resource
reservation/release path independently, then rerun the full application suite
and verify that the status adapter tests continue to pass. This is not a
reason to weaken status or reservation uniqueness.

## IR-3 — acceptance boundary

Owner: coordinator plus independent reviewer. After IR-1 and IR-2, rerun the
status projection, full application, CLI compile/test, store integration, full
workspace format, contract validator, and diff checks against one exact
combined source identity. Do not update `STATE.json` or accept PF-S03-T10 from
this bounded handoff alone.

