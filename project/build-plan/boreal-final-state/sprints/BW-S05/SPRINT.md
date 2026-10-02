# BW-S05 — Civil-time daily semantics and dependency-honest management attention

**Goal:** Make Home and Today mean the same thing across Rust/CLI/TUI and recommend only management work that can actually proceed.

**Entry dependency:** BW-S04-T90  
**Sprint close:** `BW-S05-T90` — integration + sprint-level validation.

## Required context

Read `../../MASTER_PLAN.md`, `../../DECISIONS.md`, `../../execution/PARALLEL_DISPATCH.md`, `../../execution/SHARED_FILES.md`, repository `AGENTS.md`, then the selected task packet. Inspect the current dispatched source; retain already-correct implementation.

## Tasks

| Task | Outcome | Lane | Dispatch | Direct prerequisites |
| --- | --- | --- | --- | --- |
| [BW-S05-T01](tasks/BW-S05-T01.md) | Introduce one application-owned system civil-time context | GLOBAL_DOMAIN | automatic | BW-S04-T90 |
| [BW-S05-T02](tasks/BW-S05-T02.md) | Replace Today predicate with explicit grouped daily classification | GLOBAL_DOMAIN | automatic | BW-S04-T90, BW-S05-T01 |
| [BW-S05-T03](tasks/BW-S05-T03.md) | Make management next action dependency-honest with bounded blocker reasons | GLOBAL_DOMAIN | automatic | BW-S04-T90 |
| [BW-S05-T04](tasks/BW-S05-T04.md) | Rebuild Home attention contract around truthful management summaries | GLOBAL_APP | automatic | BW-S04-T90, BW-S05-T01, BW-S05-T03, BW-S04-T01 |
| [BW-S05-T05](tasks/BW-S05-T05.md) | Expose the same daily filters through CLI and service | CLI | automatic | BW-S04-T90, BW-S05-T02, BW-S05-T04 |
| [BW-S05-T90](tasks/BW-S05-T90.md) | Integrate the sprint and validate the combined behavior | INTEGRATION | operator_only | BW-S05-T01, BW-S05-T02, BW-S05-T03, BW-S05-T04, BW-S05-T05 |

## Parallelism

- T01 time context and T03 dependency readiness can run in parallel.
- T02 classification consumes T01.
- T04 attention consumes T01/T03.
- T05 CLI filters consumes T02/T04.

## Sprint validation

Validation is intentionally concentrated here, in `BW-S05-T90`, unless a leaf packet names a dependency-sensitive local check.

- [ ] CLI, Home and TUI classify due/overdue/follow-up identically near local midnight and DST boundaries.
- [ ] Due date is an obligation; follow-up is a waiting check-back; no reminder is implied.
- [ ] Default review visibly separates Overdue, Due today, Waiting, Unscheduled and Later.
- [ ] Next excludes tasks with any unresolved prerequisite; completed prerequisites satisfy even if later archived; cancelled/archived-incomplete do not.
- [ ] Hierarchy and related links do not become implicit dependencies.
- [ ] Personal/null-owner attention is first-class and no synthetic project ID leaks into persisted data.

## Sprint handoff

The integrator records the exact combined source identity, changed shared contracts, checks actually run, failures/unsupported cases, and successor tasks unlocked. A task worker's branch or focused check does not by itself close the sprint.
