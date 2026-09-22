# PF-S15 — Production terminal workspace and recovery UX

**State at issue:** proposed / every task unaccepted.  
**Goal:** Deliver a premium, responsive service-client TUI with clear planning/execution/review/recovery surfaces, server-owned actions and safe behavior in short editor terminals and outages.

## Entry, leaf joins and exit

**Hard entry gate tasks:** PF-S13-T92  
**Additional cross-sprint joins on named leaves:** None beyond sprint entry gates.  
**Independent review:** `PF-S15-T90` → **reconciliation:** `PF-S15-T91` → **exit revalidation:** `PF-S15-T92`.

All entry gates must be accepted before code work in this sprint. Individual leaf prerequisites may add later joins. In particular PF-S09 may begin its independent planning foundation after PF-S02/PF-S03/PF-S04, but PF-S09-T06 cannot begin until PF-S08-T92 is accepted. This is not early sprint acceptance.

## Required context

Read [the plan entry point](../../README.md), [dispatch rules](../../execution/PARALLEL_DISPATCH.md), [shared-file locks](../../execution/SHARED_FILES.md), [the validation playbook](../../validation/VALIDATION_PLAYBOOK.md) and the selected leaf. Relevant baseline references: [R-TUI-CLIENT](../../reference/context/R-TUI-CLIENT.md), [R-TUI-CONTROLLER](../../reference/context/R-TUI-CONTROLLER.md), [R-TUI-DASHBOARD](../../reference/context/R-TUI-DASHBOARD.md), [R-TUI-LAYOUT](../../reference/context/R-TUI-LAYOUT.md), [R-TUI-TRANSPORT](../../reference/context/R-TUI-TRANSPORT.md), [R-TUI-INPUT](../../reference/context/R-TUI-INPUT.md), [R-TUI-SMOKE](../../reference/context/R-TUI-SMOKE.md).

**Risk to preserve:** Do not recreate lifecycle or action policy in TypeScript. Small terminals must reduce decoration before hiding data, selection, escape or consequential confirmation context.

## Task-by-task execution map

| Task | Bounded outcome | Lane | Additional task prerequisites | Initial state |
| --- | --- | --- | --- | --- |
| [PF-S15-T01](tasks/PF-S15-T01.md) | Replace client-derived action policy with service descriptors | TUI | Sprint entry only | not_started |
| [PF-S15-T02](tasks/PF-S15-T02.md) | Implement project identity, connection state and pending operation safety | TUI | PF-S15-T01 | not_started |
| [PF-S15-T03](tasks/PF-S15-T03.md) | Implement overview, exact attention totals and stable navigation | TUI | PF-S15-T01, PF-S15-T02 | not_started |
| [PF-S15-T04](tasks/PF-S15-T04.md) | Implement milestone/cycle planning, readiness and scope views | TUI | PF-S15-T01, PF-S15-T03 | not_started |
| [PF-S15-T05](tasks/PF-S15-T05.md) | Implement work detail, proof history and independent review screens | TUI | PF-S15-T01, PF-S15-T03 | not_started |
| [PF-S15-T06](tasks/PF-S15-T06.md) | Implement safe forms, confirmations and terminal-content sanitization | TUI | PF-S15-T01, PF-S15-T02, PF-S15-T03 | not_started |
| [PF-S15-T07](tasks/PF-S15-T07.md) | Implement expiry, failure, corruption and operator recovery surfaces | TUI | PF-S15-T01, PF-S15-T02, PF-S15-T05, PF-S15-T06 | not_started |
| [PF-S15-T08](tasks/PF-S15-T08.md) | Implement memory/context/history and maintenance navigation | TUI | PF-S15-T01, PF-S15-T03, PF-S15-T05, PF-S15-T06 | not_started |
| [PF-S15-T09](tasks/PF-S15-T09.md) | Complete independent width/height breakpoints and accessible fallback | TUI | PF-S15-T03, PF-S15-T04, PF-S15-T05, PF-S15-T06, PF-S15-T07, PF-S15-T08 | not_started |
| [PF-S15-T10](tasks/PF-S15-T10.md) | Run mounted real-service terminal workflow and outage tests | VALIDATION | PF-S15-T02, PF-S15-T04, PF-S15-T05, PF-S15-T06, PF-S15-T07, PF-S15-T08, PF-S15-T09 | not_started |
| [PF-S15-T11](tasks/PF-S15-T11.md) | Integrate UX language, client boundaries and installed asset contract | TUI | PF-S15-T10 | not_started |
| [PF-S15-T90](tasks/PF-S15-T90.md) | Independent sprint review and finding classification | VALIDATION | PF-S15-T01, PF-S15-T02, PF-S15-T03, PF-S15-T04, PF-S15-T05, PF-S15-T06, PF-S15-T07, PF-S15-T08, PF-S15-T09, PF-S15-T10, PF-S15-T11 | not_started |
| [PF-S15-T91](tasks/PF-S15-T91.md) | Reconcile sprint findings and integrate bounded corrections | COORD | PF-S15-T90 | not_started |
| [PF-S15-T92](tasks/PF-S15-T92.md) | Revalidate the integrated sprint and authorize successors | VALIDATION | PF-S15-T91 | not_started |

## Parallelism and integration

Dispatch one task per named agent, never this entire sprint as one assignment. Tasks with all prerequisites accepted may run together only when their actual worker write sets do not overlap. Shared root/schema/protocol/registry/release edits are serialized by the named steward; a function range in one file is not a separate write lock. Task cards list existing files versus proposed new outputs and exact integration requests. Use `python3 tools/plan.py graph-ready` and `python3 tools/plan.py conflicts TASK_A TASK_B` from this plan folder as read-only aids; neither grants authority or edits application state.

## Required sprint acceptance

- [ ] Every leaf has accepted evidence and a complete handoff at its actual integrated source revision.
- [ ] All schema/protocol/contract/root registrations are integrated; no disconnected scaffolding or test-only success path remains.
- [ ] Independent review records all findings (or explicit `no_findings`) with attributable reviewer identity.
- [ ] Reconciliation fixes every required issue or documents a justified noncritical disposition; mandatory safety/authority/proof/isolation work is nonwaivable.
- [ ] Exact-tree revalidation reruns the affected focused and required integration/native checks, preserving failures and unsupported results.
- [ ] Only `PF-S15-T92` acceptance unlocks ordinary successor sprint entry; publication and final production completion have additional explicit gates.

## Dispatch and evidence

The live coordinator ledger is [execution/STATE.json](../../execution/STATE.json); the source/evidence handoff template is [TASK_HANDOFF.md](../../templates/TASK_HANDOFF.md). Use `project/validation/production/tasks/<TASK-ID>/attempt-<N>/` for task evidence and `project/validation/production/sprints/PF-S15/` for sprint findings/reconciliation/revalidation. These are proposed execution outputs, not evidence supplied with this plan.
