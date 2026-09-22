# PF-S02-T07 — Attempt 1 evidence

## Disposition

**Implementation ready for independent review, not self-accepted.** The
focused store evidence passes on the dirty combined tree. The task still
requires shared-root integration and independent review before acceptance.

## Implemented invariant

The new operation seam binds one operation ID to immutable project, command,
actor/session, revision, attempt/fence and request-digest fields. The existing
identity store binds the operation row to the current database instance and
restore epoch inside the same caller-owned transaction. Exact replay returns
the original row. Changed actor, request digest, project/epoch context, or
subject is rejected before a second result can be treated as the original
operation.

Terminal outcomes require `completed_at` and an audit event. `busy` and
`unknown` are represented as non-terminal outcomes and may remain unresolved.
The strict identity-bound append path writes operation, identity context and
redacted audit event without opening a nested transaction; its caller owns the
commit/rollback boundary. Audit failure therefore rolls back the operation and
identity record in the tested path.

Audit payloads must be valid JSON, redact credential-like keys, truncate long
strings, limit arrays, and replace oversized payloads with a bounded marker.

## Focused test results

`cargo test --locked -p boreal-store --test production_operation_audit`

```text
running 6 tests
test audit_failure_rolls_back_operation_and_identity ... ok
test pending_unknown_is_distinct_from_terminal_outcomes ... ok
test malformed_audit_payload_is_rejected_before_durable_write ... ok
test changed_actor_payload_or_subject_cannot_reuse_operation_id ... ok
test rejected_operation_requires_audit_and_does_not_mutate_target ... ok
test commit_before_response_replays_one_operation_and_audit ... ok

test result: ok. 6 passed; 0 failed
```

The commit-before-response test also advances the database restore epoch and
confirms the old operation context is rejected. The audit assertion confirms
the stored payload contains `[REDACTED]` rather than the supplied token.

## Changed source identity

```text
58168f0b7b423b0eb45d72e13cf1ac03b8d631fe9027848ae75af86e7835e686  crates/store/src/operations.rs
8f5edcae4503a174f1b1477b667ac33cfe50a8e5cf72d4ea8fb383e6d567ea9a  crates/store/src/audit.rs
463634437c19d2a3f171187293388ffa653b0f0a2f2e968e65bd45294b523fa1  crates/store/tests/production_operation_audit.rs
```

## Scope and evidence limits

- This is real SQLite store evidence, not a service-backed lifecycle or
  release result.
- The worker did not modify protected `crates/store/src/lib.rs`; existing root
  mutations still call older append helpers until the coordinator applies the
  integration request.
- The strict API uses the already implemented `IdentityStore` epoch table,
  but canonical production-open installation and all root mutation call sites
  still need coordinator wiring.
- `cargo test --locked -p boreal-store` remains blocked by the unrelated,
  unregistered recovery/jobs test surface; that failure is retained and not
  normalized.
