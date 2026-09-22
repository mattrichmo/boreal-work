# PF-S03 — One deterministic domain decision and action model

**State at issue:** proposed / every task unaccepted.  
**Goal:** Make status, reasons, timers, dependency truth and actor-specific actions deterministic over canonical facts, without conflating execution, integrity and service availability.

## Entry, leaf joins and exit

**Hard entry gate tasks:** PF-S01-T92  
**Additional cross-sprint joins on named leaves:** None beyond sprint entry gates.  
**Independent review:** `PF-S03-T90` → **reconciliation:** `PF-S03-T91` → **exit revalidation:** `PF-S03-T92`.

All entry gates must be accepted before code work in this sprint. Individual leaf prerequisites may add later joins. In particular PF-S09 may begin its independent planning foundation after PF-S02/PF-S03/PF-S04, but PF-S09-T06 cannot begin until PF-S08-T92 is accepted. This is not early sprint acceptance.

## Required context

Read [the plan entry point](../../README.md), [dispatch rules](../../execution/PARALLEL_DISPATCH.md), [shared-file locks](../../execution/SHARED_FILES.md), [the validation playbook](../../validation/VALIDATION_PLAYBOOK.md) and the selected leaf. Relevant baseline references: [R-DOMAIN](../../reference/context/R-DOMAIN.md), [R-EVALUATOR](../../reference/context/R-EVALUATOR.md), [R-DOMAIN-V3](../../reference/context/R-DOMAIN-V3.md), [R-STATUS](../../reference/context/R-STATUS.md), [R-TRANSITIONS](../../reference/context/R-TRANSITIONS.md), [R-DECISIONS](../../reference/context/R-DECISIONS.md).

**Risk to preserve:** The existing evaluator is a candidate, not acceptance. A correct pure decision cannot compensate for a store snapshot that omitted required facts.

## Task-by-task execution map

| Task | Bounded outcome | Lane | Additional task prerequisites | Initial state |
| --- | --- | --- | --- | --- |
| [PF-S03-T01](tasks/PF-S03-T01.md) | Introduce typed decision inputs and proof-relevant identities | DOMAIN | Sprint entry only | not_started |
| [PF-S03-T02](tasks/PF-S03-T02.md) | Implement exhaustive status precedence and reason ordering | DOMAIN | PF-S03-T01 | not_started |
| [PF-S03-T03](tasks/PF-S03-T03.md) | Implement exact clock, schedule, retry and expiry predicates | DOMAIN | PF-S03-T01, PF-S03-T02 | not_started |
| [PF-S03-T04](tasks/PF-S03-T04.md) | Implement requirement, evidence and review interpretation | DOMAIN | PF-S03-T01 | not_started |
| [PF-S03-T05](tasks/PF-S03-T05.md) | Implement dependency satisfaction, graph and reopen impact rules | DOMAIN | PF-S03-T01, PF-S03-T04 | not_started |
| [PF-S03-T06](tasks/PF-S03-T06.md) | Implement explicit authorization and allowed-action decisions | DOMAIN | PF-S03-T01, PF-S03-T02, PF-S03-T03, PF-S03-T04, PF-S03-T05 | not_started |
| [PF-S03-T07](tasks/PF-S03-T07.md) | Implement container scope and cycle rollup primitives | DOMAIN | PF-S03-T01, PF-S03-T04, PF-S03-T05 | not_started |
| [PF-S03-T08](tasks/PF-S03-T08.md) | Add property, differential and exhaustive transition tests | VALIDATION | PF-S03-T02, PF-S03-T03, PF-S03-T04, PF-S03-T05, PF-S03-T06, PF-S03-T07 | not_started |
| [PF-S03-T09](tasks/PF-S03-T09.md) | Integrate one public domain decision API and remove duplicate policy | DOMAIN | PF-S03-T08 | not_started |
| [PF-S03-T90](tasks/PF-S03-T90.md) | Independent sprint review and finding classification | VALIDATION | PF-S03-T01, PF-S03-T02, PF-S03-T03, PF-S03-T04, PF-S03-T05, PF-S03-T06, PF-S03-T07, PF-S03-T08, PF-S03-T09 | not_started |
| [PF-S03-T91](tasks/PF-S03-T91.md) | Reconcile sprint findings and integrate bounded corrections | COORD | PF-S03-T90 | not_started |
| [PF-S03-T92](tasks/PF-S03-T92.md) | Revalidate the integrated sprint and authorize successors | VALIDATION | PF-S03-T91 | not_started |

## Parallelism and integration

Dispatch one task per named agent, never this entire sprint as one assignment. Tasks with all prerequisites accepted may run together only when their actual worker write sets do not overlap. Shared root/schema/protocol/registry/release edits are serialized by the named steward; a function range in one file is not a separate write lock. Task cards list existing files versus proposed new outputs and exact integration requests. Use `python3 tools/plan.py graph-ready` and `python3 tools/plan.py conflicts TASK_A TASK_B` from this plan folder as read-only aids; neither grants authority or edits application state.

## Required sprint acceptance

- [ ] Every leaf has accepted evidence and a complete handoff at its actual integrated source revision.
- [ ] All schema/protocol/contract/root registrations are integrated; no disconnected scaffolding or test-only success path remains.
- [ ] Independent review records all findings (or explicit `no_findings`) with attributable reviewer identity.
- [ ] Reconciliation fixes every required issue or documents a justified noncritical disposition; mandatory safety/authority/proof/isolation work is nonwaivable.
- [ ] Exact-tree revalidation reruns the affected focused and required integration/native checks, preserving failures and unsupported results.
- [ ] Only `PF-S03-T92` acceptance unlocks ordinary successor sprint entry; publication and final production completion have additional explicit gates.

## Dispatch and evidence

The live coordinator ledger is [execution/STATE.json](../../execution/STATE.json); the source/evidence handoff template is [TASK_HANDOFF.md](../../templates/TASK_HANDOFF.md). Use `project/validation/production/tasks/<TASK-ID>/attempt-<N>/` for task evidence and `project/validation/production/sprints/PF-S03/` for sprint findings/reconciliation/revalidation. These are proposed execution outputs, not evidence supplied with this plan.
