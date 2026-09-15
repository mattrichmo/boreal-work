# Long-run audit traceability

The [portable audit baseline](../AUDIT_BASELINE.md) is source-only evidence,
not proof of every inferred root cause. Each concern below has an explicit
reproduction/verification owner in the build plan. Do not claim a speedup by
omitting validation or by shortening evidence retention.

| Audit concern | Build tasks | Required proof |
| --- | --- | --- |
| P0-01 reads contend with writers/TUI | P0-02, P1-04, P1-05, P2-03, P4-03, P5-01 | Measure lock wait and DB hold separately; TUI plus workers makes progress and status stays available. |
| P0-02 work/reservation/assignment/session divergence | P0-03, P2-01, P2-05, P5-02 | One current fenced attempt; crash at each boundary; manual claim adoption; closed work has no live reservation. |
| P0-03 prose-sensitive evidence and closeout churn | P2-02, P5-02 | Equivalent prose yields same result; command/source/attestation mismatch gives exact reason; retry is idempotent. |
| P1-01 oversized/inconsistent envelopes | P0-03, P2-04, P2-06, P4-01, P5-01 | One versioned shape; referenced/inline arrays and objects validated; 10,000 historical attempts do not inflate active status. |
| P1-02 blocker/repair redispatch loops | P1-02, P2-01, P2-05, P5-02 | Operator-only, paused, blocked, and retry-not-before are enforced across claim/release/tick. |
| P1-03 prune/repair fails to converge | P3-06, P5-02 | Current integrity blockers separated from historical warnings; supported repair is idempotent and keeps failed history. |
| P1-04 CLI/runtime/library drift | P0-01, P4-05, P5-04 | Immutable build identity per attempt; upgrade pause/rebase/resume and rollback on clean install. |
| P1-05 polling substitutes for liveness | P2-05, P2-06, P4-03, P5-01 | Runtime heartbeat and event/timer wakeup; healthy unchanged state does not trigger model-mediated polling bursts. |
| P1-06 shared dirty-tree evidence ambiguity | P2-02, P4-04, P5-04 | Receipts bind source/config/environment and coverage; combined-tree integration check is explicit. |
| P2 durable coordinator resume | P2-05, P2-06, P5-02 | Compact resume capsule with current attempt/session IDs and next deadline; refreshes one authoritative snapshot on resume. |
| Feature tested but not mounted/actionable | P4-02, P4-03, P4-07 | Production TUI route/action smoke proves each advertised feature is reachable. |
| Lock owner age mistaken for hold duration | P0-02, P5-01 | Instrument operation-level queue wait and transaction hold; report process lifetime separately. |
| Core Boreal agent guidance lost in a CRUD rewrite | P0-03, P0-04, P2-10, P2-11, P2-12, P5-04 | No-goal agent from two harnesses receives trusted contextual next steps and follows conditional claim/evidence/finish without a bespoke parent prompt. |
| Conditional status and claim workflow drift | P0-03, P1-02, P2-01, P2-05, P2-10, P5-02 | Effective status/reason is revisioned and derives from canonical blockers, eligibility, gates, and attempt; release never promotes blocked/operator-only work. |
| Working canonical CLI workflows silently dropped | P0-04, P2-11, P4-10, P4-11, P4-07 | Route/context/plan/claim/evidence/finish/review/handoff/health/source-memory workflows each have a v2 disposition and versioned packaged path; essential behaviors pass unfamiliar-agent tests. |

Each row reaches final disposition only after the owning phase's review,
reconciliation, and revalidation gate. If a reproduction does not confirm the
audit hypothesis, record the observed behavior and adjust the implementation
task rather than patching an inferred cause.
