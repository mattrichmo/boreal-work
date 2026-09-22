# PF-S02-T10 recovery contract fixture — attempt 22 handoff

## Identity and disposition

- Task: `PF-S02-T10` with PF-S02-T06 recovery/resource seam.
- Attempt: `attempt-22`.
- Input: current combined worktree after PF-S02-T10 attempt-21R.
- Disposition: **bounded ready-for-review; not accepted**.
- Plan/state/acceptance records: unchanged.
- Commit/push: not performed.

## Changed paths

- `crates/store/tests/store_contracts.rs`
- `project/validation/production/tasks/PF-S02-T10/attempt-22/START.md`
- `project/validation/production/tasks/PF-S02-T10/attempt-22/COMMANDS.md`
- `project/validation/production/tasks/PF-S02-T10/attempt-22/EVIDENCE.md`
- `project/validation/production/tasks/PF-S02-T10/attempt-22/HANDOFF.md`
- `project/validation/production/tasks/PF-S02-T10/attempt-22/INTEGRATION-REQUESTS.md`

## Result

The old plain `released` fixture path was replaced with a fail-closed assertion
plus the valid authenticated identity-bound resolution path. The valid path
checks the canonical reservation’s durable `release_pending` state and terminal
evidence, then verifies release acknowledgement before allowing the replacement
claim. Existing stale-fence, old-attempt, and cancellation guarantees remain.

## Exact validation result

- Dedicated fixture: **1 passed, 0 failed, 23 filtered**.
- Full store suite: **153 passed, 1 ignored, 0 failed**.
- Production recovery target: **12 passed, 0 failed**.
- Production integration target: **4 passed, 0 failed**.
- `cargo fmt --all -- --check`: **PASS**.
- `python3 project/spec/validate_contracts.py`: **PASS**.
- `git diff --check`: **PASS**.

## Coordinator action

Review the exact combined tree and attempt-21R implementation independently.
If accepted, the coordinator may update the task disposition through the plan’s
normal acceptance workflow. Do not infer task acceptance from this handoff.
