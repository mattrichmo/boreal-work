# BW-S00 combined qualification

Date: 2026-10-13

Validated source: `93faf2ad14323986f4bfc487acd9b516fad4c15b`

Source tree at measurement: clean

Validation owner: integration coordinator (BW-S00-T90)

## Result

The exact-source S00 smoke profile passed with **9 passes, 0 skips, and 0
failures**. The combined Rust workspace, Project TUI, Global TUI typecheck and
tests, creation journey, and binary/source freshness checks all passed. The
supplemental S00 service, portability, release-package, and plan checks below
also passed. The reports bind the run to the source, debug binary, and Global
TUI bundle digests. This evidence was added after the measured source commit.

## Checks run

| Check | Result |
| --- | --- |
| `TMPDIR=/tmp python3 scripts/validation/run_full_suite.py --profile smoke --online --require-current-binary --output /tmp/BW-S00-final-full-suite-8.json` | 9 passed, 0 skipped, 0 failed; `cargo test --workspace --locked` passed |
| `python3 scripts/validation/test_run_full_suite.py` | 14 tests passed |
| `python3 scripts/validation/global-tui/test_identity.py` | 4 tests passed |
| `cargo test -p boreal-cli --test global_service global_service_survives_abandoned_connections_and_answers_next_snapshot --locked -- --nocapture` | passed; malformed, partial, oversized, and abandoned requests did not stop service; unknown mutation outcome was read back by operation ID |
| `TMPDIR=/tmp python3 scripts/validation/global/smoke.py --binary target/debug/bwrk` | passed; arbitrary cwd, linked workspace, project execution with Global unavailable, service replay, TUI, and export/import |
| `TMPDIR=/tmp python3 scripts/validation/global-tui/pty_smoke.py --bin target/debug/bwrk --identity-output /tmp/BW-S00-global-tui-identity-8.json` | passed at 80×24, 36×12, 140×36, and resized 52×16 |
| `TMPDIR=/tmp LC_ALL=C LANG=C sh scripts/release/package-smoke.sh` | passed; built and installed the macOS ARM64 release archive, verified release checksum/manifest/assets, project and Global smoke, and reinstall preservation |
| `python3 project/build-plan/boreal-final-state/validate_plan.py` | passed: 14 sprints, 85 required tasks, 100 work items, 24 journeys, 3 deferred tasks |
| `git diff --check` | passed |

The report files beside this README retain the full-suite JSON/Markdown and
the standalone Global TUI identity. Measured artifact identities:

- Source SHA-256: `2d86ade619f56988dbf1a3653f8c4af068ffb821494cbc448c3097e4a9e01f77`
- Debug binary SHA-256: `1f9b5f8ef954c9e528b22b5cd6a71b93cbd0208034a330c09b97998e4944b91b`
- Global TUI bundle SHA-256: `1468d4ed1bfab35a91a626cc0131cb6abd5ff70f9543bcb11883e4bc9ba41852` (11 files)
- Release archive: `bwrk-v0.2.1-aarch64-apple-darwin.tar.gz`, SHA-256 `50cb89ce1c2be3c346917e57d57ce7323b301f33972df731927d56ef600adee5`

## Environment and limitations

Qualification ran on macOS ARM64 with Node `v26.8.2`. `TMPDIR=/tmp` avoids
this host's long default temporary path for Unix sockets. This qualifies only
the local macOS ARM64 package; macOS x86-64 and Linux x86-64 native runner
results remain required at the release gate. GitHub reports no checks for PR
#22, so no remote CI result is claimed.

This closes the combined S00 code and smoke gate at the measured source. It
does not claim completion of the later S01–S13 sprint gates or all 24 journeys.

## Successor work unlocked

The V4 task graph permits BW-S01, BW-S02, BW-S04, BW-S12-T01, and nonconflicting
BW-S08 groundwork after exact-source and write-boundary checks. The checked-in
task graph and task cards remain the dispatch authority. This checkout has no
initialized canonical Boreal runtime, so no runtime task claim or lifecycle
status is asserted here. Dependent T90 gates remain open until their own
combined evidence is accepted.
