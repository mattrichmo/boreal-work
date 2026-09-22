# PF-S11 — Versioned sources, curated memory and recoverable handoff

**State at issue:** proposed / every task unaccepted.  
**Goal:** Complete the launch source/memory workflow with trustworthy citations, project-local retrieval, Git publication recovery and useful revision-bound handoffs.

## Entry, leaf joins and exit

**Hard entry gate tasks:** PF-S05-T92, PF-S07-T92  
**Additional cross-sprint joins on named leaves:** None beyond sprint entry gates.  
**Independent review:** `PF-S11-T90` → **reconciliation:** `PF-S11-T91` → **exit revalidation:** `PF-S11-T92`.

All entry gates must be accepted before code work in this sprint. Individual leaf prerequisites may add later joins. In particular PF-S09 may begin its independent planning foundation after PF-S02/PF-S03/PF-S04, but PF-S09-T06 cannot begin until PF-S08-T92 is accepted. This is not early sprint acceptance.

## Required context

Read [the plan entry point](../../README.md), [dispatch rules](../../execution/PARALLEL_DISPATCH.md), [shared-file locks](../../execution/SHARED_FILES.md), [the validation playbook](../../validation/VALIDATION_PLAYBOOK.md) and the selected leaf. Relevant baseline references: [R-SOURCE-DOC](../../reference/context/R-SOURCE-DOC.md), [R-MEMORY-DOC](../../reference/context/R-MEMORY-DOC.md), [R-SOURCE-CODE](../../reference/context/R-SOURCE-CODE.md), [R-MEMORY-CODE](../../reference/context/R-MEMORY-CODE.md), [R-APP-KNOWLEDGE](../../reference/context/R-APP-KNOWLEDGE.md), [R-DECISIONS](../../reference/context/R-DECISIONS.md).

**Risk to preserve:** Source content is untrusted data, indexes are derived, and Git publication cannot be one atomic transaction with SQLite. Memory must not become an alternate work authority.

## Task-by-task execution map

| Task | Bounded outcome | Lane | Additional task prerequisites | Initial state |
| --- | --- | --- | --- | --- |
| [PF-S11-T01](tasks/PF-S11-T01.md) | Complete supported source intake and immutable versioning | SOURCE | Sprint entry only | not_started |
| [PF-S11-T02](tasks/PF-S11-T02.md) | Implement stable citation locators and content verification | SOURCE | PF-S11-T01 | not_started |
| [PF-S11-T03](tasks/PF-S11-T03.md) | Implement project-scoped search and rebuildable indexes | SOURCE | PF-S11-T01, PF-S11-T02 | not_started |
| [PF-S11-T04](tasks/PF-S11-T04.md) | Implement live notes, memory drafts and publication authority | MEMORY | PF-S11-T01, PF-S11-T02 | not_started |
| [PF-S11-T05](tasks/PF-S11-T05.md) | Implement recoverable Git publication and commit readback | MEMORY | PF-S11-T03, PF-S11-T04 | not_started |
| [PF-S11-T06](tasks/PF-S11-T06.md) | Implement reimport, fresh-clone reconciliation and doctor checks | MEMORY | PF-S11-T05 | not_started |
| [PF-S11-T07](tasks/PF-S11-T07.md) | Implement revision-bound handoff and bounded context bundles | APPLICATION | PF-S11-T02, PF-S11-T03, PF-S11-T04, PF-S11-T05, PF-S11-T06 | not_started |
| [PF-S11-T08](tasks/PF-S11-T08.md) | Implement artifact retention roots and safe garbage-collection planning | STORE | PF-S11-T01, PF-S11-T02, PF-S11-T05, PF-S11-T06 | not_started |
| [PF-S11-T09](tasks/PF-S11-T09.md) | Validate source-memory-handoff recovery through the real service | VALIDATION | PF-S11-T07, PF-S11-T08 | not_started |
| [PF-S11-T90](tasks/PF-S11-T90.md) | Independent sprint review and finding classification | VALIDATION | PF-S11-T01, PF-S11-T02, PF-S11-T03, PF-S11-T04, PF-S11-T05, PF-S11-T06, PF-S11-T07, PF-S11-T08, PF-S11-T09 | not_started |
| [PF-S11-T91](tasks/PF-S11-T91.md) | Reconcile sprint findings and integrate bounded corrections | COORD | PF-S11-T90 | not_started |
| [PF-S11-T92](tasks/PF-S11-T92.md) | Revalidate the integrated sprint and authorize successors | VALIDATION | PF-S11-T91 | not_started |

## Parallelism and integration

Dispatch one task per named agent, never this entire sprint as one assignment. Tasks with all prerequisites accepted may run together only when their actual worker write sets do not overlap. Shared root/schema/protocol/registry/release edits are serialized by the named steward; a function range in one file is not a separate write lock. Task cards list existing files versus proposed new outputs and exact integration requests. Use `python3 tools/plan.py graph-ready` and `python3 tools/plan.py conflicts TASK_A TASK_B` from this plan folder as read-only aids; neither grants authority or edits application state.

## Required sprint acceptance

- [ ] Every leaf has accepted evidence and a complete handoff at its actual integrated source revision.
- [ ] All schema/protocol/contract/root registrations are integrated; no disconnected scaffolding or test-only success path remains.
- [ ] Independent review records all findings (or explicit `no_findings`) with attributable reviewer identity.
- [ ] Reconciliation fixes every required issue or documents a justified noncritical disposition; mandatory safety/authority/proof/isolation work is nonwaivable.
- [ ] Exact-tree revalidation reruns the affected focused and required integration/native checks, preserving failures and unsupported results.
- [ ] Only `PF-S11-T92` acceptance unlocks ordinary successor sprint entry; publication and final production completion have additional explicit gates.

## Dispatch and evidence

The live coordinator ledger is [execution/STATE.json](../../execution/STATE.json); the source/evidence handoff template is [TASK_HANDOFF.md](../../templates/TASK_HANDOFF.md). Use `project/validation/production/tasks/<TASK-ID>/attempt-<N>/` for task evidence and `project/validation/production/sprints/PF-S11/` for sprint findings/reconciliation/revalidation. These are proposed execution outputs, not evidence supplied with this plan.
