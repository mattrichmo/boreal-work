# P2-07 — Runtime/service/CLI independent review

Reviewer: Maxwell (Luna), 2026-09-15. Initial disposition: **NO-PASS**.

The follow-up reconciliation records which findings are now resolved in the
combined snapshot and which remain release-blocking for P2-09.

The review confirms the scoped policy, protocol, queue, election, CLI smoke,
and TUI/source/memory groundwork tests are useful, but the S02 acceptance
profile requires concrete durable lifecycle behavior that is not present.

| ID | Severity | Finding | Disposition |
| --- | --- | --- | --- |
| P2-R01 | blocker | No concrete SQLite adapter persists accept/start/heartbeat/checkpoint/release/fail/expire/cancel/finish. | resolved for the current schema by `SqliteAttemptAdapter` plus durable lifecycle integration tests; checkpoint persistence remains a separately scoped follow-up. |
| P2-R02 | blocker | Receipts, gates, summaries, and proof-gated closeout are not wired to application use cases. | resolved for the current schema by typed receipt/review/close-intent APIs and proof-gated close integration; summary body persistence remains a separately scoped follow-up. |
| P2-R03 | high | Service has queue/election primitives only; no socket transport, read pool, restart recovery, subscriptions, or wait/hold metrics. | mostly resolved: framed transport, bounded read pool, restart recovery, subscriptions, metrics, and typed application routing now pass 21 service tests; persistence-backed handler integration remains a P2-09 gate. |
| P2-R04 | high | CLI opens SQLite directly and does not use the service client; required agent/guidance/lifecycle grammar is absent. | open; owner: P2-04/P2-11 |
| P2-R05 | high | CLI maps all failures to invalid-argument/rejected and derives repeatable operation IDs from argv. | open; owner: P2-04 |
| P2-R06 | medium | Protocol is envelope/fixture groundwork, not complete command DTOs/status/guidance/receipt/notification wire types. | open; owner: P2-04/P2-06/P2-10 |
| P2-R07 | medium | Status output is raw work rows, not derived status/reasons/gates/current attempts/bounded historical projection. | open; owner: P2-05/P2-06 |

`cargo test --workspace --locked --offline` is green on the current scoped
tests, but that does not substitute for P2-09.
