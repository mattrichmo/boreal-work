# Commands and outcomes

All command output is retained in `logs/`; the native release manifest and compact identity record are in `artifacts/`.

## TUI and integration checks on source `de8673e41fa29c54ec1a3e6c2f8097b8e6a39553`

| Command | Result |
| --- | --- |
| `npm --prefix apps/tui run typecheck` | PASS, exit 0. |
| `npm --prefix apps/tui test` | PASS, 99/99 on Node 26.8.2. |
| `npm --prefix apps/global-tui run typecheck` | PASS, exit 0. |
| `npm --prefix apps/global-tui test` | PASS, 92/92 on Node 26.8.2. |
| `PATH=/tmp/boreal-s02-node20/node_modules/.bin:$PATH npm --prefix apps/tui test` | PASS, 99/99 on Node 20.20.2. |
| `PATH=/tmp/boreal-s02-node20/node_modules/.bin:$PATH npm --prefix apps/global-tui test` | PASS, 92/92 on Node 20.20.2. |
| `cargo test --locked -p boreal-store --test production_store_seams` | PASS, 6/6. Includes `production_schema_work_creation_reuses_triggered_projection`; direct and container Task modes pass against the production schema. |
| `cargo test --locked -p boreal-cli dashboard_node -- --nocapture` | PASS, 4/4 Node preflight tests. An earlier shell wrapper used zsh's read-only `status` variable and exited 1 after Cargo passed; that raw output is preserved as `logs/node-preflight-tests-wrapper-failure.log`, and the corrected run is `logs/node-preflight-tests.log`. |
| `python3 scripts/release/test_release_identity.py` | PASS, 6/6, including locale-stable checksum lookup. |
| `python3 -m unittest scripts.release.test_build_release` | PASS, 2/2. |
| `python3 scripts/validation/test_run_full_suite.py` | PASS, 14/14. |
| `python3 scripts/validation/global-tui/test_identity.py` | PASS, 4/4. |
| `LC_ALL=C LANG=C python3 scripts/validation/global/smoke.py --binary target/debug/bwrk` | PASS. Covers Global CLI cwd independence, workflows/hierarchy/notes, dependency-cycle rejection, revision conflict/replay, Project isolation, framed TUI, and export/import. |

## Package checks

| Command | Result |
| --- | --- |
| `LC_ALL=C LANG=C sh scripts/release/package-smoke.sh` | PASS, exit 0. Built and installed the ARM64 package; passed release-layout download/checksum fixture, installer and manifest/asset hashes, two-project smoke, Global work-creation smoke, and reinstall preservation. The temporary archive was cleaned by the script. It reported archive SHA256 `sha256:27e2ff66db40d2a958f9e54ea4f67fdf406ee07186b656782ececbb9373dd082`, source ID `sha256:149d8b2e53f1ef7965847ae12bdf0e8ca25a120aa3f869b21fa7966d903f44b3`, and contract snapshot `sha256:06e5426d76cbd09f82dde035bce4bd07f87de4650b53e998316147cc4ceb3c7f`. |
| `LC_ALL=C LANG=C python3 scripts/release/build_release.py --skip-build --output-dir /tmp/boreal-s02-t90-attempt-2-release` | PASS, exit 0. Reused the release binary just built by package smoke, compiled fresh TUI runtime outputs, and verified release identity; no Cargo compilation. Retained archive and manifest hashes are in `artifacts/native-release-identity.json`. |
| `LC_ALL=C LANG=C sh scripts/release/package-target-smoke.sh /tmp/boreal-s02-t90-attempt-2-release/bwrk-v0.2.1-aarch64-apple-darwin.tar.gz aarch64-apple-darwin` | PASS, exit 0. Installed to a temporary prefix, matched version/target, provisioned a temporary Global database, created a Global project, and read its JSON dashboard with Node unavailable. |

## Workflow and platform qualification

| Command | Result |
| --- | --- |
| `gh run list --workflow ci.yml --branch codex/v4-completion --limit 10 --json databaseId,status,conclusion,headSha,createdAt,url,displayTitle` | PASS, stdout `[]`. |
| `gh run list --workflow release.yml --branch codex/v4-completion --limit 10 --json databaseId,status,conclusion,headSha,createdAt,url,displayTitle` | PASS, stdout `[]`; no release workflow was dispatched. |

The local host is ARM64 macOS. macOS x86-64 and Linux x86-64 package install/launch have not run and remain CI-only/unqualified until an authorized PR CI/release-matrix run exists. Linux ARM64 and Windows remain outside the declared release targets.

## Triage of attempt-1 failures

- Project TUI receipt rehydration: no longer reproduces; fixture now implements the paged `readReceiptsForAttempt` service operation. Project suite passes 99/99 on Node 26 and 20. Integration fix is ancestor `dd93b4a6`.
- Global TUI fixture/assertion failures: no longer reproduce; current tests align with the server-provided classification/read-model fields and current view contract. Global suite passes 92/92 on Node 26 and 20. Fixture reconciliation is ancestor `ce620d2a`.
- `work_node_v3` unique conflict: no longer reproduces; canonical work insert reuses the production trigger projection and reconciles execution mode instead of inserting a duplicate. Production store seams pass 6/6 and both debug-binary and installed-package Global smoke pass. Integration fix is ancestor `d09288c4`.

No new source remediation or path grant was needed on this candidate. If either TUI issue returns on the final integrated head, the proposed bounded grants are `apps/tui/src/test.ts` to the Project TUI owner and `apps/global-tui/tests/interaction.test.mjs` plus `apps/global-tui/tests/model-view.test.mjs` to the Global TUI owner. The store repair/test paths already sit in T90's grant: `crates/store/src/work_model_v3.rs` and `crates/store/tests/production_store_seams.rs`.

## Remaining gate

Rerun this combined acceptance on `5762bfac` or later before T90 can be accepted. Do not interpret this candidate-local result as sprint closure.
