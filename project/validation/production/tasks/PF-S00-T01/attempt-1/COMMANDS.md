# PF-S00-T01 attempt 1 command record

All commands ran with cwd `/Users/cybertron/Code/boreal-work` unless stated otherwise. Commands were read-only. Timestamps are UTC on 2026-09-21. Shell output was inspected for secrets before recording.

## Tool versions

| Command | Exit | Output |
| --- | ---: | --- |
| `python3 --version` | 0 | `Python 3.14.3` |
| `node --version` | 0 | `v26.8.2` |
| `npm --version` | 0 | `11.7.0` |
| `cargo --version` | 0 | `cargo 1.85.0` |
| `rustc --version` | 0 | `rustc 1.85.0 (4d91de4e4 2025-02-17) (Homebrew)` |

## Context probe

Command: `bwrk prime --json`

Exit: `0`.

Raw result: `{"api_version":"2","schema_version":"boreal.protocol.envelope.v1","operation_id":"op_cli_1790026811970_63291_0","revision":null,"as_of":"unix-ms:1790026811970","next_status_change_at":null,"transport":"ok","outcome":"rejected","data":null,"detail_ref":null,"error":{"code":"invalid_argument","message":"missing project identifier","retryable":false}}`

Interpretation: rejected input, no state change; project identifier was not invented.

## Identity commands

Command: `LC_ALL=C openssl dgst -sha256 scratch/reference-zips/boreal-v2-reference-20260921T195305840Z.zip`

Exit: `0`.

Output before and after inspection: `SHA2-256(scratch/reference-zips/boreal-v2-reference-20260921T195305840Z.zip)= 09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`.

Command: `git rev-parse HEAD`

Exit: `0`; output `784a41b3802c29a76721c55eef2e9493283396c2`.

Command: `git status --short --branch`

Exit: `0`; output identified branch `codex/apply-responsive-terminal-overlay` and a dirty tree. The complete porcelain status is in `source-inventory.json`.

Command: `git show -s --format='HEAD=%H%nAUTHOR=%an <%ae>%nAUTHOR_DATE=%aI%nCOMMITTER=%cn <%ce>%nCOMMIT_DATE=%cI%nSUBJECT=%s' HEAD`

Exit: `0`; output: HEAD `784a41b3802c29a76721c55eef2e9493283396c2`, subject `fix: harden dashboard terminal lifecycle`, commit date `2026-09-21T15:01:13-06:00`.

## Archive inspection

Command: `python3` ZIP inspection using Python `zipfile`, `json`, `hashlib`, and `pathlib.PurePosixPath`; input archive is the exact path above.

Exit: `0`.

Output summary: `zip_members=546`, `unique_members=546`, `file_members=434`, `manifest_file_count=432`, `manifest_records=432`, `crc_bad_member=null`, `unsafe_members=[]`, `bad_manifest_paths=[]`, `duplicate_manifest_paths=[]`, `missing_manifest_members=[]`, `manifest_hash_mismatches=[]`, `unmanifested_file_members=["ARCHIVE_MANIFEST.json","REFERENCE_INDEX.md"]`, `manifest_deletions=[]`.

Command: `python3` manifest/current comparison using `hashlib` over each manifest path.

Exit: `0`.

Output: `archive_manifest_vs_current_same 424`; `archive_manifest_vs_current_different 8`; `archive_manifest_paths_missing_current 0`. Differences: `apps/tui/src/full-screen.ts`, `apps/tui/src/test.ts`, `crates/cli/src/dashboard.rs`, `crates/cli/src/setup.rs`, `crates/cli/tests/dashboard_launcher.rs`, `crates/cli/tests/evidence_executor_regressions.rs`, `crates/cli/tests/project_setup.rs`, `scripts/prepare-test-project.sh`.

Command: `python3` current-tree fingerprint over sorted `git ls-files -co --exclude-standard` regular files, aggregating path, byte count, and file SHA-256.

Exit: `0`.

Output: `snapshot_file_count=912`, `snapshot_sha256=7051bb14d9bdb283235b65e45e78bea9b485318998847173e79dbfc409ed7ea8`, `status_entry_count=525`. This was captured before writing the PF-S00-T01 output files, so it is explicitly a pre-mutation baseline and does not self-hash the evidence artifacts.

Command: `python3` ZIP CRC recheck with `ZipFile.testzip()` after all inspection.

Exit: `0`; output `crc_test_after None`.

## Artifacts and digests

- `source-inventory.json` records all 432 manifest file paths, byte counts, and SHA-256 values, plus current status entries and fingerprint.
- `provenance.md` records interpretation, applicability, discrepancies, blockers, and write scope.
- `HANDOFF.md` and `EVIDENCE.md` provide the bounded handoff and evidence summary.
- The input ZIP was not written, extracted into the repository, rebuilt, or replaced.
