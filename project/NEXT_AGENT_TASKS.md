# Next agent tasks

This is the earlier high-level lane sketch. The authoritative leaf tasks,
prerequisites, and write ownership now live in the
[full v2 build plan](build-plan/README.md) and
[task index](build-plan/TASK_INDEX.md). In particular, the service crate is
owned by the protocol/service lane, with runtime policy supplied by the
attempt lane; use the detailed handoffs if this sketch differs.
The build plan also has a required agent-guidance lane (P2-10–P2-12) and a
canonical workflow/parity lane (P4-10–P4-11); this earlier sketch predates
those non-negotiable product requirements.

Agents may work in parallel only
with disjoint write scopes and a named integration owner. Do not claim a phase
complete from unit tests alone; run the relevant end-to-end action and report
the exact snapshot, command, configuration, and environment used.

## First pass: settle contracts

**Architecture steward** — write protocol fixtures, domain transition table,
and a proposed SQLite schema under `project/spec/`. Decide the open policies
in [DECISIONS.md](DECISIONS.md) with the project owner before changing persisted
formats. Include examples for successful, rejected, busy, stale-attempt, and
unknown-outcome responses. This agent owns only project specification files.

**Legacy behavior analyst** — produce a source-to-v2 mapping and migration
fixture from representative legacy projects. Record unsupported records and
data-loss risks. This agent owns only `project/legacy-map/` and test fixtures;
the v2 runtime must not import legacy modules.

**Benchmark analyst** — instrument or reproduce the legacy workload without
breaking live locks. Record the baseline fields in [DELIVERY_PLAN.md](DELIVERY_PLAN.md),
including TUI-on/TUI-off throughput. This agent owns only benchmark scripts
and reports. Source-only audit hypotheses stay marked as hypotheses until
reproduced.

## Second pass: core implementation

**Domain agent** — owns `crates/domain/` and domain tests. Implement typed IDs,
parent/dependency rules, task and attempt transition tables, dispatch
eligibility, and receipt validation. No database, CLI, or UI imports. Requires
the first-pass schema/transition fixtures.

**Store agent** — owns `crates/store/`, migrations, and store tests. Implement
SQLite WAL state, unique current-attempt/session constraints, operation-ID
idempotency, short transactional mutation plus audit event, revisioned read
snapshots, and blob reference integrity. Requires stable domain IDs and schema
fixtures. Test crash/retry and competing claims.

**Application/runtime agent** — owns `crates/application/` lifecycle policy
and agreed `crates/service/src/runtime/` hooks. Implement one use-case path
for adapters, liveness, dispatch eligibility, and attempt recovery. Service
election, queue, read pool, and notifications belong to the service agent.
Requires domain and store integration.

**CLI/protocol/service agent** — owns `crates/cli/`, `crates/protocol/`, and
service transport/queue/read pool/subscription code. Implement
versioned envelopes, stable command grammar, typed errors, operation readback,
and JSON/human output. Generate protocol fixtures for TS validation. Requires
application commands, but can prepare client/fixture work in parallel.

## Third pass: memory and interface

**Source/memory agent** — owns source and memory modules designated by the
application/store integration owner, plus memory fixtures. Implement immutable
source versions, extraction jobs, cited drafts, Git publication in a dedicated
memory worktree, reimport, and revisioned retrieval. No Git operation inside a
work-state transaction. Begin after the publication authority decision.

**TUI agent** — owns `apps/tui/`. Build a TypeScript client of the versioned
local API. Port selected navigation and refresh behavior from the old TUI;
support the complete create/claim/finish loop, accurate totals, one snapshot
per detail view, and revision-based refresh. Begin after protocol fixtures.

## Integration owner

After each pass, one integration owner merges the slices, runs a shared
worktree/source-snapshot check, updates fixtures and migration notes, and
executes the concurrency scenario with competing agents. The owner reports
which tests were scoped and which were full. Do not paper over an integration
failure by weakening the acceptance profile or removing failed evidence.

Every handoff includes changed files, reproduced trigger, invariant enforced,
schema/protocol changes, tests, before/after timing where relevant, migration
impact, and remaining limitations.
