# S03 — Source engine and Git-published memory

Parent: [M01](../../README.md). State: **queued on P2-09; bounded P3 gate evidence recorded**.
Entry: S02 P2-09 accepted. Exit: P3-09 revalidation.
This sprint overlaps [S04 TUI](../S04-tui/SPRINT.md); source/memory agents
do not edit `apps/tui/**`. Read
[source handoff](../../../../project/build-plan/verticals/03-source-engine.md),
[memory handoff](../../../../project/build-plan/verticals/04-memory-bank.md),
[source contract](../../../../project/SOURCE_ENGINE.md), and
[memory contract](../../../../project/MEMORY_BANK.md).

Coordinator note: P2-09 is not yet passed. Any source/memory files present in
this tree are early groundwork and do not count as P3 leaf assignments or a
passed S03 entry gate.

The bounded P3 provenance pass is now recorded in
[P3-07 review](../../../../project/build-plan/P3-07-REVIEW.md),
[P3-08 reconciliation](../../../../project/build-plan/P3-08-RECONCILIATION.md),
and [P3-09 revalidation](../../../../project/build-plan/P3-09-REVALIDATION.md).
Those records are intentionally partial: source/memory focused tests pass,
while application/store crash recovery, cross-process publication locking, and
claim-hold measurement remain open. This does not change the P2-09 entry gate
or authorize S03 completion.

## Task graph and ownership

| Task | Prerequisite | Owner/write set | Observable deliverable and gate |
| --- | --- | --- | --- |
| P3-01 — immutable source/blob intake | P2-09 | Source owner: source modules, blob store, source tests | Project-scoped source versions with digest, origin, media type, availability; duplicate intake idempotent; missing blobs diagnosed. |
| P3-02 — extraction/index jobs | P3-01 | Source owner: parser/index modules | Parsing outside writer transaction, versioned derived index, stale parser result rejected, failure retained. |
| P3-03 — cited draft memory/review | P3-01/02 | Memory owner: memory draft modules | Draft cites exact source versions, remains project-scoped, never masquerades as published knowledge. |
| P3-04 — Git publication/reimport | P3-03 | Memory owner: publisher and manifest modules | Dedicated memory worktree, deterministic manifest, crash-safe idempotent publication, valid fresh-clone reimport without lost human edits. |
| P3-05 — bounded retrieval/context | P3-02/04 | Source retrieval owner; published projection supplied by memory lane | Hits distinguish raw/draft/published, source version, Git commit, trust/index revision; bounded relevant handoff to agent. |
| P3-06 — doctor/retention/repair | P2-09/P3-04 | Memory/health owner: doctor modules | Current corruption vs historical warning, supported repair convergence, second repair no-op, failed evidence/causal links retained. |

Source and memory may build disjoint modules, but both need domain/store,
protocol, and migration seams. One integration editor owns shared migrations,
DTOs, workspace manifest, and `docs/MIGRATION.md`. Agree on source-version
and published-projection interfaces before P3-05. Git memory publication is
not a work-claim transaction.

## Gate chain

| Gate task | Required evidence |
| --- | --- |
| P3-07 — independent provenance review | Path/scope security, citation identity, parser version drift, source availability, Git crash stages, fresh clone, prompt/data trust boundary, stable repair; findings recorded. |
| P3-08 — reconcile | Resolve each finding or record authorized deferral/owner; update manifest/schema/index/receipts and affected checks. |
| P3-09 — revalidate | Source intake and Git publication recover on crash; fresh clone restores curated memory; source parsing/publication do not materially extend claim lock holds. Unlocks P4-04/P4-10 and S05 join. |

S04's UI can consume stable v2 API fixtures while this sprint works. It must
show unpublished drafts as drafts, not as canonical Git memory. Do not call
P3 complete because P3-04 publishes successfully once; verify reimport and
repair on the reconciled snapshot.

## Dispatch ledger — coordinator only

| Task | State | Agent | Input snapshot | Deadline UTC | Evidence/finding link |
| --- | --- | --- | --- | --- | --- |
| P3-01 | queued on P2-09 | — | — | — | — |

After P3-09, dispatch migration P4-04 and workflow assets P4-10 in parallel
with any remaining S04 UI work using
[handoff](../../../../AGENT_HANDOFF.md).
