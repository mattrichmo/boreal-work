# P0-01 policy record — owner choices approved

Owner: architecture steward. Prepared for the M01/S00 first wave on
2026-09-14. The product owner approved the policy direction and final
scope/default choices; see D13–D29 in [DECISIONS.md](../DECISIONS.md). This
table retains the alternatives and fixture impact. P0-03 can now freeze
schema/CLI contracts against those choices. The core intent is deterministic
conditional statuses, guided claim/evidence/finish, and proof-gated
downstream advancement.

| ID | Proposed choice | Alternative and tradeoff | Contract/fixture impact | Approval |
| --- | --- | --- | --- | --- |
| PD-01 — host boundary | Same-host local service for initial launch; remote workers use a later authenticated API. | Remote multi-host now expands identity, auth, and network failure scope. | One local project service; SQLite WAL never shared over network FS; duplicate-claim fixture. | Approved D13/D29 |
| PD-02 — platform | macOS and Linux first; document Windows as unsupported until transport and packaging tests exist. | Immediate Windows needs a non-Unix-socket transport and installer matrix. | Service transport, build matrix, CLI error on unsupported platform. | Approved D14 |
| PD-03 — service start | Auto-elect/start one service on active CLI/TUI use; offline maintenance may invoke the same Rust application with an exclusive maintenance boundary. | Manual start is simpler operationally but a poor no-goal agent experience. | Service election/restart/typed unavailable fixtures; no second transition implementation. | Approved D15 |
| PD-04 — operational authority | Local OS user/project boundary plus explicit project roles and session credentials for agent, reviewer, operator, and publisher actions. Operator overrides and cancellation require reason/audit. | OS permissions alone cannot distinguish an agent from an operator under one user account. Strong remote auth belongs to later multi-host work. | Actor/harness/session identity, socket permission, role-denial fixtures. | Approved D16; credential format in P0-03 |
| PD-05 — attempt cardinality | One current fenced attempt per work item and one current execution per session. Review is a separate task/stage or explicit independent gate. | Multiple simultaneous attempts on one task complicate ownership/evidence and are not needed for initial multi-agent throughput. | Unique constraints, claim/accept/adoption/replacement tests. | Approved D17 |
| PD-06 — status axes | Persist small work lifecycle; derive `queued`, `ready`, `blocked`, `complete`, `closed`, and exact next action from graph, hard reasons, policy, attempt, gates, and clock. Agents cannot directly set success labels. | Porting v1 single enum is easier but repeats stale ready/blocked and lease ambiguity. | [STATUS_MODEL.md](../STATUS_MODEL.md) transition table, reason codes, `as_of` status fixtures. | Approved D18; precise fields in P0-03 |
| PD-07 — prerequisite satisfaction | Default edge advances only on accepted `closed` outcome; `verified`, `complete`, and `cancelled` do not satisfy it. Explicit versioned edge exceptions/waivers are possible. | V1 treats `verified`/`cancelled` as terminal; changing default needs migration review of already-started successors. | Dependency edge policy, import reconciliation, close/cancel/reopen tests. | Approved D19 |
| PD-08 — claim time | Distinguish renewable lease TTL from hard attempt budget. Preserve v1 `--ttl` as lease alias; v2 uses explicit `--lease-ttl` and `--time-limit` grammar. Without an explicit hard limit, claim defaults to two hours from `claimed_at`; heartbeat cannot renew it. | One ambiguous `--ttl` is simpler but cannot tell a two-hour absolute assignment from a renewable liveness lease. | CLI fixtures, default/explicit attempt deadlines, virtual-clock equality/renewal tests. | Approved D20/D27 |
| PD-09 — expiry policy | At deadline while work is open, fence the old attempt, request/confirm stop, preserve receipts, show `expired_review`, and require explicit disposition by default. Automatic retry only opt-in with isolation, bounded attempts, backoff, and safe stop. | Immediate requeue improves utilization but risks two live writers/shared-tree corruption and review loops. | Timer/read `as_of`, expiry-pending/review state, cancellation acknowledgement, restart/race fixtures. | Approved D21; lease tuning in P0-03 |
| PD-10 — close intent | `agent finish --close` is the normal enforced path. Persist a fenced close intent so a later valid last receipt/review auto-finalizes for the same snapshot/policy; never close from a passive test or prose alone. | Explicitly re-run finish after each gap is simpler and closer to v1 but costs agent turns. | One current summary, invalidation on source/policy/attempt change, idempotent finish tests. | Approved D22 |
| PD-11 — evidence profile | Versioned per-work acceptance profile; required verification/checkpoint/audit gates use structured subject/snapshot/trust/exit/observable fields. Independent review is required only when that profile includes a review gate. Failed receipts stay immutable. | Universal maximal gates slow trivial tasks; prose-only evidence is unsafe. | Gate policy/schema/CLI diagnostics, focused vs integration and with/without-review profile fixtures. | Approved D23/D28 |
| PD-12 — memory authority | SQLite owns intake/drafts/operational links; Git at a named revision owns published curated memory. Publication/reimport is an idempotent job outside work write transactions. | DB-canonical memory with Git export simplifies write authority but loses the intended Git memory product role. | Manifest/version/citation and crash/reimport fixtures. | Approved D24 |
| PD-13 — CLI continuity | Keep high-value v1 `work`, `sprint`, `agent`, `evidence`, `raw`, `source`, `decision`, `context`, `doctor`, `sync`, and `dashboard` paths/meaning. Do not repurpose `status` (v1 prime alias), invent old `task/milestone/memory` paths, or drop guide/next. | Renaming the surface may look cleaner but breaks harnesses and the no-goal loop. | [CLI_COMMANDS.md](../CLI_COMMANDS.md) command grammar/alias fixtures and P4-11 parity. | Approved D25; exact aliases in P0-03 |

## P0-03 entry status

The owner approved the default hard deadline, review frequency, and focused
M01 breadth in [DECISIONS.md](../DECISIONS.md). P0-03 is ready for assignment
and may freeze fixtures against D13–D29. Remaining engineering details are
decided with versioned fixtures and independent P0-05 review; launch scope
cannot expand silently.

## First fixture set after approval

1. `transition-table`: `draft → queued → ready → claimed → in_progress →
   needs_verification/awaiting_review → complete → closed`, plus hard block,
   pause, release, cancel, reopen, and invalid edges.
2. `clock-and-attempt`: exact 2h boundary, renewable lease versus hard budget,
   late timer, heartbeat, renew/finish/expiry race, live worker ignoring stop,
   shared-worktree replacement denial, and stale fence after restart.
3. `dependency`: close unqueues only valid direct/transitive successors;
   cancelled/verified legacy prerequisites require migration disposition;
   a hard block remains after the upstream item closes.
4. `proof-and-guidance`: wrong subject/command/snapshot/attestation/exit,
   failed evidence retained, finish intent gaps, one summary, no-goal next,
   queued/blocked/expired guidance and exact safe argv.

P0-05 reviews these choices and fixtures independently; P0-06 reconciles;
P0-07 revalidates before P1 implementation begins.
