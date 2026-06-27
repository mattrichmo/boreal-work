export const borealComponentInventorySource = {
  path: "dump/Brand design system setup/Components.dc.html",
  labelAttribute: "data-screen-label",
  count: 177
} as const;

export type ComponentModuleKey = "foundation" | "entity" | "global" | "sprint" | "repoMemory" | "operations";

export interface ComponentModuleSpec {
  readonly key: ComponentModuleKey;
  readonly label: string;
  readonly targetDirectory: string;
  readonly description: string;
}

export interface ComponentInventoryItem {
  readonly name: string;
  readonly module: ComponentModuleKey;
  readonly sourcePath: typeof borealComponentInventorySource.path;
}

export interface ComponentInventorySummary {
  readonly sourcePath: typeof borealComponentInventorySource.path;
  readonly total: number;
  readonly modules: readonly {
    readonly key: ComponentModuleKey;
    readonly label: string;
    readonly count: number;
    readonly targetDirectory: string;
  }[];
}

export const componentModuleSpecs = [
  {
    key: "foundation",
    label: "Foundation",
    targetDirectory: "apps/console/src/components/foundation",
    description: "Token renderers, status primitives, form controls, empty/error/loading states, and shared list chrome."
  },
  {
    key: "entity",
    label: "Entity",
    targetDirectory: "apps/console/src/components/entity",
    description: "Reusable detail, lineage, evidence, source, raw, wiki, search, and edit surfaces for one entity."
  },
  {
    key: "global",
    label: "Global",
    targetDirectory: "apps/console/src/components/global",
    description: "Global dashboard, cross-project navigation, search, command, and shell-level components."
  },
  {
    key: "sprint",
    label: "Sprint and board",
    targetDirectory: "apps/console/src/components/sprint",
    description: "Sprint dashboards, kanban/table/calendar/roadmap views, queues, health panels, and progress surfaces."
  },
  {
    key: "repoMemory",
    label: "Repo memory",
    targetDirectory: "apps/console/src/components/repo-memory",
    description: "Project memory, wiki, graph, raw inbox, claims, decisions, reports, and repo settings surfaces."
  },
  {
    key: "operations",
    label: "Operations",
    targetDirectory: "apps/console/src/components/operations",
    description: "Ingest review, runtime status, events, locks, migrations, git, Obsidian, graph, diff, and static export surfaces."
  }
] as const satisfies readonly ComponentModuleSpec[];

const labelsByModule = {
  foundation: [
    "Colors",
    "Typography",
    "Spacing & Radii",
    "Accessibility",
    "Buttons",
    "Badges & Status",
    "Cards",
    "Inputs",
    "Task Rows",
    "PriorityBadge",
    "HealthBadge",
    "LabelChip",
    "EntityChip",
    "ActorAvatar",
    "DateTimeLabel",
    "MetricCard",
    "InlineNotice",
    "EmptyState",
    "ErrorState",
    "LoadingSkeleton",
    "ProgressSummary",
    "ConfirmDialog",
    "FieldLabel",
    "SelectField",
    "MultiSelectField",
    "EntityReferenceField",
    "DateField",
    "FilePickerField",
    "MarkdownEditorField",
    "FormValidationSummary",
    "SurfaceHeader",
    "MarkdownRenderer",
    "BoardViewSwitcher",
    "ScopeBreadcrumbs",
    "PageToolbar",
    "FilterBar",
    "ViewModeTabs"
  ],
  entity: [
    "EntityDetailHeader",
    "EntityList",
    "SourceRefList",
    "LinkedEntityList",
    "CommentThread",
    "EventTimelinePanel",
    "VerificationPanel",
    "DependencyPanel",
    "LineagePanel",
    "HealthFindingList",
    "StaleDataBanner",
    "FrontmatterPanel",
    "ActivityFeed",
    "WorkItemDetailPage",
    "WorkItemStatusControl",
    "WorkItemPriorityControl",
    "AcceptanceCriteriaList",
    "WorkItemBodyPanel",
    "WorkItemLineagePanel",
    "WikiPageDetailPage",
    "WikiPageReviewPanel",
    "WikiLinkPreview",
    "ObsidianOpenButton",
    "RawSourceDetailPage",
    "RawSourcePreview",
    "RawProcessingStatusPanel",
    "RawAssetViewer",
    "EntityCreateButton",
    "CreateEntityModal",
    "EntityEditForm",
    "QuickActionMenu",
    "SearchPage",
    "SearchModeSelector",
    "ResultInspector",
    "ContextBundleBuilder",
    "ResolverCandidateList",
    "MatchReasonList",
    "ContextBundlePanel"
  ],
  global: [
    "GlobalSidebar",
    "GlobalOverviewMetrics",
    "BucketOverviewGrid",
    "ProjectStatusGrid",
    "GlobalReadyQueue",
    "GlobalBlockedQueue",
    "CrossProjectRoadmap",
    "GlobalSearchResults",
    "ActorActivityPanel",
    "GlobalHealthSummary",
    "GlobalSettingsForm",
    "AppShell",
    "ProjectSwitcher",
    "BucketSwitcher",
    "UniversalSearchInput",
    "CommandPalette",
    "DetailDrawer",
    "SplitPane",
    "CardGrid"
  ],
  sprint: [
    "WorkHealthOverview",
    "ReadyQueuePanel",
    "BlockedQueuePanel",
    "VerificationQueuePanel",
    "StaleWorkList",
    "DuplicateWorkList",
    "DependencyCyclePanel",
    "SprintSidebar",
    "SprintHeader",
    "SprintScopeSummary",
    "SprintKanbanBoard",
    "SprintKanbanCard",
    "SprintWorkTable",
    "SprintDependencyView",
    "SprintTimelineView",
    "SprintProgressPanel",
    "SprintDiscoveriesPanel",
    "SprintVerificationQueue",
    "SprintReviewGeneratorPanel",
    "BoardHeader",
    "KanbanColumn",
    "SwimlaneBoard",
    "BoardTableView",
    "BoardCalendarView",
    "BoardRoadmapView",
    "BoardMatrixView"
  ],
  repoMemory: [
    "RepoSidebar",
    "KnowledgeHealthOverview",
    "OrphanPagesList",
    "StalePagesList",
    "BrokenLinksList",
    "ContradictionsList",
    "SourceCoverageMatrix",
    "KnowledgeReviewQueue",
    "ProjectOverviewPanel",
    "SetupChecklist",
    "MemoryIndexTree",
    "ImportantPagesPanel",
    "WikiExplorerSplitView",
    "BacklinksPanel",
    "OutboundLinksPanel",
    "PageClaimsPanel",
    "PageSourceCoveragePanel",
    "KnowledgeGraphExplorer",
    "RawInboxQueue",
    "ClaimsTable",
    "DecisionTimeline",
    "OpenQuestionsList",
    "WorkOverviewPanel",
    "RepoDependencyGraph",
    "RepoLogTimeline",
    "ReportsBrowser",
    "RepoSettingsEditor"
  ],
  operations: [
    "IngestQueue",
    "IngestSourcePreview",
    "IngestPlanPanel",
    "IngestDiffReview",
    "ContradictionReviewPanel",
    "ApplyIngestControls",
    "DiffViewer",
    "RelationshipMiniGraph",
    "DependencyTree",
    "Timeline",
    "GraphCanvas",
    "InspectorPanel",
    "BulkActionToolbar",
    "EventStreamTable",
    "EventDetailPanel",
    "ActorSessionTimeline",
    "ChangeDiffTimeline",
    "SyncStatusPanel",
    "IndexStatusPanel",
    "DatabaseCacheStatusPanel",
    "LockStatusPanel",
    "MigrationStatusPanel",
    "GitMergeDriverPanel",
    "ObsidianCompatibilityPanel",
    "ObsidianUriButton",
    "VaultDashboardLinkList",
    "StaticExportHeader",
    "StaticSprintReport",
    "StaticKnowledgeReport",
    "StaticProjectDashboard"
  ]
} as const satisfies Record<ComponentModuleKey, readonly string[]>;

export const borealComponentInventory = Object.entries(labelsByModule).flatMap(([module, names]) =>
  names.map((name) => ({
    name,
    module: module as ComponentModuleKey,
    sourcePath: borealComponentInventorySource.path
  }))
) as readonly ComponentInventoryItem[];

export function listComponentInventoryByModule(module: ComponentModuleKey): readonly ComponentInventoryItem[] {
  return borealComponentInventory.filter((item) => item.module === module);
}

export function findComponentInventoryItem(name: string): ComponentInventoryItem | undefined {
  return borealComponentInventory.find((item) => item.name === name);
}

export function summarizeComponentInventory(): ComponentInventorySummary {
  return {
    sourcePath: borealComponentInventorySource.path,
    total: borealComponentInventory.length,
    modules: componentModuleSpecs.map((spec) => ({
      key: spec.key,
      label: spec.label,
      count: listComponentInventoryByModule(spec.key).length,
      targetDirectory: spec.targetDirectory
    }))
  };
}
