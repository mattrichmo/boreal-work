import { RefreshCw, Server, Terminal } from "lucide-react";

import {
  ActorActivityPanel,
  Badge,
  Button,
  BucketOverviewGrid,
  Card,
  ClaimsTablePanel,
  DashboardHealthPanel,
  DirectiveSummaryPanel,
  GlobalBoard,
  GlobalDriftPanel,
  GlobalHealthSummaryPanel,
  GlobalOverviewMetrics,
  GlobalSearchPanel,
  GlobalSettingsPanel,
  GlobalWorkQueues,
  KnowledgeDecisionTimelinePanel,
  KnowledgeHealthPanel,
  LockStatusPanel,
  MemoryWorkflowActionsPanel,
  Notice,
  ObsidianCompatibilityPanel,
  RawAssetPreviewPanel,
  RawContradictionReviewPanel,
  RawDiffReviewPanel,
  RawInboxPanel,
  RawIngestPlanPanel,
  ReportsBrowserPanel,
  SourceRefList,
  StaticExportsPanel,
  StaticKnowledgeReportPanel,
  VaultDashboardLinksPanel,
  WikiClaimsPanel,
  WikiExplorerPanel,
  WikiPageDetailPanel,
  WikiSourceCoveragePanel,
  isSprintViewMode,
  type SprintViewMode,
  SprintDashboardActions,
  SprintHeader,
  ReconciliationStatusPanel,
  SprintBoardProgressView,
  SprintBoardTable,
  SprintDependencyView,
  SprintKanbanBoard,
  SprintProgressPanel,
  SprintReviewQueues,
  SprintScopeSummary,
  SprintTimelineView,
  SprintWorkTable,
  SyncStatusPanel,
  ViewModeTabs
} from "../components/index.js";
import { isKnownConsoleRoute, routeFromPath, type ConsoleRoute } from "./routes.js";
import type { ConsoleDataSet } from "./types.js";

export function ConsoleApp({ routePath, data }: { readonly routePath: string; readonly data: ConsoleDataSet }) {
  const route = routeFromPath(routePath, data.workspace.scope);
  const global = data.workspace.scope === "global";
  const knownRoute = isKnownConsoleRoute(routePath, data.workspace.scope);
  const actionsBlocked = !knownRoute || data.workspace.stale || data.workspace.warnings.length > 0;
  const actionBlockReason = !knownRoute
    ? `The requested route is not supported: ${routePath.split(/[?#]/, 1)[0] || "/"}. Choose a route from the navigation.`
    : data.workspace.stale
      ? "This view is stale. Refresh before taking any state-changing action."
      : data.workspace.warnings.length > 0
        ? "This view has warnings. Resolve them and refresh before taking any state-changing action."
        : undefined;
  return (
    <div className="bw-console" data-console-route={route.id} data-console-scope={data.workspace.scope}>
      <aside className="bw-console__sidebar">
        <div className="bw-console__brand">
          <strong>{global ? "Boreal Global" : "Boreal Console"}</strong>
          <span>{global ? "all registered projects" : data.workspace.workspaceRoot}</span>
        </div>
        <nav className="bw-console__nav" aria-label="Console">
          {data.routes.map((item) => <NavLink key={item.id} route={item} active={item.id === route.id} />)}
        </nav>
        <div className="bw-console__mode">
          <Badge tone={data.workspace.mode === "live" ? "success" : "warning"}>{data.workspace.mode}</Badge>
          <span>{data.workspace.generatedAt}</span>
        </div>
      </aside>
      <main className="bw-console__main">
        <header className="bw-console__topbar">
          <div className="bw-console__title">
            <h1>{route.label}</h1>
            <p>{data.workspace.projectName}</p>
          </div>
          <div className="bw-console__actions">
            <form className="bw-console__refresh-form" method="post" action="/api/commands/sync.refresh">
              <input type="hidden" name="returnTo" value={routePath} />
              <label className="bw-command-confirm">
                <input name="confirm" value="yes" type="checkbox" required />
                <span>Confirm refresh</span>
              </label>
              <Button type="submit" variant="primary" icon={<RefreshCw size={16} />}>Refresh</Button>
            </form>
            <a className="bw-button bw-button--secondary bw-button--md" href="/api/state">
              <span className="bw-button__icon" aria-hidden="true"><Server size={16} /></span>
              <span className="bw-button__label">JSON</span>
            </a>
          </div>
        </header>
        <div className="bw-console__content">
          {data.workspace.stale ? <StaleBanner data={data} /> : null}
          {!knownRoute ? <UnsupportedRouteState routePath={routePath} /> : null}
          {knownRoute && actionBlockReason ? (
            <Notice tone="warning" label="Read-only until refreshed" tabIndex={-1} data-bw-action-safety="true">
              {actionBlockReason}
            </Notice>
          ) : null}
          {knownRoute ? (
            <fieldset
              className="bw-action-safety-fieldset"
              disabled={actionsBlocked}
              data-bw-actions-blocked={actionsBlocked ? "true" : "false"}
              aria-disabled={actionsBlocked || undefined}
            >
              <div data-bw-action-scope="true">
                {route.id === "overview" ? <RepoOverviewPage data={data} routePath={routePath} /> : null}
                {route.id === "global" ? <OverviewPage data={data} routePath={routePath} /> : null}
                {route.id === "sprint" ? <SprintPage data={data} routePath={routePath} /> : null}
                {route.id === "knowledge" ? <KnowledgePage data={data} routePath={routePath} /> : null}
                {route.id === "repo" ? <RepoPage data={data} /> : null}
                {route.id === "reports" ? <ReportsPage data={data} /> : null}
                {route.id === "settings" ? <SettingsPage data={data} routePath={routePath} /> : null}
                {route.id === "work" ? <WorkPage data={data} /> : null}
                {route.id === "health" ? <HealthPage data={data} routePath={routePath} /> : null}
              </div>
            </fieldset>
          ) : null}
        </div>
      </main>
    </div>
  );
}

function UnsupportedRouteState({ routePath }: { readonly routePath: string }) {
  return (
    <Notice tone="warning" label="Unsupported route" tabIndex={-1} data-bw-action-safety="true">
      {`No console view is registered for ${routePath.split(/[?#]/, 1)[0] || "/"}. Use the navigation links to choose a supported route.`}
    </Notice>
  );
}

function NavLink({ route, active }: { readonly route: ConsoleRoute; readonly active: boolean }) {
  return (
    <a className="bw-console__nav-link" href={route.path} aria-current={active ? "page" : undefined}>
      <span aria-hidden="true">{route.icon}</span>
      <span>{route.label}</span>
    </a>
  );
}

function OverviewPage({ data, routePath }: { readonly data: ConsoleDataSet; readonly routePath: string }) {
  const items = data.work.queues.flatMap((queue) => queue.items);
  const hasProjects = data.registry.entries.length > 0;
  return (
    <div className="bw-page-grid">
      <div className="bw-page-stack">
        <Card title="Global work" eyebrow="your cross-project to-dos and plans">
          <SprintWorkTable items={items} />
        </Card>
        {hasProjects ? (
          <>
            <GlobalOverviewMetrics view={data.registry} />
            <GlobalBoard view={data.globalBoard} routePath={routePath} />
            <BucketOverviewGrid view={data.registry} />
            <GlobalWorkQueues view={data.globalQueues} />
            <GlobalSearchPanel view={data.globalSearch} />
          </>
        ) : (
          <Notice tone="warning" label="No linked projects">
            Link a project to track it here with{" "}
            <code>bwrk link /path/to/project</code> (or <code>bwrk link</code> from inside one), then refresh.
          </Notice>
        )}
      </div>
      <div className="bw-page-stack">
        <SprintProgressPanel view={data.work} />
        {hasProjects ? (
          <>
            <GlobalHealthSummaryPanel view={data.globalHealth} />
            <GlobalDriftPanel view={data.globalHealth} />
            <ActorActivityPanel view={data.globalActivity} />
          </>
        ) : null}
      </div>
    </div>
  );
}

function RepoOverviewPage({ data, routePath }: { readonly data: ConsoleDataSet; readonly routePath: string }) {
  const items = data.work.queues.flatMap((queue) => queue.items);
  return (
    <div className="bw-page-grid">
      <div className="bw-page-stack">
        <SprintProgressPanel view={data.work} />
        <Card title="Work queue" eyebrow={data.work.labels.join(", ")}>
          <SprintWorkTable items={items} />
        </Card>
      </div>
      <div className="bw-page-stack">
        <SyncStatusPanel view={data.sync} />
        <DashboardHealthPanel view={data.health} />
        <CommandPanel data={data} routePath={routePath} />
      </div>
    </div>
  );
}

function SprintPage({ data, routePath }: { readonly data: ConsoleDataSet; readonly routePath: string }) {
  const viewMode = sprintViewModeFromRoute(routePath);
  return (
    <div className="bw-page-stack">
      <SprintHeader view={data.sprint} />
      <SprintScopeSummary view={data.sprint} />
      <ReconciliationStatusPanel work={data.sprint.sprint} />
      <DirectiveSummaryPanel work={data.sprint.sprint} title="Sprint agent directives" />
      <ViewModeTabs active={viewMode} routePath={routePath} />
      <SprintReviewQueues view={data.sprint} routePath={routePath} />
      <SprintDashboardActions view={data.sprint} routePath={routePath} />
      {viewMode === "kanban" ? <SprintKanbanBoard view={data.sprint} /> : null}
      {viewMode === "table" ? <SprintBoardTable view={data.sprint} /> : null}
      {viewMode === "dependency" ? <SprintDependencyView view={data.sprint} /> : null}
      {viewMode === "timeline" ? <SprintTimelineView view={data.sprint} /> : null}
      {viewMode === "progress" ? <SprintBoardProgressView view={data.sprint} /> : null}
    </div>
  );
}

function WorkPage({ data }: { readonly data: ConsoleDataSet }) {
  const items = data.work.queues.flatMap((queue) => queue.items);
  const directiveWork = items.find((item) => item.directiveSummary && item.directiveSummary.total > 0);
  return (
    <div className="bw-page-grid">
      <div className="bw-page-stack">
        <SprintProgressPanel view={data.work} />
        {directiveWork ? <DirectiveSummaryPanel work={directiveWork} title="Work agent directives" /> : null}
      </div>
      <Card title="Work queue" eyebrow={data.work.labels.join(", ")}>
        <SprintWorkTable items={items} />
      </Card>
    </div>
  );
}

function KnowledgePage({ data, routePath }: { readonly data: ConsoleDataSet; readonly routePath: string }) {
  const view = knowledgeViewFromRoute(routePath);
  const filters = knowledgeFiltersFromRoute(routePath);
  return (
    <div className="bw-page-stack">
      <KnowledgeViewTabs active={view} routePath={routePath} />
      {view === "wiki" ? <KnowledgeWikiView data={data} routePath={routePath} /> : null}
      {view === "raw" ? <KnowledgeRawView data={data} routePath={routePath} /> : null}
      {view === "health" ? <KnowledgeHealthView data={data} filters={filters} /> : null}
    </div>
  );
}

function KnowledgeWikiView({ data, routePath }: { readonly data: ConsoleDataSet; readonly routePath: string }) {
  const selected = data.wikiExplorer.selected;
  return (
    <div className="bw-page-grid">
      <div className="bw-page-stack">
        <WikiExplorerPanel view={data.wikiExplorer} routePath={routePath} />
      </div>
      <div className="bw-page-stack">
        {selected ? (
          <>
            <WikiPageDetailPanel page={selected} />
            <WikiSourceCoveragePanel page={selected} />
            <WikiClaimsPanel page={selected} />
          </>
        ) : (
          <Notice label="Wiki">Select a page to inspect its sources, claims, and decisions.</Notice>
        )}
      </div>
    </div>
  );
}

function KnowledgeRawView({ data, routePath }: { readonly data: ConsoleDataSet; readonly routePath: string }) {
  const selected = data.rawInbox.selected;
  return (
    <div className="bw-page-grid">
      <div className="bw-page-stack">
        <RawInboxPanel view={data.rawInbox} routePath={routePath} />
      </div>
      <div className="bw-page-stack">
        {selected ? (
          <>
            <RawAssetPreviewPanel source={selected} />
            <RawIngestPlanPanel plan={data.rawInbox.ingestPlan} />
            <RawDiffReviewPanel plan={data.rawInbox.ingestPlan} />
            <RawContradictionReviewPanel review={data.rawInbox.contradictionReview} />
          </>
        ) : (
          <Notice label="Raw inbox">Select a source to preview it and review its ingest plan.</Notice>
        )}
      </div>
    </div>
  );
}

function KnowledgeHealthView({
  data,
  filters
}: {
  readonly data: ConsoleDataSet;
  readonly filters: { readonly claimStatus?: string; readonly decisionStatus?: string; readonly source?: string };
}) {
  return (
    <div className="bw-page-grid">
      <div className="bw-page-stack">
        <KnowledgeHealthPanel view={data.wikiExplorer} />
        <ClaimsTablePanel view={data.wikiExplorer} statusFilter={filters.claimStatus} sourceFilter={filters.source} />
        <KnowledgeDecisionTimelinePanel view={data.wikiExplorer} statusFilter={filters.decisionStatus} sourceFilter={filters.source} />
      </div>
      <div className="bw-page-stack">
        <ObsidianCompatibilityPanel view={data.wikiExplorer} />
        <MemoryWorkflowActionsPanel view={data.memoryActions} />
        <SourceRefList refs={[{ id: "memory-root", kind: "memory", label: data.workspace.memoryRoot ?? "memory", status: "ok" }]} />
      </div>
    </div>
  );
}

function RepoPage({ data }: { readonly data: ConsoleDataSet }) {
  const project = data.registry.entries[0];
  return (
    <div className="bw-page-grid">
      <Card title="Repository" eyebrow={data.workspace.projectName}>
        <div className="bw-command-list">
          <span><strong>Project</strong> {project?.projectRoot ?? data.workspace.workspaceRoot}</span>
          <span><strong>Memory</strong> {project?.memoryRoot ?? data.workspace.memoryRoot ?? "memory"}</span>
          <span><strong>Layout</strong> {project?.memoryLayout ?? "in-repo"}</span>
          <span><strong>Git mode</strong> {project?.memoryGitMode ?? "separate"}</span>
        </div>
      </Card>
      <SyncStatusPanel view={data.sync} />
    </div>
  );
}

function ReportsPage({ data }: { readonly data: ConsoleDataSet }) {
  return (
    <div className="bw-page-grid">
      <div className="bw-page-stack">
        <ReportsBrowserPanel view={data.reports} />
        <StaticKnowledgeReportPanel view={data.reports} />
      </div>
      <div className="bw-page-stack">
        <StaticExportsPanel view={data.reports} />
        <MemoryWorkflowActionsPanel view={data.memoryActions} />
        <VaultDashboardLinksPanel view={data.wikiExplorer} />
        <SprintProgressPanel view={data.work} />
        <DashboardHealthPanel view={data.health} />
      </div>
    </div>
  );
}

function SettingsPage({ data, routePath }: { readonly data: ConsoleDataSet; readonly routePath: string }) {
  return (
    <div className="bw-page-grid">
      <GlobalSettingsPanel view={data.globalSettings} routePath={routePath} />
      <CommandPanel data={data} routePath={routePath} />
    </div>
  );
}

function HealthPage({ data, routePath }: { readonly data: ConsoleDataSet; readonly routePath: string }) {
  return (
    <div className="bw-page-grid">
      <div className="bw-page-stack">
        <DashboardHealthPanel view={data.health} />
        <LockStatusPanel view={data.locks} />
      </div>
      <div className="bw-page-stack">
        <SyncStatusPanel view={data.sync} />
        <CommandPanel data={data} routePath={routePath} />
      </div>
    </div>
  );
}

function CommandPanel({ data, routePath }: { readonly data: ConsoleDataSet; readonly routePath: string }) {
  return (
    <Card title="Commands" eyebrow="safe boundary" actions={<Terminal size={17} aria-hidden="true" />}>
      <div className="bw-command-list">
        {data.safeCommands.map((command) => (
          <form key={command.id} className="bw-command-row" method="post" action={`/api/commands/${command.id}`}>
            <input type="hidden" name="returnTo" value={routePath} />
            <div>
              <strong>{command.label}</strong>
              <div><code>{command.command}</code></div>
              {command.mutatesState ? <Badge tone="warning">mutates</Badge> : null}
            </div>
            <div className="bw-command-row__actions">
              {command.requiresConfirmation ? (
                <label className="bw-command-confirm">
                  <input name="confirm" value="yes" type="checkbox" required />
                  <span>Confirm</span>
                </label>
              ) : null}
              <Button type="submit" variant={command.mutatesState ? "primary" : "secondary"} disabled={!command.executable}>
                {command.executable ? command.mutatesState ? "Run" : "Read" : "Target"}
              </Button>
            </div>
          </form>
        ))}
      </div>
    </Card>
  );
}

function StaleBanner({ data }: { readonly data: ConsoleDataSet }) {
  return (
    <Notice tone="warning" label="Stale" className="bw-stale-banner">
      {data.workspace.warnings.length > 0 ? data.workspace.warnings.join(" ") : "Generated state needs refresh."}
    </Notice>
  );
}

function sprintViewModeFromRoute(routePath: string): SprintViewMode {
  const query = routePath.includes("?") ? routePath.slice(routePath.indexOf("?") + 1).split("#")[0] ?? "" : "";
  const value = new URLSearchParams(query).get("view");
  return isSprintViewMode(value) ? value : "kanban";
}

function knowledgeFiltersFromRoute(routePath: string): {
  readonly claimStatus?: string;
  readonly decisionStatus?: string;
  readonly source?: string;
} {
  const query = routePath.includes("?") ? routePath.slice(routePath.indexOf("?") + 1).split("#")[0] ?? "" : "";
  const params = new URLSearchParams(query);
  return {
    claimStatus: params.get("claimStatus") ?? undefined,
    decisionStatus: params.get("decisionStatus") ?? undefined,
    source: params.get("source") ?? undefined
  };
}

type KnowledgeView = "wiki" | "raw" | "health";

const KNOWLEDGE_VIEWS: readonly { readonly id: KnowledgeView; readonly label: string }[] = [
  { id: "wiki", label: "Wiki" },
  { id: "raw", label: "Raw inbox" },
  { id: "health", label: "Health" }
];

function knowledgeViewFromRoute(routePath: string): KnowledgeView {
  const query = routePath.includes("?") ? routePath.slice(routePath.indexOf("?") + 1).split("#")[0] ?? "" : "";
  const value = new URLSearchParams(query).get("view");
  return KNOWLEDGE_VIEWS.some((view) => view.id === value) ? (value as KnowledgeView) : "wiki";
}

function knowledgeViewHref(routePath: string, view: KnowledgeView): string {
  const [withoutHash = "", hash] = routePath.split("#", 2);
  const [pathname = "/knowledge", query = ""] = withoutHash.split("?", 2);
  const params = new URLSearchParams(query);
  params.set("view", view);
  const nextQuery = params.toString();
  return `${pathname || "/knowledge"}${nextQuery ? `?${nextQuery}` : ""}${hash ? `#${hash}` : ""}`;
}

function KnowledgeViewTabs({ active, routePath }: { readonly active: KnowledgeView; readonly routePath: string }) {
  return (
    <nav className="bw-view-tabs" aria-label="Knowledge views">
      {KNOWLEDGE_VIEWS.map((view) => (
        <a
          key={view.id}
          className={`bw-view-tabs__tab${active === view.id ? " bw-view-tabs__tab--active" : ""}`}
          href={knowledgeViewHref(routePath, view.id)}
          aria-current={active === view.id ? "page" : undefined}
        >
          {view.label}
        </a>
      ))}
    </nav>
  );
}
