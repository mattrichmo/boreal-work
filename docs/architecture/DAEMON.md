# Boreal Daemon

Status: `apps/daemon` contains the first local daemon status and watch-loop scaffold.

The daemon is an observer and coordinator, not a second runtime writer. It may watch selected-project runtime and generated-artifact paths, report stale process state, and surface lock conflicts. It must not silently write memory truth, mutate work records, repair ledgers, rebuild search, or edit vault files.

## Responsibilities

- Bind to exactly one selected Boreal project with the shared MCP/daemon boundary guard.
- Report a local status file at `.boreal/daemon/status.json`.
- Detect whether a recorded daemon PID is still alive.
- Watch bounded project paths:
  - `.boreal/runtime/state.json`
  - `.boreal/runtime/search-index.json`
  - `.boreal/ledgers/manifest.json`
  - `memory/`
- Inspect runtime and search-index locks before doing watch work.
- Return command-mediated repair recommendations such as `bwrk doctor --fix --json` or `bwrk sync refresh --json`.
- Handle missing or renamed project roots by skipping watch work and reporting findings.

## Non-Goals

- No direct writes to `.boreal/runtime/state.json`.
- No direct writes to JSONL ledgers, search index, SQLite cache, or vault files.
- No implicit `doctor --fix`, `sync refresh`, import, merge, compaction, Git, registry, or setup mutations.
- No global cross-project watching without each project being explicitly selected and boundary-validated.
- No replacement for CLI operation records. State-changing work remains command-mediated.

## Surfaces

CLI:

```bash
bwrk daemon status --json
```

Package scripts:

```bash
pnpm daemon:status
pnpm daemon:watch:once
```

The global dashboard JSON includes `daemonStatus.projects[]` with project identity, daemon state, status path, findings, and recommendations. `bwrk doctor --strict` reports `daemon.status`: a stopped daemon is healthy; stale PID files, copied status roots, missing projects, and boundary drift are warnings.

## Lifecycle

`apps/daemon` exposes helpers for status-file lifecycle:

- `writeDaemonRunningStatus()`
- `writeDaemonStoppedStatus()`
- `clearDaemonStatus()`
- `inspectDaemonStatus()`
- `runDaemonWatchOnce()`

Tests cover running/stopped/stale PID states, stop/restart behavior, missing project roots, lock conflicts, and bounded watch paths. The watch loop returns `action: "skipped"` for unhealthy boundaries or active locks, and `action: "observed"` only when the selected project and locks are healthy.
