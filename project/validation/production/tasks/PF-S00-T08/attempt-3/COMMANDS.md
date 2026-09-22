# PF-S00-T08 attempt 3 — commands and results

All commands ran from `/Users/cybertron/Code/boreal-work` on 2026-09-21 with the repository toolchain. The source tree remained dirty because it contains pre-existing user and plan changes; no unrelated changes were reverted.

| Command | Result |
| --- | --- |
| `cargo fmt --all` | passed; formatting applied only through the project formatter |
| `cargo fmt --all -- --check` | passed |
| `cargo build --locked -p boreal-cli --bin bwrk` | passed; rebuilt `target/debug/bwrk` |
| `cargo test --locked -p boreal-application --test workflow_queries` | passed; 2 tests |
| `cargo test --locked -p boreal-cli --test workflow_discovery` | passed; 2 tests |
| `cargo test --locked -p boreal-cli --test service_workflow_discovery` | passed; 1 test |
| `cargo test --locked -p boreal-cli --test command_registry` | passed; 9 tests |
| `cargo test --locked -p boreal-protocol` | passed; 12 tests plus doc-tests |
| `python3 project/spec/validate_contracts.py` | passed; 8 protocol envelopes, 11 guidance fixtures, 10 workflow assets, 18 legal/15 illegal transitions, 19 clock/dependency cases, 52 conformance mappings, SQLite schema parsed |
| absolute `target/debug/bwrk workflows list --json` | passed without project/database context; ten assets returned |
| absolute `target/debug/bwrk workflows show boreal.workflow.audit.v1 --json` | passed without project/database context; exact audit asset returned |
| absolute `target/debug/bwrk workflows show boreal.workflow.missing.v1 --json` | rejected with typed `not_found` |
| service-backed workflow list/show integration test | passed against a fresh Unix service and disposable database; no project identifier supplied |

The direct route is intentionally dispatched before database-owner acquisition. The service route uses the same embedded registry and does not turn workflow discovery into project state.
