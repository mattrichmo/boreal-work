# Handoff — PF-S02-T10 attempt 12

## Status

Stop and retain this attempt as **ready for coordinator review with a failed
focused test**. Do not update `STATE.json` from this handoff.

## Files changed

- `crates/store/src/lib.rs`
- `crates/store/tests/production_identity_audit_boundary.rs`

Evidence files in this directory are the only delivery artifacts added by the
attempt. No manifest or ledger was changed.

## What is safe to retain

- Canonical production operation/audit calls no longer silently fall back to
  legacy appends when the project is unbound, provided the store was opened
  with the exact canonical production schema.
- Legacy schema-v2 fixture behavior remains compatible.
- Initialization creation remains paired and transactional.
- Existing-project initialization is explicitly a no-op readback and does not
  manufacture audit history.
- Operation replay checks now include project, command, actor, and request
  identity; canonical production replay additionally requires identity-bound
  journal readback.

## Required next integration request

Fix and independently test canonical production identity bootstrap: after
`SqliteStore::open(..., schema-production.sql)`, the production database must
contain a valid `boreal_database_identity` row before
`IdentityStore::bind_project` can succeed. Then rerun the focused target and
the full store/plan validation matrix. The initialization creation path also
needs an application-supplied workspace binding in the same authenticated
transaction before it can be used as the canonical production onboarding
route; this attempt intentionally did not change application/service APIs.

## Validation boundary

`cargo fmt --all -- --check` and `git diff --check` passed. The focused target
had 2 passing tests and 1 failing test, with the failure described above. Full
store/workspace tests, Clippy, plan/package checks, real-service validation,
and release validation remain unclaimed.

