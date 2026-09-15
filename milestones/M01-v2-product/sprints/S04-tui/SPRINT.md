# S04 — TypeScript TUI and monitoring client

Parent: [M01](../../README.md). State: **queued on P2-09**.
Entry: S02 P2-09 accepted. Handoff gate: P4-03 plus the sprint-local
review/reconciliation/revalidation below. Full P4 phase release still waits
for S05 P4-09. This sprint can run concurrently with
[S03 source/memory](../S03-source-memory/SPRINT.md). Read
[TUI handoff](../../../../project/build-plan/verticals/06-tui.md),
[interface contract](../../../../project/INTERFACES.md), and
[status model](../../../../project/STATUS_MODEL.md).

Coordinator note: P2-09 is not yet passed, so S04's entry gate remains open.
The current TypeScript package now has a pre-gate P4-01/P4-02 implementation
with a real Node Unix-socket transport, one-shot mounted renderer, and an
explicit read-only interactive line shell (`help`, `refresh`, `select`,
`quit`). Structured mutation input, full mounted acceptance review, and the
S04 handoff remain open.

## Task graph and ownership

| Task | Prerequisite | Owner/write set | Observable deliverable and gate |
| --- | --- | --- | --- |
| P4-01 — generated/validated TS client | P2-09 | TUI owner: `apps/tui/**`; generated client fixtures by protocol owner | TS types and runtime validation agree with Rust DTO/version/error fixtures, including referenced/failed envelopes. |
| P4-02 — mounted core TUI workflow | P4-01 | TUI owner: `apps/tui/**` | Human can create milestone/sprint/task, activate sprint, inspect contextual next action/gates, claim, attach evidence, release, and finish through service API. No direct SQLite read or per-refresh CLI process. |
| P4-03 — monitoring and refresh | P4-01/02 | TUI owner: `apps/tui/**` | Now/ready/sprint/milestone/task views use one revision/`as_of`, accurate totals, queued vs blocked, expired review, complete vs closed, live attempts, and revision/timer-driven coalesced refresh. |

The TUI lane may not change Rust status policy, shared protocol schemas, or
package manifests to make a view pass. It files an integration request to
their owner. Source/memory drafts arriving from S03 require explicit trust
and freshness labels. A feature is not done merely because a component test
passes; the production route/action must be mounted and exercisable.

## Sprint-local handoff gates

| Gate | Required evidence |
| --- | --- |
| S04-R1 — independent mounted-flow review | Reviewer operates every core route/action against fixture service, checks disabled states, stale revision/error handling, status semantics, and refresh lock behavior. Records `no_findings` if clean. |
| S04-R2 — reconcile | TUI owner fixes findings or records approved deferral/owner and affected checks. |
| S04-R3 — revalidate | Rerun mounted action and monitoring checks on the combined source after R2. Evidence and remaining limitations go to S05 P4-07 review. |

S04-R1/R2/R3 are sprint handoff checks, not extra `P*` task IDs and not a
substitute for the cross-vertical P4-07/08/09 gate. No web console is in
launch scope. If any browser-based local smoke test is later needed, use
Playwright-managed Chromium, never system Chrome.

## Dispatch ledger — coordinator only

| Task | State | Agent | Input snapshot | Deadline UTC | Evidence/finding link |
| --- | --- | --- | --- | --- | --- |
| P4-01 | pre-gate implementation complete; entry gate open | Ramanujan (Luna) | P2-09 bounded service/client slice | [TUI README](../../../../apps/tui/README.md); Node socket transport, frame bounds, timeout/error handling, and typecheck/test pass |

S04 hands the mounted TUI and its finding dispositions to
[S05](../S05-integration/SPRINT.md); it cannot independently release P5.
