# PF-S02-T11 — attempt 17 application-integration handoff

## Identity and disposition

- Task / attempt: `PF-S02-T11 / attempt-17`
- Worker: application-integration worker
- Disposition: **ready for independent review; bounded only; not accepted**
- Final HEAD: `0d9611a017d5dc167e92fe79e8d65756fbac2d5a`
- Branch: `codex/apply-responsive-terminal-overlay`
- No plan/state/acceptance change, commit, or push was performed by this worker.

## Changed paths in this attempt

- `crates/application/src/runtime.rs`
- `crates/application/tests/production_external_jobs.rs`
- `project/validation/production/tasks/PF-S02-T11/attempt-17/START.md`
- `project/validation/production/tasks/PF-S02-T11/attempt-17/COMMANDS.md`
- `project/validation/production/tasks/PF-S02-T11/attempt-17/EVIDENCE.md`
- `project/validation/production/tasks/PF-S02-T11/attempt-17/HANDOFF.md`
- `project/validation/production/tasks/PF-S02-T11/attempt-17/INTEGRATION-REQUESTS.md`

All other dirty paths belong to prior/concurrent work and were preserved. The
coordinator checkpoint `0d9611a0` landed during the attempt; it was not created
by this worker.

## Implemented invariant

The application terminal release/recovery path now uses the current identity
context and identity-bound recovery adapter, validates the durable obligation’s
attempt/fence before requesting release, and emits the canonical
`attempt-terminal:{attempt_id}:{fence}` evidence reference. Recovery remains
pending until the store’s identity-bound acknowledgement transaction resolves
the exact reservation. Typed request boundaries preserve operation identity,
request-digest replay, wrong-project rejection, and idempotent acknowledgement.

## Validation summary

- Runtime-focused tests: `8 passed, 0 failed`.
- Full `boreal-application`: `44 unit tests` plus all integration/doc targets
  passed.
- Production external jobs: `14 passed, 0 failed`.
- Production store recovery: `12 passed, 0 failed`.
- Production store integration: `4 passed, 0 failed`.
- Strict application Clippy with `-D warnings`: passed.
- Workspace formatting, owned-file rustfmt, contract validation, and diff
  checks: passed.

Exact argv, source hashes, baseline comparison, and the concurrent HEAD event
are in `COMMANDS.md`; behavioral evidence and limitations are in
`EVIDENCE.md`.

## Required independent review

Review the final combined tree and confirm:

1. No production terminal path constructs the unbound recovery adapter.
2. The release event/evidence identity remains compatible with the store’s
   `attempt-terminal:{attempt_id}:{fence}` check.
3. Recovery obligation project, work, attempt, fence, operation, and replay
   authority remains store-owned and fail-closed.
4. The new tests are bounded application-boundary coverage, not fabricated
   service or release proof.

The coordinator must separately reconcile the service-route and genuine
external-adapter gaps in `INTEGRATION-REQUESTS.md` before any task acceptance.
