# PF-S02-T06 — independent review attempt 2 evidence

## Final disposition

**REJECTED — PF-S02-T06 is not accepted on the current combined tree.**

The new store modules are real and their focused SQLite tests pass, but the
task requires canonical production integration. The current tree does not
wire recovery obligations, resource ownership, or external jobs into the
expiry/failure/stop/release or external-adapter paths. It also installs their
tables with direct `CREATE TABLE IF NOT EXISTS` seams rather than an ordered
production migration/ledger step.

The passing checks are retained as bounded module evidence. They do not close
the task or establish a service-backed recovery guarantee.

## Acceptance checklist comparison

| PF-S02-T06 requirement | Observation | Result |
| --- | --- | --- |
| Clearing `current_attempt` cannot erase unresolved expiry recovery | The focused test `cleared_current_attempt_retains_unresolved_recovery` passes in the module fixture. The canonical attempt mutation path still only clears `attempt.current` and updates the legacy `reservation` row. | **Not accepted** |
| Duplicate live ownership is rejected transactionally | Focused test passes; the new resource table and partial unique indexes provide the bounded store behavior. | **Bounded pass only** |
| Crash after an external effect leaves a resumable/readback job | Focused test passes through the new job API. No verifier/Git/backup/update production adapter calls that API. | **Bounded pass only** |
| Effective prerequisites, owner decisions, schema/protocol impacts and discrepancies accounted for | Worker handoff records the intended invariant and integration requests. The required canonical lifecycle wiring and migration ledger are absent. | **Incomplete** |
| Focused and required integration checks ran on actual combined source | Focused target, full store suite, migration target, clippy, format, contract validation, and diff checks all pass. The focused target manually installs the two schemas and does not prove production-open or lifecycle integration. | **Not accepted** |
| Shared changes integrated and history retained | `pub mod jobs` and `pub mod recovery` are present in `crates/store/src/lib.rs`; the worker modules and tests are present. Required migration/call-site integration is not present. | **Incomplete** |
| Complete handoff exists and coordinator records acceptance | Worker handoff and this independent review exist. No acceptance is recorded by this review; the task remains rejected. | **Not accepted** |

## Blocking findings

### PF-S02-T06-RV-001 — lifecycle paths do not create recovery or resource records

`SqliteStore::apply_attempt_mutation` routes `Fail`, `Expire`, `Cancel`, and
`Release` through `apply_attempt_row`. The terminal branch at
`crates/store/src/lib.rs:4534–4564` sets `attempt.current = 0` and marks the
legacy `reservation` as `released` or `expired`. It does not create a
`boreal_recovery_obligation`, preserve an unresolved stop/expiry obligation,
create a `boreal_resource_reservation` release request, or require a release
acknowledgement before resource reuse.

The production call-site search in `COMMANDS.md` found no calls to
`create_recovery_obligation`, `reserve_resource`, `request_resource_release`,
or `acknowledge_resource_release` outside the module definitions and focused
tests. Therefore clearing the current attempt can still remove the canonical
path's recovery fact, which is the exact task risk.

### PF-S02-T06-RV-002 — additive tables are not part of the ordered migration ledger

The root registration exists, and canonical production open invokes
`ensure_additive_store_schema` at `crates/store/src/lib.rs:1477–1503`. That
helper then checks table existence and calls
`ensure_recovery_schema`/`ensure_external_job_schema` directly at
`crates/store/src/lib.rs:1544–1551`.

The production migration plan at `crates/store/src/lib.rs:7893–7922` still has
only the `work-model-2-to-3` step. The T06 tables, indexes, triggers, source
checksum, upgrade diagnostics, and failure/retry disposition are not an
ordered migration/ledger step. This is lazy additive DDL after the existing
migration boundary, not the required fresh/upgrade/reopen migration contract.

### PF-S02-T06-RV-003 — external side-effect adapters are disconnected

The `boreal_external_job` APIs are implemented with local transactions in
`crates/store/src/jobs.rs:126–335`, but no production verifier, Git, backup,
update, or stop adapter registers a job before an external effect or reads it
back after an uncertain result. The module's local `with_transaction` helper
does not append the enclosing project operation, audit event, or project
revision. Without an application/root transaction seam, the job record cannot
be proven atomically attributable to the caller's operation context.

### PF-S02-T06-RV-004 — resource release records are not connected to the
attempt reservation path

`crates/store/src/recovery.rs:431–618` correctly models active,
`release_pending`, `unknown`, and acknowledged `released` resource states in
its own bounded API. The canonical attempt mutation code instead updates the
legacy `reservation` table directly. No production path creates the new
release event or requires acknowledgement before making a resource available.
The new table therefore cannot harden the actual stop/release behavior yet.

## What passed

- `production_recovery_records`: 5/5 focused tests.
- Full locked `boreal-store` test suite: exit 0.
- `production_migrations`: 16/16 tests.
- Strict store clippy: exit 0.
- Formatting, contract validation, and diff checks: exit 0.

These results are useful evidence for the bounded storage seam, but the task
card explicitly says a new table/module alone is not a working product and
requires actual integration call sites.

## Required correction before re-review

1. Add T06's tables, constraints, indexes, triggers, and verification to the
   ordered production migration plan/ledger with fresh, v2-upgrade, reopen,
   partial/failure, and retry coverage. Do not rely on lazy first-use DDL.
2. Add a coordinator-owned transactional integration seam so expiry, failure,
   cancellation, stop, and release preserve unresolved recovery/resource facts
   and append operation, audit, and revision context atomically.
3. Register external jobs before verifier/Git/backup/update/stop side effects,
   transition them through readback/reconciliation, and preserve unknown
   outcomes without guessing success.
4. Add real combined-tree tests that exercise the canonical opener and at
   least the lifecycle and external adapter call sites, then rerun the exact
   checks in `COMMANDS.md` and obtain a fresh independent review.
