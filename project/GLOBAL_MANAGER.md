# Global manager: v2 product and implementation contract

Status: implementation and qualification, 2026-09-30. The user's instruction
establishes the product requirements below. The separate Rust global backend,
CLI/service, TypeScript TUI and installer integration are implemented. See
`project/build-plan/global-manager/RESULTS.md` for verified behavior and limits.
This extension does not replace the existing production execution plan.

## Purpose and scope

Global is the installation-wide, per-user project manager. It works from any
current directory and has a separate SQLite database with a different schema
from a Boreal project database. Installation automatically creates it; the user
does not initialize a container inside a folder or choose a parent projects
directory. CLI-only installation also provisions global state.

A global project is an independently identified management record. It can
exist without a folder, be associated with a folder that has no Boreal setup,
or link to an existing Boreal project. Personal todos and notes can belong to
a global project or remain unassigned. Registering a folder never implicitly
initializes a Boreal workspace there.

Global is a full personal/business project-management surface through CLI
and TUI, not merely a registry or code-progress viewer. A folderless `Life`
project holds errands and personal work. A `New business` project can hold
offline todos such as contacting suppliers while also linking Boreal code
projects and showing their execution progress. Its personal todos remain
usable regardless of the availability of those linked workspaces. A management
project may link multiple code projects; those links do not determine ownership
of its personal items.

## Everyday workflow and feature priorities

The post-it-note example is one supported workflow, not the scope or fixed
status model of this product. Global supports both a simple personal checklist
and structured project planning with tasks, subtasks, milestones, relationships,
notes and different workflows. Do not reduce the domain to a three-state todo
table or defer configurable workflows as cosmetic customization.

Workflow definitions belong to global projects and use stable status IDs,
editable labels, ordering and explicit semantic categories. Examples include
Inbox, Backlog, Planned, Ready, In progress, Waiting, Blocked, Review, Done and
Cancelled; this is not a mandatory universal sequence. A simple preset may use
`To do`, `Doing`, and `Done`. A business workflow may include supplier approval
and launch readiness. Changes to labels or columns must preserve item history.

Separate workflow status, board presentation, project lifecycle and project
health. A board can group statuses into columns or group items by milestone,
priority or owner. Waiting on a reply differs from a blocking prerequisite;
cancelled work differs from completed work; archiving hides a retained record
and does not imply completion. Aggregate progress must state which items and
completion categories it counts. Linked code tasks retain their source states
even when a global view groups them for display.

Board, list and planning views refer to the same records. The CLI and TUI
must expose the same substantive capabilities; creating relationships or
changing workflow status cannot be available only through visual interaction.
Direct completion remains available for simple personal work, while optional
project rules can constrain transitions for more structured workflows.

Essential first-release behavior:

- Create, rename and archive folderless personal/business projects.
- Add, edit, move, complete and reopen todos from both CLI and TUI; quick
  capture should require only a title. Details are optional.
- Support configurable workflows and board columns, tasks/subtasks and
  milestones, ordering, dependency/blocker relationships and project-specific
  views. Keep optional structure out of the quick-capture path.
- Switch between ordered kanban and list views; retain done items with an
  explicit archive operation rather than deleting completion history.
- Add project/item notes, due dates, priorities and labels; search/filter
  items and provide an all-project view of open and overdue personal work.
- Associate folders and link existing Boreal projects; show personal todos
  alongside clearly identified code-progress summaries and drill-down links.
- Preserve data across upgrades, and provide backup/export plus a verified
  restore path before claiming a dependable personal project manager.

Useful additions after that workflow is complete:

| Feature | Everyday value |
| --- | --- |
| Recurring todos | Recreate weekly chores or monthly bookkeeping without copying cards. |
| Today/This week and saved views | Choose what to act on across Life and business projects. |
| Work-in-progress limits | Surface overcommitment in a chosen workflow. |
| Waiting-on tracking and reminders | Track an external reply or appointment; reminder delivery needs a real scheduler. |
| Project/board templates | Reuse a business-launch checklist or household routine. |
| Calendar view | See deadlines and scheduled work together. |
| Activity timeline and progress trends | Review personal accomplishments and project movement. |
| Cross-project portfolio planning | Coordinate initiatives across several management and linked code projects. |

These additions are proposed product options, not a commitment to ship all of
them in the first slice. Team collaboration, remote sync, integrations and
automatic agent launching require separate scope decisions.

## Source design and explicit changes

Read the legacy [Global Manager Layer](../v1/docs/product/GLOBAL_MANAGER_DESIGN.md),
[registry schema](../v1/schemas/projects/project-registry.schema.json),
[registry identity and location implementation](../v1/packages/core/src/project-registry.ts),
and [getting-started loop](../v1/docs/getting-started.md). They are behavioral
references, never v2 runtime imports.

Preserve the separation between registry/global records and derived project
rollups; stable cross-project references; reversible, non-invasive linking;
retained inbox provenance; and visible freshness/unresolved states. The old
design already describes machine-level scope and independently owned global
records, not a parent-folder container.

The user's new requirements supersede two legacy restrictions:

- Optional first-run `global init` becomes automatic installation bootstrap.
- Registry entries requiring workspace/runtime/memory paths become management
  projects with optional folder and Boreal-workspace associations.

Legacy JSON/object storage and TypeScript orchestration are replaced behind
the v2 Rust application/store/service boundary. The old document's CLI fan-out
and console command execution are not the v2 TUI transport contract.

## Storage and ownership

Default file: `global.sqlite` in the existing machine-local Boreal
data-root convention: `~/Library/Application Support/Boreal/` on macOS and
`${XDG_STATE_HOME:-~/.local/state}/boreal/` on Linux. Resolve this independently
of cwd, project selectors, project `.boreal`, and the binary installation prefix.
Provide an explicit global-data-root override for fixtures and portable use.
Windows location is a future portability contract, not a support claim.

The installer invokes a Rust bootstrap use case after staging the binary. It
creates/migrates global state idempotently and reports failure rather than
claiming successful provisioning. Reinstallation and upgrade preserve records.
Binary uninstall must preserve user data. Direct/package-manager distribution
needs the same bootstrap hook, with idempotent first-use provisioning as a
fallback where installation hooks cannot run. No initialization prompt is
required. A newer unsupported schema fails without modifying its database.

The current independent SQLite schema uses `global_schema`,
`global_manager_state`, `global_operation`, `global_revision_snapshot` and
`global_audit`. Management records are serialized in the transactional state
row; a mutation commits state, revision, receipt, audit and historical snapshot
together. It does not install the code-project schema. Export includes archived
records, status history and revision snapshots; import validates references,
workflows and cycles and preserves imported history. Splitting record families
into indexed relational tables remains a future scaling migration.

The following families describe the broader product model; individual tables,
saved board views, inbox provenance and cached rollups are not all implemented:

| Family | Authority and contents |
| --- | --- |
| `global_schema` | Global schema version and durable database identity; independent migration history from project databases. |
| `management_project` | Stable ID, title, description, labels, priority, management lifecycle, timestamps, entity revision. No required path. |
| `project_association` | Optional folder location; optional validated Boreal project ID and endpoint binding. Folder attachment and workspace linking are distinct operations. |
| `management_item` | Task/subtask/milestone identity, optional project owner/parent, description, labels, priority, dates, workflow/status ID, ordering and retained transition history. A todo is the simplest task use case. |
| `workflow` / `workflow_status` | Project workflow definitions, stable status IDs, display labels, semantic categories and optional transition constraints. Presets are configuration, not hardcoded domain states. |
| `item_relationship` | Typed dependencies, blockers and related-item links with domain validation. |
| `board_view` | Project/global filters, grouping, status-to-column mappings and view ordering; does not independently own item status. |
| `note` | Personal/project note, body, ownership, timestamps, revision history. Ordinary notes do not automatically become published curated memory. |
| `inbox_capture` | Original capture, references, triage disposition and promotion provenance; preserve source on routing. |
| `qualified_reference` | Owning Boreal project ID plus record ID; retain unresolved links through unlink/moves. |
| `project_rollup` | Rebuildable cache keyed by linked identity, source API/schema/revision, sampled time, freshness deadline and typed availability. |
| `global_operation` / `global_event` | Durable mutation receipts, audit history, idempotency identity and global revisions. |

Global owns management lifecycle and personal completion. A management
project's manually selected status must remain visibly distinct from linked
workspace execution progress. Global never owns a linked project's tasks,
attempts, fences, gates, evidence, or authoritative completion. Personal todos
do not use an agent's proof-gated task lifecycle.

Link existing projects by their validated durable v2 identity, not a path hash
or a Git remote that could merge distinct workspaces. Moving a folder changes
the association, not the management-project ID. Unlinking preserves the global
project, todos, notes, historical references, and last-known snapshots and
never deletes or edits the linked workspace. Archive is separate from unlink.

## Service and dashboard

Implement global types/rules in domain, use cases in application, global
migrations/transactions in store, versioned DTOs in protocol, and transport in
service. Keep schema initialization out of shell SQL and TypeScript. Reuse
transaction/receipt infrastructure without initializing a project schema in
the global file or weakening existing project selection boundaries.

Create `apps/global-tui/` as a distinct TypeScript service client. Share
transport, envelope validation and suitable presentation primitives with
`apps/tui/`; global navigation and controllers remain separate. Primary views
are Overview, Projects, Board/List, Todos, Notes and Inbox. Folderless projects are fully
usable, and linking a workspace adds execution-progress drill-down.

Rollups are obtained through versioned project service/application reads.
The TUI neither opens any canonical SQLite database nor spawns a CLI process
per refresh. Aggregate counts come from authoritative count queries rather
than totals of capped display rows. Every project snapshot retains its own
revision/time; there is no fictitious atomic revision across separate stores.
An unavailable project retains a visibly stale last-known view or reports
unknown when no snapshot exists; it does not become zero/complete.

Project execution mutations, if exposed from global, explicitly target the
owning project and retain its normal revision, identity, fence and gate checks.
No transaction is held while querying another project. Aggregate guidance
uses trusted project directives, never authored note text as executable input.

## CLI contract to implement

These are proposed commands, not currently callable capabilities. Use one
explicit namespace, valid from any cwd:

```text
bwrk dashboard global [--json]
bwrk global status [--json]
bwrk global project add --name NAME [--folder PATH] [--json]
bwrk global project list|show|edit|archive ... [--json]
bwrk global project attach-folder PROJECT --folder PATH [--json]
bwrk global project link PROJECT --workspace PATH [--json]
bwrk global project unlink PROJECT [--json]
bwrk global todo add --title TITLE [--project PROJECT] [--json]
bwrk global todo list|show|edit|move|complete|reopen|archive ... [--json]
bwrk global note add --title TITLE --body BODY [--project PROJECT] [--json]
bwrk global note list|show|edit|archive ... [--json]
bwrk global capture --body BODY [--json]
bwrk global inbox list|show|triage ... [--json]
```

Freeze full argument fixtures and command-registry metadata before shipping;
the abbreviated families above are scope, not complete parser grammar.
`bwrk dashboard` inside a Boreal project opens its project-specific TUI.
`bwrk dashboard global` explicitly opens the distinct global TUI backed by
the global schema, including when run inside a Boreal project. Global dashboard
launch does not require local project initialization or a folder association.
`bwrk global dashboard` may be retained as an alias for that same global path.
Ordinary project commands continue selecting their project; absence of local
metadata never silently redirects them to global. `global init` is not a user
setup prerequisite. Legacy `registry`, `global link/unlink`, `capture` and
`view --global` spellings need explicit alias or migration dispositions.

## Implementation order and acceptance

1. Global identity/path resolution, independent schema/migrations, Rust
   bootstrap and installation integration. Prove fresh install, concurrent
   bootstrap, reinstall/upgrade preservation and cwd independence using an
   isolated data root, without modifying real user databases.
2. Management projects, folder attachment, management items, notes and receipts through
   application, CLI and service, including persisted board columns/order and
   list/board consistency. Prove a folderless `Life` project supports quick
   capture, movement, direct completion and reopen without Git or `.boreal`,
   and folder registration writes nothing into that folder. Also prove a
   structured business workflow supports custom statuses, subtasks, milestones
   and blockers; renaming/regrouping columns preserves status identity/history,
   and cancellation/archive do not falsely increase completed-work counts.
3. Validated workspace links, reference resolution and revisioned rollups.
   Prove duplicate/moved/foreign identities, unlink/relink preservation,
   partial outages, schema mismatch and honest counts exceeding a row limit.
4. Separate global TUI and release packaging. Exercise personal-item creation
   and completion, linking, progress display and project drill-down through
   the real service. Verify local and global dashboards remain distinct and a
   business project can display its offline todos alongside multiple linked
   code projects without mixing their completion counts or authorities.
5. Global inbox routing and legacy import. Use retained source provenance,
   replayable operation IDs and destination readback for cross-store promotion;
   never imply a SQLite transaction spans both databases. Keep unknown legacy
   records in an explicit migration loss ledger. Add portfolio dependencies
   and aggregate next only with their own domain/protocol acceptance fixtures.

This extension needs its own implementation handoffs/write boundaries before
code dispatch. Existing launch deferrals describe the released baseline, not
a reason to reject the user's newly requested global-manager capability.
