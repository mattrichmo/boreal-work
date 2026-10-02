# BW-S10 — Scale qualification and explicit release-scope decision

**Goal:** Measure the completed local Global product against declared budgets, remediate mandatory release failures, and separately disposition optional storage/view experiments.

**Entry dependency:** BW-S07-T90  
**Sprint close:** `BW-S10-T90` — integration + sprint-level validation.

## Required context

Read `../../MASTER_PLAN.md`, `../../DECISIONS.md`, `../../execution/PARALLEL_DISPATCH.md`, `../../execution/SHARED_FILES.md`, repository `AGENTS.md`, then the selected task packet. Inspect the current dispatched source; retain already-correct implementation.

## Tasks

| Task | Outcome | Lane | Dispatch | Direct prerequisites |
| --- | --- | --- | --- | --- |
| [BW-S10-T01](tasks/BW-S10-T01.md) | Build deterministic representative and stretch Global portfolio fixtures | PERFORMANCE | automatic | BW-S07-T90 |
| [BW-S10-T02](tasks/BW-S10-T02.md) | Benchmark Global read/write/history/backup behavior on both fixtures | PERFORMANCE | operator_only | BW-S07-T90, BW-S10-T01 |
| [BW-S10-T03](tasks/BW-S10-T03.md) | Decide release fitness and any measured follow-on storage work | ARCHITECTURE | operator_only | BW-S07-T90, BW-S10-T02 |
| [BW-S10-T90](tasks/BW-S10-T90.md) | Integrate the sprint and validate the combined behavior | INTEGRATION | operator_only | BW-S10-T01, BW-S10-T02, BW-S10-T03 |

## Parallelism

- T01 fixture generator precedes T02 benchmark.
- T03 decision follows benchmark.
- T04-T06 are preserved outside this required release. T03 may recommend separately approved follow-on work, not unpause it as an implicit sprint requirement.
- This sprint can run in parallel with S08/S09 and does not block Send implementation until final release join.

## Sprint validation

Validation is intentionally concentrated here, in `BW-S10-T90`, unless a leaf packet names a dependency-sensitive local check.

- [ ] Representative and stretch fixture generation does not create artificial history per seeded record.
- [ ] Benchmark records startup/Home/search/mutation/export/physical backup/history-growth/linked refresh with environment identity.
- [ ] A written storage decision selects keep-store/read-projection/history-archival/write-model based on measured results.
- [ ] Optional refinements remain outside the required release; any follow-on needs recorded evidence and explicit scope approval.
- [ ] No performance target is retroactively invented from an unrelated project benchmark.

## Sprint handoff

The integrator records the exact combined source identity, changed shared contracts, checks actually run, failures/unsupported cases, and successor tasks unlocked. A task worker's branch or focused check does not by itself close the sprint.

## Revision 3 completion contract

Read `../../WORKFLOW_CONTRACT.md`; its required journeys augment, not replace, the validation above. Follow the current task table/JSON graph if historical wave prose differs. No core workflow may be silently deferred to reach a green release.

T04/T05/T06 are not required descendants in a fresh V3 import. Preserve their original task cards as deferred records; follow IMPORT.md for existing runtime disposition. Failing representative budgets still require remediation before T90 can close.
