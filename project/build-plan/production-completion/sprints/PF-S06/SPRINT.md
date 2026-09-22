# PF-S06 — Fenced multi-agent execution, leases and safe recovery

**State at issue:** proposed / every task unaccepted.  
**Goal:** Deliver one real ownership lifecycle with physical resource safety, exact deadlines, explicit recovery obligations and harness-neutral adoption.

## Entry, leaf joins and exit

**Hard entry gate tasks:** PF-S05-T92  
**Additional cross-sprint joins on named leaves:** None beyond sprint entry gates.  
**Independent review:** `PF-S06-T90` → **reconciliation:** `PF-S06-T91` → **exit revalidation:** `PF-S06-T92`.

All entry gates must be accepted before code work in this sprint. Individual leaf prerequisites may add later joins. In particular PF-S09 may begin its independent planning foundation after PF-S02/PF-S03/PF-S04, but PF-S09-T06 cannot begin until PF-S08-T92 is accepted. This is not early sprint acceptance.

## Required context

Read [the plan entry point](../../README.md), [dispatch rules](../../execution/PARALLEL_DISPATCH.md), [shared-file locks](../../execution/SHARED_FILES.md), [the validation playbook](../../validation/VALIDATION_PLAYBOOK.md) and the selected leaf. Relevant baseline references: [R-LIFECYCLE](../../reference/context/R-LIFECYCLE.md), [R-DECISIONS](../../reference/context/R-DECISIONS.md), [R-APP-RUNTIME](../../reference/context/R-APP-RUNTIME.md), [R-EXPIRY-GAP](../../reference/context/R-EXPIRY-GAP.md), [R-SERVICE-RECOVERY](../../reference/context/R-SERVICE-RECOVERY.md), [R-CONCURRENCY](../../reference/context/R-CONCURRENCY.md).

**Risk to preserve:** A database fence does not stop a process editing a shared worktree. Safe reassignment needs verified stop/resource disposition, not simply clearing current_attempt.

## Task-by-task execution map

| Task | Bounded outcome | Lane | Additional task prerequisites | Initial state |
| --- | --- | --- | --- | --- |
| [PF-S06-T01](tasks/PF-S06-T01.md) | Implement transactional claim and accepted execution context | APPLICATION | Sprint entry only | not_started |
| [PF-S06-T02](tasks/PF-S06-T02.md) | Implement accept/start and session-bound runtime identity | APPLICATION | PF-S06-T01 | not_started |
| [PF-S06-T03](tasks/PF-S06-T03.md) | Implement worktree/resource reservation and safe adoption | APPLICATION | PF-S06-T01, PF-S06-T02 | not_started |
| [PF-S06-T04](tasks/PF-S06-T04.md) | Implement heartbeat and durable checkpoint semantics | APPLICATION | PF-S06-T02, PF-S06-T03 | not_started |
| [PF-S06-T05](tasks/PF-S06-T05.md) | Implement exact expiry and durable unresolved disposition | APPLICATION | PF-S06-T02, PF-S06-T03, PF-S06-T04 | not_started |
| [PF-S06-T06](tasks/PF-S06-T06.md) | Implement stop requests and confirmed assignment release | APPLICATION | PF-S06-T03, PF-S06-T05 | not_started |
| [PF-S06-T07](tasks/PF-S06-T07.md) | Implement failure classification, bounded retry and operator recovery | APPLICATION | PF-S06-T05, PF-S06-T06 | not_started |
| [PF-S06-T08](tasks/PF-S06-T08.md) | Reconcile live attempts, jobs and ownership after service restart | SERVICE | PF-S06-T04, PF-S06-T05, PF-S06-T06, PF-S06-T07 | not_started |
| [PF-S06-T09](tasks/PF-S06-T09.md) | Run execution races, deadline boundaries and physical-stop validation | VALIDATION | PF-S06-T07, PF-S06-T08 | not_started |
| [PF-S06-T10](tasks/PF-S06-T10.md) | Integrate execution policy with status, actions and service routes | APPLICATION | PF-S06-T09 | not_started |
| [PF-S06-T90](tasks/PF-S06-T90.md) | Independent sprint review and finding classification | VALIDATION | PF-S06-T01, PF-S06-T02, PF-S06-T03, PF-S06-T04, PF-S06-T05, PF-S06-T06, PF-S06-T07, PF-S06-T08, PF-S06-T09, PF-S06-T10 | not_started |
| [PF-S06-T91](tasks/PF-S06-T91.md) | Reconcile sprint findings and integrate bounded corrections | COORD | PF-S06-T90 | not_started |
| [PF-S06-T92](tasks/PF-S06-T92.md) | Revalidate the integrated sprint and authorize successors | VALIDATION | PF-S06-T91 | not_started |

## Parallelism and integration

Dispatch one task per named agent, never this entire sprint as one assignment. Tasks with all prerequisites accepted may run together only when their actual worker write sets do not overlap. Shared root/schema/protocol/registry/release edits are serialized by the named steward; a function range in one file is not a separate write lock. Task cards list existing files versus proposed new outputs and exact integration requests. Use `python3 tools/plan.py graph-ready` and `python3 tools/plan.py conflicts TASK_A TASK_B` from this plan folder as read-only aids; neither grants authority or edits application state.

## Required sprint acceptance

- [ ] Every leaf has accepted evidence and a complete handoff at its actual integrated source revision.
- [ ] All schema/protocol/contract/root registrations are integrated; no disconnected scaffolding or test-only success path remains.
- [ ] Independent review records all findings (or explicit `no_findings`) with attributable reviewer identity.
- [ ] Reconciliation fixes every required issue or documents a justified noncritical disposition; mandatory safety/authority/proof/isolation work is nonwaivable.
- [ ] Exact-tree revalidation reruns the affected focused and required integration/native checks, preserving failures and unsupported results.
- [ ] Only `PF-S06-T92` acceptance unlocks ordinary successor sprint entry; publication and final production completion have additional explicit gates.

## Dispatch and evidence

The live coordinator ledger is [execution/STATE.json](../../execution/STATE.json); the source/evidence handoff template is [TASK_HANDOFF.md](../../templates/TASK_HANDOFF.md). Use `project/validation/production/tasks/<TASK-ID>/attempt-<N>/` for task evidence and `project/validation/production/sprints/PF-S06/` for sprint findings/reconciliation/revalidation. These are proposed execution outputs, not evidence supplied with this plan.
