# PF-S14 — Trusted workflows and no-goal multi-harness agent guidance

**State at issue:** proposed / every task unaccepted.  
**Goal:** Restore Boreal’s core self-guiding operating loop so an unfamiliar agent can plan, claim, prove, finish or recover using bounded trusted context rather than bespoke prompts.

## Entry, leaf joins and exit

**Hard entry gate tasks:** PF-S13-T92  
**Additional cross-sprint joins on named leaves:** None beyond sprint entry gates.  
**Independent review:** `PF-S14-T90` → **reconciliation:** `PF-S14-T91` → **exit revalidation:** `PF-S14-T92`.

All entry gates must be accepted before code work in this sprint. Individual leaf prerequisites may add later joins. In particular PF-S09 may begin its independent planning foundation after PF-S02/PF-S03/PF-S04, but PF-S09-T06 cannot begin until PF-S08-T92 is accepted. This is not early sprint acceptance.

## Required context

Read [the plan entry point](../../README.md), [dispatch rules](../../execution/PARALLEL_DISPATCH.md), [shared-file locks](../../execution/SHARED_FILES.md), [the validation playbook](../../validation/VALIDATION_PLAYBOOK.md) and the selected leaf. Relevant baseline references: [R-GUIDANCE](../../reference/context/R-GUIDANCE.md), [R-GUIDANCE-VERTICAL](../../reference/context/R-GUIDANCE-VERTICAL.md), [R-APP-GUIDANCE](../../reference/context/R-APP-GUIDANCE.md), [R-APP-WORKFLOWS](../../reference/context/R-APP-WORKFLOWS.md), [R-WORKFLOWS](../../reference/context/R-WORKFLOWS.md), [R-SKILL-MANIFEST](../../reference/context/R-SKILL-MANIFEST.md).

**Risk to preserve:** Workflow assets are guidance data, not authorization. Source text must not become shell argv or a competing persisted workflow state machine.

## Task-by-task execution map

| Task | Bounded outcome | Lane | Additional task prerequisites | Initial state |
| --- | --- | --- | --- | --- |
| [PF-S14-T01](tasks/PF-S14-T01.md) | Implement versioned workflow discovery and registry validation | WORKFLOW | Sprint entry only | not_started |
| [PF-S14-T02](tasks/PF-S14-T02.md) | Compile bounded conditional guidance from canonical actions | WORKFLOW | PF-S14-T01 | not_started |
| [PF-S14-T03](tasks/PF-S14-T03.md) | Implement trusted structured argv and instruction/data separation | WORKFLOW | PF-S14-T01, PF-S14-T02 | not_started |
| [PF-S14-T04](tasks/PF-S14-T04.md) | Connect plan/claim/resume/checkpoint/evidence/finish workflows | WORKFLOW | PF-S14-T02, PF-S14-T03 | not_started |
| [PF-S14-T05](tasks/PF-S14-T05.md) | Connect independent review, operator recovery and failure workflows | WORKFLOW | PF-S14-T02, PF-S14-T03, PF-S14-T04 | not_started |
| [PF-S14-T06](tasks/PF-S14-T06.md) | Connect cited context, memory and handoff workflows | WORKFLOW | PF-S14-T02, PF-S14-T03, PF-S14-T04 | not_started |
| [PF-S14-T07](tasks/PF-S14-T07.md) | Validate unfamiliar-agent workflows across two actual harnesses | VALIDATION | PF-S14-T04, PF-S14-T05, PF-S14-T06 | not_started |
| [PF-S14-T08](tasks/PF-S14-T08.md) | Validate workflow package identity and close parity gaps | WORKFLOW | PF-S14-T07 | not_started |
| [PF-S14-T90](tasks/PF-S14-T90.md) | Independent sprint review and finding classification | VALIDATION | PF-S14-T01, PF-S14-T02, PF-S14-T03, PF-S14-T04, PF-S14-T05, PF-S14-T06, PF-S14-T07, PF-S14-T08 | not_started |
| [PF-S14-T91](tasks/PF-S14-T91.md) | Reconcile sprint findings and integrate bounded corrections | COORD | PF-S14-T90 | not_started |
| [PF-S14-T92](tasks/PF-S14-T92.md) | Revalidate the integrated sprint and authorize successors | VALIDATION | PF-S14-T91 | not_started |

## Parallelism and integration

Dispatch one task per named agent, never this entire sprint as one assignment. Tasks with all prerequisites accepted may run together only when their actual worker write sets do not overlap. Shared root/schema/protocol/registry/release edits are serialized by the named steward; a function range in one file is not a separate write lock. Task cards list existing files versus proposed new outputs and exact integration requests. Use `python3 tools/plan.py graph-ready` and `python3 tools/plan.py conflicts TASK_A TASK_B` from this plan folder as read-only aids; neither grants authority or edits application state.

## Required sprint acceptance

- [ ] Every leaf has accepted evidence and a complete handoff at its actual integrated source revision.
- [ ] All schema/protocol/contract/root registrations are integrated; no disconnected scaffolding or test-only success path remains.
- [ ] Independent review records all findings (or explicit `no_findings`) with attributable reviewer identity.
- [ ] Reconciliation fixes every required issue or documents a justified noncritical disposition; mandatory safety/authority/proof/isolation work is nonwaivable.
- [ ] Exact-tree revalidation reruns the affected focused and required integration/native checks, preserving failures and unsupported results.
- [ ] Only `PF-S14-T92` acceptance unlocks ordinary successor sprint entry; publication and final production completion have additional explicit gates.

## Dispatch and evidence

The live coordinator ledger is [execution/STATE.json](../../execution/STATE.json); the source/evidence handoff template is [TASK_HANDOFF.md](../../templates/TASK_HANDOFF.md). Use `project/validation/production/tasks/<TASK-ID>/attempt-<N>/` for task evidence and `project/validation/production/sprints/PF-S14/` for sprint findings/reconciliation/revalidation. These are proposed execution outputs, not evidence supplied with this plan.
