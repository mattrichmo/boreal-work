# PF-S02-T04 — retry 3 handoff

## Disposition

**Ready for independent review; not accepted.** This bounded retry implements
the remaining profile-to-pinned-declaration integrity check and leaves all
formal acceptance state unchanged.

## Changed paths

- `crates/store/src/profiles.rs`
  - Reused one canonical gate-declaration resolver.
  - Added a digest-recomputation API for pinned snapshots.
  - Validates that new pins match their immutable profile definition before
    persistence and validates the same relation on readback; mismatches fail
    closed as conflict/corruption.
- `crates/store/tests/production_profile_requirements.rs`
  - Added regressions for a digest-valid weakened pin and a coordinated
    header/child deletion with a recomputed digest.
  - Preserved the pre-existing local corruption-fixture change already present
    in this dirty file.
- `project/validation/production/tasks/PF-S02-T04/attempt-3/retry-3/`
  - Added this isolated supplemental retry record without overwriting existing
    attempt-3 evidence.

## Validation

- Focused profile requirements target: **21/21 passed**.
- Production store integration target: **4/4 passed**.
- Production store seams target: **5/5 passed**.
- Scoped rustfmt check and `git diff --check`: passed.
- Exact command outcomes, the initial test failures and correction, source
  hashes, and limitations are recorded in `COMMANDS.md` and `EVIDENCE.md`.

## Shared integration and coordinator requests

No `crates/store/src/lib.rs` module-registration patch is required for this
delta: `pub mod profiles`, the pinned schema objects, and root write/status/
closeout consumers already exist in the combined tree. Do not copy or reapply
an additional root integration patch.

Before any ledger update or acceptance, the coordinator should reconcile the
fact that `execution/STATE.json` lists T04 attempts 1–2 while evidence folders
for attempts 3–8 already exist. This retry is supplemental under the existing
attempt-3 directory solely to preserve those records. The coordinator should
also assign a separate schema/root task if normalized profile publisher and
supersession metadata are required for full contract conformance; those
changes were expressly outside this write set.

## Next safe action

Have an independent reviewer assess these two Rust file changes against the
accepted profile contract and exact current source identity. Do not mark
PF-S02-T04, AC-06, or PF-S02 accepted from this handoff alone.
