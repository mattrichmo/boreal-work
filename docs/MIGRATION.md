# Migration and source disposition

The legacy project remains the behavioral reference during v2 development. It
is not a runtime dependency.

## Candidates for selective migration

- Work hierarchy and basic record validation from `packages/core`.
- Parent and dependency cycle checks from `packages/work-engine` and
  `packages/graph-engine`.
- Atomic write and recovery concepts from `packages/storage`.
- Reservation ownership and expiry concepts from `packages/agent-runtime`.
- Useful TUI read-model and refresh behavior from `packages/ui-model` and
  `apps/tui`, ported into a TypeScript API client.
- Source provenance, cited knowledge, and Git memory concepts from the vault
  and knowledge modules, with a reduced v2 publication model.

## Do not copy into the v2 runtime

- Legacy `FileBorealStore` compatibility paths.
- Duplicate TUI shell/loaders.
- Console fixtures and live-data adapters.
- Global/daemon/MCP orchestration.
- Legacy vault/knowledge implementations, directives, and broad workflow
  verticals. The product memory bank is redesigned in v2 rather than copied.

## Import format

The bounded P4-04 slice is implemented by the dependency-light
`boreal-migration` crate. Its versioned JSON document has the following
top-level shape:

```json
{
  "format": "boreal.v2.migration",
  "version": 1,
  "project": {},
  "work": [],
  "dependencies": [],
  "attempts": [],
  "reservations": [],
  "evidence": [],
  "memory": [],
  "git": []
}
```

The reduced records explicitly cover project identity; milestone, sprint, and
task hierarchy; `closed_only` dependencies; attempt and reservation timing;
evidence/source references; supported memory source/entry references; and Git
repository/commit/citation references. The exporter emits only this shape.
The importer accepts only version `1`, rejects unknown fields within a record,
and returns the raw record in an `unsupported` report entry. Conflicting
identifier aliases such as `id`/`uuid` or `work_id`/`task_id` are returned in
an `ambiguous` entry. Therefore an input record is either represented in the
typed reduced document or retained verbatim in the report; it is never silently
dropped.

## Materialization and export boundary

The crate remains deliberately side-effect free, but it now exposes the
boundary a real store integrator needs:

```rust
let source_plan = boreal_migration::import_legacy_json(input)?;
let export = source_plan.materialize_export()?;
// export.document_json: deterministic v2 migration document
// export.import_plan: ordered, explicit actions plus the full report
// export.import_plan.loss_ledger: every unsupported/ambiguous source record
```

`SourceProvenance` records the legacy format/version, the optional source
`as_of_ms`, and a SHA-256 fingerprint of the exact input bytes. The fingerprint
uses the same `sha256:<64 lowercase hex>` representation as the source engine.
`MigrationDocument::canonicalized` sorts every collection before export, so
equivalent source row order produces the same JSON. Import actions are ordered
by stable collection families and use the explicit `reject_existing` conflict
policy; they are a description for an integrator, not writes performed by this
crate.

Materialization is all-or-nothing. Unsupported fields, unsupported retention
semantics, ambiguous aliases, or failed validation are retained in the
`ImportReport`; an unready `ImportPlan` contains zero actions and `apply`,
`verify`, and `materialize_export` return `MaterializationError::NotReady`.
Consequently a store adapter cannot accidentally apply a partial plan. Failed
records and their raw details remain reportable rather than being discarded.
`LegacyImportPlan::verify` additionally round-trips the canonical document,
checks its SHA-256 identity, and reports exact section counts/action count for
an adapter's expected-base and post-apply checks. These operations remain
side-effect free; a later store adapter owns transactions, checkpoints,
rollback, and durable operation IDs.

The plan also exposes a deterministic `loss_ledger`. Each entry is labelled
`unsupported` or `ambiguous`, retains its original record ID and raw JSON, and
has a human-readable reason. Schema-2-to-v3 compatibility plans expose the
same contract for `historical_only` sprint subjects and proof that must not be
rebound to a new attempt. A migration may be called lossless only when its
ledger is empty; preserving raw data in the ledger does not silently promote
it into trusted v2 state.

## Knowledge integration seams

The knowledge crates provide the application-facing contracts without taking
ownership of SQLite work state or CLI routing:

* `boreal_source::SourceCaptureRequest` plus
  `SourceCatalog::capture_with_operation` is the recoverable source
  registration/capture boundary. The operation ID and request fingerprint are
  durable in the persistent catalog; retries return the same source version,
  changed payloads conflict, and verified blobs become visible only in the
  same metadata snapshot. `SourceCatalog::show_version`, `list_versions`,
  `verify`, `cite`, and `retrieve` are the exact read/verification primitives
  for `source show|list|verify` adapters.
* `boreal_memory::Draft::review`, `Publisher::publish_with_expected_base`,
  `Publisher::reimport`, `MemoryIndex::search`, and `MemoryDoctor` form the
  draft/review/publish/search seam. Git is authoritative only at a verified
  revision. Publication is serialized by an OS-visible lock, appends or
  updates manifest entries without dropping older entries, and reports base
  conflicts rather than overwriting human changes. Application adapters must
  persist draft/job state and operation readback in SQLite; this crate does
  not pretend that a Git commit and a SQLite write are one transaction.
* The application/store owner must map these contracts to versioned DTOs and
  service/CLI routes. It must not make the TUI read `catalog.json`, invoke Git
  directly, or treat a draft/raw source as published memory. It must keep the
  operation ID, source-version IDs, citations, Git revision, and loss ledger
  in the durable result envelope.

Source catalog snapshots are backward-compatible with earlier snapshots that
do not contain capture-operation records. Persistent catalog mutations use a
short cross-process lock and reload the latest snapshot before applying a
capture, so separate workers cannot silently overwrite one another's source
metadata. A stale lock is reported for operator recovery; it is never
force-removed by the library.

The migration crate does not write v2 store rows, publish memory, fetch Git
data, resolve legacy aliases, or infer unsupported lifecycle/dependency
semantics. Those operations remain responsibilities of the eventual store
integrator and its explicit migration policy. `apply` here means validated
in-memory materialization; a public `migration apply` adapter must stage the
document under one durable operation, checkpoint batches, verify the expected
source/document fingerprint, and provide a rollback/restore path before
committing store rows.
