# BW-S01 — Physical Global backup, restore and maintenance ownership

**Goal:** Create a true WAL-safe Global disaster-recovery boundary before any incompatible Global schema expansion.

**Entry dependency:** BW-S00-T90  
**Sprint close:** `BW-S01-T90` — integration + sprint-level validation.

## Required context

Read `../../MASTER_PLAN.md`, `../../DECISIONS.md`, `../../execution/PARALLEL_DISPATCH.md`, `../../execution/SHARED_FILES.md`, repository `AGENTS.md`, then the selected task packet. Inspect the current dispatched source; retain already-correct implementation.

## Tasks

| Task | Outcome | Lane | Dispatch | Direct prerequisites |
| --- | --- | --- | --- | --- |
| [BW-S01-T01](tasks/BW-S01-T01.md) | Implement reusable Global SQLite online backup and manifest validation | GLOBAL_STORE | automatic | BW-S00-T90 |
| [BW-S01-T02](tasks/BW-S01-T02.md) | Expose Global physical backup through application, CLI and service | GLOBAL_API | automatic | BW-S00-T90, BW-S01-T01 |
| [BW-S01-T03](tasks/BW-S01-T03.md) | Implement staged Global restore with retained previous database and fresh active identity | GLOBAL_STORE | automatic | BW-S00-T90, BW-S01-T01, BW-S01-T04 |
| [BW-S01-T04](tasks/BW-S01-T04.md) | Add Global maintenance admission and non-destructive ownership locking | GLOBAL_STORE | automatic | BW-S00-T90 |
| [BW-S01-T05](tasks/BW-S01-T05.md) | Make logical Global transfer symmetric and explicitly separate from backup | GLOBAL_APP | automatic | BW-S00-T90 |
| [BW-S01-T90](tasks/BW-S01-T90.md) | Integrate the sprint and validate the combined behavior | INTEGRATION | operator_only | BW-S01-T01, BW-S01-T02, BW-S01-T03, BW-S01-T04, BW-S01-T05 |

## Parallelism

- T01 (backup store) and T04 (maintenance ownership) may start together on disjoint new modules; integration into existing store roots is serialized.
- T02 consumes T01. T03 consumes T01 and the maintenance contract from T04.
- T05 is application/transfer work and can proceed beside T02/T03 once interfaces are stable.

## Sprint validation

Validation is intentionally concentrated here, in `BW-S01-T90`, unless a leaf packet names a dependency-sensitive local check.

- [ ] A valid physical backup larger than 64 MiB restores successfully.
- [ ] Backup taken while Global uses WAL is coherent and includes state, operations, audit and revision history.
- [ ] Corrupt/truncated/newer unsupported packages are rejected before live replacement.
- [ ] Disk-full and interrupted restore leave either the old DB active or a deterministically recoverable stage.
- [ ] A live Global reader/writer is never force-broken for restore.
- [ ] Two independent restores preserve logical records but receive distinct active database IDs.
- [ ] Logical export/import is explicitly transfer, not disaster recovery.

## Sprint handoff

The integrator records the exact combined source identity, changed shared contracts, checks actually run, failures/unsupported cases, and successor tasks unlocked. A task worker's branch or focused check does not by itself close the sprint.
