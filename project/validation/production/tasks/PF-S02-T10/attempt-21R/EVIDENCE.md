# PF-S02-T10 recovery/resource remediation — attempt 21R evidence

## Disposition

**Bounded ready-for-review handoff; not accepted.** The recovery contract is
implemented and focused/guided evidence passes. Full store and strict
application-Clippy acceptance remain open for the bounded reasons in
`COMMANDS.md`.

## Implemented contract

- Plain recovery resolution rejects every `released` declaration. It cannot
  make a bound execution resource reusable without an authenticated identity
  context.
- Identity-bound released resolution re-reads the obligation while holding
  the write transaction and validates project, work, attempt, and fence.
- It locates the exact `resource:{attempt_id}` reservation and requires the
  canonical reservation to be `release_pending`.
- It requires exactly one pending terminal-release event whose evidence is
  `attempt-terminal:{attempt_id}:{fence}`. Missing, ambiguous, or mismatched
  events fail closed.
- It acknowledges the canonical release before committing the recovery
  decision. A failed acknowledgement rolls back the decision, operation,
  audit, and revision together.
- The deterministic acknowledgement is replay-safe; the exact operation
  returns the original result without a second decision or release effect.
- The live-resource unique index and existing `work:{project}:{work}` claim
  resource key were not changed.

## Regression coverage

`production_recovery_records` proves plain release rejection, exact resource
binding, released-state transition, acknowledgement readback, replay
idempotency, and foreign-project rejection. The guided flow proves:

1. plain resolution does not release the expired resource;
2. a foreign identity-bound resolution is rejected;
3. the authenticated exact resolution releases the canonical reservation; and
4. the replacement claim succeeds afterward.

## Exact residual failures

The full store suite has one expected follow-up outside this attempt's allowed
write set: `crates/store/tests/store_contracts.rs` still encodes the old plain
`released` resolution path. It must be migrated to the identity-bound path or
assert the new fail-closed behavior in a separately scoped attempt.

Strict all-target application Clippy is blocked by the unused public recovery
adapter methods. Application tests, focused runtime tests, store recovery,
production integration, format, contract, and diff checks pass.
