# PF-S02-T01 — Attempt 3 compatibility-test remediation

- Task: remediate the additive schema-v3 compatibility tests after the
  canonical production open path began upgrading v2 to production v3.
- Workspace: `/Users/cybertron/Code/boreal-work`.
- Started: 2026-09-22 (America/Regina).
- Input source: `HEAD 784a41b3802c29a76721c55eef2e9493283396c2`, dirty worktree;
  coordinator-owned production migration changes were already present.
- Exclusive write set: `crates/store/tests/schema_v3.rs` and this new attempt-3
  evidence directory only.
- Protected paths: Rust production source, plan/state files, prior evidence,
  schema artifacts, unrelated tests, live databases, and service locks.

## Interpreted invariant

The additive schema-v3 tests must create a complete raw schema-v2 fixture at an
explicit migration/setup boundary. They must not use the canonical
`SqliteStore::open(..., schema-v2.sql)` call to create that fixture, because
that public production path intentionally upgrades canonical v2 to production
v3. The tests must still exercise explicit v3 apply/reopen, failed migration
rollback, v3 mutations and constraints, backup/reopen, and schema-v2
compatibility without weakening assertions.

## Planned verification

- Capture the pre-fix focused failure.
- Update only the schema-v3 test fixture setup.
- Run the focused `schema_v3` target and a formatter check for the changed
  test.
- Run the store package check for visibility, but report any unrelated package
  failures rather than claiming a full store pass.
- Record exact commands, exits, test counts, source identity, and changed
  paths in this attempt's evidence.
