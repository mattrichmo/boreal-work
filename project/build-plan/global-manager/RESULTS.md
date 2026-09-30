# Global manager implementation — 2026-09-30

The first-pass [TUI audit](TUI_AUDIT.md) is retained as historical evidence.
Its findings are addressed by the [redesign and qualification](TUI_REDESIGN_RESULTS.md).
The original checks below concern the initial API and installation slice.

Implemented by three user-requested Luna agents, with coordinator integration
and release qualification. The global manager is installation-wide and
independent of the current directory and every code-project database.

## Delivered

- Independent `global.sqlite`, automatic idempotent installer bootstrap and
  first-use fallback; macOS/Linux data roots and `BOREAL_GLOBAL_ROOT` override.
- Folderless management projects, project description/lifecycle/health,
  labels/priority, reversible folder associations and validated workspace links.
- Todos, tasks, milestones and nested subtasks; configurable status IDs,
  labels/order/semantic categories; completion/reopening/archive; dates,
  priorities, labels, notes and dependency/related-item relationships.
- Separate `apps/global-tui` full-screen keyboard interface and line interface,
  overview/board/list/notes/workflow/link views. `bwrk dashboard global` manages
  its Rust service; `bwrk dashboard` retains local project selection.
- Genuine linked-project counts, source revision and sample time; unavailable
  workspaces remain visibly unavailable and do not become zero-count success.
- Transactional global revisions, audit, retained status/revision history,
  durable operation receipts and replay protection. Unknown writes require
  operation readback before another mutation.
- Export/import including retained history; strict validation and revision-bound
  explicit replacement for existing records; separate release assets.

## Verification

- Backend: five focused tests pass, covering concurrent bootstrap and stale
  writes, lifecycle/history, hierarchy, reverse-blocker cycles, atomic failure,
  replay and guarded backup restoration.
- Global CLI discovery/bootstrap tests, framed service version rejection,
  cwd independence, link validation and genuine one-item rollup tests pass.
- Managed dashboard launcher verifies interactive launch and socket cleanup.
- Global TUI: seven tests pass for transport, revision safety, unknown-write
  readback, filtering, multiple linked projects and keyboard workflows.
  Existing project TUI suite passes (99 Node tests plus its
  mounted workflow suite).
- `scripts/validation/global/smoke.py` passes against the real CLI, socket
  service and compiled TUI: folderless Life, structured business work, custom
  workflow, notes, dependencies, linked progress/outage, stale revision, replay
  and fresh export/import round trip.
- Actual terminal launch created a project and restored the terminal on `q`.
- Release package installation verifies asset digests, two isolated code
  projects, automatic global provisioning and preservation on reinstall.

## Remaining product scope

Recurring work, delivered reminders, saved views, calendar/timeline, templates,
workflow transition policies, team/remote synchronization and automatic agent
launching are separate additions. Current state is serialized inside its own
transactional SQLite schema; indexed per-record tables and cached historical
linked rollups remain future scaling improvements. Linking supplies progress;
global never writes the linked project's execution lifecycle.

Socket integration tests require permission outside the execution sandbox;
qualification uses disposable paths and does not seed personal live records.

Final archive and native installation also passed. To avoid source changes
during compilation from the other active CLI-parity chat, qualification used
`/private/tmp/boreal-global-source-qualified`, a consistent copy of the shared
source with the final global modules. The archive is
`/private/tmp/boreal-global-final-release/bwrk-v0.2.0-aarch64-apple-darwin.tar.gz`.
It passed installed asset hashes, local two-project isolation, real global
CLI/service/TUI smoke and reinstall preservation. It was installed into
`/Users/cybertron/.local`; a global snapshot succeeded from `/private/tmp` and
the separate per-user SQLite file was provisioned. No test projects were added
to personal live state. Later CLI-parity edits in the original workspace are
outside this snapshot's source fingerprint and require their own qualification.
