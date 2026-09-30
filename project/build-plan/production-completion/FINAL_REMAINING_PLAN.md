# Boreal v2 — final remaining-work plan

**Status date:** 2026-09-23  
**Scope authority:** the eight-sprint checklist in `BWRK_IMPLEMENTATION_HANDOFF.md`.  
**Status evidence:** the merged overlay report in `handoff/delivery/IMPLEMENTATION_REPORT.md`, the current worktree, and the latest local validation results recorded for that worktree.

This is the single execution plan for finishing the current implementation. It does not restart the project or replace the existing Rust architecture. The older 22-sprint production plan is reference material for this pass, not extra work to replay. The implementation handoff has 48 task IDs; none has been accepted as a completed sprint task yet. That does **not** mean no code was done: substantial, partial code exists across all eight areas. It means the changed paths have not passed the required integrated behavior checks, and several features are still incomplete.

## Current state — no ambiguity

- The model overlay reports 79 repository paths changed: 58 replacements and 21 additions. It adds persistence, status/action, project identity, lifecycle, cycle planning, memory, TUI, workflow, and release groundwork.
- The model's own report says the eight-sprint plan is incomplete. The delivered code is not a production release.
- Local follow-up corrected two Rust compile errors and formatted the overlay Rust files. `cargo fmt --all -- --check` and `cargo check --workspace --locked --offline` passed locally.
- The local workspace Rust tests did **not** pass: ten application tests failed, including inactive principal/delegator setup and claims rejected as integrity-quarantined. Focused store/domain/CLI runs also exposed principal bootstrap, explicit project/path binding, hierarchy expectation, and command/authorization integration failures. These are implementation failures to diagnose and fix—not tests to waive.
- TypeScript typecheck and the direct Node suite (98 tests) passed. The full local TUI test command also hit an environment `EPERM` while creating a Unix socket under `/tmp`; keep that separate from product failures and rerun it in a permitted temp setup.
- Installer generation, SQL structural checks, source-overlay integrity/replay, and release staging passed according to the delivery report. No Rust binary was installed; real update, two-project service lifecycle, backup/restore, and production release checks were not run.
- `execution/STATE.json` belongs to the older 22-sprint plan. It is **not** a completion ledger for the active 48-task/eight-sprint handoff. Do not use its accepted records to mark these eight-sprint tasks complete.

## Definition of finished

Call the work complete only when all of the following are true:

1. The current integrated source formats, builds, and its relevant Rust tests pass; known failures above are fixed or shown to be unrelated with reproducible evidence.
2. One real Rust-backed project workflow proves initialize → create milestone → create two cycles → assign dependent tasks → claim/start → source-bound evidence → submit → independent review → accepted closeout, including a rejected-review/recovery path. `complete` alone must not satisfy an ordinary dependency.
3. Two separate initialized directories cannot read or mutate one another's project, operations, attempts, cache, memory, sockets, or late TUI responses. Existing-project credential migration is explicit and safe.
4. Damaged planning data yields scoped diagnostics while healthy sibling work stays available; mutations on quarantined rows are disabled.
5. Memory publication and database reconciliation, v1 import disposition, backup/restore, and operation readback preserve history and recover from interruption.
6. A fresh disposable-prefix install runs the exact newly built absolute `bwrk` binary and its complete TUI assets; upgrade/readback and rollback are exercised. Do not call this published unless publication actually occurs and is read back.

Passing a typecheck, SQL preparation check, or archive check alone does not meet this definition.

## Fastest safe execution order

### Gate 0 — stabilize the integrated tree (one owner, first)

- [ ] Capture the exact current source identity and preserve the dirty worktree; do not reset, clean, or overwrite user files.
- [ ] Re-run the failing Rust test commands and retain the full names/output of the failures. Fix the principal/bootstrap setup, claim integrity/quarantine inputs, project/path binding, hierarchy expectation, and command/action parity defects at their owning domain/application/store/CLI layers.
- [ ] Re-run `cargo fmt --all -- --check`, `cargo check --workspace --locked --offline`, and the focused failing package tests. Do not start broad parallel edits to shared store/service/CLI roots until this checkpoint builds.
- [ ] Re-run the TUI test command with an allowed temporary socket directory if supported; retain the already passing direct 98-test result and distinguish the local `/tmp` permission failure from product failures.
- [ ] Record a short source-bound checkpoint and freeze the contract surface (DTOs, action descriptors, migrations, module entry points) for parallel streams.

### Wave 1 — parallel implementation streams after Gate 0

Use separate worktrees and non-overlapping write sets. The integration owner alone edits protected roots such as `crates/store/src/lib.rs`, crate `lib.rs` registries, `crates/protocol/src/models.rs`, `crates/cli/src/main.rs`, `service.rs`, `command_registry.rs`, migration ordering, and shared manifests. Workers submit integration patches for those roots instead of editing them concurrently.

**Stream A — identity and legacy-project migration (S3; selected S1/S4 fixes)**

- [ ] Finish explicit per-project initialization, canonical path confinement, and binding checks for database, socket, cache, sources, memory, and operation readback.
- [ ] Add an explicit, least-privilege migration/bootstrap path for older projects that only have historical OS-user actors/sessions. Do not silently promote those rows or strand the owner without a recovery route.
- [ ] Audit every direct CLI, service, and maintenance mutation for authenticated project/caller context and server authorization; submit changes to protected routes through the integration owner.
- [ ] Verify project switching, stale response rejection, outage behavior, and two-directory isolation with the real service, not only TUI fakes.

**Stream B — lifecycle, submissions, review, recovery (S1/S2/S4)**

- [ ] Finish immutable profile/version pinning so removing a gate observation cannot erase the required gate definition.
- [ ] Verify and complete transactional finish/submit/review/approve/reject/return/revoke/closeout, including failed proof, exact submission binding, reviewer independence, typed exception, edge waiver, reopen impact, cancellation, retry, release, and unknown-operation readback.
- [ ] Keep execution lease/fence, sealed submission, review decision, accepted outcome, and recovery/resource obligation distinct across restart and late-worker cases.
- [ ] Ensure every legacy mutation uses the same action decision and rechecks facts inside its committing transaction. Keep failure/rejection/expiry facts; never fabricate a passing receipt.
- [ ] Fix the claim/integrity and principal failures found by local Rust tests before considering this stream accepted.

**Stream C — milestones, cycles, dependencies, rollups, corruption (S5 plus S2-T04)**

- [ ] Complete milestone/task containment and parallel cycle assignments without introducing a second writable hierarchy.
- [ ] Finish milestone/cycle readiness, activation, scope-change, cancellation, replacement, carry-over, and closeout dispositions. In particular, implement the missing milestone/container readiness and replacement-closeout behavior called out by the latest model report.
- [ ] Preserve dependency history and perform cycle detection transactionally. Only an accepted closed outcome satisfies the default prerequisite; waivers remain edge-specific and visible.
- [ ] Reconcile all alternate/legacy assignment paths and define reopen effects on already completed assignments.
- [ ] Make project projections revision-consistent with exact totals and actionable queues. Quarantine damaged parent/profile/cycle/assignment rows at the narrowest safe scope while retaining healthy siblings.
- [ ] Connect the service diagnostic projection to red/degraded TUI rows with mutations disabled for damaged records; verify against a real corrupted disposable database.

**Stream D — memory, import, maintenance and recovery (S7)**

- [ ] Complete cited source intake/search and revision-bound handoff; keep retrieved text non-authoritative.
- [ ] Exercise Git publication crash points and prove commit readback plus SQLite reconciliation do not duplicate publication or lose provenance.
- [ ] Complete v1 import disposition with representative fixtures. Preserve historical statuses and evidence; never convert historical `done`/`complete` prose into accepted v2 closeout.
- [ ] Complete online backup manifests, restore epochs, service reconciliation, read-only doctor, revision-bound repair/resume, and durable machine readback. The model's latest report specifically leaves full repair/restore reconciliation incomplete.

**Stream E — public CLI, workflows, TUI controls and copy (S6)**

- [ ] Reconcile command registry and aliases against implemented service operations; fill missing list/show and maintenance routes rather than documenting nonexistent commands.
- [ ] Remove remaining status-label authorization shortcuts in every legacy CLI/TUI mutation.
- [ ] Execute trusted workflow recipes against the built CLI and ensure their conditions/actions match the command registry and server decisions.
- [ ] Add dedicated full-screen controls for the newly added review, cycle, memory, and recovery workflows; the latest report says this breadth remains incomplete.
- [ ] Finish the user-language sweep so routine screens explain what happened and the safe next action; keep raw enum/fence/SQL/receipt detail in diagnostics.
- [ ] Retain narrow terminal regressions for small sizes, resize, pasted UTF-8/multiline JSON, cancellation, and confirmation target/revision changes.

### Wave 2 — integrate and run one compact end-to-end acceptance pass

- [ ] Integrate streams in this order: shared identity/action contracts → lifecycle/proof writers → planning/projections → memory/maintenance → CLI/workflows/TUI. Resolve shared-file changes serially; do not cherry-pick schema or protocol fragments out of context.
- [ ] Run the Rust format/build and the focused package/workflow tests affected by the merged patches. Fix newly introduced failures; do not add a second broad test bureaucracy.
- [ ] Run one genuine service-backed vertical workflow covering parallel cycles, dependencies, claim race, source-bound evidence, review rejection then accepted closeout, recovery/readback, and dependency status.
- [ ] Run one two-project isolation check and one corrupted-planning-data check with the actual built binary/service. Verify healthy siblings remain usable and totals are truthful.
- [ ] Run one interrupted memory publication plus backup/restore/repair readback scenario. Preserve logs and exact source/binary identities.

### Wave 3 — package and hand off (sequential)

- [ ] Regenerate the installer from its TypeScript sources; verify standalone/embedded byte identity.
- [ ] Build the Rust CLI and stage the complete TUI tree (including `dist/ui`) using the existing release builder.
- [ ] Install to a new disposable prefix and invoke that prefix's absolute binary; exercise init, dashboard, update/upgrade/readback, two isolated projects, and rollback-safe failure handling.
- [ ] Produce the final changed-file inventory, concise honest change log, command outcomes, remaining limitations, and exact artifact hashes. Preserve the current project memory and unrelated dirty files.
- [ ] Only after all acceptance gates pass, ask/confirm separately before any external release publication; then verify the published artifact by readback.

## Sprint-by-sprint remaining task register

All task IDs below remain **open** until their source changes and evidence are integrated. “Partial” means the delivery report says code exists; it is not task acceptance.

### Sprint 1 — canonical persistence and integrity

- [ ] **S1-T01 (partial):** verify profile immutability and pinned required-gate readers in Rust; finish legacy-profile disposition and prove deleting an observation does not erase the requirement.
- [ ] **S1-T02 (partial):** compile and exercise the new submission/review/accepted-outcome/exception/waiver writers end-to-end; preserve rejected review as intervention.
- [ ] **S1-T03 (partial):** finish expiry, release/resource, job, restart, and restore recovery obligations and definitive readback.
- [ ] **S1-T04 (partial):** audit all existing operations for atomic registration, payload-digest conflict, outcome, and audit behavior—not only newly added commands.
- [ ] **S1-T05 (partial):** complete narrow-scope corruption isolation for parent, profile, artifact, clock, cycle, and assignment data.
- [ ] **S1-T06 (partial):** execute Rust migration runner and populated legacy-to-current upgrade fixtures; current SQL checks are not a substitute.

### Sprint 2 — deterministic status and server-owned actions

- [ ] **S2-T01 (partial):** compile and exercise complete decision facts, project/caller/source identity, proof generations, integrity, and revisions.
- [ ] **S2-T02 (partial):** close precedence/reason gaps with focused combined-condition fixtures, including expiry vs intervention, rejected review, paused prerequisites, retry timing, and accepted closeout.
- [ ] **S2-T03 (partial):** prove every action descriptor matches the actual mutation authorization and includes target, expected revision, caller, confirmation, and denial explanation.
- [ ] **S2-T04 (open):** finish container/milestone rollup, replacement, waiver, and reopen-impact predicates.
- [ ] **S2-T05 (partial):** validate canonical status facts under Rust execution and scoped-corruption cases; repair the local claim/integrity failures.
- [ ] **S2-T06 (partial):** run Rust service/protocol/CLI JSON round trips and stale/unknown-operation readback; maintain one contract across adapters.

### Sprint 3 — project identity and authority

- [ ] **S3-T01 (partial):** verify installed `init` and current-working-directory selection; uninitialized folders must give an init instruction, never fall back globally.
- [ ] **S3-T02 (partial):** complete canonical path, symlink-race, nested worktree, restore, database, socket, cache, source, memory, and operation confinement.
- [ ] **S3-T03 (partial):** add and test explicit credential migration/recovery for old projects; verify safe bootstrap, delegation, roles, revocation, and independent review.
- [ ] **S3-T04 (partial):** authenticate every direct/service/maintenance mutation against the selected project context.
- [ ] **S3-T05 (partial):** run real service project-switch, late-response, pending-operation, and outage tests; prohibit Project A state painting Project B.
- [ ] **S3-T06 (not run):** run the installed-binary two-directory isolation scenario.

### Sprint 4 — lifecycle, proof, review, recovery

- [ ] **S4-T01 (partial):** verify every execution transition is transactional, race-safe, and fenced; retain recovery state after expiry/release.
- [ ] **S4-T02 (partial):** prove lease, fence, submission, review, accepted outcome, and recovery remain distinct across restart and late writes.
- [ ] **S4-T03 (partial):** validate genuine verifier outputs bound to exact task, attempt, source/configuration, profile, gate, and verifier; reject unrelated/newer/stale evidence.
- [ ] **S4-T04 (partial):** exercise finish with missing, failed, and passing proof; only valid final closeout becomes accepted closed.
- [ ] **S4-T05 (partial):** test independent approve/reject/return/revoke, typed exceptions, edge-specific waivers, and reason/revision enforcement.
- [ ] **S4-T06 (partial):** complete expiry, retry, cancellation, release, reopen, resource reconciliation, and committed/rejected/pending/unknown readback.
- [ ] **S4-T07 (open):** complete the legacy-mutation/action-contract audit and remove all duplicate client authorization.

### Sprint 5 — milestones, cycles, dependencies, projections, corruption UI

- [ ] **S5-T01 (partial):** finish milestone/task operations, containment, and validated project scoping.
- [ ] **S5-T02 (partial):** finish cycle commitment/reopen/replacement behavior across all old and new assignment APIs.
- [ ] **S5-T03 (partial):** run transactional dependency-cycle races and prove only accepted close satisfies an edge; keep waiver and cancelled prerequisite history.
- [ ] **S5-T04 (open):** implement complete milestone/cycle readiness and closeout, scope reconciliation, replacement, cancellation, deferral, and waiver dispositions.
- [ ] **S5-T05 (partial):** prove exact, revision-consistent milestone/cycle totals and bounded reads under large and partly damaged plans.
- [ ] **S5-T06 (partial):** validate red/quarantined rows and disabled mutations from actual service responses while healthy siblings remain selectable.
- [ ] **S5-T07 (partial):** complete server-backed review/expiry/failure/hold/corruption queues and reconcile counts with canonical work.

### Sprint 6 — CLI, guidance, terminal surface

- [ ] **S6-T01 (partial):** reconcile every documented/public route, alias, registry entry, and machine response; add missing routes.
- [ ] **S6-T02 (open):** route every mutation through server-owned actions, including legacy direct commands.
- [ ] **S6-T03 (partial):** execute trusted conditional workflow assets through the built CLI and verify no guidance can authorize a denied action.
- [ ] **S6-T04 (partial):** add full-screen controls for all supported cycle/review/memory/recovery workflows and verify project/pending/outage state.
- [ ] **S6-T05 (partial):** finish focused resize, small terminal, paste, multiline JSON, cancellation, and safe-confirmation checks; resolve `/tmp` socket test limitation.
- [ ] **S6-T06 (partial):** complete user-facing terminology/copy review.

### Sprint 7 — memory, migration, backup, restore, maintenance

- [ ] **S7-T01 (partial):** complete citations, project search, source intake, and revision-bound handoff paths; run actual CLI flows.
- [ ] **S7-T02 (partial):** test Git commit/readback/reconciliation under interruption and restart without duplicate side effects.
- [ ] **S7-T03 (partial):** run representative v1 import fixtures and a disposition report; prove historical completion is not v2 acceptance.
- [ ] **S7-T04 (open):** finish restore-epoch/service reconciliation and revision-bound repair/resume; exercise online backup and restore against a disposable project.
- [ ] **S7-T05 (partial):** exercise all migration/backup/restore/doctor/memory/handoff commands and machine readback against the built binary.

### Sprint 8 — installer and release

- [ ] **S8-T01 (source check reported passed):** rerun installer build and byte identity on the final integrated source.
- [ ] **S8-T02 (staging check reported passed):** verify full TUI release layout on the final built package, not only a staging fixture.
- [ ] **S8-T03 (open):** run actual update/upgrade/readback and rollback-safe interruption with the new installed binary and assets.
- [ ] **S8-T04 (not run):** install to a fresh prefix; run init/dashboard/lifecycle in two independent projects with the absolute installed binary.
- [ ] **S8-T05 (partial):** refresh the delivery report/inventory/hashes after all fixes and record the precise remaining limitations. No release publication is implied.

## Progress reporting rule

At each checkpoint report only: task IDs completed with source-bound evidence; task IDs still open; exact new failure or blocker; next owner/action. Do not send another broad progress essay in place of a merged patch. Do not mark an entire sprint done until its implementation is integrated and the compact acceptance checks above pass.

**Immediate next action:** close Gate 0 by fixing the known Rust principal/project-context/claim-integrity failures, then dispatch Streams A–E in separate worktrees with the shared-file steward rule. The next deliverable should be integrated code and passing focused checks—not another plan or another unmerged ZIP.
