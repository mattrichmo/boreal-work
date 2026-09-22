# PF-S02-T10 recovery contract fixture — attempt 22 evidence

## Disposition

**Ready for independent review; not accepted.** The fixture remediation and
requested validation gates pass on the current combined worktree. Acceptance
state and plan ledgers were intentionally left unchanged.

## Fixture changes

`expiry_and_cancel_are_fenced_and_release_the_reservation` now:

1. Installs the recovery/resource schema and reserves the canonical
   `resource:a1` reservation for `p1/w1/a1/fence=1`.
2. Expires the attempt and verifies replacement claim remains blocked while the
   recovery obligation is unresolved.
3. Calls the legacy plain resolution with `resource_state = released` and
   asserts the intentional identity-bound conflict. The obligation remains
   unresolved and the canonical reservation remains `release_pending`.
4. Installs and binds a database/project identity context, then resolves with
   `IdentityBoundRecoveryResolutionInput` using the correct project, work,
   attempt, fence, session, operation identity, and expected project revision.
5. Verifies the obligation is resolved, the canonical reservation is
   `released`, and the durable acknowledgement ID is bound to the exact
   resolution.
6. Preserves the replacement claim, monotonic fence, cancellation, audit, and
   durable cancellation-obligation assertions.

This proves that resolving an obligation alone cannot release a live resource;
only the authenticated exact release acknowledgement can do so.

## Validation

- Dedicated fixture: **1 passed, 0 failed, 23 filtered**.
- Full `boreal-store` suite: **153 passed, 1 ignored, 0 failed**.
- Production recovery records: **12 passed, 0 failed**.
- Production integration: **4 passed, 0 failed**.
- Rust formatting, contract validation, and diff checks: **all passed**.

## Evidence boundary

This attempt validates the store contract fixture against the current combined
source. It does not claim PF-S02-T10 acceptance, full combined-tree review,
strict application Clippy resolution, or plan-level completion.
