# Runtime Architecture

Boreal's runtime is organized around ports and pure domain operations.

The outer engine composes domain packages and storage transactions. Future CLI, TUI, daemon, MCP, and console surfaces should call `@boreal/engine` operations rather than reimplementing workflow rules.

## Command Boundary

Each runtime command should follow one orchestration path:

```text
validate input -> load records -> call domain function -> enforce policy
-> write transaction/event -> update projections -> return view model
```

## Storage Boundary

`@boreal/storage` defines transaction-capable ports. The in-memory store exists to prove contracts and tests. The first durable adapter is `FileBorealStore`, which persists a single atomic snapshot at `.boreal/runtime/state.json`.

`FileBorealStore` serializes writes in two layers:

- An in-process queue preserves call order inside one runtime.
- A lock directory at `.boreal/runtime/state.lock` protects the full read/modify/write transaction across separate CLI, daemon, MCP, or agent processes.

The lock has bounded wait, retry, stale-lock recovery, owner metadata, and token-based release. Reads stay lock-free because the state file is replaced with atomic rename.

File storage is an adapter, not the domain model. SQLite, Dolt-like, or other transactional backends should fit behind the same store interface without changing domain packages.

Operational work state should not depend on JSONL or Markdown as a hardcoded implementation detail. Human-readable vault formats can be adapters; engine rules must stay behind storage and schema contracts.

## Beads-Derived Runtime Rules

The Beads runtime is Go/Dolt-centered, but several of its operational rules apply directly:

- Stable natural-key IDs belong on relationship records. Boreal graph edges use deterministic IDs from edge identity.
- User-created work records must tolerate same-title imports and retries. Boreal work IDs include actor, timestamp, and nonce seed inputs, with runtime-level nonce retry on collision.
- Append-like runtime events must not rely on per-process counters. Boreal event IDs use random entropy.
- Derived readiness can go stale after merges, imports, or adapter bugs. Boreal exposes `recomputeReadiness()` as an idempotent repair path.
- State-file writes use temp file, fsync, and rename so readers never observe a partial JSON document.
