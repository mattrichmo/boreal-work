# PF-S05 — Versioned service, durable operations and snapshot plumbing

**State at issue:** proposed / every task unaccepted.  
**Goal:** Expose the canonical Rust decision and transaction model through one authenticated, bounded service contract with replay/readback and consistent notifications.

## Entry, leaf joins and exit

**Hard entry gate tasks:** PF-S02-T92, PF-S03-T92, PF-S04-T92  
**Additional cross-sprint joins on named leaves:** None beyond sprint entry gates.  
**Independent review:** `PF-S05-T90` → **reconciliation:** `PF-S05-T91` → **exit revalidation:** `PF-S05-T92`.

All entry gates must be accepted before code work in this sprint. Individual leaf prerequisites may add later joins. In particular PF-S09 may begin its independent planning foundation after PF-S02/PF-S03/PF-S04, but PF-S09-T06 cannot begin until PF-S08-T92 is accepted. This is not early sprint acceptance.

## Required context

Read [the plan entry point](../../README.md), [dispatch rules](../../execution/PARALLEL_DISPATCH.md), [shared-file locks](../../execution/SHARED_FILES.md), [the validation playbook](../../validation/VALIDATION_PLAYBOOK.md) and the selected leaf. Relevant baseline references: [R-PROTOCOL](../../reference/context/R-PROTOCOL.md), [R-PROTOCOL-CODE](../../reference/context/R-PROTOCOL-CODE.md), [R-ERRORS](../../reference/context/R-ERRORS.md), [R-SERVICE-HOST](../../reference/context/R-SERVICE-HOST.md), [R-SERVICE-TRANSPORT](../../reference/context/R-SERVICE-TRANSPORT.md), [R-APP-OP](../../reference/context/R-APP-OP.md), [R-APP-STATUS](../../reference/context/R-APP-STATUS.md).

**Risk to preserve:** Transport success is not mutation success. Unknown operations, cursor gaps and cached actor context must not let clients invent outcomes or policy.

## Task-by-task execution map

| Task | Bounded outcome | Lane | Additional task prerequisites | Initial state |
| --- | --- | --- | --- | --- |
| [PF-S05-T01](tasks/PF-S05-T01.md) | Implement version negotiation and typed command/query envelopes | PROTOCOL | Sprint entry only | not_started |
| [PF-S05-T02](tasks/PF-S05-T02.md) | Implement one application command executor and transaction contract | APPLICATION | PF-S05-T01 | not_started |
| [PF-S05-T03](tasks/PF-S05-T03.md) | Implement request admission, idempotency and definitive readback | SERVICE | PF-S05-T01, PF-S05-T02 | not_started |
| [PF-S05-T04](tasks/PF-S05-T04.md) | Integrate production service host and single-writer queue | SERVICE | PF-S05-T01, PF-S05-T02, PF-S05-T03 | not_started |
| [PF-S05-T05](tasks/PF-S05-T05.md) | Assemble canonical reads and server-owned action descriptors | APPLICATION | PF-S05-T01, PF-S05-T02 | not_started |
| [PF-S05-T06](tasks/PF-S05-T06.md) | Implement revision-consistent pagination and subscription recovery | SERVICE | PF-S05-T01, PF-S05-T04, PF-S05-T05 | not_started |
| [PF-S05-T07](tasks/PF-S05-T07.md) | Implement durable external-job scheduling and readback hooks | SERVICE | PF-S05-T02, PF-S05-T03, PF-S05-T04 | not_started |
| [PF-S05-T08](tasks/PF-S05-T08.md) | Add genuine service harness and negative proof controls | VALIDATION | PF-S05-T01, PF-S05-T03, PF-S05-T04, PF-S05-T05, PF-S05-T06, PF-S05-T07 | not_started |
| [PF-S05-T09](tasks/PF-S05-T09.md) | Integrate and test all service/direct/maintenance adapter boundaries | APPLICATION | PF-S05-T08 | not_started |
| [PF-S05-T90](tasks/PF-S05-T90.md) | Independent sprint review and finding classification | VALIDATION | PF-S05-T01, PF-S05-T02, PF-S05-T03, PF-S05-T04, PF-S05-T05, PF-S05-T06, PF-S05-T07, PF-S05-T08, PF-S05-T09 | not_started |
| [PF-S05-T91](tasks/PF-S05-T91.md) | Reconcile sprint findings and integrate bounded corrections | COORD | PF-S05-T90 | not_started |
| [PF-S05-T92](tasks/PF-S05-T92.md) | Revalidate the integrated sprint and authorize successors | VALIDATION | PF-S05-T91 | not_started |

## Parallelism and integration

Dispatch one task per named agent, never this entire sprint as one assignment. Tasks with all prerequisites accepted may run together only when their actual worker write sets do not overlap. Shared root/schema/protocol/registry/release edits are serialized by the named steward; a function range in one file is not a separate write lock. Task cards list existing files versus proposed new outputs and exact integration requests. Use `python3 tools/plan.py graph-ready` and `python3 tools/plan.py conflicts TASK_A TASK_B` from this plan folder as read-only aids; neither grants authority or edits application state.

## Required sprint acceptance

- [ ] Every leaf has accepted evidence and a complete handoff at its actual integrated source revision.
- [ ] All schema/protocol/contract/root registrations are integrated; no disconnected scaffolding or test-only success path remains.
- [ ] Independent review records all findings (or explicit `no_findings`) with attributable reviewer identity.
- [ ] Reconciliation fixes every required issue or documents a justified noncritical disposition; mandatory safety/authority/proof/isolation work is nonwaivable.
- [ ] Exact-tree revalidation reruns the affected focused and required integration/native checks, preserving failures and unsupported results.
- [ ] Only `PF-S05-T92` acceptance unlocks ordinary successor sprint entry; publication and final production completion have additional explicit gates.

## Dispatch and evidence

The live coordinator ledger is [execution/STATE.json](../../execution/STATE.json); the source/evidence handoff template is [TASK_HANDOFF.md](../../templates/TASK_HANDOFF.md). Use `project/validation/production/tasks/<TASK-ID>/attempt-<N>/` for task evidence and `project/validation/production/sprints/PF-S05/` for sprint findings/reconciliation/revalidation. These are proposed execution outputs, not evidence supplied with this plan.
