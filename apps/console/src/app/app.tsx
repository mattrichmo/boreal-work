import { RefreshCw, Server, Terminal } from "lucide-react";

import {
  ActorActivityPanel,
  Badge,
  Button,
  BucketOverviewGrid,
  Card,
  ClaimsTablePanel,
  DashboardHealthPanel,
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
import { routeFromPath, type ConsoleRoute } from "./routes.js";
import type { ConsoleDataSet } from "./types.js";

export function ConsoleApp({ routePath, data }: { readonly routePath: string; readonly data: ConsoleDataSet }) {
  const route = routeFromPath(routePath);
  return (
    <div className="bw-console" data-console-route={route.id}>
      <aside className="bw-console__sidebar">
        <div className="bw-console__brand">
          <strong>Boreal Console</strong>
          <span>{data.workspace.workspaceRoot}</span>
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
            <form method="post" action="/api/commands/sync.refresh">
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
          {route.id === "global" ? <OverviewPage data={data} /> : null}
          {route.id === "sprint" ? <SprintPage data={data} routePath={routePath} /> : null}
          {route.id === "knowledge" ? <KnowledgePage data={data} routePath={routePath} /> : null}
          {route.id === "repo" ? <RepoPage data={data} /> : null}
          {route.id === "reports" ? <ReportsPage data={data} /> : null}
          {route.id === "settings" ? <SettingsPage data={data} /> : null}
          {route.id === "work" ? <WorkPage data={data} /> : null}
          {route.id === "health" ? <HealthPage data={data} /> : null}
        </div>
      </main>
    </div>
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

function OverviewPage({ data }: { readonly data: ConsoleDataSet }) {
  return (
    <div className="bw-page-grid">
      <div className="bw-page-stack">
        <GlobalOverviewMetrics view={data.registry} />
        <BucketOverviewGrid view={data.registry} />
        <GlobalWorkQueues view={data.globalQueues} />
        <GlobalSearchPanel view={data.globalSearch} />
        <CommandPanel data={data} />
      </div>
      <div className="bw-page-stack">
        <GlobalHealthSummaryPanel view={data.globalHealth} />
        <GlobalDriftPanel view={data.globalHealth} />
        <ActorActivityPanel view={data.globalActivity} />
        <SyncStatusPanel view={data.sync} />
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
  return (
    <div className="bw-page-grid">
      <SprintProgressPanel view={data.work} />
      <Card title="Work queue" eyebrow={data.work.labels.join(", ")}>
        <SprintWorkTable items={items} />
      </Card>
    </div>
  );
}

function KnowledgePage({ data, routePath }: { readonly data: ConsoleDataSet; readonly routePath: string }) {
  const filters = knowledgeFiltersFromRoute(routePath);
  return (
    <div className="bw-page-grid">
      <div className="bw-page-stack">
        <RawInboxPanel view={data.rawInbox} />
        <WikiExplorerPanel view={data.wikiExplorer} />
        <MemoryWorkflowActionsPanel view={data.memoryActions} />
      </div>
      <div className="bw-page-stack">
        <KnowledgeHealthPanel view={data.wikiExplorer} />
        <ObsidianCompatibilityPanel view={data.wikiExplorer} />
        <WikiPageDetailPanel page={data.wikiExplorer.selected} />
        <WikiSourceCoveragePanel page={data.wikiExplorer.selected} />
        <WikiClaimsPanel page={data.wikiExplorer.selected} />
        <ClaimsTablePanel view={data.wikiExplorer} statusFilter={filters.claimStatus} sourceFilter={filters.source} />
        <KnowledgeDecisionTimelinePanel view={data.wikiExplorer} statusFilter={filters.decisionStatus} sourceFilter={filters.source} />
        <RawAssetPreviewPanel source={data.rawInbox.selected} />
        <RawIngestPlanPanel plan={data.rawInbox.ingestPlan} />
        <RawDiffReviewPanel plan={data.rawInbox.ingestPlan} />
        <RawContradictionReviewPanel review={data.rawInbox.contradictionReview} />
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

function SettingsPage({ data }: { readonly data: ConsoleDataSet }) {
  return (
    <div className="bw-page-grid">
      <GlobalSettingsPanel view={data.globalSettings} />
      <CommandPanel data={data} />
    </div>
  );
}

function HealthPage({ data }: { readonly data: ConsoleDataSet }) {
  return (
    <div className="bw-page-grid">
      <div className="bw-page-stack">
        <GlobalHealthSummaryPanel view={data.globalHealth} />
        <GlobalDriftPanel view={data.globalHealth} />
        <DashboardHealthPanel view={data.health} />
        <LockStatusPanel view={data.locks} />
      </div>
      <div className="bw-page-stack">
        <SyncStatusPanel view={data.sync} />
        <CommandPanel data={data} />
      </div>
    </div>
  );
}

function CommandPanel({ data }: { readonly data: ConsoleDataSet }) {
  return (
    <Card title="Commands" eyebrow="safe boundary" actions={<Terminal size={17} aria-hidden="true" />}>
      <div className="bw-command-list">
        {data.safeCommands.map((command) => (
          <form key={command.id} className="bw-command-row" method="post" action={`/api/commands/${command.id}`}>
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
