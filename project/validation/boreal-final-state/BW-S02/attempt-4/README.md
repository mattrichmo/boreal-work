# BW-S02-T90 acceptance rerun — attempt 4

**Result: BLOCKED; do not accept T90 on this source.** This rerun used the exact coordinator source `d1f8ae0b5d42c1886df5bba04930f3692d63e6ef` in the isolated worktree recorded in [`START.md`](START.md). It did not include later coordinator changes. Previous attempts and their evidence are preserved.

## Acceptance matrix

| Sprint contribution | Result on `d1f8ae0b` |
| --- | --- |
| Release-style `SHA256SUMS` lookup on the package layout | Passed inside `package-smoke.sh`; the actual download/checksum fixture and fail-closed cases passed before the later Global TUI failure. |
| Staged and installed digests/build identities match `release.json` | Passed inside `package-smoke.sh`: package manifest/capability identities, staged and installed asset hashes, and the release identity were verified before the later Global TUI failure. The independently retained native package manifest and identity are in [`artifacts/`](artifacts/). |
| Missing/unsupported Node recovery while CLI remains usable | Passed focused CLI Node preflight tests and native `package-target-smoke.sh` with Node unavailable. The latter exercised the installed package's CLI/Global JSON path and rollback behavior. |
| Both TUIs are direct CI/full-suite targets | Passed source-contract inspection: CI invokes `scripts/validation/run_full_suite.py`, whose registered checks include Global typecheck/tests and Project tests. Both TUI typechecks and test suites passed locally. The full runner itself was not run. |
| Declared macOS ARM64, macOS x86-64, and Linux x86-64 targets; unsupported targets remain explicit | The release workflow and installation documentation declare those three candidate targets and explicitly leave Linux ARM64/Windows unsupported. Only macOS ARM64 was built and smoke-tested here. No matching CI/release workflow run exists for this source; Intel macOS and Linux x86-64 remain unqualified in this attempt. |
| Package behavior leaves project databases and per-user Global data intact | Passed package smoke's explicit project initialization, two-project isolation, and uninitialized-project rejection checks. A separate temporary-prefix reinstall harness also confirmed a temporary Global project survived reinstall with Node unavailable. Neither test used or modified the user's project database or Global root. |

## Blocking failure

`LC_ALL=C LANG=C sh scripts/release/package-smoke.sh` exits 1 in the integrated Global TUI terminal smoke. Its preceding release build, download/checksum path, manifest and asset verification, install, and Project/TUI smoke steps pass. The failing assertion is `bwrk-global-tui: global snapshot schema or revision is invalid` from `scripts/validation/global/smoke.py`.

At this source, the production Global snapshot declares schema version 3 in `crates/application/src/global_manager.rs`, while `apps/global-tui/src/model.ts` accepts only schema version 2. This prevents the packaged Global TUI from rendering a production snapshot. It is outside this attempt's granted production write boundary, so no TUI repair was made here. A rerun against a later coordinator source must record its own exact source identity and package result.

## Focused checks and package identity

- Production store seams: 6/6 passed, including the trigger-created projection regression.
- CLI Node preflight: 4/4 passed.
- Project TUI: typecheck passed on Node 26.8.2; tests passed 99/99 on Node 26.8.2 and 20.20.2.
- Global TUI: typecheck passed on Node 26.8.2; tests passed 99/99 on Node 26.8.2 and 20.20.2.
- Release identity tests: 6/6; release builder tests: 2/2; full-suite contract tests: 14/14; Global TUI identity tests: 4/4.
- Native package: version `0.2.2`, target `aarch64-apple-darwin`, source revision `d1f8ae0b5d42c1886df5bba04930f3692d63e6ef`, embedded source ID `sha256:23661ffca26ddeaeb83596fa1ad05e8f87091563012238d579422c8beabea9ad`.
- Archive SHA256: `sha256:ff712f1ad5e35bc393a4482668e3a0eeb3e6b340b1726a88c027a5fd84d2d3f7`; artifact identity: `sha256:9bd4c779a05633d34d842dd924f4da25a09218e0daca625a01a3ac989007f76e`.

Raw command outputs and compact release records are retained under [`logs/`](logs/) and [`artifacts/`](artifacts/). The generated archive and temporary package stages were removed after the package-target smoke; the compact manifest, checksum, and identity records remain.

## Source and evidence scope

The T01–T05 implementation paths are present at the tested source; the inventory is in [`logs/leaf-implementation-inventory.log`](logs/leaf-implementation-inventory.log). No separate T01–T05 leaf receipts were found in the checkout. This report is an attempt-local integration result, not a leaf receipt or acceptance transition.

No production file was changed. No full `run_full_suite.py` invocation, cross-architecture run, CI/release dispatch, push, merge, or runtime plan mutation occurred. T90 remains operator-only and unaccepted.
