# PF-S03-T09 attempt 1 — start record

Worker scope: bounded domain decision/action integration contract tests.

Input source:

- Git `HEAD`: `3017a1dbebaa7945f82b2a2512ec0c1eabbd69c9`
- Working tree was dirty before this attempt. Existing coordinator changes in
  `crates/cli`, `crates/store`, `STATE.json`, PF-S03-T08 evidence and the
  untracked `memory/` directory were preserved and not edited.

Granted write paths:

- `crates/domain/tests/production_domain_api.rs`
- `project/validation/production/domain/api-handoff.md`
- `project/validation/production/tasks/PF-S03-T09/attempt-1/`

Protected paths not edited:

- `crates/domain/src/lib.rs`
- domain production implementation files
- application, store, service, protocol and TUI policy paths
- `STATE.json`, plan/ledger files and `memory/`

Invariant: action descriptors must be derived from the same typed status,
reason, revision and authority context as the domain decision; adapters must
not infer authority from display labels. The R7 mismatch is retained as an
ignored executable witness and a coordinator integration request.

Disposition requested: `awaiting_integration`.
