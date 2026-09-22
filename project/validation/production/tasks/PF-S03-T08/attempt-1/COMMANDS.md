# PF-S03-T08 — attempt 1 commands

All commands ran from `/Users/cybertron/Code/boreal-work` on 2026-09-22 with
`rustc 1.85.0`, `cargo 1.85.0`, and Python `3.14.3`. The source subject was
branch `codex/apply-responsive-terminal-overlay`, `HEAD`
`784a41b3802c29a76721c55eef2e9493283396c2`, dirty.

| Command | Exit | Observed result |
| --- | ---: | --- |
| `cargo test --locked -p boreal-domain --test production_properties` (baseline before creating the target) | 101 | Expected unavailable baseline: Cargo reported no such test target. This failed/unsupported observation is preserved. |
| `rustfmt --edition 2021 crates/domain/tests/production_properties.rs` | 0 | Formatted the owned new test file only. |
| `rustfmt --edition 2021 --check crates/domain/tests/production_properties.rs` | 0 | Owned test file formatted. |
| `cargo fmt --all -- --check` | 0 | Combined workspace formatting check passed on the observed tree. |
| `cargo test --locked -p boreal-domain --test production_properties -- --nocapture` | 0 | 8 tests passed; 1,024 generated status cases plus exhaustive and bounded checks. |
| `cargo clippy --locked -p boreal-domain --test production_properties -- -D warnings` | 0 | Owned target passed strict clippy. |
| `cargo check --locked -p boreal-domain --tests` | 0 | Domain test targets compiled. |
| `cargo test --locked -p boreal-domain` | 0 | Domain unit/integration suite passed: 15 unit, 4 hierarchy, 15 M02 status, 12 acceptance, 7 action, 10 decision-input, 14 dependency, 8 property, 5 rollup, 8 precedence, 17 time, 9 work-model tests; doc-tests 0/0. |
| `cargo clippy --locked -p boreal-domain --all-targets -- -D warnings` | 0 | All domain targets passed strict clippy. |
| `git diff --check` | 0 | No whitespace errors observed. |

The first focused run after authoring exposed test-fixture/oracle defects and
was not treated as a pass: gate state had been assigned by vector position and
the assertion incorrectly sorted the primary reason. Those corrections remain
in the final source; no production source was changed in response.

