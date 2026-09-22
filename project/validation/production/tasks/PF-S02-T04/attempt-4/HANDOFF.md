# PF-S02-T04 — Attempt 4 handoff

## Status

**Ready for independent review — bounded remediation only; unaccepted.**

Worker scope was limited to the T04 profile module/test boundary and this
attempt's evidence directory. No plan/state, shared root, schema, application,
commit, or push operation was performed.

## Result

The two T04 failures at
`crates/store/tests/production_profile_requirements.rs:576` and `:614` were
caused by the fixtures leaving their intentionally removed immutable triggers
absent. The strict schema validator then correctly returned the schema-integrity
quarantine before inspecting the corrupted child row. Each fixture now restores
the exact trigger after its temporary corruption mutation and before readback.

This preserves the intended safety checks and makes the assertions specific to
the corruption they introduce. The implementation in
`crates/store/src/profiles.rs` remains strict and was not weakened.

## Changed paths in this attempt

- `crates/store/tests/production_profile_requirements.rs`
- `project/validation/production/tasks/PF-S02-T04/attempt-4/START.md`
- `project/validation/production/tasks/PF-S02-T04/attempt-4/COMMANDS.md`
- `project/validation/production/tasks/PF-S02-T04/attempt-4/EVIDENCE.md`
- `project/validation/production/tasks/PF-S02-T04/attempt-4/HANDOFF.md`

## Exact checks

Passed:

- T04 focused profile target: **13/13**.
- Combined `production_integration`: **4/4**.
- Store library and all-target strict Clippy.
- Assigned-file rustfmt and workspace `cargo fmt --all -- --check`.
- Contract validator.
- `git diff --check`.

Retained failure:

- Full `cargo test --locked --offline -p boreal-store`: one failure in
  `storage_remediation::status_gate_queries_are_batched_for_large_projects`
  (762 prepared statements versus the fixed-size fixture expectation). This
  belongs to the concurrent status/store integration work, not this T04
  remediation.

## Next safe action

An independent reviewer should inspect the test-only trigger restoration and
rerun the focused profile target plus the full store suite on the exact combined
tree. The coordinator should preserve the full-store status batching failure,
route it to the PF-S02 status/store owner, and must not update `STATE.json` to
accepted from this handoff alone.
