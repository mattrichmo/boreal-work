# PF-S02-T10 attempt 6 — evidence

## Implementation

All 17 initially inventoried paired operation/audit writes now call the
canonical `append_operation_audit_in_transaction` helper:

- `crates/store/src/lib.rs`: 16 root mutation paths.
- `crates/store/src/work_model_v3.rs`: the v3 mutation wrapper.

The helper remains the existing single boundary. For a bound production
project it uses the identity-aware operation journal; for an unbound legacy
fixture schema it retains the compatibility append path. Operation payloads,
audit payloads, command names, event types, replay checks, and transaction
ownership were not otherwise changed.

The scoped `knowledge.rs` source registration path is operation-only and has
no paired audit write; it was not refactored into an invented audit event.

## Post-change structural check

The only remaining direct `append_operation(&OperationRecord { ... })` calls in
the three scoped files are the intentionally preserved operation-only paths:

- the unchanged-project initialization replay branch in `lib.rs`;
- source registration in `knowledge.rs`.

There are no remaining direct `append_audit_event(&AuditEventRecord { ... })`
call sites in the three scoped files.

## Test evidence

The focused store suites passed with 55/55 tests. This covers identity-bound
operation/audit pairing, rollback and replay, recovery records, claim and
fence behavior, store contracts, and identity/revision boundaries.

Formatting and whitespace checks also passed:

- `cargo fmt --all -- --check`
- `git diff --check`

## Boundaries

This is a bounded call-site conversion. It does not complete PF-S02-T10. It
does not wire all application adapters, lifecycle recovery/job creation, or
all remaining operation writers outside the requested scope. No tests,
`STATE.json`, or `PLAN_PACKAGE_MANIFEST.json` were edited by this attempt.
