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

The crate does not write v2 store rows, publish memory, fetch Git data, resolve
legacy aliases, or infer unsupported lifecycle/dependency semantics. Those
operations remain responsibilities of the eventual store integrator and its
explicit migration policy.
