# PF-S02-T07 — Independent review attempt 2 commands

All commands ran from `/Users/cybertron/Code/boreal-work` against the dirty
combined working tree identified in `START.md`.

| Command | Exit | Result |
| --- | ---: | --- |
| `cargo test --locked -p boreal-store --test production_operation_audit` | 0 | 6 passed, 0 failed |
| `cargo test --locked -p boreal-store` | 0 | All store unit/integration targets passed; 92 tests in the previously recorded full-store baseline plus the current added targets passed, 1 intentional ignore; doc-tests passed |
| `cargo clippy --locked -p boreal-store --all-targets -- -D warnings` | 0 | No warnings |
| `cargo fmt --all -- --check` | 0 | Formatting clean |
| `python3 project/spec/validate_contracts.py` | 0 | Contract validator passed: 8 protocol envelopes, 11 guidance fixtures, 10 workflow assets, 18 legal/15 illegal transition vectors, 19 clock/dependency cases, 52 conformance mappings, SQLite schema parsed |
| `git diff --check` | 0 | No whitespace errors |

## Source inspection commands

The current source inspection found 22 direct `.append_operation(...)`
call sites across `crates/store/src/lib.rs`, `crates/cli/src/service.rs`, and
`crates/cli/src/main.rs`, but only three `OperationJournal`/
`append_in_transaction_with_identity` references, all in the journal module
or its focused tests. No consequential production mutation call site invokes
the identity-bound journal.

Representative current paths inspected:

- `crates/store/src/lib.rs:1746–1833` (`initialize_project`) appends the
  operation and audit rows directly.
- `crates/store/src/lib.rs:3508–3687` (`claim_work_with_context`) performs
  the semantic claim, then calls `append_operation` and
  `append_audit_event` directly without `record_operation_context`.
- `crates/cli/src/service.rs:2492–2587` (`agent_start`) appends a legacy
  operation directly.
- `crates/cli/src/main.rs:5753–5800` (`append_finish_parent_operation`)
  appends directly and does not append the required audit bundle in that
  helper.

The canonical persistent open path does call `IdentityStore::install` for a
new persistent database through `ensure_additive_store_schema` in
`crates/store/src/lib.rs:1460–1538`. This is positive evidence for install
coverage, but it does not repair the production mutation bypasses.

