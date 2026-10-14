# Current-state inventory — requalified 2026-10-13

## Exact source

**Repository:** `mattrichmo/boreal-work` · **verified `main` head:**
`1cee693279a0fdb997f3f29cc3537b7ff0f6157a` · **commit:**
`docs: rewrite Boreal product guide and add README banner` · **commit date:**
`2026-10-13`.

The earlier exact-head inventory at `123f3458f37172d71a068af894e63ab01a92fb59`
was re-read against this later main commit. The V4 task graph remains a delta
against the implementation, not a claim that its acceptance journeys pass.

The local `main` and `origin/main` were both at this SHA with a clean tree
before this dispatch. Implementation is isolated in a coordinator worktree;
the user's previous local stash remains untouched. This source requalification
did not query or mutate the canonical runtime database.

## Implemented areas and V4 deltas

The 2026-09-30 implementation and audit reports are useful source maps, but
their checks describe earlier snapshots. Re-read the named implementation and
tests at each task's dispatched source. Retain current code that meets the
contract; repair the explicit delta only.

| Area | Retain from current code | Remaining V4 response |
| --- | --- | --- |
| Global authority, transactions and history | Separate installation-wide Global store/application, revisioned writes, audit and replayable operation receipts; preserve project execution as the authority for attempts and accepted work. | BW-S00-T05's descriptor-bound `recovery recover` route is present in current source, but sprint-level acceptance remains unrecorded. BW-S01 adds physical Global backup/restore and maintenance ownership; logical export/import is not physical recovery. |
| Management projects, items, workflows and notes | Folderless projects, optional folder/workspace links, configurable workflow/status identity, hierarchy, relationships, notes, history and bulk triage exist. | BW-S05–S07 complete civil-time daily semantics, Personal Inbox exit/provenance, keyboard triage, truthful Home views and authority-aware guidance. Do not rebuild a generic todo manager. |
| Global TUI and linked execution | A distinct Global TUI and service client exist. Linked execution is advisory and remains separate from Global-owned completion. | BW-S00/T02's normal-validation work must be checked against current scripts and workflow wiring. BW-S04 still needs pageable attention, complete form pickers, complete association reads for `global next`, cross-route search, and large-note response handling. |
| Global reads, logical transfer and scaling | Bounded summaries/details, searchable pages, last-good linked counts and relationship/history validation exist. Issues #1, #3, #5 and #6 appear fixed in source; #4 and #7 remain partial. | BW-S04 closes unbounded attention and association samples, picker/search completeness, worker deadlines and export/import symmetry. BW-S10 still needs Global portfolio fixtures and measured results; retain lossless history absent a verified archival path. |
| Global physical recovery and maintenance | Global has logical JSON transfer only; no Global-specific physical backup/restore or maintenance admission path was found. | BW-S01 adds online physical backup, staged restore, fresh physical identity and non-destructive maintenance ownership. Never break a live owner lock. |
| Management daily flow and Inbox | Workflows, items, history, notes, triage and scoped capture exist. Current capture lacks immutable origin provenance and a persistent Personal Inbox status. | BW-S05 needs civil-time classification and prerequisite-aware next actions. BW-S06/S07 add compatible Inbox/provenance behavior, personal quick capture, truthful grouped daily views and authority-aware guidance. |
| Machine update, install and release | Installer/bootstrap, package identity checks, local package smoke, and project-store backup/restore foundations exist. Project and Global databases have separate authorities. | BW-S02 still needs supported Node preflight and exact target qualification; BW-S03 makes update state machine-scoped and recovery-capable with Global data; S11 needs exact-candidate artifacts and journey evidence. Root CI/release workflows are absent. |
| Project planning and execution | The Rust project lifecycle has hierarchy, dependencies, cycles, enrolled sessions, fenced attempts, evidence, reviews, status guidance, source versions and memory publication. Keep one canonical lifecycle. | S08 needs unique restore activation identity and immutable Intake delivery receipts/readback; S09 adds explicit, reconciled Global Send. S12 completes planning amendment, artifact acceptance, context and portable agent access. |
| General work and evidence | Existing work/templates carry descriptions, dependency keys, profiles, labels and dispatch. Source versions identify immutable bytes/digests. Cycle scheduling exists. | Work-level typed output requirements, accepted-input lineage, content-bound artifact/decision proof, portable artifact recovery, persisted civil dates, typed external waits and TUI/CLI parity remain incomplete. S12/S13 own those deltas. |
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

## Current-head qualification recorded for dispatch

- Source reviewed at `1cee693279a0fdb997f3f29cc3537b7ff0f6157a` on
  2026-10-13. The checkout was clean and aligned with `origin/main` before the
  coordinator worktree was created.
- Three read-only Luna Extra High source audits covered Global/TUI,
  project/general-work workflows, and runtime/release qualification. They
  checked source and existing tests but did not execute tests, builds, release
  artifacts, or canonical runtime database operations.
- Issues #1, #3, #5, and #6 appear fixed in source; #4 and #7 are partial.
  All six reported issues remain open on GitHub. No open PRs were found.
- Do not treat the 2026-10-02 local build/import observations below as current
  head validation. They are preserved as historical evidence in
  `SOURCE_BASELINE.md`.

## Historical exact-head qualification from 2026-10-02

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

## Requalification update — 2026-10-14

The exact-head inventory above is historical. Requalification on 2026-10-14 found
`origin/main` at `b646ad2dae8f9a1a77e2dc64fdf9f03b01d7b10e`; local `main` is one
commit ahead at `61828ecf7a9ef2368658d877b6b95e5613a2307c` with the workflow fixture
revision correction. The isolated `codex/v4-roadmap-continuation` integration
branch is based on that remote head and currently contains source through
`ef89994fc8afa05c1f6286a70b740fbd8a232355`. The local main commit has not been
pushed. GitHub currently reports no open issues or pull requests.

The current integration branch now includes the F1 local guidance/onboarding
change, S07-T03 provenance inspector, S13 typed scheduling/external-wait TUI,
and the workflow fixture revision correction. Contract validation, workflow
package validation, skill package validation, machine-update focused tests,
Global TUI checks, and project TUI typecheck plus all 106 tests pass. These are
source checks, not sprint acceptance. The TUI displays at most 100 external
waits and marks the view partial because the service readback still loads and
returns the full unbounded list.

S02 already contains supported Node preflight and target-matrix/host-smoke
scaffolding; exact target execution and S02-T90 remain unqualified. S03 still
needs paired package/Global backup and migration-failure recovery with the T06
fault matrix. Remaining work includes S05–S07 daily/Inbox/CLI parity and the
held interactive snapshot privacy change, S08 Intake receipts, S09 Global Send,
S10 scale qualification, S11 release journeys/handover, S12-T05/T06, and
S13-T01/T03/T90. J1–J13 and sprint T90 gates remain unrun/unaccepted; no
release candidate has been assembled, installed, or published.

The installed local `bwrk` remains 0.2.0 at build
`6ab1c078150993936d5d381822e7774d9e5cfade` and reports SQLite 3.43.2, below
the declared 3.51.3 floor. Runtime project revision 99 integrity checks pass.
The S00-T01/T04 expired-review sessions still require harness confirmation
that their workers stopped before supported recovery; the user cannot confirm
yet. No runtime session or installation state was changed.
