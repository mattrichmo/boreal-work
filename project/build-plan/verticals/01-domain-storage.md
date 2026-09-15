# Vertical 01 — Rust domain and SQLite storage

## Purpose

Build the first authoritative work-state slice: typed Rust domain objects and
rules, followed by a SQLite WAL store that commits work mutations, attempts,
reservations, audit events, operation results, and revisions atomically. This
vertical establishes the only valid transition path that the application,
service, CLI, and future TUI may call. It is the implementation of Delivery
Plan sections 0–1, not a placeholder for adapter-specific behavior; see
[DELIVERY_PLAN.md](../../DELIVERY_PLAN.md), [ARCHITECTURE.md](../../ARCHITECTURE.md),
and [STATE_AND_CONCURRENCY.md](../../STATE_AND_CONCURRENCY.md).

## Task-index alignment

This handoff is the implementation bundle for `P1-01` through `P1-06`:

- `P1-01` — typed work model and transitions (steps 1–3).
- `P1-02` — dependencies, readiness, and rollups (steps 1 and 3).
- `P1-03` — SQLite schema and migrations (steps 4–5).
- `P1-04` — transaction and idempotency boundary (steps 6–7).
- `P1-05` — revisioned read queries (step 9).
- `P1-06` — project/work/sprint application use cases (step 9). The full
  attempt lifecycle is implemented in P2, using the store primitives here.

Entry gate: `P0-07` (revalidated contracts). Exit gates: `P1-07` independent
review, `P1-08` reconciliation, and `P1-09` revalidation. The crash and load
evidence produced here is later consumed by `P5-01` and `P5-02`; those gates
do not expand this vertical's ownership.

## Owned paths

- `crates/domain/**`
- `crates/store/**`
- `crates/application/**` only for the P1-06 work/sprint use cases; its P2
  runtime owner takes this path after the P1-09 integration handoff
- `crates/domain/Cargo.toml` and `crates/store/Cargo.toml` when dependencies
  are required for this vertical
- `project/spec/**` only for domain-transition or schema fixtures explicitly
  required by this handoff
- Domain/store test fixtures under the owned crates

Do not edit `crates/cli/`, future `crates/service/` or
`crates/protocol/`, `apps/tui/`, memory publication code, or unrelated project
documents. The integration owner combines this vertical with other lanes as
described in [NEXT_AGENT_TASKS.md](../../NEXT_AGENT_TASKS.md).

## Prerequisites

1. Freeze the v2 identifiers, work hierarchy, status/eligibility matrix,
   attempt states, operation envelope, and migration mapping as fixtures. Any
   unresolved policy in [DECISIONS.md](../../DECISIONS.md) must be recorded as
   a named decision before it affects a persisted format.
2. Read the contracts in [PRODUCT.md](../../PRODUCT.md),
   [AGENT_LIFECYCLE.md](../../AGENT_LIFECYCLE.md),
   [STATUS_MODEL.md](../../STATUS_MODEL.md),
   [INTERFACES.md](../../INTERFACES.md), and
   [STATE_AND_CONCURRENCY.md](../../STATE_AND_CONCURRENCY.md).
3. Keep the current scaffold API-compatible where practical, but treat its
   `WorkStore::snapshot` and `StoreError` definitions as scaffolding to extend,
   not as permission to create a second state model.
4. Establish a temporary fixture project and record baseline/build commands.

## Concrete outputs

- Pure, typed IDs and value objects with validation for work, attempt, session,
  operation, actor, fence, revision, source/blob references, timestamps, and
  structured receipts.
- Domain transition functions/tables for work status, dispatch eligibility,
  dependency readiness, attempt lifecycle, fencing, reservation ownership, and
  closeout policy. Invalid transitions return typed errors.
- Parent/child and blocking-dependency validation, including cycle detection
  and rules that derive normal `queued` prerequisite waits separately from
  hard `blocked` intervention, never from a scheduler cache.
- SQLite schema and migrations for projects, work hierarchy, dependencies,
  attempts, current reservations, sessions, audit events, revisions, operation
  identities/results, receipts, and content-addressed blob metadata.
- WAL initialization, foreign keys, indexes, busy/transaction configuration,
  bounded revisioned snapshots, and short write transactions.
- Atomic store commands for create/update work, dependency changes, and a
  minimal competing-claim primitive, plus idempotent operation replay. P2
  extends these transactions for accept/checkpoint/release/finish.
- Store tests and fixtures proving competing claims, crash atomicity, read
  availability, and snapshot consistency. Blob implementation belongs to P3.

## Ordered steps

1. (`P1-01`, `P1-02`) Convert the contract tables into fixtures first. Keep persisted
   `draft/open/closed/cancelled` lifecycle separate from derived
   `queued/ready/blocked/complete` and attempt phase; define explicit
   `automatic/operator_only/paused` dispatch policy, hard reason codes,
   retry deadline, and close-only default prerequisite satisfaction. Define
   one current attempt per task and one current execution per session.
2. (`P1-01`, `P1-06`) Expand domain types without importing SQLite, JSON, terminal/UI, process,
   or network concerns. Give every externally meaningful value a stable
   parser/formatter and make timestamps, revisions, and fences monotonic where
   the contract requires it.
3. (`P1-01`, `P1-02`) Implement pure validators for hierarchy, dependency acyclicity,
   dependency readiness, claim capacity inputs, attempt ownership, lease/fence
   checks, cancellation/expiry replacement, receipt structure, and finish
   preconditions. Return enough typed context for adapters to produce stable
   errors.
4. (`P1-03`) Design migrations around the canonical-state rules. Add uniqueness and
   foreign-key constraints for current attempts, reservations, current session
   executions, and operation IDs. Store historical attempts and failed
   receipts separately from current pointers; never overwrite provenance to
   make health appear green.
5. (`P1-03`) Initialize one project database in WAL mode with explicit pragmas and
   migrations. Add indexes for current attempts, eligibility/readiness,
   revision cursors, audit subjects, and bounded active snapshots. Reserve
   source/blob references in the schema; actual blob publication is P3-01.
6. (`P1-04`, `P1-06`) Implement a store transaction harness: validate/parse before invocation,
   begin a short write transaction, reread current rows, recheck domain rules,
   mutate rows, append one audit event, advance the project revision, persist
   the operation result, commit, and only then publish derived work. No test,
   subprocess, network call, Git operation, serialization, or wait belongs in
   the transaction.
7. (`P1-04`, `P1-06`) Implement atomic claim. In one transaction select only explicitly eligible,
   dependency-ready work, recheck capacity and current-attempt uniqueness,
   create attempt/reservation with a new fence and lease deadline, and return
   attempt ID, fence, lease, and snapshot revision. Competing callers must get
   a typed conflict/empty result, not a second reservation.
8. (`P1-04`, handoff to `P2-01`) Define the fenced store transaction interface
   for accept/checkpoint/release/finish and test its constraints. P2 implements
   those transitions and their full crash matrix through this interface.
9. (`P1-05`, `P1-06`) Implement revisioned reads and work/sprint use cases that materialize all requested rows at one
   revision, calculate totals independently of row limits, close the read
   transaction, and then allow serialization. Do not expose a capped active
   list as a total or silently serve a stale projection as current.
10. (`P1-09` evidence, later reused by `P5-01`/`P5-02`) Run the injection matrix and integration checks below. Record schema
    version, migration notes, changed paths, command/environment, timings, and
    known limitations for the next application/runtime agent.

## Invariants

- SQLite is authoritative for live work, attempts, operational memory links,
  revisions, and audit events; no Git file or adapter-owned table coordinates
  claims ([STATE_AND_CONCURRENCY.md](../../STATE_AND_CONCURRENCY.md)).
- Work status and effective eligibility are derived consistently from canonical
  task/dependency/current-attempt/time/policy state; labels, parents, and
  scheduler history cannot make queued, hard-blocked, paused, operator-only,
  expired-review, or terminal work automatically claimable.
- At most one current attempt exists per task and at most one current execution
  exists per session. A replacement increments the fence; stale attempts cannot
  mutate the replacement.
- Every committed mutation has one monotonic project revision, an append-only
  audit event, and an idempotent operation result. An uncertain client timeout
  is resolved by operation-ID readback, never guessed from process status.
- A referenced blob is published only after verified write/digest/size metadata;
  failed evidence and historical attempts remain inspectable.
- A snapshot reports one revision for all fields, full counts independent of
  pagination, and no open read transaction during rendering or serialization.
- A transaction is short and deterministic: it never performs model work,
  parsing, test execution, subprocesses, network calls, Git work, or sleeps.

## Failure injections

Inject each at the named boundary and verify the database is either wholly
before or wholly after the boundary:

- process crash before/after work creation, dependency update, and claim
  commit; P2 adds accept/checkpoint/release/finish crash cases;
- two or more concurrent claimers for one ready task, plus claimers for two
  unrelated tasks;
- duplicate claim and operation timeout followed by readback/retry; P2 adds
  duplicate finish and reordered/stale attempt operations;
- attempted dependency cycle, parent-kind violation, blocked/operator-only/
  paused/terminal claim, invalid receipt, and missing or digest-mismatched blob;
- long read snapshot concurrent with writes and WAL checkpoint; verify reads
  close promptly and writers receive typed busy/backpressure only when the
  configured boundary is actually exceeded.

## Tests

- `cargo test --workspace` with domain transition/property tests and store
  migration/fixture tests.
- In-memory or temporary-file SQLite tests for schema constraints, foreign
  keys, unique current pointers, revision monotonicity, audit append-only
  behavior, idempotency, and snapshot totals.
- A multi-thread/multi-process competing-claim test with a deterministic
  barrier: exactly one winner, no orphan current reservation, and structured
  loser outcomes.
- Crash/reopen tests at every transaction boundary; reopen must migrate or
  recover without half-applied state and repeated repair must be a no-op.
- Constraint tests for one current attempt/session pointer and a monotonic
  fence; P2 owns full lifecycle tests.
- Read/write contention tests with at least ten status readers and unrelated
  writers; assert readers do not take an application-wide exclusive lock.

## Measurable acceptance

This vertical is complete only when all of the following are captured as
command/test evidence:

- A fresh fixture project can create milestone → sprint → task, activate the
  sprint, add a blocker, race two claimers for an eligible task, and return one
  revision-consistent dashboard snapshot. P2 completes accept through finish.
- In 100 repeated competing-claim trials, each task has exactly one winner and
  zero duplicate current attempts/reservations; all losers are typed conflict
  or empty outcomes.
- Crash injection at every P1 boundary yields zero partially committed work,
  claim, or audit rows; P2 extends the full lifecycle crash matrix.
- Duplicate operations return the byte-for-byte equivalent stored outcome and
  do not advance revision or append a duplicate event.
- A snapshot with 10,000 historical attempts keeps active read query cost
  bounded; P2 verifies the serialized status payload size.
- Ten or more concurrent readers remain usable during unrelated writes, and
  record p50/p95/max queue/lock/transaction hold times plus WAL/checkpoint
  observations as required by [DELIVERY_PLAN.md](../../DELIVERY_PLAN.md).
- `cargo test --workspace` passes and the fixture schema/migration version is
  recorded for the application/runtime handoff.

## Excluded scope

- Local API transport, Unix-socket/named-pipe service, writer queue fairness,
  service election, subscriptions, timers, harness adapters, and CLI grammar;
  these belong to vertical 02 or later protocol/CLI lanes.
- Automatic harness launching, model calls, subprocess execution, Git memory
  publication, FTS/embedding indexes, TUI rendering, and legacy migration.
- Cross-project sharing, remote SQLite/network-filesystem use, and policy
  decisions left open in [DECISIONS.md](../../DECISIONS.md).

## Handoff evidence

Provide the integration owner with:

- changed-path manifest and clean ownership check;
- domain transition/receipt fixture IDs and schema/migration version;
- exact test commands, fixture database setup, Rust/SQLite/toolchain identity,
  and scoped-versus-full test classification;
- concurrency and crash-injection matrix with outcomes, revisions, and any
  retained failed evidence;
- p50/p95/max read, lock, and transaction measurements, payload sizes, WAL/
  checkpoint observations, and known limitations;
- explicit statement that no service, CLI, Git, subprocess, or UI work was
  performed in a transaction, followed by the next dependency: application/
  runtime integration.
