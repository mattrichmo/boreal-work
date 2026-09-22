# PF-S02-T11 — attempt 14 start record

## Scope and source

- Task: `PF-S02-T11`
- Attempt: `14`
- Base source: `70514f0e` (`chore: checkpoint production completion wave`)
- Current input includes the unaccepted attempt-13 application patch in:
  - `crates/application/src/evidence.rs`
  - `crates/application/tests/production_external_jobs.rs`
- Worker scope:
  - `crates/application/src/evidence.rs`
  - `crates/application/tests/production_external_jobs.rs`
  - this attempt directory only

No plan/state, protected store/service/memory paths, commit, or push changes are
authorized for this attempt.

## Invariant being repaired

For one durable external-job identity, at most one caller may cross the
`admitted -> running` boundary and invoke the external callback. A competing
caller must receive a typed non-winning result after durable re-read/classification
and must never invoke the callback. Terminal/readback states remain readback
outcomes, not permission to retry the external effect.

## Intended change

Add a typed acquisition result that distinguishes the winning transition,
already-running/pending state, terminal/readback state, and a transition
conflict. Keep the existing `start` compatibility surface as a resolution
wrapper, but make `execute` use the acquisition result and run its callback
only for the winner. Add a concurrent file-backed regression plus retain the
sequential replay, restart, identity, pending, rejection, and readback tests.

## Known protected integration requests

Canonical verifier/evidence, recovery/resource acknowledgement, memory
publication, update, and backup call sites remain outside this attempt's write
lease. They will be preserved as integration requests rather than implemented
through an unregistered adapter.

## Verification strategy

Run the focused external-job target, application runtime tests, CLI compatibility
tests, memory/store boundary tests, owned formatting and diff checks, and the
contract validator. Record exact commands and any combined-tree failures in the
attempt evidence; this attempt is ready-for-review only after the evidence is
complete.
