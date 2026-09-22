# PF-S03-T10 independent validation commands — attempt 4

All commands ran from `/Users/cybertron/Code/boreal-work` unless noted.

| Command | Result |
| --- | --- |
| `date -u '+%Y-%m-%dT%H:%M:%SZ'` | `2026-09-22T14:46:06Z` at review start |
| `git rev-parse HEAD` | `784a41b3802c29a76721c55eef2e9493283396c2` |
| `cargo --version` | `cargo 1.85.0` |
| `rustc --version` | `rustc 1.85.0 (4d91de4e4 2025-02-17) (Homebrew)` |
| `openssl dgst -sha256 crates/domain/tests/production_properties.rs` | `4455551dcad2120596fbb7d9edbcfb8c95edd6752792d1d1f7c1943e4fe8cb89` |
| `openssl dgst -sha256 project/validation/production/domain/PF-S03-T10-ORACLE.md` | `1701bc8596340bf85936619238071a8978de778815ca4afcb2560109e73f961b` |
| `cargo test --locked -p boreal-domain --test production_properties` | exit 0; 13 passed, 0 failed |
| `cargo test --locked -p boreal-domain` | exit 0; all unit, integration, and doc tests passed; 0 failed |
| `cargo clippy --locked -p boreal-domain --all-targets --all-features -- -D warnings` | exit 0 |
| `cargo fmt --all -- --check` | exit 0 |
| `git diff --check` | exit 0 |
| `python3 project/spec/validate_contracts.py` | exit 0; 8 protocol envelopes, 11 guidance fixtures, 10 workflow assets, 18 legal/15 illegal transition vectors, 19 clock/dependency cases, 52 conformance mappings, SQLite schema parsed |
| `python3 tools/plan.py validate` from `project/build-plan/production-completion` | exit 0; 22 sprints, 268 tasks, 35 initial/current accepted tasks; no plan errors |
| `python3 tools/plan.py verify-package` from `project/build-plan/production-completion` | exit 0; 447 files checked, no mismatches |

No command wrote source, `execution/STATE.json`, or the package manifest.

