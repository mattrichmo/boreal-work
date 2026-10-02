# Source baseline and reread map

## Frozen input identity

Plan pack `BW-final-state-2026-10-01` was generated for:

- Repository: `mattrichmo/boreal-work`
- Branch: `main`
- Baseline commit: `6ab1c078150993936d5d381822e7774d9e5cfade` (`Harden global manager audit fixes`)
- Commit date: 2026-09-30; plan-pack date: 2026-10-01
- Imported plan source version: `sv_boreal-work_sha256:968e099c2ea99ebd8544dce1974d5bb4cf2cb5c8f8eb85c8d861fedea4b119c5`
- Plan-pack manifest: `scratch/boreal-final-state/PACK_MANIFEST.json` (12 sprints, 76 tasks, 89 template records)

At T01 start, `git rev-parse HEAD` matched the frozen commit and the branch was `main`. The shared checkout was not clean: `.gitignore` and `crates/cli/src/service.rs` were modified by the coordinator, and the imported `project/build-plan/boreal-final-state/` plan pack was untracked. The service change is outside T01 ownership. T01 edits only `CURRENT_STATE.md` and this file. Later workers must record the exact tree/dirty-path manifest they actually receive; a matching commit SHA alone does not identify an uncommitted source tree.

The imported plan is a delta plan, not an assertion that its starting gaps have already passed fresh validation. `project/build-plan/global-manager/RESULTS.md` records implementation and earlier checks; `project/build-plan/global-manager/AUDIT_REMEDIATION_RESULTS.md` records later source review, fixes and limits. Their results are historical evidence for the described snapshot. BW-S00-T90 and later task gates own current combined qualification.

## Current-source map

These paths identify the code and existing contracts to inspect at dispatch. They are navigation anchors, not assumed line numbers or permission to edit outside a task's write boundary.

| Area / task wave | Current source and evidence to reread | Existing behavior to retain / gap boundary |
| --- | --- | --- |
| Global state, mutations, revisions and history — BW-S00, BW-S01, BW-S04, BW-S06 | `crates/store/src/global_manager.rs`; `crates/application/src/global_manager.rs`; `crates/domain/src/global_manager.rs`; `crates/cli/src/global_commands.rs`; `crates/cli/src/global_service.rs`; `project/GLOBAL_MANAGER.md`; `project/build-plan/global-manager/AUDIT_REMEDIATION_RESULTS.md` | Independent transactional Global authority, durable operation receipts, replay protection, retained snapshots/history, validation, bounded detail and bulk-triage behavior already exist. Verify exact semantics against implementation. Physical Global backup/restore remains BW-S01 scope; do not infer it from logical import/export. |
| Global TUI, daily surfaces and route/help — BW-S02, BW-S05, BW-S06, BW-S07 | `apps/global-tui/src/model.ts`; `apps/global-tui/src/interaction.ts`; `apps/global-tui/src/view.ts`; `apps/global-tui/src/transport.ts`; `apps/global-tui/package.json`; `skills/boreal-route/`; `skills/manifest.json`; `project/AGENT_GUIDANCE.md`; `project/GLOBAL_MANAGER.md` | Current keyboard TUI, management CRUD, search, links, workflows, history and themes are established. Recheck Personal Inbox semantics, daily filters, displayed/selectable row parity, help/route selection, and source provenance before changing these flows. |
| Bounded queries and linked execution reads — BW-S04, BW-S05, BW-S07 | `crates/application/src/global_manager.rs`; `crates/application/src/global_manager_attention.rs` if present in the dispatched tree; `crates/cli/src/global_commands.rs`; `crates/cli/src/global_service.rs`; `apps/global-tui/src/transport.ts`; `apps/global-tui/src/model.ts` | Snapshot/detail paging, fixed-size linked-read workers, queued job limits, freshness and last-good counts exist. Inspect caps and completeness per query; do not convert stale/unavailable linked workspaces to zero or mix execution progress into management status. |
| Global logical transfer and future physical recovery — BW-S01, BW-S04, BW-S06 | `crates/application/src/global_manager.rs` import/export routes and validators; `crates/store/src/global_manager.rs` state/history/export helpers; `crates/cli/src/global_commands.rs`; `crates/store/src/global_manager.rs` backup/restore implementation only if added by predecessor | Logical export/import preserves and validates management records/history. Physical SQLite backup and staged restore are distinct missing work. Recheck response/file size symmetry, identity and replacement semantics. |
| Machine update, installer and release identity — BW-S00, BW-S02, BW-S03, BW-S11 | `crates/cli/src/main.rs`; `crates/cli/src/service.rs`; `crates/cli/src/update.rs`; `install.sh`; release builder scripts under `scripts/`; CI workflows under `.github/workflows/`; `project/build-plan/global-manager/RESULTS.md` | Installer provisioning and supported package surfaces exist. Inspect command routing before project resolution, checksum source path, runtime preflight, user data retention and package-manager behavior. Machine update/recovery ownership and paired rollback are BW-S03 deltas. |
| Project database backup, restore identity and Intake — BW-S00, BW-S08, BW-S09, BW-S11 | `crates/store/src/lib.rs`; `crates/store/src/identity.rs`; `project/spec/schema-v3.sql`; `crates/application/src/intake.rs`; `crates/store/src/cli_features.rs`; project service routes in `crates/cli/src/service.rs` | Project execution remains canonical for attempts/evidence/gates/accepted close. Existing project backup/restore and Intake must be read before adding restore identity or the immutable delivery-receipt feature. These mechanisms are prerequisites for Send and are not Global management state. |
| Project agent guidance and lifecycle — BW-S00, BW-S07, BW-S11 | `project/AGENT_GUIDANCE.md`; `project/STATUS_MODEL.md`; `project/WORKFLOW_PARITY.md`; `skills/boreal-route/`; `skills/manifest.json`; `crates/application/src/guidance/`; `crates/cli/src/agent_commands.rs` if present in the dispatched tree | Keep the versioned trusted guide/next, atomic claim, attempt fence, evidence and finish/release path. BW-S07 chooses the proper Global or project authority at entry; it must not create a parallel Global execution lifecycle. |
| Deferred/evidence-gated scope — BW-S10 and follow-on decisions | `project/build-plan/boreal-final-state/DEFERRED.md`; `project/build-plan/boreal-final-state/MASTER_PLAN.md`; `project/build-plan/boreal-final-state/sprints/BW-S10/`; `project/build-plan/global-manager/AUDIT_REMEDIATION_RESULTS.md` | Saved views, relational storage redesign, history pruning, recurrence/reminders, calendar/Gantt, team sync, rich editing and automatic routing remain deferred or conditional. Measure first, document a trigger and owner, and preserve current history and authority boundaries. |

## Dispatch checks

1. Record `git rev-parse HEAD`, branch, source date, and `git status --short` for the worker's actual input tree.
2. Read this map together with the selected BW-Sxx `SPRINT.md`, exact task packet, `MASTER_PLAN.md`, `AGENT_HANDOFF.md`, and the assigned write-boundary ledger. The plan pack imported into `project/build-plan/boreal-final-state/` is user input, not a code baseline.
3. Re-read the named source paths at the dispatched revision. Prior audit prose, source line numbers and prior build/test receipts do not establish current behavior after intervening changes.
4. Keep the two authorities explicit: Global owns personal/business management and provenance; project Boreal owns execution attempts, evidence, gates, review and accepted completion.
5. Report checks actually run and exact scope. Broad current qualification belongs to the relevant sprint T90 and BW-S11; do not claim a full release pass from these source anchors or earlier focused checks.
