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

The current combined external-job test tree already uses lexical adapter
scopes, so strict all-target application Clippy remains clean without an
attempt-16 change to that test file.

## Source identity

SHA-256 after validation:

```text
f0b30ecb26d3ad0ac373ce5de0559006a04ae92d5ea663ac3a95862e9e9951be  crates/application/src/runtime.rs
```

This hash identifies the runtime file in the combined dirty tree, not an
accepted commit. The runtime file includes the identity-bound façade and its
focused tests; other application/store changes remain combined-tree work.

## Validation conclusion

The attempt-21R application Clippy blocker is resolved without a dead-code
allow and without weakening identity, replay, project isolation, or resource
acknowledgement semantics. This is evidence for the bounded application
surface only; it is not acceptance of PF-S02-T11 or the production release.
