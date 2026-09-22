# Source, curated memory, and retained legacy parity contract

**Contract:** `boreal.source-memory/2`
**Status:** proposed PF-S01-T10 artifact; target contract only.

## Project-scoped source intake

Source is evidence and context, never trusted workflow authority. Every intake
record is project-scoped and immutable at a named version:

```text
source_id, project_id, source_kind, locator, content_digest,
source_version_id, imported_at, importer_identity, parser/version,
visibility, citation_manifest, parse_state, retention_state
```

Supported kinds are local file/tree, Git revision, command output/artifact,
structured external export, and human note/draft. The original bytes or
content digest, locator, parser version, extraction errors, and import
operation remain available. Parser failure produces a retained failed intake
with diagnostics; it does not produce empty trusted content.

Retrieval is filtered by selected project, source visibility, named revision,
and citation/provenance policy. A source from another project cannot enter
retrieval, handoff context, or gate authorization without an explicit
project-scoped import/grant that preserves origin and digest.

Claims cite source ID/version, locator or span, digest, extraction method, and
retrieval time. Changing source bytes, parser policy, or relevant work policy
invalidates proof that declared the old source context and creates a new proof
generation; it does not delete the old source or receipt.

## Live notes versus curated memory

SQLite owns operational work, raw intake, drafts, notes, citations, and
publication jobs. Git at a named revision owns published curated project
memory. Publication is a durable recoverable job with stages:

```text
draft -> reviewed -> publish_requested -> git_committed
       -> database_reconciled | reconcile_required | rejected
```

The publication record binds project, source/claim citations, expected Git
parent, content manifest, publisher identity, operation ID, and resulting Git
commit. If Git commits and the database write fails, readback/reconciliation
records the actual commit rather than creating a second commit or reporting
false failure. If Git rejects, the draft and error remain. Human edits in a
fresh clone are preserved through explicit merge/review, never overwritten by
automatic reimport.

Published memory is context, not an executable directive. Agent guidance may
cite it, but only registered versioned directives and current service
decisions can authorize work, evidence, closeout, or overrides.

Handoff capsules bind work/attempt/submission/proof revision, source and
configuration identities, citations, unresolved issues, resource state, and
next safe action. Chat history or a raw source excerpt is insufficient.

## v1 parity and dispositions

The known v1 meanings are retained as an explicit disposition, not silently
dropped:

| Legacy behavior | v2 disposition | Limitation / migration proof |
| --- | --- | --- |
| `guide`, `next`, conditional status, claim/finish evidence path | preserve/rework | Must use the Rust decision/action contract; no bespoke parent prompt |
| work/task/milestone/sprint planning | preserve with cycle compatibility | Sprint is a scheduling facade, not a second mutable parent |
| evidence, review, attempts, expiry, health/doctor | preserve/rework | Structured proof, rejected review, and recovery obligations remain visible |
| project-scoped memory/raw intake | preserve/rework | SQLite drafts, Git curated memory, citations and recovery readback |
| global manager/web console | defer with user-visible limitation | Local project-scoped CLI/TUI is the launch boundary |
| remote multi-host claims/automatic agent spawning | defer | Requires later authenticated network/dispatch boundary |
| historical `done`/`complete`/`verified` | historical-only until analyzed | Never becomes accepted v2 `closed` by vocabulary alone |

The detailed parity decisions below are also binding migration inputs:

| Legacy behavior | v2 disposition | Acceptance boundary |
| --- | --- | --- |
| raw-ready status filter versus dependency-valid `--ready`/eligible-next | preserve/rework | Keep raw status filtering distinct from claimable-next; stale snapshots never authorize a claim. |
| `agent start` resume-first behavior | preserve | Resume the actor/session's current attempt before any pull; conflicting session is rejected, not silently adopted. |
| `paused`, `operator_only`, and automatic dispatch policy | preserve/rework | Keep policy separate from status; release/expiry never promotes operator-only or paused work. |
| manual claim/adoption of an already-started session | preserve/rework | Same fenced claim/accept schema, authenticated actor+harness+session, idempotent operation, no conflicting adoption. |
| evidence trust levels: legacy, self-reported, Boreal-witnessed, external | preserve/rework | Store trust provenance separately from result; a passed sentence/command/Git history never upgrades trust. |
| verification, review, audit, and checkpoint gates | preserve/rework | Typed profile requirements, observations, decisions, open/satisfied/forced readback; failed evidence remains visible. |
| directive bundles, workflow registry, and `nextCommandPath` guidance | preserve/rework | Trusted versioned registry/action descriptors only; missing or unknown workflow fails closed rather than guessing. |
| `agent finish --close` versus `--release` | preserve | One fenced proof/verify/summary/close-or-release operation; release never means done. |
| direct `work close` and forced close paths | rework/defer | Operator/migration-only recovery under the same Rust gate authority; never a normal agent bypass. |
| legacy file/object-store compatibility | defer after explicit mapping | Preserve raw payload and unsupported/ambiguous disposition; no broad compatibility layer may weaken v2 authority. |

The original v1 records and some platform inputs were not supplied for
inspection. The migration disposition carries the concrete ambiguity register:

| Baseline blocker | Explicit source and owner | Named fixture / expected shape / disposition |
| --- | --- | --- |
| `AMB-01` unknown blocked/schema/dangling reference | `project/legacy-map/RECORD_MAPPING.md#AMB-01`; P0-05/P0-06 | `MIG-AMB-01` with `{raw_payload, status, refs, project_id?}`; retain raw payload, `unsupported`/operator review, never guess ready/success. |
| `AMB-02` verified prerequisite may have released successors | `project/legacy-map/RECORD_MAPPING.md#AMB-02`; P0-01/P0-06 | `MIG-AMB-02` with `{predecessor, successor, historical_release_event}`; preserve release and edge policy, graph review before requeue/reclose. |
| `AMB-03` cancelled prerequisite may have satisfied an edge | `project/legacy-map/RECORD_MAPPING.md#AMB-03`; P0-01/P0-03 | `MIG-AMB-03` with `{cancelled_work, edge_id, successor}`; preserve cancellation and require replacement/waiver. |
| `AMB-04` stale/absent active reservation | `project/legacy-map/RECORD_MAPPING.md#AMB-04`; P0-02/P0-05 | `MIG-AMB-04` with `{reservation, attempt?, expires_at?, resource/worktree}`; fence/review live process or worktree, never auto-steal. |
| `AMB-05` duplicate active reservations/operations | `project/legacy-map/RECORD_MAPPING.md#AMB-05`; P0-05 | `MIG-AMB-05` with `{attempts[], reservations[], operation_ids[]}`; import all history, choose current only with identity/revision evidence. |
| `AMB-06` closed without valid summary/source/gates | `project/legacy-map/RECORD_MAPPING.md#AMB-06`; P0-01/P0-03 | `MIG-AMB-06` with `{closed_row, summary?, source?, gates[]}`; historical-only until revalidation or explicit backfill decision. |
| `AMB-07` unattested passing evidence | `project/legacy-map/RECORD_MAPPING.md#AMB-07`; P0-03 | `MIG-AMB-07` with `{receipt, result, attestation?, output_digest?, subject?}`; retain `legacy_unattested`, cannot satisfy witnessed proof. |
| `AMB-08` moved raw/source/wiki IDs | `project/legacy-map/RECORD_MAPPING.md#AMB-08`; P0-04/P4-04 | `MIG-AMB-08` with `{legacy_uri, legacy_id, branch/path, content_digest?}`; preserve locator and versioned import map, broken link review. |
| `AMB-09` stale context/search projections | `project/legacy-map/RECORD_MAPPING.md#AMB-09`; P0-07/P3-09 | `MIG-AMB-09` with `{projection_revision, canonical_revision, entries[]}`; rebuild from canonical records and mark stale, never import as fact. |
| `AMB-10` orchestration/worktree outlives importer | `project/legacy-map/RECORD_MAPPING.md#AMB-10`; P0-05/P5-02 | `MIG-AMB-10` with `{assignment, process?, worktree?, owner?}`; historical assignment until ownership check, no auto-redispatch. |
| `AMB-11` global records outside v2 checkout | `project/legacy-map/RECORD_MAPPING.md#AMB-11`; P5-08 | `MIG-AMB-11` with `{global_project_id, root?, source_digest}`; preserve reference/export only and reject cross-project import. |
| `AMB-12` unknown schema/malformed JSON | `project/legacy-map/RECORD_MAPPING.md#AMB-12`; P0-04/P0-07 | `MIG-AMB-12` with `{raw_bytes, parser_version?, schema_version?, error}`; retain raw bytes and failure receipt, classify unsupported. |

These absent-input rows are blockers with named owners and fixtures. This
document does not claim parity from an inventory alone.

## Backup, retention, and invalidation

Project backup binds the operational database snapshot to referenced source
blobs, receipt/artifact manifests, published-memory Git commit, and restore
epoch. Restore is an explicit rebind/restore/new-project outcome; copied
metadata cannot silently select another project's source or memory.

Garbage collection roots include current work/proof/attempts, all historical
audit and review references, open operations/jobs, published-memory manifests,
source citations, backup manifests, and migration maps. Unreferenced bytes are
marked before deletion and recoverable within the retention policy. Failed
parser outputs, rejected proof, and superseded memory remain until their
retention decision is audited.

## Protocol, authority, and acceptance limits

Source/memory responses include project ID, source/version/digest, citation
locators, publication state, Git commit readback, parser/retention state, and
cross-project grant provenance. Publisher authority is authenticated and
reasoned; source text cannot grant roles or satisfy gates. Protocol clients
that cannot preserve project scope or citation identity fail closed for
imports/publication and may read bounded diagnostics.

PF-S01-T11 integrates this contract; PF-S02 owns import/restore/publication
jobs, retention/backup, migration, and real-service acceptance. The current
workspace has partial source/memory plumbing and retained parity inventories;
this document does not claim that v1 data or release behavior was fully
reverified.

## Conformance and traceability

Acceptance covers parser failure retention, project-filtered retrieval,
cross-project import denial, source-edit proof invalidation, interrupted Git
publication/reconciliation, human-edit preservation, backup/restore identity,
GC roots, missing legacy inputs, historical terminal vocabulary, and guided
no-goal workflows through CLI/service/TUI. Evidence names exact source,
database, Git commit, operation, citation, and installed binary identities.

This contract consumes D07–D12, D16, D24–D26, D29, the accepted identity,
planning, profile, and execution contracts, `WORKFLOW_PARITY.md`, and the
approved local-launch deferrals. Any change to source authority, publication
stages, parity disposition, or retention requires a versioned reviewed
decision and fixture update.
