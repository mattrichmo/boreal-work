# PF-S02-T11 attempt-28 bounded evidence

Status: blocked at compile integration; not acceptance evidence.

## Safe API implemented so far

`crates/application/src/operation_identity.rs` now contains the typed
`AuthenticatedOperationJournal<'a>`, requiring both a store reference and an
authenticated `boreal_store::identity::IdentityContext`. It exposes
identity-bound `append` and contextual `readback` only. The wrapper rejects a
project mismatch before delegating to the store journal.

`WorkApplication::authenticated_operation_journal` is re-exported from
`crates/application/src/lib.rs`.

The CLI changes route the finish parent append and service `agent_start`
append/readback through this application wrapper. The previous unbound
`ServiceCommandHandler::start` lookup via `store.operation(operation)` was
removed. Both paths require `IdentityStore::context(project)` and therefore
fail closed when the project identity binding is unavailable.

## Exact source files touched by this attempt

- `crates/application/src/lib.rs`
- `crates/application/src/operation_identity.rs`
- `crates/cli/src/main.rs`
- `crates/cli/src/service.rs`

These files were already dirty before attempt-28; their full worktree diffs
include pre-existing changes from earlier attempts. No forbidden store,
schema, memory, update, verifier, plan, or state files were edited by this
attempt.

## Current compiler blockers

`cargo check --locked -p boreal-application -p boreal-cli` compiled the
application crate and failed the CLI crate with:

- `crates/cli/src/main.rs:5941`: `AuthenticatedOperationJournal::append`
  returns `ApplicationError`, but the call still uses `map_err(map_store_error)`;
  use the application error mapper at this boundary.
- `crates/cli/src/service.rs:3553`: a temporary `WorkApplication::new(...)`
  is dropped while the returned journal still borrows it; bind the application
  value before constructing the journal.

No targeted tests, strict Clippy, or final format/diff validation are claimed.
