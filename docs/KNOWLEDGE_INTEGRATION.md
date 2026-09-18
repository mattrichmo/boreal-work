# Knowledge integration boundary

`boreal-application::KnowledgeApplication` is the application-facing seam for
source, curated memory, and migration workflows. It composes the existing
`boreal-source`, `boreal-memory`, and `boreal-migration` libraries; it does not
duplicate their storage or validation logic and it does not open SQLite.

## Operation and provenance rules

Every mutating or potentially expensive adapter result includes:

- an operation ID supplied by the caller (search derives a deterministic read ID);
- a canonical request digest;
- an explicit durability level; and
- project, source-version, content, memory-entry, Git, or migration provenance
  where applicable.

The caller must retain that envelope in its durable operation/readback layer.
The underlying source catalog and memory publisher also persist their own
operation identities, so a lost response can be reconciled before retrying.

## Public adapter operations

| Area | Application method | Authority / result |
| --- | --- | --- |
| Source | `capture_source`, `show_source`, `list_sources`, `verify_source`, `cite_source`, `search_sources` | Content-addressed source catalog; capture is retryable and immutable. |
| Memory | `draft_memory`, `review_memory`, `publish_memory`, `search_memory`, `rebuild_memory_index` | Draft/review values are application results; accepted publication is a Git commit guarded by an expected manifest base. Search is a rebuildable published-Git projection. |
| Migration | `migration_dry_run`, `verify_migration`, `apply_migration` | Deterministic validation and loss accounting. Apply stages a validated document in memory until a live store materializer is connected. |

### Source registration

`capture_source` durably records the immutable blob and catalog operation in
one source-catalog operation. When a SQLite store is available, use
`capture_source_with_store` (or `register_captured_source`) to commit the
canonical `source_version` row through the store's `source.register` operation.
The operation is idempotent, binds the complete immutable metadata digest, and
can be reconciled with `SqliteStore::operation` plus
`SqliteStore::source_version` after a lost response. The catalog-only method
continues to return `StoreRegistrationPending` deliberately; it never claims
that a relational row exists when no store was supplied.

The store adapter records metadata only. Source bytes remain in the
content-addressed catalog/blob authority, and missing or corrupt blobs are
represented conservatively as `missing` or `quarantined` in SQLite.

Missing or corrupt blobs are reported as unavailable. A declared digest is not
returned as a verified digest unless the bytes were actually read and checked.

### Memory publication

Only an accepted, cited draft can be published. The caller supplies a fresh
publication operation ID, separate from draft and review operations. The
publisher persists the operation in the managed Git manifest and accepts an
optional expected manifest identity. A changed base returns a conflict; it is
not silently merged. Repeating the same operation is a duplicate readback.

The memory index is derived and disposable. It must be rebuilt from the
committed Git manifest before search; search results carry the Git and index
revision so stale projections are visible.

### Migration

Dry-run detects both the current migration format and the legacy format,
retaining the exact input fingerprint. Unsupported or ambiguous records are
returned in the loss ledger with explicit dispositions. They never become
trusted current work, evidence, or memory merely because an import was
requested.

`apply_migration` means validated staging only in this vertical. Its result
always advertises `live_store_materialization_requires_store_adapter` until an
application/store transaction exists. This is intentional: no adapter may
report live application after only producing an in-memory document.

## Testing boundary

`crates/application/tests/knowledge.rs` exercises source capture and retry,
source verification/citation, draft → review → Git publication → search, and
migration dry-run → verify → staged apply plus loss handling. The tests use
the public libraries and temporary managed roots; they do not fabricate rows
with direct SQL.
