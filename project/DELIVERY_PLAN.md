# Delivery plan and verification

This is an implementation sequence, not a promise that the current scaffold
already provides these features. Make each slice executable and measurable
before starting the next. Keep a small fixture project and preserve the legacy
audit as comparison evidence.

This page explains architectural sequencing. For claimable leaves, exact
prerequisites, agent write ownership, and phase gates, use the
[authoritative build plan](build-plan/README.md). Where this broad sequence
groups work differently, the build-plan task index governs assignments.

## 0. Baseline and contracts

- Record legacy operation timings on the same test project: process startup,
  compatibility digest, lock wait/hold, replay/projection, serialization,
  payload bytes, retries, and changed-state flag.
- Record lifecycle timestamps: ready, claimed, accepted, first semantic
  checkpoint, verification, completed, reservation released.
- Freeze v2 IDs, conditional status/eligibility transitions, trusted
  directive/next-action registry, operation envelope, and migration/parity
  mapping as fixtures. Design schema constraints before adding adapters.
- Reproduce suspected failures before treating the audit's inferred cause as
  proven. Do not force-break live user locks to create a baseline.

## 1. Work core and transactional store

Implement work hierarchy, dependencies, eligibility, attempts/reservations,
audit events, revisions, and operation idempotency in Rust. Add SQLite schema
and migrations. A claim selects eligible work and creates the attempt in one
transaction. A completion validates the current fenced attempt and closes
work, attempt, and reservation with one event/revision commit.

Acceptance: two or more competing claimers produce one winner; all others get
a structured conflict/empty result. A crash after any transaction boundary
leaves either the old or new complete state, never half an assignment. Status
readers remain available during writes.

## 2. Runtime service and CLI

Add the local service, process election/restart, writer queue, bounded read
pool, revision notifications, and Rust CLI. Keep domain correctness in the
application/store layer so offline maintenance uses the same transitions.
Implement current-attempt status and compact JSON envelope before automatic
dispatch. Add the Rust-owned `guide`/`next` compiler and versioned CLI/API
surface before treating the runtime slice as feature-complete.

Acceptance: CLI commands from different harness processes use the same
project identity and schema; a service restart preserves attempts; duplicate
operation IDs return the original outcome; unknown outcomes resolve through
readback; 10,000 historical attempts do not enlarge routine active status.
An agent with no goal receives current context and a trusted safe action or a
precise idle/blocker result without reading a giant historical payload.

## 3. Harness-neutral execution

Implement accept, heartbeat, checkpoint, release, cancellation, expiry, and
manual adoption. Then add optional deterministic automatic dispatch using the
same atomic claim. Define harness adapters as launch/observe/cancel ports;
they cannot edit work status directly.

Acceptance: blocked or operator-only work never redispatches after release;
manual claims appear in current attempts; a stale session cannot finish a
replacement attempt; capacity is based on live fenced attempts. Long-running
healthy tools do not trigger needless status/nudge loops.
Conditional status, open gates, and attempt fences determine the next action;
the same agent can follow it through evidence, verification, and finish or
release without parent-model command choreography.

## 4. Memory bank

Implement immutable source intake, cited draft notes/decisions, published Git
memory, a recoverable publication job, and deterministic retrieval. Keep Git
work outside work-state transactions. Add FTS as a versioned index, not as
another authority.

Acceptance: a fresh clone can import published memory and citations; an
interrupted publication is recoverable without duplicate entries; missing
blobs are reported; project scopes stay isolated. A large source parse or
Git commit does not delay ordinary claim transaction holds.

## 5. TypeScript TUI

Create the TS client after the protocol fixtures are stable. Reuse only the
useful visual/navigation behavior of the old TUI. Display current sprint,
ready/active/blocked work, real totals, attempt liveness, and memory links.
Support create, activate, claim, release, evidence, and complete through the
same application API. Render the same effective status and contextual guide
as the CLI; never infer a separate TUI claim workflow.

Acceptance: no silent first-sprint fallback, no capped-row totals, no mixed
snapshot detail, no per-refresh CLI subprocesses, and no writer lock held by
rendering. A mount/action test must prove each advertised TUI feature is
reachable and wired to the production client.

## 6. Migration and extraction

Export legacy milestones, sprints, tasks, parents, blockers, statuses,
reservations/attempts, evidence references, Git bindings, and supported
memory records. Import into a fresh v2 project with a dry-run report and an
explicit unsupported-record list. Preserve failed evidence and historical
attempts. Package the core route/context/plan/claim/finish/review/handoff/
health/source-memory workflows and prove them against the v1 parity inventory;
only specialized custom packs are deferred. The v2 workspace is now the
canonical repository root; keep its build, fixtures, and docs self-contained
and preserve the legacy implementation only through the v1 archive branch and
tag.

## Concurrency benchmark

Use the same project/workload and validation policy before and after. Run at
1, 3, 10, 30, and 50 concurrent agents/processes, with the TUI on and off.
Include claims, heartbeats, evidence, finishes, status reads, large source
intake, and a Git publication. Include 10,000 historical attempts and enough
work to exercise pagination. Separate local same-host operation from any
future remote-host benchmark.

Record p50/p95/max for queue wait, SQLite transaction hold, snapshot read,
status end-to-end latency, and completion latency. Also record WAL size/
checkpoint age, busy/conflict results, output bytes, CLI calls per useful
transition, unchanged-read share, orphan attempts, duplicate summaries,
redispatches of blocked work, and TUI-on/TUI-off throughput. Establish the
legacy baseline before setting speedup targets. A faster result that skips
required validation is not an improvement.

## Handoff format for implementation agents

Each implementation handoff includes: reproduction matrix, chosen invariant,
schema/protocol changes, migration notes, regression tests, before/after
measurements, changed files, and remaining limitations. Mark a scoped check
as scoped; do not call it full release validation.
