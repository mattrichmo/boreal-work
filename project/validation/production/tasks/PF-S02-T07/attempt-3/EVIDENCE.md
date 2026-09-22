# PF-S02-T07 — Attempt 3 evidence

## Disposition

**Ready for independent review as a bounded corrective contribution; the
complete PF-S02-T07 task remains unaccepted.**

## Implemented bounded behavior

- Added `OperationRegistration`, with a caller-owned
  `register_or_replay_in_transaction_with_identity` path. A first request
  returns `Committed`; an exact operation identity returns the original
  `OperationReadback` as `Replayed` without inserting a second outcome or
  audit event.
- Replay compares project, command, actor, session, expected revision,
  attempt, fence, request digest, database identity and restore epoch. The
  requested audit subject and immutable audit metadata must also match the
  original row. Changed digest/actor/subject/epoch inputs fail closed.
- Added `readback_in_context`, which validates the current project/database
  lineage and quarantines operation rows that have no durable identity. An
  execution-only sidecar remains project-scoped for later reconciliation.
- Tightened optional identity/audit field validation, terminal versus
  busy/unknown completion rules, and operation/audit identity consistency.
- Bounded and redacted operation result metadata as well as audit payloads on
  the strict seam and bounded journal readback. Secret-key separator variants,
  oversized arrays, long strings, oversized payloads, and excessive nesting
  are handled without persisting credential-like values.
- Added five regression tests, bringing the focused target to 15 tests. The
  tests cover exact replay, digest conflict, busy/unknown context readback,
  bounded redaction/depth, and invalid optional identity fields in addition to
  the previous atomicity/epoch/subject cases.

## Acceptance checklist disposition

| Requirement | Attempt-3 result |
| --- | --- |
| Crash/commit-before-response readback returns one original outcome and audit event | **Bounded seam demonstrated** by exact replay test; real process crash/service evidence remains outside this attempt. |
| Rejected action records disposition without target mutation | **Bounded seam demonstrated** by existing focused regression; canonical mutation integration remains coordinator work. |
| Operation IDs cannot cross actor/project/epoch/digest boundaries | **Pass for the identity-bound seam**; all specified identity fields are checked and tested. |
| Prerequisites, owner decisions, schema/protocol impact and baseline discrepancy accounted for | **Documented** in the task card, attempts 1–2, coordinator request, and this handoff; root integration is still open. |
| Focused and integration checks on actual combined source | **Pass** for focused target, full store suite, store seams, session registration, format, contract, and plan package checks. Full store clippy remains blocked by an unrelated out-of-scope pre-existing lint. |
| Changes within granted boundary and failed evidence preserved | **Pass**; only the three worker files and attempt-3 evidence were edited/added. |
| Complete handoff and coordinator acceptance | **Not met**; independent review and shared-root integration are still required. |

## Exact source changes

| Path | Change |
| --- | --- |
| `crates/store/src/operations.rs` | Strict identity validation, bounded operation metadata, register-or-replay result, identity-bound readback, audit consistency checks, and redacted audit readback. |
| `crates/store/src/audit.rs` | Bounded recursive redaction with depth/array limits and separator-normalized sensitive-key detection. |
| `crates/store/tests/production_operation_audit.rs` | Five corrective real-SQLite regression tests and registration helper. |
| `project/validation/production/tasks/PF-S02-T07/attempt-3/START.md` | Context, invariant, exact boundary, and limitations. |
| `project/validation/production/tasks/PF-S02-T07/attempt-3/COMMANDS.md` | Tool identity and exact validation commands/results. |
| `project/validation/production/tasks/PF-S02-T07/attempt-3/EVIDENCE.md` | This bounded evidence and acceptance disposition. |
| `project/validation/production/tasks/PF-S02-T07/attempt-3/HANDOFF.md` | Review handoff and remaining integration request. |

## Not claimed

This attempt does not claim:

- that every consequential production mutation invokes the strict seam;
- that `crates/store/src/lib.rs`, application, CLI, or service callers are
  migrated (they are protected shared paths);
- authenticated principal proof, role/delegation enforcement, or service
  transport behavior;
- crash/restart, real external-job, real-service lifecycle, installer, or
  release acceptance;
- acceptance of PF-S02-T07, PF-S02-T90/T91/T92, or any broader sprint gate.
