# PF-S02-T10 attempt 13 — bounded fixture evidence

## Exact change

In `crates/store/tests/production_identity_audit_boundary.rs`, the bound
canonical production replay fixture now:

1. creates the `agent-1` actor referenced by the operation row; and
2. calls `IdentityStore::install` with the controlled
   `DatabaseIdentity::new("database-boundary", 1)` before
   `IdentityStore::bind_project`.

This keeps the production behavior fail-closed for ephemeral in-memory stores
and makes the test explicitly provision the identity it needs. No production
source behavior was changed.

## Observed result

The focused identity/audit target passed all three tests. The complete
`boreal-store` package also passed, including the production migration and
identity coverage. In particular, the existing production migration tests
cover fresh canonical bootstrap, upgrade identity/ledger readback, legacy
metadata repair, and failure rollback; `production_identity_revisions.rs`
covers installation, binding, revision separation, restore invalidation, and
cross-project identity checks.

## Acceptance disposition

This is a **bounded fixture correction only**. It does not accept PF-S02-T10 or
any dependent task/sprint. Full operation/audit call-site integration,
application/service wiring, persistent recovery/expiry behavior, genuine
service-backed lifecycle validation, and installer/release/platform checks
remain outside this evidence.

