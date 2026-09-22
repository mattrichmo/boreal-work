# PF-S02-T10 attempt 11 — review evidence

## 1. What the root now wires

### Production schema and migration boundary

`SqliteStore::open` routes the canonical production schema through
`ensure_production_schema` (`crates/store/src/lib.rs:1239-1255, 1479-1508`).
The current flow verifies or repairs migration metadata, takes the production
migration lock for legacy v2 repair, runs the ordered migration runner, and
then verifies the additive identity, revision, recovery, resource, external
job, and pinned-requirement tables/indexes/triggers
(`crates/store/src/lib.rs:1344-1381, 1389-1477, 1516-1674`).

The migration tests prove fresh open, v2 upgrade, pre-runner v3 repair,
reopen idempotence, rollback on failure, live-attempt blocking, lock
exclusion, checksum rejection, and unsupported-schema rejection. This is
strong bounded evidence for schema registration and fail-closed migration
behavior.

### Pinned requirements

`create_work_in_transaction` resolves and persists a separate pinned
requirement declaration before writing observed `gate` rows
(`crates/store/src/lib.rs:2523-2596`). The status/close gate diagnostic query
uses the latest pinned requirement and only falls back to the legacy gate
projection when no pinned requirement exists
(`crates/store/src/lib.rs:7266-7304`). The nine profile tests prove profile
content-digest checking, immutable versions, empty-legacy handling in the
profile seam, observation deletion without requirement deletion, and root
work creation whose pinned requirements survive gate deletion.

### Recovery

The root lifecycle paths create durable unresolved recovery obligations before
terminal attempt mutations complete, and candidate/claim paths check for an
unresolved obligation (`crates/store/src/lib.rs:2619-2675` and the terminal
mutation paths around `4350-4525`). The identity-bound recovery method in
`recovery.rs` rechecks project identity, expected revision, attempt/fence
identity, appends a decision, resolves one obligation, and appends the
operation/audit bundle inside the same caller-owned transaction
(`crates/store/src/recovery.rs:472-618, 886-1035`). The focused recovery tests
prove stale revision/fence rejection, unresolved retention after current
attempt clearing, atomic audited resolution, and exact replay.

### Operation/audit conversion

The root's 17 paired store writes are routed through
`append_operation_audit_in_transaction` (16 in `lib.rs`, one in
`work_model_v3.rs`). For a bound project this calls the identity-bound
`OperationJournal`; the journal validates project/actor/session/fence/revision
identity, redacts payloads, records database lineage, and keeps operation,
semantic mutation, identity, and audit writes in the caller's rollback
boundary (`crates/store/src/lib.rs:5354-5377` and
`crates/store/src/operations.rs:210-241`). The operation/audit suite proves
changed-context rejection, exact replay, pending/unknown distinction,
redaction bounds, identity mismatch rejection, and rollback on audit failure.

## 2. Residual findings

### P1 — production root still has an identity fail-open fallback

`append_operation` and `append_audit_event` only apply database-lineage checks
when the project already has a project-identity binding
(`crates/store/src/lib.rs:5301-5351, 5480-5538`). The shared helper likewise
falls back to the compatibility pair when the identity tables are present but
the project is not bound (`crates/store/src/lib.rs:5363-5377`). That is safe
for explicitly legacy/test schemas, but the current condition does not
distinguish such a schema from an unbound production project. A production
caller can therefore reach a legacy append path before project binding is
established.

`initialize_project` creates the project and writes its changed operation
before any separate workspace-binding step; its existing-project replay branch
also writes an operation without an audit event
(`crates/store/src/lib.rs:1905-1932`). This is a concrete remaining legacy
operation/audit path, not merely a hypothetical API concern.

**Remediation:** make canonical production open/install require a project
identity before consequential writes, or make the helper return a typed
identity error whenever the additive identity tables exist and the project is
unbound. Put project creation and binding in one authenticated, replayable
boundary. Convert the unchanged initialization branch to the same canonical
operation/audit contract, or explicitly classify it as a non-consequential
readback with a documented audit policy.

### P1 — operation/audit coverage is not universal

The source scan still finds direct operation-only writes in
`crates/store/src/knowledge.rs:140` (`source.register`) and the existing
initialization replay branch. The public compatibility methods and
`OperationJournal::append_in_transaction` also intentionally retain the
non-identity path. The reviewed root conversion is therefore a bounded
improvement, not proof that every canonical writer is identity-bound and
audited. The operation-only knowledge path should not receive a fabricated
audit event; it needs an explicit source-registration event contract or a
documented operation-only policy with authenticated context.

### P1 — external-job seam is registered but not integrated

`jobs.rs` supplies durable job stages and transactional registration/advance
methods, but `register_external_job` validates only the subject and request
fields before inserting the job (`crates/store/src/jobs.rs:126-184`). It does
not require an existing identity-bound operation, append a canonical audit
event, or bump the project revision. The source scan found no application/CLI
call sites that route verifier, backup, update, memory-publication, or stop
effects through this seam. Thus the task's requirement to wire external-job
registration to the root operation/revision boundary remains open.

### P1 — recovery resolution is a store seam, not end-to-end authorization

The new identity-bound recovery method is transactionally sound within the
store tests, but the legacy resolution method remains source-compatible and
the application/service layer still owns construction and authentication of
the actor/session/identity context. No live service evidence proves that all
recovery, resource-release, uncertain-stop, or external-process paths use the
identity-bound method. The bounded implementation must not be promoted to
PF-S02-T06 or PF-S02-T10 acceptance until those adapters and readback paths
are integrated and tested.

### P2 — profile fail-closed behavior is not universal in compatibility paths

The pinned-requirement read projection is present for production work, but
`require_gate` and `set_gate_state_row` still address the observed `gate` row
directly (`crates/store/src/lib.rs:7212-7253`). `ensure_acceptance_profile`
also preserves an empty legacy `{}` definition as a compatibility placeholder
(`crates/store/src/lib.rs:2449-2515`). This is not enough to claim that every
legacy empty definition, deleted declaration, or direct mutation path fails
closed; the profile/pinned seam tests cover the bounded supported path.

### P2 — broad shared-root change needs reconciliation

The current `lib.rs` diff is 2,220 insertions and 675 deletions relative to
the repository baseline. It includes migration, backup/runtime, v3, identity,
recovery, and operation plumbing in addition to the required root integration.
No unsafe test regression or unrelated failing behavior was observed in this
review, but the size and mixed responsibilities require the coordinator's
exact-tree reconciliation before accepting the shared file. This review does
not certify the broad diff as release-ready.

## 3. Acceptance decision

The current source and tests support retaining the root changes as a bounded
implementation contribution. They do **not** satisfy the PF-S02-T10 task
checklist as a whole. Specifically, the missing universal identity fail-closed
boundary, remaining direct operation paths, absent external-job integration,
application/service recovery wiring, absent proposed integration target, and
unrun genuine service evidence prevent full acceptance.

