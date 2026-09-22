# PF-S02-T11 — attempt 13 handoff

## Status

**Ready for independent review, bounded blocker recorded.** Do not mark
PF-S02-T11 accepted and do not advance PF-S02 on this attempt alone.

## Changed paths

- `/Users/cybertron/Code/boreal-work/crates/application/src/evidence.rs`
- `/Users/cybertron/Code/boreal-work/crates/application/tests/production_external_jobs.rs`
- `/Users/cybertron/Code/boreal-work/project/validation/production/tasks/PF-S02-T11/attempt-13/`

The runtime and CLI update worker paths were audited but not changed in this
attempt. No `crates/memory/src/publisher.rs` was created because that module
does not exist and the actual memory root is protected.

## Result

The external-effect adapter no longer invokes a callback again when a durable
job replays from `running`; it returns the pending job for attributable
readback. The new regression test and all focused T11 checks pass.

## Exact blockers and next action

The next steward must integrate the identity-bound recovery/resource APIs and
canonical verifier, memory, update, and backup call sites listed in
`INTEGRATION-REQUESTS.md`. It must also resolve the full application
`p2_guided_flow` resource-reservation uniqueness failure and rerun the full
combined checks. An independent reviewer should inspect this diff and the
protected-root requests against source `70514f0e` plus the uncommitted worker
changes before any ledger update.

No commit, push, plan/state edit, or task acceptance was performed.
