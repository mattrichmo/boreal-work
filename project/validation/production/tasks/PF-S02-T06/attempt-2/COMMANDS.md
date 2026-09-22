# PF-S02-T06 — independent review attempt 2 commands

All commands ran from `/Users/cybertron/Code/boreal-work` against the exact
dirty combined tree at HEAD `784a41b3802c29a76721c55eef2e9493283396c2`.

## Required executable checks

| Command | Result |
| --- | --- |
| `cargo fmt --all -- --check` | Exit 0 |
| `cargo test --locked -p boreal-store --test production_recovery_records` | Exit 0; 5 passed, 0 failed |
| `cargo test --locked -p boreal-store` | Exit 0; all store targets passed; one pre-existing release benchmark remained intentionally ignored |
| `cargo clippy --locked -p boreal-store --all-targets -- -D warnings` | Exit 0 |
| `cargo test --locked -p boreal-store --test production_migrations` | Exit 0; 16 passed, 0 failed |
| `python3 project/spec/validate_contracts.py` | Exit 0; protocol, guidance, workflow, transition, clock/dependency, conformance, and SQLite checks passed |
| `git diff --check` | Exit 0 |

## Source and call-site inspection

The following search was run exactly against production Rust sources:

```sh
rg -n "register_external_job|advance_external_job|mark_external_job_readback_required|create_recovery_obligation|resolve_recovery_obligation|reserve_resource|request_resource_release|acknowledge_resource_release" \
  crates/application crates/cli crates/store/src/lib.rs --glob '*.rs'
```

Result: no matches. The only matches for these APIs are their definitions in
`crates/store/src/recovery.rs` and `crates/store/src/jobs.rs`, plus the focused
worker test target.

The focused test setup was also inspected. It opens `schema-v2.sql` through
`open_in_memory`, then directly calls
`recovery::ensure_recovery_schema(&store)` and
`jobs::ensure_external_job_schema(&store)` before exercising the APIs. It does
not exercise the canonical production opener or a production lifecycle adapter.

## Toolchain

- `rustc 1.85.0 (4d91de4e4 2025-02-17) (Homebrew)`
- `cargo 1.85.0`
- `Python 3.14.3`

## Current source hashes

```text
b9febd62257e36c1ae691fcf76e1610dcbce2efc606c0bb8d83d69f1c4cb7420  crates/store/src/lib.rs
8ac85345aa306d1e65888afbf9e409df4d3a843d5a5f6456fa30e51081e1191a  crates/store/src/recovery.rs
6842104b80d704f7dcd05dc380a789c83d81150373342db4dd3b020935aabb47  crates/store/src/jobs.rs
2a7f43722c61a9f3e9ec73fe5d7737d2db2b6facffd0307d9322a6b90acf5191  crates/store/tests/production_recovery_records.rs
e0cb48341c2e59abc63524514ee0ad226db2d63027d176f64eaf2d53d569869b  crates/store/src/migrations.rs
3fd0d323955cf4d52ec06cf366fdf7abe47ac0a27b4ac2768492b5835095e1cf  project/spec/schema-production.sql
```

No live database, external process, service mutation, release artifact, or
credential was used.
