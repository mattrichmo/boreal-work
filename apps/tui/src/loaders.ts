// Per-route loaders: `TuiRouteRequest -> Promise<TuiEnvelope<TBody>>`. No
// composite payload (see the v1 plan) -- each route fetches only what it
// needs, and Task Detail is fetched on demand (never preloaded for a whole
// list).

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  buildCommandDescriptor,
  buildProjectRegistryView,
  buildRepoRollupView,
  buildSprintBoardView,
  buildTuiEnvelope,
  toWorkItemView,
  childWorkIds,
  computeScopeIds,
  type GlobalWorkQueuesView,
  type ProjectRegistryView,
  type ProjectRegistryEntry,
  type RepoRollupView,
  type SprintBoardView,
  type TuiCommandDescriptor,
  type TuiEnvelope,
  type TuiRouteRequest,
  type WorkItemView
} from "@boreal/ui-model";
import type { WorkItem } from "@boreal/core";

import { activeReservationViewsByWorkId, readRepoWorkGraph } from "./repo-store.js";

const execFileAsync = promisify(execFile);
const CLI_BIN = process.env.BOREAL_TUI_CLI ?? "bwrk";

async function runCliJson<T>(args: readonly string[]): Promise<{ readonly data?: T; readonly error?: string }> {
  try {
    const { stdout } = await execFileAsync(CLI_BIN, [...args, "--json"], { maxBuffer: 32 * 1024 * 1024 });
    return JSON.parse(stdout) as { readonly data?: T };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

// ---------------------------------------------------------------------------
// Global routes: spawn the CLI, same pattern as the legacy load.ts.
// ---------------------------------------------------------------------------

export interface DashboardGlobalPayload {
  readonly generatedAt: string;
  readonly registry: ProjectRegistryView;
  readonly globalQueues: GlobalWorkQueuesView;
}

async function loadDashboardGlobal(workspaceRoot: string): Promise<{ readonly payload?: DashboardGlobalPayload; readonly error?: string }> {
  const result = await runCliJson<DashboardGlobalPayload>(["dashboard", "global", "--workspace", workspaceRoot]);
  if (result.error) return { error: result.error };
  return { payload: result.data };
}

export interface GlobalAttentionRow {
  readonly id: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly severity: "info" | "warning" | "error";
  readonly title: string;
  readonly message: string;
}

export interface GlobalOverviewBody {
  readonly registrySummary: ProjectRegistryView["summary"];
  readonly queueSummary: GlobalWorkQueuesView["summary"];
  readonly attention: readonly GlobalAttentionRow[];
}

export function attentionRowsFrom(entries: readonly ProjectRegistryEntry[]): readonly GlobalAttentionRow[] {
  return entries.flatMap((entry) =>
    entry.findings
      .filter((finding) => finding.severity !== "info")
      .map((finding): GlobalAttentionRow => ({
        id: `${entry.id}:${finding.code}`,
        projectId: entry.id,
        projectName: entry.name,
        severity: finding.severity,
        title: finding.title,
        message: finding.message
      }))
  );
}

/** Pure transform from the `dashboard global --json` payload shape to the
 * Overview route body -- kept separate from the CLI spawn so fixture JSON
 * can be parsed and asserted on without shelling out in tests. */
export function globalOverviewBodyFromPayload(payload: DashboardGlobalPayload): GlobalOverviewBody {
  return {
    registrySummary: payload.registry.summary,
    queueSummary: payload.globalQueues.summary,
    attention: attentionRowsFrom(payload.registry.entries)
  };
}

export async function loadGlobalOverview(workspaceRoot: string): Promise<TuiEnvelope<GlobalOverviewBody>> {
  const generatedAt = new Date().toISOString();
  const { payload, error } = await loadDashboardGlobal(workspaceRoot);
  if (!payload) {
    return buildTuiEnvelope({
      surface: "global",
      workspaceRoot,
      generatedAt,
      warnings: error ? [error] : [],
      body: { registrySummary: emptyRegistrySummary(), queueSummary: emptyQueueSummary(), attention: [] }
    });
  }
  return buildTuiEnvelope({
    surface: "global",
    workspaceRoot,
    generatedAt: payload.generatedAt,
    body: globalOverviewBodyFromPayload(payload)
  });
}

export async function loadGlobalProjects(workspaceRoot: string): Promise<TuiEnvelope<ProjectRegistryView>> {
  const generatedAt = new Date().toISOString();
  const { payload, error } = await loadDashboardGlobal(workspaceRoot);
  if (!payload) {
    return buildTuiEnvelope({
      surface: "global",
      workspaceRoot,
      generatedAt,
      warnings: error ? [error] : [],
      body: buildProjectRegistryView({ entries: [] })
    });
  }
  return buildTuiEnvelope({ surface: "global", workspaceRoot, generatedAt: payload.generatedAt, body: payload.registry });
}

export async function loadGlobalQueues(workspaceRoot: string): Promise<TuiEnvelope<GlobalWorkQueuesView>> {
  const generatedAt = new Date().toISOString();
  const { payload, error } = await loadDashboardGlobal(workspaceRoot);
  if (!payload) {
    return buildTuiEnvelope({
      surface: "global",
      workspaceRoot,
      generatedAt,
      warnings: error ? [error] : [],
      body: { queues: [], summary: emptyQueueSummary() }
    });
  }
  return buildTuiEnvelope({ surface: "global", workspaceRoot, generatedAt: payload.generatedAt, body: payload.globalQueues });
}

function emptyRegistrySummary(): ProjectRegistryView["summary"] {
  return {
    totalProjects: 0,
    healthyProjects: 0,
    warningProjects: 0,
    errorProjects: 0,
    missingProjects: 0,
    staleProjects: 0,
    openWorkCount: 0,
    readyWorkCount: 0,
    blockedWorkCount: 0,
    activeReservationCount: 0
  };
}

function emptyQueueSummary(): GlobalWorkQueuesView["summary"] {
  return { total: 0, ready: 0, blocked: 0, needsVerification: 0 };
}

// ---------------------------------------------------------------------------
// Repo routes: direct store read (see repo-store.ts for why).
// ---------------------------------------------------------------------------

function rollupActionsForWork(workspaceRoot: string, work: WorkItem): readonly TuiCommandDescriptor[] {
  const subject = { kind: "task" as const, id: work.meta.id, workspaceRoot, label: work.title };
  if (work.status === "ready") {
    return [
      buildCommandDescriptor({
        id: `work.reserve:${work.meta.id}`,
        label: "Claim",
        workspaceRoot,
        subject,
        argv: ["work", "reserve", work.meta.id],
        effect: "write"
      })
    ];
  }
  return [];
}

export async function loadRepoRollup(workspaceRoot: string): Promise<TuiEnvelope<RepoRollupView>> {
  const generatedAt = new Date().toISOString();
  const graph = await readRepoWorkGraph(workspaceRoot);
  if (!graph.initialized) {
    return buildTuiEnvelope({
      surface: "repo",
      workspaceRoot,
      generatedAt,
      warnings: ["Workspace is not initialized. Run `bwrk init` in this directory."],
      body: buildRepoRollupView({ workspaceRoot, generatedAt, projectName: "(uninitialized)", work: [], graphEdges: [] })
    });
  }
  const reservationsByWorkId = activeReservationViewsByWorkId(graph.reservations);
  const body = buildRepoRollupView({
    workspaceRoot,
    generatedAt,
    projectName: workspaceRoot.split("/").filter(Boolean).at(-1) ?? workspaceRoot,
    work: graph.items,
    graphEdges: graph.graphEdges,
    reservationsByWorkId,
    actionsForWork: (work) => rollupActionsForWork(workspaceRoot, work)
  });
  return buildTuiEnvelope({ surface: "repo", workspaceRoot, generatedAt, body });
}

export interface RepoSprintRow {
  readonly view: WorkItemView;
  readonly scopeCount: number;
  readonly active: boolean;
}

export interface RepoSprintBoardBody {
  readonly sprints: readonly RepoSprintRow[];
  readonly activeSprintId?: string;
  readonly selectedSprintId?: string;
  readonly board?: SprintBoardView;
}

export async function loadRepoSprintBoard(
  workspaceRoot: string,
  selectedSprintId?: string
): Promise<TuiEnvelope<RepoSprintBoardBody>> {
  const generatedAt = new Date().toISOString();
  const graph = await readRepoWorkGraph(workspaceRoot);
  if (!graph.initialized) {
    return buildTuiEnvelope({
      surface: "repo",
      workspaceRoot,
      generatedAt,
      warnings: ["Workspace is not initialized. Run `bwrk init` in this directory."],
      body: { sprints: [] }
    });
  }
  const byId = new Map<string, WorkItem>(graph.items.map((item) => [item.meta.id, item]));
  const views = graph.items.map((work) => toWorkItemView({ work, dependencies: graph.items }));
  const viewById = new Map(views.map((view) => [view.id, view]));
  const activeProjectionSprintId: string | undefined = undefined; // no CLI projection read here; active marker below is best-effort.
  const sprintItems = graph.items.filter((item) => item.kind === "sprint");
  const sprints: RepoSprintRow[] = sprintItems
    .map((sprintItem) => {
      const view = viewById.get(sprintItem.meta.id) ?? toWorkItemView({ work: sprintItem });
      const scope = computeScopeIds(sprintItem.meta.id, byId, graph.graphEdges);
      return { view, scopeCount: scope.size, active: sprintItem.meta.id === activeProjectionSprintId };
    })
    .sort((a, b) => Number(b.active) - Number(a.active) || a.view.title.localeCompare(b.view.title));

  const target = selectedSprintId ?? sprints.find((row) => row.active)?.view.id ?? sprints[0]?.view.id;
  let board: SprintBoardView | undefined;
  if (target) {
    const sprintItem = byId.get(target);
    const sprintView = viewById.get(target);
    if (sprintItem && sprintView) {
      const scope = computeScopeIds(target, byId, graph.graphEdges);
      const scopedViews = views.filter((view) => scope.has(view.id));
      board = buildSprintBoardView({
        sprint: sprintView,
        work: scopedViews,
        reservations: graph.reservations.map((reservation) => ({
          id: reservation.meta.id,
          workId: reservation.workId,
          status: reservation.status,
          agentId: reservation.agentId,
          reservedAt: reservation.reservedAt,
          expiresAt: reservation.expiresAt
        })),
        generatedAt
      });
    }
  }

  return buildTuiEnvelope({
    surface: "repo",
    workspaceRoot,
    generatedAt,
    body: { sprints, activeSprintId: activeProjectionSprintId, selectedSprintId: target, board }
  });
}

export interface RepoTaskDetailBody {
  readonly work: WorkItemView;
  readonly dependencyTitles: readonly string[];
  readonly actions: readonly TuiCommandDescriptor[];
}

export async function loadRepoTaskDetail(workspaceRoot: string, workId: string): Promise<TuiEnvelope<RepoTaskDetailBody> | undefined> {
  const generatedAt = new Date().toISOString();
  const graph = await readRepoWorkGraph(workspaceRoot);
  const target = graph.items.find((item) => item.meta.id === workId);
  if (!target) return undefined;
  const byId = new Map<string, WorkItem>(graph.items.map((item) => [item.meta.id, item]));
  const view = toWorkItemView({ work: target, dependencies: graph.items });
  const dependencyTitles = childWorkIds(target, graph.graphEdges).map((id) => byId.get(id)?.title ?? id);
  const subject = { kind: "task" as const, id: target.meta.id, workspaceRoot, label: target.title };
  const actions: TuiCommandDescriptor[] = [];
  if (target.status === "ready") {
    actions.push(
      buildCommandDescriptor({
        id: `work.reserve:${target.meta.id}`,
        label: "Claim work",
        workspaceRoot,
        subject,
        argv: ["work", "reserve", target.meta.id],
        effect: "write"
      })
    );
  }
  if (target.status === "in_progress" || target.status === "reserved") {
    actions.push(
      buildCommandDescriptor({
        id: `work.close:${target.meta.id}`,
        label: "Close work",
        workspaceRoot,
        subject,
        argv: ["work", "close", target.meta.id, "--reason", "closed from TUI"],
        effect: "danger"
      })
    );
  }
  return buildTuiEnvelope({ surface: "repo", workspaceRoot, generatedAt, body: { work: view, dependencyTitles, actions } });
}

// ---------------------------------------------------------------------------
// Dispatch.
// ---------------------------------------------------------------------------

export async function loadRoute(request: TuiRouteRequest): Promise<TuiEnvelope<unknown>> {
  switch (request.routeId) {
    case "global.overview":
      return loadGlobalOverview(request.workspaceRoot);
    case "global.projects":
      return loadGlobalProjects(request.workspaceRoot);
    case "global.queues":
      return loadGlobalQueues(request.workspaceRoot);
    case "repo.rollup":
      return loadRepoRollup(request.workspaceRoot);
    case "repo.sprintBoard":
      return loadRepoSprintBoard(request.workspaceRoot, request.entity?.id);
    case "repo.taskDetail": {
      if (!request.entity?.id) throw new Error("repo.taskDetail requires an entity id");
      const envelope = await loadRepoTaskDetail(request.workspaceRoot, request.entity.id);
      if (!envelope) throw new Error(`work item ${request.entity.id} not found`);
      return envelope;
    }
    default:
      throw new Error(`no loader registered for route ${request.routeId}`);
  }
}
