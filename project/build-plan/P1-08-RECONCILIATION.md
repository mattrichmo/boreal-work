# P1-08 — Domain/store reconciliation

The independent P1-07 findings were reviewed by the coordinator. P1-R01
through P1-R04 and the bounded portion of P1-R06 are addressed in the store
and application integration. P1-R05 remains an explicit migration limitation:
the v2 schema is fresh/idempotent, but no legacy v1 database is silently
upgraded until the migration owner supplies a versioned fixture and rollback
proof in P4-05.

Checks to rerun on the combined tree: contract validation, domain/store/
application tests, duplicate-operation replay, claim race, cross-project and
cycle rejection, and bounded revisioned reads. P1-09 must not be marked pass
until those checks are green and the migration deferral is accepted by the
release gate.
