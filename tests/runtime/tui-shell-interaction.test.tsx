import { PassThrough } from "node:stream";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../apps/tui/src/head-poll.js", () => ({
  DEFAULT_TUI_REFRESH_MS: 30_000,
  normalizeRefreshInterval: (value: number | undefined) => value ?? 30_000,
  watchHead: () => () => undefined
}));

const work = (id: string, title: string, kind: string = "task") => ({
  id, title, kind, status: "ready", priority: "normal", labels: [], activeBlockerIds: [],
  dependencyIds: [], evidenceCount: 0, verificationCount: 0, acceptanceCriteria: [], description: "",
  actions: [], activeReservation: undefined, activeReservationId: undefined
});
const envelope = (body: unknown) => ({ schemaVersion: "boreal.tui.route.v1", generatedAt: new Date().toISOString(), surface: "repo", workspaceRoot: "/repo", stale: false, warnings: [], limits: {}, truncated: {}, body });
const sprint = work("s1", "Sprint One", "sprint");
const task = work("t1", "Scoped Task");
const task2 = work("t2", "Second Task");
let boardTasks = [task, task2];

vi.mock("../../apps/tui/src/loaders.js", () => ({
  invalidateGlobalDashboardCache: vi.fn(),
  loadRepoRollup: vi.fn(async () => envelope({ workspaceRoot: "/repo", root: { id: "__root__", entity: { kind: "work", id: "__root__", workspaceRoot: "/repo", label: "root" }, kind: "project", title: "repo", childIds: ["s1"], depth: 0, expandedByDefault: true, progress: { total: 1, done: 0, open: 1, cancelled: 0, percentDone: 0 }, blockerSummary: { blockerIds: [], activeBlockerCount: 0, blockedDescendantCount: 0 }, labels: [], stale: false, actions: [] }, flatRows: [{ id: "s1", entity: { kind: "sprint", id: "s1", workspaceRoot: "/repo", label: "Sprint One" }, kind: "sprint", title: "Sprint One", childIds: [], depth: 1, expandedByDefault: true, progress: { total: 1, done: 0, open: 1, cancelled: 0, percentDone: 0 }, blockerSummary: { blockerIds: [], activeBlockerCount: 0, blockedDescendantCount: 0 }, labels: [], stale: false, actions: [] }, { id: "t2", entity: { kind: "task", id: "t2", workspaceRoot: "/repo", label: "Second Task" }, kind: "task", title: "Second Task", childIds: [], depth: 1, expandedByDefault: true, progress: { total: 1, done: 0, open: 1, cancelled: 0, percentDone: 0 }, blockerSummary: { blockerIds: [], activeBlockerCount: 0, blockedDescendantCount: 0 }, labels: [], stale: false, actions: [] }], summary: {}, warnings: [] })),
  loadRepoNow: vi.fn(async () => envelope({ currentSprint: { view: sprint, scopeCount: 2, active: true }, rows: [], overflowCount: 0, workingCount: 0, attentionCount: 0, nextCount: 0, summary: {} })),
  loadRepoSprintBoard: vi.fn(async (_root: string, id?: string) => { const selected = id === "s2" ? { ...sprint, id: "s2", title: "Sprint Two" } : sprint; return envelope({ sprints: [{ view: sprint, scopeCount: 2, active: true }, { view: { ...sprint, id: "s2", title: "Sprint Two" }, scopeCount: 0, active: false }], selectedSprintId: id ?? "s1", activeSprintId: "s1", board: { sprint: selected, lanes: [{ id: "ready", title: "Ready", items: boardTasks, count: boardTasks.length }], summary: { taskCount: boardTasks.length, activeBlockerCount: 0 } } }); }),
  loadRepoTaskDetail: vi.fn(async (_root: string, id: string) => envelope({ work: id === task2.id ? task2 : task, dependencyTitles: [], actions: [] }))
}));

import { render } from "../../apps/tui/node_modules/ink/build/index.js";
import { RouteApp } from "../../apps/tui/src/shell.js";
import { cellWidth } from "../../apps/tui/src/theme.js";
import { loadRepoSprintBoard, loadRepoTaskDetail } from "../../apps/tui/src/loaders.js";

async function settle(): Promise<void> { await new Promise((resolve) => setTimeout(resolve, 20)); }

describe("active TUI shell interaction", () => {
  it("drills rollup to sprint to task and returns with escape", async () => {
    const stdin = new PassThrough() as PassThrough & { isTTY?: boolean; setRawMode?: (value: boolean) => void; ref: () => unknown; unref: () => unknown };
    const stdout = new PassThrough() as PassThrough & { isTTY?: boolean; columns?: number; rows?: number };
    stdin.isTTY = true; stdin.setRawMode = () => undefined; stdout.isTTY = true; stdout.columns = 100; stdout.rows = 30;
    stdin.ref = () => stdin; stdin.unref = () => stdin;
    let output = "";
    let lastFrame = "";
    stdout.on("data", (chunk) => { lastFrame = String(chunk); output += lastFrame; });
    const instance = render(createElement(RouteApp, { workspaceRoot: "/repo", refreshMs: 30_000, mouse: false }), { stdin, stdout, exitOnCtrlC: false, debug: true });
    try {
    await vi.waitFor(() => expect(output).toContain("Now"));
    output = "";
    stdin.write("\u001b[D\u001b[D");
    await vi.waitFor(() => expect(output).toContain("▶ 1 Now"));
    expect(output).not.toContain("press again to quit");
    output = "";
    stdin.write("\u001b[B");
    await vi.waitFor(() => expect(output).toContain("▶ 2 Roll-Up"));
    stdin.write("\u001b[C");
    await settle();
    output = "";
    stdin.write("4");
    await vi.waitFor(() => expect(output).toContain("Sprint One"));
    output = "";
    stdin.write("\r");
    await vi.waitFor(() => expect(output).toContain("Sprint: Sprint One"));
    expect(loadRepoSprintBoard).toHaveBeenCalledWith("/repo", "s1");
    output = "";
    stdin.write("j");
    await vi.waitFor(() => expect(output.replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, "")).toMatch(/▸[^\n]*Second Task/));
    boardTasks = [task2, task];
    stdin.write("r");
    await vi.waitFor(() => expect(loadRepoSprintBoard).toHaveBeenCalledTimes(2), { timeout: 1_000 });
    await settle();
    stdin.write("\r");
    await vi.waitFor(() => expect(loadRepoTaskDetail).toHaveBeenCalledWith("/repo", "t2", "task"));
    expect(output).toContain("Scoped Task");
    output = "";
    stdin.write("\x1b");
    await vi.waitFor(() => expect(loadRepoSprintBoard).toHaveBeenCalledTimes(3), { timeout: 1_000 });
    await vi.waitFor(() => expect(output).toContain("Sprint: Sprint One"));
    output = "";
    stdin.write("s");
    await vi.waitFor(() => expect(output).toContain("Choose sprint"));
    stdin.write("Two");
    await settle();
    stdin.write("\r");
    await vi.waitFor(() => expect(loadRepoSprintBoard).toHaveBeenCalledWith("/repo", "s2"));
    await settle();
    output = "";
    stdin.write("/");
    await vi.waitFor(() => expect(output).toContain("Search work and routes"));
    stdin.write("Second");
    await settle();
    const detailCalls = vi.mocked(loadRepoTaskDetail).mock.calls.length;
    stdin.write("\r");
    await vi.waitFor(() => expect(loadRepoTaskDetail).toHaveBeenCalledTimes(detailCalls + 1));
    expect(loadRepoTaskDetail).toHaveBeenLastCalledWith("/repo", "t2", "task");
    await settle();
    lastFrame = "";
    stdout.columns = 40;
    stdout.rows = 12;
    stdout.emit("resize");
    await vi.waitFor(() => {
      const lines = lastFrame.replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, "").replace(/\n$/, "").split("\n");
      expect(lastFrame).toContain("boreal");
      expect(lines.length).toBeLessThanOrEqual(12);
      expect(Math.max(...lines.map(cellWidth))).toBeLessThanOrEqual(40);
    });
    } finally { instance.unmount(); }
  });
});
