# PF-S03-T10 attempt 10 — commands

Working directory: `/Users/cybertron/Code/boreal-work`

| Command | Result |
| --- | --- |
| `cargo fmt --all -- --check` | pass |
| `cargo test --locked -p boreal-domain --test production_t10_oracle` | pass: 4 tests |
| `cargo clippy --locked -p boreal-domain --test production_t10_oracle -- -D warnings` | pass |
| `cargo clippy --locked -p boreal-domain --all-targets -- -D warnings` | pass |
| `cargo test --locked -p boreal-domain` | failed before overall completion: existing `production_properties::oracle_identity_and_minimal_counterexample_replay_are_explicit` expects source `3017a1db...`, while current HEAD is `5584d461...`; the new target and 22/23 tests in that target passed |
| `git diff --check` | pass |

Tool versions:

```text
cargo 1.85.0
rustc 1.85.0 (4d91de4e4 2025-02-17) (Homebrew)
```

No production binary, service, database, external verifier, or release check
was run. No commit or push was performed by this attempt.
