# BW-S02-T90 acceptance rerun — attempt 2

- Input source: fetched `origin/codex/v4-completion`, detached at `de8673e41fa29c54ec1a3e6c2f8097b8e6a39553`.
- Previous T90 report/source: `../README.md`, source `6fe9913136f1414adee433b5e1563da85e8316e2`. Its failure logs and conclusions remain unchanged.
- Workspace state before evidence creation: clean; this attempt changed evidence only.
- Local platform: macOS ARM64 (`aarch64-apple-darwin`); Rust 1.99.0; Node 26.8.2 and Node 20.20.2; Python 3.14.3.
- Default locale is `C.UTF-8`, absent from `locale -a` on this host. Locale-sensitive package/hash checks were run with `LC_ALL=C LANG=C`; release identity tests also pass their locale-stability case.
- Existing debug binary SHA256: `da0410a3544885e7e4aaccb2fae3416dc6fce56e20599a866e0fac90103ea4b9`; version output reports source ID `sha256:149d8b2e53f1ef7965847ae12bdf0e8ca25a120aa3f869b21fa7966d903f44b3`. See `logs/debug-binary-identity.log`.

## Scope and ownership

This attempt uses only BW-S02-T90's evidence directory. Its granted store integration paths were reviewed but not edited because `d09288c485e82d7d38abb49fe39cc2e1090a963b` already reconciles the production projection trigger with `create_planned_work_v3` and adds production-schema regression coverage. The Project and Global TUI source/test paths remain read-only; their prior findings are reconciled through the rerun results.

No `bwrk` lifecycle or plan mutation was made. No release workflow was dispatched. The old report and raw failures were preserved.

## Current status

Candidate-local S02 acceptance passed on `de8673e4`. The old Project TUI receipt-fixture failure, ten Global TUI fixture/assertion failures, and `work_node_v3` unique conflict did not reproduce. Final T90 acceptance is still open: the coordinator requires a rerun on final integrated HEAD `5762bfac` or later. macOS x86-64 and Linux x86-64 remain CI-only and unqualified until an authorized PR CI/release-matrix run exists.
