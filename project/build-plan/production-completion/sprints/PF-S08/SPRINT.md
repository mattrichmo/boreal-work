# PF-S08 — Independent review, closeout, overrides and lifecycle reconciliation

**State at issue:** proposed / every task unaccepted.  
**Goal:** Complete every consequential acceptance, policy and recovery mutation transactionally, preserving raw truth and rejecting stale or unauthorized decisions.

## Entry, leaf joins and exit

**Hard entry gate tasks:** PF-S06-T92, PF-S07-T92  
**Additional cross-sprint joins on named leaves:** None beyond sprint entry gates.  
**Independent review:** `PF-S08-T90` → **reconciliation:** `PF-S08-T91` → **exit revalidation:** `PF-S08-T92`.

All entry gates must be accepted before code work in this sprint. Individual leaf prerequisites may add later joins. In particular PF-S09 may begin its independent planning foundation after PF-S02/PF-S03/PF-S04, but PF-S09-T06 cannot begin until PF-S08-T92 is accepted. This is not early sprint acceptance.

## Required context

Read [the plan entry point](../../README.md), [dispatch rules](../../execution/PARALLEL_DISPATCH.md), [shared-file locks](../../execution/SHARED_FILES.md), [the validation playbook](../../validation/VALIDATION_PLAYBOOK.md) and the selected leaf. Relevant baseline references: [R-TRANSITIONS](../../reference/context/R-TRANSITIONS.md), [R-DECISIONS](../../reference/context/R-DECISIONS.md), [R-REVIEW-GAP](../../reference/context/R-REVIEW-GAP.md), [R-CLOSE](../../reference/context/R-CLOSE.md), [R-APP-EVIDENCE-STORE](../../reference/context/R-APP-EVIDENCE-STORE.md), [R-M02](../../reference/context/R-M02.md).

**Risk to preserve:** Accepted proof is not the same as closed work. An exception must not masquerade as a passed test, and reopening must not silently rewrite downstream accepted history.

## Task-by-task execution map

| Task | Bounded outcome | Lane | Additional task prerequisites | Initial state |
| --- | --- | --- | --- | --- |
| [PF-S08-T01](tasks/PF-S08-T01.md) | Implement review requests, inspection and authenticated independence | APPLICATION | Sprint entry only | not_started |
| [PF-S08-T02](tasks/PF-S08-T02.md) | Implement approve, reject, return and revoke decisions | APPLICATION | PF-S08-T01 | not_started |
| [PF-S08-T03](tasks/PF-S08-T03.md) | Implement atomic proof-gated close and resumable auto-finalization | APPLICATION | PF-S08-T02 | not_started |
| [PF-S08-T04](tasks/PF-S08-T04.md) | Implement typed gate exceptions and edge-specific waivers | APPLICATION | Sprint entry only | not_started |
| [PF-S08-T05](tasks/PF-S08-T05.md) | Implement hold, pause, resume and dispatch-policy operations | APPLICATION | PF-S08-T04 | not_started |
| [PF-S08-T06](tasks/PF-S08-T06.md) | Implement work cancellation and dependent/resource disposition | APPLICATION | PF-S08-T03, PF-S08-T05 | not_started |
| [PF-S08-T07](tasks/PF-S08-T07.md) | Implement reopen, supersession and downstream impact reconciliation | APPLICATION | PF-S08-T03, PF-S08-T04, PF-S08-T06 | not_started |
| [PF-S08-T08](tasks/PF-S08-T08.md) | Implement exception expiry/revocation and acceptance impact readback | APPLICATION | PF-S08-T03, PF-S08-T04, PF-S08-T07 | not_started |
| [PF-S08-T09](tasks/PF-S08-T09.md) | Expose lifecycle, review and operator service operations | PROTOCOL | PF-S08-T02, PF-S08-T03, PF-S08-T04, PF-S08-T05, PF-S08-T06, PF-S08-T07, PF-S08-T08 | not_started |
| [PF-S08-T10](tasks/PF-S08-T10.md) | Run acceptance, override, reopen and unknown-outcome races | VALIDATION | PF-S08-T09 | not_started |
| [PF-S08-T11](tasks/PF-S08-T11.md) | Integrate the complete lifecycle transition oracle | APPLICATION | PF-S08-T10 | not_started |
| [PF-S08-T90](tasks/PF-S08-T90.md) | Independent sprint review and finding classification | VALIDATION | PF-S08-T01, PF-S08-T02, PF-S08-T03, PF-S08-T04, PF-S08-T05, PF-S08-T06, PF-S08-T07, PF-S08-T08, PF-S08-T09, PF-S08-T10, PF-S08-T11 | not_started |
| [PF-S08-T91](tasks/PF-S08-T91.md) | Reconcile sprint findings and integrate bounded corrections | COORD | PF-S08-T90 | not_started |
| [PF-S08-T92](tasks/PF-S08-T92.md) | Revalidate the integrated sprint and authorize successors | VALIDATION | PF-S08-T91 | not_started |

## Parallelism and integration

Dispatch one task per named agent, never this entire sprint as one assignment. Tasks with all prerequisites accepted may run together only when their actual worker write sets do not overlap. Shared root/schema/protocol/registry/release edits are serialized by the named steward; a function range in one file is not a separate write lock. Task cards list existing files versus proposed new outputs and exact integration requests. Use `python3 tools/plan.py graph-ready` and `python3 tools/plan.py conflicts TASK_A TASK_B` from this plan folder as read-only aids; neither grants authority or edits application state.

## Required sprint acceptance

- [ ] Every leaf has accepted evidence and a complete handoff at its actual integrated source revision.
- [ ] All schema/protocol/contract/root registrations are integrated; no disconnected scaffolding or test-only success path remains.
- [ ] Independent review records all findings (or explicit `no_findings`) with attributable reviewer identity.
- [ ] Reconciliation fixes every required issue or documents a justified noncritical disposition; mandatory safety/authority/proof/isolation work is nonwaivable.
- [ ] Exact-tree revalidation reruns the affected focused and required integration/native checks, preserving failures and unsupported results.
- [ ] Only `PF-S08-T92` acceptance unlocks ordinary successor sprint entry; publication and final production completion have additional explicit gates.

## Dispatch and evidence

The live coordinator ledger is [execution/STATE.json](../../execution/STATE.json); the source/evidence handoff template is [TASK_HANDOFF.md](../../templates/TASK_HANDOFF.md). Use `project/validation/production/tasks/<TASK-ID>/attempt-<N>/` for task evidence and `project/validation/production/sprints/PF-S08/` for sprint findings/reconciliation/revalidation. These are proposed execution outputs, not evidence supplied with this plan.
