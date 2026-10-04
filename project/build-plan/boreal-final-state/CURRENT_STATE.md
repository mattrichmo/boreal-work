# Current-state inventory — requalified 2026-10-02

## Exact source

**Repository:** `mattrichmo/boreal-work` · **verified `main` head:**
`123f3458f37172d71a068af894e63ab01a92fb59` · **commit:**
`docs(plan): expand Boreal milestone v4 for general work and deliverables` ·
**commit time:** `2026-10-02T16:53:37-06:00`.

The code history still includes the 2026-09-30 implementation baseline
`6ab1c078150993936d5d381822e7774d9e5cfade` and the later code fix
`e084dac` (`fix(cli): reuse project service for dashboard and next`). The
commits after `e084dac` through the verified head are plan documentation. The
V4 task graph is a delta against the inspected code, not a claim that its
acceptance journeys already pass.

The verified main tree was clean when cloned. Initializing the separate local
execution project with `bwrk init` then changed only `.gitignore` to ignore
project-local Boreal runtime and memory-publication files. No production code
was changed by setup. The source checkout is on the local
`boreal-final-push` branch; publication to GitHub is outside this work.

## Implemented areas and V4 deltas

The 2026-09-30 implementation and audit reports are useful source maps, but
their checks describe earlier snapshots. Re-read the named implementation and
tests at each task's dispatched source. Retain current code that meets the
contract; repair the explicit delta only.

| Area | Retain from current code | Remaining V4 response |
| --- | --- | --- |
| Global authority, transactions and history | Separate installation-wide Global store/application, revisioned writes, audit and replayable operation receipts; preserve project execution as the authority for attempts and accepted work. | BW-S00 qualifies current behavior. BW-S01 adds physical Global backup/restore and maintenance ownership; logical export/import is not physical recovery. |
| Management projects, items, workflows and notes | Folderless projects, optional folder/workspace links, configurable workflow/status identity, hierarchy, relationships, notes, history and bulk triage exist. | BW-S05–S07 complete civil-time daily semantics, Personal Inbox exit/provenance, keyboard triage, truthful Home views and authority-aware guidance. Do not rebuild a generic todo manager. |
| Global TUI and linked execution | A distinct Global TUI and service client exist. Linked execution is advisory and remains separate from Global-owned completion. | BW-S00/T02 makes the UI and portable PTY path part of normal validation. BW-S04 and S07 close bounded paging, picker completeness, attention and outage-isolation gaps. |
| Global reads, logical transfer and scaling | Bounded summaries/details, searchable pages, last-good linked counts and validated logical transfer/history exist. | BW-S01/T05 and S04/T05 reconcile transfer bounds. S10 measures representative portfolios before optional storage changes; retain lossless history absent a verified archival path. |
| Global physical recovery and maintenance | No Global physical backup/restore was established by the earlier logical-transfer work. | BW-S01 adds an online physical backup, staged restore, fresh physical identity and non-destructive maintenance ownership. Never break a live owner lock. |
| Machine update, install and release | Installer/bootstrap and declared macOS/Linux package paths exist. Project and Global databases have separate authorities. | BW-S02 qualifies checksum/runtime/TUI identity; BW-S03 makes update state machine-scoped and package-plus-Global recovery-capable; S11 qualifies exact release artifacts. Do not widen platform claims from source inspection. |
| Project planning and execution | The Rust project lifecycle has hierarchy, dependencies, cycles, enrolled sessions, fenced attempts, evidence, reviews, status guidance, source versions and memory publication. Keep one canonical lifecycle. | S08 adds project restore identity and immutable Intake delivery receipts; S09 adds explicit, reconciled Global Send. S12 completes planning amendment, enrolled execution, artifact acceptance, context and portable agent access. |
| General work and evidence | Existing work/templates carry descriptions, dependency keys, profiles, labels and dispatch. Source versions identify immutable bytes/digests. Project schedules already contain `not_before_at`/`due_at`; cycles carry local/UTC scheduling facts. | These foundations do not establish optional typed output requirements, accepted-input lineage, artifact/decision proof, or review of an exact artifact/input revision. S12 adds the core contract; S13 adds waits/dates, TUI parity and reusable mixed-work journeys. Preserve work that has no deliverable or dates. |
| Conditional/deferred work | S10-T04/T05/T06 are retained historical cards, not required release outcomes. Saved views, recurrence/reminders, team sync, Gantt/resource planning, rich document editing and automatic provider launching remain conditional or deferred. | S10-T01 through T03 are required scale qualification. Keep the three historical experiments paused unless the stated product/evidence trigger changes. |

## V4 required task map

Every required task ID below is a delta from the exact source above, not a
greenfield rewrite. Each card and `TASK_INDEX.md` define that task's named gap,
whole-file ownership and acceptance; keep implementation that already meets
the outcome. The three deferred S10 IDs are called out separately and remain
outside the required release.

| Sprint and every required task ID | Required delta from the retained source |
| --- | --- |
| BW-S00 (BW-S00-T01, BW-S00-T02, BW-S00-T03, BW-S00-T04, BW-S00-T05, BW-S00-T90) | Exact-head inventory; Global TUI/portable PTY and real release-download validation; whole-file ownership; bounded Recover route; sprint integration. |
| BW-S01 (BW-S01-T01, BW-S01-T02, BW-S01-T03, BW-S01-T04, BW-S01-T05, BW-S01-T90) | Physical Global backup, staged restore, maintenance admission and symmetric logical transfer. |
| BW-S02 (BW-S02-T01, BW-S02-T02, BW-S02-T03, BW-S02-T04, BW-S02-T05, BW-S02-T90) | Checksum/runtime/TUI release identity, supported package paths and accurate retention/supply-chain docs. |
| BW-S03 (BW-S03-T01, BW-S03-T02, BW-S03-T03, BW-S03-T04, BW-S03-T05, BW-S03-T06, BW-S03-T90) | Machine-scoped update and paired package/Global recovery. |
| BW-S04 (BW-S04-T01, BW-S04-T02, BW-S04-T03, BW-S04-T04, BW-S04-T05, BW-S04-T90) | Complete bounded Global pages/search/pickers/links, worker deadlines and transfer invariants. |
| BW-S05 (BW-S05-T01, BW-S05-T02, BW-S05-T03, BW-S05-T04, BW-S05-T05, BW-S05-T90) | Civil-time classification, dependency-honest daily attention and consistent CLI/service behavior. |
| BW-S06 (BW-S06-T01, BW-S06-T02, BW-S06-T03, BW-S06-T04, BW-S06-T05, BW-S06-T06, BW-S06-T90) | Compatible Global schema 3, real Personal Inbox, immutable capture provenance, atomic triage and transfer metadata. |
| BW-S07 (BW-S07-T01, BW-S07-T02, BW-S07-T03, BW-S07-T04, BW-S07-T05, BW-S07-T06, BW-S07-T90) | Complete standalone Global daily flow, provenance inspection and two-authority route/help. |
| BW-S08 (BW-S08-T01, BW-S08-T02, BW-S08-T03, BW-S08-T04, BW-S08-T05, BW-S08-T90) | Physical project restore identity and immutable Intake receive/readback receipt. |
| BW-S09 (BW-S09-T01, BW-S09-T02, BW-S09-T03, BW-S09-T04, BW-S09-T05, BW-S09-T90) | Explicit Global Send with frozen intent, reconciliation and archive-not-complete semantics. |
| BW-S10 (BW-S10-T01, BW-S10-T02, BW-S10-T03, BW-S10-T90) | Required representative scale fixture, benchmark and release-scope decision; optional experiments remain deferred. |
| BW-S12 (BW-S12-T01, BW-S12-T02, BW-S12-T03, BW-S12-T04, BW-S12-T05, BW-S12-T06, BW-S12-T90) | General-work contracts, optional deliverables, typed artifact/decision proof, accepted input lineage, portable context and enrolled headless execution. |
| BW-S13 (BW-S13-T01, BW-S13-T02, BW-S13-T03, BW-S13-T90) | Civil dates and external waits, TUI/CLI parity, versioned reference templates and mixed-work qualification. |
| BW-S11 (BW-S11-T01, BW-S11-T02, BW-S11-T03, BW-S11-T04, BW-S11-T05, BW-S11-T06, BW-S11-T90) | Final exact-artifact journeys, v1 parity, recovery/security/performance regression and operator handover; joins S09, S10, S12 and S13. |

## Exact-head qualification recorded for dispatch

- `python3 project/build-plan/boreal-final-state/validate_plan.py` passes:
  14 sprints, 85 required tasks, 100 native work items, 24 journeys and 3
  deferred S10 cards.
- `bwrk template validate` accepts `boreal-final-state-v4`, schema 1, version
  4. Its application dry run contains 100 work items. The isolated app import
  was read back as 100 records with zero dependency cycles; the milestone's
  actual ID is `boreal-final-milestone`.
- `source /workspace/.toolchains/boreal-env.sh && cargo build --locked -p
  boreal-cli` succeeds at the exact source. It emits existing unused-code and
  function-cast warnings. No broad Cargo test suite was run for T01.
- The compiled `bwrk` reports package `0.2.0`, build revision
  `123f3458f37172d71a068af894e63ab01a92fb59`, build source
  `sha256:ce7527c6d0dca7847a86d11d388c1431924b70b09180af7480b3327e9adc412d`,
  `boreal.cli.registry.v1`, envelope `boreal.protocol.envelope.v1`, and
  workflow assets `boreal.workflow.assets.v1`.
- The compiled Linux binary links SQLite `3.46.1`; its displayed release floor
  is `3.51.3` and enforcement is false in this build. This container proves
  source compilation and local API behavior, not the declared release SQLite
  matrix.

Historical Global audit results (including Node 20 and prior PTY/socket
checks) remain historical evidence. S00-T90 must qualify the combined exact
tree and record platform skips/unsupported results honestly.
