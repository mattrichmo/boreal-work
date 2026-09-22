# PF-S03-T04 attempt 3 — commands and results

Workspace for every command: `/Users/cybertron/Code/boreal-work`.
Review date: `2026-09-22`. Input HEAD: `784a41b3802c29a76721c55eef2e9493283396c2`.
Branch: `codex/apply-responsive-terminal-overlay`.

## Verification commands

| Command | Exit | Result |
| --- | ---: | --- |
| `cargo fmt --all -- --check` | `0` | Passed; workspace formatting is clean. |
| `cargo check --locked -p boreal-domain --tests` | `0` | Passed; domain library and all test targets compiled. |
| `cargo test --locked -p boreal-domain --test production_acceptance_policy` | `0` | Passed; `12 passed, 0 failed, 0 ignored`. |
| `cargo test --locked -p boreal-domain` | `0` | Passed; `73 passed, 0 failed, 0 ignored`; `0` doc tests. |
| `cargo clippy --locked -p boreal-domain --test production_acceptance_policy -- -D warnings` | `0` | Passed with warnings denied. |
| `cargo clippy --locked -p boreal-domain --lib -- -D warnings` | `0` | Passed with warnings denied. |
| `git diff --check` | `0` | Passed; no whitespace errors in the tracked diff. |

The full domain count is 15 unit tests, 4 hierarchy tests, 15 M02 status
tests, 12 acceptance-policy tests, 10 decision-input tests, 8 production
status-precedence tests, 9 work-model tests, and 0 doc tests.

## Environment and source identities

- `rustc --version`: `rustc 1.85.0 (4d91de4e4 2025-02-17) (Homebrew)`.
- `cargo --version`: `cargo 1.85.0`.
- `crates/domain/src/acceptance.rs`: SHA-256 `6680f089ef262923359ea90c4c99a99b7db7147465d14160d154fe37a4ece4c4`.
- `crates/domain/tests/production_acceptance_policy.rs`: SHA-256 `78198ba00a7d712e970bf110d32c60ed77d856836ab4ca4e1bca651f72913c10`.
- `crates/domain/src/lib.rs`: SHA-256 `6f75fcd37496dbff5bc0d5a51b593696781f47818a44edffcd8617d6ef4f78b2` (unchanged).
- `project/spec/production/acceptance-and-proof.md`: SHA-256 `da4c7796a801c185f33f0f309d82bc1a1a0f3aaa8ee6b3d546f49f7674714245`.
- `project/spec/production/contract-manifest.json`: SHA-256 `131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa1`.

The repository had unrelated pre-existing dirty paths before this attempt;
they were not edited. No service, lifecycle, native, publication, release, or
coordinator mutation command was run.
