# PF-S02-T10/T06 recovery/resource remediation — attempt 21R handoff

## Identity and disposition

- Task: `PF-S02-T10` with PF-S02-T06 recovery/resource seam
- Attempt: `attempt-21R`
- Input source/baseline: `70514f0ed2521df710c3c913f50ff9d759f5e743` (`70514f0e`)
- Branch: `codex/apply-responsive-terminal-overlay`
- Disposition: **bounded ready-for-review; not accepted**
- Plan/state/acceptance records: unchanged
- Commit/push: not performed

## Changed paths in this attempt

- `crates/store/src/recovery.rs`
- `crates/application/src/runtime.rs`
- `crates/application/tests/p2_guided_flow.rs`
- `crates/store/tests/production_recovery_records.rs`
- `project/validation/production/tasks/PF-S02-T10/attempt-21R/`

## Summary

Attempt 20 identified that expiry left the canonical reservation in
`release_pending`, while plain recovery resolution only changed the obligation
row. Attempt 21R closes that gap without weakening the live-resource
constraint: only an authenticated, project/work/attempt/fence-bound resolution
can acknowledge the exact terminal release event and make the reservation
reusable.

Guided-flow passes: 2/2. Focused recovery passes: 12/12. Production
integration passes: 4/4. Full store acceptance remains open because one
out-of-scope contract fixture still invokes the rejected unsafe API; strict
application Clippy also retains the unused public adapter warning. See
`INTEGRATION-REQUESTS.md` for the next bounded actions.

No plan ledger or acceptance state was changed.
