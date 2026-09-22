# PF-S01 — Final product contracts and explicit owner decisions

**State at issue:** proposed / every task unaccepted.  
**Goal:** Freeze one executable contract for the intended local production product, explicitly approve changes to prior policy, and make every implementation lane consume the same invariant set.

## Entry, leaf joins and exit

**Hard entry gate tasks:** PF-S00-T92  
**Additional cross-sprint joins on named leaves:** None beyond sprint entry gates.  
**Independent review:** `PF-S01-T90` → **reconciliation:** `PF-S01-T91` → **exit revalidation:** `PF-S01-T92`.

All entry gates must be accepted before code work in this sprint. Individual leaf prerequisites may add later joins. In particular PF-S09 may begin its independent planning foundation after PF-S02/PF-S03/PF-S04, but PF-S09-T06 cannot begin until PF-S08-T92 is accepted. This is not early sprint acceptance.

## Required context

Read [the plan entry point](../../README.md), [dispatch rules](../../execution/PARALLEL_DISPATCH.md), [shared-file locks](../../execution/SHARED_FILES.md), [the validation playbook](../../validation/VALIDATION_PLAYBOOK.md) and the selected leaf. Relevant baseline references: [R-DECISIONS](../../reference/context/R-DECISIONS.md), [R-STATUS](../../reference/context/R-STATUS.md), [R-TRANSITIONS](../../reference/context/R-TRANSITIONS.md), [R-WORKMODEL](../../reference/context/R-WORKMODEL.md), [R-PROFILES](../../reference/context/R-PROFILES.md), [R-M02](../../reference/context/R-M02.md), [R-GATES](../../reference/context/R-GATES.md).

**Risk to preserve:** Cycle-backed sprints, sealed submissions, review independence and scheduled status are recommendations until explicitly resolved; workers must not choose local alternatives.

## Task-by-task execution map

| Task | Bounded outcome | Lane | Additional task prerequisites | Initial state |
| --- | --- | --- | --- | --- |
| [PF-S01-T01](tasks/PF-S01-T01.md) | Freeze launch scope, authority boundaries and terminology | CONTRACT | Sprint entry only | not_started |
| [PF-S01-T02](tasks/PF-S01-T02.md) | Freeze identity, revisions, operation outcomes and actor threat model | CONTRACT | PF-S01-T01 | not_started |
| [PF-S01-T03](tasks/PF-S01-T03.md) | Choose cycle-backed sprints and container acceptance | CONTRACT | PF-S01-T01 | not_started |
| [PF-S01-T04](tasks/PF-S01-T04.md) | Resolve execution budget, sealed submissions and safe ownership release | CONTRACT | PF-S01-T01, PF-S01-T02 | not_started |
| [PF-S01-T05](tasks/PF-S01-T05.md) | Freeze status precedence, integrity axes and permitted actions | CONTRACT | PF-S01-T01, PF-S01-T02, PF-S01-T03, PF-S01-T04 | not_started |
| [PF-S01-T06](tasks/PF-S01-T06.md) | Freeze profiles, proof selection and independent review policy | CONTRACT | PF-S01-T02, PF-S01-T04 | not_started |
| [PF-S01-T07](tasks/PF-S01-T07.md) | Freeze dependency, reopen and override truth-preservation rules | CONTRACT | PF-S01-T02, PF-S01-T03, PF-S01-T05, PF-S01-T06 | not_started |
| [PF-S01-T08](tasks/PF-S01-T08.md) | Freeze protocol, external jobs and compatibility evolution | PROTOCOL | PF-S01-T02, PF-S01-T05, PF-S01-T06, PF-S01-T07 | not_started |
| [PF-S01-T09](tasks/PF-S01-T09.md) | Set security, resource, support and release acceptance budgets | SECURITY | PF-S01-T01, PF-S01-T02, PF-S01-T08 | not_started |
| [PF-S01-T10](tasks/PF-S01-T10.md) | Freeze source, curated memory and retained legacy parity contracts | CONTRACT | PF-S01-T01, PF-S01-T02, PF-S01-T03, PF-S01-T06 | not_started |
| [PF-S01-T11](tasks/PF-S01-T11.md) | Integrate versioned contracts, conformance oracle and plan amendment | COORD | PF-S01-T05, PF-S01-T06, PF-S01-T07, PF-S01-T08, PF-S01-T09, PF-S01-T10 | not_started |
| [PF-S01-T90](tasks/PF-S01-T90.md) | Independent sprint review and finding classification | VALIDATION | PF-S01-T01, PF-S01-T02, PF-S01-T03, PF-S01-T04, PF-S01-T05, PF-S01-T06, PF-S01-T07, PF-S01-T08, PF-S01-T09, PF-S01-T10, PF-S01-T11 | not_started |
| [PF-S01-T91](tasks/PF-S01-T91.md) | Reconcile sprint findings and integrate bounded corrections | COORD | PF-S01-T90 | not_started |
| [PF-S01-T92](tasks/PF-S01-T92.md) | Revalidate the integrated sprint and authorize successors | VALIDATION | PF-S01-T91 | not_started |

## Parallelism and integration

Dispatch one task per named agent, never this entire sprint as one assignment. Tasks with all prerequisites accepted may run together only when their actual worker write sets do not overlap. Shared root/schema/protocol/registry/release edits are serialized by the named steward; a function range in one file is not a separate write lock. Task cards list existing files versus proposed new outputs and exact integration requests. Use `python3 tools/plan.py graph-ready` and `python3 tools/plan.py conflicts TASK_A TASK_B` from this plan folder as read-only aids; neither grants authority or edits application state.

## Required sprint acceptance

- [ ] Every leaf has accepted evidence and a complete handoff at its actual integrated source revision.
- [ ] All schema/protocol/contract/root registrations are integrated; no disconnected scaffolding or test-only success path remains.
- [ ] Independent review records all findings (or explicit `no_findings`) with attributable reviewer identity.
- [ ] Reconciliation fixes every required issue or documents a justified noncritical disposition; mandatory safety/authority/proof/isolation work is nonwaivable.
- [ ] Exact-tree revalidation reruns the affected focused and required integration/native checks, preserving failures and unsupported results.
- [ ] Only `PF-S01-T92` acceptance unlocks ordinary successor sprint entry; publication and final production completion have additional explicit gates.

## Dispatch and evidence

The live coordinator ledger is [execution/STATE.json](../../execution/STATE.json); the source/evidence handoff template is [TASK_HANDOFF.md](../../templates/TASK_HANDOFF.md). Use `project/validation/production/tasks/<TASK-ID>/attempt-<N>/` for task evidence and `project/validation/production/sprints/PF-S01/` for sprint findings/reconciliation/revalidation. These are proposed execution outputs, not evidence supplied with this plan.
