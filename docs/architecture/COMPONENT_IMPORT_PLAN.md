# Component Import Plan

Status: Sprint 03 Phase 03A import map  
Source: `dump/Brand design system setup/Components.dc.html`  
Token source: `dump/Brand design system setup/globals.css`

## Current Source Truth

The source catalog contains 177 `data-screen-label` sections. The catalog is a declarative HTML/DC demo with tokenized inline styles, `globals.css`, and a generated `support.js` runtime. For Boreal, the source is a visual and naming reference, not an app runtime dependency.

`@boreal/ui-model` now exposes a typed inventory from `packages/ui-model/src/component-inventory.ts`. Runtime tests compare that inventory to the live `Components.dc.html` labels so drift is caught when the source catalog changes.

## Import Buckets

| Bucket | Count | Target directory | Role |
| --- | ---: | --- | --- |
| Foundation | 37 | `apps/console/src/components/foundation` | Tokens, primitive controls, shared list chrome, state surfaces, and form controls. |
| Entity | 38 | `apps/console/src/components/entity` | Entity detail, source, evidence, lineage, raw, wiki, search, and edit surfaces. |
| Global | 19 | `apps/console/src/components/global` | Cross-project dashboard, app shell, global navigation, global search, and command surfaces. |
| Sprint and board | 26 | `apps/console/src/components/sprint` | Sprint dashboard, kanban/table/calendar/roadmap, work queues, and board health. |
| Repo memory | 27 | `apps/console/src/components/repo-memory` | Project memory, wiki, graph, raw inbox, claims, decisions, reports, and repo settings. |
| Operations | 30 | `apps/console/src/components/operations` | Ingest review, runtime health, events, locks, migrations, git, Obsidian, graph, diff, and static export. |

## Framework Boundary Decision

Use `apps/console` as the browser dashboard surface and keep it separate from CLI/TUI/runtime packages.

- Console framework: Vite + React + TypeScript when Sprint 04 scaffolds the browser app.
- Shared model boundary: `@boreal/ui-model` owns dashboard/component inventory data contracts and has no browser dependency.
- Runtime boundary: `@boreal/core`, `@boreal/engine`, storage, work, graph, evidence, and search packages must not import React, Vite, DOM APIs, or console CSS.
- CLI/TUI boundary: the CLI rich text/dashboard views stay terminal-first and consume JSON/model contracts only; they do not reuse browser components.
- Styling boundary: import the `globals.css` token contract into the console as Boreal theme CSS, then convert inline catalog styles into class-based component CSS or scoped CSS modules during Sprint 03B/03C.
- DC runtime boundary: do not ship `support.js` or `<x-dc>` templating as a Boreal dependency. Keep it in `dump/` as source evidence unless a future migration explicitly chooses that runtime.

## Bucket Labels

### Foundation

Colors, Typography, Spacing & Radii, Accessibility, Buttons, Badges & Status, Cards, Inputs, Task Rows, PriorityBadge, HealthBadge, LabelChip, EntityChip, ActorAvatar, DateTimeLabel, MetricCard, InlineNotice, EmptyState, ErrorState, LoadingSkeleton, ProgressSummary, ConfirmDialog, FieldLabel, SelectField, MultiSelectField, EntityReferenceField, DateField, FilePickerField, MarkdownEditorField, FormValidationSummary, SurfaceHeader, MarkdownRenderer, BoardViewSwitcher, ScopeBreadcrumbs, PageToolbar, FilterBar, ViewModeTabs.

### Entity

EntityDetailHeader, EntityList, SourceRefList, LinkedEntityList, CommentThread, EventTimelinePanel, VerificationPanel, DependencyPanel, LineagePanel, HealthFindingList, StaleDataBanner, FrontmatterPanel, ActivityFeed, WorkItemDetailPage, WorkItemStatusControl, WorkItemPriorityControl, AcceptanceCriteriaList, WorkItemBodyPanel, WorkItemLineagePanel, WikiPageDetailPage, WikiPageReviewPanel, WikiLinkPreview, ObsidianOpenButton, RawSourceDetailPage, RawSourcePreview, RawProcessingStatusPanel, RawAssetViewer, EntityCreateButton, CreateEntityModal, EntityEditForm, QuickActionMenu, SearchPage, SearchModeSelector, ResultInspector, ContextBundleBuilder, ResolverCandidateList, MatchReasonList, ContextBundlePanel.

### Global

GlobalSidebar, GlobalOverviewMetrics, BucketOverviewGrid, ProjectStatusGrid, GlobalReadyQueue, GlobalBlockedQueue, CrossProjectRoadmap, GlobalSearchResults, ActorActivityPanel, GlobalHealthSummary, GlobalSettingsForm, AppShell, ProjectSwitcher, BucketSwitcher, UniversalSearchInput, CommandPalette, DetailDrawer, SplitPane, CardGrid.

### Sprint And Board

WorkHealthOverview, ReadyQueuePanel, BlockedQueuePanel, VerificationQueuePanel, StaleWorkList, DuplicateWorkList, DependencyCyclePanel, SprintSidebar, SprintHeader, SprintScopeSummary, SprintKanbanBoard, SprintKanbanCard, SprintWorkTable, SprintDependencyView, SprintTimelineView, SprintProgressPanel, SprintDiscoveriesPanel, SprintVerificationQueue, SprintReviewGeneratorPanel, BoardHeader, KanbanColumn, SwimlaneBoard, BoardTableView, BoardCalendarView, BoardRoadmapView, BoardMatrixView.

### Repo Memory

RepoSidebar, KnowledgeHealthOverview, OrphanPagesList, StalePagesList, BrokenLinksList, ContradictionsList, SourceCoverageMatrix, KnowledgeReviewQueue, ProjectOverviewPanel, SetupChecklist, MemoryIndexTree, ImportantPagesPanel, WikiExplorerSplitView, BacklinksPanel, OutboundLinksPanel, PageClaimsPanel, PageSourceCoveragePanel, KnowledgeGraphExplorer, RawInboxQueue, ClaimsTable, DecisionTimeline, OpenQuestionsList, WorkOverviewPanel, RepoDependencyGraph, RepoLogTimeline, ReportsBrowser, RepoSettingsEditor.

### Operations

IngestQueue, IngestSourcePreview, IngestPlanPanel, IngestDiffReview, ContradictionReviewPanel, ApplyIngestControls, DiffViewer, RelationshipMiniGraph, DependencyTree, Timeline, GraphCanvas, InspectorPanel, BulkActionToolbar, EventStreamTable, EventDetailPanel, ActorSessionTimeline, ChangeDiffTimeline, SyncStatusPanel, IndexStatusPanel, DatabaseCacheStatusPanel, LockStatusPanel, MigrationStatusPanel, GitMergeDriverPanel, ObsidianCompatibilityPanel, ObsidianUriButton, VaultDashboardLinkList, StaticExportHeader, StaticSprintReport, StaticKnowledgeReport, StaticProjectDashboard.

## Next Import Rules

1. Extract theme tokens before component JSX conversion so all components reference semantic `--bw-*` variables.
2. Convert foundation components first because every later module depends on them.
3. Convert page-level components only after their underlying primitives and panels exist.
4. Keep component props tied to `@boreal/ui-model` view types where possible; do not read runtime state directly from browser components.
5. Add visual smoke coverage for one component from each bucket before closing the gallery phase.
