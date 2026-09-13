import { describe, expect, it } from "vitest";

import { buildCommandDescriptor, buildSprintBoardView, type WorkItemView } from "@boreal/ui-model";
import { commandPanelLines } from "../../apps/tui/src/command-panel.js";
import { selectedRowCursor } from "../../apps/tui/src/shell.js";
import type { RepoSprintBoardBody } from "../../apps/tui/src/loaders.js";
import { visibleSprintRows } from "../../apps/tui/src/routes/sprint-board.js";

function work(id: string, status: WorkItemView["status"]): WorkItemView {
  return {
    id,
    title: id,
    kind: "task",
    status,
    priority: "normal",
    labels: [],
    dependencyIds: [],
    activeBlockerIds: [],
    blockedBy: [],
    evidenceCount: 0,
    verificationCount: 0,
    requiredCloseoutGates: []
  };
}

function body(): RepoSprintBoardBody {
  const sprint = work("sprint", "in_progress");
  const assignedOpen = work("assigned-open", "ready");
  const assignedDone = work("assigned-done", "closed");
  const dependencyOpen = work("dependency-open", "ready");
  const board = buildSprintBoardView({ sprint, work: [assignedOpen, assignedDone, dependencyOpen] });
  return {
    sprints: [{ view: sprint, scopeCount: 3, active: true }],
    selectedSprintId: sprint.id,
    activeSprintId: sprint.id,
    board,
    assignedWorkIds: [assignedOpen.id, assignedDone.id],
    dependencyWorkIds: [dependencyOpen.id]
  };
}

function filter(query: string, scope?: string) {
  return {
    query,
    clauses: scope ? [{ field: "scope", operator: "is" as const, value: scope }] : [],
    sort: []
  };
}

describe("TUI sprint workflow contract", () => {
  it("combines status and provenance filters as an intersection", () => {
    const sprint = body();
    expect(visibleSprintRows(sprint, filter("open", "assigned")).map((item) => item.id)).toEqual(["assigned-open"]);
    expect(visibleSprintRows(sprint, filter("open", "dependencies")).map((item) => item.id)).toEqual(["dependency-open"]);
    expect(visibleSprintRows(sprint, filter("complete", "assigned")).map((item) => item.id)).toEqual(["assigned-done"]);
  });

  it("keeps cursor anchored by row identity and falls back safely after deletion", () => {
    expect(selectedRowCursor(["a", "b", "c"], "b", 0)).toBe(1);
    expect(selectedRowCursor(["a", "c"], "b", 1)).toBe(1);
    expect(selectedRowCursor([], "b", 4)).toBe(0);
  });

  it("keeps long command failures reachable through the panel line model", () => {
    const descriptor = buildCommandDescriptor({
      id: "work.close:test",
      label: "Close work",
      workspaceRoot: "/repo",
      argv: ["work", "close", "task-1"],
      effect: "danger"
    });
    const error = "failed: " + "detail ".repeat(100);
    const lines = commandPanelLines(descriptor, 30, error);
    expect(lines.some((line) => line.includes("Failed:"))).toBe(true);
    expect(lines.at(-1)).toContain("detail");
  });
});
