# PF-S02-T10 attempt 9 — bounded recovery-resolution review evidence

## Decision

**ACCEPTED AS A BOUNDED CONTRIBUTION.**

The reviewed store seam independently demonstrates the requested identity,
revision, fence, transaction, replay/readback, subject, and history
properties. This is not acceptance of PF-S02-T10 or PF-S02-T06 as whole tasks.

## Exact implementation reviewed

`SqliteStore::resolve_recovery_obligation_with_identity` in
`crates/store/src/recovery.rs:472-618`:

1. Validates non-empty operation and resolution fields, validates the installed
   `IdentityContext`, and rejects a resolution project different from the
   context project before mutation (`:476-485`).
2. Enters the store's `BEGIN IMMEDIATE` transaction boundary before rereading
   the obligation and its attempt/fence (`:487-497`).
3. Checks the expected project snapshot revision before bumping it
   (`:526-528`).
4. Inserts the append-only recovery decision, resolves exactly one unresolved
   obligation, and rejects a concurrent/state-changing update when the update
   count is not one (`:530-563`).
5. Appends the operation and audit bundle through the identity-bound journal
   while still inside the same transaction (`:565-597`). The transaction helper
   rolls back all prior writes when any later operation or audit write fails.
6. Reads back the committed obligation and operation from the same identity
   context (`:599-617`).

`validate_recovery_attempt_fence` in `recovery.rs:941-974` rereads the
referenced attempt, rejects a foreign project/work pairing as `WrongSubject`,
and rejects a changed persisted fence as `StaleFence`. The identity-bound
operation journal additionally revalidates database/project identity and the
operation/audit identity before writing (`crates/store/src/operations.rs:210-240`).

## Required behavior review

### Identity and project binding

The focused fixture installs a database identity and a workspace binding before
calling the new seam. The method validates that context before opening its
mutation transaction and the identity-bound journal validates it again inside
the transaction. The explicit context-project versus resolution-project check
prevents a foreign project from being addressed. Related full-store identity
tests also passed for foreign subjects, wrong project/epoch, and composite
identity pairing.

### Expected revision and attempt fence

`identity_bound_recovery_resolution_rejects_stale_revision_and_fence` passed.
The stale revision path left the project revision unchanged and left the
obligation unresolved. After the persisted fence was changed to `2` while the
attempt still held fence `1`, the operation returned `StaleFence` and no
operation row was created.

### Transactional decision, obligation, operation, and audit

The code performs all four writes under one caller-owned `BEGIN IMMEDIATE`
transaction and commits only after the identity-bound operation/audit append
and readback succeed. The success test observed one resolved obligation, one
decision, one operation revision advance, and one audit event. The store's
operation/audit rollback and identity-bound transaction tests also passed in the
full `boreal-store` run. No partial-success path was observed.

### Idempotent replay and readback

`identity_bound_recovery_resolution_is_revisioned_audited_and_idempotent`
passed. An exact retry returned `replayed = true`, returned the original
obligation and operation readback, left the project revision unchanged, and
left exactly one recovery decision and one audit event. Changed immutable
operation context is rejected by the shared operation journal semantics.

### Wrong-subject and stale-input rejection

The source review confirms rejection of:

- a resolution whose project differs from the installed identity context;
- an obligation whose referenced attempt belongs to another project/work item;
- a persisted attempt fence that no longer matches the obligation fence;
- a stale project snapshot revision; and
- an operation/audit bundle whose project, actor, session, fence, revision, or
  subject identity conflicts.

The focused recovery suite directly exercised stale revision and fence
rejection. The full store suite exercised the shared foreign-subject,
wrong-project, operation-reuse, and identity-pairing rejection paths. The
application still owns authenticated actor/session construction and canonical
request-digest creation; those are explicitly outside this bounded store
review.

### Preservation of unresolved history

The recovery suite passed the case where the current attempt pointer is cleared
while the unresolved recovery obligation remains queryable. It also passed
append-only recovery decision history, bounded unresolved-obligation queries,
and replay behavior. Existing terminal-attempt and failed-history tests in the
full store suite passed as well.

## Residual boundary

This bounded acceptance does not establish:

- application/service authentication or call-site integration;
- registration of the recovery schema in every production opener or migration;
- external process/resource reconciliation or late-worker handling;
- complete lifecycle enforcement, close-intent integration, or expiry sweeping;
- all root operation/audit writers;
- genuine service-backed lifecycle validation;
- PF-S02-T06, PF-S02-T10, or any sprint/release gate acceptance; or
- workspace-wide clippy cleanliness, because the existing profiles lint remains.

