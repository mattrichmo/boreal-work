# Boreal v2 transition and persistence fixtures

Contract: `boreal.work-transition/2`<br>
Schema: `boreal.sqlite/2`<br>
Fixture revision: `p0-03.v2` · frozen 2026-09-14<br>
Decisions: D17–D23 and D27–D29; policy record PD-05–PD-11.

This is contract data, not a second state machine. The application evaluates
canonical rows at one `project_revision` and `as_of`, then repeats every
precondition inside the short write transaction. Clients cannot write a
displayed status.

## Vocabulary and derived status

Persisted work lifecycle is `draft`, `open`, `closed`, or `cancelled`.
`queued`, `ready`, `claimed`, `in_progress`, `needs_verification`,
`awaiting_review`, `complete`, `blocked`, `paused`, `retry_wait`, and
`expired_review` are derived. `complete` means all required technical proof
is present but final closeout is not committed; `closed` is terminal accepted
success and is the only default prerequisite satisfaction.

Attempt states are `claimed`, `accepted`, `running`, `verifying`,
`expiry_pending`, `completed`, `failed`, `released`, `expired`, and
`cancelled`. One current attempt is identified by `(work_id, fence)` and has
one reservation. A terminal historical attempt has `current = 0`.

The versioned read shape is:

```text
StatusDecision {
  contract: "boreal.work-status/2", work_id, project_revision, as_of,
  next_status_change_at, display_status, reason_codes[],
  claimable_for_actor, next_action { directive, argv[], cwd,
    runner: "exec", shell: false } | null,
  current_attempt { attempt_id, fence, state } | null,
  gate_gaps[], affected_dependents[]
}
```

All applicable `reason_codes` are returned in stable order: primary reason,
then lexical order. `next_action` is one trusted registry directive, never a
command assembled from task prose. Apply this precedence:

| Rule | Canonical condition | Display / claimability / next action |
| --- | --- | --- |
| S01 | lifecycle `closed` | `closed` / no / none (`terminal_closed`) |
| S02 | lifecycle `cancelled` | `cancelled` / no / none (`terminal_cancelled`) |
| S03 | unresolved expiry hold or attempt `expiry_pending` | `expired_review` / no / `review_expiry` (`expiry_review_required`) |
| S04 | any unresolved hard hold | `blocked` / no / `resolve_hold` (all hold reasons) |
| S05 | lifecycle `draft` | `draft` / no / `publish_work` (`not_published`) |
| S06 | current attempt `claimed` | `claimed` / no / `accept_attempt` (`attempt_unaccepted`) |
| S07 | current attempt `accepted` or `running` | `in_progress` / no / `resume_attempt` (`attempt_active`) |
| S08 | submitted/close intent with required proof gaps | `needs_verification` / no / `provide_evidence` (typed gate gaps) |
| S09 | proof passes, required review is open | `awaiting_review` / no / `request_review` (`review_required`) |
| S10 | all required verification/review gates pass, no final close | `complete` / no / `finish_close` (`closeout_pending`) |
| S11 | open default prerequisite is not closed | `queued` / no / `wait_for_prerequisite` (`prerequisite_open(<id>)`) |
| S12 | paused policy or retry time not reached | `paused`/`retry_wait` / no / `resume_policy`/`wait_until` |
| S13 | open, eligible, no attempt/hold, prerequisites closed, automatic policy | `ready` / yes / `claim` (`eligible`) |
| S14 | S13 but actor lacks automatic authority | `ready` / no / `request_operator_claim` (`operator_only`) |

If B depends on open A and has a security hold, B is `blocked` with both
`operator_decision_required` and `prerequisite_open(A)`; closing A removes only
the latter. `overdue` is an independent badge. A current attempt gaining a
hard hold remains visible and is fenced; it is not silently released.

## Legal transitions

Every changed operation appends the listed audit event and advances the
project revision by one. An idempotent replay returns its original result,
revision, and event.

| ID | Operation and canonical effect | Derived result / next action | Audit event |
| --- | --- | --- | --- |
| T01 | `publish`: draft → open with immutable profile/source snapshot | `ready`, `queued`, or `blocked`; derived action | `work.published` |
| T02 | `claim`: eligible open work → current `claimed` attempt; fence +1, lease and hard deadlines set atomically | `claimed`; `accept_attempt(attempt,fence)` | `attempt.claimed` |
| T03 | `accept`: claimed → accepted, binding session/harness | `in_progress`; `resume_attempt` | `attempt.accepted` |
| T04 | `start`: accepted → running; record immutable runtime identity | `in_progress`; `checkpoint`/approved evidence | `attempt.started` |
| T05 | `submit`: running → verifying; bind subject/source/config identity | `needs_verification`, `awaiting_review`, or `complete` from gates | `attempt.submitted` |
| T06 | `receipt`: verifying → verifying; append immutable structured receipt | Re-evaluate gates; failed receipt stays a gap | `receipt.recorded` or `receipt.rejected` |
| T07 | `review`: awaiting_review → verifying | pass → `complete`; fail → `needs_verification` with repair action | `review.accepted`/`review.rejected` |
| T08 | `finish --close`: matching complete/intent/summary/profile/snapshot/fence → closed | `closed`; release reservation; recompute dependents same revision | `work.closed` |
| T09 | `finish --close` with gaps: open attempt → open plus fenced intent | `needs_verification`/`awaiting_review`; exact gap action | `close.requested` |
| T10 | `finish --release`: current attempt → open, terminal released attempt | `ready`, `queued`, `blocked`, `paused`, or `retry_wait` | `attempt.released` |
| T11 | `fail`: running/verifying → open, terminal failed attempt | `retry_wait` or `blocked`; retain failed evidence | `attempt.failed` |
| T12 | `block`/`resolve hold`: add/remove authorized hard reason | `blocked` then recomputed state | `work.blocked`/`hold.resolved` |
| T13 | `pause`/`resume`: set/remove paused policy | `paused` then `ready`/`queued`/`blocked` | `work.paused`/`work.resumed` |
| T14 | `cancel`: nonterminal work → cancelled after authorized reason/disposition | `cancelled`; dependents do not advance | `work.cancelled` |
| T15 | `reopen`: closed/cancelled → open by audited operator decision | `ready`, `queued`, or `blocked`; retain history | `work.reopened` |
| T16 | `expiry_pending`: current attempt at `as_of >= lease_deadline` or hard deadline | `expired_review`; fence writes and request stop | `attempt.expiry_pending` |
| T17 | `expire`: stop acknowledged or reviewed safe timeout → terminal expired attempt | `expired_review`; `review_expiry` | `attempt.expired` |
| T18 | `resolve expiry`: reviewed expired work → open with ready/retry/pause/block/cancel disposition | Never blind reclaim; derive chosen state | `expiry.resolved` |

`complete` is never persisted as work lifecycle and never releases a default
edge. A passive test/receipt cannot perform T08. `finish --release` never means
done.

## Illegal transitions and exact errors

| ID | Rejected request | Error code | Safe next action |
| --- | --- | --- | --- |
| I01 | Agent sets `ready`, `complete`, `closed`, or gate passed | `status_not_assignable` | Read the current decision |
| I02 | draft claim/close, or queued claim | `work_not_published` / `dependency_open` | Publish / wait for named prerequisite |
| I03 | Claim with hold, pause, retry wait, expiry review, or current attempt | `not_claimable` | Resolve/await/review |
| I04 | Parallel current attempt on work or session | `attempt_conflict` | Read current attempt; no blind retry |
| I05 | Accept/finish before accept, or close without required proof/summary | `attempt_unaccepted` / `gate_unsatisfied` | Accept / provide typed evidence |
| I06 | Review-profile close without independent authorized review | `review_required` | Request independent review |
| I07 | complete → closed without fenced close intent | `close_intent_missing` | Send `finish --close` |
| I08 | complete/verified/cancelled prerequisite releases close-only edge | `dependency_not_closed` | Keep dependent queued/blocked |
| I09 | Expired-review blind reclaim or live shared tree replacement | `expiry_stop_unconfirmed` | Confirm stop or operator safe recovery |
| I10 | Old revision/fence writes after replacement/restart | `stale_revision` / `stale_fence` | Read operation/current snapshot |
| I11 | Wrong receipt subject, command, source, config, policy, attestation, exit, or observable | `receipt_subject_mismatch`, `receipt_command_mismatch`, `receipt_source_mismatch`, `receipt_config_mismatch`, `receipt_policy_mismatch`, `receipt_attestation_missing`, `receipt_exit_nonzero`, or `receipt_observable_missing` | Retain receipt; run exact bounded action |
| I12 | Renew after expiry or heartbeat extending hard budget | `lease_expired` / `hard_deadline_immutable` | Review expiry; hard budget is immutable |
| I13 | Agent operator/publication action or reviewer reviews own work | `role_denied` | Request authorized actor |
| I14 | Reused operation ID with different payload or unknown result retried blindly | `operation_conflict` / `operation_unknown` | Read operation result |
| I15 | Dependency edge introduces a cycle | `dependency_cycle` | Reject unchanged graph |

## Virtual clock, lease, and fence fixtures

Frozen engineering defaults: `default_lease_ttl = 30m` and
`default_hard_time_limit = 2h`. `--lease-ttl` (legacy `--ttl`) is renewable
ownership only. `--time-limit` is an immutable hard attempt budget. Both
originate at authoritative `claimed_at`; heartbeat never changes the hard
deadline. An explicit lease may exceed the hard budget to isolate the clocks.

| ID | Event at virtual time | Expected result |
| --- | --- | --- |
| C01 | claim `10:00:00Z`, `--lease-ttl 3h`, no time limit | lease `13:00:00Z`, hard `12:00:00Z`, fence 1 |
| C02 | `11:59:59Z` heartbeat/lease renewal | lease may extend by policy; hard remains `12:00:00Z` |
| C03 | read exactly `12:00:00Z`, sweeper late | `expired_review`, reason `hard_budget_elapsed`; old fence denied; expiry event not required for read correctness |
| C04 | claim `10:00:00Z`, `--time-limit 20m`, lease 3h | hard `10:20:00Z`; equality expires despite healthy heartbeat |
| C05 | default lease reaches `10:30:00Z` first | `expiry_pending`/`expired_review`, reason `lease_elapsed`; this is lease expiry, not hard-budget renewal |
| C06 | old fence writes after replacement | `stale_fence`; receipt cannot attach to new attempt |
| C07 | finish races deadline | one fenced transaction wins; loser gets `stale_fence`/`lease_expired`; no double close |
| C08 | process ignores stop in shared tree | remain `expired_review`; no successor claim until acknowledged/reviewed safe |
| C09 | restart, late sweeper, duplicate timer | same deadlines/fence; one `attempt.expired`, duplicate is unchanged |
| C10 | clock moves backward after expiry | no resurrection; reconciliation required |

`due_at` only adds `overdue`; it never steals ownership, closes, or changes a
hard deadline. `next_status_change_at` is the next lease/budget/retry timer or
null when review is required.

## Dependency, gate, receipt, and close-intent fixtures

Default dependency policy is `closed_only` at `edge/1`: only accepted
`work.closed` satisfies it. A non-default exception stores version, reason,
approver, and scope. Closing A commits its summary/audit and recomputes
direct/transitive dependents in the same revision; reopen or source/policy
supersession invalidates dependent guidance snapshots.

| Profile | Required proof | Review gate | Close behavior |
| --- | --- | --- | --- |
| `focused/1` | checkpoint + verification + summary | no | matching proof + fenced intent may auto-finalize; no intent leaves `complete` |
| `reviewed/1` | checkpoint + verification + summary | yes | technical proof gives `awaiting_review`; matching authorized review + intent may auto-finalize |
| `operator/1` | verification + summary + operator approval | no independent review | missing operator approval is a hard gate; no review is fabricated |

`finish --close` first stores one open fenced intent. Auto-finalization is
allowed only when `(work_id, attempt_id, fence, source_snapshot, config,
profile_version)` and the current summary all match. A source/policy/attempt
change invalidates the intent. Receipts and reviews are immutable; failed or
rejected evidence remains queryable. A review is required only if the profile
contains that gate.

## Revision, audit, and idempotency

Every committed mutation advances `project_revision` exactly once and appends
one immutable audit row with operation ID, actor/session, subject, event type,
fence, `as_of`, and bounded payload/digest. An operation ID replay returns its
original result; a different request digest is `operation_conflict`. A timeout
is `operation_unknown` until operation readback resolves it.

CLI, API, and TUI must produce the same decision for the same canonical
revision and clock. Repairs append correction/supersession events; they never
erase audit rows, attempts, receipts, or summaries.
