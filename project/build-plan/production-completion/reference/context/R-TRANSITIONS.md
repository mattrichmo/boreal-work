# R-TRANSITIONS — project/spec/transition-table.md

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `project/spec/transition-table.md:L1–L218`  
**File SHA-256:** `4a22bceb49b8d40d96a872f2ae3aed8b79a81d5636339c609914a05b3a2a9d38`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Legal and illegal transitions, versioned canonical-state mutations and conformance vectors.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,218p' 'project/spec/transition-table.md'
```

## Exact baseline excerpt

````text
    1 | # Boreal v2 transition and persistence fixtures
    2 | 
    3 | Contract: `boreal.work-transition/2`<br>
    4 | Schema: `boreal.sqlite/2`<br>
    5 | Fixture revision: `m02-candidate.1` · 2026-09-21; independent review pending<br>
    6 | Decisions: D17–D23 and D27–D29; policy record PD-05–PD-11.
    7 | 
    8 | This is contract data, not a second state machine. The application evaluates
    9 | canonical rows at one `project_revision` and `as_of`, then repeats every
   10 | precondition inside the short write transaction. Clients cannot write a
   11 | displayed status.
   12 | 
   13 | ## Vocabulary and derived status
   14 | 
   15 | Persisted work lifecycle is `draft`, `open`, `closed`, or `cancelled`.
   16 | `queued`, `ready`, `claimed`, `in_progress`, `needs_verification`,
   17 | `awaiting_review`, `complete`, `blocked`, `paused`, `retry_wait`, and
   18 | `expired_review` are derived. `complete` means all required technical proof
   19 | is present but final closeout is not committed; `closed` is terminal accepted
   20 | success and is the only default prerequisite satisfaction.
   21 | 
   22 | Attempt states are `claimed`, `accepted`, `running`, `verifying`,
   23 | `expiry_pending`, `completed`, `failed`, `released`, `expired`, and
   24 | `cancelled`. One current attempt is identified by `(work_id, fence)` and has
   25 | one reservation. A terminal historical attempt has `current = 0`.
   26 | 
   27 | The versioned read shape is:
   28 | 
   29 | ```text
   30 | StatusDecision {
   31 |   contract: "boreal.work-status/2", work_id, project_revision, as_of,
   32 |   next_status_change_at, display_status, primary_reason, reason_codes[],
   33 |   claimable_for_actor, next_action { directive, argv[], cwd,
   34 |     runner: "exec", shell: false } | null,
   35 |   current_attempt { attempt_id, fence, state } | null,
   36 |   gate_gaps[], affected_dependents[]
   37 | }
   38 | ```
   39 | 
   40 | All applicable `reason_codes` are returned in stable order: primary reason,
   41 | then lexical order. `next_action` is one trusted registry directive, never a
   42 | command assembled from task prose. Apply this precedence:
   43 | 
   44 | | Rule | Canonical condition | Display / claimability / next action |
   45 | | --- | --- | --- |
   46 | | S01 | lifecycle `closed` | `closed` / no / none (`terminal_closed`) |
   47 | | S02 | lifecycle `cancelled` | `cancelled` / no / none (`terminal_cancelled`) |
   48 | | S03 | unresolved expiry hold or attempt `expiry_pending` | `expired_review` / no / `review_expiry` (`expiry_review_required`) |
   49 | | S04 | any unresolved hard hold | `blocked` / no / `resolve_hold` (all hold reasons) |
   50 | | S05 | lifecycle `draft` | `draft` / no / `publish_work` (`not_published`) |
   51 | | S06 | current attempt `claimed` | `claimed` / no / `accept_attempt` (`attempt_unaccepted`) |
   52 | | S07 | current attempt `accepted` or `running` | `in_progress` / no / `resume_attempt` (`attempt_active`) |
   53 | | S08 | submitted/close intent with required proof gaps | `needs_verification` / no / `provide_evidence` (typed gate gaps) |
   54 | | S09 | proof passes, required review is open | `awaiting_review` / no / `request_review` (`review_required`) |
   55 | | S10 | all required verification/review gates pass, no final close | `complete` / no / `finish_close` (`closeout_pending`) |
   56 | | S11 | paused policy, then a future retry time | `paused`/`retry_wait` / no / `resume_policy`/`wait_until`; retain prerequisite reasons |
   57 | | S12 | open default prerequisite is not closed | `queued` / no / `wait_for_prerequisite` (`prerequisite_open(<id>)`) |
   58 | | S13 | open, eligible, no attempt/hold, prerequisites closed, automatic policy | `ready` / yes / `claim` (`eligible`) |
   59 | | S14 | S13 but actor lacks automatic authority | `ready` / no / `request_operator_claim` (`operator_only`) |
   60 | 
   61 | If B depends on open A and has a security hold, B is `blocked` with both
   62 | `operator_decision_required` and `prerequisite_open(A)`; closing A removes only
   63 | the latter. `overdue` is an independent badge. A current attempt gaining a
   64 | hard hold remains visible and is fenced; it is not silently released.
   65 | 
   66 | ## Legal transitions
   67 | 
   68 | Every changed operation appends the listed audit event and advances the
   69 | project revision by one. An idempotent replay returns its original result,
   70 | revision, and event.
   71 | 
   72 | | ID | Operation and canonical effect | Derived result / next action | Audit event |
   73 | | --- | --- | --- | --- |
   74 | | T01 | `publish`: draft → open with immutable profile/source snapshot | `ready`, `queued`, or `blocked`; derived action | `work.published` |
   75 | | T02 | `claim`: eligible open work → current `claimed` attempt; fence +1, lease and hard deadlines set atomically | `claimed`; `accept_attempt(attempt,fence)` | `attempt.claimed` |
   76 | | T03 | `accept`: claimed → accepted, binding session/harness | `in_progress`; `resume_attempt` | `attempt.accepted` |
   77 | | T04 | `start`: accepted → running; record immutable runtime identity | `in_progress`; `checkpoint`/approved evidence | `attempt.started` |
   78 | | T05 | `submit`: running → verifying; bind subject/source/config identity | `needs_verification`, `awaiting_review`, or `complete` from gates | `attempt.submitted` |
   79 | | T06 | `receipt`: verifying → verifying; append immutable structured receipt | Re-evaluate gates; failed receipt stays a gap | `receipt.recorded` or `receipt.rejected` |
   80 | | T07 | `review`: awaiting_review → verifying | pass → `complete`; rejected required review → `blocked` with an explicit review disposition | `review.accepted`/`review.rejected` |
   81 | | T08 | `finish --close`: matching complete/intent/summary/profile/snapshot/fence → closed | `closed`; release reservation; recompute dependents same revision | `work.closed` |
   82 | | T09 | `finish --close` with gaps: open attempt → open plus fenced intent | `needs_verification`/`awaiting_review`; exact gap action | `close.requested` |
   83 | | T10 | `finish --release`: current attempt → open, terminal released attempt | `ready`, `queued`, `blocked`, `paused`, or `retry_wait` | `attempt.released` |
   84 | | T11 | `fail`: running/verifying → open, terminal failed attempt | `retry_wait` or `blocked`; retain failed evidence | `attempt.failed` |
   85 | | T12 | `block`/`resolve hold`: add/remove authorized hard reason | `blocked` then recomputed state | `work.blocked`/`hold.resolved` |
   86 | | T13 | `pause`/`resume`: set/remove paused policy | `paused` then `ready`/`queued`/`blocked` | `work.paused`/`work.resumed` |
   87 | | T14 | `cancel`: nonterminal work → cancelled after authorized reason/disposition | `cancelled`; dependents do not advance | `work.cancelled` |
   88 | | T15 | `reopen`: closed/cancelled → open by audited operator decision | `ready`, `queued`, or `blocked`; retain history | `work.reopened` |
   89 | | T16 | `expiry_pending`: current attempt at `as_of >= lease_deadline` or hard deadline | `expired_review`; fence writes and request stop | `attempt.expiry_pending` |
   90 | | T17 | `expire`: stop acknowledged or reviewed safe timeout → terminal expired attempt | `expired_review`; `review_expiry` | `attempt.expired` |
   91 | | T18 | `resolve expiry`: reviewed expired work → open with ready/retry/pause/block/cancel disposition | Never blind reclaim; derive chosen state | `expiry.resolved` |
   92 | 
   93 | `complete` is never persisted as work lifecycle and never releases a default
   94 | edge. A passive test/receipt cannot perform T08. `finish --release` never means
   95 | done.
   96 | 
   97 | ## Illegal transitions and exact errors
   98 | 
   99 | | ID | Rejected request | Error code | Safe next action |
  100 | | --- | --- | --- | --- |
  101 | | I01 | Agent sets `ready`, `complete`, `closed`, or gate passed | `status_not_assignable` | Read the current decision |
  102 | | I02 | draft claim/close, or queued claim | `work_not_published` / `dependency_open` | Publish / wait for named prerequisite |
  103 | | I03 | Claim with hold, pause, retry wait, expiry review, or current attempt | `not_claimable` | Resolve/await/review |
  104 | | I04 | Parallel current attempt on work or session | `attempt_conflict` | Read current attempt; no blind retry |
  105 | | I05 | Accept/finish before accept, or close without required proof/summary | `attempt_unaccepted` / `gate_unsatisfied` | Accept / provide typed evidence |
  106 | | I06 | Review-profile close without independent authorized review | `review_required` | Request independent review |
  107 | | I07 | complete → closed without fenced close intent | `close_intent_missing` | Send `finish --close` |
  108 | | I08 | complete/verified/cancelled prerequisite releases close-only edge | `dependency_not_closed` | Keep dependent queued/blocked |
  109 | | I09 | Expired-review blind reclaim or live shared tree replacement | `expiry_stop_unconfirmed` | Confirm stop or operator safe recovery |
  110 | | I10 | Old revision/fence writes after replacement/restart | `stale_revision` / `stale_fence` | Read operation/current snapshot |
  111 | | I11 | Wrong receipt subject, command, source, config, policy, attestation, exit, or observable | `receipt_subject_mismatch`, `receipt_command_mismatch`, `receipt_source_mismatch`, `receipt_config_mismatch`, `receipt_policy_mismatch`, `receipt_attestation_missing`, `receipt_exit_nonzero`, or `receipt_observable_missing` | Retain receipt; run exact bounded action |
  112 | | I12 | Renew after expiry or heartbeat extending hard budget | `lease_expired` / `hard_deadline_immutable` | Review expiry; hard budget is immutable |
  113 | | I13 | Agent operator/publication action or reviewer reviews own work | `role_denied` | Request authorized actor |
  114 | | I14 | Reused operation ID with different payload or unknown result retried blindly | `operation_conflict` / `operation_unknown` | Read operation result |
  115 | | I15 | Dependency edge introduces a cycle | `dependency_cycle` | Reject unchanged graph |
  116 | 
  117 | ## Virtual clock, lease, and fence fixtures
  118 | 
  119 | Frozen engineering defaults: `default_lease_ttl = 30m` and
  120 | `default_hard_time_limit = 2h`. `--lease-ttl` (legacy `--ttl`) is renewable
  121 | ownership only. `--time-limit` is an immutable hard attempt budget. Both
  122 | originate at authoritative `claimed_at`; heartbeat never changes the hard
  123 | deadline. An explicit lease may exceed the hard budget to isolate the clocks.
  124 | 
  125 | | ID | Event at virtual time | Expected result |
  126 | | --- | --- | --- |
  127 | | C01 | claim `10:00:00Z`, `--lease-ttl 3h`, no time limit | lease `13:00:00Z`, hard `12:00:00Z`, fence 1 |
  128 | | C02 | `11:59:59Z` heartbeat/lease renewal | lease may extend by policy; hard remains `12:00:00Z` |
  129 | | C03 | read exactly `12:00:00Z`, sweeper late | `expired_review`, reason `hard_budget_elapsed`; old fence denied; expiry event not required for read correctness |
  130 | | C04 | claim `10:00:00Z`, `--time-limit 20m`, lease 3h | hard `10:20:00Z`; equality expires despite healthy heartbeat |
  131 | | C05 | default lease reaches `10:30:00Z` first | `expiry_pending`/`expired_review`, reason `lease_elapsed`; this is lease expiry, not hard-budget renewal |
  132 | | C06 | old fence writes after replacement | `stale_fence`; receipt cannot attach to new attempt |
  133 | | C07 | finish races deadline | one fenced transaction wins; loser gets `stale_fence`/`lease_expired`; no double close |
  134 | | C08 | process ignores stop in shared tree | remain `expired_review`; no successor claim until acknowledged/reviewed safe |
  135 | | C09 | restart, late sweeper, duplicate timer | same deadlines/fence; one `attempt.expired`, duplicate is unchanged |
  136 | | C10 | clock moves backward after expiry | no resurrection; reconciliation required |
  137 | 
  138 | `due_at` only adds `overdue`; it never steals ownership, closes, or changes a
  139 | hard deadline. `next_status_change_at` is the next lease/budget/retry timer or
  140 | null when review is required.
  141 | 
  142 | ## Dependency, gate, receipt, and close-intent fixtures
  143 | 
  144 | Default dependency policy is `closed_only` at `edge/1`: only accepted
  145 | `work.closed` satisfies it. A non-default exception stores version, reason,
  146 | approver, and scope. Closing A commits its summary/audit and recomputes
  147 | direct/transitive dependents in the same revision; reopen or source/policy
  148 | supersession invalidates dependent guidance snapshots.
  149 | 
  150 | | Profile | Required proof | Review gate | Close behavior |
  151 | | --- | --- | --- | --- |
  152 | | `focused/1` | checkpoint + verification + summary | no | matching proof + fenced intent may auto-finalize; no intent leaves `complete` |
  153 | | `reviewed/1` | checkpoint + verification + summary | yes | technical proof gives `awaiting_review`; matching authorized review + intent may auto-finalize |
  154 | | `operator/1` | verification + summary + operator approval | no independent review | missing operator approval is a hard gate; no review is fabricated |
  155 | 
  156 | `finish --close` first stores one open fenced intent. Auto-finalization is
  157 | allowed only when `(work_id, attempt_id, fence, source_snapshot, config,
  158 | profile_version)` and the current summary all match. A source/policy/attempt
  159 | change invalidates the intent. Receipts and reviews are immutable; failed or
  160 | rejected evidence remains queryable. A review is required only if the profile
  161 | contains that gate.
  162 | 
  163 | ## Revision, audit, and idempotency
  164 | 
  165 | Every committed mutation advances `project_revision` exactly once and appends
  166 | one immutable audit row with operation ID, actor/session, subject, event type,
  167 | fence, `as_of`, and bounded payload/digest. An operation ID replay returns its
  168 | original result; a different request digest is `operation_conflict`. A timeout
  169 | is `operation_unknown` until operation readback resolves it.
  170 | 
  171 | CLI, API, and TUI must produce the same decision for the same canonical
  172 | revision and clock. Repairs append correction/supersession events; they never
  173 | erase audit rows, attempts, receipts, or summaries.
  174 | 
  175 | ## M02 candidate amendments and implementation boundary
  176 | 
  177 | This contract does not certify availability of any public operation. S00-T07
  178 | requires an independent reviewer; the current workspace has no such signoff.
  179 | See `project/validation/m02/REVIEW.md` and the root implementation report.
  180 | 
  181 | `primary_reason` is an additive read field. `reason_codes[0]` repeats it; the
  182 | remaining codes are distinct and lexically ordered. Reordering prerequisites,
  183 | holds, gates, or affected dependents must not change the decision. Hard holds
  184 | do not suppress normal prerequisite, policy, or timer facts. A reviewer or
  185 | publisher is not an execution agent. Operator-only work is `ready`, but only
  186 | the durable operator actor is claimable. Claimed/active ownership still needs
  187 | session/fence authorization at the mutation boundary.
  188 | 
  189 | The fixed-hierarchy compatibility strategy is described in
  190 | `project/validation/m02/SPRINT_STRATEGY.md`. A planning container is not
  191 | executable. `container_planning` is a provisional queue/read label, not proof
  192 | that descendant rollups, readiness, or sprint completion exist.
  193 | 
  194 | ### Override policy (target, not implemented)
  195 | 
  196 | Every override envelope requires an operation ID and request digest, selected
  197 | project, authorized durable actor, expected project revision, target ID and
  198 | target revision, stable reason, nonempty comment, exact scope, optional expiry
  199 | and supporting evidence references. Authorization is not established by
  200 | `--actor-role` or a boolean `--force`. Reusing an operation ID with a different
  201 | digest fails; an exact replay returns the original decision and audit event.
  202 | 
  203 | | Operation | Authorized role | Canonical change | Required safeguards |
  204 | | --- | --- | --- | --- |
  205 | | Gate force | Operator | Append a named gate decision, visibly forced | Bind gate/work/attempt/fence/source/config/profile; never alter a receipt |
  206 | | Dependency waiver | Operator | Append one edge-scoped satisfaction decision | Bind both endpoints and edge revision; never waive all dependencies |
  207 | | Revoke override | Operator | Append superseding revocation | Reference original decision; retain it; recompute status |
  208 | | Review approve/reject/return | Reviewer or authorized operator | Append independent decision | Cannot review own attempt; bind exact proof/config/profile/fence |
  209 | | Pause/resume | Operator | Change dispatch policy | Resume restores explicit previous policy, not unconditional automatic |
  210 | | Hold resolve | Operator | Append resolution to named hold | Nonempty reason and comment; never erase the hold |
  211 | | Cancel/reopen | Operator | Change persisted lifecycle | Explicit dependency disposition; preserve evidence and former attempts |
  212 | | Expiry disposition | Operator | Resolve expiry obligation | Confirm execution stopped; select retry/pause/cancel/hold; no blind reclaim |
  213 | 
  214 | Stable target override reasons are `risk_accepted`, `external_evidence`,
  215 | `superseded_work`, `duplicate_work`, and `migration_disposition`. They do not
  216 | create authorization. `gate_forced`, `dependency_waived`, `override_expired`,
  217 | and `override_revoked` must remain visible in target readback/audit. These
  218 | identifiers are reserved until versioned persistence and public routes exist.
````
