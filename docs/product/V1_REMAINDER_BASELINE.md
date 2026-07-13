# Boreal V1 Remainder Baseline

Captured: 2026-06-27 UTC
Workspace: `/Users/cybertron/Code/boreal-work`
Branch: `codex/skill-hardening-sprint`

This artifact closes the first Sprint 01 baseline tasks for the v1 remainder bucket. It records live tracker state, dashboard scope, command gaps, and the readiness/closeout gates that should govern the remaining v1 work.

## Live Tracker Snapshot

Source commands:

```bash
node apps/cli/dist/index.js prime --agent codex-sprint01-executor --label v1-remainder --json
node apps/cli/dist/index.js work next --label v1-remainder --limit 10 --json
node apps/cli/dist/index.js doctor --strict --json
```

Current facts:

- Workspace sync is healthy: vault, ledgers, search index, and Git checks passed.
- Strict doctor passed with 44 checks and 0 failing findings.
- The agent had 0 active reservations, 0 expired active reservations, and 3 available reservation slots.
- Total work records: 143.
- `v1-remainder` records: 136.
- `v1-remainder` by kind: 32 milestones, 10 sprints, 94 tasks.
- `v1-remainder` by status: 133 blocked, 3 ready.
- Sprint 01 records: 13 total, including 1 sprint, 3 phase gates, and 9 tasks.
- Sprint 01 by status: 10 blocked, 3 ready.
- Dependency graph edges: 232.
- Evidence records before this closeout pass: 8.
- Verification records before this closeout pass: 7.

The only ready `v1-remainder` work items at capture time were:

- `bw_work_abdd58eae33f9127`: `S01T01 - Snapshot live Boreal state and command coverage`
- `bw_work_b71214b0896e55b6`: `S01T02 - Document dashboard scope from component dump and existing docs`
- `bw_work_eb6b8e5438d37eed`: `S01T03 - Define v1 backlog readiness and closeout gates`

## Repo And App Boundaries

The current app/package layout supports the v1 roadmap but leaves dashboard app surfaces mostly unimplemented:

- `apps/cli`: implemented CLI source and built output are present.
- `apps/console`: implemented local browser console scaffold with fixture/live modes, route smoke tests, and a registry-backed global overview surface.
- `apps/tui`: currently only `.gitkeep`; this is the future richer terminal app boundary if the CLI primitive approach grows into a dedicated TUI.
- `apps/mcp`: now contains the first project-scoped stdio MCP server. It uses the shared no-leak boundary, exposes read-only selected-project tools first, and routes confirmed mutations through scoped CLI command contracts.
- `apps/daemon`: now contains a project-scoped status/watch scaffold. It reports daemon state, stale PID files, lock conflicts, and bounded watch paths, while repairs remain explicit CLI commands.
- `packages/ui-model`: currently exposes `WorkItemView`; this is the right shared boundary for console, CLI dashboard, and future TUI data models.

The repo already has core runtime package boundaries for storage, engine, work, graph, evidence, knowledge, search, agent-runtime, and ui-model. Dashboard work should build on those instead of reading human CLI output or parsing Markdown where structured runtime data exists.

## Command Surface Snapshot

Source command:

```bash
node apps/cli/dist/index.js commands --json
```

At this snapshot date, the registry exposed 81 commands across workspace, meta, workflow, install, registry, agent, work, dependency, evidence, source, claim, decision, context, search, reservation, session, operation, export, import, vault, raw, wiki, duplicate, merge, compact, sync, ledger, snapshot, doctor, and lock categories. This is historical evidence, not a live inventory; use `bwrk commands --json` for the installed version.

Important existing commands for work execution:

- `work create`, `work ready`, `work list`, `work next`, `work show`
- `work block`, `dep add`, `dep remove`, `dep tree`, `dep cycles`
- `work reserve`, `work claim`, `work release`, `work renew`
- `work verify`, `work close`, `agent start`, `agent finish`, `agent status`
- `session start`, `session end`, `sync refresh`, `sync status`, `doctor`, `doctor skills`

Confirmed command gaps for the dashboard roadmap:

- No `dashboard` command namespace yet.
- No first-class `sprint` command namespace yet.
- Project/global `registry` list/add/remove/import-setup/doctor commands exist, including idempotent import from the current workspace setup.
- No board, Kanban, or global dashboard JSON endpoint yet.
- No command-doc drift checker yet.

The immediate contract work should therefore define JSON-first dashboard and sprint-board commands before UI implementation depends on them.

## Component Dump Scope

Source file:

```text
dump/Brand design system setup/Components.dc.html
```

Captured facts:

- File size: 473,452 bytes.
- Line count: 3,475.
- Screen labels: 177.
- First screens include Colors, Typography, Spacing & Radii, Accessibility, Buttons, Badges & Status, Cards, Inputs, Task Rows, PriorityBadge, HealthBadge, LabelChip, EntityChip, ActorAvatar, DateTimeLabel, MetricCard, InlineNotice, EmptyState, ErrorState, and LoadingSkeleton.

Working component buckets:

- Foundation: 35 matches. Includes tokens, buttons, badges, cards, inputs, chips, avatars, labels, metrics, notices, empty/error/loading states, dialogs, and fields.
- Entity/work detail: 46 matches. Includes entity detail/list, source refs, linked entities, comments, events, verification, dependencies, lineage, health findings, frontmatter, wiki/raw detail, claims, and decisions.
- Global dashboard: 19 matches. Includes global sidebar, overview metrics, bucket grid, ready/blocked queues, search results, actor activity, health summary, settings, knowledge review, duplicate work, dependency cycles, and project switching.
- Sprint and board: 26 matches. Includes sprint sidebar, board switcher, progress summary, SprintHeader, SprintScopeSummary, SprintKanbanBoard, SprintKanbanCard, SprintWorkTable, SprintDependencyView, SprintTimelineView, board table/calendar/roadmap/matrix, and static sprint/project reports.
- Repo and memory: 27 matches. Includes repo sidebar, project status, source coverage, ingest queue, source preview, ingest plan, diff review, project overview, wiki explorer, backlinks, outbound links, page claims, raw inbox, reports, vault dashboard links, and static knowledge/project reports.
- Operations: 25 matches. Includes command palette, diff viewer, timeline, inspector, bulk actions, context bundle, sync/index/database/cache/lock/migration/git/Obsidian status panels, and actor/change timelines.

Conversion rule: treat the dump as a user-provided design/source inventory, not as a single component file to ship. Split it into typed component modules, shared tokens, fixtures, and dashboard feature groups.

External-code rule: do not copy implementation code from all-rights-reserved Claude Code sourcemap research. Boreal may use interface conventions already captured in `docs/architecture/CLI_UX.md`, but implementation must remain original.

## Readiness Model

The v1 remainder bucket intentionally uses blockers so the ready queue is narrow:

- Leaf tasks are the only claimable items at the start of a phase.
- Phase gates depend on their child tasks.
- Sprint gates depend on their phase gates.
- The v1 completion milestone depends on the sprint gates.
- Later sprint tasks depend on the previous sprint gate when their work should not start yet.
- `work next --label v1-remainder` should expose only the next safe slice, not the whole roadmap.

At capture time, the ready queue correctly exposed only three Sprint 01 Phase 01A tasks. That proves the initial gating shape is working.

## Closeout Gates For Remaining Sprints

Every remaining sprint should close only when these are true:

- All child tasks are closed with evidence and passing verification, or explicitly deferred into a later labeled item with a reason.
- All phase gates are closed after their child tasks and any required docs/tests/commands are updated.
- `sync refresh --json` has been run after tracker, memory, context, search, or generated-artifact changes.
- `doctor --strict --json` passes, or any remaining diagnostic is explicitly tied to an open blocker.
- The next ready queue has been checked so the next slice is intentional.
- Any UI/dashboard work has proof appropriate to its surface: typecheck/tests for code, browser or terminal rendering checks for UI, and command JSON fixtures for contract work.
- Memory/project boundary work has proof that project root, memory root, Git mode, and install root cannot silently cross into another repo.

## Immediate Next Build Order

After closing these baseline tasks, Sprint 01 should continue with Phase 01B:

1. Add work queue and sprint board view models to `packages/ui-model`.
2. Add health, sync, and lock dashboard view models.
3. Add global registry view model contracts.

Those contracts should land before the console, CLI dashboard, or TUI surfaces consume them.
