# PF-S02-T10 attempt 3 — evidence

## Bounded implementation

- `crates/store/src/identity.rs:617-624` adds a crate-scoped, read-only context preflight that delegates to the existing installed database/project binding verifier.
- `crates/store/src/operations.rs:97-156` keeps terminal/pending outcome rules and, for identity-bound appends, requires audit session and fence identities to match the operation.
- `crates/store/src/operations.rs:179-209` preflights the identity context and operation project before writing, then records the operation identity and redacted audit event inside the caller-owned transaction. Existing `append_in_transaction` remains unchanged.
- `crates/store/tests/production_operation_audit.rs:313-468` adds coverage for missing identity installation, foreign database context, terminal audit requirement, and audit identity mismatch. Existing exact replay and audit rollback coverage remains.

The helper deliberately does not open or commit a nested transaction. The caller owns `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK`, so semantic mutation, operation row, identity row, and audit row remain one rollback boundary when the canonical root adapter handles the returned error correctly.

## Validation results

- Focused operation/audit target: 10 passed, 0 failed.
- Full `boreal-store` package: passed. This includes production identity, migration, operation/audit, recovery, profile, root seam, status, schema, session, storage-remediation, and contract targets.
- Targeted rustfmt check: passed.
- Full workspace formatting gate: not clean because the pre-existing `crates/store/src/profiles.rs` differs from rustfmt. It was not changed in this attempt.
- Strict package clippy: not clean because the pre-existing `crates/store/src/profiles.rs` has unused imports, dead code, and a too-many-arguments diagnostic. It was not changed in this attempt.

## Exact source identity

At the end of the attempt:

```text
7d8d00373dbe94ae29c7bdfe894f1620e8ce49fe3f5214dbb3df20c49675a9ca  crates/store/src/operations.rs
2d0c5dc1223dca491621bd5bc49121f16f45a4362d864c9a8c72f38453f22fa0  crates/store/src/identity.rs
600ba5721cb823df2327a69c3e7ab5c9398f4d68e2a30f8d28546acde57daa70  crates/store/tests/production_operation_audit.rs
```

## Scope and limitations

This is a bounded helper, not PF-S02-T10 acceptance. It does not wire the approximately 22 legacy root operation call sites, add an ordered schema migration, install identity at every production opener, or integrate recovery/external-job persistence. Those remain coordinator-owned integration work and are called out in `HANDOFF.md`.
