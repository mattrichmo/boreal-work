# PF-S02-T06 — attempt 3 handoff

## Disposition

**Worker handoff / awaiting integration and independent review.** This report
does not claim task acceptance, sprint acceptance, or production completion.

## Changed paths

- `crates/store/src/jobs.rs`
- `crates/store/src/recovery.rs`
- `crates/store/tests/production_recovery_records.rs`
- `project/validation/production/tasks/PF-S02-T06/attempt-3/START.md`
- `project/validation/production/tasks/PF-S02-T06/attempt-3/COMMANDS.md`
- `project/validation/production/tasks/PF-S02-T06/attempt-3/EVIDENCE.md`
- this handoff

## Source and verification

Input source is `b543d41008301f7745c899e95f5cb7203ca64917` on
`codex/apply-responsive-terminal-overlay`. The isolated exact-source variant
(clean HEAD plus only the three worker paths) passed:

- `cargo test --locked --offline -p boreal-store --test production_recovery_records` — 11/11;
- `cargo test --locked --offline -p boreal-store` — all targets passed, 1
  intentional release benchmark ignored;
- clippy with only the pre-existing `profiles.rs` `too_many_arguments` lint
  allowed — exit 0;
- worker-file rustfmt and `git diff --check` — exit 0;
- `python3 project/spec/validate_contracts.py` — exit 0 on the shared tree.

The shared checkout's current full compile is blocked by unrelated concurrent
`profiles.rs` changes; exact failures and dirty paths are preserved in the
attempt evidence. No commit or push was made.

## Protected integration requests

The coordinator/store steward must review and integrate on the combined tree:

1. Confirm the existing HEAD root/migration integration remains source-bound
   for the new recovery/job tables and rerun the migration/open checks against
   this worker source. The worker did not edit `crates/store/src/lib.rs` or the
   schema/migration roots.
2. Wire canonical claim/release/expiry/fail/cancel/close resource paths to the
   new `boreal_resource_reservation` and release-acknowledgement records. The
   current protected root still directly updates the legacy `reservation` row;
   the worker API enforces the boundary when called, but cannot make that root
   path use it within this write set.
3. Confirm all external-effect adapters that can invoke verifier, Git, backup,
   update, or stop effects register/read back through the identity-bound job
   API. Current source visibly wires the evidence adapter; any remaining
   adapters require steward-owned application integration and real call-site
   tests.
4. After applying protected-root integration, rerun the focused target, full
   locked store suite, migration/external-job boundary tests, strict clippy,
   format, and independent PF-S02-T06 review on the exact combined source.

## Remaining risks

- Resource and legacy reservation state still have a coordinator-owned
  integration seam; no worker claim is made that the old reservation cannot be
  reused before the new acknowledgement path is wired.
- Service/external-process crash and readback evidence remains unrun here.
- The shared checkout is not currently compile-clean because of unrelated
  concurrent worker edits; those edits must be reconciled before combined-tree
  acceptance.
- Independent review and PF-S02 sprint gates remain outstanding.

## Next safe action

Store steward applies the protected-root integration requests, then runs the
combined-tree checks and assigns an independent reviewer. Preserve attempts 1
and 2 and this attempt; do not rewrite the rejection history or update the
shared plan ledger from this worker.
