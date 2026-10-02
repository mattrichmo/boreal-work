# BW-S08 — Project restore identity and immutable Intake delivery receipt

**Goal:** Prepare the project-owned landing zone for explicit Global handoff without weakening normal Intake, project execution or old work-model/3 authority.

**Entry dependency:** BW-S07-T90  
**Sprint close:** `BW-S08-T90` — integration + sprint-level validation.

## Required context

Read `../../MASTER_PLAN.md`, `../../DECISIONS.md`, `../../execution/PARALLEL_DISPATCH.md`, `../../execution/SHARED_FILES.md`, repository `AGENTS.md`, then the selected task packet. Inspect the current dispatched source; retain already-correct implementation.

## Tasks

| Task | Outcome | Lane | Dispatch | Direct prerequisites |
| --- | --- | --- | --- | --- |
| [BW-S08-T01](tasks/BW-S08-T01.md) | Give each project restore activation a genuinely unique physical identity | PROJECT_STORE | automatic | BW-S07-T90 |
| [BW-S08-T02](tasks/BW-S08-T02.md) | Install immutable intake_delivery v1 as an additive feature schema | PROJECT_STORE | automatic | BW-S07-T90 |
| [BW-S08-T03](tasks/BW-S08-T03.md) | Implement project-owned Intake receive transaction and idempotent resolution | PROJECT_APP | automatic | BW-S07-T90, BW-S08-T02 |
| [BW-S08-T04](tasks/BW-S08-T04.md) | Expose service-addressable Intake receive and receipt-bearing readback | PROJECT_SERVICE | automatic | BW-S07-T90, BW-S08-T03 |
| [BW-S08-T05](tasks/BW-S08-T05.md) | Qualify additive feature compatibility and receipt behavior across project restore | VALIDATION | automatic | BW-S07-T90, BW-S08-T01, BW-S08-T02, BW-S08-T04 |
| [BW-S08-T90](tasks/BW-S08-T90.md) | Integrate the sprint and validate the combined behavior | INTEGRATION | operator_only | BW-S08-T01, BW-S08-T02, BW-S08-T03, BW-S08-T04, BW-S08-T05 |

## Parallelism

- T01 restore identity and T02 additive receipt schema may proceed in parallel.
- T03 receive transaction consumes T02.
- T04 service surface consumes T03.
- T05 compatibility/restore validation consumes T01/T02/T04.

## Sprint validation

Validation is intentionally concentrated here, in `BW-S08-T90`, unless a leaf packet names a dependency-sensitive local check.

- [ ] Every project restore activation gets a fresh physical database identity while retaining restore epoch semantics.
- [ ] Existing Intake rows remain unchanged and have no fabricated external receipt.
- [ ] Delivery receipt survives Intake edit/archive/promotion and project backup/restore when present in the snapshot.
- [ ] Same delivery key+payload resolves one accepted Intake; same key+changed payload conflicts.
- [ ] Duplicate resolution does not create a semantic revision/audit write merely to report an existing receipt.
- [ ] Older binary ordinary project workflows remain usable on the additive-feature DB if that compatibility is claimed.
- [ ] Project guide/claim/evidence/finish remains independent of Global.

## Sprint handoff

The integrator records the exact combined source identity, changed shared contracts, checks actually run, failures/unsupported cases, and successor tasks unlocked. A task worker's branch or focused check does not by itself close the sprint.
