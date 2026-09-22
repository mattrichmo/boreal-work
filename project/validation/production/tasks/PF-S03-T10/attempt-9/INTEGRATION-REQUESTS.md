# PF-S03-T10 — attempt 9 integration requests

## IR-1 — status/2 compatibility arm

Status/2 compatibility is integrated in `crates/cli/src/main.rs`:

```text
DerivedStatus::Scheduled -> "queued"
```

The application projection remains responsible for retaining
`scheduled_start(...)`, `claimable_for_actor = false`, and `wait_until`. The
CLI does not parse reason prose or authorize a mutation.

## IR-2 — status/3 public route remains outside this attempt

No public status/3 route was invented in the protected CLI monolith. If a
coordinator adds one, it must serialize the canonical status/3 decision
directly (including `scheduled`) and must prove the status/2 mapping remains
additive. It must not infer status from reason strings or make scheduled work
claimable.

## IR-3 — combined-tree follow-through

The coordinator/reviewer must rerun the status projection and CLI checks on the
exact integrated source revision after PF-S02 resource/recovery integration.
The prior application handoff's reservation uniqueness failure remains a
separate bounded blocker. This attempt supplies no waiver for it and makes no
plan/state acceptance update.
