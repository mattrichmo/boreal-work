# PF-S03-T10 — independent review attempt 2 commands

Working directory for every command: `/Users/cybertron/Code/boreal-work`.

## Source identity

- `git rev-parse HEAD` → `784a41b3802c29a76721c55eef2e9493283396c2`.
- Working tree is dirty; no release identity is claimed.
- Relevant final hashes observed during review:

  | Path | SHA-256 |
  | --- | --- |
  | `project/spec/production/status-and-actions.md` | `b2b41ffd640811118e2c8f0ac0ba9c60d79cc46ccc73135cdcf609ae384b3a94` |
  | `project/spec/transition-table.md` | `4a22bceb49b8d40d96a872f2ae3aed8b79a81d5636339c609914a05b3a2a9d38` |
  | `project/spec/production/contract-manifest.json` | `131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa1` |
  | `crates/domain/tests/production_properties.rs` | `4455551dcad2120596fbb7d9edbcfb8c95edd6752792d1d1f7c1943e4fe8cb89` |
  | `project/validation/production/domain/PF-S03-T10-ORACLE.md` | `1701bc8596340bf85936619238071a8978de778815ca4afcb2560109e73f961b` |

## Required checks

All commands ran against the exact current combined tree. Exit codes and
observed results:

1. `cargo fmt --all -- --check` — exit `0`.
2. `cargo test --locked -p boreal-domain --test production_properties` — exit `0`; 13 passed, 0 failed, 0 ignored.
3. `cargo test --locked -p boreal-domain` — exit `0`; every unit and integration target reported passed, including the 13 production-property tests.
4. `cargo clippy --locked -p boreal-domain --all-targets -- -D warnings` — exit `0`.
5. `python3 project/spec/validate_contracts.py` — exit `0`; 8 protocol envelopes, 11 guidance fixtures, 10 workflow assets, 18 legal/15 illegal transition vectors, 19 clock/dependency cases, 52 conformance mappings, SQLite schema parsed.
6. `git diff --check` — exit `0`.

No service, store, verifier, installation, release, operation readback, or
external mutation was run. These checks are pure-domain/static evidence only.
