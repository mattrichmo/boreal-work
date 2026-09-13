import { describe, expect, it } from "vitest";

import { bindingsForRoute, resolveRouteAction, routeFooterHints } from "../../apps/tui/src/route-bindings.js";
import { rollupFilterLabel, visibleRollupRows, ROLLUP_FILTER_CYCLE } from "../../apps/tui/src/routes/rollup.js";
import { filteredQueueItems, queueFilterLabel, QUEUE_FILTER_CYCLE } from "../../apps/tui/src/routes/global-queues.js";
import { visibleWorkRows } from "../../apps/tui/src/routes/repo-sections.js";
import { GLOBAL_ROUTES, REPO_ROUTES, railFor, routeById, routeByNumberKey } from "../../apps/tui/src/routes.js";
import type { RepoRollupView, RollupNodeView } from "@boreal/ui-model";
import type { GlobalWorkQueuesView } from "@boreal/ui-model";

function key(overrides: Partial<import("ink").Key> = {}): import("ink").Key {
  return {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    pageDown: false,
    pageUp: false,
    return: false,
    escape: false,
    ctrl: false,
    shift: false,
    tab: false,
    backspace: false,
    delete: false,
    meta: false,
    ...overrides
  };
}

function node(overrides: Partial<RollupNodeView> & Pick<RollupNodeView, "id">): RollupNodeView {
  return {
    entity: { kind: "task", id: overrides.id, workspaceRoot: "/repo", label: overrides.id },
    kind: "task",
    title: overrides.id,
    depth: 1,
    childIds: [],
    expandedByDefault: true,
    progress: { total: 1, done: 0, open: 1, cancelled: 0, percentDone: 0 },
    blockerSummary: { activeBlockerCount: 0, blockedDescendantCount: 0, blockerIds: [] },
    labels: [],
    stale: false,
    actions: [],
    ...overrides
  };
}

describe("route bindings: footer hints come from the same specs the dispatcher uses", () => {
  it("hides stub routes from rails and number keys while retaining them for diagnostics", () => {
    expect(railFor("global")).toEqual(GLOBAL_ROUTES);
    expect(railFor("repo")).toEqual(REPO_ROUTES);
    expect(railFor("global").some((route) => route.isStub)).toBe(false);
    expect(railFor("repo").some((route) => route.isStub)).toBe(false);
    expect(routeById("global.health")?.isStub).toBe(true);
    expect(routeByNumberKey("global", 6)).toBeUndefined();
    expect(REPO_ROUTES.map((route) => route.label)).toEqual(["Now", "Roll-Up", "Milestones", "Sprints", "Work", "Ops"]);
    expect(routeByNumberKey("repo", 1)?.id).toBe("repo.now");
    expect(routeById("repo.sprintBoard")?.isStub).not.toBe(true);
  });

  it("only offers the filter binding on routes with a status facet", () => {
    const rollupSpecs = bindingsForRoute("repo.rollup");
    const taskDetailSpecs = bindingsForRoute("repo.taskDetail");
    expect(rollupSpecs.some((spec) => spec.action === "filter")).toBe(true);
    expect(taskDetailSpecs.some((spec) => spec.action === "filter")).toBe(false);
    expect(taskDetailSpecs.some((spec) => spec.action === "toggleDisclosure")).toBe(true);
    expect(taskDetailSpecs.some((spec) => spec.action === "toggleFocus")).toBe(true);
    expect(bindingsForRoute("repo.work").some((spec) => spec.action === "filter")).toBe(true);
    expect(bindingsForRoute("repo.now").some((spec) => spec.action === "filter")).toBe(true);
    expect(bindingsForRoute("repo.milestones").some((spec) => spec.action === "toggleDisclosure")).toBe(true);
  });

  it("resolves the same action the footer hint advertises", () => {
    const specs = bindingsForRoute("repo.rollup");
    const hints = routeFooterHints(specs);
    expect(hints.some((hint) => hint.keys === "f" && hint.label === "filter")).toBe(true);
    expect(hints).toContainEqual({ keys: "space", label: "fold" });
    expect(hints).toContainEqual({ keys: "→/l", label: "expand" });
    expect(hints).toContainEqual({ keys: "←", label: "section rail" });
    expect(hints).toContainEqual({ keys: "h", label: "collapse" });
    expect(hints).toContainEqual({ keys: "a", label: "ready" });
    expect(resolveRouteAction(specs, "f", key())).toBe("filter");
    expect(resolveRouteAction(specs, "", key({ return: true }))).toBe("drill");
    expect(resolveRouteAction(specs, " ", key())).toBe("toggleDisclosure");
    expect(resolveRouteAction(specs, "", key({ rightArrow: true }))).toBe("expand");
    expect(resolveRouteAction(specs, "", key({ leftArrow: true }))).toBe("focusRail");
    expect(resolveRouteAction(specs, "a", key())).toBe("ready");
    expect(resolveRouteAction(specs, "5", key())).toBe("numberKey:5");

    const taskDetailSpecs = bindingsForRoute("repo.taskDetail");
    expect(routeFooterHints(taskDetailSpecs)).toContainEqual({ keys: "space", label: "fold" });
    expect(routeFooterHints(taskDetailSpecs)).toContainEqual({ keys: "tab", label: "focus" });
    expect(resolveRouteAction(taskDetailSpecs, " ", key())).toBe("toggleDisclosure");
    expect(resolveRouteAction(taskDetailSpecs, "", key({ tab: true }))).toBe("toggleFocus");
    expect(resolveRouteAction(taskDetailSpecs, "p", key())).toBe("togglePreview");
    expect(resolveRouteAction(taskDetailSpecs, "e", key())).toBe("toggleMaximize");
    expect(resolveRouteAction(taskDetailSpecs, "P", key())).toBe("toggleLayout");
    expect(resolveRouteAction(taskDetailSpecs, "x", key())).toBe("toggleXray");
    expect(resolveRouteAction(taskDetailSpecs, "v", key())).toBe("toggleSelect");
    expect(resolveRouteAction(taskDetailSpecs, "V", key())).toBe("selectAll");
    expect(resolveRouteAction(taskDetailSpecs, "b", key())).toBe("batch");
    expect(resolveRouteAction(taskDetailSpecs, ":", key())).toBe("commandPalette");
    expect(resolveRouteAction(taskDetailSpecs, "F", key())).toBe("toggleLive");
    expect(resolveRouteAction(taskDetailSpecs, "T", key())).toBe("theme");
  });

  it("advertises the overview finding drill that the shell handles", () => {
    const specs = bindingsForRoute("global.overview");
    expect(specs.some((spec) => spec.action === "drill")).toBe(true);
    expect(routeFooterHints(specs)).toContainEqual({ keys: "⏎", label: "open finding" });
    expect(resolveRouteAction(specs, "", key({ return: true }))).toBe("drill");
  });

  it("labels route-specific Enter actions and avoids duplicate footer hints", () => {
    const projectHints = routeFooterHints(bindingsForRoute("global.projects"));
    expect(projectHints).toContainEqual({ keys: "⏎", label: "open project" });
    expect(new Set(projectHints.map((hint) => `${hint.keys}:${hint.label}`)).size).toBe(projectHints.length);

    const actionHints = routeFooterHints(bindingsForRoute("repo.taskDetail"));
    expect(actionHints).toContainEqual({ keys: "⏎", label: "run action" });
  });
});

describe("repo section projections", () => {
  it("keeps the work section flat while cycling terminal status views", () => {
    const body = {
      items: [
        node({ id: "ready", workStatus: "ready" }),
        node({ id: "blocked", workStatus: "blocked" }),
        node({ id: "closed", workStatus: "closed" }),
        node({ id: "cancelled", workStatus: "cancelled" })
      ],
      summary: {
        totalNodes: 4,
        milestones: 0,
        sprints: 0,
        tasks: 4,
        open: 2,
        blocked: 1,
        needsVerification: 0,
        closed: 1,
        cancelled: 1,
        activeReservations: 0
      }
    };
    expect(visibleWorkRows(body).map((row) => row.id)).toEqual(["ready", "blocked"]);
    expect(visibleWorkRows(body, { query: "blocked", clauses: [], sort: [] }).map((row) => row.id)).toEqual(["blocked"]);
    expect(visibleWorkRows(body, { query: "all", clauses: [], sort: [] }).map((row) => row.id)).toEqual(["ready", "blocked", "closed"]);
  });
});

describe("rollup status facet", () => {
  it("hides closed/cancelled leaves through the filter cycle but keeps containers", () => {
    const closedLeaf = node({ id: "closed", workStatus: "closed" });
    const cancelledLeaf = node({ id: "cancelled", workStatus: "cancelled" });
    const openLeaf = node({ id: "open", workStatus: "ready" });
    const root: RollupNodeView = { ...node({ id: "__root__" }), kind: "project", childIds: ["closed", "cancelled", "open"], depth: 0 };
    const body: RepoRollupView = {
      generatedAt: "2026-01-01T00:00:00.000Z",
      workspaceRoot: "/repo",
      root,
      flatRows: [root, closedLeaf, cancelledLeaf, openLeaf],
      summary: {
        totalNodes: 3,
        milestones: 0,
        sprints: 0,
        tasks: 3,
        open: 1,
        blocked: 0,
        needsVerification: 0,
        closed: 1,
        cancelled: 1,
        activeReservations: 0
      }
    };

    expect(visibleRollupRows(body, ROLLUP_FILTER_CYCLE[0]).map((n) => n.id).sort()).toEqual(["cancelled", "closed", "open"]);
    expect(visibleRollupRows(body, ROLLUP_FILTER_CYCLE[1]).map((n) => n.id).sort()).toEqual(["cancelled", "open"]);
    expect(visibleRollupRows(body, ROLLUP_FILTER_CYCLE[2]).map((n) => n.id)).toEqual(["open"]);
    expect(rollupFilterLabel(ROLLUP_FILTER_CYCLE[2])).toBe("open only");
  });

  it("retains only milestones that have open descendants for the milestone preset", () => {
    const openTask = node({ id: "open-task", workStatus: "ready" });
    const closedTask = node({ id: "closed-task", workStatus: "closed" });
    const openMilestone: RollupNodeView = {
      ...node({ id: "open-milestone", kind: "milestone", childIds: [openTask.id] }),
      entity: { kind: "milestone", id: "open-milestone", workspaceRoot: "/repo", label: "open-milestone" }
    };
    const closedMilestone: RollupNodeView = {
      ...node({ id: "closed-milestone", kind: "milestone", childIds: [closedTask.id] }),
      entity: { kind: "milestone", id: "closed-milestone", workspaceRoot: "/repo", label: "closed-milestone" }
    };
    const root: RollupNodeView = { ...node({ id: "__root__" }), kind: "project", childIds: [openMilestone.id, closedMilestone.id], depth: 0 };
    const body: RepoRollupView = {
      generatedAt: "2026-01-01T00:00:00.000Z",
      workspaceRoot: "/repo",
      root,
      flatRows: [root, openMilestone, openTask, closedMilestone, closedTask],
      summary: {
        totalNodes: 4,
        milestones: 2,
        sprints: 0,
        tasks: 2,
        open: 1,
        blocked: 0,
        needsVerification: 0,
        closed: 1,
        cancelled: 0,
        activeReservations: 0
      }
    };
    const preset = ROLLUP_FILTER_CYCLE.find((filter) => rollupFilterLabel(filter) === "milestones with open work");
    expect(preset).toBeDefined();
    expect(visibleRollupRows(body, preset, new Set()).map((row) => row.id)).toEqual([openMilestone.id]);
  });

  it("offers a ready-to-claim preset for actionable leaves", () => {
    const ready = node({ id: "ready", workStatus: "ready" });
    const closed = node({ id: "closed", workStatus: "closed" });
    const root: RollupNodeView = { ...node({ id: "__root__" }), kind: "project", childIds: [ready.id, closed.id], depth: 0 };
    const body: RepoRollupView = {
      generatedAt: "2026-01-01T00:00:00.000Z",
      workspaceRoot: "/repo",
      root,
      flatRows: [root, ready, closed],
      summary: {
        totalNodes: 2,
        milestones: 0,
        sprints: 0,
        tasks: 2,
        open: 1,
        blocked: 0,
        needsVerification: 0,
        closed: 1,
        cancelled: 0,
        activeReservations: 0
      }
    };
    const preset = ROLLUP_FILTER_CYCLE.find((filter) => rollupFilterLabel(filter) === "ready to claim");
    expect(preset).toBeDefined();
    expect(visibleRollupRows(body, preset, new Set()).map((row) => row.id)).toEqual([ready.id]);
  });
});

describe("global queue status facet", () => {
  it("filters to a single queue lane through the cycle", () => {
    const body: GlobalWorkQueuesView = {
      queues: [
        { id: "ready", title: "Ready", items: [readyItem("a")], count: 1 },
        { id: "blocked", title: "Blocked", items: [readyItem("b")], count: 1 },
        { id: "needs_verification", title: "Verify", items: [readyItem("c")], count: 1 }
      ],
      summary: { total: 3, ready: 1, blocked: 1, needsVerification: 1 }
    };
    expect(filteredQueueItems(body, QUEUE_FILTER_CYCLE[0]).map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(filteredQueueItems(body, QUEUE_FILTER_CYCLE[1]).map((item) => item.id)).toEqual(["a"]);
    expect(queueFilterLabel(QUEUE_FILTER_CYCLE[1])).toBe("queue: ready");
  });
});

function readyItem(id: string) {
  return {
    id,
    projectId: "p",
    projectName: "p",
    projectRoot: "/repo",
    work: {
      id,
      title: id,
      kind: "task" as const,
      status: "ready" as const,
      priority: "normal" as const,
      labels: [],
      dependencyIds: [],
      activeBlockerIds: [],
      blockedBy: [],
      evidenceCount: 0,
      verificationCount: 0,
      requiredCloseoutGates: []
    }
  };
}
