# PF-S03-T10 attempt 3 commands

All commands ran from `/Users/cybertron/Code/boreal-work` against the exact
dirty combined tree. No source or plan files were edited during review.

| Command | Result |
| --- | --- |
| `cargo test --locked -p boreal-domain --test production_properties` | PASS — 13 passed, 0 failed |
| `cargo test --locked -p boreal-domain` | PASS — full domain suite passed, including 124 tests in the retained summary |
| `cargo clippy --locked -p boreal-domain --all-targets -- -D warnings` | PASS |
| `cargo fmt --all -- --check` | PASS |
| `python3 project/spec/validate_contracts.py` | PASS — 8 protocol envelopes, 11 guidance fixtures, 10 workflow assets, 18 legal/15 illegal transition vectors, 19 clock/dependency cases, 52 mappings, SQLite schema parsed |
| `git diff --check` | PASS |

Environment:

- `cargo 1.85.0`
- `rustc 1.85.0 (4d91de4e4 2025-02-17) (Homebrew)`
- HEAD: `784a41b3802c29a76721c55eef2e9493283396c2`

These are pure-domain/static checks. They do not establish service, store,
authenticated mutation, genuine verifier, native, installer, or release gates.
