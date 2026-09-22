# PF-S07 — Profiles, genuine verification and immutable submissions

**State at issue:** proposed / every task unaccepted.  
**Goal:** Make required proof independent of observations, execute verifiers against real recorded inputs, and submit immutable attributable results without letting prose or fixture success close work.

## Entry, leaf joins and exit

**Hard entry gate tasks:** PF-S05-T92  
**Additional cross-sprint joins on named leaves:** None beyond sprint entry gates.  
**Independent review:** `PF-S07-T90` → **reconciliation:** `PF-S07-T91` → **exit revalidation:** `PF-S07-T92`.

All entry gates must be accepted before code work in this sprint. Individual leaf prerequisites may add later joins. In particular PF-S09 may begin its independent planning foundation after PF-S02/PF-S03/PF-S04, but PF-S09-T06 cannot begin until PF-S08-T92 is accepted. This is not early sprint acceptance.

## Required context

Read [the plan entry point](../../README.md), [dispatch rules](../../execution/PARALLEL_DISPATCH.md), [shared-file locks](../../execution/SHARED_FILES.md), [the validation playbook](../../validation/VALIDATION_PLAYBOOK.md) and the selected leaf. Relevant baseline references: [R-PROFILES](../../reference/context/R-PROFILES.md), [R-PROFILE-GAP](../../reference/context/R-PROFILE-GAP.md), [R-APP-EVIDENCE](../../reference/context/R-APP-EVIDENCE.md), [R-EVIDENCE-DOC](../../reference/context/R-EVIDENCE-DOC.md), [R-EVIDENCE-GAPS](../../reference/context/R-EVIDENCE-GAPS.md), [R-SOURCE-DOC](../../reference/context/R-SOURCE-DOC.md).

**Risk to preserve:** User-supplied hashes, shell command text or a receipt-shaped JSON object are not sufficient proof of actual execution against the required source.

## Task-by-task execution map

| Task | Bounded outcome | Lane | Additional task prerequisites | Initial state |
| --- | --- | --- | --- | --- |
| [PF-S07-T01](tasks/PF-S07-T01.md) | Expose profile creation, pinning and requirement validation | APPLICATION | Sprint entry only | not_started |
| [PF-S07-T02](tasks/PF-S07-T02.md) | Capture trustworthy source, configuration and execution input identity | SOURCE | PF-S07-T01 | not_started |
| [PF-S07-T03](tasks/PF-S07-T03.md) | Implement a bounded, attributable real verifier executor | APPLICATION | PF-S07-T01, PF-S07-T02 | not_started |
| [PF-S07-T04](tasks/PF-S07-T04.md) | Persist cryptographic artifacts and authenticated receipt provenance | APPLICATION | PF-S07-T02, PF-S07-T03 | not_started |
| [PF-S07-T05](tasks/PF-S07-T05.md) | Unify relevant-proof selection and invalidation across all reads/writes | APPLICATION | PF-S07-T01, PF-S07-T02, PF-S07-T04 | not_started |
| [PF-S07-T06](tasks/PF-S07-T06.md) | Implement immutable submission, finish intent and safe execution handoff | APPLICATION | PF-S07-T04, PF-S07-T05 | not_started |
| [PF-S07-T07](tasks/PF-S07-T07.md) | Implement checkpoint and closeout-summary proof without prose shortcuts | APPLICATION | PF-S07-T01, PF-S07-T04, PF-S07-T06 | not_started |
| [PF-S07-T08](tasks/PF-S07-T08.md) | Add adversarial verifier and proof-integrity regressions | VALIDATION | PF-S07-T03, PF-S07-T04, PF-S07-T05, PF-S07-T06, PF-S07-T07 | not_started |
| [PF-S07-T09](tasks/PF-S07-T09.md) | Integrate proof/finish service routes and readback parity | APPLICATION | PF-S07-T08 | not_started |
| [PF-S07-T90](tasks/PF-S07-T90.md) | Independent sprint review and finding classification | VALIDATION | PF-S07-T01, PF-S07-T02, PF-S07-T03, PF-S07-T04, PF-S07-T05, PF-S07-T06, PF-S07-T07, PF-S07-T08, PF-S07-T09 | not_started |
| [PF-S07-T91](tasks/PF-S07-T91.md) | Reconcile sprint findings and integrate bounded corrections | COORD | PF-S07-T90 | not_started |
| [PF-S07-T92](tasks/PF-S07-T92.md) | Revalidate the integrated sprint and authorize successors | VALIDATION | PF-S07-T91 | not_started |

## Parallelism and integration

Dispatch one task per named agent, never this entire sprint as one assignment. Tasks with all prerequisites accepted may run together only when their actual worker write sets do not overlap. Shared root/schema/protocol/registry/release edits are serialized by the named steward; a function range in one file is not a separate write lock. Task cards list existing files versus proposed new outputs and exact integration requests. Use `python3 tools/plan.py graph-ready` and `python3 tools/plan.py conflicts TASK_A TASK_B` from this plan folder as read-only aids; neither grants authority or edits application state.

## Required sprint acceptance

- [ ] Every leaf has accepted evidence and a complete handoff at its actual integrated source revision.
- [ ] All schema/protocol/contract/root registrations are integrated; no disconnected scaffolding or test-only success path remains.
- [ ] Independent review records all findings (or explicit `no_findings`) with attributable reviewer identity.
- [ ] Reconciliation fixes every required issue or documents a justified noncritical disposition; mandatory safety/authority/proof/isolation work is nonwaivable.
- [ ] Exact-tree revalidation reruns the affected focused and required integration/native checks, preserving failures and unsupported results.
- [ ] Only `PF-S07-T92` acceptance unlocks ordinary successor sprint entry; publication and final production completion have additional explicit gates.

## Dispatch and evidence

The live coordinator ledger is [execution/STATE.json](../../execution/STATE.json); the source/evidence handoff template is [TASK_HANDOFF.md](../../templates/TASK_HANDOFF.md). Use `project/validation/production/tasks/<TASK-ID>/attempt-<N>/` for task evidence and `project/validation/production/sprints/PF-S07/` for sprint findings/reconciliation/revalidation. These are proposed execution outputs, not evidence supplied with this plan.
