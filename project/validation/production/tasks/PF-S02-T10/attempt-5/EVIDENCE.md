# PF-S02-T10 attempt 5 evidence

## 1. Terminal mutations create durable recovery obligations atomically

**Observed: PASS for the bounded slice.**

`SqliteStore::apply_attempt_mutation` opens `BEGIN IMMEDIATE`, rechecks the
attempt subject, fence, phase, deadlines, and ownership, applies the terminal
attempt update, then calls
`create_recovery_obligation_in_transaction` before bumping the project
revision and appending the operation/audit bundle. Commit and rollback are
owned by the same method. A failure to insert the obligation, revision, or
operation/audit bundle rolls back the attempt and legacy reservation update.

The terminal mapping currently covers `Fail`, `Expire`, `Release`, and
`Cancel`. The store contract tests exercise failed, expired, and cancelled
attempts and confirm that the current pointer is cleared while the unresolved
obligation remains readable. The release path is covered by source inspection
and the full store suite, but does not yet have an equally explicit assertion
for its recovery row.

Relevant locations:

- `crates/store/src/lib.rs:4320-4387`
- `crates/store/src/lib.rs:9443-9480`
- `crates/store/src/recovery.rs:269-325`
- `crates/store/tests/store_contracts.rs:697-751`
- `crates/store/tests/store_contracts.rs:848-970`

## 2. Unresolved recovery blocks claim and candidate listing

**Observed: PASS for the bounded slice.**

The canonical claim transaction checks `has_unresolved_recovery` after taking
the write lock and returns a typed conflict before inserting a replacement
attempt. Candidate listing also excludes any work with an unresolved recovery
obligation. The expiry test confirms that both replacement claim and candidate
listing are blocked until explicit resolution.

Relevant locations:

- `crates/store/src/lib.rs:2524-2577`
- `crates/store/src/lib.rs:2580-2594`
- `crates/store/src/lib.rs:3699-3707`
- `crates/store/tests/store_contracts.rs:887-925`

This is a store-level gate. It is not yet proof that every application/service
candidate path uses this query or that every non-task/container readiness path
propagates recovery correctly.

## 3. Explicit resolution permits replacement

**Observed: PASS for the bounded slice, incomplete as a canonical mutation.**

`resolve_recovery_obligation` appends a decision, marks the obligation
resolved, and the expiry contract test then successfully claims the next
attempt with the next monotonic fence. Duplicate resolution is rejected.

However, resolution currently accepts only project, obligation, actor, outcome,
reason, resource state, and timestamp. It does not take an operation ID,
expected project/entity/fence revision, authenticated actor context, or a
canonical operation/audit bundle, and it does not bump the project revision.
That means the resolution itself is not yet equivalent to the other
consequential lifecycle mutations for idempotent readback, authorization, or
revision-consistent UI refresh.

Relevant locations:

- `crates/store/src/recovery.rs:373-434`
- `crates/store/tests/store_contracts.rs:911-925`

## 4. Operation, audit, and revision atomicity

**Observed: PASS for terminal attempt mutation; NOT COMPLETE for the whole
recovery lifecycle.**

Terminal attempt mutation bumps the revision and appends the operation/audit
bundle before the outer commit. Identity-bound operation journal validation
also checks audit actor, session, fence, project, and revision agreement. The
full operation/audit and store contract suites pass, including rollback and
replay cases.

The remaining limitation is scope: recovery resolution is a separate
transaction containing only recovery decision/obligation rows, and many other
canonical writers still call `append_operation` and `append_audit_event`
directly rather than the identity-bound bundle seam. The current source scan
shows direct writers in `lib.rs`, `knowledge.rs`, `work_model_v3.rs`, and CLI
paths. The coordinator's earlier review also identified the remaining legacy
operation writers; the present implementation does not close that gap.

Relevant locations:

- `crates/store/src/lib.rs:4342-4387`
- `crates/store/src/operations.rs:168-209`
- `crates/store/src/recovery.rs:387-433`
- direct writer families in `crates/store/src/lib.rs`,
  `crates/store/src/knowledge.rs`, `crates/store/src/work_model_v3.rs`,
  `crates/cli/src/main.rs`, and `crates/cli/src/service.rs`

## 5. Retry/replay and compatibility

**Observed: PASS with residual identity risk.**

The store tests confirm exact claim replay, lifecycle mutation replay,
operation/audit replay, migration reopen behavior, and in-memory compatibility.
Production open installs/verifies the additive tables, while the in-memory
identity row remains intentionally controllable for fixtures.

The attempt replay helper primarily binds replay to project, operation ID,
request digest, and attempt subject. It does not independently compare every
caller identity field (actor, session, harness, and fence) before returning an
existing result; it relies on the digest and prior operation row. The stronger
identity-bound journal has those fields, but the attempt replay path is not yet
fully routed through it. This should be closed before treating replay as a
complete authenticated mutation boundary.

The candidate query assumes the production additive recovery table exists.
That is safe for canonical production and legacy-v2 opens because the
production migration/open path installs and verifies it. Noncanonical test
schemas must explicitly install the recovery seam; that compatibility boundary
should remain documented rather than becoming an implicit lazy production
migration.

## 6. Broader PF-S02-T10 blockers still open

This attempt does not accept PF-S02-T10 because the following criteria remain
unmet:

1. All canonical lifecycle and planning writers must use one identity-bound,
   operation/audit/revision transaction boundary; direct legacy writers remain.
2. Recovery resolution needs authenticated actor/session context, operation
   identity, expected revisions/fence, audit/readback, and a project revision.
3. External-job registration and transitions are store seams but are not yet
   wired through the canonical verifier, update, backup, stop, and memory
   application adapters as one recoverable workflow.
4. Project identity/workspace binding is not wired through the application or
   CLI initialization/dashboard paths; `IdentityStore::bind_project` has no
   production caller in those layers.
5. Attempt replay should enforce the complete immutable caller identity, not
   only project/request digest/subject.

## Verdict

**Attempt 5: REJECTED / UNACCEPTED for PF-S02-T10.** The recovery slice is a
valid bounded implementation with passing store evidence, but it cannot be
accepted as the complete task while the above canonical integration gaps
remain.
