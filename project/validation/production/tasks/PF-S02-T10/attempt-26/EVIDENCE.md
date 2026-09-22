# PF-S02-T10 attempt-26 evidence

## Disposition

**Bounded ready-for-review; not accepted.** The store boundary and focused
regression pass. This attempt does not claim PF-S02-T10, PF-S02-T06, PF-S12 or
production release acceptance.

## Source-bound implementation

- `crates/store/src/lib.rs:1776-1785` rejects direct `backup_to` calls on a
  canonical production store with a typed conflict requiring identity-bound
  external-job admission and readback.
- `crates/store/src/lib.rs:1837-1849` documents and enforces the matching
  fail-closed rule for direct in-place `restore_from`, requiring source
  consistency and restore-epoch reconciliation before production exposure.
- `crates/store/tests/runtime_backup.rs:100-117` proves both canonical guards.
- The legacy online backup/restore round trip remains covered at
  `crates/store/tests/runtime_backup.rs:53-98`.

The existing generic durable seam remains the authority: identity-bound job
registration/transition/readback is implemented in
`crates/store/src/jobs.rs:148-168` and `:239-383`, with restart/readback
stages and restore-lineage validation. This attempt deliberately did not
duplicate that state machine or invent a backup-specific fake job.

## Contract disposition

The plan explicitly supports backup as an external job in
`project/build-plan/production-completion/sprints/PF-S02/tasks/PF-S02-T06.md`
and the production service/identity contracts. It also explicitly assigns the
full recovery unit and acceptance to PF-S12: manifest-backed backup is
PF-S12-T06, safe restore/rebind and service reconciliation are PF-S12-T07,
and real migration/backup/restore acceptance is PF-S12-T10. Those task
directories have no accepted evidence in the current workspace.

Accordingly, direct canonical helpers now fail closed. The remaining product
work is not silently treated as complete: the PF-S12 owner must add the
identity-bound operation adapter, complete source/artifact manifest checks,
preserve unknown/readback state across restart, advance/reconcile the restore
epoch, and prove stale operation/fence rejection after restore.

## Observed validation

- Focused store backup target: PASS, 4/4.
- Full locked `boreal-store`: PASS across every reported target; 1 intentional
  release benchmark ignored and 0 failures.
- Strict all-target/all-feature store Clippy: PASS.
- Workspace format check, owned-file rustfmt check, and owned diff check: PASS.

No service process, backup manifest, blob/Git completeness check, restore
rebind, restart fault injection, native package, or published artifact was
run. Those are required later evidence, not inferred from these store tests.
