import { describe, expect, it } from "vitest";

import {
  buildCommandDescriptor,
  buildRepoRollupView,
  childWorkIds,
  computeScopeIds,
  type RollupNodeView
} from "@boreal/ui-model";
import type { GraphEdge, GraphEdgeId, WorkId, WorkItem } from "@boreal/core";

function meta(id: string) {
  return {
    id: id as WorkId,
    schemaVersion: "boreal.work.v1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    createdBy: { id: "agent-a", kind: "agent" as const },
    updatedBy: { id: "agent-a", kind: "agent" as const },
    sourceRefs: [],
    tags: []
  };
}

function work(input: {
  readonly id: string;
  readonly title: string;
  readonly kind: WorkItem["kind"];
  readonly status: WorkItem["status"];
  readonly parentId?: string;
  readonly dependencyIds?: readonly string[];
}): WorkItem {
  return {
    meta: meta(input.id),
    kind: input.kind,
    title: input.title,
    description: "",
    status: input.status,
    priority: "normal",
    acceptanceCriteria: [],
    labels: [],
    parentId: input.parentId as WorkId | undefined,
    dependencyIds: (input.dependencyIds ?? []) as readonly WorkId[],
    evidenceIds: [],
    verificationIds: []
  };
}

function blocksEdge(id: string, fromId: string, toId: string): GraphEdge {
  return {
    meta: meta(id) as unknown as GraphEdge["meta"] & { id: GraphEdgeId },
    kind: "blocks",
    fromId,
    fromType: "work",
    toId,
    toType: "work",
    directed: true
  };
}

describe("tui-contracts: buildCommandDescriptor", () => {
  it("always includes workspaceRoot", () => {
    const descriptor = buildCommandDescriptor({
      id: "work.list",
      label: "List work",
      workspaceRoot: "/repo",
      argv: ["work", "list", "--json"],
      effect: "read"
    });
    expect(descriptor.workspaceRoot).toBe("/repo");
    expect(descriptor.displayCommand).toBe("bwrk work list --json");
  });

  it("requires confirmation for write and danger effects but not read", () => {
    const read = buildCommandDescriptor({
      id: "work.show",
      label: "Show",
      workspaceRoot: "/repo",
      argv: ["work", "show", "bw_work_1"],
      effect: "read"
    });
    const write = buildCommandDescriptor({
      id: "work.reserve",
      label: "Reserve",
      workspaceRoot: "/repo",
      argv: ["work", "reserve", "bw_work_1"],
      effect: "write"
    });
    const danger = buildCommandDescriptor({
      id: "work.cancel",
      label: "Cancel",
      workspaceRoot: "/repo",
      argv: ["work", "cancel", "bw_work_1"],
      effect: "danger"
    });
    expect(read.requiresConfirmation).toBe(false);
    expect(read.mutatesState).toBe(false);
    expect(write.requiresConfirmation).toBe(true);
    expect(write.mutatesState).toBe(true);
    expect(danger.requiresConfirmation).toBe(true);
  });
});

describe("tui-contracts: scope/child derivation", () => {
  it("computes scope ids from dependencyIds plus blocks edges, matching sprint scope traversal", () => {
    const sprint = work({ id: "bw_sprint_1", title: "Sprint", kind: "sprint", status: "in_progress", dependencyIds: ["bw_task_1"] });
    const task1 = work({ id: "bw_task_1", title: "Task 1", kind: "task", status: "ready" });
    const task2 = work({ id: "bw_task_2", title: "Task 2", kind: "task", status: "ready" });
    const byId = new Map<string, WorkItem>([
      [sprint.meta.id, sprint],
      [task1.meta.id, task1],
      [task2.meta.id, task2]
    ]);
    const edges = [blocksEdge("bw_edge_1", "bw_task_2", "bw_task_1")];
    expect(childWorkIds(sprint, edges)).toEqual(["bw_task_1"]);
    const scope = computeScopeIds(sprint.meta.id, byId, edges);
    expect([...scope].sort()).toEqual(["bw_task_1", "bw_task_2"]);
  });
});

describe("tui-contracts: buildRepoRollupView", () => {
  it("builds parent/child hierarchy from parentId and sprint-scope attachment for unparented work", () => {
    const milestone = work({ id: "bw_milestone_1", title: "Milestone A", kind: "milestone", status: "ready" });
    const sprint = work({
      id: "bw_sprint_1",
      title: "Sprint 1",
      kind: "sprint",
      status: "in_progress",
      parentId: "bw_milestone_1",
      dependencyIds: ["bw_task_1"]
    });
    const parentedTask = work({ id: "bw_task_2", title: "Direct task", kind: "task", status: "closed", parentId: "bw_milestone_1" });
    const scopedTask = work({ id: "bw_task_1", title: "Scoped task", kind: "task", status: "ready" });
    const orphanTask = work({ id: "bw_task_3", title: "Orphan task", kind: "task", status: "cancelled" });

    const rollup = buildRepoRollupView({
      workspaceRoot: "/repo",
      generatedAt: "2026-01-01T00:00:00.000Z",
      projectName: "demo",
      work: [milestone, sprint, parentedTask, scopedTask, orphanTask],
      graphEdges: []
    });

    const byId = new Map(rollup.flatRows.map((node) => [node.id, node]));
    const milestoneNode = byId.get("bw_milestone_1") as RollupNodeView;
    const sprintNode = byId.get("bw_sprint_1") as RollupNodeView;
    expect(milestoneNode.childIds.sort()).toEqual(["bw_sprint_1", "bw_task_2"]);
    expect(sprintNode.childIds).toEqual(["bw_task_1"]);
    // orphanTask has no parentId and is in no sprint scope: attaches to the root.
    expect(rollup.root.childIds).toContain("bw_milestone_1");
    expect(rollup.root.childIds).toContain("bw_task_3");
    expect(rollup.root.childIds).not.toContain("bw_task_1");

    expect(rollup.summary.milestones).toBe(1);
    expect(rollup.summary.sprints).toBe(1);
    expect(rollup.summary.tasks).toBe(3);
    expect(rollup.summary.cancelled).toBe(1);
    expect(rollup.summary.closed).toBe(1);
  });

  it("treats verified/closed/cancelled as terminal for progress and reports cancelled separately", () => {
    const parent = work({ id: "bw_milestone_1", title: "Milestone", kind: "milestone", status: "ready" });
    const done = work({ id: "bw_task_1", title: "Done", kind: "task", status: "closed", parentId: "bw_milestone_1" });
    const verified = work({ id: "bw_task_2", title: "Verified", kind: "task", status: "verified", parentId: "bw_milestone_1" });
    const cancelled = work({ id: "bw_task_3", title: "Cancelled", kind: "task", status: "cancelled", parentId: "bw_milestone_1" });
    const open = work({ id: "bw_task_4", title: "Open", kind: "task", status: "ready", parentId: "bw_milestone_1" });

    const rollup = buildRepoRollupView({
      workspaceRoot: "/repo",
      generatedAt: "2026-01-01T00:00:00.000Z",
      projectName: "demo",
      work: [parent, done, verified, cancelled, open],
      graphEdges: []
    });

    const milestoneNode = rollup.flatRows.find((node) => node.id === "bw_milestone_1") as RollupNodeView;
    expect(milestoneNode.progress.total).toBe(4);
    expect(milestoneNode.progress.done).toBe(2);
    expect(milestoneNode.progress.cancelled).toBe(1);
    expect(milestoneNode.progress.open).toBe(1);
  });

  it("counts active blockers from unresolved dependency/blocks edges, not stale history", () => {
    const blocker = work({ id: "bw_task_blocker", title: "Blocker", kind: "task", status: "closed" });
    const blocked = work({ id: "bw_task_blocked", title: "Blocked", kind: "task", status: "blocked", dependencyIds: ["bw_task_blocker"] });
    const rollup = buildRepoRollupView({
      workspaceRoot: "/repo",
      generatedAt: "2026-01-01T00:00:00.000Z",
      projectName: "demo",
      work: [blocker, blocked],
      graphEdges: []
    });
    const blockedNode = rollup.flatRows.find((node) => node.id === "bw_task_blocked") as RollupNodeView;
    // blocker is already closed (terminal), so it should not count as an active blocker.
    expect(blockedNode.blockerSummary.activeBlockerCount).toBe(0);
  });
});
