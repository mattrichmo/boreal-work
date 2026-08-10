# Component Import Plan

This page documents the maintained component inventory and import plan for the Boreal console. The canonical typed inventory lives in `packages/ui-model/src/component-inventory.ts`; it includes shipped primitives and planned component slots. Browser components are implemented in `apps/console` and do not import runtime state directly.

## Current Source Truth

The inventory is grouped by responsibility so the console can grow without coupling UI packages to the engine, storage, or CLI implementation.

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

- Console runtime: React + TypeScript static HTML rendering behind the local Node HTTP server; the package is built with the repository's TypeScript project references rather than Vite.
- Shared model boundary: `@boreal/ui-model` owns dashboard/component inventory data contracts and has no browser dependency.
- Runtime boundary: `@boreal/core`, `@boreal/engine`, storage, work, graph, evidence, and search packages must not import React, Vite, DOM APIs, or console CSS.
- CLI/TUI boundary: the CLI rich text/dashboard views stay terminal-first and consume JSON/model contracts only; they do not reuse browser components.
- Styling boundary: import the Boreal token contract into the console as theme CSS and keep component styles class-based or scoped.

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
