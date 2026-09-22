# PF-S03-T10 — attempt 9 commands

## Execution identity

- Executed: `2026-09-22T19:04:12Z` (UTC)
- Repository: `/Users/cybertron/Code/boreal-work`
- Input `HEAD`: `70514f0ed2521df710c3c913f50ff9d759f5e743`
- Final owned source: `crates/cli/src/main.rs`
- Final owned source SHA-256: `76e3d10f1a706cf4133ebf05a8c0bb18f924d0f977ea695d210a6a3a78084a2a`

## Baseline

```text
$ cargo check --locked --offline -p boreal-cli --bin bwrk
error[E0004]: non-exhaustive patterns: `DerivedStatus::Scheduled` not covered
--> crates/cli/src/main.rs:2687:11
exit 101
```

## Final checks

| Command | Result | Exact evidence |
| --- | --- | --- |
| `cargo check --locked --offline -p boreal-cli --bin bwrk` | PASS | Binary checked successfully; existing dead-code warnings only. |
| `cargo test --locked --offline -p boreal-cli status_name_maps_scheduled_to_status_two_queued` | PASS | 1 passed, 73 filtered in the unit target; other targets had no matching tests. |
| `cargo test --locked --offline -p boreal-cli` | PASS | 74 CLI unit tests plus 42 integration tests passed across all listed CLI targets; 0 failed. |
| `cargo check --locked --offline -p boreal-application` | PASS | Application library checked successfully; existing dead-code warning only. |
| `cargo test --locked --offline -p boreal-application --lib status::tests` | PASS | 7 passed, 35 filtered, 0 failed. |
| `cargo fmt --all -- --check` | PASS | No formatting differences. |
| `python3 project/spec/validate_contracts.py` | PASS | 8 protocol envelopes, 11 guidance fixtures, 10 workflow assets, 18 legal/15 illegal transition vectors, 19 clock/dependency cases, 52 conformance mappings, SQLite schema parsed. |
| `git diff --check` | PASS | No whitespace errors. |

The full CLI test count is 116 passed: 74 unit tests and 42 tests across
`command_registry`, `dashboard_launcher`, `evidence_executor_regressions`,
`evidence_runner_hardening`, `hierarchy_public`, `knowledge_routes`,
`operation_readback_contract`, `outcome_exit`, `project_setup`,
`release_acceptance`, `service_signal_recovery`, `service_workflow_discovery`,
and `workflow_discovery`.

No plan/state, protocol, store, application source, schema, commit, or push
command was executed by this attempt.
