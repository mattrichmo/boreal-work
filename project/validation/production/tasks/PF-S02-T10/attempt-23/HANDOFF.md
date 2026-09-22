# PF-S02-T10 attempt-23 handoff

## Result

The coordinator-authorized STORE slice is integrated and validated. Production
schema and ordered migration behavior are aligned; root recovery/resource
release retention, identity-bound operation/audit replay, external-job schema
guarding, and profile fail-closed behavior are covered by passing store tests.

This is not a claim of full PF-S02-T10 acceptance. The application/service/CLI
adapter gaps and combined-tree integration tests listed below remain bounded
next actions.

## Changed paths

- `crates/store/src/lib.rs`
- `project/spec/schema-production.sql`
- evidence files in this attempt directory only

## Integration requests / next action

1. Application/service steward: route every external side-effect adapter
   through store-owned identity-bound job admission, staged transition, and
   readback APIs; preserve pending/unknown/readback-required distinctions.
2. Application/CLI steward: route remaining direct operation/audit writers
   through the root journal while preserving immutable subjects and replay
   results.
3. Coordinator: run the combined production integration matrix for migration,
   restart, deletion/profile drift, terminal recovery, release acknowledgement,
   operation replay/rollback, external-job ambiguity, and concurrency; retain
   all failed evidence and update the ledger only through the authorized
   workflow.

