import { describe, expect, it } from "vitest";

import type { WorkItem } from "@boreal/core";
import type { WorkItemView } from "@boreal/ui-model";
import { buildCommandDescriptor, buildRepoRollupView } from "@boreal/ui-model";
import {
  defaultRollupDisclosure,
  hiddenRollupDescendantCount,
  rollupNodeCanOpen,
  toggleRollupDisclosure,
  visibleRollupRows,
  fullRollupStatusLabel
} from "../../apps/tui/src/routes/rollup.js";
import { sprintSelectionRows, fullSprintStatusLabel } from "../../apps/tui/src/routes/sprint-board.js";
import {
  boundedTextLines,
  fullTaskStatusLabel,
  reservationDisplay,
  taskActionDisplay
} from "../../apps/tui/src/routes/task-detail.js";
import { globalRouteState, globalStatusLabels } from "../../apps/tui/src/routes/global-overview.js";
import { fullQueueStatusLabel } from "../../apps/tui/src/routes/global-queues.js";
import type { RepoSprintBoardBody } from "../../apps/tui/src/loaders.js";

const actor = { id: "tui-route-test", kind: "agent" as const };

function view(input: Partial<WorkItemView> = {}): WorkItemView {
  return {
    id: "bw_work_route_test",
    title: "Route test work",
    kind: "task",
    status: "ready",
    priority: "normal",
    labels: [],
    dependencyIds: [],
    activeBlockerIds: [],
    blockedBy: [],
    evidenceCount: 0,
    verificationCount: 0,
    requiredCloseoutGates: [],
    ...input
  };
}

function work(input: { readonly id: string; readonly title: string; readonly kind: WorkItem["kind"]; readonly parentId?: string }): WorkItem {
  return {
    meta: {
      id: input.id as WorkItem["meta"]["id"],
      schemaVersion: "boreal.work.v1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      createdBy: actor,
      updatedBy: actor,
      sourceRefs: [],
      tags: []
    },
    kind: input.kind,
    title: input.title,
    description: "",
    status: "draft",
    priority: "normal",
    acceptanceCriteria: [],
    labels: [],
    parentId: input.parentId as WorkItem["parentId"],
    dependencyIds: [],
    evidenceIds: [],
    verificationIds: []
  };
}

describe("route-local project/global UX helpers", () => {
  it("supports controlled rollup disclosure and identifies hidden descendants", () => {
    const milestone = work({ id: "bw_milestone_route", title: "Milestone", kind: "milestone" });
    const task = work({ id: "bw_task_route", title: "Nested task", kind: "task", parentId: milestone.meta.id });
    const body = buildRepoRollupView({
      workspaceRoot: "/repo",
      generatedAt: "2026-01-01T00:00:00.000Z",
      projectName: "route-test",
      work: [milestone, task],
      graphEdges: []
    });
    const byId = new Map(body.flatRows.map((node) => [node.id, node]));
    const milestoneNode = byId.get(milestone.meta.id);
    expect(milestoneNode).toBeDefined();
    if (!milestoneNode) return;

    const defaults = defaultRollupDisclosure(body);
    expect(defaults.has(milestone.meta.id)).toBe(true);
    expect(hiddenRollupDescendantCount(milestoneNode, byId, new Set())).toBe(1);
    expect(visibleRollupRows(body, undefined, new Set()).map((node) => node.id)).toEqual([milestone.meta.id]);
    const expanded = toggleRollupDisclosure(new Set(), milestone.meta.id);
    expect(visibleRollupRows(body, undefined, expanded).map((node) => node.id)).toEqual([milestone.meta.id, task.meta.id]);
    expect(rollupNodeCanOpen(milestoneNode)).toBe(false);
    expect(fullRollupStatusLabel("needs_verification")).toBe("needs verification");
  });

  it("keeps a selected sprint inside a bounded selector window", () => {
    const body: RepoSprintBoardBody = {
      sprints: Array.from({ length: 7 }, (_, index) => ({
        view: view({ id: `bw_sprint_${index}`, kind: "sprint", title: `Sprint ${index}` }),
        scopeCount: index,
        active: index === 4
      })),
      selectedSprintId: "bw_sprint_4"
    };
    const selected = sprintSelectionRows(body, 3);
    expect(selected).toHaveLength(3);
    expect(selected.some((sprint) => sprint.view.id === body.selectedSprintId)).toBe(true);
    expect(fullSprintStatusLabel("in_progress")).toBe("in progress");
  });

  it("bounds detail text without splitting emoji and makes reservation actions honest", () => {
    const lines = boundedTextLines("😀abcdef", 3, 1);
    expect(lines).toEqual(["😀…"]);
    expect(boundedTextLines("😀abcdef", 4, 1)).toEqual(["😀a…"]);
    expect(boundedTextLines("👩‍💻abcdef", 3, 1)).toEqual(["👩‍💻…"]);
    expect(Array.from(lines[0] ?? "")).not.toContain("�");

    const task = view({
      status: "reserved",
      activeReservationId: "bw_reservation_route",
      activeReservation: { id: "bw_reservation_route", agentId: "agent-a" }
    });
    const action = buildCommandDescriptor({
      id: `work.close:${task.id}`,
      label: "Close work",
      workspaceRoot: "/repo",
      argv: ["work", "close", task.id],
      effect: "danger"
    });
    expect(reservationDisplay(task)).toMatchObject({ label: "active · agent-a" });
    expect(taskActionDisplay(action, task)).toMatchObject({ disabled: true });
    expect(taskActionDisplay(action, view({ activeReservationId: "bw_reservation_unhydrated" }))).toMatchObject({ disabled: true });
    expect(fullTaskStatusLabel("needs_verification")).toBe("needs verification");
  });

  it("surfaces global data-quality state and preserves full queue status labels", () => {
    const state = globalRouteState({ stale: true, truncated: { projects: true }, warnings: ["dashboard sampled"] });
    expect(state).toMatchObject({ stale: true, truncated: true, warnings: ["dashboard sampled"] });
    expect(globalStatusLabels({ ...state, missing: true })).toEqual(["stale", "sampled/truncated", "missing projects"]);
    expect(fullQueueStatusLabel("needs_verification")).toBe("needs verification");
  });
});
