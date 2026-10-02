# BW-S04 — Complete bounded Global reads, transfer and linked-workspace isolation

**Goal:** Close the remaining scale/completeness holes in the current serialized Global read model without prematurely replacing its write authority.

**Entry dependency:** BW-S00-T90  
**Sprint close:** `BW-S04-T90` — integration + sprint-level validation.

## Required context

Read `../../MASTER_PLAN.md`, `../../DECISIONS.md`, `../../execution/PARALLEL_DISPATCH.md`, `../../execution/SHARED_FILES.md`, repository `AGENTS.md`, then the selected task packet. Inspect the current dispatched source; retain already-correct implementation.

## Tasks

| Task | Outcome | Lane | Dispatch | Direct prerequisites |
| --- | --- | --- | --- | --- |
| [BW-S04-T01](tasks/BW-S04-T01.md) | Bound project attention and add complete paged attention/detail reads | GLOBAL_APP | automatic | BW-S00-T90 |
| [BW-S04-T02](tasks/BW-S04-T02.md) | Make search and triage pickers complete beyond the snapshot sample | GLOBAL_TUI | automatic | BW-S00-T90, BW-S04-T01 |
| [BW-S04-T03](tasks/BW-S04-T03.md) | Make linked association enumeration and global next complete beyond summary caps | GLOBAL_LINKS | automatic | BW-S00-T90 |
| [BW-S04-T04](tasks/BW-S04-T04.md) | Qualify linked worker saturation, deadlines and last-good isolation | VALIDATION | automatic | BW-S00-T90, BW-S04-T03 |
| [BW-S04-T05](tasks/BW-S04-T05.md) | Harden logical export/import size, history and replacement invariants | GLOBAL_APP | automatic | BW-S00-T90, BW-S01-T05 |
| [BW-S04-T90](tasks/BW-S04-T90.md) | Integrate the sprint and validate the combined behavior | INTEGRATION | operator_only | BW-S04-T01, BW-S04-T02, BW-S04-T03, BW-S04-T04, BW-S04-T05 |

## Parallelism

- T01 attention paging, T03 linked enumeration, and T05 transfer work can proceed in parallel.
- T02 picker/search completeness consumes T01 paging conventions.
- T04 linked saturation validation consumes T03.

## Sprint validation

Validation is intentionally concentrated here, in `BW-S04-T90`, unless a leaf packet names a dependency-sensitive local check.

- [ ] All accepted records remain reachable beyond summary caps; totals remain exact.
- [ ] Project attention is bounded/pageable and cannot alone overflow the interactive frame.
- [ ] Search/filter happens before pagination; picker options do not silently stop at summary sample.
- [ ] global next/registry diagnostics enumerate eligible associations completely or explicitly return partial state.
- [ ] Linked worker saturation cannot block ordinary Global management or convert stale counts to zero.
- [ ] Large valid logical state is physically backupable even when logical transfer refuses it.

## Sprint handoff

The integrator records the exact combined source identity, changed shared contracts, checks actually run, failures/unsupported cases, and successor tasks unlocked. A task worker's branch or focused check does not by itself close the sprint.
