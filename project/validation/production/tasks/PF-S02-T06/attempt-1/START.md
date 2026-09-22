# PF-S02-T06 — attempt 1 start

## Identity

- Repository: `/Users/cybertron/Code/boreal-work`
- Input revision: `784a41b3802c29a76721c55eef2e9493283396c2`
- Worktree: dirty combined tree; unrelated changes are preserved.
- Worker scope: `PF-S02-T06`, durable recovery, resource ownership, and external jobs.
- Exclusive production paths:
  - `crates/store/src/recovery.rs`
  - `crates/store/src/jobs.rs`
  - `crates/store/tests/production_recovery_records.rs`
- Evidence path: this attempt directory only.
- Protected integration path: `crates/store/src/lib.rs`; no worker edits.

## Interpreted invariant

Expiry, failure, cancellation, and uncertain external outcomes must remain
durably actionable after `attempt.current` is cleared. A resource remains
unavailable until its release is explicitly acknowledged. External effects
are registered before execution and become readback/reconciliation work after
an interrupted response; retries reuse the same job identity and request
digest. Database constraints reject overlapping live work/session/resource
ownership, while historical attempts, recovery decisions, and jobs remain
queryable through bounded project-scoped reads.

## Baseline and integration limit

The current store has attempt and reservation rows, operation readback, and
evidence-execution records, but no independent recovery-obligation,
resource-ownership, or general external-job tables. The existing expiry path
can clear the current attempt and release its reservation without retaining a
separate unresolved recovery fact. The proposed modules require coordinator
registration and production schema/migration integration before they are
compiled or invoked by the canonical opener.

## Expected implementation

- Add typed store records and transactional APIs for recovery obligations,
  append-only recovery decisions, resource reservations/release acknowledgments,
  and external jobs with idempotent registration and side-effect readback.
- Add schema creation/verification and database-level partial uniqueness for
  current work/session ownership and live resource overlap. Existing duplicate
  rows must fail closed rather than being silently repaired.
- Add bounded project-scoped unresolved/job queries and focused real-SQLite
  tests for cleared-current recovery, duplicate ownership, crash-after-effect
  readback, retention, and limits.

## Verification strategy

After coordinator registration is integrated, run the focused target,
store tests, formatting, contract validation, and diff checks. Until that
integration exists, only source-level validation and standalone rustfmt are
possible; no unregistered module is presented as a passing store test.

## Safety

No plan state, manifest, schema manifest, Cargo manifest, protocol registry,
shared root module, live database, or previous evidence attempt will be edited.
