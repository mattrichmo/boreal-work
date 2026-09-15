# Vertical 06 — TypeScript terminal UI

## Purpose

Build the TypeScript terminal UI as a replaceable client of the versioned Rust
service. It renders validated revisioned snapshots, subscribes to revision
changes, coalesces refreshes, and performs confirmed mutations through the
same application API as the CLI. It must expose the first useful lifecycle
slice—create/activate/claim/accept/checkpoint/release/finish and accurate
status—without opening SQLite, reading legacy object storage, reconstructing
state, or spawning `bwrk` on every refresh. See
[`../../../apps/tui/README.md`](../../../apps/tui/README.md),
[`../../INTERFACES.md`](../../INTERFACES.md), [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md),
and [`../../DELIVERY_PLAN.md`](../../DELIVERY_PLAN.md).

## Task-index alignment

This vertical is the implementation plan for **P4-01** (generate/validate the
TypeScript API client), **P4-02** (core TUI workflow), **P4-03** (monitoring
and refresh views). It supplies a buildable TUI artifact and clean-install
smoke fixture to Vertical 09, which owns **P4-05** packaging/upgrade policy.
It depends on P2-09 and therefore consumes Vertical 05's
P2-03/P2-04/P2-06 outputs only after runtime/protocol review and revalidation
have passed. P4-04 migration is outside this vertical; P4-06 documentation
may consume its handoff evidence.

## Owned paths

- `apps/tui/` — TypeScript client, service connection, snapshot cache,
  subscription/reconnect loop, route models, rendering, navigation,
  confirmations, mutation workflow, and packaging.
- `apps/tui/tests/` or `tests/tui/` — client contract, snapshot consistency,
  revision/reconnect, route/action reachability, terminal lifecycle, and
  performance tests (follow the v2 test layout once established).
- `apps/tui/src/view-model/` for presentation DTOs/formatters fed by
  protocol-generated types; create no separate shared UI package without a
  second real client and integration-owner approval.
- `project/spec/tui/` — route/action matrix, fixture-to-view mappings, and
  screenshot/terminal transcript fixtures.
- Root/package manifests only as required to mount the standalone v2 app and
  generated protocol client. Do not edit legacy `apps/tui/` or `packages/`
  paths outside the v2 tree.

## Prerequisites

1. Vertical 05 has frozen protocol fixtures, version negotiation, command
   grammar, status/read models, mutation responses, revision events, replay
   cursors, error taxonomy, and generated/validated TypeScript types.
2. The Rust service can serve one revisioned snapshot, a bounded replay stream,
   and all first-slice mutations over the selected local transport. It returns
   true totals separately from paginated rows and materializes reads before
   serialization; see [`../../STATE_AND_CONCURRENCY.md`](../../STATE_AND_CONCURRENCY.md).
3. Initial platform/transport and service startup policy are recorded in
   [`../../DECISIONS.md`](../../DECISIONS.md). The TUI must not invent auto-start or
   recovery semantics.
4. The v2 workspace has a TypeScript build/package target and terminal runtime
   dependency selected. The existing legacy Ink/React implementation is
   reference material only; useful behavior may be ported selectively from
   `apps/tui/src/routes/`, `refresh-scheduler.ts`, `head-poll.ts`,
   `reconciliation.ts`, `repo-store.ts`, and `runtime.ts`.
5. P4-01 cannot start until P2-09's three-process/service-restart validation
   passes. P4-02 and P4-03 additionally require the P4-01 generated/validated
   client. Vertical 09 owns P4-05 and consumes the TUI build/smoke fixture.

## Concrete outputs

- Version-checked TypeScript API client generated or validated from Rust
  protocol fixtures, including request methods, envelope decoding, event
  decoding, and typed errors.
- Long-lived local service connection with handshake, workspace binding,
  subscription cursor, reconnect/backoff, replay handling, and one-shot
  snapshot recovery on missed events/disconnect.
- Immutable in-memory `SnapshotView` model carrying `api_version`, project
  revision, generated/read-model revision, true totals, bounded rows,
  truncation/pagination metadata, liveness/closeout data, and warnings.
- Route set for current sprint, Now/ready/active/blocked queues, work detail,
  attempt/session detail, dependencies, activity/audit, health/service status,
  and memory links available through read-only API calls.
- A contextual guidance panel showing the same effective status, blockers,
  required/optional directives, evidence gaps, and trusted next action as
  `bwrk next`; it calls the service and never derives its own claimability or
  imperative instruction from work prose.
- Confirmed command palette/action flow for create, activate, claim, accept,
  heartbeat/checkpoint/evidence, release/fail, finish, and manual refresh;
  every write displays operation/revision/outcome and stale/conflict guidance.
- Terminal lifecycle and packaging: runnable `bwrk-tui`/v2 TUI artifact,
  alternate-screen cleanup, signal handling, deterministic non-TTY behavior,
  version metadata, and no dependency on legacy runtime paths.
- Route/action reachability matrix, terminal transcript fixtures, and
  TUI-on/TUI-off benchmark report.
- P4 task evidence bundle: generated-client fixture validation for P4-01,
  mounted end-to-end mutation workflow for P4-02, revision/total/refresh
  observations for P4-03, and a clean-install smoke fixture for Vertical 09.

## Ordered steps

1. **Gate on P2-09 and P4-01.** Verify Vertical 05 has passed runtime/protocol
   review/reconciliation and P2-09 revalidation, record the exact protocol and
   service/toolchain identity, then make the P4-01 generated/validated client
   the only DTO input to the TUI.
2. **Map the protocol to view models.** Consume the generated types; define
   decoder validation and a single conversion from API DTOs to immutable view
   models. Preserve status distinctions (`claimed`, `accepted`, `running`,
   `blocked`, `verification needed`, `complete`) and display source/read-model
   revision and lag. Keep errors, warnings, unavailable service, stale data,
   and truncation explicit rather than substituting empty success data.
   Render stored task state, effective eligibility, attempt state, and gate
   state as distinct dimensions; release/refresh must not visually promote
   operator-only or blocked work into the ready queue.
3. **Build the service client.** Establish workspace identity and negotiate
   API/schema versions. Keep one long-lived connection per TUI session. Expose
   `getSnapshot`, bounded detail/list reads, `subscribe(cursor)`, and typed
   mutation methods using the same request envelopes as CLI. Do not expose
   database handles, legacy stores, subprocess refresh helpers, or direct
   status setters to route code.
4. **Implement revision subscription and refresh state.** On an event, record
   the affected revision/subjects and coalesce bursts into one refresh. If the
   cursor is replayable, apply only a fresh materialized snapshot from the
   service; if events are missed, out of order, disconnected, or incompatible,
   fetch exactly one current snapshot before rendering. Never merge fields from
   different revisions. A manual refresh bypasses display cache and returns a
   current revision or a precise stale/unavailable state.
5. **Implement snapshot correctness.** Render from one immutable snapshot per
   frame/detail view, after the service has closed its read transaction. Show
   true totals independent of row limits; mark pagination/truncation. Resolve
   active sprint only from the explicit project setting—never the first sprint
   in a list. Keep selected IDs stable across refresh and clear them safely if
   deleted or inaccessible. Add a development assertion that a route does not
   combine revisions.
6. **Port the shell and navigation selectively.** Reuse proven legacy ideas for
   alternate-screen lifecycle, responsive widths, route bindings, command
   palette, search/filtering, status colors, and terminal cleanup, but map all
   data access to v2 client methods. Keep rendering pure over view models.
   Provide useful loading, empty, unavailable, stale, permission, conflict,
   and large-result states; do not hide service or protocol failures behind a
   blank dashboard.
7. **Add P4-03 monitoring/read routes.** Implement current sprint/Now, ready/active/blocked
   queues, work detail with dependencies and attempt, activity/audit with
   revision cursor, service/health, and memory-reference panels. Every count
   comes from the same snapshot or explicitly labeled derived/read-model
   revision. Historical attempts and large activity use bounded pagination.
8. **Add P4-02 mutation workflow.** Build descriptors from typed requests, show
   target, effect, expected revision/fence, and confirmation for every write or
   dangerous action. Submit one operation ID, disable duplicate submission,
   render busy/backpressure/conflict/stale-fence/unknown-outcome states, and
   resolve unknown outcomes by operation readback. On success, render the
   returned revision and wait for/coalesce the matching notification; do not
   optimistically invent lifecycle state. Allow retry only when the protocol
   says it is safe.
9. **Wire P4-02 complete first slice.** From the TUI, initialize/create
   milestone/sprint/task, activate sprint, claim the task, accept/checkpoint,
   finish it, and inspect accurate dashboard/status while another client
   mutates unrelated work. Add explicit release/fail and stale-attempt views so
   failed evidence/history remains visible. Support memory links as references
   without implementing memory authority in the UI.
10. **Test P4-01/P4-03 terminal and reconnect behavior.** Exercise mount/unmount, SIGINT,
   SIGTERM, SIGHUP, non-TTY output, terminal resize, service restart, cursor
   replay, missed events, stale snapshot, malformed payload, slow reader, and
   queue busy. Verify no lingering timers, sockets, subscriptions, alternate
   screen, or mouse mode after exit.
11. **Build and benchmark.** Build the standalone v2 TUI with pinned
    dependencies and generated protocol types. Smoke-test the TUI artifact
    against a fixture service, measure TUI-on versus TUI-off concurrency, and
    hand off the route/action matrix, screenshots/transcripts, exact commands,
    and known limitations to the integration owner.

## Invariants

- The TUI owns presentation and navigation only; Rust owns canonical state,
  lifecycle transitions, revisions, audit events, and policy.
- No direct SQLite/object-store access and no `bwrk` subprocess per route or
  refresh. One long-lived service client is the only operational data path.
- Each rendered snapshot/detail is internally consistent at one project
  revision; counts are true totals and pagination affects rows only.
- Revision events are hints to refresh, not a second state authority. Events
  are coalesced; missed/out-of-order events trigger one snapshot recovery.
- Manual refresh bypasses display cache and reports the current revision or a
  typed stale/unavailable result.
- Writes use the same protocol request as CLI, include operation ID and
  expected revision/fence where applicable, require confirmation, and never
  silently retry an unknown mutation.
- The UI never conflates claimed, accepted, running, blocked, verification
  needed, complete, failed, cancelled, or stale/unavailable states.
- Rendering, user waits, subprocesses, and network work occur after service
  read transactions are closed; the UI cannot hold the canonical writer lock.
- Failed attempts, evidence, historical revisions, index lag, and warnings
  remain inspectable; the UI does not make health appear green by deleting or
  flattening history.
- Terminal resources are restored idempotently on every exit path, including
  signal and render failure; non-TTY mode emits no terminal control sequences.
- P4-01 runtime validators reject protocol/version mismatch and failed
  envelopes without converting them into empty successful views.
- P4-02 every advertised lifecycle action is mounted through the service;
  P4-03 monitoring uses revision-driven refresh rather than polling a legacy
  store or CLI process.
- P4-05 packaging records one immutable CLI/service/client identity; an upgrade
  cannot silently rebase an active attempt and rollback is observable.

## Failure injections

- Deliver bursts of revisions for unrelated tasks; assert one coalesced refresh
  and no mixed-revision frame.
- Drop, duplicate, reorder, and truncate subscription events; exceed the replay
  cursor and force a disconnect; assert one snapshot recovery and stable
  selection.
- Return a stale revision, stale attempt fence, blocked claim, terminal claim,
  conflict, busy/backpressure, unavailable service, malformed envelope, wrong
  API version, unknown field, or application failure with successful transport.
- Time out after a mutation commits; assert operation readback, no duplicate
  transition, and a visible unknown/resolved outcome.
- Restart/kill the service during an open route and while a mutation is pending;
  assert reconnect/backoff, preserved view context, and precise unavailable
  state rather than fabricated data.
- Return a paginated row set with large totals and 10,000 historical attempts;
  assert totals remain exact and active views stay bounded.
- Remove or change the explicit active sprint; assert no first-list fallback.
- Resize to narrow and wide terminals, enter empty/error/loading states, emit
  long titles/commands, and exercise keyboard/mouse bindings without clipped
  required IDs or inaccessible actions.
- Send SIGINT/SIGTERM/SIGHUP during mount, refresh, confirmation, and error;
  assert alternate screen, mouse mode, timers, sockets, and listeners restore.
- Attempt every advertised action from its route; assert disabled reasons and
  confirmation for all writes/dangerous actions, including release/cancel.
- Install the TUI artifact in a clean environment and run it against a pinned
  v2 service. Hand its identity and smoke fixture to Vertical 09 for the
  upgrade pause/rebase/resume and rollback probes.

## Measurable acceptance

- Protocol contract tests consume the exact Vertical 05 fixtures; no manually
  divergent DTO definitions exist. Version negotiation and unknown-field
  behavior pass the compatibility matrix.
- P4-01 acceptance passes: generated/validated TS types and runtime validators
  match Rust fixtures, including version mismatch and failed envelopes.
- P4-02 acceptance passes: a mounted TUI user can create milestone/sprint/task,
  activate, inspect the same conditional guide as CLI, claim, attach a
  receipt, release, and finish through the service.
- P4-03 acceptance passes: Now/ready/sprint/milestone/task views show true
  totals, one revision per detail, live attempts, and immediate
  revision-driven refresh.
- A mount/action test proves each advertised route and first-slice action is
  reachable and wired to the production service client. The end-to-end TUI
  scenario completes create/activate/claim/accept/checkpoint/finish and shows
  the returned revision and durable status.
- Under injected event loss/reordering/disconnect, every rendered frame after
  recovery is one revision and requires at most one snapshot refresh per loss
  episode; no stale data is presented as current.
- A three-agent fixture shows exact dashboard totals despite capped rows,
  explicit active-sprint selection, bounded active-status payloads, and no
  route-refresh CLI subprocesses. Instrumentation proves zero DB opens by TUI.
- Mutation tests prove duplicate-submit suppression, confirmation, typed
  conflict/stale/busy handling, and operation readback for unknown outcomes.
- Terminal lifecycle tests pass for normal exit and all supported signals;
  non-TTY smoke output contains no alternate-screen/mouse escapes.
- Report TUI-on/TUI-off throughput and p50/p95/max for snapshot read, refresh,
  mutation round trip, and render scheduling, plus event coalescing rate,
  payload bytes, reconnect count, and stale/unavailable duration. Compare on
  the same workload and validation policy as required by
  [`../../DELIVERY_PLAN.md`](../../DELIVERY_PLAN.md).
- `pnpm`/chosen v2 build, typecheck, unit tests, integration tests, packaged
  launch smoke test, and first-slice validation pass; label scoped checks and
  full release validation separately.
- The TUI clean-install fixture passes against the pinned CLI/service
  identity; Vertical 09 owns P4-05 upgrade and rollback acceptance.

## Excluded scope

- A second data store, direct SQLite access, legacy object-store compatibility,
  per-refresh CLI spawning, or UI-owned lifecycle/status transitions.
- Remote browser/web UI, cross-project/global management, MCP, semantic or
  embedding search, and automatic agent spawning.
- Implementing source ingestion, parsing, memory publication, Git operations,
  or evidence validation policy; the TUI only displays/links their typed
  read-model results and invokes owned application commands.
- Advanced role/authorization policy, scheduler policy, release/update
  management, and platform transports not selected in the decision record.
- Visual parity with every legacy route. Port behavior only where it supports
  the v2 product and correctness contract.

## Handoff evidence

- Changed-file manifest restricted to `apps/tui/`, its
  view-model additions, fixtures/tests, and required package manifests;
  no legacy edits and no `bwrk` state mutations.
- Protocol version/capability consumed, generated-client provenance, route and
  action matrix, and fixture mapping for each DTO/status/error.
- First-slice transcript with exact service/client commands, revisions,
  operation IDs, expected fences, rendered outcome, and environment/package
  identity.
- Snapshot/revision correctness report, event-loss/reconnect injection report,
  mutation/readback report, terminal signal cleanup report, and TUI-on/TUI-off
  measurements with payload sizes and latency percentiles.
- Terminal transcripts or screenshots for loading, empty, current, stale,
  unavailable, blocked, verification, conflict, and completed states; include
  narrow-terminal evidence and accessibility/keybinding notes.
- A task-indexed P4 evidence map with exact P4-01/P4-02/P4-03 acceptance
  results and the P4-05 clean-install input fixture, plus dependency evidence
  for P2-09 and the P4-06 documentation handoff.
- Integration note naming remaining protocol gaps, packaging assumptions,
  migration impact, known limitations, scoped versus full checks, and the next
  recommended workflow: combined v2 first-slice and concurrency validation.
