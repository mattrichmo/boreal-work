# PF-S02-T11 attempt-19 commands

Working directory: `/Users/cybertron/Code/boreal-work`

| Command | Result |
|---|---|
| `cargo check --locked -p boreal-cli` | PASS |
| `cargo test --locked -p boreal-cli` | PASS — 78 unit tests and all package integration targets; 0 failed |
| `cargo test --locked -p boreal-cli update::tests` | PASS — 9 focused update tests |
| `cargo fmt --all -- --check` | PASS |
| `git diff --check -- crates/cli/src/main.rs crates/cli/src/service.rs` | PASS |
| `env LC_ALL=C LANG=C shasum -a 256 crates/cli/src/main.rs crates/cli/src/service.rs` | PASS; hashes recorded in `HANDOFF.md` and `EVIDENCE.md` |

No commit or push was performed. `bwrk workflows show` was unavailable in the
installed workflow command surface during initial guidance inspection; this
did not alter the source or validation scope.
