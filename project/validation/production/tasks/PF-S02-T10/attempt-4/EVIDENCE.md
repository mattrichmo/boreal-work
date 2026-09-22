# PF-S02-T10 independent review — evidence

## Decision

**REJECTED — PF-S02-T10 is not accepted as a full task.**

The current tree contains useful bounded seams and a working root work-creation pin, but it does not provide the required canonical integration. The task's acceptance condition explicitly requires root recovery/jobs lifecycle wiring and all canonical operation call sites; both are absent. In addition, the focused operation/audit suite is failing on the combined tree.

## Finding 1 — recovery and external jobs are not wired into canonical lifecycle mutations

`crates/store/src/lib.rs:1516-1562` only checks for the recovery and external-job tables at production open and invokes `ensure_recovery_schema()` / `ensure_external_job_schema()` when they are absent. The implementation has no root lifecycle calls to:

- create recovery obligations when attempts expire, fail, stop, release, or become unknown;
- resolve or reconcile those obligations through an operation/audit bundle;
- register external verifier, Git, backup, stop, or update jobs before side effects;
- advance/read back those jobs from application adapters.

The static call-site query found no such calls outside `recovery.rs`, `jobs.rs`, and their focused tests. The standalone module APIs therefore cannot preserve recovery facts or unknown external outcomes in the authoritative mutation paths. The modules' own comments also describe this as a seam awaiting coordinator/root integration.

The schema is present in both `project/spec/schema-production.sql` and `project/spec/schema-v3.sql`, but table presence is not lifecycle integration. Moreover, the open path still performs conditional module DDL for missing recovery/job tables rather than having the migration ledger own the complete ordered schema path. That is insufficient for a full production task.

## Finding 2 — canonical operation writes still bypass identity-bound journaling

`crates/store/src/lib.rs` contains 21 direct `append_operation(...)` call sites. Representative authoritative mutations include:

- session registration and ending around lines 1965 and 2149;
- claim around lines 3741-3754;
- attempt mutation around lines 4324-4340;
- receipt insertion around lines 5682-5702;
- review insertion around lines 6021-6041;
- summary insertion around lines 6147-6163;
- close creation/finalization/rejection around lines 6298-6314, 6410-6426, 6449-6465, and 6534-6550.

These paths write an operation and then append an audit event separately. `append_operation_audit_in_transaction` exists, but the static query shows it is used only by work creation at line 2823. Its fallback at lines 5194-5197 deliberately reverts to the legacy two-write path when the project identity is not bound. This does not establish the required universal identity-bound operation/audit contract for canonical production mutations.

## Finding 3 — current combined tree has a focused identity regression

`is_production_schema_request` treats the legacy schema-v2 text as a production open request (`crates/store/src/lib.rs:8135-8138`). The production open path then enters `ensure_additive_store_schema`. When the identity tables exist but are empty, the path installs a generated identity (`crates/store/src/lib.rs:1517-1553`). The in-memory PF-S02-T07 fixture opens schema-v2 and then explicitly installs `database-1` (`crates/store/tests/production_operation_audit.rs:14-41`), so the second install fails with the generated identity `boreal-db-3a6d656d6f72793a`.

Result: `production_operation_audit` ran 10 tests; 1 passed and 9 failed before exercising the operation bundle assertions. This is a blocking combined-tree validation failure, even though the isolated identity-bound primitives are present.

## Positive bounded evidence

The following bounded behavior is present and passed:

- immutable pinned requirement persistence and observation-independent readback: 9 focused tests;
- recovery/job record primitives, cursoring, idempotent readback, and retained obligations: 5 focused tests;
- ordered production migration behavior: 16 tests;
- store seam and status snapshot behavior: 5 and 2 tests respectively;
- storage remediation and project-scoped status/readback behavior: 15 tests;
- independent revision/fence identity conversions: 6 tests;
- formatting and whitespace checks.

These passes do not compensate for missing root integration or the failing operation/audit suite.

## Profile/pinning caveat

The current tree does call `ProfileStore::persist_pinned_requirements_in_transaction` from `create_work_in_transaction` (`crates/store/src/lib.rs:2456`), and status/gate reads prefer pinned declarations. However, `crates/store/src/profiles.rs:721-725` and `801-805` retain an idempotent module-local `CREATE TABLE IF NOT EXISTS` installer, explicitly stating that ordered production migration wiring remains outside the module. The root status path is improved, but this does not close the recovery/jobs and operation-journal acceptance gaps.

