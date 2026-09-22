# Commands — PF-S02-T10 attempt 15

All commands were run from `/Users/cybertron/Code/boreal-work` against the
current working tree. No source, ledger, manifest, or prior evidence files were
edited by this review.

## Required commands

### Focused identity/audit test

```text
$ cargo test --locked -p boreal-store --test production_identity_audit_boundary
exit=0
3 passed; 0 failed
```

Passed tests:

- `bound_canonical_production_replay_returns_the_original_outcome`
- `initialization_audits_creation_replays_exactly_and_treats_existing_project_as_readback`
- `unbound_canonical_production_rejects_consequential_operation_writes`

### Full store package

```text
$ cargo test --locked -p boreal-store
exit=0
```

The package completed successfully. This included the persistent migration and
identity suites, operation/audit, recovery, profile requirements, schema,
runtime backup, status, session, storage-remediation, and store-contract tests.
The summary was 0 failed tests; one release benchmark remains intentionally
ignored because its dedicated release runner invokes it explicitly.

### Formatting

```text
$ cargo fmt --all -- --check
exit=0
```

### Diff check

```text
$ git diff --check
exit=0
```

## Inspections

The corrected fixture was inspected at
`crates/store/tests/production_identity_audit_boundary.rs`. It installs a
controlled `DatabaseIdentity` before calling `bind_project`; the production
path is not changed by that fixture setup.

The canonical production-open identity boundary was inspected in
`crates/store/src/lib.rs`, and persistent coverage was inspected in
`crates/store/tests/production_migrations.rs` and
`crates/store/tests/production_identity_revisions.rs`.

