# Boreal: finish the production product

Date: 2026-09-26. Baseline inspected: `dcfae1196e2732bec3228169ee28044a54f9493c`.
Status: final execution plan; source investigation complete, implementation under this plan not yet started.
Execution state: [execution/FINAL_STATE.json](execution/FINAL_STATE.json).

## Authority and finish line

The user requested one end-to-end production plan, multiple agents working in
a continuous loop, implementation in batches, and comprehensive testing at the
end. This plan is the current dispatch authority. The M01/M02/PF plans and the
48-item implementation queue remain historical requirements and evidence; their
old wave counters and checked boxes do not control this execution. Preserve
their history. Do not reopen their task graphs or produce another replacement
plan after completing one batch.

**Finish means the qualified current product is installed and usable on the
user's machine, its supported release artifacts are delivered, and an unfamiliar
agent can manage actual work through it.** A source archive, passing compilation,
temporary install, all-green implementation checklist, or implementation report
alone is insufficient.

The final product must let the user initialize/select a project, plan milestones
and tasks across parallel cycles, enroll agents, run concurrent work, see
ownership and progress, verify results, independently review where required,
accept closeout, advance dependencies, recover interrupted work, preserve
project memory, and upgrade without losing data. CLI, service and dashboard must
agree on the same persisted outcomes.

Preserve the accepted Rust architecture and D01–D29 in `project/DECISIONS.md`.
The supported manager is local and harness-neutral: Codex/Claude launch their
agents; Boreal owns work, sessions, authority, guidance, proof and recovery.
Automatic provider spawning, a global cross-project manager, remote hosts, a
browser UI are already deferred under D29. The full MCP surface is excluded by
the existing launch scope in `project/build-plan/README.md`. This plan
does not add those products or introduce new deferrals for core workflows.

Today's target is to complete this execution, with the native installation
activated as soon as its qualification passes while the other supported target
jobs finish. This is an execution priority, not a fabricated delivery-time
guarantee. An external blocker must identify the exact missing capability and
remaining action; it never converts unfinished work into a production claim.

## What the source investigation established

Three agents inspected the current lifecycle, agent manager, UI and delivery
paths. These are source findings, not newly executed test results.

| Finding | Current source | Work package |
| --- | --- | --- |
| CRITICAL: claim pins source/config; evidence runs that immutable preclaim source and submission seals it. There is no public fenced transition binding the agent's changed result before verification. Directory capture is Operator-only. | CLI `evidence_run_result`, store claim/acceptance, source capture authorization | F2 first, F5; F1/F3 integrate |
| Init creates an Operator; an ordinary worker needs an enrolled Agent, but the installed onboarding does not explain the full usable sequence. | `crates/cli/src/{setup,authority,credentials,main}.rs` | F1 |
| Non-claim guidance falls back to advisory `work show`; its generated argv loses actor/session/harness/transport, and required inputs must be reconstructed by the caller. | `crates/cli/src/main.rs`, `guide_for_work` | F1, F5 |
| Workflow examples disagree with parser grammar, including positional `evidence run` and incomplete finish inputs. Legacy global skills still reference incompatible workflow IDs. V2 skill folders already contain their own `boreal.yaml`. | `project/spec/workflows/*.json`, `.agents/skills/boreal-*`, setup skill payloads | F1 |
| Independent review mutations already exist as approve/reject/return/revoke. They write `boreal_review_event`, while public list/show read legacy `review`, hiding canonical decisions from history. | `crates/store/src/completion.rs`, `crates/store/src/lib.rs::review/review_list` | F2, F5 |
| Intake capture replaces four old aliases. Promotion lacks a usable public adapter; triage/defer/resolve/archive need a persisted update path. Container disposition is a separate backend operation. Existing intake service handlers are excluded from transport support. | `crates/cli/src/{main,service,command_registry}.rs`, application intake/hierarchy | F3, F5 |
| Closeout records summary identity/digest, while retained summary body bytes and public readback are not connected through the inspected finish path. | CLI finish, store summary records, source/artifact storage | F2, F5 |
| Dashboard exposes seven lifecycle actions; planning, dependencies, operational cycle boards, source selection, memory changes, recovery and history remain unavailable or raw read-only dialogs. | `apps/tui/src/client.ts`, `full-screen.ts`, `line-shell.ts`, `ui/*` | F4, F5 |
| Dashboard receipt hydration has an optional interface but no production implementation, so reopening the dashboard can leave Finish disabled despite persisted proof. | `VersionedServiceApi.readReceipt`, `VersionedServiceClient`, receipt service route | F2, F4, F5 |
| Package smoke proves install/status/isolation, not the installed agent lifecycle/dashboard. The full runner insists on `target/debug/bwrk`. The old guided smoke seeds source data with SQL and uses outdated setup. | `scripts/release/{package-smoke.sh,two-project-smoke.py}`, `scripts/validation/run_full_suite.py`, `scripts/guided-closeout-smoke.sh` | F6, F7 |
| TUI packaging recursively copies machine cache; new source still uses package version 0.2.0; latest handoff never activated its package into the actual user prefix. | `scripts/release/build_release.py`, workspace version, installer/update | F6, F8 |
| This checkout's `.boreal/project.json` currently points to a temporary authentication-review database. An additional local database exists. Neither may be silently overwritten or assumed to be the user's intended work store. | Local project binding; inspect through public application reads | F6, F8 |

Do not rebuild already implemented review, cycle, memory, migration or recovery
engines because a historical plan says they are missing. `review decide` is an
obsolete umbrella spelling; real review actions exist. Finish already creates
typed summaries; independent summary CRUD is not required merely to remove an
unavailable alias. Map old spellings to their actual supported replacements.

## Fixed work packages

All packages below are mandatory. Existing working behavior satisfies a package
item once its complete user path is connected and covered by final acceptance;
it does not require reimplementation. Additional defects found during execution
are attached to these packages with a named owner and failing scenario.

### F1 — Installed agent onboarding and executable guidance

Owner: Agent A; coordinator integrates shared CLI/setup/DTO edits.

- Complete the default operator -> enrolled worker -> scoped session setup,
  including reviewer/publisher enrollment when those roles are required. Reuse
  existing credential/grant logic and show concrete executable setup guidance.
- From an empty source bank, guide the authorized operator through public
  source capture and configuration selection, then bind the resulting
  identities to the worker's first claim. Repeatedly listing an empty source
  bank cannot count as a working onboarding flow.
- Preserve project, actor, session, harness, attempt, source, revision and
  transport in the entire guide/next/resume loop. Produce the actual supported
  next operation with typed required inputs or an explicit actionable wait/input
  request. Reading the same work record indefinitely is not progress.
- Connect start, checkpoint, heartbeat, lease renewal, proof, submission,
  review wait, finish/release and recovery guidance. Never invent proof or let
  generated instructions grant permissions.
- State who sends heartbeat AND lease renewal at the cadence returned by the
  service, including while an agent is in a long tool call. The harness owns
  liveness scheduling and confirms stopped processes before recovery releases
  resources. Heartbeat alone must not be presented as lease renewal.
- Align every packaged workflow recipe, help entry and Codex/Claude skill with
  the real parser and payload schemas. Resolve skill-local configuration;
  reconcile the embedded skill/workflow package versions. Make v2 project skills
  take precedence and report incompatible legacy adapters without deleting
  unrelated global skills.
- Provide one short entry instruction usable by an unfamiliar supported agent:
  use Boreal in this project, follow its next eligible work until idle or a
  concrete intervention. It must not require the coordinator to narrate commands.

Exclusive implementation paths: application `guidance.rs`, `workflow_assets.rs`,
`project/spec/workflows/`, project-local v2 skill assets, onboarding/operator docs.
Shared integrations: CLI `main.rs`, `setup.rs`, `authority.rs`, `credentials.rs`,
`command_registry.rs`, `service.rs`, protocol models.
Completion journeys: J1, J3, J4, J5, J9.

### F2 — Complete lifecycle, review history and durable closeout

Owner: Agent A, starting with final-result binding; coordinator integrates
store/CLI seams. F1's final executable guidance consumes this transition.

- First agree and implement an authorized, fenced public result-capture/binding
  transition. Preserve immutable claim/input provenance; bind the changed
  result to the current attempt/fence and proof revision, and invalidate old
  receipt/review applicability when the result changes. The worker may capture
  its own scoped result; it may not replace the authorized verifier, weaken
  pinned requirements or capture another task/project. The verifier and sealed
  submission must refer to this final result. F3 supplies capture/artifact
  storage; F5 exposes the same identity over CLI/service and F4 displays it.

- Expose canonical review events through public list/show/history, retaining
  rejected, returned, revoked, superseded and legacy decisions with explicit
  provenance and submission identity. Preserve current authorization rules.
- Connect persisted source/proof/submission/summary/review readback across CLI,
  service and dashboard. Reopening a client must recover its ability to finish
  from authoritative records, without re-importing a made-up receipt.
- Persist bounded immutable summary body bytes in the artifact/source layer,
  with public readback. Keeping only a digest or relying on the caller's
  temporary input file does not preserve the delivered result.
- Connect the real implementation-to-proof transition: after an agent changes
  source, capture and bind the resulting source/configuration through supported
  revisioned operations before verification and submission. Supersede earlier
  proof as required; verifying only the pre-implementation claim snapshot does
  not prove the delivered change. Coordinate artifact/source storage with F3.
- Ensure accepted close, dependency unblocking and cycle/container rollups
  follow the same canonical outcome. Pending review, incomplete proof, release
  and cancellation must remain distinct from accepted close.
- Repair any real interruption/resume/expiry/unknown-operation seams exposed by
  this integration. Preserve failed evidence, fences, resource ownership and
  recovery history. Never recover by force-breaking a live lock.

Exclusive implementation paths: application `runtime.rs`, `evidence_store.rs`,
`evidence.rs`, store `completion.rs`, `acceptance.rs`, `recovery.rs` and narrowly
identified read models. Coordinator owns `crates/store/src/lib.rs` and shared
protocol/CLI registration. Completion journeys: J3–J6, J9.

### F3 — Planning, intake, context and memory as complete workflows

Owner: Agent B; coordinator integrates public command routing.

- Preserve existing milestone/task/cycle/dependency machinery; finish any
  adapter mismatch that blocks create/edit/assign/activate/carry-over/close and
  exact rollups. Define parent decomposition and scheduled cycles consistently
  in commands, guidance and user copy.
- Make acceptance profile selection/pinning and verifier-policy publication
  usable through public commands and the dashboard. Expose the exact pinned
  identities, including review-required and no-review profiles for F2. Agree
  this F3/F5 interface early without delaying independent F2 implementation.
- Expose intake capture/list/show and persist triage, defer/revisit,
  resolve/archive and provenance-preserving promotion through the common
  service/application path. Use the existing provenance model; document whether
  promotion creates work or links an existing target and provide the full path.
- Expose container descendant disposition through the work/container workflow.
  It must not be substituted for an inbox item's lifecycle update.
- Complete source selection, capture/search/citations, bounded project/task
  context and durable handoff through public interfaces. A replacement agent
  must recover context without the previous conversation.
- Connect memory draft -> authorized review -> Git publication -> search ->
  publication readback/reconciliation. Retain exact source versions and commit
  identities; exercise interrupted publication in the final phase.

Exclusive implementation paths: application `hierarchy.rs`, `planning_v3.rs`,
`cycle_runtime.rs`, `intake.rs`, `knowledge.rs`, store `work_model_v3.rs`,
`cycle_commands.rs`, `knowledge.rs`, `memory.rs`, source/memory crates.
Coordinator owns shared store/CLI/protocol files and any new schema migration.
Completion journeys: J2, J6, J7, J9.

### F4 — Operational dashboard

Owner: Agent C. Backend operation names and input/output shapes are agreed with
the coordinator before binding UI actions; implementation may proceed against
that concrete contract while backend wiring is integrated.

- Replace the daily-work placeholders/raw JSON dialogs with usable project,
  milestone/task, cycle board, dependency, active-session and attention views.
- Provide create/edit, cycle assignment/activation/carry-over, evidence/finish,
  independent review decisions, recovery and history actions with clear reasons
  and explicit confirmations where the server requires them.
- Supply a real source picker, receipt/submission/summary readback and persisted
  finish state after restart. Add usable intake and memory search/draft/review/
  publication paths rather than merely listing unavailable capabilities.
- Preserve selection and project scope through refresh/resize/reconnect. Show
  pending, failed, stale and unavailable states accurately; damaged rows must
  not hide healthy siblings or authorize unsafe actions.
- Keep all policy in Rust. Ordinary use must not require hand-entered protocol
  JSON, actor/fence IDs or SQL. Infrequent migration/backup/restore administration
  may use the fully documented CLI; this does not excuse missing daily actions.

Exclusive paths: `apps/tui/src/` and matching TUI fixtures; do not edit generated
installer/build output while F6 owns packaging. Completion journeys: J2–J7, J9.

### F5 — Shared service and CLI integration

Owner: coordinator, continuously alongside F1–F4.

- At the first dispatch, inventory Codex/Claude invocation and authentication,
  native platform runner availability, release/publishing access, actual
  installation and the ambiguous project binding. Executables for Codex,
  Claude and GitHub CLI were found locally; presence alone is not proof of
  authentication. Resolve external inputs while feature work runs, not at F7.
- Own `crates/cli/src/{main,service,command_registry,setup}.rs`, shared protocol
  models, store/application `lib.rs`, manifests and schema wiring. No other
  agent edits these without an explicit ownership transfer recorded in state.
- Actively lease exact functions/sections or a whole shared file to one worker
  when that unlocks a complete path. Record the exclusive owner before edits
  and reclaim ownership after integration; do not let shared-file coordination
  turn into a serial implementation bottleneck.
- Integrate complete worker modules and supplied callsite changes promptly.
  Registry, parser, dispatch support, request mapping, application use case and
  response readback must agree for every supported route.
- Add receipt/review/source/intake/history transport seams needed by workers.
  Bind all reads and mutations to project/caller/operation context. Correct
  stale unavailable text when a real replacement exists.
- Reconcile user-facing status and capabilities against the implemented source.
  Preserve transactional authorization and versioned service transport; no new
  client policy engine or database shortcut.

This is the integration join for F1–F4, not a separate serial implementation
sprint after they finish. Completion journeys: all application journeys.

### F6 — Data continuity, build, install and release preparation

Owner: Agent B after F3; coordinator handles live environment and shared setup.

- Finish public backup/restore, supported v1 migration, upgrade/rollback and
  durable maintenance readback. Verify current-schema upgrades preserve live
  work, attempts, source blobs, memory and history. Unsupported imports retain
  an explicit loss/disposition report rather than fabricated acceptance.
- Inventory the real installation, PATH, services and project bindings early.
  The observed temporary auth-review binding must be resolved before activation:
  inspect candidate stores through application reads, preserve binding/files
  and backups, select the intended project only from evidence or a specific
  user choice if still ambiguous. Never overwrite a candidate to make startup pass.
- Preserve `.boreal/project.json`, credential/configuration references, each
  candidate store and the old installation manifest before binding repair.
  Initial candidate inspection must not initialize, migrate or bootstrap a
  database. Resolve any specific necessary project choice early while other
  implementation continues.
- Prepare a distinct release identity/version from the integrated source. Package
  only required runtime/authored assets; exclude node compile caches and stale
  generated output. Keep CLI, TUI, workflows, skills and installer synchronized.
- Make final acceptance accept an absolute installed binary. Retain source
  integration checks, but remove the assumption that only a debug build can
  prove installed behavior. Replace SQL-seeded guided acceptance with public
  source capture, role enrollment and actual verifier execution.
- Prepare current macOS ARM64, macOS Intel and Linux x86_64 build/qualification
  jobs, fixing unsupported runner labels where needed. Prepare release notes,
  manifest/checksums, update path and rollback instructions before publication.
- Keep generated output, source commits and artifacts attributable. Use a clean
  staging checkout/export when needed; preserve untracked user memory and never
  run a destructive cleanup to satisfy a clean-tree check.

Exclusive paths: `crates/migration/`, non-shared maintenance/update modules,
`scripts/release/`, `scripts/validation/`, installer generation, `.github/workflows/`,
release/operator docs. Coordinate F3 memory/backup artifact ownership before
handoff. Completion journeys: J8, J10–J13.

### F7 — One final qualification and repair loop

Owner: coordinator plus three agents, after F1–F6 are integrated.

- Finish candidate source integration through the normal commit/PR process and
  freeze its immutable revision/version. A later merge that changes source
  invalidates the affected qualification and requires a replacement artifact.
- Run the existing full Rust/TUI/contract/
  formatting/release checks once, plus the installed-product journeys below.
  Reuse existing useful checks; do not create a separate test project per leaf.
- Build one candidate archive per target from that frozen source, record its
  checksum/manifest and install it into the qualification prefix. Run J1–J10
  against the native installed archive and the applicable J12 checks on each
  target. Native qualification permits F8 activation; J11/J13 are completed by
  that actual activation/delivery, not falsely marked passed in a temporary prefix.
- Perform meaningful verification against a captured source and real verifier.
  A `true` gate, fabricated receipt, SQL-injected source, fake controller, or
  source-only pass cannot certify the installed manager.
- Use fresh agent contexts for the unfamiliar-agent runs. Give them installed
  entry instructions, normal scoped identity and project location, without a
  bespoke explanation of the task's implementation or private command recipe.
- Give each qualification lane its own disposable project, database, socket and
  install prefix. Intentional contention scenarios share only their designated
  project. Three stable qualification environments are sufficient; only the
  coordinator touches the real installation and live project.
- Allocate final checks in parallel: A lifecycle/guidance/identity; B data,
  memory/maintenance/concurrency; C dashboard/packaged installation. Coordinator
  gathers failures and integrates repairs.
- Assign each failure back to its owning package immediately. Implement repairs
  in parallel, then rerun the affected scenarios. Rerun the main integrated
  journey when shared lifecycle/service/identity changes affect it. If the
  release payload changes, rebuild and qualify the changed artifact. Reuse
  unaffected passing evidence with its source/artifact identity; stop repeating
  broad checks once no changes or unresolved concerns justify another run.

No new full-plan generation, mandatory review sprint per task or multi-day soak.
No fixing a failure by lowering a required product criterion. The last phase
contains a bounded concurrent run, not an indefinite reliability campaign.

### F8 — Activate, release and demonstrate the finished installation

Owner: coordinator; agents independently check artifacts and deployment readback.

- Consume F7's qualified native archive and immutable source, binary, manifest,
  TUI/asset and archive identities. Do not rebuild simply to activate or publish.
  If a later merge or build changes source or bytes, qualify the replacement
  before activating or promoting it.
- Back up the intended live project and current installation. Gracefully stop
  affected services, install **the same qualified archive** into the actual user
  prefix, and preserve rollback data. Never migrate a live project using a
  guessed binding or stop unrelated work.
- Check both the absolute binary and shell-resolved `bwrk`, assets and version;
  reopen the dashboard against the intended existing project. Use a second real
  project context to verify isolation. Existing history must still be present.
- Run native qualification for every supported distribution target; publish
  those exact qualified archives with release/update/install metadata. If CI
  rebuilds an archive, qualify those rebuilt bytes before promotion. Download
  and install the published archive and compare its checksum with that target's
  qualified checksum. Matching semantic versions alone do not establish identity.
- Publication is part of this plan. If a separate publication approval is
  required, request it once with the exact prepared version/artifacts/notes;
  complete all independent preparation and local activation first. Never label
  an awaiting-publication state as released or require approval for every code
  repair. The planning request itself does not perform publication.
- End with the installed path/version, demonstrated working agent-manager
  journey, release URL and verified target list. Persist any real limitation
  explicitly. Do not end with instructions for another agent to finish setup.

Native usability and full distribution are separate observable milestones so
the user can resume work while other platform jobs run. **Overall completion
requires both; native activation cannot silently waive the declared matrix.**

## Final acceptance: finite product journeys

All rows are required. Coordinator records result, artifact identity and raw
evidence reference in `execution/FINAL_STATE.json`. Failure or unavailable
environment remains open; it is not a pass. Existing accepted deferrals remain
explicitly scoped; absent historical alias names do not create new requirements.

| ID | Observable finish criterion |
| --- | --- |
| J1 Fresh start | From the installed archive, initialize Codex/Claude project skills and enroll Operator, three Agents and an independent Reviewer using public commands. An empty source bank progresses through authorized capture/config setup to first-claim readiness. All generated recipes parse and retain identity. |
| J2 Plan and operate | Create a milestone, parallel cycles, independent tasks plus a dependent task; edit work, pin review-required/no-review profiles, publish verifier policy, assign/activate/carry over and close cycles. Handle unfinished descendants through explicit container disposition. CLI/service/dashboard show the same revisioned statuses and totals; no database editing. |
| J3 Unfamiliar agent loop | Fresh supported Codex and Claude contexts capture/select starting source, discover/claim work whose starting code fails the required verifier, make a real code change, checkpoint, heartbeat AND renew, capture/bind the final result, and obtain passing proof against those changed immutable bytes. Follow submit/finish/wait/next guidance without coordinator command narration. Record unavailable harness authentication early. |
| J4 Proof, review and close | Premature close is rejected. Independent reviewer returns/rejects then approves the corrected submission bound to J3's final result. A further result change makes old proof inapplicable. Events stay visible; accepted close unlocks the dependent task; a no-review profile closes without invented review. Remove the caller's temporary summary file, reopen the UI and read the original retained summary text and receipt. |
| J5 Concurrency and authority | Two contenders for one task produce one current owner; independent tasks progress concurrently. Wrong-project, wrong-role, forged caller, stale fence and changed-input operation reuse fail. An attempted shortcut through direct CLI and service cannot bypass required proof or review. |
| J6 Failure and recovery | Interrupt a worker and service; resume from durable session/operation state without duplicate mutations. Exercise expiry and reviewed resource release before replacement. Failed proof/old attempts stay visible; no live-lock breaking. |
| J7 Context and memory | Capture and triage intake; promote with provenance, defer/revisit or resolve/archive and verify the persisted inbox state. Retrieve source citations, create/review/publish memory, search it, reconcile an interrupted publication, and hand off to a fresh agent that recovers the same scoped knowledge. |
| J8 Existing data | Supported legacy import and current-schema upgrade preserve original history and explicit loss/disposition. Backup includes referenced artifacts; restore into an isolated project survives restart. The original remains intact, and rollback behavior is demonstrated. |
| J9 Dashboard | A real PTY runs the packaged service-backed TUI through planning, source choice, agent monitoring, proof, review, recovery and memory actions. Resize/reconnect/late replies preserve scope, selection and truthful state. Healthy siblings remain usable beside damaged records. |
| J10 Concurrent operating run | Run a bounded 15-minute realistic session with at least ten readers and three workers while the dashboard refreshes, including one restart. Record latency/resource behavior against existing accepted budgets; no lost/duplicate work, starvation or fabricated totals. Repair measured failures, not proposed imaginary scale problems. |
| J11 Native installed release | Qualified archive and manifest match actual prefix and PATH binary. Dashboard opens the intended existing project; its prior work/history survives; a second project stays isolated. Native install/update/rollback work with the real packaged TUI. |
| J12 Supported distribution | Native macOS ARM64, macOS Intel and Linux x86_64 jobs qualify their own installed artifacts. Package/workflow/skill identities and checksums agree; failing or missing platform runs block that distribution claim. |
| J13 Delivered channel | Integrated source version and release notes identify the qualified bytes. Published installer/update path downloads the archive whose checksum matches that target's qualification and activates it in a fresh prefix. Actual user installation remains healthy. |

The enforceable unfamiliar-agent criterion is that canonical mutations reject
skipped prerequisites and fresh supported agents can follow the provided
workflow. Requiring proof that an arbitrary model can never ignore a sentence
is not an executable acceptance criterion and must not become an endless gate.

## Multi-agent execution loop and ownership

Use four slots: coordinator plus A, B and C. Keep three independent workers
active whenever eligible work exists. Respect file ownership; do not give two
workers an entire overlapping crate. The coordinator owns shared CLI, protocol,
`lib.rs`, schema, manifests and this execution ledger unless explicitly leased.

1. **Dispatch now:** A starts F2's result-binding/closeout seam and then F1's
   complete guided flow; B gets F3 then F6; C gets F4. Coordinator performs F5,
   integrates onboarding/setup and begins external/live-environment inventory
   immediately. Agree the result/profile/source interface first so all lanes
   bind to one contract without waiting for the full F2 implementation.
2. Each assignment supplies package ID, exact owned files, exclusions, current
   source/diff identity, required behavior, shared integration requests and
   final journey IDs. Read the existing relevant vertical handoff once. The
   current plan supplies the sprint/leaf authority; do not wait on old PF gates.
3. Workers implement complete paths and report changed files plus the remaining
   integration seam. Small compile/type checks are allowed only when needed to
   unblock integration. Comprehensive suites and new scenario execution wait
   until F7, in accordance with the user's request.
4. Coordinator reviews/integrates the diff, marks `integrated`, and immediately
   dispatches the next open item. Worker assertions and checked boxes cannot
   mark `qualified`, `installed` or `released`.
5. Workers give progress/checkpoint updates at least every 20 minutes, without
   halting useful work to wait for the coordinator. A blocked worker supplies
   the smallest concrete integration request and takes another disjoint item.
   Confirm a stopped worker's writes/processes before replacing it.
6. Once F1–F6 are integrated, enter F7. Failures map back to existing packages,
   get repaired in parallel and re-enter affected qualification. Do not end the
   user turn after a successful slice or ask whether to continue each wave.
7. Enter F8 as soon as native qualification passes; run other target jobs in
   parallel with safe local activation. Finish all supported release delivery.

The coordinator maintains one state file, not another planning database or a
new handwritten lifecycle engine. These are implementation dispatch records,
not Boreal project records. Do not use the outdated global `bwrk` to instantiate
this plan in a temporary/authentication-test database.

## Completion language and scope control

Package states: `ready`, `in_progress`, `integrated`, `qualifying`, `repair`,
`qualified`, `blocked`. Delivery states are recorded separately as
`not_installed`, `installed`, `not_published`, `published`, `channel_verified`.
The final overall state is `complete` only after J1–J13 pass for the final
artifact and the user's actual installation is activated.

- Report completed user capabilities, active blockers, artifact identity and
  the next concrete action. Do not use line count or implementation checkboxes
  as evidence of product completion.
- New observed defects enter the existing package/repair loop. Architectural
  preferences, speculative scale work, renamed legacy aliases and unadopted
  historical task graphs do not become new release requirements.
- Never silently remove required review, evidence, isolation, history,
  recovery, platform or installation criteria to meet the calendar target.
- No further refactor is authorized solely to improve organization. Implement
  the smallest coherent repairs and integrations needed for this finish line.
- A missing external credential/approval is reported specifically and early;
  finish every independent item while it is pending. An environmental socket
  restriction should trigger the available permission/runner path, not an
  unexplained handoff or a false pass.
