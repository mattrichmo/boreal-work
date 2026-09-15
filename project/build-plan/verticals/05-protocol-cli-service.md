# Vertical 05 — Rust protocol, CLI, and local service

## Purpose

Build the machine-facing v2 boundary: a versioned Rust protocol, one local
service implementation of the application use cases, and a thin `bwrk` CLI
client that is scriptable, bounded, idempotent, and safe under concurrent
agents. The CLI and future TypeScript TUI must exercise the same application
commands; neither adapter may open SQLite or implement lifecycle transitions.
This vertical turns the scaffold's `API_VERSION`/`OperationResult` placeholder
into the contract required by the first end-to-end slice. See
[`../../INTERFACES.md`](../../INTERFACES.md), [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md),
[`../../STATE_AND_CONCURRENCY.md`](../../STATE_AND_CONCURRENCY.md), and the
[CLI keep contract](../../CLI_COMMANDS.md).

## Task-index alignment

This vertical is the implementation plan for **P2-03** (local Rust service and
fair writer queue), **P2-04** (versioned protocol and Rust CLI), and **P2-06**
(bounded status and revision notifications). Service/protocol groundwork
starts after P1-09; P2-04 waits for P2-01, and P2-06 waits for P2-04/P2-05.
It must provide the passing P2-09 service/restart observation needed by
Vertical 06's P4-01/P4-02/P4-03 work. P2-01/P2-02 and P2-05 supply the
lifecycle fields, fences, receipt outcomes, liveness, and eligibility this
boundary exposes; this vertical does not absorb those tasks. The stable
packaging identity needed by P4-05 is handed off here for the CLI/service
portion.

## Owned paths

- `crates/protocol/` — versioned request, response, event, error, capability,
  and fixture types.
- `crates/service/` — Unix-socket/named-pipe transport adapter, service
  election, bounded writer queue, read pool, subscriptions, and process
  lifecycle. Vertical 02 alone owns `crates/service/src/runtime/**` after
  the adapter boundary is agreed. This agent owns crate manifest and top-level
  module wiring; coordinate those shared edits with the integration owner.
- `crates/cli/` — argument grammar, protocol client, exit-code mapping, JSON
  envelope output, human output, help, and CLI integration tests.
- `project/spec/protocol/` — checked-in JSON fixtures, compatibility matrix,
  command grammar, and golden error/status responses (created by this
  vertical if absent).
- `tests/protocol/`, `tests/service/`, and `tests/cli/` — cross-crate contract,
  transport, concurrency, and black-box tests.
- Workspace manifests/lockfile only as required to mount these crates and
  their dependencies; no unrelated application/domain/store edits.

The application/domain/store owners provide the use cases, transition rules,
and revisioned store primitives. Vertical 11 owns trusted guidance selection
and its agreed guidance CLI/protocol modules. This vertical owns their
top-level registry/manifest wiring after interface agreement, never a
competing `next` or lifecycle policy. Adapter-facing traits or read models in
`crates/application/` require an explicitly reviewed integration change.

## Prerequisites

1. Typed IDs, legal work/attempt transitions, dispatch eligibility, receipt
   validation, and one-current-attempt/session rules are stable in
   `crates/domain/` and application tests.
2. SQLite WAL persistence has migrations, short mutation transactions,
   append-only audit events, operation-ID idempotency, blob references, and
   materialized snapshots with a monotonic project revision; see
   [`../../STATE_AND_CONCURRENCY.md`](../../STATE_AND_CONCURRENCY.md).
3. The application layer exposes the P1/P2 command use cases and read models
   for init, milestone/sprint/task/dependency operations, work lifecycle,
   status, and dashboard without adapter-specific transitions. Memory reads
   and doctor/recovery implementations arrive in P3; reserve their wire
   vocabulary now, but do not stub a successful result.
4. The policy questions in [`../../DECISIONS.md`](../../DECISIONS.md) that affect
   wire behavior are decided and recorded: supported platforms/transport,
   auto-start versus explicit service start, initial authorization boundary,
   and protocol compatibility policy.
5. Legacy CLI behavior has been sampled for useful grammar/output semantics,
   but no v2 crate imports legacy code. Reference points include
   `apps/cli/src/args.ts`, `apps/cli/src/command-registry.ts`,
   `apps/cli/src/output.ts`, and `apps/cli/src/commands/daemon.ts`.
6. P1-09 has passed on a fresh DB and upgrade fixture. Claim P2-03 first,
   P2-04 after P2-01/P2-03, and P2-06 after P2-04/P2-05 as specified in
   [TASK_INDEX.md](../TASK_INDEX.md).

## Concrete outputs

- `boreal-protocol` crate with `api_version`, schema/version negotiation,
  request/response/event types, typed error/outcome codes, capability
  discovery, unknown-field rules, and generated/validated TypeScript-facing
  JSON fixtures.
- A command registry/grammar fixture covering the initial families in
  [`../../INTERFACES.md`](../../INTERFACES.md): `init`, milestone, sprint, task,
  dependency, work lifecycle, `status`, and `dashboard`. Reserve typed
  `agent guide|start|resume|finish` and `next` extension points for P2-11;
  memory and `doctor` grammar arrives in P3. None may report false success
  before its application behavior exists.
- Stable JSON envelope with `api_version`, `operation_id`, `revision`,
  transport result, application outcome (`changed`, `unchanged`, `rejected`,
  `conflict`, `busy`, `failed`), bounded `data`, optional `detail_ref`, and
  structured `error`.
- One versioned guidance DTO extension point for effective status/reason,
  registry provenance, required obligations, and a single exact trusted
  action. Vertical 11 implements selection; this vertical transports it
  without reconstructing directives in CLI/service handlers.
- Local service executable/library with workspace identity binding, private
  socket permissions, single-owner startup, restart/reconnect behavior,
  bounded fair writer queue, read-only pool, and revision subscription stream.
- Thin Rust CLI with human and JSON modes, deterministic help and argument
  errors, documented exit classes, operation readback after timeout, and no
  second offline transition path.
- Protocol compatibility report and first-slice transcript proving two CLI
  clients race to claim one task, one attempt is accepted and completed, and
  status/dashboard revisions remain coherent.
- P2 task evidence bundle: queue fairness/restart evidence for P2-03, grammar/
  envelope/exit-code fixtures for P2-04, and bounded-status/replay-cursor
  evidence for P2-06. The bundle names the remaining P2-07/P2-08 review and
  reconciliation work rather than declaring those tasks complete.

## Ordered steps

1. **Mount after P1-09.** Begin P2-03 service groundwork. Before P2-04/P2-06
   integration, verify the application exposes P2-01/P2-02/P2-05 fences,
   receipt outcomes, heartbeat, and eligibility without duplicating their
   rules. Record each task's dependency check before changing its adapter.
2. **Freeze the wire vocabulary.** Define IDs, timestamps, nullable versus
   omitted fields, pagination cursors, revision cursors, actor/session/fence
   fields, transport versus application outcomes, and error codes. Write
   success, unchanged, rejected, conflict, busy, stale-attempt, unavailable,
   corrupt, and unknown-outcome fixtures before implementation. Define whether
   additive unknown fields are ignored, preserved, or rejected per version.
3. **Define command grammar from fixtures.** For each initial command, specify
   positional arity, flags, defaults, mutually exclusive options, required
   expected revision/fence fields, output schema, exit class, and examples.
   Make `--json` the stable automation contract and keep human rendering a
   presentation of the same DTO. Ensure help and machine-readable parse errors
   are generated from the same registry.
4. **Implement protocol serialization and negotiation.** Add Rust serde types,
   explicit schema names, envelope validation, bounded result metadata, and a
   capability/version handshake. Add fixture tests for empty arrays, nulls,
   large/reference results, invalid JSON, unknown fields, wrong API version,
   and successful transport carrying an application failure. Generate or
   validate TS types from these fixtures; do not hand-maintain a second DTO
   contract.
5. **Mount application commands behind a client-neutral dispatcher.** Route
   every command through application use cases. Parse/validate before the
   writer queue; pass operation ID, actor, expected revision where applicable,
   and attempt fence. Reads use short read transactions and return one
   revisioned snapshot/read model. Mutations return the committed revision and
   durable operation result only after commit.
6. **Implement P2-03 service election and local boundary.** Bind the service to the project
   identity and private runtime directory. Elect one owner; concurrent first
   commands connect to it or receive typed startup/busy status. Use HTTP over a
   Unix socket on macOS/Linux and the chosen named-pipe equivalent if Windows
   is in scope. Keep socket/process metadata recoverable and never break a live
   service lock. Support explicit start/status/stop/restart semantics without
   letting stop cancel work implicitly.
7. **Implement P2-03 queue and P2-06 reader scheduling.** Use a bounded, fair writer
   queue with typed backpressure/retry guidance; measure queue wait separately
   from SQLite transaction hold. Use bounded read connections and materialize
   snapshots before serialization. Publish a committed revision after the
   transaction, coalesce duplicate notifications, and retain a bounded replay
   cursor for reconnecting clients.
8. **Implement P2-04/P2-06 operation resolution and recovery.** On timeout or disconnect,
   resolve by operation ID/readback before retry. Duplicate operation IDs return
   the original outcome, not a second event. Service restart reloads current
   attempts and subscriptions reconnect from a cursor; missed history causes a
   snapshot refresh. Offline setup/recovery may call the same Rust
   application/store transaction code only after confirming no active service
   owner.
9. **Implement P2-04 CLI adapter.** Replace the scaffold print with command
   parsing, client calls, JSON/human output, deterministic exit codes, bounded
   result spooling/reference behavior, and help/completion generated from the
   registry. Make `status` compact by default and historical/detail queries
   explicitly paginated or referenced. Expose revision/operation IDs in JSON
   while keeping human output readable.
10. **Run P2-06 status/notification integration.** Initialize a fixture project,
   create milestone/sprint/task, activate the sprint, race two independent
   CLI processes to claim, accept one attempt, checkpoint evidence, finish it,
   and read dashboard/status from a third client while writes continue. Record
   command argv, protocol/schema version, source/config identity, revisions,
   exit status, payload bytes, queue wait, transaction hold, and end-to-end
   latency.
11. **Build and hand off.** Make `cargo build/test` produce one runnable
   `bwrk` plus service behavior with no path dependency on the legacy checkout.
   Vertical 09 owns P4-05 release packaging, upgrade, and rollback. Publish
   the fixture schema and client contract for Vertical 06, a compatibility
   matrix, migration notes, and the exact scoped/full validation distinction.

## Invariants

- Rust application/domain code is the only owner of lifecycle and graph rules;
  CLI/service transport code cannot directly edit status or reservations.
- CLI and TUI use the same versioned request/response/event schemas and
  application command path.
- Every mutation has an operation ID, commits state plus audit event plus
  revision atomically, and is safe to repeat; an unknown timeout is resolved,
  never guessed.
- One task has at most one current fenced attempt and one session has at most
  one current execution. Stale fences cannot mutate a replacement.
- `transport=ok` does not imply application success; exit codes and envelopes
  preserve the distinction.
- A read response is internally consistent at one revision, with true totals
  independent of row pagination and no historical-attempt explosion in active
  status.
- No transaction contains rendering, subprocess/model/network/Git work or a
  wait; readers do not take the canonical exclusive writer lock.
- Service startup has one elected owner, private endpoint permissions, and
  safe restart behavior; a client cannot force-break a live lock.
- P2-03 queue behavior is fair and bounded, and queue wait is never conflated
  with SQLite transaction hold.
- P2-06 status is bounded independently of historical attempts; a revision
  cursor can replay changes or force a complete resnapshot after a gap.
- Protocol evolution is explicit, fixture-tested, and backward behavior is
  defined for unknown fields and unsupported versions.

## Failure injections

- Two claim requests arrive concurrently; assert exactly one winner and a
  typed empty/conflict result for the loser.
- Duplicate create/claim/finish with the same operation ID; assert one audit
  event and identical replayed result.
- Kill the client after commit but before response; resolve by operation ID.
- Kill the service before commit, during restart, and after commit; assert no
  half-transition and preserved attempts/audit history.
- Fill the writer queue and hold a slow reader; assert bounded busy response,
  fair progress, and measurable queue/transaction timings.
- Send stale revision, stale fence, blocked/operator-only/terminal claim,
  expired lease heartbeat, and finish for a replaced attempt.
- Drop or reorder subscription events, exceed replay cursor, disconnect the
  socket, and reconnect; assert one fresh snapshot and no mixed revision.
- Start two service owners simultaneously, corrupt/remove socket metadata, and
  attempt startup while a live owner exists; assert safe connect/busy/recovery.
- Send wrong API version, unknown fields, invalid JSON, oversized payload,
  malformed reference, missing blob, empty stdout, invalid stderr, and a
  successful transport containing an application error.
- Add 10,000 historical attempts and compare routine active status bytes,
  latency, totals, and row contents with the small fixture.
- Restart the service while three harness processes and one reader are active;
  assert P2-09's three-process claim/accept/finish observation remains
  coherent and the reader can resume or resnapshot.

## Measurable acceptance

- All protocol fixtures validate in Rust and are consumed by a TypeScript
  contract test; every documented command has matching help, parser behavior,
  JSON schema, examples, and exit-code tests.
- P2-03 acceptance passes: one project service is elected, concurrent startup
  connects or returns typed busy, queue wait and DB hold are separately
  measured, and a crash/restart recovers live state.
- P2-04 acceptance passes: grammar and JSON fixtures are stable, every response
  carries operation ID and revision, and exit classes match application
  outcomes.
- P2-06 acceptance passes: routine status remains bounded with 10,000
  historical attempts and clients resume a revision cursor or resnapshot after
  a notification gap.
- The first-slice black-box scenario passes with two concurrent claimers,
  exactly one current attempt, accepted/finished fencing, and dashboard/status
  responses whose fields all name the same committed revision.
- Duplicate operations produce one semantic result/event; injected unknown
  outcomes resolve correctly in 100% of repetitions in the test matrix.
- Under the benchmark workload at 1, 3, 10, 30, and 50 clients, report p50,
  p95, and max for queue wait, SQLite hold, snapshot read, status latency, and
  completion latency, plus WAL size/checkpoint age, conflicts, payload bytes,
  orphan attempts, blocked redispatches, and unchanged-read share. Do not set
  a speed target until the legacy baseline is recorded as required by
  [`../../DELIVERY_PLAN.md`](../../DELIVERY_PLAN.md).
- Routine three-agent active status is measured against the proposed 2–8 KiB
  target, with no growth caused solely by 10,000 historical attempts.
- Service restart preserves current attempts and the next client can reconnect
  without opening SQLite directly. No test starts a second service owner.
- `cargo test`, protocol fixture checks, service black-box tests, and a packaged
  binary smoke test pass; report which checks are scoped versus full release
  validation.

## Excluded scope

- Remote multi-host transport/authentication unless the decision gate selects
  it; never share SQLite over a network filesystem.
- Automatic agent spawning, MCP, complex role authorization, scheduler policy
  beyond the same atomic claim operation, and release/update management.
- Memory parsing, embeddings, Git publication, and source-engine jobs except
  for typed references and read-only command stubs required by the contract.
- TUI rendering/navigation implementation; Vertical 06 consumes this vertical's
  fixtures and client library.
- Legacy storage migration logic; only compatibility evidence and explicit
  mapping inputs are produced elsewhere.

## Handoff evidence

- Changed-file manifest limited to the owned paths, with no v2 imports from the
  legacy workspace and no `bwrk` mutations used to create this plan.
- Protocol fixture index, schema/version matrix, command grammar, exit-code
  table, and examples for success, unchanged, rejected, conflict, busy,
  stale-fence, and unknown-outcome cases.
- First-slice transcript with exact commands, client identities, operation IDs,
  revisions, fences, outcome codes, payload byte counts, and environment/
  binary identity.
- Failure-injection report, concurrency benchmark report, package smoke
  result, migration impact, known limitations, and remaining policy decisions.
- A task-indexed P2 evidence map with exact P2-03/P2-04/P2-06 acceptance
  results, plus the explicit P2-07 review/P2-08 reconciliation/P2-09
  revalidation disposition.
- Explicit integration note for Vertical 06 naming the generated/validated TS
  client entry point, subscription contract, snapshot DTO, mutation methods,
  and compatibility version it may consume.
