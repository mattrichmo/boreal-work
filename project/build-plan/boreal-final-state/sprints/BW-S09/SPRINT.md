# BW-S09 — Explicit Global Send with frozen intent and deterministic reconciliation

**Goal:** Add an explicit transfer from an eligible Global capture-origin item into project Intake while preserving unknown-outcome safety and the authority boundary.

**Entry dependency:** BW-S08-T90  
**Sprint close:** `BW-S09-T90` — integration + sprint-level validation.

## Required context

Read `../../MASTER_PLAN.md`, `../../DECISIONS.md`, `../../execution/PARALLEL_DISPATCH.md`, `../../execution/SHARED_FILES.md`, repository `AGENTS.md`, then the selected task packet. Inspect the current dispatched source; retain already-correct implementation.

## Tasks

| Task | Outcome | Lane | Dispatch | Direct prerequisites |
| --- | --- | --- | --- | --- |
| [BW-S09-T01](tasks/BW-S09-T01.md) | Implement Global Send eligibility and frozen pending intent state | GLOBAL_APP | automatic | BW-S08-T90 |
| [BW-S09-T02](tasks/BW-S09-T02.md) | Add contextual Send to project interaction without a new top-level route | GLOBAL_TUI | automatic | BW-S08-T90, BW-S09-T01 |
| [BW-S09-T03](tasks/BW-S09-T03.md) | Implement cross-store receive, readback and attempt reconciliation adapter | GLOBAL_LINKS | automatic | BW-S08-T90, BW-S09-T01, BW-S08-T04 |
| [BW-S09-T04](tasks/BW-S09-T04.md) | Record accepted Intake reference and archive-not-complete the Global source | GLOBAL_APP | automatic | BW-S08-T90, BW-S09-T03 |
| [BW-S09-T05](tasks/BW-S09-T05.md) | Exercise clone, restore, import and ambiguous-delivery failure matrix | VALIDATION | automatic | BW-S08-T90, BW-S09-T03, BW-S08-T05 |
| [BW-S09-T90](tasks/BW-S09-T90.md) | Integrate the sprint and validate the combined behavior | INTEGRATION | operator_only | BW-S09-T01, BW-S09-T02, BW-S09-T03, BW-S09-T04, BW-S09-T05 |

## Parallelism

- T01 Global state/eligibility and T02 UI may start in parallel once command shape is fixed; UI uses a stub until T03 integration.
- T03 cross-store adapter consumes S08 service and T01 persistence.
- T04 acceptance/archive consumes T03.
- T05 is the fault matrix and can grow alongside implementation.

## Sprint validation

Validation is intentionally concentrated here, in `BW-S09-T90`, unless a leaf packet names a dependency-sensitive local check.

- [ ] Frozen intent is durable before project I/O and an unresolved item cannot be edited/resubmitted blindly.
- [ ] Two cloned Globals sending the same origin/payload converge on one Intake.
- [ ] Divergent payload for the same origin+target conflicts rather than creating a second Intake.
- [ ] Lost response after project commit reconciles from typed receipt without resend.
- [ ] Project revision/actor/session change creates a new attempt only after old outcome is reconciled.
- [ ] Project restore identity change never turns old not_found into proof of non-commit.
- [ ] Imported/restored pending Send is readback-first and never auto-dispatches.
- [ ] Acceptance archives Global source but never completes it or project execution.

## Sprint handoff

The integrator records the exact combined source identity, changed shared contracts, checks actually run, failures/unsupported cases, and successor tasks unlocked. A task worker's branch or focused check does not by itself close the sprint.
