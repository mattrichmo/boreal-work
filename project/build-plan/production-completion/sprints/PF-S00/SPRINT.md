# PF-S00 — Baseline, provenance, toolchain and evidence recovery

**State at issue:** proposed / every task unaccepted.  
**Goal:** Establish exactly what was supplied, what can be reproduced, which inputs are absent, and how parallel work will be accepted without inheriting historical green results.

## Entry, leaf joins and exit

**Hard entry gate tasks:** No prior sprint; explicit coordinator assignment is still required.  
**Additional cross-sprint joins on named leaves:** None beyond sprint entry gates.  
**Independent review:** `PF-S00-T90` → **reconciliation:** `PF-S00-T91` → **exit revalidation:** `PF-S00-T92`.

All entry gates must be accepted before code work in this sprint. Individual leaf prerequisites may add later joins. In particular PF-S09 may begin its independent planning foundation after PF-S02/PF-S03/PF-S04, but PF-S09-T06 cannot begin until PF-S08-T92 is accepted. This is not early sprint acceptance.

## Required context

Read [the plan entry point](../../README.md), [dispatch rules](../../execution/PARALLEL_DISPATCH.md), [shared-file locks](../../execution/SHARED_FILES.md), [the validation playbook](../../validation/VALIDATION_PLAYBOOK.md) and the selected leaf. Relevant baseline references: [R-AGENTS](../../reference/context/R-AGENTS.md), [R-MASTER](../../reference/context/R-MASTER.md), [R-M02](../../reference/context/R-M02.md), [R-REPORT](../../reference/context/R-REPORT.md), [R-REVIEW](../../reference/context/R-REVIEW.md), [R-EVIDENCE](../../reference/context/R-EVIDENCE.md), [R-GATES](../../reference/context/R-GATES.md), [R-BUILD](../../reference/context/R-BUILD.md).

**Risk to preserve:** The fresh archive is not the exact earlier tested candidate; absent legacy sources, compilers, reviewers or platform executors remain explicit external constraints, never passes.

## Task-by-task execution map

| Task | Bounded outcome | Lane | Additional task prerequisites | Initial state |
| --- | --- | --- | --- | --- |
| [PF-S00-T01](tasks/PF-S00-T01.md) | Freeze the supplied snapshot and record evidence applicability | COORD | Sprint entry only | not_started |
| [PF-S00-T02](tasks/PF-S00-T02.md) | Establish a reproducible build and test environment | VALIDATION | Sprint entry only | not_started |
| [PF-S00-T03](tasks/PF-S00-T03.md) | Run and classify the untouched baseline validation suite | VALIDATION | PF-S00-T01, PF-S00-T02 | not_started |
| [PF-S00-T04](tasks/PF-S00-T04.md) | Inventory public routes, verticals and source findings | CONTRACT | PF-S00-T01 | not_started |
| [PF-S00-T05](tasks/PF-S00-T05.md) | Inventory legacy data, external inputs and platform ownership | MIGRATION | PF-S00-T01 | not_started |
| [PF-S00-T06](tasks/PF-S00-T06.md) | Set up isolated dispatch, evidence and shared-file integration | COORD | PF-S00-T01, PF-S00-T04 | not_started |
| [PF-S00-T07](tasks/PF-S00-T07.md) | Produce the baseline-to-plan reconciliation and entry packet | COORD | PF-S00-T03, PF-S00-T04, PF-S00-T05, PF-S00-T06 | not_started |
| [PF-S00-T08](tasks/PF-S00-T08.md) | Restore read-only versioned workflow discovery for the final gate | PROTOCOL | PF-S00-T90 | not_started |
| [PF-S00-T90](tasks/PF-S00-T90.md) | Independent sprint review and finding classification | VALIDATION | PF-S00-T01, PF-S00-T02, PF-S00-T03, PF-S00-T04, PF-S00-T05, PF-S00-T06, PF-S00-T07 | accepted |
| [PF-S00-T91](tasks/PF-S00-T91.md) | Reconcile sprint findings and integrate bounded corrections | COORD | PF-S00-T90, PF-S00-T08 | not_started |
| [PF-S00-T92](tasks/PF-S00-T92.md) | Revalidate the integrated sprint and authorize successors | VALIDATION | PF-S00-T91 | not_started |

## Parallelism and integration

Dispatch one task per named agent, never this entire sprint as one assignment. Tasks with all prerequisites accepted may run together only when their actual worker write sets do not overlap. Shared root/schema/protocol/registry/release edits are serialized by the named steward; a function range in one file is not a separate write lock. Task cards list existing files versus proposed new outputs and exact integration requests. Use `python3 tools/plan.py graph-ready` and `python3 tools/plan.py conflicts TASK_A TASK_B` from this plan folder as read-only aids; neither grants authority or edits application state.

## Required sprint acceptance

- [ ] Every leaf has accepted evidence and a complete handoff at its actual integrated source revision.
- [ ] All schema/protocol/contract/root registrations are integrated; no disconnected scaffolding or test-only success path remains.
- [ ] Independent review records all findings (or explicit `no_findings`) with attributable reviewer identity.
- [ ] Reconciliation fixes every required issue or documents a justified noncritical disposition; mandatory safety/authority/proof/isolation work is nonwaivable.
- [ ] Exact-tree revalidation reruns the affected focused and required integration/native checks, preserving failures and unsupported results.
- [ ] Only `PF-S00-T92` acceptance unlocks ordinary successor sprint entry; publication and final production completion have additional explicit gates.

## Dispatch and evidence

The live coordinator ledger is [execution/STATE.json](../../execution/STATE.json); the source/evidence handoff template is [TASK_HANDOFF.md](../../templates/TASK_HANDOFF.md). Use `project/validation/production/tasks/<TASK-ID>/attempt-<N>/` for task evidence and `project/validation/production/sprints/PF-S00/` for sprint findings/reconciliation/revalidation. These are proposed execution outputs, not evidence supplied with this plan.
