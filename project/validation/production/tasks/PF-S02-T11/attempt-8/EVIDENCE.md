# PF-S02-T11 — attempt 8 independent bounded review evidence

## Decision

**Accepted as a bounded store contribution only. Full PF-S02-T11 remains
rejected/unaccepted. No blocking defect was found in the reviewed store seam.**

## Findings against the review questions

1. **Legacy boundary and current lineage — boundedly sound.** In
   `crates/store/src/jobs.rs`, canonical production stores and already-bound
   project stores reject the legacy public registration, transition, and read
   paths with an identity-bound API conflict. The identity-bound registration,
   transition, and readback paths validate the supplied current database
   instance, restore epoch, and project binding through `IdentityStore`.
   `external_job_by_operation` and the legacy readback marker route through the
   same fail-closed legacy gate. A schema-v2 fixture without additive identity
   tables retains the legacy path, as required for genuine fixture
   compatibility.

2. **Operation/audit identity and no fabricated success — boundedly sound.**
   Registration checks current operation readback, project, request digest,
   actor, session, and audit identity, including audited subject and operation
   revision/fence linkage. Exact job replay is idempotent; changed immutable
   request fields are rejected. Readback-required remains unresolved and is
   not converted into committed success. The focused tests cover subject,
   actor, session, digest, replay, and restore-lineage mismatch cases.

3. **Atomic rejection and transitions — boundedly sound.** Registration and
   transition helpers use `BEGIN IMMEDIATE`/commit/rollback boundaries. Illegal
   transitions reject before the update, and the focused test confirms the job
   remains at `registered`; identity mismatch rejection leaves no job row.
   Restore-lineage change makes the prior context unreadable. The append-only
   identity trigger protects immutable job identity fields.

4. **Legacy schema-v2 compatibility — boundedly evidenced.** The focused
   boundary test opens `schema-v2.sql`, installs only the job sidecar, and
   verifies a legacy registration succeeds. This preserves the narrowly
   intended fixture behavior; it is not evidence that a production v2 runtime
   may bypass current identity authority.

5. **Claim accuracy — limited and accurate.** The four focused tests and the
   existing 7 recovery plus 15 operation/audit tests support the store-layer
   claims above. They do not prove application/service routing, real verifier
   execution, external process outcomes, memory publication, backup, update,
   restart orchestration, packaging, or release conformance.

## Integration limitation and full-task disposition

The current application evidence adapter still has call sites using the
unbound store methods, and the repository search did not establish the
required complete application/service wiring through the new identity-bound
job seam. The required PF-S02-T11 application test/integration and real-effect
readback evidence are not part of this bounded contribution. Memory,
backup/update, stop/release/cancellation, restart recovery integration, and
real-service/release evidence remain outstanding.

Accordingly, accept only the bounded store authority result for this attempt.
Keep the complete PF-S02-T11 task rejected/unaccepted pending the missing
application/service integration and genuine effect/readback evidence. Do not
promote fixture/package test success to product or release acceptance.
