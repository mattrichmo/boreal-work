# PF-S02-T10 attempt-26 — backup/restore external-job boundary

Date: 2026-09-22

## Scope

This attempt is limited to the requested store boundary. The production write
set is `crates/store/src/lib.rs`; the focused regression is in
`crates/store/tests/runtime_backup.rs`; evidence is confined to this
directory. Application, service, CLI, schema, plan/state, memory, runtime and
other worker files are read-only. No commit or push is performed.

## Plan disposition

Backup/restore is a supported external effect in the production contracts and
PF-S02-T06's durable-job requirement. Full project backup manifests, safe
restore/rebind, service reconciliation and real acceptance are explicitly
owned by PF-S12-T06/T07/T10. The existing generic identity-bound job APIs are
therefore the admission/readback seam; the low-level `backup_to` and
`restore_from` helpers must not bypass it for canonical production stores.

## Invariant under test

Legacy/test-schema SQLite online backup/restore remains available. Canonical
production direct backup and in-place restore fail closed before any external
filesystem effect. Production callers must use the identity-bound external
job path, source consistency checks, durable unknown/readback handling and
restore-epoch reconciliation owned by the later PF-S12 boundary.
