# PF-S02-T10 status-batching remediation — attempt 21 evidence

## Disposition

**Ready for independent review; not accepted.** The implementation and store
validation are complete for this bounded attempt. The task ledger remains
unchanged until an independent reviewer verifies the combined tree and the
remaining PF-S02 integration blockers are resolved.

## Implemented behavior

- Added one guarded project-scoped planning-facts scan keyed by `work_id`.
- Preserved the `cycle_assignment_v3`/`cycle_v3` join, project predicate,
  `planned`/`committed` filtering, earliest activation calculation, and
  `at_cycle_start`/`explicit_not_before` semantics.
- The status snapshot consumes and removes each work's planning result while
  decoding rows, eliminating the per-work query path.
- Per-work activation conversion errors remain owned by the affected row and
  become the existing `corrupt_record` diagnostic instead of aborting healthy
  siblings.
- Missing optional planning tables still produce empty facts, preserving the
  existing v2 behavior.
- The original single-work helper remains available unchanged for compatibility
  callsites.

## Source scope

Attempt-21 edits are confined to:

- `crates/store/src/status_evaluation.rs`
- `crates/store/src/lib.rs`
- `project/validation/production/tasks/PF-S02-T10/attempt-21/`

`crates/store/tests/storage_remediation.rs` already contained the exact
250-work regression and did not require a test-file edit. The shared worktree
also contains earlier, unaccepted stream changes outside this attempt; they
are not attributed to attempt 21.

## Validation result

The exact batching regression, all 15 storage-remediation tests, the complete
`boreal-store` suite, strict store Clippy, formatting, contract validation,
and diff checks passed. This evidence does not claim application, service,
recovery, release, or end-to-end acceptance.
