# PF-S02-T10/T06 attempt 20 — integration requests

These are bounded follow-ups, not acceptance claims.

1. **Batch status planning facts in the protected store root.** Replace the
   per-row `status_planning_facts(project_id, work_id)` call in
   `read_project_status_in_transaction` with one project-scoped relation read
   and a work-id keyed result/error map. Keep project predicates on every
   relation and retain row-level corruption diagnostics.

2. **Repair the current guided claim collision.** Reproduce the first failing
   claim in `p2_guided_flow` and inspect the exact generated
   `(project_id, work_id, attempt_id, resource_key)` values before changing
   code. Distinct work keys must remain claimable; the partial unique index
   must remain unchanged.

3. **Make released recovery resolution resource-bound.** In one serialized
   transaction, validate the obligation's project/work/attempt/fence, locate
   the exact canonical reservation, and acknowledge its pending release (or
   reject the resolution if no uniquely bound reservation can be established).
   Preserve replay/readback/audit behavior. Do not allow a plain obligation
   update to make a live or release-pending resource reusable.

4. **Add the required regression matrix.** Cover released resolution,
   idempotent replay, wrong project, stale attempt/fence, two distinct work
   keys, and a genuine same-resource conflict. Continue to use real SQLite
   transactions and the production unique index.

5. **Revalidate after integration.** Run the exact focused batching test,
   complete `storage_remediation`, the guided-flow test and full application
   suite, production recovery/resource/integration targets, full store,
   strict all-target store Clippy, formatting, contract validation, and diff
   checks. Preserve any remaining failure as a new bounded handoff.
