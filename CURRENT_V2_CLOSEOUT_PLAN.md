# Boreal v2 — Current-State Closeout and Convergence Plan

Status: active closeout/convergence plan; C0 truth freeze, C1/C2 remediation, C3 authority decision, and C4 validation are complete; current work is C5 release closure, 2026-09-18
Repository: `/Users/cybertron/Code/boreal-work`  
Planning depth: granular, multi-agent, dependency-aware

This plan is for the post-implementation state of Boreal v2. It does not
restart the original build plan. `MASTER_PLAN.md` and the historical M01 sprint
files remain useful for provenance; this file is the current plan for closing
the implementation, reconciling the remaining findings, making the intended
hierarchy authoritative, and producing release evidence.

No `bwrk` planning records are created by this document. The repository root
database is empty, and the available binary does not expose the workflow
resolver required by the planning skill. This is therefore a file-based plan,
consistent with `AGENTS.md` and the existing M01 dispatch protocol.

## 1. Current truth

### 1.1 Git implementation history

The recent implementation history shows that the major product slices already
landed:

| Commit | What it establishes |
| --- | --- |
| `be173b2e` | v2 workflow/hierarchy hardening, domain work-model types, schema-v3 groundwork, migration support, and hierarchy tests |
| `5e5a8cd4` | hierarchy, planning, intake, knowledge, store, service, and dashboard integration |
| `1a233a42` | complete v3 reference-archive inputs |
| `8bc28865` | v2-only review/archive framing |
| `024bf241` | current project setup/installer flow |
| `cdd2bd8d` | current documentation/setup clarification |

The working tree also contains a large uncommitted remediation wave across
service recovery, runtime composition, CLI/service adapters, TUI, memory,
source, and validation. Those changes are user work and must be preserved.
Before assigning implementation work, the coordinator must record the exact
dirty-path manifest and assign exclusive ownership of every dirty path.

### 1.2 Database truth

The checked-in workspace database `.boreal/boreal.sqlite` is only a bootstrap
database: after the required project-context probe it contains the
`boreal-work` project at revision 1, with no work or plan rows. It is not
evidence of a live project migration or of the target hierarchy. The probe was
a project initialization read/context operation; no planning work was created
there.

The focused closeout fixture
`test-project/.boreal/creation-suite-ndv9yyvy/.boreal/boreal.sqlite` reports:

| Fact | Observed value |
| --- | --- |
| Database/user schema version | `2` |
| Status contract | `boreal.work-status/2` |
| Project revision | `58` |
| Work items | `22` |
| Work kinds | `1 milestone`, `1 sprint`, `20 tasks` |
| Work lifecycle | all `open` |
| Dependencies | `15` |
| Attempts | `2 released`, `1 running` |
| Receipts/evidence executions | `4` / `4` |
| Summaries/reviews | `0` / `0` |
| Cycle/intake/work-node tables | none present |

The newest black-box creation fixture is
`test-project/.boreal/creation-suite-7qrycvai/.boreal/boreal.sqlite`. It is a
stress fixture rather than a different schema: revision `228`, `106` work
items, `1` milestone, `1` sprint, and `104` tasks. Its status read reports
`99` queued, `2` ready, `3` blocked, `1` claimed, and `1` expired-review item;
its intake route still rejects with `work-model/3` disabled. The larger fixture
confirms that the current creation logic scales the same v2 hierarchy; it does
not promote the additive model to persisted authority.

The database truth is therefore still the compatibility hierarchy:

```text
milestone → sprint → task
```

The newer decomposition/cycle/intake model exists in source and tests, but it
is not yet the authoritative persisted model in the populated v2 database.
The plan must not claim that it is live until a deliberate authority decision,
materializer or fixture rebuild, and public-route validation are complete.

### 1.3 Closeout summary truth

The supplied forensic closeout summary says that all six implementation lanes
completed work and that workspace tests, focused tests, TUI checks, contract
validation, mutation validation, scoped Clippy, and formatting checks passed at
least once. It also says:

- the latest CLI integration requires independent revalidation;
- the full forensic/smoke matrix predates the final CLI rework;
- V01–V12 have not all passed against the final production composition;
- live socket/TUI tests are environment-limited;
- no final coordinator commit exists;
- the remaining not-fully-closed findings are BW-03, BW-06, BW-09, BW-10,
  BW-15, BW-17, BW-21, BW-22, BW-30, and BW-36;
- independent validation is still pending for BW-05, BW-08, BW-14, BW-16,
  BW-19, BW-34, and BW-37.

This is a closeout and integration problem, not a greenfield implementation
problem.

### 1.4 Current validator delta and disposition

The first independent validation wave is now reconciled against the dirty
working tree. The following items are fixed on the current snapshot and have
focused evidence:

- `[x]` Unknown application outcomes preserve `operation_id`,
  `operation_preserved`, and `readback_required`; CLI outcome/exit tests pass.
- `[x]` A direct CLI mutation acquires the same database election as the local
  service; a live-process regression proves direct `init` is rejected with
  `service_busy`.
- `[x]` Direct and socket `work create` can use the existing atomic
  `expected_revision` application contract; the service boundary test passes.
- `[x]` Stale Unix-socket recovery removes only a verified-unowned socket;
  live endpoint ownership remains typed busy. Four process-level recovery
  tests pass.
- `[x]` Service host tests use one request per socket connection, and the raw
  transport timeout test checks peer EOF rather than assuming the listener
  unlinks its own pathname.
- `[x]` Process race/soak validation now treats `service_busy` as transient
  ownership contention and retries the exact same operation identity; the
  standalone 16-worker race and 10-round soak both pass.
- `[x]` The repository authority files `AGENT_HANDOFF.md` and `MASTER_PLAN.md`
  were restored from `HEAD` after an accidental concurrent deletion and match
  the committed versions exactly.

The following are not closed by those fixes:

- `[x]` The persisted database remains schema/user version 2 with
  `milestone → sprint → task`; C3 explicitly selected this as the sole
  current authority. The additive v3 decomposition/cycle/intake routes are
  catalogued as unavailable and cannot install or mutate a v2 database.
- `[x]` Supported direct/service DTO parity for create, status, and `work
  show` now has focused tests plus live V11 service evidence. The normal v2
  schema does not enable the v3 intake tables, so those routes remain
  explicitly unavailable rather than pretending to be live.
- `[x]` TUI transport remediation now tracks active requests, destroys
  timed-out/failed sockets, rejects new requests after close, and makes close
  idempotent; typecheck, npm tests, and collision-resistant socket coverage
  pass. Real service-backed TUI and PTY evidence remain separate gates.
- `[~]` Service runtime unknown-outcome handling and composed queue-saturation
  evidence are now fixed and focused-revalidated. CLI timer composition now
  reschedules on renew and cancels terminal attempt deadlines; durable
  deadline/stop reconciliation, receipt sidecar state, and restart-mounted
  TUI receipt readback remain open.
- `[~]` Store/application residual: full-graph status reads remain a bounded-
  semantics follow-up; no implicit change is allowed while rollup and
  dependency semantics are still being reviewed.
- `[x]` Store/application remediation now validates same-version schema
  contracts fail-closed, keeps migration repair behind an explicit
  `open_for_migration` boundary, persists dependency expected revisions, and
  proves deep-page continuation, offset-1000 status selection, and
  project-scoped execution readback. Full-graph status reads intentionally
  remain a bounded-semantics follow-up rather than being changed implicitly.
- `[~]` Memory/source residual: one pre-existing publisher-test formatting
  issue and Windows, kill-injection, and ancestor-symlink race evidence remain
  open; the Unix implementation findings are addressed below.
- `[x]` Memory/source remediation now places stale-lock recovery behind
  advisory ownership, rejects manifest/blob/object symlink escapes, and keeps
  repair/rebuild under one rollback-capable mutation boundary. Focused tests
  and scoped Clippy pass; Windows, kill-injection, and ancestor-symlink races
  remain environment-unverified.
- `[x]` V12 production security evidence now covers exact 65,535/65,536/65,537
  envelope boundaries, UTF-8 expansion, and receipt-committed readback after
  sidecar export failure. The security probe passes with live socket access.
- `[x]` V10 production host evidence now proves queue saturation under the
  default 256-request workload, reserved control progress, fake-clock expiry
  (`claimed → expired_review`), and SIGTERM/socket cleanup. Smaller ad-hoc
  workloads can complete too quickly to observe `service_busy`; release runs
  must use the harness default.
- `[x]` V11 production-client evidence reaches ordered items 101 and 1001,
  records valid service-side query metrics (`10` prepared statements for each
  page), proves service-routed `work show`, and proves SIGTERM/socket cleanup.
  The metric is emitted by the elected `SqliteStore` boundary under an
  explicit validation flag; no dynamic SQLite interposer is used.
- `[x]` V04/V06/V07 live TUI evidence now covers the status DTO matrix,
  restart/readback fault boundaries through full-screen closeout, typed
  summary preservation, and committed mutation visibility when refresh fails.
  The socket-capable rerun passes; restricted environments must retain the
  explicit socket limitation.
- `[x]` V01/V02/V03/V05/V08/V09 C4-A production service evidence now passes:
  restart replay and changed-payload conflict, execution-state readback,
  fault boundaries, same/wrong-session ownership, inherited-pipe/SIGTERM
  cleanup, and direct-mutation election rejection are all exercised through
  the built `bwrk` service boundary.
- `[x]` The individual production forensic gates V01–V12 are green, including
  the corrected V03 boundary harness, the rebuilt V11 client, and the V09
  distinction between service-owned mutations and unavailable future routes.
  The current strict full aggregate is `18 pass / 0 skip / 0 fail` against the
  rebuilt managed-SQLite binary. A final coordinator commit and release
  disposition remain required. The local system SQLite is 3.43.2, below the
  3.51.3 release floor; the installed
  Homebrew SQLite 3.53.4 satisfies the gate when the binary is built with
  `RUSTFLAGS='-Lnative=/opt/homebrew/opt/sqlite/lib'`. This is a release
  environment prerequisite, not a reason to weaken the floor. A passing
  focused test is not release closure.

The superseded managed-socket strict aggregate before the current V11 and
route changes was `17 pass / 0 skip / 1 fail`; that artifact is stale and must
not be called current green evidence. A repeat under the current sandbox produced
`13 pass / 4 skip / 1 fail` because Unix-socket creation was denied for TUI,
service-transport, PTY, and guided-closeout; that is an environment result,
not a product regression. The current managed full aggregate is `18 pass / 0
skip / 0 fail`, including workspace tests, TUI and PTY, creation,
protocol/spec conformance, mutation contracts, service transport, the 16-worker
process race, 10-round process soak, fault/clock/reorder, concurrency,
security, release performance under SQLite 3.53.4, packaging, and guided
closeout. No validation gate is currently failing; only final disposition,
dirty-path explanation, and coordinator commit remain.

## 2. Target state

The current release target remains Boreal v2. Its authoritative live work
model is:

```text
project namespace
└── milestone → sprint → task
    ├── dependency edges
    ├── attempts and leases
    └── evidence, review, and closeout
```

The intended refined model is recorded as a future v2 capability, not as live
database truth:

```text
project namespace
├── decomposition
│   ├── milestone containers
│   └── executable or container tasks
├── scheduling
│   └── cycle / sprint assignment
├── intake
│   ├── idea
│   ├── finding
│   ├── question
│   └── revisit
├── dependency edges
├── attempts and leases
└── evidence, review, and closeout
```

The following must remain separate:

- a parent edge answers “what decomposes into what?”;
- a cycle assignment answers “when is this scheduled?”;
- an intake item answers “what has been noticed but not yet accepted as work?”;
- a dependency edge answers “what blocks what?”;
- an attempt/evidence record answers “what execution and proof occurred?”

If the future model keeps the word “sprint,” it should be a user-facing cycle
facade, not a third work kind and not a parent of tasks. Ideas and findings
belong to the future intake layer until explicitly promoted to accepted work;
they are not current `work_item.kind` values.

The transition from the current compatibility database to this target must be
explicit. Do not silently dual-write or let read commands invent a migration.

## 3. Non-goals for this plan

Do not:

- replace the Rust domain architecture;
- replace SQLite;
- rebuild the already-implemented lifecycle, evidence, memory, or TUI slices;
- discard the current dirty remediation work;
- rewrite all recent `v3` source names before behavior and authority are settled;
- add broad new product features while production closeout is incomplete;
- mark a finding fixed because a unit test passed without final-host evidence;
- create or close work through the unavailable/incorrect `bwrk` workflow route.

## 3A. Version and hierarchy convergence decision

The clean current-state label is:

```text
release/runtime/API: v2
persisted user schema: v2
live creation authority: milestone → sprint → task
refactored decomposition/cycle/intake implementation: additive, not live authority
```

The word “v3” in source names describes the newer refactor’s model boundary;
it does not mean the application has shipped a v3 runtime or schema. C3 has
now made the current-state decision explicit:

1. **Option B is selected for this release.** Keep schema v2 and
   `milestone → sprint → task` as the sole persisted authority.
2. Keep the additive decomposition/cycle/intake implementation as future
   groundwork. Its public routes are unavailable and must not auto-install
   the additive schema or mutate a v2 database.
3. Preserve the v3-named source/tests as migration groundwork until a separate
   serialized migration sprint defines one canonical authority, maps legacy
   sprints to cycles without inventing history, and proves unified create/read/
   assignment/intake routes.
4. Normalize names only after behavior and authority are settled. The release
   label remains v2; the source names are not evidence of a shipped v3.

### 3B. Future refinement migration sprint (explicitly not current release work)

The requested richer hierarchy belongs here, after the v2 closeout. It must be
one serialized migration decision rather than another parallel refactor:

| Lane | Exclusive scope | Deliverable |
| --- | --- | --- |
| F1 model/terminology steward | `crates/domain/src/work_model_v3.rs`, model specs | Decide whether “sprint” is the UI name for a cycle; define typed `idea`/`finding` intake kinds and promotion into accepted milestone/task work. |
| F2 migration/data steward | schema-v3 migration, mapping tool, populated fixtures | Map existing v2 milestones/sprints/tasks without inventing parentage or history; preserve IDs, attempts, evidence, and failed states; prove rollback/rebuild. |
| F3 application/store/API steward | v3 application/store adapters and versioned routes | Implement one transaction and one authority for create/read/assignment/promotion; no dual writes or read-time materialization. |
| F4 validation/TUI steward | migration fixtures, route matrix, TUI/service compatibility checks | Validate old/new fixtures, promotion provenance, revision/lease behavior, restart/readback, and bounded status performance. |

F1 is serial. F2 and F3 may work in parallel only after F1 freezes the
terminology and mapping contract; F4 starts after both produce a testable
boundary. The migration sprint exits only when one schema/version is
authoritative, every intake promotion retains source provenance, old v2 data
has a deterministic mapping or explicit quarantine, and the public route
catalog plus rollback/rebuild evidence are complete. Until then, ideas and
findings remain intake records and are not `work_item.kind` values.

## 4. Multi-agent operating rules

These rules are part of the plan, not optional coordination advice.

1. **One owner per write set.** No two agents edit the same Rust source,
   schema, manifest, protocol fixture, or TUI file set concurrently.
2. **Use isolated worktrees where practical.** If a shared worktree is used,
   each assignment receives an explicit dirty-path snapshot and exclusive
   paths. An agent stops when an unowned change overlaps its target.
3. **Shared contracts have a steward.** Operation IDs, outcome names, status
   DTOs, evidence identity, revision semantics, and schema authority are not
   redesigned independently by separate agents.
4. **Validation agents do not repair product code.** They produce exact
   reproductions and findings; the owning implementation lane fixes them.
5. **A worker report is not closure.** Each finding goes through fixed,
   no-change, or approved-deferred disposition, followed by revalidation on
   the combined source snapshot.
6. **The coordinator owns integration files.** Only the coordinator or named
   integration owner edits `MASTER_PLAN.md`, this plan, sprint ledgers,
   shared manifests, release identity, and final closure reports.
7. **Unknown delivery is never retried with a fresh mutation ID.** Preserve
   the original operation identity and read it back before retrying.
8. **No force-breaking locks or deleting failed evidence.** Recovery must
   distinguish live owners, stale owners, uncertain delivery, and durable
   failure.

Every assignment must include:

```text
input commit and dirty-path manifest
exclusive write set
read-only reference paths
finding IDs or contract slice
focused checks
integration checks
unrun checks and environment limits
review owner
revalidation gate
```

## 5. Closeout sprint map

These sprints are intentionally narrower than the original M01 build sprints.
They can run concurrently where their write sets and gates allow it.

| Sprint | Scope | Parallel lanes | Entry | Exit |
| --- | --- | --- | --- | --- |
| C0 | Truth freeze and integration baseline | coordinator only | this plan and closeout summary | final dirty manifest, finding ownership, version/authority decision, reproducible baseline |
| C1 | Rust runtime and store/application revalidation | service-runtime; store/application; protocol fixtures | C0 | backend findings reproduced/fixed or dispositioned on one source snapshot |
| C2 | CLI/service composition and public adapter parity | CLI composition; TUI client; knowledge/source | C1 contract snapshot; TUI and knowledge may overlap | direct/service/TUI parity and public closeout routes verified |
| C3 | Hierarchy authority and v2 convergence | model steward; fixture/migration steward; read-only route reviewer | C1/C2 contracts stable | one declared persisted authority, cycle/intake routes or explicit deferrals, fixture/migration evidence |
| C4 | Independent production validation | host/fault; concurrency/soak; TUI/PTY; security/performance | C2; partial probes may start after C1 | V01–V12 and required smoke/fault evidence against final composition |
| C5 | Release closure | coordinator and independent release reviewer | C3 and C4 findings reconciled | refreshed closure ledger, clean package evidence, final commit and ship/deferral decision |

## 6. Detailed sprint assignments

### C0 — Truth freeze and integration baseline

**Owner:** coordinator/integration steward.  
**Concurrency:** serial; no product implementation changes.

| Task | Exclusive write set | Deliverable |
| --- | --- | --- |
| C0-01 source snapshot | `scratch/` baseline artifacts only | Git HEAD, dirty-path manifest, toolchain identity, database hashes, and exact input snapshot |
| C0-02 finding ledger refresh | `scratch/Boreal_Work_Forensic_Audit_Closure.md`, closure JSON only | BW-01–BW-37 status mapped to current code, tests, and remaining evidence |
| C0-03 contract decision | `CURRENT_V2_CLOSEOUT_PLAN.md` and coordinator decision note | Decide whether the refactored hierarchy is the v2 target now; define sprint/cycle naming and idea/finding intake semantics |
| C0-04 baseline rerun | read-only source plus `scripts/validation/**` reports | Run the already-passing focused checks against the final dirty snapshot; record skips instead of hiding them |

**Exit gate:** no unowned dirty path, no ambiguous operation/status/evidence
contract, and a named owner for every remaining BW finding.

### C1 — Rust runtime and store/application revalidation

These lanes are disjoint and may run concurrently after C0. They must not
change CLI or TUI adapters.

#### C1-A — Service runtime and transport

**Exclusive paths:** `crates/service/src/**`, `crates/service/tests/**`.  
**Focus:** BW-01, BW-03, BW-08, BW-09, BW-27.

Verify active admission versus durable replay, bounded journal retention,
control capacity, deadline/stop semantics, clean socket teardown, and actual
production hook composition. Add or repair host-level tests where the current
tests only exercise library primitives.

**Exit evidence:** duplicate operation, unknown delivery, saturation,
deadline, shutdown, and socket tests against the composed host; no claim that
queue priority alone is capacity reservation.

#### C1-B — Store and application boundaries

**Exclusive paths:** `crates/store/**`, `crates/application/**`.  
**Focus:** BW-15, BW-16, BW-21, BW-22, BW-32, BW-33, BW-36.

Verify read-only opening, migration/repair isolation, revision enforcement,
keyset continuation, bounded/batched reads, project-scoped readback, and
receipt/sidecar ordering. Keep application lifecycle and policy out of CLI
handlers.

**Exit evidence:** read-under-writer, stale-revision, continuation, query-count,
project-scope, and sidecar-failure tests on the final schema snapshot.

#### C1-C — Protocol and conformance fixtures

**Exclusive paths:** `crates/protocol/**`, `project/spec/protocol/**`,
`project/spec/conformance.json`, and protocol-only fixtures.  
**Focus:** shared DTOs, outcomes, enum spellings, metadata, bounds, and
operation readback.

This lane is the contract steward. It may not redesign lifecycle semantics;
it records the already-decided behavior in typed fixtures consumed by CLI,
service, and TUI lanes.

**Exit evidence:** direct/service response fixtures agree for every supported
route and negative inputs preserve structured error/recovery metadata.

### C2 — CLI/service composition and public surface parity

The CLI composition lane owns the high-conflict adapter files. No other agent
edits them during this sprint.

#### C2-A — CLI and service composition

**Exclusive paths:** `crates/cli/src/**`, `crates/cli/tests/**`.  
**Depends on:** C1-A, C1-B, C1-C contract snapshots.  
**Focus:** BW-02, BW-03, BW-04, BW-05, BW-06, BW-07, BW-10, BW-11, BW-13,
BW-14, BW-17, BW-28, BW-29, BW-30, BW-31, BW-37.

Verify that the executable actually mounts the runtime safeguards already
implemented in the libraries. Unify direct and socket behavior, preserve
session and operation identity, make finish durable, validate raw service
inputs, and expose only truthful routes.

**Exit evidence:** CLI package tests, direct/socket parity fixtures, final
worker validation, and a real service-routed evidence/finish journey.

#### C2-B — TUI surface

**Exclusive paths:** `apps/tui/**`.  
**Depends on:** C1-C typed DTO fixtures; may run concurrently with C2-A.  
**Focus:** BW-05, BW-12, BW-13, BW-18, BW-19, BW-20, BW-21, BW-23, BW-24,
BW-25, BW-26, BW-30, BW-37.

Use the canonical service contract. Do not add a second state machine or
compensate for backend ambiguity in UI code.

**Exit evidence:** typecheck, tests, line-shell journey, full-screen Finish,
unknown-outcome recovery, deep-page retrieval, terminal sanitization, and
chunk-safe input. PTY/socket limitations must be tested in an environment
where they are available or explicitly recorded as a release blocker.

#### C2-C — Memory and source recovery

**Exclusive paths:** `crates/memory/**`, `crates/source/**`, their tests, and
memory/source-specific fixtures.  
**Depends on:** C0; may run concurrently with C1 and C2-A.  
**Focus:** BW-34, BW-35 and source-index regressions.

Verify lock ownership, crash journals, staged/worktree byte identity, exact
Git publication, disabled hooks/configuration, bounded subprocesses, and
recovery after partial publication.

**Exit evidence:** crash/retry/tamper/lock/hook/filter/signing/descendant
tests and an explicit statement of what remains environment-unverified.

### C3 — Hierarchy authority and v2 convergence

This is the only sprint that changes the persisted work-model authority. It
starts after the runtime and adapter contracts are stable so hierarchy work
does not fork operation, status, or evidence semantics.

#### C3-A — Model authority steward

**Exclusive paths:** `crates/domain/src/work_model_v3.rs`, related domain
tests, `crates/application/src/hierarchy.rs`,
`crates/application/src/planning_v3.rs`, `crates/application/src/intake.rs`,
`crates/store/src/work_model_v3.rs`, related store/application tests, and the
selected canonical schema/migration files.  
**No parallel edits:** schema, domain model, or migration files.

Make one explicit decision. For this closeout, the decision is already made:

```text
Option A: promote the refactored decomposition/cycle/intake model into v2;
Option B: keep it as an explicitly unavailable future adapter.
```

Option B is selected for the current release. Do not change the canonical
schema or materialize a parallel projection in C3. The work of this sprint is
to make the deferral truthful: catalog v3-dependent routes as unavailable,
prevent them from opening or mutating a v2 database, and add negative
evidence. Option A becomes a separately authorized migration sprint.

Required invariants:

- milestones/tasks own decomposition;
- cycles/sprints own scheduling;
- ideas/findings remain intake until promotion;
- cycle assignment never reparents work;
- containers cannot be claimed;
- evidence and attempts remain attached to execution identity;
- no dual-write ambiguity remains.

#### C3-B — Migration and fixture steward

**Exclusive paths:** `scripts/validation/creation/**`, migration-specific
fixtures, and `test-project/**` fixture data.  
**Depends on:** C3-A contract decision.

Produce creation scenarios for the current v2 compatibility fixture and
negative scenarios proving that v3-dependent routes do not install tables or
change revisions. Do not create a fake production migration in this sprint.
Preserve the populated fixture as evidence of the live v2 hierarchy. The
legacy-sprint-to-cycle mapping remains a future migration decision.

#### C3-C — Public-route reviewer

**Read-only until findings are assigned:** command registry, CLI/service
handlers, TUI client, and hierarchy application APIs.  
**Focus:** cycle create/activate/assignment, sprint facade behavior, intake
promotion/disposition, and truthful availability metadata.

This reviewer does not edit the high-conflict adapters. Findings return to the
named C2 or C3 owner for repair.

**Exit gate:** schema v2 and the populated fixture are documented as the sole
current authority, v3-dependent routes have explicit unavailable status, no
unavailable route changes the database, and every advertised current v2 route
has a real implementation.

### C4 — Independent production validation

These lanes are validation-only and can run concurrently after C2. They may
add reports and fixtures in their exclusive validation directories, but do not
repair product source.

| Lane | Exclusive paths | Evidence |
| --- | --- | --- |
| C4-A host/fault | `scripts/validation/process/**`, `scripts/validation/fault/**`, mutation fixtures | V01–V03, V05, V08–V09; duplicate/replay, unknown delivery, crash/readback, finish-stage recovery |
| C4-B concurrency/soak/performance | `scripts/validation/concurrency/**`, `scripts/validation/soak/**`, `scripts/validation/status/**`, performance reports | V10–V11; claim races, queue saturation, read-under-writer, page/scan/query budgets |
| C4-C TUI/PTY | `scripts/validation/tui/**` and TUI fixture files only | actual service socket, full-screen Finish, restart hydration, page-two navigation, input decoding |
| C4-D security/publication | `scripts/validation/security/**`, publication-specific reports | V12, terminal sanitization, hooks/configuration, lock ownership, tamper recovery |

Every failed check must include the owning source lane, reproduction command,
source snapshot, and whether it blocks C5.

### C5 — Release closure

**Owner:** coordinator plus an independent release reviewer.  
**Exclusive paths:** `.github/workflows/**`, release docs, `README.md`,
`project/spec/manifest.json`, `scratch/**`, final plan ledgers, and package
metadata. No implementation agent edits these files during C5.

Tasks:

1. `[x]` Rerun the complete validation matrix against the current integrated
   snapshot: strict full suite `18 pass / 0 skip / 0 fail`.
2. `[x]` Refresh BW-01–BW-37 and V01–V12 after the final CLI rework; no finding
   remains `open` in the current closure ledger.
3. `[~]` Confirm the release identity, schema/API/protocol versions, and
   hierarchy terminology are consistent in the final release decision.
4. `[x]` Run package/install, TUI/PTY, guided-closeout, and unfamiliar-agent
   validation journeys through the full suite.
5. `[~]` Create one coordinator commit only after the worktree contains no
   unexplained product or validation changes.
6. `[~]` Record the final decision: `ship`, `ship with approved deferrals`, or
   `do not ship`.

## 7. Dependency and concurrency graph

```text
C0 truth freeze
  ├── C1-A service runtime ─────┐
  ├── C1-B store/application ───┼── C1 contract snapshot ── C2-A CLI composition
  └── C1-C protocol fixtures ───┘                         ├─ C2-B TUI
                                                          └─ C2-C memory/source

C1 + C2 contract stability ── C3-A model authority ── C3-B fixtures/migration
                                                   └─ C3-C route review

C2 stable ── C4-A/B/C/D independent validation ── finding reconciliation

C3 + C4 revalidation ── C5 release closure ── coordinator commit
```

The maximum safe implementation concurrency is the parallel lanes inside C1
and C2. C3 is intentionally serialized around schema/model authority. C4 is
highly parallel because it owns validation paths, not production code.

## 8. Required evidence commands

The exact command environment must be recorded with each result. At minimum,
the final integrated snapshot must run:

```text
cargo test --workspace --locked --offline
cargo test --workspace --no-run --locked --offline
cargo clippy --workspace --locked --offline
npm run typecheck --prefix apps/tui
npm test --prefix apps/tui
python3 project/spec/validate_contracts.py
python3 project/spec/workflows/test_validator.py
python3 scripts/validation/run_full_suite.py
scripts/service-smoke.sh
scripts/tui-service-smoke.sh
scripts/guided-closeout-smoke.sh
scripts/dashboard-smoke.sh
```

Where a command is unavailable, the plan requires either an approved
environment change or an explicit release-blocking limitation. A skipped
live-socket or PTY test is not equivalent to a pass.

For the current macOS host, the release-profile commands must be run with the
managed SQLite library selected, then the linked binary identity must be
recorded:

```text
RUSTFLAGS='-Lnative=/opt/homebrew/opt/sqlite/lib' cargo build --bin bwrk --locked --offline
RUSTFLAGS='-Lnative=/opt/homebrew/opt/sqlite/lib' python3 scripts/validation/run_full_suite.py --profile full --strict --require-no-skips --require-current-binary --require-sqlite-floor
```

The path is host-specific validation configuration, not a portable product
dependency; CI/release packaging must provide an equivalent SQLite runtime at
or above 3.51.3.

## 9. Definition of done

This plan is complete only when:

- the current dirty implementation wave has been integrated without lost
  changes;
- every BW finding has a current evidence-backed disposition;
- V01–V12 have passed against the final production composition, or an
  approved release decision names the exact blocked gates;
- direct CLI, service, and TUI behavior agree for supported routes;
- unknown delivery preserves operation identity and is recoverable after
  restart;
- evidence, finish, summary/review, and closeout are durable and observable;
- the persisted hierarchy has one declared authority;
- the v2 database/fixtures do not falsely claim the new hierarchy is live;
- cycle/intake routes are truthful and complete or explicitly unavailable;
- source and memory publication recovery preserves provenance;
- the package builds outside the legacy workspace;
- the final worktree and release artifacts are explained and committed;
- the final coordinator decision is recorded.

## 10. Current next action

C0 truth freeze, the main C1/C2 remediation wave, the C3 authority decision,
and C4 validation are complete on the existing dirty snapshot. C5 release
closure remains:

- `[x]` C0-01: source history, database truth, and authority-file integrity
  are captured in this plan.
- `[x]` C0-02: the finding ledger is reconciled against the independent
  validator reports; only final coordinator disposition remains open.
- `[x]` C0-03: v2 remains the runtime/schema release label, and Option B is
  explicit: the refined v3-named model is future groundwork, not an implicit
  migration or current authority.
- `[x]` C0-04: focused Rust, TUI, contract, recovery, and managed SQLite
  release-floor baselines are green, and the full production-composed
  aggregate is green.
- `[x]` C1-A remediation slice: direct ownership, checked creation, stale
  socket recovery, unknown-outcome metadata, and false-flake transport tests
  are fixed and focused revalidated.
- `[x]` C1-A service-runtime slice: unknown post-commit/panic outcomes,
  response-boundary retention, and composed normal/control queue saturation
  are fixed and focused-revalidated by the service-runtime owner.
- `[x]` C1-A CLI timer composition: renew responses replace the attempt
  deadline and successful release/submit/close responses cancel it.
- `[~]` C1-A remaining: durable deadline/stop reconciliation and production
  readback of the durable stop result.
- `[x]` C1-B store/application remediation: revision enforcement, schema
  fail-closed behavior, migration-only opening, and application boundary
  proofs are focused-revalidated.
- `[x]` C1-C/C2 adapter parity for supported v2 routes is reconciled; v3-only
  routes are explicitly unavailable and covered by negative no-mutation
  evidence.
- `[x]` C3 authority convergence: schema/user v2 and
  `milestone → sprint → task` are the sole current authority; the additive
  v3-named model is future migration groundwork.
- `[x]` C4 individual validation: V01–V12 pass on their current focused or
  managed-host probes, including V03 and V11.
- `[x]` C4 aggregate: the strict full suite is `18 pass / 0 skip / 0 fail`
  against the rebuilt managed-SQLite binary.
- `[~]` C5 closure: refresh the ledger with this final aggregate, explain all
  dirty/untracked paths, record approved BW-34/BW-35 host deferrals, and make
  the final ship/deferral decision in one coordinator commit.

### Active concurrent wave

The current wave is already split into disjoint write sets. These assignments
are the authoritative ownership boundary until the coordinator integrates and
re-runs the combined checks:

| Lane | Owner scope | Current state | Integration gate |
| --- | --- | --- | --- |
| C1-A service runtime | `crates/service/src/**`, `crates/service/tests/**` | runtime remediation and production host probes pass; durable deadline/stop reconciliation remains a tracked follow-up | service tests, workspace tests, and V10/closeout host evidence |
| C1-B store/application | `crates/store/**`, `crates/application/**` | remediation complete; full-graph status semantics remain a bounded review item | stale-revision, bounded reads, continuation, project scope, and sidecar checks |
| C2-B TUI transport | `apps/tui/src/node-transport.ts` and matching TUI tests | transport hardening and socket/PTY evidence pass; restricted-host limitations remain explicit | typecheck, npm tests, service/TUI smoke, and PTY |
| C2-C memory/source | `crates/memory/**`, `crates/source/**`, matching tests | hardening complete; environment limits recorded | lock/symlink/repair tests and publication recovery checks |

The coordinator retains exclusive ownership of `crates/cli/**`, the plan and
finding ledgers, shared release/validation manifests, and the hierarchy
authority decision. The C1/C2 implementation wave is now integrated as the
current dirty snapshot; remaining concurrent work is validation-only. Any
future schema/model migration must use the separately serialized refinement
sprint below, not reopen the current release authority.

The independent forensic wave ran with disjoint validation ownership:

| Lane | Exclusive validation paths | Gates |
| --- | --- | --- |
| C4-A host/fault | `scripts/validation/process/**`, `scripts/validation/fault/**`, mutation fixtures | V01–V03, V05, V08–V09 pass |
| C4-B scale/concurrency | `scripts/validation/concurrency/**`, `scripts/validation/soak/**`, status/scale fixtures | V10 and V11 pass; aggregate included in 18/0/0 full suite |
| C4-C TUI/PTY | `scripts/validation/tui/**` and TUI fixture files | V04, V06–V07 pass |
| C4-D security/bytes | `scripts/validation/security/**` and byte-boundary fixtures | V12 pass |

These agents produced evidence only. The coordinator wired their production
checks into `scripts/validation/forensic_audit.py`; the current managed run
reports V01–V12 green and the full suite reports `18 pass / 0 skip / 0 fail`.
Remaining environment limitations are retained as explicit BW-34/BW-35
deferrals rather than hidden by the aggregate.

The next safe concurrent wave is validation/review only:

```text
C1-C protocol fixtures (read-only until the shared DTO decision is frozen)
C2-A CLI/service composition (coordinator-owned)
C3-C public-route review (read-only; no schema/model edits)
```

C2-A owns the high-conflict CLI/service composition in the current snapshot;
no new C2 implementation edits are needed for this closeout. C3-C may review
the public hierarchy routes read-only. C3 and C4 must not be treated as
evidence that the v3 model is already live in the database. The coordinator
owns the final aggregate, ledger, and release-disposition work after the
successful V11 rebuild.

### C5 dirty-path manifest and handoff

This is the current uncommitted ownership map. It is intentionally recorded
before any final commit so a later agent does not overwrite another lane's
work:

| Owner | Dirty paths | Disposition |
| --- | --- | --- |
| Coordinator | `CURRENT_V2_CLOSEOUT_PLAN.md`, `crates/cli/src/**`, `crates/cli/tests/command_registry.rs`, `scripts/validation/forensic_audit.py` | Integrated v2 service-route parity, v3-route truthfulness, no-mutation gating, and aggregate wiring. |
| C4-A host/fault | `scripts/validation/process/forensic_service.py`, `scripts/validation/fault/socket_boundaries.py` | Production V01–V03, V05, V08–V09 validators; V09 accepts unavailable future routes separately from service-owned mutation rejection. |
| C4-B scale/concurrency | `scripts/validation/concurrency/**`, `scripts/validation/status/**` | V10/V11 production validators and documentation; V11 uses opt-in `SqliteStore` metrics, not dynamic interposition. |
| C4-C TUI/PTY | `scripts/validation/tui/**` | Live TUI/PTY evidence and closeout reports. |
| C4-D security/publication | `scripts/validation/security/**` | V12 envelope/publication boundary evidence. |
| C2-C memory/source | `memory/` | Existing project memory publication/reconciliation state; preserve and review as a separate publication set. |

The full strict evidence is recorded in
`scripts/validation/results/full-suite.latest.md` and reports `18 pass / 0
skip / 0 fail`. The ignored scratch ledger is
`scratch/Boreal_Work_Forensic_Audit_Closure.md`. C5 must either commit these
owned paths together after review or document why a path is intentionally
excluded; no path should be reset or deleted as cleanup.
