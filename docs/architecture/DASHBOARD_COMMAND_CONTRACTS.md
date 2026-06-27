# Dashboard Command Contracts

Status: planning contract for Sprint 01 Phase 01C.

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

## Dashboard Namespace

The proposed namespace is `bwrk dashboard <view>`.

| Command | Purpose | JSON schema | Result cap | Lock | Human output |
| --- | --- | --- | --- | --- | --- |
| `dashboard global` | Global overview for registered projects or the current project when no registry exists. | `boreal.cli.dashboard.global.v1` | 100 projects, 200 queue rows | none | summary/table, optional dashboard |
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

## Sprint Namespace

The proposed namespace is `bwrk sprint <action>`. The existing work records remain canonical; sprint commands are typed views and narrow mutations over `kind: "sprint"` work items.

| Command | Purpose | JSON schema | Result cap | Lock | Human output |
| --- | --- | --- | --- | --- | --- |
| `sprint list` | List sprint work items with status, labels, dates if present, and active sprint marker. | `boreal.cli.sprint.list.v1` | 200 sprints | none | table |
| `sprint show <sprint-ref>` | Show one sprint record, child phases, tasks, blockers, and evidence counts. | `boreal.cli.sprint.show.v1` | 500 child rows | none | record |
| `sprint current` | Resolve the active sprint for this workspace. | `boreal.cli.sprint.current.v1` | compact only | none | key-value summary |
| `sprint activate <sprint-ref>` | Mark one sprint active for dashboard and agent-start defaults. | `boreal.cli.sprint.activate.v1` | compact only | state | record with previous/current |
| `sprint clear` | Clear the active sprint pointer without changing work records. | `boreal.cli.sprint.clear.v1` | compact only | state | record |
| `sprint board [<sprint-ref>]` | Return the `SprintBoardView` payload for active or selected sprint. | `boreal.cli.sprint.board.v1` | 500 child rows | none | table, optional dashboard |

Sprint activation constraints:

- Activation stores only a workspace-local pointer or projection. It does not move work across repos.
- Activation fails closed when the sprint reference is ambiguous, missing, not `kind: "sprint"`, or outside the selected workspace.
- Activation records an operation/event so dashboards and agents can audit who changed the active sprint.
- Activation never reads sibling memory roots unless the user supplied that workspace explicitly.
- `sprint board` must compute active blockers from canonical dependency graph edges, not stale `dependencyIds` alone.

## Registry Namespace

The proposed namespace is `bwrk registry <action>`. This should come after the global registry schema is implemented.

| Command | Purpose | JSON schema | Result cap | Lock | Human output |
| --- | --- | --- | --- | --- | --- |
| `registry list` | List known Boreal projects and health summaries. | `boreal.cli.registry.list.v1` | 200 projects | none | table |
| `registry add --workspace <path>` | Add an explicit Boreal workspace to the local registry. | `boreal.cli.registry.add.v1` | compact only | state | record |
| `registry remove <project-id>` | Remove a workspace from the local registry without deleting project files. | `boreal.cli.registry.remove.v1` | compact only | state | record |
| `registry doctor` | Validate registered roots, memory repos, gitignore guards, and drift state. | `boreal.cli.registry.doctor.v1` | 200 findings | none | grouped findings |

Registry constraints:

- Registry commands never auto-scan arbitrary parent directories.
- Each entry stores project root, memory root, memory layout, memory Git mode, install root, and last-seen health.
- The global dashboard may aggregate registered projects, but every row keeps project identity and workspace path explicit.
- Mutating actions route through the target workspace; they do not combine memory records across projects.

## Board Data Contract

Sprint board JSON should include:

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
3. Add `sprint activate` only after active sprint storage is explicit and doctor-checkable.
4. Add dashboard commands over stable JSON payloads.
5. Add optional rich terminal rendering after JSON/plain outputs have tests.
6. Add command-doc drift checking before expanding the dashboard command namespace broadly.
