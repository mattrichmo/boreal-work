# PF-S00-T01 source and evidence provenance

Status: worker handoff; unaccepted. This record freezes identity and evidence applicability only. It does not accept PF-S00-T01, PF-S00, or the production-completion plan.

## Immutable source lock

- Repository/workspace: `/Users/cybertron/Code/boreal-work`
- Plan: `PF-production-completion-2026-09-21`
- Task: `PF-S00-T01`
- Archive input: `/Users/cybertron/Code/boreal-work/scratch/reference-zips/boreal-v2-reference-20260921T195305840Z.zip`
- Archive SHA-256 before inspection: `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`
- Archive SHA-256 after inspection: `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`
- Archive size: `1,358,639` bytes
- Archive filesystem mtime: `2026-09-21T13:53:06-0600`
- Embedded manifest: `boreal-v2/ARCHIVE_MANIFEST.json`
- Embedded manifest SHA-256: `7093808eafc1d59dac6d6b66e72b59d1a8134a03f800f3436335dc99020e5e26`
- Embedded manifest schema: `boreal.archive-manifest.v1`
- Embedded generation time: `2026-09-21T19:53:05.840Z`
- Embedded source commit: `bed6e7b24372b2e44e791f1265d273fdeb448b9a`
- Embedded source branch: `codex/apply-responsive-terminal-overlay`
- Embedded source dirty flag: `true`
- Immutable baseline identifier: `archive-sha256:09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

The archive manifest is the authority for the delivered source file list and per-file byte/hash records. The complete 432-record manifest-backed inventory is in [source-inventory.json](source-inventory.json). The ZIP itself was preserved unchanged.

## Archive checks

The archive contained 546 unique members, including 434 file members and 112 directory members. ZIP CRC verification returned no bad member. All 432 manifest records were present; every recorded byte count and SHA-256 matched the archive bytes. No unsafe archive member paths were found. No duplicate manifest paths were found. The manifest declared zero deletions. The two file members not listed in `files` were `ARCHIVE_MANIFEST.json` and `REFERENCE_INDEX.md`, both explicitly declared as `metadata_files`.

The archive selector context says the intended included source is text-only content under the declared root/project/crates/TUI/packaging/docs/scripts/skills and related plan paths, with generated/runtime paths excluded. The manifest contains the exact result; no source was regenerated and no omission was silently repaired. Exclusion classes recorded by the selector include `.git`, `.boreal`, `node_modules`, `dist`, `target`, `__pycache__`, `coverage`, `results` subpaths, `test-project/`, and non-text/binary/font/runtime content. This is selector provenance, not a claim that every excluded path existed in this checkout.

## Current working-tree fingerprint

The current working tree is a separate, dirty evidence subject and is not represented as a commit:

- HEAD: `784a41b3802c29a76721c55eef2e9493283396c2`
- Branch: `codex/apply-responsive-terminal-overlay`
- Commit subject: `fix: harden dashboard terminal lifecycle`
- Commit date: `2026-09-21T15:01:13-06:00`
- Dirty: `true`
- Porcelain status entries: `525`
- Snapshot files fingerprinted: `912`
- Deterministic path/size/file-SHA aggregate: `7051bb14d9bdb283235b65e45e78bea9b485318998847173e79dbfc409ed7ea8`

This working-tree fingerprint was captured before writing the PF-S00-T01 output files below. It is the pre-mutation baseline for the task; the newly produced evidence files are intentionally not folded into their own baseline aggregate.

The full porcelain status list is in the machine-readable inventory. The archive manifest source commit does not match the current HEAD. This record deliberately does not describe the dirty checkout as a commit or as the archive’s byte identity.

Comparing the 432 archive-manifest paths with current filesystem bytes found 424 exact matches, 8 different files, and 0 missing paths. The differing paths are:

- `apps/tui/src/full-screen.ts`
- `apps/tui/src/test.ts`
- `crates/cli/src/dashboard.rs`
- `crates/cli/src/setup.rs`
- `crates/cli/tests/dashboard_launcher.rs`
- `crates/cli/tests/evidence_executor_regressions.rs`
- `crates/cli/tests/project_setup.rs`
- `scripts/prepare-test-project.sh`

## Included and excluded identity

Included source is exactly the 432 records under `archive_manifest_files` in [source-inventory.json](source-inventory.json), each with archive-relative path, byte count, and SHA-256. The archive also contains the two declared metadata members above. The archive is a source/review snapshot, not a production binary, installer, published release, or clean checkout.

Excluded/generated/runtime content is not evidence of absence from the current working tree. The archive has no `.git`, target/dist/node_modules, live database, binary/font/runtime member, or manifest-declared deletion. Any later task must use the immutable archive identifier above or a newly recorded source identity after integration; it must not infer identity from the reported commit alone.

## Evidence applicability

| Evidence | Identity | Applicability |
| --- | --- | --- |
| Embedded `ARCHIVE_MANIFEST.json` and its 432 file records | Archive SHA-256 above; generated `2026-09-21T19:53:05.840Z` | Current evidence for archive integrity and archive contents only. |
| `IMPLEMENTATION_REPORT.md` in the archive | Archive bytes; report names an earlier candidate source ZIP `boreal-v2-reference-20260921T175404486Z.zip` | Historical author report retained for context; not independent acceptance and not proof for current dirty-tree bytes. |
| `project/validation/m02/evidence/run-01/checks.json` and retained run files | Archive bytes containing historical evidence; checks timestamp `2026-09-21T18:29:49.530298+00:00` | Historical candidate evidence only. It records 12 passes and 7 Cargo-blocked checks and explicitly says no release decision; it cannot be selected as current-tree acceptance evidence. |
| Historical TUI, installer, PTY, fixture, contract, and source-archive results | The archived candidate/report identity | Historical/fixture-scoped only; not Rust-service, lifecycle, native-platform, publication, or release proof for either the current dirty tree or a future integrated tree. |
| Current working-tree fingerprint | HEAD `784a41…3396c2` plus dirty snapshot aggregate above | Current identity evidence only. No current validation pass is implied by fingerprinting. |
| This task’s archive inspection | Archive SHA-256 above and current working-tree metadata | Fresh evidence for identity, safe paths, CRC, manifest presence, and manifest hashes. It is not application correctness, compilation, service, release, or acceptance evidence. |

## Discrepancies and blockers

1. The archive source commit `bed6e7…448b9a` differs from current HEAD `784a41…3396c2`; the archive also reports a dirty source tree. Both identities are preserved separately.
2. Eight manifest paths differ from current filesystem bytes; none are missing. Historical evidence referring to those bytes is not current-tree evidence.
3. `bwrk prime --json` was attempted from this workspace but returned `outcome: rejected`, `error.code: invalid_argument`, `message: missing project identifier`. No Boreal runtime state was changed. The file-based plan explicitly says its plan IDs are not existing `bwrk` work IDs, so no project identifier was invented.
4. The plan and task card require independent review, reconciliation, and revalidation. This worker did not perform or claim those gates.
5. Historical report context records unavailable Cargo/rustc/rustfmt at the earlier run, absent independent review, and no genuine service/native/published-release proof. Those remain historical unresolved constraints unless later tasks produce fresh evidence.

## Scope boundary

Only the two baseline files and the PF-S00-T01 attempt directory are authorized outputs. No application code, plan graph, coordinator state, Cargo/TUI file, live database, legacy source, secret, or prior evidence was modified.
