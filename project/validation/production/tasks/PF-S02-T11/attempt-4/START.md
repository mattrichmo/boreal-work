# PF-S02-T11 — attempt 4 corrective implementation start

## Scope and disposition

This attempt is a bounded corrective implementation against the current
combined worktree. It is limited to the granted application adapter and test
paths plus this evidence directory:

- `crates/application/src/runtime.rs`
- `crates/application/src/evidence.rs`
- `crates/memory/src/publisher.rs`
- `crates/cli/src/update.rs`
- `crates/application/tests/production_external_jobs.rs`
- `project/validation/production/tasks/PF-S02-T11/attempt-4/`

The authoritative memory publisher remains embedded in
`crates/memory/src/lib.rs`; `crates/memory/src/publisher.rs` is absent. No
unregistered parallel publisher was created. The canonical evidence/store
transaction, lifecycle recovery, backup, and update integration seams remain
outside this grant and are recorded as integration requests in the handoff.

## Loaded context

Read the complete PF-S02-T11 card, PF-S02 sprint card, startup and parallel
dispatch rules, the production contract manifest, operation identity contract,
service recovery context, memory publication context, and prior attempts 1–3.
The prior independent review rejected the earlier wrapper because it allowed
reconciliation from a bare result digest and was not connected to the
canonical verifier, memory, update, backup, or lifecycle paths.

## Intended bounded change

Harden the existing `ExternalEffectAdapter` so that an external effect can be
resolved only by an attributable operation-bound readback containing the
project, job, operation, request digest, recorded side-effect reference,
result digest, and observation time. Preserve pending and readback-required
states, reject identity drift, and make an identical resolved readback safe to
replay. Add focused tests for the positive and rejection boundaries.

No receipt, verifier success, Git publication, backup result, update result,
or lifecycle recovery completion is synthesized by this attempt.

