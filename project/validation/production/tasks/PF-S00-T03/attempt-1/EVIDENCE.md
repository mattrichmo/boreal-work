# PF-S00-T03 attempt 1 evidence

## Disposition

This is current dirty-tree baseline evidence only. It is not a product acceptance, sprint acceptance, release, native-installation, published-channel, or independent-review claim. Historical archive checks remain historical and were not promoted.

The machine-readable result is [`checks.json`](../../../baseline/checks.json), with one stdout and stderr log pair for each of 23 attempted commands. All commands completed within the 600-second bound: 16 passed and 7 failed; no tool was unavailable and no command timed out.

## Source and runtime identity

- Workspace: `/Users/cybertron/Code/boreal-work`
- HEAD: `784a41b3802c29a76721c55eef2e9493283396c2`
- Branch: `codex/apply-responsive-terminal-overlay`
- Tree: dirty; the source evidence subject is the exact checkout, not the supplied archive.
- Pre-task working-tree aggregate from accepted PF-S00-T01 provenance: `7051bb14d9bdb283235b65e45e78bea9b485318998847173e79dbfc409ed7ea8`.
- Built CLI artifact: `target/debug/bwrk`, SHA-256 `3c8d5c189a4fe1a98cc88e95bcf1312a3e5b4594f2d5f6a4476ac68680c852e5`.
- Host/toolchain observed: macOS 15.2 arm64; Python 3.14.3; Node v26.8.2; npm 11.7.0; Cargo 1.85.0; rustc 1.85.0; rustfmt 1.8.0; Git 2.47.0; `/bin/sh` GNU bash 3.2.57.
- Accepted PF-S00-T02 also records SQLite CLI 3.43.2 and Python SQLite 3.51.1 against a repository-reported 3.51.3 floor; this remains an environment gap, not a pass.
- Cargo commands used default dependency resolution; no `--offline` run was substituted.

## Passing evidence

- Source hygiene and Rust formatting passed.
- Locked CLI build passed. This proves compilation of `bwrk`, not service lifecycle or release behavior.
- Contract validator and production plan structural validation passed.
- TUI TypeScript typecheck passed.
- Installer byte-identity and shell/JavaScript syntax checks passed.
- Focused `m02_status`, `m02_claim`, `m02_status_authority`, and `m02_status_wire` tests passed as domain/store/application/protocol evidence respectively. They do not establish genuine service or release acceptance.

## Failed results and classification

| Finding | Observed result | Classification | Future task mapping |
| --- | --- | --- | --- |
| `BL-T03-01` | `cargo test --workspace --locked` exited 101. `boreal-memory` publisher test `concurrent_distinct_publications_serialize_without_lost_entries` had 21 passed/1 failed; concurrent distinct publications returned `Conflict("another publication owns the memory root lock; retry after it exits")` where the test requires all six results to succeed and all entries to survive. The current implementation deliberately returns a conflict after its bounded lock wait in `crates/memory/src/lib.rs:1100–1157`. | Reproducible implementation/behavior defect candidate in publication serialization, not an environment skip and not a test-only fixture. | `PF-S11-T05` implement recoverable Git publication; `PF-S11-T09` validate source-memory-handoff recovery; later `PF-S11-T90` review. |
| `BL-T03-02` | Strict clippy exited 101 on `crates/domain/src/status_evaluator.rs:75–77`: `clippy::filter_map_bool_then` is denied by `-D warnings`. | Baseline lint defect; focused domain tests still pass. | `PF-S03-T02` exhaustive status implementation; `PF-S03-T09` public decision API integration. |
| `BL-T03-03` | `npm --prefix apps/tui test` exited 1 after compilation because the test service could not listen on `/tmp/...sock`: Node reported `listen EPERM: operation not permitted`. | Environment capability unavailable for the Unix-socket fixture. This does not prove a TUI logic defect; it also does not count as a pass. | Environment follow-up through `PF-S00-T02`; real socket authority in `PF-S04-T06`; mounted TUI/service validation in `PF-S15-T10`. |
| `BL-T03-04` | `source_archive_test.py --exercise` verified ZIP creation, required paths and byte identity (`901` ZIP files; `27` TUI text files), then failed in the isolated `npm test` at the same Unix-socket `EPERM`. | Package/archive preflight passed, exercised TUI fixture failed because the required environment capability was denied; overall command is failed. | `PF-S15-T10` for real TUI/service validation; `PF-S18-T07` for clean-package validation. |
| `BL-T03-05` | `plan.py verify-package` exited 1 with one mismatch: `execution/STATE.json`. The issued manifest contains the original package hash, while the live coordinator ledger has since changed. | Plan-package identity drift, distinct from product runtime correctness. It is an expected consequence of mutable live execution state unless the package/ledger authority is reconciled explicitly. | `PF-S00-T07` baseline-to-plan reconciliation; `PF-S14-T08` workflow/package identity validation. |
| `BL-T03-06` | `validate_premium.py -v` exited 1: 11 tests passed and 4 failed because the interactive wizard could not open `/dev/tty` (`EPERM`). | Environment/PTY capability unavailable. No installer wizard behavior is accepted or rejected by this run. | `PF-S15-T10` mounted terminal workflow; `PF-S18-T03` installer/responsive interaction; `PF-S18-T07` clean disposable package validation. |
| `BL-T03-07` | `validate_responsive.py -v` exited 1: 13 failed and 1 skipped, with the same `/dev/tty` `EPERM` before rendering. | Environment/PTY capability unavailable; skipped/failed fixture outcomes remain non-green. | `PF-S15-T10`, `PF-S18-T03`, and `PF-S18-T07`; re-run on an executor with real PTY/TTY authority. |

## Evidence-layer limits

- Unit/property evidence: focused domain and protocol tests passed.
- Store evidence: focused claim/transaction tests passed.
- Application/service-boundary evidence: focused application test passed; no genuine authenticated service lifecycle was proven.
- TUI/PTY fixture evidence: unavailable/failed due sandbox `/tmp` socket and `/dev/tty` permissions.
- Package/source evidence: installer and syntax checks passed; source archive generation/byte checks passed before its isolated TUI exercise failed.
- Native installed and published-channel evidence: not run and not established.
- Independent review/reconciliation/revalidation: not performed by this task.

The failed memory publication and lint outcomes should be preserved as baseline defects for their future owners. The PTY/socket outcomes should be carried as explicit executor capability requirements, not silently relabeled as product passes.
