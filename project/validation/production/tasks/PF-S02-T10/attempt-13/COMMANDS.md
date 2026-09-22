# PF-S02-T10 attempt 13 — commands and results

All commands were run from:

`/Users/cybertron/Code/boreal-work`

| Command | Result |
|---|---|
| `cargo test --locked -p boreal-store --test production_identity_audit_boundary` | Passed: 3 tests, 0 failed. |
| `cargo fmt --all` | Passed; formatted the in-scope fixture. |
| `cargo fmt --all -- --check` | Passed. |
| `git diff --check -- crates/store/tests/production_identity_audit_boundary.rs` | Passed. |
| `cargo test --locked -p boreal-store` | Passed: all store tests; one release benchmark remains intentionally ignored. |

Focused tests:

- `unbound_canonical_production_rejects_consequential_operation_writes` —
  passed.
- `bound_canonical_production_replay_returns_the_original_outcome` — passed
  after the fixture installed a controlled database identity and actor row.
- `initialization_audits_creation_replays_exactly_and_treats_existing_project_as_readback` — passed.

