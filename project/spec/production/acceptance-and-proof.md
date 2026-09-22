# Acceptance profiles, proof selection, and independent review contract

**Contract:** `boreal.acceptance/2`
**Status:** proposed PF-S01-T06 artifact; it defines the target contract and
does not claim that current store projections are complete.

## Requirements, observations, and decisions are separate

An acceptance profile is a published, immutable definition. A work item pins a
profile version and a resolved requirement set at its proof-relevant revision.
Changing a project default never changes an existing task silently.

| Record | Meaning | Can deletion change the requirement? |
| --- | --- | --- |
| Requirement declaration | Gate kind, identity, version, required/optional flag, verifier policy, required observables, subject rules, and review/audit policy for this work revision | No; immutable and pinned |
| Observation | A verifier/checkpoint/receipt execution against a declared subject, source, configuration, and policy | No; it only removes or adds evidence for evaluation |
| Decision | An authorized review, operator exception, dependency waiver, closeout, supersession, or revocation | No; decisions are append-only and scoped |

Deleting, corrupting, or failing to load an observation never deletes a
requirement. If the pinned profile or requirement definition is missing or
contradictory, the work is `quarantined`/`blocked` with a repair reason; it is
not treated as a zero-gate profile and cannot become `complete` or `closed`.

## Immutable profile and requirement resolution

Profiles are content-addressed by canonical JSON plus a version. The registry
stores the profile ID, semantic version, content digest, author/publisher,
published-at, and supersession link. A profile contains ordered gate
definitions, but gate order is presentation; decision precedence is the
status contract.

On work creation/publish, the application resolves the selected profile into
an immutable requirement set with:

```text
project_id, work_id, proof_revision, profile_id, profile_version,
profile_digest, requirement_id, gate_kind, required, verifier_policy,
subject_rules, observable_rules, review_policy, exception_policy
```

The resolved digest is included in submissions, receipts, reviews, close
intents, and final summaries. A parent/default profile update affects only new
work. An explicit authorized reprofile creates a new proof generation and
invalidates prior close intent/review for future use while preserving all old
facts.

Supported gate kinds are `verification`, `checkpoint`, `review`, `audit`, and
`summary`. A review gate is required only when declared in the pinned profile;
absence of a review gate does not fabricate one, and the presence of a review
gate cannot be bypassed by an operator flag.

## Structured observations and relevant-proof selection

An observation is eligible only when all of these match the current
requirement before recency is considered:

```text
project_id + work_id + proof_revision + attempt_id/fence (when required)
gate_id + gate_kind + profile_id/version/digest
source_snapshot + configuration_identity + subject/coverage
verifier identity/attestation + command/argv/cwd + exit/result
required observables + artifact/output digest + operation identity
```

The canonical selector is shared by application, store, service, CLI, and TUI:

1. Load the pinned requirement declaration and reject missing/contradictory
   definitions.
2. Filter observations by exact project/work/proof subject, gate, profile,
   source, configuration, and attempt/submission scope.
3. Exclude explicitly superseded, revoked, rejected, late, foreign, or
   integrity-invalid observations while retaining them for history.
4. Verify command, attestation, exit/result, required observables, artifact
   identity, and digest against the requirement.
5. Apply the deterministic authority/result ordering: valid accepted proof,
   valid failed proof, missing proof, stale proof, or quarantined evidence.
6. Choose the newest valid observation by authoritative `observed_at`, then
   stable observation ID/digest tie-breaker. A newer unrelated receipt cannot
   shadow a valid current-subject receipt.

A receipt whose JSON says `passed` but lacks the required attestation, subject,
source, command, observable, or artifact identity is a retained rejected fact,
not a passing proof. A missing historical attachment does not undo an already
committed immutable acceptance decision; it adds a diagnostic unless the
acceptance identity itself cannot be established.

## Review policy and outcomes

Review is a decision over one sealed submission, not an observation that can be
reconstructed from a boolean. The reviewer is independent under authenticated
principal/delegation identity, not merely a different session string.

| Review outcome | Durable meaning | Derived impact |
| --- | --- | --- |
| `pending` | Required review is unresolved for the exact submission | `awaiting_review` |
| `approved` | Reviewer accepted the exact proof context and submission | May contribute to `complete`/closeout |
| `rejected` | Reviewer found a defect or failed acceptance condition | Hard reconciliation/intervention obligation; never `proof_missing` |
| `returned` | Reviewer requests bounded rework while preserving the submission | Rework path; prior submission remains historical |
| `revoked` | Authorized correction invalidates future use of a prior review | New proof generation/impact evaluation required |

A rejected review remains distinguishable across persistence, projection,
readback, status, CLI, and TUI. Store projections must not reduce it to
accepted/not-accepted and then report `current_proof_missing`. A return or
rejection must retain reviewer, reason, exact submission, policy/profile,
subject, revision, and operation identity.

Reviewer roles and delegation are checked transactionally. An attempt actor
cannot review their own work; a delegated reviewer must have explicit scope,
validity, and audit identity. Operators may perform a bounded review only when
the profile permits it and the exception is visible. Agents cannot review,
force-approve, or change a profile by selecting a CLI spelling.

## Overrides and exceptions

An exception is an additional canonical decision, never a fabricated passing
observation. It contains authenticated actor, role, stable reason code,
nonempty comment, exact project/work/gate/edge/submission target, target
revision, profile/requirement digest, scope, expiry where relevant, supporting
evidence, operation ID, and audit event.

For a forced gate, readback must show both facts:

```text
verification_failed(gate-X, receipt-R)
acceptance_exception(EX-17, operator-O, reason=risk_accepted)
```

For a dependency waiver, the edge and unmet prerequisite remain visible:

```text
TASK-A remains unclosed; edge TASK-A -> TASK-B waived for scope S by EX-18
```

Exceptions can satisfy only their declared gate/edge and proof generation.
Expiry, revocation, reopen, source change, profile change, or dependency
impact triggers re-evaluation; no exception resurrects a stale fence or makes
a foreign project local. Reversing an accepted outcome is a separate audited
operation and never deletes historical approval.

## Closeout binding and invalidation

`finish --close` creates a close intent bound to the pinned requirement digest,
submission, attempt/fence, source/configuration snapshot, proof revision, and
summary. It may auto-finalize only when all required observations and review
decisions satisfy those exact bindings. A source/config/profile/dependency
change, reopen, attempt replacement, review revocation, or requirement
supersession marks the intent stale and preserves its old facts.

`complete` means all required proof/review is satisfied for the current result;
`closed` additionally requires the authorized close intent and final summary.
No profile can turn prose into proof or make a failed receipt pass without an
explicit scoped exception.

## Protocol, migration, and corruption boundaries

Protocol responses expose profile ID/version/digest, pinned requirements,
observation selection diagnostics, review outcome, exceptions, and action
descriptors additively. Clients without the acceptance capability fail closed
for proof-affecting writes and may read historical facts. Store migration must
backfill immutable requirement declarations from the best available source;
when the source is missing or ambiguous, it records a migration finding and
does not infer success. Historical v1 `verified`, `done`, or `complete` is
retained as provenance and is not automatically v2 accepted `closed`.

Corrupt gate/profile/receipt/review/artifact references are quarantined at the
smallest safely identified scope. Valid sibling work remains readable and
selectable. A project-wide eager loader must not abort all work because one
gate row is malformed. Counts/report totals are exact or marked incomplete;
derived projections and indexes may be rebuilt from canonical records.

The baseline gaps are explicit: current work creation does not independently
persist all required profile definitions, review projection can collapse
rejection into missing proof, and application/store evidence selectors differ
in their ordering. PF-S01-T11 integrates this contract; PF-S02 owns schema,
selection, review, migration, corruption, and genuine-service acceptance.

## Conformance vectors and traceability

Acceptance must cover deleted requirement versus deleted observation, newer
unrelated receipt, stale source/config/profile, wrong subject/gate,
failed/late/foreign receipt, malformed artifact, rejected/returned/approved
review, self-review, exception expiry/revocation, close-intent invalidation,
operation timeout/readback, reopen, dependency waiver, and corrupt sibling
rollups. Evidence must identify the exact source, service, binary, profile,
receipt, review, operation, and database revision; fixture-only tests do not
establish lifecycle acceptance.

This contract consumes D07, D09–D12, D16, D18–D23, D27–D29 and the accepted
identity/execution contracts. D23 and D28 are made explicit: profiles are
versioned per work, and independent review is conditional on a declared review
gate. Any change to profile semantics, relevant-proof selection, review
independence, exception scope, or close binding requires a versioned decision
and updated conformance fixtures.
