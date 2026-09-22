# PF-S02-T10 attempt 18 — bounded handoff

## Identity and disposition

- Task: `PF-S02-T10`
- Attempt: `attempt-18`
- Input source/baseline: `70514f0ed2521df710c3c913f50ff9d759f5e743` (`70514f0e`)
- Branch: `codex/apply-responsive-terminal-overlay`; current working tree is dirty and uncommitted
- Disposition: **bounded ready-for-review handoff; not accepted**
- Plan/state/acceptance records: unchanged
- Commit/push: not performed

## Changed production paths

- `crates/store/src/lib.rs`
- `crates/store/src/profiles.rs`
- `crates/store/src/status_evaluation.rs`

## Changed test/evidence paths

- `crates/store/tests/production_store_seams.rs`
- `crates/store/tests/production_integration.rs`
- `project/validation/production/tasks/PF-S02-T10/attempt-18/START.md`
- `project/validation/production/tasks/PF-S02-T10/attempt-18/COMMANDS.md`
- `project/validation/production/tasks/PF-S02-T10/attempt-18/EVIDENCE.md`
- `project/validation/production/tasks/PF-S02-T10/attempt-18/INTEGRATION-REQUESTS.md`
- this `HANDOFF.md`

## Exact check status

- `production_store_seams`: **PASS, 5/5**.
- `production_integration`: **PASS, 4/4**.
- `cargo clippy --locked --offline -p boreal-store --lib -- -D warnings`: **PASS**.
- `cargo fmt --all -- --check`, contract validation, and `git diff --check`: **PASS**.
- Full `boreal-store`: **FAIL**, exactly two profile-requirement assertions at
  `production_profile_requirements.rs:576` and `:614`.
- `cargo check --locked --offline -p boreal-application`: **FAIL outside the
  write set** at `application/src/status.rs:291` (missing `schedule` and
  `activation_at`) and `application/src/evidence.rs:687` (E0505 borrow/move).

## Bounded blockers and next owners

1. PF-S03-T10/application integration steward: update the protected application
   status projection and resolve the protected evidence borrow/move error.
2. Store reviewer: restore the two profile-requirement fail-closed diagnostics
   while preserving strict digest validation.
3. Independent reviewer: rerun all commands in `INTEGRATION-REQUESTS.md` on
   the exact combined tree after those changes.

The strict profile fixture, read-only production schema verification, combined
integration target, canonical release request, close recovery obligation and
store-side status-field reconciliation are implemented within the authorized
scope. This handoff does not claim full-suite acceptance, application
integration, service behavior, or release readiness.
