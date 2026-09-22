# PF-S02-T10 attempt-26 handoff

## Identity and disposition

- Task: `PF-S02-T10`
- Attempt: `attempt-26`
- Worker role: backup/restore external-job boundary agent
- Disposition: **bounded ready-for-review; not accepted**
- Input source: current combined dirty worktree; PF-S02-T10 attempt-23 root
  fingerprint recorded as the prior integrated source identity
- Final fingerprints: recorded in `COMMANDS.md`
- Plan/state/acceptance records: unchanged
- Commit/push: not performed

## Changed paths

- `crates/store/src/lib.rs`
- `crates/store/tests/runtime_backup.rs`
- `project/validation/production/tasks/PF-S02-T10/attempt-26/*`

## Result

Canonical production `backup_to` and `restore_from` can no longer bypass the
durable identity-bound external-job boundary. Legacy/test-schema round-trip
behavior is preserved. The focused and full store validations, strict store
Clippy, format and diff checks all pass.

## Exact remaining work

PF-S12-T06/T07/T10 still own the production implementation and acceptance of
manifest-backed backup, safe restore/rebind, durable restart/unknown
readback, source/artifact consistency, restore-epoch advancement, service
reconciliation, and stale-operation/fence rejection. The current attempt
does not claim those capabilities and did not edit their application,
service, CLI or schema paths.

## Safe next action

The coordinator/reviewer should inspect the two guard lines and the focused
regression on the exact combined tree, then dispatch the PF-S12 backup/restore
implementation lane. Keep this attempt and all earlier failed handoffs
unchanged; do not advance plan acceptance from this handoff alone.
