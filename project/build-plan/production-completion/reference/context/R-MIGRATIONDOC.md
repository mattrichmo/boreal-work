# R-MIGRATIONDOC — docs/MIGRATION.md

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `docs/MIGRATION.md:L1–L142`  
**File SHA-256:** `e124d04afccd8a1ffde4c85f52f01396d5d4df7d846946fecc2b880e55c79bd8`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Current import/export behavior and stated provenance/compatibility limits.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,142p' 'docs/MIGRATION.md'
```

## Exact baseline excerpt

````text
    1 | # Migration and source disposition
    2 | 
    3 | The legacy project remains the behavioral reference during v2 development. It
    4 | is not a runtime dependency.
    5 | 
    6 | ## Candidates for selective migration
    7 | 
    8 | - Work hierarchy and basic record validation from `packages/core`.
    9 | - Parent and dependency cycle checks from `packages/work-engine` and
   10 |   `packages/graph-engine`.
   11 | - Atomic write and recovery concepts from `packages/storage`.
   12 | - Reservation ownership and expiry concepts from `packages/agent-runtime`.
   13 | - Useful TUI read-model and refresh behavior from `packages/ui-model` and
   14 |   `apps/tui`, ported into a TypeScript API client.
   15 | - Source provenance, cited knowledge, and Git memory concepts from the vault
   16 |   and knowledge modules, with a reduced v2 publication model.
   17 | 
   18 | ## Do not copy into the v2 runtime
   19 | 
   20 | - Legacy `FileBorealStore` compatibility paths.
   21 | - Duplicate TUI shell/loaders.
   22 | - Console fixtures and live-data adapters.
   23 | - Global/daemon/MCP orchestration.
   24 | - Legacy vault/knowledge implementations, directives, and broad workflow
   25 |   verticals. The product memory bank is redesigned in v2 rather than copied.
   26 | 
   27 | ## Import format
   28 | 
   29 | The bounded P4-04 slice is implemented by the dependency-light
   30 | `boreal-migration` crate. Its versioned JSON document has the following
   31 | top-level shape:
   32 | 
   33 | ```json
   34 | {
   35 |   "format": "boreal.v2.migration",
   36 |   "version": 1,
   37 |   "project": {},
   38 |   "work": [],
   39 |   "dependencies": [],
   40 |   "attempts": [],
   41 |   "reservations": [],
   42 |   "evidence": [],
   43 |   "memory": [],
   44 |   "git": []
   45 | }
   46 | ```
   47 | 
   48 | The reduced records explicitly cover project identity; milestone, sprint, and
   49 | task hierarchy; `closed_only` dependencies; attempt and reservation timing;
   50 | evidence/source references; supported memory source/entry references; and Git
   51 | repository/commit/citation references. The exporter emits only this shape.
   52 | The importer accepts only version `1`, rejects unknown fields within a record,
   53 | and returns the raw record in an `unsupported` report entry. Conflicting
   54 | identifier aliases such as `id`/`uuid` or `work_id`/`task_id` are returned in
   55 | an `ambiguous` entry. Therefore an input record is either represented in the
   56 | typed reduced document or retained verbatim in the report; it is never silently
   57 | dropped.
   58 | 
   59 | ## Materialization and export boundary
   60 | 
   61 | The crate remains deliberately side-effect free, but it now exposes the
   62 | boundary a real store integrator needs:
   63 | 
   64 | ```rust
   65 | let source_plan = boreal_migration::import_legacy_json(input)?;
   66 | let export = source_plan.materialize_export()?;
   67 | // export.document_json: deterministic v2 migration document
   68 | // export.import_plan: ordered, explicit actions plus the full report
   69 | // export.import_plan.loss_ledger: every unsupported/ambiguous source record
   70 | ```
   71 | 
   72 | `SourceProvenance` records the legacy format/version, the optional source
   73 | `as_of_ms`, and a SHA-256 fingerprint of the exact input bytes. The fingerprint
   74 | uses the same `sha256:<64 lowercase hex>` representation as the source engine.
   75 | `MigrationDocument::canonicalized` sorts every collection before export, so
   76 | equivalent source row order produces the same JSON. Import actions are ordered
   77 | by stable collection families and use the explicit `reject_existing` conflict
   78 | policy; they are a description for an integrator, not writes performed by this
   79 | crate.
   80 | 
   81 | Materialization is all-or-nothing. Unsupported fields, unsupported retention
   82 | semantics, ambiguous aliases, or failed validation are retained in the
   83 | `ImportReport`; an unready `ImportPlan` contains zero actions and `apply`,
   84 | `verify`, and `materialize_export` return `MaterializationError::NotReady`.
   85 | Consequently a store adapter cannot accidentally apply a partial plan. Failed
   86 | records and their raw details remain reportable rather than being discarded.
   87 | `LegacyImportPlan::verify` additionally round-trips the canonical document,
   88 | checks its SHA-256 identity, and reports exact section counts/action count for
   89 | an adapter's expected-base and post-apply checks. These operations remain
   90 | side-effect free; a later store adapter owns transactions, checkpoints,
   91 | rollback, and durable operation IDs.
   92 | 
   93 | The plan also exposes a deterministic `loss_ledger`. Each entry is labelled
   94 | `unsupported` or `ambiguous`, retains its original record ID and raw JSON, and
   95 | has a human-readable reason. Schema-2-to-v3 compatibility plans expose the
   96 | same contract for `historical_only` sprint subjects and proof that must not be
   97 | rebound to a new attempt. A migration may be called lossless only when its
   98 | ledger is empty; preserving raw data in the ledger does not silently promote
   99 | it into trusted v2 state.
  100 | 
  101 | ## Knowledge integration seams
  102 | 
  103 | The knowledge crates provide the application-facing contracts without taking
  104 | ownership of SQLite work state or CLI routing:
  105 | 
  106 | * `boreal_source::SourceCaptureRequest` plus
  107 |   `SourceCatalog::capture_with_operation` is the recoverable source
  108 |   registration/capture boundary. The operation ID and request fingerprint are
  109 |   durable in the persistent catalog; retries return the same source version,
  110 |   changed payloads conflict, and verified blobs become visible only in the
  111 |   same metadata snapshot. `SourceCatalog::show_version`, `list_versions`,
  112 |   `verify`, `cite`, and `retrieve` are the exact read/verification primitives
  113 |   for `source show|list|verify` adapters.
  114 | * `boreal_memory::Draft::review`, `Publisher::publish_with_expected_base`,
  115 |   `Publisher::reimport`, `MemoryIndex::search`, and `MemoryDoctor` form the
  116 |   draft/review/publish/search seam. Git is authoritative only at a verified
  117 |   revision. Publication is serialized by an OS-visible lock, appends or
  118 |   updates manifest entries without dropping older entries, and reports base
  119 |   conflicts rather than overwriting human changes. Application adapters must
  120 |   persist draft/job state and operation readback in SQLite; this crate does
  121 |   not pretend that a Git commit and a SQLite write are one transaction.
  122 | * The application/store owner must map these contracts to versioned DTOs and
  123 |   service/CLI routes. It must not make the TUI read `catalog.json`, invoke Git
  124 |   directly, or treat a draft/raw source as published memory. It must keep the
  125 |   operation ID, source-version IDs, citations, Git revision, and loss ledger
  126 |   in the durable result envelope.
  127 | 
  128 | Source catalog snapshots are backward-compatible with earlier snapshots that
  129 | do not contain capture-operation records. Persistent catalog mutations use a
  130 | short cross-process lock and reload the latest snapshot before applying a
  131 | capture, so separate workers cannot silently overwrite one another's source
  132 | metadata. A stale lock is reported for operator recovery; it is never
  133 | force-removed by the library.
  134 | 
  135 | The migration crate does not write v2 store rows, publish memory, fetch Git
  136 | data, resolve legacy aliases, or infer unsupported lifecycle/dependency
  137 | semantics. Those operations remain responsibilities of the eventual store
  138 | integrator and its explicit migration policy. `apply` here means validated
  139 | in-memory materialization; a public `migration apply` adapter must stage the
  140 | document under one durable operation, checkpoint batches, verify the expected
  141 | source/document fingerprint, and provide a rollback/restore path before
  142 | committing store rows.
````
