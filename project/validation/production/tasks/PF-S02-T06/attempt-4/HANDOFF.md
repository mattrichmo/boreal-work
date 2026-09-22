# PF-S02-T06 attempt-4 handoff

## Result

The coordinator-authorized STORE integration is complete within the protected
write set. Root lifecycle terminal paths preserve unresolved recovery and
canonical release state; the ordered production migration, fresh schema, and
legacy-v3 repair all install/verify the external-job append-only identity
guard. Full store and focused recovery/job/integration tests pass.

This is a bounded integration handoff, not a claim that PF-S02-T06 is fully
accepted. The task's application/service adapter work remains outside this
attempt.

## Changed paths

- `crates/store/src/lib.rs`
- `project/spec/schema-production.sql`
- evidence files in this attempt directory only

## Exact validation

See `COMMANDS.md`. The final source fingerprints are in `EVIDENCE.md`.

## Integration requests

1. At the next integration boundary, wire each in-scope external-effect
   adapter to `jobs::register_external_job_with_identity`, staged transitions,
   and `read_external_job_in_context`; no adapter may invoke a side effect
   before durable admission.
2. Add service/application restart, unknown/readback, duplicate-admission, and
   resource-release acknowledgement tests against the canonical production
   database.
3. Preserve the existing failed T06 evidence and update the coordinator
   ledger only through the authorized coordinator workflow; this steward did
   not mutate it.

