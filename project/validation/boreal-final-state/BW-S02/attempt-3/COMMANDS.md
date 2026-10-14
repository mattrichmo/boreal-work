# Commands and outcomes

The source revision under test was `bff07ab430db65d1eca26174ba9e059d82666db3` (`origin/codex/v4-completion` at the last fetch). The evidence checkout was `299b5f5f4b41fcca29136bae1f656826fa9616b2`, whose parent is the source revision. Every command below exited 0; complete stdout/stderr is retained in `logs/`.

| Command | Result |
| --- | --- |
| `node --version` | PASS, `v26.8.2`. |
| `npm --prefix apps/tui run typecheck` | PASS. |
| `npm --prefix apps/tui test` | PASS, 99/99. |
| `npm --prefix apps/global-tui run typecheck` | PASS. |
| `npm --prefix apps/global-tui test` | PASS, 92/92. |
| `PATH=/tmp/boreal-s02-node20/node_modules/.bin:$PATH node --version` | PASS, `v20.20.2`. |
| `PATH=/tmp/boreal-s02-node20/node_modules/.bin:$PATH npm --prefix apps/tui test` | PASS, 99/99. |
| `PATH=/tmp/boreal-s02-node20/node_modules/.bin:$PATH npm --prefix apps/global-tui test` | PASS, 92/92. |
| `python3 scripts/release/test_release_identity.py` | PASS, 6/6. |
| `python3 -m unittest scripts.release.test_build_release` | PASS, 2/2. |
| `python3 scripts/validation/test_run_full_suite.py` | PASS, 14/14. |
| `python3 scripts/validation/global-tui/test_identity.py` | PASS, 4/4. |

No Cargo or release/package build command was run, per the coordinator's instruction to wait until its focused Cargo run completes. Therefore no final-source release binary, archive, manifest, or package-target smoke identity was produced in this attempt. The exact de8673e package identities and outputs remain in attempt 2.
