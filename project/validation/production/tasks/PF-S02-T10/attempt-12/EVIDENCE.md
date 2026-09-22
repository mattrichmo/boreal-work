# PF-S02-T10 attempt 12 — bounded implementation evidence

## Exact source changes

### `crates/store/src/lib.rs`

- Added a `canonical_production` handle flag. It is set only when
  `SqliteStore::open` receives the exact `schema-production.sql` request.
  The existing schema-v2 fixture continues through the migration runner but
  remains explicitly compatibility-mode for isolated legacy tests.
- Added `operation_identity_context`, which:
  - checks the additive identity tables;
  - fails closed if canonical production is missing those tables;
  - rejects an unbound canonical production project before an operation or
    audit row can be written;
  - retains the existing bound-project identity context; and
  - retains the legacy append path only outside canonical production.
- Routed `append_operation`, `append_audit_event`, and the paired operation /
  audit helper through that preflight.
- Strengthened initialization replay checks for project, command, actor, and
  request identity. Canonical production replays now use the identity-bound
  operation journal and require a readable audited outcome.
- Changed the existing-project/no-matching-operation branch to a documented
  safe readback. It returns the current project revision without writing an
  invented operation or audit event.
- Kept newly created project initialization on the existing paired
  operation/audit transaction. In canonical production, an unbound creation
  rolls back instead of bypassing the identity boundary.

### `crates/store/tests/production_identity_audit_boundary.rs`

Added three focused tests:

- unbound canonical production operation rejection and no partial
  initialization;
- bound canonical production exact replay/readback; and
- legacy initialization creation audit, exact replay, and existing-project
  safe readback without fabricated operation/audit rows.

## Observed result

The first and third behaviors are demonstrated by passing tests. The bound
production replay test exposed a prerequisite defect in the canonical opener:
the production identity table exists, but `boreal_database_identity` has no
installed row when the test attempts to bind the project. This attempt does
not repair that bootstrap path because doing so would expand the requested
scope beyond `lib.rs`'s boundary behavior and the focused test.

## Acceptance disposition

This is a **bounded contribution only**. It does not accept PF-S02-T10,
PF-S13-T02, PF-S02, or any sprint. The failed bound-replay test prevents even
the bounded slice from being reported as fully green.

