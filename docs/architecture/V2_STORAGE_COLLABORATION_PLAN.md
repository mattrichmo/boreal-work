# V2 Storage And Collaboration Plan

Status: superseded as an implementation contract; retained as a historical design record.

The shipped storage direction is now `objects-v1`: per-record canonical JSON under `.boreal/objects/`, a hash-linked event log under `.boreal/log/`, and a disposable SQLite read/search index at `.boreal/cache/index.sqlite`. `file-v2` remains the legacy compatibility and rollback adapter. The proposal below predates that implementation and must not be read as current runtime truth or as authority to replace the current writer. A future writer change requires a new decision based on the shipped object-store collaboration and benchmark evidence.

Audit basis: Sprint 14 from the Boreal V1 audit reconciliation. This document is a design artifact, not the implementation. It turns the remaining storage scale and collaboration findings into concrete architecture, freshness, query, benchmark, and migration gates.

## Runtime Truth At The Time Of The Proposal

- `FileBorealStore` is still the durable writer. Each read loads `.boreal/runtime/state.json` into `InMemoryBorealStore`; each write loads the full snapshot, runs a transaction, then replaces the full JSON file under the state lock.
- `InMemoryBorealStore` has maps for record lookup, but `FileBorealStore` rebuilds those maps per operation from the full snapshot.
- `BorealReader.listWorkItems` only supports `status` and exact all-label filtering. Other list methods return full sections.
- `BorealRuntime.listReadyWork` scans all work items, repeatedly derives graph dependencies by scanning all graph edges, then builds full work views.
- `BorealRuntime.claimNextWork` repeats the same ready-work scan inside a write transaction before reserving one candidate.
- `BorealRuntime.rebuildProjections` loads all work, sources, claims, and decisions, then rebuilds every work context/projection.
- Search, JSONL ledgers, context packs, and SQLite are generated artifacts rebuilt by `sync refresh`.
- The SQLite cache at `.boreal/cache/runtime-cache.sqlite` is disposable. It stores one `records` row per portable runtime record plus `schemaVersion`, `sourceContentHash`, and counts, but it is not the runtime writer.
- Portable export and ledger hashes intentionally exclude local-only operation history and operation-linked event drift.

## Superseded Decision

V2 should make SQLite the primary local runtime writer behind the existing `BorealStore` port, with an append-only mutation/event journal and deterministic export/ledger/snapshot compatibility as the collaboration boundary.

The durable V2 local store is:

```text
SQLite primary writer
  - normalized runtime tables
  - transaction-scoped generation metadata
  - operation/event audit tables
  - query indexes for hot paths

Generated collaboration artifacts
  - boreal.export.v1 snapshots for recovery baselines
  - JSONL ledgers plus tombstones for Git-friendly exchange
  - search index, context packs, and bounded read caches
```

`FileBorealStore` remains the V1 compatibility adapter and rollback target during migration. JSONL ledgers stay a collaboration/export format, not the primary runtime backend. Runtime rules continue to live in `@boreal/engine`; the storage adapter supplies transactionality, indexes, and generation metadata.

## Options Considered

| Option | Benefits | Costs | Decision |
| --- | --- | --- | --- |
| Keep `state.json` as primary writer and optimize generated caches | Lowest migration risk; preserves current recovery model | Read/write cost stays proportional to full state size; hot paths still rebuild maps and scan sections; cross-process concurrency depends on one coarse file lock | Reject for V2 primary. Keep as V1 compatibility and rollback adapter. |
| Event log plus snapshots as primary writer | Append-friendly; good audit story; easy to inspect in Git | Fast reads require a materialized store anyway; compaction/replay/snapshot invalidation become the hard part; conflict handling moves into every query path | Reject as primary. Keep append-only journals for audit and recovery around SQLite commits. |
| SQLite primary writer with generated ledgers and snapshots | ACID transactions, indexed reads, bounded queries, mature WAL behavior, easy local deployment, clean adapter boundary | Requires schema migration, import/export parity checks, and a careful rollback plan; binary DB is not Git-mergeable | Accept. Use JSONL ledgers and snapshots for collaboration/recovery instead of merging the DB file. |
| External server database | Strong multi-user coordination and richer observability | Adds service setup and credential burden; breaks Boreal's local-first default | Defer. The `BorealStore` port should allow it later without changing domain packages. |

## V2 Store Contract

The V2 adapter should be introduced as `SQLiteBorealStore` while preserving the existing `BorealStore` read/write transaction shape.

Required behavior:

- Every write runs in one SQLite transaction and commits all changed records, audit events, operation links, and generation metadata together.
- Runtime domain code keeps using `BorealReader` and `BorealWriter`; no engine package may issue SQL directly.
- Imports, snapshots, ledgers, and tests use the same portable snapshot shape as `boreal.export.v1`.
- V2 export content hashes must match V1 export content hashes for the same portable state.
- Operation history remains local unless explicitly exported by an operation-audit command.
- WAL mode is enabled for local concurrency; write transactions are still serialized by SQLite's writer lock.
- The adapter exposes an explicit `adapterSchemaVersion`, `runtimeSchemaVersion`, and `migrationVersion`.
- `sync refresh` continues to rebuild context projections, search, JSONL ledgers, and generated caches from canonical runtime tables.

Initial table families:

- `work_items`, `work_labels`, `work_dependency_projection`
- `evidence`, `evidence_sources`
- `verifications`, `verification_evidence`
- `knowledge_sources`
- `claims`, `claim_sources`, `claim_evidence`, `claim_wiki_pages`
- `decisions`, `decision_sources`, `decision_wiki_pages`, `decision_supersedes`
- `graph_edges`
- `reservations`
- `runtime_events`
- `runtime_operations`
- `projections`
- `context_packs`
- `runtime_generation`
- `artifact_generation`

Record JSON should still be stored for exact round-trip compatibility at first. Columns used for filters, joins, and ordering are duplicated as normalized fields. After migration stabilizes, schemas can move more fields out of JSON if there is evidence that the duplication is worth it.

## State Generation And Freshness Model

V2 needs a single freshness vocabulary for runtime state, ledgers, search, context projections, and SQLite-derived views.

### Runtime Generation

Every committed write produces one runtime generation:

```ts
interface RuntimeGeneration {
  id: string;
  sequence: number;
  committedAt: string;
  actorId: string;
  operationId?: string;
  parentContentHash?: string;
  contentHash: string;
  changedSections: string[];
  adapterSchemaVersion: string;
  runtimeSchemaVersion: string;
}
```

`contentHash` is the portable canonical snapshot hash. It excludes operation-local fields exactly as export/snapshot hashing does today. `sequence` is local and monotonic for fast freshness checks, but portable comparisons must use `contentHash`.

### Artifact Generation

Every generated artifact writes metadata that points back to the runtime generation it came from:

```ts
interface ArtifactGeneration {
  artifact: "context" | "search" | "ledgers" | "sqlite-cache" | "snapshot" | "dashboard-cache";
  schemaVersion: string;
  builtAt: string;
  sourceGenerationId: string;
  sourceSequence: number;
  sourceContentHash: string;
  outputContentHash: string;
  commandOperationId?: string;
  recordCounts: Record<string, number>;
}
```

Freshness rules:

- Clean: artifact metadata matches the current `runtime_generation.contentHash` and expected schema version.
- Missing healthy: disposable caches may be absent when a command does not require them.
- Missing blocking: artifacts required by the command contract are absent.
- Stale warning: generated cache exists but `sourceContentHash` or schema version differs.
- Stale blocking: command would return untrusted context/search/list data.
- Dirty runtime: a write succeeded but a post-write artifact rebuild failed; the next repair command is `bwrk sync refresh --json`.

`doctor`, `prime`, `sync status`, `gate`, and dashboard health should all render the same freshness object instead of bespoke stale flags.

## Query Pushdown And Index Plan

V2 hot paths should be expressible as bounded storage queries before view construction.

Extend the storage port with filter, sort, and pagination contracts. The current `listWorkItems(filter?: WorkItemFilter)` can stay as a compatibility helper, but hot paths should move to narrower APIs:

```ts
interface WorkQuery {
  status?: readonly WorkStatus[];
  labelsAll?: readonly string[];
  labelsAny?: readonly string[];
  priority?: readonly WorkPriority[];
  hasActiveReservation?: boolean;
  agentId?: string;
  sourceId?: string;
  sourceRef?: string;
  updatedAfter?: string;
  updatedBefore?: string;
  orderBy?: "claim_order" | "updated_at" | "created_at" | "title" | "priority";
  direction?: "asc" | "desc";
  limit?: number;
  cursor?: string;
}
```

Required API additions:

- `queryWorkItems(query: WorkQuery): Promise<Page<WorkItem>>`
- `queryReadyWork(query: ReadyWorkQuery): Promise<Page<WorkItem>>`
- `getBlockingDependencyIds(workId: WorkId): Promise<readonly WorkId[]>`
- `listBlockingDependencies(workIds: readonly WorkId[]): Promise<Record<WorkId, readonly WorkItem[]>>`
- `listEvidenceForSubjects(subjectIds: readonly string[]): Promise<Record<string, readonly EvidenceRecord[]>>`
- `listContextPacksForSubjects(subjectIds: readonly string[]): Promise<Record<string, ContextPack | undefined>>`
- `queryGraphEdges(query: GraphEdgeQuery): Promise<Page<GraphEdge>>`
- `queryReservations(query: ReservationQuery): Promise<Page<AgentReservation>>`

Stable ordering:

- Claim order remains `priority DESC`, then `title ASC`, then `id ASC`.
- Ready/list order must always include `id` as the final tie-breaker.
- Cursor tokens contain the ordered key tuple and source generation, so a cursor fails closed when state changes underneath it.

Core SQLite indexes:

- `work_items(status, priority_rank DESC, title, id)`
- `work_items(updated_at DESC, id)`
- `work_labels(label, work_id)`
- `reservations(work_id, status, expires_at)`
- `reservations(agent_id, status, expires_at)`
- `graph_edges(kind, to_type, to_id, from_type, from_id)`
- `graph_edges(kind, from_type, from_id, to_type, to_id)`
- `evidence(subject_type, subject_id, created_at DESC, id)`
- `evidence_sources(source_id, evidence_id)`
- `claim_sources(source_id, claim_id)`
- `decision_sources(source_id, decision_id)`
- `context_packs(subject_id)`
- `runtime_events(subject_type, subject_id, created_at DESC, id)`
- `runtime_operations(command_path, started_at DESC, id)`

The first implementation benchmark should target ready-work, claim-next-work, work-list filters, context lookup, sync refresh, and global dashboard queue reads. Projection rebuild may still be whole-workspace in the first SQLite writer cut, but all read surfaces must avoid building full views before applying filters and limits.

## Migration And Rollback

V2 migration must be reversible until the SQLite writer has passed parity and benchmark gates in real Boreal workspaces.

Migration phases:

1. Add `SQLiteBorealStore` behind a feature flag or explicit adapter setting. Keep `FileBorealStore` as default.
2. Build SQLite from current `state.json` using the portable export snapshot. Validate schema, references, counts, and content hash before accepting the DB.
3. Run dual-read parity in tests: V1 file store and V2 SQLite return identical portable snapshots and command JSON for the same fixture state.
4. Run optional dual-write shadow mode in local dogfood: write to SQLite, export to snapshot, and verify content hash against the V1 adapter before switching the selected adapter.
5. Switch default writer only after import/export, ledger, doctor, search, context, and benchmark gates pass.
6. Keep `boreal.export.v1` recovery snapshots and `state.json` backup paths for rollback until a later major migration removes them.

Rollback requirements:

- Before any one-way adapter switch, write a recovery snapshot and record its path in operation evidence.
- `bwrk storage migrate --rollback <snapshot>` restores the V1 file store from a valid `boreal.export.v1` snapshot.
- Failed migration leaves the prior writer untouched and reports no partial success.
- `doctor --strict` fails if the configured writer and generated artifacts disagree on portable content hash.

## Benchmark Gates

Create benchmark fixtures that scale by record section and relationship density:

- `small`: current real-workspace scale.
- `medium`: 1,000 work items, 5,000 graph edges, 2,000 evidence records, 500 context packs.
- `large`: 10,000 work items, 50,000 graph edges, 20,000 evidence records, 10,000 context packs, 50,000 runtime events.
- `collaboration`: same as medium plus ledger deletions, duplicate imports, import conflicts, and snapshot rollback cases.

Minimum gates for V2 writer acceptance:

| Gate | Medium target | Large target |
| --- | ---: | ---: |
| `ready` / `work claim` candidate query | <= 150 ms p95 | <= 500 ms p95 |
| Work list with status and labels, limit 50 | <= 100 ms p95 | <= 250 ms p95 |
| Context pack lookup by work ID | <= 50 ms p95 | <= 100 ms p95 |
| Evidence lookup for 50 work IDs | <= 150 ms p95 | <= 350 ms p95 |
| `sync refresh` excluding search tokenization | <= 10 s | <= 45 s |
| Export snapshot content-hash parity | exact | exact |
| JSONL ledger export/import round trip | exact | exact |
| Migration failure rollback | exact pre-migration hash | exact pre-migration hash |

Benchmarks must report runtime generation, adapter version, record counts, wall time, and machine-local caveats. A benchmark regression is blocking when it breaks a target or returns a different portable hash than V1 for the same fixture.

## Implementation Slices

1. Add generation metadata types and freshness DTOs without changing the writer.
2. Add query contracts to `BorealReader` and implement them in `InMemoryBorealStore`.
3. Refactor ready/list/search/dashboard hot paths to use bounded query APIs while still on V1 file storage.
4. Add benchmark fixtures and baseline V1 measurements.
5. Add `SQLiteBorealStore` read/write adapter with schema migration and export parity tests.
6. Add migration, rollback, and dual-read parity commands.
7. Switch generated artifact freshness reporting to runtime/artifact generation metadata.
8. Make SQLite the default writer only after the gates pass.

## Non-Goals

- No network service or hosted database dependency in the V2 local writer.
- No Git merge of SQLite database files.
- No scraping arbitrary Markdown to rebuild runtime truth.
- No direct SQL access from domain packages.
- No removal of `boreal.export.v1` recovery snapshots during the V2 migration window.
