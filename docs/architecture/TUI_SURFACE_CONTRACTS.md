# TUI Surface Contracts

This page defines the two first-class terminal UI surfaces and their typed data contracts.

This document describes the terminal dashboard contracts Boreal should expose for humans and agents. It is intentionally JSON-first: the TUI renders bounded view models and emits command descriptors for mutations, but durable records, CLI JSON envelopes, memory files, ledgers, and runtime operations remain canonical.

The current `apps/tui` implementation is an optional Ink/React shell. Its implemented routes are global `Overview`, `Projects`, and `Queues`; repo `Roll-Up` and `Sprint Board`; and task-detail drill-down. The remaining rail routes intentionally render planned placeholders. This document defines the full target contract for two first-class TUI surfaces:

- Global TUI: a cross-repo operator surface for registered projects.
- Repo TUI: a single-repository execution surface with roll-ups, milestones, sprints, tasks, drill-downs, filters, and closeout flows.

## Design Goals

- Keep terminal interaction fast: list, filter, drill, act, refresh.
- Keep repo identity explicit on every cross-repo row.
- Share typed view models with `apps/console`, CLI dashboard commands, MCP adapters, and tests through `@boreal/ui-model`.
- Keep all mutations behind exact, inspectable command descriptors.
- Make roll-ups first-class: project -> milestone -> sprint -> task should be navigable without losing queue, blocker, evidence, verification, or closeout context.
- Make filters a stable contract rather than ad hoc UI state.
- Support both global monitoring and repo execution without silently switching workspace roots.

## Non-Goals

- The TUI must not patch `.boreal/runtime/state.json` or object files directly.
- The TUI must not become the only source of a data shape. Every page must have a JSON contract usable outside Ink.
- The TUI must not infer sibling repositories. Cross-repo views use registry rows or explicit `--workspace <project-root>`.
- The TUI must not copy workflow safety rules into UI code. Workflow actions link to workflow/source commands and installed skill adapters.
- The TUI must not use browser-only UI dependencies. Browser icons and React DOM components stay in `apps/console`.

## Surface Map

| Surface | Launch | Scope | Primary use | Composite payload |
| --- | --- | --- | --- | --- |
| Global TUI | `bwrk global` or `bwrk dashboard --global` | Machine-level global workspace plus registered projects | Watch project health, cross-repo queues, activity, registry settings, daemon state | `boreal.tui.global.v1` built from `boreal.cli.dashboard.global.v1` |
| Repo TUI | `bwrk dashboard` | One selected Boreal workspace | Work a repo: roll-ups, milestones, sprints, tasks, evidence, closeout, health | `boreal.tui.repo.v1` built from repo-scoped CLI/runtime views |

Global and repo surfaces are peers, not parent/child modes. A global row can open a repo surface, but it does so by passing an explicit `workspaceRoot` and preserving a breadcrumb back to the originating global view.

## Shared Shell Contract

Every TUI page renders inside the same frame.

```text
+ boreal  global > Projects > boreal-work                     08:52:11 +
| Global |  Body area: table, board, tree, detail, or report             |
| Queues |                                                            |
| Search |                                                            |
| Health |                                                            |
| Sets   |                                                            |
+ o/s/w/a sections  / search  f filter  enter open  esc back  r refresh +
```

Shell regions:

- Top bar: product label, surface (`global` or repo name), breadcrumbs, generated time, refresh state, stale/error badge.
- Left rail: stable section keys for the active surface.
- Body: one list, tree, board, report, or detail view. Tables must use stable column widths and windowing.
- Detail pane: inline full-body detail on narrow terminals; right-side split on wide terminals when supported.
- Command palette: global overlay for search, jump, commands, and filters.
- Footer: context-specific key hints from the same binding specs used by input dispatch.

Shared shell data:

```ts
export type TuiSurfaceKind = "global" | "repo";

export interface TuiEnvelope<TBody> {
  readonly schemaVersion: string;
  readonly generatedAt: string;
  readonly surface: TuiSurfaceKind;
  readonly workspaceRoot: string;
  readonly stale: boolean;
  readonly warnings: readonly string[];
  readonly limits: TuiLimits;
  readonly truncated: TuiTruncation;
  readonly body: TBody;
}

export interface TuiLimits {
  readonly projects?: number;
  readonly workPerProject?: number;
  readonly rowsPerPage?: number;
  readonly searchResults?: number;
  readonly activityRows?: number;
  readonly treeNodes?: number;
}

export interface TuiTruncation {
  readonly projects?: boolean;
  readonly work?: boolean;
  readonly search?: boolean;
  readonly activity?: boolean;
  readonly tree?: boolean;
}
```

Shared navigation:

```ts
export type TuiEntityKind =
  | "project"
  | "workspace"
  | "milestone"
  | "sprint"
  | "task"
  | "issue"
  | "work"
  | "evidence"
  | "verification"
  | "agentSummary"
  | "event"
  | "operation"
  | "healthFinding"
  | "rawSource"
  | "wikiPage"
  | "claim"
  | "decision"
  | "report";

export interface TuiEntityRef {
  readonly kind: TuiEntityKind;
  readonly id: string;
  readonly projectId?: string;
  readonly projectName?: string;
  readonly projectRoot?: string;
  readonly workspaceRoot: string;
  readonly label: string;
}

export interface TuiNavFrame {
  readonly routeId: string;
  readonly title: string;
  readonly cursor: number;
  readonly entity?: TuiEntityRef;
  readonly filters?: TuiFilterState;
}
```

Shared filtering:

```ts
export type TuiFilterOperator = "is" | "isNot" | "contains" | "before" | "after" | "empty" | "notEmpty";

export interface TuiFilterClause {
  readonly field: string;
  readonly operator: TuiFilterOperator;
  readonly value?: string;
}

export interface TuiSortSpec {
  readonly field: string;
  readonly direction: "asc" | "desc";
}

export interface TuiFilterState {
  readonly query?: string;
  readonly clauses: readonly TuiFilterClause[];
  readonly sort: readonly TuiSortSpec[];
  readonly showClosed?: boolean;
  readonly showCancelled?: boolean;
}
```

Shared actions:

```ts
export type TuiActionEffect = "read" | "write" | "danger";

export interface TuiCommandDescriptor {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly workspaceRoot: string;
  readonly projectId?: string;
  readonly subject?: TuiEntityRef;
  readonly argv: readonly string[];
  readonly displayCommand: string;
  readonly effect: TuiActionEffect;
  readonly mutatesState: boolean;
  readonly requiresConfirmation: boolean;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  readonly expectedSchemaVersion?: string;
}
```

Rules:

- A read action can run immediately.
- A write or danger action must render `displayCommand`, target workspace, and subject before execution.
- Global actions always include `--workspace <projectRoot>` when they target a registered project.
- A row can expose multiple actions, but the row itself is not mutable state.
- Command success refreshes the smallest affected payload: current entity, current page, then whole surface if needed.

## Global TUI

The Global TUI is a machine-level operator cockpit. It has two responsibilities:

- Show the global workspace's own state.
- Monitor registered Boreal projects without merging their records.

It consumes `bwrk dashboard global --json` as the primary bounded read contract. The TUI-specific wrapper may normalize route state and command descriptors, but the source sections should remain:

- `registry: ProjectRegistryView`
- `globalQueues: GlobalWorkQueuesView`
- `globalSearch: GlobalSearchView`
- `globalActivity: GlobalActivityView`
- `globalHealth: GlobalHealthView`
- `daemonStatus`
- `globalSettings: GlobalSettingsView`

Composite payload:

```ts
export interface GlobalTuiView {
  readonly globalWorkspace: GlobalWorkspaceState;
  readonly overview: GlobalOverviewView;
  readonly registry: ProjectRegistryView;
  readonly projectRollups: readonly GlobalProjectRollupView[];
  readonly queues: GlobalWorkQueuesView;
  readonly search: GlobalSearchView;
  readonly activity: GlobalActivityView;
  readonly health: GlobalHealthView;
  readonly daemonStatus: GlobalDaemonStatusView;
  readonly settings: GlobalSettingsView;
}

export interface GlobalWorkspaceState {
  readonly workspaceRoot: string;
  readonly registryRoot?: string;
  readonly generatedAt: string;
  readonly stale: boolean;
  readonly warnings: readonly string[];
}

export interface GlobalOverviewView {
  readonly generatedAt: string;
  readonly workspaceRoot: string;
  readonly registrySummary: ProjectRegistrySummary;
  readonly queueSummary: GlobalWorkQueueSummary;
  readonly activitySummary: GlobalActivitySummary;
  readonly healthSummary: GlobalHealthSummary;
  readonly attention: readonly GlobalAttentionItem[];
}

export interface GlobalAttentionItem {
  readonly id: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly projectRoot: string;
  readonly category: GlobalHealthCategory | GlobalWorkQueueId | "daemon" | "activity";
  readonly severity: DashboardFindingSeverity;
  readonly title: string;
  readonly message: string;
  readonly target?: TuiEntityRef;
  readonly action?: TuiCommandDescriptor;
}

export interface GlobalDaemonStatusView {
  readonly generatedAt: string;
  readonly projects: readonly GlobalDaemonProjectStatus[];
}
```

### Global Routes

| Route | Purpose | Main contract | Drill target |
| --- | --- | --- | --- |
| Overview | One-screen status for every linked project and the global workspace | `GlobalOverviewView` | project, queue, health finding |
| Projects | Registered project rollups, stale rows, memory modes, open/ready/blocked counts | `ProjectRegistryView` plus `GlobalProjectRollupView` | project detail, repo surface |
| Queues | Ready, blocked, and needs-verification work across projects | `GlobalWorkQueuesView` | work detail in owning repo |
| Search | Cross-project search results with source kind and score | `GlobalSearchView` | source detail or repo work detail |
| Activity | Cross-project operation and event timeline | `GlobalActivityView` | operation detail, project detail |
| Health | Registry, sync, lock, search, ledger, setup, Git, vault, and daemon findings | `GlobalHealthView` plus daemon rows | health finding detail |
| Settings | Project registry and memory setup controls | `GlobalSettingsView` | project setup detail |

### Global Overview Layout

Purpose: answer "what needs attention across all my projects?"

Layout:

```text
METRICS: projects ok warning error stale | ready blocked verify | active reservations

Attention Queue
status  project       item                               age/why
err     boreal-work   search index stale                 search
warn    project-alpha 4 blocked tasks                    blockers
ready   cli-tools     Implement fixture smoke            high

Linked Projects
health  project       open  ready  blocked  reserve  stale  root
ok      boreal-work   81    9      2        1        no     /...
warn    project-alpha 17    3      4        0        yes    /...

Recent Activity
time      project       actor   command                 state
08:49:12  boreal-work   agent   work reserve ...        changed
```

Required fields:

- Project identity: `projectId`, `projectName`, `projectRoot`, `workspaceRoot`.
- Health: `health`, `stale`, `syncFreshness`, category counts.
- Work counts: open, ready, blocked, needs verification, active reservations.
- Attention rows: stable row ID, source category, severity, title, message, command descriptor when fixable.
- Recent operations: actor kind, command path, status, state change flags.

Primary flows:

- Open a project: enter on a project row launches/enters Repo TUI with that `projectRoot`.
- Claim ready work: enter on ready queue item opens work detail; action panel exposes `bwrk --workspace <projectRoot> work reserve <work-id> ... --json`.
- Repair drift: enter on finding opens finding detail and exact scoped command.
- Refresh: reload `dashboard global --json`.

### Projects Page

Purpose: inspect and manage the registry without losing work-state context.

Table columns:

- health
- project
- open
- ready
- blocked
- reservations
- memory mode
- stale
- root

Filters:

- health: `ok`, `warning`, `error`, `missing`
- stale: yes/no
- memoryGitMode: `shared`, `separate`, `submodule`
- label/name query
- has ready work
- has blocked work
- has active reservation

Project detail layout:

```text
Project: boreal-work
Root: /path/to/project
Memory: /path/to/project/memory
Mode: child + separate git
Health: warning, sync stale

Work rollup: open 81 | ready 9 | blocked 2 | reservations 1
Subsystems: vault ok | ledgers ok | search stale | git ok | daemon running

Actions:
  open repo dashboard
  validate project
  import setup
  unlink project
```

Contracts:

```ts
export interface GlobalProjectRollupView {
  readonly project: ProjectRegistryEntry;
  readonly workSummary: GlobalProjectWorkSummary;
  readonly healthSummary: GlobalProjectHealthSummary;
  readonly daemon?: GlobalDaemonProjectStatus;
  readonly actions: readonly TuiCommandDescriptor[];
}

export interface GlobalProjectWorkSummary {
  readonly open: number;
  readonly ready: number;
  readonly blocked: number;
  readonly needsVerification: number;
  readonly activeReservations: number;
  readonly topLabels: readonly { readonly label: string; readonly count: number }[];
}

export interface GlobalProjectHealthSummary {
  readonly health: ProjectHealthState;
  readonly stale: boolean;
  readonly syncFreshness: ProjectSyncFreshness;
  readonly findingCount: number;
  readonly errorCount: number;
  readonly warningCount: number;
}
```

### Global Queues Page

Purpose: triage actionable work across projects while keeping ownership and workspace explicit.

Lanes:

- Ready: claimable work.
- Blocked: work with unresolved dependencies.
- Needs verification: work waiting for verification/evidence.

Layout:

```text
READY (9)                         BLOCKED (2)                       VERIFY (3)
project      title        prio    project      title        why     project      title
project-alpha Add ...    high    project-alpha Import ...  2 deps  project-beta ...
```

Narrow terminals use a single table with a queue column.

Row requirements:

- `id`: `${projectId}:${work.id}`
- project identity
- nested `WorkItemView`
- derived queue ID
- claim/verify command descriptors where applicable
- blockers: unresolved blocker IDs and titles when available
- reservation summary

Actions:

- Open work detail in the owning repo.
- Copy/run scoped claim command.
- Open blockers filter for the owning repo.
- Jump to project health if the row is stale or project is unhealthy.

### Global Search Page

Purpose: search all registered projects without conflating identical IDs.

Layout:

```text
Search: [active-sprint dashboard]
type       project       title                         score   source
work       boreal-work   Add global dashboard ...      0.91    bw_work_...
decision   project-beta  Memory Git mode choice       0.73    bw_decision_...
raw        cli-tools     Smoke output                  0.62    bw_source_...
```

Contracts:

```ts
export interface GlobalSearchView {
  readonly generatedAt?: string;
  readonly query: string;
  readonly results: readonly GlobalSearchResultItem[];
  readonly count: number;
}

export interface GlobalSearchResultItem {
  readonly id: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly projectRoot: string;
  readonly sourceKind: string;
  readonly recordId: string;
  readonly title: string;
  readonly summary?: string;
  readonly score: number;
}
```

Required behavior:

- `/` opens the palette with cross-project search scope.
- `enter` on a work result opens repo work detail with explicit workspace.
- `enter` on knowledge/raw/claim/decision results opens a source detail preview if available; otherwise it opens the repo Knowledge page with selected entity.
- Results must be stable-sorted by score, project name, then title.

### Global Activity Page

Purpose: audit what changed across projects and who did it.

Rows:

- finished time
- project
- actor kind
- command path
- status/exit code
- state changed
- generated artifacts changed
- event count

Detail:

- argv
- session ID
- actor ID and kind
- linked event IDs
- error code/message when failed
- command descriptor to inspect project state after operation

Contracts use `GlobalActivityView`, `GlobalActivityItem`, and a planned `OperationDetailView` for expansion.

### Global Health Page

Purpose: group all cross-repo drift and repair work.

Sections:

- Project status matrix.
- Drift groups by category: doctor, sync, lock, search, ledger, setup, registry, git, vault, daemon, other.
- Fixable actions with confirmation requirements.

Rows require:

- project identity
- category
- original code
- severity/status
- title/message
- source path when available
- actions with exact scoped commands

Daemon status should be a peer health source, not a separate hidden page:

```ts
export interface GlobalDaemonProjectStatus {
  readonly projectId: string;
  readonly projectName: string;
  readonly projectRoot: string;
  readonly state: string;
  readonly pid?: number;
  readonly processAlive: boolean;
  readonly statusPath: string;
  readonly findings: readonly DashboardFinding[];
  readonly recommendedActions: readonly DashboardAction[];
}
```

### Global Settings Page

Purpose: manage the explicit registry and memory setup without auto-discovery.

Rows:

- project
- project root
- memory root
- memory layout
- memory Git mode
- memory remote
- install root
- health/stale

Actions:

- add/link project
- import setup
- apply setup
- validate
- unlink/archive

All write actions require confirmation and should run a target `doctor --json` check before mutating registry or setup state.

## Repo TUI

The Repo TUI is the execution surface for one Boreal workspace. It should be the place where an operator or agent can move from the repo roll-up into milestones, sprints, tasks, evidence, verification, activity, and health without changing tools.

### Repo Routes

| Route | Purpose | Main contract | Drill target |
| --- | --- | --- | --- |
| Overview | Current repo roll-up, active sprint, queue metrics, recent activity | `RepoOverviewView` | roll-up, sprint, queue, health |
| Roll-Up | Project/milestone/sprint/task hierarchy with progress and blockers | `RepoRollupView` | milestone, sprint, task |
| Milestones | Milestone list and milestone detail pages | `MilestoneListView`, `MilestoneDetailView` | sprint, task, evidence |
| Sprints | Sprint list, active sprint marker, sprint metrics | `SprintListView`, `TuiSprintData` | sprint detail/board |
| Sprint Board | Board lanes for selected sprint | `SprintBoardView` | task detail |
| Work | Filterable task/issue table across the repo | `WorkDashboardView` | task detail |
| Task Detail | Full work item detail, dependencies, evidence, verification, directives | `WorkDetailView` | blockers, evidence, commands |
| Activity | Runtime event and operation timeline | `RepoActivityView` | event/operation detail |
| Knowledge | Raw inbox, wiki pages, claims, decisions, memory actions | console memory/knowledge views adapted for TUI | source/detail |
| Reports | Generated artifacts, sprint reports, static exports | `ReportsView` adapted for TUI | artifact detail |
| Health | Doctor, sync, locks, setup, daemon, command drift | health view models | finding detail |
| Settings | Workspace roots, memory mode, installed skills, TUI preferences | setup/settings views | setup action |

The existing `apps/tui` route names can remain short (`overview`, `sprints`, `work`, `activity`), but the target model needs all routes above. The left rail can collapse less common routes behind `More` on narrow terminals.

### Repo Composite Payload

```ts
export interface RepoTuiView {
  readonly workspace: RepoWorkspaceState;
  readonly repoRollup: RepoRollupView;
  readonly overview: RepoOverviewView;
  readonly milestones: MilestoneListView;
  readonly sprints: readonly TuiSprintData[];
  readonly activeSprintId?: string;
  readonly work: WorkDashboardView;
  readonly activity: RepoActivityView;
  readonly health: RepoHealthBundleView;
  readonly knowledge?: RepoKnowledgeBundleView;
  readonly reports?: RepoReportsBundleView;
  readonly settings: RepoSettingsView;
  readonly details: RepoDetailIndex;
}

export interface RepoWorkspaceState {
  readonly projectName: string;
  readonly workspaceRoot: string;
  readonly projectRoot: string;
  readonly memoryRoot?: string;
  readonly generatedAt: string;
  readonly stale: boolean;
  readonly warnings: readonly string[];
}

export interface RepoKnowledgeBundleView {
  readonly rawInbox?: RawInboxView;
  readonly wikiExplorer?: WikiExplorerView;
  readonly memoryActions?: MemoryDashboardActionsView;
}

export interface RepoReportsBundleView {
  readonly reports: ReportsView;
}

export interface RepoSettingsView {
  readonly workspaceRoot: string;
  readonly projectRoot: string;
  readonly memoryRoot?: string;
  readonly memoryLayout?: ProjectMemoryLayout;
  readonly memoryGitMode?: ProjectMemoryGitMode;
  readonly installRoot?: string;
  readonly actions: readonly TuiCommandDescriptor[];
}

export interface RepoDetailIndex {
  readonly work: Readonly<Record<string, WorkDetailView>>;
  readonly milestones: Readonly<Record<string, MilestoneDetailView>>;
  readonly events: Readonly<Record<string, TuiActivityEntry>>;
  readonly operations: Readonly<Record<string, OperationSummaryView>>;
}
```

The TUI may load this as one bounded payload or as route-specific payloads, but the data shapes should stay stable either way.

### Overview Page

Purpose: answer "what is this repo doing right now?"

Layout:

```text
Repo: boreal-work                         Memory: child/separate
Health: warning | Sync: stale | Locks: clear | Daemon: running

Metrics
total  ready  active  blocked  verify  reserved  sprints  milestones
81     9      1       2        3       1         5        4

Active Sprint
Terminal dashboard
[############------] 12/18  67%
blockers 2 | active reservations 1 | verify 3

Next Work
status  title                              priority  labels       agent
ready   Add repo roll-up filters           high      tui,rollup   -
blocked Close sprint report gaps           normal    closeout     worker-a

Recent Activity
time      type              subject
08:50:44  work.reserved     bw_work_...
```

Contracts:

```ts
export interface RepoOverviewView {
  readonly generatedAt: string;
  readonly workspaceRoot: string;
  readonly memoryRoot?: string;
  readonly health: RepoHealthSummaryView;
  readonly workSummary: WorkDashboardSummary;
  readonly activeSprint?: SprintOverviewCardView;
  readonly nextWork: readonly WorkItemView[];
  readonly recentActivity: readonly TuiActivityEntry[];
  readonly actions: readonly TuiCommandDescriptor[];
}

export interface SprintOverviewCardView {
  readonly sprint: WorkItemView;
  readonly active: boolean;
  readonly scopeCount: number;
  readonly doneCount: number;
  readonly percentDone: number;
  readonly activeBlockerCount: number;
  readonly activeReservationCount: number;
  readonly needsVerificationCount: number;
}
```

### Repo Roll-Up Page

Purpose: provide a first-class hierarchical view of repo work. This is the "repo roll view": a navigable project roll-up that includes milestones, sprints, tasks, blockers, closeout gates, and progress.

Hierarchy:

- Project/root node.
- Milestones (`kind: "milestone"`) and issue containers.
- Sprints (`kind: "sprint"`) under milestones or containers.
- Tasks/issues under sprints or directly under milestones.
- Dependency/blocker edges shown as badges and expandable relation rows.

Tree row columns:

- expand/collapse marker
- kind
- status
- title
- progress
- blockers
- priority
- owner/reservation
- gates
- labels

Layout:

```text
ROLL-UP  filter: open only  sort: status, priority

kind       status   title                              done   blk  gate  owner
project    warn    boreal-work                         39/81  2    4     -
  milestone ready  Terminal dashboard                  12/18  2    1     -
    sprint  active Terminal UI contracts               8/12   1    1     worker-a
      task  ready  Add repo roll-up filters            -      0    -     -
      task  block  Close sprint report gaps            -      2    review worker-b
  milestone draft  MCP polish                          2/9    0    0     -
```

Contracts:

```ts
export type RollupNodeKind = "project" | "milestone" | "sprint" | "task" | "issue";

export interface RepoRollupView {
  readonly generatedAt: string;
  readonly workspaceRoot: string;
  readonly root: RollupNodeView;
  readonly flatRows: readonly RollupNodeView[];
  readonly summary: RepoRollupSummary;
  readonly filters: RollupFilterOptions;
}

export interface RollupNodeView {
  readonly id: string;
  readonly entity: TuiEntityRef;
  readonly kind: RollupNodeKind;
  readonly title: string;
  readonly status: WorkStatus | ProjectHealthState;
  readonly priority?: WorkPriority;
  readonly depth: number;
  readonly parentId?: string;
  readonly childIds: readonly string[];
  readonly expandedByDefault: boolean;
  readonly progress: RollupProgressView;
  readonly blockerSummary: RollupBlockerSummary;
  readonly reservation?: WorkReservationView;
  readonly labels: readonly string[];
  readonly gateSummary: RollupGateSummary;
  readonly stale: boolean;
  readonly actions: readonly TuiCommandDescriptor[];
}

export interface RollupProgressView {
  readonly total: number;
  readonly done: number;
  readonly open: number;
  readonly percentDone: number;
}

export interface RollupBlockerSummary {
  readonly activeBlockerCount: number;
  readonly blockedDescendantCount: number;
  readonly blockerIds: readonly string[];
}

export interface RollupGateSummary {
  readonly required: number;
  readonly open: number;
  readonly satisfied: number;
  readonly forced: number;
  readonly blockingCloseout: boolean;
}

export interface RepoRollupSummary {
  readonly totalNodes: number;
  readonly milestones: number;
  readonly sprints: number;
  readonly tasks: number;
  readonly open: number;
  readonly blocked: number;
  readonly needsVerification: number;
  readonly closed: number;
  readonly activeReservations: number;
  readonly openCloseoutGates: number;
}

export interface RollupFilterOptions {
  readonly statuses: readonly WorkStatus[];
  readonly kinds: readonly RollupNodeKind[];
  readonly labels: readonly string[];
  readonly priorities: readonly WorkPriority[];
  readonly hasBlockers: boolean;
  readonly hasOpenGates: boolean;
  readonly hasReservation: boolean;
}
```

Roll-up derivation rules:

- Parent/child hierarchy comes from `parentId`, sprint scope, and canonical graph edges used by `sprint show` and `sprint board`.
- `activeBlockerIds` are derived unresolved blockers, not copied from stale dependency history.
- Progress counts include descendants unless the row is a leaf.
- Terminal statuses for progress are `verified`, `closed`, and `cancelled`; cancelled should be displayed separately from completed where space allows.
- A roll-up row can expose closeout actions only through command descriptors.

### Milestones Page

Purpose: inspect long-running containers independently of sprint boards.

List columns:

- status
- milestone title
- progress
- active sprints
- blocked descendants
- open gates
- last activity

Detail sections:

- metadata: ID, labels, priority, parent, Git branch/head if present
- description and acceptance criteria
- child sprints
- direct tasks/issues
- blockers and dependency graph summary
- evidence and verification counts
- closeout gate status
- agent summaries
- actions

Contracts:

```ts
export interface MilestoneListView {
  readonly generatedAt: string;
  readonly workspaceRoot: string;
  readonly milestones: readonly MilestoneRowView[];
  readonly summary: {
    readonly total: number;
    readonly open: number;
    readonly blocked: number;
    readonly closed: number;
    readonly openGates: number;
  };
}

export interface MilestoneRowView {
  readonly work: WorkItemView;
  readonly progress: RollupProgressView;
  readonly childSprintIds: readonly string[];
  readonly directTaskIds: readonly string[];
  readonly activeBlockerCount: number;
  readonly openGateCount: number;
  readonly lastActivityAt?: string;
}

export interface MilestoneDetailView extends MilestoneRowView {
  readonly children: readonly RollupNodeView[];
  readonly blockers: readonly WorkDependencyEdgeView[];
  readonly evidence: readonly EvidenceSummaryView[];
  readonly verifications: readonly VerificationSummaryView[];
  readonly agentSummaries: readonly AgentSummarySummaryView[];
  readonly actions: readonly TuiCommandDescriptor[];
}
```

### Sprints Page

Purpose: browse sprint containers, choose the active sprint, and enter sprint boards.

List columns:

- active marker
- status
- sprint title
- done/total
- tasks
- blockers
- needs verification
- branch

Contracts:

Current implementation has:

```ts
export interface TuiSprintData {
  readonly view: WorkItemView;
  readonly board: SprintBoardView;
  readonly scopeCount: number;
  readonly active: boolean;
}
```

Target sprint list should add:

```ts
export interface SprintListView {
  readonly generatedAt: string;
  readonly workspaceRoot: string;
  readonly activeSprintId?: string;
  readonly sprints: readonly SprintRowView[];
  readonly count: number;
  readonly truncated: boolean;
}

export interface SprintRowView extends TuiSprintData {
  readonly doneCount: number;
  readonly percentDone: number;
  readonly milestoneId?: string;
  readonly branch?: string;
  readonly headSha?: string;
  readonly lastActivityAt?: string;
  readonly actions: readonly TuiCommandDescriptor[];
}
```

Primary actions:

- activate sprint: `bwrk sprint activate <sprint-ref> --json`
- open board: read-only navigation
- report sprint: `bwrk sprint report <sprint-ref> --format markdown --json`
- close sprint: `bwrk sprint close <sprint-ref> --reason <text> --auto-report --json`

All but navigation require confirmation.

### Sprint Board Page

Purpose: operate a sprint through derived lanes.

Lanes:

- draft
- ready
- blocked
- in progress
- needs verification
- verified
- closed
- cancelled

Layout:

```text
Scope: TUI contracts                    active | 8/12 | blockers 1

DRAFT (1)        READY (3)          BLOCKED (1)        IN PROGRESS (1)
title            title              title              title
prio/labels      prio/labels        blocker badge      agent/expiry

VERIFY (2)       VERIFIED (2)       CLOSED (2)         CANCELLED (0)
```

Narrow terminals use a lane filter plus one table.

Board contract is the existing `SprintBoardView`:

```ts
export interface SprintBoardView {
  readonly sprint: WorkItemView;
  readonly generatedAt?: string;
  readonly phases: readonly WorkItemView[];
  readonly lanes: readonly SprintBoardLane[];
  readonly summary: SprintBoardSummary;
}
```

Board action rules:

- Moving between lanes is not direct mutation. It opens a command action.
- Claim/start: `bwrk work reserve <work-id> --agent <agent-id> --purpose <text> --json`
- Release: `bwrk work release <work-id> --json`
- Mark ready/recompute readiness: `bwrk work ready <work-id> --json`
- Add evidence: `bwrk evidence add <work-id> ... --json`
- Verify: `bwrk work verify <work-id> --evidence <evidence-id> --verdict passed --json`
- Close: `bwrk work close <work-id> --reason <text> --json`
- Preferred closeout for owned work: `bwrk agent finish current ... --close --json`

### Work Page

Purpose: filter and inspect all repo work, independent of sprint membership.

Required filters:

- query text
- status
- kind: issue/task/sprint/milestone
- priority
- label
- parent/milestone/sprint
- has active blocker
- has active reservation
- reserved agent
- needs evidence
- needs verification
- has open closeout gate
- created/updated before/after
- show closed/cancelled

Columns:

- status
- kind
- title
- priority
- labels
- blockers
- reserved
- evidence/verification

Contract:

```ts
export interface WorkDashboardView {
  readonly generatedAt?: string;
  readonly labels: readonly string[];
  readonly queues: readonly WorkQueueView[];
  readonly summary: WorkDashboardSummary;
}

export interface WorkListRouteView {
  readonly generatedAt: string;
  readonly workspaceRoot: string;
  readonly rows: readonly WorkItemView[];
  readonly summary: WorkDashboardSummary;
  readonly facets: WorkListFacets;
  readonly filters: TuiFilterState;
  readonly truncated: boolean;
}

export interface WorkListFacets {
  readonly statuses: readonly { readonly status: WorkStatus; readonly count: number }[];
  readonly kinds: readonly { readonly kind: WorkKind; readonly count: number }[];
  readonly priorities: readonly { readonly priority: WorkPriority; readonly count: number }[];
  readonly labels: readonly { readonly label: string; readonly count: number }[];
  readonly agents: readonly { readonly agentId: string; readonly count: number }[];
}
```

### Task Detail Page

Purpose: show everything needed to decide the next action for one work item.

Sections:

- Header: status, kind, priority, ID, active reservation, branch/head.
- Description.
- Acceptance criteria.
- Labels and source refs.
- Parent/container and children.
- Dependencies and active blockers.
- Evidence records.
- Verification records.
- Closeout gates.
- Agent directive summary.
- Agent summaries and handoff artifacts.
- Activity timeline for this subject.
- Actions.

Contract:

```ts
export interface WorkDetailView {
  readonly generatedAt: string;
  readonly workspaceRoot: string;
  readonly work: WorkItemView;
  readonly parent?: WorkItemView;
  readonly children: readonly WorkItemView[];
  readonly dependencies: readonly WorkDependencyEdgeView[];
  readonly blockedBy: readonly WorkDependencyEdgeView[];
  readonly evidence: readonly EvidenceSummaryView[];
  readonly verifications: readonly VerificationSummaryView[];
  readonly closeoutGates: readonly CloseoutGateView[];
  readonly directiveSummary?: WorkDirectiveSummaryView;
  readonly agentSummaries: readonly AgentSummarySummaryView[];
  readonly events: readonly TuiActivityEntry[];
  readonly actions: readonly TuiCommandDescriptor[];
}

export interface WorkDependencyEdgeView {
  readonly edgeId?: string;
  readonly kind: EdgeKind;
  readonly from: TuiEntityRef;
  readonly to: TuiEntityRef;
  readonly active: boolean;
  readonly reason?: string;
}

export interface EvidenceSummaryView {
  readonly id: string;
  readonly subjectId: string;
  readonly subjectType: string;
  readonly kind: EvidenceKind;
  readonly outcome: EvidenceOutcome;
  readonly summary: string;
  readonly command?: string;
  readonly uri?: string;
  readonly observedAt: string;
}

export interface VerificationSummaryView {
  readonly id: string;
  readonly subjectId: string;
  readonly subjectType: string;
  readonly verdict: VerificationVerdict;
  readonly evidenceIds: readonly string[];
  readonly verifiedAt: string;
  readonly notes?: string;
}

export interface AgentSummarySummaryView {
  readonly id: string;
  readonly subjectId: string;
  readonly subjectType: string;
  readonly summaryKind: AgentSummaryKind;
  readonly status: AgentSummaryStatus;
  readonly outcome: AgentSummaryOutcome;
  readonly title: string;
  readonly artifactUri?: string;
  readonly commitShas: readonly string[];
  readonly childSummaryIds: readonly string[];
  readonly generatedAt: string;
}

export interface CloseoutGateView {
  readonly id: string;
  readonly kind: CloseoutGateKind;
  readonly scope: CloseoutGateScope;
  readonly status: CloseoutGateStatus;
  readonly requiredEvidenceKinds: readonly EvidenceKind[];
  readonly requiredOutcome: "passed";
  readonly minEvidenceCount: number;
  readonly blockingCloseout: boolean;
  readonly satisfiedBy?: RequiredCloseoutGateSatisfaction;
  readonly force?: RequiredCloseoutGateForce;
}
```

### Activity Page

Purpose: inspect repo runtime events and command operations.

List mode:

- time
- type/command path
- subject
- actor
- status
- state changed

Detail mode:

- event payload key-values
- operation argv, exit code, error details
- linked subject detail shortcut
- generated artifacts changed

Current implementation has:

```ts
export interface TuiActivityEntry {
  readonly id: string;
  readonly type: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly at: string;
  readonly payload: readonly { readonly key: string; readonly value: string }[];
}
```

Target:

```ts
export interface RepoActivityView {
  readonly generatedAt: string;
  readonly workspaceRoot: string;
  readonly events: readonly TuiActivityEntry[];
  readonly operations: readonly OperationSummaryView[];
  readonly summary: {
    readonly events: number;
    readonly operations: number;
    readonly failedOperations: number;
    readonly stateChanged: number;
    readonly generatedArtifactsChanged: number;
  };
}

export interface OperationSummaryView {
  readonly id: string;
  readonly sessionId: string;
  readonly commandPath: string;
  readonly argv: readonly string[];
  readonly actorId: string;
  readonly status: RuntimeOperationStatus;
  readonly exitCode: number;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly stateChanged: boolean;
  readonly generatedArtifactsChanged: boolean;
  readonly eventIds: readonly string[];
  readonly errorCode?: string;
  readonly errorMessage?: string;
}
```

### Knowledge Page

Purpose: terminal access to repo memory work without duplicating workflow instructions.

Sections:

- Raw inbox: queued/linked sources, preview status, retrieval commands.
- Wiki explorer: pages, source coverage, link health, Obsidian compatibility fields.
- Claims and decisions: status, sources, contradictions/supersession.
- Memory workflow actions: add, reconcile, retrieve, update.

Contract source:

- Reuse `RawInboxView`, `WikiExplorerView`, `MemoryDashboardActionsView`, claim/decision view models from `apps/console/src/app/types.ts`, or move them to `@boreal/ui-model` before TUI consumption.
- Workflow actions must expose `workflowCommand`, `workflowSourcePath`, and `skillRef`; they must not embed workflow bodies.

### Reports Page

Purpose: inspect generated artifacts and sprint/project reports.

Rows:

- artifact kind
- title
- path
- bytes
- updated at
- stale
- open/reproduce command

Contract source:

- Reuse or move `ReportsView`, `ReportArtifactView`, `StaticReportExportView`, and `StaticKnowledgeReportView`.
- Sprint reports use `boreal.cli.sprint.report.v1`.
- Stale artifacts should compare artifact mtime with the current payload `generatedAt` or a fresher source timestamp where available.

### Health Page

Purpose: local repo health and repair queue.

Sections:

- Doctor summary.
- Sync status.
- Locks.
- Search/ledger/vault/git/setup findings.
- Daemon state.
- Command-doc drift if exposed.

Contracts:

```ts
export interface RepoHealthBundleView {
  readonly generatedAt: string;
  readonly workspaceRoot: string;
  readonly doctor: DashboardHealthView;
  readonly sync: SyncDashboardView;
  readonly locks: LockDashboardView;
  readonly daemon?: RepoDaemonStatusView;
  readonly actions: readonly TuiCommandDescriptor[];
}

export interface RepoHealthSummaryView {
  readonly ok: boolean;
  readonly stale: boolean;
  readonly errors: number;
  readonly warnings: number;
  readonly lockFindings: number;
  readonly fixableActions: number;
}

export interface RepoDaemonStatusView {
  readonly state: string;
  readonly pid?: number;
  readonly processAlive: boolean;
  readonly statusPath: string;
  readonly findings: readonly DashboardFinding[];
  readonly recommendedActions: readonly DashboardAction[];
}
```

### Settings Page

Purpose: display repo setup and safe configuration actions.

Fields:

- project root
- workspace root
- memory root
- `.boreal` root
- runtime state path
- memory layout
- memory Git mode
- install root
- CLI pin/source if present
- skill targets

Actions:

- run doctor
- sync refresh
- import setup into registry
- open global settings for this project
- install/check skills

Mutating settings writes require confirmation and a passing target doctor check.

## Flow Contracts

### Global To Repo

1. User opens Global TUI.
2. User selects a project from Overview, Projects, Queue, Search, Activity, or Health.
3. TUI creates a repo navigation target:

```ts
export interface OpenRepoTarget {
  readonly projectId: string;
  readonly projectName: string;
  readonly projectRoot: string;
  readonly initialRoute?: string;
  readonly initialEntity?: TuiEntityRef;
  readonly returnToGlobalFrame: TuiNavFrame;
}
```

4. Repo TUI starts/loads with `workspaceRoot = projectRoot`.
5. Breadcrumb shows `global > <project> > <route>` when entered from global.
6. Back from repo root returns to the preserved global frame if the process is shared; otherwise `q` exits.

### Roll-Up Drill-Down

1. Roll-Up page starts with project root expanded to active/open containers.
2. `enter` on milestone opens Milestone Detail.
3. `enter` on sprint opens Sprint Board.
4. `enter` on task opens Task Detail.
5. `back` returns to the same roll-up cursor and filter state.
6. Search result jumps build the same stack so back behavior remains predictable.

### Filter Flow

1. `f` opens filter builder for the current route.
2. Route exposes available facets.
3. User toggles clauses.
4. TUI applies filters locally when all needed rows are loaded.
5. If filters exceed loaded bounds, TUI requests a route payload with those filters.
6. Filter state is carried in breadcrumbs and included in refresh requests.

Filter request:

```ts
export interface TuiRouteRequest {
  readonly surface: TuiSurfaceKind;
  readonly workspaceRoot: string;
  readonly routeId: string;
  readonly entity?: TuiEntityRef;
  readonly filters?: TuiFilterState;
  readonly cursor?: string;
  readonly limit?: number;
}
```

### Command Palette Flow

Palette sources:

- local route rows
- global/repo search API
- route commands
- safe action descriptors for selected entity
- navigation targets

Search item contract:

```ts
export interface TuiSearchItem {
  readonly id: string;
  readonly kind: TuiEntityKind | "route" | "command";
  readonly label: string;
  readonly hint: string;
  readonly score: number;
  readonly target?: TuiEntityRef;
  readonly routeId?: string;
  readonly action?: TuiCommandDescriptor;
}
```

### Claim And Start Work

1. User selects ready work from Global Queue, Repo Work, Roll-Up, or Sprint Board.
2. Detail page shows current blockers, reservation state, and closeout gates.
3. Action panel offers claim/start only when there is no active reservation or when forced flow is explicitly selected.
4. TUI renders exact command:

```bash
bwrk --workspace <projectRoot> work reserve <work-id> --agent <agent-id> --purpose <purpose> --json
```

5. On success, TUI refreshes selected work, queues, and active sprint board.

### Evidence, Verification, Close

1. Evidence action collects summary, kind, outcome, optional command, optional URI.
2. Verify action requires a selected passed evidence ID.
3. Close action requires reason and satisfied closeout gates.
4. For owned reservations, TUI should prefer the single transaction command:

```bash
bwrk agent finish current --agent <agent-id> --evidence <evidence-id> --verdict passed --close --reason <text> --json
```

5. The resulting operation, event, evidence, verification, and work status are shown after refresh.

## Data Source Matrix

| Need | Existing source | Target TUI contract |
| --- | --- | --- |
| Global project registry | `bwrk dashboard global --json`, `registry list --json`, `registry doctor --json` | `GlobalTuiView.registry`, `GlobalProjectRollupView` |
| Global queues | `GlobalWorkQueuesView` | `GlobalWorkQueuesView` plus `TuiFilterState` and row actions |
| Global search | `GlobalSearchView` | `GlobalSearchView` plus `TuiEntityRef` detail targets |
| Global activity | `GlobalActivityView`, `operation list --json` | `RepoActivityView`/`GlobalActivityView` with operation detail |
| Global health | `GlobalHealthView`, daemon status | `GlobalHealthView` plus `GlobalDaemonStatusView` |
| Global settings | `GlobalSettingsView` | `GlobalSettingsView` plus confirmation actions |
| Repo work queues | `WorkDashboardView` | `WorkListRouteView` |
| Repo sprint board | `bwrk sprint board --json`, `SprintBoardView` | `SprintBoardView` plus board action descriptors |
| Repo sprint list/detail | `bwrk sprint list/show/current --json` | `SprintListView`, `TuiSprintData`, `SprintBoardView` |
| Repo roll-up | Work items + graph edges + sprint scope + closeout gates | `RepoRollupView` |
| Milestones | Work items where `kind === "milestone"` plus descendants | `MilestoneListView`, `MilestoneDetailView` |
| Task detail | `work show --json`, runtime work view, records | `WorkDetailView` |
| Evidence/verification | evidence and verification records | `EvidenceSummaryView`, `VerificationSummaryView` |
| Agent summaries | agent summary records | `AgentSummarySummaryView` |
| Activity/events | runtime events and operations | `RepoActivityView` |
| Knowledge | console raw/wiki/claim/decision views | Move shared models to `@boreal/ui-model` |
| Reports | console reports views, sprint report command | Move shared models to `@boreal/ui-model` |
| Health | doctor/sync/locks/daemon | `RepoHealthBundleView` |

## Schema Versioning

Existing CLI schema versions should stay intact:

- `boreal.cli.dashboard.global.v1`
- `boreal.cli.sprint.list.v1`
- `boreal.cli.sprint.show.v1`
- `boreal.cli.sprint.current.v1`
- `boreal.cli.sprint.board.v1`
- `boreal.cli.sprint.report.v1`

Planned TUI composite schema versions:

- `boreal.tui.global.v1`
- `boreal.tui.repo.v1`
- `boreal.tui.route.v1`
- `boreal.tui.entity-detail.v1`
- `boreal.tui.command-descriptor.v1`

The TUI composite schemas should be thin route envelopes over shared view models. They should not redefine durable record types from `@boreal/core`.

## Implementation Order

The v1 shell already implements shared route navigation, global overview/projects/queues, repo roll-up/sprint board, and task-detail drill-down. The order below is the remaining expansion sequence; completed items are retained to show the contract's intended dependency order.

1. Move any console-only view models needed by TUI into `@boreal/ui-model`.
2. Add `TuiCommandDescriptor`, `TuiEntityRef`, filters, and route request/response types to `@boreal/ui-model`.
3. Add repo route payload builders for roll-up, milestone list/detail, work detail, activity detail, health bundle, knowledge, and reports.
4. Expand `apps/tui` route coverage while preserving filter/cursor state.
5. Expand Global TUI pages over `dashboard global --json`, including project open flow.
6. Expand Repo Roll-Up, Milestones, Sprint Board, Work, and Task Detail coverage; these carry the main execution loop.
7. Add Knowledge, Reports, Health, and Settings after their shared model boundaries move out of `apps/console`.
8. Add fixture tests and terminal lifecycle tests for every route.

## Verification Contract

Unit tests:

- Navigation reducer preserves stack, entity, filter, and cursor state.
- Filter builder serializes/deserializes `TuiFilterState`.
- Roll-up builder handles parent IDs, sprint scope, graph edges, active blockers, terminal statuses, and truncation.
- Command descriptors always include workspace root and confirmation flags for mutations.
- Global rows preserve project identity even when record IDs collide.

Fixture route tests:

- Global Overview, Projects, Queues, Search, Activity, Health, Settings.
- Repo Overview, Roll-Up, Milestones, Sprints, Sprint Board, Work, Task Detail, Activity, Knowledge, Reports, Health, Settings.

TTY lifecycle tests:

- Alternate-screen enter/exit.
- Ctrl-C and `q` restore cursor/raw mode.
- Resize keeps tables bounded.
- Mouse wheel is optional and never required.

Live smoke:

- Load Global TUI against a registry with at least two projects.
- Open a repo from global.
- Drill project -> milestone -> sprint -> task.
- Apply a work filter.
- Open a health finding.
- Render a command confirmation without executing it.

## Open Questions

- Should repo route payloads be exposed as `bwrk dashboard repo --json` subcommands, or should `apps/tui` continue reading the local store directly for repo-only pages?
- Should the Global TUI and Repo TUI be one process with a shared surface switch, or separate launches connected by explicit command invocation?
- Should knowledge/report view models move wholesale into `@boreal/ui-model`, or should TUI start with read-only subsets?
- Should filters become CLI flags on dashboard endpoints, or remain TUI-local until a list exceeds bounded payload limits?
