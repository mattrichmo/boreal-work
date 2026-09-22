# PF-S02-T10 attempt 3 — bounded operation/audit identity helper

- Started: 2026-09-22
- Scope: add and validate a transaction-safe operation/audit identity bundle helper.
- Allowed source changes: `crates/store/src/operations.rs`, `crates/store/src/identity.rs` if required, and focused tests in `crates/store/tests/production_operation_audit.rs`.
- Explicitly out of scope: wiring every legacy root mutation call site, plan state/manifest edits, schema redesign, service/API changes, and unrelated cleanup.
- Acceptance boundary: preserve existing APIs/tests; reject missing identity context and missing terminal audit; keep operation, identity, audit, and caller-owned mutation rollback-coupled.

This attempt must not be treated as full PF-S02-T10 completion. The handoff will identify the canonical root call-site wiring and ordered migration work that remains.
