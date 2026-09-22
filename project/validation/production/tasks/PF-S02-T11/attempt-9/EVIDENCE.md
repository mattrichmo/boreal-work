# PF-S02-T11 — attempt 9 application identity-bound adapter evidence

## Disposition

**Ready for independent review; full task remains rejected/unaccepted.**

## Bounded implementation observed

`ExternalEffectAdapter::new_with_identity` captures a current
`boreal_store::identity::IdentityContext`. The identity-bound path uses the
store's identity-aware registration, transition, readback, and
readback-required methods. The existing `new` constructor remains available
for the noncanonical schema-v2 fixture tests; it is rejected by the store when
used against a canonical or already-bound production store.

The adapter continues to preserve pending, readback-required, reconciled,
rejected and failed states. It only accepts attributable readback with matching
project/job/operation/request/side-effect/result identities and never creates
an evidence receipt or acceptance decision.

The application test adds a real production-schema identity fixture with an
audited operation, verifies the identity-bound admit/start/side-effect/
readback-required path, verifies operation readback, and verifies that the
legacy constructor cannot admit into the bound store.

## Remaining task-level gaps

The application-side seam is now testable but PF-S02-T11 is not complete:
verifier process wiring, memory publication, backup/update adapters,
stop/release/expiry restart recovery, service routes, genuine external
readback, and production release evidence remain open.
