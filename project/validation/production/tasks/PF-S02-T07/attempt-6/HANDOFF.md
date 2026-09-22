# PF-S02-T07 attempt-6 handoff

## Result

The bounded STORE integration for PF-S02-T07 is complete. Root operation
replay no longer accepts digest-only reuse across immutable identity fields,
and canonical bound projects validate the existing operation and audit through
the durable identity journal before returning a replay. New operation/audit
bundles still commit atomically with the semantic mutation in the caller's
transaction.

This handoff does not mark the broader task accepted; application, CLI, and
knowledge direct-writer migration remains explicitly open.

## Changed paths

- `crates/store/src/lib.rs`
- `project/spec/schema-production.sql` (migration guard shared with T06)
- evidence files in this attempt directory only

## Integration requests

1. Migrate remaining application/knowledge/CLI direct operation writers to the
   canonical identity-bound journal, preserving each existing command's
   subject and replay DTO.
2. Add combined-tree tests for changed actor/session/subject/fence/revision
   reuse, rollback after audit failure, and ambiguous external-effect
   readback.
3. Keep operation/audit identity failures fail-closed and retain rejected or
   unknown outcomes; do not replace them with CRUD-only updates.

