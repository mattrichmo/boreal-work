# PF-S02-T07 — Attempt 1 start

- Task: `PF-S02-T07` — persist command registration, outcomes and audit atomically.
- Plan: PF production-completion plan v1.
- Started: 2026-09-22 America/Regina.
- Repository: `/Users/cybertron/Code/boreal-work`.
- Input revision: `codex/apply-responsive-terminal-overlay`, HEAD `784a41b3802c29a76721c55eef2e9493283396c2`; worktree is dirty and all existing changes/evidence are preserved.
- Worker scope: only `crates/store/src/operations.rs`, `crates/store/src/audit.rs`, `crates/store/tests/production_operation_audit.rs`, and this attempt directory.
- Shared integration request: `crates/store/src/lib.rs` may require coordinator registration for the audit module; this worker will not edit it.

## Prerequisites and context

- PF-S01-T92 is accepted in the coordinator ledger.
- PF-S02-T02 attempt 4 is accepted as a bounded store-seam leaf; it establishes the non-owning transaction seam and the registered `operations` module.
- PF-S02-T03 attempt 4 is accepted as a bounded identity/revision leaf; its explicit limitation that production identity mutation call sites remain unwired is preserved.
- The authoritative production contract is `project/spec/production/contract-manifest.json` at the dispatched dirty source identity.

## Interpreted invariant

One logical operation ID is bound immutably to its project, actor, command, target context, request digest, and database epoch when available. A retry with the same identity returns the original durable outcome; any changed payload, actor, project, or epoch is rejected. A canonical mutation, terminal/pending outcome, and attributable audit event must be committed together by the caller-owned transaction. If the outcome or audit row cannot be persisted, the transaction must roll back and must not acknowledge the canonical mutation. Audit detail is bounded and redaction-safe.

## Baseline observed before edits

- `crates/store/src/operations.rs` exposes `OperationBundle` and `OperationJournal::append_in_transaction`, but validation only checks non-empty project/operation/request identity and project/operation pairing for an optional audit row.
- `crates/store/src/lib.rs` contains root `append_operation`, `append_audit_event`, operation readback, and the existing operation schema. These shared methods are read-only for this attempt.
- `crates/store/src/audit.rs` and `crates/store/tests/production_operation_audit.rs` were absent at start.
- Existing root callers persist JSON result/audit payloads without a task-local bounded redaction helper; existing behavior and tests are retained.

## Verification strategy

- Add focused real-SQLite tests for exact replay, changed identity rejection, pending/unknown versus terminal outcomes, transaction rollback when audit insertion fails, rejected-operation no-mutation behavior, bounded/redacted audit details, and bounded project-scoped readback.
- Run `cargo fmt --all -- --check` (record unrelated failures without changing outside paths), `cargo test --locked -p boreal-store --test production_operation_audit`, `cargo test --locked -p boreal-store`, `cargo clippy --locked -p boreal-store --all-targets -- -D warnings`, `git diff --check`, and contract validation where possible.
- No real service/lifecycle/release acceptance claim will be made by this bounded store test.

## Limitations to preserve

- `crates/store/src/lib.rs` remains a shared protected file and is not edited here. Audit-module registration, if needed, is an integration request.
- Existing root mutation call sites are not rewritten in this attempt; their exact integration and database-epoch binding remain coordinator follow-up work.
- This attempt cannot certify PF-S02, AC-12, real crash/restart behavior, service-backed mutation, or release readiness.
