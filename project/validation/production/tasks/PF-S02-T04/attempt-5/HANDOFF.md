# PF-S02-T04 — Attempt 5 implementation handoff

## Identity and disposition

- Task / plan / attempt: `PF-S02-T04` / PF production-completion plan v1 / `attempt-5`.
- Worker: bounded store implementation worker.
- State requested: **awaiting_integration / ready_for_review**; not accepted by the coordinator.
- Input source: `3017a1dbebaa7945f82b2a2512ec0c1eabbd69c9`.
- Prerequisites: `PF-S02-T02/attempt-4` and `PF-S02-T03/attempt-4` handoffs read; their bounded limitations remain in force.

## Changes and invariant

Owned changes:

- `crates/store/src/profiles.rs`
- `crates/store/tests/production_profile_requirements.rs`
- `project/validation/production/tasks/PF-S02-T04/attempt-5/{START,COMMANDS,EVIDENCE,HANDOFF}.md`

The profile constructor now retains canonical JSON, preventing formatting-only content drift. The profile store now provides a fail-closed latest pinned-requirement read and exposes required declarations from the immutable snapshot. The tests prove that observed gate deletion does not remove the requirement, and that a missing snapshot is corruption rather than an empty profile.

## Shared integration request

`crates/store/src/lib.rs` is a protected shared root and was intentionally not edited. The coordinator/store steward must apply and review this integration:

1. Replace `summary_required`'s direct `gate` query with `ProfileStore::current_required_declarations`, treating `StoreError::Corrupt` as a closeout diagnostic rather than “summary not required.”
2. In receipt/closeout policy validation, compare the requested gate against the persisted declaration set (gate identity, kind, required flag, profile version and profile digest), not only the observed `gate` row.
3. Keep the existing status pinned-declaration projection, but route missing or malformed current snapshots through the same quarantine diagnostic so status and closeout cannot disagree.
4. Run the focused target, full store tests, and application closeout tests on the combined tree. Record the resulting source hashes before independent PF-S02-T90 review.

The production schema and module registration already exist on the input tree; this attempt did not add duplicate DDL or registration.

## Validation and residual work

The exact command outcomes are in `COMMANDS.md`; no test or service result was inferred. No commit or push was performed. Native, service-backed, installer, and release checks are outside this bounded store task.

The task is not ready for coordinator acceptance until the shared closeout integration is applied, the combined tree is revalidated, and PF-S02-T90 independently reviews the exact resulting source. Until then, a direct closeout path that reads only observed `gate` rows can still miss a deleted required gate even though status and the new ProfileStore API retain the declaration.

Next safe action: have the shared store steward integrate the four requested root changes, then run PF-S02-T90 → PF-S02-T91 → PF-S02-T92 without overwriting this evidence.

- [x] No passing result was fabricated.
- [x] Failures and pre-existing worktree changes were preserved.
- [x] Owned source changes remain within the granted write set.
- [ ] Shared registrations/call sites are integrated.
- [ ] Coordinator acceptance is recorded.
