# BW-S00 — Current-head qualification and parallel execution baseline

**Goal:** Qualify the exact starting source, repair the validation harness, and establish non-overlapping multi-agent dispatch before product changes begin.

**Entry dependency:** None  
**Sprint close:** `BW-S00-T90` — integration + sprint-level validation.

## Required context

Read `../../MASTER_PLAN.md`, `../../DECISIONS.md`, `../../execution/PARALLEL_DISPATCH.md`, `../../execution/SHARED_FILES.md`, repository `AGENTS.md`, then the selected task packet. Inspect the current dispatched source; retain already-correct implementation.

## Tasks

| Task | Outcome | Lane | Dispatch | Direct prerequisites |
| --- | --- | --- | --- | --- |
| [BW-S00-T01](tasks/BW-S00-T01.md) | Freeze exact source baseline and reconcile the current audit inventory | COORD | operator_only | None |
| [BW-S00-T02](tasks/BW-S00-T02.md) | Add Global TUI and portable PTY coverage to normal validation | VALIDATION | automatic | BW-S00-T01 |
| [BW-S00-T03](tasks/BW-S00-T03.md) | Exercise the real release download and checksum verification path | RELEASE | automatic | BW-S00-T01 |
| [BW-S00-T04](tasks/BW-S00-T04.md) | Establish multi-agent worktrees, write ownership and integration stewardship | COORD | operator_only | None |
| [BW-S00-T05](tasks/BW-S00-T05.md) | Expose the trusted attempt recovery action through CLI and service | CLI | operator_only | None |
| [BW-S00-T90](tasks/BW-S00-T90.md) | Integrate the sprint and validate the combined behavior | INTEGRATION | operator_only | BW-S00-T01, BW-S00-T02, BW-S00-T03, BW-S00-T04, BW-S00-T05 |

## Parallelism

- T01 and T04 may run in parallel.
- T05 is a bounded operational repair and can run beside the documentation-only T01/T04 work.
- T02 can begin after T01 fixes the candidate identity; T03 can run alongside T02.
- T90 owns the combined CI/PTY result and unlocks the implementation waves after T05 is integrated.

## Sprint validation

Validation is intentionally concentrated here, in `BW-S00-T90`, unless a leaf packet names a dependency-sensitive local check.

- [ ] Both project and Global TUI test suites are invoked by CI/full validation.
- [ ] Global PTY smoke covers narrow, normal, wide, and resize paths using a portable temp directory.
- [ ] Global service remains alive after malformed/disconnected clients; unknown writes retain operation readback.
- [ ] Global works from arbitrary cwd and inside a project; project execution still works with Global unavailable.
- [ ] Validation output records exact source/binary identity and does not count environment skips as passes.

## Sprint handoff

The integrator records the exact combined source identity, changed shared contracts, checks actually run, failures/unsupported cases, and successor tasks unlocked. A task worker's branch or focused check does not by itself close the sprint.
