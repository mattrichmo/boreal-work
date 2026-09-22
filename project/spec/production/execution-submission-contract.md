# Execution, sealed submission, and safe ownership-release contract

**Contract status:** proposed PF-S01-T04 artifact; independently reviewable,
but not an implementation or release claim.

## Scope and policy decision

Boreal separates execution ownership from the validity of a submitted result.
An attempt lease answers **who may currently execute and write**. A sealed
submission answers **what result was proposed, for which proof context, and
whether review/closeout may continue after execution ownership ends**. A
reviewer does not renew a worker lease, and a submission is never a reason to
keep an executor's reservation alive.

This contract retains the approved D20/D21/D22/D27 policy:

- `--ttl` remains the v1-compatible alias for the renewable ownership lease;
  v2 exposes the typed `--lease-ttl` spelling.
- `--time-limit` is a distinct hard execution budget. A claim without it uses
  the D27 two-hour default measured from authoritative `claimed_at`.
- Heartbeats may renew only the lease, never the hard budget. At or after
  either applicable deadline, a mutation is expired even if a sweeper has not
  persisted an expiry row.
- Expiry derives `expired_review`, fences the old attempt, retains evidence and
  creates a durable recovery obligation. It never closes work or blindly
  redispatches a possibly running process.
- `agent finish --close` remains the normal proof-gated path. A durable close
  intent can finalize when the final valid receipt/review matches the same
  attempt, fence, source/configuration snapshot, profile version, and policy
  revision. Passing prose, a passive test, or a forged receipt cannot close.

The recommended sealed-submission separation is adopted as the target contract
and must be implemented behind a versioned migration. Human review consumes
neither the worker's hard budget nor its execution reservation after a safe
submission seal. The owner decision and migration impact are explicit here so
implementation cannot accidentally change D22/D27 by reusing `current_attempt`
for both execution and review waiting.

## Canonical records and clocks

| Record | Authority | Required fields / invariant |
| --- | --- | --- |
| Attempt | Execution ownership | `project_id`, `work_id`, `attempt_id`, authenticated principal, session/harness, monotonic fence, `claimed_at`, lease deadline, hard budget deadline, source/config snapshot, current state, and recovery disposition. One current attempt per work and one current execution per session. |
| Lease | Renewable ownership | Authorizes heartbeat and execution mutations until its deadline. Renewal checks the current fence and cannot extend `hard_deadline`. |
| Hard budget | Bounded execution | `hard_deadline = claimed_at + explicit time limit`, or two hours when absent. It is authoritative on every relevant read and mutation; it cannot be renewed. |
| Submission | Immutable proposed outcome | Submission ID, attempt/fence, proof-relevant work revision, source snapshot, configuration identity, profile/version digest, summary digest, receipt/review references, created-at, and supersession link. A submission is not an accepted close. |
| Close intent | Durable request to close | Operation ID, exact work/attempt/fence/submission context, requested actor, summary digest, expected revisions, policy/profile digest, and state `open`, `finalized`, `rejected`, `superseded`, or `expired`. |
| Recovery obligation | Safe disposition | Attempt/submission identity, reason (`expired`, `stop_unknown`, `resource_unknown`, `failed`, or `cancel_requested`), physical-stop/resource status, owner, next action, and resolved-at decision. It survives loss of `current_attempt`. |

The lease, hard budget, and submission validity interval are distinct. A
heartbeat updates liveness only. A submission remains reviewable after lease
release, but becomes stale if its proof-relevant revision, source, policy,
profile, or attempt generation changes. A reviewer may approve or reject the
sealed submission without acquiring the executor's fence.

## Lifecycle and safe release

The supported path is:

```text
eligible -> claimed -> accepted -> running -> verifying -> submitted
                                                     |         |
                                                     |         +-> awaiting_review -> closeout
                                                     +-> released/failed/retry/expiry recovery
```

1. **Claim:** inside one transaction, authenticate the principal, re-read
   dependencies/holds/profile/source, enforce one-current-attempt/resource
   uniqueness, create the attempt and reservation, and record lease and hard
   deadlines. Return the fence and exact context.
2. **Accept/start:** bind the authenticated session/harness to the attempt;
   every mutation checks the current fence, lease, hard budget, and proof
   context. A stale guide cannot authorize a write.
3. **Checkpoint/evidence:** append structured checkpoints and receipts. A
   receipt records executable/argv, cwd, exit result, timestamps, source and
   configuration fingerprints, output digest/reference, subject/coverage, and
   attestation. Failed or late evidence is retained and cannot be rewritten
   as a pass.
4. **Submit/finish:** validate required proof, seal an immutable submission,
   register the close intent if `--close` was requested, and safely release
   execution ownership. Release occurs only after the runtime/resource state
   is recorded as stopped, adopted, or explicitly unknown with a recovery
   obligation. It does not assert acceptance.
5. **Review/finalize:** an authorized independent reviewer acts on the exact
   submission context. Approval is a durable decision, not a receipt. The
   final close transaction re-reads gates, review, holds, dependency impact,
   profile/policy revision, and close intent, then records accepted closeout
   and downstream effects atomically. Rejection remains intervention and
   creates reconciliation/rework guidance; it is not “missing proof.”

The safe release operation is idempotent and fenced. It records whether the
process stopped and whether reserved resources are safe to reuse. If either is
unknown, the task remains `expired_review`, `blocked`, or recovery-pending as
appropriate; a new attempt cannot use a shared worktree/resource until a
reviewed isolation decision resolves it. A database fence protects database
writes but does not physically stop a process editing files.

## Expiry, retry, cancellation, and adoption

At or after a lease or hard deadline, reads and mutations treat the attempt as
expired. The old fence is denied even if the process is still alive. The
system records `review_required_after_expiry`, preserves all checkpoints and
receipts, requests a stop, and retains an unresolved recovery obligation until
the runtime/resource disposition is known.

Expiry recovery is explicit:

- **safe stopped:** release the reservation, mark the obligation resolved, and
  allow a new isolated claim only after policy/dependency re-evaluation;
- **stop unknown:** keep the obligation and resource hold, or require an
  authorized operator isolation decision before replacement;
- **adopted:** an authorized operator may bind a manually running process to a
  new authenticated session/attempt only through an auditable adoption
  operation naming the process/resource identity, source snapshot, reason,
  and expected fence. Adoption does not import a passing receipt;
- **retry:** opt-in, bounded, isolated, and backoff-controlled. A retry is a
  new attempt with a new fence and preserved predecessor, never a resurrection
  of the expired writer;
- **failed/nonrecoverable:** retain failed evidence and require an operator
  disposition, replacement, cancellation, or explicit waiver. It does not
  satisfy a dependency.

Cancellation has two facts: a request to stop and a confirmed withdrawal. The
request records authority, reason, target revision, and operation ID. The
terminal cancellation is committed only after execution/resource disposition
is safe or an authorized unresolved recovery obligation is recorded. Release
or fail ends ownership without asserting task success. Reopen creates a new
proof generation and invalidates old close intent/approval for future use.

## Proof and close-intent validity

Every submission, receipt, review, and close intent is bound to:

```text
project_id + work_id + proof_relevant_revision + attempt_id + fence
source_snapshot + configuration_identity + acceptance_profile/version
```

The store/application must reject a late or foreign object. A changed source,
configuration, profile/gate declaration, dependency/hold impact, or reopened
work item supersedes the submission and leaves the old fact historical. A
review decision for one submission cannot authorize another submission, even
when the task ID is the same. Repeating the same operation ID and payload is
idempotent; changing its payload is a conflict.

Close intent states are deterministic:

| State | Meaning |
| --- | --- |
| `open` | Same-subject final proof/review may still complete the intent. |
| `finalized` | Accepted closeout committed exactly once. |
| `rejected` | Authority, revision, proof, policy, or review denied the request; gaps are structured. |
| `superseded` | Source, profile, attempt, reopen, or another proof-relevant change invalidated it; old evidence remains. |
| `expired` | Its readback/validity window ended without a valid finalization; a new bounded operation is required. |

Finalization never deletes failed evidence, rejected review, predecessor
attempts, or recovery obligations. A valid accepted close is the only default
dependency-satisfying outcome; `complete`, `verified`, `cancelled`, and
`released` remain distinct.

## External work and unknown outcomes

Evidence execution, process termination, Git operations, and publication run
outside the SQLite commit transaction. Before external work begins, the
application registers an operation/job with a canonical request digest. After
external work, it records the result and receipt through the same attempt and
proof binding. A timeout is `unknown`/pending readback, never an invented
failure or success. Reusing the operation ID with different input is a
conflict.

Manually performed work is an auditable adoption, not a shortcut: it must
declare the authenticated principal/session, process/resource identity, source
and configuration snapshot, start/stop evidence, and structured verifier
receipt. Unwitnessed prose can explain a recovery decision but cannot satisfy a
witnessed gate.

## Roles, revisions, and migration impact

Agents can execute their own current attempt and submit proof. Reviewers need
independent authenticated authority and act only on a sealed submission.
Operators can request stop, reconcile resources, resolve expiry, cancel, or
approve a narrowly scoped exception with reason and audit. Publishers cannot
change live execution status. No role can use a lower-level CLI spelling to
bypass the application decision.

Implementation must add or migrate durable submission, close-intent,
recovery-obligation, and external-job fields/tables without deleting current
attempt/history facts. Migration must preserve predecessor attempt IDs,
receipts, reviews, reservations, source/config identities, and operation
digests; a schema/restore epoch prevents an old binary from opening an
incompatible database. Protocol additions must advertise the capability and
return action/recovery descriptors additively. Until the capability and
migration are present, public sealed-submission writes fail closed rather than
flattening a submission into a task status.

## Conformance vectors and baseline limits

The implementation gate must cover crash between claim/accept, duplicate
finish, exact deadline at and after the boundary, heartbeat after hard-budget
expiry, restart with an unresolved process, safe stop before replacement,
shared-resource isolation, close-intent invalidation after source/policy
change, rejected review, approval/close race, adoption, unknown operation
readback, retry fencing, cancellation, reopen, and preservation of failed
evidence. The exact source, binary, service, and runtime must be recorded;
fixture-only results do not establish lifecycle acceptance.

The supplied v2 source currently has attempt/lease/close-intent scaffolding,
but the baseline expiry path can clear `current` and release a reservation
without an independent unresolved recovery obligation. The application also
has evidence-store interfaces that must be reconciled with this sealed
submission boundary. PF-S01-T11 owns contract integration; PF-S02 owns schema
and lifecycle implementation gates. This document is a target contract, not a
claim that those gaps are fixed.

## Decision traceability

This artifact consumes D03–D07, D09–D12, D16–D18, D20–D23, D27, and the
accepted PF-S01 identity/planning contracts. It explicitly records the D22/D27
policy impact and adopts the lease/submission separation as a versioned
implementation decision rather than silently overriding either decision.
Changes to deadline semantics, submission validity, role authority, recovery
obligation, or close-intent finalization require a reviewed decision and new
conformance fixtures. D24 publication and D25 parity remain separate concerns:
publishing or a legacy command alias cannot mutate live execution or satisfy a
gate.
