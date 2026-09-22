# PF-S02-T10 attempt 6 — bounded canonical operation/audit slice

This attempt is a coordinator-applied bounded corrective slice. It does not
claim completion of PF-S02-T10.

## Scope

Only these production paths were in scope:

- `crates/store/src/lib.rs`
- `crates/store/src/work_model_v3.rs`
- `crates/store/src/knowledge.rs`

Evidence is written only under this attempt directory. `STATE.json` and
`PLAN_PACKAGE_MANIFEST.json` are intentionally unchanged.

## Objective

Convert every paired direct `append_operation(&OperationRecord { ... })` /
`append_audit_event(&AuditEventRecord { ... })` write found in the scoped store
root mutation paths to `append_operation_audit_in_transaction`, preserving the
helper's compatibility fallback for unbound fixture schemas and the existing
operation replay behavior.

## Initial inventory

The initial inventory found 17 paired writes:

- 16 in `crates/store/src/lib.rs`: project initialization, session register,
  session end, work edit, dependency removal, hold add, hold resolution,
  dependency add, receipt insert, gate update, review insert, summary insert,
  close-intent creation, rejected close finalization, finalized close, and
  close rejection.
- 1 in `crates/store/src/work_model_v3.rs`: the shared v3 mutation wrapper.

`crates/store/src/knowledge.rs` contains an operation-only source registration
write and no paired audit write, so it was inspected and intentionally left
unchanged.

The existing operation-only replay branch for an already-present project
initialization operation was also left unchanged because it is not a paired
mutation write.
