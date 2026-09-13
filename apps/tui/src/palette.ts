import type {
  GlobalWorkQueuesView,
  ProjectRegistryView,
  RepoRollupView,
  TuiEntityRef,
  TuiEntityKind,
  WorkItemView,
  TuiCommandDescriptor
} from "@boreal/ui-model";
import type { RepoSprintBoardBody } from "./loaders.js";
import { fuzzyScore } from "./search.js";

export type PaletteKind = "route" | "sprint" | "task" | "issue" | "project" | "command";

export interface PaletteItem {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly kind: PaletteKind;
  readonly routeId: string;
  readonly entity?: TuiEntityRef;
  readonly projectId?: string;
  readonly workspaceRoot: string;
  readonly descriptors?: readonly TuiCommandDescriptor[];
}

export interface PaletteResult extends PaletteItem {
  readonly score: number;
}

export interface PaletteInput {
  readonly routes?: readonly { readonly id: string; readonly label: string; readonly surface: "global" | "repo" }[];
  readonly workspaceRoot: string;
  readonly rollup?: RepoRollupView;
  readonly sprintBody?: RepoSprintBoardBody;
  readonly projects?: ProjectRegistryView;
  readonly queues?: GlobalWorkQueuesView;
  readonly commands?: readonly Pick<PaletteItem, "id" | "label" | "hint" | "workspaceRoot">[];
}

function entityFor(work: Pick<WorkItemView, "id" | "title" | "kind">, workspaceRoot: string, project?: { readonly id: string; readonly name: string }): TuiEntityRef {
  const kind: TuiEntityKind = ["milestone", "sprint", "task", "issue"].includes(work.kind) ? work.kind : "work";
  return { kind, id: work.id, workspaceRoot, label: work.title, ...(project ? { projectId: project.id, projectName: project.name, projectRoot: workspaceRoot } : {}) };
}

function addWork(items: PaletteItem[], work: Pick<WorkItemView, "id" | "title" | "kind">, workspaceRoot: string, hint: string, project?: { readonly id: string; readonly name: string }): void {
  const kind: PaletteKind | undefined = work.kind === "sprint" || work.kind === "task" || work.kind === "issue" ? work.kind : undefined;
  if (!kind) return;
  items.push({
    id: work.id,
    label: work.title,
    hint,
    kind,
    routeId: kind === "sprint" ? "repo.sprintBoard" : "repo.taskDetail",
    entity: entityFor(work, workspaceRoot, project),
    workspaceRoot
  });
}

export function buildPaletteItems(input: PaletteInput): readonly PaletteItem[] {
  const items: PaletteItem[] = [];
  for (const command of input.commands ?? []) {
    items.push({ ...command, kind: "command", routeId: "", workspaceRoot: command.workspaceRoot });
  }
  for (const route of input.routes ?? []) {
    items.push({ id: route.id, label: route.label, hint: route.surface, kind: "route", routeId: route.id, workspaceRoot: input.workspaceRoot });
  }
  for (const node of input.rollup?.flatRows ?? []) {
    if (node.kind === "sprint" || node.kind === "task" || node.kind === "issue") {
      addWork(items, { id: node.id, title: node.title, kind: node.kind }, input.workspaceRoot, `roll-up · ${node.kind}`);
    }
  }
  for (const sprint of input.sprintBody?.sprints ?? []) addWork(items, sprint.view, input.workspaceRoot, `sprint · ${sprint.active ? "active" : "available"}`);
  for (const task of input.sprintBody?.board?.lanes.flatMap((lane) => lane.items) ?? []) addWork(items, task, input.workspaceRoot, `sprint · ${task.status}`);
  for (const entry of input.projects?.entries ?? []) {
    items.push({
      id: entry.id,
      label: entry.name,
      hint: `project · ${entry.health}`,
      kind: "project",
      routeId: "global.projects",
      projectId: entry.id,
      workspaceRoot: entry.projectRoot,
      entity: { kind: "project", id: entry.id, workspaceRoot: entry.projectRoot, projectRoot: entry.projectRoot, projectId: entry.id, projectName: entry.name, label: entry.name }
    });
  }
  for (const queue of input.queues?.queues ?? []) {
    for (const row of queue.items) addWork(items, row.work, row.projectRoot, `${row.projectName} · ${queue.title}`, { id: row.projectId, name: row.projectName });
  }
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.workspaceRoot}\u0000${item.kind}\u0000${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function searchPalette(items: readonly PaletteItem[], query: string, limit = 40): readonly PaletteResult[] {
  const trimmed = query.trim();
  const scored = items.flatMap((item): PaletteResult[] => {
    const score = fuzzyScore(trimmed, `${item.label} ${item.hint}`);
    return score === null ? [] : [{ ...item, score }];
  });
  scored.sort((a, b) => a.score - b.score || a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  return scored.slice(0, Math.max(0, limit));
}
