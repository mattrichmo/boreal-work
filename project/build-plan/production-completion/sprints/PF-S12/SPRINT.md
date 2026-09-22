# PF-S12 — Legacy parity, backup/restore and explicit maintenance recovery

**State at issue:** proposed / every task unaccepted.  
**Goal:** Migrate supported historical data without manufactured success, protect full project state with consistent backups, and expose explicit safe maintenance/repair workflows.

## Entry, leaf joins and exit

**Hard entry gate tasks:** PF-S08-T92, PF-S09-T92, PF-S11-T92  
**Additional cross-sprint joins on named leaves:** None beyond sprint entry gates.  
**Independent review:** `PF-S12-T90` → **reconciliation:** `PF-S12-T91` → **exit revalidation:** `PF-S12-T92`.

All entry gates must be accepted before code work in this sprint. Individual leaf prerequisites may add later joins. In particular PF-S09 may begin its independent planning foundation after PF-S02/PF-S03/PF-S04, but PF-S09-T06 cannot begin until PF-S08-T92 is accepted. This is not early sprint acceptance.

## Required context

Read [the plan entry point](../../README.md), [dispatch rules](../../execution/PARALLEL_DISPATCH.md), [shared-file locks](../../execution/SHARED_FILES.md), [the validation playbook](../../validation/VALIDATION_PLAYBOOK.md) and the selected leaf. Relevant baseline references: [R-LEGACYMAP](../../reference/context/R-LEGACYMAP.md), [R-MIGRATIONDOC](../../reference/context/R-MIGRATIONDOC.md), [R-MIGRATION-CODE](../../reference/context/R-MIGRATION-CODE.md), [R-MIGRATION-V3](../../reference/context/R-MIGRATION-V3.md), [R-BACKUP-TEST](../../reference/context/R-BACKUP-TEST.md), [R-PERF](../../reference/context/R-PERF.md), [R-DECISIONS](../../reference/context/R-DECISIONS.md).

**Risk to preserve:** The supplied v2 mapping is not the missing raw v1 evidence. Full retained parity cannot pass without representative originals or an explicit owner-approved scope change.

## Task-by-task execution map

| Task | Bounded outcome | Lane | Additional task prerequisites | Initial state |
| --- | --- | --- | --- | --- |
| [PF-S12-T01](tasks/PF-S12-T01.md) | Acquire and freeze representative legacy parity inputs | MIGRATION | Sprint entry only | not_started |
| [PF-S12-T02](tasks/PF-S12-T02.md) | Implement dry-run/export/import with complete disposition reports | MIGRATION | PF-S12-T01 | not_started |
| [PF-S12-T03](tasks/PF-S12-T03.md) | Migrate lifecycle, proof and review without converting prose into acceptance | MIGRATION | PF-S12-T02 | not_started |
| [PF-S12-T04](tasks/PF-S12-T04.md) | Migrate hierarchy, cycles, assignments and dependency history | MIGRATION | PF-S12-T02, PF-S12-T03 | not_started |
| [PF-S12-T05](tasks/PF-S12-T05.md) | Materialize legacy source/memory and interruption-safe import | MIGRATION | PF-S12-T03, PF-S12-T04 | not_started |
| [PF-S12-T06](tasks/PF-S12-T06.md) | Implement consistent online backup with a full project manifest | STORE | Sprint entry only | not_started |
| [PF-S12-T07](tasks/PF-S12-T07.md) | Implement safe restore, restore epochs and service reconciliation | APPLICATION | PF-S12-T06 | not_started |
| [PF-S12-T08](tasks/PF-S12-T08.md) | Implement read-only doctor and explicit revision-bound repair | APPLICATION | PF-S12-T03, PF-S12-T04, PF-S12-T05, PF-S12-T07 | not_started |
| [PF-S12-T09](tasks/PF-S12-T09.md) | Expose migration/backup/restore/doctor service and maintenance routes | PROTOCOL | PF-S12-T05, PF-S12-T06, PF-S12-T07, PF-S12-T08 | not_started |
| [PF-S12-T10](tasks/PF-S12-T10.md) | Run real migration, backup/restore and repair acceptance | VALIDATION | PF-S12-T09 | not_started |
| [PF-S12-T90](tasks/PF-S12-T90.md) | Independent sprint review and finding classification | VALIDATION | PF-S12-T01, PF-S12-T02, PF-S12-T03, PF-S12-T04, PF-S12-T05, PF-S12-T06, PF-S12-T07, PF-S12-T08, PF-S12-T09, PF-S12-T10 | not_started |
| [PF-S12-T91](tasks/PF-S12-T91.md) | Reconcile sprint findings and integrate bounded corrections | COORD | PF-S12-T90 | not_started |
| [PF-S12-T92](tasks/PF-S12-T92.md) | Revalidate the integrated sprint and authorize successors | VALIDATION | PF-S12-T91 | not_started |

## Parallelism and integration

Dispatch one task per named agent, never this entire sprint as one assignment. Tasks with all prerequisites accepted may run together only when their actual worker write sets do not overlap. Shared root/schema/protocol/registry/release edits are serialized by the named steward; a function range in one file is not a separate write lock. Task cards list existing files versus proposed new outputs and exact integration requests. Use `python3 tools/plan.py graph-ready` and `python3 tools/plan.py conflicts TASK_A TASK_B` from this plan folder as read-only aids; neither grants authority or edits application state.

## Required sprint acceptance

- [ ] Every leaf has accepted evidence and a complete handoff at its actual integrated source revision.
- [ ] All schema/protocol/contract/root registrations are integrated; no disconnected scaffolding or test-only success path remains.
- [ ] Independent review records all findings (or explicit `no_findings`) with attributable reviewer identity.
- [ ] Reconciliation fixes every required issue or documents a justified noncritical disposition; mandatory safety/authority/proof/isolation work is nonwaivable.
- [ ] Exact-tree revalidation reruns the affected focused and required integration/native checks, preserving failures and unsupported results.
- [ ] Only `PF-S12-T92` acceptance unlocks ordinary successor sprint entry; publication and final production completion have additional explicit gates.

## Dispatch and evidence

The live coordinator ledger is [execution/STATE.json](../../execution/STATE.json); the source/evidence handoff template is [TASK_HANDOFF.md](../../templates/TASK_HANDOFF.md). Use `project/validation/production/tasks/<TASK-ID>/attempt-<N>/` for task evidence and `project/validation/production/sprints/PF-S12/` for sprint findings/reconciliation/revalidation. These are proposed execution outputs, not evidence supplied with this plan.
