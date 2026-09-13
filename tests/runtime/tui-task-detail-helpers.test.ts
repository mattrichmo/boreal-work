import { describe, expect, it } from "vitest";
import type { RollupNodeView } from "@boreal/ui-model";

import { defaultTaskDetailDisclosure, filterTaskDetailRows, taskDetailHealthSummary, taskDetailLayout, taskDetailXrayRows, visibleTaskDetailRows } from "../../apps/tui/src/routes/task-detail.js";
import { mouseFromInput } from "../../apps/tui/src/runtime.js";
import { resolveColorMode, createColorPalette } from "../../apps/tui/src/theme.js";
import { windowList } from "../../apps/tui/src/ui.js";

function node(
  id: string,
  kind: RollupNodeView["kind"],
  childIds: readonly string[],
  expandedByDefault: boolean,
  depth: number,
  parentId?: string
): RollupNodeView {
  return {
    id,
    entity: { kind, id, workspaceRoot: "/workspace", label: id },
    kind,
    title: id,
    workStatus: "ready",
    depth,
    ...(parentId ? { parentId } : {}),
    childIds,
    expandedByDefault,
    progress: { total: 1, done: 0, open: 1, cancelled: 0, percentDone: 0 },
    blockerSummary: { activeBlockerCount: 0, blockedDescendantCount: 0, blockerIds: [] },
    labels: [],
    stale: false,
    actions: []
  };
}

function hierarchy() {
  const root = node("milestone", "milestone", ["sprint-open", "sprint-closed"], true, 1);
  const sprintOpen = node("sprint-open", "sprint", ["task-open"], true, 2, root.id);
  const taskOpen = node("task-open", "task", [], false, 3, sprintOpen.id);
  const sprintClosed = node("sprint-closed", "sprint", ["task-closed"], false, 2, root.id);
  const taskClosed = node("task-closed", "task", [], false, 3, sprintClosed.id);

  // Deliberately store descendants out of display order. The helper should
  // follow root childIds, not the order of the flat node collection.
  return { root, nodes: [taskClosed, sprintClosed, taskOpen, sprintOpen] };
}

describe("milestone task-detail pure helpers", () => {
  it("switches to a bottom split as the terminal gets narrower", () => {
    expect(taskDetailLayout(87, true)).toMatchObject({ split: true, direction: "bottom", detailWidth: 87, scopeWidth: 87 });
    expect(taskDetailLayout(88, true)).toMatchObject({ split: true, direction: "right", detailWidth: 51, scopeWidth: 36 });
    expect(taskDetailLayout(60, true, 24, "bottom")).toMatchObject({ split: true, direction: "bottom", detailWidth: 60, scopeWidth: 60 });
    expect(taskDetailLayout(120, false)).toMatchObject({ split: false, detailWidth: 120, scopeWidth: 0 });
    expect(taskDetailLayout(-10, true)).toMatchObject({ split: false, detailWidth: 1, scopeWidth: 0 });
  });

  it("derives default disclosure only from expandable child nodes", () => {
    const tree = hierarchy();
    expect([...defaultTaskDetailDisclosure(tree)]).toEqual(["sprint-open"]);
  });

  it("walks visible descendants in hierarchy order and tracks depth", () => {
    const tree = hierarchy();

    expect(visibleTaskDetailRows(tree, new Set()).map(({ node: item, depth, expanded }) => [item.id, depth, expanded])).toEqual([
      ["sprint-open", 0, false],
      ["sprint-closed", 0, false]
    ]);

    expect(visibleTaskDetailRows(tree, new Set(["sprint-open"])).map(({ node: item, depth, expanded }) => [item.id, depth, expanded])).toEqual([
      ["sprint-open", 0, true],
      ["task-open", 1, false],
      ["sprint-closed", 0, false]
    ]);

    expect(visibleTaskDetailRows(tree, new Set(["sprint-open", "sprint-closed", "task-open"])).map(({ node: item, depth }) => [item.id, depth])).toEqual([
      ["sprint-open", 0],
      ["task-open", 1],
      ["sprint-closed", 0],
      ["task-closed", 1]
    ]);
  });

  it("keeps matching descendants visible with their nearest ancestor", () => {
    const tree = hierarchy();
    const rows = visibleTaskDetailRows(tree, new Set(["sprint-open", "sprint-closed"]));
    expect(filterTaskDetailRows(rows, "task-closed").map((row) => row.node.id)).toEqual(["sprint-closed", "task-closed"]);
    expect(filterTaskDetailRows(rows, "does-not-exist")).toEqual([]);
  });

  it("summarizes health and emits a dependency relationship list", () => {
    const tree = hierarchy();
    expect(taskDetailHealthSummary(tree)).toMatchObject({ total: 1, done: 0, blocked: 0, percentDone: 0 });
    expect(taskDetailXrayRows(tree).map((row) => row.nodeId ?? row.id)).toEqual([
      "milestone",
      "sprint-open",
      "task-open",
      "sprint-closed",
      "task-closed"
    ]);
  });

  it("labels X-Ray graph edges by relationship instead of treating scope links as containment", () => {
    const tree = hierarchy();
    const withRelations = {
      ...tree,
      relations: [
        { id: "depends_on:milestone:external", kind: "depends_on" as const, fromId: "milestone", toId: "external", fromTitle: "milestone", toTitle: "External dependency", directed: true },
        { id: "blocks:blocker:task-open", kind: "blocks" as const, fromId: "blocker", toId: "task-open", fromTitle: "Blocker", toTitle: "task-open", directed: true },
        { id: "relates_to:task-open:task-closed", kind: "relates_to" as const, fromId: "task-open", toId: "task-closed", fromTitle: "task-open", toTitle: "task-closed", directed: false }
      ]
    };
    const rows = taskDetailXrayRows(withRelations).map((row) => row.text);
    expect(rows).toContain("  → depends on External dependency");
    expect(rows).toContain("  ! blocked by Blocker");
    expect(rows).toContain("  ↔ relates to task-closed");
  });
});

describe("mouse decoding", () => {
  it("decodes SGR clicks and wheel direction", () => {
    expect(mouseFromInput(`${String.fromCharCode(27)}[<0;21;9M`)).toEqual({ action: "press", button: "left", column: 21, row: 9 });
    expect(mouseFromInput(`${String.fromCharCode(27)}[<64;21;9M`)).toMatchObject({ action: "press", button: "wheelUp", column: 21, row: 9 });
    expect(mouseFromInput(`${String.fromCharCode(27)}[<0;21;9m`)).toMatchObject({ action: "release", button: "left" });
  });
});

describe("bounded list windowing", () => {
  it("centers the cursor while preserving stable source indexes", () => {
    const items = Object.freeze(["a", "b", "c", "d", "e"]);
    const windowed = windowList(items, 2, 3);

    expect(windowed.rows).toEqual([
      { item: "b", index: 1 },
      { item: "c", index: 2 },
      { item: "d", index: 3 }
    ]);
    expect(windowed.above).toBe(1);
    expect(windowed.below).toBe(1);
  });

  it("clamps cursors and reports overflow for zero-sized windows", () => {
    const items = ["a", "b", "c", "d", "e"] as const;

    expect(windowList(items, 99, 2)).toEqual({
      rows: [{ item: "d", index: 3 }, { item: "e", index: 4 }],
      above: 3,
      below: 0
    });
    expect(windowList(items, -5, 2)).toEqual({
      rows: [{ item: "a", index: 0 }, { item: "b", index: 1 }],
      above: 0,
      below: 3
    });
    expect(windowList(items, 3, 0)).toEqual({ rows: [], above: 3, below: 2 });
    expect(windowList([], 3, 4)).toEqual({ rows: [], above: 0, below: 0 });
  });
});

describe("TUI color-mode resolution", () => {
  it("resolves explicit modes without reading or mutating process environment", () => {
    expect(resolveColorMode({})).toBe("color");
    expect(resolveColorMode({ BOREAL_TUI_COLOR_MODE: "light" })).toBe("light");
    expect(resolveColorMode({ BOREAL_TUI_COLOR_MODE: "terminal-default" })).toBe("terminal-default");
    expect(resolveColorMode({ BOREAL_TUI_HIGH_CONTRAST: "1" })).toBe("high-contrast");
    expect(resolveColorMode({ BOREAL_TUI_COLOR_MODE: "high-contrast" })).toBe("high-contrast");
    expect(resolveColorMode({ BOREAL_TUI_COLOR_MODE: "unsupported" })).toBe("color");
  });

  it("gives no-color precedence to both supported disable switches", () => {
    expect(resolveColorMode({ NO_COLOR: "", BOREAL_TUI_COLOR_MODE: "light" })).toBe("none");
    expect(resolveColorMode({ BOREAL_TUI_NO_COLOR: "1", BOREAL_TUI_HIGH_CONTRAST: "1" })).toBe("none");
    expect(createColorPalette("none")).toEqual({
      accent: "",
      accentSoft: "",
      text: "",
      muted: "",
      faint: "",
      warn: "",
      danger: "",
      selectionBg: "",
      barBg: ""
    });
  });

  it("keeps semantic palettes distinguishable from terminal-default output", () => {
    const light = createColorPalette("light");
    const highContrast = createColorPalette("high-contrast");
    const terminalDefault = createColorPalette("terminal-default");

    expect(light.selectionBg).not.toBe("");
    expect(highContrast.accent).not.toBe(light.accent);
    expect(terminalDefault.accent).toBe("green");
  });
});
