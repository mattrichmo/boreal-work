# PF-S02-T11 — attempt 15 evidence

## Disposition

**Ready for independent review with a bounded protected-tree blocker.** This
attempt is not accepted and does not authorize PF-S02-T11, PF-S02, or a
production release.

## Remediation

`classify_acquisition_observation` now clones the stage into an owned local
snapshot before matching. The fallback arm can consequently move the complete
`ExternalJobRecord` into `Conflict.current` while formatting the stage without
borrowing from the moved record. This is an ownership-only fix; it does not
change the classification table or the callback boundary.

The external callback remains reachable only from the
`ExternalEffectAcquisition::Won` arm in `ExternalEffectAdapter::execute`.
`AlreadyRunning`, `Pending`, `Terminal`, and `Conflict` return without invoking
the callback. The prior sequential running-replay regression and the separate
SQLite-connection concurrent exactly-one-callback regression remain in
`production_external_jobs.rs` unchanged by this remediation.

## Preserved invariants

- Durable operation identity and request-digest replay remain unchanged.
- A loser of `admitted -> running` acquisition cannot perform an external side
  effect.
- Pending and unknown outcomes remain pending/readback-required rather than
  being converted into success.
- Failed observations, cancellation, terminal readback, project identity
  checks, and bounded payload validation remain in the existing adapter path.
- No receipt, acceptance, or release completion is synthesized.

## Evidence limits

Owned formatting, diff checks, contract validation, and the memory regression
suite passed. The application external-job target, application library tests,
and CLI tests could not start because the combined tree still has the
protected `StatusContext` initializer error in
`crates/application/src/status.rs:291`. The prior E0505 error in
`crates/application/src/evidence.rs:687` is absent from the observed output.

No independent review was performed by this bounded remediation. The exact
commands and outcomes are recorded in `COMMANDS.md`.
