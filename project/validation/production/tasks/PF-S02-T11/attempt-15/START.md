# PF-S02-T11 — attempt 15 start

## Scope

This bounded remediation owns only:

- `crates/application/src/evidence.rs`
- `crates/application/tests/production_external_jobs.rs`
- this attempt-15 evidence directory

No plan/state file, store root, `crates/application/src/status.rs`, commit, or
push may be changed.

## Input and invariant

- Base commit: `70514f0ed2521df710c3c913f50ff9d759f5e743`
- Current `evidence.rs` hash at start: `00cdc69e8f2865cfaead4452201c69822db0e4e3`
- Current external-job test hash at start: `de5065b47f70e8cda2c1291f18bec964e580671e`
- Prior attempt: PF-S02-T11 attempt 14

The callback that performs an external effect is authorized only by
`ExternalEffectAcquisition::Won`. A caller that loses the durable
`admitted -> running` acquisition must return pending/already-running/terminal
readback and must never invoke the callback. Sequential replay, concurrent
acquisition, identity binding, operation replay, pending/unknown outcomes,
failure retention, cancellation, and bounded payload behavior must remain
intact.

## Baseline blocker

The combined tree currently reports an E0505 borrow/move error in
`classify_acquisition_observation`: the match borrows `job.stage` while the
fallback arm moves `job` into `current` and still formats the borrowed stage.
The same check also reports an unrelated missing `activation_at`/`schedule`
initializer in `crates/application/src/status.rs`; that protected path is
outside this attempt.

## Prior review context

Attempt 14 established typed acquisition outcomes and the two-connection
exactly-one-callback regression, but remained unaccepted because combined
application compilation was blocked and canonical verifier, recovery, memory,
update, and backup call sites remain protected integration work. Those open
requests remain explicit in `INTEGRATION-REQUESTS.md`; this attempt does not
claim to close them.

## Verification plan

Apply the smallest ownership-safe fix, preserve or extend sequential and
concurrent regressions, then run the focused external-job target, relevant
application/CLI checks as possible, owned formatting, contract validation, and
owned diff checks. Record every command and blocker without converting an
unrun check into a pass.
