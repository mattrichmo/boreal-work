# S01 — Canonical work domain and transactional store

Parent: [M01](../../README.md). State: **P1-09 passed with approved migration/status deferrals**.
Entry: S00 P0-07 revalidation accepted with frozen transition/schema/CLI
fixtures. Exit: P1-09 passes after review and reconciliation. Read
[domain/store handoff](../../../../project/build-plan/verticals/01-domain-storage.md)
and [status model](../../../../project/STATUS_MODEL.md).

## Task graph and parallel lanes

| Task | Prerequisite | Owner/write set | Observable deliverable and gate |
| --- | --- | --- | --- |
| P1-01 — typed work model/transitions | P0-07 | Domain owner: `crates/domain/**` | Typed IDs, kinds, hierarchy, legal/illegal lifecycle transitions and conditional status fixtures. Agent text cannot set `closed`. |
| P1-03 — SQLite schema/migrations | P0-07 | Store owner: `crates/store/**`, schema fixtures by integration owner | WAL schema, FK/unique current attempt/session, revision/audit/operation tables, upgrade fixture and integrity checks. Starts parallel to P1-01. |
| P1-02 — status/dependency/rollup evaluator | P1-01 | Domain owner: `crates/domain/**` | One pure evaluator distinguishes queued prerequisites, hard blocked, paused/operator-only, retry wait, expired review, complete/closed; graph cycles fail; rollups/counts exact. |
| P1-04 — transaction/idempotent claim | P1-01/02/03 | Store + application integration owner; exclusive shared schema boundary | Short atomic create/dependency/claim plus audit/revision/operation result. Competing claimers produce one winner; stale snapshot is rejected. |
| P1-05 — revisioned reads | P1-02/04 | Store owner: `crates/store/**` | Bounded one-revision/`as_of` queries and accurate totals; no writer lock for TUI/status reads; expiry effective even before timer write. |
| P1-06 — project/work/sprint use cases | P1-02/05 | Application owner: work/sprint modules under `crates/application/**` | Create/show/list/activate/dependency operations call domain/store policy once; typed errors/revisions. |

P1-01 and P1-03 begin concurrently after P0-07. P1-02 follows domain.
P1-04 is the explicit integration join; do not let two agents edit the same
migration, Cargo workspace manifest, or store transaction surface. The
coordinator records a shared-interface request before crossing write sets.

## Gate chain

| Gate task | Required evidence |
| --- | --- |
| P1-07 — independent review | Transition/graph/property tests, schema constraints, query plans, lock scope, crash and status-time semantics reviewed against P0 fixtures; findings recorded even if none. |
| P1-08 — reconcile | Owners fix findings or record accepted no-change/deferral with reason, affected files, and checks to rerun. |
| P1-09 — revalidate | Fresh and upgraded DB suites plus competing claimers and concurrent readers pass on combined source; only this gate unlocks S02. |

Negative cases include ready projection stale after edge edit, queued plus
hard block, cancelled prerequisite, verified-but-unclosed prerequisite,
operator-only release, duplicate operation ID, deadline equality, and a
crash at transaction commit. No focused test is described as full release.

## Dispatch ledger — coordinator only

| Task | State | Agent | Input snapshot | Deadline UTC | Evidence/finding link |
| --- | --- | --- | --- | --- | --- |
| P1-01 | complete | Beauvoir (Luna) | 2026-09-15T01:28:51Z; P0-07 revalidated | 2026-09-15T03:28:51Z | 15 domain tests pass; review accepted |
| P1-03 | complete | Godel (Luna) | 2026-09-15T01:28:51Z; P0-07 revalidated | 2026-09-15T03:28:51Z | 10 store contract tests pass; review accepted |
| P1-02 | complete | Coordinator | P1-01 domain evaluator plus rollup implementation | 2026-09-15T03:52:04Z | 15 domain tests pass; review accepted |
| P1-04 | complete | Coordinator | P1-01/P1-02/P1-03 combined | 2026-09-15T03:52:04Z | atomic claim/replay seam; 10 store tests pass |
| P1-05 | complete | Coordinator | P1-04 combined | 2026-09-15T03:52:04Z | bounded revisioned read and exact total test pass |
| P1-06 | complete | Coordinator | P1-02/P1-05 combined | 2026-09-15T03:52:04Z | application init/create/list/claim test pass |
| P1-07 | complete | James (Luna) | Combined P1 source; P0-07 revalidated | 2026-09-15T03:52:04Z | [review](../../../../project/build-plan/P1-07-REVIEW.md); NO-PASS findings recorded |
| P1-08 | complete | Coordinator | P1-07 findings | 2026-09-15T03:52:04Z | [reconciliation](../../../../project/build-plan/P1-08-RECONCILIATION.md); R01-R04 fixed, R05 deferred |
| P1-09 | complete | Coordinator | P1-08 combined tree | 2026-09-15T03:52:04Z | [revalidation](../../../../project/build-plan/P1-09-REVALIDATION.md); PASS with approved deferrals |

After P1-09, dispatch P2-01 and P2-03 in parallel via
[handoff](../../../../AGENT_HANDOFF.md).
