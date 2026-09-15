# P1-09 — Domain/store revalidation

Date: 2026-09-15. Combined validation after the P1-07 findings:

- `python3 project/spec/validate_contracts.py` — PASS.
- `cargo test --workspace --locked --offline` — PASS (15 domain tests, 10
  store contract tests, 1 application routing test, 9 protocol fixture tests;
  all doc-tests pass).
- Fresh SQLite schema — PASS: foreign keys and WAL enabled, schema version 2,
  project-scoped parent/dependency constraints, parent-kind trigger, unique
  current attempt/session/gate constraints, append-only receipt/audit triggers,
  self-review rejection.
- Atomic claim — PASS: one current reservation, monotonic revision, operation
  result and audit event in the same transaction; duplicate operation replay
  returns the original attempt/fence; a second claimant receives conflict.
- Revisioned reads — PASS for bounded raw work pages with exact totals and one
  read revision; full status/gate/attempt dashboard remains in the runtime/
  service work that follows.

P1-05/P1-06 are accepted for the bounded first slice. P1-R05 is an approved
deferral: older-database migration and rollback evidence belong to P4-05 and
are not silently implied by fresh-schema idempotence. P1-09 therefore passes
with that explicit deferral and unlocks S02 groundwork; the full P1 sprint
status/dashboard surface remains a P2 integration obligation.
