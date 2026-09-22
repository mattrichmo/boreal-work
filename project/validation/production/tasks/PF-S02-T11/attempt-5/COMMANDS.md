# PF-S02-T11 — attempt 5 independent review commands

Repository: `/Users/cybertron/Code/boreal-work`  
Branch: `codex/apply-responsive-terminal-overlay`  
Observed HEAD: `784a41b3802c29a76721c55eef2e9493283396c2`  
Observed date: `2026-09-22`  
Worktree: dirty combined tree; unrelated changes were preserved.

## Source identities

```text
482bcd3d054a984a8f66dd892c48b3ff1fa3698a9121c84caefea5c62d4acf1e  74845  crates/application/src/evidence.rs
4f26d10827e2ed0cde5b0fb631f335a6e3554224f5f9a837b2561cec040ce073   9141  crates/application/tests/production_external_jobs.rs
```

These are the exact files reviewed. The current diff adds 328 lines to
`evidence.rs`; the test file is an untracked addition in the combined tree.

## Checks

| Command | Exit | Result |
| --- | ---: | --- |
| `cargo test --locked -p boreal-application --test production_external_jobs` | 0 | 5/5 focused external-job tests passed. |
| `cargo test --locked -p boreal-application` | 0 | Full application package passed, including the five external-job tests and all existing integration tests. |
| `cargo test --locked -p boreal-memory` | 0 | Full memory package passed: 9 unit tests and 22 publisher tests. |
| `cargo test --locked -p boreal-cli` | 0 | Full CLI package passed: 68 unit tests and all integration suites. |
| `cargo fmt --all -- --check` | 0 | Passed. |
| `python3 project/spec/validate_contracts.py` | 0 | Passed: 8 protocol envelopes, 11 guidance fixtures, 10 workflow assets, 18 legal/15 illegal transitions, 19 clock/dependency cases, 52 conformance mappings, and SQLite schema parse. |
| `git diff --check` | 0 | Passed. |
| `cargo clippy --locked -p boreal-application --all-targets --all-features -- -D warnings` | 101 | Blocked by existing `clippy::too_many_arguments` at `crates/store/src/profiles.rs:505`, outside this review's bounded paths. No out-of-scope fix was made. |

## Validation limits

The package tests are source-level/application-level evidence. They do not
prove canonical service-backed verifier execution, production installer
behavior, platform release behavior, or integration with every external
effect named by the task.

