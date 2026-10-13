# BW-S00 combined qualification

Date: 2026-10-13
Validated source: `caeafb5c7a212e2b72103a33a93af62f012c7cef`
Source tree: clean
Validation owner: integration coordinator (BW-S00-T90)

## Result

The combined S00 candidate passed the exact-head smoke profile with 9 passes,
0 skips, and 0 failures. Validation used the committed source identity above;
this evidence directory was added afterward, so its eventual commit is not the
source identity measured by the run.

The suite report and machine-readable Global TUI identity are preserved beside
this record. The source, binary, and Global TUI digests in those files bind the
result to the tested artifacts.

## Checks run

| Check | Result |
| --- | --- |
| `TMPDIR=/tmp python3 scripts/validation/run_full_suite.py --profile smoke --online --require-current-binary` | 9 passed, 0 skipped, 0 failed |
| `python3 scripts/validation/test_run_full_suite.py` | 14 tests passed |
| `python3 scripts/validation/global-tui/test_identity.py` | 4 tests passed |
| `cargo test -p boreal-cli --test global_service global_service_survives_abandoned_connections_and_answers_next_snapshot --locked -- --nocapture` | passed |
| `TMPDIR=/tmp python3 scripts/validation/global/smoke.py --binary target/debug/bwrk` | passed, including project work while Global is unavailable |
| `TMPDIR=/tmp python3 scripts/validation/global-tui/pty_smoke.py --bin target/debug/bwrk --identity-output <temporary-file>` | passed at 80×24, 36×12, 140×36, and 52×16 |
| Release download/checksum fixture with `LC_ALL=C LANG=C` | passed; rejects a correct digest paired with a directory-prefixed archive path |
| `git diff --check` | passed |
| `.github/workflows/ci.yml` YAML parse | passed |

The full validation run also built the Rust workspace and binary, typechecked
the Global TUI, ran its test suite (84 tests), exercised project creation, and
verified exact binary/source identity. The JSON report records the individual
check results.

## Environment and limitations

On this macOS host, the default temporary directory makes two MCP Unix-socket
paths exceed the platform socket-path limit. The same suite passed with
`TMPDIR=/tmp`, which provides short socket paths. This is a local environment
constraint; CI runs on Ubuntu. The CI workflow has been committed but has not
yet run on GitHub, so remote CI status is pending.

This qualifies S00's combined smoke behavior on the local macOS ARM64 host. It
does not claim final release qualification, all 24 V4 journeys, or completion
of the later S01–S13 sprints.

## Successor work unlocked

After the S00 source and evidence are integrated, the V4 graph permits BW-S01,
BW-S02, BW-S04, BW-S12-T01, and non-conflicting BW-S08 tasks to begin when each
task's exact source snapshot and write ownership are recorded. S00-T90 remains
the sprint integration owner; dependent sprint gates remain open.
