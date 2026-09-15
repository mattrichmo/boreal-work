# Agent lifecycle and dispatch

## Identity

Keep these identities distinct:

- `actor_id`: accountable human or agent identity.
- `harness_id`: the adapter/provider that runs the agent; not the actor.
- `session_id`: one harness execution session.
- `work_id`: the task being attempted.
- `attempt_id`: one claim/dispatch generation for that task.
- `operation_id`: idempotency key for one requested mutation.
- `fence`: monotonic generation that invalidates older attempts after release,
  cancellation, expiry, or replacement.

One task has at most one current attempt. One session has at most one current
execution. Historical attempts and failed receipts remain visible. A harness
may start its own agent or adopt a manually started session, but both use the
same claim/accept/checkpoint/finish commands.

## Current attempt states

```text
eligible -> claimed -> accepted -> running -> verifying -> completed
                    \-> failed/released/expired/cancelled
```

`claimed` means reserved, not productive. `accepted` means the runtime has
acknowledged delivery, not that useful work has begun. A heartbeat proves only
session liveness. A checkpoint or receipt records semantic progress. Work
status and dispatch eligibility are derived consistently from task state and
the current attempt; they must not become independently edited tables.

## Conditional status and guided next step

Keep stored work state, effective readiness/eligibility, current attempt
state, and gate satisfaction distinct. A single revisioned view derives the
human status label **and** the agent's next permitted action from those
conditions. A label change is not a claimability override, and a directive
does not mutate status by itself. The full status taxonomy, precedence,
two-hour expiry/review path, and downstream-unblocking rule are in
[STATUS_MODEL.md](STATUS_MODEL.md); this table is only the agent-facing
summary.

| Current condition | Effective status / next guidance |
| --- | --- |
| Only a normal upstream prerequisite remains open | `queued`; show the prerequisite ID and when its accepted closeout can release this work. No claim yet. |
| Explicit intervention/reconciliation/integrity block | `blocked`; show every typed reason, owner, and permitted resolution path, never claim. |
| Operator-only, paused, or retry-not-before | Explain why automatic claim is unavailable; wait or request authorized operator action. Release preserves the condition. |
| Ready, dependency-valid, no current attempt, capacity available | Offer one fenced claim/start action. |
| Claimed but unaccepted | Offer acceptance or safe reservation recovery; do not report progress. |
| Accepted/running | Resume the attempt, show acceptance/context/checkpoint requirements; heartbeat is liveness only. |
| Verification gate open | Show exact missing receipt/command/subject/attestation and the bounded evidence action; do not offer close. |
| All required gates satisfied | Offer idempotent finish or explicit release, bound to the current attempt fence. |
| Lease/budget deadline elapsed before close | Show `expired_review` and the fenced stop/review action; never silently give a still-running shared worktree to another agent. |
| Terminal or no eligible work | Explain completed/idle state and offer the next ready item if one exists. |

The guide is recalculated from current state after each operation and on
resume. It exposes one trusted next action plus required/blocking directives,
not an unbounded workflow transcript. On execution, every mutation rechecks
the condition and fence; a stale guide cannot authorize a stale write. See
[INTERFACES.md](INTERFACES.md) for the CLI/API contract.

## Commands and invariants

- `claim`: transactionally check dependency readiness, explicit eligibility,
  active attempt uniqueness, and capacity; create the attempt and reservation.
  Apply the two-hour default hard budget unless an explicit `--time-limit`
  overrides it. Return attempt ID, fence, lease deadline, hard deadline,
  and snapshot revision; lease renewal never extends the hard deadline.
- `accept`: bind a session and harness to the current attempt. Duplicate
  delivery with the same operation ID returns the original result.
- `heartbeat`: update runtime liveness for the current fenced attempt. It does
  not rewrite a work item or create a new semantic progress event each time.
- `checkpoint`: durable progress, blocker, or validation input identity. It
  may reference an output blob and Git/source snapshot.
- `release/fail`: end the current attempt, preserve its history, and derive
  whether the task becomes eligible, blocked, paused, or operator-only.
- `finish`: validate structured receipts and source identity, update work and
  attempt, release reservation, and append the final audit event in one
  transaction. A repeated finish returns the prior result. A stale attempt is
  rejected with its replacement generation, never applied to the new attempt.
  A rejected close request returns exact gate gaps; the proposed durable
  close-intent path may auto-finalize after the last valid receipt for the
  same attempt/snapshot/policy, but no receipt closes work without that intent.

Dispatch policy is explicit: `automatic`, `operator_only`, or `paused`, with
optional `retry_not_before`. Effective eligibility additionally requires no
hard intervention block, satisfied prerequisites, and no current attempt. A
label, parent, or description cannot silently make operator work dispatchable.
A task whose dependency is open is `queued`, not claimable, regardless of
what a scheduler last believed. Releasing an operator-only task does not
change its policy.

The first implementation may let agents pull ready work themselves. Automatic
dispatch is a later Rust application-service loop using the same atomic claim
operation. A scheduler tick reads a bounded candidate set, but final candidate
selection, capacity check, and claim occur in one write transaction. It does
not start a harness or wait for model output inside that transaction.

## Runtime liveness

The runtime records accepted-at, last heartbeat, current phase/tool/process,
last checkpoint, blocker, and lease deadline separately. Heartbeat cadence and
timeouts are policy, not hardcoded task semantics. Long-running tools and
reviewers can be healthy without file edits. Expiry follows a lease and a
fenced cancellation check; it is not inferred solely from an old timestamp or
missing prose.

On restart, the runtime reloads current attempts and resumes timers. It
reconciles sessions with their harness adapters and marks uncertain sessions
as `unknown` until lease/ownership is resolved. It does not blindly redispatch
because a previous process failed to report completion.
An elapsed deadline is effective on read and claim even before the timer
worker persists its expiry event; the old fence is denied, and reassignment
waits for stop acknowledgement or reviewed safe recovery. See the distinct
renewable lease and hard attempt-budget rules in [STATUS_MODEL.md](STATUS_MODEL.md).

## Validation receipts

A receipt records executable/argv, working directory, exit status, started/
ended timestamps, source snapshot or dirty-tree manifest, configuration and
environment fingerprints, output digest/reference, subject/coverage, and
executor attestation. Verification checks those fields, not incidental words
in a summary. Unknown mutation outcomes are resolved by operation ID/readback.

For shared dirty worktrees, a receipt names a stable file manifest or isolated
worktree snapshot. A test run by one agent while another edits routing cannot
be claimed as current for the combined tree without an integration check.
Prefer a separate Git worktree per active implementation attempt. When agents
must share a tree, record scoped file ownership and run a deliberate combined
validation checkpoint before closing dependent work. A file reservation is
coordination metadata, not a substitute for source snapshot identity.

## Failure cases to test

Crash between claim and acceptance; duplicate claim/finish; session adoption;
reordered progress events; stale heartbeat; cancellation during tool work;
lease expiry followed by replacement; blocked release; operator-only work
under a product milestone; pause/resume; service restart; and evidence that
matches in prose but not in structured command/source identity.
