import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  borealComponentInventory,
  borealComponentInventorySource,
  borealDesignTokenSource,
  borealDesignTokens,
  borealIconRegistry,
  borealIconStrategy,
  borealInteractionRules,
  buildDashboardHealthView,
  buildProjectRegistryView,
  buildSprintBoardView,
  buildWorkDashboardView,
  findDesignToken,
  findComponentInventoryItem,
  listDesignTokens,
  listComponentInventoryByModule,
  summarizeDesignSystem,
  summarizeComponentInventory,
  summarizeWorkForRegistry,
  type WorkItemView
} from "@boreal/ui-model";
import type { AgentReservation, WorkItem } from "@boreal/core";

describe("ui model dashboard contracts", () => {
  it("builds work queues with reservation summary counts", () => {
    const readyHigh = workView({ id: "bw_work_readyhigh00", title: "Ready high", priority: "high", status: "ready" });
    const readyCritical = workView({
      id: "bw_work_readycritical",
      title: "Ready critical",
      priority: "critical",
      status: "ready"
    });
    const blocked = workView({
      id: "bw_work_blocked0000",
      title: "Blocked task",
      status: "blocked",
      activeBlockerIds: ["bw_work_blocker000"]
    });

    const view = buildWorkDashboardView({
      work: [readyHigh, blocked, readyCritical],
      labels: ["v1-remainder"],
      reservations: [reservation("active"), reservation("expired")]
    });

    expect(view.summary).toMatchObject({
      total: 3,
      ready: 2,
      blocked: 1,
      activeReservations: 1,
      expiredReservations: 1
    });
    expect(view.queues.find((queue) => queue.id === "ready")?.items.map((item) => item.id)).toEqual([
      readyCritical.id,
      readyHigh.id
    ]);
  });

  it("builds sprint board lanes with phase and active blocker counts", () => {
    const sprint = workView({ id: "bw_work_sprint00000", kind: "sprint", title: "Sprint 01" });
    const phase = workView({ id: "bw_work_phase000000", kind: "milestone", title: "Phase 01A", status: "ready" });
    const blocked = workView({
      id: "bw_work_taskblocked",
      kind: "task",
      title: "Blocked task",
      status: "blocked",
      activeBlockerIds: ["bw_work_dependency0"]
    });
    const closed = workView({ id: "bw_work_taskclosed0", kind: "task", title: "Closed task", status: "closed" });

    const board = buildSprintBoardView({ sprint, work: [phase, blocked, closed] });

    expect(board.summary).toMatchObject({
      sprintId: sprint.id,
      phaseCount: 1,
      taskCount: 2,
      activeBlockerCount: 1,
      blocked: 1,
      closed: 1
    });
    expect(board.lanes.find((lane) => lane.id === "blocked")?.items).toEqual([blocked]);
  });

  it("summarizes health findings and fixable actions", () => {
    const view = buildDashboardHealthView({
      title: "Doctor",
      findings: [
        {
          code: "search.stale",
          title: "Search index stale",
          severity: "warning",
          status: "warning",
          message: "Search index is stale.",
          actions: [{ label: "Refresh", command: "bwrk sync refresh --json" }]
        },
        {
          code: "memory.missing",
          title: "Memory root missing",
          severity: "error",
          status: "manual",
          message: "Memory root is missing.",
          actions: [{ label: "Inspect", command: "bwrk doctor --json", destructive: true }]
        }
      ]
    });

    expect(view.summary).toEqual({
      ok: false,
      total: 2,
      errors: 1,
      warnings: 1,
      manualActions: 1,
      fixableActions: 1
    });
    expect(view.findings.map((finding) => finding.code)).toEqual(["memory.missing", "search.stale"]);
  });

  it("aggregates project registry health and work counts", () => {
    const workSummary = summarizeWorkForRegistry([
      { status: "ready" },
      { status: "blocked" },
      { status: "closed" }
    ] as readonly Pick<WorkItem, "status">[]);

    const registry = buildProjectRegistryView({
      entries: [
        {
          id: "project-b",
          name: "B Project",
          projectRoot: "/repo/b",
          memoryRoot: "/repo/b/memory",
          memoryLayout: "child",
          memoryGitMode: "separate",
          health: "warning",
          openWorkCount: workSummary.openWorkCount,
          readyWorkCount: workSummary.readyWorkCount,
          blockedWorkCount: workSummary.blockedWorkCount,
          activeReservationCount: 2,
          findings: []
        },
        {
          id: "project-a",
          name: "A Project",
          projectRoot: "/repo/a",
          memoryRoot: "/repo/a-memory",
          memoryLayout: "sibling",
          memoryGitMode: "separate",
          health: "ok",
          openWorkCount: 0,
          readyWorkCount: 0,
          blockedWorkCount: 0,
          activeReservationCount: 0,
          findings: []
        }
      ]
    });

    expect(workSummary).toEqual({ openWorkCount: 2, readyWorkCount: 1, blockedWorkCount: 1 });
    expect(registry.entries.map((entry) => entry.id)).toEqual(["project-a", "project-b"]);
    expect(registry.summary).toMatchObject({
      totalProjects: 2,
      healthyProjects: 1,
      warningProjects: 1,
      readyWorkCount: 1,
      blockedWorkCount: 1,
      activeReservationCount: 2
    });
  });

  it("tracks every component label from the source design catalog", () => {
    const html = readFileSync(borealComponentInventorySource.path, "utf8");
    const sourceLabels = [...html.matchAll(/data-screen-label="([^"]+)"/g)].map((match) =>
      match[1].replaceAll("&amp;", "&")
    );
    const inventoryLabels = borealComponentInventory.map((item) => item.name);

    expect(sourceLabels).toHaveLength(borealComponentInventorySource.count);
    expect(new Set(inventoryLabels).size).toBe(inventoryLabels.length);
    expect([...inventoryLabels].sort()).toEqual([...sourceLabels].sort());
    expect(findComponentInventoryItem("SprintKanbanBoard")).toMatchObject({
      module: "sprint",
      sourcePath: borealComponentInventorySource.path
    });
  });

  it("summarizes the component import modules and target directories", () => {
    expect(summarizeComponentInventory()).toEqual({
      sourcePath: "dump/Brand design system setup/Components.dc.html",
      total: 177,
      modules: [
        {
          key: "foundation",
          label: "Foundation",
          count: 37,
          targetDirectory: "apps/console/src/components/foundation"
        },
        {
          key: "entity",
          label: "Entity",
          count: 38,
          targetDirectory: "apps/console/src/components/entity"
        },
        {
          key: "global",
          label: "Global",
          count: 19,
          targetDirectory: "apps/console/src/components/global"
        },
        {
          key: "sprint",
          label: "Sprint and board",
          count: 26,
          targetDirectory: "apps/console/src/components/sprint"
        },
        {
          key: "repoMemory",
          label: "Repo memory",
          count: 27,
          targetDirectory: "apps/console/src/components/repo-memory"
        },
        {
          key: "operations",
          label: "Operations",
          count: 30,
          targetDirectory: "apps/console/src/components/operations"
        }
      ]
    });
    expect(listComponentInventoryByModule("operations")).toHaveLength(30);
  });

  it("tracks every CSS design token declaration from globals.css", () => {
    const css = readFileSync(borealDesignTokenSource.path, "utf8");
    const sourceDeclarations = [...css.matchAll(/--(bw-[A-Za-z0-9-]+):\s*([^;]+);/g)].map(
      (match) => `--${match[1]}:${match[2].trim()}`
    );
    const modelDeclarations = borealDesignTokens.map((token) => `${token.name}:${token.value}`);

    expect(sourceDeclarations).toHaveLength(borealDesignTokenSource.declarationCount);
    expect([...modelDeclarations].sort()).toEqual([...sourceDeclarations].sort());
    expect(findDesignToken("--bw-bg", "dark")?.value).toBe("var(--bw-ink-900)");
    expect(findDesignToken("--bw-bg", "light")?.value).toBe("var(--bw-paper-200)");
  });

  it("summarizes token, interaction, and icon design contracts", () => {
    expect(summarizeDesignSystem()).toEqual({
      sourcePath: "dump/Brand design system setup/globals.css",
      totalTokenDeclarations: 89,
      tokenGroups: [
        { group: "rawPalette", count: 27 },
        { group: "typography", count: 10 },
        { group: "spacing", count: 9 },
        { group: "radii", count: 3 },
        { group: "effectsLayout", count: 4 },
        { group: "semantic", count: 36 }
      ],
      themedSemanticTokens: [
        { theme: "dark", count: 18 },
        { theme: "light", count: 18 }
      ],
      interactionRuleCount: 5,
      iconCount: 25
    });
    expect(listDesignTokens({ group: "semantic", theme: "dark" })).toHaveLength(18);
    expect(borealInteractionRules.map((rule) => rule.id)).toContain("focus-visible-ring");
    expect(borealIconStrategy).toMatchObject({
      packageName: "lucide-react",
      scope: "apps/console",
      status: "deferred-until-console-scaffold"
    });
    expect(new Set(borealIconRegistry.map((item) => item.intent)).size).toBe(borealIconRegistry.length);
  });
});

function workView(input: Partial<WorkItemView> & Pick<WorkItemView, "id" | "title">): WorkItemView {
  return {
    kind: "task",
    status: "ready",
    priority: "normal",
    labels: [],
    dependencyIds: [],
    activeBlockerIds: [],
    blockedBy: [],
    evidenceCount: 0,
    verificationCount: 0,
    ...input
  };
}

function reservation(status: AgentReservation["status"]): AgentReservation {
  return {
    meta: {
      id: `bw_reservation_${status}00` as AgentReservation["meta"]["id"],
      schemaVersion: "boreal.runtime.v1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      createdBy: { id: "agent-a", kind: "agent" },
      updatedBy: { id: "agent-a", kind: "agent" },
      sourceRefs: [],
      tags: []
    },
    workId: "bw_work_reserved000" as AgentReservation["workId"],
    agentId: "agent-a",
    status,
    reservedAt: "2026-01-01T00:00:00.000Z"
  };
}
