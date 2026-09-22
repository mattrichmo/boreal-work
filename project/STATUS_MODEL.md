> M02 candidate clarification (2026-09-21): historical v1 claims below are
> retained from the supplied packet, not reverified against a v1 archive.
> The current Rust evaluator exists. The executable candidate contract and
> primary-first reason ordering are in `spec/transition-table.md`.
> Independent review and all M02 sprint acceptance gates remain open.

# Deterministic work status, deadlines, and advancement

Status: approved v2 policy for P0 transition fixtures; exact schema and
engineering-level fixtures remain to be written. The code has not been ported. This document
distinguishes observed legacy behavior from v2 changes. Read with
[AGENT_LIFECYCLE.md](AGENT_LIFECYCLE.md),
[STATE_AND_CONCURRENCY.md](STATE_AND_CONCURRENCY.md), and
[CLI_COMMANDS.md](CLI_COMMANDS.md).

## PF-S01 production contract overlay

The independently reviewed PF-S01 contract set is now integrated as the
target contract for the next implementation wave. The authoritative target
status/action rules are in
[`spec/production/status-and-actions.md`](spec/production/status-and-actions.md)
and [`spec/production/reason-registry.json`](spec/production/reason-registry.json):
status/3 is additive, `integrity` and `availability` remain separate from
product status, `queued` means normal prerequisite waiting, and `blocked`
means an explicit intervention or integrity obligation. The service owns
allowed/denied actions; clients do not infer them from labels.

This overlay does not claim that the current Rust/store/protocol implementation
already persists every target field or enforces every transition. Runtime
advertisement remains gated by the production contract manifest, conformance
oracle, implementation tasks, and PF-S01/PF-S02+ review/revalidation. The
historical v1 description below remains provenance, not runtime authority.

## What the current implementation actually does

Legacy work persists one `WorkStatus` enum: `draft`, `ready`, `reserved`,
`in_progress`, `blocked`, `needs_verification`, `verified`, `closed`, and
`cancelled` ([record definition](../../packages/core/src/records.ts)).
Creation starts draft; evidence changes status to `needs_verification`;
passing verification changes it to `verified` unless open reconciliation
obligations keep it blocked; close requires verification and closeout policy
([work engine](../../packages/work-engine/src/work.ts)). A reservation changes
the work item to `in_progress`, although it does not prove useful execution
([reservation engine](../../packages/agent-runtime/src/reservations.ts)).

The dependency graph is canonical, while `dependencyIds` and readiness are
also written back into the work record as projections. `deriveReadinessStatus`
rechecks graph dependencies and reconciliation obligations; the ready queue
and claim transaction check them again. The incremental test shows closing A
readies B but leaves C queued behind B
([readiness test](../../tests/runtime/incremental-readiness.test.ts)). V1 has
no separate **work** status `queued`; it reports a normally waiting task as
`blocked`. V1 treats `closed`, `cancelled`, or `verified` prerequisites as
terminal for dependency readiness, subject to reconciliation obligations.

| Legacy stored status | V2 migration interpretation | Required caution |
| --- | --- | --- |
| `draft` | Draft unless an explicit launch/readiness record proves publication. | Do not auto-publish merely because dependencies happen to be closed. |
| `ready` | Open/published, then derive `ready`, `queued`, or `blocked` from current graph, obligations, policy, and time. | Stored v1 readiness can be stale. |
| `reserved`, `in_progress` | Open with a reconstructed current attempt only if reservation identity/expiry/owner is sound. | Missing or expired reservation becomes review/recovery, not fabricated progress. |
| `blocked` | Recompute normal prerequisite wait as `queued`; retain explicit reconciliation/decision/integrity reasons as `blocked`. | Unknown reason needs operator classification; never guess it is safe. |
| `needs_verification` | Open with retained evidence and typed unsatisfied gate reasons. | Old prose matches are not upgraded into attested receipts. |
| `verified` | Verified evidence retained; usually `complete`/closeout-pending, not `closed`. | V1 may have already released successors on `verified`; preserve that history and flag edge-policy migration. |
| `closed` | Closed only after mapping valid final outcome/summary or a supported historical migration disposition. | Invalid older summaries remain visible; do not silently erase or trust them as current. |
| `cancelled` | Cancelled with reason and dependency disposition. | V1 may have treated it as satisfying an edge; v2 requires waiver/replacement or explicit legacy edge policy. |

`agent finish --close` is already a strong composite operation: it records or
links evidence, verifies it, checks summary/gates, closes when permitted,
releases ownership, and recomputes dependents in the runtime transaction
([agent CLI](../../apps/cli/src/commands/agent.ts),
[runtime](../../packages/engine/src/runtime.ts)). It does **not** close work
just because tests pass in the background. Its one-shot variant can create a
temporary reservation for otherwise eligible unreserved work, but still
enforces the gates. V2 must preserve that enforcement. Durable close intent
and auto-finalization after a later valid receipt, described below, are an
**approved v2 extension**, not observed v1 behavior.

Legacy reservation TTL is optional. `expiresAt <= now` is semantically
expired, but the stored reservation may remain `active` until an orchestrator
tick or repair/reaper operation changes it to `expired` and recomputes work
readiness. `agent start` detects the expired active reservation and stops
with a repair/reclaim hint; claim conflict checks can still see the stored
`active` row ([runtime](../../packages/engine/src/runtime.ts),
[agent CLI](../../apps/cli/src/commands/agent.ts)). This is the exact stale
expiry window v2 should remove. Renewing after expiry is rejected; daemon
watch does not silently renew leases.

## The invariant

An agent may request a claim, submit evidence, report a checkpoint, request
finish, or request release. It cannot set `closed`, `complete`, `ready`, or a
gate to `passed` merely by asserting those words. The Rust application
derives the visible status and permitted next action from canonical records
at one revision, then rechecks every precondition in a short write
transaction. Every denied transition reports the precise missing condition
and a safe next step. History, including failed evidence and expired attempts,
is retained.

## Keep separate what the old status field mixed together

| Axis | Canonical input | Why it is separate |
| --- | --- | --- |
| Work lifecycle | `draft`, `open`, `closed`, `cancelled`; completion/closeout intent and final outcome | Whether the work still needs an accepted result. A displayed status is not independently editable. |
| Dependency graph | Typed prerequisite edges and their satisfaction policy | Waiting on an upstream task is normal sequencing, not an incident. |
| Intervention blockers | Explicit reason-coded holds, reconciliation obligations, missing integrity/permission requirements | Something must be repaired, decided, or acknowledged before progress. |
| Dispatch policy | `automatic`, `operator_only`, `paused`, plus `retry_not_before` | Who may claim and when; release never silently changes this policy. |
| Current attempt | Fenced attempt, actor, harness, session, acknowledgement, phase, lease, terminal outcome | Who owns execution now; an expired *attempt* is not an expired task. |
| Acceptance | Versioned required gates, structured receipts, verification/review/audit/checkpoint outcomes, close intent | Whether completion is proved for the current subject and source snapshot. |
| Time | Lease deadline, optional task due date, hard attempt time budget (two hours by default), next timer | A missed lease, overdue product deadline, and exhausted hard budget are different events. |

Derived `display_status`, `reason_codes`, `claimable_for_actor`,
`next_action`, `as_of`, `project_revision`, and `next_status_change_at` are one
read model over these axes. A client must not recompute its own meaning of
`ready` or `blocked` from partial fields. The TUI may use badges for secondary
conditions, but all clients receive the same primary status and reasons.

## V2 visible statuses

| Status | Exact meaning | What advances it |
| --- | --- | --- |
| `draft` | Not published for execution. Dependencies may already be planned. | Explicit plan/launch readiness check. |
| `queued` | Published and otherwise eligible, but one or more **normal prerequisite tasks** have not met their satisfaction condition. No intervention is implied. | The prerequisite's accepted closeout, then atomic dependent recomputation. |
| `ready` | Open leaf, prerequisites satisfied, no hard hold, no current attempt, retry window open, and claimable under the relevant actor/policy. | Atomic claim. |
| `claimed` | A lease/attempt exists but its runtime has not acknowledged assignment. This is not productive execution. | Runtime acceptance or claim timeout/recovery. |
| `in_progress` | Accepted current attempt is executing or reviewing. Liveness and semantic progress remain distinct. | Checkpoint, evidence, submit/finish intent, release, or failure. |
| `needs_verification` | Close has been requested or deliverable submitted, but specific required machine-checkable gates remain unsatisfied or stale. | New valid receipt/verification for the right subject and snapshot. |
| `awaiting_review` | Technical proof is present, but a required independent/human review or decision is still open. | Authorized review result, with findings disposition. |
| `complete` | All required verification and review gates passed; only final summary/publication/closeout commit remains. This is **not** terminal and does not unblock successors by default. | Final authorized summary/close transaction. Normally transient; if it persists, show the exact finalization gap or failure. |
| `closed` | All required gates and closeout policy passed; one current final summary/outcome is committed, ownership released. Terminal success. | Explicit audited reopen only. |
| `blocked` | A hard intervention reason prevents progress: explicit block, unresolved reconciliation, invalid required configuration, unsafe environment, or failed review needing repair. Merely waiting on an upstream task does **not** qualify. | Resolve/waive the named reason with authority and audit, then recompute. |
| `paused` | An explicit policy hold; no automatic claim even if dependencies are satisfied. | Authorized resume. |
| `retry_wait` | Recoverable attempt failure with a known `retry_not_before`; no claim before that time. | Timer plus fresh eligibility check, or authorized change. |
| `expired_review` | The prior claim's lease elapsed while work remained open; current ownership is being fenced/cancelled or reviewed. **The task remains open.** | Confirm cancellation/ownership, inspect prior receipts and worktree, then choose resume, retry, replan, or operator hold. |
| `cancelled` | Work intentionally withdrawn with a reason and dependency disposition. Terminal without accepted completion. | Explicit audited reopen or dependency replacement. |

`expired_review` is the primary display label while an expiry requires
attention; the canonical terminal attempt outcome is `expired`. An overdue
task due date is a separate `overdue` badge/reason and never by itself steals
an agent's lease or proves work failed. `operator_only` is a policy/badge, not
a synonym for `blocked`; an authorized operator may be able to claim it.

If multiple conditions apply, return **all** reason codes. Primary-status
precedence is: terminal `closed/cancelled`; unsafe expiry or hard intervention
`expired_review/blocked`; `draft`; current-attempt phase and gate/review state;
`paused/retry_wait`; normal `queued`; then `ready` (with an `operator_only`
policy badge when applicable). A paused
downstream item is displayed `paused` with `open_prerequisite` reasons too.
An active attempt that gains a new hard block is displayed `blocked` with its
attempt still visible and fenced; it is not silently released.

The Rust domain should expose one pure, tested evaluator, conceptually
`evaluate(work, graph, holds, policy, attempt, gates, actor, as_of) ->
StatusDecision`. It returns the primary label, all reason codes, eligible
actions, actor-specific claimability, deadline, and affected dependency IDs.
Queue listing, `work show`, `agent status`, `next`, TUI, scheduler, and the
claim/finish transaction all consume this evaluator. The first callers may
use a read snapshot; mutations **must** rerun it against current rows inside
their transaction. A stored display label or lagging projection is never an
authorization token.

## Queue versus block: concrete examples

- Task B depends on Task A. A is still in progress; B has no other problem:
  B is `queued`, reason `prerequisite_open(A)`. When A closes, B becomes
  `ready` if its own policy and gates allow it.
- Task B depends on A, but B also has an unresolved security decision: B is
  `blocked`, reasons `prerequisite_open(A)` and `operator_decision_required`.
  A closing removes only the first reason; B remains blocked.
- A test task finishes with failed validation: it is `needs_verification`
  while the same attempt can repair and rerun. If review establishes a product
  defect that requires separate work, record an explicit repair blocker or
  dependency; do not disguise the finding as an ordinary upstream queue.
- Infrastructure/operator tasks do not become automatic merely because they
  live under the same milestone or have a broad label. Their dispatch policy
  remains `operator_only` after release, expiry, or upstream close.

## Allowed progression and the proof boundary

```text
draft --publish--> queued or ready
queued --prerequisites accepted--> ready (unless another reason remains)
ready --atomic claim--> claimed --runtime accept--> in_progress
in_progress --submit/finish intent--> needs_verification or awaiting_review
proof + required approval + close intent --atomic finish--> closed
any open state --hard reason--> blocked; resolve reason --> recompute
current attempt --release/fail/expiry--> open work, recompute or review
```

The task can be submitted by an agent, but submission is only a request to
evaluate declared acceptance. It does not assert success. `finish --close`
records a fenced close intent and evaluates the gates; if any gate is missing,
the command returns `not_closed` with typed gaps and an exact evidence/review
action. When a later witnessed receipt or authorized review satisfies the
last gap for the **same task, attempt, source/config identity, and policy
version**, the engine may finish automatically from that durable intent. If
the source changes, the attempt is replaced, or the acceptance profile is
versioned, the intent is invalidated and a new finish request is required.
No passive test run closes a task without a prior close intent and a valid
summary/acceptance policy. Any slow summary composition happens before the
finish transaction; the final transaction verifies its subject, receipt
links, policy version, and snapshot identity before publishing one current
summary and closeout event.

`finish --release` preserves evidence and any failed verification, ends only
the caller's attempt, and re-derives queue/ready/blocked/paused/operator-only
status; it never means done. A gate may be waived only by an authorized,
reason-coded, scoped exception that remains visible in the final summary.
Agent prose or a force flag without policy authority cannot satisfy a gate.
Rejected finish attempts must not fabricate a successful summary, but they
must retain their failed receipts and operation result for audit/resume.

Independent review is not a universal closeout gate. It is required only
when the task's versioned acceptance profile contains a review gate. Every
task still needs its other declared structured proof and valid finish/close
intent; absence of a review gate is not absence of verification.

Downstream prerequisites are satisfied by an accepted `closed` result by
default, **not** by `complete`, `verified`, `cancelled`, release, or an agent
message saying “done”. A special edge that intentionally advances on some
earlier gate must be explicit, versioned, and visible in the graph. A
cancelled prerequisite leaves dependents queued/blocked for a replacement or
authorized waiver; cancellation is not success. This is a deliberate v2
policy change if migration finds legacy edges relying on `verified` or
`cancelled` as terminal satisfaction.

Closing a prerequisite transactionally commits its final outcome and audit
event, then makes affected dependents eligible in the same authoritative
revision or in a guaranteed revision-bound projection. A claim transaction
always rechecks the graph and cannot rely on a stale TUI/queue snapshot.
Dependents' start handoff includes the prerequisite's current final summary,
relevant decision/source references, validation receipts and limitations,
and the edge reason. It does not turn those authored texts into executable
instructions. A later supersession or re-open invalidates any dependent
guidance snapshot; already-running dependents are flagged for reconciliation,
not retroactively erased.

## Claim time limits and expiry

An attempt has `claimed_at`, `accepted_at`, `lease_deadline`,
`max_attempt_deadline`, `last_heartbeat_at`, `last_checkpoint_at`, and
`review_required_after_expiry`. A two-hour claim has a hard deadline computed
from the authoritative service/store clock, not the agent's prose or local
wall clock. Reads derive deadline-sensitive status using `as_of` even if the
timer worker is late; the snapshot also reports the next timer deadline.

When no hard `--time-limit` is specified, the attempt gets a two-hour hard
deadline at `claimed_at + 2h`. An explicit `--time-limit` replaces that
default. The lease is still separately required and renewable; its default
TTL is an engineering fixture for P0-03. The hard deadline is never renewed
by heartbeat or lease renewal. Both lease expiry and hard-budget expiry use
the fenced `expired_review` path below, with distinct reason codes.

`--ttl 2h` in the legacy CLI denotes a renewable reservation lease. A v2
`--time-limit 2h` denotes a hard attempt
budget. Both have deadlines; renewal may extend the former before expiry but
must never extend the latter without an explicit authorized budget change.
If the user simply asks for a two-hour claim, the command must state which
clock is being set. At the applicable deadline, if work is not already closed:

1. A short transaction checks that this exact attempt/fence is still current
   and that the lease actually elapsed. A completed/released/replaced attempt
   is untouched. The attempt enters `expiry_pending`; claims are disabled.
2. The runtime asks the harness to stop and awaits bounded acknowledgement.
   Canonical writes from the old fence are rejected immediately. A shared
   worktree is not reassigned while the old process may still be editing it.
3. After confirmed stop (or an operator-reviewed safe timeout), the attempt
   becomes terminal `expired`, the reservation is released, and an immutable
   expiry event records last liveness, last checkpoint, receipts, and source
   snapshot. The task displays `expired_review` by default.
4. An operator or explicit policy resolves `expired_review` to a new ready,
   retry-wait, paused, blocked, or cancelled path. Automatic retry is opt-in
   and requires fenced stop, isolated workspace ownership, bounded retry
   count/backoff, and a still-valid task. It is never an infinite redispatch
   loop.

A runtime heartbeat may demonstrate that the session is alive, but it does
not extend a **hard** two-hour work budget. A renewable lease may be extended
by a permitted `renew` before its deadline, subject to a declared maximum
and recorded reason/count. Renewing an expired attempt or a stale
fence fails; healthy liveness does not silently renew the lease. Warn before
deadline, but do not invent a claim transition from a warning. `due_at` for
the product task is independent: crossing it marks `overdue` and may trigger
notification/escalation, not automatic closure or ownership loss.

Clock, timer, restart, and race fixtures must cover exact deadline equality,
backward/forward clock changes, late sweeper, renewal racing expiry, finish
racing expiry, live process that ignores cancellation, crash before release,
duplicate timer delivery, and a successor claim while a shared worktree is
still owned. Reconciliation must be idempotent.

## Containers, reviews, and no-goal guidance

Milestone and sprint statuses are rollups, not independently edited task
statuses. A container cannot close merely because its last child reported
implementation complete. It needs accepted descendant closeouts or explicit
cancel/deferral dispositions, its own declared gate policy, and a final
summary. Rollup shows counts for queued, blocked, expired-review, in-progress,
verification/review, and closed; one blocked child does not turn all queued
siblings into “blocked”.

`next` and `agent guide` prioritize the actor's current attempt, an imminent
lease/expiry recovery, and open gate gaps before offering new work. A queued
task explains which prerequisite will release it and links that task's
summary when available. A blocked task names who/what can resolve it. A
ready task offers exact safe claim argv. An expired attempt offers review or
recovery, never a blind reclaim. Idle means there is no safe action now; it
does not mean there is no future queued work.

## P0 schema/fixture requirements

- One transition table with persisted inputs, derived status, reasons,
  actor-specific claimability, next action, affected dependents, and audit
  event for every operation.
- A versioned gate matrix and dependency-satisfaction policy. Legacy status
  migration maps ambiguous `blocked`, `reserved`, `needs_verification`, and
  `verified` records using evidence, reservation, and graph data; ambiguity
  becomes operator review, not guessed success.
- Deterministic tests for multi-harness claim races, prerequisite close/cancel/
  reopen, hard block plus queued dependency, operator-only release, failed
  verification followed by valid proof, close intent auto-finalization,
  stale receipts, summary interruption, and terminal idempotency.
- A virtual clock test suite for lease/deadline cases above, including
  restart/recovery and snapshot `as_of` semantics.
- TUI/CLI/API contract tests asserting that the same revision and clock yield
  the same status, reasons, gate gaps, and exact next permitted action.
