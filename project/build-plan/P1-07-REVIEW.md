# P1-07 — Independent domain/store review

Reviewer: James (Luna), 2026-09-15. Disposition: **NO-PASS** pending
reconciliation. The focused tests are green, but the review found gaps in
the combined mutation boundary and the read model.

| ID | Severity | Finding | Disposition |
| --- | --- | --- | --- |
| P1-R01 | blocker | `init_project` performs three independent writes, ignores its operation ID, and can leave partial state. | fixed in P1-08 |
| P1-R02 | major | Work creation and dependency insertion do not advance a revision or append an operation/audit event. | fixed in P1-08 |
| P1-R03 | major | Duplicate claim operation lookup is outside the write transaction, so a raced retry can return conflict instead of replay. | fixed in P1-08 |
| P1-R04 | major | Application writes do not call hierarchy/dependency validators; invalid parent kinds and cycles can pass the adapter. | fixed in P1-08 |
| P1-R05 | major | Schema opening has no upgrade path for a supported older version. | deferred to P4-05 with migration fixture owner |
| P1-R06 | major | Revisioned reads expose raw work rows only; status/gates/attempts/rollups and sprint activation are not yet adapter-ready. | fixed in P1-08 as bounded projection; lifecycle detail remains P2 |

Evidence reviewed: `cargo test --workspace --locked --offline` (34 tests
before the reconciliation additions), contract validator PASS, and the
combined source at the review snapshot. The worker/test result is not a gate
pass; every finding is tracked above.
