# S02 — Attempts, proof-gated finish, service, CLI, guidance

Parent: [M01](../../README.md). State: **P2-08 reconciled for current slice; P2-09 open for full acceptance**.
Entry: S01 P1-09 accepted. Exit: P2-09 revalidation proves the no-goal
multi-harness workflow and service restart. Read
[attempt runtime](../../../../project/build-plan/verticals/02-attempt-runtime.md),
[protocol/CLI/service](../../../../project/build-plan/verticals/05-protocol-cli-service.md),
[agent guidance](../../../../project/build-plan/verticals/11-agent-guidance.md),
[status model](../../../../project/STATUS_MODEL.md), and
[CLI keep contract](../../../../project/CLI_COMMANDS.md).

## Task graph and parallel lanes

| Task | Prerequisite | Owner/write set | Observable deliverable and gate |
| --- | --- | --- | --- |
| P2-01 — one fenced attempt | P1-09 | Runtime owner: `crates/application/**` lifecycle modules | Atomic claim/accept/release/expire/cancel/finish, current attempt and session uniqueness, stale-fence rejection, deadline effective before reaper persistence. |
| P2-03 — local service and fair queue | P1-09 | Service owner: `crates/service/**` transport/queue and `crates/protocol/**` scaffold; root workspace manifest only integration owner | Single elected local service, read pool, short fair writer queue, restart recovery, typed busy and separate wait/hold metrics. Starts parallel to P2-01. |
| P2-02 — receipts and closeout | P2-01 | Runtime/evidence owner: application receipt/gate modules | Structured witnessed/self-reported evidence, exact mismatch reasons, retained failures, resumable/idempotent finish, no prose-based pass, correct attempt release and one summary. |
| P2-04 — versioned protocol and Rust CLI | P2-01/03 | Protocol/CLI owner: `crates/protocol/**`, `crates/cli/**`; shared DTOs by integration owner | Kept command grammar/aliases and bounded JSON/typed errors; transport and application outcomes distinct; no TUI-owned transitions. |
| P2-05 — liveness/eligibility | P2-01/03 | Runtime owner: application runtime and agreed `service/src/runtime/**` | Heartbeat separate from checkpoint, accepted-at/current tool, bounded backoff, manual adoption, capacity from live attempts, operator-only never redispatches; expiry review/fenced stop. |
| P2-06 — status/notifications | P2-04/05 | Service/protocol owner: snapshot/notification modules | One revision plus `as_of`, bounded status with 10,000 historical attempts, cursor resume/resnapshot, TUI refresh never owns canonical writer lock. |
| P2-10 — directive compiler | P2-02/05 | Guidance owner: `crates/application/src/guidance/**`; protocol seam coordinated | Trusted versioned registry maps typed gaps/status to one safe action; authored text is data, not command authority. |
| P2-11 — guided CLI loop/handoff | P2-04/10 | Guidance + CLI integration owners on agreed modules | `prime/guide/next/start/finish/resume` retains contextual no-goal loop, queued/blocked/expired distinction, exact argv, downstream context and gate recovery. |
| P2-12 — no-goal harness parity | P2-06/11 | Independent integration validator; test fixtures only | Unfamiliar agents from supported harnesses claim, prove, finish/release, resume, and discover next work without a bespoke parent prompt or polling burst. |

P2-01 and P2-03 are simultaneous start lanes. P2-04 and P2-05 can overlap
after their prerequisites, but shared protocol DTOs, workspace manifests,
and service runtime boundaries have one integration editor. P2-10 starts only
after evidence and liveness semantics exist. Never let guidance or CLI
construct a second status/finish engine.

## Gate chain

| Gate task | Required evidence |
| --- | --- |
| P2-07 — independent review | Crash at each lifecycle boundary, duplicate/reordered delivery, stale heartbeat, old worker after expiry, wrong-subject/stale receipt, unknown mutation outcome, service election, status/guide consistency. Record findings. |
| P2-08 — reconcile | Fix or explicitly disposition every finding; update schema/protocol/transition fixtures and rerun list. |
| P2-09 — revalidate | Three harness processes complete guided claim/evidence/finish while a TUI-style reader remains available through service restart; expired live worker is not blindly replaced; required directives cannot be skipped. Unlocks S03 and S04. |

The two-hour claim experiment must distinguish renewable `--ttl` from a hard
attempt time limit. At deadline, `expired_review` is visible even if the
timer is late; no old fence can write and no shared worktree is reassigned
before a confirmed stop or reviewed safe recovery.

## Dispatch ledger — coordinator only

| Task | State | Agent | Input snapshot | Deadline UTC | Evidence/finding link |
| --- | --- | --- | --- | --- | --- |
| P2-01 | passed for current schema | McClintock (Luna) + coordinator | P1-09 passed with approved deferrals | 2026-09-15T04:01:17Z | durable SQLite adapter, lifecycle transaction tests, and application claim-to-release integration pass |
| P2-02 | passed for current schema | Peirce (Luna) + coordinator | P2-01 durable adapter | 2026-09-15T04:01:17Z | receipt/gate/review/close-intent store APIs and proof-gated close integration pass |
| P2-03 | mostly complete | Goodall/Curie/Volta/Archimedes (Luna) + coordinator | P1-09 passed with approved deferrals | 2026-09-15T04:01:17Z | queue/election, framed transport, typed application route, read pool, restart recovery, subscriptions, metrics, long-lived host; 25 service tests pass |
| P2-04 | mostly complete for current slice | Coordinator + Lagrange/Nash (Luna) | P2-01/P2-03 groundwork; protocol crate mounted | 2026-09-15T04:01:17Z | guided CLI grammar, typed envelopes, CLI service client, durable session registration, lifecycle smoke, elevated socket status/claim/release proof, bounded service evidence/finish-close payload routing, operation-ID bound regression, and failed-evidence/replay service test pass; command surface remains pending |
| P2-07 | complete | Maxwell (Luna) | Combined P2 groundwork | 2026-09-15T04:01:17Z | [review](../../../../project/build-plan/P2-07-REVIEW.md); findings recorded |
| P2-08 | reconciled for current snapshot | Coordinator | P2-07 findings | 2026-09-15T04:01:17Z | [reconciliation](../../../../project/build-plan/P2-08-RECONCILIATION.md); P2-R01/R02/R07 resolved, P2-R03/R05/R06 mostly resolved, P2-R04 mostly resolved for current slice |
| P2-09 | bounded proof passed; release gate open | Kepler (Luna) + coordinator | P2-08 reconciled snapshot | 2026-09-15T05:30:00Z | [revalidation](../../../../project/build-plan/P2-09-REVALIDATION.md); application-backed route, three actor/harness claims, expiry fencing, simulated and scripted restart, direct finish-close diagnostics, service-routed evidence/finish-close payloads, three-harness declared-gate execution/restart transcript, focused failed-evidence/replay test, Rust `guide_checked` enforcement, and no-goal CLI action validation pass; external unfamiliar-harness non-skippability transcript remains open |

After P2-09, dispatch P3-01 and P4-01 concurrently via
[handoff](../../../../AGENT_HANDOFF.md).
