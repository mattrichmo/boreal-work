# PF-S02-T11 attempt 16 — evidence

## Implementation

`crates/application/src/runtime.rs` now provides application-level,
identity-bound entry points for:

- resolving a terminal recovery obligation;
- requesting physical resource release; and
- acknowledging the exact pending resource release.

Each entry point constructs `AttemptRecoveryAdapter::new_with_identity`, so
the store revalidates the database lineage and project binding before the
mutation. The release request remains `release_pending`; only the subsequent
acknowledgement can make the canonical reservation reusable. The legacy
unbound `resolve` path rejects `resource_state = "released"` before it can
mutate storage.

The application runtime tests cover:

- identity-bound recovery resolution and exact operation replay;
- foreign-project rejection through the bound identity context;
- unbound `released` recovery rejection;
- identity-bound release request;
- idempotent resource acknowledgement; and
- foreign-project rejection for resource acknowledgement.

The external-job test's explicit non-`Drop` adapter drops were replaced by a
lexical scope so strict all-target application Clippy is clean without
changing the replay or readback assertions.

## Source identity

SHA-256 after validation:

```text
a818b07c1e118f50dbe84edb0e4cc5d0c35ebc7fdd3d58fc106c9f09e8dc8e74  crates/application/src/runtime.rs
ddfbe915bb95a6150905d9cbd899db26ee94a7a187e186ba4d4a9c2f0f7b4ccb  crates/application/tests/production_external_jobs.rs
```

These hashes identify the files in the combined dirty tree, not an accepted
commit. The test file also contains earlier PF-S02-T11 combined-tree changes;
the steward's local lint repair is intentionally limited to its restart-test
adapter lifetime scope.

## Validation conclusion

The attempt-21R application Clippy blocker is resolved without a dead-code
allow and without weakening identity, replay, project isolation, or resource
acknowledgement semantics. This is evidence for the bounded application
surface only; it is not acceptance of PF-S02-T11 or the production release.

