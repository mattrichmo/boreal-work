# Vertical 07 — legacy data migration and parity

Task IDs: P0-04, P4-04, P4-07–P4-09, P5-08. Read
[`../../docs/MIGRATION.md`](../../../docs/MIGRATION.md),
[`../TASK_INDEX.md`](../TASK_INDEX.md), and the
[audit baseline](../../AUDIT_BASELINE.md).

## Outcome and ownership

A fresh v2 project can import supported v1 data with a preview, mapping
report, backup, and rollback path. Migration preserves historical failures and
provenance instead of manufacturing a clean closeout.

Own only the eventual `crates/migration/`, fixture/export tooling,
`tests/migration/`, and migration docs. The store/schema owner must approve
schema changes; the memory owner must approve published-memory conversion.
Do not edit live v1 `.boreal` data or mutate v1 state during discovery.

## Prerequisites

- P0-07: frozen v2 IDs/schema and explicit memory authority.
- P3-09: memory publication/import contract and source-version handling.
- Representative v1 fixtures: object store and file-store legacy variants,
  active and historical reservations, attempts, failed receipts, dirty Git
  state, memory sources, and malformed records.

## Build steps

1. Inventory actual v1 record variants and create a mapping matrix with
   `preserved`, `transformed`, `historical-only`, and `unsupported` outcomes.
   Distinguish task containment from dependency edges; do not infer parents
   from blockers.
2. Implement a read-only v1 exporter against pinned fixture snapshots.
   Export stable IDs, source digests, record revisions, event/operation
   provenance, and an explicit source version manifest. Never use current v1
   modules as a v2 runtime dependency.
3. Implement v2 import dry run: validate schema, parent/dependency cycles,
   active-attempt uniqueness, source/blob availability, Git refs, and policy
   conflicts. Show exact created/merged/skipped/unsupported counts and paths.
4. Implement transactional import batches with an idempotent import operation
   ID and checkpoint. A crash can resume without duplicating tasks, attempts,
   audit events, or memory publications.
5. Define status mapping for v1 terminal/verification states. Preserve
   ambiguous states as historical data requiring operator disposition; do not
   silently convert them to done or ready.
6. Add a side-by-side report comparing v1 and v2 work hierarchy, blockers,
   active claims, evidence references, and memory citations. Include a
   supported rollback/restore procedure before cutover.

## Acceptance and failures

- Import into a fresh v2 directory leaves the v1 fixture unchanged.
- A second import with the same operation identity is a no-op or explicit
  merge, not a duplicate.
- Missing blobs, invalid links, duplicate active reservations, and stale Git
  refs appear in the dry-run report with a specific disposition.
- Failed evidence and superseded attempts remain inspectable after import.
- A fixture with mixed parent and dependency relationships retains the exact
  hierarchy and blocker semantics.
- Crash after export, before v2 commit, and between import batches resumes
  safely; rollback restores the pre-import v2 snapshot.

Handoff evidence: mapping matrix, dry-run JSON, before/after record counts,
integrity check, sample task/memory readback, schema versions, source snapshot,
and known unsupported records. Review findings flow through P4-07 -> P4-08 ->
P4-09 before migration can be called complete.
