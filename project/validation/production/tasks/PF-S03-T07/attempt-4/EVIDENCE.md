# PF-S03-T07 attempt 4 — independent review evidence

## Decision

**ACCEPTED** for the bounded PF-S03-T07 implementation/review profile.

This is an independent task review only. It is not sprint acceptance, parent-gate acceptance, release acceptance, or coordinator closure.

## Reviewed behavior

- Deferred cycle fixture: exact totals are `total=4`, `accepted_closed=1`, `accepted_cancelled=1`, `deferred=1`, `replaced=1`, `reconciled_scope=4`, `unresolved_scope=0`; accepted percentage is `25`, reconciled percentage is `100`; assignment `live=0`; cycle is `ReadyToComplete` and `claimable_for_actor=false`.
- Queued container fixture: `active_work=0`, `blocked_work=0`, `gate_review_gaps=1`, `gate_review_gap_tasks=1`, `overdue_work=1`, `unresolved_scope=1`, `incomplete_descendants=1`; blockers are empty, state is `Closing`, integration closeout is `Pending`, and the container is non-claimable.
- Corrupt descendant fixture: exact totals are `total=2`, `accepted_closed=1`, `corrupt_descendants=1`; accepted percentage is `None`, `is_fully_accepted=false`, quality is `Corrupt`, state is `Attention`, and the container is non-claimable.
- Active/gate/overdue/blocker fixture keeps `active_work=1`, gate gaps `1` across `1` task, overdue `1`, blockers `1` across `1` blocked task, unresolved scope `1`, and state `Attention`.
- Container execution mode forcibly rejects claimability and emits `ContainerClaimabilityIgnored`; container and cycle rollups always return `claimable_for_actor=false`.
- Assignment history is counted separately (`AssignmentCounts`) and completed assignments are checked against accepted-closed descendants; mismatches become corrupt diagnostics.

## Public boundary and hashes

The focused test uses the public registered module, not a duplicate source-path module.

```text
8c8293e61be01be9d699f405d38bcbfd34d35033440ad6f757c233645c05c2e7  crates/domain/src/lib.rs
cf7fd816022d427b41c3f9c005363446010a2c1c0388c2f3d86ad75056095a7d  crates/domain/src/rollups.rs
2771cff629ef3c3b881e622f2a7e26c652719b466c2b7ad92534d973129d7fbf  crates/domain/tests/production_rollup_policy.rs
```

## Limits

Only the requested focused command was run in this attempt. Broader checks are not inferred from this result. The worktree contains unrelated pre-existing changes; they were not modified.
