# PF-S02-T01 — Attempt 1 command record

Workspace: `/Users/cybertron/Code/boreal-work`  
Started: 2026-09-22 (America/Regina)  
Source: `HEAD 784a41b3802c29a76721c55eef2e9493283396c2` (dirty worktree)

The required startup documents, sprint/task card, accepted PF-S01-T92
handoff/gate, production contract manifest, and referenced schema/migration
context were read before implementation. No plan/state/shared source file was
edited.

## Commands and outcomes

| Command | Exit | Outcome |
|---|---:|---|
| `bwrk prime --json` | 2 | Rejected: `invalid_argument`, missing project identifier. No state change. |
| `bwrk workflows show boreal.workflow.claim-and-finish-work.v1 --json` | 6 | Busy: direct offline mode could not acquire the existing database owner for `/Users/cybertron/Code/boreal-work/.boreal/boreal.sqlite`; no state change. The other resolved workflow definitions were likewise busy. |
| `rustfmt --edition 2021 crates/store/src/migrations.rs crates/store/tests/production_migrations.rs` | 0 | Formatted only the two assigned source paths. |
| `rustfmt --edition 2021 --check crates/store/src/migrations.rs crates/store/tests/production_migrations.rs` | 0 | Assigned paths pass formatting. |
| `cargo fmt --all -- --check` | 1 | Blocked by an unrelated existing formatting diff in `crates/domain/tests/production_decision_inputs.rs`; no workspace-wide formatting write was performed. |
| `cargo test --locked -p boreal-store --test production_migrations` | 0 | 9 migration tests passed, 0 failed. The direct test adapter emitted only dead-code warnings for private state conversion helpers. |
| `cargo test --locked -p boreal-store` | 0 | Store package tests passed: existing store suites plus 9 migration tests; one pre-existing release benchmark remains ignored by its test annotation. |
| `git diff --check` | 0 | No whitespace errors. |
| `git rev-parse HEAD` | 0 | `784a41b3802c29a76721c55eef2e9493283396c2`. |
| `rustc --version` | 0 | `rustc 1.85.0 (4d91de4e4 2025-02-17) (Homebrew)`. |
| `cargo --version` | 0 | `cargo 1.85.0`. |
| `shasum -a 256 ...` | 9 | Host locale failure; replaced with the successful `sha256sum` check below. |
| `sha256sum crates/store/src/migrations.rs crates/store/tests/production_migrations.rs project/validation/production/tasks/PF-S02-T01/attempt-1/START.md` | 0 | Hashes recorded in `EVIDENCE.md`. |

No runtime, release, process-kill, service-concurrency, or production-database
evidence was fabricated. The focused test target includes a raw SQLite test
backend because coordinator-owned `crates/store/src/lib.rs` registration was
outside this attempt's write set.
