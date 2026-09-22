# PF-S16 — Integrated real-service product conformance

**State at issue:** proposed / every task unaccepted.  
**Goal:** Demonstrate the complete cross-component product on one integrated source identity using genuine operations, proof and review—not feature-local or fixture-only success.

## Entry, leaf joins and exit

**Hard entry gate tasks:** PF-S14-T92, PF-S15-T92  
**Additional cross-sprint joins on named leaves:** None beyond sprint entry gates.  
**Independent review:** `PF-S16-T90` → **reconciliation:** `PF-S16-T91` → **exit revalidation:** `PF-S16-T92`.

All entry gates must be accepted before code work in this sprint. Individual leaf prerequisites may add later joins. In particular PF-S09 may begin its independent planning foundation after PF-S02/PF-S03/PF-S04, but PF-S09-T06 cannot begin until PF-S08-T92 is accepted. This is not early sprint acceptance.

## Required context

Read [the plan entry point](../../README.md), [dispatch rules](../../execution/PARALLEL_DISPATCH.md), [shared-file locks](../../execution/SHARED_FILES.md), [the validation playbook](../../validation/VALIDATION_PLAYBOOK.md) and the selected leaf. Relevant baseline references: [R-M02](../../reference/context/R-M02.md), [R-FULL-SUITE](../../reference/context/R-FULL-SUITE.md), [R-GUIDANCE-VERTICAL](../../reference/context/R-GUIDANCE-VERTICAL.md), [R-TUI-SMOKE](../../reference/context/R-TUI-SMOKE.md), [R-GATES](../../reference/context/R-GATES.md).

**Risk to preserve:** A prior focused pass is input evidence, not acceptance of a changed combined tree. Owned corrupt-data setup is allowed only for negative tests, never to seed successful proof.

## Task-by-task execution map

| Task | Bounded outcome | Lane | Additional task prerequisites | Initial state |
| --- | --- | --- | --- | --- |
| [PF-S16-T01](tasks/PF-S16-T01.md) | Freeze the integrated scenario graph and evidence harness | VALIDATION | Sprint entry only | not_started |
| [PF-S16-T02](tasks/PF-S16-T02.md) | Prove project init to parallel plan to accepted closeout | VALIDATION | PF-S16-T01 | not_started |
| [PF-S16-T03](tasks/PF-S16-T03.md) | Prove every status, secondary reason and action combination | VALIDATION | PF-S16-T01 | not_started |
| [PF-S16-T04](tasks/PF-S16-T04.md) | Prove multi-agent planning/execution/acceptance race safety | VALIDATION | PF-S16-T01 | not_started |
| [PF-S16-T05](tasks/PF-S16-T05.md) | Prove unknown outcomes and partial external-operation recovery | VALIDATION | PF-S16-T01 | not_started |
| [PF-S16-T06](tasks/PF-S16-T06.md) | Prove isolation across every public and cached surface | VALIDATION | PF-S16-T01 | not_started |
| [PF-S16-T07](tasks/PF-S16-T07.md) | Prove migration, corrupted-record recovery and full restore integration | VALIDATION | PF-S16-T01 | not_started |
| [PF-S16-T08](tasks/PF-S16-T08.md) | Prove no-goal agent and mounted-terminal cross-surface workflows | VALIDATION | PF-S16-T01, PF-S16-T02, PF-S16-T03, PF-S16-T05 | not_started |
| [PF-S16-T09](tasks/PF-S16-T09.md) | Reconcile all integration evidence and original acceptance obligations | VALIDATION | PF-S16-T02, PF-S16-T03, PF-S16-T04, PF-S16-T05, PF-S16-T06, PF-S16-T07, PF-S16-T08 | not_started |
| [PF-S16-T90](tasks/PF-S16-T90.md) | Independent sprint review and finding classification | VALIDATION | PF-S16-T01, PF-S16-T02, PF-S16-T03, PF-S16-T04, PF-S16-T05, PF-S16-T06, PF-S16-T07, PF-S16-T08, PF-S16-T09 | not_started |
| [PF-S16-T91](tasks/PF-S16-T91.md) | Reconcile sprint findings and integrate bounded corrections | COORD | PF-S16-T90 | not_started |
| [PF-S16-T92](tasks/PF-S16-T92.md) | Revalidate the integrated sprint and authorize successors | VALIDATION | PF-S16-T91 | not_started |

## Parallelism and integration

Dispatch one task per named agent, never this entire sprint as one assignment. Tasks with all prerequisites accepted may run together only when their actual worker write sets do not overlap. Shared root/schema/protocol/registry/release edits are serialized by the named steward; a function range in one file is not a separate write lock. Task cards list existing files versus proposed new outputs and exact integration requests. Use `python3 tools/plan.py graph-ready` and `python3 tools/plan.py conflicts TASK_A TASK_B` from this plan folder as read-only aids; neither grants authority or edits application state.

## Required sprint acceptance

- [ ] Every leaf has accepted evidence and a complete handoff at its actual integrated source revision.
- [ ] All schema/protocol/contract/root registrations are integrated; no disconnected scaffolding or test-only success path remains.
- [ ] Independent review records all findings (or explicit `no_findings`) with attributable reviewer identity.
- [ ] Reconciliation fixes every required issue or documents a justified noncritical disposition; mandatory safety/authority/proof/isolation work is nonwaivable.
- [ ] Exact-tree revalidation reruns the affected focused and required integration/native checks, preserving failures and unsupported results.
- [ ] Only `PF-S16-T92` acceptance unlocks ordinary successor sprint entry; publication and final production completion have additional explicit gates.

## Dispatch and evidence

The live coordinator ledger is [execution/STATE.json](../../execution/STATE.json); the source/evidence handoff template is [TASK_HANDOFF.md](../../templates/TASK_HANDOFF.md). Use `project/validation/production/tasks/<TASK-ID>/attempt-<N>/` for task evidence and `project/validation/production/sprints/PF-S16/` for sprint findings/reconciliation/revalidation. These are proposed execution outputs, not evidence supplied with this plan.
