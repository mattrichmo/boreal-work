# PF-S02-T11 — attempt 5 independent review evidence

## Disposition

**Bounded contribution accepted for review purposes; PF-S02-T11 remains
rejected/unaccepted as a complete task.**

The implementation is a valid, narrowly scoped application adapter for the
external-job/readback seam. It is not evidence that the full application
adapter integration task is complete.

## What was verified in the current source

### Identity binding

`ExternalEffectRequest` requires non-empty job, operation, project, subject,
kind, request digest, actor, and creation timestamp fields before admission
(`crates/application/src/evidence.rs:31-65`). The request is copied into the
durable store job (`:67-83`).

`ExternalEffectReadback` requires project ID, job ID, operation ID, request
digest, side-effect reference, result digest, and observation time
(`crates/application/src/evidence.rs:86-99`). Reconciliation first loads the
job in the supplied project and rejects mismatched operation or request
digest (`:224-245`). It then rejects a side-effect reference that differs
from the admitted effect (`:247-251`). The focused tests cover wrong project,
wrong operation, wrong request digest, and wrong side-effect reference.

### Readback-before-reconciliation

`reconcile_readback` returns a conflict unless the durable stage is exactly
`readback_required` (`crates/application/src/evidence.rs:253-265`). The focused
`external_effect_cannot_reconcile_without_readback_stage` test demonstrates
that an admitted/running job cannot be reconciled with a result.

The normal test path records admission, start, side-effect identity, and
`readback_required`, reads the pending state back, then reconciles with the
matching readback (`production_external_jobs.rs:70-142`). Pending and
readback-required resolutions return `is_resolved() == false`.

### Replay and result-drift behavior

Admission replay is accepted only when the request identity matches; request
digest drift is rejected by the readback path. Once reconciled, an identical
readback returns the existing durable result, while a different result digest
is rejected (`crates/application/src/evidence.rs:253-259`). The focused test
`external_effect_reconciliation_requires_matching_attributable_identity`
checks wrong effect, wrong operation, successful reconciliation, and
identical replay (`production_external_jobs.rs:193-258`).

### No fabricated success

`ExternalEffectResolution` distinguishes pending, readback-required,
reconciled, committed, rejected, and failed states. Only reconciled or
committed is resolved (`crates/application/src/evidence.rs:101-129`). The
adapter records identity and lifecycle; it does not construct an evidence
receipt or acceptance decision, and its comments explicitly leave external
process invocation and attributable result supply to the caller
(`:131-137`). The tests do not seed or assert a fabricated passing receipt.

## Fresh validation result

- Focused external-job tests: **5 passed**.
- Full application package: **passed**.
- Full memory package: **passed**, including publisher concurrency coverage.
- Full CLI package: **passed**.
- Formatting, contract validation, and diff checks: **passed**.
- Strict application clippy: **blocked** by the known out-of-scope store
  lint at `crates/store/src/profiles.rs:505`.

## Findings and boundary

The following required PF-S02-T11 outcomes remain unproven or unimplemented:

1. The adapter is not shown to be atomically joined to canonical verifier or
   receipt admission, operation identity, audit, and proof-relevant revision
   mutation in the authoritative store transaction.
2. Memory publication, backup, and update activation are not wired through
   this adapter with durable operation/job registration and readback.
3. Expiry, stop, release, cancellation, and restart recovery are not proven
   to retain durable obligations and resource acknowledgements.
4. The checks are package-level tests, not genuine service-backed lifecycle
   execution or production release/installer validation.
5. The out-of-scope store clippy error remains unresolved and prevents a
   clean strict application-package clippy result.

These are task-level blockers, not failures of the bounded identity/readback
behavior reviewed here. They must be resolved by coordinator-owned
integration and then independently revalidated on the exact combined tree.

