# Dependency, override, reopen, and truth-preservation contract

**Contract:** `boreal.work-dependency/2`
**Status:** proposed PF-S01-T07 artifact; target contract only.

## Dependency authority

The default execution dependency is a project-local directed edge between
direct tasks. Only an accepted `closed` outcome for the exact upstream task,
proof generation, and edge policy satisfies the edge. `verified`, `complete`,
`cancelled`, release, prose, or a container/cycle label does not satisfy it.
Milestone/cycle ordering is a planning relation and cannot silently become a
proof-producing dependency.

Each edge is an immutable, project-scoped record:

```text
edge_id, project_id, predecessor_work_id, successor_work_id,
policy_id/version, created_by, created_at, expected_revision,
state, satisfaction_subject, waiver/exception decisions
```

Creation and edits occur in one serialized transaction. Both endpoints must
exist in the same project, be valid direct tasks, and retain stable identity.
The transaction rejects self-edges and graph cycles before commit. Duplicate
edge operations are idempotent by operation ID and payload digest. A foreign
project, malformed endpoint, stale revision, or incompatible policy is a
typed rejection with no partial edge.

The canonical relation is `closed_only/1`. A versioned edge policy may allow a
narrower alternative only when its declaration, reason, scope, approver,
validity interval, and acceptance impact are durable. It never rewrites the
upstream task or claims that it closed.

## Reopen, supersession, and downstream impact

Reopening closed or cancelled work is an audited operator operation bound to
the target lifecycle revision, reason, scope, and expected project revision.
It creates a new proof generation and preserves the former close/cancel
decision, receipts, reviews, summaries, attempts, and audit rows.

The impact preview is deterministic before commit and includes:

- direct and transitive dependents whose current edge satisfaction references
  the reopened generation;
- active attempts whose handoff consumed the superseded outcome;
- pending close intents, reviews, exceptions, and operation readbacks;
- container/cycle rollups and assignments that need reconciliation; and
- whether a dependent is historically closed, currently open, or not yet
  claimed.

The reopen transaction records this preview digest and invalidates future use
of the old acceptance. New claims cannot consume revoked acceptance. An active
successor is flagged for reconciliation or safely stopped according to policy;
already-closed successors remain historical facts unless an authorized,
separate reopen targets them. Boreal never recursively rewrites downstream
history or silently turns a historical success into current failure.

Source, profile, dependency-policy, or requirement changes have the same
proof-relevant invalidation effect. A dependent guidance snapshot is stale and
must be refreshed; it is not a hidden authorization token.

## Overrides and waivers

An override adds a canonical decision; it does not change a receipt,
dependency edge, work identity, status label, or attempt fence. Every override
contains:

```text
operation_id + request_digest + project_id + target_id + target_revision
authenticated_principal + durable_role + stable_reason + nonempty_comment
scope + validity_interval + supporting_evidence + gate_id + proof_generation
profile_id/version/digest + requirement_or_edge_revision + audit_event
```

Before any override, waiver, hold resolution, expiry disposition, or review
correction commits, the service computes and returns a deterministic impact
preview bound to the target revision. The preview includes affected direct
and transitive dependents, current/active attempts and resources, sealed
submissions and close intents, pending operations/readbacks, container/cycle
rollups, proof/review decisions, and whether an already closed result is
historical or requires an explicit separate reopen. The preview digest is
stored in the decision; a changed preview requires refreshed confirmation.
An override is rejected if the preview cannot establish safe scope.

| Decision | Scope | Required effect |
| --- | --- | --- |
| Gate exception | One declared gate on one proof generation | Keep failed/missing observation visible; append `accepted_by_exception` with operator and reason. |
| Dependency waiver | One edge revision and bounded target scope | Keep the unmet edge/upstream task visible; satisfy only that edge for that scope. |
| Hold resolution | One named hold | Append resolution; do not erase the original hold or its evidence. |
| Expiry disposition | One recovery obligation/attempt | Confirm stop/resource state, then choose retry, pause, block, cancel, or replan. |
| Review correction/revocation | One submission/review decision | Preserve prior decision; invalidate future use and trigger impact evaluation. |

Stable reasons are `risk_accepted`, `external_evidence`,
`superseded_work`, `duplicate_work`, and `migration_disposition`. A boolean
`force`, caller-supplied role, prose explanation, or lower-level CLI path never
authorizes an override. Exceptions expire/revoke through append-only
decisions. A forced gate must read back as both failed verification and a
scoped exception; it cannot fabricate a passing receipt.

Expiry and revocation distinguish future use from historical truth. A newly
expired or revoked exception/waiver is excluded from new claims, new reviews,
new close intents, and finalization after its effective revision. Current
attempts and open close intents are re-evaluated in their next committing
transaction and become blocked/superseded when the decision was required.
Already committed closeouts, reviews, and downstream historical closes retain
their original decision and audit identity; they are not silently deleted or
rewritten. If policy requires their current validity to change, the service
creates an impact obligation and an explicit authorized reopen/reconciliation
operation for each affected target.

## Cancellation, replacement, and corruption

Cancellation distinguishes request-to-stop from confirmed withdrawal. It
requires an active-execution/resource disposition and a dependency impact
preview. A cancelled prerequisite remains unsatisfied; dependents wait for a
replacement or an explicit edge-scoped waiver. Deferral/replacement is a
durable disposition with predecessor/successor identity and does not delete
the original task.

Overrides must be rejected when they target a foreign project, malformed or
quarantined identity, missing requirement, stale fence, unreadable revision,
or corrupted endpoint. An operator can classify corruption or authorize a
repair plan, but cannot make an unreadable fact trustworthy by assertion.
Repair appends findings/corrections and preserves raw data.

## Protocol and implementation boundary

Responses include edge identity, satisfaction policy, upstream status/reason,
proof generation, impact preview, allowed/denied actions, expected revisions,
and exception/waiver readback. Older clients that cannot preserve edge scope
fail closed for dependency-affecting writes. The TUI may present “Queued —
waiting for TASK-A” and “Waived for this edge” but cannot derive or invent
satisfaction.

The Rust domain/application/store own graph checks, decisions, transactions,
and audit. External stop/process/Git work runs through durable operations. The
current source has partial dependency and override scaffolding; PF-S02 owns
transactional implementation and real-service races. This artifact does not
claim that those behaviors already pass.

## Conformance and traceability

Required vectors cover cross-project/self/cycle edges, duplicate/idempotent
edge writes, close versus claim race, reopen before/after successor claim,
reopen of a historical successor, source/profile invalidation, waiver scope
leakage, exception expiry/revocation, stale fence, corrupted endpoint,
cancellation and replacement, unknown operation readback, and exact dependent
rollups. Evidence must identify the actual source, database revision, operation
IDs, raw failed proof, and audit/readback.

This contract consumes D04, D07, D09–D12, D16, D18–D23, D27–D29 and the
accepted planning, status, profile, and execution contracts. Any change to
edge satisfaction, reopen impact, exception scope, or corruption handling
requires a reviewed versioned decision and new fixtures.
