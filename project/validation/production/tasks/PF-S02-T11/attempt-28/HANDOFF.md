# PF-S02-T11 attempt-28 bounded handoff

This attempt found and partially implemented a viable identity-bound API
shape, but is not ready for review or acceptance because the CLI does not yet
compile.

## Source-bound result

The application boundary is `AuthenticatedOperationJournal<'a>` in
`crates/application/src/operation_identity.rs`, constructed through
`WorkApplication::authenticated_operation_journal`. It requires an existing
`IdentityContext`; there is no unbound fallback. The intended next patch is
strictly bounded to the two reported compiler errors, followed by the
requested application/CLI tests and negative replay/readback checks.

## Current state

- Application crate: compiles under the focused check.
- CLI crate: blocked by the two errors recorded in `EVIDENCE.md`.
- Tests: not run after these edits.
- Commit/push: none.
- Plan/state: untouched.

## Exact next safe action

Fix only the `map_err` type at `crates/cli/src/main.rs:5941` and bind the
`WorkApplication` local at `crates/cli/src/service.rs:3553`, then rerun the
focused check before any broader validation. Preserve the four-file write set
and do not modify store/schema, memory, update, verifier, plan, or state files.
