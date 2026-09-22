# PF-S21 — Authorized publication, clean-install verification and operational handover

**State at issue:** proposed / every task unaccepted.  
**Goal:** Publish only the independently qualified immutable artifacts, prove that future users install those bytes, and hand over a recoverable production release.

## Entry, leaf joins and exit

**Hard entry gate tasks:** PF-S20-T92  
**Additional cross-sprint joins on named leaves:** None beyond sprint entry gates.  
**Independent review:** `PF-S21-T90` → **reconciliation:** `PF-S21-T91` → **exit revalidation:** `PF-S21-T92`.

All entry gates must be accepted before code work in this sprint. Individual leaf prerequisites may add later joins. In particular PF-S09 may begin its independent planning foundation after PF-S02/PF-S03/PF-S04, but PF-S09-T06 cannot begin until PF-S08-T92 is accepted. This is not early sprint acceptance.

## Required context

Read [the plan entry point](../../README.md), [dispatch rules](../../execution/PARALLEL_DISPATCH.md), [shared-file locks](../../execution/SHARED_FILES.md), [the validation playbook](../../validation/VALIDATION_PLAYBOOK.md) and the selected leaf. Relevant baseline references: [R-RELEASE-DOC](../../reference/context/R-RELEASE-DOC.md), [R-RELEASE-CI](../../reference/context/R-RELEASE-CI.md), [R-INSTALL](../../reference/context/R-INSTALL.md), [R-GATES](../../reference/context/R-GATES.md), [R-M02](../../reference/context/R-M02.md).

**Risk to preserve:** This sprint includes external side effects and requires explicit authority. A local candidate, uploaded source ZIP or generated tag plan is not a published production release.

## Task-by-task execution map

| Task | Bounded outcome | Lane | Additional task prerequisites | Initial state |
| --- | --- | --- | --- | --- |
| [PF-S21-T01](tasks/PF-S21-T01.md) | Reverify authorization, immutable artifacts and clean release source | RELEASE | Sprint entry only | not_started |
| [PF-S21-T02](tasks/PF-S21-T02.md) | Publish the approved release tag and immutable package assets | RELEASE | PF-S21-T01 | not_started |
| [PF-S21-T03](tasks/PF-S21-T03.md) | Update distribution metadata and future-install instructions safely | RELEASE | PF-S21-T02 | not_started |
| [PF-S21-T04](tasks/PF-S21-T04.md) | Verify clean installs and upgrades from the actual published channels | VALIDATION | PF-S21-T02, PF-S21-T03 | not_started |
| [PF-S21-T05](tasks/PF-S21-T05.md) | Perform release incident drill and bounded stabilization verification | VALIDATION | PF-S21-T04 | not_started |
| [PF-S21-T06](tasks/PF-S21-T06.md) | Finalize implementation report, evidence archive and product handover | COORD | PF-S21-T05 | not_started |
| [PF-S21-T90](tasks/PF-S21-T90.md) | Independent sprint review and finding classification | VALIDATION | PF-S21-T01, PF-S21-T02, PF-S21-T03, PF-S21-T04, PF-S21-T05, PF-S21-T06 | not_started |
| [PF-S21-T91](tasks/PF-S21-T91.md) | Reconcile sprint findings and integrate bounded corrections | COORD | PF-S21-T90 | not_started |
| [PF-S21-T92](tasks/PF-S21-T92.md) | Revalidate the integrated sprint and authorize successors | VALIDATION | PF-S21-T91 | not_started |

## Parallelism and integration

Dispatch one task per named agent, never this entire sprint as one assignment. Tasks with all prerequisites accepted may run together only when their actual worker write sets do not overlap. Shared root/schema/protocol/registry/release edits are serialized by the named steward; a function range in one file is not a separate write lock. Task cards list existing files versus proposed new outputs and exact integration requests. Use `python3 tools/plan.py graph-ready` and `python3 tools/plan.py conflicts TASK_A TASK_B` from this plan folder as read-only aids; neither grants authority or edits application state.

## Required sprint acceptance

- [ ] Every leaf has accepted evidence and a complete handoff at its actual integrated source revision.
- [ ] All schema/protocol/contract/root registrations are integrated; no disconnected scaffolding or test-only success path remains.
- [ ] Independent review records all findings (or explicit `no_findings`) with attributable reviewer identity.
- [ ] Reconciliation fixes every required issue or documents a justified noncritical disposition; mandatory safety/authority/proof/isolation work is nonwaivable.
- [ ] Exact-tree revalidation reruns the affected focused and required integration/native checks, preserving failures and unsupported results.
- [ ] Only `PF-S21-T92` acceptance unlocks ordinary successor sprint entry; publication and final production completion have additional explicit gates.

## Dispatch and evidence

The live coordinator ledger is [execution/STATE.json](../../execution/STATE.json); the source/evidence handoff template is [TASK_HANDOFF.md](../../templates/TASK_HANDOFF.md). Use `project/validation/production/tasks/<TASK-ID>/attempt-<N>/` for task evidence and `project/validation/production/sprints/PF-S21/` for sprint findings/reconciliation/revalidation. These are proposed execution outputs, not evidence supplied with this plan.
