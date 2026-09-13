import { describe, expect, it } from "vitest";
import type { RollupNodeView } from "@boreal/ui-model";

import type { RepoMilestonesBody, RepoNowBody, RepoNowRow } from "../../apps/tui/src/loaders.js";
import { nowScopeFilterLabel, visibleMilestoneRows, visibleNowRows } from "../../apps/tui/src/routes/repo-sections.js";

function node(id: string, kind: RollupNodeView["kind"], childIds: readonly string[] = [], parentId?: string): RollupNodeView {
  return {
    id,
    entity: { kind, id, workspaceRoot: "/repo", label: id },
    kind,
    title: id,
    workStatus: "ready",
    depth: parentId ? 2 : 1,
    ...(parentId ? { parentId } : {}),
    childIds,
    expandedByDefault: false,
    progress: { total: 1, done: 0, open: 1, cancelled: 0, percentDone: 0 },
    blockerSummary: { activeBlockerCount: 0, blockedDescendantCount: 0, blockerIds: [] },
    labels: [],
    stale: false,
    actions: []
  };
}

const summary = {
  totalNodes: 3,
  milestones: 1,
  sprints: 1,
  tasks: 1,
  open: 3,
  blocked: 0,
  needsVerification: 0,
  closed: 0,
  cancelled: 0,
  activeReservations: 0
};

describe("milestone and Now scope navigation", () => {
  it("expands milestone children and then nested sprint/task rows", () => {
    const task = node("task-1", "task", [], "sprint-1");
    const sprint = node("sprint-1", "sprint", [task.id], "milestone-1");
    const milestone = node("milestone-1", "milestone", [sprint.id]);
    const body: RepoMilestonesBody = {
      milestones: [milestone],
      summary,
      trees: [{ root: milestone, nodes: [sprint, task] }]
    };

    expect(visibleMilestoneRows(body).map((row) => row.node.id)).toEqual(["milestone-1"]);
    expect(visibleMilestoneRows(body, new Set(["milestone-1"])).map((row) => row.node.id)).toEqual(["milestone-1", "sprint-1"]);
    expect(visibleMilestoneRows(body, new Set(["milestone-1", "sprint-1"])).map((row) => row.node.id)).toEqual(["milestone-1", "sprint-1", "task-1"]);
  });

  it("uses uncapped rows when Now is scoped to a milestone or sprint", () => {
    const milestoneRow: RepoNowRow = { id: "next:task-1", lane: "next", node: node("task-1", "task"), milestoneId: "m1", milestoneTitle: "Milestone One", sprintId: "s1", sprintTitle: "Sprint One" };
    const sprintRow: RepoNowRow = { id: "next:task-2", lane: "next", node: node("task-2", "task"), sprintId: "s2", sprintTitle: "Sprint Two" };
    const body: RepoNowBody = {
      rows: [milestoneRow],
      allRows: [milestoneRow, sprintRow],
      scopes: [
        { kind: "milestone", id: "m1", title: "Milestone One", count: 1 },
        { kind: "sprint", id: "s2", title: "Sprint Two", count: 1 }
      ],
      summary,
      overflowCount: 1,
      workingCount: 0,
      attentionCount: 0,
      nextCount: 2
    };

    expect(visibleNowRows(body, { clauses: [{ field: "nowScope", operator: "is", value: "sprint:s2" }], sort: [] }).map((row) => row.node.id)).toEqual(["task-2"]);
    expect(nowScopeFilterLabel(body, { clauses: [{ field: "nowScope", operator: "is", value: "milestone:m1" }], sort: [] })).toBe("milestone: Milestone One");
  });
});
