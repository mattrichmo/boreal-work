import { renderToStaticMarkup } from "react-dom/server";
import type {
  DashboardHealthView,
  GlobalActivityView,
  GlobalHealthView,
  GlobalSearchView,
  GlobalWorkQueuesView,
  LockDashboardView,
  ProjectRegistryView,
  SprintBoardView,
  SyncDashboardView,
  WorkDirectiveSummaryView,
  WorkItemView
} from "@boreal/ui-model";

import {
  Badge,
  Button,
  Card,
  DashboardHealthPanel,
  DirectiveSummaryPanel,
  DiffViewer,
  ActorActivityPanel,
  GlobalDriftPanel,
  GlobalHealthSummaryPanel,
  GlobalOverviewMetrics,
  GlobalSearchPanel,
  GlobalWorkQueues,
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
  "agent-directives",
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
  const directiveWork = workItem({
    id: "bw_work_gallery_directives",
    title: "Review directive obligations",
    directiveSummary: directiveSummary("bw_work_gallery_directives")
  });
  const emptyDirectiveWork = workItem({ id: "bw_work_gallery_empty_directives", title: "No directive bundle" });
  const board = sprintBoardView(work);
  const registry = registryView();
  const health = healthView();
  const globalHealth = globalHealthView();
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
        <GlobalWorkQueues view={globalQueuesView(work)} />
        <GlobalSearchPanel view={globalSearchView(work)} />
        <GlobalHealthSummaryPanel view={globalHealth} />
        <GlobalDriftPanel view={globalHealth} />
        <ActorActivityPanel view={globalActivityView()} />
      </section>

      <section data-gallery-family="sprint-board">
        <h2>Sprint Board</h2>
        <SprintHeader view={board} />
        <SprintKanbanBoard view={board} />
      </section>

      <section data-gallery-family="agent-directives">
        <h2>Agent Directives</h2>
        <div className="bw-gallery__grid">
          <DirectiveSummaryPanel work={directiveWork} title="Populated directive states" />
          <DirectiveSummaryPanel work={emptyDirectiveWork} title="Empty directive state" />
        </div>
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
  const item = {
    kind: "task" as const,
    status: "ready" as const,
    priority: "critical" as const,
    labels: ["sprint-03", "component-import"],
    dependencyIds: [],
    activeBlockerIds: [],
    blockedBy: [],
    evidenceCount: 0,
    verificationCount: 0,
    requiredCloseoutGates: [],
    ...input
  };
  return {
    ...item,
    requiredCloseoutGates: item.requiredCloseoutGates ?? []
  };
}

function directiveSummary(subjectId: string): WorkDirectiveSummaryView {
  const items: WorkDirectiveSummaryView["items"] = [
    {
      id: "directive.workflow_next.gallery",
      registryId: "workflow_next.canonical-next-step",
      family: "workflow_next",
      kind: "next_step",
      title: "Follow next canonical workflow",
      severity: "action",
      lifecycle: "active",
      lane: "recommended",
      reason: "Follow the named canonical workflow before continuing.",
      sourceCommand: `bwrk work show ${subjectId} --json`,
      nextCommand: "bwrk sync refresh --json",
      workflowRef: "workflows/40-work/claim-and-finish-work.md",
      requiredInputs: ["work", "doctor"],
      relatedIds: [subjectId]
    },
    {
      id: "directive.closeout.gallery",
      registryId: "closeout.summary-required",
      family: "closeout",
      kind: "summary",
      title: "Prepare closeout summary",
      severity: "required",
      lifecycle: "active",
      lane: "required",
      reason: "Closeout requires a verified user-facing summary.",
      sourceCommand: `bwrk agent finish ${subjectId} --json`,
      blocksCloseout: true,
      acknowledgement: {
        requiredBefore: "close",
        evidenceKind: "note",
        message: "The user-facing closeout summary must be prepared from verified data."
      },
      requiredInputs: ["summary", "evidence"],
      relatedIds: [subjectId]
    },
    {
      id: "directive.blocked.gallery",
      registryId: "blocked.resolve-blockers",
      family: "blocked",
      kind: "recovery",
      title: "Resolve active blockers",
      severity: "blocking",
      lifecycle: "blocked",
      lane: "blocked",
      reason: "Blocking directive wins until active blockers are resolved.",
      sourceCommand: "bwrk dep tree bw_work_gallery_directives --json",
      nextCommand: "bwrk dep tree bw_work_gallery_directives --json",
      recoveryWorkflow: "workflows/40-work/link-dependencies.md",
      blocksCloseout: true,
      acknowledgement: {
        requiredBefore: "force_gate",
        evidenceKind: "artifact",
        message: "Active blockers require explicit resolution or a forced gate reason."
      },
      requiredInputs: ["work", "gate"],
      relatedIds: [subjectId, "bw_work_gallery_blocker"]
    },
    {
      id: "directive.context.gallery",
      registryId: "context.info",
      family: "context",
      kind: "reference",
      title: "Context pack available",
      severity: "info",
      lifecycle: "active",
      lane: "informational",
      reason: "Context is available for operator review.",
      sourceCommand: `bwrk summary show ${subjectId} --json`,
      requiredInputs: [],
      relatedIds: [subjectId, "bw_summary_gallery"]
    }
  ];
  const nextSteps = items.flatMap((item) => {
    const workflowRef = item.workflowRef ?? item.recoveryWorkflow;
    if (!item.nextCommand && !workflowRef) {
      return [];
    }
    return [{
      id: `next-step-${item.id}`,
      title: item.title,
      lane: item.lane,
      command: item.nextCommand,
      workflowRef,
      reason: item.reason,
      relatedIds: item.relatedIds
    }];
  });
  const conflicts: WorkDirectiveSummaryView["conflicts"] = [
    {
      id: "directive-conflict-gallery",
      directiveIds: ["directive.blocked.gallery", "directive.workflow_next.gallery"],
      reason: "Blocking directive must be resolved before the lower-priority directive can be acted on.",
      resolution: "blocking_wins",
      resolvedDirectiveId: "directive.blocked.gallery",
      severity: "blocking",
      lane: "blocked"
    }
  ];
  const missingRequired: WorkDirectiveSummaryView["missingRequired"] = [
    {
      id: "directive-missing-gallery",
      registryId: "closeout.summary-required",
      family: "closeout",
      requirement: "summary.latestSummaryId",
      message: "Summary data is required.",
      subjectId,
      subjectType: "work"
    }
  ];
  return {
    total: items.length,
    informational: items.filter((item) => item.lane === "informational").length,
    recommended: items.filter((item) => item.lane === "recommended").length,
    required: items.filter((item) => item.lane === "required").length,
    blocked: items.filter((item) => item.lane === "blocked").length,
    conflictCount: conflicts.length,
    missingRequiredCount: missingRequired.length,
    acknowledgementCount: items.filter((item) => item.acknowledgement).length,
    blockerIds: ["bw_work_gallery_blocker"],
    sourceCommands: Array.from(new Set(items.flatMap((item) => item.sourceCommand ? [item.sourceCommand] : []))),
    safeCommands: Array.from(new Set([
      ...items.flatMap((item) => item.sourceCommand ? [item.sourceCommand] : []),
      ...nextSteps.flatMap((step) => step.command ? [step.command] : [])
    ])),
    nextSteps,
    conflicts,
    missingRequired,
    items
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

function globalQueuesView(work: WorkItemView): GlobalWorkQueuesView {
  return {
    queues: [
      {
        id: "ready",
        title: "Ready to claim",
        count: 1,
        items: [
          {
            id: `project-gallery:${work.id}`,
            projectId: "project-gallery",
            projectName: "Gallery Project",
            projectRoot: "/repo/gallery",
            work,
            claimCommand: `bwrk --workspace /repo/gallery work reserve ${work.id} --purpose 'Claim from Boreal Console' --json`
          }
        ]
      },
      { id: "blocked", title: "Blocked", count: 0, items: [] },
      { id: "needs_verification", title: "Needs verification", count: 0, items: [] }
    ],
    summary: {
      total: 1,
      ready: 1,
      blocked: 0,
      needsVerification: 0
    }
  };
}

function globalSearchView(work: WorkItemView): GlobalSearchView {
  return {
    query: "component import",
    count: 1,
    results: [
      {
        id: `project-gallery:work:${work.id}`,
        projectId: "project-gallery",
        projectName: "Gallery Project",
        projectRoot: "/repo/gallery",
        sourceKind: "work",
        recordId: work.id,
        title: work.title,
        summary: "Gallery search result with explicit project and source kind.",
        score: 18.2
      }
    ]
  };
}

function globalActivityView(): GlobalActivityView {
  return {
    items: [
      activityItem("human", "cybertron", "work list"),
      activityItem("agent", "codex", "agent start"),
      activityItem("system", "system", "sync refresh")
    ],
    summary: {
      total: 3,
      human: 1,
      agent: 1,
      system: 1,
      unknown: 0,
      failed: 0,
      stateChanged: 1,
      generatedArtifactsChanged: 1
    }
  };
}

function globalHealthView(): GlobalHealthView {
  return {
    projects: [
      {
        projectId: "project-gallery",
        projectName: "Gallery Project",
        projectRoot: "/repo/gallery",
        memoryRoot: "/repo/gallery/memory",
        health: "warning",
        stale: true,
        syncFreshness: "stale",
        syncOk: false,
        vaultOk: true,
        ledgersOk: false,
        searchIndexOk: true,
        gitOk: true,
        findingCount: 2
      }
    ],
    findings: [
      {
        id: "project-gallery:ledger.export_drift",
        projectId: "project-gallery",
        projectName: "Gallery Project",
        projectRoot: "/repo/gallery",
        workspaceRoot: "/repo/gallery",
        category: "ledger",
        code: "ledger.export_drift",
        title: "ledger.export_drift",
        severity: "warning",
        status: "warning",
        message: "JSONL ledger export is stale.",
        sourcePath: "/repo/gallery/.boreal/ledgers",
        actions: [
          {
            label: "Refresh projections",
            command: "bwrk --workspace /repo/gallery sync refresh --json",
            mutatesState: true,
            requiresConfirmation: true
          }
        ]
      }
    ],
    driftGroups: [
      {
        category: "ledger",
        title: "Ledgers and snapshots",
        count: 1,
        findings: [
          {
            id: "project-gallery:ledger.export_drift",
            projectId: "project-gallery",
            projectName: "Gallery Project",
            projectRoot: "/repo/gallery",
            workspaceRoot: "/repo/gallery",
            category: "ledger",
            code: "ledger.export_drift",
            title: "ledger.export_drift",
            severity: "warning",
            status: "warning",
            message: "JSONL ledger export is stale.",
            sourcePath: "/repo/gallery/.boreal/ledgers",
            actions: [
              {
                label: "Refresh projections",
                command: "bwrk --workspace /repo/gallery sync refresh --json",
                mutatesState: true,
                requiresConfirmation: true
              }
            ]
          }
        ]
      }
    ],
    summary: {
      totalProjects: 1,
      healthyProjects: 0,
      warningProjects: 1,
      errorProjects: 0,
      staleProjects: 1,
      findings: 1,
      errors: 0,
      warnings: 1,
      fixableActions: 1,
      lockFindings: 0,
      searchFindings: 0,
      ledgerFindings: 1,
      setupFindings: 0
    }
  };
}

function activityItem(actorKind: "human" | "agent" | "system", actorId: string, commandPath: string) {
  return {
    id: `project-gallery:${commandPath}`,
    projectId: "project-gallery",
    projectName: "Gallery Project",
    projectRoot: "/repo/gallery",
    sessionId: "local",
    commandPath,
    status: "succeeded",
    exitCode: 0,
    stateChanged: actorKind === "agent",
    generatedArtifactsChanged: actorKind === "system",
    actorId,
    actorKind,
    startedAt: "2026-06-27T00:00:00.000Z",
    finishedAt: "2026-06-27T00:00:01.000Z",
    eventCount: actorKind === "human" ? 0 : 1
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
      staleProjects: 0,
      openWorkCount: 3,
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
