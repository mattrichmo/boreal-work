# BW-S10 — Scale qualification and evidence-driven product refinement

**Goal:** Measure the completed local Global product and only implement storage/view refinements that real scale or usage evidence justifies.

**Entry dependency:** BW-S07-T90  
**Sprint close:** `BW-S10-T90` — integration + sprint-level validation.

## Required context

Read `../../MASTER_PLAN.md`, `../../DECISIONS.md`, `../../execution/PARALLEL_DISPATCH.md`, `../../execution/SHARED_FILES.md`, repository `AGENTS.md`, then the selected task packet. Inspect the current dispatched source; retain already-correct implementation.

## Tasks

| Task | Outcome | Lane | Dispatch | Direct prerequisites |
| --- | --- | --- | --- | --- |
| [BW-S10-T01](tasks/BW-S10-T01.md) | Build deterministic representative and stretch Global portfolio fixtures | PERFORMANCE | automatic | BW-S07-T90 |
| [BW-S10-T02](tasks/BW-S10-T02.md) | Benchmark Global read/write/history/backup behavior on both fixtures | PERFORMANCE | operator_only | BW-S07-T90, BW-S10-T01 |
| [BW-S10-T03](tasks/BW-S10-T03.md) | Choose the post-measurement storage and retention strategy | ARCHITECTURE | operator_only | BW-S07-T90, BW-S10-T02 |
| [BW-S10-T04](tasks/BW-S10-T04.md) | Conditional: add rebuildable read/search projection if measured reads require it | GLOBAL_STORE | paused | BW-S07-T90, BW-S10-T03 |
| [BW-S10-T05](tasks/BW-S10-T05.md) | Conditional: add named saved views after query semantics and scale are stable | GLOBAL_APP | paused | BW-S07-T90, BW-S10-T03 |
| [BW-S10-T06](tasks/BW-S10-T06.md) | Conditional: run cheap Heartbeat, Captured-as, List and Track experiments | PRODUCT | paused | BW-S07-T90, BW-S10-T03 |
| [BW-S10-T90](tasks/BW-S10-T90.md) | Integrate the sprint and validate the combined behavior | INTEGRATION | operator_only | BW-S10-T01, BW-S10-T02, BW-S10-T03 |

## Parallelism

- T01 fixture generator precedes T02 benchmark.
- T03 decision follows benchmark.
- T04-T06 are intentionally paused conditional work and may be unpaused only by the T03 decision/user evidence.
- This sprint can run in parallel with S08/S09 and does not block Send implementation until final release join.

## Sprint validation

Validation is intentionally concentrated here, in `BW-S10-T90`, unless a leaf packet names a dependency-sensitive local check.

- [ ] Representative and stretch fixture generation does not create artificial history per seeded record.
- [ ] Benchmark records startup/Home/search/mutation/export/physical backup/history-growth/linked refresh with environment identity.
- [ ] A written storage decision selects keep-store/read-projection/history-archival/write-model based on measured results.
- [ ] Conditional product refinements remain paused unless their trigger is documented.
- [ ] No performance target is retroactively invented from an unrelated project benchmark.

## Sprint handoff

The integrator records the exact combined source identity, changed shared contracts, checks actually run, failures/unsupported cases, and successor tasks unlocked. A task worker's branch or focused check does not by itself close the sprint.
