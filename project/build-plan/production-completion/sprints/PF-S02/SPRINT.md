# PF-S02 — Canonical persistence, revisions and migration foundations

**State at issue:** proposed / every task unaccepted.  
**Goal:** Provide immutable requirements, explicit identities and durable outcome/recovery records with schema constraints and safe upgrades; keep policy outside SQL storage mechanics.

## Entry, leaf joins and exit

**Hard entry gate tasks:** PF-S01-T92  
**Additional cross-sprint joins on named leaves:** None beyond sprint entry gates.  
**Independent review:** `PF-S02-T90` → **reconciliation:** `PF-S02-T91` → **exit revalidation:** `PF-S02-T92`.

All entry gates must be accepted before code work in this sprint. Individual leaf prerequisites may add later joins. In particular PF-S09 may begin its independent planning foundation after PF-S02/PF-S03/PF-S04, but PF-S09-T06 cannot begin until PF-S08-T92 is accepted. This is not early sprint acceptance.

## Required context

Read [the plan entry point](../../README.md), [dispatch rules](../../execution/PARALLEL_DISPATCH.md), [shared-file locks](../../execution/SHARED_FILES.md), [the validation playbook](../../validation/VALIDATION_PLAYBOOK.md) and the selected leaf. Relevant baseline references: [R-SCHEMA2](../../reference/context/R-SCHEMA2.md), [R-SCHEMA3](../../reference/context/R-SCHEMA3.md), [R-PROFILE-GAP](../../reference/context/R-PROFILE-GAP.md), [R-MUTATION](../../reference/context/R-MUTATION.md), [R-EXPIRY-GAP](../../reference/context/R-EXPIRY-GAP.md), [R-STORE-V3](../../reference/context/R-STORE-V3.md), [R-CONCURRENCY](../../reference/context/R-CONCURRENCY.md).

**Risk to preserve:** A new table or module alone is not a working product. Old empty profiles and conflated revision/fence fields require explicit migration dispositions.

## Task-by-task execution map

| Task | Bounded outcome | Lane | Additional task prerequisites | Initial state |
| --- | --- | --- | --- | --- |
| [PF-S02-T01](tasks/PF-S02-T01.md) | Implement ordered schema migration and invariant verification | STORE | Sprint entry only | not_started |
| [PF-S02-T02](tasks/PF-S02-T02.md) | Create bounded store module seams for parallel implementation | STORE | PF-S02-T01 | not_started |
| [PF-S02-T03](tasks/PF-S02-T03.md) | Persist project, database, entity and proof revision identities | STORE | PF-S02-T02 | not_started |
| [PF-S02-T04](tasks/PF-S02-T04.md) | Persist immutable acceptance profiles and pinned requirements | STORE | PF-S02-T02, PF-S02-T03 | not_started |
| [PF-S02-T05](tasks/PF-S02-T05.md) | Persist submissions, reviews, accepted outcomes and exceptions | STORE | PF-S02-T02, PF-S02-T03, PF-S02-T04 | not_started |
| [PF-S02-T06](tasks/PF-S02-T06.md) | Persist durable recovery, resource ownership and external jobs | STORE | PF-S02-T02, PF-S02-T03 | not_started |
| [PF-S02-T07](tasks/PF-S02-T07.md) | Persist command registration, outcomes and audit atomically | STORE | PF-S02-T02, PF-S02-T03 | not_started |
| [PF-S02-T08](tasks/PF-S02-T08.md) | Implement corruption-tolerant canonical decoding and scope quarantine | STORE | PF-S02-T03, PF-S02-T04, PF-S02-T05, PF-S02-T06, PF-S02-T07 | not_started |
| [PF-S02-T09](tasks/PF-S02-T09.md) | Integrate storage invariants with fresh/upgrade/rollback tests | STORE | PF-S02-T04, PF-S02-T05, PF-S02-T06, PF-S02-T07, PF-S02-T08 | not_started |
| [PF-S02-T90](tasks/PF-S02-T90.md) | Independent sprint review and finding classification | VALIDATION | PF-S02-T01, PF-S02-T02, PF-S02-T03, PF-S02-T04, PF-S02-T05, PF-S02-T06, PF-S02-T07, PF-S02-T08, PF-S02-T09 | not_started |
| [PF-S02-T91](tasks/PF-S02-T91.md) | Reconcile sprint findings and integrate bounded corrections | COORD | PF-S02-T90 | not_started |
| [PF-S02-T92](tasks/PF-S02-T92.md) | Revalidate the integrated sprint and authorize successors | VALIDATION | PF-S02-T91 | not_started |

## Parallelism and integration

Dispatch one task per named agent, never this entire sprint as one assignment. Tasks with all prerequisites accepted may run together only when their actual worker write sets do not overlap. Shared root/schema/protocol/registry/release edits are serialized by the named steward; a function range in one file is not a separate write lock. Task cards list existing files versus proposed new outputs and exact integration requests. Use `python3 tools/plan.py graph-ready` and `python3 tools/plan.py conflicts TASK_A TASK_B` from this plan folder as read-only aids; neither grants authority or edits application state.

## Required sprint acceptance

- [ ] Every leaf has accepted evidence and a complete handoff at its actual integrated source revision.
- [ ] All schema/protocol/contract/root registrations are integrated; no disconnected scaffolding or test-only success path remains.
- [ ] Independent review records all findings (or explicit `no_findings`) with attributable reviewer identity.
- [ ] Reconciliation fixes every required issue or documents a justified noncritical disposition; mandatory safety/authority/proof/isolation work is nonwaivable.
- [ ] Exact-tree revalidation reruns the affected focused and required integration/native checks, preserving failures and unsupported results.
- [ ] Only `PF-S02-T92` acceptance unlocks ordinary successor sprint entry; publication and final production completion have additional explicit gates.

## Dispatch and evidence

The live coordinator ledger is [execution/STATE.json](../../execution/STATE.json); the source/evidence handoff template is [TASK_HANDOFF.md](../../templates/TASK_HANDOFF.md). Use `project/validation/production/tasks/<TASK-ID>/attempt-<N>/` for task evidence and `project/validation/production/sprints/PF-S02/` for sprint findings/reconciliation/revalidation. These are proposed execution outputs, not evidence supplied with this plan.
