# Boreal v2 — Current-State Closeout and Convergence Plan

Status: active closeout/convergence plan; C0 truth freeze and C1 remediation are in progress, 2026-09-18
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
`boreal-work` project at revision 1, with no work rows. It is not evidence of a
live project migration or of the target hierarchy. The probe was a project
initialization read/context operation; no planning work was created there.

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

- `[~]` The persisted database remains schema/user version 2 with
  `milestone → sprint → task`; v3 decomposition/cycle/intake code is additive
  and not yet the database authority. C3 must make an explicit v2 authority
  decision and either mount or defer each public route.
- `[~]` Base direct/service DTO parity for create, status, and intake route
  discriminants now has focused CLI tests, but a live socket matrix and one
  shared projection path remain. The normal v2 schema still does not enable
  the v3 intake tables, so those routes must remain explicitly unavailable.
- `[x]` TUI transport remediation now tracks active requests, destroys
  timed-out/failed sockets, rejects new requests after close, and makes close
  idempotent; typecheck, npm tests, and collision-resistant socket coverage
  pass. Real service-backed TUI and PTY evidence remain separate gates.
- `[~]` Service runtime unknown-outcome handling and composed queue-saturation
  evidence are now fixed and focused-revalidated. CLI-owned deadline/stop
  reconciliation, renew rescheduling, terminal timer cancellation, durable
  receipt sidecar state, and restart-mounted TUI receipt readback remain open.
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
- `[ ]` The full forensic matrix is not green: production-composed V01–V12
  gates and a final coordinator commit are still required. The local system
  SQLite is 3.43.2, below the 3.51.3 release floor; the installed Homebrew
  SQLite 3.53.4 satisfies the gate when the binary is built with
  `RUSTFLAGS='-Lnative=/opt/homebrew/opt/sqlite/lib'`. This is a release
  environment prerequisite, not a reason to weaken the floor. A passing
  focused test is not release closure.

The latest strict aggregate before the current service-runtime agent result is
`17 pass / 0 skip / 1 fail`. The 17 passing checks include workspace tests, TUI and PTY, creation,
protocol/spec conformance, mutation contracts, service transport, the 16-worker
process race, 10-round process soak, fault/clock/reorder, concurrency,
security, release performance under SQLite 3.53.4, packaging, and guided
closeout. The single failure is `forensic-audit`, which reports all twelve
production-composed scenarios as unavailable rather than silently converting
partial unit evidence into release passes.

## 2. Target state

The target release remains Boreal v2. The intended work model is:

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

If the product keeps the word “sprint,” it should be a user-facing cycle
facade, not a third work kind and not a parent of tasks.

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

Make one explicit decision:

```text
Option A: promote the refactored decomposition/cycle/intake model into v2;
Option B: keep it as an explicitly unavailable future adapter.
```

Given the current product direction, Option A is the target, but it must be
implemented as one authoritative model rather than a v2 work-item table plus
a parallel projection. If a pre-release reset is safe, rebuild fixtures. If
not, write and test one explicit materializer.

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

Produce creation scenarios for both the current compatibility fixture and the
target v2 model. If the root database remains empty, prefer deterministic
fixture rebuild over a fake production migration. If preserving old fixture
data, prove the mapping from sprint parents to cycles and milestone/task
decomposition.

#### C3-C — Public-route reviewer

**Read-only until findings are assigned:** command registry, CLI/service
handlers, TUI client, and hierarchy application APIs.  
**Focus:** cycle create/activate/assignment, sprint facade behavior, intake
promotion/disposition, and truthful availability metadata.

This reviewer does not edit the high-conflict adapters. Findings return to the
named C2 or C3 owner for repair.

**Exit gate:** one persisted authority is documented, the populated fixture
truth is either intentionally preserved or transformed, and every advertised
hierarchy route has a real implementation or explicit unavailable status.

### C4 — Independent production validation

These lanes are validation-only and can run concurrently after C2. They may
add reports and fixtures in their exclusive validation directories, but do not
repair product source.

| Lane | Exclusive paths | Evidence |
| --- | --- | --- |
| C4-A host/fault | `scripts/validation/process/**`, `scripts/validation/fault/**`, mutation fixtures | V01–V07, duplicate/replay, unknown delivery, crash/readback, finish-stage recovery |
| C4-B concurrency/soak/performance | `scripts/validation/concurrency/**`, `scripts/validation/soak/**`, `scripts/validation/status/**`, performance reports | V08–V10, claim races, queue saturation, read-under-writer, page/scan/query budgets |
| C4-C TUI/PTY | `scripts/validation/tui/**` and TUI fixture files only | actual service socket, full-screen Finish, restart hydration, page-two navigation, input decoding |
| C4-D security/publication | `scripts/validation/security/**`, publication-specific reports | V11–V12, terminal sanitization, hooks/configuration, lock ownership, tamper recovery |

Every failed check must include the owning source lane, reproduction command,
source snapshot, and whether it blocks C5.

### C5 — Release closure

**Owner:** coordinator plus an independent release reviewer.  
**Exclusive paths:** `.github/workflows/**`, release docs, `README.md`,
`project/spec/manifest.json`, `scratch/**`, final plan ledgers, and package
metadata. No implementation agent edits these files during C5.

Tasks:

1. Rerun the complete validation matrix against the final integrated commit.
2. Refresh BW-01–BW-37 and V01–V12 status after the final CLI rework.
3. Resolve every finding as `fixed`, `no_change`, or approved `deferred` with
   owner, user impact, and follow-up gate.
4. Confirm the release identity, schema/API/protocol versions, and hierarchy
   terminology are consistent.
5. Run standalone/package/install and unfamiliar-agent closeout journeys.
6. Create one coordinator commit only after the worktree contains no
   unexplained product or validation changes.
7. Record the final decision: `ship`, `ship with approved deferrals`, or
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

C0 is partially complete and C1 has started on the existing dirty snapshot:

- `[x]` C0-01: source history, database truth, and authority-file integrity
  are captured in this plan.
- `[~]` C0-02: the finding ledger is refreshed from the independent validator
  reports; the generated forensic ledger still needs a final coordinator
  reconciliation.
- `[~]` C0-03: v2 remains the runtime/schema release label, but the refined
  hierarchy authority and the role of the additive v3 model are still an
  explicit C3 decision, not an implicit migration.
- `[~]` C0-04: focused Rust, TUI, contract, recovery, and managed SQLite
  release-floor baselines are green; full production-composed gates remain
  open.
- `[x]` C1-A remediation slice: direct ownership, checked creation, stale
  socket recovery, unknown-outcome metadata, and false-flake transport tests
  are fixed and focused revalidated.
- `[x]` C1-A service-runtime slice: unknown post-commit/panic outcomes,
  response-boundary retention, and composed normal/control queue saturation
  are fixed and focused-revalidated by the service-runtime owner.
- `[~]` C1-A remaining: CLI-owned deadline/stop reconciliation, renew
  rescheduling, terminal timer cancellation, and production readback of the
  durable stop result.
- `[x]` C1-B store/application remediation: revision enforcement, schema
  fail-closed behavior, migration-only opening, and application boundary
  proofs are focused-revalidated.
- `[~]` C1-C and adapter parity: shared DTO/projection parity remains under
  review; no schema authority change is allowed yet.

### Active concurrent wave

The current wave is already split into disjoint write sets. These assignments
are the authoritative ownership boundary until the coordinator integrates and
re-runs the combined checks:

| Lane | Owner scope | Current state | Integration gate |
| --- | --- | --- | --- |
| C1-A service runtime | `crates/service/src/**`, `crates/service/tests/**` | runtime remediation complete; combined host probes open | service tests, workspace tests, then production host probes |
| C1-B store/application | `crates/store/**`, `crates/application/**` | remediation complete; full-graph status semantics remain a review item | stale-revision, bounded reads, continuation, project scope, and sidecar checks |
| C2-B TUI transport | `apps/tui/src/node-transport.ts` and matching TUI tests | transport hardening complete; live gates open | typecheck, npm tests, real service/TUI smoke, PTY where available |
| C2-C memory/source | `crates/memory/**`, `crates/source/**`, matching tests | hardening complete; environment limits recorded | lock/symlink/repair tests and publication recovery checks |

The coordinator retains exclusive ownership of `crates/cli/**`, the plan and
finding ledgers, shared release/validation manifests, and the hierarchy
authority decision. No agent may begin C3 schema/model work while this wave
is unresolved. The next safe merge order is service-runtime report, then the
store/application and adapter reports, followed by a single combined test
run; only after that may production validation and the authority decision
start.

The next safe concurrent wave is:

```text
C1-B store/application
C1-C protocol fixtures (read-only until the shared DTO decision is frozen)
C2-B TUI transport
C2-C memory/source
```

C2-A owns the high-conflict CLI/service composition after the C1 contract
snapshot. C2-B can proceed in parallel against the frozen DTO fixtures. C2-C
owns memory/source hardening. C3 and C4 must not be treated as evidence that
the v3 model is already live in the database.
