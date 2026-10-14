# BW-S02-T90 attempt 2 — candidate acceptance result

**Candidate-local result: PASS on `de8673e41fa29c54ec1a3e6c2f8097b8e6a39553`. Final T90 acceptance: PENDING.** The coordinator requires the same combined gate on final integrated HEAD `5762bfac` or later. The attempt-1 blocked report and raw logs remain preserved in the parent directory.

## Reconciliation

The three attempt-1 findings did not reproduce after integration:

- Project TUI receipt-fixture mismatch: Project tests pass 99/99 on Node 26.8.2 and 20.20.2. The paged receipt fixture change is already present in ancestor `dd93b4a6`.
- Global TUI fixture/assertion failures: Global tests pass 92/92 on Node 26.8.2 and 20.20.2. The current fixture/read-model reconciliation is already present in ancestor `ce620d2a`.
- `work_node_v3` unique conflict: `production_store_seams` passes 6/6 against the production schema; the Global debug-binary smoke and full package smoke both create work successfully. The trigger-reuse repair and regression test are already present in ancestor `d09288c4`.

No production files were changed in this attempt. The accepted S02 work is evidence only; no unowned TUI paths were edited and no additional remediation grant is needed for this candidate.

## Release identity and package result

`package-smoke.sh` passed with `LC_ALL=C LANG=C`, including download-style checksum lookup, install, asset manifest verification, two-project isolation, Global create/smoke, and reinstall preservation. The repeatable native ARM64 archive was built with `--skip-build` from the just-built release binary and passed `package-target-smoke.sh` with Node unavailable.

- Source revision: `de8673e41fa29c54ec1a3e6c2f8097b8e6a39553`
- Embedded source ID: `sha256:149d8b2e53f1ef7965847ae12bdf0e8ca25a120aa3f869b21fa7966d903f44b3`
- Contract snapshot: `sha256:06e5426d76cbd09f82dde035bce4bd07f87de4650b53e998316147cc4ceb3c7f`
- Version/target: `0.2.1`, `aarch64-apple-darwin`
- Release binary asset SHA256: `sha256:5e47f61d3a018bcd8ae5304ae15496623e32fe17adacd9873540c82fdf7cf974`
- Release archive SHA256: `sha256:27e2ff66db40d2a958f9e54ea4f67fdf406ee07186b656782ececbb9373dd082`
- Release manifest SHA256: `sha256:18ca1b5aabd9135ece16eb6a0f221bb779190d33587648ccb312bb4c540d849d`
- Artifact identity: `sha256:7f0453d37e9ec606c5c730e221faf11951f21da4f37f4582d233daf1c81fd15e`

The exact manifest and identity record are in [`artifacts/`](artifacts/); raw package logs are in [`logs/`](logs/).

## Residual qualification

The local target smoke covers macOS ARM64 only. macOS x86-64 and Linux x86-64 remain CI-only and unqualified: the read-only workflow queries returned `[]`, and no release/CI workflow was dispatched. Linux ARM64 and Windows remain unsupported by the declared matrix. The host's default `C.UTF-8` locale is unavailable; locale-sensitive package checks passed when run under installed `C`.
