# PF-S02-T10 attempt 3 — handoff

## Disposition

**Ready for bounded review; not accepted as full PF-S02-T10.** This attempt implements only the requested operation/audit identity integration helper and its focused tests. It does not claim that canonical root mutation wiring is complete.

## Changed files

- `crates/store/src/operations.rs`
  - Validates operation/audit session and fence identity parity.
  - Adds installed identity/project preflight before the operation row is inserted.
  - Retains the caller-owned transaction boundary and existing non-identity append API.
- `crates/store/src/identity.rs`
  - Adds the crate-scoped read-only `validate_context` preflight used by the helper.
- `crates/store/tests/production_operation_audit.rs`
  - Adds 4 focused rejection/preflight tests; the target now has 10 passing tests.
- `project/validation/production/tasks/PF-S02-T10/attempt-3/`
  - This START, COMMANDS, EVIDENCE, and HANDOFF record.

No other source, plan state, manifest, or prior evidence was changed by this attempt.

## Required coordinator wiring still outstanding

1. Call `OperationJournal::append_in_transaction_with_identity` from each canonical root mutation that commits an operation and audit event; do not mechanically alter every legacy call site without reviewing its semantic transaction boundary.
2. Obtain the `IdentityContext` from the canonical production-open/project-binding path and ensure it is installed and validated through the ordered migration boundary before any identity-bound mutation is permitted.
3. Keep root mutation error handling on the rollback path. A caller that receives an identity/audit error must not commit the surrounding transaction.
4. Reconcile legacy operation rows and direct `append_operation`/`append_audit_event` paths, including terminal closeout, without treating this helper as evidence that those paths are already identity-bound.
5. Add combined-tree integration coverage for root call-site wiring, restart/readback, concurrent mutation, and production opener identity installation.

The helper does not solve the separate pinned-requirement, recovery-obligation, external-job, lifecycle, or review findings from PF-S02-T10. Preserve those findings and do not promote this bounded review to task or sprint acceptance without independent review and exact-tree revalidation.
