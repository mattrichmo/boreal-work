# Source baseline and dispatch reread map — V4

## Frozen source identity

- Repository: `mattrichmo/boreal-work`
- Verified `main` at the V4 planning commit:
  `123f3458f37172d71a068af894e63ab01a92fb59`
- Commit: `docs(plan): expand Boreal milestone v4 for general work and deliverables`
- Commit time: `2026-10-02T16:53:37-06:00`
- Historical implementation baseline: `6ab1c078150993936d5d381822e7774d9e5cfade`
- Later code commit in this tree: `e084dac` — reuse the project service for
  dashboard and `next`.
- Local working branch: `boreal-final-push`. The verified clone was clean
  before project setup; `bwrk init` changed only `.gitignore` to ignore the
  new project's private `.boreal/` runtime and memory-publication artifacts.
  No production-code changes were present at T01 start.

V4 plan identity is `BW-final-state-2026-10-01`, revision 4, with active
template `BOREAL_TEMPLATE_V4.json` (`boreal-final-state-v4`, version 4,
schema 1). The graph contains one milestone, 14 sprints, 85 required tasks,
and 100 work items. S10-T04/T05/T06 remain historical deferred cards outside
the required import. The graph is a delta from the implementation; plan import
does not imply task publication, acceptance or restored project history.

## Exact local build and application qualification

Every shell that invokes Rust tools sources
`/workspace/.toolchains/boreal-env.sh`. At the exact source head:

- `rustc 1.99.0 (b940084d7 2026-09-28)`, `cargo 1.99.0`.
- `cargo build --locked -p boreal-cli` succeeds. The build reports existing
  unused imports/variables, dead code and direct function-to-integer cast
  warnings; no source files were changed by the build.
- Compiled binary: package `0.2.0`, revision
  `123f3458f37172d71a068af894e63ab01a92fb59`, source fingerprint
  `sha256:ce7527c6d0dca7847a86d11d388c1431924b70b09180af7480b3327e9adc412d`.
  CLI registry is `boreal.cli.registry.v1`, envelope is
  `boreal.protocol.envelope.v1`, workflow assets are
  `boreal.workflow.assets.v1`.
- Linked SQLite reports version `3.46.1`; the binary reports a `3.51.3` release
  floor with enforcement disabled. This container is a source/API execution
  environment, not evidence of the release SQLite floor or native artifact
  matrix.
- The V4 Python plan validator passes at 14/85/100 with 24 required journeys
  and three deferred S10 tasks. `bwrk template validate` accepts the V4
  template; its application dry run contains 100 records. App readback reports
  100 imported records and no dependency cycles. The runtime assigned actual
  milestone ID `boreal-final-milestone`; never derive future work IDs from plan
  keys without the app's readback.
- Earlier Global audit test counts in `RESULTS.md` and
  `AUDIT_REMEDIATION_RESULTS.md` concern earlier snapshots. T01's card has no
  local test requirement. S00-T90 owns exact-combined-tree validation.

## Fresh-project bootstrap observations

Execution is in the newly initialized local project `boreal-final-push-cloud`
inside this verified clone. It is a new local execution state, not restoration
of prior user history. The only project authority established by `bwrk init`
is its local Operator identity; the `--agents codex` setup option installs
Codex skill files and is not an Agent-role enrollment. No agent credential or
role was changed. Automatic-dispatch work must use an actually enrolled Agent;
never substitute the Operator identity to make those tasks pass.

The following canonical-API observations are follow-through candidates for the
S12 owners:

| Observation | Exact evidence | Candidate follow-through |
| --- | --- | --- |
| Empty-project context fails while the published-memory manifest is absent. | Fresh `bwrk context show` returned `service_unavailable: memory import I/O failed: No such file or directory`. `bwrk memory init` returned idempotent/no-change and says a published manifest is created on first verified publication; no direct file or database workaround was used. | Make empty context/bootstrap usable while retaining the publication contract; S12-T04/T05 reread their paths. |
| Source catalog reads are not callable over the project service. | `bwrk commands 'source list'` reports `service=false`; the actual `bwrk source list ... --socket ...` request returned `unknown_command_namespace`. `bwrk next` can still guide, and `source add` is callable; this execution captured the exact T01 task card through that API. | Add the missing service-addressable typed source read in S12-T05 and qualify source-guided starts in S12-T06. |
| Work history read failed in this fresh project. | `bwrk work history --project boreal-final-push-cloud boreal-final-milestone --socket ...` returned `ambiguous column name: project_id`. | Reproduce at dispatch, find the narrow query/wire fix under S12-T03 or T05, and preserve history. No SQL was used. |

These are observed runtime results, not blanket claims about the entire
product. Do not fix them by writing the canonical database directly, inventing
source identity, or force-stopping a live service.

## Current source and evidence map

The paths below are navigation anchors. Re-read them at the assigned head;
line numbers and prior audit text are not stable evidence.

| Area | Sources to reread | Existing behavior to retain / delta boundary |
| --- | --- | --- |
| Global transactions, identity, history and transfer — S00/S01/S04/S06 | `crates/domain/src/global_manager.rs`; `crates/store/src/global_manager.rs`; `crates/application/src/global_manager.rs`; `crates/cli/src/global_commands.rs`; `crates/cli/src/global_service.rs`; `project/GLOBAL_MANAGER.md`; `project/build-plan/global-manager/AUDIT_REMEDIATION_RESULTS.md` | Global is separate from project attempts. Revision, durable operation/readback, retained history, transfer validation and bounded detail already exist. Verify exact behavior. Physical backup/restore and maintenance ownership remain S01. |
| Global TUI, daily views, capture and help — S00/S02/S05/S06/S07 | `apps/global-tui/src/{client,model,interaction,view}.ts`; `apps/global-tui/tests/`; `crates/application/src/global_manager.rs`; `crates/cli/src/global_commands.rs`; `skills/boreal-route/`; `skills/manifest.json`; `project/AGENT_GUIDANCE.md`; `project/GLOBAL_MANAGER.md` | Keep the separate service-backed TUI, keyboard flows, notes/history/links, and current scoped capture. S00 adds normal CI/portable PTY coverage; S05–S07 address date semantics, Personal Inbox/provenance, complete daily surfaces and the two-authority route. |
| Global paging, linked reads and worker bounds — S04/S05/S07 | `crates/application/src/global_manager.rs`; `crates/cli/src/global_service.rs`; `crates/cli/src/global_commands.rs`; `apps/global-tui/src/{client,model}.ts`; `project/build-plan/global-manager/AUDIT_REMEDIATION_RESULTS.md` | Snapshot/detail paging, fixed worker pools, freshness and last-good counts exist. Confirm each exact query's totals/completeness; never collapse unavailable linked state to zero or block standalone Global. |
| Global backup, logical transfer and scale — S01/S04/S10 | `crates/store/src/global_manager.rs`; `crates/application/src/global_manager.rs`; `crates/cli/src/global_commands.rs`; `scripts/validation/global/`; `project/build-plan/boreal-final-state/sprints/BW-S10/` | Keep logical import/export distinct from physical backup. Measure real scale first, preserve history, and keep the three optional S10 experiments deferred. |
| Machine update, installers and release identity — S00/S02/S03/S11 | `crates/cli/src/update.rs`; `crates/cli/src/main.rs`; `crates/cli/src/service.rs`; `install.sh`; `.github/workflows/{ci,release}.yml`; `scripts/release/`; `docs/INSTALL.md`; `docs/PACKAGING.md` | Bootstrap, install and declared artifacts exist. Verify first-use resolution, checksum layout, Node preflight, user-data retention, machine authority and paired recovery; do not claim untested platforms. |
| Project schema, backup, Intake and Send — S08/S09/S11 | `crates/store/src/{lib.rs,identity.rs,cli_features.rs}`; `project/spec/schema-v3.sql`; `crates/application/src/intake.rs`; project-service routes in `crates/cli/src/service.rs`; S08/S09 task cards | Project owns execution and Intake. Preserve current restore and Intake paths; add fresh physical restore identity and immutable delivery receipts before any cross-store Send. |
| Project planning, attempts, proof and review — S00/S12/S13 | `crates/domain/src/{work_model_v3.rs,acceptance.rs,actions.rs}`; `crates/application/src/{hierarchy.rs,runtime.rs,status.rs,guidance.rs,completion.rs,evidence.rs,session.rs,template_planning.rs}`; `crates/store/src/{work_model_v3.rs,completion.rs,acceptance.rs,execution.rs}`; `crates/cli/src/{main.rs,project_context.rs,template_commands.rs,command_registry.rs}`; `project/AGENT_GUIDANCE.md`; `project/STATUS_MODEL.md` | Preserve the trusted guide/next, enrollment, attempt fences, evidence and close path. Add general-work fields and routes without another lifecycle. Specifically recheck output contracts, input lineage, attributable typed decisions, artifact bytes and reviewer exact-set binding. |
| Dates, waits, work templates and UI — S05/S12/S13 | `crates/domain/src/{time_policy.rs,work_model_v3.rs}`; `crates/application/src/{hierarchy.rs,planning_v3.rs,cycle_runtime.rs}`; `crates/cli/src/{global_commands.rs,template_commands.rs,command_registry.rs}`; `apps/tui/`; `apps/global-tui/`; `GENERAL_WORK_CONTRACT.md`; the S13 cards | Keep existing UTC due/not-before and cycle scheduling behavior. It does not imply correct civil-time follow-up or named wait decisions. Extend the same work model and clients for versioned optional output contracts and reference workflows. |
| Portable agent access, context and memory — S12/S13 | `crates/source/src/`; `crates/memory/src/`; `crates/cli/src/{project_context.rs,memory_commands.rs,knowledge_parity.rs,service.rs}`; `crates/service/src/application_route.rs`; `project/spec/workflows/`; `project/INTERFACES.md`; `skills/` | Preserve content-addressed source and Git-published memory authorities. Repair missing empty-project bootstrapping and the service route gap through supported app/protocol paths. Keep headless install/restart evidence separate from compile success. |
| Deferred scope and global/project boundary — S09/S10/S11 | `project/build-plan/boreal-final-state/{DEFERRED.md,MASTER_PLAN.md,WORKFLOW_CONTRACT.md,GENERAL_WORK_CONTRACT.md}`; `project/build-plan/boreal-final-state/sprints/BW-S10/`; `project/build-plan/global-manager/AUDIT_REMEDIATION_RESULTS.md` | Keep reminders, saved views, team sync, Gantt, rich editing and automatic provider launch deferred unless an explicit trigger changes. A local project is not hosted SaaS or a provider-account launch. |

## Dispatch and evidence rules

1. Bind every task to the exact source/binary, protocol, database project,
   actor/session, task card and current whole-file grant. Git plan keys are not
   runtime IDs.
2. Check both canonical BWRK readiness and non-overlapping full-file ownership
   before dispatch. One active owner per shared whole file across sprints.
3. Keep Operator-only plan/setup work on an authorized local Operator session.
   Automatic tasks require enrolled Agent actors and distinct sessions; do not
   impersonate Operator. Reviewers require their declared reviewer role.
4. Preserve every failed attempt and evidence record. Reconcile uncertain
   mutations by operation ID before retrying. Never force-break a live lock.
5. Use the task's local-check policy. T90 owns combined sprint validation;
   exact release and all J01–J24 journeys belong to S11. Report pass, fail,
   unsupported and not-run separately.
6. No broad Cargo tests, release build, remote check or deployment is inferred
   from the plan validator, the `bwrk` source compile or the fresh local plan
   import. T01 ran no product test suite.
