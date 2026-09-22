# PF-S02-T11 — attempt 21 identity-atomic release evidence

## Disposition

**Bounded repair complete; ready for independent review; not accepted.** This
attempt does not change PF-S02-T11, PF-S02, plan/state, ledger, or any release
gate.

## Source-bound result

At `crates/application/src/runtime.rs:422-463`, identity-bound calls to the
standalone adapter release methods reject before `validate_project` and before
the legacy store mutation. Both request and acknowledgement use the same
bounded conflict:

`standalone identity-bound resource release requires the canonical terminal store route`

At `crates/application/src/runtime.rs:978-1005`,
`request_resource_release_with_identity` and
`acknowledge_resource_release_with_identity` therefore cannot mutate through a
read-only identity preflight race. The application documentation names the
safe routes explicitly: the canonical terminal attempt transaction requests
release, and `resolve_attempt_recovery_with_identity` acknowledges it through
the store's identity-bound recovery transaction.

At `crates/application/src/runtime.rs:1074-1139`, the post-terminal check no
longer attempts a second standalone release mutation. It reads the current
identity/recovery context and fails with an unknown outcome if a matching
resource remains `active` or `unknown`; the canonical store path must have
already committed `release_pending`.

## Regression coverage

- `crates/application/src/runtime.rs:1473-1581`
  `standalone_identity_bound_resource_helpers_fail_closed` proves request
  leaves an active reservation unchanged and acknowledgement leaves an already
  pending reservation unchanged.
- `crates/application/tests/production_external_jobs.rs:464-598`
  `terminal_release_uses_canonical_identity_bound_recovery` proves the real
  `SqliteAttemptAdapter` terminal route still produces `release_pending` and
  identity-bound recovery resolution makes the resource reusable.
- `crates/application/tests/production_external_jobs.rs:600-716`
  `terminal_release_fallback_fails_closed_without_canonical_store_mutation`
  proves a non-canonical adapter cannot cause the application post-check to
  synthesize a release event; the reservation remains `active`.

A deterministic rebind/restore interleaving test was not feasible within the
exclusive application-only write set: there is no store transaction hook
between the identity preflight and the legacy mutation, and adding the
required atomic store seam would violate the stated boundary. The fail-closed
branch removes that mutation path entirely, so the standalone race is
eliminated rather than timing-tested.

## Remaining scope

The two standalone identity-bound helpers intentionally remain unavailable
until the store exposes an atomic identity-bound resource request and
acknowledgement transaction. Callers must use the canonical terminal attempt
mutation and identity-bound recovery resolution. No store, service, CLI,
memory, migration, plan/state, ledger, commit, or push changes were made, and
genuine external-adapter acceptance remains outside this repair.
