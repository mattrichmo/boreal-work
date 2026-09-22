# PF-S02-T07 — Attempt 5 evidence

## Disposition

**Ready for independent review as a bounded corrective contribution; not accepted.** The required post-edit Rust execution is blocked by an unrelated concurrent compile error in `crates/store/src/profiles.rs:1103`. The prior attempt-4 bounded review and all failed evidence remain preserved.

## Bounded implementation

- `audit.rs` now prevalidates the schema-owned event and subject vocabularies and rejects zero audit revisions before an operation row is inserted. JSON detail remains recursively bounded and redacted.
- `operations.rs` now exposes `audit_event_in_context`, which performs the current project/database identity readback before returning the indexed operation audit row. It also validates the schema-owned audit identity fields before durable append.
- `production_operation_audit.rs` adds coverage for crash-after-commit-before-response naming, real semantic-mutation rollback when the audit revision conflicts, persisted rejected disposition without target mutation, exact duplicate request replay, changed request digest, actor mismatch, and foreign-project readback/replay isolation.

## Acceptance coverage disposition

| Requirement | Attempt-5 status |
| --- | --- |
| Crash after commit-before-response returns one original outcome and audit event | Implemented and existing bounded baseline test passed before this correction; renamed regression and new changes are not post-edit executable because of `profiles.rs:1103`. |
| Rejected action records disposition without changing the target | New bounded test added; post-edit execution blocked. |
| Duplicate payload replays exactly; changed payload digest conflicts | New exact-duplicate test added; existing changed-digest test passed before this correction; post-edit execution blocked. |
| Actor/project boundary is fail-closed and readback is scoped | New register/replay and context-readback tests added; post-edit execution blocked. |
| Pending/unknown outcomes remain distinct | Existing bounded test passed before this correction; implementation remains unchanged and post-edit execution is blocked. |
| Mutation, outcome, identity, and audit share rollback boundary | New test stages a real work-item dispatch mutation, forces a unique audit-revision failure after operation/identity insertion, and rolls back the entire caller transaction; post-edit execution blocked. |
| Audit details are bounded/redacted | Existing 15-test baseline passed; schema identity prevalidation added; post-edit execution blocked. |
| Canonical production call sites use the strict path | Not met in worker scope. Protected root/application/CLI integration is requested in `COORDINATOR-INTEGRATION.md`. |

## Risks and limitations

- The new tests and changed implementation require a successful combined-tree compile; the current concurrent `profiles.rs:1103` type mismatch prevents that verification.
- `crates/store/src/lib.rs`, `crates/store/src/knowledge.rs`, `crates/store/src/work_model_v3.rs`, `crates/cli/src/main.rs`, and `crates/cli/src/service.rs` were read-only for this worker. Direct/legacy writers and the root helper's replay-before-mutation integration remain coordinator/steward work.
- Store-level tests do not establish genuine service, process-crash, native, release, or independent acceptance evidence.
- Full workspace formatting and strict Clippy remain blocked by unrelated concurrent/out-of-scope edits; the exact failures are retained in `COMMANDS.md`.
