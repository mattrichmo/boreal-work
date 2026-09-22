# PF-S00-T05 external-input register

Inventory timestamp: `2026-09-21` (UTC). This is an input inventory, not a
parity result, acceptance record, migration execution, publication approval, or
release claim.

## Source identity and boundaries

- Workspace: `/Users/cybertron/Code/boreal-work`
- Current checkout HEAD: `784a41b3802c29a76721c55eef2e9493283396c2`
- Coordinator ledger input source: working tree on branch
  `codex/apply-responsive-terminal-overlay`, dirty, accepted aggregate
  `419d74713fcc64ef371322582943a3e820c75e7b8a2b142c119f800ae8d3317f7`
- Accepted PF-S00-T01 state: `execution/STATE.json` records `accepted` by the
  coordinator. Its linked handoff still contains the phrase “not accepted”; the
  stale handoff wording is preserved as a discrepancy, not resolved by guesswork.
- Fresh v2 baseline archive: `scratch/reference-zips/boreal-v2-reference-20260921T195305840Z.zip`,
  SHA-256 `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`.
  Its ZIP root is `boreal-v2/`; it contains no `v1/` or `boreal-v1/` members.
- The plan is marked `not_adopted` in `execution/STATE.json`; all observations
  below remain proposed execution evidence.

## Required external inputs

The status below uses `available` only for an input present in the repository in
the required form. A present fragment does not make an incomplete capability
available; incomplete required capabilities are marked `missing` with the
observed fragment recorded. `restricted` means a named input was intentionally
not opened because it may contain live/private state or credentials.

| ID | Required input | Status | Supplied or observed evidence | Missing/restricted boundary | Downstream gate |
| --- | --- | --- | --- | --- | --- |
| `EXT-LEGACY` | Representative original v1 archives/exports and retained behavior evidence | `available` with completeness limits | `v1/` source tree; `v1/reference-zips/boreal-v1-reference.zip` (1,526,770 bytes, SHA-256 `5980e75e6580a31399519c5d1d2ee2accbe49c2dd5f3cbf77d827fed14b8d7d7`); `.boreal` JSONL ledgers and manifest; v1 schemas, workflows, CLI sources, tests, and memory export are present. | The source/data set is not part of the fresh v2 T01 archive; no completeness certification or v1-to-v2 parity proof is supplied. Raw SQLite/cache files remain restricted. | `PF-S12-T01`; retained legacy parity also blocks PF-S12 and final cutover until migrated/revalidated. |
| `EXT-MACOS` | Real executors for every approved macOS architecture and runtime | `missing` for full coverage | Current executor is real macOS 15.2, arm64 (`Darwin 24.2.0 arm64`); Cargo, rustc, Node, pnpm, and bwrk are discoverable. | No executed x86_64 macOS executor is supplied. GitHub labels are declarations, not execution evidence. | `PF-S18-T08`; native package qualification and PF-S20 remain blocked for missing target coverage. |
| `EXT-LINUX` | Real executors for every approved Linux architecture and runtime | `missing` | CI/release files declare Ubuntu x86_64 runners; no Linux executor was available in this workspace inspection. | Cross-compilation or workflow labels do not prove a native installed-package run. | `PF-S18-T08`; PF-S20 exact-artifact qualification remains blocked. |
| `EXT-HARNESSES` | Two supported agent harness entry points and model-operated sessions | `missing` | Repository validation has scripted CLI/service, process, PTY, fault, concurrency, and TUI harnesses; v1 has packaged skill/workflow source. | No attributable pair of model-operated harness sessions or external harness identities is supplied. Scripted/synthetic harnesses cannot close the model-operated gate. | `PF-S14-T07`. |
| `EXT-INDEPENDENT-REVIEW` | Independent reviewer capacity and attributable review identities | `missing` | `PF-S00-T90` requires `EXT-INDEPENDENT-REVIEW`; `STATE.json` has no reviewer for PF-S00-T05 or PF-S00-T90 and no named independent reviewer identity is supplied. | Coordinator/author self-review is not independent review. | `PF-S00-T90`; sprint exit requires T90 → T91 → T92. |
| `EXT-RELEASE-AUTHORITY` | Explicit release-owner approval, signing/publishing rights, and credentials | `missing` / `restricted` | `.github/workflows/release.yml` declares GitHub Release publishing with `contents: write` and optional Homebrew publication using `HOMEBREW_TAP_TOKEN`; `docs/RELEASE.md` names clean tags, exact artifacts, and install verification. | No approval, signing identity, GitHub token, Homebrew token, release owner, or authorized publication operation is supplied or accessed. | `PF-S20-T08`; PF-S21 publication and operational handover require separate actual authorization. |

No required input was classified `not_applicable`. The missing inputs are
external constraints, not passes and not reasons to invent fixtures.

## Legacy source and record inventory

The available raw export is `v1/.boreal/ledgers/manifest.json`, exported at
`2026-08-17T15:30:38.880Z`, schema `boreal.ledgers.v1`. It reports the counts
below. Counts are inventory facts only; the v2 migration must retain source IDs,
raw payloads, provenance, failed history, and ambiguity dispositions.

| Completeness area | Available source/count | Classification and implication |
| --- | --- | --- |
| Work | `work-items.jsonl`: 565 records; 6 deleted-record tombstones; statuses: 473 `closed`, 50 `ready`, 42 `blocked`; kinds: 353 task, 60 sprint, 59 milestone, 93 issue | Available representative work corpus. Legacy status words are not v2 acceptance; validate parents, gates, source identity, and closeout provenance in PF-S12. |
| Dependencies | `graph-edges.jsonl`: 902 directed edges | Available dependency history. Dangling endpoints, cycles, duplicate edges, and stored-vs-derived readiness are not certified by the count. PF-S12 hierarchy/dependency migration must preserve or explicitly review them. |
| Reviews | No dedicated review ledger; `reviewer-heartbeats.jsonl` has 0 records; 95 evidence records have `kind=review`; 499 verification records exist | Review-like evidence is present, but independent reviewer identity/capacity and a separate review decision authority are not supplied. Do not treat review-kind evidence as independent review. PF-S00-T90 and PF-S08 remain required. |
| Failed receipts | `evidence.jsonl`: 786 records, including 1 `failed`, 154 `observed`, 631 `passed`; `verifications.jsonl`: 499 records, including 1 failed verdict | Failed facts exist and must remain retained. Passed counts do not prove trusted v2 gates; attestation, subject, source snapshot, and freshness require migration review. |
| Overrides/waivers | No dedicated override or waiver record section in the exported manifest; no override/force/waiver fields were found in the inspected top-level ledger records | Missing durable override history is an explicit gap, not evidence that overrides never occurred. Historical force/waiver command semantics require source-backed recovery or an operator-review disposition. Downstream `PF-S08-T04`, `PF-S08-T05`, and PF-S12. |
| Attempts/runs | `runs.jsonl`: 0; `run-checkpoints.jsonl`: 0; `event-cursors.jsonl`, `context-packs.jsonl`, and `projections.jsonl`: 0 | Durable v1 execution-run/checkpoint records are absent from this export. Reservations and summaries cannot be silently upgraded into v2 attempt proof. Downstream PF-S02/PF-S06/PF-S12. |
| Reservations | `reservations.jsonl`: 400 records; 399 `released`, 1 `expired` | Ownership history is available, with no active reservation in this export. It is not proof of productive execution; preserve row identity, timestamps, Git metadata, and expiry/review semantics. |
| Summaries | `agent-summaries.jsonl`: 486 records; 485 `final`, 1 `draft`; 144 `legacy_backfill` | Summary history is available. Legacy backfill, dirty paths, commits, and summary prose cannot satisfy stronger v2 gates without subject and evidence checks. |
| Memory/source | `knowledge-sources.jsonl`: 2; `v1/memory/raw/index.jsonl`: 9; v1 memory has 10 wiki pages, 2 work pages, 1 dashboard page, and 487 agent-summary Markdown files; v1 markdown export has 418 files | Source-backed memory is present but split across `.boreal` records and a dirty separate memory Git checkout (`v1/memory`, HEAD `c5926ef0999786d77006a97761918476013dafcd`). Publication state, broken references, and Git provenance require PF-S11/PF-S12 review. |
| Event/audit history | `events.jsonl`: 6,505; `deletions.jsonl`: 7 | Historical event and deletion records are present. They are provenance inputs, not proof that every event has a lossless v2 mapping. |

## Raw source hashes

Hashes are SHA-256 of bytes at the paths shown. Hashes identify inputs; they do
not certify semantic completeness.

| Raw source | Bytes | SHA-256 |
| --- | ---: | --- |
| `v1/reference-zips/boreal-v1-reference.zip` | 1,526,770 | `5980e75e6580a31399519c5d1d2ee2accbe49c2dd5f3cbf77d827fed14b8d7d7` |
| `v1/reference-zips/boreal-v2-reference.zip` | 469,275 | `8f55f699b10eaa2d342391349fed4f869e5a979aab8c7d28227fad6b19d469c2` |
| `scratch/reference-zips/boreal-v2-reference-20260921T195305840Z.zip` | 1,358,639 | `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c` |
| `v1/.boreal/ledgers/manifest.json` | 4,842 | `53236e7ffc7a989f8287a28796c6fef0f06d67bfc4c80233c035e9132fea0890` |
| `v1/.boreal/ledgers/work-items.jsonl` | 1,134,421 | `b55758a52d89b5b612a5619087488ebd70c9e409cd8b55966714eecfd6c16f6e` |
| `v1/.boreal/ledgers/evidence.jsonl` | 765,913 | `f749bba549efc021525a5d7ba175612cd41c802073bdd494d5eb98d2e51e8645` |
| `v1/.boreal/ledgers/reservations.jsonl` | 249,875 | `7e606289fc587c8239fcfbc6c972ff31552e1b29a5486fbe0ebf1bdc5d861e3b` |
| `v1/.boreal/ledgers/agent-summaries.jsonl` | 1,162,954 | `41d57e1d6a9e4126cd8837807da089c6c89fe9fd8a73f4aca88a9d97de7cbf42` |
| `v1/apps/cli/src/command-registry.ts` | 242,832 | `94e7bb5e72ba11b65597883cc3d67eb352ca060cfa529059231f43229ee5428d` |
| `v1/apps/cli/src/import-export.ts` | 103,058 | `f60b50cfe71f932247a0032c968eaa3d16b1901dfe83ec1f884f772e9298be01` |
| `project/spec/schema-v2.sql` | 19,298 | `ae5febe8a491404f7cc4103164b82369b24fb19977239a00860978b30ca545e1` |
| `project/spec/schema-v3.sql` | 21,795 | `c8c47ab7202a0db3e9ae73196827c04ab116b4ddaa19d4cd8760fcb395051d74` |

The complete 26-file v1 JSON-schema set is present under `v1/schemas/` (12
record schemas, 3 project schemas, 3 projection schemas, 2 run schemas, and
one each for directives, enforcement, events, operations, policies, and work
structure templates). Its deterministic path/hash aggregate is
`464ef11756c68794ae15033499dcd4318d277d0542924504422f885a2c0a1939`.

## Historical command, harness, and ownership notes

- v1 command inputs are present in 29 command modules, 183 command-definition
  entries in `v1/apps/cli/src/command-registry.ts`, 43 workflow Markdown files,
  and 96 runtime tests. The v1 CLI manual is 2,329 lines. The current v2
  registry exposes 80 Rust command specs and the M02 command inventory has 80
  routes, but that v2 registry is explicitly not a proof of v1 completeness.
- Actual repository harnesses are present: creation/lifecycle black-box suite,
  aggregate full suite, process claim race and soak, PTY TUI smoke, production
  host service probe, concurrency probe, fault/reorder matrix, security probe,
  source-archive check, and release identity/package smoke scripts. Their own
  READMEs distinguish synthetic/fixture, one-process, early-matrix, and
  production-composition scopes. None were rerun as part of this inventory, so
  no harness pass is claimed here.
- The checked-out machine is one real macOS arm64 executor. Release workflow
  declarations cover macOS arm64, macOS x86_64, and Linux x86_64; only the first
  is observed locally. No Linux or macOS x86_64 executor was observed.
- The coordinator ledger has no reviewer assigned to PF-S00-T05 or PF-S00-T90.
  The independent review chain remains a required external capability.
- Release workflow files declare artifact build/publish steps and optional
  Homebrew publication. They do not supply an actual release owner, approval,
  signing identity, or credentials. No publication operation was attempted.

## Restricted and absent inputs

The following were identified by filename or plan reference but not opened:

- `.boreal/boreal.sqlite`, `test-project/.boreal/**/boreal.sqlite`, and
  `v1/.boreal/cache/*.sqlite`: local/live or derived SQLite stores; JSONL
  exports are the read-only inventory surface for this task.
- `v1/.claude/settings.local.json`, credential/secret-named paths, and any
  release tokens: restricted; no contents or values were accessed.
- Native Linux and macOS x86_64 runners, two attributable model-operated
  harness sessions, an independent reviewer, and release/signing authority:
  not supplied in the repository and remain external blockers.

These missing or restricted inputs must be acquired or explicitly dispositioned
before their named gates. No v1 record, executor, reviewer, or credential was
invented, and no v2 parity or cutover claim follows from this inventory.
