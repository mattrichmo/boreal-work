# Commands and results

All commands ran from `/Users/cybertron/.codex/worktrees/s02-t90-fixed-head/boreal-work`. The exact product source was `32e46d19fac5f970388ff67c1234a2c19fa91ee8`; the commit object was already present locally, so no fetch was needed. Full outputs are retained under `logs/`.

| Command | Result |
| --- | --- |
| `git rev-parse HEAD` | `32e46d19fac5f970388ff67c1234a2c19fa91ee8`. [`logs/environment.txt`](logs/environment.txt) records source, parent, clean-start state, and host toolchain. |
| `git diff d1f8ae0b5d42c1886df5bba04930f3692d63e6ef HEAD -- apps/global-tui/src/model.ts apps/global-tui/tests/global-tui.test.mjs` | Confirmed known schemas 2 and 3 are accepted and unknown schema 99 is rejected by the regression test. No files were edited. [`logs/source-schema-diff.log`](logs/source-schema-diff.log) |
| `LC_ALL=C LANG=C sh scripts/release/package-smoke.sh` | PASS, exit 0. The Global smoke reports `PASS ... real framed TUI ...`; reinstall preservation also passes. [`logs/package-smoke-verified.log`](logs/package-smoke-verified.log) |
| First `LC_ALL=C LANG=C sh scripts/release/package-smoke.sh` invocation | The package script itself reached `package smoke: PASS`; the surrounding zsh capture wrapper then failed when assigning the reserved `status` variable. Its raw output is preserved in [`logs/package-smoke.log`](logs/package-smoke.log). The exact command was rerun with a safe capture variable and exit 0 is recorded above. |
| `LC_ALL=C LANG=C python3 scripts/release/build_release.py --skip-build --output-dir project/validation/boreal-final-state/BW-S02/attempt-5/artifacts/native-release` | PASS, exit 0. Built a package from the release binary compiled by package-smoke and fresh TUI outputs; release manifest verification passed. [`logs/native-release-build.log`](logs/native-release-build.log) |
| `LC_ALL=C LANG=C sh scripts/release/package-target-smoke.sh project/validation/boreal-final-state/BW-S02/attempt-5/artifacts/native-release/bwrk-v0.2.2-aarch64-apple-darwin.tar.gz aarch64-apple-darwin` | PASS, exit 0 on macOS ARM64, with Node unavailable. [`logs/native-package-target-smoke.log`](logs/native-package-target-smoke.log) |
| `npm --prefix apps/global-tui run typecheck` | PASS on Node 26.8.2. [`logs/global-tui-typecheck-node26.log`](logs/global-tui-typecheck-node26.log) |
| `npm --prefix apps/global-tui test` | PASS, 99/99 on Node 26.8.2. [`logs/global-tui-tests-node26.log`](logs/global-tui-tests-node26.log) |
| `gh run list --workflow ci.yml --commit 32e46d19fac5f970388ff67c1234a2c19fa91ee8 --json databaseId,status,conclusion,headSha,workflowName,createdAt,updatedAt` | No runs (`[]`). Read-only query; no workflow was dispatched. [`logs/ci-runs.json`](logs/ci-runs.json) |
| `gh run list --workflow release.yml --commit 32e46d19fac5f970388ff67c1234a2c19fa91ee8 --json databaseId,status,conclusion,headSha,workflowName,createdAt,updatedAt` | No runs (`[]`). Read-only query; no workflow was dispatched. [`logs/release-runs.json`](logs/release-runs.json) |

## Scope

This attempt reran the previously failing package smoke and its affected Global TUI checks. It did not rerun the full S02 matrix or `python3 scripts/validation/run_full_suite.py`. Cross-architecture qualification was not performed. No production code, runtime plan state, CI/release state, push, or merge was changed by this attempt.
