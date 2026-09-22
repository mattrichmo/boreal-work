# PF-S02-T10 attempt 11 — commands and results

All commands below were run against the same dirty working tree identified in
`START.md`. No command changed source, the plan ledger, or a manifest.

| Check | Result |
|---|---|
| `cargo fmt --all -- --check` | PASS |
| `cargo test --locked -p boreal-store` | PASS — 129 tests passed; 1 release benchmark intentionally ignored |
| `cargo test --locked -p boreal-store --test production_migrations` | PASS — 16/16 |
| `cargo test --locked -p boreal-store --test production_profile_requirements` | PASS — 9/9 |
| `cargo test --locked -p boreal-store --test production_recovery_records` | PASS — 7/7 |
| `cargo test --locked -p boreal-store --test production_operation_audit` | PASS — 15/15 |
| `cargo test --locked -p boreal-store --test production_store_seams` | PASS — 5/5 |
| `cargo test --locked -p boreal-store --test store_contracts` | PASS — 24/24 |
| `python3 tools/plan.py validate` | PASS — 22 sprints, 268 tasks, 35 accepted top-level tasks; planning validation only |
| `python3 tools/plan.py verify-package` | PASS — 447 files, no manifest mismatches |
| `git diff --check` | PASS |
| `cargo clippy --locked -p boreal-store --all-targets --all-features -- -D warnings` | BLOCKED — existing `clippy::too_many_arguments` at `crates/store/src/profiles.rs:505` |
| `cargo test --locked -p boreal-store --test production_integration` | NOT RUN — the proposed target does not exist in the current tree |

The source tree has no `boreal.yaml`, so the audit skill's live workflow
resolution command could not be performed. This review therefore remains a
source-and-test review, not a live project audit.

Not run and not claimed: genuine service-backed lifecycle validation,
application/CLI integration validation, production-prefix installation,
macOS/BSD-tar or supported-Linux release smoke tests, and publication.

