# P2-08 — Runtime/service/CLI reconciliation

The combined snapshot now resolves the first two blocker findings with
durable transaction tests. P2-09 remains intentionally open only for
no-goal guidance/directive-enforcement coverage; its service path,
multi-harness guided execution, and restart/replay evidence are now mounted.

| Finding | Disposition | Evidence |
| --- | --- | --- |
| P2-R01 lifecycle persistence | resolved for the current schema | `SqliteAttemptAdapter`, atomic claim-to-release/expiry mutations, operation readback, fence/deadline checks; application lifecycle integration passes. |
| P2-R02 evidence and closeout | resolved for the current schema | Typed receipt/review/close-intent APIs, retained failed/stale receipts, normalized per-work gates, three-receipt proof-gated close integration passes. |
| P2-R03 service transport | mostly resolved | Framed Unix transport, size/timeout/correlation errors, queue/election, bounded read pool, restart recovery, subscriptions, metrics, typed application route, and long-lived host now pass 25 service tests. CLI-owned application persistence wiring and multi-process proof are bounded by the socket smoke. |
| P2-R04 CLI/service grammar | mostly resolved for the current slice | Guided CLI grammar, typed envelopes, CLI service host/client, durable session registration, lifecycle smoke, deadline parsing, safe errors, direct finish-close diagnostics, versioned service-routed evidence/close payloads, and a bounded declared-gate runner transcript are present; the full command surface remains pending. |
| P2-R05 error/operation mapping | mostly resolved | Protocol-safe operation IDs, typed error/exit mapping, operation replay, and attempt readback are covered; service-client readback and full command coverage remain open. |
| P2-R06 wire DTOs | mostly resolved | Typed status/list/guidance/next/receipt/gate/notification DTOs, application route envelopes, and fixture tests are present; concrete persistence-backed command DTO coverage remains open. |
| P2-R07 derived status | resolved for current schema | Store read snapshots now materialize one project revision with work hierarchy, attempts, dependencies, and gate diagnostics; the application adapter derives statuses and exact rollups before pagination. |

The next critical boundary is the remaining P2-09 evidence: prove directive
enforcement inside an unfamiliar supported harness. Rust-owned
`guide_checked` validation now rejects unsafe or inconsistent directives, and
the CLI has
`no_goal_next_emits_one_required_contract_valid_action`, which proves that
no-goal `next` emits one required, shell-free action with argv accepted by the
CLI grammar; it does not yet prove that an arbitrary harness cannot skip that
directive. Multi-harness claim/evidence/finish/release across restart now
passes, and focused failed-evidence retention and operation replay are covered
by the service test suite.
S03/S04 remain queued until those gates pass; their source, memory, and TUI
implementations are useful groundwork but do not substitute for the entry gate.
