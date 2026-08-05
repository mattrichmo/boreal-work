# Boreal Daemon

Status: `apps/daemon` contains the first local daemon status and watch-loop scaffold.

The daemon is an observer and coordinator, not a second runtime writer. It may watch selected-project runtime and generated-artifact paths, report stale process state, and surface lock conflicts. It must not silently write memory truth, mutate work records, repair ledgers, rebuild search, or edit vault files.

## Responsibilities

- Bind to exactly one selected Boreal project with the shared MCP/daemon boundary guard.
- Report a local status file at `.boreal/daemon/status.json`.
- Detect whether a recorded daemon PID is still alive.
- Watch bounded project paths:
  - `.boreal/runtime/state.json`
  - `.boreal/cache/index-v2.sqlite`
  - `.boreal/ledgers/manifest.json`
  - `memory/`
- Inspect runtime and search-index locks before doing watch work.
- Return command-mediated repair recommendations such as `bwrk doctor --fix --json` or `bwrk sync refresh --json`.
- Surface registry-backed directive obligations for daemon health and caller-supplied work/session/closeout/health/handoff snapshots.
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

Daemon JSON status and watch results include:

- `agentDirectives`: directive bundles using the shared `boreal.agent-directives.v1` contract.
- `directiveObligations`: an agent-runtime summary with selected/emitted registry IDs, required and blocking counts, conflicts, missing-required entries, and compiler issues.

The exported `compileDaemonDirectiveObligations()` helper binds the selected project boundary, then delegates directive compilation to `@boreal/agent-runtime`. It accepts caller-provided typed snapshots for `work`, `session`, `closeout`, `health`, and `handoff` contexts without invoking CLI commands.

## Lifecycle

`apps/daemon` exposes helpers for status-file lifecycle:

- `writeDaemonRunningStatus()`
- `writeDaemonStoppedStatus()`
- `clearDaemonStatus()`
- `inspectDaemonStatus()`
- `runDaemonWatchOnce()`
- `compileDaemonDirectiveObligations()`

Tests cover running/stopped/stale PID states, stop/restart behavior, missing project roots, lock conflicts, and bounded watch paths. The watch loop returns `action: "skipped"` for unhealthy boundaries or active locks, and `action: "observed"` only when the selected project and locks are healthy.
