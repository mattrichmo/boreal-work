import { describe, expect, it } from "vitest";
import { createElement } from "../../apps/tui/node_modules/react/index.js";
import { renderToString } from "../../apps/tui/node_modules/ink/build/index.js";
import type { TuiCommandDescriptor, WorkItemView } from "@boreal/ui-model";
import { cellWidth } from "../../apps/tui/src/theme.js";
import { CommandConfirmPanel, commandPanelMaxScroll, commandPreviewLines } from "../../apps/tui/src/command-panel.js";
import { TaskDetailRoute, taskDetailMaxScroll } from "../../apps/tui/src/routes/task-detail.js";
import { SprintBoardRoute } from "../../apps/tui/src/routes/sprint-board.js";
import { GlobalOverviewRoute } from "../../apps/tui/src/routes/global-overview.js";
import { GlobalProjectsRoute } from "../../apps/tui/src/routes/global-projects.js";
import { GlobalQueuesRoute } from "../../apps/tui/src/routes/global-queues.js";

function work(input: Partial<WorkItemView> = {}): WorkItemView {
  return { id: "task-1", title: "A task with a deliberately long title", kind: "task", status: "ready", priority: "normal", labels: [], dependencyIds: [], activeBlockerIds: [], blockedBy: [], evidenceCount: 0, verificationCount: 0, requiredCloseoutGates: [], ...input };
}

function detail(): Parameters<typeof TaskDetailRoute>[0]["body"] {
  return { work: work({ description: Array.from({ length: 20 }, (_, i) => `description line ${i}`).join("\n"), acceptanceCriteria: Array.from({ length: 12 }, (_, i) => `criterion ${i}`) }), dependencyTitles: ["dependency with a very long title that must wrap and remain reachable"], actions: [] };
}

function lines(output: string): string[] {
  const result = output.replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, "").split("\n");
  if (result.at(-1) === "") result.pop();
  return result;
}

describe("rendered terminal layout bounds", () => {
  it.each([[63, 18], [83, 24], [103, 34], [40, 12], [40, 8]] as const)("bounds task detail at %sx%s", (width, height) => {
    const output = renderToString(createElement(TaskDetailRoute, { body: detail(), width, height, selectedActionIndex: 0, scrollOffset: 0 }), { columns: width, rows: height });
    expect(lines(output).length).toBeLessThanOrEqual(height);
    expect(Math.max(...lines(output).map(cellWidth))).toBeLessThanOrEqual(width);
  });

  it("makes the final acceptance criterion reachable at max scroll", () => {
    const body = detail();
    const width = 63;
    const height = 18;
    const offset = taskDetailMaxScroll(body, width, height);
    const output = renderToString(createElement(TaskDetailRoute, { body, width, height, selectedActionIndex: 0, scrollOffset: offset }), { columns: width, rows: height });
    expect(output).toContain("criterion 11");
  });

  it("renders closeout information for completed work", () => {
    const body = {
      ...detail(),
      work: work({
        status: "closed",
        closedAt: "2026-09-12T22:00:00.000Z",
        description: "Implemented the change.",
        completion: {
          summary: {
            id: "summary-test",
            status: "final",
            outcome: "completed",
            title: "The change was implemented and verified.",
            body: "Verified the final behavior.",
            completedWork: [],
            evidenceIds: [],
            verificationIds: [],
            commitShas: [],
            dirtyPathNotes: [],
            generatedAt: "2026-09-12T22:00:00.000Z"
          },
          evidence: [{ id: "evidence-test", kind: "test", outcome: "passed", summary: "Focused test suite", observedAt: "2026-09-12T22:00:00.000Z" }],
          verifications: [{ id: "verification-test", verdict: "passed", evidenceIds: [], verifiedAt: "2026-09-12T22:00:00.000Z", notes: "Looks good" }]
        }
      })
    } as Parameters<typeof TaskDetailRoute>[0]["body"];
    const output = renderToString(createElement(TaskDetailRoute, { body, width: 63, height: 24, selectedActionIndex: 0, scrollOffset: 0 }), { columns: 63, rows: 24 });
    expect(output).toContain("COMPLETION");
    expect(output).toContain("passed");
    expect(output).toContain("The change was implemented");
  });

  it("bounds sprint board output across representative terminal sizes", () => {
    const item = work();
    const board = { sprint: work({ id: "sprint", kind: "sprint", title: "Sprint" }), phases: [], lanes: ["draft", "ready", "blocked", "in_progress", "needs_verification", "verified"].map((id, lane) => ({ id, title: id, items: [{ ...item, id: `task-${lane}` }], count: 1 })), summary: { sprintId: "sprint", taskCount: 6, phaseCount: 0, activeBlockerCount: 0, total: 6, open: 6, ready: 1, blocked: 0, inProgress: 0, needsVerification: 0, verified: 0, closed: 0, cancelled: 0 } } as never;
    const body = { sprints: Array.from({ length: 6 }, (_, i) => ({ view: work({ id: `s${i}`, kind: "sprint", title: `Sprint ${i}` }), scopeCount: 12, active: i === 0 })), selectedSprintId: "s0", activeSprintId: "s0", board };
    for (const [width, height] of [[63, 18], [83, 24], [103, 34]] as const) {
      const output = renderToString(createElement(SprintBoardRoute, { body, cursor: 0, width, height }), { columns: width, rows: height });
      expect(lines(output).length).toBeLessThanOrEqual(height);
      expect(Math.max(...lines(output).map(cellWidth))).toBeLessThanOrEqual(width);
    }
  });

  it("bounds long command confirmation and exposes wrapped command lines", () => {
    const descriptor = { id: "x", label: "Run", description: "a long description that must stay bounded", workspaceRoot: "/repo", argv: ["work", "close", "task", "x".repeat(140)], displayCommand: "bwrk", effect: "danger", mutatesState: true, requiresConfirmation: true } as TuiCommandDescriptor;
    expect(commandPreviewLines(descriptor, 30).join("")).toContain("x");
    expect(commandPreviewLines(descriptor, 30).length).toBeGreaterThan(1);
    expect(commandPanelMaxScroll(descriptor, 40, 12)).toBeGreaterThan(0);
    const output = renderToString(createElement(CommandConfirmPanel, { descriptor, width: 40, height: 12, error: "e".repeat(200), scrollOffset: 0 }), { columns: 40, rows: 12 });
    expect(lines(output).length).toBeLessThanOrEqual(12);
    expect(Math.max(...lines(output).map(cellWidth))).toBeLessThanOrEqual(40);
  });

  it("bounds global routes with diagnostic floods at desktop and narrow sizes", () => {
    const warnings = Array.from({ length: 12 }, (_, i) => `warning ${i} ${"x".repeat(100)}`);
    const overview = { registrySummary: { totalProjects: 3, healthyProjects: 1, warningProjects: 1, errorProjects: 1, missingProjects: 0, staleProjects: 0 }, queueSummary: { ready: 1, blocked: 1 }, attention: Array.from({ length: 8 }, (_, i) => ({ id: `a${i}`, projectId: `p${i}`, projectName: `project-${i}-${"z".repeat(40)}`, projectRoot: "/repo", projectMissing: false, findingCode: "x", severity: "warning", title: "Finding", message: "A long finding message" })) }, projects = { entries: Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, name: `project-${i}-${"z".repeat(40)}`, projectRoot: "/repo", health: "warning", lifecycle: "active", stale: false, syncFreshness: "fresh", openWorkCount: 1, readyWorkCount: 1, blockedWorkCount: 0, memoryLayout: "child" })), summary: { totalProjects: 8 } }, queues = { queues: [{ id: "ready", count: 8, totalCount: 8, items: Array.from({ length: 8 }, (_, i) => ({ id: `q${i}`, projectId: `p${i}`, projectName: `project-${i}`, projectRoot: "/repo", work: work({ id: `w${i}`, title: `work-${i}-${"x".repeat(60)}` }) })) }], summary: { ready: 8, blocked: 0, needsVerification: 0 } };
    for (const [width, height] of [[80, 24], [40, 12]] as const) {
      const cases = [
        createElement(GlobalOverviewRoute, { body: overview, cursor: 0, width, height, state: { warnings } }),
        createElement(GlobalProjectsRoute, { body: projects, cursor: 0, width, height, state: { warnings } }),
        createElement(GlobalQueuesRoute, { body: queues, cursor: 0, width, height, state: { warnings } })
      ];
      for (const [caseIndex, element] of cases.entries()) {
        const output = renderToString(element, { columns: width, rows: height });
        expect(lines(output).length, `global case ${caseIndex} at ${width}x${height}`).toBeLessThanOrEqual(height);
        expect(Math.max(...lines(output).map(cellWidth))).toBeLessThanOrEqual(width);
      }
    }
  });
});
