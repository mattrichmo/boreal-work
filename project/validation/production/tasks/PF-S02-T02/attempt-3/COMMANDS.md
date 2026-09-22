# PF-S02-T02 — Attempt 3 command record

Workspace: `/Users/cybertron/Code/boreal-work`  
Date: `2026-09-22` (America/Regina)  
`HEAD`: `784a41b3802c29a76721c55eef2e9493283396c2` (dirty worktree)  
Toolchain: `rustc 1.85.0 (4d91de4e4 2025-02-17) (Homebrew)`, `cargo 1.85.0`

## Baseline and preserved history

Attempt-2 recorded the focused target and full package passing against the
prior seam implementation, then rejected the owner/export contract. Its
records remain in `attempt-2/`; no failed history was overwritten.

## Corrective implementation checks

All commands below ran from `/Users/cybertron/Code/boreal-work` on the final
attempt-3 source. The root `crates/store/src/lib.rs` was not edited.

| Command | Exit | Result |
| --- | ---: | --- |
| `cargo fmt --all -- --check` | 0 | Passed. |
| `rustfmt --edition 2021 --check crates/store/src/transactions.rs crates/store/tests/production_store_seams.rs` | 0 | Both exclusive production files passed. |
| `cargo check --locked -p boreal-store` | 0 | Passed; the existing `MigrationState::as_sql`/`parse` dead-code warning at `crates/store/src/migrations.rs:143-151` remains. |
| `cargo test --locked -p boreal-store --test production_store_seams` | 0 | 5 passed, 0 failed, 0 ignored. The target used qualified public module exports and the real SQLite root mutation. |
| `cargo test --locked -p boreal-store` | 0 | 92 passed, 1 intentionally ignored release benchmark, 0 failed; doc-tests 0/0. |
| `python3 project/spec/validate_contracts.py` | 0 | Passed: 8 protocol envelopes, 11 guidance fixtures, 10 workflow assets, 18 legal/15 illegal transition vectors, 19 clock/dependency cases, 52 conformance mappings, SQLite schema parsed. |
| `git diff --check` | 0 | Passed. |
| `rustfmt --edition 2021 --check crates/store/src/transactions.rs crates/store/tests/production_store_seams.rs` | 0 | Repeated final exclusive-file format check passed. |

## Structural regression probes

| Probe | Exit | Result |
| --- | ---: | --- |
| Negative scan for `execute_batch`, `ProjectWrite`, `RevisionExpectation`, `with_project_write`, `with_write_transaction`, and `pub fn store` in `transactions.rs` | 0 | No transaction-owner or raw-store symbols remain. |
| Negative scan for `#[path]` and local seam module declarations in `production_store_seams.rs` | 0 | No test-local seam mounts remain. |

An earlier exploratory grep returned exit 1 because the documentation
comments intentionally mention `BEGIN`/`COMMIT`/`ROLLBACK`; it was replaced by
the symbol-specific negative scan above, which passed. This was a probe
artifact, not a test or implementation failure.

## Boreal workflow probe limitation

`bwrk prime --json` first rejected the missing project identifier. The explicit
`bwrk prime --project boreal-work --json` then returned `service_busy` because
the database owner was `process:68913`; workflow show probes had the same
owner-busy result. No state-changing command was run and no live lock was
broken.

## Final source hashes

Generated with `openssl dgst -sha256` after the final implementation checks:

| Path | SHA-256 |
| --- | --- |
| `crates/store/src/transactions.rs` | `d155e88e1de5b7b6b37cae660a1d4005d2c8579199d1d1ea8aa0b5b9ef0bc628` |
| `crates/store/tests/production_store_seams.rs` | `76f210e0fb1bc8f5a8b53354e253a1cd19e082ca0d06a74d8d01e87fddc91554` |
| `crates/store/src/lib.rs` | `f3efd3db72cae5250c1b5a7b6a9d2f8c03abbc28e0c01a63b5821977cfb0ffb6` |
| `project/spec/production/contract-manifest.json` | `131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa1` |

The current root hash is unchanged from the attempt-2 review identity.
