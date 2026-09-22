# PF-S02-T10 attempt 17 — evidence

## Disposition

This is a **ready-for-review bounded blocker handoff**, not an implementation
acceptance. Only `START.md` and this attempt evidence were added in the T10
write set. No production source, schema, or integration test was changed.

## What the current tree proves

- The contract validator and diff hygiene pass.
- The store library compiles cleanly under strict Clippy.
- The existing fresh, upgrade, reopen, migration-lock, identity, operation/audit,
  pinned-requirement, recovery/resource, external-job, claim, and concurrency
  suites pass on this tree.
- The production opener's existing migration tests cover fresh/upgrade/reopen
  and reject partial metadata without silently repairing it.

## Exact blocker

The required combined-tree gate is not green. The full `boreal-store` suite
fails in the pre-existing `production_store_seams.rs` fixture because the
strict profile implementation from PF-S02-T04 rejects its placeholder digest.
That test file is outside this attempt's authorized write set. Updating the
fixture requires the PF-S02-T04 owner/coordinator to reconcile the strict
profile digest contract, after which the full store suite must be rerun.

The required `production_integration` target is also absent. Creating it is
within the nominal T10 test write set, but its assertions must be authored
against the reconciled profile/recovery/operation contracts rather than used
to hide the current failure.

## Unclosed integration requests

1. Reconcile the `production_store_seams` profile fixture with the immutable
   digest contract; preserve the test as a real regression, not a weaker
   compatibility exception.
2. Add `crates/store/tests/production_integration.rs` covering combined
   production opener, deletion/drift fail-closed behavior, exact operation
   replay, rollback, restart, concurrency, and project/database identity
   boundaries.
3. Audit the remaining root lifecycle writers: durable resource release and
   acknowledgement must accompany every terminal attempt/close/stop/fail/
   cancel path; direct legacy reservation updates must not be the sole record.
4. Confirm canonical project/workspace binding at onboarding. A persistent
   database identity alone does not prove the caller supplied the correct
   project root; the application/service must provide the validated binding.
5. Keep external verifier, memory, update, backup, and stop side effects behind
   the identity-bound job/readback adapters requested by PF-S02-T11; those
   call sites are protected outside this store-only attempt.

No fabricated service, release, or external-side-effect evidence is claimed.
