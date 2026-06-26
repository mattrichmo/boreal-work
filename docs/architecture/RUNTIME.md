# Runtime Architecture

Boreal's runtime is organized around ports and pure domain operations.

The outer engine composes domain packages and storage transactions. Future CLI, TUI, daemon, MCP, and console surfaces should call `@boreal/engine` operations rather than reimplementing workflow rules.

## Command Boundary

Each runtime command should follow one orchestration path:

```text
validate input -> load records -> call domain function -> enforce policy
-> write transaction/event -> update projections -> return view model
```

The first command surface is `apps/cli`, published as the `bwrk` binary. It is intentionally thin: command parsing, workspace resolution, JSON/text output, and operational diagnostics live at the edge, while lifecycle behavior stays in `@boreal/engine`.

The CLI fails closed for uninitialized workspaces, discovers a workspace by walking up to `.boreal`, and treats `--workspace <path>` as an exact root for explicit automation. Initialization is idempotent inside the runtime transaction, and `work create --ready` is a single runtime write. `work claim` is a runtime operation, not a CLI composition of list-plus-reserve: it selects blocker-valid ready work and reserves it in one write transaction before returning a refreshed context/search handoff. Reservations support explicit expiration, renewal, and release; release/expiration always restore affected work to derived readiness instead of leaving stale ownership state behind. Context packs are capped, scoped projections: they always include work status/priority, prefer claims and decisions linked by evidence/source references, and only then fall back to token overlap so unrelated accepted knowledge does not pollute every handoff. Its export/import/snapshot commands provide Git-friendly Markdown exports, stable `boreal.export.v1` JSON snapshots, strict merge-style JSON import, and recovery snapshots under `.boreal/snapshots`. Its search commands write a compact content-hashed index at `.boreal/runtime/search-index.json`; query commands refuse missing, malformed, or stale indexes so retrieval cannot silently drift after imports or writes, rank field-weighted token matches with document-frequency IDF plus deterministic vector-lite similarity, and `--explain` reports query tokens, document frequencies, score contributions, vector similarity, and field-level matches for ranking audits. Initialized workspace commands append local operation records with operation ID, session ID, redacted argv, actor, timing, exit status, declared state/artifact effects, and generated event IDs. Events created by that command also carry the same local operation ID. Operation records, event operation IDs, and legacy operation-link markers are local runtime audit data; portable exports and snapshot content hashes strip them so command history does not create project-state drift. The `operation` namespace lists/shows this audit data, repairs legacy event links after upgrades, and prunes it with explicit retention rules; `operation prune --keep N` reserves one slot for the prune command's own operation record so the post-command log remains bounded. Its `doctor` command validates the file-store schema, section shapes, missing IDs, duplicate IDs within each state section, dangling work and knowledge references, retained operation/event causality, operation event references and volume, graph/dependency consistency, reservation consistency and expiration, verification policy drift, derived readiness, context-pack projection drift, snapshot/export drift, search-index freshness, and runtime locks. `doctor --strict` promotes warnings to a failing result for CI gates. `doctor --fix` only performs idempotent repairs: stale-lock removal, dependency projection repair from the block graph, readiness recompute, stale reservation expiration, projection rebuild, and search-index rebuild.

## Storage Boundary

`@boreal/storage` defines transaction-capable ports. The in-memory store exists to prove contracts and tests. The first durable adapter is `FileBorealStore`, which persists a single atomic snapshot at `.boreal/runtime/state.json`.

`FileBorealStore` serializes writes in two layers:

- An in-process queue preserves call order inside one runtime.
- A lock directory at `.boreal/runtime/state.lock` protects the full read/modify/write transaction across separate CLI, daemon, MCP, or agent processes.

The lock has bounded wait, retry, stale-lock recovery, owner metadata, and token-based release. Reads stay lock-free because the state file is replaced with atomic rename.

Generated artifacts use the same fsync atomic-write helper. The local search index is rebuilt under `.boreal/runtime/search-index.lock`, then replaced with atomic rename so concurrent rebuilds do not leave partial JSON behind. Search tokenization preserves compact tokens while adding camelCase, path/URI, underscore, and alpha-numeric split variants. Each indexed document also stores compact deterministic vector-lite weights derived from token, prefix, and trigram features. Context packs are indexed as both summary documents and capped per-pack chunk documents so focused retrieval does not depend on one large context blob.

Lock inspection and stale-lock breaking are exposed as explicit storage helpers so operational surfaces can diagnose lock issues without duplicating lock internals. Active locks are not broken by repair commands. Stale-lock recovery uses an adjacent recovery lock so concurrent repair attempts cannot both remove the same stale lock or delete a fresh replacement from another Boreal process.

File storage is an adapter, not the domain model. SQLite, Dolt-like, or other transactional backends should fit behind the same store interface without changing domain packages.

Reservations are ownership leases, not a separate workflow phase. New reservations attach `reservationId` and move active work to `in_progress`; `reserved` remains accepted for legacy/imported state only. Agent finish is a single runtime operation: ownership and expiration checks, evidence recording, verification, optional close, reservation release, readiness recompute, and the high-level finish event occur inside one store transaction.

Block graph edges are canonical for work dependencies. `work.dependencyIds` is retained as a generated projection/cache for exports and view models; runtime readiness and claim eligibility read `blocks` graph edges directly, and `doctor --fix` can rewrite stale dependency IDs from the graph.

JSONL ledgers are a bridge toward Git-native collaboration, not a second runtime backend yet. `export ledgers` writes one deterministic JSONL file per snapshot section, a `deletions.jsonl` tombstone ledger, and a hash manifest under `.boreal/ledgers`; `import ledgers` verifies the manifest, per-file counts, per-file hashes, deletion counts, schemas, and references before merging records through the same conflict rules as JSON import. `ledger delete` removes supported unreferenced source, claim, and decision records through a tombstone-aware runtime deletion path. `ledger status` and `doctor` report drift when an existing ledger export no longer reconstructs or matches the current runtime state.

Operational work state should not depend on JSONL or Markdown as a hardcoded implementation detail. Human-readable vault formats can be adapters; engine rules must stay behind storage and schema contracts.

## Beads-Derived Runtime Rules

The Beads runtime is Go/Dolt-centered, but several of its operational rules apply directly:

- Stable natural-key IDs belong on relationship records. Boreal graph edges use deterministic IDs from edge identity.
- User-created work records must tolerate same-title imports and retries. Boreal work IDs include actor, timestamp, and nonce seed inputs, with runtime-level nonce retry on collision.
- Append-like runtime events must not rely on per-process counters. Boreal event IDs use random entropy.
- Derived readiness can go stale after merges, imports, or adapter bugs. Boreal exposes `recomputeReadiness()` as an idempotent repair path.
- Search and ready-work paths should stay bounded and filterable. Boreal keeps ready-work reads live and blocker-aware, makes claim-and-reserve atomic at the runtime layer, and uses content-hashed generated search to fail closed when stale.
- State-file writes use temp file, fsync, and rename so readers never observe a partial JSON document.
