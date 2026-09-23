# PF-S02-T06 — attempt 5 handoff

## Result

The prior production backup/restore rejection is remediated for the bounded
SQLite-only case. The implementation is intentionally not marked as task or
sprint acceptance, and no plan/state/ledger edit was made.

The scoped implementation is present in concurrent integration commit
`d760806fed4fecdfdfc016649bdec0a4b0a63630`; this attempt did not create or
push a commit.

## Safe supported surface

```text
bwrk backup PACKAGE_DIR --db PATH --json
bwrk restore PACKAGE_DIR --db PATH --json
```

The package contains a validated SQLite snapshot and manifest. Restore creates
a fresh database lineage, advances `restore_epoch`, invalidates old operation
identity and execution fences, and retains an existing destination beside the
new database.

## Residual blockers

1. Blob contents are not copied into the package. A manifest records each
   referenced blob, but restore rejects any non-empty blob reference set rather
   than restoring a database whose artifact paths may be absent or foreign.
2. Published Git memory is not bundled or Git-verified. Published memory
   references and revisions are recorded, and restore rejects them until an
   artifact bundle/repository reconciliation contract exists.
3. Backup/restore is a synchronous maintenance operation. It uses the CLI
   database election, but it does not yet register a root application
   operation/external-job row or provide crash readback across the process
   boundary. That requires the application/service job-admission integration
   explicitly outside this request’s store/CLI-only write boundary.
4. The task’s earlier recovery/resource/external-adapter findings remain open;
   this attempt addresses only the backup/restore portion.

## Next safe action

Obtain an independent review of this exact combined source, then either:

- implement a versioned artifact bundle for blobs and Git-memory verification;
  or
- record the SQLite-only package route as an approved bounded capability and
  assign the application/service durable-job integration to the owning task.

Do not update `STATE.json` or mark PF-S02-T06 accepted from this handoff alone.
