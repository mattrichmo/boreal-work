import { describe, expect, it } from "vitest";
import { buildPaletteItems, searchPalette } from "../../apps/tui/src/palette.js";

const work = (id: string, kind: "task" | "issue" | "sprint", title: string) => ({
  id, kind, title, status: "ready" as const, priority: "normal" as const,
  activeBlockerIds: [], activeReservation: undefined, activeReservationId: undefined
});

describe("tui palette", () => {
  it("builds scoped work/project entries and deduplicates them", () => {
    const items = buildPaletteItems({
      workspaceRoot: "/repo",
      sprintBody: {
        sprints: [{ view: work("s1", "sprint", "Sprint One"), scopeCount: 1, active: true }],
        selectedSprintId: "s1",
        board: { sprint: work("s1", "sprint", "Sprint One"), lanes: [{ id: "ready", title: "Ready", items: [work("t1", "task", "Task One")], count: 1 }], summary: {} }
      } as never
    });
    expect(items.map((item) => item.id)).toEqual(["s1", "t1"]);
    expect(items.find((item) => item.id === "t1")?.routeId).toBe("repo.taskDetail");
  });

  it("fuzzy searches labels and hints with deterministic limits", () => {
    const items = buildPaletteItems({ workspaceRoot: "/repo", routes: [{ id: "global.projects", label: "Projects", surface: "global" }] });
    expect(searchPalette(items, "proj")[0]?.label).toBe("Projects");
    expect(searchPalette(items, "", 0)).toEqual([]);
  });
});
