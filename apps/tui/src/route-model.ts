import type { TuiEnvelope, TuiEntityKind, TuiFilterState, ProjectRegistryView, GlobalWorkQueuesView, RepoRollupView } from "@boreal/ui-model";
import { loadGlobalOverview, loadGlobalProjects, loadGlobalQueues, loadRepoMilestones, loadRepoNow, loadRepoOps, loadRepoRollup, loadRepoSprintBoard, loadRepoTaskDetail, loadRepoWork, type GlobalOverviewBody, type RepoMilestonesBody, type RepoNowBody, type RepoOpsBody, type RepoSprintBoardBody, type RepoTaskDetailBody, type RepoWorkBody } from "./loaders.js";
import { visibleRollupStructureRows, type RollupDisclosureState } from "./routes/rollup.js";
import { visibleSprintRows } from "./routes/sprint-board.js";
import { visibleWorkRows } from "./routes/repo-sections.js";
import { filteredQueueItems } from "./routes/global-queues.js";

export type RouteBody =
  | { readonly kind: "global.overview"; readonly value: GlobalOverviewBody }
  | { readonly kind: "global.projects"; readonly value: ProjectRegistryView }
  | { readonly kind: "global.queues"; readonly value: GlobalWorkQueuesView }
  | { readonly kind: "repo.now"; readonly value: RepoNowBody }
  | { readonly kind: "repo.rollup"; readonly value: RepoRollupView }
  | { readonly kind: "repo.milestones"; readonly value: RepoMilestonesBody }
  | { readonly kind: "repo.sprints"; readonly value: RepoSprintBoardBody }
  | { readonly kind: "repo.work"; readonly value: RepoWorkBody }
  | { readonly kind: "repo.ops"; readonly value: RepoOpsBody }
  | { readonly kind: "repo.sprintBoard"; readonly value: RepoSprintBoardBody }
  | { readonly kind: "repo.taskDetail"; readonly value: RepoTaskDetailBody };
export async function loadForFrame(
  workspaceRoot: string,
  routeId: string,
  entityId: string | undefined,
  entityKind?: TuiEntityKind,
  signal?: AbortSignal
): Promise<{ readonly envelope: TuiEnvelope<unknown>; readonly body: RouteBody } | undefined> {
  switch (routeId) {
    case "global.overview": {
      const envelope = await loadGlobalOverview(workspaceRoot, signal);
      return { envelope, body: { kind: "global.overview", value: envelope.body } };
    }
    case "global.projects": {
      const envelope = await loadGlobalProjects(workspaceRoot, signal);
      return { envelope, body: { kind: "global.projects", value: envelope.body } };
    }
    case "global.queues": {
      const envelope = await loadGlobalQueues(workspaceRoot, signal);
      return { envelope, body: { kind: "global.queues", value: envelope.body } };
    }
    case "repo.now": {
      const envelope = await loadRepoNow(workspaceRoot);
      return { envelope, body: { kind: "repo.now", value: envelope.body } };
    }
    case "repo.rollup": {
      const envelope = await loadRepoRollup(workspaceRoot);
      return { envelope, body: { kind: "repo.rollup", value: envelope.body } };
    }
    case "repo.milestones": {
      const envelope = await loadRepoMilestones(workspaceRoot);
      return { envelope, body: { kind: "repo.milestones", value: envelope.body } };
    }
    case "repo.sprints": {
      const envelope = await loadRepoSprintBoard(workspaceRoot);
      return { envelope, body: { kind: "repo.sprints", value: envelope.body } };
    }
    case "repo.work": {
      const envelope = await loadRepoWork(workspaceRoot);
      return { envelope, body: { kind: "repo.work", value: envelope.body } };
    }
    case "repo.ops": {
      const envelope = await loadRepoOps(workspaceRoot);
      return { envelope, body: { kind: "repo.ops", value: envelope.body } };
    }
    case "repo.sprintBoard": {
      const envelope = await loadRepoSprintBoard(workspaceRoot, entityId);
      return { envelope, body: { kind: "repo.sprintBoard", value: envelope.body } };
    }
    case "repo.taskDetail": {
      if (!entityId) return undefined;
      const envelope = await loadRepoTaskDetail(workspaceRoot, entityId, entityKind);
      if (!envelope) return undefined;
      return { envelope, body: { kind: "repo.taskDetail", value: envelope.body } };
    }
    default:
      return undefined;
  }
}

export function selectedRowCursor(ids: readonly string[], selectedId: string | undefined, fallback: number): number {
  const index = selectedId === undefined ? -1 : ids.indexOf(selectedId);
  return index >= 0 ? index : Math.max(0, Math.min(fallback, ids.length - 1));
}

export function activeRowIds(body: RouteBody | undefined, filters?: TuiFilterState, expandedIds?: RollupDisclosureState): readonly string[] {
  if (!body) return [];
  switch (body.kind) {
    case "repo.now": return body.value.rows.map((row) => row.id);
    case "repo.rollup": return visibleRollupStructureRows(body.value, filters, expandedIds).map((row) => row.id);
    case "repo.milestones": return body.value.milestones.map((row) => row.id);
    case "repo.sprints": return body.value.sprints.map((row) => row.view.id);
    case "repo.work": return visibleWorkRows(body.value, filters).map((row) => row.id);
    case "repo.ops": return body.value.reservations.map((row) => row.id);
    case "repo.sprintBoard": return visibleSprintRows(body.value, filters).map((row) => row.id);
    case "repo.taskDetail": return body.value.actions.map((action) => action.id);
    case "global.projects": return body.value.entries.map((row) => row.id);
    case "global.queues": return filteredQueueItems(body.value, filters).map((row) => `${row.projectId}:${row.work.id}`);
    case "global.overview": return body.value.attention.map((row) => row.id);
  }
}
