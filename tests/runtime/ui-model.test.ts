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
  buildGlobalActivityView,
  buildGlobalHealthView,
  buildGlobalSearchView,
  buildGlobalSettingsView,
  buildGlobalWorkQueuesView,
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
      reservations: [reservation("active", readyHigh.id), reservation("expired")]
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
    expect(view.queues.find((queue) => queue.id === "ready")?.items.find((item) => item.id === readyHigh.id)?.activeReservation)
      .toMatchObject({
        id: "bw_reservation_active00",
        agentId: "agent-a",
        reservedAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2099-01-01T00:00:00.000Z"
      });
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

  it("builds project-scoped global work queues with explicit workspace claim commands", () => {
    const view = buildGlobalWorkQueuesView({
      generatedAt: "2026-06-27T00:00:00.000Z",
      projects: [
        {
          projectId: "project-a",
          projectName: "A Project",
          projectRoot: "/repo/a",
          work: [
            workView({ id: "bw_work_same", title: "Ready A", status: "ready" }),
            workView({ id: "bw_work_blocked", title: "Blocked A", status: "blocked" })
          ]
        },
        {
          projectId: "project-b",
          projectName: "B Project",
          projectRoot: "/repo with space/b",
          work: [
            workView({ id: "bw_work_same", title: "Ready B", status: "ready" }),
            workView({ id: "bw_work_verify", title: "Verify B", status: "needs_verification" })
          ]
        }
      ]
    });

    const ready = view.queues.find((queue) => queue.id === "ready");
    expect(view.summary).toEqual({ total: 4, ready: 2, blocked: 1, needsVerification: 1 });
    expect(ready?.items.map((item) => item.id)).toEqual(["project-a:bw_work_same", "project-b:bw_work_same"]);
    expect(ready?.items[0]?.claimCommand).toBe(
      "bwrk --workspace /repo/a work reserve bw_work_same --purpose 'Claim from Boreal Console' --json"
    );
    expect(ready?.items[1]?.claimCommand).toContain("--workspace '/repo with space/b'");
  });

  it("caps each project-scoped global work queue", () => {
    const view = buildGlobalWorkQueuesView({
      limit: 2,
      projects: [
        {
          projectId: "project-a",
          projectName: "A Project",
          projectRoot: "/repo/a",
          work: [
            workView({ id: "bw_work_ready1", title: "Ready 1", status: "ready" }),
            workView({ id: "bw_work_ready2", title: "Ready 2", status: "ready" }),
            workView({ id: "bw_work_ready3", title: "Ready 3", status: "ready" }),
            workView({ id: "bw_work_block1", title: "Blocked 1", status: "blocked" }),
            workView({ id: "bw_work_block2", title: "Blocked 2", status: "blocked" }),
            workView({ id: "bw_work_block3", title: "Blocked 3", status: "blocked" })
          ]
        }
      ]
    });

    expect(view.queues.find((queue) => queue.id === "ready")?.items).toHaveLength(2);
    expect(view.queues.find((queue) => queue.id === "blocked")?.items).toHaveLength(2);
    expect(view.summary).toMatchObject({ total: 4, ready: 2, blocked: 2 });
  });

  it("builds project-scoped global search and activity views", () => {
    const search = buildGlobalSearchView({
      query: "registry",
      projects: [
        {
          projectId: "project-a",
          projectName: "A Project",
          projectRoot: "/repo/a",
          results: [
            {
              id: "work:bw_work_1",
              type: "work",
              recordId: "bw_work_1",
              title: "Work result",
              score: 10
            }
          ]
        },
        {
          projectId: "project-b",
          projectName: "B Project",
          projectRoot: "/repo/b",
          results: [
            {
              id: "work:bw_work_1",
              type: "context_pack",
              recordId: "bw_work_1",
              title: "Context result",
              score: 9
            }
          ]
        }
      ]
    });
    const activity = buildGlobalActivityView({
      projects: [
        {
          projectId: "project-a",
          projectName: "A Project",
          projectRoot: "/repo/a",
          operations: [
            operationRow("bw_operation_human", "human"),
            operationRow("bw_operation_agent", "agent")
          ]
        },
        {
          projectId: "project-b",
          projectName: "B Project",
          projectRoot: "/repo/b",
          operations: [
            operationRow("bw_operation_system", "system")
          ]
        }
      ]
    });

    expect(search.results.map((result) => result.id)).toEqual([
      "project-a:work:bw_work_1",
      "project-b:work:bw_work_1"
    ]);
    expect(search.results[1]).toMatchObject({ projectName: "B Project", sourceKind: "context_pack" });
    expect(activity.summary).toMatchObject({ total: 3, human: 1, agent: 1, system: 1, unknown: 0 });
    expect(activity.items.map((item) => item.actorKind).sort()).toEqual(["agent", "human", "system"]);
  });

  it("builds scoped global health and drift views", () => {
    const view = buildGlobalHealthView({
      projects: [
        {
          projectId: "project-a",
          projectName: "A Project",
          projectRoot: "/repo/a",
          memoryRoot: "/repo/a/memory",
          health: "warning",
          stale: true,
          syncFreshness: "stale",
          syncOk: false,
          vaultOk: true,
          ledgersOk: false,
          searchIndexOk: true,
          gitOk: true,
          findings: [
            {
              code: "ledger.export_drift",
              title: "ledger.export_drift",
              severity: "warning",
              status: "warning",
              message: "Ledger export is stale.",
              source: "/repo/a/.boreal/ledgers",
              actions: [{ label: "Refresh", command: "bwrk sync refresh --json" }]
            }
          ],
          locks: [
            {
              domain: "lock.state",
              path: "/repo/a/.boreal/runtime/state.lock",
              status: "stale",
              repairCommand: "bwrk doctor --fix --json"
            }
          ]
        }
      ]
    });

    expect(view.summary).toMatchObject({
      totalProjects: 1,
      warningProjects: 1,
      staleProjects: 1,
      lockFindings: 1,
      ledgerFindings: 2,
      fixableActions: 4
    });
    expect(view.findings.map((finding) => finding.sourcePath)).toContain("/repo/a/.boreal/ledgers");
    expect(view.findings.flatMap((finding) => finding.actions.map((action) => action.command))).toEqual(
      expect.arrayContaining([
        "bwrk --workspace /repo/a sync refresh --json",
        "bwrk --workspace /repo/a doctor --fix --json"
      ])
    );
    expect(view.findings.every((finding) => finding.projectRoot === "/repo/a")).toBe(true);
    expect(view.driftGroups.map((group) => group.category)).toEqual(expect.arrayContaining(["ledger", "lock", "sync"]));
  });

  it("builds guarded global settings rows with memory mode explanations", () => {
    const view = buildGlobalSettingsView({
      projects: [
        {
          projectId: "project-a",
          projectName: "A Project",
          projectRoot: "/repo with space/a",
          memoryRoot: "/repo with space/a/memory",
          memoryLayout: "child",
          memoryGitMode: "separate",
          health: "ok",
          stale: false
        }
      ]
    });

    expect(view.memoryModes.map((mode) => mode.id)).toEqual(["separate", "submodule", "shared"]);
    expect(view.memoryModes.find((mode) => mode.id === "shared")?.risk).toContain("mixed");
    expect(view.projects[0]).toMatchObject({
      validateCommand: "bwrk --workspace '/repo with space/a' doctor --json",
      importSetupCommand: "bwrk --workspace '/repo with space/a' registry import-setup --json",
      requiresConfirmation: true
    });
    expect(view.projects[0]?.applySetupCommand).toContain("--memory-git-mode separate");
    expect(view.addProjectAction).toBe("/api/settings/projects/add");
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
          bwrkPin: {
            source: "node_modules",
            binPath: "/repo/b/node_modules/.bin/bwrk",
            relativeBinPath: "node_modules/.bin/bwrk",
            packageName: "@boreal/cli"
          },
          health: "warning",
          stale: true,
          syncFreshness: "stale",
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
          stale: false,
          syncFreshness: "fresh",
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
    expect(registry.entries.find((entry) => entry.id === "project-b")?.bwrkPin).toEqual(
      expect.objectContaining({ relativeBinPath: "node_modules/.bin/bwrk", packageName: "@boreal/cli" })
    );
    expect(registry.summary).toMatchObject({
      totalProjects: 2,
      healthyProjects: 1,
      warningProjects: 1,
      staleProjects: 1,
      openWorkCount: 2,
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
    requiredCloseoutGates: [],
    ...input
  };
}

function reservation(status: AgentReservation["status"], workId: string = "bw_work_reserved000"): AgentReservation {
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
    workId: workId as AgentReservation["workId"],
    agentId: "agent-a",
    status,
    reservedAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z"
  };
}

function operationRow(id: string, actorKind: "human" | "agent" | "system") {
  return {
    id,
    sessionId: "local",
    commandPath: actorKind === "system" ? "sync refresh" : "agent start",
    status: "succeeded",
    exitCode: 0,
    stateChanged: actorKind === "agent",
    generatedArtifactsChanged: actorKind === "system",
    actorId: actorKind,
    actorKind,
    startedAt: `2026-06-27T00:00:0${actorKind.length}.000Z`,
    finishedAt: `2026-06-27T00:00:0${actorKind.length}.500Z`,
    eventCount: actorKind === "human" ? 0 : 1
  };
}
