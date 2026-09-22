# PF-S18 — Reproducible packaging, installer and recoverable upgrades

**State at issue:** proposed / every task unaccepted.  
**Goal:** Build and install the full product as one versioned artifact set, verify actual runtime identity, and make updates atomic/recoverable without risking project databases.

## Entry, leaf joins and exit

**Hard entry gate tasks:** PF-S15-T92, PF-S12-T92  
**Additional cross-sprint joins on named leaves:** None beyond sprint entry gates.  
**Independent review:** `PF-S18-T90` → **reconciliation:** `PF-S18-T91` → **exit revalidation:** `PF-S18-T92`.

All entry gates must be accepted before code work in this sprint. Individual leaf prerequisites may add later joins. In particular PF-S09 may begin its independent planning foundation after PF-S02/PF-S03/PF-S04, but PF-S09-T06 cannot begin until PF-S08-T92 is accepted. This is not early sprint acceptance.

## Required context

Read [the plan entry point](../../README.md), [dispatch rules](../../execution/PARALLEL_DISPATCH.md), [shared-file locks](../../execution/SHARED_FILES.md), [the validation playbook](../../validation/VALIDATION_PLAYBOOK.md) and the selected leaf. Relevant baseline references: [R-RELEASE-DOC](../../reference/context/R-RELEASE-DOC.md), [R-PACKAGING](../../reference/context/R-PACKAGING.md), [R-INSTALL](../../reference/context/R-INSTALL.md), [R-RELEASE-BUILDER](../../reference/context/R-RELEASE-BUILDER.md), [R-RELEASE-ID](../../reference/context/R-RELEASE-ID.md), [R-INSTALLER](../../reference/context/R-INSTALLER.md), [R-UPDATE](../../reference/context/R-UPDATE.md), [R-RELEASE-CI](../../reference/context/R-RELEASE-CI.md).

**Risk to preserve:** Source ZIP integrity and fake-release wizard fixtures are not production release proof. Existing update/upgrade routes must verify what was installed, not infer a version from output.

## Task-by-task execution map

| Task | Bounded outcome | Lane | Additional task prerequisites | Initial state |
| --- | --- | --- | --- | --- |
| [PF-S18-T01](tasks/PF-S18-T01.md) | Freeze package contents, provenance and supported runtime policy | RELEASE | Sprint entry only | not_started |
| [PF-S18-T02](tasks/PF-S18-T02.md) | Implement clean deterministic release build and asset verification | RELEASE | PF-S18-T01 | not_started |
| [PF-S18-T03](tasks/PF-S18-T03.md) | Complete multi-screen installer workflow and responsive interaction | TUI | PF-S18-T01 | not_started |
| [PF-S18-T04](tasks/PF-S18-T04.md) | Implement safe archive verification and atomic prefix activation | RELEASE | PF-S18-T01, PF-S18-T02, PF-S18-T03 | not_started |
| [PF-S18-T05](tasks/PF-S18-T05.md) | Complete update/upgrade readback and active-service coordination | CLI | PF-S18-T04 | not_started |
| [PF-S18-T06](tasks/PF-S18-T06.md) | Implement artifact authentication, CI approvals and package metadata | RELEASE | PF-S18-T01, PF-S18-T02, PF-S18-T04 | not_started |
| [PF-S18-T07](tasks/PF-S18-T07.md) | Validate the real built package in a clean disposable prefix | VALIDATION | PF-S18-T04, PF-S18-T05, PF-S18-T06 | not_started |
| [PF-S18-T08](tasks/PF-S18-T08.md) | Validate real macOS and Linux target packages | VALIDATION | PF-S18-T07 | not_started |
| [PF-S18-T09](tasks/PF-S18-T09.md) | Harden source archive generation and required-plan/source retention | RELEASE | PF-S18-T02, PF-S18-T03 | not_started |
| [PF-S18-T10](tasks/PF-S18-T10.md) | Integrate distribution identity and upgrade evidence for qualification | RELEASE | PF-S18-T07, PF-S18-T08, PF-S18-T09 | not_started |
| [PF-S18-T90](tasks/PF-S18-T90.md) | Independent sprint review and finding classification | VALIDATION | PF-S18-T01, PF-S18-T02, PF-S18-T03, PF-S18-T04, PF-S18-T05, PF-S18-T06, PF-S18-T07, PF-S18-T08, PF-S18-T09, PF-S18-T10 | not_started |
| [PF-S18-T91](tasks/PF-S18-T91.md) | Reconcile sprint findings and integrate bounded corrections | COORD | PF-S18-T90 | not_started |
| [PF-S18-T92](tasks/PF-S18-T92.md) | Revalidate the integrated sprint and authorize successors | VALIDATION | PF-S18-T91 | not_started |

## Parallelism and integration

Dispatch one task per named agent, never this entire sprint as one assignment. Tasks with all prerequisites accepted may run together only when their actual worker write sets do not overlap. Shared root/schema/protocol/registry/release edits are serialized by the named steward; a function range in one file is not a separate write lock. Task cards list existing files versus proposed new outputs and exact integration requests. Use `python3 tools/plan.py graph-ready` and `python3 tools/plan.py conflicts TASK_A TASK_B` from this plan folder as read-only aids; neither grants authority or edits application state.

## Required sprint acceptance

- [ ] Every leaf has accepted evidence and a complete handoff at its actual integrated source revision.
- [ ] All schema/protocol/contract/root registrations are integrated; no disconnected scaffolding or test-only success path remains.
- [ ] Independent review records all findings (or explicit `no_findings`) with attributable reviewer identity.
- [ ] Reconciliation fixes every required issue or documents a justified noncritical disposition; mandatory safety/authority/proof/isolation work is nonwaivable.
- [ ] Exact-tree revalidation reruns the affected focused and required integration/native checks, preserving failures and unsupported results.
- [ ] Only `PF-S18-T92` acceptance unlocks ordinary successor sprint entry; publication and final production completion have additional explicit gates.

## Dispatch and evidence

The live coordinator ledger is [execution/STATE.json](../../execution/STATE.json); the source/evidence handoff template is [TASK_HANDOFF.md](../../templates/TASK_HANDOFF.md). Use `project/validation/production/tasks/<TASK-ID>/attempt-<N>/` for task evidence and `project/validation/production/sprints/PF-S18/` for sprint findings/reconciliation/revalidation. These are proposed execution outputs, not evidence supplied with this plan.
