# BW-S11 — Integrated release qualification, v1 parity and operational handover

**Goal:** Qualify the completed Global + project system on exact supported artifacts, reconcile documentation/parity, and leave a maintainable operator handoff.

**Entry dependency:** BW-S09-T90, BW-S10-T90 and BW-S12-T90  
**Sprint close:** `BW-S11-T90` — integration + sprint-level validation.

## Required context

Read `../../MASTER_PLAN.md`, `../../DECISIONS.md`, `../../execution/PARALLEL_DISPATCH.md`, `../../execution/SHARED_FILES.md`, repository `AGENTS.md`, then the selected task packet. Inspect the current dispatched source; retain already-correct implementation.

## Tasks

| Task | Outcome | Lane | Dispatch | Direct prerequisites |
| --- | --- | --- | --- | --- |
| [BW-S11-T01](tasks/BW-S11-T01.md) | Build and smoke exact supported release artifacts on the declared platform matrix | RELEASE | automatic | BW-S10-T90, BW-S09-T90, BW-S12-T90 |
| [BW-S11-T02](tasks/BW-S11-T02.md) | Run exact-artifact end-to-end Global and project authority journeys | VALIDATION | automatic | BW-S10-T90, BW-S09-T90, BW-S11-T01, BW-S12-T90 |
| [BW-S11-T03](tasks/BW-S11-T03.md) | Bring install, recovery, Global manager, CLI and agent docs to the shipped final state | DOCS | operator_only | BW-S10-T90, BW-S09-T90, BW-S07-T06, BW-S09-T04, BW-S12-T90 |
| [BW-S11-T04](tasks/BW-S11-T04.md) | Execute explicit v1 parity and deliberate-departure review | MIGRATION | operator_only | BW-S10-T90, BW-S09-T90, BW-S12-T90 |
| [BW-S11-T05](tasks/BW-S11-T05.md) | Run final recovery, authority, security and representative performance regression | VALIDATION | automatic | BW-S10-T90, BW-S09-T90, BW-S11-T01, BW-S11-T02, BW-S10-T02, BW-S12-T90 |
| [BW-S11-T06](tasks/BW-S11-T06.md) | Finalize operator runbooks, support boundaries and next measured backlog | COORD | operator_only | BW-S10-T90, BW-S09-T90, BW-S11-T03, BW-S11-T04, BW-S11-T05, BW-S12-T90 |
| [BW-S11-T90](tasks/BW-S11-T90.md) | Integrate the sprint and validate the combined behavior | INTEGRATION | operator_only | BW-S11-T01, BW-S11-T02, BW-S11-T03, BW-S11-T04, BW-S11-T05, BW-S11-T06 |

## Parallelism

- T01 platform packaging and T03 docs/parity can begin in parallel.
- T02 exact-artifact product journey consumes T01.
- T04 v1 parity consumes completed product behaviors and can run alongside T02.
- T05 is the final fault/security/performance regression.
- T06 integrates release/runbook handover.

## Sprint validation

Validation is intentionally concentrated here, in `BW-S11-T90`, unless a leaf packet names a dependency-sensitive local check.

- [ ] Exact candidate artifacts install and run on macOS ARM64, macOS x86-64 and Linux x86-64.
- [ ] Fresh install, old→new update, backup/restore, local Global session and explicit Send are exercised on release artifacts.
- [ ] Project execution guide/claim/evidence/review/finish remains independently functional with Global absent.
- [ ] v1 capture-first, path-independent identity, stale linked truth and recoverability parity are explicitly dispositioned.
- [ ] No required critical authority/recovery/isolation defect remains open.
- [ ] Documentation examples are generated/verified against the callable registry rather than aspirational command prose.

## Sprint handoff

The integrator records the exact combined source identity, changed shared contracts, checks actually run, failures/unsupported cases, and successor tasks unlocked. A task worker's branch or focused check does not by itself close the sprint.

## Revision 3 completion contract

Read `../../WORKFLOW_CONTRACT.md`; its required journeys augment, not replace, the validation above. Follow the current task table/JSON graph if historical wave prose differs. No core workflow may be silently deferred to reach a green release.
