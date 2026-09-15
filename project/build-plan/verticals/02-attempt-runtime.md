# Vertical 02 — Attempt lifecycle and runtime policy

## Purpose

Turn the domain/store contracts into one harness-neutral execution runtime.
Implement the application lifecycle use cases, liveness, dispatch eligibility,
and attempt recovery around the atomic store operations from vertical 01.
Vertical 05 owns service election, transport, writer queue, read pool, and
revision notifications; this vertical supplies the application operations and
runtime policy that service calls. The runtime
must make claim/accept/checkpoint/heartbeat/release/fail/finish behave the same
for CLI, service, and future TUI or harness adapters; see
[AGENT_LIFECYCLE.md](../../AGENT_LIFECYCLE.md),
[STATUS_MODEL.md](../../STATUS_MODEL.md),
[STATE_AND_CONCURRENCY.md](../../STATE_AND_CONCURRENCY.md),
[ARCHITECTURE.md](../../ARCHITECTURE.md), and sections 2–3 of
[DELIVERY_PLAN.md](../../DELIVERY_PLAN.md).

## Task-index alignment

This handoff implements the runtime leaves `P2-01`, `P2-02`, and `P2-05`:

- `P2-01` — one fenced attempt lifecycle and recoverable operation outcomes.
- `P2-02` — structured receipts, gate diagnostics, and resumable closeout
  after the atomic P2-01 finish primitive exists.
- `P2-05` — session liveness and pull/dispatch eligibility after `P2-03`.

`P2-06` consumes the bounded status/notification behavior;
coordinate their fixtures without taking ownership of their CLI/TUI work.
Entry gate: `P1-09`. Runtime review/reconciliation/revalidation are
`P2-07`/`P2-08`/`P2-09`. Later `P5-01` measures the queue and liveness load
behavior, `P5-02` reruns the crash/reorder matrix, and `P5-03` checks service
permissions/resource limits.

## Owned paths

- `crates/application/**` and `crates/application/Cargo.toml`
- `crates/service/src/runtime/**` only after Vertical 05 creates the service
  crate and agrees on the application/runtime adapter boundary
- Runtime/application fixtures and tests under those crates
- Service/runtime design fixtures under `project/spec/**` only when required
  by this handoff

Do not edit `crates/domain/` or `crates/store/` except through a documented
integration request to vertical 01; do not edit service transport, election,
queue, pool, subscription, CLI/protocol/TUI, or memory publication paths.
The service consumes application policy and must not create a parallel
lifecycle state machine. Ownership follows [TASK_INDEX.md](../TASK_INDEX.md).

## Prerequisites

1. P1-09 has passed its schema, transition, idempotency, and read/write gates.
   P2-01 can begin now; P2-05 waits for P2-03's service boundary.
2. The protocol/operation envelope and unresolved service policy choices from
   [INTERFACES.md](../../INTERFACES.md) and
   [DECISIONS.md](../../DECISIONS.md) are frozen as fixtures: project identity,
   startup mode, supported platform, actor permissions, heartbeat cadence,
   lease/expiry policy, capacity, and automatic-dispatch policy.
3. Read [PRODUCT.md](../../PRODUCT.md), especially the distinction between
   work memory and execution memory, and preserve the lifecycle states in
   [AGENT_LIFECYCLE.md](../../AGENT_LIFECYCLE.md).
4. Use a fixture project with multiple ready, blocked, operator-only, paused,
   and historical tasks; capture the baseline fields in
   [AUDIT_BASELINE.md](../../AUDIT_BASELINE.md) and
   [DELIVERY_PLAN.md](../../DELIVERY_PLAN.md).

## Concrete outputs

- Application command/query services that are the sole adapter-facing use-case
  path and delegate all state changes to vertical 01 transactions.
- Current-attempt, session, liveness, blocker, checkpoint, receipt, closeout,
  and recovery read models with compact revisioned snapshots.
- Application read models that Vertical 05 can expose through its bounded
  service status and notification contract, without history-sized queries.
- Liveness monitor that reloads accepted attempts on restart, tracks phase/tool/
  process/checkpoint/blocker/renewable lease/hard budget separately, expires
  only fenced current attempts, and marks uncertain sessions `unknown`
  pending reconciliation. Open work enters expiry review, not blind redispatch.
- Optional deterministic automatic dispatch using the same atomic claim as
  manual pull; no harness launch or model wait inside a write transaction.
- Structured execution receipts with command/argv, working directory,
  source/config/environment fingerprints, exit status, timestamps, output
  reference, and executor attestation. Gate diagnostics distinguish wrong
  command, subject, snapshot, attestation, exit, and observable. Equivalent
  prose never changes gate outcome; failed receipts remain durable. Required
  verification, checkpoint, review, and audit gates all have typed status.
- Recovery and idempotency fixtures for crash, timeout, adoption, replacement,
  service restart, and duplicate operations.

## Ordered steps

1. (`P2-01`, `P2-05`) Freeze runtime policy fixtures and map each command to one application
   operation. Define actor/harness/session/work/attempt/operation identities,
   expected revision, fence, and response outcome. Keep transport success
   distinct from application changed/unchanged/rejected/conflict/busy/failed.
2. (`P2-01`) Implement application command handlers for claim/accept/
   heartbeat/checkpoint/release/fail/atomic-finish. Validate request shape before
   service invocation; pass operation ID and expected fence/revision to the store; return
   the stored result on retry. No CLI or service handler may mutate rows
   directly.
3. (`P2-05`, coordinating with `P2-06`) Implement current-attempt and liveness queries for the revisioned status read model:
   current attempts, ready counts, blockers, sessions, closeout gaps, next
   timer deadline, and full totals. Bound active rows, report projection lag
   explicitly, and never load all history for a routine `Now` view.
4. (`P2-01`) Define the application-to-service invocation contract with
   Vertical 05. A command is fully validated before queueing; the queue may
   call only the application operation. A timeout is resolved by operation-ID
   readback, not a guessed mutation failure.
5. (`P2-05`, after `P2-03`) Wire runtime timers and dispatch to the service's
   bounded queue and post-commit revision notification hook. Keep all timer
   policy in application/runtime modules, not in transport handlers.
6. (`P2-01`) Implement attempt acceptance and session binding. Accept records accepted-at,
   harness identity, immutable runtime/protocol/schema/toolchain identity, and
   current fence. Duplicate accept with the same operation ID returns the
   original result; a different session cannot silently take over a live
   current execution.
7. (`P2-02`) Add structured evidence capture and gate matching above the
   atomic finish primitive. Validate mutually exclusive/repeated arguments
   before recording final objects. Bind receipts to execution and tested
   input/configuration; reject stale or wrong-subject receipts with exact
   machine-readable reasons. Finish resumes by operation ID from its last
   durable stage, writes one current summary, and releases only its own fence.
   Preserve the useful consolidated `agent finish --close|--release` behavior
   as one application use case; lower-level evidence and close operations
   must not create a competing normal path. Return current gate status and
   exact missing obligations with every rejected closeout. If P0 approves
   durable close intent, auto-finalize only after the last valid receipt or
   review for the same attempt, snapshot, and gate policy; no passing test
   output alone closes work.
8. (`P2-01`, `P2-05`) Implement liveness independent of semantic progress. Heartbeat updates
   last-heartbeat and current phase/tool/process for the fenced attempt without
   appending noisy semantic progress events. Checkpoint records durable
   progress/blocker/validation input and may reference verified blobs. Healthy
   long-running tools remain healthy without file edits.
9. (`P2-01`, `P2-05`) Implement lease/hard-budget expiry, cancellation,
   release/fail, and manual adoption.
   At timer expiry, reread ownership/fence in a short transaction, perform a
   fenced cancellation check, and increment the replacement generation.
   Elapsed deadlines block claim and old-fence writes even before a late timer
   persists expiry. Mark uncertain sessions `unknown` on restart until adapter/
   lease ownership is resolved; do not reassign a shared worktree until stop
   is confirmed or reviewed safe. Preserve all prior attempts and receipts.
10. (`P2-05`) Add optional automatic dispatch after manual pull works. A scheduler tick
    reads a bounded candidate set, but final eligibility, dependency readiness,
    capacity, and claim occur in the same store write transaction. It never
    starts a harness or waits for output while holding that transaction.
11. (`P2-05`) On service restart, reload current attempts/timers from SQLite,
    reconcile uncertain adapter outcomes and operation IDs, and expose
    application recovery state. Vertical 05 owns socket recovery and revision
    cursor reconstruction; Vertical 04 owns doctor/repair convergence.
12. (`P2-07`/`P2-08`/`P2-09` evidence, later `P5-01`/`P5-02`/`P5-03`) Run the tests and measurable gates below, then hand off exact process,
    queue, restart, liveness, and concurrency evidence to the integration owner.

## Invariants

- The application/store transaction is the sole authority for status,
  eligibility, reservations, attempts, fences, revisions, and audit events;
  service caches and scheduler candidates are advisory only.
- A task has at most one current attempt and a session at most one current
  execution. Claim means reserved, accept means acknowledged delivery, and
  heartbeat proves only liveness; none implies semantic progress or completion.
- A stale heartbeat, checkpoint, cancellation, or finish cannot affect a
  replacement attempt. Expiry and cancellation always fence the old attempt.
- Dependency readiness and explicit eligibility are rechecked at claim time;
  blocked, paused, operator-only, and terminal work cannot be redispatched by
  any adapter or scheduler path.
- Writer fairness is bounded and observable. Queue fullness returns typed busy
  guidance; SQLite busy handling is a last defense, not the fairness policy.
- Liveness fields—accepted-at, heartbeat, phase/tool/process, checkpoint,
  blocker, and lease deadline—remain distinct. Old timestamps alone do not
  prove expiry, and a healthy tool need not edit files.
- Restart never converts an unknown mutation into a guessed failure or blindly
  creates a new attempt. Operation-ID readback, lease ownership, and adapter
  reconciliation determine the outcome.
- Service start/stop, read snapshots, notifications, and rendering do not hold
  canonical write/read transactions across waits or external work.

## Failure injections

Runtime-owned cases below belong to P2-01/P2-05. Service election, queue,
read-pool, and notification cases are joint P2 review fixtures owned for
implementation by Vertical 05; do not edit its paths to make them pass.

- Crash after claim but before accept; restart must show one reserved attempt,
  reload its lease, and avoid duplicate dispatch.
- Crash after accept or heartbeat but before response; repeat with the same
  operation ID and verify original result/readback behavior.
- Crash after checkpoint, release/fail, and finish commit; verify durable
  progress/history and no half-closed work/attempt/reservation state.
- Attach equivalent receipts with different prose and reject wrong command,
  subject, stale snapshot, missing attestation, nonzero exit, and wrong
  observable separately. Interrupt closeout at each stage, then resume by
  operation ID without duplicate summary or release of a replacement fence.
- Two service starters race for one project; then kill/restart the owner and
  verify the live lock is not force-broken and the next owner recovers safely.
- Fill the writer queue with noisy heartbeats, then submit unrelated claim,
  finish, and status operations; verify bounded queue behavior, fairness,
  starvation prevention, and typed backpressure.
- Hold a slow/large read and run writes; verify read materialization closes the
  transaction and that rendering/serialization never extends DB hold time.
- Delay one adapter/tool beyond a normal heartbeat while updating phase; verify
  healthy liveness is retained. Omit heartbeats and cross lease expiry; verify
  fenced replacement and stale-finish rejection.
- Cancel during tool work, reorder progress events, adopt a manually started
  session, and restart with an adapter outcome unknown; verify `unknown` and
  reconciliation behavior rather than blind redispatch.
- Release blocked and operator-only tasks, pause/resume a task, and change a
  dependency while a scheduler tick has a stale candidate; verify the atomic
  claim recheck rejects it.
- Miss notification cursor entries and disconnect the client; verify one fresh
  snapshot at a known revision rather than repeated model-mediated polling.

## Tests

- `cargo test --workspace` for application command mapping, typed outcomes,
  idempotency, revision cursors, liveness policy, and recovery state machines.
- Multi-process service-election test using one project identity: exactly one
  owner, safe connect-or-busy behavior, restart recovery, and restricted
  runtime endpoint.
- Queue stress test at 1, 3, 10, 30, and 50 concurrent clients with mixed
  claims, heartbeats, finishes, and reads; assert no duplicate current attempt,
  no redispatch of ineligible work, and bounded queue starvation.
- Lifecycle scenario: pull/claim, accept, heartbeat, checkpoint, release/fail,
  expiry/cancel replacement, manual adoption, and fenced finish.
- Crash/reopen/unknown-outcome tests around every service/store boundary;
  operation readback must resolve each ambiguous mutation exactly once.
- Liveness timer tests with healthy long tools, stale heartbeats, clock-policy
  fixtures, lease renewal, cancellation race, and restart timer reload.
- Notification tests for coalescing, affected subject IDs, replay cursor,
  missed-event snapshot refresh, unchanged state, and bounded payloads.
- Read/write contention and serialization tests prove no transaction survives
  into UI, network, subprocess, model, or subscriber waits.
- End-to-end fixture test for the first useful product flow and a 10,000
  historical-attempt active-status query, with scoped/full test labels.

## Measurable acceptance

Accept the vertical only when evidence shows:

- Two competing clients against one ready task produce one current attempt;
  accept, heartbeat, checkpoint, and finish are visible at monotonic revisions,
  and a stale replacement writer is rejected with the replacement fence.
- In 100 restart/crash/timeout repetitions, zero duplicate current attempts,
  orphan reservations, guessed mutation failures, or lost failed receipts are
  observed; duplicate operation IDs return the original outcome.
- A raced service startup produces one owner in every trial; after owner crash,
  a new client recovers current attempts/timers and does not blindly
  redispatch uncertain sessions.
- At 10/30/50 clients, report p50/p95/max queue wait, SQLite hold, claim,
  finish, status latency, queue depth, busy/conflict counts, and starvation.
  No configured fairness bound is exceeded; the exact bound is recorded in the
  policy fixture rather than hidden in code.
- A healthy long-running tool is not expired while phase/process heartbeats
  continue; an actually stale attempt expires and cannot finish after fencing.
- Routine active status with 10,000 historical attempts stays within the
  agreed payload target (approximately 2–8 KiB for three active agents from
  [INTERFACES.md](../../INTERFACES.md), measured rather than assumed) and
  reports one revision with full totals.
- Notification loss causes one snapshot refresh, not a polling storm; reads
  remain available during writes and no transaction spans serialization or
  rendering.
- `cargo test --workspace` passes, service restart/recovery evidence is saved,
  and the integration owner receives the benchmark fields required by
  [DELIVERY_PLAN.md](../../DELIVERY_PLAN.md).

## Excluded scope

- Domain/schema redesign, SQLite transaction implementation, or changes to
  vertical 01 invariants except through an explicit integration defect.
- Full CLI argument grammar, versioned protocol/DTO generation, TypeScript TUI,
  remote HTTP/auth, automatic model/harness launching implementation, and
  memory source/Git publication workflows.
- Cross-project scheduling, multi-host SQLite, semantic search, and broad
  workflow templates; these are later scope in [PRODUCT.md](../../PRODUCT.md).

## Handoff evidence

Provide:

- changed-path manifest, ownership check, dependency/schema/protocol fixture
  versions, and explicit runtime policy decisions;
- exact commands, process topology, project identity, OS/Rust/SQLite/toolchain
  fingerprints, and scoped-versus-full test classification;
- lifecycle timeline for ready → claimed → accepted → checkpoint → verifying
  → completed → reservation released, including revisions and fences;
- crash/restart/unknown-outcome and service-election matrix, with retained
  failed evidence and duplicate-operation readback results;
- fairness/liveness/read metrics: queue depth/wait, SQLite hold, lock wait,
  p50/p95/max end-to-end latency, payload bytes, WAL/checkpoint observations,
  redispatch count, orphan count, and notification refresh count;
- remaining limitations, deferred policy questions, migration impact, and the
  next integration step: protocol/CLI or TUI consumers use this one application
  and service path.
