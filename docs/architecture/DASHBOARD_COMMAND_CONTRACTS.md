# Dashboard Command Contracts

Status: global dashboard command and sprint list/show/current/activate/board commands implemented; remaining dashboard views are planning contracts.

This document specifies the command surface that the client console, optional CLI dashboard, and future TUI should consume. It is intentionally JSON-first. Rich terminal or browser views may render this data, but they must not become the only contract.

## Contract Rules

- Every dashboard command supports `--json`.
- JSON output is the contract for agents, console adapters, MCP, tests, and future package consumers.
- Plain text output stays deterministic and line-oriented.
- Rich dashboard output is opt-in through `--view dashboard`, `--interactive`, or a dedicated interactive command.
- Commands that only read projections use no write lock.
- Commands that activate or change sprint/dashboard state use the `state` lock.
- Commands that refresh context/search/ledgers keep using `sync refresh`.
- Commands must never infer another repository's memory root. Workspace, project root, memory root, and install root must come from the current Boreal workspace or an explicit `--workspace`.
- MCP and daemon adapters that consume these contracts must apply the per-request root guard in `docs/architecture/MCP_DAEMON_BOUNDARY.md` before exposing project-scoped resources.

## Dashboard Namespace

The namespace is `bwrk dashboard <view>`. `dashboard global` is implemented as a bounded JSON data endpoint; the remaining views are planned.

| Command | Purpose | JSON schema | Result cap | Lock | Human output |
| --- | --- | --- | --- | --- | --- |
| `dashboard global` | Global overview for registered projects or the current project when no registry exists. | `boreal.cli.dashboard.global.v1` | 100 projects, 250 work rows per project, 200 queue rows, 10 search rows and 20 activity rows per project | none | deterministic summary table |
| `dashboard project` | Current project dashboard: work health, memory health, queues, reservations, sync state. | `boreal.cli.dashboard.project.v1` | 500 rows | none | summary/table, optional dashboard |
| `dashboard sprint [<sprint-ref>]` | Active or selected sprint dashboard payload. | `boreal.cli.dashboard.sprint.v1` | 500 rows | none | summary/table, optional dashboard |
| `dashboard queues` | Ready, blocked, in-progress, verification, and stale queues. | `boreal.cli.dashboard.queues.v1` | 500 rows | none | table |
| `dashboard health` | Doctor/sync/lock/search/ledger health normalized for UI rendering. | `boreal.cli.dashboard.health.v1` | 200 findings | none | grouped findings |
| `dashboard status` | Small status payload for top bars, command prompts, and health badges. | `boreal.cli.dashboard.status.v1` | compact only | none | key-value summary |

Dashboard commands should use shared view models from `@boreal/ui-model`:

- `WorkDashboardView`
- `SprintBoardView`
- `DashboardHealthView`
- `SyncDashboardView`
- `LockDashboardView`
- `ProjectRegistryView`
- `GlobalWorkQueuesView`
- `GlobalSearchView`
- `GlobalActivityView`
- `GlobalHealthView`
- `GlobalSettingsView`

The browser console global route currently builds `ProjectRegistryView` and `GlobalWorkQueuesView` from `registry list`, `registry doctor`, project-scoped `work list --limit 250`, `sync status`, `doctor`, and `reservation list --status active` reads. It builds `GlobalSearchView` from project-scoped `search query <query> --limit 10 --json` reads, `GlobalActivityView` from project-scoped `operation list --limit 20 --json` reads, `GlobalHealthView` from project-scoped registry, sync, doctor, lock, search, ledger, Git, vault, and setup findings, and `GlobalSettingsView` from registry/project setup rows. `bwrk dashboard global --json` emits the same shared model sections as a bounded CLI endpoint for agents and future adapters. When a registry entry points at another project root, the console uses explicit `--workspace <project-root>` reads and keeps the selected workspace context visible instead of silently switching it.

Global queue rows carry `projectId`, `projectName`, `projectRoot`, and the nested work row. Ready rows expose a copyable `work reserve <work-id>` command that includes `--workspace <project-root>` so a targeted claim cannot silently run against the console's selected workspace.

Global search and activity rows follow the same rule. Search rows carry project identity plus the source `type` returned by `search query`; activity rows carry project identity plus `actorKind` from `operation list` so dashboards can distinguish human, agent, and system operations without guessing from actor IDs.

Global health and drift rows also carry `projectId`, `projectName`, `projectRoot`, `workspaceRoot`, source path, finding category, and original diagnostic code. Repair actions are displayed as scoped commands; `bwrk` repairs are rewritten to `bwrk --workspace <project-root> ...`, Git repairs use `git -C <project-root> ...`, and mutating actions are marked as requiring confirmation before execution.

Global settings rows expose project root, memory root, memory layout, memory Git mode, optional memory remote, and install root. The settings view describes `shared`, `separate`, and `submodule` memory Git modes, with `separate` as the default mixed-history guardrail. Project settings writes must require confirmation and run target `doctor --json` before registry or setup writes; failed doctor health blocks the write.

## Sprint Namespace

The implemented namespace is `bwrk sprint <action>` for `list`, `show`, `current`, `activate`, and `board`. The existing work records remain canonical; sprint commands are typed views and narrow mutations over `kind: "sprint"` work items. `clear` remains a planned dashboard-oriented extension.

| Command | Purpose | JSON schema | Result cap | Lock | Human output |
| --- | --- | --- | --- | --- | --- |
| `sprint list` | List sprint work items with status, labels, dates if present, and active sprint marker. | `boreal.cli.sprint.list.v1` | 200 sprints | none | table |
| `sprint show <sprint-ref>` | Show one sprint record, child phases, tasks, blockers, and evidence counts. | `boreal.cli.sprint.show.v1` | 500 child rows | none | record |
| `sprint current` | Resolve the active sprint for this workspace. | `boreal.cli.sprint.current.v1` | compact only | none | key-value summary |
| `sprint activate <sprint-ref>` | Mark one sprint active for dashboard and agent-start defaults. | `boreal.cli.sprint.activate.v1` | compact only | state | record with previous/current |
| `sprint clear` | Clear the active sprint pointer without changing work records. | `boreal.cli.sprint.clear.v1` | compact only | state | record |
| `sprint board [<sprint-ref>]` | Return the `SprintBoardView` payload for active or selected sprint. | `boreal.cli.sprint.board.v1` | 500 child rows | none | table, optional dashboard |

Sprint activation constraints:

- Activation stores only a deterministic workspace-local `active-sprint` projection. It does not move work across repos.
- Activation fails closed when the sprint reference is ambiguous, missing, not `kind: "sprint"`, or outside the selected workspace.
- Activation records a `sprint.activated` runtime event linked to the command operation so dashboards and agents can audit who changed the active sprint.
- Activation never reads sibling memory roots unless the user supplied that workspace explicitly.
- `sprint show` and `sprint current` compute sprint scope from canonical `blocks` graph edges plus dependency ID projections, not labels.
- `sprint board` computes active blockers from canonical dependency graph edges, not stale `dependencyIds` alone.

## Registry Namespace

The implemented namespace is `bwrk registry <action>`. The backing document contract is `boreal.project-registry.v2` with schema ID `https://boreal.work/schemas/projects/project-registry.schema.json`.

| Command | Purpose | JSON schema | Result cap | Lock | Human output |
| --- | --- | --- | --- | --- | --- |
| `registry list` | List known Boreal projects. | `boreal.cli.registry.list.v1` | 200 projects | none | table |
| `registry add --workspace <path>` | Add an explicit Boreal workspace to the local registry. | `boreal.cli.registry.add.v1` | compact only | registry | record |
| `registry remove <project-id>` | Archive a workspace in the local registry without deleting project files; `--purge` removes the row. | `boreal.cli.registry.remove.v1` | compact only | registry | record |
| `registry import-setup` | Import the selected workspace `.boreal/project.json` into the local registry idempotently. | `boreal.cli.registry.import-setup.v1` | compact only | state+registry | record |
| `registry doctor` | Validate registered roots, memory roots, runtime files, install roots, and project setup drift. | `boreal.cli.registry.doctor.v1` | 200 findings | none | grouped findings |

Registry constraints:

- Registry commands never auto-scan arbitrary parent directories.
- Each entry stores project root, `.boreal` root, runtime state file, project setup config path, memory root, memory `.boreal` root, memory layout, memory Git mode, install root, display metadata, and last-seen health.
- The global dashboard may aggregate registered projects, but every row keeps project identity and workspace path explicit.
- Mutating actions route through the target workspace; they do not combine memory records across projects.
- Cross-project ready, blocked, and needs-verification queues must keep project identity on every item, including when two projects contain the same work ID.

## Board Data Contract

Sprint board JSON includes:

- `sprint`: selected sprint `WorkItemView`.
- `phases`: phase gate rows.
- `lanes`: draft, ready, blocked, in-progress, needs-verification, verified, closed, and cancelled.
- `summary`: sprint ID, phase count, task count, status counts, active blocker count, active reservations, expired reservations.
- `generatedAt`: timestamp for stale-data indicators.

Work rows should include:

- Work ID, title, kind, status, priority, labels.
- `dependencyIds` for full dependency history.
- `activeBlockerIds` for currently open blockers.
- Evidence and verification counts.
- Active reservation ID when present.
- Context summary when available.

## Board Transition Contract

Board lanes are derived views, not writable fields. UI cannot mutate `.boreal/runtime/state.json`, work `status`, `reservationId`, `dependencyIds`, evidence IDs, verification IDs, graph edges, or projections directly. Every board action must render a command descriptor with exact argv, `mutatesState`, `requiresConfirmation`, target `workspaceRoot`, and the selected `workId` or `sprintId`; the command execution boundary is the only place mutations happen.

Allowed board transitions:

| UI intent | Command contract | Required policy gate |
| --- | --- | --- |
| Refresh board | `bwrk sprint board [<sprint-ref>] --json` | Read-only; no confirmation. |
| Select active sprint | `bwrk sprint activate <sprint-ref> --json` | Mutating; `requiresConfirmation: true`; records active-sprint projection and activation event. |
| Recompute ready state | `bwrk work ready <work-id> --json` | Mutating; `requiresConfirmation: true`; only derives readiness from current blockers and cannot force blocked work into ready. |
| Claim/start a card | `bwrk work reserve <work-id> --agent <agent-id> --purpose <text> --json` | Mutating; `requiresConfirmation: true`; exact work ID only. Board UI must not run broad `work claim` for a card. |
| Release an in-progress card | `bwrk work release <work-id> --json` | Mutating; `requiresConfirmation: true`; restores derived readiness from blockers. |
| Add completion evidence | `bwrk evidence add <work-id> --summary <text> --kind <kind> --outcome <outcome> [--command <cmd>] [--uri <uri>] --json` | Mutating; `requiresConfirmation: true`; evidence must be recorded before verification. |
| Verify a card | `bwrk work verify <work-id> --evidence <evidence-id> --verdict passed --json` | Mutating; `requiresConfirmation: true`; passed verification requires passed evidence under runtime policy. |
| Close a card | `bwrk work close <work-id> --reason <text> --json` | Mutating; `requiresConfirmation: true`; close reason required and verification policy must already be satisfied. |
| Reserved-work closeout | `bwrk agent finish current --agent <agent-id> --summary <text> --kind <kind> --command <cmd> --verdict passed --close --reason <text> --json` | Preferred for owned active reservations because evidence, verification, close, release, readiness recompute, and eventing are one transaction. |
| Add or remove blockers | `bwrk dep add <work-id> <depends-on-work-id> --json` or `bwrk dep remove <work-id> <depends-on-work-id> --json` | Mutating; `requiresConfirmation: true`; dependency cycles and missing graph edges fail closed. |

Forbidden board transitions:

- Directly patching a card's lane, status, reservation, dependency, evidence, verification, event, or projection fields.
- Fabricating evidence or verification IDs in UI state.
- Using `--force` reservation flows from drag/drop interactions. Forced reservations require a separate explicit reasoned command.
- Running a mutating command without showing the exact workspace-scoped command and receiving confirmation.
- Moving `dependencyIds` into `activeBlockerIds`; `activeBlockerIds` remains the derived unresolved-blocker subset.

## Command-Doc Drift Check

Add a registry-backed check command:

```bash
bwrk commands check-docs [--path docs/cli/COMMANDS.md] [--json]
```

Behavior:

- Generate the command reference from `COMMAND_DEFINITIONS`.
- Parse the checked docs file headings and fenced command snippets.
- Report missing commands, stale usage strings, missing JSON schema IDs, and undocumented flags.
- Exit nonzero when required command docs drift.
- In JSON mode, return `boreal.cli.commands.check-docs.v1`.

Test entry point:

```bash
tests/runtime/command-docs.test.ts
```

CI entry point:

```bash
pnpm test -- tests/runtime/command-docs.test.ts
```

The test should fail when a command is added to `COMMAND_DEFINITIONS` without a matching generated reference section or accepted docs update. This keeps `docs/cli/COMMANDS.md` from silently drifting behind the command registry.

## Implementation Order

1. Add registry/view-model support first when a command needs a new shared payload.
2. Add read-only command contracts before mutating actions.
3. Add dashboard commands over stable JSON payloads.
4. Add optional rich terminal rendering after JSON/plain outputs have tests.
5. Add command-doc drift checking before expanding the dashboard command namespace broadly.
