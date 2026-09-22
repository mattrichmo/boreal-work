# R-STATUS — project/STATUS_MODEL.md

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `project/STATUS_MODEL.md:L1–L307`  
**File SHA-256:** `85fd3cb03d8bac892b286df66d70e259ef0b4b6c306d20c0803d8abbb8487c02`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Current normative status meanings, precedence, gates, timers and actor-specific eligibility.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,307p' 'project/STATUS_MODEL.md'
```

## Exact baseline excerpt

````text
    1 | > M02 candidate clarification (2026-09-21): historical v1 claims below are
    2 | > retained from the supplied packet, not reverified against a v1 archive.
    3 | > The current Rust evaluator exists. The executable candidate contract and
    4 | > primary-first reason ordering are in `spec/transition-table.md`.
    5 | > Independent review and all M02 sprint acceptance gates remain open.
    6 | 
    7 | # Deterministic work status, deadlines, and advancement
    8 | 
    9 | Status: approved v2 policy for P0 transition fixtures; exact schema and
   10 | engineering-level fixtures remain to be written. The code has not been ported. This document
   11 | distinguishes observed legacy behavior from v2 changes. Read with
   12 | [AGENT_LIFECYCLE.md](AGENT_LIFECYCLE.md),
   13 | [STATE_AND_CONCURRENCY.md](STATE_AND_CONCURRENCY.md), and
   14 | [CLI_COMMANDS.md](CLI_COMMANDS.md).
   15 | 
   16 | ## What the current implementation actually does
   17 | 
   18 | Legacy work persists one `WorkStatus` enum: `draft`, `ready`, `reserved`,
   19 | `in_progress`, `blocked`, `needs_verification`, `verified`, `closed`, and
   20 | `cancelled` ([record definition](../../packages/core/src/records.ts)).
   21 | Creation starts draft; evidence changes status to `needs_verification`;
   22 | passing verification changes it to `verified` unless open reconciliation
   23 | obligations keep it blocked; close requires verification and closeout policy
   24 | ([work engine](../../packages/work-engine/src/work.ts)). A reservation changes
   25 | the work item to `in_progress`, although it does not prove useful execution
   26 | ([reservation engine](../../packages/agent-runtime/src/reservations.ts)).
   27 | 
   28 | The dependency graph is canonical, while `dependencyIds` and readiness are
   29 | also written back into the work record as projections. `deriveReadinessStatus`
   30 | rechecks graph dependencies and reconciliation obligations; the ready queue
   31 | and claim transaction check them again. The incremental test shows closing A
   32 | readies B but leaves C queued behind B
   33 | ([readiness test](../../tests/runtime/incremental-readiness.test.ts)). V1 has
   34 | no separate **work** status `queued`; it reports a normally waiting task as
   35 | `blocked`. V1 treats `closed`, `cancelled`, or `verified` prerequisites as
   36 | terminal for dependency readiness, subject to reconciliation obligations.
   37 | 
   38 | | Legacy stored status | V2 migration interpretation | Required caution |
   39 | | --- | --- | --- |
   40 | | `draft` | Draft unless an explicit launch/readiness record proves publication. | Do not auto-publish merely because dependencies happen to be closed. |
   41 | | `ready` | Open/published, then derive `ready`, `queued`, or `blocked` from current graph, obligations, policy, and time. | Stored v1 readiness can be stale. |
   42 | | `reserved`, `in_progress` | Open with a reconstructed current attempt only if reservation identity/expiry/owner is sound. | Missing or expired reservation becomes review/recovery, not fabricated progress. |
   43 | | `blocked` | Recompute normal prerequisite wait as `queued`; retain explicit reconciliation/decision/integrity reasons as `blocked`. | Unknown reason needs operator classification; never guess it is safe. |
   44 | | `needs_verification` | Open with retained evidence and typed unsatisfied gate reasons. | Old prose matches are not upgraded into attested receipts. |
   45 | | `verified` | Verified evidence retained; usually `complete`/closeout-pending, not `closed`. | V1 may have already released successors on `verified`; preserve that history and flag edge-policy migration. |
   46 | | `closed` | Closed only after mapping valid final outcome/summary or a supported historical migration disposition. | Invalid older summaries remain visible; do not silently erase or trust them as current. |
   47 | | `cancelled` | Cancelled with reason and dependency disposition. | V1 may have treated it as satisfying an edge; v2 requires waiver/replacement or explicit legacy edge policy. |
   48 | 
   49 | `agent finish --close` is already a strong composite operation: it records or
   50 | links evidence, verifies it, checks summary/gates, closes when permitted,
   51 | releases ownership, and recomputes dependents in the runtime transaction
   52 | ([agent CLI](../../apps/cli/src/commands/agent.ts),
   53 | [runtime](../../packages/engine/src/runtime.ts)). It does **not** close work
   54 | just because tests pass in the background. Its one-shot variant can create a
   55 | temporary reservation for otherwise eligible unreserved work, but still
   56 | enforces the gates. V2 must preserve that enforcement. Durable close intent
   57 | and auto-finalization after a later valid receipt, described below, are an
   58 | **approved v2 extension**, not observed v1 behavior.
   59 | 
   60 | Legacy reservation TTL is optional. `expiresAt <= now` is semantically
   61 | expired, but the stored reservation may remain `active` until an orchestrator
   62 | tick or repair/reaper operation changes it to `expired` and recomputes work
   63 | readiness. `agent start` detects the expired active reservation and stops
   64 | with a repair/reclaim hint; claim conflict checks can still see the stored
   65 | `active` row ([runtime](../../packages/engine/src/runtime.ts),
   66 | [agent CLI](../../apps/cli/src/commands/agent.ts)). This is the exact stale
   67 | expiry window v2 should remove. Renewing after expiry is rejected; daemon
   68 | watch does not silently renew leases.
   69 | 
   70 | ## The invariant
   71 | 
   72 | An agent may request a claim, submit evidence, report a checkpoint, request
   73 | finish, or request release. It cannot set `closed`, `complete`, `ready`, or a
   74 | gate to `passed` merely by asserting those words. The Rust application
   75 | derives the visible status and permitted next action from canonical records
   76 | at one revision, then rechecks every precondition in a short write
   77 | transaction. Every denied transition reports the precise missing condition
   78 | and a safe next step. History, including failed evidence and expired attempts,
   79 | is retained.
   80 | 
   81 | ## Keep separate what the old status field mixed together
   82 | 
   83 | | Axis | Canonical input | Why it is separate |
   84 | | --- | --- | --- |
   85 | | Work lifecycle | `draft`, `open`, `closed`, `cancelled`; completion/closeout intent and final outcome | Whether the work still needs an accepted result. A displayed status is not independently editable. |
   86 | | Dependency graph | Typed prerequisite edges and their satisfaction policy | Waiting on an upstream task is normal sequencing, not an incident. |
   87 | | Intervention blockers | Explicit reason-coded holds, reconciliation obligations, missing integrity/permission requirements | Something must be repaired, decided, or acknowledged before progress. |
   88 | | Dispatch policy | `automatic`, `operator_only`, `paused`, plus `retry_not_before` | Who may claim and when; release never silently changes this policy. |
   89 | | Current attempt | Fenced attempt, actor, harness, session, acknowledgement, phase, lease, terminal outcome | Who owns execution now; an expired *attempt* is not an expired task. |
   90 | | Acceptance | Versioned required gates, structured receipts, verification/review/audit/checkpoint outcomes, close intent | Whether completion is proved for the current subject and source snapshot. |
   91 | | Time | Lease deadline, optional task due date, hard attempt time budget (two hours by default), next timer | A missed lease, overdue product deadline, and exhausted hard budget are different events. |
   92 | 
   93 | Derived `display_status`, `reason_codes`, `claimable_for_actor`,
   94 | `next_action`, `as_of`, `project_revision`, and `next_status_change_at` are one
   95 | read model over these axes. A client must not recompute its own meaning of
   96 | `ready` or `blocked` from partial fields. The TUI may use badges for secondary
   97 | conditions, but all clients receive the same primary status and reasons.
   98 | 
   99 | ## V2 visible statuses
  100 | 
  101 | | Status | Exact meaning | What advances it |
  102 | | --- | --- | --- |
  103 | | `draft` | Not published for execution. Dependencies may already be planned. | Explicit plan/launch readiness check. |
  104 | | `queued` | Published and otherwise eligible, but one or more **normal prerequisite tasks** have not met their satisfaction condition. No intervention is implied. | The prerequisite's accepted closeout, then atomic dependent recomputation. |
  105 | | `ready` | Open leaf, prerequisites satisfied, no hard hold, no current attempt, retry window open, and claimable under the relevant actor/policy. | Atomic claim. |
  106 | | `claimed` | A lease/attempt exists but its runtime has not acknowledged assignment. This is not productive execution. | Runtime acceptance or claim timeout/recovery. |
  107 | | `in_progress` | Accepted current attempt is executing or reviewing. Liveness and semantic progress remain distinct. | Checkpoint, evidence, submit/finish intent, release, or failure. |
  108 | | `needs_verification` | Close has been requested or deliverable submitted, but specific required machine-checkable gates remain unsatisfied or stale. | New valid receipt/verification for the right subject and snapshot. |
  109 | | `awaiting_review` | Technical proof is present, but a required independent/human review or decision is still open. | Authorized review result, with findings disposition. |
  110 | | `complete` | All required verification and review gates passed; only final summary/publication/closeout commit remains. This is **not** terminal and does not unblock successors by default. | Final authorized summary/close transaction. Normally transient; if it persists, show the exact finalization gap or failure. |
  111 | | `closed` | All required gates and closeout policy passed; one current final summary/outcome is committed, ownership released. Terminal success. | Explicit audited reopen only. |
  112 | | `blocked` | A hard intervention reason prevents progress: explicit block, unresolved reconciliation, invalid required configuration, unsafe environment, or failed review needing repair. Merely waiting on an upstream task does **not** qualify. | Resolve/waive the named reason with authority and audit, then recompute. |
  113 | | `paused` | An explicit policy hold; no automatic claim even if dependencies are satisfied. | Authorized resume. |
  114 | | `retry_wait` | Recoverable attempt failure with a known `retry_not_before`; no claim before that time. | Timer plus fresh eligibility check, or authorized change. |
  115 | | `expired_review` | The prior claim's lease elapsed while work remained open; current ownership is being fenced/cancelled or reviewed. **The task remains open.** | Confirm cancellation/ownership, inspect prior receipts and worktree, then choose resume, retry, replan, or operator hold. |
  116 | | `cancelled` | Work intentionally withdrawn with a reason and dependency disposition. Terminal without accepted completion. | Explicit audited reopen or dependency replacement. |
  117 | 
  118 | `expired_review` is the primary display label while an expiry requires
  119 | attention; the canonical terminal attempt outcome is `expired`. An overdue
  120 | task due date is a separate `overdue` badge/reason and never by itself steals
  121 | an agent's lease or proves work failed. `operator_only` is a policy/badge, not
  122 | a synonym for `blocked`; an authorized operator may be able to claim it.
  123 | 
  124 | If multiple conditions apply, return **all** reason codes. Primary-status
  125 | precedence is: terminal `closed/cancelled`; unsafe expiry or hard intervention
  126 | `expired_review/blocked`; `draft`; current-attempt phase and gate/review state;
  127 | `paused/retry_wait`; normal `queued`; then `ready` (with an `operator_only`
  128 | policy badge when applicable). A paused
  129 | downstream item is displayed `paused` with `open_prerequisite` reasons too.
  130 | An active attempt that gains a new hard block is displayed `blocked` with its
  131 | attempt still visible and fenced; it is not silently released.
  132 | 
  133 | The Rust domain should expose one pure, tested evaluator, conceptually
  134 | `evaluate(work, graph, holds, policy, attempt, gates, actor, as_of) ->
  135 | StatusDecision`. It returns the primary label, all reason codes, eligible
  136 | actions, actor-specific claimability, deadline, and affected dependency IDs.
  137 | Queue listing, `work show`, `agent status`, `next`, TUI, scheduler, and the
  138 | claim/finish transaction all consume this evaluator. The first callers may
  139 | use a read snapshot; mutations **must** rerun it against current rows inside
  140 | their transaction. A stored display label or lagging projection is never an
  141 | authorization token.
  142 | 
  143 | ## Queue versus block: concrete examples
  144 | 
  145 | - Task B depends on Task A. A is still in progress; B has no other problem:
  146 |   B is `queued`, reason `prerequisite_open(A)`. When A closes, B becomes
  147 |   `ready` if its own policy and gates allow it.
  148 | - Task B depends on A, but B also has an unresolved security decision: B is
  149 |   `blocked`, reasons `prerequisite_open(A)` and `operator_decision_required`.
  150 |   A closing removes only the first reason; B remains blocked.
  151 | - A test task finishes with failed validation: it is `needs_verification`
  152 |   while the same attempt can repair and rerun. If review establishes a product
  153 |   defect that requires separate work, record an explicit repair blocker or
  154 |   dependency; do not disguise the finding as an ordinary upstream queue.
  155 | - Infrastructure/operator tasks do not become automatic merely because they
  156 |   live under the same milestone or have a broad label. Their dispatch policy
  157 |   remains `operator_only` after release, expiry, or upstream close.
  158 | 
  159 | ## Allowed progression and the proof boundary
  160 | 
  161 | ```text
  162 | draft --publish--> queued or ready
  163 | queued --prerequisites accepted--> ready (unless another reason remains)
  164 | ready --atomic claim--> claimed --runtime accept--> in_progress
  165 | in_progress --submit/finish intent--> needs_verification or awaiting_review
  166 | proof + required approval + close intent --atomic finish--> closed
  167 | any open state --hard reason--> blocked; resolve reason --> recompute
  168 | current attempt --release/fail/expiry--> open work, recompute or review
  169 | ```
  170 | 
  171 | The task can be submitted by an agent, but submission is only a request to
  172 | evaluate declared acceptance. It does not assert success. `finish --close`
  173 | records a fenced close intent and evaluates the gates; if any gate is missing,
  174 | the command returns `not_closed` with typed gaps and an exact evidence/review
  175 | action. When a later witnessed receipt or authorized review satisfies the
  176 | last gap for the **same task, attempt, source/config identity, and policy
  177 | version**, the engine may finish automatically from that durable intent. If
  178 | the source changes, the attempt is replaced, or the acceptance profile is
  179 | versioned, the intent is invalidated and a new finish request is required.
  180 | No passive test run closes a task without a prior close intent and a valid
  181 | summary/acceptance policy. Any slow summary composition happens before the
  182 | finish transaction; the final transaction verifies its subject, receipt
  183 | links, policy version, and snapshot identity before publishing one current
  184 | summary and closeout event.
  185 | 
  186 | `finish --release` preserves evidence and any failed verification, ends only
  187 | the caller's attempt, and re-derives queue/ready/blocked/paused/operator-only
  188 | status; it never means done. A gate may be waived only by an authorized,
  189 | reason-coded, scoped exception that remains visible in the final summary.
  190 | Agent prose or a force flag without policy authority cannot satisfy a gate.
  191 | Rejected finish attempts must not fabricate a successful summary, but they
  192 | must retain their failed receipts and operation result for audit/resume.
  193 | 
  194 | Independent review is not a universal closeout gate. It is required only
  195 | when the task's versioned acceptance profile contains a review gate. Every
  196 | task still needs its other declared structured proof and valid finish/close
  197 | intent; absence of a review gate is not absence of verification.
  198 | 
  199 | Downstream prerequisites are satisfied by an accepted `closed` result by
  200 | default, **not** by `complete`, `verified`, `cancelled`, release, or an agent
  201 | message saying “done”. A special edge that intentionally advances on some
  202 | earlier gate must be explicit, versioned, and visible in the graph. A
  203 | cancelled prerequisite leaves dependents queued/blocked for a replacement or
  204 | authorized waiver; cancellation is not success. This is a deliberate v2
  205 | policy change if migration finds legacy edges relying on `verified` or
  206 | `cancelled` as terminal satisfaction.
  207 | 
  208 | Closing a prerequisite transactionally commits its final outcome and audit
  209 | event, then makes affected dependents eligible in the same authoritative
  210 | revision or in a guaranteed revision-bound projection. A claim transaction
  211 | always rechecks the graph and cannot rely on a stale TUI/queue snapshot.
  212 | Dependents' start handoff includes the prerequisite's current final summary,
  213 | relevant decision/source references, validation receipts and limitations,
  214 | and the edge reason. It does not turn those authored texts into executable
  215 | instructions. A later supersession or re-open invalidates any dependent
  216 | guidance snapshot; already-running dependents are flagged for reconciliation,
  217 | not retroactively erased.
  218 | 
  219 | ## Claim time limits and expiry
  220 | 
  221 | An attempt has `claimed_at`, `accepted_at`, `lease_deadline`,
  222 | `max_attempt_deadline`, `last_heartbeat_at`, `last_checkpoint_at`, and
  223 | `review_required_after_expiry`. A two-hour claim has a hard deadline computed
  224 | from the authoritative service/store clock, not the agent's prose or local
  225 | wall clock. Reads derive deadline-sensitive status using `as_of` even if the
  226 | timer worker is late; the snapshot also reports the next timer deadline.
  227 | 
  228 | When no hard `--time-limit` is specified, the attempt gets a two-hour hard
  229 | deadline at `claimed_at + 2h`. An explicit `--time-limit` replaces that
  230 | default. The lease is still separately required and renewable; its default
  231 | TTL is an engineering fixture for P0-03. The hard deadline is never renewed
  232 | by heartbeat or lease renewal. Both lease expiry and hard-budget expiry use
  233 | the fenced `expired_review` path below, with distinct reason codes.
  234 | 
  235 | `--ttl 2h` in the legacy CLI denotes a renewable reservation lease. A v2
  236 | `--time-limit 2h` denotes a hard attempt
  237 | budget. Both have deadlines; renewal may extend the former before expiry but
  238 | must never extend the latter without an explicit authorized budget change.
  239 | If the user simply asks for a two-hour claim, the command must state which
  240 | clock is being set. At the applicable deadline, if work is not already closed:
  241 | 
  242 | 1. A short transaction checks that this exact attempt/fence is still current
  243 |    and that the lease actually elapsed. A completed/released/replaced attempt
  244 |    is untouched. The attempt enters `expiry_pending`; claims are disabled.
  245 | 2. The runtime asks the harness to stop and awaits bounded acknowledgement.
  246 |    Canonical writes from the old fence are rejected immediately. A shared
  247 |    worktree is not reassigned while the old process may still be editing it.
  248 | 3. After confirmed stop (or an operator-reviewed safe timeout), the attempt
  249 |    becomes terminal `expired`, the reservation is released, and an immutable
  250 |    expiry event records last liveness, last checkpoint, receipts, and source
  251 |    snapshot. The task displays `expired_review` by default.
  252 | 4. An operator or explicit policy resolves `expired_review` to a new ready,
  253 |    retry-wait, paused, blocked, or cancelled path. Automatic retry is opt-in
  254 |    and requires fenced stop, isolated workspace ownership, bounded retry
  255 |    count/backoff, and a still-valid task. It is never an infinite redispatch
  256 |    loop.
  257 | 
  258 | A runtime heartbeat may demonstrate that the session is alive, but it does
  259 | not extend a **hard** two-hour work budget. A renewable lease may be extended
  260 | by a permitted `renew` before its deadline, subject to a declared maximum
  261 | and recorded reason/count. Renewing an expired attempt or a stale
  262 | fence fails; healthy liveness does not silently renew the lease. Warn before
  263 | deadline, but do not invent a claim transition from a warning. `due_at` for
  264 | the product task is independent: crossing it marks `overdue` and may trigger
  265 | notification/escalation, not automatic closure or ownership loss.
  266 | 
  267 | Clock, timer, restart, and race fixtures must cover exact deadline equality,
  268 | backward/forward clock changes, late sweeper, renewal racing expiry, finish
  269 | racing expiry, live process that ignores cancellation, crash before release,
  270 | duplicate timer delivery, and a successor claim while a shared worktree is
  271 | still owned. Reconciliation must be idempotent.
  272 | 
  273 | ## Containers, reviews, and no-goal guidance
  274 | 
  275 | Milestone and sprint statuses are rollups, not independently edited task
  276 | statuses. A container cannot close merely because its last child reported
  277 | implementation complete. It needs accepted descendant closeouts or explicit
  278 | cancel/deferral dispositions, its own declared gate policy, and a final
  279 | summary. Rollup shows counts for queued, blocked, expired-review, in-progress,
  280 | verification/review, and closed; one blocked child does not turn all queued
  281 | siblings into “blocked”.
  282 | 
  283 | `next` and `agent guide` prioritize the actor's current attempt, an imminent
  284 | lease/expiry recovery, and open gate gaps before offering new work. A queued
  285 | task explains which prerequisite will release it and links that task's
  286 | summary when available. A blocked task names who/what can resolve it. A
  287 | ready task offers exact safe claim argv. An expired attempt offers review or
  288 | recovery, never a blind reclaim. Idle means there is no safe action now; it
  289 | does not mean there is no future queued work.
  290 | 
  291 | ## P0 schema/fixture requirements
  292 | 
  293 | - One transition table with persisted inputs, derived status, reasons,
  294 |   actor-specific claimability, next action, affected dependents, and audit
  295 |   event for every operation.
  296 | - A versioned gate matrix and dependency-satisfaction policy. Legacy status
  297 |   migration maps ambiguous `blocked`, `reserved`, `needs_verification`, and
  298 |   `verified` records using evidence, reservation, and graph data; ambiguity
  299 |   becomes operator review, not guessed success.
  300 | - Deterministic tests for multi-harness claim races, prerequisite close/cancel/
  301 |   reopen, hard block plus queued dependency, operator-only release, failed
  302 |   verification followed by valid proof, close intent auto-finalization,
  303 |   stale receipts, summary interruption, and terminal idempotency.
  304 | - A virtual clock test suite for lease/deadline cases above, including
  305 |   restart/recovery and snapshot `as_of` semantics.
  306 | - TUI/CLI/API contract tests asserting that the same revision and clock yield
  307 |   the same status, reasons, gate gaps, and exact next permitted action.
````
