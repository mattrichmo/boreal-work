# Boreal general-work completion and portable agent workflows

**Plan ID:** `BW-final-state-2026-10-01` · **revision:** 4 · **date:** 2026-10-02  
**Reviewed repository head:** `7b56cca95c2bd482ea6880ea098993629cf3be78`  
**Historical code baseline:** `6ab1c078150993936d5d381822e7774d9e5cfade`  
**Preserved import key:** `milestone` (example existing ID `boreal-final-milestone`).

## Product promise and finish line

Boreal lets a person capture and organize obligations, and lets authorized people and agents execute project work against one durable record of readiness, ownership, proof and decisions. Finish means complete user journeys on qualified installed artifacts, not merely a stronger kernel or a larger command list.

The required release is a finished **local product with a portable agent-facing application contract**. The supported local runtime and the domain product are separate concerns. This milestone does not claim a published ChatGPT plugin, cloud service or universal environment compatibility.

Keep four boundaries:

- **Core:** Rust domain/application authority, provenance, readiness, policy, lifecycle and transactions. Rust alone is not a guarantee against locks or distributed races; qualify the invariants.
- **Protocol:** existing versioned typed requests, bounded results, capability discovery, identity and safe readback. Do not invent a second state machine or rewrite the existing protocol.
- **Clients/guidance:** CLI, TUI and installed skills. They render and invoke the same use cases; no direct canonical-database reads or client-owned lifecycle decisions.
- **Runtime/distribution:** local service, private roots, sockets, persistence, install, upgrade and recovery. Keep local-only operations explicit rather than leaking host assumptions into every user workflow.

## Authorities

**Global** owns classification-free capture, Personal Inbox, management projects/hierarchy, notes, dates, triage, management completion/archive and truthful portfolio attention. It works with zero linked workspaces.

**Project** owns Intake disposition, planning/publishing, dependency readiness, scheduling cycles, enrolled sessions, attempts/fences, changed-result verification, independent review where required, accepted closeout, source/decision provenance and curated memory.

**Send** is an explicit handoff to Project Intake. A receipt proves delivery, not accepted execution. The Global source is archived, never completed by Send. Unknown delivery is reconciled before another write.

## General-purpose work is required

Read [GENERAL_WORK_CONTRACT.md](GENERAL_WORK_CONTRACT.md). Software is one domain of work. Reuse existing descriptions, dependencies, dates, profiles and source storage; add optional output contracts, typed artifact/decision proof, accepted input lineage, external waits and consistent TUI/CLI surfaces. No rigid software/non-software lifecycle or second artifact store. S12 owns the core extension; S13 owns visual/scheduling/reference-journey integration.

## Required scope

Use [WORKFLOW_CONTRACT.md](WORKFLOW_CONTRACT.md) as the journey-level release contract and [TASK_INDEX.md](TASK_INDEX.md) as the exact graph. Retain working implementation; identify and repair actual gaps, not entire verticals described as missing in older reports.

| Sprint | Required outcome | Required tasks |
| --- | --- | ---: |
| BW-S00 | Exact-head qualification, parallel baseline and callable recovery repair | 6 |
| BW-S01 | Physical Global backup/restore and maintenance ownership | 6 |
| BW-S02 | Packaging, CLI-only/runtime separation and supported release surfaces | 6 |
| BW-S03 | Machine-scoped update and paired package/Global recovery | 7 |
| BW-S04 | Complete bounded reads, search, link identity and outage isolation | 6 |
| BW-S05 | Civil-time daily semantics and dependency-honest attention | 6 |
| BW-S06 | Compatible schema 3, real Inbox, atomic triage and original provenance | 7 |
| BW-S07 | Usable standalone Global daily workflow and authority-aware guidance | 7 |
| BW-S08 | Project restore identity and immutable Intake delivery/readback | 6 |
| BW-S09 | Explicit Send, frozen intent and deterministic reconciliation | 6 |
| BW-S10 | Representative scale qualification and explicit release-scope decision | 4 |
| BW-S12 | Complete project workflows and portable, headless agent access | 7 |
| BW-S13 | General-work dates/waits, visual delivery and reusable production workflows | 4 |
| BW-S11 | Integrated artifact/native qualification, parity and handover | 7 |
| **Total** | **14 sprints; 85 tasks; one milestone** | **85** |

S12's number preserves existing IDs; it runs early in parallel, not after release. Its T01 contract feeds S08-T02 and S05-T05; its T05 guidance contract feeds S07-T05. S08 groundwork no longer waits for Global TUI completion. S09 still requires S07-T90 and S08-T90. S11 requires S09-T90, S10-T90, S12-T90 and S13-T90. S13-T01 starts after S12-T01 and S05-T01; T02 consumes S12-T05 and T03 consumes S12-T90, on separate write sets.

The three original S10 experiments remain named in [DEFERRED.md](DEFERRED.md), outside the default V3 import. A missed mandatory performance budget must be fixed; optional product experiments do not become mandatory just because they have task cards.

## Acceptance and parallel execution

One leaf per worker, one isolated worktree, one named owner per shared whole file across all sprints. Dependency readiness and file ownership must both allow dispatch. The existing S00-T05 active scope/grants are not reset by this revision.

Keep one T90 integration/validation gate per sprint and focused leaf acceptance. Fast contract checks are required only at explicitly dependency-sensitive handoffs. Final S11-T90 and the milestone retain reviewed acceptance. Do not turn each leaf into a miniature release ceremony, but do not hide known failures until the end.

All required J01-J24 journeys must have evidence on exact candidate identities; record failure/unsupported/skip separately. Native installation, an unfamiliar enrolled agent and an explicitly authorized isolated real-work pilot are release outcomes. A simulated protocol client, compilation or the plan validator alone cannot establish them.

## Plan authority versus runtime truth

The active files are V4's template, context, index and task packets. Older production plans are requirements/evidence, not competing queues. [IMPORT.md](IMPORT.md) governs adoption into an existing project. GitHub commits change this plan; only explicit application operations change a running Boreal project's records. No draft is published, attempt recovered or task accepted by this document.

Current cross-sprint sequencing and ownership amendment: [execution/REVISION_V4.md](execution/REVISION_V4.md). Existing ownership records remain binding; the current task graph supersedes historical wave prose.

## Compatible plan delivery

The active V4 import remains native schema 1 and contains exactly 100 work items, the current atomic admission ceiling. Existing projects adopt the review delta through supported revision-bound planning operations; never replay the full template over existing work. Preserve V1–V3 historical templates and all task IDs. The current runtime checkpoint is reported separately by the orchestrator, not encoded as invented status here.
