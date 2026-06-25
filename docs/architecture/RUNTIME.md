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

File storage is an adapter, not the domain model. SQLite, Dolt-like, or other transactional backends should fit behind the same store interface without changing domain packages.

Operational work state should not depend on JSONL or Markdown as a hardcoded implementation detail. Human-readable vault formats can be adapters; engine rules must stay behind storage and schema contracts.
