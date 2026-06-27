import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

import { resolveWorkspacePaths, type GraphEdge, type WorkItem } from "@boreal/core";
import { createBorealRuntime } from "@boreal/engine";
import { FileBorealStore } from "@boreal/storage";
import {
  buildSprintBoardView,
  buildWorkDashboardView,
  toWorkItemView,
  type SprintBoardView,
  type WorkDashboardView,
  type WorkItemView
} from "@boreal/ui-model";

export interface TuiActivityEntry {
  readonly id: string;
  readonly type: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly at: string;
}

export interface TuiSprintData {
  readonly view: WorkItemView;
  readonly board: SprintBoardView;
  readonly scopeCount: number;
  readonly active: boolean;
}

// Mirrors the CLI's sprint scope: a work item's children are its dependencyIds
// plus any work that "blocks" it via a graph edge.
function childWorkIds(work: WorkItem, graphEdges: readonly GraphEdge[]): readonly string[] {
  const ids = new Set<string>(work.dependencyIds);
  for (const edge of graphEdges) {
    if (edge.kind === "blocks" && edge.fromType === "work" && edge.toType === "work" && edge.toId === work.meta.id) {
      ids.add(edge.fromId);
    }
  }
  return [...ids];
}

function sprintScopeIds(sprint: WorkItem, byId: Map<string, WorkItem>, graphEdges: readonly GraphEdge[]): Set<string> {
  const visited = new Set<string>();
  const visit = (workId: string): void => {
    if (visited.has(workId) || !byId.has(workId)) return;
    visited.add(workId);
    const work = byId.get(workId);
    if (work) {
      for (const childId of childWorkIds(work, graphEdges)) visit(childId);
    }
  };
  for (const childId of childWorkIds(sprint, graphEdges)) visit(childId);
  return visited;
}

export interface TuiData {
  readonly workspaceRoot: string;
  readonly generatedAt: string;
  readonly initialized: boolean;
  readonly work: WorkDashboardView;
  readonly sprints: readonly TuiSprintData[];
  readonly activeSprintId?: string;
  readonly activity: readonly TuiActivityEntry[];
  readonly warnings: readonly string[];
}

export function resolveWorkspaceRoot(explicit: string | undefined, cwd: string = process.cwd()): string {
  if (explicit) {
    return resolve(explicit.replace(/^~(?=$|\/)/u, homedir()));
  }
  let current = resolve(cwd);
  while (true) {
    if (existsSync(resolve(current, ".boreal"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return resolve(cwd);
    }
    current = parent;
  }
}

export interface GlobalProjectEntry {
  readonly id: string;
  readonly name: string;
  readonly projectRoot: string;
  readonly health: string;
  readonly stale: boolean;
  readonly open: number;
  readonly ready: number;
  readonly blocked: number;
  readonly reservations: number;
}

export interface GlobalTuiData {
  readonly generatedAt: string;
  readonly projects: readonly GlobalProjectEntry[];
  readonly warnings: readonly string[];
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

// Global mode reuses the same registry aggregation the browser global console
// uses (bwrk dashboard global --json), rather than re-reading every project store.
export async function loadGlobalTuiData(workspaceRoot: string): Promise<GlobalTuiData> {
  const generatedAt = new Date().toISOString();
  const cli = process.env.BOREAL_TUI_CLI ?? "bwrk";
  try {
    // The registry is the source of truth for whether any project is registered.
    // `dashboard global` falls back to the current repo when empty, so gate on
    // the registry directly to show a real empty state instead.
    const registry = await execFileAsync(cli, ["registry", "list", "--json"], { maxBuffer: 16 * 1024 * 1024 });
    const registryPayload = JSON.parse(registry.stdout) as { readonly data?: { readonly entryCount?: number } };
    if ((registryPayload.data?.entryCount ?? 0) === 0) {
      return { generatedAt, projects: [], warnings: [] };
    }
    const { stdout } = await execFileAsync(cli, ["dashboard", "global", "--json", "--workspace", workspaceRoot], {
      maxBuffer: 16 * 1024 * 1024
    });
    const payload = JSON.parse(stdout) as { readonly data?: { readonly registry?: { readonly entries?: readonly Record<string, unknown>[] } } };
    const entries = payload.data?.registry?.entries ?? [];
    const projects = entries.map((entry): GlobalProjectEntry => ({
      id: String(entry.id ?? ""),
      name: String(entry.name ?? entry.id ?? "project"),
      projectRoot: String(entry.projectRoot ?? ""),
      health: String(entry.health ?? "unknown"),
      stale: entry.stale === true,
      open: num(entry.openWorkCount),
      ready: num(entry.readyWorkCount),
      blocked: num(entry.blockedWorkCount),
      reservations: num(entry.activeReservationCount)
    }));
    return { generatedAt, projects, warnings: [] };
  } catch (error) {
    return { generatedAt, projects: [], warnings: [error instanceof Error ? error.message : String(error)] };
  }
}

export async function loadTuiData(workspaceRoot: string): Promise<TuiData> {
  const generatedAt = new Date().toISOString();
  const paths = resolveWorkspacePaths(workspaceRoot);
  const initialized = existsSync(paths.borealDir) && existsSync(paths.stateFile);
  if (!initialized) {
    return {
      workspaceRoot,
      generatedAt,
      initialized: false,
      work: buildWorkDashboardView({ work: [], generatedAt }),
      sprints: [],
      activity: [],
      warnings: ["Workspace is not initialized. Run `bwrk init` in this directory."]
    };
  }

  const warnings: string[] = [];
  const store = new FileBorealStore({ rootDir: workspaceRoot });
  const runtime = createBorealRuntime({ store });

  const [items, reservations, graphEdges, projections, events] = await Promise.all([
    store.read((reader) => reader.listWorkItems()),
    store.read((reader) => reader.listReservations()),
    store.read((reader) => reader.listGraphEdges()),
    store.read((reader) => reader.listProjections()),
    runtime.listEvents().catch((error: unknown) => {
      warnings.push(error instanceof Error ? error.message : String(error));
      return [] as const;
    })
  ]);

  const views = items.map((work) => toWorkItemView({ work, dependencies: items }));
  const work = buildWorkDashboardView({ work: views, reservations, generatedAt });

  const byId = new Map<string, WorkItem>(items.map((item) => [item.meta.id, item]));
  const activeProjection = projections.find(
    (projection) => projection.kind === "active-sprint" && projection.subjectId === "workspace"
  );
  const activeSprintId = typeof activeProjection?.value.sprintId === "string" ? activeProjection.value.sprintId : undefined;
  const sprints: readonly TuiSprintData[] = items
    .filter((item) => item.kind === "sprint")
    .map((sprintItem): TuiSprintData => {
      const view = toWorkItemView({ work: sprintItem, dependencies: items });
      const scopeIds = sprintScopeIds(sprintItem, byId, graphEdges);
      const scoped = views.filter((candidate) => scopeIds.has(candidate.id));
      return {
        view,
        scopeCount: scoped.length,
        active: sprintItem.meta.id === activeSprintId,
        board: buildSprintBoardView({ sprint: view, work: scoped, reservations, generatedAt })
      };
    })
    .sort((a, b) => Number(b.active) - Number(a.active) || a.view.title.localeCompare(b.view.title));

  const activity = [...events]
    .sort((a, b) => b.meta.createdAt.localeCompare(a.meta.createdAt))
    .slice(0, 10)
    .map((event) => ({
      id: event.meta.id,
      type: event.type,
      subjectType: event.subjectType,
      subjectId: event.subjectId,
      at: event.meta.createdAt
    }));

  return { workspaceRoot, generatedAt, initialized: true, work, sprints, activeSprintId, activity, warnings };
}
