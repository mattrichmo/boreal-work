# PF-S02-T06 — attempt 3 start

## Identity

- Repository: `/Users/cybertron/Code/boreal-work`
- Input revision: `b543d41008301f7745c899e95f5cb7203ca64917`
- Branch: `codex/apply-responsive-terminal-overlay`
- Worktree: dirty only at pre-existing `memory/`; that path is unrelated and read-only.
- Worker scope: `PF-S02-T06`, durable recovery, resource ownership, and external jobs.
- Exclusive production paths:
  - `crates/store/src/recovery.rs`
  - `crates/store/src/jobs.rs`
  - `crates/store/tests/production_recovery_records.rs`
- Evidence path: this attempt directory only.
- Protected integration path: `crates/store/src/lib.rs`; no worker edits.

## Prior rejection and current-source repair target

Attempts 1 and 2 are preserved. Attempt 2 rejected the earlier combined tree
for missing canonical lifecycle wiring, missing ordered production schema
integration, disconnected external-job adapters, and bypassed resource-release
acknowledgements. HEAD now contains coordinator-side root/migration wiring and
application external-job calls. This attempt verifies and hardens the worker
modules and tests against those current call sites without editing the protected
root.

## Interpreted invariant

Expiry, failure, cancellation, and uncertain-stop facts must remain durable
after `attempt.current` is cleared. Live work/session/resource ownership must
be rejected transactionally until an explicit release acknowledgement. External
effects must be registered idempotently before execution, become readback work
after an interrupted response, and resolve only through attributable readback.
Terminal attempts, recovery decisions, and unresolved obligations remain
queryable after restart; bounded queries must not scan all historical rows.

## Expected verification

Run the focused recovery target, full locked store tests, migration and
external-job boundary tests, strict clippy, formatting, contract validation,
and diff checks. Add or strengthen crash/restart, duplicate ownership,
release-acknowledgement, and unresolved-obligation coverage only within the
worker test target. Record exact commands, source identity, raw results,
limitations, and any remaining protected-root integration request.

## Safety

No plan state, manifest, schema manifest, Cargo manifest, protected root,
application/service source, live database, legacy state, or prior evidence
attempt will be edited. No task or sprint acceptance will be claimed.
