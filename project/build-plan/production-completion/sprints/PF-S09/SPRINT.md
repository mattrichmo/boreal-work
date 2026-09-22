# PF-S09 — Milestones, cycle-backed sprints and dependency planning

**State at issue:** proposed / every task unaccepted.  
**Goal:** Build the canonical planning model and familiar compatibility routes without duplicate sprint/cycle authority, preserving task identities through parallel scheduling and carry-over.

## Entry, leaf joins and exit

**Hard entry gate tasks:** PF-S02-T92, PF-S03-T92, PF-S04-T92  
**Additional cross-sprint joins on named leaves:** PF-S08  
**Independent review:** `PF-S09-T90` → **reconciliation:** `PF-S09-T91` → **exit revalidation:** `PF-S09-T92`.

All entry gates must be accepted before code work in this sprint. Individual leaf prerequisites may add later joins. In particular PF-S09 may begin its independent planning foundation after PF-S02/PF-S03/PF-S04, but PF-S09-T06 cannot begin until PF-S08-T92 is accepted. This is not early sprint acceptance.

## Required context

Read [the plan entry point](../../README.md), [dispatch rules](../../execution/PARALLEL_DISPATCH.md), [shared-file locks](../../execution/SHARED_FILES.md), [the validation playbook](../../validation/VALIDATION_PLAYBOOK.md) and the selected leaf. Relevant baseline references: [R-WORKMODEL](../../reference/context/R-WORKMODEL.md), [R-SCENARIOS](../../reference/context/R-SCENARIOS.md), [R-APP-HIERARCHY](../../reference/context/R-APP-HIERARCHY.md), [R-APP-PLANNING](../../reference/context/R-APP-PLANNING.md), [R-STORE-V3](../../reference/context/R-STORE-V3.md), [R-M02](../../reference/context/R-M02.md).

**Risk to preserve:** Planning may start alongside runtime work, but cycle/container terminal-disposition integration explicitly waits for the accepted lifecycle gate where named on leaf tasks.

## Task-by-task execution map

| Task | Bounded outcome | Lane | Additional task prerequisites | Initial state |
| --- | --- | --- | --- | --- |
| [PF-S09-T01](tasks/PF-S09-T01.md) | Implement project-scoped milestone and task planning operations | APPLICATION | Sprint entry only | not_started |
| [PF-S09-T02](tasks/PF-S09-T02.md) | Implement cycle identity, lifecycle and legacy sprint mapping | APPLICATION | PF-S09-T01 | not_started |
| [PF-S09-T03](tasks/PF-S09-T03.md) | Implement task assignments and atomic commitment changes | APPLICATION | PF-S09-T01, PF-S09-T02 | not_started |
| [PF-S09-T04](tasks/PF-S09-T04.md) | Implement typed dependency edits and transactional graph validation | APPLICATION | PF-S09-T01, PF-S09-T02 | not_started |
| [PF-S09-T05](tasks/PF-S09-T05.md) | Implement versioned planning profile, schedule and policy edits | APPLICATION | PF-S09-T01, PF-S09-T02, PF-S09-T03, PF-S09-T04 | not_started |
| [PF-S09-T06](tasks/PF-S09-T06.md) | Implement carry-over, cycle cancellation and scope reconciliation | APPLICATION | PF-S09-T03, PF-S09-T05, PF-S08-T92 | not_started |
| [PF-S09-T07](tasks/PF-S09-T07.md) | Implement scope-bound milestone and cycle closeout | APPLICATION | PF-S09-T06 | not_started |
| [PF-S09-T08](tasks/PF-S09-T08.md) | Expose planning application/service adapters and compatibility errors | PROTOCOL | PF-S09-T02, PF-S09-T03, PF-S09-T04, PF-S09-T05, PF-S09-T06, PF-S09-T07 | not_started |
| [PF-S09-T09](tasks/PF-S09-T09.md) | Validate parallel sprint planning and history-preserving disposition | VALIDATION | PF-S09-T08 | not_started |
| [PF-S09-T90](tasks/PF-S09-T90.md) | Independent sprint review and finding classification | VALIDATION | PF-S09-T01, PF-S09-T02, PF-S09-T03, PF-S09-T04, PF-S09-T05, PF-S09-T06, PF-S09-T07, PF-S09-T08, PF-S09-T09 | not_started |
| [PF-S09-T91](tasks/PF-S09-T91.md) | Reconcile sprint findings and integrate bounded corrections | COORD | PF-S09-T90 | not_started |
| [PF-S09-T92](tasks/PF-S09-T92.md) | Revalidate the integrated sprint and authorize successors | VALIDATION | PF-S09-T91 | not_started |

## Parallelism and integration

Dispatch one task per named agent, never this entire sprint as one assignment. Tasks with all prerequisites accepted may run together only when their actual worker write sets do not overlap. Shared root/schema/protocol/registry/release edits are serialized by the named steward; a function range in one file is not a separate write lock. Task cards list existing files versus proposed new outputs and exact integration requests. Use `python3 tools/plan.py graph-ready` and `python3 tools/plan.py conflicts TASK_A TASK_B` from this plan folder as read-only aids; neither grants authority or edits application state.

## Required sprint acceptance

- [ ] Every leaf has accepted evidence and a complete handoff at its actual integrated source revision.
- [ ] All schema/protocol/contract/root registrations are integrated; no disconnected scaffolding or test-only success path remains.
- [ ] Independent review records all findings (or explicit `no_findings`) with attributable reviewer identity.
- [ ] Reconciliation fixes every required issue or documents a justified noncritical disposition; mandatory safety/authority/proof/isolation work is nonwaivable.
- [ ] Exact-tree revalidation reruns the affected focused and required integration/native checks, preserving failures and unsupported results.
- [ ] Only `PF-S09-T92` acceptance unlocks ordinary successor sprint entry; publication and final production completion have additional explicit gates.

## Dispatch and evidence

The live coordinator ledger is [execution/STATE.json](../../execution/STATE.json); the source/evidence handoff template is [TASK_HANDOFF.md](../../templates/TASK_HANDOFF.md). Use `project/validation/production/tasks/<TASK-ID>/attempt-<N>/` for task evidence and `project/validation/production/sprints/PF-S09/` for sprint findings/reconciliation/revalidation. These are proposed execution outputs, not evidence supplied with this plan.
