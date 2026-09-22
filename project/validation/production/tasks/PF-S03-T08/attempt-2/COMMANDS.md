# PF-S03-T08 — independent review attempt 2 commands

All commands ran from `/Users/cybertron/Code/boreal-work` on
`2026-09-22`. The subject was the exact dirty combined tree on branch
`codex/apply-responsive-terminal-overlay`, HEAD
`784a41b3802c29a76721c55eef2e9493283396c2`.

## Toolchain and source identity

```text
rustc 1.85.0 (4d91de4e4 2025-02-17) (Homebrew)
cargo 1.85.0
Python 3.14.3
```

```text
19c93cdd9b6fbb708fbed54977aa04b0ce74f6128965af902acdad1ae384dcf6  crates/domain/tests/production_properties.rs
8cb4f719b4dd983f2b74f02e0305c9f2eeabcb4be28ba7057fe59d224b70daff  project/validation/production/domain/PF-S03-T08-ORACLE.md
8c8293e61be01be9d699f405d38bcbfd34d35033440ad6f757c233645c05c2e7  crates/domain/src/lib.rs
a2bbe9d64569f1be5f34cc2ab1c51d62b1ad45e9a2141dca3727c23efc2afcac  crates/domain/src/status_evaluator.rs
8ac6bdecee87c1d14c139a8fe9554be2b448a6fa1d00ebcad79bfe9a3d5c23e7  crates/domain/src/actions.rs
58ee17cdcad6e4cd7f42f75f68c5526471ce278d8c6f098c011f5207b5d2ac58  crates/domain/src/time_policy.rs
6680f089ef262923359ea90c4c99a99b7db7147465d14160d154fe37a4ece4c4  crates/domain/src/acceptance.rs
43001bf2e6009aea63d74662cd47fd1d65183ba76759280c20edeb4076298112  crates/domain/src/dependencies.rs
```

Accepted contract hashes inspected:

```text
b2b41ffd640811118e2c8f0ac0ba9c60d79cb46ccc73135cdcf609ae384b3a94  project/spec/production/status-and-actions.md
4a22bceb49b8d40d96a872f2ae3aed8b79a81d5636339c609914a05b3a2a9d38  project/spec/transition-table.md
539088128f18bc6fef8bbd855ca6a140c4d02ba33bffc799179b128c2a8393a4  project/spec/production/execution-submission-contract.md
da4c7796a801c185f33f0f309d82bc1a1a0f3aaa8ee6b3d546f49f7674714245  project/spec/production/acceptance-and-proof.md
3543fb5f1c3af51304826c66e02a3eb10dd0c1972cc35e77585c1b43a5a0a151  project/spec/production/dependencies-overrides-reopen.md
131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa1  project/spec/production/contract-manifest.json
```

## Executed checks

| Command | Exit | Result |
| --- | ---: | --- |
| `cargo fmt --all -- --check` | 0 | Passed. |
| `cargo test --locked -p boreal-domain --test production_properties -- --nocapture` | 0 | 8/8 passed; 1,024 generated status cases plus exhaustive pair/property checks. |
| `cargo test --locked -p boreal-domain` | 0 | All unit/integration/doc targets passed; 124 tests passed, 0 failed, 0 doc tests. |
| `cargo clippy --locked -p boreal-domain --all-targets -- -D warnings` | 0 | Passed with no warnings. |
| `python3 project/spec/validate_contracts.py` | 0 | Passed: 8 protocol envelopes, 11 guidance fixtures, 10 workflow assets, 18 legal/15 illegal transition vectors, 19 clock/dependency cases, 52 conformance mappings, SQLite schema parsed. |
| `git diff --check` | 0 | Passed. |

All green results are pure-domain/source checks. No service, store, genuine
verifier, native artifact, installer, or release claim is made.

## Static coverage probes

Read-only inspection of the target found no `scheduled` status, no stale /
unavailable / incompatible availability cases, no degraded/quarantined
integrity cases, no normative status/3 or transition-contract identity literal,
and no shrinker. The action assertion checks complete partition and descriptor
self-round-trip, but no expected allowed/denied action matrix. These findings
are detailed in `EVIDENCE.md`.
