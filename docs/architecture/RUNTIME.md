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

The CLI fails closed for uninitialized workspaces, discovers a workspace by walking up to `.boreal`, and treats `--workspace <path>` as an exact root for explicit automation. Initialization is idempotent inside the runtime transaction, and `work create --ready` is a single runtime write. Its `doctor` command validates the file-store schema, section shapes, missing IDs, duplicate IDs within each state section, dangling work and knowledge references, graph/dependency consistency, reservation consistency, verification policy drift, derived readiness, context-pack projection drift, and runtime locks. `doctor --fix` only performs idempotent repairs: stale-lock removal, readiness recompute, and projection rebuild.

## Storage Boundary

`@boreal/storage` defines transaction-capable ports. The in-memory store exists to prove contracts and tests. The first durable adapter is `FileBorealStore`, which persists a single atomic snapshot at `.boreal/runtime/state.json`.

`FileBorealStore` serializes writes in two layers:

- An in-process queue preserves call order inside one runtime.
- A lock directory at `.boreal/runtime/state.lock` protects the full read/modify/write transaction across separate CLI, daemon, MCP, or agent processes.

The lock has bounded wait, retry, stale-lock recovery, owner metadata, and token-based release. Reads stay lock-free because the state file is replaced with atomic rename.

Lock inspection and stale-lock breaking are exposed as explicit storage helpers so operational surfaces can diagnose lock issues without duplicating lock internals. Active locks are not broken by repair commands. Stale-lock recovery uses an adjacent recovery lock so concurrent repair attempts cannot both remove the same stale lock or delete a fresh replacement from another Boreal process.

File storage is an adapter, not the domain model. SQLite, Dolt-like, or other transactional backends should fit behind the same store interface without changing domain packages.

Operational work state should not depend on JSONL or Markdown as a hardcoded implementation detail. Human-readable vault formats can be adapters; engine rules must stay behind storage and schema contracts.

## Beads-Derived Runtime Rules

The Beads runtime is Go/Dolt-centered, but several of its operational rules apply directly:

- Stable natural-key IDs belong on relationship records. Boreal graph edges use deterministic IDs from edge identity.
- User-created work records must tolerate same-title imports and retries. Boreal work IDs include actor, timestamp, and nonce seed inputs, with runtime-level nonce retry on collision.
- Append-like runtime events must not rely on per-process counters. Boreal event IDs use random entropy.
- Derived readiness can go stale after merges, imports, or adapter bugs. Boreal exposes `recomputeReadiness()` as an idempotent repair path.
- State-file writes use temp file, fsync, and rename so readers never observe a partial JSON document.
