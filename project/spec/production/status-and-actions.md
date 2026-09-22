# Deterministic status, integrity, availability, and action contract

**Contract:** `boreal.work-status/3` (additive to the readable v2 envelope)
**Status:** proposed PF-S01-T05 artifact; not a claim that the current source
already implements every action descriptor.

## One evaluator and three dimensions

The Rust domain owns one pure decision function:

```text
evaluate(work, graph, holds, dispatch_policy, attempt, submission,
         requirements, observations, decisions, actor, availability,
         integrity, as_of, policy_version) -> StatusDecision
```

The same canonical facts, actor context, policy version, and `as_of` produce
the same result. Queue listing, `status`, `work show`, `guide`, `next`, the
service API, TUI, scheduler, and every mutation transaction consume this
decision. A client never rederives claimability from a display label.

The response has three independent dimensions:

| Dimension | Values | Meaning |
| --- | --- | --- |
| Availability | `live`, `stale`, `unavailable`, `incompatible` | Whether the service/snapshot can currently be trusted for fresh interaction. It is not a work lifecycle. |
| Integrity | `valid`, `degraded`, `quarantined` | Whether required identity, profile, graph, clock, artifact, and history facts are trustworthy. It is not dependency waiting. |
| Product status | The derived statuses below | What the work requires next under a named policy and revision. |

If availability is unavailable, return a timestamped last-known view only for
the selected project, disable mutation actions, expose diagnostics/readback,
and never switch to another project or fabricate counts. If integrity is
degraded, preserve usable siblings and attach typed diagnostics. If the
required facts for a decision cannot be trusted, set `integrity=quarantined`,
set `display_status=blocked` with primary reason
`integrity_quarantined`, expose only diagnostics/export/repair and authorized
recovery actions, and deny forward-progress mutations. `quarantined` is an
integrity value, never a product-status enum. A contradictory terminal fact
also maps to `blocked`/`integrity_quarantined`; it cannot be displayed as
trusted `closed` or `cancelled`.

## Status meanings and precedence

`closed` and `cancelled` are persisted terminal lifecycle decisions. The other
labels are derived. `complete` is not terminal and never satisfies a default
dependency; accepted `closed` is the only normal downstream success.

Evaluate the following in order after validating the minimum facts needed for
the selected branch. Return every applicable reason, with the primary reason
first. The primary reason is selected by status precedence and the registry's
priority; remaining reasons use the existing transition-fixture ordering:
lexical `code`, then `subject_kind`, then `subject_id`, with exact duplicates
removed. This is the status/3 rule that PF-S01-T11 must encode in the shared
fixture and protocol manifest.

| Order | Status | Exact meaning | Claimable? |
| ---: | --- | --- | --- |
| 1 | `closed` / `cancelled` | A valid terminal decision exists. Contradictory terminal facts are integrity corruption. | No |
| 2 | `expired_review` | Execution lease or hard budget elapsed while safe stop/recovery remains unresolved, whether or not the current-attempt pointer survived. | No |
| 3 | `blocked` | An explicit hard hold, rejected required review, failed disposition, invalid required configuration, unsafe resource, or integrity/authority intervention prevents progress. | No forward progress; recovery actions may remain |
| 4 | `draft` | Work is not published for execution. | No |
| 5 | `claimed` | A valid attempt/lease exists but runtime has not acknowledged delivery. | No; accept/recover |
| 6 | `in_progress` | The current valid attempt is accepted/running/verifying or a sealed submission is being processed. | No; resume/submit/evidence |
| 7 | `needs_verification` | A submitted result/close intent exists but required technical proof is missing, failed, stale, or incorrectly attributed. | No |
| 8 | `awaiting_review` | Required technical proof is valid and an independent review decision is still open. | No |
| 9 | `complete` | Required technical proof and configured review pass; final summary/closeout is not committed. | No; finish close |
| 10 | `paused` | Dispatch is explicitly paused and no higher condition applies. | No |
| 11 | `retry_wait` | Retry is authorized but its `retry_not_before` has not arrived. | No |
| 12 | `scheduled` | A declared start/cycle activation constraint blocks dispatch. This exists only in `boreal.work-status/3`; older clients receive a compatible `queued` plus `scheduled` reason. | No |
| 13 | `queued` | Published work is waiting on one or more normal prerequisites lacking accepted closed outcomes. | No |
| 14 | `ready` | Published work has no hard hold, no current attempt, satisfied prerequisites, open retry window, valid requirements, and a dispatch policy that permits this actor. | Actor/policy dependent |

`operator_only` is a dispatch-policy reason, not a synonym for `blocked`.
Operator-only work may display `ready` while an agent's action is denied.
`overdue` is an independent time badge and never steals a lease, changes a
hard budget, closes work, or creates a block by itself.

Combined facts retain secondary reasons. Examples:

- Paused work with an open prerequisite is `paused` with `paused_policy` and
  `prerequisite_open(A)`.
- Expired work with a security hold is `expired_review` with both
  `hard_budget_elapsed` and `operator_decision_required`.
- A rejected required review is `blocked` with
  `review_rejected_reconciliation_required`, not `awaiting_review` or merely
  `proof_missing`.
- A normal dependent of an upstream rejected review remains `queued` with
  `prerequisite_open(A)` and `upstream_review_rejected(A)` unless the
  dependent has its own hard hold.
- A malformed profile or untrusted terminal outcome sets integrity to
  `quarantined` and displays `blocked` with `integrity_quarantined`, not
  `ready`, `complete`, or trusted `closed`.

## Status decision and action descriptor

Every read returns:

```text
StatusDecision {
  contract: "boreal.work-status/3"
  work_id, project_id, project_revision, entity_revision,
  proof_revision, as_of, next_status_change_at,
  availability, integrity, display_status,
  primary_reason, reasons[],
  claimable_for_actor,
  allowed_actions[], denied_actions[],
  current_attempt?, submission?, gate_gaps[], affected_dependents[],
  diagnostics[]
}
```

An action descriptor is server-produced and includes action name, target
identity, expected project/entity/proof revision, attempt/fence where needed,
required actor role, required inputs, confirmation text, and whether it is a
recovery/read-only operation. Denied actions include a typed reason and a
route to the relevant prerequisite, reviewer, hold, or repair operation.

Safe actions remain available under a hard forward-progress block where
appropriate: inspect history, read operation outcome, attach valid recovery
evidence, request/confirm stop, reconcile a resource, resolve an expiry,
review a submission, and view diagnostics. A blocked label does not disable
all safety operations; an action descriptor also does not authorize a role
that the service has denied.

| Status / condition | Typical allowed actions | Explicitly denied |
| --- | --- | --- |
| `draft` | inspect, publish, edit requirements under revision | claim, start, finish |
| `queued` | inspect prerequisites, guide/next, add approved planning data | claim/start |
| `ready` | claim if actor/policy permits, inspect | finish without attempt |
| `claimed` | accept, request safe recovery, inspect | start from foreign/stale fence |
| `in_progress` | resume, checkpoint, evidence, submit, finish/release, request stop | foreign mutation, close without proof |
| `needs_verification` | attach exact evidence, inspect failed receipts, release/rework | close, fabricate pass |
| `awaiting_review` | authorized review approve/reject/return, inspect | executor self-review, new execution without supersession |
| `complete` | matching finish/close, inspect | default dependency release without close |
| `blocked` | inspect, recovery evidence, resolve/waive named hold if authorized, stop/release | ordinary claim/close |
| `paused` / `retry_wait` | inspect, authorized resume/policy change, wait | automatic claim before policy/time allows |
| `expired_review` | stop/reconcile, inspect, resolve expiry to retry/pause/block/cancel | blind reclaim, old-fence write |
| `closed` / `cancelled` | inspect, audited reopen if authorized | ordinary mutation |
| quarantined integrity | diagnostics, export, repair/rebuild projection, operator review | forward progress or fabricated reconstruction |

All mutations reread canonical facts and repeat the action decision inside the
committing transaction. A stale action descriptor returns a typed revision or
fence conflict without a partial mutation. External processes run outside the
transaction through durable operations and readback.

## Reasons, timers, and dependency language

Reasons are structured records with `code`, `priority`, `subject_kind`,
`subject_id`, `message_key`, `parameters`, `action`, `first_observed_at`, and
the relevant revision. Codes are stable protocol identifiers, not UI prose.
The evaluator deduplicates identical `(code, subject_kind, subject_id,
revision)` facts but preserves distinct prerequisites sharing a code.

`next_status_change_at` is the earliest authoritative lease/budget expiry,
retry-not-before, scheduled activation, due timer, or review/readback timer
that can change the decision. An overdue badge never extends authority.

Normal upstream waiting is always described as “Queued — waiting for
TASK-A”; dependency-blocked is not a second primary status. A hard hold or
rejected review is an upstream reason and becomes a dependent's hard block
only when an explicit versioned propagation policy says so. Cancellation and
verified/complete outcomes do not satisfy a close-only edge.

## Older clients, protocol, and integrity limits

`boreal.work-status/3` is additive. The exact status/2 mapping is:

| Status/3 or dimension | Status/2 response | Mutation rule |
| --- | --- | --- |
| `scheduled` | `queued` plus `scheduled_start` reason | No claim until the start constraint is satisfied |
| `expired_review` | `blocked` plus `expiry_review_required` and the original expiry reason | No blind reclaim; recovery descriptors remain read-only/authorized |
| `complete` | `complete` plus `closeout_pending` | Never satisfies a default dependency; close intent still required |
| `availability=stale` | Last-known status with `snapshot_stale` diagnostic | Disable mutations until refresh |
| `availability=unavailable` or `incompatible` | Last-known status with `service_unavailable`/`protocol_incompatible` | Disable mutations and expose operation readback |
| `integrity=degraded` | Nearest status plus `integrity_degraded` diagnostic | Allow only actions whose target facts are trusted |
| `integrity=quarantined` | `blocked` plus `integrity_quarantined` | Deny forward progress; allow diagnostics/repair only |

A status/2 client must not treat `scheduled` as `ready`, or
`expired_review` as an ordinary dependency block. Clients that cannot consume
action descriptors fail closed for mutations and may use read-only diagnostics.
TUI and CLI presentation may add color/badges, but plain text and server action
authority remain sufficient.

Corruption is scoped. A malformed parent, clock, profile, gate, dependency,
artifact, or terminal fact quarantines only the affected decision when its
scope is provable; valid siblings remain selectable. A shared project loader
must not abort all rows because one child is damaged. Counts are exact or
marked incomplete; projections and search indexes are rebuildable and never
authoritative.

The current Rust evaluator and TUI have partial foundations, but the TUI must
not remain a second policy engine. PF-S01-T11 owns contract integration and
PF-S02 owns service/store implementation, protocol migration, corruption
fixtures, and real-service conformance. This artifact does not claim those
gates are complete.

## Traceability

This contract consumes D09–D12, D16–D21, D23, D27–D29, the accepted identity,
planning, and execution/submission contracts, and the existing transition
fixture vocabulary. It records the status/3 amendment, preserves v1 `blocked`
as a historical migration input rather than a new semantic meaning, and keeps
all omitted v1 behavior subject to explicit parity disposition. Any change to
precedence, reason codes, status version, or action authority requires a
versioned reviewed decision and conformance fixture update.
