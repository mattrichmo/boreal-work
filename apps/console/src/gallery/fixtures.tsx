import { renderToStaticMarkup } from "react-dom/server";
import type {
  DashboardHealthView,
  LockDashboardView,
  ProjectRegistryView,
  SprintBoardView,
  SyncDashboardView,
  WorkItemView
} from "@boreal/ui-model";

import {
  Badge,
  Button,
  Card,
  DashboardHealthPanel,
  DiffViewer,
  GlobalOverviewMetrics,
  GlobalReadyQueue,
  LockStatusPanel,
  MetricCard,
  Notice,
  RawSourcePreview,
  SourceRefList,
  SprintHeader,
  SprintKanbanBoard,
  SyncStatusPanel,
  TextInput,
  WikiPageDetailPage,
  WorkItemDetailPage
} from "../components/index.js";

export type ConsoleGalleryViewport = "desktop" | "mobile";

export const consoleGalleryFamilies = [
  "foundation",
  "global-dashboard",
  "sprint-board",
  "raw-wiki",
  "operations"
] as const;

export const consoleGalleryCopyAudit = {
  bannedMarketingWords: ["beautiful", "revolutionary", "next-gen", "seamless", "magical"],
  requiredCommandLabels: ["bwrk doctor --strict --json", "bwrk sync refresh --json", "bwrk work claim --json"],
  rules: [
    "Use action labels that match CLI command names when a command exists.",
    "Use state labels that describe runtime truth: ready, blocked, in progress, closed, stale, missing.",
    "Keep empty states concise and operational."
  ]
} as const;

export function ConsoleGallery({ viewport = "desktop" }: { readonly viewport?: ConsoleGalleryViewport }) {
  const work = workItem({ id: "bw_work_gallery001", title: "Convert component primitives", evidenceCount: 1 });
  const board = sprintBoardView(work);
  const registry = registryView();
  const health = healthView();
  const sync = syncView();
  const locks = lockView();

  return (
    <main className={`bw-gallery bw-gallery--${viewport}`} data-gallery-viewport={viewport}>
      <section data-gallery-family="foundation">
        <h2>Foundation</h2>
        <div className="bw-gallery__grid">
          <Button variant="primary">bwrk work claim --json</Button>
          <Button variant="secondary">bwrk sync refresh --json</Button>
          <Badge tone="success">ready</Badge>
          <Badge tone="warning">blocked</Badge>
          <MetricCard label="Ready" value="3" detail="claimable" />
          <TextInput label="Filter label" name="label" defaultValue="sprint-03" />
          <Notice label="Readonly">Static gallery fixture. No project memory mutation.</Notice>
          <Card title="Stable card" eyebrow="foundation">Dense dashboard content keeps its shape.</Card>
        </div>
      </section>

      <section data-gallery-family="global-dashboard">
        <h2>Global Dashboard</h2>
        <GlobalOverviewMetrics view={registry} />
        <GlobalReadyQueue view={workDashboardView(work)} />
      </section>

      <section data-gallery-family="sprint-board">
        <h2>Sprint Board</h2>
        <SprintHeader view={board} />
        <SprintKanbanBoard view={board} />
      </section>

      <section data-gallery-family="raw-wiki">
        <h2>Raw And Wiki</h2>
        <WorkItemDetailPage work={work} />
        <SourceRefList refs={[{ id: "src-1", kind: "raw", label: "thread-export.txt", status: "ok" }]} />
        <RawSourcePreview title="thread-export.txt" body="Decision: keep console browser-only and runtime packages dependency-light." />
        <WikiPageDetailPage title="Component import boundary">Components consume shared view models and do not read runtime state directly.</WikiPageDetailPage>
      </section>

      <section data-gallery-family="operations">
        <h2>Operations</h2>
        <Notice label="Command">bwrk doctor --strict --json</Notice>
        <DashboardHealthPanel view={health} />
        <SyncStatusPanel view={sync} />
        <LockStatusPanel view={locks} />
        <DiffViewer before="- inline style" after="+ token class" />
      </section>
    </main>
  );
}

export function renderConsoleGalleryHtml(input: {
  readonly viewport?: ConsoleGalleryViewport;
  readonly includeDocument?: boolean;
} = {}): string {
  const body = renderToStaticMarkup(<ConsoleGallery viewport={input.viewport ?? "desktop"} />);
  if (!input.includeDocument) return body;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Boreal Console Gallery</title><style>${consoleGalleryCss}</style></head><body>${body}</body></html>`;
}

export const consoleGalleryCss = `
:root { color-scheme: dark; background: var(--bw-bg, #080A09); color: var(--bw-text-body, #BFCCC6); font-family: var(--bw-font-sans, system-ui, sans-serif); }
body { margin: 0; }
.bw-gallery { display: grid; gap: 24px; padding: 24px; }
.bw-gallery--desktop { max-width: 1280px; margin: 0 auto; }
.bw-gallery--mobile { max-width: 390px; padding: 16px; }
.bw-gallery section { border: 1px solid var(--bw-border, #2C342E); border-radius: 12px; padding: 16px; min-width: 0; }
.bw-gallery__grid, .bw-global-metrics, .bw-sprint-header__metrics, .bw-health-summary, .bw-sync-grid, .bw-progress-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
.bw-kanban { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
.bw-kanban-card, .bw-card, .bw-metric { min-width: 0; overflow-wrap: anywhere; }
button, input { max-width: 100%; }
`;

function workItem(input: Partial<WorkItemView> & Pick<WorkItemView, "id" | "title">): WorkItemView {
  return {
    kind: "task",
    status: "ready",
    priority: "critical",
    labels: ["sprint-03", "component-import"],
    dependencyIds: [],
    activeBlockerIds: [],
    blockedBy: [],
    evidenceCount: 0,
    verificationCount: 0,
    ...input
  };
}

function sprintBoardView(work: WorkItemView): SprintBoardView {
  const sprint = workItem({ id: "bw_work_sprint03", kind: "sprint", title: "Sprint 03 - Component import" });
  return {
    sprint,
    phases: [workItem({ id: "bw_work_phase03d", kind: "milestone", title: "Phase 03D", status: "in_progress" })],
    lanes: [
      { id: "ready", title: "Ready", count: 1, items: [work] },
      { id: "in_progress", title: "In Progress", count: 1, items: [workItem({ id: "bw_work_gallery", title: "Build gallery", status: "in_progress" })] },
      { id: "closed", title: "Closed", count: 1, items: [workItem({ id: "bw_work_done", title: "Extract tokens", status: "closed" })] }
    ],
    summary: {
      sprintId: sprint.id,
      total: 3,
      ready: 1,
      blocked: 0,
      inProgress: 1,
      needsVerification: 0,
      verified: 0,
      closed: 1,
      activeReservations: 1,
      expiredReservations: 0,
      phaseCount: 1,
      taskCount: 3,
      activeBlockerCount: 0
    }
  };
}

function workDashboardView(work: WorkItemView) {
  return {
    labels: ["sprint-03"],
    queues: [
      { id: "ready" as const, title: "Ready", count: 1, items: [work] },
      { id: "blocked" as const, title: "Blocked", count: 0, items: [] },
      { id: "in_progress" as const, title: "In Progress", count: 0, items: [] },
      { id: "needs_verification" as const, title: "Needs Verification", count: 0, items: [] },
      { id: "verified" as const, title: "Verified", count: 0, items: [] },
      { id: "closed" as const, title: "Closed", count: 0, items: [] }
    ],
    summary: {
      total: 1,
      ready: 1,
      blocked: 0,
      inProgress: 0,
      needsVerification: 0,
      verified: 0,
      closed: 0,
      activeReservations: 0,
      expiredReservations: 0
    }
  };
}

function registryView(): ProjectRegistryView {
  return {
    entries: [],
    summary: {
      totalProjects: 2,
      healthyProjects: 2,
      warningProjects: 0,
      errorProjects: 0,
      missingProjects: 0,
      readyWorkCount: 3,
      blockedWorkCount: 0,
      activeReservationCount: 1
    }
  };
}

function healthView(): DashboardHealthView {
  return {
    title: "Doctor",
    summary: { ok: true, total: 0, errors: 0, warnings: 0, manualActions: 0, fixableActions: 0 },
    findings: []
  };
}

function syncView(): SyncDashboardView {
  return {
    ok: true,
    workspaceRoot: "/repo",
    vaultOk: true,
    ledgersOk: true,
    searchIndexOk: true,
    gitOk: true,
    recommendedActions: [{ label: "Refresh", command: "bwrk sync refresh --json" }],
    findings: []
  };
}

function lockView(): LockDashboardView {
  return {
    ok: true,
    workspaceRoot: "/repo",
    locks: [{ domain: "work", path: ".boreal/locks/work.lock", status: "clear" }]
  };
}
