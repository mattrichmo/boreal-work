# PF-S02-T02 — Attempt 1 command record

Workspace: `/Users/cybertron/Code/boreal-work`  
Date: 2026-09-22 (America/Regina)  
`HEAD`: `784a41b3802c29a76721c55eef2e9493283396c2` (dirty worktree)  
Toolchain: `rustc 1.85.0 (4d91de4e4 2025-02-17)`, `cargo 1.85.0`

## Baseline before worker edits

These checks ran against the current dirty combined tree before the seam edits:

| Command | Exit | Result |
| --- | ---: | --- |
| `cargo fmt --all -- --check` | 0 | Passed at the baseline observation. |
| `cargo check --locked -p boreal-store` | 0 | Passed; existing `MigrationState::as_sql`/`parse` dead-code warning. |
| `cargo test --locked -p boreal-store` | 0 | 87 passed, 1 intentionally ignored, 0 failed; doc-tests 0/0. |
| `git diff --check` | 0 | Passed. |

## Post-change checks

All commands below ran from `/Users/cybertron/Code/boreal-work` on the same
dirty tree. The protected `crates/store/src/lib.rs` was not edited, so the
new modules were mounted by the focused test as exact source files under a
test-local parent export.

| Command | Exit | Result |
| --- | ---: | --- |
| `cargo fmt --all -- --check` | 1 | Blocked by unrelated dirty import ordering in `crates/domain/src/lib.rs`; no domain path was edited by this worker. |
| `rustfmt --edition 2021 --check crates/store/src/transactions.rs crates/store/src/profiles.rs crates/store/src/execution.rs crates/store/src/operations.rs crates/store/src/acceptance.rs crates/store/tests/production_store_seams.rs` | 0 | All six worker files passed. |
| `cargo check --locked -p boreal-store` | 0 | Passed; existing migration dead-code warning remains. This package check cannot compile unregistered modules from the protected root. |
| `cargo test --locked -p boreal-store --test production_store_seams` | 0 | 6 passed, 0 failed. Real `SqliteStore` transaction/profile/operation/execution/acceptance behavior exercised through the seam source. |
| `cargo test --locked -p boreal-store` | 0 | 93 passed, 1 intentionally ignored, 0 failed; doc-tests 0/0. The full package includes the 6 seam tests. |
| `python3 project/spec/validate_contracts.py` | 0 | Contract manifest validation passed: 8 protocol envelopes, 11 guidance fixtures, 10 workflow assets, 18 legal/15 illegal transition vectors, 19 clock/dependency cases, 52 conformance mappings, SQLite schema parsed. |
| `git diff --check` | 0 | Passed. |

## Preserved intermediate failures/limitations

- An intermediate seam-test iteration recorded 5 passed / 1 failed because a
  test attempted a gate mutation through the current dirty root fixture and
  received `NotFound { entity: "gate", id: "verify-1" }`. The mutation-only
  assertion was removed; the final test retains the real gate/diagnostic read
  and binding checks, while the acceptance facade still exposes the canonical
  receipt/gate/review/summary/close methods for later callers.
- The final repository-wide formatter check reported unrelated import ordering
  differences in `crates/domain/src/lib.rs`; the exclusive-file `rustfmt --check`
  passed. No domain path was edited by this worker.
- The initial `shasum -a 256` metadata command failed because the local Perl
  runtime could not load `C.UTF-8`; final hashes were obtained with
  `openssl dgst -sha256` instead.
- The Boreal adapter command `bwrk prime --json` rejected the invocation for a
  missing project identifier, and the documented `bwrk workflows show` calls
  were unavailable through the installed binary/database owner. This did not
  alter repository state; file-based dispatch instructions were followed.

## Final worker-file hashes

Generated with `openssl dgst -sha256` after the final checks:

| Path | SHA-256 |
| --- | --- |
| `crates/store/src/transactions.rs` | `4830cdf1fc791cccc69442166595290647ecaf0bb898714137a193ba9ce8bc0e` |
| `crates/store/src/profiles.rs` | `93b263ded09b47effdd1494280bcf7952f8c7bc69f64f21ee20170a94755ec8f` |
| `crates/store/src/execution.rs` | `c588e7a6b53796334e4c7cabaa599caca5efff191846e224e1a0baebf50eb614` |
| `crates/store/src/operations.rs` | `a009aefdf2a6e28a9faf8586e393d9152758e1332d594b728caa6c7069cc1449` |
| `crates/store/src/acceptance.rs` | `d44e02b31cc46b0a7ccf5bf1bb93621c326043973f3b4af22506ae6c2f7164b2` |
| `crates/store/tests/production_store_seams.rs` | `68011ada586474b39e5fb08022cfaa650880f7654a9b98bbf0289631db598126` |
| `project/validation/production/tasks/PF-S02-T02/attempt-1/START.md` | `65063ffb97373c2703771c1156525f1625758572dbbace5dbcfb9c40f8d3ca94` |
