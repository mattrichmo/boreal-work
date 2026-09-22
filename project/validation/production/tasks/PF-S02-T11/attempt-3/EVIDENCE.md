# PF-S02-T11 — attempt 3 independent review evidence

## Disposition

**REJECTED — attempt 2 is a useful bounded seam, but PF-S02-T11 acceptance is
not met.** The focused adapter tests pass, but the implementation is not wired
into the canonical verifier, memory, update, backup, or lifecycle recovery
paths required by the task. The two memory concurrency failures remain.

## What was verified

The new `ExternalEffectAdapter` in `crates/application/src/evidence.rs`:

- registers an external job before its caller performs an effect;
- preserves project, subject, operation, request-digest, actor/session, source,
  configuration, deadline, and job identity;
- distinguishes pending/readback-required/reconciled/committed outcomes;
- rejects request-digest drift and wrong-project readback;
- does not itself run a process or manufacture a receipt.

The current focused test `production_external_jobs` passed 3/3 tests against a
real in-memory SQLite-backed application/store setup. This proves the wrapper
and existing store job API can preserve those bounded state transitions.

## Findings against the acceptance checklist

### 1. External effects are not connected to canonical evidence admission

The adapter is only referenced by its new test. The canonical application
evidence path remains `crates/application/src/evidence_store.rs`, where
`admit_witnessed_execution`, `start_witnessed_execution`,
`finish_witnessed_execution`, `mark_witnessed_execution_unknown`, and receipt
insertion use the existing `evidence_execution`/receipt APIs. No production call
site registers an `ExternalEffectAdapter` job and commits job admission,
evidence execution, operation identity, audit, and proof-relevant revision in
one transaction.

The focused test therefore demonstrates a parallel wrapper API, not the
verifier/receipt contract used by the service and CLI. A crash after a real
verifier starts but before the canonical evidence transaction is recorded is
still outside this attempt's demonstrated integration boundary.

### 2. Memory publication is not operation-journal integrated

`crates/memory/src/lib.rs` adds `PublicationReadback`, and the existing
publication journal can classify clean, committed, staged, and reconciliation-
required states. However, no project/store operation is admitted before the Git
publication, and no durable external-job or canonical operation readback is
joined to the publication transaction. The new readback type is a local
filesystem/Git interpretation, not proof that a service operation was
registered, audited, and reconciled.

The task card grants `crates/memory/src/publisher.rs`, but that file does not
exist; `Publisher` is embedded in the protected `crates/memory/src/lib.rs`.
Attempt 2 correctly did not create a second unregistered publisher state
machine. This leaves the actual integration unresolved.

### 3. Update and backup adapters are not durable-job adapters

`crates/cli/src/update.rs` only locates the installed `install.sh`, runs it as
a subprocess, parses a line beginning with `Boreal `, and returns success when
the subprocess exits successfully. It has no project/store identity,
authenticated actor/session, operation request digest, external-job identity,
asset-manifest readback, or uncertain-outcome state. A process interruption or
post-install response loss is not resolved through original operation readback.

No backup adapter was changed or shown to have an operation-bound durable
admission/readback path. The task's verifier/Git/backup/update requirement is
therefore not met.

### 4. Expiry, stop, and release recovery are not connected

The reviewed application runtime remains a policy/adapter boundary. It defines
typed expiry and release commands, but the attempt does not connect those
commands to `create_recovery_obligation`, resource-release acknowledgement, or
unresolved-obligation readback in the canonical store/service mutations.

The durable recovery APIs exist in `crates/store/src/recovery.rs`, but existence
of those APIs is not lifecycle wiring. No evidence here demonstrates that
expiry or release creates an obligation, survives restart, and remains
unresolved until attributable resource acknowledgement.

### 5. Memory concurrency failures remain unresolved

The current rerun of `cargo test --locked -p boreal-memory` produced 20 passing
tests and 2 failures:

- `concurrent_same_operation_publication_has_one_commit_identity`
- `concurrent_distinct_publications_serialize_without_lost_entries`

Both failures include `Conflict("another publication owns the memory root
lock; retry after it exits")`. The attempt-2 record preserved these failures;
the current tree still has them. They cannot be treated as harmless fixture
noise for a task explicitly requiring durable external-effect recovery and
serialization.

### 6. Scope/path discrepancy is documented, not resolved

The missing `crates/memory/src/publisher.rs` path is accurately documented in
attempt 2. That is good evidence hygiene, but it means the task's granted
publisher boundary does not cover the authoritative implementation. The
discrepancy requires a reviewed path grant or a deliberate publisher split and
registration before acceptance; it is not resolved by the local readback enum.

## Acceptance matrix

| Requirement | Result | Reason |
| --- | --- | --- |
| Interrupted effect stays pending/readback-required and resolves only by attributable readback | Partial | Proven only by the isolated adapter test; not canonical verifier/receipt integration. |
| Expiry/release preserve recovery across restart | Not proven | No lifecycle wiring or restart/readback evidence. |
| Verifier/Git/backup/update retain operation identity and avoid guessed success | Not met | Verifier and update paths bypass the adapter; backup integration is absent; memory is only locally journaled. |
| Prerequisites, owner decisions, schema/protocol impacts and discrepancies accounted for | Partial | Attempt-2 records blockers accurately; required integration decisions remain open. |
| Focused checks and required integration layer on exact source/artifact identity | Not met | Focused adapter check passes, but memory suite fails and the required integration layer is absent. |
| Changes stay within boundary and failed evidence is preserved | Met for this attempt | No production source, state, or manifest changes were made by this review; prior failures remain recorded. |
| Complete handoff/evidence and coordinator acceptance | Not met | Handoff explicitly says blocked; independent review rejects acceptance. |

## Required next action

Keep PF-S02-T11 unaccepted. Reassign only after a reviewed integration grant
covers the authoritative memory publisher path and canonical application/store
boundaries. The next implementation must wire verifier admission/readback,
memory publication, backup, update, and expiry/release recovery through durable
operation identity and then rerun the real-service and restart/readback cases.

