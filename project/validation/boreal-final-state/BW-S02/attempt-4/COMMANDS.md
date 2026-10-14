# Commands and results

All commands were run from the isolated worktree at exact source `d1f8ae0b5d42c1886df5bba04930f3692d63e6ef`. Full outputs are in the adjacent `logs/` directory unless noted. Node 26 means `v26.8.2`; Node 20 means `v20.20.2` selected from `/tmp/boreal-s02-node20/node_modules/.bin`.

| Command | Result |
| --- | --- |
| `cargo test --locked -p boreal-store --test production_store_seams` | PASS, 6/6. [`logs/production-store-seams.log`](logs/production-store-seams.log) |
| `cargo test --locked -p boreal-cli dashboard_node -- --nocapture` | PASS, 4/4. [`logs/node-preflight-tests.log`](logs/node-preflight-tests.log) |
| `npm --prefix apps/tui run typecheck` | PASS on Node 26. [`logs/project-typecheck-node26.log`](logs/project-typecheck-node26.log) |
| `npm --prefix apps/tui test` | PASS, 99/99 on Node 26. [`logs/project-tests-node26.log`](logs/project-tests-node26.log) |
| `PATH=/tmp/boreal-s02-node20/node_modules/.bin:$PATH npm --prefix apps/tui test` | PASS, 99/99 on Node 20. [`logs/project-tests-node20.log`](logs/project-tests-node20.log) |
| `npm --prefix apps/global-tui run typecheck` | PASS on Node 26. [`logs/global-typecheck-node26.log`](logs/global-typecheck-node26.log) |
| `npm --prefix apps/global-tui test` | PASS, 99/99 on Node 26. [`logs/global-tests-node26.log`](logs/global-tests-node26.log) |
| `PATH=/tmp/boreal-s02-node20/node_modules/.bin:$PATH npm --prefix apps/global-tui test` | PASS, 99/99 on Node 20. [`logs/global-tests-node20.log`](logs/global-tests-node20.log) |
| `python3 scripts/release/test_release_identity.py` | PASS, 6/6. [`logs/release-identity-tests.log`](logs/release-identity-tests.log) |
| `python3 -m unittest scripts.release.test_build_release` | PASS, 2/2. [`logs/release-builder-tests.log`](logs/release-builder-tests.log) |
| `python3 scripts/validation/test_run_full_suite.py` | PASS, 14/14. This tests full-suite registration/contracts; it does not invoke the full suite. [`logs/full-suite-contract-tests.log`](logs/full-suite-contract-tests.log) |
| `python3 scripts/validation/global-tui/test_identity.py` | PASS, 4/4. [`logs/global-tui-identity-tests.log`](logs/global-tui-identity-tests.log) |
| Read source contracts in `.github/workflows/ci.yml`, `scripts/validation/run_full_suite.py`, `.github/workflows/release.yml`, and `docs/INSTALL.md` / `docs/PACKAGING.md` | PASS for the declared matrix/target claims and CI/full-suite TUI registration. [`logs/release-surface-contract.log`](logs/release-surface-contract.log) |
| `gh run list --workflow ci.yml --commit d1f8ae0b5d42c1886df5bba04930f3692d63e6ef` | No runs (`[]`). Read-only query; no workflow was dispatched. [`logs/ci-runs.json`](logs/ci-runs.json) |
| `gh run list --workflow release.yml --commit d1f8ae0b5d42c1886df5bba04930f3692d63e6ef` | No runs (`[]`). Read-only query; no workflow was dispatched. [`logs/release-runs.json`](logs/release-runs.json) |
| `LC_ALL=C LANG=C sh scripts/release/package-smoke.sh` | **FAIL, exit 1.** Native build, download/checksum fixture, release identity/manifest checks, install, installed hashes, and Project/TUI smoke pass; packaged Global TUI rendering fails with `global snapshot schema or revision is invalid`. [`logs/package-smoke.log`](logs/package-smoke.log) |
| `LC_ALL=C LANG=C python3 scripts/release/build_release.py --skip-build --output-dir project/validation/boreal-final-state/BW-S02/attempt-4/artifacts/native-release` | PASS. Packages the release binary built during `package-smoke.sh` and fresh TUI outputs; manifest verification passes. Native package metadata is in [`artifacts/native-release-identity.json`](artifacts/native-release-identity.json). [`logs/native-release-build-skip-cargo.log`](logs/native-release-build-skip-cargo.log) |
| `LC_ALL=C LANG=C sh scripts/release/package-target-smoke.sh project/validation/boreal-final-state/BW-S02/attempt-4/artifacts/native-release/bwrk-v0.2.2-aarch64-apple-darwin.tar.gz aarch64-apple-darwin` | PASS on local macOS ARM64, with Node unavailable. [`logs/native-package-target-smoke.log`](logs/native-package-target-smoke.log) |
| Temporary-prefix harness installing the archive twice and checking `dashboard global --json` | PASS: temporary Global project survived reinstall with Node unavailable. No real user Global root or project database was used. [`logs/package-global-preservation.log`](logs/package-global-preservation.log) |

## Setup and scope notes

- `npm --prefix apps/tui ci` and `npm --prefix apps/global-tui ci` were attempted during preflight and failed because neither package contains a `package-lock.json`; no package install was required for these dependency-free TypeScript builds/tests. The initial malformed invocation and corrected no-lockfile attempts are preserved as `npm-ci-*.log`.
- `package-smoke.sh` was run under `LC_ALL=C LANG=C` because the host's default `C.UTF-8` locale is unavailable to this package check.
- The actual full `python3 scripts/validation/run_full_suite.py` runner was not invoked. Its registration contract tests and each requested focused TUI check were run separately.
- Only local `aarch64-apple-darwin` was built/smoke-tested. `x86_64-apple-darwin` and `x86_64-unknown-linux-gnu` were not qualified in this attempt; Linux ARM64 and Windows remain explicitly unsupported. Cross-platform work stays CI-only, and no CI/release workflow was dispatched.
- No production file was modified. This report does not accept T90, update runtime plan state, push, or merge.
