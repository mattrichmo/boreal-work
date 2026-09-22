# PF-S20 — Exact-artifact release qualification and independent cutover

**State at issue:** proposed / every task unaccepted.  
**Goal:** Qualify one clean final candidate on every supported platform and obtain an explicit evidence-based ship decision without publishing yet.

## Entry, leaf joins and exit

**Hard entry gate tasks:** PF-S17-T92, PF-S18-T92, PF-S19-T92  
**Additional cross-sprint joins on named leaves:** None beyond sprint entry gates.  
**Independent review:** `PF-S20-T90` → **reconciliation:** `PF-S20-T91` → **exit revalidation:** `PF-S20-T92`.

All entry gates must be accepted before code work in this sprint. Individual leaf prerequisites may add later joins. In particular PF-S09 may begin its independent planning foundation after PF-S02/PF-S03/PF-S04, but PF-S09-T06 cannot begin until PF-S08-T92 is accepted. This is not early sprint acceptance.

## Required context

Read [the plan entry point](../../README.md), [dispatch rules](../../execution/PARALLEL_DISPATCH.md), [shared-file locks](../../execution/SHARED_FILES.md), [the validation playbook](../../validation/VALIDATION_PLAYBOOK.md) and the selected leaf. Relevant baseline references: [R-M02](../../reference/context/R-M02.md), [R-GATES](../../reference/context/R-GATES.md), [R-RELEASE-DOC](../../reference/context/R-RELEASE-DOC.md), [R-RELEASE-CI](../../reference/context/R-RELEASE-CI.md), [R-FULL-SUITE](../../reference/context/R-FULL-SUITE.md), [R-REPORT](../../reference/context/R-REPORT.md).

**Risk to preserve:** A source change after qualification invalidates affected evidence. Test counts, old candidate logs and locally built packages are not an independent cutover decision.

## Task-by-task execution map

| Task | Bounded outcome | Lane | Additional task prerequisites | Initial state |
| --- | --- | --- | --- | --- |
| [PF-S20-T01](tasks/PF-S20-T01.md) | Freeze the release candidate and complete evidence manifest | COORD | Sprint entry only | not_started |
| [PF-S20-T02](tasks/PF-S20-T02.md) | Run full strict Rust, TypeScript, contract and harness gates | VALIDATION | PF-S20-T01 | not_started |
| [PF-S20-T03](tasks/PF-S20-T03.md) | Build and authenticate final candidate artifacts from locked source | RELEASE | PF-S20-T02 | not_started |
| [PF-S20-T04](tasks/PF-S20-T04.md) | Qualify final installed artifacts on every supported native target | VALIDATION | PF-S20-T03 | not_started |
| [PF-S20-T05](tasks/PF-S20-T05.md) | Reconcile full M02/final-form scope and rollback readiness | COORD | PF-S20-T02, PF-S20-T03, PF-S20-T04 | not_started |
| [PF-S20-T06](tasks/PF-S20-T06.md) | Perform final independent architecture and product acceptance audit | VALIDATION | PF-S20-T05 | not_started |
| [PF-S20-T07](tasks/PF-S20-T07.md) | Reconcile final audit findings and requalify affected artifacts | COORD | PF-S20-T06 | not_started |
| [PF-S20-T08](tasks/PF-S20-T08.md) | Record the authorized ship decision and publication conditions | COORD | PF-S20-T07 | not_started |
| [PF-S20-T90](tasks/PF-S20-T90.md) | Independent sprint review and finding classification | VALIDATION | PF-S20-T01, PF-S20-T02, PF-S20-T03, PF-S20-T04, PF-S20-T05, PF-S20-T06, PF-S20-T07, PF-S20-T08 | not_started |
| [PF-S20-T91](tasks/PF-S20-T91.md) | Reconcile sprint findings and integrate bounded corrections | COORD | PF-S20-T90 | not_started |
| [PF-S20-T92](tasks/PF-S20-T92.md) | Revalidate the integrated sprint and authorize successors | VALIDATION | PF-S20-T91 | not_started |

## Parallelism and integration

Dispatch one task per named agent, never this entire sprint as one assignment. Tasks with all prerequisites accepted may run together only when their actual worker write sets do not overlap. Shared root/schema/protocol/registry/release edits are serialized by the named steward; a function range in one file is not a separate write lock. Task cards list existing files versus proposed new outputs and exact integration requests. Use `python3 tools/plan.py graph-ready` and `python3 tools/plan.py conflicts TASK_A TASK_B` from this plan folder as read-only aids; neither grants authority or edits application state.

## Required sprint acceptance

- [ ] Every leaf has accepted evidence and a complete handoff at its actual integrated source revision.
- [ ] All schema/protocol/contract/root registrations are integrated; no disconnected scaffolding or test-only success path remains.
- [ ] Independent review records all findings (or explicit `no_findings`) with attributable reviewer identity.
- [ ] Reconciliation fixes every required issue or documents a justified noncritical disposition; mandatory safety/authority/proof/isolation work is nonwaivable.
- [ ] Exact-tree revalidation reruns the affected focused and required integration/native checks, preserving failures and unsupported results.
- [ ] Only `PF-S20-T92` acceptance unlocks ordinary successor sprint entry; publication and final production completion have additional explicit gates.

## Dispatch and evidence

The live coordinator ledger is [execution/STATE.json](../../execution/STATE.json); the source/evidence handoff template is [TASK_HANDOFF.md](../../templates/TASK_HANDOFF.md). Use `project/validation/production/tasks/<TASK-ID>/attempt-<N>/` for task evidence and `project/validation/production/sprints/PF-S20/` for sprint findings/reconciliation/revalidation. These are proposed execution outputs, not evidence supplied with this plan.
