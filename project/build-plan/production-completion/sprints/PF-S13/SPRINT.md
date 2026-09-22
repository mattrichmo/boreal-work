# PF-S13 — Complete human and machine CLI/service parity

**State at issue:** proposed / every task unaccepted.  
**Goal:** Make every accepted planning, execution, proof, review, recovery, knowledge and maintenance capability discoverable through thin supported public adapters.

## Entry, leaf joins and exit

**Hard entry gate tasks:** PF-S10-T92, PF-S12-T92  
**Additional cross-sprint joins on named leaves:** None beyond sprint entry gates.  
**Independent review:** `PF-S13-T90` → **reconciliation:** `PF-S13-T91` → **exit revalidation:** `PF-S13-T92`.

All entry gates must be accepted before code work in this sprint. Individual leaf prerequisites may add later joins. In particular PF-S09 may begin its independent planning foundation after PF-S02/PF-S03/PF-S04, but PF-S09-T06 cannot begin until PF-S08-T92 is accepted. This is not early sprint acceptance.

## Required context

Read [the plan entry point](../../README.md), [dispatch rules](../../execution/PARALLEL_DISPATCH.md), [shared-file locks](../../execution/SHARED_FILES.md), [the validation playbook](../../validation/VALIDATION_PLAYBOOK.md) and the selected leaf. Relevant baseline references: [R-CLI](../../reference/context/R-CLI.md), [R-COMMAND-REGISTRY](../../reference/context/R-COMMAND-REGISTRY.md), [R-CLI-MAIN](../../reference/context/R-CLI-MAIN.md), [R-CLI-SERVICE](../../reference/context/R-CLI-SERVICE.md), [R-PARITY](../../reference/context/R-PARITY.md), [R-UPDATE](../../reference/context/R-UPDATE.md), [R-ERRORS](../../reference/context/R-ERRORS.md).

**Risk to preserve:** A registered command without full behavior is not parity; parser validation and human formatting cannot become a second policy engine.

## Task-by-task execution map

| Task | Bounded outcome | Lane | Additional task prerequisites | Initial state |
| --- | --- | --- | --- | --- |
| [PF-S13-T01](tasks/PF-S13-T01.md) | Reconcile the public command registry and compatibility aliases | CLI | Sprint entry only | not_started |
| [PF-S13-T02](tasks/PF-S13-T02.md) | Implement project, identity and actor/session public commands | CLI | PF-S13-T01 | not_started |
| [PF-S13-T03](tasks/PF-S13-T03.md) | Implement milestone, sprint/cycle and work planning commands | CLI | PF-S13-T01, PF-S13-T02 | not_started |
| [PF-S13-T04](tasks/PF-S13-T04.md) | Implement work queues, attention, status and history commands | CLI | PF-S13-T01, PF-S13-T02 | not_started |
| [PF-S13-T05](tasks/PF-S13-T05.md) | Implement consolidated agent execution and finish/release commands | CLI | PF-S13-T01, PF-S13-T02 | not_started |
| [PF-S13-T06](tasks/PF-S13-T06.md) | Implement evidence, review and explicit operator commands | CLI | PF-S13-T01, PF-S13-T02 | not_started |
| [PF-S13-T07](tasks/PF-S13-T07.md) | Implement source, memory, handoff and maintenance commands | CLI | PF-S13-T01, PF-S13-T02 | not_started |
| [PF-S13-T08](tasks/PF-S13-T08.md) | Standardize machine envelopes, exit codes, help and operation readback | CLI | PF-S13-T03, PF-S13-T04, PF-S13-T05, PF-S13-T06, PF-S13-T07 | not_started |
| [PF-S13-T09](tasks/PF-S13-T09.md) | Run complete CLI-to-service parity and alias tests | VALIDATION | PF-S13-T08 | not_started |
| [PF-S13-T10](tasks/PF-S13-T10.md) | Integrate public contract and consumer handoff | CLI | PF-S13-T09 | not_started |
| [PF-S13-T90](tasks/PF-S13-T90.md) | Independent sprint review and finding classification | VALIDATION | PF-S13-T01, PF-S13-T02, PF-S13-T03, PF-S13-T04, PF-S13-T05, PF-S13-T06, PF-S13-T07, PF-S13-T08, PF-S13-T09, PF-S13-T10 | not_started |
| [PF-S13-T91](tasks/PF-S13-T91.md) | Reconcile sprint findings and integrate bounded corrections | COORD | PF-S13-T90 | not_started |
| [PF-S13-T92](tasks/PF-S13-T92.md) | Revalidate the integrated sprint and authorize successors | VALIDATION | PF-S13-T91 | not_started |

## Parallelism and integration

Dispatch one task per named agent, never this entire sprint as one assignment. Tasks with all prerequisites accepted may run together only when their actual worker write sets do not overlap. Shared root/schema/protocol/registry/release edits are serialized by the named steward; a function range in one file is not a separate write lock. Task cards list existing files versus proposed new outputs and exact integration requests. Use `python3 tools/plan.py graph-ready` and `python3 tools/plan.py conflicts TASK_A TASK_B` from this plan folder as read-only aids; neither grants authority or edits application state.

## Required sprint acceptance

- [ ] Every leaf has accepted evidence and a complete handoff at its actual integrated source revision.
- [ ] All schema/protocol/contract/root registrations are integrated; no disconnected scaffolding or test-only success path remains.
- [ ] Independent review records all findings (or explicit `no_findings`) with attributable reviewer identity.
- [ ] Reconciliation fixes every required issue or documents a justified noncritical disposition; mandatory safety/authority/proof/isolation work is nonwaivable.
- [ ] Exact-tree revalidation reruns the affected focused and required integration/native checks, preserving failures and unsupported results.
- [ ] Only `PF-S13-T92` acceptance unlocks ordinary successor sprint entry; publication and final production completion have additional explicit gates.

## Dispatch and evidence

The live coordinator ledger is [execution/STATE.json](../../execution/STATE.json); the source/evidence handoff template is [TASK_HANDOFF.md](../../templates/TASK_HANDOFF.md). Use `project/validation/production/tasks/<TASK-ID>/attempt-<N>/` for task evidence and `project/validation/production/sprints/PF-S13/` for sprint findings/reconciliation/revalidation. These are proposed execution outputs, not evidence supplied with this plan.
