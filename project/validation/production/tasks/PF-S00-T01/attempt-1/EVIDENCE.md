# PF-S00-T01 attempt 1 evidence

Evidence class: fresh read-only source/archive identity inspection. This is not application, service, release, or acceptance evidence.

## Validation result

| Check | Result | Evidence |
| --- | --- | --- |
| Archive exists | PASS | Requested ZIP present at exact path. |
| Archive digest before inspection | PASS | `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`. |
| Archive digest after inspection | PASS | Same SHA-256. |
| ZIP member uniqueness | PASS | 546 members, 546 unique. |
| Safe member paths | PASS | No absolute, parent-traversal, wrong-root, or protected generated/runtime path. |
| ZIP CRC | PASS | `ZipFile.testzip()` returned `None` before and after inspection. |
| Manifest presence | PASS | `boreal-v2/ARCHIVE_MANIFEST.json`; 432 records. |
| Manifest member hashes/lengths | PASS | 432/432 matched archive bytes. |
| Manifest omissions | PASS | 0 missing; 0 duplicate records; 0 declared deletions. |
| Unmanifested file members | OBSERVED | `ARCHIVE_MANIFEST.json` and `REFERENCE_INDEX.md`, both declared metadata files. |
| Current-tree comparison | OBSERVED | 424 same, 8 different, 0 missing across 432 manifest paths. |

## Historical evidence classification

The archived `IMPLEMENTATION_REPORT.md` and `project/validation/m02/evidence/run-01/` are retained historical records. Their source identity is the archive, while the report itself names an earlier source ZIP. The report states that Rust tests/build/format were blocked, the candidate was not accepted, and fixture/TUI/source-archive results did not establish service lifecycle or release acceptance. These records are useful provenance and discrepancy evidence only. They are not current-tree passes.

## Unresolved findings

- Archive source commit and current checkout HEAD differ.
- Both archive and current checkout are dirty identities; neither dirty state is represented as a commit.
- Eight archive-manifest files differ from current filesystem bytes.
- `bwrk prime --json` could not resolve a project because no identifier was supplied; no identifier was invented and no state was changed.
- Independent review/reconciliation/revalidation and coordinator acceptance remain outstanding.

## Secret handling

No secrets, credentials, tokens, environment values, or live database contents were copied into these artifacts. Only paths, hashes, metadata, command results, and plan-relevant status were recorded.
