# Storage And Collaboration Direction

Status: superseded as an implementation contract.

Boreal's current storage direction is `objects-v1`: one canonical JSON object per record under `.boreal/objects/`, a hash-linked event log under `.boreal/log/`, and a disposable SQLite read/search index under `.boreal/cache/`. `file-v2` remains the legacy compatibility and rollback adapter. This document records the collaboration constraints around that boundary and must not be read as current runtime truth for a different writer.

## Current runtime boundary

- The object store is the default durable adapter for new workspaces.
- The event log is append-only and hash-linked across log generations.
- SQLite and JSON search data are derived read models. They can be rebuilt from canonical records.
- Runtime writes go through the storage and engine contracts, with workspace locking, atomic file replacement, schema validation, and operation records.
- JSONL ledgers are portable Git-friendly exports. They are not a second source of truth.
- A future writer change requires a new accepted decision, migration path, parity check, rollback path, and documentation update.

## Collaboration invariants

1. Record identity is stable across clones and does not depend on filesystem paths.
2. A record update must be atomic at the workspace boundary and must produce the corresponding event and operation metadata.
3. Concurrent changes must be detected through record identity, event-log continuity, or explicit merge conflicts; silent last-writer replacement is not acceptable.
4. Deletions are represented with durable tombstone or ledger semantics before generated projections are rebuilt.
5. Imports validate schema, references, content hashes, and event continuity before changing canonical state.
6. Generated indexes, projections, reports, and ledgers are recreated after import, migration, or recovery.
7. A recovery snapshot is required before a non-reversible migration, and parity is checked against the pre-migration source.

## Migration contract

Storage migrations follow these phases:

1. Resolve and validate the source and target adapters.
2. Create a recovery boundary before changing the selected adapter.
3. Write the target without changing domain semantics.
4. Compare record counts, canonical content hashes, references, and event-log integrity.
5. Activate the target only after parity succeeds.
6. Keep the source or declared backup available until verification completes.
7. Reopen through the selected adapter and run strict health checks.

The inverse migration must preserve the object store and event log until the restored file-backed adapter has passed parity and verification. A failed migration leaves the prior selected source readable.

## Collaboration roadmap

The next collaboration capabilities should be delivered behind explicit versioned contracts:

- clone-aware import and conflict fixtures;
- event-log generation and tombstone recovery;
- bounded JSONL merge-driver coverage from real exports;
- optional worktree-per-agent execution with explicit branch and path metadata;
- project registry rollups that preserve project identity and freshness across repositories.

These capabilities may extend the current records and exports, but they must not bypass the CLI, engine, storage, or project-boundary guards.
