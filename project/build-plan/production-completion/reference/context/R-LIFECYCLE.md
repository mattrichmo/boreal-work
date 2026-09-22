# R-LIFECYCLE — project/AGENT_LIFECYCLE.md

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `project/AGENT_LIFECYCLE.md:L1–L141`  
**File SHA-256:** `5bc921025b3f4e85efbde9b4f58dc459275be9ec7d126d7c6030fd0c628933a9`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Harness-neutral claim/accept/start/checkpoint/evidence/finish/release and expiry recovery.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,141p' 'project/AGENT_LIFECYCLE.md'
```

## Exact baseline excerpt

````text
    1 | # Agent lifecycle and dispatch
    2 | 
    3 | ## Identity
    4 | 
    5 | Keep these identities distinct:
    6 | 
    7 | - `actor_id`: accountable human or agent identity.
    8 | - `harness_id`: the adapter/provider that runs the agent; not the actor.
    9 | - `session_id`: one harness execution session.
   10 | - `work_id`: the task being attempted.
   11 | - `attempt_id`: one claim/dispatch generation for that task.
   12 | - `operation_id`: idempotency key for one requested mutation.
   13 | - `fence`: monotonic generation that invalidates older attempts after release,
   14 |   cancellation, expiry, or replacement.
   15 | 
   16 | One task has at most one current attempt. One session has at most one current
   17 | execution. Historical attempts and failed receipts remain visible. A harness
   18 | may start its own agent or adopt a manually started session, but both use the
   19 | same claim/accept/checkpoint/finish commands.
   20 | 
   21 | ## Current attempt states
   22 | 
   23 | ```text
   24 | eligible -> claimed -> accepted -> running -> verifying -> completed
   25 |                     \-> failed/released/expired/cancelled
   26 | ```
   27 | 
   28 | `claimed` means reserved, not productive. `accepted` means the runtime has
   29 | acknowledged delivery, not that useful work has begun. A heartbeat proves only
   30 | session liveness. A checkpoint or receipt records semantic progress. Work
   31 | status and dispatch eligibility are derived consistently from task state and
   32 | the current attempt; they must not become independently edited tables.
   33 | 
   34 | ## Conditional status and guided next step
   35 | 
   36 | Keep stored work state, effective readiness/eligibility, current attempt
   37 | state, and gate satisfaction distinct. A single revisioned view derives the
   38 | human status label **and** the agent's next permitted action from those
   39 | conditions. A label change is not a claimability override, and a directive
   40 | does not mutate status by itself. The full status taxonomy, precedence,
   41 | two-hour expiry/review path, and downstream-unblocking rule are in
   42 | [STATUS_MODEL.md](STATUS_MODEL.md); this table is only the agent-facing
   43 | summary.
   44 | 
   45 | | Current condition | Effective status / next guidance |
   46 | | --- | --- |
   47 | | Only a normal upstream prerequisite remains open | `queued`; show the prerequisite ID and when its accepted closeout can release this work. No claim yet. |
   48 | | Explicit intervention/reconciliation/integrity block | `blocked`; show every typed reason, owner, and permitted resolution path, never claim. |
   49 | | Operator-only, paused, or retry-not-before | Explain why automatic claim is unavailable; wait or request authorized operator action. Release preserves the condition. |
   50 | | Ready, dependency-valid, no current attempt, capacity available | Offer one fenced claim/start action. |
   51 | | Claimed but unaccepted | Offer acceptance or safe reservation recovery; do not report progress. |
   52 | | Accepted/running | Resume the attempt, show acceptance/context/checkpoint requirements; heartbeat is liveness only. |
   53 | | Verification gate open | Show exact missing receipt/command/subject/attestation and the bounded evidence action; do not offer close. |
   54 | | All required gates satisfied | Offer idempotent finish or explicit release, bound to the current attempt fence. |
   55 | | Lease/budget deadline elapsed before close | Show `expired_review` and the fenced stop/review action; never silently give a still-running shared worktree to another agent. |
   56 | | Terminal or no eligible work | Explain completed/idle state and offer the next ready item if one exists. |
   57 | 
   58 | The guide is recalculated from current state after each operation and on
   59 | resume. It exposes one trusted next action plus required/blocking directives,
   60 | not an unbounded workflow transcript. On execution, every mutation rechecks
   61 | the condition and fence; a stale guide cannot authorize a stale write. See
   62 | [INTERFACES.md](INTERFACES.md) for the CLI/API contract.
   63 | 
   64 | ## Commands and invariants
   65 | 
   66 | - `claim`: transactionally check dependency readiness, explicit eligibility,
   67 |   active attempt uniqueness, and capacity; create the attempt and reservation.
   68 |   Apply the two-hour default hard budget unless an explicit `--time-limit`
   69 |   overrides it. Return attempt ID, fence, lease deadline, hard deadline,
   70 |   and snapshot revision; lease renewal never extends the hard deadline.
   71 | - `accept`: bind a session and harness to the current attempt. Duplicate
   72 |   delivery with the same operation ID returns the original result.
   73 | - `heartbeat`: update runtime liveness for the current fenced attempt. It does
   74 |   not rewrite a work item or create a new semantic progress event each time.
   75 | - `checkpoint`: durable progress, blocker, or validation input identity. It
   76 |   may reference an output blob and Git/source snapshot.
   77 | - `release/fail`: end the current attempt, preserve its history, and derive
   78 |   whether the task becomes eligible, blocked, paused, or operator-only.
   79 | - `finish`: validate structured receipts and source identity, update work and
   80 |   attempt, release reservation, and append the final audit event in one
   81 |   transaction. A repeated finish returns the prior result. A stale attempt is
   82 |   rejected with its replacement generation, never applied to the new attempt.
   83 |   A rejected close request returns exact gate gaps; the proposed durable
   84 |   close-intent path may auto-finalize after the last valid receipt for the
   85 |   same attempt/snapshot/policy, but no receipt closes work without that intent.
   86 | 
   87 | Dispatch policy is explicit: `automatic`, `operator_only`, or `paused`, with
   88 | optional `retry_not_before`. Effective eligibility additionally requires no
   89 | hard intervention block, satisfied prerequisites, and no current attempt. A
   90 | label, parent, or description cannot silently make operator work dispatchable.
   91 | A task whose dependency is open is `queued`, not claimable, regardless of
   92 | what a scheduler last believed. Releasing an operator-only task does not
   93 | change its policy.
   94 | 
   95 | The first implementation may let agents pull ready work themselves. Automatic
   96 | dispatch is a later Rust application-service loop using the same atomic claim
   97 | operation. A scheduler tick reads a bounded candidate set, but final candidate
   98 | selection, capacity check, and claim occur in one write transaction. It does
   99 | not start a harness or wait for model output inside that transaction.
  100 | 
  101 | ## Runtime liveness
  102 | 
  103 | The runtime records accepted-at, last heartbeat, current phase/tool/process,
  104 | last checkpoint, blocker, and lease deadline separately. Heartbeat cadence and
  105 | timeouts are policy, not hardcoded task semantics. Long-running tools and
  106 | reviewers can be healthy without file edits. Expiry follows a lease and a
  107 | fenced cancellation check; it is not inferred solely from an old timestamp or
  108 | missing prose.
  109 | 
  110 | On restart, the runtime reloads current attempts and resumes timers. It
  111 | reconciles sessions with their harness adapters and marks uncertain sessions
  112 | as `unknown` until lease/ownership is resolved. It does not blindly redispatch
  113 | because a previous process failed to report completion.
  114 | An elapsed deadline is effective on read and claim even before the timer
  115 | worker persists its expiry event; the old fence is denied, and reassignment
  116 | waits for stop acknowledgement or reviewed safe recovery. See the distinct
  117 | renewable lease and hard attempt-budget rules in [STATUS_MODEL.md](STATUS_MODEL.md).
  118 | 
  119 | ## Validation receipts
  120 | 
  121 | A receipt records executable/argv, working directory, exit status, started/
  122 | ended timestamps, source snapshot or dirty-tree manifest, configuration and
  123 | environment fingerprints, output digest/reference, subject/coverage, and
  124 | executor attestation. Verification checks those fields, not incidental words
  125 | in a summary. Unknown mutation outcomes are resolved by operation ID/readback.
  126 | 
  127 | For shared dirty worktrees, a receipt names a stable file manifest or isolated
  128 | worktree snapshot. A test run by one agent while another edits routing cannot
  129 | be claimed as current for the combined tree without an integration check.
  130 | Prefer a separate Git worktree per active implementation attempt. When agents
  131 | must share a tree, record scoped file ownership and run a deliberate combined
  132 | validation checkpoint before closing dependent work. A file reservation is
  133 | coordination metadata, not a substitute for source snapshot identity.
  134 | 
  135 | ## Failure cases to test
  136 | 
  137 | Crash between claim and acceptance; duplicate claim/finish; session adoption;
  138 | reordered progress events; stale heartbeat; cancellation during tool work;
  139 | lease expiry followed by replacement; blocked release; operator-only work
  140 | under a product milestone; pause/resume; service restart; and evidence that
  141 | matches in prose but not in structured command/source identity.
````
